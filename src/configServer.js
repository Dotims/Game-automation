/**
 * Configuration Server - MargoBot
 * Multi-Bot Support with Separate User Data Directories
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
const BASE_CDP_PORT = 9222;

const DEFAULT_CONFIG = {
    browserPath: '',
    profiles: [],
    configured: false
};

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(data);
            
            // Migration from old format
            if (!parsed.profiles && parsed.profilePath) {
                console.log('📦 Migrating old config to multi-profile format...');
                return {
                    browserPath: parsed.browserPath || '',
                    profiles: [{
                        id: generateId(),
                        name: 'Bot #1',
                        userDataPath: parsed.profilePath.replace(/\\[^\\]+$/, ''), // Extract User Data path
                        profileDir: parsed.profilePath.split('\\').pop() || 'Default',
                        enabled: true
                    }],
                    configured: true
                };
            }
            
            return { ...DEFAULT_CONFIG, ...parsed };
        }
    } catch (e) {
        console.error('Config load error:', e.message);
    }
    return DEFAULT_CONFIG;
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Config save error:', e.message);
        return false;
    }
}

// Bot instance tracking
const botInstances = new Map();

function getConfigHTML(config) {
    const profilesHTML = config.profiles.map((profile, index) => {
        const instance = botInstances.get(profile.id) || { running: false, status: 'Zatrzymany' };
        const statusClass = instance.running ? 'connected' : '';
        const statusText = instance.status || 'Zatrzymany';
        const cdpPort = BASE_CDP_PORT + index;
        
        return `
        <div class="profile-card" data-id="${profile.id}">
            <div class="profile-header">
                <div class="profile-left">
                    <div class="status-dot ${statusClass}"></div>
                    <input type="text" class="profile-name" value="${profile.name || `Bot #${index + 1}`}" 
                           onchange="updateProfile('${profile.id}', 'name', this.value)" placeholder="Nazwa bota">
                </div>
                <div class="profile-actions">
                    <button class="btn btn-sm ${instance.running ? 'btn-stop-sm' : 'btn-start-sm'}" 
                            onclick="${instance.running ? `stopBot('${profile.id}')` : `startBot('${profile.id}')`}">
                        ${instance.running ? '⏹️' : '▶️'}
                    </button>
                    <button class="btn btn-sm btn-delete" onclick="deleteProfile('${profile.id}')" ${config.profiles.length <= 1 ? 'disabled' : ''}>×</button>
                </div>
            </div>
            <div class="profile-body">
                <div class="form-row">
                    <label>📂 User Data:</label>
                    <input type="text" class="profile-input" value="${profile.userDataPath || ''}" 
                           onchange="updateProfile('${profile.id}', 'userDataPath', this.value)"
                           placeholder="C:\\Users\\...\\Brave-Browser\\User Data">
                </div>
                <div class="form-row">
                    <label>👤 Profil:</label>
                    <input type="text" class="profile-input small" value="${profile.profileDir || 'Default'}" 
                           onchange="updateProfile('${profile.id}', 'profileDir', this.value)"
                           placeholder="Default lub Profile 1">
                    <span class="port-badge">Port: ${cdpPort}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MargoSzpont - Multi-Bot</title>
    <style>
        :root {
            --bg: #0f0f1a;
            --card: rgba(255,255,255,0.04);
            --accent: #fbbf24;
            --success: #22c55e;
            --danger: #ef4444;
            --text: #e5e5e5;
            --dim: rgba(255,255,255,0.5);
            --border: rgba(255,255,255,0.1);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: linear-gradient(145deg, #0f0f1a, #1a1a2e); min-height: 100vh; padding: 20px; }
        .container { max-width: 650px; margin: 0 auto; }
        
        .header { text-align: center; margin-bottom: 20px; padding: 20px; background: var(--card); border-radius: 16px; border: 1px solid var(--border); }
        .header h1 { color: var(--text); font-size: 26px; }
        .header h1 span { background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .header p { color: var(--dim); font-size: 13px; margin-top: 4px; }
        
        .accordion { background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 14px; margin-bottom: 16px; overflow: hidden; }
        .accordion-header { padding: 14px 18px; cursor: pointer; display: flex; align-items: center; gap: 10px; color: var(--accent); font-weight: 600; font-size: 14px; }
        .accordion-header:hover { background: rgba(251,191,36,0.1); }
        .accordion-header .arrow { transition: transform 0.3s; }
        .accordion.open .arrow { transform: rotate(90deg); }
        .accordion-content { max-height: 0; overflow: hidden; transition: max-height 0.3s; }
        .accordion.open .accordion-content { max-height: 700px; }
        .accordion-inner { padding: 16px; color: var(--text); font-size: 13px; line-height: 1.8; background: rgba(0,0,0,0.2); }
        .step { display: flex; gap: 12px; margin-bottom: 8px; }
        .step-num { background: var(--accent); color: #000; min-width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; }
        .step code { background: rgba(34,197,94,0.2); color: #4ade80; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
        .section-title { font-weight: 700; color: var(--accent); margin-bottom: 10px; font-size: 13px; }
        .example-box { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; font-size: 12px; }
        .example-box code { background: rgba(34,197,94,0.2); color: #4ade80; padding: 2px 6px; border-radius: 4px; }
        .warning-box { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 10px 12px; margin-top: 12px; font-size: 12px; color: #f87171; }
        .note-box { background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); border-radius: 8px; padding: 10px 12px; margin-top: 8px; font-size: 12px; color: #60a5fa; }
        .note-box code { background: rgba(34,197,94,0.2); color: #4ade80; padding: 2px 6px; border-radius: 4px; }
        
        
        .browser-section { background: var(--card); border-radius: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid var(--border); display: flex; gap: 10px; align-items: center; }
        .browser-section label { color: var(--dim); font-size: 12px; white-space: nowrap; }
        .browser-section input { flex: 1; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 12px; }
        .browser-section input:focus { outline: none; border-color: var(--accent); }
        
        .profiles-container { display: flex; flex-direction: column; gap: 10px; }
        
        .profile-card { background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
        .profile-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: rgba(0,0,0,0.2); }
        .profile-left { display: flex; align-items: center; gap: 10px; }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #6b7280; }
        .status-dot.connected { background: var(--success); box-shadow: 0 0 8px var(--success); }
        .profile-name { background: transparent; border: none; color: var(--text); font-size: 15px; font-weight: 600; width: 200px; }
        .profile-name:focus { outline: none; border-bottom: 1px solid var(--accent); }
        .profile-actions { display: flex; gap: 6px; }
        
        .profile-body { padding: 12px 14px; }
        .form-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .form-row:last-child { margin-bottom: 0; }
        .form-row label { color: var(--dim); font-size: 11px; min-width: 70px; }
        .profile-input { flex: 1; padding: 8px 10px; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 11px; }
        .profile-input:focus { outline: none; border-color: var(--accent); }
        .profile-input.small { max-width: 120px; }
        .port-badge { background: rgba(251,191,36,0.2); color: var(--accent); padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
        
        .btn { padding: 10px 16px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-sm { padding: 6px 10px; font-size: 14px; }
        .btn-start-sm { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; }
        .btn-stop-sm { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }
        .btn-delete { background: rgba(239,68,68,0.2); color: #f87171; }
        .btn-delete:disabled { opacity: 0.3; cursor: not-allowed; }
        
        .btn-add { width: 100%; padding: 14px; background: rgba(251,191,36,0.1); border: 2px dashed rgba(251,191,36,0.3); border-radius: 12px; color: var(--accent); font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 12px; }
        .btn-add:hover { background: rgba(251,191,36,0.2); }
        
        .btn-group { display: flex; gap: 10px; margin-top: 14px; }
        .btn-start-all { flex: 1; background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; }
        .btn-stop-all { flex: 1; background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }
        
        .message { padding: 12px; border-radius: 8px; margin-bottom: 14px; font-size: 12px; display: none; }
        .message.error { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171; display: block; }
        
        .warning { background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 11px; color: var(--accent); }
        
        .footer { text-align: center; margin-top: 20px; color: var(--dim); font-size: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>😼 <span>MargoSzpont</span></h1>
            <p>Panel sterowania wieloma botami</p>
        </div>
        
        <div class="accordion" id="helpAccordion">
            <div class="accordion-header" onclick="document.getElementById('helpAccordion').classList.toggle('open')">
                <span class="arrow">▶</span>
                <span>📖 Instrukcja konfiguracji</span>
            </div>
            <div class="accordion-content">
                <div class="accordion-inner">
                    <div class="section-title">🔧 Konfiguracja pierwszego bota:</div>
                    <div class="step"><div class="step-num">1</div><div>Wejdź w <code>brave://version</code> lub <code>chrome://version</code></div></div>
                    <div class="step"><div class="step-num">2</div><div><strong>Ścieżka pliku wykonywalnego</strong> → pole "Przeglądarka"</div></div>
                    <div class="step"><div class="step-num">3</div><div><strong>Ścieżka profilu</strong> → pole "User Data" (usuń końcówkę np. \\Default)</div></div>
                    <div class="step"><div class="step-num">4</div><div>Wpisz nazwę profilu np. <code>Default</code> lub <code>Profile 1</code></div></div>
                    
                    <div class="section-title" style="margin-top: 16px;">📂 Tworzenie osobnego User Data dla drugiego bota:</div>
                    <div class="step"><div class="step-num">1</div><div>Otwórz Eksplorator plików (Win + E)</div></div>
                    <div class="step"><div class="step-num">2</div><div>Wklej w pasek adresu: <code>%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser</code></div></div>
                    <div class="step"><div class="step-num">3</div><div>Prawy klik na <strong>User Data</strong> → Kopiuj → Wklej obok</div></div>
                    <div class="step"><div class="step-num">4</div><div>Zmień nazwę kopii na <code>User Data Bot2</code></div></div>
                    
                    <div class="section-title" style="margin-top: 16px;">⚙️ Konfiguracja w panelu:</div>
                    <div class="example-box">
                        <div><strong>Bot #1:</strong></div>
                        <div>User Data: <code>...\\User Data</code></div>
                        <div>Profil: <code>Default</code></div>
                    </div>
                    <div class="example-box">
                        <div><strong>Bot #2:</strong></div>
                        <div>User Data: <code>...\\User Data Bot2</code></div>
                        <div>Profil: <code>Profile 1</code></div>
                    </div>
                    <div class="note-box">
                        💡 Nazwę profilu odczytasz z końcówki ścieżki w <code>brave://version</code> (np. Default, Profile 1, Profile 2)
                    </div>
                    
                    <div class="warning-box">
                        ⚠️ <strong>Ważne:</strong> Zamknij przeglądarkę przed kopiowaniem! Folder może mieć kilka GB.
                    </div>
                </div>
            </div>
        </div>
        
        
        <div id="message" class="message"></div>
        
        <div class="browser-section">
            <label>📁 Przeglądarka:</label>
            <input type="text" id="browserPath" value="${config.browserPath || ''}" 
                   placeholder="C:\\Program Files\\BraveSoftware\\...\\brave.exe"
                   onchange="saveBrowserPath(this.value)">
        </div>
        
        <div class="profiles-container">
            ${profilesHTML}
        </div>
        
        <button class="btn-add" onclick="addProfile()">➕ Dodaj bota</button>
        
        <div class="btn-group">
            <button class="btn btn-start-all" onclick="startAllBots()">🚀 Start wszystkich</button>
            <button class="btn btn-stop-all" onclick="stopAllBots()">⏹️ Stop wszystkich</button>
        </div>
        
        <div class="footer">MargoSzpont v2.2 Multi-Bot • Każdy bot = osobny User Data folder</div>
    </div>
    
    <script>
        function showMessage(text, type) { 
            const m = document.getElementById('message'); 
            m.textContent = text; 
            m.className = 'message ' + type;
            if (type !== 'error') setTimeout(() => m.className = 'message', 3000);
        }
        
        function saveBrowserPath(path) {
            fetch('/api/browser-path', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({browserPath: path}) });
        }
        
        function updateProfile(id, field, value) {
            fetch('/api/profile/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, field, value}) });
        }
        
        function addProfile() {
            fetch('/api/profile/add', { method: 'POST' }).then(r => r.json()).then(d => { if(d.success) location.reload(); });
        }
        
        function deleteProfile(id) {
            if (!confirm('Usunąć tego bota?')) return;
            fetch('/api/profile/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) })
            .then(r => r.json()).then(d => { if(d.success) location.reload(); });
        }
        
        function startBot(id) {
            const browserPath = document.getElementById('browserPath').value.trim();
            if (!browserPath) { showMessage('❌ Podaj ścieżkę przeglądarki!', 'error'); return; }
            fetch('/api/bot/start', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, browserPath}) })
            .then(r => r.json()).then(d => { if(!d.success) showMessage('❌ ' + d.error, 'error'); else setTimeout(() => location.reload(), 500); });
        }
        
        function stopBot(id) {
            fetch('/api/bot/stop', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) })
            .then(() => setTimeout(() => location.reload(), 300));
        }
        
        function startAllBots() {
            fetch('/api/bot/start-all', { method: 'POST' }).then(r => r.json())
            .then(d => { if(!d.success) showMessage('❌ ' + d.error, 'error'); else setTimeout(() => location.reload(), 1000); });
        }
        
        function stopAllBots() {
            fetch('/api/bot/stop-all', { method: 'POST' }).then(() => setTimeout(() => location.reload(), 300));
        }
        
        // Auto-refresh
        setInterval(() => {
            fetch('/api/status').then(r => r.json()).then(data => {
                document.querySelectorAll('.profile-card').forEach(card => {
                    const id = card.dataset.id;
                    const inst = data.instances[id];
                    const dot = card.querySelector('.status-dot');
                    const btn = card.querySelector('.profile-actions .btn-sm:first-child');
                    if (inst && inst.running) {
                        dot.classList.add('connected');
                        btn.className = 'btn btn-sm btn-stop-sm';
                        btn.innerHTML = '⏹️';
                        btn.onclick = () => stopBot(id);
                    } else {
                        dot.classList.remove('connected');
                        btn.className = 'btn btn-sm btn-start-sm';
                        btn.innerHTML = '▶️';
                        btn.onclick = () => startBot(id);
                    }
                });
            }).catch(() => {});
        }, 2000);
    </script>
</body>
</html>`;
}

let onActionCallback = null;

function startConfigServer(onAction) {
    onActionCallback = onAction;
    
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        
        if (url.pathname === '/' || url.pathname === '/config') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(getConfigHTML(loadConfig()));
            return;
        }
        
        if (url.pathname === '/api/status' && req.method === 'GET') {
            const instances = {};
            for (const [id, inst] of botInstances.entries()) {
                instances[id] = { running: inst.running, status: inst.status };
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ instances }));
            return;
        }
        
        if (url.pathname === '/api/browser-path' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                const data = JSON.parse(body);
                const config = loadConfig();
                config.browserPath = data.browserPath;
                config.configured = true;
                saveConfig(config);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
            return;
        }
        
        if (url.pathname === '/api/profile/add' && req.method === 'POST') {
            const config = loadConfig();
            config.profiles.push({
                id: generateId(),
                name: `Bot #${config.profiles.length + 1}`,
                userDataPath: '',
                profileDir: 'Default',
                enabled: true
            });
            saveConfig(config);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        if (url.pathname === '/api/profile/delete' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                const data = JSON.parse(body);
                const config = loadConfig();
                if (config.profiles.length <= 1) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Min 1 bot' }));
                    return;
                }
                // Stop if running
                const inst = botInstances.get(data.id);
                if (inst && inst.running && inst.process) inst.process.kill();
                botInstances.delete(data.id);
                
                config.profiles = config.profiles.filter(p => p.id !== data.id);
                saveConfig(config);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
            return;
        }
        
        if (url.pathname === '/api/profile/update' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                const data = JSON.parse(body);
                const config = loadConfig();
                const profile = config.profiles.find(p => p.id === data.id);
                if (profile) profile[data.field] = data.value;
                saveConfig(config);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
            return;
        }
        
        if (url.pathname === '/api/bot/start' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                const data = JSON.parse(body);
                const config = loadConfig();
                const profileIndex = config.profiles.findIndex(p => p.id === data.id);
                const profile = config.profiles[profileIndex];
                
                if (!profile) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Profil nie znaleziony' }));
                    return;
                }
                if (!profile.userDataPath) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Brak ścieżki User Data' }));
                    return;
                }
                if (botInstances.get(profile.id)?.running) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Bot już działa' }));
                    return;
                }
                
                if (data.browserPath) {
                    config.browserPath = data.browserPath;
                    saveConfig(config);
                }
                
                const cdpPort = BASE_CDP_PORT + profileIndex;
                botInstances.set(profile.id, { running: true, status: 'Uruchamianie...', cdpPort });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                
                if (onActionCallback) {
                    onActionCallback('start', {
                        profileId: profile.id,
                        profileIndex,
                        browserPath: config.browserPath,
                        userDataPath: profile.userDataPath,
                        profileDir: profile.profileDir || 'Default',
                        cdpPort
                    });
                }
            });
            return;
        }
        
        if (url.pathname === '/api/bot/stop' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                const data = JSON.parse(body);
                const inst = botInstances.get(data.id);
                if (inst) {
                    inst.running = false;
                    inst.status = 'Zatrzymany';
                    if (inst.process) inst.process.kill();
                }
                if (onActionCallback) onActionCallback('stop', { profileId: data.id });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
            return;
        }
        
        if (url.pathname === '/api/bot/start-all' && req.method === 'POST') {
            const config = loadConfig();
            if (!config.browserPath) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Brak ścieżki przeglądarki' }));
                return;
            }
            
            config.profiles.forEach((profile, index) => {
                if (profile.userDataPath && !botInstances.get(profile.id)?.running) {
                    const cdpPort = BASE_CDP_PORT + index;
                    botInstances.set(profile.id, { running: true, status: 'Uruchamianie...', cdpPort });
                    setTimeout(() => {
                        if (onActionCallback) {
                            onActionCallback('start', {
                                profileId: profile.id,
                                profileIndex: index,
                                browserPath: config.browserPath,
                                userDataPath: profile.userDataPath,
                                profileDir: profile.profileDir || 'Default',
                                cdpPort
                            });
                        }
                    }, index * 5000); // 5 sec stagger
                }
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        if (url.pathname === '/api/bot/stop-all' && req.method === 'POST') {
            for (const [id, inst] of botInstances.entries()) {
                inst.running = false;
                inst.status = 'Zatrzymany';
                if (inst.process) inst.process.kill();
                if (onActionCallback) onActionCallback('stop', { profileId: id });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        res.writeHead(404);
        res.end('Not found');
    });
    
    server.listen(PORT, () => {
        console.log(`\n🌐 Panel konfiguracji: http://localhost:${PORT}\n`);
        openBrowser(`http://localhost:${PORT}`);
    });
    
    return server;
}

function setBotStatus(profileId, status) {
    const inst = botInstances.get(profileId);
    if (inst) inst.status = status;
}

function setBotRunning(profileId, running) {
    const inst = botInstances.get(profileId);
    if (inst) inst.running = running;
    else if (running) botInstances.set(profileId, { running: true, status: 'Aktywny' });
}

function setBotProcess(profileId, process) {
    const inst = botInstances.get(profileId);
    if (inst) inst.process = process;
}

module.exports = { startConfigServer, loadConfig, saveConfig, setBotStatus, setBotRunning, setBotProcess, BASE_CDP_PORT };
