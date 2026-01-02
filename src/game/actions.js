const logger = require('../utils/logger');
const { CONSTANTS } = require('../config');
const movement = require('./movement');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const actions = {
    // Delegate movement to specialized module
    async move(page, gameState, finalTarget) {
        return await movement.move(page, gameState, finalTarget);
    },

    async attack(page, target, lastAttackTime) {
         try {
             // Secondary CAPTCHA check
             const isCaptcha = await page.evaluate(() => {
                 const el = document.getElementById('captcha');
                 if (!el || el.style.display === 'none') return false;
                 // Ensure it has content
                 const text = el.innerText.trim();
                 const hasButtons = el.querySelectorAll('.btn').length > 0;
                 return text || hasButtons;
             });

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
         // 1. Find Potion Coordinates (in browser context)
         const potionCoords = await page.evaluate(() => {
             if (typeof hero === 'undefined') return null;
             // Heal if HP < 85%
             if (hero.hp > hero.maxhp * 0.85) return null;

             const bag = document.querySelector('#bag');
             if (!bag) return null;

             // Get all items and filter for Potions (Leczy)
             const items = Array.from(bag.querySelectorAll('.item'));
             const potions = [];

             for (let item of items) {
                  const tip = item.getAttribute('tip');
                  if (tip && tip.includes('Leczy')) {
                      // Parse coordinates for sorting
                      const top = parseInt(item.style.top || '0', 10);
                      const left = parseInt(item.style.left || '0', 10);
                      
                      // Calculate absolute center of the element for clicking
                      const rect = item.getBoundingClientRect();
                      const centerX = rect.x + rect.width / 2;
                      const centerY = rect.y + rect.height / 2;

                      potions.push({ 
                          top, 
                          left, 
                          id: item.id, 
                          x: centerX, 
                          y: centerY 
                      });
                  }
             }

             if (potions.length === 0) return null;

             // SORT: Top-to-Bottom, Left-to-Right
             potions.sort((a, b) => {
                 if (Math.abs(a.top - b.top) > 5) {
                     return a.top - b.top;
                 }
                 return a.left - b.left;
             });

             // Return the best potion's data
             return potions[0];
         });

         // 2. Perform Trusted Action (Node.js context)
         if (potionCoords) {
             try {
                // Human-like movement to the potion
                // steps: 10 makes the move take ~10 frames (smoother)
                await page.mouse.move(potionCoords.x, potionCoords.y, { steps: 5 });
                
                // Trusted Double Click
                await page.mouse.click(potionCoords.x, potionCoords.y, { clickCount: 2, delay: 100 });
                
                return { id: potionCoords.id, info: 'Used potion (Trusted Input)' };
             } catch (e) {
                 logger.error('Failed to click potion:', e);
                 return null;
             }
         }
         
         return null;
    },

    async closeBattle(page) {
         try {
             logger.log('💀 Hero Dead (0%). Closing battle window...');
             await page.evaluate(() => {
                 const btn = document.getElementById('battleclose');
                 if (btn) btn.click();
             });
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
            await page.evaluate(() => {
                // 1. Try global function
                if (typeof shop_close === 'function') {
                    try { shop_close(); } catch(e) {}
                }
                
                // 2. Try hiding the element directly
                const el = document.getElementById('centerbox2');
                if (el) {
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                    // Move it offscreen just in case it blocks clicks
                    el.style.top = '-9999px';
                    el.style.left = '-9999px';
                }
                // REMOVED: Clicking internal buttons as they might be triggers for other shops
            });
            await sleep(500);
            return true;
        } catch (e) {
            logger.error('Failed to close blocking window:', e);
            return false;
        }
    }
};

module.exports = actions;
