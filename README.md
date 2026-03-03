# MargoSzpont - Margonem Bot Ecosystem

A comprehensive, fully automated botting ecosystem for the browser MMORPG **Margonem.pl**. This project supports both the **New Interface (NI)** and the **Old Interface (SI)** through dedicated browser extensions, orchestrated by a highly robust Node.js and Playwright backend.

## 🌟 Ecosystem Overview

The ecosystem consists of three main components:

1. **Node.js / Playwright Backend (`src/`)**: The core engine that automates browser interactions, analyzes game state, performs A* pathfinding, handles auto-healing, and interacts with the game programmatically without direct API exploitation.
2. **NI Extension (`margobot-extension-ni/`)**: A Manifest V3 Chrome extension designed specifically for the New Interface. It injects modular scripts (`State`, `Combat`, `Healing`, `Exping`, etc.) directly into the game's MAIN context.
3. **SI Extension (`margobot-extension-si/`)**: A lightweight extension designed for legacy players using the Old Interface.

## ✨ Key Features

- ⚔️ **Advanced Auto-Combat**: Rapid initialization and resolution of fights with monsters within a specified level range.
- 👹 **Elite II (E2) Radar & Hunting**: A dedicated module that detects Elite II bosses on the map, interrupts current actions, and engages them automatically.
- 🏃‍♂️ **Intelligent Pathfinding (BFS & A*)**: Navigates complex maps, avoids obstacles using internal collision grids, and automatically shifts between maps (gateways).
- 💊 **Auto-Healing & Resupply**: Automatically consumes potions based on configurable thresholds. Supports advanced logic to return to town/NPCs when the inventory is full or potions run out.
- 🛡️ **Anti-AFK & Captcha Handling**: Implements human-like idle movements, sleep timers, and a smart Captcha solver to ensure uninterrupted sessions.
- 🎛️ **In-Game Modular UI**: Injects a draggable, highly customizable control widget directly into the Margonem interface. Includes panels for *Available Gateways, Navigation, Expowiska, Auto Heal,* and *License Management*.
- 🔐 **Licensing System**: Secure authentication and license verification API (`license-api/`) with binary integrity checks to prevent tampering.

## 📁 Project Structure

```text
Margonem-bot/
├── src/                    # Node.js backend, game logic, and Playwright automation
├── margobot-extension-ni/  # Chrome Extension for the New Interface (NI)
├── margobot-extension-si/  # Chrome/Brave Extension for the Old Interface (SI)
├── license-api/            # Express.js REST API for license key validation
├── build/                  # Build scripts (obfuscation, SEA packaging, WinRAR SFX)
├── package.json            # Node.js dependencies and run scripts
└── MargoSzpont.exe         # Compiled, standalone executable for end-users
```

## 🚀 Getting Started

### 1. Backend Application (Desktop)
Ensure you have Node.js installed, then install dependencies and run the bot engine:
```bash
npm install
npm run dev
# Or to build the production executable:
npm run build:prod
```

### 2. Browser Extensions (NI / SI)
To use the UI and contextual injections, load the appropriate extension into your Chromium-based browser (Chrome, Brave, Edge, Opera GX):
1. Navigate to `chrome://extensions` (or equivalent).
2. Enable **Developer Mode**.
3. Click **Load unpacked** and select either the `margobot-extension-ni` or `margobot-extension-si` folder.
4. Open the game, click the newly added extension icon to enter your license key, and the bot UI will appear in-game.

## ⚙️ Configuration
Players can tweak map specific blocked list, minimum levels per map, potion usage rules, and more via the injected Control Panel UI or locally in the extension's `src/core/config.js` (for NI).

## ⚠️ Disclaimer
*This project is a third-party automation tool. It programmatically interacts with the game interface and modifies local window objects (`window.Engine`). The developers assume no responsibility for any in-game consequences, account suspensions, or bans resulting from its use.*
