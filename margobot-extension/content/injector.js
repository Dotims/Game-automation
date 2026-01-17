/**
 * MargoSzpont Extension - Content Injector
 * Wstrzykuje lokalny bot.js do strony gry w kontekście MAIN
 * Wersja v3: Natychmiastowe + cykliczne wstrzykiwanie
 */

console.log('🤖 MargoSzpont: Content injector loading...');

// Dynamic check for game environment
function isGamePage() {
    return window.location.href.includes('/gra/') || 
           window.location.href.includes('?si=') ||
           window.location.href.includes('margonem.pl/gra') ||
           document.getElementById('game') ||
           document.getElementById('panel') ||
           document.querySelector('#hero');
}

// Inject bot.js into page context
function injectBot() {
    // Check if panel already exists (bot already loaded)
    if (document.getElementById('margo-bot-panel')) {
        return false; // Already injected and working
    }
    
    // Throttle: don't inject more than once per 3 seconds
    if (window._lastInjectAttempt && Date.now() - window._lastInjectAttempt < 3000) {
        return false;
    }
    window._lastInjectAttempt = Date.now();
    
    console.log('🤖 MargoSzpont: Injecting bot script...');
    
    // Inject License Key (synchronous, before bot)
    try {
        chrome.storage.local.get('licenseKey', (data) => {
            if (chrome.runtime.lastError) return;
            if (data && data.licenseKey) {
                try {
                    const s = document.createElement('script');
                    s.textContent = `try{localStorage.setItem('MARGOBOT_LICENSE_KEY','${data.licenseKey}');console.log('🤖 License restored');}catch(e){}`;
                    (document.head || document.documentElement).appendChild(s);
                    s.remove();
                } catch(e){}
            }
        });
    } catch(e) {}

    // Inject Bot Script
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/bot.js');
    script.type = 'text/javascript';
    script.id = 'margobot-script-tag';
    
    script.onload = function() {
        console.log('🤖 MargoSzpont: Bot script loaded successfully!');
        this.remove();
    };
    script.onerror = function(e) {
        console.error('🤖 MargoSzpont: Failed to load bot.js!', e);
        this.remove();
    };
    
    (document.head || document.documentElement).appendChild(script);
    return true;
}

// ========== IMMEDIATE INJECTION ==========
// Try to inject as soon as possible
function tryImmediateInjection() {
    if (isGamePage()) {
        console.log('🤖 MargoSzpont: Game page detected, attempting immediate injection...');
        injectBot();
    } else {
        console.log('🤖 MargoSzpont: Not on game page yet, will retry...');
    }
}

// Run immediately
tryImmediateInjection();

// Also try after short delays (game might not be ready immediately)
setTimeout(tryImmediateInjection, 500);
setTimeout(tryImmediateInjection, 1500);
setTimeout(tryImmediateInjection, 3000);

// Also try when DOM is fully ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryImmediateInjection);
}
window.addEventListener('load', tryImmediateInjection);

// ========== WATCHDOG (backup) ==========
// Keep checking every 2s in case panel disappears
setInterval(() => {
    if (isGamePage() && !document.getElementById('margo-bot-panel')) {
        console.log('🤖 MargoSzpont: Watchdog - panel missing, re-injecting...');
        injectBot();
    }
}, 2000);

// ========== MESSAGE HANDLING ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'injectBot') {
        window._lastInjectAttempt = 0; // Reset throttle
        injectBot();
        sendResponse({ success: true });
    }
    
    if (message.action === 'stopBot') {
        const stopScript = document.createElement('script');
        stopScript.textContent = 'window.MARGOBOT_STOP = true; console.log("🤖 Bot stopped");';
        (document.body || document.documentElement).appendChild(stopScript);
        stopScript.remove();
        sendResponse({ success: true });
    }
    
    return true;
});

console.log('🤖 MargoSzpont: Content injector ready (v3 - immediate + watchdog)');
