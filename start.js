/**
 * MargoSzpont - Main Entry Point
 * Config server runs continuously, bot can be started/stopped
 */

const configServer = require('./src/configServer');
const { exec } = require('child_process');
const http = require('http');

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║               😼 MargoSzpont v2.1                            ║
║              Bot do gry Margonem.pl                          ║
╚══════════════════════════════════════════════════════════════╝
`;
console.log(BANNER);

// Prevent crashes from unhandled errors (e.g. browser closed)
process.on('uncaughtException', (err) => {
    if (err.message.includes('target closed') || err.message.includes('Target page, context or browser has been closed')) {
        console.log('\n❌ Wykryto zamknięcie przeglądarki/karty. Zatrzymywanie bota...');
        
        // Notify config server that bot stopped unexpectedly
        if (configServer.setBotRunning) configServer.setBotRunning(false);
        global.BOT_SHOULD_STOP = true;
    } else {
        console.error('\n❌ Nieoczekiwany błąd:', err.message);
        // Don't exit, just log
    }
});

process.on('unhandledRejection', (reason, promise) => {
    // Ignore unhandled promise rejections typical for Playwright
    // console.log('Unhandled Rejection:', reason);
});

function checkBrowserRunning() {
    return new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:9222/json/version', (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { JSON.parse(data); resolve(true); } catch { resolve(false); } });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

function launchBrowser(config) {
    return new Promise((resolve, reject) => {
        const { userDataDir, profileDir } = configServer.parseProfilePath(config.profilePath);
        
        console.log('🌐 Uruchamianie przeglądarki...');
        console.log(`   Profil: ${profileDir}\n`);
        
        const cmd = `"${config.browserPath}" --remote-debugging-port=9222 --user-data-dir="${userDataDir}" --profile-directory="${profileDir}" https://www.margonem.pl/`;
        exec(cmd, { windowsHide: false });
        
        let attempts = 0;
        const check = setInterval(async () => {
            attempts++;
            if (await checkBrowserRunning()) {
                clearInterval(check);
                console.log('✅ Przeglądarka uruchomiona!\n');
                resolve();
            } else if (attempts >= 60) {
                clearInterval(check);
                reject(new Error('Timeout'));
            }
        }, 1000);
    });
}



async function runBot() {
    console.log('🤖 Uruchamianie bota...');
    
    // Clear require cache for all src files
    Object.keys(require.cache).forEach(key => {
        if (key.includes('src\\')) delete require.cache[key];
    });
    
    try {
        require('./src/index.js');
    } catch (e) {
        console.error('❌ Błąd bota:', e.message);
    }
}

async function main() {
    try {
        console.log('🔧 Uruchamianie panelu konfiguracji...\n');
        
        configServer.startConfigServer(async (action, config) => {
            if (action === 'start') {
                console.log('\n✅ Otrzymano polecenie START');
                global.BOT_SHOULD_STOP = false;
                
                const running = await checkBrowserRunning();
                
                if (!running) {
                    try {
                        await launchBrowser(config);
                        
                        console.log('⏳ Uruchamianie bota za 5 sekund...');
                        await new Promise(r => setTimeout(r, 5000));
                        
                    } catch (e) {
                        console.error('❌ Błąd uruchamiania przeglądarki');
                        return false;
                    }
                } else {
                    console.log('✅ Przeglądarka już działa.\n');
                }
                
                if (!global.BOT_SHOULD_STOP) await runBot();
                return true;
                
            } else if (action === 'stop') {
                console.log('\n⏹️ Otrzymano polecenie STOP');
                console.log('   Zatrzymywanie bota...\n');
                global.BOT_SHOULD_STOP = true;
                
                // Force stop logic in bot code if needed
                // Currently handled by bot checking flag or process exit (but here we want to keep process)
                // For now, setting flag prevents new loops. Real stop requires reloading browser page or disconnecting CDP
                
                return true;
            }
        });
        
    } catch (error) {
        console.error('❌ Błąd:', error.message);
    }
}

main();
