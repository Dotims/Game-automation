const logger = require('../utils/logger');

async function injectUI(page, defaultConfig) {
    return await page.evaluate((cfg) => {
        if (!window.BOT_CONFIG) {
            // Load from localStorage or use default
            const saved = localStorage.getItem('MARGO_BOT_CFG');
            window.BOT_CONFIG = saved ? JSON.parse(saved) : cfg;
            window.BOT_ACTIVE = false;
        }

        // --- CSS ---
        if (!document.getElementById('margo-bot-css')) {
             const style = document.createElement('style');
             style.id = 'margo-bot-css';
             style.innerHTML = `
                #margo-bot-panel {
                    position: fixed; top: 10px; right: 10px; z-index: 9999;
                    background: rgba(0, 0, 0, 0.85); color: white;
                    padding: 15px; border-radius: 8px; font-family: 'Segoe UI', sans-serif;
                    width: 250px; border: 2px solid #f44336; transition: border-color 0.3s;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                }
                .mb-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
                .mb-btn { padding: 5px 15px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%; transition: 0.2s; }
                .mb-btn:hover { opacity: 0.9; }
                .mb-input { width: 60px; padding: 2px 5px; background: #333; border: 1px solid #555; color: white; border-radius: 3px; }
             `;
             if(document.head) document.head.appendChild(style);
        }

        // --- HTML ---
        if (document.body && !document.getElementById('margo-bot-panel')) {
             const div = document.createElement('div');
             div.id = 'margo-bot-panel';
             div.innerHTML = `
                <div style="text-align: center; margin-bottom: 10px; font-size: 16px; font-weight: bold;">
                    🤖 MargoBot v2.1 <span id="bot-status" style="color: #f44336">OFF</span>
                </div>
                
                <div class="mb-row">
                    <button id="btn-toggle" class="mb-btn" style="background-color: #4CAF50;">START</button>
                </div>

                <div style="font-size: 12px; color: #aaa; margin-bottom: 5px;">Konfiguracja Leveli</div>
                <div class="mb-row">
                    <label>Min Lvl:</label>
                    <input type="number" id="inp-min" class="mb-input" value="${window.BOT_CONFIG.minLvl}">
                </div>
                <div class="mb-row">
                    <label>Max Lvl:</label>
                    <input type="number" id="inp-max" class="mb-input" value="${window.BOT_CONFIG.maxLvl}">
                </div>

                <div class="mb-row">
                     <label style="cursor:pointer;">
                        <input type="checkbox" id="inp-heal" ${window.BOT_CONFIG.autoHeal ? 'checked' : ''}> Auto Heal
                     </label>
                </div>

                <div class="mb-row">
                    <button id="btn-save" class="mb-btn" style="background-color: #2196F3; font-size: 12px;">Zapisz Ustawienia</button>
                </div>
             `;
             document.body.appendChild(div);

             // Event Listeners
             const toggleBtn = document.getElementById('btn-toggle');
             if (toggleBtn) {
                  toggleBtn.onclick = () => {
                        window.BOT_ACTIVE = !window.BOT_ACTIVE;
                  };
             }

             const saveBtn = document.getElementById('btn-save');
             if (saveBtn) {
                  saveBtn.onclick = () => {
                        const min = parseInt(document.getElementById('inp-min').value);
                        const max = parseInt(document.getElementById('inp-max').value);
                        const heal = document.getElementById('inp-heal').checked;
                        
                        if (!isNaN(min) && !isNaN(max)) {
                            window.BOT_CONFIG.minLvl = min;
                            window.BOT_CONFIG.maxLvl = max;
                            window.BOT_CONFIG.autoHeal = heal;
                            localStorage.setItem('MARGO_BOT_CFG', JSON.stringify(window.BOT_CONFIG));
                            alert('Zapisano! Ustawienia aktywne.');
                        }
                  };
             }
        }

        // --- UPDATE UI ---
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
    }, defaultConfig);
}

module.exports = { injectUI };
