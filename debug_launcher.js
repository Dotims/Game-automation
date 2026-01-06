const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');

chromium.use(stealth);

async function testLaunch() {
    // HARDCODED PATHS FROM YOUR CONFIG FOR TESTING
    const userProfilePath = "C:\\Users\\rados\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Profile 1"; // One of your profiles
    const execPath = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

    console.log('--- DEBUG LAUNCHER ---');
    console.log('Target Profile:', userProfilePath);
    console.log('Executable:', execPath);

    let userDataDir = userProfilePath;
    let profileArgs = [];
    
    const folderName = path.basename(userProfilePath);
    if (folderName === 'Default' || folderName.startsWith('Profile ')) {
        userDataDir = path.dirname(userProfilePath);
        profileArgs.push(`--profile-directory=${folderName}`);
        profileArgs.push(`--user-data-dir=${userDataDir}`);
        console.log(`[Logic] Detected specific profile folder. Setting base dir to: ${userDataDir} and adding args.`);
    } else {
        console.log(`[Logic] Using path directly.`);
        profileArgs.push(`--user-data-dir=${userDataDir}`);
    }

    console.log('Launch options:', {
        userDataDir,
        args: profileArgs
    });

    try {
        console.log('Attempting launch...');
        const context = await chromium.launchPersistentContext(userDataDir, {
            executablePath: execPath,
            headless: false,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-default-browser-check', 
                ...profileArgs
            ]
        });
        console.log('Launch SUCCESS!');
        console.log('Browser should be open. CHECK IF EXTENSIONS/BOOKMARKS ARE VISIBLE.');
        console.log('Press Ctrl+C to close this script (listing pages in 5s...)');
        
        await new Promise(r => setTimeout(r, 5000));
        const pages = context.pages();
        if (pages.length > 0) {
            console.log('Page URL:', pages[0].url());
        }

    } catch (err) {
        console.error('Launch FAILED:', err);
    }
}

testLaunch();
