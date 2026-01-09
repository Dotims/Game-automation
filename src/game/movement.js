const PF = require('pathfinding');
const logger = require('../utils/logger');
const { CONSTANTS } = require('../config');
const { sleep } = require('../utils/sleep');

let stuckCounter = 0;
let lastHeroPos = { x: 0, y: 0 };
let pathfindFailCounter = 0;
let lastFailedTargetId = null;

// Caching for performance
let cachedMapId = null;
let baseGrid = null;

/**
 * Build/update the pathfinding grid for the current map
 */
function ensureGrid(gameState) {
    if (!baseGrid || cachedMapId !== gameState.map.id) {
        logger.info(`🗺️ Building collision grid for map ${gameState.map.id}...`);
        baseGrid = new PF.Grid(gameState.map.w, gameState.map.h);
        const colStr = gameState.map.col;
        if (colStr) {
            let c = 0;
            for (let y = 0; y < gameState.map.h; y++) {
                for (let x = 0; x < gameState.map.w; x++) {
                    if (colStr[c] === '1') baseGrid.setWalkableAt(x, y, false);
                    c++;
                }
            }
        }
        
        // Mark Gateways as obstacles (Safety for Auto-Teleport Addons)
        if (gameState.gateways && gameState.gateways.length > 0) {
            for (const gw of gameState.gateways) {
                if (baseGrid.isWalkableAt(gw.x, gw.y)) {
                    baseGrid.setWalkableAt(gw.x, gw.y, false);
                }
            }
        }
        
        cachedMapId = gameState.map.id;
    }
    return baseGrid;
}

/**
 * Get path length to a target using A* pathfinding
 * Returns path length or Infinity if unreachable
 */
function getPathLength(grid, heroX, heroY, targetX, targetY) {
    const gridClone = grid.clone();
    const finder = new PF.AStarFinder({ allowDiagonal: false });
    
    const startX = Math.max(0, Math.min(Math.round(heroX), gridClone.width - 1));
    const startY = Math.max(0, Math.min(Math.round(heroY), gridClone.height - 1));
    let endX = Math.max(0, Math.min(Math.round(targetX), gridClone.width - 1));
    let endY = Math.max(0, Math.min(Math.round(targetY), gridClone.height - 1));
    
    // If target is on a wall, find nearest walkable neighbor
    if (!gridClone.isWalkableAt(endX, endY)) {
        const neighbors = [
            [endX + 1, endY], [endX - 1, endY],
            [endX, endY + 1], [endX, endY - 1],
            [endX + 1, endY + 1], [endX - 1, endY - 1],
            [endX + 1, endY - 1], [endX - 1, endY + 1]
        ];
        
        // Sort by distance to hero
        neighbors.sort((a, b) => {
            const da = Math.hypot(a[0] - startX, a[1] - startY);
            const db = Math.hypot(b[0] - startX, b[1] - startY);
            return da - db;
        });
        
        let found = false;
        for (const n of neighbors) {
            if (n[0] >= 0 && n[0] < gridClone.width && 
                n[1] >= 0 && n[1] < gridClone.height &&
                gridClone.isWalkableAt(n[0], n[1])) {
                endX = n[0];
                endY = n[1];
                found = true;
                break;
            }
        }
        if (!found) return Infinity;
    }
    
    try {
        const path = finder.findPath(startX, startY, endX, endY, gridClone);
        return path && path.length > 0 ? path.length : Infinity;
    } catch (e) {
        return Infinity;
    }
}

/**
 * Applies dynamic obstacles (mobs, NPCs) to the grid
 */
function applyDynamicObstacles(grid, gameState) {
    if (gameState.obstacles) {
        for (const obs of gameState.obstacles) {
            // Don't block the tile the hero is currently engaging if it's the target?
            // Actually, for pathfinding, we want everything blocked. 
            // Neighbors search handles interaction range.
            if (grid.isWalkableAt(obs.x, obs.y)) {
                grid.setWalkableAt(obs.x, obs.y, false);
            }
        }
    }
}

/**
 * Find the best target from validMobs based on actual A* path length
 * This ensures the bot always picks the mob with the shortest REACHABLE path
 */
function findBestTarget(gameState, maxCandidates = 8) {
    if (!gameState.validMobs || gameState.validMobs.length === 0) {
        return null;
    }
    
    // Create a grid WITH OBSTACLES for accurate pathfinding
    const baseGrid = ensureGrid(gameState).clone();
    applyDynamicObstacles(baseGrid, gameState);
    
    const heroX = gameState.hero.x;
    const heroY = gameState.hero.y;
    
    // Limit candidates to avoid performance issues on maps with many mobs
    // validMobs is already sorted by geometric distance
    const candidates = gameState.validMobs.slice(0, maxCandidates);
    
    let bestMob = null;
    let bestPathLength = Infinity;
    
    for (const mob of candidates) {
        // We pass the obstacle-laden grid. getPathLength clones it again (safe but slow).
        // Optimization: Could rewrite getPathLength to accept non-cloning flag, but for now safety first.
        const pathLength = getPathLength(baseGrid, heroX, heroY, mob.x, mob.y);
        
        // Prefer shorter paths; skip unreachable mobs
        if (pathLength < bestPathLength && pathLength !== Infinity) {
            bestPathLength = pathLength;
            bestMob = { ...mob, pathLength: pathLength };
        }
    }
    
    if (bestMob) {
        // Log only if we picked a different mob than the geometrically nearest one
        const nearest = gameState.validMobs[0];
        if (nearest && nearest.id !== bestMob.id) {
            logger.log(`🧭 Path optimization: Picking [${bestMob.nick}] (${bestMob.pathLength} steps) over [${nearest.nick}] (geometrically closer)`);
        }
    }
    
    return bestMob;
}

const movement = {
    // Export the path-based target selection
    findBestTarget,
    
    // Check if a target is reachable (True/False)
    isReachable(gameState, targetX, targetY) {
        if (!gameState) return false;
        // Clone grid because ensureGrid marks gateways as obstacles!
        const grid = ensureGrid(gameState).clone();
        
        // Clamp target to grid bounds
        const safeX = Math.max(0, Math.min(Math.round(targetX), grid.width - 1));
        const safeY = Math.max(0, Math.min(Math.round(targetY), grid.height - 1));
        
        // 1. Apply Dynamic Obstacles (NPCs, Mobs)
        applyDynamicObstacles(grid, gameState);
        
        // 2. UNLOCK our specific target
        grid.setWalkableAt(safeX, safeY, true);

        // 3. UNLOCK our CURRENT position (Hero)
        const heroX = Math.max(0, Math.min(Math.round(gameState.hero.x), grid.width - 1));
        const heroY = Math.max(0, Math.min(Math.round(gameState.hero.y), grid.height - 1));
        grid.setWalkableAt(heroX, heroY, true);
        
        const len = getPathLength(grid, gameState.hero.x, gameState.hero.y, safeX, safeY);
        return len !== Infinity;
    },
    
    async move(page, gameState, finalTarget) {
        if (!finalTarget) return 'no_target';

        // 1. Stuck Check (Enhanced)
        const moved = Math.abs(gameState.hero.x - lastHeroPos.x) + Math.abs(gameState.hero.y - lastHeroPos.y);
        
        if (moved < 0.3) { // Very small movement threshold
            stuckCounter++;
        } else {
            stuckCounter = Math.max(0, stuckCounter - 1); // Decay slowly instead of instant reset
        }
        lastHeroPos = { ...gameState.hero };

        if (stuckCounter > CONSTANTS.STUCK_LIMIT) {
             logger.warn(`⚠️ Bot stuck (${stuckCounter} iterations)! Performing unstuck maneuver...`);
             
             // Aggressive multi-directional unstuck
             const directions = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
             const randDir1 = directions[Math.floor(Math.random() * directions.length)];
             const randDir2 = directions[Math.floor(Math.random() * directions.length)];
             
             await page.keyboard.press(randDir1, { delay: 100 });
             await sleep(100);
             await page.keyboard.press(randDir2, { delay: 100 });
             await sleep(300);
             
             stuckCounter = 0;
             return 'stuck_recovery';
        }
        
        // 2. Grid Management
        const grid = ensureGrid(gameState).clone();
        applyDynamicObstacles(grid, gameState); // Apply NPCs/Mobs

        // 3. A* Pathfinder
        const finder = new PF.AStarFinder({ allowDiagonal: false });
        // Clamp Start/End to Grid Bounds
        const startX = Math.max(0, Math.min(Math.round(gameState.hero.x), grid.width - 1));
        const startY = Math.max(0, Math.min(Math.round(gameState.hero.y), grid.height - 1));
        const endX = Math.max(0, Math.min(Math.round(finalTarget.x), grid.width - 1));
        const endY = Math.max(0, Math.min(Math.round(finalTarget.y), grid.height - 1));
        
        // Safety: Unlock Start & End
        if (finalTarget.isGateway) {
            grid.setWalkableAt(endX, endY, true);
        }
        grid.setWalkableAt(startX, startY, true);

        let path = null;
        try {
            // Special handling for ANY blocked target (Gateways OR Mobs on walls)
            // If target is unwalkable, find nearest walkable neighbor
            let targetX = endX;
            let targetY = endY;

            if (!grid.isWalkableAt(endX, endY)) {
                 logger.log(`   🧱 Target [${endX},${endY}] is blocked/wall. Searching nearest walkable tile (Radius 5)...`);
                 
                 // BFS search for nearest walkable tile spiraling out
                 const queue = [[endX, endY]];
                 const visited = new Set([`${endX},${endY}`]);
                 let found = false;
                 
                 // Radius limitation
                 const MAX_RADIUS = 5;
                 
                 while (queue.length > 0) {
                     const [cx, cy] = queue.shift();
                     
                     // Check if this tile is walkable
                     if (grid.isWalkableAt(cx, cy)) {
                         targetX = cx;
                         targetY = cy;
                         logger.log(`   📍 Found walkable spot: [${targetX}, ${targetY}] (Dist from GW: ${Math.max(Math.abs(targetX-endX), Math.abs(targetY-endY))})`);
                         found = true;
                         break;
                     }
                     
                     // Stop if too far
                     if (Math.abs(cx - endX) > MAX_RADIUS || Math.abs(cy - endY) > MAX_RADIUS) continue;
                     
                     // Add neighbors (8 directions)
                     const neighbors = [
                         [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
                         [cx + 1, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1]
                     ];
                     
                     // Sort neighbors by distance to Start (Hero)
                     neighbors.sort((a, b) => {
                         const da = Math.hypot(a[0] - startX, a[1] - startY);
                         const db = Math.hypot(b[0] - startX, b[1] - startY);
                         return da - db;
                     });
                     
                     for (const n of neighbors) {
                         const key = `${n[0]},${n[1]}`;
                         if (!visited.has(key)) {
                             visited.add(key);
                             // Verify bounds
                             if (n[0] >= 0 && n[0] < grid.width && n[1] >= 0 && n[1] < grid.height) {
                                 queue.push(n);
                             }
                         }
                     }
                 }

                 if (!found) logger.warn(`   ⚠️ Could not find ANY walkable tile near gateway [${endX},${endY}]!`);
            }

            path = finder.findPath(startX, startY, targetX, targetY, grid);
            
            // DIAGNOSTIC LOGS IF PATH FAILS
            if (!path || path.length === 0) {
                const isStartWalkable = grid.isWalkableAt(startX, startY);
                const isEndWalkable = grid.isWalkableAt(targetX, targetY);
                const dist = Math.hypot(targetX - startX, targetY - startY);
                
                logger.warn(`❌ Path Fail Diag: Start[${startX},${startY}] Walkable? ${isStartWalkable} | End[${targetX},${targetY}] Walkable? ${isEndWalkable} | Grid: ${gameState.map.w}x${gameState.map.h}`);

                // FALLBACK: Blind Move if close to target (< 5 tiles)
                // Handy for gateways that are slightly "in the wall" or bad collision data
                if (dist < 5) {
                    logger.warn(`⚠️ Path Fail near target (${dist.toFixed(1)}m). Attempting BLIND MOVE (Arrow Keys)...`);
                    const dx = targetX - startX;
                    const dy = targetY - startY;
                    let key = null;
                    
                    if (Math.abs(dx) > Math.abs(dy)) {
                        key = dx > 0 ? 'ArrowRight' : 'ArrowLeft';
                    } else {
                        key = dy > 0 ? 'ArrowDown' : 'ArrowUp';
                    }
                    
                    if (key) {
                        try {
                            await page.keyboard.press(key, { delay: 150 });
                            return 'move'; // Return success to keep loop logic happy
                        } catch(err) { }
                    }
                }
                
                return 'skip_target'; // Explicitly return failure status for index.js handling
            }

        } catch(e) { }

        if (path && path.length > 1) {
             const distTotal = Math.hypot(endX - startX, endY - startY);
             logger.log(`👣 Moving to [${finalTarget.nick || finalTarget.name}] (${distTotal.toFixed(1)}m, ${path.length} steps)`);
             
             pathfindFailCounter = 0;
             lastFailedTargetId = null;

             // Optimized Burst Mode
             // Unlimited steps for smooth movement (User Request)
             let stepsToTake = path.length - 1; 
             let currentX = startX;
             let currentY = startY;

             // Dynamic Key Press Duration
             // The FIRST step in a direction needs a longer hold (~250ms) to register as a move.
             // Subsequent steps (holding) can be faster (~170ms).
             const currentPing = Math.min(gameState.ping || 50, 1000); // safety cap
             const initialStepDelay = Math.min(Math.max(200, currentPing + 60), 2000); 
             const continuousStepDelay = Math.min(Math.max(170, currentPing + 30), 1000);
             
             let activeKey = null;

             for (let i = 1; i <= stepsToTake; i++) {
                 const nextStep = path[i];
                 if (!nextStep) break;
                 
                 // HARD SAFETY CHECK: Gateway
                 if (!finalTarget.isGateway && gameState.gateways) {
                     const isGw = gameState.gateways.some(g => g.x === nextStep[0] && g.y === nextStep[1]);
                     if (isGw) {
                         if (activeKey) await page.keyboard.up(activeKey);
                         logger.warn(`🛑 MOVEMENT ABORTED: Gateway ahead!`);
                         return 'fail';
                     }
                 }
                 
                 let requiredKey = '';
                 if (nextStep[0] > currentX) requiredKey = 'ArrowRight';
                 else if (nextStep[0] < currentX) requiredKey = 'ArrowLeft';
                 else if (nextStep[1] > currentY) requiredKey = 'ArrowDown';
                 else if (nextStep[1] < currentY) requiredKey = 'ArrowUp';
                 
                 if (requiredKey) {
                     let isNewStep = false;
                     
                     // Direction change or First key
                     if (activeKey && activeKey !== requiredKey) {
                         await page.keyboard.up(activeKey);
                         activeKey = null;
                         await sleep(50); // Break execution
                     }
                     
                     if (!activeKey) {
                         await page.keyboard.down(requiredKey);
                         activeKey = requiredKey;
                         isNewStep = true;
                     }
                     
                     // Wait appropriate time
                     // Usage of "isNewStep" ensures we hold the start longer to force movement
                     await sleep(isNewStep ? initialStepDelay : continuousStepDelay);
                     
                     currentX = nextStep[0];
                     currentY = nextStep[1];

                     // 🛡️ ACTIVE POSITION VERIFICATION (Every 3 steps)
                     if (i % 3 === 0) {
                         try {
                             // Fetch Position AND Fresh Obstacles (Mobs can move!)
                             const scanData = await page.evaluate(() => {
                                 const obs = [];
                                 if (typeof g !== 'undefined' && g.npc) {
                                     for (let key in g.npc) {
                                         const n = g.npc[key];
                                          // Type 4 = Gateways/Info (Walkable)
                                         if (n.type !== 4) obs.push({x: n.x, y: n.y});
                                     }
                                 }
                                 return { 
                                     x: Math.round(hero.x), 
                                     y: Math.round(hero.y),
                                     mapId: map.id,
                                     obstacles: obs
                                 };
                             });
                             
                             // 0. CRITICAL: Check if map changed (Teleport/TP Scroll)
                             if (scanData.mapId !== gameState.map.id) {
                                  if (activeKey) await page.keyboard.up(activeKey);
                                  logger.warn(`🌍 Map changed manually! (${gameState.map.id} -> ${scanData.mapId}). Aborting path.`);
                                  return 'fail'; // Main loop will pick up new map
                             }

                             const realPos = { x: scanData.x, y: scanData.y };
                             const distSync = Math.abs(realPos.x - currentX) + Math.abs(realPos.y - currentY);
                             
                             if (distSync > 1) {
                                 logger.warn(`⚠️ Desync (${distSync} tiles). Refreshing map & re-routing from [${realPos.x},${realPos.y}]...`);
                                 
                                 // 1. Rebuild Grid from Static Map (fresh state)
                                 const correctionGrid = ensureGrid(gameState).clone();
                                 
                                 // 2. Apply FRESH Obstacles (The mob that blocked us!)
                                 if (scanData.obstacles) {
                                     for (const o of scanData.obstacles) {
                                         if (correctionGrid.isWalkableAt(o.x, o.y)) {
                                             correctionGrid.setWalkableAt(o.x, o.y, false);
                                         }
                                     }
                                 }
                                 
                                 // 3. Ensure Target/Start are Unlock (Standard Logic)
                                 if (finalTarget.isGateway) correctionGrid.setWalkableAt(endX, endY, true);
                                 correctionGrid.setWalkableAt(realPos.x, realPos.y, true); 
                                 
                                 // 4. Find Path
                                 const newPath = finder.findPath(realPos.x, realPos.y, endX, endY, correctionGrid);
                                 
                                 if (newPath && newPath.length > 0) {
                                     logger.success(`   ✅ Found detour around obstacle! (${newPath.length} steps)`);
                                     path = newPath;
                                     stepsToTake = path.length - 1; 
                                     i = 0; 
                                     currentX = realPos.x;
                                     currentY = realPos.y;
                                     
                                     // If direction changed, we might need to toggle keys, but the next loop iter handles it.
                                     continue;
                                 } else {
                                     logger.warn(`🛑 Blocked by mob/wall! No path found. Aborting.`);
                                     if (activeKey) await page.keyboard.up(activeKey);
                                     return 'fail'; // Let main loop handle it (maybe attack?)
                                 }
                             }
                         } catch (e) { /* Ignore evaluate errors */ }
                     }
                 }
             }
             
             // Release at end of burst
             if (activeKey) {
                 await page.keyboard.up(activeKey);
             }
             
             return 'moved';
        } else {
             // Pathfinding Failed
             const targetId = finalTarget.id || `${finalTarget.x},${finalTarget.y}`;
             if (lastFailedTargetId === targetId) pathfindFailCounter++;
             else {
                 pathfindFailCounter = 1;
                 lastFailedTargetId = targetId;
             }
             
             logger.log(`❌ [${pathfindFailCounter}/${CONSTANTS.PATHFIND_FAIL_LIMIT}] Pathfinding FAIL`);

             if (pathfindFailCounter >= CONSTANTS.PATHFIND_FAIL_LIMIT) {
                 logger.warn(`🚫 Skipping unreachable target...`);
                 pathfindFailCounter = 0;
                 lastFailedTargetId = null;
                 return 'skip_target';
             }
             await sleep(200);
             return 'fail';
        }
    }
};

module.exports = movement;
