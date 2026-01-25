/**
 * MargoSzpont NI - State Module
 * Globalny stan bota
 * 
 * Zależności: brak (pierwszy moduł do załadowania)
 */

(function() {
    'use strict';
    
    // Inicjalizacja globalnego obiektu API
    window.MargonemAPI = window.MargonemAPI || {};
    
    // Konfiguracja serwera (do obejścia licencji dla lokalnego użytku)
    window.serverUrl = 'http://localhost';
    window.sessionToken = 'local-bypass';
    
    // Stan globalny bota
    window.MargonemAPI.state = window.MargonemAPI.state || {
        // === OGÓLNY STAN ===
        bag: null,
        is_exping: false,
        map_cleaned: false,
        isDead: false,
        deathCheckInterval: null,
        lastDeathTime: null,
        autoFightActive: false,
        autoFightInProgress: false,
        selectedNicks: [],
        allMobs: [],
        npcs: [],
        handlingBackEvent: false,
        lastMapName: null,
        fightEndTime: null,
        blockedMobs: new Map(),
        lastAttemptedMobs: [],
        attackedMobs: new Set(),
        MAX_ATTEMPTS_MEMORY: 3,
        currentTargetId: null,
        pendingStopActions: new Set(),
        activeIntervals: new Set(),
        activeTimeouts: new Set(),
        
        // === STAN NAWIGACJI ===
        navigation: {
            currentPath: null,
            currentPathIndex: 0,
            isNavigating: false,
            targetLocation: null,
            lastKnownLocation: null,
            pathCheckInterval: null,
            locationData: {},
            navigationTimeout: 1200000,
            lastMoveTime: null,
            stuckCheckInterval: 5000,
            abortNavigation: false,
            autoFight: null
        },
        
        // === STAN LECZENIA ===
        heal: {
            active: false,
            healAfterDeath: true,
            healToFull: false,
            minHealHpPercent: 80,
            minPotionHealing: 0,
            rarity: ["L", "Ul", "H", "U", "P"],
            notify: false,
            hpNumDisplay: false,
            ignoredItems: [],
            usePotions: true,
            useFulls: true,
            usePercents: true,
            isMonitoring: false,
            monitoringInterval: null
        },
        
        // === STAN PATHFINDINGU ===
        pathfinding: {
            lastPosition: null,
            noMovementCount: 0,
            longNoMovementCount: 0,
            checkInterval: 1000,
            targetPosition: null,
            pathStartTime: null,
            stuckThreshold: 1000,
            longStuckThreshold: 15,
            isCurrentlyChecking: false,
            lastMovementTime: null
        },
        
        // === TIMERY ===
        timers: {
            fight: null,
            update: null,
            pathCheck: null
        },
        
        // === STAN EXPINGU ===
        exping_location: {
            master_map: null,
            current_location_index: 0,
            current_expowisko: null,
            current_expowisko_name: null,
            is_aborted: null,
            interval_of_selling: true,
            bag_full: null,
            teleport_if_player: null,
            death_cam: null,
            potion_checker: null,
            blockPotions: null,
            last_map_clean_time: null,
            respawn_wait_time: 3000000,
            bag_check: null,
            visitedMapsHistory: {},
            selectedMaps: null,
            targetPotions: 0,
            requestedPotions: 0,
            potionsMultiplier: 1,
            potionsDebug: false,
            _potionRefillInProgress: false,
            sublocation_data: {
                mapped: false,
                connections: new Map(),
                optimal_path: [],
                visited: new Set()
            },
            iteration: {
                count: 0,
                visited_maps: new Set(),
                visited_gateways: new Set(),
                path: [],
                completed: false
            },
            movement: {
                in_progress: false,
                target: null,
                start_time: null,
                timeout: 300000
            }
        }
    };
    
    // === FUNKCJE POMOCNICZE POZYCJI ===
    window.MargonemAPI.getServerPosition = function() {
        const engine = window.Engine;
        if (!engine || !engine.hero) {
            return null;
        }
        const hero = engine.hero;
        return {
            x: hero.lastServerX !== undefined ? hero.lastServerX : hero.d.x,
            y: hero.lastServerY !== undefined ? hero.lastServerY : hero.d.y
        };
    };
    
    // === MONITOR POZYCJI BOHATERA ===
    window.MargonemAPI.heroPositionMonitor = window.MargonemAPI.heroPositionMonitor || {
        isInitialized: false,
        originalAfterUpdate: null,
        backDetected: false,
        lastBackTime: 0,
        
        init: function() {
            if (this.isInitialized) {
                return;
            }
            if (typeof Engine !== 'undefined' && Engine && Engine.hero && Engine.hero.afterUpdate) {
                this.originalAfterUpdate = Engine.hero.afterUpdate;
                const self = this;
                Engine.hero.afterUpdate = function(serverData, newPosition, additionalData) {
                    const isBackDetected = serverData.back === 1 || 
                        (newPosition.x !== Engine.hero.lastServerX || newPosition.y !== Engine.hero.lastServerY) && 
                        Engine.lock.check() && 
                        Engine.stepsToSend.steps.length > 0;
                    
                    if (isBackDetected) {
                        self.onBackDetected(
                            Engine.hero.lastServerX || serverData.x, 
                            Engine.hero.lastServerY || serverData.y
                        );
                    }
                    return self.originalAfterUpdate.call(Engine.hero, serverData, newPosition, additionalData);
                };
                console.log("[MargonemAPI] Position monitor initialized");
                this.isInitialized = true;
            }
        },
        
        onBackDetected: function(serverX, serverY) {
            this.backDetected = true;
            this.lastBackTime = Date.now();
            const engine = window.Engine;
            if (engine && engine.hero) {
                console.log("[MargonemAPI] Back detected! Server position: " + serverX + "," + serverY + 
                    " vs Local position: " + engine.hero.d.x + "," + engine.hero.d.y);
            } else {
                console.log("[MargonemAPI] Back detected! Server position: " + serverX + "," + serverY);
            }
            if (window.MargonemAPI.combat && window.MargonemAPI.combat.handleBackEvent) {
                window.MargonemAPI.combat.handleBackEvent(serverX, serverY);
            }
        }
    };
    
    // === DEBUG ===
    window.MargonemAPI.debug = window.MargonemAPI.debug || {
        getPositionStatus: function() {
            const engine = window.Engine;
            if (!engine || !engine.hero) {
                return "Engine or hero not available";
            }
            const localX = Math.floor(parseFloat(engine.hero.d.x || 0));
            const localY = Math.floor(parseFloat(engine.hero.d.y || 0));
            const serverX = Math.floor(parseFloat(engine.hero.lastServerX || engine.hero.d.x || 0));
            const serverY = Math.floor(parseFloat(engine.hero.lastServerY || engine.hero.d.y || 0));
            
            return {
                localPosition: { x: localX, y: localY },
                serverPosition: { x: serverX, y: serverY },
                synced: localX === serverX && localY === serverY,
                lastBackTime: window.MargonemAPI.heroPositionMonitor.lastBackTime,
                timeSinceLastBack: Date.now() - window.MargonemAPI.heroPositionMonitor.lastBackTime,
                backDetected: window.MargonemAPI.heroPositionMonitor.backDetected
            };
        }
    };
    
    console.log('[State] ✅ State module loaded');
})();
