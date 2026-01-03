const logger = require('../utils/logger');

async function injectUI(page, defaultConfig, huntingSpots, allMapNames, allMonsters) {
    return await page.evaluate(({ cfg, spots, allMaps, monsters }) => {
        if (!document.body) return { active: false, config: cfg }; // Safety check

        if (!window.BOT_CONFIG) {
            const saved = localStorage.getItem('MARGO_BOT_CFG');
            window.BOT_CONFIG = saved ? JSON.parse(saved) : cfg;
            
            // Restore Active State
            const savedActive = localStorage.getItem('MARGO_BOT_ACTIVE');
            window.BOT_ACTIVE = savedActive === 'true'; 
        }
        
        // Cache spots for easy access
        window.HUNTING_SPOTS = spots || [];
        window.ALL_MONSTERS = monsters || [];
        
        // --- SECURITY MONITOR ---
        if (!window.SECURITY_MONITORED) {
            window.SECURITY_MONITORED = true;
            window.BOT_SECURITY_FLAG = false;
            
            const monitoredKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'e', 'r', ' '];
            
            const verifyInput = (e) => {
                if (e.type === 'keydown' && !monitoredKeys.includes(e.key)) return;
                if (e.isTrusted === false) {
                    console.error('🛑 SECURITY ALERT: Untrusted (Script) Input Detected!', e);
                    window.BOT_SECURITY_FLAG = true;
                }
            };
            
            document.addEventListener('keydown', verifyInput, true);
            document.addEventListener('mousedown', verifyInput, true);
        }

        // --- CSS ---
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
                .mb-header {
                    padding: 12px 15px;
                    background: rgba(255, 255, 255, 0.05);
                    border-bottom: 1px solid #444;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                    user-select: none;
                }
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
                
                .mb-btn { 
                    padding: 10px; border: none; border-radius: 6px; cursor: pointer; 
                    font-weight: 700; width: 100%; text-transform: uppercase; letter-spacing: 1px;
                    transition: all 0.2s;
                    font-size: 12px;
                }
                .mb-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .mb-btn:active { transform: translateY(0); }

                .mb-input { 
                    width: 100%; box-sizing: border-box;
                    padding: 8px 10px; background: #2a2a30; border: 1px solid #444; 
                    color: white; border-radius: 6px; outline: none; transition: border-color 0.2s;
                }
                .mb-input:focus { border-color: #2196F3; background: #333; }
                
                .mb-select {
                    width: 100%; padding: 8px; background: #2a2a30; border: 1px solid #444;
                    color: white; border-radius: 6px; outline: none; cursor: pointer;
                }
                
                .mb-textarea {
                    width: 100%; height: 80px; background: #2a2a30; border: 1px solid #444;
                    color: #ddd; border-radius: 6px; padding: 8px; font-size: 11px;
                    resize: vertical; font-family: monospace; white-space: pre;
                    outline: none;
                }

                /* Scrollbar */
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: #222; }
                ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
                ::-webkit-scrollbar-thumb:hover { background: #777; }
             `;
             if(document.head) document.head.appendChild(style);
        }

        // --- HTML ---
        if (document.body && !document.getElementById('margo-bot-panel')) {
             const div = document.createElement('div');
             div.id = 'margo-bot-panel';
             
             // Construct Options
             let optionsHtml = `<option value="custom">-- Własne Ustawienia --</option>`;
             if (window.HUNTING_SPOTS) {
                 window.HUNTING_SPOTS.forEach((spot, idx) => {
                     optionsHtml += `<option value="${idx}">${spot.name}</option>`;
                 });
             }

             // Map Datalist
             let mapDataList = '';
             if (allMaps) {
                 mapDataList = allMaps.map(m => `<option value="${m}">`).join('');
             }

             // Monster Datalist
             let monsterDataList = '';
             if (window.ALL_MONSTERS) {
                 monsterDataList = window.ALL_MONSTERS.map(m => `<option value="${m.name} (Lvl ${m.lvl}) [${m.map}]">`).join('');
             }

             div.innerHTML = `
                <div class="mb-header">
                    <div class="mb-title">😼 MargoSzpont</div>
                    <div id="bot-status" class="mb-status" style="color: #f44336">OFF</div>
                </div>
                
                <div class="mb-tabs">
                    <div class="mb-tab active" data-tab="exp">EXP</div>
                    <div class="mb-tab" data-tab="transport">TRANSPORT</div>
                    <div class="mb-tab" data-tab="e2">E2</div>
                </div>

                <div class="mb-content">
                    <div class="mb-row">
                        <button id="btn-toggle" class="mb-btn" style="background: linear-gradient(135deg, #4CAF50, #45a049); color: white; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);">START BOT</button>
                    </div>

                    <!-- EXP PANEL -->
                    <div id="panel-exp" class="mb-tab-content">
                        <div class="mb-col">
                            <div class="mb-label">Wybierz Expowisko</div>
                            <select id="inp-spot" class="mb-select">
                                ${optionsHtml}
                            </select>
                        </div>

                        <div class="mb-row" style="gap: 10px;">
                            <div style="flex: 1;">
                                <div class="mb-label">Min Lvl</div>
                                <input type="number" id="inp-min" class="mb-input" value="${window.BOT_CONFIG.minLvl}">
                            </div>
                            <div style="flex: 1;">
                                 <div class="mb-label">Max Lvl</div>
                                <input type="number" id="inp-max" class="mb-input" value="${window.BOT_CONFIG.maxLvl}">
                            </div>
                        </div>

                        <div class="mb-row">
                             <label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <input type="checkbox" id="inp-heal" ${window.BOT_CONFIG.autoHeal ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #2196F3;"> 
                                Auto Heal
                             </label>
                        </div>

                        <div class="mb-col">
                            <div class="mb-label">Lista Map (edytowalna)</div>
                            <textarea id="inp-maps" class="mb-textarea" spellcheck="false">${(window.BOT_CONFIG.maps || []).join('\n')}</textarea>
                        </div>
                    </div>

                     <!-- TRANSPORT PANEL -->
                    <div id="panel-transport" class="mb-tab-content" style="display: none;">
                         <div class="mb-col">
                            <div class="mb-label">Cel Podróży</div>
                            <input list="map-datalist" id="inp-transport-map" class="mb-input" placeholder="Wpisz nazwę mapy (np. Eder)...">
                            <datalist id="map-datalist">
                                ${mapDataList}
                            </datalist>
                         </div>
                         <div class="mb-row">
                             <div class="mb-label" style="font-size: 10px; color: #888; line-height: 1.4;">
                                ℹ️ Tryb Transportu: Bot przejdzie do wskazanej mapy. Atakowanie wyłączone. Sprzedawanie wyłączone. Leczenie tylko krytyczne (<10% w mieście).
                             </div>
                         </div>
                    </div>

                    <!-- E2 PANEL -->
                    <div id="panel-e2" class="mb-tab-content" style="display: none;">
                         <div class="mb-col">
                            <div class="mb-label">Wybierz E2</div>
                            <input list="monster-datalist" id="inp-e2-monster" class="mb-input" placeholder="Wpisz nazwę potwora...">
                            <datalist id="monster-datalist">
                                ${monsterDataList}
                            </datalist>
                         </div>
                         <div class="mb-row">
                             <div class="mb-label" style="font-size: 10px; color: #888; line-height: 1.4;">
                                ℹ️ Tryb E2: Bot przejdzie do mapy i koordynatów wybranego potwora.
                             </div>
                         </div>
                    </div>

                    <div class="mb-row" style="margin-bottom: 0;">
                        <button id="btn-save" class="mb-btn" style="background: linear-gradient(135deg, #2196F3, #1976D2); color: white; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);">Zapisz Konfigurację</button>
                    </div>
                </div>
             `;
             document.body.appendChild(div);

             // --- Logic ---
             
             // TAB LOGIC
             const tabs = div.querySelectorAll('.mb-tab');
             const panelExp = div.querySelector('#panel-exp');
             const panelTransport = div.querySelector('#panel-transport');
             const panelE2 = div.querySelector('#panel-e2');
             
             // Default Tab State
             let currentTab = 'exp';

             tabs.forEach(tab => {
                 tab.onclick = () => {
                     tabs.forEach(t => t.classList.remove('active'));
                     tab.classList.add('active');
                     currentTab = tab.dataset.tab;
                     
                     panelExp.style.display = 'none';
                     panelTransport.style.display = 'none';
                     panelE2.style.display = 'none';

                     if (currentTab === 'exp') {
                         panelExp.style.display = 'block';
                     } else if (currentTab === 'transport') {
                         panelTransport.style.display = 'block';
                     } else if (currentTab === 'e2') {
                         panelE2.style.display = 'block';
                     }
                 };
             });
             
             // 0. Force Visibility (Fix for "invisible" UI)
             const mainPanel = document.getElementById('margo-bot-panel');
             if (mainPanel) {
                 mainPanel.style.display = 'block';
                 mainPanel.style.visibility = 'visible';
                 mainPanel.style.zIndex = '9999999';
             }

             // 0.5. Restore Dropdown State based on Map Config
             if (window.BOT_CONFIG.maps && window.HUNTING_SPOTS) {
                 const currentMaps = window.BOT_CONFIG.maps.map(m => m.toLowerCase().replace(/\s/g, ''));
                 const currentMapsSet = new Set(currentMaps);
                 
                 for (let i = 0; i < window.HUNTING_SPOTS.length; i++) {
                     const spot = window.HUNTING_SPOTS[i];
                     if (!spot.maps) continue;
                     
                     // Check for exact match of map set (ignoring order)
                     const spotMaps = spot.maps.map(m => m.toLowerCase().replace(/\s/g, ''));
                     if (spotMaps.length === currentMaps.length) {
                         const allMatch = spotMaps.every(m => currentMapsSet.has(m));
                         if (allMatch) {
                             const sel = document.getElementById('inp-spot');
                             if (sel) sel.value = i;
                             break;
                         }
                     }
                 }
             }

             // 1. Selector Change Logic
             const spotSelect = document.getElementById('inp-spot');
             spotSelect.onchange = () => {
                 const val = spotSelect.value;
                 if (val === 'custom') return; // Do nothing, let user edit
                 
                 const spot = window.HUNTING_SPOTS[parseInt(val)];
                 if (spot) {
                     document.getElementById('inp-min').value = spot.min;
                     document.getElementById('inp-max').value = spot.max;
                     document.getElementById('inp-maps').value = spot.maps.join('\n');
                 }
             };

              // No JS search logic needed for datalist!

             // 2. Toggle Bot
             const toggleBtn = document.getElementById('btn-toggle');
             toggleBtn.onclick = () => {
                 window.BOT_ACTIVE = !window.BOT_ACTIVE;
                 localStorage.setItem('MARGO_BOT_ACTIVE', window.BOT_ACTIVE);
             };

             // 3. Save Logic
             const saveBtn = document.getElementById('btn-save');
             saveBtn.onclick = () => {
                 const min = parseInt(document.getElementById('inp-min').value);
                 const max = parseInt(document.getElementById('inp-max').value);
                 const heal = document.getElementById('inp-heal').checked;
                 const mapsStr = document.getElementById('inp-maps').value;
                 
                 if (!isNaN(min) && !isNaN(max)) {
                     window.BOT_CONFIG.minLvl = min;
                     window.BOT_CONFIG.maxLvl = max;
                     window.BOT_CONFIG.autoHeal = heal;
                     window.BOT_CONFIG.maps = mapsStr.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                     
                     localStorage.setItem('MARGO_BOT_CFG', JSON.stringify(window.BOT_CONFIG));
                     
                     // Visual feedback for save
                     const originalText = saveBtn.innerText;
                     saveBtn.innerText = '✅ ZAPISANO!';
                     saveBtn.style.background = 'linear-gradient(135deg, #00C853, #43A047)';
                     setTimeout(() => {
                         saveBtn.innerText = originalText;
                         saveBtn.style.background = 'linear-gradient(135deg, #2196F3, #1976D2)';
                     }, 1500);
                 }
             };

             // --- DRAGGABLE LOGIC ---
             const header = div.querySelector('.mb-header');
             let isDragging = false;
             let startX, startY, initialLeft, initialTop;
 
             const onMouseDown = (e) => {
                 if (e.target.closest('.mb-btn') || e.target.closest('.mb-input')) return;
                 isDragging = true;
                 startX = e.clientX;
                 startY = e.clientY;
                 const rect = div.getBoundingClientRect();
                 initialLeft = rect.left;
                 initialTop = rect.top;
                 header.style.cursor = 'grabbing';
                 e.preventDefault();
             };
 
             const onMouseMove = (e) => {
                 if (!isDragging) return;
                 const dx = e.clientX - startX;
                 const dy = e.clientY - startY;
                 div.style.left = `${initialLeft + dx}px`;
                 div.style.top = `${initialTop + dy}px`;
                 div.style.right = 'auto'; // Prevent right align issues
             };
 
             const onMouseUp = () => {
                 if (isDragging) {
                     isDragging = false;
                     header.style.cursor = 'move';
                 }
             };
 
             header.addEventListener('mousedown', onMouseDown);
             document.addEventListener('mousemove', onMouseMove);
             document.addEventListener('mouseup', onMouseUp);
        }

        // --- UPDATE UI STATE ---
        const panel = document.getElementById('margo-bot-panel');
        const st = document.getElementById('bot-status');
        const btn = document.getElementById('btn-toggle');
        
        if (st && btn && panel) {
                if (window.BOT_ACTIVE) {
                st.innerText = 'ON'; st.style.color = '#4CAF50';
                st.style.background = 'rgba(76, 175, 80, 0.1)';
                
                btn.innerText = 'ZATRZYMAJ'; 
                btn.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
                btn.style.boxShadow = '0 4px 15px rgba(244, 67, 54, 0.3)';
                
                panel.style.borderColor = '#4CAF50';
            } else {
                st.innerText = 'OFF'; st.style.color = '#f44336';
                st.style.background = 'rgba(244, 67, 54, 0.1)';
                
                btn.innerText = 'URUCHOM'; 
                btn.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                btn.style.boxShadow = '0 4px 15px rgba(76, 175, 80, 0.3)';
                
                panel.style.borderColor = '#444';
            }
        }
        
        // Return current mode and target
        const activeTab = document.querySelector('.mb-tab.active');
        let mode = 'exp';
        let transportMap = '';
        let monsterTarget = null;
        
        if (activeTab) {
            const tabName = activeTab.dataset.tab;
            if (tabName === 'transport') {
                mode = 'transport';
                transportMap = document.getElementById('inp-transport-map') ? document.getElementById('inp-transport-map').value : '';
            } else if (tabName === 'e2') {
                mode = 'monster'; // Keep internal mode name 'monster'
                const e2Input = document.getElementById('inp-e2-monster');
                if (e2Input && e2Input.value) {
                    const val = e2Input.value.toLowerCase();
                    // Match by exact string format OR if name is contained
                    // Format: "${m.name} (Lvl ${m.lvl}) [${m.map}]"
                    
                    // Simple find: Check if the value starts with the monster name (case insensitive)
                    // Or exact match of the formatted string
                     const match = window.ALL_MONSTERS.find(m => {
                         const formatted = `${m.name} (Lvl ${m.lvl}) [${m.map}]`.toLowerCase();
                         return formatted === val || val.startsWith(m.name.toLowerCase());
                     });
                     
                     if (match) {
                         monsterTarget = match;
                     }
                }
            }
        }

        return { 
            active: window.BOT_ACTIVE, 
            config: window.BOT_CONFIG,
            securityAlert: window.BOT_SECURITY_FLAG,
            mode: mode,
            transportMap: transportMap,
            monsterTarget: monsterTarget
        };
    }, { cfg: defaultConfig, spots: huntingSpots, allMaps: allMapNames, monsters: allMonsters });
}

module.exports = { injectUI };
