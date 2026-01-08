/**
 * Configuration Server - MargoBot
 * Local web server for user-friendly configuration
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

function openBrowser(url) {
    exec(`start "" "${url}"`, (err) => {
        if (err) console.log('Otwórz przeglądarkę:', url);
    });
}

const CONFIG_FILE = path.join(__dirname, '..', 'user-config.json');
const PORT = 34567;

const DEFAULT_CONFIG = {
    browserPath: '',
    profilePath: '',
    configured: false
};

function parseProfilePath(fullPath) {
    const normalized = fullPath.replace(/\//g, '\\').replace(/\\+$/, '');
    const parts = normalized.split('\\');
    const profileDir = parts.pop() || 'Default';
    const userDataDir = parts.join('\\');
    return { userDataDir, profileDir };
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
        }
    } catch (e) {
        console.error('Failed to load config:', e.message);
    }
    return DEFAULT_CONFIG;
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Failed to save config:', e.message);
        return false;
    }
}

function getConfigHTML(config) {
    return `<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MargoSzpont - Panel</title>
    <style>
        :root {
            --bg-dark: #0f0f1a;
            --bg-card: rgba(255,255,255,0.03);
            --accent: #fbbf24;
            --success: #22c55e;
            --danger: #ef4444;
            --text: #e5e5e5;
            --text-dim: rgba(255,255,255,0.5);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(145deg, #0f0f1a 0%, #1a1a2e 50%, #0f172a 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 16px;
        }
        .container {
            background: var(--bg-card);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 32px;
            max-width: 520px;
            width: 100%;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        }
        .header { text-align: center; margin-bottom: 28px; }
        .header h1 { color: var(--text); font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
        .header h1 span { background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .header p { color: var(--text-dim); font-size: 13px; margin-top: 4px; }
        
        .accordion {
            background: rgba(251,191,36,0.08);
            border: 1px solid rgba(251,191,36,0.2);
            border-radius: 14px;
            margin-bottom: 24px;
            overflow: hidden;
        }
        .accordion-header {
            padding: 14px 18px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--accent);
            font-weight: 600;
            font-size: 14px;
            transition: background 0.2s;
        }
        .accordion-header:hover { background: rgba(251,191,36,0.1); }
        .accordion-header .arrow { transition: transform 0.3s; font-size: 10px; }
        .accordion.open .accordion-header .arrow { transform: rotate(90deg); }
        .accordion-content { max-height: 0; overflow: hidden; transition: max-height 0.3s; }
        .accordion.open .accordion-content { max-height: 280px; }
        .accordion-content-inner { padding: 18px; color: var(--text); font-size: 13px; line-height: 1.8; background: rgba(0,0,0,0.2); }
        .step { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
        .step-num { background: var(--accent); color: #000; min-width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; }
        .step-text { flex: 1; }
        .step-text code { background: rgba(34,197,94,0.2); color: #4ade80; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-family: 'Consolas', monospace; }
        
        .form-group { margin-bottom: 18px; }
        .form-group label { display: block; color: var(--text); margin-bottom: 8px; font-size: 13px; font-weight: 500; }
        .form-group input {
            width: 100%;
            padding: 14px 16px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            color: var(--text);
            font-size: 13px;
            transition: all 0.2s;
        }
        .form-group input:focus { outline: none; border-color: var(--accent); background: rgba(255,255,255,0.08); }
        .form-group input::placeholder { color: var(--text-dim); }
        .form-group small { color: var(--text-dim); font-size: 11px; margin-top: 6px; display: block; }
        
        .status {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 16px;
            background: rgba(0,0,0,0.3);
            border-radius: 12px;
            margin-bottom: 20px;
        }
        .status-dot { width: 12px; height: 12px; border-radius: 50%; background: #6b7280; transition: all 0.3s; }
        .status-dot.connected { background: var(--success); box-shadow: 0 0 12px var(--success); }
        .status-dot.error { background: var(--danger); box-shadow: 0 0 12px var(--danger); }
        .status-text { color: var(--text); font-size: 13px; font-weight: 500; }
        
        .btn-group { display: flex; gap: 10px; flex-direction: column; }
        .btn {
            padding: 16px 24px;
            border: none;
            border-radius: 14px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .btn-start {
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            color: #fff;
            box-shadow: 0 4px 14px rgba(34,197,94,0.4);
        }
        .btn-start:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(34,197,94,0.5); }
        .btn-start:disabled { background: #374151; color: #9ca3af; cursor: not-allowed; box-shadow: none; transform: none; }
        
        .btn-stop {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: #fff;
            box-shadow: 0 4px 14px rgba(239,68,68,0.4);
            display: none;
        }
        .btn-stop:hover { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(239,68,68,0.5); }
        .btn-stop.visible { display: flex; }
        
        .btn-save {
            background: rgba(255,255,255,0.08);
            color: var(--text);
            border: 1px solid rgba(255,255,255,0.15);
        }
        .btn-save:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.25); }
        
        .message { padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; display: none; font-weight: 500; }
        .message.error { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171; display: block; }
        .message.success { background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #4ade80; display: block; }
        
        .footer { text-align: center; margin-top: 20px; color: var(--text-dim); font-size: 11px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>😼 <span>MargoSzpont</span></h1>
            <p>Panel sterowania botem</p>
        </div>
        
        <div class="accordion" id="helpAccordion">
            <div class="accordion-header" onclick="toggleAccordion()">
                <span class="arrow">▶</span>
                <span>📖 Instrukcja konfiguracji</span>
            </div>
            <div class="accordion-content">
                <div class="accordion-content-inner">
                    <div class="step">
                        <div class="step-num">1</div>
                        <div class="step-text">Otwórz przeglądarkę <strong>Brave</strong> lub <strong>Chrome</strong></div>
                    </div>
                    <div class="step">
                        <div class="step-num">2</div>
                        <div class="step-text">Wpisz w pasek adresu:<br><code>brave://version</code> lub <code>chrome://version</code></div>
                    </div>
                    <div class="step">
                        <div class="step-num">3</div>
                        <div class="step-text"><strong>"Ścieżka pliku wykonywalnego"</strong> → skopiuj do pierwszego pola</div>
                    </div>
                    <div class="step">
                        <div class="step-num">4</div>
                        <div class="step-text"><strong>"Ścieżka profilu"</strong> → skopiuj CAŁĄ ścieżkę do drugiego pola</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="message" class="message"></div>
        
        <form id="configForm">
            <div class="form-group">
                <label>📁 Ścieżka przeglądarki</label>
                <input type="text" id="browserPath" placeholder="C:\\Program Files\\BraveSoftware\\...\\brave.exe" value="${config.browserPath || ''}">
            </div>
            
            <div class="form-group">
                <label>📂 Ścieżka profilu</label>
                <input type="text" id="profilePath" placeholder="C:\\Users\\...\\User Data\\Default" value="${config.profilePath || ''}">
                <small>Skopiuj całą ścieżkę z brave://version (z Default/Profile X)</small>
            </div>
            
            <div class="status">
                <div class="status-dot" id="statusDot"></div>
                <div class="status-text" id="statusText">Oczekiwanie na uruchomienie...</div>
            </div>
            
            <div class="btn-group">
                <button type="submit" class="btn btn-start" id="startBtn">🚀 Uruchom Bota</button>
                <button type="button" class="btn btn-stop" id="stopBtn" onclick="stopBot()">⏹️ Zatrzymaj Bota</button>
                <button type="button" class="btn btn-save" onclick="saveOnly()">💾 Zapisz konfigurację</button>
            </div>
        </form>
        
        <div class="footer">MargoSzpont v2.1 • Zamknij przeglądarkę przed pierwszym uruchomieniem</div>
    </div>
    
    <script>
        let botRunning = false;
        
        function toggleAccordion() { document.getElementById('helpAccordion').classList.toggle('open'); }
        function showMessage(t, type) { const m = document.getElementById('message'); m.textContent = t; m.className = 'message ' + type; }
        function updateStatus(t, s) { 
            document.getElementById('statusText').textContent = t; 
            const d = document.getElementById('statusDot'); 
            d.className = 'status-dot'; 
            if(s==='connected') d.classList.add('connected'); 
            if(s==='error') d.classList.add('error'); 
        }
        
        function updateButtons(running) {
            botRunning = running;
            const startBtn = document.getElementById('startBtn');
            const stopBtn = document.getElementById('stopBtn');
            if (running) {
                startBtn.style.display = 'none';
                stopBtn.classList.add('visible');
            } else {
                startBtn.style.display = 'flex';
                startBtn.disabled = false;
                startBtn.textContent = '🚀 Uruchom Bota';
                stopBtn.classList.remove('visible');
            }
        }
        
        function saveOnly() {
            const data = { browserPath: document.getElementById('browserPath').value.trim(), profilePath: document.getElementById('profilePath').value.trim() };
            if (!data.browserPath || !data.profilePath) { showMessage('Wypełnij obie ścieżki!', 'error'); return; }
            fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
            .then(r => r.json()).then(d => { showMessage(d.success ? '✅ Konfiguracja zapisana!' : '❌ ' + d.error, d.success ? 'success' : 'error'); });
        }
        
        function stopBot() {
            fetch('/api/stop', { method: 'POST' })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    showMessage('⏹️ Bot zatrzymany', 'success');
                    updateStatus('Bot zatrzymany', 'error');
                    updateButtons(false);
                }
            });
        }
        
        document.getElementById('configForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const data = { browserPath: document.getElementById('browserPath').value.trim(), profilePath: document.getElementById('profilePath').value.trim() };
            if (!data.browserPath || !data.profilePath) { showMessage('Wypełnij obie ścieżki!', 'error'); return; }
            
            const btn = document.getElementById('startBtn');
            btn.disabled = true; 
            btn.textContent = '⏳ Uruchamianie...';
            updateStatus('Uruchamianie przeglądarki...', 'default');
            
            fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
            .then(r => r.json())
            .then(d => {
                if (d.success) { 
                    showMessage('✅ Bot uruchomiony!', 'success'); 
                    updateStatus('Bot aktywny', 'connected'); 
                    updateButtons(true);
                } else { 
                    showMessage('❌ ' + d.error, 'error'); 
                    updateStatus('Błąd uruchamiania', 'error'); 
                    btn.disabled = false; 
                    btn.textContent = '🚀 Uruchom Bota'; 
                }
            });
        });
    </script>
</body>
</html>`;
}

let shouldStop = false;
let botRunning = false;

function startConfigServer(onAction) {
    shouldStop = false;
    
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        
        if (url.pathname === '/' || url.pathname === '/config') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(getConfigHTML(loadConfig()));
            return;
        }
        
        if (url.pathname === '/api/save' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    saveConfig({ browserPath: data.browserPath, profilePath: data.profilePath, configured: true });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }
        
        if (url.pathname === '/api/stop' && req.method === 'POST') {
            shouldStop = true;
            botRunning = false;
            
            if (onAction) {
                onAction('stop', null);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        if (url.pathname === '/api/start' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const config = { browserPath: data.browserPath, profilePath: data.profilePath, configured: true };
                    saveConfig(config);
                    
                    shouldStop = false;
                    botRunning = true;
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                    
                    // Call the action handler
                    if (onAction) {
                        onAction('start', config);
                    }
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }
        
        res.writeHead(404); res.end('Not found');
    });
    
    server.listen(PORT, () => {
        console.log(`\n🌐 Panel konfiguracji: http://localhost:${PORT}\n`);
        openBrowser(`http://localhost:${PORT}`);
    });
    
    server.on('error', e => { 
        if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} zajęty.`); 
    });
    
    return server;
}

function isConfigured() { const c = loadConfig(); return c.configured && c.browserPath && c.profilePath; }
function getConfig() { return loadConfig(); }
function getShouldStop() { return shouldStop; }
function isBotRunning() { return botRunning; }
function setBotRunning(val) { botRunning = val; }

module.exports = { startConfigServer, loadConfig, saveConfig, isConfigured, getConfig, parseProfilePath, getShouldStop, isBotRunning, setBotRunning, CONFIG_FILE };
