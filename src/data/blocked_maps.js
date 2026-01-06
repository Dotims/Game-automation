// src/data/blocked_maps.js
// Maps that should be avoided during pathfinding based on character level.
// Format: { mapName: { minLevel: X } } - map is blocked if hero.lvl < minLevel

const BLOCKED_MAPS = {
    "Zawodzące Kaskady": { minLevel: 200 },
    "Złudny Trakt": { minLevel: 170 },
    "Ukwiecona Skarpa": { minLevel: 170 },
    "Urwisko Zdrewniałych": { minLevel: 218 },
    "Mglisty Las": { minLevel: 200 }
};

/**
 * Returns a Set of map names that should be blocked for the given level
 * @param {number} heroLevel - Current character level
 * @returns {Set<string>} - Set of blocked map names
 */
function getBlockedMapsForLevel(heroLevel) {
    const blocked = new Set();
    
    for (const [mapName, restriction] of Object.entries(BLOCKED_MAPS)) {
        if (heroLevel < restriction.minLevel) {
            blocked.add(mapName);
        }
    }
    
    return blocked;
}

module.exports = { BLOCKED_MAPS, getBlockedMapsForLevel };
