const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const PF = require('pathfinding');
const captchaSolver = require('./captcha');

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
        "Siedlisko Nietoperzy p.1", 
        "Siedlisko Nietoperzy p.2", 
        "Siedlisko Nietoperzy p.3 - sala 1", 
        "Siedlisko Nietoperzy p.4", 
        "Siedlisko Nietoperzy p.5", 
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
        
        // Error handling dla Node process - zapobiega wywalaniu bota przy błędach protokołu
        process.on('unhandledRejection', (reason, p) => {
             const str = reason.toString();
             if (str.includes('Protocol error') || str.includes('Target closed') || str.includes('No dialog is showing')) {
                 return; // Ignorujemy znane błędy Playwright
             }
             console.error('Unhandled Rejection:', reason);
        });

        process.on('uncaughtException', (err) => {
            const str = err.toString();
            if (str.includes('Protocol error') || str.includes('Target closed') || str.includes('No dialog is showing')) {
                 return;
            }
            console.error('Uncaught Exception:', err);
            // Nie zamykamy procesu, bo chcemy by bot działał dalej
        });

        // Opcjonalnie: logowanie błędów strony
        page.on('pageerror', err => {
            // console.log("⚠️ Błąd strony:", err.message);
        });

        // 🛡️ CRITICAL FIX: Nadpisujemy natywne funkcje dialogowe przeglądarki.
        // Dzięki temu gra nie otwiera prawdziwych okienek (alert/confirm), więc Playwright nie musi ich zamykać.
        // To eliminuje błąd "ProtocolError: No dialog is showing" wynikający z wyścigów (race condition).
        const overrideDialogs = () => {
             window.alert = (msg) => { console.log('🛡️ Blocked Alert:', msg); return true; };
             window.confirm = (msg) => { console.log('🛡️ Blocked Confirm:', msg); return true; };
             window.prompt = (msg) => { console.log('🛡️ Blocked Prompt:', msg); return null; };
        };

        // 1. Wstrzykujemy na stałe przy każdym przeładowaniu
        await page.addInitScript(overrideDialogs);
        
        // 2. Wstrzykujemy natychmiast teraz (dla obecnej sesji)
        await page.evaluate(overrideDialogs);
        console.log("🛡️ Zablokowano natywne alerty/dialogi gry.");

        console.log("⏳ Czekam na załadowanie mapy i postaci...");
        await page.waitForFunction(() => {
            return typeof window.hero !== 'undefined' && typeof window.g !== 'undefined' && window.hero.x !== undefined && typeof window.map !== 'undefined';
        }, { timeout: 0 });
        console.log("🚀 Postać gotowa! Start bota (LEVEL MODE & MAP ROTATION).");

        // Globalna zmienna na ostatni atak
        let lastAttackTime = 0;
        let lastMapName = ""; // Śledzenie poprzedniej mapy
        let currentMapName = ""; // Śledzenie obecnej mapy (do wykrywania zmian)
        const ATTACK_COOLDOWN = 600; // ms
        
        // Zmienne stanu ruchu
        let lastHeroPos = { x: 0, y: 0 };
        let stuckCounter = 0;
        let pathfindFailCounter = 0; // Licznik nieudanych prób pathfindingu do tego samego celu
        let lastFailedTargetId = null; // ID ostatniego celu, do którego nie udało się dotrzeć
        let skippedMobs = new Map(); // Mapa: mobId -> timestamp (kiedy pominięto)
        const SKIP_TIMEOUT = 30000; // 30s - po tym czasie mob wraca do puli celów

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
                    // Przywracanie stanu aktywności (tylko raz po przeładowaniu)
                    if (typeof window.BOT_ACTIVE === 'undefined') {
                        const savedActive = localStorage.getItem('MARGO_BOT_ACTIVE');
                        window.BOT_ACTIVE = (savedActive === 'true');
                    }

                    // Inicjalizacja konfiguracji
                    if (!window.BOT_CONFIG) {
                        const saved = localStorage.getItem('MARGO_BOT_CFG');
                        window.BOT_CONFIG = saved ? JSON.parse(saved) : defConfig;
                        if(typeof window.BOT_CONFIG.autoHeal === 'undefined') window.BOT_CONFIG.autoHeal = false;
                    }

                    // --- RYSOWANIE UI (tylko raz!) ---
                    if (!document.getElementById('margo-bot-panel')) {
                        const div = document.createElement('div');
                        div.id = 'margo-bot-panel';
                        div.style.cssText = 'position:fixed; top:10px; left:10px; z-index:9999; background:rgba(0,0,0,0.85); color:white; padding:10px; border-radius:8px; border:2px solid #555; font-family:Arial; font-size:12px; width:220px;';

                        const mapsText = window.BOT_CONFIG.maps.join('\n');

                        div.innerHTML = `
                            <div style="font-weight:bold; font-size:14px; margin-bottom:5px; text-align:center;">🤖 MargoBot v4</div>
                            <div id="bot-status" style="color:#f44336; font-weight:bold; text-align:center; margin-bottom:10px;">OFF</div>
                            
                            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                <label>Min: <input type="number" id="inp-min" style="width:35px; color:black;" value="${window.BOT_CONFIG.minLvl}"></label>
                                <label>Max: <input type="number" id="inp-max" style="width:35px; color:black;" value="${window.BOT_CONFIG.maxLvl}"></label>
                            </div>
                            <label style="display:block; margin-bottom:5px;"><input type="checkbox" id="inp-heal" ${window.BOT_CONFIG.autoHeal ? 'checked' : ''}> Auto Heal</label>
                            
                            <div style="margin:5px 0;">Mapy (jedna pod drugą):</div>
                            <textarea id="inp-maps" style="width:95%; height:120px; color:black; font-size:11px; white-space:pre; overflow:auto;">${mapsText}</textarea>
                            
                            <button id="btn-save" style="width:100%; margin-top:8px; background:#2196F3; border:none; color:white; padding:6px; cursor:pointer; border-radius:3px;">Zapisz Ustawienia</button>
                            <button id="btn-toggle" style="width:100%; margin-top:8px; background:#4CAF50; border:none; color:white; padding:10px; font-weight:bold; cursor:pointer; border-radius:3px;">START</button>
                        `;
                        if (document.body) {
                             document.body.appendChild(div);
                             
                             // Eventy (przypinane tylko przy tworzeniu) - TYLKO jeśli body istnieje!
                             const toggleBtn = document.getElementById('btn-toggle');
                             if (toggleBtn) {
                                  toggleBtn.onclick = () => {
                                    window.BOT_ACTIVE = !window.BOT_ACTIVE;
                                    localStorage.setItem('MARGO_BOT_ACTIVE', window.BOT_ACTIVE);
                                    // Wymuszamy odświeżenie statusu natychmiast
                                    const st = document.getElementById('bot-status');
                                    const btn = document.getElementById('btn-toggle');
                                    const panel = document.getElementById('margo-bot-panel');
                                    if (st && btn && panel) {
                                        if (window.BOT_ACTIVE) {
                                            st.innerText = 'ON'; st.style.color = '#4CAF50';
                                            btn.innerText = 'STOP'; btn.style.backgroundColor = '#f44336';
                                            panel.style.borderColor = '#4CAF50';
                                        } else {
                                            st.innerText = 'OFF'; st.style.color = '#f44336';
                                            btn.innerText = 'START'; btn.style.backgroundColor = '#4CAF50';
                                            panel.style.borderColor = '#f44336';
                                        }
                                    }
                                };
                             }

                             const saveBtn = document.getElementById('btn-save');
                             if (saveBtn) {
                                  saveBtn.onclick = () => {
                                    const min = parseInt(document.getElementById('inp-min').value);
                                    const max = parseInt(document.getElementById('inp-max').value);
                                    const heal = document.getElementById('inp-heal').checked;
                                    const mapsVal = document.getElementById('inp-maps').value;
                                    
                                    const maps = mapsVal.split('\n').map(s => s.trim()).filter(s => s.length > 0);

                                    window.BOT_CONFIG = { minLvl: min, maxLvl: max, autoHeal: heal, maps: maps };
                                    localStorage.setItem('MARGO_BOT_CFG', JSON.stringify(window.BOT_CONFIG));
                                    alert('Zapisano! Ustawienia aktywne.');
                                };
                             }
                        }
                    }

                    // --- UI UPDATE (zawsze aktualizujemy status wizualnie w pętli) ---
                    const st = document.getElementById('bot-status');
                    const btn = document.getElementById('btn-toggle');
                    const panel = document.getElementById('margo-bot-panel');
                    if (st && btn && panel) {
                         if (window.BOT_ACTIVE) {
                            st.innerText = 'ON'; st.style.color = '#4CAF50';
                            btn.innerText = 'STOP'; btn.style.backgroundColor = '#f44336';
                            panel.style.borderColor = '#4CAF50';
                        } else {
                            st.innerText = 'OFF'; st.style.color = '#f44336';
                            btn.innerText = 'START'; btn.style.backgroundColor = '#4CAF50';
                            panel.style.borderColor = '#f44336';
                        }
                    }

                    return { active: window.BOT_ACTIVE, config: window.BOT_CONFIG };
                }, DEFAULT_CONFIG);

                if (!botState.active) {
                    await sleep(500);
                    continue; // Bot pauzuje
                }

                // 2. Obsługa CAPTCHA
                try {
                    const solved = await captchaSolver.solve(page);
                    if (solved) {
                        console.log('🤖 CAPTCHA obsłużona. Czekam chwilę na powrót do stabilności...');
                        await sleep(3000);
                        continue; // Restart pętli po rozwiązaniu
                    }
                } catch (err) {
                    console.error('⚠️ Błąd podczas sprawdzania CAPTCHA:', err.message);
                }


                // Cleanup blacklisty - usuwamy stare wpisy
                const now = Date.now();
                for (const [mobId, timestamp] of skippedMobs.entries()) {
                    if (now - timestamp > SKIP_TIMEOUT) {
                        skippedMobs.delete(mobId);
                    }
                }

                const CURRENT_CONFIG = { 
                    ...botState.config, 
                    lastMapName: lastMapName,
                    skippedMobIds: Array.from(skippedMobs.keys()) // Przekazujemy blacklistę do evaluate
                };

                // 2. Pobierz dane o stanie gry (pozycja, mapa, moby, przejścia)
                const gameState = await page.evaluate((cfg) => {
                    if (typeof g === 'undefined' || !g.npc || !hero || !map) return null;
                    if (g.battle) return { battle: true };

                    let bestTarget = null;
                    let minDistance = 9999;
                    const obstacles = []; 
                    let allMobsCount = 0;
                    let deniedCount = 0;
                    
                    for (let id in g.npc) {
                        const n = g.npc[id];
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
                        
                        if (isMob && inLevelRange) {
                            const dist = Math.hypot(n.x - hero.x, n.y - hero.y);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestTarget = { x: n.x, y: n.y, id: n.id, nick: n.nick, dist: dist, lvl: mobLvl };
                            }
                        } else if (isMob) {
                             deniedCount++;
                        }
                    }

                    // Gateways - Przetwarzanie (Hybrid: map.gw + DOM)
                    let gateways = [];
                    // 1. Z obiektu gry
                    if (map.gw) {
                        try {
                            for (let gid in map.gw) {
                                const gw = map.gw[gid];
                                const name = (gw.label || gw.tip || gw.name || "").toString();
                                gateways.push({ x: gw.x, y: gw.y, name: name, id: gid, source: 'obj' });
                            }
                        } catch(e) {}
                    }
                    
                    // 2. Fallback z DOM (jeśli obiekt nie ma nazw lub jest pusty)
                    const domGws = document.querySelectorAll('.gw');
                    domGws.forEach(el => {
                        const tip = el.getAttribute('tip') || "";
                        const style = el.getAttribute('style') || ""; // "top:416px; left:128px"
                        let top = 0, left = 0;
                        
                        const tM = style.match(/top:\s*(\d+)px/);
                        const lM = style.match(/left:\s*(\d+)px/);
                        if(tM) top = parseInt(tM[1]);
                        if(lM) left = parseInt(lM[1]);
                        
                        // Konwersja pikseli na kafelki (Margonem tile = 32x32)
                        const x = Math.round(left / 32);
                        const y = Math.round(top / 32);
                        
                        // Dodaj tylko jeśli jeszcze nie mamy tego przejścia (duplikaty po x,y)
                        if (!gateways.find(g => Math.abs(g.x - x) < 1 && Math.abs(g.y - y) < 1)) {
                            gateways.push({ x, y, name: tip, id: el.id, source: 'dom' });
                        }
                    });

                    let finalTarget = bestTarget; // Używamy bestTarget jako domyślnego finalTarget

                    // Jeśli brak mobów -> sprawdzamy rotację map
                    if (!finalTarget && cfg.maps && cfg.maps.length > 0) {
                        const currentMapNameSafe = (map.name || "").toString();
                        if (currentMapNameSafe) {
                            // 1. Znajdź obecną mapę na liście
                            const currentMapNorm = currentMapNameSafe.toLowerCase().trim();
                            let currentIndex = -1;
                            
                            // Szukanie fuzzy (contains)
                            for (let i = 0; i < cfg.maps.length; i++) {
                                const cfgMap = cfg.maps[i];
                                if (typeof cfgMap === 'string') {
                                    const cfgMapNorm = cfgMap.toLowerCase().trim();
                                    if (currentMapNorm.includes(cfgMapNorm) || cfgMapNorm.includes(currentMapNorm)) {
                                        currentIndex = i;
                                        break;
                                    }
                                }
                            }

                            // 2. Wyznacz cel (następna mapa)
                            let nextMapName = "";
                            if (currentIndex !== -1) {
                                const nextIndex = (currentIndex + 1) % cfg.maps.length;
                                nextMapName = cfg.maps[nextIndex];
                            } else {
                                // Jeśli nie ma na liście, celuj w pierwszą
                                nextMapName = cfg.maps[0];
                            }
                            
                            console.log(`🗺️ [ROTACJA] Obecna: '${currentMapNameSafe}' -> Cel: '${nextMapName}' (Poprzednia: '${cfg.lastMapName || "brak"}')`);
                            console.log(`🔎 Dostępne przejścia (Raw):`, gateways.map(g => `${g.name} (${g.x},${g.y})`).join(" | "));

                            // 1. Próba znalezienia idealnego przejścia (NASTĘPNA MAPA)
                            let gw = gateways.find(g => g.name && g.name.toLowerCase().includes(nextMapName.toLowerCase()));

                            // 2. Jeśli nie ma idealnego, szukamy MAP DALEJ w rotacji (unikamy powrotu!)
                            if (!gw) {
                                console.log(`⚠️ Brak przejścia do celu głównego. Szukam map DALEJ w kolejce...`);
                                
                                // Priorytet 1: Mapy DALEJ niż obecna (forward progression)
                                if (currentIndex !== -1) {
                                    for (let offset = 2; offset < cfg.maps.length; offset++) {
                                        const lookAheadIndex = (currentIndex + offset) % cfg.maps.length;
                                        const lookAheadMap = cfg.maps[lookAheadIndex];
                                        gw = gateways.find(g => g.name && g.name.toLowerCase().includes(lookAheadMap.toLowerCase()));
                                        if (gw) {
                                            console.log(`   ✅ Znaleziono alternatywę: ${lookAheadMap}`);
                                            break;
                                        }
                                    }
                                }
                                
                                // Priorytet 2: JAKAKOLWIEK mapa z listy (ale NIE poprzednia i NIE obecna)
                                if (!gw) {
                                    console.log(`   ⚠️ Brak map do przodu, szukam DOWOLNEJ (oprócz obecnej i poprzedniej)...`);
                                    gw = gateways.find(g => {
                                        if (!g.name) return false;
                                        const gwNameLower = g.name.toLowerCase();
                                        
                                        return cfg.maps.some(m => {
                                            const mapLower = m.toLowerCase();
                                            // Musi być z listy, ALE nie może być obecną ani poprzednią mapą
                                            const isInList = gwNameLower.includes(mapLower) || mapLower.includes(gwNameLower);
                                            const isCurrent = currentMapNameSafe && (currentMapNameSafe.toLowerCase().includes(mapLower) || mapLower.includes(currentMapNameSafe.toLowerCase()));
                                            const isPrevious = cfg.lastMapName && (cfg.lastMapName.toLowerCase().includes(mapLower) || mapLower.includes(cfg.lastMapName.toLowerCase()));
                                            
                                            return isInList && !isCurrent && !isPrevious;
                                        });
                                    });
                                }
                            }

                            // 3. Ostateczność: JAKAKOLWIEK mapa z listy (nawet powrót)
                            if (!gw) {
                                 console.log(`⚠️ Krytyczny brak trasy. Akceptuję DOWOLNĄ mapę z listy (nawet powrót)...`);
                                 gw = gateways.find(g => g.name && cfg.maps.some(m => g.name.includes(m)));
                            }

                            // 4. Ostateczność: losowe przejście
                            if (!gw && gateways.length > 0) {
                                 console.log(`⚠️ Krytyczny brak trasy. Wybieram losowe...`);
                                 gw = gateways[Math.floor(Math.random() * gateways.length)];
                            }

                            if (gw) {
                                // ZABEZPIECZENIE: Jeśli stoimy NA tym przejściu (dist < 2) i to "ostatnia deska ratunku", to trzeba zrobić krok, żeby wejść
                                const distToGw = Math.hypot(gw.x - hero.x, gw.y - hero.y);
                                if (distToGw < 1.0) {
                                     // Stoimy idealnie na wyjściu. 
                                     // Jeśli bot nie wchodzi, to znaczy że musi zejść i wejść.
                                     // Ale nasza logika ruchu wejdzie jeszcze raz.
                                     // Może log:
                                     console.log(`🚪 Stoję w drzwiach [${gw.name}]. Próbuję wejść...`);
                                }
                                console.log(`✅ Wybrano przejście: ${gw.name} (${gw.x},${gw.y})`);
                                finalTarget = { x: gw.x, y: gw.y, isGateway: true, nick: `>> ${gw.name}` };
                            } else {
                                console.log("🛑 Brak dostępnych przejść na tej mapie (lub błąd odczytu)!");
                            }
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
                        target: finalTarget, // FIX: Zwracamy obliczony cel (mob lub gateway), a nie tylko moba!
                        gateways: gateways,
                        healTarget: healItem,
                        currentMapName: map.name, 
                        hero: { x: hero.x, y: hero.y },
                        obstacles: obstacles, 
                        map: { id: map.id, w: map.x, h: map.y, col: map.col },
                        debugInfo: { all: allMobsCount, denied: deniedCount }
                    };
                }, CURRENT_CONFIG);

                if (!gameState) {
                    await sleep(100);
                    continue;
                }

                // --- HEARTBEAT LOG ---
               const targetInfo = gameState.target ? `[${gameState.target.type === 'gateway' || gameState.target.isGateway ? 'DOOR' : 'MOB'}] ${gameState.target.nick}` : 'NULL';
               // console.log(`📊 Stan: Battle=${gameState.battle} | Mobs=${gameState.debugInfo?.all || 0} (${gameState.debugInfo?.denied || 0} skip) | Target=${targetInfo} | Map=${gameState.currentMapName}`);
               // ^ Odkomentuj jeśli chcesz pełny spam. Na razie tylko jeśli brak celu:
               if (!gameState.target && !gameState.battle) {
                    console.log(`💤 IDLE | Mobs: ${gameState.debugInfo?.all} (Skip: ${gameState.debugInfo?.denied}) | Map: ${gameState.currentMapName}`);
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
                   // continue; // USUNIĘTE: Pozwól botowi kontynuować ruch/walkę w tej samej turze, żeby nie stał w miejscu
                }

                // --- LOGIKA CELÓW (MOB vs MAPA) ---
                let finalTarget = gameState.target;
                
                // (Usunięto nadmiarową logikę rotacji - teraz decyduje page.evaluate)


                // --- OBSŁUGA WALKI ---
                if (gameState.battle) {
                    if (now - lastAttackTime > ATTACK_COOLDOWN) {
                        console.log("🔥 W walce... (E)");
                        await page.keyboard.press('e', { delay: 100 });
                        lastAttackTime = now;
                        await sleep(400); 
                    } else {
                        // console.log("⏳ Czekam na turę (Battle Active)..."); // Uncomment for debug
                        await sleep(50);
                    }
                    continue;
                }

                // --- OBSŁUGA RUCHU ---
                
                // Aktualizacja Cache Mapy
                if (!cachedMapId || cachedMapId !== gameState.map.id) {
                    console.log(`🗺️ -- Nowa mapa: ${gameState.map.id} --`);
                    
                    // Wyczyść blacklistę przy zmianie mapy - świeży start!
                    if (skippedMobs.size > 0) {
                        console.log(`🗑️ Czyszczę blacklistę (${skippedMobs.size} mobów) - nowa mapa!`);
                        skippedMobs.clear();
                    }
                    
                    // Aktualizacja historii map (do rotacji)
                    if (gameState.currentMapName && gameState.currentMapName !== currentMapName) {
                        if (currentMapName) {
                            lastMapName = currentMapName;
                            console.log(`🗺️ [HISTORIA] Ostatnia: '${lastMapName}' | Obecna: '${gameState.currentMapName}'`);
                        }
                        currentMapName = gameState.currentMapName;
                    }

                    cachedMapId = gameState.map.id;
                    cachedMapCol = gameState.map.col;
                    cachedMapW = gameState.map.w;
                    cachedMapH = gameState.map.h;
                }

                if (finalTarget) {
                    const distArgs = finalTarget.dist !== undefined ? finalTarget.dist : Math.hypot(finalTarget.x - gameState.hero.x, finalTarget.y - gameState.hero.y);
                    
                    // Gateway wymaga wejścia 'w' (dystans < 1), Mob wystarczy obok (<= 1.5)
                    // POPRAWKA: Musimy wejść NA kafelka (0.0), a nie obok. 
                    // Ustawiamy 0.2 (lekki zapas na float), żeby pathfinding dociągnął nas do środka.
                    const interactionDist = finalTarget.isGateway ? 0.2 : 1.5;

                    if (distArgs <= interactionDist) {
                        if (finalTarget.isGateway) {
                             console.log(`🚪 Aktywuję przejście [${finalTarget.nick}]...`);
                             
                             // W Margonem przejście = wejście na kafelek
                             // Jeśli już tam stoimy (dist ~0), musimy ZEJŚĆ i WRÓCIĆ
                             if (distArgs < 0.5) {
                                  console.log(`   ↩️ Schodzę i wracam (walk-on trigger)...`);
                                  // Krok w dół (lub w bok)
                                  await page.keyboard.press('ArrowDown', { delay: 240 });
                                  await sleep(300);
                                  // Krok z powrotem
                                  await page.keyboard.press('ArrowUp', { delay: 240 });
                             }
                             
                             await sleep(2500); // Czekamy na przeładowanie mapy (dłużej dla pewności)
                        } else {
                             // Atak
                             // Sprawdzamy czy nie ma captchy (defensywne, choć główna pętla powinna to wyłapać)
                             const isCaptcha = await page.evaluate(() => {
                                 const el = document.getElementById('captcha');
                                 return el && el.style.display !== 'none';
                             });

                             if (isCaptcha) {
                                 console.log('🛑 Wstrzymuję atak - wykryto CAPTCHA!');
                                 await sleep(1000);
                             } else if (now - lastAttackTime > ATTACK_COOLDOWN + 500) { // Zwiększamy buffor do 500ms
                                console.log(`⚔️ Atak [${finalTarget.nick}] (Lvl: ${finalTarget.lvl || '?'}) -> E`);
                                await page.keyboard.press('e');
                                lastAttackTime = now;
                                await sleep(800); // Dłuższa pauza po ataku
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

                        let path = finder.findPath(startX, startY, finalTarget.x, finalTarget.y, grid.clone());

                        // FALLBACK: Jeśli nie da się wejść na cel (np. mob w ścianie/latający), szukamy kratki obok
                        if (!path || path.length === 0) {
                             const neighbors = [
                                 { x: finalTarget.x + 1, y: finalTarget.y },
                                 { x: finalTarget.x - 1, y: finalTarget.y },
                                 { x: finalTarget.x, y: finalTarget.y + 1 },
                                 { x: finalTarget.x, y: finalTarget.y - 1 }
                             ];

                             // Sortuj sąsiadów od najbliższego bohaterowi
                             neighbors.sort((a,b) => Math.hypot(a.x - startX, a.y - startY) - Math.hypot(b.x - startX, b.y - startY));

                             for (const nb of neighbors) {
                                 if (grid.isWalkableAt(nb.x, nb.y)) {
                                     // Używamy nowego findera/grida dla pewności
                                     const backupGrid = grid.clone();
                                     const backupFinder = new PF.AStarFinder({ allowDiagonal: false });
                                     const newPath = backupFinder.findPath(startX, startY, nb.x, nb.y, backupGrid);
                                     
                                     if (newPath && newPath.length > 0) {
                                         console.log(`💡 Cel niedostępny, idę do sąsiada: (${nb.x},${nb.y})`);
                                         path = newPath;
                                         break; // Mamy trasę!
                                     }
                                 }
                             }
                        }

                        if (path && path.length > 1) {
                            const MAX_STEPS = 12;
                            const stepsToTake = Math.min(path.length - 1, MAX_STEPS);

                            console.log(`👣 Ruch do [${finalTarget.nick}] (${distArgs.toFixed(1)}m) [Hero: ${startX},${startY} -> Target: ${finalTarget.x},${finalTarget.y}]`);
                            
                            // Reset licznika - pathfinding się udał!
                            pathfindFailCounter = 0;
                            lastFailedTargetId = null;
                            
                            let currentX = startX;
                            let currentY = startY;

                            for (let i = 1; i <= stepsToTake; i++) {
                                const nextStep = path[i];
                                const dx = nextStep[0] - currentX;
                                const dy = nextStep[1] - currentY;
                                const KEY_DELAY = 240; // ZWIĘKSZONE: Krótkie naciśnięcie (150ms) czasem tylko obraca postać. 
                                                       // 240ms jest bezpieczniejsze dla serwera, żeby zaliczył ruch o kratkę. 

                                if (dx > 0) await page.keyboard.press('ArrowRight', { delay: KEY_DELAY });
                                else if (dx < 0) await page.keyboard.press('ArrowLeft', { delay: KEY_DELAY });
                                else if (dy > 0) await page.keyboard.press('ArrowDown', { delay: KEY_DELAY });
                                else if (dy < 0) await page.keyboard.press('ArrowUp', { delay: KEY_DELAY });

                                currentX = nextStep[0];
                                currentY = nextStep[1];
                            }
                        } else {
                            // PATHFINDING FAIL - Brak ścieżki do celu!
                            const targetId = finalTarget.id || `${finalTarget.x},${finalTarget.y}`;
                            
                            if (lastFailedTargetId === targetId) {
                                pathfindFailCounter++;
                            } else {
                                pathfindFailCounter = 1;
                                lastFailedTargetId = targetId;
                            }
                            
                            console.log(`❌ [${pathfindFailCounter}/5] Pathfinding FAIL do [${finalTarget.nick}] (${finalTarget.x},${finalTarget.y})`);
                            
                            if (pathfindFailCounter >= 5) {
                                console.log(`🚫 Pomijam nieosiągalny cel [${finalTarget.nick}]. Szukam następnego...`);
                                
                                // Dodaj do blacklisty na 30s
                                if (finalTarget.id) {
                                    skippedMobs.set(finalTarget.id, Date.now());
                                    console.log(`📝 Blacklista: ${skippedMobs.size} mob(ów)`);
                                }
                                
                                pathfindFailCounter = 0;
                                lastFailedTargetId = null;
                                // Jeśli to była bramka - może być zablokowana, czekamy chwilę
                                if (finalTarget.isGateway) {
                                    await sleep(2000);
                                }
                            } else {
                                await sleep(200);
                            }
                            stuckCounter = 0;
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