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
    
    // PvP & Anti-Stuck State
    let ghostTarget = null;
    let positionHistory = [];

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

            // 5. Map Rotation Logic & PvP Persistence
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
                
                // Clear Ghost Target on map change
                ghostTarget = null;
                positionHistory = [];
            }

            let finalTarget = state.target;

            // --- PvP Ghost Target Logic ---
            if (state.pvp) {
                 if (finalTarget && finalTarget.type === 'mob') {
                     // We see a mob, update ghost target
                     ghostTarget = { ...finalTarget, timestamp: Date.now() };
                 } else if (!finalTarget && ghostTarget) {
                     // No mob seen, but we have a ghost target!
                     const timeSince = Date.now() - ghostTarget.timestamp;
                     if (timeSince < 5000) { // Keep getting closer for 5s
                          // Check if we reached it
                          const dist = Math.hypot(ghostTarget.x - state.hero.x, ghostTarget.y - state.hero.y);
                          if (dist < 1.5) {
                              logger.log('👻 Reached Ghost Target location. It\'s gone.');
                              ghostTarget = null; // We arrived, it's not here
                          } else {
                              logger.log(`👻 Pursuing Ghost Target [${ghostTarget.nick}] (${dist.toFixed(1)}m)...`);
                              finalTarget = ghostTarget;
                          }
                     } else {
                          ghostTarget = null; // Timeout
                     }
                 }
            }

            // --- Oscillation / Loop Detection ---
            // Push current pos
            positionHistory.push({ x: Math.round(state.hero.x), y: Math.round(state.hero.y) });
            if (positionHistory.length > 20) positionHistory.shift();

            // Detect Loops (Density / Unique positions check)
            // Logic: If we spent last 20 moves visiting only a few unique spots (e.g. < 10), we are stuck in a loop.
            if (positionHistory.length >= 20) {
                const uniquePos = new Set(positionHistory.map(p => `${p.x},${p.y}`));
                
                if (uniquePos.size < 12) { // Threshold: If we visited fewer than 12 unique tiles in 20 moves -> STUCK
                     logger.warn(`⚠️ Loop/Stuck detected! (Only ${uniquePos.size} unique tiles in last 20 moves). Forcing map rotation...`);
                     
                     // Force Gateway Logic
                     // Override finalTarget to NEAREST gateway to break loop
                     const nearestGw = state.gateways.sort((a,b) => {
                         const da = Math.hypot(a.x - state.hero.x, a.y - state.hero.y);
                         const db = Math.hypot(b.x - state.hero.x, b.y - state.hero.y);
                         return da - db;
                     })[0];
                     
                     if (nearestGw) {
                         finalTarget = { ...nearestGw, type: 'gateway', isGateway: true, nick: 'ESCAPE LOOP' };
                         positionHistory = []; // Reset history after triggering
                     }
                }
            }

            // If no mob/target AND not forcing escape, find gateway for rotation
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
                      
                      // Find Gateway Logic (Equal Treatment / Nearest Neighbor)
                      let gw = null;
                      
                      // DEBUG LOGS (Temporary)
                      if (state.gateways.length > 0) {
                          logger.log(`🔍 [DEBUG] Current: '${currentMapName}' | Last: '${lastMapName}'`);
                          logger.log(`🔍 [DEBUG] Gateways found: ${state.gateways.map(g => g.name).join(', ')}`);
                      }

                      // 1. Identify valid gateways
                      const validGateways = state.gateways.filter(g => {
                           if (!g.name) return false;
                           const gName = g.name.toLowerCase();

                           // Is it in our list?
                           // Fix logic: Check if map list item is contained in gateway name OR gateway name is in map list item
                           const targetMap = mapsList.find(m => {
                               const mClean = m.toLowerCase().trim();
                               if (!mClean) return false;
                               return gName.includes(mClean); 
                           });
                           
                           if (!targetMap) {
                               // logger.log(`   ❌ GW '${g.name}' ignored: Not in path list.`);
                               return false;
                           }

                           // Is it the one we just came from?
                           if (lastMapName && gName.trim() === lastMapName.toLowerCase().trim()) {
                               logger.log(`   ⛔ GW '${g.name}' blocked: It is Last Map.`);
                               return false;
                           }
                           
                           return true;
                      });
                      if (validGateways.length > 0) {
                           // 2. Pick the NEAREST one. 
                           gw = validGateways.sort((a,b) => {
                               const distA = Math.hypot(a.x - state.hero.x, a.y - state.hero.y);
                               const distB = Math.hypot(b.x - state.hero.x, b.y - state.hero.y);
                               return distA - distB;
                           })[0];
                           
                           if (gw) logger.log(`   ✅ Best Gateway found: ${gw.name} (Nearest)`);
                      } else {
                           // Fallback: If no "new" map found, allow backtracking.
                           gw = state.gateways.find(g => {
                               if (!g.name) return false;
                               return mapsList.some(m => g.name.toLowerCase().includes(m.toLowerCase().trim()));
                           });
                           if (gw) logger.log(`   ⚠️ No new maps found. Backtracking to: ${gw.name}`);
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
