/**
 * MargoSzpont NI Extension - Background Service Worker
 * Handles storage and cross-tab communication for New Interface
 */

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getBotStatus') {
        chrome.storage.local.get(['botRunning', 'licenseValid'], (data) => {
            sendResponse(data);
        });
        return true; // Keep channel open for async response
    }
    
    if (message.action === 'setBotStatus') {
        chrome.storage.local.set({ botRunning: message.running });
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'getLicenseInfo') {
        chrome.storage.local.get(['licenseKey', 'licenseValid', 'licenseInfo'], (data) => {
            sendResponse(data);
        });
        return true;
    }
    
    // === TRUSTED CLICK via Chrome Debugger API ===
    if (message.action === 'trustedClick') {
        const tabId = sender.tab.id;
        const { x, y } = message;
        
        performTrustedClick(tabId, x, y)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        
        return true; // Async response
    }
});

// Stores debugger attachment state per tab
const debuggerAttached = new Map();

// Perform a trusted click using Chrome Debugger API (like Puppeteer)
async function performTrustedClick(tabId, x, y) {
    try {
        // Attach debugger if not already attached to this tab
        if (!debuggerAttached.get(tabId)) {
            await chrome.debugger.attach({ tabId }, '1.3');
            debuggerAttached.set(tabId, true);
            console.log(`🔗 Debugger attached to tab ${tabId}`);
            
            // Detach after 5 minutes of inactivity (or when tab closes)
            setTimeout(() => {
                if (debuggerAttached.get(tabId)) {
                    chrome.debugger.detach({ tabId }).catch(() => {});
                    debuggerAttached.delete(tabId);
                    console.log(`🔓 Debugger detached from tab ${tabId} (timeout)`);
                }
            }, 5 * 60 * 1000);
        }
        
        // Send mousePressed event (equivalent to mousedown)
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: x,
            y: y,
            button: 'left',
            clickCount: 1
        });
        
        // Short delay between press and release (more realistic)
        await new Promise(r => setTimeout(r, 50));
        
        // Send mouseReleased event (equivalent to mouseup)
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: x,
            y: y,
            button: 'left',
            clickCount: 1
        });
        
        console.log(`🖱️ Trusted click at (${x}, ${y})`);
        return true;
        
    } catch (err) {
        console.error('Debugger click error:', err);
        debuggerAttached.delete(tabId);
        throw err;
    }
}

// Clean up debugger when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (debuggerAttached.has(tabId)) {
        debuggerAttached.delete(tabId);
        console.log(`🔓 Tab ${tabId} closed, debugger state cleared`);
    }
});

// Handle debugger detachment (user closed the debug bar, etc.)
chrome.debugger.onDetach.addListener((source, reason) => {
    debuggerAttached.delete(source.tabId);
    console.log(`🔓 Debugger detached from tab ${source.tabId}: ${reason}`);
});

// When extension is installed or updated
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('MargoSzpont NI extension installed/updated!', details.reason);
    
    // Get existing data first - PRESERVE license key!
    const existingData = await chrome.storage.local.get(['licenseKey', 'licenseValid', 'licenseInfo', 'botConfig']);
    
    // Only set DEFAULTS for missing values, don't overwrite existing data
    const defaults = {
        botRunning: false,
        // PRESERVE license data if it exists
        licenseValid: existingData.licenseValid || false,
        licenseKey: existingData.licenseKey || '',
        licenseInfo: existingData.licenseInfo || null,
        botConfig: existingData.botConfig || {
            minLvl: 1,
            maxLvl: 999,
            maps: [],
            autoHeal: true
        }
    };
    
    await chrome.storage.local.set(defaults);
    
    // Log what was preserved
    if (existingData.licenseKey) {
        console.log('✅ License key preserved after update:', existingData.licenseKey.substring(0, 8) + '...');
    }
});

// Badge update when bot status changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.botRunning) {
        if (changes.botRunning.newValue) {
            chrome.action.setBadgeText({ text: 'ON' });
            chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }
});
