const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const logger = require('../utils/logger');
const { CONSTANTS } = require('../config');

chromium.use(stealth);

async function initBrowser() {
    logger.log('🔗 Connecting to browser...');
    try {
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const contexts = browser.contexts();
        const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
        const pages = context.pages();
        
        // Find existing Margonem tab or open new one
        let page = pages.find(p => p.url().includes('margonem.pl'));
        
        if (!page) {
            logger.log('📄 Margonem tab not found, opening new one...');
            page = await context.newPage();
            await page.goto(CONSTANTS.GAME_URL);
        } else {
            logger.success('🔗 Connected to existing Margonem tab.');
        }

        // --- GLOBAL ERROR HANDLING ---
        page.on('error', err => logger.error('Page error:', err.message));
        page.on('crash', () => logger.error('Page crashed!'));
        
        // Block native alerts
        await page.addInitScript(() => {
            window.alert = () => {}; 
            window.confirm = () => true; 
        });
        logger.info('🛡️ Game alerts blocked.');

        return { browser, page };
    } catch (err) {
        logger.error('Failed to connect to browser:', err);
        throw err;
    }
}

module.exports = { initBrowser };
