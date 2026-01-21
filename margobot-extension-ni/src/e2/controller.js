// E2 Controller - Extracted from logic.js
// Tryb E2 - polowanie na bossy

window.MargonemAPI.e2 = {
  STORAGE_KEY: "margonem_e2_state",
  state: {
    active: false,
    aborted: false,
    characters: [],
    currentCharacterIndex: -1,
    isProcessing: false,
    afkPreventionInterval: null,
    isPerformingMovement: false,
    globalCheckInterval: null,
    lastStateUpdate: Date.now(),
    autoResumed: false
  },
  debugLog: function (_0x42bb32, _0x3d27ca = "info") {
    const _0x1341d4 = "[E2 API]";
    const _0x50a8dd = new Date().toLocaleTimeString();
    switch (_0x3d27ca) {
      case "error":
        console.error(_0x1341d4 + " " + _0x50a8dd + " - " + _0x42bb32);
        break;
      case "warning":
        console.warn(_0x1341d4 + " " + _0x50a8dd + " - " + _0x42bb32);
        break;
      default:
        console.log(_0x1341d4 + " " + _0x50a8dd + " - " + _0x42bb32);
    }
    this.state.lastStateUpdate = Date.now();
  },
  initializeCharacters: function () {
    this.debugLog("Inicjalizacja postaci z silnika Engine");
    const _0x4c8d76 = window.Engine?.characterList?.list || [];
    if (!_0x4c8d76 || _0x4c8d76.length === 0) {
      this.debugLog("Nie znaleziono postaci w Engine", "error");
      return {
        success: false,
        error: "No characters found"
      };
    }
    this.debugLog("Znaleziono " + _0x4c8d76.length + " postaci w Engine");
    const _0x5678e9 = this.state.characters || [];
    this.state.characters = _0x4c8d76.map(_0x42c64 => {
      const _0x45ca81 = _0x5678e9.find(_0x27d516 => _0x27d516.id === _0x42c64.id);
      const _0x41f9cc = {
        id: _0x42c64.id,
        nick: _0x42c64.nick,
        world: _0x42c64.world,
        enabled: _0x45ca81 ? _0x45ca81.enabled : false,
        selectedBoss: _0x45ca81 ? _0x45ca81.selectedBoss : null,
        bossData: _0x45ca81 ? _0x45ca81.bossData : null,
        lastKillTime: _0x45ca81 ? _0x45ca81.lastKillTime : null,
        respawnTime: _0x45ca81 ? _0x45ca81.respawnTime : null,
        nextRespawnAt: _0x45ca81 ? _0x45ca81.nextRespawnAt : null,
        status: _0x45ca81 ? _0x45ca81.status : "Waiting",
        errorCount: _0x45ca81 ? _0x45ca81.errorCount : 0
      };
      return _0x41f9cc;
    });
    this.debugLog("Zainicjalizowano " + this.state.characters.length + " postaci");
    return {
      success: true
    };
  },
  startE2: async function () {
    if (this.state.active) {
      this.debugLog("Proces E2 już jest aktywny", "warning");
      return {
        success: false,
        error: "E2 process already active"
      };
    }
    const _0x3a7c6a = this.state.characters.filter(_0x22680f => _0x22680f.enabled && _0x22680f.selectedBoss);
    if (_0x3a7c6a.length === 0) {
      this.debugLog("Brak wybranych postaci lub bosów", "error");
      return {
        success: false,
        error: "No characters selected or no bosses configured"
      };
    }
    this.debugLog("Uruchamianie procesu E2 dla " + _0x3a7c6a.length + " postaci");
    this.state.active = true;
    this.state.aborted = false;
    this.state.isProcessing = false;
    const _0xfb1e38 = this.state.autoResumed;
    this.state.characters.forEach(_0x5b1d63 => {
      if (_0x5b1d63.enabled) {
        if (_0xfb1e38 && (_0x5b1d63.status === "Killed" || _0x5b1d63.status === "NotFound") && _0x5b1d63.nextRespawnAt && _0x5b1d63.nextRespawnAt > Date.now()) {
          this.debugLog("Zachowuję stan dla " + _0x5b1d63.nick + ": " + _0x5b1d63.status + ", następny respawn: " + new Date(_0x5b1d63.nextRespawnAt).toLocaleTimeString());
        } else {
          _0x5b1d63.status = "Waiting";
          _0x5b1d63.errorCount = 0;
        }
      }
    });
    if (this.state.currentCharacterIndex < 0 || !this.state.characters[this.state.currentCharacterIndex]?.enabled) {
      this.state.currentCharacterIndex = this.state.characters.findIndex(_0x3a8707 => _0x3a8707.enabled && _0x3a8707.selectedBoss);
    }
    this.startGlobalMonitoring();
    this.startAfkPrevention();
    this.saveStateToStorage();
    if (this.state.currentCharacterIndex !== -1) {
      try {
        await this.processCurrentCharacter();
      } catch (_0x24da2a) {
        this.debugLog("Błąd podczas przetwarzania pierwszej postaci: " + _0x24da2a.message, "error");
      }
    }
    this.debugLog("Proces E2 uruchomiony pomyślnie");
    return {
      success: true
    };
  },
  stopE2: function () {
    if (!this.state.active) {
      this.debugLog("Proces E2 nie jest aktywny", "warning");
      return {
        success: false,
        error: "E2 process not active"
      };
    }
    this.debugLog("Zatrzymywanie procesu E2");
    this.state.active = false;
    this.state.aborted = true;
    this.state.isProcessing = false;
    this.state.autoResumed = false;
    if (this.state.afkPreventionInterval) {
      clearInterval(this.state.afkPreventionInterval);
      this.state.afkPreventionInterval = null;
    }
    if (this.state.globalCheckInterval) {
      clearInterval(this.state.globalCheckInterval);
      this.state.globalCheckInterval = null;
    }
    if (window.MargonemAPI.navigation) {
      window.MargonemAPI.navigation.stopNavigation(false);
    }
    if (window.MargonemAPI.combat) {
      window.MargonemAPI.combat.stopFight();
    }
    this.state.characters.forEach(_0x53a094 => {
      if (_0x53a094.status !== "Killed" && _0x53a094.status !== "NotFound") {
        _0x53a094.status = "Waiting";
      }
    });
    localStorage.removeItem(this.STORAGE_KEY);
    this.debugLog("Proces E2 zatrzymany");
    return {
      success: true
    };
  },
  startAfkPrevention: function () {
    if (this.state.afkPreventionInterval) {
      clearInterval(this.state.afkPreventionInterval);
    }
    this.state.afkPreventionInterval = setInterval(() => {
      if (!this.state.active || this.state.aborted) {
        clearInterval(this.state.afkPreventionInterval);
        this.state.afkPreventionInterval = null;
        return;
      }
      try {
        const _0x1d1f9c = document.querySelector(".battle-window");
        if (!_0x1d1f9c && !this.state.isPerformingMovement) {
          this.performSmallRandomMovement();
        }
      } catch (_0x47575d) {
        this.debugLog("Błąd podczas zapobiegania AFK: " + _0x47575d.message, "error");
      }
    }, 60000);
  },
  performSmallRandomMovement: function () {
    const _0x3241b6 = window.Engine;
    if (!_0x3241b6 || !_0x3241b6.hero) {
      return;
    }
    this.state.isPerformingMovement = true;
    try {
      const _0x799ae7 = Math.floor(_0x3241b6.hero.x || _0x3241b6.hero.d && _0x3241b6.hero.d.x);
      const _0x57d255 = Math.floor(_0x3241b6.hero.y || _0x3241b6.hero.d && _0x3241b6.hero.d.y);
      const _0x54aa77 = Math.floor(Math.random() * 4);
      let _0x536878 = _0x799ae7;
      let _0x3804f7 = _0x57d255;
      switch (_0x54aa77) {
        case 0:
          _0x536878 += 1;
          break;
        case 1:
          _0x536878 -= 1;
          break;
        case 2:
          _0x3804f7 += 1;
          break;
        case 3:
          _0x3804f7 -= 1;
          break;
      }
      this.debugLog("Wykonuję mały ruch z (" + _0x799ae7 + "," + _0x57d255 + ") do (" + _0x536878 + "," + _0x3804f7 + ")");
      const _0x5c1287 = {
        x: _0x536878,
        y: _0x3804f7
      };
      _0x3241b6.hero.autoGoTo(_0x5c1287, false);
      setTimeout(() => {
        this.state.isPerformingMovement = false;
      }, 3000);
    } catch (_0x4deec6) {
      this.debugLog("Błąd podczas wykonywania ruchu: " + _0x4deec6.message, "error");
      this.state.isPerformingMovement = false;
    }
  },
  startGlobalMonitoring: function () {
    if (this.state.globalCheckInterval) {
      clearInterval(this.state.globalCheckInterval);
    }
    this.state.globalCheckInterval = setInterval(() => {
      if (!this.state.active || this.state.aborted) {
        clearInterval(this.state.globalCheckInterval);
        this.state.globalCheckInterval = null;
        return;
      }
      if (this.state.isProcessing) {
        return;
      }
      try {
        this.checkCharactersForRespawn();
        this.checkHeroHealth();
      } catch (_0x576291) {
        this.debugLog("Błąd podczas globalnego monitorowania: " + _0x576291.message, "error");
      }
    }, 30000);
  },
  checkHeroHealth: function () {
    const _0x3080d9 = window.Engine;
    if (!_0x3080d9 || !_0x3080d9.hero || !_0x3080d9.hero.d) {
      return;
    }
    if (_0x3080d9.hero.d.hpp <= 0) {
      this.debugLog("Bohater nie żyje! Przełączanie na inną postać.", "warning");
      const _0x1b4958 = this.state.characters[this.state.currentCharacterIndex];
      if (_0x1b4958) {
        _0x1b4958.status = "Error";
        _0x1b4958.errorCount += 1;
      }
      this.processNextCharacter();
    }
  },
  checkCharactersForRespawn: async function () {
    const _0x52a453 = Date.now();
    const _0xaa5d48 = this.state.characters.filter(_0x4d8a7d => _0x4d8a7d.enabled);
    const _0x2cd9fe = _0xaa5d48.filter(_0x3ed726 => _0x3ed726.nextRespawnAt !== null && _0x3ed726.nextRespawnAt <= _0x52a453);
    if (_0x2cd9fe.length > 0) {
      _0x2cd9fe.sort((_0x425750, _0x371909) => _0x425750.nextRespawnAt - _0x371909.nextRespawnAt);
      const _0x30bfee = this.state.characters.findIndex(_0xce6aa6 => _0xce6aa6.id === _0x2cd9fe[0].id);
      if (_0x30bfee !== -1) {
        this.debugLog("Postać " + _0x2cd9fe[0].nick + " gotowa do sprawdzenia respawnu");
        this.state.currentCharacterIndex = _0x30bfee;
        try {
          await this.processCurrentCharacter();
        } catch (_0x1306a4) {
          this.debugLog("Błąd podczas przetwarzania postaci: " + _0x1306a4.message, "error");
          this.processNextCharacter();
        }
      }
    } else {
      const _0x53bec1 = _0xaa5d48.filter(_0x466f22 => _0x466f22.status === "Waiting");
      if (_0x53bec1.length > 0) {
        const _0x10d600 = this.state.characters.findIndex(_0x2e4065 => _0x2e4065.status === "Waiting" && _0x2e4065.enabled);
        if (_0x10d600 !== -1) {
          this.state.currentCharacterIndex = _0x10d600;
          try {
            await this.processCurrentCharacter();
          } catch (_0xeab5e4) {
            this.debugLog("Błąd podczas przetwarzania postaci: " + _0xeab5e4.message, "error");
            this.processNextCharacter();
          }
        }
      }
    }
  },
  processNextCharacter: async function () {
    if (!this.state.active || this.state.aborted) {
      return;
    }
    let _0x34946b = this.state.currentCharacterIndex;
    let _0x1ea2e7 = false;
    let _0x2caf49 = _0x34946b;
    do {
      _0x34946b = (_0x34946b + 1) % this.state.characters.length;
      const _0x2e8796 = this.state.characters[_0x34946b];
      if (_0x2e8796 && _0x2e8796.enabled && _0x2e8796.selectedBoss) {
        if (_0x2e8796.errorCount < 3 && (_0x2e8796.status !== "Respawning" || _0x2e8796.nextRespawnAt && _0x2e8796.nextRespawnAt <= Date.now())) {
          _0x1ea2e7 = true;
          break;
        }
      }
      if (_0x34946b === _0x2caf49) {
        break;
      }
    } while (!_0x1ea2e7);
    if (_0x1ea2e7) {
      this.state.currentCharacterIndex = _0x34946b;
      try {
        await this.processCurrentCharacter();
      } catch (_0x1f73c3) {
        this.debugLog("Błąd podczas przetwarzania następnej postaci: " + _0x1f73c3.message, "error");
        setTimeout(() => this.processNextCharacter(), 5000);
      }
    } else {
      this.debugLog("Nie znaleziono więcej postaci do przetworzenia, oczekiwanie na respawny");
    }
  },
  processCurrentCharacter: async function () {
    if (!this.state.active || this.state.aborted) {
      return;
    }
    this.state.isProcessing = true;
    const _0x95890c = this.state.characters[this.state.currentCharacterIndex];
    if (!_0x95890c || !_0x95890c.enabled || !_0x95890c.selectedBoss) {
      this.debugLog("Aktualna postać jest nieprawidłowa, pomijam", "warning");
      this.state.isProcessing = false;
      await this.processNextCharacter();
      return;
    }
    this.debugLog("Przetwarzanie postaci: " + _0x95890c.nick + " (" + _0x95890c.world + ")");
    _0x95890c.status = "Processing";
    try {
      const _0x572dc7 = window.Engine?.hero?.d?.nick;
      if (_0x572dc7 !== _0x95890c.nick) {
        this.debugLog("Wymagane przelogowanie na " + _0x95890c.nick);
        const _0x265973 = await this.switchToCharacter(_0x95890c);
        if (!_0x265973) {
          this.debugLog("Nie udało się przełączyć na postać: " + _0x95890c.nick, "error");
          _0x95890c.status = "Error";
          _0x95890c.errorCount += 1;
          this.state.isProcessing = false;
          await this.processNextCharacter();
          return;
        }
      }
      await this.performSmallRandomMovement();
      await new Promise(_0x2d9297 => setTimeout(_0x2d9297, 2000));
      const _0xa0b799 = await this.runE2ForCurrentCharacter();
      if (_0xa0b799.killed) {
        _0x95890c.lastKillTime = Date.now();
        _0x95890c.respawnTime = _0xa0b799.respawnTime || 960000;
        _0x95890c.nextRespawnAt = Date.now() + _0x95890c.respawnTime;
        _0x95890c.status = "Killed";
        this.debugLog(_0x95890c.nick + " zabił E2, następny respawn o: " + new Date(_0x95890c.nextRespawnAt).toLocaleTimeString());
      } else if (_0xa0b799.notFound) {
        if (!_0x95890c.respawnTime) {
          _0x95890c.respawnTime = 960000;
        }
        const _0x54f9b9 = Date.now() - 600000;
        _0x95890c.lastKillTime = _0x54f9b9;
        _0x95890c.nextRespawnAt = _0x54f9b9 + _0x95890c.respawnTime;
        _0x95890c.status = "NotFound";
        this.debugLog(_0x95890c.nick + " - E2 nie znaleziony, szacowany respawn o: " + new Date(_0x95890c.nextRespawnAt).toLocaleTimeString());
      } else if (_0xa0b799.error) {
        _0x95890c.errorCount += 1;
        _0x95890c.status = "Error";
        this.debugLog("Błąd podczas przetwarzania " + _0x95890c.nick + ": " + _0xa0b799.error, "error");
      }
    } catch (_0x4054c0) {
      this.debugLog("Błąd podczas przetwarzania postaci " + _0x95890c.nick + ": " + _0x4054c0.message, "error");
      _0x95890c.status = "Error";
      _0x95890c.errorCount += 1;
    } finally {
      this.state.isProcessing = false;
      if (this.state.active && !this.state.aborted) {
        await this.processNextCharacter();
      }
    }
  },
  switchToCharacter: async function (_0x5e7e0d) {
    return new Promise(async _0x3f6fb1 => {
      this.debugLog("Przełączanie na postać: " + _0x5e7e0d.nick + " (" + _0x5e7e0d.world + ")");
      try {
        window.Engine.interface.clickLogout();
        const _0x3122f7 = await this.waitForElement(".relogger-window", 10000);
        if (!_0x3122f7) {
          this.debugLog("Timeout: Nie znaleziono okna logowania", "error");
          _0x3f6fb1(false);
          return;
        }
        await new Promise(_0x47d970 => setTimeout(_0x47d970, 1000));
        const _0x40a7ba = document.querySelectorAll(".relogger__one-world");
        let _0x5e9aa4 = false;
        for (const _0x178a88 of _0x40a7ba) {
          if (_0x178a88.getAttribute("data-world") === _0x5e7e0d.world) {
            _0x178a88.click();
            _0x5e9aa4 = true;
            break;
          }
        }
        if (!_0x5e9aa4) {
          this.debugLog("Nie znaleziono świata: " + _0x5e7e0d.world, "error");
          _0x3f6fb1(false);
          return;
        }
        await new Promise(_0x3f4a43 => setTimeout(_0x3f4a43, 1000));
        const _0x1a501e = document.querySelector(".relogger__char-group[data-world=\"" + _0x5e7e0d.world + "\"]");
        if (!_0x1a501e) {
          this.debugLog("Nie znaleziono grupy postaci dla świata: " + _0x5e7e0d.world, "error");
          _0x3f6fb1(false);
          return;
        }
        const _0xfbf5f5 = _0x1a501e.querySelectorAll(".character-avatar");
        if (!_0xfbf5f5 || _0xfbf5f5.length === 0) {
          this.debugLog("Nie znaleziono postaci w świecie: " + _0x5e7e0d.world, "error");
          _0x3f6fb1(false);
          return;
        }
        const _0x2dd781 = window.Engine?.characterList?.list || [];
        const _0x55cc76 = _0x2dd781.filter(_0x25a161 => _0x25a161.world === _0x5e7e0d.world);
        _0x55cc76.sort((_0x4793e6, _0x461c26) => parseInt(_0x4793e6.lvl) - parseInt(_0x461c26.lvl));
        const _0x109c77 = _0x55cc76.findIndex(_0xed87a5 => _0xed87a5.id === _0x5e7e0d.id);
        if (_0x109c77 === -1 || _0x109c77 >= _0xfbf5f5.length) {
          this.debugLog("Niezgodność indeksu postaci: " + _0x5e7e0d.nick, "error");
          _0x3f6fb1(false);
          return;
        }
        this.debugLog("Klikam na postać " + _0x5e7e0d.nick + " (indeks: " + _0x109c77 + ")");
        _0xfbf5f5[_0x109c77].click();
        let _0x3e13fa = 0;
        const _0x409f20 = 20;
        const _0x34359b = setInterval(() => {
          _0x3e13fa++;
          if (this.state.aborted) {
            clearInterval(_0x34359b);
            _0x3f6fb1(false);
            return;
          }
          const _0x50006d = window.Engine?.hero?.d?.nick;
          if (_0x50006d === _0x5e7e0d.nick) {
            clearInterval(_0x34359b);
            this.debugLog("Pomyślnie zalogowano jako: " + _0x5e7e0d.nick);
            _0x3f6fb1(true);
            return;
          }
          if (_0x3e13fa >= _0x409f20) {
            clearInterval(_0x34359b);
            this.debugLog("Timeout logowania dla postaci: " + _0x5e7e0d.nick, "error");
            _0x3f6fb1(false);
          }
        }, 1000);
      } catch (_0x331703) {
        this.debugLog("Błąd podczas przełączania postaci: " + _0x331703.message, "error");
        _0x3f6fb1(false);
      }
    });
  },
  runE2ForCurrentCharacter: async function () {
    const _0x1f70e9 = this.state.characters[this.state.currentCharacterIndex];
    if (!_0x1f70e9 || !_0x1f70e9.bossData) {
      return {
        error: "Brak danych bossa E2"
      };
    }
    this.debugLog("Uruchamianie E2 dla " + _0x1f70e9.nick + ", cel: " + _0x1f70e9.selectedBoss);
    _0x1f70e9.status = "Fighting";
    try {
      const _0x44bbaf = window.MargonemAPI.navigation.getCurrentLocation();
      const _0x57d240 = _0x1f70e9.bossData.map;
      if (_0x44bbaf !== _0x57d240) {
        this.debugLog("Nawigacja do mapy E2: " + _0x57d240);
        const _0x24d5ac = await this.navigateToE2Location(_0x1f70e9.bossData);
        if (!_0x24d5ac.success) {
          return {
            error: "Nie udało się nawigować do lokacji E2"
          };
        }
      }
      this.debugLog("Rozpoczynam poszukiwanie E2");
      const _0x405df2 = await this.findAndFightE2(_0x1f70e9);
      return _0x405df2;
    } catch (_0x644008) {
      this.debugLog("Błąd w runE2ForCurrentCharacter dla " + _0x1f70e9.nick + ": " + _0x644008.message, "error");
      const _0xcdaf12 = {
        error: _0x644008.message
      };
      return _0xcdaf12;
    }
  },
  navigateToE2Location: async function (_0x141301) {
    const _0x5288f7 = _0x141301.map;
    const _0xd4aaf = _0x141301.x;
    const _0x44a47e = _0x141301.y;
    this.debugLog("Nawigacja do lokacji E2: mapa=" + _0x5288f7 + ", x=" + _0xd4aaf + ", y=" + _0x44a47e);
    const _0x2bdb97 = 3;
    let _0xb6d4d8 = 0;
    while (_0xb6d4d8 < _0x2bdb97) {
      if (this.state.aborted) {
        return {
          success: false,
          error: "Process aborted"
        };
      }
      try {
        this.debugLog("Próba nawigacji do mapy " + _0x5288f7 + " (próba " + (_0xb6d4d8 + 1) + "/" + _0x2bdb97 + ")");
        await window.MargonemAPI.navigation.goToLocation(_0x5288f7);
        if (this.state.aborted) {
          return {
            success: false,
            error: "Process aborted"
          };
        }
        const _0xb2c8cd = await this.waitForMapChange(_0x5288f7);
        if (this.state.aborted) {
          return {
            success: false,
            error: "Process aborted"
          };
        }
        if (_0xb2c8cd) {
          this.debugLog("Pomyślnie nawigowano do mapy " + _0x5288f7);
          if (_0xd4aaf !== undefined && _0x44a47e !== undefined) {
            this.debugLog("Nawigacja do koordynatów: (" + _0xd4aaf + ", " + _0x44a47e + ")");
            const _0x5511de = {
              x: _0xd4aaf,
              y: _0x44a47e
            };
            window.Engine.hero.autoGoTo(_0x5511de, false);
            await new Promise(_0x28f641 => {
              const _0x2fbe07 = setInterval(() => {
                if (this.state.aborted) {
                  clearInterval(_0x2fbe07);
                  _0x28f641();
                  return;
                }
                const _0x5697cf = Math.floor(window.Engine.hero.x || window.Engine.hero.d && window.Engine.hero.d.x);
                const _0x1d8a2e = Math.floor(window.Engine.hero.y || window.Engine.hero.d && window.Engine.hero.d.y);
                if (Math.abs(_0x5697cf - _0xd4aaf) <= 3 && Math.abs(_0x1d8a2e - _0x44a47e) <= 3) {
                  clearInterval(_0x2fbe07);
                  _0x28f641();
                }
              }, 1000);
              setTimeout(() => {
                clearInterval(_0x2fbe07);
                _0x28f641();
              }, 30000);
            });
          }
          return {
            success: true
          };
        }
      } catch (_0x3e0c4a) {
        this.debugLog("Błąd nawigacji: " + _0x3e0c4a.message, "error");
      }
      _0xb6d4d8++;
      if (_0xb6d4d8 < _0x2bdb97) {
        this.debugLog("Ponawiam próbę nawigacji po błędzie (" + _0xb6d4d8 + "/" + _0x2bdb97 + ")");
        await new Promise(_0xc57893 => setTimeout(_0xc57893, 3000));
      }
      if (this.state.aborted) {
        return {
          success: false,
          error: "Process aborted"
        };
      }
    }
    this.debugLog("Nie udało się nawigować do lokacji E2 po wszystkich próbach", "error");
    return {
      success: false,
      error: "Failed to navigate to E2 location after all attempts"
    };
  },
  waitForMapChange: async function (_0xa87478) {
    const _0x4a72ea = 60000;
    const _0x4033d9 = Date.now();
    this.debugLog("Oczekiwanie na zmianę mapy na: " + _0xa87478);
    while (Date.now() - _0x4033d9 < _0x4a72ea) {
      if (this.state.aborted) {
        return false;
      }
      const _0x2298e5 = window.MargonemAPI.navigation.getCurrentLocation();
      if (_0x2298e5 === _0xa87478) {
        this.debugLog("Zmiana mapy zakończona pomyślnie: " + _0xa87478);
        return true;
      }
      await new Promise(_0x28cf9f => setTimeout(_0x28cf9f, 1000));
    }
    this.debugLog("Timeout podczas oczekiwania na zmianę mapy na: " + _0xa87478, "error");
    return false;
  },
  waitForElement: function (_0x34f7be, _0x45de18 = 10000) {
    return new Promise(_0x3c3cc3 => {
      if (document.querySelector(_0x34f7be)) {
        return _0x3c3cc3(document.querySelector(_0x34f7be));
      }
      const _0x3d6019 = new MutationObserver(() => {
        if (document.querySelector(_0x34f7be)) {
          _0x3d6019.disconnect();
          _0x3c3cc3(document.querySelector(_0x34f7be));
        }
      });
      _0x3d6019.observe(document.body, {
        childList: true,
        subtree: true
      });
      setTimeout(() => {
        _0x3d6019.disconnect();
        _0x3c3cc3(null);
      }, _0x45de18);
    });
  },
  findAndFightE2: async function (_0x413cad) {
    if (this.state.aborted) {
      return {
        error: "Process aborted"
      };
    }
    const _0x4a7d29 = 60000;
    const _0x1fafab = Date.now();
    let _0x32e074 = null;
    this.debugLog("Rozpoczynam szukanie E2 dla " + _0x413cad.nick);
    while (Date.now() - _0x1fafab < _0x4a7d29) {
      if (this.state.aborted) {
        return {
          error: "Process aborted"
        };
      }
      const _0x429327 = window.Engine;
      if (!_0x429327) {
        await new Promise(_0x21ffa4 => setTimeout(_0x21ffa4, 1000));
        continue;
      }
      const _0xb5ee5a = window.MargonemAPI.navigation.getCurrentLocation();
      if (_0xb5ee5a !== _0x413cad.bossData.map) {
        this.debugLog("Nie jesteśmy na właściwej mapie (" + _0xb5ee5a + "), próba powrotu na " + _0x413cad.bossData.map);
        const _0x26a6e6 = await this.navigateToE2Location(_0x413cad.bossData);
        if (!_0x26a6e6.success) {
          return {
            error: "Nie udało się powrócić na mapę E2"
          };
        }
      }
      const _0x4ba789 = _0x429327.npcs || {};
      if ((Date.now() - _0x1fafab) % 15000 < 1000) {
        await this.performSmallRandomMovement();
        await new Promise(_0xa5010c => setTimeout(_0xa5010c, 2000));
      }
      for (const _0x4faf15 in _0x4ba789) {
        const _0x283463 = _0x4ba789[_0x4faf15];
        if (_0x283463 && _0x283463.d && _0x283463.d.type === 2) {
          _0x32e074 = _0x283463;
          this.debugLog("Znaleziono E2! ID: " + _0x4faf15 + ", nazwa: " + _0x283463.d.nick);
          break;
        }
      }
      if (_0x32e074) {
        break;
      }
      await new Promise(_0x312696 => setTimeout(_0x312696, 1000));
    }
    if (!_0x32e074) {
      this.debugLog("Nie znaleziono E2 dla " + _0x413cad.nick + " po timeout", "warning");
      return {
        notFound: true,
        killed: false
      };
    }
    let _0x323953;
    if (_0x32e074.d.respBaseSeconds) {
      _0x323953 = (_0x32e074.d.respBaseSeconds + 60) * 1000;
      this.debugLog("Znaleziono E2 dla " + _0x413cad.nick + " z czasem respawnu: " + _0x32e074.d.respBaseSeconds + "s");
    } else {
      _0x323953 = 960000;
      this.debugLog("Znaleziono E2 dla " + _0x413cad.nick + " bez informacji o respawnie, używam domyślnego (16min)");
    }
    this.debugLog("Rozpoczynam walkę z E2 dla " + _0x413cad.nick);
    const _0x48f64c = await this.fightE2(_0x32e074);
    const _0x1ed4a4 = {
      ..._0x48f64c
    };
    _0x1ed4a4.respawnTime = _0x323953;
    return _0x1ed4a4;
  },
  fightE2: async function (_0x3df3fc) {
    if (this.state.aborted) {
      return {
        error: "Process aborted"
      };
    }
    const _0x2d2ee7 = window.Engine;
    if (!_0x2d2ee7 || !_0x2d2ee7.hero) {
      return {
        notFound: false,
        killed: false,
        error: "Engine not available"
      };
    }
    try {
      const _0x2af4c8 = Math.floor(_0x3df3fc.d.x);
      const _0xb8a4c = Math.floor(_0x3df3fc.d.y);
      this.debugLog("Angażuję E2 na koordynatach (" + _0x2af4c8 + "," + _0xb8a4c + ")");
      const _0x28dcaa = {
        x: _0x2af4c8,
        y: _0xb8a4c
      };
      _0x2d2ee7.hero.autoGoTo(_0x28dcaa, false);
      let _0x68d732 = false;
      for (let _0x40e425 = 0; _0x40e425 < 30; _0x40e425++) {
        if (this.state.aborted) {
          return {
            notFound: false,
            killed: false,
            error: "Process aborted"
          };
        }
        const _0x27f34d = Math.floor(_0x2d2ee7.hero.x || _0x2d2ee7.hero.d && _0x2d2ee7.hero.d.x);
        const _0x311d63 = Math.floor(_0x2d2ee7.hero.y || _0x2d2ee7.hero.d && _0x2d2ee7.hero.d.y);
        if (Math.abs(_0x27f34d - _0x2af4c8) <= 1 && Math.abs(_0x311d63 - _0xb8a4c) <= 1) {
          _0x68d732 = true;
          break;
        }
        await new Promise(_0x31064c => setTimeout(_0x31064c, 1000));
      }
      if (!_0x68d732) {
        this.debugLog("Nie udało się dotrzeć do E2 w wyznaczonym czasie", "warning");
        return {
          notFound: false,
          killed: false,
          error: "Failed to reach E2"
        };
      }
      if (this.state.aborted) {
        return {
          notFound: false,
          killed: false,
          error: "Process aborted"
        };
      }
      if (_0x2d2ee7.interface && typeof _0x2d2ee7.interface.clickAutofightNearMob === "function") {
        this.debugLog("Rozpoczynam autofight");
        _0x2d2ee7.interface.clickAutofightNearMob();
      } else {
        this.debugLog("Funkcja autofight niedostępna", "warning");
        return {
          notFound: false,
          killed: false,
          error: "Autofight function not available"
        };
      }
      let _0x576829 = false;
      for (let _0x4bdaf2 = 0; _0x4bdaf2 < 120; _0x4bdaf2++) {
        if (this.state.aborted) {
          return {
            notFound: false,
            killed: false,
            error: "Process aborted during combat"
          };
        }
        const _0x720d52 = document.querySelector(".battle-window");
        const _0x27ef67 = document.querySelector("div.button.green.close-battle-ground.small");
        if (!_0x720d52 || _0x27ef67) {
          if (_0x27ef67) {
            this.debugLog("Walka zakończona, zamykam okno bitwy");
            _0x27ef67.click();
            _0x576829 = true;
          } else if (!_0x720d52 && _0x4bdaf2 > 5) {
            this.debugLog("Okno bitwy nie pojawiło się, możliwe że walka nie rozpoczęła się prawidłowo", "warning");
            if (_0x4bdaf2 < 10 && _0x2d2ee7.interface && typeof _0x2d2ee7.interface.clickAutofightNearMob === "function") {
              _0x2d2ee7.interface.clickAutofightNearMob();
              await new Promise(_0xe08577 => setTimeout(_0xe08577, 1000));
              continue;
            }
            break;
          }
          const _0x58c670 = document.querySelector(".accept-button .button.green.small");
          if (_0x58c670) {
            this.debugLog("Akceptuję okno dialogowe");
            _0x58c670.click();
          }
          break;
        }
        await new Promise(_0x4ee9e5 => setTimeout(_0x4ee9e5, 1000));
      }
      this.debugLog("Walka zakończona, zabito E2: " + _0x576829);
      const _0x405acf = {
        notFound: false,
        killed: _0x576829
      };
      return _0x405acf;
    } catch (_0x2a5843) {
      this.debugLog("Błąd podczas walki z E2: " + _0x2a5843.message, "error");
      const _0x555688 = {
        notFound: false,
        killed: false,
        error: _0x2a5843.message
      };
      return _0x555688;
    }
  },
  setCharacterBoss: function (_0x48ac25, _0x1ab0e6) {
    const _0x1c70e3 = this.state.characters.findIndex(_0x27d555 => _0x27d555.id === _0x48ac25);
    if (_0x1c70e3 === -1) {
      this.debugLog("Nie znaleziono postaci o ID: " + _0x48ac25, "error");
      return false;
    }
    this.debugLog("Ustawiam bossa " + _0x1ab0e6 + " dla postaci " + this.state.characters[_0x1c70e3].nick);
    this.state.characters[_0x1c70e3].selectedBoss = _0x1ab0e6;
    this.state.characters[_0x1c70e3].bossData = window.e2 ? window.e2[_0x1ab0e6] : null;
    if (!this.state.characters[_0x1c70e3].bossData) {
      this.debugLog("Nie znaleziono danych dla bossa " + _0x1ab0e6, "warning");
    }
    return true;
  },
  toggleCharacter: function (_0x4d2340, _0x572dd5) {
    const _0x1b5b70 = this.state.characters.findIndex(_0xc2a9a7 => _0xc2a9a7.id === _0x4d2340);
    if (_0x1b5b70 === -1) {
      this.debugLog("Nie znaleziono postaci o ID: " + _0x4d2340, "error");
      return false;
    }
    this.debugLog((_0x572dd5 ? "Włączam" : "Wyłączam") + " postać " + this.state.characters[_0x1b5b70].nick);
    this.state.characters[_0x1b5b70].enabled = _0x572dd5;
    return true;
  },
  getState: function () {
    return {
      active: this.state.active,
      characters: this.state.characters.map(_0x4c7659 => ({
        id: _0x4c7659.id,
        nick: _0x4c7659.nick,
        world: _0x4c7659.world,
        enabled: _0x4c7659.enabled,
        selectedBoss: _0x4c7659.selectedBoss,
        status: _0x4c7659.status,
        lastKillTime: _0x4c7659.lastKillTime,
        nextRespawnAt: _0x4c7659.nextRespawnAt,
        respawnTime: _0x4c7659.respawnTime
      })),
      currentCharacterIndex: this.state.currentCharacterIndex,
      isProcessing: this.state.isProcessing,
      lastStateUpdate: this.state.lastStateUpdate,
      autoResumed: this.state.autoResumed
    };
  },
  saveStateToStorage: function () {
    try {
      if (!this.state.active) {
        localStorage.removeItem(this.STORAGE_KEY);
        return;
      }
      const _0x1ad178 = {
        active: this.state.active,
        currentCharacterIndex: this.state.currentCharacterIndex,
        lastSaved: Date.now(),
        characters: this.state.characters.map(_0x2355f => ({
          id: _0x2355f.id,
          nick: _0x2355f.nick,
          world: _0x2355f.world,
          enabled: _0x2355f.enabled,
          selectedBoss: _0x2355f.selectedBoss,
          status: _0x2355f.status,
          lastKillTime: _0x2355f.lastKillTime,
          nextRespawnAt: _0x2355f.nextRespawnAt,
          respawnTime: _0x2355f.respawnTime
        }))
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(_0x1ad178));
      this.debugLog("Stan E2 zapisany do localStorage");
    } catch (_0x421096) {
      this.debugLog("Błąd podczas zapisywania stanu: " + _0x421096.message, "error");
    }
  },
  loadStateFromStorage: function () {
    try {
      const _0x14f5bf = localStorage.getItem(this.STORAGE_KEY);
      if (!_0x14f5bf) {
        return null;
      }
      const _0x153bef = JSON.parse(_0x14f5bf);
      const _0x425f35 = 21600000;
      if (Date.now() - _0x153bef.lastSaved > _0x425f35) {
        this.debugLog("Zapisany stan jest zbyt stary, ignoruję", "warning");
        localStorage.removeItem(this.STORAGE_KEY);
        return null;
      }
      return _0x153bef;
    } catch (_0x2034c0) {
      this.debugLog("Błąd podczas wczytywania stanu: " + _0x2034c0.message, "error");
      return null;
    }
  },
  resumeFromSavedState: async function () {
    const _0x18c3f0 = this.loadStateFromStorage();
    if (!_0x18c3f0 || !_0x18c3f0.active) {
      return false;
    }
    this.debugLog("Znaleziono zapisany stan E2, przygotowuję do wznowienia");
    if (_0x18c3f0.characters && _0x18c3f0.characters.length > 0) {
      const _0x21c842 = {};
      _0x18c3f0.characters.forEach(_0x1a3b11 => {
        _0x21c842[_0x1a3b11.id] = {
          enabled: _0x1a3b11.enabled,
          selectedBoss: _0x1a3b11.selectedBoss,
          lastKillTime: _0x1a3b11.lastKillTime,
          nextRespawnAt: _0x1a3b11.nextRespawnAt,
          respawnTime: _0x1a3b11.respawnTime
        };
      });
      await this.initializeCharacters();
      this.state.characters.forEach(_0x18b1b0 => {
        const _0x378134 = _0x21c842[_0x18b1b0.id];
        if (_0x378134) {
          _0x18b1b0.enabled = _0x378134.enabled;
          _0x18b1b0.selectedBoss = _0x378134.selectedBoss;
          _0x18b1b0.bossData = _0x18b1b0.selectedBoss && window.e2 ? window.e2[_0x18b1b0.selectedBoss] : null;
          _0x18b1b0.lastKillTime = _0x378134.lastKillTime;
          _0x18b1b0.nextRespawnAt = _0x378134.nextRespawnAt;
          _0x18b1b0.respawnTime = _0x378134.respawnTime;
        }
      });
      const _0x3f481a = Date.now();
      if (_0x18c3f0.currentCharacterIndex >= 0 && _0x18c3f0.currentCharacterIndex < this.state.characters.length) {
        this.state.currentCharacterIndex = _0x18c3f0.currentCharacterIndex;
      } else {
        const _0x211efa = this.state.characters.filter(_0x567892 => _0x567892.enabled && _0x567892.selectedBoss && _0x567892.nextRespawnAt && _0x567892.nextRespawnAt <= _0x3f481a);
        if (_0x211efa.length > 0) {
          _0x211efa.sort((_0x3789e6, _0x12735c) => _0x3789e6.nextRespawnAt - _0x12735c.nextRespawnAt);
          this.state.currentCharacterIndex = this.state.characters.findIndex(_0x4bc490 => _0x4bc490.id === _0x211efa[0].id);
        } else {
          this.state.currentCharacterIndex = this.state.characters.findIndex(_0x5d8a66 => _0x5d8a66.enabled && _0x5d8a66.selectedBoss);
        }
      }
      if (this.state.currentCharacterIndex === -1) {
        this.debugLog("Brak dostępnych postaci do wznowienia", "warning");
        return false;
      }
      this.state.autoResumed = true;
      this.debugLog("Wznawianie procesu E2");
      const _0x140787 = await this.startE2();
      if (_0x140787.success) {
        this.debugLog("Proces E2 wznowiony pomyślnie!");
        return true;
      } else {
        this.debugLog("Nie udało się wznowić procesu E2: " + _0x140787.error, "error");
        return false;
      }
    }
    return false;
  }
};

setTimeout(async () => {
  if (window.MargonemAPI && window.MargonemAPI.e2) {
    console.log("[E2 API] Inicjalizacja systemu E2");
    const _0xc6fd95 = await window.MargonemAPI.e2.resumeFromSavedState();
    if (!_0xc6fd95) {
      window.MargonemAPI.e2.initializeCharacters();
      console.log("[E2 API] Zainicjalizowano system E2");
    }
  }
}, 2000);
