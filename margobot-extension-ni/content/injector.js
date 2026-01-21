/**
 * MargoSzpont NI Extension - Content Injector
 * Wstrzykuje bot.js do strony gry w kontekście MAIN dla Nowego Interfejsu
 * Wersja v4: logic.js -> movement.js -> bot.js
 */

console.log('🤖 MargoSzpont NI: Content injector loading...');

// Dynamic check for NI game environment
function isGamePage() {
    return window.location.href.includes('margonem.pl') && (
        window.location.href.includes('/gra/') || 
        document.getElementById('game') ||
        document.getElementById('panel') ||
        document.querySelector('.interface-layer')
    );
}

// Global injection guard
let injectionStarted = false;

// Inject bot scripts in order
function injectBot() {
    if (injectionStarted) return false; // Already started injection
    if (document.getElementById('my-bot-panel')) return false; // Already injected
    injectionStarted = true; // Mark as started
    
    console.log('🤖 MargoSzpont NI: Injecting bot scripts...');
    
    // 1. Inject License
    try {
        chrome.storage.local.get('licenseKey', (data) => {
            if (data && data.licenseKey) {
                const s = document.createElement('script');
                s.textContent = `try{localStorage.setItem('MARGOBOT_LICENSE_KEY','${data.licenseKey}');}catch(e){}`;
                (document.head || document.documentElement).appendChild(s);
                s.remove();
            }
        });
    } catch(e) {}

    // 2. Load E2 Data (Bosses + Expowiska)
    const e2DataScript = document.createElement('script');
    e2DataScript.src = chrome.runtime.getURL('src/data/e2_data.js');
    e2DataScript.onload = () => {
        console.log('🎯 E2 Data loaded.');
        
        // 3. Load Map Data
        const mapDataScript = document.createElement('script');
        mapDataScript.src = chrome.runtime.getURL('src/data/map_data.js');
        mapDataScript.onload = () => {
            console.log('🗺️ Map Data loaded.');

            // 4. Load Config (BLOCKED_MAPS, settings)
            const configScript = document.createElement('script');
            configScript.src = chrome.runtime.getURL('src/core/config.js');
            configScript.onload = () => {
                console.log('⚙️ Config loaded.');

                // 5. Load Logic (Core)
                const logicScript = document.createElement('script');
                logicScript.src = chrome.runtime.getURL('src/logic.js');
                logicScript.onload = () => {
                    console.log('🤖 Logic loaded.');
                    
                    // 6. Load Movement (Navigation)
                    const moveScript = document.createElement('script');
                    moveScript.src = chrome.runtime.getURL('src/navigation/movement.js');
                    moveScript.onload = () => {
                        console.log('🤖 Movement loaded.');
                        
                        // 7. Load UI (Bot Panel)
                        const script = document.createElement('script');
                        script.src = chrome.runtime.getURL('src/ui/bot.js');
                        script.onload = () => {
                            console.log('🤖 UI loaded successfully!');
                            script.remove();
                        };
                        (document.head || document.documentElement).appendChild(script);
                        moveScript.remove();
                    };
                    (document.head || document.documentElement).appendChild(moveScript);
                    logicScript.remove();
                };
                (document.head || document.documentElement).appendChild(logicScript);
                configScript.remove();
            };
            (document.head || document.documentElement).appendChild(configScript);
            mapDataScript.remove();
        };
        (document.head || document.documentElement).appendChild(mapDataScript);
        e2DataScript.remove();
    };
    (document.head || document.documentElement).appendChild(e2DataScript);
    
    return true;
}

// Startup
function tryInjection() {
    if (isGamePage()) {
        injectBot();
    }
}

tryInjection();
setTimeout(tryInjection, 2000);
window.addEventListener('load', tryInjection);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'injectBot') {
        injectBot();
        sendResponse({ success: true });
    }
});
