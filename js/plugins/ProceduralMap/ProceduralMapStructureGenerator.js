/*:
 * @target MZ
 * @plugindesc Procedural dungeon biome generation using BSP algorithm
 * @author Omni-Lex
 *
 * @help
 * Procedural Map Dungeon Generator
 * =================================
 * Generates structured dungeon biomes using Binary Space Partition (BSP) algorithm
 * Creates interconnected rooms and corridors with multiple feature types:
 * - DungeonFloor (walkable areas)
 * - DungeonWall (impassable walls)
 * - Ceiling (decorative ceiling)
 *
 * ALGORITHM: Binary Space Partition (BSP)
 * =======================================
 * 1. Starts with entire map as single space
 * 2. Recursively splits space horizontally/vertically
 * 3. Creates rooms within each partition
 * 4. Connects rooms with corridors
 * 5. Results in structured, connected dungeon layouts
 *
 * FEATURES USED:
 * - DungeonFloor: Walkable floor tiles
 * - DungeonWall: Impassable wall tiles
 * - Ceiling: Overhead tiles/decoration
 *
 * Requires ProceduralMapUtils.js to be loaded first
 * Integrates with ProceduralMapBiomeGenerator.js for biome generation
 */

(() => {
  "use strict";

  const pluginName = "ProceduralMapStructureGenerator";

  // Set true to emit this generator's verbose per-generation diagnostics.
  const DEBUG = false;
  const dlog = (...a) => { if (DEBUG) console.log(...a); };

  // Import utilities from ProceduralMapUtils
  const Utils2 = window.ProcGenUtils;
  if (!Utils2) {
    console.error(
      "ProceduralMapStructureGenerator requires ProceduralMapUtils plugin"
    );
    return;
  }

  const {
    createSeededRandom,
    randomChoice,
    calculateIndex,
    generateDungeonWithBSP,
    PROC_MAP_WIDTH,
    PROC_MAP_HEIGHT,
  } = Utils2;

  // ===== DUNGEON FEATURE DETECTION =====

  /**
   * Determine which directions have water adjacent biomes
   * Returns object with north, south, east, west boolean flags
   */
  function getWaterDirections(adjacentBiomes) {
    if (!adjacentBiomes) {
      return { north: false, south: false, east: false, west: false };
    }

    const isWaterBiome = (biomeName) => {
      if (!biomeName) return false;
      const name = biomeName.toLowerCase();
      return name.includes("ocean") || name.includes("water") || name.includes("sea");
    };

    return {
      north: isWaterBiome(adjacentBiomes.north),
      south: isWaterBiome(adjacentBiomes.south),
      east: isWaterBiome(adjacentBiomes.east),
      west: isWaterBiome(adjacentBiomes.west)
    };
  }

  /**
   * Add full directional beach layout with water, sand, and seashells
   * where water biomes are adjacent
   */
  function addDirectionalBeach(mapData, width, height, adjacentBiomes, allFeatures, rng) {
    if (!adjacentBiomes) return;

    const waterDirs = getWaterDirections(adjacentBiomes);
    const beachTiles = getFeatureTiles("Beach", allFeatures);
    const waterTiles = getFeatureTiles("Water", allFeatures);
    const seashellTiles = getFeatureTiles("Seashell", allFeatures);

    if (!beachTiles || beachTiles.length === 0) return;

    const beachTile = beachTiles[0];
    const waterTile = waterTiles ? waterTiles[0] : beachTile;
    const maxEdgeDepth = 12; // Depth of water/beach gradient from edge
    const beachSandWidth = 4; // Width of sandy beach area

    // Helper to place seashells on a beach tile
    function placeSeashell(x, y) {
      if (seashellTiles && seashellTiles.length > 0 && rng() < 0.08) {
        const idx = calculateIndex(x, y, 1, width, height);
        if (idx >= 0 && idx < mapData.length) {
          mapData[idx] = seashellTiles[Math.floor(rng() * seashellTiles.length)];
        }
      }
    }

    // North edge (water from top, land below)
    if (waterDirs.north) {
      for (let x = 0; x < width; x++) {
        // Create natural variance in coastline depth
        const variance = Math.sin(x / 20) * 3 + Math.sin(x / 7) * 2;
        const coastlineDepth = Math.max(3, Math.floor(6 + variance));
        const actualDepth = Math.min(maxEdgeDepth, coastlineDepth);

        for (let y = 0; y < actualDepth; y++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if (y < actualDepth - beachSandWidth) {
            // Water area
            mapData[idx] = waterTile;
          } else {
            // Beach sand area
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }

    // South edge (water from bottom, land above)
    if (waterDirs.south) {
      for (let x = 0; x < width; x++) {
        const variance = Math.sin(x / 20 + 100) * 3 + Math.sin(x / 7 + 100) * 2;
        const coastlineDepth = Math.max(3, Math.floor(6 + variance));
        const actualDepth = Math.min(maxEdgeDepth, coastlineDepth);
        const startY = Math.max(0, height - actualDepth);

        for (let y = startY; y < height; y++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if (y > height - actualDepth + beachSandWidth) {
            // Water area
            mapData[idx] = waterTile;
          } else {
            // Beach sand area
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }

    // East edge (water from right, land left)
    if (waterDirs.east) {
      for (let y = 0; y < height; y++) {
        const variance = Math.sin(y / 20 + 200) * 3 + Math.sin(y / 7 + 200) * 2;
        const coastlineDepth = Math.max(3, Math.floor(6 + variance));
        const actualDepth = Math.min(maxEdgeDepth, coastlineDepth);
        const startX = Math.max(0, width - actualDepth);

        for (let x = startX; x < width; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if (x > width - actualDepth + beachSandWidth) {
            // Water area
            mapData[idx] = waterTile;
          } else {
            // Beach sand area
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }

    // West edge (water from left, land right)
    if (waterDirs.west) {
      for (let y = 0; y < height; y++) {
        const variance = Math.sin(y / 20 + 300) * 3 + Math.sin(y / 7 + 300) * 2;
        const coastlineDepth = Math.max(3, Math.floor(6 + variance));
        const actualDepth = Math.min(maxEdgeDepth, coastlineDepth);

        for (let x = 0; x < actualDepth; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if (x < actualDepth - beachSandWidth) {
            // Water area
            mapData[idx] = waterTile;
          } else {
            // Beach sand area
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }

    // Corners: blend where two water directions meet
    const hasNorth = waterDirs.north;
    const hasSouth = waterDirs.south;
    const hasEast = waterDirs.east;
    const hasWest = waterDirs.west;

    // Northeast corner
    if (hasNorth && hasEast) {
      const cornerSize = 8;
      for (let y = 0; y < cornerSize; y++) {
        const variance = Math.sin(y / 8) * 2;
        const depth = Math.max(2, Math.floor(4 + variance));
        const limit = Math.min(cornerSize, depth);
        for (let x = width - limit; x < width; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if (y + (width - x) < 3) {
            mapData[idx] = waterTile;
          } else {
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }

    // Northwest corner
    if (hasNorth && hasWest) {
      const cornerSize = 8;
      for (let y = 0; y < cornerSize; y++) {
        const variance = Math.sin(y / 8 + 50) * 2;
        const depth = Math.max(2, Math.floor(4 + variance));
        for (let x = 0; x < depth; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if (y + x < 3) {
            mapData[idx] = waterTile;
          } else {
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }

    // Southeast corner
    if (hasSouth && hasEast) {
      const cornerSize = 8;
      for (let y = height - cornerSize; y < height; y++) {
        const variance = Math.sin((height - y) / 8) * 2;
        const depth = Math.max(2, Math.floor(4 + variance));
        const limit = Math.min(cornerSize, depth);
        for (let x = width - limit; x < width; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if ((height - y) + (width - x) < 3) {
            mapData[idx] = waterTile;
          } else {
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }

    // Southwest corner
    if (hasSouth && hasWest) {
      const cornerSize = 8;
      for (let y = height - cornerSize; y < height; y++) {
        const variance = Math.sin((height - y) / 8 + 50) * 2;
        const depth = Math.max(2, Math.floor(4 + variance));
        for (let x = 0; x < depth; x++) {
          const idx = calculateIndex(x, y, 0, width, height);
          if ((height - y) + x < 3) {
            mapData[idx] = waterTile;
          } else {
            mapData[idx] = beachTile;
            placeSeashell(x, y);
          }
        }
      }
    }
  }

  /**
   * Check if biome is a dungeon-family biome (rendered by the enclosed
   * floor/Ceiling/wall generator): Dungeon / Crypt / Sewer plus the
   * structure biomes entered through terrain features (LootCellar via
   * StairsDown, TempleInside via StairsUp, CaveDen via Cave, PatronVault via
   * a patron's Hatch).
   */
  function isDungeonBiome(biomeName) {
    const n = biomeName.toLowerCase();
    return (
      n === "dungeon" || n.startsWith("dungeon") ||
      n === "crypt"   || n.startsWith("crypt")   ||
      n === "sewer"   || n.startsWith("sewer")   ||
      n === "lootcellar" || n === "templeinside" || n === "caveden" ||
      n === "patronvault"
    );
  }

  /**
   * Check if biome is a village biome
   */
  function isVillageBiome(biomeName) {
    return (
      biomeName.toLowerCase() === "village" ||
      biomeName.toLowerCase().startsWith("village")
    );
  }

  /**
   * Check if biome is a city biome
   */
  function isCityBiome(biomeName) {
    return (
      biomeName.toLowerCase() === "city" ||
      biomeName.toLowerCase().startsWith("city")
    );
  }

  function isBurgBiome(biomeName) {
    return (
      biomeName.toLowerCase() === "burg" ||
      biomeName.toLowerCase().startsWith("burg")
    );
  }

  // ===== DUNGEON FEATURE EXTRACTION =====

  /**
   * Get tiles for a specific feature from feature , ay
   * Extracts single-tile variants for features like DungeonFloor, DungeonWall, Ceiling
   */
  function getFeatureTiles(featureName, allFeatures) {
    const tiles = [];
    if (allFeatures[featureName] && allFeatures[featureName].length > 0) {
      for (const variant of allFeatures[featureName]) {
        if (variant.type === "single" && variant.tileId) {
          tiles.push(variant.tileId);
        }
      }
    }
    return tiles.length > 0 ? tiles : null;
  }

  /**
   * Get random tile from feature tiles
   */
  function getRandomFeatureTile(tiles, rng) {
    if (!tiles || tiles.length === 0) return 0;
    return tiles[Math.floor(rng() * tiles.length)];
  }

  /**
   * Place 3-tile wide sidewalks around roads
   * Scans for road tiles and places sidewalk tiles 1-3 tiles away from roads
   * IMPORTANT: Does not overwrite Path/PathDesert/PathIce tiles
   */function placeSidewalksAroundRoads(mapData, width, height, roadSet, sidewalkTiles, rng, pathTileIds, baseTile) {
    if (!sidewalkTiles || sidewalkTiles.length === 0) return;

    const sidewalkTile = sidewalkTiles[0];
    const placedSidewalks = new Set();
    const pathTileSet = new Set(pathTileIds || []);

    for (const roadKey of roadSet) {
      const [rx, ry] = roadKey.split(',').map(Number);

      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const sx = rx + dx;
          const sy = ry + dy;
          const sidewalkKey = `${sx},${sy}`;

          if (placedSidewalks.has(sidewalkKey) || roadSet.has(sidewalkKey)) continue;
          if (sx < 1 || sx >= width - 1 || sy < 1 || sy >= height - 1) continue;

          const dist = Math.max(Math.abs(dx), Math.abs(dy));

          if (dist >= 2 && dist <= 3) {
            const idx = calculateIndex(sx, sy, 0, width, height);
            const currentTile = mapData[idx];

            // 1. Never overwrite existing paths
            if (pathTileSet.has(currentTile)) continue;

            // 2. SAFETY CHECK: Only place sidewalk if the tile is Base Terrain or Empty.
            // If it is anything else (e.g., a prefab wall or floor), DO NOT TOUCH IT.
            // We treat 0 as valid to overwrite, and baseTile as valid.
            if (currentTile !== 0 && currentTile !== baseTile) continue;

            mapData[idx] = sidewalkTile;
            placedSidewalks.add(sidewalkKey);
          }
        }
      }
    }
  }

  // ===== DUNGEON GENERATION =====

  /**
   * True when the given tileId is walkable in the biome's tileset. Procedural
   * dungeons MUST enclose the walkable floor with impassable walls, because the
   * Ceiling filler tile is itself passable and may only ever sit behind a wall.
   */
  function isTilePassableInTileset(tilesetId, tileId) {
    const ts = $dataTilesets[tilesetId];
    if (!ts || !ts.flags) return true;
    const f = ts.flags[tileId] || 0;
    if (f & 0x10) return true;   // star (☆) overlay tile: no passage effect
    return (f & 0x0f) === 0;     // any blocked-direction bit set -> impassable
  }

  /**
   * Pick one random DungeonWall variant that is a 3-tall, 1-wide vertical strip.
   * Returns { top, mid, bot } tile ids, falling back to a single wall tile.
   */
  function pickWallColumn(allFeatures, rng) {
    const grids = (allFeatures["DungeonWall"] || []).filter(
      (v) => v.type === "grid" && v.grid && v.grid.length === 3 && v.grid.every((r) => r.length >= 1)
    );
    if (grids.length) {
      const g = grids[Math.floor(rng() * grids.length)].grid;
      return { top: g[0][0], mid: g[1][0], bot: g[2][0] };
    }
    const singles = getFeatureTiles("DungeonWall", allFeatures);
    const w = singles && singles.length ? singles[0] : 1536;
    return { top: w, mid: w, bot: w };
  }

  /**
   * Rewritten dungeon/crypt/sewer generator.
   *   - DungeonFloor  -> room / corridor pavement (only passable variants used)
   *   - Ceiling       -> the solid roof filling every non-room space and the area
   *                      above the wall faces
   *   - DungeonWall   -> a single random 3-tall vertical strip drawn on the walls,
   *                      plus a 1-tile impassable ring so the passable Ceiling can
   *                      never be walked onto
   *   - Biome features -> decorations placed pathing-safely: floor props on
   *                      fully-enclosed interior tiles, wall fixtures (torches,
   *                      chains, drains, ...) hung on the impassable wall faces.
   *                      Sewers always drip Drain fixtures from their walls.
   * Dungeon / Crypt / Sewer use different layouts, floor palettes and canals so
   * they read very differently. Always carves ONE entrance to the top border and
   * returns the interior spawn tile (mapData.spawnX/spawnY/spawnDir) plus the room
   * rectangles (mapData.rooms) so prefabs can be fitted inside rooms.
   */
  function generateDungeonBiome(biome, seed, allFeatures, adjacentBiomes, allOtherData = {}) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const rng = createSeededRandom(seed);
    const tilesetId = biome.tilesetId;
    const bname = ((biome && biome.name) || "").toLowerCase();
    const isCrypt = bname.startsWith("crypt");
    const isSewer = bname.startsWith("sewer");
    const isCellar = bname === "lootcellar";
    const isTemple = bname === "templeinside";
    const isCaveDen = bname === "caveden";
    // A patron's vault: the loot cellar's tiles and dressing on a far bigger
    // plan (PatreonRewards, entered through that patron's own Hatch).
    const isVault = bname === "patronvault";
    const MARGIN = 3;

    // --- Tiles --------------------------------------------------------------
    // Cave dens pave with a single (seeded) CaveFloor variant like real cave
    // biomes; everything else draws from the DungeonFloor palette.
    const floorFeature = isCaveDen ? "CaveFloor" : "DungeonFloor";
    const floorPool = (getFeatureTiles(floorFeature, allFeatures) || [2816])
      .filter((t) => isTilePassableInTileset(tilesetId, t));
    const floorAll = floorPool.length ? floorPool : [2816];
    // Partition the floor palette into thirds so each dungeon type looks distinct.
    const paletteOf = (part) => {
      if (floorAll.length <= 3) return floorAll;
      const size = Math.ceil(floorAll.length / 3);
      const slice = floorAll.slice(part * size, part * size + size);
      return slice.length ? slice : floorAll;
    };
    const floorTiles =
      isCaveDen ? [floorAll[Math.floor(rng() * floorAll.length)]]
      : isCrypt || isCellar || isVault ? paletteOf(1)
      : isSewer ? paletteOf(2)
      : paletteOf(0);

    const ceilingList = getFeatureTiles("Ceiling", allFeatures);
    const ceilingTile = ceilingList && ceilingList.length ? ceilingList[0] : floorTiles[0];
    // Cave dens use the (impassable) CaveWall tile as their wall face so they
    // read as natural rock instead of worked masonry.
    let wall;
    if (isCaveDen) {
      const caveWalls = getFeatureTiles("CaveWall", allFeatures);
      const cw = caveWalls && caveWalls.length ? caveWalls[0] : null;
      wall = cw ? { top: cw, mid: cw, bot: cw } : pickWallColumn(allFeatures, rng);
    } else {
      wall = pickWallColumn(allFeatures, rng);
    }
    const waterList = getFeatureTiles("Water", allFeatures);
    const waterTile = waterList && waterList.length ? waterList[0] : 0;

    // --- 1. Layout: carved[y][x] = walkable floor ---------------------------
    const carved = Array.from({ length: height }, () => new Array(width).fill(false));
    const rooms = [];
    const canalRows = [];
    const dungeonNarrowCorridors = [];

    const carveRect = (rx, ry, rw, rh) => {
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++)
          if (x >= 0 && x < width && y >= 0 && y < height) carved[y][x] = true;
    };
    const carveH = (x1, x2, y, thick = 1) => {
      const a = Math.min(x1, x2), b = Math.max(x1, x2);
      for (let x = a; x <= b; x++)
        for (let t = 0; t < thick; t++)
          if (y + t >= 0 && y + t < height && x >= 0 && x < width) carved[y + t][x] = true;
    };
    const carveV = (y1, y2, x, thick = 1) => {
      const a = Math.min(y1, y2), b = Math.max(y1, y2);
      for (let y = a; y <= b; y++)
        for (let t = 0; t < thick; t++)
          if (y >= 0 && y < height && x + t >= 0 && x + t < width) carved[y][x + t] = true;
    };

    if (isVault) {
      // Patron's vault: the loot cellar written large. One great hall filling
      // most of the map, with strongrooms hung off its west, east and north
      // faces and a deep back chamber behind it, every one of them joined to
      // the hall by a 3-wide spoke corridor drawn from the room's centre to the
      // hall's, so nothing can ever end up walled off from the rest.
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const hallW = 22 + Math.floor(rng() * 7);   // 22-28
      const hallH = 12 + Math.floor(rng() * 5);   // 12-16
      const hx = Math.max(MARGIN + 1, Math.floor((width - hallW) / 2));
      const hy = clamp(height - MARGIN - hallH - 4 - Math.floor(rng() * 4),
        MARGIN + 16, height - MARGIN - hallH - 1);
      carveRect(hx, hy, hallW, hallH);
      rooms.push({ x: hx, y: hy, width: hallW, height: hallH });
      const hcx = hx + (hallW >> 1), hcy = hy + (hallH >> 1);
      // An L-shaped 3-wide corridor between two interior points: it starts
      // inside one room and ends inside the other, so both are reachable.
      const spoke = (ax, ay, bx, by) => {
        const ty = clamp(ay, MARGIN, height - MARGIN - 3);
        carveH(ax, bx, ty, 3);
        carveV(ty, by, clamp(bx, MARGIN, width - MARGIN - 3), 3);
      };

      // Deep back chamber: the far end of the vault, straight behind the hall.
      const bw = 12 + Math.floor(rng() * 5);      // 12-16
      const bh = 8 + Math.floor(rng() * 4);       // 8-11
      const bx0 = clamp(hcx - (bw >> 1), MARGIN + 1, width - MARGIN - bw - 1);
      const by0 = clamp(hy - bh - 4 - Math.floor(rng() * 3), MARGIN + 1, hy - bh - 2);
      carveRect(bx0, by0, bw, bh);
      rooms.push({ x: bx0, y: by0, width: bw, height: bh });
      spoke(bx0 + (bw >> 1), by0 + (bh >> 1), hcx, hcy);

      // Strongrooms: two flanking the hall on each side, and two in the top
      // corners flanking the back chamber, taken in that rotation so a vault
      // with only six of them still comes out symmetric.
      const SIDES = ["W", "E", "NW", "NE"];
      const strongrooms = 6 + Math.floor(rng() * 3); // 6-8
      for (let i = 0; i < strongrooms; i++) {
        const side = SIDES[i % SIDES.length];
        const cw = 8 + Math.floor(rng() * 4);     // 8-11
        const ch = 6 + Math.floor(rng() * 4);     // 6-9
        const gap = 2 + Math.floor(rng() * 3);
        let cx0, cy0;
        if (side === "W" || side === "E") {
          cx0 = side === "W" ? hx - cw - gap : hx + hallW + gap;
          cy0 = hy - 3 + Math.floor(rng() * Math.max(1, hallH - ch + 6));
        } else {
          cx0 = side === "NW"
            ? MARGIN + 1 + Math.floor(rng() * 3)
            : width - MARGIN - cw - 1 - Math.floor(rng() * 3);
          cy0 = by0 - 1 + Math.floor(rng() * Math.max(1, bh - ch + 3));
        }
        cx0 = clamp(cx0, MARGIN + 1, width - MARGIN - cw - 1);
        cy0 = clamp(cy0, MARGIN + 1, height - MARGIN - ch - 1);
        carveRect(cx0, cy0, cw, ch);
        rooms.push({ x: cx0, y: cy0, width: cw, height: ch });
        spoke(cx0 + (cw >> 1), cy0 + (ch >> 1), hcx, hcy);
      }
    } else if (isCellar) {
      // Loot cellar: one small vaulted store-room (plus an occasional side
      // alcove) sitting just behind the stairs, near the south border so the
      // entrance corridor stays short.
      const rw = 9 + Math.floor(rng() * 8);   // 9-16
      const rh = 7 + Math.floor(rng() * 6);   // 7-12
      const rx = Math.max(MARGIN + 1, Math.floor((width - rw) / 2) + Math.floor(rng() * 7) - 3);
      const ry = Math.max(MARGIN + 1, height - MARGIN - rh - 2 - Math.floor(rng() * 4));
      carveRect(rx, ry, rw, rh);
      rooms.push({ x: rx, y: ry, width: rw, height: rh });
      if (rng() < 0.55) {
        const aw = 4 + Math.floor(rng() * 3), ah = 4 + Math.floor(rng() * 3);
        const left = rng() < 0.5;
        const ax = left ? rx - aw : rx + rw;
        const ay = ry + 1 + Math.floor(rng() * Math.max(1, rh - ah - 1));
        carveRect(ax, ay, aw, ah);
        rooms.push({ x: ax, y: ay, width: aw, height: ah });
      }
    } else if (isTemple) {
      // Temple: long connected halls in a complex, roughly symmetric plan - a
      // central nave capped by a wide sanctum, crossed by full-width transept
      // halls whose ends are linked by long flanking galleries, with side
      // chapels hanging off the galleries.
      const cx = Math.floor(width / 2);
      const naveW = 6 + Math.floor(rng() * 3);                    // 6-8 wide
      const naveTop = MARGIN + 8 + Math.floor(rng() * 6);
      const naveBot = height - MARGIN - 3;
      const nave = { x: cx - (naveW >> 1), y: naveTop, width: naveW, height: naveBot - naveTop };
      carveRect(nave.x, nave.y, nave.width, nave.height);
      rooms.push(nave);

      // Sanctum: a wide chamber capping the nave's north end (contiguous).
      const sw = naveW + 10 + Math.floor(rng() * 8);
      const sh = 8 + Math.floor(rng() * 5);
      const sy = Math.max(MARGIN + 1, naveTop - sh);
      const sanctum = { x: cx - (sw >> 1), y: sy, width: sw, height: naveTop - sy };
      if (sanctum.height > 0) { carveRect(sanctum.x, sanctum.y, sanctum.width, sanctum.height); rooms.push(sanctum); }

      // Transepts: 2-3 long horizontal halls crossing the nave, all spanning
      // the same width so the flanking galleries can tie their ends together.
      const tx1 = MARGIN + 4 + Math.floor(rng() * 5);
      const tx2 = width - MARGIN - 4 - Math.floor(rng() * 5);
      const nTransepts = 2 + Math.floor(rng() * 2);
      const transepts = [];
      for (let t = 0; t < nTransepts; t++) {
        const th = 4 + Math.floor(rng() * 3); // 4-6 tall
        const span = naveBot - naveTop - 10;
        const ty = naveTop + 3 + Math.floor((span * (t + 0.2 + rng() * 0.6)) / nTransepts);
        const hall = { x: tx1, y: ty, width: tx2 - tx1, height: th };
        carveRect(hall.x, hall.y, hall.width, hall.height);
        rooms.push(hall);
        transepts.push(hall);
      }

      // Flanking galleries: long vertical halls joining every transept end.
      if (transepts.length > 1) {
        const first = transepts[0], last = transepts[transepts.length - 1];
        const gw = 3 + Math.floor(rng() * 2);
        for (const gx of [tx1, tx2 - gw]) {
          const gal = { x: gx, y: first.y, width: gw, height: last.y + last.height - first.y };
          carveRect(gal.x, gal.y, gal.width, gal.height);
          rooms.push(gal);
        }
      }

      // Side chapels: rooms hung off the outer face of each gallery/transept
      // end, joined by a short 2-wide passage.
      const nChapels = 2 + Math.floor(rng() * 3);
      for (let c = 0; c < nChapels; c++) {
        const west = rng() < 0.5;
        const hall = transepts[Math.floor(rng() * transepts.length)];
        const cw = 6 + Math.floor(rng() * 5), chh = 5 + Math.floor(rng() * 4);
        const chx = west ? Math.max(MARGIN, tx1 - cw - 3) : Math.min(width - MARGIN - cw, tx2 + 3);
        const chy = Math.max(MARGIN + 1, Math.min(height - MARGIN - chh - 1,
          hall.y + Math.floor(rng() * 5) - 2));
        carveRect(chx, chy, cw, chh);
        rooms.push({ x: chx, y: chy, width: cw, height: chh });
        // Passage from the chapel to the transept edge it hangs off.
        const py = Math.max(hall.y, Math.min(hall.y + hall.height - 2, chy + (chh >> 1)));
        if (west) carveH(chx + cw - 1, tx1, py, 2);
        else carveH(tx2 - 1, chx, py, 2);
      }
    } else if (isCaveDen) {
      // Cave den: a single organic chamber carved with the shared cave
      // algorithms - anywhere from a cramped hollow to a cavern filling the
      // whole map - reduced to its largest connected pocket so it always reads
      // as one enclosed room.
      const innerW = width - MARGIN * 2, innerH = height - MARGIN * 2;
      const dw = Math.min(innerW, 16 + Math.floor(rng() * (innerW - 16 + 1)));
      const dh = Math.min(innerH, 12 + Math.floor(rng() * (innerH - 12 + 1)));
      const ox = MARGIN + Math.floor(rng() * (innerW - dw + 1));
      const oy = MARGIN + Math.max(0, innerH - dh - Math.floor(rng() * 8)); // hug the south side
      const FLOOR = 1, CEIL = 2;
      const sub = (rng() < 0.5)
        ? Utils2.generateCaveWithDrunkenWalk(dw, dh, dw, 0.45, seed ^ 0xdE11, FLOOR, CEIL)
        : Utils2.generateCaveWithCellularAutomata(dw, dh, dw, seed ^ 0xdE11, FLOOR, CEIL);
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++)
          if (sub[y * dw + x] === FLOOR) carved[oy + y][ox + x] = true;

      // Keep only the largest connected floor pocket ("single room" cave).
      const compOf = Array.from({ length: height }, () => new Array(width).fill(0));
      let bestComp = 0, bestSize = 0, compId = 0;
      for (let sy2 = 0; sy2 < height; sy2++) {
        for (let sx2 = 0; sx2 < width; sx2++) {
          if (!carved[sy2][sx2] || compOf[sy2][sx2]) continue;
          compId++;
          let size = 0;
          const stack = [[sx2, sy2]];
          compOf[sy2][sx2] = compId;
          while (stack.length) {
            const [px, py] = stack.pop();
            size++;
            for (const [dx2, dy2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = px + dx2, ny = py + dy2;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              if (!carved[ny][nx] || compOf[ny][nx]) continue;
              compOf[ny][nx] = compId;
              stack.push([nx, ny]);
            }
          }
          if (size > bestSize) { bestSize = size; bestComp = compId; }
        }
      }
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (carved[y][x] && compOf[y][x] !== bestComp) carved[y][x] = false;

      // Degenerate carve (tiny disconnected pockets): fall back to an ellipse.
      if (bestSize < 40) {
        const ecx = ox + (dw >> 1), ecy = oy + (dh >> 1);
        const erx = Math.max(5, dw >> 1), ery = Math.max(4, dh >> 1);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const nx = (x - ecx) / erx, ny = (y - ecy) / ery;
            carved[y][x] = nx * nx + ny * ny <= 1;
          }
      }
    } else if (isSewer) {
      // A grid of wide (3-tile) tunnels reading as a canal network.
      const pitch = 10;
      const colsX = [];
      for (let y = MARGIN + 4; y < height - MARGIN - 4; y += pitch) { carveH(MARGIN, width - MARGIN - 1, y, 3); canalRows.push(y + 1); }
      for (let x = MARGIN + 4; x < width - MARGIN - 4; x += pitch) { carveV(MARGIN, height - MARGIN - 1, x, 3); colsX.push(x); }
      for (const cy of canalRows) for (const cx of colsX) rooms.push({ x: cx - 1, y: cy - 1, width: 5, height: 5 });
    } else if (isCrypt) {
      // A regular grid of small tomb chambers joined by straight corridors.
      const pitch = 9, chamber = 5;
      const grid = [];
      for (let gy = MARGIN + 1; gy + chamber < height - MARGIN; gy += pitch) {
        const row = [];
        for (let gx = MARGIN + 1; gx + chamber < width - MARGIN; gx += pitch) {
          const r = { x: gx, y: gy, width: chamber, height: chamber };
          carveRect(r.x, r.y, r.width, r.height);
          rooms.push(r); row.push(r);
        }
        grid.push(row);
      }
      for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[i].length; j++) {
          const r = grid[i][j];
          const cx = r.x + (chamber >> 1), cy = r.y + (chamber >> 1);
          if (j + 1 < grid[i].length) carveH(cx, grid[i][j + 1].x + (chamber >> 1), cy);
          if (i + 1 < grid.length && grid[i + 1][j]) carveV(cy, grid[i + 1][j].y + (chamber >> 1), cx);
        }
      }
    } else {
      // Dungeon: BSP irregular rooms + winding corridors, varied room sizes,
      // rounded (chamfered) corners and variable corridor width.
      const bsp = Utils2.generateDungeonBSP(width, height, seed, 5, 19);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (bsp.carved[y][x]) carved[y][x] = true;
      if (bsp.rooms) rooms.push(...bsp.rooms);
      if (bsp.narrowCorridors) dungeonNarrowCorridors.push(...bsp.narrowCorridors);
    }

    // Solid border margin so the ONLY way off-map is the carved entrance.
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (x < MARGIN || x >= width - MARGIN || y < MARGIN || y >= height - MARGIN) carved[y][x] = false;

    // --- 2. Entrance: carve a corridor from a room down to the south border --
    let target = null, best = Infinity;
    const tcx = Math.floor(width / 2);
    for (let y = MARGIN; y < height - MARGIN; y++) {
      for (let x = MARGIN; x < width - MARGIN; x++) {
        if (!carved[y][x]) continue;
        // Prefer the carved tile nearest the south border, near the centre column.
        const dist = (height - 1 - y) * 2 + Math.abs(x - tcx);
        if (dist < best) { best = dist; target = { x, y }; }
      }
    }
    if (!target) {
      const rx = tcx - 3, ry = Math.floor(height / 2) - 3;
      carveRect(rx, ry, 6, 6); rooms.push({ x: rx, y: ry, width: 6, height: 6 });
      target = { x: tcx, y: ry };
    }
    const bx = Math.max(MARGIN, Math.min(width - MARGIN - 1, target.x));
    carveV(target.y, height - 1, bx);   // punch through the bottom margin into the room
    carveH(bx, target.x, target.y);     // step across to the room if offset
    const spawnX = bx, spawnY = height - 2, spawnDir = 8;
    const entranceX = bx, entranceY = height - 1;

    // --- 3. Render layer 0: floor / ceiling ---------------------------------
    const mapData = new Array(width * height * 4).fill(0);
    const rand = (arr) => arr[Math.floor(rng() * arr.length)];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        mapData[calculateIndex(x, y, 0, width, height)] = carved[y][x] ? rand(floorTiles) : ceilingTile;
      }
    }

    // --- 4. Walls: enclosing ring + 3-tall north faces ----------------------
    const isFloor = (x, y) => x >= 0 && x < width && y >= 0 && y < height && carved[y][x];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (carved[y][x]) continue;
        if (isFloor(x - 1, y) || isFloor(x + 1, y) || isFloor(x, y - 1) || isFloor(x, y + 1)) {
          mapData[calculateIndex(x, y, 0, width, height)] = wall.bot;
        }
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!carved[y][x] || isFloor(x, y - 1)) continue;
        const face = [[1, wall.bot], [2, wall.mid], [3, wall.top]];
        for (const [k, tile] of face) {
          const wy = y - k;
          if (wy < 0 || carved[wy][x]) break;
          mapData[calculateIndex(x, wy, 0, width, height)] = tile;
        }
      }
    }

    // --- 5. Region data + sewer canals --------------------------------------
    const regiondata = new Array(width * height).fill(0);
    if (isSewer && waterTile) {
      // Water down the centre row of each horizontal tunnel; the two flanking
      // rows stay walkable so the canals never block traversal.
      for (const cy of canalRows) {
        for (let x = MARGIN; x < width - MARGIN; x++) {
          if (isFloor(x, cy) && isFloor(x, cy - 1) && isFloor(x, cy + 1)) {
            mapData[calculateIndex(x, cy, 0, width, height)] = waterTile;
            regiondata[cy * width + x] = 99;
          }
        }
      }
    }

    // --- 6. Decoration: biome terrain features (layer 1) --------------------
    // Two placement styles, both pathing-safe:
    //   * Floor props (skulls, bones, graves, debris, ...) drop only onto tiles
    //     that are floor on all four sides, so an impassable prop can never seal
    //     a 1-wide corridor or the entrance.
    //   * Wall-mounted fixtures (torches, chains, drains, grates, ...) are hung
    //     on the impassable north wall faces that front a room, so they cannot
    //     affect pathing at all. Sewers always drip Drain fixtures here.
    // Grid (multi-tile) feature variants are supported too, so props like the
    // 2x2 Drain and the 2-tall Torch — which have no single-tile variant — are
    // actually placed instead of being silently skipped.
    const structural = new Set(["DungeonFloor", "DungeonWall", "Ceiling", "Water", "CaveFloor", "CaveWall", "MountainWall"]);
    const WALL_MOUNTED = new Set(["Torch", "Chain", "Drain", "Grate", "Banner", "Cobweb", "Sconce", "Lamp", "Pipe"]);

    const floorDecorPool = [];   // { variants, weight }
    const wallDecorPool = [];
    for (const f of biome.features || []) {
      const nm = typeof f === "string" ? f : f.name;
      if (structural.has(nm)) continue;
      const arr = allFeatures[nm];
      if (!Array.isArray(arr) || !arr.length) continue;
      const weight = (typeof f === "object" && Number(f.density) > 0) ? Number(f.density) : 1;
      (WALL_MOUNTED.has(nm) ? wallDecorPool : floorDecorPool).push({ variants: arr, weight });
    }
    // Sewers always sport wall Drains even when the biome definition omits them.
    if (isSewer) {
      const drainVariants = (allFeatures["Drain"] || []).filter((v) => v.tileId || (v.grid && v.grid.length));
      if (drainVariants.length && !wallDecorPool.some((p) => p.variants === allFeatures["Drain"])) {
        wallDecorPool.push({ variants: drainVariants, weight: 1.5 });
      }
    }

    const variantSize = (v) =>
      v.type === "grid"
        ? { w: Math.max(...v.grid.map((r) => r.length)), h: v.grid.length }
        : { w: 1, h: 1 };
    const pickWeighted = (pool) => {
      let total = 0;
      for (const p of pool) total += p.weight;
      let r = rng() * total;
      for (const p of pool) { r -= p.weight; if (r <= 0) return p; }
      return pool[pool.length - 1];
    };
    // Stamp a variant onto layer 2 with its top-left at (ox, oy). Callers below
    // validate the footprint first, so this only writes. Layer 2 (not 1) so the
    // decorations are seen by ProceduralTerrainInteractions' action-button scan
    // (it reads layers 3/2 only): dungeon skulls, cellar gold/wine, den bones
    // and wall torches are all interactable/harvestable.
    const stampFeature = (v, ox, oy) => {
      if (v.type === "single") {
        mapData[calculateIndex(ox, oy, 2, width, height)] = v.tileId;
        return;
      }
      for (let r = 0; r < v.grid.length; r++)
        for (let c = 0; c < v.grid[r].length; c++)
          if (v.grid[r][c] > 0)
            mapData[calculateIndex(ox + c, oy + r, 2, width, height)] = v.grid[r][c];
    };

    // Floor footprint must be all interior floor, dry, and layer-2 empty.
    const floorFits = (v, ox, oy) => {
      const { w, h } = variantSize(v);
      for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++) {
          const gx = ox + c, gy = oy + r;
          if (gx < 0 || gy < 0 || gx >= width || gy >= height) return false;
          if (!(isFloor(gx, gy) && isFloor(gx - 1, gy) && isFloor(gx + 1, gy) &&
                isFloor(gx, gy - 1) && isFloor(gx, gy + 1))) return false;
          if (mapData[calculateIndex(gx, gy, 0, width, height)] === waterTile) return false;
          if (mapData[calculateIndex(gx, gy, 2, width, height)] !== 0) return false;
        }
      return true;
    };
    // Wall footprint rests its bottom row on the wall face fronting a room and
    // climbs upward; every cell must be an unoccupied wall tile.
    const wallFits = (v, wx, wy) => {
      const { w, h } = variantSize(v);
      const top = wy - (h - 1);
      if (top < 0) return false;
      for (let c = 0; c < w; c++) {
        const bx = wx + c;
        if (bx < 0 || bx >= width) return false;
        if (carved[wy][bx] || !isFloor(bx, wy + 1)) return false; // must front floor
      }
      for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++) {
          const gx = wx + c, gy = top + r;
          if (gx < 0 || gx >= width || gy < 0 || gy >= height) return false;
          if (carved[gy][gx]) return false;
          if (mapData[calculateIndex(gx, gy, 2, width, height)] !== 0) return false;
        }
      return true;
    };

    if (floorDecorPool.length) {
      // Denser dressing for the structure biomes: a loot cellar is packed with
      // valuables, a patron's vault is buried in them, a cave den is littered
      // with bones; temples stay stately.
      const floorRate = isVault ? 0.3 : isCellar ? 0.18 : isCaveDen ? 0.12 : 0.05;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!carved[y][x] || rng() >= floorRate) continue;
          const feat = pickWeighted(floorDecorPool);
          const v = feat.variants[Math.floor(rng() * feat.variants.length)];
          if (floorFits(v, x, y)) stampFeature(v, x, y);
        }
      }
    }
    if (wallDecorPool.length) {
      const wallRate = isSewer ? 0.14 : isVault ? 0.14 : isCellar ? 0.12 : 0.1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (carved[y][x] || !isFloor(x, y + 1) || rng() >= wallRate) continue;
          const feat = pickWeighted(wallDecorPool);
          const v = feat.variants[Math.floor(rng() * feat.variants.length)];
          if (wallFits(v, x, y)) stampFeature(v, x, y - (variantSize(v).h - 1));
        }
      }
    }

    mapData.regiondata = regiondata;
    // Room rectangles + entrance metadata for the (room-aware) prefab pass and the
    // caller that positions the player. Prefabs are applied later by the prefab
    // load-hook using mapData.rooms so they are fitted inside rooms.
    mapData.rooms = rooms.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    mapData.spawnX = spawnX;
    mapData.spawnY = spawnY;
    mapData.spawnDir = spawnDir;
    mapData.entranceX = entranceX;
    mapData.entranceY = entranceY;

    // Door hints: the START of a 1-tile-wide corridor (BSP dungeon layout
    // only) - the tile where the passage leaves a room - still carved after
    // the border margin clip and far enough from the entrance, spaced apart so
    // up to 6 "Dungeon door" events never cluster.
    if (dungeonNarrowCorridors.length) {
      const shuffled = dungeonNarrowCorridors
        .filter((c) => isFloor(c.x, c.y) && Math.abs(c.x - entranceX) + Math.abs(c.y - entranceY) > 6)
        .sort(() => rng() - 0.5);
      const doorHints = [];
      for (const c of shuffled) {
        if (doorHints.length >= 6) break;
        if (doorHints.some((d) => Math.abs(d.x - c.x) + Math.abs(d.y - c.y) < 5)) continue;
        doorHints.push(c);
      }
      mapData.doorHints = doorHints;
    }

    // Boss room hint: the room whose center sits farthest from the entrance,
    // so a dungeon's toughest fixed encounter can be placed deep inside.
    if (rooms.length) {
      let bestRoom = null, bestDist = -1;
      for (const r of rooms) {
        const cx = r.x + Math.floor(r.width / 2), cy = r.y + Math.floor(r.height / 2);
        const dist = Math.abs(cx - entranceX) + Math.abs(cy - entranceY);
        if (dist > bestDist) { bestDist = dist; bestRoom = { x: cx, y: cy }; }
      }
      mapData.bossRoomHint = bestRoom;
    }

    return mapData;
  }

  // ===== VILLAGE GENERATION =====


/**
   * Generate procedural village biome with prefabs placed near path features first.
   * Includes Lot proximity checks to prevent overlapping hints.
   */
function generateVillageBiome(biome, seed, allFeatures, adjacentBiomes, allOtherData = {}) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const rng = createSeededRandom(seed);

    // 1. Initialize map with terrain
    const mapData = new Array(width * height * 4).fill(0);

    let baseTile = 0;
    if (biome && biome.features && biome.features.length > 0) {
      const terrainFeature = biome.features.find(f => f.terrain === true);
      if (terrainFeature && allFeatures[terrainFeature.name]) {
        const featureVariants = allFeatures[terrainFeature.name];
        for (const variant of featureVariants) {
          if (variant.type === "single") {
            baseTile = variant.tileId;
            break;
          }
        }
      }
    }

    for (let i = 0; i < width * height; i++) {
      mapData[i] = baseTile;
    }

    let pathFeatureName = "Path";
    if (biome.name === "VillageIce") pathFeatureName = "PathIce";
    else if (biome.name === "VillageDesert") pathFeatureName = "PathDesert";

    const pathTiles = getFeatureTiles(pathFeatureName, allFeatures);
    if (!pathTiles || pathTiles.length === 0) return mapData;
    const pathTile = pathTiles[0];

    const roadFeatureTiles = getFeatureTiles("Road", allFeatures);
    const cardinalRoadTile = roadFeatureTiles ? roadFeatureTiles[0] : pathTile;

    // --- STEP 0: Draw cardinal border roads ---
    const borderDirs = getCityBorderRoadDirections(adjacentBiomes);
    const hasCardinalRoads = borderDirs.north || borderDirs.south || borderDirs.east || borderDirs.west;
    const borderRoadOccupied = new Array(width * height).fill(false);

    if (hasCardinalRoads) {
      const dashedLineTiles = getFeatureTiles("DashedLine", allFeatures);
      const dashedLineTile = dashedLineTiles ? dashedLineTiles[0] : null;

      applyBorderRoadConnections(mapData, width, height, adjacentBiomes, cardinalRoadTile, dashedLineTile);

      // ... (Border road marking logic kept identical to previous version) ...
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);
      const borderRoadWidth = 7;
      const borderHalfRoad = Math.floor(borderRoadWidth / 2);
      if (borderDirs.north) { for (let y = 0; y <= centerY; y++) { for (let x = centerX - borderHalfRoad; x < centerX - borderHalfRoad + borderRoadWidth; x++) { if (x>=0 && x<width) borderRoadOccupied[y * width + x] = true; } } }
      if (borderDirs.south) { for (let y = centerY; y < height; y++) { for (let x = centerX - borderHalfRoad; x < centerX - borderHalfRoad + borderRoadWidth; x++) { if (x>=0 && x<width) borderRoadOccupied[y * width + x] = true; } } }
      if (borderDirs.east) { for (let x = centerX; x < width; x++) { for (let y = centerY - borderHalfRoad; y < centerY - borderHalfRoad + borderRoadWidth; y++) { if (y>=0 && y<height) borderRoadOccupied[y * width + x] = true; } } }
      if (borderDirs.west) { for (let x = 0; x <= centerX; x++) { for (let y = centerY - borderHalfRoad; y < centerY - borderHalfRoad + borderRoadWidth; y++) { if (y>=0 && y<height) borderRoadOccupied[y * width + x] = true; } } }
    }

    // --- STEP 1: Scatter path seeds ---
    const pathSeeds = [];
    const roadSet = new Set();
    if (hasCardinalRoads) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (borderRoadOccupied[y * width + x]) roadSet.add(`${x},${y}`);
        }
      }
    }

    const pathSeedCount = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < pathSeedCount; i++) {
      const x = 10 + Math.floor(rng() * (width - 20));
      const y = 10 + Math.floor(rng() * (height - 20));
      const idx = calculateIndex(x, y, 0, width, height);
      mapData[idx] = pathTile;
      pathSeeds.push({ x, y });
    }

    // --- STEP 2: Identify prefab placement locations ---
    // Lots have to be separated on BOTH axes, not in sum: the old Manhattan
    // test (< 14) happily accepted two lots 14 apart on one axis and 0 on the
    // other, and every prefab bigger than about 12 tiles centred on them then
    // overlapped its neighbour and was dropped by the collision guard. Village
    // prefabs run from 4x4 to 32x32, so villages ended up built out of nothing
    // but whatever was small enough to survive that. Chebyshev separation gives
    // the bigger ones room; the placement pass fits smaller prefabs into
    // whatever a lot has left (see generatePrefabPositions).
    const LOT_SEPARATION = 14;
    const prefabLots = [];
    for (const seed of pathSeeds) {
      const lotsPerSeed = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < lotsPerSeed; i++) {
        const distance = 10 + Math.floor(rng() * 13);
        const angle = rng() * Math.PI * 2;
        const lotX = Math.floor(seed.x + Math.cos(angle) * distance);
        const lotY = Math.floor(seed.y + Math.sin(angle) * distance);

        if (lotX >= 2 && lotX < width - 2 && lotY >= 2 && lotY < height - 2) {
           // Strict distance check to prevent hint overlap
           let isTooClose = false;
           for (const existingLot of prefabLots) {
             const dist = Math.max(Math.abs(existingLot.x - lotX), Math.abs(existingLot.y - lotY));
             if (dist < LOT_SEPARATION) { isTooClose = true; break; }
           }
           if (!isTooClose) prefabLots.push({ x: lotX, y: lotY, dist: 1 });
        }
      }
    }

    const validPrefabLots = prefabLots.filter(lot => {
      const checkRadius = 4;
      for (let dy = -checkRadius; dy <= checkRadius; dy++) {
        for (let dx = -checkRadius; dx <= checkRadius; dx++) {
          const checkX = lot.x + dx;
          const checkY = lot.y + dy;
          if (checkX >= 0 && checkX < width && checkY >= 0 && checkY < height) {
            if (borderRoadOccupied[checkY * width + checkX]) return false;
          }
        }
      }
      return true;
    });

    // --- STEP 3: Apply prefabs ---
    // Prefabs are placed NOW. Any code after this must respect the tiles they placed.
    allOtherData.placementHints = validPrefabLots;
    if (biome && biome.prefabs && biome.prefabs.length > 0) {
      const worldCoords = allOtherData?.worldCoords || { x: 0, y: 0 };
      if (window.ProceduralMapPrefabs && window.ProceduralMapPrefabs.applyPrefabsToMap) {
        try {
          window.ProceduralMapPrefabs.applyPrefabsToMap(mapData, biome.name, worldCoords, allOtherData);
        } catch (e) { console.warn(e); }
      }
    }

    // --- STEP 4: Draw connecting roads ---
    // Add existing paths to roadSet
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = calculateIndex(x, y, 0, width, height);
        if (mapData[idx] === pathTile && !borderRoadOccupied[y * width + x]) {
          roadSet.add(`${x},${y}`);
        }
      }
    }

    /**
     * UPDATED SETROAD: Checks if target tile is valid terrain before writing.
     * Prevents roads from cutting through Prefab walls/floors.
     */
    function setRoad(x, y) {
      if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) return;
      if (borderRoadOccupied[y * width + x]) return;
      
      const idx = calculateIndex(x, y, 0, width, height);
      const currentTile = mapData[idx];

      // PROTECTION CHECK:
      // If the tile is occupied by something that is NOT base terrain, 
      // NOT an existing path, and NOT empty (0), it is a Prefab. 
      // Do not overwrite it.
      if (currentTile !== baseTile && currentTile !== 0 && currentTile !== pathTile) {
          return; 
      }

      mapData[idx] = pathTile;
      roadSet.add(`${x},${y}`);
    }

    function drawBrush(cx, cy, radius = 1) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (Math.abs(x - cx) + Math.abs(y - cy) <= radius + 0.5) {
            setRoad(x, y);
          }
        }
      }
    }

    function drawOrganicPath(x1, y1, x2, y2, brushSize = 1) {
      let cx = x1, cy = y1;
      while (Math.abs(cx - x2) > 2 || Math.abs(cy - y2) > 2) {
        const dx = x2 - cx, dy = y2 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let vx = dx / dist, vy = dy / dist;
        if (rng() < 0.3) { vx += (rng() - 0.5) * 0.6; vy += (rng() - 0.5) * 0.6; }
        cx += vx; cy += vy;
        drawBrush(Math.floor(cx), Math.floor(cy), brushSize);
      }
      return { x: Math.floor(cx), y: Math.floor(cy) };
    }

    // Connect seeds
    for (let i = 0; i < pathSeeds.length - 1; i++) {
      drawOrganicPath(pathSeeds[i].x, pathSeeds[i].y, pathSeeds[i+1].x, pathSeeds[i+1].y, 1);
    }
    // Extra loops
    const extraConnections = Math.max(1, Math.floor(pathSeeds.length / 5));
    for (let i = 0; i < extraConnections; i++) {
      const idx1 = Math.floor(rng() * pathSeeds.length);
      const idx2 = Math.floor(rng() * pathSeeds.length);
      if (idx1 !== idx2) drawOrganicPath(pathSeeds[idx1].x, pathSeeds[idx1].y, pathSeeds[idx2].x, pathSeeds[idx2].y, 0);
    }
    // Connect lots
    for (const lot of validPrefabLots) {
      let nearestSeed = pathSeeds[0], minDist = Infinity;
      for (const seed of pathSeeds) {
        const dist = Math.sqrt((lot.x - seed.x) ** 2 + (lot.y - seed.y) ** 2);
        if (dist < minDist) { minDist = dist; nearestSeed = seed; }
      }
      if (minDist > 12 && minDist < 40) drawOrganicPath(lot.x, lot.y, nearestSeed.x, nearestSeed.y, 0);
    }

    // --- Sidewalks ---
    // UPDATED Call: Passes baseTile to ensure sidewalks don't overwrite prefabs
    const sidewalkTiles = getFeatureTiles(pathFeatureName, allFeatures);
    if (sidewalkTiles) {
      const tilesToProtect = [...pathTiles];
      if (hasCardinalRoads && cardinalRoadTile !== pathTile) tilesToProtect.push(cardinalRoadTile);
      // Pass baseTile as the last argument
      placeSidewalksAroundRoads(mapData, width, height, roadSet, sidewalkTiles, rng, tilesToProtect, baseTile);
    }

    addDirectionalBeach(mapData, width, height, adjacentBiomes, allFeatures, rng);
    
    // Region Data
    const regiondata = new Array(width * height).fill(0);
    let waterTileIds = new Set();
    ["Water", "Ocean", "Beach"].forEach(f => {
      if(allFeatures[f]) allFeatures[f].forEach(v => {if(v.type==='single') waterTileIds.add(v.tileId)});
    });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (waterTileIds.has(mapData[calculateIndex(x, y, 0, width, height)])) regiondata[y * width + x] = 99;
      }
    }
    mapData.regiondata = regiondata;

    return mapData;
  }

  // ===== CITY BORDER ROAD CONNECTIONS =====

  /**
   * Draw a single cardinal road from the center of a city/burg to its border
   * This road is drawn down the center to snap with drawHighwayExitIntersection roads
   * @param {Array} mapData - Map tile data
   * @param {number} centerX - Center X coordinate
   * @param {number} centerY - Center Y coordinate
   * @param {string} direction - Direction to draw ("north", "south", "east", "west")
   * @param {number} roadTile - Road tile ID
   * @param {number} dashedLineTile - Dashed line tile ID
   * @param {number} width - Map width
   * @param {number} height - Map height
   */
  function drawBorderConnectionRoad(mapData, centerX, centerY, direction, roadTile, dashedLineTile, width, height) {
    const roadWidth = 7;  // Single 7-tile wide road centered on border
    const halfRoad = Math.floor(roadWidth / 2);
    const DASH_LENGTH = 3;
    const DASH_GAP = 1;
    const DASH_CYCLE = DASH_LENGTH + DASH_GAP;

    if (direction === "north") {
      // Draw single vertical road from center upward to north edge
      const startX = centerX - halfRoad;
      const endX = startX + roadWidth;
      const centerLineX = centerX;

      for (let y = 0; y <= centerY; y++) {
        // Draw road
        for (let x = startX; x < endX; x++) {
          if (x >= 0 && x < width) {
            const idx = calculateIndex(x, y, 0, width, height);
            mapData[idx] = roadTile;
          }
        }
        // Draw dashed center line
        if (dashedLineTile) {
          const cyclePos = y % DASH_CYCLE;
          if (cyclePos < DASH_LENGTH) {
            const idx = calculateIndex(centerLineX, y, 1, width, height);
            mapData[idx] = dashedLineTile;
          }
        }
      }
    } else if (direction === "south") {
      // Draw single vertical road from center downward to south edge
      const startX = centerX - halfRoad;
      const endX = startX + roadWidth;
      const centerLineX = centerX;

      for (let y = centerY; y < height; y++) {
        // Draw road
        for (let x = startX; x < endX; x++) {
          if (x >= 0 && x < width) {
            const idx = calculateIndex(x, y, 0, width, height);
            mapData[idx] = roadTile;
          }
        }
        // Draw dashed center line
        if (dashedLineTile) {
          const cyclePos = (y - centerY) % DASH_CYCLE;
          if (cyclePos < DASH_LENGTH) {
            const idx = calculateIndex(centerLineX, y, 1, width, height);
            mapData[idx] = dashedLineTile;
          }
        }
      }
    } else if (direction === "east") {
      // Draw single horizontal road from center rightward to east edge
      const startY = centerY - halfRoad;
      const endY = startY + roadWidth;
      const centerLineY = centerY;

      for (let x = centerX; x < width; x++) {
        // Draw road
        for (let y = startY; y < endY; y++) {
          if (y >= 0 && y < height) {
            const idx = calculateIndex(x, y, 0, width, height);
            mapData[idx] = roadTile;
          }
        }
        // Draw dashed center line
        if (dashedLineTile) {
          const cyclePos = (x - centerX) % DASH_CYCLE;
          if (cyclePos < DASH_LENGTH) {
            const idx = calculateIndex(x, centerLineY, 1, width, height);
            mapData[idx] = dashedLineTile;
          }
        }
      }
    } else if (direction === "west") {
      // Draw single horizontal road from center leftward to west edge
      const startY = centerY - halfRoad;
      const endY = startY + roadWidth;
      const centerLineY = centerY;

      for (let x = 0; x <= centerX; x++) {
        // Draw road
        for (let y = startY; y < endY; y++) {
          if (y >= 0 && y < height) {
            const idx = calculateIndex(x, y, 0, width, height);
            mapData[idx] = roadTile;
          }
        }
        // Draw dashed center line
        if (dashedLineTile) {
          const cyclePos = (centerX - x) % DASH_CYCLE;
          if (cyclePos < DASH_LENGTH) {
            const idx = calculateIndex(x, centerLineY, 1, width, height);
            mapData[idx] = dashedLineTile;
          }
        }
      }
    }
  }

  /**
   * Determine which directions have adjacent city/burg/road/village biomes
   * Returns object with directions that should have connecting roads
   */
  function getCityBorderRoadDirections(adjacentBiomes) {
    if (!adjacentBiomes) {
      return { north: false, south: false, east: false, west: false };
    }

    const isConnectableBiome = (biomeName) => {
      if (!biomeName) return false;
      const name = biomeName.toLowerCase();
      return (
        name.includes("city") ||
        name.includes("burg") ||
        name.includes("road") ||
        name.includes("highway") ||
        name.includes("village")
      );
    };

    return {
      north: isConnectableBiome(adjacentBiomes.north),
      south: isConnectableBiome(adjacentBiomes.south),
      east: isConnectableBiome(adjacentBiomes.east),
      west: isConnectableBiome(adjacentBiomes.west)
    };
  }

  /**
   * Apply border road connections to city/burg map
   * Draws roads from center to edges where adjacent cities/burgs/roads exist
   * Uses dual road style with dashed center lines matching city streets
   */
  function applyBorderRoadConnections(mapData, width, height, adjacentBiomes, roadTile, dashedLineTile) {
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const borderDirs = getCityBorderRoadDirections(adjacentBiomes);

    if (borderDirs.north) {
      drawBorderConnectionRoad(mapData, centerX, centerY, "north", roadTile, dashedLineTile, width, height);
    }
    if (borderDirs.south) {
      drawBorderConnectionRoad(mapData, centerX, centerY, "south", roadTile, dashedLineTile, width, height);
    }
    if (borderDirs.east) {
      drawBorderConnectionRoad(mapData, centerX, centerY, "east", roadTile, dashedLineTile, width, height);
    }
    if (borderDirs.west) {
      drawBorderConnectionRoad(mapData, centerX, centerY, "west", roadTile, dashedLineTile, width, height);
    }

    dlog(
      `[BorderRoads] Applied connections - N:${borderDirs.north} S:${borderDirs.south} E:${borderDirs.east} W:${borderDirs.west}`
    );
  }

  /**
   * Generate internal roads sprouting from cardinal border roads
   * Creates secondary roads that branch from the main cardinal roads
   * @param {Array} mapData - Map tile data
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {Object} borderDirs - Border directions with boolean values (north, south, east, west)
   * @param {number} roadTile - Road tile ID
   * @param {number} dashedLineTile - Dashed line tile ID (for center lines)
   * @param {Array} occupiedMap - Occupied map tracking array
   * @param {Function} rng - Seeded random function
   */
  function generateInternalRoadsFromBorders(mapData, width, height, borderDirs, roadTile, dashedLineTile, occupiedMap, rng) {
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const roadWidth = 3;  // Thinner roads for internal branching
    const halfRoad = Math.floor(roadWidth / 2);
    const DASH_LENGTH = 3;
    const DASH_GAP = 1;
    const DASH_CYCLE = DASH_LENGTH + DASH_GAP;

    /**
     * Draw a single road tile and mark it as occupied
     */
    function setRoad(x, y) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const idx = calculateIndex(x, y, 0, width, height);
        mapData[idx] = roadTile;
        occupiedMap[y * width + x] = 1;
      }
    }

    /**
     * Draw an internal branching road from a cardinal road
     * Draws perpendicular roads from cardinal directions with some organic sway
     */
    function drawBranchingRoad(startX, startY, dirX, dirY, maxLength) {
      let x = startX;
      let y = startY;

      for (let step = 0; step < maxLength; step++) {
        // Draw road tile
        for (let dy = -halfRoad; dy <= halfRoad; dy++) {
          for (let dx = -halfRoad; dx <= halfRoad; dx++) {
            setRoad(Math.floor(x) + dx, Math.floor(y) + dy);
          }
        }

        // Draw dashed center line
        if (dashedLineTile && step % DASH_CYCLE < DASH_LENGTH) {
          const centerIdx = calculateIndex(Math.floor(x), Math.floor(y), 1, width, height);
          if (centerIdx >= 0 && centerIdx < mapData.length) {
            mapData[centerIdx] = dashedLineTile;
          }
        }

        // Move in direction with slight organic sway
        x += dirX;
        y += dirY;

        // Add occasional sway for organic look (20% chance)
        if (rng() < 0.2) {
          x += (rng() - 0.5) * 0.5;
          y += (rng() - 0.5) * 0.5;
        }
      }
    }

    // Generate branching roads from each cardinal direction
    // These branch perpendicular to the cardinal roads
    // Spaced far apart to leave room for prefabs

    if (borderDirs.north) {
      // North border road is vertical; create horizontal branches going east/west
      const branchCount = 1 + Math.floor(rng() * 2); // 1-2 branches
      for (let i = 0; i < branchCount; i++) {
        // Branches spawn at different Y positions, well-spaced from each other
        const branchY = Math.floor(centerY * 0.2 + (i + 0.5) * (centerY * 0.3));
        const maxBranchLen = Math.floor(centerX * 0.25); // Shorter branches

        // Branch east (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(centerX + 5, branchY, 1, 0, maxBranchLen);
        }
        // Branch west (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(centerX - 5, branchY, -1, 0, maxBranchLen);
        }
      }
    }

    if (borderDirs.south) {
      // South border road is vertical; create horizontal branches going east/west
      const branchCount = 1 + Math.floor(rng() * 2); // 1-2 branches
      for (let i = 0; i < branchCount; i++) {
        // Branches spawn at different Y positions, well-spaced from each other
        const branchY = Math.floor(centerY + centerY * 0.2 + (i + 0.5) * (centerY * 0.3));
        const maxBranchLen = Math.floor(centerX * 0.25); // Shorter branches

        // Branch east (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(centerX + 5, branchY, 1, 0, maxBranchLen);
        }
        // Branch west (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(centerX - 5, branchY, -1, 0, maxBranchLen);
        }
      }
    }

    if (borderDirs.east) {
      // East border road is horizontal; create vertical branches going north/south
      const branchCount = 1 + Math.floor(rng() * 2); // 1-2 branches
      for (let i = 0; i < branchCount; i++) {
        // Branches spawn at different X positions, well-spaced from each other
        const branchX = Math.floor(centerX + centerX * 0.2 + (i + 0.5) * (centerX * 0.3));
        const maxBranchLen = Math.floor(centerY * 0.25); // Shorter branches

        // Branch north (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(branchX, centerY - 5, 0, -1, maxBranchLen);
        }
        // Branch south (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(branchX, centerY + 5, 0, 1, maxBranchLen);
        }
      }
    }

    if (borderDirs.west) {
      // West border road is horizontal; create vertical branches going north/south
      const branchCount = 1 + Math.floor(rng() * 2); // 1-2 branches
      for (let i = 0; i < branchCount; i++) {
        // Branches spawn at different X positions, well-spaced from each other
        const branchX = Math.floor(centerX * 0.2 + (i + 0.5) * (centerX * 0.3));
        const maxBranchLen = Math.floor(centerY * 0.25); // Shorter branches

        // Branch north (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(branchX, centerY - 5, 0, -1, maxBranchLen);
        }
        // Branch south (70% chance)
        if (rng() < 0.7) {
          drawBranchingRoad(branchX, centerY + 5, 0, 1, maxBranchLen);
        }
      }
    }

    dlog("[InternalRoads] Internal branching roads generated from cardinal borders");
  }

  // ===== CITY GENERATION =====

  /**
   * Generate procedural city biome with grid-based roads matching RoadGenerator style.
   * Uses wider areas with fewer grid blocks.
   * Draws dual roads (7-tile wide with 3-tile separation) with dashed center lines.
   * Places prefabs in building lots within grid blocks.
   *//**
   * Generate procedural city biome with grid-based roads matching RoadGenerator style.
   * Uses wider areas with fewer grid blocks.
   * Draws dual roads (7-tile wide with 3-tile separation) with dashed center lines.
   * Places prefabs in building lots within grid blocks.
   */

  /**
   * Place RoadPole features at the concave corners of road intersections.
   *
   * A tile is an intersection corner when it borders a road on one vertical side
   * (N or S) AND one horizontal side (E or W) - which only happens where a
   * vertical road meets a horizontal one. Straight road edges border a road on a
   * single side, so they never qualify. Placement is non-destructive: occupied
   * (road/lot) cells are skipped and placeMultiTileFeature refuses any footprint
   * that is not fully empty, so roads, prefabs and building lots are preserved.
   *
   * Callbacks decouple this from each generator's own bookkeeping:
   *   isRoadAt(x,y)   - the tile carries a road
   *   isOccupied(x,y) - the tile is a road or a building lot (skip)
   *   markOccupied(x,y) - reserve a just-placed pole footprint
   * Returns the number of poles placed.
   */
  function placeRoadPolesAtIntersections(mapData, width, height, allFeatures, biome, seed, isRoadAt, isOccupied, markOccupied) {
    const variants = (allFeatures && allFeatures.RoadPole && allFeatures.RoadPole.length) ? allFeatures.RoadPole : null;
    if (!variants) return 0;
    const feat = Array.isArray(biome.features) && biome.features.find(f => f && f.name === "RoadPole");
    const density = feat && typeof feat.density === "number" ? feat.density : 0.6;
    const rng = createSeededRandom((seed ^ 0x504f4c45) >>> 0);   // vary by "POLE"
    const LAYER = 1;          // decorative upper-tile layer (poles sit above ground)
    const MIN_SPACING = 5;    // manhattan gap between placed poles

    // Base tiles a pole must never sit on, and water to avoid.
    const blockedBase = new Set([
      ...(getFeatureTiles("Road", allFeatures) || []),
      ...(getFeatureTiles("Path", allFeatures) || []),
      ...(getFeatureTiles("PathDesert", allFeatures) || []),
      ...(getFeatureTiles("PathIce", allFeatures) || []),
    ]);
    const waterSet = new Set();
    ["Water", "Ocean", "Beach"].forEach(n => (allFeatures[n] || []).forEach(v => { if (v.type === "single") waterSet.add(v.tileId); }));

    // Smallest footprint first so a pole fits even a tight margin.
    const ordered = variants.slice().sort((a, b) => (a.width * a.height) - (b.width * b.height));

    const footprintClear = (sx, sy, w, h) => {
      for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
        const ox = sx + gx, oy = sy + gy;
        if (ox < 0 || ox >= width || oy < 0 || oy >= height) return false;
        if (isOccupied(ox, oy)) return false;
      }
      return true;
    };

    const placed = [];
    let count = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (isOccupied(x, y) || isRoadAt(x, y)) continue;
        const roadN = isRoadAt(x, y - 1), roadS = isRoadAt(x, y + 1);
        const roadW = isRoadAt(x - 1, y), roadE = isRoadAt(x + 1, y);
        if (!((roadN || roadS) && (roadW || roadE))) continue;   // intersection corner only
        if (rng() > density) continue;
        if (placed.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) < MIN_SPACING)) continue;

        for (const v of ordered) {
          // Anchor the block into the open quadrant, away from both roads.
          const sy = roadN ? y : (roadS ? y - (v.height - 1) : y);
          const sx = roadW ? x : (roadE ? x - (v.width - 1) : x);
          if (!footprintClear(sx, sy, v.width, v.height)) continue;
          if (Utils2.placeMultiTileFeature(mapData, v.grid, sx, sy, LAYER, width, height, waterSet, blockedBase)) {
            for (let gy = 0; gy < v.grid.length; gy++) for (let gx = 0; gx < v.grid[gy].length; gx++) markOccupied(sx + gx, sy + gy);
            placed.push({ x, y });
            count++;
            break;
          }
        }
      }
    }
    if (count) dlog(`[RoadPole] placed ${count} pole(s) at intersections for ${biome.name}`);
    return count;
  }

  function generateCityBiome(biome, seed, allFeatures, adjacentBiomes, allOtherData = {}) {
    const width = PROC_MAP_WIDTH;
    const height = PROC_MAP_HEIGHT;
    const rng = createSeededRandom(seed);

    // 1. Initialize map with base terrain
    const mapData = new Array(width * height * 4).fill(0);

    // Get the terrain feature from the biome definition
    let baseTile = 0;
    if (biome && biome.features && biome.features.length > 0) {
      // Find the first terrain feature in the biome
      const terrainFeature = biome.features.find(f => f.terrain === true);
      if (terrainFeature && allFeatures[terrainFeature.name]) {
        // Get the first tile variant of this terrain feature
        const featureVariants = allFeatures[terrainFeature.name];
        for (const variant of featureVariants) {
          if (variant.type === "single") {
            baseTile = variant.tileId;
            break;
          }
        }
      }
    }

    // Fill entire map with base terrain
    for (let i = 0; i < width * height; i++) {
      mapData[i] = baseTile;
    }

    // Get Road Tiles
    const roadTiles = getFeatureTiles("Road", allFeatures);
    const dashedLineTiles = getFeatureTiles("DashedLine", allFeatures);
    if (!roadTiles || roadTiles.length === 0) return mapData;

    const roadTile = roadTiles[0];
    const dashedLineTile = dashedLineTiles ? dashedLineTiles[0] : roadTile;

    // --- Road Configuration (matching RoadGenerator style) ---
    const normalRoadWidth = 7;  // Matches ProceduralMapRoadGenerator
    const thinRoadWidth = 3;    // Thinner road variant
    const separation = 3;       // Separation between dual roads
    const DASH_LENGTH = 3;      // Dashes: 3 on, 1 off pattern
    const DASH_GAP = 1;
    const DASH_CYCLE = DASH_LENGTH + DASH_GAP;

    // Track occupied areas for building placement and border roads
    // DEFINED HERE
    const occupiedMap = new Array(width * height).fill(0); 
    const borderRoadOccupied = new Array(width * height).fill(false);
    const zoningBlocks = [];

    // --- STEP 0: Draw border roads FIRST, mark them as occupied ---
    applyBorderRoadConnections(mapData, width, height, adjacentBiomes, roadTile, dashedLineTile);

    // Mark all border road tiles as occupied to prevent grid roads from overlapping
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const borderDirs = getCityBorderRoadDirections(adjacentBiomes);
    const borderRoadWidth = 7; // Single road width
    const borderHalfRoad = Math.floor(borderRoadWidth / 2);

    // Mark border road tiles (single centered road only)
    if (borderDirs.north) {
      const startX = centerX - borderHalfRoad;
      const endX = startX + borderRoadWidth;
      for (let y = 0; y <= centerY; y++) {
        for (let x = startX; x < endX; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            borderRoadOccupied[y * width + x] = true;
            occupiedMap[y * width + x] = 1;
          }
        }
      }
    }
    if (borderDirs.south) {
      const startX = centerX - borderHalfRoad;
      const endX = startX + borderRoadWidth;
      for (let y = centerY; y < height; y++) {
        for (let x = startX; x < endX; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            borderRoadOccupied[y * width + x] = true;
            occupiedMap[y * width + x] = 1;
          }
        }
      }
    }
    if (borderDirs.east) {
      const startY = centerY - borderHalfRoad;
      const endY = startY + borderRoadWidth;
      for (let x = centerX; x < width; x++) {
        for (let y = startY; y < endY; y++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            borderRoadOccupied[y * width + x] = true;
            occupiedMap[y * width + x] = 1;
          }
        }
      }
    }
    if (borderDirs.west) {
      const startY = centerY - borderHalfRoad;
      const endY = startY + borderRoadWidth;
      for (let x = 0; x <= centerX; x++) {
        for (let y = startY; y < endY; y++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            borderRoadOccupied[y * width + x] = true;
            occupiedMap[y * width + x] = 1;
          }
        }
      }
    }

    dlog("[CityGenerator] Border roads marked as occupied");

    // --- STEP 0.5: Generate internal roads sprouting from border roads ---
    generateInternalRoadsFromBorders(mapData, width, height, borderDirs, roadTile, dashedLineTile, occupiedMap, rng);

    // --- Road Configuration (matching RoadGenerator style) ---
    // Fewer, larger blocks (50-66 tiles for less density)
    const minBlockSize = 80;
    const maxBlockSize = 90;
    const maxRoadWidth = normalRoadWidth; // Use max width for block calculations to ensure proper spacing

    // --- Step A: Grid-based road layout with wider blocks, avoiding border roads ---

    const border = 12;  // Increased border spacing to keep grid away from edges
    let blockQueue = [{ x: border, y: border, w: width - border*2, h: height - border*2 }];
    const roadsToDraw = [];

    while (blockQueue.length > 0) {
      const block = blockQueue.shift();

      // Check if block overlaps with border roads - skip if it does
      let overlapsBorderRoad = false;
      for (let y = block.y; y < block.y + block.h && !overlapsBorderRoad; y++) {
        for (let x = block.x; x < block.x + block.w && !overlapsBorderRoad; x++) {
          if (borderRoadOccupied[y * width + x]) {
            overlapsBorderRoad = true;
          }
        }
      }

      if (overlapsBorderRoad) {
        continue;
      }

      let splitVert = false;
      let splitHorz = false;

      // Force split if too big
      if (block.w > maxBlockSize) splitVert = true;
      if (block.h > maxBlockSize) splitHorz = true;

      // Random split if big enough
      if (!splitVert && !splitHorz) {
        if (block.w > minBlockSize * 2 && block.h > minBlockSize * 2) {
          if (rng() < 0.5) splitVert = true; else splitHorz = true;
        } else if (block.w > minBlockSize * 2) splitVert = true;
        else if (block.h > minBlockSize * 2) splitHorz = true;
      }

      if (splitVert) {
        const splitRange = block.w - (minBlockSize * 2) - maxRoadWidth;
        const splitOffset = Math.floor(rng() * splitRange);
        const splitX = block.x + minBlockSize + splitOffset;

        // Check if vertical road would overlap border road
        let roadOverlapsBorder = false;
        for (let y = block.y; y < block.y + block.h; y++) {
          for (let x = splitX; x < splitX + maxRoadWidth; x++) {
            if (borderRoadOccupied[y * width + x]) {
              roadOverlapsBorder = true;
              break;
            }
          }
          if (roadOverlapsBorder) break;
        }

        if (!roadOverlapsBorder) {
          roadsToDraw.push({ x: splitX, y: block.y, len: block.h, type: 'vert' });
          blockQueue.push({ x: block.x, y: block.y, w: splitX - block.x, h: block.h });
          blockQueue.push({ x: splitX + maxRoadWidth, y: block.y, w: (block.x + block.w) - (splitX + maxRoadWidth), h: block.h });
        } else {
          zoningBlocks.push(block);
        }
      } else if (splitHorz) {
        const splitRange = block.h - (minBlockSize * 2) - maxRoadWidth;
        const splitOffset = Math.floor(rng() * splitRange);
        const splitY = block.y + minBlockSize + splitOffset;

        // Check if horizontal road would overlap border road
        let roadOverlapsBorder = false;
        for (let x = block.x; x < block.x + block.w; x++) {
          for (let y = splitY; y < splitY + maxRoadWidth; y++) {
            if (borderRoadOccupied[y * width + x]) {
              roadOverlapsBorder = true;
              break;
            }
          }
          if (roadOverlapsBorder) break;
        }

        if (!roadOverlapsBorder) {
          roadsToDraw.push({ x: block.x, y: splitY, len: block.w, type: 'horz' });
          blockQueue.push({ x: block.x, y: block.y, w: block.w, h: splitY - block.y });
          blockQueue.push({ x: block.x, y: splitY + maxRoadWidth, w: block.w, h: (block.y + block.h) - (splitY + maxRoadWidth) });
        } else {
          zoningBlocks.push(block);
        }
      } else {
        zoningBlocks.push(block);
      }
    }

    // --- Step B: Draw dual roads with dashed center lines (RoadGenerator style) ---

    function markOccupied(mx, my) {
      if (mx >= 0 && mx < width && my >= 0 && my < height) {
        occupiedMap[my * width + mx] = 1;
      }
    }

    function drawRoadRect(rx, ry, rw, rh) {
      for (let y = ry; y < ry + rh && y < height; y++) {
        for (let x = rx; x < rx + rw && x < width; x++) {
          if (x >= 0 && y >= 0) {
            const idx = calculateIndex(x, y, 0, width, height);
            mapData[idx] = roadTile;
            markOccupied(x, y);
          }
        }
      }
    }

    function drawDualVerticalRoads(rx, startY, len) {
      const roadWidth = rng() < 0.7 ? normalRoadWidth : thinRoadWidth;
      const halfRoad = Math.floor(roadWidth / 2);
      const leftRoadX = rx - halfRoad - roadWidth - separation;
      const rightRoadX = rx + halfRoad + separation;

      // Left and right roads
      drawRoadRect(leftRoadX, startY, roadWidth, len);
      drawRoadRect(rightRoadX, startY, roadWidth, len);

      // Dashed center lines
      const leftCenterX = leftRoadX + halfRoad;
      const rightCenterX = rightRoadX + halfRoad;
      for (let y = startY; y < startY + len && y < height; y++) {
        const cyclePos = y % DASH_CYCLE;
        if (cyclePos < DASH_LENGTH) {
          const idx1 = calculateIndex(leftCenterX, y, 1, width, height);
          const idx2 = calculateIndex(rightCenterX, y, 1, width, height);
          mapData[idx1] = dashedLineTile;
          mapData[idx2] = dashedLineTile;
        }
      }
    }

    function drawDualHorizontalRoads(startX, ry, len) {
      const roadWidth = rng() < 0.7 ? normalRoadWidth : thinRoadWidth;
      const halfRoad = Math.floor(roadWidth / 2);
      const topRoadY = ry - halfRoad - roadWidth - separation;
      const bottomRoadY = ry + halfRoad + separation;

      // Top and bottom roads
      drawRoadRect(startX, topRoadY, len, roadWidth);
      drawRoadRect(startX, bottomRoadY, len, roadWidth);

      // Dashed center lines
      const topCenterY = topRoadY + halfRoad;
      const bottomCenterY = bottomRoadY + halfRoad;
      for (let x = startX; x < startX + len && x < width; x++) {
        const cyclePos = x % DASH_CYCLE;
        if (cyclePos < DASH_LENGTH) {
          const idx1 = calculateIndex(x, topCenterY, 1, width, height);
          const idx2 = calculateIndex(x, bottomCenterY, 1, width, height);
          mapData[idx1] = dashedLineTile;
          mapData[idx2] = dashedLineTile;
        }
      }
    }

    // Draw internal roads (grid roads that don't overlap border roads)
    for (const r of roadsToDraw) {
      if (r.type === 'vert') {
        drawDualVerticalRoads(r.x, r.y, r.len);
      } else {
        drawDualHorizontalRoads(r.x, r.y, r.len);
      }
    }

    // --- Step C: Building lot placement - ONE prefab per grid tile ---
    const buildingLots = [];

    function hasRoadCollision(x, y, w, h) {
      // Check the lot plus a 1-tile margin so building lots never sit flush
      // against a road or another building: this leaves room for sidewalks and
      // stops prefabs from visually merging into roads/neighbours. Any occupied
      // cell (road = 1, building = 2) counts as a collision.
      for (let py = y - 1; py <= y + h; py++) {
        for (let px = x - 1; px <= x + w; px++) {
          const inCore = px >= x && px < x + w && py >= y && py < y + h;
          if (px < 0 || px >= width || py < 0 || py >= height) {
            if (inCore) return true; // the lot itself must stay on-map
            continue;                // off-map margin is fine
          }
          if (occupiedMap[py * width + px] !== 0) return true;
        }
      }
      return false;
    }

    function findLargestSquareInBlock(block) {
      const maxSize = Math.min(block.w, block.h);
      for (let size = maxSize; size >= 3; size--) {
        const centerX = Math.floor(block.x + block.w / 2);
        const centerY = Math.floor(block.y + block.h / 2);

        let x = centerX - Math.floor(size / 2);
        let y = centerY - Math.floor(size / 2);

        x = Math.max(block.x, Math.min(x, block.x + block.w - size));
        y = Math.max(block.y, Math.min(y, block.y + block.h - size));

        if (!hasRoadCollision(x, y, size, size)) {
          return { x, y, size };
        }

        const positions = [
          { x: block.x + 1, y: block.y + 1 },
          { x: block.x + block.w - size - 1, y: block.y + 1 },
          { x: block.x + 1, y: block.y + block.h - size - 1 },
          { x: block.x + block.w - size - 1, y: block.y + block.h - size - 1 }
        ];

        for (const pos of positions) {
          const px = Math.max(block.x, Math.min(pos.x, block.x + block.w - size));
          const py = Math.max(block.y, Math.min(pos.y, block.y + block.h - size));
          if (!hasRoadCollision(px, py, size, size)) {
            return { x: px, y: py, size };
          }
        }
      }
      return null;
    }

    for (const block of zoningBlocks) {
      const placement = findLargestSquareInBlock(block);

      if (placement) {
        buildingLots.push({
          x: placement.x,
          y: placement.y,
          w: placement.size,
          h: placement.size
        });

        // Mark as occupied so no future placements overlap
        for (let py = placement.y; py < placement.y + placement.size; py++) {
          for (let px = placement.x; px < placement.x + placement.size; px++) {
            if (px >= 0 && px < width && py >= 0 && py < height) {
              occupiedMap[py * width + px] = 2; // Building
            }
          }
        }
      }
    }

    // --- Step D: Prefab Application - one prefab per lot ---
    if (biome && biome.prefabs && biome.prefabs.length > 0) {
      const worldCoords = allOtherData?.worldCoords || { x: 0, y: 0 };
      allOtherData.blockHints = buildingLots;
      allOtherData.singlePrefabPerBlock = true;
      allOtherData.strictNoRoadOverlap = true;

      if (window.ProceduralMapPrefabs && window.ProceduralMapPrefabs.applyPrefabsToMap) {
        try {
          window.ProceduralMapPrefabs.applyPrefabsToMap(mapData, biome.name, worldCoords, allOtherData);
        } catch (e) { console.warn(`[CityGenerator] Error: ${e.message}`); }
      }
    }

    // --- Step B.5: Place sidewalks around roads (AFTER Prefabs to avoid overwrite) ---
    // UPDATED: Now includes checks to ensure it DOES NOT overwrite Prefabs (baseTile check)
    const sidewalkTiles = getFeatureTiles("Sidewalk", allFeatures);
    if (sidewalkTiles) {
      const sidewalkTile = sidewalkTiles[0];
      const roadTileIds = getFeatureTiles("Road", allFeatures) || [];
      const pathTileSet = new Set(roadTileIds);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          
          // Only look for roads
          if (occupiedMap[y * width + x] === 1) {
            
            // Place sidewalks in cardinal and diagonal directions
            for (let dy = -3; dy <= 3; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                const sx = x + dx;
                const sy = y + dy;

                if (sx < 1 || sx >= width - 1 || sy < 1 || sy >= height - 1) continue;
                if (occupiedMap[sy * width + sx] === 1) continue; // Skip if it's already a road

                const dist = Math.max(Math.abs(dx), Math.abs(dy));

                if (dist >= 2 && dist <= 3) {
                  const sidx = calculateIndex(sx, sy, 0, width, height);
                  const currentTile = mapData[sidx];

                  // 1. Never overwrite road/path tiles
                  if (pathTileSet.has(currentTile)) continue;

                  // 2. CRITICAL FIX: Never overwrite Prefab tiles
                  // If the tile is NOT base terrain and NOT empty (0), assume it is a Prefab.
                  if (currentTile !== baseTile && currentTile !== 0) continue;

                  // 3. Ensure we aren't writing over a building slot (even if empty)
                  if (occupiedMap[sy * width + sx] !== 0) continue;

                  mapData[sidx] = sidewalkTile;
                }
              }
            }
          }
        }
      }
      dlog("[CityGenerator] Sidewalks placed safely.");
    }

    // --- Step E.1: Directional Beach Generation ---
    addDirectionalBeach(mapData, width, height, adjacentBiomes, allFeatures, rng);

    // --- Step E.2: RoadPole markers at road intersection corners ---
    placeRoadPolesAtIntersections(
      mapData, width, height, allFeatures, biome, seed,
      (x, y) => roadTiles.includes(mapData[calculateIndex(x, y, 0, width, height)]),
      (x, y) => occupiedMap[y * width + x] !== 0,
      (x, y) => { occupiedMap[y * width + x] = 3; }
    );

    // --- Step E: Water/Region Data ---
    const regiondata = new Array(width * height).fill(0);
    let waterTileIds = new Set();
    ["Water", "Ocean", "Beach"].forEach(f => {
      if (allFeatures[f]) allFeatures[f].forEach(v => { if(v.type==='single') waterTileIds.add(v.tileId); });
    });

    for (let i = 0; i < width * height; i++) {
      if (waterTileIds.has(mapData[i])) regiondata[i] = 99;
    }
    mapData.regiondata = regiondata;

    return mapData;
  }


/* Reworked generateBurgBiome for Circular European-style City */

function generateBurgBiome(biome, seed, allFeatures, adjacentBiomes, allOtherData = {}) {
  const width = PROC_MAP_WIDTH;
  const height = PROC_MAP_HEIGHT;
  const rng = createSeededRandom(seed);

  // 1. Initialize map with base terrain
  const mapData = new Array(width * height * 4).fill(0);

  // Get the terrain feature from the biome definition
  let baseTile = 0;
  if (biome && biome.features && biome.features.length > 0) {
    // Find the first terrain feature in the biome
    const terrainFeature = biome.features.find(f => f.terrain === true);
    if (terrainFeature && allFeatures[terrainFeature.name]) {
      // Get the first tile variant of this terrain feature
      const featureVariants = allFeatures[terrainFeature.name];
      for (const variant of featureVariants) {
        if (variant.type === "single") {
          baseTile = variant.tileId;
          break;
        }
      }
    }
  }

  // Fill entire map with base terrain
  for (let i = 0; i < width * height; i++) {
    mapData[i] = baseTile;
  }

  // Get Road Tiles
  const roadTiles = getFeatureTiles("Road", allFeatures);
  const dashedLineTiles = getFeatureTiles("DashedLine", allFeatures);
  if (!roadTiles || roadTiles.length === 0) return mapData;
  const roadTile = roadTiles[0];
  const dashedLineTile = dashedLineTiles ? dashedLineTiles[0] : null;

  // --- STEP 0: Draw border roads FIRST, mark them as occupied ---
  applyBorderRoadConnections(mapData, width, height, adjacentBiomes, roadTile, dashedLineTile);

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const borderRoadOccupied = new Array(width * height).fill(false);
  const borderRoadWidth = 7;  // Single road width
  const borderHalfRoad = Math.floor(borderRoadWidth / 2);
  const borderDirs = getCityBorderRoadDirections(adjacentBiomes);

  // Mark border road tiles as occupied (single centered road only)
  if (borderDirs.north) {
    const startX = centerX - borderHalfRoad;
    const endX = startX + borderRoadWidth;
    for (let y = 0; y <= centerY; y++) {
      for (let x = startX; x < endX; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          borderRoadOccupied[y * width + x] = true;
        }
      }
    }
  }
  if (borderDirs.south) {
    const startX = centerX - borderHalfRoad;
    const endX = startX + borderRoadWidth;
    for (let y = centerY; y < height; y++) {
      for (let x = startX; x < endX; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          borderRoadOccupied[y * width + x] = true;
        }
      }
    }
  }
  if (borderDirs.east) {
    const startY = centerY - borderHalfRoad;
    const endY = startY + borderRoadWidth;
    for (let x = centerX; x < width; x++) {
      for (let y = startY; y < endY; y++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          borderRoadOccupied[y * width + x] = true;
        }
      }
    }
  }
  if (borderDirs.west) {
    const startY = centerY - borderHalfRoad;
    const endY = startY + borderRoadWidth;
    for (let x = 0; x <= centerX; x++) {
      for (let y = startY; y < endY; y++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          borderRoadOccupied[y * width + x] = true;
        }
      }
    }
  }

  dlog("[BurgGenerator] Border roads marked as occupied");

  // --- Generate internal roads sprouting from border roads ---
  const occupiedMapBurg = new Array(width * height).fill(0);
  // Mark border roads in occupied map
  if (borderDirs.north) {
    const startX = centerX - borderHalfRoad;
    const endX = startX + borderRoadWidth;
    for (let y = 0; y <= centerY; y++) {
      for (let x = startX; x < endX; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          occupiedMapBurg[y * width + x] = 1;
        }
      }
    }
  }
  if (borderDirs.south) {
    const startX = centerX - borderHalfRoad;
    const endX = startX + borderRoadWidth;
    for (let y = centerY; y < height; y++) {
      for (let x = startX; x < endX; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          occupiedMapBurg[y * width + x] = 1;
        }
      }
    }
  }
  if (borderDirs.east) {
    const startY = centerY - borderHalfRoad;
    const endY = startY + borderRoadWidth;
    for (let x = centerX; x < width; x++) {
      for (let y = startY; y < endY; y++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          occupiedMapBurg[y * width + x] = 1;
        }
      }
    }
  }
  if (borderDirs.west) {
    const startY = centerY - borderHalfRoad;
    const endY = startY + borderRoadWidth;
    for (let x = 0; x <= centerX; x++) {
      for (let y = startY; y < endY; y++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          occupiedMapBurg[y * width + x] = 1;
        }
      }
    }
  }
  generateInternalRoadsFromBorders(mapData, width, height, borderDirs, roadTile, dashedLineTile, occupiedMapBurg, rng);

  // --- Configuration for Circular Layout ---
  const maxRadius = Math.min(centerX, centerY) - 5; // Max radius for roads
  const roadWidth = 3;                             // Single-tile road width for dense burgs
  const ringCount = 3 + Math.floor(rng() * 2);      // 3 to 4 main ring roads
  const spokeCount = 8 + Math.floor(rng() * 4) * 2; // 8, 10, or 12 main spokes
  const ringSpacing = maxRadius / (ringCount + 1); // Space rings evenly

  // Track occupied areas (roads)
  const roadSet = new Set();
  // Populate roadSet from internal roads marked in occupiedMapBurg
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (occupiedMapBurg[y * width + x] === 1) {
        roadSet.add(`${x},${y}`);
      }
    }
  }

  function setRoad(x, y) {
    if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) return;
    // Don't overwrite border roads
    if (borderRoadOccupied[y * width + x]) return;
    const idx = calculateIndex(x, y, 0, width, height);
    mapData[idx] = roadTile;
    roadSet.add(`${x},${y}`);
  }

  // --- Step A: Draw Concentric Ring Roads ---
  dlog(`[BurgGenerator] Drawing ${ringCount} concentric rings.`);
  const ringRadii = [];

  for (let i = 1; i <= ringCount; i++) {
    const radius = Math.floor(i * ringSpacing);
    ringRadii.push(radius);

    for (let angle = 0; angle < 360; angle += 1) {
      const rad = (angle * Math.PI) / 180;
      const x = centerX + radius * Math.cos(rad);
      const y = centerY + radius * Math.sin(rad);
      
      // Use a brush to draw the road wider
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          setRoad(Math.floor(x + dx), Math.floor(y + dy));
        }
      }
    }
  }

  // --- Step B: Draw Radial Spokes ---
  dlog(`[BurgGenerator] Drawing ${spokeCount} radial spokes.`);
  const spokeAngles = [];

  for (let i = 0; i < spokeCount; i++) {
    const angle = (i * 360) / spokeCount + (rng() - 0.5) * 10; // Add slight randomness
    spokeAngles.push(angle);
    const rad = (angle * Math.PI) / 180;

    for (let r = 0; r < maxRadius; r++) {
      const x = centerX + r * Math.cos(rad);
      const y = centerY + r * Math.sin(rad);

      // Draw the road
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          setRoad(Math.floor(x + dx), Math.floor(y + dy));
        }
      }
    }
  }

  // --- Step C: Identify Curved Building Lots (Zoning Blocks) ---
  const buildingLots = [];
  const minLotSize = 5; // Minimum size for a building lot
  const lotOverlap = new Array(width * height).fill(false); // To prevent lot overlap

  /**
   * Finds a spot within a region defined by two radii and two angles.
   * Tries to center a lot between roads without overlapping.
   */
  function findLotInSegment(r1, r2, a1, a2) {
    // Calculate angular and radial center
    const avgRadius = (r1 + r2) / 2;
    const avgAngleRad = ((a1 + a2) / 2) * (Math.PI / 180);
    
    // Calculate lot center position
    const cx = centerX + avgRadius * Math.cos(avgAngleRad);
    const cy = centerY + avgRadius * Math.sin(avgAngleRad);
    
    const lotSize = minLotSize + Math.floor(rng() * 5); // 5x5 to 9x9

    // Check the lot area for road or existing lot overlap
    const halfSize = Math.floor(lotSize / 2);
    const startX = Math.floor(cx - halfSize);
    const startY = Math.floor(cy - halfSize);
    
    // Strict Road/Overlap Check
    for (let y = startY; y < startY + lotSize; y++) {
      for (let x = startX; x < startX + lotSize; x++) {
        const key = `${x},${y}`;
        if (roadSet.has(key) || lotOverlap[y * width + x]) {
          return null; // Overlaps with road or another lot
        }
      }
    }
    
    // Mark as occupied by a lot
    for (let y = startY; y < startY + lotSize; y++) {
      for (let x = startX; x < startX + lotSize; x++) {
        lotOverlap[y * width + x] = true;
      }
    }

    // Lot found
    return { x: startX, y: startY, w: lotSize, h: lotSize };
  }


  // 1. Center Lot (Town Square/Castle)
  const centerLotSize = 12 + Math.floor(rng() * 4);
  const centerLotX = centerX - Math.floor(centerLotSize / 2);
  const centerLotY = centerY - Math.floor(centerLotSize / 2);
  
  // Check for road collision in center
  let centerRoadCollision = false;
  for (let y = centerLotY; y < centerLotY + centerLotSize; y++) {
      for (let x = centerLotX; x < centerLotX + centerLotSize; x++) {
          if (roadSet.has(`${x},${y}`)) {
              centerRoadCollision = true;
              break;
          }
      }
  }
  
  if (!centerRoadCollision) {
       buildingLots.push({
          x: centerLotX,
          y: centerLotY,
          w: centerLotSize,
          h: centerLotSize,
          isCenter: true // Flag for placing key prefabs (castle/town hall)
      });
      
      // Mark center as occupied by a lot
      for (let y = centerLotY; y < centerLotY + centerLotSize; y++) {
          for (let x = centerLotX; x < centerLotX + centerLotSize; x++) {
              lotOverlap[y * width + x] = true;
          }
      }
  }


  // 2. Ring Segments (The main city)
  const allAngles = spokeAngles.sort((a, b) => a - b);

  for (let r = 0; r < ringRadii.length; r++) {
    const r1 = r === 0 ? roadWidth + 2 : ringRadii[r - 1] + roadWidth + 2; // Inner radius (start of segment)
    const r2 = ringRadii[r] - roadWidth - 2; // Outer radius (end of segment)
    
    // Ensure segment is wide enough
    if (r2 <= r1 + minLotSize) continue;

    for (let a = 0; a < allAngles.length; a++) {
      const a1 = allAngles[a];
      let a2 = allAngles[(a + 1) % allAngles.length];
      
      // Handle wrap-around case (360 -> 0)
      if (a2 < a1) a2 += 360; 

      // Divide the segment into 1-2 lots radially
      const segmentRadialLength = r2 - r1;
      const lotGap = 2; 

      // Try two lots
      const rMid = r1 + Math.floor(segmentRadialLength * 0.5) - lotGap;
      
      // Lot 1 (Inner)
      const lot1 = findLotInSegment(r1 + lotGap, rMid, a1, a2);
      if (lot1) buildingLots.push(lot1);

      // Lot 2 (Outer)
      const lot2 = findLotInSegment(rMid + lotGap*2, r2, a1, a2);
      if (lot2) buildingLots.push(lot2);
    }
  }

  // --- Step D: Prefab Application ---

  if (biome && biome.prefabs && biome.prefabs.length > 0) {
    dlog(`[BurgGenerator] Applying prefabs to burg with ${buildingLots.length} circular lots.`);
    const worldCoords = allOtherData?.worldCoords || { x: 0, y: 0 };

    // Pass building lots as placement hints
    allOtherData.blockHints = buildingLots;
    allOtherData.singlePrefabPerBlock = true; // Place exactly 1 prefab per lot
    allOtherData.strictNoRoadOverlap = true; // Enforce: no overlap with roads

    if (window.ProceduralMapPrefabs && window.ProceduralMapPrefabs.applyPrefabsToMap) {
      try {
        window.ProceduralMapPrefabs.applyPrefabsToMap(mapData, biome.name, worldCoords, allOtherData);
        dlog(`[BurgGenerator] Prefabs applied.`);
      } catch (e) {
        console.warn(`[BurgGenerator] Error: ${e.message}`);
      }
    }
  }

  // --- Step E.1: Directional Beach Generation ---
  addDirectionalBeach(mapData, width, height, adjacentBiomes, allFeatures, rng);

  // --- Step E.2: RoadPole markers at road intersection corners ---
  // Burg tracks roads in roadSet and building lots in lotOverlap (occupiedMapBurg
  // only holds border/internal roads), so occupancy is derived from both here.
  placeRoadPolesAtIntersections(
    mapData, width, height, allFeatures, biome, seed,
    (x, y) => roadSet.has(`${x},${y}`),
    (x, y) => roadSet.has(`${x},${y}`) || lotOverlap[y * width + x],
    (x, y) => { lotOverlap[y * width + x] = true; }
  );

  // --- Step E: Water/Region Data ---
  const regiondata = new Array(width * height).fill(0);
  let waterTileIds = new Set();
  ["Water", "Ocean", "Beach"].forEach(f => {
    if (allFeatures[f]) allFeatures[f].forEach(v => { if(v.type==='single') waterTileIds.add(v.tileId); });
  });

  for (let i = 0; i < width * height; i++) {
    if (waterTileIds.has(mapData[i])) regiondata[i] = 99;
  }
  mapData.regiondata = regiondata;

  return mapData;
}

  // ===== EXPORT DUNGEON FUNCTIONS =====

  window.ProcGenDungeon = {
    isDungeonBiome,
    isVillageBiome,
    isCityBiome,
    isBurgBiome,
    getFeatureTiles,
    getRandomFeatureTile,
    generateDungeonBiome,
    generateVillageBiome,
    generateCityBiome,
    generateBurgBiome
  };
})();