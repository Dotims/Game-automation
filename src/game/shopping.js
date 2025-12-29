const logger = require('../utils/logger');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function performHeal(page) {
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
    
    // Check if dialog appeared? (We assume yes for now)
    
    await page.keyboard.press('1');
    await sleep(800);
    
    await page.keyboard.press('1');
    await sleep(800);
    
    logger.log("   ✅ Heated to full.");
}

async function buyPotions(page, currentState) {
    logger.log(" 🛒 Interaction: Healer (Shop Sequence)");
    
    // 1. Open Shop: Q -> 2
    await page.keyboard.press('q');
    await sleep(800);
    await page.keyboard.press('2');
    await sleep(1500); // Wait for shop to open
    
    // 2. Analyze Shop via Page Evaluation
    // We need to find the best potion and its element selector
    const shopResult = await page.evaluate((maxHp) => {
        const shop = document.getElementById('shop');
        if (!shop || shop.style.display === 'none') return { success: false, reason: "Shop not open" };
        
        // Find potion items
        const items = Array.from(shop.querySelectorAll('.item'));
        const potions = [];
        
        for (const item of items) {
            const tip = item.getAttribute('tip') || "";
            // Regex to find "Leczy X punktów"
            // "Leczy <span class="damage">100</span>"
            const match = tip.match(/Leczy\s*(?:<[^>]+>)?\s*(\d+[\s\d]*)/);
            
            if (match) {
                // Remove spaces from number "1 000" -> "1000"
                const healAmount = parseInt(match[1].replace(/\s/g, ''));
                potions.push({
                    id: item.id,
                    heal: healAmount,
                    // Element reference is tricky to pass back, we return ID
                });
            }
        }
        
        if (potions.length === 0) return { success: false, reason: "No potions found" };
        
        // --- SMART SELECTION LOGIC ---
        // User Preference: Target ~25-30% of MaxHP to avoid waste and allows multiple uses.
        // Example: 8531 HP -> Wants ~2000 HP potion. (2000/8531 = ~0.23)
        // Previous logic (MaxHP target) selected 10000, which was too big.
        
        const idealHeal = Math.floor(maxHp * 0.30);
        
        // Sort by how close they are to idealHeal
        potions.sort((a, b) => {
            const diffA = Math.abs(a.heal - idealHeal);
            const diffB = Math.abs(b.heal - idealHeal);
            return diffA - diffB;
        });
        
        // Pick the best match
        const best = potions[0];
        
        return { success: true, item: best };
        
    }, currentState.hero.maxhp);
    
    if (!shopResult.success) {
        logger.warn(`   ❌ Shop analysis failed: ${shopResult.reason}`);
        // Close shop just in case
        await page.evaluate(() => window.shop_close && window.shop_close());
        return;
    }
    
    // 3. Buying Logic
    const bestItem = shopResult.item;
    logger.log(`   🧪 Selected Potion: ${bestItem.id} (Heals: ${bestItem.heal}) for MaxHP: ${currentState.hero.maxhp}`);
    
    // Calculate quantity
    // Target: 35
    // Current: currentState.potionsCount
    const targetQty = 35;
    const currentQty = currentState.potionsCount || 0;
    let toBuy = targetQty - currentQty;
    
    if (toBuy <= 0) {
        logger.log("   ✅ Potions already sufficient.");
    } else {
        logger.log(`   🛒 Buying ${toBuy} potions...`);
        
        // Shift+Click = 15
        while (toBuy >= 15) {
            await page.keyboard.down('Shift');
            await page.click(`#${bestItem.id}`);
            await page.keyboard.up('Shift');
            await sleep(300); // reduced sleep for bulk
            toBuy -= 15;
            logger.log("      +15 (Shift+Click)");
        }
        
        // Singles
        while (toBuy > 0) {
             await page.click(`#${bestItem.id}`);
             await sleep(150);
             toBuy--;
        }
    }
    
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
    await page.evaluate(() => window.shop_close && window.shop_close());
    await sleep(500);
    logger.log("   ✅ Shopping complete.");
}

async function performSell(page) {
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
        logger.log(`      Selling Category [${cat}]...`);
        // Repeat 3 times to ensure all pages/items are sold? User said "3 powtórzenia"
        for (let i = 0; i < 3; i++) {
            // Find and Click Category Button
            const clicked = await page.evaluate((btnText) => {
                // Find button in .gargonem-quick-sell-wrapper with text btnText
                const wrapper = document.querySelector('.gargonem-quick-sell-wrapper');
                if (!wrapper) return false;
                const buttons = Array.from(wrapper.querySelectorAll('button'));
                const btn = buttons.find(b => b.textContent.trim() === btnText);
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            }, cat);
            
            if (!clicked) {
                logger.warn(`      ⚠️ Button [${cat}] not found!`);
                continue;
            }
            await sleep(400);

            // Click Accept
            const acceptSelector = '#shop_accept';
            if (await page.$(acceptSelector)) {
                await page.click(acceptSelector);
                // logger.log(`         Sell iteration ${i+1}/3 accepted.`);
            }
            await sleep(400); // Wait for transaction
        }
    }
    
    // 3. Close Shop
    await page.evaluate(() => window.shop_close && window.shop_close());
    await sleep(500);
    logger.log("   ✅ Selling complete.");
}

module.exports = { performHeal, buyPotions, performSell };
