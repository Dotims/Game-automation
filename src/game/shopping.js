const logger = require('../utils/logger');
const { sleep } = require('../utils/sleep');
const browserEvals = require('../core/browser_evals');

async function checkActive(page) {
    const active = !(await browserEvals.isBotStopped(page));
    if (!active) {
        logger.warn("🛑 Action interrupted by user request.");
    }
    return active;
}

async function performHeal(page) {
    if (!await checkActive(page)) return;
    logger.log(" ❤️ Interaction: Healer (Heal Sequence)");
    
    // Sequence: Q -> 1 -> 1
    // 1. Q (Interact)
    /*
    await page.keyboard.press('q');
    await sleep(600);
    // 2. 1 (Full Heal)
    await page.keyboard.press('1');
    await sleep(600);
    // 3. 1 (End Dialog / Thanks)
    await page.keyboard.press('1');
    await sleep(600);
    */
    
   // Using evaluate to ensure keys are sent to game context if puppeteer input is flaky, 
   // but sticking to keyboard.press is better for "bot-like" behavior simulation?
   // Actually, the user asked for keyboard clicks "Q", "1", "1".
   
    await page.keyboard.press('q');
    await sleep(800);
    if (!await checkActive(page)) return;
    
    // Check if dialog appeared? (We assume yes for now)
    
    await page.keyboard.press('1');
    await sleep(800);
    
    await page.keyboard.press('1');
    await sleep(800);
    
    logger.log("   ✅ Heated to full.");
}

async function buyPotions(page, currentState, skipOpen = false) {
    if (!await checkActive(page)) return;
    logger.log(" 🛒 Interaction: Healer (Shop Sequence)");
    
    // 1. Open Shop: Q -> 2 (Unless skipped)
    if (!skipOpen) {
        await page.keyboard.press('q');
        await sleep(800);
        await page.keyboard.press('2');
        await sleep(1500); // Wait for shop to open
    }
    
    if (!await checkActive(page)) return;
    
    // 2. Analyze Shop via Page Evaluation
    // We need to find the best potion and its element selector
    const shopResult = await browserEvals.analyzeShop(page, currentState.hero.maxhp);
    
    if (!shopResult.success) {
        logger.warn(`   ❌ Shop analysis failed: ${shopResult.reason}`);
        // Close shop just in case
        // Close shop just in case
        await browserEvals.closeShop(page);
        return;
    }
    
    // 3. Buying Logic
    const bestItem = shopResult.item;
    const stackSize = bestItem.stackSize || 30; 
    const shopUnitSize = bestItem.shopUnitSize || 1;

    // Get target slots from UI setting (default 14 if not set)
    const TARGET_SLOTS = await browserEvals.getPotionSlots(page);
    const targetPotions = TARGET_SLOTS * stackSize;
    
    const currentQty = currentState.potionsCount || 0;
    const potionsNeeded = targetPotions - currentQty;
    
    // Convert to "Shop Clicks" (Units)
    // If shop sells 5 at a time, and we need 10, we buy 2 units.
    let unitsToBuy = Math.ceil(potionsNeeded / shopUnitSize);

    logger.log(`   🧪 Selected Potion: ${bestItem.id} (Heals: ${bestItem.heal})`);
    logger.log(`   📊 Stack: ${stackSize} | Unit: ${shopUnitSize} | Have: ${currentQty}`);
    logger.log(`   🛒 Need: ${potionsNeeded} pots -> Buying: ${unitsToBuy} units`);

    if (unitsToBuy <= 0) {
        logger.log("   ✅ Potions already sufficient (Buffer Full).");
    } else {
        // Shift+Click = 15 UNITS (not potions)
        while (unitsToBuy >= 15) {
            if (!await checkActive(page)) return; // STOP CHECK

            await page.keyboard.down('Shift');
            await page.click(`#${bestItem.id}`);
            await page.keyboard.up('Shift');
            
            // Adaptive sleep: reduce wait if buying bulk
            await sleep(250); 
            unitsToBuy -= 15;
            if (unitsToBuy % 150 === 0) logger.log(`      ...remaining units: ${unitsToBuy}`);
        }
        
        // Singles
        while (unitsToBuy > 0) {
             if (!await checkActive(page)) return; // STOP CHECK

             await page.click(`#${bestItem.id}`);
             await sleep(150);
             unitsToBuy--;
        }
    }
    
    // Safety wait
    await sleep(500);
    
    // 3.5 Accept Transaction
    const acceptSelector = '#shop_accept';
    if (await page.$(acceptSelector) !== null) {
        await page.click(acceptSelector);
        logger.log("   ✅ Transaction accepted.");
        await sleep(500);
    } else {
        logger.warn("   ⚠️ Could not find Accept button!");
    }

    // 4. Close Shop
    // 4. Close Shop
    await browserEvals.closeShop(page);
    await sleep(500);
    logger.log("   ✅ Shopping complete.");
}

async function performSell(page, leaveOpen = false) {
    if (!await checkActive(page)) return;
    logger.log(" 💰 Interaction: Shopkeeper (Selling Sequence)");

    // 1. Open Shop: Q -> 1 (User said Q -> 1 for selling at these NPCs)
    await page.keyboard.press('q');
    await sleep(800);
    await page.keyboard.press('1'); 
    await sleep(1500); // Wait for shop

    // 2. Execute Selling Loop
    // User instruction: For buttons 1, 2, 3:
    //    Repeat 3 times: Click Button -> Click Accept
    
    // We can use evaluate to find buttons by text content easily
    const categories = ['1', '2', '3'];
    
    for (const cat of categories) {
        if (!await checkActive(page)) return; // STOP CHECK

        logger.log(`      Selling Category [${cat}]...`);
        // Repeat 3 times to ensure all pages/items are sold? User said "3 powtórzenia"
        for (let i = 0; i < 3; i++) {
            if (!await checkActive(page)) return; // STOP CHECK
            
            // Find and Click Category Button
            // Find and Click Category Button
            const clicked = await browserEvals.clickQuickSellButton(page, cat);
            
            if (!clicked) {
                logger.warn(`      ⚠️ Button [${cat}] not found!`);
                continue;
            }
            await sleep(400);

            // Click Accept (with timeout protection)
            const acceptSelector = '#shop_accept';
            try {
                const acceptBtn = await page.$(acceptSelector);
                if (acceptBtn) {
                    // Use short timeout to avoid hanging
                    await page.click(acceptSelector, { timeout: 5000 });
                }
            } catch (e) {
                // Timeout or click failed - shop might be frozen
                logger.warn(`   ⚠️ Shop accept button failed: ${e.message}. Reloading page...`);
                try {
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                } catch (reloadErr) {
                    logger.error(`   ❌ Reload failed: ${reloadErr.message}`);
                }
                await sleep(3000);
                return; // Exit sell function - let main loop retry
            }
            await sleep(400); // Wait for transaction
        }
    }
    
    // 3. Close Shop (Unless leaveOpen is true)
    if (!leaveOpen) {
        await browserEvals.closeShop(page);
        await sleep(500);
    }
    logger.log("   ✅ Selling complete.");
}

async function buyTeleportScrolls(page) {
    if (!await checkActive(page)) return;
    logger.log(" 📜 Interaction: Buying Teleport Scrolls");
    
    // Shop should already be open (called after performSell with leaveOpen=true)
    // Find the teleport scroll item in the shop
    // Shop should already be open (called after performSell with leaveOpen=true)
    // Find the teleport scroll item in the shop
    const scrollResult = await browserEvals.findTeleportScroll(page);

    if (!scrollResult.success) {
        logger.warn(`   ⚠️ ${scrollResult.reason}`);
        return;
    }

    // Buy 2 units (2 clicks = 10 teleport uses)
    logger.log(`   🛒 Found scroll: ${scrollResult.itemId}. Buying 2 units...`);
    for (let i = 0; i < 2; i++) {
        if (!await checkActive(page)) return;
        await page.click(`#${scrollResult.itemId}`);
        await sleep(300);
    }

    // Accept transaction
    const acceptSelector = '#shop_accept';
    if (await page.$(acceptSelector) !== null) {
        await page.click(acceptSelector);
        logger.log("   ✅ Teleport scrolls purchased.");
        await sleep(500);
    } else {
        logger.warn("   ⚠️ Could not find Accept button!");
    }
}

module.exports = { performHeal, buyPotions, performSell, buyTeleportScrolls };
