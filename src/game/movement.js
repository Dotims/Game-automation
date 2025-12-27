const PF = require('pathfinding');
const logger = require('../utils/logger');
const { CONSTANTS } = require('../config');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    
    const startX = Math.round(heroX);
    const startY = Math.round(heroY);
    let endX = Math.round(targetX);
    let endY = Math.round(targetY);
    
    // If target is on a wall, find nearest walkable neighbor
    if (!gridClone.isWalkableAt(endX, endY)) {
        const neighbors = [
            [endX + 1, endY], [endX - 1, endY],
            [endX, endY + 1], [endX, endY - 1]
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
 * Find the best target from validMobs based on actual A* path length
 * This ensures the bot always picks the mob with the shortest REACHABLE path
 */
function findBestTarget(gameState, maxCandidates = 8) {
    if (!gameState.validMobs || gameState.validMobs.length === 0) {
        return null;
    }
    
    const grid = ensureGrid(gameState);
    const heroX = gameState.hero.x;
    const heroY = gameState.hero.y;
    
    // Limit candidates to avoid performance issues on maps with many mobs
    // validMobs is already sorted by geometric distance
    const candidates = gameState.validMobs.slice(0, maxCandidates);
    
    let bestMob = null;
    let bestPathLength = Infinity;
    
    for (const mob of candidates) {
        const pathLength = getPathLength(grid, heroX, heroY, mob.x, mob.y);
        
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
        
        // 2. Grid Management (use shared function)
        const grid = ensureGrid(gameState).clone();

        // 3. A* Pathfinding
        const finder = new PF.AStarFinder({ allowDiagonal: false });
        const startX = Math.round(gameState.hero.x);
        const startY = Math.round(gameState.hero.y);
        const endX = Math.round(finalTarget.x);
        const endY = Math.round(finalTarget.y);

        let path = null;
        try {
            // Special handling for ANY blocked target (Gateways OR Mobs on walls)
            // If target is unwalkable, find nearest walkable neighbor
            let targetX = endX;
            let targetY = endY;

            if (!grid.isWalkableAt(endX, endY)) {
                 logger.log(`   🧱 Target [${endX},${endY}] is blocked/wall. Searching neighbors...`);
                 
                 // Check neighbors (Right, Left, Down, Up)
                 const neighbors = [
                     [endX + 1, endY], [endX - 1, endY],
                     [endX, endY + 1], [endX, endY - 1]
                 ];
                 
                 // Sort neighbors by distance to hero to pick the closest accessible side
                 neighbors.sort((a,b) => {
                     const da = Math.hypot(a[0] - startX, a[1] - startY);
                     const db = Math.hypot(b[0] - startX, b[1] - startY);
                     return da - db;
                 });

                 let found = false;
                 for (const n of neighbors) {
                     const isWalkable = grid.isWalkableAt(n[0], n[1]);
                     
                     if (isWalkable) {
                         targetX = n[0];
                         targetY = n[1];
                         logger.log(`   📍 Found walkable neighbor: [${targetX}, ${targetY}]`);
                         found = true;
                         break;
                     }
                 }
                 if (!found) logger.warn(`   ⚠️ All neighbors of target [${endX},${endY}] are BLOCKED!`);
            }

            path = finder.findPath(startX, startY, targetX, targetY, grid);
            
            // DIAGNOSTIC LOGS IF PATH FAILS
            if (!path || path.length === 0) {
                const isStartWalkable = grid.isWalkableAt(startX, startY);
                const isEndWalkable = grid.isWalkableAt(targetX, targetY);
                logger.warn(`❌ Path Fail Diag: Start[${startX},${startY}] Walkable? ${isStartWalkable} | End[${targetX},${targetY}] Walkable? ${isEndWalkable} | Grid: ${gameState.map.w}x${gameState.map.h}`);
            }

        } catch(e) { }

        if (path && path.length > 1) {
             const distTotal = Math.hypot(endX - startX, endY - startY);
             logger.log(`👣 Moving to [${finalTarget.nick || finalTarget.name}] (${distTotal.toFixed(1)}m, ${path.length} steps)`);
             
             pathfindFailCounter = 0;
             lastFailedTargetId = null;

             // Optimized Burst Mode
             const stepsToTake = Math.min(path.length - 1, CONSTANTS.BURST_STEPS || 4);
             let currentX = startX;
             let currentY = startY;

             // Dynamic Key Press Duration based on Ping
             // Minimum 100ms (to register as hold), max based on ping to prevent early release
             // User requested: "Ping + safety buffer"
             const currentPing = gameState.ping || 50;
             const pressDuration = Math.max(100, currentPing + 20); 

             for (let i = 1; i <= stepsToTake; i++) {
                 const nextStep = path[i];
                 if (!nextStep) break;
                 
                 let key = '';
                 if (nextStep[0] > currentX) key = 'ArrowRight';
                 else if (nextStep[0] < currentX) key = 'ArrowLeft';
                 else if (nextStep[1] > currentY) key = 'ArrowDown';
                 else if (nextStep[1] < currentY) key = 'ArrowUp';
                 
                 if (key) {
                     await page.keyboard.press(key, { delay: pressDuration });
                     
                     await sleep(20); 
                     currentX = nextStep[0];
                     currentY = nextStep[1];
                 }
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
