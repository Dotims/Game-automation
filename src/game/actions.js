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
         // 1. Analyze Potions in Browser
         const analysis = await page.evaluate(() => {
             const debug = [];
             if (typeof window.hero === 'undefined') return { error: 'No Hero', debug };
             
             const hero = window.hero;
             const missingHp = hero.maxhp - hero.hp;
             const isCritical = hero.hp < hero.maxhp * 0.40;
             debug.push(`HP: ${hero.hp}/${hero.maxhp} (Miss: ${missingHp}, Crit: ${isCritical})`);

             const bag = document.querySelector('#bag');
             if (!bag) return { error: 'No Bag', debug };

             const items = Array.from(bag.querySelectorAll('.item'));
             const potions = [];

             for (let item of items) {
                  const tip = item.getAttribute('tip');
                  if (tip && tip.includes('Leczy')) {
                      // Regex match - Must find at least one digit!
                      const match = tip.match(/Leczy.*?(\d[\d\s]*)/i);
                      const healRaw = match ? match[1].replace(/\s/g, '') : '0';
                      const healAmount = parseInt(healRaw, 10);
                      
                      potions.push({ 
                          id: item.id, 
                          heal: healAmount,
                          tipPreview: tip.substring(0, 50),
                          top: parseInt(item.style.top || '0', 10),
                          left: parseInt(item.style.left || '0', 10),
                          rect: {
                              x: item.getBoundingClientRect().x + item.getBoundingClientRect().width/2,
                              y: item.getBoundingClientRect().y + item.getBoundingClientRect().height/2
                          }
                      });
                  }
             }

             if (potions.length === 0) {
                 debug.push('No potions found.');
                 return { error: 'No Potions', debug };
             }

             // Filter
             const usable = potions.filter(p => {
                 const effCheck = missingHp >= p.heal * 0.85;
                 if (!isCritical && !effCheck) {
                     debug.push(`Skip [${p.id}] Heal ${p.heal} vs Miss ${missingHp} (Eff: ${expected=p.heal*0.85})`);
                     return false;
                 }
                 return true;
             });

             if (usable.length === 0) {
                 debug.push('No usable potions (Efficiency Blocked).');
                 return { error: 'Efficiency Block', debug };
             }

             usable.sort((a, b) => b.heal - a.heal);
             const best = usable[0];
             debug.push(`Chose [${best.id}] Heal ${best.heal}`);
             
             return { success: true, target: best, debug };
         });

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
             return { id: target.id, heal: target.heal };
         } catch (e) {
             logger.error('Failed to click potion:', e);
             return null;
         }
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
    },

    async useItem(page, itemId) {
        try {
            logger.log(`📜 Attempting to use item [ID: ${itemId}]...`);
            
            // 1. Find Item Coordinates
            const itemCoords = await page.evaluate((id) => {
                // Ensure ID format matches DOM (game uses 'item' prefix often but our passed ID might be raw)
                let el = document.getElementById('item' + id);
                if (!el) el = document.getElementById(id); // Try raw ID
                
                if (!el) return null;
                
                const rect = el.getBoundingClientRect();
                return {
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2
                };
            }, itemId);

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
