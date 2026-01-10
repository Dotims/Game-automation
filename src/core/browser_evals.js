/**
 * Browser Evaluations Wrapper
 * 
 * This file contains functions that execute code inside the browser context (page.evaluate).
 * It is EXCLUDED from Bytenode compilation to avoid serialization issues.
 * The main logic imports these functions to remain compilable.
 */

module.exports = {
    // --- Index.js Helpers ---

    async isMapLoaded(page) {
        return page.evaluate(() => typeof map !== 'undefined' && map.id);
    },

    async getStoredLicenseKey(page) {
        return page.evaluate(() => localStorage.getItem('MARGO_LICENSE_KEY'));
    },

    async findZakonnik(page) {
        return page.evaluate(() => {
             if (!g || !g.npc) return null;
             for (let id in g.npc) {
                 const n = g.npc[id];
                 if (n.nick && n.nick.includes('Zakonnik Planu Astralnego')) {
                     return { x: n.x, y: n.y, nick: n.nick, id: n.id };
                 }
             }
             return null;
        });
    },

    async findTunia(page) {
        return page.evaluate(() => {
            if (!g || !g.npc) return null;
            for (let id in g.npc) {
                if (g.npc[id].nick === 'Tunia Frupotius') return g.npc[id];
            }
            return null;
        });
    },

    async findNextMob(page, { currentTargetId, heroX, heroY, minLvl, maxLvl }) {
        return page.evaluate(({ currentTargetId, heroX, heroY, minLvl, maxLvl }) => {
            const allMobs = [];
            if (typeof g !== 'undefined' && g.npc) {
                for (let id in g.npc) {
                    const n = g.npc[id];
                    if (n.type === 2 && n.lvl >= minLvl && n.lvl <= maxLvl && n.wt > 0 && n.id !== currentTargetId) {
                        const dist = Math.hypot(n.x - heroX, n.y - heroY);
                        allMobs.push({ id: n.id, x: n.x, y: n.y, nick: n.nick, dist: dist, type: 'mob' });
                    }
                }
            }
            allMobs.sort((a, b) => a.dist - b.dist);
            return allMobs.length > 0 ? allMobs[0] : null;
        }, { currentTargetId, heroX, heroY, minLvl, maxLvl });
    },

    // --- Movement.js Helpers ---

    async getMovementScanData(page) {
        return page.evaluate(() => {
            const obs = [];
            if (typeof g !== 'undefined' && g.npc) {
                for (let key in g.npc) {
                    const n = g.npc[key];
                    if (n.type !== 4) obs.push({x: n.x, y: n.y});
                }
            }
            
            let hasCaptcha = false;
            const captchaEl = document.getElementById('captcha');
            if (captchaEl && captchaEl.style.display !== 'none' && captchaEl.offsetParent !== null) {
                hasCaptcha = true;
            }
            
            return { 
                x: Math.round(hero.x), 
                y: Math.round(hero.y),
                mapId: map.id,
                obstacles: obs,
                captcha: hasCaptcha
            };
        });
    },

    async isBotStopped(page) {
        return page.evaluate(() => window.BOT_ACTIVE === false);
    },

    async getPathScanData(page) {
        return page.evaluate(() => {
            const obs = [];
            if (typeof g !== 'undefined' && g.npc) {
                for (let key in g.npc) {
                    const n = g.npc[key];
                    if (n.type !== 4) obs.push({x: n.x, y: n.y});
                }
            }
            return { 
                heroX: Math.round(hero.x), 
                heroY: Math.round(hero.y),
                obstacles: obs 
            };
        });
    },

    // --- Actions.js Helpers ---

    async checkAttackCaptcha(page) {
        return page.evaluate(() => {
            const el = document.getElementById('captcha');
            if (!el || el.style.display === 'none') return false;
            const text = el.innerText.trim();
            const hasButtons = el.querySelectorAll('.btn').length > 0;
            return text || hasButtons;
        });
    },

    async analyzePotions(page) {
        return page.evaluate(() => {
            const debug = [];
            if (typeof window.hero === 'undefined') return { error: 'No Hero', debug };
            
            const hero = window.hero;
            const missingHp = hero.maxhp - hero.hp;
            const isCritical = hero.hp < hero.maxhp * 0.40;
            debug.push(`HP: ${hero.hp}/${hero.maxhp} (Miss: ${missingHp}, Crit: ${isCritical})`);

            const bag = document.querySelector('#bag');
            if (!bag) return { error: 'No Bag', debug };

            const items = Array.from(bag.querySelectorAll('.item'));
            const potions = [];

            for (let item of items) {
                 const tip = item.getAttribute('tip');
                 if (tip && tip.includes('Leczy')) {
                     const match = tip.match(/Leczy.*?(\d[\d\s]*)/i);
                     const healRaw = match ? match[1].replace(/\s/g, '') : '0';
                     const healAmount = parseInt(healRaw, 10);
                     
                     potions.push({ 
                         id: item.id, 
                         heal: healAmount,
                         top: parseInt(item.style.top || '0', 10),
                         left: parseInt(item.style.left || '0', 10),
                         rect: {
                             x: item.getBoundingClientRect().x + item.getBoundingClientRect().width/2,
                             y: item.getBoundingClientRect().y + item.getBoundingClientRect().height/2
                         }
                     });
                 }
            }

            if (potions.length === 0) return { error: 'No Potions', debug };

            const usable = potions.filter(p => {
                const effCheck = missingHp >= p.heal * 0.85;
                if (!isCritical && !effCheck) return false;
                return true;
            });

            if (usable.length === 0) return { error: 'Efficiency Block', debug };

            usable.sort((a, b) => {
                if (b.top !== a.top) return b.top - a.top; 
                return b.left - a.left; 
            });
            const best = usable[0];
            
            return { success: true, target: best, debug, nick: hero.nick };
        });
    },

    async closeBattleWindow(page) {
        return page.evaluate(() => {
            const btn = document.getElementById('battleclose');
            if (btn) btn.click();
        });
    },

    async closeBlockingWindow(page) {
        return page.evaluate(() => {
            if (typeof shop_close === 'function') {
                try { shop_close(); } catch(e) {}
            }
            const el = document.getElementById('centerbox2');
            if (el) {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
                el.style.top = '-9999px';
                el.style.left = '-9999px';
            }
        });
    },

    async getItemCoords(page, itemId) {
        return page.evaluate((id) => {
            let el = document.getElementById('item' + id);
            if (!el) el = document.getElementById(id); 
            
            if (!el) return null;
            
            const rect = el.getBoundingClientRect();
            return {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2
            };
        }, itemId);
    },

    // --- Captcha.js Helpers ---

    async isCaptchaVisible(page) {
        return page.evaluate(() => {
            const el = document.getElementById('captcha');
            if (!el || el.style.display === 'none') return false;
            const text = el.innerText.trim();
            const hasButtons = el.querySelectorAll('.btn').length > 0;
            if (!text && !hasButtons) return false;
            return true;
        });
    },

    async getCaptchaButtons(page) {
        return page.evaluate(() => {
            const questionEl = document.querySelector('.captcha__question');
            const question = questionEl ? questionEl.innerText : '';
            const buttons = Array.from(document.querySelectorAll('.captcha__buttons .btn')).map((btn, index) => {
                const fontEl = btn.querySelector('.gfont');
                return {
                    index: index,
                    text: fontEl ? fontEl.getAttribute('name') : '',
                    isActive: btn.classList.contains('active') 
                };
            });
            return { question, buttons };
        });
    },

    async isCaptchaStillVisible(page) {
        return page.evaluate(() => {
            const el = document.getElementById('captcha');
            return el && el.style.display !== 'none';
        });
    },

    // --- Shopping.js Helpers ---

    async analyzeShop(page, maxHp) {
        return page.evaluate((hp) => {
            const shop = document.getElementById('shop');
            if (!shop || shop.style.display === 'none') return { success: false, reason: "Shop not open" };
            
            const items = Array.from(shop.querySelectorAll('.item'));
            const potions = [];
            
            for (const item of items) {
                const tip = item.getAttribute('tip') || "";
                const match = tip.match(/Leczy\s*(?:<[^>]+>)?\s*(\d+[\s\d]*)/);
                
                const stackMatch = tip.match(/Maksimum.*?class="damage">(\d+)/) || 
                                   tip.match(/W jednej paczce:?\s*(\d+)/i) || 
                                   tip.match(/Stack:?\s*(\d+)/i);
                
                const stackSize = stackMatch ? parseInt(stackMatch[1]) : 30; 
                
                const amountMatch = tip.match(/Ilość:[^0-9]*(\d+)/i);
                const shopUnitSize = amountMatch ? parseInt(amountMatch[1]) : 1;
                
                if (match) {
                    const healAmount = parseInt(match[1].replace(/\s/g, ''));
                    potions.push({
                        id: item.id,
                        heal: healAmount,
                        stackSize: stackSize,
                        shopUnitSize: shopUnitSize
                    });
                }
            }
            
            if (potions.length === 0) return { success: false, reason: "No potions found" };
            
            const idealHeal = Math.floor(hp * 0.30);
            
            potions.sort((a, b) => {
                const diffA = Math.abs(a.heal - idealHeal);
                const diffB = Math.abs(b.heal - idealHeal);
                return diffA - diffB;
            });
            
            return { success: true, item: potions[0] };
        }, maxHp);
    },

    async closeShop(page) {
        return page.evaluate(() => window.shop_close && window.shop_close());
    },

    async getPotionSlots(page) {
        return page.evaluate(() => window.BOT_POTION_SLOTS || 14);
    },

    async clickQuickSellButton(page, btnText) {
        return page.evaluate((text) => {
            const wrapper = document.querySelector('.gargonem-quick-sell-wrapper');
            if (!wrapper) return false;
            const buttons = Array.from(wrapper.querySelectorAll('button'));
            const btn = buttons.find(b => b.textContent.trim() === text);
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        }, btnText);
    },

    async findTeleportScroll(page) {
        return page.evaluate(() => {
            const shop = document.getElementById('shop');
            if (!shop || shop.style.display === 'none') return { success: false, reason: "Shop not open" };
            
            const items = Array.from(shop.querySelectorAll('.item'));
            for (const item of items) {
                const tip = item.getAttribute('tip') || "";
                if (tip.includes('Zwój teleportacji na Kwieciste Przejście')) {
                    return { success: true, itemId: item.id };
                }
            }
            return { success: false, reason: "Teleport scroll not found in shop" };
        });
    },

    // --- GameState.js Helper ---

    async getGameState(page, config) {
        return page.evaluate((cfg) => {
            if (typeof g === 'undefined' || !g.npc || !hero || !map) return null;
    
            const obstacles = []; 
            const validMobs = []; 
            const allMobs = [];   
            let allMobsCount = 0;
            let deniedCount = 0;
            
            // Ping
            let ping = 50; 
            const lagMeter = document.getElementById('lagmeter');
            if (lagMeter) {
                const tip = lagMeter.getAttribute('tip');
                if (tip) {
                     const match = tip.match(/(\d+)ms/);
                     if (match && match[1]) {
                         const parsedPing = parseInt(match[1], 10);
                         if (parsedPing < 5000) ping = parsedPing;
                     }
                }
            }
            
            // Mobs & Obstacles
            for (let id in g.npc) {
                const n = g.npc[id];
                if (n.type !== 4) obstacles.push({ x: n.x, y: n.y, id: n.id });
    
                const isMob = (n.type === 2 || n.type === 3);
                if (isMob) {
                    allMobsCount++;
                    allMobs.push({
                         x: n.x, y: n.y, id: n.id, nick: n.nick, lvl: n.lvl, 
                         type: 'mob', isGateway: false
                    });
                }
    
                if (cfg.skippedMobIds && cfg.skippedMobIds.includes(n.id)) {
                    deniedCount++;
                    continue;
                }
    
                const mobLvl = n.lvl || 0;
                const inLevelRange = (mobLvl >= cfg.minLvl && mobLvl <= cfg.maxLvl);
                
                if (isMob && inLevelRange) {
                    const dist = Math.hypot(n.x - hero.x, n.y - hero.y);
                    validMobs.push({ 
                        x: n.x, y: n.y, id: n.id, nick: n.nick, lvl: n.lvl, 
                        type: 'mob', isGateway: false, dist: dist 
                    });
                }
            }
            
            validMobs.sort((a, b) => a.dist - b.dist);
    
            // Gateways
            let gateways = [];
            const gwElements = document.querySelectorAll('.gw');
            for (const el of gwElements) {
                 const tip = el.getAttribute('tip') || '';
                 const name = tip.replace(/<[^>]*>/g, '').trim(); 
                 const left = parseInt(el.style.left) || 0;
                 const top = parseInt(el.style.top) || 0;
                 if (name) {
                     gateways.push({ 
                         x: Math.round(left / 32), 
                         y: Math.round(top / 32), 
                         name, 
                         type: 'gateway',
                         isGateway: true
                     });
                 }
            }
    
            // Dazed
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
    
            // Potions Count
            const potionsData = (() => {
                 let count = 0;
                 let stackSize = 15; 
                 const bag = document.querySelector('#bag');
                 if (bag) {
                     const items = bag.querySelectorAll('.item');
                     for (const item of items) {
                         const tip = item.getAttribute('tip');
                         if (tip && tip.includes('Leczy') && !tip.includes('Pełne leczenie')) {
                             const qtyMatch = tip.match(/Ilość:.*?class="amount-text"?>(\d+)/) || 
                                              tip.match(/Ilość:\s*(\d+)/) ||
                                              tip.match(/Użyci[ae]:.*?>(\d+)/) ||
                                              tip.match(/Użyci[ae]:\s*(\d+)/);
                             count += qtyMatch ? parseInt(qtyMatch[1]) : 1;
                             
                             const stackMatch = tip.match(/Maksimum.*?class="damage">(\d+)/) || 
                                                tip.match(/Maksimum[^0-9]*(\d+)/i) ||
                                                tip.match(/W jednej paczce:?\s*(\d+)/i);
                             if (stackMatch) stackSize = parseInt(stackMatch[1]);
                         }
                     }
                 }
                 return { count, stackSize };
            })();
    
            return {
                hero: { x: hero.x, y: hero.y, hp: hero.hp, maxhp: hero.maxhp, lvl: hero.lvl },
                map: { id: map.id, w: map.x, h: map.y, col: map.col }, 
                battle: !!g.battle,
                target: validMobs.length > 0 ? validMobs[0] : null, 
                validMobs: validMobs, 
                allMobs: allMobs,     
                gateways: gateways,
                obstacles: obstacles,
                debugInfo: { allMobsCount, deniedCount, validMobsCount: validMobs.length },
                currentMapName: map.name,
                pvp: !!document.getElementById('pvpmode'), 
                ping: ping, 
                dazed: dazedState,
                potionsCount: potionsData.count,
                potionStackSize: potionsData.stackSize,
                
                // Inventory
                inventory: (() => {
                     let totalFree = 0;
                     let totalCapacity = 0;
                     const bagElements = Array.from(document.querySelectorAll('.item[bag]'));
                     
                     for (const item of bagElements) {
                         if (item.getAttribute('bag') === '6') continue;
                         const small = item.querySelector('small');
                         if (small) {
                              const num = parseInt(small.innerText);
                              if (!isNaN(num)) totalFree += num;
                         }
                         const tip = item.getAttribute('tip') || "";
                         const capMatch = tip.match(/Mieści\D*(\d+)/);
                         if (capMatch) totalCapacity += parseInt(capMatch[1]);
                     }
                     
                     if (totalCapacity === 0 && bagElements.length === 0) {
                          const bagDiv = document.querySelector('#bag');
                          if (bagDiv) {
                              const header = bagDiv.querySelector('.bag-header') || bagDiv.querySelector('.title');
                              if (header) {
                                 const match = header.innerText.match(/(\d+)\s*\/\s*(\d+)/);
                                 if (match) {
                                      totalCapacity = parseInt(match[2]);
                                      totalFree = totalCapacity - parseInt(match[1]);
                                 }
                              }
                          }
                          if (totalCapacity === 0) totalCapacity = 20; 
                     }
                     
                     const used = Math.max(0, totalCapacity - totalFree);
                     
                     let teleportScrollId = null;
                     let teleportScrollCount = 0;
                     const allItems = document.querySelectorAll('#bag .item');
                     for (const item of allItems) {
                         const tip = item.getAttribute('tip') || '';
                         if (tip.includes('Zwój teleportacji na Kwieciste Przejście')) {
                             teleportScrollId = item.id?.replace('item', '');
                             const qtyMatch = tip.match(/Ilość:.*?class="amount-text">(\d+)/) || tip.match(/Ilość:\s*(\d+)/);
                             if (qtyMatch) teleportScrollCount = parseInt(qtyMatch[1], 10);
                             break;
                         }
                     }
                     
                     return { 
                         used, 
                         capacity: totalCapacity, 
                         isFull: used >= totalCapacity,
                         free: totalFree,
                         teleportScrollId,
                         teleportScrollCount
                     };
                })(),
    
                isDead: hero.hp === 0,
                battleFinished: (() => {
                     const timer = document.getElementById('battletimer');
                     return timer && (timer.innerText.includes('zakończona') || timer.innerText.includes('przerwana'));
                })(),
                battleCloseVisible: (() => {
                    const el = document.getElementById('battleclose');
                    return el && el.offsetParent !== null; 
                })(),
                blockingWindow: (() => {
                    const el = document.getElementById('centerbox2');
                    return el && el.style.display !== 'none' && el.offsetParent !== null;
                })()
            };
        }, config);
    },

    // --- UI.js Helper ---

    async injectUI(page, defaultConfig, huntingSpots, allMapNames, allMonsters, licenseInfo) {
        return page.evaluate(({ cfg, spots, allMaps, monsters, license }) => {
            if (!document.body) return { active: false, config: cfg, licenseValid: false };
    
            window.BOT_LICENSE = license;
    
            if (!window.BOT_CONFIG) {
                const saved = localStorage.getItem('MARGO_BOT_CFG');
                window.BOT_CONFIG = saved ? JSON.parse(saved) : cfg;
                const savedActive = localStorage.getItem('MARGO_BOT_ACTIVE');
                window.BOT_ACTIVE = savedActive === 'true'; 
            }
    
            let uiState = { tab: 'exp', transport: '', e2: '', potionSlots: 14, e2Attack: true };
            try {
                const savedUI = localStorage.getItem('MARGO_UI_STATE');
                if (savedUI) uiState = JSON.parse(savedUI);
            } catch (e) {}
            
            if (typeof window.BOT_POTION_SLOTS === 'undefined') {
                window.BOT_POTION_SLOTS = uiState.potionSlots || 14;
            }
            
            window.HUNTING_SPOTS = spots || [];
            window.ALL_MONSTERS = monsters || [];
            
            // Security Monitor
            if (!window.SECURITY_MONITORED) {
                window.SECURITY_MONITORED = true;
                window.BOT_SECURITY_FLAG = false;
                const monitoredKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'e', 'r', ' '];
                const verifyInput = (e) => {
                    if (e.type === 'keydown' && !monitoredKeys.includes(e.key)) return;
                    if (e.isTrusted === false) window.BOT_SECURITY_FLAG = true;
                };
                document.addEventListener('keydown', verifyInput, true);
                document.addEventListener('mousedown', verifyInput, true);
            }
    
            // CSS Injection
            if (!document.getElementById('margo-bot-css')) {
                 const style = document.createElement('style');
                 style.id = 'margo-bot-css';
                 style.innerHTML = `
                    #margo-bot-panel {
                        position: fixed; top: 20px; left: 20px; z-index: 99999;
                        background: rgba(28, 28, 33, 0.95); 
                        color: #ececec;
                        padding: 0; 
                        border-radius: 12px; 
                        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        width: 320px; 
                        border: 1px solid #444;
                        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                        backdrop-filter: blur(10px);
                        font-size: 13px;
                    }
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
                    ::-webkit-scrollbar { width: 6px; }
                    ::-webkit-scrollbar-track { background: #222; }
                    ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
                    ::-webkit-scrollbar-thumb:hover { background: #777; }
                    .mb-license-screen { padding: 25px 20px; text-align: center; }
                    .mb-license-icon { font-size: 48px; margin-bottom: 15px; }
                    .mb-license-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
                    .mb-license-subtitle { font-size: 11px; color: #888; margin-bottom: 20px; }
                    .mb-license-input { width: 100%; box-sizing: border-box; padding: 12px 15px; background: #2a2a30; border: 2px solid #444; color: #fff; border-radius: 8px; font-size: 14px; font-family: 'Courier New', monospace; text-align: center; letter-spacing: 2px; margin-bottom: 15px; transition: all 0.3s; }
                    .mb-license-input:focus { border-color: #2196F3; background: #333; outline: none; box-shadow: 0 0 15px rgba(33, 150, 243, 0.2); }
                    .mb-license-input.error { border-color: #f44336; animation: shake 0.4s; }
                    .mb-license-input.success { border-color: #4CAF50; }
                    .mb-license-error { color: #f44336; font-size: 12px; font-weight: 600; margin-bottom: 15px; min-height: 18px; }
                    .mb-license-info { font-size: 10px; color: #666; margin-top: 15px; line-height: 1.5; }
                    .mb-license-valid { background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 11px; color: #81C784; }
                    @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
                 `;
                 if(document.head) document.head.appendChild(style);
            }
    
            // HTML & Panel Logic (Simplified for brevity as exact copy)
            const isLicensed = license && license.valid;
            const licenseExpiry = license && license.info ? license.info.expiresAt : null;
            const licenseHours = license && license.info ? license.info.hoursRemaining : 0;
            const licenseDays = license && license.info ? license.info.daysRemaining : 0;
            let expiryDisplay = licenseHours <= 48 ? `${licenseHours}h` : `${licenseDays}d`;
    
            // Panel Refresh if needed
            const statusChanged = window.LAST_LICENSE_STATUS !== isLicensed;
            if (document.getElementById('margo-bot-panel') && statusChanged) {
                document.getElementById('margo-bot-panel').remove();
            }
            window.LAST_LICENSE_STATUS = isLicensed;
    
            if (document.body && !document.getElementById('margo-bot-panel')) {
                 const div = document.createElement('div');
                 div.id = 'margo-bot-panel';
                 
                 let optionsHtml = `<option value="custom">-- Własne Ustawienia --</option>`;
                 if (window.HUNTING_SPOTS) {
                     window.HUNTING_SPOTS.forEach((spot, idx) => {
                         optionsHtml += `<option value="${idx}">${spot.name}</option>`;
                     });
                 }
                 let mapDataList = allMaps ? allMaps.map(m => `<option value="${m}">`).join('') : '';
                 let monsterDataList = window.ALL_MONSTERS ? window.ALL_MONSTERS.map(m => `<option value="${m.name} (Lvl ${m.lvl}) [${m.map}]">`).join('') : '';
    
                 div.innerHTML = `
                    <div class="mb-header">
                        <div class="mb-title">😼 MargoSzpont</div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            ${isLicensed ? `<div class="mb-status" title="Wygasa: ${licenseExpiry ? new Date(licenseExpiry).toLocaleString('pl-PL') : '?'}" style="cursor: help; color: ${licenseHours <= 48 ? '#ff9800' : '#81C784'}; background: ${licenseHours <= 48 ? 'rgba(255, 152, 0, 0.1)' : 'rgba(76, 175, 80, 0.1)'};">⏱️ ${expiryDisplay}</div>` : ''}
                            <div id="bot-status" class="mb-status" style="color: ${isLicensed ? '#4CAF50' : '#ff9800'}">${isLicensed ? 'OFF' : '🔒'}</div>
                        </div>
                    </div>
                    <div id="license-screen" class="mb-license-screen" style="display: ${isLicensed ? 'none' : 'block'}">
                        <div class="mb-license-icon">🔐</div>
                        <div class="mb-license-title">Wprowadź Klucz Aktywacji</div>
                        <div class="mb-license-subtitle">Aby korzystać z bota, wprowadź prawidłowy klucz licencji</div>
                        <input type="text" id="license-key-input" class="mb-license-input" placeholder="MARGO-XXXXXXXX" autocomplete="off">
                        <div id="license-error" class="mb-license-error"></div>
                        <button id="btn-activate" class="mb-btn" style="background: linear-gradient(135deg, #FF9800, #F57C00); color: white; box-shadow: 0 4px 15px rgba(255, 152, 0, 0.3);">🔑 AKTYWUJ LICENCJĘ</button>
                    </div>
                    <div id="bot-main-ui" style="display: ${isLicensed ? 'block' : 'none'}">
                        <div class="mb-tabs">
                            <div class="mb-tab active" data-tab="exp">EXP</div>
                            <div class="mb-tab" data-tab="transport">TRANSPORT</div>
                            <div class="mb-tab" data-tab="e2">E2</div>
                        </div>
                        <div class="mb-content">
                            <div class="mb-row"><button id="btn-toggle" class="mb-btn" style="background: linear-gradient(135deg, #4CAF50, #45a049); color: white; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);">START BOT</button></div>
                            <div id="panel-exp" class="mb-tab-content">
                                <div class="mb-col"><div class="mb-label">Wybierz Expowisko</div><select id="inp-spot" class="mb-select">${optionsHtml}</select></div>
                                <div class="mb-row" style="gap: 10px;">
                                    <div style="flex: 1;"><div class="mb-label">Min Lvl</div><input type="number" id="inp-min" class="mb-input" value="${window.BOT_CONFIG.minLvl}"></div>
                                    <div style="flex: 1;"><div class="mb-label">Max Lvl</div><input type="number" id="inp-max" class="mb-input" value="${window.BOT_CONFIG.maxLvl}"></div>
                                </div>
                                <div class="mb-row">
                                     <label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;">
                                        <input type="checkbox" id="inp-heal" ${window.BOT_CONFIG.autoHeal ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #2196F3;"> Auto Heal
                                     </label>
                                     <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                                        <div class="mb-label" style="margin: 0;">Sloty Potek:</div>
                                        <input type="number" id="inp-potion-slots" class="mb-input" value="${window.BOT_POTION_SLOTS || 14}" min="1" max="50" style="width: 60px; padding: 4px 8px;">
                                     </div>
                                </div>
                                <div class="mb-col"><div class="mb-label">Lista Map (edytowalna)</div><textarea id="inp-maps" class="mb-textarea" spellcheck="false">${(window.BOT_CONFIG.maps || []).join('\n')}</textarea></div>
                            </div>
                            <div id="panel-transport" class="mb-tab-content" style="display: none;">
                                 <div class="mb-col"><div class="mb-label">Cel Podróży</div><input list="map-datalist" id="inp-transport-map" class="mb-input" placeholder="Wpisz nazwę mapy..."><datalist id="map-datalist">${mapDataList}</datalist></div>
                            </div>
                            <div id="panel-e2" class="mb-tab-content" style="display: none;">
                                 <div class="mb-col"><div class="mb-label">Wybierz E2</div><input list="monster-datalist" id="inp-e2-monster" class="mb-input" placeholder="Wpisz nazwę potwora..."><datalist id="monster-datalist">${monsterDataList}</datalist></div>
                                 <div class="mb-row"><label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;"><input type="checkbox" id="inp-e2-attack" ${uiState.e2Attack !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #FF5722;"> ⚔️ Atakuj E2</label></div>
                            </div>
                            <div class="mb-row" style="margin-bottom: 0;"><button id="btn-save" class="mb-btn" style="background: linear-gradient(135deg, #2196F3, #1976D2); color: white; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);">Zapisz Konfigurację</button></div>
                        </div>
                    </div>`;
                 document.body.appendChild(div);
    
                 // Bind Events
                 const activateBtn = document.getElementById('btn-activate');
                 const licenseInput = document.getElementById('license-key-input');
                 if (activateBtn && licenseInput) {
                     activateBtn.onclick = () => {
                         const key = licenseInput.value.trim();
                         if (!key) {
                             document.getElementById('license-error').textContent = '⚠️ Wprowadź klucz licencji';
                             return;
                         }
                         localStorage.setItem('MARGO_LICENSE_KEY', key);
                         window.PENDING_LICENSE_KEY = key;
                         activateBtn.textContent = '⏳ WERYFIKACJA...';
                         activateBtn.disabled = true;
                     };
                     const savedKey = localStorage.getItem('MARGO_LICENSE_KEY');
                     if (savedKey && !license?.valid) licenseInput.value = savedKey;
                     if (license && !license.valid && license.reason) {
                         document.getElementById('license-error').textContent = '❌ ' + license.reason;
                         activateBtn.textContent = '🔑 AKTYWUJ LICENCJĘ';
                         activateBtn.disabled = false;
                     }
                 }
                 
                 // UI Logic (Tabs, Save, Toggle, Drag)
                 const tabs = div.querySelectorAll('.mb-tab');
                 const panels = { exp: div.querySelector('#panel-exp'), transport: div.querySelector('#panel-transport'), e2: div.querySelector('#panel-e2') };
                 let currentTab = uiState.tab || 'exp';
                 if (uiState.transport && document.getElementById('inp-transport-map')) document.getElementById('inp-transport-map').value = uiState.transport;
                 if (uiState.e2 && document.getElementById('inp-e2-monster')) document.getElementById('inp-e2-monster').value = uiState.e2;
    
                 const updateTabs = () => {
                     tabs.forEach(t => t.classList.remove('active'));
                     div.querySelector(`.mb-tab[data-tab="${currentTab}"]`).classList.add('active');
                     Object.values(panels).forEach(p => p.style.display = 'none');
                     panels[currentTab].style.display = 'block';
                 };
                 updateTabs();
    
                 const saveUIState = () => {
                     const ps = parseInt(document.getElementById('inp-potion-slots')?.value) || 14;
                     window.BOT_POTION_SLOTS = ps;
                     const state = {
                         tab: currentTab,
                         transport: document.getElementById('inp-transport-map')?.value || '',
                         e2: document.getElementById('inp-e2-monster')?.value || '',
                         potionSlots: ps,
                         e2Attack: document.getElementById('inp-e2-attack')?.checked
                     };
                     localStorage.setItem('MARGO_UI_STATE', JSON.stringify(state));
                 };
    
                 tabs.forEach(tab => {
                     tab.onclick = () => {
                         if (currentTab !== tab.dataset.tab && window.BOT_ACTIVE) {
                             window.BOT_ACTIVE = false;
                             localStorage.setItem('MARGO_BOT_ACTIVE', 'false');
                         }
                         currentTab = tab.dataset.tab;
                         updateTabs();
                         saveUIState();
                     };
                 });
                 
                 ['inp-transport-map', 'inp-e2-monster', 'inp-e2-attack', 'inp-potion-slots'].forEach(id => {
                     const el = document.getElementById(id);
                     if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', saveUIState);
                 });
    
                 const spotSelect = document.getElementById('inp-spot');
                 spotSelect.onchange = () => {
                     if (spotSelect.value === 'custom') return;
                     const spot = window.HUNTING_SPOTS[parseInt(spotSelect.value)];
                     if (spot) {
                         document.getElementById('inp-min').value = spot.min;
                         document.getElementById('inp-max').value = spot.max;
                         document.getElementById('inp-maps').value = spot.maps.join('\n');
                     }
                 };
                 
                 document.getElementById('btn-toggle').onclick = () => {
                     window.BOT_ACTIVE = !window.BOT_ACTIVE;
                     localStorage.setItem('MARGO_BOT_ACTIVE', window.BOT_ACTIVE);
                 };
    
                 document.getElementById('btn-save').onclick = function() {
                      const min = parseInt(document.getElementById('inp-min').value);
                      const max = parseInt(document.getElementById('inp-max').value);
                      const heal = document.getElementById('inp-heal').checked;
                      const maps = document.getElementById('inp-maps').value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                      
                      if (!isNaN(min) && !isNaN(max)) {
                          window.BOT_CONFIG.minLvl = min;
                          window.BOT_CONFIG.maxLvl = max;
                          window.BOT_CONFIG.autoHeal = heal;
                          window.BOT_CONFIG.maps = maps;
                          localStorage.setItem('MARGO_BOT_CFG', JSON.stringify(window.BOT_CONFIG));
                          
                          const btn = this;
                          const originalText = btn.innerText;
                          btn.innerText = '✅ ZAPISANO!';
                          setTimeout(() => btn.innerText = originalText, 1500);
                      }
                 };
    
                 // Dragging
                 const header = div.querySelector('.mb-header');
                 let isDragging = false, startX, startY, initialLeft, initialTop;
                 header.onmousedown = (e) => {
                     if (e.target.closest('.mb-btn')) return;
                     isDragging = true; startX = e.clientX; startY = e.clientY;
                     const rect = div.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
                 };
                 document.onmousemove = (e) => {
                     if (!isDragging) return;
                     div.style.left = `${initialLeft + e.clientX - startX}px`;
                     div.style.top = `${initialTop + e.clientY - startY}px`;
                 };
                 document.onmouseup = () => isDragging = false;
            }
    
            // Update Status
            const st = document.getElementById('bot-status');
            const btn = document.getElementById('btn-toggle');
            if (st && btn) {
                st.innerText = window.BOT_ACTIVE ? 'ON' : 'OFF';
                st.style.color = window.BOT_ACTIVE ? '#4CAF50' : '#f44336';
                btn.innerText = window.BOT_ACTIVE ? 'ZATRZYMAJ' : 'URUCHOM';
                btn.style.background = window.BOT_ACTIVE ? 'linear-gradient(135deg, #f44336, #d32f2f)' : 'linear-gradient(135deg, #4CAF50, #45a049)';
            }
            
            // Return State
            let mode = 'exp';
            let transportMap = '';
            let monsterTarget = null;
            const activeTab = document.querySelector('.mb-tab.active');
            if (activeTab) {
                if (activeTab.dataset.tab === 'transport') {
                    mode = 'transport';
                    transportMap = document.getElementById('inp-transport-map')?.value || '';
                } else if (activeTab.dataset.tab === 'e2') {
                    mode = 'monster';
                    const val = document.getElementById('inp-e2-monster')?.value?.toLowerCase();
                    if (val && window.ALL_MONSTERS) {
                        const match = window.ALL_MONSTERS.find(m => `${m.name} (Lvl ${m.lvl}) [${m.map}]`.toLowerCase() === val || val.startsWith(m.name.toLowerCase()));
                        if (match) monsterTarget = match;
                    }
                }
            }
    
            return { 
                active: window.BOT_ACTIVE, 
                config: window.BOT_CONFIG,
                securityAlert: window.BOT_SECURITY_FLAG,
                mode: mode,
                transportMap: transportMap,
                monsterTarget: monsterTarget,
                e2Attack: document.getElementById('inp-e2-attack')?.checked,
                licenseValid: license && license.valid,
                pendingLicenseKey: window.PENDING_LICENSE_KEY || localStorage.getItem('MARGO_LICENSE_KEY') || null
            };
        }, { cfg: defaultConfig, spots: huntingSpots, allMaps: allMapNames, monsters: allMonsters, license: licenseInfo });
    }
};
