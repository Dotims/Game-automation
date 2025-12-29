const logger = require('../utils/logger');

async function getGameState(page, config) {
    return await page.evaluate((cfg) => {
        if (typeof g === 'undefined' || !g.npc || !hero || !map) return null;
        if (g.battle) return { battle: true };

        const obstacles = []; 
        const validMobs = []; // ALL valid mobs for path-based selection
        let allMobsCount = 0;
        let deniedCount = 0;
        
        // --- Ping Reading ---
        let ping = 50; // Default safe value
        const lagMeter = document.getElementById('lagmeter');
        if (lagMeter) {
            const tip = lagMeter.getAttribute('tip'); // e.g. "198ms"
            if (tip) {
                 const match = tip.match(/(\d+)ms/);
                 if (match && match[1]) {
                     ping = parseInt(match[1], 10);
                 }
            }
        }
        
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
                // Collect ALL valid mobs instead of just the nearest
                validMobs.push({ 
                    x: n.x, y: n.y, id: n.id, nick: n.nick, lvl: n.lvl, 
                    type: 'mob', isGateway: false, dist: dist 
                });
            }
        }
        
        // Sort by geometric distance as baseline (will be re-evaluated with pathfinding)
        validMobs.sort((a, b) => a.dist - b.dist);

        // --- 2. Gateways (DOM Parsing) ---
        // Parse gateways directly from DOM elements (Most reliable method)
        let gateways = [];
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
            target: validMobs.length > 0 ? validMobs[0] : null, // Fallback: nearest by geometry
            validMobs: validMobs, // NEW: All mobs for path-based selection
            gateways: gateways,
            obstacles: obstacles,
            debugInfo: { allMobsCount, deniedCount, validMobsCount: validMobs.length },
            currentMapName: map.name,
            pvp: !!document.getElementById('pvpmode'), // Detect PvP map
            ping: ping, // Expose dynamic ping
            dazed: (() => {
                const el = document.getElementById('dazed');
                if (el && el.style.display !== 'none') {
                    const txt = el.innerText || "";
                    let seconds = 0;
                    const minMatch = txt.match(/(\d+)\s*min/);
                    const secMatch = txt.match(/(\d+)\s*s/);
                    
                    if (minMatch) seconds += parseInt(minMatch[1]) * 60;
                    if (secMatch) seconds += parseInt(secMatch[1]);
                    
                    return { active: true, seconds: seconds > 0 ? seconds : 5 }; // Default 5s if parse fail
                }
                return null;
            })(),
            hero: { 
                x: hero.x, 
                y: hero.y,
                hp: hero.hp,
                maxhp: hero.maxhp
            },
            potionsCount: (() => {
                 let count = 0;
                 const bag = document.querySelector('#bag');
                 if (bag) {
                     const items = bag.querySelectorAll('.item');
                     for (const item of items) {
                         const tip = item.getAttribute('tip');
                         if (tip && tip.includes('Leczy') && !tip.includes('Pełne leczenie')) {
                             // "Pełne leczenie" usually implies NPC heal option or special item, 
                             // identifying standard pots via "Leczy" is safe enough for now.
                             // Ideally check item ID or name, but tip parsing is generic.
                             count++;
                         }
                     }
                 }
                 return count;
            })()
        };
    }, config);
}

module.exports = { getGameState };
