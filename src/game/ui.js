const logger = require('../utils/logger');

async function injectUI(page, defaultConfig, huntingSpots, allMapNames, allMonsters, licenseInfo = null) {
    return await page.evaluate(({ cfg, spots, allMaps, monsters, license }) => {
        if (!document.body) return { active: false, config: cfg, licenseValid: false }; // Safety check

        // --- LICENSE STATE ---
        // License info is passed from Node.js side (validated externally)
        window.BOT_LICENSE = license;

        if (!window.BOT_CONFIG) {
            const saved = localStorage.getItem('MARGO_BOT_CFG');
            window.BOT_CONFIG = saved ? JSON.parse(saved) : cfg;
            
            // Restore Active State
            const savedActive = localStorage.getItem('MARGO_BOT_ACTIVE');
            window.BOT_ACTIVE = savedActive === 'true'; 
        }

        // Restore UI State (Tab & Inputs)
        let uiState = { tab: 'exp', transport: '', e2: '', potionSlots: 14, e2Attack: true };
        try {
            const savedUI = localStorage.getItem('MARGO_UI_STATE');
            if (savedUI) uiState = JSON.parse(savedUI);
        } catch (e) {}
        
        // Initialize potion slots setting
        if (typeof window.BOT_POTION_SLOTS === 'undefined') {
            window.BOT_POTION_SLOTS = uiState.potionSlots || 14;
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
                    outline: none; box-sizing: border-box;
                }

                /* Scrollbar */
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: #222; }
                ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
                ::-webkit-scrollbar-thumb:hover { background: #777; }

                /* License Activation Screen */
                .mb-license-screen {
                    padding: 25px 20px;
                    text-align: center;
                }
                .mb-license-icon {
                    font-size: 48px;
                    margin-bottom: 15px;
                }
                .mb-license-title {
                    font-size: 16px;
                    font-weight: 700;
                    color: #fff;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                .mb-license-subtitle {
                    font-size: 11px;
                    color: #888;
                    margin-bottom: 20px;
                }
                .mb-license-input {
                    width: 100%;
                    box-sizing: border-box;
                    padding: 12px 15px;
                    background: #2a2a30;
                    border: 2px solid #444;
                    color: #fff;
                    border-radius: 8px;
                    font-size: 14px;
                    font-family: 'Courier New', monospace;
                    text-align: center;
                    letter-spacing: 2px;
                    margin-bottom: 15px;
                    transition: all 0.3s;
                }
                .mb-license-input:focus {
                    border-color: #2196F3;
                    background: #333;
                    outline: none;
                    box-shadow: 0 0 15px rgba(33, 150, 243, 0.2);
                }
                .mb-license-input.error {
                    border-color: #f44336;
                    animation: shake 0.4s;
                }
                .mb-license-input.success {
                    border-color: #4CAF50;
                }
                .mb-license-error {
                    color: #f44336;
                    font-size: 12px;
                    font-weight: 600;
                    margin-bottom: 15px;
                    min-height: 18px;
                }
                .mb-license-info {
                    font-size: 10px;
                    color: #666;
                    margin-top: 15px;
                    line-height: 1.5;
                }
                .mb-license-valid {
                    background: rgba(76, 175, 80, 0.1);
                    border: 1px solid rgba(76, 175, 80, 0.3);
                    border-radius: 6px;
                    padding: 8px 12px;
                    margin-bottom: 10px;
                    font-size: 11px;
                    color: #81C784;
                }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
             `;
             if(document.head) document.head.appendChild(style);
        }

        // --- HTML ---
        // Check if license status changed or new validation happened - if so, force panel recreation
        const currentLicenseStatus = license && license.valid;
        const currentLicenseReason = license && license.reason ? license.reason : '';
        const hasPendingKey = !!window.PENDING_LICENSE_KEY;
        
        const statusChanged = window.LAST_LICENSE_STATUS !== currentLicenseStatus;
        const reasonChanged = window.LAST_LICENSE_REASON !== currentLicenseReason;
        
        // Force refresh if: status changed, reason changed, or there was a pending key (just validated)
        if (document.getElementById('margo-bot-panel') && (statusChanged || reasonChanged || hasPendingKey)) {
            const oldPanel = document.getElementById('margo-bot-panel');
            if (oldPanel) {
                oldPanel.remove();
                console.log('🔄 License validation updated, refreshing UI panel');
            }
        }
        window.LAST_LICENSE_STATUS = currentLicenseStatus;
        window.LAST_LICENSE_REASON = currentLicenseReason;
        window.PENDING_LICENSE_KEY = null; // Clear pending flag after handling

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

             // Check license status
             const isLicensed = license && license.valid;
             const licenseExpiry = license && license.info ? license.info.expiresAt : null;
             const licenseDays = license && license.info ? license.info.daysRemaining : 0;
             const licenseHours = license && license.info ? license.info.hoursRemaining : 0;
             
             // Format expiry display - show hours if <48h, otherwise days
             let expiryDisplay = '';
             if (isLicensed) {
                 if (licenseHours <= 48) {
                     expiryDisplay = `${licenseHours}h`;
                 } else {
                     expiryDisplay = `${licenseDays}d`;
                 }
             }

             div.innerHTML = `
                <div class="mb-header">
                    <div class="mb-title">😼 MargoSzpont</div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${isLicensed ? `<div class="mb-status" title="Wygasa: ${licenseExpiry ? new Date(licenseExpiry).toLocaleString('pl-PL') : '?'}" style="cursor: help; color: ${licenseHours <= 48 ? '#ff9800' : '#81C784'}; background: ${licenseHours <= 48 ? 'rgba(255, 152, 0, 0.1)' : 'rgba(76, 175, 80, 0.1)'};">⏱️ ${expiryDisplay}</div>` : ''}
                        <div id="bot-status" class="mb-status" style="color: ${isLicensed ? '#4CAF50' : '#ff9800'}">${isLicensed ? 'OFF' : '🔒'}</div>
                    </div>
                </div>
                
                <!-- LICENSE ACTIVATION SCREEN (shown when no license) -->
                <div id="license-screen" class="mb-license-screen" style="display: ${isLicensed ? 'none' : 'block'}">
                    <div class="mb-license-icon">🔐</div>
                    <div class="mb-license-title">Wprowadź Klucz Aktywacji</div>
                    <div class="mb-license-subtitle">Aby korzystać z bota, wprowadź prawidłowy klucz licencji</div>
                    <input type="text" id="license-key-input" class="mb-license-input" placeholder="MARGO-XXXXXXXX" autocomplete="off" spellcheck="false">
                    <div id="license-error" class="mb-license-error"></div>
                    <button id="btn-activate" class="mb-btn" style="background: linear-gradient(135deg, #FF9800, #F57C00); color: white; box-shadow: 0 4px 15px rgba(255, 152, 0, 0.3);">
                        🔑 AKTYWUJ LICENCJĘ
                    </button>
                    <div class="mb-license-info">
                        Nie masz klucza? Skontaktuj się z właścicielem bota.
                    </div>
                </div>
                
                <!-- MAIN BOT UI (shown when licensed) -->
                <div id="bot-main-ui" style="display: ${isLicensed ? 'block' : 'none'}">

                    
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
                                <div class="mb-label" style="margin-bottom: 5px;">Min Lvl</div>
                                <input type="number" id="inp-min" class="mb-input" value="${window.BOT_CONFIG.minLvl}">
                            </div>
                            <div style="flex: 1;">
                                 <div class="mb-label" style="margin-bottom: 5px;">Max Lvl</div>
                                <input type="number" id="inp-max" class="mb-input" value="${window.BOT_CONFIG.maxLvl}">
                            </div>
                        </div>

                        <div class="mb-row">
                             <label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <input type="checkbox" id="inp-heal" ${window.BOT_CONFIG.autoHeal ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #2196F3;"> 
                                Auto Heal
                             </label>
                             <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                                <div class="mb-label" style="margin: 0;">Sloty Potek:</div>
                                <input type="number" id="inp-potion-slots" class="mb-input" value="${window.BOT_POTION_SLOTS || 14}" min="1" max="50" style="width: 60px; padding: 4px 8px;">
                             </div>
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
                             <label style="cursor:pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <input type="checkbox" id="inp-e2-attack" ${uiState.e2Attack !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #FF5722;">
                                ⚔️ Atakuj E2
                             </label>
                         </div>
                         <div class="mb-row">
                             <div class="mb-label" style="font-size: 10px; color: #888; line-height: 1.4;">
                                ℹ️ Tryb E2: Bot przejdzie do mapy potwora. Gdy "Atakuj E2" jest wyłączone, bot tylko stoi przy E2 (dla grupowego farmu).
                             </div>
                         </div>
                    </div>

                    <div class="mb-row" style="margin-bottom: 0;">
                        <button id="btn-save" class="mb-btn" style="background: linear-gradient(135deg, #2196F3, #1976D2); color: white; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);">Zapisz Konfigurację</button>
                    </div>
                </div>
                </div> <!-- Close bot-main-ui -->
             `;
             document.body.appendChild(div);

             // --- LICENSE ACTIVATION LOGIC ---
             const activateBtn = document.getElementById('btn-activate');
             const licenseInput = document.getElementById('license-key-input');
             const licenseError = document.getElementById('license-error');
             
             if (activateBtn && licenseInput) {
                 // Store entered key in localStorage for validation on next loop
                 activateBtn.onclick = () => {
                     const key = licenseInput.value.trim();
                     if (!key) {
                         licenseError.textContent = '⚠️ Wprowadź klucz licencji';
                         licenseInput.classList.add('error');
                         setTimeout(() => licenseInput.classList.remove('error'), 400);
                         return;
                     }
                     // Store key for external validation
                     localStorage.setItem('MARGO_LICENSE_KEY', key);
                     window.PENDING_LICENSE_KEY = key;
                     
                     // Visual feedback
                     activateBtn.textContent = '⏳ WERYFIKACJA...';
                     activateBtn.disabled = true;
                     licenseError.textContent = '';
                     licenseInput.classList.remove('error');
                 };
                 
                 // Restore pending key if exists
                 const savedKey = localStorage.getItem('MARGO_LICENSE_KEY');
                 if (savedKey && !license?.valid) {
                     licenseInput.value = savedKey;
                 }
                 
                 // Show error if passed from previous validation and reset button
                 if (license && !license.valid && license.reason) {
                     licenseError.textContent = '❌ ' + license.reason;
                     licenseInput.classList.add('error');
                     // Reset button so user can try again
                     activateBtn.textContent = '🔑 AKTYWUJ LICENCJĘ';
                     activateBtn.disabled = false;
                 }
             }

             // --- Logic ---
             
             // TAB LOGIC
             const tabs = div.querySelectorAll('.mb-tab');
             const panelExp = div.querySelector('#panel-exp');
             const panelTransport = div.querySelector('#panel-transport');
             const panelE2 = div.querySelector('#panel-e2');
             
             // Default Tab State (Restore)
             let currentTab = uiState.tab || 'exp';
              
             // Restore Inputs
             if (uiState.transport) {
                  const tInp = document.getElementById('inp-transport-map');
                  if (tInp) tInp.value = uiState.transport;
             }
             if (uiState.e2) {
                  const e2Inp = document.getElementById('inp-e2-monster');
                  if (e2Inp) e2Inp.value = uiState.e2;
             }
             
             // FUNCTION TO SAVE STATE
             const saveUIState = () => {
                 const potionSlotsInput = document.getElementById('inp-potion-slots');
                 const potionSlots = potionSlotsInput ? parseInt(potionSlotsInput.value) || 14 : 14;
                 const e2AttackCheckbox = document.getElementById('inp-e2-attack');
                 const e2Attack = e2AttackCheckbox ? e2AttackCheckbox.checked : true;
                 
                 // Update global variable immediately
                 window.BOT_POTION_SLOTS = potionSlots;
                 
                 const state = {
                     tab: currentTab,
                     transport: document.getElementById('inp-transport-map')?.value || '',
                     e2: document.getElementById('inp-e2-monster')?.value || '',
                     potionSlots: potionSlots,
                     e2Attack: e2Attack
                 };
                 localStorage.setItem('MARGO_UI_STATE', JSON.stringify(state));
             };

             // Restore Active Tab Visuals & Visibility
             const updateTabs = () => {
                 tabs.forEach(t => t.classList.remove('active'));
                 const activeT = div.querySelector(`.mb-tab[data-tab="${currentTab}"]`);
                 if (activeT) activeT.classList.add('active');

                 panelExp.style.display = 'none';
                 panelTransport.style.display = 'none';
                 panelE2.style.display = 'none';

                 if (currentTab === 'exp') panelExp.style.display = 'block';
                 else if (currentTab === 'transport') panelTransport.style.display = 'block';
                 else if (currentTab === 'e2') panelE2.style.display = 'block';
             };
             updateTabs(); // Call initially to set state

             tabs.forEach(tab => {
                 tab.onclick = () => {
                     currentTab = tab.dataset.tab;
                     updateTabs();
                     saveUIState();
                 };
             });
             
             // Input Change Listeners for Autosave
             const tInp = document.getElementById('inp-transport-map');
             if (tInp) tInp.oninput = saveUIState;
             
             const e2Inp = document.getElementById('inp-e2-monster');
             if (e2Inp) e2Inp.oninput = saveUIState;
             
             const e2AttackInp = document.getElementById('inp-e2-attack');
             if (e2AttackInp) e2AttackInp.onchange = saveUIState;
             
             const potionSlotsInp = document.getElementById('inp-potion-slots');
             if (potionSlotsInp) potionSlotsInp.onchange = saveUIState;
             
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

        // Get e2Attack checkbox state
        const e2AttackCheckbox = document.getElementById('inp-e2-attack');
        const e2Attack = e2AttackCheckbox ? e2AttackCheckbox.checked : true;

        return { 
            active: window.BOT_ACTIVE, 
            config: window.BOT_CONFIG,
            securityAlert: window.BOT_SECURITY_FLAG,
            mode: mode,
            transportMap: transportMap,
            monsterTarget: monsterTarget,
            e2Attack: e2Attack,
            licenseValid: license && license.valid,
            pendingLicenseKey: window.PENDING_LICENSE_KEY || localStorage.getItem('MARGO_LICENSE_KEY') || null
        };
    }, { cfg: defaultConfig, spots: huntingSpots, allMaps: allMapNames, monsters: allMonsters, license: licenseInfo });
}

module.exports = { injectUI };
