/**
 * MargoSzpont Bot - Local Development Version
 * Kod do testowania lokalnie - NIE używa serwera
 * v1.2 - Dodano Pathfinding (A*), Kolizje i Captcha
 */

(function() {
    'use strict';
    if (window.MARGOBOT_INJECTED) return;
    window.MARGOBOT_INJECTED = true;
    window.MARGOBOT_STOP = false;

    console.log('🤖 MargoSzpont v1.2 LOCAL loaded (Pathfinding enabled)!');

    // ==================== HUNTING SPOTS DATA ====================
    const HUNTING_SPOTS = [
        { name: "Grobowce (18lvl)", min: 15, max: 25, maps: ["Krypta Rodu Heregata", "Grobowiec Rodziny Tywelta"] },
        { name: "Mrówki (20lvl)", min: 17, max: 27, maps: ["Kopiec Mrówek p.2", "Mrowisko"] },
        { name: "Pumy i tygrysy (21lvl)", min: 18, max: 28, maps: ["Kryjówka Dzikich Kotów", "Tygrysia Polana"] },
        { name: "Gobliny (34lvl)", min: 30, max: 40, maps: ["Las Goblinów", "Jaskinia Pogardy"] },
        { name: "Ghule (40lvl)", min: 36, max: 46, maps: ["Ghuli Mogilnik", "Zapomniany Grobowiec p.1"] },
        { name: "Wilcze plemię (44lvl)", min: 40, max: 50, maps: ["Krasowa Pieczara p.1", "Wilcza Nora p.1"] },
        { name: "Orkowie (47lvl)", min: 43, max: 53, maps: ["Zburzona Twierdza", "Świszcząca Grota p.1"] },
        { name: "Gnolle (64lvl)", min: 60, max: 70, maps: ["Radosna Polana", "Wioska Gnolli"] },
        { name: "Andarum (70lvl)", min: 66, max: 76, maps: ["Andarum Ilami", "Cmentarzysko Szerpów"] },
        { name: "Mumie (114lvl)", min: 110, max: 120, maps: ["Oaza Siedmiu Wichrów", "Złote Piaski"] }
    ];

    // ==================== CONFIG ====================
    let config = { 
        minLvl: 1, 
        maxLvl: 999, 
        autoHeal: true, 
        potionSlots: 14, 
        maps: [], 
        mode: 'exp', 
        transportMap: '', 
        e2Monster: '', 
        e2Attack: true 
    };
    
    // Load saved config
    try { 
        const s = localStorage.getItem('MARGO_BOT_CFG'); 
        if(s) config = {...config, ...JSON.parse(s)}; 
    } catch(e){}
    
    let uiState = { tab: 'exp' };
    try { 
        const s = localStorage.getItem('MARGO_UI_STATE'); 
        if(s) uiState = {...uiState, ...JSON.parse(s)}; 
    } catch(e){}

    let botActive = false;
    let savedBotActive = false;
    try {
        savedBotActive = localStorage.getItem('MARGO_BOT_ACTIVE') === 'true';
    } catch(e){}
    let currentMapIndex = 0;

    // ==================== PATHFINDING & COLLISION SYSTEM ====================
    
    class Grid {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.nodes = new Uint8Array(width * height); // 0 = walkable, 1 = blocked
        }

        isWalkableAt(x, y) {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            return this.nodes[y * this.width + x] === 0;
        }

        setWalkableAt(x, y, walkable) {
            this.nodes[y * this.width + x] = walkable ? 0 : 1;
        }
        
        clone() {
            const newGrid = new Grid(this.width, this.height);
            newGrid.nodes.set(this.nodes);
            return newGrid;
        }
    }

    class AStarFinder {
        findPath(startX, startY, endX, endY, grid) {
            const openList = [];
            const closedList = new Set();
            const cameFrom = {}; // Key: "x,y", Value: parent node {x, y}
            const gScore = {}; // Key: "x,y", Value: cost
            const fScore = {}; // Key: "x,y", Value: cost + heuristic

            const startKey = `${startX},${startY}`;
            gScore[startKey] = 0;
            fScore[startKey] = Math.abs(startX - endX) + Math.abs(startY - endY);
            
            openList.push({ x: startX, y: startY, f: fScore[startKey] });

            while (openList.length > 0) {
                // Get node with lowest fScore
                openList.sort((a, b) => a.f - b.f);
                const current = openList.shift();
                const currentKey = `${current.x},${current.y}`;

                if (current.x === endX && current.y === endY) {
                    return this.reconstructPath(cameFrom, current);
                }

                closedList.add(currentKey);

                const neighbors = [
                    { x: current.x, y: current.y - 1 }, // Up
                    { x: current.x, y: current.y + 1 }, // Down
                    { x: current.x - 1, y: current.y }, // Left
                    { x: current.x + 1, y: current.y }  // Right
                ];

                for (const neighbor of neighbors) {
                    const neighborKey = `${neighbor.x},${neighbor.y}`;
                    
                    if (closedList.has(neighborKey)) continue;
                    if (!grid.isWalkableAt(neighbor.x, neighbor.y)) continue;

                    const tentativeGScore = (gScore[currentKey] || 0) + 1;

                    if (tentativeGScore < (gScore[neighborKey] || Infinity)) {
                        cameFrom[neighborKey] = current;
                        gScore[neighborKey] = tentativeGScore;
                        fScore[neighborKey] = tentativeGScore + (Math.abs(neighbor.x - endX) + Math.abs(neighbor.y - endY));
                        
                        // Add to openList if not present (simplified check)
                        const isInOpen = openList.find(n => n.x === neighbor.x && n.y === neighbor.y);
                        if (!isInOpen) {
                            openList.push({ x: neighbor.x, y: neighbor.y, f: fScore[neighborKey] });
                        }
                    }
                }
            }
            return []; // No path found
        }

        reconstructPath(cameFrom, current) {
            const totalPath = [current];
            let currKey = `${current.x},${current.y}`;
            while (cameFrom[currKey]) {
                current = cameFrom[currKey];
                currKey = `${current.x},${current.y}`;
                totalPath.unshift(current);
            }
            return totalPath; // Includes start node
        }
    }

    let currentGrid = null;
    let cachedMapId = null;
    const pathfinder = new AStarFinder();

    function updateCollisionGrid() {
        if (!map || typeof map.col !== 'string') return;
        
        if (cachedMapId === map.id && currentGrid) return; // Cache hit

        console.log(`[MargoSzpont] Building collision grid for map ${map.id} (${map.x}x${map.y})...`);
        currentGrid = new Grid(map.x, map.y);
        const colStr = map.col;
        
        let c = 0;
        for (let y = 0; y < map.y; y++) {
            for (let x = 0; x < map.x; x++) {
                if (colStr[c] === '1') currentGrid.setWalkableAt(x, y, false);
                c++;
            }
        }
        
        // Mark gateways as obstacles (optional preference from original bot?)
        // Original bot marked gateways as unwalkable in movement.js line 38, likely to avoid accidental map changes
        // But for "Transport" mode we need to walk ON them.
        // Let's keep them walkable for now, or the bot won't enter them. 
        // Original code: if (baseGrid.isWalkableAt(gw.x, gw.y)) baseGrid.setWalkableAt(gw.x, gw.y, false);
        // User wants 1:1. Orig bot avoids gateways during normal movement to not accidentally zone.
        // I will replicate this logic ONLY if we are NOT trying to enter a gateway.
        
        cachedMapId = map.id;
    }

    // ==================== UTILITIES ====================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const log = (msg) => console.log('[MargoSzpont] ' + msg);

    // ==================== GAME STATE ====================
    function getGameState() {
        if (typeof g === 'undefined' || !g.npc || typeof hero === 'undefined' || typeof map === 'undefined') {
            return null;
        }
        
        updateCollisionGrid();

        // CAPTCHA DETECTION - use class .captcha not id #captcha
        const captchaEl = document.querySelector('.captcha');
        const hasCaptcha = captchaEl && 
                           captchaEl.style.display !== 'none' && 
                           captchaEl.offsetParent !== null &&
                           captchaEl.querySelector('.captcha__buttons');

        const validMobs = [];
        for (let id in g.npc) {
            const n = g.npc[id];
            if ((n.type === 2 || n.type === 3) && n.lvl >= config.minLvl && n.lvl <= config.maxLvl && n.wt > 0) {
                validMobs.push({ 
                    x: n.x, y: n.y, id: n.id, nick: n.nick, lvl: n.lvl, 
                    dist: Math.hypot(n.x - hero.x, n.y - hero.y) 
                });
            }
        }
        validMobs.sort((a, b) => a.dist - b.dist);
        
        const gateways = [];
        document.querySelectorAll('.gw').forEach(el => {
            const tip = (el.getAttribute('tip') || '').replace(/<[^>]*>/g, '').trim();
            if (tip) gateways.push({ 
                x: Math.round((parseInt(el.style.left)||0)/32), 
                y: Math.round((parseInt(el.style.top)||0)/32), 
                name: tip, 
                element: el
            });
        });
        
        const inBattle = !!g.battle;
        const battleTimer = document.getElementById('battletimer');
        const battleClose = document.getElementById('battleclose');
        let battleFinished = false;
        if (battleTimer) {
            const text = battleTimer.innerText || '';
            battleFinished = text.includes('zakończona') || text.includes('przerwana');
        }
        if (battleClose && battleClose.offsetParent !== null) battleFinished = true;
        
        return { 
            hero: { x: hero.x, y: hero.y, hp: hero.hp, maxhp: hero.maxhp }, 
            mapName: map.name, 
            battle: inBattle,
            battleFinished: battleFinished && inBattle,
            validMobs, gateways, target: validMobs[0] || null,
            captcha: hasCaptcha
        };
    }

    // ==================== KEYBOARD SIMULATION ====================
    // Symulacja naciśnięcia klawisza - z opcją repeat
    function pressKey(key, holdMs = 150) {
        const target = document.body; // Dispatch on body, not document
        const eventInit = {
            key: key,
            code: key.startsWith('Arrow') ? key : 'Key' + key.toUpperCase(),
            keyCode: getKeyCode(key),
            which: getKeyCode(key),
            bubbles: true, cancelable: true, view: window,
            repeat: false
        };
        
        target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        setTimeout(() => { target.dispatchEvent(new KeyboardEvent('keyup', eventInit)); }, holdMs);
        return true;
    }

    function sendKeyPulse(key) {
        const target = document.body;
        const eventInit = {
            key: key,
            code: key.startsWith('Arrow') ? key : 'Key' + key.toUpperCase(),
            keyCode: getKeyCode(key),
            which: getKeyCode(key),
            bubbles: true, cancelable: true, view: window,
            repeat: true // Symulacja przytrzymania
        };
        target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    }
    
    function getKeyCode(key) {
        const codes = { 'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39, 'e': 69, 'E': 69 };
        return codes[key] || key.charCodeAt(0);
    }
    
    // ==================== MOVEMENT (PATHFINDING & SMOOTH EXECUTION) ====================
    
    // Hold key state tracking
    let activeKey = null;

    // Helper to release any held key
    function releaseKey() {
        if (activeKey) {
            const target = document.body;
            const eventInit = {
                key: activeKey,
                code: activeKey.startsWith('Arrow') ? activeKey : 'Key' + activeKey.toUpperCase(),
                keyCode: getKeyCode(activeKey),
                which: getKeyCode(activeKey),
                bubbles: true, cancelable: true, view: window,
                repeat: false
            };
            target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
            activeKey = null;
        }
    }

    // MAIN MOVEMENT FUNCTION - Enhanced with per-step verification
    async function walkPath(path) {
        if (!path || path.length <= 1) return;

        const stepsToTake = path.length - 1;
        const target = document.body; // Use body for event dispatch

        // Timings
        const storedPing = (typeof window.ping !== 'undefined') ? window.ping : 50;
        const currentPing = Math.min(storedPing, 1000); 
        const stepDelay = Math.min(Math.max(180, currentPing + 40), 1000);

        for (let i = 1; i <= stepsToTake; i++) {
            if (!botActive || window.MARGOBOT_STOP) break;

            const nextStep = path[i];
            const prevStep = path[i-1];
            
            // --- Verification BEFORE each step ---
            const realX = Math.round(hero.x);
            const realY = Math.round(hero.y);
            
            // If we're not where we expected to be, abort and recalculate
            if (Math.abs(realX - prevStep.x) > 1 || Math.abs(realY - prevStep.y) > 1) {
                console.log(`[MargoSzpont] Desync detected! Expected: ${prevStep.x},${prevStep.y}, Actual: ${realX},${realY}. Recalculating path.`);
                releaseKey();
                return;
            }

            // Check for map change, captcha, battle, stasis
            if (map.id !== cachedMapId) { releaseKey(); return; }
            if (g.battle) { releaseKey(); return; }
            
            const captchaEl = document.querySelector('.captcha');
            if (captchaEl && captchaEl.style.display !== 'none' && captchaEl.offsetParent !== null) {
                releaseKey(); return;
            }
            
            const stasisEl = document.getElementById('stasis-incoming-overlay');
            if (stasisEl && stasisEl.style.display !== 'none' && stasisEl.offsetParent !== null) {
                releaseKey(); return;
            }

            // Determine required key
            let requiredKey = '';
            if (nextStep.x > realX) requiredKey = 'ArrowRight';
            else if (nextStep.x < realX) requiredKey = 'ArrowLeft';
            else if (nextStep.y > realY) requiredKey = 'ArrowDown';
            else if (nextStep.y < realY) requiredKey = 'ArrowUp';
            
            if (!requiredKey) continue; // Already at this step

            // Change direction if needed
            if (activeKey && activeKey !== requiredKey) {
                releaseKey();
                await sleep(30);
            }
            
            // Press or pulse key
            if (!activeKey) {
                const eventInit = {
                    key: requiredKey,
                    code: requiredKey,
                    keyCode: getKeyCode(requiredKey),
                    which: getKeyCode(requiredKey),
                    bubbles: true, cancelable: true, view: window
                };
                target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
                activeKey = requiredKey;
            } else {
                sendKeyPulse(activeKey);
            }
            
            // Wait for movement
            await sleep(stepDelay);
        }
        
        releaseKey();
    }

    // Creates a fresh grid with mobs marked as obstacles (except target)
    function createPathfindingGrid(targetMobId) {
        if (!currentGrid) return null;
        
        const grid = currentGrid.clone();
        
        // Mark ALL mobs as obstacles (except the target we want to reach)
        if (typeof g !== 'undefined' && g.npc) {
            for (let id in g.npc) {
                const n = g.npc[id];
                if (n.id === targetMobId) continue; // Don't block our target
                if (n.x >= 0 && n.y >= 0 && n.x < map.x && n.y < map.y) {
                    if (grid.isWalkableAt(n.x, n.y)) {
                        grid.setWalkableAt(n.x, n.y, false);
                    }
                }
            }
        }
        
        return grid;
    }

    // Enhanced moveToTarget with reachability check and mob avoidance
    async function moveToTarget(targetX, targetY, targetMobId = null) {
        if (!currentGrid) return false;
        
        const startX = Math.round(hero.x);
        const startY = Math.round(hero.y);
        
        // Already adjacent - no need to move
        if (Math.abs(startX - targetX) <= 1 && Math.abs(startY - targetY) <= 1) {
            return true;
        }
        
        // Get grid with mobs as obstacles
        const grid = createPathfindingGrid(targetMobId);
        if (!grid) return false;
        
        // Ensure target is walkable (mobs stand on walkable tiles)
        if (!grid.isWalkableAt(targetX, targetY)) {
            grid.setWalkableAt(targetX, targetY, true);
        }
        
        // Calculate path
        const path = pathfinder.findPath(startX, startY, targetX, targetY, grid);
        
        if (path && path.length > 1) {
            console.log(`[MargoSzpont] Path found: ${path.length} steps from (${startX},${startY}) to (${targetX},${targetY})`);
            await walkPath(path);
            return true;
        } else {
            console.log(`[MargoSzpont] No path to (${targetX},${targetY}) - target unreachable or blocked`);
            return false;
        }
    }
    
    function attackTarget(t) {
        if (!t) return false;
        
        // Check if we're in attack range (8-way: max 1 tile in any direction)
        const dx = Math.abs(hero.x - t.x);
        const dy = Math.abs(hero.y - t.y);
        
        if (dx <= 1 && dy <= 1) {
            // Direct packet attack using game's internal function
            if (typeof window._g === 'function') {
                window._g(`fight&a=attack&ff=1&id=-${t.id}`);
                console.log(`[MargoSzpont] Attack packet sent for ${t.nick} (ID: ${t.id})`);
                return true;
            }
        }
        
        // Fallback to 'E' key
        pressKey('e', 100);
        return true;
    }
    
    // ==================== CAPTCHA SOLVER ====================
    
    // Inject code to click in Page Context (bypasses isolation)
    function clickInPageContext(selector, index) {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                try {
                    const els = document.querySelectorAll('${selector}');
                    const el = els[${index}];
                    if (el) {
                        // 1. Native click
                        el.click();
                        
                        // 2. Dispatch trusted-like events
                        const opts = {bubbles: true, cancelable: true, view: window};
                        el.dispatchEvent(new MouseEvent('mousedown', opts));
                        el.dispatchEvent(new MouseEvent('mouseup', opts));
                        el.dispatchEvent(new MouseEvent('click', opts));
                        
                        // 3. jQuery click (if present)
                        if (typeof $ !== 'undefined' && $(el).click) $(el).click();
                    }
                } catch(e) { console.error('Captcha click error:', e); }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }
    
    async function solveCaptcha() {
        log('🚨 CAPTCHA DETECTED! Starting solver...');
        
        // Get question and buttons
        const questionEl = document.querySelector('.captcha__question');
        const question = questionEl ? questionEl.innerText : '';
        log(`❓ Question: "${question}"`);
        
        const buttons = Array.from(document.querySelectorAll('.captcha__buttons .btn')).map((btn, index) => {
            const fontEl = btn.querySelector('.gfont');
            return {
                index: index,
                text: fontEl ? fontEl.getAttribute('name') : '',
                element: btn,
                isActive: btn.classList.contains('active')
            };
        });
        
        log(`🔠 Options: ${buttons.map(b => b.text).join(', ')}`);
        
        // Find correct answers (containing *)
        const correctButtons = buttons.filter(btn => btn.text.includes('*'));
        
        if (correctButtons.length === 0) {
            log('⚠️ No matches for pattern (*)!');
            return false;
        }
        
        log(`✅ Found ${correctButtons.length} correct answers`);
        
        // Shuffle for randomness (human-like)
        for (let i = correctButtons.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [correctButtons[i], correctButtons[j]] = [correctButtons[j], correctButtons[i]];
        }
        
        // Click each correct button with delay
        for (const btn of correctButtons) {
            // Check active state again (refetch DOM to be sure)
            const freshBtn = document.querySelectorAll('.captcha__buttons .btn')[btn.index];
            if (freshBtn && freshBtn.classList.contains('active')) {
                log(`⏭️ Skipping "${btn.text}" (Already Selected)`);
                continue;
            }
            
            const thinkTime = Math.floor(Math.random() * 1700) + 800;
            log(`👆 Clicking: "${btn.text}" (in ${thinkTime}ms)`);
            await sleep(thinkTime);
            
            clickInPageContext('.captcha__buttons .btn', btn.index);
        }
        
        // Confirm solution
        const confirmDelay = Math.floor(Math.random() * 1500) + 1000;
        log(`🆗 Confirming solution (in ${confirmDelay}ms)...`);
        await sleep(confirmDelay);
        
        // Click confirm button (usually index 0 in .captcha__confirm .btn list)
        clickInPageContext('.captcha__confirm .btn', 0);
        
        await sleep(2000);
        
        // Check if solved
        const captchaEl = document.querySelector('.captcha');
        const stillVisible = captchaEl && captchaEl.style.display !== 'none' && captchaEl.querySelector('.captcha__buttons');
        
        if (stillVisible) {
            log('❌ CAPTCHA still visible. Retrying next loop...');
            return false;
        } else {
            log('🎉 CAPTCHA solved! Resuming game.');
            return true;
        }
    }
    
    function closeBattle() { 
        const btn = document.getElementById('battleclose'); 
        if (btn) { btn.click(); return true; }
        return false;
    }
    
    function clickGateway(gw) {
        if (gw && gw.element) { gw.element.click(); return true; }
        return false;
    }
    
    // ==================== AUTO HEAL & LOGIC ====================
    async function autoHeal() {
        if (!config.autoHeal || typeof hero === 'undefined') return;
        const missing = hero.maxhp - hero.hp;
        const critical = hero.hp < hero.maxhp * 0.40;
        if (!critical && missing < hero.maxhp * 0.3) return;
        
        const bag = document.querySelector('#bag');
        if (!bag) return;
        
        const potions = [];
        bag.querySelectorAll('.item').forEach(item => {
            const tip = item.getAttribute('tip');
            if (tip && tip.includes('Leczy')) {
                const m = tip.match(/Leczy.*?(\d[\d\s]*)/i);
                potions.push({ heal: m ? parseInt(m[1].replace(/\s/g, '')) : 0, el: item });
            }
        });
        
        if (!potions.length) return;
        const usable = potions.filter(p => critical || missing >= p.heal * 0.85);
        if (usable.length) { 
            usable.sort((a,b) => b.heal - a.heal); 
            usable[0].el.click(); 
            // log('💊 Potion used'); 
            await sleep(500); 
        }
    }
    
    function findGateway(state, targetMap) {
        for (const gw of state.gateways) {
            if (gw.name.toLowerCase().includes(targetMap.toLowerCase()) || targetMap.toLowerCase().includes(gw.name.toLowerCase())) return gw;
        }
        return state.gateways[0] || null;
    }
    
    function updateStatus(text) {
        const el = document.getElementById('mbot-action-status');
        if (el) el.textContent = text;
    }

    // ==================== MAIN BOT LOOP ====================
    async function botLoop() {
        log('=== Loop started ===');
        updateStatus('🟢 Bot aktywny');
        
        while (botActive && !window.MARGOBOT_STOP) {
            try {
                const state = getGameState();
                
                if (!state) { updateStatus('⏳ Ładowanie...'); await sleep(1000); continue; }
                
                // === 🧩 AUTO CAPTCHA SOLVER ===
                if (state.captcha) {
                    updateStatus('🔐 Rozwiązuję CAPTCHA...');
                    const solved = await solveCaptcha();
                    if (!solved) {
                        await sleep(1000);
                    }
                    continue;
                }

                if (state.battleFinished) { 
                    updateStatus('⚔️ Zamykam walkę...');
                    if(closeBattle()) await sleep(800);
                    continue; 
                }
                
                if (state.battle) { 
                    updateStatus('⚔️ W walce...');
                    await sleep(300); 
                    continue; 
                }
                
                await autoHeal();

                // EXP MODE
                if (config.mode === 'exp') {
                    if (state.target) {
                        const dist = state.target.dist;
                        if (dist < 1.5) { 
                            updateStatus('⚔️ Atakuję: ' + state.target.nick);
                            attackTarget(state.target); 
                            await sleep(600); 
                        } else { 
                            updateStatus('🏃 Idę do: ' + state.target.nick);
                            await moveToTarget(state.target.x, state.target.y, state.target.id); 
                            await sleep(200);
                        }
                    } else if (config.maps && config.maps.length > 0) {
                        // Stabilize map selection: Find current map in list, go to next
                        // If current map not in list, default to index 0, or keep currentMapIndex if valid
                        const currentMapNameNormalized = state.mapName.toLowerCase();
                        const foundIndex = config.maps.findIndex(m => currentMapNameNormalized.includes(m.toLowerCase()) || m.toLowerCase().includes(currentMapNameNormalized));
                        
                        let nextMapIndex = 0;
                        if (foundIndex !== -1) {
                            nextMapIndex = (foundIndex + 1) % config.maps.length;
                        } else {
                            // We are not on any map from the list. 
                            // Try to go to the first map, or stick to current target strategy
                            nextMapIndex = currentMapIndex % config.maps.length;
                        }
                        // Update global index for consistency
                        currentMapIndex = nextMapIndex;
                        
                        const targetMapName = config.maps[nextMapIndex];
                        const gw = findGateway(state, targetMapName);
                        
                        if (gw) { 
                            const dist = Math.hypot(gw.x - state.hero.x, gw.y - state.hero.y);
                            if (dist > 1.5) {
                                updateStatus(`🏃 Idę do przejścia: ${gw.name} (${Math.round(dist)}m)`);
                                await moveToTarget(gw.x, gw.y);
                                await sleep(200);
                            } else {
                                updateStatus('🚪 Przechodzę: ' + gw.name);
                                // Use injection click for safety and engine compatibility logic handles close range better?
                                // Actually, if we are close, standard click or injection should work. 
                                // Let's use the new injection helper for consistency.
                                clickInPageContext(`.gw[tip*="${gw.name}"]`, 0); // Selector might need refinement, raw element click is safer via injection if we have index?
                                // Gateways don't have stable classes/indices easily reachable from here without re-query.
                                // Let's use the helper that takes direct injection
                                // Actually, allow fallback to standard click if injection is complex for dynamic elements without unique IDs.
                                // But wait, clickGateway previously took 'gw' object which has 'element'.
                                // Use a modified version of clickGateway that does safe click.
                                clickGateway(gw); 
                                await sleep(2000); 
                            }
                        } else {
                            // If no direct gateway found, maybe we are stuck? 
                            // Try closest gateway if configured, or just wait.
                            // The user's original logic was to click *any* gateway [0].
                            // This is dangerous if it leads to wrong place, but keeping it as fallback for "getting out of weird place"
                            if (state.gateways.length > 0) { 
                                const fallbackGw = state.gateways[0];
                                const dist = Math.hypot(fallbackGw.x - state.hero.x, fallbackGw.y - state.hero.y);
                                if (dist > 1.5) {
                                     updateStatus(`🏃 (Fallback) Idę do: ${fallbackGw.name}`);
                                     await moveToTarget(fallbackGw.x, fallbackGw.y);
                                } else {
                                     updateStatus(`🚪 (Fallback) Przechodzę: ${fallbackGw.name}`);
                                     clickGateway(fallbackGw); 
                                     await sleep(2000); 
                                }
                            } else {
                                updateStatus('❓ Zgubiłem drogę (brak przejść)');
                                await sleep(1000);
                            }
                        }
                    } else { 
                        updateStatus('🔍 Szukam mobów...');
                        await sleep(500); 
                    }
                } 
                // TRANSPORT
                else if (config.mode === 'transport') {
                    const gw = findGateway(state, config.transportMap);
                    if (gw) { 
                        updateStatus('🚗 Transport: ' + gw.name);
                        clickGateway(gw);
                        await sleep(1000); 
                    } else { 
                        updateStatus('❌ Nie znaleziono: ' + config.transportMap);
                        await sleep(1000); 
                    }
                }
                // E2
                else if (config.mode === 'e2') {
                    const e2Target = config.e2Monster ? state.validMobs.find(m => m.nick.toLowerCase().includes(config.e2Monster.toLowerCase())) : null;
                    if (e2Target) {
                        if (e2Target.dist < 1.5 && config.e2Attack) { 
                            updateStatus('🎯 E2: ' + e2Target.nick);
                            attackTarget(e2Target); 
                            await sleep(800); 
                        } else { 
                            updateStatus('🏃 E2: Idę do ' + e2Target.nick);
                            await moveToTarget(e2Target.x, e2Target.y, e2Target.id); 
                            await sleep(200); 
                        }
                    } else { 
                        updateStatus('🔍 E2: Szukam ' + (config.e2Monster || '?'));
                        await sleep(500); 
                    }
                }
            } catch (err) { 
                console.error(err); 
                updateStatus('❌ Błąd: ' + err.message);
                await sleep(1000); 
            }
            await sleep(50);
        }
        log('Loop stopped');
    }

    // ==================== CONFIG & UI ====================
    function injectUI() {
        if (document.getElementById('margo-bot-panel')) return document.getElementById('margo-bot-panel');
        
        // Ensure styles are present
        if (!document.getElementById('margo-bot-css')) {
            const css = document.createElement('style');
            css.id = 'margo-bot-css';
            css.innerHTML = `
                #margo-bot-panel { position: fixed; top: 20px; left: 20px; z-index: 99999; background: rgba(28, 28, 33, 0.95); color: #ececec; padding: 0; border-radius: 12px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; width: 320px; border: 1px solid #444; box-shadow: 0 10px 25px rgba(0,0,0,0.5); backdrop-filter: blur(10px); font-size: 13px; }
                .mb-header { padding: 12px 15px; background: rgba(255, 255, 255, 0.05); border-bottom: 1px solid #444; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; }
                .mb-title { font-weight: 700; font-size: 14px; letter-spacing: 0.5px; }
                .mb-status { font-weight: 800; font-size: 12px; padding: 2px 6px; border-radius: 4px; background: #333; }
                .mb-tabs { display: flex; background: #222; border-bottom: 1px solid #444; }
                .mb-tab { flex: 1; padding: 10px; text-align: center; cursor: pointer; color: #888; font-weight: 600; border-bottom: 2px solid transparent; transition: all 0.2s; }
                .mb-tab:hover { color: #ccc; background: #2a2a2a; }
                .mb-tab.active { color: #fff; border-bottom: 2px solid #2196F3; background: #2a2a30; }
                .mb-content { padding: 15px; }
                .mb-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
                .mb-col { display: flex; flex-direction: column; gap: 5px; width: 100%; margin-bottom: 12px; }
                .mb-label { font-size: 11px; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px; font-weight: 600; }
                .mb-btn { padding: 10px; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; width: 100%; text-transform: uppercase; letter-spacing: 1px; transition: all 0.2s; font-size: 12px; }
                .mb-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .mb-btn:active { transform: translateY(0); }
                .mb-input { width: 100%; box-sizing: border-box; padding: 8px 10px; background: #2a2a30; border: 1px solid #444; color: white; border-radius: 6px; outline: none; transition: border-color 0.2s; }
                .mb-input:focus { border-color: #2196F3; background: #333; }
                .mb-select { width: 100%; padding: 8px; background: #2a2a30; border: 1px solid #444; color: white; border-radius: 6px; outline: none; cursor: pointer; }
                .mb-textarea { width: 100%; height: 80px; background: #2a2a30; border: 1px solid #444; color: #ddd; border-radius: 6px; padding: 8px; font-size: 11px; resize: vertical; font-family: monospace; white-space: pre; outline: none; box-sizing: border-box; }
                ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #222; } ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
                .mb-tab-content { display: none; } .mb-tab-content.active { display: block; }
                #premiumbut, .premium-button, [onclick*="showPremiumPanel"] { pointer-events: none !important; opacity: 0 !important; visibility: hidden !important; display: none !important; }
            `;
            document.head.appendChild(css);
        }

        let spotsHtml = '<option value="custom">-- Własne Ustawienia --</option>';
        HUNTING_SPOTS.forEach((s, i) => { spotsHtml += '<option value="' + i + '">' + s.name + '</option>'; });

        const panel = document.createElement('div');
        panel.id = 'margo-bot-panel';
        panel.innerHTML = `
            <div class="mb-header">
                <div class="mb-title">😼 MargoSzpont LOCAL</div>
                <div id="bot-status" class="mb-status" style="color: #4CAF50;">OFF</div>
            </div>
            <div class="mb-tabs">
                <div class="mb-tab ${uiState.tab === 'exp' ? 'active' : ''}" data-tab="exp">EXP</div>
                <div class="mb-tab ${uiState.tab === 'transport' ? 'active' : ''}" data-tab="transport">TRANSPORT</div>
                <div class="mb-tab ${uiState.tab === 'e2' ? 'active' : ''}" data-tab="e2">E2</div>
            </div>
            <div class="mb-content">
                <div class="mb-row"><button id="btn-toggle" class="mb-btn" style="background: linear-gradient(135deg, #4CAF50, #45a049); color: white;">START BOT</button></div>
                <div id="mbot-action-status" style="background: #222; padding: 8px 12px; border-radius: 6px; font-size: 11px; color: #888; margin-bottom: 12px; text-align: center;">🔴 Bot nieaktywny</div>
                <div id="panel-exp" class="mb-tab-content ${uiState.tab === 'exp' ? 'active' : ''}">
                    <div class="mb-col"><div class="mb-label">Wybierz Expowisko</div><select id="inp-spot" class="mb-select">${spotsHtml}</select></div>
                    <div class="mb-row" style="gap: 10px;">
                        <div style="flex: 1;"><div class="mb-label">Min Lvl</div><input type="number" id="inp-min" class="mb-input" value="${config.minLvl}"></div>
                        <div style="flex: 1;"><div class="mb-label">Max Lvl</div><input type="number" id="inp-max" class="mb-input" value="${config.maxLvl}"></div>
                    </div>
                    <div class="mb-row">
                        <label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;">
                            <input type="checkbox" id="inp-heal" ${config.autoHeal ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #2196F3;"> Auto Heal
                        </label>
                        <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                            <div class="mb-label" style="margin: 0;">Sloty Potek:</div>
                            <input type="number" id="inp-potion-slots" class="mb-input" value="${config.potionSlots}" min="1" max="50" style="width: 60px; padding: 4px 8px;">
                        </div>
                    </div>
                    <div class="mb-col"><div class="mb-label">Lista Map (edytowalna)</div><textarea id="inp-maps" class="mb-textarea" spellcheck="false">${(config.maps || []).join('\n')}</textarea></div>
                </div>
                <div id="panel-transport" class="mb-tab-content ${uiState.tab === 'transport' ? 'active' : ''}">
                    <div class="mb-col"><div class="mb-label">Cel Podróży</div><input id="inp-transport-map" class="mb-input" placeholder="Wpisz nazwę mapy..." value="${config.transportMap || ''}"></div>
                </div>
                <div id="panel-e2" class="mb-tab-content ${uiState.tab === 'e2' ? 'active' : ''}">
                    <div class="mb-col"><div class="mb-label">Wybierz E2</div><input id="inp-e2-monster" class="mb-input" placeholder="Wpisz nazwę potwora..." value="${config.e2Monster || ''}"></div>
                    <div class="mb-row"><label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;"><input type="checkbox" id="inp-e2-attack" ${config.e2Attack !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #FF5722;"> ⚔️ Atakuj E2</label></div>
                </div>
                <div class="mb-row" style="margin-bottom: 0;"><button id="btn-save" class="mb-btn" style="background: linear-gradient(135deg, #2196F3, #1976D2); color: white; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);">Zapisz Konfigurację</button></div>
            </div>
        `;
        document.body.appendChild(panel);

        const header = panel.querySelector('.mb-header');
        let drag = false, ox = 0, oy = 0;
        header.onmousedown = (e) => { drag = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; };
        document.onmousemove = (e) => { if (drag) { panel.style.left = (e.clientX - ox) + 'px'; panel.style.top = (e.clientY - oy) + 'px'; } };
        document.onmouseup = () => drag = false;

        panel.querySelectorAll('.mb-tab').forEach(tab => {
            tab.onclick = () => {
                panel.querySelectorAll('.mb-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.mb-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
                uiState.tab = tab.dataset.tab;
                config.mode = tab.dataset.tab;
                try { localStorage.setItem('MARGO_UI_STATE', JSON.stringify(uiState)); } catch(e){}
            };
        });

        document.getElementById('inp-spot').onchange = function() {
            const i = parseInt(this.value);
            if (i >= 0 && HUNTING_SPOTS[i]) {
                document.getElementById('inp-min').value = HUNTING_SPOTS[i].min;
                document.getElementById('inp-max').value = HUNTING_SPOTS[i].max;
                document.getElementById('inp-maps').value = HUNTING_SPOTS[i].maps.join('\n');
            }
        };

        document.getElementById('btn-toggle').onclick = function() {
            config.minLvl = parseInt(document.getElementById('inp-min').value) || 1;
            config.maxLvl = parseInt(document.getElementById('inp-max').value) || 999;
            config.autoHeal = document.getElementById('inp-heal').checked;
            config.potionSlots = parseInt(document.getElementById('inp-potion-slots').value) || 14;
            config.maps = document.getElementById('inp-maps').value.split('\n').map(s => s.trim()).filter(s => s);
            config.transportMap = document.getElementById('inp-transport-map').value.trim();
            config.e2Monster = document.getElementById('inp-e2-monster').value.trim();
            config.e2Attack = document.getElementById('inp-e2-attack').checked;

            botActive = !botActive;
            // Save bot state
            try { localStorage.setItem('MARGO_BOT_ACTIVE', botActive ? 'true' : 'false'); } catch(e){}
            const statusEl = document.getElementById('bot-status');
            if (botActive) {
                this.textContent = 'STOP BOT';
                this.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
                statusEl.textContent = 'ON';
                currentMapIndex = 0;
                botLoop();
            } else {
                this.textContent = 'START BOT';
                this.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                statusEl.textContent = 'OFF';
            }
        };

        document.getElementById('btn-save').onclick = () => {
            config.minLvl = parseInt(document.getElementById('inp-min').value) || 1;
            config.maxLvl = parseInt(document.getElementById('inp-max').value) || 999;
            config.autoHeal = document.getElementById('inp-heal').checked;
            config.potionSlots = parseInt(document.getElementById('inp-potion-slots').value) || 14;
            config.maps = document.getElementById('inp-maps').value.split('\n').map(s => s.trim()).filter(s => s);
            config.transportMap = document.getElementById('inp-transport-map').value.trim();
            config.e2Monster = document.getElementById('inp-e2-monster').value.trim();
            config.e2Attack = document.getElementById('inp-e2-attack').checked;
            
            try { localStorage.setItem('MARGO_BOT_CFG', JSON.stringify(config)); } catch(e){}
            alert('✅ Konfiguracja zapisana!');
        };
        log('UI injected');
    }

    // ==================== INIT ====================
    function init() {
        // Check for NEW Margonem interface (window.Engine) or OLD interface (g, hero)
        const hasNewEngine = window.Engine && window.Engine.hero && window.Engine.hero.d;
        const hasOldEngine = typeof g !== 'undefined' && typeof hero !== 'undefined';
        
        if (!hasNewEngine && !hasOldEngine) { 
            log('Waiting for game...');
            setTimeout(init, 1000); 
            return; 
        }
        
        // Create compatibility shims for new engine
        if (hasNewEngine && !hasOldEngine) {
            log('Detected NEW Margonem interface, creating compatibility shims...');
            
            // Shim for 'hero' - create a proxy that reads from Engine.hero.d
            window.hero = new Proxy({}, {
                get: function(target, prop) {
                    if (window.Engine && window.Engine.hero) {
                        if (prop === 'x') return window.Engine.hero.d?.x || 0;
                        if (prop === 'y') return window.Engine.hero.d?.y || 0;
                        if (prop === 'hp') return window.Engine.hero.d?.warrior_stats?.hp || window.Engine.hero.d?.hp || 0;
                        if (prop === 'maxhp') return window.Engine.hero.d?.warrior_stats?.maxhp || window.Engine.hero.d?.maxhp || 0;
                        if (prop === 'nick') return window.Engine.hero.d?.nick || 'Unknown';
                        if (prop === 'lvl') return window.Engine.hero.d?.lvl || 1;
                        return window.Engine.hero.d?.[prop];
                    }
                    return undefined;
                }
            });
            
            // Shim for 'map'
            window.map = new Proxy({}, {
                get: function(target, prop) {
                    if (window.Engine && window.Engine.map) {
                        if (prop === 'name') return window.Engine.map.d?.name || '';
                        if (prop === 'id') return window.Engine.map.d?.id || 0;
                        if (prop === 'x') return window.Engine.map.d?.x || 100;
                        if (prop === 'y') return window.Engine.map.d?.y || 100;
                        if (prop === 'col') {
                            // Return collision string if available
                            if (window.Engine.map.col && typeof window.Engine.map.col.check === 'function') {
                                // Build collision string on demand
                                const w = window.Engine.map.d?.x || 100;
                                const h = window.Engine.map.d?.y || 100;
                                let colStr = '';
                                for (let yy = 0; yy < h; yy++) {
                                    for (let xx = 0; xx < w; xx++) {
                                        colStr += window.Engine.map.col.check(xx, yy) ? '1' : '0';
                                    }
                                }
                                return colStr;
                            }
                            return '';
                        }
                        return window.Engine.map.d?.[prop];
                    }
                    return undefined;
                }
            });
            
            // Shim for 'g' (game data object) 
            window.g = new Proxy({}, {
                get: function(target, prop) {
                    if (prop === 'npc') {
                        // Return mobs from Engine
                        if (window.Engine && window.Engine.npcs) {
                            const npcs = {};
                            const list = window.Engine.npcs.getList ? window.Engine.npcs.getList() : window.Engine.npcs;
                            for (const id in list) {
                                const npc = list[id];
                                if (npc && npc.d) {
                                    npcs[id] = {
                                        id: npc.d.id,
                                        nick: npc.d.nick || npc.d.name,
                                        x: npc.d.x,
                                        y: npc.d.y,
                                        lvl: npc.d.lvl || 0,
                                        type: npc.d.type || 0,
                                        wt: npc.d.wt !== undefined ? npc.d.wt : 1 // wt = can attack
                                    };
                                }
                            }
                            return npcs;
                        }
                        return {};
                    }
                    if (prop === 'battle') {
                        return window.Engine && window.Engine.battle && window.Engine.battle.active;
                    }
                    return undefined;
                }
            });
            
            log('Compatibility shims created!');
        }
        
        const heroName = hasNewEngine ? (window.Engine.hero.d?.nick || 'Unknown') : hero.nick;
        log('Game detected! Hero: ' + heroName);
        injectUI();
        
        // WATCHDOG: Check if UI is removed (e.g. by game engine clearing body) and re-inject
        setInterval(() => {
            if (!document.getElementById('margo-bot-panel')) {
                log('⚠️ UI missing! Re-injecting...');
                injectUI();
                
                // If bot was supposed to be active, update UI state
                if (botActive) {
                    const btn = document.getElementById('btn-toggle');
                    const status = document.getElementById('bot-status');
                    if(btn && status) {
                        btn.textContent = 'STOP BOT';
                        btn.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
                        status.textContent = 'ON';
                    }
                }
            }
        }, 2000);
        
        // Auto-start bot if it was running before page refresh
        if (savedBotActive) {
            log('🔄 Auto-starting bot (was running before refresh)...');
            setTimeout(() => {
                const toggleBtn = document.getElementById('btn-toggle');
                if (toggleBtn) toggleBtn.click();
            }, 500);
        }
    }
    init();
})();
