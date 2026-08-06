/*:
 * @plugindesc v3.6 High-performance fog of war system with vision cones and smooth transitions (Optimized, Persistent, Configurable).
 * @author Omni-Lex (Modified)
 * 
 * @param Vision Angle
 * @desc Default vision angle for the player in degrees (360 for full circle)
 * @default 120
 * @type number
 * @min 1
 * @max 360
 * 
 * @param Exempt Event Names
 * @desc Events with these names will always be visible (comma-separated)
 * @default NPC,Chest,Trigger
 * @type text
 * 
 * @param Vision Blocking Event Names
 * @desc Events with these names will block vision (comma-separated)
 * @default Wall,Pillar,Column,Obstacle
 * @type text
 * 
 * @param Update Frequency
 * @desc How often to update fog of war (1 = every frame, 2 = every other frame, etc.)
 * @default 3
 * @type number
 * @min 1
 * 
 * @param Ray Count
 * @desc Number of rays to cast for vision (higher = more accurate but slower)
 * @default 60
 * @type number
 * @min 10
 * @max 360
 * 
 * @param Reset On New Game
 * @desc Reset fog of war data when starting a new game
 * @default true
 * @type boolean
 * 
 * @param Chunk Size
 * @desc Size of each fog of war rendering chunk in tiles (smaller = more responsive, larger = better performance)
 * @default 8
 * @type number
 * @min 4
 * @max 32
 * 
 * @param Never Seen Color
 * @desc Color for tiles never seen (CSS format)
 * @default #000000
 * @type string
 * 
 * @param Previously Seen Color
 * @desc Color for tiles seen before but not currently visible (CSS format)
 * @default rgba(0,0,0,0.6)
 * @type string
 * 
 * @param Vision Smoothing
 * @desc How smoothly vision follows the player (0-1, higher is smoother)
 * @default 0.5
 * @type number
 * @decimals 2
 * @min 0.1
 * @max 1.0
 * 
 * @param Transition Duration
 * @desc Duration of transition between visible and previously seen (in frames)
 * @default 15
 * @type number
 * @min 1
 * @max 120
 * 
 * @param Edge Feathering
 * @desc How much to soften the edges of visible area (0-1, higher is softer)
 * @default 0.3
 * @type number
 * @decimals 2
 * @min 0
 * @max 1
 * 
 * @param Add To Options Menu
 * @desc Add Fog of War toggle to options menu
 * @default true
 * @type boolean
 * 
 * @param Options Menu Text
 * @desc Text to display in the options menu
 * @default Fog of War
 * @type string
 * 
 * @command toggleFogOfWar
 * @text Toggle Fog of War
 * @desc Enables or disables the fog of war system
 * 
 * @param enable
 * @text Enable
 * @desc Enable or disable fog of war
 * @type boolean
 * @default true
 * 
 * @command resetFogOfWar
 * @text Reset Fog of War
 * @desc Resets fog of war data for the current map or all maps
 * 
 * @param target
 * @text Target
 * @desc Reset current map or all maps
 * @type select
 * @option Current Map
 * @value current
 * @option All Maps
 * @value all
 * @default current
 * 
 * @param Reveal Transition Duration
 * @desc Duration of transition when revealing tiles (in frames). Lower values = faster transition.
 * @default 10
 * @type number
 * @min 1
 * @max 60
 * 
 * @command revealEntireMap
 * @text Reveal Entire Map
 * @desc Reveals the entire current map
 *
 * @command disableFogForMap
 * @text Disable Fog For Map
 * @desc Disables (or re-enables) fog of war for the current map only
 *
 * @param disable
 * @text Disable
 * @desc Disable fog of war for this map
 * @type boolean
 * @default true
 */

(function () {
    'use strict';

    const pluginName = "FOG_OF_WAR";
    const parameters = PluginManager.parameters(pluginName);

    // Constants & Configuration
    const DEFAULT_VISION_RANGE = 10;
    const EXEMPT_EVENT_NAMES = (parameters['Exempt Event Names'] || "NPC,Chest,Trigger").split(',').map(s => s.trim());
    const VISION_BLOCKING_EVENT_NAMES = ("Dungeon door,Door,Locked Door,Wall,Pillar,Door,Column,Room,Obstacle").split(',').map(s => s.trim().toLowerCase());  // i18n-ignore  event names
    const UPDATE_FREQUENCY = Number(parameters['Update Frequency'] || 3);
    const RAY_COUNT = Number(parameters['Ray Count'] || 120);
    const RESET_ON_NEW_GAME = parameters['Reset On New Game'] !== 'false';
    const CHUNK_SIZE = Number(parameters['Chunk Size'] || 8);
    const NEVER_SEEN_COLOR = parameters['Never Seen Color'] || '#000000';
    const PREVIOUSLY_SEEN_COLOR = parameters['Previously Seen Color'] || 'rgba(0,0,0,0.4)';
    const REVEAL_TRANSITION_DURATION = Number(parameters['Reveal Transition Duration'] || 16);
    const BASE_ALPHA = (function () {
        const css = parameters['Previously Seen Color'] || 'rgba(0,0,0,0.4)';
        const match = css.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
        return match ? parseFloat(match[1]) : 0.4;
    })();
    const VISION_ANGLE = 110;
    const VISION_SMOOTHING = Number(parameters['Vision Smoothing'] || 0.9);
    const EDGE_FEATHERING = 0;
    const ADD_TO_OPTIONS_MENU = parameters['Add To Options Menu'] !== 'false';
    const OPTIONS_MENU_TEXT = parameters['Options Menu Text'] || 'Fog of War';

    // Map Feature Constants
    const TERRAIN_WALL = 4;
    const TERRAIN_ROOF = 7;
    const REGION_BLOCK = 10;
    const REGION_EXTENDED_VIEW = 11;
    // Region 30 tiles separate different interiors placed on the same map
    // (same convention as MousePan's interior-divider clamping). They always
    // block vision, and on maps where fog is otherwise disabled they still
    // confine what is visible to the player's current interior.
    const REGION_DIVIDER = 30;
    // Region 31 tiles are exempt from fog of war: they stay fully revealed no
    // matter where the vision sources are. Divider tiles (region 30) touching
    // one of them are revealed as well, but only while player 1 or player 2 is
    // actually facing them (inside the vision cone).
    const REGION_FOG_EXEMPT = 31;

    let fogOfWarEnabled = true;
    let updateCounter = 0;

    //=============================================================================
    // Plugin Commands
    //=============================================================================

    PluginManager.registerCommand(pluginName, "toggleFogOfWar", args => {
        fogOfWarEnabled = args.enable === "true";
        if (ADD_TO_OPTIONS_MENU) {
            ConfigManager.fogOfWar = fogOfWarEnabled;
            ConfigManager.save();
        }
        if (SceneManager._scene instanceof Scene_Map) {
            SceneManager._scene._spriteset.refreshFogOfWar();
        }
    });

    PluginManager.registerCommand(pluginName, "disableFogForMap", args => {
        const disable = args.disable === "true";
        $gameMap._fogOfWarDisabled = disable;
        if (SceneManager._scene instanceof Scene_Map) {
            const container = SceneManager._scene._spriteset._fogContainer;
            if (container) {
                container.visible = !disable && fogOfWarEnabled;
                if (!disable && fogOfWarEnabled) {
                    SceneManager._scene._spriteset.refreshFogOfWar(true);
                }
            }
        }
    });

    PluginManager.registerCommand(pluginName, "resetFogOfWar", args => {
        const target = args.target || "current";
        if (target === "current") {
            $gameSystem.resetFogOfWarForMap($gameMap.mapId());
        } else {
            $gameSystem.resetAllFogOfWar();
        }
        $gameMap.initializeFogOfWar();
        if (SceneManager._scene instanceof Scene_Map) {
            SceneManager._scene._spriteset.refreshFogOfWar();
        }
    });

    PluginManager.registerCommand(pluginName, "revealEntireMap", args => {
        if ($gameMap && $gameMap._fogOfWarData) {
            for (let i = 0; i < $gameMap._fogOfWarData.length; i++) {
                $gameMap.setFogOfWarStateByIndex(i, 2);
            }
            $gameMap._forceVisionUpdate = true;
            $gameMap.markAllChunksDirty();
            $gameSystem.saveCurrentFogData();
            if (SceneManager._scene instanceof Scene_Map) {
                SceneManager._scene._spriteset.refreshFogOfWar();
            }
        }
    });

    //=============================================================================
    // DataManager & ConfigManager
    //=============================================================================

    const _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        _DataManager_setupNewGame.call(this);
        if (RESET_ON_NEW_GAME && $gameSystem) {
            $gameSystem.resetAllFogOfWar();
        }
    };

    ConfigManager.fogOfWar = true;

    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _ConfigManager_makeData.call(this);
        config.fogOfWar = this.fogOfWar;
        return config;
    };

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _ConfigManager_applyData.call(this, config);
        this.fogOfWar = this.readFlag(config, 'fogOfWar', true);
        fogOfWarEnabled = this.fogOfWar;
    };

    if (ADD_TO_OPTIONS_MENU) {
        if (window.GameOptions) {
            window.GameOptions.registerOption('fogOfWar', OPTIONS_MENU_TEXT, 
                () => ConfigManager.fogOfWar, 
                (value) => ConfigManager.fogOfWar = value, 
                'gameplay', 'boolean');
        } else {
            const _Window_Options_addGeneralOptions = Window_Options.prototype.addGeneralOptions;
            Window_Options.prototype.addGeneralOptions = function () {
                _Window_Options_addGeneralOptions.call(this);
                this.addCommand(OPTIONS_MENU_TEXT, 'fogOfWar');
            };
        }
    }

    //=============================================================================
    // Game_System
    //=============================================================================

    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        _Game_System_initialize.call(this);
        // Data is now stored in window.$fogOfWarData and saved separately
    };

    Game_System.prototype.getFogOfWarData = function (mapId) {
        if (!window.$fogOfWarData) window.$fogOfWarData = {};
        return window.$fogOfWarData[mapId] || null;
    };

    Game_System.prototype.setFogOfWarData = function (mapId, data) {
        if (!window.$fogOfWarData) window.$fogOfWarData = {};
        window.$fogOfWarData[mapId] = data;
    };

    Game_System.prototype.saveCurrentFogData = function () {
        if ($gameMap && $gameMap._fogOfWarData && $gameMap._fogTransitionTimers) {
            this.setFogOfWarData($gameMap.mapId(), {
                states: Array.from($gameMap._fogOfWarData),
                timers: Array.from($gameMap._fogTransitionTimers)
            });
        }
    };

    Game_System.prototype.resetFogOfWarForMap = function (mapId) {
        if (window.$fogOfWarData && window.$fogOfWarData[mapId]) {
            delete window.$fogOfWarData[mapId];
        }
    };

    Game_System.prototype.resetAllFogOfWar = function () {
        window.$fogOfWarData = {};
    };

    //=============================================================================
    // DataManager - External Save/Load
    //=============================================================================

    const _DataManager_saveGame = DataManager.saveGame;
    DataManager.saveGame = function(savefileId) {
        // Fog data is no longer serialized periodically during play, so sync
        // the current map's fog into window.$fogOfWarData at save time.
        if ($gameSystem) $gameSystem.saveCurrentFogData();
        return _DataManager_saveGame.call(this, savefileId).then(contents => {
            if (window.$fogOfWarData) {
                // Chain the fog write into the returned promise so the main save
                // does not resolve until fog persistence completes (or fails).
                return StorageManager.saveObject(`fog_${savefileId}`, window.$fogOfWarData)
                    .catch(e => console.error("FogOfWar: Failed to save fog data", e))
                    .then(() => contents);
            }
            return contents;
        });
    };

    const _DataManager_loadGame = DataManager.loadGame;
    DataManager.loadGame = function(savefileId) {
        return _DataManager_loadGame.call(this, savefileId).then(success => {
            if (success) {
                return StorageManager.loadObject(`fog_${savefileId}`).then(fogData => {
                    window.$fogOfWarData = fogData || {};
                    return true;
                }).catch(e => {
                    console.log("FogOfWar: No fog data found or error loading it", e);
                    window.$fogOfWarData = {};
                    return true; // Still success for main load
                });
            }
            return success;
        });
    };

    Game_System.prototype.reloadFogOfWarLighting = function () {
        if (!$gameMap) return;
        $gameMap._lastUpdateTime = 0;
        $gameMap._playerIdleTime = 0;
        $gameMap._playerWasMoving = false;
        $gameMap._terrainCacheDirty = true;

        const size = $gameMap.width() * $gameMap.height();
        $gameMap._fogTransitionTimers = new Int16Array(size);
        $gameMap._activeTransitions = new Set();

        $gameMap.markAllChunksDirty();
        if ($gamePlayer) $gameMap.updateFogOfWar();
    };

    //=============================================================================
    // Game_Map
    //=============================================================================

    const _Game_Map_initialize = Game_Map.prototype.initialize;
    Game_Map.prototype.initialize = function () {
        _Game_Map_initialize.call(this);
        this._fogOfWarData = null;
        this._fogTransitionTimers = null;
        this._dirtyChunks = null;
        this._activeTransitions = new Set();
        this._playerLastX = -1;
        this._playerLastY = -1;
        this._playerLastDir = -1;
        this._player2LastX = -1;
        this._player2LastY = -1;
        this._player2LastDir = -1;
        this._lastUpdateTime = 0;
        this._visionRange = DEFAULT_VISION_RANGE;
        this._visionX = 0;
        this._visionY = 0;
        this._visionX2 = 0;
        this._visionY2 = 0;
        this._playerIdleTime = 0;
        this._playerIdleThreshold = 10;
        this._playerWasMoving = false;
        this._terrainCache = null;
        this._eventMap = [];
        this._visibleIndices = [];
        this._lastVisibleIndices = [];
        this._currentFrameVisible = null;
        this._forceVisionUpdate = true;
    };

    const _Game_Map_setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function (mapId) {
        _Game_Map_setup.call(this, mapId);

        this._fogOfWarDisabled = false;
        this._visibleFogOfWar = false;
        this._isExteriorMap = false;
        if ($dataMap && $dataMap.note) {
            this._fogOfWarDisabled = $dataMap.note.includes("<DisableFogOfWar>");
            this._visibleFogOfWar = $dataMap.note.includes("<VisibleFogOfWar>");
            this._isExteriorMap = $dataMap.note.includes("<Exterior>");
        }

        // The world map (315) and the procedural map (636) are the same world
        // and must never carry fog. Force it off entirely, dividers included:
        // region 30 means something else on the world map, so the divider-only
        // fog path below must not claim it either (#57).
        this._fogOfWarForceOff = (mapId === 315 || mapId === 636);
        if (this._fogOfWarForceOff) {
            $gameSystem.resetFogOfWarForMap(mapId);
            this._fogOfWarDisabled = true;
        }

        // Interior dividers (region 30) block vision even when this map has fog
        // disabled, so scan for them up front and cache the result.
        this._hasVisionDividers = this.detectVisionDividers();
        this._dividerFogKey = null;

        this.initializeFogOfWar();
        this.loadVisionRangeFromMapNotes();

        this._visionX = $gamePlayer.x;
        this._visionY = $gamePlayer.y;
        if (window.$gameSplitScreen && window.$gameSplitScreen.active && window.$gameSplitScreen.p2Event) {
            this._visionX2 = window.$gameSplitScreen.p2Event.x;
            this._visionY2 = window.$gameSplitScreen.p2Event.y;
        } else {
            this._visionX2 = this._visionX;
            this._visionY2 = this._visionY;
        }
    };

    Game_Map.prototype.normalizePos = function (x, y) {
        if (this.isLoopHorizontal()) x = (x + this.width()) % this.width();
        if (this.isLoopVertical()) y = (y + this.height()) % this.height();
        return { x, y, isValid: x >= 0 && y >= 0 && x < this.width() && y < this.height() };
    };

    Game_Map.prototype.loadVisionRangeFromMapNotes = function () {
        this._visionRange = DEFAULT_VISION_RANGE;
        if ($dataMap && $dataMap.note) {
            const match = $dataMap.note.match(/<VisionRange:(\d+)>/i);
            if (match) {
                const value = parseInt(match[1], 10);
                if (!isNaN(value) && value > 0) this._visionRange = value;
            }
        }
    };

    Game_Map.prototype.visionRange = function () {
        return this._visionRange;
    };

    Game_Map.prototype.initializeFogOfWar = function () {
        const size = this.width() * this.height();
        const savedData = $gameSystem.getFogOfWarData(this._mapId);

        if (savedData && savedData.states && savedData.states.length === size) {
            this._fogOfWarData = new Uint8Array(savedData.states);
            this._fogTransitionTimers = new Int16Array(savedData.timers);
        } else {
            this._fogOfWarData = (savedData && savedData.length === size) ? new Uint8Array(savedData) : new Uint8Array(size);
            this._fogTransitionTimers = new Int16Array(size);
            for (let i = 0; i < size; i++) {
                const state = this._fogOfWarData[i];
                if (state === 0) this._fogTransitionTimers[i] = 255;
                else if (state === 1) this._fogTransitionTimers[i] = Math.floor(BASE_ALPHA * 255);
                else this._fogTransitionTimers[i] = 0;
            }
        }

        this._activeTransitions = new Set();
        this._terrainCache = new Uint8Array(size);
        this._terrainCacheDirty = true;

        const chunksX = Math.ceil(this.width() / CHUNK_SIZE);
        const chunksY = Math.ceil(this.height() / CHUNK_SIZE);
        this._dirtyChunks = new Uint8Array(chunksX * chunksY).fill(1);

        this.refreshEventMap();

        this._visibleIndices = [];
        this._currentFrameVisible = new Uint8Array(size);
        this._lastVisibleIndices = [];

        this.scanFogRegionTiles();
        this.applyFogExemptTiles(true);

        for (let i = 0; i < size; i++) {
            if (this._fogOfWarData[i] === 2) this._lastVisibleIndices.push(i);
        }

        this._playerLastX = -1;
        this._playerLastY = -1;
        this._playerLastDir = -1;
        this._player2LastX = -1;
        this._player2LastY = -1;
        this._player2LastDir = -1;
        this._lastUpdateTime = 0;
        this._forceVisionUpdate = true;
    };

    // Rebuild the event map only when an event actually changed tile (or its
    // priority changed) since the last rebuild — the full rebuild is expensive.
    Game_Map.prototype.refreshEventMapIfNeeded = function () {
        const events = this.events();
        const needed = events.length * 3;
        let sig = this._eventMapSig;
        let dirty = false;
        if (!sig || sig.length !== needed) {
            sig = new Int32Array(needed);
            this._eventMapSig = sig;
            dirty = true;
        }
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const prio = typeof event.priorityType === 'function' ? event.priorityType() : 0;
            const j = i * 3;
            if (sig[j] !== event.x || sig[j + 1] !== event.y || sig[j + 2] !== prio) {
                sig[j] = event.x;
                sig[j + 1] = event.y;
                sig[j + 2] = prio;
                dirty = true;
            }
        }
        if (dirty) this.refreshEventMap();
    };

    Game_Map.prototype.refreshEventMap = function () {
        const width = this.width();
        const size = width * this.height();
        if (!this._eventMap || this._eventMap.length !== size) {
            this._eventMap = new Array(size);
        }
        for (let i = 0; i < size; i++) {
            if (this._eventMap[i]) this._eventMap[i].length = 0;
        }

        const events = this.events();
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            event._isVisionBlocking = this.isVisionBlockingEvent(event);
            if (this.isValid(event.x, event.y)) {
                const index = event.y * width + event.x;
                if (!this._eventMap[index]) {
                    this._eventMap[index] = [event];
                } else {
                    this._eventMap[index].push(event);
                }
            }
        }
    };

    Game_Map.prototype.fogOfWarState = function (x, y) {
        if (window.dreamActive) return 2;
        // On divider maps the real fog data still matters even when fog is
        // globally off / disabled for the map, so we don't short-circuit here.
        if ((this._fogOfWarDisabled || !fogOfWarEnabled) && !this._hasVisionDividers) return 2;
        const pos = this.normalizePos(x, y);
        if (!pos.isValid) return 0;
        if (this.regionId(pos.x, pos.y) === REGION_FOG_EXEMPT) return 2;
        return this._fogOfWarData[pos.y * this.width() + pos.x] || 0;
    };

    // Cache the fog-exempt tiles (region 31) and the divider tiles (region 30)
    // sitting next to one of them, so the per-frame passes are list walks
    // instead of full-map scans.
    Game_Map.prototype.scanFogRegionTiles = function () {
        const w = this.width();
        const h = this.height();
        const exempt = [];
        const peek = [];

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (this.regionId(x, y) === REGION_FOG_EXEMPT) exempt.push(y * w + x);
            }
        }

        if (exempt.length > 0) {
            const checked = new Uint8Array(w * h);
            for (let i = 0; i < exempt.length; i++) {
                const x = exempt[i] % w;
                const y = (exempt[i] / w) | 0;
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        const nx = x + ox;
                        const ny = y + oy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        const index = ny * w + nx;
                        if (checked[index]) continue;
                        checked[index] = 1;
                        if (this.regionId(nx, ny) === REGION_DIVIDER) peek.push(index);
                    }
                }
            }
        }

        this._fogExemptIndices = exempt;
        this._fogPeekDividerIndices = peek;
    };

    // Force every region-31 tile to the revealed state. Passing snap = true
    // also zeroes its transition timer so it never fades in.
    Game_Map.prototype.applyFogExemptTiles = function (snap = false) {
        const list = this._fogExemptIndices;
        const data = this._fogOfWarData;
        if (!list || list.length === 0 || !data) return;
        const width = this.width();

        for (let i = 0; i < list.length; i++) {
            const index = list[i];
            if (index >= data.length) continue;

            if (data[index] !== 2) {
                data[index] = 2;
                if (!(this._activeTransitions instanceof Set)) this._activeTransitions = new Set();
                this._activeTransitions.add(index);
                this.markChunkDirty(index % width, (index / width) | 0);
            }

            if (snap && this._fogTransitionTimers && this._fogTransitionTimers[index] !== 0) {
                this._fogTransitionTimers[index] = 0;
                if (this._activeTransitions instanceof Set) this._activeTransitions.delete(index);
                this.markChunkDirty(index % width, (index / width) | 0);
            }

            // Keep them out of the "was visible, now isn't" demotion pass.
            if (this._currentFrameVisible && !this._currentFrameVisible[index]) {
                this._currentFrameVisible[index] = 1;
                this._visibleIndices.push(index);
            }
        }
    };

    // True when the tile falls inside the character's vision cone (same angle
    // and range the rays use). Adjacent tiles always count, whatever the facing.
    Game_Map.prototype.isTileInVisionCone = function (char, x, y) {
        if (!char) return false;
        const cx = Math.round(char._realX);
        const cy = Math.round(char._realY);
        const dx = x - cx;
        const dy = y - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > this.visionRange()) return false;
        if (distance <= 1.5) return true;

        const baseAngle = { 2: Math.PI / 2, 4: Math.PI, 6: 0, 8: -Math.PI / 2 }[char.direction()];
        if (baseAngle === undefined) return false;

        let diff = Math.atan2(dy, dx) - baseAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return Math.abs(diff) <= (VISION_ANGLE * Math.PI / 180) / 2;
    };

    // Reveal the divider tiles bordering a region-31 tile, but only the ones a
    // vision source is currently looking at.
    Game_Map.prototype.revealPeekedDividers = function (chars) {
        const list = this._fogPeekDividerIndices;
        if (!list || list.length === 0 || !chars || chars.length === 0) return;
        const width = this.width();

        for (let i = 0; i < list.length; i++) {
            const index = list[i];
            const x = index % width;
            const y = (index / width) | 0;
            for (let c = 0; c < chars.length; c++) {
                if (this.isTileInVisionCone(chars[c], x, y)) {
                    this.setFogOfWarStateByIndex(index, 2);
                    break;
                }
            }
        }
    };

    // True when this map should render fog purely to enforce interior dividers
    // (region 30) — i.e. it has dividers but fog is otherwise inactive.
    Game_Map.prototype.isDividerOnlyFog = function () {
        if (this._fogOfWarForceOff) return false;
        return !!this._hasVisionDividers &&
            (!ConfigManager.fogOfWar || this._fogOfWarDisabled) &&
            !window.dreamActive;
    };

    Game_Map.prototype.detectVisionDividers = function () {
        if (this._fogOfWarForceOff) return false;
        const w = this.width();
        const h = this.height();
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (this.regionId(x, y) === REGION_DIVIDER) return true;
            }
        }
        return false;
    };

    // Flood-fill the player's current interior, stopping at region-30 dividers
    // (the divider tiles themselves are included so their walls stay visible).
    // Returns a Uint8Array mask (1 = visible), or null for "no enclosure" —
    // the player is standing on a divider or the area isn't walled off, in
    // which case the caller reveals everything (mirrors MousePan's semantics).
    Game_Map.prototype.computeInteriorTiles = function (px, py) {
        const w = this.width();
        const h = this.height();
        if (px < 0 || py < 0 || px >= w || py >= h) return null;
        if (this.regionId(px, py) === REGION_DIVIDER) return null;

        const visited = new Uint8Array(w * h);
        const start = py * w + px;
        const stack = [start];
        visited[start] = 1;
        let hitDivider = false;

        while (stack.length) {
            const idx = stack.pop();
            const x = idx % w;
            const y = (idx / w) | 0;
            const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (let n = 0; n < neighbors.length; n++) {
                const nx = neighbors[n][0];
                const ny = neighbors[n][1];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nidx = ny * w + nx;
                if (visited[nidx]) continue;
                visited[nidx] = 1;
                if (this.regionId(nx, ny) === REGION_DIVIDER) {
                    // Divider wall stays visible but vision does not cross it.
                    hitDivider = true;
                    continue;
                }
                stack.push(nidx);
            }
        }

        if (!hitDivider) return null;
        return visited;
    };

    // Reveal only the player's current interior and black out everything else.
    // Used when fog is otherwise inactive but the map has region-30 dividers.
    Game_Map.prototype.updateDividerFog = function () {
        const size = this.width() * this.height();
        if (!this._fogOfWarData || this._fogOfWarData.length !== size) {
            this.initializeFogOfWar();
        }
        if (!$gamePlayer) return;

        const sources = [$gamePlayer];
        if (window.$gameSplitScreen && window.$gameSplitScreen.active && window.$gameSplitScreen.p2Event) {
            sources.push(window.$gameSplitScreen.p2Event);
        }

        const force = this._forceVisionUpdate;
        // Facing is part of the key: the peeked divider tiles depend on it.
        let key = '';
        for (let i = 0; i < sources.length; i++) {
            key += Math.round(sources[i].x) + ',' + Math.round(sources[i].y) + ',' + sources[i].direction() + ';';
        }
        if (!force && key === this._dividerFogKey) {
            this.updateTransitionTimers();
            this.updateEventVisibility(false);
            return;
        }
        this._dividerFogKey = key;
        this._forceVisionUpdate = false;

        // Union each vision source's interior. A null (open / on-divider) result
        // means that source can see everything.
        let revealAll = false;
        let mask = null;
        for (let i = 0; i < sources.length; i++) {
            const tiles = this.computeInteriorTiles(Math.round(sources[i].x), Math.round(sources[i].y));
            if (!tiles) { revealAll = true; break; }
            if (!mask) {
                mask = tiles;
            } else {
                for (let j = 0; j < size; j++) if (tiles[j]) mask[j] = 1;
            }
        }

        for (let i = 0; i < size; i++) {
            const see = revealAll || (mask && mask[i]);
            this.setFogOfWarStateByIndex(i, see ? 2 : 0);
        }

        this.applyFogExemptTiles();
        this.revealPeekedDividers(sources);

        if (force) {
            // Snap the transition alpha so the interior appears immediately
            // instead of fading in on map entry.
            const timers = this._fogTransitionTimers;
            const data = this._fogOfWarData;
            for (let i = 0; i < size; i++) {
                const st = data[i];
                timers[i] = st === 2 ? 0 : (st === 1 ? Math.floor(BASE_ALPHA * 255) : 255);
            }
            if (this._activeTransitions instanceof Set) this._activeTransitions.clear();
            this.markAllChunksDirty();
        }

        this.updateTransitionTimers();
        this.updateEventVisibility(force);
    };

    Game_Map.prototype.fogTransitionTimer = function (x, y) {
        const pos = this.normalizePos(x, y);
        if (!pos.isValid) return 0;
        return this._fogTransitionTimers[pos.y * this.width() + pos.x] || 0;
    };

    Game_Map.prototype.setFogOfWarState = function (x, y, state) {
        const pos = this.normalizePos(x, y);
        if (pos.isValid) {
            this.setFogOfWarStateByIndex(pos.y * this.width() + pos.x, state);
        }
    };

    Game_Map.prototype.setFogOfWarStateByIndex = function (index, state) {
        if (state === 2) {
            const x = index % this.width();
            const y = Math.floor(index / this.width());
            
            const procGenData = $gameSystem._procGenData;
            const isProcDiving = procGenData && 
                                 procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0 &&
                                 (procGenData.currentBiome === "Ocean" || procGenData.biomeLayerStack.includes("Ocean"));  // i18n-ignore  biome id

            const isDiving = $gamePlayer && ($gamePlayer._isDiving || isProcDiving);
            
            const isWater = this._underwaterWaterTiles && this._underwaterWaterTiles.has(index);
            if (isDiving && !isWater) {
                return; // Do not reveal tiles that are not water while diving
            }
        }

        if (this._fogOfWarData[index] !== state) {
            this._fogOfWarData[index] = state;
            if (!(this._activeTransitions instanceof Set)) this._activeTransitions = new Set();
            this._activeTransitions.add(index);

            const width = this.width();
            this.markChunkDirty(index % width, (index / width) | 0);
        }

        if (state === 2 && this._currentFrameVisible && !this._currentFrameVisible[index]) {
            this._currentFrameVisible[index] = 1;
            this._visibleIndices.push(index);
        }
    };

    Game_Map.prototype.markChunkDirty = function (x, y) {
        const chunkX = (x / CHUNK_SIZE) | 0;
        const chunkY = (y / CHUNK_SIZE) | 0;
        const chunksX = Math.ceil(this.width() / CHUNK_SIZE);
        const chunksY = Math.ceil(this.height() / CHUNK_SIZE);
        if (chunkX >= 0 && chunkY >= 0 && chunkX < chunksX && chunkY < chunksY) {
            this._dirtyChunks[chunkY * chunksX + chunkX] = 1;
        }
    };

    Game_Map.prototype.updateTransitionTimers = function () {
        if (!this._activeTransitions || !(this._activeTransitions instanceof Set) || this._activeTransitions.size === 0) return;

        const width = this.width();
        const frames = Math.max(1, REVEAL_TRANSITION_DURATION);
        const toDelete = [];
        const step = Math.ceil(255 / frames);

        for (const index of this._activeTransitions) {
            const state = this._fogOfWarData[index];
            let target = 0;
            if (state === 0) target = 255;
            else if (state === 1) target = Math.floor(BASE_ALPHA * 255);
            else if (state === 2) target = 0;

            const current = this._fogTransitionTimers[index];
            if (current < target) {
                this._fogTransitionTimers[index] = Math.min(target, current + step);
                this.markChunkDirty(index % width, (index / width) | 0);
            } else if (current > target) {
                this._fogTransitionTimers[index] = Math.max(target, current - step);
                this.markChunkDirty(index % width, (index / width) | 0);
            }

            if (this._fogTransitionTimers[index] === target) {
                toDelete.push(index);
            }
        }

        for (const index of toDelete) {
            this._activeTransitions.delete(index);
        }
    };

    Game_Map.prototype.markAllChunksDirty = function () {
        const chunksX = Math.ceil(this.width() / CHUNK_SIZE);
        const chunksY = Math.ceil(this.height() / CHUNK_SIZE);
        this._dirtyChunks = new Uint8Array(chunksX * chunksY).fill(1);
    };

    Game_Map.prototype.getDirtyChunks = function () {
        // Reuse a scratch array; callers consume the result synchronously.
        const result = this._dirtyChunkScratch || (this._dirtyChunkScratch = []);
        result.length = 0;
        if (!this._dirtyChunks) return result;
        for (let i = 0; i < this._dirtyChunks.length; i++) {
            if (this._dirtyChunks[i]) {
                result.push(i);
            }
        }
        return result;
    };

    Game_Map.prototype.clearDirtyChunks = function () {
        if (this._dirtyChunks && typeof this._dirtyChunks.fill === 'function') {
            this._dirtyChunks.fill(0);
        }
    };

    Game_Map.prototype.isPositionVisible = function (x, y) {
        return this.fogOfWarState(x, y) === 2;
    };

    Game_Map.prototype.updateFogOfWar = function () {
        if (window.dreamActive) return;

        // Divider maps with fog otherwise inactive: render only the interior
        // walls, so the player cannot see across region-30 dividers.
        if (this.isDividerOnlyFog()) {
            this.updateDividerFog();
            return;
        }

        if (!ConfigManager.fogOfWar) {
            fogOfWarEnabled = false;
            return;
        }
        fogOfWarEnabled = true;

        if (this._fogOfWarDisabled) return;

        // Vision sources (P1 and P2)
        const players = [{ char: $gamePlayer, id: 1 }];
        if (window.$gameSplitScreen && window.$gameSplitScreen.active && window.$gameSplitScreen.p2Event) {
            players.push({ char: window.$gameSplitScreen.p2Event, id: 2 });
        }

        const isInitial = this._forceVisionUpdate;
        let needsVisionUpdate = isInitial;

        this.updateTransitionTimers();

        // Process movement and smoothing for all vision sources
        for (const p of players) {
            const char = p.char;
            const lastX = p.id === 1 ? this._playerLastX : this._player2LastX;
            const lastY = p.id === 1 ? this._playerLastY : this._player2LastY;
            const lastDir = p.id === 1 ? this._playerLastDir : this._player2LastDir;
            const visionX = p.id === 1 ? this._visionX : this._visionX2;
            const visionY = p.id === 1 ? this._visionY : this._visionY2;

            const positionChanged = Math.abs(char.x - lastX) > 0.2 || Math.abs(char.y - lastY) > 0.2;
            const directionChanged = char.direction() !== lastDir;

            const realX = char.x + (char._realX - char.x);
            const realY = char.y + (char._realY - char.y);
            const isSmoothing = Math.abs(visionX - realX) > 0.05 || Math.abs(visionY - realY) > 0.05;

            if (positionChanged || directionChanged || isSmoothing) needsVisionUpdate = true;

            // Update vision smoothing coords for this source
            if (directionChanged || isInitial || Math.abs(realX - visionX) > 2 || Math.abs(realY - visionY) > 2) {
                if (p.id === 1) { this._visionX = realX; this._visionY = realY; }
                else { this._visionX2 = realX; this._visionY2 = realY; }
            } else if (positionChanged) {
                if (p.id === 1) {
                    this._visionX += (realX - this._visionX) * VISION_SMOOTHING;
                    this._visionY += (realY - this._visionY) * VISION_SMOOTHING;
                } else {
                    this._visionX2 += (realX - this._visionX2) * VISION_SMOOTHING;
                    this._visionY2 += (realY - this._visionY2) * VISION_SMOOTHING;
                }
            } else {
                if (p.id === 1) { this._visionX = realX; this._visionY = realY; }
                else { this._visionX2 = realX; this._visionY2 = realY; }
            }

            if (positionChanged || directionChanged) {
                if (p.id === 1) {
                    this._playerLastX = char.x;
                    this._playerLastY = char.y;
                    this._playerLastDir = char.direction();
                } else {
                    this._player2LastX = char.x;
                    this._player2LastY = char.y;
                    this._player2LastDir = char.direction();
                }
            }
        }

        if (needsVisionUpdate) {
            this._forceVisionUpdate = false;
            // After save/load a Uint8Array can come back as a plain object that
            // lost its typed-array methods, so recreate it when needed.
            if (!this._currentFrameVisible || typeof this._currentFrameVisible.fill !== 'function') {
                this._currentFrameVisible = new Uint8Array(this._fogOfWarData ? this._fogOfWarData.length : 0);
            } else {
                this._currentFrameVisible.fill(0);
            }
            this._visibleIndices = [];
            this.refreshEventMapIfNeeded();

            // Calculate vision for all sources
            for (const p of players) {
                const visionX = p.id === 1 ? this._visionX : this._visionX2;
                const visionY = p.id === 1 ? this._visionY : this._visionY2;
                this.calculateVision(visionX, visionY, p.char.direction(), p.char);
            }

            this.applyFogExemptTiles();
            this.revealPeekedDividers(players.map(p => p.char));

            if (isInitial) {
                for (let i = 0; i < this._visibleIndices.length; i++) {
                    const index = this._visibleIndices[i];
                    this._fogTransitionTimers[index] = 0;
                    this._activeTransitions.delete(index);
                }
            }

            const fogData = this._fogOfWarData;
            const currentVisible = this._currentFrameVisible;

            if (isInitial) {
                // Full scan on forced updates: external reveals (plugin
                // commands, refreshFogOfWar) may have set tiles to state 2
                // outside the tracked visible set.
                const size = fogData.length;
                for (let i = 0; i < size; i++) {
                    if (fogData[i] === 2 && !currentVisible[i]) {
                        this.setFogOfWarStateByIndex(i, 1);
                    }
                }
            } else {
                // Only previously visible tiles can need demoting to state 1.
                const last = this._lastVisibleIndices;
                for (let i = 0; i < last.length; i++) {
                    const index = last[i];
                    if (fogData[index] === 2 && !currentVisible[index]) {
                        this.setFogOfWarStateByIndex(index, 1);
                    }
                }
            }
            this._lastVisibleIndices = this._visibleIndices;
        }

        this.updateEventVisibility(isInitial);
    };

    Game_Map.prototype.calculateVision = function (centerX, centerY, direction, character) {
        let range = this.visionRange();
        const char = character || $gamePlayer;
        const charActualX = Math.round(char._realX);
        const charActualY = Math.round(char._realY);
        const playerOnRoof = this.terrainTag(charActualX, charActualY) === TERRAIN_ROOF || this.regionId(charActualX, charActualY) === REGION_EXTENDED_VIEW;

        if (playerOnRoof) range *= 1.5;

        // Eye check
        let actor = null;
        if (char === $gamePlayer) {
            actor = $gameParty.leader();
        } else if (window.$gameSplitScreen && char === window.$gameSplitScreen.p2Event) {
            actor = $gameParty.members()[1];
        }

        let hasLeftEye = true;
        let hasRightEye = true;
        
        if (actor && actor._bodyParts) {
            const leftEye = actor._bodyParts["LEFT_EYE"];
            const rightEye = actor._bodyParts["RIGHT_EYE"];
            if (leftEye && (leftEye.damaged || leftEye.currentHp <= 0)) hasLeftEye = false;
            if (rightEye && (rightEye.damaged || rightEye.currentHp <= 0)) hasRightEye = false;
        }

        const hasZeroEyes = !hasLeftEye && !hasRightEye;
        
        if (char === $gamePlayer) {
            this._hasZeroEyes = hasZeroEyes;
            if (hasZeroEyes) {
                this._eventVisionConeTiles = new Set();
            }
        }

        if (!hasZeroEyes) {
            this.setFogOfWarState(charActualX, charActualY, 2);

            const frontX = this.roundXWithDirection(charActualX, direction);
            const frontY = this.roundYWithDirection(charActualY, direction);
            if (this.isValid(frontX, frontY)) {
                this.setFogOfWarState(frontX, frontY, 2);
            }

            const backX = this.roundXWithDirection(charActualX, 10 - direction);
            const backY = this.roundYWithDirection(charActualY, 10 - direction);
            if (this.isValid(backX, backY)) {
                this.setFogOfWarState(backX, backY, 2);
            }

            this.revealWallTilesAbovePlayer(charActualX, charActualY);
        }

        const baseAngle = { 2: Math.PI / 2, 4: Math.PI, 6: 0, 8: Math.PI * 3 / 2 }[direction] || 0;
        const offsetDist = 1.0;
        const dx = direction === 6 ? -offsetDist : direction === 4 ? offsetDist : 0;
        const dy = direction === 2 ? -offsetDist : direction === 8 ? offsetDist : 0;

        const visionOriginX = centerX + 0.5 + dx;
        const visionOriginY = centerY + 0.5 + dy;
        const effectiveRange = range + offsetDist;

        const angleInRadians = VISION_ANGLE * Math.PI / 180;
        const halfAngle = angleInRadians / 2;

        let startAngle = baseAngle - halfAngle;
        let angleSpan = angleInRadians;
        
        if (hasZeroEyes) {
            startAngle = baseAngle - halfAngle;
            angleSpan = angleInRadians;
        } else if (!hasLeftEye) {
            startAngle = baseAngle;
            angleSpan = halfAngle;
        } else if (!hasRightEye) {
            startAngle = baseAngle - halfAngle;
            angleSpan = halfAngle;
        }

        for (let i = 0; i < RAY_COUNT; i++) {
            const angle = startAngle + (angleSpan * (i + 0.5) / RAY_COUNT);
            this.castRay(visionOriginX, visionOriginY, angle, effectiveRange, playerOnRoof, hasZeroEyes);
        }
    };

    Game_Map.prototype.revealWallTilesAbovePlayer = function (playerX, playerY) {
        const checkAndReveal = (x, basePathY) => {
            if (this.isValid(x, basePathY) && this.terrainTag(x, basePathY) === TERRAIN_WALL) {
                for (let y = 1; y <= 4; y++) {
                    const tileY = basePathY + 1 - y;
                    if (this.isValid(x, tileY)) this.setFogOfWarState(x, tileY, 2);
                }
            }
        };

        checkAndReveal(playerX, playerY - 1);
        checkAndReveal(playerX - 1, playerY);
        checkAndReveal(playerX + 1, playerY);

        const wallY = playerY - 1;
        if (this.isValid(playerX, wallY) && this.terrainTag(playerX, wallY) === TERRAIN_WALL) {
            for (let y = 1; y <= 4; y++) {
                const tileY = playerY - y;
                if (this.isValid(playerX - 1, tileY) && this.terrainTag(playerX - 1, tileY) === TERRAIN_WALL) {
                    this.setFogOfWarState(playerX - 1, tileY, 2);
                }
                if (this.isValid(playerX + 1, tileY) && this.terrainTag(playerX + 1, tileY) === TERRAIN_WALL) {
                    this.setFogOfWarState(playerX + 1, tileY, 2);
                }
            }
        }
    };

    Game_Map.prototype.applyEdgeFeathering = function (centerX, centerY) {
        // Feature intentionally disabled
        return;
    };

    Game_Map.prototype.revealConnectedTerrainTiles = function (startX, startY) {
        const originTag = this.terrainTag(startX, startY);
        const width = this.width();
        const queue = [[startX, startY]];
        const visited = new Set();
        visited.add(startY * width + startX);
        const MAX_TILES = 300;

        while (queue.length > 0 && visited.size <= MAX_TILES) {
            const [x, y] = queue.shift();
            const neighbors = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];
            for (const [nx, ny] of neighbors) {
                if (!this.isValid(nx, ny)) continue;
                const idx = ny * width + nx;
                if (visited.has(idx)) continue;
                visited.add(idx);
                if (this.terrainTag(nx, ny) === originTag) {
                    this.setFogOfWarState(nx, ny, 2);
                    queue.push([nx, ny]);
                }
            }
        }
    };

    Game_Map.prototype.castRay = function (startX, startY, angle, maxDistance, playerOnRoof = false, zeroEyes = false) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const width = this.width();
        const height = this.height();
        const isLoopH = this.isLoopHorizontal();
        const isLoopV = this.isLoopVertical();

        let x = startX;
        let y = startY;
        let tileX = Math.floor(x);
        let tileY = Math.floor(y);

        let sideDistX;
        let sideDistY;
        const deltaDistX = dx === 0 ? Infinity : Math.abs(1 / dx);
        const deltaDistY = dy === 0 ? Infinity : Math.abs(1 / dy);
        let stepX;
        let stepY;

        if (dx < 0) {
            stepX = -1;
            sideDistX = dx === 0 ? Infinity : (x - tileX) * deltaDistX;
        } else {
            stepX = 1;
            sideDistX = dx === 0 ? Infinity : (tileX + 1.0 - x) * deltaDistX;
        }

        if (dy < 0) {
            stepY = -1;
            sideDistY = dy === 0 ? Infinity : (y - tileY) * deltaDistY;
        } else {
            stepY = 1;
            sideDistY = dy === 0 ? Infinity : (tileY + 1.0 - y) * deltaDistY;
        }

        let dist = 0;

        while (dist < maxDistance) {
            if (sideDistX < sideDistY) {
                dist = sideDistX;
                sideDistX += deltaDistX;
                tileX += stepX;
            } else {
                dist = sideDistY;
                sideDistY += deltaDistY;
                tileY += stepY;
            }

            if (dist > maxDistance) break;

            let checkX = tileX;
            let checkY = tileY;
            if (isLoopH) checkX = (checkX + width) % width;
            if (isLoopV) checkY = (checkY + height) % height;

            if (checkX < 0 || checkY < 0 || checkX >= width || checkY >= height) break;

            if (this.isVisionBlocking(checkX, checkY, playerOnRoof)) {
                if (zeroEyes) {
                    if (!this._eventVisionConeTiles) this._eventVisionConeTiles = new Set();
                    this._eventVisionConeTiles.add(checkY * width + checkX);
                } else {
                    const wasRevealed = this._fogOfWarData[checkY * width + checkX] === 2;
                    this.setFogOfWarState(checkX, checkY, 2);
                    if (!wasRevealed) {
                        const tag = this.terrainTag(checkX, checkY);
                        if (tag === TERRAIN_WALL || (tag === TERRAIN_ROOF && this._isExteriorMap)) {
                            this.revealConnectedTerrainTiles(checkX, checkY);
                        }
                    }
                }
                break;
            }

            if (zeroEyes) {
                if (!this._eventVisionConeTiles) this._eventVisionConeTiles = new Set();
                this._eventVisionConeTiles.add(checkY * width + checkX);
            } else {
                this.setFogOfWarState(checkX, checkY, 2);
            }
            if (dist > maxDistance - (maxDistance * EDGE_FEATHERING)) {
                this.applyEdgeFeathering(checkX, checkY);
            }
        }
    };

    Game_Map.prototype.refreshTerrainCache = function () {
        const width = this.width();
        const height = this.height();
        const size = width * height;

        if (!this._terrainCache || this._terrainCache.length !== size) {
            this._terrainCache = new Uint8Array(size);
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tag = this.terrainTag(x, y);
                const region = this.regionId(x, y);

                let blockType = 0;
                if (region === REGION_BLOCK) blockType = 3;
                else if (region === REGION_DIVIDER) blockType = 3; // interior divider: always blocks
                else if (region === REGION_EXTENDED_VIEW) blockType = 0;
                else if (tag === TERRAIN_WALL) blockType = 1;
                else if (tag === TERRAIN_ROOF) blockType = 2;

                this._terrainCache[y * width + x] = blockType;
            }
        }
        this._terrainCacheDirty = false;
    };

    Game_Map.prototype.isVisionBlocking = function (x, y, playerOnRoof = false) {
        if (x < 0 || y < 0 || x >= this.width() || y >= this.height()) return true;
        if (this._terrainCacheDirty) this.refreshTerrainCache();

        const staticBlocks = this._terrainCache[y * this.width() + x];
        if (playerOnRoof ? (staticBlocks === 3) : (staticBlocks > 0)) return true;

        if (this._eventMap) {
            const events = this._eventMap[y * this.width() + x];
            if (events) {
                for (let i = 0; i < events.length; i++) {
                    if (events[i]._isVisionBlocking) return true;
                }
            }
        }
        return false;
    };

    Game_Map.prototype.isVisionBlockingEvent = function (event) {
        if (!event || typeof event.event !== 'function') return false;
        const data = event.event();
        if (!data || (typeof event.priorityType === 'function' && event.priorityType() !== 1)) return false;

        const name = (data.name || "").toLowerCase();
        return VISION_BLOCKING_EVENT_NAMES.some(blocker => blocker && name.includes(blocker));
    };

    Game_Map.prototype.isEnemyEvent = function (event) {
        if (!event || typeof event.event !== 'function') return false;
        const data = event.event();
        return data && data.note && /^\d+$/.test(data.note.trim());
    };

    Game_Map.prototype.isExemptEventName = function (event) {
        if (!event || typeof event.event !== 'function') return false;
        // Event names are static, so cache the result on the event.
        if (event._fowExempt === undefined) {
            const data = event.event();
            event._fowExempt = !!(data && EXEMPT_EVENT_NAMES.some(exempt => (data.name || "").includes(exempt)));
        }
        return event._fowExempt;
    };

    Game_Map.prototype.updateEventVisibility = function (snap = false) {
        this._eventVisibilityCounter = (this._eventVisibilityCounter || 0) + 1;
        if (this._eventVisibilityCounter < 3 && !snap) return;
        this._eventVisibilityCounter = 0;

        const p1x = $gamePlayer.x;
        const p1y = $gamePlayer.y;
        let p2 = null;
        if (window.$gameSplitScreen && window.$gameSplitScreen.active && window.$gameSplitScreen.p2Event) {
            p2 = window.$gameSplitScreen.p2Event;
        }

        const events = this.events();

        for (let i = 0; i < events.length; i++) {
            const event = events[i];

            // Proximity to ANY player reveals the event
            let isBordering = Math.abs(event.x - p1x) <= 1 && Math.abs(event.y - p1y) <= 1;
            if (!isBordering && p2) {
                isBordering = Math.abs(event.x - p2.x) <= 1 && Math.abs(event.y - p2.y) <= 1;
            }
            let isVisible = false;
            
            if (this._hasZeroEyes) {
                isVisible = this._eventVisionConeTiles && this._eventVisionConeTiles.has(event.y * this.width() + event.x);
            } else {
                isVisible = this.isPositionVisible(event.x, event.y);
            }

            if (this._visibleFogOfWar && this.fogOfWarState(event.x, event.y) >= 1) {
                isVisible = true;
            }

            event._fogOfWarBorderingPlayer = isBordering;
            event.updateFogOfWarVisibility(isBordering || isVisible, snap);
        }
    };

    //=============================================================================
    // Game_Event
    //=============================================================================

    const _Game_Event_initialize = Game_Event.prototype.initialize;
    Game_Event.prototype.initialize = function (mapId, eventId) {
        _Game_Event_initialize.call(this, mapId, eventId);
        this._fogOfWarVisible = true;
        this._fogOfWarTransitioning = false;
        this._fogOfWarTransitionTimer = 0;
        this._isEnemy = false;
        this._fogOfWarBorderingPlayer = false;
    };

    Game_Event.prototype.updateFogOfWarVisibility = function (isVisible, snap = false) {
        if (this._fogOfWarBorderingPlayer) isVisible = true;

        if (this._fogOfWarVisible !== isVisible) {
            this._isEnemy = $gameMap.isEnemyEvent(this);
            const isExempt = $gameMap.isExemptEventName(this);

            this._fogOfWarVisible = isVisible;

            if (snap) {
                this._fogOfWarTransitioning = false;
                this._fogOfWarTransitionTimer = 0;
                if (!isVisible) {
                    if (this._isEnemy && !isExempt && !this._fogOfWarBorderingPlayer) {
                        this._opacity = 0;
                        this._transparent = true;
                    } else {
                        this._opacity = 255;
                        this._transparent = false;
                    }
                } else {
                    this._opacity = 255;
                    this._transparent = false;
                }
            } else {
                this._fogOfWarTransitioning = true;
                this._fogOfWarTransitionTimer = REVEAL_TRANSITION_DURATION;

                if (!isVisible) {
                    if (this._isEnemy && !isExempt && !this._fogOfWarBorderingPlayer) {
                        // Start fading out
                        const delay = 60; // 1 second delay
                        const fadeDuration = REVEAL_TRANSITION_DURATION * 4;
                        this._fogOfWarTransitionTimer = delay + fadeDuration;
                    } else {
                        this._opacity = 255;
                        this._transparent = false;
                        this._fogOfWarTransitioning = false;
                    }
                } else {
                    this._opacity = 255;
                    this._transparent = false;
                    // Fade in logic if needed
                    this._fogOfWarTransitioning = true;
                }
            }
        }
    };

    Game_Event.prototype.updateFogOfWarTransition = function () {
        if (this._fogOfWarTransitioning) {

            this._fogOfWarTransitionTimer--;
            const duration = REVEAL_TRANSITION_DURATION;

            if (this._isEnemy && !$gameMap.isExemptEventName(this)) {
                if (!this._fogOfWarVisible) {
                    // Fading out
                    const fadeDuration = duration * 4;
                    
                    if (this._fogOfWarTransitionTimer > fadeDuration) {
                        // 1 second delay before fading starts
                        this._opacity = 255;
                    } else {
                        const fadeRatio = Math.max(0, this._fogOfWarTransitionTimer / fadeDuration);
                        this._opacity = Math.floor(255 * fadeRatio);
                    }
                    
                    if (this._fogOfWarTransitionTimer <= 0) {
                        this._fogOfWarTransitioning = false;
                        this._opacity = 0;
                        this._transparent = true;
                    }
                } else {
                    // Fading in
                    const fadeRatio = Math.max(0, 1 - (this._fogOfWarTransitionTimer / duration));
                    this._opacity = Math.floor(255 * fadeRatio);
                    this._transparent = false;
                    if (this._fogOfWarTransitionTimer <= 0) {
                        this._fogOfWarTransitioning = false;
                        this._opacity = 255;
                    }
                }
            } else {
                if (this._fogOfWarTransitionTimer <= 0) {
                    this._fogOfWarTransitioning = false;
                }
            }
        }
    };

    Game_Event.prototype.isFogOfWarGrayscale = function () {
        if (this._fogOfWarBorderingPlayer) return false;
        return !this._fogOfWarVisible && !this._isEnemy && !$gameMap.isExemptEventName(this);
    };

    Game_Event.prototype.isFogOfWarTransitioning = function () {
        return this._fogOfWarTransitioning;
    };

    const _Game_Event_update = Game_Event.prototype.update;
    Game_Event.prototype.update = function () {
        _Game_Event_update.call(this);
        this.updateFogOfWarTransition();
    };

    //=============================================================================
    // Game_Player
    //=============================================================================

    const _Game_Player_update = Game_Player.prototype.update;
    Game_Player.prototype.update = function (sceneActive) {
        _Game_Player_update.call(this, sceneActive);
        if (sceneActive) {
            // Fog updates are driven by the single throttled call in
            // Spriteset_Map.update; only track idle state here.
            if (this.isMoving()) {
                $gameMap._playerIdleTime = 0;
                $gameMap._playerWasMoving = true;
            } else if ($gameMap._playerWasMoving) {
                $gameMap._playerIdleTime++;
            }
        }
    };

    const _Game_Player_updateNonmoving = Game_Player.prototype.updateNonmoving;
    Game_Player.prototype.updateNonmoving = function (wasMoving, sceneActive) {
        _Game_Player_updateNonmoving.call(this, wasMoving, sceneActive);
        if (wasMoving && sceneActive) {
            $gameMap._playerIdleTime = 0;
            $gameMap._playerWasMoving = true;
            $gameMap.updateFogOfWar();
        }
    };

    const _Game_Player_performTransfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function () {
        const sameMap = this._newMapId === $gameMap.mapId();
        // Persist the outgoing map's fog before it is replaced (periodic
        // serialization during play was removed for performance).
        if (!sameMap && this.isTransferring()) {
            $gameSystem.saveCurrentFogData();
        }
        _Game_Player_performTransfer.call(this);
        if (sameMap && fogOfWarEnabled && $gameMap) {
            $gameMap._forceVisionUpdate = true;
            $gameMap.updateFogOfWar();
        }
    };

    //=============================================================================
    // Scene_Map & Scene_Load
    //=============================================================================

    const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function () {
        _Scene_Map_onMapLoaded.call(this);
        if (this._spriteset && fogOfWarEnabled) {
            const scene = this;
            const mapId = $gameMap ? $gameMap.mapId() : -1;
            setTimeout(() => {
                // Bail if the scene terminated or the map changed within the window.
                if (SceneManager._scene !== scene || !scene._spriteset) return;
                if (!$gameMap || $gameMap.mapId() !== mapId) return;
                scene._spriteset.refreshFogOfWar(true);
            }, 100);
        }
    };

    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _Scene_Map_start.call(this);
        if ($gameSystem && $gameSystem._needsFogOfWarRefresh) {
            const scene = this;
            const mapId = $gameMap ? $gameMap.mapId() : -1;
            setTimeout(() => {
                // Ignore if the scene terminated or the map changed within the window.
                if (SceneManager._scene !== scene) return;
                if (!$gameMap || $gameMap.mapId() !== mapId) return;
                if (this._spriteset && $gameMap) {
                    if ($gameSystem._forceFogReload) {
                        $gameSystem.reloadFogOfWarLighting();
                        $gameMap.initializeFogOfWar();
                        $gameMap._playerLastX = -1;
                        $gameMap._playerLastY = -1;
                        $gameMap._playerLastDir = -1;
                        if ($gamePlayer) {
                            $gameMap._visionX = $gamePlayer.x;
                            $gameMap._visionY = $gamePlayer.y;
                        }
                        $gameSystem._forceFogReload = false;
                    }
                    this._spriteset.refreshFogOfWar(true);
                    if ($gameMap) {
                        $gameMap.markAllChunksDirty();
                        $gameMap.updateFogOfWar();
                        $gameMap.updateTransitionTimers();
                    }
                    this._spriteset.updateEventVisibility();
                }
                $gameSystem._needsFogOfWarRefresh = false;
            }, 100);
        }
    };

    const _Scene_Load_onLoadSuccess = Scene_Load.prototype.onLoadSuccess;
    Scene_Load.prototype.onLoadSuccess = function () {
        _Scene_Load_onLoadSuccess.call(this);
        $gameSystem._needsFogOfWarRefresh = true;
        $gameSystem._forceFogReload = true;
    };

    //=============================================================================
    // Spriteset_Map
    //=============================================================================

    const _Spriteset_Map_createLowerLayer = Spriteset_Map.prototype.createLowerLayer;
    Spriteset_Map.prototype.createLowerLayer = function () {
        _Spriteset_Map_createLowerLayer.call(this);
    };

    const _Spriteset_Map_createUpperLayer = Spriteset_Map.prototype.createUpperLayer;
    Spriteset_Map.prototype.createUpperLayer = function () {
        _Spriteset_Map_createUpperLayer.call(this);
        this.createFogOfWarLayer();
    };

    Spriteset_Map.prototype.createFogOfWarLayer = function () {
        this._fogContainer = new PIXI.Container();
        this.addChild(this._fogContainer);
        
        this._fogCanvas = document.createElement('canvas');
        this._fogCanvas.width = 1;
        this._fogCanvas.height = 1;
        this._fogCtx = this._fogCanvas.getContext('2d', { willReadFrequently: true });
        
        this._fogTexture = PIXI.Texture.from(this._fogCanvas);
        this._fogTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        this._fogSprite = new PIXI.Sprite(this._fogTexture);
        this._fogContainer.addChild(this._fogSprite);
        
        this._lastDisplayX = -999;
        this._lastDisplayY = -999;
        this._wasFogOfWarActive = false;
        this.refreshFogOfWar(true);
    };

    const _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function () {
        _Spriteset_Map_update.call(this);
        const dividerOnly = $gameMap && $gameMap.isDividerOnlyFog();
        if (window.dreamActive || (!dividerOnly && (!fogOfWarEnabled || ($gameMap && $gameMap._fogOfWarDisabled)))) {
            if (this._fogContainer) {
                this._fogContainer.visible = false;
            }
            if (this._wasFogOfWarActive) {
                this.cleanupFogOfWarEvents();
                this._wasFogOfWarActive = false;
            }
            return;
        }
        this._wasFogOfWarActive = true;

        const displayX = $gameMap.displayX();
        const displayY = $gameMap.displayY();

        this._fogContainer.x = -Math.round(displayX * $gameMap.tileWidth());
        this._fogContainer.y = -Math.round(displayY * $gameMap.tileHeight());

        if (Math.abs(displayX - this._lastDisplayX) >= 0.25 || Math.abs(displayY - this._lastDisplayY) >= 0.25) {
            this._lastDisplayX = displayX;
            this._lastDisplayY = displayY;
        }

        try {
            // Single throttled call site for fog updates. On skipped frames
            // still tick transitions and event visibility so fades and event
            // reveal keep their original per-frame cadence.
            updateCounter = (updateCounter + 1) % UPDATE_FREQUENCY;
            if (updateCounter === 0) {
                $gameMap.updateFogOfWar();
            } else {
                $gameMap.updateTransitionTimers();
                $gameMap.updateEventVisibility(false);
            }
        } catch (e) {
            console.error('FogOfWar: disabling due to error', e);
            $gameMap._fogOfWarDisabled = true;
            ConfigManager.fogOfWar = false;
            fogOfWarEnabled = false;
            return;
        }

        const dirtyChunks = $gameMap.getDirtyChunks();
        if (dirtyChunks.length > 0) {
            this.updateDirtyChunks(dirtyChunks);
            $gameMap.clearDirtyChunks();
        }

        this.updateEventVisibility();
    };

    Spriteset_Map.prototype.cleanupFogOfWarEvents = function () {
        if ($gameMap) {
            const events = $gameMap.events();
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                event._fogOfWarVisible = true;
                event._fogOfWarTransitioning = false;
                event._fogOfWarTransitionTimer = 0;
                event._opacity = 255;
                event._transparent = false;
            }
        }
        for (let i = 0; i < this._characterSprites.length; i++) {
            const sprite = this._characterSprites[i];
            if (sprite._fogColorFilter) {
                if (sprite.filters) {
                    sprite.filters = sprite.filters.filter(f => f !== sprite._fogColorFilter);
                    if (!sprite.filters.length) sprite.filters = null;
                }
            }
        }
    };

    Spriteset_Map.prototype.refreshFogOfWar = function (fullRefresh = false) {
        const dividerOnly = $gameMap && $gameMap.isDividerOnlyFog();
        if (window.dreamActive || (!dividerOnly && (!fogOfWarEnabled || ($gameMap && $gameMap._fogOfWarDisabled)))) {
            this._fogContainer.visible = false;
            return;
        }
        this._fogContainer.visible = true;

        if (fullRefresh) {
            if ($gameMap && $dataMap) {
                const mapWidth = $gameMap.width();
                const mapHeight = $gameMap.height();
                if (!this._fogPixels || this._fogCanvas.width !== mapWidth || this._fogCanvas.height !== mapHeight) {
                    this._fogCanvas.width = mapWidth;
                    this._fogCanvas.height = mapHeight;
                    this._fogImageData = this._fogCtx.createImageData(mapWidth, mapHeight);
                    this._fogPixels = this._fogImageData.data;
                    
                    if (this._fogTexture) {
                        this._fogTexture.destroy(true);
                        delete this._fogCanvas._pixiId;
                    }
                    this._fogTexture = PIXI.Texture.from(this._fogCanvas);
                    this._fogTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
                    this._fogSprite.texture = this._fogTexture;
                    this._fogSprite.scale.set($gameMap.tileWidth(), $gameMap.tileHeight());
                }

                if (dividerOnly) {
                    // Interior-divider maps reveal the whole current room rather
                    // than a vision cone.
                    $gameMap._forceVisionUpdate = true;
                    $gameMap.updateDividerFog();
                } else {
                    const players = [$gamePlayer];
                    if (window.$gameSplitScreen && window.$gameSplitScreen.active && window.$gameSplitScreen.p2Event) {
                        players.push(window.$gameSplitScreen.p2Event);
                    }

                    players.forEach((p, i) => {
                        if (i === 0) {
                            $gameMap._visionX = p.x;
                            $gameMap._visionY = p.y;
                        } else {
                            $gameMap._visionX2 = p.x;
                            $gameMap._visionY2 = p.y;
                        }
                        $gameMap.calculateVision(p.x, p.y, p.direction(), p);
                    });
                    $gameMap.applyFogExemptTiles(true);
                    $gameMap.revealPeekedDividers(players);
                    $gameMap.updateTransitionTimers();
                }
            }
            $gameMap.markAllChunksDirty();
        }

        const dirtyChunks = $gameMap.getDirtyChunks();
        this.updateDirtyChunks(dirtyChunks);
        $gameMap.clearDirtyChunks();
    };

    Spriteset_Map.prototype.buildColorLut = function() {
        this._colorLut = new Uint8ClampedArray(256 * 4);
        const neverSeen = this.parseColor(NEVER_SEEN_COLOR);
        const prevSeen = this.parseColor(PREVIOUSLY_SEEN_COLOR);
        const baseAlpha = this.extractAlpha(PREVIOUSLY_SEEN_COLOR);
        
        const nsR = (neverSeen >> 16) & 0xFF;
        const nsG = (neverSeen >> 8) & 0xFF;
        const nsB = neverSeen & 0xFF;
        
        const psR = (prevSeen >> 16) & 0xFF;
        const psG = (prevSeen >> 8) & 0xFF;
        const psB = prevSeen & 0xFF;
        
        for (let i = 0; i < 256; i++) {
            const vAlpha = i / 255;
            const isBlack = vAlpha > baseAlpha + 0.05;
            this._colorLut[i * 4 + 0] = isBlack ? nsR : psR;
            this._colorLut[i * 4 + 1] = isBlack ? nsG : psG;
            this._colorLut[i * 4 + 2] = isBlack ? nsB : psB;
            this._colorLut[i * 4 + 3] = i; 
        }
    };

    Spriteset_Map.prototype.updateDirtyChunks = function (dirtyChunks) {
        if (!dirtyChunks || dirtyChunks.length === 0 || !$gameMap || !$gameMap._fogOfWarData) return;
        if (!this._fogPixels) return;
        
        if (!this._colorLut) this.buildColorLut();
        
        const mapWidth = $gameMap.width();
        const mapHeight = $gameMap.height();
        const chunksX = Math.ceil(mapWidth / CHUNK_SIZE);
        
        const timers = $gameMap._fogTransitionTimers;
        const pixels = this._fogPixels;
        const lut = this._colorLut;
        
        for (let i = 0; i < dirtyChunks.length; i++) {
            const chunkIndex = dirtyChunks[i];
            const chunkX = chunkIndex % chunksX;
            const chunkY = (chunkIndex / chunksX) | 0;
            
            const startX = chunkX * CHUNK_SIZE;
            const startY = chunkY * CHUNK_SIZE;
            const endX = Math.min(startX + CHUNK_SIZE, mapWidth);
            const endY = Math.min(startY + CHUNK_SIZE, mapHeight);
            
            for (let y = startY; y < endY; y++) {
                let pixelIndex = (y * mapWidth + startX) * 4;
                let timerIndex = y * mapWidth + startX;
                for (let x = startX; x < endX; x++) {
                    const alpha = timers[timerIndex++];
                    const lutIdx = alpha * 4;
                    pixels[pixelIndex++] = lut[lutIdx];
                    pixels[pixelIndex++] = lut[lutIdx + 1];
                    pixels[pixelIndex++] = lut[lutIdx + 2];
                    pixels[pixelIndex++] = lut[lutIdx + 3];
                }
            }
        }
        
        this._fogCtx.putImageData(this._fogImageData, 0, 0);
        if (this._fogTexture && this._fogTexture.baseTexture && this._fogTexture.baseTexture.resource) {
            this._fogTexture.update();
        }
    };

    Spriteset_Map.prototype.parseColor = function (cssColor) {
        if (cssColor.startsWith('#')) return parseInt(cssColor.slice(1), 16);
        const rgbaMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbaMatch) return (parseInt(rgbaMatch[1]) << 16) | (parseInt(rgbaMatch[2]) << 8) | parseInt(rgbaMatch[3]);
        return 0x000000;
    };

    Spriteset_Map.prototype.extractAlpha = function (cssColor) {
        const match = cssColor.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
        return match ? parseFloat(match[1]) : 1.0;
    };

    Spriteset_Map.prototype.updateEventVisibility = function () {
        for (let i = 0; i < this._characterSprites.length; i++) {
            const sprite = this._characterSprites[i];
            if (sprite._character instanceof Game_Event) {
                const event = sprite._character;
                sprite.opacity = event.opacity();

                const isGrayscale = event.isFogOfWarGrayscale() || (event.isFogOfWarTransitioning && event.isFogOfWarTransitioning());

                if (isGrayscale) {
                    if (!sprite._fogColorFilter) {
                        sprite._fogColorFilter = new PIXI.filters.ColorMatrixFilter();
                        sprite._fogColorFilter.saturate(-1);
                    }
                    if (!sprite.filters || !sprite.filters.includes(sprite._fogColorFilter)) {
                        sprite.filters = sprite.filters || [];
                        sprite.filters.push(sprite._fogColorFilter);
                    }
                } else if (sprite._fogColorFilter) {
                    if (sprite.filters) {
                        sprite.filters = sprite.filters.filter(f => f !== sprite._fogColorFilter);
                        if (!sprite.filters.length) sprite.filters = null;
                    }
                }
            }
        }
    };

})();