/**
 * MargoSzpont - Main Entry Point
 * Multi-Bot Support - Separate Browser Instance per Profile
 */

const configServer = require('./src/configServer');
const { exec, spawn } = require('child_process');
const { Worker } = require('worker_threads');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Fix module resolution for bundled app (SEA/Caxa)
// In SEA mode, we need createRequire to properly load external modules from cache
const execDir = path.dirname(process.execPath);
const nmPath = path.join(execDir, 'node_modules');

// Create a require function that looks in the right place
let externalRequire = require;
if (fs.existsSync(nmPath)) {
    module.paths.unshift(nmPath);
    // Create a require that resolves from node_modules in cache
    const { createRequire } = require('module');
    externalRequire = createRequire(path.join(nmPath, 'package.json'));
}

// Export for use throughout this file
global.externalRequire = externalRequire;

// Error logging - no popup dialogs (prevents spam)
function showCriticalError(title, message) {
    // Log to console only - popup dialogs cause spam issues
    console.error(`❌ ${title}: ${message.substring(0, 200)}`);
}

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
    const msg = err.message || '';
    // Suppress common harmless errors (navigation, closed pages)
    const harmlessErrors = [
        'target closed',
        'closed',
        'Execution context was destroyed',
        'navigation',
        'Target page, context or browser has been closed'
    ];
    const isHarmless = harmlessErrors.some(e => msg.includes(e));
    
    if (isHarmless) {
        console.log('\n⚠️ Błąd nawigacji (ignorowany):', msg.substring(0, 100));
    } else {
        console.error('\n❌ Błąd:', err.message);
        // Show popup for critical errors when running silently
        showCriticalError('MargoSzpont - Błąd', err.message);
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

// Check if browser process is running (regardless of debug port)
function isBrowserProcessRunning(browserPath) {
    return new Promise((resolve) => {
        const exeName = path.basename(browserPath);
        exec(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`, (err, stdout) => {
            if (err) { resolve(false); return; }
            resolve(stdout.toLowerCase().includes(exeName.toLowerCase()));
        });
    });
}

// Kill browser process
function killBrowserProcess(browserPath) {
    return new Promise((resolve) => {
        const exeName = path.basename(browserPath);
        console.log(`   🔄 Zamykam ${exeName} (brak portu debugowania)...`);
        exec(`taskkill /F /IM "${exeName}"`, (err) => {
            setTimeout(resolve, 2000); // Wait for process to fully close
        });
    });
}

// Ensure browser is running WITH debug port
// For multi-bot: DON'T kill existing browsers - just check if OUR port is ready
async function ensureBrowserWithDebugPort(config) {
    const { cdpPort } = config;
    
    // If browser responds on THIS port - all good
    if (await checkBrowserRunning(cdpPort)) {
        return true;
    }
    
    // Port not responding - need to launch browser for this profile
    // DON'T kill other browsers - multiple Brave instances can coexist
    // with different --user-data-dir and --remote-debugging-port
    return false;
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
    
    // Check if browser running WITH correct debug port
    // If browser running WITHOUT port - kill and restart
    const browserReady = await ensureBrowserWithDebugPort(config);
    
    if (!browserReady) {
        // Launch browser with debug port
        await launchBrowser(config);
        console.log('⏳ Czekam 1 sekundy na załadowanie gry...');
        await new Promise(r => setTimeout(r, 1000));
    } else {
        // Browser already running - check for Margonem page and bring to front
        console.log(`✅ [${profileName}] Przeglądarka już działa - sprawdzam stronę...`);
        try {
            let chromium;
            try {
                chromium = global.externalRequire('playwright-core').chromium;
            } catch {
                chromium = global.externalRequire('playwright').chromium;
            }
            const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            const context = browser.contexts()[0];
            const pages = context?.pages() || [];
            
            // Find Margonem page
            let margoPage = pages.find(p => p.url().includes('margonem'));
            
            if (!margoPage) {
                // No Margonem page - open one
                console.log(`   📄 Otwieranie strony Margonem...`);
                margoPage = await context.newPage();
                await margoPage.goto('https://www.margonem.pl/', { waitUntil: 'domcontentloaded' });
                console.log('   ⏳ Czekam 1 sekundy na załadowanie...');
                await new Promise(r => setTimeout(r, 1000));
            }
            
            // Bring to front and maximize
            await margoPage.bringToFront();
            await margoPage.evaluate(() => {
                // Maximize window using moveTo and resizeTo
                window.moveTo(0, 0);
                window.resizeTo(screen.availWidth, screen.availHeight);
            });
            console.log(`   ✅ Okno przywrócone i powiększone`);
        } catch (e) {
            console.log(`   ⚠️ Błąd:`, e.message);
        }
    }
    
    // Start bot using Worker thread (instead of spawn for better packaging compatibility)
    const workerPath = path.join(__dirname, 'src', 'bot-worker.js');
    
    const botWorker = new Worker(workerPath, {
        workerData: {
            cdpPort: cdpPort,
            profileId: profileId
        }
    });
    
    profileProcesses.set(profileId, { botProcess: botWorker, cdpPort });
    configServer.setBotProcess(profileId, botWorker);
    
    const prefix = `[${profileName}]`;
    
    // Handle messages from worker (logs and errors)
    botWorker.on('message', (msg) => {
        if (msg.type === 'log') {
            console.log(`${prefix} ${msg.message}`);
            configServer.addLog(profileName, msg.message, false);
            if (msg.message.includes('Bot ready') || msg.message.includes('Starting main loop')) {
                configServer.setBotStatus(profileId, 'Aktywny');
            } else if (msg.message.includes('Bot paused') || msg.message.includes('💤')) {
                configServer.setBotStatus(profileId, 'Wstrzymany');
            }
        } else if (msg.type === 'error') {
            console.error(`${prefix} ERR: ${msg.message}`);
            configServer.addLog(profileName, msg.message.substring(0, 200), true);
        }
    });
    
    botWorker.on('error', (err) => {
        console.error(`${prefix} Worker błąd:`, err.message);
        configServer.addLog(profileName, `Worker error: ${err.message}`, true);
        profileProcesses.delete(profileId);
        configServer.setBotRunning(profileId, false);
    });
    
    botWorker.on('exit', (code) => {
        console.log(`${prefix} Bot zakończony (kod: ${code})`);
        profileProcesses.delete(profileId);
        configServer.setBotRunning(profileId, false);
        configServer.setBotStatus(profileId, 'Zatrzymany');
    });
    
    return botWorker;
}

function stopBot(profileId) {
    const proc = profileProcesses.get(profileId);
    if (proc && proc.botProcess) {
        console.log(`⏹️ Zatrzymywanie bota...`);
        // Send terminate message to worker, then force terminate after timeout
        try {
            proc.botProcess.postMessage('terminate');
        } catch {}
        setTimeout(() => {
            try { proc.botProcess.terminate(); } catch {}
        }, 3000);
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
