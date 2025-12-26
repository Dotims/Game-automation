const logger = require('../utils/logger');

async function injectUI(page, defaultConfig, huntingSpots) {
    return await page.evaluate(({ cfg, spots }) => {
        if (!window.BOT_CONFIG) {
            const saved = localStorage.getItem('MARGO_BOT_CFG');
            window.BOT_CONFIG = saved ? JSON.parse(saved) : cfg;
            window.BOT_ACTIVE = false;
        }
        
        // Cache spots for easy access
        window.HUNTING_SPOTS = spots || [];

        // --- CSS ---
        if (!document.getElementById('margo-bot-css')) {
             const style = document.createElement('style');
             style.id = 'margo-bot-css';
             style.innerHTML = `
                #margo-bot-panel {
                    position: fixed; top: 20px; right: 20px; z-index: 99999;
                    background: rgba(28, 28, 33, 0.95); 
                    color: #ececec;
                    padding: 0; 
                    border-radius: 12px; 
                    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    width: 300px; 
                    border: 1px solid #444;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                    backdrop-filter: blur(10px);
                    transition: all 0.3s ease;
                    overflow: hidden;
                    font-size: 13px;
                }
                .mb-header {
                    padding: 12px 15px;
                    background: rgba(255, 255, 255, 0.05);
                    border-bottom: 1px solid #444;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .mb-title { font-weight: 700; font-size: 14px; letter-spacing: 0.5px; }
                .mb-status { font-weight: 800; font-size: 12px; padding: 2px 6px; border-radius: 4px; background: #333; }
                
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

             div.innerHTML = `
                <div class="mb-header">
                    <div class="mb-title">🤖 MargoBot v2.2</div>
                    <div id="bot-status" class="mb-status" style="color: #f44336">OFF</div>
                </div>
                
                <div class="mb-content">
                    <div class="mb-row">
                        <button id="btn-toggle" class="mb-btn" style="background: linear-gradient(135deg, #4CAF50, #45a049); color: white; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);">START BOT</button>
                    </div>

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

                    <div class="mb-row" style="margin-bottom: 0;">
                        <button id="btn-save" class="mb-btn" style="background: linear-gradient(135deg, #2196F3, #1976D2); color: white; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);">Zapisz Konfigurację</button>
                    </div>
                </div>
             `;
             document.body.appendChild(div);

             // --- Logic ---
             
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

             // 2. Toggle Bot
             const toggleBtn = document.getElementById('btn-toggle');
             toggleBtn.onclick = () => {
                 window.BOT_ACTIVE = !window.BOT_ACTIVE;
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
        }

        // --- UPDATE UI STATE ---
        const st = document.getElementById('bot-status');
        const btn = document.getElementById('btn-toggle');
        const panel = document.getElementById('margo-bot-panel');
        
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

        return { active: window.BOT_ACTIVE, config: window.BOT_CONFIG };
    }, { cfg: defaultConfig, spots: huntingSpots });
}

module.exports = { injectUI };
