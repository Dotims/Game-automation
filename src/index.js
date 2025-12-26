const { initBrowser } = require('./core/browser');
const config = require('./config');
const logger = require('./utils/logger');
const ui = require('./game/ui');
const gameState = require('./game/gameState');
const actions = require('./game/actions');
const captcha = require('./game/captcha');
const { CONSTANTS } = require('./config');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    logger.log('🚀 Starting MargoBot v2.1 (Modular Rewrite)');

    let browser, page;
    try {
        const connected = await initBrowser();
        browser = connected.browser;
        page = connected.page;
    } catch (err) {
        logger.error('Critical initialization error:', err);
        process.exit(1);
    }

    logger.log('⏳ Waiting for map and hero...');
    await sleep(2000);

    // --- State Variables ---
    let lastAttackTime = 0;
    let lastMapName = ""; 
    let currentMapName = "";
    let skippedMobs = new Map(); // mobId -> timestamp

    // --- Cached Map Data ---
    let cachedMapId = null;

    logger.success('✅ Bot ready! Starting main loop.');

    // --- Main Loop ---
    while (true) {
        try {
            // 1. UI Injection & Config Update
            const botState = await ui.injectUI(page, config.DEFAULT_CONFIG);
            
            if (!botState.active) {
                await sleep(500);
                continue; // Paused
            }

            // 2. CAPTCHA Check
            try {
                const solved = await captcha.solve(page);
                if (solved) {
                    logger.info('🤖 CAPTCHA handled. Pausing for stability...');
                    await sleep(3000);
                    continue;
                }
            } catch (err) {
                logger.error('CAPTCHA check error:', err.message);
            }

            // 3. Cleanup Blacklist
            const now = Date.now();
            for (const [mobId, timestamp] of skippedMobs.entries()) {
                if (now - timestamp > CONSTANTS.SKIP_TIMEOUT) {
                    skippedMobs.delete(mobId);
                }
            }

            // 4. Get Game State
            const currentConfig = { 
                ...botState.config, 
                skippedMobIds: Array.from(skippedMobs.keys()) 
            };
            
            const state = await gameState.getGameState(page, currentConfig);
            if (!state) {
                 await sleep(500);
                 continue; // Loading...
            }

            if (state.battle) {
                 const result = await actions.attack(page, { nick: 'Battle' }, lastAttackTime);
                 lastAttackTime = result;
                 // If waiting for turn?
                 // Original logic just waited. actions.attack handles key press.
                 await sleep(200); 
                 continue;
            }

            // 5. Map Rotation Logic
            // Handle Map Change
            if (!cachedMapId || cachedMapId !== state.map.id) {
                logger.info(`🗺️ -- New Map: ${state.map.id} --`);
                if (skippedMobs.size > 0) {
                    logger.log(`🗑️ Clearing blacklist (${skippedMobs.size} mobs) - map change!`);
                    skippedMobs.clear();
                }
                
                if (state.currentMapName && state.currentMapName !== currentMapName) {
                    if (currentMapName) {
                        lastMapName = currentMapName;
                        logger.log(`🗺️ [HISTORY] Last: '${lastMapName}' | Curr: '${state.currentMapName}'`);
                    }
                    currentMapName = state.currentMapName;
                }
                cachedMapId = state.map.id;
            }

            let finalTarget = state.target;

            // If no mob/target, find gateway for rotation
            if (!finalTarget) {
                 logger.log(`💤 IDLE | Mobs: ${state.debugInfo.allMobsCount} | Skipped: ${state.debugInfo.deniedCount}`);
                 
                 // config.maps logic
                 const mapsList = currentConfig.maps || [];
                 if (mapsList.length > 0 && currentMapName) {
                      const currentMapNorm = currentMapName.toLowerCase().trim();
                      let currentIndex = -1;
                      
                      // Find current index
                      for (let i = 0; i < mapsList.length; i++) {
                           if (currentMapNorm.includes(mapsList[i].toLowerCase().trim())) {
                               currentIndex = i; 
                               break;
                           }
                      }
                      
                      // Find Gateway Logic (Forward Rotation)
                      let gw = null;
                      
                      // Priority 1: Forward
                      if (currentIndex !== -1) {
                           for (let offset = 1; offset < mapsList.length; offset++) {
                               const nextIdx = (currentIndex + offset) % mapsList.length;
                               const nextMap = mapsList[nextIdx];
                               // Fix: Check strictly next map first
                               if (offset === 1) { /* Ideal next */ }
                               
                               gw = state.gateways.find(g => g.name && g.name.toLowerCase().includes(nextMap.toLowerCase()));
                               if (gw) {
                                   logger.log(`   ✅ Rotation Target found: ${nextMap}`);
                                   break;
                               }
                           }
                      }
                      
                      // Priority 2: Any map in list except current/last
                      if (!gw) {
                           gw = state.gateways.find(g => {
                               if (!g.name) return false;
                               const name = g.name.toLowerCase();
                               return mapsList.some(m => {
                                   const mLow = m.toLowerCase();
                                   const isCurrent = currentMapName && currentMapName.toLowerCase().includes(mLow);
                                   const isLast = lastMapName && lastMapName.toLowerCase().includes(mLow);
                                   return name.includes(mLow) && !isCurrent && !isLast;
                               });
                           });
                      }
                      
                      // Priority 3: Fallback
                      if (!gw) {
                          gw = state.gateways.find(g => mapsList.some(m => g.name && g.name.toLowerCase().includes(m.toLowerCase())));
                      }
                      
                      if (gw) {
                          finalTarget = { ...gw, type: 'gateway', isGateway: true, nick: `>> ${gw.name}` };
                      }
                 }
            }

            // 6. Action Execution
            if (finalTarget) {
                 const dist = Math.hypot(finalTarget.x - state.hero.x, finalTarget.y - state.hero.y);
                 finalTarget.dist = dist;
                 
                 const interactionDist = finalTarget.isGateway ? 0.5 : 1.5;

                 if (dist <= interactionDist) {
                      if (finalTarget.isGateway) {
                           await actions.enterGateway(page, finalTarget);
                      } else {
                           // Attack
                           const result = await actions.attack(page, finalTarget, lastAttackTime);
                           lastAttackTime = result;
                           await sleep(500);
                      }
                 } else {
                      // Move
                      const result = await actions.move(page, state, finalTarget);
                      if (result === 'skip_target') {
                           if (finalTarget.id) {
                               skippedMobs.set(finalTarget.id, Date.now());
                               logger.log(`📝 Blacklist: ${skippedMobs.size} mobs`);
                           }
                           // If gateway, wait
                           if (finalTarget.isGateway) await sleep(2000);
                      } else if (result === 'moved') {
                           // continue immediate loop?
                      }
                 }
            } else {
                await sleep(500); // Wait for spawn
            }
            
            // Auto Heal Check
            if (currentConfig.autoHeal) {
                 const healed = await actions.autoHeal(page);
                 if (healed) {
                     logger.log(`❤️ Healed using item ${healed.id}`);
                     await sleep(300);
                 }
            }

        } catch (err) {
            if (err.message.includes('Execution context was destroyed')) {
                 logger.warn('⚠️ Navigation detected (Context Destroyed). Retrying...');
                 await sleep(1000);
                 cachedMapId = null; // force refresh
            } else {
                 logger.error('Main Loop Error:', err);
                 await sleep(1000);
            }
        }
    }
}

main();
