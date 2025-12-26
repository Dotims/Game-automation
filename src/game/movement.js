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

const movement = {
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
        
        // 2. Grid Management (Optimized)
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

        const grid = baseGrid.clone(); // Clone base grid to add dynamic obstacles
        
        // 3. Dynamic Obstacles (Mobs) - REMOVED
        // In Margonem, you can typically walk through mobs.
        // Treating them as walls causes the bot to get stuck in dense crowds.
        // if (gameState.obstacles) {
        //    for (const obs of gameState.obstacles) {
        //        if (finalTarget.type === 'mob' && obs.id === finalTarget.id) continue;
        //        if (grid.isWalkableAt(obs.x, obs.y)) {
        //             grid.setWalkableAt(obs.x, obs.y, false);
        //        }
        //    }
        // }

        // 4. A* Pathfinding
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
             logger.log(`👣 Moving to [${finalTarget.nick || finalTarget.name}] (${distTotal.toFixed(1)}m)`);
             
             pathfindFailCounter = 0;
             lastFailedTargetId = null;

             // Optimized Burst Mode
             const stepsToTake = Math.min(path.length - 1, CONSTANTS.BURST_STEPS || 4);
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
