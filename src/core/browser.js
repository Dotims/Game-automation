const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const logger = require('../utils/logger');
const { CONSTANTS } = require('../config');
const path = require('path');

chromium.use(stealth);

async function initBrowser() {
    // MODE 0: Connect via Port (MOST RELIABLE for Extensions/Proxy)
    if (process.env.CDP_PORT) {
        const port = process.env.CDP_PORT;
        logger.log(`🔗 Connecting to browser on port ${port}...`);
        try {
            const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
            const contexts = browser.contexts();
            const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
            const pages = context.pages();
            
            // Find existing Margonem tab
            let page = pages.find(p => p.url().includes('margonem.pl'));
            
            if (!page) {
                logger.log('📄 Margonem tab not found, checking active tab...');
                // Just take the first active page if margonem isn't found
                page = pages.length > 0 ? pages[0] : await context.newPage();
            } else {
                logger.success('🔗 Connected to existing Margonem tab.');
            }

            await setupPage(page);
            return { browser, page };
        } catch (err) {
            logger.error(`❌ Failed to connect to port ${port}: ${err.message}`);
            throw err;
        }
    }

    // MODE 1: Auto-Launch with Profile (Preferred for Multi-Bot)
    if (process.env.CHROME_PROFILE) {
        const fullProfilePath = process.env.CHROME_PROFILE;
        const executablePath = process.env.BROWSER_EXECUTABLE_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
        
        // Parse Profile Path logic
        // If user provided ".../User Data/Profile 1", we need:
        // userDataDir: ".../User Data"
        // args: --profile-directory="Profile 1"
        
        let userDataDir = fullProfilePath;
        let profileArgs = [];
        
        const folderName = path.basename(fullProfilePath);
        if (folderName === 'Default' || folderName.startsWith('Profile ')) {
            // It's a specific profile folder. We need to go up one level.
            userDataDir = path.dirname(fullProfilePath);
            profileArgs.push(`--profile-directory=${folderName}`);
            profileArgs.push(`--user-data-dir=${userDataDir}`); // FORCE IT in args
            logger.log(`🔧 Detected Profile: "${folderName}". Base Dir: "${path.basename(userDataDir)}"`);
        } else {
            logger.log(`🔧 Using provided path as direct User Data Dir: "${folderName}"`);
            profileArgs.push(`--user-data-dir=${userDataDir}`); // FORCE IT in args
        }

        logger.log(`🚀 Launching browser...`);

        try {
            const context = await chromium.launchPersistentContext(userDataDir, {
                executablePath: executablePath,
                headless: false,
                viewport: null, // Default to window size
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-default-browser-check',
                    '--window-position=0,0',
                    '--window-size=1280,800', // Default size
                    ...profileArgs
                ]
            });

            const pages = context.pages();
            let page = pages.length > 0 ? pages[0] : await context.newPage();

            // Check if already on Margonem, otherwise navigation is handled by main loop potentially
            // Check if already on Margonem
            if (page.url().includes('margonem.pl')) {
                logger.success('✅ Found Margonem tab active.');
            } else {
                logger.log('⏳ Waiting for user to navigate to Margonem...');
                // Do NOT auto-navigate. User wants to load proxy/login.
            }
            
            await setupPage(page);
            return { browser: context, page }; // Note: context acts as browser here
        } catch (err) {
            logger.error(`❌ Failed to launch browser profile: ${err.message}`);
            throw err;
        }
    } 
    
    // MODE 2: Connect to Existing (Legacy/Dev)
    else {
        logger.log('🔗 Connecting to existing browser (CDP)...');
        try {
            const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
            const contexts = browser.contexts();
            const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
            const pages = context.pages();
            
            let page = pages.find(p => p.url().includes('margonem.pl'));
            
            if (!page) {
                logger.log('📄 Margonem tab not found, opening new one...');
                page = await context.newPage();
                await page.goto(CONSTANTS.GAME_URL);
            } else {
                logger.success('🔗 Connected to existing Margonem tab.');
            }

            await setupPage(page);
            return { browser, page };
        } catch (err) {
            logger.error('Failed to connect to browser:', err);
            throw err;
        }
    }
}

async function setupPage(page) {
    // --- GLOBAL ERROR HANDLING ---
    page.on('error', err => logger.error('Page error:', err.message));
    page.on('crash', () => logger.error('Page crashed!'));
    
    // Block native alerts
    await page.addInitScript(() => {
        window.alert = () => {}; 
        window.confirm = () => true; 
    });
    logger.info('🛡️ Game alerts blocked.');
}

module.exports = { initBrowser };
