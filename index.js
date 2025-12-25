const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const PF = require('pathfinding');

// Konfiguracja
chromium.use(stealth);
const GAME_URL = "https://www.margonem.pl/";

// --- KONFIGURACJA DOMYŚLNA (jeśli brak w LocalStorage) ---
const DEFAULT_CONFIG = {
    minLvl: 1, 
    maxLvl: 100,
    autoHeal: false,
    maps: [
        "Grota Malowanej Śmierci", 
        "Dziewicza Knieja", 
        "Skalista Wyżyna", 
    ]
};

// Helper do spania
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    let browser;
    try {
        console.log("🔗 Próba podłączenia do uruchomionego Brave...");
        
        // 1. Łączymy się do już uruchomionej przeglądarki na porcie 9222
        browser = await chromium.connectOverCDP('http://localhost:9222');
        
        const context = browser.contexts()[0];
        if (!context) throw new Error("Nie znaleziono kontekstu przeglądarki!");

        // Szukamy karty z Margonem
        let page = context.pages().find(p => p.url().includes("margonem.pl"));
        if (!page) {
            console.log("⚠️ Nie widzę karty Margonem. Szukam aktywnej...");
            page = context.pages()[0];
            if (!page) page = await context.newPage();
            if (!page.url().includes("margonem.pl")) {
                 console.log("🌐 Otwieranie Margonem...");
                 await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
            }
        }
        
        await page.bringToFront();
        console.log("✅ Podłączono do karty:", await page.title());

        console.log("⏳ Czekam na załadowanie mapy i postaci...");
        await page.waitForFunction(() => {
            return typeof window.hero !== 'undefined' && typeof window.g !== 'undefined' && window.hero.x !== undefined && typeof window.map !== 'undefined';
        }, { timeout: 0 });
        console.log("🚀 Postać gotowa! Start bota (LEVEL MODE & MAP ROTATION).");

        // Globalna zmienna na ostatni atak
        let lastAttackTime = 0;
        const ATTACK_COOLDOWN = 600; // ms
        
        // Zmienne stanu ruchu
        let lastHeroPos = { x: 0, y: 0 };
        let stuckCounter = 0;

        // Cache mapy
        let cachedMapId = null;
        let cachedMapCol = null;
        let cachedMapW = 0;
        let cachedMapH = 0;

        // --- PĘTLA GŁÓWNA ---
        while (true) {
            if (!page || page.isClosed()) break;
            const now = Date.now();

            try {
                // 1. UI & CONFIG SYNC
                const botState = await page.evaluate((defConfig) => {
                    // Inicjalizacja konfiguracji w oknie gry (jeśli nie istnieje)
                    if (!window.BOT_CONFIG) {
                        const saved = localStorage.getItem('MARGO_BOT_CFG');
                        window.BOT_CONFIG = saved ? JSON.parse(saved) : defConfig;
                        window.BOT_ACTIVE = false; 
                    }

                    // --- RYSOWANIE UI ---
                    // ZAWSZE usuwamy stary panel, żeby odświeżyć checkbox
                    const existingPanel = document.getElementById('margo-bot-panel');
                    if (existingPanel) existingPanel.remove();

                    const div = document.createElement('div');
                    div.id = 'margo-bot-panel';
                    div.style.cssText = 'position:fixed; top:10px; left:10px; z-index:9999; background:rgba(0,0,0,0.85); color:white; padding:10px; border-radius:8px; border:2px solid #555; font-family:Arial; font-size:12px; width:180px;';

                    div.innerHTML = `
                        <div style="font-weight:bold; font-size:14px; margin-bottom:5px; text-align:center;">🤖 MargoBot v3</div>
                        <div id="bot-status" style="color:#f44336; font-weight:bold; text-align:center; margin-bottom:10px;">OFF</div>
                        
                        <label>Lvl Min: <input type="number" id="inp-min" style="width:40px; color:black;" value="${window.BOT_CONFIG.minLvl}"></label>
                        <label>Max: <input type="number" id="inp-max" style="width:40px; color:black;" value="${window.BOT_CONFIG.maxLvl}"></label>
                        <label style="margin-left:5px;"><input type="checkbox" id="inp-heal" ${window.BOT_CONFIG.autoHeal ? 'checked' : ''}> Auto Heal</label>
                        <div style="margin:5px 0;">Mapy (rozdziel średnikiem ';'):</div>
                        <textarea id="inp-maps" style="width:100%; height:80px; color:black; font-size:10px; white-space:nowrap; overflow:auto;">${window.BOT_CONFIG.maps.join(';')}</textarea>
                        
                        <button id="btn-save" style="width:100%; margin-top:5px; background:#2196F3; border:none; color:white; padding:4px; cursor:pointer;">Zapisz Ustawienia</button>
                        <button id="btn-toggle" style="width:100%; margin-top:10px; background:#4CAF50; border:none; color:white; padding:8px; font-weight:bold; cursor:pointer;">START</button>
                    `;
                    document.body.appendChild(div);

                    // Obsługa zdarzeń
                    const updateUI = () => {
                        const st = document.getElementById('bot-status');
                        const btn = document.getElementById('btn-toggle');
                        const panel = document.getElementById('margo-bot-panel');
                        if (window.BOT_ACTIVE) {
                            st.innerText = 'ON'; st.style.color = '#4CAF50';
                            btn.innerText = 'STOP'; btn.style.backgroundColor = '#f44336';
                            panel.style.borderColor = '#4CAF50';
                        } else {
                            st.innerText = 'OFF'; st.style.color = '#f44336';
                            btn.innerText = 'START'; btn.style.backgroundColor = '#4CAF50';
                            panel.style.borderColor = '#f44336';
                        }
                    };

                    document.getElementById('btn-toggle').onclick = () => {
                        window.BOT_ACTIVE = !window.BOT_ACTIVE;
                        updateUI();
                    };

                    document.getElementById('btn-save').onclick = () => {
                        const min = parseInt(document.getElementById('inp-min').value);
                        const max = parseInt(document.getElementById('inp-max').value);
                        const heal = document.getElementById('inp-heal').checked;
                        const mapsVal = document.getElementById('inp-maps').value;
                        const maps = mapsVal.split(';').map(s => s.trim()).filter(s => s.length > 0);

                        window.BOT_CONFIG = { minLvl: min, maxLvl: max, autoHeal: heal, maps: maps };
                        localStorage.setItem('MARGO_BOT_CFG', JSON.stringify(window.BOT_CONFIG));
                        alert('Zapisano! Zrestartuj bota (OFF->ON).');
                    };
                    updateUI();

                    return { active: window.BOT_ACTIVE, config: window.BOT_CONFIG };
                }, DEFAULT_CONFIG);

                if (!botState.active) {
                    await sleep(500);
                    continue; // Bot pauzuje
                }

                const CURRENT_CONFIG = botState.config; // Używamy konfiguracji z UI

                // 2. Pobierz dane o stanie gry (pozycja, mapa, moby, przejścia)
                const gameState = await page.evaluate((cfg) => {
                    if (typeof g === 'undefined' || !g.npc || !hero || !map) return null;
                    if (g.battle) return { battle: true };

                    let bestTarget = null;
                    let minDistance = 9999;
                    const obstacles = []; 
                    
                    for (let id in g.npc) {
                        const n = g.npc[id];
                        obstacles.push({ x: n.x, y: n.y, id: n.id });

                        const isMob = (n.type === 2 || n.type === 3);
                        const mobLvl = n.lvl || 0;
                        const inLevelRange = (mobLvl >= cfg.minLvl && mobLvl <= cfg.maxLvl);
                        
                        if (isMob && inLevelRange) {
                            const dist = Math.hypot(n.x - hero.x, n.y - hero.y);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestTarget = { x: n.x, y: n.y, id: n.id, nick: n.nick, dist: dist, lvl: mobLvl };
                            }
                        }
                    }

                    // Gateways - Przetwarzanie
                    let gateways = [];
                    if (map.gw) {
                        for (let gid in map.gw) {
                            const gw = map.gw[gid];
                            const name = gw.label || gw.tip || gw.name || "";
                            gateways.push({ x: gw.x, y: gw.y, name: name, id: gid });
                        }
                    }

                    // --- AUTO HEAL (ROBUST PARSING) ---
                    let healItem = null;
                    
                    // Helper do parsowania DOM tipa
                    const parseTipAmount = (tip) => {
                        const div = document.createElement('div');
                        div.innerHTML = tip;
                        const dmgSpan = div.querySelector('.damage');
                        if (dmgSpan && (div.textContent.includes('Leczy') || div.textContent.includes('Przywraca'))) {
                            return parseInt(dmgSpan.textContent.replace(/\s/g, ''));
                        }
                        return 0;
                    };

                    if (cfg.autoHeal && !g.battle && hero.hp < hero.maxhp) {
                        const missing = hero.maxhp - hero.hp;
                        const bagItems = document.querySelectorAll('#bag .item');
                        
                        for (let item of bagItems) {
                            const tip = item.getAttribute('tip');
                            // Sprawdzamy czy tip w ogóle ma słowa kluczowe
                            if (tip && (tip.includes('Leczy') || tip.includes('Przywraca'))) {
                                const amount = parseTipAmount(tip);
                                if (amount > 0 && amount <= missing) {
                                    healItem = { id: item.id, amount: amount };
                                    break;
                                }
                            }
                        }
                    }

                    return {
                        battle: false,
                        target: bestTarget,
                        gateways: gateways,
                        healTarget: healItem,
                        currentMapName: map.name, 
                        hero: { x: hero.x, y: hero.y },
                        obstacles: obstacles, 
                        map: { id: map.id, w: map.x, h: map.y, col: map.col }
                    };
                }, CURRENT_CONFIG);

                if (!gameState) {
                    await sleep(100);
                    continue;
                }

                // Obsługa leczenia
                if (gameState.healTarget) {
                    console.log(`❤️ Leczenie: Używam ${gameState.healTarget.id} (Moc: ${gameState.healTarget.amount})`);
                    await page.evaluate((tid) => {
                        const el = document.getElementById(tid);
                        if (el) {
                            // Symulacja double click
                            const event = new MouseEvent('dblclick', {
                                'view': window,
                                'bubbles': true,
                                'cancelable': true
                            });
                            el.dispatchEvent(event);
                        }
                    }, gameState.healTarget.id);
                    await sleep(500); // Czekaj po użyciu potki
                    continue; // Pomiń resztę pętli w tym cyklu
                }

                // --- LOGIKA CELÓW (MOB vs MAPA) ---
                let finalTarget = gameState.target;
                
                // Jeśli brak mobów -> sprawdzamy rotację map
                if (!finalTarget && CURRENT_CONFIG.maps.length > 0) {
                    // Normalizujemy nazwy map
                    const currentMapIndex = CURRENT_CONFIG.maps.findIndex(m => m === gameState.currentMapName);
                    
                    if (currentMapIndex !== -1) {
                        let nextMapIndex = currentMapIndex + 1;
                        if (nextMapIndex >= CURRENT_CONFIG.maps.length) {
                             nextMapIndex = 0; // Zawsze loop
                        }

                        const nextMapName = CURRENT_CONFIG.maps[nextMapIndex];
                        console.log(`🗺️ [ROTACJA] Obecna: '${gameState.currentMapName}' -> Następna: '${nextMapName}' | Dostępne przejścia: ${gameState.gateways.map(g => `'${g.name}'`).join(", ")}`);

                        // Szukamy przejścia pasującego nazwą
                        const gw = gameState.gateways.find(g => g.name && g.name.toLowerCase().includes(nextMapName.toLowerCase()));
                        
                        if (gw) {
                            console.log(`✅ Znaleziono przejście do: ${nextMapName} (${gw.x},${gw.y})`);
                            finalTarget = { x: gw.x, y: gw.y, isGateway: true, nick: `>> ${nextMapName}` };
                        } else {
                            console.log(`⚠️ Nie widzę przejścia do: ${nextMapName}. Szukam powrotu na trasę...`);
                            // Fallback: szukamy jakiejkolwiek mapy z listy
                            const gwBack = gameState.gateways.find(g => CURRENT_CONFIG.maps.some(m => g.name.includes(m)));
                             if (gwBack) {
                                 console.log(`🔄 Powrót na trasę przez: ${gwBack.name}`);
                                 finalTarget = { x: gwBack.x, y: gwBack.y, isGateway: true, nick: `<< ${gwBack.name}` };
                             }
                        }
                    } else {
                         // Nie jesteśmy na żadnej mapie z listy
                         console.log(`⚠️ Mapa '${gameState.currentMapName}' spoza listy. Szukam wejścia na trasę...`);
                         const gwEntry = gameState.gateways.find(g => CURRENT_CONFIG.maps.some(m => g.name.includes(m)));
                         if (gwEntry) {
                             console.log(`➡️ Wejście na trasę: ${gwEntry.name}`);
                             finalTarget = { x: gwEntry.x, y: gwEntry.y, isGateway: true, nick: `>> ${gwEntry.name}` };
                         }
                    }
                }

                // --- OBSŁUGA WALKI ---
                if (gameState.battle) {
                    if (now - lastAttackTime > ATTACK_COOLDOWN) {
                        await page.keyboard.press('e');
                        lastAttackTime = now;
                        await sleep(400); 
                    } else {
                        await sleep(50);
                    }
                    continue;
                }

                // --- OBSŁUGA RUCHU ---
                
                // Aktualizacja Cache Mapy
                if (!cachedMapId || cachedMapId !== gameState.map.id) {
                    console.log(`🗺️ -- Nowa mapa: ${gameState.map.id} --`);
                    cachedMapId = gameState.map.id;
                    cachedMapCol = gameState.map.col;
                    cachedMapW = gameState.map.w;
                    cachedMapH = gameState.map.h;
                }

                if (finalTarget) {
                    const distArgs = finalTarget.dist !== undefined ? finalTarget.dist : Math.hypot(finalTarget.x - gameState.hero.x, finalTarget.y - gameState.hero.y);
                    
                    // Gateway wymaga wejścia 'w' (dystans < 1), Mob wystarczy obok (<= 1.5)
                    const interactionDist = finalTarget.isGateway ? 0.3 : 1.5;

                    if (distArgs <= interactionDist) {
                        if (finalTarget.isGateway) {
                             console.log("🚪 Wchodzę...");
                             await sleep(2000); // Czekamy na reload
                        } else {
                             // Atak
                             if (now - lastAttackTime > ATTACK_COOLDOWN + 200) {
                                console.log(`⚔️ Atak [${finalTarget.nick}] (Lvl: ${finalTarget.lvl || '?'}) -> E`);
                                await page.keyboard.press('e');
                                lastAttackTime = now;
                                await sleep(500);
                            }
                        }
                    } else {
                        // PATHFINDING
                        
                        // Stuck detection
                        if (Math.abs(gameState.hero.x - lastHeroPos.x) < 0.1 && Math.abs(gameState.hero.y - lastHeroPos.y) < 0.1) {
                             stuckCounter++;
                        } else {
                             stuckCounter = 0;
                        }
                        lastHeroPos = { x: gameState.hero.x, y: gameState.hero.y };

                        if (stuckCounter > 15) {
                            console.log("⚠️ Zablokowanie -> Losowy ruch");
                            const randomKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
                            const randKey = randomKeys[Math.floor(Math.random() * randomKeys.length)];
                            await page.keyboard.press(randKey);
                            await sleep(300);
                            stuckCounter = 0;
                            continue;
                        }

                        // Grid
                        const grid = new PF.Grid(cachedMapW, cachedMapH);
                        // Ściany
                        for (let cy = 0; cy < cachedMapH; cy++) {
                            for (let cx = 0; cx < cachedMapW; cx++) {
                                if (cachedMapCol[cx + cy * cachedMapW] === '1') {
                                    grid.setWalkableAt(cx, cy, false);
                                }
                            }
                        }
                        // Przeszkody dynamiczne
                        if (gameState.obstacles) {
                            for (const obs of gameState.obstacles) {
                                // Nie blokuj celu!
                                if (finalTarget.id && obs.id === finalTarget.id) continue; 
                                if (finalTarget.isGateway && Math.abs(obs.x - finalTarget.x) < 0.5 && Math.abs(obs.y - finalTarget.y) < 0.5) continue;

                                if (grid.isInside(obs.x, obs.y)) {
                                    grid.setWalkableAt(obs.x, obs.y, false);
                                }
                            }
                        }

                        const finder = new PF.AStarFinder({ allowDiagonal: false }); 
                        grid.setWalkableAt(finalTarget.x, finalTarget.y, true);

                        const startX = Math.round(gameState.hero.x);
                        const startY = Math.round(gameState.hero.y);

                        const path = finder.findPath(startX, startY, finalTarget.x, finalTarget.y, grid);

                        if (path && path.length > 1) {
                            const MAX_STEPS = 12;
                            const stepsToTake = Math.min(path.length - 1, MAX_STEPS);

                            console.log(`👣 Ruch do [${finalTarget.nick}] (${distArgs.toFixed(1)}m)...`);

                            let currentX = startX;
                            let currentY = startY;

                            for (let i = 1; i <= stepsToTake; i++) {
                                const nextStep = path[i];
                                const dx = nextStep[0] - currentX;
                                const dy = nextStep[1] - currentY;
                                const KEY_DELAY = 150; 

                                if (dx > 0) await page.keyboard.press('ArrowRight', { delay: KEY_DELAY });
                                else if (dx < 0) await page.keyboard.press('ArrowLeft', { delay: KEY_DELAY });
                                else if (dy > 0) await page.keyboard.press('ArrowDown', { delay: KEY_DELAY });
                                else if (dy < 0) await page.keyboard.press('ArrowUp', { delay: KEY_DELAY });

                                currentX = nextStep[0];
                                currentY = nextStep[1];
                            }
                        } else {
                            stuckCounter = 0;
                            await sleep(200);
                        }
                    }
                } else {
                    // Czekaj
                    await sleep(500);
                }

            } catch (innerError) {
                console.log("⚠️ Błąd pętli:", innerError.message);
                await sleep(1000);
            }
        }

    } catch (error) {
        console.error("❌ Błąd krytyczny:", error);
    }
})();