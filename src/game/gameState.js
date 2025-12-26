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

        // --- 2. Gateways (DOM Parsing) ---
        // Parse gateways directly from DOM elements (Most reliable method)
        const gwElements = document.querySelectorAll('.gw');
        for (const el of gwElements) {
             const tip = el.getAttribute('tip') || '';
             // Strip HTML tags if any to get clean name
             const name = tip.replace(/<[^>]*>/g, '').trim(); 
             
             // Calculate coordinates from CSS positioning (32px tiles)
             const left = parseInt(el.style.left) || 0;
             const top = parseInt(el.style.top) || 0;
             const x = Math.round(left / 32);
             const y = Math.round(top / 32);
             
             if (name) {
                 gateways.push({ 
                     x, 
                     y, 
                     name, 
                     type: 'gateway',
                     isGateway: true
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
            currentMapName: map.name,
            pvp: !!document.getElementById('pvpmode') // Detect PvP map
        };
    }, config);
}

module.exports = { getGameState };
