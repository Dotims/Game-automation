/**
 * MargoSzpont Extension - Background Service Worker
 * Handles storage and cross-tab communication
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
});

// When extension is installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('MargoSzpont extension installed!');
    
    // Initialize storage
    chrome.storage.local.set({
        botRunning: false,
        licenseValid: false,
        licenseKey: '',
        botConfig: {
            minLvl: 1,
            maxLvl: 999,
            maps: [],
            autoHeal: true
        }
    });
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
