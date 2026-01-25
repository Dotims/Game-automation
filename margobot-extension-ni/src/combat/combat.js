/**
 * MargoSzpont NI - Combat Module
 * System walki automatycznej
 * 
 * Zależności:
 * - window.MargonemAPI.state (state.js)
 * - window.MargonemAPI.heroPositionMonitor (state.js)
 * - window.MargonemAPI.getServerPosition (state.js)
 * - window.MargonemAPI.pathfinding (pathfinding.js)
 * - window.MargonemAPI.navigation (movement.js)
 * - window.Engine (Margonem API)
 */

(function() {
    'use strict';
    
    // Upewnij się że MargonemAPI istnieje
    window.MargonemAPI = window.MargonemAPI || {};
    
    // Moduł walki
    window.MargonemAPI.combat = window.MargonemAPI.combat || {};
    
    Object.assign(window.MargonemAPI.combat, {
        _asyncLocks: {},
        _lockTimeouts: {},
        _activeSession: null,
        stopRequested: false,
        
        async _acquireLock(lockKey, lockTimeout = 10000) {
            if (this._asyncLocks[lockKey]) {
                return false;
            }
            this._asyncLocks[lockKey] = true;
            this._lockTimeouts[lockKey] = setTimeout(() => {
                console.warn("Force releasing lock: " + lockKey + " due to timeout");
                this._releaseLock(lockKey);
            }, lockTimeout);
            return true;
        },
        
        _releaseLock(lockKeyRelease) {
            this._asyncLocks[lockKeyRelease] = false;
            if (this._lockTimeouts[lockKeyRelease]) {
                clearTimeout(this._lockTimeouts[lockKeyRelease]);
                delete this._lockTimeouts[lockKeyRelease];
            }
        },
        
        startFight: async function(targetOptions, durationSeconds = 0) {
            if (!window.sessionToken) {
                return { success: false, error: "SESSION_TOKEN_MISSING" };
            }
            if (!(await this._acquireLock("startFight", 15000))) {
                return { success: false, error: "ALREADY_STARTING" };
            }
            
            this._activeSession = Date.now().toString() + Math.random().toString(36).substring(2, 9);
            const fightSessionId = this._activeSession;
            
            try {
                window.MargonemAPI.combat.stopRequested = false;
                const combatState = window.MargonemAPI.state;
                
                if (!combatState.timers.combatIntervals) {
                    combatState.timers.combatIntervals = new Set();
                }
                if (!combatState.timers.autoFightTimeouts) {
                    combatState.timers.autoFightTimeouts = new Set();
                }
                
                combatState.blockedMobs.clear();
                combatState.lastAttemptedMobs = [];
                combatState.currentTargetId = null;
                combatState.autoFightInProgress = false;
                combatState.map_cleaned = false;
                combatState.levelRange = { min: null, max: null };
                
                if (typeof targetOptions === "object" && targetOptions.levelRange) {
                    combatState.levelRange = {
                        min: targetOptions.levelRange.min || null,
                        max: targetOptions.levelRange.max || null
                    };
                    combatState.selectedNicks = [];
                } else {
                    combatState.selectedNicks = Array.isArray(targetOptions) ? targetOptions : [targetOptions];
                }
                
                combatState.autoFightActive = true;
                
                try {
                    await Promise.race([
                        window.MargonemAPI.combat.recoverySystem.startMonitoring(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("RECOVERY_SYSTEM_TIMEOUT")), 5000))
                    ]);
                } catch (recoveryError) {
                    console.error("Error starting monitoring system:", recoveryError);
                }
                
                if (durationSeconds > 0) {
                    combatState.fightEndTime = Date.now() + durationSeconds * 1000;
                    combatState.timers.fight = setTimeout(() => {
                        if (combatState.autoFightActive && this._activeSession === fightSessionId) {
                            window.MargonemAPI.combat.stopFight();
                        }
                    }, durationSeconds * 1000);
                }
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (combatState.autoFightActive && this._activeSession === fightSessionId) {
                    window.MargonemAPI.combat.autoFight(fightSessionId);
                }
                
                return { success: true, sessionId: fightSessionId };
            } catch (error) {
                console.error("Error in startFight:", error);
                return { success: false, error: error.message || "UNKNOWN_ERROR", details: error.stack };
            } finally {
                this._releaseLock("startFight");
            }
        },
        
        stopFight: function() {
            const apiState = window.MargonemAPI.state;
            const previousSession = this._activeSession;
            this._activeSession = null;
            window.MargonemAPI.combat.stopRequested = true;
            
            apiState.autoFightActive = false;
            apiState.autoFightInProgress = false;
            apiState.selectedNicks = [];
            apiState.lastAttemptedMobs = [];
            apiState.currentTargetId = null;
            apiState.blockedMobs.clear();
            apiState.map_cleaned = false;
            apiState.levelRange = { min: null, max: null };
            
            window.MargonemAPI.combat.recoverySystem.stopMonitoring();
            
            if (apiState.timers.fight) {
                clearTimeout(apiState.timers.fight);
                apiState.timers.fight = null;
            }
            if (apiState.timers.update) {
                clearInterval(apiState.timers.update);
                apiState.timers.update = null;
            }
            if (apiState.timers.autoFightTimeouts) {
                apiState.timers.autoFightTimeouts.forEach(id => clearTimeout(id));
                apiState.timers.autoFightTimeouts.clear();
            }
            if (apiState.timers.combatIntervals) {
                apiState.timers.combatIntervals.forEach(id => clearInterval(id));
                apiState.timers.combatIntervals.clear();
            }
            if (apiState.pendingStopActions) {
                apiState.pendingStopActions.clear();
            }
            if (apiState.activeIntervals) {
                apiState.activeIntervals.forEach(id => clearInterval(id));
                apiState.activeIntervals.clear();
            }
            if (apiState.activeTimeouts) {
                apiState.activeTimeouts.forEach(id => clearTimeout(id));
                apiState.activeTimeouts.clear();
            }
            
            Object.keys(this._asyncLocks).forEach(lockKey => {
                this._releaseLock(lockKey);
            });
            
            if (window.MargonemAPI.navigation) {
                window.MargonemAPI.navigation.stopNavigation(false);
            }
            
            const engine = window.Engine;
            if (engine && engine.hero) {
                try {
                    const heroX = Math.floor(engine.hero.x || engine.hero.d?.x || 0);
                    const heroY = Math.floor(engine.hero.y || engine.hero.d?.y || 0);
                    if (!isNaN(heroX) && !isNaN(heroY)) {
                        engine.hero.autoGoTo({ x: heroX, y: heroY });
                    }
                } catch (error) {
                    console.error("Error stopping hero movement:", error);
                }
            }
            
            return { success: true, stoppedSession: previousSession };
        },
        
        isMobBlocked: function(mobId) {
            return window.MargonemAPI.state.blockedMobs.has(mobId);
        },
        
        clearBlockedMobs: function() {
            const state = window.MargonemAPI.state;
            state.blockedMobs.clear();
            state.lastAttemptedMobs = [];
        },
        
        autoFight: async function(sessionId) {
            if (this._activeSession !== sessionId) {
                return { success: false, error: "SESSION_MISMATCH" };
            }
            
            const apiState = window.MargonemAPI.state;
            
            if (apiState.handlingBackEvent) {
                setTimeout(() => {
                    if (apiState.autoFightActive && this._activeSession === sessionId && !this.stopRequested) {
                        this.autoFight(sessionId);
                    }
                }, 50);
                return { success: false, error: "HANDLING_BACK_EVENT" };
            }
            
            const timeSinceBackEvent = Date.now() - (window.MargonemAPI.heroPositionMonitor.lastBackTime || 0);
            if (timeSinceBackEvent < 300) {
                setTimeout(() => {
                    if (apiState.autoFightActive && this._activeSession === sessionId && !this.stopRequested) {
                        this.autoFight(sessionId);
                    }
                }, 300 - timeSinceBackEvent);
                return { success: false, error: "RECENT_BACK_EVENT" };
            }
            
            if (!(await this._acquireLock("autoFight", 8000))) {
                return { success: false, error: "FIGHT_IN_PROGRESS" };
            }
            
            if (this.stopRequested) {
                this._releaseLock("autoFight");
                return { success: false, error: "STOP_REQUESTED" };
            }
            
            try {
                if (apiState.autoFightInProgress) {
                    return { success: false, error: "ALREADY_FIGHTING" };
                }
                if (!apiState.autoFightActive) {
                    return { success: false, error: "AUTOFIGHT_INACTIVE" };
                }
                
                apiState.autoFightInProgress = true;
                const engine = window.Engine;
                
                if (!engine) {
                    if (apiState.autoFightActive && this._activeSession === sessionId) {
                        let retryTimeoutId = setTimeout(() => {
                            if (apiState.autoFightActive && !this.stopRequested && this._activeSession === sessionId) {
                                this.autoFight(sessionId);
                            }
                        }, 5000);
                        apiState.timers.autoFightTimeouts.add(retryTimeoutId);
                    }
                    return { success: false, error: "ENGINE_NOT_READY" };
                } else if (!apiState.allMobs.length) {
                    apiState.map_cleaned = true;
                    return { success: true, status: "MAP_CLEANED" };
                }
                
                let nearestMob;
                try {
                    nearestMob = await Promise.race([
                        new Promise(resolve => {
                            resolve(window.MargonemAPI.combat.findNearestMob());
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("FIND_MOB_TIMEOUT")), 3000))
                    ]);
                } catch (findError) {
                    console.error("Error finding nearest mob:", findError);
                    if (apiState.autoFightActive && this._activeSession === sessionId) {
                        let retryTimeoutId = setTimeout(() => {
                            if (apiState.autoFightActive && !this.stopRequested && this._activeSession === sessionId) {
                                this.autoFight(sessionId);
                            }
                        }, 2000);
                        apiState.timers.autoFightTimeouts.add(retryTimeoutId);
                    }
                    return { success: false, error: findError.message || "FIND_MOB_ERROR" };
                }
                
                if (nearestMob) {
                    try {
                        await Promise.race([
                            this.goFightMob(nearestMob.id, nearestMob.x, nearestMob.y, sessionId),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("GO_FIGHT_MOB_TIMEOUT")), 10000))
                        ]);
                        
                        if (!apiState.autoFightActive || this._activeSession !== sessionId) {
                            return;
                        }
                        this.recoverySystem.updateLastActionTime();
                    } catch (fightError) {
                        console.error("Error in goFightMob:", fightError);
                        if (fightError.message.includes("TIMEOUT")) {
                            apiState.blockedMobs.add(nearestMob.id);
                        }
                        if (apiState.autoFightActive && this._activeSession === sessionId) {
                            let retryTimeoutId = setTimeout(() => {
                                if (apiState.autoFightActive && !this.stopRequested && this._activeSession === sessionId) {
                                    this.autoFight(sessionId);
                                }
                            }, 2000);
                            apiState.timers.autoFightTimeouts.add(retryTimeoutId);
                        }
                    }
                } else if (apiState.autoFightActive && this._activeSession === sessionId) {
                    let noMobTimeoutId = setTimeout(() => {
                        if (apiState.autoFightActive && !this.stopRequested && this._activeSession === sessionId) {
                            this.autoFight(sessionId);
                        }
                    }, 2000);
                    apiState.timers.autoFightTimeouts.add(noMobTimeoutId);
                }
                
                return { success: true };
            } catch (unexpectedError) {
                console.error("Unexpected error in autoFight:", unexpectedError);
                return { success: false, error: unexpectedError.message || "UNEXPECTED_ERROR", details: unexpectedError.stack };
            } finally {
                apiState.autoFightInProgress = false;
                this._releaseLock("autoFight");
            }
        },
        
        handleBackEvent: function(eventData, eventType) {
            if (!this._activeSession) {
                return;
            }
            const apiState = window.MargonemAPI.state;
            
            Object.keys(this._asyncLocks).forEach(lockKey => {
                if (lockKey.startsWith("goFightMob")) {
                    this._releaseLock(lockKey);
                }
            });
            
            if (apiState.timers.combatIntervals) {
                apiState.timers.combatIntervals.forEach(id => clearInterval(id));
                apiState.timers.combatIntervals.clear();
            }
            
            apiState.handlingBackEvent = true;
            this.recoverySystem.updateLastActionTime();
            
            const currentSession = this._activeSession;
            setTimeout(() => {
                apiState.handlingBackEvent = false;
                if (apiState.autoFightActive && this._activeSession === currentSession && !this.stopRequested) {
                    this.autoFight(currentSession);
                }
            }, 50);
        },
        
        clickInterface: async function(selector, verifications = [], defaultTimeout = 3000, elementName = "button") {
            const element = document.querySelector(selector);
            if (!element) {
                console.warn(elementName + " not found: " + selector);
                return { success: false, error: "ELEMENT_NOT_FOUND" };
            }
            
            try {
                element.click();
                console.log("Clicked " + elementName + ": " + selector);
                
                if (verifications.length > 0) {
                    for (const verification of verifications) {
                        const startTime = Date.now();
                        let verified = false;
                        
                        while (Date.now() - startTime < (verification.timeoutMs || defaultTimeout)) {
                            const verifyElement = document.querySelector(verification.selector);
                            if ((verifyElement !== null) === verification.shouldExist) {
                                verified = true;
                                break;
                            }
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                        
                        if (!verified) {
                            return {
                                success: false,
                                error: "CLICK_VERIFICATION_FAILED",
                                details: "Expected element " + verification.selector + " to " + (verification.shouldExist ? "exist" : "not exist")
                            };
                        }
                    }
                }
                
                return { success: true };
            } catch (clickError) {
                console.error("Error clicking " + elementName + ":", clickError);
                return { success: false, error: "CLICK_ERROR", details: clickError.message };
            }
        },
        
        goFightMob: async function(mobId, mobX, mobY, sessionId) {
            const apiState = window.MargonemAPI.state;
            const engine = window.Engine;
            const lockKey = "goFightMob_" + mobId;
            
            if (!engine || !engine.hero) {
                return { success: false, error: "ENGINE_NOT_READY" };
            }
            if (apiState.handlingBackEvent) {
                return { success: false, error: "HANDLING_BACK_EVENT" };
            }
            if (!(await this._acquireLock(lockKey, 8000))) {
                return { success: false, error: "MOB_MOVEMENT_IN_PROGRESS" };
            }
            
            try {
                mobX = parseFloat(mobX);
                mobY = parseFloat(mobY);
                if (isNaN(mobX) || isNaN(mobY)) {
                    return { success: false, error: "INVALID_COORDINATES" };
                }
                
                if (!window.MargonemAPI.heroPositionMonitor.isInitialized) {
                    window.MargonemAPI.heroPositionMonitor.init();
                }
                window.MargonemAPI.heroPositionMonitor.backDetected = false;
                
                engine.hero.autoGoTo({ x: mobX, y: mobY }, false);
                apiState.currentTargetId = mobId;
                
                return new Promise((resolve, reject) => {
                    const checkInterval = setInterval(async () => {
                        if (window.MargonemAPI.heroPositionMonitor.backDetected) {
                            clearInterval(checkInterval);
                            apiState.timers.combatIntervals.delete(checkInterval);
                            reject(new Error("BACK_DETECTED"));
                            return;
                        }
                        
                        if (!apiState.autoFightActive || this.stopRequested || this._activeSession !== sessionId) {
                            clearInterval(checkInterval);
                            apiState.timers.combatIntervals.delete(checkInterval);
                            reject(new Error("SESSION_CANCELLED"));
                            return;
                        }
                        
                        const hero = engine.hero;
                        if (!hero) {
                            reject(new Error("HERO_NOT_FOUND"));
                            return;
                        }
                        
                        try {
                            const heroX = Math.floor(parseFloat(hero.x || hero.d?.x || 0));
                            const heroY = Math.floor(parseFloat(hero.y || hero.d?.y || 0));
                            
                            if (isNaN(heroX) || isNaN(heroY)) {
                                console.warn("Invalid hero coordinates");
                                return;
                            }
                            
                            const distX = Math.abs(heroX - Math.floor(mobX));
                            const distY = Math.abs(heroY - Math.floor(mobY));
                            
                            if (distX <= 1 && distY <= 1) {
                                clearInterval(checkInterval);
                                apiState.timers.combatIntervals.delete(checkInterval);
                                
                                if (engine.interface && typeof engine.interface.clickAutofightNearMob === "function") {
                                    if (!apiState.autoFightActive || this._activeSession !== sessionId) {
                                        reject(new Error("SESSION_CANCELLED"));
                                        return;
                                    }
                                    
                                    if (typeof window.lastClickAutofightTime === "undefined") {
                                        window.lastClickAutofightTime = 0;
                                    }
                                    
                                    const currentTime = Date.now();
                                    if (currentTime - window.lastClickAutofightTime >= 1000) {
                                        window.lastClickAutofightTime = currentTime;
                                        
                                        try {
                                            await Promise.race([
                                                new Promise(resolveClick => {
                                                    engine.interface.clickAutofightNearMob();
                                                    resolveClick();
                                                }),
                                                new Promise((_, rejectTimeout) => setTimeout(() => rejectTimeout(new Error("CLICK_TIMEOUT")), 2000))
                                            ]);
                                            
                                            this.recoverySystem.updateLastActionTime();
                                            
                                            setTimeout(async () => {
                                                if (!apiState.autoFightActive || this._activeSession !== sessionId) {
                                                    return;
                                                }
                                                
                                                await this.clickInterface(
                                                    "div.button.green.close-battle-ground.small",
                                                    [{ selector: "div.button.green.close-battle-ground.small", shouldExist: false }],
                                                    300, "close battle button"
                                                );
                                                
                                                if (!apiState.autoFightActive || this._activeSession !== sessionId) {
                                                    return;
                                                }
                                                
                                                await this.clickInterface(
                                                    ".accept-button .button.green.small",
                                                    [{ selector: ".accept-button", shouldExist: false }],
                                                    300, "accept button"
                                                );
                                                
                                                if (apiState.autoFightActive && !apiState.autoFightInProgress && this._activeSession === sessionId) {
                                                    this.autoFight(sessionId);
                                                }
                                            }, 100);
                                            
                                            resolve({ success: true });
                                        } catch (fightSequenceError) {
                                            console.error("Error in fight sequence:", fightSequenceError);
                                            if (apiState.autoFightActive && !apiState.autoFightInProgress && this._activeSession === sessionId) {
                                                setTimeout(() => {
                                                    if (apiState.autoFightActive && this._activeSession === sessionId) {
                                                        this.autoFight(sessionId);
                                                    }
                                                }, 500);
                                            }
                                            resolve({ success: false, error: fightSequenceError.message });
                                        }
                                    } else {
                                        console.warn("Click throttled, waiting");
                                        setTimeout(() => {
                                            if (apiState.autoFightActive && this._activeSession === sessionId) {
                                                this.autoFight(sessionId);
                                            }
                                        }, 500);
                                        resolve({ success: false, error: "CLICK_THROTTLED" });
                                    }
                                } else {
                                    if (apiState.autoFightActive && !apiState.autoFightInProgress && this._activeSession === sessionId) {
                                        setTimeout(() => {
                                            if (apiState.autoFightActive && this._activeSession === sessionId) {
                                                this.autoFight(sessionId);
                                            }
                                        }, 500);
                                    }
                                    resolve({ success: false, error: "INTERFACE_NOT_READY" });
                                }
                            }
                        } catch (movementError) {
                            console.error("Error in movement check:", movementError);
                        }
                    }, 250);
                    
                    apiState.timers.combatIntervals.add(checkInterval);
                });
            } catch (error) {
                console.error("Error in goFightMob:", error);
                if (error.message === "BACK_DETECTED") {
                    const currentSession = this._activeSession;
                    setTimeout(() => {
                        if (apiState.autoFightActive && this._activeSession === currentSession && !this.stopRequested) {
                            this.autoFight(currentSession);
                        }
                    }, 50);
                }
                return { success: false, error: error.message || "UNEXPECTED_ERROR", details: error.stack };
            } finally {
                this._releaseLock(lockKey);
            }
        },
        
        findNearestMob: function() {
            try {
                if (!window.MargonemAPI.heroPositionMonitor.isInitialized) {
                    window.MargonemAPI.heroPositionMonitor.init();
                }
                
                const apiState = window.MargonemAPI.state;
                const engine = window.Engine;
                
                if (!engine?.hero) {
                    return null;
                }
                
                window.MargonemAPI.pathfinding.initializeCollisionGrid();
                
                const serverPosition = window.MargonemAPI.getServerPosition();
                const heroX = Math.floor(serverPosition?.x || engine.hero.lastServerX || engine.hero.d.x || 0);
                const heroY = Math.floor(serverPosition?.y || engine.hero.lastServerY || engine.hero.d.y || 0);
                
                if (isNaN(heroX) || isNaN(heroY)) {
                    console.error("Invalid hero position:", { heroX, heroY });
                    return null;
                }
                
                const validMobs = apiState.allMobs.filter(mob => {
                    const isBlocked = apiState.blockedMobs.has(mob.id);
                    const hasLevelRange = apiState.levelRange.min !== null || apiState.levelRange.max !== null;
                    let isValid = false;
                    
                    if (hasLevelRange) {
                        const minLevel = apiState.levelRange.min || 1;
                        const maxLevel = apiState.levelRange.max || 300;
                        isValid = mob.lvl >= minLevel && mob.lvl <= maxLevel;
                    } else {
                        isValid = apiState.selectedNicks.includes(mob.nick);
                    }
                    
                    return isValid && !isBlocked;
                });
                
                if (validMobs.length === 0) {
                    apiState.map_cleaned = true;
                    return null;
                }
                
                let nearestMob = null;
                let shortestPathLength = Infinity;
                
                const sortedMobs = [...validMobs].sort((a, b) => {
                    const distA = Math.abs(a.x - heroX) + Math.abs(a.y - heroY);
                    const distB = Math.abs(b.x - heroX) + Math.abs(b.y - heroY);
                    return distA - distB;
                });
                
                const candidateMobs = sortedMobs.slice(0, 10);
                
                for (const mob of candidateMobs) {
                    const manhattanDist = Math.abs(mob.x - heroX) + Math.abs(mob.y - heroY);
                    if (manhattanDist >= shortestPathLength) {
                        continue;
                    }
                    
                    let path = null;
                    try {
                        path = window.MargonemAPI.pathfinding.findPathWithBackHandling(
                            heroX, heroY, Math.floor(mob.x), Math.floor(mob.y)
                        );
                    } catch (pathError) {
                        console.error("Pathfinding error:", pathError);
                        continue;
                    }
                    
                    if (!path || path.length === 0) {
                        continue;
                    }
                    
                    const pathLength = path.length - 1;
                    if (pathLength < shortestPathLength) {
                        shortestPathLength = pathLength;
                        nearestMob = mob;
                    }
                }
                
                if (!nearestMob) {
                    apiState.map_cleaned = true;
                    return null;
                }
                
                return nearestMob;
            } catch (error) {
                console.error("Error in findNearestMob:", error);
                return null;
            }
        },
        
        // === RECOVERY SYSTEM ===
        recoverySystem: {
            config: {
                checkInterval: 1000,
                activityTimeout: 3000,
                maxRetries: 3,
                retryDelay: 300,
                networkTimeout: 3000
            },
            state: {
                lastActionTime: null,
                retryCount: 0,
                recoveryActive: false,
                checkIntervalId: null,
                alertIntervalId: null,
                monitoringActive: false,
                networkQuality: "good"
            },
            _asyncLocks: {},
            stopRequested: false,
            
            async _acquireLock(lockKey, lockTimeout = 5000) {
                if (this._asyncLocks[lockKey]) {
                    return false;
                }
                this._asyncLocks[lockKey] = {
                    acquired: true,
                    time: Date.now(),
                    timeout: setTimeout(() => {
                        console.warn("Force releasing recovery lock: " + lockKey + " due to timeout");
                        this._releaseLock(lockKey);
                    }, lockTimeout)
                };
                return true;
            },
            
            _releaseLock(lockKey) {
                if (this._asyncLocks[lockKey]) {
                    if (this._asyncLocks[lockKey].timeout) {
                        clearTimeout(this._asyncLocks[lockKey].timeout);
                    }
                    delete this._asyncLocks[lockKey];
                }
            },
            
            getNetworkAdjustedTimeout(baseTimeout) {
                const multipliers = { good: 1, medium: 1.5, poor: 2.5 };
                return baseTimeout * multipliers[this.state.networkQuality];
            },
            
            startMonitoring: async function() {
                if (!(await this._acquireLock("startMonitoring", 10000))) {
                    return { success: false, error: "ALREADY_STARTING_MONITORING" };
                }
                if (window.MargonemAPI.combat.stopRequested) {
                    this._releaseLock("startMonitoring");
                    return { success: false, error: "STOP_REQUESTED" };
                }
                if (!window.MargonemAPI.state.autoFightActive) {
                    this._releaseLock("startMonitoring");
                    return { success: false, error: "AUTOFIGHT_INACTIVE" };
                }
                
                try {
                    this.state.lastActionTime = Date.now();
                    this.state.retryCount = 0;
                    this.state.recoveryActive = false;
                    this.state.monitoringActive = true;
                    
                    if (this.stopRequested) {
                        return { success: false, error: "STOP_REQUESTED" };
                    }
                    
                    if (this.state.checkIntervalId) {
                        clearInterval(this.state.checkIntervalId);
                    }
                    if (this.state.alertIntervalId) {
                        clearInterval(this.state.alertIntervalId);
                    }
                    
                    this.state.alertIntervalId = setInterval(async () => {
                        if (!this.state.monitoringActive || this.stopRequested) {
                            return;
                        }
                        try {
                            const autoFightBtn = document.querySelector("div.button.green.auto-fight-btn.small");
                            if (autoFightBtn) {
                                await window.MargonemAPI.combat.clickInterface(
                                    "div.button.green.auto-fight-btn.small", [], 2000, "auto fight button"
                                );
                            }
                        } catch (clickError) {
                            console.error("Error clicking auto-fight button:", clickError);
                        }
                    }, 1000);
                    
                    this.state.checkIntervalId = setInterval(async () => {
                        if (!this.state.monitoringActive || this.stopRequested) {
                            return;
                        }
                        try {
                            await this.checkState();
                        } catch (checkError) {
                            console.error("Error in checkState:", checkError);
                        }
                    }, this.config.checkInterval);
                    
                    return { success: true };
                } catch (error) {
                    console.error("Error starting monitoring:", error);
                    return { success: false, error: error.message || "MONITORING_ERROR", details: error.stack };
                } finally {
                    this._releaseLock("startMonitoring");
                }
            },
            
            stopMonitoring: function() {
                try {
                    if (this.state.checkIntervalId) {
                        clearInterval(this.state.checkIntervalId);
                        this.state.checkIntervalId = null;
                    }
                    if (this.state.alertIntervalId) {
                        clearInterval(this.state.alertIntervalId);
                        this.state.alertIntervalId = null;
                    }
                    
                    this.state.lastActionTime = null;
                    this.state.retryCount = 0;
                    this.state.recoveryActive = false;
                    this.state.monitoringActive = false;
                    
                    Object.keys(this._asyncLocks).forEach(lockKey => {
                        this._releaseLock(lockKey);
                    });
                    
                    return { success: true };
                } catch (error) {
                    console.error("Error stopping monitoring:", error);
                    return { success: false, error: error.message };
                }
            },
            
            updateLastActionTime: function() {
                if (!this.state.monitoringActive) {
                    return false;
                }
                
                const currentTime = Date.now();
                const timeSinceLastAction = currentTime - (this.state.lastActionTime || 0);
                
                if (timeSinceLastAction > 8000 && this.state.networkQuality !== "poor") {
                    this.state.networkQuality = "poor";
                    console.warn("Network quality set to poor");
                } else if (timeSinceLastAction > 3000 && this.state.networkQuality !== "medium") {
                    this.state.networkQuality = "medium";
                    console.log("Network quality set to medium");
                } else if (timeSinceLastAction < 1000 && this.state.networkQuality !== "good") {
                    this.state.networkQuality = "good";
                    console.log("Network quality set to good");
                }
                
                this.state.lastActionTime = currentTime;
                
                if (this.state.recoveryActive) {
                    this.state.recoveryActive = false;
                    this.state.retryCount = 0;
                }
                
                return true;
            },
            
            async checkState() {
                if (!(await this._acquireLock("checkState", 5000))) {
                    return { success: false, error: "CHECK_IN_PROGRESS" };
                }
                if (window.MargonemAPI.combat.stopRequested) {
                    this._releaseLock("checkState");
                    return { success: false, error: "STOP_REQUESTED" };
                }
                
                try {
                    if (!this.state.monitoringActive) {
                        return { success: false, error: "MONITORING_INACTIVE" };
                    }
                    if (!window.MargonemAPI.state.autoFightActive) {
                        return { success: false, error: "AUTOFIGHT_INACTIVE" };
                    }
                    
                    const timeSinceLastAction = Date.now() - (this.state.lastActionTime || Date.now());
                    const adjustedTimeout = this.getNetworkAdjustedTimeout(this.config.activityTimeout);
                    
                    if (!this.state.recoveryActive && timeSinceLastAction > adjustedTimeout) {
                        return await this.initiateRecovery();
                    }
                    
                    return { success: true, status: "OK" };
                } catch (error) {
                    console.error("Error in checkState:", error);
                    return { success: false, error: error.message || "CHECK_ERROR", details: error.stack };
                } finally {
                    this._releaseLock("checkState");
                }
            },
            
            async initiateRecovery() {
                if (!(await this._acquireLock("initiateRecovery", 10000))) {
                    return { success: false, error: "RECOVERY_IN_PROGRESS" };
                }
                if (window.MargonemAPI.combat.stopRequested) {
                    this._releaseLock("initiateRecovery");
                    return { success: false, error: "STOP_REQUESTED" };
                }
                
                try {
                    if (!this.state.monitoringActive) {
                        return { success: false, error: "MONITORING_INACTIVE" };
                    }
                    
                    const maxRetries = this.config.maxRetries;
                    const retryDelay = this.config.retryDelay;
                    
                    if (this.state.recoveryActive || this.state.retryCount >= maxRetries) {
                        return await this.fullSystemReset();
                    }
                    
                    this.state.recoveryActive = true;
                    this.state.retryCount++;
                    
                    const exponentialDelay = retryDelay * Math.pow(2, this.state.retryCount - 1);
                    console.log("Recovery attempt " + this.state.retryCount + "/" + maxRetries + " with delay " + exponentialDelay + "ms");
                    
                    return await this.executeRecoverySequence(exponentialDelay);
                } catch (error) {
                    console.error("Error in initiateRecovery:", error);
                    return { success: false, error: error.message || "RECOVERY_ERROR", details: error.stack };
                } finally {
                    this._releaseLock("initiateRecovery");
                }
            },
            
            async executeRecoverySequence(delay = this.config.retryDelay) {
                if (window.MargonemAPI.combat.stopRequested) {
                    return { success: false, error: "STOP_REQUESTED" };
                }
                if (!(await this._acquireLock("executeRecoverySequence", 5000))) {
                    return { success: false, error: "RECOVERY_SEQUENCE_IN_PROGRESS" };
                }
                
                try {
                    if (!this.state.monitoringActive || this.stopRequested) {
                        return { success: false, error: "MONITORING_INACTIVE" };
                    }
                    
                    const dialogsPromise = this.closeAllDialogs();
                    window.MargonemAPI.combat.clearBlockedMobs();
                    await dialogsPromise;
                    
                    if (this.state.retryCount === 1) {
                        delay = Math.min(delay, 200);
                    } else {
                        delay = Math.min(delay, 500);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    if (!this.state.monitoringActive || this.stopRequested) {
                        return { success: false, error: "MONITORING_STOPPED_DURING_RECOVERY" };
                    }
                    
                    if (window.MargonemAPI.state.autoFightActive) {
                        if (!this.stopRequested) {
                            const activeSession = window.MargonemAPI.combat._activeSession;
                            if (activeSession) {
                                setTimeout(() => {
                                    window.MargonemAPI.combat.autoFight(activeSession);
                                }, 10);
                            }
                        }
                        this.updateLastActionTime();
                    }
                    
                    return { success: true };
                } catch (error) {
                    console.error("Error in executeRecoverySequence:", error);
                    return { success: false, error: error.message || "RECOVERY_SEQUENCE_ERROR", details: error.stack };
                } finally {
                    this._releaseLock("executeRecoverySequence");
                }
            },
            
            closeAllDialogs: async function() {
                const dialogSelectors = [
                    { selector: "div.button.green.close-battle-ground.small", desc: "close battle" },
                    { selector: ".accept-button .button.green.small", desc: "accept button" },
                    { selector: ".dialog-bottom .button.green", desc: "dialog confirm" },
                    { selector: ".dialog-close", desc: "dialog close" },
                    { selector: ".close-dialog", desc: "close dialog" }
                ];
                
                const closePromises = dialogSelectors.map(dialog => {
                    return window.MargonemAPI.combat.clickInterface(dialog.selector, [], 200, dialog.desc)
                        .catch(error => ({ success: false, error: error.message }));
                });
                
                await Promise.all(closePromises);
                return { success: true };
            },
            
            async fullSystemReset() {
                if (window.MargonemAPI.combat.stopRequested) {
                    return { success: false, error: "STOP_REQUESTED" };
                }
                if (!(await this._acquireLock("fullSystemReset", 30000))) {
                    return { success: false, error: "SYSTEM_RESET_IN_PROGRESS" };
                }
                
                try {
                    if (!this.state.monitoringActive) {
                        return { success: false, error: "MONITORING_INACTIVE" };
                    }
                    
                    console.log("Performing full system reset");
                    
                    const savedLevelRange = {
                        min: window.MargonemAPI.state.levelRange?.min || null,
                        max: window.MargonemAPI.state.levelRange?.max || null
                    };
                    const savedNicks = [...(window.MargonemAPI.state.selectedNicks || [])];
                    
                    window.MargonemAPI.combat.stopFight();
                    
                    this.state.recoveryActive = false;
                    this.state.retryCount = 0;
                    
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    if (!this.state.monitoringActive) {
                        return { success: false, error: "MONITORING_STOPPED_DURING_RESET" };
                    }
                    
                    if (savedLevelRange.min !== null || savedLevelRange.max !== null) {
                        return await window.MargonemAPI.combat.startFight({
                            levelRange: {
                                min: savedLevelRange.min || 1,
                                max: savedLevelRange.max || 300
                            }
                        });
                    } else if (savedNicks.length > 0) {
                        return await window.MargonemAPI.combat.startFight(savedNicks);
                    }
                    
                    return { success: true };
                } catch (error) {
                    console.error("Error in fullSystemReset:", error);
                    return { success: false, error: error.message || "SYSTEM_RESET_ERROR", details: error.stack };
                } finally {
                    this._releaseLock("fullSystemReset");
                }
            }
        }
    });
    
    console.log('[Combat] ✅ Combat module loaded');
})();
