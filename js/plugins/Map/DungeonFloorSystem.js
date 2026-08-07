
/*:
 * @target MZ
 * @plugindesc v1.6.2 Creates a 100-floor dungeon system with robust map validation for stair placement.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help DungeonFloorSystem.js
 *
 * ######This plugin creates a dungeon system with 100 floors and a town level.
 * Floors are organized into 10 levels (A through J), each with 9 regular floors
 * and 1 elevator floor at the end of each level.
 *
 * --- New in v1.6.2: Staircase Map Validation ---
 * The plugin now validates maps to ensure they can be used for dungeon floors.
 * - Single-map floors: A map will be excluded from the generation pool if it
 * does not contain at least one tile with Region ID 13.
 * - Multi-map floors: A group of maps is only valid if it contains at least
 * TWO maps that have a Region ID 13 tile (for an entrance and an exit).
 * Maps within a valid group that lack Region ID 13 will not be used for
 * the start or end rooms.
 *
 * --- World generation ---
 * The floor layout is world data, not run data: it is rolled from the world
 * seed while the world is being created (WorldManager's "dungeon" step, which
 * runs the same routine as the Generate Dungeon plugin command) and the
 * Dungeon Generated switch is turned ON to say the world has one. Being a
 * world switch, it is shared by every savegame of that world.
 *
 * --- Special Floor Transitions ---
 * - From Town (Floor 0), using "nextFloor" teleports you to Map ID 101 (X:16, Y:38).
 * - From Floor 1, using "prevFloor" teleports you to the dungeon base Map ID 635 at (X:13, Y:27).
 * - If the current floor is a negative number, "nextFloor" and "prevFloor" are disabled.
 *
 * Plugin Commands:
 * generateDungeon - Creates a new random dungeon layout (resets max floor)
 * nextFloor      - Move to the next floor (up)
 * prevFloor      - Move to the previous floor (down)
 * setFloor       - Set a specific floor to visit (spawns near downstairs)
 * elevator       - Teleport to the floor stored in variable 17
 * teleportToHighest - Teleport to highest reached floor
 * teleportToNearestStairs - Teleport player to the nearest staircase on current map
 * teleportToUpstairs - Teleport player directly to the upstairs on current map
 * teleportToDownstairs - Teleport player directly to the downstairs on current map
 *
 * ===========================================================================
 * How to use:
 * 1. Set up your maps and their IDs in the plugin parameters. Use [ ] for map groups.
 * 2. Place region ID 13 on your maps where stairs can be located. Maps without
 * this region ID will not be chosen for most floors.
 * 3. Create events named "NextFloor" and "PrevFloor" on your dungeon maps.
 * 4. Generate the dungeon before starting exploration.
 * ===========================================================================
 * @param demoMode
 * @text Demo Mode
 * @desc If true, the dungeon stops at floor 10: floor 1 is map 101, floors 2-9 come from block A, floor 10 is map 112.
 * @type boolean
 *
 *
 * @param townMapId
 * @text Town Map ID
 * @desc Map ID for the town level
 * @type number
 * @default 1
 *
 * @param arenaMapId
 * @text Arena Map ID
 * @desc Map ID for the arena (alternative town when switch 5 is ON)
 * @type number
 * @default 2
 *
 * @param arenaMapX
 * @text Arena Map Spawn X
 * @desc X coordinate for player spawn on arena map
 * @type number
 * @default 5
 *
 * @param arenaMapY
 * @text Arena Map Spawn Y
 * @desc Y coordinate for player spawn on arena map
 * @type number
 * @default 5
 *
 * @param bossFloorMapId
 * @text Boss Floor (Floor 100) Map ID
 * @desc Map ID for floor 100
 * @type number
 * @default 70
 *
 * @param bossFloorX
 * @text Boss Floor Spawn X
 * @desc X coordinate for player spawn on floor 100
 * @type number
 * @default 10
 *
 * @param bossFloorY
 * @text Boss Floor Spawn Y
 * @desc Y coordinate for player spawn on floor 100
 * @type number
 * @default 10
 *
 * @param playerSpawnX
 * @text Player Spawn X
 * @desc Default X coordinate for player spawn on floors
 * @type number
 * @default 5
 *
 * @param playerSpawnY
 * @text Player Spawn Y
 * @desc Default Y coordinate for player spawn on floors
 * @type number
 * @default 5
 *
 * @param currentFloorVariable
 * @text Current Floor Variable
 * @desc Variable to store the current floor number
 * @type variable
 * @default 1
 *
 * @param maxFloorVariable
 * @text Maximum Floor Variable
 * @desc Variable to store the maximum floor reached
 * @type variable
 * @default 2
 *
 * @param elevatorFloorVariable
 * @text Elevator Floor Variable
 * @desc Variable that stores the floor number for elevator
 * @type variable
 * @default 17
 *
 * @param arenaToggleSwitch
 * @text Arena Toggle Switch
 * @desc Switch that determines whether to use the arena map instead of the town map
 * @type switch
 * @default 5
 *
 * @param dungeonGeneratedSwitch
 * @text Dungeon Generated Switch
 * @desc World switch turned ON once the world's dungeon layout has been generated.
 * @type switch
 * @default 2
 *
 * @command generateDungeon
 * @text Generate Dungeon
 * @desc Generates a new random dungeon layout and resets max floor
 *
 * @command nextFloor
 * @text Go to Next Floor
 * @desc Move to the next floor in the dungeon (upstairs)
 *
 * @command prevFloor
 * @text Go to Previous Floor
 * @desc Move to the previous floor in the dungeon (downstairs)
 *
 * @command setFloor
 * @text Set Floor
 * @desc Set a specific floor to visit (spawns near downstairs)
 *
 * @arg floor
 * @text Floor Number
 * @desc Floor number to visit (0 for town, 1-100 for dungeon floors)
 * @type number
 * @default 1
 *
 * @command elevator
 * @text Elevator
 * @desc Teleport to the floor stored in variable 17
 *
 * @command teleportToHighest
 * @text Teleport to Highest Floor
 * @desc Teleports the player to the highest floor they've reached
 *
 * @command teleportToNearestStairs
 * @text Teleport to Nearest Stairs
 * @desc Teleports the player to the nearest staircase on the current floor
 *
 * @command teleportToUpstairs
 * @text Teleport to Upstairs
 * @desc Teleports the player to the upstairs on the current floor
 *
 * @command teleportToDownstairs
 * @text Teleport to Downstairs
 * @desc Teleports the player to the downstairs on the current floor
 */

(() => {
  "use strict";

  const pluginName = "DungeonFloorSystem";

  //=============================================================================
  // Plugin Parameters
  //=============================================================================

  const parameters = PluginManager.parameters(pluginName);


  function createSeededRandom(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash = hash & hash;
    }
    let state = Math.abs(hash);
    return function () {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }

  window.DungeonFloorSystemParams = {
    levelAMaps: [
      9, [12, 139], 13, 14, [15, 140, 348, 406, 546, 543], [16, 429], 17, 18,
      [19, 332, 697, 698], [20, 344, 407], [21, 334, 336, 335], [22, 446],
      [23, 346], [24, 71], 26, 27, 29, [99, 329, 330], [31, 164, 425, 426],
      [34, 328], [32, 345, 428], [30, 316], 421
    ],
    levelBMaps: [
      25, 28, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
      51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, [693, 693, 695]
    ],
    levelCMaps: [
      62, [63, 622, 623, 629, 624, 626, 627, 628], 64, 66, 67, 68, 69, 70, 72,
      73, 74, 75, 77, 78, 79, 80, 81, 82, 83, 84
    ],
    levelDMaps: [
      2, 5, 6, 8, 11, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98,
      100, 126, 127, 129, 130, 131, 132
    ],
    levelEMaps: [
      176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189,
      190, 191, 192, 193, 194, 195
    ],
    levelFMaps: [
      196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209,
      210, 211, 212, 213, 214, 215
    ],
    levelGMaps: [
      216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229,
      230, 231, 232, 233, 234, 235
    ],
    levelHMaps: [
      236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249,
      250, 251, 252, 253, 254, 255, 256
    ],
    levelIMaps: [
      257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270,
      271, 272, 273, 274, 275, 276
    ],
    levelJMaps: [
      277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290,
      291, 292, 293, 294, 295, 296, 297, 298
    ],    
    elevatorMaps: [112,113,114,115,116,117,118,119],
    demoMode: String(parameters.demoMode) === "true",
    demoMaxFloor: 10,
    demoFinalMapId: 112,
    // Maps kept out of the demo's random floors (2 to 9). A listed map takes
    // its descendants with it: the maps hanging off it in the MapInfos tree
    // (interiors reached from that floor) and the whole multi-map group it
    // belongs to.
    demoExcludedMaps: [33, 733, 732, 735, 736, 737, 29, 691],
    // MapInfos folder holding the Level A floors. The demo draws from every
    // map in it, so a floor added to the folder is dealt without editing the
    // hand-listed pool above.
    levelAFolderId: 166,
    townMapId: parseInt(parameters.townMapId || 1),
    arenaMapId: parseInt(parameters.arenaMapId || 2),
    arenaMapX: parseInt(parameters.arenaMapX || 5),
    arenaMapY: parseInt(parameters.arenaMapY || 5),
    bossFloorMapId: parseInt(parameters.bossFloorMapId || 70),
    bossFloorX: parseInt(parameters.bossFloorX || 10),
    bossFloorY: parseInt(parameters.bossFloorY || 10),
    playerSpawnX: parseInt(parameters.playerSpawnX || 5),
    playerSpawnY: parseInt(parameters.playerSpawnY || 5),
    currentFloorVariable: parseInt(parameters.currentFloorVariable || 1),
    maxFloorVariable: parseInt(parameters.maxFloorVariable || 2),
    elevatorFloorVariable: parseInt(parameters.elevatorFloorVariable || 17),
    arenaToggleSwitch: parseInt(parameters.arenaToggleSwitch || 5),
    dungeonGeneratedSwitch: parseInt(parameters.dungeonGeneratedSwitch || 2),
  };

  const params = window.DungeonFloorSystemParams;

  //=============================================================================
  // Shared synchronous map-JSON cache. Map data files are static and read-only,
  // so parse each at most once per session instead of re-firing a blocking XHR
  // in every helper (event/treasure/region13/tiles/region20 all hit the same
  // files). Module-level (not on $gameSystem) so it never bloats the save.
  //=============================================================================
  const _mapDataCache = {};
  function loadMapDataSync(mapId) {
    if (_mapDataCache.hasOwnProperty(mapId)) return _mapDataCache[mapId];
    let mapData = null;
    try {
      const filename = "Map%1.json".format(mapId.padZero(3));
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "data/" + filename, false);
      xhr.overrideMimeType("application/json");
      xhr.send();
      if (xhr.status < 400) {
        mapData = JSON.parse(xhr.responseText);
      } else {
        console.error("Failed to load map data for mapId " + mapId);
      }
    } catch (e) {
      console.error("Error loading map data for mapId " + mapId, e);
    }
    _mapDataCache[mapId] = mapData;
    return mapData;
  }

  //=============================================================================
  // Game_System additions for dungeon data
  //=============================================================================

  const _Game_System_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function () {
    _Game_System_initialize.call(this);
    this.initDungeonSystem();
  };

  Game_System.prototype.initDungeonSystem = function () {
    if (!this._dungeonFloors) {
        this._dungeonFloors = new Array(101).fill(0);
        this._dungeonGenerated = false;
        this._mapRegion13Cache = {};
        
        this._stairLocations = new Array(101);
        for (let i = 0; i <= 100; i++) {
            this._stairLocations[i] = {
                upstairs: { mapId: 0, x: 0, y: 0 },
                downstairs: { mapId: 0, x: 0, y: 0 },
            };
        }
        
        this._elevatorSpawnPoints = {};
        this._eventPositions = {};
        this._treasureRoomPositions = {}; // ADD THIS LINE
    }
};

Game_System.prototype.generateEventPositions = function(mapId, floor) {
  const key = `${mapId}_${floor}`;
  if (this._eventPositions[key]) {
      return; // Already generated
  }

  let passableTiles = [];
  try {
      const mapData = loadMapDataSync(mapId);
      if (mapData) {
          passableTiles = this.findPassableTilesFromTilesets(mapData);
      }
  } catch (e) {
      console.error("Error loading map data for event positioning", e);
  }

  // Store the positions
  this._eventPositions[key] = passableTiles.slice(0, 10); // Store first 10 positions
};

// Add this function to cache Region 14 tiles (add after generateEventPositions function)
Game_System.prototype.generateTreasureRoomPosition = function(mapId, floor) {
  const key = `treasure_${mapId}_${floor}`;  // i18n-ignore  record key
  if (this._treasureRoomPositions && this._treasureRoomPositions[key]) {
      return; // Already generated
  }

  if (!this._treasureRoomPositions) {
      this._treasureRoomPositions = {};
  }

  let region14Tiles = [];
  try {
      const mapData = loadMapDataSync(mapId);
      if (mapData) {
          region14Tiles = this.findRegion14Tiles(mapData);
      }
  } catch (e) {
      console.error("Error loading map data for treasure room positioning", e);
  }

  // Store a randomly chosen Region 14 tile (or null if none exist)
  if (region14Tiles.length > 0) {
      const randomIndex = Math.floor(this._seededRandom() * region14Tiles.length);
      this._treasureRoomPositions[key] = region14Tiles[randomIndex];
  } else {
      this._treasureRoomPositions[key] = null;
  }
};

Game_System.prototype.findRegion14Tiles = function (mapData) {
  const width = mapData.width;
  const height = mapData.height;
  const region14Tiles = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const regionId = this.getRegionIdFromMapData(mapData, x, y);
      if (regionId === 14) {
        region14Tiles.push({ x, y });
      }
    }
  }
  return region14Tiles;
};


  Game_System.prototype.isDungeonGenerated = function () {
    return this._dungeonGenerated;
  };

  Game_System.prototype.hasRegion13 = function(mapId) {
      if (this._mapRegion13Cache.hasOwnProperty(mapId)) {
          return this._mapRegion13Cache[mapId];
      }

      let hasRegion = false;
      try {
          const mapData = loadMapDataSync(mapId);
          if (mapData) {
              const regionTiles = this.findRegion13Tiles(mapData);
              hasRegion = regionTiles.length > 0;
          }
      } catch (e) {
          console.error("Error parsing map data for mapId " + mapId, e);
          hasRegion = false;
      }

      this._mapRegion13Cache[mapId] = hasRegion;
      return hasRegion;
  };

  // The excluded demo maps plus every map that hangs off one of them in the
  // MapInfos tree, so an interior can never be dealt as a floor either.
  Game_System.prototype.demoExcludedMapIds = function () {
    const excluded = new Set(params.demoExcludedMaps);
    const infos = window.$dataMapInfos;
    if (Array.isArray(infos)) {
      let grew = true;
      while (grew) {
        grew = false;
        for (let id = 0; id < infos.length; id++) {
          const info = infos[id];
          if (info && !excluded.has(id) && excluded.has(info.parentId)) {
            excluded.add(id);
            grew = true;
          }
        }
      }
    }
    return excluded;
  };

  // The maps the demo may deal to floors 2 to 9: every Level A floor except the
  // excluded ones. An excluded map is never put into the pool, so no later step
  // can hand it out. Entries keep their multi-room groups.
  Game_System.prototype.demoFloorPool = function () {
    const excluded = this.demoExcludedMapIds();
    const allows = (entry) =>
      !(Array.isArray(entry) ? entry : [entry]).some((id) => excluded.has(id));

    const pool = [];
    const listed = new Set();
    for (const entry of params.levelAMaps) {
      for (const id of Array.isArray(entry) ? entry : [entry]) listed.add(id);
      if (allows(entry)) pool.push(entry);
    }

    // Any other map sitting directly in the Level A folder counts as a floor
    // too, so a map added to the folder is dealt without editing the list.
    const infos = window.$dataMapInfos;
    if (Array.isArray(infos)) {
      for (let id = 0; id < infos.length; id++) {
        const info = infos[id];
        if (info && info.parentId === params.levelAFolderId && !listed.has(id)) {
          if (allows(id)) pool.push(id);
        }
      }
    }
    return this.validateMapPool(pool);
  };

  // True when a stored demo layout still holds maps the exclusions now forbid,
  // or floors past the demo limit. Old saves generated under the previous rules
  // are rebuilt instead of being played as they are.
  Game_System.prototype.isDemoLayoutStale = function () {
    if (!params.demoMode || !this._dungeonGenerated) return false;
    const excluded = this.demoExcludedMapIds();
    for (let floor = 2; floor < params.demoMaxFloor; floor++) {
      const entry = this._dungeonFloors[floor];
      const ids = Array.isArray(entry) ? entry : [entry];
      if (ids.some((id) => excluded.has(id))) return true;
    }
    if (this._dungeonFloors[params.demoMaxFloor] !== params.demoFinalMapId) return true;
    for (let floor = params.demoMaxFloor + 1; floor <= 100; floor++) {
      if (this._dungeonFloors[floor]) return true;
    }
    return false;
  };

  // A map can host a floor only if it carries a Region 13 tile for the stairs.
  // A group is one floor spread over several rooms, so it needs two of them,
  // one for the way in and one for the way out; a group left with a single
  // usable room becomes an ordinary one-map floor rather than being thrown out.
  Game_System.prototype.validateMapPool = function (pool) {
    if (!pool) return [];
    return pool
      .map((entry) => {
        if (Array.isArray(entry)) {
          const valid = entry.filter((mapId) => this.hasRegion13(mapId));
          if (valid.length >= 2) return valid;
          return valid.length === 1 ? valid[0] : null;
        }
        return this.hasRegion13(entry) ? entry : null;
      })
      .filter((entry) => entry !== null);
  };

  Game_System.prototype.generateDungeon = function () {
    let historySeed = 19002001;
    if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
        historySeed = window.HistoryManager.getSeed();
    } else if ($gameSystem && $gameSystem._historySeed !== undefined) {
        historySeed = $gameSystem._historySeed;
    }
    this._seededRandom = createSeededRandom(String(historySeed));
    this._mapRegion13Cache = {}; // Clear cache on new generation

    this._dungeonFloors[0] = $gameSwitches.value(params.arenaToggleSwitch)
      ? params.arenaMapId
      : params.townMapId;
    // Demo mode structure: the dungeon ends at floor 10.
      if (params.demoMode) {
        // Floor 0: map 1 (already set above)
        // Floor 1: map 101
        this._dungeonFloors[1] = 101;

        // Floor 2 to (final - 1): Level A, minus the excluded maps
        const lastFloor = params.demoMaxFloor;
        const levelAPool = this.demoFloorPool();
        const uniqueNeeded = lastFloor - 2;
        for (let floor = 2; floor < lastFloor; floor++) {
            if (levelAPool.length > 0) {
                const index = Math.floor(this._seededRandom() * levelAPool.length);
                this._dungeonFloors[floor] = levelAPool[index];
                if (levelAPool.length >= uniqueNeeded) {
                    levelAPool.splice(index, 1); // Remove to avoid duplicates if enough maps
                }
            }
        }

        // Final demo floor: map 112
        this._dungeonFloors[lastFloor] = params.demoFinalMapId;

        // Floors past the demo limit stay empty and are unreachable.
        for (let floor = lastFloor + 1; floor <= 100; floor++) {
            this._dungeonFloors[floor] = 0;
        }

        this.initializeStairLocations();
        this.markDungeonGenerated();
        $gameVariables.setValue(params.maxFloorVariable, 0);
        return;
    }
    const levelMaps = [
      params.levelAMaps,
      params.levelBMaps,
      params.levelCMaps,
      params.levelDMaps,
      params.levelEMaps,
      params.levelFMaps,
      params.levelGMaps,
      params.levelHMaps,
      params.levelIMaps,
      params.levelJMaps,
    ];

    // --- VALIDATION LOGIC ---
    const validatedLevelMaps = levelMaps.map(levelMapPool =>
        this.validateMapPool(levelMapPool)
    );
    // --- END VALIDATION ---


    this._dungeonFloors[100] = params.bossFloorMapId;

    const elevatorFloors = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    const elevatorMaps = [...params.elevatorMaps];

    this._elevatorSpawnPoints = {};

    for (let i = 0; i < elevatorFloors.length; i++) {
      const floor = elevatorFloors[i];
      if (i < elevatorMaps.length) {
        this._dungeonFloors[floor] = elevatorMaps[i];
      } else {
        const randomIndex = Math.floor(
          this._seededRandom() * validatedLevelMaps[0].length
        );
        this._dungeonFloors[floor] = validatedLevelMaps[0][randomIndex];
      }
    }

    for (let level = 0; level < 10; level++) {
      const startFloor = level * 10 + 1;
      const endFloor = startFloor + 8;
      const levelMapPool = [...validatedLevelMaps[level]]; // Use validated maps
      const noDuplicates = levelMapPool.length >= 9;

      for (let floor = startFloor; floor <= endFloor; floor++) {
        if (floor === 1) {
          this._dungeonFloors[floor] = 101;
          continue;
        }
        if (levelMapPool.length === 0) {
            console.warn(`DungeonFloorSystem: No valid maps with Region ID 13 available for Level ${String.fromCharCode(65 + level)} (Floors ${startFloor}-${endFloor}).`);
            continue;
        };

        let index = Math.floor(this._seededRandom() * levelMapPool.length);
        const mapId = levelMapPool[index];
        this._dungeonFloors[floor] = mapId;

        if (noDuplicates) {
          levelMapPool.splice(index, 1);
        }
      }
    }

    this.initializeStairLocations();

    this.markDungeonGenerated();
    $gameVariables.setValue(params.maxFloorVariable, 0);

  };

  // The layout is world data, so the flag announcing it exists is a world
  // switch: every savegame of the world descends through the same hundred
  // floors, and events can tell a generated world from one that never got a
  // dungeon without reaching into $gameSystem.
  Game_System.prototype.markDungeonGenerated = function () {
    this._dungeonGenerated = true;
    if (typeof $gameSwitches !== "undefined" && $gameSwitches && params.dungeonGeneratedSwitch > 0) {
      $gameSwitches.setValue(params.dungeonGeneratedSwitch, true);
    }
  };


  Game_System.prototype.getDungeonFloorMapId = function (floor) {
    if (floor === 0) {
      return $gameSwitches.value(params.arenaToggleSwitch)
        ? params.arenaMapId
        : params.townMapId;
    }

    if (floor < 1 || floor > 100) return params.townMapId;

    const mapInfo = this._dungeonFloors[floor];

    if (typeof mapInfo === "number" && mapInfo > 0) {
      return mapInfo;
    }

    if (Array.isArray(mapInfo) && mapInfo.length > 0) {
      return mapInfo[0]; // Return the first map as the "primary" map for the group
    }

    return params.townMapId; // Fallback
  };

  Game_System.prototype.initializeStairLocations = function () {
    const maxFloor = params.demoMode ? params.demoMaxFloor : 99;
    for (let floor = 1; floor <= maxFloor; floor++) {
        this.initializeStairsForFloor(floor);
    }
};

  Game_System.prototype.initializeStairsForFloor = function (floor) {
    const mapInfo = this._dungeonFloors[floor];
    if (!mapInfo || floor === 1) return;

    const mapIdList = Array.isArray(mapInfo) ? mapInfo : [mapInfo];
    if (mapIdList.length === 0 || mapIdList[0] === 0) return;

    // Generate event positions and treasure room positions for all maps in this floor
    for (const mapId of mapIdList) {
        this.generateEventPositions(mapId, floor);
        this.generateTreasureRoomPosition(mapId, floor); // ADD THIS LINE
    }
    
    const defaultSpawn = (offset = 0) => ({
      mapId: mapIdList[0],
      x: params.playerSpawnX + offset,
      y: params.playerSpawnY,
    });

    // Helper to get tiles for a single map
    const getTilesForMap = (mapId) => {
      const mapData = loadMapDataSync(mapId);
      if (mapData) {
        try {
          const regionTiles = this.findRegion13Tiles(mapData);
          const passableTiles = this.findPassableTiles(mapData);
          return { regionTiles, passableTiles };
        } catch (e) {
          console.error("Error parsing map data for mapId " + mapId, e);
        }
      }
      return { regionTiles: [], passableTiles: [] };
    };

    if (mapIdList.length > 1) {
      // MULTI-MAP LOGIC (Receives pre-validated list)
      const shuffledMapIds = [...mapIdList];
      for (let i = shuffledMapIds.length - 1; i > 0; i--) {
        const j = Math.floor(this._seededRandom() * (i + 1));
        [shuffledMapIds[i], shuffledMapIds[j]] = [
          shuffledMapIds[j],
          shuffledMapIds[i],
        ];
      }

      const startRoomMapId = shuffledMapIds[0];
      const endRoomMapId = shuffledMapIds[shuffledMapIds.length - 1];

      // Set downstairs (PrevFloor) in the start room
      let { regionTiles: startRegion } = getTilesForMap(startRoomMapId);
      if (startRegion.length > 0) {
        const loc =
          startRegion[Math.floor(this._seededRandom() * startRegion.length)];
        this._stairLocations[floor].downstairs = { ...loc, mapId: startRoomMapId };
      } else {
        this._stairLocations[floor].downstairs = {
          ...defaultSpawn(),
          mapId: startRoomMapId,
        };
      }

      // Set upstairs (NextFloor) in the end room
      let { regionTiles: endRegion } = getTilesForMap(endRoomMapId);
      if (endRegion.length > 0) {
        if (startRoomMapId === endRoomMapId && endRegion.length > 1) {
          const downstairsLoc = this._stairLocations[floor].downstairs;
          endRegion = endRegion.filter(
            (t) => t.x !== downstairsLoc.x || t.y !== downstairsLoc.y
          );
           if (endRegion.length === 0) { 
             let { regionTiles: originalRegion } = getTilesForMap(endRoomMapId);
             endRegion = originalRegion;
          }
        }
        const loc =
          endRegion[Math.floor(this._seededRandom() * endRegion.length)];
        this._stairLocations[floor].upstairs = { ...loc, mapId: endRoomMapId };
      } else {
        this._stairLocations[floor].upstairs = {
          ...defaultSpawn(1),
          mapId: endRoomMapId,
        };
      }
    } else {
      // SINGLE-MAP LOGIC
      const mapId = mapIdList[0];
      const { regionTiles, passableTiles } = getTilesForMap(mapId);

      if (regionTiles.length >= 2) {
        for (let i = regionTiles.length - 1; i > 0; i--) {
          const j = Math.floor(this._seededRandom() * (i + 1));
          [regionTiles[i], regionTiles[j]] = [regionTiles[j], regionTiles[i]];
        }
        this._stairLocations[floor].upstairs = { ...regionTiles[0], mapId };
        this._stairLocations[floor].downstairs = { ...regionTiles[1], mapId };
      } else if (regionTiles.length === 1) {
          this._stairLocations[floor].upstairs = { ...regionTiles[0], mapId };
          if(passableTiles.length > 0){
               const loc = passableTiles[Math.floor(this._seededRandom() * passableTiles.length)];
               this._stairLocations[floor].downstairs = { ...loc, mapId };
          } else {
               this._stairLocations[floor].downstairs = { ...defaultSpawn(), mapId };
          }
      }
      else { // 0 region tiles (should be rare now, but kept as fallback)
        if (passableTiles.length >= 2) {
             for (let i = passableTiles.length - 1; i > 0; i--) {
                const j = Math.floor(this._seededRandom() * (i + 1));
                [passableTiles[i], passableTiles[j]] = [passableTiles[j], passableTiles[i]];
            }
            this._stairLocations[floor].upstairs = { ...passableTiles[0], mapId };
            this._stairLocations[floor].downstairs = { ...passableTiles[1], mapId };
        } else if (passableTiles.length === 1) {
            this._stairLocations[floor].upstairs = { ...passableTiles[0], mapId };
            this._stairLocations[floor].downstairs = { ...defaultSpawn(), mapId };
        } else {
            this._stairLocations[floor].upstairs = { ...defaultSpawn(), mapId };
            this._stairLocations[floor].downstairs = { ...defaultSpawn(1), mapId };
        }
      }
    }
  };
  
  Game_System.prototype.findRegion13Tiles = function (mapData) {
    const width = mapData.width;
    const height = mapData.height;
    const region13Tiles = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const regionId = this.getRegionIdFromMapData(mapData, x, y);
        if (regionId === 13) {
          region13Tiles.push({ x, y });
        }
      }
    }
    return region13Tiles;
  };

  Game_System.prototype.findPassableTiles = function (mapData) {
    const width = mapData.width || 50;
    const height = mapData.height || 50;
    const passableTiles = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x > 2 && x < width - 2 && y > 2 && y < height - 2) {
          const regionId = this.getRegionIdFromMapData(mapData, x, y);
          if (regionId >= 0 && regionId <= 9) {
            passableTiles.push({ x, y });
          }
        }
      }
    }

    if (passableTiles.length > 50) {
      for (let i = passableTiles.length - 1; i > 0; i--) {
        const j = Math.floor(this._seededRandom() * (i + 1));
        [passableTiles[i], passableTiles[j]] = [
          passableTiles[j],
          passableTiles[i],
        ];
      }
      return passableTiles.slice(0, 50);
    }
    return passableTiles;
  };

  Game_System.prototype.getRegionIdFromMapData = function (mapData, x, y) {
    const regionLayerIndex = 5; // In MZ, layer 5 is typically regions.
    const index =
      y * mapData.width + x + regionLayerIndex * mapData.width * mapData.height;
    if (mapData.data && index < mapData.data.length) {
      const regionId = mapData.data[index];
      if (regionId > 0 && regionId < 256) {
        return regionId;
      }
    }
    return 0;
  };

  Game_System.prototype.getStairLocation = function (floor, isUpstairs) {
    const defaultLoc = {
      mapId: params.townMapId,
      x: params.playerSpawnX,
      y: params.playerSpawnY,
    };
    if (floor < 0 || floor > 100 || !this._stairLocations[floor])
      return defaultLoc;

    const loc = isUpstairs
      ? this._stairLocations[floor].upstairs
      : this._stairLocations[floor].downstairs;
    return loc && loc.mapId > 0 ? loc : defaultLoc;
  };

  Game_System.prototype.updateMaxFloor = function (floor) {
    const currentMax = $gameVariables.value(params.maxFloorVariable) || 0;
    if (floor > currentMax) {
      $gameVariables.setValue(params.maxFloorVariable, floor);
    }
  };
  Game_System.prototype.findPassableTilesFromTilesets = function (mapData) {
    const width = mapData.width || 50;
    const height = mapData.height || 50;
    const passableTiles = [];
  
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Keep boundary check to avoid edge tiles
        if (x > 2 && x < width - 2 && y > 2 && y < height - 2) {
          if (this.isPassableTileFromTilesets(mapData, x, y)) {
            passableTiles.push({ x, y });
          }
        }
      }
    }
  
    // Shuffle using seeded random to ensure consistency
    if (passableTiles.length > 1 && this._seededRandom) {
      for (let i = passableTiles.length - 1; i > 0; i--) {
        const j = Math.floor(this._seededRandom() * (i + 1));
        [passableTiles[i], passableTiles[j]] = [passableTiles[j], passableTiles[i]];
      }
    }
  
    // Return up to 50 tiles
    return passableTiles.slice(0, 50);
  };
  
  

// Replace the existing isPassableTileFromTilesets function with this:
Game_System.prototype.isPassableTileFromTilesets = function (mapData, x, y) {
  // Check all layers for tiles from A1 or A5 tilesets
  const layersToCheck = [0, 1, 2]; // Bottom 3 layers typically contain terrain
  const index = y * mapData.width + x;

  for (const layer of layersToCheck) {
    const layerIndex = index + layer * mapData.width * mapData.height;
    if (mapData.data && layerIndex < mapData.data.length) {
      const tileId = mapData.data[layerIndex];
      if (tileId > 0) {
        // In RPG Maker MZ:
        // A1 tiles (animated water/ground): 2048-2815
        // A5 tiles (ground autotiles): 1536-1663
        if ((tileId >= 2048 && tileId <= 2815) ||  // A1 tiles
            (tileId >= 1536 && tileId <= 1663)) {   // A5 tiles
          return true;
        }
      }
    }
  }
  return false;
};
  //=============================================================================
  // World initialization
  //=============================================================================
  // The floor layout, the staircases, the treasure rooms and the chest
  // positions are all rolled from the world seed, so they belong to the world
  // and not to the run that first walked down the stairs. Generating them when
  // the world is made means the dungeon exists before anybody enters it (the
  // floor list, the elevator and "teleport to highest floor" all read a real
  // layout from the start) and every savegame of the world descends through
  // the same hundred floors.
  if (window.WorldManager && window.WorldManager.registerWorldInitializer) {
    window.WorldManager.registerWorldInitializer("dungeon", 40, () => {
      $gameSystem.initDungeonSystem();
      if (!$gameSystem.isDungeonGenerated() || $gameSystem.isDemoLayoutStale()) {
        $gameSystem.generateDungeon();
      } else {
        // The layout was already on disk (a world made before this step
        // existed). It still owes the world switch that says so.
        $gameSystem.markDungeonGenerated();
      }
    });
  }

  //=============================================================================
  // Plugin Commands
  //=============================================================================

  PluginManager.registerCommand(pluginName, "generateDungeon", (args) => {
    $gameSystem.generateDungeon();
  });

  PluginManager.registerCommand(pluginName, "nextFloor", (args) => {
    let currentFloor = $gameVariables.value(params.currentFloorVariable);
    // Map 635 is the dungeon base (floor 0). Reaching it via the world graph
    // (303/540/631), fast-travel or respawn can leave a stale floor value here,
    // which would route to the wrong floor or no-op. Force floor 0 so entering
    // always lands on the fixed first floor (accursed market).
    if ($gameMap.mapId() === 635) {
        currentFloor = 0;
        $gameVariables.setValue(params.currentFloorVariable, 0);
    }
    const maxFloor = params.demoMode ? params.demoMaxFloor : 100;
    if (currentFloor < 0 || currentFloor >= maxFloor) {
        return;
    }
    moveToFloor(currentFloor === 0 ? 1 : currentFloor + 1, true);
});

  PluginManager.registerCommand(pluginName, "prevFloor", (args) => {
    let currentFloor = $gameVariables.value(params.currentFloorVariable);
    // Map 101 is always floor 1 (hardcoded in generateDungeon). Arriving here by
    // any other route (fast travel, respawn, a stale/negative floor value) would
    // otherwise make the Exit events dead, so force floor 1 like map 635 forces 0.
    if ($gameMap.mapId() === 101) {
        currentFloor = 1;
        $gameVariables.setValue(params.currentFloorVariable, 1);
    }
    if (currentFloor <= 0) {
        return;
    }
    moveToFloor(currentFloor - 1, false); // false for going down
  });

  PluginManager.registerCommand(pluginName, "setFloor", (args) => {
    const floor = parseInt(args.floor || 1);
    const maxFloor = params.demoMode ? params.demoMaxFloor : 100;
    if (floor > maxFloor) {
        console.warn(`Demo mode: Cannot go beyond floor ${maxFloor}`);
        return;
    }
    moveToFloor(floor, "downstairs");
});
PluginManager.registerCommand(pluginName, "elevator", (args) => {
  const floor = $gameVariables.value(params.elevatorFloorVariable);
  const maxFloor = params.demoMode ? params.demoMaxFloor : 100;
  if (floor >= 0 && floor <= maxFloor) {
      moveToFloor(floor, "elevator");
  } else {
      console.error(
          "Invalid floor number in variable " +
          params.elevatorFloorVariable +
          ": " +
          floor +
          (params.demoMode ? T('DungeonFloor.demoLimit', { max: maxFloor }) : "")
      );
  }
});

  PluginManager.registerCommand(pluginName, "teleportToHighest", (args) => {
    const maxFloor = $gameVariables.value(params.maxFloorVariable);
    moveToFloor(maxFloor > 0 ? maxFloor : 1, null);
  });

  PluginManager.registerCommand(
    pluginName,
    "teleportToNearestStairs",
    (args) => {
      teleportToNearestStairs();
    }
  );

  PluginManager.registerCommand(pluginName, "teleportToUpstairs", (args) => {
    teleportToSpecificStairs(true);
  });

  PluginManager.registerCommand(pluginName, "teleportToDownstairs", (args) => {
    teleportToSpecificStairs(false);
  });

  //=============================================================================
  // Helper Functions
  //=============================================================================
  function findRegion20Spawn(mapId) {
    try {
      const mapData = loadMapDataSync(mapId);
      if (mapData) {
        const width = mapData.width;
        const height = mapData.height;

        // Search for the first tile with region ID 20
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const regionId = $gameSystem.getRegionIdFromMapData(mapData, x, y);
            if (regionId === 20) {
              return { x: x, y: y };
            }
          }
        }
      }
    } catch (e) {
      console.error("Error loading map data for elevator spawn on mapId " + mapId, e);
    }

    return null; // Return null if no region 20 tile found
  }
  
  function moveToFloor(floor, spawnMode) {
    if (!$gameSystem.isDungeonGenerated()) {
        $gameSystem.generateDungeon();
    } else if ($gameSystem.isDemoLayoutStale()) {
        // A save made before the demo rules changed still holds forbidden maps.
        // Rebuild it, keeping the floor the player had already reached.
        const reached = $gameVariables.value(params.maxFloorVariable) || 0;
        $gameSystem.generateDungeon();
        $gameVariables.setValue(
            params.maxFloorVariable,
            Math.min(reached, params.demoMaxFloor)
        );
    }

    const previousFloor = $gameVariables.value(params.currentFloorVariable);
    $gameVariables.setValue(params.currentFloorVariable, floor);
    $gameVariables.setValue(params.elevatorFloorVariable, floor);

    if (floor > 0) {
        $gameSystem.updateMaxFloor(floor);
    }

    let mapId, x, y, direction = 0;

    $gameScreen.startFadeOut(1);

    // Hardcoded transition: From Town/Home (Floor 0 or Map 635) to Floor 1
    if (floor === 1 && (previousFloor === 0 || $gameMap.mapId() === 635)) {
        mapId = 101;
        x = 16;
        y = 38;
        direction = 8; // Face up
    // Hardcoded transition: From Floor 1 to Town
    } else if (floor === 0 && previousFloor === 1) {
        mapId = 635;
        x = 13;
        // Land SOUTH of the stair tiles (12-14, 26), not north of them, so the
        // walk back into the room never re-touches them and bounces to floor 1.
        y = 27;
        direction = 2; // Face down
    // Generic "go to town" from any other floor
    } else if (floor === 0) {
        mapId = $gameSwitches.value(params.arenaToggleSwitch) ? params.arenaMapId : params.townMapId;
        x = $gameSwitches.value(params.arenaToggleSwitch) ? params.arenaMapX : params.playerSpawnX;
        y = $gameSwitches.value(params.arenaToggleSwitch) ? params.arenaMapY : params.playerSpawnY;
    } else if (floor === 100) {
        mapId = params.bossFloorMapId;
        x = params.bossFloorX;
        y = params.bossFloorY;
    } else if (floor === 1 && previousFloor === 2) {
        mapId = $gameSystem.getDungeonFloorMapId(1);
        x = 17;
        y = 19;
        direction = 2;
    } else {
        let stairLocation;
        switch (spawnMode) {
            case "elevator":
                mapId = $gameSystem.getDungeonFloorMapId(floor);
                const elevatorSpawn = findRegion20Spawn(mapId);
                if (elevatorSpawn) {
                    x = elevatorSpawn.x;
                    y = elevatorSpawn.y;
                    direction = 2; // Face downwards
                } else {
                    stairLocation = $gameSystem.getStairLocation(floor, false);
                    mapId = stairLocation.mapId;
                    x = stairLocation.x;
                    y = stairLocation.y;
                    direction = 2; // Face downwards
                }
                break;
            case true: // Going up
                stairLocation = $gameSystem.getStairLocation(floor, false); // Arrive at downstairs
                mapId = stairLocation.mapId;
                x = stairLocation.x;
                y = stairLocation.y;
                break;
            case false: // Going down
                stairLocation = $gameSystem.getStairLocation(floor, true); // Arrive at upstairs
                mapId = stairLocation.mapId;
                x = stairLocation.x;
                y = stairLocation.y;
                break;
            case "downstairs":
                stairLocation = $gameSystem.getStairLocation(floor, false);
                mapId = stairLocation.mapId;
                x = stairLocation.x; 
                y = stairLocation.y;
                break;
            default: // Default/fallback spawn
                mapId = $gameSystem.getDungeonFloorMapId(floor);
                x = params.playerSpawnX;
                y = params.playerSpawnY;
                break;
        }
    }

    if (mapId > 0) {
        $gamePlayer.reserveTransfer(mapId, x, y, direction);
    } else {
        console.error("DungeonFloorSystem: Invalid Map ID (0) for floor " + floor);
    }
  }
  

  function teleportToNearestStairs() {
    const currentFloor = $gameVariables.value(params.currentFloorVariable);
    const currentMapId = $gameMap.mapId();
    if (currentFloor <= 0 || currentFloor >= 100) return;

    const upstairsLoc = $gameSystem.getStairLocation(currentFloor, true);
    const downstairsLoc = $gameSystem.getStairLocation(currentFloor, false);
    const playerX = $gamePlayer.x;
    const playerY = $gamePlayer.y;

    let distToUpstairs = Infinity;
    if (upstairsLoc.mapId === currentMapId) {
      distToUpstairs = Math.hypot(
        playerX - upstairsLoc.x,
        playerY - upstairsLoc.y
      );
    }

    let distToDownstairs = Infinity;
    if (downstairsLoc.mapId === currentMapId) {
      distToDownstairs = Math.hypot(
        playerX - downstairsLoc.x,
        playerY - downstairsLoc.y
      );
    }

    let targetLoc = null;
    if (distToUpstairs <= distToDownstairs && distToUpstairs !== Infinity) {
      targetLoc = upstairsLoc;
    } else if (
      distToDownstairs < distToUpstairs &&
      distToDownstairs !== Infinity
    ) {
      targetLoc = downstairsLoc;
    }

    if (targetLoc) {
      teleportToAdjacentTile(targetLoc.x, targetLoc.y);
    }
  }

  function teleportToSpecificStairs(isUpstairs) {
    const currentFloor = $gameVariables.value(params.currentFloorVariable);
    const currentMapId = $gameMap.mapId();
    if (currentFloor <= 0 || currentFloor >= 100) return;
  
    const stairLoc = $gameSystem.getStairLocation(currentFloor, isUpstairs);
  
    if (stairLoc.mapId === currentMapId) {
      // Same map - just teleport adjacent to the stairs
      teleportToAdjacentTile(stairLoc.x, stairLoc.y);
    } else {
      // Different map - check if it's part of the same multi-room floor
      const floorMapInfo = $gameSystem._dungeonFloors[currentFloor];
      
      // Check if this floor is a multi-room floor
      if (Array.isArray(floorMapInfo) && floorMapInfo.includes(currentMapId) && floorMapInfo.includes(stairLoc.mapId)) {
        // Both maps are part of the same multi-room floor, so transfer to the other map
        $gameScreen.startFadeOut(10);
        $gamePlayer.reserveTransfer(stairLoc.mapId, stairLoc.x, stairLoc.y, 0);
      }
      // If not part of same multi-room floor, do nothing (stairs aren't accessible)
    }
  }

  function teleportToAdjacentTile(targetX, targetY) {
    const directions = [
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -1 },
    ];

    for (const dir of directions) {
      const checkX = targetX + dir.dx;
      const checkY = targetY + dir.dy;
      if ($gameMap.isPassable(checkX, checkY, 0)) {
        $gamePlayer.locate(checkX, checkY);
        $gameScreen.startFlash([0, 0, 0, 128], 30);
        return;
      }
    }

    $gamePlayer.locate(targetX, targetY);
    $gameScreen.startFlash([0, 0, 0, 128], 30);
  }


  function repositionStairEvents() {
    if (!$gameMap || !$gameSystem || !$gameSystem._stairLocations) return;

    const currentMapId = $gameMap.mapId();
    // 635 is the fixed dungeon base (floor 0). Its NextFloor event is hand-placed
    // and must never be repositioned/hidden by the generated-floor logic, otherwise
    // a stale current-floor value would relocate it off-map and it can never be touched.
    if (currentMapId === 1 || currentMapId === 101 || currentMapId === 300 || currentMapId === 635) {
        return;
    }

    const currentFloor = $gameVariables.value(params.currentFloorVariable);
    if (currentFloor <= 0 || currentFloor >= 100) return;

    const upstairsLoc = $gameSystem.getStairLocation(currentFloor, true);
    const downstairsLoc = $gameSystem.getStairLocation(currentFloor, false);

    const key = `${currentMapId}_${currentFloor}`;
    // Old saves may have _dungeonFloors but no _eventPositions (initDungeonSystem
    // only seeds it when _dungeonFloors is absent); guard so map load doesn't throw.
    const passableTiles = ($gameSystem._eventPositions && $gameSystem._eventPositions[key]) || [];
    
    // Get treasure room position
    const treasureKey = `treasure_${currentMapId}_${currentFloor}`;  // i18n-ignore  record key
    const treasureRoomPosition = $gameSystem._treasureRoomPositions ? 
        $gameSystem._treasureRoomPositions[treasureKey] : null;

    const events = $gameMap.events();
    const randomEventNames = ["RandomItemChest", "RandomArmorChest", "RandomWeaponChest", "LearnSkill"];
    
    let passableTileIndex = 0;

    for (const event of events) {
        if (!event || !event.event()?.name) continue;

        const eventName = event.event().name;

        if (eventName === "NextFloor") {
            // The last demo floor has nowhere to go up to, so the staircase is
            // removed instead of being left as a dead interaction.
            if (params.demoMode && currentFloor >= params.demoMaxFloor) {
                event.locate(-1, -1);
                event.setOpacity(0);
            } else if (upstairsLoc.mapId === currentMapId) {
                event.locate(upstairsLoc.x, upstairsLoc.y);
                event.setOpacity(255);
                event.setThrough(true);
            } else {
                event.locate(-1, -1);
                event.setOpacity(0);
            }
        } else if (eventName === "PrevFloor") {
            if (downstairsLoc.mapId === currentMapId) {
                event.locate(downstairsLoc.x, downstairsLoc.y);
                event.setOpacity(255);
                event.setThrough(true);
            } else {
                event.locate(-1, -1);
                event.setOpacity(0);
            }
        } else if (eventName === "TreasureRoom") {
            if (treasureRoomPosition) {
                event.locate(treasureRoomPosition.x, treasureRoomPosition.y);
                event.setOpacity(255);
                event.setThrough(false);
            } else {
                event.locate(-1, -1);
                event.setOpacity(0);
            }
        } else if (randomEventNames.includes(eventName)) {
            if (passableTiles.length > passableTileIndex) {
                const tile = passableTiles[passableTileIndex];
                event.locate(tile.x, tile.y);
                event.setOpacity(255);
                event.setThrough(false);
                passableTileIndex++;
            } else {
                event.locate(params.playerSpawnX + passableTileIndex, params.playerSpawnY);
                event.setOpacity(255);
                event.setThrough(false);
                passableTileIndex++;
            }
        }
    }
}

  // Helper function to check if current map is a dungeon map
  function isDungeonMap(mapId) {
    if (!mapId || mapId <= 0) return false;

    // Check if map is in any of the dungeon floor lists
    const allDungeonMaps = [
      ...params.levelAMaps,
      ...params.levelBMaps,
      ...params.levelCMaps,
      ...params.levelDMaps,
      ...params.levelEMaps,
      ...params.levelFMaps,
      ...params.levelGMaps,
      ...params.levelHMaps,
      ...params.levelIMaps,
      ...params.levelJMaps,
      ...params.elevatorMaps
    ];

    // Flatten array in case of nested arrays and check if mapId is included
    for (const entry of allDungeonMaps) {
      if (Array.isArray(entry)) {
        if (entry.includes(mapId)) return true;
      } else if (entry === mapId) {
        return true;
      }
    }

    // Also check boss floor
    if (mapId === params.bossFloorMapId) return true;

    return false;
  }

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    _Scene_Map_onMapLoaded.call(this);
    repositionStairEvents();

    // Disable saving in dungeon maps, enable it outside
    const currentMapId = $gameMap.mapId();
    if (isDungeonMap(currentMapId)) {
      $gameSystem.disableSave();
    } else {
      $gameSystem.enableSave();
    }

    $gameScreen.startFadeIn(15);
  };


})();