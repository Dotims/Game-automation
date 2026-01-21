// Helper Functions - Extracted from logic.js
// Utility functions for navigation, items, and DOM

async function waitForPosition(_0x5c008d, _0x1c64a9, _0x37ea45 = 30000) {
  return new Promise((_0x1ba1fb, _0x21ab18) => {
    const _0x26205b = Date.now();
    const _0xa559e6 = setInterval(() => {
      const _0x3ae3fa = window.Engine;
      if (!_0x3ae3fa?.hero) {
        clearInterval(_0xa559e6);
        _0x21ab18(new Error("No hero found"));
        return;
      }
      const _0x3f75c7 = Math.floor(_0x3ae3fa.hero.x || _0x3ae3fa.hero.d && _0x3ae3fa.hero.d.x);
      const _0x24ec75 = Math.floor(_0x3ae3fa.hero.y || _0x3ae3fa.hero.d && _0x3ae3fa.hero.d.y);
      if (Math.abs(_0x3f75c7 - _0x5c008d) <= 1 && Math.abs(_0x24ec75 - _0x1c64a9) <= 1) {
        clearInterval(_0xa559e6);
        _0x1ba1fb(true);
        return;
      }
      if (Date.now() - _0x26205b > _0x37ea45) {
        clearInterval(_0xa559e6);
        const _0x94520d = {
          targetX: _0x5c008d,
          targetY: _0x1c64a9
        };
        _0x3ae3fa.hero.autoGoTo(_0x94520d, false);
        _0x21ab18(new Error("Movement timeout after " + _0x37ea45 + "ms"));
        return;
      }
    }, 100);
    window.addEventListener("beforeunload", () => {
      clearInterval(_0xa559e6);
      _0x21ab18(new Error("Game disconnected"));
    }, {
      once: true
    });
  });
}
function isLocationInExpowisko(_0x447a15, _0x44faea) {
  return Expowiska[_0x447a15]?.some(_0x58aea8 => _0x44faea in _0x58aea8) || false;
}
function buyItem(_0x47fa99) {
  let _0x3b1512 = window.Engine.shop.items;
  if (_0x3b1512 && _0x3b1512[_0x47fa99]) {
    let _0x4b70ce = _0x3b1512[_0x47fa99];
    window.Engine.shop.basket.buyItem(_0x4b70ce);
  } else {}
}
function wybierzIdNajlepszejPotki(_0x11d610) {
  if (!window.Engine || !window.Engine.shop || !window.Engine.shop.items) {
    return;
  }
  const _0x1a2dc2 = _0x11d610 / 3;
  const _0x50c75f = window.Engine.shop.items;
  let _0x2661f7 = null;
  let _0x5940fd = Infinity;
  for (const _0x129f48 in _0x50c75f) {
    if (_0x50c75f.hasOwnProperty(_0x129f48)) {
      const _0x2feced = _0x50c75f[_0x129f48];
      if (_0x2feced._cachedStats && _0x2feced._cachedStats.leczy !== undefined) {
        const _0x35ad8d = parseFloat(_0x2feced._cachedStats.leczy);
        if (isNaN(_0x35ad8d)) {
          continue;
        }
        const _0xb69f72 = Math.abs(_0x35ad8d - _0x1a2dc2);
        if (_0xb69f72 < _0x5940fd) {
          _0x5940fd = _0xb69f72;
          _0x2661f7 = _0x2feced.id;
        }
      }
    }
  }
  if (_0x2661f7 === null) {} else {}
  return _0x2661f7;
}
function policzLeczyPrzedmioty() {
  const _0x1536d4 = window.Engine;
  if (!_0x1536d4) {
    return;
  }
  const _0x3dce39 = _0x1536d4.items.fetchLocationItems("g");
  if (!_0x3dce39 || !_0x3dce39.length) {
    return;
  }
  let _0xaf486a = 0;
  _0x3dce39.forEach(_0x3dc611 => {
    if (_0x3dc611._cachedStats && _0x3dc611._cachedStats.leczy !== undefined) {
      let _0x59acd4 = parseInt(_0x3dc611._cachedStats.amount, 10);
      if (isNaN(_0x59acd4)) {
        _0x59acd4 = 1;
      }
      _0xaf486a += _0x59acd4;
    }
  });
  return _0xaf486a;
}
function sprawdzPrzedmiot(_0x54740f) {
  const _0x121797 = window.Engine;
  if (!_0x121797) {
    return false;
  }
  const _0x4aef91 = _0x121797.items.fetchLocationItems("g");
  if (!_0x4aef91 || !_0x4aef91.length) {
    return false;
  }
  const _0xaf3ca3 = _0x4aef91.find(_0x16df98 => _0x16df98.name === _0x54740f);
  if (_0xaf3ca3) {
    return true;
  } else {
    return false;
  }
}
function uzyjPrzedmiot(_0x4a0192) {
  const _0x43d865 = window.Engine;
  if (!_0x43d865) {
    return;
  }
  const _0x18f196 = _0x43d865.items.fetchLocationItems("g");
  if (!_0x18f196 || !_0x18f196.length) {
    return;
  }
  const _0x220a56 = _0x18f196.find(_0x25d677 => _0x25d677.name === _0x4a0192);
  if (!_0x220a56) {
    return;
  }
  window._g("moveitem&st=1&id=" + _0x220a56.id, function () {});
}
function uzyjPierwszyTeleport() {
  const _0x42226b = window.Engine;
  if (!_0x42226b) {
    return;
  }
  const _0x22e38d = _0x42226b.items.fetchLocationItems("g");
  if (!_0x22e38d || !_0x22e38d.length) {
    return;
  }
  const _0x316fdf = _0x22e38d.find(_0x1a0131 => {
    if (_0x1a0131._cachedStats && _0x1a0131._cachedStats.teleport) {
      return true;
    }
    if (_0x1a0131.stat && typeof _0x1a0131.stat === "string" && _0x1a0131.stat.includes("teleport=")) {
      return true;
    }
    return false;
  });
  if (!_0x316fdf) {
    return;
  }
  window._g("moveitem&st=1&id=" + _0x316fdf.id, function () {
    console.log("Teleportacja wykonana");
  });
}
function sleep(_0x278140) {
  return new Promise(_0x157807 => setTimeout(_0x157807, _0x278140));
}
function normalizeLocationName(_0x20b6c3) {
  return _0x20b6c3.trim().replace(/\s+/g, " ");
}
function waitForElement(_0x3e3630) {
  return new Promise(_0x4d9032 => {
    if (document.querySelector(_0x3e3630)) {
      return _0x4d9032(document.querySelector(_0x3e3630));
    }
    const _0x2fff2d = setInterval(() => {
      const _0x25bf1f = document.querySelector(_0x3e3630);
      if (_0x25bf1f) {
        clearInterval(_0x2fff2d);
        _0x4d9032(_0x25bf1f);
      }
    }, 500);
  });
}
function waitForElementToDisappear(_0xcb2aec) {
  return new Promise(_0x3c82e8 => {
    if (!document.querySelector(_0xcb2aec)) {
      return _0x3c82e8();
    }
    const _0x485799 = setInterval(() => {
      window.Engine.shop.close();
      if (!document.querySelector(_0xcb2aec)) {
        clearInterval(_0x485799);
        _0x3c82e8();
      }
    }, 500);
  });
}
