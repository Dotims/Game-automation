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
         return await page.evaluate(() => {
             if (typeof hero === 'undefined') return false;
             const maxHp = hero.maxhp;
             const hp = hero.hp;
             if (hp > maxHp * 0.85) return false;

             const bag = document.querySelector('#bag');
             if (!bag) return false;

             const items = bag.querySelectorAll('.item');
             let bestItem = null;
             let bestDiff = 99999;
             const missingHp = maxHp - hp;

             for (let item of items) {
                  const tip = item.getAttribute('tip');
                  if (tip && tip.includes('Leczy')) {
                      const match = tip.match(/Leczy <span class="damage">([\d\s]+)<\/span>/);
                      if (match && match[1]) {
                          const healVal = parseInt(match[1].replace(/\s/g, ''));
                          if (healVal <= missingHp + 200) { 
                              const diff = missingHp - healVal;
                              if (Math.abs(diff) < bestDiff) {
                                  bestDiff = Math.abs(diff);
                                  bestItem = item;
                              }
                          }
                      }
                  }
             }

             if (bestItem) {
                  const id = bestItem.id;
                  const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
                  bestItem.dispatchEvent(event);
                  return { id: id, power: '?' };
             }
             return null;
         });
    }
};

module.exports = actions;
