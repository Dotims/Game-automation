/**
 * MargoSzpont - Main Entry Point
 * Multi-Bot Support - Separate Browser Instance per Profile
 */

const configServer = require('./src/configServer');
const { exec, spawn } = require('child_process');
const http = require('http');
const path = require('path');

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║               😼 MargoSzpont v2.2 Multi-Bot                  ║
║              Bot do gry Margonem.pl                          ║
╚══════════════════════════════════════════════════════════════╝
`;
console.log(BANNER);

// Track processes per profile
const profileProcesses = new Map(); // profileId -> { browserProc, botProcess, cdpPort }

process.on('uncaughtException', (err) => {
    if (err.message.includes('target closed') || err.message.includes('closed')) {
        console.log('\n❌ Przeglądarka/karta zamknięta');
    } else {
        console.error('\n❌ Błąd:', err.message);
    }
});

process.on('unhandledRejection', () => {});

function checkBrowserRunning(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { JSON.parse(data); resolve(true); } 
                catch { resolve(false); }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

async function launchBrowser(config) {
    const { userDataPath, profileDir, browserPath, cdpPort } = config;
    
    console.log(`🌐 [Port ${cdpPort}] Uruchamianie przeglądarki...`);
    console.log(`   User Data: ${userDataPath}`);
    console.log(`   Profil: ${profileDir}`);
    
    // Launch browser with specific user data dir and port
    const cmd = `"${browserPath}" --remote-debugging-port=${cdpPort} --user-data-dir="${userDataPath}" --profile-directory="${profileDir}" https://www.margonem.pl/`;
    
    exec(cmd, { windowsHide: false });
    
    // Wait for browser to be ready
    let attempts = 0;
    while (attempts < 30) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
        if (await checkBrowserRunning(cdpPort)) {
            console.log(`✅ [Port ${cdpPort}] Przeglądarka uruchomiona!`);
            return true;
        }
    }
    
    throw new Error(`Timeout - przeglądarka nie odpowiada na porcie ${cdpPort}`);
}

async function startBot(profileId, config) {
    const { cdpPort, userDataPath, profileDir } = config;
    const profileName = profileDir || 'Default';
    
    console.log(`🤖 [${profileName}] Uruchamianie bota na porcie ${cdpPort}...`);
    
    // Check if browser running on this port
    const browserReady = await checkBrowserRunning(cdpPort);
    
    if (!browserReady) {
        // Launch browser
        await launchBrowser(config);
        console.log('⏳ Czekam 3 sekundy na załadowanie gry...');
        await new Promise(r => setTimeout(r, 3000));
    }
    
    // Start bot process
    const env = {
        ...process.env,
        CDP_PORT: cdpPort.toString(),
        PROFILE_ID: profileId
    };
    
    const botProcess = spawn('node', [path.join(__dirname, 'src', 'index.js')], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    profileProcesses.set(profileId, { botProcess, cdpPort });
    configServer.setBotProcess(profileId, botProcess);
    
    const prefix = `[${profileName}]`;
    
    botProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
            console.log(`${prefix} ${line}`);
            if (line.includes('Bot ready') || line.includes('Starting main loop')) {
                configServer.setBotStatus(profileId, 'Aktywny');
            } else if (line.includes('Bot paused') || line.includes('💤')) {
                configServer.setBotStatus(profileId, 'Wstrzymany');
            }
        }
    });
    
    botProcess.stderr.on('data', (data) => {
        console.error(`${prefix} ERR: ${data.toString()}`);
    });
    
    botProcess.on('close', (code) => {
        console.log(`${prefix} Bot zakończony (kod: ${code})`);
        profileProcesses.delete(profileId);
        configServer.setBotRunning(profileId, false);
        configServer.setBotStatus(profileId, 'Zatrzymany');
    });
    
    botProcess.on('error', (err) => {
        console.error(`${prefix} Błąd:`, err.message);
        profileProcesses.delete(profileId);
        configServer.setBotRunning(profileId, false);
    });
    
    return botProcess;
}

function stopBot(profileId) {
    const proc = profileProcesses.get(profileId);
    if (proc && proc.botProcess) {
        console.log(`⏹️ Zatrzymywanie bota...`);
        proc.botProcess.kill('SIGTERM');
        setTimeout(() => {
            try { proc.botProcess.kill('SIGKILL'); } catch {}
        }, 5000);
    }
    profileProcesses.delete(profileId);
    configServer.setBotRunning(profileId, false);
    configServer.setBotStatus(profileId, 'Zatrzymany');
}

async function main() {
    console.log('🔧 Uruchamianie panelu konfiguracji...\n');
    
    configServer.startConfigServer(async (action, config) => {
        if (action === 'start') {
            const profileId = config.profileId;
            console.log(`\n▶️ START: ${config.profileDir} (Port ${config.cdpPort})`);
            
            if (profileProcesses.has(profileId)) {
                console.log(`⚠️ Bot już działa`);
                return true;
            }
            
            try {
                await startBot(profileId, config);
                return true;
            } catch (e) {
                console.error(`❌ Błąd:`, e.message);
                configServer.setBotRunning(profileId, false);
                configServer.setBotStatus(profileId, 'Błąd: ' + e.message);
                return false;
            }
            
        } else if (action === 'stop') {
            stopBot(config.profileId);
            return true;
        }
    });
}

main();
