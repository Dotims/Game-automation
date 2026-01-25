/**
 * MargoSzpont NI Extension - Content Injector
 * Wstrzykuje bot.js do strony gry w kontekście MAIN dla Nowego Interfejsu
 * Wersja v5: Modular architecture with separate modules
 * 
 * Loading order:
 * 1. e2_data.js - Boss/Expowiska data
 * 2. map_data.js - Map connections
 * 3. config.js - Configuration
 * 4. helpers.js - Utility functions
 * 5. state.js - Global state management
 * 6. pathfinding.js - A* pathfinding
 * 7. potions.js - Potion utilities
 * 8. combat.js - Combat system
 * 9. healing.js - Auto-healing
 * 10. exping.js - Exping/grinding system
 * 11. logic.js - Main logic (reduced)
 * 12. movement.js - Navigation
 * 13. controller.js - E2 Controller
 * 14. bot.js - UI Panel
 */

console.log('🤖 MargoSzpont NI: Content injector loading (v5 modular)...');

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

/**
 * Helper function to load a script and return a promise
 */
function loadScript(path) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(path);
        script.onload = () => {
            script.remove();
            resolve();
        };
        script.onerror = reject;
        (document.head || document.documentElement).appendChild(script);
    });
}

/**
 * Load all scripts in sequence
 */
async function loadScriptsSequentially() {
    const scripts = [
        { path: 'src/data/e2_data.js', name: 'E2 Data' },
        { path: 'src/data/map_data.js', name: 'Map Data' },
        { path: 'src/core/config.js', name: 'Config' },
        { path: 'src/utils/helpers.js', name: 'Helpers' },
        { path: 'src/core/state.js', name: 'State' },
        { path: 'src/navigation/pathfinding.js', name: 'Pathfinding' },
        { path: 'src/utils/potions.js', name: 'Potions' },
        { path: 'src/combat/combat.js', name: 'Combat' },
        { path: 'src/healing/healing.js', name: 'Healing' },
        { path: 'src/exping/exping.js', name: 'Exping' },
        { path: 'src/logic.js', name: 'Logic' },
        { path: 'src/navigation/movement.js', name: 'Movement' },
        { path: 'src/e2/controller.js', name: 'E2 Controller' },
        { path: 'src/ui/bot.js', name: 'UI' }
    ];
    
    for (const { path, name } of scripts) {
        try {
            await loadScript(path);
            console.log(`✅ ${name} loaded`);
        } catch (error) {
            console.error(`❌ Failed to load ${name}:`, error);
            // Continue loading other scripts even if one fails
        }
    }
    
    console.log('🤖 MargoSzpont NI: All modules loaded!');
}

// Inject bot scripts in order
function injectBot() {
    if (injectionStarted) return false; // Already started injection
    if (document.getElementById('my-bot-panel')) return false; // Already injected
    injectionStarted = true; // Mark as started
    
    console.log('🤖 MargoSzpont NI: Injecting bot scripts (modular architecture)...');
    
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

    // 2. Load all scripts in sequence
    loadScriptsSequentially().catch(error => {
        console.error('🤖 MargoSzpont NI: Error loading scripts:', error);
    });
    
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
