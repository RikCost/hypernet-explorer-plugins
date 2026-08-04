/*:
 * @target MZ
 * @plugindesc Biome-specific procedural map generation: roads, mountains, features
 * @author Omni-Lex
 *
 * @help
 * Procedural Map Biome Generator
 * ==============================
 * Handles biome-specific terrain generation including:
 * - Road generation (linear, cross, T-intersections)
 * - Biome feature distribution (single-tile and multi-tile)
 * - Map loading and procedural map handling
 * - Multi-tile terrain feature placement
 *
 * MULTI-TILE FEATURE SUPPORT
 * ==========================
 * Features can now be defined as grids of tiles. When placing multi-tile features:
 * - The feature is placed with its top-left corner at the selected position
 * - All tiles of the grid must fit within map bounds
 * - None of the grid tiles can overlap water
 * - Variants can be mixed: single-tile and multi-tile variants of the same feature
 *
 * Examples:
 *   <House: [B1, B2],[B3, B4]>      2x2 building
 *   <Bush: [C5]>                    Single tile (compatible with 1x1 grid)
 *   <Bridge: [D1, D2, D3]>          1x3 horizontal bridge
 *
 * Requires ProceduralMapUtils.js to be loaded first
 *
 * BIOME SYSTEM
 * ============
 * - Each biome has a name and associated tileset ID
 * - Tiles on map 315 are associated with biomes via tileset 96 notes
 * - If a tile has no biome association, defaults to "Fields" biome
 * - Procedural maps use the biome's tileset for terrain generation
 *
 * @command startProcGen
 * @text Start Procedural Generation
 * @desc Initiate procedural map 636 generation from current map 315 location
 *
 * @command stopProcGen
 * @text Stop Procedural Generation
 * @desc Return player from map 636 to origin point on map 315
 *
 * @command goDown
 * @text Go Down (Underground Layer)
 * @desc Descend into the underground layer of the current biome
 *
 * @command goUp
 * @text Go Up (Return to Surface)
 * @desc Ascend back to the previous surface biome
 */

(() => {
  "use strict";

  const pluginName = "ProceduralMapBiomeGenerator";

  // Import utilities from ProceduralMapUtils
  const Utils2 = window.ProcGenUtils;
  if (!Utils2) {
    console.error(
      "ProceduralMapBiomeGenerator requires ProceduralMapUtils plugin"
    );
    return;
  }

  const {
    Cache,
    getTileIdToProgressiveId,
    getProgressiveIdToTileId,
    getTileIdFromTypeAndIndex,
    getBiomeForWorldTile,
    classifyWorldColumn,
    isTestPlayer,
    exportBiomesMapToFile,
    getBridgeDirectionFromWorldTileId,
    getRoadDirectionFromWorldTile,
    getBiomeByName,
    parseTerrainFeatures,
    parseSingleTileString,
    createSeededRandom,
    getWorldSeed,
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
    checkDiagonalMapBiomesFromCache,
    isWaterTileId,
    getRandomFeatureVariant,
    placeMultiTileFeature,
    generateFeatureNoise,
    generateFeatureScattered,
    generateCaveWithDrunkenWalk,
    generateCaveWithCellularAutomata,
    generateCaveWithVoronoi,
    generateMountainBiomeTerrain,
    getTerrainFeatures,
    getFeaturesByLayer,
    getFeatureNameFromTileId,
    calculateDirectionalInfluence,
    getWeightedTerrainFeature,
    isInForbiddenZone,
    doesMultiTileFeatureOverlapForbidden,
    clearForbiddenZoneFeatures,
    getArrowForDirection,
    isTileOccupiedOnLayer,
    log,
    logWarn,
    WORLD_MAP_ID,
    WORLD_TILESET_ID,
    PROC_MAP_ID,
    PROC_MAP_WIDTH,
    PROC_MAP_HEIGHT,
    BORDER_DETECTION_RANGE,
  } = Utils2;

  // Import beach/water generation functions from ProceduralBeachGenerator
  const BeachGen = window.ProcGenBeach;
  if (!BeachGen) {
    console.error(
      "ProceduralMapBiomeGenerator requires ProceduralBeachGenerator plugin"
    );
    return;
  }

  const {
    isWaterBiome,
    drawWaterEdges,
    drawWaterCorners,
  } = BeachGen;

  // Import road generation functions from ProceduralMapRoadGenerator
  const RoadGen = window.ProcGenRoads;
  if (!RoadGen) {
    console.error(
      "ProceduralMapBiomeGenerator requires ProceduralMapRoadGenerator plugin"
    );
    return;
  }

  const {
    isRoadBiome,
    parseRoadConfig,
    getDashedLineTileId,
    getDashedLineTileIds,
    isPositionOnRoadTile,
    generateRoadBiome: generateRoadBiomeUtil,
    determineRoadIntersectionType,
  } = RoadGen;

  // Import river generation functions from ProceduralMapRiverGenerator
  const RiverGen = window.ProcGenRivers;
  if (!RiverGen) {
    console.error(
      "ProceduralMapBiomeGenerator requires ProceduralMapRiverGenerator plugin"
    );
    return;
  }

  const {
    isRiverBiome,
    parseRiverConfig,
    getRiverDecorationTileId,
    isPositionOnRiverTile,
    generateRiverBiome: generateRiverBiomeUtil,
    determineRiverIntersectionType,
    isRiverConnectable,
    applyRiverOverlay,
  } = RiverGen;

  // Import dungeon generation functions from ProceduralMapStructureGenerator
  const DungeonGen = window.ProcGenDungeon;
  if (!DungeonGen) {
    console.error(
      "ProceduralMapBiomeGenerator requires ProceduralMapStructureGenerator plugin"
    );
    return;
  }

  const {
    isDungeonBiome,
    generateDungeonBiome: generateDungeonBiomeUtil,
    isVillageBiome,
    generateVillageBiome: generateVillageBiomeUtil,
    isCityBiome,
    generateCityBiome: generateCityBiomeUtil,
    isBurgBiome,
    generateBurgBiome: generateBurgBiomeUtil,

  } = DungeonGen;

  const { Biomes, Features, HardcodedBiomeOverrides } =
    window.WorldGen;

  // ==========================================================================
  // Civic signposts (SignPost / SignBus / SignPark)
  // ==========================================================================
  // Once a settlement (village / burg / city) has its roads and buildings, drop
  // a few civic signs on the grass verge beside its roads:
  //   SignPost -> readable place name + dismantle (villages only, 1-3)
  //   SignBus  -> boards the fast-travel map in Bus mode (near roads)
  //   SignPark -> recalls the camper (one per settlement)
  // They sit on feature layer 2 so the interaction plugins detect them when the
  // player faces them from the adjacent road tile. Placement is deterministic
  // for a given map seed, so the same tile always shows the same signs.
  function _civicFeatureTile(featureName, allFeatures, rng) {
    const variants = allFeatures[featureName];
    if (!variants || variants.length === 0) return 0;
    // Prefer single-tile variants so we never leave a partial multi-tile sign.
    const singles = variants.filter((v) => v.type === "single" && v.tileId);
    if (singles.length) return singles[Math.floor(rng() * singles.length)].tileId;
    // Fall back to a single-cell grid (SignBus / SignPark are 1x1 grids).
    for (const v of variants) {
      if (v.type === "grid" && v.grid && v.grid[0] && v.grid[0][0]) return v.grid[0][0];
    }
    return 0;
  }

  function _collectSingleTileIds(names, allFeatures, out) {
    for (const n of names) {
      const variants = allFeatures[n];
      if (!variants) continue;
      for (const v of variants) {
        if (v.type === "single" && v.tileId) out.add(v.tileId);
      }
    }
  }

  function placeCivicSigns(mapData, biome, allFeatures, seed, counts) {
    if (!mapData || !allFeatures) return;
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    // Dedicated RNG stream so signs never perturb terrain generation.
    const rng = createSeededRandom((seed ^ 0x5169b05) >>> 0);

    // Roadside is defined by these walkable path/road tiles.
    const roadTileIds = new Set();
    _collectSingleTileIds(
      ["Path", "PathDesert", "PathIce", "Road", "DashedLine",
        "DashedLineHorizontal", "DashedLineVertical", "Sidewalk",
        "SidewalkDesert", "SidewalkIce"],
      allFeatures, roadTileIds
    );
    if (roadTileIds.size === 0) return;

    // Base tiles a sign must never sit on top of.
    const blockedBaseIds = new Set();
    _collectSingleTileIds(
      ["Water", "Ocean", "Beach", "Lava", "Magma"],
      allFeatures, blockedBaseIds
    );

    const idx0 = (x, y) => calculateIndex(x, y, 0, width, height);
    const isRoad = (x, y) => roadTileIds.has(mapData[idx0(x, y)]);
    const featureLayersEmpty = (x, y) =>
      mapData[calculateIndex(x, y, 1, width, height)] === 0 &&
      mapData[calculateIndex(x, y, 2, width, height)] === 0 &&
      mapData[calculateIndex(x, y, 3, width, height)] === 0;

    // Candidate = walkable non-road verge tile, feature layers empty, next to a road.
    const candidates = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const base = mapData[idx0(x, y)];
        if (base === 0 || roadTileIds.has(base) || blockedBaseIds.has(base)) continue;
        if (!featureLayersEmpty(x, y)) continue;
        if (isRoad(x - 1, y) || isRoad(x + 1, y) || isRoad(x, y - 1) || isRoad(x, y + 1)) {
          candidates.push({ x, y });
        }
      }
    }
    if (candidates.length === 0) return;

    // Deterministic Fisher-Yates shuffle.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }

    const placed = [];
    const MIN_SPACING = 8;
    const tooClose = (c) =>
      placed.some((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < MIN_SPACING);

    function placeOne(featureName) {
      const tileId = _civicFeatureTile(featureName, allFeatures, rng);
      if (!tileId) return false;
      for (const c of candidates) {
        if (c._used || tooClose(c)) continue;
        mapData[calculateIndex(c.x, c.y, 2, width, height)] = tileId;
        c._used = true;
        placed.push(c);
        return true;
      }
      return false;
    }

    const pick = (range) => {
      if (!range) return 0;
      const [min, max] = range;
      return min + Math.floor(rng() * (max - min + 1));
    };

    const busN = pick(counts.bus);
    const parkN = pick(counts.park);
    const postN = pick(counts.post);
    for (let i = 0; i < busN; i++) placeOne("SignBus");
    for (let i = 0; i < parkN; i++) placeOne("SignPark");
    for (let i = 0; i < postN; i++) placeOne("SignPost");
  }

  // ==========================================================================
  // Tilled fields (TilledSoil)
  // ==========================================================================
  // A biome that declares TilledSoil (the Farm biome, and any village grown on
  // one) gets real crop plots instead of the usual per-tile scatter: the tiles
  // have to sit next to each other for the crops growing on them to read as a
  // field, because PlantGrowthSystem seeds ONE crop type per contiguous patch
  // of tilled soil. Plots are deterministic for a given map seed and only land
  // on open, walkable ground with nothing else on the feature layers.
  const FIELD_MAX_TILES = 130;      // total tilled tiles per map
  const FIELD_EDGE_GAP_CHANCE = 0.1; // ragged plot border (interior stays whole)

  // Density the biome declares for a feature (0 when it declares none).
  function _declaredFeatureDensity(biome, name) {
    for (const f of biome.features || []) {
      const fname = typeof f === "string" ? f : f.name;
      if (fname !== name) continue;
      return (typeof f === "object" && f.density) ? f.density : 1;
    }
    return 0;
  }

  function placeTilledFields(mapData, biome, allFeatures, seed, width, height) {
    if (!mapData || !allFeatures) return;
    const density = _declaredFeatureDensity(biome, "TilledSoil");
    if (density <= 0) return;

    // Only the B-E sheet variants: the A5 entry is a ground autotile and would
    // be invisible on the feature layer.
    const soilTiles = (allFeatures["TilledSoil"] || [])
      .filter((v) => v.type === "single" && v.tileId && v.tileId < 1536)
      .map((v) => v.tileId);
    if (soilTiles.length === 0) return;

    const rng = createSeededRandom((seed ^ 0x7111ed) >>> 0);

    // Tiles a field must never be laid over.
    const blockedBaseIds = new Set();
    _collectSingleTileIds(
      ["Water", "Ocean", "Beach", "Lava", "Magma", "Path", "PathDesert", "PathIce",
        "Road", "Sidewalk", "SidewalkDesert", "SidewalkIce", "DashedLine",
        "DashedLineHorizontal", "DashedLineVertical"],
      allFeatures, blockedBaseIds
    );

    const idx = (x, y, z) => calculateIndex(x, y, z, width, height);
    const isFree = (x, y) => {
      const base = mapData[idx(x, y, 0)];
      if (!base || blockedBaseIds.has(base)) return false;
      return mapData[idx(x, y, 1)] === 0 &&
        mapData[idx(x, y, 2)] === 0 &&
        mapData[idx(x, y, 3)] === 0;
    };

    const plots = Math.max(2, Math.min(6, Math.round(density * 2)));
    const margin = 6;
    let stamped = 0;

    for (let p = 0; p < plots && stamped < FIELD_MAX_TILES; p++) {
      const pw = 4 + Math.floor(rng() * 4); // 4-7
      const ph = 3 + Math.floor(rng() * 4); // 3-6
      let origin = null;
      for (let attempt = 0; attempt < 40 && !origin; attempt++) {
        const ox = margin + Math.floor(rng() * (width - pw - margin * 2));
        const oy = margin + Math.floor(rng() * (height - ph - margin * 2));
        let ok = true;
        for (let y = oy; y < oy + ph && ok; y++) {
          for (let x = ox; x < ox + pw && ok; x++) {
            if (!isFree(x, y)) ok = false;
          }
        }
        if (ok) origin = { x: ox, y: oy };
      }
      if (!origin) continue;

      for (let y = origin.y; y < origin.y + ph; y++) {
        for (let x = origin.x; x < origin.x + pw; x++) {
          if (stamped >= FIELD_MAX_TILES) break;
          const onEdge = x === origin.x || y === origin.y ||
            x === origin.x + pw - 1 || y === origin.y + ph - 1;
          if (onEdge && rng() < FIELD_EDGE_GAP_CHANCE) continue;
          mapData[idx(x, y, 2)] = soilTiles[Math.floor(rng() * soilTiles.length)];
          stamped++;
        }
      }
    }
  }

  // ==========================================================================
  // Bunker origin (character creation)
  // ==========================================================================
  // The Bunker origin starts the party inside a LootCellar and marks ONE world
  // square as the bunker's surface square ($gameSystem._bunkerOrigin). Every
  // time that square is generated, a StairsDown hatch is stamped back onto it,
  // so the way down to the starting bunker is permanent: the hatch is never
  // recorded as dismantled (StairsDown only descends, it is never removed) and
  // the tile it lands on is derived from the map itself, so a regeneration puts
  // it exactly where it was. Descending through it rebuilds the very cellar the
  // party started in, because a LootCellar's layout is fixed by
  // (world seed, world coords) alone.
  //
  // The cellar half of the record guarantees the starting hoards: the Bunker
  // origin promises gold, and the biome's own 0.35-density Gold scatter can roll
  // none at all.
  const BUNKER_GOLD_PILES = 6;
  // Published so the character-creation dossier can promise the exact number.
  window.WorldGen.BUNKER_GOLD_PILES = BUNKER_GOLD_PILES;

  // The bunker record when `worldCoords` is the bunker's own world square.
  function bunkerRecordFor(worldCoords) {
    const rec = (typeof $gameSystem !== "undefined" && $gameSystem) ? $gameSystem._bunkerOrigin : null;
    if (!rec || !worldCoords) return null;
    if (worldCoords.x !== rec.worldX || worldCoords.y !== rec.worldY) return null;
    return rec;
  }

  // Every feature table of a biome's tileset(s), merged (same shape the
  // generators build for themselves).
  function bunkerBiomeFeatures(biome) {
    const tilesetIds = biome.tilesetIds || [biome.tilesetId];
    const allFeatures = {};
    for (const tilesetId of tilesetIds) {
      const features = Cache.getTilesetFeatures(tilesetId);
      for (const [name, tiles] of Object.entries(features)) {
        if (!allFeatures[name]) allFeatures[name] = [];
        allFeatures[name] = allFeatures[name].concat(tiles);
      }
    }
    return allFeatures;
  }

  function bunkerSingleTileIds(names, allFeatures) {
    const out = new Set();
    for (const n of names) {
      for (const v of allFeatures[n] || []) {
        if (v.type === "single" && v.tileId) out.add(v.tileId);
      }
    }
    return out;
  }

  // Stamp the permanent hatch on the bunker's surface map and record the tile it
  // ended up on (the exit from the cellar steps out one tile south of it).
  function stampBunkerHatch(mapData, biome, rec) {
    const allFeatures = bunkerBiomeFeatures(biome);
    const stairs = (allFeatures["StairsDown"] || []).find((v) => v.type === "single" && v.tileId);
    if (!stairs) {
      logWarn(`[Bunker] tileset ${biome.tilesetId} has no single-tile StairsDown: hatch not placed`);
      return;
    }

    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const blocked = bunkerSingleTileIds(["Water", "Ocean", "Beach", "Lava", "Magma"], allFeatures);
    const idx = (x, y, z) => calculateIndex(x, y, z, width, height);
    const standable = (x, y) => {
      const base = mapData[idx(x, y, 0)];
      return base > 0 && !blocked.has(base);
    };

    // Start from just north of the 6x6 spawn clearing kept free at the map
    // centre (isInForbiddenZone), so the hatch sits beside where the player
    // lands when entering the square from the world map without ever covering
    // that landing tile. Search outward in deterministic rings so a square whose
    // centre is water still gets its hatch, always on the same tile.
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2) - 4;
    let spot = null;
    for (let r = 0; r <= 20 && !spot; r++) {
      for (let dy = -r; dy <= r && !spot; dy++) {
        for (let dx = -r; dx <= r && !spot; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
          // The hatch itself plus the tile the player steps out onto.
          if (!standable(x, y) || !standable(x, y + 1)) continue;
          spot = { x, y };
        }
      }
    }
    if (!spot) {
      logWarn(`[Bunker] no standable tile for the hatch at (${rec.worldX}, ${rec.worldY})`);
      return;
    }

    // Clear the 3x3 around the hatch so no tree/rock walls the party in, then
    // stamp the stairs on the feature layer.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const z of [1, 2, 3]) mapData[idx(spot.x + dx, spot.y + dy, z)] = 0;
      }
    }
    mapData[idx(spot.x, spot.y, 2)] = stairs.tileId;
    rec.entranceX = spot.x;
    rec.entranceY = spot.y;
  }

  // Guarantee a handful of gold hoards in the starting bunker. Placement is
  // seeded from the world square, so the same piles come back on every
  // regeneration and the collected ones stay collected (removals are recorded
  // per tile by ProceduralTerrainInteractions).
  function stampBunkerGold(mapData, biome, rec) {
    const allFeatures = bunkerBiomeFeatures(biome);
    const goldTiles = (allFeatures["Gold"] || []).filter((v) => v.type === "single" && v.tileId);
    if (goldTiles.length === 0) return;
    const floorIds = bunkerSingleTileIds(["DungeonFloor"], allFeatures);
    if (floorIds.size === 0) return;

    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const idx = (x, y, z) => calculateIndex(x, y, z, width, height);
    const isFloor = (x, y) => floorIds.has(mapData[idx(x, y, 0)]);
    const isFree = (x, y) =>
      mapData[idx(x, y, 1)] === 0 && mapData[idx(x, y, 2)] === 0 && mapData[idx(x, y, 3)] === 0;

    // Open floor only (all four neighbours walkable), so a hoard never plugs a
    // one-tile corridor.
    const candidates = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (!isFloor(x, y) || !isFree(x, y)) continue;
        if (!isFloor(x - 1, y) || !isFloor(x + 1, y) || !isFloor(x, y - 1) || !isFloor(x, y + 1)) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;

    const rng = createSeededRandom(hashCoords(getWorldSeed() ^ 0xb0c4e2, rec.worldX, rec.worldY));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }

    // Spread the hoards out, tightening the spacing until all of them fit: a
    // cellar can be as small as one 9x7 vault, and the dossier promises the
    // full count.
    const placed = [];
    for (const spacing of [4, 3, 2, 1]) {
      for (const c of candidates) {
        if (placed.length >= BUNKER_GOLD_PILES) break;
        if (c._used) continue;
        if (placed.some((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < spacing)) continue;
        mapData[idx(c.x, c.y, 2)] = goldTiles[Math.floor(rng() * goldTiles.length)].tileId;
        c._used = true;
        placed.push(c);
      }
      if (placed.length >= BUNKER_GOLD_PILES) break;
    }
  }

  // Applied to every generated map: does nothing unless the map being built is
  // the bunker's own world square (its surface, or the cellar underneath it).
  function applyBunkerFeatures(mapData, biome, worldCoords) {
    if (!mapData || !biome) return;
    const rec = bunkerRecordFor(worldCoords);
    if (!rec) return;
    if (biome.name === "LootCellar") {
      stampBunkerGold(mapData, biome, rec);
      return;
    }
    // Surface only: a cave or dungeon layer dug under the bunker square gets no
    // hatch of its own (the layer stack is pushed before the lower map is
    // generated, so a non-empty stack means "underground").
    const pg = (typeof $gameSystem !== "undefined" && $gameSystem) ? $gameSystem._procGenData : null;
    const underground = !!(pg && pg.biomeLayerStack && pg.biomeLayerStack.length > 0);
    if (!underground && !isDungeonBiome(biome.name)) stampBunkerHatch(mapData, biome, rec);
  }

  /**
   * Hardcoded biome spawn overrides for specific world coordinates
   * Forces a specific biome and optional road direction at given coordinates
   * The overridden biome is generated and cached just like normal procedural generation
   *
   * FORMAT:
   *   "worldX,worldY": { biome: "BiomeName", roadDirection: "..." (optional) }
   *
   * BIOME NAMES:
   *   - Any biome defined in WorldGen.Biomes (e.g., "Forest", "Mountain", "Ocean")
   *   - "Road" for road biomes (when using roadDirection)
   *
   * ROAD DIRECTIONS (optional - only for Road biome):
   *   LINEAR:
   *   - "horizontal"  : Horizontal road (left-right)
   *   - "vertical"    : Vertical road (up-down)
   *
   *   INTERSECTIONS:
   *   - "cross"       : 4-way intersection (crossroad)
   *   - "t-up"/"t-north"     : T-junction with stem pointing north (missing south)
   *   - "t-down"/"t-south"   : T-junction with stem pointing south (missing north)
   *   - "t-left"/"t-west"    : T-junction with stem pointing west (missing east)
   *   - "t-right"/"t-east"   : T-junction with stem pointing east (missing west)
   *
   *   CORNERS (L-shaped, connects two perpendicular directions):
   *   - "corner-up-right"     : Connects north and east (⌐ shape)
   *   - "corner-up-left"      : Connects north and west (┐ shape)
   *   - "corner-down-right"   : Connects south and east (┌ shape)
   *   - "corner-down-left"    : Connects south and west (┘ shape)
   *   - "corner-north-east"   : Alias for corner-up-right
   *   - "corner-north-west"   : Alias for corner-up-left
   *   - "corner-south-east"   : Alias for corner-down-right
   *   - "corner-south-west"   : Alias for corner-down-left
   *
   * EXAMPLES:
   *   "100,50": { biome: "Road", roadDirection: "cross" }         // Crossroad
   *   "110,50": { biome: "Road", roadDirection: "horizontal" }    // Horizontal road
   *   "120,50": { biome: "Road", roadDirection: "t-up" }          // T-junction (stem north)
   *   "130,50": { biome: "Road", roadDirection: "vertical" }      // Vertical road
   *   "140,50": { biome: "Road", roadDirection: "corner-up-right" } // Corner (north-east)
   *   "150,60": { biome: "Forest" }                               // Regular biome, no road
   */

  // Create feature lookup tables once at startup
  const FEATURE_LAYERS = {};
  const FEATURE_ASCII = {};
  const FEATURE_LAYER_MAP = {};

  for (const feature of Features) {
    FEATURE_LAYERS[feature.name] = feature.layer;
    FEATURE_ASCII[feature.name] = feature.ascii;
    if (!FEATURE_LAYER_MAP[feature.layer]) {
      FEATURE_LAYER_MAP[feature.layer] = [];
    }
    FEATURE_LAYER_MAP[feature.layer].push(feature.name);
  }

  // ===== HARDCODED OVERRIDES =====

  /**
   * Check if coordinates have a hardcoded biome override
   * Returns { biome, roadDirection } or null if no override exists
   */
  function getHardcodedBiomeOverride(worldX, worldY) {
    const key = `${worldX},${worldY}`;
    if (HardcodedBiomeOverrides[key]) {
      return HardcodedBiomeOverrides[key];
    }
    return null;
  }

  // ===== BIOME DETECTION =====



  /**
   * Check if biome is a cave biome
   */
  function isCaveBiome(biomeName) {
    return biomeName.toLowerCase().includes("cave");
  }

  /**
   * Determine which cave borders are open for global underground connections
   * Uses world coordinates to ensure adjacent caves connect properly
   * Returns object with open borders: { north, south, east, west }
   */
  function getOpenCaveBorders(worldCoords) {
    // Create deterministic seed from world coordinates and direction, mixed with
    // the world seed so cave layouts differ per world.
    const baseSeed = hashCoords(getWorldSeed(), worldCoords.x, worldCoords.y);

    // Determine if each border is open (1-2 borders per cave)
    const northSeed = createSeededRandom(baseSeed ^ 1);
    const southSeed = createSeededRandom(baseSeed ^ 2);
    const eastSeed = createSeededRandom(baseSeed ^ 3);
    const westSeed = createSeededRandom(baseSeed ^ 4);

    return {};
  }

  /**
   * Check if biome is a mountain surface biome
   */
  function isMountainBiome(biomeName) {
    return biomeName.toLowerCase().includes("mountain");
  }

  /**
   * Check if Fields biome should display as Beach based on water edges/corners
   */
  function shouldDisplayAsBeach(biomeName, adjacentBiomes, diagonalBiomes) {
    if (biomeName !== "Fields") {
      return false;
    }

    // Check if any adjacent biome is water
    if (adjacentBiomes) {
      if (
        (adjacentBiomes.north && isWaterBiome(adjacentBiomes.north)) ||
        (adjacentBiomes.south && isWaterBiome(adjacentBiomes.south)) ||
        (adjacentBiomes.east && isWaterBiome(adjacentBiomes.east)) ||
        (adjacentBiomes.west && isWaterBiome(adjacentBiomes.west))
      ) {
        return true;
      }
    }

    // Check if any diagonal biome is water
    if (diagonalBiomes) {
      if (
        (diagonalBiomes.topLeft && diagonalBiomes.topLeft.length > 0 &&
          diagonalBiomes.topLeft.some((b) => isWaterBiome(b))) ||
        (diagonalBiomes.topRight && diagonalBiomes.topRight.length > 0 &&
          diagonalBiomes.topRight.some((b) => isWaterBiome(b))) ||
        (diagonalBiomes.bottomLeft && diagonalBiomes.bottomLeft.length > 0 &&
          diagonalBiomes.bottomLeft.some((b) => isWaterBiome(b))) ||
        (diagonalBiomes.bottomRight && diagonalBiomes.bottomRight.length > 0 &&
          diagonalBiomes.bottomRight.some((b) => isWaterBiome(b)))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if biome should display as Island (surrounded by 4 Ocean biomes)
   * Virtual biome - affects name, enemies, and battle BG only
   */
  function shouldDisplayAsIsland(biomeName, adjacentBiomes) {
    // Don't display as island if underground (check biomeLayerStack)
    if ($gameSystem._procGenData && $gameSystem._procGenData.biomeLayerStack && $gameSystem._procGenData.biomeLayerStack.length > 0) {
      return false;
    }

    // Only apply to non-water biomes
    if (!adjacentBiomes || isWaterBiome(biomeName)) {
      return false;
    }

    // Check if all 4 cardinal directions are Ocean biomes
    const isNorthOcean = adjacentBiomes.north === "Ocean";
    const isSouthOcean = adjacentBiomes.south === "Ocean";
    const isEastOcean = adjacentBiomes.east === "Ocean";
    const isWestOcean = adjacentBiomes.west === "Ocean";

    if (isNorthOcean && isSouthOcean && isEastOcean && isWestOcean) {
      log(`[shouldDisplayAsIsland] Displaying "${biomeName}" as "Island" (surrounded by Ocean)`);
      return true;
    }

    return false;
  }

  // ===== FEATURE FUNCTIONS =====


  /**
   * Fill layer 0 with terrain features based on weighted density distribution
   * If only one terrain feature exists, it covers the entire layer
   * Otherwise, features are distributed according to their density ratios
   */
  function fillTerrainLayer(mapData, biome, allFeatures, width, height, rng, adjacentBiomes) {
    const terrainFeatures = getTerrainFeatures(biome);

    if (terrainFeatures.length === 0) {
      log("No terrain features - attempting to borrow from adjacent biomes")

      // Collect terrain features from adjacent biomes
      const borrowedTerrainFeatures = [];

      if (adjacentBiomes) {
        for (const direction of ["north", "south", "east", "west"]) {
          const adjacentBiomeName = adjacentBiomes[direction];
          if (!adjacentBiomeName) continue;

          const adjacentBiome = getBiomeByName(adjacentBiomeName);
          if (!adjacentBiome || !adjacentBiome.features) continue;

          // Get terrain features from adjacent biome
          for (const feature of adjacentBiome.features) {
            const isTerrain = typeof feature === "object" && feature.terrain === true;
            if (!isTerrain) continue;

            const featureName = feature.name;

            // Exclude road and path-related terrain features from borrowing
            const excludedTerrains = ["Road", "DashedLine", "DashedLineHorizontal", "DashedLineVertical", "Path", "PathIce", "PathDesert"];
            if (excludedTerrains.includes(featureName)) continue;

            // Avoid duplicates
            if (!borrowedTerrainFeatures.find(f => f.name === featureName)) {
              borrowedTerrainFeatures.push({
                name: featureName,
                density: feature.density || 1
              });
            }
          }
        }
      }

      if (borrowedTerrainFeatures.length > 0) {
        log(`Borrowed ${borrowedTerrainFeatures.length} terrain features from adjacent biomes: ${borrowedTerrainFeatures.map(f => f.name).join(", ")}`);

        // Use borrowed terrain features with weighted distribution
        const totalDensity = borrowedTerrainFeatures.reduce((sum, f) => sum + f.density, 0);
        const weightedFeatures = [];

        for (const feature of borrowedTerrainFeatures) {
          const weight = Math.round((feature.density / totalDensity) * 1000);
          for (let i = 0; i < weight; i++) {
            weightedFeatures.push(feature.name);
          }
        }

        // Pre-build tile arrays for each borrowed feature
        const featureTiles = {};
        for (const featureName of borrowedTerrainFeatures.map(f => f.name)) {
          featureTiles[featureName] = [];
          if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
            allFeatures[featureName].forEach(variant => {
              if (variant.type === "single") {
                featureTiles[featureName].push(variant.tileId);
              }
            });
          }
          // Fallback to default tile if feature has no variants
          if (featureTiles[featureName].length === 0) {
            featureTiles[featureName].push(2816);
          }
        }

        // Fill layer 0 with weighted random selection from borrowed features
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const selectedFeature = randomChoice(weightedFeatures, rng);
            const selectedTile = randomChoice(featureTiles[selectedFeature], rng);
            const idx = calculateIndex(x, y, 0, width, height);
            mapData[idx] = selectedTile;
          }
        }
        return;
      }

      // Final fallback: no adjacent biomes or no terrain features found, fill with Grass or default
      log("No terrain features found in adjacent biomes - using Grass fallback")
      const fallbackTiles = [2816];
      if (allFeatures["Grass"] && allFeatures["Grass"].length > 0) {
        allFeatures["Grass"].forEach(variant => {
          if (variant.type === "single") {
            fallbackTiles.push(variant.tileId);
          }
        });
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          mapData[idx] = randomChoice(fallbackTiles, rng);
        }
      }
      return;
    }

    if (terrainFeatures.length === 1) {
      log("Single terrain feature")

      // Single terrain feature: covers entire layer
      const featureName = terrainFeatures[0].name;
      const tiles = [];
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        allFeatures[featureName].forEach(variant => {
          if (variant.type === "single") {
            tiles.push(variant.tileId);
          }
        });
      }
      if (tiles.length === 0) tiles.push(2816);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          mapData[idx] = randomChoice(tiles, rng);
        }
      }
      return;
    }

    // Multiple terrain features: distribute by density
    // Create weighted selection array
    const totalDensity = terrainFeatures.reduce((sum, f) => sum + f.density, 0);
    const weightedFeatures = [];

    for (const feature of terrainFeatures) {
      const weight = Math.round((feature.density / totalDensity) * 1000);
      for (let i = 0; i < weight; i++) {
        weightedFeatures.push(feature.name);
      }
    }

    // Pre-build tile arrays for each feature
    const featureTiles = {};
    for (const featureName of terrainFeatures.map(f => f.name)) {
      featureTiles[featureName] = [];
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        allFeatures[featureName].forEach(variant => {
          if (variant.type === "single") {
            featureTiles[featureName].push(variant.tileId);
          }
        });
      }
      if (featureTiles[featureName].length === 0) {
        featureTiles[featureName].push(2816);
      }
    }

    // Fill layer 0 with weighted random selection
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const selectedFeature = randomChoice(weightedFeatures, rng);
        const selectedTile = randomChoice(featureTiles[selectedFeature], rng);
        const idx = calculateIndex(x, y, 0, width, height);
        mapData[idx] = selectedTile;
      }
    }
  }

  /**
   * Blend terrain features (layer 0) from adjacent biomes across the map
   * Creates organic, non-triangular gradients using global Perlin noise
   * Excludes Ocean biomes from blending
   * For terrain-only blending (features on layers 1-3 are preserved)
   * Skips blending on water and beach tiles to preserve coastlines
   */
  // The 4-direction blend influence field depends only on tile position and the
  // generation parameters (seed / dimensions / world coords / scale) -- not on
  // the RNG stream, since calculateDirectionalInfluence is pure noise. The road
  // and river passes each call blendBiomesTerrainOnly + blendBiomeBorders back to
  // back with identical parameters, so compute the field once and share it across
  // all four calls instead of recomputing 4 fBm lookups per tile per call.
  const _influenceFieldCache = { key: null, field: null };

  function getInfluenceField(width, height, seed, blendScale, worldX, worldY) {
    const key = seed + "|" + width + "|" + height + "|" + worldX + "|" + worldY + "|" + blendScale;
    if (_influenceFieldCache.key === key) return _influenceFieldCache.field;
    const n = width * height;
    const field = {
      north: new Float64Array(n),
      south: new Float64Array(n),
      east: new Float64Array(n),
      west: new Float64Array(n),
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        field.north[idx] = calculateDirectionalInfluence(x, y, "north", width, height, seed, blendScale, worldX, worldY);
        field.south[idx] = calculateDirectionalInfluence(x, y, "south", width, height, seed, blendScale, worldX, worldY);
        field.east[idx] = calculateDirectionalInfluence(x, y, "east", width, height, seed, blendScale, worldX, worldY);
        field.west[idx] = calculateDirectionalInfluence(x, y, "west", width, height, seed, blendScale, worldX, worldY);
      }
    }
    _influenceFieldCache.key = key;
    _influenceFieldCache.field = field;
    return field;
  }

  /**
   * Resolve the road surface and dashed center-line tile IDs for a road biome.
   * Returns null for non-road biomes. Used to protect drawn roads from being
   * overwritten by later terrain/feature blending passes.
   */
  function getRoadProtectTiles(biome, allFeatures) {
    if (!biome || !isRoadBiome(biome.name)) return null;

    let roadTileId = 2816;
    const roadConfig = parseRoadConfig(biome.name);
    if (roadConfig) {
      roadTileId = roadConfig.tileId;
    } else if (allFeatures["Road"] && allFeatures["Road"].length > 0) {
      for (const variant of allFeatures["Road"]) {
        if (variant.type === "single") {
          roadTileId = variant.tileId;
          break;
        }
      }
    }

    // Protect both directional dashed center lines (horizontal + vertical)
    const dashed = getDashedLineTileIds(allFeatures);
    const dashedTileIds = [];
    if (dashed.horizontal != null) dashedTileIds.push(dashed.horizontal);
    if (dashed.vertical != null && dashed.vertical !== dashed.horizontal) dashedTileIds.push(dashed.vertical);
    return { roadTileId, dashedTileIds };
  }

  /**
   * Check whether a position currently holds a road surface tile (layer 0) or a
   * dashed center-line marking (layer 1). Blending must never draw over these.
   */
  function isRoadProtectedPosition(mapData, x, y, width, height, roadProtect) {
    if (!roadProtect) return false;
    const l0 = mapData[calculateIndex(x, y, 0, width, height)];
    if (roadProtect.roadTileId != null && l0 === roadProtect.roadTileId) return true;
    if (roadProtect.dashedTileIds && roadProtect.dashedTileIds.length > 0) {
      const l1 = mapData[calculateIndex(x, y, 1, width, height)];
      if (roadProtect.dashedTileIds.includes(l1)) return true;
    }
    return false;
  }

  function blendBiomesTerrainOnly(mapData, biome, adjacentBiomes, allFeatures, width, height, seed, rng, worldCoords = { x: 0, y: 0 }, waterTiles = []) {
    if (!adjacentBiomes) return;

    // Don't blend Ocean biomes at all
    if (biome.name === "Ocean" || biome.name === "Seabed") return;

    // Build expanded allFeatures to include adjacent biomes' features
    const expandedAllFeatures = { ...allFeatures };
    const allAdjacentBiomes = {};

    for (const [direction, biomeName] of Object.entries(adjacentBiomes)) {
      if (!biomeName || biomeName === "Ocean" || biomeName === "Seabed") continue;

      const adjacentBiome = getBiomeByName(biomeName);
      if (!adjacentBiome) continue;

      allAdjacentBiomes[direction] = adjacentBiome;

      // Add tilesets from adjacent biome to expanded features
      const adjacentTilesetIds = adjacentBiome.tilesetIds || [adjacentBiome.tilesetId];
      for (const tilesetId of adjacentTilesetIds) {
        const adjacentFeatures = Utils2.Cache.getTilesetFeatures(tilesetId);
        for (const [name, tiles] of Object.entries(adjacentFeatures)) {
          if (!expandedAllFeatures[name]) {
            expandedAllFeatures[name] = [];
          }
          expandedAllFeatures[name] = expandedAllFeatures[name].concat(tiles);
        }
      }
    }

    const blendScale = 0.02; // Perlin noise scale for smooth gradients
    const worldX = worldCoords.x || 0;
    const worldY = worldCoords.y || 0;
    const influenceField = getInfluenceField(width, height, seed, blendScale, worldX, worldY);

    // Never overwrite drawn road surfaces or dashed lines with blended terrain
    const roadProtect = getRoadProtectTiles(biome, allFeatures);

    // Blend terrain (layer 0) using global Perlin noise for each direction
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (isRoadProtectedPosition(mapData, x, y, width, height, roadProtect)) continue;
        // Calculate blend influence from each adjacent biome direction using global noise
        const influences = [];

        if (allAdjacentBiomes.north) {
          const influence = influenceField.north[idx];
          if (influence > 0) influences.push({ direction: "north", biome: allAdjacentBiomes.north, value: influence });
        }
        if (allAdjacentBiomes.south) {
          const influence = influenceField.south[idx];
          if (influence > 0) influences.push({ direction: "south", biome: allAdjacentBiomes.south, value: influence });
        }
        if (allAdjacentBiomes.east) {
          const influence = influenceField.east[idx];
          if (influence > 0) influences.push({ direction: "east", biome: allAdjacentBiomes.east, value: influence });
        }
        if (allAdjacentBiomes.west) {
          const influence = influenceField.west[idx];
          if (influence > 0) influences.push({ direction: "west", biome: allAdjacentBiomes.west, value: influence });
        }

        // Sort by influence strength (highest first)
        influences.sort((a, b) => b.value - a.value);

        // Blend from the strongest adjacent biome if influence is high enough
        if (influences.length > 0 && rng() < influences[0].value) {
          blendTerrainTileFromAdjacentBiome(mapData, x, y, influences[0].biome, expandedAllFeatures, width, height, rng, waterTiles);
        }
      }
    }
  }

  /**
   * Blend a single terrain tile (layer 0 only) from an adjacent biome
   * Only modifies layer 0 (terrain), preserves features on other layers
   * Excludes road-related terrain features (Road, Path, Sidewalk, DashedLine)
   * Skips blending on water and beach tiles to preserve coastlines
   */
  function blendTerrainTileFromAdjacentBiome(mapData, x, y, adjacentBiome, expandedAllFeatures, width, height, rng, waterTiles = []) {
    // Skip blending on beach tiles to preserve coastlines
    // Check if current tile matches any protected beach/water tile IDs
    const baseIdx = calculateIndex(x, y, 0, width, height);
    const baseTile = mapData[baseIdx];

    if (waterTiles.length > 0 && waterTiles.includes(baseTile)) {
      return;
    }

    // Also check beach coordinates as a fallback
    const beachCoordinates = window.ProcGenUtils?.beachCoordinates;
    if (beachCoordinates && beachCoordinates.has(`${x},${y}`)) {
      return;
    }

    const terrainFeatures = getTerrainFeatures(adjacentBiome);

    if (terrainFeatures.length === 0) return;

    // Filter out road-related terrain features from blending
    const excludedTerrains = ["Road", "Path", "Sidewalk", "DashedLine", "DashedLineHorizontal", "DashedLineVertical"];
    const blendableTerrains = terrainFeatures.filter(f => !excludedTerrains.includes(f.name));

    if (blendableTerrains.length === 0) return;

    // Select a random terrain feature from the adjacent biome (excluding road features)
    const selectedTerrain = getWeightedTerrainFeature(blendableTerrains, expandedAllFeatures, rng);
    if (!selectedTerrain) return;

    // Apply to layer 0 only
    mapData[baseIdx] = selectedTerrain;
  }

  /**
   * Blend biomes across entire map using global Perlin noise for smooth transitions
   * Creates organic, non-triangular gradients from adjacent biomes
   * Does NOT blend from Road or Ocean biomes
   * For Road and River biomes: allow blending from Fields biomes (both terrain and features)
   * Ensures no empty tiles are placed
   * Road biomes get terrain blending AND feature placement (B sheet features only)
   * Skips blending on water and beach tiles to preserve coastlines
   */
  function blendBiomeBorders(mapData, biome, adjacentBiomes, allFeatures, width, height, seed, rng, worldCoords = { x: 0, y: 0 }, waterTiles = [], keepOutMask = null) {
    if (!adjacentBiomes) return;

    const blendScale = 0.02; // Perlin noise scale for smooth gradients
    const isCurrentBiomeRoad = isRoadBiome(biome.name);
    const isCurrentBiomeRiver = isRiverBiome(biome.name);
    // Never overwrite drawn road surfaces or dashed lines with blended features
    const roadProtect = getRoadProtectTiles(biome, allFeatures);
    const worldX = worldCoords.x || 0;
    const worldY = worldCoords.y || 0;

    // Road and Ocean are excluded for all biomes
    // Fields is excluded for normal biomes but allowed for Road and River biomes
    const excludedBiomes = ["Road", "Ocean"];
    if (!isCurrentBiomeRoad && !isCurrentBiomeRiver) {
      excludedBiomes.push("Fields");
    }

    const influenceField = getInfluenceField(width, height, seed, blendScale, worldX, worldY);

    // Iterate through entire map
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        // Caller-supplied no-build zone (the road keep-out margin) wins outright
        if (keepOutMask && keepOutMask[idx]) continue;
        // Calculate blend influence from each adjacent biome direction using global noise
        const northInfluence = influenceField.north[idx];
        const southInfluence = influenceField.south[idx];
        const eastInfluence = influenceField.east[idx];
        const westInfluence = influenceField.west[idx];

        // Total influence from all directions
        const totalInfluence = northInfluence + southInfluence + eastInfluence + westInfluence;

        // Determine which adjacent biome to blend from based on weighted influence
        if (totalInfluence > 0 && rng() < Math.min(totalInfluence, 1)) {
          const influences = [
            { direction: "north", value: northInfluence, biomeName: adjacentBiomes.north },
            { direction: "south", value: southInfluence, biomeName: adjacentBiomes.south },
            { direction: "east", value: eastInfluence, biomeName: adjacentBiomes.east },
            { direction: "west", value: westInfluence, biomeName: adjacentBiomes.west },
          ];

          // Sort by influence to use strongest adjacent biome
          influences.sort((a, b) => b.value - a.value);

          // Find first valid adjacent biome (not excluded and matching tileset)
          // For road/river biomes: allow blending from any adjacent biome including Fields (tileset check skipped)
          for (const inf of influences) {
            if (inf.value > 0 && inf.biomeName && !excludedBiomes.includes(inf.biomeName)) {
              const adjacentBiome = getBiomeByName(inf.biomeName);
              // For road/river biomes, skip tileset check since we want to blend from all neighbors
              if (adjacentBiome && (isCurrentBiomeRoad || isCurrentBiomeRiver || adjacentBiome.tilesetId === biome.tilesetId)) {
                blendTileFromAdjacentBiome(mapData, x, y, adjacentBiome, allFeatures, width, height, rng, isCurrentBiomeRoad, waterTiles, roadProtect);
                break;
              }
            }
          }
        }
      }
    }
  }


  /**
   * Check if a tile ID belongs to the B sheet (common across all tilesets)
   * B sheet tiles range from 0-255 (B1-B256)
   */
  function isBSheetTile(tileId) {
    return tileId >= 0 && tileId < 256;
  }

  /**
   * Blend a single tile from an adjacent biome
   * Ensures a valid tile is always placed (never empty)
   * Features from adjacent biomes are placed with reduced density
   * For road biomes: blend features everywhere except ON the road tiles
   * For road biomes: only blend B sheet non-terrain features (common across all tilesets)
   * Skips blending on water and beach tiles to preserve coastlines
   */
  function blendTileFromAdjacentBiome(mapData, x, y, adjacentBiome, allFeatures, width, height, rng, isCurrentBiomeRoad = false, waterTiles = [], roadProtect = null) {
    // Never draw over an actual road surface or dashed center line
    if (isRoadProtectedPosition(mapData, x, y, width, height, roadProtect)) {
      return;
    }

    // For road biomes, check if this position is ON the road - if so, skip blending entirely
    if (isCurrentBiomeRoad && isPositionOnRoadTile(x, y, width, height)) {
      return;
    }

    // Skip blending on beach tiles to preserve coastlines
    // Check if current tile matches any protected beach/water tile IDs
    const baseIdx = calculateIndex(x, y, 0, width, height);
    const baseTile = mapData[baseIdx];

    if (waterTiles.length > 0 && waterTiles.includes(baseTile)) {
      return;
    }

    // Also check beach coordinates as a fallback
    const beachCoordinates = window.ProcGenUtils?.beachCoordinates;
    if (beachCoordinates && beachCoordinates.has(`${x},${y}`)) {
      return;
    }

    const terrainFeatures = getTerrainFeatures(adjacentBiome);

    // 40% chance to blend terrain (layer 0) - but ONLY on road maps if not on road tile
    if (terrainFeatures.length > 0 && rng() < 0.4) {
      const selectedTerrain = getWeightedTerrainFeature(terrainFeatures, allFeatures, rng);
      if (selectedTerrain) {
        const idx = calculateIndex(x, y, 0, width, height);
        mapData[idx] = selectedTerrain;
        return;
      }
    }

    // Blend features from layer 2 (objects) with reduced density
    const regularFeatures = getFeaturesByLayer(adjacentBiome, allFeatures, 2, FEATURE_LAYERS);

    // Filter out road-related features from adjacent biomes
    const excludedFeatures = ["Road", "Path", "Sidewalk", "DashedLine", "DashedLineHorizontal", "DashedLineVertical"];
    const blendableFeatures = regularFeatures.filter(f => !excludedFeatures.includes(f.name));

    if (blendableFeatures.length > 0) {
      // Only 25% chance to even attempt feature blending (much less dense than original)
      if (rng() < 0.25) {
        const selectedFeature = randomChoice(blendableFeatures, rng);
        const featureVariants = allFeatures[selectedFeature.name];

        if (featureVariants && featureVariants.length > 0) {
          const variant = getRandomFeatureVariant(featureVariants, rng);
          if (variant && variant.type === "single" && variant.tileId) {
            // For road biomes: only place B sheet tiles (common across all tilesets)
            if (isCurrentBiomeRoad && !isBSheetTile(variant.tileId)) {
              return; // Skip non-B sheet features on road biomes
            }

            const idx = calculateIndex(x, y, 2, width, height);
            const currentTile = mapData[idx];

            // Check if tile is already occupied by a feature on the same layer
            const tileOccupied = isTileOccupiedOnLayer(mapData, x, y, 2, width, height);

            // Only place if no feature exists, or 30% chance to overwrite (reduced from 60%)
            if (!tileOccupied && (currentTile === 0 || rng() < 0.3)) {
              mapData[idx] = variant.tileId;
            }
          }
        }
      }
    }
  }



  // ===== ROAD GENERATION WRAPPER =====

  // How far from the carriageway (in tiles) features must stay clear.
  const ROAD_FEATURE_MARGIN = 3;

  /**
   * The biome definition a road map is laid over, recorded from the world-map
   * column in prepareProceduralGeneration. Null when the road is not over
   * anything usable (bare road column, or a settlement, which is filtered out
   * there so roads through towns keep their plain civic look).
   */
  function getUnderlyingTerrainBiome(roadBiome) {
    if (!roadBiome || !isRoadBiome(roadBiome.name)) return null;
    const name =
      ($gameSystem && $gameSystem._procGenData && $gameSystem._procGenData.currentUnderBiome) || null;
    if (!name || name === roadBiome.name) return null;
    const under = getBiomeByName(name);
    return under && under.features ? under : null;
  }

  /**
   * Weighted pool of layer-0 tile ids for a biome's terrain features, resolved
   * against `allFeatures`. Road/path terrains are excluded: the carriageway is
   * drawn separately and must not be scattered around as ground.
   * Returns an empty array when none of the features exist in the tileset.
   */
  function collectTerrainTilePool(sourceBiome, allFeatures) {
    const excludedTerrains = [
      "Road", "Path", "PathIce", "PathDesert", "Sidewalk",
      "DashedLine", "DashedLineHorizontal", "DashedLineVertical",
    ];
    const pool = [];
    for (const feature of getTerrainFeatures(sourceBiome)) {
      if (excludedTerrains.includes(feature.name)) continue;
      const variants = allFeatures[feature.name];
      if (!variants) continue;
      const tiles = variants.filter((v) => v.type === "single").map((v) => v.tileId);
      if (tiles.length === 0) continue;
      // Density drives how much of the ground this terrain covers.
      const weight = Math.max(1, Math.round((feature.density || 1) * 10));
      for (let i = 0; i < weight; i++) pool.push(tiles);
    }
    return pool;
  }

  /**
   * Mark every tile holding road surface or a dashed centre line, plus a margin
   * of `margin` tiles around it, as off limits for feature placement. Keeps
   * trees and rocks off the carriageway and out of the shoulder.
   *
   * @returns {Uint8Array} width*height mask, 1 = do not place anything here
   */
  function buildRoadKeepOutMask(mapData, width, height, roadProtect, margin) {
    const mask = new Uint8Array(width * height);
    if (!roadProtect) return mask;

    const road = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isRoadProtectedPosition(mapData, x, y, width, height, roadProtect)) {
          road.push(x, y);
        }
      }
    }

    for (let i = 0; i < road.length; i += 2) {
      const rx = road[i];
      const ry = road[i + 1];
      const y0 = Math.max(0, ry - margin);
      const y1 = Math.min(height - 1, ry + margin);
      const x0 = Math.max(0, rx - margin);
      const x1 = Math.min(width - 1, rx + margin);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  /**
   * Generate procedural terrain for a road biome
   * Uses road generation utilities from ProceduralMapRoadGenerator
   * Handles water edge drawing and biome blending
   */
  function generateRoadBiome(biome, seed, allFeatures, roadDirection, adjacentBiomes, cacheInfo, worldCoords, cache) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const mapData = new Array(width * height * 4).fill(0);
    const rng = createSeededRandom(seed);

    let roadTileId = 2816;
    const roadConfig = parseRoadConfig(biome.name);

    if (roadConfig) {
      roadTileId = roadConfig.tileId;
    } else if (allFeatures["Road"] && allFeatures["Road"].length > 0) {
      // Extract first single-tile variant from Road feature
      for (const variant of allFeatures["Road"]) {
        if (variant.type === "single") {
          roadTileId = variant.tileId;
          break;
        }
      }
    }

    // Get orientation-specific dashed center-line tile IDs for road markings
    const dashedLines = getDashedLineTileIds(allFeatures);

    // The terrain biome this road is painted over on the world map, if any.
    // Its features dress the verges so a road through a forest reads as a road
    // through a forest. Resolved against the ROAD tileset's own feature table
    // (`allFeatures`): the road tileset shares only A2/A5/B with the terrain
    // tilesets, and its C/D/E sheets hold road prefab graphics, so anything the
    // road tileset does not define is simply skipped rather than drawn as a
    // stray gas-station tile.
    const underBiome = getUnderlyingTerrainBiome(biome);

    // Build expanded allFeatures to include features from adjacent biomes
    // This allows road biomes to blend terrain from adjacent biomes even if they use different tilesets
    const expandedAllFeatures = { ...allFeatures };
    if (adjacentBiomes) {
      for (const biomeName of Object.values(adjacentBiomes)) {
        if (!biomeName) continue;

        const adjacentBiome = getBiomeByName(biomeName);
        if (!adjacentBiome) continue;

        // Add tilesets from adjacent biome to expanded features
        const adjacentTilesetIds = adjacentBiome.tilesetIds || [adjacentBiome.tilesetId];
        for (const tilesetId of adjacentTilesetIds) {
          const adjacentFeatures = Utils2.Cache.getTilesetFeatures(tilesetId);
          for (const [name, tiles] of Object.entries(adjacentFeatures)) {
            if (!expandedAllFeatures[name]) {
              expandedAllFeatures[name] = [];
            }
            expandedAllFeatures[name] = expandedAllFeatures[name].concat(tiles);
          }
        }
      }
    }

    // Store adjacent biome terrain data for use AFTER road generation
    // This ensures terrain blending doesn't overwrite the roads themselves
    const adjacentTerrainTiles = {
      north: [],
      south: [],
      east: [],
      west: [],
    };

    // Collect terrain features from each adjacent biome
    if (adjacentBiomes) {
      for (const [direction, biomeName] of Object.entries(adjacentBiomes)) {
        if (!biomeName) continue;

        const adjacentBiome = getBiomeByName(biomeName);
        if (!adjacentBiome || !adjacentBiome.features) continue;

        // Get terrain features from adjacent biome
        for (const feature of adjacentBiome.features) {
          const featureName = typeof feature === "string" ? feature : feature.name;
          const isTerrain = typeof feature === "object" && feature.terrain === true;

          // Exclude road-related terrain features from blending
          const excludedTerrains = ["Road", "Path", "Sidewalk", "DashedLine", "DashedLineHorizontal", "DashedLineVertical"];

          // Only include terrain features (not road-related)
          // Use expandedAllFeatures so we can access tiles from adjacent biomes' tilesets
          if (isTerrain && !excludedTerrains.includes(featureName) && expandedAllFeatures[featureName]) {
            for (const variant of expandedAllFeatures[featureName]) {
              if (variant.type === "single" && variant.tileId) {
                adjacentTerrainTiles[direction].push(variant.tileId);
              }
            }
          }
        }
      }
    }

    // Initialize map with fallback terrain before drawing roads
    // This will be visible only in areas outside the road
    //
    // When the road runs across a known terrain biome, that biome's own ground
    // is the base: a road over Desert lies on sand, not on the generic grass the
    // adjacent-biome mix used to fall back to. Blending from the neighbours
    // still runs afterwards, so borders stay soft.
    const underTerrainPool = underBiome ? collectTerrainTilePool(underBiome, allFeatures) : [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = calculateIndex(x, y, 0, width, height);

        if (underTerrainPool.length > 0) {
          mapData[idx] = randomChoice(randomChoice(underTerrainPool, rng), rng);
          continue;
        }

        const distFromTop = y;
        const distFromBottom = height - 1 - y;
        const distFromLeft = x;
        const distFromRight = width - 1 - x;

        // Determine which adjacent biome is closest based on position
        // North edge: top rows
        if (distFromTop <= distFromBottom && distFromTop <= distFromLeft && distFromTop <= distFromRight && adjacentTerrainTiles.north.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.north, rng);
        }
        // South edge: bottom rows
        else if (distFromBottom <= distFromTop && distFromBottom <= distFromLeft && distFromBottom <= distFromRight && adjacentTerrainTiles.south.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.south, rng);
        }
        // East edge: right columns
        else if (distFromRight <= distFromTop && distFromRight <= distFromBottom && distFromRight <= distFromLeft && adjacentTerrainTiles.east.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.east, rng);
        }
        // West edge: left columns
        else if (distFromLeft <= distFromTop && distFromLeft <= distFromBottom && distFromLeft <= distFromRight && adjacentTerrainTiles.west.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.west, rng);
        }
        // Center: use a mix of all available terrains, or fallback to Grass
        else {
          let availableTiles = [];
          for (const tiles of Object.values(adjacentTerrainTiles)) {
            availableTiles = availableTiles.concat(tiles);
          }

          if (availableTiles.length > 0) {
            mapData[idx] = randomChoice(availableTiles, rng);
          } else {
            // Fallback to Grass if no terrain features found
            const grassTiles = [];
            if (allFeatures["Grass"] && allFeatures["Grass"].length > 0) {
              for (const variant of allFeatures["Grass"]) {
                if (variant.type === "single") {
                  grassTiles.push(variant.tileId);
                }
              }
            }
            mapData[idx] = grassTiles.length > 0 ? randomChoice(grassTiles, rng) : 2816;
          }
        }
      }
    }

    // Draw water edges if adjacent to water biomes
    let waterTiles = [];
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTiles.push(variant.tileId);
          }
        }
        if (waterTiles.length > 0) break;
      }
    }

    // Only draw water edges on non-cave biomes
    if (
      !isCaveBiome(biome.name) &&
      adjacentBiomes &&
      Object.values(adjacentBiomes).some((b) => b && isWaterBiome(b))
    ) {
      if (waterTiles.length > 0) {
        drawWaterEdges(
          mapData,
          waterTiles,
          adjacentBiomes,
          seed,
          width,
          height,
          rng,
          cacheInfo,
          allFeatures,
          biome.name
        );
      }
    }

    // Draw water corners if adjacent diagonals contain water biomes (only on non-cave biomes)
    if (!isCaveBiome(biome.name) && cacheInfo && cache) {
      const diagonalBiomes = checkDiagonalMapBiomesFromCache(
        worldCoords?.x || 0,
        worldCoords?.y || 0,
        cache
      );
      if (
        waterTiles.length > 0 &&
        (diagonalBiomes.topLeft.length > 0 ||
          diagonalBiomes.topRight.length > 0 ||
          diagonalBiomes.bottomLeft.length > 0 ||
          diagonalBiomes.bottomRight.length > 0)
      ) {
        drawWaterCorners(
          mapData,
          waterTiles,
          width,
          height,
          seed,
          rng,
          diagonalBiomes,
          allFeatures,
          biome.name
        );
      }
    }

    // After drawing water edges and corners, collect actual beach/water tile IDs
    // Only collect tiles that are at beach coordinates to avoid blocking all terrain blending
    const actualWaterAndBeachTiles = new Set();
    const beachCoords = window.ProcGenUtils?.beachCoordinates;
    if (beachCoords) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Only protect tiles that are specifically at beach coordinates
          if (beachCoords.has(`${x},${y}`)) {
            const baseIdx = calculateIndex(x, y, 0, width, height);
            const tileId = mapData[baseIdx];
            if (tileId > 0) {
              actualWaterAndBeachTiles.add(tileId);
            }
          }
        }
      }
    }
    const actualWaterTilesArray = Array.from(actualWaterAndBeachTiles);

    // Use road drawing utilities from ProceduralMapRoadGenerator
    generateRoadBiomeUtil(mapData, biome, roadTileId, roadDirection, dashedLines, width, height, adjacentBiomes);

    // Nothing may be placed on the carriageway or within ROAD_FEATURE_MARGIN
    // tiles of it: a tree on the shoulder blocks the lane the cars drive in and
    // reads as an obstacle rather than scenery.
    const roadProtect = getRoadProtectTiles(biome, allFeatures);
    const roadKeepOut = buildRoadKeepOutMask(mapData, width, height, roadProtect, ROAD_FEATURE_MARGIN);

    // Blend terrain from adjacent biomes into road borders
    // Use the actual water tiles to avoid overwriting beaches
    blendBiomesTerrainOnly(mapData, biome, adjacentBiomes, expandedAllFeatures, width, height, seed, rng, worldCoords, actualWaterTilesArray);

    // Blend non-terrain features from adjacent biomes (only B sheet tiles)
    // Use the actual water tiles collected from the map after drawWaterEdges
    blendBiomeBorders(mapData, biome, adjacentBiomes, expandedAllFeatures, width, height, seed, rng, worldCoords, actualWaterTilesArray, roadKeepOut);

    // Dress the verges with the underlying biome's own features (trees, rocks,
    // weeds...). Prefabs are deliberately NOT taken from that biome: a road map
    // only ever places the road biome's own prefabs.
    if (underBiome) {
      const roadPathTiles = [];
      for (const featureName of ["Path", "PathDesert", "PathIce", "Road", "DashedLine", "DashedLineHorizontal", "DashedLineVertical"]) {
        if (!allFeatures[featureName]) continue;
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") roadPathTiles.push(variant.tileId);
        }
      }

      for (const feature of getFeaturesByLayer(underBiome, allFeatures, 1, FEATURE_LAYERS)) {
        generateFeatureNoise(
          mapData, allFeatures[feature.name], 1, width, height, seed,
          0.15 * feature.density, rng, actualWaterTilesArray, roadPathTiles, roadKeepOut
        );
      }

      for (const feature of getFeaturesByLayer(underBiome, allFeatures, 2, FEATURE_LAYERS)) {
        generateFeatureScattered(
          mapData, allFeatures[feature.name], 2, width, height, seed,
          0.05 * feature.density, rng, actualWaterTilesArray, roadPathTiles, roadKeepOut
        );
      }
    }

    // Create region data for water tile detection in MovementInteractionSystem
    const regiondata = new Array(width * height).fill(0);

    // Identify water tile IDs from the biome features
    let waterTileIds = new Set();
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTileIds.add(variant.tileId);
          }
        }
      }
    }

    // Mark all water tiles with region ID 99 for MovementInteractionSystem detection
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const baseIdx = calculateIndex(x, y, 0, width, height);
        const tileId = mapData[baseIdx];

        if (waterTileIds.has(tileId)) {
          const regionIdx = y * width + x;
          regiondata[regionIdx] = 99;
        }
      }
    }

    // Attach region data to map data for $gameMap.regionId() calls
    mapData.regiondata = regiondata;

    return mapData;
  }

  // ===== ROAD / RIVER SPANNING ADJACENCY =====

  /**
   * Copy an adjacency table with two opposite sides forced to a connectable
   * biome, so the road/river generators run that axis border to border instead
   * of terminating it in a rounded dead-end head at the map centre.
   */
  function spanningAdjacency(base, sideA, sideB, value) {
    const adj = Object.assign(
      { north: null, south: null, east: null, west: null },
      base || {}
    );
    adj[sideA] = value;
    adj[sideB] = value;
    return adj;
  }

  /**
   * Force a linear road to cross its own tile.
   *
   * The world-map road network is drawn as a stair-stepped diagonal, so a road
   * tile's neighbours along its own axis are frequently plain terrain rather
   * than another road: 17% of road tiles on map 315 have no orthogonal road
   * neighbour on their axis at all, and only 40% have one at both ends. The
   * dead-end logic then collapsed those maps to a stub and no road (and so no
   * dashed centre line) was drawn. A road tile means the carriageway passes
   * through, so its own axis is always opened.
   *
   * Intersections (cross / t- / corner) already open their arms at the border,
   * so their adjacency is left untouched.
   */
  function spanningRoadAdjacency(base, direction) {
    const d = (direction || "").toLowerCase();
    if (d.includes("cross") || d.includes("t-") || d.includes("corner-")) {
      return base;
    }
    return d.includes("vertical")
      ? spanningAdjacency(base, "north", "south", "Road")
      : spanningAdjacency(base, "east", "west", "Road");
  }

  // ===== BRIDGE GENERATION WRAPPER =====

  /**
   * Generate a river crossing for a world-map bridge marker.
   *
   * The two generators are run in order so the deck ends up on top:
   *   1. the river generator lays down the banks and the water channel, running
   *      perpendicular to the bridge, and
   *   2. the road generator draws the carriageway over it along the bridge's own
   *      orientation, replacing the water it spans with road.
   *
   * The result is a road that crosses the channel instead of being flooded by
   * it, which is what the old road/river biome overlap produced.
   *
   * @param {string} bridgeDirection - "vertical" or "horizontal" (the road's run)
   */
  function generateBridgeBiome(biome, seed, allFeatures, bridgeDirection, adjacentBiomes, cacheInfo, worldCoords, cache) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;

    // The river always crosses the bridge, so it runs the other way.
    const isVerticalBridge = bridgeDirection === "vertical";
    const riverDirection = isVerticalBridge ? "horizontal" : "vertical";

    // Both generators dead-end an axis whose neighbouring biome does not continue
    // it. On a crossing that is always wrong: half the world-map bridges sit
    // between plain Fields tiles, so the deck collapsed to a stub and no road was
    // visible at all. A bridge spans by definition, so force the two axes open and
    // keep the real neighbours on the other sides for bank/verge blending.
    const riverAdjacent = isVerticalBridge
      ? spanningAdjacency(adjacentBiomes, "east", "west", "River")
      : spanningAdjacency(adjacentBiomes, "north", "south", "River");
    const roadAdjacent = isVerticalBridge
      ? spanningAdjacency(adjacentBiomes, "north", "south", "Road")
      : spanningAdjacency(adjacentBiomes, "east", "west", "Road");

    // 1. River first: banks + water channel, running bank to bank.
    const mapData = generateRiverBiome(
      biome, seed, allFeatures, riverDirection, riverAdjacent, cacheInfo, worldCoords, cache
    );

    // 2. Road over it: same tile selection the plain road biome uses.
    let roadTileId = 2816;
    const roadConfig = parseRoadConfig(biome.name);
    if (roadConfig) {
      roadTileId = roadConfig.tileId;
    } else if (allFeatures["Road"] && allFeatures["Road"].length > 0) {
      for (const variant of allFeatures["Road"]) {
        if (variant.type === "single") {
          roadTileId = variant.tileId;
          break;
        }
      }
    }

    const dashedLines = getDashedLineTileIds(allFeatures);
    generateRoadBiomeUtil(mapData, biome, roadTileId, bridgeDirection, dashedLines, width, height, roadAdjacent);

    log(`[ProceduralMapBiomeGenerator] Bridge: ${bridgeDirection} road over ${riverDirection} river`);

    return mapData;
  }

  // ===== RIVER GENERATION WRAPPER =====

  /**
   * Generate procedural terrain for a river biome
   * Uses river generation utilities from ProceduralMapRiverGenerator
   * Handles water edge drawing and biome blending
   */
  function generateRiverBiome(biome, seed, allFeatures, riverDirection, adjacentBiomes, cacheInfo, worldCoords, cache) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const mapData = new Array(width * height * 4).fill(0);
    const rng = createSeededRandom(seed);

    let riverTileId = 2816;
    const riverConfig = parseRiverConfig(biome.name);

    if (riverConfig) {
      riverTileId = riverConfig.tileId;
    } else if (allFeatures["Water"] && allFeatures["Water"].length > 0) {
      // Extract first single-tile variant from Water feature
      for (const variant of allFeatures["Water"]) {
        if (variant.type === "single") {
          riverTileId = variant.tileId;
          break;
        }
      }
    }

    // Get terrain features from adjacent biomes (north, south, east, west)
    // Terrain features are those with terrain: true
    const adjacentTerrainTiles = {
      north: [],
      south: [],
      east: [],
      west: [],
    };

    // Collect terrain features from each adjacent biome
    if (adjacentBiomes) {
      for (const [direction, biomeName] of Object.entries(adjacentBiomes)) {
        if (!biomeName) continue;

        const adjacentBiome = getBiomeByName(biomeName);
        if (!adjacentBiome || !adjacentBiome.features) continue;

        // Get terrain features from adjacent biome
        for (const feature of adjacentBiome.features) {
          const featureName = typeof feature === "string" ? feature : feature.name;
          const isTerrain = typeof feature === "object" && feature.terrain === true;

          // Exclude road-related terrain features and water features from blending
          const excludedTerrains = ["Road", "Path", "Sidewalk", "DashedLine", "DashedLineHorizontal", "DashedLineVertical", "Water", "RiverEdge"];

          // Only include terrain features (not road-related or water features)
          if (isTerrain && !excludedTerrains.includes(featureName) && allFeatures[featureName]) {
            for (const variant of allFeatures[featureName]) {
              if (variant.type === "single" && variant.tileId) {
                adjacentTerrainTiles[direction].push(variant.tileId);
              }
            }
          }
        }
      }
    }

    // Fill terrain layer with adjacent biome terrain based on distance from edge
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = calculateIndex(x, y, 0, width, height);

        // Determine which adjacent biome is closest based on position
        // North edge: top rows
        if (y < height / 4 && adjacentTerrainTiles.north.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.north, rng);
        }
        // South edge: bottom rows
        else if (y >= (height * 3) / 4 && adjacentTerrainTiles.south.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.south, rng);
        }
        // East edge: right columns
        else if (x >= (width * 3) / 4 && adjacentTerrainTiles.east.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.east, rng);
        }
        // West edge: left columns
        else if (x < width / 4 && adjacentTerrainTiles.west.length > 0) {
          mapData[idx] = randomChoice(adjacentTerrainTiles.west, rng);
        }
        // Center: use a mix of all available terrains, or fallback to Grass
        else {
          let availableTiles = [];
          for (const tiles of Object.values(adjacentTerrainTiles)) {
            availableTiles = availableTiles.concat(tiles);
          }

          if (availableTiles.length > 0) {
            mapData[idx] = randomChoice(availableTiles, rng);
          } else {
            // Fallback to Grass if no terrain features found
            const grassTiles = [];
            if (allFeatures["Grass"] && allFeatures["Grass"].length > 0) {
              for (const variant of allFeatures["Grass"]) {
                if (variant.type === "single") {
                  grassTiles.push(variant.tileId);
                }
              }
            }
            mapData[idx] = grassTiles.length > 0 ? randomChoice(grassTiles, rng) : 2816;
          }
        }
      }
    }

    // Use river drawing utilities from ProceduralMapRiverGenerator.
    // Pass the full feature set so the river can place reeds/rocks/grass-water,
    // and the adjacent biomes + seed so it can dead-end at unconnected sides.
    generateRiverBiomeUtil(mapData, biome, riverTileId, riverDirection, allFeatures, width, height, adjacentBiomes, seed, rng);

    // After drawing river, collect actual beach/water tile IDs so the blend
    // passes never drop foreign terrain/features onto the water. On a river map
    // the whole river surface must stay water with only its own reed/rock
    // decoration, so the river tile itself and every Water/Ocean/Beach tile are
    // protected in addition to the beach-coordinate tiles.
    const actualWaterAndBeachTiles = new Set();
    actualWaterAndBeachTiles.add(riverTileId);
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single" && variant.tileId) {
            actualWaterAndBeachTiles.add(variant.tileId);
          }
        }
      }
    }
    const beachCoords = window.ProcGenUtils?.beachCoordinates;
    if (beachCoords) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Only protect tiles that are specifically at beach coordinates
          if (beachCoords.has(`${x},${y}`)) {
            const baseIdx = calculateIndex(x, y, 0, width, height);
            const tileId = mapData[baseIdx];
            if (tileId > 0) {
              actualWaterAndBeachTiles.add(tileId);
            }
          }
        }
      }
    }
    const actualWaterTilesArray = Array.from(actualWaterAndBeachTiles);

    // Blend terrain from adjacent biomes into river borders
    // Use the actual water tiles to avoid overwriting beaches
    blendBiomesTerrainOnly(mapData, biome, adjacentBiomes, allFeatures, width, height, seed, rng, worldCoords, actualWaterTilesArray);

    // Blend non-terrain features from adjacent biomes (excluding road features)
    // Use the actual water tiles collected from the map after river generation
    blendBiomeBorders(mapData, biome, adjacentBiomes, allFeatures, width, height, seed, rng, worldCoords, actualWaterTilesArray);

    // Create region data for water tile detection in MovementInteractionSystem
    const regiondata = new Array(width * height).fill(0);

    // Identify water tile IDs from the biome features
    let waterTileIds = new Set();
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTileIds.add(variant.tileId);
          }
        }
      }
    }

    // Mark all water tiles with region ID 99 for MovementInteractionSystem detection
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const baseIdx = calculateIndex(x, y, 0, width, height);
        const tileId = mapData[baseIdx];

        if (waterTileIds.has(tileId)) {
          const regionIdx = y * width + x;
          regiondata[regionIdx] = 99;
        }
      }
    }

    // Attach region data to map data for $gameMap.regionId() calls
    mapData.regiondata = regiondata;

    return mapData;
  }

  // ===== MAIN TERRAIN GENERATION =====

  /**
   * Generate procedural terrain for a biome
   */

  /**
   * Select feature variants for cave biome
   * For features appearing multiple times, randomly selects 1-4 variants to use
   * Only processes features listed in the biome definition
   * Returns map of feature name to array of selected variants
   */
  function selectCaveFeatureVariants(biome, allFeatures, seed) {
    const selectedVariants = {};
    const rng = createSeededRandom(seed);

    // Get only the features specified in the biome definition
    const biomeFeatureNames = biome.features
      .map(f => typeof f === 'string' ? f : f.name)
      .filter(name => !["CaveFloor", "Ceiling", "CaveWall"].includes(name));

    // For each feature in the biome, select 1-4 variants
    for (const featureName of biomeFeatureNames) {
      const variants = allFeatures[featureName];
      if (!variants || variants.length === 0) continue;

      // Determine number of variants to use (1-4, or all if less than 4)
      const maxVariants = Math.min(variants.length, 4);
      const numVariantsToUse = Math.floor(rng() * maxVariants) + 1;

      // Shuffle variants and select top N
      const shuffled = [...variants];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      selectedVariants[featureName] = shuffled.slice(0, numVariantsToUse);
    }

    return selectedVariants;
  }

  function selectMountainFeatureVariants(biome, allFeatures, seed) {
    const selectedVariants = {};
    const rng = createSeededRandom(seed);

    // Get only the features specified in the biome definition
    const biomeFeatureNames = biome.features
      .map(f => typeof f === 'string' ? f : f.name)
      .filter(name => !["Ceiling", "MountainWall"].includes(name));

    // For each feature in the biome, select 1-4 variants
    for (const featureName of biomeFeatureNames) {
      const variants = allFeatures[featureName];
      if (!variants || variants.length === 0) continue;

      // Determine number of variants to use (1-4, or all if less than 4)
      const maxVariants = Math.min(variants.length, 4);
      const numVariantsToUse = Math.floor(rng() * maxVariants) + 1;

      // Shuffle variants and select top N
      const shuffled = [...variants];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      selectedVariants[featureName] = shuffled.slice(0, numVariantsToUse);
    }

    return selectedVariants;
  }

  /**
   * Generate cave biome terrain - uses separate rendering path without scattered terrain features
   * Only generates cave structure (floor, ceiling, walls) and places features on floor tiles
   */
  function generateCaveBiomeTerrain(
    biome,
    seed,
    allFeatures,
    worldCoords
  ) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const mapData = new Array(width * height * 4).fill(0);

    const rng = createSeededRandom(seed);

    // Get CaveFloor and Ceiling tiles
    const caveFloorTiles = allFeatures["CaveFloor"] || [];
    const caveWallTiles = allFeatures["Ceiling"] || [];

    // Select a single CaveFloor variant seeded by the world-seeded master seed
    const caveFloorRng = createSeededRandom((seed ^ 0x0caf) >>> 0);
    const selectedFloorVariant = caveFloorTiles.length > 0 ?
      caveFloorTiles[Math.floor(caveFloorRng() * caveFloorTiles.length)] :
      null;

    const caveFloorTile = selectedFloorVariant ?
      (selectedFloorVariant.type === "single" ? selectedFloorVariant.tileId : selectedFloorVariant.tiles[0][0]) :
      0;
    const caveWallTile = caveWallTiles.length > 0 ?
      (caveWallTiles[0].type === "single" ? caveWallTiles[0].tileId : caveWallTiles[0].tiles[0][0]) :
      0;

    // Select cave generation method based on world coordinates
    let caveData;
    // Hash world coordinates to pick generation method (0, 1, or 2)
    const methodHash = seed >>> 0;
    const generationMethod = methodHash % 3;

    switch (generationMethod) {
      case 0:
        // Drunken walk: Creates linear passages (carve ~40% of map)
        caveData = generateCaveWithDrunkenWalk(
          width,
          height,
          width,
          0.4,
          seed,
          caveFloorTile,
          caveWallTile
        );
        break;
      case 1:
        // Cellular automata: Natural-looking interconnected chambers
        caveData = generateCaveWithCellularAutomata(
          width,
          height,
          width,
          seed,
          caveFloorTile,
          caveWallTile
        );
        break;
      case 2:
        // Voronoi: Geometric crystal-like chambers
        caveData = generateCaveWithVoronoi(
          width,
          height,
          width,
          seed,
          caveFloorTile,
          caveWallTile
        );
        break;
    }

    // Copy cave data to main mapData
    for (let i = 0; i < caveData.length; i++) {
      mapData[i] = caveData[i];
    }

    // Place CaveWall tiles below each Ceiling (3 tiles south)
    // Only if Ceiling is directly above CaveFloor
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = calculateIndex(x, y, 0, width, height);
        // If this is a Ceiling tile
        if (mapData[idx] === caveWallTile) {
          // Check if tile directly below is CaveFloor
          const belowIdx = calculateIndex(x, y + 1, 0, width, height);
          if (y + 1 < height && mapData[belowIdx] === caveFloorTile) {
            // Place 3 CaveWall tiles below (south) if they're not Ceiling
            for (let dy = 1; dy <= 3; dy++) {
              const wallY = y + dy;
              if (wallY < height) {
                const wallIdx = calculateIndex(x, wallY, 0, width, height);
                // Only place if it's not already a Ceiling
                if (mapData[wallIdx] !== caveWallTile) {
                  // Get CaveWall tile from features
                  const caveWallFeatureTiles = allFeatures["CaveWall"] || [];
                  const wallTile = caveWallFeatureTiles.length > 0 ?
                    (caveWallFeatureTiles[0].type === "single" ? caveWallFeatureTiles[0].tileId : caveWallFeatureTiles[0].tiles[0][0]) :
                    caveWallTile;
                  mapData[wallIdx] = wallTile;
                }
              }
            }
          }
        }
      }
    }

    // Seal cave borders with Ceiling tiles (3 tiles thick from each edge)
    const borderThickness = 5;  // 3 tiles from edge

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let shouldSeal = false;

        // Seal all borders
        if (y < borderThickness || y >= height - borderThickness || x < borderThickness || x >= width - borderThickness) {
          shouldSeal = true;
        }

        if (shouldSeal) {
          const idx = calculateIndex(x, y, 0, width, height);
          mapData[idx] = caveWallTile;
        }
      }
    }

    // Create safe spawn area in center (7x7 cleared area)
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const spawnAreaRadius = 3; // Creates 7x7 area (radius 3 = 7 tiles diameter)

    for (let dy = -spawnAreaRadius; dy <= spawnAreaRadius; dy++) {
      for (let dx = -spawnAreaRadius; dx <= spawnAreaRadius; dx++) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const idx = calculateIndex(x, y, 0, width, height);
          mapData[idx] = caveFloorTile;
        }
      }
    }

    // Find a valid destination in the cave for the tunnel (not in spawn area, not a wall)
    // Search for cave floor tiles outside the spawn area
    const potentialDestinations = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = calculateIndex(x, y, 0, width, height);
        const distanceFromCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));

        // Must be outside spawn area (distance > 10) and be a floor tile
        if (distanceFromCenter > 10 && mapData[idx] === caveFloorTile) {
          potentialDestinations.push({ x, y });
        }
      }
    }

    // Generate tunnel from spawn area to a random cave location
    if (potentialDestinations.length > 0) {
      // Pick a random destination
      const destination = potentialDestinations[Math.floor(rng() * potentialDestinations.length)];

      // Carve tunnel using a simple line algorithm with some width
      const tunnelWidth = 2; // 5 tiles wide tunnel (2 radius)
      let currentX = centerX;
      let currentY = centerY;
      const destX = destination.x;
      const destY = destination.y;

      // Use Bresenham's line algorithm to create tunnel path
      const dx = Math.abs(destX - currentX);
      const dy = Math.abs(destY - currentY);
      const sx = currentX < destX ? 1 : -1;
      const sy = currentY < destY ? 1 : -1;
      let err = dx - dy;

      // Store tunnel positions for wall placement
      const tunnelPositions = [];

      while (true) {
        // Carve tunnel with width
        for (let ty = -tunnelWidth; ty <= tunnelWidth; ty++) {
          for (let tx = -tunnelWidth; tx <= tunnelWidth; tx++) {
            const nx = currentX + tx;
            const ny = currentY + ty;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const idx = calculateIndex(nx, ny, 0, width, height);
              mapData[idx] = caveFloorTile;
              tunnelPositions.push({ x: nx, y: ny });
            }
          }
        }

        // Check if we reached destination
        if (currentX === destX && currentY === destY) break;

        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          currentX += sx;
        }
        if (e2 < dx) {
          err += dx;
          currentY += sy;
        }
      }

      // Add CaveWall tiles below tunnel ceiling edges (same pattern as rest of cave)
      // Scan entire tunnel area to find all ceiling tiles that are directly above floor tiles
      // Then place 3 CaveWall tiles below those floor positions
      const processedPositions = new Set();

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = calculateIndex(x, y, 0, width, height);

          // If this is a Ceiling tile
          if (mapData[idx] === caveWallTile) {
            // Check if tile directly below is CaveFloor (tunnel floor or cave floor)
            const belowIdx = calculateIndex(x, y + 1, 0, width, height);
            if (y + 1 < height && mapData[belowIdx] === caveFloorTile) {
              const posKey = `${x},${y + 1}`;

              // Avoid processing same position multiple times
              if (!processedPositions.has(posKey)) {
                processedPositions.add(posKey);

                // Place 3 CaveWall tiles below (south) if they're not Ceiling
                for (let dy = 1; dy <= 3; dy++) {
                  const wallY = y + 1 + dy;
                  if (wallY < height) {
                    const wallIdx = calculateIndex(x, wallY, 0, width, height);
                    // Only place if it's not already a Ceiling
                    if (mapData[wallIdx] !== caveWallTile) {
                      // Get CaveWall tile from features
                      const caveWallFeatureTiles = allFeatures["CaveWall"] || [];
                      const wallTile = caveWallFeatureTiles.length > 0 ?
                        (caveWallFeatureTiles[0].type === "single" ? caveWallFeatureTiles[0].tileId : caveWallFeatureTiles[0].tiles[0][0]) :
                        caveWallTile;
                      mapData[wallIdx] = wallTile;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Select which feature variants to use in this cave (1-4 variants per feature type)
    // Only features listed in the biome definition are used
    const selectedFeatures = selectCaveFeatureVariants(biome, allFeatures, seed);

    // Build list of tiles to block (all cave structure tiles)
    // This ensures features only spawn on CaveFloor tiles
    const blockedTiles = [caveWallTile];

    // Add all CaveWall variants
    for (const variant of caveWallTiles) {
      if (variant.type === "single") {
        blockedTiles.push(variant.tileId);
      } else if (variant.type === "grid") {
        for (const row of variant.tiles) {
          for (const tileId of row) {
            blockedTiles.push(tileId);
          }
        }
      }
    }

    // Add CaveWall feature tiles
    const caveWallFeatureTiles = allFeatures["CaveWall"] || [];
    for (const variant of caveWallFeatureTiles) {
      if (variant.type === "single") {
        blockedTiles.push(variant.tileId);
      } else if (variant.type === "grid") {
        for (const row of variant.tiles) {
          for (const tileId of row) {
            blockedTiles.push(tileId);
          }
        }
      }
    }

    // Manually place features on CaveFloor tiles only with strict control
    // Find all CaveFloor tile positions
    const caveFloorPositions = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = calculateIndex(x, y, 0, width, height);
        if (mapData[idx] === caveFloorTile) {
          caveFloorPositions.push({ x, y });
        }
      }
    }

    if (caveFloorPositions.length > 0) {
      // Shuffle positions for random selection
      for (let i = caveFloorPositions.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [caveFloorPositions[i], caveFloorPositions[j]] = [caveFloorPositions[j], caveFloorPositions[i]];
      }

      // Select only 1-3% of available floor tiles for feature placement
      const featureTilesToPlace = Math.max(1, Math.floor(caveFloorPositions.length * 0.02));
      const selectedPositions = caveFloorPositions.slice(0, featureTilesToPlace);

      // Get all features in flat array for random selection
      const allSelectedVariants = [];
      for (const variants of Object.values(selectedFeatures)) {
        allSelectedVariants.push(...variants);
      }

      if (allSelectedVariants.length > 0) {
        // Place one feature per selected position
        for (const pos of selectedPositions) {
          // Randomly choose a variant
          const variant = allSelectedVariants[Math.floor(rng() * allSelectedVariants.length)];

          if (variant) {
            if (variant.type === "single") {
              // Check both layer 1 and 2 are empty before placing
              const idx1 = calculateIndex(pos.x, pos.y, 1, width, height);
              const idx2 = calculateIndex(pos.x, pos.y, 2, width, height);
              if (mapData[idx1] === 0 && mapData[idx2] === 0) {
                // Randomly choose which layer to place on
                const layer = rng() < 0.7 ? 1 : 2;
                const idx = calculateIndex(pos.x, pos.y, layer, width, height);
                mapData[idx] = variant.tileId;
              }
            } else if (variant.type === "grid") {
              // Check if multi-tile feature would overlap forbidden zones
              if (!doesMultiTileFeatureOverlapForbidden(variant.grid, pos.x, pos.y, width, height)) {
                // Safe to place - try to place multi-tile feature
                placeMultiTileFeature(
                  mapData,
                  variant.grid,
                  pos.x,
                  pos.y,
                  1,
                  width,
                  height,
                  new Set(blockedTiles)
                );
              }
            }
          }
        }
      }
    }

    // Clear any features in forbidden zones (borders and center)
    clearForbiddenZoneFeatures(mapData, width, height);

    // Create region data for water tile detection in MovementInteractionSystem
    const regiondata = new Array(width * height).fill(0);

    // Identify water tile IDs from the biome features
    let waterTileIds = new Set();
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTileIds.add(variant.tileId);
          }
        }
      }
    }

    // Mark all water tiles with region ID 99 for MovementInteractionSystem detection
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const baseIdx = calculateIndex(x, y, 0, width, height);
        const tileId = mapData[baseIdx];

        if (waterTileIds.has(tileId)) {
          const regionIdx = y * width + x;
          regiondata[regionIdx] = 99;
        }
      }
    }

    // Attach region data to map data for $gameMap.regionId() calls
    mapData.regiondata = regiondata;

    // Expose the floor tile this cave instance carved with, so the prefab
    // placement pass (which runs afterward, outside this function) can carve
    // adequate open space for any prefab it drops into this organic cave
    // layout instead of assuming the random carve already opened room for it.
    mapData.caveFloorTile = caveFloorTile;

    return mapData;
  }

  /**
   * Generate mountain biome terrain using Perlin noise
   * Creates cliff walls and peaks with variable heights based on noise elevation
   * This is a wrapper that prepares data for the core mountain terrain generator
   */
  function generateMountainSurfaceTerrainForBiome(
    biome,
    seed,
    allFeatures,
    adjacentBiomes,
    cacheInfo,
    worldCoords,
    cache
  ) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;

    // Get Ceiling and MountainWall tiles
    const mountainCeilingTiles = allFeatures["Ceiling"] || [];
    const mountainWallTiles = allFeatures["MountainWall"] || [];

    const mountainCeilingTile = mountainCeilingTiles.length > 0 ?
      (mountainCeilingTiles[0].type === "single" ? mountainCeilingTiles[0].tileId : mountainCeilingTiles[0].tiles[0][0]) :
      0;
    const mountainWallTile = mountainWallTiles.length > 0 ?
      (mountainWallTiles[0].type === "single" ? mountainWallTiles[0].tileId : mountainWallTiles[0].tiles[0][0]) :
      0;

    // Directional cliff-wall tiles that give each mountain face proper left/right
    // corners instead of a flat rock blob. The Ceiling tile still caps the top.
    const firstTileId = (variants) =>
      variants && variants.length > 0
        ? (variants[0].type === "single" ? variants[0].tileId : variants[0].tiles[0][0])
        : 0;
    const cliffTiles = {
      left:   firstTileId(allFeatures["MountainLeft"]),
      center: firstTileId(allFeatures["MountainCenter"]),
      right:  firstTileId(allFeatures["MountainRight"]),
    };

    // First, generate base terrain (normal biome terrain)
    const baseMapData = new Array(width * height * 4).fill(0);
    fillTerrainLayer(baseMapData, biome, allFeatures, width, height, createSeededRandom(seed), adjacentBiomes);

    // Apply mountain terrain on top of base terrain
    // Pass worldCoords to randomize generation parameters for regional variety
    const mapData = generateMountainBiomeTerrain(
      width,
      height,
      width,
      seed,
      mountainCeilingTile,
      mountainWallTile,
      baseMapData,
      worldCoords,
      cliffTiles
    );

    // Collect all water tile IDs for feature placement checks
    let waterTiles = [];
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTiles.push(variant.tileId);
          }
        }
        if (waterTiles.length > 0) break;
      }
    }

    // Create RNG for water and feature placement
    const rng = createSeededRandom(seed + 100);

    // Draw water edges and beaches BEFORE placing features
    // This ensures features won't be placed where water will be drawn
    if (adjacentBiomes && Object.values(adjacentBiomes).some((b) => b && isWaterBiome(b))) {
      if (waterTiles.length > 0) {
        drawWaterEdges(
          mapData,
          waterTiles,
          adjacentBiomes,
          seed,
          width,
          height,
          rng,
          cacheInfo,
          allFeatures,
          biome.name
        );
      }
    }

    // Draw water corners if adjacent diagonals contain water biomes
    if (cacheInfo && cache) {
      const diagonalBiomes = checkDiagonalMapBiomesFromCache(
        worldCoords?.x || 0,
        worldCoords?.y || 0,
        cache
      );
      if (
        waterTiles.length > 0 &&
        (diagonalBiomes.topLeft.length > 0 ||
          diagonalBiomes.topRight.length > 0 ||
          diagonalBiomes.bottomLeft.length > 0 ||
          diagonalBiomes.bottomRight.length > 0)
      ) {
        drawWaterCorners(
          mapData,
          waterTiles,
          diagonalBiomes,
          seed,
          width,
          height,
          cacheInfo,
          allFeatures
        );
      }
    }

    // Now collect ALL water tile IDs actually placed on the map
    // This includes water edges, beaches, and seashells that were just drawn
    let waterTileIdsSet = new Set();
    for (const featureName of ["Water", "Ocean", "Beach", "Seashell"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTileIdsSet.add(variant.tileId);
          }
        }
      }
    }

    // Scan the map and add any actual water tiles that were placed
    const actualWaterTiles = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const baseIdx = calculateIndex(x, y, 0, width, height);
        const tileId = mapData[baseIdx];
        if (waterTileIdsSet.has(tileId)) {
          actualWaterTiles.push(tileId);
        }
      }
    }

    // Block mountain tiles and all water-related tiles from feature placement
    let blockedWaterTiles = [...new Set([...actualWaterTiles, ...waterTiles, mountainCeilingTile, mountainWallTile])];

    // Collect path tiles to NEVER overwrite them (Path, PathDesert, PathIce, Road)
    let pathTiles = [];
    for (const featureName of ["Path", "PathDesert", "PathIce", "Road", "DashedLine", "DashedLineHorizontal", "DashedLineVertical"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            pathTiles.push(variant.tileId);
          }
        }
      }
    }

    // Place biome-specific features (exclude mountains, water, and beach areas)
    const featuresToUse = selectMountainFeatureVariants(biome, allFeatures, seed);
    for (const [featureName, variants] of Object.entries(featuresToUse)) {
      // Determine scatter density based on biome
      const baseDensity = 0.02;
      const density = baseDensity * (biome.featureDensity || 1);

      generateFeatureScattered(
        mapData,
        variants,
        1,  // layer
        width,
        height,
        seed + Object.keys(featuresToUse).indexOf(featureName),
        density,
        rng,
        blockedWaterTiles,
        pathTiles
      );
    }

    // Clear any features in forbidden zones (borders and center)
    clearForbiddenZoneFeatures(mapData, width, height);

    // Create region data for water tile detection in MovementInteractionSystem
    const regiondata = new Array(width * height).fill(0);

    // Identify water tile IDs from the biome features
    let waterTileIds = new Set();
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTileIds.add(variant.tileId);
          }
        }
      }
    }

    // Mark all water tiles with region ID 99 for MovementInteractionSystem detection
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const baseIdx = calculateIndex(x, y, 0, width, height);
        const tileId = mapData[baseIdx];

        if (waterTileIds.has(tileId)) {
          const regionIdx = y * width + x;
          regiondata[regionIdx] = 99;
        }
      }
    }

    // Attach region data to map data for $gameMap.regionId() calls
    mapData.regiondata = regiondata;

    return mapData;
  }

  // Persist the building-lot / placement hints a structure generator wrote onto
  // its allOtherData arg so the (separately hooked) prefab placement pass can
  // align prefabs to those lots instead of falling back to grid placement.
  function _persistStructureHints(allOtherData) {
    if (!$gameSystem || !$gameSystem._procGenData) return;
    $gameSystem._procGenData.structureHints = {
      blockHints: allOtherData.blockHints || null,
      placementHints: allOtherData.placementHints || null,
      allowPrefabReuse: allOtherData.allowPrefabReuse === true,
    };
  }

  /**
   * Build the biome's tileset feature table (merged across all of its tilesets).
   */
  function collectBiomeFeatures(biome) {
    const tilesetIds = biome.tilesetIds || [biome.tilesetId];
    const allFeatures = {};
    for (const tilesetId of tilesetIds) {
      if (!tilesetId) continue;
      let features = null;
      try { features = Cache.getTilesetFeatures(tilesetId); } catch (e) { features = null; }
      if (!features) continue;
      for (const [name, tiles] of Object.entries(features)) {
        if (!allFeatures[name]) allFeatures[name] = [];
        allFeatures[name] = allFeatures[name].concat(tiles);
      }
    }
    return allFeatures;
  }

  /**
   * After a biome map is generated, draw a river through it when the world map
   * paints a river over this coordinate (river tile on world layer 2/3 above a
   * land biome). The biome keeps its own terrain; the river is carved on top with
   * the biome's own Water tile so passability (region 99) and prefab
   * water-avoidance both work automatically. Settlements get a narrower channel
   * that enters from each connected side and ends at the town centre.
   */
  function maybeApplyRiverOverlay(mapData, biome, adjacentBiomes, seed, worldCoords) {
    if (!mapData || !applyRiverOverlay || !worldCoords) return;
    if (!biome || typeof biome !== "object") return;
    const name = biome.name || "";

    // Biomes that never host a surface river overlay: caves/dungeons (subsurface),
    // river/water biomes (already water) and seabed.
    //
    // Roads are excluded too. Overlapping a road biome with a river used to draw
    // the channel straight across the carriageway, which flooded the road and
    // left it impassable. A road crossing water is now only ever produced by an
    // explicit bridge marker on the world map (see generateBridgeBiome), which
    // draws the river first and the road over it.
    if (
      isCaveBiome(name) || isDungeonBiome(name) || isRiverBiome(name) ||
      isWaterBiome(name) || isRoadBiome(name) || /seabed|ocean/i.test(name)
    ) return;

    const R = ($gameSystem && $gameSystem._procGenData && $gameSystem._procGenData.riverCoordMap) || null;
    if (!R) return;
    const wx = worldCoords.x, wy = worldCoords.y;
    if (!R[`${wx},${wy}`]) return; // this coord carries no river

    // The biome's own water tile (matches the prefab water-avoidance scanner).
    const allFeatures = collectBiomeFeatures(biome);
    let waterTile = 0;
    if (allFeatures["Water"]) {
      for (const v of allFeatures["Water"]) {
        if (v.type === "single" && v.tileId) { waterTile = v.tileId; break; }
      }
    }
    if (!waterTile) return; // no water tile in this tileset: cannot draw a river

    const has = (cx, cy) => !!R[`${cx},${cy}`];
    const adj = adjacentBiomes || {};
    const conn = {
      north: has(wx, wy - 1) || isRiverConnectable(adj.north),
      south: has(wx, wy + 1) || isRiverConnectable(adj.south),
      east: has(wx + 1, wy) || isRiverConnectable(adj.east),
      west: has(wx - 1, wy) || isRiverConnectable(adj.west),
    };

    // Narrower channel inside built-up biomes so the river threads the streets
    // instead of flooding them; wider, more natural channel out in the open.
    const isSettlement = isCityBiome(name) || isVillageBiome(name) || isBurgBiome(name);
    const opts = isSettlement
      ? { connectFraction: 0.05, maxFraction: 0.09 }
      : { connectFraction: 0.10, maxFraction: 0.22 };

    const rng = createSeededRandom(((seed >>> 0) ^ 0x51e2c0) >>> 0);
    applyRiverOverlay(mapData, waterTile, conn, allFeatures, PROC_MAP_WIDTH, PROC_MAP_HEIGHT, seed, rng, opts);
  }

  function generateProceduralTerrain(
    biome,
    seed,
    roadDirection,
    adjacentBiomes,
    cacheInfo,
    worldCoords,
    cache
  ) {
    const mapData = generateBiomeBody(
      biome, seed, roadDirection, adjacentBiomes, cacheInfo, worldCoords, cache
    );
    maybeApplyRiverOverlay(mapData, biome, adjacentBiomes, seed, worldCoords);
    applyBunkerFeatures(mapData, biome, worldCoords);
    // A patron's hatch is NOT stamped here: prefabs are applied to this array
    // later still (DataManager.loadMapData, ProceduralMapPrefabs), and a house
    // dropped on the hatch would bury it. PatreonRewards hooks that same load
    // step and stamps after everything, on the exact tile its secret names.
    return mapData;
  }

  function generateBiomeBody(
    biome,
    seed,
    roadDirection,
    adjacentBiomes,
    cacheInfo,
    worldCoords,
    cache
  ) {
    // Clear any hints left over from a previously generated biome so they are
    // never applied to a map that did not produce them.
    if ($gameSystem && $gameSystem._procGenData) $gameSystem._procGenData.structureHints = null;

    // Don't generate roads in cave biomes (roads are surface-only)
    if (isRoadBiome(biome.name) && !isCaveBiome(biome.name)) {
      const tilesetIds = biome.tilesetIds || [biome.tilesetId];
      const allFeatures = {};
      for (const tilesetId of tilesetIds) {
        const features = Cache.getTilesetFeatures(tilesetId);
        for (const [name, tiles] of Object.entries(features)) {
          if (!allFeatures[name]) {
            allFeatures[name] = [];
          }
          allFeatures[name] = allFeatures[name].concat(tiles);
        }
      }

      // A bridge marker fixes the road's orientation (adjacent-biome intersection
      // detection would bend the crossing away from the river it has to span),
      // and the river is drawn underneath it.
      const bridgeDirection =
        ($gameSystem && $gameSystem._procGenData && $gameSystem._procGenData.currentBridgeDirection) || null;
      if (bridgeDirection) {
        return generateBridgeBiome(
          biome, seed, allFeatures, bridgeDirection, adjacentBiomes, cacheInfo, worldCoords, cache
        );
      }

      // Auto-determine the intersection shape from adjacent biomes, so a tile
      // that really is a junction is drawn as one.
      //
      // It may only REFINE the direction, never invent one: with no adjacent
      // road the detector just returns its "horizontal" default, which silently
      // rotated genuine "Road vertical" tiles. The direction the world map
      // states for the tile wins whenever the neighbours say nothing.
      let finalRoadDirection = roadDirection;
      if (adjacentBiomes) {
        const adjacentRoadCount = ["north", "south", "east", "west"].filter(
          (side) => adjacentBiomes[side] && isRoadBiome(adjacentBiomes[side])
        ).length;

        if (adjacentRoadCount > 0) {
          finalRoadDirection = determineRoadIntersectionType(adjacentBiomes, isRoadBiome);
          log(`[ProceduralMapBiomeGenerator] Auto-detected road direction: ${finalRoadDirection}`);
        } else {
          log(`[ProceduralMapBiomeGenerator] No adjacent road: keeping world-map road direction: ${finalRoadDirection}`);
        }
      } else if (finalRoadDirection) {
        log(`[ProceduralMapBiomeGenerator] Using hardcoded road direction (no adjacent biomes available): ${finalRoadDirection}`);
      }
      // Fallback to horizontal if still not determined
      if (!finalRoadDirection) {
        finalRoadDirection = "horizontal";
        log(`[ProceduralMapBiomeGenerator] Using fallback road direction: horizontal`);
      }

      // The carriageway always crosses its own tile (see spanningRoadAdjacency).
      const roadAdjacent = spanningRoadAdjacency(adjacentBiomes, finalRoadDirection);

      return generateRoadBiome(biome, seed, allFeatures, finalRoadDirection, roadAdjacent, cacheInfo, worldCoords, cache);
    }

    // Don't generate rivers in cave biomes (rivers are surface-only)
    if (isRiverBiome(biome.name) && !isCaveBiome(biome.name)) {
      const tilesetIds = biome.tilesetIds || [biome.tilesetId];
      const allFeatures = {};
      for (const tilesetId of tilesetIds) {
        const features = Cache.getTilesetFeatures(tilesetId);
        for (const [name, tiles] of Object.entries(features)) {
          if (!allFeatures[name]) {
            allFeatures[name] = [];
          }
          allFeatures[name] = allFeatures[name].concat(tiles);
        }
      }

      // Auto-determine river intersection type from adjacent biomes
      let finalRiverDirection = roadDirection;
      if (adjacentBiomes) {
        const autoDetectedDirection = determineRiverIntersectionType(adjacentBiomes, isRiverBiome);
        log(`[ProceduralMapBiomeGenerator] Auto-detected river direction: ${autoDetectedDirection}`);
        // Always use auto-detected direction for rivers to ensure proper intersections
        finalRiverDirection = autoDetectedDirection;
      } else if (finalRiverDirection) {
        log(`[ProceduralMapBiomeGenerator] Using hardcoded river direction (no adjacent biomes available): ${finalRiverDirection}`);
      }
      // Fallback to horizontal if still not determined
      if (!finalRiverDirection) {
        finalRiverDirection = "horizontal";
        log(`[ProceduralMapBiomeGenerator] Using fallback river direction: horizontal`);
      }

      return generateRiverBiome(biome, seed, allFeatures, finalRiverDirection, adjacentBiomes, cacheInfo, worldCoords, cache);
    }

    const tilesetIds = biome.tilesetIds || [biome.tilesetId];

    const allFeatures = {};
    for (const tilesetId of tilesetIds) {
      const features = Cache.getTilesetFeatures(tilesetId);
      for (const [name, tiles] of Object.entries(features)) {
        if (!allFeatures[name]) {
          allFeatures[name] = [];
        }
        allFeatures[name] = allFeatures[name].concat(tiles);
      }
    }

    // For cave biomes, use separate cave-only rendering (no scattered terrain
    // features). "CaveDen" is excluded: despite the name it is a dungeon-family
    // structure biome (single sealed chamber with a south-border entrance)
    // rendered by the dungeon generator below.
    if (isCaveBiome(biome.name) && !isDungeonBiome(biome.name)) {
      return generateCaveBiomeTerrain(biome, seed, allFeatures, worldCoords);
    }

    // For mountain biomes, generate Perlin noise-based cliff terrain
    if (isMountainBiome(biome.name)) {
      return generateMountainSurfaceTerrainForBiome(biome, seed, allFeatures, adjacentBiomes, cacheInfo, worldCoords, cache);
    }

    // For Seabed biome, generate underwater cliffs with water tiles as base
    if (biome.name === "Seabed") {
      if (BeachGen && BeachGen.generateSeabedBiomeTerrain) {
        return BeachGen.generateSeabedBiomeTerrain(biome, seed, allFeatures, adjacentBiomes, cacheInfo, worldCoords, cache);
      }
    }

    // For dungeon biomes, use BSP-based dungeon generation
    if (isDungeonBiome(biome.name)) {
      const allOtherData = { worldCoords };
      const mapData = generateDungeonBiomeUtil(biome, seed, allFeatures, adjacentBiomes, allOtherData);
      _persistStructureHints(allOtherData);
      return mapData;
    }

    // For village biomes, use village path and house generation
    if (isVillageBiome(biome.name)) {
      const villageData = { worldCoords };
      const mapData = generateVillageBiomeUtil(biome, seed, allFeatures, adjacentBiomes, villageData);
      _persistStructureHints(villageData);

      // After village generation, scatter terrain features on layers 1 and 2
      const rng = createSeededRandom(seed);

      // Collect water tiles to avoid placing features on them
      let waterTiles = [];
      for (const featureName of ["Water", "Ocean", "Beach"]) {
        if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
          for (const variant of allFeatures[featureName]) {
            if (variant.type === "single") {
              waterTiles.push(variant.tileId);
            }
          }
        }
      }

      // Collect path tiles to NEVER overwrite them (Path, PathDesert, PathIce, Road)
      let pathTiles = [];
      for (const featureName of ["Path", "PathDesert", "PathIce", "Road", "DashedLine", "DashedLineHorizontal", "DashedLineVertical"]) {
        if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
          for (const variant of allFeatures[featureName]) {
            if (variant.type === "single") {
              pathTiles.push(variant.tileId);
            }
          }
        }
      }

      // Scatter features on layer 1 (noise-based)
      for (const feature of getFeaturesByLayer(biome, allFeatures, 1, FEATURE_LAYERS)) {
        generateFeatureNoise(
          mapData,
          allFeatures[feature.name],
          1,
          PROC_MAP_WIDTH,
          PROC_MAP_HEIGHT,
          seed,
          0.15 * feature.density,
          rng,
          waterTiles,
          pathTiles
        );
      }

      // Scatter features on layer 2 (scattered)
      for (const feature of getFeaturesByLayer(biome, allFeatures, 2, FEATURE_LAYERS)) {
        generateFeatureScattered(
          mapData,
          allFeatures[feature.name],
          2,
          PROC_MAP_WIDTH,
          PROC_MAP_HEIGHT,
          seed,
          0.05 * feature.density,
          rng,
          waterTiles,
          pathTiles
        );
      }

      // Crop plots for a biome that farms (see placeTilledFields).
      placeTilledFields(mapData, biome, allFeatures, seed, PROC_MAP_WIDTH, PROC_MAP_HEIGHT);

      // Civic signs: readable signposts (1-3), roadside bus stops, one camper park.
      placeCivicSigns(mapData, biome, allFeatures, seed, {
        post: [1, 3], bus: [2, 3], park: [1, 1],
      });

      return mapData;
    }

    // For city biomes, use grid-based city generation with roads and building lots
    if (isCityBiome(biome.name)) {
      const cityData = { worldCoords };
      const mapData = generateCityBiomeUtil(biome, seed, allFeatures, adjacentBiomes, cityData);
      _persistStructureHints(cityData);
      // Civic signs: roadside bus stops + one camper park (no readable signposts).
      placeCivicSigns(mapData, biome, allFeatures, seed, {
        bus: [3, 5], park: [1, 1],
      });
      return mapData;
    }

    // For burg biomes, use grid-based city generation with roads and building lots
    if (isBurgBiome(biome.name)) {
      const burgData = { worldCoords };
      const mapData = generateBurgBiomeUtil(biome, seed, allFeatures, adjacentBiomes, burgData);
      _persistStructureHints(burgData);
      // Civic signs: roadside bus stops + one camper park (no readable signposts).
      placeCivicSigns(mapData, biome, allFeatures, seed, {
        bus: [2, 4], park: [1, 1],
      });
      return mapData;
    }

    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const mapData = new Array(width * height * 4).fill(0);

    const rng = createSeededRandom(seed);

    // Normal biome terrain generation (non-cave)
    // Fill layer 0 with terrain features (those with terrain: true)
    // Uses weighted distribution based on density values
    fillTerrainLayer(mapData, biome, allFeatures, width, height, rng, adjacentBiomes);

    // Collect all water tiles (single-tile variants only) for feature placement checks
    let waterTiles = [];
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTiles.push(variant.tileId);
          }
        }
        if (waterTiles.length > 0) break;
      }
    }

    // Collect path tiles to NEVER overwrite them (Path, PathDesert, PathIce, Road)
    let pathTiles = [];
    for (const featureName of ["Path", "PathDesert", "PathIce", "Road", "DashedLine", "DashedLineHorizontal", "DashedLineVertical"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            pathTiles.push(variant.tileId);
          }
        }
      }
    }

    // For cave biomes, add Ceiling and CaveWall to blocked tiles (don't place features on them)
    let blockedTiles = [...waterTiles];
    if (isCaveBiome(biome.name)) {
      // Get the actual Ceiling and CaveWall tiles used in generation
      const caveFloorTiles = allFeatures["CaveFloor"] || [];
      const caveWallTiles = allFeatures["Ceiling"] || [];
      const caveWallFeatures = allFeatures["CaveWall"] || [];

      // Block Ceiling tiles
      for (const variant of caveWallTiles) {
        if (variant.type === "single") {
          blockedTiles.push(variant.tileId);
        } else if (variant.type === "multi") {
          for (const row of variant.tiles) {
            for (const tileId of row) {
              blockedTiles.push(tileId);
            }
          }
        }
      }

      // Block CaveWall tiles
      for (const variant of caveWallFeatures) {
        if (variant.type === "single") {
          blockedTiles.push(variant.tileId);
        } else if (variant.type === "multi") {
          for (const row of variant.tiles) {
            for (const tileId of row) {
              blockedTiles.push(tileId);
            }
          }
        }
      }
    }

    // Only draw water edges on non-cave biomes (road biome path)
    if (
      !isCaveBiome(biome.name) &&
      adjacentBiomes &&
      Object.values(adjacentBiomes).some((b) => b && isWaterBiome(b))
    ) {
      if (waterTiles.length > 0) {
        drawWaterEdges(
          mapData,
          waterTiles,
          adjacentBiomes,
          seed,
          width,
          height,
          rng,
          cacheInfo,
          allFeatures,
          biome.name
        );
      }
    }

    // Draw water corners if adjacent diagonals contain water biomes (only on non-cave biomes)
    if (!isCaveBiome(biome.name) && cacheInfo && cache) {
      const diagonalBiomes = checkDiagonalMapBiomesFromCache(
        worldCoords?.x || 0,
        worldCoords?.y || 0,
        cache
      );
      if (
        waterTiles.length > 0 &&
        (diagonalBiomes.topLeft.length > 0 ||
          diagonalBiomes.topRight.length > 0 ||
          diagonalBiomes.bottomLeft.length > 0 ||
          diagonalBiomes.bottomRight.length > 0)
      ) {
        drawWaterCorners(
          mapData,
          waterTiles,
          width,
          height,
          seed,
          rng,
          diagonalBiomes,
          allFeatures,
          biome.name
        );
      }
    }

    // After drawing water edges and corners, collect actual beach/water tile IDs
    // Only collect tiles that are at beach coordinates to avoid blocking all terrain blending
    const actualWaterAndBeachTiles = new Set();
    const beachCoords = window.ProcGenUtils?.beachCoordinates;
    if (beachCoords) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Only protect tiles that are specifically at beach coordinates
          if (beachCoords.has(`${x},${y}`)) {
            const baseIdx = calculateIndex(x, y, 0, width, height);
            const tileId = mapData[baseIdx];
            if (tileId > 0) {
              actualWaterAndBeachTiles.add(tileId);
            }
          }
        }
      }
    }
    const actualWaterTilesArray = Array.from(actualWaterAndBeachTiles);

    for (const feature of getFeaturesByLayer(biome, allFeatures, 1, FEATURE_LAYERS)) {
      generateFeatureNoise(
        mapData,
        allFeatures[feature.name],
        1,
        width,
        height,
        seed,
        0.15 * feature.density,
        rng,
        blockedTiles,
        pathTiles
      );
    }

    for (const feature of getFeaturesByLayer(biome, allFeatures, 2, FEATURE_LAYERS)) {
      generateFeatureScattered(
        mapData,
        allFeatures[feature.name],
        2,
        width,
        height,
        seed,
        0.05 * feature.density,
        rng,
        blockedTiles,
        pathTiles
      );
    }

    // Crop plots for a biome that farms (see placeTilledFields).
    placeTilledFields(mapData, biome, allFeatures, seed, width, height);

    // For cave biomes, remove any features that overlap with Ceiling or CaveWall
    if (isCaveBiome(biome.name)) {
      const caveWallTiles = allFeatures["Ceiling"] || [];
      const caveWallFeatures = allFeatures["CaveWall"] || [];

      // Build set of blocked tile IDs
      const blockedTileSet = new Set();

      // Add Ceiling tiles
      for (const variant of caveWallTiles) {
        if (variant.type === "single") {
          blockedTileSet.add(variant.tileId);
        } else if (variant.type === "multi") {
          for (const row of variant.tiles) {
            for (const tileId of row) {
              blockedTileSet.add(tileId);
            }
          }
        }
      }

      // Add CaveWall tiles
      for (const variant of caveWallFeatures) {
        if (variant.type === "single") {
          blockedTileSet.add(variant.tileId);
        } else if (variant.type === "multi") {
          for (const row of variant.tiles) {
            for (const tileId of row) {
              blockedTileSet.add(tileId);
            }
          }
        }
      }

      // Second pass: remove features on Ceiling or CaveWall tiles
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const baseIdx = calculateIndex(x, y, 0, width, height);
          // If base layer is Ceiling or CaveWall
          if (blockedTileSet.has(mapData[baseIdx])) {
            // Clear any features on layers 1-3
            for (let z = 1; z <= 3; z++) {
              const idx = calculateIndex(x, y, z, width, height);
              mapData[idx] = 0;
            }
          }
        }
      }
    }

    // Blend terrain from adjacent biomes at map borders for seamless transitions
    // Uses global Perlin noise for organic, non-triangular blending
    // Use the actual water tiles to avoid overwriting beaches
    blendBiomesTerrainOnly(mapData, biome, adjacentBiomes, allFeatures, width, height, seed, rng, worldCoords, actualWaterTilesArray);

    // Clear any features in forbidden zones (borders and center)
    if ((biome.name !== "Ocean") && (biome.name !== "Seabed")) {
      clearForbiddenZoneFeatures(mapData, width, height);

    }


    // Create region data for water tile detection in MovementInteractionSystem
    const regiondata = new Array(width * height).fill(0);

    // Identify water tile IDs from the biome features
    let waterTileIds = new Set();
    for (const featureName of ["Water", "Ocean", "Beach"]) {
      if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
        for (const variant of allFeatures[featureName]) {
          if (variant.type === "single") {
            waterTileIds.add(variant.tileId);
          }
        }
      }
    }

    // Mark all water tiles with region ID 99 for MovementInteractionSystem detection
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const baseIdx = calculateIndex(x, y, 0, width, height);
        const tileId = mapData[baseIdx];

        if (waterTileIds.has(tileId)) {
          const regionIdx = y * width + x;
          regiondata[regionIdx] = 99;
        }
      }
    }

    // Attach region data to map data for $gameMap.regionId() calls
    mapData.regiondata = regiondata;

    return mapData;
  }

  // ===== GAME SYSTEM EXTENSIONS =====

  /**
   * Initialize procedural generation data on Game_System
   */
  const _Game_System_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function () {
    _Game_System_initialize.call(this);
    this._procGenData = {
      originX: 0,
      originY: 0,
      currentBiome: null,
      currentRoadDirection: null,
      currentBiomeTileset: null,
      generatedMapData: null,
      biomeToTileset: {},
      mapPreloaded: false,
      seed: 12345,
      biomeCoordinateCache: {},
      lastLoadedProcMapX: null,
      lastLoadedProcMapY: null,
      displayAsBeach: false,
      biomeLayerStack: [],
    };
  };

  /**
   * Build a cache of biome coordinates for all biomes on the world map
   * If the player (actor 1) is named "Test", the cache is always regenerated
   * from scratch to reflect any tile changes made during editing/playtesting.
   */
  Game_System.prototype.buildBiomeCoordinateCache = function () {
    // Test player: force fresh biome cache regeneration
    if (isTestPlayer()) {
      if (this._procGenData) {
        this._procGenData.biomeCoordinateCache = {};
      }
      invalidateBiomeIndex();
      log(`[buildBiomeCoordinateCache] Test player detected: forcing cache regeneration`);
    }

    if (!$gameMap || $gameMap.mapId() !== WORLD_MAP_ID) {
      log(`[buildBiomeCoordinateCache] Cannot build: mapId=${$gameMap ? $gameMap.mapId() : 'null'}, WORLD_MAP_ID=${WORLD_MAP_ID}`);
      return;
    }

    const cache = {};
    const mapWidth = $gameMap.width();
    const mapHeight = $gameMap.height();

    for (const biome of Biomes) {
      cache[biome.name] = [];
    }

    let coordsAdded = 0;
    const riverCoordMap = {};
    const bridgeCoordMap = {};
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const cls = classifyWorldColumn((z) => $gameMap.tileId(x, y, z));
        // Resolve the effective biome up front (Ice -> Permafrost/Tundra, then
        // the specialBiomes roll) so the cache holds "SpiritWoods"/"Crystals"
        // for every tile, not just the ones the player has already generated.
        // The cache is what the travel HUD reads, and it previously stored only
        // parent biomes, so special biomes never surfaced there.
        const biomeName = cls.biome
          ? resolveSpecialBiome(normalizeLatitudeBiome(cls.biome, y), x, y)
          : cls.biome;
        if (biomeName) {
          if (!cache[biomeName]) {
            cache[biomeName] = [];
          }
          cache[biomeName].push({ x, y });
          coordsAdded++;
        }
        if (cls.riverTileId) riverCoordMap[`${x},${y}`] = cls.riverTileId;
        // Bridge markers drive the river+road crossing generation.
        if (cls.bridge) bridgeCoordMap[`${x},${y}`] = cls.bridge;
      }
    }

    this._procGenData.biomeCoordinateCache = cache;
    this._procGenData.riverCoordMap = riverCoordMap;
    this._procGenData.bridgeCoordMap = bridgeCoordMap;

    // Playtesting as "Test" republishes js/db/WorldGen/BiomesMap.json from what
    // was just scanned, so the snapshot shipped to normal players tracks the
    // edits instead of drifting out of date with map 315.
    if (isTestPlayer() && exportBiomesMapToFile) {
      exportBiomesMapToFile(cache, riverCoordMap, bridgeCoordMap);
    }

    const totalCoords = Object.values(cache).reduce(
      (sum, arr) => sum + arr.length,
      0
    );
    log(`[buildBiomeCoordinateCache] Built cache: scanned ${mapWidth}x${mapHeight}=${mapWidth * mapHeight} tiles, added ${coordsAdded} coordinates to ${Object.keys(cache).length} biomes`);

    // Log sample biomes in cache (debug only - skip the per-biome string building otherwise)
    if (Utils.isOptionValid("test")) {
      for (const [biomeName, coords] of Object.entries(cache)) {
        if (coords.length > 0) {
          log(`  ${biomeName}: ${coords.length} coords, samples: (${coords.slice(0, 3).map(c => `${c.x},${c.y}`).join(") (")})`);
        }
      }
    }
  };

  /**
   * Get biome from world tile using highest priority layer
   */
  Game_System.prototype.getBiomeFromWorldCoordinates = function (x, y) {
    // A river painted over a land biome (world-map layer 2/3) must not hijack the
    // tile into a full river-biome map: classify by the underlying biome and let
    // the generator draw the river as an overlay inside it.
    const baseBiome = classifyWorldColumn((z) => $gameMap.tileId(x, y, z)).biome;
    // Mirror the generator: normalize Ice by latitude first, then apply the same
    // specialBiomes roll, so a tile the player has not entered yet still reports
    // SpiritWoods/Crystals rather than its parent biome. Roads/rivers carry a
    // direction suffix, resolve to no biome definition, and pass through as-is.
    return resolveSpecialBiome(normalizeLatitudeBiome(baseBiome, y), x, y);
  };

  /**
   * The terrain biome a road at (x, y) is painted over ("Fields", "Mountain",
   * ...), resolved exactly like the primary biome so a road across SpiritWoods
   * reports SpiritWoods. Returns null when the column is nothing but road.
   */
  Game_System.prototype.getUnderBiomeFromWorldCoordinates = function (x, y) {
    const under = classifyWorldColumn((z) => $gameMap.tileId(x, y, z)).underBiome;
    if (!under) return null;
    return resolveSpecialBiome(normalizeLatitudeBiome(under, y), x, y);
  };

  // ---------------------------------------------------------------------------
  // O(1) biome lookup index
  //
  // getBiomeFromCache used to linear-scan every biome's coordinate array (up to
  // 65,536 {x,y} entries on the 256x256 world map) on every call, and it runs
  // ~2x/sec from the HUD. We build an inverted index (key -> biomeName) once and
  // reuse it. The index lives in module scope so it is never serialized into
  // saves; it is rebuilt automatically whenever the underlying cache object is
  // replaced (build) and explicitly invalidated on in-place mutation.
  // ---------------------------------------------------------------------------
  let _biomeIndex = null; // Map<number, string>
  let _biomeIndexSource = null; // the biomeCoordinateCache object it was built from

  const biomeKey = (x, y) => x * 100000 + y;

  function invalidateBiomeIndex() {
    _biomeIndex = null;
    _biomeIndexSource = null;
  }

  function getBiomeIndex(procGenData) {
    const cache = procGenData ? procGenData.biomeCoordinateCache : null;
    if (!cache) return null;
    if (_biomeIndex && _biomeIndexSource === cache) return _biomeIndex;

    const index = new Map();
    for (const biomeName in cache) {
      const coords = cache[biomeName];
      if (!coords) continue;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        // First biome wins, matching the previous Object.entries scan order.
        const key = biomeKey(c.x, c.y);
        if (!index.has(key)) index.set(key, biomeName);
      }
    }
    _biomeIndex = index;
    _biomeIndexSource = cache;
    return index;
  }

  /**
   * Get biome name from cache for given world coordinates
   */
  Game_System.prototype.getBiomeFromCache = function (x, y) {
    const index = getBiomeIndex(this._procGenData);
    if (index) {
      const biomeName = index.get(biomeKey(x, y));
      // Resolve on read as well as on build. The cache may predate this logic
      // (old saves) or come straight from BiomesMap.json, and either can hold
      // the bare parent biome. Resolving is idempotent -- SpiritWoods/Crystals
      // define no specialBiomes of their own -- so an already-resolved entry
      // passes through unchanged.
      if (biomeName) {
        return resolveSpecialBiome(normalizeLatitudeBiome(biomeName, y), x, y);
      }
    }

    if ($gameMap.mapId() === WORLD_MAP_ID) {
      return this.getBiomeFromWorldCoordinates(x, y);
    }

    return "Fields";
  };

  // ---------------------------------------------------------------------------
  // Country lookup by world coordinate
  //
  // The world map paints one region id per country, matching the `id` field in
  // js/db/WorldGen/Countries.json (WeatherSystem.setCurrentCountry reads the same
  // ids to pick the active country). Quest boards and other UI need that answer
  // for arbitrary coordinates while standing somewhere else entirely, so cache
  // the world map's region plane once. The 1.3MB Map315.json is only read when
  // we are not already standing on it.
  // ---------------------------------------------------------------------------
  let _worldRegionLayer = null; // Uint16Array, one region id per world tile
  let _worldRegionSize = null;  // { width, height } of the layer above

  function worldRegionLayer() {
    if (_worldRegionLayer) return _worldRegionLayer;

    let data = null;
    let w = 0;
    let h = 0;
    if ($gameMap && $gameMap.mapId() === WORLD_MAP_ID && $dataMap && $dataMap.data) {
      data = $dataMap.data;
      w = $dataMap.width;
      h = $dataMap.height;
    } else {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "data/Map" + String(WORLD_MAP_ID).padStart(3, "0") + ".json", false);
        xhr.overrideMimeType("application/json");
        xhr.send();
        if (xhr.status === 200) {
          const map = JSON.parse(xhr.responseText);
          data = map.data;
          w = map.width;
          h = map.height;
        }
      } catch (e) {
        // Leave the cache empty; callers treat a missing layer as "no country".
      }
    }
    if (!data || !w || !h) return null;

    // Plane 5 is the region layer, the same one Game_Map.regionId reads.
    const base = 5 * w * h;
    const layer = new Uint16Array(w * h);
    for (let i = 0; i < w * h; i++) layer[i] = data[base + i] || 0;
    _worldRegionLayer = layer;
    _worldRegionSize = { width: w, height: h };
    return layer;
  }

  /**
   * Region id painted on the world map at (x, y), 0 when unpainted or off-map.
   */
  Game_System.prototype.getWorldRegionId = function (x, y) {
    const layer = worldRegionLayer();
    if (!layer || !_worldRegionSize) return 0;
    const { width, height } = _worldRegionSize;
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return layer[y * width + x];
  };

  /**
   * The Countries.json entry owning world coordinates (x, y), or null on
   * unclaimed ground. Region id 0 means "nothing painted here", and several
   * Countries.json entries carry a placeholder id of 0, so it never resolves to
   * a country. Duplicated ids (Albania/Montenegro, Germany/Portugal) resolve to
   * the first match, exactly as WeatherSystem and ArmyEventsManager do.
   */
  Game_System.prototype.getCountryFromWorldCoordinates = function (x, y) {
    const id = this.getWorldRegionId(x, y);
    if (!id) return null;
    const list = window.WorldGen && window.WorldGen.Countries;
    if (!Array.isArray(list)) return null;
    return list.find(c => c && c.id === id) || null;
  };

  /**
   * Bridge orientation ("vertical" / "horizontal") for world coordinates, or
   * null when the tile is not a river crossing. Reads the cached scan when it is
   * available and falls back to reading the world map column directly.
   */
  Game_System.prototype.getBridgeDirectionAt = function (x, y) {
    const cached = this._procGenData && this._procGenData.bridgeCoordMap;
    if (cached) {
      return cached[`${x},${y}`] || null;
    }

    if ($gameMap && $gameMap.mapId() === WORLD_MAP_ID) {
      for (let z = 3; z >= 0; z--) {
        const dir = getBridgeDirectionFromWorldTileId($gameMap.tileId(x, y, z));
        if (dir) return dir;
      }
    }
    return null;
  };

  /**
   * Get road direction from world coordinates via cache lookup
   */
  Game_System.prototype.getRoadDirectionFromCache = function (x, y) {
    for (let z = 3; z >= 0; z--) {
      const tileId = $gameMap.tileId(x, y, z);
      if (tileId && tileId !== 0) {
        const direction = getRoadDirectionFromWorldTile(tileId);
        if (direction) {
          return direction;
        }
      }
    }
    return null;
  };

  /**
   * Generate procedural map from world map coordinates
   */
  Game_System.prototype.generateProceduralMap = function () {
    const VAR_WORLD_X = 43;
    const VAR_WORLD_Y = 44;

    let originX = $gameVariables.value(VAR_WORLD_X);
    let originY = $gameVariables.value(VAR_WORLD_Y);

    // On the world map the player's current tile IS the world coordinate, so treat it
    // as authoritative and (re)sync vars 43/44 to it. This prevents generating at a
    // stale location after the player walked on the world map without a transfer
    // committing the vars. The cache is only rebuilt if missing (full-map scan).
    //
    // Exception: when the 3D CamperDrivingSystem is active, vars 43/44 are updated
    // per waypoint and reflect the van's actual world position. $gamePlayer.x/y is
    // stuck at the ship vehicle's parked tile, so trust the existing vars instead.
    if ($gameMap.mapId() === WORLD_MAP_ID) {
      if (!window.CamperDrivingSystem || !window.CamperDrivingSystem.isActive()) {
        originX = $gamePlayer.x;
        originY = $gamePlayer.y;

        $gameVariables.setValue(VAR_WORLD_X, originX);
        $gameVariables.setValue(VAR_WORLD_Y, originY);
      }

      // Rebuild when the bridge scan is missing too, so saves made before bridge
      // markers existed pick them up instead of silently generating no crossings.
      //
      // A Test player always rebuilds: the world map is being edited live, so any
      // cache carried in the save describes the map as it was before the edit.
      // Without this the rebuild never runs (the existing cache satisfies the
      // check) and freshly painted roads, rivers and bridges are invisible to the
      // generator. The scan is one pass over map 315 and only ever runs for Test.
      if (
        !this._procGenData.biomeCoordinateCache ||
        !this._procGenData.bridgeCoordMap ||
        isTestPlayer()
      ) {
        this.buildBiomeCoordinateCache();
      }
    } else if (originX === 0 && originY === 0 && !this._procGenData.alienGrid) {
      // Off the world map with an unset origin normally means "never
      // generated yet". An alien planet's landing grid legitimately starts
      // at (0,0) for some squares, so that case is not a bail-out signal.
      return false;
    }

    this._procGenData.originX = originX;
    this._procGenData.originY = originY;

    // Whether the live world-map tile column is readable. Everything that cannot
    // be read off it falls back to the coordinate cache so both entry paths
    // ("Visit X" straight from map 315, or walking across a biome border) resolve
    // the same coordinate to the same map.
    const onWorldMap = $gameMap.mapId() === WORLD_MAP_ID;

    let biomeName = "Fields";
    let roadDirection = null;

    // A GalaxySim alien-planet landing grid (see GalaxySim_Core.js
    // enterPlanetSurface / WorldMapReturn.js's toroidal-wrap edge crossing):
    // (originX, originY) here is the planet-local grid cell, small and
    // bounded, so it must never be checked against Earth's bridge/override
    // caches -- those numbers can coincidentally match real Earth world-map
    // coordinates. The whole planet is a single biome and always resolves
    // directly.
    const alienGrid = this._procGenData.alienGrid;

    // A bridge marker on the world map wins over every other classification:
    // the crossing is always a road running along the marker's orientation with
    // a river drawn underneath it.
    const bridgeDirection = alienGrid ? null : this.getBridgeDirectionAt(originX, originY);
    this._procGenData.currentBridgeDirection = bridgeDirection;

    // Check for hardcoded biome overrides first
    const hardcodedOverride = alienGrid ? null : getHardcodedBiomeOverride(originX, originY);

    if (bridgeDirection) {
      biomeName = "Bridge";
      roadDirection = bridgeDirection;
      log(`[ProceduralMap] Bridge (${bridgeDirection}) at (${originX}, ${originY})`);
    } else if (alienGrid) {
      biomeName = alienGrid.biome;
    } else if (hardcodedOverride) {
      // Use hardcoded biome and optional road direction
      biomeName = hardcodedOverride.biome;
      roadDirection = hardcodedOverride.roadDirection || null;
    } else {
      // Auto-detection reads the LIVE world-map tile column.
      //
      // Do NOT route this through getBiomeFromCache: the coordinate cache can be
      // preloaded from js/db/WorldGen/BiomesMap.json, which is a snapshot that
      // goes stale whenever map 315 is repainted. The committed snapshot lists
      // ~2500 road coordinates for a road network that no longer exists, so real
      // road tiles came back as "Fields" there, isRoadBiome() said no, and the
      // road branch (asphalt + dashed centre line) never ran.
      const worldTileBiome = this.getBiomeFromWorldCoordinates(originX, originY);

      let lookupBiomeName = worldTileBiome;

      if (worldTileBiome.startsWith("Road ")) {
        roadDirection = worldTileBiome.substring(5).toLowerCase();
        lookupBiomeName = "Road";
      }

      biomeName = lookupBiomeName;
    }

    // Ice biome should become Tundra or Permafrost depending on Y coordinate
    if (biomeName === "Ice") {
      // Y=0 is north pole, Y=255 is south pole
      // Tundra: milder cold (mid-latitudes), Permafrost: extreme poles
      if (originY < 48 || originY >= 208) {
        biomeName = "Permafrost";
        log(`[ProceduralMap] Ice -> Permafrost at (${originX}, ${originY})`);
      } else {
        biomeName = "Tundra";
        log(`[ProceduralMap] Ice -> Tundra at (${originX}, ${originY})`);
      }
    }

    const biome = getBiomeByName(biomeName);

    if (!biome) {
      logWarn(`Biome not found: ${biomeName}, using Fields`);
      const defaultBiome = getBiomeByName("Fields");
      if (!defaultBiome) {
        logWarn(`Critical: Fields biome not defined`);
        return false;
      }
      biomeName = "Fields";
    }

    // Apply the shared specialBiomes roll (see ProcGenUtils.resolveSpecialBiome).
    // The same call backs the travel HUD and the debug overlay, so all three
    // agree on which tiles are SpiritWoods/Crystals.
    // A bridge is never rerolled: swapping the biome would drop the crossing.
    const specialBiomeName = bridgeDirection
      ? biomeName
      : resolveSpecialBiome(biomeName, originX, originY);
    if (specialBiomeName !== biomeName) {
      log(`[ProceduralMap] Assigning special biome "${specialBiomeName}" to coordinates (${originX}, ${originY})`);

      // Update cache to reflect the special biome override
      if (this._procGenData.biomeCoordinateCache) {
        // Remove from old biome's coordinate list
        if (this._procGenData.biomeCoordinateCache[biomeName]) {
          this._procGenData.biomeCoordinateCache[biomeName] =
            this._procGenData.biomeCoordinateCache[biomeName].filter(
              coord => !(coord.x === originX && coord.y === originY)
            );
        }

        // Add to new special biome's coordinate list
        if (!this._procGenData.biomeCoordinateCache[specialBiomeName]) {
          this._procGenData.biomeCoordinateCache[specialBiomeName] = [];
        }
        this._procGenData.biomeCoordinateCache[specialBiomeName].push({ x: originX, y: originY });

        // Cache mutated in place (same object identity), so the O(1) index
        // must be rebuilt on its next use.
        invalidateBiomeIndex();

        log(`[ProceduralMap] Cache updated: moved (${originX}, ${originY}) from "${biomeName}" to "${specialBiomeName}"`);
      }

      biomeName = specialBiomeName;
    }

    this._procGenData.currentBiome = biomeName;
    this._procGenData.currentRoadDirection = roadDirection;

    // A road is painted over a terrain biome on the world map. Record it so the
    // road generator can dress the verges with that biome's own features instead
    // of leaving bare asphalt-and-grass. Settlements are excluded: a road through
    // a city/village/burg keeps the plain civic look.
    let underBiomeName = null;
    if (isRoadBiome(biomeName)) {
      const under = this.getUnderBiomeFromWorldCoordinates(originX, originY);
      if (
        under &&
        under !== biomeName &&
        !isRoadBiome(under) &&
        !isCityBiome(under) &&
        !isVillageBiome(under) &&
        !isBurgBiome(under)
      ) {
        underBiomeName = under;
      }
    }
    this._procGenData.currentUnderBiome = underBiomeName;

    const tilesetId = biome.tilesetId;
    this._procGenData.currentBiomeTileset = tilesetId;

    // Store biome temperature data for weather system
    this._procGenData.biomeDayTemperature = biome.dayTemperature || 20;
    this._procGenData.biomeNightTemperature = biome.nightTemperature || 10;

    // Re-anchor the master seed to the world's history seed every generation so
    // each world seed (and each starting-year default seed) produces a wholly
    // different map at the same coordinate, while a given (seed, x, y) stays
    // reproducible across revisits. procMapSeed is the single seed formula every
    // entry point into map 636 shares (see ProcGenUtils.procMapSeed).
    // This path always resolves the SURFACE biome off the world-map tile, so it
    // is always the depth-0 seed.
    this._procGenData.seed = getWorldSeed();
    const seed = procMapSeed(originX, originY);

    // Adjacency must not depend on which map the player happens to be standing
    // Adjacency is resolved only while standing on the world map, where the live
    // tile column is readable. Deriving it from the coordinate cache off the
    // world map was tried and reverted: that cache can be preloaded from a stale
    // BiomesMap.json snapshot, which fed the generators neighbours that no longer
    // exist. Off the world map adjacency stays null, and the generators then run
    // every axis border to border, which is the behaviour roads had before.
    let adjacentBiomes = null;
    let diagonalBiomes = null;
    let cacheInfo = null;

    const coordCache = this._procGenData.biomeCoordinateCache;
    const hasCoordCache = coordCache && Object.keys(coordCache).length > 0;

    if (onWorldMap) {
      adjacentBiomes = getAdjacentBiomesOnWorldMap(originX, originY);

      // Override with cache results to get actual biome assignments (roads placed on fields, etc.)
      if (hasCoordCache) {
        const cachedAdjacent = getAdjacentBiomesFromCache(
          originX,
          originY,
          coordCache
        );
        // Use cache values if they exist (they're more accurate for overridden biomes)
        adjacentBiomes.north = cachedAdjacent.north || adjacentBiomes.north;
        adjacentBiomes.south = cachedAdjacent.south || adjacentBiomes.south;
        adjacentBiomes.east = cachedAdjacent.east || adjacentBiomes.east;
        adjacentBiomes.west = cachedAdjacent.west || adjacentBiomes.west;
      }

      adjacentBiomes = {
        north: normalizeBiomeForEdge(adjacentBiomes.north),
        south: normalizeBiomeForEdge(adjacentBiomes.south),
        east: normalizeBiomeForEdge(adjacentBiomes.east),
        west: normalizeBiomeForEdge(adjacentBiomes.west),
      };

      if (hasCoordCache) {
        cacheInfo = checkAdjacentMapBiomesFromCache(
          originX,
          originY,
          coordCache
        );
        diagonalBiomes = checkDiagonalMapBiomesFromCache(
          originX,
          originY,
          coordCache
        );
      }
    }

    // Check if Fields biome should display as Beach
    this._procGenData.displayAsBeach = shouldDisplayAsBeach(biomeName, adjacentBiomes, diagonalBiomes);

    // Check if biome should display as Island (virtual biome - name, enemies, battle BG only)
    this._procGenData.displayAsIsland = shouldDisplayAsIsland(biomeName, adjacentBiomes);

    const worldCoords = { x: originX, y: originY };
    this._procGenData.generatedMapData = generateProceduralTerrain(
      biome,
      seed,
      roadDirection,
      adjacentBiomes,
      cacheInfo,
      worldCoords,
      this._procGenData.biomeCoordinateCache
    );

    // Play biome BGS if defined (night or day version)
    const finalBiome = getBiomeByName(biomeName);
    if (finalBiome) {
      // Determine if it's nighttime
      const dateStr = $gameVariables.value(113) || "01 JAN 2001 12:00";
      const parts = dateStr.split(" ").filter(Boolean);
      const timeParts = parts[3] ? parts[3].split(":") : ["12", "00"];
      const currentHour = parseInt(timeParts[0]) || 12;

      // Night is from 20:00 to 6:00
      const isNightTime = currentHour >= 20 || currentHour < 6;

      // Choose appropriate BGS array based on time of day. Blank entries are
      // discarded, and an empty list means the biome has no ambience at all,
      // which stops whatever BGS was playing (the BGM is left untouched).
      const clean = (arr) => (arr || []).filter((n) => n && n.trim());
      const nightList = clean(finalBiome.bgsNight);
      const bgsArray = isNightTime && nightList.length > 0 ? nightList : clean(finalBiome.bgs);

      if (bgsArray.length > 0) {
        const rng = createSeededRandom(seed + originX * 7 + originY * 13);
        const bgsName = bgsArray[Math.floor(rng() * bgsArray.length)];
        // Above ground this ambience is the weather bed, so it is played through
        // WeatherAudio and follows the Weather Volume slider; below ground it is
        // room tone and keeps its authored level on the plain BGS volume.
        const bgs = { name: bgsName, volume: 80, pitch: 100, pan: 0 };
        if (window.WeatherAudio && window.WeatherAudio.playAmbience) {
          window.WeatherAudio.playAmbience(bgs);
        } else {
          AudioManager.playBgs(bgs);
        }
      } else {
        AudioManager.stopBgs();
      }
    } else {
      AudioManager.stopBgs();
    }

    return true;
  };

  // ==========================================================================
  // Overland origins: the world square a character-creation origin starts on
  // ==========================================================================

  // Curated open, passable, overland biomes (no water, indoor, structured or
  // abstract biomes) so a passable spawn zone is reliably available. Shared by
  // every origin that drops the party out in the world.
  const OVERLAND_ORIGIN_BIOMES = [
    "Fields", "Meadows", "Forest", "ForestTropical", "Desert", "Savannah",
    "Steppe", "Taiga", "Tundra", "Snow", "Highlands", "Jungle", "Bamboo",
    "Mushroom", "Park", "Farm", "SaltFlats", "Badlands", "Canyon",
    "Permafrost", "MountainDesert",
  ];

  // A world square one of those biomes actually occupies, read from the biome
  // coordinate cache (loaded from BiomesMap.json when the player has not stood
  // on the world map yet).
  //
  // An origin must NEVER anchor on an Ocean square. Roughly half of world map
  // 315 is open sea, so a blind coordinate roll strands the party's world
  // coordinates (variables 43/44) out at water: the square they start on is
  // forced to a land biome, but every edge-exit and revisit around it resolves
  // to ocean. Reading the cache guarantees the anchor is land the world map
  // really holds there.
  //
  // `rng` decides how reproducible the pick is: pass a seeded stream for an
  // origin that must come back identical, Math.random for one rolled per save.
  function pickOverlandWorldCoord(rng, procGenData) {
    let cache = procGenData && procGenData.biomeCoordinateCache;
    if (!cache || Object.keys(cache).length === 0) {
      const loaded = Utils2.loadBiomesMapFromFile ? Utils2.loadBiomesMapFromFile() : null;
      if (loaded && loaded.biomeCoordinateCache) {
        cache = loaded.biomeCoordinateCache;
        if (procGenData) procGenData.biomeCoordinateCache = cache;
      }
    }

    const named = OVERLAND_ORIGIN_BIOMES.filter(
      (n) => getBiomeByName(n) && !isWaterBiome(n) && n !== "Ocean"
    );
    if (named.length === 0) return null;

    const stocked = cache ? named.filter((n) => cache[n] && cache[n].length > 0) : [];
    if (stocked.length > 0) {
      const biomeName = stocked[Math.floor(rng() * stocked.length)];
      const coords = cache[biomeName];
      const c = coords[Math.floor(rng() * coords.length)];
      return { worldX: c.x, worldY: c.y, biome: biomeName };
    }

    // No snapshot to read (no BiomesMap.json, no cache in the save): fall back to
    // a forced land biome at an arbitrary inland anchor. The square itself is
    // still land; only the world neighbours around it are unverified.
    logWarn("pickOverlandWorldCoord: no biome coordinate cache, using unverified anchor");
    return {
      worldX: 60 + Math.floor(rng() * 130),
      worldY: 60 + Math.floor(rng() * 130),
      biome: named[Math.floor(rng() * named.length)],
    };
  }

  // Bike origin (character creation): set up _procGenData for a RANDOM non-ocean
  // overland biome and generate its terrain WITHOUT requiring the world map to be
  // loaded. Returns true on success. The caller transfers the player to
  // PROC_MAP_ID; the performTransfer / loadMapData hooks in WorldMapReturn then
  // inject the generated terrain into $dataMap.
  Game_System.prototype.generateRandomBikeBiomeMap = function () {
    // Seed biome + world anchor from the world seed so the bike origin is
    // reproducible across revisits and consistent with the rest of the overland
    // pipeline (the salt keeps this RNG stream distinct from terrain streams).
    const bikeRng = createSeededRandom(hashCoords(getWorldSeed(), 0xb17e, 0xa9c0));

    // A real land square, never a stretch of ocean.
    const pick = pickOverlandWorldCoord(bikeRng, this._procGenData);
    if (!pick) return false;

    const biomeName = pick.biome;
    const biome = getBiomeByName(biomeName);
    if (!biome) return false;

    const originX = pick.worldX;
    const originY = pick.worldY;
    // Keep whatever coordinate cache the pick loaded: the terrain pass below
    // reads it for adjacency.
    const loadedCache =
      (this._procGenData && this._procGenData.biomeCoordinateCache) || {};

    this._procGenData = {
      originX,
      originY,
      currentBiome: biomeName,
      currentRoadDirection: null,
      currentUnderBiome: null,
      currentBiomeTileset: biome.tilesetId,
      generatedMapData: null,
      biomeToTileset: {},
      mapPreloaded: false,
      seed: getWorldSeed(),
      biomeCoordinateCache: loadedCache,
      lastLoadedProcMapX: null,
      lastLoadedProcMapY: null,
      displayAsBeach: false,
      displayAsIsland: false,
      biomeLayerStack: [],
      biomeDayTemperature: biome.dayTemperature || 20,
      biomeNightTemperature: biome.nightTemperature || 10,
    };

    const seed = procMapSeed(originX, originY);
    const adjacentBiomes = { north: biomeName, south: biomeName, east: biomeName, west: biomeName };
    const worldCoords = { x: originX, y: originY };

    this._procGenData.generatedMapData = generateProceduralTerrain(
      biome, seed, null, adjacentBiomes, null, worldCoords, this._procGenData.biomeCoordinateCache
    );

    // Sync world-coordinate vars so edge-exit return coords stay consistent.
    $gameVariables.setValue(43, originX);
    $gameVariables.setValue(44, originY);

    return !!this._procGenData.generatedMapData;
  };

  // ==========================================================================
  // Bunker origin: world square + surface map
  // ==========================================================================

  // Pick the world square the bunker hides under: a real, non-ocean world-map
  // coordinate from the shared overland picker, so the surface the party climbs
  // out into is the biome the world map actually holds there.
  //
  // Rolled freshly (not from the world seed) and then stored in the save: every
  // playthrough gets its own bunker. Two Bunker starts in the same world must
  // not share a square, or the second one would find the first one's hoards
  // already collected -- removals are recorded per world, not per savegame.
  Game_System.prototype.pickBunkerWorldCoord = function () {
    return pickOverlandWorldCoord(Math.random, this._procGenData);
  };

  // Build (or rebuild) the bunker's surface map, hatch included, and leave it as
  // the live procedural map. Shared by the Bunker origin (which needs the hatch
  // tile before it can wire the way out of the cellar) and by the exit out of
  // the bunker (WorldMapReturn's 'bunker' dungeon session).
  Game_System.prototype.generateBunkerSurfaceMap = function () {
    const rec = this._bunkerOrigin;
    if (!rec) return false;
    const biome = getBiomeByName(rec.biome) || getBiomeByName("Fields");
    if (!biome) return false;

    const pg = this._procGenData;
    if (!pg) return false;
    pg.originX = rec.worldX;
    pg.originY = rec.worldY;
    pg.currentBiome = biome.name;
    pg.currentRoadDirection = null;
    pg.currentUnderBiome = null;
    pg.currentBiomeTileset = biome.tilesetId;
    pg.displayAsBeach = false;
    pg.displayAsIsland = false;
    pg.biomeLayerStack = [];
    pg.biomeDayTemperature = biome.dayTemperature || 20;
    pg.biomeNightTemperature = biome.nightTemperature || 10;
    pg.seed = getWorldSeed();

    // Adjacency stays null off the world map (see generateProceduralMap), so the
    // square rebuilds the same way whether it is entered from the cellar or from
    // anywhere else that is not map 315.
    const seed = procMapSeed(rec.worldX, rec.worldY);
    pg.generatedMapData = generateProceduralTerrain(
      biome, seed, null, null, null, { x: rec.worldX, y: rec.worldY }, pg.biomeCoordinateCache
    );

    $gameVariables.setValue(43, rec.worldX);
    $gameVariables.setValue(44, rec.worldY);
    return !!pg.generatedMapData;
  };

  // Called once by the Bunker origin: choose the world square, generate its
  // surface (which stamps the permanent hatch and records its tile) and return
  // the record. The caller then drops the party into the LootCellar below.
  Game_System.prototype.prepareBunkerOrigin = function () {
    const pick = this.pickBunkerWorldCoord();
    if (!pick) return null;
    this._bunkerOrigin = {
      worldX: pick.worldX,
      worldY: pick.worldY,
      biome: pick.biome,
      entranceX: null,
      entranceY: null,
    };
    if (!this.generateBunkerSurfaceMap() || this._bunkerOrigin.entranceX === null) {
      this._bunkerOrigin = null;
      return null;
    }
    log(`[Bunker] hatch at (${this._bunkerOrigin.entranceX}, ${this._bunkerOrigin.entranceY}) ` +
        `on ${pick.biome} (${pick.worldX}, ${pick.worldY})`);
    return this._bunkerOrigin;
  };

  // NOTE: DataManager.loadMapData override and Game_System map transfer methods have been moved to WorldMapReturn.js
  // Includes: getReturnCoordinates, getAdjacentWorldCoordinates, getEdgeCoordinateForDirection, clearProcGenData, getBiomeTilesetId

  // ===== GAME MAP EXTENSIONS =====
  // NOTE: Game_Map overrides (initialize, setup, tileset) and border detection have been moved to WorldMapReturn.js

  // ===== PLUGIN COMMAND HANDLERS =====
  // NOTE: Plugin commands (startProcGen, stopProcGen, goDown, goUp) have been moved to WorldMapReturn.js

  // ===== PUBLIC ACCESSORS =====

  Game_System.prototype.isProceduralMapActive = function () {
    return $gameVariables.value(110) === 1;
  };

  Game_System.prototype.isInsideProceduralMap = function () {
    return $gameVariables.value(111) === 1;
  };

  Game_System.prototype.getProcGenData = function () {
    return this._procGenData;
  };

  /**
   * Check if car events should be deleted for this biome
   */
  function shouldDeleteCarsForBiome(biomeName) {
    if (!biomeName) return true; // No biome = delete cars
    const lowerBiome = biomeName.toLowerCase();
    const allowedKeywords = ["road", "bridge", "city", "burg", "tunnel"];
    return !allowedKeywords.some(keyword => lowerBiome.includes(keyword));
  }

  /**
   * Check if NPC events should be deleted for this biome
   */
  function shouldDeleteNPCsForBiome(biomeName) {
    if (!biomeName) return true; // No biome = delete NPCs
    const lowerBiome = biomeName.toLowerCase();
    const allowedKeywords = ["city", "burg", "village"];
    return !allowedKeywords.some(keyword => lowerBiome.includes(keyword));
  }

  // ===== EDGE DETECTION & AUTO-RETURN =====
  // NOTE: Border arrow visualization, Game_Player overrides, and Scene_Map hooks have been moved to WorldMapReturn.js
  // Includes: Sprite_BorderArrow, getProcGenBorderTiles, displayProcGenBorderArrows, clearProcGenBorderArrows
  // updateProcGenBorderArrows, Game_Player.update override, performTransfer override, moveStraight override, Scene_Map.onMapLoaded

  /**
   * Update visibility of GoDown and GoUp events based on underground state
   */
  /**
     * Update visibility of GoDown, GoUp, and Chest events based on underground state
     */
  function updateEventVisibility() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    // Check if player is underground
    const isUnderground = procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0;
    const chestNames = ["RandomItemChest", "RandomArmorChest", "RandomWeaponChest"];

    // Check if current biome is Ocean or Seabed (hide GoUp/GoDown events)
    const currentBiome = procGenData.currentBiome || "";
    const isWaterBiome = currentBiome === "Ocean" || currentBiome === "Seabed";

    for (const event of $gameMap._events) {
      if (!event || !$dataMap.events[event._eventId]) continue;

      const eventName = $dataMap.events[event._eventId].name;

      // Handle GoDown (Show Overground, Hide Underground or Water Biomes)
      if (eventName === "GoDown") {
        const shouldHide = isUnderground || isWaterBiome;
        event.setOpacity(shouldHide ? 0 : 255);
        // Also move off map if in water biome
        if (isWaterBiome && (event.x !== 0 || event.y !== 0)) {
          event.setPosition(0, 0);
        }
      }
      // Handle GoUp (Hide Overground, Show Underground, Hide in Water Biomes)
      else if (eventName === "GoUp") {
        const shouldShow = isUnderground && !isWaterBiome;
        event.setOpacity(shouldShow ? 255 : 0);
        // Also move off map if in water biome
        if (isWaterBiome && (event.x !== 0 || event.y !== 0)) {
          event.setPosition(0, 0);
        }
      }
      // Handle Chests: visibility follows placement (placeChestEvents parks
      // inactive chests at 0,0 and only spawns the biome-appropriate count).
      else if (chestNames.includes(eventName)) {
        event.setOpacity((event.x > 0 || event.y > 0) ? 255 : 0);
      }
    }
  }
  /**
   * Place the GoDown event at a seeded random position on the procedural map
   * If the tile is impassable, find the first passable tile nearby
   */
  function placeGoDownEvent() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    // Check if current biome is Ocean or Seabed - hide GoDown in these biomes
    const currentBiome = procGenData.currentBiome || "";
    const isWaterBiome = currentBiome === "Ocean" || currentBiome === "Seabed";

    // Find the GoDown event
    let goDownEvent = null;
    for (const event of $gameMap._events) {
      if (event && $dataMap.events[event._eventId] && $dataMap.events[event._eventId].name === "GoDown") {
        goDownEvent = event;
        break;
      }
    }

    if (!goDownEvent) {
      console.warn(`[ProceduralMap] GoDown event not found on map ${$gameMap.mapId()}`);
      return;
    }

    // If in water biome, hide the event by moving it off map
    if (isWaterBiome) {
      goDownEvent.setPosition(0, 0);
      procGenData.goDownEventX = 0;
      procGenData.goDownEventY = 0;
      log(`[ProceduralMap] GoDown event hidden (water biome: ${currentBiome})`);
      return;
    }

    const worldX = procGenData.worldX || $gameVariables.value(43) || 0;
    const worldY = procGenData.worldY || $gameVariables.value(44) || 0;
    const seed = procGenData.currentSeed || getWorldSeed();

    // Create seeded random function using world coordinates and world seed
    const seededRandom = ProcGenUtils.createSeededRandom(hashCoords(seed, worldX, worldY));

    // Generate random position on 64x64 map
    let startX = Math.floor(seededRandom() * (PROC_MAP_WIDTH - 2)) + 1;
    let startY = Math.floor(seededRandom() * (PROC_MAP_HEIGHT - 2)) + 1;

    // Try to find passable tile: first check the selected position, then search nearby
    let finalX = startX;
    let finalY = startY;
    let found = false;

    // Check if starting position is passable
    if ($gameMap.isPassable(startX, startY, 2)) {
      found = true;
    } else {
      // Search in expanding squares around the initial position
      const maxRange = 10;
      outerLoop: for (let range = 1; range <= maxRange; range++) {
        for (let dx = -range; dx <= range; dx++) {
          for (let dy = -range; dy <= range; dy++) {
            // Only check the perimeter of the current square
            if (Math.abs(dx) !== range && Math.abs(dy) !== range) continue;

            const testX = startX + dx;
            const testY = startY + dy;

            // Bounds check
            if (testX < 0 || testX >= PROC_MAP_WIDTH || testY < 0 || testY >= PROC_MAP_HEIGHT) continue;

            if ($gameMap.isPassable(testX, testY, 2)) {
              finalX = testX;
              finalY = testY;
              found = true;
              break outerLoop;
            }
          }
        }
      }
    }

    // Move the GoDown event to the determined position
    goDownEvent.setPosition(finalX, finalY);

    // Store the GoDown event position for use when calling GoUp command
    procGenData.goDownEventX = finalX;
    procGenData.goDownEventY = finalY;

    log(`[ProceduralMap] GoDown event placed at (${finalX}, ${finalY}) - Found passable: ${found}`);
  }

  /**
   * Place the GoUp event - hide it when overground or in Ocean/Seabed biomes
   */
  function placeGoUpEvent() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    // Check if player is underground
    const isUnderground = procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0;

    // Check if current biome is Ocean or Seabed
    const currentBiome = procGenData.currentBiome || "";
    const isWaterBiome = currentBiome === "Ocean" || currentBiome === "Seabed";

    // Find the GoUp event
    let goUpEvent = null;
    for (const event of $gameMap._events) {
      if (event && $dataMap.events[event._eventId] && $dataMap.events[event._eventId].name === "GoUp") {
        goUpEvent = event;
        break;
      }
    }

    if (!goUpEvent) {
      // GoUp event doesn't exist (normal for surface maps)
      return;
    }

    // Hide GoUp when overground OR in water biomes
    if (!isUnderground || isWaterBiome) {
      goUpEvent.setPosition(0, 0);
      goUpEvent.setOpacity(0);
      log(`[ProceduralMap] GoUp event hidden (underground: ${isUnderground}, waterBiome: ${isWaterBiome})`);
    } else {
      // Show GoUp when underground and NOT in water biome
      // Position it near the player's entry point if available
      const playerX = $gamePlayer.x;
      const playerY = $gamePlayer.y;
      goUpEvent.setPosition(playerX, playerY);
      goUpEvent.setOpacity(255);
      log(`[ProceduralMap] GoUp event shown at (${playerX}, ${playerY})`);
    }
  }

  /**
   * Place Random Chests on the procedural map, biome-aware:
   *   - Dungeon / Crypt / Sewer: 4-7 chests, biased into rooms (also corridors).
   *   - Cave-family: loot is RARE - most coordinates have no chest; when one does
   *     spawn it rolls RARE loot (via $gameSystem._lootRarityBonus, read by
   *     RandomLootSystem). ~20% of cave maps carry a single chest.
   *   - Any other biome (overground / non-dungeon underground): no chests.
   * Chests not selected are parked at (0,0); visibility follows position.
   */
  function placeChestEvents() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    const chestNames = ["RandomItemChest", "RandomArmorChest", "RandomWeaponChest"];
    const biome = (procGenData.currentBiome || "").toLowerCase();
    const isDungeonType = biome.startsWith("dungeon") || biome.startsWith("crypt") ||
      biome.startsWith("sewer") ||
      // Structure biomes with guaranteed chests: the loot cellar (StairsDown),
      // the temple (StairsUp) and a patron's vault (their Hatch).
      biome === "lootcellar" || biome === "templeinside" || biome === "patronvault";
    const isCave = !isDungeonType && /cave/.test(biome); // Cave, CaveIce, CaveDen, ...
    // A patron's vault gets every chest the map template carries; the rarity
    // push it pays out comes from PatreonRewards.lootRarityBonus, so nothing is
    // added here (the two would stack).
    const isPatronVault = biome === "patronvault";

    const worldX = procGenData.worldX || $gameVariables.value(43) || 0;
    const worldY = procGenData.worldY || $gameVariables.value(44) || 0;
    const seed = procGenData.currentSeed || getWorldSeed();
    const layerDepth = procGenData.biomeLayerStack ? procGenData.biomeLayerStack.length : 0;
    const baseSeed = hashCoords(seed, worldX, worldY) + layerDepth * 97;
    const rng = Utils2.createSeededRandom(baseSeed);

    // How many chests, and how rare their loot is.
    let numChests = 0;
    let rarityBonus = 0;
    if (isPatronVault) {
      numChests = 99;                        // capped to the chests that exist
    } else if (isDungeonType) {
      numChests = 4 + Math.floor(rng() * 4); // 4..7 (all the map-636 chests)
    } else if (isCave) {
      numChests = rng() < 0.15 ? 1 : 0;      // very rare - most caves have none
      rarityBonus = 55;                      // but rare loot when present
    }
    // Feed RandomLootSystem so cave chests roll toward the top rarity tiers.
    $gameSystem._lootRarityBonus = rarityBonus;

    // Gather the chest events and deterministically pick which ones are active.
    const chestEvents = $gameMap._events.filter(ev =>
      ev && $dataMap.events[ev._eventId] && chestNames.includes($dataMap.events[ev._eventId].name));
    const order = chestEvents.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    numChests = Math.min(numChests, order.length);

    const rooms = procGenData.generatedMapData && procGenData.generatedMapData.rooms;

    // Find a passable, unoccupied tile - biased into a room when room data exists
    // (so dungeon chests usually sit in rooms, occasionally in corridors).
    const pickTile = (srng) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const tile = pickRoomOrWallTile(srng, rooms);
        const { x: tx, y: ty } = tile;
        if ($gameMap.isPassable(tx, ty, 2) &&
            (tx !== $gamePlayer.x || ty !== $gamePlayer.y) &&
            !$gameMap.eventsXy(tx, ty).length) {
          return { x: tx, y: ty };
        }
      }
      return null;
    };

    order.forEach((event, i) => {
      if (i < numChests) {
        const srng = Utils2.createSeededRandom(baseSeed + event._eventId * 31);
        const tile = pickTile(srng);
        event.setPosition(tile ? tile.x : 0, tile ? tile.y : 0);
      } else {
        event.setPosition(0, 0); // parked / hidden
      }
    });
  }

  /**
   * Pick a candidate tile for a chest-like event: 75% of the time (when room
   * data exists) either dead-center of a room or hugging one of its walls one
   * tile in, so chests read as deliberately placed instead of scattered mid-
   * floor where they could pinch off a corridor; the remaining 25% (or when
   * there is no room data) falls back to any map tile. Callers still validate
   * passability/occupancy on the returned point.
   */
  function pickRoomOrWallTile(srng, rooms) {
    if (rooms && rooms.length && srng() < 0.75) {
      const r = rooms[Math.floor(srng() * rooms.length)];
      if (srng() < 0.5) {
        // Center of the room.
        return { x: r.x + Math.floor(r.width / 2), y: r.y + Math.floor(r.height / 2) };
      }
      // Hug a wall: snap to one of the room's four edges, one tile in.
      const inset = 1;
      const spanW = Math.max(1, r.width - inset * 2);
      const spanH = Math.max(1, r.height - inset * 2);
      switch (Math.floor(srng() * 4)) {
        case 0: return { x: r.x + inset, y: r.y + inset + Math.floor(srng() * spanH) };
        case 1: return { x: r.x + r.width - 1 - inset, y: r.y + inset + Math.floor(srng() * spanH) };
        case 2: return { x: r.x + inset + Math.floor(srng() * spanW), y: r.y + inset };
        default: return { x: r.x + inset + Math.floor(srng() * spanW), y: r.y + r.height - 1 - inset };
      }
    }
    return {
      x: Math.floor(srng() * (PROC_MAP_WIDTH - 4)) + 2,
      y: Math.floor(srng() * (PROC_MAP_HEIGHT - 4)) + 2,
    };
  }

  /**
   * Check whether the current procedural biome is Dungeon / Crypt / Sewer (or
   * the TempleInside structure biome, which shares their hazards: spike traps,
   * locked doors and key chests). LootCellar and CaveDen deliberately do NOT
   * qualify - a treasure cellar and a natural den carry no built hazards.
   */
  function isCurrentBiomeDungeonType(biomeName) {
    const b = (biomeName || "").toLowerCase();
    return b.startsWith("dungeon") || b.startsWith("crypt") || b.startsWith("sewer") ||
      b === "templeinside";
  }

  /**
   * A biome that is roofed over: every cave variant plus the enclosed
   * floor/ceiling/wall family (Dungeon, Crypt, Sewer, LootCellar,
   * TempleInside, CaveDen). Nothing generated in one of these should ever see
   * the sky, so weather and day/night light are suppressed there.
   */
  function isInteriorBiome(biomeName) {
    const name = biomeName || "";
    if (!name) return false;
    return isCaveBiome(name) || isDungeonBiome(name);
  }

  /**
   * True while the player stands on a procedural map that must be treated as an
   * Interior: an enclosed biome, or any layer below the surface (the layer
   * stack is non-empty once the player has gone down). WeatherSystem and
   * DynamicLightingSystem ask this instead of reading map 636's <Exterior> tag.
   */
  function isProceduralInteriorMap() {
    if (!$gameMap || $gameMap.mapId() !== PROC_MAP_ID) return false;
    const data = $gameSystem && $gameSystem._procGenData;
    if (!data) return false;
    if (data.biomeLayerStack && data.biomeLayerStack.length > 0) return true;
    return isInteriorBiome(data.currentBiome);
  }

  /**
   * Place Spike Trap hazards (map 636 template events named "Spike trap").
   * Only active in Dungeon / Crypt / Sewer biomes; parked at (0,0) and hidden
   * everywhere else. Scattered across passable floor tiles away from the
   * entrance/spawn point so the player is never ambushed on arrival.
   */
  function placeSpikeTrapEvents() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    const trapEvents = $gameMap._events.filter((ev) =>
      ev && $dataMap.events[ev._eventId] && $dataMap.events[ev._eventId].name === "Spike trap");
    if (!trapEvents.length) return;

    if (!isCurrentBiomeDungeonType(procGenData.currentBiome)) {
      trapEvents.forEach((ev) => { ev.setPosition(0, 0); ev.setOpacity(0); });
      return;
    }

    const worldX = procGenData.worldX || $gameVariables.value(43) || 0;
    const worldY = procGenData.worldY || $gameVariables.value(44) || 0;
    const seed = procGenData.currentSeed || getWorldSeed();
    const layerDepth = procGenData.biomeLayerStack ? procGenData.biomeLayerStack.length : 0;
    const baseSeed = hashCoords(seed, worldX, worldY) + layerDepth * 131 + 7331;
    const rng = Utils2.createSeededRandom(baseSeed);

    const numTraps = Math.min(trapEvents.length, 3 + Math.floor(rng() * 6)); // 3..8
    const genData = procGenData.generatedMapData;
    const spawnX = genData ? genData.spawnX : $gamePlayer.x;
    const spawnY = genData ? genData.spawnY : $gamePlayer.y;

    const order = trapEvents.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const pickTile = (srng) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const tx = Math.floor(srng() * (PROC_MAP_WIDTH - 6)) + 3;
        const ty = Math.floor(srng() * (PROC_MAP_HEIGHT - 6)) + 3;
        if (Math.abs(tx - spawnX) + Math.abs(ty - spawnY) < 6) continue;
        if ($gameMap.isPassable(tx, ty, 2) && !$gameMap.eventsXy(tx, ty).length) {
          return { x: tx, y: ty };
        }
      }
      return null;
    };

    order.forEach((event, i) => {
      if (i < numTraps) {
        const srng = Utils2.createSeededRandom(baseSeed + event._eventId * 53);
        const tile = pickTile(srng);
        event.setPosition(tile ? tile.x : 0, tile ? tile.y : 0);
        event.setOpacity(tile ? 255 : 0);
      } else {
        event.setPosition(0, 0);
        event.setOpacity(0);
      }
    });
  }

  /**
   * Place "Dungeon door" events (map 636 template, 6 copies) at the start of
   * the narrow 1-tile corridors computed by the BSP dungeon generator
   * (mapData.doorHints). Only active in Dungeon / Crypt / Sewer biomes with at
   * least one hint (Crypt/Sewer use a fixed grid layout and normally have
   * none); parked at (0,0) and hidden otherwise.
   */
  function placeDungeonDoorEvents() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    const doorEvents = $gameMap._events.filter((ev) =>
      ev && $dataMap.events[ev._eventId] && $dataMap.events[ev._eventId].name === "Dungeon door");
    if (!doorEvents.length) return;

    const genData = procGenData.generatedMapData;
    const hints = (isCurrentBiomeDungeonType(procGenData.currentBiome) && genData && genData.doorHints) || [];

    if (!hints.length) {
      doorEvents.forEach((ev) => { ev.setPosition(0, 0); ev.setOpacity(0); });
      return;
    }

    const worldX = procGenData.worldX || $gameVariables.value(43) || 0;
    const worldY = procGenData.worldY || $gameVariables.value(44) || 0;
    const seed = procGenData.currentSeed || getWorldSeed();
    const layerDepth = procGenData.biomeLayerStack ? procGenData.biomeLayerStack.length : 0;
    const rng = Utils2.createSeededRandom(hashCoords(seed, worldX, worldY) + layerDepth * 197 + 4111);

    const shuffled = hints.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    doorEvents.forEach((event, i) => {
      const spot = shuffled[i];
      if (spot) {
        event.setPosition(spot.x, spot.y);
        event.setOpacity(255);
      } else {
        event.setPosition(0, 0);
        event.setOpacity(0);
      }
    });
  }

  /**
   * Place "Key Chest" events (map 636 template, 3 copies): available in every
   * Dungeon / Crypt / Sewer biome, any underground overworld layer (reached
   * via GoDown) and the Seabed biome. Hidden on ordinary surface maps. Rare:
   * only some world tiles carry any at all.
   */
  function placeKeyChestEvents() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    const keyChestEvents = $gameMap._events.filter((ev) =>
      ev && $dataMap.events[ev._eventId] && $dataMap.events[ev._eventId].name === "Key Chest");
    if (!keyChestEvents.length) return;

    const biome = procGenData.currentBiome || "";
    const isUnderground = !!(procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0);
    const eligible = isCurrentBiomeDungeonType(biome) || isUnderground || biome === "Seabed";

    if (!eligible) {
      keyChestEvents.forEach((ev) => { ev.setPosition(0, 0); ev.setOpacity(0); });
      return;
    }

    const worldX = procGenData.worldX || $gameVariables.value(43) || 0;
    const worldY = procGenData.worldY || $gameVariables.value(44) || 0;
    const seed = procGenData.currentSeed || getWorldSeed();
    const layerDepth = procGenData.biomeLayerStack ? procGenData.biomeLayerStack.length : 0;
    const baseSeed = hashCoords(seed, worldX, worldY) + layerDepth * 151 + 9001;
    const rng = Utils2.createSeededRandom(baseSeed);

    const rooms = procGenData.generatedMapData && procGenData.generatedMapData.rooms;
    const pickTile = (srng) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const tile = pickRoomOrWallTile(srng, rooms);
        const { x: tx, y: ty } = tile;
        if ($gameMap.isPassable(tx, ty, 2) &&
            (tx !== $gamePlayer.x || ty !== $gamePlayer.y) &&
            !$gameMap.eventsXy(tx, ty).length) {
          return { x: tx, y: ty };
        }
      }
      return null;
    };

    // Secret and rare: little over a third of eligible world tiles carry any.
    const numChests = rng() < 0.35 ? (1 + Math.floor(rng() * keyChestEvents.length)) : 0;

    const order = keyChestEvents.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    order.forEach((event, i) => {
      if (i < numChests) {
        const srng = Utils2.createSeededRandom(baseSeed + event._eventId * 61);
        const tile = pickTile(srng);
        event.setPosition(tile ? tile.x : 0, tile ? tile.y : 0);
        event.setOpacity(tile ? 255 : 0);
      } else {
        event.setPosition(0, 0);
        event.setOpacity(0);
      }
    });
  }

  /**
   * Place the "Policeman" patrols (map 636 template, 3 copies). Cities and
   * burgs are policed (1-3 officers on duty); villages only rarely see one.
   * Everywhere else - wilderness, roads, underground - the officers are parked
   * at (0,0) and hidden.
   *
   * Unlike the chests/traps above this roll is deliberately NOT seeded on the
   * world coordinate: the patrol is re-rolled every single time the player
   * enters the settlement, so the streets are never staffed the same way twice.
   * Officers are dropped on street tiles when the tileset exposes any, and kept
   * a few tiles away from the player so nobody spawns in their face.
   */
  function placePolicemanEvents() {
    const procGenData = $gameSystem._procGenData;
    if (!procGenData) return;

    const policeEvents = $gameMap._events.filter((ev) =>
      ev && $dataMap.events[ev._eventId] && $dataMap.events[ev._eventId].name === "Policeman");
    if (!policeEvents.length) return;

    const park = () => policeEvents.forEach((ev) => {
      ev.setPosition(0, 0);
      ev.setOpacity(0);
      ev.setThrough(true);
    });

    const biomeName = procGenData.currentBiome || "";
    const isUnderground = !!(procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0);
    if (isUnderground) { park(); return; }

    let count = 0;
    if (isCityBiome(biomeName) || isBurgBiome(biomeName)) {
      count = 1 + Math.floor(Math.random() * 3);      // 1..3 officers on patrol
    } else if (isVillageBiome(biomeName)) {
      count = Math.random() < 0.12 ? 1 : 0;           // rare village constable
    }
    if (count <= 0) { park(); return; }
    count = Math.min(count, policeEvents.length);

    // Street tiles of this biome's tileset, so patrols walk the roads.
    const streetTileIds = new Set();
    const biomeObj = getBiomeByName(biomeName);
    if (biomeObj) {
      _collectSingleTileIds(
        ["Path", "PathDesert", "PathIce", "Road", "DashedLine",
          "DashedLineHorizontal", "DashedLineVertical", "Sidewalk",
          "SidewalkDesert", "SidewalkIce"],
        collectBiomeFeatures(biomeObj), streetTileIds
      );
    }

    const MIN_PLAYER_DIST = 5;
    const isFreeTile = (x, y) =>
      $gameMap.isPassable(x, y, 2) &&
      !$gameMap.eventsXy(x, y).length &&
      Math.abs(x - $gamePlayer.x) + Math.abs(y - $gamePlayer.y) >= MIN_PLAYER_DIST;

    // Collect the street tiles once, then hand out random ones.
    const streets = [];
    if (streetTileIds.size) {
      for (let y = 2; y < PROC_MAP_HEIGHT - 2; y++) {
        for (let x = 2; x < PROC_MAP_WIDTH - 2; x++) {
          if (streetTileIds.has($gameMap.tileId(x, y, 0))) streets.push({ x, y });
        }
      }
    }

    const taken = [];
    const isTaken = (x, y) => taken.some((t) => t.x === x && t.y === y);
    const pickTile = () => {
      for (let attempt = 0; attempt < 30 && streets.length; attempt++) {
        const s = streets[Math.floor(Math.random() * streets.length)];
        if (!isTaken(s.x, s.y) && isFreeTile(s.x, s.y)) return s;
      }
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = Math.floor(Math.random() * (PROC_MAP_WIDTH - 4)) + 2;
        const y = Math.floor(Math.random() * (PROC_MAP_HEIGHT - 4)) + 2;
        if (!isTaken(x, y) && isFreeTile(x, y)) return { x, y };
      }
      return null;
    };

    const order = policeEvents.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    order.forEach((event, i) => {
      const tile = i < count ? pickTile() : null;
      if (tile) {
        taken.push(tile);
        event.setPosition(tile.x, tile.y);
        event.setOpacity(255);
        event.setThrough(false);
      } else {
        event.setPosition(0, 0);
        event.setOpacity(0);
        event.setThrough(true);
      }
    });
  }

  /**
   * Hook into Scene_Map update to ensure tilemap is continuously refreshed
   */
  const _Scene_Map_updateTilemap = Scene_Map.prototype.updateTilemap;
  Scene_Map.prototype.updateTilemap = function () {
    _Scene_Map_updateTilemap.call(this);

    if (
      $gameMap.mapId() === PROC_MAP_ID &&
      this._tilemap &&
      $gameSystem._procGenData &&
      $gameSystem._procGenData.generatedMapData
    ) {
      if (!this._procGenMapRefreshScheduled) {
        this._tilemap._needsRender = true;
        this._procGenMapRefreshScheduled = true;
      }
    }
  };

  // ===== EXPORTS FOR OTHER PLUGINS =====
  window.generateProceduralTerrain = generateProceduralTerrain;
  window.shouldDisplayAsBeach = shouldDisplayAsBeach;
  window.shouldDisplayAsIsland = shouldDisplayAsIsland;
  window.getHardcodedBiomeOverride = getHardcodedBiomeOverride;
  window.placeGoDownEvent = placeGoDownEvent;
  window.placeGoUpEvent = placeGoUpEvent;
  window.placeChestEvents = placeChestEvents;
  window.placeSpikeTrapEvents = placeSpikeTrapEvents;
  window.placeDungeonDoorEvents = placeDungeonDoorEvents;
  window.placeKeyChestEvents = placeKeyChestEvents;
  window.placePolicemanEvents = placePolicemanEvents;
  window.isInteriorBiome = isInteriorBiome;
  window.isProceduralInteriorMap = isProceduralInteriorMap;
})();
