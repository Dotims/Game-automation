const { initBrowser } = require('./core/browser');
const config = require('./config');
const logger = require('./utils/logger');
const ui = require('./game/ui');
const gameState = require('./game/gameState');
const actions = require('./game/actions');
const movement = require('./game/movement');
const captcha = require('./game/captcha');
const HUNTING_SPOTS = require('./data/hunting_spots');
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
    let escapeTarget = null;
    let lockedTarget = null; // Target lock to prevent oscillation
    let lastTargetId = null;
    let targetSwitchCount = 0;
    let noAttackCounter = 0;
    let positionHistory = [];

    // --- Cached Map Data ---
    let cachedMapId = null;
    let mapChangedAt = 0; // Cooldown timer

    logger.success('✅ Bot ready! Starting main loop.');

    // --- Main Loop ---
    while (true) {
        try {
        // Inject UI (returns current config state)
        const uiState = await ui.injectUI(page, config.DEFAULT_CONFIG, HUNTING_SPOTS);
        
        // Update local config if UI changed it
        if (!uiState.active) {
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
                ...uiState.config, 
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
                escapeTarget = null;
                lockedTarget = null;
                lastTargetId = null;
                targetSwitchCount = 0;
                noAttackCounter = 0;
                positionHistory = [];
                
                // Set cooldown - wait 4s before making gateway decisions
                mapChangedAt = Date.now();
                logger.log('⏳ Waiting 4s for map data to load...');
            }
            
            // Skip gateway logic if within 4 second cooldown after map change
            const mapCooldownActive = mapChangedAt && (Date.now() - mapChangedAt < 4000);
            if (mapCooldownActive && !state.target) {
                await sleep(500);
                continue; // Wait for mobs to load
            }
            
            // --- GATEWAY STUCK RECOVERY ---
             if (lastMapName === currentMapName && finalTarget && finalTarget.isGateway) {
                  // Count attempts on the same map? 
                  // Better: Detect if we are constantly trying gateway logic without success.
                  // Implemented below in Action Execution.
             }

            let finalTarget = state.target;

            // --- OPPORTUNISTIC ATTACK (Priority: HIGH) ---
            // If ANY valid mob is right next to us (<= 1.5m), ATTACK IT immediately!
            // This overrides pathfinding, target locks, and distant targets.
            // Solves the "standing next to mob but trying to walk away" problem.
            if (state.validMobs && state.validMobs.length > 0) {
                 // validMobs is already sorted by distance in gameState
                 const closestMob = state.validMobs[0];
                 if (closestMob.dist <= 1.5) {
                      if (!finalTarget || finalTarget.id !== closestMob.id) {
                           logger.log(`⚔️ OPTN: Ignoring planned target. Engaging neighbour [${closestMob.nick}] (${closestMob.dist.toFixed(1)}m)!`);
                           finalTarget = closestMob;
                           // Clear locks to avoid conflict
                           lockedTarget = null;
                           escapeTarget = null;
                      }
                 }
            }
            
            // --- PATH-BASED TARGET SELECTION ---
            // Use A* pathfinding to select the mob with the shortest reachable path
            // instead of just the geometrically nearest one
            // Only run this if we didn't already find an opportunistic close target
            if (!escapeTarget && !lockedTarget && (!finalTarget || finalTarget.dist > 1.5) && state.validMobs && state.validMobs.length > 0) {
                const pathOptimalTarget = movement.findBestTarget(state);
                if (pathOptimalTarget) {
                    
                    // --- EFFICIENCY CHECK (Skip slow maps) ---
                    // If few mobs (<= 8) AND nearest is far (> 60 steps), SKIP MAP.
                    if (state.validMobs.length <= 8 && pathOptimalTarget.pathLength > 60) {
                        logger.log(`📉 Efficiency Check: Low mob count (${state.validMobs.length}) & Far target (${pathOptimalTarget.pathLength} steps). Skipping map.`);
                        finalTarget = null; // Force gateway logic
                    } else {
                        finalTarget = pathOptimalTarget;
                    }
                } else {
                    // NEW: All candidate mobs are unreachable (e.g. blocked by river/walls)
                    // Instead of falling back to state.target (which is unreachable), 
                    // we FORCE map change.
                    logger.warn(`🚫 All nearby mobs are unreachable! Initiating map change...`);
                    finalTarget = null;
                }
            }

            // --- 0. Persistence Checks ---
             if (escapeTarget) {
                 const dist = Math.hypot(escapeTarget.x - state.hero.x, escapeTarget.y - state.hero.y);
                 const now = Date.now();
                 
                 // Check if escape timer expired OR we reached the gateway
                 if ((escapeTarget.escapeUntil && now > escapeTarget.escapeUntil) || dist < 1.5) {
                     logger.log('✅ Escape complete. Resuming normal hunting.');
                     escapeTarget = null;
                 } else {
                     // Keep escaping - IGNORE all mobs!
                     logger.log(`🏃 ESCAPING (${((escapeTarget.escapeUntil - now)/1000).toFixed(1)}s left): Moving to gateway (${dist.toFixed(1)}m)`);
                     finalTarget = escapeTarget;
                 }
            }

            // --- Target Lock Detection (Prevent Oscillation) ---
            if (!escapeTarget && finalTarget && finalTarget.type === 'mob') {
                const currentTargetId = finalTarget.id;
                
                // Detect target switching
                if (lastTargetId && lastTargetId !== currentTargetId) {
                    targetSwitchCount++;
                    positionHistory = []; // CRITICAL FIX: Reset loop history when target changes!
                    // Otherwise, standing still while fighting Mob A will be interpreted 
                    // as "stuck" when we try to move to distant Mob B.
                } else {
                    targetSwitchCount = Math.max(0, targetSwitchCount - 1); // Decay if sticking to same target
                }
                lastTargetId = currentTargetId;
                
                // Count frames without attack
                noAttackCounter++;
                
                // If switching targets frequently without attacking → LOCK to current target
                // User asked for "at least 8 seconds" persistence.
                if (targetSwitchCount > 3) {
                    logger.warn(`🔒 TARGET LOCK: Oscillation detected! Locking to [${finalTarget.nick}] (${finalTarget.dist?.toFixed(1)}m)`);
                    lockedTarget = { ...finalTarget, lockedAt: Date.now() };
                    targetSwitchCount = 0;
                    noAttackCounter = 0;
                }
            }
            
            // Apply locked target override
            if (lockedTarget && !escapeTarget) {
                const lockAge = Date.now() - lockedTarget.lockedAt;
                const dist = Math.hypot(lockedTarget.x - state.hero.x, lockedTarget.y - state.hero.y);
                
                // Check if target is still visible and update it
                if (state.target && state.target.id === lockedTarget.id) {
                     lockedTarget.x = state.target.x;
                     lockedTarget.y = state.target.y;
                }

                // Release lock if: reached (< 1.5m), timeout (> 8s), or map changed
                if (dist < 1.5 || lockAge > 8000) {
                    logger.log('🔓 Target lock released.');
                    lockedTarget = null;
                    noAttackCounter = 0;
                } else {
                    logger.log(`🎯 LOCKED TARGET: [${lockedTarget.nick}] (${dist.toFixed(1)}m)`);
                    finalTarget = lockedTarget;
                }
            }


            // --- PvP Ghost Target Logic ---
            if (state.pvp && !escapeTarget && !lockedTarget) {
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
            // FIX: Don't trigger loop detection if we are successfully positioned to fight, OR if we are IDLE (no target)!
            const isFighting = finalTarget && finalTarget.type === 'mob' && finalTarget.dist <= 1.5;
            // Only detect loops if we actually HAVE a target we are trying to reach. Standing idle is not a loop.
            
            if (finalTarget && positionHistory.length >= 20 && !escapeTarget && !isFighting) {
                const uniquePos = new Set(positionHistory.map(p => `${p.x},${p.y}`));
                
                if (uniquePos.size < 12) { // Threshold: If we visited fewer than 12 unique tiles in 20 moves -> STUCK
                     // BLACKLIST the mob(s) we were chasing - they are unreachable!
                     if (finalTarget && finalTarget.type === 'mob' && finalTarget.id) {
                         logger.warn(`🚫 BLACKLISTING mob [${finalTarget.nick}] (ID: ${finalTarget.id}) for 2.5 min - unreachable!`);
                         skippedMobs.set(finalTarget.id, Date.now());
                     }
                     
                     // ALWAYS force escape - even if mobs are present!
                     // This breaks oscillation by physically moving to gateway.
                     const escapeDuration = 10000 + Math.floor(Math.random() * 5000); // 10-15 seconds
                     logger.warn(`⚠️ LOOP DETECTED (${uniquePos.size} tiles)! Forcing ESCAPE for ${(escapeDuration/1000).toFixed(1)}s...`);
                     
                     // Force Gateway Logic - pick FARTHEST gateway (>25m preferred)
                     const gwWithDist = state.gateways.map(gw => ({
                         ...gw,
                         dist: Math.hypot(gw.x - state.hero.x, gw.y - state.hero.y)
                     }));
                     
                     // Prefer gateways >25m away, sort by distance descending
                     const farGateways = gwWithDist.filter(g => g.dist > 25);
                     let chosenGw = null;
                     
                     if (farGateways.length > 0) {
                         // Pick the farthest one
                         chosenGw = farGateways.sort((a,b) => b.dist - a.dist)[0];
                         logger.log(`   🚀 Escaping to FAR gateway: ${chosenGw.name} (${chosenGw.dist.toFixed(1)}m)`);
                     } else {
                         // No far gateways, pick nearest as fallback
                         chosenGw = gwWithDist.sort((a,b) => a.dist - b.dist)[0];
                         if (chosenGw) logger.log(`   ⚠️ No far gateways, using nearest: ${chosenGw.name} (${chosenGw.dist.toFixed(1)}m)`);
                     }
                     
                     if (chosenGw) {
                         escapeTarget = { 
                             ...chosenGw, 
                             type: 'gateway', 
                             isGateway: true, 
                             nick: 'ESCAPE LOOP',
                             escapeUntil: Date.now() + escapeDuration // Timed escape
                         };
                         finalTarget = escapeTarget;
                         positionHistory = [];
                     }
                }
            }

            // If no mob/target AND not forcing escape, find gateway for rotation
            if (!finalTarget) {
                 logger.log(`💤 IDLE | Mobs: ${state.debugInfo.allMobsCount} | Valid: ${state.debugInfo.validMobsCount || 0} | Skipped: ${state.debugInfo.deniedCount}`);
                 
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

                  // 1. Identify valid gateways (Preferred: In Config AND Not Last Map)
                      const validGateways = state.gateways.filter(g => {
                           if (!g.name) return false;
                           const gName = g.name.toLowerCase();

                           // Is it in our list?
                           const targetMap = mapsList.find(m => {
                               const mClean = m.toLowerCase().trim();
                               if (!mClean) return false;
                               return gName.includes(mClean); 
                           });
                           
                           if (!targetMap) return false;

                           // Is it the one we just came from?
                           if (lastMapName && gName.trim() === lastMapName.toLowerCase().trim()) {
                               return false;
                           }
                           return true;
                      });

                      if (validGateways.length > 0) {
                           // 2. Pick the NEAREST valid one
                           gw = validGateways.sort((a,b) => {
                               const distA = Math.hypot(a.x - state.hero.x, a.y - state.hero.y);
                               const distB = Math.hypot(b.x - state.hero.x, b.y - state.hero.y);
                               return distA - distB;
                           })[0];
                           if (gw) logger.log(`   ✅ Best Gateway found: ${gw.name} (Nearest)`);
                      } 
                      
                      // Fallback 1: Allow backtracking to a configured map
                      if (!gw) {
                           gw = state.gateways.find(g => {
                               if (!g.name) return false;
                               return mapsList.some(m => g.name.toLowerCase().includes(m.toLowerCase().trim()));
                           });
                           if (gw) logger.log(`   🔙 Backtracking to Configured Map: ${gw.name}`);
                      }

                      // Fallback 2: Return to Last Map (even if not in config) - Escape Dead End
                      if (!gw && lastMapName) {
                           gw = state.gateways.find(g => g.name.toLowerCase().trim() === lastMapName.toLowerCase().trim());
                           if (gw) logger.log(`   🔙 Escaping Dead End -> Last Map: ${gw.name}`);
                      }

                      // Fallback 3: PANIC MODE - Any nearest gateway (Avoid stuck)
                      if (!gw && state.gateways.length > 0) {
                           // Try to pick one that is NOT the last map if possible
                           const notLast = state.gateways.filter(g => !lastMapName || g.name.toLowerCase().trim() !== lastMapName.toLowerCase().trim());
                           if (notLast.length > 0) {
                                gw = notLast.sort((a,b) => {
                                    const distA = Math.hypot(a.x - state.hero.x, a.y - state.hero.y);
                                    const distB = Math.hypot(b.x - state.hero.x, b.y - state.hero.y);
                                    return distA - distB;
                                })[0];
                                logger.log(`   🆘 PANIC: Taking random gateway (Not Last): ${gw.name}`);
                           } else {
                                // Just take the nearest one
                                gw = state.gateways.sort((a,b) => {
                                    const distA = Math.hypot(a.x - state.hero.x, a.y - state.hero.y);
                                    const distB = Math.hypot(b.x - state.hero.x, b.y - state.hero.y);
                                    return distA - distB;
                                })[0];
                                logger.log(`   🆘 PANIC: Taking nearest gateway: ${gw.name}`);
                           }
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
                           // Gateway Recovery Logic
                           if (!global.gatewayAttempts) global.gatewayAttempts = 0;
                           
                           if (global.gatewayAttempts > 3) {
                               logger.warn(`⚠️ Gateway stuck (${global.gatewayAttempts})! Performing random move...`);
                               // Move away random
                               const rx = state.hero.x + (Math.random() * 6 - 3);
                               const ry = state.hero.y + (Math.random() * 6 - 3);
                               await actions.move(page, state, { x: rx, y: ry, nick: 'Unstuck' });
                               await sleep(1000);
                               global.gatewayAttempts = 0; // Reset after move
                           } else {
                               global.gatewayAttempts++;
                               await actions.enterGateway(page, finalTarget);
                           }
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
