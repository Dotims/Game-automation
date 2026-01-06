// Suppress TimeoutOverflowWarning from Margonem game code
process.on('warning', (warning) => {
    if (warning.name === 'TimeoutOverflowWarning') return; // Ignore
    console.warn(warning.name, warning.message);
});

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
const GATEWAY_OVERRIDES = require('./data/gateway_overrides');
const MONSTERS = require('./data/monsters');
const { sleep } = require('./utils/sleep');

// Global Flags
// Global Flags
// (Moved to local scope in main)

async function main() {
    // DEBUG: Verify Env Var
    const envNick = process.env.CHARACTER_NICK;
    logger.log(`🔧 Bot Startup. Configured Nick: "${envNick || 'UNDEFINED/EMPTY'}"`);

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

    // --- WAIT FOR USER TO NAVIGATE TO GAME (Proxy/Login) ---
    logger.log('⏳ Waiting for Margonem game to be active in browser...');
    while (true) {
        if (page.url().includes('margonem.pl') && !page.url().includes('login')) {
            // Basic check if map is loaded (optional, but good)
            const mapLoaded = await page.evaluate(() => typeof map !== 'undefined' && map.id);
            if (mapLoaded) {
                logger.success('✅ Margonem game detected! Starting bot...');
                break;
            }
        }
        
        // Check all tabs across ALL browser contexts (for multi-profile support)
        const allContexts = browser.contexts();
        let allPages = [];
        for (const ctx of allContexts) {
            allPages = allPages.concat(ctx.pages());
        }
        const detectedGamePages = allPages.filter(p => p.url().includes('margonem.pl') && !p.url().includes('login'));

        const targetNick = process.env.CHARACTER_NICK; // Optional: Specific nick to target
        let breakOuter = false;

        for (const candidatePage of detectedGamePages) {
             // Check if map/hero is loaded
             try {
                const gameInfo = await candidatePage.evaluate(() => {
                    if (typeof map === 'undefined' || !map.id || typeof hero === 'undefined') return null;
                    return { mapId: map.id, nick: hero.nick };
                });

                if (gameInfo) {
                    // Match Logic (Lenient)
                    const onPageNick = gameInfo.nick.trim();
                    const targetNickClean = targetNick ? targetNick.trim() : null;

                    // If target nick is specified, enforce match (Case Insensitive)
                    if (targetNickClean && onPageNick.toLowerCase() !== targetNickClean.toLowerCase()) {
                        // Only log mismatch once per unique nick to avoid spam
                        // (implied by the verbose log below)
                        continue;
                    }

                    // MATCH FOUND!
                    page = candidatePage;
                    logger.success(`✅ Found active game tab! Hero: "${onPageNick}" Map: ${gameInfo.mapId}`);
                    await page.bringToFront();
                    
                    // Break outer loop
                    breakOuter = true; 
                    break;
                }
             } catch (e) {
                 // Ignore evaluation errors on loading pages
             }
        }
        
        if (breakOuter) break;

        // Verbose log every 5 seconds (modulo)
        if (Date.now() % 5000 < 2100) {
            const seenNicks = [];
            for (const p of detectedGamePages) {
                try {
                    const n = await p.evaluate(() => typeof hero !== 'undefined' ? hero.nick : 'Loading...');
                    seenNicks.push(n);
                } catch (e) { seenNicks.push('Error'); }
            }
            logger.log(`🔎 Scanning. Tabs: ${detectedGamePages.length}. Seen Nicks: [${seenNicks.join(', ')}]. Target: "${targetNick}"`);
        }

        await sleep(2000);
    }


    // Capture Browser Console Logs (Debugging Healing) - DISABLED to reduce spam
    /*
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[AutoHeal]') || text.includes('Error')) {
             logger.log(`🖥️ PAGE: ${text}`);
        }
    });
    */

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
    
    // Log throttling state
    let monsterModeLoggedMap = null; // Track last map where we logged "Hunting..."
    let lastPausedLogTime = 0;
    let lastWaitingLogTime = 0; // NEW: For "Waiting for E2"
    let lastEngagedMobId = null; // NEW: To prevent "E2 DETECTED" spam
    
    // Anti-AFK State
    let lastActionTime = Date.now();
    let afkThreshold = (Math.floor(Math.random() * 4) + 2) * 60 * 1000; // 2-5 min

    // Teleport Return After Death (Level 70+)
    let needsTeleportReturn = false;
    let lastTuniaTrade = 0; // Cooldown to prevent trade loop
    let wasDeadLastLoop = false;

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
                if (Date.now() - lastPausedLogTime > 15000) {
                     if (Date.now() % 5000 < 500) {
                         logger.info('💤 Bot paused. Click START in game UI.');
                         lastPausedLogTime = Date.now();
                     }
                }
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
            
            // DEBUG: Inventory Log (Once per session)
            if (state.inventory && !global.hasLoggedInventory) {
                 logger.info(`🎒 Inventory Status: Used: ${state.inventory.used} | Free: ${state.inventory.free} | Total: ${state.inventory.capacity} (Full? ${state.inventory.isFull})`);
                 logger.log(`    🔍 Debug bags: ${JSON.stringify(state.inventory._debug)}`);
                 logger.log(`    📜 TeleportScrollId: ${state.inventory.teleportScrollId || 'NOT FOUND'}`);
                 global.hasLoggedInventory = true;
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

            // --- TELEPORT RETURN AFTER RESPAWN (Level 70+) ---
            // Detect transition from dead/dazed to alive
            const currentlyDead = state.isDead || (state.dazed && state.dazed.active);
            if (wasDeadLastLoop && !currentlyDead && state.hero && state.hero.lvl >= 70) {
                 logger.info('🔄 Respawned! Level 70+ character - will use teleport return.');
                 needsTeleportReturn = true;
            }
            wasDeadLastLoop = currentlyDead;

            // --- REGULAR AUTO-HEAL ---
            // Call autoHeal every loop iteration to use potions efficiently
            if (state.potionsCount > 0 && state.hero.hp < state.hero.maxhp) {
                const healed = await actions.autoHeal(page);
                if (healed) {
                    logger.success(`💗 [${healed.nick || 'Unknown'}] Healed with ${healed.id} (Restored ~${healed.heal || '?'})`);
                    await sleep(300);
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
                    
                    // Throttle logging: Only log if map changed or different monster
                    const logKey = `${uiState.monsterTarget.name}_${state.currentMapName}`;
                    if (monsterModeLoggedMap !== logKey) {
                        logger.log(`👹 MONSTER MODE: Hunting [${uiState.monsterTarget.name}] at ${uiState.monsterTarget.map} (${uiState.monsterTarget.x},${uiState.monsterTarget.y})`);
                        monsterModeLoggedMap = logKey;
                    }
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

            // E2 MODE LOGIC
            // Stop if reached destination in monster mode
            if (mode === 'monster' && !isTraversing && uiState.monsterTarget) {
                 const mTarget = uiState.monsterTarget;
                 const distToTarget = Math.hypot(mTarget.x - state.hero.x, mTarget.y - state.hero.y);

                 // 1. Check if we have "arrived" (close enough)
                 // Or we are already on the map, so we just scan for the mob
                 
                 // 2. SCAN FOR MOB - USE allMobs (bypass validMobs filter)
                 // We look for any mob that matches the selected monster's name
                 let targetMob = null;
                 if (state.allMobs) {
                     // Fuzzy match nick or exact match
                     targetMob = state.allMobs.find(m => m.nick.includes(mTarget.name) || mTarget.name.includes(m.nick));
                 }
                 
                 if (targetMob) {
                     // --- MOB FOUND! ---
                     // Log only if it's a new mob ID or enough time passed (optional, but ID check is better for unique mobs)
                     if (lastEngagedMobId !== targetMob.id) {
                         logger.log(`👹 E2 DETECTED: [${targetMob.nick}] at (${targetMob.x}, ${targetMob.y})! Engaging...`);
                         lastEngagedMobId = targetMob.id;
                     }
                     
                     const distToMob = Math.hypot(targetMob.x - state.hero.x, targetMob.y - state.hero.y);
                     
                     if (distToMob <= 1.5) {
                         // ATTACK
                         await sleep(Math.floor(Math.random() * 150) + 50); // 50-200ms human delay
                         const result = await actions.attack(page, targetMob, lastAttackTime);
                         lastAttackTime = result;
                         lastActionTime = Date.now(); // Reset AFK timer
                         await sleep(Math.floor(Math.random() * 400) + 800); // 800-1200ms throttle
                         continue;
                     } else {
                         // APPROACH
                         await actions.move(page, state, { x: targetMob.x, y: targetMob.y, nick: targetMob.nick });
                         // Removed sleep(400) for fluid movement
                         continue;
                     }
                 } else {
                     // --- MOB NOT FOUND ---
                     
                     // Check if Battle just finished OR if we were engaging a mob that is now gone using allMobs check
                     // We check if lastEngagedMobId was set, and it's NOT in the current allMobs list
                     let mobDisappeared = false;
                     if (lastEngagedMobId) {
                         // Check if this specific ID still exists in allMobs
                         const stillExists = state.allMobs && state.allMobs.some(m => m.id === lastEngagedMobId);
                         if (!stillExists) {
                             mobDisappeared = true;
                             logger.log(`👻 Target [${lastEngagedMobId}] disappeared! Assuming defeated/stolen.`);
                             lastEngagedMobId = null; // Clear it so we don't trigger this loop again
                         }
                     }

                     // Only treat as "defeated" if we actually had an engagement or were in battle
                     const wasInCombat = state.battle || lastEngagedMobId !== null;
                     if (wasInCombat && (state.battleFinished || mobDisappeared)) {
                         logger.log(`⚔️ E2 DEFEATED/GONE! Moving randomly...`);
                         await actions.closeBattle(page);
                         lastEngagedMobId = null; // Clear after handling
                         // Trigger Random Move
                         const rx = Math.floor(state.hero.x + (Math.random() * 6 - 3));
                         const ry = Math.floor(state.hero.y + (Math.random() * 6 - 3));
                         
                         if (movement.isReachable(state, rx, ry)) {
                               await actions.move(page, state, { x: rx, y: ry, nick: 'Random (Post-Fight)' });
                         }
                         
                         // Fix: Heal after fight!
                         if (config.DEFAULT_CONFIG.autoHeal) await actions.autoHeal(page);
                         
                         await sleep(2000);
                         continue;
                     }

                     // If we are far from spawn point, return to it
                     if (distToTarget > 3.0) {
                         logger.log(`👹 Returning to spawn point [${mTarget.name}] (${mTarget.x},${mTarget.y})...`);
                         await actions.move(page, state, { x: mTarget.x, y: mTarget.y, nick: 'Spawn Point' });
                         // Removed sleep(1000) for fluid movement
                         continue;
                     } 
                     
                     // If we are close to spawn point and mob is not here -> IDLE / Random Wiggle?
                     // If we are close to spawn point and mob is not here -> IDLE / Check Anti-AFK
                     
                     // Anti-AFK Logic
                     if (Date.now() - lastActionTime > afkThreshold) {
                         // Find a valid random spot nearby (Retry up to 5 times)
                         let validMove = null;
                         const mw = state.map.w;
                         const col = state.map.col;
                         
                         for (let i = 0; i < 5; i++) {
                             const rx = Math.floor(state.hero.x + (Math.random() * 6 - 3));
                             const ry = Math.floor(state.hero.y + (Math.random() * 6 - 3));
                             
                             // Bounds check
                             if (rx < 0 || rx >= mw || ry < 0 || ry >= state.map.h) continue;
                             
                             // Collision check (if map data available)
                             let isBlocked = false;
                             if (col) {
                                 const idx = ry * mw + rx;
                                 if (col[idx] === '1') isBlocked = true;
                             }
                             
                             // Valid if not blocked AND not current pos
                             if (!isBlocked && (rx !== Math.round(state.hero.x) || ry !== Math.round(state.hero.y))) {
                                 validMove = { x: rx, y: ry };
                                 break;
                             }
                         }

                         if (validMove) {
                             logger.log(`💤 Anti-AFK: Idling for ${(afkThreshold/60000).toFixed(1)}m. Moving to (${validMove.x}, ${validMove.y})...`);
                             // Use 'move' (A*) just to be safe, but we pre-checked collision
                             await actions.move(page, state, { x: validMove.x, y: validMove.y, nick: 'Anti-AFK' });
                         } else {
                             logger.warn(`💤 Anti-AFK: Could not find valid nearby spot. Skipping move.`);
                         }
                         
                         lastActionTime = Date.now();
                         afkThreshold = (Math.floor(Math.random() * 4) + 2) * 60 * 1000; // Reset 2-5m
                         continue;
                     }

                     // Throttle "Waiting" log to every 10s
                     if (Date.now() - lastWaitingLogTime > 10000) {
                          logger.log(`👀 Waiting for E2 [${mTarget.name}]...`);
                          lastWaitingLogTime = Date.now();
                     }
                     await sleep(1000);
                     continue;
                 }
            }

            // --- TELEPORT RETURN (Level 70+ with Full Bag OR in City) ---
            // Trigger when:
            // 1. BAG IS FULL (from ANY location) -> Go to Dom Tunii
            // 2. OR in a city (Respawn) -> Go to Dom Tunii
            // 3. OR in Kwieciste/Dom Tunii AND Need Resupply -> Finish job
            const isCityWithShops = SHOPKEEPERS.some(s => s.map === state.currentMapName);
            const inKwieciste = state.currentMapName === 'Kwieciste Przejście';
            const inDomTunii = state.currentMapName === 'Dom Tunii';
            const hasTeleportScroll = state.inventory && state.inventory.teleportScrollId;
            const isBagFull = state.inventory && state.inventory.isFull;
            
            // Check needs
            // We need to import shopping if not available, or duplicate logic?
            // shopping is required at top.
            // We assume we need potions if not full stack? 
            // Simplified: If potionCount < target? 
            // Better to rely on isBagFull mainly. The user emphasized SELLING.
            // If Bag is NOT full, do we need to force Tunia? 
            // Only if we explicitly teleported there (previous state?).
            // But we don't have memory.
            // So: If in Kwieciste, go to Tunia ONLY IF Bag Full OR Potion Critical?
            
            const needsResupply = isBagFull; // Strict for now. If you need potions, normal resupply logic handles it?
            // Normal resupply logic (line 590) handles potions. But it uses local shopkeepers.
            // If Lvl 70+, we want Tunia for Potions too?
            // The user said: "prioritize teleport over local".
            
            // Let's use a simplified potion check if available in state
            // state.potionsCount is available.
            const LOW_POTIONS = 5; // minimal check
            const needsPotions = (state.potionsCount || 0) < LOW_POTIONS;

            const isTransitOrBase = inKwieciste || inDomTunii;
            const hasBusinessInBase = isBagFull || needsPotions;

            const shouldTeleportReturn = mode === 'exp' && 
                state.hero && state.hero.lvl >= 70 && 
                (
                    // Trigger 1: Full Bag Anywhere
                    (hasTeleportScroll && isBagFull) || 
                    // Trigger 2: City Respawn with Empty Bag? (Maybe we want to check potions?)
                    // If we respawned, we probably need potions.
                    (isCityWithShops && hasTeleportScroll) ||
                    // Trigger 3: In Transit/Base AND has business
                    (isTransitOrBase && hasBusinessInBase)
                );
            
            // Refined Check for safety:
            // If in Dom Tunii and NO Business, exit.
            const finalShouldTeleport = shouldTeleportReturn && !(inDomTunii && !hasBusinessInBase);

            // DEBUG: Show teleport check values
            if (global.lastTeleportCheck !== finalShouldTeleport) {
                 logger.log(`📜 TELEPORT CHECK: lvl=${state.hero?.lvl}, BagFull=${isBagFull}, Pots=${state.potionsCount}, Kwieciste=${inKwieciste}, Tunia=${inDomTunii}`);
                 logger.log(`   → Active: ${finalShouldTeleport}`);
                 global.lastTeleportCheck = finalShouldTeleport;
            }
            
            // Skip teleport if we just finished trading (30s cooldown)
            const tuniaCooldownActive = Date.now() - lastTuniaTrade < 30000;
            if (tuniaCooldownActive && (inKwieciste || inDomTunii)) {
                // logger.log('📜 Tunia Trade Cooldown Active. Skipping...');
            } else if (finalShouldTeleport) {
                 // CASE 1: Use Teleport (Only if NOT already there)
                 if (!inKwieciste && !inDomTunii) {
                     logger.warn(`🚀 LVL 70+ in CITY with SCROLL! Teleporting to Dom Tunii instead of local shopkeeper...`);
                     
                     // 1. Use Teleport
                     logger.log("📜 Using Teleport Scroll to Kwieciste Przejście...");
                     const used = await actions.useItem(page, state.inventory.teleportScrollId);
                     if (used) {
                         await sleep(4000); 
                         // Check result
                         const s = await gameState.getGameState(page, currentConfig);
                         if (s && s.currentMapName === 'Kwieciste Przejście') {
                             // We arrived. The loop will restart and hit CASE 2 next time.
                             continue;
                         }
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
                           // OPTIMIZATION: Target the closer tile (20,17) explicitly
                           if (gateway.x === 19 && gateway.y === 17) {
                               // logger.log("📍 Optimizing Gateway Target: (19,17) -> (20,17)");
                               gateway.x = 20;
                               gateway.y = 17;
                           }

                          // Force move to gateway even if logic thinks otherwise
                          await actions.move(page, currentState, gateway);
                          
                          // Wait for transition (Instant)
                          await sleep(50); 
                          continue; // Skip rest of loop (don't traverse to exp yet)
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
                           
                           // Optimized: Sell THEN Buy without closing window (Tunia has common window)
                           await shopping.performSell(page, true); // leaveOpen = true
                           await sleep(800);
                           
                           const stateAfterSell = await gameState.getGameState(page, currentConfig);
                           
                           // Buy Teleport Scrolls if running low (≤5 uses)
                           const teleportCount = stateAfterSell.inventory?.teleportScrollCount || 0;
                           if (teleportCount <= 5) {
                               logger.log(`📜 Low teleport scrolls (${teleportCount}). Buying 2 units...`);
                               await shopping.buyTeleportScrolls(page);
                               await sleep(500);
                           }
                           
                           await shopping.buyPotions(page, stateAfterSell, true); // skipOpen = true
                           
                           logger.success("✅ Emergency Sell/Resupply Logic Complete. Returning to Exp...");
                           lastTuniaTrade = Date.now(); // Set cooldown to prevent re-entry
                           continue; // IMPORTANT: Skip rest of loop to avoid re-triggering
                      } else {
                          logger.error("❌ Tunia Frupotius not found in Dom Tunii!");
                      }
                 }
            }
            // Reset flag after teleport procedure attempts (success or any path through the block)
            if (shouldTeleportReturn) {
                 needsTeleportReturn = false;
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
                // SKIP if teleport return is active (level 70+ respawn uses Dom Tunii instead)
                const shouldResupply = isCityMap && !shouldTeleportReturn && (
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
                
                // Set cooldown - wait 2.5s before making gateway decisions
                mapChangedAt = Date.now();
                logger.log('⏳ Waiting 2.5s for map data to load...');
            }

            // Traversal Logic: Calculate specific path to target map
            // SAFETY: If HP is Critical, PAUSE traversal to heal!
            if (state.hero.hp < state.hero.maxhp * 0.60 && state.potionsCount > 0) {
                 // But wait, if we are in loop, autoHeal is called at top. 
                 // We just need to stop moving.
                 logger.warn(`❤️ Critical HP (${(state.hero.hp/state.hero.maxhp*100).toFixed(0)}%)! Pausing traversal to heal...`);
                 await sleep(1000); 
                 // Explicitly call heal (redundant but safe)
                 await actions.autoHeal(page, state);
                 continue;
            }

            if (isTraversing && !resupplyTarget) {
                 // Try to find a path using graph
                 const pathData = mapNav.findPath(state.currentMapName, mapsList, state.hero.lvl);
                 
                 if (pathData && pathData.nextMap) {
                     // Find gateway to nextMap
                     // We need to match nextMap name to gateways. 
                     // normalizeName handles HTML tags, etc. match loosely
                     
                     // 1. Check for OVERRIDE
                     let gateway = null;
                     
                     if (GATEWAY_OVERRIDES[state.currentMapName] && GATEWAY_OVERRIDES[state.currentMapName][pathData.nextMap]) {
                         const ov = GATEWAY_OVERRIDES[state.currentMapName][pathData.nextMap];
                         logger.log(`⚠️ using GATEWAY OVERRIDE for ${pathData.nextMap}: [${ov.x}, ${ov.y}]`);
                         gateway = { x: ov.x, y: ov.y, name: `Override -> ${pathData.nextMap}`, type: 'gateway', isGateway: true };
                     }

                     // 2. Standard Search (if no override)
                     if (!gateway) {
                         gateway = state.gateways.find(g => 
                             g.name.toLowerCase().includes(pathData.nextMap.toLowerCase()) || 
                             pathData.nextMap.toLowerCase().includes(g.name.toLowerCase())
                         );
                     }
                     
                     if (gateway) {
                         // logger.log(`🧭 Traversing: ${state.currentMapName} -> ${pathData.nextMap} (Target: ${mapsList[0]})`);
                         // Only log if we are newly targeting this gateway?
                         // Let's just set it as resupplyTarget-like override
                         
                         // BUT: We want it to be finalTarget later.
                         // We can set it to a temporary var, we'll assign it to finalTarget if resupplyTarget is null.
                         
                         // We'll set a special flag or just use 'finalTarget' assignment directly?
                         // If we assign strictly here, we must ensure resupply check didn't already happen.
                         // But resupplyTarget is NULL here (checked in IF).
                         
                         // Ensure we don't spam logs
                         // logger.log(`🚶 Next Step: Gateway to [${gateway.name}]`);
                         
                         // We should treat this gateway as the PRIORITY target unless escape/locked
                         // Actually, let's treat it as "Nav Target"
                         
                         // NOTE: We should check if we are already close to it?
                         const dist = Math.hypot(gateway.x - state.hero.x, gateway.y - state.hero.y);
                         if (dist < 1.0) {
                             // We are ON the gateway. Just wait or move slightly?
                             // Usually game engine handles transfer.
                             // But sometimes we need to 'step' on it.
                         }
                         
                         // Override 'state.target' (auto-target) with this gateway
                         // But we construct 'finalTarget' below.
                         
                         // Let's add a `traversalTarget`
                         state.traversalTarget = gateway;
                     } else {
                         logger.warn(`⚠️ Traversing: Need to go to [${pathData.nextMap}], but no matching gateway found!`);
                         logger.warn(`   Available Gateways: ${state.gateways.map(g => `[${g.name} at ${g.x},${g.y}]`).join(', ')}`);
                     }
                 } else {
                     // No graph path found?
                     // Fallback to simple logic (handled later? or just sit?)
                     // logger.warn(`⚠️ No path found from ${state.currentMapName} to ${mapsList[0]}`);
                 }
            }

            
            // Skip gateway logic if within 4 second cooldown after map change
            // BUT: If traversing, we might want to move immediately? 
            // Let's stick to safety: wait for load.
            const mapCooldownActive = mapChangedAt && (Date.now() - mapChangedAt < 2500);
            if (mapCooldownActive && !state.target) {
                await sleep(500);
                continue; // Wait for mobs to load
            }
            
            let finalTarget = resupplyTarget || state.traversalTarget || state.target;

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
                        // --- SMART MAP SKIP LOGIC ---
                        // If few mobs left (<6), they are far (>35 steps), and gateway is nearby (<50% of mob distance), skip to next map
                        const mobCount = state.validMobs.length;
                        const mobDistance = pathOptimalTarget.pathLength || Infinity;
                        
                        if (mobCount < 6 && mobDistance > 35 && state.gateways && state.gateways.length > 0 && mapsList && mapsList.length > 0) {
                            // Find nearest gateway
                            let nearestGateway = null;
                            let nearestGwDist = Infinity;
                            
                            for (const gw of state.gateways) {
                                const gwDist = Math.hypot(gw.x - state.hero.x, gw.y - state.hero.y);
                                if (gwDist < nearestGwDist) {
                                    nearestGwDist = gwDist;
                                    nearestGateway = gw;
                                }
                            }
                            
                            // Check if gateway is within 50% of mob distance (much closer)
                            if (nearestGateway && nearestGwDist < mobDistance * 0.5) {
                                logger.log(`⏩ SMART SKIP: ${mobCount} mobs left, closest is ${mobDistance} steps away. Gateway is only ${Math.round(nearestGwDist)} tiles away. Skipping to next map...`);
                                
                                // Set this gateway as escape target
                                escapeTarget = { ...nearestGateway, escapeUntil: Date.now() + 15000 };
                                finalTarget = escapeTarget;
                            } else {
                                finalTarget = pathOptimalTarget;
                            }
                        } else {
                            finalTarget = pathOptimalTarget;
                        }
                    } else {
                        logger.warn(`🚫 All nearby mobs are unreachable! Force switching map...`);
                        
                        // Force LRU map change (pick least recently visited)
                        if (mapsList && mapsList.length > 0) {
                             const available = mapsList.filter(m => m !== state.currentMapName);
                             available.sort((a, b) => (mapHistory.get(a) || 0) - (mapHistory.get(b) || 0));
                             if (available.length > 0) {
                                 const nextMap = available[0];
                                 const pathData = mapNav.findPath(state.currentMapName, [nextMap], state.hero.lvl);
                                 if (pathData && pathData.nextMap) {
                                      const gw = state.gateways.find(g => 
                                          g.name.toLowerCase().includes(pathData.nextMap.toLowerCase()) || 
                                          pathData.nextMap.toLowerCase().includes(g.name.toLowerCase())
                                      );
                                      if (gw) {
                                          logger.log(`🚪 Unreachable Mobs -> Force Escape to [${pathData.nextMap}]`);
                                          escapeTarget = { ...gw, escapeUntil: Date.now() + 15000 };
                                          finalTarget = escapeTarget;
                                      }
                                 }
                             }
                        } else {
                             finalTarget = null;
                        }
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
                
                // If we have been moving around but only visited < 3 unique tiles in last 20 steps -> STUCK
                if (uniquePos.size < 3) {
                    logger.warn('😵 STUCK detected (looping on same tiles). Attempting random escape step...');
                    
                    const rx = state.hero.x + (Math.floor(Math.random() * 3) - 1);
                    const ry = state.hero.y + (Math.floor(Math.random() * 3) - 1);
                    
                    await actions.move(page, state, { x: rx, y: ry, nick: 'Unstuck' });
                    positionHistory = [];
                    lockedTarget = null;
                    await sleep(1000);
                    continue;
                }
            }

            // --- EXECUTE MOVEMENT / ACTION ---
            if (finalTarget) {
                // If mob is close -> Attack
                if (finalTarget.dist <= 1.5 && finalTarget.type === 'mob') {
                     // Check for repeated attacks on same target without result
                     if (finalTarget.id === lastAttackTargetId) {
                         sameTargetAttackCount++;
                     } else {
                         sameTargetAttackCount = 0;
                         lastAttackTargetId = finalTarget.id;
                     }

                     if (sameTargetAttackCount > 10) {
                         logger.warn(`🛑 Attacked [${finalTarget.nick}] 10 times with no effect. Blacklisting & Skipping...`);
                         skippedMobs.set(finalTarget.id, Date.now());
                         sameTargetAttackCount = 0;
                         lockedTarget = null;
                         continue;
                     }
                     
                     // ATTACK!
                     await sleep(Math.floor(Math.random() * 150) + 50); // 50-200ms human delay
                     const res = await actions.attack(page, finalTarget, lastAttackTime);
                     lastAttackTime = res;
                     lastActionTime = Date.now(); // Reset AFK timer
                     await sleep(Math.floor(Math.random() * 400) + 800); // 800-1200ms throttle
                } 
                else {
                    // Start of Move
                    await actions.move(page, state, finalTarget);
                    // End of Move logic handled by sleep below
                }
            } else {
                // No Target
                
                // DEBUG: Log why we have no target (Uncomment if debugging)
                // logger.log(`🔍 NO TARGET: isTraversing=${isTraversing}, validMobs=${state.validMobs?.length || 0}, resupply=${!!resupplyTarget}, mapsList=${mapsList?.length || 0}`);
                
                // 1. Gateway Scan (if nothing else to do)
                // Logic: If (validMobs == 0 and not traversing) -> Switch Map Cyclically
                
                if (!isTraversing && state.validMobs.length === 0 && !resupplyTarget) {
                    
                    let nextMapTarget = null;
                    if (typeof mapsList !== 'undefined' && Array.isArray(mapsList) && mapsList.length > 0) {
                         let targetDestName = null;
                         const currentIdx = mapsList.findIndex(m => m === state.currentMapName);
                         
                         // Determine FINAL destination
                         // Strategy: LRU (Least Recently Used)
                         // Prioritize maps visited longest ago to ensure full cycle
                         const available = mapsList.filter(m => m !== state.currentMapName);
                         available.sort((a, b) => {
                             const tA = mapHistory.get(a) || 0;
                             const tB = mapHistory.get(b) || 0;
                             return tA - tB;
                         });

                         if (available.length > 0) {
                             targetDestName = available[0];
                             // logger.log(`🧭 LRU Target: ${targetDestName} (Last Visit: ${tA})`); -- tA scope issue, skipping log or moving it
                         } else if (mapsList.length > 0) {
                             targetDestName = mapsList[0];
                         } 
                         // Else: targetDestName remains null (fallback to ANY map in list)

                         // Calculate Path to Destination
                         let pathData = null;
                         if (targetDestName) {
                             pathData = mapNav.findPath(state.currentMapName, [targetDestName], state.hero.lvl);
                         } else {
                             pathData = mapNav.findPath(state.currentMapName, mapsList, state.hero.lvl);
                         }
                         
                         if (pathData && pathData.nextMap) {
                             const nextStepName = pathData.nextMap;
                             logger.log(`🧭 Cyclic: Path found! Current: ${state.currentMapName} -> Next: ${nextStepName} -> Dest: ${targetDestName}`);
                             
                             // 1. Check for OVERRIDE
                             let gateway = null;
                             if (GATEWAY_OVERRIDES[state.currentMapName] && GATEWAY_OVERRIDES[state.currentMapName][nextStepName]) {
                                 const ov = GATEWAY_OVERRIDES[state.currentMapName][nextStepName];
                                 logger.log(`⚠️ using GATEWAY OVERRIDE (Cyclic) for ${nextStepName}: [${ov.x}, ${ov.y}]`);
                                 gateway = { x: ov.x, y: ov.y, name: `Override -> ${nextStepName}`, type: 'gateway', isGateway: true };
                             }

                             // 2. Standard Search
                             if (!gateway) {
                                 gateway = state.gateways.find(g => 
                                     g.name.toLowerCase().includes(nextStepName.toLowerCase()) || 
                                     nextStepName.toLowerCase().includes(g.name.toLowerCase())
                                 );
                             }

                             if (!gateway) {
                                  logger.warn(`⚠️ Cyclic Move: Need to go to [${nextStepName}], but no matching gateway found!`);
                                  logger.warn(`   Available Gateways: ${state.gateways.map(g => `[${g.name} at ${g.x},${g.y}]`).join(', ')}`);
                             }
                             
                             if (gateway) {
                                 nextMapTarget = { name: nextStepName, gateway };
                             } else {
                                  // Only log rarely to avoid spam
                                  if (Math.random() < 0.05) logger.warn(`⚠️ Path calculated to [${targetDestName || 'List'}], via [${nextStepName}], but gateway not found!`);
                             }
                         } else {
                              logger.warn(`⚠️ Cyclic: No path found from ${state.currentMapName} to ${targetDestName || 'any map in list'}`);
                         }
                    }

                    if (nextMapTarget && nextMapTarget.gateway) {
                         logger.log(`🚪 No mobs. Cyclic Move -> ${nextMapTarget.name}...`);
                         await actions.move(page, state, nextMapTarget.gateway);
                         escapeTarget = { ...nextMapTarget.gateway, escapeUntil: Date.now() + 10000 };
                         // Removed sleep(500) for fluidity
                    } else {
                         logger.warn(`⚠️ Cyclic Move FAILED: No nextMapTarget found. mapsList=${JSON.stringify(mapsList)}, currentMap=${state.currentMapName}`);
                    }
                }
            }
            
            // Loop Throttle (prevent CPU burn, but keep it snappy)
            if (state.hero.hp < state.hero.maxhp * 0.4) {
                 await sleep(500); // Slow down if dying
            } else {
                 await sleep(50); // 50ms for responsiveness (was 150)
            }
            
            // Loop delay - RESTORED for stability
            
        } catch (error) {
            logger.error('❌ Main loop error:', error);
            // logger.error(error.stack);
            
            if (error.message && error.message.includes('Target closed')) {
                logger.error('❌ Browser closed. Exiting...');
                process.exit(1);
            }
            
            await sleep(2000);
        }
    }
}

main();
