const fs = require('fs');
const logger = require('../utils/logger');

let graph = {}; // Structure: { "Ithan": ["Torneg", "Werbin"], ... }

/**
 * Helper function to clean map names
 * Removes HTML tags, square brackets, and extra spaces.
 */
function normalizeName(name) {
    if (!name) return '';
    return name
        .replace(/<[^>]*>/g, '') // Remove anything in <...>
        .replace(/\[|\]/g, '') // Remove [ and ]
        .trim();
}

/**
 * Loads map connections from a txt file into memory
 */
function loadMapConnections(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            logger.error(`Map file not found: ${filePath}`);
            return;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        graph = {}; // Reset graph
        let count = 0;

        for (const line of lines) {
            // Format: [Map Name] -> Target1, Target2, Target3
            if (!line.includes('->')) continue;

            const parts = line.split('->');
            // Extract source and clean garbage
            const sourceMap = normalizeName(parts[0]);

            if (!sourceMap) continue;

            const targetsRaw = parts[1].trim();

            // If no transitions, skip adding edges but init map
            if (targetsRaw === 'BRAK' || targetsRaw === '') {
                if (!graph[sourceMap]) graph[sourceMap] = [];
                continue;
            }

            // Split targets by comma
            const targetsList = targetsRaw.split(',').map(t => normalizeName(t));

            // Add to graph (avoiding duplicates)
            if (!graph[sourceMap]) graph[sourceMap] = [];

            targetsList.forEach(target => {
                if (target && target !== sourceMap && !graph[sourceMap].includes(target)) {
                    graph[sourceMap].push(target);
                }
            });

            count++;
        }

        logger.success(`🗺️ Map Graph loaded! (${Object.keys(graph).length} nodes, ${count} lines)`);
        
        // Debug
        // if (graph['Torneg']) logger.log('Test Torneg ->', graph['Torneg']);

    } catch (err) {
        logger.error('Error loading maps:', err.message);
    }
}

/**
 * BFS algorithm finding the shortest path
 * @param {string} startMap - Map name where the character is standing
 * @param {string[]} targetMaps - Array of target map names (e.g. entire hunting spot)
 * @returns {object|null} - { nextMap, fullPath, distance } or null
 */
function findPath(startMap, targetMaps) {
    // 1. Validate data
    if (!graph || Object.keys(graph).length === 0) {
        logger.error("Graph is empty! Run loadMapConnections first.");
        return null;
    }

    if (!startMap) return null;

    const start = normalizeName(startMap);

    // Create a set of targets for quick O(1) lookup
    // Normalize target names too
    const targetsSet = new Set(targetMaps.map(t => normalizeName(t)));

    // 2. Quick check: are we already there?
    if (targetsSet.has(start)) {
        return { nextMap: null, fullPath: [start], distance: 0 };
    }

    // 3. Initialize BFS
    // Queue stores entire paths: [ [Start], [Start, A], [Start, B] ... ]
    const queue = [ [start] ];
    const visited = new Set();
    visited.add(start);

    // Safety constraint
    const MAX_DEPTH = 10000;
    let iterations = 0;

    while (queue.length > 0) {
        iterations++;
        if (iterations > MAX_DEPTH) break; // Safety break

        // Get first path (Shift is slow for huge arrays, but okay here)
        const path = queue.shift();
        const currentMap = path[path.length - 1];

        // Check if we reached target
        if (targetsSet.has(currentMap)) {
            return {
                nextMap: path[1], // Map we must enter NOW (index 1, as 0 is start)
                fullPath: path, // Full path for preview
                distance: path.length - 1
            };
        }

        // Get neighbors
        const neighbors = graph[currentMap] || [];

        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                // Create new path and add to queue
                const newPath = [...path, neighbor];
                queue.push(newPath);
            }
        }
    }

    return null; // Path not found
}

module.exports = { loadMapConnections, findPath };
