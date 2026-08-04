/*:
 * @target MZ
 * @plugindesc Seamless map transfer system for Bologna OSM grid (data/bologna/r{row}_c{col}.json)
 * @author Omni-Lex
 *
 * @help
 * BolognaMapSystem
 * ================
 * Loads Bologna OSM tile maps from data/bologna/ and enables seamless
 * border transitions between adjacent cells.
 *
 * Map grid: rows 3-16, cols 2-10 (256x256 tiles each, tilesetId 102).
 * Map slot: 353 (placeholder shell - tile data is replaced at runtime).
 *
 * Plugin Commands
 * ---------------
 * goBologna row col  -- Teleport the player to the centre of that cell.
 *
 * @command goBologna
 * @text Go to Bologna Cell
 * @desc Teleport the player to a specific Bologna grid cell.
 *
 * @arg row
 * @type number
 * @min 3
 * @max 16
 * @default 9
 * @text Row
 * @desc Bologna grid row (3-16)
 *
 * @arg col
 * @type number
 * @min 2
 * @max 10
 * @default 6
 * @text Column
 * @desc Bologna grid column (2-10)
 */

(() => {
  "use strict";

  const pluginName    = "BolognaMapSystem";
  const BOLOGNA_MAP_ID = 353;
  const ROW_MIN = 3, ROW_MAX = 16;
  const COL_MIN = 2, COL_MAX = 10;
  const MAP_W = 256, MAP_H = 256;
  const TILESET_ID = 102;

  // ===== CELL INDEX =====
  // Maps "rN_cM" -> full filename (e.g. "r7_c6_piazza_delle_medaglie_d_oro.json")
  // Built once at startup from the filesystem via Node/NW.js.

  const _cellIndex = (() => {
    try {
      const path = require("path");
      const fs   = require("fs");
      const dir  = path.join(process.cwd(), "data", "bologna");
      const idx  = {};
      fs.readdirSync(dir).forEach(f => {
        const m = f.match(/^(r\d+_c\d+)/);
        if (m && f.endsWith(".json")) idx[m[1]] = f;
      });
      return idx;
    } catch (e) {
      console.warn("[Bologna] Could not build cell index:", e.message);
      return {};
    }
  })();

  // Derive a human-readable location name from a JSON displayName field.
  // JSON files store e.g. "OSM r7 c6 Piazza delle Medaglie d'Oro".
  // Strip the "OSM rN cM " prefix to get just the street/square name.
  function cellDisplayName(rawDisplayName) {
    if (!rawDisplayName) return "";
    return rawDisplayName.replace(/^OSM\s+r\d+\s+c\d+\s*/i, "").trim();
  }

  // ===== STATE =====
  // Only the current cell's (row, col) is persisted in $gameSystem. The cell's
  // tile JSON (hundreds of KB) and the transient border-transfer intent are held
  // in module-level runtime state so they never bloat the serialized save.
  // On load the cell is re-read from disk from the persisted row/col.

  let _runtimeMapData  = null; // full cell JSON for the map currently in slot 353
  let _pendingTransfer = null; // { row, col, spawnX, spawnY, dir } during a fade

  function getState() {
    if (!$gameSystem._bologna) {
      $gameSystem._bologna = { row: null, col: null };
    }
    const s = $gameSystem._bologna;
    // Migrate legacy saves that stored the heavy fields inline: hoist any saved
    // cell data into the runtime cache and strip both from $gameSystem so the
    // next save is lean.
    if (s.mapData) {
      if (!_runtimeMapData) _runtimeMapData = s.mapData;
      delete s.mapData;
    }
    if (s._pendingTransfer) {
      if (!_pendingTransfer) _pendingTransfer = s._pendingTransfer;
      delete s._pendingTransfer;
    }
    return s;
  }

  function getMapData() { return _runtimeMapData; }
  function setMapData(mapObj) { _runtimeMapData = mapObj; }

  // Synchronous cell read from disk (NW.js/fs), used on the load path to rebuild
  // the runtime cache from the persisted row/col without re-serializing tile data.
  function readCellSync(row, col) {
    const key      = `r${row}_c${col}`;
    const filename = _cellIndex[key];
    if (!filename) return null;
    try {
      const path = require("path");
      const fs   = require("fs");
      const file = path.join(process.cwd(), "data", "bologna", filename);
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.warn(`[Bologna] readCellSync ${key} failed: ${e.message}`);
      return null;
    }
  }

  function isBolognaMap() {
    return $gameMap.mapId() === BOLOGNA_MAP_ID;
  }

  // ===== CELL LOADER =====

  function fetchCell(row, col) {
    const key      = `r${row}_c${col}`;
    const filename = _cellIndex[key];
    if (!filename) {
      return Promise.reject(new Error(`Bologna ${key} not found in cell index`));  // i18n-ignore  developer diagnostic
    }
    return fetch(`data/bologna/${filename}`)
      .then(r => {
        if (!r.ok) throw new Error(`Bologna ${filename} not found (${r.status})`);
        return r.json();
      });
  }

  // ===== DATA MANAGER OVERRIDE =====
  // Synchronously replaces $dataMap with the stored Bologna cell data so the
  // scene load chain never waits for a Map353.json fetch.

  const _DataManager_loadMapData = DataManager.loadMapData;
  DataManager.loadMapData = function (mapId) {
    if (mapId !== BOLOGNA_MAP_ID) {
      _DataManager_loadMapData.call(this, mapId);
      return;
    }
    const state = getState();
    let mapData = getMapData();
    // After a save/load the runtime cache is empty; rebuild it from disk using
    // the persisted row/col so the tile data never had to live in the save.
    if (!mapData && state && state.row != null && state.col != null) {
      mapData = readCellSync(state.row, state.col);
      if (mapData) setMapData(mapData);
    }
    if (!mapData) {
      // No cell data ready - fall back to the placeholder file
      _DataManager_loadMapData.call(this, mapId);
      return;
    }
    // Set $dataMap synchronously so DataManager.isMapLoaded() returns true immediately.
    // Shallow-copy so RPG Maker can mutate meta etc. without corrupting the cache.
    $dataMap = Object.assign({}, mapData);
    DataManager.onLoad($dataMap);
  };

  // ===== TILESET OVERRIDE =====

  const _Game_Map_tileset = Game_Map.prototype.tileset;
  Game_Map.prototype.tileset = function () {
    if (isBolognaMap() && $dataTilesets[TILESET_ID]) {
      return $dataTilesets[TILESET_ID];
    }
    return _Game_Map_tileset.call(this);
  };

  // ===== BORDER DETECTION =====

  // Compute spawn position on the opposite edge of the destination cell.
  function oppositeEdgePos(exitDir, playerX, playerY) {
    let x = playerX;
    let y = playerY;
    switch (exitDir) {
      case 2: y = 1;          break; // exited south -> near north
      case 4: x = MAP_W - 2;  break; // exited west  -> near east
      case 6: x = 1;          break; // exited east  -> near west
      case 8: y = MAP_H - 2;  break; // exited north -> near south
    }
    return {
      x: Math.max(1, Math.min(x, MAP_W - 2)),
      y: Math.max(1, Math.min(y, MAP_H - 2)),
    };
  }

  const _Game_Player_moveStraight = Game_Player.prototype.moveStraight;
  Game_Player.prototype.moveStraight = function (d) {
    if (!isBolognaMap()) {
      _Game_Player_moveStraight.call(this, d);
      return;
    }

    const x = this.x;
    const y = this.y;
    let exitDir = 0;

    if (d === 2 && y + 1 >= MAP_H) exitDir = 2;
    else if (d === 4 && x - 1 < 0)  exitDir = 4;
    else if (d === 6 && x + 1 >= MAP_W) exitDir = 6;
    else if (d === 8 && y - 1 < 0)  exitDir = 8;

    if (!exitDir) {
      _Game_Player_moveStraight.call(this, d);
      return;
    }

    const state = getState();
    let nextRow = state.row;
    let nextCol = state.col;

    if (exitDir === 2) nextRow += 1;
    else if (exitDir === 4) nextCol -= 1;
    else if (exitDir === 6) nextCol += 1;
    else if (exitDir === 8) nextRow -= 1;

    // Hard boundary - block movement at grid edge
    if (nextRow < ROW_MIN || nextRow > ROW_MAX || nextCol < COL_MIN || nextCol > COL_MAX) {
      return;
    }

    const spawn = oppositeEdgePos(exitDir, x, y);

    $gameScreen.startFadeOut(12);

    // Store for the fade-complete trigger (runtime-only, not persisted)
    _pendingTransfer = { row: nextRow, col: nextCol, spawnX: spawn.x, spawnY: spawn.y, dir: exitDir };
  };

  // ===== SCREEN UPDATE HOOK =====
  // Fires the deferred transfer once the screen is fully black.

  const _Game_Screen_update = Game_Screen.prototype.update;
  Game_Screen.prototype.update = function () {
    _Game_Screen_update.call(this);

    if (!_pendingTransfer) return;
    if (this._brightness > 0) return;

    const pending = _pendingTransfer;
    _pendingTransfer = null;

    setTimeout(() => {
      fetchCell(pending.row, pending.col)
        .then(mapObj => {
          const state = getState();
          state.row     = pending.row;
          state.col     = pending.col;
          setMapData(mapObj);
          $gamePlayer.reserveTransfer(BOLOGNA_MAP_ID, pending.spawnX, pending.spawnY, pending.dir, 0);
        })
        .catch(err => {
          console.warn(`[Bologna] border transfer failed: ${err.message}`);
          $gameScreen.startFadeIn(15);
        });
    }, 13);
  };

  // ===== SCENE MAP HOOK =====
  // Re-injects map data and refreshes the tilemap after the scene loads.

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    // Resolve the map we are ABOUT to be on, not the one we are leaving. During a
    // transfer, $gameMap.mapId() still returns the departure map until
    // performTransfer() runs (inside _Scene_Map_onMapLoaded below). Testing the
    // departure id here made a transfer OUT of Bologna (353 -> e.g. 315) clobber
    // the destination's freshly-loaded $dataMap with the cached Bologna cell
    // (tilesetId 102, 256x256), so the world map rendered with the Bologna
    // tileset. Match the post-transfer guard further down by using the target id.
    const targetMapId = this._transfer ? $gamePlayer.newMapId() : $gameMap.mapId();
    if (targetMapId === BOLOGNA_MAP_ID) {
      getState();
      const mapData = getMapData();
      if (mapData && $dataMap) {
        $dataMap.data        = mapData.data;
        $dataMap.width       = MAP_W;
        $dataMap.height      = MAP_H;
        $dataMap.tilesetId   = TILESET_ID;
        // Set clean location name so MapLevelDisplay picks it up
        $dataMap.displayName = cellDisplayName(mapData.displayName);
      }
    }

    _Scene_Map_onMapLoaded.call(this);

    if ($gameMap.mapId() !== BOLOGNA_MAP_ID) return;

    // Refresh tileset bitmap
    if (this._tilemap) {
      const ts = $dataTilesets[TILESET_ID];
      if (ts) {
        this._tilemap.setTileBitmap(0, ImageManager.loadTileset(ts.name));
        this._tilemap.refresh();
      }
    }

    setTimeout(() => $gameScreen.startFadeIn(12), 80);
  };

  // ===== TELEPORT =====
  // Load the requested cell and warp the player into it. spawnX/spawnY are in
  // tile coordinates within the 256x256 cell; when omitted the player lands in
  // the centre. Returns true if the (row,col) is in range and the warp started.

  function teleportToCell(row, col, spawnX, spawnY) {
    row = Number(row);
    col = Number(col);

    if (isNaN(row) || isNaN(col) ||
        row < ROW_MIN || row > ROW_MAX ||
        col < COL_MIN || col > COL_MAX) {
      console.warn(`[Bologna] teleportToCell: (${row},${col}) out of range [${ROW_MIN}-${ROW_MAX}][${COL_MIN}-${COL_MAX}]`);
      return false;
    }

    const sx = (spawnX == null || isNaN(spawnX))
      ? Math.floor(MAP_W / 2)
      : Math.max(1, Math.min(MAP_W - 2, Math.round(spawnX)));
    const sy = (spawnY == null || isNaN(spawnY))
      ? Math.floor(MAP_H / 2)
      : Math.max(1, Math.min(MAP_H - 2, Math.round(spawnY)));

    $gameScreen.startFadeOut(12);

    fetchCell(row, col)
      .then(mapObj => {
        const state = getState();
        state.row     = row;
        state.col     = col;
        setMapData(mapObj);
        $gamePlayer.reserveTransfer(BOLOGNA_MAP_ID, sx, sy, $gamePlayer.direction(), 0);
      })
      .catch(err => {
        console.warn(`[Bologna] teleportToCell failed: ${err.message}`);
        $gameScreen.startFadeIn(15);
      });

    return true;
  }

  // ===== PLUGIN COMMAND =====

  PluginManager.registerCommand(pluginName, "goBologna", (args) => {
    teleportToCell(Number(args.row), Number(args.col));
  });

  // ===== PUBLIC API =====

  window.BolognaMapSystem = {
    BOLOGNA_MAP_ID,
    ROW_MIN, ROW_MAX, COL_MIN, COL_MAX,
    MAP_W, MAP_H,
    getState,
    teleportToCell,
  };
})();
