/*:
 * @target MZ
 * @plugindesc Procedural river generation system: wide irregular rivers, intersections, reed and water-rock decoration
 * @author Omni-Lex
 *
 * @help
 * Procedural Map River Generator
 * ==============================
 * Handles all river-related terrain generation including:
 * - River detection and biome classification
 * - Wide, irregular river generation (horizontal, vertical)
 * - Intersection rivers (cross, T-junctions, corners)
 * - Connection-aware dead ends (rivers stop at the map centre unless the
 *   neighbouring biome is another river, a swamp or an ocean)
 * - River water decoration: reed patches at the banks, plus scattered
 *   WaterRock features across the water (nothing else is placed on water)
 * - River configuration parsing
 *
 * RIVER SHAPE
 * ===========
 * Rivers are now MUCH wider than before, covering most of the map, and their
 * banks wander irregularly. To stay connectable with the rivers of the
 * neighbouring procedural maps, each river SNAPS back to a fixed, centred width
 * wherever it crosses a map border. Between borders the banks are free to
 * wander.
 *
 * A river only runs all the way to a border on a given side when that side
 * connects onward to water (another river biome, a swamp or an ocean). A side
 * that does not connect is treated as a dead end: the river simply ends with a
 * rounded head near the centre of the map, mirroring how the road generator
 * loops dead-end roads back at the centre instead of running them off the map.
 *
 * RIVER DIRECTIONS:
 * ===============
 * LINEAR:
 *   - "horizontal"  : Horizontal river (left-right)
 *   - "vertical"    : Vertical river (up-down)
 *
 * INTERSECTIONS:
 *   - "cross"       : 4-way intersection (river confluence)
 *   - "t-up"/"t-north"     : T-junction with stem pointing north (missing south)
 *   - "t-down"/"t-south"   : T-junction with stem pointing south (missing north)
 *   - "t-left"/"t-west"    : T-junction with stem pointing west (missing east)
 *   - "t-right"/"t-east"   : T-junction with stem pointing east (missing west)
 *
 * CORNERS (L-shaped, connects two perpendicular directions):
 *   - "corner-up-right"     : Connects north and east
 *   - "corner-up-left"      : Connects north and west
 *   - "corner-down-right"   : Connects south and east
 *   - "corner-down-left"    : Connects south and west
 *   - "corner-north-east"   : Alias for corner-up-right
 *   - "corner-north-west"   : Alias for corner-up-left
 *   - "corner-south-east"   : Alias for corner-down-right
 *   - "corner-south-west"   : Alias for corner-down-left
 *
 * Requires ProceduralMapUtils.js to be loaded first
 */

(() => {
  "use strict";

  const pluginName = "ProceduralMapRiverGenerator";

  // Set true to emit this generator's verbose per-generation diagnostics.
  const DEBUG = false;
  const dlog = (...a) => { if (DEBUG) console.log(...a); };

  // Import utilities from ProceduralMapUtils
  const Utils2 = window.ProcGenUtils;
  if (!Utils2) {
    console.error(
      "ProceduralMapRiverGenerator requires ProceduralMapUtils plugin"
    );
    return;
  }

  const {
    createSeededRandom,
    randomChoice,
    calculateIndex,
    smoothNoise,
    PROC_MAP_WIDTH,
    PROC_MAP_HEIGHT,
  } = Utils2;

  // Fraction of the perpendicular map dimension used by the river. CONNECT is
  // the fixed centred width forced at each map-border crossing so adjacent maps
  // line up; MAX is the widest the (irregular) interior banks reach.
  const CONNECT_FRACTION = 0.16;
  const MAX_FRACTION = 0.42;

  const lerp = (a, b, t) => a + (b - a) * t;

  // ===== RIVER DETECTION =====

  /**
   * Check if biome is a river biome
   */
  function isRiverBiome(biomeName) {
    return (
      biomeName.toLowerCase().startsWith("river ") ||
      biomeName.toLowerCase() === "river" ||
      biomeName.toLowerCase() === "stream" ||
      parseRiverConfig(biomeName) !== null
    );
  }

  /**
   * A river runs onward to a border only when the neighbouring biome is another
   * body of water it can flow into: another river, a swamp, an ocean, a lake or
   * similar. Anything else (grass, forest, city, ...) is a dead end for that
   * side, and the river ends near the centre of the map instead.
   */
  function isRiverConnectable(biomeName) {
    if (!biomeName) return false;
    if (isRiverBiome(biomeName)) return true;
    return /(swamp|ocean|sea|lake|marsh|bog|pond|water|river)/i.test(biomeName);
  }

  /**
   * True when a world-map (map 315) tile id is a river marker. Rivers are drawn
   * on the world map either as the small "River horizontal/vertical/cross" biome
   * tiles or as the wide water autotiles; both resolve to a biome name that
   * starts with "River" via the tileset-96 biome table. Used so a river painted
   * over a real land biome is detected as an OVERLAY rather than replacing the
   * whole tile with a full river-biome map.
   */
  function isRiverWorldTile(tileId) {
    if (!tileId) return false;
    const getBiome = Utils2 && Utils2.getBiomeForWorldTile;
    if (!getBiome) return false;
    const name = getBiome(tileId);
    return typeof name === "string" && name.toLowerCase().indexOf("river") === 0;
  }

  // ===== RIVER CONFIGURATION =====

  /**
   * Parse river configuration from biome name
   */
  function parseRiverConfig(biomeName) {
    const riverMatch = biomeName.match(/<River:\s*(\d+)\s+(\w+-?\w*)>/i);
    if (riverMatch) {
      return {
        tileId: parseInt(riverMatch[1]),
        direction: riverMatch[2].toLowerCase(),
        isCross: riverMatch[2].toLowerCase() === "cross",
        isT: riverMatch[2].toLowerCase().startsWith("t-"),
      };
    }
    return null;
  }

  /**
   * Get river decoration tile ID from features (reeds, rocks, etc.)
   * Returns the first single-tile variant of RiverEdge, or null if not found.
   * (Legacy accessor kept for the biome generator's import; decoration is now
   * driven by the Reed / WaterRock / GrassWater features directly.)
   */
  function getRiverDecorationTileId(allFeatures) {
    if (allFeatures["RiverEdge"] && allFeatures["RiverEdge"].length > 0) {
      for (const variant of allFeatures["RiverEdge"]) {
        if (variant.type === "single") {
          return variant.tileId;
        }
      }
    }
    return null;
  }

  // ===== RIVER TILE DETECTION =====

  /**
   * Check if a position is on a river tile. Uses the wide-river envelope so
   * callers that want to avoid placing things ON the river stay consistent with
   * the drawn width.
   */
  function isPositionOnRiverTile(x, y, width, height) {
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const halfW = Math.floor((width * MAX_FRACTION) / 2);
    const halfH = Math.floor((height * MAX_FRACTION) / 2);

    const onVertical = x >= centerX - halfW && x <= centerX + halfW;
    const onHorizontal = y >= centerY - halfH && y <= centerY + halfH;
    return onVertical && onHorizontal;
  }

  // ===== RIVER DRAWING =====

  /**
   * Draw a rectangle for river segments (kept for external callers / compat)
   */
  function drawRect(mapData, tileId, x, y, w, h, mapW, mapH) {
    const startX = Math.max(0, x);
    const endX = Math.min(mapW, x + w);
    const startY = Math.max(0, y);
    const endY = Math.min(mapH, y + h);

    for (let cy = startY; cy < endY; cy++) {
      for (let cx = startX; cx < endX; cx++) {
        const idx = cy * mapW + cx;
        mapData[idx] = tileId;
      }
    }
  }

  /**
   * Draw a single straight river segment along one axis with irregular banks.
   *
   * @param {boolean} isVertical - true = runs north/south, false = east/west
   * @param {boolean} openA - the "low" end connects onward (north for vertical,
   *                          west for horizontal); false = dead end
   * @param {boolean} openB - the "high" end connects onward (south / east)
   *
   * Open ends run to the map border and snap to a fixed, centred CONNECT width
   * there so neighbouring maps line up. Dead ends stop with a rounded head at
   * the centre of the map. When both ends are dead the segment becomes a small
   * central pool.
   */
  function drawStraightRiver(mapData, tileId, isVertical, openA, openB, width, height, seed, opts) {
    const along = isVertical ? height : width;
    const cross = isVertical ? width : height;
    const centerC = Math.floor(cross / 2);
    const centerL = Math.floor(along / 2);

    // Width fractions may be overridden (e.g. a narrower channel for a river
    // drawn as an OVERLAY inside a settlement or overland biome).
    const cf = (opts && opts.connectFraction) || CONNECT_FRACTION;
    const mf = (opts && opts.maxFraction) || MAX_FRACTION;

    const connectHalf = Math.max(3, Math.floor((cross * cf) / 2));
    const maxHalf = Math.max(connectHalf + 2, Math.floor((cross * mf) / 2));
    const span = maxHalf - connectHalf;
    const RAMP = Math.max(4, Math.floor(along * 0.12));
    const NSCALE = 0.30;
    const capR = maxHalf;

    // Head radius for a rounded dead end (kept short so the river ends near the
    // middle of the map rather than well past it).
    const headR = Math.max(4, Math.floor(along * 0.10));

    // Along-axis extent + which end(s) are rounded dead-end heads. A dead end
    // terminates with a rounded head whose tip lands on the map centre, so the
    // river visibly stops in the middle instead of running to the border.
    let lStart, lEnd, capA = false, capB = false;
    if (openA && openB) {
      lStart = 0; lEnd = along;
    } else if (openA && !openB) {
      lStart = 0; lEnd = centerL + 1; capB = true;
    } else if (!openA && openB) {
      lStart = centerL; lEnd = along; capA = true;
    } else {
      lStart = Math.max(0, centerL - headR); lEnd = Math.min(along, centerL + headR + 1);
      capA = true; capB = true;
    }

    for (let l = lStart; l < lEnd; l++) {
      // Independent irregular bank offset on each side of the centreline.
      const nNeg = smoothNoise(l * NSCALE, 11.5, seed + 101);
      const nPos = smoothNoise(l * NSCALE, 71.5, seed + 257);
      let hNeg = connectHalf + span * lerp(0.10, 1.0, nNeg);
      let hPos = connectHalf + span * lerp(0.10, 1.0, nPos);

      // Snap back toward the fixed centred width at open (connecting) borders.
      if (openA) {
        const d = l;
        if (d < RAMP) { const t = d / RAMP; hNeg = lerp(connectHalf, hNeg, t); hPos = lerp(connectHalf, hPos, t); }
      }
      if (openB) {
        const d = along - 1 - l;
        if (d < RAMP) { const t = d / RAMP; hNeg = lerp(connectHalf, hNeg, t); hPos = lerp(connectHalf, hPos, t); }
      }

      // Rounded dead-end head tapering to a point at the map centre.
      if (capB && l > centerL - headR) {
        const d = centerL - l; // headR..0 as we approach the tip
        const f = Math.sqrt(Math.max(0, 1 - Math.pow((headR - d) / headR, 2)));
        hNeg *= f; hPos *= f;
      }
      if (capA && l < centerL + headR) {
        const d = l - centerL; // headR..0 as we approach the tip
        const f = Math.sqrt(Math.max(0, 1 - Math.pow((headR - d) / headR, 2)));
        hNeg *= f; hPos *= f;
      }

      const negN = Math.round(hNeg);
      const posN = Math.round(hPos);
      for (let c = centerC - negN; c <= centerC + posN; c++) {
        if (c < 0 || c >= cross) continue;
        const x = isVertical ? c : l;
        const y = isVertical ? l : c;
        mapData[calculateIndex(x, y, 0, width, height)] = tileId;
      }
    }
  }

  /**
   * Draw a river of any direction/intersection type by composing straight
   * segments. `connections` (from the adjacent biomes) drives dead ends for
   * plain linear rivers; intersection arms are always open at their border end
   * and meet at the centre.
   */
  function drawRiverShape(mapData, tileId, direction, width, height, connections, seed) {
    const dir = (direction || "horizontal").toLowerCase();
    const conn = connections || { north: true, south: true, east: true, west: true };
    let norm = dir.replace("north", "up").replace("south", "down").replace("east", "right").replace("west", "left");

    const V = (a, b, s) => drawStraightRiver(mapData, tileId, true, a, b, width, height, seed + s);
    const H = (a, b, s) => drawStraightRiver(mapData, tileId, false, a, b, width, height, seed + s);

    if (dir === "cross" || dir.includes("cross")) {
      H(true, true, 2); V(true, true, 5);
      return;
    }

    if (dir.startsWith("t-")) {
      if (dir === "t-up" || dir === "t-north") { H(true, true, 2); V(true, false, 5); }
      else if (dir === "t-down" || dir === "t-south") { H(true, true, 2); V(false, true, 5); }
      else if (dir === "t-east" || dir === "t-right") { V(true, true, 5); H(false, true, 2); }
      else if (dir === "t-west" || dir === "t-left") { V(true, true, 5); H(true, false, 2); }
      else { H(true, true, 2); V(true, true, 5); }
      return;
    }

    if (norm.startsWith("corner-")) {
      if (norm === "corner-up-right" || norm === "corner-right-up") { V(true, false, 5); H(false, true, 2); }
      else if (norm === "corner-up-left" || norm === "corner-left-up") { V(true, false, 5); H(true, false, 2); }
      else if (norm === "corner-down-right" || norm === "corner-right-down") { V(false, true, 5); H(false, true, 2); }
      else if (norm === "corner-down-left" || norm === "corner-left-down") { V(false, true, 5); H(true, false, 2); }
      else { V(true, true, 5); H(true, true, 2); }
      return;
    }

    // Linear river: dead-end any side that does not connect onward to water.
    const isVertical = dir.includes("vertical") || dir === "up";
    if (isVertical) V(conn.north, conn.south, 5);
    else H(conn.west, conn.east, 2);
  }

  // Backwards-compatible thin wrappers around the new shape engine.
  function drawLinearRiver(mapData, tileId, direction, width, height) {
    drawRiverShape(mapData, tileId, direction, width, height, null, 0);
  }
  function drawCrossRiver(mapData, tileId, width, height) {
    drawRiverShape(mapData, tileId, "cross", width, height, null, 0);
  }
  function drawTRiver(mapData, tileId, direction, width, height) {
    drawRiverShape(mapData, tileId, direction, width, height, null, 0);
  }
  function drawCornerRiver(mapData, tileId, direction, width, height) {
    drawRiverShape(mapData, tileId, direction, width, height, null, 0);
  }

  // ===== RIVER DECORATION =====

  /**
   * Return the variant array for a named feature, or an empty array.
   */
  function featureVariants(allFeatures, name) {
    return allFeatures && Array.isArray(allFeatures[name]) ? allFeatures[name] : [];
  }

  /**
   * Place a feature variant (single tile or multi-tile grid) on the upper
   * overlay layer (layer 2). Unlike the generic feature placer this is allowed
   * to sit on top of water tiles, which is exactly what reeds/rocks/grass-water
   * need. Returns true when placed.
   */
  function placeWaterOverlay(mapData, variant, x, y, width, height) {
    const LAYER = 2;
    if (!variant) return false;

    if (variant.type === "single") {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      mapData[calculateIndex(x, y, LAYER, width, height)] = variant.tileId;
      return true;
    }

    if (variant.type === "grid") {
      const g = variant.grid;
      for (let gy = 0; gy < g.length; gy++) {
        for (let gx = 0; gx < g[gy].length; gx++) {
          const mx = x + gx, my = y + gy;
          if (mx < 0 || mx >= width || my < 0 || my >= height) return false;
        }
      }
      for (let gy = 0; gy < g.length; gy++) {
        for (let gx = 0; gx < g[gy].length; gx++) {
          mapData[calculateIndex(x + gx, y + gy, LAYER, width, height)] = g[gy][gx];
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Decorate a drawn river. Only Reed and WaterRock are ever placed on the
   * water; nothing else is allowed to sit on a river tile.
   *  - Reed patches on the water tiles that border the bank (in clusters).
   *  - Scattered WaterRock across the open water.
   * All decoration goes on the upper overlay layer; the water base is untouched
   * so passability / swim regions stay intact.
   */
  function decorateRiver(mapData, riverTileId, allFeatures, width, height, rng, seed) {
    const LAYER = 2;
    const isWater = (x, y) => {
      // Off-map counts as water so the connecting border crossings stay clean.
      if (x < 0 || x >= width || y < 0 || y >= height) return true;
      return mapData[calculateIndex(x, y, 0, width, height)] === riverTileId;
    };
    const layerBusy = (x, y) => mapData[calculateIndex(x, y, LAYER, width, height)] !== 0;

    const reeds = featureVariants(allFeatures, "Reed");  // i18n-ignore  feature id
    const rocks = featureVariants(allFeatures, "WaterRock");
    const grassWater = featureVariants(allFeatures, "GrassWater");

    // --- Reed patches along the banks ---
    if (reeds.length) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (mapData[calculateIndex(x, y, 0, width, height)] !== riverTileId) continue;

          const isBank =
            !isWater(x - 1, y) || !isWater(x + 1, y) ||
            !isWater(x, y - 1) || !isWater(x, y + 1);
          if (!isBank) continue;

          // Cluster the reeds into patches with low-frequency noise, then thin
          // them a little so the patches read as natural reed beds.
          const patch = smoothNoise(x * 0.22, y * 0.22, seed + 909);
          if (patch < 0.52) continue;
          if (rng() < 0.35) continue;

          // Anchor a tile up so the reed base sits in the border water tile.
          const anchorY = y > 0 ? y - 1 : y;
          if (layerBusy(x, anchorY)) continue;
          placeWaterOverlay(mapData, randomChoice(reeds, rng), x, anchorY, width, height);
        }
      }
    }

    // --- Scatter rocks + grass-water across the water ---
    const gridAllWater = (g, x, y) => {
      for (let gy = 0; gy < g.length; gy++) {
        for (let gx = 0; gx < g[gy].length; gx++) {
          if (!isWater(x + gx, y + gy)) return false;
        }
      }
      return true;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mapData[calculateIndex(x, y, 0, width, height)] !== riverTileId) continue;
        if (layerBusy(x, y)) continue;

        const r = rng();
        if (rocks.length && r < 0.012) {
          const v = randomChoice(rocks, rng);
          if (v.type === "grid" && !gridAllWater(v.grid, x, y)) continue;
          placeWaterOverlay(mapData, v, x, y, width, height);
        } else if (grassWater.length && r < 0.020) {
          placeWaterOverlay(mapData, randomChoice(grassWater, rng), x, y, width, height);
        }
      }
    }
  }

  /**
   * Generate procedural terrain for a river biome.
   * Draws the (wide, irregular, connection-aware) river onto the base layer,
   * then decorates it with reeds, rocks and grass-water.
   * Requires blendBiomeBorders from ProceduralMapBiomeGenerator to be called
   * separately by the caller.
   */
  function generateRiverBiome(
    mapData,
    biome,
    riverTileId,
    riverDirection,
    allFeatures,
    width = PROC_MAP_WIDTH,
    height = PROC_MAP_HEIGHT,
    adjacentBiomes = null,
    seed = 0,
    rng = null
  ) {
    const direction = riverDirection || "horizontal";
    const riverConfig = parseRiverConfig(biome.name);
    const baseSeed = seed >>> 0;
    const r = rng || createSeededRandom(baseSeed);
    const features = allFeatures || {};

    // Which facing directions connect onward to water (river / swamp / ocean).
    // Drives dead-end heads for auto-generated linear rivers.
    const connections = adjacentBiomes
      ? {
          north: isRiverConnectable(adjacentBiomes.north),
          south: isRiverConnectable(adjacentBiomes.south),
          east: isRiverConnectable(adjacentBiomes.east),
          west: isRiverConnectable(adjacentBiomes.west),
        }
      : null;

    if (riverConfig) {
      // Explicit <River:> config keeps its hand-authored full-length layout.
      drawRiverShape(mapData, riverTileId, riverConfig.direction, width, height, null, baseSeed);
    } else {
      drawRiverShape(mapData, riverTileId, direction, width, height, connections, baseSeed);
    }

    decorateRiver(mapData, riverTileId, features, width, height, r, baseSeed);
  }

  // ===== RIVER OVERLAY (river drawn INSIDE another biome) =====

  /**
   * Draw a river as an overlay on top of an already-generated biome map, instead
   * of replacing the whole map with a river biome. Used when the world map paints
   * a river tile on layer 2/3 over a real land biome (fields, forest, mountain,
   * city, village, burg, ...): the biome is generated normally and the river is
   * then carved through it.
   *
   * @param {Array}  mapData - the biome's generated tile array (mutated in place)
   * @param {number} tileId  - the water tile id to draw the river with (should be
   *                           the biome's own Water feature tile so decoration,
   *                           passability and prefab water-avoidance all match)
   * @param {Object} conn    - {north,south,east,west}: which sides the river runs
   *                           to the map border (a connecting neighbour). Sides
   *                           that do not connect become a rounded head that ends
   *                           at the centre of the map, so a river entering a
   *                           settlement stops in its middle. Multiple connected
   *                           sides simply draw multiple arms that meet/cross at
   *                           the centre.
   * @param {Object} allFeatures - feature table for reed/rock/grass-water decor
   * @param {Object} opts    - { connectFraction, maxFraction } channel width
   */
  function applyRiverOverlay(mapData, tileId, conn, allFeatures, width, height, seed, rng, opts) {
    if (!tileId) return;
    const c = conn || {};
    const anyConn = !!(c.north || c.south || c.east || c.west);
    const r = rng || createSeededRandom((seed >>> 0) || 1);
    const drawOpts = opts || {};

    // One vertical arm (north<->south) and/or one horizontal arm (east<->west).
    // Opposite connected sides merge into a straight through-river; a single
    // connected side dead-ends with a rounded head at the map centre.
    if (c.north || c.south) {
      drawStraightRiver(mapData, tileId, true, !!c.north, !!c.south, width, height, seed + 5, drawOpts);
    }
    if (c.east || c.west) {
      drawStraightRiver(mapData, tileId, false, !!c.west, !!c.east, width, height, seed + 2, drawOpts);
    }
    // Isolated river tile with no connecting neighbour: a small central pool.
    if (!anyConn) {
      drawStraightRiver(mapData, tileId, true, false, false, width, height, seed + 5, drawOpts);
    }

    // Mark every drawn water tile as region 99 so MovementInteractionSystem lets
    // the player swim/fish across it, matching the standalone river biome.
    let region = mapData.regiondata;
    if (!region || region.length !== width * height) {
      region = new Array(width * height).fill(0);
      mapData.regiondata = region;
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mapData[calculateIndex(x, y, 0, width, height)] === tileId) {
          region[y * width + x] = 99;
        }
      }
    }

    // Reeds / rocks / grass-water on the overlay layer (never touches the base).
    decorateRiver(mapData, tileId, allFeatures || {}, width, height, r, seed);
  }

  // ===== INTERSECTION TYPE DETECTION =====

  /**
   * Determine river intersection type based on adjacent biomes
   * Returns the appropriate river direction based on which adjacent biomes are rivers
   *
   * @param {Object} adjacentBiomes - Object with north, south, east, west biome names
   * @param {Function} isRiverBiomeFn - Function to check if biome is a river (default: isRiverBiome)
   * @returns {string} River direction type (horizontal, vertical, cross, t-north, corner-up-right, etc.)
   */
  function determineRiverIntersectionType(adjacentBiomes, isRiverBiomeFn = isRiverBiome) {
    if (!adjacentBiomes) {
      return "horizontal"; // Default fallback
    }

    // Check which directions have adjacent river biomes
    const hasNorth = adjacentBiomes.north && isRiverBiomeFn(adjacentBiomes.north);
    const hasSouth = adjacentBiomes.south && isRiverBiomeFn(adjacentBiomes.south);
    const hasEast = adjacentBiomes.east && isRiverBiomeFn(adjacentBiomes.east);
    const hasWest = adjacentBiomes.west && isRiverBiomeFn(adjacentBiomes.west);

    // Debug logging
    dlog(
      `[River Intersection] N:${hasNorth} S:${hasSouth} E:${hasEast} W:${hasWest}`
    );

    // Count adjacent rivers
    const riverCount = [hasNorth, hasSouth, hasEast, hasWest].filter(Boolean).length;

    // 4-way intersection (confluence)
    if (hasNorth && hasSouth && hasEast && hasWest) {
      return "cross";
    }

    // 3-way intersections (T-junctions)
    if (hasNorth && hasSouth && hasEast && !hasWest) {
      return "t-east";
    }
    if (hasNorth && hasSouth && hasWest && !hasEast) {
      return "t-west";
    }
    if (hasNorth && hasEast && hasWest && !hasSouth) {
      return "t-north";
    }
    if (hasSouth && hasEast && hasWest && !hasNorth) {
      return "t-south";
    }

    // 2-way intersections (corners)
    if (hasNorth && hasEast && !hasSouth && !hasWest) {
      return "corner-up-right";
    }
    if (hasNorth && hasWest && !hasSouth && !hasEast) {
      return "corner-up-left";
    }
    if (hasSouth && hasEast && !hasNorth && !hasWest) {
      return "corner-down-right";
    }
    if (hasSouth && hasWest && !hasNorth && !hasEast) {
      return "corner-down-left";
    }

    // Linear rivers (only 1 or 2 parallel connections)
    if ((hasNorth && hasSouth && !hasEast && !hasWest) ||
        (!hasNorth && !hasSouth && hasEast && hasWest)) {
      return hasNorth || hasSouth ? "vertical" : "horizontal";
    }

    // Single direction (dead-end river facing one direction)
    if (hasNorth && !hasSouth && !hasEast && !hasWest) {
      return "vertical";
    }
    if (hasSouth && !hasNorth && !hasEast && !hasWest) {
      return "vertical";
    }
    if (hasEast && !hasWest && !hasNorth && !hasSouth) {
      return "horizontal";
    }
    if (hasWest && !hasEast && !hasNorth && !hasSouth) {
      return "horizontal";
    }

    // Default fallback
    return "horizontal";
  }

  // ===== EXPORT FUNCTIONS =====

  window.ProcGenRivers = {
    isRiverBiome,
    isRiverConnectable,
    isRiverWorldTile,
    applyRiverOverlay,
    parseRiverConfig,
    getRiverDecorationTileId,
    isPositionOnRiverTile,
    drawRect,
    drawStraightRiver,
    drawRiverShape,
    drawLinearRiver,
    drawCrossRiver,
    drawTRiver,
    drawCornerRiver,
    decorateRiver,
    generateRiverBiome,
    determineRiverIntersectionType,
  };
})();
