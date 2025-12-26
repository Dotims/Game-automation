const PF = require('pathfinding');
const logger = require('../utils/logger');
const { CONSTANTS } = require('../config');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let stuckCounter = 0;
let lastHeroPos = { x: 0, y: 0 };
let pathfindFailCounter = 0;
let lastFailedTargetId = null;

const actions = {
    async move(page, gameState, finalTarget) {
        if (!finalTarget) return 'no_target';

        // 1. Stuck Check
        if (Math.abs(gameState.hero.x - lastHeroPos.x) < 0.1 && Math.abs(gameState.hero.y - lastHeroPos.y) < 0.1) {
            stuckCounter++;
        } else {
            stuckCounter = 0;
        }
        lastHeroPos = { ...gameState.hero };

        if (stuckCounter > CONSTANTS.STUCK_LIMIT) {
             logger.warn('⚠️ Bot stuck! Performing random move...');
             const directions = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
             const randDir = directions[Math.floor(Math.random() * directions.length)];
             await page.keyboard.press(randDir);
             await sleep(500);
             stuckCounter = 0;
             return 'stuck_recovery';
        }
        
        // 2. Pathfinding
        const grid = new PF.Grid(gameState.map.w, gameState.map.h);
        
        // Obstacles (Collisions)
        const colStr = gameState.map.col;
        if (colStr) {
             let c = 0;
             for (let y = 0; y < gameState.map.h; y++) {
                 for (let x = 0; x < gameState.map.w; x++) {
                     if (colStr[c] === '1') grid.setWalkableAt(x, y, false);
                     c++;
                 }
             }
        }
        // Obstacles (Mobs/Dynamic)
        if (gameState.obstacles) {
            for (const obs of gameState.obstacles) {
                if (finalTarget.type === 'mob' && obs.id === finalTarget.id) continue; // Target is walkable
                if (grid.isWalkableAt(obs.x, obs.y)) {
                     grid.setWalkableAt(obs.x, obs.y, false);
                }
            }
        }

        const finder = new PF.AStarFinder({ allowDiagonal: false });
        const startX = Math.round(gameState.hero.x);
        const startY = Math.round(gameState.hero.y);
        const endX = Math.round(finalTarget.x);
        const endY = Math.round(finalTarget.y);

        let path = null;
        try {
            if (grid.isWalkableAt(endX, endY) || finalTarget.isGateway) {
                 path = finder.findPath(startX, startY, endX, endY, grid);
            } 
        } catch(e) { }

        if (path && path.length > 1) {
             const distTotal = Math.hypot(endX - startX, endY - startY);
             logger.log(`👣 Moving to [${finalTarget.nick || finalTarget.name}] (${distTotal.toFixed(1)}m)`);
             
             pathfindFailCounter = 0;
             lastFailedTargetId = null;

             const stepsToTake = Math.min(path.length - 1, CONSTANTS.BURST_STEPS || 7);
             let currentX = startX;
             let currentY = startY;

             for (let i = 1; i <= stepsToTake; i++) {
                 const nextStep = path[i];
                 if (!nextStep) break;
                 
                 let key = '';
                 if (nextStep[0] > currentX) key = 'ArrowRight';
                 else if (nextStep[0] < currentX) key = 'ArrowLeft';
                 else if (nextStep[1] > currentY) key = 'ArrowDown';
                 else if (nextStep[1] < currentY) key = 'ArrowUp';
                 
                 if (key) {
                     await page.keyboard.press(key, { delay: CONSTANTS.MOVEMENT_SPEED });
                     currentX = nextStep[0];
                     currentY = nextStep[1];
                 }
             }
             return 'moved';
        } else {
             // Failed
             const targetId = finalTarget.id || `${finalTarget.x},${finalTarget.y}`;
             if (lastFailedTargetId === targetId) pathfindFailCounter++;
             else {
                 pathfindFailCounter = 1;
                 lastFailedTargetId = targetId;
             }
             
             logger.log(`❌ [${pathfindFailCounter}/${CONSTANTS.PATHFIND_FAIL_LIMIT}] Pathfinding FAIL`);

             if (pathfindFailCounter >= CONSTANTS.PATHFIND_FAIL_LIMIT) {
                 logger.warn(`🚫 Skipping unreachable target...`);
                 
                 // Reset counters after skip
                 pathfindFailCounter = 0;
                 lastFailedTargetId = null;
                 
                 return 'skip_target';
             }
             await sleep(200);
             return 'fail';
        }
    },

    async attack(page, target, lastAttackTime) {
         try {
             // Secondary CAPTCHA check
             const isCaptcha = await page.evaluate(() => {
                 const el = document.getElementById('captcha');
                 return el && el.style.display !== 'none';
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
         logger.log(`🚪 Activating gateway [${target.name || 'Door'}]...`);
         logger.log(`   ↩️ Step-off trigger...`);
         await page.keyboard.press('ArrowDown', { delay: 240 });
         await sleep(300);
         await page.keyboard.press('ArrowUp', { delay: 240 });
         await sleep(2500);
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
