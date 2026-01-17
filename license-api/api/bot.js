/**
 * MargoSzpont - Serve Bot Code API
 * GET /api/bot?key=LICENSE_KEY
 * Returns bot code after validating license
 */

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uxvbousvsrupyhnwdiim.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Hunting spots - full list
const HUNTING_SPOTS = [
    { name: "Grobowce (18lvl)", min: 15, max: 25, maps: ["Krypta Rodu Heregata", "Krypta Rodu Heregata p.1", "Krypta Rodu Heregata p.2 - lewe skrzydło", "Krypta Rodu Heregata p.2 - prawe skrzydło", "Grobowiec Rodziny Tywelta", "Grobowiec Rodziny Tywelta p.1", "Grobowiec Rodziny Tywelta p.2"] },
    { name: "Mrówki (20lvl)", min: 17, max: 27, maps: ["Kopiec Mrówek p.2", "Mrowisko", "Kopiec Mrówek", "Mrowisko p.1", "Kopiec Mrówek p.1", "Mrowisko p.2"] },
    { name: "Pumy i tygrysy (21lvl)", min: 18, max: 28, maps: ["Kryjówka Dzikich Kotów", "Leśna Przełęcz", "Tygrysia Polana", "Jaskinia Dzikich Kotów"] },
    { name: "Gobliny (34lvl)", min: 30, max: 40, maps: ["Las Goblinów", "Morwowe Przejście", "Podmokła Dolina", "Jaskinia Pogardy"] },
    { name: "Ghule (40lvl)", min: 36, max: 46, maps: ["Ghuli Mogilnik", "Zapomniany Grobowiec p.1", "Zapomniany Grobowiec p.2", "Zapomniany Grobowiec p.3", "Zapomniany Grobowiec p.4", "Zapomniany Grobowiec p.5", "Polana Ścierwojadów"] },
    { name: "Wilcze plemię (44lvl)", min: 40, max: 50, maps: ["Krasowa Pieczara p.1", "Krasowa Pieczara p.2", "Krasowa Pieczara p.3", "Warczące Osuwiska", "Wilcza Nora p.1", "Wilcza Nora p.2", "Legowisko Wilczej Hordy", "Wilcza Skarpa"] },
    { name: "Orkowie (47lvl)", min: 43, max: 53, maps: ["Zburzona Twierdza", "Świszcząca Grota p.1", "Świszcząca Grota p.2", "Świszcząca Grota p.3", "Świszcząca Grota p.4", "Nawiedzony Jar", "Opuszczony Bastion"] },
    { name: "Gnolle (64lvl)", min: 60, max: 70, maps: ["Radosna Polana", "Wioska Gnolli", "Jaskinia Gnollich Szamanów p.2", "Jaskinia Gnollich Szamanów p.1", "Namiot Vari Krugera"] },
    { name: "Andarum (70lvl)", min: 66, max: 76, maps: ["Andarum Ilami", "Skały Mroźnych Śpiewów", "Cmentarzysko Szerpów", "Śnieżna Granica"] },
    { name: "Erem (80lvl)", min: 76, max: 86, maps: ["Erem Czarnego Słońca p.1 - północ", "Erem Czarnego Słońca p.2", "Erem Czarnego Słońca p.3", "Erem Czarnego Słońca p.4 - sala 1", "Erem Czarnego Słońca p.4 - sala 2"] },
    { name: "Krasnoludy (86lvl)", min: 82, max: 92, maps: ["Labirynt Margorii", "Kopalnia Margorii", "Margoria", "Margoria - Sala Królewska"] },
    { name: "Grexy (89lvl)", min: 85, max: 95, maps: ["Grota Samotnych Dusz p.1", "Grota Samotnych Dusz p.2", "Grota Samotnych Dusz p.3", "Grota Samotnych Dusz p.3 - sala wyjściowa", "Grota Samotnych Dusz p.4", "Grota Samotnych Dusz p.5", "Grota Samotnych Dusz p.6"] },
    { name: "Centaury (98lvl)", min: 94, max: 104, maps: ["Błędny Szlak", "Zawiły Bór", "Iglaste Ścieżki", "Selva Oscura", "Dolina Centaurów", "Ostępy Szalbierskich Lasów"] },
    { name: "Molochy (103lvl)", min: 99, max: 109, maps: ["Podziemia Zniszczonej Wieży p.2", "Podziemia Zniszczonej Wieży p.3", "Podziemia Zniszczonej Wieży p.4", "Podziemia Zniszczonej Wieży p.5"] },
    { name: "Mumie (114lvl)", min: 110, max: 120, maps: ["Oaza Siedmiu Wichrów", "Złote Piaski", "Ciche Rumowiska", "Dolina Suchych Łez", "Piramida Pustynnego Władcy p.1", "Piramida Pustynnego Władcy p.2", "Piramida Pustynnego Władcy p.3"] },
    { name: "Ingotia (121lvl)", min: 117, max: 127, maps: ["Wyspa Ingotia", "Korytarze Wygnańców p.1 - Sala Ech", "Korytarze Wygnańców p.1 - Jaskinia Zagubionych"] },
    { name: "Pająki (129lvl)", min: 125, max: 135, maps: ["Szlak Thorpa p.1", "Szlak Thorpa p.2", "Szlak Thorpa p.3", "Szlak Thorpa p.4", "Szlak Thorpa p.5", "Szlak Thorpa p.6"] },
    { name: "Górale (143lvl)", min: 139, max: 149, maps: ["Wyjący Wąwóz", "Babi Wzgórek", "Góralskie Przejście", "Wyjąca Jaskinia", "Góralska Pieczara p.1", "Góralska Pieczara p.2", "Góralska Pieczara p.3"] },
    { name: "Berserkerzy (147lvl)", min: 143, max: 153, maps: ["Opuszczona Twierdza", "Czarcie Oparzeliska", "Grobowiec Przodków", "Zaginiona Dolina"] },
    { name: "Wiedźmy (154lvl)", min: 150, max: 160, maps: ["Wiedźmie Kotłowisko", "Sabatowe Góry", "Tristam", "Splądrowana kaplica"] },
    { name: "Kazamaty (163lvl)", min: 159, max: 169, maps: ["Nawiedzone Komnaty - przedsionek", "Nawiedzone Kazamaty p.1 s.1", "Nawiedzone Kazamaty p.1 s.2"] },
    { name: "Komnaty (170lvl)", min: 166, max: 176, maps: ["Nawiedzone Komnaty - przedsionek", "Sala Dowódcy Orków", "Nawiedzone Komnaty - zachód", "Nawiedzone Komnaty - wschód"] },
    { name: "Driady (178lvl)", min: 174, max: 184, maps: ["Ruiny Tass Zhil", "Błota Sham Al", "Głusza Świstu", "Las Porywów Wiatru", "Kwieciste Kresy"] },
    { name: "Ogry (181lvl)", min: 177, max: 187, maps: ["Ogrza Kawerna p.1", "Ogrza Kawerna p.2", "Ogrza Kawerna p.3", "Ogrza Kawerna p.4"] },
    { name: "Furbole (208lvl)", min: 204, max: 214, maps: ["Zapomniany Las", "Rozległa Równina", "Zalana Grota", "Wzgórza Obłędu", "Dolina Gniewu"] },
    { name: "Pająki (212lvl)", min: 208, max: 218, maps: ["Pajęczy Las", "Arachnitopia p.1", "Arachnitopia p.2", "Arachnitopia p.3"] },
    { name: "Maddoki (227lvl)", min: 223, max: 233, maps: ["Zawodzące Kaskady", "Strumienie Szemrzących Wód", "Złota Dąbrowa", "Dolina Potoku Śmierci"] },
    { name: "Bolity (242lvl)", min: 238, max: 248, maps: ["Dolina Chmur", "Złota Góra p.1 s.1", "Złota Góra p.1 s.2", "Złota Góra p.1 s.3"] },
    { name: "Maho (255lvl)", min: 251, max: 261, maps: ["Altepetl Mahoptekan", "Wschodni Mictlan p.1", "Wschodni Mictlan p.2"] },
    { name: "Pustynia (275lvl)", min: 271, max: 281, maps: ["Pustynia Shaiharrud - zachód", "Pustynia Shaiharrud - wschód", "Smocze Skalisko"] }
];

const BOT_CODE = `
(function() {
    'use strict';
    if (window.MARGOBOT_INJECTED) return;
    window.MARGOBOT_INJECTED = true;
    window.MARGOBOT_STOP = false;

    console.log('🤖 MargoSzpont v1.0 loaded!');

    const HUNTING_SPOTS = ${JSON.stringify(HUNTING_SPOTS)};

    // Config with localStorage persistence
    let config = { minLvl: 1, maxLvl: 999, autoHeal: true, potionSlots: 14, maps: [], mode: 'exp', transportMap: '', e2Monster: '', e2Attack: true };
    try { const s = localStorage.getItem('MARGO_BOT_CFG'); if(s) config = {...config, ...JSON.parse(s)}; } catch(e){}
    
    let uiState = { tab: 'exp' };
    try { const s = localStorage.getItem('MARGO_UI_STATE'); if(s) uiState = {...uiState, ...JSON.parse(s)}; } catch(e){}

    let botActive = false;
    let currentMapIndex = 0;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const log = (msg) => console.log('[MargoSzpont] ' + msg);

    // Security Monitor
    let securityWarningShown = false;
    window.BOT_SECURITY_FLAG = false;
    const checkEvent = (e) => { if (e.isTrusted === false) window.BOT_SECURITY_FLAG = true; };
    document.addEventListener('keydown', checkEvent, true);
    document.addEventListener('mousedown', checkEvent, true);

    function checkSecurity() {
        if (window.BOT_SECURITY_FLAG && !securityWarningShown) {
            securityWarningShown = true;
            const w = document.createElement('div');
            w.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999999;background:#ff9800;color:#000;padding:10px 20px;border-radius:8px;font-weight:bold;font-size:14px;';
            w.innerHTML = '⚠️ UWAGA: Gra może wykrywać bota! <button onclick="this.parentElement.remove()" style="margin-left:10px;padding:2px 8px;cursor:pointer;">OK</button>';
            document.body.appendChild(w);
            setTimeout(() => w.remove(), 10000);
        }
    }

    function getGameState() {
        if (typeof g === 'undefined' || !g.npc || typeof hero === 'undefined' || typeof map === 'undefined') return null;
        const validMobs = [];
        for (let id in g.npc) {
            const n = g.npc[id];
            if ((n.type === 2 || n.type === 3) && n.lvl >= config.minLvl && n.lvl <= config.maxLvl && n.wt > 0) {
                validMobs.push({ x: n.x, y: n.y, id: n.id, nick: n.nick, lvl: n.lvl, dist: Math.hypot(n.x - hero.x, n.y - hero.y) });
            }
        }
        validMobs.sort((a, b) => a.dist - b.dist);
        
        // Collect gateways with DOM elements for clicking
        const gateways = [];
        document.querySelectorAll('.gw').forEach(el => {
            const tip = (el.getAttribute('tip') || '').replace(/<[^>]*>/g, '').trim();
            if (tip) gateways.push({ 
                x: Math.round((parseInt(el.style.left)||0)/32), 
                y: Math.round((parseInt(el.style.top)||0)/32), 
                name: tip,
                element: el  // Store DOM element for clicking
            });
        });
        return { hero: { x: hero.x, y: hero.y, hp: hero.hp, maxhp: hero.maxhp }, mapName: map.name, battle: !!g.battle, battleFinished: (() => { const t = document.getElementById('battletimer'); return t && (t.innerText.includes('zakończona') || t.innerText.includes('przerwana')); })(), validMobs, gateways, target: validMobs[0] || null };
    }

    // Simulate keyboard press - EXACTLY like original bot
    function pressKey(key, holdMs = 150) {
        const eventInit = {
            key: key,
            code: key.startsWith('Arrow') ? key : 'Key' + key.toUpperCase(),
            keyCode: getKeyCode(key),
            which: getKeyCode(key),
            bubbles: true,
            cancelable: true,
            view: window
        };
        
        // Dispatch keydown
        document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        
        // Hold for duration then release
        setTimeout(() => {
            document.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        }, holdMs);
        
        return true;
    }
    
    function getKeyCode(key) {
        const codes = {
            'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39,
            'e': 69, 'E': 69, 'q': 81, 'r': 82, ' ': 32
        };
        return codes[key] || key.charCodeAt(0);
    }
    
    // Move hero using arrow keys - EXACTLY like original bot
    function moveToTarget(targetX, targetY) {
        const dx = targetX - hero.x;
        const dy = targetY - hero.y;
        
        // Determine direction - originally from movement.js line 317-321
        let key = null;
        if (Math.abs(dx) > Math.abs(dy)) {
            key = dx > 0 ? 'ArrowRight' : 'ArrowLeft';
        } else {
            key = dy > 0 ? 'ArrowDown' : 'ArrowUp';
        }
        
        if (key) {
            pressKey(key, 150);
            return true;
        }
        return false;
    }
    
    // Attack using E key - EXACTLY like original bot (actions.js line 26)
    function attackTarget(t) {
        if (!t) return false;
        log('⚔️ Attack -> E');
        pressKey('e', 100);
        return true;
    }
    
    function closeBattle() { const btn = document.getElementById('battleclose'); if (btn) btn.click(); }
    
    // Click gateway element directly
    function clickGateway(gw) {
        if (gw && gw.element) {
            gw.element.click();
            log('🚪 Clicked gateway: ' + gw.name);
            return true;
        }
        // Fallback to hero.go
        return moveHero(gw.x, gw.y);
    }
    
    // Update visible status in UI
    function updateStatus(text) {
        const el = document.getElementById('mbot-action-status');
        if (el) el.textContent = text;
    }

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
                const m = tip.match(/Leczy.*?(\\d[\\d\\s]*)/i);
                potions.push({ heal: m ? parseInt(m[1].replace(/\\s/g, '')) : 0, el: item });
            }
        });
        if (!potions.length) return;
        const usable = potions.filter(p => critical || missing >= p.heal * 0.85);
        if (usable.length) { usable.sort((a,b) => b.heal - a.heal); usable[0].el.click(); log('💊 Potion'); await sleep(500); }
    }

    function findGateway(state, targetMap) {
        for (const gw of state.gateways) {
            if (gw.name.toLowerCase().includes(targetMap.toLowerCase()) || targetMap.toLowerCase().includes(gw.name.toLowerCase())) return gw;
        }
        return state.gateways[0] || null;
    }

    async function botLoop() {
        log('Loop started (mode: ' + config.mode + ')');
        updateStatus('🟢 Bot aktywny');
        
        while (botActive && !window.MARGOBOT_STOP) {
            try {
                checkSecurity();
                const state = getGameState();
                
                if (!state) { 
                    updateStatus('⏳ Ładowanie gry...');
                    await sleep(1000); 
                    continue; 
                }
                
                if (state.battleFinished) { 
                    updateStatus('⚔️ Zamykam walkę...');
                    closeBattle(); 
                    await sleep(500); 
                    continue; 
                }
                
                if (state.battle) { 
                    updateStatus('⚔️ W walce...');
                    await sleep(300); 
                    continue; 
                }
                
                await autoHeal();

                if (config.mode === 'exp') {
                    if (state.target) {
                        const dist = state.target.dist;
                        if (dist < 1.5) { 
                            attackTarget(state.target); 
                            updateStatus('⚔️ Atakuję: ' + state.target.nick + ' (Lvl ' + state.target.lvl + ')');
                            log('⚔️ ' + state.target.nick); 
                            await sleep(800); 
                        } else { 
                            updateStatus('🏃 Idę do: ' + state.target.nick + ' (' + dist.toFixed(1) + 'm)');
                            moveToTarget(state.target.x, state.target.y); 
                            await sleep(200); 
                        }
                    } else if (config.maps && config.maps.length > 0) {
                        // No mobs - try to change map
                        currentMapIndex = (currentMapIndex + 1) % config.maps.length;
                        const targetMapName = config.maps[currentMapIndex];
                        const gw = findGateway(state, targetMapName);
                        
                        if (gw) { 
                            updateStatus('🚪 Przejście: ' + gw.name);
                            log('🚪 Gateway: ' + gw.name); 
                            clickGateway(gw);
                            await sleep(2000); 
                        } else {
                            updateStatus('🔍 Brak mobów, szukam wyjścia...');
                            // Try any gateway
                            if (state.gateways.length > 0) {
                                clickGateway(state.gateways[0]);
                                await sleep(2000);
                            }
                        }
                    } else { 
                        updateStatus('🔍 Szukam mobów (brak w zasięgu)');
                        await sleep(500); 
                    }
                } else if (config.mode === 'transport') {
                    const gw = findGateway(state, config.transportMap);
                    if (gw) { 
                        updateStatus('🚗 Transport: ' + gw.name);
                        log('🚗 Transport: ' + gw.name); 
                        clickGateway(gw);
                        await sleep(1000); 
                    } else { 
                        updateStatus('❌ Nie znaleziono: ' + config.transportMap);
                        await sleep(1000); 
                    }
                } else if (config.mode === 'e2') {
                    const e2Target = config.e2Monster ? state.validMobs.find(m => m.nick.toLowerCase().includes(config.e2Monster.toLowerCase())) : null;
                    if (e2Target) {
                        if (e2Target.dist < 1.5 && config.e2Attack) { 
                            attackTarget(e2Target); 
                            updateStatus('🎯 E2: ' + e2Target.nick);
                            log('🎯 E2: ' + e2Target.nick); 
                            await sleep(800); 
                        } else { 
                            updateStatus('🏃 E2: Idę do ' + e2Target.nick);
                            moveToTarget(e2Target.x, e2Target.y); 
                            await sleep(200); 
                        }
                    } else { 
                        updateStatus('🔍 E2: Szukam ' + (config.e2Monster || '?'));
                        await sleep(500); 
                    }
                }
            } catch (err) { 
                console.error('[MargoSzpont]', err); 
                updateStatus('❌ Błąd: ' + err.message);
                await sleep(1000); 
            }
            await sleep(50);
        }
        updateStatus('🔴 Bot zatrzymany');
        log('Loop stopped');
    }

    function saveConfig() { try { localStorage.setItem('MARGO_BOT_CFG', JSON.stringify(config)); } catch(e){} }
    function saveUIState() { try { localStorage.setItem('MARGO_UI_STATE', JSON.stringify(uiState)); } catch(e){} }

    function injectUI() {
        if (document.getElementById('margo-bot-panel')) return;

        // CSS - exact copy from original
        const css = document.createElement('style');
        css.id = 'margo-bot-css';
        css.innerHTML = \`
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
            ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #222; } ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; } ::-webkit-scrollbar-thumb:hover { background: #777; }
            .mb-tab-content { display: none; } .mb-tab-content.active { display: block; }
            #premiumbut, .premium-button, [onclick*="showPremiumPanel"] { pointer-events: none !important; opacity: 0 !important; visibility: hidden !important; display: none !important; }
        \`;
        document.head.appendChild(css);

        let spotsHtml = '<option value="custom">-- Własne Ustawienia --</option>';
        HUNTING_SPOTS.forEach((s, i) => { spotsHtml += '<option value="' + i + '">' + s.name + '</option>'; });

        const panel = document.createElement('div');
        panel.id = 'margo-bot-panel';
        panel.innerHTML = \`
            <div class="mb-header">
                <div class="mb-title">😼 MargoSzpont</div>
                <div id="bot-status" class="mb-status" style="color: #4CAF50;">OFF</div>
            </div>
            <div class="mb-tabs">
                <div class="mb-tab \${uiState.tab === 'exp' ? 'active' : ''}" data-tab="exp">EXP</div>
                <div class="mb-tab \${uiState.tab === 'transport' ? 'active' : ''}" data-tab="transport">TRANSPORT</div>
                <div class="mb-tab \${uiState.tab === 'e2' ? 'active' : ''}" data-tab="e2">E2</div>
            </div>
            <div class="mb-content">
                <div class="mb-row"><button id="btn-toggle" class="mb-btn" style="background: linear-gradient(135deg, #4CAF50, #45a049); color: white;">START BOT</button></div>
                <div id="mbot-action-status" style="background: #222; padding: 8px 12px; border-radius: 6px; font-size: 11px; color: #888; margin-bottom: 12px; text-align: center;">🔴 Bot nieaktywny</div>
                
                <div id="panel-exp" class="mb-tab-content \${uiState.tab === 'exp' ? 'active' : ''}">
                    <div class="mb-col"><div class="mb-label">Wybierz Expowisko</div><select id="inp-spot" class="mb-select">\${spotsHtml}</select></div>
                    <div class="mb-row" style="gap: 10px;">
                        <div style="flex: 1;"><div class="mb-label">Min Lvl</div><input type="number" id="inp-min" class="mb-input" value="\${config.minLvl}"></div>
                        <div style="flex: 1;"><div class="mb-label">Max Lvl</div><input type="number" id="inp-max" class="mb-input" value="\${config.maxLvl}"></div>
                    </div>
                    <div class="mb-row">
                        <label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;">
                            <input type="checkbox" id="inp-heal" \${config.autoHeal ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #2196F3;"> Auto Heal
                        </label>
                        <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                            <div class="mb-label" style="margin: 0;">Sloty Potek:</div>
                            <input type="number" id="inp-potion-slots" class="mb-input" value="\${config.potionSlots}" min="1" max="50" style="width: 60px; padding: 4px 8px;">
                        </div>
                    </div>
                    <div class="mb-col"><div class="mb-label">Lista Map (edytowalna)</div><textarea id="inp-maps" class="mb-textarea" spellcheck="false">\${(config.maps || []).join('\\n')}</textarea></div>
                </div>
                
                <div id="panel-transport" class="mb-tab-content \${uiState.tab === 'transport' ? 'active' : ''}">
                    <div class="mb-col"><div class="mb-label">Cel Podróży</div><input id="inp-transport-map" class="mb-input" placeholder="Wpisz nazwę mapy..." value="\${config.transportMap || ''}"></div>
                </div>
                
                <div id="panel-e2" class="mb-tab-content \${uiState.tab === 'e2' ? 'active' : ''}">
                    <div class="mb-col"><div class="mb-label">Wybierz E2</div><input id="inp-e2-monster" class="mb-input" placeholder="Wpisz nazwę potwora..." value="\${config.e2Monster || ''}"></div>
                    <div class="mb-row"><label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;"><input type="checkbox" id="inp-e2-attack" \${config.e2Attack !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #FF5722;"> ⚔️ Atakuj E2</label></div>
                </div>
                
                <div class="mb-row" style="margin-bottom: 0;"><button id="btn-save" class="mb-btn" style="background: linear-gradient(135deg, #2196F3, #1976D2); color: white; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);">Zapisz Konfigurację</button></div>
            </div>
        \`;
        document.body.appendChild(panel);

        // Draggable
        const header = panel.querySelector('.mb-header');
        let drag = false, ox = 0, oy = 0;
        header.onmousedown = (e) => { drag = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; };
        document.onmousemove = (e) => { if (drag) { panel.style.left = (e.clientX - ox) + 'px'; panel.style.top = (e.clientY - oy) + 'px'; } };
        document.onmouseup = () => drag = false;

        // Tabs
        panel.querySelectorAll('.mb-tab').forEach(tab => {
            tab.onclick = () => {
                panel.querySelectorAll('.mb-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.mb-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
                uiState.tab = tab.dataset.tab;
                config.mode = tab.dataset.tab;
                saveUIState();
            };
        });

        // Spot selector
        document.getElementById('inp-spot').onchange = function() {
            const i = parseInt(this.value);
            if (i >= 0 && HUNTING_SPOTS[i]) {
                document.getElementById('inp-min').value = HUNTING_SPOTS[i].min;
                document.getElementById('inp-max').value = HUNTING_SPOTS[i].max;
                document.getElementById('inp-maps').value = HUNTING_SPOTS[i].maps.join('\\n');
            }
        };

        // Toggle
        document.getElementById('btn-toggle').onclick = function() {
            readConfig();
            botActive = !botActive;
            const statusEl = document.getElementById('bot-status');
            if (botActive) {
                this.textContent = 'STOP BOT';
                this.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
                statusEl.textContent = 'ON';
                statusEl.style.color = '#4CAF50';
                currentMapIndex = 0;
                botLoop();
            } else {
                this.textContent = 'START BOT';
                this.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                statusEl.textContent = 'OFF';
                statusEl.style.color = '#4CAF50';
            }
        };

        // Save
        document.getElementById('btn-save').onclick = () => {
            readConfig();
            saveConfig();
            alert('✅ Konfiguracja zapisana!');
        };

        function readConfig() {
            config.minLvl = parseInt(document.getElementById('inp-min').value) || 1;
            config.maxLvl = parseInt(document.getElementById('inp-max').value) || 999;
            config.autoHeal = document.getElementById('inp-heal').checked;
            config.potionSlots = parseInt(document.getElementById('inp-potion-slots').value) || 14;
            config.maps = document.getElementById('inp-maps').value.split('\\n').map(s => s.trim()).filter(s => s);
            config.transportMap = document.getElementById('inp-transport-map').value.trim();
            config.e2Monster = document.getElementById('inp-e2-monster').value.trim();
            config.e2Attack = document.getElementById('inp-e2-attack').checked;
        }

        log('UI ready');
    }

    function init() {
        if (typeof g === 'undefined' || typeof hero === 'undefined') { setTimeout(init, 1000); return; }
        log('Game detected!');
        injectUI();
    }
    init();
})();
`;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).send('Method not allowed');
    
    try {
        const key = req.query.key;
        if (!key) return res.status(401).send('// License key required');
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        const { data: license, error } = await supabase.from('licenses').select('*').eq('key', key.trim()).single();
        if (error || !license) return res.status(401).send('// Invalid license key');
        if (!license.active) return res.status(401).send('// License deactivated');
        if (new Date() > new Date(license.expires_at)) return res.status(401).send('// License expired');
        await supabase.from('licenses').update({ last_used: new Date().toISOString() }).eq('key', key.trim());
        res.setHeader('Content-Type', 'application/javascript');
        res.status(200).send(BOT_CODE);
    } catch (err) { console.error('Bot serve error:', err); res.status(500).send('// Server error'); }
};
