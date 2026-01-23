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
    const _0xee67a3 = window.Engine;
    if (!_0xee67a3 || !_0xee67a3.hero) {
      return null;
    }
    const _0x230d39 = _0xee67a3.hero;
    return {
      x: _0x230d39.lastServerX !== undefined ? _0x230d39.lastServerX : _0x230d39.d.x,
      y: _0x230d39.lastServerY !== undefined ? _0x230d39.lastServerY : _0x230d39.d.y
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
        Engine.hero.afterUpdate = (_0x4072ef, _0x342443, _0x4422f4) => {
          const _0x194c3f = _0x4072ef.back === 1 || (_0x342443.x !== Engine.hero.lastServerX || _0x342443.y !== Engine.hero.lastServerY) && Engine.lock.check() && Engine.stepsToSend.steps.length > 0;
          if (_0x194c3f) {
            this.onBackDetected(Engine.hero.lastServerX || _0x4072ef.x, Engine.hero.lastServerY || _0x4072ef.y);
          }
          return this.originalAfterUpdate.call(Engine.hero, _0x4072ef, _0x342443, _0x4422f4);
        };
        console.log("[MargonemAPI] Position monitor initialized");
        this.isInitialized = true;
      }
    },
    onBackDetected: function (_0x33910e, _0x59d092) {
      this.backDetected = true;
      this.lastBackTime = Date.now();
      const _0x223b6e = window.Engine;
      if (_0x223b6e && _0x223b6e.hero) {
        console.log("[MargonemAPI] Back detected! Server position: " + _0x33910e + "," + _0x59d092 + " vs Local position: " + _0x223b6e.hero.d.x + "," + _0x223b6e.hero.d.y);
      } else {
        console.log("[MargonemAPI] Back detected! Server position: " + _0x33910e + "," + _0x59d092);
      }
      if (window.MargonemAPI.combat && window.MargonemAPI.combat.handleBackEvent) {
        window.MargonemAPI.combat.handleBackEvent(_0x33910e, _0x59d092);
      }
    }
  },
  debug: {
    getPositionStatus: function () {
      const _0x2f3125 = window.Engine;
      if (!_0x2f3125 || !_0x2f3125.hero) {
        return "Engine or hero not available";
      }
      const _0x99df44 = Math.floor(parseFloat(_0x2f3125.hero.d.x || 0));
      const _0x54296b = Math.floor(parseFloat(_0x2f3125.hero.d.y || 0));
      const _0x4302ea = Math.floor(parseFloat(_0x2f3125.hero.lastServerX || _0x2f3125.hero.d.x || 0));
      const _0x229961 = Math.floor(parseFloat(_0x2f3125.hero.lastServerY || _0x2f3125.hero.d.y || 0));
      const _0x44b798 = {
        x: _0x99df44,
        y: _0x54296b
      };
      const _0x28a4ae = {
        x: _0x4302ea,
        y: _0x229961
      };
      return {
        localPosition: _0x44b798,
        serverPosition: _0x28a4ae,
        synced: _0x99df44 === _0x4302ea && _0x54296b === _0x229961,
        lastBackTime: window.MargonemAPI.heroPositionMonitor.lastBackTime,
        timeSinceLastBack: Date.now() - window.MargonemAPI.heroPositionMonitor.lastBackTime,
        backDetected: window.MargonemAPI.heroPositionMonitor.backDetected
      };
    }
  },
  navigation: {
    findShortestPath: function (startLocation, endLocation) {
      const _0xad4122 = window.MargonemAPI.state.navigation.locationData;
      startLocation = normalizeLocationName(startLocation);
      endLocation = normalizeLocationName(endLocation);
      if (!mapData[startLocation] || !mapData[endLocation]) {
        return {
          path: [],
          error: "Jedna z lokacji nie istnieje"
        };
      }
      const directConnection = mapData[startLocation].gateways.find(_0x471060 => normalizeLocationName(_0x471060.name) === endLocation);
      if (directConnection) {
        const _0x845680 = {
          x: directConnection.x,
          y: directConnection.y
        };
        const pathStep = {
          currentMap: startLocation,
          nextMap: endLocation,
          gateway: _0x845680
        };
        const _0x161c68 = [pathStep];
        const _0xf3c60c = {
          path: _0x161c68,
          distance: 1
        };
        return _0xf3c60c;
      }
      function _0x5c41da(_0x2b4f5f, _0x7e76ee) {
        const _0x3185e1 = mapData[_0x2b4f5f].gateways.some(_0x13f6e0 => normalizeLocationName(_0x13f6e0.name) === _0x7e76ee);
        const _0x2d569f = mapData[_0x7e76ee].gateways.some(_0x246f1e => normalizeLocationName(_0x246f1e.name) === _0x2b4f5f);
        return _0x3185e1 && _0x2d569f;
      }
      function _0x5eb040(_0x25f7c6) {
        return mapData[_0x25f7c6].gateways.map(_0x5cd804 => normalizeLocationName(_0x5cd804.name)).filter(_0x295270 => mapData[_0x295270] && _0x5c41da(_0x25f7c6, _0x295270));
      }
      function _0x64c884(_0x241ad5, _0x22666b) {
        const _0x491006 = mapData[_0x241ad5].gateways.find(_0xdba6b0 => normalizeLocationName(_0xdba6b0.name) === _0x22666b);
        if (_0x491006) {
          return {
            x: _0x491006.x,
            y: _0x491006.y
          };
        } else {
          return null;
        }
      }
      const distances = {};
      const previousNodes = {};
      const unvisitedSet = new Set();
      Object.keys(mapData).forEach(_0x13994f => {
        distances[_0x13994f] = Infinity;
        previousNodes[_0x13994f] = null;
        unvisitedSet.add(_0x13994f);
      });
      distances[startLocation] = 0;
      let _0x4d4241 = 0;
      const _0x6bc63b = 10000;
      while (unvisitedSet.size > 0 && _0x4d4241 < _0x6bc63b) {
        _0x4d4241++;
        let _0x2d330c = null;
        let _0x190149 = Infinity;
        for (const _0x58b814 of unvisitedSet) {
          if (distances[_0x58b814] < _0x190149) {
            _0x190149 = distances[_0x58b814];
            _0x2d330c = _0x58b814;
          }
        }
        if (_0x2d330c === null) {
          break;
        }
        if (_0x2d330c === endLocation) {
          break;
        }
        unvisitedSet.delete(_0x2d330c);
        const _0x4310f6 = _0x5eb040(_0x2d330c);
        for (const _0x4434c6 of _0x4310f6) {
          if (!unvisitedSet.has(_0x4434c6)) {
            continue;
          }
          const _0x13548e = distances[_0x2d330c] + 1;
          if (_0x13548e < distances[_0x4434c6]) {
            distances[_0x4434c6] = _0x13548e;
            previousNodes[_0x4434c6] = _0x2d330c;
          }
        }
      }
      if (distances[endLocation] === Infinity) {
        return {
          path: [],
          error: "Nie znaleziono ścieżki między lokacjami"
        };
      }
      const _0x293618 = [];
      let _0x4158e5 = endLocation;
      while (previousNodes[_0x4158e5] !== null) {
        const _0x151ebc = previousNodes[_0x4158e5];
        const _0x28c9df = _0x64c884(_0x151ebc, _0x4158e5);
        const _0xc1c795 = {
          currentMap: _0x151ebc,
          nextMap: _0x4158e5,
          gateway: _0x28c9df
        };
        _0x293618.unshift(_0xc1c795);
        _0x4158e5 = _0x151ebc;
      }
      const _0x11235f = {
        path: _0x293618,
        distance: distances[endLocation]
      };
      return _0x11235f;
    },
    getCurrentLocation: function () {
      const _0x5892d5 = window.Engine;
      if (!_0x5892d5 || !_0x5892d5.map) {
        return null;
      }
      const _0x17ca39 = _0x5892d5.map.d.name || null;
      return _0x17ca39;
    },
    goToLocation: async function (_0x5cd484) {
      if (!sessionToken) {
        return;
      }
      window.MargonemAPI.state.navigation.autoFight = setInterval(() => {
        try {
          window.Engine.battle.autoFight();
        } catch (_0x55092c) {}
      }, 1000);
      const _0x13cf85 = window.MargonemAPI.state.navigation;
      _0x13cf85.abortNavigation = false;
      const _0x1f3511 = this.getCurrentLocation();
      if (!_0x1f3511) {
        return false;
      }
      if (_0x1f3511 === _0x5cd484) {
        return true;
      }
      const _0x439aea = this.findShortestPath(_0x1f3511, _0x5cd484);
      if (_0x439aea.error || !_0x439aea.path.length) {
        return false;
      }
      _0x13cf85.currentPath = _0x439aea.path;
      _0x13cf85.currentPathIndex = 0;
      _0x13cf85.isNavigating = true;
      _0x13cf85.targetLocation = _0x5cd484;
      _0x13cf85.lastMoveTime = Date.now();
      this.processNextPathStep();
      clearInterval(_0x13cf85.pathCheckInterval);
      _0x13cf85.pathCheckInterval = setInterval(() => this.checkNavigationProgress(), 1000);
      return true;
    },
    processNextPathStep: async function () {
      const _0x4fa8a2 = window.MargonemAPI.state.navigation;
      if (_0x4fa8a2.abortNavigation) {
        return;
      }
      const _0x35ec09 = _0x4fa8a2.currentPath && _0x4fa8a2.currentPath[_0x4fa8a2.currentPathIndex];
      if (!_0x35ec09 || !_0x4fa8a2.isNavigating) {
        this.stopNavigation();
        return;
      }
      const _0x3802ea = _0x35ec09.gateway;
      if (_0x3802ea) {
        const _0xe393b0 = window.Engine;
        if (_0xe393b0 && _0xe393b0.hero) {
          const _0x157817 = Math.floor(_0xe393b0.hero.x || _0xe393b0.hero.d && _0xe393b0.hero.d.x);
          const _0x15cd69 = Math.floor(_0xe393b0.hero.y || _0xe393b0.hero.d && _0xe393b0.hero.d.y);
          if (_0x157817 === _0x3802ea.x && _0x15cd69 === _0x3802ea.y) {
            _0xe393b0.hero.getTroughGateway();
          } else if (Math.abs(_0x157817 - _0x3802ea.x) <= 1 && Math.abs(_0x15cd69 - _0x3802ea.y) <= 1) {
            _0xe393b0.hero.talkNearMob();
          }
          const _0x3fd22f = {
            x: _0x3802ea.x,
            y: _0x3802ea.y
          };
          _0xe393b0.hero.autoGoTo(_0x3fd22f, false);
          _0x4fa8a2.lastMoveTime = Date.now();
        }
      }
    },
    checkNavigationProgress: function () {
      const _0x1b0983 = window.MargonemAPI.state.navigation;
      if (_0x1b0983.abortNavigation || !_0x1b0983.isNavigating) {
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
      
      const _0x5c2b9d = this.getCurrentLocation();
      const _0x94856f = _0x1b0983.currentPath && _0x1b0983.currentPath[_0x1b0983.currentPathIndex];
      if (_0x94856f && _0x5c2b9d === _0x94856f.nextMap) {
        _0x1b0983.currentPathIndex++;
        if (_0x1b0983.currentPathIndex >= _0x1b0983.currentPath.length) {
          this.stopNavigation(true);
          return;
        }
        this.processNextPathStep();
      }
      const _0x28067f = Date.now() - _0x1b0983.lastMoveTime;
      if (_0x28067f > _0x1b0983.stuckCheckInterval) {
        this.processNextPathStep();
      }
      if (Date.now() - _0x1b0983.lastMoveTime > _0x1b0983.navigationTimeout) {
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
        const _0x855778 = {
          x: heroX,
          y: heroY
        };
        engineInstance.hero.autoGoTo(_0x855778);
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
          const _0x2b86fd = {
            min: targetOptions.levelRange.min || null,
            max: targetOptions.levelRange.max || null
          };
          combatState.levelRange = _0x2b86fd;
          combatState.selectedNicks = [];
        } else {
          combatState.selectedNicks = Array.isArray(targetOptions) ? targetOptions : [targetOptions];
        }
        combatState.autoFightActive = true;
        try {
          await Promise.race([window.MargonemAPI.combat.recoverySystem.startMonitoring(), new Promise((_0x18ff6e, _0x279756) => setTimeout(() => _0x279756(new Error("RECOVERY_SYSTEM_TIMEOUT")), 5000))]);
        } catch (_0x4924a8) {
          console.error("Error starting monitoring system:", _0x4924a8);
        }
        if (durationSeconds > 0) {
          combatState.fightEndTime = Date.now() + durationSeconds * 1000;
          combatState.timers.fight = setTimeout(() => {
            if (combatState.autoFightActive && this._activeSession === fightSessionId) {
              window.MargonemAPI.combat.stopFight();
            }
          }, durationSeconds * 1000);
        }
        await new Promise(_0xce5419 => setTimeout(_0xce5419, 500));
        if (combatState.autoFightActive && this._activeSession === fightSessionId) {
          window.MargonemAPI.combat.autoFight(fightSessionId);
        }
        const _0x27bb75 = {
          success: true,
          sessionId: fightSessionId
        };
        return _0x27bb75;
      } catch (_0x3f5e6e) {
        console.error("Error in startFight:", _0x3f5e6e);
        const _0x1b925f = {
          success: false,
          error: _0x3f5e6e.message || "UNKNOWN_ERROR",
          details: _0x3f5e6e.stack
        };
        return _0x1b925f;
      } finally {
        this._releaseLock("startFight");
      }
    },
    stopFight: function () {
      const apiState = window.MargonemAPI.state;
      const _0x142fdf = this._activeSession;
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
        apiState.timers.autoFightTimeouts.forEach(_0x2c3dd2 => clearTimeout(_0x2c3dd2));
        apiState.timers.autoFightTimeouts.clear();
      }
      if (apiState.timers.combatIntervals) {
        apiState.timers.combatIntervals.forEach(_0xd0dfe4 => clearInterval(_0xd0dfe4));
        apiState.timers.combatIntervals.clear();
      }
      if (apiState.pendingStopActions) {
        apiState.pendingStopActions.clear();
      }
      if (apiState.activeIntervals) {
        apiState.activeIntervals.forEach(_0x311b84 => clearInterval(_0x311b84));
        apiState.activeIntervals.clear();
      }
      if (apiState.activeTimeouts) {
        apiState.activeTimeouts.forEach(_0x3e58e6 => clearTimeout(_0x3e58e6));
        apiState.activeTimeouts.clear();
      }
      Object.keys(this._asyncLocks).forEach(_0x13efaa => {
        this._releaseLock(_0x13efaa);
      });
      if (window.MargonemAPI.navigation) {
        window.MargonemAPI.navigation.stopNavigation(false);
      }
      const _0x296e1f = window.Engine;
      if (_0x296e1f && _0x296e1f.hero) {
        try {
          const _0x2a0a26 = Math.floor(_0x296e1f.hero.x || _0x296e1f.hero.d && _0x296e1f.hero.d.x || 0);
          const _0x377ea7 = Math.floor(_0x296e1f.hero.y || _0x296e1f.hero.d && _0x296e1f.hero.d.y || 0);
          if (!isNaN(_0x2a0a26) && !isNaN(_0x377ea7)) {
            const _0x2ead3d = {
              x: _0x2a0a26,
              y: _0x377ea7
            };
            _0x296e1f.hero.autoGoTo(_0x2ead3d);
          }
        } catch (_0x37e8f7) {
          console.error("Error stopping hero movement:", _0x37e8f7);
        }
      }
      const _0x413585 = {
        success: true,
        stoppedSession: _0x142fdf
      };
      return _0x413585;
    },
    isMobBlocked: function (_0x3566d1) {
      return window.MargonemAPI.state.blockedMobs.has(_0x3566d1);
    },
    clearBlockedMobs: function () {
      const _0xa17688 = window.MargonemAPI.state;
      _0xa17688.blockedMobs.clear();
      _0xa17688.lastAttemptedMobs = [];
    },
    autoFight: async function (_0x1021e6) {
      if (this._activeSession !== _0x1021e6) {
        return {
          success: false,
          error: "SESSION_MISMATCH"
        };
      }
      const _0x15b420 = window.MargonemAPI.state;
      if (_0x15b420.handlingBackEvent) {
        setTimeout(() => {
          if (_0x15b420.autoFightActive && this._activeSession === _0x1021e6 && !this.stopRequested) {
            this.autoFight(_0x1021e6);
          }
        }, 50);
        return {
          success: false,
          error: "HANDLING_BACK_EVENT"
        };
      }
      const _0x32a3a6 = Date.now() - (window.MargonemAPI.heroPositionMonitor.lastBackTime || 0);
      if (_0x32a3a6 < 300) {
        setTimeout(() => {
          if (_0x15b420.autoFightActive && this._activeSession === _0x1021e6 && !this.stopRequested) {
            this.autoFight(_0x1021e6);
          }
        }, 300 - _0x32a3a6);
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
        if (_0x15b420.autoFightInProgress) {
          return {
            success: false,
            error: "ALREADY_FIGHTING"
          };
        }
        if (!_0x15b420.autoFightActive) {
          return {
            success: false,
            error: "AUTOFIGHT_INACTIVE"
          };
        }
        _0x15b420.autoFightInProgress = true;
        const _0x535cb2 = window.Engine;
        if (!_0x535cb2) {
          if (_0x15b420.autoFightActive && this._activeSession === _0x1021e6) {
            let _0x3675c2 = setTimeout(() => {
              if (_0x15b420.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === _0x1021e6) {
                window.MargonemAPI.combat.autoFight(_0x1021e6);
              }
            }, 5000);
            _0x15b420.timers.autoFightTimeouts.add(_0x3675c2);
          }
          return {
            success: false,
            error: "ENGINE_NOT_READY"
          };
        } else if (!_0x15b420.allMobs.length) {
          _0x15b420.map_cleaned = true;
          return {
            success: true,
            status: "MAP_CLEANED"
          };
        }
        let _0x1c6f77;
        try {
          const _0x1c7b19 = Promise.race([new Promise(_0x4af2d3 => {
            _0x1c6f77 = window.MargonemAPI.combat.findNearestMob();
            _0x4af2d3(_0x1c6f77);
          }), new Promise((_0x281318, _0x3c545f) => setTimeout(() => _0x3c545f(new Error("FIND_MOB_TIMEOUT")), 3000))]);
          _0x1c6f77 = await _0x1c7b19;
        } catch (_0x1e82b1) {
          console.error("Error finding nearest mob:", _0x1e82b1);
          if (_0x15b420.autoFightActive && this._activeSession === _0x1021e6) {
            let _0x4104fc = setTimeout(() => {
              if (_0x15b420.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === _0x1021e6) {
                window.MargonemAPI.combat.autoFight(_0x1021e6);
              }
            }, 2000);
            _0x15b420.timers.autoFightTimeouts.add(_0x4104fc);
          }
          const _0x1bf7ce = {
            success: false,
            error: _0x1e82b1.message || "FIND_MOB_ERROR"
          };
          return _0x1bf7ce;
        }
        if (_0x1c6f77) {
          try {
            await Promise.race([window.MargonemAPI.combat.goFightMob(_0x1c6f77.id, _0x1c6f77.x, _0x1c6f77.y, _0x1021e6), new Promise((_0x13686d, _0x34bc6e) => setTimeout(() => _0x34bc6e(new Error("GO_FIGHT_MOB_TIMEOUT")), 10000))]);
            if (!_0x15b420.autoFightActive || this._activeSession !== _0x1021e6) {
              return;
            }
            window.MargonemAPI.combat.recoverySystem.updateLastActionTime();
          } catch (_0x426654) {
            console.error("Error in goFightMob:", _0x426654);
            if (_0x426654.message.includes("TIMEOUT")) {
              _0x15b420.blockedMobs.add(_0x1c6f77.id);
            }
            if (_0x15b420.autoFightActive && this._activeSession === _0x1021e6) {
              let _0x281380 = setTimeout(() => {
                if (_0x15b420.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === _0x1021e6) {
                  window.MargonemAPI.combat.autoFight(_0x1021e6);
                }
              }, 2000);
              _0x15b420.timers.autoFightTimeouts.add(_0x281380);
            }
          }
        } else if (_0x15b420.autoFightActive && this._activeSession === _0x1021e6) {
          let _0xb496f5 = setTimeout(() => {
            if (_0x15b420.autoFightActive && !window.MargonemAPI.combat.stopRequested && this._activeSession === _0x1021e6) {
              window.MargonemAPI.combat.autoFight(_0x1021e6);
            }
          }, 2000);
          _0x15b420.timers.autoFightTimeouts.add(_0xb496f5);
        }
        return {
          success: true
        };
      } catch (_0x3905cf) {
        console.error("Unexpected error in autoFight:", _0x3905cf);
        const _0x5a85db = {
          success: false,
          error: _0x3905cf.message || "UNEXPECTED_ERROR",
          details: _0x3905cf.stack
        };
        return _0x5a85db;
      } finally {
        _0x15b420.autoFightInProgress = false;
        this._releaseLock("autoFight");
      }
    },
    handleBackEvent: function (_0x342c4d, _0x58ed77) {
      if (!this._activeSession) {
        return;
      }
      const _0x195ab3 = window.MargonemAPI.state;
      Object.keys(this._asyncLocks).forEach(_0x220ad7 => {
        if (_0x220ad7.startsWith("goFightMob")) {
          this._releaseLock(_0x220ad7);
        }
      });
      if (_0x195ab3.timers.combatIntervals) {
        _0x195ab3.timers.combatIntervals.forEach(_0x14c296 => {
          clearInterval(_0x14c296);
        });
        _0x195ab3.timers.combatIntervals.clear();
      }
      _0x195ab3.handlingBackEvent = true;
      this.recoverySystem.updateLastActionTime();
      const _0x3c765b = this._activeSession;
      setTimeout(() => {
        _0x195ab3.handlingBackEvent = false;
        if (_0x195ab3.autoFightActive && this._activeSession === _0x3c765b && !this.stopRequested) {
          this.autoFight(_0x3c765b);
        }
      }, 50);
    },
    clickInterface: async function (_0x20692e, _0x5f0818 = [], _0x1ab946 = 3000, _0x4f33b8 = "button") {
      const _0x25a41f = document.querySelector(_0x20692e);
      if (!_0x25a41f) {
        console.warn(_0x4f33b8 + " not found: " + _0x20692e);
        return {
          success: false,
          error: "ELEMENT_NOT_FOUND"
        };
      }
      try {
        _0x25a41f.click();
        console.log("Clicked " + _0x4f33b8 + ": " + _0x20692e);
        if (_0x5f0818.length > 0) {
          for (const _0x5e191e of _0x5f0818) {
            const _0x1a31a0 = Date.now();
            let _0x1360b1 = false;
            while (Date.now() - _0x1a31a0 < (_0x5e191e.timeoutMs || _0x1ab946)) {
              const _0x4b2ce2 = document.querySelector(_0x5e191e.selector);
              if (_0x4b2ce2 !== null === _0x5e191e.shouldExist) {
                _0x1360b1 = true;
                break;
              }
              await new Promise(_0x5a4323 => setTimeout(_0x5a4323, 100));
            }
            if (!_0x1360b1) {
              const _0x3eaaa1 = {
                success: false,
                error: "CLICK_VERIFICATION_FAILED",
                details: "Expected element " + _0x5e191e.selector + " to " + (_0x5e191e.shouldExist ? "exist" : "not exist")
              };
              return _0x3eaaa1;
            }
          }
        }
        return {
          success: true
        };
      } catch (_0x57bd3d) {
        console.error("Error clicking " + _0x4f33b8 + ":", _0x57bd3d);
        const _0x3d5a74 = {
          success: false,
          error: "CLICK_ERROR",
          details: _0x57bd3d.message
        };
        return _0x3d5a74;
      }
    },
    goFightMob: async function (_0x5b6e74, _0x282eff, _0x44cd12, _0x47f42c) {
      const _0x156ded = window.MargonemAPI.state;
      const _0x318003 = window.Engine;
      const _0x34b734 = "goFightMob_" + _0x5b6e74;
      if (!_0x318003 || !_0x318003.hero) {
        return {
          success: false,
          error: "ENGINE_NOT_READY"
        };
      }
      if (_0x156ded.handlingBackEvent) {
        return {
          success: false,
          error: "HANDLING_BACK_EVENT"
        };
      }
      if (!(await this._acquireLock(_0x34b734, 8000))) {
        return {
          success: false,
          error: "MOB_MOVEMENT_IN_PROGRESS"
        };
      }
      try {
        _0x282eff = parseFloat(_0x282eff);
        _0x44cd12 = parseFloat(_0x44cd12);
        if (isNaN(_0x282eff) || isNaN(_0x44cd12)) {
          return {
            success: false,
            error: "INVALID_COORDINATES"
          };
        }
        if (!window.MargonemAPI.heroPositionMonitor.isInitialized) {
          window.MargonemAPI.heroPositionMonitor.init();
        }
        window.MargonemAPI.heroPositionMonitor.backDetected = false;
        const _0x4abc44 = {
          x: _0x282eff,
          y: _0x44cd12
        };
        _0x318003.hero.autoGoTo(_0x4abc44, false);
        _0x156ded.currentTargetId = _0x5b6e74;
        return new Promise((_0x33db11, _0xc976e0) => {
          const _0x4de81e = setInterval(async () => {
            if (window.MargonemAPI.heroPositionMonitor.backDetected) {
              clearInterval(_0x4de81e);
              _0x156ded.timers.combatIntervals.delete(_0x4de81e);
              _0xc976e0(new Error("BACK_DETECTED"));
              return;
            }
            if (!_0x156ded.autoFightActive || window.MargonemAPI.combat.stopRequested || this._activeSession !== _0x47f42c) {
              clearInterval(_0x4de81e);
              _0x156ded.timers.combatIntervals.delete(_0x4de81e);
              _0xc976e0(new Error("SESSION_CANCELLED"));
              return;
            }
            const _0x415395 = _0x318003.hero;
            if (!_0x415395) {
              _0xc976e0(new Error("HERO_NOT_FOUND"));
              return;
            }
            try {
              const _0x42d1af = Math.floor(parseFloat(_0x415395.x || _0x415395.d && _0x415395.d.x || 0));
              const _0x498f0b = Math.floor(parseFloat(_0x415395.y || _0x415395.d && _0x415395.d.y || 0));
              if (isNaN(_0x42d1af) || isNaN(_0x498f0b)) {
                console.warn("Invalid hero coordinates");
                return;
              }
              const _0x2268b5 = Math.abs(_0x42d1af - Math.floor(_0x282eff));
              const _0x541851 = Math.abs(_0x498f0b - Math.floor(_0x44cd12));
              if (_0x2268b5 <= 1 && _0x541851 <= 1) {
                clearInterval(_0x4de81e);
                _0x156ded.timers.combatIntervals.delete(_0x4de81e);
                if (_0x318003.interface && typeof _0x318003.interface.clickAutofightNearMob === "function") {
                  if (!_0x156ded.autoFightActive || this._activeSession !== _0x47f42c) {
                    _0xc976e0(new Error("SESSION_CANCELLED"));
                    return;
                  }
                  if (typeof window.lastClickAutofightTime === "undefined") {
                    window.lastClickAutofightTime = 0;
                  }
                  const _0x372095 = Date.now();
                  if (_0x372095 - window.lastClickAutofightTime >= 1000) {
                    window.lastClickAutofightTime = _0x372095;
                    try {
                      await Promise.race([new Promise(_0x103667 => {
                        _0x318003.interface.clickAutofightNearMob();
                        _0x103667();
                      }), new Promise((_0x1c82b8, _0x46a1f1) => setTimeout(() => _0x46a1f1(new Error("CLICK_TIMEOUT")), 2000))]);
                      window.MargonemAPI.combat.recoverySystem.updateLastActionTime();
                      setTimeout(async () => {
                        if (!_0x156ded.autoFightActive || this._activeSession !== _0x47f42c) {
                          return;
                        }
                        const _0x4274b8 = await window.MargonemAPI.combat.clickInterface("div.button.green.close-battle-ground.small", [{
                          selector: "div.button.green.close-battle-ground.small",
                          shouldExist: false
                        }], 300, "close battle button");
                        if (!_0x156ded.autoFightActive || this._activeSession !== _0x47f42c) {
                          return;
                        }
                        const _0x29727f = await window.MargonemAPI.combat.clickInterface(".accept-button .button.green.small", [{
                          selector: ".accept-button",
                          shouldExist: false
                        }], 300, "accept button");
                        if (_0x156ded.autoFightActive && !_0x156ded.autoFightInProgress && this._activeSession === _0x47f42c) {
                          window.MargonemAPI.combat.autoFight(_0x47f42c);
                        }
                      }, 100);
                      _0x33db11({
                        success: true
                      });
                    } catch (_0x56d398) {
                      console.error("Error in fight sequence:", _0x56d398);
                      if (_0x156ded.autoFightActive && !_0x156ded.autoFightInProgress && this._activeSession === _0x47f42c) {
                        setTimeout(() => {
                          if (_0x156ded.autoFightActive && this._activeSession === _0x47f42c) {
                            window.MargonemAPI.combat.autoFight(_0x47f42c);
                          }
                        }, 500);
                      }
                      const _0x18ca19 = {
                        success: false,
                        error: _0x56d398.message
                      };
                      _0x33db11(_0x18ca19);
                    }
                  } else {
                    console.warn("Click throttled, waiting");
                    setTimeout(() => {
                      if (_0x156ded.autoFightActive && this._activeSession === _0x47f42c) {
                        window.MargonemAPI.combat.autoFight(_0x47f42c);
                      }
                    }, 500);
                    _0x33db11({
                      success: false,
                      error: "CLICK_THROTTLED"
                    });
                  }
                } else {
                  if (_0x156ded.autoFightActive && !_0x156ded.autoFightInProgress && this._activeSession === _0x47f42c) {
                    setTimeout(() => {
                      if (_0x156ded.autoFightActive && this._activeSession === _0x47f42c) {
                        window.MargonemAPI.combat.autoFight(_0x47f42c);
                      }
                    }, 500);
                  }
                  _0x33db11({
                    success: false,
                    error: "INTERFACE_NOT_READY"
                  });
                }
              }
            } catch (_0x46149d) {
              console.error("Error in movement check:", _0x46149d);
            }
          }, 250);
          _0x156ded.timers.combatIntervals.add(_0x4de81e);
        });
      } catch (_0x16b6f4) {
        console.error("Error in goFightMob:", _0x16b6f4);
        if (_0x16b6f4.message === "BACK_DETECTED") {
          const _0x7d9874 = this._activeSession;
          setTimeout(() => {
            if (_0x156ded.autoFightActive && this._activeSession === _0x7d9874 && !this.stopRequested) {
              this.autoFight(_0x7d9874);
            }
          }, 50);
        }
        const _0x3d751e = {
          success: false,
          error: _0x16b6f4.message || "UNEXPECTED_ERROR",
          details: _0x16b6f4.stack
        };
        return _0x3d751e;
      } finally {
        this._releaseLock(_0x34b734);
      }
    },
    findNearestMob: function () {
      try {
        if (!window.MargonemAPI.heroPositionMonitor.isInitialized) {
          window.MargonemAPI.heroPositionMonitor.init();
        }
        const _0x3d0b26 = window.MargonemAPI.state;
        const _0x4b7fd9 = window.Engine;
        if (!_0x4b7fd9?.hero) {
          return null;
        }
        window.MargonemAPI.pathfinding.initializeCollisionGrid();
        const _0x4055c0 = window.MargonemAPI.getServerPosition();
        const _0x2b573f = Math.floor(_0x4055c0?.x || _0x4b7fd9.hero.lastServerX || _0x4b7fd9.hero.d.x || 0);
        const _0x416e53 = Math.floor(_0x4055c0?.y || _0x4b7fd9.hero.lastServerY || _0x4b7fd9.hero.d.y || 0);
        const _0x369360 = _0x4b7fd9.hero.lvl || _0x4b7fd9.hero.d && _0x4b7fd9.hero.d.lvl || 1;
        if (isNaN(_0x2b573f) || isNaN(_0x416e53)) {
          const _0x5a9265 = {
            heroX: _0x2b573f,
            heroY: _0x416e53
          };
          console.error("Invalid hero position:", _0x5a9265);
          return null;
        }
        const _0x32cf78 = _0x3d0b26.allMobs.filter(_0x3e67b3 => {
          const _0x2c2842 = _0x3d0b26.blockedMobs.has(_0x3e67b3.id);
          const _0x43c096 = _0x3d0b26.levelRange.min !== null || _0x3d0b26.levelRange.max !== null;
          let _0x11dc11 = false;
          if (_0x43c096) {
            const _0x261d15 = _0x3d0b26.levelRange.min || 1;
            const _0x4201b8 = _0x3d0b26.levelRange.max || 300;
            _0x11dc11 = _0x3e67b3.lvl >= _0x261d15 && _0x3e67b3.lvl <= _0x4201b8;
          } else {
            _0x11dc11 = _0x3d0b26.selectedNicks.includes(_0x3e67b3.nick);
          }
          return _0x11dc11 && !_0x2c2842;
        });
        if (_0x32cf78.length === 0) {
          _0x3d0b26.map_cleaned = true;
          return null;
        }
        let _0x40076a = null;
        let _0x4e0360 = Infinity;
        const _0x55d4af = [..._0x32cf78].sort((_0xaa1e1e, _0x133d59) => {
          const _0x56b804 = Math.abs(_0xaa1e1e.x - _0x2b573f) + Math.abs(_0xaa1e1e.y - _0x416e53);
          const _0x331593 = Math.abs(_0x133d59.x - _0x2b573f) + Math.abs(_0x133d59.y - _0x416e53);
          return _0x56b804 - _0x331593;
        });
        const _0x24841e = _0x55d4af.slice(0, 10);
        for (const _0x4914dc of _0x24841e) {
          const _0x1234fe = Math.abs(_0x4914dc.x - _0x2b573f) + Math.abs(_0x4914dc.y - _0x416e53);
          if (_0x1234fe >= _0x4e0360) {
            continue;
          }
          let _0x232f77 = null;
          try {
            _0x232f77 = window.MargonemAPI.pathfinding.findPathWithBackHandling(_0x2b573f, _0x416e53, Math.floor(_0x4914dc.x), Math.floor(_0x4914dc.y));
          } catch (_0x1435e8) {
            console.error("Pathfinding error:", _0x1435e8);
            continue;
          }
          if (!_0x232f77 || _0x232f77.length === 0) {
            continue;
          }
          const _0x321ed1 = _0x232f77.length - 1;
          if (_0x321ed1 < _0x4e0360) {
            _0x4e0360 = _0x321ed1;
            _0x40076a = _0x4914dc;
          }
        }
        if (!_0x40076a) {
          _0x3d0b26.map_cleaned = true;
          return null;
        }
        return _0x40076a;
      } catch (_0x3bb001) {
        console.error("Error in enhanced findNearestMob:", _0x3bb001);
        const _0x36e3db = window.MargonemAPI.state;
        const _0x103233 = window.Engine;
        if (!_0x103233?.hero) {
          return null;
        }
        try {
          window.MargonemAPI.pathfinding.initializeCollisionGrid();
          const _0x2d10e7 = Math.floor(_0x103233.hero.x || _0x103233.hero.d && _0x103233.hero.d.x || 0);
          const _0x33b82a = Math.floor(_0x103233.hero.y || _0x103233.hero.d && _0x103233.hero.d.y || 0);
          const _0x2d4c45 = _0x103233.hero.lvl || _0x103233.hero.d && _0x103233.hero.d.lvl || 1;
          if (isNaN(_0x2d10e7) || isNaN(_0x33b82a)) {
            const _0x536828 = {
              heroX: _0x2d10e7,
              heroY: _0x33b82a
            };
            console.error("Invalid hero position:", _0x536828);
            return null;
          }
          const _0x1727c3 = _0x36e3db.allMobs.filter(_0x3a80c2 => {
            const _0x476864 = _0x36e3db.blockedMobs.has(_0x3a80c2.id);
            const _0x3a9d9b = _0x36e3db.levelRange.min !== null || _0x36e3db.levelRange.max !== null;
            let _0x4c3554 = false;
            if (_0x3a9d9b) {
              const _0x4982fa = _0x36e3db.levelRange.min || 1;
              const _0x25bd10 = _0x36e3db.levelRange.max || 300;
              _0x4c3554 = _0x3a80c2.lvl >= _0x4982fa && _0x3a80c2.lvl <= _0x25bd10;
            } else {
              _0x4c3554 = _0x36e3db.selectedNicks.includes(_0x3a80c2.nick);
            }
            return _0x4c3554 && !_0x476864;
          });
          if (_0x1727c3.length === 0) {
            _0x36e3db.map_cleaned = true;
            return null;
          }
          let _0x1616ad = null;
          let _0x1eff41 = Infinity;
          const _0x530a71 = [..._0x1727c3].sort((_0xb23dd3, _0x4fe3b8) => {
            const _0x5135b1 = Math.abs(_0xb23dd3.x - _0x2d10e7) + Math.abs(_0xb23dd3.y - _0x33b82a);
            const _0x37ae62 = Math.abs(_0x4fe3b8.x - _0x2d10e7) + Math.abs(_0x4fe3b8.y - _0x33b82a);
            return _0x5135b1 - _0x37ae62;
          });
          const _0x13cd1a = _0x530a71.slice(0, 10);
          for (const _0x39999f of _0x13cd1a) {
            const _0x3c1907 = Math.abs(_0x39999f.x - _0x2d10e7) + Math.abs(_0x39999f.y - _0x33b82a);
            if (_0x3c1907 >= _0x1eff41) {
              continue;
            }
            let _0xb545e8 = false;
            let _0x1a4d72 = null;
            try {
              _0xb545e8 = true;
              _0x1a4d72 = window.MargonemAPI.pathfinding.findPath(_0x2d10e7, _0x33b82a, Math.floor(_0x39999f.x), Math.floor(_0x39999f.y));
            } catch (_0x2b605c) {
              console.error("Pathfinding error:", _0x2b605c);
              _0xb545e8 = false;
            }
            if (!_0xb545e8 || !_0x1a4d72 || _0x1a4d72.length === 0) {
              continue;
            }
            const _0x40179f = _0x1a4d72.length - 1;
            if (_0x40179f < _0x1eff41) {
              _0x1eff41 = _0x40179f;
              _0x1616ad = _0x39999f;
            }
          }
          if (!_0x1616ad) {
            _0x36e3db.map_cleaned = true;
            return null;
          }
          return _0x1616ad;
        } catch (_0x1d8fe3) {
          console.error("Fallback error in findNearestMob:", _0x1d8fe3);
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
      async _acquireLock(_0x46eb48, _0x8eaa8b = 5000) {
        if (this._asyncLocks[_0x46eb48]) {
          return false;
        }
        this._asyncLocks[_0x46eb48] = {
          acquired: true,
          time: Date.now(),
          timeout: setTimeout(() => {
            console.warn("Force releasing recovery lock: " + _0x46eb48 + " due to timeout");
            this._releaseLock(_0x46eb48);
          }, _0x8eaa8b)
        };
        return true;
      },
      _releaseLock(_0x584c18) {
        if (this._asyncLocks[_0x584c18]) {
          if (this._asyncLocks[_0x584c18].timeout) {
            clearTimeout(this._asyncLocks[_0x584c18].timeout);
          }
          delete this._asyncLocks[_0x584c18];
        }
      },
      getNetworkAdjustedTimeout(_0x237cd7) {
        const _0x23de16 = {
          good: 1,
          medium: 1.5,
          poor: 2.5
        };
        return _0x237cd7 * _0x23de16[this.state.networkQuality];
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
              const _0x270789 = document.querySelector("div.button.green.auto-fight-btn.small");
              if (_0x270789) {
                await window.MargonemAPI.combat.clickInterface("div.button.green.auto-fight-btn.small", [], 2000, "auto fight button");
              }
            } catch (_0x1cd99d) {
              console.error("Error clicking auto-fight button:", _0x1cd99d);
            }
          }, 1000);
          this.state.checkIntervalId = setInterval(async () => {
            if (!this.state.monitoringActive || this.stopRequested) {
              return;
            }
            try {
              await this.checkState();
            } catch (_0x3d1d63) {
              console.error("Error in checkState:", _0x3d1d63);
            }
          }, this.config.checkInterval);
          return {
            success: true
          };
        } catch (_0x3f038e) {
          console.error("Error starting monitoring:", _0x3f038e);
          const _0xc3a310 = {
            success: false,
            error: _0x3f038e.message || "MONITORING_ERROR",
            details: _0x3f038e.stack
          };
          return _0xc3a310;
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
          Object.keys(this._asyncLocks).forEach(_0x148594 => {
            this._releaseLock(_0x148594);
          });
          return {
            success: true
          };
        } catch (_0x4521ea) {
          console.error("Error stopping monitoring:", _0x4521ea);
          const _0x58b6b1 = {
            success: false,
            error: _0x4521ea.message
          };
          return _0x58b6b1;
        }
      },
      updateLastActionTime: function () {
        if (!this.state.monitoringActive) {
          return false;
        }
        const _0xdff358 = Date.now();
        const _0x311397 = _0xdff358 - (this.state.lastActionTime || 0);
        if (_0x311397 > 8000 && this.state.networkQuality !== "poor") {
          this.state.networkQuality = "poor";
          console.warn("Network quality set to poor");
        } else if (_0x311397 > 3000 && this.state.networkQuality !== "medium") {
          this.state.networkQuality = "medium";
          console.log("Network quality set to medium");
        } else if (_0x311397 < 1000 && this.state.networkQuality !== "good") {
          this.state.networkQuality = "good";
          console.log("Network quality set to good");
        }
        this.state.lastActionTime = _0xdff358;
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
          const _0x68330d = Date.now() - (this.state.lastActionTime || Date.now());
          const _0x15cfa3 = this.getNetworkAdjustedTimeout(this.config.activityTimeout);
          if (!this.state.recoveryActive && _0x68330d > _0x15cfa3) {
            return await this.initiateRecovery();
          }
          return {
            success: true,
            status: "OK"
          };
        } catch (_0x575df4) {
          console.error("Error in checkState:", _0x575df4);
          const _0x3e5f91 = {
            success: false,
            error: _0x575df4.message || "CHECK_ERROR",
            details: _0x575df4.stack
          };
          return _0x3e5f91;
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
          const _0x16da65 = this.config.maxRetries;
          const _0x456cd0 = this.config.retryDelay;
          if (this.state.recoveryActive || this.state.retryCount >= _0x16da65) {
            return await this.fullSystemReset();
          }
          this.state.recoveryActive = true;
          this.state.retryCount++;
          const _0x1ea16b = _0x456cd0 * Math.pow(2, this.state.retryCount - 1);
          console.log("Recovery attempt " + this.state.retryCount + "/" + _0x16da65 + " with delay " + _0x1ea16b + "ms");
          return await this.executeRecoverySequence(_0x1ea16b);
        } catch (_0x579382) {
          console.error("Error in initiateRecovery:", _0x579382);
          const _0x569b04 = {
            success: false,
            error: _0x579382.message || "RECOVERY_ERROR",
            details: _0x579382.stack
          };
          return _0x569b04;
        } finally {
          this._releaseLock("initiateRecovery");
        }
      },
      async executeRecoverySequence(_0x52c218 = this.config.retryDelay) {
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
          const _0x1bcc6c = this.closeAllDialogs();
          window.MargonemAPI.combat.clearBlockedMobs();
          await _0x1bcc6c;
          if (this.state.retryCount === 1) {
            _0x52c218 = Math.min(_0x52c218, 200);
          } else {
            _0x52c218 = Math.min(_0x52c218, 500);
          }
          await new Promise(_0x57f9e4 => setTimeout(_0x57f9e4, _0x52c218));
          if (!this.state.monitoringActive || this.stopRequested) {
            return {
              success: false,
              error: "MONITORING_STOPPED_DURING_RECOVERY"
            };
          }
          if (window.MargonemAPI.state.autoFightActive) {
            if (!this.stopRequested) {
              const _0x4b03a2 = window.MargonemAPI.combat._activeSession;
              if (_0x4b03a2) {
                setTimeout(() => {
                  window.MargonemAPI.combat.autoFight(_0x4b03a2);
                }, 10);
              }
            }
            this.updateLastActionTime();
          }
          return {
            success: true
          };
        } catch (_0x3c2da8) {
          console.error("Error in executeRecoverySequence:", _0x3c2da8);
          const _0x429423 = {
            success: false,
            error: _0x3c2da8.message || "RECOVERY_SEQUENCE_ERROR",
            details: _0x3c2da8.stack
          };
          return _0x429423;
        } finally {
          this._releaseLock("executeRecoverySequence");
        }
      },
      closeAllDialogs: async function () {
        const _0x2744cf = [{
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
        const _0x3313a6 = _0x2744cf.map(_0x23df43 => {
          return window.MargonemAPI.combat.clickInterface(_0x23df43.selector, [], 200, _0x23df43.desc).catch(_0x550c36 => ({
            success: false,
            error: _0x550c36.message
          }));
        });
        await Promise.all(_0x3313a6);
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
          const _0x2b131f = {
            min: window.MargonemAPI.state.levelRange.min || null,
            max: window.MargonemAPI.state.levelRange.max || null
          };
          const _0x410139 = _0x2b131f;
          const _0x1780f5 = [...window.MargonemAPI.state.selectedNicks];
          window.MargonemAPI.combat.stopFight();
          this.state.recoveryActive = false;
          this.state.retryCount = 0;
          await new Promise(_0x45d408 => setTimeout(_0x45d408, 5000));
          if (!this.state.monitoringActive) {
            return {
              success: false,
              error: "MONITORING_STOPPED_DURING_RESET"
            };
          }
          if (_0x410139.min !== null || _0x410139.max !== null) {
            const _0x1a6db6 = {
              min: _0x410139.min || 1,
              max: _0x410139.max || 300
            };
            const _0x1ea51b = {
              levelRange: _0x1a6db6
            };
            return await window.MargonemAPI.combat.startFight(_0x1ea51b);
          } else if (_0x1780f5.length > 0) {
            return await window.MargonemAPI.combat.startFight(_0x1780f5);
          }
          return {
            success: true
          };
        } catch (_0xf40abb) {
          console.error("Error in fullSystemReset:", _0xf40abb);
          const _0x291844 = {
            success: false,
            error: _0xf40abb.message || "SYSTEM_RESET_ERROR",
            details: _0xf40abb.stack
          };
          return _0x291844;
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
      const _0x3b481b = setInterval(() => {
        const _0x3cbed1 = window.Engine;
        if (_0x3cbed1?.dead !== undefined) {
          clearInterval(_0x3b481b);
          let _0x53c0e9 = _0x3cbed1.dead;
          Object.defineProperty(_0x3cbed1, "dead", {
            get() {
              return _0x53c0e9;
            },
            set(_0x1352e0) {
              const _0x570f23 = _0x53c0e9 && !_0x1352e0;
              _0x53c0e9 = _0x1352e0;
              if (_0x570f23 && window.MargonemAPI.state.heal.healAfterDeath) {
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
      const _0x2a182f = window.MargonemAPI.state.heal;
      if (_0x2a182f.monitoringInterval) {
        clearInterval(_0x2a182f.monitoringInterval);
        _0x2a182f.monitoringInterval = null;
      }
      _0x2a182f.monitoringInterval = setInterval(() => {
        this.checkAndHeal();
      }, 1500);
      _0x2a182f.isMonitoring = true;
    },
    startMonitoring() {
      const _0x1027be = window.MargonemAPI.state.heal;
      if (!_0x1027be.isMonitoring) {
        this.ensureInterval();
      }
      _0x1027be.active = true;
    },
    stopMonitoring() {
      const _0x250be5 = window.MargonemAPI.state.heal;
      _0x250be5.active = false;
      _0x250be5.isMonitoring = false;
      if (_0x250be5.monitoringInterval) {
        clearInterval(_0x250be5.monitoringInterval);
        _0x250be5.monitoringInterval = null;
      }
    },
    checkAndHeal() {
      const _0x45006e = window.MargonemAPI.state.heal;
      if (!_0x45006e.active || window.MargonemAPI.state.isDead) {
        return;
      }
      const _0x1985a6 = window.Engine;
      if (!_0x1985a6?.hero?.d) {
        return;
      }
      const _0x13e368 = _0x1985a6.hero.d.warrior_stats?.hp || 0;
      const _0xc3e482 = _0x1985a6.hero.d.warrior_stats?.maxhp || 1;
      if (_0x13e368 >= _0xc3e482) {
        return;
      }
      const _0x340647 = this.pickItem(_0x13e368, _0xc3e482);
      if (_0x340647) {
        this.useItem(_0x340647);
        if (_0x45006e.notify) {
          window.message("[AutoHeal] Used: " + _0x340647.name);
        }
      }
    },
    pickItem(_0x4cf55f, _0xbe1313) {
      const _0x53a667 = window.MargonemAPI.state.heal;
      const _0x355847 = window.Engine?.items?.fetchLocationItems("g") || [];
      let _0x270b77 = _0x355847.filter(_0x3c287f => {
        const _0x22dac1 = _0x3c287f.name?.toLowerCase() || "";
        const _0x4631b8 = _0x53a667.ignoredItems.some(_0x58d065 => _0x58d065.toLowerCase() === _0x22dac1);
        if (_0x4631b8) {
          return false;
        }
        const _0x467560 = _0x3c287f._cachedStats?.rarity;
        let _0x5099c2 = "P";
        switch (_0x467560) {
          case "legendary":
            _0x5099c2 = "L";
            break;
          case "upgraded":
            _0x5099c2 = "Ul";
            break;
          case "heroic":
            _0x5099c2 = "H";
            break;
          case "unique":
            _0x5099c2 = "U";
            break;
          case "common":
            _0x5099c2 = "P";
            break;
        }
        if (!_0x53a667.rarity.includes(_0x5099c2)) {
          return false;
        }
        return true;
      });
      const _0x456126 = _0x53a667.usePotions ? _0x270b77.filter(_0xc0d19f => _0xc0d19f._cachedStats?.leczy && parseInt(_0xc0d19f._cachedStats.leczy) >= _0x53a667.minPotionHealing) : [];
      const _0x1c069b = _0x53a667.useFulls ? _0x270b77.filter(_0x376a78 => _0x376a78._cachedStats?.fullheal) : [];
      const _0x4063c1 = _0x53a667.usePercents ? _0x270b77.filter(_0x5d4963 => _0x5d4963._cachedStats?.perheal) : [];
      const _0x2e421b = _0xbe1313 - _0x4cf55f;
      const _0x5c1687 = _0x456126.filter(_0x1d1d8f => parseInt(_0x1d1d8f._cachedStats.leczy) <= _0x2e421b);
      let _0x2b1982;
      if (_0x5c1687.length > 0) {
        _0x2b1982 = _0x5c1687.reduce((_0x3ab77b, _0x510b78) => {
          const _0x4309b2 = parseInt(_0x3ab77b._cachedStats.leczy);
          const _0x45adf8 = parseInt(_0x510b78._cachedStats.leczy);
          if (_0x45adf8 < _0x4309b2) {
            return _0x510b78;
          } else {
            return _0x3ab77b;
          }
        });
      } else if (_0x1c069b.length > 0) {
        _0x2b1982 = _0x1c069b.reduce((_0x109932, _0x19d3e7) => {
          const _0x4393e8 = parseInt(_0x109932._cachedStats.fullheal || "999999");
          const _0x5d6a69 = parseInt(_0x19d3e7._cachedStats.fullheal || "999999");
          if (_0x5d6a69 < _0x4393e8) {
            return _0x19d3e7;
          } else {
            return _0x109932;
          }
        });
      } else if (_0x4063c1.length > 0) {
        _0x2b1982 = _0x4063c1.reduce((_0x52d818, _0x54bb55) => {
          const _0x166dc9 = parseInt(_0x52d818._cachedStats.perheal);
          const _0x2c18df = parseInt(_0x54bb55._cachedStats.perheal);
          if (_0x2c18df > _0x166dc9) {
            return _0x54bb55;
          } else {
            return _0x52d818;
          }
        });
      } else if (_0x53a667.healToFull && _0x4cf55f / _0xbe1313 * 100 < _0x53a667.minHealHpPercent && _0x456126.length > 0) {
        _0x2b1982 = _0x456126.reduce((_0x336244, _0x15b7b7) => {
          const _0x2b50dd = parseInt(_0x336244._cachedStats.leczy);
          const _0xc9d4ad = parseInt(_0x15b7b7._cachedStats.leczy);
          if (_0xc9d4ad < _0x2b50dd) {
            return _0x15b7b7;
          } else {
            return _0x336244;
          }
        });
      }
      return _0x2b1982;
    },
    useItem(_0x3210e4) {
      if (!_0x3210e4 || !_0x3210e4.id) {
        return;
      }
      const _0x15ddda = "moveitem&st=1&id=" + _0x3210e4.id;
      window._g(_0x15ddda, () => {
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
    startExping: async function (_0x500f61, _0x5e122b, _0x2f1e11, _0x2fadaf = false, _0x46202f = false, _0x317959 = 0, _0x37958e = null) {
      window.MargonemAPI.state.exping_location.is_aborted = false;
      window.MargonemAPI.state.exping_location.selectedMaps = _0x37958e;
      window.MargonemAPI.state.exping_location.blockPotions = true;
      if (!sessionToken) {
        return;
      }
      const _0x8521da = localStorage.getItem("tm_fingerprint");
      try {
        const _0xebf1c5 = {
          sessionToken: sessionToken,
          fingerprint: _0x8521da
        };
        const _0x1e8f59 = { token: sessionToken, success: true };
        /* bypassed fetch
        const _0x1e8f59 = await fetchAndDecrypt(serverUrl + "/IQQHJ1QWxdUj0gv", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(_0xebf1c5)
        });
        */
        if (_0x1e8f59.token === sessionToken) {
          if (!_0x1e8f59.success) {
            stopHeartbeat();
            const _0x3774b2 = document.getElementById("tm-license-content");
            if (_0x3774b2) {
              _0x3774b2.innerHTML = "<div style='color: red;'>Sesja zakończona lub wystąpił błąd! Sesja została automatycznie zakończona.</div>";
            }
            return;
          }
          try {
            if (window.Engine.hero.d.lvl >= 70) {
              if (_0x2fadaf) {
                window.MargonemAPI.state.exping_location.bag_full = setInterval(async () => {
                  if (window.MargonemAPI.state.exping_location.interval_of_selling) {
                    const _0x17d0df = document.querySelector(".bags-navigation").querySelectorAll(".bag.inventory-item");
                    let _0x33a1ac = true;
                    _0x17d0df.forEach(_0xb9f723 => {
                      const _0x431427 = _0xb9f723.getAttribute("data-name");
                      const _0x1c0860 = _0xb9f723.querySelector(".amount");
                      const _0x160f18 = _0x1c0860 ? parseInt(_0x1c0860.textContent) : 0;
                      if (_0x160f18 > 0 && !_0x431427.includes("klucze")) {
                        _0x33a1ac = false;
                      }
                    });
                    if (_0x33a1ac) {
                      window.MargonemAPI.healingSystem.interval_of_selling = false;
                      clearInterval(window.MargonemAPI.state.exping_location.bag_full);
                      window.MargonemAPI.exping.stopExping();
                      try {
                        uzyjPrzedmiot("Zwój teleportacji na Kwieciste Przejście");
                        await this.waitForMapChange("Kwieciste Przejście");
                        await this.tuniaSelling();
                        window.MargonemAPI.healingSystem.interval_of_selling = true;
                      } catch (_0x2213fc) {}
                      window.MargonemAPI.state.exping_location.is_aborted = true;
                      await sleep(3000);
                      return this.startExping(_0x500f61, _0x5e122b, _0x2f1e11, _0x2fadaf, _0x46202f, _0x317959);
                    }
                  }
                }, 1000);
              }
              if (_0x317959 > 0 && !window.MargonemAPI.state.exping_location.blockPotions) {
                window.MargonemAPI.state.exping_location.potion_checker = setInterval(async () => {
                  if (window.MargonemAPI.state.exping_location.interval_of_selling) {
                    const _0x16aed5 = window.Engine;
                    if (policzLeczyPrzedmioty() <= 0) {
                      clearInterval(window.MargonemAPI.state.exping_location.potion_checker);
                      window.MargonemAPI.healingSystem.interval_of_selling = false;
                      window.MargonemAPI.exping.stopExping();
                      uzyjPrzedmiot("Zwój teleportacji na Kwieciste Przejście");
                      await this.waitForMapChange("Kwieciste Przejście");
                      await this.tuniaSelling();
                      const _0x36de00 = _0x16aed5.hero.d.warrior_stats?.maxhp || 10000;
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
                      const _0x3b5eb0 = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span");
                      _0x3b5eb0.click();
                      await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
                      this.checkAborted();
                      await sleep(1000);
                      const _0xb82eb5 = wybierzIdNajlepszejPotki(_0x36de00);
                      const _0x38e219 = _0x317959 * 3;
                      for (let _0x139166 = 0; _0x139166 < _0x38e219; _0x139166++) {
                        await buyItem(_0xb82eb5);
                        await sleep(1000);
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
                      window.MargonemAPI.state.exping_location.is_aborted = true;
                      window.MargonemAPI.healingSystem.interval_of_selling = true;
                      await sleep(3000);
                      return this.startExping(_0x500f61, _0x5e122b, _0x2f1e11, _0x2fadaf, _0x46202f, _0x317959);
                    }
                  }
                }, 1000);
              }
            }
            if (_0x46202f) {
              window.MargonemAPI.state.exping_location.teleport_if_player = setInterval(async () => {
                if (window.MargonemAPI.state.exping_location.interval_of_selling) {
                  if (window.Engine.hero.d.lvl >= 70) {
                    const _0xe56752 = window.Engine;
                    const _0x354297 = _0xe56752.whoIsHere.getSortedPlayerList();
                    if (_0x354297.length > 0 && isLocationInExpowisko(_0x2f1e11, _0xe56752.map.d.name)) {
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
                      return this.startExping(_0x500f61, _0x5e122b, _0x2f1e11, _0x2fadaf, _0x46202f, _0x317959);
                    }
                  } else {
                    const _0x1b99fd = window.Engine;
                    const _0x21992c = _0x1b99fd.whoIsHere.getSortedPlayerList();
                    if (_0x21992c.length > 0 && isLocationInExpowisko(_0x2f1e11, _0x1b99fd.map.d.name)) {
                      clearInterval(window.MargonemAPI.state.exping_location.teleport_if_player);
                      window.MargonemAPI.healingSystem.interval_of_selling = false;
                      window.MargonemAPI.exping.stopExping();
                      uzyjPierwszyTeleport();
                      await sleep(5000);
                      window.MargonemAPI.state.exping_location.is_aborted = true;
                      window.MargonemAPI.healingSystem.interval_of_selling = true;
                      await sleep(3000);
                      return this.startExping(_0x500f61, _0x5e122b, _0x2f1e11, _0x2fadaf, _0x46202f, _0x317959);
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
                  await new Promise(_0x18f0b0 => setTimeout(_0x18f0b0, 1000));
                }
                await sleep(5000);
                if (window.Engine.hero.d.lvl < 70) {
                  window.MargonemAPI.navigation.stopNavigation(true);
                  const _0x375677 = window.Engine.map.d.name;
                  if (_0x375677 === "Ithan") {
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
                  } else if (_0x375677 === "Karka-han") {
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
                  } else if (_0x375677 === "Nithal") {
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
                  } else if (_0x375677 === "Eder") {
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
                  } else if (_0x375677 === "Torneg") {
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
                  return this.startExping(_0x500f61, _0x5e122b, _0x2f1e11, _0x2fadaf, _0x46202f, _0x317959);
                }
                uzyjPrzedmiot("Zwój teleportacji na Kwieciste Przejście");
                await this.waitForMapChange("Kwieciste Przejście");
                await this.tuniaSelling();
                window.MargonemAPI.state.exping_location.is_aborted = true;
                window.MargonemAPI.healingSystem.interval_of_selling = true;
                await sleep(3000);
                return this.startExping(_0x500f61, _0x5e122b, _0x2f1e11, _0x2fadaf, _0x46202f, _0x317959);
              } catch (_0xc27962) {}
            }, 1000);
            const _0x3be593 = window.MargonemAPI.navigation.getCurrentLocation();
            this.checkAborted();
            if (!_0x3be593) {
              throw new Error("");
            }
            const _0x16f68a = Expowiska[_0x2f1e11];
            if (!_0x16f68a || !Array.isArray(_0x16f68a)) {
              throw new Error("");
            }
            const _0x158bf8 = ["driady (280lvl)", "pustynia (275lvl)"];
            const _0x35eb25 = _0x2f1e11;
            if (_0x158bf8.includes(_0x35eb25) && _0x3be593 === "Kwieciste Przejście") {
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
              const _0x197853 = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span");
              _0x197853.click();
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
              const _0x42d4c3 = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
              if (_0x317959 > 0 && policzLeczyPrzedmioty() <= 0) {
                const _0x163eb3 = wybierzIdNajlepszejPotki(_0x42d4c3);
                const _0x57ea23 = _0x317959 * 3;
                for (let _0x4bc842 = 0; _0x4bc842 < _0x57ea23; _0x4bc842++) {
                  await buyItem(_0x163eb3);
                  await sleep(1000);
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
              if (_0x35eb25 === "pustynia (275lvl)") {
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
                const _0x45b47b = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li:nth-child(1) > span");
                _0x45b47b.click();
                await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                this.checkAborted();
                const _0x1e0b1c = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                _0x1e0b1c.click();
                await this.waitForMapChange("Trupia Przełęcz");
                this.checkAborted();
                window.Engine.hero.talkNearMob();
                await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                this.checkAborted();
                const _0x50f026 = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1.additional-bar-br > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar.scrollable > div.scroll-pane > ul > li:nth-child(7) > span");
                _0x50f026.click();
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
                const _0x28c6b6 = "Smocze Skalisko";
                const _0x1a42a6 = window.MargonemAPI.state.exping_location;
                _0x1a42a6.master_map = _0x28c6b6;
                _0x1a42a6.current_expowisko = _0x2f1e11;
                _0x1a42a6.current_expowisko_name = _0x35eb25;
                await this.navigateToLocation(_0x28c6b6);
                this.checkAborted();
                await this.handleRegularMapExping(_0x500f61, _0x5e122b);
              } else if (_0x35eb25 === "driady (280lvl)") {
                const _0x5a629c = "Rozlewisko Kai";
                const _0x311cce = window.MargonemAPI.state.exping_location;
                _0x311cce.master_map = _0x5a629c;
                _0x311cce.current_expowisko = _0x2f1e11;
                _0x311cce.current_expowisko_name = _0x35eb25;
                await this.navigateToLocation("Rozlewisko Kai");
                this.checkAborted();
                await this.waitForMapChange("Rozlewisko Kai");
                this.checkAborted();
                await this.handleRegularMapExping(_0x500f61, _0x5e122b);
              }
            } else {
              if (_0x3be593 === "Kwieciste Przejście") {
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
                const _0x19c6e3 = document.querySelector("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.interface-layer.layer > div.bottom.positioner > div.dialogue-window.is-open > div.content > div.inner.scroll-wrapper.small-bar > div.scroll-pane > ul > li.dialogue-window-answer.answer.line_shop > span");
                _0x19c6e3.click();
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
                const _0x41d3b4 = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
                if (_0x317959 > 0 && policzLeczyPrzedmioty() <= 0) {
                  const _0x2d4415 = wybierzIdNajlepszejPotki(_0x41d3b4);
                  const _0x254a25 = _0x317959 * 3;
                  for (let _0x2867fe = 0; _0x2867fe < _0x254a25; _0x2867fe++) {
                    await buyItem(_0x2d4415);
                    await sleep(1000);
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
              }
              window.MargonemAPI.state.exping_location.blockPotions = false;
              const _0x115651 = _0x16f68a.some(_0x102596 => {
                const [_0x1c31d5] = Object.entries(_0x102596)[0];
                return _0x1c31d5 === _0x3be593;
              });
              this.checkAborted();
              if (_0x115651) {
                const _0x174195 = window.MargonemAPI.state.exping_location;
                _0x174195.master_map = _0x3be593;
                _0x174195.current_expowisko = _0x2f1e11;
                _0x174195.current_expowisko_name = Object.keys(Expowiska[_0x2f1e11])[0];
                const _0x98ea79 = _0x174195.selectedMaps;
                const _0x482aeb = _0x98ea79.indexOf(_0x3be593);
                if (_0x482aeb !== -1) {
                  const _0x304e9f = _0x98ea79.splice(0, _0x482aeb);
                  _0x98ea79.push(..._0x304e9f);
                }
                await this.handleRegularMapExping(_0x500f61, _0x5e122b);
                return;
              }
              const _0x11b02f = await this.findBestLocation(_0x3be593, _0x16f68a);
              this.checkAborted();
              if (!_0x11b02f) {
                throw new Error("");
              }
              const _0x41987c = window.MargonemAPI.state.exping_location;
              _0x41987c.master_map = _0x11b02f.map;
              _0x41987c.current_expowisko = _0x2f1e11;
              _0x41987c.current_expowisko_name = Object.keys(_0x2f1e11)[0];
              await this.navigateToLocation(_0x11b02f.map);
              this.checkAborted();
              await this.handleRegularMapExping(_0x500f61, _0x5e122b);
            }
          } catch (_0x2d5c32) {
            this.stopExping();
            throw _0x2d5c32;
          }
        } else {
          stopHeartbeat();
          const _0x3dde5b = document.getElementById("tm-license-content");
          if (_0x3dde5b) {
            _0x3dde5b.innerHTML = "<div style='color: red;'>Sesja zakończona lub wystąpił błąd! Sesja została automatycznie zakończona.</div>";
          }
          return;
        }
      } catch (_0x147448) {
        const _0x105fd3 = document.getElementById("tm-license-content");
        if (_0x105fd3) {
          _0x105fd3.innerHTML = "<div style='color: red;'>Brak odpowiedzi serwera – sesja została automatycznie zakończona.</div>";
        }
        return;
      }
    },
    buingPots: async function () {
      const _0x275431 = window.Engine.hero.d.warrior_stats?.maxhp || 10000;
      await sleep(1000);
      const _0x554deb = await wybierzIdNajlepszejPotki(_0x275431);
      const _0x53a833 = window.MargonemAPI.znajdzIloscPotkow(_0x554deb);
      for (let _0x51dede = 0; _0x51dede < _0x53a833; _0x51dede++) {
        await buyItem(_0x554deb);
        await sleep(1000);
      }
      window.Engine.shop.basket.finalize();
      await sleep(1000);
      this.checkAborted();
      window.Engine.shop.close();
    },
    notTuniaSelling: async function (_0x4d0070, _0x32eaca, _0x236a7e, _0x4e468d, _0x1b1122) {
      const _0x20239d = {
        x: _0x4d0070,
        y: _0x32eaca
      };
      window.Engine.hero.autoGoTo(_0x20239d, false);
      await waitForPosition(_0x4d0070, _0x32eaca, 60000);
      window.Engine.hero.talkNearMob();
      await waitForElement(_0x236a7e);
      const _0x4fe021 = document.querySelector(_0x236a7e);
      if (!_0x4fe021) {
        throw new Error("");
      }
      _0x4fe021.click();
      await waitForElement(_0x4e468d);
      await sleep(1000);
      for (let _0x5c3bf7 = 0; _0x5c3bf7 < 7; _0x5c3bf7++) {
        await sleep;
        const _0x2389ea = document.querySelector(_0x1b1122);
        if (!_0x2389ea) {
          throw new Error("");
        }
        _0x2389ea.click();
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
        const _0x1931c9 = document.querySelector("li.dialogue-window-answer.answer.line_shop > span");
        if (!_0x1931c9) {
          throw new Error("");
        }
        _0x1931c9.click();
        await waitForElement("body > div.game-window-positioner.default-cursor.eq-column-size-1.chat-size-1 > div.alerts-layer.layer > div.border-window.ui-draggable.window-on-peak > div.content > div.inner-content > div");
        await sleep(1000);
        for (let _0xe22987 = 0; _0xe22987 < 7; _0xe22987++) {
          await sleep;
          const _0x975a7c = document.querySelector("div.great-merchamp.btns-spacing > div:nth-child(1)");
          if (!_0x975a7c) {
            throw new Error("");
          }
          _0x975a7c.click();
          await sleep(1000);
          window.Engine.shop.basket.finalize();
          await sleep(1000);
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
        return true;
      } catch (_0x5718aa) {
        return false;
      }
    },
    findBestLocation: async function (_0x16e57f, _0x56d396) {
      this.checkAborted();
      const _0xefbcc5 = await Promise.all(_0x56d396.map(async _0x34997f => {
        this.checkAborted();
        const [_0x5b33d0, _0x7b3382] = Object.entries(_0x34997f)[0];
        try {
          const _0x1a224a = await window.MargonemAPI.navigation.findShortestPath(_0x16e57f, _0x5b33d0);
          this.checkAborted();
          const _0x109e57 = {
            map: _0x5b33d0,
            inside: _0x7b3382,
            distance: _0x1a224a.distance || Infinity
          };
          return _0x109e57;
        } catch (_0x17c169) {
          const _0x1a0c15 = {
            map: _0x5b33d0,
            inside: _0x7b3382,
            distance: Infinity
          };
          return _0x1a0c15;
        }
      }));
      const _0x500504 = {
        distance: Infinity
      };
      return _0xefbcc5.reduce((_0x541ce7, _0x26c0e9) => _0x26c0e9.distance < _0x541ce7.distance ? _0x26c0e9 : _0x541ce7, _0x500504);
    },
    handleRegularMapExping: async function (_0x2ab902, _0x1b6f35) {
      const _0x20203a = window.MargonemAPI.state.exping_location;
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
        while (!_0x20203a.is_aborted) {
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
              const fightResult = await this.fightOnCurrentLocation(_0x2ab902, _0x1b6f35);
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
              
              const _0x55ea88 = await this.fightOnCurrentLocation(_0x2ab902, _0x1b6f35);
              this.checkAborted();
              if (_0x55ea88) {
                console.log("[Exping] Mapa wyczyszczona:", nextMap);
              }
            } catch (_0x47a56d) {
              console.log("[Exping] Błąd na mapie, kontynuuję:", nextMap);
              continue;
            }
          }
          
          _0x20203a.iteration.count++;
        }
      } catch (_0x24ef67) {
        throw _0x24ef67;
      }
    },
    navigateToLocation: async function (_0x13fa31) {
      this.checkAborted();
      const _0x28e956 = 30;
      let _0x338f55 = 0;
      while (_0x338f55 < _0x28e956) {
        this.checkAborted();
        try {
          await window.MargonemAPI.navigation.goToLocation(_0x13fa31);
          this.checkAborted();
          const _0x2b6c36 = await this.waitForMapChange(_0x13fa31);
          this.checkAborted();
          if (_0x2b6c36) {
            return true;
          }
        } catch (_0x15673a) {}
        _0x338f55++;
        await new Promise(_0x2444e0 => setTimeout(_0x2444e0, 2000));
        this.checkAborted();
      }
      throw new Error();
    },
    fightOnCurrentLocation: async function (_0x10962b, _0x2940a0) {
      this.checkAborted();
      const _0x41a134 = window.MargonemAPI.navigation.getCurrentLocation();
      try {
        const _0x4db310 = await this.checkForMobs(_0x10962b, _0x2940a0);
        this.checkAborted();
        if (!_0x4db310) {
          return false;
        }
        const _0x3ee73f = {
          min: _0x10962b,
          max: _0x2940a0
        };
        const _0x56f573 = {
          levelRange: _0x3ee73f
        };
        await window.MargonemAPI.combat.startFight(_0x56f573);
        this.checkAborted();
        const _0x44589e = await this.waitForMapClear();
        this.checkAborted();
        if (!_0x44589e) {}
        window.MargonemAPI.combat.stopFight();
        return true;
      } catch (_0x4da2df) {
        window.MargonemAPI.combat.stopFight();
        throw _0x4da2df;
      }
    },
    checkForMobs: async function (_0x290d84, _0x3a4572) {
      this.checkAborted();
      try {
        for (let _0x31e909 = 1; _0x31e909 <= 3; _0x31e909++) {
          this.checkAborted();
          await new Promise(_0x1c0691 => setTimeout(_0x1c0691, 1000));
          this.checkAborted();
          const _0x234b83 = window.MargonemAPI.getAllMobs() || [];
          this.checkAborted();
          const _0x545dfc = _0x234b83.filter(_0x5c522b => {
            const _0x172396 = _0x5c522b.lvl || 0;
            return _0x172396 >= _0x290d84 && _0x172396 <= _0x3a4572;
          });
          if (_0x545dfc.length > 0) {
            return true;
          }
        }
        return false;
      } catch (_0x2a3779) {
        return false;
      }
    },
    waitForMapChange: async function (_0x1dc912) {
      this.checkAborted();
      const _0x54b18b = 30000;
      const _0x3ab536 = Date.now();
      while (Date.now() - _0x3ab536 < _0x54b18b) {
        if (window.MargonemAPI.state.exping_location.is_aborted) {
          return false;
        }
        this.checkAborted();
        const _0x9dd982 = window.MargonemAPI.navigation.getCurrentLocation();
        if (_0x9dd982 === _0x1dc912) {
          return true;
        }
        await new Promise(_0x57c518 => setTimeout(_0x57c518, 1000));
        this.checkAborted();
      }
      return false;
    },
    waitForMapClear: async function () {
      this.checkAborted();
      const _0x29567e = 300000;
      const _0x20acf3 = Date.now();
      while (Date.now() - _0x20acf3 < _0x29567e) {
        if (window.MargonemAPI.state.exping_location.is_aborted) {
          return false;
        }
        this.checkAborted();
        if (window.MargonemAPI.state.map_cleaned) {
          window.MargonemAPI.state.map_cleaned = false;
          window.MargonemAPI.state.exping_location.last_map_clean_time = Date.now();
          return true;
        }
        await new Promise(_0xd7076e => setTimeout(_0xd7076e, 1000));
        this.checkAborted();
      }
      throw new Error("");
    },
    stopExping: function () {
      try {
        const _0x4dd3b8 = window.MargonemAPI.state;
        const _0x21ca31 = window.MargonemAPI.state.exping_location;
        clearInterval(window.MargonemAPI.state.exping_location.death_cam);
        clearInterval(window.MargonemAPI.state.exping_location.teleport_if_player);
        if (_0x4dd3b8.timers) {
          Object.values(_0x4dd3b8.timers).forEach(_0x350bca => {
            if (_0x350bca) {
              clearTimeout(_0x350bca);
              clearInterval(_0x350bca);
            }
          });
          _0x4dd3b8.timers = {};
        }
        if (window.MargonemAPI.navigation) {
          window.MargonemAPI.navigation.stopNavigation(false);
          if (_0x4dd3b8.navigation) {
            clearInterval(_0x4dd3b8.navigation.pathCheckInterval);
            _0x4dd3b8.navigation.isNavigating = false;
            _0x4dd3b8.navigation.currentPath = null;
            _0x4dd3b8.navigation.currentPathIndex = 0;
            _0x4dd3b8.navigation.targetLocation = null;
            _0x4dd3b8.navigation.lastMoveTime = null;
          }
        }
        try {
          window.MargonemAPI.combat.stopFight();
          _0x4dd3b8.autoFightActive = false;
          _0x4dd3b8.autoFightInProgress = false;
          _0x4dd3b8.selectedNicks = [];
          _0x4dd3b8.lastAttemptedMobs = [];
          _0x4dd3b8.currentTargetId = null;
          _0x4dd3b8.blockedMobs.clear();
          _0x4dd3b8.map_cleaned = false;
        } catch (_0x2b2e08) {}
        try {
          if (window.MargonemAPI.combat.recoverySystem) {
            window.MargonemAPI.combat.recoverySystem.stopMonitoring();
          }
        } catch (_0x3338b7) {}
        if (_0x4dd3b8.pendingStopActions) {
          _0x4dd3b8.pendingStopActions.clear();
        }
        if (_0x4dd3b8.activeIntervals) {
          _0x4dd3b8.activeIntervals.forEach(_0x4288c1 => {
            clearInterval(_0x4288c1);
          });
          _0x4dd3b8.activeIntervals.clear();
        }
        if (_0x4dd3b8.activeTimeouts) {
          _0x4dd3b8.activeTimeouts.forEach(_0x3f7b21 => {
            clearTimeout(_0x3f7b21);
          });
          _0x4dd3b8.activeTimeouts.clear();
        }
        if (_0x21ca31) {
          _0x21ca31.master_map = null;
          _0x21ca31.current_expowisko = null;
          _0x21ca31.current_gateway = null;
          _0x21ca31.last_map_clean_time = null;
          _0x21ca31.finished_gateways = [];
          _0x21ca31.bag_check = null;
          if (_0x21ca31.sublocation_data) {
            _0x21ca31.sublocation_data.mapped = false;
            _0x21ca31.sublocation_data.connections.clear();
            _0x21ca31.sublocation_data.optimal_path = [];
            _0x21ca31.sublocation_data.visited.clear();
          }
          if (_0x21ca31.iteration) {
            _0x21ca31.iteration.count = 0;
            _0x21ca31.iteration.visited_maps.clear();
            _0x21ca31.iteration.visited_gateways.clear();
            _0x21ca31.iteration.path = [];
            _0x21ca31.iteration.completed = false;
          }
          if (_0x21ca31.movement) {
            _0x21ca31.movement.in_progress = false;
            _0x21ca31.movement.target = null;
            _0x21ca31.movement.start_time = null;
          }
        }
        clearInterval(window.MargonemAPI.state.exping_location.bag_full);
        try {
          const _0x98b09d = window.Engine;
          if (_0x98b09d && _0x98b09d.hero) {
            const _0x125cbc = Math.floor(_0x98b09d.hero.x || _0x98b09d.hero.d && _0x98b09d.hero.d.x);
            const _0x1ad2d4 = Math.floor(_0x98b09d.hero.y || _0x98b09d.hero.d && _0x98b09d.hero.d.y);
            const _0x29a43e = {
              x: _0x125cbc,
              y: _0x1ad2d4
            };
            _0x98b09d.hero.autoGoTo(_0x29a43e);
          }
        } catch (_0x57fd07) {}
        for (const _0x4f6df1 in window) {
          if (typeof window[_0x4f6df1] === "number") {
            if (_0x4f6df1.includes("interval") || _0x4f6df1.includes("timeout")) {
              clearInterval(window[_0x4f6df1]);
              clearTimeout(window[_0x4f6df1]);
            }
          }
        }
        return true;
      } catch (_0xabb203) {
        try {
          this.resetState();
        } catch (_0x1fb22c) {}
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
    debug: function (..._0x4e2baf) {
      if (window.MargonemAPI.DEBUG) {}
    },
    Node: class {
      constructor(_0x50d022, _0x26cedf, _0x253f66 = 0, _0x500c43 = 0) {
        this.x = _0x50d022;
        this.y = _0x26cedf;
        this.g = _0x253f66;
        this.h = _0x500c43;
        this.f = _0x253f66 + _0x500c43;
        this.parent = null;
        this.key = _0x50d022 + "," + _0x26cedf;
      }
    },
    initializeCollisionGrid: function () {
      const _0xa8671d = window.Engine;
      if (!_0xa8671d?.map) {
        return;
      }
      const _0x243525 = _0xa8671d.map.d.name;
      if (_0x243525 === this.cache.lastMapName && this.cache.collisionGrid) {
        return;
      }
      const _0x5a0e3d = window.MargonemAPI.scanMapCollisions();
      if (!_0x5a0e3d) {
        return;
      }
      const _0x57f759 = _0x5a0e3d.width;
      const _0x1ba2b4 = _0x5a0e3d.height;
      const _0x7a4fa7 = new Uint8Array(_0x57f759 * _0x1ba2b4);
      for (let _0x2b78b6 = 0; _0x2b78b6 < _0x1ba2b4; _0x2b78b6++) {
        for (let _0x1839f8 = 0; _0x1839f8 < _0x57f759; _0x1839f8++) {
          _0x7a4fa7[_0x2b78b6 * _0x57f759 + _0x1839f8] = _0x5a0e3d.collisions[_0x2b78b6][_0x1839f8].collision ? 1 : 0;
        }
      }
      this.cache.collisionGrid = _0x7a4fa7;
      this.cache.gridWidth = _0x57f759;
      this.cache.gridHeight = _0x1ba2b4;
      this.cache.lastMapName = _0x243525;
      this.cache.pathCache.clear();
      this.cache.nodeCache.clear();
      return _0x7a4fa7;
    },
    checkCollision: function (_0x47a7c5, _0x2141b0) {
      const {
        gridWidth: _0x16244c,
        collisionGrid: _0x42d19a
      } = this.cache;
      return _0x42d19a[_0x2141b0 * _0x16244c + _0x47a7c5] === 1;
    },
    findPath: function (_0x1acace, _0x5eece1, _0x468b0f, _0x5eb6af) {
      if (!this.cache.collisionGrid) {
        this.initializeCollisionGrid();
        if (!this.cache.collisionGrid) {
          return null;
        }
      }
      const _0x11c606 = _0x1acace + "," + _0x5eece1 + "-" + _0x468b0f + "," + _0x5eb6af;
      const _0x3fa420 = this.cache.pathCache.get(_0x11c606);
      if (_0x3fa420) {
        return _0x3fa420;
      }
      const {
        gridWidth: _0x505751,
        gridHeight: _0x4e56ec
      } = this.cache;
      if (_0x1acace < 0 || _0x5eece1 < 0 || _0x468b0f < 0 || _0x5eb6af < 0 || _0x1acace >= _0x505751 || _0x5eece1 >= _0x4e56ec || _0x468b0f >= _0x505751 || _0x5eb6af >= _0x4e56ec) {
        return null;
      }
      const _0x1fc9d2 = new Map();
      const _0x12090f = new Set();
      const _0x43c8b7 = new this.Node(_0x1acace, _0x5eece1, 0, Math.abs(_0x468b0f - _0x1acace) + Math.abs(_0x5eb6af - _0x5eece1));
      _0x1fc9d2.set(_0x43c8b7.key, _0x43c8b7);
      const _0x562d7e = {
        x: 0,
        y: -1
      };
      const _0x14521a = {
        x: -1,
        y: 0
      };
      const _0x4f10c0 = [_0x562d7e, {
        x: 1,
        y: 0
      }, {
        x: 0,
        y: 1
      }, _0x14521a];
      while (_0x1fc9d2.size > 0) {
        let _0x34d021 = null;
        let _0x2e09a6 = Infinity;
        for (const [_0x5b3c53, _0x277287] of _0x1fc9d2) {
          if (_0x277287.f < _0x2e09a6) {
            _0x2e09a6 = _0x277287.f;
            _0x34d021 = _0x277287;
          }
        }
        if (_0x34d021.x === _0x468b0f && _0x34d021.y === _0x5eb6af) {
          const _0x722ccf = [];
          while (_0x34d021) {
            const _0xe4f362 = {
              x: _0x34d021.x,
              y: _0x34d021.y
            };
            _0x722ccf.unshift(_0xe4f362);
            _0x34d021 = _0x34d021.parent;
          }
          this.cache.pathCache.set(_0x11c606, _0x722ccf);
          return _0x722ccf;
        }
        _0x1fc9d2.delete(_0x34d021.key);
        _0x12090f.add(_0x34d021.key);
        for (const _0x2447da of _0x4f10c0) {
          const _0x4d16cb = _0x34d021.x + _0x2447da.x;
          const _0x45a2cd = _0x34d021.y + _0x2447da.y;
          const _0x4f3502 = _0x4d16cb + "," + _0x45a2cd;
          if (_0x4d16cb < 0 || _0x45a2cd < 0 || _0x4d16cb >= _0x505751 || _0x45a2cd >= _0x4e56ec || this.checkCollision(_0x4d16cb, _0x45a2cd) && (_0x4d16cb !== _0x468b0f || _0x45a2cd !== _0x5eb6af) || _0x12090f.has(_0x4f3502)) {
            continue;
          }
          const _0x3fdb4f = _0x34d021.g + 1;
          const _0x49a50f = _0x1fc9d2.get(_0x4f3502);
          if (_0x49a50f) {
            if (_0x3fdb4f < _0x49a50f.g) {
              _0x49a50f.g = _0x3fdb4f;
              _0x49a50f.f = _0x3fdb4f + _0x49a50f.h;
              _0x49a50f.parent = _0x34d021;
            }
          } else {
            const _0x5f3a30 = new this.Node(_0x4d16cb, _0x45a2cd, _0x3fdb4f, Math.abs(_0x468b0f - _0x4d16cb) + Math.abs(_0x5eb6af - _0x45a2cd));
            _0x5f3a30.parent = _0x34d021;
            _0x1fc9d2.set(_0x4f3502, _0x5f3a30);
          }
        }
      }
      this.cache.pathCache.set(_0x11c606, null);
      return null;
    },
    calculateRealDistance: function (_0x3c084c, _0x14b750, _0x3d12f3, _0x1366d3) {
      const _0x18bf02 = this.findPath(_0x3c084c, _0x14b750, _0x3d12f3, _0x1366d3);
      if (_0x18bf02) {
        return _0x18bf02.length - 1;
      } else {
        return Infinity;
      }
    },
    findPathWithBackHandling: function (_0x292f56, _0x289c4a, _0x76d290, _0x1c6367) {
      try {
        const _0x58e04c = window.Engine;
        if (_0x58e04c && _0x58e04c.hero) {
          const _0x311fa5 = Math.floor(parseFloat(_0x58e04c.hero.d.x || 0));
          const _0x48ca71 = Math.floor(parseFloat(_0x58e04c.hero.d.y || 0));
          const _0x1da9e5 = Math.floor(parseFloat(_0x58e04c.hero.lastServerX || _0x58e04c.hero.d.x || 0));
          const _0x12f611 = Math.floor(parseFloat(_0x58e04c.hero.lastServerY || _0x58e04c.hero.d.y || 0));
          if (Math.abs(_0x311fa5 - _0x1da9e5) > 0 || Math.abs(_0x48ca71 - _0x12f611) > 0) {
            console.log("[MargonemAPI] Position mismatch detected: Local(" + _0x311fa5 + "," + _0x48ca71 + ") vs Server(" + _0x1da9e5 + "," + _0x12f611 + ")");
            _0x292f56 = _0x1da9e5;
            _0x289c4a = _0x12f611;
          }
        }
        return this.findPath(_0x292f56, _0x289c4a, _0x76d290, _0x1c6367);
      } catch (_0x9f4744) {
        console.error("Error in findPathWithBackHandling:", _0x9f4744);
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
      blockedMobs: Array.from(window.MargonemAPI.state.blockedMobs.entries()).map(([_0xdb968c, _0x404088]) => ({
        id: _0xdb968c,
        nick: _0x404088.nick,
        blockedAt: _0x404088.timestamp
      }))
    };
  },
  getAllGateways: function () {
    const _0x39afb2 = window.Engine;
    if (!_0x39afb2 || !_0x39afb2.map || !_0x39afb2.map.gateways) {
      return [];
    }
    const _0x3f0a9f = _0x39afb2.map.gateways.getList();
    return _0x3f0a9f.map(_0x4ebeb5 => ({
      name: _0x4ebeb5.tip[0],
      id: _0x4ebeb5.d.id,
      available: _0x4ebeb5.available,
      x: _0x4ebeb5.d.x,
      y: _0x4ebeb5.d.y
    }));
  },
  getAllMobs: function () {
    const _0x4cb680 = window.Engine;
    if (!_0x4cb680 || !_0x4cb680.npcs) {
      return [];
    }
    const _0x57552b = _0x4cb680.map && (_0x4cb680.map.d?.name || _0x4cb680.map.name);
    if (_0x57552b && _0x57552b !== window.MargonemAPI.state.lastMapName) {
      window.MargonemAPI.state.allMobs = [];
      window.MargonemAPI.state.lastMapName = _0x57552b;
      window.MargonemAPI.combat.clearBlockedMobs();
      window.MargonemAPI.state.selectedNicks = [];
      const _0x1f3130 = document.querySelector("#mobCheckboxes");
      if (_0x1f3130) {
        _0x1f3130.innerHTML = "";
      }
    }
    const _0x2bd5b4 = _0x4cb680.npcs.check();
    window.MargonemAPI.state.npcs = _0x2bd5b4;
    const _0x424f21 = [];
    for (const _0x3384aa in _0x2bd5b4) {
      const _0x4f3355 = _0x2bd5b4[_0x3384aa];
      if (_0x4f3355 && _0x4f3355.d && (_0x4f3355.d.type === 2 || _0x4f3355.d.type === 3)) {
        _0x424f21.push({
          id: _0x4f3355.d.id,
          nick: _0x4f3355.d.nick,
          x: Math.floor(parseFloat(_0x4f3355.d.x)),
          y: Math.floor(parseFloat(_0x4f3355.d.y)),
          lvl: _0x4f3355.d.lvl,
          type: _0x4f3355.d.type,
          wt: _0x4f3355.d.wt
        });
      }
    }
    window.MargonemAPI.state.allMobs = _0x424f21;
    return _0x424f21;
  },
  checkCollision: function (_0x51183e, _0x25c964) {
    const _0x21085d = window.Engine;
    if (!_0x21085d || !_0x21085d.map || !_0x21085d.map.col) {
      return null;
    }
    const _0x3a6460 = _0x21085d.map.d.x;
    const _0x2880ca = _0x21085d.map.d.y;
    if (_0x51183e < 0 || _0x25c964 < 0 || _0x51183e >= _0x3a6460 || _0x25c964 >= _0x2880ca) {
      return {
        collision: true,
        reason: "out_of_bounds",
        value: 4
      };
    }
    const _0x50abd8 = _0x21085d.map.col.check(_0x51183e, _0x25c964);
    return {
      collision: _0x50abd8 !== 0,
      reason: "collision_check",
      value: _0x50abd8,
      details: {
        blocked: Boolean(_0x50abd8 & 1),
        water: Boolean(_0x50abd8 & 2),
        elevation: Boolean(_0x50abd8 & 4),
        mob: Boolean(_0x50abd8 & 8),
        npc: Boolean(_0x50abd8 & 16),
        player: Boolean(_0x50abd8 & 32)
      }
    };
  },
  scanMapCollisions: function () {
    const _0x57fbf7 = window.Engine;
    if (!_0x57fbf7 || !_0x57fbf7.map || !_0x57fbf7.map.col) {
      return null;
    }
    const _0xfb9185 = _0x57fbf7.map.d.x;
    const _0x5795d5 = _0x57fbf7.map.d.y;
    const _0x498540 = new Array(_0x5795d5);
    for (let _0x4e7ed3 = 0; _0x4e7ed3 < _0x5795d5; _0x4e7ed3++) {
      _0x498540[_0x4e7ed3] = new Array(_0xfb9185);
      for (let _0xb69b4d = 0; _0xb69b4d < _0xfb9185; _0xb69b4d++) {
        _0x498540[_0x4e7ed3][_0xb69b4d] = window.MargonemAPI.checkCollision(_0xb69b4d, _0x4e7ed3);
      }
    }
    return {
      width: _0xfb9185,
      height: _0x5795d5,
      collisions: _0x498540,
      summary: {
        total: _0xfb9185 * _0x5795d5,
        blocked: _0x498540.flat().filter(_0x2f3210 => _0x2f3210.collision).length,
        walkable: _0x498540.flat().filter(_0x3c4ec4 => !_0x3c4ec4.collision).length
      }
    };
  },
  znajdzIloscPotkow: function (_0x2a5517) {
    if (!window.Engine || !window.Engine.shop || !window.Engine.shop.items) {
      return;
    }
    const _0x2f97d2 = window.Engine.shop.items;
    const _0x3d75b6 = _0x2f97d2[_0x2a5517];
    const _0x1badcd = window.Engine.hero.d.gold;
    let _0x569183 = parseInt(_0x1badcd / _0x3d75b6.pr) - 1;
    if (_0x569183 > 45) {
      return 45;
    }
    return _0x569183;
  }
});

// Helper functions moved to src/utils/helpers.js

window.MargonemAPI.heroPositionMonitor.init()
