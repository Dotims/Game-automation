const logger = require('../utils/logger');

async function getGameState(page, config) {
    return await page.evaluate((cfg) => {
        if (typeof g === 'undefined' || !g.npc || !hero || !map) return null;
        if (g.battle) return { battle: true };

        let bestTarget = null;
        let minDistance = 9999;
        const obstacles = []; 
        let allMobsCount = 0;
        let deniedCount = 0;
        
        // --- 1. Map Objects & Mobs ---
        for (let id in g.npc) {
            const n = g.npc[id];
            
            // Obstacles for pathfinding (dynamic)
            obstacles.push({ x: n.x, y: n.y, id: n.id });

            const isMob = (n.type === 2 || n.type === 3);
            if (isMob) allMobsCount++;

            // SKIP BLACKLISTED MOBS
            if (cfg.skippedMobIds && cfg.skippedMobIds.includes(n.id)) {
                deniedCount++;
                continue;
            }

            const mobLvl = n.lvl || 0;
            const inLevelRange = (mobLvl >= cfg.minLvl && mobLvl <= cfg.maxLvl);
            
            const isPriority = isMob && inLevelRange;

            if (isPriority) {
                const dist = Math.hypot(n.x - hero.x, n.y - hero.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestTarget = { 
                        x: n.x, y: n.y, id: n.id, nick: n.nick, lvl: n.lvl, 
                        type: 'mob', isGateway: false, dist: dist 
                    };
                }
            }
        }

        // --- 2. Gateways ---
        let finalTarget = bestTarget;
        let gateways = [];

        if (g.townname) {
             for (let key in g.townname) {
                const coords = key.split(',');
                gateways.push({ 
                    x: parseInt(coords[0]), 
                    y: parseInt(coords[1]), 
                    name: g.townname[key] 
                });
             }
        }

        return {
            hero: { x: hero.x, y: hero.y },
            map: { id: map.id, w: map.x, h: map.y, col: map.col }, 
            battle: false,
            target: finalTarget,
            gateways: gateways,
            obstacles: obstacles,
            debugInfo: { allMobsCount, deniedCount },
            currentMapName: map.name // Logic for map rotation needs this
        };
    }, config);
}

module.exports = { getGameState };
