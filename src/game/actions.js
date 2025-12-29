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
             // Heal if HP < 85%
             if (hero.hp > hero.maxhp * 0.85) return false;

             const bag = document.querySelector('#bag');
             if (!bag) return false;

             // Get all items and filter for Potions (Leczy)
             const items = Array.from(bag.querySelectorAll('.item'));
             const potions = [];

             for (let item of items) {
                  const tip = item.getAttribute('tip');
                  if (tip && tip.includes('Leczy')) {
                      // Parse coordinates for sorting
                      // Element style usually has "top: 32px; left: 0px;"
                      const top = parseInt(item.style.top || '0', 10);
                      const left = parseInt(item.style.left || '0', 10);
                      
                      // Check if it's usable (optional sanity check?)
                      // User wants STRICT order, so we trust "Leczy" means it's a potion we want to use.
                      // Maybe exclude "Full Heal" if HP > 50%? 
                      // For now, strict compliance with "Reading Order".
                      
                      potions.push({ el: item, top, left, id: item.id });
                  }
             }

             if (potions.length === 0) return null;

             // SORT: Top-to-Bottom, Left-to-Right (Reading Book Order)
             potions.sort((a, b) => {
                 if (Math.abs(a.top - b.top) > 5) { // Row tolerance
                     return a.top - b.top;
                 }
                 return a.left - b.left;
             });

             // Pick the first one
             const best = potions[0];
             
             // Double click to use
             const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
             best.el.dispatchEvent(event);
             
             return { id: best.id, info: 'Used top-left potion' };
         });
    }
};

module.exports = actions;
