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
const TRAVEL_OVERRIDES = require('./data/travel_overrides');
const MONSTERS = require('./data/monsters');

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
    let soldItems = false;
    let lastShopVisit = 0; 
    let deadCloseAttempts = 0;
    let blockingWindowAttempts = 0;
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
    let sameTargetAttackCount = 0; // NEW: Counter for consecutive attacks on same target
    let lastAttackTargetId = null;

    // --- Cached Map Data ---
    let cachedMapId = null;
    let mapChangedAt = 0; // Cooldown timer

    logger.success('✅ Bot ready! Starting main loop.');

    // --- Main Loop ---
    const allMapNames = mapNav.getMapNames();

    while (true) {
        try {
        // Inject UI (returns current config state)
        const uiState = await ui.injectUI(page, config.DEFAULT_CONFIG, HUNTING_SPOTS, allMapNames, MONSTERS); // Cleaned
        
        const mode = uiState.mode || 'exp';
        const transportTarget = uiState.transportMap;

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
            
            // DEBUG: Inventory Log
            if (state.inventory) {
                if (Math.random() < 0.05) { 
                     logger.info(`🎒 Inventory Status: ${state.inventory.used} / ${state.inventory.capacity} (Full? ${state.inventory.isFull})`);
                }
            }

            // 3.9. BLOCKING WINDOW CHECK (Centerbox/Shop)
            if (state.blockingWindow) {
                 blockingWindowAttempts++;
                 logger.log(`🛑 Blocking window detected (${blockingWindowAttempts}/10). Closing...`);
                 
                 if (blockingWindowAttempts >= 10) {
                      logger.warn('🛑 Failed to close blocking window. Force Reloading...');
                      try {
                          await page.reload({ waitUntil: 'domcontentloaded' });
                      } catch (e) { logger.error("Reload failed", e); }
                      blockingWindowAttempts = 0;
                      await sleep(5000);
                      continue;
                 }

                 await actions.closeBlockingWindow(page);
                 await sleep(500); 
                 continue;
            } else {
                 blockingWindowAttempts = 0;
            }

            // 4.0. DEAD CHECK (Close Battle Window logic improved)
            if (state.isDead) { 
                 deadCloseAttempts++;
                 logger.log(`💀 Hero Dead. Attempting to close battle window (${deadCloseAttempts}/5)...`);
                 
                 if (deadCloseAttempts >= 5) {
                      logger.warn('💀 Failed to close battle window after multiple attempts. Force Reloading...');
                      try { await page.reload({ waitUntil: 'domcontentloaded' }); } 
                      catch (e) {}
                      deadCloseAttempts = 0;
                      await sleep(5000);
                      continue; 
                 }
                 
                 await actions.closeBattle(page);
                 await sleep(1000); 
                 continue;
            } else {
                 if (state.hero && state.hero.hp > 0) deadCloseAttempts = 0; 
            }

            if (state.battle) {
                 if (state.battleFinished) {
                      logger.log('⚔️ Battle finished. Closing...');
                      await actions.closeBattle(page);
                      await sleep(500);
                      continue;
                 }

                 if (state.hero && state.hero.hp === 0) {
                     continue; 
                 }

                 const result = await actions.attack(page, { nick: 'Battle' }, lastAttackTime);
                 lastAttackTime = result;
                 await sleep(200); 
                 continue;
            }

            // 4.1. UNCONSCIOUS CHECK (Death)
            if (state.dazed && state.dazed.active) {
                 const waitSeconds = state.dazed.seconds || 5;
                 const reloadThreshold = Math.floor(Math.random() * 6) + 10;
                 if (waitSeconds > reloadThreshold + 2) {
                     const timeToWait = waitSeconds - reloadThreshold;
                     logger.warn(`💀 Unconscious. Respawn in ${waitSeconds}s. Waiting ${timeToWait}s to Auto-Reload...`);
                     await sleep(timeToWait * 1000);
                     logger.log(`🔄 Auto-Reloading page (Respawn in ~${reloadThreshold}s)...`);
                     try {
                         await page.reload({ waitUntil: 'domcontentloaded' });
                     } catch (e) {
                         logger.error("Reload failed, continuing...", e);
                     }
                     await sleep(5000); 
                     continue; 
                 } else {
                     logger.warn(`💀 Unconscious. Respawn in ${waitSeconds}s. Waiting...`);
                     const sleepTime = Math.min(waitSeconds * 1000 + 1000, 5000); 
                     await sleep(sleepTime); 
                     continue;
                 }
            }

            // Determine Target Map Index & Travel Mode
            let mapsList = currentConfig.maps || [];
            let currentIndex = -1;

            // --- TRANSPORT MODE OVERRIDE ---
            if (mode === 'transport') {
                if (transportTarget) {
                    mapsList = [transportTarget]; // Force single map
                    logger.log(`🚚 TRANSPORT MODE: Destination -> ${transportTarget}`);
                }
            } else if (mode === 'monster') {
                if (uiState.monsterTarget) {
                    mapsList = [uiState.monsterTarget.map];
                    logger.log(`👹 MONSTER MODE: Hunting [${uiState.monsterTarget.name}] at ${uiState.monsterTarget.map} (${uiState.monsterTarget.x},${uiState.monsterTarget.y})`);
                }
            }

            const currentMapNorm = state.currentMapName ? state.currentMapName.toLowerCase().trim() : "";
            
            if (mapsList.length > 0 && currentMapNorm) {
                for (let i = 0; i < mapsList.length; i++) {
                    if (currentMapNorm.includes(mapsList[i].toLowerCase().trim())) {
                        currentIndex = i; 
                        break;
                    }
                }
            }
            
            // --- TRAVERSING MODE CHECK ---
            // In Transport Mode, if we are NOT at the target (currentIndex === -1), we are traversing.
            // If we ARE at the target (currentIndex !== -1), we stop.
            const isTraversing = (currentIndex === -1) && (mapsList.length > 0);
            
            // Stop if reached destination in transport mode
            if (mode === 'transport' && !isTraversing) {
                // Find "Zakonnik Planu Astralnego" or specific target NPC
                let arrivalTarget = null;
                
                // 1. Search for Zakonnik
                const zakonnik = await page.evaluate(() => {
                     if (!g || !g.npc) return null;
                     for (let id in g.npc) {
                         const n = g.npc[id];
                         if (n.nick && n.nick.includes('Zakonnik Planu Astralnego')) {
                             return { x: n.x, y: n.y, nick: n.nick, id: n.id };
                         }
                     }
                     return null;
                });

                if (zakonnik) {
                     arrivalTarget = { ...zakonnik, type: 'npc' };
                     const dist = Math.hypot(zakonnik.x - state.hero.x, zakonnik.y - state.hero.y);
                     if (dist > 2.0) {
                         logger.log(`🏁 Destination Reached! Moving to ${zakonnik.nick}...`);
                         await actions.move(page, state, arrivalTarget);
                         await sleep(500);
                         continue;
                     }
                } else {
                     // 2. Move to Center if no Zakonnik
                     const centerX = Math.floor(state.map.w / 2);
                     const centerY = Math.floor(state.map.h / 2);
                     const distToCenter = Math.hypot(centerX - state.hero.x, centerY - state.hero.y);
                     
                     if (distToCenter > 4.0) {
                         logger.log(`🏁 Destination Reached! Moving to Map Center [${centerX},${centerY}]...`);
                         await actions.move(page, state, { x: centerX, y: centerY, nick: 'Map Center' });
                         await sleep(500);
                         continue;
                     }
                }

                logger.success(`✅ TRANSPORT COMPLETE: Arrived at ${transportTarget} (Near ${zakonnik ? 'Zakonnik' : 'Center'}). Idling...`);
                // Prevent infinite log spam
                await sleep(5000);
                continue;
            }

            // Stop if reached destination in monster mode
            if (mode === 'monster' && !isTraversing && uiState.monsterTarget) {
                 const mTarget = uiState.monsterTarget;
                 const dist = Math.hypot(mTarget.x - state.hero.x, mTarget.y - state.hero.y);

                 if (dist > 2.0) {
                      logger.log(`👹 Reached Map! Moving to Monster [${mTarget.x}, ${mTarget.y}]...`);
                      await actions.move(page, state, { x: mTarget.x, y: mTarget.y, nick: mTarget.name });
                      await sleep(500);
                      continue;
                 } else {
                      logger.success(`✅ MONSTER ARRIVAL: Arrived at ${mTarget.name} location. Switching to IDLE.`);
                      await sleep(5000);
                      continue;
                 }
            }

            // --- EMERGENCY FULL BAG STRATEGY ---
            if (mode === 'exp' && state.inventory && state.inventory.isFull && state.hero.lvl >= 70) {
                 const inKwieciste = state.currentMapName === 'Kwieciste Przejście';
                 const inDomTunii = state.currentMapName === 'Dom Tunii';
                 
                 // CASE 1: Need to Teleport (Not there yet)
                 if (state.inventory.teleportScrollId && !inKwieciste && !inDomTunii) {
                     logger.warn("🎒 BAG FULL & LVL 70+ & SCROLL DETECTED! Initiating Emergency Sell Procedure...");
                     
                     // 1. Use Teleport
                     logger.log("📜 Using Teleport Scroll to Kwieciste Przejście...");
                     await actions.useItem(page, state.inventory.teleportScrollId);
                     await sleep(4000); 
                     
                     // 2. Wait for Map Load
                     let retries = 0;
                     while(retries < 10) {
                         const s = await gameState.getGameState(page, currentConfig);
                         if (s && s.currentMapName === 'Kwieciste Przejście') break;
                         await sleep(1000);
                         retries++;
                     }
                 }
                 
                 // CASE 2: Already in Kwieciste (Just Arrived OR Loop Recovery)
                 const currentState = await gameState.getGameState(page, currentConfig);
                 if (currentState.currentMapName === 'Kwieciste Przejście') {
                      logger.log("🚶 Navigating to 'Dom Tunii'...");
                      
                      // Find Gateway
                      let gateway = currentState.gateways.find(g => g.name.toLowerCase().includes('dom tunii'));
                      if (!gateway) {
                           // Refresh state just in case
                           await sleep(1000);
                           const refresh = await gameState.getGameState(page, currentConfig);
                           gateway = refresh.gateways.find(g => g.name.toLowerCase().includes('dom tunii'));
                      }

                      if (gateway) {
                          // Force move to gateway even if logic thinks otherwise
                          await actions.move(page, currentState, gateway);
                          
                          // Wait for transition
                          await sleep(3000);
                      } else {
                          logger.error("❌ Gateway 'Dom Tunii' not found!");
                      }
                 }
                 
                 // CASE 3: In Dom Tunii (Process Trade)
                 const domState = await gameState.getGameState(page, currentConfig); // Fresh state
                 if (domState.currentMapName === 'Dom Tunii') {
                      logger.success("✅ Entered Dom Tunii.");
                      
                      const tunia = await page.evaluate(() => {
                           for (let id in g.npc) { // Type 1 check handled by raw iteration
                               if (g.npc[id].nick === 'Tunia Frupotius') return g.npc[id];
                           }
                           return null;
                      });
                      
                      if (tunia) {
                           logger.log("💰 Found Tunia Frupotius. Initiating Trade...");
                           await actions.move(page, domState, { x: tunia.x, y: tunia.y });
                           await sleep(1000);
                           
                           await shopping.performSell(page);
                           await sleep(1000);
                           
                           const stateAfterSell = await gameState.getGameState(page, currentConfig);
                           await shopping.buyPotions(page, stateAfterSell);
                           
                           logger.success("✅ Emergency Sell/Resupply Logic Complete. Returning to Exp...");
                           // Logic falls through to next loop iteration which will trigger 'Traversing' back to exp
                      } else {
                          logger.error("❌ Tunia Frupotius not found in Dom Tunii!");
                      }
                 }
            }

                // 4.2. RESUPPLY CHECK (Healer / Potions)
                // USER REQUIREMENT: Only resupply if we are in a CITY.
                // Added Cooldown to prevent loops (Ithan -> Shop -> Traverse -> Ithan -> Shop...)
                
                let resupplyTarget = null;
                const isCityMap = SHOPKEEPERS.some(s => s.map === state.currentMapName);

                // Conditions:
                // 1. In City
                // 2. Cooldown expired OR Critical Need
                const RESUPPLY_COOLDOWN = 8 * 60 * 1000; // 8 minutes
                const timeSinceShop = Date.now() - lastShopVisit;
                const hpPercent = state.hero.hp / state.hero.maxhp;
                
                // Critical needs (ignore cooldown)
                let isCriticalHp = hpPercent < 0.35;
                let isCriticalPots = state.potionsCount < 5; // Almost empty
                
                // --- MODE SPECIFIC RULES ---
                let allowSelling = true;
                if (mode === 'transport') {
                    allowSelling = false; // Disable selling
                    isCriticalHp = hpPercent < 0.10; // Only heal if < 10%
                    isCriticalPots = false; // Don't buy potions
                }

                // Should we resupply?
                const shouldResupply = isCityMap && (
                    (timeSinceShop > RESUPPLY_COOLDOWN && mode !== 'transport') || 
                    isCriticalHp || 
                    (isCriticalPots && mode !== 'transport')
                );

                if (state.hero.maxhp > 0 && shouldResupply) { 
                    
                    // --- 1. ALWAYS SELL TRASH FIRST (if needed) ---
                    if (!soldItems && allowSelling) {
                        const shopkeeper = SHOPKEEPERS.find(s => s.map === state.currentMapName);
                        if (shopkeeper) {
                            const dist = Math.hypot(shopkeeper.x - state.hero.x, shopkeeper.y - state.hero.y);
                             
                            // If close to shopkeeper, SELL!
                            if (dist < 2.0) {
                                logger.log(`💰 Reach Shopkeeper: ${shopkeeper.name}. Selling junk...`);
                                await shopping.performSell(page);
                                soldItems = true; 
                                lastShopVisit = Date.now(); // Update timer
                                await sleep(500);
                                continue; 
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
                    // Definition of "Need":
                    const stackSize = state.potionStackSize || 30;
                    const maxCapacity = stackSize * 14; 
                    const needsPotions = state.potionsCount < maxCapacity; // User wants full
                    
                    // Only go to healer if:
                    // A) We are critical HP/Pots
                    // B) We are NOT successfully selling right now (resupplyTarget null) AND we have sold items (or don't need to)
                    // C) We actually need something
                    
                    if ((isCriticalHp || needsPotions) && !resupplyTarget) {
                         
                         const seller = POTION_SELLERS.find(s => s.map === state.currentMapName);
                         if (seller) {
                             const dist = Math.hypot(seller.x - state.hero.x, seller.y - state.hero.y);
                             
                             if (dist < 2.0) {
                                 logger.log(`🏥 Reach Healer: ${seller.name}. Starting interaction...`);
                                 
                                 // 1. Heal
                                 await shopping.performHeal(page);
                                 await sleep(1000);
                                 
                                 // 2. Buy Potions
                                 await shopping.buyPotions(page, state);
                                 
                                 logger.log("✅ Resupply cycle finished. Resuming hunt...");
                                 resupplyTarget = null;
                                 soldItems = true; // Assume we are 'good' for now
                                 lastShopVisit = Date.now(); // Update timer
                                 
                                 await sleep(1000);
                                 continue; 
                             }
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
                } else if (isCityMap && !shouldResupply && isTraversing) {
                     // We are in city, navigating, and Cooldown is active -> IGNORE SHOP
                     // logger.log(`⏳ Shop Cooldown Active (${((RESUPPLY_COOLDOWN - timeSinceShop)/1000).toFixed(0)}s). Ignoring shop.`);
                }

            // 5. Map Rotation Logic & PvP Persistence
            // Handle Map Change
            if (!cachedMapId || cachedMapId !== state.map.id) {
                logger.info(`🗺️ -- New Map: ${state.map.id} --`);
                if (skippedMobs.size > 0) {
                    logger.log(`🗑️ Clearing blacklist (${skippedMobs.size} mobs) - map change!`);
                    skippedMobs.clear();
                }
                
                // Reset Selling Flag only if we are moving TO a hunting spot (dest is not a city?)
                // Or just simple cooldown? 
                // Let's keep it simple: If we visited a shop recently, don't reset immediately?
                // Actually, the issue is strictly the navigation loop causing re-entry.
                // If nav is fixed, we enter Ithan -> Go to Wioska -> Hunt. 
                // We won't re-enter Ithan unless we start new loop.
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
                     
                     // NEW: Strict Loop Detection (Auto-Reload for tight loops)
                     if (uniquePos.size <= 4) {
                         logger.warn(`⚠️ EXTREME LOOP DETECTED (${uniquePos.size} unique tiles). Force Reloading to break glitch...`);
                         try { await page.reload({ waitUntil: 'domcontentloaded' }); } catch (e) {}
                         positionHistory = [];
                         await sleep(5000);
                         continue;
                     }

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
                       
                       // --- OVERRIDE LOGIC START ---
                       if (route) {
                           for (const override of TRAVEL_OVERRIDES) {
                               // 1. Are we in the matching Start Map?
                               if (currentMapName === override.fromMap) {
                                   
                                   // 2. Is our DESTINATION the target? (Check if any map in config matches override target)
                                   // Fuzzy match: e.g. "Wioska Gnolli" in ["Wioska Gnolli", "Jaskinia..."]
                                   const isDestination = mapsList.some(m => m.includes(override.targetMap));
                                   
                                   if (isDestination) {
                                        // 3. Condition Check (Last Map)
                                        if (override.requiredLastMap) {
                                            if (lastMapName !== override.requiredLastMap) {
                                                logger.warn(`🔀 OVERRIDE: [${currentMapName}] -> Redirecting to '${override.redirect}' (Avoid blocked path)`);
                                                route.nextMap = override.redirect;
                                                break; 
                                            }
                                        } else {
                                            // Unconditional Override
                                           logger.log(`🔀 OVERRIDE: [${currentMapName}] -> Forcing detour to '${override.redirect}'`);
                                           route.nextMap = override.redirect;
                                           break;
                                        }
                                   }
                               }
                           }
                       }
                       // --- OVERRIDE LOGIC END ---

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
                            // NEW: Ghost Mob Detection
                            if (finalTarget.id === lastAttackTargetId) {
                                sameTargetAttackCount++;
                            } else {
                                sameTargetAttackCount = 1;
                                lastAttackTargetId = finalTarget.id;
                            }

                            if (sameTargetAttackCount > 8) {
                                logger.warn(`⚠️ Stuck attacking [${finalTarget.nick}] (${sameTargetAttackCount} times). Ghost mob/Bug detected. Force Reloading...`);
                                try { await page.reload({ waitUntil: 'domcontentloaded' }); } catch(e) {}
                                sameTargetAttackCount = 0;
                                await sleep(5000);
                                continue;
                            }

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
