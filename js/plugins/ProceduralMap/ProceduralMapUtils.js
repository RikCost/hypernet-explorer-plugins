/*:
 * @target MZ
 * @plugindesc Utility functions for procedural map generation: noise, tile conversion, coordinates
 * @author Omni-Lex
 *
 * @help
 * Procedural Map Utilities
 * ========================
 * Provides core utility functions for procedural generation:
 * - Perlin noise and smoothing
 * - Tile ID to progressive ID conversions
 * - World coordinate management
 * - Seeded random number generation
 * - Cache management
 * - Multi-tile terrain feature support
 *
 * TERRAIN FEATURE FORMATS
 * =======================
 * Single Tile:
 *   <FeatureName: B10>      (B-E sheets, no space)
 *   <FeatureName: B 10>     (B-E sheets, with space - legacy)
 *   <FeatureName: A1 2>     (A-sheets: A1 sheet, index 2)
 *
 * Multi-Tile Grid (2x2):
 *   <Castle: [B34, B45],[B65, B66]>
 *   Places a 2x2 grid of tiles at the feature location
 *
 * Multi-Tile Grid (1x2 - vertical):
 *   <Cactus: [E34],[B60]>
 *   Places a 1 wide, 2 tall grid
 *
 * Multi-Tile Grid (3x2):
 *   <Feature: [B10, B11, B12],[B20, B21, B22]>
 *   Places a 3 wide, 2 tall grid
 *
 * This plugin must be loaded before ProceduralMapBiomeGenerator.js
 *
 * BIOMES MAP PRELOAD / EXPORT
 * ===========================
 * Enable "Preload Biomes Map" to load the biome coordinate cache from
 * js/db/WorldGen/BiomesMap.json instead of scanning all world map tiles.
 * This speeds up the first visit to map 315.
 *
 * Enable "Export Biomes Map" to write BiomesMap.json automatically
 * whenever the world map cache is rebuilt from tiles. The file includes
 * biome coordinates, pre-computed road directions, and river directions.
 * Requires NW.js (desktop game). In browser/test builds it will silently
 * skip the write.
 *
 * @param preloadBiomesMap
 * @text Preload Biomes Map
 * @type boolean
 * @default false
 * @desc Load biome cache from js/db/WorldGen/BiomesMap.json instead of scanning world map tiles
 *
 * @param exportBiomesMap
 * @text Export Biomes Map
 * @type boolean
 * @default false
 * @desc Write biome cache + road/river directions to js/db/WorldGen/BiomesMap.json after tile scan
 */

(() => {
  "use strict";

  const pluginName = "ProceduralMapUtils";

  const _params = PluginManager.parameters(pluginName);
  const PRELOAD_BIOMES_MAP = _params.preloadBiomesMap === "true";
  const EXPORT_BIOMES_MAP = _params.exportBiomesMap === "true";

  // ===== CONSTANTS =====
  const WORLD_MAP_ID = 315;
  const WORLD_TILESET_ID = 96;
  const PROC_MAP_ID = 636;
  const PROC_MAP_WIDTH = 64;
  const PROC_MAP_HEIGHT = 64;
  const DEBUG_MODE = Utils.isOptionValid("test");
  const BORDER_DETECTION_RANGE = 3;
  const { Biomes } =
    window.WorldGen;

  // ===== PERFORMANCE CACHE =====
  const Cache = {
    tilesetFeatures: {},
    biomeNameCache: {},
    // Nested Map keyed seed -> floorX -> floorY -> value. Avoids building a
    // template-string key per lookup and the collision risk of a packed numeric
    // key. noise2D is pure, so reordering/eviction never changes results.
    noiseCache: new Map(),
    noiseCacheCount: 0,
    maxNoiseCacheSize: 20000,

    getTilesetFeatures(tilesetId) {
      if (!this.tilesetFeatures[tilesetId]) {
        this.tilesetFeatures[tilesetId] = parseTerrainFeatures(tilesetId);
      }
      return this.tilesetFeatures[tilesetId];
    },

    getNoise(x, y, seed) {
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      let bySeed = this.noiseCache.get(seed);
      if (!bySeed) { bySeed = new Map(); this.noiseCache.set(seed, bySeed); }
      let byX = bySeed.get(fx);
      if (!byX) { byX = new Map(); bySeed.set(fx, byX); }
      let v = byX.get(fy);
      if (v === undefined) {
        if (this.noiseCacheCount >= this.maxNoiseCacheSize) {
          // Wholesale clear on overflow (cheaper than per-key LRU eviction).
          this.noiseCache.clear();
          this.noiseCacheCount = 0;
          bySeed = new Map(); this.noiseCache.set(seed, bySeed);
          byX = new Map(); bySeed.set(fx, byX);
        }
        // Preserve the original behaviour: compute from the unfloored x/y but
        // key by the floored coordinates.
        v = noise2D(x, y, seed);
        byX.set(fy, v);
        this.noiseCacheCount++;
      }
      return v;
    },

    clear() {
      this.tilesetFeatures = {};
      this.biomeNameCache = {};
      this.noiseCache.clear();
      this.noiseCacheCount = 0;
    },
  };

  // ===== LOGGING UTILITY =====
  function log(message) {
    if (DEBUG_MODE) {
      console.log(`[ProcGen] ${message}`);
    }
  }

  function logWarn(message) {
    if (DEBUG_MODE) {
      console.warn(`[ProcGen] ${message}`);
    }
  }

  // ===== TILE ID CONVERSION FUNCTIONS =====

  /**
   * Convert tile ID to progressive ID
   * Progressive ID system:
   * A1: 0-15, A2: 16-31, A3: 32-47, A4: 48-63, A5: 64-79
   * B: 80-335, C: 336-591, D: 592-847, E: 848-1103
   * Also handles extended tilesets
   */
  function getTileIdToProgressiveId(tileId) {
    const ranges = [
      { max: 256, base: 80, sub: 0 },
      { max: 512, base: 336, sub: 256 },
      { max: 768, base: 592, sub: 512 },
      { max: 1024, base: 848, sub: 768 },
    ];

    for (const r of ranges) {
      if (tileId < r.max) return r.base + (tileId - r.sub);
    }

    if (tileId >= 2048) {
      const offset = tileId - 2048;
      const sectionIndex = Math.floor(offset / 48);
      const indexInSection = offset % 48;

      if (sectionIndex <= 4) {
        const validIndex = Math.floor(indexInSection / 3);
        if (validIndex < 16) return sectionIndex * 16 + validIndex;
      }
      return sectionIndex * 16 + Math.floor(indexInSection / 3);
    }

    return -1;
  }

  /**
   * Convert progressive ID to tile ID
   */
  function getProgressiveIdToTileId(pId) {
    const ranges = [
      [
        0,
        80,
        (id) => {
          const sect = Math.floor(id / 16);
          const idx = id % 16;
          return 2048 + sect * 48 + idx * 3;
        },
      ],
      [80, 336, (id) => id - 80],
      [336, 592, (id) => 256 + (id - 336)],
      [592, 848, (id) => 512 + (id - 592)],
      [848, 1104, (id) => 768 + (id - 848)],
    ];

    for (const [min, max, calc] of ranges) {
      if (pId >= min && pId < max) return calc(pId);
    }
    return 0;
  }

  /**
   * Convert tile type (A1-E) and index to tile ID
   * Special handling for A4 cliff tags (1-16):
   * - Tags 1-8: First row of ceilings/walls
   * - Tags 9-16: Second row of ceilings/walls
   */
  function getTileIdFromTypeAndIndex(tileType, index) {
    const type = tileType.toUpperCase();

    if (type.startsWith("A")) {
      const typeNum = parseInt(type.substring(1)) || 1;

      // Standard RPG Maker MZ autotiles
      // A5: 1536-1663 (128 autotile variants)
      if (typeNum === 5) {
        return 1536 + (index - 0); // index 0-127 maps to 1536-1663
      }

      // Extended A-sheets in 2048+ range (A1, A2, A3, A4)
      if (typeNum === 4 && index >= 1 && index <= 16) {
        const baseA4 = 2048 + 3 * 48;
        return baseA4 + (index - 1);
      }

      return 2048 + (typeNum - 1) * 48 + (index - 1) * 48;
    } else if (type === "B") {
      return index - 1;
    } else if (type === "C") {
      return 256 + (index - 1);
    } else if (type === "D") {
      return 512 + (index - 1);
    } else if (type === "E") {
      return 768 + (index - 1);
    }

    return 0;
  }

  // ===== BIOME LOOKUP FUNCTIONS =====

  // Reverse lookup maps progressiveId -> biome name / road direction. Built once
  // from the static Biomes list so per-tile biome resolution is O(1) instead of
  // a linear scan over every biome (which mattered on the ~262k-tile world map
  // 315 scan and every fallback lookup). "First biome wins" preserves the old
  // array-order scan semantics.
  let _worldTileBiomeIndex = null; // Map<progressiveId, biomeName>
  let _worldTileRoadIndex = null;  // Map<progressiveId, direction>

  function buildWorldTileIndices() {
    const biomeIndex = new Map();
    const roadIndex = new Map();
    for (const biome of Biomes) {
      if (!biome.biomeIds) continue;
      const isRoad = biome.name.startsWith("Road ");
      const direction = isRoad ? biome.name.substring(5).toLowerCase() : null;
      for (const pid of biome.biomeIds) {
        if (!biomeIndex.has(pid)) biomeIndex.set(pid, biome.name);
        if (isRoad && !roadIndex.has(pid)) roadIndex.set(pid, direction);
      }
    }
    _worldTileBiomeIndex = biomeIndex;
    _worldTileRoadIndex = roadIndex;
  }

  /**
   * Get biome for tile position on world map using biomeIds from Biomes
   */
  function getBiomeForWorldTile(worldTileId) {
    const progressiveId = getTileIdToProgressiveId(worldTileId);
    if (progressiveId < 0) {
      return "Fields";
    }

    if (!_worldTileBiomeIndex) buildWorldTileIndices();
    return _worldTileBiomeIndex.get(progressiveId) || "Fields";
  }

  /**
   * True when a world-map tile id resolves to a river marker biome ("River
   * horizontal/vertical/cross"). Rivers may be painted on the world map either as
   * these small biome tiles or as wide water autotiles; both resolve through the
   * biome table to a name starting with "River".
   */
  function isRiverWorldTileId(worldTileId) {
    if (!worldTileId) return false;
    const name = getBiomeForWorldTile(worldTileId);
    return typeof name === "string" && name.toLowerCase().indexOf("river") === 0;
  }

  // Base biomes that are themselves open water: a river painted over them is
  // meaningless (it is already water), so no overlay is recorded for these.
  const _WATER_BASE_RE = /^(ocean|lake|seabed|sea\b)/i;

  /**
   * Actor 1 named "Test" marks a playtesting session. The world map is being
   * edited live in those sessions, so every cached snapshot of it (the preloaded
   * BiomesMap.json, the in-save coordinate cache) has to be treated as stale and
   * rebuilt from the actual tiles.
   */
  function isTestPlayer() {
    return !!(
      typeof $gameActors !== "undefined" &&
      $gameActors &&
      $gameActors.actor(1) &&
      $gameActors.actor(1).name() === "Test"  // i18n-ignore  debug account name
    );
  }

  // ===== WORLD-MAP BRIDGE MARKERS =====
  // A road crossing a river is never inferred from a road/river biome overlap
  // (that produced flooded, undrivable road maps). The world map instead tags
  // the crossing explicitly with a bridge tile, and only those columns generate
  // a river + a road drawn over it.
  // These are progressive ids (the ids the tile debugger overlays on the world
  // map and the same vocabulary Biomes.json biomeIds use), not raw tile ids.
  const BRIDGE_PROGRESSIVE_VERTICAL = 440;   // bridge spans north-south
  const BRIDGE_PROGRESSIVE_HORIZONTAL = 441; // bridge spans east-west

  /**
   * Bridge orientation for a world-map tile id, or null when it is not a bridge
   * marker. The direction is the direction the road/bridge runs; the river it
   * crosses runs perpendicular to it.
   */
  function getBridgeDirectionFromWorldTileId(worldTileId) {
    if (!worldTileId) return null;
    const progressiveId = getTileIdToProgressiveId(worldTileId);
    if (progressiveId === BRIDGE_PROGRESSIVE_VERTICAL) return "vertical";
    if (progressiveId === BRIDGE_PROGRESSIVE_HORIZONTAL) return "horizontal";
    return null;
  }

  const _ROAD_BASE_RE = /^road/i;

  /**
   * Classify a single world-map column from a tileAt(z) accessor (z = 3..0).
   *
   * A river tile painted OVER a real land biome must not hijack the whole tile
   * into a full river-biome map. Instead the column is classified as the
   * underlying (topmost non-river) biome and the river tile id is returned
   * separately so the caller can draw the river as an overlay inside that biome.
   * A river with no land beneath it (over ocean, or standing alone) keeps its
   * river/water classification and reports no overlay.
   *
   * A bridge marker tile (440/441) in the column classifies it as a Road column
   * whose road runs along the marker's orientation, and reports that orientation
   * so the generator can draw the river first and the road over it.
   *
   * Roads are painted OVER a terrain biome, so the column also reports the
   * topmost non-road, non-river biome as `underBiome`: the terrain the road runs
   * across. For a column with no road it is simply the classified biome.
   *
   * @param {Function} tileAt - (z) => tileId at this column's layer z
   * @returns {{biome:string, riverTileId:number, bridge:(string|null), underBiome:(string|null)}}
   */
  function classifyWorldColumn(tileAt) {
    let base = null;      // topmost non-river biome (the real terrain)
    let under = null;     // topmost non-river, non-road biome (terrain under a road)
    let top = null;       // topmost non-empty biome (river or not)
    let riverTileId = 0;  // topmost river tile id
    let bridge = null;    // bridge orientation when a bridge marker is present
    for (let z = 3; z >= 0; z--) {
      const t = tileAt(z);
      if (!t) continue;
      // Bridge markers are annotations, not terrain: they never classify as a
      // biome themselves, they only flag the column as a river crossing.
      const bridgeDir = getBridgeDirectionFromWorldTileId(t);
      if (bridgeDir) {
        if (!bridge) bridge = bridgeDir;
        continue;
      }
      const b = getBiomeForWorldTile(t);
      if (top === null) top = b;
      if (typeof b === "string" && b.toLowerCase().indexOf("river") === 0) {
        if (!riverTileId) riverTileId = t;
      } else {
        if (base === null) base = b;
        if (under === null && !(typeof b === "string" && _ROAD_BASE_RE.test(b))) {
          under = b;
        }
      }
    }
    const biome = base !== null ? base : (top !== null ? top : "Fields");
    // Only land bases carry a river overlay; deep-water bases do not.
    if (base === null || _WATER_BASE_RE.test(base)) riverTileId = 0;

    if (bridge) {
      // The crossing is its own biome: river first, road over it. Bridge counts
      // as a road biome, so neighbouring road maps still connect to it.
      return { biome: "Bridge", riverTileId, bridge, underBiome: under };  // i18n-ignore  biome id
    }

    // A road that merely overlaps a river is NOT a crossing. Without an explicit
    // bridge marker the river overlay is dropped, otherwise the channel floods
    // the carriageway and leaves an impassable road.
    if (base !== null && _ROAD_BASE_RE.test(base)) riverTileId = 0;

    return { biome, riverTileId, bridge: null, underBiome: under };
  }

  /**
   * Get road direction from world tile using biomeIds from Biomes
   */
  function getRoadDirectionFromWorldTile(worldTileId) {
    const progressiveId = getTileIdToProgressiveId(worldTileId);

    if (progressiveId < 0) {
      return null;
    }

    if (!_worldTileRoadIndex) buildWorldTileIndices();
    return _worldTileRoadIndex.get(progressiveId) || null;
  }

  // ===== BIOSIGN FEATURES (alien biomes) =====
  //
  // An alien biome declares its tentacles, tentacled rock and crystal tentacles
  // with a `lifeSign` on the feature (js/db/WorldGen/AlienBiomes.json). They are
  // not scenery every world of that type carries: they are the thing a scan
  // reads as a WEAK life sign, so they only grow where the planet the party
  // landed on actually shows one (GalaxySim.currentAlienGrowsBiosigns; a world
  // with a full biosphere counts). Every consumer of a biome's features goes
  // through getBiomeByName, so stripping them here is the whole rule: the
  // scatter passes, the adjacent-biome blending and the borrowed-terrain
  // fallbacks all see the same list.
  //
  // The stripped copy is memoised on the biome record itself rather than in
  // biomeNameCache, because which of the two lists is right changes with the
  // planet under the party's feet and not with the biome's name.
  function _biosignsAllowed() {
    const GS = window.GalaxySim;
    if (!GS || typeof GS.currentAlienGrowsBiosigns !== "function") return true;
    return GS.currentAlienGrowsBiosigns();
  }

  const _biosignFreeBiomes = new WeakMap();
  function _withoutBiosigns(biome) {
    if (!biome || !Array.isArray(biome.features)) return biome;
    if (!_biosignFreeBiomes.has(biome)) {
      const kept = biome.features.filter((f) => !(f && typeof f === "object" && f.lifeSign));
      // Nothing to strip: the biome is already its own barren version.
      _biosignFreeBiomes.set(biome, kept.length === biome.features.length
        ? biome
        : Object.assign({}, biome, { features: kept }));
    }
    return _biosignFreeBiomes.get(biome);
  }

  /**
   * Get biome object by name (with caching)
   */
  function getBiomeByName(biomeName) {
    if (!Cache.biomeNameCache[biomeName]) {
      Cache.biomeNameCache[biomeName] =
        Biomes.find((b) => b.name === biomeName) || null;
    }
    const biome = Cache.biomeNameCache[biomeName];
    if (!biome || _biosignsAllowed()) return biome;
    return _withoutBiosigns(biome);
  }

  // ===== TERRAIN FEATURE PARSING =====

  /**
   * Parse a single tile from format like: B10, B 10, A1 2, A12
   */
  function parseSingleTileString(tileStr) {
    const trimmed = tileStr.trim();

    // B-E sheet format: B10 or B 10
    const bcdeMatch = trimmed.match(/^([B-E])\s*(\d+)$/i);
    if (bcdeMatch) {
      const type = bcdeMatch[1].toUpperCase();
      const index = parseInt(bcdeMatch[2]);
      return getTileIdFromTypeAndIndex(type, index);
    }

    // A-sheet format: A1 2 or A12
    const aSheetMatch = trimmed.match(/^A([1-5])\s*(\d+)$/i);
    if (aSheetMatch) {
      const sheetNum = parseInt(aSheetMatch[1]);
      const index = parseInt(aSheetMatch[2]);
      return getTileIdFromTypeAndIndex(`A${sheetNum}`, index);
    }

    return 0;
  }

  /**
   * Parse terrain feature definitions from tileset notes
   * Supports:
   * - Multi-tile grids: <Feature: [B10, B11],[B20, B21]>
   * - Single tiles: <Feature: B10> or <Feature: B 10> or <Feature: A1 2>
   */
  function parseTerrainFeatures(tilesetId) {
    const tileset = $dataTilesets[tilesetId];
    if (!tileset || !tileset.note) {
      return {};
    }

    const features = {};
    const noteLines = tileset.note.split("\n");

    for (const line of noteLines) {
      // Try multi-tile format first: <FeatureName: [tile1, tile2],[tile3, tile4]>
      const multiTileMatch = line.match(/<(\w+):\s*(\[.*\](?:\s*,\s*\[.*\])*)>/);
      if (multiTileMatch) {
        const featureName = multiTileMatch[1];
        const gridString = multiTileMatch[2];

        const rows = gridString.match(/\[([^\]]*)\]/g);
        if (rows && rows.length > 0) {
          const grid = rows.map((row) => {
            const tileStrings = row.slice(1, -1).split(",");
            const tiles = tileStrings
              .map((t) => parseSingleTileString(t))
              .filter((t) => t > 0);
            return tiles;
          });

          if (grid.length > 0 && grid[0].length > 0) {
            if (!features[featureName]) {
              features[featureName] = [];
            }

            // Store multi-tile feature variant
            const maxWidth = Math.max(...grid.map((r) => r.length));
            features[featureName].push({
              type: "grid",
              grid: grid,
              width: maxWidth,
              height: grid.length,
            });
            continue;
          }
        }
      }

      // Try single-tile format: <FeatureName: B10> or <FeatureName: B 10> or <FeatureName: A1 2>
      const singleTileMatch = line.match(
        /<(\w+):\s*([A-E]\d+\s*\d*|[B-E]\d+)>/i
      );
      if (singleTileMatch) {
        const featureName = singleTileMatch[1];
        const tileStr = singleTileMatch[2];
        const tileId = parseSingleTileString(tileStr);

        if (tileId > 0) {
          if (!features[featureName]) {
            features[featureName] = [];
          }
          // Store single-tile feature variant
          features[featureName].push({
            type: "single",
            tileId: tileId,
          });
        }
      }
    }

    return features;
  }

  // ===== RANDOM NUMBER GENERATION =====

  /**
   * Seeded random number generator (Mulberry32)
   */
  function createSeededRandom(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
    };
  }

  /**
   * Read the canonical world-RNG root (the HistorySimulator seed). Every piece
   * of world-persistent procedural content derives from this so a given world
   * seed produces a consistent, reproducible world that differs from other
   * seeds. Mirrors the fallback chain used by TreasureRoomSystem/SearchableItemShop.
   */
  /**
   * Coerce any seed value (number, numeric string, or arbitrary word such as
   * "esoteric") into a uint32 RNG root. Arbitrary strings are FNV-1a hashed so
   * named seeds are usable everywhere a numeric seed is expected.
   */
  function normalizeSeed(value) {
    if (typeof value === "number" && isFinite(value)) return value >>> 0;
    const str = String(value == null ? "" : value);
    if (/^\d+$/.test(str)) return Number(str) >>> 0;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function getWorldSeed() {
    try {
      if (window.HistoryManager && typeof window.HistoryManager.getSeed === "function") {
        const s = window.HistoryManager.getSeed();
        if (s !== undefined && s !== null) return normalizeSeed(s);
      }
    } catch (e) { /* ignore */ }
    if (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._historySeed !== undefined) {
      return normalizeSeed($gameSystem._historySeed);
    }
    return normalizeSeed(19002001); // canon default
  }

  /**
   * Strong integer avalanche hash mixing the world seed with world coordinates.
   * Replaces the old additive (seed + x + y) mixing so neighbouring seeds and
   * neighbouring tiles produce wholly different RNG streams instead of
   * near-identical maps. Deterministic for a given (worldSeed, x, y).
   */
  function hashCoords(worldSeed, x, y) {
    let h = (worldSeed | 0) >>> 0;
    h = Math.imul(h ^ ((x | 0) * 0x9e3779b1), 0x85ebca77) >>> 0;
    h = Math.imul(h ^ ((y | 0) * 0xc2b2ae3d), 0x27d4eb2f) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545f491) >>> 0;
    h ^= h >>> 13;
    return h >>> 0;
  }

  /**
   * THE canonical seed for a procedural map square. Every entry point into map
   * 636 must derive its terrain seed from here, or the same world tile builds a
   * different map depending on how it was reached (world map "Visit", walking
   * across a biome border, coming back out of a house, surfacing from a cave).
   *
   * Only the world seed, the world coordinates and the layer depth may take
   * part: those are exactly the things that identify the square. `salt` is for
   * squares that legitimately hold more than one map at the same depth (one
   * dungeon per DoorDungeon tile, for instance).
   *
   * Depth 0 with no salt reproduces the plain surface seed, so surfacing from a
   * cave rebuilds the very map the player descended from.
   */
  function procMapSeed(originX, originY, layerDepth, salt) {
    const base = hashCoords(getWorldSeed(), originX, originY);
    const depth = layerDepth | 0;
    const extra = salt | 0;
    if (!depth && !extra) return base;
    return hashCoords(base, depth + 1, extra);
  }

  /**
   * Ice world tiles resolve to a latitude-dependent biome: Permafrost at the
   * extreme poles, Tundra across the milder mid-latitudes (Y=0 is north pole,
   * Y=255 is south). Applied before the specialBiomes roll, and shared so the
   * travel HUD and debug overlay normalize exactly like the generator does --
   * neither Permafrost nor Tundra defines specialBiomes, so an Ice tile must
   * never be reported as Crystals.
   */
  function normalizeLatitudeBiome(biomeName, originY) {
    // i18n-ignore-start  biome ids from Biomes.json
    if (biomeName !== "Ice") return biomeName;
    return (originY < 48 || originY >= 208) ? "Permafrost" : "Tundra";
    // i18n-ignore-end
  }

  /**
   * Resolve the effective biome for a world tile, applying the specialBiomes
   * override (e.g. Forest -> SpiritWoods, Snow -> Crystals).
   *
   * This is the single source of truth for the roll. The map generator, the
   * world-coordinate lookup that feeds the travel HUD, and the debug tile
   * overlay all call it, so the name shown on the tile, the name shown in the
   * HUD, and the map actually built on entry can never disagree.
   *
   * Deterministic for a given (world seed, x, y): 25% chance to swap to one of
   * the parent biome's specialBiomes entries.
   *
   * @returns {string} the special biome name, or baseBiomeName when no override applies
   */
  function resolveSpecialBiome(baseBiomeName, originX, originY) {
    const biome = getBiomeByName(baseBiomeName);
    if (!biome || !biome.specialBiomes || biome.specialBiomes.length === 0) {
      return baseBiomeName;
    }

    const coordinateSeed = hashCoords(getWorldSeed() ^ 0x9e37, originX, originY);
    const rng = createSeededRandom(coordinateSeed);

    if (rng() < 0.25) {
      const specialBiomeName =
        biome.specialBiomes[Math.floor(rng() * biome.specialBiomes.length)];
      // Fall back to the parent when the variant has no biome definition.
      if (getBiomeByName(specialBiomeName)) return specialBiomeName;
    }

    return baseBiomeName;
  }

  /**
   * Get random element from array using seeded RNG
   */
  function randomChoice(array, rng) {
    if (array.length === 0) return 0;
    return array[Math.floor(rng() * array.length)];
  }

  // ===== HELPER FUNCTIONS =====

  /**
   * Normalize biome name for edge detection
   */
  function normalizeBiomeForEdge(biomeName) {
    if (biomeName && biomeName.startsWith("Road ")) {
      return "Road";
    }
    return biomeName;
  }

  /**
   * Check if a world coordinate has a non-procedural destination.
   * A WorkSystem/Destinations.json entry can name two different doors onto a
   * hand-authored map: `coords` (direction/id/x/y/mapCoord, one door per
   * side of the town's footprint) and a single fixed `entrance`
   * {id,x,y,direction}. `coords` takes priority when it names this exact
   * square; any other square inside the town's `reservedTiles` footprint
   * falls back to `entrance` regardless of the direction crossed.
   */
  function getNonProceduralDestination(worldX, worldY, exitDirection) {
    const destinations = window.WorkSystem && window.WorkSystem.Destinations;
    if (!destinations) return { exists: false, destination: null };

    const directionNames = { 2: "south", 4: "west", 6: "east", 8: "north" };
    const direction = directionNames[exitDirection] || null;
    const mapCoord = worldX + "," + worldY;

    for (const location of Object.values(destinations)) {
      const coords = Array.isArray(location.coords) ? location.coords : null;
      const onCoords = coords && coords.some((c) => c.mapCoord === mapCoord);
      const onReserved =
        Array.isArray(location.reservedTiles) &&
        location.reservedTiles.includes(mapCoord);
      if (!onCoords && !onReserved) continue;

      if (onCoords) {
        const dest = direction && coords.find((c) => c.direction === direction);
        if (dest) {
          return {
            exists: true,
            destination: { mapId: dest.id, x: dest.x, y: dest.y },
          };
        }
        return { exists: true, destination: null };
      }

      const entrance = location.entrance;
      if (entrance && entrance.id) {
        return {
          exists: true,
          destination: { mapId: entrance.id, x: entrance.x, y: entrance.y },
        };
      }

      return { exists: true, destination: null };
    }

    return { exists: false, destination: null };
  }

  // ===== NOISE FUNCTIONS =====

  /**
   * Perlin-style noise function for terrain generation
   */
  function noise2D(x, y, seed = 0) {
    const n = x + y * 57 + seed * 131;
    let noise = (n << 13) ^ n;
    return (
      1.0 -
      ((noise * (noise * noise * 15731 + 789221) + 1376312589) & 0x7fffffff) /
      1073741824.0
    );
  }

  /**
   * Smooth noise with interpolation
   */
  function smoothNoise(x, y, seed) {
    const corners =
      (Cache.getNoise(x - 1, y - 1, seed) +
        Cache.getNoise(x + 1, y - 1, seed) +
        Cache.getNoise(x - 1, y + 1, seed) +
        Cache.getNoise(x + 1, y + 1, seed)) /
      16;
    const sides =
      (Cache.getNoise(x - 1, y, seed) +
        Cache.getNoise(x + 1, y, seed) +
        Cache.getNoise(x, y - 1, seed) +
        Cache.getNoise(x, y + 1, seed)) /
      8;
    const center = Cache.getNoise(x, y, seed) / 4;
    return corners + sides + center;
  }

  // ===== COORDINATE MANAGEMENT =====

  /**
   * Calculate tile index in map data array
   */
  function calculateIndex(x, y, z, width, height) {
    return z * width * height + y * width + x;
  }

  /**
   * Get adjacent biomes on world map (north, south, east, west)
   */
  function getAdjacentBiomesOnWorldMap(originX, originY) {
    const adjacent = { north: null, south: null, east: null, west: null };

    if ($gameMap.mapId() !== WORLD_MAP_ID) {
      return adjacent;
    }

    const mapW = $gameMap.width();
    const mapH = $gameMap.height();

    const dirs = [
      ["north", 0, -1, () => originY > 0],
      ["south", 0, 1, () => originY < mapH - 1],
      ["east", 1, 0, () => originX < mapW - 1],
      ["west", -1, 0, () => originX > 0],
    ];

    dirs.forEach(([key, dx, dy, isValid]) => {
      if (isValid()) {
        const tx = originX + dx;
        const ty = originY + dy;
        const tileId = [0, 1, 2, 3].reduce(
          (acc, z) => acc || $gameMap.tileId(tx, ty, z),
          0
        );
        const biomeName = getBiomeForWorldTile(tileId);
        adjacent[key] = biomeName;
      }
    });

    log(`[getAdjacentBiomesOnWorldMap] At (${originX}, ${originY}): N=${adjacent.north}, S=${adjacent.south}, E=${adjacent.east}, W=${adjacent.west}`);
    return adjacent;
  }

  /**
   * Get adjacent biome names from cache
   */
  function getAdjacentBiomesFromCache(worldX, worldY, cache) {
    const adjacent = {
      north: null,
      south: null,
      east: null,
      west: null,
    };

    if (!cache || Object.keys(cache).length === 0) {
      return adjacent;
    }

    const mapWidth = 512;
    const mapHeight = 512;

    // O(1) lookups via the inverted index (first biome wins, matching the
    // previous Object.entries scan order).
    const index = getBiomeFallbackIndex(cache);

    // Check only immediate cardinal neighbors
    if (worldY > 0) {
      const b = index.get(worldX * 100000 + (worldY - 1));
      if (b) adjacent.north = b;
    }

    if (worldY < mapHeight - 1) {
      const b = index.get(worldX * 100000 + (worldY + 1));
      if (b) adjacent.south = b;
    }

    if (worldX < mapWidth - 1) {
      const b = index.get((worldX + 1) * 100000 + worldY);
      if (b) adjacent.east = b;
    }

    if (worldX > 0) {
      const b = index.get((worldX - 1) * 100000 + worldY);
      if (b) adjacent.west = b;
    }

    return adjacent;
  }

  /**
   * Check biome composition at the borders of an adjacent world map tile (cardinal directions only)
   */
  function checkAdjacentMapBiomesFromCache(worldX, worldY, cache) {
    const mapW = $gameMap.mapId() === 315 ? $gameMap.width() : 512;
    const mapH = $gameMap.mapId() === 315 ? $gameMap.height() : 512;
    const borderBiomes = { north: [], south: [], east: [], west: [] };

    if (!cache || Object.keys(cache).length === 0) return borderBiomes;

    // Check only immediate cardinal neighbors
    const checks = [
      [worldY > 0, worldX, worldY - 1, "north"],
      [worldY < mapH - 1, worldX, worldY + 1, "south"],
      [worldX < mapW - 1, worldX + 1, worldY, "east"],
      [worldX > 0, worldX - 1, worldY, "west"],
    ];

    const index = getBiomeMultiIndex(cache);
    for (const [isValid, checkX, checkY, dir] of checks) {
      if (!isValid) continue;
      const biomes = index.get(checkX * 100000 + checkY);
      if (biomes) borderBiomes[dir] = biomes.slice();
    }
    return borderBiomes;
  }

  /**
   * Check biome composition at the diagonal neighbors of a world map tile
   * Returns object with diagonal biome arrays: topLeft, topRight, bottomLeft, bottomRight
   */
  function checkDiagonalMapBiomesFromCache(worldX, worldY, cache) {
    const mapW = $gameMap.mapId() === 315 ? $gameMap.width() : 512;
    const mapH = $gameMap.mapId() === 315 ? $gameMap.height() : 512;
    const diagonalBiomes = {
      topLeft: [],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    };

    if (!cache || Object.keys(cache).length === 0) return diagonalBiomes;

    // Check diagonal neighbors
    const diagonalChecks = [
      [worldX > 0 && worldY > 0, worldX - 1, worldY - 1, "topLeft"],
      [worldX < mapW - 1 && worldY > 0, worldX + 1, worldY - 1, "topRight"],
      [worldX > 0 && worldY < mapH - 1, worldX - 1, worldY + 1, "bottomLeft"],
      [worldX < mapW - 1 && worldY < mapH - 1, worldX + 1, worldY + 1, "bottomRight"],
    ];

    const index = getBiomeMultiIndex(cache);
    for (const [isValid, checkX, checkY, dir] of diagonalChecks) {
      if (!isValid) continue;
      const biomes = index.get(checkX * 100000 + checkY);
      if (biomes) diagonalBiomes[dir] = biomes.slice();
    }
    return diagonalBiomes;
  }

  /**
   * Check if a tile ID is a water tile
   * This is a simple utility used by feature placement functions
   */
  function isWaterTileId(tileId, waterTileSet) {
    if (!tileId || tileId === 0 || !waterTileSet) {
      return false;
    }
    return waterTileSet.has(tileId);
  }

  /**
   * Get a random feature variant from a feature array
   * Handles both single-tile and multi-tile variants
   */
  function getRandomFeatureVariant(featureArray, rng) {
    if (!featureArray || featureArray.length === 0) return null;

    const variant = randomChoice(featureArray, rng);
    return variant;
  }

  /**
   * Check if a tile position is already occupied by a feature on the current layer
   * Returns true if the tile is occupied, false if it's empty
   */
  function isTileOccupiedOnLayer(mapData, x, y, layer, width, height) {
    // Only check the same layer being filled for occupation
    const idx = calculateIndex(x, y, layer, width, height);
    return mapData[idx] !== 0;
  }

  /**
   * Place a multi-tile feature on the map
   * Checks water collision, beach placement, path tiles, occupied tiles, and bounds
   * Avoids placing if any tile would overlap water, beach, path tiles, or existing features
   * IMPORTANT: Never overwrites Path, PathDesert, or PathIce tiles
   */
  function placeMultiTileFeature(
    mapData,
    grid,
    startX,
    startY,
    layer,
    width,
    height,
    waterTileSet,
    pathTileSet,
    blockedMask
  ) {
    const beachCoordinates = window.ProcGenUtils?.beachCoordinates;

    // Check if placement is valid (no water collision, no beach, no path tiles, no occupied tiles, and within bounds)
    for (let gy = 0; gy < grid.length; gy++) {
      const row = grid[gy];
      for (let gx = 0; gx < row.length; gx++) {
        const mapX = startX + gx;
        const mapY = startY + gy;

        // Check bounds
        if (mapX < 0 || mapX >= width || mapY < 0 || mapY >= height) {
          return false;
        }

        // Caller-supplied no-build zone (e.g. the road keep-out margin)
        if (blockedMask && blockedMask[mapY * width + mapX]) {
          return false;
        }

        // Check if base layer has water
        const baseIdx = calculateIndex(mapX, mapY, 0, width, height);
        const baseTile = mapData[baseIdx];

        if (isWaterTileId(baseTile, waterTileSet)) {
          return false;
        }

        // Check if on beach
        if (beachCoordinates && beachCoordinates.has(`${mapX},${mapY}`)) {
          return false;
        }

        // NEVER overwrite path tiles (Path, PathDesert, PathIce)
        if (pathTileSet && pathTileSet.has(baseTile)) {
          return false;
        }

        // Check if tile is already occupied by a feature on the same layer
        const occupiedIdx = calculateIndex(mapX, mapY, layer, width, height);
        if (mapData[occupiedIdx] !== 0) {
          return false;
        }
      }
    }

    // Placement is valid, place all tiles
    for (let gy = 0; gy < grid.length; gy++) {
      const row = grid[gy];
      for (let gx = 0; gx < row.length; gx++) {
        const mapX = startX + gx;
        const mapY = startY + gy;
        const idx = calculateIndex(mapX, mapY, layer, width, height);
        mapData[idx] = row[gx];
      }
    }

    return true;
  }

  /**
   * Generate noise features while avoiding water tiles and path tiles
   * Supports both single-tile and multi-tile feature variants
   * IMPORTANT: Never overwrites Path, PathDesert, or PathIce tiles
   */
  function generateFeatureNoise(
    mapData,
    featureVariants,
    layer,
    width,
    height,
    seed,
    threshold,
    rng,
    waterTiles,
    pathTiles,
    blockedMask
  ) {
    const scale = 0.05;
    const waterTileSet = waterTiles ? new Set(waterTiles) : null;
    const pathTileSet = pathTiles ? new Set(pathTiles) : null;
    const beachCoordinates = window.ProcGenUtils?.beachCoordinates;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (blockedMask && blockedMask[y * width + x]) continue;
        const noiseValue = smoothNoise(x * scale, y * scale, seed);
        if (noiseValue > threshold) {
          const baseIdx = calculateIndex(x, y, 0, width, height);
          const baseTile = mapData[baseIdx];

          // Skip water tiles, beach tiles, and path tiles
          if (!isWaterTileId(baseTile, waterTileSet) &&
            !(beachCoordinates && beachCoordinates.has(`${x},${y}`)) &&
            !(pathTileSet && pathTileSet.has(baseTile))) {
            const variant = getRandomFeatureVariant(featureVariants, rng);

            if (variant) {
              if (variant.type === "single") {
                // Check if this tile is already occupied by a feature on the same layer
                if (!isTileOccupiedOnLayer(mapData, x, y, layer, width, height)) {
                  const idx = calculateIndex(x, y, layer, width, height);
                  mapData[idx] = variant.tileId;
                }
              } else if (variant.type === "grid") {
                placeMultiTileFeature(
                  mapData,
                  variant.grid,
                  x,
                  y,
                  layer,
                  width,
                  height,
                  waterTileSet,
                  pathTileSet,
                  blockedMask
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * Generate scattered features (trees, rocks, etc) with seeded RNG
   * Supports both single-tile and multi-tile feature variants
   * IMPORTANT: Never overwrites Path, PathDesert, or PathIce tiles
   */
  function generateFeatureScattered(
    mapData,
    featureVariants,
    layer,
    width,
    height,
    seed,
    density,
    rng,
    waterTiles,
    pathTiles,
    blockedMask
  ) {
    const waterTileSet = waterTiles ? new Set(waterTiles) : null;
    const pathTileSet = pathTiles ? new Set(pathTiles) : null;
    const beachCoordinates = window.ProcGenUtils?.beachCoordinates;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (blockedMask && blockedMask[y * width + x]) continue;
        if (rng() < density) {
          const baseIdx = calculateIndex(x, y, 0, width, height);
          const baseTile = mapData[baseIdx];

          // Skip water tiles, beach tiles, and path tiles
          if (!isWaterTileId(baseTile, waterTileSet) &&
            !(beachCoordinates && beachCoordinates.has(`${x},${y}`)) &&
            !(pathTileSet && pathTileSet.has(baseTile))) {
            const variant = getRandomFeatureVariant(featureVariants, rng);

            if (variant) {
              if (variant.type === "single") {
                // Check if this tile is already occupied by a feature on the same layer
                if (!isTileOccupiedOnLayer(mapData, x, y, layer, width, height)) {
                  const idx = calculateIndex(x, y, layer, width, height);
                  mapData[idx] = variant.tileId;
                }
              } else if (variant.type === "grid") {
                placeMultiTileFeature(
                  mapData,
                  variant.grid,
                  x,
                  y,
                  layer,
                  width,
                  height,
                  waterTileSet,
                  pathTileSet,
                  blockedMask
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * Fractional Brownian Motion for complex coastline patterns
   * Creates jagged, realistic coastlines by layering multiple noise octaves
   */
  function fbmNoise(x, y, seed, octaves = 4, lacunarity = 2.0, persistence = 0.6) {
    let amplitude = 1.0;
    let frequency = 1.0;
    let value = 0.0;
    let maxValue = 0.0;

    for (let i = 0; i < octaves; i++) {
      value += smoothNoise(x * frequency, y * frequency, seed + i * 1000) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }



  /**
   * Drunken walk cave carving algorithm
   * Fills a map with walls then carves passages using random walk
   */
  function generateCaveWithDrunkenWalk(width, height, tileWidth, tileCarvingPercentage, seed, caveFloorTile, caveCeilingTile) {
    const rng = createSeededRandom(seed);

    // Calculate number of steps to carve based on percentage
    const totalTiles = width * height;
    const targetCarvedTiles = Math.floor(totalTiles * tileCarvingPercentage);
    let carvedCount = 0;

    // Create a boolean grid to track carved areas
    const carved = Array(height).fill(null).map(() => Array(width).fill(false));

    // Start from a random position
    let x = Math.floor(rng() * width);
    let y = Math.floor(rng() * height);

    // Directions: up, down, left, right
    const directions = [
      { dx: 0, dy: -1 }, // up
      { dx: 0, dy: 1 },  // down
      { dx: -1, dy: 0 }, // left
      { dx: 1, dy: 0 }   // right
    ];

    // Drunken walk
    while (carvedCount < targetCarvedTiles) {
      // Randomly choose a direction
      const dir = directions[Math.floor(rng() * directions.length)];

      // Take a step
      x = (x + dir.dx + width) % width;
      y = (y + dir.dy + height) % height;

      // Mark as carved if not already
      if (!carved[y][x]) {
        carved[y][x] = true;
        carvedCount++;
      }
    }

    // Create the map data array (4 layers)
    const mapData = new Array(tileWidth * height * 4);
    mapData.fill(0);

    // Fill the map with wall/floor tiles based on carved areas
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const tileValue = carved[ty][tx] ? caveFloorTile : caveCeilingTile;

        // Layer 0 (main terrain)
        mapData[calculateIndex(tx, ty, 0, width, height)] = tileValue;
      }
    }

    return mapData;
  }

  /**
   * Cellular automata cave generation algorithm
   * Creates cave systems using cellular automata rules - ideal for flooded caves with natural caverns
   * Starts with ~50% random floor tiles and iterates rules to create connected chambers
   */
  function generateCaveWithCellularAutomata(width, height, tileWidth, seed, caveFloorTile, caveCeilingTile) {
    const rng = createSeededRandom(seed);
    const iterations = 4;  // Number of cellular automata iterations
    const initialFloorChance = 0.48;  // Initial floor probability

    // Initialize grid with random floor/wall tiles
    let grid = Array(height).fill(null).map(() =>
      Array(width).fill(null).map(() => rng() < initialFloorChance)
    );

    // Apply cellular automata rules for specified iterations
    for (let iter = 0; iter < iterations; iter++) {
      const newGrid = Array(height).fill(null).map(() => Array(width).fill(false));

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Count floor neighbors (including diagonals)
          let floorNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;  // Skip self
              const ny = (y + dy + height) % height;
              const nx = (x + dx + width) % width;
              if (grid[ny][nx]) floorNeighbors++;
            }
          }

          // Apply cellular automata rules
          // A tile becomes floor if it has 4+ floor neighbors, otherwise wall
          // This creates connected cave systems
          newGrid[y][x] = floorNeighbors >= 4;
        }
      }

      grid = newGrid;
    }

    // Create the map data array (4 layers)
    const mapData = new Array(tileWidth * height * 4);
    mapData.fill(0);

    // Fill the map with wall/floor tiles
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const tileValue = grid[ty][tx] ? caveFloorTile : caveCeilingTile;
        mapData[calculateIndex(tx, ty, 0, width, height)] = tileValue;
      }
    }

    return mapData;
  }

  /**
   * Voronoi diagram cave generation algorithm
   * Creates cave systems using Voronoi diagrams - ideal for ice caves with geometric chambers
   * Generates seed points and carves floor tiles near those points, creating distinct chambers
   * Also carves diagonal geometric tunnels connecting nearby rooms for traversability
   * Ensures tunnels reach open map edges for global connectivity
   */
  function generateCaveWithVoronoi(width, height, tileWidth, seed, caveFloorTile, caveCeilingTile) {
    const rng = createSeededRandom(seed);
    const numSeeds = Math.floor(width * height / 1500);  // Roughly 1 chamber per 1500 tiles
    const carvingThreshold = 5.5;  // Distance threshold for carving (lower = more carving)
    const tunnelWidth = 1.5;  // Width of connecting tunnels

    // Generate random seed points
    const seeds = [];
    for (let i = 0; i < numSeeds; i++) {
      seeds.push({
        x: Math.floor(rng() * width),
        y: Math.floor(rng() * height),
        index: i
      });
    }

    // Create the map data array (4 layers)
    const mapData = new Array(tileWidth * height * 4);
    mapData.fill(0);

    // For each tile, find nearest seed and determine if it should be carved
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        let minDistance = Infinity;

        // Find distance to nearest seed point
        for (const seed of seeds) {
          const dx = tx - seed.x;
          const dy = ty - seed.y;
          // Use toroidal wrapping for seamless maps
          const wrappedDx = Math.min(Math.abs(dx), width - Math.abs(dx));
          const wrappedDy = Math.min(Math.abs(dy), height - Math.abs(dy));
          const distance = Math.sqrt(wrappedDx * wrappedDx + wrappedDy * wrappedDy);

          if (distance < minDistance) {
            minDistance = distance;
          }
        }

        // Carve if close to a seed point (creating Voronoi cells)
        const tileValue = minDistance <= carvingThreshold ? caveFloorTile : caveCeilingTile;
        mapData[calculateIndex(tx, ty, 0, width, height)] = tileValue;
      }
    }

    // Carve diagonal tunnels connecting nearby rooms
    // Build adjacency graph of nearest neighbors for each seed
    for (let i = 0; i < seeds.length; i++) {
      const currentSeed = seeds[i];
      const neighbors = [];

      // Find closest neighbors to this seed
      for (let j = 0; j < seeds.length; j++) {
        if (i === j) continue;

        const otherSeed = seeds[j];
        const dx = otherSeed.x - currentSeed.x;
        const dy = otherSeed.y - currentSeed.y;
        // Use toroidal distance
        const wrappedDx = Math.abs(dx) < width / 2 ? dx : (dx > 0 ? dx - width : dx + width);
        const wrappedDy = Math.abs(dy) < height / 2 ? dy : (dy > 0 ? dy - height : dy + height);
        const distance = Math.sqrt(wrappedDx * wrappedDx + wrappedDy * wrappedDy);

        neighbors.push({ seed: otherSeed, distance });
      }

      // Sort by distance and keep only closest neighbors
      neighbors.sort((a, b) => a.distance - b.distance);
      // Connect to more neighbors for denser tunnel networks (4-6 instead of 2-3)
      const maxConnections = Math.min(6, Math.ceil(seeds.length / 4));
      const closestNeighbors = neighbors.slice(0, maxConnections);

      // Carve tunnels to closest neighbors (only from lower-index seeds to avoid duplicates)
      for (const neighbor of closestNeighbors) {
        if (i < neighbor.seed.index) {
          carveDiagonalTunnel(
            mapData,
            currentSeed.x,
            currentSeed.y,
            neighbor.seed.x,
            neighbor.seed.y,
            width,
            height,
            caveFloorTile,
            tunnelWidth
          );
        }
      }

      // Add random cross-tunnels to increase connectivity (30% chance per seed)
      if (rng() < 0.3 && neighbors.length > maxConnections) {
        // Pick a random neighbor that wasn't already connected
        const unconnectedNeighbors = neighbors.slice(maxConnections);
        const randomNeighbor = unconnectedNeighbors[Math.floor(rng() * unconnectedNeighbors.length)];

        if (randomNeighbor) {
          carveDiagonalTunnel(
            mapData,
            currentSeed.x,
            currentSeed.y,
            randomNeighbor.seed.x,
            randomNeighbor.seed.y,
            width,
            height,
            caveFloorTile,
            tunnelWidth
          );
        }
      }
    }


    return mapData;
  }

  /**
   * Carve a diagonal tunnel between two points using line rasterization
   * Creates a geometric passage between rooms with specified width
   */
  function carveDiagonalTunnel(mapData, x1, y1, x2, y2, width, height, floorTile, tunnelWidth) {
    // Handle toroidal wrapping - choose shortest path
    let dx = x2 - x1;
    let dy = y2 - y1;

    if (Math.abs(dx) > width / 2) {
      dx = dx > 0 ? dx - width : dx + width;
    }
    if (Math.abs(dy) > height / 2) {
      dy = dy > 0 ? dy - height : dy + height;
    }

    // Calculate actual end point considering wrapping
    let endX = (x1 + dx + width) % width;
    let endY = (y1 + dy + height) % height;

    // Use Bresenham-like line algorithm to carve the tunnel
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps === 0) return;

    for (let step = 0; step <= steps; step++) {
      const t = steps > 0 ? step / steps : 0;
      const currentX = Math.round(x1 + dx * t);
      const currentY = Math.round(y1 + dy * t);

      // Carve a small area around the tunnel line
      const radius = Math.ceil(tunnelWidth);
      for (let ty = currentY - radius; ty <= currentY + radius; ty++) {
        for (let tx = currentX - radius; tx <= currentX + radius; tx++) {
          // Wrap coordinates toroidally
          const wrappedX = (tx % width + width) % width;
          const wrappedY = (ty % height + height) % height;
          const distance = Math.sqrt((tx - currentX) ** 2 + (ty - currentY) ** 2);

          // Carve with falloff for smooth tunnel edges
          if (distance <= tunnelWidth) {
            const idx = calculateIndex(wrappedX, wrappedY, 0, width, height);
            mapData[idx] = floorTile;
          }
        }
      }
    }
  }

  /**
   * Generate mountain terrain using inverted cellular automata
   * Creates mountain peaks and cliff formations using inverted cellular automata
   * Reuses the cellular automata algorithm but inverts the result:
   * - CA floor becomes Ceiling (peaks)
   * - CA walls become open terrain (valleys)
   * Places MountainWall tiles below each ceiling for visual depth
   * Parameters are randomized by world coordinates for regional variation
   */

  /**
   * Generate a random seeded safe zone in the middle of the map
   * Creates either a circular or square safe zone (randomly chosen based on seed)
   * Safe zone prevents mountains from spawning, creating a landing area for teleported players
   * @param {Array<Array<boolean>>} grid - Mountain CA grid to modify
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {number} seed - Seed for randomization
   */
  /**
   * Carve guaranteed traversable corridors through a dense mountain grid.
   *
   * The cellular-automata step produces dense rock; on its own that can box the
   * player in. This pass carves meandering floor corridors from the map center
   * (where players are teleported in) out to a point on each of the four edges,
   * guaranteeing the map can always be crossed both north-south and east-west.
   *
   * grid values: true = floor (walkable), false = wall (mountain).
   */
  function carveMountainTraversalPaths(grid, width, height, seed) {
    const rng = createSeededRandom(seed + 1337);

    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    // Force a small square of floor around a point (path thickness).
    const carveAt = (cx, cy, radius) => {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            grid[ny][nx] = true; // floor - no mountain
          }
        }
      }
    };

    // Carve a meandering corridor from (x1,y1) to (x2,y2). Biased toward the
    // target so it always converges, with occasional perpendicular jogs so the
    // path winds rather than running dead straight.
    const carvePath = (x1, y1, x2, y2, radius) => {
      let x = x1;
      let y = y1;
      let guard = 0;
      const maxSteps = (width + height) * 4;

      while ((x !== x2 || y !== y2) && guard++ < maxSteps) {
        carveAt(x, y, radius);

        const dirX = Math.sign(x2 - x);
        const dirY = Math.sign(y2 - y);

        if (rng() < 0.72) {
          // Step toward the target, alternating axes for a diagonal feel.
          if (dirX !== 0 && (dirY === 0 || rng() < 0.5)) {
            x += dirX;
          } else if (dirY !== 0) {
            y += dirY;
          } else if (dirX !== 0) {
            x += dirX;
          }
        } else {
          // Perpendicular jog for organic winding, kept off the outer ring.
          if (dirX !== 0) {
            y += (rng() < 0.5 ? 1 : -1);
          } else {
            x += (rng() < 0.5 ? 1 : -1);
          }
          x = Math.max(1, Math.min(width - 2, x));
          y = Math.max(1, Math.min(height - 2, y));
        }
      }

      carveAt(x2, y2, radius);
    };

    // Pick an exit point on each edge, offset randomly within the middle band
    // so paths don't always leave from the same spot.
    const edgeSpan = (length) =>
      Math.floor(length * 0.25) + Math.floor(rng() * (length * 0.5));

    const northX = edgeSpan(width);
    const southX = edgeSpan(width);
    const westY = edgeSpan(height);
    const eastY = edgeSpan(height);

    // Path thickness: mostly 3-wide (radius 1), occasionally 5-wide (radius 2).
    const pathRadius = () => (rng() < 0.3 ? 2 : 1);

    carvePath(centerX, centerY, northX, 0, pathRadius());
    carvePath(centerX, centerY, southX, height - 1, pathRadius());
    carvePath(centerX, centerY, 0, westY, pathRadius());
    carvePath(centerX, centerY, width - 1, eastY, pathRadius());
  }

  function applyMountainCenterSafeZone(grid, width, height, seed) {
    const rng = createSeededRandom(seed);

    // Determine safe zone parameters based on seed
    const isCircular = rng() < 0.5;  // 50% chance of circular vs square
    const minRadius = 12;  // Minimum safe zone radius (12-18 tiles)
    const maxRadius = 18;
    const radius = Math.floor(rng() * (maxRadius - minRadius + 1)) + minRadius;

    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    if (isCircular) {
      // Create circular safe zone
      const radiusSquared = radius * radius;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const distSquared = dx * dx + dy * dy;

          // Force to floor (true) if within circle
          if (distSquared <= radiusSquared) {
            grid[y][x] = true;  // true = floor (no mountain)
          }
        }
      }
    } else {
      // Create square safe zone
      const halfRadius = Math.floor(radius / 2);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Check if within square bounds
          const inX = Math.abs(x - centerX) <= halfRadius;
          const inY = Math.abs(y - centerY) <= halfRadius;

          // Force to floor (true) if within square
          if (inX && inY) {
            grid[y][x] = true;  // true = floor (no mountain)
          }
        }
      }
    }
  }

  function generateMountainBiomeTerrain(width, height, tileWidth, seed, mountainCeilingTile, mountainWallTile, baseTerrainData, worldCoords, cliffTiles) {
    const rng = createSeededRandom(seed);

    // Randomize parameters based on world coordinates for regional mountain variety
    const coordSeed = (worldCoords?.x || 0) * 73856093 ^ (worldCoords?.y || 0) * 19349663;
    const coordRng = createSeededRandom(coordSeed);

    // Randomize iterations (2-4): affects how smoothed/carved the mountains are
    // Lower iterations = rougher, more jagged peaks
    // Higher iterations = smoother, more eroded formations
    const iterations = Math.floor(coordRng() * 3) + 2;

    // Randomize initial floor chance (0.40-0.54): affects mountain density
    // Lower = denser mountains with fewer valleys
    // Higher = sparse mountains with more terrain
    // Biased low so mountain biomes read as dense rock with carved passages
    // (guaranteed traversal paths are carved back in below).
    const initialFloorChance = 0.40 + (coordRng() * 0.14);

    // Randomize CA threshold (4-5): affects how connected mountains are
    // 4 = more connected mountain ranges
    // 5 = more isolated peaks with deeper valleys
    // Biased toward 5 for denser, chunkier rock masses.
    const caThreshold = coordRng() < 0.65 ? 5 : 4;

    // Randomize wall heights (1-4 for min, minWallHeight-8 for max)
    // This creates regional variety in cliff steepness
    const minWallHeight = Math.floor(coordRng() * 4) + 1;  // 1-4 tiles minimum
    const maxWallHeight = Math.floor(coordRng() * (8 - minWallHeight + 1)) + minWallHeight;  // minWallHeight-8 tiles maximum

    // Initialize grid with random floor/wall tiles
    let grid = Array(height).fill(null).map(() =>
      Array(width).fill(null).map(() => rng() < initialFloorChance)
    );

    // Apply cellular automata rules for specified iterations
    for (let iter = 0; iter < iterations; iter++) {
      const newGrid = Array(height).fill(null).map(() => Array(width).fill(false));

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Count floor neighbors (including diagonals)
          let floorNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;  // Skip self
              const ny = (y + dy + height) % height;
              const nx = (x + dx + width) % width;
              if (grid[ny][nx]) floorNeighbors++;
            }
          }

          // Apply cellular automata rules
          // A tile becomes floor if it has caThreshold+ floor neighbors, otherwise wall
          // Lower threshold (4) = more connected mountains
          // Higher threshold (5) = more isolated peaks with deeper valleys
          newGrid[y][x] = floorNeighbors >= caThreshold;
        }
      }

      grid = newGrid;
    }

    // Apply varying border safe zones (3-6 tiles) with smooth noise
    // This prevents mountains from appearing at the boundaries where adjacent biomes connect
    // Create a seeded RNG for border noise
    const borderNoiseRng = createSeededRandom(seed + 42);

    // Generate noise-based border widths for all 4 edges (3-6 tiles, varying smoothly)
    // Use subtle multi-frequency harmonics for organic shapes without extreme variations
    const getBorderWidth = (position, borderLength) => {
      const normalizedPos = position / borderLength;

      // Subtle multi-frequency harmonic oscillation
      // Primary wave at 2 cycles - main undulation
      const primaryWave = Math.sin(normalizedPos * Math.PI * 2) * 0.15;
      // Secondary wave at 5 cycles - small jagged detail
      const secondaryWave = Math.sin(normalizedPos * Math.PI * 5) * 0.08;

      // Combine harmonics (total range -0.23 to 0.23)
      const harmonicNoise = primaryWave + secondaryWave;
      const normalizedHarmonic = (harmonicNoise + 0.23) / 0.46;  // Normalize to 0-1

      return 3 + Math.floor(normalizedHarmonic * 3);  // 3-6 tile range
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let isInSafeZone = false;

        // North border - varies based on x position
        const northBorderWidth = getBorderWidth(x, width);
        if (y < northBorderWidth) {
          isInSafeZone = true;
        }

        // South border - varies based on x position
        const southBorderWidth = getBorderWidth(x, width);
        if (y >= height - southBorderWidth) {
          isInSafeZone = true;
        }

        // West border - varies based on y position
        const westBorderWidth = getBorderWidth(y, height);
        if (x < westBorderWidth) {
          isInSafeZone = true;
        }

        // East border - varies based on y position
        const eastBorderWidth = getBorderWidth(y, height);
        if (x >= width - eastBorderWidth) {
          isInSafeZone = true;
        }

        // Force safe zone tiles to be floor (true) - no mountains
        if (isInSafeZone) {
          grid[y][x] = true;  // true = floor (no mountain)
        }
      }
    }

    // Apply random seeded safe zone in the middle of the map
    // Creates circular or square landing area for teleported players
    applyMountainCenterSafeZone(grid, width, height, seed);

    // Carve guaranteed traversable corridors from the center safe zone out to
    // every edge so the now-denser mountains can always be crossed.
    carveMountainTraversalPaths(grid, width, height, seed);

    // Create the map data array (4 layers) - start with base terrain
    const mapData = new Array(tileWidth * height * 4);
    mapData.fill(0);

    // Copy base terrain data (biome floor tiles)
    if (baseTerrainData) {
      for (let i = 0; i < baseTerrainData.length; i++) {
        mapData[i] = baseTerrainData[i];
      }
    }

    // Track which positions have mountain ceilings for wall placement
    const mountainPositions = [];

    // Authoritative "is this cell mountain" record, kept separately from the
    // tile ids painted onto it. The Ceiling tile is commonly 0 for a
    // tileset that never declared one (bare void), so any code downstream
    // that wants to know "is this mountain" can't just compare against
    // mountainCeilingTile/mountainWallTile - a 0 id would also match every
    // untouched/blank cell that has nothing to do with the mountain pass.
    // This mask is set true only where the pass below actually places
    // ceiling or wall, so it stays correct however those tiles are numbered.
    const mountainMask = new Array(width * height).fill(false);

    // First pass: place mountain ceilings (INVERT the cellular automata result)
    // CA walls (false) become mountains (ceiling), CA floors (true) become valleys (base terrain)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Invert: if CA says it's a wall, place mountain ceiling
        if (!grid[y][x]) {
          const idx = calculateIndex(x, y, 0, width, height);
          mapData[idx] = mountainCeilingTile;
          mountainMask[y * width + x] = true;
          mountainPositions.push({ x, y });
        }
      }
    }

    // Convert Ceilings at varying border edges to MountainWalls for cleaner edge appearance
    // This uses the same noise-based border widths as the safe zone
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Get border widths for this position
        const northBorderWidth = getBorderWidth(x, width);
        const southBorderWidth = getBorderWidth(x, width);
        const westBorderWidth = getBorderWidth(y, height);
        const eastBorderWidth = getBorderWidth(y, height);

        let shouldConvertToWall = false;

        // Convert ceilings at the outer edge of each border (innermost safe zone row)
        // North border: at y = northBorderWidth - 1
        if (y === northBorderWidth - 1) {
          shouldConvertToWall = true;
        }
        // South border: at y = height - southBorderWidth
        if (y === height - southBorderWidth) {
          shouldConvertToWall = true;
        }
        // West border: at x = westBorderWidth - 1
        if (x === westBorderWidth - 1) {
          shouldConvertToWall = true;
        }
        // East border: at x = width - eastBorderWidth
        if (x === width - eastBorderWidth) {
          shouldConvertToWall = true;
        }

        if (shouldConvertToWall) {
          const idx = calculateIndex(x, y, 0, width, height);
          if (mapData[idx] === mountainCeilingTile) {
            mapData[idx] = mountainWallTile;
            // Remove this position from mountainPositions since it's now a wall
            const posIndex = mountainPositions.findIndex(pos => pos.x === x && pos.y === y);
            if (posIndex !== -1) {
              mountainPositions.splice(posIndex, 1);
            }
          }
        }
      }
    }

    // Second pass: place walls below each mountain ceiling
    // Ensure every ceiling has at least one wall below it
    for (const pos of mountainPositions) {
      // Create deterministic height based on position for consistency in clusters
      // Use floor division to group nearby tiles: every 2x2 area gets same height
      const heightRegionX = Math.floor(pos.x / 2);
      const heightRegionY = Math.floor(pos.y / 2);
      const heightSeed = createSeededRandom(seed + heightRegionX * 73856093 ^ heightRegionY * 19349663);

      // Determine wall height using region's min/max - same for all ceilings in 2x2 region
      const heightRange = maxWallHeight - minWallHeight + 1;
      const wallHeight = Math.floor(heightSeed() * heightRange) + minWallHeight;

      // Place wall tiles below the ceiling
      let wallPlaced = false;
      for (let dy = 1; dy <= wallHeight; dy++) {
        const wallY = pos.y + dy;
        if (wallY < height) {
          // Skip wall placement if it would be in varying border safe zone
          const northBorderWidth = getBorderWidth(pos.x, width);
          const southBorderWidth = getBorderWidth(pos.x, width);
          const westBorderWidth = getBorderWidth(wallY, height);
          const eastBorderWidth = getBorderWidth(wallY, height);

          const isNearNorthEdge = wallY < northBorderWidth;
          const isNearSouthEdge = wallY >= height - southBorderWidth;
          const isNearWestEdge = pos.x < westBorderWidth;
          const isNearEastEdge = pos.x >= width - eastBorderWidth;

          if (!(isNearNorthEdge || isNearSouthEdge || isNearWestEdge || isNearEastEdge)) {
            const idx = calculateIndex(pos.x, wallY, 0, width, height);
            const currentTile = mapData[idx];

            // Only place wall if the position isn't occupied by another mountain ceiling
            // Walls can overwrite base terrain to ensure ceiling always has support
            if (currentTile !== mountainCeilingTile) {
              mapData[idx] = mountainWallTile;
              mountainMask[wallY * width + pos.x] = true;
              wallPlaced = true;
            }
          }
        }
      }

      // Guarantee at least one wall below ceiling if none was placed
      // (e.g., if ceiling is at bottom edge or surrounded by other ceilings)
      // Also respect the varying border safe zones around border
      if (!wallPlaced && pos.y + 1 < height) {
        const wallY = pos.y + 1;
        const northBorderWidth = getBorderWidth(pos.x, width);
        const southBorderWidth = getBorderWidth(pos.x, width);
        const westBorderWidth = getBorderWidth(wallY, height);
        const eastBorderWidth = getBorderWidth(wallY, height);

        const isNearNorthEdge = wallY < northBorderWidth;
        const isNearSouthEdge = wallY >= height - southBorderWidth;
        const isNearWestEdge = pos.x < westBorderWidth;
        const isNearEastEdge = pos.x >= width - eastBorderWidth;

        // Only place guarantee wall if it's not in the safe zone
        if (!(isNearNorthEdge || isNearSouthEdge || isNearWestEdge || isNearEastEdge)) {
          const idx = calculateIndex(pos.x, wallY, 0, width, height);
          if (mapData[idx] !== mountainCeilingTile) {
            mapData[idx] = mountainWallTile;
            mountainMask[wallY * width + pos.x] = true;
          }
        }
      }
    }

    // Cliff-wall retexture pass. Without directional wall tiles every mountain
    // cell is the same rock tile, so a mountain mass reads as one flat blob. When
    // MountainLeft / MountainCenter / MountainRight are supplied we keep the plain
    // Ceiling tile on the TOP cap (a cell with open terrain directly above) and
    // redraw the cliff FACE below it - Left at the left edge of the face, Right at
    // the right edge, Center in between - so the wall gets proper corners.
    if (cliffTiles && cliffTiles.center) {
      // Snapshot which layer-0 tiles are mountain BEFORE rewriting, so neighbour
      // classification is not contaminated by tiles changed earlier in the pass.
      const isMt = new Array(width * height).fill(false);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const t = mapData[calculateIndex(x, y, 0, width, height)];
          // Guard against a 0 ceiling/wall id (feature missing) matching empty tiles.
          isMt[y * width + x] = t !== 0 && (t === mountainCeilingTile || t === mountainWallTile);
        }
      }

      const left  = cliffTiles.left  || cliffTiles.center;
      const right = cliffTiles.right || cliffTiles.center;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!isMt[y * width + x]) continue;

          // Top cap: open terrain directly above -> leave the Ceiling tile as-is.
          if (!(y > 0 && isMt[(y - 1) * width + x])) continue;

          // Cliff face: directional wall tile chosen from the horizontal face run.
          const leftMt  = x > 0         && isMt[y * width + (x - 1)];
          const rightMt = x < width - 1 && isMt[y * width + (x + 1)];
          const idx = calculateIndex(x, y, 0, width, height);
          if (!leftMt && rightMt)      mapData[idx] = left;
          else if (leftMt && !rightMt) mapData[idx] = right;
          else                         mapData[idx] = cliffTiles.center; // middle / lone
        }
      }
    }

    // Expose the authoritative mountain/ceiling record so callers (feature
    // scattering, prefab placement) can test "is this cell mountain" by
    // position instead of by tile id.
    mapData.mountainMask = mountainMask;

    return mapData;
  }

  // ===== BSP DUNGEON GENERATOR =====

  /**
   * Binary Space Partition dungeon generator
   * Creates structured dungeons with rooms and corridors
   * Returns a 2D grid where true = carving (floor/corridor), false = wall
   */
  function generateDungeonBSP(width, height, seed, minRoomSize = 8, maxRoomSize = 16) {
    const rng = createSeededRandom(seed);
    const carved = Array(height).fill(null).map(() => Array(width).fill(false));
    const rooms = [];
    // Mouths (first tile outside the room it leaves) of any deliberately
    // 1-tile-wide corridor segment, so callers can gate the start of a narrow
    // passage with a door. { x, y, horizontal }
    const narrowCorridors = [];

    class BSPNode {
      constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.left = null;
        this.right = null;
        this.room = null;
      }
    }

    /**
     * Create a room at this node. Width/height are rolled independently (and
     * occasionally stretched into a long hall) so rooms read as varied
     * rectangles rather than uniform squares.
     */
    function createRoom(node) {
      const minW = Math.max(3, minRoomSize);
      const maxW = Math.min(node.width - 2, maxRoomSize);
      const minH = Math.max(3, minRoomSize);
      const maxH = Math.min(node.height - 2, maxRoomSize);

      let roomWidth = minW + Math.floor(rng() * (maxW - minW + 1));
      let roomHeight = minH + Math.floor(rng() * (maxH - minH + 1));
      if (rng() < 0.25 && maxW > minW && maxH > minH) {
        // Long hall: stretch one axis near its max while the other stays lean.
        if (rng() < 0.5) {
          roomWidth = maxW;
          roomHeight = Math.max(minH, Math.floor(minH + (maxH - minH) * 0.3));
        } else {
          roomHeight = maxH;
          roomWidth = Math.max(minW, Math.floor(minW + (maxW - minW) * 0.3));
        }
      }

      const roomX = node.x + 1 + Math.floor(rng() * Math.max(1, node.width - roomWidth - 2));
      const roomY = node.y + 1 + Math.floor(rng() * Math.max(1, node.height - roomHeight - 2));

      // Rounded look: chamfer the four corners, scaled to room size (0 for
      // small rooms so tiny chambers never lose their doorway tiles).
      const chamfer = Math.min(3, Math.floor(Math.min(roomWidth, roomHeight) / 4));

      node.room = { x: roomX, y: roomY, width: roomWidth, height: roomHeight, chamfer };
      return node.room;
    }

    /**
     * Carve room into the grid. A chamfer > 0 cuts a diagonal wedge off each
     * corner (octagon-style) instead of a plain rectangle.
     */
    function carveRoom(room) {
      const c = room.chamfer || 0;
      for (let y = room.y; y < room.y + room.height; y++) {
        for (let x = room.x; x < room.x + room.width; x++) {
          if (y < 0 || y >= height || x < 0 || x >= width) continue;
          if (c > 0) {
            const lx = x - room.x, ly = y - room.y;
            const rx = (room.width - 1) - lx, ry = (room.height - 1) - ly;
            const cornerCut = (lx + ly < c) || (rx + ly < c) || (lx + ry < c) || (rx + ry < c);
            if (cornerCut) continue;
          }
          carved[y][x] = true;
        }
      }
    }

    /**
     * Carve a corridor between two points with a randomized thickness (mostly
     * 2-3 tiles, occasionally a deliberately narrow 1-tile passage). Narrow
     * segments are recorded so a caller can gate them with a door event.
     */
    function carveCorridor(x1, y1, x2, y2) {
      const roll = rng();
      const thick = roll < 0.15 ? 1 : (roll < 0.65 ? 2 : 3);
      const half = Math.floor((thick - 1) / 2);

      const stampH = (xa, xb, y) => {
        const a = Math.min(xa, xb), b = Math.max(xa, xb);
        for (let x = a; x <= b; x++)
          for (let t = -half; t < thick - half; t++)
            if (y + t >= 0 && y + t < height && x >= 0 && x < width) carved[y + t][x] = true;
      };
      const stampV = (ya, yb, x) => {
        const a = Math.min(ya, yb), b = Math.max(ya, yb);
        for (let y = a; y <= b; y++)
          for (let t = -half; t < thick - half; t++)
            if (y >= 0 && y < height && x + t >= 0 && x + t < width) carved[y][x + t] = true;
      };

      // Random walk horizontally first or vertically first
      if (rng() > 0.5) {
        stampH(x1, x2, y1);
        stampV(y1, y2, x2);
        if (thick === 1) {
          pushMouth(corridorMouth(x1, y1, x2, y1, true));
          pushMouth(corridorMouth(x2, y2, x2, y1, false));
        }
      } else {
        stampV(y1, y2, x1);
        stampH(x1, x2, y2);
        if (thick === 1) {
          pushMouth(corridorMouth(x1, y1, x1, y2, false));
          pushMouth(corridorMouth(x2, y2, x1, y2, true));
        }
      }
    }

    /**
     * Mouth of a corridor segment: walking from a room centre (fx, fy) towards
     * the far end, the first tile that no longer sits inside any room. A door
     * belongs there - at the START of the narrow passage, where it leaves the
     * room - never halfway down the corridor.
     */
    function insideAnyRoom(x, y) {
      return rooms.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    }

    function corridorMouth(fx, fy, tx, ty, horizontal) {
      const step = horizontal ? Math.sign(tx - fx) : Math.sign(ty - fy);
      if (!step) return null;
      const len = horizontal ? Math.abs(tx - fx) : Math.abs(ty - fy);
      for (let i = 0; i <= len; i++) {
        const x = horizontal ? fx + step * i : fx;
        const y = horizontal ? fy : fy + step * i;
        if (!insideAnyRoom(x, y)) return { x, y, horizontal };
      }
      return null;
    }

    function pushMouth(spot) {
      if (spot) narrowCorridors.push(spot);
    }

    /**
     * Recursively split the dungeon
     */
    function split(node, depth = 0) {
      if (node.width < minRoomSize * 2 || node.height < minRoomSize * 2) {
        createRoom(node);
        carveRoom(node.room);
        rooms.push(node.room);
        return;
      }

      // Choose split direction
      const splitVertical = node.width > node.height || (node.width === node.height && rng() > 0.5);

      if (splitVertical) {
        const splitX = node.x + minRoomSize + Math.floor(rng() * (node.width - minRoomSize * 2));
        node.left = new BSPNode(node.x, node.y, splitX - node.x, node.height);
        node.right = new BSPNode(splitX, node.y, node.x + node.width - splitX, node.height);
      } else {
        const splitY = node.y + minRoomSize + Math.floor(rng() * (node.height - minRoomSize * 2));
        node.left = new BSPNode(node.x, node.y, node.width, splitY - node.y);
        node.right = new BSPNode(node.x, splitY, node.width, node.y + node.height - splitY);
      }

      split(node.left, depth + 1);
      split(node.right, depth + 1);

      // Connect rooms with corridors. Internal children hold no room of their
      // own, so use a representative room propagated up from their subtree;
      // without this whole partitions stay unreachable.
      if (node.left && node.right && node.left.room && node.right.room) {
        const leftRoom = node.left.room;
        const rightRoom = node.right.room;
        const leftCenterX = leftRoom.x + Math.floor(leftRoom.width / 2);
        const leftCenterY = leftRoom.y + Math.floor(leftRoom.height / 2);
        const rightCenterX = rightRoom.x + Math.floor(rightRoom.width / 2);
        const rightCenterY = rightRoom.y + Math.floor(rightRoom.height / 2);

        carveCorridor(leftCenterX, leftCenterY, rightCenterX, rightCenterY);
      }

      // Bubble a room up this node so ancestors can connect through it.
      node.room = node.left.room || node.right.room;
    }

    // Generate the dungeon
    const root = new BSPNode(0, 0, width, height);
    split(root);

    return { carved, rooms, narrowCorridors };
  }

  /**
   * Generate dungeon from BSP layout and map it to tiles
   * Returns mapData array with dungeon layout
   */
  function generateDungeonWithBSP(width, height, mapWidth, seed, minRoomSize, maxRoomSize, dungeonFloorTile, dungeonWallTile) {
    const { carved } = generateDungeonBSP(width, height, seed, minRoomSize, maxRoomSize);

    // Create the map data array (4 layers)
    const mapData = new Array(mapWidth * height * 4);
    mapData.fill(0);

    // Fill the map with wall/floor tiles based on carved areas
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const tileValue = carved[ty][tx] ? dungeonFloorTile : dungeonWallTile;
        // Layer 0 (main terrain)
        mapData[calculateIndex(tx, ty, 0, width, height)] = tileValue;
      }
    }

    return mapData;
  }

  // ===== FEATURE MANAGEMENT UTILITIES =====

  /**
   * Get terrain features (terrain: true) from biome
   * Returns array of {name, density} objects
   */
  function getTerrainFeatures(biome) {
    return biome.features
      .filter(f => {
        const isTerrainFeature = typeof f === 'object' && f.terrain === true;
        return isTerrainFeature;
      })
      .map(f => {
        const density = typeof f === 'object' && f.density ? f.density : 1;
        return { name: f.name, density };
      });
  }

  /**
   * Get features by layer efficiently
   * Handles both old (string) and new (object) feature formats for compatibility
   * Returns array of {name, density} objects
   * Excludes terrain features (those with terrain: true)
   * Requires FEATURE_LAYERS to be defined
   */
  function getFeaturesByLayer(biome, allFeatures, layer, featureLayers) {
    return biome.features
      .map(f => {
        // Support both old string format and new object format
        const featureName = typeof f === 'string' ? f : f.name;
        const density = typeof f === 'object' && f.density ? f.density : 1;
        const isTerrainFeature = typeof f === 'object' && f.terrain === true;
        return { name: featureName, density, terrain: isTerrainFeature };
      })
      .filter(f => featureLayers[f.name] === layer && allFeatures[f.name] && !f.terrain);
  }

  /**
   * Create a mapping from tile IDs to feature names
   * Handles both single-tile and multi-tile feature variants
   */
  function createTileToFeatureMap(allFeatures) {
    const tileToFeature = {};
    for (const [featureName, variants] of Object.entries(allFeatures)) {
      if (!Array.isArray(variants)) continue;

      for (const variant of variants) {
        if (variant.type === "single" && variant.tileId) {
          tileToFeature[variant.tileId] = featureName;
        } else if (variant.type === "grid" && variant.grid) {
          // For grid features, map all tiles in the grid
          for (const row of variant.grid) {
            for (const tileId of row) {
              tileToFeature[tileId] = featureName;
            }
          }
        }
      }
    }
    return tileToFeature;
  }

  /**
   * Get feature name from tile ID, including A5 autotile recognition
   */
  function getFeatureNameFromTileId(tileId, tileToFeature) {
    // First check if it's in the feature map
    if (tileToFeature[tileId]) {
      return tileToFeature[tileId];
    }

    // Recognize A5 autotiles by ID range (1536-1663)
    if (tileId >= 1536 && tileId <= 1663) {
      const index = tileId - 1536;
      return `A5 ${index}`;
    }

    // Recognize other extended tiles
    if (tileId >= 2048) {
      const progressiveId = getTileIdToProgressiveId(tileId);
      if (progressiveId >= 0) {
        return `Extended ${progressiveId}`;  // i18n-ignore  tile debug label
      }
    }

    return "Unknown";  // i18n-ignore  tile debug label
  }

  // ===== SPATIAL & MATH UTILITIES =====

  /**
   * Calculate how much a specific adjacent biome should influence a position
   * Uses global Perlin noise based on world coordinates for organic, non-triangular blending
   */
  function calculateDirectionalInfluence(x, y, direction, width, height, seed, blendScale, worldX = 0, worldY = 0) {
    // Calculate distance from edge to determine blend zone. Doing this cheap
    // check first lets us skip the 4-octave fBm entirely when the tile is
    // outside the blend zone. fBm is a pure noise lookup (no RNG stream), so
    // this reorder does not change any seeded sequence.
    let distFromEdge;
    switch (direction) {
      case "north":
        distFromEdge = y;
        break;
      case "south":
        distFromEdge = height - 1 - y;
        break;
      case "east":
        distFromEdge = width - 1 - x;
        break;
      case "west":
        distFromEdge = x;
        break;
      default:
        return 0;
    }

    // Blend zone: only blend in the outer ~45% of the map from this edge
    const blendDepth = Math.floor(width * 0.45);
    if (distFromEdge >= blendDepth) {
      return 0; // Outside blend zone
    }

    // Calculate global coordinates (world tile position + local position within map)
    const globalX = worldX * width + x;
    const globalY = worldY * height + y;

    // Use global fractal (fBm) noise to create organic blend patterns across the
    // entire world. Multiple octaves make borders interlock with fingers/islands
    // instead of a single clean band. Different noise layers per direction avoid
    // correlation between opposite edges.
    const directionSeed = seed + direction.charCodeAt(0) * 1000;
    const noiseValue = fbmNoise(globalX * blendScale, globalY * blendScale, directionSeed, 4, 2.0, 0.6);

    // Map noise from [-1, 1] to [0, 1]
    const normalizedNoise = Math.max(0, Math.min(1, (noiseValue + 1) / 2));

    // Edge falloff eased with smoothstep so the transition ramps in gently at the
    // inner boundary and out at the very edge, avoiding the hard linear seam the
    // previous straight ramp produced.
    const t = 1 - distFromEdge / blendDepth; // 1 at the edge, 0 at inner boundary
    const edgeFalloff = t * t * (3 - 2 * t);

    // Combine noise with edge falloff for final influence
    // Noise determines IF we blend, edge falloff determines HOW MUCH
    const influence = normalizedNoise * edgeFalloff;

    // Scale to a reasonable blending rate (subtle but visible)
    return influence * 0.4;
  }

  /**
   * Select a terrain feature from adjacent biome using weighted density
   * Returns a tile ID or null
   */
  // Cumulative-weight cache keyed by the terrainFeatures array identity (the
  // per-biome feature list is stable during a generation pass).
  const _weightedFeatureCache = new WeakMap();

  function getWeightedTerrainFeature(terrainFeatures, allFeatures, rng) {
    if (terrainFeatures.length === 0) return null;

    // Precompute cumulative integer weights once per terrainFeatures list
    // instead of materializing a ~1000-element expanded array every call, then
    // pick via a single RNG draw + binary search. This consumes the exact same
    // one RNG draw and resolves to the same feature the expanded-array
    // randomChoice() would for that draw value.
    let entry = _weightedFeatureCache.get(terrainFeatures);
    if (!entry) {
      const totalDensity = terrainFeatures.reduce((sum, f) => sum + f.density, 0);
      const cum = new Array(terrainFeatures.length);
      let acc = 0;
      for (let i = 0; i < terrainFeatures.length; i++) {
        acc += Math.round((terrainFeatures[i].density / totalDensity) * 1000);
        cum[i] = acc;
      }
      entry = { cum, total: acc };
      _weightedFeatureCache.set(terrainFeatures, entry);
    }

    const { cum, total } = entry;
    let selectedFeatureName;
    if (total > 0) {
      // randomChoice(weightedFeatures, rng): index into the length-`total`
      // expanded array (one rng draw), mapped back to its feature.
      const idx = Math.floor(rng() * total);
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] > idx) hi = mid; else lo = mid + 1;
      }
      selectedFeatureName = terrainFeatures[lo].name;
    } else {
      // Empty/degenerate weights: randomChoice([]) returns 0 without an rng draw.
      selectedFeatureName = 0;
    }

    // Get single-tile variants for this feature
    const featureVariants = allFeatures[selectedFeatureName];
    if (!featureVariants || featureVariants.length === 0) return null;

    const singleTileVariants = featureVariants.filter(v => v.type === "single" && v.tileId);
    if (singleTileVariants.length === 0) return null;

    return randomChoice(singleTileVariants, rng).tileId;
  }

  // ===== FORBIDDEN ZONE UTILITIES =====

  /**
   * Check if a tile position is in a forbidden zone (borders or center)
   * Border: 1 tile from edge
   * Center: 6x6 square around map center (29-34, 29-34 on 64x64 map)
   */
  function isInForbiddenZone(x, y, width, height) {
    // Border check (1 tile from edge)
    if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) {
      return true;
    }

    // Center 6x6 square check
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const centerRange = 3; // 6x6 square = 3 tiles in each direction from center

    if (x >= centerX - centerRange && x <= centerX + centerRange &&
      y >= centerY - centerRange && y <= centerY + centerRange) {
      return true;
    }

    return false;
  }

  /**
   * Check if a multi-tile feature would fit entirely in allowed zones
   * Returns true if ANY part of the feature overlaps forbidden zones
   */
  function doesMultiTileFeatureOverlapForbidden(grid, startX, startY, width, height) {
    if (!grid || grid.length === 0) return false;

    const gridHeight = grid.length;
    const gridWidth = grid[0].length;

    // Check all tiles in the feature grid
    for (let dy = 0; dy < gridHeight; dy++) {
      for (let dx = 0; dx < gridWidth; dx++) {
        const checkX = startX + dx;
        const checkY = startY + dy;

        // Check if this feature tile would be in a forbidden zone
        if (isInForbiddenZone(checkX, checkY, width, height)) {
          return true; // Overlaps forbidden zone
        }
      }
    }

    return false; // Safe to place
  }

  /**
   * Remove features from forbidden zones in the map
   */
  function clearForbiddenZoneFeatures(mapData, width, height) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isInForbiddenZone(x, y, width, height)) {
          // Clear all layers except base terrain (layer 0)
          for (let z = 1; z <= 3; z++) {
            const idx = calculateIndex(x, y, z, width, height);
            mapData[idx] = 0;
          }
        }
      }
    }
  }

  // ===== DEBUG & VISUALIZATION UTILITIES =====

  /**
   * Generate ASCII visualization of the map
   * featureAscii is optional; if not provided, uses '?' for all features
   */
  function generateAsciiVisualization(mapData, width, height, tileToFeature, featureAscii) {
    const asciiMap = [];
    const previewWidth = Math.min(width, 128);
    const previewHeight = Math.min(height, 64);
    const ascii = featureAscii || {}; // Default to empty object if not provided

    for (let y = 0; y < previewHeight; y++) {
      let row = "";
      for (let x = 0; x < previewWidth; x++) {
        const idx = calculateIndex(x, y, 0, width, height);
        const tileId = mapData[idx];
        const featureName = getFeatureNameFromTileId(tileId, tileToFeature);
        row += ascii[featureName] || "?";
      }
      asciiMap.push(row);
    }

    return asciiMap;
  }

  /**
   * Get arrow character for direction(s)
   */
  function getArrowForDirection(directions) {
    if (!directions || directions.length === 0) return "·";
    if (directions.length === 1) {
      switch (directions[0]) {
        case "north": return "↑";
        case "south": return "↓";
        case "east": return "→";
        case "west": return "←";
      }
    }
    if (directions.length === 2) {
      const dirs = new Set(directions);
      if (dirs.has("north") && dirs.has("east")) return "↗";
      if (dirs.has("north") && dirs.has("west")) return "↖";
      if (dirs.has("south") && dirs.has("east")) return "↘";
      if (dirs.has("south") && dirs.has("west")) return "↙";
      if (dirs.has("north") && dirs.has("south")) return "↕";
      if (dirs.has("east") && dirs.has("west")) return "↔";
    }
    if (directions.length === 3) return "⊕";
    if (directions.length === 4) return "✦";
    return "?";
  }

  /**
   * Build a complete biome coordinate cache for all biomes on world map
   * @param {Object} gameSystem - Reference to $gameSystem
   * @param {Object} gameMap - Reference to $gameMap
   * @param {number} worldMapId - ID of the world map
   * @returns {Object} Cache object mapping biome names to coordinate arrays
   */
  function buildBiomeCoordinateCache(gameSystem, gameMap, worldMapId) {
    if (!gameMap || gameMap.mapId() !== worldMapId) {
      logWarn("buildBiomeCoordinateCache: Not on world map, skipping cache build");
      return {};
    }

    // Try preloading from BiomesMap.json if the option is enabled.
    //
    // Never for a Test player: BiomesMap.json is a snapshot of map 315 taken at
    // export time, and during playtesting the world map is exactly what is being
    // edited. A snapshot that predates a repaint describes a world that no longer
    // exists (biomes, roads and rivers all land on the wrong coordinates), so the
    // tiles are rescanned instead.
    if (PRELOAD_BIOMES_MAP && !isTestPlayer()) {
      const loaded = loadBiomesMapFromFile();
      if (loaded && loaded.biomeCoordinateCache && Object.keys(loaded.biomeCoordinateCache).length > 0) {
        const cache = loaded.biomeCoordinateCache;
        if (gameSystem && gameSystem._procGenData) {
          gameSystem._procGenData.biomeCoordinateCache = cache;
          if (loaded.roadDirections) {
            gameSystem._procGenData.precomputedRoadDirections = loaded.roadDirections;
          }
          if (loaded.riverDirections) {
            gameSystem._procGenData.precomputedRiverDirections = loaded.riverDirections;
          }
          // riverCoords: "x,y" -> water tile id for every coord where a river is
          // painted over a land biome (drawn as an overlay inside that biome).
          gameSystem._procGenData.riverCoordMap = loaded.riverCoords || {};
          // bridgeCoords may be absent in snapshots exported before bridges
          // existed; leaving it undefined makes the generator rescan the tiles
          // rather than silently reporting no crossings.
          if (loaded.bridgeCoords) {
            gameSystem._procGenData.bridgeCoordMap = loaded.bridgeCoords;
          }
        }
        log(`buildBiomeCoordinateCache: Loaded from BiomesMap.json (${Object.keys(cache).length} biomes)`);
        return cache;
      }
      logWarn("buildBiomeCoordinateCache: Preload failed or empty, falling back to tile scan");
    }

    const cache = {};
    const mapWidth = gameMap.width();
    const mapHeight = gameMap.height();

    // Initialize cache for all known biomes
    for (const biome of Biomes) {
      cache[biome.name] = [];
    }

    // Iterate through all world coordinates
    const riverCoordMap = {};
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const cls = classifyWorldColumn((z) => gameMap.tileId(x, y, z));
        const biomeName = cls.biome;
        if (biomeName) {
          if (!cache[biomeName]) {
            cache[biomeName] = [];
          }
          cache[biomeName].push({ x, y });
        }
        if (cls.riverTileId) riverCoordMap[`${x},${y}`] = cls.riverTileId;
      }
    }

    // Store cache in game system
    if (gameSystem && gameSystem._procGenData) {
      gameSystem._procGenData.biomeCoordinateCache = cache;
      gameSystem._procGenData.riverCoordMap = riverCoordMap;
    }

    const totalCoords = Object.values(cache).reduce(
      (sum, arr) => sum + arr.length,
      0
    );
    log(`buildBiomeCoordinateCache: Built cache with ${totalCoords} total coordinates`);

    // Export to BiomesMap.json if the option is enabled
    if (EXPORT_BIOMES_MAP) {
      exportBiomesMapToFile(cache, riverCoordMap);
    }

    return cache;
  }

  /**
   * Get biome from world coordinates by checking tile layers
   * @param {Object} gameMap - Reference to $gameMap
   * @param {number} x - World X coordinate
   * @param {number} y - World Y coordinate
   * @returns {string} Biome name
   */
  function getBiomeFromWorldCoordinates(gameMap, x, y) {
    return classifyWorldColumn((z) => gameMap.tileId(x, y, z)).biome;
  }

  /**
   * Get biome from cache with proper fallback to world map lookup
   * @param {Object} cache - The biome coordinate cache
   * @param {number} x - World X coordinate
   * @param {number} y - World Y coordinate
   * @param {Object} gameMap - Reference to $gameMap
   * @param {number} worldMapId - ID of the world map
   * @returns {string} Biome name
   */
  // O(1) biome lookup index, built lazily from the biomeCoordinateCache and
  // rebuilt whenever a different cache object is passed in. Kept in module scope
  // so it is never serialized; mirrors the index in ProceduralMapBiomeGenerator.
  let _biomeFallbackIndex = null; // Map<number, string>
  let _biomeFallbackIndexSource = null;

  function getBiomeFallbackIndex(cache) {
    if (!cache) return null;
    if (_biomeFallbackIndex && _biomeFallbackIndexSource === cache) {
      return _biomeFallbackIndex;
    }
    const index = new Map();
    for (const biomeName in cache) {
      const coords = cache[biomeName];
      if (!coords) continue;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const key = c.x * 100000 + c.y;
        // First biome wins, matching the previous Object.entries scan order.
        if (!index.has(key)) index.set(key, biomeName);
      }
    }
    _biomeFallbackIndex = index;
    _biomeFallbackIndexSource = cache;
    return index;
  }

  // O(1) coord -> [biomeNames] index (all biomes occupying a coordinate, deduped
  // in cache insertion order). Used by the border/diagonal scans below. Built
  // lazily and rebuilt whenever a different cache object is passed in.
  let _biomeMultiIndex = null; // Map<number, string[]>
  let _biomeMultiIndexSource = null;

  function getBiomeMultiIndex(cache) {
    if (!cache) return null;
    if (_biomeMultiIndex && _biomeMultiIndexSource === cache) {
      return _biomeMultiIndex;
    }
    const index = new Map();
    for (const biomeName in cache) {
      const coords = cache[biomeName];
      if (!coords) continue;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const key = c.x * 100000 + c.y;
        let arr = index.get(key);
        if (!arr) { arr = []; index.set(key, arr); }
        // Match the previous Object.entries()+includes() dedup semantics.
        if (arr.indexOf(biomeName) === -1) arr.push(biomeName);
      }
    }
    _biomeMultiIndex = index;
    _biomeMultiIndexSource = cache;
    return index;
  }

  function getBiomeFromCacheWithFallback(cache, x, y, gameMap, worldMapId) {
    // First, try to find the coordinate in the cache (O(1) via the index)
    const index = getBiomeFallbackIndex(cache);
    if (index) {
      const biomeName = index.get(x * 100000 + y);
      if (biomeName) return biomeName;
    }

    // If not in cache and we're on the world map, look up from world map directly
    if (gameMap && gameMap.mapId() === worldMapId) {
      return getBiomeFromWorldCoordinates(gameMap, x, y);
    }

    // Final fallback to Fields
    return "Fields";
  }

  // ===== BIOMES MAP FILE I/O =====

  function getBiomesMapFilePath() {
    try {
      const path = require("path");
      return path.join(process.cwd(), "js", "db", "WorldGen", "BiomesMap.json");
    } catch (e) {
      return null;
    }
  }

  function loadBiomesMapFromFile() {
    try {
      const fs = require("fs");
      const filePath = getBiomesMapFilePath();
      if (!filePath) return null;
      if (!fs.existsSync(filePath)) {
        log("loadBiomesMapFromFile: BiomesMap.json not found, falling back to tile scan");
        return null;
      }
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      log(`loadBiomesMapFromFile: Loaded BiomesMap.json v${data.version} (${data.generatedAt})`);
      return data;
    } catch (e) {
      logWarn(`loadBiomesMapFromFile: Failed, ${e.message}`);
      return null;
    }
  }

  function exportBiomesMapToFile(cache, riverCoordMap, bridgeCoordMap) {
    try {
      const Roads = window.ProcGenRoads;
      const Rivers = window.ProcGenRivers;
      const roadDirections = {};
      const riverDirections = {};

      for (const [biomeName, coords] of Object.entries(cache)) {
        const isRoad = Roads && Roads.isRoadBiome(biomeName);
        const isRiver = Rivers && Rivers.isRiverBiome(biomeName);
        if (!isRoad && !isRiver) continue;

        for (const coord of coords) {
          const adj = getAdjacentBiomesFromCache(coord.x, coord.y, cache);
          const normalized = {
            north: normalizeBiomeForEdge(adj.north),
            south: normalizeBiomeForEdge(adj.south),
            east: normalizeBiomeForEdge(adj.east),
            west: normalizeBiomeForEdge(adj.west),
          };
          if (isRoad) {
            roadDirections[`${coord.x},${coord.y}`] = Roads.determineRoadIntersectionType(normalized, Roads.isRoadBiome);
          }
          if (isRiver) {
            riverDirections[`${coord.x},${coord.y}`] = Rivers.determineRiverIntersectionType(normalized, Rivers.isRiverBiome);
          }
        }
      }

      const exportData = {
        version: 1,
        generatedAt: new Date().toISOString(),
        biomeCoordinateCache: cache,
        roadDirections,
        riverDirections,
        riverCoords: riverCoordMap || {},
        // "x,y" -> "vertical" / "horizontal" for every bridge marker. Without it
        // a preloaded snapshot reports no river crossings at all.
        bridgeCoords: bridgeCoordMap || {},
      };

      const fs = require("fs");
      const filePath = getBiomesMapFilePath();
      if (!filePath) return;
      fs.writeFileSync(filePath, JSON.stringify(exportData), "utf8");
      console.log(`[ProcGen] BiomesMap.json exported to ${filePath}`);
    } catch (e) {
      console.error(`[ProcGen] Failed to export BiomesMap.json: ${e.message}`);
    }
  }

  // ===== WORLD MAP (315) SLIM EVENT INDEX =====
  // Map315.json is ~1.3MB (256x256 = 393k tile entries) but most consumers only
  // need its ~206 events (Teleport - X, CountryName, ...). Parsing the whole file
  // with a synchronous XHR blocks the main thread. We extract a slim
  // [{id, name, x, y}] array once, cache it in module scope, and persist it to
  // js/db/WorldGen/WorldEvents315.json so future sessions skip the big parse.
  let _worldMapEventIndex = null;

  function getWorldEventsFilePath() {
    try {
      const path = require("path");
      return path.join(process.cwd(), "js", "db", "WorldGen", "WorldEvents315.json");
    } catch (e) {
      return null;
    }
  }

  function slimMapEvents(events) {
    const slim = [];
    if (!events) return slim;
    for (const ev of events) {
      if (!ev) continue;
      slim.push({ id: ev.id, name: ev.name || "", x: ev.x, y: ev.y });
    }
    return slim;
  }

  function mapFileName(mapId) {
    let id = String(mapId);
    while (id.length < 3) id = "0" + id;
    return "Map" + id + ".json";  // i18n-ignore  data file name
  }

  // Returns the world map's events as a slim [{id, name, x, y}] array.
  function getWorldMapEvents() {
    if (_worldMapEventIndex) return _worldMapEventIndex;

    // 1. If the world map is the active map, its events are already in memory.
    try {
      if (typeof $dataMap !== "undefined" && $dataMap &&
          $dataMap.id === WORLD_MAP_ID && $dataMap.events) {
        _worldMapEventIndex = slimMapEvents($dataMap.events);
        return _worldMapEventIndex;
      }
    } catch (e) {}

    // 2. Try the cached slim file in the world folder.
    try {
      const fs = require("fs");
      const filePath = getWorldEventsFilePath();
      if (filePath && fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (data && Array.isArray(data.events)) {
          _worldMapEventIndex = data.events;
          return _worldMapEventIndex;
        }
      }
    } catch (e) {}

    // 3. Parse Map315.json exactly once, slim it, cache and persist.
    let mapData = null;
    try {
      const fs = require("fs");
      const path = require("path");
      const mapPath = path.join(process.cwd(), "data", mapFileName(WORLD_MAP_ID));
      if (fs.existsSync(mapPath)) {
        mapData = JSON.parse(fs.readFileSync(mapPath, "utf8"));
      }
    } catch (e) {}

    if (!mapData) {
      // Fallback for environments without fs (plain browser).
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "data/" + mapFileName(WORLD_MAP_ID), false);
        xhr.overrideMimeType("application/json");
        xhr.send();
        if (xhr.status === 200) mapData = JSON.parse(xhr.responseText);
      } catch (e) {}
    }

    if (!mapData || !mapData.events) return [];

    _worldMapEventIndex = slimMapEvents(mapData.events);

    try {
      const fs = require("fs");
      const filePath = getWorldEventsFilePath();
      if (filePath) {
        fs.writeFileSync(filePath, JSON.stringify({
          version: 1,
          generatedAt: new Date().toISOString(),
          events: _worldMapEventIndex,
        }), "utf8");
        log(`getWorldMapEvents: cached ${_worldMapEventIndex.length} events to WorldEvents315.json`);
      }
    } catch (e) {}

    return _worldMapEventIndex;
  }

  // ===== EXPORT UTILITIES TO GLOBAL NAMESPACE =====
  window.ProcGenUtils = {
    Cache,
    getTileIdToProgressiveId,
    getProgressiveIdToTileId,
    getTileIdFromTypeAndIndex,
    getBiomeForWorldTile,
    isRiverWorldTileId,
    isTestPlayer,
    classifyWorldColumn,
    getBridgeDirectionFromWorldTileId,
    getRoadDirectionFromWorldTile,
    getBiomeByName,
    parseTerrainFeatures,
    parseSingleTileString,
    createSeededRandom,
    getWorldSeed,
    normalizeSeed,
    hashCoords,
    procMapSeed,
    normalizeLatitudeBiome,
    resolveSpecialBiome,
    randomChoice,
    normalizeBiomeForEdge,
    getNonProceduralDestination,
    noise2D,
    smoothNoise,
    fbmNoise,
    calculateIndex,
    getAdjacentBiomesOnWorldMap,
    getAdjacentBiomesFromCache,
    checkAdjacentMapBiomesFromCache,
    isWaterTileId,
    getRandomFeatureVariant,
    placeMultiTileFeature,
    generateFeatureNoise,
    generateFeatureScattered,
    checkDiagonalMapBiomesFromCache,
    generateCaveWithDrunkenWalk,
    generateCaveWithCellularAutomata,
    generateCaveWithVoronoi,
    generateMountainBiomeTerrain,
    generateDungeonBSP,
    generateDungeonWithBSP,
    getTerrainFeatures,
    getFeaturesByLayer,
    createTileToFeatureMap,
    getFeatureNameFromTileId,
    calculateDirectionalInfluence,
    getWeightedTerrainFeature,
    isInForbiddenZone,
    doesMultiTileFeatureOverlapForbidden,
    clearForbiddenZoneFeatures,
    generateAsciiVisualization,
    getArrowForDirection,
    isTileOccupiedOnLayer,
    log,
    logWarn,
    buildBiomeCoordinateCache,
    getBiomeFromCacheWithFallback,
    getWorldMapEvents,
    loadBiomesMapFromFile,
    exportBiomesMapToFile,
    WORLD_MAP_ID,
    WORLD_TILESET_ID,
    PROC_MAP_ID,
    PROC_MAP_WIDTH,
    PROC_MAP_HEIGHT,
    BORDER_DETECTION_RANGE,
    PRELOAD_BIOMES_MAP,
    EXPORT_BIOMES_MAP,
  };
})();
