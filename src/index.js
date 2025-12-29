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
const mapNav = require('./game/map_navigation');
const path = require('path');
const POTION_SELLERS = require('./data/potion_sellers');
const SHOPKEEPERS = require('./data/shopkeepers');
const shopping = require('./game/shopping');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Global Flags
let escapeTarget = null;
let soldItems = false; // Flag to track if we have visited the shopkeeper during this resupply cycle

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
    
    // Load Map Graph
    mapNav.loadMapConnections(path.join(__dirname, '../przejscia_na_mapach.txt'));
    
    await sleep(2000);

    // --- State Variables ---
    let lastAttackTime = 0;
    let lastMapName = ""; 
    let currentMapName = "";
    let skippedMobs = new Map(); // mobId -> timestamp
    const mapHistory = new Map(); // mapName -> lastVisitTimestamp
    
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
        const uiState = await ui.injectUI(page, config.DEFAULT_CONFIG, HUNTING_SPOTS); // Cleaned
        
        if (uiState.securityAlert) {
            logger.error('🛑 FATAL SECURITY WARNING: Bot inputs detected as UNTRUSTED/FAKE!');
            logger.error('   The game or browser is flagging our inputs. Stopping for safety.');
            await sleep(5000);
            continue;
        }

        // Update local config if UI changed it
        if (!uiState.active) {
                if (Date.now() % 5000 < 500) logger.info('💤 Bot paused. Click START in game UI.');
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

            // 4.1. UNCONSCIOUS CHECK (Death)
            if (state.dazed && state.dazed.active) {
                 const waitSeconds = state.dazed.seconds || 5;
                 logger.warn(`💀 Unconscious (DAZED). Respawn in ~${waitSeconds}s. Waiting...`);
                 
                 // Wait for the duration + 2s buffer, but check at least every 20s to show life
                 const sleepTime = Math.min(waitSeconds * 1000 + 2000, 20000); 
                 
                 await sleep(sleepTime); 
                 continue; // Skip everything, just wait
            }

            // Determine Target Map Index & Travel Mode
            // MOVED UP due to dependency in Resupply Check
            const mapsList = currentConfig.maps || [];
            const currentMapNorm = state.currentMapName ? state.currentMapName.toLowerCase().trim() : "";
            let currentIndex = -1;
            
            if (mapsList.length > 0 && currentMapNorm) {
                for (let i = 0; i < mapsList.length; i++) {
                    if (currentMapNorm.includes(mapsList[i].toLowerCase().trim())) {
                        currentIndex = i; 
                        break;
                    }
                }
            }
            
            // --- TRAVERSING MODE CHECK ---
            // If traversing (currentIndex === -1), ignore ALL mobs!
            const isTraversing = (currentIndex === -1) && (mapsList.length > 0);

                // 4.2. RESUPPLY CHECK (Healer / Potions)
                // USER REQUIREMENT: Only resupply if we are in a CITY (e.g. after Respawn).
                // It SHOULD interrupt traversal if we are in a city and need supplies.
                
                let resupplyTarget = null;
                const isCityMap = SHOPKEEPERS.some(s => s.map === state.currentMapName);

                // Allow resupply if we are in a city, even if traversing.
                if (state.hero.maxhp > 0 && isCityMap) { 
                    
                    // --- 1. ALWAYS SELL TRASH FIRST (Unconditional in City) ---
                    if (!soldItems) {
                        const shopkeeper = SHOPKEEPERS.find(s => s.map === state.currentMapName);
                        if (shopkeeper) {
                            const dist = Math.hypot(shopkeeper.x - state.hero.x, shopkeeper.y - state.hero.y);
                             
                            // If close to shopkeeper, SELL!
                            if (dist < 2.0) {
                                logger.log(`💰 Reach Shopkeeper: ${shopkeeper.name}. Selling junk...`);
                                await shopping.performSell(page);
                                soldItems = true; // Mark as done for this cycle
                                await sleep(500);
                                continue; // Restart loop to proceed to healer next OR continue traversing
                            } else {
                                // Go to Shopkeeper
                                logger.log(`💰 City Visit -> Going to Shopkeeper: ${shopkeeper.name} (Sell)...`);
                                resupplyTarget = { 
                                    x: shopkeeper.x, 
                                    y: shopkeeper.y, 
                                    type: 'npc', 
                                    nick: `💰 ${shopkeeper.name}`, 
                                    id: `npc_${shopkeeper.id}` 
                                };
                            }
                        }
                    }

                    // --- 2. CHECK IF WE ALSO NEED HEALING/POTIONS ---
                    const hpPercent = state.hero.hp / state.hero.maxhp;
                    
                    // Dynamic Threshold: Fill 2 rows (14 slots)
                    const stackSize = state.potionStackSize || 30;
                    const maxCapacity = stackSize * 14; 
                    
                    // Trigger if below capacity (User wants "Always filled 2 rows")
                    // We check if we are significantly below or just need top-up
                    // If we have 209/210, maybe skip? But user said "always". 
                    // Let's stick to < maxCapacity.
                    
                    // Only set healer target if we are NOT already going to sell
                    if ((hpPercent < 0.35 || state.potionsCount < maxCapacity) && !resupplyTarget) {

                         // NO SHOPKEEPER (or already sold) -> GO TO HEALER
                         const seller = POTION_SELLERS.find(s => s.map === state.currentMapName);
                         if (seller) {
                             const dist = Math.hypot(seller.x - state.hero.x, seller.y - state.hero.y);
                             
                             // If we are close (Range 2), INTERACT!
                             if (dist < 2.0) {
                                 logger.log(`🏥 Reach Healer: ${seller.name}. Starting interaction...`);
                                 
                                 // 1. Heal
                                 await shopping.performHeal(page);
                                 await sleep(1000);
                                 
                                 // 2. Buy Potions
                                 await shopping.buyPotions(page, state);
                                 
                                 logger.log("✅ Resupply cycle finished. Resuming hunt...");
                                 resupplyTarget = null;
                                 soldItems = false; // Reset for next time we need resupply
                                 await sleep(1000);
                                 continue; // Restart loop to refresh state and go hunt
                             }
                             // Else, walk to them
                             else {
                                 logger.warn(`🏥 Needed (HP: ${(hpPercent*100).toFixed(0)}%, Pots: ${state.potionsCount}/${maxCapacity})! Going to ${seller.name}...`);
                                 resupplyTarget = { 
                                     x: seller.x, 
                                     y: seller.y, 
                                     type: 'npc', 
                                     nick: `🏥 ${seller.name}`, 
                                     id: `npc_${seller.id}` 
                                 };
                             }
                         }
                     }
                }

            // 5. Map Rotation Logic & PvP Persistence
            // Handle Map Change
            if (!cachedMapId || cachedMapId !== state.map.id) {
                logger.info(`🗺️ -- New Map: ${state.map.id} --`);
                if (skippedMobs.size > 0) {
                    logger.log(`🗑️ Clearing blacklist (${skippedMobs.size} mobs) - map change!`);
                    skippedMobs.clear();
                }
                
                // Reset Selling Flag on map change so we sell again next time we visit a city
                soldItems = false;
                
                if (state.currentMapName && state.currentMapName !== currentMapName) {

                     if (currentMapName) {
                         lastMapName = currentMapName;
                         logger.log(`🗺️ [HISTORY] Last: '${lastMapName}' | Curr: '${state.currentMapName}'`);
                     }
                     currentMapName = state.currentMapName;
                     // Track visit time
                     mapHistory.set(currentMapName, Date.now());
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

            // Traversal logic moved up to 4.2

            
            // Skip gateway logic if within 4 second cooldown after map change
            // BUT: If traversing, we might want to move immediately? 
            // Let's stick to safety: wait for load.
            const mapCooldownActive = mapChangedAt && (Date.now() - mapChangedAt < 4000);
            if (mapCooldownActive && !state.target) {
                await sleep(500);
                continue; // Wait for mobs to load
            }
            
            let finalTarget = resupplyTarget || state.target;

            // --- 0. Persistence Checks (Escape / Locked) ---
             if (escapeTarget) {
                 const dist = Math.hypot(escapeTarget.x - state.hero.x, escapeTarget.y - state.hero.y);
                 const now = Date.now();
                 
                 // Check if escape timer expired OR we reached the gateway
                 if ((escapeTarget.escapeUntil && now > escapeTarget.escapeUntil) || dist < 1.5) {
                     logger.log('✅ Escape complete.');
                     escapeTarget = null;
                 } else {
                     // Keep escaping - IGNORE all mobs!
                     logger.log(`🏃 ESCAPING (${((escapeTarget.escapeUntil - now)/1000).toFixed(1)}s left): Moving to gateway (${dist.toFixed(1)}m)`);
                     finalTarget = escapeTarget;
                 }
            }

            // =========================================================================
            // HUNTING MODE LOGIC (Only if NOT traversing)
            // =========================================================================
            if (!isTraversing && !escapeTarget && !resupplyTarget) {

                // --- OPPORTUNISTIC ATTACK (Priority: HIGH) ---
                if (state.validMobs && state.validMobs.length > 0) {
                     const closestMob = state.validMobs[0];
                     if (closestMob.dist <= 1.5) {
                          if (!finalTarget || finalTarget.id !== closestMob.id) {
                               logger.log(`⚔️ OPTN: Engaging neighbour [${closestMob.nick}] (${closestMob.dist.toFixed(1)}m)!`);
                               finalTarget = closestMob;
                               lockedTarget = null;
                          }
                     }
                }
                
                // --- PATH-BASED TARGET SELECTION ---
                if (!lockedTarget && (!finalTarget || finalTarget.dist > 1.5) && state.validMobs && state.validMobs.length > 0) {
                    const pathOptimalTarget = movement.findBestTarget(state);
                    if (pathOptimalTarget) {
                        // Efficiency Check
                        if (state.validMobs.length <= 8 && pathOptimalTarget.pathLength > 60) {
                            logger.log(`📉 Low mob count & Far target. Skipping map.`);
                            finalTarget = null; 
                        } else {
                            finalTarget = pathOptimalTarget;
                        }
                    } else {
                        logger.warn(`🚫 All nearby mobs are unreachable! Initiating map change...`);
                        finalTarget = null;
                    }
                }

                // --- Target Lock Detection ---
                if (finalTarget && finalTarget.type === 'mob') {
                    const currentTargetId = finalTarget.id;
                    if (lastTargetId && lastTargetId !== currentTargetId) {
                        targetSwitchCount++;
                        positionHistory = []; 
                    } else {
                        targetSwitchCount = Math.max(0, targetSwitchCount - 1); 
                    }
                    lastTargetId = currentTargetId;
                    noAttackCounter++;
                    
                    if (targetSwitchCount > 3) {
                        logger.warn(`🔒 TARGET LOCK: Oscillation detected! Locking to [${finalTarget.nick}]`);
                        lockedTarget = { ...finalTarget, lockedAt: Date.now() };
                        targetSwitchCount = 0;
                        noAttackCounter = 0;
                    }
                }
                
                // Apply Lock
                if (lockedTarget) {
                    const lockAge = Date.now() - lockedTarget.lockedAt;
                    const dist = Math.hypot(lockedTarget.x - state.hero.x, lockedTarget.y - state.hero.y);
                    
                    if (state.target && state.target.id === lockedTarget.id) {
                         lockedTarget.x = state.target.x;
                         lockedTarget.y = state.target.y;
                    }

                    if (dist < 1.5 || lockAge > 8000) {
                        logger.log('🔓 Target lock released.');
                        lockedTarget = null;
                        noAttackCounter = 0;
                    } else {
                        finalTarget = lockedTarget;
                    }
                }

                // --- PvP Ghost Target Logic ---
                if (state.pvp && !lockedTarget) {
                     if (finalTarget && finalTarget.type === 'mob') {
                         ghostTarget = { ...finalTarget, timestamp: Date.now() };
                     } else if (!finalTarget && ghostTarget) {
                         const timeSince = Date.now() - ghostTarget.timestamp;
                         if (timeSince < 5000) { 
                               const dist = Math.hypot(ghostTarget.x - state.hero.x, ghostTarget.y - state.hero.y);
                               if (dist < 1.5) {
                                   ghostTarget = null;
                               } else {
                                   finalTarget = ghostTarget;
                               }
                         } else {
                               ghostTarget = null; 
                         }
                     }
                }
            } else {
                // If TRAVERSING - clear any Mob target aggressively
                if (finalTarget && finalTarget.type === 'mob') {
                    // logger.log('🚫 Traversing Mode: Ignoring mob target.');
                    finalTarget = null;
                }
            }

            // --- Oscillation / Loop Detection ---
            positionHistory.push({ x: Math.round(state.hero.x), y: Math.round(state.hero.y) });
            if (positionHistory.length > 20) positionHistory.shift();
            
            const isFighting = finalTarget && finalTarget.type === 'mob' && finalTarget.dist <= 1.5;

            if (finalTarget && positionHistory.length >= 20 && !escapeTarget && !isFighting) {
                const uniquePos = new Set(positionHistory.map(p => `${p.x},${p.y}`));
                
                if (uniquePos.size < 12) { 
                     // Only blacklist mobs if we were actually hunting
                     if (!isTraversing && finalTarget && finalTarget.type === 'mob' && finalTarget.id) {
                         logger.warn(`🚫 BLACKLISTING mob [${finalTarget.nick}] (ID: ${finalTarget.id}) - unreachable!`);
                         skippedMobs.set(finalTarget.id, Date.now());
                     }
                     
                     const escapeDuration = 10000 + Math.floor(Math.random() * 5000); 
                     logger.warn(`⚠️ LOOP DETECTED (${uniquePos.size} tiles)! Forcing ESCAPE...`);
                     
                     const gwWithDist = state.gateways.map(gw => ({
                         ...gw,
                         dist: Math.hypot(gw.x - state.hero.x, gw.y - state.hero.y)
                     }));
                     
                     const farGateways = gwWithDist.filter(g => g.dist > 25);
                     let chosenGw = farGateways.length > 0 
                        ? farGateways.sort((a,b) => b.dist - a.dist)[0]
                        : gwWithDist.sort((a,b) => a.dist - b.dist)[0];
                     
                     if (chosenGw) {
                         escapeTarget = { 
                             ...chosenGw, 
                             type: 'gateway', isGateway: true, nick: 'ESCAPE LOOP',
                             escapeUntil: Date.now() + escapeDuration 
                         };
                         finalTarget = escapeTarget;
                         positionHistory = [];
                     }
                }
            }

            // =========================================================================
            // NAVIGATION / GATEWAY LOGIC
            // =========================================================================
            if (!finalTarget) {
                 if (!isTraversing) {
                     // IDLE in Hunting Map
                     // logger.log(`💤 IDLE | Mobs: ${state.debugInfo.allMobsCount}`);
                 } else {
                     // TRAVERSING MODE
                 }
                 
                 // --- GLOBAL NAVIGATION (If Traversing) ---
                 if (isTraversing) {
                       const route = mapNav.findPath(currentMapName, mapsList);
                       if (route && route.nextMap) {
                           // Find ALL gateways matching the target name
                           // Prioritize exact matches, but allow fuzzy fallback
                           let candidates = state.gateways.filter(g => g.name === route.nextMap);
                           
                           if (candidates.length === 0) {
                               candidates = state.gateways.filter(g => 
                                   g.name.toLowerCase().includes(route.nextMap.toLowerCase()) || 
                                   route.nextMap.toLowerCase().includes(g.name.toLowerCase())
                               );
                           }
                           
                           // Sort candidates by distance to Hero
                           candidates.sort((a, b) => {
                               const distA = Math.hypot(a.x - state.hero.x, a.y - state.hero.y);
                               const distB = Math.hypot(b.x - state.hero.x, b.y - state.hero.y);
                               return distA - distB;
                           });

                           let gw = null;
                           // Pick the first one that is strictly reachable
                           for (const candidate of candidates) {
                               if (movement.isReachable(state, candidate.x, candidate.y)) {
                                   gw = candidate;
                                   break;
                               }
                           }
                           
                           // Fallback: If none are reachable, pick the closest one anyway
                           if (!gw && candidates.length > 0) {
                               gw = candidates[0];
                               logger.warn(`⚠️ No reachable gateway found for ${route.nextMap}. Defaulting to closest: ${gw.name} (${gw.x},${gw.y})`);
                           }

                           if (gw) {
                                // Ensure we update finalTarget
                               const fullRoute = route.fullPath ? route.fullPath.join(' -> ') : 'unknown';
                               
                               // Log only if changed to avoid spam
                               if (!finalTarget || finalTarget.x !== gw.x || finalTarget.y !== gw.y) {
                                    logger.log(`🌍 Global Travel: [${fullRoute}] (Dist: ${route.distance})`);
                                    logger.log(`🚪 Gateway Selected: [${gw.name}] at [${gw.x},${gw.y}]`);
                               }
                               finalTarget = { ...gw, type: 'gateway', isGateway: true, nick: `>> ${gw.name}` };
                           } else {
                               logger.warn(`⚠️ Path found to ${route.nextMap}, but gateway is unreachable!`);
                           }
                           } else {
                               if (Math.random() < 0.05) logger.warn(`⚠️ Navigation: Should go to '${route.nextMap}', but gateway not found.`);
                           }
                   }
                  
                  // --- LOCAL GATEWAY LOGIC (Only if NO target yet) ---
                  if (!finalTarget) {
                      
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
                           // 2. Prioritize: Unvisited > Oldest Visit > Nearest
                           // AND MUST BE REACHABLE
                           
                           const scoredGateways = validGateways.map(g => {
                               const gName = g.name;
                               let lastVisit = 0;
                               
                               // Try to find if we visited this map
                               for (const [vMap, time] of mapHistory.entries()) {
                                   if (gName.toLowerCase().includes(vMap.toLowerCase().trim()) || 
                                       vMap.toLowerCase().includes(gName.toLowerCase().trim())) {
                                       lastVisit = time;
                                       break;
                                   }
                               }
                               
                               return {
                                   ...g,
                                   lastVisit: lastVisit, // 0 = never visited (Priority 1)
                                   dist: Math.hypot(g.x - state.hero.x, g.y - state.hero.y)
                               };
                           });
                           
                           // Sort:
                           // 1. Has it been visited? (0 is best)
                           // 2. If both visited, Oldest timestamp is best (Ascending)
                           // 3. Distance (Ascending)
                           const sorted = scoredGateways.sort((a,b) => {
                               if (a.lastVisit !== b.lastVisit) {
                                   return a.lastVisit - b.lastVisit; // 0 comes first, then older timestamps (smaller numbers)
                               }
                               return a.dist - b.dist; // Nearest fallback
                           });

                           for (const candidate of sorted) {
                               if (movement.isReachable(state, candidate.x, candidate.y)) {
                                   gw = candidate;
                                   const status = candidate.lastVisit === 0 ? "🆕 Unvisited" : `🕒 ${(Date.now() - candidate.lastVisit)/1000}s ago`;
                                   logger.log(`   ✅ Best Gateway found: ${gw.name} (${status}, ${candidate.dist.toFixed(1)}m)`);
                                   break;
                               } else {
                                   logger.warn(`   ⚠️ Skipping Gateway: ${candidate.name} (Unreachable/Blocked)`);
                               }
                           }
                       } 
                      
                       // Fallback 1: Allow backtracking to a configured map (MUST BE REACHABLE)
                       if (!gw) {
                            gw = state.gateways.find(g => {
                                if (!g.name) return false;
                                // Must be in config AND reachable
                                const inConfig = mapsList.some(m => g.name.toLowerCase().includes(m.toLowerCase().trim()));
                                return inConfig && movement.isReachable(state, g.x, g.y);
                            });
                            if (gw) logger.log(`   🔙 Backtracking to Configured Map: ${gw.name}`);
                       }

                       // Fallback 2: Return to Last Map (Escape Dead End) - MUST BE REACHABLE
                       if (!gw && lastMapName) {
                            gw = state.gateways.find(g => {
                                const isLast = g.name.toLowerCase().trim() === lastMapName.toLowerCase().trim();
                                return isLast && movement.isReachable(state, g.x, g.y);
                            });
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
                                }).find(g => movement.isReachable(state, g.x, g.y)) || notLast[0]; // Fallback to [0] if all unreachable
                                
                                logger.log(`   🆘 PANIC: Taking random gateway (Not Last): ${gw.name}`);
                           } else {
                                // Just take the nearest one
                                gw = state.gateways.sort((a,b) => {
                                    const distA = Math.hypot(a.x - state.hero.x, a.y - state.hero.y);
                                    const distB = Math.hypot(b.x - state.hero.x, b.y - state.hero.y);
                                    return distA - distB;
                                }).find(g => movement.isReachable(state, g.x, g.y)) || state.gateways[0]; // Fallback 
                                
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
