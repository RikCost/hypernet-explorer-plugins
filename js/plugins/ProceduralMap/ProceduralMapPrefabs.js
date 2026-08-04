/*:
 * @target MZ
 * @plugindesc Procedural prefab placement system: loads and places prefab maps into procedural biomes. OPTIMIZED VERSION (Conditional Roads).
 * @author Omni-Lex
 *
 * @help
 * Procedural Map Prefabs (Optimized)
 * ==================================
 * Places prefab maps (32x32) into procedurally generated maps.
 *
 * PREFAB SYSTEM
 * =============
 * - Biomes can define a `prefabs` array with map IDs (e.g., [453, 457, 234])
 * - Each biome randomly places 0-4 prefabs during generation
 * - Prefabs are placed at random seeded positions
 * - Uses Summed Area Table (SAT) for O(1) collision detection against roads
 * - Caches loaded maps to prevent disk I/O thrashing
 * - OPTIMIZATION: Only scans for road collisions in "City" or "Road" biomes
 *
 * Requires ProceduralMapBiomeGenerator.js and ProceduralMapUtils.js
 */

(() => {
  "use strict";

  const pluginName = "ProceduralMapPrefabs";

  // Import utilities
  const Utils2 = window.ProcGenUtils;
  if (!Utils2) {
    console.error("ProceduralMapPrefabs requires ProceduralMapUtils plugin");
    return;
  }

  const { createSeededRandom, getWorldSeed, hashCoords, randomChoice, calculateIndex, isWaterTileId } = Utils2;

  // Import beach/water utilities
  const BeachGen = window.ProcGenBeach;
  if (!BeachGen) {
    console.error("ProceduralMapPrefabs requires ProceduralBeachGenerator plugin");
    return;
  }

  const { isWaterBiome } = BeachGen;

  // Get Biomes from ProceduralMapDB
  function getBiomes() {
    if (window.WorldGen && window.WorldGen.Biomes) {
      return window.WorldGen.Biomes;
    }
    return [];
  }

  const PROC_MAP_WIDTH = 64;
  const PROC_MAP_HEIGHT = 64;
  const PROC_MAP_ID = 636; // Procedural map ID
  const GRID_UNIT = 8; // Base grid unit

  // Road biomes draw from a prefab pool that's mostly generic roadside filler
  // plus a couple of much larger gas-station-flavored maps (identified by
  // GasPump tiles, not a hardcoded id list). Left unchecked, a gas station is
  // just as likely to be picked as any other filler prefab, so they show up
  // (and dominate visually, being much bigger) on nearly every road tile.
  const ROAD_GAS_STATION_CHANCE = 0.3; // Chance a road biome gets a gas station at all (capped at 1 per map)
  const ROAD_SIDE_PAIR_CHANCE = 0.35; // Chance a plain linear road gets two prefabs facing each other across it
  const ROAD_SIDE_GAP = 1; // Tile gap kept clear between a roadside prefab and the carriageway
  const OCEAN_ISLAND_CHANCE = 0.35; // Chance an ocean tile has any islands at all (1-3 when it does)

  // A village biome lists its own houses as the first prefab group and the
  // shared landmark pool (js/db/Prefabs/LandmarkPrefabs.json) as the last one.
  // Flattening both into one pool made landmarks the majority of the draw --
  // there are more landmarks than houses -- so villages kept coming out as a
  // scatter of standing stones and ruins with barely a house among them.
  // Landmarks stay in, as the occasional garnish they were meant to be.
  const VILLAGE_LANDMARK_CHANCE = 0.2;

  // OPTIMIZATION: In-memory cache for map data to avoid disk reads
  const prefabCache = new Map();

  // OPTIMIZATION: Track which generated-map-data arrays have already had prefabs
  // applied. applyPrefabsToMap mutates the array in place and is deterministic,
  // so re-running it on the same array (e.g. every time the player re-enters
  // map 636 from a house/menu without regenerating) just repeats the full
  // pipeline - loading prefabs and building two 64x64 summed-area tables - for
  // an identical result. A WeakSet keyed on the array identity lets us skip that
  // redundant work. Any of the regeneration sites replaces generatedMapData with
  // a fresh array (not in the set), so prefabs are applied exactly once per
  // fresh map.
  const prefabbedMapData = new WeakSet();

  // The WeakSet only lives as long as the array does, and the array does not
  // survive a save: JSON.stringify drops an array's non-index properties and
  // hands back a brand-new object on load, so the identity is gone while the
  // prefabs baked into the tiles are not. Running the pass again over that array
  // stamps a SECOND set of prefabs on top of the ones already standing. So the
  // mark is also written as a cheap fingerprint of the finished array, kept on
  // _procGenData -- a plain object, which does survive -- and checked before the
  // pass runs. Every regeneration site replaces the array with different tiles,
  // which invalidates the fingerprint for free: no site has to clear anything.
  function mapDataFingerprint(mapData, biomeName, worldCoords) {
    let h = (0x811c9dc5 ^ mapData.length) >>> 0;
    for (let i = 0; i < mapData.length; i += 13) {
      h = Math.imul(h ^ (mapData[i] | 0), 0x01000193);
    }
    const tag = `${biomeName}:${worldCoords.x},${worldCoords.y}`;
    for (let i = 0; i < tag.length; i++) {
      h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193);
    }
    return h >>> 0;
  }

  /**
   * Get biome by name
   */
  function getBiomeByName(biomeName) {
    const Biomes = getBiomes();
    return Biomes.find(b => b.name === biomeName);
  }

  /**
   * Load a map file synchronously (Optimized with Cache)
   */
  function loadPrefabSync(mapId) {
    // Check cache first. The prefab map is only ever read (placePrefab copies
    // tiles OUT of it, never writes back), so we hand back the cached object
    // directly. Deep-cloning it with JSON.parse(JSON.stringify(...)) on every
    // placement was serializing a full 32x32 map (tiles + events) for nothing,
    // and city biomes place up to ~20 prefabs per map load.
    if (prefabCache.has(mapId)) {
      return prefabCache.get(mapId);
    }

    try {
      const xhr = new XMLHttpRequest();
      const mapIdStr = String(mapId).padStart(3, '0');
      const url = `data/prefabs/Map${mapIdStr}.json`;

      xhr.open('GET', url, false); // Synchronous
      xhr.send();

      if (xhr.status === 200 || xhr.status === 0) {
        const mapData = JSON.parse(xhr.responseText);
        // Save to cache
        prefabCache.set(mapId, mapData);
        return mapData;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Async prefetch of every biome's prefab maps at plugin load. Populates the
   * same prefabCache loadPrefabSync reads, so the first time a prefab is placed
   * it hits the warm cache instead of blocking on a synchronous XHR. Purely a
   * cache warm-up: the sync path stays as the cold-cache fallback, and results
   * are identical either way (the files are read-only and RNG-independent).
   */
  function prefetchPrefabMap(mapId) {
    if (prefabCache.has(mapId)) return;
    try {
      const xhr = new XMLHttpRequest();
      const mapIdStr = String(mapId).padStart(3, '0');
      xhr.open('GET', `data/prefabs/Map${mapIdStr}.json`, true); // async
      xhr.onload = () => {
        if ((xhr.status === 200 || xhr.status === 0) && !prefabCache.has(mapId)) {
          try { prefabCache.set(mapId, JSON.parse(xhr.responseText)); } catch (e) { /* ignore */ }
        }
      };
      xhr.onerror = () => { /* ignore; sync fallback will retry on demand */ };
      xhr.send();
    } catch (e) { /* ignore */ }
  }

  let _prefetchStarted = false;
  let _prefetchRetries = 0;
  function prefetchAllPrefabs() {
    if (_prefetchStarted) return;
    const biomes = getBiomes();
    if (!biomes || biomes.length === 0) {
      // Biome DB not ready yet; retry a bounded number of times.
      if (_prefetchRetries++ < 20) setTimeout(prefetchAllPrefabs, 1000);
      return;
    }
    _prefetchStarted = true;
    const ids = new Set();
    for (const biome of biomes) {
      if (biome && Array.isArray(biome.prefabs)) {
        for (const id of biome.prefabs.flat()) ids.add(id);
      }
    }
    ids.forEach(prefetchPrefabMap);
  }

  /**
   * Builds a Summed Area Table (Integral Image) for O(1) collision checks
   * Returns a 1D Int32Array representing a 2D grid where cell [y][x] 
   * contains the sum of all occupied pixels above and to the left.
   */
  function buildSummedAreaTable(occupiedMapData, width, height) {
    // SAT dimensions are (width + 1) * (height + 1) to handle edge cases easily
    const satWidth = width + 1;
    const satHeight = height + 1;
    const sat = new Int32Array(satWidth * satHeight).fill(0);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isOccupied = occupiedMapData[y * width + x] === 1 ? 1 : 0;

        // Formula: SAT[y+1][x+1] = pixel + Left + Top - TopLeft
        const left = sat[(y + 1) * satWidth + x];
        const top = sat[y * satWidth + (x + 1)];
        const topLeft = sat[y * satWidth + x];

        sat[(y + 1) * satWidth + (x + 1)] = isOccupied + left + top - topLeft;
      }
    }
    return sat;
  }

  /**
   * Extract all non-terrain feature tile IDs that should be cleared
   */
  function getNonTerrainFeatureTileIds(biome, allFeatures) {
    if (!biome || !biome.features) return [];

    const terrainFeatureNames = new Set(
      biome.features
        .filter(f => f.terrain === true)
        .map(f => f.name)
    );

    const nonTerrainTileIds = [];

    for (const feature of biome.features) {
      if (terrainFeatureNames.has(feature.name)) continue;

      const featureTiles = allFeatures[feature.name] || [];
      for (const variant of featureTiles) {
        if (variant.type === "single") {
          nonTerrainTileIds.push(variant.tileId);
        } else if (variant.type === "multi") {
          for (const row of variant.tiles) {
            for (const tileId of row) {
              nonTerrainTileIds.push(tileId);
            }
          }
        }
      }
    }
    return nonTerrainTileIds;
  }

  /**
   * Collect the GasPump tile ids defined on a biome's tileset(s) (e.g. the
   * `<GasPump: [C71, C72],[C79, C80]>` entries on the Road tileset note).
   * Data-driven so it tracks whichever tileset features are actually tagged,
   * rather than hardcoding the prefab map ids that happen to use them today.
   */
  function getGasPumpTileIds(biome) {
    const ids = new Set();
    const Cache = window.ProcGenUtils && window.ProcGenUtils.Cache;
    if (!Cache) return ids;
    const tilesetIds = biome.tilesetIds || [biome.tilesetId];
    for (const tilesetId of tilesetIds) {
      try {
        const features = Cache.getTilesetFeatures(tilesetId);
        if (!features) continue;
        // Both feature names denote a roadside pump (they sit on different
        // source sheets of the Road tileset), so both mark a gas station.
        for (const name of ["GasPump", "RefuelStation"]) {
          const variants = features[name];
          if (!Array.isArray(variants)) continue;
          variants.forEach(variant => {
            if (variant.type === "single") {
              ids.add(variant.tileId);
            } else if (variant.type === "grid" && variant.grid) {
              variant.grid.forEach(row => row.forEach(id => ids.add(id)));
            }
          });
        }
      } catch (e) { /* ignore */ }
    }
    return ids;
  }

  /**
   * Whether a loaded prefab map paints any GasPump tile. Memoized on the
   * (cached) prefab map object itself so the scan only runs once per mapId.
   */
  function prefabHasGasPump(prefabMap, gasPumpIds) {
    if (!gasPumpIds || gasPumpIds.size === 0) return false;
    if (prefabMap._hasGasPump !== undefined) return prefabMap._hasGasPump;
    const data = prefabMap.data;
    let found = false;
    for (let i = 0; i < data.length; i++) {
      if (gasPumpIds.has(data[i])) { found = true; break; }
    }
    prefabMap._hasGasPump = found;
    return found;
  }

  /**
   * Determine random prefab count based on biome type
   */
  function getPrefabCount(rng, biomeName) {
    if (biomeName && biomeName.toLowerCase().includes("city")) {
      return 15 + Math.floor(rng() * 6);
    } else if (biomeName && biomeName.toLowerCase().includes("village")) {
      return 8 + Math.floor(rng() * 8);
    } else if (biomeName && biomeName.toLowerCase().includes("ocean")) {
      // Islands should be rare, not a landmark on every ocean tile: most ocean
      // maps get none at all, and the ones that do only get a small handful.
      if (rng() >= OCEAN_ISLAND_CHANCE) return 0;
      return 1 + Math.floor(rng() * 3); // 1-3
    } else {
      return 4 + Math.floor(rng() * 11);
    }
  }

  /**
   * Single source of truth for prefab-vs-prefab overlap. Two axis-aligned
   * rectangles collide when they are NOT separated on any axis, where a clear
   * gap of `spacing` tiles is required on every side. Used both by the
   * placement checks and by the final collision-guarantee pass so the two can
   * never disagree.
   */
  function rectsCollide(x, y, w, h, other, spacing) {
    const s = spacing !== undefined ? spacing : 1;
    const separated = (
      x >= other.x + other.width + s ||    // To the right
      x + w + s <= other.x ||              // To the left
      y >= other.y + other.height + s ||   // Below
      y + h + s <= other.y                 // Above
    );
    return !separated;
  }

  /**
   * Final safety net: guarantees NO two placed prefabs overlap, regardless of
   * which placement strategy (village hints / city lots / grid fallback)
   * produced the positions. Every return path in generatePrefabPositions goes
   * through this, so a strategy that ever emits an overlapping candidate (or a
   * future strategy that forgets to consult allPlacedRects) can never leak a
   * collision onto the map - the offending prefab is simply dropped.
   */
  function enforceNoPrefabCollisions(positions, spacing) {
    const accepted = [];
    let dropped = 0;

    for (let p = 0; p < positions.length; p++) {
      const pos = positions[p];
      let collides = false;

      for (let i = 0; i < accepted.length; i++) {
        if (rectsCollide(pos.x, pos.y, pos.width, pos.height, accepted[i], spacing)) {
          collides = true;
          break;
        }
      }

      if (collides) {
        dropped++;
        continue;
      }
      accepted.push(pos);
    }

    if (dropped > 0 && typeof Utils !== "undefined" && Utils.isOptionValid && Utils.isOptionValid("test")) {
      console.warn(`[PrefabGenerator] Dropped ${dropped} prefab(s) to avoid collision`);
    }

    return accepted;
  }

  /**
   * Optimized canPlacePrefabAt using Summed Area Table (SAT)
   * SAT allows us to check a rectangular area for roads in 4 lookups instead of W*H lookups.
   * Also checks for water tile overlap (unless in Ocean biome).
   */
  function canPlacePrefabAt(x, y, prefabWidth, prefabHeight, occupiedAreas, satData, SPACING, waterSatData) {
    // 1. Bounds Check
    if (x < 0 || y < 0 || x + prefabWidth > PROC_MAP_WIDTH || y + prefabHeight > PROC_MAP_HEIGHT) {
      return false;
    }

    // 2. Road Collision Check (O(1) using SAT)
    if (satData) {
      const satWidth = PROC_MAP_WIDTH + 1;
      const x2 = x + prefabWidth;
      const y2 = y + prefabHeight;

      if (x2 >= satWidth || y2 > PROC_MAP_HEIGHT) return false;

      const D = satData[y2 * satWidth + x2];
      const B = satData[y * satWidth + x2];
      const C = satData[y2 * satWidth + x];
      const A = satData[y * satWidth + x];

      if ((D - B - C + A) > 0) return false; // Contains at least 1 road tile
    }

    // 2b. Water Collision Check (O(1) using SAT)
    if (waterSatData) {
      const satWidth = PROC_MAP_WIDTH + 1;
      const x2 = x + prefabWidth;
      const y2 = y + prefabHeight;

      if (x2 >= satWidth || y2 > PROC_MAP_HEIGHT) return false;

      const D = waterSatData[y2 * satWidth + x2];
      const B = waterSatData[y * satWidth + x2];
      const C = waterSatData[y2 * satWidth + x];
      const A = waterSatData[y * satWidth + x];

      if ((D - B - C + A) > 0) return false; // Contains at least 1 water tile
    }

    // 3. Strict Prefab Overlap Check (AABB) - shared with the final guarantee pass
    if (occupiedAreas && occupiedAreas.length > 0) {
      const spacing = SPACING !== undefined ? SPACING : 1;

      for (let i = 0; i < occupiedAreas.length; i++) {
        if (rectsCollide(x, y, prefabWidth, prefabHeight, occupiedAreas[i], spacing)) {
          return false; // Collision detected
        }
      }
    }

    return true;
  }

  /**
   * Generate random positions for prefabs
   * Uses SAT data for road and water checking if available
   */
  function generatePrefabPositions(prefabCount, rng, prefabSizes, biomeName, blockHints, satData, waterSatData, placementHints, roomHints, preplaced) {
    if (prefabCount <= 0 || !prefabSizes || prefabSizes.length === 0) {
      return [];
    }

    const positions = [];
    const isCity = biomeName && biomeName.toLowerCase().includes("city");
    const isVillage = biomeName && biomeName.toLowerCase().includes("village");

    // STRICT SPACING: Ensure at least 1 tile gap between all prefabs
    const SPACING = 1;
    const allPlacedRects = [];

    // Dungeon / Crypt / Sewer: fit prefabs strictly INSIDE room rectangles so a
    // prefab never spills onto the surrounding walls/ceiling. Only prefabs whose
    // footprint is <= the room's floor are eligible, and they are centred in it.
    if (roomHints && roomHints.length > 0) {
      for (let ri = 0; ri < roomHints.length && positions.length < prefabCount; ri++) {
        const room = roomHints[ri];
        const fitting = prefabSizes.filter(p => p.width <= room.width && p.height <= room.height);
        if (fitting.length === 0) continue; // no prefab fits this room -> skip it
        const prefab = fitting[Math.floor(rng() * fitting.length)];
        const cx = room.x + Math.floor((room.width - prefab.width) / 2);
        const cy = room.y + Math.floor((room.height - prefab.height) / 2);
        if (canPlacePrefabAt(cx, cy, prefab.width, prefab.height, allPlacedRects, satData, SPACING, waterSatData)) {
          positions.push({ x: cx, y: cy, width: prefab.width, height: prefab.height, mapId: prefab.mapId });
          allPlacedRects.push({ x: cx, y: cy, width: prefab.width, height: prefab.height });
        }
      }
      return enforceNoPrefabCollisions(positions, SPACING);
    }

    // Village biomes use placement hints from structure generator
    if (isVillage && placementHints && placementHints.length > 0) {
      if (Utils.isOptionValid("test")) console.log(`[PrefabGenerator] Village prefab placement: ${placementHints.length} hints, ${prefabCount} desired prefabs`);
      let skippedDueToOverlap = 0;

      // Village prefabs come in every size from 4x4 up to 32x32. Assigning one
      // per lot by index and dropping it when it did not fit systematically
      // starved the big ones - a lot only ever held the prefab it was handed -
      // and left villages built out of whatever happened to be small enough.
      // Instead every lot takes the LARGEST prefab that still fits it,
      // preferring one not placed yet, so houses claim the room they need and
      // the small stuff fills in around them.
      const byAreaDesc = prefabSizes.slice().sort(
        (a, b) => (b.width * b.height) - (a.width * a.height)
      );
      const usedMapIds = new Set();

      for (let hintIndex = 0; hintIndex < placementHints.length && positions.length < prefabCount; hintIndex++) {
        const hint = placementHints[hintIndex];

        let finalX = null;
        let finalY = null;
        let prefab = null;

        // Pass 0: prefabs not placed on this map yet. Pass 1: allow repeats.
        for (let pass = 0; pass < 2 && finalX === null; pass++) {
          for (let ci = 0; ci < byAreaDesc.length && finalX === null; ci++) {
            const candidate = byAreaDesc[ci];
            if (pass === 0 && usedMapIds.has(candidate.mapId)) continue;

            // Keep the footprint on the map: lots sit as close as 2 tiles to the
            // edge, and a large prefab centred on one would hang off it.
            const centerX = Math.max(0, Math.min(
              Math.floor(hint.x - candidate.width / 2), PROC_MAP_WIDTH - candidate.width));
            const centerY = Math.max(0, Math.min(
              Math.floor(hint.y - candidate.height / 2), PROC_MAP_HEIGHT - candidate.height));

            if (canPlacePrefabAt(centerX, centerY, candidate.width, candidate.height, allPlacedRects, satData, SPACING, waterSatData)) {
              prefab = candidate;
              finalX = centerX;
              finalY = centerY;
              break;
            }

            // Strategy 2: Wiggle room (Reduced radius to prevent erratic jumps)
            const searchRadius = 3;
            for (let dy = -searchRadius; dy <= searchRadius && finalX === null; dy++) {
              for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                const tryX = centerX + dx;
                const tryY = centerY + dy;

                if (canPlacePrefabAt(tryX, tryY, candidate.width, candidate.height, allPlacedRects, satData, SPACING, waterSatData)) {
                  prefab = candidate;
                  finalX = tryX;
                  finalY = tryY;
                  break;
                }
              }
            }
          }
        }

        if (finalX !== null) {
          usedMapIds.add(prefab.mapId);
          positions.push({
            x: finalX,
            y: finalY,
            width: prefab.width,
            height: prefab.height,
            mapId: prefab.mapId
          });
          allPlacedRects.push({
            x: finalX,
            y: finalY,
            width: prefab.width,
            height: prefab.height
          });
        } else {
          skippedDueToOverlap++;
        }
      }

      if (Utils.isOptionValid("test")) console.log(`[PrefabGenerator] Village prefabs placed: ${positions.length}, skipped overlap: ${skippedDueToOverlap}`);
      return enforceNoPrefabCollisions(positions, SPACING);
    }

    // City biomes use building lot hints from structure generator
    if (isCity && blockHints && blockHints.length > 0) {
      for (let lotIndex = 0; lotIndex < blockHints.length && prefabSizes.length > 0; lotIndex++) {
        const lot = blockHints[lotIndex];
        const prefabIndex = lotIndex % prefabSizes.length;
        const prefab = prefabSizes[prefabIndex];

        let finalX = null;
        let finalY = null;

        // Strategy 1: Center in lot
        const centerX = Math.floor(lot.x + (lot.w - prefab.width) / 2);
        const centerY = Math.floor(lot.y + (lot.h - prefab.height) / 2);

        if (canPlacePrefabAt(centerX, centerY, prefab.width, prefab.height, allPlacedRects, satData, SPACING, waterSatData)) {
          finalX = centerX;
          finalY = centerY;
        } else {
          // Strategy 2: Try corners, but ensure they don't overlap existing placements
          // We strictly validate candidates using canPlacePrefabAt which checks allPlacedRects
          const corners = [
            { x: lot.x, y: lot.y },
            { x: lot.x + lot.w - prefab.width, y: lot.y },
            { x: lot.x, y: lot.y + lot.h - prefab.height },
            { x: lot.x + lot.w - prefab.width, y: lot.y + lot.h - prefab.height }
          ];

          for (const corner of corners) {
            // Constrain to map bounds
            if (corner.x < 0 || corner.y < 0) continue;

            // Constrain corner logic to be relatively close to the lot
            const cx = Math.max(lot.x - 2, Math.min(corner.x, lot.x + lot.w - prefab.width + 2));
            const cy = Math.max(lot.y - 2, Math.min(corner.y, lot.y + lot.h - prefab.height + 2));

            if (canPlacePrefabAt(cx, cy, prefab.width, prefab.height, allPlacedRects, satData, SPACING, waterSatData)) {
              finalX = cx;
              finalY = cy;
              break;
            }
          }
        }

        if (finalX !== null) {
          positions.push({
            x: finalX,
            y: finalY,
            width: prefab.width,
            height: prefab.height,
            mapId: prefab.mapId
          });
          allPlacedRects.push({
            x: finalX,
            y: finalY,
            width: prefab.width,
            height: prefab.height
          });
        }
      }
      return enforceNoPrefabCollisions(positions, SPACING);
    }

    // Roadside pair (see tryPlaceRoadsidePair): seed the fallback pass with
    // positions already claimed on either side of the road, so the random
    // scatter below neither overlaps them nor wastes its budget re-placing them.
    if (preplaced && preplaced.length > 0) {
      for (const p of preplaced) {
        positions.push(p);
        allPlacedRects.push({ x: p.x, y: p.y, width: p.width, height: p.height });
      }
      prefabCount = Math.max(0, prefabCount - preplaced.length);
    }

    // Fallback grid-based placement for non-city biomes
    const gridWidth = Math.floor(PROC_MAP_WIDTH / GRID_UNIT);
    const gridHeight = Math.floor(PROC_MAP_HEIGHT / GRID_UNIT);
    const sectorOccupied = new Uint8Array(gridWidth * gridHeight);

    for (let i = 0; i < prefabCount; i++) {
      const prefabIndex = i % prefabSizes.length;
      const size = prefabSizes[prefabIndex];
      const gridUnitsWide = Math.ceil(size.width / GRID_UNIT);
      const gridUnitsTall = Math.ceil(size.height / GRID_UNIT);

      for (let attempt = 0; attempt < 15; attempt++) {
        if (gridWidth > gridUnitsWide && gridHeight > gridUnitsTall) {
          const gridX = Math.floor(rng() * (gridWidth - gridUnitsWide));
          const gridY = Math.floor(rng() * (gridHeight - gridUnitsTall));

          if (sectorOccupied[gridY * gridWidth + gridX] === 1) continue;

          const tileX = gridX * GRID_UNIT;
          const tileY = gridY * GRID_UNIT;

          // Pass 0 as spacing here if needed, but safer to use SPACING (1)
          if (canPlacePrefabAt(tileX, tileY, size.width, size.height, allPlacedRects, satData, SPACING, waterSatData)) {

            for (let gy = gridY; gy < gridY + gridUnitsTall; gy++) {
              for (let gx = gridX; gx < gridX + gridUnitsWide; gx++) {
                if (gy < gridHeight && gx < gridWidth) {
                  sectorOccupied[gy * gridWidth + gx] = 1;
                }
              }
            }

            positions.push({
              x: tileX,
              y: tileY,
              width: size.width,
              height: size.height,
              mapId: size.mapId
            });

            allPlacedRects.push({
              x: tileX,
              y: tileY,
              width: size.width,
              height: size.height
            });

            break; // Success
          }
        }
      }
    }

    return enforceNoPrefabCollisions(positions, SPACING);
  }

  /**
   * A linear (non-intersection) road's layout leaves an open margin on either
   * side of the two carriageways (see getLinearRoadGeometry). With some
   * probability, place two DIFFERENT prefabs there - one on each side, set
   * back ROAD_SIDE_GAP tiles from the carriageway edge so they never clip the
   * road. Returns [] if the current map isn't a plain linear road, if nothing
   * fits, or if the roll didn't hit.
   */
  function tryPlaceRoadsidePair(rng, prefabsWithSizes, satData, waterSatData) {
    const Roads = window.ProcGenRoads;
    if (!Roads || !Roads.getLinearRoadGeometry) return [];

    const procData = typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._procGenData;
    const shape = procData && procData.roadLayoutShape;
    let orientation = null;
    if (shape) {
      const s = String(shape).toLowerCase();
      if (!s.includes("cross") && !s.includes("t-") && !s.includes("corner-")) {
        if (s === "vertical" || s === "up") orientation = "vertical";
        else if (s === "horizontal") orientation = "horizontal";
      }
    }
    if (!orientation) return [];

    const geo = Roads.getLinearRoadGeometry(PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
    // Both margins are symmetric by construction (the map is centered), so a
    // single depth budget applies to whichever pair of sides we're using.
    const sideDepth = orientation === "horizontal" ? geo.topRoadY : geo.leftRoadX;

    const candidates = prefabsWithSizes.filter(p => !p.isGasStation &&
      (orientation === "horizontal" ? p.height : p.width) + ROAD_SIDE_GAP <= sideDepth);
    if (candidates.length < 2) return [];

    const first = candidates[Math.floor(rng() * candidates.length)];
    const rest = candidates.filter(p => p.mapId !== first.mapId);
    const second = rest[Math.floor(rng() * rest.length)];

    const SPACING = 1;
    const results = [];

    if (orientation === "horizontal") {
      const nearY = geo.topRoadY - ROAD_SIDE_GAP - first.height;
      const nearX = Math.floor(rng() * Math.max(1, PROC_MAP_WIDTH - first.width));
      if (canPlacePrefabAt(nearX, nearY, first.width, first.height, [], satData, SPACING, waterSatData)) {
        results.push({ x: nearX, y: nearY, width: first.width, height: first.height, mapId: first.mapId });
      }

      const farY = geo.bottomRoadY + geo.roadWidth + ROAD_SIDE_GAP;
      const farX = Math.floor(rng() * Math.max(1, PROC_MAP_WIDTH - second.width));
      if (canPlacePrefabAt(farX, farY, second.width, second.height, results, satData, SPACING, waterSatData)) {
        results.push({ x: farX, y: farY, width: second.width, height: second.height, mapId: second.mapId });
      }
    } else {
      const nearX = geo.leftRoadX - ROAD_SIDE_GAP - first.width;
      const nearY = Math.floor(rng() * Math.max(1, PROC_MAP_HEIGHT - first.height));
      if (canPlacePrefabAt(nearX, nearY, first.width, first.height, [], satData, SPACING, waterSatData)) {
        results.push({ x: nearX, y: nearY, width: first.width, height: first.height, mapId: first.mapId });
      }

      const farX = geo.rightRoadX + geo.roadWidth + ROAD_SIDE_GAP;
      const farY = Math.floor(rng() * Math.max(1, PROC_MAP_HEIGHT - second.height));
      if (canPlacePrefabAt(farX, farY, second.width, second.height, results, satData, SPACING, waterSatData)) {
        results.push({ x: farX, y: farY, width: second.width, height: second.height, mapId: second.mapId });
      }
    }

    return results;
  }

  function rectContainsPoint(rect, x, y) {
    return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
  }

  /**
   * Ring search outward from (fromX, fromY) for the nearest tile already
   * carved to `floorTile`, ignoring the prefab's own just-carved buffer
   * (excludeRect) so it doesn't just find itself. Falls back to the map
   * center - always floor, see generateCaveBiomeTerrain's safe spawn area -
   * on the vanishingly unlikely chance nothing turns up.
   */
  function findNearestCaveFloor(mapData, fromX, fromY, floorTile, excludeRect) {
    const maxRadius = Math.max(PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const onHorizontalEdge = Math.abs(dy) === r;
        for (let dx = -r; dx <= r; dx++) {
          if (!onHorizontalEdge && Math.abs(dx) !== r) continue; // ring only, not filled square
          const x = fromX + dx;
          const y = fromY + dy;
          if (x < 0 || x >= PROC_MAP_WIDTH || y < 0 || y >= PROC_MAP_HEIGHT) continue;
          if (excludeRect && rectContainsPoint(excludeRect, x, y)) continue;
          if (mapData[calculateIndex(x, y, 0, PROC_MAP_WIDTH, PROC_MAP_HEIGHT)] === floorTile) {
            return { x, y };
          }
        }
      }
    }
    return { x: Math.floor(PROC_MAP_WIDTH / 2), y: Math.floor(PROC_MAP_HEIGHT / 2) };
  }

  /**
   * Cave biomes (generateCaveBiomeTerrain) carve organic, unpredictable
   * passages - a prefab positioned by the generic placement pass has no
   * guarantee it landed on open floor, or that it's reachable from the rest
   * of the cave. Force-clear its footprint plus a 1-tile buffer to floor, and
   * cut a short corridor back to the nearest pre-existing floor tile so the
   * prefab is always both open and reachable, never sealed inside solid rock.
   * `obstacleRects` (previously placed prefab footprints this pass) are
   * routed around so the corridor never chews through an earlier building.
   */
  function carveCaveSpaceForPrefab(mapData, position, floorTile, obstacleRects) {
    const bufferRect = {
      x: Math.max(0, position.x - 1),
      y: Math.max(0, position.y - 1),
    };
    const bx1 = Math.min(PROC_MAP_WIDTH, position.x + position.width + 1);
    const by1 = Math.min(PROC_MAP_HEIGHT, position.y + position.height + 1);
    bufferRect.width = bx1 - bufferRect.x;
    bufferRect.height = by1 - bufferRect.y;

    for (let y = bufferRect.y; y < by1; y++) {
      for (let x = bufferRect.x; x < bx1; x++) {
        mapData[calculateIndex(x, y, 0, PROC_MAP_WIDTH, PROC_MAP_HEIGHT)] = floorTile;
        for (let layer = 1; layer <= 3; layer++) {
          mapData[calculateIndex(x, y, layer, PROC_MAP_WIDTH, PROC_MAP_HEIGHT)] = 0;
        }
      }
    }

    const fromX = Math.floor(position.x + position.width / 2);
    const fromY = Math.floor(position.y + position.height / 2);
    const dest = findNearestCaveFloor(mapData, fromX, fromY, floorTile, bufferRect);

    const tunnelRadius = 1; // 3-tile-wide corridor
    let cx = fromX;
    let cy = fromY;
    const dx = Math.abs(dest.x - cx);
    const dy = Math.abs(dest.y - cy);
    const sx = cx < dest.x ? 1 : -1;
    const sy = cy < dest.y ? 1 : -1;
    let err = dx - dy;

    while (true) {
      for (let ty = -tunnelRadius; ty <= tunnelRadius; ty++) {
        for (let tx = -tunnelRadius; tx <= tunnelRadius; tx++) {
          const nx = cx + tx;
          const ny = cy + ty;
          if (nx < 0 || nx >= PROC_MAP_WIDTH || ny < 0 || ny >= PROC_MAP_HEIGHT) continue;
          if (obstacleRects && obstacleRects.some(r => rectContainsPoint(r, nx, ny))) continue;
          mapData[calculateIndex(nx, ny, 0, PROC_MAP_WIDTH, PROC_MAP_HEIGHT)] = floorTile;
        }
      }
      if (cx === dest.x && cy === dest.y) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
  }

  /**
   * Place a single prefab map into the procedural map
   */
  function placePrefab(mapData, prefabMap, position, nonTerrainTileIds) {
    if (!prefabMap || !prefabMap.data) return;

    const prefabData = prefabMap.data;
    const prefabWidth = prefabMap.width;
    const prefabHeight = prefabMap.height;

    if (position.x + prefabWidth > PROC_MAP_WIDTH ||
      position.y + prefabHeight > PROC_MAP_HEIGHT) {
      return;
    }

    const nonTerrainSet = new Set(nonTerrainTileIds);

    // Single pass: process prefab tiles
    for (let py = 0; py < prefabHeight; py++) {
      for (let px = 0; px < prefabWidth; px++) {
        const mapX = position.x + px;
        const mapY = position.y + py;

        let hasPrefabContent = false;
        const prefabTilesAtPosition = [];

        for (let layer = 0; layer < 4; layer++) {
          const srcIdx = calculateIndex(px, py, layer, prefabWidth, prefabHeight);
          if (srcIdx < prefabData.length) {
            const tile = prefabData[srcIdx];
            prefabTilesAtPosition[layer] = tile;
            if (tile !== 0) {
              hasPrefabContent = true;
            }
          }
        }

        // Shadow-pen bits (layer 4): the quarter-tile darkening RPG Maker's
        // core Tilemap._addShadow reads. Read alongside the tile layers but
        // kept out of the hasPrefabContent check above - a prefab cell should
        // never be treated as "occupied" purely because it carries a shadow.
        const shadowSrcIdx = calculateIndex(px, py, 4, prefabWidth, prefabHeight);
        const shadowBits = shadowSrcIdx < prefabData.length ? prefabData[shadowSrcIdx] : 0;

        if (hasPrefabContent) {
          // Clear non-terrain features
          for (let layer = 0; layer < 4; layer++) {
            const idx = calculateIndex(mapX, mapY, layer, PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
            const tileId = mapData[idx];
            if (nonTerrainSet.has(tileId)) {
              mapData[idx] = 0;
            }
          }

          // Copy prefab tiles
          for (let layer = 0; layer < 4; layer++) {
            const dstIdx = calculateIndex(mapX, mapY, layer, PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
            const tile = prefabTilesAtPosition[layer];

            if (dstIdx < mapData.length) {
              if (layer === 0 && tile === 0) continue;
              mapData[dstIdx] = tile;
            }
          }

          // Copy the prefab's shadow-pen data so placed prefabs keep the
          // shadows their source map was painted with.
          const shadowDstIdx = calculateIndex(mapX, mapY, 4, PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
          mapData[shadowDstIdx] = shadowBits;
        }
      }
    }
  }

  /**
   * Process a generated map to add prefabs
   */
  function applyPrefabsToMap(mapData, biomeName, worldCoords, allOtherData) {
    const biome = getBiomeByName(biomeName);

    if (!biome || !biome.prefabs || biome.prefabs.length === 0) {
      return mapData;
    }

    // Flatten the nested prefab arrays into a single array
    const availablePrefabs = biome.prefabs.flat();
    if (availablePrefabs.length === 0) {
      return mapData;
    }

    // Procedurally generated maps only allocate tile layers 0-3; the
    // shadow-pen layer (z=4) that RPG Maker's core Tilemap reads via
    // _readMapData(x, y, 4) doesn't exist in the array yet. Prefabs are real
    // authored maps and carry shadow-pen data painted in the editor, so grow
    // the array to hold it before placePrefab copies it in.
    const shadowLayerEnd = PROC_MAP_WIDTH * PROC_MAP_HEIGHT * 5;
    if (mapData.length < shadowLayerEnd) {
      for (let i = mapData.length; i < shadowLayerEnd; i++) mapData[i] = 0;
    }

    // RNG Setup, mixed with the world seed so prefab selection/layout differs per world
    const coordSeed = hashCoords(getWorldSeed(), worldCoords.x, worldCoords.y);
    const biomeSeed = biomeName.charCodeAt(0) * 73856093 ^
      biomeName.charCodeAt(Math.min(1, biomeName.length - 1)) * 19349663;
    const seed = (coordSeed ^ biomeSeed) >>> 0;
    const rng = createSeededRandom(seed);

    // getPrefabCount returns >= 4 for most biomes, but can return 0 for Ocean
    // (most ocean tiles have no islands at all).
    const prefabCount = getPrefabCount(rng, biomeName);
    if (prefabCount === 0) return mapData;

    const allowReuse = allOtherData?.allowPrefabReuse === true;
    const lowerBiome = biomeName.toLowerCase();
    const isRoadLikeBiome = lowerBiome.includes("road");

    // Villages draw mostly from their own house group (see
    // VILLAGE_LANDMARK_CHANCE); every other biome keeps the flat pool.
    const prefabGroups = biome.prefabs
      .map(group => (Array.isArray(group) ? group : [group]))
      .filter(group => group.length > 0);
    const weightVillageHouses = lowerBiome.includes("village") && prefabGroups.length > 1;
    const housePool = weightVillageHouses ? prefabGroups[0] : null;
    const landmarkPool = weightVillageHouses ? prefabGroups[prefabGroups.length - 1] : null;
    const pickPrefabId = () => {
      if (!weightVillageHouses) return randomChoice(availablePrefabs, rng);
      return randomChoice(rng() < VILLAGE_LANDMARK_CHANCE ? landmarkPool : housePool, rng);
    };

    // Gas-station prefabs (detected by GasPump tiles, see getGasPumpTileIds)
    // are otherwise picked exactly as often as any other roadside filler,
    // which put one on nearly every road tile. Roll once per map whether a
    // gas station is allowed at all, and never allow more than one.
    const gasPumpIds = isRoadLikeBiome ? getGasPumpTileIds(biome) : null;
    const allowGasStation = !isRoadLikeBiome || rng() < ROAD_GAS_STATION_CHANCE;
    let gasStationPlaced = false;

    // Load unique prefabs (Cached)
    const prefabsWithSizes = [];
    const selectedMapIds = new Set();
    let attempts = 0;
    const maxAttempts = (allowReuse ? 3 : prefabCount) * 20;
    const targetCount = allowReuse ? Math.min(availablePrefabs.length, 6) : prefabCount;

    while (prefabsWithSizes.length < targetCount && attempts < maxAttempts) {
      attempts++;
      const prefabMapId = pickPrefabId();

      if (selectedMapIds.has(prefabMapId)) continue;

      const prefabMap = loadPrefabSync(prefabMapId);

      if (prefabMap) {
        if (prefabMap.width > 0 && prefabMap.height > 0 &&
          prefabMap.width <= PROC_MAP_WIDTH && prefabMap.height <= PROC_MAP_HEIGHT) {

          const isGasStation = isRoadLikeBiome && prefabHasGasPump(prefabMap, gasPumpIds);
          if (isGasStation && (!allowGasStation || gasStationPlaced)) {
            continue; // Road biomes only get a gas station some of the time, and never more than one
          }
          if (isGasStation) gasStationPlaced = true;

          prefabsWithSizes.push({
            mapId: prefabMapId,
            width: prefabMap.width,
            height: prefabMap.height,
            data: prefabMap,
            isGasStation
          });
          selectedMapIds.add(prefabMapId);
        }
      }
    }

    if (prefabsWithSizes.length === 0) return mapData;

    // --- CONDITIONAL ROAD DETECTION ---
    // We only scan for roads if the biome is "City" or "Road"
    const shouldCheckRoads = lowerBiome.includes("city") || isRoadLikeBiome;

    let satData = null;

    if (shouldCheckRoads) {
      // Optimization: Use Int8Array for lower memory footprint
      const occupiedMapData = new Int8Array(PROC_MAP_WIDTH * PROC_MAP_HEIGHT);
      const roadTileIds = new Set();

      // Identify tiles (Logic preserved)
      const tilesetIds = biome.tilesetIds || [biome.tilesetId];
      try {
        const Cache = window.ProcGenUtils && window.ProcGenUtils.Cache;
        if (Cache) {
          for (const tilesetId of tilesetIds) {
            try {
              const features = Cache.getTilesetFeatures(tilesetId);
              if (features) {
                for (const [name, featureList] of Object.entries(features)) {
                  const lowerName = name.toLowerCase();
                  if (lowerName.includes("road") || lowerName.includes("dashed")) {
                    if (Array.isArray(featureList)) {
                      featureList.forEach(v => {
                        if (v.type === "single") {
                          roadTileIds.add(v.tileId);
                        } else if (v.type === "multi" && v.tiles) {
                          v.tiles.forEach(row => row.forEach(id => roadTileIds.add(id)));
                        }
                      });
                    }
                  }
                }
              }
            } catch (e) { }
          }
        }
      } catch (e) { }

      // OPTIMIZED ROAD SCANNING LOOP
      const layerSize = PROC_MAP_WIDTH * PROC_MAP_HEIGHT;
      for (let i = 0; i < layerSize; i++) {
        // Check Layer 0, 1, 2, 3 directly
        if (roadTileIds.has(mapData[i]) ||
          roadTileIds.has(mapData[i + layerSize]) ||
          roadTileIds.has(mapData[i + layerSize * 2]) ||
          roadTileIds.has(mapData[i + layerSize * 3])) {
          occupiedMapData[i] = 1;
        }
      }

      // Build the Summed Area Table (SAT)
      satData = buildSummedAreaTable(occupiedMapData, PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
    }

    // --- CONDITIONAL WATER DETECTION ---
    // We scan for water tiles UNLESS the biome is "Ocean" (where prefabs can overlap water)
    const isOceanBiome = isWaterBiome(biomeName) && lowerBiome.includes("ocean");
    let waterSatData = null;

    if (!isOceanBiome) {
      // Optimization: Use Int8Array for lower memory footprint
      const waterOccupiedMapData = new Int8Array(PROC_MAP_WIDTH * PROC_MAP_HEIGHT);
      const waterTileIds = new Set();

      // Identify water tiles
      const tilesetIds = biome.tilesetIds || [biome.tilesetId];
      try {
        const Cache = window.ProcGenUtils && window.ProcGenUtils.Cache;
        if (Cache) {
          for (const tilesetId of tilesetIds) {
            try {
              const features = Cache.getTilesetFeatures(tilesetId);
              if (features) {
                for (const [name, featureList] of Object.entries(features)) {
                  const lowerName = name.toLowerCase();
                  // Check for water-related features
                  if (lowerName.includes("water") || lowerName.includes("ocean") || lowerName.includes("beach")) {
                    if (Array.isArray(featureList)) {
                      featureList.forEach(v => {
                        if (v.type === "single") {
                          waterTileIds.add(v.tileId);
                        } else if (v.type === "multi" && v.tiles) {
                          v.tiles.forEach(row => row.forEach(id => waterTileIds.add(id)));
                        }
                      });
                    }
                  }
                }
              }
            } catch (e) { }
          }
        }
      } catch (e) { }

      // OPTIMIZED WATER SCANNING LOOP
      const layerSize = PROC_MAP_WIDTH * PROC_MAP_HEIGHT;
      for (let i = 0; i < layerSize; i++) {
        // Check Layer 0, 1, 2, 3 directly
        if (waterTileIds.has(mapData[i]) ||
          waterTileIds.has(mapData[i + layerSize]) ||
          waterTileIds.has(mapData[i + layerSize * 2]) ||
          waterTileIds.has(mapData[i + layerSize * 3])) {
          waterOccupiedMapData[i] = 1;
        }
      }

      // Build the Summed Area Table (SAT) for water
      waterSatData = buildSummedAreaTable(waterOccupiedMapData, PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
    }

    const blockHints = allOtherData?.blockHints;
    const placementHints = allOtherData?.placementHints;
    const roomHints = allOtherData?.roomHints;

    // On a plain linear road (not an intersection), sometimes place two
    // different prefabs facing each other across the road, set back from the
    // carriageway.
    const roadsidePair = (isRoadLikeBiome && rng() < ROAD_SIDE_PAIR_CHANCE)
      ? tryPlaceRoadsidePair(rng, prefabsWithSizes, satData, waterSatData)
      : [];

    // Generate positions (satData is null if not in City/Road biome, waterSatData is null if in Ocean biome)
    const positions = generatePrefabPositions(prefabCount, rng, prefabsWithSizes, biomeName, blockHints, satData, waterSatData, placementHints, roomHints, roadsidePair);

    // Build feature lookup for current biome (to find non-terrain features to clear)
    const allFeatures = {};
    let hasFeatures = false;
    const tilesetIds = biome.tilesetIds || [biome.tilesetId];

    try {
      const Cache = window.ProcGenUtils && window.ProcGenUtils.Cache;
      if (Cache) {
        for (const tilesetId of tilesetIds) {
          try {
            const features = Cache.getTilesetFeatures(tilesetId);
            if (features) {
              hasFeatures = true;
              for (const [name, tiles] of Object.entries(features)) {
                if (!allFeatures[name]) {
                  allFeatures[name] = [];
                }
                allFeatures[name] = allFeatures[name].concat(tiles);
              }
            }
          } catch (e) { }
        }
      }
    } catch (e) { }

    const nonTerrainTileIds = hasFeatures ? getNonTerrainFeatureTileIds(biome, allFeatures) : [];

    // Cave biomes carve organic passages that a prefab's position had no
    // guarantee of landing on (see carveCaveSpaceForPrefab).
    const caveFloorTile = mapData.caveFloorTile;
    const isCaveTerrain = caveFloorTile !== undefined && caveFloorTile !== null;
    const placedFootprints = [];

    // Place each prefab
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const prefabInfo = prefabsWithSizes.find(p => p.mapId === position.mapId);

      if (prefabInfo && prefabInfo.data) {
        if (isCaveTerrain) {
          carveCaveSpaceForPrefab(mapData, position, caveFloorTile, placedFootprints);
        }
        placePrefab(mapData, prefabInfo.data, position, nonTerrainTileIds);
        placedFootprints.push({ x: position.x, y: position.y, width: position.width, height: position.height });
      }
    }

    return mapData;
  }

  /**
   * Hook into the map data loading process
   */
  const _DataManager_loadMapData = DataManager.loadMapData;
  DataManager.loadMapData = function (mapId) {
    _DataManager_loadMapData.call(this, mapId);

    if (mapId === PROC_MAP_ID) {
      if ($gameSystem && $gameSystem._procGenData) {
        if ($gameSystem._procGenData.generatedMapData) {
          const biomeName = $gameSystem._procGenData.currentBiome;
          const worldX = $gameVariables.value(43) || 0;
          const worldY = $gameVariables.value(44) || 0;
          const worldCoords = { x: worldX, y: worldY };

          if (biomeName) {
            const pg = $gameSystem._procGenData;
            const mapData = pg.generatedMapData;
            // Feed the structure generator's building-lot / placement hints so
            // city & village prefabs align to lots instead of grid-fallback
            // placement (which ignored roads/buildings).
            // Only run the (expensive) prefab pass once per fresh map array, and
            // never over an array that already carries its prefabs.
            const alreadyPrefabbed = prefabbedMapData.has(mapData) ||
              (pg._prefabbedSig != null &&
                pg._prefabbedSig === mapDataFingerprint(mapData, biomeName, worldCoords));
            if (!alreadyPrefabbed) {
              let hints = pg.structureHints || undefined;
              // Dungeon-type maps attach their room rectangles so prefabs are
              // fitted inside rooms instead of grid-scattered over walls.
              if (mapData.rooms && mapData.rooms.length) {
                hints = Object.assign({}, hints, { roomHints: mapData.rooms });
              }
              applyPrefabsToMap(mapData, biomeName, worldCoords, hints);
              prefabbedMapData.add(mapData);
              // Fingerprinted AFTER the pass: applyPrefabsToMap grows the array
              // to hold the shadow layer and rewrites tiles, so this is the
              // finished square, which is what a later load will hand back.
              pg._prefabbedSig = mapDataFingerprint(mapData, biomeName, worldCoords);
            }
            if ($dataMap) {
              $dataMap.data = mapData;
            }
          }
        }
      }
    }
  };

  // Expose functions for debugging
  window.ProceduralMapPrefabs = {
    applyPrefabsToMap,
    loadPrefabSync,
    canPlacePrefabAt,
    loadMapDataSync: loadPrefabSync, // Alias for backward compatibility
    getPrefabCount,
    generatePrefabPositions,
    placePrefab,
    buildSummedAreaTable,
    rectsCollide,
    enforceNoPrefabCollisions,
    getGasPumpTileIds,
    prefabHasGasPump,
    tryPlaceRoadsidePair,
    carveCaveSpaceForPrefab,
    findNearestCaveFloor,
  };

  // Fire-and-forget cache warm-up (deferred so it never blocks plugin load).
  setTimeout(prefetchAllPrefabs, 0);
})();