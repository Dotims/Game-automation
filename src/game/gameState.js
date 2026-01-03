const logger = require('../utils/logger');

async function getGameState(page, config) {
    return await page.evaluate((cfg) => {
        if (typeof g === 'undefined' || !g.npc || !hero || !map) return null;
        // if (g.battle) return { battle: true }; // REMOVED: We need full state to check for Death/Logs

        const obstacles = []; 
        const validMobs = []; // ALL valid mobs for path-based selection
        const allMobs = [];   // NEW: ALL visible mobs (ignoring level/blacklist)
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
            // Fix: Exclude Type 4 (Gateways/Info) as they are handled via DOM gateways or shouldn't block
            if (n.type !== 4) {
                obstacles.push({ x: n.x, y: n.y, id: n.id });
            }

            const isMob = (n.type === 2 || n.type === 3);
            if (isMob) {
                allMobsCount++;
                allMobs.push({
                     x: n.x, y: n.y, id: n.id, nick: n.nick, lvl: n.lvl, 
                     type: 'mob', isGateway: false
                });
            }

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

        // --- Extract Dazed State ---
            const dazedState = (() => {
                const el = document.getElementById('dazed');
                if (el && el.offsetParent !== null && el.innerText.trim().length > 0) {
                    const txt = el.innerText || "";
                    let seconds = 0;
                    const minMatch = txt.match(/(\d+)\s*min/);
                    const secMatch = txt.match(/(\d+)\s*s/);
                    if (minMatch) seconds += parseInt(minMatch[1]) * 60;
                    if (secMatch) seconds += parseInt(secMatch[1]);
                    return { active: true, seconds: seconds > 0 ? seconds : 5 }; 
                }
                return null;
            })();

            // --- Extract Potions Data ---
            const potionsData = (() => {
                 let count = 0;
                 let stackSize = 30; // Default
                 const bag = document.querySelector('#bag');
                 if (bag) {
                     const items = bag.querySelectorAll('.item');
                     for (const item of items) {
                         const tip = item.getAttribute('tip');
                         if (tip && tip.includes('Leczy') && !tip.includes('Pełne leczenie')) {
                             // Quantity
                             const qtyMatch = tip.match(/Ilość:.*?class="amount-text">(\d+)/) || tip.match(/Ilość:\s*(\d+)/);
                             const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                             count += qty;
                             
                             // Stack Size
                             const stackMatch = tip.match(/Maksimum.*?class="damage">(\d+)/) || 
                                                tip.match(/W jednej paczce:?\s*(\d+)/i) || 
                                                tip.match(/Stack:?\s*(\d+)/i);
                             if (stackMatch) {
                                 stackSize = parseInt(stackMatch[1]);
                             }
                         }
                     }
                 }
                 return { count, stackSize };
            })();

        return {
            hero: { x: hero.x, y: hero.y, hp: hero.hp, maxhp: hero.maxhp },
            map: { id: map.id, w: map.x, h: map.y, col: map.col }, 
            battle: !!g.battle,
            target: validMobs.length > 0 ? validMobs[0] : null, // Fallback: nearest by geometry
            validMobs: validMobs, // ALL valid mobs for path-based selection
            allMobs: allMobs,     // NEW: ALL visible mobs
            gateways: gateways,
            obstacles: obstacles,
            debugInfo: { allMobsCount, deniedCount, validMobsCount: validMobs.length },
            currentMapName: map.name,
            pvp: !!document.getElementById('pvpmode'), // Detect PvP map
            ping: ping, // Expose dynamic ping
            dazed: dazedState,
            potionsCount: potionsData.count,
            potionStackSize: potionsData.stackSize,
            
            // --- Inventory Analysis ---
            inventory: (() => {
                 let used = 0;
                 let capacity = 100; // Default safe value
                 const bag = document.querySelector('#bag');
                 if (bag) {
                     // 1. Capacity
                     const header = bag.querySelector('.bag-header') || bag.querySelector('.title');
                     if (header) {
                         const match = header.innerText.match(/(\d+)\s*\/\s*(\d+)/);
                         if (match) {
                             used = parseInt(match[1]);
                             capacity = parseInt(match[2]);
                         }
                     }
                     // Fallback: Count items if header parsing failed but bag exists
                     const items = bag.querySelectorAll('.item');
                     if ((!header || !header.innerText.includes('/')) && items) {
                         used = items.length;
                     }
                 }
                 return { used, capacity, isFull: used >= capacity };
            })(),

            isDead: (() => {
                // Strict check: Only 0 HP is Dead.
                if (hero.hp === 0) return true;

                // Battle Log Check for "Poległ [MyNick]"
                if (g.battle) {
                    const log = document.getElementById('battlelog');
                    if (log && hero.nick && log.innerText.includes('Poległ ' + hero.nick)) {
                        return true;
                    }
                }
                return false;
            })(),
            battleFinished: (() => {
                 const timer = document.getElementById('battletimer');
                 // Check for "Walka zakończona" or similar end states
                 return timer && (timer.innerText.includes('zakończona') || timer.innerText.includes('przerwana'));
            })(),
            battleCloseVisible: (() => {
                const el = document.getElementById('battleclose');
                // Check if button exists and has some visibility (offsetParent)
                return el && el.offsetParent !== null; 
            })(),
            blockingWindow: (() => {
                const el = document.getElementById('centerbox2');
                return el && el.style.display !== 'none' && el.offsetParent !== null;
            })()
        };
    }, config);
}

module.exports = { getGameState };
