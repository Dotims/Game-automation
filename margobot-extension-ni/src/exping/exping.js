/**
 * Exping Module
 * Handles automatic leveling/grinding system
 */

(function() {
    'use strict';
    
    // Ensure MargonemAPI exists
    window.MargonemAPI = window.MargonemAPI || {};
    
    // Import sleep helper
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    /**
     * Exping system
     */
    const exping = {
        
        /**
         * Check if exping was aborted
         */
        checkAborted: function() {
            if (window.MargonemAPI.state.exping_location.is_aborted) {
                throw new Error("Exping aborted");
            }
        },
        
        /**
         * Get next best map to visit
         * Priority: unvisited maps > least recently visited maps
         * @param {Array} availableMaps - List of available maps
         * @returns {string|null} - Next map name or null
         */
        getNextBestMap: function(availableMaps) {
            if (!availableMaps || availableMaps.length === 0) return null;
            
            // Upewnij się że visitedMapsHistory istnieje
            if (!window.MargonemAPI.state.exping_location) {
                window.MargonemAPI.state.exping_location = {};
            }
            if (!window.MargonemAPI.state.exping_location.visitedMapsHistory) {
                window.MargonemAPI.state.exping_location.visitedMapsHistory = {};
            }
            const history = window.MargonemAPI.state.exping_location.visitedMapsHistory;
            const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
            
            // Filter out current map
            const candidates = availableMaps.filter(m => m !== currentMap);
            if (candidates.length === 0) return availableMaps[0];
            
            // Find unvisited maps first
            const unvisited = candidates.filter(m => !history[m]);
            if (unvisited.length > 0) {
                console.log("[Exping] Wybrano nieodwiedzoną mapę:", unvisited[0]);
                return unvisited[0];
            }
            
            // All maps visited - pick the least recently visited
            let oldestMap = candidates[0];
            let oldestTime = history[candidates[0]] || Infinity;
            
            for (const mapName of candidates) {
                const visitTime = history[mapName] || 0;
                if (visitTime < oldestTime) {
                    oldestTime = visitTime;
                    oldestMap = mapName;
                }
            }
            
            console.log("[Exping] Wszystkie mapy odwiedzone. Wybrano najdawniej odwiedzoną:", oldestMap);
            return oldestMap;
        },
        
        /**
         * Record map visit
         * @param {string} mapName - Map name
         */
        recordMapVisit: function(mapName) {
            if (!mapName) return;
            // Upewnij się że visitedMapsHistory istnieje
            if (!window.MargonemAPI.state.exping_location) {
                window.MargonemAPI.state.exping_location = {};
            }
            if (!window.MargonemAPI.state.exping_location.visitedMapsHistory) {
                window.MargonemAPI.state.exping_location.visitedMapsHistory = {};
            }
            window.MargonemAPI.state.exping_location.visitedMapsHistory[mapName] = Date.now();
        },
        
        /**
         * Navigate to location with retries
         */
        navigateToLocation: async function(targetLocation) {
            this.checkAborted();
            const maxRetries = 30;
            let retryCount = 0;
            
            while (retryCount < maxRetries) {
                this.checkAborted();
                try {
                    await window.MargonemAPI.navigation.goToLocation(targetLocation);
                    this.checkAborted();
                    const mapChanged = await this.waitForMapChange(targetLocation);
                    this.checkAborted();
                    if (mapChanged) {
                        return true;
                    }
                } catch (err) {}
                retryCount++;
                await sleep(2000);
                this.checkAborted();
            }
            throw new Error("Navigation failed after " + maxRetries + " retries");
        },
        
        /**
         * Wait for map change
         */
        waitForMapChange: async function(targetMap) {
            this.checkAborted();
            const timeout = 30000;
            const startTime = Date.now();
            
            while (Date.now() - startTime < timeout) {
                if (window.MargonemAPI.state.exping_location.is_aborted) {
                    return false;
                }
                this.checkAborted();
                const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
                if (currentMap === targetMap) {
                    return true;
                }
                await sleep(1000);
                this.checkAborted();
            }
            return false;
        },
        
        /**
         * Wait for map to be cleared of mobs
         */
        waitForMapClear: async function() {
            this.checkAborted();
            const timeout = 300000;
            const startTime = Date.now();
            
            while (Date.now() - startTime < timeout) {
                if (window.MargonemAPI.state.exping_location.is_aborted) {
                    return false;
                }
                this.checkAborted();
                if (window.MargonemAPI.state.map_cleaned) {
                    window.MargonemAPI.state.map_cleaned = false;
                    window.MargonemAPI.state.exping_location.last_map_clean_time = Date.now();
                    return true;
                }
                await sleep(1000);
                this.checkAborted();
            }
            throw new Error("Timeout waiting for map clear");
        },
        
        /**
         * Check for mobs in level range
         */
        checkForMobs: async function(minLevel, maxLevel) {
            this.checkAborted();
            try {
                for (let attempt = 1; attempt <= 3; attempt++) {
                    this.checkAborted();
                    await sleep(1000);
                    this.checkAborted();
                    
                    const allMobs = window.MargonemAPI.getAllMobs() || [];
                    this.checkAborted();
                    
                    const validMobs = allMobs.filter(mob => {
                        const mobLevel = mob.lvl || 0;
                        return mobLevel >= minLevel && mobLevel <= maxLevel;
                    });
                    
                    if (validMobs.length > 0) {
                        return true;
                    }
                }
                return false;
            } catch (err) {
                return false;
            }
        },
        
        /**
         * Fight on current location
         */
        fightOnCurrentLocation: async function(minLevel, maxLevel) {
            this.checkAborted();
            
            try {
                const hasMobs = await this.checkForMobs(minLevel, maxLevel);
                this.checkAborted();
                
                if (!hasMobs) {
                    return false;
                }
                
                const fightOptions = {
                    levelRange: { min: minLevel, max: maxLevel }
                };
                
                await window.MargonemAPI.combat.startFight(fightOptions);
                this.checkAborted();
                
                const mapCleared = await this.waitForMapClear();
                this.checkAborted();
                
                window.MargonemAPI.combat.stopFight();
                return true;
            } catch (error) {
                window.MargonemAPI.combat.stopFight();
                throw error;
            }
        },
        
        /**
         * Find best location from spot list
         */
        findBestLocation: async function(currentLocation, spotList) {
            this.checkAborted();
            
            const locationDistances = await Promise.all(spotList.map(async spotEntry => {
                this.checkAborted();
                const [mapName, insideMap] = Object.entries(spotEntry)[0];
                try {
                    const pathResult = await window.MargonemAPI.navigation.findShortestPath(currentLocation, mapName);
                    this.checkAborted();
                    return {
                        map: mapName,
                        inside: insideMap,
                        distance: pathResult?.distance || Infinity
                    };
                } catch (err) {
                    return {
                        map: mapName,
                        inside: insideMap,
                        distance: Infinity
                    };
                }
            }));
            
            return locationDistances.reduce(
                (closest, current) => current.distance < closest.distance ? current : closest,
                { distance: Infinity }
            );
        },
        
        /**
         * Handle regular map exping
         */
        handleRegularMapExping: async function(minLevel, maxLevel) {
            const expingState = window.MargonemAPI.state.exping_location;
            const selectedMaps = expingState.selectedMaps || [];
            this.checkAborted();
            
            try {
                console.log("[Exping] ====== EXPING START ======");
                console.log("[Exping] Available maps:", selectedMaps);
                
                if (selectedMaps.length === 0) {
                    throw new Error("No maps selected for exping");
                }
                
                // Main exping loop
                while (!expingState.is_aborted) {
                    this.checkAborted();
                    
                    const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
                    const isCurrentMapValid = selectedMaps.includes(currentMap);
                    
                    // If on valid map, fight first
                    if (isCurrentMapValid) {
                        console.log("[Exping] Already on valid map, checking for mobs...");
                        window.MargonemAPI.state.map_cleaned = false;
                        
                        try {
                            this.recordMapVisit(currentMap);
                            const fightResult = await this.fightOnCurrentLocation(minLevel, maxLevel);
                            this.checkAborted();
                            if (fightResult) {
                                console.log("[Exping] Mapa wyczyszczona:", currentMap);
                            }
                        } catch (e) {
                            console.log("[Exping] Błąd walki na obecnej mapie:", currentMap, e);
                        }
                    }
                    
                    // Go to next map
                    const nextMap = this.getNextBestMap(selectedMaps);
                    if (!nextMap) {
                        console.log("[Exping] Brak dostępnych map do odwiedzenia");
                        await sleep(5000);
                        continue;
                    }
                    
                    if (nextMap !== currentMap) {
                        try {
                            console.log("[Exping] Nawigacja do mapy:", nextMap);
                            await this.navigateToLocation(nextMap);
                            this.checkAborted();
                            
                            this.recordMapVisit(nextMap);
                            
                            const fightSuccess = await this.fightOnCurrentLocation(minLevel, maxLevel);
                            this.checkAborted();
                            if (fightSuccess) {
                                console.log("[Exping] Mapa wyczyszczona:", nextMap);
                            }
                        } catch (err) {
                            console.log("[Exping] Błąd na mapie, kontynuuję:", nextMap);
                            continue;
                        }
                    }
                    
                    expingState.iteration.count++;
                }
            } catch (error) {
                throw error;
            }
        },
        
        /**
         * Stop exping and clean up
         */
        stopExping: function() {
            try {
                const state = window.MargonemAPI.state;
                const expingLocation = state.exping_location;
                
                // Clear intervals
                clearInterval(expingLocation.death_cam);
                clearInterval(expingLocation.teleport_if_player);
                clearInterval(expingLocation.potion_checker);
                clearInterval(expingLocation.bag_full);
                
                expingLocation.is_aborted = true;
                expingLocation._potionRefillInProgress = false;
                
                // Clear timers
                if (state.timers) {
                    Object.values(state.timers).forEach(timer => {
                        if (timer) {
                            clearTimeout(timer);
                            clearInterval(timer);
                        }
                    });
                    state.timers = {};
                }
                
                // Stop navigation
                if (window.MargonemAPI.navigation) {
                    window.MargonemAPI.navigation.stopNavigation(false);
                    if (state.navigation) {
                        clearInterval(state.navigation.pathCheckInterval);
                        state.navigation.isNavigating = false;
                        state.navigation.currentPath = null;
                        state.navigation.currentPathIndex = 0;
                        state.navigation.targetLocation = null;
                        state.navigation.lastMoveTime = null;
                    }
                }
                
                // Stop combat
                try {
                    window.MargonemAPI.combat.stopFight();
                    state.autoFightActive = false;
                    state.autoFightInProgress = false;
                    state.selectedNicks = [];
                    state.lastAttemptedMobs = [];
                    state.currentTargetId = null;
                    state.blockedMobs.clear();
                    state.map_cleaned = false;
                } catch (err) {}
                
                // Stop recovery system
                try {
                    if (window.MargonemAPI.combat?.recoverySystem) {
                        window.MargonemAPI.combat.recoverySystem.stopMonitoring();
                    }
                } catch (err) {}
                
                // Clear pending actions
                if (state.pendingStopActions) {
                    state.pendingStopActions.clear();
                }
                
                if (state.activeIntervals) {
                    state.activeIntervals.forEach(clearInterval);
                    state.activeIntervals.clear();
                }
                
                if (state.activeTimeouts) {
                    state.activeTimeouts.forEach(clearTimeout);
                    state.activeTimeouts.clear();
                }
                
                // Reset exping location state
                if (expingLocation) {
                    expingLocation.master_map = null;
                    expingLocation.current_expowisko = null;
                    expingLocation.current_gateway = null;
                    expingLocation.last_map_clean_time = null;
                    expingLocation.finished_gateways = [];
                    expingLocation.bag_check = null;
                    
                    if (expingLocation.sublocation_data) {
                        expingLocation.sublocation_data.mapped = false;
                        expingLocation.sublocation_data.connections.clear();
                        expingLocation.sublocation_data.optimal_path = [];
                        expingLocation.sublocation_data.visited.clear();
                    }
                    
                    if (expingLocation.iteration) {
                        expingLocation.iteration.count = 0;
                        expingLocation.iteration.visited_maps.clear();
                        expingLocation.iteration.visited_gateways.clear();
                        expingLocation.iteration.path = [];
                        expingLocation.iteration.completed = false;
                    }
                    
                    if (expingLocation.movement) {
                        expingLocation.movement.in_progress = false;
                        expingLocation.movement.target = null;
                        expingLocation.movement.start_time = null;
                    }
                }
                
                // Stop hero movement
                try {
                    const engine = window.Engine;
                    if (engine && engine.hero) {
                        const heroX = Math.floor(engine.hero.x || engine.hero.d?.x);
                        const heroY = Math.floor(engine.hero.y || engine.hero.d?.y);
                        engine.hero.autoGoTo({ x: heroX, y: heroY });
                    }
                } catch (err) {}
                
                return true;
            } catch (error) {
                console.error("[Exping] Error in stopExping:", error);
                return false;
            }
        },
        
        /**
         * Sell items at Tunia
         */
        tuniaSelling: async function() {
            try {
                await this.navigateToLocation("Dom Tunii");
                await this.waitForMapChange("Dom Tunii");
                
                window.Engine.hero.autoGoTo({ x: 8, y: 9 }, false);
                await waitForPosition(8, 9, 60000);
                
                window.Engine.hero.talkNearMob();
                await waitForElement("li.dialogue-window-answer.answer.line_shop > span");
                
                const shopDialogOption = document.querySelector("li.dialogue-window-answer.answer.line_shop > span");
                if (!shopDialogOption) {
                    throw new Error("Shop dialog not found");
                }
                
                shopDialogOption.click();
                await waitForElement("body > div.game-window-positioner > div.alerts-layer.layer > div.border-window");
                await sleep(1000);
                
                // Sell items 7 times
                for (let i = 0; i < 7; i++) {
                    const sellAllButton = document.querySelector("div.great-merchamp.btns-spacing > div:nth-child(1)");
                    if (!sellAllButton) {
                        throw new Error("Sell button not found");
                    }
                    sellAllButton.click();
                    await sleep(1000);
                    window.Engine.shop.basket.finalize();
                    await sleep(1000);
                }
                
                // Buy potions if needed
                const targetPotions = window.MargonemAPI.state.exping_location?.targetPotions || 0;
                if (targetPotions > 0) {
                    const currentPotionCount = typeof policzLeczyPrzedmioty === 'function' ? policzLeczyPrzedmioty() : 0;
                    const potionsToBuy = Math.max(0, targetPotions - currentPotionCount);
                    
                    if (potionsToBuy > 0) {
                        const maxHealth = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
                        const bestPotionId = wybierzIdNajlepszejPotki(maxHealth);
                        const potionData = window.Engine.shop.items?.[bestPotionId];
                        
                        if (bestPotionId && potionData?._cachedStats?.leczy !== undefined) {
                            const potionPrice = potionData?.pr || 0;
                            const playerGold = window.Engine.hero.d.gold || 0;
                            const maxAffordable = potionPrice > 0 ? Math.max(0, Math.floor(playerGold / potionPrice) - 1) : 45;
                            const buyAmount = Math.min(potionsToBuy, maxAffordable, 45);
                            
                            for (let i = 0; i < buyAmount; i++) {
                                await buyItem(bestPotionId);
                                await sleep(1000);
                            }
                            
                            window.Engine.shop.basket.finalize();
                            await sleep(1000);
                        }
                    }
                }
                
                window.Engine.shop.close();
                await waitForElementToDisappear("div.border-window.window-on-peak");
                
                await this.navigateToLocation("Kwieciste Przejście");
                await this.waitForMapChange("Kwieciste Przejście");
                
                window.Engine.hero.autoGoTo({ x: 20, y: 20 }, false);
                await waitForPosition(20, 20, 60000);
                
                return true;
            } catch (error) {
                console.error("[Exping] Error in tuniaSelling:", error);
                return false;
            }
        },
        
        /**
         * Sell at non-Tunia location
         */
        notTuniaSelling: async function(targetX, targetY, shopSelector, shopWindowSelector, sellButtonSelector) {
            window.Engine.hero.autoGoTo({ x: targetX, y: targetY }, false);
            await waitForPosition(targetX, targetY, 60000);
            
            window.Engine.hero.talkNearMob();
            await waitForElement(shopSelector);
            
            const shopElement = document.querySelector(shopSelector);
            if (!shopElement) {
                throw new Error("Shop element not found");
            }
            
            shopElement.click();
            await waitForElement(shopWindowSelector);
            await sleep(1000);
            
            for (let i = 0; i < 7; i++) {
                const sellButton = document.querySelector(sellButtonSelector);
                if (!sellButton) {
                    throw new Error("Sell button not found");
                }
                sellButton.click();
                await sleep(1000);
                window.Engine.shop.basket.finalize();
                await sleep(1000);
            }
            
            window.Engine.shop.close();
        },
        
        /**
         * Buy potions at healer
         */
        buyPotionsAtHealer: async function(targetPotionCount) {
            const currentLocation = window.MargonemAPI.navigation.getCurrentLocation();
            if (!currentLocation) {
                return false;
            }
            
            const POTION_SELLERS = window.MargonemAPI.potions?.getPotionSellers?.() || [
                { name: "Uzdrowicielka Emanilia", map: "Liściaste Rozstaje", x: 21, y: 51 },
                { name: "Szalony Etrefan", map: "Eder", x: 56, y: 40 }
            ];
            
            const debugEnabled = window.MargonemAPI.state.exping_location?.potionsDebug;
            
            // Find closest seller
            let closestSeller = null;
            try {
                const sellerDistances = await Promise.all(POTION_SELLERS.map(async seller => {
                    try {
                        const pathResult = await window.MargonemAPI.navigation.findShortestPath(currentLocation, seller.map);
                        return { seller, distance: pathResult?.distance ?? Infinity };
                    } catch (err) {
                        return { seller, distance: Infinity };
                    }
                }));
                
                closestSeller = sellerDistances.reduce(
                    (closest, current) => current.distance < closest.distance ? current : closest,
                    { distance: Infinity }
                ).seller;
            } catch (err) {}
            
            if (!closestSeller) {
                closestSeller = POTION_SELLERS[0];
            }
            
            if (debugEnabled) {
                console.log("[Exping] Selected healer:", closestSeller?.name, "map:", closestSeller?.map);
            }
            
            this.checkAborted();
            await this.navigateToLocation(closestSeller.map);
            this.checkAborted();
            await this.waitForMapChange(closestSeller.map);
            this.checkAborted();
            
            window.Engine.hero.autoGoTo({ x: closestSeller.x, y: closestSeller.y }, false);
            await waitForPosition(closestSeller.x, closestSeller.y, 60000);
            this.checkAborted();
            
            window.Engine.hero.talkNearMob();
            await sleep(1000);
            
            const dialogueWindow = await Promise.race([
                waitForElement("div.dialogue-window.is-open"),
                sleep(8000).then(() => null)
            ]);
            
            if (!dialogueWindow) {
                return false;
            }
            this.checkAborted();
            
            const dialogueOptions = Array.from(document.querySelectorAll("li.dialogue-window-answer.answer"));
            const shopOption = dialogueOptions.find(opt => opt.classList.contains("line_shop")) ||
                dialogueOptions.find(opt => {
                    const text = (opt.textContent || "").toLowerCase();
                    return text.includes("sklep") || text.includes("handel") || text.includes("kup");
                });
            
            if (!shopOption) {
                return false;
            }
            
            const shopButton = shopOption.querySelector("span") || shopOption;
            shopButton.click();
            
            const shopWindow = await Promise.race([
                waitForElement("div.border-window.window-on-peak"),
                sleep(8000).then(() => null)
            ]);
            
            if (!shopWindow) {
                return false;
            }
            
            await sleep(1000);
            await this.buingPots(targetPotionCount);
            return true;
        },
        
        /**
         * Buy potions helper
         */
        buingPots: async function(targetPotionCount) {
            const maxHealth = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
            await sleep(1000);
            
            const bestPotionId = wybierzIdNajlepszejPotki(maxHealth);
            const potionData = window.Engine.shop.items?.[bestPotionId];
            
            if (!bestPotionId || !potionData?._cachedStats?.leczy) {
                window.Engine.shop.close();
                return;
            }
            
            const targetPotions = targetPotionCount || window.MargonemAPI.state.exping_location?.targetPotions || 0;
            const currentPotionCount = typeof policzLeczyPrzedmioty === 'function' ? policzLeczyPrzedmioty() : 0;
            const potionsToBuy = Math.max(0, targetPotions - currentPotionCount);
            const potionPrice = potionData?.pr || 0;
            const playerGold = window.Engine.hero.d.gold || 0;
            const maxAffordable = potionPrice > 0 ? Math.max(0, Math.floor(playerGold / potionPrice) - 1) : 45;
            const buyAmount = targetPotions > 0 
                ? Math.min(potionsToBuy, maxAffordable, 45) 
                : (window.MargonemAPI.znajdzIloscPotkow?.(bestPotionId) || 0);
            
            for (let i = 0; i < (buyAmount || 0); i++) {
                await buyItem(bestPotionId);
                await sleep(1000);
            }
            
            window.Engine.shop.basket.finalize();
            await sleep(1000);
            this.checkAborted();
            window.Engine.shop.close();
        }
    };
    
    // Assign to MargonemAPI
    window.MargonemAPI.exping = window.MargonemAPI.exping || {};
    Object.assign(window.MargonemAPI.exping, exping);
    
    console.log('[Exping] ✅ Exping module loaded');
})();
