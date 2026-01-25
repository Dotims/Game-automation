const logger = require('../utils/logger');
const { CONSTANTS } = require('../config');
const movement = require('./movement');
const { sleep } = require('../utils/sleep');
const browserEvals = require('../core/browser_evals');

const actions = {
    // Delegate movement to specialized module
    async move(page, gameState, finalTarget) {
        return await movement.move(page, gameState, finalTarget);
    },

    async attack(page, target, lastAttackTime) {
         try {
             // Secondary CAPTCHA check
             const isCaptcha = await browserEvals.checkAttackCaptcha(page);
             
             if (isCaptcha) {
                 logger.warn('🛑 Attack blocked - CAPTCHA detected!');
                 return lastAttackTime;
             }

             const now = Date.now();
             if (now - lastAttackTime > CONSTANTS.ATTACK_COOLDOWN) { 
                 logger.log(`⚔️ Attacking [${target.nick || 'Mob'}] -> E`);
                 await page.keyboard.press('e');
                 return now;
             }
         } catch(e) { logger.error('Attack error', e); }
         return lastAttackTime;
    },

    async enterGateway(page, target) {
         logger.log(`🚪 Reached gateway [${target.name || 'Door'}] Coords. Waiting for map transition...`);
         try {
             // User reported that clicking causes a dialog (Pass/Angry).
             // Merely walking onto the tile (which we have done) is sufficient.
             // We just wait for the server to process the map change.
             await sleep(1000); 
         } catch (e) {
             logger.error('Gateway entry error:', e.message);
         }
    },

    async autoHeal(page) {
         // 1. Analyze Potions in Browser
         const analysis = await browserEvals.analyzePotions(page);

         // 2. Log Debug Info
        //  if (analysis.debug && analysis.debug.length > 0) {
        //      console.log('[AutoHeal Debug]', analysis.debug.join(' | '));
        //  }

         if (!analysis.success || !analysis.target) {
            return null;
         }

         const target = analysis.target;
         
         // 3. Execute Click
         try {
             await page.mouse.move(target.rect.x, target.rect.y, { steps: 5 });
             await page.mouse.click(target.rect.x, target.rect.y, { clickCount: 2, delay: 100 });
             return { id: target.id, heal: target.heal, nick: analysis.nick };
         } catch (e) {
             logger.error('Failed to click potion:', e);
             return null;
         }
    },

    async closeBattle(page) {
         try {
             // Note: This function is called for various reasons (battle end, death, etc.)
             // The caller should log the specific reason.
             await browserEvals.closeBattleWindow(page);
             await sleep(500);
             return true;
         } catch (e) {
             logger.error('Failed to close battle:', e);
             return false;
         }
    },

    async closeBlockingWindow(page) {
        try {
            logger.log('🛑 Blocking Window (centerbox2) detected. Attempting to close...');
            await browserEvals.closeBlockingWindow(page);
            await sleep(500);
            return true;
        } catch (e) {
            logger.error('Failed to close blocking window:', e);
            return false;
        }
    },

    async useItem(page, itemId) {
        try {
            logger.log(`📜 Attempting to use item [ID: ${itemId}]...`);
            
            // 1. Find Item Coordinates
            const itemCoords = await browserEvals.getItemCoords(page, itemId);
            
            if (!itemCoords) {
                logger.error(`❌ Item [${itemId}] not found in DOM!`);
                return false;
            }

            // 2. Perform Trusted Double Click
            await page.mouse.move(itemCoords.x, itemCoords.y, { steps: 5 });
            await page.mouse.click(itemCoords.x, itemCoords.y, { clickCount: 2, delay: 100 });
            
            logger.success(`✅ Used item [${itemId}]`);
            return true;
        } catch (e) {
            logger.error(`Failed to use item [${itemId}]:`, e);
            return false;
        }
    }
};

module.exports = actions;
