 /*
 * @target MZ
 * @plugindesc Enhanced Autonomous NPC System v2.1.0 - TreasureRoom Integration (Refactored)
 * @author Omni-Lex
 * @help
 * ============================================================================
 * Enhanced Autonomous NPC System - TreasureRoom Integration
 * ============================================================================
 * (Help text remains identical to original)
 * ...
 */

(() => {
  "use strict";

  // ==========================================================================
  // CONFIGURATION & CONSTANTS
  // ==========================================================================
  const pluginName = "NPCSystem";
  const parameters = PluginManager.parameters(pluginName);

  const Config = {
    debugMode: parameters["debugMode"] === "true",
    playerAwarenessRange: Number(parameters["playerAwarenessRange"]) || 4,

    Zones: {
      SOCIAL: 101,
      // Seat tile for the PublicTransport group (bus/tram/train interiors),
      // see SpawnManager.randomizePublicTransportMap.
      TRANSPORT_SEAT: 102,
    },

    // Interiors of the party's own vehicles (camper, taxi, car, low-orbit
    // ship, the 3D camper). They still carry <MapGroup: PublicTransport> so
    // their authored events keep feeding the world pool, but nobody is ever
    // spawned inside them: the only people riding the player's vehicle are the
    // party. The Player1-8 slots on those maps stay untouched, they are the
    // MultiplayerSystem avatar slots and carry no graphic of their own.
    NPC_FREE_MAP_IDS: [327, 720, 721, 1094, 1412],

    isNPCFreeMap(mapId) {
      return this.NPC_FREE_MAP_IDS.includes(mapId);
    },

    treasureRoomParentIds: [133],
    get housePoolParentIds() {
      return window.ProceduralHouseSystem ? window.ProceduralHouseSystem.housePoolParentIds : [1132, 1133, 1134, 1135, 1136, 1137, 1394, 1156, 1157];
    },

    // MapGroups are no longer hardcoded here, they're discovered at runtime
    // straight from each map's <MapGroup: Name> / <MainMap> note tags (see
    // GroupRegistry below). Defining a new group is now just a matter of
    // tagging the relevant maps' notes, no code changes needed.
    //
    // "OmegaTower" keeps its historical role as the *global* group: it draws
    // NPCs from (and lends NPCs to) every other group's pool, rather than
    // staying confined to its own member maps.
    GLOBAL_GROUP_NAME: "OmegaTower",

    // Other groups that behave like the global group for pooling purposes
    // (draw NPCs from, and lend NPCs to, every other group) but use their own
    // placement logic instead of OmegaTower's "spread across every passable
    // tile" style. PublicTransport (buses/trams/trains) seats riders on
    // <TRANSPORT_SEAT> region tiles instead, see randomizePublicTransportMap.
    SEATED_GLOBAL_GROUPS: ["PublicTransport"],

    // True for any group that draws its NPC pool from the whole world rather
    // than staying confined to its own member maps (OmegaTower and any of the
    // seated variants, e.g. PublicTransport).
    isGlobalGroup(groupName) {
      return groupName === this.GLOBAL_GROUP_NAME || this.SEATED_GLOBAL_GROUPS.includes(groupName);
    },

    // True for a per-coordinate settlement group ("Proc:x,y") minted by the
    // map generator as the player reaches those world coordinates, as opposed
    // to a hand-made group tagged on authored maps. Procedural settlements are
    // world data, so they are skipped by anything working off the shared
    // WorldGen manifests (see initializeWorldgenManifests).
    isProceduralGroup(groupName) {
      return typeof groupName === "string" && groupName.startsWith("Proc:");  // i18n-ignore: settlement key prefix
    },

    // Fraction of PublicTransport seats left empty on each spawn, so a bus/
    // tram never reads as unrealistically packed.
    TRANSPORT_SEAT_EMPTY_RATIO: 0.3,

    // Omega City (map 631) is the largest city in the game and the one
    // deliberate exception to the spawn rules above: instead of the global
    // group's density-capped crowd it fields a fixed fifty citizens, half of
    // them drawn from every authored map pool in the world and half generated
    // fresh as procedural citizens of the city, and every one of them is given
    // one of the city's own front doors as an address. See
    // SpawnManager.randomizeOmegaCityMap.
    OMEGA_CITY_MAP_ID: 631,
    OMEGA_CITY_NPC_COUNT: 50,
    // Share of that headcount generated procedurally rather than transplanted
    // from an authored template.
    OMEGA_CITY_PROCEDURAL_RATIO: 0.5,

    // Fixed seed for placeholder-name ("NPC") Markov generation, deliberately
    // independent of the world's history seed so generated names stay stable
    // even across different history seeds/world generations.
    NPC_NAME_SEED: 70737501,

    // Real-world window inside which re-entering a map is treated as a "quick
    // bounce", the roster there (and the rosters of other recently-visited
    // maps) is kept exactly as-is rather than reshuffled or drifted.
    GROUP_RECENT_VISIT_MS: 60000,
    // In-game-minute jump (in a single tick) large enough that it can only be
    // produced by sleeping/fast-travel/time-skip commands, never by walking
    // (which advances at most 1 minute per 10 steps), our signal that "time
    // was skipped" and group hangout assignments should be redetermined.
    GROUP_TIME_SKIP_MINUTES: 60,

    NAME_DATABASES: ["entomologist", "perifery", "temporal_drift", "petro_vessel", "wannabe_wizard", "inmate", "girlboss", "fortune_teller", "rapper", "cleaner", "priest", "guide", "farmer", "taxi", "blacksmith", "steelworker", "artist", "hypernet_worker", "politician", "elven_ambassador", "dungeon_explorer", "mailman", "communist_preacher", "shy_vampire", "decadent_noble", "goth", "thug", "scribe", "zombie_alien", "commuter", "fae_queen", "caveman", "fisherman", "semiwild_goblin", "botique", "icecream"]
  };

  // Character pool built from NPCs.json (npc:true entries), replaces the old hardcoded
  // CHARACTER_GRAPHICS + SKAB_CHARACTER_GRAPHICS arrays.
  // DataService loads window.WorldGen.NPCs synchronously before any plugin IIFE runs.
  let _npcCharPool = null;
  function buildNPCCharacterPool() {
    if (_npcCharPool) return _npcCharPool;
    const npcData = window.WorldGen?.NPCs;
    if (!npcData) return [];
    _npcCharPool = Object.keys(npcData).filter(k => npcData[k].npc === true);
    return _npcCharPool;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  const Utils = {
    debug: (message) => {
      if (Config.debugMode) console.log(`[NPC System] ${message}`);
    },
    distance: (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    euclideanDistance: (a, b) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    },
    randomElement: (array) => array[Math.floor(Math.random() * array.length)],
    randBetween: (min, max) => min + Math.random() * (max - min),
    // Stable string hash (delegates to NPCShared so it matches the seeds used
    // by the simulation core; falls back to a small inline hash if unavailable).
    nameHash: (str) => {
      if (window.NPCShared?.nameHash) return window.NPCShared.nameHash(str);
      let h = 0;
      const s = str || "";
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return h;
    },
    // Stateless (seed -> float in [0,1)) draw used for world-persistent NPC
    // identity (name/sprite picks). Delegates to NPCShared.Rng (xorshift32) for
    // a well-distributed avalanche instead of the old weak Math.sin(seed)*10000
    // hash. Falls back to an inline xorshift step if NPCShared is unavailable.
    seededRandom: (seed) => {
      const s = (seed >>> 0) || 1;
      if (window.NPCShared?.Rng) return new window.NPCShared.Rng(s).next();
      let x = s;
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5;  x >>>= 0;
      return x / 4294967296;
    },
    // Unbiased Fisher-Yates shuffle (returns a new array). Replaces the biased
    // `sort(() => Math.random() - 0.5)` idiom warned about in getSpreadSpawnTiles.
    shuffle: (array) => {
      const a = array.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
      }
      return a;
    },
    // Matches "AI" as its own word (e.g. "AI NPC-61 Local", "NPC-62 AI 0"),
    // a plain substring check also fires on unrelated notes like "<link:paint1>".
    hasAITag: (note) => /\bai\b/i.test(note || ""),
    // "Local" NPCs are anchored to the map they're defined on (always spawn
    // there) but their template can still travel, see buildNPCPool.
    hasLocalTag: (note) => /local/i.test(note || ""),
    // "Shop" marks a counter event with no graphic of its own, it's covered
    // in shifts by NPC personas drawn from the map group (see ShopShiftManager
    // in NPCSimulationCore.js). Matches as a standalone word, mirroring
    // hasAITag/hasLocalTag's convention (no angle brackets).
    hasShopTag: (note) => /\bshop\b/i.test(note || ""),
    // "Hidden" NPCs exist fully in the simulation (society, schedule, dialogue)
    // but never show a sprite on the map, see SpawnManager.transplantData and
    // ShopShiftManager._candidates (NPCSimulationCore.js).
    hasHiddenTag: (note) => /\bhidden\b/i.test(note || ""),
    // <ShopName: Ticketman> can live in the event's note or in any comment
    // command (codes 108/408) on any page, used to label the persona's
    // schedule entry ("working as Ticketman") instead of the generic
    // shopkeeper title. Accepts raw event data (not a Game_Event).
    extractShopName: (eventData) => {
      if (!eventData) return null;
      const re = /<ShopName:\s*(.+?)>/i;
      let m = (eventData.note || "").match(re);
      if (m) return m[1].trim();
      for (const page of (eventData.pages || [])) {
        for (const cmd of (page?.list || [])) {
          if (cmd.code !== 108 && cmd.code !== 408) continue;
          m = String(cmd.parameters?.[0] || "").match(re);
          if (m) return m[1].trim();
        }
      }
      return null;
    },
    isExitEvent: (name) => name.startsWith("House") || name.startsWith("Transfer") || name.startsWith("Door ("), // i18n-ignore: event names matched at runtime
    // An interactable door an NPC walks *through* (opens it, then keeps heading
    // for its objective), as opposed to a "Door (...)" map-exit (handled by
    // isExitEvent). Matches any event whose name contains the word "door".
    isWalkThroughDoor: (name) => !!name && name.toLowerCase().includes("door") && !name.startsWith("Door ("), // i18n-ignore: event names matched at runtime
    isValidTileType: (x, y) => {
      if (!$dataMap) return false;
      const tileId = $gameMap.tileId(x, y, 0);
      return (tileId >= 1536 && tileId < 1664) || (tileId >= 2048 && tileId < 2816) || (tileId >= 2816 && tileId < 4352);
    },
    // A single passable tile can still be a one-tile-wide corridor; spawning an
    // NPC there blocks it. Require a free (passable in every direction AND
    // unoccupied by events) 2x2 block anchored at (x,y) so NPCs only spawn
    // where they (and the player) can still move around them (#21).
    has2x2FreeArea: (x, y) => {
      for (let dx = 0; dx <= 1; dx++) {
        for (let dy = 0; dy <= 1; dy++) {
          const tx = x + dx, ty = y + dy;
          if (tx >= $gameMap.width() || ty >= $gameMap.height()) return false;
          if (![2, 4, 6, 8].every(dir => $gameMap.isPassable(tx, ty, dir))) return false;
          if ($gameMap.eventsXy(tx, ty).length > 0) return false;
        }
      }
      return true;
    }
  };

  // ==========================================================================
  // MAP & DATA MANAGEMENT
  // ==========================================================================
  const MapManager = {
    getMapName: (mapId) => ($dataMapInfos && $dataMapInfos[mapId]) ? $dataMapInfos[mapId].name : T('NPCSystem.mapFallback', { id: mapId }),
    isMapChild: (mapId, parentIds) => {
      if (!mapId || typeof mapId !== "number" || !$dataMapInfos || !$dataMapInfos[mapId]) return false;
      return parentIds.includes($dataMapInfos[mapId].parentId);
    },
    isTreasureRoom: (mapId) => MapManager.isMapChild(mapId, Config.treasureRoomParentIds),
    isHouseMap: (mapId) => MapManager.isMapChild(mapId, Config.housePoolParentIds),

    // Stores the active group by NAME, group membership is resolved on
    // demand via GroupRegistry, so there's no object identity to keep in sync.
    setCurrentMapGroup: (groupName) => {
      if (!$gameSystem) return;
      $gameSystem._npcSystemCurrentMapGroup = groupName || null;
    },
    getCurrentMapGroup: () => $gameSystem ? $gameSystem._npcSystemCurrentMapGroup : null,

    findMapGroupByMap: (mapId) => GroupRegistry.findGroupByMap(mapId),

    getNPCSpawnLimit: () => MapManager.isHouseMap($gameMap.mapId()) ? 3 : 8,

    // Night window is 22:00-06:00 (variable 23 = current hour)
    isNightTime: () => {
      const hour = $gameVariables?.value(23) ?? 12;
      return hour >= 22 || hour < 6;
    },

    // <Interior>/<Exterior> tag for any map in a pool, derived from cached map data.
    // Cached permanently once known (the tag never changes); maps not yet loaded
    // resolve to "None" until their data becomes available.
    getMapEnvironmentTag: (mapId) => {
      $gameSystem._npcMapTags = $gameSystem._npcMapTags || {};
      const cached = $gameSystem._npcMapTags[mapId];
      if (cached) return cached;

      const data = ($dataMap && $dataMap.id === mapId) ? $dataMap : MapManager.getCachedMapData(mapId);
      if (!data?.note) return "None";

      const tag = data.note.includes("<Interior>") ? "Interior"
        : data.note.includes("<Exterior>") ? "Exterior" : "None";
      $gameSystem._npcMapTags[mapId] = tag;
      return tag;
    },

    findPassableTerrainTiles: () => {
      if (!$dataMap) return [];
      const mapId = $gameMap.mapId();
      if ($gameMap._passableTerrainCache && $gameMap._passableTerrainCache.mapId === mapId) {
        return $gameMap._passableTerrainCache.tiles;
      }

      const passableTiles = [];
      const w = $gameMap.width();
      const h = $gameMap.height();

      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          if (![2, 4, 6, 8].some(dir => $gameMap.isPassable(x, y, dir))) continue;

          const regionId = $gameMap.regionId(x, y);
          // Region 10/103: blocked tiles. Region 99: water (CLAUDE.md). Region 11
          // is an explicitly allowed spawn region (NPCs may stand on it).
          if (regionId === 10 || regionId === 103 || regionId === 99) continue;
          // Water tiles (terrain tag 3) are not walkable for NPCs.
          if ($gameMap.terrainTag(x, y) === 3) continue;
          if ($gameMap.eventsXy(x, y).length > 0) continue;

          if (Utils.isValidTileType(x, y) && Utils.has2x2FreeArea(x, y)) {
            passableTiles.push({ x, y });
          }
        }
      }
      $gameMap._passableTerrainCache = { mapId, tiles: passableTiles };
      return passableTiles;
    },

    // Seat tiles for the PublicTransport group (region 102, see
    // SpawnManager.randomizePublicTransportMap). Unlike findPassableTerrainTiles,
    // seats don't need a free 2x2 area around them (a row of bus seats is
    // packed tight, only the aisle side needs to be walkable), they just need
    // to be a real tile that isn't already claimed by another event.
    getSeatTiles: () => {
      if (!$dataMap) return [];
      const seats = [];
      const w = $gameMap.width();
      const h = $gameMap.height();
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          if ($gameMap.regionId(x, y) !== Config.Zones.TRANSPORT_SEAT) continue;
          if ($gameMap.eventsXy(x, y).length > 0) continue;
          seats.push({ x, y });
        }
      }
      return seats;
    },

    // Spawn tiles ordered for maximum spread across the whole map. The old
    // `findPassableTerrainTiles().sort(() => Math.random() - 0.5)` is a biased,
    // non-uniform shuffle (V8's sort leaves elements near their original
    // top-left iteration order), so the first N picks bunched up in one region
    // near the player/start instead of scattering. Here we do a real
    // Fisher-Yates shuffle, then farthest-first reorder the leading picks so
    // each successive spawn tile is pushed away from the ones already chosen.
    getSpreadSpawnTiles: () => {
      const src = MapManager.findPassableTerrainTiles();
      if (src.length <= 2) return src.slice();

      const tiles = src.slice();
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = tiles[i]; tiles[i] = tiles[j]; tiles[j] = tmp;
      }

      // Farthest-first dispersion with incremental nearest-distance tracking
      // (~O(cap * tiles)). Capped because no map fields more spawns than this,
      // and the unordered (still shuffled) remainder covers any overflow.
      const cap = Math.min(64, tiles.length);
      const picked = [tiles[0]];
      const rest = tiles.slice(1);
      const minDist = rest.map(t => Math.abs(t.x - picked[0].x) + Math.abs(t.y - picked[0].y));
      for (let k = 1; k < cap && rest.length; k++) {
        let bi = 0, bd = -1;
        for (let r = 0; r < rest.length; r++) {
          if (minDist[r] > bd) { bd = minDist[r]; bi = r; }
        }
        const chosen = rest[bi];
        picked.push(chosen);
        const last = rest.length - 1;
        rest[bi] = rest[last]; rest.pop();
        minDist[bi] = minDist[last]; minDist.pop();
        for (let r = 0; r < rest.length; r++) {
          const d = Math.abs(rest[r].x - chosen.x) + Math.abs(rest[r].y - chosen.y);
          if (d < minDist[r]) minDist[r] = d;
        }
      }
      return picked.concat(rest);
    },

    _mapCache: {},

    loadMapData: (mapId) => {
      if ($dataMap && $dataMap.id === mapId) return $dataMap;
      if (MapManager._mapCache[mapId]) return MapManager._mapCache[mapId];

      const mapFileName = `Map${String(mapId).padStart(3, "0")}.json`;
      let parsedData = null;

      try {
        if (typeof StorageManager !== "undefined" && StorageManager.fileExists) {
          const fullPath = (StorageManager.isLocalMode ? "data/" : "data/") + mapFileName;
          if (StorageManager.fileExists(fullPath)) {
            parsedData = JSON.parse(StorageManager.fileRead(fullPath));
          }
        }
      } catch (e) { }

      if (!parsedData) {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", `data/${mapFileName}`, false);
          xhr.send();
          if (xhr.status === 200) parsedData = JSON.parse(xhr.responseText);
        } catch (e) { }
      }

      if (!parsedData && window.$dataMap && window.$dataMap.id === mapId) {
        parsedData = window.$dataMap;
      }

      if (parsedData) {
        MapManager._mapCache[mapId] = parsedData;
        if ($gameSystem) {
          $gameSystem._npcMapSizes = $gameSystem._npcMapSizes || {};
          $gameSystem._npcMapSizes[mapId] = parsedData.width * parsedData.height;
        }
      }

      return parsedData;
    },

    getCachedMapData: (mapId) => {
      return MapManager._mapCache[mapId];
    },

    getMapZones: () => {
      if (!$dataMap) return { social: [] };
      if ($gameMap._npcZoneCache && $gameMap._npcZoneCache.mapId === $gameMap.mapId()) {
        return $gameMap._npcZoneCache.zones;
      }

      const z = { social: [] };
      const w = $gameMap.width();
      const h = $gameMap.height();

      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          if ($gameMap.regionId(x, y) === Config.Zones.SOCIAL) z.social.push({ x, y });
        }
      }

      $gameMap._npcZoneCache = { mapId: $gameMap.mapId(), zones: z };
      return z;
    },

    loadMapSizeAsync: (mapId) => {
      if ($gameSystem && $gameSystem._npcMapSizes && $gameSystem._npcMapSizes[mapId]) return;
      const mapFileName = `Map${String(mapId).padStart(3, "0")}.json`;

      if (typeof fetch === "function") {
        fetch(`data/${mapFileName}`)
          .then(response => response.json())
          .then(data => {
            if (data && $gameSystem) {
              $gameSystem._npcMapSizes = $gameSystem._npcMapSizes || {};
              $gameSystem._npcMapSizes[mapId] = data.width * data.height;
            }
          })
          .catch(() => {});
      } else {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", `data/${mapFileName}`, true);
          xhr.onload = () => {
            if (xhr.status === 200) {
              try {
                const data = JSON.parse(xhr.responseText);
                if (data && $gameSystem) {
                  $gameSystem._npcMapSizes = $gameSystem._npcMapSizes || {};
                  $gameSystem._npcMapSizes[mapId] = data.width * data.height;
                }
              } catch (e) {}
            }
          };
          xhr.send();
        } catch (e) {}
      }
    }
  };

  // ==========================================================================
  // GROUP REGISTRY, MapGroups derived from <MapGroup: Name>/<MainMap> notes
  // ==========================================================================
  // MapGroups used to be a hardcoded table of map-id arrays. They're now read
  // straight off each map's note tags instead, so a new group only needs the
  // relevant maps tagged, no plugin code changes:
  //   <MapGroup: Ghent>   → this map belongs to the "Ghent" group
  //   <MainMap>           → (within a group) this map is one of its "hubs":
  //                          always fully populated, and the social heart
  //                          NPCs from outlying maps "visit" while it's active
  // Tolerant of both "<MapGroup: Name>" and "<MapGroup Name>", both forms
  // already exist in the shipped map data.
  //
  // PERFORMANCE NOTE: building this requires reading the `note` field of every
  // map in the game, and MZ stores notes inside each map's own JSON file
  // alongside its full event/tile data, so there's no lighter-weight source to
  // read them from. This project currently has ~1480 maps (~106MB of map data
  // total): a live scan loads and parses every single one of them
  // synchronously, which would cause a multi-second (quite possibly 10+
  // second) freeze on the first map load of a session. To avoid that, the
  // scan result is persisted to js/db/WorldGen/MapGroups.json (see
  // WorldgenStore below) the first time it's built, and every subsequent
  // boot loads that small manifest directly instead of rescanning. Delete
  // the file (e.g. after retagging maps with <MapGroup>/<MainMap>) to force
  // a one-time regeneration. The result is also cached in $gameSystem (so it
  // survives save/load) and in MapManager's in-memory map cache.
  const GROUP_TAG = /<MapGroup:?\s*([A-Za-z][A-Za-z0-9_]*)>/i;
  const MAIN_MAP_TAG = /<MainMap>/i;

  // Persists the GroupRegistry scan result as a small JSON manifest under
  // js/db/WorldGen/, so it only has to be (re)built when that file is missing,
  // deleting it regenerates it on the next boot. Only available under NW.js
  // (the desktop/Steam builds); browser deploys silently fall back to
  // scanning-and-caching-in-$gameSystem each session, as before.
  const WorldgenStore = {
    _filePath: null,
    _fs: null,

    _resolve: () => {
      if (WorldgenStore._filePath !== null) return WorldgenStore._filePath;
      WorldgenStore._filePath = false;
      try {
        if (window.Utils && window.Utils.isNwjs && window.Utils.isNwjs()) {
          const fs = require("fs");
          const path = require("path");
          const dir = path.join(path.dirname(process.mainModule.filename), "js", "db", "WorldGen");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          WorldgenStore._fs = fs;
          WorldgenStore._filePath = path.join(dir, "MapGroups.json");
        }
      } catch (e) { }
      return WorldgenStore._filePath;
    },

    load: () => {
      if (window.WorldGen?.MapGroups) return window.WorldGen.MapGroups;
      const filePath = WorldgenStore._resolve();
      if (!filePath) return null;
      try {
        if (!WorldgenStore._fs.existsSync(filePath)) return null;
        return JSON.parse(WorldgenStore._fs.readFileSync(filePath, "utf8"));
      } catch (e) {
        return null;
      }
    },

    save: (groups) => {
      window.WorldGen = window.WorldGen || {};
      window.WorldGen.MapGroups = groups;
      const filePath = WorldgenStore._resolve();
      if (!filePath) return;
      const json = JSON.stringify(groups);
      WorldgenStore._fs.writeFile(filePath, json, "utf8", (e) => {
        if (!e) Utils.debug(`GroupRegistry manifest written to js/db/WorldGen/MapGroups.json`);
      });
    },

    // Removes the on-disk manifest so the next build rescans the maps (used by
    // the "Test" player dev hook, see maybeRegenerateForTest).
    deleteFile: () => {
      const filePath = WorldgenStore._resolve();
      if (!filePath) return;
      try {
        if (WorldgenStore._fs.existsSync(filePath)) WorldgenStore._fs.unlinkSync(filePath);
      } catch (e) { }
    },
  };

  // Persists each group's NPC-template pool (the AI/Local/Shop-tagged events
  // harvested off every map in, and possibly beyond, the group, see
  // SpawnManager.getNPCPool) to js/db/WorldGen/NPCPools.json, mirroring
  // WorldgenStore above.
  //
  // PERFORMANCE NOTE: building a group's pool means loading and parsing every
  // map's full JSON in (and often well beyond, see getNPCPool's borrowing
  // rules) that group, just to read each event's `pages`/`note`. With ~1480
  // maps and ~106MB of map data, the very first pool build of a session, at
  // game start, before anything is cached, synchronously loads & parses
  // hundreds of map files and is the main cause of the multi-second freeze on
  // boot. MapManager._mapCache only lives for the current session, so without
  // persistence this cost is paid again on every single launch. Caching the
  // *resulting* templates here (rather than the raw map data) sidesteps that
  // entirely on subsequent boots. Delete the file (e.g. after editing AI/
  // Local/Shop event templates) to force a one-time rebuild.
  const NPCPoolStore = {
    _filePath: null,
    _fs: null,
    _cache: undefined, // session memo of the parsed manifest (undefined = not read yet)
    // Manifest format version. v2 added the per-map "__shops" index (Shop-
    // tagged / shop-command events) alongside the per-group template pools.
    // Older manifests are discarded so the shop index gets built exactly once.
    VERSION: 2,

    _resolve: () => {
      if (NPCPoolStore._filePath !== null) return NPCPoolStore._filePath;
      NPCPoolStore._filePath = false;
      try {
        if (window.Utils && window.Utils.isNwjs && window.Utils.isNwjs()) {
          const fs = require("fs");
          const path = require("path");
          const dir = path.join(path.dirname(process.mainModule.filename), "js", "db", "WorldGen");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          NPCPoolStore._fs = fs;
          NPCPoolStore._filePath = path.join(dir, "NPCPools.json");
        }
      } catch (e) { }
      return NPCPoolStore._filePath;
    },

    load: () => {
      if (NPCPoolStore._cache !== undefined) return NPCPoolStore._cache;
      NPCPoolStore._cache = null;
      const preloaded = window.WorldGen?.NPCPools;
      if (preloaded) {
        if (preloaded.__v === NPCPoolStore.VERSION) NPCPoolStore._cache = preloaded;
        return NPCPoolStore._cache;
      }
      const filePath = NPCPoolStore._resolve();
      if (!filePath) return null;
      try {
        if (!NPCPoolStore._fs.existsSync(filePath)) return null;
        const data = JSON.parse(NPCPoolStore._fs.readFileSync(filePath, "utf8"));
        // Discard pre-v2 manifests (no shop index), forces a one-time rebuild.
        if (data && data.__v === NPCPoolStore.VERSION) NPCPoolStore._cache = data;
      } catch (e) { }
      return NPCPoolStore._cache;
    },

    save: (pools) => {
      pools.__v = NPCPoolStore.VERSION;
      NPCPoolStore._cache = pools;
      window.WorldGen = window.WorldGen || {};
      window.WorldGen.NPCPools = pools;
      const filePath = NPCPoolStore._resolve();
      if (!filePath) return;
      const json = JSON.stringify(pools);
      NPCPoolStore._fs.writeFile(filePath, json, "utf8", (e) => {
        if (!e) Utils.debug(`NPC pool manifest written to js/db/WorldGen/NPCPools.json`);
      });
    },

    // Removes the on-disk manifest so the next getNPCPool rebuilds it (used by
    // the "Test" player dev hook, see maybeRegenerateForTest).
    deleteFile: () => {
      const filePath = NPCPoolStore._resolve();
      if (!filePath) return;
      try {
        if (NPCPoolStore._fs.existsSync(filePath)) NPCPoolStore._fs.unlinkSync(filePath);
      } catch (e) { }
    },
  };

  // Populates each group's `jobs` map, { mapId: [jobId, ...] }, from
  // window.WorkSystem.Jobs' locations[] crossed with that group's maps[].
  // Multiple jobs can share the same map, so each map lists every job
  // available there (see JobShiftManager.ensureGroupAssignments).
  function _populateGroupJobs(groups) {
    const allJobs = window.WorkSystem?.Jobs || [];
    for (const group of Object.values(groups)) {
      const groupMaps = new Set(group.maps);
      const jobs = {};
      for (const job of allJobs) {
        for (const mapId of (job.locations || [])) {
          if (typeof mapId === "number" && groupMaps.has(mapId)) {
            (jobs[mapId] || (jobs[mapId] = [])).push(job.id);
          }
        }
      }
      group.jobs = jobs;
    }
  }

  // Scans a loaded map's events for visitHouse / enterMultiBuilding plugin
  // commands and returns one entry per door/entrance for the residential cache.
  function _scanMapForResidentialBuildings(mapId, mapData) {
    const HOUSE_PLUGIN = 'ProceduralMap/ProceduralHouseSystem';
    const results = [];
    for (const event of (mapData?.events || [])) {
      if (!event) continue;
      let found = null;
      outer: for (const page of (event.pages || [])) {
        for (const cmd of (page.list || [])) {
          if (cmd.code !== 357 || cmd.parameters[0] !== HOUSE_PLUGIN) continue;
          const cmdName = cmd.parameters[1];
          const args    = cmd.parameters[3] || {};
          if (cmdName === 'visitHouse') {
            found = {
              mapId, eventId: event.id, x: event.x, y: event.y,
              seed: mapId * 1000000 + event.x * 1000 + event.y,
              type: 'visitHouse', poolName: args.poolName || '', capacity: 2
            };
            break outer;
          } else if (cmdName === 'enterMultiBuilding') {
            // numFloors counts the floors ABOVE the ground floor (see
            // generateMultiBuildingStructure), so the building has one more
            // floor than that, and holds one household per floor.
            const numFloors  = Number(args.numFloors) || 1;
            const totalFloors = numFloors + 1;
            found = {
              mapId, eventId: event.id, x: event.x, y: event.y,
              seed: mapId * 1000000 + event.x * 1000 + event.y,
              type: 'enterMultiBuilding',
              baseFloorPool: args.baseFloorPool || '',
              upperFloorsPool: args.upperFloorsPool || '',
              numFloors, totalFloors, capacity: totalFloors
            };
            break outer;
          }
        }
      }
      if (found) results.push(found);
    }
    return results;
  }

  const GroupRegistry = {
    _cache: null,
    _mapIndex: null,
    _buildCallbacks: null, // null = idle, [] = async build in progress

    // Async entry point: calls `callback` once the registry is ready.
    // Fast paths resolve synchronously (cache warm, save data, or manifest file).
    // Slow path (first-ever run, no manifest) fetches all map files concurrently
    // via fetch() instead of blocking the main thread with serial sync-XHR.
    ensureBuiltAsync(callback) {
      if (GroupRegistry._cache) { callback?.(); return; }
      if ($gameSystem?._npcMapGroups) {
        GroupRegistry._cache = $gameSystem._npcMapGroups;
        callback?.(); return;
      }
      const fromManifest = WorldgenStore.load();
      if (fromManifest) {
        GroupRegistry._cache = fromManifest;
        if ($gameSystem) $gameSystem._npcMapGroups = fromManifest;
        Utils.debug(`GroupRegistry loaded from manifest (async): ${Object.keys(fromManifest).length} groups.`);
        callback?.(); return;
      }
      // Async build already running, queue this callback
      if (GroupRegistry._buildCallbacks !== null) {
        if (callback) GroupRegistry._buildCallbacks.push(callback);
        return;
      }
      GroupRegistry._buildCallbacks = callback ? [callback] : [];
      Utils.debug('GroupRegistry: no manifest found, scanning maps concurrently...');

      const infos = ($dataMapInfos || []).filter(i => i?.id);
      Promise.all(infos.map(info => {
        if (MapManager._mapCache[info.id])
          return Promise.resolve({ id: info.id, data: MapManager._mapCache[info.id] });
        const file = `data/Map${String(info.id).padStart(3, '0')}.json`;
        return fetch(file)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data) MapManager._mapCache[info.id] = data; return { id: info.id, data }; })
          .catch(() => ({ id: info.id, data: null }));
      })).then(results => {
        const groups = {};
        for (const { id, data } of results) {
          if (!data?.note) continue;
          const match = data.note.match(GROUP_TAG);
          if (!match) continue;
          const groupName = match[1];
          const group = groups[groupName] || (groups[groupName] = { maps: [], mainMaps: [], residentialBuildings: [] });
          group.maps.push(id);
          if (MAIN_MAP_TAG.test(data.note)) group.mainMaps.push(id);
          group.residentialBuildings.push(..._scanMapForResidentialBuildings(id, data));
        }
        _populateGroupJobs(groups);
        GroupRegistry._cache = groups;
        GroupRegistry._mapIndex = null;
        if ($gameSystem) $gameSystem._npcMapGroups = groups;
        WorldgenStore.save(groups);
        Utils.debug(`GroupRegistry async scan complete: ${Object.keys(groups).length} groups.`);
        const cbs = GroupRegistry._buildCallbacks;
        GroupRegistry._buildCallbacks = null;
        for (const cb of cbs) cb();
      });
    },

    build: () => {
      if (GroupRegistry._cache) return GroupRegistry._cache;
      if ($gameSystem._npcMapGroups) {
        GroupRegistry._cache = $gameSystem._npcMapGroups;
        return GroupRegistry._cache;
      }

      const fromManifest = WorldgenStore.load();
      if (fromManifest) {
        GroupRegistry._cache = fromManifest;
        if ($gameSystem) $gameSystem._npcMapGroups = fromManifest;
        Utils.debug(`GroupRegistry loaded from js/db/WorldGen/MapGroups.json: ${Object.keys(fromManifest).length} groups.`);
        return fromManifest;
      }

      const groups = {};
      for (const info of ($dataMapInfos || [])) {
        if (!info || !info.id) continue;
        const data = MapManager.loadMapData(info.id);
        const note = data?.note;
        if (!note) continue;

        const match = note.match(GROUP_TAG);
        if (!match) continue;

        const groupName = match[1];
        const group = groups[groupName] || (groups[groupName] = { maps: [], mainMaps: [], residentialBuildings: [] });
        group.maps.push(info.id);
        if (MAIN_MAP_TAG.test(note)) group.mainMaps.push(info.id);
        // Scan this map's events for house/multibuilding entrances
        group.residentialBuildings.push(..._scanMapForResidentialBuildings(info.id, data));
      }

      _populateGroupJobs(groups);
      GroupRegistry._cache = groups;
      if ($gameSystem) $gameSystem._npcMapGroups = groups;
      WorldgenStore.save(groups);
      Utils.debug(`GroupRegistry built: ${Object.keys(groups).length} groups from ${Object.values(groups).reduce((s, g) => s + g.maps.length, 0)} tagged maps.`);
      return groups;
    },

    get: (groupName) => GroupRegistry.build()[groupName] || null,

    findGroupByMap: (mapId) => {
      // The single procedural map (636) is reused for every world tile, so it
      // cannot live in the static map index; resolve it to the live synthetic
      // settlement registered for the current world coordinates instead.
      if (mapId === 636) return $gameSystem?._currentProcGroup ?? null;
      if (!GroupRegistry._mapIndex) {
        const groups = GroupRegistry.build();
        GroupRegistry._mapIndex = new Map();
        for (const [name, group] of Object.entries(groups))
          for (const mId of group.maps) GroupRegistry._mapIndex.set(mId, name);
      }
      return GroupRegistry._mapIndex.get(mapId) ?? null;
    }
  };

  // ==========================================================================
  // SPAWN & PROCEDURAL MANAGERS
  // ==========================================================================
  const SpawnManager = {
    // <Shop> events are deliberately excluded, they have no graphic of
    // their own (see ShopShiftManager) so they can't serve as a template
    // for a transplanted NPC.
    buildNPCPool: (mapData) => {
      return (mapData?.events || []).filter(ev =>
        ev && (Utils.hasAITag(ev.note) || Utils.hasLocalTag(ev.note)) &&
        ev.pages?.length > 0 && ev.pages.some(p => p?.list?.length > 1)
      ).map(ev => ({ eventData: ev, eventId: ev.id }));
    },

    // Indexes every "shop-like" event on a map: <Shop>-tagged counters, events
    // with a standard Shop Processing (code 302), and RandomDailyShop plugin
    // command events (code 357). Persisted alongside the template pools in
    // NPCPools.json (manifest "__shops") so on-map shop lookups (NPC buying,
    // Steal targets, persona schedules) never re-parse map JSON.
    buildShopIndex: (mapData, mapId) => {
      const DAILY_COMMANDS = window.ShopScanner?.DAILY_SHOP_COMMANDS || {};
      const entries = [];
      for (const ev of (mapData?.events || [])) {
        if (!ev) continue;
        let hasStandardShop = false;
        let dailyShopCommand = null;
        for (const page of (ev.pages || [])) {
          for (const cmd of (page?.list || [])) {
            if (cmd.code === 302) hasStandardShop = true;
            else if (cmd.code === 357 && cmd.parameters?.[0] === 'RandomDailyShop'
              && DAILY_COMMANDS[cmd.parameters[1]]) {
              dailyShopCommand = cmd.parameters[1];
            }
          }
        }
        const shopTagged = Utils.hasShopTag(ev.note);
        if (!shopTagged && !hasStandardShop && !dailyShopCommand) continue;
        entries.push({
          mapId, eventId: ev.id, x: ev.x, y: ev.y,
          name: ev.name || "",
          shopTagged,
          hasStandardShop,
          dailyShopCommand,
          shopName: Utils.extractShopName(ev),
        });
      }
      return entries;
    },

    // Looks up an NPC template's character sprite by event name across every
    // cached pool, lets UI layers (e.g. NPCEmpathize bust resolution) find
    // the sprite of an NPC who isn't on the current map. Raw map JSON keeps
    // the graphic on each page's image data, mirroring ShopShiftManager.
    findTemplateSprite: (npcName) => {
      if (!npcName) return null;
      const pools = $gameSystem?._npcPoolCache || {};
      const search = (pool) => {
        for (const tpl of (pool || [])) {
          const ev = tpl?.eventData;
          if (!ev || ev.name !== npcName) continue;
          const img = (ev.pages || []).map(p => p?.image).find(im => im?.characterName);
          if (img) return { characterName: img.characterName, characterIndex: img.characterIndex || 0 };
        }
        return null;
      };
      for (const groupName of Object.keys(pools)) {
        const found = search(pools[groupName]);
        if (found) return found;
      }
      // Not in any session pool yet, try the global pool (builds/loads it).
      return search(SpawnManager.getNPCPool(Config.GLOBAL_GROUP_NAME));
    },

    // Returns the shop index for a map, manifest first, lazy single-map scan
    // otherwise (covers ungrouped maps that never go through pool building).
    getShopIndex: (mapId) => {
      if (!mapId) return [];
      SpawnManager._shopIndexSession = SpawnManager._shopIndexSession || {};
      if (SpawnManager._shopIndexSession[mapId]) return SpawnManager._shopIndexSession[mapId];

      const manifest = NPCPoolStore.load();
      let entries = manifest?.__shops?.[mapId];
      if (!entries) {
        const mapData = ($dataMap && $gameMap && $gameMap.mapId() === mapId)
          ? $dataMap : MapManager.loadMapData(mapId);
        entries = mapData ? SpawnManager.buildShopIndex(mapData, mapId) : [];
      }
      SpawnManager._shopIndexSession[mapId] = entries;
      return entries;
    },
    getNPCPool: (groupName) => {
      // Templates are harvested directly from the AI/Local/Shop-tagged events
      // living on the group's own gameplay maps, no separate template-only
      // "pool map" needed. Local NPCs always spawn on their home map (see
      // setupNPCControllers' localEvents block) but their template can still
      // be drawn elsewhere, same for Shop NPCs while they're not on shift,
      // so both kinds travel the world just like any other AI-tagged NPC.

      // Per-session memo + cross-session manifest (see NPCPoolStore), building
      // a pool means loading & parsing every map's full JSON across (often)
      // several groups, which is the dominant cost of the game-start freeze.
      // Templates are static map-design data, so caching the harvested result
      // is safe: it only goes stale if AI/Local/Shop event templates themselves
      // are edited, in which case deleting NPCPools.json forces a rebuild.
      $gameSystem._npcPoolCache = $gameSystem._npcPoolCache || {};
      if ($gameSystem._npcPoolCache[groupName]) return $gameSystem._npcPoolCache[groupName];

      const fromManifest = NPCPoolStore.load();
      if (fromManifest && fromManifest[groupName]) {
        $gameSystem._npcPoolCache[groupName] = fromManifest[groupName];
        Utils.debug(`NPC pool for "${groupName}" loaded from js/db/WorldGen/NPCPools.json: ${fromManifest[groupName].length} templates.`);
        return fromManifest[groupName];
      }

      const npcPool = [];
      const shopIndex = {}; // mapId -> shop entries, harvested off the same map JSON
      const seenMapIds = new Set();
      const collectFromGroup = (gName) => {
        const group = GroupRegistry.get(gName);
        if (!group) return;
        for (const mId of group.maps) {
          if (seenMapIds.has(mId)) continue;
          seenMapIds.add(mId);
          const mapData = MapManager.loadMapData(mId);
          if (mapData) {
            npcPool.push(...SpawnManager.buildNPCPool(mapData));
            shopIndex[mId] = SpawnManager.buildShopIndex(mapData, mId);
          }
        }
      };

      // Always exhaust the local group's own templates first...
      collectFromGroup(groupName);

      // ...and only reach into every other group when the local supply can't
      // even cover one NPC per local map (or this is the global group, which
      // has always drawn from the whole world), i.e. fill local spots from
      // local NPCs first, borrow from elsewhere only to cover what's left.
      const localGroup = GroupRegistry.get(groupName);
      const localMapCount = localGroup ? localGroup.maps.length : 0;
      if (Config.isGlobalGroup(groupName) || npcPool.length < localMapCount) {
        for (const otherName of Object.keys(GroupRegistry.build())) {
          if (otherName !== groupName) collectFromGroup(otherName);
        }
      }

      $gameSystem._npcPoolCache[groupName] = npcPool;
      const manifest = fromManifest || {};
      manifest[groupName] = npcPool;
      manifest.__shops = Object.assign(manifest.__shops || {}, shopIndex);
      NPCPoolStore.save(manifest);
      Utils.debug(`NPC pool for "${groupName}" built: ${npcPool.length} templates from ${seenMapIds.size} maps.`);
      return npcPool;
    },
    getPlaceholders: (includePlayers = false) => {
      const p2Active = window.$gameSplitScreen && window.$gameSplitScreen.active;
      const p2Name = p2Active ? window.$gameSplitScreen.p2EventName : null;

      return $gameMap.events()
        .filter(e => {
          const name = e?.event()?.name;
          if (!name) return false;
          if (p2Active && name === p2Name) return false;
          if (!includePlayers && name.match(/^Player\d+$/)) return false; // Ignore player events unless explicitly included
          const note = e?.event()?.note || "";
          if (note.toLowerCase().includes("local")) return false; // Ignore local events from being placeholders!
          // A slot whose self-switch A is ON is a recruited NPC hidden behind its
          // blank page, i.e. considered part of the player's party. Never reuse it
          // as a spawn placeholder: overwriting it would resurrect / duplicate the
          // party member (and strip the flag that keeps them hidden). See
          // NPCSystemParty.joinParty.
          if ($gameSelfSwitches?.value([$gameMap.mapId(), e.eventId(), 'A'])) return false;
          return name.startsWith("NPC") || name.startsWith("Placeholder") || (includePlayers && name.match(/^Player\d+$/)); // i18n-ignore: event-name prefixes
        })
        .map(ev => ({ event: ev, originalX: ev.x, originalY: ev.y }));
    },

    // Builds a spawn template for an NPC that exists only as a society profile.
    // Procedural citizens are never authored as map events (the settlement's
    // people are generated on map 636 and live on in $gameSystem._npcSociety),
    // so interiors of a procedural town have no template pool to draw from.
    // Pages/behaviour are cloned from a donor event so the spawned NPC is
    // talkable exactly like an authored one; the identity (name, sprite) comes
    // from the profile, keeping them the same person the player met outside.
    makeSocietyTemplate: (name, donor) => {
      const profile = $gameSystem._npcSociety?.[name];
      if (!profile || !donor?.pages?.length) return null;
      return {
        eventData: {
          id: donor.id,
          name,
          note: donor.note || "",
          characterName: profile.spriteKey || donor.characterName,
          characterIndex: profile.bustIndex ?? donor.characterIndex ?? 0,
          pages: JSON.parse(JSON.stringify(donor.pages)),
        }
      };
    },

    // The whole population of a town as spawn templates, for groups that have
    // no authored NPC pool (i.e. procedural settlements).
    buildSocietyPool: (groupName, donor) => {
      const society = $gameSystem._npcSociety || {};
      const pool = [];
      for (const [name, profile] of Object.entries(society)) {
        if (!profile || profile._homeGroupName !== groupName) continue;
        const tmpl = SpawnManager.makeSocietyTemplate(name, donor);
        if (tmpl) pool.push(tmpl);
      }
      return pool;
    },

    // ── Interior <Shop> staffing (ShopShiftManager, NPCSimulationCore.js) ─────
    // The town's own citizens that can stand a shop counter reached through a
    // door (a procedural settlement has no authored templates, so these come
    // straight from _npcSociety, the very people the player met outside). Each
    // entry is a ready-to-use ShopShiftManager persona keyed off the profile's
    // bound world sprite (spriteKey/bustIndex, see setupProceduralMapNPCs).
    getShopSocietyCandidates: (groupName) => {
      if (!groupName) return [];
      const society = $gameSystem?._npcSociety || {};
      const out = [];
      for (const [name, profile] of Object.entries(society)) {
        if (!profile || profile._homeGroupName !== groupName || !profile.spriteKey) continue;
        out.push({ name, spriteName: profile.spriteKey, charIdx: profile.bustIndex ?? 0, local: true });
      }
      return out;
    },

    // Deterministically fabricates a shop-counter persona from a coordinate
    // seed, used to cover a shift when a town has no citizen free to man it.
    // Mirrors setupProceduralMapNPCs' own name+sprite rolls so a generated
    // shopkeeper looks and reads like any procedural citizen. Returns null only
    // when the character pool (NPCs.json) is unavailable.
    generateSeededPersona: (seed) => {
      const pool = buildNPCCharacterPool();
      if (!pool.length) return null;
      const s = (seed >>> 0) || 1;
      const spriteName = pool[Math.floor(Utils.seededRandom(s) * pool.length)];
      const isBig = spriteName.includes('!$');
      const charIdx = isBig ? 0 : Math.floor(Utils.seededRandom((s * 2) >>> 0) * 8);
      let name = T('NPCSystem.shopkeeperFallback');
      if (window.generateSeededMarkovName) {
        const dbId = Config.NAME_DATABASES[Math.floor(Utils.seededRandom((s ^ 0x5bd1e995) >>> 0) * Config.NAME_DATABASES.length)];
        try {
          const gen = window.generateSeededMarkovName(s & 0xffff, (s >>> 16) & 0xffff, (s & 0x7fff) || 1, dbId, 2, 4, 12);
          if (gen && gen !== "Unknown") name = gen; // i18n-ignore: Markov generator sentinel
        } catch (e) {}
      }
      return { name, spriteName, charIdx, local: false };
    },

    transplantData: (targetEvent, npcData, index) => {
      const originalData = targetEvent.event();
      originalData.pages = JSON.parse(JSON.stringify(npcData.pages));
      originalData.name = npcData.name || `NPC${index + 1}`;

      // Template events that ship with the bare placeholder name "NPC" get a
      // proper seeded Markov name instead, anchored to a fixed name-generation
      // seed (and the source event's stable id) so the same template always
      // resolves to the same person, no matter where/when it gets spawned, and
      // independent of the world's history seed.
      if (originalData.name === "NPC" && window.generateSeededMarkovName) {
        const worldSeed = Config.NPC_NAME_SEED;
        // npcData is the raw map event (its id lives on `.id`), not the pool
        // wrapper (`.eventId`), so read `.id` first. Falling straight through to
        // `index` tied a template's generated name to its spawn-slot position,
        // so the same "NPC" template resolved to a different person on every
        // spawn, breaking the stable "same template = same person" guarantee.
        const sourceId  = npcData.id ?? npcData.eventId ?? index;
        const dbSeed    = worldSeed ^ (sourceId * 83492791);
        const dbId      = Config.NAME_DATABASES[Math.floor(Utils.seededRandom(dbSeed) * Config.NAME_DATABASES.length)];
        try {
          const generated = window.generateSeededMarkovName(worldSeed & 0xffff, (worldSeed >>> 16) & 0xffff, sourceId, dbId, 2, 4, 12);
          if (generated && generated !== "Unknown") originalData.name = generated; // i18n-ignore: Markov generator sentinel
        } catch (e) {}
      }

      originalData.note = npcData.note;
      // <Hidden> NPCs stay part of the simulation (society, schedule, dialogue)
      // but never get a visible sprite: blank the top-level graphic and every
      // page's image instead of transplanting npcData's assigned sprite.
      const isHidden = Utils.hasHiddenTag(npcData.note);
      originalData.characterName = isHidden ? "" : npcData.characterName;
      originalData.characterIndex = isHidden ? 0 : npcData.characterIndex;
      if (isHidden) {
        for (const page of originalData.pages) {
          if (page?.image) { page.image.characterName = ""; page.image.characterIndex = 0; }
        }
      }

      for (const page of originalData.pages) {
        if (page.conditions) {
          Object.assign(page.conditions, { switch1Valid: false, switch2Valid: false, variableValid: false, actorValid: false, itemValid: false });
        }
        page.priorityType = 1;
        page.through = false;
        // Substantive (non-empty) pages must be action-button triggered so the
        // spawned NPC stays talkable; blank trailing pages keep their trigger so
        // they do not auto-run (#8).
        if ((page?.list?.length ?? 0) > 1) page.trigger = 0;
      }

      if (!isHidden) {
        const refImg = originalData.pages.map(p => p?.image).find(img => img?.characterName);
        if (refImg) {
          for (const page of originalData.pages) {
            // Only stamp the shared sprite onto substantive (interactable) pages.
            // The trailing blank, self-switch-gated "hide on recruit" page (an
            // empty command list, length <= 1) must stay graphic-less: copying a
            // sprite onto it turns a recruited/stale-flagged NPC into a visible
            // but untalkable ghost that the controller keeps walking around the
            // map, instead of the NPC simply disappearing as intended.
            if ((page?.list?.length ?? 0) <= 1) continue;
            if (page?.image && !page.image.characterName) {
              page.image.characterName = refImg.characterName;
              page.image.characterIndex = refImg.characterIndex;
            }
          }
        }
      }

      // Placeholder slots get fresh NPC data transplanted onto the same physical
      // event id across spawn cycles. If a previous occupant ever flipped a
      // self-switch (e.g. NPCSystemParty.joinParty sets ch 'A' on recruit), that
      // state is keyed to [mapId, eventId] and lingers, so the next, unrelated
      // NPC can boot straight into an "already met you" blank page and appear
      // completely uninteractable. Always start the slot with a clean slate.
      const selfSwitchMapId = $gameMap.mapId();
      const selfSwitchEventId = targetEvent.eventId();
      for (const ch of ['A', 'B', 'C', 'D']) {
        $gameSelfSwitches.setValue([selfSwitchMapId, selfSwitchEventId, ch], false);
      }

      targetEvent.refresh();
      targetEvent.setupPage();
      SpawnManager.snapshotSpawn(targetEvent);
      return !!targetEvent.page();
    },

    // Everything transplantData just wrote lives in $dataMap, and $dataMap is
    // volatile: Scene_Map.create re-reads the map file from disk on EVERY
    // rebuild of the scene, not just on a transfer, so closing the menu (or the
    // Empathize panel, or loading a save) throws the whole transplant away and
    // hands the event back its authored placeholder data. The Game_Event object
    // survives, keeping the NPC's sprite and position, so the slot reads as a
    // normal citizen while event() reports a blank "PlayerNN" placeholder with
    // no commands: a visible NPC that cannot be talked to, named after the slot
    // it is standing in. Snapshot the transplanted identity onto the event
    // itself (it is part of the save) so restoreSpawnedEventData can put it
    // back the moment the fresh $dataMap lands.
    snapshotSpawn: (targetEvent) => {
      if (!targetEvent || !$gameMap) return;
      const data = targetEvent.event();
      if (!data?.pages) return;
      targetEvent._npcSpawnData = {
        mapId: $gameMap.mapId(),
        name: data.name,
        note: data.note,
        characterName: data.characterName,
        characterIndex: data.characterIndex,
        pages: JSON.parse(JSON.stringify(data.pages))
      };
    },

    injectBrain: (targetEvent, originalData) => {
      // Mark this as a roster spawn (a pool NPC dropped onto a placeholder) so
      // the hourly turnover (refreshCurrentMapForHour) only ever relocates or
      // erases these, never pre-placed <AI>/<Local> map-design events.
      targetEvent._npcRosterSpawn = true;
      if (!Utils.hasAITag(originalData.note)) {
        targetEvent.setOpacity(255);
        targetEvent.setThrough(false);
        return;
      }

      const controller = new NPCController(originalData.name);
      console.log(`[NPC System] NPC spawned: "${originalData.name}" at (${targetEvent.x}, ${targetEvent.y}) on map ${$gameMap.mapId()}`);
      targetEvent._moveType = 0;
      targetEvent.setMoveSpeed(controller.moveSpeed);
      targetEvent.setMoveFrequency(5);
      targetEvent.setOpacity(255);
      targetEvent.setThrough(false);

      $gameSystem.npcControllers = $gameSystem.npcControllers || [];
      $gameSystem.npcControllers.push(controller);
      controller.decideNextGoal();
    },

    // Populates a generated interior (house, hut, villa, inn, shop, walk-up
    // floor, skyscraper floor) with NPCs drawn from the surrounding town.
    //
    // opts.building — the ProceduralHouseSystem descriptor of the building the
    //   player walked into. Its residents (assigned by NPCSim.ensureBuildingResidents)
    //   are the ones found at home here at night.
    // opts.isPublic — the interior belongs to a skyscraper: nobody lives here,
    //   so it draws a busy, fully random crowd from the whole town at any hour
    //   instead of a resident household.
    replacePlayerEventsWithNPCs: (groupName, opts = {}) => {
      const { building = null, isPublic = false } = opts || {};
      const currentMapId = $gameMap.mapId();
      if (!groupName || !$gameMap?.events || MapManager.isTreasureRoom(currentMapId)) return;

      let npcPool = SpawnManager.getNPCPool(groupName);
      let allPlaceholders = SpawnManager.getPlaceholders();
      // Fallback to Player events as placeholders when no NPC/Placeholder events exist
      if (!allPlaceholders.length) {
        allPlaceholders = SpawnManager.getPlaceholders(true);
      }
      if (!allPlaceholders.length) return;

      // A procedural settlement has no authored templates, so fall back to its
      // society roster (using a placeholder's own pages as the donor). This is
      // what lets a house entered from a procedural town actually show the
      // townspeople who live there, and a procedural skyscraper show a crowd.
      if (!npcPool.length) {
        npcPool = SpawnManager.buildSocietyPool(groupName, allPlaceholders[0].event.event());
      }
      if (!npcPool.length) return;

      let selectedNPCs = [];
      let actualCount = 0;

      {
        let densityFactor = 120;
        let baseLimit = MapManager.getNPCSpawnLimit();
        const _note = $dataMap.note || "";
        const isExterior = _note.includes("<Exterior>");
        const isInterior = _note.includes("<Interior>");

        if (isExterior) {
          densityFactor = 60;
          baseLimit = 15;
        } else if (isInterior) {
          densityFactor = 240;
          baseLimit = 2;
        }
        // A skyscraper is a public space shared by the whole town: lobbies and
        // office/retail floors stay busy, so they get the exterior-style crowd
        // rather than the sparse household density of a home interior.
        if (isPublic) {
          densityFactor = 80;
          baseLimit = 6;
        }

        const maxNPCs = Math.min(Math.floor(($gameMap.width() * $gameMap.height()) / densityFactor), baseLimit);

        if ((isExterior || isPublic) && maxNPCs > 0) {
          const minNPCs = Math.max(1, Math.floor(maxNPCs * 0.5));
          actualCount = Math.min(Math.floor(Utils.randBetween(minNPCs, maxNPCs + 1)), allPlaceholders.length, npcPool.length);
        } else {
          actualCount = Math.min(Math.floor(Math.random() * (maxNPCs + 1)), allPlaceholders.length, npcPool.length);
        }

        // Homes are often empty; a public building never is.
        if (isInterior && !isPublic && actualCount > 0 && Math.random() < 0.5) actualCount = 0;

        const drawRandom = (count, exclude = []) => {
          const poolCopy = npcPool.filter(t => !exclude.includes(t));
          for (let i = 0; i < count && poolCopy.length; i++) {
            selectedNPCs.push(poolCopy.splice(Math.floor(Math.random() * poolCopy.length), 1)[0]);
          }
        };

        // At night, the NPCs assigned to this exact building (and, in a
        // multi-floor block, to this exact floor) are found at home here. A
        // public building has no residents, so it always draws a random crowd.
        const residents = (!isPublic && building && MapManager.isNightTime())
          ? (window.NPCSim?.getBuildingResidents?.(building, building.floorIndex ?? 0, groupName) || [])
          : [];

        const residentTemplates = residents
          .map(name => npcPool.find(t => (t.eventData?.name || '') === name))
          .filter(Boolean);

        if (residentTemplates.length) {
          selectedNPCs = [...residentTemplates];
          // Fill remaining slots with random visitors if space allows
          drawRandom(Math.max(0, actualCount - residentTemplates.length), residentTemplates);
          actualCount = Math.min(selectedNPCs.length, allPlaceholders.length);
        } else {
          drawRandom(actualCount);
        }
      }

      const validTiles = MapManager.getSpreadSpawnTiles();
      const activePlaceholders = Utils.shuffle(allPlaceholders).slice(0, actualCount);
      const unusedPlaceholders = allPlaceholders.slice(actualCount);

      let tileIdx = 0;
      for (let i = 0; i < activePlaceholders.length; i++) {
        const { event: targetEvent } = activePlaceholders[i];
        const npcDataItem = selectedNPCs[i];

        if (!targetEvent || !npcDataItem?.eventData) { targetEvent?.erase(); continue; }

        if (!SpawnManager.transplantData(targetEvent, npcDataItem.eventData, i)) {
          targetEvent.erase();
          continue;
        }

        if (tileIdx < validTiles.length) {
          targetEvent.locate(validTiles[tileIdx].x, validTiles[tileIdx].y);
          tileIdx++;
        } else {
          targetEvent.erase();
          continue;
        }

        SpawnManager.injectBrain(targetEvent, targetEvent.event());
      }

      const mapName = MapManager.getMapName(currentMapId);
      console.log(`[NPC System] ${activePlaceholders.length} NPCs spawned via replacePlayerEventsWithNPCs on map ${currentMapId} (${mapName})`);

      unusedPlaceholders.forEach(u => u.event.erase());
    },

initializeGroupNPCs: (groupName, activeMapId = null) => {
      const group = GroupRegistry.get(groupName);
      if (!group) return;

      const npcPool = SpawnManager.getNPCPool(groupName);
      if (!npcPool.length) return;

      $gameSystem._npcGroupAssignments = {};

      const allMaps = group.maps;
      const hour = $gameVariables?.value(23) ?? 12;

      // Make sure the group's job-shift roster exists first, so working NPCs
      // resolve to their assigned work map (kept from the original system).
      window.NPCSim?.JobShiftManager?.ensureGroupAssignments?.(groupName);

      const mapAssignments = {};
      for (const mId of allMaps) mapAssignments[mId] = [];

      // Place every distinct NPC in the pool on the map their *schedule* puts
      // them on this hour, deterministic, never random. NPCSim.scheduledMapForNPC
      // routes work→work map, shop shift→shop map, shopping→a shop map, social→
      // a main/hub map, and everything else (rest/meals/leisure/errands)→home.
      // Computed once per hour and cached in _npcGroupAssignments, so walking
      // between the group's maps within the same hour never reshuffles anyone.
      const resolver = window.NPCSim?.scheduledMapForNPC;
      const assignedNames = new Set();
      for (const npc of npcPool) {
        const name = npc.eventData?.name;
        if (!name || name === "NPC" || assignedNames.has(name)) continue;
        assignedNames.add(name);

        let mId = resolver ? resolver(name, groupName, hour) : null;
        if (!mId || !mapAssignments[mId]) {
          // Resolver unavailable / returned an out-of-group map, fall back to a
          // stable hash-picked group map so the NPC still appears consistently.
          mId = allMaps[Math.abs(Utils.nameHash(name)) % allMaps.length];
        }
        mapAssignments[mId].push({ name });
      }

      // Save
      let totalPlaced = 0;
      for (const mId of allMaps) {
        $gameSystem._npcGroupAssignments[mId] = mapAssignments[mId];
        totalPlaced += mapAssignments[mId].length;
      }

      $gameSystem._currentNpcGroup = groupName;
      $gameSystem._npcAssignmentHour = hour;
      Utils.debug(`Group ${groupName} schedule-assigned: ${totalPlaced} NPCs across ${allMaps.length} maps at hour ${hour} (active: ${activeMapId}).`);
    },

    // Live, in-place turnover of the *current* map's NPCs when an in-game hour
    // passes (see Game_Map.update). _npcGroupAssignments has already been
    // recomputed for the new hour. NPCs no longer scheduled here "leave"
    // (their event is freed); NPCs newly scheduled here move in by reusing a
    // freed event; everyone who stays gets a fresh spot and re-picks a goal,
    // so the population visibly shifts without a jarring full map reload.
    refreshCurrentMapForHour: (groupName) => {
      if (!$gameMap || !$gameSystem._npcGroupAssignments) return;
      const group = GroupRegistry.get(groupName);
      if (!group) return;
      const mapId = $gameMap.mapId();

      const npcPool = SpawnManager.getNPCPool(groupName);
      if (!npcPool.length) return;
      const npcByName = new Map(npcPool.map(n => [n.eventData.name, n]));

      // Only roster spawns turn over; pre-placed <AI>/<Local> events are left be.
      const controllers = ($gameSystem.npcControllers || []).filter(c => c?.event && !c.event._erased);
      const managed = controllers.filter(c => c.event._npcRosterSpawn && !c.isLocal);

      // The display roster includes main-map visitor borrow, sized to however
      // many roster events we have to fill, so hubs stay busy across the hour
      // boundary instead of emptying out.
      const roster = SpawnManager.resolveDisplayRoster(mapId, group, groupName, managed.length);
      const wantNames = new Set(roster.map(o => o.name));

      const spawnTiles = MapManager.getSpreadSpawnTiles();
      let tileIdx = 0;
      const nextTile = () => (tileIdx < spawnTiles.length ? spawnTiles[tileIdx++] : null);

      const stayingNames = new Set();
      const freedEvents = [];

      for (const ctrl of managed) {
        if (wantNames.has(ctrl.eventName)) {
          stayingNames.add(ctrl.eventName);
          const t = nextTile();
          if (t) ctrl.event.locate(t.x, t.y);
          ctrl.decideNextGoal();
        } else {
          freedEvents.push(ctrl.event);
        }
      }

      // Drop controllers whose NPC is leaving this map.
      if (freedEvents.length) {
        const leaving = new Set(freedEvents);
        $gameSystem.npcControllers = ($gameSystem.npcControllers || [])
          .filter(c => !(c?.event && leaving.has(c.event)));
      }

      // Bring in NPCs newly on the roster here, reusing the just-freed events.
      const incoming = roster.filter(o => !stayingNames.has(o.name));
      let idx = 0;
      for (const obj of incoming) {
        if (idx >= freedEvents.length) break;
        const data = npcByName.get(obj.name);
        if (!data?.eventData) continue;
        const ev = freedEvents[idx++];
        if (!SpawnManager.transplantData(ev, data.eventData, idx)) { ev.erase(); continue; }
        const t = nextTile();
        if (t) ev.locate(t.x, t.y); else { ev.erase(); continue; }
        SpawnManager.injectBrain(ev, ev.event());
      }
      // Any events still free (more left than arrived) get erased.
      for (; idx < freedEvents.length; idx++) freedEvents[idx].erase();
    },

    // Snapshots every active NPC's last position + activity before the map
    // they're standing on gets torn down, keyed by [groupName][npcName].
    // This is what lets the same NPC be "still there" (or "still doing that")
    // when the player wanders off and comes back within the same map group.
    captureNPCGroupMemory: (prevMapId, prevGroupName) => {
      if (!prevMapId || !prevGroupName) return;
      if (!GroupRegistry.get(prevGroupName)) return;

      const controllers = ($gameSystem.npcControllers || []).filter(c => c?.event && !c.event._erased);
      if (!controllers.length) return;

      $gameSystem._npcGroupMemory = $gameSystem._npcGroupMemory || {};
      const groupMem = $gameSystem._npcGroupMemory[prevGroupName] = $gameSystem._npcGroupMemory[prevGroupName] || {};

      for (const ctrl of controllers) {
        const profile = $gameSystem._npcSociety?.[ctrl.eventName];
        groupMem[ctrl.eventName] = {
          mapId: prevMapId,
          x: ctrl.event.x,
          y: ctrl.event.y,
          state: ctrl.state,
          currentNeed: profile?.currentNeed ?? null,
          savedMinute: $gameVariables?.value(114) ?? 0,
        };
      }
    },

    // Returns the remembered (x, y) for an NPC on this exact map, provided the
    // tile is still passable and unoccupied, otherwise null so the caller
    // falls back to a normal spawn-tile pick.
    recallNPCSpot: (groupName, npcName, mapId) => {
      const mem = $gameSystem._npcGroupMemory?.[groupName]?.[npcName];
      if (!mem || mem.mapId !== mapId) return null;
      if (!$gameMap.isValid(mem.x, mem.y)) return null;
      if (![2, 4, 6, 8].some(dir => $gameMap.isPassable(mem.x, mem.y, dir))) return null;
      if ($gameMap.eventsXy(mem.x, mem.y).length > 0) return null;
      return { x: mem.x, y: mem.y };
    },

    // Resolves the final list of NPCs to *display* on a map: its scheduled
    // roster (_npcGroupAssignments[mapId]) minus anyone reserved as a <Shop>
    // counter persona, then, on main/hub maps only, topped up with NPCs
    // "visiting" from surrounding district maps so up to `slotCount` slots read
    // as occupied. The visitor borrow is display-only; _npcGroupAssignments
    // (their real hangout home) is never mutated. Shared by spawnAssignedNPCs
    // (map entry) and refreshCurrentMapForHour (hourly turnover) so both agree
    // on who should be on the map, otherwise hubs would visibly depopulate at
    // each hour boundary.
    resolveDisplayRoster: (mapId, group, groupName, slotCount) => {
      const reservedForShop = new Set($gameSystem._npcShopReservedNames?.[mapId] || []);
      let assigned = ($gameSystem._npcGroupAssignments?.[mapId] || [])
        .filter(o => !reservedForShop.has(o.name));

      const mainMapIds = group.mainMaps || [];
      if (mainMapIds.includes(mapId) && assigned.length < slotCount) {
        const poolLen = SpawnManager.getNPCPool(groupName).length;
        const usedNames = new Set(assigned.map(o => o.name));
        let visitors = [];
        for (const mId of group.maps) {
          if (mId === mapId || mainMapIds.includes(mId)) continue;
          for (const obj of $gameSystem._npcGroupAssignments[mId] || []) {
            if (usedNames.has(obj.name) || reservedForShop.has(obj.name)) continue;
            usedNames.add(obj.name);
            visitors.push(obj);
          }
        }
        visitors = Utils.shuffle(visitors);
        const need = Math.min(slotCount, poolLen) - assigned.length;
        if (need > 0 && visitors.length) {
          assigned = assigned.concat(visitors.slice(0, need).map(o => ({ name: o.name, visiting: true })));
        }
      }
      return assigned;
    },

    spawnAssignedNPCs: (mapId, group, groupName) => {
      const hasRoster = ($gameSystem._npcGroupAssignments?.[mapId] || []).length > 0;
      if (!hasRoster) {
        SpawnManager.getPlaceholders().forEach(p => p.event.erase());
        return;
      }

      const npcPool = SpawnManager.getNPCPool(groupName);
      let allPlaceholders = SpawnManager.getPlaceholders();
      // Fallback to Player events as placeholders when no NPC/Placeholder events exist
      if (!allPlaceholders.length) {
        allPlaceholders = SpawnManager.getPlaceholders(true);
      }
      if (!npcPool.length || !allPlaceholders.length) return;

      const assigned = SpawnManager.resolveDisplayRoster(mapId, group, groupName, allPlaceholders.length);
      if (!assigned.length) {
        allPlaceholders.forEach(p => p.event.erase());
        return;
      }

      const actualCount = Math.min(assigned.length, allPlaceholders.length);

      // Build fresh spawn tiles on every map entry, anywhere passable
      const spawnTiles = MapManager.getSpreadSpawnTiles();

      const activePlaceholders = allPlaceholders.slice(0, actualCount);
      const unusedPlaceholders = allPlaceholders.slice(actualCount);

      const npcByName = new Map(npcPool.map(n => [n.eventData.name, n]));
      let tileIdx = 0;
      for (let i = 0; i < activePlaceholders.length; i++) {
        const { event: targetEvent } = activePlaceholders[i];
        const assignedObj = assigned[i];
        const npcDataItem = npcByName.get(assignedObj.name);

        if (!targetEvent || !npcDataItem?.eventData) { targetEvent?.erase(); continue; }

        if (!SpawnManager.transplantData(targetEvent, npcDataItem.eventData, i)) {
          targetEvent.erase();
          continue;
        }

        // If we last saw this NPC standing right here, put them back exactly
        // where they were instead of a fresh random spot, see captureNPCGroupMemory.
        const remembered = SpawnManager.recallNPCSpot(groupName, assignedObj.name, mapId);
        if (remembered) {
          targetEvent.locate(remembered.x, remembered.y);
        } else if (tileIdx < spawnTiles.length) {
          targetEvent.locate(spawnTiles[tileIdx].x, spawnTiles[tileIdx].y);
          tileIdx++;
        } else {
          targetEvent.erase();
          continue;
        }

        SpawnManager.injectBrain(targetEvent, targetEvent.event());
      }

      Utils.debug(`spawnAssignedNPCs: ${activePlaceholders.length} NPCs spawned on map ${mapId}`);
      console.log(`[NPC System] ${activePlaceholders.length} NPCs spawned via spawnAssignedNPCs on map ${mapId} (${MapManager.getMapName(mapId)})`);

      unusedPlaceholders.forEach(u => u.event.erase());
    },

randomizeOmegaTowerMap: (mapId, groupName) => {
      const npcPool = SpawnManager.getNPCPool(groupName);
      const allPlaceholders = SpawnManager.getPlaceholders(true); // Include Player1-Player8 as placeholders
      if (!npcPool.length || !allPlaceholders.length) return;

      // Build valid tiles, anywhere passable on the map
      let validTiles = null;
      const getValidTiles = () => {
        if (validTiles) return validTiles;
        validTiles = MapManager.getSpreadSpawnTiles();
        return validTiles;
      };

      // Calculate spawn cap based on map size (same density logic as other spawn methods)
      let densityFactor = 120;
      let baseLimit = MapManager.getNPCSpawnLimit();
      const isExterior = $dataMap && $dataMap.note && $dataMap.note.includes("<Exterior>");
      const isInterior = $dataMap && $dataMap.note && $dataMap.note.includes("<Interior>");

      if (isExterior) {
        densityFactor = 60;
        baseLimit = 15;
      } else if (isInterior) {
        densityFactor = 240;
        baseLimit = 2;
      }

      // Shuffle NPC pool for fresh randomization every time
      const shuffledPool = Utils.shuffle(npcPool);
      
      // For maps larger than 40x40, fill ALL available Player slots with NPCs
      let maxNPCs;
      if ($gameMap.width() > 40 || $gameMap.height() > 40) {
        maxNPCs = allPlaceholders.length;
      } else {
        maxNPCs = Math.min(Math.floor(($gameMap.width() * $gameMap.height()) / densityFactor), baseLimit);
      }
      const actualCount = Math.min(maxNPCs, shuffledPool.length, allPlaceholders.length);

      const activePlaceholders = allPlaceholders.slice(0, actualCount);
      const unusedPlaceholders = allPlaceholders.slice(actualCount);

      let tileIdx = 0;
      for (let i = 0; i < activePlaceholders.length; i++) {
        const { event: targetEvent } = activePlaceholders[i];
        const npcDataItem = shuffledPool[i % shuffledPool.length];

        if (!targetEvent || !npcDataItem?.eventData) { targetEvent?.erase(); continue; }

        if (!SpawnManager.transplantData(targetEvent, npcDataItem.eventData, i)) {
          targetEvent.erase();
          continue;
        }

        const tiles = getValidTiles();
        if (tileIdx < tiles.length) {
          targetEvent.locate(tiles[tileIdx].x, tiles[tileIdx].y);
          tileIdx++;
        } else {
          const fallbackTiles = MapManager.findPassableTerrainTiles();
          if (fallbackTiles.length > 0) {
            const fallback = Utils.randomElement(fallbackTiles);
            targetEvent.locate(fallback.x, fallback.y);
          } else {
            targetEvent.erase();
            continue;
          }
        }

        SpawnManager.injectBrain(targetEvent, targetEvent.event());
      }

      console.log(`[NPC System] ${activePlaceholders.length} NPCs randomized on OmegaTower map ${mapId} (${MapManager.getMapName(mapId)})`);

      unusedPlaceholders.forEach(u => u.event.erase());
    },

    // ── Omega City (map 631) ─────────────────────────────────────────────────
    // The largest city in the game, and the only map with its own spawn rules.
    //
    // Instead of the global group's density-capped crowd it fields a fixed
    // Config.OMEGA_CITY_NPC_COUNT citizens:
    //   - half transplanted from the world pool, i.e. authored templates
    //     harvested off EVERY other group's maps (getNPCPool already draws
    //     world-wide for the global group), so the city is where the rest of
    //     the world's faces turn up;
    //   - half generated on the spot as brand-new procedural citizens (name,
    //     sprite, class, full society profile), seeded off the world seed and
    //     the slot index so the same fifty people live there in every session
    //     of a given world;
    // and every one of them is then given one of the city's own residential
    // doors as an address (NPCSim.assignHomesOnMap), so the houses standing on
    // the map are actually somebody's home.
    randomizeOmegaCityMap: (mapId, groupName) => {
      const allPlaceholders = SpawnManager.getPlaceholders(true); // Player1..PlayerN
      if (!allPlaceholders.length) return;

      const tiles = MapManager.getSpreadSpawnTiles();
      if (!tiles.length) { allPlaceholders.forEach(p => p.event.erase()); return; }

      const worldPool = Utils.shuffle(SpawnManager.getNPCPool(groupName));
      // Procedural citizens are spawned onto a placeholder like anyone else, so
      // they need a donor event to clone talkable pages/behaviour from, exactly
      // like a procedural settlement's own people (see makeSocietyTemplate).
      const donor = worldPool
        .map(t => t.eventData)
        .find(ev => Utils.hasAITag(ev?.note) && ev.pages?.some(p => (p?.list?.length ?? 0) > 1))
        || worldPool[0]?.eventData
        || null;
      // No donor means no pool at all, which means no city, leave the slots dark
      // rather than spawning blank events.
      if (!donor) { allPlaceholders.forEach(p => p.event.erase()); return; }

      const total = Math.min(Config.OMEGA_CITY_NPC_COUNT, allPlaceholders.length, tiles.length);
      const procCount = Math.min(Math.round(total * Config.OMEGA_CITY_PROCEDURAL_RATIO), total);
      const poolCount = total - procCount;

      const activePlaceholders = allPlaceholders.slice(0, poolCount + procCount);
      const unusedPlaceholders = allPlaceholders.slice(poolCount + procCount);

      // Same seed root the rest of the world derives from, mixed with the map
      // id so Omega City's own citizens are stable per world.
      const worldSeed = window.HistoryManager?.getSeed?.() ?? Config.NPC_NAME_SEED;
      const citySeed = (worldSeed ^ (mapId * 2654435761)) >>> 0;

      const spawnedNames = [];
      const takenNames = new Set();
      let slot = 0, tileIdx = 0;

      const place = (targetEvent) => {
        if (tileIdx >= tiles.length) return false;
        targetEvent.locate(tiles[tileIdx].x, tiles[tileIdx].y);
        tileIdx++;
        return true;
      };

      // Half the city: authored templates from every map pool in the world.
      for (let i = 0; i < poolCount; i++, slot++) {
        const { event: targetEvent } = activePlaceholders[slot];
        const npcDataItem = worldPool[i % worldPool.length];
        if (!targetEvent || !npcDataItem?.eventData) { targetEvent?.erase(); continue; }
        if (!SpawnManager.transplantData(targetEvent, npcDataItem.eventData, slot)) { targetEvent.erase(); continue; }
        if (!place(targetEvent)) { targetEvent.erase(); continue; }
        SpawnManager.injectBrain(targetEvent, targetEvent.event());
        const spawnedName = targetEvent.event().name;
        spawnedNames.push(spawnedName);
        takenNames.add(spawnedName);
      }

      // The other half: citizens who exist nowhere else, born here.
      for (let i = 0; i < procCount; i++, slot++) {
        const { event: targetEvent } = activePlaceholders[slot];
        if (!targetEvent) continue;
        const citizen = SpawnManager.makeCityCitizen(citySeed, i, groupName, donor, takenNames);
        if (!citizen) { targetEvent.erase(); continue; }
        if (!SpawnManager.transplantData(targetEvent, citizen.eventData, slot)) { targetEvent.erase(); continue; }
        // transplantData clones the DONOR's pages, images included, so the
        // citizen's own rolled sprite has to be stamped over them, otherwise
        // they all wear the face of whichever template lent them its pages
        // (NPCSociety's _applySocietySprite would fix it a frame later, but only
        // once the society DataLoader is ready).
        SpawnManager.applyCitizenSprite(targetEvent, citizen.spriteName, citizen.spriteIndex);
        if (!place(targetEvent)) { targetEvent.erase(); continue; }
        SpawnManager.injectBrain(targetEvent, targetEvent.event());
        spawnedNames.push(citizen.name);
      }

      unusedPlaceholders.forEach(u => u.event.erase());

      console.log(`[NPC System] ${spawnedNames.length} NPCs spawned in Omega City (map ${mapId}): ${poolCount} from world pools, ${procCount} procedural.`);

      SpawnManager.houseOmegaCitizens(mapId, groupName, spawnedNames);
    },

    // Generates one procedural citizen of Omega City and returns a ready spawn
    // template for it. Name, sprite and class all hang off (citySeed, index),
    // so the same slot always resolves to the same person in a given world,
    // mirroring how a procedural settlement seeds its people
    // (setupProceduralMapNPCs).
    makeCityCitizen: (citySeed, index, groupName, donor, taken) => {
      const charPool = buildNPCCharacterPool();
      if (!charPool.length || !donor || !window.generateSeededMarkovName) return null;

      // The society table is keyed by name, so a collision would hand this slot
      // somebody who already exists (another town's person, or the citizen in
      // the slot before) instead of creating a new one. Re-roll on a salted seed
      // until a free name comes up.
      let seed = 0, name = null;
      for (let attempt = 0; attempt < 12 && !name; attempt++) {
        seed = (citySeed ^ ((index + 1) * 83492791) ^ (attempt * 0x9e3779b1)) >>> 0;
        const dbId = Config.NAME_DATABASES[Math.floor(Utils.seededRandom((seed ^ 0x5bd1e995) >>> 0) * Config.NAME_DATABASES.length)];
        let gen = null;
        try {
          gen = window.generateSeededMarkovName(seed & 0xffff, (seed >>> 16) & 0xffff, index + 1, dbId, 2, 4, 12);
        } catch (e) { gen = null; }
        if (!gen || gen === "Unknown" || gen === "NPC") continue; // i18n-ignore: Markov generator sentinels
        if (taken?.has(gen)) continue;
        const known = $gameSystem._npcSociety?.[gen];
        if (known && known._homeGroupName !== groupName) continue;
        name = gen;
      }
      if (!name) return null;
      taken?.add(name);

      const charName = charPool[Math.floor(Utils.seededRandom(seed) * charPool.length)];
      // Big-character sprites (!$) have one slot; normal sheets use 0-7.
      const isBigSprite = charName.includes('!$');
      const charIdx = isBigSprite ? 0 : Math.floor(Utils.seededRandom((seed * 2) >>> 0) * 8);

      const classId = ProceduralManager.seededClassId((seed ^ 0x51ed270b) >>> 0);
      const profile = window.NPCSocietyRegistry?.ensureProfile?.(name, classId)
        || $gameSystem._npcSociety?.[name];
      if (profile) {
        profile._homeGroupName = groupName;
        window.NPCSocietyRegistry?.applyHometownOpinionIfMatch?.(profile, groupName);
        // Bind the rolled world sprite to the profile so the Empathize portrait,
        // the conversation voice and any later respawn all resolve to the same
        // person the player sees (see setupProceduralMapNPCs for the full
        // reasoning behind each field).
        const npcEntry = window.WorldGen?.NPCs?.[charName] || null;
        const spriteBust = npcEntry?.busts?.[charIdx] ?? npcEntry?.busts?.[0] ?? null;
        profile.spriteKey = charName;
        profile.bustIndex = charIdx;
        if (spriteBust && spriteBust !== "7") profile._bustName = spriteBust;
        if (npcEntry?.markovDB && profile.markovDb == null) profile.markovDb = npcEntry.markovDB;
        if (npcEntry && npcEntry.Gender != null) profile.gender = npcEntry.Gender;
      }
      try { window.NPCLifeSim?.ensureLifeRecord?.(name, groupName); } catch (_) {}

      return {
        name,
        spriteName: charName,
        spriteIndex: charIdx,
        eventData: {
          id: donor.id,
          name,
          note: donor.note || "",
          characterName: charName,
          characterIndex: charIdx,
          pages: JSON.parse(JSON.stringify(donor.pages)),
        },
      };
    },

    // Forces a spawned event to wear a specific sprite on every page, used for
    // citizens whose pages were cloned from an unrelated donor template.
    applyCitizenSprite: (targetEvent, characterName, characterIndex) => {
      if (!targetEvent || !characterName) return;
      const evData = targetEvent.event();
      evData.pages?.forEach(p => {
        // Trailing blank pages (the self-switch-gated "hide on recruit" page)
        // must stay graphic-less, see transplantData.
        if ((p?.list?.length ?? 0) <= 1) return;
        if (p?.image) { p.image.characterName = characterName; p.image.characterIndex = characterIndex; }
      });
      evData.characterName = characterName;
      evData.characterIndex = characterIndex;
      targetEvent.setImage(characterName, characterIndex);
      targetEvent.refresh();
      targetEvent.setupPage();
    },

    // Gives every citizen just spawned in Omega City one of the city's own
    // residential doors. Society profiles for pool-spawned NPCs are generated
    // lazily, a few per frame (NPCSociety's deferred pass), so anyone still
    // missing one is retried on the next frame rather than left homeless.
    houseOmegaCitizens: (mapId, groupName, names, attempt = 0) => {
      if (!names?.length || !$gameMap || $gameMap.mapId() !== mapId) return;

      const society = $gameSystem._npcSociety || {};
      const pending = names.filter(n => !society[n]);
      const ready = names.filter(n => society[n]);

      if (ready.length) {
        const housed = window.NPCSim?.assignHomesOnMap?.(mapId, groupName, ready) ?? 0;
        if (housed) Utils.debug(`Omega City: ${housed} citizens moved into the city's own houses.`);
      }
      // ~4 seconds of frames is far more than the deferred profile pass needs.
      if (pending.length && attempt < 240) {
        requestAnimationFrame(() =>
          SpawnManager.houseOmegaCitizens(mapId, groupName, pending, attempt + 1));
      }
    },

    // Seat-aware variant of randomizeOmegaTowerMap for the PublicTransport
    // group (buses/trams/trains): fills TRANSPORT_SEAT_EMPTY_RATIO-adjusted
    // region-102 seats with sitting riders (facing down, no wander
    // controller, so they stay put for the whole ride) and spreads the
    // remaining riders across the vehicle's other passable floor tiles with
    // the normal wandering AI, exactly like any other global-group NPC.
    randomizePublicTransportMap: (mapId, groupName) => {
      const npcPool = SpawnManager.getNPCPool(groupName);
      const allPlaceholders = SpawnManager.getPlaceholders(true); // Include Player1-Player8 as placeholders
      if (!npcPool.length || !allPlaceholders.length) return;

      const seatTiles  = MapManager.getSeatTiles();
      const floorTiles = MapManager.getSpreadSpawnTiles()
        .filter(t => $gameMap.regionId(t.x, t.y) !== Config.Zones.TRANSPORT_SEAT);

      const shuffledSeats = Utils.shuffle(seatTiles);
      const seatFillCount = Math.floor(shuffledSeats.length * (1 - Config.TRANSPORT_SEAT_EMPTY_RATIO));
      const seatsToFill    = shuffledSeats.slice(0, seatFillCount);

      const shuffledPool = Utils.shuffle(npcPool);

      // Seat headcount is driven directly by the vehicle's own seat count
      // (per spec), not the generic <Interior>/<Exterior> density formula
      // randomizeOmegaTowerMap uses, that formula's tiny <Interior> cap
      // (baseLimit 2) was tuned for house-sized rooms and would starve a
      // whole subway car's worth of seats.
      const seatCount = Math.min(seatsToFill.length, shuffledPool.length, allPlaceholders.length);

      // Standees get a modest budget on top of that, same general-purpose cap
      // used for pre-placed <AI> events (getNPCSpawnLimit), so the aisle
      // doesn't get more wanderers than a normal map would.
      const wanderBudget = Math.max(0, Math.min(MapManager.getNPCSpawnLimit(), shuffledPool.length - seatCount, allPlaceholders.length - seatCount));
      const wanderCount  = Math.min(floorTiles.length, wanderBudget);
      const actualCount  = seatCount + wanderCount;

      const activePlaceholders = allPlaceholders.slice(0, actualCount);
      const unusedPlaceholders = allPlaceholders.slice(actualCount);

      let poolIdx = 0;

      // Seated riders: locked onto their seat tile, facing down, no wander
      // controller, i.e. an interactable NPC that never leaves its seat.
      for (let i = 0; i < seatCount; i++) {
        const { event: targetEvent } = activePlaceholders[poolIdx];
        const npcDataItem = shuffledPool[poolIdx % shuffledPool.length];
        poolIdx++;

        if (!targetEvent || !npcDataItem?.eventData) { targetEvent?.erase(); continue; }
        if (!SpawnManager.transplantData(targetEvent, npcDataItem.eventData, poolIdx)) {
          targetEvent.erase();
          continue;
        }

        const seat = seatsToFill[i];
        targetEvent._npcRosterSpawn = true;
        targetEvent._npcSeated = true;
        targetEvent._moveType = 0;
        targetEvent.setMoveFrequency(5);
        targetEvent.setThrough(false);
        targetEvent.setOpacity(255);
        targetEvent.locate(seat.x, seat.y);
        targetEvent.setDirection(2); // face down, as if sitting
      }

      // Standing riders: same wandering AI/routine as any other global-group NPC.
      for (let i = 0; i < wanderCount; i++) {
        const { event: targetEvent } = activePlaceholders[poolIdx];
        const npcDataItem = shuffledPool[poolIdx % shuffledPool.length];
        poolIdx++;

        if (!targetEvent || !npcDataItem?.eventData) { targetEvent?.erase(); continue; }
        if (!SpawnManager.transplantData(targetEvent, npcDataItem.eventData, poolIdx)) {
          targetEvent.erase();
          continue;
        }

        const tile = floorTiles[i];
        if (!tile) { targetEvent.erase(); continue; }
        targetEvent.locate(tile.x, tile.y);
        SpawnManager.injectBrain(targetEvent, targetEvent.event());
      }

      console.log(`[NPC System] ${seatCount} seated + ${wanderCount} standing NPCs randomized on PublicTransport map ${mapId} (${MapManager.getMapName(mapId)})`);

      unusedPlaceholders.forEach(u => u.event.erase());
    }
  };

  // Building doors/tent markers the prefab system can drop into ANY biome, not
  // just City/Village/Burg (a lone farmstead or hamlet on a Plains/Forest/...
  // tile), see ProceduralHouseSystem.residentialPoolForDoor for the matching
  // "which house pool" logic on the interaction side.
  const SETTLEMENT_DOOR_FEATURES = new Set([
    "DoorHouse", "DoorInn", "DoorShop", "DoorSkyscraper", "Tent" // i18n-ignore: Features.json ids
  ]);

  // Scans the current map's feature layers (2-3, matching
  // ProceduralHouseSystem.facedInteractFeatureName) for any tile belonging to
  // SETTLEMENT_DOOR_FEATURES and returns their {x,y} coordinates.
  function getSettlementDoorTiles() {
    const U = window.ProcGenUtils;
    if (!U || !U.Cache || !U.createTileToFeatureMap || !U.getFeatureNameFromTileId) return [];
    if (!$gameMap || !$dataMap) return [];
    const tileset = $gameMap.tileset();
    const tilesetId = tileset ? tileset.id : 0;
    if (!tilesetId) return [];
    const lookup = U.createTileToFeatureMap(U.Cache.getTilesetFeatures(tilesetId));
    if (!lookup) return [];

    const w = $gameMap.width();
    const h = $gameMap.height();
    const found = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (const z of [2, 3]) {
          const tileId = $gameMap.tileId(x, y, z);
          if (tileId === 0) continue;
          const name = U.getFeatureNameFromTileId(tileId, lookup);
          if (SETTLEMENT_DOOR_FEATURES.has(name)) {
            found.push({ x, y });
            break;
          }
        }
      }
    }
    return found;
  }

  // A door/tent tile is the building's entrance: the player has to stand on a
  // tile touching it and face it to go in (see
  // ProceduralHouseSystem.facedInteractFeatureName), so the ring around it must
  // stay walkable. Citizens belonging to that building are scattered in the
  // band beyond the doorstep instead of parked on it.
  const DOOR_CLEARANCE = 1;        // Chebyshev ring kept free around every door
  const DOOR_CLUSTER_RADIUS = 5;   // still counts as "outside this building"

  // Keys of every tile within DOOR_CLEARANCE of one of the given door tiles.
  function getDoorwayClearance(doorTiles) {
    const blocked = new Set();
    for (const d of doorTiles) {
      for (let dy = -DOOR_CLEARANCE; dy <= DOOR_CLEARANCE; dy++) {
        for (let dx = -DOOR_CLEARANCE; dx <= DOOR_CLEARANCE; dx++) {
          blocked.add(`${d.x + dx},${d.y + dy}`);
        }
      }
    }
    return blocked;
  }

  // One tile per NPC, scattered around the doors round-robin (so several lone
  // buildings each get their own citizens instead of everyone piling onto the
  // first). Picking at random out of the whole free band beats picking the
  // nearest tile, which always resolved to the doorstep the player needs.
  function pickDoorClusterTiles(doorTiles, validTiles, count, baseSeed) {
    const blocked = getDoorwayClearance(doorTiles);
    const free = validTiles.filter(t => !blocked.has(`${t.x},${t.y}`));
    const used = new Set();
    const tiles = [];

    for (let i = 0; i < count; i++) {
      const door = doorTiles[i % doorTiles.length];
      const band = [];
      for (const t of free) {
        if (used.has(`${t.x},${t.y}`)) continue;
        const dist = Math.max(Math.abs(t.x - door.x), Math.abs(t.y - door.y));
        if (dist <= DOOR_CLUSTER_RADIUS) band.push(t);
      }

      let pick = null;
      if (band.length) {
        const roll = Utils.seededRandom(baseSeed ^ ((i + 1) * 0x9e3779b1));
        pick = band[Math.min(band.length - 1, Math.floor(roll * band.length))];
      } else {
        // Nothing free around this building (walled in, water, other NPCs):
        // fall back to the closest tile that is still outside the doorway.
        let bestDist = Infinity;
        for (const t of free) {
          if (used.has(`${t.x},${t.y}`)) continue;
          const dist = Math.abs(t.x - door.x) + Math.abs(t.y - door.y);
          if (dist < bestDist) { bestDist = dist; pick = t; }
        }
      }
      if (!pick) continue;

      used.add(`${pick.x},${pick.y}`);
      tiles.push(pick);
    }
    return tiles;
  }

  const ProceduralManager = {
    setupProceduralMapNPCs: () => {
      if (!$gameMap || !$dataMap) return;
      if ($gameMap.mapId() !== 636) return;

      const worldX = $gameVariables.value(43) || 1;
      const worldY = $gameVariables.value(44) || 1;
      // Mix the world (history) seed into NPC placement/identity so each world
      // seed populates the same tile with different NPCs, deterministically.
      const procWorldSeed = window.ProcGenUtils?.getWorldSeed?.() ?? 19002001;
      const baseSeed = window.ProcGenUtils?.hashCoords?.(procWorldSeed, worldX, worldY)
        ?? ((worldX * 73856093) ^ (worldY * 19349663));

      const p2Active = window.$gameSplitScreen && window.$gameSplitScreen.active;
      const p2Name = p2Active ? window.$gameSplitScreen.p2EventName : null;

      // Citizens recruited into the party on a prior visit to this exact world
      // tile must not respawn: erase their event slots up front so they are gone
      // for good (map 636 is rebuilt fresh each visit, clearing the erase flag,
      // so this has to run every time from the persisted world-folder record).
      const recruitedIds = ProceduralManager.getRecruitedEventIds(worldX, worldY);

      const npcEvents = $gameMap.events().filter(e => {
        const name = e?.event()?.name;
        if (!name) return false;
        if (p2Active && name === p2Name) return false;
        if (name.match(/^Player\d+$/)) return false; // Ignore players!
        if (recruitedIds && recruitedIds.has(e.eventId())) {
          $gameMap.eraseEvent(e.eventId());
          return false;
        }
        return name.startsWith("NPC") || name.startsWith("Placeholder"); // i18n-ignore: event-name prefixes
      });
      if (!npcEvents.length) return;

      const biomeName = $gameSystem?._procGenData?.currentBiome || "Fields";
      const isCityBiome = biomeName.toLowerCase().includes("city");
      const isSettlementBiome = isCityBiome
        || biomeName.toLowerCase().includes("village")
        || biomeName.toLowerCase().includes("burg");

      // Lone building doors/tents scattered outside a proper settlement (see
      // SETTLEMENT_DOOR_FEATURES) get their own small NPC cluster below,
      // regardless of the biome's own hasNPC/cull rules.
      // Every door/tent on the map, whatever the biome: their doorsteps are kept
      // clear in both placement paths below. Only the ones outside a proper
      // settlement additionally get their own NPC cluster.
      const doorTiles = getSettlementDoorTiles();
      const settlementDoorTiles = isSettlementBiome ? [] : doorTiles;

      let hasNPC = true;
      if (window.WorldGen && window.WorldGen.Biomes) {
        const biomeObj = window.WorldGen.Biomes.find(b => b.name === biomeName);
        if (biomeObj && biomeObj.hasNPC !== undefined) {
          hasNPC = biomeObj.hasNPC;
        }
      }

      if (!hasNPC && settlementDoorTiles.length === 0) {
        npcEvents.forEach(ev => $gameMap.eraseEvent(ev.eventId()));
        $gameSystem._currentProcGroup = null;
        return;
      }

      // Register the synthetic per-tile settlement so every NPC placed below is
      // a first-class citizen of the simulation (society, life record, world-web
      // pulse, politics, jobs all key off this group name).
      const settlementGroup = ProceduralManager.ensureProcSettlement(worldX, worldY, biomeName);

      let activeEvents = npcEvents;

      if (settlementDoorTiles.length > 0) {
        // 1-2 NPCs per door/tent found outside a settlement, instead of the
        // biome's usual random cull.
        let wantCount = 0;
        settlementDoorTiles.forEach((_, i) => {
          const doorRng = Utils.seededRandom(baseSeed ^ (0x0d00d ^ (i * 7919)));
          wantCount += 1 + Math.floor(doorRng * 2);
        });
        const keepCount = Math.max(1, Math.min(npcEvents.length, wantCount));
        const indices = Array.from({ length: npcEvents.length }, (_, i) => i);

        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Utils.seededRandom(baseSeed ^ (i * 12345)) * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        const toCull = indices.slice(keepCount);
        toCull.forEach(idx => $gameMap.eraseEvent(npcEvents[idx].eventId()));
        activeEvents = npcEvents.filter((_, i) => !toCull.includes(i));
      } else if (!isCityBiome) {
        const cullRng = Utils.seededRandom(baseSeed ^ 0xdeadbeef);
        const keepCount = Math.max(1, Math.ceil(npcEvents.length * (0.3 + cullRng * 0.4)));
        const indices = Array.from({ length: npcEvents.length }, (_, i) => i);

        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Utils.seededRandom(baseSeed ^ (i * 12345)) * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        const toCull = indices.slice(keepCount);
        toCull.forEach(idx => $gameMap.eraseEvent(npcEvents[idx].eventId()));
        activeEvents = npcEvents.filter((_, i) => !toCull.includes(i));
      }

      const validTiles = MapManager.findPassableTerrainTiles();

      let placementTiles;
      if (settlementDoorTiles.length > 0) {
        placementTiles = pickDoorClusterTiles(settlementDoorTiles, validTiles, activeEvents.length, baseSeed);
      } else {
        for (let i = validTiles.length - 1; i > 0; i--) {
          const j = Math.floor(Utils.seededRandom(baseSeed ^ (i * 54321)) * (i + 1));
          [validTiles[i], validTiles[j]] = [validTiles[j], validTiles[i]];
        }
        // Doorsteps go to the back of the queue rather than being dropped, so a
        // crowded city keeps its full spawn capacity but only blocks an
        // entrance when the map has literally nowhere else left to stand.
        if (doorTiles.length > 0) {
          const blocked = getDoorwayClearance(doorTiles);
          const open = [], doorstep = [];
          for (const t of validTiles) {
            (blocked.has(`${t.x},${t.y}`) ? doorstep : open).push(t);
          }
          placementTiles = open.concat(doorstep);
        } else {
          placementTiles = validTiles;
        }
      }

      activeEvents.forEach((ev, i) => {
        if (i < placementTiles.length) {
          ev.locate(placementTiles[i].x, placementTiles[i].y);
        } else {
          $gameMap.eraseEvent(ev.eventId());
          return;
        }

        const graphicSeed = baseSeed ^ (ev.eventId() * 83492791);
        const charPool    = buildNPCCharacterPool();
        const charName    = charPool[Math.floor(Utils.seededRandom(graphicSeed) * charPool.length)];
        // Big-character sprites (!$) have one slot; normal multi-character sheets use 0-7
        const isBigSprite = charName.includes('!$');
        const charIdx     = isBigSprite ? 0 : Math.floor(Utils.seededRandom(graphicSeed * 2) * 8);

        const evData = ev.event();
        evData.pages?.forEach(p => { if (p) { p.image = p.image || {}; p.image.characterName = charName; p.image.characterIndex = charIdx; } });
        evData.characterName = charName;
        evData.characterIndex = charIdx;

        ev.setImage(charName, charIdx);
        ev.refresh();
        ev.setupPage();

        // The chosen world sprite is the single source of truth for this NPC's
        // portrait and dialogue voice: pull the matching bust and Markov DB
        // straight from its NPCs.json entry so the chat portrait matches the
        // sprite the player sees, and so the conversation uses a sprite-
        // appropriate voice instead of a random name database.
        const npcEntry    = window.WorldGen?.NPCs?.[charName] || null;
        const spriteBust  = npcEntry?.busts?.[charIdx] ?? npcEntry?.busts?.[0] ?? null;
        const spriteDb    = npcEntry?.markovDB || null;
        const spriteGender = npcEntry && npcEntry.Gender != null ? npcEntry.Gender : null;

        let genName = "NPC";
        if (window.generateSeededMarkovName) {
          const dbId = Config.NAME_DATABASES[Math.floor(Utils.seededRandom(graphicSeed) * Config.NAME_DATABASES.length)];
          try { genName = window.generateSeededMarkovName(worldX ^ (procWorldSeed & 0xffff), worldY ^ ((procWorldSeed >>> 16) & 0xffff), ev.eventId(), dbId, 2, 4, 12); } catch (e) { }
        }
        // Safety net: if generation was unavailable/failed and the name is
        // still the bare placeholder "NPC" (or "Unknown" from a missing DB),
        // fall back to one seeded off the fixed name-generation seed instead,
        // see transplantData for the same rule.
        if ((genName === "NPC" || genName === "Unknown" || !genName) && window.generateSeededMarkovName) { // i18n-ignore: Markov generator sentinels
          const worldSeed = Config.NPC_NAME_SEED;
          const dbId = Config.NAME_DATABASES[Math.floor(Utils.seededRandom(worldSeed ^ (ev.eventId() * 83492791)) * Config.NAME_DATABASES.length)];
          try {
            const fallbackName = window.generateSeededMarkovName(worldSeed & 0xffff, (worldSeed >>> 16) & 0xffff, ev.eventId(), dbId, 2, 4, 12);
            if (fallbackName && fallbackName !== "Unknown") genName = fallbackName; // i18n-ignore: Markov generator sentinel
          } catch (e) {}
        }
        if (!genName || genName === "Unknown") genName = "NPC"; // i18n-ignore: Markov generator sentinel / event-name prefix
        evData.name = genName;
        // Same volatility as a roster spawn: this name and sprite only exist in
        // $dataMap, which is re-read from disk on every Scene_Map rebuild. See
        // SpawnManager.snapshotSpawn.
        SpawnManager.snapshotSpawn(ev);

        // Give every procedural citizen a full identity rooted in the same
        // world-seed+coords+eventId seed as its name/sprite, so class, gender
        // and stats are random yet reproducible per (worldSeed, worldX, worldY).
        // A class is passed explicitly so it lands even on the canon default
        // seed (19002001), where the society generator's npcData-driven class
        // assignment is otherwise skipped.
        const procClassId = ProceduralManager.seededClassId(graphicSeed ^ 0x51ed270b);
        const profile = ProceduralManager.registerProcCitizen(genName, ev, settlementGroup, procClassId);
        if (profile) {
          // Bind the chosen world sprite to the society profile so:
          //  - getBustForNPC (NPCEmpathize portrait) resolves the bust that
          //    belongs to this exact sprite from NPCs.json, instead of the
          //    generic 7.png fallback;
          //  - _applySocietySprite (NPCSociety, runs after this on non-canon
          //    seeds) re-applies the SAME sprite rather than overriding the
          //    world sprite with a random one and caching a mismatched bust;
          //  - conversations use the sprite's own Markov voice (markovDB).
          profile.spriteKey = charName;
          profile.bustIndex = charIdx;
          if (spriteBust && spriteBust !== "7") profile._bustName = spriteBust;
          if (spriteDb && profile.markovDb == null) profile.markovDb = spriteDb;

          // Gender comes from the sprite's NPCs.json entry (0=Male, 1=Female,
          // 2=Non-binary, see ClassSelector gender map), so the identity matches
          // the world sprite the player sees rather than a random roll.
          if (spriteGender != null) profile.gender = spriteGender;
        }

        const controller = new NPCController(genName);
        $gameSystem.npcControllers.push(controller);
        controller.decideNextGoal();
      });

      console.log(`[NPC System] ${activeEvents.length} NPCs set up on procedural map ${$gameMap.mapId()} (${MapManager.getMapName($gameMap.mapId())}), settlement "${settlementGroup}"`);
    },

    PROC_GROUP_PREFIX: "Proc", // i18n-ignore: settlement key prefix, "Proc:x,y"

    procGroupName: (worldX, worldY) => `${ProceduralManager.PROC_GROUP_PREFIX}:${worldX},${worldY}`,

    // Registers (once) a deterministic synthetic settlement for the current
    // procedural world tile and marks it as the live settlement so
    // findGroupByMap(636) and the world-web pulse resolve to it. Returns the
    // group name.
    ensureProcSettlement: (worldX, worldY, biomeName) => {
      if (!$gameSystem) return null;
      const groupName = ProceduralManager.procGroupName(worldX, worldY);
      const groups = $gameSystem._npcMapGroups || ($gameSystem._npcMapGroups = {});

      if (!groups[groupName]) {
        const group = {
          maps: [636],
          mainMaps: [636],
          // Best-effort scan of the live map for door events; procedural prefab
          // houses carry no door events, so registerProcCitizen also seeds one
          // residence per citizen below.
          residentialBuildings: _scanMapForResidentialBuildings(636, $dataMap),
          _procedural: true,
          worldX, worldY,
          biome: biomeName || null,
        };
        _populateGroupJobs({ [groupName]: group });
        groups[groupName] = group;

        // Keep the registry cache coherent if it is a different object than
        // $gameSystem._npcMapGroups (e.g. loaded from the worldgen manifest).
        if (GroupRegistry._cache && GroupRegistry._cache !== groups) {
          GroupRegistry._cache[groupName] = group;
        }
      }

      // Anchor the settlement (and everyone born in it) to the nation of the
      // world tile it sits on: Variable 86 holds the current country id, set by
      // WeatherSystem from the world-map region before the player transferred
      // in. This is what makes a procedural citizen a "citizen of" the current
      // nation rather than a randomly seeded one (see NPCPolitics
      // resolveGroupPolity). A tile's nation never changes, so refresh it each
      // visit, which also backfills groups saved before this field existed.
      {
        const nationId = ($gameVariables?.value(86)) || 0;
        const country  = (window.WorldGen?.Countries || []).find(c => c.id === nationId) || null;
        const grp = groups[groupName];
        grp.nationId = nationId;
        grp.country  = country?.country || null;
        // Readable home-town label for menus (the raw key is "Proc:x,y").
        const isPlace = biomeName && !['Normal', 'Road'].includes(biomeName); // i18n-ignore: Biomes.json ids
        const place   = isPlace ? biomeName : T('NPCSystem.frontier');
        grp.displayName = country
          ? T('NPCSystem.placeOfCountry', { place: place, country: country.country })
          : T('NPCSystem.placeSettlement', { place: place });
      }

      $gameSystem._currentProcGroup = groupName;
      MapManager.setCurrentMapGroup(groupName);
      return groupName;
    },

    // Promotes a freshly placed procedural NPC into the full simulation: a
    // society identity anchored to the settlement, a residence at its tile, and
    // a life record (birth, career, relationships, crime) that the background
    // simulators evolve over time.
    registerProcCitizen: (name, ev, groupName, classId = null) => {
      if (!name || !groupName) return null;
      const profile = window.NPCSocietyRegistry?.ensureProfile?.(name, classId)
        || $gameSystem._npcSociety?.[name];
      if (profile) {
        profile._homeGroupName = groupName;
        window.NPCSocietyRegistry?.applyHometownOpinionIfMatch?.(profile, groupName);

        // Each citizen notionally lives where they stand: derive a residence
        // from the spawn tile so the settlement has buildings tied to its
        // population even though procedural prefabs carry no door events.
        // This is a PLACEHOLDER address: the first time the player actually
        // walks through one of the settlement's doors, NPCSim.ensureBuildingResidents
        // moves citizens still holding one of these into the real building.
        if (!profile.homeBuilding && ev) {
          const building = {
            mapId: 636, eventId: ev.eventId(), x: ev.x, y: ev.y,
            seed: (groupName.length * 1000000) + ev.x * 1000 + ev.y,
            type: 'visitHouse', poolName: '', capacity: 2,
            groupName, _placeholder: true,
          };
          profile.homeBuilding = building;
          profile.homeSeed = building.seed;
          const group = $gameSystem._npcMapGroups?.[groupName];
          if (group && Array.isArray(group.residentialBuildings) &&
            !group.residentialBuildings.some(b => b.x === building.x && b.y === building.y)) {
            group.residentialBuildings.push(building);
          }
        }
      }
      // Life record works even before the society DataLoader is ready, so the
      // settlement census/pulse counts this NPC regardless.
      try { window.NPCLifeSim?.ensureLifeRecord?.(name, groupName); } catch (_) {}
      return profile || null;
    },

    // Deterministically pick a real, playable class id from $dataClasses for a
    // procedural citizen. Returns null when class data is unavailable (the
    // society generator then falls back to its own class handling).
    seededClassId: (seed) => {
      const classes = $dataClasses;
      if (!Array.isArray(classes)) return null;
      const valid = [];
      for (let i = 1; i < classes.length; i++) { if (classes[i]) valid.push(classes[i].id); }
      if (!valid.length) return null;
      return valid[Math.floor(Utils.seededRandom(seed) * valid.length)];
    },

    // Key for the recruited-citizen store: procedural NPCs are placed
    // deterministically per (worldX, worldY, eventId), so a recruit is uniquely
    // identified by those three coordinates. Map 636 is reused for every world
    // tile, so the world coords MUST be part of the key (a bare eventId would
    // wrongly erase the same event slot on every other tile too).
    procRecruitKey: (worldX, worldY, eventId) => `${worldX},${worldY},${eventId}`,

    // Records a procedural citizen (map 636) that has just joined the party, so
    // it never respawns on this world tile again. The record lives in the world
    // folder (npcs.json → recruitedProcCitizens) via the WorldManager accessor,
    // so it is shared by every savegame of the world. A snapshot of the society
    // profile is cached alongside it so the recruit survives independently of
    // whatever party actor slot it currently occupies. Also erases the live
    // event immediately so it vanishes the moment the player closes the panel.
    recordProceduralRecruit: (eventId, eventName) => {
      if (!$gameSystem || !$gameMap || $gameMap.mapId() !== 636) return;
      eventId = Number(eventId) || 0;
      if (!eventId) return;
      // Default coords must match setupProceduralMapNPCs (|| 1) so the recorded
      // key lines up with the key getRecruitedEventIds looks up at spawn time.
      const worldX = $gameVariables.value(43) || 1;
      const worldY = $gameVariables.value(44) || 1;
      const store = $gameSystem._npcRecruitedProcCitizens
        || ($gameSystem._npcRecruitedProcCitizens = {});
      const key = ProceduralManager.procRecruitKey(worldX, worldY, eventId);
      let profileSnapshot = null;
      try {
        const profile = window.NPCSocietyRegistry?.getProfile?.(eventName)
          || $gameSystem._npcSociety?.[eventName] || null;
        if (profile) profileSnapshot = JsonEx.makeDeepCopy(profile);
      } catch (_) { profileSnapshot = null; }
      store[key] = {
        name: eventName || null,
        worldX, worldY, eventId,
        recruitedAtMin: $gameVariables.value(114) || 0,
        profile: profileSnapshot,
      };
      // Reassigning the accessor-backed field re-persists it through WorldManager.
      $gameSystem._npcRecruitedProcCitizens = store;
      $gameMap.eraseEvent(eventId);
    },

    // Event ids of citizens recruited on the given world tile, so the spawn pass
    // can skip (and erase) them when the procedural map is regenerated.
    getRecruitedEventIds: (worldX, worldY) => {
      const store = $gameSystem?._npcRecruitedProcCitizens;
      if (!store) return null;
      const prefix = `${worldX},${worldY},`;
      let ids = null;
      for (const key of Object.keys(store)) {
        if (!key.startsWith(prefix)) continue;
        const id = parseInt(key.slice(prefix.length), 10);
        if (Number.isFinite(id)) (ids || (ids = new Set())).add(id);
      }
      return ids;
    }
  };

  // ── MinHeap ────────────────────────────────────────────────────────────────
  // Binary min-heap for A* open set, O(log n) push/pop/update vs O(n) for the
  // old sorted-array approach, which had O(n) indexOf + splice on every node update.
  class _MinHeap {
    constructor(scoreMap) { this._d = []; this._s = scoreMap; this._i = new Map(); }
    get size() { return this._d.length; }
    has(k)     { return this._i.has(k); }
    push(k)    { const i = this._d.length; this._d.push(k); this._i.set(k, i); this._up(i); }
    pop()      {
      const top = this._d[0], last = this._d.pop();
      if (this._d.length) { this._d[0] = last; this._i.set(last, 0); this._down(0); }
      this._i.delete(top); return top;
    }
    update(k)  { const i = this._i.get(k); if (i == null) return; this._up(i); this._down(this._i.get(k) ?? i); }
    _sc(k)     { return this._s.get(k) ?? Infinity; }
    _sw(i, j)  { [this._d[i], this._d[j]] = [this._d[j], this._d[i]]; this._i.set(this._d[i], i); this._i.set(this._d[j], j); }
    _up(i)     { while (i > 0) { const p = (i - 1) >> 1; if (this._sc(this._d[p]) <= this._sc(this._d[i])) break; this._sw(i, p); i = p; } }
    _down(i)   { const n = this._d.length; for (;;) { const l = 2*i+1, r = l+1; let m = i; if (l < n && this._sc(this._d[l]) < this._sc(this._d[m])) m = l; if (r < n && this._sc(this._d[r]) < this._sc(this._d[m])) m = r; if (m === i) break; this._sw(i, m); i = m; } }
  }

  // Frame-level pathfinder cache, rebuilt at most once per Graphics.frameCount
  // so every NPC that pathfinds in the same frame shares one event-grid snapshot.
  let _pathfinderFrameCache = null;
  function _getPathfinderFrameCache(mapW) {
    const fc = Graphics.frameCount;
    if (_pathfinderFrameCache && _pathfinderFrameCache.frame === fc) return _pathfinderFrameCache;
    const getKey = (x, y) => x + y * mapW;
    const evts = $gameMap.events();
    const eventGrid = new Map();
    for (const ev of evts) {
      if (ev && !ev.isThrough() && !Utils.isWalkThroughDoor(ev.event()?.name || ""))
        eventGrid.set(getKey(ev.x, ev.y), ev);
    }
    const doorKeys = new Set();
    for (const ev of evts) {
      if (ev && Utils.isWalkThroughDoor(ev.event()?.name || "")) doorKeys.add(getKey(ev.x, ev.y));
    }
    const allNpcKeys = new Set();
    for (const c of $gameSystem.npcControllers ?? []) {
      if (c.event && !c.event._erased) allNpcKeys.add(getKey(c.event.x, c.event.y));
    }
    const enemyDangerKeys = new Set();
    for (const ev of evts) {
      if (ev && ev.event()?.name.startsWith("Enemy")) {
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (Math.abs(dx) + Math.abs(dy) < 3) enemyDangerKeys.add(getKey(ev.x + dx, ev.y + dy));
      }
    }
    _pathfinderFrameCache = { frame: fc, eventGrid, doorKeys, allNpcKeys, enemyDangerKeys };
    return _pathfinderFrameCache;
  }

  // State → "updateXxx" handler name, memoized so the per-NPC tick doesn't
  // rebuild the template string every time.
  const _stateMethodNames = Object.create(null);
  function _stateMethodName(state) {
    return _stateMethodNames[state] ||
      (_stateMethodNames[state] = `update${state.charAt(0).toUpperCase()}${state.slice(1)}`);
  }

  // Lazy Map from trait id → trait object, avoids O(n) Array.find per trait lookup.
  let _traitsById = null;
  function _getTraitsById() {
    if (_traitsById) return _traitsById;
    const arr = window._NPCSocietyDataLoader?.traits;
    if (!arr || !arr.length) return new Map();
    _traitsById = new Map(arr.map(t => [t.id, t]));
    return _traitsById;
  }

  // ==========================================================================
  // CORE AI CLASSES
  // ==========================================================================
  class Pathfinder {
    constructor(character) { this.character = character; }

    isPassable(x, y, d, eventGrid) {
      const r = $gameMap.regionId(x, y);
      if (r === 5) return true;
      if (r === 10) return false;
      // Keep roaming NPCs off water so they do not appear to drown. Water is
      // region 99 or terrain tag 3 (matches MovementInteractionSystem) (#121).
      if (r === 99 || $gameMap.terrainTag(x, y) === 3) return false;

      const mapW = $gameMap.width();
      const key = x + y * mapW;
      const ev = eventGrid.get(key);
      if (ev && ev !== this.character) return false;

      if (d) return this.character.canPass(x, y, d);
      return [2, 4, 6, 8].some(dir => $gameMap.isPassable(x, y, dir));
    }

    findPath(startX, startY, goalX, goalY, avoidEnemies = true, avoidNPCs = true) {
      const mapW = $gameMap.width();
      const getKey = (x, y) => x + y * mapW;
      const { eventGrid, doorKeys, allNpcKeys, enemyDangerKeys } = _getPathfinderFrameCache(mapW);
      const selfKey = getKey(this.character.x, this.character.y);

      const closedSet = new Set(), cameFrom = new Map(), gScore = new Map(), fScore = new Map();
      const openHeap = new _MinHeap(fScore);
      const startK = getKey(startX, startY);
      const goalK  = getKey(goalX, goalY);

      gScore.set(startK, 0);
      fScore.set(startK, Utils.distance({ x: startX, y: startY }, { x: goalX, y: goalY }));
      openHeap.push(startK);

      let iterations = 0;
      while (openHeap.size > 0 && iterations++ < 500) {
        const currentK = openHeap.pop();
        if (currentK === goalK) return this.reconstructPath(cameFrom, currentK);
        closedSet.add(currentK);

        const cx = currentK % mapW, cy = Math.floor(currentK / mapW);
        const neighbors = [{ x: cx, y: cy - 1, d: 8 }, { x: cx, y: cy + 1, d: 2 }, { x: cx - 1, y: cy, d: 4 }, { x: cx + 1, y: cy, d: 6 }];

        for (const { x: nx, y: ny, d: dir } of neighbors) {
          const nK = getKey(nx, ny);
          if (!$gameMap.isValid(nx, ny) || closedSet.has(nK)) continue;
          const hasDoor = doorKeys.has(nK);
          if (!hasDoor && (!this.character.canPass(cx, cy, dir) || !this.isPassable(nx, ny, undefined, eventGrid))) continue;
          if (avoidEnemies && enemyDangerKeys.has(nK)) continue;
          if (avoidNPCs && allNpcKeys.has(nK) && nK !== selfKey) continue;

          const tGScore = (gScore.get(currentK) ?? 0) + 1;
          if (openHeap.has(nK) && tGScore >= (gScore.get(nK) ?? Infinity)) continue;

          cameFrom.set(nK, { pos: currentK, dir });
          gScore.set(nK, tGScore);
          fScore.set(nK, tGScore + Utils.distance({ x: nx, y: ny }, { x: goalX, y: goalY }));

          if (!openHeap.has(nK)) openHeap.push(nK);
          else openHeap.update(nK);
        }
      }
      return null;
    }

    reconstructPath(cameFrom, current) {
      const path = [];
      while (cameFrom.has(current)) {
        const node = cameFrom.get(current);
        path.unshift(node.dir);
        current = node.pos;
      }
      return path;
    }
  }

  class NPCController {
    constructor(eventName) {
      this.eventName = eventName;
      this.refreshEvent();
      this.state = "idle";
      this.target = null;
      this.path = [];

      this.lastUpdateTime = performance.now();
      this.nextMoveTime = this.lastUpdateTime + Utils.randBetween(1200, 3000);
      this.stateEndTime = this.lastUpdateTime + Utils.randBetween(3000, 6000);

      this.moveSpeed = 3;
      this.playerAware = false;
      this.lastPlayerReaction = 0;
      this.velocity = { x: 0, y: 0 };
      this._lastDist = 0; // player distance from the previous throttled tick
    }

    refreshEvent() {
      this.event = $gameMap.events().find(e => e?.event()?.name === this.eventName);
      this.eventId = this.event?.eventId();
      if (this.event) {
        this.pathfinder = new Pathfinder(this.event);
        const note = this.event.event()?.note || "";
        this.isLocal = note.toLowerCase().includes("local");
        this.clearStaleHideSwitch();
      }
    }

    // Self-switch A is NPCSystemParty's "hide on recruit" flag, keyed to
    // [mapId, eventId]. It can linger on a physical slot from a previous
    // occupant (a recruit who later left, or a slot reused/relocated by the
    // hourly turnover), stranding the next NPC on its blank page-2: the
    // controller still walks the event, but that page carries no commands, so
    // the NPC roams its routine yet can't be talked to. A controller-driven NPC
    // is by definition a free roamer (genuinely recruited NPCs have their
    // controller dropped on join, see NPCSystemParty.joinParty), so clear the
    // stale flag and snap the event back onto its dialogue page.
    //
    // Surgical on purpose: of the ~214 A-gated pages in the NPC pool, 208 are
    // blank "hide" pages (the bug) but 6 use A to swap to a *shorter but still
    // interactable* dialogue ("already met" states, e.g. the Dude template).
    // Only rescue when A has actually parked the event on a commandless page,
    // so those 6 keep working. Key off the event physically bound to this
    // controller, not the cached this.eventId (a by-name lookup that can point
    // at the wrong slot when two on-map NPCs share a name).
    clearStaleHideSwitch() {
      if (!this.event || this.event._erased) return;
      const eid = this.event.eventId();
      if (eid == null) return;
      const key = [$gameMap.mapId(), eid, 'A'];
      if (!$gameSelfSwitches?.value(key)) return;
      if ($gameParty?.members().some(a => a?.name?.() === this.eventName)) return;
      const page = this.event.page();
      const stuck = !page || (page.list?.length ?? 0) <= 1;
      if (!stuck) return;
      $gameSelfSwitches.setValue(key, false);
      this.event.refresh();
    }

    update() {
      // Interleaved updates & proximity throttling to keep frame rates constant.
      // Checked first so throttled frames pay for nothing else; the interval is
      // picked from the player distance cached on the previous throttled tick.
      // Guard: if eventId is null/undefined, modulo produces NaN which !== anything → permanent freeze.
      const throttleInterval = this._lastDist <= 5 ? 2 : 10;
      const _eid = Number.isFinite(this.eventId) ? this.eventId : 0;
      if (Graphics.frameCount % throttleInterval !== _eid % throttleInterval) {
        return;
      }

      const time = performance.now();
      this.lastUpdateTime = time;

      if (window.$gameSplitScreen && window.$gameSplitScreen.active &&
          (this.eventName === window.$gameSplitScreen.p2EventName ||
           this.event === window.$gameSplitScreen.p2Event)) {
        return;
      }

      if (!this.event || this.event._erased) return;

      const isTalking = $gameMap.isEventRunning() && $gameMap._interpreter.eventId() === this.eventId;
      if (isTalking) {
        if (this.state !== "talkingToPlayer") { this.state = "talkingToPlayer"; this.path = []; }
        this.turnToward($gamePlayer);
        return;
      }

      // Self-heal any slot that a stale hide-switch (self-switch A) has parked on
      // a blank, un-talkable page. Runs after the isTalking guard so it never
      // fights a live conversation, and is cheap: a single self-switch read
      // short-circuits unless the NPC is genuinely stuck. Covers paths that skip
      // transplantData's A-D clear, e.g. NPCs that stay put across the hourly
      // turnover (refreshCurrentMapForHour).
      this.clearStaleHideSwitch();

      if (this.state === "talkingToPlayer") this.decideNextGoal();

      // Refresh the cached distance used by the top-of-update throttle
      this._lastDist = Utils.distance(this.event, $gamePlayer);

      this.updatePlayerAwareness(time);
      this[_stateMethodName(this.state)]?.(time);
    }

    updatePlayerAwareness(time) {
      if (!this.event) return;
      const wasAware = this.playerAware;
      this.playerAware = Utils.distance(this.event, $gamePlayer) <= Config.playerAwarenessRange * 0.5;
      if (!this.playerAware || wasAware || time - this.lastPlayerReaction <= 20000) return;
      this.lastPlayerReaction = time;

      const profile = window.NPCSocietyRegistry?.getProfile(this.eventName);
      const opinion = profile?.playerOpinion ?? 0;
      const met     = opinion !== 0;
      const pName   = met ? ($gameParty.leader?.()?.name?.() ?? null) : null;

      // Road to 2012: 0 (calm, <=2010) .. 1 (max chaos, 2012). As it climbs,
      // people flee sooner, distrust strangers, and barely greet anyone.
      const tension = window.NPCSim?.eraTension?.() ?? 0;

      const _thought = (texts) => {
        window.NPCSim?.emit('npc:thought', { name: this.eventName, thought: Utils.randomElement(texts) });
      };

      // Reaction lines live in js/i18n/<lang>/plugins/NPCSystem.json. Two
      // variants of most pools: one that names the player, one for a stranger
      // whose name they do not know yet.
      const pool = (key, params) => T.list('NPCSystem.thought.' + key, params);
      const namedPool = (key, name) =>
        name ? pool(key + '.named', { name: name }) : pool(key + '.anon');

      // Very hostile opinion: flee from player. The flee bar relaxes as 2012
      // nears, so even mildly soured NPCs bolt when chaos peaks.
      if (opinion < -70 + tension * 35) {
        _thought(namedPool('flee', pName));
        const px = $gamePlayer.x, py = $gamePlayer.y;
        const ex = this.event.x,  ey = this.event.y;
        const dx = ex - px, dy = ey - py;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const tx = Math.max(1, Math.min($gameMap.width()  - 2, Math.round(ex + (dx / len) * 6)));
        const ty = Math.max(1, Math.min($gameMap.height() - 2, Math.round(ey + (dy / len) * 6)));
        this.target = { x: tx, y: ty };
        this.state  = 'goingToZone';
        this.stateEndTime = time + 8000;
        this.path = this.pathfinder.findPath(ex, ey, tx, ty) || [];
        return;
      }

      // Hostile faction rep: show anger, move away briefly (the rep bar for
      // open hostility also loosens as the era sours).
      if ((profile?.factionIndex ?? -1) >= 0 && window.$gameFactions) {
        const rep = window.$gameFactions.getReputation?.(profile.factionIndex) ?? 0;
        if (rep < -40 + tension * 25) {
          _thought(namedPool('disdain', pName));
          this.state = 'wandering';
          this.stateEndTime = time + 5000;
          return;
        }
      }

      // The road to 2012: ordinary, unsoured NPCs grow paranoid and distrustful,
      // eyeing the player and edging away even with no real grievance. The
      // closer to 2012 (and the less they like the player), the more likely.
      if (tension > 0 && opinion < 40 && Math.random() < tension * 0.6) {
        _thought(namedPool('distrust', pName));
        const px = $gamePlayer.x, py = $gamePlayer.y;
        const ex = this.event.x,  ey = this.event.y;
        const dx = ex - px, dy = ey - py;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const tx = Math.max(1, Math.min($gameMap.width()  - 2, Math.round(ex + (dx / len) * 3)));
        const ty = Math.max(1, Math.min($gameMap.height() - 2, Math.round(ey + (dy / len) * 3)));
        this.target = { x: tx, y: ty };
        this.state  = 'goingToZone';
        this.stateEndTime = time + 4000;
        this.path = this.pathfinder.findPath(ex, ey, tx, ty) || [];
        this.turnToward($gamePlayer);
        return;
      }

      // Normal greeting (people grow tight-lipped as the era frays).
      if (Math.random() < 0.25 * (1 - tension * 0.8)) {
        let greetTexts;
        if (!met) {
          greetTexts = pool('greet.stranger');
        } else if (opinion > 50) {
          greetTexts = pool('greet.warm', { name: pName });
        } else if (opinion > 0) {
          greetTexts = pool('greet.polite', { name: pName });
        } else {
          greetTexts = pool('greet.cold');
        }
        _thought(greetTexts);
        this.turnToward($gamePlayer);
      }
    }

    updateIdle(time) {
      if (time >= this.nextMoveTime) this.decideNextGoal();
      else {
        const counterDir = this._counterFacingDir();
        if (counterDir) this.event.setDirection(counterDir);
        else if (Math.random() < 0.06) this.event.setDirection(2 + Math.floor(Math.random() * 4) * 2);
      }
    }

    updateWandering(time) {
      if (time >= this.stateEndTime) return this.decideNextGoal();
      if (!this.event.isMoving() && time >= this.nextMoveTime) {
        const dir = this.getWanderDir();
        if (dir) this.event.moveStraight(dir);
        this.nextMoveTime = time + Utils.randBetween(1000, 3000);
      }
    }

    updateGoingToZone(time) {
      if (!this.target || time >= this.stateEndTime) return this.decideNextGoal();
      if (!this.path.length) return this.enterZone();
      if (!this.event.isMoving()) {
        this._stepAlongPath(() => this.calculatePath());
      }
    }

    updateInZone(time) {
      if ($gameMap.regionId(this.event.x, this.event.y) === Config.Zones.SOCIAL) this.updateSocializing(time);
      else if (time >= this.stateEndTime) this.decideNextGoal();
    }

    updateSocializing(time) {
      if (time >= this.stateEndTime) return this.decideNextGoal();
      // ~0.2% chance per frame to check for nearby NPCs and form relationships
      if (Math.random() < 0.002) this._formNearbyRelationships();
    }

    _formNearbyRelationships() {
      const profile = window.NPCSocietyRegistry?.getProfile(this.eventName);
      if (!profile) return;
      if (!profile.relationships) profile.relationships = {};
      const traitsById = _getTraitsById();

      for (const other of ($gameSystem.npcControllers ?? [])) {
        if (other === this || !other.eventName || !other.event) continue;
        if (!['socializing', 'inZone'].includes(other.state)) continue;
        if (Utils.distance(this.event, other.event) > 3) continue;

        const rel = profile.relationships[other.eventName] ?? { meetCount: 0, opinion: 0 };
        rel.meetCount = Math.min(rel.meetCount + 1, 999);

        // Trait incompatibility check, sours the relationship
        const otherProfile = window.NPCSocietyRegistry?.getProfile(other.eventName);
        if (otherProfile) {
          const incompatible = (profile.traitIds ?? []).some(tid => {
            const t = traitsById.get(tid);
            return (t?.incompatible ?? []).some(iid => (otherProfile.traitIds ?? []).includes(iid));
          });
          rel.opinion = incompatible
            ? Math.max(-60, rel.opinion - 1)
            : Math.min(60, rel.opinion + 1);
        }

        profile.relationships[other.eventName] = rel;
      }
    }

    decideNextGoal() {
      if (this.event) this.event.setOpacity(255);
      const zones   = this.getZones();
      const profile = window.NPCSocietyRegistry?.getProfile(this.eventName);

      // Priority: sleep need → go home if on home map
      if (profile?.currentNeed === 'sleep' && profile.homeMapId === $gameMap?.mapId()) {
        const door = $gameMap.events().find(e => {
          const n = e?.event()?.name ?? '';
          return n === 'Door' || n === 'House';
        });
        if (door) return this.goToTile(door.x, door.y, 'goingHome', 300000);
      }

      // Base weights
      let wanderW    = 30;
      let socializeW = zones.social.length ? 25 : 0;

      // Trait-driven weight modifiers
      if (profile?.traitIds?.length) {
        const traitsById = _getTraitsById();
        const TRAIT_MODS = {
          shy:         { s: -20, w:   0 },
          introverted: { s: -15, w:   0 },
          social:      { s: +30, w: -10 },
          extroverted: { s: +25, w:   0 },
          aggressive:  { s:   0, w: +20 },
          violent:     { s:   0, w: +15 },
          lazy:        { s: +10, w: -10 },
        };
        for (const id of profile.traitIds) {
          const t = traitsById.get(id);
          if (!t) continue;
          const name = (t.name || '').toLowerCase();
          for (const [key, mod] of Object.entries(TRAIT_MODS)) {
            if (name.includes(key)) {
              wanderW    += mod.w;
              socializeW += mod.s;
            }
          }
        }
      }

      // Morality influence: law-abiding NPCs stay local; chaotic ones roam more
      const m = profile?.moralityScore ?? 0;
      if (m > 50)  wanderW -= 8;
      if (m < -50) wanderW += 15;

      // Food need: strongly bias toward social zones (gathering areas)
      if (profile?.currentNeed === 'food') socializeW += 40;

      // Faction territory: 20% weight toward social zones for faction members
      if ((profile?.factionIndex ?? -1) >= 0 && zones.social.length) socializeW += 20;

      const goals = [];
      if (wanderW    > 0) goals.push({ t: 'wander',    w: wanderW    });
      if (socializeW > 0) goals.push({ t: 'socialize',  w: socializeW });
      if (!goals.length)  goals.push({ t: 'wander',     w: 1          });

      let rand = Math.random() * goals.reduce((s, g) => s + g.w, 0);
      for (const g of goals) {
        if ((rand -= g.w) <= 0) return this.setGoal(g.t, zones);
      }
      this.setGoal('wander', zones);
    }

    setGoal(type, zones) {
      const time = performance.now();
      if (type === "wander") {
        this.state = "wandering";
        this.stateEndTime = time + Utils.randBetween(7000, 14000);
      } else {
        this.target = Utils.randomElement(zones.social);
        this.state = "goingToZone";
        this.calculatePath();
      }
      if (this.event) this.event.setMoveSpeed(type === "wander" && Math.random() < 0.7 ? 3 : 4);
    }

    calculatePath() {
      if (this.event && this.target) this.path = this.pathfinder.findPath(this.event.x, this.event.y, this.target.x, this.target.y) || [];
      if (!this.path.length) this.decideNextGoal();
    }

    _stepAlongPath(onFail) {
      if (!this.path.length) { if (onFail) onFail(); return; }
      const dir = this.path[0];
      const nx = $gameMap.roundXWithDirection(this.event.x, dir);
      const ny = $gameMap.roundYWithDirection(this.event.y, dir);
      const doorEvt = $gameMap.eventsXy(nx, ny).find(e => Utils.isWalkThroughDoor(e?.event()?.name || ""));
      this.path.shift();
      if (doorEvt) {
        const wasThr = this.event._through;
        this.event._through = true;
        this.event.moveStraight(dir);
        this.event._through = wasThr;
        doorEvt.start();
        // Once an NPC opens a door it stays open: flag it through so RMMZ's
        // collision (eventsXyNt, which skips through events) no longer blocks
        // anything on that tile — in particular Enemy events won't collide
        // with it while chasing.
        doorEvt.setThrough(true);
      } else if (this.event.canPass(this.event.x, this.event.y, dir)) {
        this.event.moveStraight(dir);
      } else {
        if (onFail) onFail();
      }
    }

    enterZone() {
      this.state = $gameMap.regionId(this.event.x, this.event.y) === Config.Zones.SOCIAL ? "socializing" : "inZone";
      this.stateEndTime = performance.now() + Utils.randBetween(5000, 15000);
    }

    getZones() {
      return MapManager.getMapZones();
    }

    getWanderDir() {
      const mapW = $gameMap.width();
      const occupied = new Set();
      for (const c of $gameSystem.npcControllers ?? []) {
        if (c.event && !c.event._erased && c.event !== this.event)
          occupied.add(c.event.x + c.event.y * mapW);
      }
      const dirs = [2, 4, 6, 8], weights = [];
      for (const dir of dirs) {
        const nx = $gameMap.roundXWithDirection(this.event.x, dir), ny = $gameMap.roundYWithDirection(this.event.y, dir);
        // Never wander onto water (region 99 or terrain tag 3): NPCs would
        // appear to drown (#121).
        const isWater = $gameMap.regionId(nx, ny) === 99 || $gameMap.terrainTag(nx, ny) === 3;
        let w = (!isWater && this.event.canPass(this.event.x, this.event.y, dir)) ? 1 : 0;
        if (w > 0) {
          if ($gameMap.regionId(nx, ny) === Config.Zones.SOCIAL) w *= 1.5;
          if (occupied.has(nx + ny * mapW)) w *= 0.3;
        }
        weights.push(w);
      }
      const tw = weights.reduce((a, b) => a + b, 0);
      if (!tw) return null;
      let r = Math.random() * tw;
      return dirs[weights.findIndex(w => (r -= w) <= 0)];
    }

    turnToward(char) {
      if (!this.event || !char) return;
      const sx = this.event.deltaXFrom(char.x), sy = this.event.deltaYFrom(char.y);
      this.event.setDirection(Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 4 : 6) : (sy > 0 ? 8 : 2));
    }

    // ── Tactical (Map Battle) stepping ───────────────────────────────────────
    // While a map battle runs (MapBattleMode.js) the world stops flowing in real
    // time: the controller's own clock-driven update() is suspended and the NPC
    // only advances when a combatant spends a step (one tile per battler step,
    // one tile per action). grantTacticalSteps() banks those steps and
    // updateTacticalStep() spends them, one tile per completed move, so the town
    // keeps drifting toward whatever goal it already had, in lockstep with the
    // fight instead of alongside it.

    grantTacticalSteps(n) {
      this._tacticalSteps = Math.max(0, (this._tacticalSteps || 0) + (n || 0));
    }

    clearTacticalSteps() {
      this._tacticalSteps = 0;
    }

    updateTacticalStep() {
      if (!this._tacticalSteps || this._tacticalSteps <= 0) return;
      if (!this.event || this.event._erased) { this._tacticalSteps = 0; return; }
      // Wait for the tile currently being walked to finish before spending the
      // next banked step, so a burst of granted steps still plays out one tile
      // at a time.
      if (this.event.isMoving() || this.event.isMoveRouteForcing()) return;
      this._tacticalSteps--;
      if (this.path && this.path.length) {
        // Dropping the path on a blocked step (rather than repathing) keeps this
        // cheap: the next goal is picked normally once the battle releases the map.
        this._stepAlongPath(() => { this.path = []; });
      } else {
        const dir = this.getWanderDir();
        if (dir) this.event.moveStraight(dir);
      }
    }

    // Returns the direction to face if an adjacent tile has the counter flag, else null.
    // Used to lock shop workers toward the customer side of their counter.
    _counterFacingDir() {
      if (!this.event) return null;
      const x = this.event.x, y = this.event.y;
      if ($gameMap.isCounter(x, y + 1)) return 2;
      if ($gameMap.isCounter(x - 1, y)) return 4;
      if ($gameMap.isCounter(x + 1, y)) return 6;
      if ($gameMap.isCounter(x, y - 1)) return 8;
      return null;
    }

    // ── NPCSim states injected by NPCSimulationCore ───────────────────────────

    updateGoingHome(time) {
      if (!this.target) return this.decideNextGoal();
      if (!this.path.length) {
        const dx = this.event ? Math.abs(this.event.x - this.target.x) : 0;
        const dy = this.event ? Math.abs(this.event.y - this.target.y) : 0;
        if (dx + dy > 2) return this.decideNextGoal();
        // Arrived near door, enter sleep state
        this.state = "sleeping";
        this.stateEndTime = time + 4 * 60 * 60 * 1000; // 4h in ms
        if (this.event) this.event.setOpacity(120);
        return;
      }
      if (!this.event.isMoving()) {
        this._stepAlongPath(() => this.calculatePath());
      }
    }

    updateSleeping(time) {
      // Stay sleeping until NPCSim scheduler clears it
      if (time >= this.stateEndTime) {
        if (this.event) this.event.setOpacity(255);
        this.decideNextGoal();
      }
    }

    updateGoingToWork(time) {
      if (!this.target || time >= this.stateEndTime) return this.decideNextGoal();
      if (!this.path.length) {
        this.state = "working";
        this.stateEndTime = time + Utils.randBetween(90000, 180000);
        return;
      }
      if (!this.event.isMoving()) {
        this._stepAlongPath(() => this.calculatePath());
      }
    }

    updateWorking(time) {
      // Idle at work location; NPCSim awards pay on shift end
      if (time >= this.stateEndTime) {
        window.NPCSim?.emit("npc:shift_end", { name: this.eventName });
        this.decideNextGoal();
      } else {
        const counterDir = this._counterFacingDir();
        if (counterDir) this.event?.setDirection(counterDir);
        else if (Math.random() < 0.01) this.event?.setDirection(2 + Math.floor(Math.random() * 4) * 2);
      }
    }

    updateGoingToInteract(time) {
      if (!this.target || this.target._erased || time >= this.stateEndTime) return this.decideNextGoal();
      const dist = Utils.distance(this.event, this.target);
      // Interact from up to 2 tiles away: most shop/vendor events sit behind an
      // impassable counter tile, so the NPC can never stand directly on them.
      if (dist <= 2) {
        this.state = "interacting";
        this.stateEndTime = time + Utils.randBetween(8000, 20000);
        this.turnToward(this.target);
        window.NPCSim?.emit("npc:interact", { name: this.eventName, targetEvent: this.target });
        return;
      }
      if (!this.path.length) {
        this._repathToApproach();
        if (!this.path.length) return this.decideNextGoal();
        return;
      }
      if (!this.event.isMoving()) {
        this._stepAlongPath(() => {
          this._repathToApproach();
          if (!this.path.length) this.decideNextGoal();
        });
      }
    }

    // (Re)builds a path to a passable tile within 2 of the interact target,
    // the target tile itself is usually blocked (a counter event), so we aim
    // for the nearest reachable approach tile instead of the event's own tile.
    _repathToApproach() {
      if (!this.event || !this.target) { this.path = []; return; }
      const dest = this.approachTile || this._approachTile(this.target.x, this.target.y, 2);
      this.approachTile = dest;
      this.path = this.pathfinder.findPath(this.event.x, this.event.y, dest.x, dest.y) || [];
    }

    updateInteracting(time) {
      if (this._lastNeedTick === undefined) this._lastNeedTick = time;
      const deltaSec = (time - this._lastNeedTick) / 1000;
      if (deltaSec >= 1) {
        window.NPCSim?.satisfyNeedTick(this.eventName, this.interactReason, deltaSec);
        this._lastNeedTick = time;
      }
      if (time >= this.stateEndTime) {
        this._lastNeedTick = undefined;
        this.target = null;
        this.decideNextGoal();
      }
    }

    // Utility: set a world-object interaction target and pathfind toward a
    // reachable tile within 2 of it (the event's own tile is usually blocked).
    goInteract(targetEvent, reason) {
      this.target = targetEvent;
      this.interactReason = reason;
      this.state = "goingToInteract";
      this.stateEndTime = performance.now() + 60000;
      this.approachTile = null;
      if (this.event && this.target) this._repathToApproach();
    }

    // Utility: go to a map tile (used for going home/work by NPCSim)
    goToTile(x, y, newState, duration) {
      this.target = { x, y };
      this.state = newState || "goingHome";
      this.stateEndTime = performance.now() + (duration || 300000);
      if (this.event) {
        this.path = this.pathfinder.findPath(this.event.x, this.event.y, x, y) || [];
      }
    }

    // Finds a passable tile orthogonally adjacent to (x, y), preferred over
    // the target tile itself since most interactable events aren't passable.
    // Falls back to (x, y) when nothing nearby is walkable (e.g. open plazas).
    _adjacentFreeTile(x, y) {
      const offsets = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of offsets) {
        const tx = x + dx, ty = y + dy;
        if ($gameMap.isValid(tx, ty) &&
            [2, 4, 6, 8].some(dir => $gameMap.isPassable(tx, ty, dir)) &&
            $gameMap.eventsXy(tx, ty).length === 0) {
          return { x: tx, y: ty };
        }
      }
      return { x, y };
    }

    // Nearest passable tile within `maxDist` (Manhattan) of (tx, ty), measured
    // from the NPC's current position, the spot they should walk to in order
    // to interact with an event that sits on a blocked tile (e.g. behind a
    // shop counter). Falls back to the target tile when nothing nearby works.
    _approachTile(tx, ty, maxDist = 2) {
      const ex = this.event ? this.event.x : tx;
      const ey = this.event ? this.event.y : ty;
      let best = null, bestD = Infinity;
      for (let dy = -maxDist; dy <= maxDist; dy++) {
        for (let dx = -maxDist; dx <= maxDist; dx++) {
          const md = Math.abs(dx) + Math.abs(dy);
          if (md === 0 || md > maxDist) continue;
          const x = tx + dx, y = ty + dy;
          if (!$gameMap.isValid(x, y)) continue;
          if ([10, 103, 99, 11].includes($gameMap.regionId(x, y))) continue;
          if ($gameMap.terrainTag(x, y) === 3) continue;
          if (![2, 4, 6, 8].some(dir => $gameMap.isPassable(x, y, dir))) continue;
          const d = Math.abs(x - ex) + Math.abs(y - ey);
          if (d < bestD) { bestD = d; best = { x, y }; }
        }
      }
      return best || { x: tx, y: ty };
    }

    // Instantly drops the NPC beside targetEvent already mid-interaction,
    // used by ActivityPlacer to make a freshly-loaded map feel lived-in
    // (no travel time), mirroring the end-state of updateGoingToInteract.
    goInteractNow(targetEvent, reason) {
      if (!this.event || !targetEvent) return;
      const spot = this._adjacentFreeTile(targetEvent.x, targetEvent.y);
      this.event.locate(spot.x, spot.y);
      this.target = targetEvent;
      this.interactReason = reason;
      this.path = [];
      this.state = "interacting";
      this.stateEndTime = performance.now() + Utils.randBetween(8000, 20000);
      this.turnToward(targetEvent);
      window.NPCSim?.emit("npc:interact", { name: this.eventName, targetEvent });
    }

  }

  // ==========================================================================
  // ENGINE HOOKS & OVERRIDES
  // ==========================================================================

  // Safe findProperPageIndex override
  const _Game_Event_findProperPageIndex = Game_Event.prototype.findProperPageIndex;
  Game_Event.prototype.findProperPageIndex = function () {
    try { return _Game_Event_findProperPageIndex.call(this); }
    catch (e) { return -1; }
  };

  // Action-button interaction with NPCs that are mid-step.
  // A roster NPC paths continuously (no pause between steps), so a walking NPC's
  // logical tile (_x/_y, advanced immediately by moveStraight or by RMMZ's own
  // random movement) sits one step ahead of where the sprite is drawn
  // (_realX/_realY). The engine's action-button check looks at the tile the
  // player faces and finds the NPC's just-vacated tile empty, so nothing starts
  // even though the player is plainly facing the NPC. Movement runs off the
  // controller (AI NPCs) or the event's own move route (Local NPCs), not the
  // event page, so it keeps working: the NPC visibly walks but can't be talked
  // to. As a fallback, when the normal check started nothing, match a moving
  // roster NPC against either tile it occupies: its logical/destination tile
  // (_x/_y) or the source tile it is vacating. The source tile is derived from
  // the reverse of the move direction so it stays matchable for the entire step
  // (rounding _realX only lands on the source tile during the first half).
  //
  // Rather than pin down every way an NPC's tile can desync from where its
  // sprite is drawn, this is a deliberate catch-all: when the engine's own
  // action-button check started nothing, look at EVERY tile a talkable event
  // visually or logically occupies this frame and start it if the player is
  // facing any of them. Candidate tiles per event:
  //   - its logical tile (_x/_y, advanced immediately by a step),
  //   - its drawn/sprite tile (round of _realX/_realY, the mid-interpolation
  //     position, which is what the player actually sees and aims at), and
  //   - the tile it is vacating (reverse of its move direction) while moving.
  // Covers controller-driven AND Local (route-driven) roster NPCs, NPCs whose
  // _npcRosterSpawn flag was lost, pre-placed map NPCs, and the "just stopped
  // but _realX has not caught up" case, none of which the narrower earlier
  // scans reliably caught. Roster NPCs are tried first, then any other facing
  // talkable event. Blank/commandless pages are skipped (nothing to run), so a
  // hidden (self-switch A) NPC is never force-woken.
  const _NPCSystem_checkEventTriggerThere = Game_Player.prototype.checkEventTriggerThere;
  Game_Player.prototype.checkEventTriggerThere = function (triggers) {
    _NPCSystem_checkEventTriggerThere.call(this, triggers);
    if ($gameMap.isAnyEventStarting() || $gameMap.isEventRunning()) return;
    const dir = this.direction();
    const fx = $gameMap.roundXWithDirection(this.x, dir);
    const fy = $gameMap.roundYWithDirection(this.y, dir);
    // Runnable = has an action/touch-triggerable page with real commands. We do
    // NOT require isNormalPriority(): a transplanted/pre-placed NPC page left at
    // "below/above characters" priority is invisible to the engine's own facing
    // check (which only fires for same-as-characters priority), which is one way
    // a plainly-facing player gets no response. Autorun/parallel pages (trigger
    // 3/4) are excluded via isTriggerIn(triggers) so we never force-run those.
    const runnable = (ev) => {
      if (!ev || ev._erased || !ev.isTriggerIn(triggers)) return false;
      const page = ev.page();
      return !!(page && page.list && page.list.length > 1);
    };
    const occupies = (ev, x, y) => {
      if (ev._x === x && ev._y === y) return true;
      if (Math.round(ev._realX) === x && Math.round(ev._realY) === y) return true;
      if (ev.isMoving()) {
        const rev = ev.reverseDir(ev.direction());
        if ($gameMap.roundXWithDirection(ev._x, rev) === x &&
            $gameMap.roundYWithDirection(ev._y, rev) === y) return true;
      }
      return false;
    };
    const events = $gameMap.events();
    // 1) Anything the player is facing (roster NPCs first, then any event).
    for (const ev of events) { if (ev && ev._npcRosterSpawn && runnable(ev) && occupies(ev, fx, fy)) { ev.start(); return; } }
    for (const ev of events) { if (ev && !ev._npcRosterSpawn && runnable(ev) && occupies(ev, fx, fy)) { ev.start(); return; } }
    // 2) Last-resort generosity: a roster NPC standing directly next to the
    //    player (its sprite may straddle tiles so the faced tile never matched
    //    exactly). Prefer one in the facing direction. Only roster NPCs, so we
    //    never hijack an unrelated adjacent event.
    let best = null, bestScore = -1;
    for (const ev of events) {
      if (!ev || !ev._npcRosterSpawn || !runnable(ev)) continue;
      const ex = Math.round(ev._realX), ey = Math.round(ev._realY);
      const man = Math.abs(ex - this.x) + Math.abs(ey - this.y);
      if (man !== 1) continue;
      const score = (ex === fx && ey === fy) ? 2 : 1; // in facing dir scores higher
      if (score > bestScore) { bestScore = score; best = ev; }
    }
    if (best) best.start();
  };

  // Console diagnostic: face a stubborn NPC, then run window.npcWhyNoTalk() from
  // the dev console (F12). Prints why nothing triggers, event state and all.
  window.npcWhyNoTalk = function () {
    if (!$gameMap || !$gamePlayer) { console.log("[npcWhyNoTalk] no map/player"); return; }
    const p = $gamePlayer, dir = p.direction();
    const fx = $gameMap.roundXWithDirection(p.x, dir), fy = $gameMap.roundYWithDirection(p.y, dir);
    console.log(`[npcWhyNoTalk] player (${p.x},${p.y}) dir ${dir} facing (${fx},${fy})`);
    console.log(`  isEventRunning=${$gameMap.isEventRunning()} isAnyEventStarting=${$gameMap.isAnyEventStarting()} interp.eventId=${$gameMap._interpreter?.eventId?.()}`);
    const near = $gameMap.events().filter(e => e && !e._erased &&
      Math.abs(Math.round(e._realX) - p.x) <= 1 && Math.abs(Math.round(e._realY) - p.y) <= 1);
    if (!near.length) { console.log("  no events within 1 tile"); return; }
    for (const e of near) {
      const pg = e.page();
      console.log(`  ev#${e.eventId()} "${e.event()?.name}" logical(${e._x},${e._y}) sprite(${Math.round(e._realX)},${Math.round(e._realY)}) moving=${e.isMoving()} roster=${!!e._npcRosterSpawn}`);
      console.log(`     _trigger=${e._trigger} priorityType=${e._priorityType} through=${e._through} pageIndex=${e._pageIndex} listLen=${pg?.list?.length ?? "no-page"} isTriggerIn[0,1,2]=${e.isTriggerIn([0,1,2])} isNormalPriority=${e.isNormalPriority()}`);
    }
  };

  // Auto-diagnose: when the player presses OK, nothing triggers, and a runnable
  // event is right next to them, print the diagnostic automatically (throttled).
  // So you just open the console (F12) and try talking to the stubborn NPC, no
  // command to type. Set window.NPC_DEBUG_INTERACT = false to silence it.
  window.NPC_DEBUG_INTERACT = true;
  const _NPCSys_triggerButtonAction = Game_Player.prototype.triggerButtonAction;
  Game_Player.prototype.triggerButtonAction = function () {
    const acted = _NPCSys_triggerButtonAction.call(this);
    if (window.NPC_DEBUG_INTERACT && !acted && Input.isTriggered("ok") &&
        !$gameMap.isEventRunning() && !$gameMap.isAnyEventStarting()) {
      const near = $gameMap.events().some(e => e && !e._erased &&
        Math.abs(Math.round(e._realX) - this.x) <= 1 && Math.abs(Math.round(e._realY) - this.y) <= 1 &&
        (e.page()?.list?.length ?? 0) > 1);
      const last = window.npcWhyNoTalk._last ?? -999;
      if (near && Graphics.frameCount - last > 20) {
        window.npcWhyNoTalk._last = Graphics.frameCount;
        console.log("[NPCSystem] OK pressed but nothing triggered:");
        window.npcWhyNoTalk();
      }
    }
    return acted;
  };

  const _Game_System_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function () {
    _Game_System_initialize.call(this);
    this.npcControllers = [];
    this._npcSystemCurrentMapGroup = null;
  };

  // Expose live controllers to NPCSimulationCore and other plugins.
  // Called several times per tick, so the filtered copy is cached per frame.
  // Module-scope (not on Game_System) so it never leaks into save data; the
  // src/len checks invalidate it when controllers are added, removed, or the
  // array is swapped out mid-frame.
  let _activeCtrlCache = null;
  Game_System.prototype.getActiveNPCControllers = function () {
    const list = this.npcControllers || [];
    const fc = Graphics.frameCount;
    if (_activeCtrlCache && _activeCtrlCache.frame === fc &&
        _activeCtrlCache.src === list && _activeCtrlCache.len === list.length) {
      return _activeCtrlCache.result;
    }
    const result = list.filter(c => c && c.event && !c.event._erased);
    _activeCtrlCache = { frame: fc, src: list, len: list.length, result };
    return result;
  };

  const _Game_System_onAfterLoad = Game_System.prototype.onAfterLoad;
  Game_System.prototype.onAfterLoad = function () {
    _Game_System_onAfterLoad?.call(this);
    this.restoreNPCControllers();
  };

  Game_System.prototype.restoreNPCControllers = function () {
    if (!$dataMap || !$gameMap?.events) {
      this._restoreRetries = (this._restoreRetries || 0) + 1;
      if (this._restoreRetries > 20) { this._restoreRetries = 0; return; }
      return setTimeout(() => this.restoreNPCControllers(), 100);
    }
    this._restoreRetries = 0;
    this.npcControllers?.forEach((data, i) => {
      if (data && typeof data.update !== "function") {
        const c = new NPCController(data.eventName);
        Object.assign(c, data);
        c.refreshEvent();
        this.npcControllers[i] = c;
      }
    });
  };

  const _Game_Map_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    this._npcControllersInitialized = false;
    _Game_Map_setup.call(this, mapId);
  };

  // Dev/test hook: when the player names their character "Test", the WorldGen
  // manifests (MapGroups.json + NPCPools.json) are wiped and rebuilt so they
  // pick up the latest map edits. Rebuilding loads & parses every map (multi-
  // second freeze, see the WorldgenStore/NPCPoolStore performance notes), so
  // it's gated to a single run per session via _testRegenDone, on subsequent
  // map loads within the same session the freshly-saved manifests are reused.
  let _testRegenDone = false;
  function maybeRegenerateForTest() {
    if (_testRegenDone) return;
    let isTest = false;
    try {
      const leader = $gameParty?.leader?.();
      isTest = (leader?.name?.() === "Test") || ($gameActors?.actor?.(1)?.name?.() === "Test"); // i18n-ignore: playtest character name
    } catch (e) { }
    if (!isTest) return;
    _testRegenDone = true;

    // Drop the on-disk manifests...
    WorldgenStore.deleteFile();
    NPCPoolStore.deleteFile();
    // ...and every in-memory / save-data cache that would otherwise short-
    // circuit the rebuild, so the next GroupRegistry / getNPCPool call rescans
    // the maps and re-saves fresh manifests reflecting the current map data.
    if (window.WorldGen) { delete window.WorldGen.MapGroups; delete window.WorldGen.NPCPools; }
    GroupRegistry._cache = null;
    GroupRegistry._mapIndex = null;
    GroupRegistry._buildCallbacks = null;
    NPCPoolStore._cache = undefined;
    SpawnManager._shopIndexSession = {};
    if ($gameSystem) {
      $gameSystem._npcMapGroups = null;
      $gameSystem._npcPoolCache = {};
    }
    console.log("[NPC System] Player 'Test' detected, regenerating MapGroups.json + NPCPools.json from current maps.");
  }

  // Staffs the <Shop> counters of the map being entered: every rota except the
  // ones that need a settled group roster (those are assigned right before
  // spawnAssignedNPCs, see setupNPCControllers), plus the graphic of every
  // counter whose rota is already known, the world-wide ones included.
  //
  // A <Shop> event carries no graphic of its own, so whoever writes the persona
  // onto it decides when the counter stops being an empty tile. Doing it from
  // setupNPCControllers alone is too late: that runs after createDisplayObjects
  // has already built (and updated) the spriteset, and a transfer clears the
  // image cache, so the shopkeeper only appeared once the sprite noticed the
  // change and the character sheet came off disk. Idempotent, a counter that
  // already holds a rota is skipped, so the later pass costs nothing.
  function stageShopPersonas() {
    const SSM = window.NPCSim?.ShopShiftManager;
    if (!SSM || !$dataMap || !$gameMap) return;
    const mapId = $gameMap.mapId();
    const groupName = MapManager.findMapGroupByMap(mapId);

    // Every counter already has its trio (the usual case, and every rebuild of
    // Scene_Map that isn't a map change), so there is no pool to walk.
    if (!SSM.needsStaffing?.(mapId)) return SSM.applyKnownSprites?.(mapId);

    if (MapManager.isHouseMap(mapId)) {
      // House/shop interiors reached through a door have no on-map roster; their
      // counters are staffed from the town they were entered from, seeded on the
      // building's own coordinates. See ShopShiftManager.assignInteriorPersonas.
      const houseGrpName = MapManager.getCurrentMapGroup()
        || window.ProceduralHouseSystem?._playtestFallbackGroupName;
      const building = window.ProceduralHouseSystem?.getCurrentBuilding?.() || null;
      const shopSeed = (building?.seed ?? Utils.nameHash(`interiorShop_${mapId}`)) >>> 0;
      SSM.assignInteriorPersonas?.(mapId, houseGrpName || null, shopSeed);
    } else if (!groupName || Config.isGlobalGroup(groupName)) {
      // Global group, ungrouped, procedural and <Abandoned> maps draw from pools
      // that are ready right now, so their rota can be decided immediately.
      SSM.assignPersonas?.(mapId, groupName);
    }

    // Regular group maps keep their assignment deferred (local candidates are
    // only known once the roster settles), but the world rota decided when the
    // world was made already names most of their counters, so draw those now.
    SSM.applyKnownSprites?.(mapId);
  }

  // The transfer has been performed (map data and events are current) but the
  // spriteset does not exist yet, so a counter staffed here is drawn with its
  // shopkeeper from the very first frame the map is shown.
  const _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
  Scene_Map.prototype.createDisplayObjects = function () {
    try {
      stageShopPersonas();
    } catch (e) {
      console.error("[NPC System] shop persona staging failed", e);
    }
    _Scene_Map_createDisplayObjects.call(this);
  };

  // Writes every spawned NPC's identity back into the freshly loaded $dataMap.
  // Called with the map data current and the Game_Event objects still the ones
  // that were on screen a moment ago (a transfer is excluded: there the events
  // are about to be rebuilt from scratch and the spawn re-runs anyway).
  //
  // The sprite is re-read from the live event rather than from the snapshot:
  // several systems restyle a citizen after they are spawned (a rolled
  // procedural face, a shop-shift stand-in, the society sprite pass) and those
  // writes go into the same volatile page data. Only substantive pages are
  // stamped, the trailing blank "hidden on recruit" page has to stay
  // graphic-less or a recruited NPC comes back as an untalkable ghost.
  function restoreSpawnedEventData() {
    if (!$dataMap?.events || !$gameMap) return;
    const mapId = $gameMap.mapId();
    for (const ev of $gameMap.events()) {
      const snap = ev?._npcSpawnData;
      if (!snap || snap.mapId !== mapId) continue;
      const data = $dataMap.events[ev.eventId()];
      if (!data) continue;
      data.name = snap.name;
      data.note = snap.note;
      data.characterName = snap.characterName;
      data.characterIndex = snap.characterIndex;
      data.pages = JSON.parse(JSON.stringify(snap.pages));
      const liveSprite = ev.characterName();
      if (liveSprite) {
        data.characterName = liveSprite;
        data.characterIndex = ev.characterIndex();
        for (const page of data.pages) {
          if (!page?.image || (page.list?.length ?? 0) <= 1) continue;
          page.image.characterName = liveSprite;
          page.image.characterIndex = ev.characterIndex();
        }
      }
    }
  }

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    // Scene_Map.create reloads the map file on every rebuild of the scene, so at
    // this point the transplanted NPC identities have just been wiped. Restore
    // them before anything (page refresh, spriteset, interpreter) reads them.
    if (!$gamePlayer?.isTransferring()) {
      try {
        restoreSpawnedEventData();
      } catch (e) {
        console.error("[NPC System] spawn data restore failed", e);
      }
    }
    _Scene_Map_onMapLoaded.call(this);
    if (!this._isLoadingFromPauseMenu) {
      maybeRegenerateForTest();
      // GroupRegistry.ensureBuiltAsync resolves synchronously when the cache is
      // already warm (normal case: save data or manifest on disk). Only on the
      // very first ever run, when no manifest exists, does it go async, loading
      // all map files concurrently via fetch() instead of blocking the thread
      // with serial sync-XHR. The mapId guard handles the unlikely case where
      // the player transitions away before the slow build finishes.
      const mapId = $gameMap?.mapId();
      GroupRegistry.ensureBuiltAsync(() => {
        if ($gameMap?.mapId() !== mapId) return;
        $gameMap.setupNPCControllers();
        window.NPCSim?.placeNPCsInActivities?.();
      });
    }
  };

  const _Scene_Map_stop = Scene_Map.prototype.stop;
  Scene_Map.prototype.stop = function () {
    _Scene_Map_stop.call(this);
  };

  Game_Map.prototype.setupNPCControllers = function () {
    // Prevent re-initialization during pause menu cycles or redundant setups
    if (this._npcControllersInitialized) return;

    // Snapshot the map we're leaving, its NPCs' positions/activities are
    // still readable off the about-to-be-discarded controllers, so coming
    // back to it within the same group restores them where they were.
    // _currentNpcGroup still holds the group of the map we're leaving here,
    // it only gets reassigned to the new map's group further down.
    SpawnManager.captureNPCGroupMemory($gameSystem._npcLastMapId, $gameSystem._currentNpcGroup);
    $gameSystem._npcLastMapId = $gameMap.mapId();

    this._npcControllersInitialized = true;
    $gameSystem.npcControllers = [];
    // Note: deliberately NOT gated on $dataMap.note, group membership,
    // AI-tagged events, and Local NPCs all still need to work on maps that
    // carry no map-level note at all (their tags live on individual events).
    if (!$dataMap || !$gameMap) return;

    const currentMapId = $gameMap.mapId();

    // Vehicle interiors get no crowd at all (Config.NPC_FREE_MAP_IDS): no
    // roster, no seated riders, no <AI> repositioning. Bailing out here also
    // leaves their placeholder slots alone, which is what the multiplayer
    // avatars on those maps need.
    if (Config.isNPCFreeMap(currentMapId)) return;

    $gameSystem._npcMapSizes = $gameSystem._npcMapSizes || {};
    $gameSystem._npcMapSizes[currentMapId] = $dataMap.width * $dataMap.height;

    // Clear all tile caches on new map setup to prevent stale lookups
    $gameMap._npcZoneCache = null;
    $gameMap._passableTerrainCache = null;
    delete $gameMap[`_npcSpawnZoneCache_${currentMapId}`];

    // Group membership is now derived purely from each map's <MapGroup: Name>
    // note tag (see GroupRegistry), a map tagged <MapGroup: OmegaTower> is
    // discovered as part of "OmegaTower" exactly like any other group, so
    // there's no longer a separate "note tag vs. hardcoded pool" distinction
    // to track here.
    const groupName = MapManager.findMapGroupByMap(currentMapId);
    const isGlobalGroupMap = Config.isGlobalGroup(groupName);
    // <Abandoned> (formerly <NPC>) marks a map as having no settled residents
    // of its own, it always draws fully randomized, transient visitors
    // (exactly like the global group) instead of a persistent assigned
    // roster. Takes precedence over its <MapGroup>, if any: when both tags
    // are present the visitors are still drawn from that group's own pool
    // rather than the global one, only the spawn *style* (random, no
    // persistence) is forced to match the global group's.
    const hasAbandonedTag = ($dataMap.note || "").includes("<Abandoned>");

    // <Shop> events get a day/night persona pair (and, where applicable, a
    // reservation that keeps their "covering" group NPC from double-spawning,
    // see ShopShiftManager.assignPersonas in NPCSimulationCore.js). Regular
    // (non-global) group maps defer this until their roster has settled,
    // right before spawnAssignedNPCs, so local-resident candidates are
    // available; every other map type (house, global group, ungrouped,
    // procedural, <Abandoned>-tagged) is already staffed by stageShopPersonas,
    // which ran before the spriteset was built. Repeating it here is a no-op
    // for those, and covers the one case it could not handle: pools that were
    // still being built asynchronously on the very first run of a world.
    stageShopPersonas();

    if (currentMapId === 636) return ProceduralManager.setupProceduralMapNPCs();

    if (MapManager.isHouseMap(currentMapId)) {
      const houseGrpName = MapManager.getCurrentMapGroup()
        || window.ProceduralHouseSystem?._playtestFallbackGroupName;
      const PHS = window.ProceduralHouseSystem;
      const building = PHS?.getCurrentBuilding?.() || null;

      // Any <Shop> counter in this interior (shop/inn template) was staffed by
      // stageShopPersonas above, with a seeded three-shift rota drawn from the
      // townspeople the player just came from.

      if (houseGrpName) {
        // Skyscrapers (and their upper floors) are public: nobody lives there,
        // the town passes through. Every other interior is a home, so make sure
        // it has residents before spawning, this is what gives houses entered
        // from a procedural town (whose doors are terrain tiles, never scanned
        // into the residential cache) the townspeople who live behind them.
        const isPublic = PHS?.isPublicInteriorMap?.(currentMapId)
          || PHS?.isBuildingPublic?.(building)
          || false;
        if (!isPublic) window.NPCSim?.ensureBuildingResidents?.(building, houseGrpName);
        SpawnManager.replacePlayerEventsWithNPCs(houseGrpName, { building, isPublic });
      }
      return;
    }

    // _currentNpcGroup deliberately stays sticky across non-group maps,
    // _npcGroupAssignments persists in $gameSystem regardless, and a brief
    // detour through a transfer/corridor map shouldn't force a full reshuffle
    // of the group we're about to walk straight back into.

    // NPCs only ever spawn on maps that are part of a <MapGroup> or carry the
    // <Abandoned> tag, every other map is left untouched (no random global
    // visitors, no pool roster).
    if (groupName || hasAbandonedTag) {
      const group = groupName ? GroupRegistry.get(groupName) : null;
      if (groupName) MapManager.setCurrentMapGroup(groupName);

      // The global group, and any <Abandoned> map, regardless of which group
      // it belongs to (or none), uses full randomization every entry, with
      // no persisted roster. <Abandoned> maps draw from their own <MapGroup>'s
      // pool when they have one, otherwise from the global pool. Seated global
      // groups (e.g. PublicTransport) get their own seat-aware placement pass
      // instead of OmegaTower's spread-across-every-tile style, unless the map
      // itself is tagged <Wander>, an opt-out (e.g. a platform/concourse map
      // that's still part of the PublicTransport group but has no seats of its
      // own) that falls back to the normal every-NPC-wanders behavior.
      const hasWanderTag = ($dataMap.note || "").includes("<Wander>");
      if (currentMapId === Config.OMEGA_CITY_MAP_ID) {
        // Omega City is the exception to every rule above: a fixed fifty-strong
        // population, half world pool + half home-grown, all of them housed in
        // the city's own buildings. See SpawnManager.randomizeOmegaCityMap.
        SpawnManager.randomizeOmegaCityMap(currentMapId, groupName || Config.GLOBAL_GROUP_NAME);
        $gameMap._npcSystemGroupHandled = true;
      } else if (groupName && Config.SEATED_GLOBAL_GROUPS.includes(groupName) && !hasWanderTag) {
        SpawnManager.randomizePublicTransportMap(currentMapId, groupName);
        $gameMap._npcSystemGroupHandled = true;
      } else if (isGlobalGroupMap || hasAbandonedTag) {
        SpawnManager.randomizeOmegaTowerMap(currentMapId, groupName || Config.GLOBAL_GROUP_NAME);
        $gameMap._npcSystemGroupHandled = true;
      } else {
        // Recompute the schedule-driven roster when: switching to a different
        // group, entering a group for the first time, "time was skipped"
        // (sleep/fast-travel, see the jump detector in Game_Map.update), or a
        // new in-game hour has begun since the roster was last computed. In
        // every other case (e.g. walking between the group's maps within the
        // same hour) the existing assignment is kept verbatim, so map changes
        // are perfectly consistent, no random drift.
        const curHour = $gameVariables?.value(23) ?? 12;
        const wasInSameGroup = $gameSystem._currentNpcGroup === groupName && !!$gameSystem._npcGroupAssignments;
        const timeSkipped = !!$gameSystem._npcTimeSkipped;
        const hourChanged = $gameSystem._npcAssignmentHour !== curHour;
        if (!wasInSameGroup || timeSkipped || hourChanged) {
          $gameSystem._npcTimeSkipped = false;
          SpawnManager.initializeGroupNPCs(groupName, currentMapId);
        }
        // else: keep _npcGroupAssignments unchanged for a consistent roster.

        // <Shop> events get a day/night persona pair before the roster spawns,
        // so any group NPC drawn to "cover the counter" can be reserved out of
        // also spawning as a separate wanderer here, see ShopShiftManager
        // (NPCSimulationCore.js) and the reservation filter in spawnAssignedNPCs.
        // Must run after the roster (_npcGroupAssignments[currentMapId]) is
        // settled above, so local-resident candidates are available.
        window.NPCSim?.ShopShiftManager?.assignPersonas?.(currentMapId, groupName);

        SpawnManager.spawnAssignedNPCs(currentMapId, group, groupName);
        $gameMap._npcSystemGroupHandled = true;

        // Warm size cache for other maps in the group
        for (const mId of group.maps) {
          if ($gameSystem._npcMapSizes[mId] === undefined) {
            MapManager.loadMapSizeAsync(mId);
          }
        }
      }
    }

    // <AI>-tagged events get an NPCController whenever they're present,
    // pre-placed AI events are deliberate map-design choices, so they're
    // wired up regardless of <MapGroup>/<Abandoned> status.
    const npcEvents = $gameMap.events().filter(e => Utils.hasAITag(e?.event()?.note));

    // If a group/global-group pass already handled NPCs on this map, skip
    // this section's repositioning and culling to avoid overwriting it.
    if (npcEvents.length && !$gameMap._npcSystemGroupHandled) {
      const tiles = MapManager.getSpreadSpawnTiles();

      npcEvents.forEach((npc, i) => {
        // Never relocate or claim the active Player 2 avatar, even if it was
        // authored from an NPC template and still carries an <AI> note.
        if (window.$gameSplitScreen?.active && window.$gameSplitScreen.p2Event === npc) return;
        const isLocal = npc.event()?.note?.toLowerCase().includes("local");
        if (!isLocal && i < tiles.length) {
          npc.locate(tiles[i].x, tiles[i].y);
          console.log(`[NPC System] NPC spawned via <AI> tag: "${npc.event().name}" at (${tiles[i].x}, ${tiles[i].y}) on map ${currentMapId}`);
        }
        npc.setMoveSpeed(3);
        npc.setMoveFrequency(isLocal ? 5 : 3);
        npc.setThrough(false);
        npc.setPriorityType(1);
        npc.setOpacity(255); // ensure AI-loop NPCs are not left semi-transparent from a prior sleeping state (#48)
        if (!$gameSystem.npcControllers.some(c => c.eventName === npc.event().name)) {
          const controller = new NPCController(npc.event().name);
          $gameSystem.npcControllers.push(controller);
          controller.decideNextGoal();
        }
      });

    }

    // Setup LOCAL NPCs on the map (always spawn here regardless of group rosters,
    // their template can still travel to other maps' rosters, see buildNPCPool)
    const localEvents = $gameMap.events().filter(e => e?.event()?.note?.toLowerCase().includes("local"));
    const passableTiles = [...MapManager.findPassableTerrainTiles()];
    localEvents.forEach(npc => {
      // Never relocate or claim the active Player 2 avatar.
      if (window.$gameSplitScreen?.active && window.$gameSplitScreen.p2Event === npc) return;
      npc.setMoveSpeed(3);
      npc.setMoveFrequency(5);
      npc.setThrough(false);
      npc.setPriorityType(1);
      npc.setOpacity(255);

      if (passableTiles.length > 0) {
        const randIndex = Math.floor(Math.random() * passableTiles.length);
        const tile = passableTiles.splice(randIndex, 1)[0];
        npc.locate(tile.x, tile.y);
      }

      if (!$gameSystem.npcControllers.some(c => c.eventName === npc.event().name)) {
        const controller = new NPCController(npc.event().name);
        controller.isLocal = true;
        console.log(`[NPC System] Local NPC spawned: "${npc.event().name}" at (${npc.x}, ${npc.y}) on map ${currentMapId}`);
        
        $gameSystem.npcControllers.push(controller);
        controller.decideNextGoal();
      }
    });
  };

  // Pending hour-boundary refresh stages, processed one per frame (see below)
  let _hourlyRefreshQueue = null;

  const _Game_Map_update = Game_Map.prototype.update;
  Game_Map.prototype.update = function (sceneActive) {
    _Game_Map_update.call(this, sceneActive);
    if (!sceneActive) return;
    // Map Battle Mode (MapBattleMode.js) freezes the world: NPCs stop running
    // their real-time routines and instead spend the steps the fight grants them
    // (see NPCController.updateTacticalStep). Every other simulation tick below
    // keeps running, only the movement clock is suspended.
    if (window.MapBattleMode && window.MapBattleMode.isActive()) {
      $gameSystem.npcControllers?.forEach(c => c.updateTacticalStep?.());
    } else {
      $gameSystem.npcControllers?.forEach(c => c.update());
    }
    // Needs tick: every 10 game minutes, decay hunger/sleep for all loaded NPCs.
    // FALLBACK ONLY. When NPCSimulationCore (window.NPCSim) is loaded it owns the
    // full needs model: it drains all five needs (hunger/sleep/hygiene/social/
    // leisure) and sets a rich currentNeed via ScheduleManager every tick for
    // on-map NPCs. The legacy tickNeeds below only knows hunger/sleep and
    // hard-resets currentNeed to food/sleep/null, so running it alongside the
    // sim double-drained hunger/sleep AND wiped the richer need (work/social/
    // leisure/...) every 10 minutes, making the need badge blink empty. Skip it
    // entirely when the sim core is present; keep it as a degraded fallback if
    // that plugin is ever disabled.
    if ($gameVariables) {
      const gameMin = $gameVariables.value(114);
      const lastTick = $gameSystem._npcLastNeedsTick ?? 0;
      if (!window.NPCSim && gameMin - lastTick >= 10) {
        const elapsed = gameMin - lastTick;
        $gameSystem._npcLastNeedsTick = gameMin;
        ($gameSystem.npcControllers ?? []).forEach(c => {
          if (c.eventName) window.NPCSocietyRegistry?.tickNeeds(c.eventName, elapsed);
        });
      }

      // A jump of this size in a single tick can only come from sleeping,
      // fast-travel, or a time-skip command, never from walking (which moves
      // the clock at most 1 minute per 10 steps). Flag it so the next group
      // entry redetermines hangout assignments instead of "freezing" NPCs in
      // whatever spot they were in before the skip.
      const lastSeenMin = $gameSystem._npcLastSeenMinute ?? gameMin;
      if (gameMin - lastSeenMin >= Config.GROUP_TIME_SKIP_MINUTES) {
        $gameSystem._npcTimeSkipped = true;
      }
      $gameSystem._npcLastSeenMinute = gameMin;

      // Hour boundary: re-resolve every NPC's schedule-driven map and refresh
      // the live roster on the current map (NPCs whose schedule moved them on
      // leave, newly-scheduled ones move in, everyone else relocates + repicks
      // a goal). This handles a clock that ticked forward normally *and* one
      // that was skipped (sleeping/fast-travel) while staying on the same map,
      // either way we clear the skip flag, since we're recomputing right now.
      // Global/<Abandoned>/house maps use their own spawn styles and are left be.
      const curHour = $gameVariables.value(23);
      if ($gameSystem._npcLastHourSeen === undefined) $gameSystem._npcLastHourSeen = curHour;
      if (curHour !== $gameSystem._npcLastHourSeen) {
        $gameSystem._npcLastHourSeen = curHour;
        $gameSystem._npcTimeSkipped = false;
        if ($dataMap) {
          const mapId = $gameMap.mapId();
          const groupName = MapManager.findMapGroupByMap(mapId);
          const isGlobal = Config.isGlobalGroup(groupName);
          const isAbandoned = ($dataMap.note || "").includes("<Abandoned>");
          if (groupName && !isGlobal && !isAbandoned && !MapManager.isHouseMap(mapId)) {
            // Queue the three refresh stages instead of running them in one
            // frame (visible hitch). One stage runs per frame, in order; a new
            // hour boundary replaces any still-pending queue.
            _hourlyRefreshQueue = { mapId, steps: [
              () => SpawnManager.initializeGroupNPCs(groupName, mapId),
              () => window.NPCSim?.ShopShiftManager?.assignPersonas?.(mapId, groupName),
              () => SpawnManager.refreshCurrentMapForHour(groupName),
            ] };
          }
        }
      }
      if (_hourlyRefreshQueue) {
        if (_hourlyRefreshQueue.mapId !== $gameMap.mapId()) {
          // Player left the map mid-refresh; drop the stale stages (the next
          // hour boundary recomputes everything anyway)
          _hourlyRefreshQueue = null;
        } else {
          _hourlyRefreshQueue.steps.shift()();
          if (_hourlyRefreshQueue.steps.length === 0) _hourlyRefreshQueue = null;
        }
      }
    }
  };

  Game_CharacterBase.prototype.fadeIn = function () { this._fadeType = "in"; this._fadeSpeed = 10; };
  Game_CharacterBase.prototype.fadeOut = function () { this._fadeType = "out"; this._fadeSpeed = 10; };

  const _Game_CharacterBase_update = Game_CharacterBase.prototype.update;
  Game_CharacterBase.prototype.update = function () {
    _Game_CharacterBase_update.call(this);
    if (this._fadeType === "in") {
      this.setOpacity(Math.min(this.opacity() + this._fadeSpeed, 255));
      if (this.opacity() >= 255) this._fadeType = null;
    } else if (this._fadeType === "out") {
      this.setOpacity(Math.max(this.opacity() - this._fadeSpeed, 0));
      if (this.opacity() <= 0) this._fadeType = null;
    }
  };

  const _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function (cmd, args) {
    _Game_Interpreter_pluginCommand.call(this, cmd, args);
    if (cmd === "ReplacePlayerEvents") SpawnManager.replacePlayerEventsWithNPCs(MapManager.getCurrentMapGroup());
    else if (cmd === "SetMapGroup") MapManager.setCurrentMapGroup(args[0]);
    else if (cmd === "ClearMapGroup") MapManager.setCurrentMapGroup(null);
  };

  // ── World initialization: the WorldGen manifests ────────────────────────────
  // MapGroups.json and NPCPools.json are derived from the maps, not from the
  // world, so they are shared by every world and normally ship with the game.
  // What a new world needs is the guarantee that they are THERE and current
  // before anything reads them: the roster, the job rotas and the shop rotas
  // are all drawn from these pools, and a world generated against a missing
  // manifest would come out empty. So the step checks rather than rebuilds,
  // and only pays the multi-second map scan when there is genuinely nothing to
  // read (a fresh checkout, or a manifest left over from an older format).
  // This is the same rebuild the "Test" player-name dev hook forces, minus the
  // forcing: see maybeRegenerateForTest.
  function worldgenManifestsNeedBuild() {
    if (!WorldgenStore.load()) return "MapGroups.json missing";  // i18n-ignore: diagnostic
    const pools = NPCPoolStore.load();
    if (!pools) return "NPCPools.json missing or of an older format";  // i18n-ignore: diagnostic
    if (!pools.__shops) return "NPCPools.json carries no shop index";  // i18n-ignore: diagnostic
    for (const groupName of Object.keys(GroupRegistry.build())) {
      if (Config.isProceduralGroup?.(groupName)) continue;
      if (!pools[groupName]) return `no NPC pool for map group "${groupName}"`;  // i18n-ignore: diagnostic
    }
    return null;
  }

  function initializeWorldgenManifests() {
    const reason = worldgenManifestsNeedBuild();
    if (reason) {
      console.log(`[NPC System] Rebuilding the WorldGen manifests for this world (${reason}).`);
      WorldgenStore.deleteFile();
      NPCPoolStore.deleteFile();
      if (window.WorldGen) { delete window.WorldGen.MapGroups; delete window.WorldGen.NPCPools; }
      GroupRegistry._cache = null;
      GroupRegistry._mapIndex = null;
      NPCPoolStore._cache = undefined;
      SpawnManager._shopIndexSession = {};
      if ($gameSystem) {
        $gameSystem._npcMapGroups = null;
        $gameSystem._npcPoolCache = {};
      }
    }
    // Warms every hand-made group's pool, which also completes the per-map
    // shop index the counter rotas are assigned from. With the manifest
    // present this is a file read; without one it is the rebuild itself.
    const groups = GroupRegistry.build();
    for (const groupName of Object.keys(groups)) {
      if (Config.isProceduralGroup?.(groupName)) continue;
      try { SpawnManager.getNPCPool(groupName); } catch (e) {
        console.error(`[NPC System] Could not build the NPC pool for "${groupName}"`, e);
      }
    }
  }

  if (window.WorldManager && window.WorldManager.registerWorldInitializer) {
    window.WorldManager.registerWorldInitializer("worldgenManifests", 10, initializeWorldgenManifests);
  }

  // Expose group lookups for other plugins (NPCSociety, NPCSimulationCore).
  // getLevelRangeForMap was dropped along with the old hardcoded per-group
  // level ranges, callers already fall back to a default range via `?? [1, 20]`.
  window.NPCSystem = {
    getMapGroups: () => GroupRegistry.build(),
    getMapGroup: GroupRegistry.get,
    // Exposed so NPCSimulationCore's ShopShiftManager can draw <Shop> personas
    // from the same template/roster pools the spawn system already uses.
    getNPCPool: SpawnManager.getNPCPool,
    // Spawn templates synthesized from society profiles, for towns with no
    // authored NPC events (procedural settlements). See makeSocietyTemplate.
    buildSocietyPool: SpawnManager.buildSocietyPool,
    makeSocietyTemplate: SpawnManager.makeSocietyTemplate,
    // Interior <Shop> staffing helpers, see ShopShiftManager.assignInteriorPersonas.
    getShopSocietyCandidates: SpawnManager.getShopSocietyCandidates,
    generateSeededPersona: SpawnManager.generateSeededPersona,
    hasShopTag: Utils.hasShopTag,
    hasHiddenTag: Utils.hasHiddenTag,
    // Residents of a hand-made map, see NPCSociety's local-level sync: their
    // level follows the party's median instead of a one-time roll.
    hasLocalTag: Utils.hasLocalTag,
    extractShopName: Utils.extractShopName,
    // Per-map index of shop-like events ( <Shop> tag / Shop Processing /
    // RandomDailyShop commands ), see SpawnManager.buildShopIndex.
    getShopIndex: SpawnManager.getShopIndex,
    // Template sprite lookup for off-map NPCs (bust resolution etc.).
    findTemplateSprite: SpawnManager.findTemplateSprite,
    GLOBAL_GROUP_NAME: Config.GLOBAL_GROUP_NAME,
    // "Proc:x,y" settlements are minted as the player reaches those world
    // coordinates, so world-wide passes over the authored groups skip them.
    isProceduralGroup: (groupName) => Config.isProceduralGroup(groupName),
    // Groups (e.g. "PublicTransport") whose NPCs are only ever taking a
    // temporary ride rather than living their normal routine, see
    // NPCEmpathizeUI's routine-tab "Traveling" override.
    SEATED_GLOBAL_GROUPS: Config.SEATED_GLOBAL_GROUPS,
    findMapGroupByMap: MapManager.findMapGroupByMap,
    isHouseMap: MapManager.isHouseMap,
    loadMapData: MapManager.loadMapData,
    // --- wiki lookup API (NPCEmpathize internal encyclopedia) ---------------
    getGroupNames: () => Object.keys(GroupRegistry.build()),
    getNPCNamesByGroup: (groupName) =>
      (SpawnManager.getNPCPool(groupName) || [])
        .map(t => t?.eventData?.name)
        .filter(n => n && n !== "NPC"),
    // Procedural recruit lifecycle (map 636): record a citizen that joined the
    // party so it is cached in the world folder and never respawns on its tile.
    recordProceduralRecruit: ProceduralManager.recordProceduralRecruit,
    getRecruitedProcEventIds: ProceduralManager.getRecruitedEventIds,
    // --- Map Battle Mode stepping (MapBattleMode.js) -------------------------
    // Bank N tiles of movement for every live NPC on the map. Called once per
    // round, at the world step, so the frozen town lurches one tile forward
    // between rounds instead of drifting alongside the fight.
    // A townsperson who has taken the party's side is skipped: they are a
    // combatant now (event._mbmCombatant), and MapBattleMode owns where they
    // stand for the rest of the fight.
    grantTacticalSteps: (n) =>
      ($gameSystem.npcControllers || []).forEach(c => {
        if (c?.event?._mbmCombatant) return;
        c?.grantTacticalSteps?.(n);
      }),
    clearTacticalSteps: () =>
      ($gameSystem.npcControllers || []).forEach(c => c?.clearTacticalSteps?.()),
  };
})();