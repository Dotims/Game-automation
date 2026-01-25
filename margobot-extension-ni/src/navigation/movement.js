// Extracted Movement & Bot Logic
// This file contains the core movement and fighting logic reverse-engineered from the final bot payload.
// Dependencies: 
// - window.Engine (Margonem Game API)
// - window.MargonemAPI (Bot State)
// - mapData (Map Graph for pathfinding - externally defined in the original file)

const MovementBot = {
    // --- Navigation Logic ---
    Navigation: {
        _normalizeMapName: function (name) {
            if (!name || typeof name !== 'string') return name;
            // Many entries in mapData gateways include HTML or extra info, e.g.
            // "Opuszczony Szyb<br>Przejście dostępne od 60 poziomu".
            // The actual map key is usually the part before <br>.
            let n = name;
            n = n.replace(/<br\s*\/?\s*>/gi, '\n');
            n = n.replace(/<[^>]*>/g, '');
            n = n.split('\n')[0];
            n = n.trim();
            // Drop common "access" suffixes if they survived without HTML.
            n = n.replace(/\s+Przejście\s+dostępne.*$/i, '').trim();
            return n;
        },

        _isInteriorMap: function (mapName) {
            if (!mapName || typeof mapName !== 'string') return false;
            const n = mapName;
            // Heuristic: these are almost always interiors/instances and are bad candidates for world travel.
            // (They also frequently include locked doors.)
            if (/\bp\.[0-9]+\b/i.test(n)) return true; // floors like "p.1"
            if (/\bApartament\b/i.test(n)) return true;
            if (/\bPokój\b/i.test(n)) return true;
            if (/\bCela\b/i.test(n)) return true;
            if (/\bKamienica\b/i.test(n)) return true;
            if (/\bDom\b/i.test(n)) return true;
            if (/\bKarczma\b/i.test(n)) return true;
            if (/\bTeatr\b/i.test(n)) return true;
            if (/\bGildia\b/i.test(n)) return true;
            if (/\bRezydencja\b/i.test(n)) return true;
            if (/\bMagazyn\b/i.test(n)) return true;
            if (/\bPiwnica\b/i.test(n)) return true;
            if (/\bStrych\b/i.test(n)) return true;
            if (/\bKorytarz\b/i.test(n)) return true;
            if (/\bLochy\b/i.test(n)) return true;
            if (/\bKanały\b/i.test(n)) return true;
            return false;
        },

        _getGatewayTargetName: function (gateway) {
            if (!gateway) return null;
            const raw = gateway.name || gateway.targetMap || gateway.target_map || (gateway.d ? gateway.d.name : null) || null;
            return this._normalizeMapName(raw);
        },

        _getGatewayCoords: function (gateway) {
            if (!gateway) return null;
            const x = (gateway.x ?? (gateway.d ? gateway.d.x : undefined));
            const y = (gateway.y ?? (gateway.d ? gateway.d.y : undefined));
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x: Number(x), y: Number(y) };
        },

        _navLog: function (level, msg, data) {
            try {
                const prefix = "[MargoBot][Nav]";
                const payload = data ? data : undefined;
                if (level === 'warn') console.warn(prefix, msg, payload);
                else if (level === 'error') console.error(prefix, msg, payload);
                else console.log(prefix, msg, payload);
            } catch (e) {}
        },

        _ensureNavInternals: function (navState) {
            if (!navState) return;
            if (!navState._stepFailCounts) navState._stepFailCounts = Object.create(null);
            if (!navState._tempBlockedNextMaps) navState._tempBlockedNextMaps = new Map();
            if (!navState._lastLocation) navState._lastLocation = null;
            if (!navState._lastDebugAt) navState._lastDebugAt = 0;
            if (!navState._lastHeroPos) navState._lastHeroPos = null;
            if (!navState._currentStepKey) navState._currentStepKey = null;
            if (!navState._currentStepStartedAt) navState._currentStepStartedAt = 0;
            if (!navState._lastClearedTempBlocksAt) navState._lastClearedTempBlocksAt = 0;
        },

        _cleanupTempBlocks: function (navState) {
            if (!navState || !navState._tempBlockedNextMaps || navState._tempBlockedNextMaps.size === 0) return;
            const now = Date.now();
            for (const [mapName, entry] of navState._tempBlockedNextMaps.entries()) {
                if (!entry || !entry.until || now >= entry.until) {
                    navState._tempBlockedNextMaps.delete(mapName);
                }
            }
        },

        _isTempBlocked: function (navState, nextMap) {
            if (!navState || !nextMap) return false;
            this._cleanupTempBlocks(navState);
            const entry = navState._tempBlockedNextMaps && navState._tempBlockedNextMaps.get(nextMap);
            return !!(entry && entry.until && Date.now() < entry.until);
        },

        _setTempBlocked: function (navState, nextMap, reason, ttlMs) {
            if (!navState || !nextMap) return;
            const ttl = Number.isFinite(ttlMs) ? ttlMs : 10 * 60 * 1000; // 10 minutes
            navState._tempBlockedNextMaps.set(nextMap, {
                until: Date.now() + ttl,
                reason: reason || 'blocked'
            });
        },

        _getStepKey: function (step) {
            if (!step) return "(no-step)";
            return `${step.currentMap || '?'} -> ${step.nextMap || '?'}`;
        },

        _rerouteFromCurrent: function (navState) {
            try {
                const currentLocation = this.getCurrentLocation();
                const targetLocation = navState && navState.targetLocation;
                if (!currentLocation || !targetLocation) return false;
                const pathResult = this.findShortestPath(currentLocation, targetLocation, navState);
                if (pathResult.error || !pathResult.path || !pathResult.path.length) {
                    this._navLog('error', 'Reroute failed', {
                        error: pathResult.error,
                        from: currentLocation,
                        to: targetLocation,
                        tempBlocked: navState._tempBlockedNextMaps ? Array.from(navState._tempBlockedNextMaps.keys()) : []
                    });
                    this.stopNavigation(false);
                    return true;
                }
                navState.currentPath = pathResult.path;
                navState.currentPathIndex = 0;
                navState.lastMoveTime = Date.now();
                this._navLog('warn', 'Rerouted', {
                    from: currentLocation,
                    to: targetLocation,
                    steps: pathResult.path.length,
                    tempBlocked: navState._tempBlockedNextMaps ? Array.from(navState._tempBlockedNextMaps.keys()) : []
                });
                this.processNextPathStep();
                return true;
            } catch (e) {
                this._navLog('error', 'Reroute exception', { error: String(e && e.message || e) });
                return false;
            }
        },

        _markStepFailedAndMaybeReroute: function (navState, step, reason, details = null) {
            this._ensureNavInternals(navState);
            const key = this._getStepKey(step);
            navState._stepFailCounts[key] = (navState._stepFailCounts[key] || 0) + 1;

            const count = navState._stepFailCounts[key];
            const FAIL_THRESHOLD = 5;

            if (count === 1 || count === FAIL_THRESHOLD) {
                this._navLog('warn', 'Step failing', {
                    step: key,
                    count,
                    reason,
                    details: details || undefined,
                    currentMap: this.getCurrentLocation(),
                    target: navState.targetLocation
                });
            }

            // Only assume a key-locked/blocked transition if we're actually standing on the gateway tile
            // and still cannot change maps after multiple attempts.
            const atGateway = !!(details && details.atGateway);
            if (count >= FAIL_THRESHOLD && atGateway && step && step.nextMap) {
                this._setTempBlocked(navState, step.nextMap, 'gateway blocked (key?)', 15 * 60 * 1000);
                this._navLog('warn', 'Temporarily blocking nextMap and rerouting (gateway seems blocked)', {
                    blockedNextMap: step.nextMap,
                    target: navState.targetLocation
                });
                return this._rerouteFromCurrent(navState);
            }
            return false;
        },

        findShortestPath: function (startMap, targetMap, navState = null) {
            if (!startMap || !targetMap) return { path: [], error: "Invalid locations" };

            const startNode = this._normalizeMapName(startMap.trim());
            const endNode = this._normalizeMapName(targetMap.trim());
            
            if (startNode === endNode) return { path: [], distance: 0 };

            // Access mapData from global scope (ensure it's loaded from map_data.js)
            const md = window.mapData || (window.MargonemAPI && window.MargonemAPI.mapData) || {};

            if (!md[startNode]) {
                console.warn(`[Movement] Map data missing for start node: ${startNode}`);
                // Try to find if we are on a map that connects to known maps (blind check)
                 return { path: [], error: "Start map not in graph" };
            }

            const avoidInteriors = !(this._isInteriorMap(endNode));

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

                        let gateway = null;
                        if (mapInfo && Array.isArray(mapInfo.gateways)) {
                            const connection = mapInfo.gateways.find(g => this._getGatewayTargetName(g) === next);
                            if (connection) {
                                gateway = this._getGatewayCoords(connection);
                            }
                        }

                        if (!gateway) {
                            return {
                                path: [],
                                error: `Missing gateway coords for step: ${current} -> ${next}`
                            };
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
                if (mapInfo && Array.isArray(mapInfo.gateways)) {
                    for (const gateway of mapInfo.gateways) {
                        const neighborName = this._getGatewayTargetName(gateway);
                        if (!neighborName || visited.has(neighborName)) continue;

                        // Prefer staying in the "world" graph unless the destination itself is an interior.
                        if (avoidInteriors && this._isInteriorMap(neighborName)) continue;

                        // Skip edges to unknown nodes (often caused by unnormalized names).
                        if (!md[neighborName] && neighborName !== endNode) continue;

                        // We can only navigate if we have usable coordinates.
                        const coords = this._getGatewayCoords(gateway);
                        if (!coords) continue;

                        // --- Blocked Maps Check (uses src/core/config.js) ---
                        if (window.BotConfig && window.BotConfig.isMapBlocked(neighborName)) {
                            continue;
                        }
                        // --- Temporary blocked maps (e.g. key-locked transitions discovered at runtime) ---
                        if (this._isTempBlocked(navState, neighborName)) continue;

                        visited.add(neighborName);
                        const newPath = [...path, neighborName];
                        queue.push(newPath);
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
                this._ensureNavInternals(navState);
                navState.abortNavigation = false;

                // Prevent thrashing: navigateToLocation() retries call goToLocation() every ~2s.
                // If we're already navigating to the same target, don't restart the whole path.
                if (navState.isNavigating && navState.targetLocation === targetLocation && navState.currentPath && navState.currentPath.length) {
                    return true;
                }

                // New target: clear any stale temp blocks from previous run.
                if (navState.targetLocation && navState.targetLocation !== targetLocation) {
                    navState._tempBlockedNextMaps = new Map();
                }

                const currentLocation = this.getCurrentLocation();
                if (!currentLocation) return false;
                if (currentLocation === targetLocation) return true;

                // Find path
                // Note: since mapData might be missing, we might only support direct gateway movement or verify mapData exists
                const pathResult = this.findShortestPath(currentLocation, targetLocation, navState);
                
                // FALLBACK: If pathfinder fails (no mapData), but we see the gateway on screen:
                // Try to find gateway locally
                let localGw = null;
                // Assuming logic.js might have a better pathfinder, but if we are here...
                
                if (pathResult.error || !pathResult.path.length) {
                    // If temporary blocks made the destination unreachable, clear them once and retry.
                    const now = Date.now();
                    if (navState._tempBlockedNextMaps && navState._tempBlockedNextMaps.size > 0 && (now - navState._lastClearedTempBlocksAt) > 15000) {
                        navState._lastClearedTempBlocksAt = now;
                        this._navLog('warn', 'Pathfinder failed; clearing temp blocks and retrying once', {
                            from: currentLocation,
                            to: targetLocation,
                            prevTempBlocked: Array.from(navState._tempBlockedNextMaps.keys())
                        });
                        navState._tempBlockedNextMaps = new Map();
                        const retry = this.findShortestPath(currentLocation, targetLocation, navState);
                        if (!retry.error && retry.path && retry.path.length) {
                            navState.currentPath = retry.path;
                            navState.currentPathIndex = 0;
                            navState.isNavigating = true;
                            navState.targetLocation = targetLocation;
                            navState.lastMoveTime = Date.now();

                            this._navLog('log', 'Navigation started', {
                                from: currentLocation,
                                to: targetLocation,
                                steps: retry.path.length
                            });

                            this.processNextPathStep();
                            if (navState.pathCheckInterval) clearInterval(navState.pathCheckInterval);
                            navState.pathCheckInterval = setInterval(() => this.checkNavigationProgress(), 1000);
                            return true;
                        }
                    }

                    this._navLog('error', 'Pathfinder failed', {
                        error: pathResult.error,
                        from: currentLocation,
                        to: targetLocation,
                        tempBlocked: navState._tempBlockedNextMaps ? Array.from(navState._tempBlockedNextMaps.keys()) : []
                    });
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
                navState._lastHeroPos = null;
                navState._currentStepKey = null;
                navState._currentStepStartedAt = 0;

                this._navLog('log', 'Navigation started', {
                    from: currentLocation,
                    to: targetLocation,
                    steps: pathResult.path.length
                });

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

            this._ensureNavInternals(navState);

            const currentStep = navState.currentPath && navState.currentPath[navState.currentPathIndex];
            if (!currentStep || !navState.isNavigating) {
                this.stopNavigation();
                return;
            }

            if (this._isTempBlocked(navState, currentStep.nextMap)) {
                this._navLog('warn', 'Current nextMap is temporarily blocked; rerouting', {
                    nextMap: currentStep.nextMap,
                    target: navState.targetLocation
                });
                this._rerouteFromCurrent(navState);
                return;
            }

            // Track when a step started (for debugging).
            const stepKey = this._getStepKey(currentStep);
            if (navState._currentStepKey !== stepKey) {
                navState._currentStepKey = stepKey;
                navState._currentStepStartedAt = Date.now();
            }

            const gateway = currentStep.gateway;
            if (gateway) {
                const Engine = window.Engine;
                if (Engine && Engine.hero) {
                    const heroX = Math.floor(Engine.hero.x || Engine.hero.d.x);
                    const heroY = Math.floor(Engine.hero.y || Engine.hero.d.y);

                    if (Date.now() - navState._lastDebugAt > 5000) {
                        navState._lastDebugAt = Date.now();
                        this._navLog('log', 'Step progress', {
                            step: this._getStepKey(currentStep),
                            hero: { x: heroX, y: heroY },
                            gateway: { x: gateway.x, y: gateway.y },
                            target: navState.targetLocation
                        });
                    }

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

            this._ensureNavInternals(navState);

            const currentLocation = this.getCurrentLocation();
            const currentStep = navState.currentPath && navState.currentPath[navState.currentPathIndex];

            // Update lastMoveTime based on actual hero movement, not just command issuance.
            const Engine = window.Engine;
            if (Engine && Engine.hero) {
                const hx = Math.floor(Engine.hero.x || Engine.hero.d.x);
                const hy = Math.floor(Engine.hero.y || Engine.hero.d.y);
                if (!navState._lastHeroPos || navState._lastHeroPos.x !== hx || navState._lastHeroPos.y !== hy) {
                    navState._lastHeroPos = { x: hx, y: hy };
                    navState.lastMoveTime = Date.now();
                }
            }

            if (currentLocation && currentLocation !== navState._lastLocation) {
                navState._lastLocation = currentLocation;
                navState._stepFailCounts = Object.create(null);
                this._navLog('log', 'Map changed during navigation', {
                    map: currentLocation,
                    target: navState.targetLocation,
                    stepIndex: navState.currentPathIndex
                });

                // If we ended up on an unexpected map (teleport/back, forced move, etc.), reroute.
                if (currentStep && currentLocation !== currentStep.currentMap && currentLocation !== currentStep.nextMap) {
                    this._navLog('warn', 'Off-path map change detected; rerouting', {
                        map: currentLocation,
                        expectedCurrent: currentStep.currentMap,
                        expectedNext: currentStep.nextMap,
                        target: navState.targetLocation
                    });
                    this._rerouteFromCurrent(navState);
                    return;
                }
            }

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
            if (Date.now() - navState.lastMoveTime > (navState.stuckCheckInterval || 8000)) {
                if (currentStep) {
                    const Engine2 = window.Engine;
                    let atGateway = false;
                    try {
                        if (Engine2 && Engine2.hero && currentStep.gateway) {
                            const hx = Math.floor(Engine2.hero.x || Engine2.hero.d.x);
                            const hy = Math.floor(Engine2.hero.y || Engine2.hero.d.y);
                            atGateway = (hx === currentStep.gateway.x && hy === currentStep.gateway.y);
                        }
                    } catch (e) {}

                    const didReroute = this._markStepFailedAndMaybeReroute(navState, currentStep, 'stuck detection', { atGateway });
                    if (didReroute) return;
                }
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
            navState.targetLocation = null;
            navState.currentPath = null;
            navState.currentPathIndex = 0;
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
        
        // console.log("🤖 Movement logic attached to MargonemAPI");
    }
}
