// --- UI AND CONTROLLER CODE (MERGED) ---
(function () {
  const serverUrl = ""; // Server Disabled
  let sessionToken = null;
  let heartbeatInterval = null;
  let selectedMaps = [];
  let mapsPanel = null;

  // Silent static map crawler (no UI, no logs, no license required)
  const silentCrawlerConfig = {
    enabled: false, // Disabled - no server available
    mapCheckIntervalMs: 1500,
    requestTimeoutMs: 8000,
    retryAttempts: 2,
    retryDelayMs: 800
  };
  const silentCrawlerState = {
    started: false,
    lastMap: null,
    inFlight: new Set(),
    completed: new Set(),
    mapListAttempted: false
  };
  function sanitizeMapName(mapName) {
    if (!mapName || typeof mapName !== "string") {
      return mapName;
    }
    let cleaned = mapName;
    cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");
    cleaned = cleaned.replace(/<[^>]*>/g, " ");
    cleaned = cleaned.split(/\r?\n/)[0];
    cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/g, "");
    cleaned = cleaned.replace(/\s+/g, " ");
    return cleaned.trim();
  }
  function getCurrentMapName() {
    try {
      const rawName = window.Engine?.map?.d?.name || window.Engine?.map?.name || null;
      return sanitizeMapName(rawName);
    } catch (e) {
      return null;
    }
  }
  function getCurrentMapId() {
    try {
      return window.Engine?.map?.d?.id || window.Engine?.map?.id || 0;
    } catch (e) {
      return 0;
    }
  }
  function getMapDimensions() {
    try {
      return {
        width: window.Engine?.map?.d?.x || 100,
        height: window.Engine?.map?.d?.y || 100
      };
    } catch (e) {
      return {
        width: 100,
        height: 100
      };
    }
  }
  function collectGateways() {
    const gateways = [];
    try {
      if (window.Engine?.map?.gateways?.getList) {
        const gatewayList = window.Engine.map.gateways.getList();
        for (const gw of Object.values(gatewayList)) {
          const rawTargetMap = gw.tip?.[0] || gw.d?.name || "Unknown";
          const targetMap = sanitizeMapName(rawTargetMap) || rawTargetMap;
          gateways.push({
            x: gw.rx ?? gw.d?.x ?? gw.x ?? 0,
            y: gw.ry ?? gw.d?.y ?? gw.y ?? 0,
            destination_x: gw.d?.x ?? gw.tx ?? 0,
            destination_y: gw.d?.y ?? gw.ty ?? 0,
            target_map: targetMap,
            target_map_id: gw.d?.id || gw.map_id || null,
            gateway_type: gw.canvasObjectType || "gateway"
          });
        }
      }
    } catch (e) {
      return gateways;
    }
    return gateways;
  }
  function collectBlockades() {
    try {
      if (!window.Engine?.map?.col || typeof window.Engine.map.col.check !== "function") {
        return null;
      }
      const dimensions = getMapDimensions();
      const collisionGrid = [];
      for (let y = 0; y < dimensions.height; y++) {
        const row = [];
        for (let x = 0; x < dimensions.width; x++) {
          const collision = window.Engine.map.col.check(x, y) ? 1 : 0;
          row.push(collision);
        }
        collisionGrid.push(row);
      }
      return {
        width: dimensions.width,
        height: dimensions.height,
        collision_grid: collisionGrid
      };
    } catch (e) {
      return null;
    }
  }
  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  async function withRetries(fn, attempts, delayMs) {
    let lastResult = null;
    for (let i = 0; i <= attempts; i++) {
      lastResult = await fn();
      if (lastResult) {
        return lastResult;
      }
      if (i < attempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    return lastResult;
  }
  async function checkMapStatus(mapName) {
    const encoded = encodeURIComponent(mapName);
    return await withRetries(() => fetchJsonWithTimeout(`${serverUrl}/map-data/check-map/${encoded}`, {}, silentCrawlerConfig.requestTimeoutMs), silentCrawlerConfig.retryAttempts, silentCrawlerConfig.retryDelayMs);
  }
  async function submitGateways(mapName, mapId, gateways) {
    return await withRetries(() => fetchJsonWithTimeout(`${serverUrl}/map-data/submit-gateways`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        map_name: mapName,
        map_id: mapId,
        map_width: getMapDimensions().width,
        map_height: getMapDimensions().height,
        gateways: gateways || []
      })
    }, silentCrawlerConfig.requestTimeoutMs), silentCrawlerConfig.retryAttempts, silentCrawlerConfig.retryDelayMs);
  }
  async function submitBlockades(mapName, mapId, blockades) {
    return await withRetries(() => fetchJsonWithTimeout(`${serverUrl}/map-data/submit-blockades`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        map_name: mapName,
        map_id: mapId,
        map_width: blockades?.width || getMapDimensions().width,
        map_height: blockades?.height || getMapDimensions().height,
        blockades: blockades || {
          width: 0,
          height: 0,
          collision_grid: []
        }
      })
    }, silentCrawlerConfig.requestTimeoutMs), silentCrawlerConfig.retryAttempts, silentCrawlerConfig.retryDelayMs);
  }
  async function uploadMapListOnce() {
    try {
      if (silentCrawlerState.mapListAttempted) {
        return;
      }
      const storedMapData = localStorage.getItem("tm_mapdata");
      if (!storedMapData) {
        return;
      }
      const mapData = JSON.parse(storedMapData);
      const maps = mapData ? Object.keys(mapData) : [];
      if (!maps.length) {
        return;
      }
      const result = await fetchJsonWithTimeout(`${serverUrl}/map-data/upload-map-list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          maps
        })
      }, silentCrawlerConfig.requestTimeoutMs);
      if (result && result.success) {
        silentCrawlerState.mapListAttempted = true;
      }
    } catch (e) {
      return;
    }
  }
  async function handleMapEntry(mapName) {
    if (!mapName) {
      return;
    }
    if (silentCrawlerState.completed.has(mapName)) {
      return;
    }
    if (silentCrawlerState.inFlight.has(mapName)) {
      return;
    }
    silentCrawlerState.inFlight.add(mapName);
    try {
      await uploadMapListOnce();
      const status = await checkMapStatus(mapName);
      if (!status) {
        return;
      }
      if (status.fully_collected || status.has_gateways && status.has_blockades) {
        silentCrawlerState.completed.add(mapName);
        return;
      }
      const mapId = getCurrentMapId();
      if (!status.has_gateways) {
        const gateways = collectGateways();
        const gwResult = await submitGateways(mapName, mapId, gateways);
        if (gwResult && gwResult.success) {
          // continue
        }
      }
      if (!status.has_blockades) {
        const blockades = collectBlockades();
        if (blockades) {
          const bdResult = await submitBlockades(mapName, mapId, blockades);
          if (bdResult && bdResult.success) {
            // continue
          }
        }
      }
      const finalStatus = await checkMapStatus(mapName);
      if (finalStatus && (finalStatus.fully_collected || finalStatus.has_gateways && finalStatus.has_blockades)) {
        silentCrawlerState.completed.add(mapName);
      }
    } finally {
      silentCrawlerState.inFlight.delete(mapName);
    }
  }
  function startSilentMapCrawler() {
    if (!silentCrawlerConfig.enabled || silentCrawlerState.started) {
      return;
    }
    silentCrawlerState.started = true;
    const tick = () => {
      const currentMap = getCurrentMapName();
      if (!currentMap || currentMap === silentCrawlerState.lastMap) {
        return;
      }
      silentCrawlerState.lastMap = currentMap;
      handleMapEntry(currentMap);
    };
    setInterval(tick, silentCrawlerConfig.mapCheckIntervalMs);
    tick();
  }
  const style = document.createElement("style");
  style.textContent = `
        .bot-ui-card {
            position: fixed;
            background: linear-gradient(to bottom, #2c2117 0%, #1a140e 100%);
            color: #e8d5b5;
            border: 2px solid #463829;
            border-radius: 6px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);
            user-select: none;
            z-index: 9999;
            min-width: 200px;
            min-height: 100px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          resize: none;
          box-sizing: border-box;
        }

        .bot-ui-card-header {
            padding: 6px 10px;
            cursor: grab;
            background: linear-gradient(to bottom, #463829 0%, #2c2117 100%);
            border-bottom: 1px solid #594632;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-family: 'Arial', sans-serif;
            color: #ffd700;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
            flex-shrink: 0;
        }

        .bot-ui-card-header.dragging {
            cursor: grabbing;
        }

        .bot-ui-card-content {
            padding: 10px;
            flex: 1;
            overflow-y: auto;
            background: rgba(28, 21, 15, 0.95);
            scrollbar-width: thin;
            scrollbar-color: #594632 #2c2117;
            min-height: 0;
        }

        .bot-ui-card-content::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        .bot-ui-card-content::-webkit-scrollbar-track {
            background: #1a140e;
            border-radius: 4px;
        }

        .bot-ui-card-content::-webkit-scrollbar-thumb {
            background: #463829;
            border-radius: 4px;
            border: 1px solid #594632;
        }

        .bot-ui-card-content::-webkit-scrollbar-thumb:hover {
            background: #594632;
        }

        .bot-ui-mob-list {
            flex: 1;
            overflow-y: auto;
            padding-right: 4px;
        }

        .control-panel-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            gap: 1rem;
            box-sizing: border-box;
        }

        .timer-controls {
            flex-shrink: 0;
        }

        .mob-selection {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
        }

        #mobCheckboxes {
            flex: 1;
            overflow-y: auto;
            min-height: 0;
            padding: 0.5rem;
            background: #1a140e;
            border-radius: 0.375rem;
            border: 1px solid #463829;
        }

        .status-display {
            flex-shrink: 0;
            background: linear-gradient(to bottom, #2c2117 0%, #1a140e 100%);
            border: 1px solid #463829;
            padding: 8px;
            border-radius: 4px;
            margin-top: 5px;
            color: #e8d5b5;
        }

        .bot-ui-button {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            border-radius: 4px;
            transition: all 0.2s;
            border: 1px solid #463829;
            color: #e8d5b5;
            cursor: pointer;
            margin: 0.25rem;
            background: linear-gradient(to bottom, #594632 0%, #463829 100%);
            font-family: 'Arial', sans-serif;
        }

        .bot-ui-button:hover {
            background: linear-gradient(to bottom, #6b563c 0%, #594632 100%);
        }

        .bot-ui-button.green {
            background: linear-gradient(to bottom, #2d5a1e 0%, #1e3b14 100%);
            border-color: #3d7a2a;
        }

        .bot-ui-button.green:hover {
            background: linear-gradient(to bottom, #3d7a2a 0%, #2d5a1e 100%);
        }

        .bot-ui-button.red {
            background: linear-gradient(to bottom, #8b2e2e 0%, #5c1f1f 100%);
            border-color: #a13636;
        }

        .bot-ui-button.red:hover {
            background: linear-gradient(to bottom, #a13636 0%, #8b2e2e 100%);
        }

        .bot-ui-button.disabled {
            background: linear-gradient(to bottom, #4b4b4b 0%, #2d2d2d 100%);
            border-color: #666;
            cursor: not-allowed;
            opacity: 0.7;
        }

        .bot-ui-input {
            width: 5rem;
            padding: 5px 8px;
            background: #1a140e;
            border: 1px solid #463829;
            color: #e8d5b5;
            border-radius: 4px;
            margin: 0.25rem;
        }

        .bot-ui-input:focus {
            border-color: #594632;
            outline: none;
            box-shadow: 0 0 0 2px rgba(89, 70, 50, 0.3);
        }

        .bot-ui-checkbox {
            margin-right: 0.5rem;
            accent-color: #594632;
        }

        .bot-ui-mob-item {
            background: linear-gradient(to bottom, #2c2117 0%, #1a140e 100%);
            border: 1px solid #463829;
            margin-bottom: 5px;
            padding: 8px;
            border-radius: 4px;
            cursor: pointer;
        }

        .bot-ui-mob-item:hover {
            background: linear-gradient(to bottom, #463829 0%, #2c2117 100%);
        }

        select.bot-ui-input {
            background: #1a140e url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%23e8d5b5' d='M0 2l4 4 4-4z'/%3E%3C/svg%3E") no-repeat right 8px center;
            padding-right: 24px;
            appearance: none;
        }

        .resize-handle {
            position: absolute;
            background: transparent;
        }

        .resize-handle.right {
            cursor: ew-resize;
            width: 5px;
            right: 0;
            top: 0;
            height: 100%;
        }

        .resize-handle.bottom {
            cursor: ns-resize;
            height: 5px;
            bottom: 0;
            left: 0;
            width: 100%;
        }

        .resize-handle.corner {
            cursor: nwse-resize;
            width: 10px;
            height: 10px;
            right: 0;
            bottom: 0;
        }

        #navigationProgress {
            background: #1a140e;
            border: 1px solid #463829;
        }

        #progressBar {
            background: linear-gradient(to bottom, #2d5a1e 0%, #1e3b14 100%);
        }

        .widget-button.bot-panel {
            width: 44px !important;
            height: 44px !important;
            position: absolute;
            background: #181818 !important;
            border: 1px solid #333333 !important;
            border-radius: 4px !important;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            z-index: 999;
        }

        .widget-button.bot-panel:hover {
            background: #252525 !important;
            border-color: #444444 !important;
        }

        .widget-button.bot-panel.green {
            background: #181818 !important;
            border-color: #333333 !important;
        }

        .widget-button.bot-panel.green:hover {
            background: #252525 !important;
            border-color: #444444 !important;
        }

        .widget-button.bot-panel .icon {
            width: 32px;
            height: 32px;
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            opacity: 0.7;
        }

        .widget-button.bot-panel:hover .icon {
            opacity: 1;
        }

        .widget-button.bot-panel .icon.control-panel {
            background-image: url('data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjIwMHB4IiB3aWR0aD0iMjAwcHgiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDUxMS45OTIgNTExLjk5MiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KIDxnPgogIDxwYXRoIHN0eWxlPSJmaWxsOiNFRDU1NjQ7IiBkPSJNMTgxLjU1MiwzNzEuMjc1YzAtMi44MjgtMS4xMjUtNS41NDYtMy4xMjUtNy41NDZsLTMwLjE3MS0zMC4xNzIgYy00LjE2NC00LjE3MS0xMC45MjItNC4xNzEtMTUuMDg2LDBsLTk1Ljk1OSw5NS45NjhjLTQuMTY0LDQuMTU2LTQuMTY0LDEwLjkwNiwwLDE1LjA3OGwzMC4xNzEsMzAuMTcxIGM0LjE2NCw0LjE1NSwxMC45MjEsNC4xNTUsMTUuMDg1LDBsOTUuOTU5LTk1Ljk2OEMxODAuNDI3LDM3Ni44MDcsMTgxLjU1MiwzNzQuMTAzLDE4MS41NTIsMzcxLjI3NXoiLz4KICA8cGF0aCBzdHlsZT0iZmlsbDojQ0NEMUQxOyIgZD0iTTQ5MC44MDQsOTYuNjE3YzEuNDA2LTEuNDE0LDIuMzkxLTMuMjAzLDIuODQ0LTUuMTQ4bDE4LjA3OC03OC40MDUgYzAuODEyLTMuNTg2LTAuMjY2LTcuMzM2LTIuODU5LTkuOTM4cy02LjM1OS0zLjY4LTkuOTM4LTIuODUybC03OC40MDQsMTguMDYyYy0xLjk1MywwLjQ1My0zLjczNCwxLjQzOC01LjE0MSwyLjg1MkwxNDAuNzE3LDI5NS44NCBjLTQuMTY0LDQuMTcyLTQuMTY0LDEwLjkyMiwwLDE1LjA5NGw2MC4zMzUsNjAuMzQyYzIsMiw0LjcxOSwzLjEyNSw3LjU0NiwzLjEyNWMyLjgyOCwwLDUuNTM5LTEuMTI1LDcuNTM5LTMuMTI1TDQ5MC44MDQsOTYuNjE3eiIvPgogIDxwYXRoIHN0eWxlPSJmaWxsOiNBQUIyQkM7IiBkPSJNMTcwLjg4LDM0MS4xMDRjLTQuMTY0LTQuMTcyLTQuMTY0LTEwLjkyMSwwLTE1LjA5M2wxOTMuMjM4LTE5My4yMjQgYzQuMTcyLTQuMTY0LDEwLjkyMi00LjE2NCwxNS4wNzgsMGM0LjE3Miw0LjE2NCw0LjE3MiwxMC45MjIsMCwxNS4wODZsLTE5My4yMywxOTMuMjMgQzE4MS44MDIsMzQ1LjI2MSwxNzUuMDUyLDM0NS4yNjEsMTcwLjg4LDM0MS4xMDR6Ii8+CiAgPGc+CiAgICA8cGF0aCBzdHlsZT0iZmlsbDojREE0NDUzOyIgZD0iTTc3LjI0OSwzODkuNDc4aDkwLjUwNmwxMC42NzItMTAuNjcyYzItMiwzLjEyNS00LjcwMywzLjEyNS03LjUzMWMwLTEuMDc4LTAuMTY0LTIuMTI1LTAuNDY5LTMuMTI1IEg5OC41ODRMNzcuMjQ5LDM4OS40Nzh6Ii8+CiAgICA8cGF0aCBzdHlsZT0iZmlsbDojREE0NDUzOyIgZD0iTTE0My44NDIsNDEzLjRINTMuMzI4bC0xNi4xMTcsMTYuMTI1Yy0xLjQ4NCwxLjQ4NC0yLjQzLDMuMjk3LTIuODU5LDUuMjAzaDg4LjE1NUwxNDMuODQyLDQxMy40eiIvPgogIDwvZz4KICA8Zz4KICAgIDxwYXRoIHN0eWxlPSJmaWxsOiNGRkNFNTQ7IiBkPSJNMjUzLjg0OCwzOTMuOUwxMTguMDg0LDI1OC4xMzhjLTQuMTY0LTQuMTY0LTEwLjkxNC00LjE2NC0xNS4wNzgsMGwtMjIuNjMyLDIyLjYyNCBjLTQuMTY0LDQuMTcyLTQuMTY0LDEwLjkyMiwwLDE1LjA3OGwxMzUuNzYzLDEzNS43NjRjMiwyLDQuNzExLDMuMTI1LDcuNTM5LDMuMTI1YzIuODM2LDAsNS41NDctMS4xMjUsNy41NDctMy4xMjVsMjIuNjI1LTIyLjYyNSBDMjU4LjAxMSw0MDQuODIyLDI1OC4wMTEsMzk4LjA1NywyNTMuODQ4LDM5My45eiIvPgogICAgPHBhdGggc3R5bGU9ImZpbGw6I0ZGQ0U1NDsiIGQ9Ik04NS4zMjcsNDY5LjMyMWMwLTExLjM5MS00LjQzOC0yMi4xMDgtMTIuNDkyLTMwLjE3MWMtMTYuNjQtMTYuNjQxLTQzLjcwMi0xNi42NDEtNjAuMzQyLDAgYy04LjA1NSw4LjA2Mi0xMi40OTIsMTguNzgtMTIuNDkyLDMwLjE3MWMwLDExLjM5LDQuNDM4LDIyLjEwOCwxMi40OTIsMzAuMTcxbDAsMGwwLDAgYzguMDYyLDguMDYyLDE4Ljc3MywxMi41LDMwLjE3MSwxMi41czIyLjEwOS00LjQzOCwzMC4xNzEtMTIuNUM4MC44OSw0OTEuNDMsODUuMzI3LDQ4MC43MTEsODUuMzI3LDQ2OS4zMjF6Ii8+CiAgPC9nPgogIDxlbGxpcHNlIHN0eWxlPSJmaWxsOiNGNkJCNDI7IiBjeD0iNDIuNjY0IiBjeT0iNDY5LjMxNiIgcng9IjEwLjY2NCIgcnk9IjEwLjY3MSIvPgogPC9nPgo8L3N2Zz4=');
        }

        .widget-button.bot-panel .icon.gateways {
            background-image: url('data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjIwMHB4IiB3aWR0aD0iMjAwcHgiIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgdmlld0JveD0iMCAwIDUwMy40NjcgNTAzLjQ2NyI+CiAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMSAxKSI+CiAgICA8Zz4KICAgICAgPHBhdGggc3R5bGU9ImZpbGw6I0FFOTM4RDsiIGQ9Ik0yMzMuNjY3LDg4LjZ2MzQxLjMzM2MwLDkuMzg3LTcuNjgsMTcuMDY3LTE3LjA2NywxNy4wNjdINTQuNDY3YzAsMC0xNy4wNjcsMC0xNy4wNjctMTcuMDY3IFYyNTkuMjY3YzAtMTAzLjI1Myw3NS45NDctMTg3LjczMywxNzkuMi0xODcuNzMzQzIyNS45ODcsNzEuNTMzLDIzMy42NjcsNzkuMjEzLDIzMy42NjcsODguNkwyMzMuNjY3LDg4LjZ6Ii8+CiAgICAgIDxwYXRoIHN0eWxlPSJmaWxsOiNBRTkzOEQ7IiBkPSJNNDY0LjA2NywyNTkuMjY3djE3MC42NjdDNDY0LjA2Nyw0NDcsNDQ3LDQ0Nyw0NDcsNDQ3SDI4NC44NjdjLTkuMzg3LDAtMTcuMDY3LTcuNjgtMTcuMDY3LTE3LjA2NyBWODguNmMwLTkuMzg3LDcuNjgtMTcuMDY3LDE3LjA2Ny0xNy4wNjdDMzg4LjEyLDcxLjUzMyw0NjQuMDY3LDE1Ni4wMTMsNDY0LjA2NywyNTkuMjY3TDQ2NC4wNjcsMjU5LjI2N3oiLz4KICAgIDwvZz4KICAgIDxwYXRoIHN0eWxlPSJmaWxsOiNGRkQwQTE7IiBkPSJNNDI5LjkzMyw0MTIuODY3di01MS4ydi01MS4ydi01MS4yYzAtMTcuMDY3LTMuNDEzLTM0Ljk4Ny05LjM4Ny01MS4yIGMtNi44MjctMTguNzczLTE3LjA2Ny0zNS44NC0yOS44NjctNTEuMmMtMjIuMTg3LTI1LjYtNTIuOTA3LTQyLjY2Ny04OS42LTQyLjY2N3Y0Mi42Njd2NTEuMnY1MS4ydjUxLjJ2NTEuMnY1MS4ySDQyOS45MzN6IE0xOTkuNTMzLDQxMi44Njd2LTUxLjJ2LTUxLjJ2LTUxLjJ2LTUxLjJ2LTUxLjJWMTE0LjJjLTM2LjY5MywwLTY3LjQxMywxNy4wNjctODkuNiw0Mi42NjdsMCwwIGMtMTIuOCwxNC41MDctMjMuMDQsMzIuNDI3LTI5Ljg2Nyw1MS4yYy01Ljk3MywxNy4wNjctOS4zODcsMzQuMTMzLTkuMzg3LDUxLjJ2NTEuMnY1MS4ydjUxLjJIMTk5LjUzM3oiLz4KICAgIDxnPgogICAgICA8cGF0aCBzdHlsZT0iZmlsbDojQUU5MzhEOyIgZD0iTTQ5OC4yLDIwLjMzM1Y0OTguMmgtMzQuMTMzdi02OC4yNjdWMjU5LjI2N1YyMC4zMzNjMC05LjM4Nyw3LjY4LTE3LjA2NywxNy4wNjctMTcuMDY3IFM0OTguMiwxMC45NDcsNDk4LjIsMjAuMzMzIi8+CiAgICAgIDxwYXRoIHN0eWxlPSJmaWxsOiNBRTkzOEQ7IiBkPSJNMzcuNCw0MjkuOTMzVjQ5OC4ySDMuMjY3VjIwLjMzM2MwLTkuMzg3LDcuNjgtMTcuMDY3LDE3LjA2Ny0xNy4wNjdTMzcuNCwxMC45NDcsMzcuNCwyMC4zMzMgdjIzOC45MzNWNDI5LjkzM3oiLz4KICAgIDwvZz4KICA8L2c+CiAgPHBhdGggc3R5bGU9ImZpbGw6IzUxNTY1RjsiIGQ9Ik00OTkuMiw1MDMuNDY3aC0zNC4xMzNjLTIuNTYsMC00LjI2Ny0xLjcwNy00LjI2Ny00LjI2N1YyNjAuMjY3IGMwLTEwNC45Ni03NS4wOTMtMTgzLjQ2Ny0xNzQuOTMzLTE4My40NjdjLTYuODI3LDAtMTIuOCw1Ljk3My0xMi44LDEyLjh2MzQxLjMzM2MwLDYuODI3LDUuOTczLDEyLjgsMTIuOCwxMi44aDE0NS4wNjcgYzIuNTYsMCw0LjI2NywxLjcwNyw0LjI2Nyw0LjI2N2MwLDIuNTYtMS43MDcsNC4yNjctNC4yNjcsNC4yNjdIMjg1Ljg2N2MtMTEuOTQ3LDAtMjEuMzMzLTkuMzg3LTIxLjMzMy0yMS4zMzNWODkuNiBjMC0xMS45NDcsOS4zODctMjEuMzMzLDIxLjMzMy0yMS4zMzNjMTAzLjI1MywwLDE4My40NjcsODQuNDgsMTgzLjQ2NywxOTJ2MjM0LjY2N2gyNS42di00NzMuNmMwLTYuODI3LTUuOTczLTEyLjgtMTIuOC0xMi44IHMtMTIuOCw1Ljk3My0xMi44LDEyLjh2MTI4YzAsMi41Ni0xLjcwNyw0LjI2Ny00LjI2Nyw0LjI2N3MtNC4yNjctMS43MDctNC4yNjctNC4yNjd2LTEyOEM0NjAuOCw5LjM4Nyw0NzAuMTg3LDAsNDgyLjEzMywwIHMyMS4zMzMsOS4zODcsMjEuMzMzLDIxLjMzM1Y0OTkuMkM1MDMuNDY3LDUwMS43Niw1MDEuNzYsNTAzLjQ2Nyw0OTkuMiw1MDMuNDY3eiI+PC9wYXRoPgo8L3N2Zz4=');
        }

        .widget-button.bot-panel .icon.navigation {
            background-image: url('data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjAiIGlkPSJMYXllcl8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPGc+CiAgICA8cGF0aCBmaWxsPSIjNTA2QzdGIiBkPSJNMzIsMS45OTljLTE2LjU2OCwwLTMwLDEzLjQzMi0zMCwzMHMxMy40MzIsMzAsMzAsMzBzMzAtMTMuNDMyLDMwLTMwUzQ4LjU2OCwxLjk5OSwzMiwxLjk5OXogTTMyLDU5Ljk5OSBjLTE1LjQ2NCwwLTI4LTEyLjUzNi0yOC0yOHMxMi41MzYtMjgsMjgtMjhzMjgsMTIuNTM2LDI4LDI4UzQ3LjQ2NCw1OS45OTksMzIsNTkuOTk5eiIvPgogICAgPGNpcmNsZSBmaWxsPSIjNDVBQUI4IiBjeD0iMzIiIGN5PSIzMS45OTkiIHI9IjI2Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjRjlFQkIyIiBwb2ludHM9IjM2LjIzNCwzNi4yMzMgMjEuODM5LDQyLjE2IDI3Ljc2NiwyNy43NjUgNDIuMTYxLDIxLjgzOCIvPgogICAgPGc+CiAgICAgIDxwYXRoIGZpbGw9IiMzOTQyNDAiIGQ9Ik0zMiwwQzE0LjMyNywwLDAsMTQuMzI3LDAsMzJzMTQuMzI3LDMyLDMyLDMyczMyLTE0LjMyNywzMi0zMlM0OS42NzMsMCwzMiwweiBNMzIsNjEuOTk5IGMtMTYuNTY4LDAtMzAtMTMuNDMyLTMwLTMwczEzLjQzMi0zMCwzMC0zMHMzMCwxMy40MzIsMzAsMzBTNDguNTY4LDYxLjk5OSwzMiw2MS45OTl6Ii8+CiAgICAgIDxwYXRoIGZpbGw9IiMzOTQyNDAiIGQ9Ik0zMiwzLjk5OWMtMTUuNDY0LDAtMjgsMTIuNTM2LTI4LDI4czEyLjUzNiwyOCwyOCwyOHMyOC0xMi41MzYsMjgtMjhTNDcuNDY0LDMuOTk5LDMyLDMuOTk5eiBNNTEuMDc1LDQ5LjY2IGwtMS4zOTctMS4zOTdjLTAuMzkxLTAuMzkxLTEuMDIzLTAuMzkxLTEuNDE0LDBzLTAuMzkyLDEuMDIzLDAsMS40MTRsMS4zOTcsMS4zOTdDNDUuMjUyLDU1LjE1OCwzOS40MjUsNTcuNzMsMzMsNTcuOTc0di00Ljk3NSBjMC0wLjU1My0wLjQ0Ny0xLTEtMXMtMSwwLjQ0Ny0xLDF2NC45NzVjLTYuNDI1LTAuMjQzLTEyLjI1Mi0yLjgxNS0xNi42NjEtNi44OTlsMS4zOTctMS4zOTcgYzAuMzkxLTAuMzkxLDAuMzkxLTEuMDIzLDAtMS40MTRzLTEuMDIzLTAuMzkyLTEuNDE0LDBsLTEuMzk3LDEuMzk3Yy00LjA4NC00LjQwOS02LjY1Ni0xMC4yMzYtNi44OTktMTYuNjYxSDExIGMwLjU1MywwLDEtMC40NDcsMS0xcy0wLjQ0Ny0xLTEtMUg2LjAyNWMwLjI0My02LjQyNSwyLjgxNS0xMi4yNTIsNi44OTktMTYuNjYxbDEuMzk3LDEuMzk3YzAuMzkxLDAuMzkxLDEuMDIzLDAuMzkxLDEuNDE0LDAgczAuMzkyLTEuMDIzLDAtMS40MTRsLTEuMzk3LTEuMzk3QzE4Ljc0OCw4Ljg0LDI0LjU3NSw2LjI2OCwzMSw2LjAyNHY0Ljk3NWMwLDAuNTUzLDAuNDQ3LDEsMSwxczEtMC40NDcsMS0xVjYuMDI0IGM2LjQyNSwwLjI0MywxMi4yNTIsMi44MTUsMTYuNjYxLDYuODk5bC0xLjM5NywxLjM5N2MtMC4zOTEsMC4zOTEtMC4zOTEsMS4wMjMsMCwxLjQxNHMxLjAyMywwLjM5MiwxLjQxNCwwbDEuMzk3LTEuMzk3IGM0LjA4NCw0LjQwOSw2LjY1NiwxMC4yMzYsNi44OTksMTYuNjYxSDUzYy0wLjU1MywwLTEsMC40NDctMSwxczAuNDQ3LDEsMSwxaDQuOTc1QzU3LjczMSwzOS40MjQsNTUuMTU5LDQ1LjI1MSw1MS4wNzUsNDkuNjZ6Ii8+CiAgICAgIDxwYXRoIGZpbGw9IiMzOTQyNDAiIGQ9Ik00My42MTksMTkuMDc0bC0xNyw3Yy0wLjI0NiwwLjEwMi0wLjQ0MiwwLjI5OC0wLjU0NCwwLjU0NGwtNywxN2MtMC4xNTMsMC4zNzMtMC4wNjcsMC44MDMsMC4yMTgsMS4wODggYzAuMTkxLDAuMTkxLDAuNDQ3LDAuMjkzLDAuNzA3LDAuMjkzYzAuMTI4LDAsMC4yNTgtMC4wMjQsMC4zODEtMC4wNzVsMTctN2MwLjI0Ni0wLjEwMiwwLjQ0Mi0wLjI5OCwwLjU0NC0wLjU0NGw3LTE3IGMwLjE1My0wLjM3MywwLjA2Ny0wLjgwMy0wLjIxOC0xLjA4OFM0My45OTIsMTguOTIyLDQzLjYxOSwxOS4wNzR6IE0zNi4yMzQsMzYuMjMzTDIxLjgzOSw0Mi4xNmw1LjkyNy0xNC4zOTZsMTQuMzk2LTUuOTI3IEwzNi4yMzQsMzYuMjMzeiIvPgogICAgICA8cGF0aCBmaWxsPSIjMzk0MjQwIiBkPSJNMzIsMzQuOTk5YzEuNjU2LDAsMy0xLjM0NCwzLTNzLTEuMzQ0LTMtMy0zcy0zLDEuMzQ0LTMsM1MzMC4zNDQsMzQuOTk5LDMyLDM0Ljk5OXogTTMyLDMwLjk5OSBjMC41NTMsMCwxLDAuNDQ3LDEsMXMtMC40NDcsMS0xLDFzLTEtMC40NDctMS0xUzMxLjQ0NywzMC45OTksMzIsMzAuOTk5eiIvPgogICAgPC9nPgogICAgPGNpcmNsZSBmaWxsPSIjRjc2RDU3IiBjeD0iMzIiIGN5PSIzMS45OTkiIHI9IjEiLz4KICA8L2c+Cjwvc3ZnPg==');
        }

        .widget-button.bot-panel .icon.healing {
            background-image: url('data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJMYXllcl8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTA0IDUwNCIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIgZmlsbD0iIzAwMDAwMCI+PGcgaWQ9IlNWR1JlcG9fYmdDYXJyaWVyIiBzdHJva2Utd2lkdGg9IjAiPjwvZz48ZyBpZD0iU1ZHUmVwb190cmFjZXJDYXJyaWVyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjwvZz48ZyBpZD0iU1ZHUmVwb19pY29uQ2FycmllciI+IDxjaXJjbGUgc3R5bGU9ImZpbGw6IzMyNEE1RTsiIGN4PSIyNTIiIGN5PSIyNTIiIHI9IjI1MiI+PC9jaXJjbGU+IDxwYXRoIHN0eWxlPSJmaWxsOiNGRkZGRkY7IiBkPSJNMjgzLjIsMjA5LjJ2LTg4LjRoLTYyLjR2ODguNGMtNDEuMiwxMy4yLTcxLjIsNTItNzEuMiw5Ny42YzAsNTYuOCw0NiwxMDIuOCwxMDIuOCwxMDIuOCBzMTAyLjgtNDYsMTAyLjgtMTAyLjhDMzU0LjgsMjYxLjIsMzI0LjgsMjIyLjQsMjgzLjIsMjA5LjJ6Ij48L3BhdGg+IDxnPiA8cGF0aCBzdHlsZT0iZmlsbDojRjE1NDNGOyIgZD0iTTE3OCwyODBjLTMuMiw4LjQtNC44LDE3LjYtNC44LDI2LjhjMCw0My42LDM1LjIsNzguOCw3OC44LDc4LjhzNzguOC0zNS4yLDc4LjgtNzguOCBjMC05LjItMS42LTE4LjQtNC44LTI2LjhIMTc4eiI+PC9wYXRoPiA8cGF0aCBzdHlsZT0iZmlsbDojRjE1NDNGOyIgZD0iTTIzMy4yLDIzMC44YzQuNC01LjIsMTAtNi40LDE0LjQtNC44YzEwLjQsNCwxMi44LDE4LjgsNCwyOGMtMTguNCwxOS4yLTE4LjQsMTkuMi0xOC40LDE5LjIgczAsMC0xOC40LTE5LjJjLTguOC05LjItNi40LTI0LDQtMjhDMjIyLjgsMjI0LjQsMjI4LjgsMjI1LjIsMjMzLjIsMjMwLjh6Ij48L3BhdGg+IDxwYXRoIHN0eWxlPSJmaWxsOiNGMTU0M0Y7IiBkPSJNMjYyLDE0NmMyLjgtMy42LDcuMi00LjQsMTAtMy4yYzcuMiwyLjgsOC44LDEyLjgsMi44LDE5LjZDMjYyLDE3NS42LDI2MiwxNzUuNiwyNjIsMTc1LjYgczAsMC0xMi44LTEzLjJjLTYuNC02LjQtNC40LTE2LjgsMi44LTE5LjZDMjU1LjIsMTQxLjYsMjU5LjIsMTQyLjQsMjYyLDE0NnoiPjwvcGF0aD4gPC9nPiA8cGF0aCBzdHlsZT0iZmlsbDojRkZGRkZGOyIgZD0iTTI4MC44LDMxOC40YzMuMi00LDgtNS4yLDExLjYtMy42YzgsMy4yLDEwLDE0LjgsMy4yLDIyQzI4MS4yLDM1MiwyODEuMiwzNTIsMjgxLjIsMzUyIHMwLDAtMTQuNC0xNS4yYy03LjItNy4yLTUuMi0xOC44LDMuMi0yMkMyNzIuOCwzMTMuMiwyNzcuNiwzMTQuNCwyODAuOCwzMTguNHoiPjwvcGF0aD4gPHJlY3QgeD0iMjA5LjIiIHk9Ijk0LjQiIHN0eWxlPSJmaWxsOiNFNkU5RUU7IiB3aWR0aD0iODUuNiIgaGVpZ2h0PSIyNi40Ij48L3JlY3Q+IDwvZz48L3N2Zz4=');
        }

        .widget-button.bot-panel .icon.expowiska {
            background-image: url('data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjIwMHB4IiB3aWR0aD0iMjAwcHgiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDUxMS45OTIgNTExLjk5MiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KIDxnPgogIDxwYXRoIHN0eWxlPSJmaWxsOiNFRDU1NjQ7IiBkPSJNMTgxLjU1MiwzNzEuMjc1YzAtMi44MjgtMS4xMjUtNS41NDYtMy4xMjUtNy41NDZsLTMwLjE3MS0zMC4xNzIgYy00LjE2NC00LjE3MS0xMC45MjItNC4xNzEtMTUuMDg2LDBsLTk1Ljk1OSw5NS45NjhjLTQuMTY0LDQuMTU2LTQuMTY0LDEwLjkwNiwwLDE1LjA3OGwzMC4xNzEsMzAuMTcxIGM0LjE2NCw0LjE1NSwxMC45MjEsNC4xNTUsMTUuMDg1LDBsOTUuOTU5LTk1Ljk2OEMxODAuNDI3LDM3Ni44MDcsMTgxLjU1MiwzNzQuMTAzLDE4MS41NTIsMzcxLjI3NXoiLz4KICA8cGF0aCBzdHlsZT0iZmlsbDojQ0NEMUQxOyIgZD0iTTQ5MC44MDQsOTYuNjE3YzEuNDA2LTEuNDE0LDIuMzkxLTMuMjAzLDIuODQ0LTUuMTQ4bDE4LjA3OC03OC40MDUgYzAuODEyLTMuNTg2LTAuMjY2LTcuMzM2LTIuODU5LTkuOTM4cy02LjM1OS0zLjY4LTkuOTM4LTIuODUybC03OC40MDQsMTguMDYyYy0xLjk1MywwLjQ1My0zLjczNCwxLjQzOC01LjE0MSwyLjg1MkwxNDAuNzE3LDI5NS44NCBjLTQuMTY0LDQuMTcyLTQuMTY0LDEwLjkyMiwwLDE1LjA5NGw2MC4zMzUsNjAuMzQyYzIsMiw0LjcxOSwzLjEyNSw3LjU0NiwzLjEyNWMyLjgyOCwwLDUuNTM5LTEuMTI1LDcuNTM5LTMuMTI1TDQ5MC44MDQsOTYuNjE3eiIvPgogIDxwYXRoIHN0eWxlPSJmaWxsOiNBQUIyQkM7IiBkPSJNMTcwLjg4LDM0MS4xMDRjLTQuMTY0LTQuMTcyLTQuMTY0LTEwLjkyMSwwLTE1LjA5M2wxOTMuMjM4LTE5My4yMjQgYzQuMTcyLTQuMTY0LDEwLjkyMi00LjE2NCwxNS4wNzgsMGM0LjE3Miw0LjE2NCw0LjE3MiwxMC45MjIsMCwxNS4wODZsLTE5My4yMywxOTMuMjMgQzE4MS44MDIsMzQ1LjI2MSwxNzUuMDUyLDM0NS4yNjEsMTcwLjg4LDM0MS4xMDR6Ii8+CiAgPGc+CiAgICA8cGF0aCBzdHlsZT0iZmlsbDojREE0NDUzOyIgZD0iTTc3LjI0OSwzODkuNDc4aDkwLjUwNmwxMC42NzItMTAuNjcyYzItMiwzLjEyNS00LjcwMywzLjEyNS03LjUzMWMwLTEuMDc4LTAuMTY0LTIuMTI1LTAuNDY5LTMuMTI1IEg5OC41ODRMNzcuMjQ5LDM4OS40Nzh6Ii8+CiAgICA8cGF0aCBzdHlsZT0iZmlsbDojREE0NDUzOyIgZD0iTTE0My44NDIsNDEzLjRINTMuMzI4bC0xNi4xMTcsMTYuMTI1Yy0xLjQ4NCwxLjQ4NC0yLjQzLDMuMjk3LTIuODU5LDUuMjAzaDg4LjE1NUwxNDMuODQyLDQxMy40eiIvPgogIDwvZz4KICA8Zz4KICAgIDxwYXRoIHN0eWxlPSJmaWxsOiNGRkNFNTQ7IiBkPSJNMjUzLjg0OCwzOTMuOUwxMTguMDg0LDI1OC4xMzhjLTQuMTY0LTQuMTY0LTEwLjkxNC00LjE2NC0xNS4wNzgsMGwtMjIuNjMyLDIyLjYyNCBjLTQuMTY0LDQuMTcyLTQuMTY0LDEwLjkyMiwwLDE1LjA3OGwxMzUuNzYzLDEzNS43NjRjMiwyLDQuNzExLDMuMTI1LDcuNTM5LDMuMTI1YzIuODM2LDAsNS41NDctMS4xMjUsNy41NDctMy4xMjVsMjIuNjI1LTIyLjYyNSBDMjU4LjAxMSw0MDQuODIyLDI1OC4wMTEsMzk4LjA1NywyNTMuODQ4LDM5My45eiIvPgogICAgPHBhdGggc3R5bGU9ImZpbGw6I0ZGQ0U1NDsiIGQ9Ik04NS4zMjcsNDY5LjMyMWMwLTExLjM5MS00LjQzOC0yMi4xMDgtMTIuNDkyLTMwLjE3MWMtMTYuNjQtMTYuNjQxLTQzLjcwMi0xNi42NDEtNjAuMzQyLDAgYy04LjA1NSw4LjA2Mi0xMi40OTIsMTguNzgtMTIuNDkyLDMwLjE3MWMwLDExLjM5LDQuNDM4LDIyLjEwOCwxMi40OTIsMzAuMTcxbDAsMGwwLDAgYzguMDYyLDguMDYyLDE4Ljc3MywxMi41LDMwLjE3MSwxMi41czIyLjEwOS00LjQzOCwzMC4xNzEtMTIuNUM4MC44OSw0OTEuNDMsODUuMzI3LDQ4MC43MTEsODUuMzI3LDQ2OS4zMjF6Ii8+CiAgPC9nPgogIDxlbGxpcHNlIHN0eWxlPSJmaWxsOiNGNkJCNDI7IiBjeD0iNDIuNjY0IiBjeT0iNDY5LjMxNiIgcng9IjEwLjY2NCIgcnk9IjEwLjY3MSIvPgogPC9nPgo8L3N2Zz4=');
        }

        .widget-button.bot-panel .icon.license-panel {
            background-image: url('data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgdmlld0JveD0iMCAwIDY0IDY0Ij48Zz48cGF0aCBmaWxsPSIjRDRFQ0Q5IiBkPSJNNDEuNzI3LDMxLjcyN2MtMC45MjMsMS44NjMtMi4wOTksMy41NzgtMy40ODcsNS4wOThMNjIsNjAuNTg2VjUyTDQxLjcyNywzMS43Mjd6Ij48L3BhdGg+PHBhdGggZmlsbD0iI0Q0RUNEOSIgZD0iTTMwLjM1LDQyLjM1TDMyLDQ0aDVjMC41NTMsMCwxLDAuNDQ3LDEsMXY1aDVjMC41NTMsMCwxLDAuNDQ3LDEsMXY1aDVjMC41NTMsMCwxLDAuNDQ3LDEsMXY1aDEwLjU4NkwzNi44MjUsMzguMjM4QzM0LjkzOCwzOS45NjMsMzIuNzQ5LDQxLjM2MSwzMC4zNSw0Mi4zNXoiPjwvcGF0aD48cGF0aCBmaWxsPSIjODA5Q0E5IiBkPSJNNjMuNDE0LDUwLjU4NmwtMjAuODMtMjAuODNDNDMuNDk3LDI3LjM0Miw0NCwyNC43MjksNDQsMjJDNDQsOS44NjksMzQuMTMxLDAsMjIsMFMwLDkuODY5LDAsMjJzOS44NjksMjIsMjIsMjJjMi4xOTUsMCw0LjMxNS0wLjMyOCw2LjMxOC0wLjkzYzAuMDc2LDAuMTIxLDAuMTYyLDAuMjM4LDAuMjY4LDAuMzQ0bDIsMkMzMC45NjEsNDUuNzg5LDMxLjQ3LDQ2LDMyLDQ2aDR2NGMwLDEuMTA0LDAuODk2LDIsMiwyaDR2NGMwLDEuMTA0LDAuODk2LDIsMiwyaDR2NGMwLDEuMTA0LDAuODk2LDIsMiwyaDEyYzEuMTA0LDAsMi0wLjg5NiwyLTJWNTJDNjQsNTEuNDY5LDYzLjc4OSw1MC45NjEsNjMuNDE0LDUwLjU4NnoiPjwvcGF0aD48cGF0aCBmaWxsPSIjOTBDQUQ4IiBkPSJNMjIsMkMxMC45NzIsMiwyLDEwLjk3MSwyLDIyYzAsMTEuMDI3LDguOTcyLDIwLDIwLDIwczIwLTguOTczLDIwLTIwQzQyLDEwLjk3MSwzMy4wMjgsMiwyMiwyeiBNMjIsMzRjLTYuNjI3LDAtMTItNS4zNzMtMTItMTJzNS4zNzMtMTIsMTItMTJzMTIsNS4zNzMsMTIsMTJTMjguNjI3LDM0LDIyLDM0eiI+PC9wYXRoPjxwYXRoIGZpbGw9IiM5MENBQ0MiIGQ9Ik0yMiwxMmMtNS41MjIsMC0xMCw0LjQ3Ny0xMCwxMGMwLDUuNTIxLDQuNDc4LDEwLDEwLDEwczEwLTQuNDc5LDEwLTEwQzMyLDE2LjQ3NywyNy41MjIsMTIsMjIsMTJ6IE0yMiwzMGMtNC40MTgsMC04LTMuNTgyLTgtOHMzLjU4Mi04LDgtOHM4LDMuNTgyLDgsOFMyNi40MTgsMzAsMjIsMzB6Ij48L3BhdGg+PC9nPjwvc3ZnPg==');
        }

        .widget-button.bot-panel .icon.e2-panel {
            background-image: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgMjAwIDIwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImdyYWQxIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzM0NDk2ODsiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzFjMmIzYzsiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGZpbHRlciBpZD0iZ2xvdyIgeD0iLTMwJSIgeT0iLTMwJSIgd2lkdGg9IjE2MCUiIGhlaWdodD0iMTYwJSI+CiAgICAgIDxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjIuNSIgcmVzdWx0PSJibHVyIiAvPgogICAgICA8ZmVDb21wb3NpdGUgaW49ImJsdXIiIG9wZXJhdG9yPSJvdmVyIiAvPgogICAgPC9maWx0ZXI+CiAgPC9kZWZzPgogIDxjaXJjbGUgY3g9IjEwMCIgY3k9IjEwMCIgcj0iOTAiIGZpbGw9InVybCgjZ3JhZDEpIiBzdHJva2Utd2lkdGg9IjYiIHN0cm9rZT0iIzQ2QTJEOSIgLz4KICAKICA8IS0tIE96ZG9ibmUgZWxlbWVudHkgLSBkZWxpa2F0bmUsIGJ5IG5pZSBwcnplc3prYWR6YcSHIC0tPgogIDxnIG9wYWNpdHk9IjAuMyI+CiAgICA8cGF0aCBkPSJNMzAsOTAgQzUwLDEwMCAxNTAsMTAwIDE3MCw5MCIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgLz4KICAgIDxwYXRoIGQ9Ik0zMCwxMTAgQzUwLDEyMCAxNTAsMTIwIDE3MCwxMTAiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIC8+CiAgPC9nPgogIAogIDwhLS0gRWZla3Qgxbth2LLEhWNlaiB0YXJjenkgLSBzcnJlYnJueSBwaWVyxZtjaWXFhCAtLT4KICA8Y2lyY2xlIGN4PSIxMDAiIGN5PSIxMDAiIHI9IjcwIiBzdHJva2U9IiM4QkM2REYiIG9wYWNpdHk9IjAuMiIgc3Ryb2tlLXdpZHRoPSIxNSIgZmlsbD0ibm9uZSIgLz4KCiAgPCEtLSBTd2llY8SFY3kgbmFwaXMgRTIgLSBwZXJmZWtjeWpuaWUgd3ljZW50cm93YW55IC0tPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTAwIiBmb250LWZhbWlseT0iQXJpYWwgQmxhY2ssIEltcGFjdCwgSGVsdmV0aWNhLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjkwIiBmb250LXdlaWdodD0iOTAwIiBmaWx0ZXI9InVybCgjZ2xvdykiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHN0cm9rZT0iIzQ2QTJEOSIgc3Ryb2tlLXdpZHRoPSIzIiBmaWxsPSIjRkZGRkZGIj5FMjwvdGV4dD4KICAKICA8IS0tIE96ZG9ibnkgYm9yZGVyIGRvb2tvxYJhIC0tPgogIDxjaXJjbGUgY3g9IjEwMCIgY3k9IjEwMCIgcj0iODUiIHN0cm9rZT0iIzQ2QTJEOSIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIiBvcGFjaXR5PSIwLjQiIC8+CiAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iMTAwIiByPSI4MCIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjEiIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjAuMiIgc3Ryb2tlLWRhc2hhcnJheT0iMTAgNSIgLz4KPC9zdmc+');
        }

        .widget-button.bot-panel .amount {
            position: absolute;
            bottom: 0;
            right: 0;
            font-size: 10px;
            color: #fff;
            background: rgba(0,0,0,0.5);
            padding: 1px 3px;
            border-radius: 2px;
            min-width: 12px;
            text-align: center;
            display: none;
        }

        .minimize-button {
            background: none;
            border: none;
            color: #e8d5b5;
            font-size: 1.2rem;
            padding: 0;
            cursor: pointer;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }

        .minimize-button:hover {
            background: rgba(89, 70, 50, 0.3);
        }
    `;
  document.head.appendChild(style);
  class DraggablePanel {
    constructor(title, content, initialPosition = {
      x: 0,
      y: 0
    }, config = {}) {
      this.title = title;
      this.content = content;
      this.position = initialPosition;
      this.config = {
        isResizable: false,
        initialSize: {
          width: 200,
          height: 400
        },
        minSize: {
          width: 200,
          height: 100
        },
        ...config
      };
      this.isDragging = false;
      this.isResizing = false;
      this.isMinimized = true;
      this.dragOffset = {
        x: 0,
        y: 0
      };
      this.resizeType = null;
      this.initialSize = {
        ...this.config.initialSize
      };
      this.initialMousePos = {
        x: 0,
        y: 0
      };
      this.createElement();
      this.createInterfaceButton();
      this.setupEventListeners();
      this.element.style.display = "none";
    }
    checkAndRestoreInterfaceButton() {
      if (!this.interfaceButton || !document.body.contains(this.interfaceButton)) {
        this.createInterfaceButton();
        if (!this.isMinimized && this.interfaceButton) {
          this.interfaceButton.classList.add("active");
        }
      }
    }
    createInterfaceButton() {
      let container = document.querySelector(".top-right.main-buttons-container");
      if (!container) {
        return;
      }
      const existingButton = Array.from(container.children).find(child => child.getAttribute("tip-id") === this.title);
      if (existingButton) {
        this.interfaceButton = existingButton;
        return;
      }
      const existingButtons = container.querySelectorAll(".widget-button");
      const buttonCount = existingButtons.length;
      const rightPosition = buttonCount * 44;
      const interfaceBtn = document.createElement("div");
      interfaceBtn.className = "widget-button green widget-in-interface-bar bot-panel";
      interfaceBtn.style.right = rightPosition + "px";
      interfaceBtn.setAttribute("widget-pos", "top-right");
      const iconDiv = document.createElement("div");
      iconDiv.className = "icon";
      switch (this.title.toLowerCase()) {
        case "control panel":
          iconDiv.classList.add("control-panel");
          break;
        case "available gateways":
          iconDiv.classList.add("gateways");
          break;
        case "navigation":
          iconDiv.classList.add("navigation");
          break;
        case "expowiska":
          iconDiv.classList.add("expowiska");
          break;
        case "auto heal":
          iconDiv.classList.add("healing");
          break;
        case "license panel":
          iconDiv.classList.add("license-panel");
          break;
        case "panele2":
          iconDiv.classList.add("e2-panel");
          break;
        default:
          iconDiv.classList.add("default-icon");
      }
      interfaceBtn.appendChild(iconDiv);
      const amountDiv = document.createElement("div");
      amountDiv.className = "amount";
      interfaceBtn.appendChild(amountDiv);
      const tooltipText = this.title;
      interfaceBtn.setAttribute("tip-id", tooltipText);
      interfaceBtn.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleMinimize();
      };
      this.interfaceButton = interfaceBtn;
      container.appendChild(interfaceBtn);
    }
    toggleMinimize() {
      if (this.isMinimized) {
        this.restore();
      } else {
        this.minimize();
      }
    }
    createElement() {
      this.element = document.createElement("div");
      this.element.className = "bot-ui-card";
      this.element.style.left = `${this.position.x}px`;
      this.element.style.top = `${this.position.y}px`;
      if (this.config.isResizable) {
        this.element.style.width = `${this.config.initialSize.width}px`;
        this.element.style.height = `${this.config.initialSize.height}px`;
      }
      const header = document.createElement("div");
      header.className = "bot-ui-card-header";
      const titleSpan = document.createElement("span");
      titleSpan.textContent = this.title;
      header.appendChild(titleSpan);
      const minimizeBtn = document.createElement("button");
      minimizeBtn.innerHTML = "&#x2212;";
      minimizeBtn.className = "minimize-button";
      minimizeBtn.onclick = () => this.minimize();
      header.appendChild(minimizeBtn);
      const contentDiv = document.createElement("div");
      contentDiv.className = "bot-ui-card-content";
      if (this.content instanceof HTMLElement) {
        contentDiv.appendChild(this.content);
      } else {
        contentDiv.innerHTML = this.content;
      }
      if (this.config.isResizable) {
        const rightHandle = document.createElement("div");
        rightHandle.className = "resize-handle right";
        rightHandle.dataset.resize = "right";
        const bottomHandle = document.createElement("div");
        bottomHandle.className = "resize-handle bottom";
        bottomHandle.dataset.resize = "bottom";
        const cornerHandle = document.createElement("div");
        cornerHandle.className = "resize-handle corner";
        cornerHandle.dataset.resize = "corner";
        this.element.appendChild(rightHandle);
        this.element.appendChild(bottomHandle);
        this.element.appendChild(cornerHandle);
      }
      this.element.appendChild(header);
      this.element.appendChild(contentDiv);
      document.body.appendChild(this.element);
    }
    setupEventListeners() {
      const header = this.element.querySelector(".bot-ui-card-header");
      header.addEventListener("mousedown", e => {
        if (e.target.classList.contains("minimize-button")) {
          return;
        }
        this.isDragging = true;
        header.classList.add("dragging");
        const rect = this.element.getBoundingClientRect();
        this.dragOffset = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
      });
      if (this.config.isResizable) {
        const handles = this.element.querySelectorAll(".resize-handle");
        handles.forEach(handle => {
          handle.addEventListener("mousedown", e => {
            e.stopPropagation();
            this.isResizing = true;
            this.resizeType = handle.dataset.resize;
            const rect = this.element.getBoundingClientRect();
            this.initialSize = {
              width: rect.width,
              height: rect.height
            };
            this.initialMousePos = {
              x: e.clientX,
              y: e.clientY
            };
          });
        });
      }
      document.addEventListener("mousemove", e => {
        if (this.isDragging) {
          const newX = e.clientX - this.dragOffset.x;
          const newY = e.clientY - this.dragOffset.y;
          const maxX = window.innerWidth - this.element.offsetWidth;
          const maxY = window.innerHeight - this.element.offsetHeight;
          this.position = {
            x: Math.max(0, Math.min(newX, maxX)),
            y: Math.max(0, Math.min(newY, maxY))
          };
          this.element.style.left = `${this.position.x}px`;
          this.element.style.top = `${this.position.y}px`;
        }
        if (this.isResizing) {
          const dx = e.clientX - this.initialMousePos.x;
          const dy = e.clientY - this.initialMousePos.y;
          let newWidth = this.initialSize.width;
          let newHeight = this.initialSize.height;
          switch (this.resizeType) {
            case "right":
              newWidth += dx;
              break;
            case "bottom":
              newHeight += dy;
              break;
            case "corner":
              newWidth += dx;
              newHeight += dy;
              break;
          }
          newWidth = Math.max(this.config.minSize.width, newWidth);
          newHeight = Math.max(this.config.minSize.height, newHeight);

          // Clamp to configured max size (if provided) and to viewport.
          try {
            const rect = this.element.getBoundingClientRect();
            const viewportMaxW = Math.max(this.config.minSize.width, window.innerWidth - rect.left - 8);
            const viewportMaxH = Math.max(this.config.minSize.height, window.innerHeight - rect.top - 8);
            const configMaxW = this.config.maxSize && Number.isFinite(this.config.maxSize.width) ? this.config.maxSize.width : Infinity;
            const configMaxH = this.config.maxSize && Number.isFinite(this.config.maxSize.height) ? this.config.maxSize.height : Infinity;
            newWidth = Math.min(newWidth, viewportMaxW, configMaxW);
            newHeight = Math.min(newHeight, viewportMaxH, configMaxH);
          } catch (e2) {}

          this.element.style.width = `${newWidth}px`;
          this.element.style.height = `${newHeight}px`;
          this.element.dispatchEvent(new CustomEvent("panelresize", {
            detail: {
              width: newWidth,
              height: newHeight
            }
          }));
        }
      });
      document.addEventListener("mouseup", () => {
        if (this.isDragging) {
          this.isDragging = false;
          header.classList.remove("dragging");
        }
        if (this.isResizing) {
          this.isResizing = false;
          this.resizeType = null;
        }
      });
      const content = this.element.querySelector(".bot-ui-card-content");
      content.addEventListener("wheel", e => {
        if (e.target.closest("#mobCheckboxes")) {
          return;
        }
        e.preventDefault();
        content.scrollTop += e.deltaY;
      }, {
        passive: false
      });
      this.element.addEventListener("selectstart", e => {
        if (this.isDragging || this.isResizing) {
          e.preventDefault();
        }
      });
    }
    minimize() {
      this.isMinimized = true;
      this.element.style.display = "none";
      this.interfaceButton.classList.remove("active");
    }
    restore() {
      this.isMinimized = false;
      this.element.style.display = "flex";
      this.interfaceButton.classList.add("active");
    }
    updateContent(newContent) {
      const contentDiv = this.element.querySelector(".bot-ui-card-content");
      if (newContent instanceof HTMLElement) {
        contentDiv.innerHTML = "";
        contentDiv.appendChild(newContent);
      } else {
        contentDiv.innerHTML = newContent;
      }
    }
  }
  function openMapsWindow(expowiskoKey) {
    if (!expowiskoKey) {
      return;
    }
    if (mapsPanel) {
      mapsPanel.minimize();
      mapsPanel.updateContent("");
      mapsPanel = null;
    }
    let mapsArray = Expowiska[expowiskoKey] ? Expowiska[expowiskoKey].slice() : [];
    selectedMaps = mapsArray.map(mapObj => Object.keys(mapObj)[0]);
    function saveMapsOrder() {
      try {
        localStorage.setItem("mapsOrder_" + expowiskoKey, JSON.stringify(selectedMaps));
      } catch (e) {}
    }
    function loadMapsOrder() {
      try {
        const saved = localStorage.getItem("mapsOrder_" + expowiskoKey);
        if (saved) {
          const order = JSON.parse(saved);
          mapsArray = order.map(name => ({
            [name]: null
          }));
          selectedMaps = order.slice();
          updateMapsContent();
        } else {}
      } catch (e) {}
    }
    const mapsContentContainer = document.createElement("div");
    mapsContentContainer.style.display = "flex";
    mapsContentContainer.style.flexDirection = "column";
    mapsContentContainer.style.height = "100%";
    const mapsListContainer = document.createElement("div");
    mapsListContainer.style.flex = "1";
    mapsListContainer.style.display = "flex";
    mapsListContainer.style.flexDirection = "column";
    mapsListContainer.style.background = "#1f2937";
    mapsListContainer.style.borderRadius = "0.375rem";
    mapsListContainer.style.overflow = "hidden";
    mapsListContainer.style.minHeight = "0";
    mapsListContainer.style.height = "100%";
    const mapsList = document.createElement("div");
    mapsList.id = "mapsList";
    mapsList.style.flex = "1";
    mapsList.style.overflowY = "auto";
    mapsList.style.padding = "0.5rem";
    mapsList.style.boxSizing = "border-box";
    mapsList.style.height = "100%";
    mapsList.addEventListener("wheel", e => {
      e.stopPropagation();
    });
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.marginTop = "0.5rem";
    buttonsContainer.style.display = "flex";
    buttonsContainer.style.justifyContent = "space-between";
    buttonsContainer.style.gap = "0.5rem";
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Zapisz kolejność";
    saveBtn.className = "bot-ui-button";
    saveBtn.style.flex = "1";
    saveBtn.addEventListener("click", () => {
      saveMapsOrder();
    });
    buttonsContainer.appendChild(saveBtn);
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Załaduj zapisane";
    loadBtn.className = "bot-ui-button";
    loadBtn.style.flex = "1";
    loadBtn.style.display = "none";
    loadBtn.addEventListener("click", () => {
      loadMapsOrder();
    });
    buttonsContainer.appendChild(loadBtn);
    function renderMapsItems() {
      const fragment = document.createDocumentFragment();
      let draggedItemIndex = null;
      mapsArray.forEach((mapObj, index) => {
        const mapName = Object.keys(mapObj)[0];
        const item = document.createElement("div");
        item.className = "bot-ui-mob-item";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.padding = "0.5rem";
        item.style.border = "1px solid #374151";
        item.style.borderRadius = "0.375rem";
        item.style.marginBottom = "0.5rem";
        item.dataset.index = index;
        item.draggable = true;
        const nameP = document.createElement("p");
        nameP.textContent = mapName;
        nameP.style.margin = "0";
        nameP.style.flexGrow = "1";
        item.appendChild(nameP);
        item.addEventListener("dragstart", e => {
          draggedItemIndex = index;
          e.dataTransfer.effectAllowed = "move";
        });
        item.addEventListener("dragover", e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        });
        item.addEventListener("drop", e => {
          e.preventDefault();
          const targetIndex = parseInt(item.dataset.index, 10);
          if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
            const movedItem = mapsArray.splice(draggedItemIndex, 1)[0];
            mapsArray.splice(targetIndex, 0, movedItem);
            selectedMaps = mapsArray.map(obj => Object.keys(obj)[0]);
            updateMapsContent();
          }
        });
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Kopiuj";
        copyBtn.style.background = "#60a5fa";
        copyBtn.style.border = "none";
        copyBtn.style.padding = "0.25rem 0.5rem";
        copyBtn.style.borderRadius = "0.25rem";
        copyBtn.style.cursor = "pointer";
        copyBtn.style.marginRight = "0.5rem";
        copyBtn.addEventListener("click", e => {
          e.stopPropagation();
          mapsArray.splice(index + 1, 0, {
            [mapName]: null
          });
          selectedMaps = mapsArray.map(obj => Object.keys(obj)[0]);
          updateMapsContent();
        });
        item.appendChild(copyBtn);
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Usuń";
        deleteBtn.style.background = "#f87171";
        deleteBtn.style.border = "none";
        deleteBtn.style.padding = "0.25rem 0.5rem";
        deleteBtn.style.borderRadius = "0.25rem";
        deleteBtn.style.cursor = "pointer";
        deleteBtn.addEventListener("click", e => {
          e.stopPropagation();
          mapsArray.splice(index, 1);
          selectedMaps = mapsArray.map(obj => Object.keys(obj)[0]);
          updateMapsContent();
        });
        item.appendChild(deleteBtn);
        fragment.appendChild(item);
      });
      return fragment;
    }
    function updateMapsContent() {
      mapsList.innerHTML = "";
      mapsList.appendChild(renderMapsItems());
      selectedMaps = mapsArray.map(obj => Object.keys(obj)[0]);
      window.selectedMaps = selectedMaps;
      if (localStorage.getItem("mapsOrder_" + expowiskoKey)) {
        loadBtn.style.display = "block";
      } else {
        loadBtn.style.display = "none";
      }
    }
    updateMapsContent();
    mapsListContainer.appendChild(mapsList);
    mapsContentContainer.appendChild(mapsListContainer);
    mapsContentContainer.appendChild(buttonsContainer);
    mapsPanel = new DraggablePanel("Lista Map", mapsContentContainer, {
      x: 200,
      y: 10
    }, {
      isResizable: true,
      initialSize: {
        width: 300,
        height: Math.min(mapsArray.length * 50 + 40, 350)
      },
      minSize: {
        width: 250,
        height: 150
      }
    });
    mapsPanel.restore();
    if (mapsPanel.interfaceButton && mapsPanel.interfaceButton.parentNode) {
      mapsPanel.interfaceButton.parentNode.removeChild(mapsPanel.interfaceButton);
    }
  }
  function createExpowiskaPanel() {
    const content = document.createElement("div");
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.height = "100%";
    content.style.gap = "1rem";
    // Keep the panel content flush with the card; spacing is handled inside the inner card.
    content.style.padding = "0";
    content.style.boxSizing = "border-box";
    const expingState = {
      active: false,
      minLevel: null,
      maxLevel: null,
      selectedExpowisko: null,
      allLevels: true,
      sellItems: false,
      teleportIfOnMap: false
    };
    // NOTE(UI): "Bij wszystko" toggle is temporarily hidden (no clear UX/use-case right now).
    // The logic is kept for potential future re-enable.
    content.innerHTML = `
      <div style="
        background: #1f2937;
        padding: 1rem;
        border-radius: 0.75rem;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      ">
            <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
          <label style="
            display: none;
            align-items: center;
            gap: 0.5rem;
            color: #cbd5e1;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
          ">
                    <input
                        type="checkbox"
                        id="allLevelsCheckbox"
                        class="bot-ui-checkbox"
                    />
            <span>Bij wszystko</span>
                </label>

          <div style="display: flex; gap: 0.75rem;">
            <div style="flex: 1; min-width: 0;">
                        <label style="
                            display: block;
                      color: #cbd5e1;
                            font-size: 0.875rem;
                            margin-bottom: 0.25rem;
                            font-weight: 500;
                        ">
                            Min Poziom
                        </label>
                        <input
                            type="number"
                            id="minLevelInput"
                            class="bot-ui-input"
                            min="1"
                            max="1000"
                            value="1"
                            placeholder="Min"
                            style="
                                width: 100%;
                                border: 1px solid #374151;
                                transition: all 0.2s ease;
                                padding: 0.5rem;
                                box-sizing: border-box;
                            "
                        >
                    </div>
                        <div style="flex: 1; min-width: 0;">
                        <label style="
                            display: block;
                        color: #cbd5e1;
                            font-size: 0.875rem;
                            margin-bottom: 0.25rem;
                            font-weight: 500;
                        ">
                            Max Poziom
                        </label>
                        <input
                            type="number"
                            id="maxLevelInput"
                            class="bot-ui-input"
                            min="1"
                            max="1000"
                            value="1000"
                            placeholder="Max"
                            style="
                                width: 100%;
                                border: 1px solid #374151;
                                transition: all 0.2s ease;
                                padding: 0.5rem;
                                box-sizing: border-box;
                            "
                        >
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 1rem;">
                <label style="
                  display: block;
                  color: #cbd5e1;
                    font-size: 0.875rem;
                    margin-bottom: 0.5rem;
                    font-weight: 500;
                ">Wybierz expowisko</label>
                <div style="position: relative;">
                    <select
                        id="expowiskoSelect"
                        class="bot-ui-input"
                        style="
                            width: 100%;
                            appearance: none;
                            border: 1px solid #374151;
                            padding: 0.5rem 2rem 0.5rem 0.5rem;
                            transition: all 0.2s ease;
                            box-sizing: border-box;
                            color: #e5e7eb;
                            background-color: #1f2937;
                        "
                    >
                        <option value="">Wybierz ekspowisko</option>
                        ${Object.keys(Expowiska).map(key => `<option value="${key}">${key}</option>`).join("")}
                    </select>
                </div>
                <div id="mapWarning" style="font-size: 0.75rem; color: #f87171; margin-top: 0.5rem;"></div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
                <label style="
                  display: flex;
                  align-items: center;
                  gap: 0.5rem;
                  color: #cbd5e1;
                    font-size: 0.875rem;
                    cursor: pointer;
                ">
                    <input
                        type="checkbox"
                        id="sellItemsCheckbox"
                        class="bot-ui-checkbox"
                    />
                    <span>Sprzedawaj itemy</span>
                </label>
                <label style="
                  display: flex;
                  align-items: center;
                  gap: 0.5rem;
                  color: #cbd5e1;
                    font-size: 0.875rem;
                    cursor: pointer;
                ">
                    <input
                        type="checkbox"
                        id="teleportIfOnMapCheckbox"
                        class="bot-ui-checkbox"
                    />
                    <span>Teleportuj przy innych graczach</span>
                </label>
            </div>

            <div style="margin-bottom: 1rem;">
                <label style="
                  display: block;
                  color: #cbd5e1;
                    font-size: 0.875rem;
                    margin-bottom: 0.5rem;
                    font-weight: 500;
                ">Ile kupić leków?</label>
                <div style="position: relative;">
                    <input
                        type="number"
                        id="healPotionsInput"
                        class="bot-ui-input"
                        style="
                            width: 100%;
                            border: 1px solid #374151;
                            padding: 0.5rem 0.5rem;
                            transition: all 0.2s ease;
                            box-sizing: border-box;
                            color: #e5e7eb;
                            background-color: #1f2937;
                        "
                        placeholder="e.g. 10"
                    />
                </div>
                <!-- TEST POTEK - ZAKOMENTOWANE
                <button
                    id="testPotionsBtn"
                    class="bot-ui-button"
                    style="
                        width: 100%;
                        padding: 0.5rem;
                        border-radius: 0.5rem;
                        margin-top: 0.5rem;
                        background: #4f46e5;
                        color: white;
                        font-weight: 600;
                        cursor: pointer;
                        border: none;
                    "
                >
                    🧪 Testuj kupowanie potek
                </button>
                <div id="testPotionsStatus" style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem;">
                    Kliknij aby przetestować kupowanie potek u healera.
                </div>
                -->
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                <button
                    id="expoBtn"
                    class="bot-ui-button green"
                    style="
                        width: 100%;
                        padding: 0.75rem;
                        border-radius: 0.5rem;
                        transition: all 0.2s ease;
                        font-weight: 600;
                    "
                >
                    Start
                </button>

                <div
                    id="expoStatus"
                    style="
                        text-align: center;
                        color: #9ca3af;
                        font-size: 0.875rem;
                        background: #111827;
                        padding: 0.5rem;
                        border-radius: 0.5rem;
                    "
                >
                    Gotowy do rozpoczęcia expingu
                </div>
            </div>
        </div>
    `;
    const minLevelInput = content.querySelector("#minLevelInput");
    const maxLevelInput = content.querySelector("#maxLevelInput");
    const expowiskoSelect = content.querySelector("#expowiskoSelect");
    const expoBtn = content.querySelector("#expoBtn");
    const expoStatus = content.querySelector("#expoStatus");
    const mapWarningElem = content.querySelector("#mapWarning");
    const allLevelsCheckbox = content.querySelector("#allLevelsCheckbox");
    const sellItemsCheckbox = content.querySelector("#sellItemsCheckbox");
    const teleportIfOnMapCheckbox = content.querySelector("#teleportIfOnMapCheckbox");
    const healPotionsInput = content.querySelector("#healPotionsInput");
    // TEST POTEK - ZAKOMENTOWANE
    // const testPotionsBtn = content.querySelector("#testPotionsBtn");
    // const testPotionsStatus = content.querySelector("#testPotionsStatus");
    function handleAllLevelsToggle() {
      if (allLevelsCheckbox.checked) {
        minLevelInput.value = "1";
        maxLevelInput.value = "1000";
        minLevelInput.disabled = true;
        maxLevelInput.disabled = true;
      } else {
        minLevelInput.disabled = false;
        maxLevelInput.disabled = false;
      }
    }
    allLevelsCheckbox.addEventListener("change", handleAllLevelsToggle);
    handleAllLevelsToggle();

    function parseExpowiskoLevel(expName) {
      if (!expName || typeof expName !== "string") return null;
      const m = expName.match(/(\d+)(?!.*\d)/);
      if (!m) return null;
      const lvl = parseInt(m[1], 10);
      return Number.isFinite(lvl) ? lvl : null;
    }
    function updateLevelDependentOptions() {
      const requiredLevel = 70;
      const heroLevel = window.Engine && window.Engine.hero && window.Engine.hero.d && window.Engine.hero.d.lvl || 0;
      const msg = `Należy mieć co najmniej ${requiredLevel} lvl aby je aktywować`;
      if (heroLevel < requiredLevel) {
        sellItemsCheckbox.disabled = true;
        teleportIfOnMapCheckbox.disabled = false;
        healPotionsInput.disabled = false;
        // TEST POTEK - ZAKOMENTOWANE
        // testPotionsBtn.disabled = false;
        sellItemsCheckbox.title = msg;
        teleportIfOnMapCheckbox.title = "";
        healPotionsInput.title = "";
        // testPotionsBtn.title = "";
      } else {
        sellItemsCheckbox.disabled = false;
        teleportIfOnMapCheckbox.disabled = false;
        healPotionsInput.disabled = false;
        // TEST POTEK - ZAKOMENTOWANE
        // testPotionsBtn.disabled = false;
        sellItemsCheckbox.title = "";
        teleportIfOnMapCheckbox.title = "";
        healPotionsInput.title = "";
        // testPotionsBtn.title = "";
      }
    }
    updateLevelDependentOptions();
    let expowiskoMapCheckInterval = null;
    function startMapCheck(selectedExp) {
      if (expowiskoMapCheckInterval) {
        clearInterval(expowiskoMapCheckInterval);
        expowiskoMapCheckInterval = null;
      }
      const heroLevel = window.Engine && window.Engine.hero && window.Engine.hero.d && window.Engine.hero.d.lvl || 0;
      let validMaps = [];
      if (heroLevel < 70) {
        validMaps = (Expowiska[selectedExp] || []).map(mapObj => Object.keys(mapObj)[0]);
      } else {
        validMaps = ["Kwieciste Przejście"];
      }
      expowiskoMapCheckInterval = setInterval(() => {
        const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
        if (validMaps.indexOf(currentMap) === -1) {
          if (heroLevel < 70) {
            mapWarningElem.textContent = "Dojdź do jednej z map ekspowiska";
          } else {
            mapWarningElem.textContent = "Zalecana lokacja startowa - Kwieciste Przejście";
          }
        } else {
          mapWarningElem.textContent = "";
        }
      }, 1000);
    }
    expowiskoSelect.addEventListener("change", () => {
      const selectedExp = expowiskoSelect.value;
      expingState.selectedExpowisko = selectedExp;
      mapWarningElem.textContent = "";

      // Auto-set min/max level around expowisko level (lvl ± 5) when the name contains a level.
      // Example: "Piaskowi niewolnicy 133" -> min=128, max=138
      const lvl = parseExpowiskoLevel(selectedExp);
      if (Number.isFinite(lvl)) {
        allLevelsCheckbox.checked = false;
        const min = Math.max(1, lvl - 5);
        const max = lvl + 5;
        minLevelInput.value = String(min);
        maxLevelInput.value = String(max);
        minLevelInput.disabled = false;
        maxLevelInput.disabled = false;
      }

      if (expowiskoMapCheckInterval) {
        clearInterval(expowiskoMapCheckInterval);
        expowiskoMapCheckInterval = null;
      }
      if (selectedExp) {
        openMapsWindow(selectedExp);
        startMapCheck(selectedExp);
      } else if (mapsPanel) {
        mapsPanel.minimize();
        mapsPanel = null;
      }
    });
    function start_exping() {
      let minLevel = parseInt(minLevelInput.value) || 1;
      let maxLevel = parseInt(maxLevelInput.value) || 1000;
      if (allLevelsCheckbox.checked) {
        minLevel = 1;
        maxLevel = 1000;
      }
      const selectedExpowisko = expowiskoSelect.value;
      const sellItems = sellItemsCheckbox.checked;
      const teleportIfOnMap = teleportIfOnMapCheckbox.checked;
      const healPotions = parseInt(healPotionsInput.value) || 0;
      const heroLevel = window.Engine && window.Engine.hero && window.Engine.hero.d && window.Engine.hero.d.lvl || 0;
      if (selectedExpowisko) {
        const currentMap = window.MargonemAPI.navigation.getCurrentLocation();
        if (heroLevel < 70) {
          const validMaps = (Expowiska[selectedExpowisko] || []).map(mapObj => Object.keys(mapObj)[0]);
          if (validMaps.indexOf(currentMap) === -1) {
            mapWarningElem.textContent = "Dojdź do jednej z map ekspowiska";
          }
        } else if (currentMap !== "Kwieciste Przejście") {
          mapWarningElem.textContent = "Zalecana lokacja startowa - Kwieciste Przejście";
        }
      }
      expingState.active = true;
      expingState.minLevel = minLevel;
      expingState.maxLevel = maxLevel;
      expoBtn.textContent = "Stop";
      expoBtn.classList.remove("green");
      expoBtn.classList.add("red");
      expoStatus.textContent = `Exping: ${selectedExpowisko}`;
      if (mapsPanel) {
        mapsPanel.minimize();
        mapsPanel = null;
      }
      window.MargonemAPI.state.exping_location = window.MargonemAPI.state.exping_location || {};
      window.MargonemAPI.exping.startExping(minLevel, maxLevel, selectedExpowisko, sellItems, teleportIfOnMap, healPotions, selectedMaps);
    }
    function stop_exping() {
      expingState.active = false;
      expingState.minLevel = null;
      expingState.maxLevel = null;
      expoBtn.textContent = "Start";
      expoBtn.classList.remove("red");
      expoBtn.classList.add("green");
      expoStatus.textContent = "Exping zatrzymany";
      window.MargonemAPI.exping.stopExping();
      window.MargonemAPI.state.exping_location.is_aborted = true;
    }
    expoBtn.addEventListener("click", () => {
      if (!expingState.active) {
        start_exping();
      } else {
        stop_exping();
      }
    });

    // TEST POTEK - ZAKOMENTOWANE
    /*
    testPotionsBtn.addEventListener("click", async () => {
      const targetClicks = parseInt(healPotionsInput.value) || 15;
      
      testPotionsStatus.textContent = "🔄 Uruchamiam test... (sprawdź konsolę F12)";
      testPotionsStatus.style.color = "#fbbf24";
      testPotionsBtn.disabled = true;

      console.log("=================================================");
      console.log("[TEST POTEK] Przycisk kliknięty");
      console.log("[TEST POTEK] Kliknięć do wykonania:", targetClicks);
      console.log("[TEST POTEK] Kupi potek:", targetClicks * 5);
      console.log("=================================================");

      try {
        if (typeof window.MargonemAPI?.testBuyPotionsAtHealer === 'function') {
          const result = await window.MargonemAPI.testBuyPotionsAtHealer(targetClicks);
          if (result) {
            testPotionsStatus.textContent = "✅ Test zakończony pomyślnie!";
            testPotionsStatus.style.color = "#4ade80";
          } else {
            testPotionsStatus.textContent = "❌ Test nieudany - sprawdź konsolę F12";
            testPotionsStatus.style.color = "#f87171";
          }
        } else {
          console.error("[TEST POTEK] Funkcja testBuyPotionsAtHealer nie istnieje!");
          testPotionsStatus.textContent = "❌ Funkcja nie znaleziona";
          testPotionsStatus.style.color = "#f87171";
        }
      } catch (err) {
        console.error("[TEST POTEK] Błąd:", err);
        testPotionsStatus.textContent = "❌ Błąd: " + (err.message || err);
        testPotionsStatus.style.color = "#f87171";
      } finally {
        testPotionsBtn.disabled = false;
      }
    });
    */

    return new DraggablePanel("Expowiska", content, {
      x: 200,
      y: 60
    }, {
      isResizable: true,
      initialSize: {
        width: 300,
        height: 520
      },
      minSize: {
        width: 250,
        height: 350
      },
      maxSize: {
        width: 420,
        height: 720
      }
    });
  }
  function createControlPanel() {
    const content = document.createElement("div");
    const state = window.MargonemAPI.state;
    state.levelRange = {
      min: null,
      max: null
    };
    content.style.height = "100%";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.innerHTML = `
            <div class="timer-controls" style="margin-bottom: 1rem;">
                <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                    <input type="number" class="bot-ui-input" id="hours" min="0" placeholder="Hours">
                    <input type="number" class="bot-ui-input" id="minutes" min="0" max="59" placeholder="Minutes">
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button id="startBtn" class="bot-ui-button green">Start</button>
                    <button id="stopBtn" class="bot-ui-button red disabled" disabled>Stop</button>
                </div>
            </div>

            <div style="margin-bottom: 1rem; background: #1f2937; padding: 0.5rem; border-radius: 0.375rem;">
                <div style="margin-bottom: 0.5rem; font-weight: bold;">Level Range:</div>
                <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                    <input type="number" class="bot-ui-input" id="minLevel" min="1" max="300" placeholder="Min Lvl">
                    <input type="number" class="bot-ui-input" id="maxLevel" min="1" max="300" placeholder="Max Lvl">
                </div>
            </div>

            <div class="mob-selection" style="flex: 1; display: flex; flex-direction: column;">
                <div style="margin-bottom: 0.5rem; font-weight: bold;">Or Select Specific Mobs:</div>
                <div id="mobCheckboxes" style="flex: 1; overflow-y: auto; background: #1f2937; padding: 0.5rem; border-radius: 0.375rem;">
                </div>
            </div>

            <div class="status-display" style="margin-top: 1rem; padding: 0.5rem; background: #1f2937; border-radius: 0.375rem;">
                <div id="timerDisplay" style="font-size: 0.875rem; color: #9ca3af;"></div>
                <div id="statusMessage" style="font-size: 0.875rem; color: #9ca3af;"></div>
                <div id="levelRangeDisplay" style="font-size: 0.875rem; color: #9ca3af;"></div>
            </div>
        `;
    const checkboxesContainer = content.querySelector("#mobCheckboxes");
    const startBtn = content.querySelector("#startBtn");
    const stopBtn = content.querySelector("#stopBtn");
    const timerDisplay = content.querySelector("#timerDisplay");
    const statusMessage = content.querySelector("#statusMessage");
    const levelRangeDisplay = content.querySelector("#levelRangeDisplay");
    const hoursInput = content.querySelector("#hours");
    const minutesInput = content.querySelector("#minutes");
    const minLevelInput = content.querySelector("#minLevel");
    const maxLevelInput = content.querySelector("#maxLevel");
    minLevelInput.addEventListener("input", e => {
      state.levelRange.min = parseInt(e.target.value) || null;
      if (state.levelRange.min && state.levelRange.max && state.levelRange.min > state.levelRange.max) {
        maxLevelInput.value = e.target.value;
        state.levelRange.max = state.levelRange.min;
      }
      updateStatusMessage();
      if (state.levelRange.min || state.levelRange.max) {
        checkboxesContainer.querySelectorAll("input[type=checkbox]").forEach(cb => {
          cb.checked = false;
        });
        state.selectedNicks = [];
      }
    });
    maxLevelInput.addEventListener("input", e => {
      state.levelRange.max = parseInt(e.target.value) || null;
      if (state.levelRange.min && state.levelRange.max && state.levelRange.max < state.levelRange.min) {
        minLevelInput.value = e.target.value;
        state.levelRange.min = state.levelRange.max;
      }
      updateStatusMessage();
      if (state.levelRange.min || state.levelRange.max) {
        checkboxesContainer.querySelectorAll("input[type=checkbox]").forEach(cb => {
          cb.checked = false;
        });
        state.selectedNicks = [];
      }
    });
    function formatTimeRemaining(ms) {
      if (!ms) {
        return "";
      }
      const seconds = Math.floor(ms / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor(seconds % 3600 / 60);
      const remainingSeconds = seconds % 60;
      return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
    }
    function updateCheckboxes() {
      const engine = window.Engine;
      const currentMap = engine?.map?.d?.name || engine?.map?.name;
      const mobs = window.MargonemAPI.getAllMobs();
      const currentCheckboxes = checkboxesContainer.querySelectorAll("input[type=checkbox]");
      if (currentCheckboxes.length === 0 && mobs.length > 0 || currentMap !== state.lastMapName) {
        const uniqueNicks = [...new Set(mobs.map(m => m.nick))].sort();
        checkboxesContainer.innerHTML = uniqueNicks.map(nick => `
                    <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                        <input type="checkbox" class="bot-ui-checkbox" data-mob="${nick}"
                            ${state.selectedNicks.includes(nick) ? "checked" : ""}>
                        <span style="margin-left: 0.5rem;">${nick}</span>
                    </label>
                `).join("");
        checkboxesContainer.querySelectorAll("input[type=checkbox]").forEach(checkbox => {
          checkbox.addEventListener("change", e => {
            const mobName = e.target.dataset.mob;
            if (e.target.checked) {
              state.levelRange.min = null;
              state.levelRange.max = null;
              minLevelInput.value = "";
              maxLevelInput.value = "";
              if (!state.selectedNicks.includes(mobName)) {
                state.selectedNicks.push(mobName);
              }
            } else {
              state.selectedNicks = state.selectedNicks.filter(name => name !== mobName);
            }
            updateStatusMessage();
          });
        });
      }
    }
    function updateButtons() {
      if (state.autoFightActive) {
        startBtn.classList.add("disabled");
        startBtn.disabled = true;
        stopBtn.classList.remove("disabled");
        stopBtn.disabled = false;
      } else {
        startBtn.classList.remove("disabled");
        startBtn.disabled = false;
        stopBtn.classList.add("disabled");
        stopBtn.disabled = true;
      }
    }
    function updateTimerDisplay() {
      if (state.fightEndTime) {
        const remaining = state.fightEndTime - Date.now();
        if (remaining > 0) {
          timerDisplay.textContent = `Time remaining: ${formatTimeRemaining(remaining)}`;
        } else {
          timerDisplay.textContent = "Timer finished";
        }
      } else {
        timerDisplay.textContent = state.autoFightActive ? "Running indefinitely" : "Timer not set";
      }
    }
    function updateStatusMessage() {
      const selectedCount = state.selectedNicks.length;
      const blockedCount = state.blockedMobs.size;
      const hasLevelRange = state.levelRange.min !== null || state.levelRange.max !== null;
      let message = "";
      if (hasLevelRange) {
        message = `Level range: ${state.levelRange.min || "1"}-${state.levelRange.max || "300"}`;
      } else {
        message = `Selected mobs: ${selectedCount}`;
      }
      if (blockedCount > 0) {
        message += ` | Blocked: ${blockedCount}`;
      }
      statusMessage.textContent = message;
    }
    startBtn.addEventListener("click", () => {
      if (!state.autoFightActive) {
        const hasLevelRange = state.levelRange.min !== null || state.levelRange.max !== null;
        const selectedNicks = Array.from(checkboxesContainer.querySelectorAll("input[type=checkbox]:checked")).map(cb => cb.dataset.mob);
        if (hasLevelRange || selectedNicks.length > 0) {
          const hours = parseInt(hoursInput.value) || 0;
          const minutes = parseInt(minutesInput.value) || 0;
          const duration = (hours * 60 + minutes) * 60;
          window.MargonemAPI.combat.clearBlockedMobs();
          let fightConfig;
          if (hasLevelRange) {
            fightConfig = {
              levelRange: {
                min: state.levelRange.min || 1,
                max: state.levelRange.max || 300
              }
            };
          } else {
            fightConfig = selectedNicks;
          }
          window.MargonemAPI.combat.startFight(fightConfig, duration);
          updateButtons();
          updateStatusMessage();
        }
      }
    });
    stopBtn.addEventListener("click", () => {
      if (state.autoFightActive) {
        window.MargonemAPI.combat.stopFight();
        updateButtons();
        updateStatusMessage();
      }
    });
    minutesInput.addEventListener("input", e => {
      let value = parseInt(e.target.value);
      if (value > 59) {
        e.target.value = "59";
      }
    });
    setInterval(updateCheckboxes, 500);
    setInterval(updateButtons, 500);
    setInterval(updateTimerDisplay, 1000);
    setInterval(updateStatusMessage, 1000);
    updateCheckboxes();
    updateButtons();
    updateTimerDisplay();
    updateStatusMessage();
    content.style.display = "none";
    return content;
  }
  function createHealPanel() {
    const healState = window.MargonemAPI.state.heal;
    healState.active = true;
    healState.usePotions = true;
    healState.useFulls = true;
    healState.usePercents = true;
    healState.healToFull = false;
    healState.healAfterDeath = true;
    healState.minHealHpPercent = 80;
    healState.minPotionHealing = 0;
    healState.ignoredItems = healState.ignoredItems || [];
    healState.rarity = ["P", "U", "H", "Ul", "L"];
    window.MargonemAPI.healingSystem.startMonitoring();
    const content = document.createElement("div");
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.height = "100%";
    content.style.gap = "1rem";
    content.style.padding = "1rem";
    content.style.boxSizing = "border-box";
    content.style.background = "#1f2937";
    content.style.color = "#e8d5b5";
    content.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <label style="margin-right: 1rem;">Auto-Heal Active:</label>
                <button id="healToggleBtn" class="bot-ui-button red" style="width: 80px;">ON</button>
            </div>

            <div style="background: #111827; padding: 1rem; border-radius: 0.5rem;">
                <div style="font-weight: bold; margin-bottom: 0.5rem;">Heal Settings</div>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" id="usePotions" class="bot-ui-checkbox" checked />
                    <span style="margin-left: 0.5rem;">Use Normal Potions (leczy)</span>
                </label>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" id="useFulls" class="bot-ui-checkbox" checked />
                    <span style="margin-left: 0.5rem;">Use Full Heal Items (fullheal)</span>
                </label>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" id="usePercents" class="bot-ui-checkbox" checked />
                    <span style="margin-left: 0.5rem;">Use Percent Potions (perheal)</span>
                </label>

                <div style="margin-top: 0.5rem; margin-bottom: 0.5rem;">
                    <label>Min Heal HP% (when "heal to full"):</label><br/>
                    <input type="number" id="minHealHpPercent" class="bot-ui-input" min="1" max="100"
                        style="width: 60px;" value="80" />
                </div>

                <div style="margin-bottom: 0.5rem;">
                    <label>Min Potion Healing:</label><br/>
                    <input type="number" id="minPotionHealing" class="bot-ui-input" min="0" max="999999"
                        style="width: 80px;" value="0" />
                </div>

                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" id="healToFull" class="bot-ui-checkbox" />
                    <span style="margin-left: 0.5rem;">Always Heal to Full below threshold</span>
                </label>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" id="healAfterDeath" class="bot-ui-checkbox" checked />
                    <span style="margin-left: 0.5rem;">Heal After Death</span>
                </label>
            </div>

            <div style="background: #111827; padding: 1rem; border-radius: 0.5rem;">
                <div style="font-weight: bold; margin-bottom: 0.5rem;">Ignored Items (comma-separated):</div>
                <input type="text" id="ignoredItemsInput" class="bot-ui-input" placeholder="Eliksir, Mikstura..."
                    style="width: 100%;" value="" />
            </div>

            <div style="background: #111827; padding: 1rem; border-radius: 0.5rem;">
                <div style="font-weight: bold; margin-bottom: 0.5rem;">Rarities Allowed</div>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" class="rarityCheck" value="P" checked />
                    <span style="margin-left: 0.5rem;">Common (P)</span>
                </label>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" class="rarityCheck" value="U" checked />
                    <span style="margin-left: 0.5rem;">Unique (U)</span>
                </label>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" class="rarityCheck" value="H" checked />
                    <span style="margin-left: 0.5rem;">Heroic (H)</span>
                </label>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" class="rarityCheck" value="Ul" checked />
                    <span style="margin-left: 0.5rem;">Upgraded (Ul)</span>
                </label>
                <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" class="rarityCheck" value="L" checked />
                    <span style="margin-left: 0.5rem;">Legendary (L)</span>
                </label>
            </div>
        `;
    const panel = new DraggablePanel("Auto Heal", content, {
      x: 1080,
      y: 20
    }, {
      isResizable: true,
      initialSize: {
        width: 300,
        height: 520
      },
      minSize: {
        width: 250,
        height: 400
      }
    });
    const healToggleBtn = content.querySelector("#healToggleBtn");
    const usePotionsChk = content.querySelector("#usePotions");
    const useFullsChk = content.querySelector("#useFulls");
    const usePercentsChk = content.querySelector("#usePercents");
    const healToFullChk = content.querySelector("#healToFull");
    const healAfterDeathChk = content.querySelector("#healAfterDeath");
    const minHealHpPercentInp = content.querySelector("#minHealHpPercent");
    const minPotionHealingInp = content.querySelector("#minPotionHealing");
    const ignoredItemsInp = content.querySelector("#ignoredItemsInput");
    const rarityChecks = content.querySelectorAll(".rarityCheck");
    function refreshToggleBtn() {
      healToggleBtn.textContent = healState.active ? "ON" : "OFF";
      healToggleBtn.classList.remove("green", "red");
      healToggleBtn.classList.add(healState.active ? "red" : "green");
    }
    healToggleBtn.addEventListener("click", () => {
      healState.active = !healState.active;
      if (healState.active) {
        window.MargonemAPI.healingSystem.startMonitoring();
      } else {
        window.MargonemAPI.healingSystem.stopMonitoring();
      }
      refreshToggleBtn();
    });
    usePotionsChk.addEventListener("change", () => {
      healState.usePotions = usePotionsChk.checked;
    });
    useFullsChk.addEventListener("change", () => {
      healState.useFulls = useFullsChk.checked;
    });
    usePercentsChk.addEventListener("change", () => {
      healState.usePercents = usePercentsChk.checked;
    });
    healToFullChk.addEventListener("change", () => {
      healState.healToFull = healToFullChk.checked;
    });
    healAfterDeathChk.addEventListener("change", () => {
      healState.healAfterDeath = healAfterDeathChk.checked;
    });
    minHealHpPercentInp.addEventListener("change", () => {
      healState.minHealHpPercent = parseInt(minHealHpPercentInp.value) || 80;
    });
    minPotionHealingInp.addEventListener("change", () => {
      healState.minPotionHealing = parseInt(minPotionHealingInp.value) || 0;
    });
    ignoredItemsInp.addEventListener("change", () => {
      let items = ignoredItemsInp.value.split(",").map(x => x.trim()).filter(Boolean);
      healState.ignoredItems = items;
    });
    rarityChecks.forEach(chk => {
      chk.addEventListener("change", () => {
        if (chk.checked) {
          if (!healState.rarity.includes(chk.value)) {
            healState.rarity.push(chk.value);
          }
        } else {
          healState.rarity = healState.rarity.filter(r => r !== chk.value);
        }
      });
    });
    return panel;
  }
  function createLicensePanel() {
    const container = document.createElement("div");
    container.id = "tm-license-content";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "0.75rem";
    container.style.padding = "0.5rem";
    container.style.height = "100%";
    container.style.boxSizing = "border-box";
    container.style.width = "100%";
    container.addEventListener("wheel", e => {
      e.stopPropagation();
    });
    const messageContainer = document.createElement("div");
    messageContainer.className = "status-display";
    messageContainer.style.padding = "0.5rem 0.75rem";
    messageContainer.style.borderRadius = "0.375rem";
    messageContainer.style.transition = "all 0.3s ease";
    messageContainer.style.fontSize = "0.875rem";
    messageContainer.style.fontWeight = "500";
    messageContainer.style.textAlign = "center";
    messageContainer.style.display = "none";
    messageContainer.style.width = "100%";
    messageContainer.style.boxSizing = "border-box";
    messageContainer.style.wordBreak = "break-word";
    const messageDiv = document.createElement("div");
    messageDiv.id = "tm-license-message";
    messageContainer.appendChild(messageDiv);
    container.appendChild(messageContainer);
    let countdownSpan = null;
    let countdownInterval = null;
    function updateLicenseCountdown(expirationDate) {
      if (!countdownSpan) {
        return;
      }
      const now = new Date().getTime();
      const exp = expirationDate.getTime();
      const diff = exp - now;
      if (diff <= 0) {
        countdownSpan.innerHTML = "<span style='color: #f87171;'>⚠️ Licencja wygasła!</span>";
        clearInterval(countdownInterval);
        countdownInterval = null;
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor(diff / 3600000 % 24);
      const minutes = Math.floor(diff / 60000 % 60);
      const seconds = Math.floor(diff / 1000 % 60);
      const containerWidth = countdownSpan.offsetWidth;
      if (containerWidth >= 240) {
        countdownSpan.innerHTML = `
                    <div style="display: flex; justify-content: center; align-items: center; gap: 0.25rem; margin-top: 0.5rem; flex-wrap: wrap;">
                        <div style="display: flex; flex-direction: column; align-items: center; background: #1a140e; border-radius: 0.25rem; padding: 0.25rem; min-width: 2.5rem; flex: 1;">
                            <span style="font-size: 1rem; font-weight: bold;">${days}</span>
                            <span style="font-size: 0.7rem; color: #9ca3af;">dni</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center; background: #1a140e; border-radius: 0.25rem; padding: 0.25rem; min-width: 2.5rem; flex: 1;">
                            <span style="font-size: 1rem; font-weight: bold;">${hours}</span>
                            <span style="font-size: 0.7rem; color: #9ca3af;">godz</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center; background: #1a140e; border-radius: 0.25rem; padding: 0.25rem; min-width: 2.5rem; flex: 1;">
                            <span style="font-size: 1rem; font-weight: bold;">${minutes}</span>
                            <span style="font-size: 0.7rem; color: #9ca3af;">min</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center; background: #1a140e; border-radius: 0.25rem; padding: 0.25rem; min-width: 2.5rem; flex: 1;">
                            <span style="font-size: 1rem; font-weight: bold;">${seconds}</span>
                            <span style="font-size: 0.7rem; color: #9ca3af;">sek</span>
                        </div>
                    </div>
                `;
      } else {
        countdownSpan.innerHTML = `
                    <div style="margin-top: 0.5rem; text-align: center; background: #1a140e; border-radius: 0.25rem; padding: 0.5rem;">
                        <span style="font-weight: bold;">${days}d ${hours}h ${minutes}m ${seconds}s</span>
                    </div>
                `;
      }
    }
    function showMessage(message, type = "info") {
      messageContainer.style.display = "block";
      messageDiv.textContent = message;
      messageContainer.style.background = "";
      messageContainer.style.borderLeft = "";
      messageDiv.style.color = "";
      switch (type) {
        case "success":
          messageContainer.style.background = "rgba(45, 90, 30, 0.3)";
          messageContainer.style.borderLeft = "4px solid #3d7a2a";
          messageDiv.style.color = "#a3e635";
          break;
        case "error":
          messageContainer.style.background = "rgba(139, 46, 46, 0.3)";
          messageContainer.style.borderLeft = "4px solid #a13636";
          messageDiv.style.color = "#f87171";
          break;
        case "warning":
          messageContainer.style.background = "rgba(180, 130, 30, 0.3)";
          messageContainer.style.borderLeft = "4px solid #d97706";
          messageDiv.style.color = "#fbbf24";
          break;
        default:
          messageContainer.style.background = "rgba(37, 99, 235, 0.2)";
          messageContainer.style.borderLeft = "4px solid #3b82f6";
          messageDiv.style.color = "#60a5fa";
      }
      if (type === "success") {
        setTimeout(() => {
          messageContainer.style.display = "none";
        }, 5000);
      }
    }
    function hideMessage() {
      messageContainer.style.display = "none";
    }
    function refreshPanel() {
      while (container.children.length > 1) {
        container.removeChild(container.lastChild);
      }
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      const storedLicense = localStorage.getItem("tm_license");
      const storedExpiration = localStorage.getItem("tm_license_expiration");
      if (storedLicense && storedExpiration) {
        const expirationDate = new Date(storedExpiration.replace(" ", "T") + "Z");
        const now = new Date();
        const isExpired = expirationDate <= now;
        const licenseCard = document.createElement("div");
        licenseCard.style.background = "linear-gradient(to bottom, #2c2117 0%, #1a140e 100%)";
        licenseCard.style.borderRadius = "0.5rem";
        licenseCard.style.border = "1px solid #463829";
        licenseCard.style.padding = "0.75rem";
        licenseCard.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.2)";
        licenseCard.style.display = "flex";
        licenseCard.style.flexDirection = "column";
        licenseCard.style.gap = "0.75rem";
        licenseCard.style.flex = "1";
        licenseCard.style.boxSizing = "border-box";
        licenseCard.style.width = "100%";
        const statusBadge = document.createElement("div");
        statusBadge.style.display = "flex";
        statusBadge.style.alignItems = "center";
        statusBadge.style.gap = "0.5rem";
        statusBadge.style.padding = "0.4rem 0.6rem";
        statusBadge.style.borderRadius = "0.25rem";
        statusBadge.style.width = "fit-content";
        statusBadge.style.marginBottom = "0.25rem";
        if (isExpired) {
          statusBadge.style.background = "rgba(139, 46, 46, 0.3)";
          statusBadge.style.border = "1px solid #a13636";
          statusBadge.innerHTML = `
                        <span style="color: #f87171;">⚠️</span>
                        <span style="color: #f87171; font-weight: 600;">Licencja wygasła</span>
                    `;
          showMessage("Twoja licencja wygasła!", "error");
        } else {
          statusBadge.style.background = "rgba(45, 90, 30, 0.3)";
          statusBadge.style.border = "1px solid #3d7a2a";
          statusBadge.innerHTML = `
                        <span style="color: #a3e635;">✓</span>
                        <span style="color: #a3e635; font-weight: 600;">Licencja aktywna</span>
                    `;
          hideMessage();
        }
        licenseCard.appendChild(statusBadge);
        const keySection = document.createElement("div");
        keySection.style.background = "rgba(28, 21, 15, 0.6)";
        keySection.style.borderRadius = "0.375rem";
        keySection.style.padding = "0.5rem 0.75rem";
        keySection.style.marginBottom = "0.25rem";
        keySection.style.width = "100%";
        keySection.style.boxSizing = "border-box";
        const keyLabel = document.createElement("div");
        keyLabel.innerHTML = `<span style="color: #9ca3af; font-size: 0.75rem; text-transform: uppercase; font-weight: 600;">Klucz licencyjny</span>`;
        keySection.appendChild(keyLabel);
        const keyValue = document.createElement("div");
        keyValue.style.fontFamily = "monospace";
        keyValue.style.fontSize = "0.875rem";
        keyValue.style.padding = "0.25rem 0";
        keyValue.style.wordBreak = "break-all";
        keyValue.style.overflow = "hidden";
        keyValue.style.textOverflow = "ellipsis";
        const maskedKey = storedLicense.length > 8 ? storedLicense.substring(0, 4) + "•".repeat(storedLicense.length - 8) + storedLicense.substring(storedLicense.length - 4) : storedLicense;
        keyValue.textContent = maskedKey;
        keySection.appendChild(keyValue);
        licenseCard.appendChild(keySection);
        const expSection = document.createElement("div");
        expSection.style.marginBottom = "0.25rem";
        expSection.style.width = "100%";
        expSection.style.boxSizing = "border-box";
        const expLabel = document.createElement("div");
        expLabel.innerHTML = `<span style="color: #9ca3af; font-size: 0.75rem; text-transform: uppercase; font-weight: 600;">Wygaśnięcie licencji</span>`;
        expSection.appendChild(expLabel);
        const expValue = document.createElement("div");
        expValue.style.fontSize = "0.875rem";
        expValue.style.padding = "0.25rem 0";
        expValue.style.wordBreak = "break-word";
        try {
          const options = {
            year: "numeric",
            month: "short",
            day: "numeric"
          };
          const timeOptions = {
            hour: "2-digit",
            minute: "2-digit"
          };
          const dateStr = expirationDate.toLocaleDateString("pl-PL", options);
          const timeStr = expirationDate.toLocaleTimeString("pl-PL", timeOptions);
          expValue.textContent = `${dateStr}, ${timeStr}`;
        } catch (e) {
          expValue.textContent = expirationDate.toISOString().replace("T", " ").substring(0, 16);
        }
        expSection.appendChild(expValue);
        licenseCard.appendChild(expSection);
        if (!isExpired) {
          const countdownSection = document.createElement("div");
          countdownSection.style.marginBottom = "0.25rem";
          countdownSection.style.width = "100%";
          countdownSection.style.boxSizing = "border-box";
          const countdownLabel = document.createElement("div");
          countdownLabel.innerHTML = `<span style="color: #9ca3af; font-size: 0.75rem; text-transform: uppercase; font-weight: 600;">Pozostały czas</span>`;
          countdownSection.appendChild(countdownLabel);
          countdownSpan = document.createElement("div");
          countdownSpan.style.textAlign = "center";
          countdownSpan.style.width = "100%";
          countdownSpan.style.boxSizing = "border-box";
          try {
            const resizeObserver = new ResizeObserver(entries => {
              updateLicenseCountdown(expirationDate);
            });
            resizeObserver.observe(countdownSpan);
          } catch (e) {}
          countdownSection.appendChild(countdownSpan);
          licenseCard.appendChild(countdownSection);
          updateLicenseCountdown(expirationDate);
          countdownInterval = setInterval(() => {
            updateLicenseCountdown(expirationDate);
          }, 1000);
        }
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Usuń licencję";
        removeBtn.className = "bot-ui-button red";
        removeBtn.style.marginTop = "auto";
        removeBtn.style.alignSelf = "stretch";
        removeBtn.style.padding = "0.5rem";
        removeBtn.style.fontSize = "0.85rem";
        removeBtn.style.fontWeight = "600";
        removeBtn.style.transition = "all 0.2s ease";
        removeBtn.style.width = "100%";
        removeBtn.style.boxSizing = "border-box";
        removeBtn.addEventListener("click", () => {
          const confirmSection = document.createElement("div");
          confirmSection.style.background = "rgba(139, 46, 46, 0.2)";
          confirmSection.style.borderRadius = "0.375rem";
          confirmSection.style.padding = "0.5rem";
          confirmSection.style.marginBottom = "0.25rem";
          confirmSection.style.textAlign = "center";
          confirmSection.style.width = "100%";
          confirmSection.style.boxSizing = "border-box";
          confirmSection.innerHTML = `
                        <div style="margin-bottom: 0.5rem; font-size: 0.9rem;">Czy na pewno chcesz usunąć licencję?</div>
                        <div style="display: flex; gap: 0.5rem; justify-content: center;">
                            <button id="confirmRemoveBtn" class="bot-ui-button red" style="padding: 0.4rem 0.6rem; font-size: 0.85rem;">Tak, usuń</button>
                            <button id="cancelRemoveBtn" class="bot-ui-button" style="padding: 0.4rem 0.6rem; font-size: 0.85rem;">Anuluj</button>
                        </div>
                    `;
          licenseCard.replaceChild(confirmSection, removeBtn);
          document.getElementById("confirmRemoveBtn").addEventListener("click", () => {
            removeStoredLicense();
            refreshPanel();
            showMessage("Licencja została usunięta", "info");
          });
          document.getElementById("cancelRemoveBtn").addEventListener("click", () => {
            licenseCard.replaceChild(removeBtn, confirmSection);
          });
        });
        licenseCard.appendChild(removeBtn);
        container.appendChild(licenseCard);
      } else {
        const registerCard = document.createElement("div");
        registerCard.style.background = "linear-gradient(to bottom, #2c2117 0%, #1a140e 100%)";
        registerCard.style.borderRadius = "0.5rem";
        registerCard.style.border = "1px solid #463829";
        registerCard.style.padding = "0.75rem";
        registerCard.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.2)";
        registerCard.style.display = "flex";
        registerCard.style.flexDirection = "column";
        registerCard.style.gap = "0.75rem";
        registerCard.style.flex = "1";
        registerCard.style.width = "100%";
        registerCard.style.boxSizing = "border-box";
        const headerSection = document.createElement("div");
        headerSection.style.textAlign = "center";
        headerSection.style.marginBottom = "0.25rem";
        headerSection.style.width = "100%";
        const icon = document.createElement("div");
        icon.innerHTML = `<span style="font-size: 1.75rem; color: #fbbf24;">🔑</span>`;
        headerSection.appendChild(icon);
        const title = document.createElement("div");
        title.style.fontSize = "1rem";
        title.style.fontWeight = "600";
        title.style.marginTop = "0.25rem";
        title.textContent = "Aktywacja licencji";
        headerSection.appendChild(title);
        const subtitle = document.createElement("div");
        subtitle.style.fontSize = "0.8rem";
        subtitle.style.color = "#9ca3af";
        subtitle.style.marginTop = "0.25rem";
        subtitle.textContent = "Wprowadź swój klucz licencyjny";
        headerSection.appendChild(subtitle);
        registerCard.appendChild(headerSection);
        const inputSection = document.createElement("div");
        inputSection.style.marginBottom = "0.25rem";
        inputSection.style.width = "100%";
        inputSection.style.boxSizing = "border-box";
        const inputLabel = document.createElement("label");
        inputLabel.textContent = "Klucz licencyjny:";
        inputLabel.style.display = "block";
        inputLabel.style.fontSize = "0.8rem";
        inputLabel.style.marginBottom = "0.25rem";
        inputLabel.style.fontWeight = "500";
        inputSection.appendChild(inputLabel);
        const inputWrapper = document.createElement("div");
        inputWrapper.style.position = "relative";
        inputWrapper.style.width = "100%";
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "xxxxx-xxxxx-xxxxx-xxxxx";
        input.className = "bot-ui-input";
        input.style.width = "100%";
        input.style.padding = "0.5rem";
        input.style.fontSize = "0.85rem";
        input.style.border = "1px solid #463829";
        input.style.borderRadius = "0.375rem";
        input.style.backgroundColor = "#1a140e";
        input.style.color = "#e8d5b5";
        input.style.transition = "all 0.2s ease";
        input.style.boxSizing = "border-box";
        input.addEventListener("focus", () => {
          input.style.borderColor = "#594632";
          input.style.boxShadow = "0 0 0 2px rgba(89, 70, 50, 0.3)";
        });
        input.addEventListener("blur", () => {
          input.style.borderColor = "#463829";
          input.style.boxShadow = "none";
        });
        inputWrapper.appendChild(input);
        inputSection.appendChild(inputWrapper);
        registerCard.appendChild(inputSection);
        const registerBtn = document.createElement("button");
        registerBtn.textContent = "Zarejestruj licencję";
        registerBtn.className = "bot-ui-button green";
        registerBtn.style.padding = "0.5rem";
        registerBtn.style.fontSize = "0.85rem";
        registerBtn.style.fontWeight = "600";
        registerBtn.style.marginTop = "auto";
        registerBtn.style.width = "100%";
        registerBtn.style.transition = "all 0.2s ease";
        registerBtn.style.boxSizing = "border-box";
        registerBtn.addEventListener("click", () => {
          const key = input.value.trim();
          if (!key) {
            showMessage("Wprowadź klucz licencyjny", "warning");
            input.focus();
            return;
          }
          registerBtn.disabled = true;
          registerBtn.textContent = "Weryfikacja...";
          registerBtn.style.opacity = "0.7";
          showMessage("Weryfikowanie licencji...", "info");
          registerLicense(key);
          setTimeout(() => {
            registerBtn.disabled = false;
            registerBtn.textContent = "Zarejestruj licencję";
            registerBtn.style.opacity = "1";
          }, 2000);
        });
        registerCard.appendChild(registerBtn);
        container.appendChild(registerCard);
        const tipsSection = document.createElement("div");
        tipsSection.style.fontSize = "0.7rem";
        tipsSection.style.color = "#9ca3af";
        tipsSection.style.textAlign = "center";
        tipsSection.style.padding = "0.25rem 0";
        tipsSection.style.width = "100%";
        tipsSection.style.boxSizing = "border-box";
        tipsSection.innerHTML = `
                    <div style="margin-bottom: 0.25rem;">Nie masz licencji?</div>
                    <div>Skontaktuj się z administratorem, aby uzyskać klucz.</div>
                `;
        container.appendChild(tipsSection);
      }
      return container;
    }
    refreshPanel();
    return container;
  }
  function openLicensePanel() {
    const panelContent = createLicensePanel();
    const licensePanel = new DraggablePanel("License Panel", panelContent, {
      x: 50,
      y: 50
    }, {
      isResizable: true,
      initialSize: {
        width: 300,
        height: 250
      },
      minSize: {
        width: 250,
        height: 150
      }
    });
    licensePanel.restore();
    return licensePanel;
  }
  function createE2Panel() {
    const panelState = {
      characters: [],
      active: false,
      isProcessing: false,
      currentCharacterIndex: -1,
      scrollPosition: 0,
      userSelections: {},
      lastApiSync: 0
    };
    let localUserSelections = {};
    const content = document.createElement("div");
    content.className = "e2-panel-content";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.height = "100%";
    content.style.width = "100%";
    content.style.padding = "0";
    content.style.margin = "0";
    content.style.boxSizing = "border-box";
    content.style.overflow = "hidden";
    content.style.fontFamily = "inherit";
    content.style.color = "#e0c088";
    content.style.background = "#1e2426";
    content.style.borderRadius = "3px";
    function debugLog(message, type = "info") {
      // Disabled spam logs
      return;
      const prefix = "[E2 Panel]";
      const timestamp = new Date().toLocaleTimeString();
      switch (type) {
        case "error":
          console.error(`${prefix} ${timestamp} - ${message}`);
          break;
        case "warning":
          console.warn(`${prefix} ${timestamp} - ${message}`);
          break;
        default:
          console.log(`${prefix} ${timestamp} - ${message}`);
      }
    }
    function saveCharacterSelection(charId, isEnabled, selectedBoss) {
      if (!localUserSelections[charId]) {
        localUserSelections[charId] = {};
      }
      if (isEnabled !== undefined) {
        localUserSelections[charId].enabled = isEnabled;
      }
      if (selectedBoss !== undefined) {
        localUserSelections[charId].selectedBoss = selectedBoss;
      }
      const charIndex = panelState.characters.findIndex(c => c.id === charId);
      if (charIndex !== -1) {
        if (isEnabled !== undefined) {
          panelState.characters[charIndex].enabled = isEnabled;
        }
        if (selectedBoss !== undefined) {
          panelState.characters[charIndex].selectedBoss = selectedBoss;
          panelState.characters[charIndex].bossData = selectedBoss && window.e2 ? window.e2[selectedBoss] : null;
        }
        if (!panelState.userSelections[charId]) {
          panelState.userSelections[charId] = {};
        }
        if (isEnabled !== undefined) {
          panelState.userSelections[charId].enabled = isEnabled;
        }
        if (selectedBoss !== undefined) {
          panelState.userSelections[charId].selectedBoss = selectedBoss;
        }
      }
      saveSelectionToAPI(charId, isEnabled, selectedBoss);
      debugLog(`Zapisano wybór: postać=${charId}, włączona=${isEnabled}, boss=${selectedBoss}`);
    }
    function applyAllSavedSelections() {
      let appliedCount = 0;
      panelState.characters.forEach(char => {
        if (panelState.userSelections[char.id]) {
          if (panelState.userSelections[char.id].enabled !== undefined) {
            char.enabled = panelState.userSelections[char.id].enabled;
          }
          if (panelState.userSelections[char.id].selectedBoss) {
            char.selectedBoss = panelState.userSelections[char.id].selectedBoss;
            char.bossData = char.selectedBoss && window.e2 ? window.e2[char.selectedBoss] : null;
          }
          appliedCount++;
        }
      });
      panelState.characters.forEach(char => {
        if (localUserSelections[char.id]) {
          if (localUserSelections[char.id].enabled !== undefined) {
            char.enabled = localUserSelections[char.id].enabled;
          }
          if (localUserSelections[char.id].selectedBoss) {
            char.selectedBoss = localUserSelections[char.id].selectedBoss;
            char.bossData = char.selectedBoss && window.e2 ? window.e2[char.selectedBoss] : null;
          }
        }
      });
      ensureE2APIExists();
      if (window.MargonemAPI.e2.state.characters && window.MargonemAPI.e2.state.characters.length > 0) {
        panelState.characters.forEach(char => {
          const apiChar = window.MargonemAPI.e2.state.characters.find(c => c.id === char.id);
          if (apiChar) {
            if (char.enabled !== undefined) {
              apiChar.enabled = char.enabled;
            }
            if (char.selectedBoss) {
              apiChar.selectedBoss = char.selectedBoss;
              apiChar.bossData = char.selectedBoss && window.e2 ? window.e2[char.selectedBoss] : null;
            }
          }
        });
      }
      debugLog(`Zastosowano zapisane wybory dla ${appliedCount} postaci`);
    }
    function saveSelectionToAPI(characterId, isEnabled, selectedBoss) {
      if (!ensureE2APIExists()) {
        debugLog("Nie można zapisać do API: API nie zainicjalizowane", "error");
        return false;
      }
      try {
        const panelChar = panelState.characters.find(c => c.id === characterId);
        if (!panelChar) {
          debugLog(`Postać ${characterId} nie znaleziona w stanie panelu`, "error");
          return false;
        }
        if (isEnabled !== undefined && typeof window.MargonemAPI.e2.toggleCharacter === "function") {
          window.MargonemAPI.e2.toggleCharacter(characterId, isEnabled);
        }
        if (selectedBoss !== undefined && typeof window.MargonemAPI.e2.setCharacterBoss === "function") {
          window.MargonemAPI.e2.setCharacterBoss(characterId, selectedBoss);
        }
        return true;
      } catch (error) {
        debugLog(`Błąd podczas zapisywania do API: ${error.message}`, "error");
        return false;
      }
    }
    function initializeCharactersFromEngine() {
      debugLog("Inicjalizacja postaci z silnika Engine");
      const characterList = window.Engine?.characterList?.list || [];
      if (!characterList || characterList.length === 0) {
        debugLog("Nie znaleziono postaci w Engine", "error");
        return [];
      }
      debugLog(`Znaleziono ${characterList.length} postaci w Engine`);
      const initializedChars = characterList.map(char => {
        const savedSelections = localUserSelections[char.id] || {};
        return {
          id: char.id,
          nick: char.nick,
          world: char.world,
          enabled: savedSelections.enabled !== undefined ? savedSelections.enabled : false,
          selectedBoss: savedSelections.selectedBoss || null,
          bossData: savedSelections.selectedBoss && window.e2 ? window.e2[savedSelections.selectedBoss] : null,
          lastKillTime: null,
          respawnTime: null,
          nextRespawnAt: null,
          status: "Waiting"
        };
      });
      return initializedChars;
    }
    function generatePanelContent() {
      syncStateWithMargonemAPI();
      applyAllSavedSelections();
      const characters = panelState.characters;
      const isActive = panelState.active;
      let html = `
            <div class="e2-panel-header" style="
                padding: 8px 10px;
                background: linear-gradient(to bottom, #32383a, #1e2426);
                border-bottom: 1px solid #0c0e0f;
                text-align: center;
                font-weight: bold;
                font-size: 14px;
                color: #e0c088;
                text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
            ">
                Zarządzanie E2
            </div>

            <div class="e2-panel-body" style="
                padding: 10px;
                height: calc(100% - 40px);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            ">
                <div class="e2-section-header" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 6px;
                ">
                    <span style="
                        color: #a98e52;
                        font-size: 13px;
                        font-weight: bold;
                    ">Postacie</span>
                    <button id="refreshCharsBtn" style="
                        background: linear-gradient(to bottom, #4e453a, #342f27);
                        border: 1px solid #5d5243;
                        border-radius: 3px;
                        color: #e0c088;
                        padding: 2px 8px;
                        font-size: 11px;
                        cursor: pointer;
                        text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
                    ">
                        Odśwież
                    </button>
                </div>

                <div id="charactersList" style="
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid #3c3527;
                    border-radius: 3px;
                    padding: 6px;
                    margin-bottom: 10px;
                    overflow-y: auto;
                    flex-grow: 1;
                    position: relative;
                    scrollbar-width: thin;
                    scrollbar-color: #5d5243 rgba(0, 0, 0, 0.2);
                ">`;
      if (characters.length === 0) {
        html += `<div style="color: #a98e52; text-align: center; padding: 8px; font-size: 12px;">Brak dostępnych postaci</div>`;
      } else {
        for (let i = 0; i < characters.length; i++) {
          const char = characters[i];
          const savedSelection = localUserSelections[char.id] || {};
          const isEnabled = savedSelection.enabled !== undefined ? savedSelection.enabled : char.enabled;
          const selectedBoss = savedSelection.selectedBoss || char.selectedBoss;
          html += `
                    <div class="character-item" style="
                        margin-bottom: 6px;
                        background: ${i % 2 === 0 ? "rgba(12, 13, 16, 0.6)" : "rgba(19, 22, 27, 0.6)"};
                        border: 1px solid ${isEnabled ? "#5d5243" : "#3c3527"};
                        border-radius: 3px;
                        padding: 6px;
                        transition: all 0.2s ease;
                        ${panelState.currentCharacterIndex === i ? "box-shadow: 0 0 5px #e0c088;" : ""}
                    ">
                        <div style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            margin-bottom: 4px;
                        ">
                            <div style="display: flex; align-items: center;">
                                <input type="checkbox" 
                                    id="char-${char.id}" 
                                    class="char-toggle" 
                                    data-id="${char.id}" 
                                    ${isEnabled ? "checked" : ""}
                                    ${isActive ? "disabled" : ""}
                                    style="
                                        margin: 0;
                                        width: 14px;
                                        height: 14px;
                                        accent-color: #5d5243;
                                        cursor: pointer;
                                    "
                                >
                                <label for="char-${char.id}" style="
                                    margin-left: 6px;
                                    color: ${isEnabled ? "#e0c088" : "#a98e52"};
                                    font-weight: bold;
                                    font-size: 12px;
                                    cursor: pointer;
                                    user-select: none;
                                ">
                                    ${char.nick} <span style="color: #808080; font-weight: normal;">(${char.world})</span>
                                </label>
                            </div>
                            <div style="
                                padding: 2px 6px;
                                border-radius: 2px;
                                font-size: 10px;
                                background: ${getStatusColor(char.status)};
                                color: #fff;
                                text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
                            ">
                                ${getStatusText(char.status)}
                            </div>
                        </div>

                        <div style="
                            display: flex;
                            align-items: center;
                            gap: 6px;
                        ">
                            <select 
                                class="boss-select" 
                                data-id="${char.id}" 
                                style="
                                    flex-grow: 1;
                                    background: #232528;
                                    border: 1px solid #3c3527;
                                    border-radius: 3px;
                                    color: #a98e52;
                                    padding: 3px 6px;
                                    font-size: 12px;
                                    cursor: pointer;
                                    background-image: url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23a98e52\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 9l6 6 6-6\"/></svg>');
                                    background-repeat: no-repeat;
                                    background-position: right 6px center;
                                    padding-right: 20px;
                                " 
                                ${isActive ? "disabled" : ""}>
                                <option value="">Wybierz E2</option>
                                ${Object.keys(window.e2 || {}).map(key => `<option value="${key}" ${selectedBoss === key ? "selected" : ""}>${key}</option>`).join("")}
                            </select>
                        </div>

                        <div style="
                            margin-top: 4px;
                            font-size: 11px;
                            color: #808080;
                        ">
                            ${getCharacterTimingInfo(char, selectedBoss)}
                        </div>
                    </div>`;
        }
      }
      html += `</div>

                <button
                    id="e2Btn"
                    style="
                        width: 100%;
                        padding: 8px;
                        margin-bottom: 8px;
                        background: linear-gradient(to bottom, ${isActive ? "#6b4242, #431f1f" : "#4a6b42, #2f431f"});
                        border: 1px solid ${isActive ? "#8d5252" : "#5d8d52"};
                        border-radius: 3px;
                        color: #fff;
                        font-weight: bold;
                        font-size: 13px;
                        cursor: pointer;
                        text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
                        transition: all 0.2s ease;
                    "
                >
                    ${isActive ? "Stop" : "Start"}
                </button>

                <div
                    id="e2Status"
                    style="
                        text-align: center;
                        color: #a98e52;
                        font-size: 11px;
                        background: rgba(0, 0, 0, 0.3);
                        padding: 6px;
                        border: 1px solid #3c3527;
                        border-radius: 3px;
                    "
                >
                    ${getGlobalStatusText()}
                </div>
            </div>`;
      return html;
    }
    function getStatusColor(status) {
      switch (status) {
        case "Waiting":
          return "#4c5366";
        case "Processing":
          return "#3b6387";
        case "Fighting":
          return "#8f6b30";
        case "Killed":
          return "#496b42";
        case "NotFound":
          return "#696969";
        case "Respawning":
          return "#6b4987";
        case "Error":
          return "#7c3838";
        default:
          return "#4c5366";
      }
    }
    function getStatusText(status) {
      switch (status) {
        case "Waiting":
          return "Oczekiwanie";
        case "Processing":
          return "Przetwarzanie";
        case "Fighting":
          return "Walka";
        case "Killed":
          return "Zabity";
        case "NotFound":
          return "Nie znaleziono";
        case "Respawning":
          return "Respawn";
        case "Error":
          return "Błąd";
        default:
          return "Oczekiwanie";
      }
    }
    function getCharacterTimingInfo(char, selectedBoss) {
      const boss = selectedBoss || char.selectedBoss;
      if (char.nextRespawnAt) {
        const now = Date.now();
        if (char.nextRespawnAt > now) {
          const remainingTime = Math.floor((char.nextRespawnAt - now) / 1000 / 60);
          return `Następny respawn za ~${remainingTime} min`;
        } else {
          return "E2 powinien być dostępny";
        }
      } else if (char.lastKillTime) {
        return `Ostatnie zabicie: ${new Date(char.lastKillTime).toLocaleTimeString()}`;
      } else if (boss) {
        return `Wybrany E2: ${boss}`;
      } else {
        return "Nie wybrano E2";
      }
    }
    function getGlobalStatusText() {
      const characters = panelState.characters.map(char => {
        const savedSelection = localUserSelections[char.id] || {};
        return {
          ...char,
          enabled: savedSelection.enabled !== undefined ? savedSelection.enabled : char.enabled,
          selectedBoss: savedSelection.selectedBoss || char.selectedBoss
        };
      });
      let autoResumed = false;
      if (window.MargonemAPI && window.MargonemAPI.e2 && window.MargonemAPI.e2.state) {
        autoResumed = window.MargonemAPI.e2.state.autoResumed;
      }
      if (!panelState.active) {
        const enabledChars = characters.filter(c => c.enabled && c.selectedBoss);
        if (enabledChars.length > 0) {
          return `Gotowy do startu (${enabledChars.length} postaci)`;
        } else {
          return "Wybierz postacie i E2 aby rozpocząć";
        }
      }
      if (autoResumed) {
        const resumePrefix = "🔄 Wznowiono: ";
        if (panelState.isProcessing) {
          const currentChar = panelState.characters[panelState.currentCharacterIndex];
          if (currentChar) {
            return `${resumePrefix}${currentChar.nick} - ${getStatusText(currentChar.status)}`;
          }
        }
        const killedChars = panelState.characters.filter(c => c.status === "Killed" || c.status === "NotFound");
        const enabledChars = characters.filter(c => c.enabled);
        return `${resumePrefix}(zabito: ${killedChars.length}/${enabledChars.length})`;
      } else {
        if (panelState.isProcessing) {
          const currentChar = panelState.characters[panelState.currentCharacterIndex];
          if (currentChar) {
            return `Aktywna postać: ${currentChar.nick} - ${getStatusText(currentChar.status)}`;
          }
        }
        const killedChars = panelState.characters.filter(c => c.status === "Killed" || c.status === "NotFound");
        const enabledChars = characters.filter(c => c.enabled);
        return `Aktywny (zabito: ${killedChars.length}/${enabledChars.length})`;
      }
    }
    function ensureE2APIExists() {
      if (!window.MargonemAPI) {
        debugLog("MargonemAPI nie jest dostępne", "error");
        return false;
      }
      if (!window.MargonemAPI.e2) {
        debugLog("MargonemAPI.e2 nie jest dostępne", "error");
        return false;
      }
      return true;
    }
    function startE2Process() {
      debugLog("Próba uruchomienia procesu E2");
      if (!ensureE2APIExists()) {
        debugLog("Nie można uruchomić E2: API nie jest dostępne", "error");
        return false;
      }
      const enabledCharacters = [];
      panelState.characters.forEach(char => {
        const savedSelection = localUserSelections[char.id] || {};
        const isEnabled = savedSelection.enabled !== undefined ? savedSelection.enabled : char.enabled;
        const selectedBoss = savedSelection.selectedBoss || char.selectedBoss;
        if (isEnabled && selectedBoss) {
          enabledCharacters.push({
            id: char.id,
            nick: char.nick,
            world: char.world,
            selectedBoss: selectedBoss
          });
        }
      });
      if (enabledCharacters.length === 0) {
        debugLog("Brak wybranych postaci lub bosów", "error");
        return false;
      }
      debugLog(`Znaleziono ${enabledCharacters.length} wybranych postaci do uruchomienia`);
      enabledCharacters.forEach(char => {
        debugLog(`Zapisuję wybór dla ${char.nick} w API: boss=${char.selectedBoss}`);
        saveSelectionToAPI(char.id, true, char.selectedBoss);
      });
      if (typeof window.MargonemAPI.e2.startE2 !== "function") {
        debugLog("Funkcja MargonemAPI.e2.startE2 nie istnieje", "error");
        return false;
      }
      try {
        debugLog("Wywołuję MargonemAPI.e2.startE2()");
        const result = window.MargonemAPI.e2.startE2();
        debugLog(`Wynik uruchomienia procesu E2: ${JSON.stringify(result)}`);
        if (result && result.error) {
          debugLog(`Uruchomienie E2 zwróciło błąd: ${result.error}`, "error");
          return false;
        }
        updatePanel();
        return true;
      } catch (error) {
        debugLog(`Błąd podczas uruchamiania procesu E2: ${error.message}`, "error");
        return false;
      }
    }
    function stopE2Process() {
      debugLog("Próba zatrzymania procesu E2");
      if (!ensureE2APIExists()) {
        debugLog("Nie można zatrzymać E2: API nie jest dostępne", "error");
        return false;
      }
      if (typeof window.MargonemAPI.e2.stopE2 !== "function") {
        debugLog("Funkcja MargonemAPI.e2.stopE2 nie istnieje", "error");
        return false;
      }
      try {
        const result = window.MargonemAPI.e2.stopE2();
        debugLog(`Proces E2 zatrzymany: ${JSON.stringify(result)}`);
        updatePanel();
        return true;
      } catch (error) {
        debugLog(`Błąd podczas zatrzymywania procesu E2: ${error.message}`, "error");
        return false;
      }
    }
    function syncStateWithMargonemAPI() {
      if (!ensureE2APIExists()) {
        return;
      }
      const apiStateTimestamp = window.MargonemAPI.e2.state.lastStateUpdate || 0;
      if (apiStateTimestamp <= panelState.lastApiSync) {
        return;
      }
      debugLog("Synchronizacja stanu z MargonemAPI");
      panelState.lastApiSync = apiStateTimestamp;
      try {
        const apiState = window.MargonemAPI.e2.getState ? window.MargonemAPI.e2.getState() : window.MargonemAPI.e2.state;
        panelState.active = apiState.active || false;
        panelState.isProcessing = apiState.isProcessing || false;
        panelState.currentCharacterIndex = apiState.currentCharacterIndex || 0;
        if (panelState.characters.length === 0 && apiState.characters && apiState.characters.length > 0) {
          debugLog(`Inicjalizacja ${apiState.characters.length} postaci z API`);
          panelState.characters = apiState.characters.map(apiChar => ({
            ...apiChar,
            enabled: localUserSelections[apiChar.id]?.enabled !== undefined ? localUserSelections[apiChar.id].enabled : apiChar.enabled,
            selectedBoss: localUserSelections[apiChar.id]?.selectedBoss || apiChar.selectedBoss,
            bossData: localUserSelections[apiChar.id]?.selectedBoss && window.e2 ? window.e2[localUserSelections[apiChar.id].selectedBoss] : null
          }));
        } else if (apiState.characters && apiState.characters.length > 0) {
          panelState.characters.forEach(panelChar => {
            const apiChar = apiState.characters.find(c => c.id === panelChar.id);
            if (apiChar) {
              const savedSelection = localUserSelections[panelChar.id] || {};
              const wasEnabled = savedSelection.enabled !== undefined ? savedSelection.enabled : panelChar.enabled;
              const selectedBoss = savedSelection.selectedBoss || panelChar.selectedBoss;
              panelChar.status = apiChar.status || panelChar.status;
              panelChar.lastKillTime = apiChar.lastKillTime || panelChar.lastKillTime;
              panelChar.respawnTime = apiChar.respawnTime || panelChar.respawnTime;
              panelChar.nextRespawnAt = apiChar.nextRespawnAt || panelChar.nextRespawnAt;
              panelChar.enabled = wasEnabled;
              panelChar.selectedBoss = selectedBoss;
              panelChar.bossData = selectedBoss && window.e2 ? window.e2[selectedBoss] : null;
            }
          });
        }
      } catch (error) {
        debugLog(`Błąd podczas synchronizacji z API: ${error.message}`, "error");
      }
      if (panelState.characters.length === 0) {
        panelState.characters = initializeCharactersFromEngine();
      }
    }
    function isAnySelectOpen() {
      const selects = content.querySelectorAll("select");
      for (let i = 0; i < selects.length; i++) {
        if (document.activeElement === selects[i] || selects[i].dataset.focused === "true") {
          return true;
        }
      }
      return false;
    }
    content.innerHTML = generatePanelContent();
    function attachEventListeners() {
      const charactersList = content.querySelector("#charactersList");
      if (charactersList) {
        charactersList.scrollTop = panelState.scrollPosition;
        charactersList.addEventListener("scroll", function () {
          panelState.scrollPosition = this.scrollTop;
        });
      }
      content.querySelectorAll(".char-toggle").forEach(checkbox => {
        checkbox.addEventListener("change", function () {
          const charId = this.getAttribute("data-id");
          const isChecked = this.checked;
          saveCharacterSelection(charId, isChecked, undefined);
          debugLog(`Zmieniono stan postaci ${charId} na ${isChecked ? "włączony" : "wyłączony"}`);
          const charItem = this.closest(".character-item");
          if (charItem) {
            charItem.style.border = `1px solid ${isChecked ? "#5d5243" : "#3c3527"}`;
            const label = charItem.querySelector(`label[for="char-${charId}"]`);
            if (label) {
              label.style.color = isChecked ? "#e0c088" : "#a98e52";
            }
          }
          updateStatusText();
        });
      });
      content.querySelectorAll(".boss-select").forEach(select => {
        select.addEventListener("focus", function () {
          this.dataset.focused = "true";
        });
        select.addEventListener("blur", function () {
          setTimeout(() => {
            this.dataset.focused = "false";
          }, 200);
        });
        select.addEventListener("change", function () {
          const charId = this.getAttribute("data-id");
          const bossName = this.value;
          saveCharacterSelection(charId, undefined, bossName);
          debugLog(`Wybrano bossa "${bossName}" dla postaci ${charId}`);
          const charItem = this.closest(".character-item");
          if (charItem) {
            const timingInfo = charItem.querySelector("div:last-child");
            if (timingInfo) {
              const char = panelState.characters.find(c => c.id === charId);
              if (char) {
                timingInfo.textContent = getCharacterTimingInfo(char, bossName);
              }
            }
          }
          updateStatusText();
        });
      });
      const e2Btn = content.querySelector("#e2Btn");
      if (e2Btn) {
        e2Btn.addEventListener("click", function () {
          if (!ensureE2APIExists()) {
            debugLog("Nie można przełączyć E2: API nie jest dostępne", "error");
            return;
          }
          debugLog(`Kliknięto przycisk E2, obecny stan: ${panelState.active ? "aktywny" : "nieaktywny"}`);
          let success = false;
          try {
            if (panelState.active) {
              success = stopE2Process();
            } else {
              success = startE2Process();
            }
            if (success) {
              const willBeActive = !panelState.active;
              this.textContent = willBeActive ? "Stop" : "Start";
              this.style.background = `linear-gradient(to bottom, ${willBeActive ? "#6b4242, #431f1f" : "#4a6b42, #2f431f"})`;
              this.style.borderColor = willBeActive ? "#8d5252" : "#5d8d52";
            } else {
              debugLog("Nie udało się przełączyć stanu E2", "error");
            }
          } catch (error) {
            debugLog(`Błąd podczas przełączania E2: ${error.message}`, "error");
          }
        });
      }
      const refreshBtn = content.querySelector("#refreshCharsBtn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", function () {
          this.textContent = "Ładowanie...";
          this.disabled = true;
          setTimeout(() => {
            debugLog("Odświeżanie listy postaci");
            try {
              if (ensureE2APIExists() && typeof window.MargonemAPI.e2.initializeCharacters === "function") {
                debugLog("Wywołuję API initializeCharacters");
                window.MargonemAPI.e2.initializeCharacters();
              }
              panelState.characters = initializeCharactersFromEngine();
              setTimeout(() => {
                Object.keys(localUserSelections).forEach(charId => {
                  const savedSelection = localUserSelections[charId];
                  if (savedSelection.enabled !== undefined || savedSelection.selectedBoss) {
                    saveSelectionToAPI(charId, savedSelection.enabled, savedSelection.selectedBoss);
                  }
                });
                updatePanel();
                this.textContent = "Odśwież";
                this.disabled = false;
              }, 100);
            } catch (error) {
              debugLog(`Błąd podczas odświeżania: ${error.message}`, "error");
              this.textContent = "Odśwież";
              this.disabled = false;
            }
          }, 100);
        });
      }
    }
    function updateStatusText() {
      const statusEl = content.querySelector("#e2Status");
      if (statusEl) {
        statusEl.textContent = getGlobalStatusText();
      }
    }
    function updatePanel() {
      if (isAnySelectOpen()) {
        debugLog("Pomijam aktualizację panelu: lista rozwijana jest otwarta");
        return;
      }
      panelState.characters.forEach(char => {
        if (!panelState.userSelections[char.id]) {
          panelState.userSelections[char.id] = {};
        }
        panelState.userSelections[char.id].enabled = char.enabled;
        panelState.userSelections[char.id].selectedBoss = char.selectedBoss;
        if (!localUserSelections[char.id]) {
          localUserSelections[char.id] = {};
        }
        localUserSelections[char.id].enabled = char.enabled;
        localUserSelections[char.id].selectedBoss = char.selectedBoss;
      });
      const newContent = generatePanelContent();
      content.innerHTML = newContent;
      attachEventListeners();
      debugLog("Panel zaktualizowany");
    }
    attachEventListeners();
    debugLog("Panel E2 zainicjalizowany");
    const updateInterval = setInterval(() => {
      if (!document.contains(content)) {
        clearInterval(updateInterval);
        debugLog("Panel usunięty z DOM, czyszczę interwał");
        return;
      }
      if (isAnySelectOpen()) {
        return;
      }
      if (ensureE2APIExists()) {
        const apiStateTimestamp = window.MargonemAPI.e2.state.lastStateUpdate || 0;
        if (apiStateTimestamp > panelState.lastApiSync) {
          updatePanel();
        } else {
          updateStatusText();
          const characterItems = content.querySelectorAll(".character-item");
          panelState.characters.forEach((char, index) => {
            if (index < characterItems.length) {
              const timingInfo = characterItems[index].querySelector("div:last-child");
              if (timingInfo) {
                timingInfo.textContent = getCharacterTimingInfo(char, char.selectedBoss);
              }
            }
          });
        }
      }
    }, 1000);
    return new DraggablePanel("PanelE2", content, {
      x: 200,
      y: 120
    }, {
      isResizable: true,
      initialSize: {
        width: 350,
        height: 500
      },
      minSize: {
        width: 300,
        height: 400
      }
    });
  }
  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    heartbeatInterval = null;
    sessionToken = null;
  }
  function removeStoredLicense() {
    localStorage.removeItem("tm_license");
    localStorage.removeItem("tm_license_expiration");
    stopHeartbeat();
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    const licenseContent = document.getElementById("tm-license-content");
    if (licenseContent) {
      licenseContent.innerHTML = "";
    }
  }
  function registerLicense(licenseKey) {
    fetch(`${serverUrl}/cr3ocClJ0ICFP6T`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        licenseKey
      })
    }).then(response => response.json()).then(data => {
      const msgElem = document.getElementById("tm-license-message");
      if (!msgElem) {
        return;
      }
      if (data.success && data.expires) {
        msgElem.style.color = "green";
        msgElem.innerText = "Rejestracja udana, odśwież stronę";
        localStorage.setItem("tm_license", licenseKey);
        localStorage.setItem("tm_license_expiration", data.expires);
      } else if (data.message && data.message.indexOf("Licencja jest już zarejestrowana") !== -1) {
        msgElem.style.color = "orange";
        msgElem.innerText = "Licencja już zarejestrowana, odśwież stronę";
        localStorage.setItem("tm_license", licenseKey);
      } else {
        msgElem.style.color = "red";
        msgElem.innerText = "Błąd: " + data.message;
      }
    }).catch(err => {
      const msgElem = document.getElementById("tm-license-message");
      if (msgElem) {
        msgElem.style.color = "red";
        msgElem.innerText = "Błąd: " + err;
      }
    });
  }
  function initLicenseFlow() {
    return new Promise((resolve, reject) => {
      const _0xL0 = localStorage.getItem("tm_license");
      if (!_0xL0) {
        return resolve(false);
      }
      async function _0xA9(_0xQ1) {
        const _0xZ3 = new TextEncoder();
        const _0xR2 = _0xZ3.encode(_0xQ1);
        const _0xW4 = await crypto.subtle.digest("SHA-256", _0xR2);
        const _0xE7 = Array.from(new Uint8Array(_0xW4));
        return _0xE7.map(_0xX5 => _0xX5.toString(16).padStart(2, "0")).join("");
      }
      async function _0xC3(_0xM7) {
        function mYl8U() {
          const _0x12a = [83, 119, 64, 99, 63, 133, 111, 68, 135, 88, 46, 65, 97, 122, 70, 94, 113, 102, 118, 55, 128, 90, 62, 96, 113, 81, 49, 131, 91, 65, 123, 101];
          let _0x5b = "";
          for (let _0x1 = 0; _0x1 < _0x12a.length; _0x1++) {
            let _0x2 = _0x12a[_0x1];
            let _0xTmp = _0x2 + 7 - 20;
            _0x5b += String.fromCharCode(_0xTmp);
          }
          return _0x5b;
        }
        function kZq7R() {
          const _0x3b2 = [113, 92, 61, 126, 48, 63, 121, 87, 59, 98, 62, 129, 47, 46, 82, 53];
          let _0x9c = "";
          for (let _0x4 = 0; _0x4 < _0x3b2.length; _0x4++) {
            let _0xD1 = _0x3b2[_0x4];
            let _0xT = _0xD1 + 5 - 16;
            _0x9c += String.fromCharCode(_0xT);
          }
          return _0x9c;
        }
        const _0xK1 = mYl8U();
        const _0xI8 = kZq7R();
        const _0xEncrypted = Uint8Array.from(atob(_0xM7), _0xch => _0xch.charCodeAt(0));
        const _0xKeyData = new TextEncoder().encode(_0xK1);
        const _0xIvData = new TextEncoder().encode(_0xI8);
        const _0xCryptoKey = await crypto.subtle.importKey("raw", _0xKeyData, {
          name: "AES-CBC"
        }, false, ["decrypt"]);
        const _0xDecrypted = await crypto.subtle.decrypt({
          name: "AES-CBC",
          iv: _0xIvData
        }, _0xCryptoKey, _0xEncrypted);
        return new TextDecoder().decode(_0xDecrypted);
      }
      fetch(`${serverUrl}/CLymesuh3wXHibt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          licenseKey: _0xL0
        })
      }).then(response => response.json()).then(async _0xData => {
        if (_0xData.success) {
          if (_0xData.expires) {
            localStorage.setItem("tm_license_expiration", _0xData.expires);
          }
          if (!_0xData.script || !_0xData.checksum) {
            return resolve(false);
          }
          let _0xDecScript;
          try {
            _0xDecScript = await _0xC3(_0xData.script);
          } catch (_0xErr) {
            return resolve(false);
          }
          const _0xChk = await _0xA9(_0xDecScript);
          if (_0xChk !== _0xData.checksum) {
            return resolve(false);
          }
          eval(_0xDecScript);
          const {
            mapData,
            Expowiska
          } = await loadGameData();
          console.debug("Dane gry załadowane:", {
            mapMapCount: Object.keys(window.mapData).length,
            ExpowiskaCount: Object.keys(window.Expowiska).length,
            e2Count: Object.keys(window.e2).length
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
          await startSession(_0xL0);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return resolve(true);
        } else {
          return resolve(false);
        }
      }).catch(_0xEx => {
        return resolve(false);
      });
    });
  }
  function initializeCombatTimer() {
    setInterval(() => {
      const state = window.MargonemAPI.state;
      if (state.autoFightActive && state.fightEndTime) {
        const remaining = state.fightEndTime - Date.now();
        if (remaining <= 0) {
          window.MargonemAPI.combat.stopFight();
        }
      }
    }, 1000);
  }
  function initialize() {
    try {
      const testDiv = document.createElement("div");
      document.body.appendChild(testDiv);
      testDiv.remove();
    } catch (error) {
      return;
    }
    const existingButtons = document.querySelectorAll(".widget-button.bot-panel");
    if (existingButtons.length > 0) {
      return;
    }
    function isGameReady() {
      return window.Engine && window.Engine.hero && window.Engine.map && document.querySelector(".top-right.main-buttons-container");
    }
    let allPanels = [];
    function initializeUI() {
      if (!isGameReady()) {
        setTimeout(initializeUI, 500);
        return;
      }
      try {
        const panels = [createExpowiskaPanel(), createE2Panel()];
        allPanels = panels.filter(panel => panel && typeof panel.minimize === "function");
        allPanels.forEach(panel => {
          if (panel && typeof panel.minimize === "function") {
            panel.minimize();
          }
        });
        createControlPanel();
        initializeCombatTimer();
        setInterval(() => {
          allPanels.forEach(panel => {
            if (panel && typeof panel.checkAndRestoreInterfaceButton === "function") {
              panel.checkAndRestoreInterfaceButton();
            }
          });
        }, 5000);
      } catch (error) {
        if (existingButtons.length > 0) {
          return;
        }
        // let panel = openLicensePanel();
        allPanels = [panel];
        panel.minimize();
        setInterval(() => {
          allPanels.forEach(panel => {
            if (panel && typeof panel.checkAndRestoreInterfaceButton === "function") {
              panel.checkAndRestoreInterfaceButton();
            }
          });
        }, 5000);
      }
    }
    setTimeout(initializeUI, 500);
  }
  async function loadGameData() {
    try {
      console.debug("Rozpoczęcie ładowania danych gry...");
      const MAPDATA_KEY = "tm_mapdata";
      const EXPOWISKA_KEY = "tm_expowiska";
      const E2_KEY = "tm_e2";
      const CHECKSUM_KEY = "tm_data_checksum";
      const storedMapData = localStorage.getItem(MAPDATA_KEY);
      const storedExpowiska = localStorage.getItem(EXPOWISKA_KEY);
      const storedE2 = localStorage.getItem(E2_KEY);
      const storedChecksum = localStorage.getItem(CHECKSUM_KEY);
      let fetchNewData = true;
      if (storedMapData && storedExpowiska && storedE2 && storedChecksum) {
        console.debug("Znaleziono dane w localStorage, sprawdzam checksum...");
        const response = await fetch(`${serverUrl}/verifyDataChecksum`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            checksum: storedChecksum
          })
        });
        const checksumData = await response.json();
        if (checksumData.valid) {
          console.debug("Checksum zgodny, używam danych z localStorage");
          fetchNewData = false;
          const mapData = JSON.parse(storedMapData);
          const Expowiska = JSON.parse(storedExpowiska);
          window.e2 = JSON.parse(storedE2);
          window.mapData = mapData;
          window.Expowiska = Expowiska;
          console.debug("Dane załadowane z localStorage");
          return {
            mapData,
            Expowiska,
            e2: window.e2
          };
        } else {
          console.debug("Checksum niezgodny, pobieram nowe dane");
        }
      } else {
        console.debug("Brak danych w localStorage, pobieram nowe dane");
      }
      if (fetchNewData) {
        console.debug("Wysyłanie żądania do serwera o dane gry");
        const response = await fetch(`${serverUrl}/gameData`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json"
          }
        });
        const gameData = await response.json();
        if (!gameData.mapData || !gameData.Expowiska || !gameData.e2) {
          throw new Error("Niepełne dane otrzymane z serwera");
        }
        localStorage.setItem(MAPDATA_KEY, JSON.stringify(gameData.mapData));
        localStorage.setItem(EXPOWISKA_KEY, JSON.stringify(gameData.Expowiska));
        localStorage.setItem(E2_KEY, JSON.stringify(gameData.e2));
        if (gameData.checksum) {
          localStorage.setItem(CHECKSUM_KEY, gameData.checksum);
        }
        const mapData = gameData.mapData;
        const Expowiska = gameData.Expowiska;
        window.e2 = gameData.e2;
        window.mapData = mapData;
        window.Expowiska = Expowiska;
        console.debug("Nowe dane zapisane w localStorage i załadowane");
        return {
          mapData,
          Expowiska,
          e2: window.e2
        };
      }
    } catch (error) {
      console.error("Błąd podczas ładowania danych gry:", error);
      try {
        const storedMapData = localStorage.getItem("tm_mapdata");
        const storedExpowiska = localStorage.getItem("tm_expowiska");
        const storedE2 = localStorage.getItem("tm_e2");
        if (storedMapData && storedExpowiska && storedE2) {
          console.debug("Używam danych z localStorage jako awaryjne rozwiązanie");
          const mapData = JSON.parse(storedMapData);
          const Expowiska = JSON.parse(storedExpowiska);
          window.e2 = JSON.parse(storedE2);
          window.mapData = mapData;
          window.Expowiska = Expowiska;
          return {
            mapData,
            Expowiska,
            e2: window.e2
          };
        }
      } catch (fallbackError) {
        console.error("Błąd podczas próby załadowania awaryjnych danych:", fallbackError);
      }
      console.warn("Nie udało się załadować danych, używam pustych obiektów");
      return {
        mapData: {},
        Expowiska: {},
        e2: {}
      };
    }
  }
  startSilentMapCrawler();
  async function main() {
    try {
      const licenseSuccess = true; // Bypassed License Flow
      setTimeout(async () => {
        if (window.MargonemAPI && window.MargonemAPI.e2) {
          // console.log("[E2 API] Inicjalizacja systemu E2");
          const resumed = await window.MargonemAPI.e2.resumeFromSavedState();
          if (!resumed) {
            window.MargonemAPI.e2.initializeCharacters();
            // console.log("[E2 API] Zainicjalizowano system E2");
          }
        }
      }, 2000);
      window.MargonemAPI.heroPositionMonitor.init();
      initialize();
      function initializeE2Panel(retryCount = 0, maxRetries = 5) {
        // console.log(`[E2] Próba inicjalizacji panelu (${retryCount + 1}/${maxRetries + 1})`);
        if (window.e2Panel) {
          // console.log("[E2] Panel już istnieje, aktualizuję");
          window.e2Panel.remove();
          window.e2Panel = null;
        }
        const apiAvailable = Boolean(window.MargonemAPI && window.MargonemAPI.e2);
        const e2DataAvailable = Boolean(window.e2 && Object.keys(window.e2).length > 0);
        const panelClassAvailable = typeof DraggablePanel === "function";
        if (!apiAvailable || !e2DataAvailable || !panelClassAvailable) {
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000;
            console.warn(`[E2] Brak wymaganych obiektów, kolejna próba za ${delay / 1000}s...`);
            console.warn(`[E2] API: ${apiAvailable}, E2 Data: ${e2DataAvailable}, DraggablePanel: ${panelClassAvailable}`);
            setTimeout(() => {
              initializeE2Panel(retryCount + 1, maxRetries);
            }, delay);
            return false;
          } else {
            console.error("[E2] Nie udało się zainicjalizować panelu po wszystkich próbach!");
            return false;
          }
        }
        try {
          window.e2Panel = createE2Panel();
          // console.log("[E2] Panel zainicjalizowany pomyślnie");
          return true;
        } catch (error) {
          console.error("[E2] Błąd podczas tworzenia panelu:", error);
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000;
            console.warn(`[E2] Ponowna próba za ${delay / 1000}s...`);
            setTimeout(() => {
              initializeE2Panel(retryCount + 1, maxRetries);
            }, delay);
          }
          return false;
        }
      }
      let panelInitInterval = setInterval(() => {
        try {
          if (window.MargonemAPI && window.MargonemAPI.e2 && window.e2) {
            // console.log("[E2] Wykryto API E2, inicjalizacja panelu...");
            const success = initializeE2Panel();
            if (success) {
              clearInterval(panelInitInterval);
            }
          }
        } catch (error) {
          console.error("[E2] Błąd podczas sprawdzania API:", error);
        }
      }, 3000);
      setTimeout(() => {
        if (panelInitInterval) {
          clearInterval(panelInitInterval);
          console.warn("[E2] Przekroczono limit czasu oczekiwania na inicjalizację panelu");
        }
      }, 120000);
    } catch (err) {
      console.error("Błąd w funkcji main:", err);
      initialize();
    }
  }
  main();
  (function () {
    'use strict';

    const LAST_UPDATE_KEY = "margonem_news_last_update";
    const WINDOW_CLOSED_KEY = "margonem_news_window_closed";
    const LAST_DISPLAY_KEY = "margonem_news_last_display";
    const NEWS_CONTAINER_ID = "margonem-news-container";
    function saveToLocalStorage(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.error("Błąd zapisywania do localStorage:", error);
      }
    }
    function getFromLocalStorage(key, defaultValue = null) {
      try {
        const value = localStorage.getItem(key);
        if (value) {
          return JSON.parse(value);
        } else {
          return defaultValue;
        }
      } catch (error) {
        console.error("Błąd odczytywania z localStorage:", error);
        return defaultValue;
      }
    }
    function isDateNewer(newDate, oldDate) {
      if (!oldDate) {
        return true;
      }
      function parseDate(dateStr) {
        if (typeof dateStr === "number") {
          return dateStr;
        }
        const parts = dateStr.split(".");
        if (parts.length === 3) {
          return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
        }
        return 0;
      }
      return parseDate(newDate) > parseDate(oldDate);
    }
    function hasOneDayPassed(lastDisplayTimestamp) {
      if (!lastDisplayTimestamp) {
        return true;
      }
      const now = Date.now();
      const oneDayInMs = 86400000;
      return now - lastDisplayTimestamp >= oneDayInMs;
    }
    function newsWindowExists() {
      return document.getElementById(NEWS_CONTAINER_ID) !== null;
    }
    function getExistingNewsWindow() {
      return document.getElementById(NEWS_CONTAINER_ID);
    }
    function createNewsWindow() {
      const existingWindow = getExistingNewsWindow();
      if (existingWindow) {
        return existingWindow;
      }
      const styles = `
            #${NEWS_CONTAINER_ID} {
                position: fixed;
                top: 50px;
                left: 50px;
                width: 400px;
                min-height: 300px;
                max-height: 80vh;
                background-color: #2b2116;
                border: 3px solid #8b6f4e;
                border-radius: 5px;
                color: #e0d2ba;
                font-family: 'Trebuchet MS', Arial, sans-serif;
                box-shadow: 0 0 15px rgba(0, 0, 0, 0.7);
                z-index: 10000;
                resize: both;
                overflow: hidden;
                padding-bottom: 10px;
                display: flex;
                flex-direction: column;
            }

            #margonem-news-header {
                background: linear-gradient(to bottom, #8b6f4e, #6d563c);
                padding: 8px;
                cursor: move;
                font-weight: bold;
                text-align: center;
                border-bottom: 2px solid #5d472c;
                display: flex;
                justify-content: space-between;
                align-items: center;
                user-select: none;
            }

            #margonem-news-title {
                margin: 0;
                text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
                flex-grow: 1;
                font-size: 16px;
            }

            #margonem-news-close {
                background-color: #6d563c;
                color: #e0d2ba;
                border: 1px solid #8b6f4e;
                border-radius: 3px;
                width: 20px;
                height: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                font-weight: bold;
                text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.8);
            }

            #margonem-news-close:hover {
                background-color: #8b6f4e;
            }

            #news-section {
                padding: 10px;
                overflow-y: auto;
                flex: 1;
                border-bottom: 2px solid #5d472c;
            }

            #referral-section {
                padding: 10px;
                background-color: #3a2e20;
            }

            .section-title {
                color: #ffcc80;
                margin-top: 0;
                margin-bottom: 10px;
                text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.5);
                font-size: 16px;
                text-align: center;
                padding-bottom: 5px;
                border-bottom: 1px dashed #5d472c;
            }

            .news-item {
                margin-bottom: 15px;
            }

            .news-item h3 {
                color: #ffcc80;
                margin-top: 0;
                margin-bottom: 5px;
                text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.5);
            }

            .news-item p {
                margin: 5px 0;
                line-height: 1.4;
            }

            .news-date {
                font-size: 12px;
                color: #aa9977;
                font-style: italic;
                margin-top: 5px;
            }

            .referral-content {
                font-size: 14px;
                line-height: 1.5;
            }

            .referral-highlight {
                color: #ffcc80;
                font-weight: bold;
            }

            .referral-benefits {
                margin: 10px 0;
                padding: 0;
                list-style-type: none;
            }

            .referral-benefits li {
                margin-bottom: 5px;
                padding-left: 20px;
                position: relative;
            }

            .referral-benefits li:before {
                content: "→";
                position: absolute;
                left: 0;
                color: #ffcc80;
            }

            .cta-button {
                display: block;
                text-align: center;
                margin-top: 15px;
                color: #000000;
                background: linear-gradient(to bottom, #ffcc80, #ffb347);
                text-decoration: none;
                font-weight: bold;
                padding: 8px 5px;
                border: 1px solid #5d472c;
                border-radius: 3px;
                width: 90%;
                margin-left: auto;
                margin-right: auto;
                text-shadow: 0px 1px 1px rgba(255, 255, 255, 0.5);
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
                transition: all 0.2s ease;
            }

            .cta-button:hover {
                background: linear-gradient(to bottom, #ffd699, #ffcc80);
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
            }

            .website-link {
                display: block;
                text-align: center;
                margin-top: 15px;
                color: #ffcc80;
                text-decoration: none;
                font-weight: bold;
                padding: 5px;
                background-color: #3d321e;
                border: 1px solid #5d472c;
                border-radius: 3px;
                width: 80%;
                margin-left: auto;
                margin-right: auto;
            }

            .website-link:hover {
                background-color: #4d422e;
                text-decoration: underline;
            }
        `;
      if (!document.getElementById("nexosbot-news-styles")) {
        const styleElement = document.createElement("style");
        styleElement.id = "nexosbot-news-styles";
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);
      }
      const newsContainer = document.createElement("div");
      newsContainer.id = NEWS_CONTAINER_ID;
      const header = document.createElement("div");
      header.id = "margonem-news-header";
      const title = document.createElement("div");
      title.id = "margonem-news-title";
      title.textContent = "Aktualności i Polecenia";
      const closeButton = document.createElement("div");
      closeButton.id = "margonem-news-close";
      closeButton.textContent = "✕";
      closeButton.onclick = function () {
        newsContainer.style.display = "none";
        saveToLocalStorage(WINDOW_CLOSED_KEY, true);
        saveToLocalStorage(LAST_DISPLAY_KEY, Date.now());
      };
      header.appendChild(title);
      header.appendChild(closeButton);
      const newsSection = document.createElement("div");
      newsSection.id = "news-section";
      const newsSectionTitle = document.createElement("h2");
      newsSectionTitle.className = "section-title";
      newsSectionTitle.textContent = "Najnowsza aktualizacja";
      newsSection.appendChild(newsSectionTitle);
      const referralSection = document.createElement("div");
      referralSection.id = "referral-section";
      const referralTitle = document.createElement("h2");
      referralTitle.className = "section-title";
      referralTitle.textContent = "Program Poleceń";
      const referralContent = document.createElement("div");
      referralContent.className = "referral-content";
      referralContent.innerHTML = `
            <p><span class="referral-highlight">Zarabiaj, polecając NexosBota znajomym!</span> Każda osoba, która kupi licencję z Twojego polecenia, to <span class="referral-highlight">10 zł zniżki</span> na Twój abonament.</p>

            <ul class="referral-benefits">
                <li>Za każde polecenie otrzymujesz 10 zł rabatu na kolejne odnowienia</li>
                <li>Poleć 3 osoby i zyskaj <span class="referral-highlight">miesiąc korzystania ZA DARMO!</span></li>
                <li>Możesz też sprzedać tak uzyskaną licencję i <span class="referral-highlight">zarobić PRAWDZIWE PIENIĄDZE!</span></li>
                <li>Brak limitu zniżek - im więcej poleceń, tym dłużej korzystasz bez opłat</li>
                <li>Program działa bezterminowo - zniżki sumują się miesiąc do miesiąca</li>
            </ul>

            <a href="https://nexosbot.com/system_polecen" class="cta-button">ZDOBĄDŹ SWÓJ LINK POLECAJĄCY</a>
        `;
      referralSection.appendChild(referralTitle);
      referralSection.appendChild(referralContent);
      newsContainer.appendChild(header);
      newsContainer.appendChild(newsSection);
      newsContainer.appendChild(referralSection);
      document.body.appendChild(newsContainer);
      function dragElement(elmnt) {
        let pos1 = 0;
        let pos2 = 0;
        let pos3 = 0;
        let pos4 = 0;
        header.onmousedown = dragMouseDown;
        function dragMouseDown(e) {
          e = e || window.event;
          e.preventDefault();
          pos3 = e.clientX;
          pos4 = e.clientY;
          document.onmouseup = closeDragElement;
          document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
          e = e || window.event;
          e.preventDefault();
          pos1 = pos3 - e.clientX;
          pos2 = pos4 - e.clientY;
          pos3 = e.clientX;
          pos4 = e.clientY;
          elmnt.style.top = elmnt.offsetTop - pos2 + "px";
          elmnt.style.left = elmnt.offsetLeft - pos1 + "px";
        }
        function closeDragElement() {
          document.onmouseup = null;
          document.onmousemove = null;
        }
      }
      dragElement(newsContainer);
      return newsContainer;
    }
    function updateNewsContent(container, newsItem) {
      const newsSection = container.querySelector("#news-section");
      if (!newsSection) {
        console.error("Nie znaleziono sekcji wiadomości w kontenerze:", container);
        return;
      }
      const sectionTitle = newsSection.querySelector(".section-title");
      newsSection.innerHTML = "";
      if (sectionTitle) {
        newsSection.appendChild(sectionTitle);
      } else {
        const newSectionTitle = document.createElement("h2");
        newSectionTitle.className = "section-title";
        newSectionTitle.textContent = "Najnowsza aktualizacja";
        newsSection.appendChild(newSectionTitle);
      }
      if (newsItem && newsItem.length > 0) {
        const item = newsItem[0];
        const newsItemDiv = document.createElement("div");
        newsItemDiv.className = "news-item";
        const newsTitle = document.createElement("h3");
        newsTitle.textContent = item.title;
        const newsText = document.createElement("p");
        newsText.textContent = item.text;
        const newsDate = document.createElement("div");
        newsDate.className = "news-date";
        newsDate.textContent = item.date;
        newsItemDiv.appendChild(newsTitle);
        newsItemDiv.appendChild(newsText);
        newsItemDiv.appendChild(newsDate);
        newsSection.appendChild(newsItemDiv);
      } else {
        const noNews = document.createElement("p");
        noNews.textContent = "Brak nowych aktualizacji.";
        noNews.style.textAlign = "center";
        noNews.style.fontStyle = "italic";
        newsSection.appendChild(noNews);
      }
    }
    async function loadNewsFromServer() {
      try {
        const lastSavedUpdate = getFromLocalStorage(LAST_UPDATE_KEY);
        const wasWindowClosed = getFromLocalStorage(WINDOW_CLOSED_KEY, false);
        const lastDisplayTime = getFromLocalStorage(LAST_DISPLAY_KEY);
        let serverResponse;
        try {
          const response = await fetch("https://nexosbot.com/api/updates");
          if (!response.ok) {
            throw new Error(`Status HTTP: ${response.status}`);
          }
          serverResponse = await response.json();
        } catch (apiError) {
          console.error("Błąd pobierania danych z API:", apiError);
          serverResponse = {
            lastUpdate: new Date().toLocaleDateString("pl-PL"),
            news: [{
              title: "Aktualizacja NexosBot",
              text: "Nie udało się pobrać najnowszych aktualności. Spróbuj ponownie później lub sprawdź stronę nexosbot.com.",
              date: new Date().toLocaleDateString("pl-PL")
            }]
          };
        }
        let newsContainer;
        if (newsWindowExists()) {
          newsContainer = getExistingNewsWindow();
        } else {
          newsContainer = createNewsWindow();
        }
        updateNewsContent(newsContainer, serverResponse.news);
        const hasNewUpdate = isDateNewer(serverResponse.lastUpdate, lastSavedUpdate);
        const dayHasPassed = hasOneDayPassed(lastDisplayTime);
        if (!wasWindowClosed) {
          newsContainer.style.display = "block";
        } else if (hasNewUpdate || dayHasPassed) {
          newsContainer.style.display = "block";
          saveToLocalStorage(WINDOW_CLOSED_KEY, false);
        } else {
          newsContainer.style.display = "none";
        }
        saveToLocalStorage(LAST_UPDATE_KEY, serverResponse.lastUpdate);
      } catch (error) {
        console.error("Błąd ładowania aktualności:", error);
      }
    }
    function initialize() {
      if (window.nexosBotNewsInitialized) {
        return;
      }
      window.nexosBotNewsInitialized = true;
      // loadNewsFromServer();
      // setInterval(loadNewsFromServer, 300000);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  })();
})();
