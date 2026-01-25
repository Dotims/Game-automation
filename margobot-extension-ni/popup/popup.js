/**
 * MargoSzpont NI Extension - Popup Script
 * Handles license validation and bot injection for New Interface
 */

// License API URL
const LICENSE_API = 'https://margobot-api.vercel.app/api/validate';

// DOM Elements
const licenseSection = document.getElementById('license-section');
const botSection = document.getElementById('bot-section');
const licenseKeyInput = document.getElementById('license-key');
const activateBtn = document.getElementById('activate-btn');
const licenseStatus = document.getElementById('license-status');
const botStatus = document.getElementById('bot-status');
const pageStatus = document.getElementById('page-status');
const injectBtn = document.getElementById('inject-btn');
const stopBtn = document.getElementById('stop-btn');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    // Load saved license key
    const data = await chrome.storage.local.get(['licenseKey', 'licenseValid', 'botRunning']);
    
    if (data.licenseKey) {
        licenseKeyInput.value = data.licenseKey;
        
        if (data.licenseValid) {
            showBotSection();
            
            // Auto-sync license key to page localStorage (so user doesn't need to re-enter)
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes('margonem.pl')) {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        world: 'MAIN',
                        func: (key) => {
                            localStorage.setItem('MARGOBOT_LICENSE_KEY', key);
                        },
                        args: [data.licenseKey]
                    });
                    console.log('License key synced to page');
                } catch (e) {
                    console.log('Could not sync license to page:', e);
                }
            }
        }
    }
    
    // Check if on Margonem page
    checkCurrentPage();
    
    // Check if bot is running
    if (data.botRunning) {
        updateBotStatus(true);
    }
});

// Activate license button
activateBtn.addEventListener('click', async () => {
    const key = licenseKeyInput.value.trim();
    
    if (!key) {
        showLicenseStatus('Wprowadź klucz licencji', 'error');
        return;
    }
    
    activateBtn.disabled = true;
    activateBtn.textContent = 'Weryfikacja...';
    
    try {
        const response = await fetch(LICENSE_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        
        const result = await response.json();
        
        if (result.valid) {
            // Save license in extension storage
            await chrome.storage.local.set({
                licenseKey: key,
                licenseValid: true,
                licenseInfo: result.info
            });
            
            // Also save to page localStorage (for the loader to access)
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url.includes('margonem.pl')) {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    world: 'MAIN',
                    func: (licenseKey) => {
                        localStorage.setItem('MARGOBOT_LICENSE_KEY', licenseKey);
                        console.log('🤖 MargoSzpont NI: License key saved to page');
                    },
                    args: [key]
                });
            }
            
            showLicenseStatus(`✅ Aktywowano! Dni: ${result.info.daysRemaining}`, 'success');
            showBotSection();
        } else {
            showLicenseStatus(`❌ ${result.reason}`, 'error');
            await chrome.storage.local.set({ licenseValid: false });
        }
    } catch (error) {
        showLicenseStatus('❌ Błąd połączenia z serwerem', 'error');
    }
    
    activateBtn.disabled = false;
    activateBtn.textContent = 'Aktywuj';
});

// Inject bot button
injectBtn.addEventListener('click', async () => {
    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab.url.includes('margonem.pl')) {
            showPageStatus('Otwórz stronę Margonem!', false);
            return;
        }
        
        // Inject bot script INTO PAGE CONTEXT (not content script)
        // This allows access to page's global variables like Engine
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN', // CRITICAL: Run in page context, not isolated world
            files: ['content/bot.js']
        });
        
        // Update status
        await chrome.storage.local.set({ botRunning: true });
        updateBotStatus(true);
        
        // Close popup
        window.close();
        
    } catch (error) {
        console.error('Injection error:', error);
        showPageStatus('Błąd: ' + error.message, false);
    }
});

// Stop bot button
stopBtn.addEventListener('click', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Send stop message to content script
        await chrome.tabs.sendMessage(tab.id, { action: 'stopBot' });
        
        await chrome.storage.local.set({ botRunning: false });
        updateBotStatus(false);
        
    } catch (error) {
        console.error('Stop error:', error);
    }
});

// Helper functions
function showLicenseStatus(message, type) {
    licenseStatus.textContent = message;
    licenseStatus.className = `status ${type}`;
}

function showBotSection() {
    botSection.classList.remove('hidden');
}

function showPageStatus(message, isOk) {
    pageStatus.textContent = message;
    pageStatus.className = `status-badge ${isOk ? 'status-ok' : 'status-error'}`;
    injectBtn.disabled = !isOk;
}

function updateBotStatus(running) {
    if (running) {
        botStatus.textContent = 'Aktywny';
        botStatus.className = 'status-badge status-on';
        injectBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else {
        botStatus.textContent = 'Wyłączony';
        botStatus.className = 'status-badge status-off';
        injectBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }
}

async function checkCurrentPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab.url && tab.url.includes('margonem.pl')) {
            // Accept any margonem.pl page that's not the main homepage
            // NI game pages typically use new.margonem.pl or have different URL patterns
            const isHomepage = tab.url === 'https://www.margonem.pl/' || 
                               tab.url === 'https://margonem.pl/' ||
                               tab.url.endsWith('margonem.pl');
            
            if (!isHomepage) {
                showPageStatus('✅ Gra Margonem (NI)', true);
            } else {
                showPageStatus('⚠️ Zaloguj się do gry', false);
            }
        } else {
            showPageStatus('❌ Nie na Margonem', false);
        }
    } catch (error) {
        console.error('Page check error:', error);
        showPageStatus('❌ Błąd sprawdzania', false);
    }
}
