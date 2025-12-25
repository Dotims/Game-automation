const { chromium } = require('playwright-extra');

(async () => {
    try {
        console.log("🔗 Connecting to browser...");
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const context = browser.contexts()[0];
        const page = context.pages().find(p => p.url().includes("margonem.pl"));

        if (!page) {
            console.error("❌ No Margonem tab found!");
            process.exit(1);
        }

        console.log("✅ Attached to page. Checking map data...");

        const mapData = await page.evaluate(() => {
            if (typeof map === 'undefined') return { error: "map object undefined" };
            return {
                width: map.x,
                height: map.y,
                colType: typeof map.col,
                colLength: map.col ? map.col.length : 0,
                colSample: map.col ? map.col.substring(0, 50) : "null",
                // Check a few specific points to see if they make sense (0=free, 1=wall usually)
                heroPos: typeof hero !== 'undefined' ? {x: hero.x, y: hero.y} : null
            };
        });

        console.log("📊 Map Data:", mapData);
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
})();
