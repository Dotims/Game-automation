/**
 * Bot Configuration
 * Zawiera konfigurację blokowania map, limity i inne ustawienia.
 */

// === BLOCKED MAPS ===
// Mapy, które powinny być omijane podczas pathfindingu w zależności od poziomu postaci.
// Format: { "Nazwa Mapy": { minLevel: X } } - mapa jest zablokowana jeśli hero.lvl < minLevel

window.BotConfig = window.BotConfig || {};

window.BotConfig.BLOCKED_MAPS = {
    "Zawodzące Kaskady": { minLevel: 200 },
    "Złudny Trakt": { minLevel: 170 },
    "Ukwiecona Skarpa": { minLevel: 170 },
    "Urwisko Zdrewniałych": { minLevel: 218 },
    "Mglisty Las": { minLevel: 200 },
    "Niecka Xiuh Atl": { minLevel: 200 }
};

/**
 * Sprawdza czy mapa powinna być zablokowana dla obecnego poziomu gracza
 * @param {string} mapName - Nazwa mapy do sprawdzenia
 * @returns {boolean} - true jeśli mapa jest zablokowana
 */
window.BotConfig.isMapBlocked = function(mapName) {
    if (!mapName) return false;
    const config = window.BotConfig.BLOCKED_MAPS[mapName];
    if (!config) return false;
    
    const heroLevel = window.Engine?.hero?.d?.lvl || 0;
    if (heroLevel < config.minLevel) {
        // Throttle logs to avoid spamming console during pathfinding.
        window.BotConfig._blockedLogLastAt = window.BotConfig._blockedLogLastAt || Object.create(null);
        const now = Date.now();
        const last = window.BotConfig._blockedLogLastAt[mapName] || 0;
        if (now - last > 10000) {
            window.BotConfig._blockedLogLastAt[mapName] = now;
            console.log(`[Config] Mapa zablokowana: ${mapName} (Wymagany lvl: ${config.minLevel}, Twój lvl: ${heroLevel})`);
        }
        return true;
    }
    return false;
};

console.log('[Config] Bot configuration loaded');
