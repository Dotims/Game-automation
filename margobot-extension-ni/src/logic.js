window.serverUrl = 'http://localhost';
let sessionToken = 'local-bypass'; // Bypass for local usage without server
window.MargonemAPI = window.MargonemAPI || {};
Object.assign(window.MargonemAPI, {
  state: {
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
    timers: {
      fight: null,
      update: null,
      pathCheck: null
    },
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
      visitedMapsHistory: {}, // { "MapName": timestamp } - tracks when each map was last visited
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
  },
  getServerPosition: function () {
    const engine = window.Engine;
    if (!engine || !engine.hero) {
      return null;
    }
    const hero = engine.hero;
    return {
      x: hero.lastServerX !== undefined ? hero.lastServerX : hero.d.x,
      y: hero.lastServerY !== undefined ? hero.lastServerY : hero.d.y
    };
  },
  heroPositionMonitor: {
    isInitialized: false,
    originalAfterUpdate: null,
    backDetected: false,
    lastBackTime: 0,
    init: function () {
      if (this.isInitialized) {
        return;
      }
      if (Engine && Engine.hero && Engine.hero.afterUpdate) {
        this.originalAfterUpdate = Engine.hero.afterUpdate;
        Engine.hero.afterUpdate = (serverData, newPosition, additionalData) => {
          const isBackDetected = serverData.back === 1 || (newPosition.x !== Engine.hero.lastServerX || newPosition.y !== Engine.hero.lastServerY) && Engine.lock.check() && Engine.stepsToSend.steps.length > 0;
          if (isBackDetected) {
            this.onBackDetected(Engine.hero.lastServerX || serverData.x, Engine.hero.lastServerY || serverData.y);
          }
          return this.originalAfterUpdate.call(Engine.hero, serverData, newPosition, additionalData);
        };
        // console.log("[MargonemAPI] Position monitor initialized");
        this.isInitialized = true;
      }
    },
    onBackDetected: function (serverX, serverY) {
      this.backDetected = true;
      this.lastBackTime = Date.now();
      const engine = window.Engine;
      if (engine && engine.hero) {
        console.log("[MargonemAPI] Back detected! Server position: " + serverX + "," + serverY + " vs Local position: " + engine.hero.d.x + "," + engine.hero.d.y);
      } else {
        console.log("[MargonemAPI] Back detected! Server position: " + serverX + "," + serverY);
      }
      if (window.MargonemAPI.combat && window.MargonemAPI.combat.handleBackEvent) {
        window.MargonemAPI.combat.handleBackEvent(serverX, serverY);
      }
    }
  },
  debug: {
    getPositionStatus: function () {
      const engine = window.Engine;
      if (!engine || !engine.hero) {
        return "Engine or hero not available";
      }
      const localX = Math.floor(parseFloat(engine.hero.d.x || 0));
      const localY = Math.floor(parseFloat(engine.hero.d.y || 0));
      const serverX = Math.floor(parseFloat(engine.hero.lastServerX || engine.hero.d.x || 0));
      const serverY = Math.floor(parseFloat(engine.hero.lastServerY || engine.hero.d.y || 0));
      const localPosition = {
        x: localX,
        y: localY
      };
      const serverPosition = {
        x: serverX,
        y: serverY
      };
      return {
        localPosition: localPosition,
        serverPosition: serverPosition,
        synced: localX === serverX && localY === serverY,
        lastBackTime: window.MargonemAPI.heroPositionMonitor.lastBackTime,
        timeSinceLastBack: Date.now() - window.MargonemAPI.heroPositionMonitor.lastBackTime,
        backDetected: window.MargonemAPI.heroPositionMonitor.backDetected
      };
    }
  },
  navigation: {
    findShortestPath: function (startLocation, endLocation) {
      const locationData = window.MargonemAPI.state.navigation.locationData;
      startLocation = normalizeLocationName(startLocation);
      endLocation = normalizeLocationName(endLocation);
      if (!mapData[startLocation] || !mapData[endLocation]) {
        return {
          path: [],
          error: "Jedna z lokacji nie istnieje"
        };
      }
      const directConnection = mapData[startLocation].gateways.find(gateway => normalizeLocationName(gateway.name) === endLocation);
      if (directConnection) {
        const gatewayCoords = {
          x: directConnection.x,
          y: directConnection.y
        };
        const pathStep = {
          currentMap: startLocation,
          nextMap: endLocation,
          gateway: gatewayCoords
        };
        const pathArray = [pathStep];
        const result = {
          path: pathArray,
          distance: 1
        };
        return result;
      }
      function isBidirectionalConnection(locationA, locationB) {
        const hasGatewayAtoB = mapData[locationA].gateways.some(gw => normalizeLocationName(gw.name) === locationB);
        const hasGatewayBtoA = mapData[locationB].gateways.some(gw => normalizeLocationName(gw.name) === locationA);
        return hasGatewayAtoB && hasGatewayBtoA;
      }
      function getConnectedLocations(location) {
        return mapData[location].gateways.map(gw => normalizeLocationName(gw.name)).filter(loc => mapData[loc] && isBidirectionalConnection(location, loc));
      }
      function getGatewayCoords(fromLocation, toLocation) {
        const gateway = mapData[fromLocation].gateways.find(gw => normalizeLocationName(gw.name) === toLocation);
        if (gateway) {
          return {
            x: gateway.x,
            y: gateway.y
          };
        } else {
          return null;
        }
      }
      const distances = {};
      const previousNodes = {};
      const unvisitedSet = new Set();
      Object.keys(mapData).forEach(locationName => {
        distances[locationName] = Infinity;
        previousNodes[locationName] = null;
        unvisitedSet.add(locationName);
      });
      distances[startLocation] = 0;
      let iterations = 0;
      const maxIterations = 10000;
      while (unvisitedSet.size > 0 && iterations < maxIterations) {
        iterations++;
        let currentNode = null;
        let minDistance = Infinity;
        for (const node of unvisitedSet) {
          if (distances[node] < minDistance) {
            minDistance = distances[node];
            currentNode = node;
          }
        }
        if (currentNode === null) {
          break;
        }
        if (currentNode === endLocation) {
          break;
        }
        unvisitedSet.delete(currentNode);
        const neighbors = getConnectedLocations(currentNode);
        for (const neighbor of neighbors) {
          if (!unvisitedSet.has(neighbor)) {
            continue;
          }
          const newDistance = distances[currentNode] + 1;
          if (newDistance < distances[neighbor]) {
            distances[neighbor] = newDistance;
            previousNodes[neighbor] = currentNode;
          }
        }
      }
      if (distances[endLocation] === Infinity) {
        return {
          path: [],
          error: "Nie znaleziono ścieżki między lokacjami"
        };
      }
      const pathArray = [];
      let currentLocation = endLocation;
      while (previousNodes[currentLocation] !== null) {
        const previousLocation = previousNodes[currentLocation];
        const gatewayCoords = getGatewayCoords(previousLocation, currentLocation);
        const pathStep = {
          currentMap: previousLocation,
          nextMap: currentLocation,
          gateway: gatewayCoords
        };
        pathArray.unshift(pathStep);
        currentLocation = previousLocation;
      }
      const result = {
        path: pathArray,
        distance: distances[endLocation]
      };
      return result;
    },
    getCurrentLocation: function () {
      const engine = window.Engine;
      if (!engine || !engine.map) {
        return null;
      }
      const mapName = engine.map.d.name || null;
      return mapName;
    },
    goToLocation: async function (targetLocation) {
      if (!sessionToken) {
        return;
      }
      window.MargonemAPI.state.navigation.autoFight = setInterval(() => {
        try {
          window.Engine.battle.autoFight();
        } catch (error) {}
      }, 1000);
      const navState = window.MargonemAPI.state.navigation;
      navState.abortNavigation = false;
      const currentLocation = this.getCurrentLocation();
      if (!currentLocation) {
        return false;
      }
      if (currentLocation === targetLocation) {
        return true;
      }
      const pathResult = this.findShortestPath(currentLocation, targetLocation);
      if (pathResult.error || !pathResult.path.length) {
        return false;
      }
      navState.currentPath = pathResult.path;
      navState.currentPathIndex = 0;
      navState.isNavigating = true;
      navState.targetLocation = targetLocation;
      navState.lastMoveTime = Date.now();
      this.processNextPathStep();
      clearInterval(navState.pathCheckInterval);
      navState.pathCheckInterval = setInterval(() => this.checkNavigationProgress(), 1000);
      return true;
    },
    processNextPathStep: async function () {
      const navState = window.MargonemAPI.state.navigation;
      if (navState.abortNavigation) {
        return;
      }
      const currentStep = navState.currentPath && navState.currentPath[navState.currentPathIndex];
      if (!currentStep || !navState.isNavigating) {
        this.stopNavigation();
        return;
      }
      const gateway = currentStep.gateway;
      if (gateway) {
        const engine = window.Engine;
        if (engine && engine.hero) {
          const heroX = Math.floor(engine.hero.x || engine.hero.d && engine.hero.d.x);
          const heroY = Math.floor(engine.hero.y || engine.hero.d && engine.hero.d.y);
          if (heroX === gateway.x && heroY === gateway.y) {
            engine.hero.getTroughGateway();
          } else if (Math.abs(heroX - gateway.x) <= 1 && Math.abs(heroY - gateway.y) <= 1) {
            engine.hero.talkNearMob();
          }
          const targetCoords = {
            x: gateway.x,
            y: gateway.y
          };
          engine.hero.autoGoTo(targetCoords, false);
          navState.lastMoveTime = Date.now();
        }
      }
    },
    checkNavigationProgress: function () {
      const navState = window.MargonemAPI.state.navigation;
      if (navState.abortNavigation || !navState.isNavigating) {
        return;
      }
      
      // Check if mobs appeared while navigating (especially on red/PvP maps with limited visibility)
      const apiState = window.MargonemAPI.state;
      if (apiState.is_exping && apiState.autoFightActive) {
        try {
          const allMobs = window.MargonemAPI.getAllMobs();
          const hasLevelRange = apiState.levelRange.min !== null || apiState.levelRange.max !== null;
          const validMobs = allMobs.filter(mob => {
            const isBlocked = apiState.blockedMobs.has(mob.id);
            let isValid = false;
            if (hasLevelRange) {
              const minLvl = apiState.levelRange.min || 1;
              const maxLvl = apiState.levelRange.max || 300;
              isValid = mob.lvl >= minLvl && mob.lvl <= maxLvl;
            } else {
              isValid = apiState.selectedNicks.includes(mob.nick);
            }
            return isValid && !isBlocked;
          });
          
          if (validMobs.length > 0) {
            // Mobs found during navigation - stop and fight them
            console.log("[NAV] Mobs appeared during navigation, stopping to fight:", validMobs.length);
            this.stopNavigation(true);
            return;
          }
        } catch (e) {
          console.error("[NAV] Error checking mobs during navigation:", e);
        }
      }
      
      const currentLocation = this.getCurrentLocation();
      const currentStep = navState.currentPath && navState.currentPath[navState.currentPathIndex];
      if (currentStep && currentLocation === currentStep.nextMap) {
        navState.currentPathIndex++;
        if (navState.currentPathIndex >= navState.currentPath.length) {
          this.stopNavigation(true);
          return;
        }
        this.processNextPathStep();
      }
      const timeSinceLastMove = Date.now() - navState.lastMoveTime;
      if (timeSinceLastMove > navState.stuckCheckInterval) {
        this.processNextPathStep();
      }
      if (Date.now() - navState.lastMoveTime > navState.navigationTimeout) {
        this.stopNavigation(false);
      }
    },
    stopNavigation: function (forceStop = false) {
      const navState = window.MargonemAPI.state.navigation;
      navState.abortNavigation = true;
      navState.isNavigating = false;
      navState.currentPath = null;
      navState.currentPathIndex = 0;
      navState.targetLocation = null;
      navState.lastMoveTime = null;
      if (navState.pathCheckInterval) {
        clearInterval(navState.pathCheckInterval);
        navState.pathCheckInterval = null;
      }
      let engineInstance = window.Engine;
      if (engineInstance && engineInstance.hero) {
        const heroX = Math.floor(engineInstance.hero.x || engineInstance.hero.d && engineInstance.hero.d.x);
        const heroY = Math.floor(engineInstance.hero.y || engineInstance.hero.d && engineInstance.hero.d.y);
        const heroPosition = {
          x: heroX,
          y: heroY
        };
        engineInstance.hero.autoGoTo(heroPosition);
      }
      if (forceStop) {
        clearInterval(window.MargonemAPI.state.navigation.autoFight);
      } else {}
    }
  },
  combat: {
    _asyncLocks: {},
    _lockTimeouts: {},
    _activeSession: null,
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
    startFight: async function (targetOptions, durationSeconds = 0) {
      if (!sessionToken) {
        return {
          success: false,
          error: "SESSION_TOKEN_MISSING"
        };
      }
      if (!(await this._acquireLock("startFight", 15000))) {
        return {
          success: false,
          error: "ALREADY_STARTING"
        };
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
        combatState.levelRange = {
          min: null,
          max: null
        };
        if (typeof targetOptions === "object" && targetOptions.levelRange) {
          const levelRangeConfig = {
            min: targetOptions.levelRange.min || null,
            max: targetOptions.levelRange.max || null
          };
          combatState.levelRange = levelRangeConfig;
          combatState.selectedNicks = [];
        } else {
          combatState.selectedNicks = Array.isArray(targetOptions) ? targetOptions : [targetOptions];
        }
        combatState.autoFightActive = true;
        try {
          await Promise.race([window.MargonemAPI.combat.recoverySystem.startMonitoring(), new Promise((resolve, reject) => setTimeout(() => reject(new Error("RECOVERY_SYSTEM_TIMEOUT")), 5000))]);
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
        const successResult = {
          success: true,
          sessionId: fightSessionId
        };
        return successResult;
      } catch (error) {
        console.error("Error in startFight:", error);
        const errorResult = {
          success: false,
          error: error.message || "UNKNOWN_ERROR",
          details: error.stack
        };
        return errorResult;
      } finally {
        this._releaseLock("startFight");
      }
    },
    stopFight: function () {
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
      apiState.levelRange = {
        min: null,
        max: null
      };
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
        apiState.timers.autoFightTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        apiState.timers.autoFightTimeouts.clear();
      }
      if (apiState.timers.combatIntervals) {
        apiState.timers.combatIntervals.forEach(intervalId => clearInterval(intervalId));
        apiState.timers.combatIntervals.clear();
      }
      if (apiState.pendingStopActions) {
        apiState.pendingStopActions.clear();
      }
      if (apiState.activeIntervals) {
        apiState.activeIntervals.forEach(activeIntervalId => clearInterval(activeIntervalId));
        apiState.activeIntervals.clear();
      }
      if (apiState.activeTimeouts) {
        apiState.activeTimeouts.forEach(activeTimeoutId => clearTimeout(activeTimeoutId));
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
          const heroX = Math.floor(engine.hero.x || engine.hero.d && engine.hero.d.x || 0);
          const heroY = Math.floor(engine.hero.y || engine.hero.d && engine.hero.d.y || 0);
          if (!isNaN(heroX) && !isNaN(heroY)) {
            const stopPosition = {
              x: heroX,
              y: heroY
            };
            engine.hero.autoGoTo(stopPosition);
          }
        } catch (error) {
          console.error("Error stopping hero movement:", error);
        }
      }
      const result = {
        success: true,
        stoppedSession: previousSession
      };
      return result;
    },
    isMobBlocked: function (mobId) {
      return window.MargonemAPI.state.blockedMobs.has(mobId);
    },
    clearBlockedMobs: function () {
      const state = window.MargonemAPI.state;
      state.blockedMobs.clear();
      state.lastAttemptedMobs = [];
    },
    autoFight: async function (sessionId) {
      if (this._activeSession !== sessionId) {
        return {
          success: false,
          error: "SESSION_MISMATCH"
        };
      }
      const apiState = window.MargonemAPI.state;
      if (apiState.handlingBackEvent) {
        setTimeout(() => {
          if (apiState.autoFightActive && this._activeSession === sessionId && !this.stopRequested) {
            this.autoFight(sessionId);
          }
        }, 50);
        return {
          success: false,
          error: "HANDLING_BACK_EVENT"
        };
      }
      const timeSinceBackEvent = Date.now() - (window.MargonemAPI.heroPositionMonitor.lastBackTime || 0);
      if (timeSinceBackEvent < 300) {
        setTimeout(() => {
          if (apiState.autoFightActive && this._activeSession === sessionId && !this.stopRequested) {
            this.autoFight(sessionId);
          }
        }, 300 - timeSinceBackEvent);
        return {
          success: false,
          error: "RECENT_BACK_EVENT"
        };
      }
      if (!(await this._acquireLock("autoFight", 8000))) {
        return {
          success: false,
          error: "FIGHT_IN_PROGRESS"
        };
      }
      if (this.stopRequested) {
        this._releaseLock("autoFight");
        return {
          success: false,
          error: "STOP_REQUESTED"
        };
      }
      try {
        if (apiState.autoFightInProgress) {
          return {
            success: false,
            error: "ALREADY_FIGHTING"
          };
        }
        if (!apiState.autoFightActive) {
          return {
            success: false,
            error: "AUTOFIGHT_INACTIVE"
          };
        }
        apiState.autoFightInProgress = true;
        const engine = window.Engine;
        if (!engine) {
          if (apiState.autoFightActive && this._activeSession === sessionId) {
            let retryTimeoutId = setTimeout(() => {
              if (apiState.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === sessionId) {
                window.MargonemAPI.combat.autoFight(sessionId);
              }
            }, 5000);
            apiState.timers.autoFightTimeouts.add(retryTimeoutId);
          }
          return {
            success: false,
            error: "ENGINE_NOT_READY"
          };
        } else if (!apiState.allMobs.length) {
          apiState.map_cleaned = true;
          return {
            success: true,
            status: "MAP_CLEANED"
          };
        }
        let nearestMob;
        try {
          const findMobPromise = Promise.race([new Promise(resolve => {
            nearestMob = window.MargonemAPI.combat.findNearestMob();
            resolve(nearestMob);
          }), new Promise((resolve, reject) => setTimeout(() => reject(new Error("FIND_MOB_TIMEOUT")), 3000))]);
          nearestMob = await findMobPromise;
        } catch (findError) {
          console.error("Error finding nearest mob:", findError);
          if (apiState.autoFightActive && this._activeSession === sessionId) {
            let retryTimeoutId = setTimeout(() => {
              if (apiState.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === sessionId) {
                window.MargonemAPI.combat.autoFight(sessionId);
              }
            }, 2000);
            apiState.timers.autoFightTimeouts.add(retryTimeoutId);
          }
          const errorResult = {
            success: false,
            error: findError.message || "FIND_MOB_ERROR"
          };
          return errorResult;
        }
        if (nearestMob) {
          try {
            await Promise.race([window.MargonemAPI.combat.goFightMob(nearestMob.id, nearestMob.x, nearestMob.y, sessionId), new Promise((resolve, reject) => setTimeout(() => reject(new Error("GO_FIGHT_MOB_TIMEOUT")), 10000))]);
            if (!apiState.autoFightActive || this._activeSession !== sessionId) {
              return;
            }
            window.MargonemAPI.combat.recoverySystem.updateLastActionTime();
          } catch (fightError) {
            console.error("Error in goFightMob:", fightError);
            if (fightError.message.includes("TIMEOUT")) {
              apiState.blockedMobs.add(nearestMob.id);
            }
            if (apiState.autoFightActive && this._activeSession === sessionId) {
              let retryTimeoutId = setTimeout(() => {
                if (apiState.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === sessionId) {
                  window.MargonemAPI.combat.autoFight(sessionId);
                }
              }, 2000);
              apiState.timers.autoFightTimeouts.add(retryTimeoutId);
            }
          }
        } else if (apiState.autoFightActive && this._activeSession === sessionId) {
          let noMobTimeoutId = setTimeout(() => {
            if (apiState.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === sessionId) {
              window.MargonemAPI.combat.autoFight(sessionId);
            }
          }, 2000);
          apiState.timers.autoFightTimeouts.add(noMobTimeoutId);
        }
        return {
          success: true
        };
      } catch (unexpectedError) {
        console.error("Unexpected error in autoFight:", unexpectedError);
        const errorResult = {
          success: false,
          error: unexpectedError.message || "UNEXPECTED_ERROR",
          details: unexpectedError.stack
        };
        return errorResult;
      } finally {
        apiState.autoFightInProgress = false;
        this._releaseLock("autoFight");
      }
    },
    handleBackEvent: function (eventData, eventType) {
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
        apiState.timers.combatIntervals.forEach(intervalId => {
          clearInterval(intervalId);
        });
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
    clickInterface: async function (selector, verifications = [], defaultTimeout = 3000, elementName = "button") {
      const element = document.querySelector(selector);
      if (!element) {
        console.warn(elementName + " not found: " + selector);
        return {
          success: false,
          error: "ELEMENT_NOT_FOUND"
        };
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
              if (verifyElement !== null === verification.shouldExist) {
                verified = true;
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (!verified) {
              const verifyError = {
                success: false,
                error: "CLICK_VERIFICATION_FAILED",
                details: "Expected element " + verification.selector + " to " + (verification.shouldExist ? "exist" : "not exist")
              };
              return verifyError;
            }
          }
        }
        return {
          success: true
        };
      } catch (clickError) {
        console.error("Error clicking " + elementName + ":", clickError);
        const errorResult = {
          success: false,
          error: "CLICK_ERROR",
          details: clickError.message
        };
        return errorResult;
      }
    },
    goFightMob: async function (mobId, mobX, mobY, sessionId) {
      const apiState = window.MargonemAPI.state;
      const engine = window.Engine;
      const lockKey = "goFightMob_" + mobId;
      if (!engine || !engine.hero) {
        return {
          success: false,
          error: "ENGINE_NOT_READY"
        };
      }
      if (apiState.handlingBackEvent) {
        return {
          success: false,
          error: "HANDLING_BACK_EVENT"
        };
      }
      if (!(await this._acquireLock(lockKey, 8000))) {
        return {
          success: false,
          error: "MOB_MOVEMENT_IN_PROGRESS"
        };
      }
      try {
        mobX = parseFloat(mobX);
        mobY = parseFloat(mobY);
        if (isNaN(mobX) || isNaN(mobY)) {
          return {
            success: false,
            error: "INVALID_COORDINATES"
          };
        }
        if (!window.MargonemAPI.heroPositionMonitor.isInitialized) {
          window.MargonemAPI.heroPositionMonitor.init();
        }
        window.MargonemAPI.heroPositionMonitor.backDetected = false;
        const targetPosition = {
          x: mobX,
          y: mobY
        };
        engine.hero.autoGoTo(targetPosition, false);
        apiState.currentTargetId = mobId;
        return new Promise((resolve, reject) => {
          const checkInterval = setInterval(async () => {
            if (window.MargonemAPI.heroPositionMonitor.backDetected) {
              clearInterval(checkInterval);
              apiState.timers.combatIntervals.delete(checkInterval);
              reject(new Error("BACK_DETECTED"));
              return;
            }
            if (!apiState.autoFightActive || window.MargonemAPI.combat.stopRequested || this._activeSession !== sessionId) {
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
              const heroX = Math.floor(parseFloat(hero.x || hero.d && hero.d.x || 0));
              const heroY = Math.floor(parseFloat(hero.y || hero.d && hero.d.y || 0));
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
                      await Promise.race([new Promise(resolveClick => {
                        engine.interface.clickAutofightNearMob();
                        resolveClick();
                      }), new Promise((resolveTimeout, rejectTimeout) => setTimeout(() => rejectTimeout(new Error("CLICK_TIMEOUT")), 2000))]);
                      window.MargonemAPI.combat.recoverySystem.updateLastActionTime();
                      setTimeout(async () => {
                        if (!apiState.autoFightActive || this._activeSession !== sessionId) {
                          return;
                        }
                        const closeBattleResult = await window.MargonemAPI.combat.clickInterface("div.button.green.close-battle-ground.small", [{
                          selector: "div.button.green.close-battle-ground.small",
                          shouldExist: false
                        }], 300, "close battle button");
                        if (!apiState.autoFightActive || this._activeSession !== sessionId) {
                          return;
                        }
                        const acceptResult = await window.MargonemAPI.combat.clickInterface(".accept-button .button.green.small", [{
                          selector: ".accept-button",
                          shouldExist: false
                        }], 300, "accept button");
                        if (apiState.autoFightActive && !apiState.autoFightInProgress && this._activeSession === sessionId) {
                          window.MargonemAPI.combat.autoFight(sessionId);
                        }
                      }, 100);
                      resolve({
                        success: true
                      });
                    } catch (fightSequenceError) {
                      console.error("Error in fight sequence:", fightSequenceError);
                      if (apiState.autoFightActive && !apiState.autoFightInProgress && this._activeSession === sessionId) {
                        setTimeout(() => {
                          if (apiState.autoFightActive && this._activeSession === sessionId) {
                            window.MargonemAPI.combat.autoFight(sessionId);
                          }
                        }, 500);
                      }
                      const errorResult = {
                        success: false,
                        error: fightSequenceError.message
                      };
                      resolve(errorResult);
                    }
                  } else {
                    console.warn("Click throttled, waiting");
                    setTimeout(() => {
                      if (apiState.autoFightActive && this._activeSession === sessionId) {
                        window.MargonemAPI.combat.autoFight(sessionId);
                      }
                    }, 500);
                    resolve({
                      success: false,
                      error: "CLICK_THROTTLED"
                    });
                  }
                } else {
                  if (apiState.autoFightActive && !apiState.autoFightInProgress && this._activeSession === sessionId) {
                    setTimeout(() => {
                      if (apiState.autoFightActive && this._activeSession === sessionId) {
                        window.MargonemAPI.combat.autoFight(sessionId);
                      }
                    }, 500);
                  }
                  resolve({
                    success: false,
                    error: "INTERFACE_NOT_READY"
                  });
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
        const errorResult = {
          success: false,
          error: error.message || "UNEXPECTED_ERROR",
          details: error.stack
        };
        return errorResult;
      } finally {
        this._releaseLock(lockKey);
      }
    },
    findNearestMob: function () {
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
        const heroLevel = engine.hero.lvl || engine.hero.d && engine.hero.d.lvl || 1;
        if (isNaN(heroX) || isNaN(heroY)) {
          const positionLog = {
            heroX: heroX,
            heroY: heroY
          };
          console.error("Invalid hero position:", positionLog);
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
        const sortedMobs = [...validMobs].sort((mobA, mobB) => {
          const distA = Math.abs(mobA.x - heroX) + Math.abs(mobA.y - heroY);
          const distB = Math.abs(mobB.x - heroX) + Math.abs(mobB.y - heroY);
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
            path = window.MargonemAPI.pathfinding.findPathWithBackHandling(heroX, heroY, Math.floor(mob.x), Math.floor(mob.y));
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
        console.error("Error in enhanced findNearestMob:", error);
        const fallbackState = window.MargonemAPI.state;
        const fallbackEngine = window.Engine;
        if (!fallbackEngine?.hero) {
          return null;
        }
        try {
          window.MargonemAPI.pathfinding.initializeCollisionGrid();
          const heroX = Math.floor(fallbackEngine.hero.x || fallbackEngine.hero.d && fallbackEngine.hero.d.x || 0);
          const heroY = Math.floor(fallbackEngine.hero.y || fallbackEngine.hero.d && fallbackEngine.hero.d.y || 0);
          const heroLevel = fallbackEngine.hero.lvl || fallbackEngine.hero.d && fallbackEngine.hero.d.lvl || 1;
          if (isNaN(heroX) || isNaN(heroY)) {
            const positionLog = {
              heroX: heroX,
              heroY: heroY
            };
            console.error("Invalid hero position:", positionLog);
            return null;
          }
          const validMobs = fallbackState.allMobs.filter(mob => {
            const isBlocked = fallbackState.blockedMobs.has(mob.id);
            const hasLevelRange = fallbackState.levelRange.min !== null || fallbackState.levelRange.max !== null;
            let isValid = false;
            if (hasLevelRange) {
              const minLevel = fallbackState.levelRange.min || 1;
              const maxLevel = fallbackState.levelRange.max || 300;
              isValid = mob.lvl >= minLevel && mob.lvl <= maxLevel;
            } else {
              isValid = fallbackState.selectedNicks.includes(mob.nick);
            }
            return isValid && !isBlocked;
          });
          if (validMobs.length === 0) {
            fallbackState.map_cleaned = true;
            return null;
          }
          let nearestMob = null;
          let shortestPathLength = Infinity;
          const sortedMobs = [...validMobs].sort((mobA, mobB) => {
            const distA = Math.abs(mobA.x - heroX) + Math.abs(mobA.y - heroY);
            const distB = Math.abs(mobB.x - heroX) + Math.abs(mobB.y - heroY);
            return distA - distB;
          });
          const candidateMobs = sortedMobs.slice(0, 10);
          for (const mob of candidateMobs) {
            const manhattanDist = Math.abs(mob.x - heroX) + Math.abs(mob.y - heroY);
            if (manhattanDist >= shortestPathLength) {
              continue;
            }
            let pathFound = false;
            let path = null;
            try {
              pathFound = true;
              path = window.MargonemAPI.pathfinding.findPath(heroX, heroY, Math.floor(mob.x), Math.floor(mob.y));
            } catch (pathError) {
              console.error("Pathfinding error:", pathError);
              pathFound = false;
            }
            if (!pathFound || !path || path.length === 0) {
              continue;
            }
            const pathLength = path.length - 1;
            if (pathLength < shortestPathLength) {
              shortestPathLength = pathLength;
              nearestMob = mob;
            }
          }
          if (!nearestMob) {
            fallbackState.map_cleaned = true;
            return null;
          }
          return nearestMob;
        } catch (fallbackError) {
          console.error("Fallback error in findNearestMob:", fallbackError);
          return null;
        }
      }
    },
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
        const multipliers = {
          good: 1,
          medium: 1.5,
          poor: 2.5
        };
        return baseTimeout * multipliers[this.state.networkQuality];
      },
      startMonitoring: async function () {
        if (!(await this._acquireLock("startMonitoring", 10000))) {
          return {
            success: false,
            error: "ALREADY_STARTING_MONITORING"
          };
        }
        if (window.MargonemAPI.combat.stopRequested) {
          this._releaseLock("startMonitoring");
          return {
            success: false,
            error: "STOP_REQUESTED"
          };
        }
        if (!window.MargonemAPI.state.autoFightActive) {
          this._releaseLock("startMonitoring");
          return {
            success: false,
            error: "AUTOFIGHT_INACTIVE"
          };
        }
        try {
          this.state.lastActionTime = Date.now();
          this.state.retryCount = 0;
          this.state.recoveryActive = false;
          this.state.monitoringActive = true;
          if (this.stopRequested) {
            return {
              success: false,
              error: "STOP_REQUESTED"
            };
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
                await window.MargonemAPI.combat.clickInterface("div.button.green.auto-fight-btn.small", [], 2000, "auto fight button");
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
          return {
            success: true
          };
        } catch (error) {
          console.error("Error starting monitoring:", error);
          const errorResult = {
            success: false,
            error: error.message || "MONITORING_ERROR",
            details: error.stack
          };
          return errorResult;
        } finally {
          this._releaseLock("startMonitoring");
        }
      },
      stopMonitoring: function () {
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
          return {
            success: true
          };
        } catch (error) {
          console.error("Error stopping monitoring:", error);
          const errorResult = {
            success: false,
            error: error.message
          };
          return errorResult;
        }
      },
      updateLastActionTime: function () {
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
          return {
            success: false,
            error: "CHECK_IN_PROGRESS"
          };
        }
        if (window.MargonemAPI.combat.stopRequested) {
          this._releaseLock("checkState");
          return {
            success: false,
            error: "STOP_REQUESTED"
          };
        }
        try {
          if (!this.state.monitoringActive) {
            return {
              success: false,
              error: "MONITORING_INACTIVE"
            };
          }
          if (!window.MargonemAPI.state.autoFightActive) {
            return {
              success: false,
              error: "AUTOFIGHT_INACTIVE"
            };
          }
          const timeSinceLastAction = Date.now() - (this.state.lastActionTime || Date.now());
          const adjustedTimeout = this.getNetworkAdjustedTimeout(this.config.activityTimeout);
          if (!this.state.recoveryActive && timeSinceLastAction > adjustedTimeout) {
            return await this.initiateRecovery();
          }
          return {
            success: true,
            status: "OK"
          };
        } catch (error) {
          console.error("Error in checkState:", error);
          const errorResult = {
            success: false,
            error: error.message || "CHECK_ERROR",
            details: error.stack
          };
          return errorResult;
        } finally {
          this._releaseLock("checkState");
        }
      },
      async initiateRecovery() {
        if (!(await this._acquireLock("initiateRecovery", 10000))) {
          return {
            success: false,
            error: "RECOVERY_IN_PROGRESS"
          };
        }
        if (window.MargonemAPI.combat.stopRequested) {
          this._releaseLock("initiateRecovery");
          return {
            success: false,
            error: "STOP_REQUESTED"
          };
        }
        try {
          if (!this.state.monitoringActive) {
            return {
              success: false,
              error: "MONITORING_INACTIVE"
            };
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
          const errorResult = {
            success: false,
            error: error.message || "RECOVERY_ERROR",
            details: error.stack
          };
          return errorResult;
        } finally {
          this._releaseLock("initiateRecovery");
        }
      },
      async executeRecoverySequence(delay = this.config.retryDelay) {
        if (window.MargonemAPI.combat.stopRequested) {
          return {
            success: false,
            error: "STOP_REQUESTED"
          };
        }
        if (!(await this._acquireLock("executeRecoverySequence", 5000))) {
          return {
            success: false,
            error: "RECOVERY_SEQUENCE_IN_PROGRESS"
          };
        }
        try {
          if (!this.state.monitoringActive || this.stopRequested) {
            return {
              success: false,
              error: "MONITORING_INACTIVE"
            };
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
            return {
              success: false,
              error: "MONITORING_STOPPED_DURING_RECOVERY"
            };
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
          return {
            success: true
          };
        } catch (error) {
          console.error("Error in executeRecoverySequence:", error);
          const errorResult = {
            success: false,
            error: error.message || "RECOVERY_SEQUENCE_ERROR",
            details: error.stack
          };
          return errorResult;
        } finally {
          this._releaseLock("executeRecoverySequence");
        }
      },
      closeAllDialogs: async function () {
        const dialogSelectors = [{
          selector: "div.button.green.close-battle-ground.small",
          desc: "close battle"
        }, {
          selector: ".accept-button .button.green.small",
          desc: "accept button"
        }, {
          selector: ".dialog-bottom .button.green",
          desc: "dialog confirm"
        }, {
          selector: ".dialog-close",
          desc: "dialog close"
        }, {
          selector: ".close-dialog",
          desc: "close dialog"
        }];
        const closePromises = dialogSelectors.map(dialog => {
          return window.MargonemAPI.combat.clickInterface(dialog.selector, [], 200, dialog.desc).catch(error => ({
            success: false,
            error: error.message
          }));
        });
        await Promise.all(closePromises);
        return {
          success: true
        };
      },
      async fullSystemReset() {
        if (window.MargonemAPI.combat.stopRequested) {
          return {
            success: false,
            error: "STOP_REQUESTED"
          };
        }
        if (!(await this._acquireLock("fullSystemReset", 30000))) {
          return {
            success: false,
            error: "SYSTEM_RESET_IN_PROGRESS"
          };
        }
        try {
          if (!this.state.monitoringActive) {
            return {
              success: false,
              error: "MONITORING_INACTIVE"
            };
          }
          console.log("Performing full system reset");
          const savedLevelRange = {
            min: window.MargonemAPI.state.levelRange.min || null,
            max: window.MargonemAPI.state.levelRange.max || null
          };
          const levelRangeConfig = savedLevelRange;
          const savedNicks = [...window.MargonemAPI.state.selectedNicks];
          window.MargonemAPI.combat.stopFight();
          this.state.recoveryActive = false;
          this.state.retryCount = 0;
          await new Promise(resolve => setTimeout(resolve, 5000));
          if (!this.state.monitoringActive) {
            return {
              success: false,
              error: "MONITORING_STOPPED_DURING_RESET"
            };
          }
          if (levelRangeConfig.min !== null || levelRangeConfig.max !== null) {
            const restoreLevelRange = {
              min: levelRangeConfig.min || 1,
              max: levelRangeConfig.max || 300
            };
            const fightOptions = {
              levelRange: restoreLevelRange
            };
            return await window.MargonemAPI.combat.startFight(fightOptions);
          } else if (savedNicks.length > 0) {
            return await window.MargonemAPI.combat.startFight(savedNicks);
          }
          return {
            success: true
          };
        } catch (error) {
          console.error("Error in fullSystemReset:", error);
          const errorResult = {
            success: false,
            error: error.message || "SYSTEM_RESET_ERROR",
            details: error.stack
          };
          return errorResult;
        } finally {
          this._releaseLock("fullSystemReset");
        }
      }
    }
  },
  healingSystem: {
    init() {
      this.ensureInterval();
      this.initializeDeathMonitoring();
    },
    initializeDeathMonitoring() {
      const checkInterval = setInterval(() => {
        const engine = window.Engine;
        if (engine?.dead !== undefined) {
          clearInterval(checkInterval);
          let isDead = engine.dead;
          Object.defineProperty(engine, "dead", {
            get() {
              return isDead;
            },
            set(newValue) {
              const wasRevived = isDead && !newValue;
              isDead = newValue;
              if (wasRevived && window.MargonemAPI.state.heal.healAfterDeath) {
                setTimeout(() => {
                  window.MargonemAPI.healingSystem.checkAndHeal();
                }, 300);
              }
            },
            configurable: true
          });
        }
      }, 100);
    },
    ensureInterval() {
      const healState = window.MargonemAPI.state.heal;
      if (healState.monitoringInterval) {
        clearInterval(healState.monitoringInterval);
        healState.monitoringInterval = null;
      }
      healState.monitoringInterval = setInterval(() => {
        this.checkAndHeal();
      }, 1500);
      healState.isMonitoring = true;
    },
    startMonitoring() {
      const healState = window.MargonemAPI.state.heal;
      if (!healState.isMonitoring) {
        this.ensureInterval();
      }
      healState.active = true;
    },
    stopMonitoring() {
      const healState = window.MargonemAPI.state.heal;
      healState.active = false;
      healState.isMonitoring = false;
      if (healState.monitoringInterval) {
        clearInterval(healState.monitoringInterval);
        healState.monitoringInterval = null;
      }
    },
    checkAndHeal() {
      const healState = window.MargonemAPI.state.heal;
      if (!healState.active || window.MargonemAPI.state.isDead) {
        return;
      }
      const engine = window.Engine;
      if (!engine?.hero?.d) {
        return;
      }
      const currentHp = engine.hero.d.warrior_stats?.hp || 0;
      const maxHp = engine.hero.d.warrior_stats?.maxhp || 1;
      if (currentHp >= maxHp) {
        return;
      }
      const selectedItem = this.pickItem(currentHp, maxHp);
      if (selectedItem) {
        this.useItem(selectedItem);
        if (healState.notify) {
          window.message("[AutoHeal] Used: " + selectedItem.name);
        }
      }
    },
    pickItem(currentHp, maxHp) {
      const healState = window.MargonemAPI.state.heal;
      const allItems = window.Engine?.items?.fetchLocationItems("g") || [];
      let validItems = allItems.filter(item => {
        const itemName = item.name?.toLowerCase() || "";
        const isIgnored = healState.ignoredItems.some(ignoredName => ignoredName.toLowerCase() === itemName);
        if (isIgnored) {
          return false;
        }
        const itemRarity = item._cachedStats?.rarity;
        let rarityCode = "P";
        switch (itemRarity) {
          case "legendary":
            rarityCode = "L";
            break;
          case "upgraded":
            rarityCode = "Ul";
            break;
          case "heroic":
            rarityCode = "H";
            break;
          case "unique":
            rarityCode = "U";
            break;
          case "common":
            rarityCode = "P";
            break;
        }
        if (!healState.rarity.includes(rarityCode)) {
          return false;
        }
        return true;
      });
      const potionItems = healState.usePotions ? validItems.filter(item => item._cachedStats?.leczy && parseInt(item._cachedStats.leczy) >= healState.minPotionHealing) : [];
      const fullHealItems = healState.useFulls ? validItems.filter(item => item._cachedStats?.fullheal) : [];
      const percentHealItems = healState.usePercents ? validItems.filter(item => item._cachedStats?.perheal) : [];
      const hpMissing = maxHp - currentHp;
      const efficientPotions = potionItems.filter(item => parseInt(item._cachedStats.leczy) <= hpMissing);
      let selectedItem;
      if (efficientPotions.length > 0) {
        selectedItem = efficientPotions.reduce((best, current) => {
          const bestHealing = parseInt(best._cachedStats.leczy);
          const currentHealing = parseInt(current._cachedStats.leczy);
          if (currentHealing < bestHealing) {
            return current;
          } else {
            return best;
          }
        });
      } else if (fullHealItems.length > 0) {
        selectedItem = fullHealItems.reduce((best, current) => {
          const bestValue = parseInt(best._cachedStats.fullheal || "999999");
          const currentValue = parseInt(current._cachedStats.fullheal || "999999");
          if (currentValue < bestValue) {
            return current;
          } else {
            return best;
          }
        });
      } else if (percentHealItems.length > 0) {
        selectedItem = percentHealItems.reduce((best, current) => {
          const bestPercent = parseInt(best._cachedStats.perheal);
          const currentPercent = parseInt(current._cachedStats.perheal);
          if (currentPercent > bestPercent) {
            return current;
          } else {
            return best;
          }
        });
      } else if (healState.healToFull && currentHp / maxHp * 100 < healState.minHealHpPercent && potionItems.length > 0) {
        selectedItem = potionItems.reduce((best, current) => {
          const bestHealing = parseInt(best._cachedStats.leczy);
          const currentHealing = parseInt(current._cachedStats.leczy);
          if (currentHealing < bestHealing) {
            return current;
          } else {
            return best;
          }
        });
      }
      return selectedItem;
    },
    useItem(item) {
      if (!item || !item.id) {
        return;
      }
      const command = "moveitem&st=1&id=" + item.id;
      window._g(command, () => {
        setTimeout(() => this.checkAndHeal(), 300);
      });
    }
  },
  exping: {
    checkAborted: function () {
      if (window.MargonemAPI.state.exping_location.is_aborted) {
        throw new Error("");
      }
    },
    /**
     * Wybiera następną najlepszą mapę do odwiedzenia.
     * Priorytet: mapy nieodwiedzone > mapy najdawniej odwiedzone
     * @param {Array} availableMaps - Lista dostępnych map
     * @returns {string|null} - Nazwa następnej mapy lub null
     */
    getNextBestMap: function (availableMaps) {
      if (!availableMaps || availableMaps.length === 0) return null;
      
      const history = window.MargonemAPI.state.exping_location.visitedMapsHistory || {};
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
     * Rejestruje odwiedzenie mapy
     * @param {string} mapName - Nazwa mapy
     */
    recordMapVisit: function (mapName) {
      if (!mapName) return;
      window.MargonemAPI.state.exping_location.visitedMapsHistory[mapName] = Date.now();
    },
    startExping: async function (minLevel, maxLevel, expZoneName, sellWhenFull = false, teleportIfPlayer = false, potionCount = 0, selectedMaps = null) {
      window.MargonemAPI.state.exping_location.is_aborted = false;
      window.MargonemAPI.state.exping_location.selectedMaps = selectedMaps;
      const potionsMultiplier = window.MargonemAPI.state.exping_location.potionsMultiplier || 1;
      window.MargonemAPI.state.exping_location.requestedPotions = potionCount;
      window.MargonemAPI.state.exping_location.targetPotions = Math.max(0, (potionCount || 0) * (potionsMultiplier || 1));
      window.MargonemAPI.state.exping_location.blockPotions = true;
      if (!sessionToken) {
        return;
      }
      const fingerprint = localStorage.getItem("tm_fingerprint");
      try {
        const requestBody = {
          sessionToken: sessionToken,
          fingerprint: fingerprint
        };
        const validateResponse = { token: sessionToken, success: true };
        /* bypassed fetch
        const validateResponse = await fetchAndDecrypt(serverUrl + "/IQQHJ1QWxdUj0gv", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });
        */
        if (validateResponse.token === sessionToken) {
          if (!validateResponse.success) {
            stopHeartbeat();
            const licenseContent = document.getElementById("tm-license-content");
            if (licenseContent) {
              licenseContent.innerHTML = "<div style='color: red;'>Sesja zakończona lub wystąpił błąd! Sesja została automatycznie zakończona.</div>";
            }
            return;
          }
          try {
            if (window.Engine.hero.d.lvl >= 70) {
              if (sellWhenFull) {
                window.MargonemAPI.state.exping_location.bag_full = setInterval(async () => {
                  if (window.MargonemAPI.state.exping_location.interval_of_selling) {
                    const bags = document.querySelector(".bags-navigation").querySelectorAll(".bag.inventory-item");
                    let allBagsEmpty = true;
                    bags.forEach(bag => {
                      const bagName = bag.getAttribute("data-name");
                      const amountElement = bag.querySelector(".amount");
                      const amount = amountElement ? parseInt(amountElement.textContent) : 0;
                      if (amount > 0 && !bagName.includes("klucze")) {
                        allBagsEmpty = false;
                      }
                    });
                    if (allBagsEmpty) {
                      window.MargonemAPI.healingSystem.interval_of_selling = false;
                      clearInterval(window.MargonemAPI.state.exping_location.bag_full);
                      window.MargonemAPI.exping.stopExping();
                      try {
                        uzyjPrzedmiot("Zwój teleportacji na Kwieciste Przejście");
                        await this.waitForMapChange("Kwieciste Przejście");
                        await this.tuniaSelling();
                        window.MargonemAPI.healingSystem.interval_of_selling = true;
                      } catch (teleportError) {}
                      window.MargonemAPI.state.exping_location.is_aborted = true;
                      await sleep(3000);
                      return this.startExping(minLevel, maxLevel, expZoneName, sellWhenFull, teleportIfPlayer, potionCount);
                    }
                  }
                }, 1000);
              }
              if (potionCount > 0) {
                window.MargonemAPI.state.exping_location.potion_checker = setInterval(async () => {
                  if (!window.MargonemAPI.state.exping_location.interval_of_selling) {
                    return;
                  }
                  if (window.MargonemAPI.state.exping_location.blockPotions) {
                    return;
                  }
                  if (window.MargonemAPI.state.exping_location._potionRefillInProgress) {
                    return;
                  }
                  const currentPotions = policzLeczyPrzedmioty() || 0;
                  const targetPotions = window.MargonemAPI.state.exping_location.targetPotions || potionCount;
                  if (currentPotions >= targetPotions) {
                    return;
                  }
                  if (window.MargonemAPI.state.exping_location.potionsDebug) {
                    console.log("[Potions][CHECK] have=", currentPotions, "target=", targetPotions, "missing=", Math.max(0, targetPotions - currentPotions), "mult=", window.MargonemAPI.state.exping_location.potionsMultiplier || 1);
                  }
                  window.MargonemAPI.state.exping_location._potionRefillInProgress = true;
                  clearInterval(window.MargonemAPI.state.exping_location.potion_checker);
                  window.MargonemAPI.healingSystem.interval_of_selling = false;
                  window.MargonemAPI.exping.stopExping();
                  try {
                    if (window.Engine.hero.d.lvl >= 70) {
                      uzyjPrzedmiot("Zwój teleportacji na Kwieciste Przejście");
                      await this.waitForMapChange("Kwieciste Przejście");
                      await this.tuniaSelling();
                    } else {
                      await this.buyPotionsAtHealer(targetPotions);
                    }
                  } catch (buyError) {}
                  window.MargonemAPI.state.exping_location.is_aborted = true;
                  window.MargonemAPI.healingSystem.interval_of_selling = true;
                  window.MargonemAPI.state.exping_location._potionRefillInProgress = false;
                  await sleep(3000);
                  return this.startExping(minLevel, maxLevel, expZoneName, sellWhenFull, teleportIfPlayer, potionCount);
                }, 1500);
              }
            }
            if (teleportIfPlayer) {
              window.MargonemAPI.state.exping_location.teleport_if_player = setInterval(async () => {
                if (window.MargonemAPI.state.exping_location.interval_of_selling) {
                  if (window.Engine.hero.d.lvl >= 70) {
                    const engine = window.Engine;
                    const playerList = engine.whoIsHere.getSortedPlayerList();
                    if (playerList.length > 0 && isLocationInExpowisko(expZoneName, engine.map.d.name)) {
                      clearInterval(window.MargonemAPI.state.exping_location.teleport_if_player);
                      window.MargonemAPI.healingSystem.interval_of_selling = false;
                      window.MargonemAPI.exping.stopExping();
                      uzyjPrzedmiot("Zwój teleportacji na Kwieciste Przejście");
                      await this.waitForMapChange("Kwieciste Przejście");
                      await sleep(2000);
                      await this.tuniaSelling();
                      window.MargonemAPI.state.exping_location.is_aborted = true;
                      window.MargonemAPI.healingSystem.interval_of_selling = true;
                      await sleep(3000);
                      return this.startExping(minLevel, maxLevel, expZoneName, sellWhenFull, teleportIfPlayer, potionCount);
                    }
                  } else {
                    const engine = window.Engine;
                    const playerList = engine.whoIsHere.getSortedPlayerList();
                    if (playerList.length > 0 && isLocationInExpowisko(expZoneName, engine.map.d.name)) {
                      clearInterval(window.MargonemAPI.state.exping_location.teleport_if_player);
                      window.MargonemAPI.healingSystem.interval_of_selling = false;
                      window.MargonemAPI.exping.stopExping();
                      uzyjPierwszyTeleport();
                      await sleep(5000);
                      window.MargonemAPI.state.exping_location.is_aborted = true;
                      window.MargonemAPI.healingSystem.interval_of_selling = true;
                      await sleep(3000);
                      return this.startExping(minLevel, maxLevel, expZoneName, sellWhenFull, teleportIfPlayer, potionCount);
                    }
                  }
                }
              }, 500);
            }
            window.MargonemAPI.state.exping_location.death_cam = setInterval(async () => {
              try {
                if (!window.Engine.dead) {
                  return;
                }
                clearInterval(window.MargonemAPI.state.exping_location.death_cam);
                window.MargonemAPI.exping.stopExping();
                window.MargonemAPI.healingSystem.interval_of_selling = false;
                while (window.Engine.dead) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
                await sleep(5000);
                if (window.Engine.hero.d.lvl < 70) {
                  window.MargonemAPI.navigation.stopNavigation(true);
                  const currentMapName = window.Engine.map.d.name;
                  if (currentMapName === "Ithan") {
                    await this.notTuniaSelling(39, 51, "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div > div.shop-content.normal-shop-zl > div.great-merchamp.btns-spacing > div:nth-child(1) > div.label");
                    window.Engine.hero.autoGoTo({
                      x: 18,
                      y: 15
                    }, false);
                    await waitForPosition(18, 15, 60000);
                    window.Engine.hero.talkNearMob();
                    await sleep(1000);
                    document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span").click();
                    await sleep(1000);
                    await this.buingPots();
                  } else if (currentMapName === "Karka-han") {
                    await this.navigateToLocation("Przedmieścia Karka-han");
                    await this.waitForMapChange("Przedmieścia Karka-han");
                    await sleep(2000);
                    await this.notTuniaSelling(17, 11, "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div > div.shop-content.normal-shop-zl > div.great-merchamp.btns-spacing > div:nth-child(1) > div.label");
                    await this.navigateToLocation("Karka-han");
                    await this.waitForMapChange("Karka-han");
                    window.Engine.hero.autoGoTo({
                      x: 31,
                      y: 38
                    }, false);
                    await waitForPosition(31, 38, 60000);
                    window.Engine.hero.talkNearMob();
                    await sleep(1000);
                    document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span").click();
                    await sleep(1000);
                    await this.buingPots();
                  } else if (currentMapName === "Nithal") {
                    await this.navigateToLocation("Eder");
                    await this.waitForMapChange("Eder");
                    await this.notTuniaSelling(27, 50, "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div > div.shop-content.normal-shop-zl > div.great-merchamp.btns-spacing > div:nth-child(1) > div.label");
                    window.Engine.hero.autoGoTo({
                      x: 56,
                      y: 40
                    }, false);
                    await waitForPosition(56, 40, 60000);
                    window.Engine.hero.talkNearMob();
                    await sleep(1000);
                    document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span").click();
                    await sleep(1000);
                    await this.buingPots();
                  } else if (currentMapName === "Eder") {
                    await this.notTuniaSelling(27, 50, "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div > div.shop-content.normal-shop-zl > div.great-merchamp.btns-spacing > div:nth-child(1) > div.label");
                    window.Engine.hero.autoGoTo({
                      x: 56,
                      y: 40
                    }, false);
                    await waitForPosition(56, 40, 60000);
                    window.Engine.hero.talkNearMob();
                    await sleep(1000);
                    document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span").click();
                    await sleep(1000);
                    await this.buingPots();
                  } else if (currentMapName === "Torneg") {
                    await this.notTuniaSelling(59, 18, "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak", "body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div > div.shop-content.normal-shop-zl > div.great-merchamp.btns-spacing > div:nth-child(1) > div.label");
                    window.Engine.hero.autoGoTo({
                      x: 79,
                      y: 7
                    }, false);
                    await waitForPosition(79, 7, 60000);
                    window.Engine.hero.talkNearMob();
                    await sleep(1000);
                    document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span").click();
                    await sleep(1000);
                    await this.buingPots();
                  }
                  window.MargonemAPI.state.exping_location.is_aborted = true;
                  window.MargonemAPI.healingSystem.interval_of_selling = true;
                  await sleep(3000);
                  return this.startExping(minLevel, maxLevel, expZoneName, sellWhenFull, teleportIfPlayer, potionCount);
                }
                uzyjPrzedmiot("Zwój teleportacji na Kwieciste Przejście");
                await this.waitForMapChange("Kwieciste Przejście");
                await this.tuniaSelling();
                window.MargonemAPI.state.exping_location.is_aborted = true;
                window.MargonemAPI.healingSystem.interval_of_selling = true;
                await sleep(3000);
                return this.startExping(minLevel, maxLevel, expZoneName, sellWhenFull, teleportIfPlayer, potionCount);
              } catch (error) {}
            }, 1000);
            const currentLocation = window.MargonemAPI.navigation.getCurrentLocation();
            this.checkAborted();
            if (!currentLocation) {
              throw new Error("");
            }
            const spotConfig = Expowiska[expZoneName];
            if (!spotConfig || !Array.isArray(spotConfig)) {
              throw new Error("");
            }
            const specialSpots = ["driady (280lvl)", "pustynia (275lvl)"];
            const spotName = expZoneName;
            if (specialSpots.includes(spotName) && currentLocation === "Kwieciste Przejście") {
              this.checkAborted();
              await this.navigateToLocation("Dom Tunii");
              this.checkAborted();
              await this.waitForMapChange("Dom Tunii");
              this.checkAborted();
              window.Engine.hero.autoGoTo({
                x: 8,
                y: 9
              }, false);
              await waitForPosition(8, 9, 60000);
              this.checkAborted();
              window.Engine.hero.talkNearMob();
              await sleep(1000);
              await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span");
              this.checkAborted();
              const shopDialogOption = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span");
              shopDialogOption.click();
              await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
              this.checkAborted();
              if (!sprawdzPrzedmiot("Zwój teleportacji na Kwieciste Przejście")) {
                await sleep(1000);
                await buyItem(1471);
                await sleep(1000);
                await buyItem(1471);
                await sleep(1000);
                await buyItem(1471);
                await sleep(1000);
              }
              const maxHealth = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
              if (potionCount > 0) {
                const currentPotionCount = policzLeczyPrzedmioty() || 0;
                const targetPotions = window.MargonemAPI.state.exping_location.targetPotions || potionCount;
                const potionsToBuy = Math.max(0, targetPotions - currentPotionCount);
                if (potionsToBuy > 0) {
                  const bestPotionId = wybierzIdNajlepszejPotki(maxHealth);
                  const potionData = window.Engine.shop.items?.[bestPotionId];
                  const potionPrice = potionData?.pr || 0;
                  const playerGold = window.Engine.hero.d.gold || 0;
                  const maxAffordable = potionPrice > 0 ? Math.max(0, Math.floor(playerGold / potionPrice) - 1) : 45;
                  const buyAmount = Math.min(potionsToBuy, maxAffordable, 45);
                  if (window.MargonemAPI.state.exping_location.potionsDebug) {
                    console.log("[Potions][BUY@TUNIA(KP)] buy=", buyAmount, "have=", currentPotionCount, "target=", targetPotions);
                  }
                  for (let i = 0; i < buyAmount; i++) {
                    await buyItem(bestPotionId);
                    await sleep(1000);
                  }
                }
              }
              window.Engine.shop.basket.finalize();
              await sleep(1000);
              this.checkAborted();
              window.Engine.shop.close();
              await waitForElementToDisappear("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
              this.checkAborted();
              await this.navigateToLocation("Kwieciste Przejście");
              this.checkAborted();
              await this.waitForMapChange("Kwieciste Przejście");
              this.checkAborted();
              if (spotName === "pustynia (275lvl)") {
                await this.navigateToLocation("Thuzal");
                this.checkAborted();
                await this.waitForMapChange("Thuzal");
                this.checkAborted();
                window.Engine.hero.autoGoTo({
                  x: 72,
                  y: 20
                }, false);
                await waitForPosition(72, 20, 60000);
                this.checkAborted();
                window.Engine.hero.talkNearMob();
                await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li:nth-child(1) > span");
                this.checkAborted();
                const dialogOption1 = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li:nth-child(1) > span");
                dialogOption1.click();
                await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                this.checkAborted();
                const dialogOption2 = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                dialogOption2.click();
                await this.waitForMapChange("Trupia Przełęcz");
                this.checkAborted();
                window.Engine.hero.talkNearMob();
                await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                this.checkAborted();
                const dialogOption3 = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                dialogOption3.click();
                await this.waitForMapChange("Tuzmer");
                this.checkAborted();
                await this.navigateToLocation("Zajazd pod Różą Wiatrów");
                this.checkAborted();
                await this.waitForMapChange("Zajazd pod Różą Wiatrów");
                this.checkAborted();
                await this.navigateToLocation("Zajazd pod Różą Wiatrów p.1");
                this.checkAborted();
                await this.waitForMapChange("Zajazd pod Różą Wiatrów p.1");
                this.checkAborted();
                window.Engine.hero.autoGoTo({
                  x: 31,
                  y: 12
                }, false);
                await waitForPosition(31, 12, 60000);
                this.checkAborted();
                await this.waitForMapChange("Tuzmer");
                this.checkAborted();
                await this.navigateToLocation("Ruiny Pustynnych Burz");
                this.checkAborted();
                await this.waitForMapChange("Ruiny Pustynnych Burz");
                this.checkAborted();
                window.Engine.hero.autoGoTo({
                  x: 63,
                  y: 53
                }, false);
                await waitForPosition(63, 53, 60000);
                this.checkAborted();
                await this.waitForMapChange("Smocze Skalisko");
                this.checkAborted();
                window.Engine.hero.autoGoTo({
                  x: 30,
                  y: 50
                }, false);
                await waitForPosition(30, 50, 60000);
                this.checkAborted();
                await this.waitForMapChange("Jaskinia Sępa s.2");
                this.checkAborted();
                await this.navigateToLocation("Jaskinia Sępa s.1");
                this.checkAborted();
                await this.waitForMapChange("Jaskinia Sępa s.1");
                this.checkAborted();
                const masterMapDesert = "Smocze Skalisko";
                const expingState = window.MargonemAPI.state.exping_location;
                expingState.master_map = masterMapDesert;
                expingState.current_expowisko = expZoneName;
                expingState.current_expowisko_name = spotName;
                await this.navigateToLocation(masterMapDesert);
                this.checkAborted();
                await this.handleRegularMapExping(minLevel, maxLevel);
              } else if (spotName === "driady (280lvl)") {
                const masterMapDriady = "Rozlewisko Kai";
                const expingStateDriady = window.MargonemAPI.state.exping_location;
                expingStateDriady.master_map = masterMapDriady;
                expingStateDriady.current_expowisko = expZoneName;
                expingStateDriady.current_expowisko_name = spotName;
                await this.navigateToLocation("Rozlewisko Kai");
                this.checkAborted();
                await this.waitForMapChange("Rozlewisko Kai");
                this.checkAborted();
                await this.handleRegularMapExping(minLevel, maxLevel);
              }
            } else {
              if (currentLocation === "Kwieciste Przejście") {
                await this.navigateToLocation("Dom Tunii");
                this.checkAborted();
                await this.waitForMapChange("Dom Tunii");
                this.checkAborted();
                window.Engine.hero.autoGoTo({
                  x: 8,
                  y: 9
                }, false);
                await waitForPosition(8, 9, 60000);
                this.checkAborted();
                window.Engine.hero.talkNearMob();
                await sleep(1000);
                await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span");
                this.checkAborted();
                const shopDialogButton = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span");
                shopDialogButton.click();
                await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
                this.checkAborted();
                await sleep(1000);
                if (!sprawdzPrzedmiot("Zwój teleportacji na Kwieciste Przejście")) {
                  await buyItem(1471);
                  await sleep(1000);
                  await buyItem(1471);
                  await sleep(1000);
                  await buyItem(1471);
                  await sleep(1000);
                }
                const maxHealth = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
                let needHealerFallback = false;
                if (potionCount > 0) {
                  const currentPotionCount = policzLeczyPrzedmioty() || 0;
                  const targetPotions = window.MargonemAPI.state.exping_location.targetPotions || potionCount;
                  const potionsToBuy = Math.max(0, targetPotions - currentPotionCount);
                  if (potionsToBuy > 0) {
                    const bestPotionId = wybierzIdNajlepszejPotki(maxHealth);
                    const potionData = window.Engine.shop.items?.[bestPotionId];
                    if (!bestPotionId || !potionData || !potionData._cachedStats || potionData._cachedStats.leczy === undefined) {
                      needHealerFallback = true;
                      if (window.MargonemAPI.state.exping_location.potionsDebug) {
                        const shopItemCount = window.Engine.shop.items ? Object.keys(window.Engine.shop.items).length : 0;
                        console.log("[Potions][BUY@TUNIA] no healing potions in this shop; potionId=", bestPotionId, "shopItems=", shopItemCount);
                      }
                    } else {
                    const potionPrice = potionData?.pr || 0;
                    const playerGold = window.Engine.hero.d.gold || 0;
                    const maxAffordable = potionPrice > 0 ? Math.max(0, Math.floor(playerGold / potionPrice) - 1) : 45;
                    const buyAmount = Math.min(potionsToBuy, maxAffordable, 45);
                    if (window.MargonemAPI.state.exping_location.potionsDebug) {
                      console.log("[Potions][BUY@TUNIA] buy=", buyAmount, "have=", currentPotionCount, "target=", targetPotions, "potionId=", bestPotionId, "name=", potionData?.name);
                    }
                    for (let i = 0; i < buyAmount; i++) {
                      await buyItem(bestPotionId);
                      await sleep(1000);
                    }
                    }
                  }
                }
                window.Engine.shop.basket.finalize();
                await sleep(1000);
                this.checkAborted();
                window.Engine.shop.close();
                await waitForElementToDisappear("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
                this.checkAborted();
                await this.navigateToLocation("Kwieciste Przejście");
                this.checkAborted();
                await this.waitForMapChange("Kwieciste Przejście");
                this.checkAborted();

                if (needHealerFallback) {
                  try {
                    await this.buyPotionsAtHealer(window.MargonemAPI.state.exping_location.targetPotions || potionCount);
                  } catch (err) {}
                  this.checkAborted();
                  await this.navigateToLocation("Kwieciste Przejście");
                  this.checkAborted();
                  await this.waitForMapChange("Kwieciste Przejście");
                  this.checkAborted();
                }
              }
              window.MargonemAPI.state.exping_location.blockPotions = false;
              const isOnValidMap = spotConfig.some(entry => {
                const [mapName] = Object.entries(entry)[0];
                return mapName === currentLocation;
              });
              this.checkAborted();
              if (isOnValidMap) {
                const expingStateSetup = window.MargonemAPI.state.exping_location;
                expingStateSetup.master_map = currentLocation;
                expingStateSetup.current_expowisko = expZoneName;
                expingStateSetup.current_expowisko_name = Object.keys(Expowiska[expZoneName])[0];
                const selectedMapsList = expingStateSetup.selectedMaps;
                const currentIndex = selectedMapsList.indexOf(currentLocation);
                if (currentIndex !== -1) {
                  const reorderedMaps = selectedMapsList.splice(0, currentIndex);
                  selectedMapsList.push(...reorderedMaps);
                }
                await this.handleRegularMapExping(minLevel, maxLevel);
                return;
              }
              const bestLocation = await this.findBestLocation(currentLocation, spotConfig);
              this.checkAborted();
              if (!bestLocation) {
                throw new Error("");
              }
              const expingStateFinal = window.MargonemAPI.state.exping_location;
              expingStateFinal.master_map = bestLocation.map;
              expingStateFinal.current_expowisko = expZoneName;
              expingStateFinal.current_expowisko_name = Object.keys(expZoneName)[0];
              await this.navigateToLocation(bestLocation.map);
              this.checkAborted();
              await this.handleRegularMapExping(minLevel, maxLevel);
            }
          } catch (error) {
            this.stopExping();
            throw error;
          }
        } else {
          stopHeartbeat();
          const licenseElement = document.getElementById("tm-license-content");
          if (licenseElement) {
            licenseElement.innerHTML = "<div style='color: red;'>Sesja zakończona lub wystąpił błąd! Sesja została automatycznie zakończona.</div>";
          }
          return;
        }
      } catch (err) {
        const licenseContent = document.getElementById("tm-license-content");
        if (licenseContent) {
          licenseContent.innerHTML = "<div style='color: red;'>Brak odpowiedzi serwera – sesja została automatycznie zakończona.</div>";
        }
        return;
      }
    },
    buyPotionsAtHealer: async function (targetPotionCount) {
      const POTION_SELLERS = [{
        name: "Uzdrowicielka Emanilia",
        map: "Liściaste Rozstaje",
        x: 21,
        y: 51
      }, {
        name: "Mnich Seweryn",
        map: "Klasztor Różanitów - świątynia",
        x: 25,
        y: 8
      }, {
        name: "Uzdrowiciel Ypsli",
        map: "Mirvenis-Adur",
        x: 82,
        y: 7
      }, {
        name: "Jemenoss",
        map: "Mythar",
        x: 45,
        y: 13
      }, {
        name: "Kapłanka Hiada",
        map: "Thuzal",
        x: 52,
        y: 17
      }, {
        name: "Szalony Etrefan",
        map: "Eder",
        x: 56,
        y: 40
      }, {
        name: "Doktor Nad",
        map: "Nithal",
        x: 5,
        y: 48
      }, {
        name: "Uzdrowiciel Toramidamus",
        map: "Tuzmer",
        x: 26,
        y: 21
      }, {
        name: "Uzdrowicielka Halfinia",
        map: "Karka-han",
        x: 31,
        y: 38
      }, {
        name: "Wysoka kapłanka Gryfia",
        map: "Torneg",
        x: 79,
        y: 8
      }, {
        name: "Uzdrowicielka Makatara",
        map: "Ithan",
        x: 18,
        y: 15
      }, {
        name: "Uzdrowicielka Hiliko",
        map: "Werbin",
        x: 38,
        y: 16
      }];
      const currentLocation = window.MargonemAPI.navigation.getCurrentLocation();
      if (!currentLocation) {
        return false;
      }
      const debugEnabled = window.MargonemAPI.state.exping_location?.potionsDebug;
      let closestSeller = null;
      try {
        const sellerDistances = await Promise.all(POTION_SELLERS.map(async seller => {
          try {
            const pathResult = await window.MargonemAPI.navigation.findShortestPath(currentLocation, seller.map);
            return {
              seller: seller,
              distance: pathResult?.distance ?? Infinity
            };
          } catch (err) {
            return {
              seller: seller,
              distance: Infinity
            };
          }
        }));
        closestSeller = sellerDistances.reduce((closest, current) => current.distance < closest.distance ? current : closest, {
          distance: Infinity
        }).seller;
      } catch (err) {}
      if (!closestSeller) {
        closestSeller = POTION_SELLERS[0];
      }

      if (debugEnabled) {
        console.log("[Potions][HEALER] selected=", closestSeller?.name, "map=", closestSeller?.map, "pos=", closestSeller?.x + "," + closestSeller?.y, "target=", targetPotionCount, "from=", currentLocation);
      }

      this.checkAborted();
      await this.navigateToLocation(closestSeller.map);
      this.checkAborted();
      await this.waitForMapChange(closestSeller.map);
      this.checkAborted();
      window.Engine.hero.autoGoTo({
        x: closestSeller.x,
        y: closestSeller.y
      }, false);
      await waitForPosition(closestSeller.x, closestSeller.y, 60000);
      this.checkAborted();

      if (debugEnabled) {
        console.log("[Potions][HEALER] arrived map=", window.MargonemAPI.navigation.getCurrentLocation(), "hero=", {
          x: window.Engine?.hero?.x || window.Engine?.hero?.d?.x,
          y: window.Engine?.hero?.y || window.Engine?.hero?.d?.y
        });
      }

      window.Engine.hero.talkNearMob();
      await sleep(1000);

      const dialogueWindow = await Promise.race([waitForElement("div.dialogue-window.is-open"), sleep(8000).then(() => null)]);
      if (!dialogueWindow) {
        if (debugEnabled) {
          console.log("[Potions][HEALER] dialogue did not open");
        }
        return false;
      }
      this.checkAborted();

      const dialogueOptions = Array.from(document.querySelectorAll("li.dialogue-window-answer.answer"));
      const shopOption = dialogueOptions.find(option => option.classList.contains("line_shop")) || dialogueOptions.find(option => {
        const optionText = (option.textContent || "").toLowerCase();
        return optionText.includes("sklep") || optionText.includes("handel") || optionText.includes("kup") || optionText.includes("sprzed");
      });

      if (debugEnabled) {
        console.log("[Potions][HEALER] dialogue options=", dialogueOptions.map(option => (option.textContent || "").trim()));
      }

      if (!shopOption) {
        if (debugEnabled) {
          console.log("[Potions][HEALER] no shop option found in dialogue");
        }
        return false;
      }

      const shopButton = shopOption.querySelector("span") || shopOption;
      shopButton.click();

      const shopWindow = await Promise.race([
        waitForElement("div.alerts-layer.layer div.border-window.ui-draggable.window-on-peak"),
        waitForElement("div.border-window.ui-draggable.window-on-peak div.shop-content"),
        sleep(8000).then(() => null)
      ]);
      if (!shopWindow) {
        if (debugEnabled) {
          console.log("[Potions][HEALER] shop window did not open");
        }
        return false;
      }

      await sleep(1000);
      await this.buingPots(targetPotionCount);
      return true;
    },
    buingPots: async function () {
      const maxHealth = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
      await sleep(1000);
      const bestPotionId = await wybierzIdNajlepszejPotki(maxHealth);
      const potionData = window.Engine.shop.items?.[bestPotionId];
      if (!bestPotionId || !potionData || !potionData._cachedStats || potionData._cachedStats.leczy === undefined) {
        if (window.MargonemAPI.state.exping_location?.potionsDebug) {
          const shopItemCount = window.Engine.shop.items ? Object.keys(window.Engine.shop.items).length : 0;
          console.log("[Potions][BUY@HEALER] no healing potions in healer shop; potionId=", bestPotionId, "shopItems=", shopItemCount);
        }
        window.Engine.shop.close();
        return;
      }
      const targetPotions = window.MargonemAPI.state.exping_location?.targetPotions || 0;
      const currentPotionCount = policzLeczyPrzedmioty() || 0;
      const potionsToBuy = Math.max(0, targetPotions - currentPotionCount);
      const potionPrice = potionData?.pr || 0;
      const playerGold = window.Engine.hero.d.gold || 0;
      const maxAffordable = potionPrice > 0 ? Math.max(0, Math.floor(playerGold / potionPrice) - 1) : 45;
      const buyAmount = targetPotions > 0 ? Math.min(potionsToBuy, maxAffordable, 45) : window.MargonemAPI.znajdzIloscPotkow(bestPotionId);
      if (window.MargonemAPI.state.exping_location?.potionsDebug) {
        console.log("[Potions][BUY@HEALER] buy=", buyAmount, "have=", currentPotionCount, "target=", targetPotions, "potionId=", bestPotionId, "name=", potionData?.name);
      }
      for (let i = 0; i < (buyAmount || 0); i++) {
        await buyItem(bestPotionId);
        await sleep(1000);
      }
      window.Engine.shop.basket.finalize();
      await sleep(1000);
      this.checkAborted();
      window.Engine.shop.close();
    },
    notTuniaSelling: async function (targetX, targetY, shopSelector, shopWindowSelector, sellButtonSelector) {
      const targetPosition = {
        x: targetX,
        y: targetY
      };
      window.Engine.hero.autoGoTo(targetPosition, false);
      await waitForPosition(targetX, targetY, 60000);
      window.Engine.hero.talkNearMob();
      await waitForElement(shopSelector);
      const shopElement = document.querySelector(shopSelector);
      if (!shopElement) {
        throw new Error("");
      }
      shopElement.click();
      await waitForElement(shopWindowSelector);
      await sleep(1000);
      for (let i = 0; i < 7; i++) {
        await sleep;
        const sellButton = document.querySelector(sellButtonSelector);
        if (!sellButton) {
          throw new Error("");
        }
        sellButton.click();
        await sleep(1000);
        window.Engine.shop.basket.finalize();
        await sleep(1000);
      }
      window.Engine.shop.close();
    },
    tuniaSelling: async function () {
      try {
        await this.navigateToLocation("Dom Tunii");
        await this.waitForMapChange("Dom Tunii");
        window.Engine.hero.autoGoTo({
          x: 8,
          y: 9
        }, false);
        await waitForPosition(8, 9, 60000);
        window.Engine.hero.talkNearMob();
        await waitForElement("li.dialogue-window-answer.answer.line_shop > span");
        const shopDialogOption = document.querySelector("li.dialogue-window-answer.answer.line_shop > span");
        if (!shopDialogOption) {
          throw new Error("");
        }
        shopDialogOption.click();
        await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
        await sleep(1000);
        for (let i = 0; i < 7; i++) {
          await sleep;
          const sellAllButton = document.querySelector("div.great-merchamp.btns-spacing > div:nth-child(1)");
          if (!sellAllButton) {
            throw new Error("");
          }
          sellAllButton.click();
          await sleep(1000);
          window.Engine.shop.basket.finalize();
          await sleep(1000);
        }

        const targetPotions = window.MargonemAPI.state.exping_location?.targetPotions || 0;
        let needHealerFallback = false;
        if (targetPotions > 0) {
          const currentPotionCount = policzLeczyPrzedmioty() || 0;
          const potionsToBuy = Math.max(0, targetPotions - currentPotionCount);
          if (potionsToBuy > 0) {
            const maxHealth = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
            const bestPotionId = wybierzIdNajlepszejPotki(maxHealth);
            const potionData = window.Engine.shop.items?.[bestPotionId];
            if (!bestPotionId || !potionData || !potionData._cachedStats || potionData._cachedStats.leczy === undefined) {
              needHealerFallback = true;
              if (window.MargonemAPI.state.exping_location.potionsDebug) {
                const shopItemCount = window.Engine.shop.items ? Object.keys(window.Engine.shop.items).length : 0;
                console.log("[Potions][BUY@TUNIA] no healing potions in Tunia shop; potionId=", bestPotionId, "shopItems=", shopItemCount);
              }
            } else {
            const potionPrice = potionData?.pr || 0;
            const playerGold = window.Engine.hero.d.gold || 0;
            const maxAffordable = potionPrice > 0 ? Math.max(0, Math.floor(playerGold / potionPrice) - 1) : 45;
            const buyAmount = Math.min(potionsToBuy, maxAffordable, 45);
            if (window.MargonemAPI.state.exping_location.potionsDebug) {
              console.log("[Potions][BUY@TUNIA] buy=", buyAmount, "have=", currentPotionCount, "target=", targetPotions, "potionId=", bestPotionId, "name=", potionData?.name);
            }
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
        await waitForElementToDisappear("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
        await this.navigateToLocation("Kwieciste Przejście");
        await this.waitForMapChange("Kwieciste Przejście");
        window.Engine.hero.autoGoTo({
          x: 20,
          y: 20
        }, false);
        await waitForPosition(20, 20, 60000);

        if (needHealerFallback) {
          if (window.MargonemAPI.state.exping_location?.potionsDebug) {
            console.log("[Potions][TUNIA->HEALER] fallback triggered, calling buyPotionsAtHealer");
          }
          try {
            await this.buyPotionsAtHealer(window.MargonemAPI.state.exping_location?.targetPotions || 0);
          } catch (err) {
            if (window.MargonemAPI.state.exping_location?.potionsDebug) {
              console.log("[Potions][TUNIA->HEALER] buyPotionsAtHealer error:", err?.message || err);
            }
          }
          await this.navigateToLocation("Kwieciste Przejście");
          await this.waitForMapChange("Kwieciste Przejście");
          window.Engine.hero.autoGoTo({
            x: 20,
            y: 20
          }, false);
          await waitForPosition(20, 20, 60000);
        }
        return true;
      } catch (error) {
        if (window.MargonemAPI.state.exping_location?.potionsDebug) {
          console.log("[Potions][TUNIA] tuniaSelling threw error:", error?.message || error);
        }
        // Even if tuniaSelling fails, try healer fallback if target > 0
        const targetPotions = window.MargonemAPI.state.exping_location?.targetPotions || 0;
        const currentPotionCount = policzLeczyPrzedmioty() || 0;
        if (targetPotions > 0 && currentPotionCount < targetPotions) {
          if (window.MargonemAPI.state.exping_location?.potionsDebug) {
            console.log("[Potions][TUNIA] error fallback to healer, have=", currentPotionCount, "target=", targetPotions);
          }
          try {
            await this.buyPotionsAtHealer(targetPotions);
          } catch (err) {}
          try {
            await this.navigateToLocation("Kwieciste Przejście");
            await this.waitForMapChange("Kwieciste Przejście");
          } catch (err) {}
        }
        return false;
      }
    },
    findBestLocation: async function (currentLocation, spotList) {
      this.checkAborted();
      const locationDistances = await Promise.all(spotList.map(async spotEntry => {
        this.checkAborted();
        const [mapName, insideMap] = Object.entries(spotEntry)[0];
        try {
          const pathResult = await window.MargonemAPI.navigation.findShortestPath(currentLocation, mapName);
          this.checkAborted();
          const locationData = {
            map: mapName,
            inside: insideMap,
            distance: pathResult.distance || Infinity
          };
          return locationData;
        } catch (err) {
          const locationData = {
            map: mapName,
            inside: insideMap,
            distance: Infinity
          };
          return locationData;
        }
      }));
      const initialValue = {
        distance: Infinity
      };
      return locationDistances.reduce((closest, current) => current.distance < closest.distance ? current : closest, initialValue);
    },
    handleRegularMapExping: async function (minLevel, maxLevel) {
      const expingState = window.MargonemAPI.state.exping_location;
      this.checkAborted();
      try {
        // Get available maps from selectedMaps
        const availableMaps = selectedMaps || [];
        console.log("[DEBUG] ====== EXPING START ======");
        console.log("[DEBUG] Available maps:", availableMaps);
        console.log("[DEBUG] Number of maps:", availableMaps.length);
        if (availableMaps.length === 0) {
          throw new Error("No maps selected for exping");
        }
        
        // Main exping loop - continues until aborted
        while (!expingState.is_aborted) {
          this.checkAborted();
          
          const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
          console.log("[DEBUG] Current map:", currentMap);
          const isCurrentMapValid = availableMaps.includes(currentMap);
          console.log("[DEBUG] Is current map in available maps?:", isCurrentMapValid);
          
          // PRIORITY 1: If we're already on a valid map, try to fight here first
          if (isCurrentMapValid) {
            console.log("[DEBUG] Already on valid map, checking for mobs...");
            // Reset map_cleaned flag to check for mobs
            window.MargonemAPI.state.map_cleaned = false;
            
            try {
              // Record visit and fight on current location
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
          
          // PRIORITY 2: After fighting on current map (or if not valid), go to next map
          const nextMap = this.getNextBestMap(availableMaps);
          console.log("[DEBUG] getNextBestMap returned:", nextMap);
          if (!nextMap) {
            console.log("[Exping] Brak dostępnych map do odwiedzenia");
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
          
          // Only navigate if we need to go to a different map
          if (nextMap !== currentMap) {
            try {
              console.log("[DEBUG] Navigating to map:", nextMap);
              console.log("[Exping] Nawigacja do mapy:", nextMap);
              await this.navigateToLocation(nextMap);
              this.checkAborted();
              
              // Record that we visited this map
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
    navigateToLocation: async function (targetLocation) {
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
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.checkAborted();
      }
      throw new Error();
    },
    fightOnCurrentLocation: async function (minLevel, maxLevel) {
      this.checkAborted();
      const currentLocation = window.MargonemAPI.navigation.getCurrentLocation();
      try {
        const hasMobs = await this.checkForMobs(minLevel, maxLevel);
        this.checkAborted();
        if (!hasMobs) {
          return false;
        }
        const levelRange = {
          min: minLevel,
          max: maxLevel
        };
        const fightOptions = {
          levelRange: levelRange
        };
        await window.MargonemAPI.combat.startFight(fightOptions);
        this.checkAborted();
        const mapCleared = await this.waitForMapClear();
        this.checkAborted();
        if (!mapCleared) {}
        window.MargonemAPI.combat.stopFight();
        return true;
      } catch (error) {
        window.MargonemAPI.combat.stopFight();
        throw error;
      }
    },
    checkForMobs: async function (minLevel, maxLevel) {
      this.checkAborted();
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          this.checkAborted();
          await new Promise(resolve => setTimeout(resolve, 1000));
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
    waitForMapChange: async function (targetMap) {
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
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.checkAborted();
      }
      return false;
    },
    waitForMapClear: async function () {
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
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.checkAborted();
      }
      throw new Error("");
    },
    stopExping: function () {
      try {
        const state = window.MargonemAPI.state;
        const expingLocation = window.MargonemAPI.state.exping_location;
        clearInterval(window.MargonemAPI.state.exping_location.death_cam);
        clearInterval(window.MargonemAPI.state.exping_location.teleport_if_player);
        clearInterval(window.MargonemAPI.state.exping_location.potion_checker);
        clearInterval(window.MargonemAPI.state.exping_location.bag_full);
        window.MargonemAPI.state.exping_location.is_aborted = true;
        window.MargonemAPI.state.exping_location._potionRefillInProgress = false;
        if (state.timers) {
          Object.values(state.timers).forEach(timer => {
            if (timer) {
              clearTimeout(timer);
              clearInterval(timer);
            }
          });
          state.timers = {};
        }
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
        try {
          if (window.MargonemAPI.combat.recoverySystem) {
            window.MargonemAPI.combat.recoverySystem.stopMonitoring();
          }
        } catch (err) {}
        if (state.pendingStopActions) {
          state.pendingStopActions.clear();
        }
        if (state.activeIntervals) {
          state.activeIntervals.forEach(interval => {
            clearInterval(interval);
          });
          state.activeIntervals.clear();
        }
        if (state.activeTimeouts) {
          state.activeTimeouts.forEach(timeout => {
            clearTimeout(timeout);
          });
          state.activeTimeouts.clear();
        }
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
        clearInterval(window.MargonemAPI.state.exping_location.bag_full);
        try {
          const engine = window.Engine;
          if (engine && engine.hero) {
            const heroX = Math.floor(engine.hero.x || engine.hero.d && engine.hero.d.x);
            const heroY = Math.floor(engine.hero.y || engine.hero.d && engine.hero.d.y);
            const heroPosition = {
              x: heroX,
              y: heroY
            };
            engine.hero.autoGoTo(heroPosition);
          }
        } catch (err) {}
        for (const key in window) {
          if (typeof window[key] === "number") {
            if (key.includes("interval") || key.includes("timeout")) {
              clearInterval(window[key]);
              clearTimeout(window[key]);
            }
          }
        }
        return true;
      } catch (error) {
        try {
          this.resetState();
        } catch (err) {}
        return false;
      }
    },
    resetState: function () {
      window.MargonemAPI.state.exping_location = {
        master_map: null,
        inside_map: null,
        is_sublocation: false,
        current_location_index: 0,
        current_expowisko: null,
        last_map_clean_time: null,
        respawn_wait_time: 300000,
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
      };
    }
  },
  pathfinding: {
    cache: {
      collisionGrid: null,
      pathCache: new Map(),
      lastMapName: null,
      nodeCache: new Map(),
      openSet: null,
      closedSet: null
    },
    debug: function (...args) {
      if (window.MargonemAPI.DEBUG) {}
    },
    Node: class {
      constructor(x, y, g = 0, h = 0) {
        this.x = x;
        this.y = y;
        this.g = g;
        this.h = h;
        this.f = g + h;
        this.parent = null;
        this.key = x + "," + y;
      }
    },
    initializeCollisionGrid: function () {
      const engine = window.Engine;
      if (!engine?.map) {
        return;
      }
      const mapName = engine.map.d.name;
      if (mapName === this.cache.lastMapName && this.cache.collisionGrid) {
        return;
      }
      const collisionData = window.MargonemAPI.scanMapCollisions();
      if (!collisionData) {
        return;
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
    checkCollision: function (x, y) {
      const {
        gridWidth: gridWidth,
        collisionGrid: collisionGrid
      } = this.cache;
      return collisionGrid[y * gridWidth + x] === 1;
    },
    findPath: function (startX, startY, endX, endY) {
      if (!this.cache.collisionGrid) {
        this.initializeCollisionGrid();
        if (!this.cache.collisionGrid) {
          return null;
        }
      }
      const cacheKey = startX + "," + startY + "-" + endX + "," + endY;
      const cachedPath = this.cache.pathCache.get(cacheKey);
      if (cachedPath) {
        return cachedPath;
      }
      const {
        gridWidth: width,
        gridHeight: height
      } = this.cache;
      if (startX < 0 || startY < 0 || endX < 0 || endY < 0 || startX >= width || startY >= height || endX >= width || endY >= height) {
        return null;
      }
      const openSet = new Map();
      const closedSet = new Set();
      const startNode = new this.Node(startX, startY, 0, Math.abs(endX - startX) + Math.abs(endY - startY));
      openSet.set(startNode.key, startNode);
      const dirUp = {
        x: 0,
        y: -1
      };
      const dirLeft = {
        x: -1,
        y: 0
      };
      const neighbors = [dirUp, {
        x: 1,
        y: 0
      }, {
        x: 0,
        y: 1
      }, dirLeft];
      while (openSet.size > 0) {
        let current = null;
        let lowestF = Infinity;
        for (const [nodeKey, node] of openSet) {
          if (node.f < lowestF) {
            lowestF = node.f;
            current = node;
          }
        }
        if (current.x === endX && current.y === endY) {
          const path = [];
          while (current) {
            const point = {
              x: current.x,
              y: current.y
            };
            path.unshift(point);
            current = current.parent;
          }
          this.cache.pathCache.set(cacheKey, path);
          return path;
        }
        openSet.delete(current.key);
        closedSet.add(current.key);
        for (const direction of neighbors) {
          const neighborX = current.x + direction.x;
          const neighborY = current.y + direction.y;
          const neighborKey = neighborX + "," + neighborY;
          if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height || this.checkCollision(neighborX, neighborY) && (neighborX !== endX || neighborY !== endY) || closedSet.has(neighborKey)) {
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
            const newNode = new this.Node(neighborX, neighborY, tentativeG, Math.abs(endX - neighborX) + Math.abs(endY - neighborY));
            newNode.parent = current;
            openSet.set(neighborKey, newNode);
          }
        }
      }
      this.cache.pathCache.set(cacheKey, null);
      return null;
    },
    calculateRealDistance: function (startX, startY, endX, endY) {
      const path = this.findPath(startX, startY, endX, endY);
      if (path) {
        return path.length - 1;
      } else {
        return Infinity;
      }
    },
    findPathWithBackHandling: function (startX, startY, endX, endY) {
      try {
        const engine = window.Engine;
        if (engine && engine.hero) {
          const localX = Math.floor(parseFloat(engine.hero.d.x || 0));
          const localY = Math.floor(parseFloat(engine.hero.d.y || 0));
          const serverX = Math.floor(parseFloat(engine.hero.lastServerX || engine.hero.d.x || 0));
          const serverY = Math.floor(parseFloat(engine.hero.lastServerY || engine.hero.d.y || 0));
          if (Math.abs(localX - serverX) > 0 || Math.abs(localY - serverY) > 0) {
            console.log("[MargonemAPI] Position mismatch detected: Local(" + localX + "," + localY + ") vs Server(" + serverX + "," + serverY + ")");
            startX = serverX;
            startY = serverY;
          }
        }
        return this.findPath(startX, startY, endX, endY);
      } catch (error) {
        console.error("Error in findPathWithBackHandling:", error);
        return null;
      }
    }
  },
  getGameState: function () {
    const engineRef = window.Engine;
    if (!engineRef || !engineRef.hero || !engineRef.map) {
      return null;
    }
    const heroObj = engineRef.hero;
    const mapObj = engineRef.map;
    const mapInfo = {
      name: mapObj.d && mapObj.d.name || "Unknown Map",
      pvp: mapObj.d && mapObj.d.pvp || 0,
      id: mapObj.d && mapObj.d.id || 0
    };
    return {
      hero: {
        x: Math.floor(parseFloat(heroObj.x || heroObj.d && heroObj.d.x)),
        y: Math.floor(parseFloat(heroObj.y || heroObj.d && heroObj.d.y)),
        nick: heroObj.d && heroObj.d.nick || "Unknown",
        gold: heroObj.gold || heroObj.d && heroObj.d.gold,
        level: heroObj.lvl || heroObj.d && heroObj.d.lvl,
        hp: heroObj.warrior_stats && heroObj.warrior_stats.hp || heroObj.d && heroObj.d.warrior_stats && heroObj.d.warrior_stats.hp || 0,
        maxhp: heroObj.warrior_stats && heroObj.warrior_stats.maxhp || heroObj.d && heroObj.d.warrior_stats && heroObj.d.warrior_stats.maxhp || 1,
        hpPercentage: Math.floor((heroObj.warrior_stats && heroObj.warrior_stats.hp || heroObj.d && heroObj.d.warrior_stats && heroObj.d.warrior_stats.hp || 0) / (heroObj.warrior_stats && heroObj.warrior_stats.maxhp || heroObj.d && heroObj.d.warrior_stats && heroObj.d.warrior_stats.maxhp || 1) * 100)
      },
      map: mapInfo,
      mobs: window.MargonemAPI.state.allMobs,
      fightActive: window.MargonemAPI.state.autoFightActive,
      selectedMobs: window.MargonemAPI.state.selectedNicks,
      blockedMobs: Array.from(window.MargonemAPI.state.blockedMobs.entries()).map(([mobId, mobData]) => ({
        id: mobId,
        nick: mobData.nick,
        blockedAt: mobData.timestamp
      }))
    };
  },
  getAllGateways: function () {
    const engine = window.Engine;
    if (!engine || !engine.map || !engine.map.gateways) {
      return [];
    }
    const gatewayList = engine.map.gateways.getList();
    return gatewayList.map(gateway => ({
      name: gateway.tip[0],
      id: gateway.d.id,
      available: gateway.available,
      x: gateway.d.x,
      y: gateway.d.y
    }));
  },
  getAllMobs: function () {
    const engine = window.Engine;
    if (!engine || !engine.npcs) {
      return [];
    }
    const mapName = engine.map && (engine.map.d?.name || engine.map.name);
    if (mapName && mapName !== window.MargonemAPI.state.lastMapName) {
      window.MargonemAPI.state.allMobs = [];
      window.MargonemAPI.state.lastMapName = mapName;
      window.MargonemAPI.combat.clearBlockedMobs();
      window.MargonemAPI.state.selectedNicks = [];
      const mobCheckboxes = document.querySelector("#mobCheckboxes");
      if (mobCheckboxes) {
        mobCheckboxes.innerHTML = "";
      }
    }
    const npcList = engine.npcs.check();
    window.MargonemAPI.state.npcs = npcList;
    const mobs = [];
    for (const npcId in npcList) {
      const npc = npcList[npcId];
      if (npc && npc.d && (npc.d.type === 2 || npc.d.type === 3)) {
        mobs.push({
          id: npc.d.id,
          nick: npc.d.nick,
          x: Math.floor(parseFloat(npc.d.x)),
          y: Math.floor(parseFloat(npc.d.y)),
          lvl: npc.d.lvl,
          type: npc.d.type,
          wt: npc.d.wt
        });
      }
    }
    window.MargonemAPI.state.allMobs = mobs;
    return mobs;
  },
  checkCollision: function (x, y) {
    const engine = window.Engine;
    if (!engine || !engine.map || !engine.map.col) {
      return null;
    }
    const mapWidth = engine.map.d.x;
    const mapHeight = engine.map.d.y;
    if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) {
      return {
        collision: true,
        reason: "out_of_bounds",
        value: 4
      };
    }
    const collisionValue = engine.map.col.check(x, y);
    return {
      collision: collisionValue !== 0,
      reason: "collision_check",
      value: collisionValue,
      details: {
        blocked: Boolean(collisionValue & 1),
        water: Boolean(collisionValue & 2),
        elevation: Boolean(collisionValue & 4),
        mob: Boolean(collisionValue & 8),
        npc: Boolean(collisionValue & 16),
        player: Boolean(collisionValue & 32)
      }
    };
  },
  scanMapCollisions: function () {
    const engine = window.Engine;
    if (!engine || !engine.map || !engine.map.col) {
      return null;
    }
    const width = engine.map.d.x;
    const height = engine.map.d.y;
    const collisions = new Array(height);
    for (let y = 0; y < height; y++) {
      collisions[y] = new Array(width);
      for (let x = 0; x < width; x++) {
        collisions[y][x] = window.MargonemAPI.checkCollision(x, y);
      }
    }
    return {
      width: width,
      height: height,
      collisions: collisions,
      summary: {
        total: width * height,
        blocked: collisions.flat().filter(tile => tile.collision).length,
        walkable: collisions.flat().filter(tile => !tile.collision).length
      }
    };
  },
  znajdzIloscPotkow: function (itemId) {
    if (!window.Engine || !window.Engine.shop || !window.Engine.shop.items) {
      return;
    }
    const shopItems = window.Engine.shop.items;
    const item = shopItems[itemId];
    const heroGold = window.Engine.hero.d.gold;
    let potionCount = parseInt(heroGold / item.pr) - 1;
    if (potionCount > 45) {
      return 45;
    }
    return potionCount;
  },

  // ====== FUNKCJA KUPOWANIA POTEK U TUNII (przez klikanie DOM) ======
  testBuyPotionsAtTunia: async function (targetAmount) {
    console.log("[TUNIA] Start - cel:", targetAmount, "potek");
    
    const heroLevel = window.Engine?.hero?.d?.lvl || 1;
    const maxHP = window.Engine?.hero?.d?.warrior_stats?.maxhp || 10000;
    const targetHeal = Math.floor(maxHP / 3); // potka powinna leczyć ~1/3 maxHP
    
    console.log("[TUNIA] Poziom postaci:", heroLevel);
    console.log("[TUNIA] MaxHP:", maxHP);
    console.log("[TUNIA] Szukam potki leczącej ~", targetHeal, "HP");
    
    // 1. Nawiguj do Dom Tunii
    const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
    console.log("[TUNIA] Aktualna mapa:", currentMap);
    
    if (currentMap !== "Dom Tunii") {
      console.log("[TUNIA] Nawiguję do Dom Tunii...");
      await window.MargonemAPI.exping.navigateToLocation("Dom Tunii");
      await window.MargonemAPI.exping.waitForMapChange("Dom Tunii");
      console.log("[TUNIA] Dotarłem do Dom Tunii");
    }
    
    // 2. Idź do Tunii (pozycja 8,9)
    console.log("[TUNIA] Idę do Tunii Frupotius (8,9)...");
    window.Engine.hero.autoGoTo({ x: 8, y: 9 }, false);
    await waitForPosition(8, 9, 60000);
    console.log("[TUNIA] Jestem przy Tunii");
    await sleep(500); // krótka pauza przed rozmową
    
    // 3. Rozpocznij rozmowę
    console.log("[TUNIA] Zaczynam rozmowę...");
    window.Engine.hero.talkNearMob();
    await sleep(300); // daj czas na rozpoczęcie dialogu
    
    // 4. Czekaj na pojawienie się opcji sklepu w dialogu
    console.log("[TUNIA] Czekam na dialog...");
    const shopOption = await waitForElement("li.dialogue-window-answer.answer.line_shop > span");
    if (!shopOption) {
      throw new Error("Nie znaleziono opcji sklepu w dialogu");
    }
    
    // Pobierz element ponownie (waitForElement może zwrócić true/promise)
    const shopOptionEl = document.querySelector("li.dialogue-window-answer.answer.line_shop > span");
    if (!shopOptionEl) {
      throw new Error("Nie znaleziono elementu opcji sklepu");
    }
    console.log("[TUNIA] Klikam opcję sklepu...");
    shopOptionEl.click();
    
    // 5. Czekaj na otwarcie sklepu (pełny selektor jak w oryginalnej funkcji)
    console.log("[TUNIA] Czekam na sklep...");
    const shopWindow = await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
    if (!shopWindow) {
      throw new Error("Sklep się nie otworzył");
    }
    console.log("[TUNIA] Sklep otwarty");
    await sleep(1000);
    
    // 6. Pobierz dane przedmiotów BEZPOŚREDNIO z Engine.shop.items
    const engineItems = window.Engine?.shop?.items || {};
    const engineKeys = Object.keys(engineItems);
    console.log("[TUNIA] Przedmiotów w Engine.shop.items:", engineKeys.length);
    
    // Debug - pokaż strukturę pierwszego przedmiotu
    if (engineKeys.length > 0) {
      const firstItem = engineItems[engineKeys[0]];
      console.log("[TUNIA] Struktura przykładowego przedmiotu:");
      console.log("[TUNIA]   name:", firstItem?.name);
      console.log("[TUNIA]   id:", firstItem?.id);
      console.log("[TUNIA]   cl (lvl):", firstItem?.cl);
      console.log("[TUNIA]   pr (cena):", firstItem?.pr);
      console.log("[TUNIA]   stat:", firstItem?.stat);
    }
    
    // 7. Znajdź potki leczące analizując pole 'stat'
    let healingPotions = [];
    
    for (const key of engineKeys) {
      const item = engineItems[key];
      if (!item || !item.stat) continue;
      
      // Parsuj stat string - format: "leczy=20000;amount=5;..."
      const statParts = item.stat.split(";");
      let healAmount = 0;
      let reqLevel = parseInt(item.cl) || 0;
      
      for (const part of statParts) {
        const [statKey, statValue] = part.split("=");
        if (statKey === "leczy") {
          healAmount = parseInt(statValue) || 0;
        }
        if (statKey === "lvl") {
          reqLevel = Math.max(reqLevel, parseInt(statValue) || 0);
        }
      }
      
      // Jeśli to potka leczącą (ma pole leczy)
      if (healAmount > 0) {
        healingPotions.push({
          key: key,               // klucz w Engine.shop.items ('1', '2', etc.)
          id: item.id,            // rzeczywiste ID przedmiotu (41876, etc.)
          name: item.name,
          heal: healAmount,
          lvl: reqLevel,
          price: item.pr || 0,
          item: item              // referencja do oryginalnego obiektu
        });
        console.log(`[TUNIA] Potka: "${item.name}" klucz:${key} leczy:${healAmount}HP lvl:${reqLevel} cena:${item.pr}`);
      }
    }
    
    console.log("[TUNIA] Znaleziono potek leczących:", healingPotions.length);
    
    if (healingPotions.length === 0) {
      console.log("[TUNIA] BŁĄD - nie znaleziono potek leczących!");
      window.Engine.shop.close();
      throw new Error("Brak potek leczących w sklepie");
    }
    
    // 8. Filtruj potki których poziom postać może używać
    let usablePotions = healingPotions.filter(p => p.lvl <= heroLevel);
    console.log("[TUNIA] Potki możliwe do użycia (lvl <= " + heroLevel + "):", usablePotions.length);
    
    if (usablePotions.length === 0) {
      console.log("[TUNIA] UWAGA: Żadna potka nie pasuje do poziomu! Biorę najsłabszą.");
      healingPotions.sort((a, b) => a.lvl - b.lvl);
      usablePotions = [healingPotions[0]];
    }
    
    // 9. Wybierz potkę która leczy najbliżej targetHeal (1/3 maxHP)
    let selectedPotion = null;
    let bestDiff = Infinity;
    
    for (const potion of usablePotions) {
      const diff = Math.abs(potion.heal - targetHeal);
      console.log(`[TUNIA] Porównuję: "${potion.name}" leczy:${potion.heal} diff:${diff}`);
      if (diff < bestDiff) {
        bestDiff = diff;
        selectedPotion = potion;
      }
    }
    
    // Fallback - weź najsilniejszą dostępną
    if (!selectedPotion) {
      usablePotions.sort((a, b) => b.heal - a.heal);
      selectedPotion = usablePotions[0];
    }
    
    console.log("[TUNIA] ========================================");
    console.log("[TUNIA] WYBRANA POTKA:", selectedPotion.name);
    console.log("[TUNIA]   Klucz w sklepie:", selectedPotion.key);
    console.log("[TUNIA]   ID przedmiotu:", selectedPotion.id);
    console.log("[TUNIA]   Leczy:", selectedPotion.heal, "HP");
    console.log("[TUNIA]   Wymagany lvl:", selectedPotion.lvl);
    console.log("[TUNIA]   Cena:", selectedPotion.price);
    console.log("[TUNIA] ========================================");
    
    // 10. targetAmount = liczba KLIKNIĘĆ do wykonania (każde kliknięcie = 5 potek)
    const currentPotions = typeof policzLeczyPrzedmioty === 'function' ? policzLeczyPrzedmioty() : 0;
    const gold = window.Engine?.hero?.d?.gold || 0;
    const price = selectedPotion.price || 0;
    const stackSize = 5; // każdy buyItem kupuje stack 5 potek
    
    const clicksNeeded = targetAmount; // targetAmount to liczba kliknięć
    const canAffordClicks = price > 0 ? Math.floor(gold / price) : 999;
    const toBuyClicks = Math.min(clicksNeeded, canAffordClicks, 99);
    
    console.log("[TUNIA] Mam potek:", currentPotions);
    console.log("[TUNIA] Kliknięć do wykonania:", clicksNeeded);
    console.log("[TUNIA] Złoto:", gold);
    console.log("[TUNIA] Cena za stack:", price);
    console.log("[TUNIA] Stać mnie na kliknięć:", canAffordClicks);
    console.log("[TUNIA] Kupuję kliknięć:", toBuyClicks, "=", toBuyClicks * stackSize, "potek");
    
    if (toBuyClicks <= 0) {
      console.log("[TUNIA] Brak kliknięć do wykonania lub brak złota");
      window.Engine.shop.close();
      return true;
    }
    
    // 11. Sprawdź czy sklep i koszyk są dostępne
    if (!window.Engine?.shop?.basket?.buyItem) {
      console.log("[TUNIA] BŁĄD - Engine.shop.basket.buyItem nie istnieje!");
      console.log("[TUNIA] Engine.shop:", !!window.Engine?.shop);
      console.log("[TUNIA] Engine.shop.basket:", !!window.Engine?.shop?.basket);
      window.Engine.shop?.close?.();
      throw new Error("Sklep nie jest poprawnie otwarty");
    }
    
    // 12. Dodaj potki do koszyka - używaj referencji item którą mamy
    const shopItem = selectedPotion.item;
    if (!shopItem) {
      console.log("[TUNIA] BŁĄD - brak referencji do przedmiotu!");
      window.Engine.shop.close();
      throw new Error("Brak referencji do przedmiotu");
    }
    
    console.log("[TUNIA] Rozpoczynam kupowanie...");
    for (let i = 0; i < toBuyClicks; i++) {
      try {
        window.Engine.shop.basket.buyItem(shopItem);
        if ((i + 1) % 10 === 0 || i === toBuyClicks - 1) {
          console.log(`[TUNIA] Dodano do koszyka ${i+1}/${toBuyClicks} (${(i+1)*5} potek)`);
        }
      } catch (e) {
        console.log(`[TUNIA] Błąd przy dodawaniu ${i+1}:`, e.message);
        break;
      }
      await sleep(100);
    }
    
    // 13. Finalizuj zakup
    console.log("[TUNIA] Finalizuję zakup...");
    await sleep(500);
    
    try {
      if (typeof window.Engine?.shop?.basket?.finalize === 'function') {
        window.Engine.shop.basket.finalize();
        console.log("[TUNIA] Zakup sfinalizowany");
      } else {
        console.log("[TUNIA] basket.finalize nie jest funkcją, próbuję alternatywnie...");
        // Alternatywna metoda - kliknij przycisk finalizacji
        const finalizeBtn = document.querySelector("div.shop-wrapper button.finalize, div.shop-wrapper .btn-finalize, div.great-merchamp.btns-spacing > div:nth-child(1)");
        if (finalizeBtn) {
          finalizeBtn.click();
          console.log("[TUNIA] Kliknięto przycisk finalizacji");
        }
      }
    } catch (e) {
      console.log("[TUNIA] Błąd przy finalizacji:", e.message);
    }
    
    await sleep(1500);
    
    // 14. Zamknij sklep
    console.log("[TUNIA] Zamykam sklep...");
    try {
      if (typeof window.Engine?.shop?.close === 'function') {
        window.Engine.shop.close();
      } else {
        // Alternatywna metoda - kliknij X
        const closeBtn = document.querySelector("div.border-window.window-on-peak .close-button, div.border-window.window-on-peak .btn-close");
        if (closeBtn) {
          closeBtn.click();
        }
      }
    } catch (e) {
      console.log("[TUNIA] Błąd przy zamykaniu sklepu:", e.message);
    }
    await sleep(500);
    
    const finalPotions = typeof policzLeczyPrzedmioty === 'function' ? policzLeczyPrzedmioty() : 0;
    console.log("[TUNIA] ========================================");
    console.log("[TUNIA] ZAKOŃCZONO");
    console.log("[TUNIA] Potki przed:", currentPotions);
    console.log("[TUNIA] Potki po:", finalPotions);
    console.log("[TUNIA] Kupiono:", finalPotions - currentPotions);
    console.log("[TUNIA] ========================================");
    
    return true;
  },

  // ====== IZOLOWANY TEST KUPOWANIA POTEK ======
  testBuyPotionsAtHealer: async function (targetAmount) {
    const heroLevel = window.Engine?.hero?.d?.lvl || 0;
    
    console.log("=================================================");
    console.log("[TEST POTEK] START - cel:", targetAmount, "potek");
    console.log("[TEST POTEK] Poziom postaci:", heroLevel);
    console.log("=================================================");

    // Dla postaci lvl >= 70 użyj Tunii Frupotius (lepsza)
    if (heroLevel >= 70) {
      console.log("[TEST POTEK] Poziom >= 70, używam Tunii Frupotius w Dom Tunii");
      try {
        // Ustaw targetPotions żeby tuniaSelling wiedziała ile kupić
        if (!window.MargonemAPI.state.exping_location) {
          window.MargonemAPI.state.exping_location = {};
        }
        window.MargonemAPI.state.exping_location.targetPotions = targetAmount;
        window.MargonemAPI.state.exping_location.potionsDebug = true; // włącz debug logi
        console.log("[TEST POTEK] Ustawiono targetPotions:", targetAmount);
        
        // Użyj nowej funkcji kupowania potek bezpośrednio
        await window.MargonemAPI.testBuyPotionsAtTunia(targetAmount);
        console.log("[TEST POTEK] testBuyPotionsAtTunia zakończone pomyślnie");
        return true;
      } catch (e) {
        console.log("[TEST POTEK] BŁĄD testBuyPotionsAtTunia:", e.message || e);
        return false;
      }
    }

    // Dla postaci < 70 lvl - użyj healerów
    console.log("[TEST POTEK] Poziom < 70, szukam najbliższego healera");
    
    const POTION_SELLERS = [
      { name: "Uzdrowicielka Emanilia", map: "Liściaste Rozstaje", x: 21, y: 51 },
      { name: "Mnich Seweryn", map: "Klasztor Różanitów - świątynia", x: 25, y: 8 },
      { name: "Uzdrowiciel Ypsli", map: "Mirvenis-Adur", x: 82, y: 7 },
      { name: "Jemenoss", map: "Mythar", x: 45, y: 13 },
      { name: "Kapłanka Hiada", map: "Thuzal", x: 52, y: 17 },
      { name: "Szalony Etrefan", map: "Eder", x: 56, y: 40 },
      { name: "Doktor Nad", map: "Nithal", x: 5, y: 48 },
      { name: "Uzdrowiciel Toramidamus", map: "Tuzmer", x: 26, y: 21 },
      { name: "Uzdrowicielka Halfinia", map: "Karka-han", x: 31, y: 38 },
      { name: "Wysoka kapłanka Gryfia", map: "Torneg", x: 79, y: 8 },
      { name: "Uzdrowicielka Makatara", map: "Ithan", x: 18, y: 15 },
      { name: "Uzdrowicielka Hiliko", map: "Werbin", x: 38, y: 16 }
    ];

    // 1. Sprawdzenie aktualnej lokacji
    const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
    const heroPos = {
      x: window.Engine?.hero?.x || window.Engine?.hero?.d?.x,
      y: window.Engine?.hero?.y || window.Engine?.hero?.d?.y
    };
    console.log("[TEST POTEK] Aktualna mapa:", currentMap);
    console.log("[TEST POTEK] Pozycja bohatera:", heroPos);
    console.log("[TEST POTEK] Złoto:", window.Engine?.hero?.d?.gold);
    console.log("[TEST POTEK] MaxHP:", window.Engine?.hero?.d?.warrior_stats?.maxhp);

    // 2. Policz aktualne leki
    const currentPotions = typeof policzLeczyPrzedmioty === 'function' ? policzLeczyPrzedmioty() : 0;
    console.log("[TEST POTEK] Aktualne leki w eq:", currentPotions);

    // 3. Znajdź najbliższego healera
    console.log("[TEST POTEK] Szukam najbliższego healera...");
    let selectedHealer = null;
    let distances = [];
    
    try {
      for (const seller of POTION_SELLERS) {
        try {
          const pathInfo = await window.MargonemAPI.navigation.findShortestPath(currentMap, seller.map);
          const dist = pathInfo?.distance ?? Infinity;
          distances.push({ name: seller.name, map: seller.map, distance: dist });
          console.log(`[TEST POTEK]   - ${seller.name} (${seller.map}): ${dist === Infinity ? 'NIEOSIĄGALNY' : dist + ' kroków'}`);
        } catch (e) {
          distances.push({ name: seller.name, map: seller.map, distance: Infinity });
          console.log(`[TEST POTEK]   - ${seller.name} (${seller.map}): BŁĄD - ${e.message}`);
        }
      }
      
      const sorted = distances.sort((a, b) => a.distance - b.distance);
      if (sorted[0] && sorted[0].distance !== Infinity) {
        selectedHealer = POTION_SELLERS.find(s => s.name === sorted[0].name);
      }
    } catch (e) {
      console.log("[TEST POTEK] Błąd szukania healera:", e.message);
    }

    if (!selectedHealer) {
      selectedHealer = POTION_SELLERS[0]; // fallback
      console.log("[TEST POTEK] Fallback na pierwszego healera:", selectedHealer.name);
    }

    console.log("[TEST POTEK] Wybrany healer:", selectedHealer.name, "mapa:", selectedHealer.map, "poz:", selectedHealer.x + "," + selectedHealer.y);

    // 4. Nawigacja do healera
    console.log("[TEST POTEK] Nawiguję do mapy:", selectedHealer.map);
    try {
      await window.MargonemAPI.exping.navigateToLocation(selectedHealer.map);
      console.log("[TEST POTEK] navigateToLocation zakończone");
    } catch (e) {
      console.log("[TEST POTEK] BŁĄD nawigacji:", e.message);
      return false;
    }

    // 5. Czekaj na mapę
    console.log("[TEST POTEK] Czekam na zmianę mapy...");
    try {
      await window.MargonemAPI.exping.waitForMapChange(selectedHealer.map);
      console.log("[TEST POTEK] Mapa zmieniona, aktualna:", window.MargonemAPI.navigation.getCurrentLocation());
    } catch (e) {
      console.log("[TEST POTEK] BŁĄD czekania na mapę:", e.message);
      return false;
    }

    // 6. Idź do healera
    console.log("[TEST POTEK] Idę do healera na pozycję:", selectedHealer.x, selectedHealer.y);
    window.Engine.hero.autoGoTo({ x: selectedHealer.x, y: selectedHealer.y }, false);
    try {
      await waitForPosition(selectedHealer.x, selectedHealer.y, 60000);
      console.log("[TEST POTEK] Dotarłem do healera");
    } catch (e) {
      console.log("[TEST POTEK] BŁĄD - nie dotarłem do healera:", e.message);
      return false;
    }

    // 7. Rozpocznij dialog
    console.log("[TEST POTEK] Zaczynam rozmowę z NPC...");
    window.Engine.hero.talkNearMob();
    await sleep(1000);

    // 8. Czekaj na okno dialogowe
    console.log("[TEST POTEK] Czekam na okno dialogowe...");
    const dialogueWindow = await Promise.race([
      waitForElement("div.dialogue-window.is-open"),
      sleep(8000).then(() => null)
    ]);

    if (!dialogueWindow) {
      console.log("[TEST POTEK] BŁĄD - okno dialogowe się nie otworzyło!");
      return false;
    }
    console.log("[TEST POTEK] Okno dialogowe otwarte");

    // 9. Znajdź opcję sklepu
    const answers = Array.from(document.querySelectorAll("li.dialogue-window-answer.answer"));
    console.log("[TEST POTEK] Opcje dialogowe (" + answers.length + "):");
    answers.forEach((a, i) => {
      const text = (a.textContent || "").trim();
      const hasShopClass = a.classList.contains("line_shop");
      console.log(`[TEST POTEK]   ${i+1}. "${text}" ${hasShopClass ? '[SKLEP]' : ''}`);
    });

    const shopOption = answers.find(a => a.classList.contains("line_shop")) 
      || answers.find(a => {
        const txt = (a.textContent || "").toLowerCase();
        return txt.includes("sklep") || txt.includes("handel") || txt.includes("kup") || txt.includes("sprzed");
      });

    if (!shopOption) {
      console.log("[TEST POTEK] BŁĄD - nie znaleziono opcji sklepu!");
      return false;
    }

    console.log("[TEST POTEK] Znaleziono opcję sklepu:", (shopOption.textContent || "").trim());

    // 10. Kliknij sklep
    const shopSpan = shopOption.querySelector("span") || shopOption;
    console.log("[TEST POTEK] Klikam opcję sklepu...");
    shopSpan.click();

    // 11. Czekaj na okno sklepu
    console.log("[TEST POTEK] Czekam na okno sklepu...");
    const shopWindow = await Promise.race([
      waitForElement("div.alerts-layer.layer div.border-window.ui-draggable.window-on-peak"),
      waitForElement("div.border-window.ui-draggable.window-on-peak div.shop-content"),
      sleep(8000).then(() => null)
    ]);

    if (!shopWindow) {
      console.log("[TEST POTEK] BŁĄD - okno sklepu się nie otworzyło!");
      return false;
    }
    console.log("[TEST POTEK] Okno sklepu otwarte");

    await sleep(1000);

    // 12. Przeszukaj przedmioty w sklepie
    const shopItems = window.Engine?.shop?.items || {};
    const shopItemIds = Object.keys(shopItems);
    console.log("[TEST POTEK] Przedmioty w sklepie (" + shopItemIds.length + "):");
    
    let healingPotions = [];
    for (const itemId of shopItemIds) {
      const item = shopItems[itemId];
      const stats = item?._cachedStats || {};
      const name = item?.name || "???";
      const price = item?.pr || 0;
      const hasLeczy = stats.leczy !== undefined;
      
      console.log(`[TEST POTEK]   ID:${itemId} "${name}" cena:${price} leczy:${hasLeczy ? stats.leczy : 'BRAK'}`);
      
      if (hasLeczy && stats.leczy > 0) {
        healingPotions.push({ id: itemId, name, price, healing: stats.leczy });
      }
    }

    if (healingPotions.length === 0) {
      console.log("[TEST POTEK] BŁĄD - brak potek leczących w sklepie!");
      window.Engine.shop.close();
      return false;
    }

    console.log("[TEST POTEK] Znalezione potki leczące:", healingPotions.length);

    // 13. Wybierz najlepszą potkę
    const maxHP = window.Engine?.hero?.d?.warrior_stats?.maxhp || 10000;
    console.log("[TEST POTEK] MaxHP bohatera:", maxHP);

    const bestPotionId = await wybierzIdNajlepszejPotki(maxHP);
    const bestPotion = shopItems[bestPotionId];
    
    if (!bestPotion || !bestPotion._cachedStats?.leczy) {
      console.log("[TEST POTEK] BŁĄD - nie można wybrać najlepszej potki!");
      console.log("[TEST POTEK] bestPotionId=", bestPotionId, "bestPotion=", bestPotion);
      window.Engine.shop.close();
      return false;
    }

    console.log("[TEST POTEK] Najlepsza potka: ID=", bestPotionId, "nazwa=", bestPotion.name, "leczy=", bestPotion._cachedStats.leczy);

    // 14. Oblicz ile kupić
    const currentHealItems = typeof policzLeczyPrzedmioty === 'function' ? policzLeczyPrzedmioty() : 0;
    const needToBuy = Math.max(0, targetAmount - currentHealItems);
    const gold = window.Engine?.hero?.d?.gold || 0;
    const potionPrice = bestPotion?.pr || 1;
    const canAfford = potionPrice > 0 ? Math.max(0, Math.floor(gold / potionPrice) - 1) : 45;
    const finalAmount = Math.min(needToBuy, canAfford, 45);

    console.log("[TEST POTEK] Kalkulacja zakupu:");
    console.log("[TEST POTEK]   - cel:", targetAmount);
    console.log("[TEST POTEK]   - mam:", currentHealItems);
    console.log("[TEST POTEK]   - potrzebuję:", needToBuy);
    console.log("[TEST POTEK]   - złoto:", gold);
    console.log("[TEST POTEK]   - cena potki:", potionPrice);
    console.log("[TEST POTEK]   - stać mnie na:", canAfford);
    console.log("[TEST POTEK]   - KUPUJĘ:", finalAmount);

    if (finalAmount <= 0) {
      console.log("[TEST POTEK] Nie muszę kupować więcej potek!");
      window.Engine.shop.close();
      return true;
    }

    // 15. Kupuj potki
    console.log("[TEST POTEK] Rozpoczynam kupowanie...");
    for (let i = 0; i < finalAmount; i++) {
      console.log(`[TEST POTEK] Kupuję potkę ${i+1}/${finalAmount}...`);
      await buyItem(bestPotionId);
      await sleep(500);
    }

    console.log("[TEST POTEK] Finalizuję zakup...");
    window.Engine.shop.basket.finalize();
    await sleep(1000);

    console.log("[TEST POTEK] Zamykam sklep...");
    window.Engine.shop.close();

    const finalPotionCount = typeof policzLeczyPrzedmioty === 'function' ? policzLeczyPrzedmioty() : 0;
    console.log("[TEST POTEK] Leki po zakupie:", finalPotionCount);
    console.log("=================================================");
    console.log("[TEST POTEK] ZAKOŃCZONO POMYŚLNIE");
    console.log("=================================================");
    return true;
  }
});

// Helper functions moved to src/utils/helpers.js

window.MargonemAPI.heroPositionMonitor.init()
