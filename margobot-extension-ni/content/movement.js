// Extracted Movement & Bot Logic
// This file contains the core movement and fighting logic reverse-engineered from the final bot payload.
// Dependencies: 
// - window.Engine (Margonem Game API)
// - window.MargonemAPI (Bot State)
// - mapData (Map Graph for pathfinding - externally defined in the original file)

const MovementBot = {
    // --- Blocked Maps Logic ---
    BlockedMaps: {
        DATA: {
            "Zawodzące Kaskady": { minLevel: 200 },
            "Złudny Trakt": { minLevel: 170 },
            "Ukwiecona Skarpa": { minLevel: 170 },
            "Urwisko Zdrewniałych": { minLevel: 218 },
            "Mglisty Las": { minLevel: 200 },
            "Niecka Xiuh Atl": { minLevel: 200 }
        },
        isMapBlocked: function(mapName) {
            if (!mapName) return false;
            const config = this.DATA[mapName];
            if (!config) return false;
            
            const heroLevel = window.Engine?.hero?.d?.lvl || 0;
            if (heroLevel < config.minLevel) {
                console.log(`[Movement] Mapa zablokowana: ${mapName} (Wymagany lvl: ${config.minLevel}, Twój lvl: ${heroLevel})`);
                return true;
            }
            return false;
        }
    },

    // --- Navigation Logic ---
    Navigation: {
        findShortestPath: function (startMap, targetMap) {
            if (!startMap || !targetMap) return { path: [], error: "Invalid locations" };
            
            const startNode = startMap.trim();
            const endNode = targetMap.trim();
            
            if (startNode === endNode) return { path: [], distance: 0 };

            // Access mapData from global scope (ensure it's loaded from map_data.js)
            const md = window.mapData || (window.MargonemAPI && window.MargonemAPI.mapData) || {};

            if (!md[startNode]) {
                console.warn(`[Movement] Map data missing for start node: ${startNode}`);
                // Try to find if we are on a map that connects to known maps (blind check)
                 return { path: [], error: "Start map not in graph" };
            }

            // BFS for unweighted shortest path (sufficient for map jumps)
            const queue = [[startNode]];
            const visited = new Set();
            visited.add(startNode);
            
            // Limit depth to avoid freezing browser on huge graphs
            let iterations = 0;
            const MAX_ITERATIONS = 5000;

            while (queue.length > 0) {
                iterations++;
                if (iterations > MAX_ITERATIONS) return { path: [], error: "Pathfinding timeout" };
                
                const path = queue.shift();
                const node = path[path.length - 1];

                if (node === endNode) {
                    // Reconstruct path with gateway details
                    const fullPath = [];
                    for (let i = 0; i < path.length - 1; i++) {
                        const current = path[i];
                        const next = path[i+1];
                        const mapInfo = md[current];
                        
                        let gateway = { x: 0, y: 0 }; // Default
                        if (mapInfo && mapInfo.gateways) {
                             // Find gateway connecting current to next
                             // gateways structure in mapData: array of objects with 'targetMap' or similar property
                             // Need to handle different data structures potentially found in mapData.js
                             // Common structure: keys are map names, values have 'gateways' list
                             const connection = mapInfo.gateways.find(g => {
                                 const t = g.name || g.targetMap || g.target_map || (g.d ? g.d.name : "");
                                 return t === next;
                             });
                             if (connection) {
                                 gateway = {
                                     x: connection.x || (connection.d ? connection.d.x : 0),
                                     y: connection.y || (connection.d ? connection.d.y : 0)
                                 };
                             }
                        }
                        
                        fullPath.push({
                            currentMap: current,
                            nextMap: next,
                            gateway: gateway
                        });
                    }
                    return { path: fullPath, distance: fullPath.length };
                }

                const mapInfo = md[node];
                if (mapInfo && mapInfo.gateways) {
                     for (const gateway of mapInfo.gateways) {
                         const neighborName = gateway.name || gateway.targetMap || gateway.target_map || (gateway.d ? gateway.d.name : null);
                         if (neighborName && !visited.has(neighborName)) {
                             // --- Blocked Maps Check ---
                             if (MovementBot.BlockedMaps && MovementBot.BlockedMaps.isMapBlocked(neighborName)) {
                                 continue;
                             }
                             // --------------------------
                             visited.add(neighborName);
                             const newPath = [...path, neighborName];
                             queue.push(newPath);
                         }
                     }
                }
            }

            return { path: [], error: "No path found" };
        },

        goToLocation: async function (targetLocation) {
            // High-level movement function
            // if (!sessionToken) return; // Requires session token - removed for local bot

            // Start auto-fighter to protect during travel
            if(window.MargonemAPI.state.navigation) {
                if(window.MargonemAPI.state.navigation.autoFight) clearInterval(window.MargonemAPI.state.navigation.autoFight);
                window.MargonemAPI.state.navigation.autoFight = setInterval(() => {
                    try { if(window.Engine.battle && window.Engine.battle.autoFight) window.Engine.battle.autoFight(); } catch (e) {}
                }, 1000);

                const navState = window.MargonemAPI.state.navigation;
                navState.abortNavigation = false;

                const currentLocation = this.getCurrentLocation();
                if (!currentLocation) return false;
                if (currentLocation === targetLocation) return true;

                // Find path
                // Note: since mapData might be missing, we might only support direct gateway movement or verify mapData exists
                const pathResult = this.findShortestPath(currentLocation, targetLocation);
                
                // FALLBACK: If pathfinder fails (no mapData), but we see the gateway on screen:
                // Try to find gateway locally
                let localGw = null;
                // Assuming logic.js might have a better pathfinder, but if we are here...
                
                if (pathResult.error || !pathResult.path.length) {
                    console.warn("Pathfinder failed: " + pathResult.error);
                    // Try to find direct gateway
                    // ... implementation ...
                    return false;
                }

                // Setup navigation state
                navState.currentPath = pathResult.path;
                navState.currentPathIndex = 0;
                navState.isNavigating = true;
                navState.targetLocation = targetLocation;
                navState.lastMoveTime = Date.now();

                this.processNextPathStep();
                
                // Monitor progress
                if(navState.pathCheckInterval) clearInterval(navState.pathCheckInterval);
                navState.pathCheckInterval = setInterval(() => this.checkNavigationProgress(), 1000);
            }
            return true;
        },

        processNextPathStep: async function () {
            const navState = window.MargonemAPI.state.navigation;
            if (navState.abortNavigation) return;

            const currentStep = navState.currentPath && navState.currentPath[navState.currentPathIndex];
            if (!currentStep || !navState.isNavigating) {
                this.stopNavigation();
                return;
            }

            const gateway = currentStep.gateway;
            if (gateway) {
                const Engine = window.Engine;
                if (Engine && Engine.hero) {
                    const heroX = Math.floor(Engine.hero.x || Engine.hero.d.x);
                    const heroY = Math.floor(Engine.hero.y || Engine.hero.d.y);

                    // If at gateway, go through
                    if (heroX === gateway.x && heroY === gateway.y) {
                         // NI specific gateway usage
                        if(Engine.hero.getTroughGateway) Engine.hero.getTroughGateway();
                    } 
                    // If near gateway, click it (talk)
                    else if (Math.abs(heroX - gateway.x) <= 1 && Math.abs(heroY - gateway.y) <= 1) {
                        if(Engine.hero.talkNearMob) Engine.hero.talkNearMob();
                    }

                    // Move to gateway using game's built-in pathfinding
                    if(Engine.hero.autoGoTo) {
                        Engine.hero.autoGoTo({ x: gateway.x, y: gateway.y }, false);
                        navState.lastMoveTime = Date.now();
                    }
                }
            }
        },

        checkNavigationProgress: function () {
            const navState = window.MargonemAPI.state.navigation;
            if (navState.abortNavigation || !navState.isNavigating) return;

            const currentLocation = this.getCurrentLocation();
            const currentStep = navState.currentPath && navState.currentPath[navState.currentPathIndex];

            // If we reached the next map in the path
            if (currentStep && currentLocation === currentStep.nextMap) {
                navState.currentPathIndex++;
                if (navState.currentPathIndex >= navState.currentPath.length) {
                    this.stopNavigation(true); // Arrived
                    return;
                }
                this.processNextPathStep();
            }

            // Stuck detection
            if (Date.now() - navState.lastMoveTime > (navState.stuckCheckInterval || 5000)) {
                this.processNextPathStep(); // Retry move
            }
            if (Date.now() - navState.lastMoveTime > (navState.navigationTimeout || 30000)) {
                this.stopNavigation(false); // Timeout
            }
        },

        stopNavigation: function (success = false) {
            const navState = window.MargonemAPI.state.navigation;
            navState.abortNavigation = true;
            navState.isNavigating = false;
            if (navState.pathCheckInterval) clearInterval(navState.pathCheckInterval);
            
            // Stop hero movement
            if (window.Engine && window.Engine.hero && window.Engine.hero.autoGoTo) {
                const x = Math.floor(window.Engine.hero.x || window.Engine.hero.d.x);
                const y = Math.floor(window.Engine.hero.y || window.Engine.hero.d.y);
                window.Engine.hero.autoGoTo({ x, y });
            }
            
            if (success && navState.autoFight) clearInterval(navState.autoFight);
        },

        getCurrentLocation: function () {
            return window.Engine && window.Engine.map && window.Engine.map.d ? window.Engine.map.d.name : null;
        }
    },

    // --- E2 Boss Logic ---
    E2: {
        navigateToE2Location: async function (bossData) {
            const targetMap = bossData.map;
            const targetX = bossData.x;
            const targetY = bossData.y;
            
            console.log(`Navigating to E2: Map=${targetMap}, X=${targetX}, Y=${targetY}`);
            
            // Use global navigation to get to the map
            const currentLocation = MovementBot.Navigation.getCurrentLocation();
            if (currentLocation !== targetMap) {
               // ... navigation logic calling goToLocation ...
               // Simplified:
               await MovementBot.Navigation.goToLocation(targetMap);
            }

            // Once on map, move to coordinates
            if (window.Engine.hero && window.Engine.hero.autoGoTo) {
                window.Engine.hero.autoGoTo({ x: targetX, y: targetY });
            }
            
            return { success: true };
        },

        fightE2: async function (mobParams) {
             console.log(`Engaging E2 at ${mobParams.d.x}, ${mobParams.d.y}`);
             const coords = { x: mobParams.d.x, y: mobParams.d.y };
             
             // Move to E2
             if(window.Engine.hero && window.Engine.hero.autoGoTo)
                window.Engine.hero.autoGoTo(coords, false);
             
             // Wait loop checking distance
             // ...
             
             // Start fight
             // window.Engine.battle.start(mobParams.id);
             // ...
             
             return { killed: true };
        }
    },

    // --- General Exping Logic ---
    Exping: {
        handleRegularMapExping: async function (minLevel, maxLevel) {
            const expLocationState = window.MargonemAPI.state.exping_location;
            // Iterate through selected maps
            // Calls navigateToLocation -> goToLocation
            // Calls fightOnCurrentLocation -> loops through mobs
        }
    }
};

// Export for usage
if (typeof window !== 'undefined') {
    window.MovementBot = MovementBot;
    
    // Integrate with MargonemAPI
    if (window.MargonemAPI) {
        if(!window.MargonemAPI.navigation) window.MargonemAPI.navigation = {};
        Object.assign(window.MargonemAPI.navigation, MovementBot.Navigation);
        
        if(!window.MargonemAPI.E2) window.MargonemAPI.E2 = {};
        Object.assign(window.MargonemAPI.E2, MovementBot.E2);
        
        console.log("🤖 Movement logic attached to MargonemAPI");
    }
}
