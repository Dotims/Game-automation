// Detect TimeoutOverflowWarning from frozen game - set flag for reload
global.needsGameReload = false;
process.on('warning', (warning) => {
    if (warning.name === 'TimeoutOverflowWarning') {
        console.warn('⚠️ TimeoutOverflowWarning detected! Game may be frozen. Flagging for reload...');
        global.needsGameReload = true;
        return;
    }
    console.warn(warning.name, warning.message);
});

const { initBrowser } = require('./core/browser');
const config = require('./config');
const logger = require('./utils/logger');
const ui = require('./game/ui');
const gameState = require('./game/gameState');
const captcha = require('./game/captcha');
const browserEvals = require('./core/browser_evals');
// Security Utilities
const { decrypt, getSelfHash } = require('./utils/crypto');

// Encrypted Constants (AES-256)
const MARGONEM_DOMAIN_ENC = '990cd8417f115b07982dbb9dd97915ed:74f97713fd8d5affb2bd91fbf0eb2df4';

// --- SELF-INTEGRITY CHECK ---
(function verifyIntegrity() {
    const hash = getSelfHash();
    if (hash) {
        // In production, fetch this from secure server
        // console.log(`[SECURITY] Binary Hash: ${hash}`);
        // if (hash !== EXPECTED_HASH) process.exit(1);
    }
})();
const actions = require('./game/actions');
const movement = require('./game/movement');
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
const license = require('./license');
const security = require('./security');

// ============================================
// SECURITY: Start anti-debugging protection
// ============================================
security.startAntiDebug();

// Verify binary integrity (only works when packaged with pkg)
const integrityCheck = security.verifyBinaryIntegrity();
if (!integrityCheck.valid) {
    console.error('\n⛔ SECURITY VIOLATION: Binary has been modified!');
    console.error('   The executable file appears to be tampered with.');
    console.error('   Please download the original version.\n');
    process.exit(1);
}
if (integrityCheck.hash) {
    console.log(`🔒 Binary Hash: ${integrityCheck.hash.substring(0, 16)}...`);
}

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
        if (page.url().includes(decrypt(MARGONEM_DOMAIN_ENC)) && !page.url().includes('login')) {
            // Basic check if map is loaded (optional, but good)
            const mapLoaded = await browserEvals.isMapLoaded(page);
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
        const detectedGamePages = allPages.filter(p => p.url().includes(decrypt(MARGONEM_DOMAIN_ENC)) && !p.url().includes('login'));

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
    let precomputedNextTarget = null; // Fast Path: Next mob calculated during movement
    let blindMoveFailCount = 0; // Track consecutive blind move failures (desync after attack)
    let blindMoveCooldownUntil = 0; // Timestamp when blind move can be re-enabled
    let lastBlindMoveTargetId = null; // Track which mob we blind-moved from

    // --- Cached Map Data ---
    let cachedMapId = null;
    let mapChangedAt = 0; // Cooldown timer
    let pathfindFailCount = 0; // Track consecutive pathfinding failures to detect unreachable gateways
    let lastFailedGatewayName = null; // Track which gateway keeps failing

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
    
    // Map oscillation detection (prevent Smart Skip loops)
    let mapChangeTimestamps = []; // Track last N map changes with timestamps
    let smartSkipDisabledUntil = 0; // Timestamp when Smart Skip can be re-enabled

    // Gateway stuck loop detection (game loading/reloading issue)
    let gatewayStuckTracker = {
        lastGateway: null,        // Name of last targeted gateway
        lastDistance: null,       // Distance to gateway on last attempt
        sameCount: 0,             // Count of identical (gateway+distance) situations
        waitingUntil: 0           // Timestamp when waiting period ends (if triggered)
    };

    // Non-hunting map stuck detection (when bot gets lost outside configured maps)
    let nonHuntingStuckTracker = {
        stuckSince: null,         // Timestamp when first detected on non-hunting map
        lastMapName: null,        // Name of the non-hunting map
        attemptCount: 0           // Number of failed return attempts
    };

    while (true) {
        // Check Global Stop Flag (from config panel)
        if (global.BOT_SHOULD_STOP) {
            // Only log once
            if (!global.stopLogged) {
                logger.log('🛑 Bot stopped by user request.');
                global.stopLogged = true;
            }
            await sleep(1000);
            continue; // Spin wait
        } else {
            global.stopLogged = false;
        }

        const loopStart = Date.now(); // ⏱️ TIMING DIAGNOSTIC

        try {
            // Inject UI (returns current config state)
            // Validate license from stored key
            let licenseInfo = null;
            const storedKey = await browserEvals.getStoredLicenseKey(page);
            
            if (storedKey) {
                licenseInfo = await license.validateLicense(storedKey);
                
                // Log only on status changes
                if (!licenseInfo.valid && !global.lastLicenseWarn) {
                    logger.warn(`🔐 License: ${licenseInfo.reason}`);
                    global.lastLicenseWarn = true;
                } else if (licenseInfo.valid && global.lastLicenseWarn) {
                    logger.success(`✅ License activated! Days remaining: ${licenseInfo.info.daysRemaining}`);
                    global.lastLicenseWarn = false;
                }
            }
            
            const uiState = await ui.injectUI(page, config.DEFAULT_CONFIG, HUNTING_SPOTS, allMapNames, MONSTERS, licenseInfo);
            
            const mode = uiState.mode || 'exp';
            const transportTarget = uiState.transportMap;

            if (uiState.securityAlert) {
                logger.error('🛑 FATAL SECURITY WARNING: Bot inputs detected as UNTRUSTED/FAKE!');
                logger.error('   The game or browser is flagging our inputs. Stopping for safety.');
                await sleep(5000);
                continue;
            }

            // LICENSE CHECK - Block bot if no valid license
            if (!uiState.licenseValid) {
                // Only log occasionally to avoid spam
                if (!global.lastLicenseLog || Date.now() - global.lastLicenseLog > 30000) {
                    logger.warn('🔐 Bot locked. Waiting for valid license activation...');
                    global.lastLicenseLog = Date.now();
                }
                await sleep(1000);
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
            
            // 3.5. CHECK FOR GAME FREEZE (TimeoutOverflowWarning detected)
            if (global.needsGameReload) {
                logger.warn('🔄 Game freeze detected (TimeoutOverflowWarning). Performing Ctrl+F5 reload...');
                global.needsGameReload = false; // Reset flag
                try {
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    logger.success('✅ Page reloaded successfully.');
                    await sleep(5000); // Wait for game to fully load
                } catch (e) {
                    logger.error(`❌ Reload failed: ${e.message}`);
                }
                continue; // Skip this iteration
            }

            // 4. Get Game State
            const currentConfig = { 
                ...uiState.config, 
                skippedMobIds: Array.from(skippedMobs.keys()) 
            };
            
            // ⏱️ TIMING DIAGNOSTIC
            const stateStart = Date.now();
            const state = await gameState.getGameState(page, currentConfig);
            const stateTime = Date.now() - stateStart;
            if (stateTime > 200) logger.warn(`⚠️ SLOW GameState Read: ${stateTime}ms`);

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
                     logger.warn(`💀 Unconscious. Respawn in ${waitSeconds}s. Waiting ${timeToWait}s to Auto-Reload (monitoring Captcha)...`);
                     
                     // Wait with Captcha Check AND UI State Check (STOP button)
                     const wakeTime = Date.now() + (timeToWait * 1000);
                     let userStopped = false;
                     while (Date.now() < wakeTime) {
                         try {
                             // Check if user clicked STOP
                             const currentUIState = await ui.injectUI(page, config.DEFAULT_CONFIG, HUNTING_SPOTS, allMapNames, MONSTERS, licenseInfo);
                             if (!currentUIState.active) {
                                 logger.info('⏹️ User clicked STOP during respawn wait. Pausing...');
                                 userStopped = true;
                                 break;
                             }
                             
                             if (await captcha.solve(page)) {
                                 logger.info('🤖 CAPTCHA solved while waiting for respawn.');
                             }
                         } catch (e) {}
                         await sleep(1000); // Check every second
                     }
                     
                     // If user stopped, skip reload and let main loop handle pause
                     if (userStopped) {
                         continue;
                     }
                     
                     logger.log(`🔄 Auto-Reloading page (Respawn in ~${reloadThreshold}s)...`);
                     try {
                         await page.reload({ waitUntil: 'domcontentloaded' });
                     } catch (e) {
                         logger.error("Reload failed, continuing...", e);
                     }
                     await sleep(5000); 
                     continue; 
                 } else {
                     // Short wait - still check UI state
                     const shortWaitEnd = Date.now() + Math.min(waitSeconds * 1000 + 1000, 5000);
                     while (Date.now() < shortWaitEnd) {
                         try {
                             const currentUIState = await ui.injectUI(page, config.DEFAULT_CONFIG, HUNTING_SPOTS, allMapNames, MONSTERS, licenseInfo);
                             if (!currentUIState.active) {
                                 logger.info('⏹️ User clicked STOP during respawn wait. Pausing...');
                                 break;
                             }
                         } catch (e) {}
                         await sleep(500);
                     }
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
                const zakonnik = await browserEvals.findZakonnik(page);

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
                         logger.log(`👹 E2 DETECTED: [${targetMob.nick}] at (${targetMob.x}, ${targetMob.y})!${uiState.e2Attack ? ' Engaging...' : ' (Attack OFF - Idle mode)'}`);
                         lastEngagedMobId = targetMob.id;
                     }
                     
                     const distToMob = Math.hypot(targetMob.x - state.hero.x, targetMob.y - state.hero.y);
                     
                     // Only attack if e2Attack is enabled
                     if (uiState.e2Attack && distToMob <= 1.5) {
                         // ATTACK
                         await sleep(Math.floor(Math.random() * 150) + 50); // 50-200ms human delay
                         const result = await actions.attack(page, targetMob, lastAttackTime);
                         lastAttackTime = result;
                         lastActionTime = Date.now(); // Reset AFK timer
                         await sleep(Math.floor(Math.random() * 400) + 800); // 800-1200ms throttle
                         continue;
                     } else if (uiState.e2Attack && distToMob > 1.5) {
                         // APPROACH (only when attack is enabled)
                         await actions.move(page, state, { x: targetMob.x, y: targetMob.y, nick: targetMob.nick });
                         continue;
                     } else {
                         // E2Attack OFF - just stay near the mob (idle mode)
                         // Anti-AFK will be handled by the standard anti-AFK logic below
                         if (distToMob > 3.0) {
                             // Get closer to the mob but don't attack
                             await actions.move(page, state, { x: targetMob.x, y: targetMob.y, nick: targetMob.nick });
                             continue;
                         }
                         // Otherwise just idle near mob - fall through to anti-AFK logic
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
                      
                      const tunia = await browserEvals.findTunia(page);
                      
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
                         
                         // Track map change for oscillation detection
                         mapChangeTimestamps.push(Date.now());
                         // Keep only last 10 map changes
                         if (mapChangeTimestamps.length > 10) mapChangeTimestamps.shift();
                         
                         // Detect rapid oscillation: 6+ map changes in 30 seconds = loop detected
                         const thirtySecondsAgo = Date.now() - 30000;
                         const recentChanges = mapChangeTimestamps.filter(t => t > thirtySecondsAgo);
                         if (recentChanges.length >= 6) {
                             logger.warn(`🔄 MAP OSCILLATION DETECTED! ${recentChanges.length} map changes in 30s. Disabling Smart Skip for 60s...`);
                             smartSkipDisabledUntil = Date.now() + 60000; // Disable for 60 seconds
                             mapChangeTimestamps = []; // Reset to prevent spam
                         }
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
                precomputedNextTarget = null; // Clear fast path target
                
                // Reset gateway stuck tracker on map change
                gatewayStuckTracker.lastGateway = null;
                gatewayStuckTracker.lastDistance = null;
                gatewayStuckTracker.sameCount = 0;
                gatewayStuckTracker.waitingUntil = 0;
                
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
                     // No graph path found - we might be on a map OUTSIDE our hunting list
                     const isOnHuntingMap = mapsList.some(m => m.toLowerCase() === state.currentMapName.toLowerCase());
                     
                     if (!isOnHuntingMap && lastMapName) {
                         // We are LOST! Try to go back to the last map
                         logger.warn(`🚨 OUT OF BOUNDS: On [${state.currentMapName}] (not in hunting list). Trying to return to [${lastMapName}]...`);
                         
                         // Find gateway to lastMapName
                         const returnGateway = state.gateways.find(g => 
                             g.name.toLowerCase().includes(lastMapName.toLowerCase()) ||
                             lastMapName.toLowerCase().includes(g.name.toLowerCase())
                         );
                         
                         if (returnGateway) {
                             logger.log(`↩️ Found return gateway: [${returnGateway.name}] at (${returnGateway.x}, ${returnGateway.y})`);
                             state.traversalTarget = returnGateway;
                         } else {
                             // Can't find return gateway - try ANY gateway on the map 
                             logger.warn(`⚠️ No gateway to [${lastMapName}] found. Trying any available gateway...`);
                             if (state.gateways.length > 0) {
                                 // Pick the nearest gateway
                                 let nearestGw = state.gateways[0];
                                 let nearestDist = Math.hypot(nearestGw.x - state.hero.x, nearestGw.y - state.hero.y);
                                 for (const gw of state.gateways) {
                                     const dist = Math.hypot(gw.x - state.hero.x, gw.y - state.hero.y);
                                     if (dist < nearestDist) {
                                         nearestDist = dist;
                                         nearestGw = gw;
                                     }
                                 }
                                 logger.log(`↩️ Using nearest gateway: [${nearestGw.name}] at (${nearestGw.x}, ${nearestGw.y})`);
                                 state.traversalTarget = nearestGw;
                             }
                         }
                     }
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
            
            // --- GATEWAY STUCK LOOP DETECTION ---
            // If we're currently in a recovery wait period, just wait
            if (gatewayStuckTracker.waitingUntil > Date.now()) {
                const remaining = Math.round((gatewayStuckTracker.waitingUntil - Date.now()) / 1000);
                if (remaining % 10 === 0 || remaining <= 5) { // Log every 10s or last 5s
                    logger.log(`⏳ Gateway stuck recovery: Waiting ${remaining}s for game to stabilize...`);
                }
                await sleep(1000);
                continue;
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
            // Check if allowed to hunt here (or if mapsList is empty/undefined)
            const isOnHuntingMap = !mapsList || mapsList.length === 0 || mapsList.some(m => m.toLowerCase() === state.currentMapName.toLowerCase());

            if (!isTraversing && !escapeTarget && !resupplyTarget && isOnHuntingMap) {

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
                        // If few mobs left (<6), they are far (>35 steps), and gateway to ANOTHER HUNT MAP is nearby (<50% of mob distance), skip to next map
                        // DISABLED if oscillation was detected recently
                        const mobCount = state.validMobs.length;
                        const mobDistance = pathOptimalTarget.pathLength || Infinity;
                        const smartSkipEnabled = Date.now() > smartSkipDisabledUntil;
                        
                        if (smartSkipEnabled && mobCount < 6 && mobDistance > 35 && state.gateways && state.gateways.length > 0 && mapsList && mapsList.length > 0) {
                            // Find nearest gateway THAT LEADS TO A MAP IN OUR HUNTING LIST
                            let nearestHuntGateway = null;
                            let nearestHuntGwDist = Infinity;
                            
                            // Create lowercase map set for matching
                            const mapsListLower = mapsList.map(m => m.toLowerCase());
                            
                            for (const gw of state.gateways) {
                                // Check if this gateway leads to a map in our list
                                const gwNameLower = (gw.name || '').toLowerCase();
                                const leadsToHuntMap = mapsListLower.some(m => 
                                    gwNameLower.includes(m) || m.includes(gwNameLower)
                                );
                                
                                if (leadsToHuntMap) {
                                    // Dead End Prevention: Don't Smart Skip into maps with only 1 connection (Cul-de-sacs)
                                    // unless we are specifically targeting them? No, Smart Skip is for flow.
                                    // Find exact map name to query graph
                                    const targetMapName = mapsList.find(m => gwNameLower.includes(m.toLowerCase()) || m.toLowerCase().includes(gwNameLower));
                                    if (targetMapName) {
                                        // 1. Check Cycle Prevention (Don't go back to where we just came from via Smart Skip)
                                        if (lastMapName && targetMapName.toLowerCase() === lastMapName.toLowerCase()) {
                                            // logger.log(`🚫 Smart Skip block: Avoiding backtracking to [${targetMapName}]`);
                                            continue;
                                        }

                                        // 2. Dead End Check
                                        const conns = mapNav.getConnections(targetMapName);
                                        // If map has only 1 connection (the way back), treat as dead end and skip
                                        if (conns && conns.length <= 1) continue;
                                    }

                                    const gwDist = Math.hypot(gw.x - state.hero.x, gw.y - state.hero.y);
                                    if (gwDist < nearestHuntGwDist) {
                                        nearestHuntGwDist = gwDist;
                                        nearestHuntGateway = gw;
                                    }
                                }
                            }
                            
                            // Check if hunt-gateway is within 50% of mob distance (much closer)
                            if (nearestHuntGateway && nearestHuntGwDist < mobDistance * 0.5) {
                                logger.log(`⏩ SMART SKIP: ${mobCount} mobs left, closest is ${mobDistance} steps away. Gateway to [${nearestHuntGateway.name}] is only ${Math.round(nearestHuntGwDist)} tiles away. Skipping...`);
                                
                                // Set this gateway as escape target
                                escapeTarget = { ...nearestHuntGateway, escapeUntil: Date.now() + 15000 };
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
                     
                     // ========== BLIND MOVE FAILURE DETECTION ==========
                     // If we're attacking the same mob we just blind-moved from, it means kill failed
                     if (lastBlindMoveTargetId && finalTarget.id === lastBlindMoveTargetId) {
                         blindMoveFailCount++;
                         if (blindMoveFailCount >= 2) {
                             // Too many failures - disable blind move for 10 seconds
                             blindMoveCooldownUntil = Date.now() + 10000;
                             logger.warn(`⚠️ Blind Move disabled for 10s (mob didn't die ${blindMoveFailCount}x)`);
                             blindMoveFailCount = 0;
                         }
                     } else {
                         // Different mob - reset counter
                         blindMoveFailCount = 0;
                     }
                     lastBlindMoveTargetId = null; // Reset after check
                     
                     // Check if blind move is in cooldown
                     const blindMoveEnabled = Date.now() > blindMoveCooldownUntil;
                     
                     // ATTACK! (EXP Mode)
                     if (blindMoveEnabled) {
                         await sleep(Math.floor(Math.random() * 30)); // 0-30ms (fast)
                     } else {
                         await sleep(Math.floor(Math.random() * 100) + 50); // 50-150ms (careful)
                     }
                     
                     const res = await actions.attack(page, finalTarget, lastAttackTime);
                     lastAttackTime = res;
                     lastActionTime = Date.now(); // Reset AFK timer
                     
                     // ========== BLIND MOVE OPTIMIZATION ==========
                     // Only use blind move if enabled and we have precomputed target
                     if (blindMoveEnabled && precomputedNextTarget && precomputedNextTarget.id !== finalTarget.id) {
                         // Remember which mob we're leaving (to detect failure later)
                         lastBlindMoveTargetId = finalTarget.id;
                         // Don't await fully - just fire and continue
                         actions.move(page, state, precomputedNextTarget).catch(() => {});
                         precomputedNextTarget = null;
                         await sleep(Math.floor(Math.random() * 50) + 30); // 30-80ms micro-pause
                         continue;
                     }
                     
                     // No blind move - use throttle (slower when in cooldown)
                     if (blindMoveEnabled) {
                         await sleep(Math.floor(Math.random() * 200) + 100); // 100-300ms
                     } else {
                         await sleep(Math.floor(Math.random() * 400) + 400); // 400-800ms (careful mode)
                     }
                } 
                else {
                    // --- GATEWAY STUCK PATTERN DETECTION ---
                    // Track if we're repeatedly trying to go to the same gateway without distance change
                    if (finalTarget.isGateway || state.traversalTarget) {
                        const gwName = finalTarget.name || finalTarget.nick || 'gateway';
                        const currentDist = Math.hypot(finalTarget.x - state.hero.x, finalTarget.y - state.hero.y);
                        
                        // Check if same gateway with same distance (within 0.5 tolerance)
                        const isSameGateway = (gatewayStuckTracker.lastGateway === gwName);
                        const isSameDistance = gatewayStuckTracker.lastDistance !== null && 
                            Math.abs(gatewayStuckTracker.lastDistance - currentDist) < 0.5;
                        
                        if (isSameGateway && isSameDistance) {
                            gatewayStuckTracker.sameCount++;
                            
                            // After 3 identical attempts, trigger recovery wait
                            // DISABLED: User requested to disable this waiting logic
                            /*
                            if (gatewayStuckTracker.sameCount >= 3) {
                                const waitTime = 30000 + Math.floor(Math.random() * 20001); // 30-50s
                                logger.warn(`🔄 GATEWAY STUCK DETECTED! Same gateway [${gwName}] at ${currentDist.toFixed(1)}m for ${gatewayStuckTracker.sameCount} times.`);
                                logger.warn(`⏳ Waiting ${Math.round(waitTime/1000)}s for game to reload/stabilize...`);
                                
                                gatewayStuckTracker.waitingUntil = Date.now() + waitTime;
                                gatewayStuckTracker.sameCount = 0; // Reset for next cycle
                                
                                // Clear escape target to prevent immediate re-engagement
                                escapeTarget = null;
                                
                                await sleep(1000);
                                continue;
                            }
                            */
                        } else {
                            // Different gateway or significant distance change - reset tracker
                            gatewayStuckTracker.sameCount = 1;
                        }
                        
                        // Update tracker state
                        gatewayStuckTracker.lastGateway = gwName;
                        gatewayStuckTracker.lastDistance = currentDist;
                    } else {
                        // Not targeting a gateway - reset tracker
                        gatewayStuckTracker.sameCount = 0;
                        gatewayStuckTracker.lastGateway = null;
                        gatewayStuckTracker.lastDistance = null;
                    }
                    
                    // ========== PRE-COMPUTE NEXT TARGET (during movement) ==========
                    // If we're moving to a mob, pre-calculate the next mob so we can
                    // use it immediately after attacking (Fast Path optimization)
                    if (finalTarget.type === 'mob' && finalTarget.dist > 1.5) {
                        // Don't await - let this run while we move
                        browserEvals.findNextMob(page, { 
                            currentTargetId: finalTarget.id, 
                            heroX: finalTarget.x, // Use target position (where hero will be after moving)
                            heroY: finalTarget.y,
                            minLvl: currentConfig.minLvl || 1,
                            maxLvl: currentConfig.maxLvl || 999
                        }).then(nextMob => {
                            if (nextMob) {
                                precomputedNextTarget = nextMob;
                            }
                        }).catch(() => {}); // Ignore errors
                    }
                    
                    // Start of Move
                    const moveResult = await actions.move(page, state, finalTarget);
                    
                    // Handle DESYNC LOOP - bot stuck at same position, needs page refresh
                    if (moveResult === 'desync_loop') {
                        logger.error('🔄 Performing Ctrl+F5 page refresh to recover from desync loop...');
                        try {
                            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                            logger.success('✅ Page reloaded successfully. Resuming in 5s...');
                            await sleep(2000);
                        } catch (reloadErr) {
                            logger.error(`❌ Reload failed: ${reloadErr.message}`);
                        }
                        continue;
                    }
                    
                    // Handle unreachable gateway/target - try to find alternative
                    if (moveResult === 'skip_target' && finalTarget.isGateway) {
                        const gwName = finalTarget.name || finalTarget.nick || 'unknown';
                        logger.warn(`🚧 Gateway [${gwName}] is unreachable! Looking for alternative...`);
                        
                        // Track failed gateway
                        if (lastFailedGatewayName === gwName) {
                            pathfindFailCount++;
                        } else {
                            lastFailedGatewayName = gwName;
                            pathfindFailCount = 1;
                        }
                        
                        // If we've failed too many times on the same gateway, force return
                        if (pathfindFailCount >= 5) {
                            logger.warn(`🚨 Gateway [${gwName}] failed ${pathfindFailCount} times! Forcing return to [${lastMapName || 'any exit'}]...`);
                            
                            // Find ANY OTHER gateway (not the failed one)
                            const otherGateways = state.gateways.filter(g => 
                                (g.name || '').toLowerCase() !== gwName.toLowerCase()
                            );
                            
                            if (otherGateways.length > 0) {
                                // Pick closest other gateway
                                let closest = otherGateways[0];
                                let closestDist = Math.hypot(closest.x - state.hero.x, closest.y - state.hero.y);
                                for (const gw of otherGateways) {
                                    const dist = Math.hypot(gw.x - state.hero.x, gw.y - state.hero.y);
                                    if (dist < closestDist) {
                                        closestDist = dist;
                                        closest = gw;
                                    }
                                }
                                logger.log(`↩️ Trying alternative gateway: [${closest.name}]`);
                                escapeTarget = { ...closest, escapeUntil: Date.now() + 15000 };
                            }
                            
                            pathfindFailCount = 0;
                            lastFailedGatewayName = null;
                        }
                    } else if (moveResult !== 'skip_target') {
                        // Reset counter on successful move
                        pathfindFailCount = 0;
                        lastFailedGatewayName = null;
                    }
                    // End of Move logic handled by sleep below
                }
            } else {
                // No Target
                
                // DEBUG: Log why we have no target (Uncomment if debugging)
                // logger.log(`🔍 NO TARGET: isTraversing=${isTraversing}, validMobs=${state.validMobs?.length || 0}, resupply=${!!resupplyTarget}, mapsList=${mapsList?.length || 0}`);
                
                // 1. Gateway Scan (if nothing else to do)
                // Logic: If (validMobs == 0 and not traversing) -> Switch Map Cyclically
                
                // Enter if no mobs OR if we are on a banned map (so we must escape even if mobs exist)
                if (!isTraversing && !resupplyTarget && (state.validMobs.length === 0 || !isOnHuntingMap)) {
                    
                    let nextMapTarget = null;
                    if (typeof mapsList !== 'undefined' && Array.isArray(mapsList) && mapsList.length > 0) {
                         let targetDestName = null;
                         const currentIdx = mapsList.findIndex(m => m === state.currentMapName);
                         
                         // CRITICAL: Check if we are on a NON-HUNTING map!
                         const isOnHuntingMap = mapsList.some(m => m.toLowerCase() === state.currentMapName.toLowerCase());
                         
                         if (!isOnHuntingMap) {
                             // Track how long we've been stuck on non-hunting map
                             if (nonHuntingStuckTracker.lastMapName !== state.currentMapName) {
                                 // New non-hunting map - reset tracker
                                 nonHuntingStuckTracker.stuckSince = Date.now();
                                 nonHuntingStuckTracker.lastMapName = state.currentMapName;
                                 nonHuntingStuckTracker.attemptCount = 0;
                             }
                             
                             nonHuntingStuckTracker.attemptCount++;
                             const stuckDuration = Date.now() - nonHuntingStuckTracker.stuckSince;
                             
                             // EMERGENCY RELOAD: If stuck on non-hunting map for 45+ seconds with 10+ attempts
                             if (stuckDuration > 45000 && nonHuntingStuckTracker.attemptCount >= 10) {
                                 logger.error(`🔄 EMERGENCY RELOAD: Stuck on [${state.currentMapName}] for ${Math.round(stuckDuration/1000)}s with ${nonHuntingStuckTracker.attemptCount} failed attempts. Reloading...`);
                                 nonHuntingStuckTracker.stuckSince = null;
                                 nonHuntingStuckTracker.attemptCount = 0;
                                 nonHuntingStuckTracker.lastMapName = null;
                                 try {
                                     await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                                     await sleep(5000); // Wait for page to stabilize
                                 } catch (e) {
                                     logger.warn(`Reload failed: ${e.message}`);
                                 }
                                 continue;
                             }
                             
                             // We are LOST on a non-hunting map! Return to ANY hunting map immediately
                             logger.warn(`🚨 ON NON-HUNTING MAP [${state.currentMapName}]! Returning to hunt area... (attempt ${nonHuntingStuckTracker.attemptCount})`);
                             
                             // Find any gateway that leads to a hunting map
                             const huntGateway = state.gateways.find(g => {
                                 const gwNameLower = (g.name || '').toLowerCase();
                                 return mapsList.some(m => 
                                     gwNameLower.includes(m.toLowerCase()) || 
                                     m.toLowerCase().includes(gwNameLower)
                                 );
                             });
                             
                             if (huntGateway) {
                                 logger.log(`↩️ Found gateway to hunting map: [${huntGateway.name}]`);
                                 nextMapTarget = huntGateway;
                                 escapeTarget = { ...huntGateway, escapeUntil: Date.now() + 20000 };
                             } else if (lastMapName) {
                                 // Try to find gateway to last map
                                 const lastMapGateway = state.gateways.find(g =>
                                     (g.name || '').toLowerCase().includes(lastMapName.toLowerCase()) ||
                                     lastMapName.toLowerCase().includes((g.name || '').toLowerCase())
                                 );
                                 if (lastMapGateway) {
                                     logger.log(`↩️ Returning to last map: [${lastMapName}] via gateway [${lastMapGateway.name}]`);
                                     nextMapTarget = lastMapGateway;
                                     escapeTarget = { ...lastMapGateway, escapeUntil: Date.now() + 20000 };
                                 } else {
                                     // Pick any gateway and hope for the best
                                     if (state.gateways.length > 0) {
                                         const anyGateway = state.gateways[0];
                                         logger.warn(`⚠️ No hunting gateway found. Using first available: [${anyGateway.name}]`);
                                         nextMapTarget = anyGateway;
                                         escapeTarget = { ...anyGateway, escapeUntil: Date.now() + 20000 };
                                     }
                                 }
                             }
                             
                             if (nextMapTarget) {
                                 // Skip the rest of cyclic logic - just escape
                                 continue;
                             }
                         } else {
                             // We're on a hunting map - reset the stuck tracker
                             nonHuntingStuckTracker.stuckSince = null;
                             nonHuntingStuckTracker.attemptCount = 0;
                             nonHuntingStuckTracker.lastMapName = null;
                         }
                         
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
                         
                         // CRITICAL FIX: Validate that nextMap is within our hunting list
                         // If the path goes through a non-hunting map, REJECT it
                         if (pathData && pathData.nextMap) {
                             const nextMapIsInList = mapsList.some(m => m.toLowerCase() === pathData.nextMap.toLowerCase());
                             
                             if (!nextMapIsInList) {
                                 logger.warn(`🚫 Path to [${targetDestName}] goes through [${pathData.nextMap}] which is NOT in hunting list! Skipping...`);
                                 
                                 // Try to find a DIRECT gateway to any hunting map instead
                                 const directHuntGateway = state.gateways.find(g => {
                                     const gwNameLower = (g.name || '').toLowerCase();
                                     return mapsList.some(m => 
                                         gwNameLower.includes(m.toLowerCase()) || 
                                         m.toLowerCase().includes(gwNameLower)
                                     );
                                 });
                                 
                                 if (directHuntGateway) {
                                     logger.log(`↩️ Found direct gateway to hunting map: [${directHuntGateway.name}]`);
                                     nextMapTarget = directHuntGateway;
                                     escapeTarget = { ...directHuntGateway, escapeUntil: Date.now() + 15000 };
                                     pathData = null; // Prevent overwriting by subsequent logic
                                 } else {
                                     // No direct gateway - stay on current map and wait for respawn
                                     logger.warn(`⏳ No direct gateway to hunting maps found. Staying on current map...`);
                                     pathData = null;
                                 }
                             }
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
            // Handle browser disconnect/closed gracefully
            const errMsg = error.message || '';
            if (errMsg.includes('Target page, context or browser has been closed') || 
                errMsg.includes('Session closed') || 
                errMsg.includes('Navigating frame was detached') ||
                errMsg.includes('Execution context was destroyed')) {
                
                if (!global.disconnectLogged) {
                    logger.warn('🔌 Browser connection lost (Page/Context closed). Waiting for reconnect...');
                    global.disconnectLogged = true;
                }
                
                // AUTO-RECONNECT: Wait 3 seconds and try to reconnect
                logger.info('🔄 Attempting to reconnect in 3 seconds...');
                await sleep(3000);
                
                try {
                    // Try to reconnect to browser
                    const extReq = global.externalRequire || require;
                    const { chromium } = extReq('playwright');
                    const cdpPort = process.env.CDP_PORT || '9222';
                    const newBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
                    const contexts = newBrowser.contexts();
                    const context = contexts.length > 0 ? contexts[0] : await newBrowser.newContext();
                    const pages = context.pages();
                    
                    // Find Margonem page
                    let newPage = pages.find(p => p.url().includes('margonem'));
                    
                    if (newPage) {
                        logger.success('✅ Reconnected to Margonem page!');
                        page = newPage; // Update page reference
                        global.disconnectLogged = false;
                        continue; // Continue the main loop
                    } else {
                        logger.info('⏳ Waiting for Margonem page...');
                        continue; // Keep waiting
                    }
                } catch (reconnectError) {
                    // Reconnect failed - keep trying
                    logger.info('⏳ Browser not ready, retrying...');
                    continue;
                }
            }

            logger.error(`❌ Main loop error: ${errMsg}`);
            // Log stack only if it's NOT a known trivial error
            if (!errMsg.includes('Target page')) {
                console.error(error);
            }
            // Prevent rapid fail loop
            await sleep(2000);
        }
    }
}

// Export main for worker to await (don't auto-run)
module.exports = main;
