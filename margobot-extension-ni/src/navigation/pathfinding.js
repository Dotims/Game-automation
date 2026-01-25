/**
 * Pathfinding Module - A* Algorithm
 * Handles path calculation with collision detection
 */

(function() {
    'use strict';
    
    // Ensure MargonemAPI exists
    window.MargonemAPI = window.MargonemAPI || {};
    
    /**
     * Node class for A* pathfinding
     */
    class Node {
        constructor(x, y, g = 0, h = 0) {
            this.x = x;
            this.y = y;
            this.g = g;
            this.h = h;
            this.f = g + h;
            this.parent = null;
            this.key = x + ',' + y;
        }
    }
    
    /**
     * Pathfinding system using A* algorithm
     */
    const pathfinding = {
        cache: {
            collisionGrid: null,
            pathCache: new Map(),
            lastMapName: null,
            nodeCache: new Map(),
            openSet: null,
            closedSet: null
        },
        
        Node: Node,
        
        /**
         * Debug logging (only when DEBUG enabled)
         */
        debug: function(...args) {
            if (window.MargonemAPI.DEBUG) {
                console.log('[Pathfinding]', ...args);
            }
        },
        
        /**
         * Initialize collision grid from map data
         */
        initializeCollisionGrid: function() {
            const engine = window.Engine;
            if (!engine?.map) {
                return null;
            }
            
            const mapName = engine.map.d.name;
            
            // Use cached grid if same map
            if (mapName === this.cache.lastMapName && this.cache.collisionGrid) {
                return this.cache.collisionGrid;
            }
            
            const collisionData = window.MargonemAPI.scanMapCollisions();
            if (!collisionData) {
                return null;
            }
            
            const width = collisionData.width;
            const height = collisionData.height;
            const grid = new Uint8Array(width * height);
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    grid[y * width + x] = collisionData.collisions[y][x].collision ? 1 : 0;
                }
            }
            
            this.cache.collisionGrid = grid;
            this.cache.gridWidth = width;
            this.cache.gridHeight = height;
            this.cache.lastMapName = mapName;
            this.cache.pathCache.clear();
            this.cache.nodeCache.clear();
            
            return grid;
        },
        
        /**
         * Check if position has collision
         */
        checkCollision: function(x, y) {
            const { gridWidth, collisionGrid } = this.cache;
            if (!collisionGrid || !gridWidth) return true;
            return collisionGrid[y * gridWidth + x] === 1;
        },
        
        /**
         * Find path using A* algorithm
         */
        findPath: function(startX, startY, endX, endY) {
            if (!this.cache.collisionGrid) {
                this.initializeCollisionGrid();
                if (!this.cache.collisionGrid) {
                    return null;
                }
            }
            
            // Check cache first
            const cacheKey = startX + ',' + startY + '-' + endX + ',' + endY;
            const cachedPath = this.cache.pathCache.get(cacheKey);
            if (cachedPath) {
                return cachedPath;
            }
            
            const { gridWidth: width, gridHeight: height } = this.cache;
            
            // Validate bounds
            if (startX < 0 || startY < 0 || endX < 0 || endY < 0 ||
                startX >= width || startY >= height || endX >= width || endY >= height) {
                return null;
            }
            
            const openSet = new Map();
            const closedSet = new Set();
            
            const startNode = new this.Node(
                startX, startY, 0,
                Math.abs(endX - startX) + Math.abs(endY - startY)
            );
            openSet.set(startNode.key, startNode);
            
            // Cardinal directions only
            const neighbors = [
                { x: 0, y: -1 },  // up
                { x: 1, y: 0 },   // right
                { x: 0, y: 1 },   // down
                { x: -1, y: 0 }   // left
            ];
            
            while (openSet.size > 0) {
                // Find node with lowest f
                let current = null;
                let lowestF = Infinity;
                
                for (const [nodeKey, node] of openSet) {
                    if (node.f < lowestF) {
                        lowestF = node.f;
                        current = node;
                    }
                }
                
                // Goal reached
                if (current.x === endX && current.y === endY) {
                    const path = [];
                    while (current) {
                        path.unshift({ x: current.x, y: current.y });
                        current = current.parent;
                    }
                    this.cache.pathCache.set(cacheKey, path);
                    return path;
                }
                
                openSet.delete(current.key);
                closedSet.add(current.key);
                
                // Process neighbors
                for (const direction of neighbors) {
                    const neighborX = current.x + direction.x;
                    const neighborY = current.y + direction.y;
                    const neighborKey = neighborX + ',' + neighborY;
                    
                    // Skip invalid positions
                    if (neighborX < 0 || neighborY < 0 ||
                        neighborX >= width || neighborY >= height ||
                        (this.checkCollision(neighborX, neighborY) && 
                         (neighborX !== endX || neighborY !== endY)) ||
                        closedSet.has(neighborKey)) {
                        continue;
                    }
                    
                    const tentativeG = current.g + 1;
                    const existingNode = openSet.get(neighborKey);
                    
                    if (existingNode) {
                        if (tentativeG < existingNode.g) {
                            existingNode.g = tentativeG;
                            existingNode.f = tentativeG + existingNode.h;
                            existingNode.parent = current;
                        }
                    } else {
                        const newNode = new this.Node(
                            neighborX, neighborY,
                            tentativeG,
                            Math.abs(endX - neighborX) + Math.abs(endY - neighborY)
                        );
                        newNode.parent = current;
                        openSet.set(neighborKey, newNode);
                    }
                }
            }
            
            // No path found
            this.cache.pathCache.set(cacheKey, null);
            return null;
        },
        
        /**
         * Calculate real walking distance using pathfinding
         */
        calculateRealDistance: function(startX, startY, endX, endY) {
            const path = this.findPath(startX, startY, endX, endY);
            if (path) {
                return path.length - 1;
            }
            return Infinity;
        },
        
        /**
         * Find path with server position correction
         */
        findPathWithBackHandling: function(startX, startY, endX, endY) {
            try {
                const engine = window.Engine;
                
                if (engine && engine.hero) {
                    const localX = Math.floor(parseFloat(engine.hero.d.x || 0));
                    const localY = Math.floor(parseFloat(engine.hero.d.y || 0));
                    const serverX = Math.floor(parseFloat(engine.hero.lastServerX || engine.hero.d.x || 0));
                    const serverY = Math.floor(parseFloat(engine.hero.lastServerY || engine.hero.d.y || 0));
                    
                    // Correct for position mismatch
                    if (Math.abs(localX - serverX) > 0 || Math.abs(localY - serverY) > 0) {
                        console.log(`[Pathfinding] Position mismatch: Local(${localX},${localY}) vs Server(${serverX},${serverY})`);
                        startX = serverX;
                        startY = serverY;
                    }
                }
                
                return this.findPath(startX, startY, endX, endY);
            } catch (error) {
                console.error('[Pathfinding] Error in findPathWithBackHandling:', error);
                return null;
            }
        },
        
        /**
         * Clear path cache (call on map change)
         */
        clearCache: function() {
            this.cache.pathCache.clear();
            this.cache.nodeCache.clear();
            this.cache.collisionGrid = null;
            this.cache.lastMapName = null;
        }
    };
    
    // Assign to MargonemAPI
    window.MargonemAPI.pathfinding = window.MargonemAPI.pathfinding || {};
    Object.assign(window.MargonemAPI.pathfinding, pathfinding);
    
    console.log('[Pathfinding] ✅ Pathfinding module loaded');
})();
