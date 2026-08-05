/*:
 * @target MZ
 * @plugindesc Procedural Terrain Interactions v1.2.0 — press the action button facing a terrain feature on the procedural map to Fell / Mine / Pick Up / Dismantle it; walk into a structure entrance (StairsDown cellars, StairsUp temples, Cave dens, Grates, Hatches) to enter it. Removals are stored in the world folder so every savegame in the same world keeps them gone.
 * @author Hypernet
 *
 * @help
 * ============================================================================
 * Procedural Terrain Interactions (formerly Procedural Terrain Dismantle)
 * ============================================================================
 * ONLY on the procedural map (map 636). When the player presses the action
 * button while facing a terrain feature (Tree, Rock, Mushroom, Plant, House,
 * Tech, ...), a small choice appears:
 *
 *   <Action> / Cancel
 *
 * where <Action> depends on the feature:
 *   - Trees     -> "Fell down"   (requires an Axe-type weapon in inventory)
 *   - Rocks     -> "Mine"        (requires War Pick #163, any Heavy weapon,
 *                                  or the Chipped Pickaxe armor #60)
 *   - Plants    -> "Pick Up"     (no requirement)
 *   - Anything  -> "Dismantle"   (no requirement)
 *
 * Choosing the action removes the feature from the map and rewards the player
 * with crafting materials (the same database items used by the Thinker crafting
 * menu and the Furniture builder). Mining rocks can sometimes also yield an
 * ingot. Rewards are announced with the shared ParchmentToast popup (the same
 * one used for battle rewards).
 *
 * Removals are persisted to the active world's folder (save/worlds/<name>/
 * terrain.json) keyed by the composite proc-map key (biome + world coordinate
 * + underground depth), so a feature dismantled in one savegame stays gone for
 * every other savegame that visits the same world tile — and it will not be
 * re-placed when the map regenerates.
 *
 * That includes scenery stamped by a PREFAB (an authored map dropped onto the
 * square, ProceduralMapPrefabs): it is felled, mined and dismantled like any
 * generated feature, and the prefab pass reads the removals back through
 * TerrainInteractions.removedTilesFor(), so the tree cut down in a prefab
 * orchard is stamped bare every time that square is built again. It is keyed by
 * world coordinate, not by prefab, so the same prefab standing on another
 * square still has all of its trees.
 *
 * Structure entrances (coordinate-seeded, generated on entry) are WALKED INTO,
 * not pressed: there is no choice window and the action button does nothing on
 * them. A passable entrance (a grate set into the floor) opens when the party
 * steps onto it; an impassable one (a cave mouth, stairs against a wall) opens
 * when the party walks into it and is stopped by it.
 *   - StairsDown -> LootCellar   (a small treasure cellar: gold, wine, chests)
 *   - StairsUp   -> TempleInside (long connected halls, much stronger enemies)
 *   - Cave       -> CaveDen      (a single cave chamber packed with one enemy
 *                                 species, bones and skulls)
 *   - Grate      -> Sewer
 *   - Hatch      -> PatronVault  (a patron's own vault, PatreonRewards: the
 *                                 cellar generator writ large, buried in gold
 *                                 and rare weapons)
 *   - DoorHouse / DoorInn / DoorShop / DoorSkyscraper / DoorDungeon
 *                -> handed to ProceduralHouseSystem, which owns the interiors
 *                   (seeded house / inn / shop / tower-block pools and the
 *                   coordinate-seeded dungeon behind a DoorDungeon).
 *
 * Requires: ProceduralMapUtils, Map/WorldMapReturn, Crafting/FurnitureSystem,
 * Core/WorldManager and Core/ParchmentToast.
 */
(() => {
  "use strict";

  const PROC_MAP_ID = 636;


  // Crafting material database item ids (data/Items.json 849-871). These are the
  // exact ids the Furniture and Thinker crafting systems use.
  const MAT = {
    ARCANE: 849, ETHEREAL: 850, CIRCUIT: 852, MICROCHIP: 853, BATTERY: 854,
    PLASTIC: 855, PLANT: 858, WOOD: 859, BONE: 860, CLOTH: 861, MEAT: 862,
    STEEL: 863, TITANIUM: 864, VARLENIA: 865, CRYSTAL: 866, GLASS: 867,
    LEATHER: 868, HERB: 869, OIL: 870, ACID: 871
  };
  const INGOTS = [MAT.STEEL, MAT.TITANIUM, MAT.VARLENIA];

  // Interaction verbs.
  const VERB = { FELL: "fell", MINE: "mine", PICK: "pick", DISMANTLE: "dismantle" };
  // Tool requirements.
  const REQ = { AXE: "axe", ROCK: "rock" };
  // Axe = wtypeId 4, Heavy = wtypeId 3 (data/System.json weaponTypes).
  const WTYPE_HEAVY = 3;
  const WTYPE_AXE = 4;
  const PICK_WEAPON_ID = 163; // War Pick
  const PICK_ARMOR_ID = 60;   // Chipped Pickaxe

  // Action sound effects (audio/se/). One is picked at random per action, with
  // a small pitch wobble so repeated harvesting does not sound identical.
  // i18n-ignore-start  audio/se filenames
  const ACTION_SE = {
    [VERB.FELL]: ["wood_01", "wood_02", "wood_03", "wood_04", "wood_05"],       // chopping wood
    [VERB.MINE]: ["stones_01", "stones_02", "stones_03", "stones_04"],          // striking stone
    [VERB.PICK]: ["Items/cloth1", "Items/cloth2", "Items/cloth3", "Items/cloth4"], // foliage rustle
    [VERB.DISMANTLE]: ["Break"]                                                 // breaking apart
  };
  // i18n-ignore-end

  function playActionSe(verb) {
    const list = ACTION_SE[verb] || ACTION_SE[VERB.DISMANTLE];
    const name = list[Math.floor(Math.random() * list.length)];
    const pitch = 90 + Math.floor(Math.random() * 21); // 90-110
    if (typeof AudioManager !== "undefined") {
      AudioManager.playSe({ name, volume: 90, pitch, pan: 0 });
    }
  }

  function verbLabel(verb) {
    switch (verb) {
      case VERB.FELL: return T('Terrain.verb.fell');
      case VERB.MINE: return T('Terrain.verb.mine');
      case VERB.PICK: return T('Terrain.verb.pick');
      default: return T('Terrain.verb.dismantle');
    }
  }

  // ==========================================================================
  // Feature -> interaction/reward table
  // ==========================================================================
  // rewards: array of [itemId, min, max]. ingot: undefined | "low" | "high"
  // adds a chance of a bonus ingot (mining only). spec: the specialization the
  // work teaches (window.SpecializationXP) - felling a tree is not the same
  // trade as stripping a reactor, and the sheet should say so.
  // i18n-ignore-start  Features.json ids and SpecializationXP ids, never labels
  const FEATURE_CONFIG = {};
  function assign(names, cfg) {
    for (const n of names) FEATURE_CONFIG[n] = cfg;
  }

  // --- Trees: need an axe, drop wood + plant matter ---
  assign(["Tree", "TreeIce", "TreeSwamp", "Palm", "Bamboo", "Mangrove"], {
    verb: VERB.FELL, req: REQ.AXE, spec: "Lumberjacking",
    rewards: [[MAT.WOOD, 1, 3], [MAT.PLANT, 1, 2]]
  });

  // --- Loose/worked wood: just pick it up ---
  assign(["Log", "LogIce", "Wood", "WoodIce", "Wooden", "WoodPillar", "Driftwood"], {
    verb: VERB.PICK, spec: "Foraging", rewards: [[MAT.WOOD, 1, 2]]
  });

  // --- Plants / foliage: pick up, drop plant matter ---
  assign([
    "Plant", "PlantIce", "Leaves", "LeavesIce", "Lilypad", "Lily", "Weed", "WeedIce",
    "WeedSwamp", "Bush", "Cactus", "Cattail", "Clover", "Coral", "Corn", "Crop",
    "Fern", "Flower", "FlowerIce", "Ivy", "Kelp", "Lichen", "Moss", "Moor", "MoorIce",
    "Rose", "Sedge", "SeaPlant", "Seaweed", "Shrub", "Sprout", "Sunflower", "Thistle",
    "Thorn", "Vine", "Wheat", "Hay", "HayIce", "Soil"
  ], {
    verb: VERB.PICK, spec: "Foraging", rewards: [[MAT.PLANT, 1, 2]]
  });

  // --- Herbs: plant matter + a herb extract ---
  assign(["Herb"], { verb: VERB.PICK, spec: "Herbalism", rewards: [[MAT.PLANT, 1, 2], [MAT.HERB, 1, 1]] });

  // --- Mushrooms: pick up, plant matter ---
  assign(["Mushroom"], { verb: VERB.PICK, spec: "Foraging", rewards: [[MAT.PLANT, 1, 2]] });

  // --- Rocks & rock-built things: need a pickaxe/heavy tool, drop steel + ingots ---
  // (Statue removed: it now shows a read-only inscription, see CUSTOM_HANDLERS.)
  assign([
    "Rock", "RockDesert", "RockIce", "Pebble", "PebbleIce", "Stalagmite", "Stalactite",
    "Stalattite", "Rubble", "Wall", "WoodPillar", "Arch", "Aqueduct", "Column", "Pillar",
    "MysticStone", "Marble", "Monument", "Podium", "Boulder"
  ], {
    verb: VERB.MINE, req: REQ.ROCK, spec: "Masonry", rewards: [[MAT.STEEL, 1, 2]], ingot: "low"
  });

  // --- Ore veins / deposits / mine shafts: better ingot odds ---
  assign(["Ore", "Deposit", "MineShaft"], {
    verb: VERB.MINE, req: REQ.ROCK, spec: "Mining", rewards: [[MAT.STEEL, 1, 2]], ingot: "high"
  });

  // --- Gems / crystals: crystal + ingot chance ---
  assign(["Gem", "Crystal"], {
    verb: VERB.MINE, req: REQ.ROCK, spec: "Mining", rewards: [[MAT.CRYSTAL, 1, 2]], ingot: "low"
  });

  // --- Graves / bones: need a tool, drop bone (+ crystal) ---
  // (Skull removed: it now grants a random Skull-named item, see CUSTOM_HANDLERS.)
  assign([
    "Grave", "GraveIce", "Tomb", "Coffin", "Sarcophagus", "Bones", "SkeletonBonus"
  ], {
    verb: VERB.MINE, req: REQ.ROCK, spec: "Mining", rewards: [[MAT.BONE, 1, 2], [MAT.CRYSTAL, 0, 1]]
  });

  // --- Buildings & wooden structures: dismantle for wood + steel ---
  // (Throne/Stool removed: they're sittable now. SignInn/SignItems/SignPostIce
  // removed: they show their own dialogue/menu, see CUSTOM_HANDLERS.)
  assign([
    "Building", "House", "HouseIce", "Cottage", "Manor", "Castle", "Fortress", "Tower",
    "Temple", "Church", "Inn", "Tavern", "Warehouse", "Factory", "Prison", "Windmill",
    "Chimney", "ChimneyIce", "Roof", "Blacksmith", "Ruin", "DragonsLair", "BeastDen",
    "Lair", "MonsterNest", "Nest", "Hive", "Bridge", "Fence", "Gate", "Door", "Ladder",
    "LadderDown", "Mannequin", "Scarecrow", "ScarecrowIce",
    "Table", "TableBroken", "Sign", "SignArmor",
    "SignMagic", "SignTravel", "SignWeapon", "SignTravel",
    "Barrel", "BarrelIce", "Cart", "Bench", "Rope", "Trash"
  ], {
    verb: VERB.DISMANTLE, spec: "Carpentry", rewards: [[MAT.WOOD, 1, 3], [MAT.STEEL, 0, 1]]
  });

  // --- Metal / smithing props: dismantle for steel ---
  // (Fountain/Shovel removed: Fountain now offers Drink/Bathe, Shovel is picked
  // up as item 138, see CUSTOM_HANDLERS.)
  assign([
    "Anvil", "Cauldron", "Furnace", "Lamp", "Lantern", "Chain", "BucketIce",
    "Well", "WellIce", "Workbench", "CraftStation", "Tech", "Gear"
  ], {
    verb: VERB.DISMANTLE, spec: "Metalworking", rewards: [[MAT.STEEL, 1, 2]]
  });

  // --- Glass / vases / windows ---
  // (Vase/VaseIce/VasePlant removed: they're "Break"-able for random food now.
  // Mirror removed: it calls Common Event 169. See CUSTOM_HANDLERS.)
  assign(["Window", "WindowIce", "WindowBroken", "VaseBroken"], {
    verb: VERB.DISMANTLE, spec: "Glassblowing", rewards: [[MAT.GLASS, 1, 2]]
  });

  // --- Cloth / banners ---
  assign(["Banner", "Flag", "Decoration", "SpiderWeb"], {
    verb: VERB.DISMANTLE, spec: "Sewing", rewards: [[MAT.CLOTH, 1, 2]]
  });

  // --- Oil / fire props ---
  // (Torch/Candle removed: they're now toggleable lights, see CUSTOM_HANDLERS.)
  assign(["CampfireIce", "Oil", "Lava"], {
    verb: VERB.DISMANTLE, spec: "Chemistry", rewards: [[MAT.OIL, 1, 1]]
  });

  // --- Tech / sci-fi: dismantle for steel + plastic + electronics ---
  assign([
    "Antenna", "Circuit", "CodePattern", "Elevator", "Holo", "Hologram", "MetalPanel",
    "Neon", "Pipe", "PowerNode", "QuantumField", "Reactor", "Robot", "SpaceDebris",
    "Spacecraft", "Transmitter", "AlienStructure"
  ], {
    verb: VERB.DISMANTLE, spec: "Electronics",
    rewards: [[MAT.STEEL, 1, 2], [MAT.PLASTIC, 1, 2], [MAT.MICROCHIP, 0, 1]]
  });

  // --- Magic / occult: dismantle for arcane essence + ethereal + crystal ---
  assign([
    "Alchemy", "Altar", "ArcaneRuin", "Aura", "Cursed", "Divine", "Ether", "Glow",
    "ManaSource", "Orb", "Portal", "Rune", "Sacred", "Shadow", "Shrine", "Spectral",
    "SpellCircle", "Spirit", "SummonCircle", "Void", "GhostTrap", "TrapArea"
  ], {
    verb: VERB.DISMANTLE, spec: "Alchemy",
    rewards: [[MAT.ARCANE, 1, 2], [MAT.ETHEREAL, 0, 1], [MAT.CRYSTAL, 0, 1]]
  });

  // Pure terrain / hazards / water features that make no sense to remove: never
  // offer an interaction (also keeps climbing & swimming behaviour intact).
  const SKIP = new Set([
    "Island", "Badland", "Magma", "Ember", "Lagoon", "Whirlpool", "Oasis", "Geyser",
    "Geothermal", "Sulfur", "SpringIce", "Spring", "Ice", "Snow", "Sand", "Stone",
    "Grass", "GrassDark", "Road", "Sidewalk", "Water", "Ocean", "Mountain", "Cliff",
    // Building/dungeon entrances + interactive signposts: used via
    // ProceduralHouseSystem (enter / refuel / fast-travel), never harvested.
    "DoorHouse", "DoorInn", "DoorShop", "DoorSkyscraper", "DoorDungeon",
    "SignPark", "SignBus",
    // Purely a step-on trigger (wets the party, see the moveStraight hook below),
    // never an action-button interaction.
    "Puddle"
  ]);

  // Generic fallback for any other real, named layer-2 feature.
  const DEFAULT_CONFIG = { verb: VERB.DISMANTLE, spec: "Carpentry", rewards: [[MAT.WOOD, 1, 2]] };
  // i18n-ignore-end

  // Scenery a prefab painted that the biome tileset gives no feature name to.
  // A prefab is an authored map, and nearly everything it puts on the object
  // layers IS a named feature of the biome tileset (classified above like any
  // other) -- but the handful that is not used to be dead decoration standing in
  // the middle of a square where everything around it comes apart. Whatever a
  // prefab stood on an object layer is salvaged like the rest.
  function prefabFixtureAt(x, y, tileId) {
    // A5 (1536-1663) and A1-A4 (2048+) autotiles are ground and walls, never
    // loose scenery, so a bare floor inside a prefab is not "dismantlable".
    if (!tileId || tileId >= 1536) return false;
    const P = window.ProceduralMapPrefabs;
    const rects = (P && typeof P.getPrefabFootprints === "function") ? P.getPrefabFootprints() : null;
    if (!rects) return false;
    return rects.some(r => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height);
  }

  // Resolve the interaction config for a feature name, or null to skip.
  function classify(name) {
    if (!name) return null;
    if (SKIP.has(name)) return null;
    // Ignore raw terrain autotiles / unmapped tiles.
    if (name.startsWith("A5 ") || name.startsWith("Extended ") || name === "Unknown") return null;  // i18n-ignore  tile ids
    return FEATURE_CONFIG[name] || DEFAULT_CONFIG;
  }

  // ==========================================================================
  // Tool requirement checks
  // ==========================================================================
  function partyHasWeaponType(wtypeId) {
    if (!$gameParty) return false;
    // Unequipped inventory weapons.
    if ($gameParty.weapons().some(w => w && w.wtypeId === wtypeId)) return true;
    // Equipped weapons on party members.
    return $gameParty.members().some(a =>
      a.weapons().some(w => w && w.wtypeId === wtypeId)
    );
  }

  function meetsRequirement(req) {
    if (!req) return true;
    if ($gameSystem && $gameSystem._isSandboxMode) return true;
    if (req === REQ.AXE) {
      return partyHasWeaponType(WTYPE_AXE);
    }
    if (req === REQ.ROCK) {
      return (
        ($dataWeapons[PICK_WEAPON_ID] && $gameParty.hasItem($dataWeapons[PICK_WEAPON_ID], true)) ||
        partyHasWeaponType(WTYPE_HEAVY) ||
        ($dataArmors[PICK_ARMOR_ID] && $gameParty.hasItem($dataArmors[PICK_ARMOR_ID], true))
      );
    }
    return true;
  }

  function requirementError(req) {
    if (req === REQ.AXE) {
      return T('Terrain.needAxe');
    }
    return T('Terrain.needPickaxe');
  }

  // ==========================================================================
  // Reward popup (shared ParchmentToast, same as battle rewards)
  // ==========================================================================
  function itemData(id) {
    return (typeof $dataItems !== "undefined" && $dataItems) ? $dataItems[id] : null;
  }

  function showRewardPopup(gained) {
    if (!gained.length || !window.ParchmentToast) return;
    window.ParchmentToast.reward({
      entries: gained.map(g => ({ obj: itemData(g.id), qty: g.qty }))
    });
  }

  // ==========================================================================
  // Reward rolling & granting
  // ==========================================================================
  function addGain(list, id, qty) {
    if (qty <= 0) return;
    const existing = list.find(g => g.id === id);
    if (existing) existing.qty += qty;
    else list.push({ id, qty });
  }

  function rollRewards(cfg) {
    const gained = [];
    for (const [id, min, max] of cfg.rewards) {
      const q = min + Math.floor(Math.random() * (max - min + 1));
      addGain(gained, id, q);
    }
    if (cfg.ingot) {
      const chance = cfg.ingot === "high" ? 0.6 : 0.25;
      if (Math.random() < chance) {
        const r = Math.random();
        const ingot = r < 0.7 ? INGOTS[0] : (r < 0.9 ? INGOTS[1] : INGOTS[2]);
        addGain(gained, ingot, 1);
      }
    }
    return gained;
  }

  function grantRewards(gained) {
    for (const g of gained) {
      const item = itemData(g.id);
      if (item) $gameParty.gainItem(item, g.qty);
    }
  }

  // ==========================================================================
  // World-folder persistence of dismantled features
  // ==========================================================================
  // Stored as save/worlds/<name>/terrain.json:
  //   { dismantled: { "<procMapKey>": { "x,y": featureName } } }
  // A plain object (NOT a Set/Map) so JsonEx serialises it on flush.
  function terrainStore() {
    if (!window.WorldManager || typeof window.WorldManager.getFile !== "function") return null;
    const store = window.WorldManager.getFile("terrain");
    if (!store.dismantled) store.dismantled = {};
    return store;
  }

  // Composite per-coordinate key (biome + world coord + depth), identical to the
  // furniture system so removals track the exact world tile they were made on.
  function currentMapKey() {
    if (window.FurnitureSystem && typeof window.FurnitureSystem.furnitureMapKey === "function") {
      return String(window.FurnitureSystem.furnitureMapKey());
    }
    return String($gameMap ? $gameMap.mapId() : 0);
  }

  // The same key composed for an EXPLICIT biome + world coordinate rather than
  // for the map the party is standing on. The prefab pass asks for a square's
  // removals from DataManager.loadMapData, before Game_Map has switched to it,
  // so currentMapKey() would still be answering for the square being left.
  // Mirrors WorldMapReturn's FurnitureSystem.mapKeyProvider exactly.
  function procMapKeyFor(biomeName, worldCoords) {
    const pg = $gameSystem && $gameSystem._procGenData;
    if (!pg || !biomeName || !worldCoords) return null;
    const depth = (pg.biomeLayerStack && pg.biomeLayerStack.length) || 0;
    const sess = pg._dungeonSession;
    const salt = (sess && sess.salt) ? `:${sess.salt}` : "";
    return `proc:${biomeName}:${worldCoords.x},${worldCoords.y}:${depth}${salt}`;
  }

  // Every tile the party has removed on one proc-map square, as a Set of "x,y",
  // or null when that square has none. ProceduralMapPrefabs reads it so a felled
  // tree is stamped bare instead of being put back by the prefab it stood in.
  function removedTilesFor(biomeName, worldCoords) {
    const store = terrainStore();
    if (!store) return null;
    const key = procMapKeyFor(biomeName, worldCoords);
    const tiles = key && store.dismantled[key];
    if (!tiles) return null;
    const keys = Object.keys(tiles);
    return keys.length ? new Set(keys) : null;
  }

  function recordDismantled(tiles, name) {
    const store = terrainStore();
    if (!store) return;
    const key = currentMapKey();
    if (!store.dismantled[key]) store.dismantled[key] = {};
    for (const t of tiles) {
      store.dismantled[key][`${t.x},${t.y}`] = name;
    }
    // Flush immediately so other savegames in the same world see the removal
    // even before the next in-game save.
    if (typeof window.WorldManager.flush === "function") {
      try { window.WorldManager.flush(); } catch (e) { /* non-fatal */ }
    }
  }

  // Zero out the feature layers (1-3) of a single tile in the live map data.
  function clearFeatureTileData(x, y) {
    if (!$dataMap || !$dataMap.data) return;
    const w = $dataMap.width;
    const h = $dataMap.height;
    for (const z of [1, 2, 3]) {
      $dataMap.data[z * w * h + y * w + x] = 0;
    }
  }

  // Tile ids of a feature that must never be cleared by a stored removal, on
  // the current tileset. A patron's Hatch is stamped after generation and is
  // not dismantlable, but it can land on a tile where something else was felled
  // long ago - and that old record would quietly delete it on every load.
  function undeletableTileIds() {
    const U = window.ProcGenUtils;
    const tilesetId = currentTilesetId();
    if (!U || !U.Cache || !tilesetId) return null;
    const all = U.Cache.getTilesetFeatures(tilesetId) || {};
    const ids = new Set();
    for (const v of all["Hatch"] || []) {  // i18n-ignore  feature id
      if (v && v.type === "single" && v.tileId) ids.add(v.tileId);
    }
    return ids.size ? ids : null;
  }

  // Re-apply all stored removals for the current proc-map coordinate.
  function applyDismantledToMap() {
    const store = terrainStore();
    if (!store) return;
    const tiles = store.dismantled[currentMapKey()];
    if (!tiles) return;
    if (!$dataMap || !$dataMap.data) return;
    const w = $dataMap.width;
    const h = $dataMap.height;
    const keep = undeletableTileIds();
    for (const coord of Object.keys(tiles)) {
      const [xs, ys] = coord.split(",");
      const x = parseInt(xs, 10);
      const y = parseInt(ys, 10);
      if (isNaN(x) || isNaN(y)) continue;
      if (keep && keep.has($dataMap.data[2 * w * h + y * w + x])) continue;
      for (const z of [1, 2, 3]) {
        $dataMap.data[z * w * h + y * w + x] = 0;
      }
    }
    if ($gameMap) $gameMap.requestRefresh();
  }

  // ==========================================================================
  // Feature lookup at (x, y)
  // ==========================================================================
  // Per-tileset lookup tables, built lazily and memoised:
  //   tileToFeature : tileId -> feature name
  //   tileToGrid    : tileId -> { grid, gr, gc } for multi-tile (grid) variants,
  //                   so a faced tile can be traced back to the full footprint.
  const _lookupCache = {};
  function getLookup(tilesetId) {
    if (_lookupCache[tilesetId]) return _lookupCache[tilesetId];
    const U = window.ProcGenUtils;
    const allFeatures = U.Cache.getTilesetFeatures(tilesetId);
    const tileToFeature = U.createTileToFeatureMap(allFeatures);
    const tileToGrid = {};
    for (const variants of Object.values(allFeatures)) {
      if (!Array.isArray(variants)) continue;
      for (const variant of variants) {
        const grid = (variant && variant.type === "grid") ? variant.grid : null;
        if (!grid) continue;
        for (let gr = 0; gr < grid.length; gr++) {
          for (let gc = 0; gc < grid[gr].length; gc++) {
            const tid = grid[gr][gc];
            if (tid && tileToGrid[tid] === undefined) {
              tileToGrid[tid] = { grid, gr, gc };
            }
          }
        }
      }
    }
    _lookupCache[tilesetId] = { tileToFeature, tileToGrid };
    return _lookupCache[tilesetId];
  }

  function currentTilesetId() {
    const tileset = $gameMap ? $gameMap.tileset() : null;
    return tileset ? tileset.id : 0;
  }

  // Returns { name, layer, tileId } for the feature occupying (x, y), or null.
  function featureAt(x, y) {
    const U = window.ProcGenUtils;
    if (!U || !$gameMap) return null;
    const tilesetId = currentTilesetId();
    if (!tilesetId) return null;
    const { tileToFeature } = getLookup(tilesetId);
    // Scan the object feature layers (top-most first). Layer 0 is base terrain,
    // layer 1 holds terrain-shape features (mountain/water) we must not touch.
    for (const z of [3, 2]) {
      const tileId = $gameMap.tileId(x, y, z);
      if (tileId !== 0) {
        return { name: U.getFeatureNameFromTileId(tileId, tileToFeature), layer: z, tileId };
      }
    }
    return null;
  }

  // Every tile that composes the feature the player faces. Single-tile features
  // return just [{x,y}]; multi-tile (grid) features return the whole footprint,
  // reconstructed from the faced tile's position inside its grid variant.
  function computeFootprint(x, y, layer, tileId) {
    const tilesetId = currentTilesetId();
    if (!tilesetId) return [{ x, y }];
    const { tileToGrid } = getLookup(tilesetId);
    const entry = tileToGrid[tileId];
    if (!entry) return [{ x, y }];

    const grid = entry.grid;
    const originX = x - entry.gc;
    const originY = y - entry.gr;
    const tiles = [];
    for (let gr = 0; gr < grid.length; gr++) {
      for (let gc = 0; gc < grid[gr].length; gc++) {
        const cx = originX + gc;
        const cy = originY + gr;
        if (cx < 0 || cy < 0 || cx >= $dataMap.width || cy >= $dataMap.height) continue;
        // Only take a cell that still actually holds this variant's tile, so we
        // never clear a neighbouring feature that happens to sit in the box.
        if ($gameMap.tileId(cx, cy, layer) === grid[gr][gc]) {
          tiles.push({ x: cx, y: cy });
        }
      }
    }
    if (!tiles.some(t => t.x === x && t.y === y)) tiles.push({ x, y });
    return tiles;
  }

  // ==========================================================================
  // Interaction flow
  // ==========================================================================
  function performDismantle(name, cfg, tiles) {
    // Remove every tile of the feature (whole footprint for multi-tile pieces),
    // then refresh the tilemap once.
    for (const t of tiles) clearFeatureTileData(t.x, t.y);
    if ($gameMap) $gameMap.requestRefresh();
    recordDismantled(tiles, name);
    const gained = rollRewards(cfg);
    grantRewards(gained);
    playActionSe(cfg.verb);
    showRewardPopup(gained);
    // The work itself is the lesson, and which lesson depends on what was
    // taken apart: an axe in a trunk teaches Lumberjacking, a prybar in a
    // reactor housing teaches Electronics. Capped per day like all the rest.
    if (cfg.spec && window.SpecializationXP) {
      window.SpecializationXP.awardCapped(cfg.spec, 1);
    }
  }

  // ==========================================================================
  // SignPost: Read (place name) / Dismantle (1 wood) / Cancel
  // ==========================================================================
  // A deterministic, readable name for the current proc-map settlement, derived
  // from the world seed + the player's world coordinate (Vars 43/44), so the
  // same tile always reads the same place name across savegames/visits.
  // i18n-ignore-start  invented English place-name syllables; a settlement's
  // name is a proper noun and is never translated
  const PLACE_PREFIX = [
    "Ash", "Bram", "Ever", "Frost", "Gold", "Grey", "Hollow", "Iron", "Long",
    "Marsh", "Mill", "North", "Oak", "Raven", "Red", "Silver", "Stone", "Thorn",
    "West", "Wind", "Wolf", "Amber", "Black", "Clear", "Fern", "Green", "High",
    "Moss", "Pine", "Rook", "Elder", "Fox", "Hart", "Lark", "Sable"
  ];
  const PLACE_SUFFIX = [
    "bury", "borough", "brook", "dale", "field", "ford", "gate", "haven", "hill",
    "hollow", "mere", "moor", "stead", "ton", "vale", "wick", "wood", "worth",
    "cross", "shire", "reach", "bridge", "fall", "glen", "march", "port",
    "ridge", "stone", "combe", "thorpe"
  ];
  // i18n-ignore-end

  function currentPlaceName() {
    let wx = 0, wy = 0;
    if (typeof $gameVariables !== "undefined" && $gameVariables) {
      wx = $gameVariables.value(43) | 0;
      wy = $gameVariables.value(44) | 0;
    }
    // A hand-authored name (a real city, a special landmark, ...) always wins
    // over the generated placeholder for this exact world tile.
    const overrides = window.WorldGen && window.WorldGen.HardcodedBiomeNames;
    const override = overrides ? overrides[`${wx},${wy}`] : null;
    if (override) return override;

    const U = window.ProcGenUtils;
    let seed;
    if (U && typeof U.getWorldSeed === "function" && typeof U.hashCoords === "function") {
      seed = U.hashCoords(U.getWorldSeed(), wx, wy) >>> 0;
    } else {
      seed = ((19002001 ^ (wx * 73856093) ^ (wy * 19349663)) >>> 0);
    }
    const pre = PLACE_PREFIX[seed % PLACE_PREFIX.length];
    const suf = PLACE_SUFFIX[Math.floor(seed / PLACE_PREFIX.length) % PLACE_SUFFIX.length];
    return pre + suf;
  }

  // Dismantle a signpost for a single unit of wood (fixed reward per request).
  function performSignPostDismantle(name, tiles) {
    for (const t of tiles) clearFeatureTileData(t.x, t.y);
    if ($gameMap) $gameMap.requestRefresh();
    recordDismantled(tiles, name);
    const gained = [{ id: MAT.WOOD, qty: 1 }];
    grantRewards(gained);
    playActionSe(VERB.DISMANTLE);
    showRewardPopup(gained);
  }

  function showSignPostMenu(name, tiles) {
    const choices = [T('Terrain.read'), T('Terrain.verb.dismantle'), T('Terrain.cancel')];
    $gameMessage._eventActivator = "p1";
    window.skipLocalization = true;
    $gameMessage.setChoices(choices, 0, 2);
    window.skipLocalization = false;
    $gameMessage.setChoiceCallback((index) => {
      // Defer past the choice window teardown so any follow-up dialogue shows.
      if (index === 0) {
        setTimeout(() => {
          window.skipLocalization = true;
          $gameMessage.add(currentPlaceName());
          window.skipLocalization = false;
        }, 0);
      } else if (index === 1) {
        setTimeout(() => performSignPostDismantle(name, tiles), 0);
      }
      // index 2 (Cancel) or dismissed: do nothing.
    });
  }

  function showDismantleMenu(name, cfg, tiles) {
    const label = verbLabel(cfg.verb);
    const choices = [label, T('Terrain.cancel')];
    $gameMessage._eventActivator = "p1";
    // Choice/message text is already resolved through T(); wrap so the shared
    // localization layer leaves it untouched.
    window.skipLocalization = true;
    $gameMessage.setChoices(choices, 0, 1);
    window.skipLocalization = false;
    $gameMessage.setChoiceCallback((index) => {
      // Defer past the choice window teardown ($gameMessage is cleared right
      // after this callback), so any follow-up dialogue actually shows.
      if (index !== 0) return;
      setTimeout(() => {
        if (cfg.req && !meetsRequirement(cfg.req)) {
          window.skipLocalization = true;
          $gameMessage.add(requirementError(cfg.req));
          window.skipLocalization = false;
          return;
        }
        performDismantle(name, cfg, tiles);
      }, 0);
    });
  }

  // Generic "<Choice 1> / <Choice 2> / ... / Cancel" prompt. `choices` is an
  // array of display labels (already resolved through T()); `onSelect(index)`
  // fires for any pick that ISN'T the trailing, auto-appended Cancel entry.
  function showChoiceMenu(choices, onSelect) {
    const full = choices.concat([T('Terrain.cancel')]);
    $gameMessage._eventActivator = "p1";
    window.skipLocalization = true;
    $gameMessage.setChoices(full, 0, full.length - 1);
    window.skipLocalization = false;
    $gameMessage.setChoiceCallback((index) => {
      if (index < 0 || index >= choices.length) return; // Cancel or dismissed
      setTimeout(() => onSelect(index), 0);
    });
  }

  // Immediate (no confirmation) narrative popup: a couple of lines of
  // generated/flavour text shown via the normal message window.
  function showLoreMessage(lines) {
    setTimeout(() => {
      window.skipLocalization = true;
      for (const line of [].concat(lines)) $gameMessage.add(line);
      window.skipLocalization = false;
    }, 0);
  }

  // ==========================================================================
  // Custom-interaction helpers (items/materials/loot shared by CUSTOM_HANDLERS)
  // ==========================================================================
  const SHOVEL_ITEM_ID = 138;
  const BEER_ITEM_ID   = 498;
  const DRUNK_STATE_ID = 42;  // data/States.json "Drunk"
  const CHEAP_WEAPON_MAX_PRICE = 1500;
  const TRINKET_MAX_PRICE = 6000;
  // What counts as a rare weapon in a patron's vault: the top third of the
  // whole armoury by price.
  const VAULT_WEAPON_MIN_PRICE = 50000;

  // Any real, selectable $dataItems entry whose <category:X> tag matches exactly.
  function itemsWithCategory(category) {
    const re = new RegExp(`<category:\\s*${category}\\s*>`, "i");
    const out = [];
    for (let i = 1; i < $dataItems.length; i++) {
      const it = $dataItems[i];
      if (it && it.name && it.note && re.test(it.note)) out.push(it);
    }
    return out;
  }

  // Any real $dataItems entry whose display name contains the given substring.
  function itemsWithNameContaining(substr) {
    const re = new RegExp(substr, "i");
    const out = [];
    for (let i = 1; i < $dataItems.length; i++) {
      const it = $dataItems[i];
      if (it && it.name && re.test(it.name)) out.push(it);
    }
    return out;
  }

  function randomFrom(list, rng) {
    const roll = rng || Math.random;
    return list.length ? list[Math.floor(roll() * list.length)] : null;
  }

  // A random weapon cheap enough to hand out as a lucky find (price > 0, so
  // unsellable/placeholder 0-price weapons never come up).
  function randomCheapWeapon(maxPrice) {
    const out = [];
    for (let i = 1; i < $dataWeapons.length; i++) {
      const w = $dataWeapons[i];
      if (w && w.name && w.name.trim() !== "" && w.price > 0 && w.price <= maxPrice) out.push(w);
    }
    return randomFrom(out);
  }

  // The opposite end of the same rack: a weapon nobody leaves lying in a
  // cellar. Only ever handed out inside a patron's vault, where the whole
  // point is that the racks are worth something.
  function randomRareWeapon(minPrice) {
    const out = [];
    for (let i = 1; i < $dataWeapons.length; i++) {
      const w = $dataWeapons[i];
      if (w && w.name && w.name.trim() !== "" && w.price >= minPrice) out.push(w);
    }
    return randomFrom(out);
  }

  // True while the party stands in a patron's vault (PatreonRewards): the gold
  // hoards and the weapon racks in there pay out on a different scale.
  function inPatronVault() {
    const PR = window.PatreonRewards;
    return !!(PR && typeof PR.isInPatronVault === "function" && PR.isInPatronVault());
  }

  // A random accessory (etypeId 5) cheap enough to pass for a trinket buried
  // in a hoard. Takes the caller's rng so the find stays tile-deterministic.
  function randomTrinket(maxPrice, rng) {
    const out = [];
    for (let i = 1; i < $dataArmors.length; i++) {
      const a = $dataArmors[i];
      if (a && a.name && a.name.trim() !== "" && a.etypeId === 5 && a.price > 0 && a.price <= maxPrice) out.push(a);
    }
    return randomFrom(out, rng);
  }

  // Same popup, but for already-resolved data objects (items/weapons/armors)
  // instead of item ids - used for weapon/body-part/book/skull grants where the
  // id isn't known ahead of time.
  function showRewardPopupObjects(entries) {
    entries = entries.filter(e => e && e.obj);
    if (!entries.length || !window.ParchmentToast) return;
    window.ParchmentToast.reward({ entries });
  }

  function grantObjects(entries) {
    for (const e of entries) {
      if (e && e.obj) $gameParty.gainItem(e.obj, e.qty);
    }
  }

  function showGoldPopup(amount) {
    if (!window.ParchmentToast) return;
    window.ParchmentToast.gold(amount);
  }

  // Recovery formula shared with TimeDateSystem's EatFood command
  // (calories*0.10 + protein*2.00 + fat*1.50), read straight off the item's
  // own note tags so it stays in sync if the item is ever re-balanced.
  function hungerRecoveryForItem(item) {
    if (!item || !item.note) return 0;
    const cal  = parseFloat((item.note.match(/<calories:\s*(-?\d+(?:\.\d+)?)>/i)  || [0, 0])[1]) || 0;
    const prot = parseFloat((item.note.match(/<protein:\s*(-?\d+(?:\.\d+)?)>/i)   || [0, 0])[1]) || 0;
    const fat  = parseFloat((item.note.match(/<fat:\s*(-?\d+(?:\.\d+)?)>/i)       || [0, 0])[1]) || 0;
    return (cal * 0.10) + (prot * 2.00) + (fat * 1.50);
  }

  // Deterministic per-tile RNG (same tile always resolves the same way), mixed
  // with the world seed like every other proc-map-coordinate seed in the project.
  function seededRngForTile(x, y, salt) {
    const U = window.ProcGenUtils;
    if (!U || typeof U.getWorldSeed !== "function" || typeof U.hashCoords !== "function" ||
        typeof U.createSeededRandom !== "function") {
      return Math.random;
    }
    const seed = (U.hashCoords(U.getWorldSeed(), x, y) ^ (salt || 0)) >>> 0;
    return U.createSeededRandom(seed);
  }

  // Per-tile container id for Sack/Crate loot (independent of any real event).
  function proceduralContainerId(featureName, x, y) {
    return `proc:${featureName}:${currentMapKey()}:${x},${y}`;
  }

  // Stocked once and once only: ContainerManager keeps the ledger, so a crate
  // the player has emptied is not refilled with the same seeded loot on the
  // next Open.
  function generateSeededLoot(containerId, cat1, cat2, cat3, maxItems, seedRng) {
    const CM = window.ContainerManager;
    if (!CM) return;
    const origRandom = Math.random;
    Math.random = seedRng;
    try { CM.generateContainerItems(containerId, cat1, cat2, cat3, maxItems); }
    finally { Math.random = origRandom; }
  }

  function openLootContainer(containerId) {
    if (!window.Scene_Container) return;
    SceneManager.push(window.Scene_Container);
    SceneManager.prepareNextScene(containerId, false);
  }

  // ==========================================================================
  // Lit torches/candles: world-folder persistence (mirrors "dismantled" above)
  // ==========================================================================
  function litStore() {
    const store = terrainStore();
    if (!store) return null;
    if (!store.litFeatures) store.litFeatures = {};
    return store;
  }

  function isLit(x, y) {
    const store = litStore();
    if (!store) return false;
    const tiles = store.litFeatures[currentMapKey()];
    return !!(tiles && tiles[`${x},${y}`]);
  }

  function setLit(x, y, on) {
    const store = litStore();
    if (!store) return;
    const key = currentMapKey();
    if (!store.litFeatures[key]) store.litFeatures[key] = {};
    if (on) store.litFeatures[key][`${x},${y}`] = true;
    else delete store.litFeatures[key][`${x},${y}`];
    if (typeof window.WorldManager.flush === "function") {
      try { window.WorldManager.flush(); } catch (e) { /* non-fatal */ }
    }
  }

  // Every currently-lit tile on the CURRENT proc-map coordinate, for
  // DynamicLightingSystem to re-create ad hoc lights when the map (re)loads.
  function getLitTiles() {
    const store = litStore();
    if (!store) return [];
    const tiles = store.litFeatures[currentMapKey()];
    if (!tiles) return [];
    return Object.keys(tiles).map((k) => {
      const [xs, ys] = k.split(",");
      return { x: parseInt(xs, 10), y: parseInt(ys, 10) };
    });
  }

  // ==========================================================================
  // CUSTOM_HANDLERS: one bespoke interaction per feature name. Each handler
  // receives (name, tiles, info, character); `tiles[0]` is the faced tile.
  // ==========================================================================
  const CUSTOM_HANDLERS = {};

  // --- Gold: a hoard whose contents vary. Rolled from the tile seed, so the
  // same lump always holds the same find no matter how often the map is
  // regenerated: mostly coins, sometimes ore, gems or a buried trinket, once
  // in a while a real treasure - and rarely nothing but pyrite. ---
  function rollGoldHoard(t) {
    const rng = seededRngForTile(t.x, t.y, 0x601D);
    const between = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    if (inPatronVault()) {
      // A patron's vault is not a hoard somebody forgot in a cellar: every pile
      // is real coin, and a good half of them are stacked on bullion or gems.
      const objs = [];
      if (rng() < 0.5) {
        const ingot = $dataItems[INGOTS[Math.floor(rng() * INGOTS.length)]];
        if (ingot) objs.push({ obj: ingot, qty: between(2, 5) });
      }
      if (rng() < 0.35) {
        const crystal = $dataItems[MAT.CRYSTAL];
        if (crystal) objs.push({ obj: crystal, qty: between(1, 3) });
      }
      if (rng() < 0.25) {
        const trinket = randomTrinket(TRINKET_MAX_PRICE, rng);
        if (trinket) objs.push({ obj: trinket, qty: 1 });
      }
      return { gold: between(1500, 6000), objs };
    }
    const roll = rng();
    if (roll < 0.32) return { gold: between(120, 400), objs: [] };   // loose change
    if (roll < 0.62) return { gold: between(600, 1200), objs: [] };  // a full purse
    if (roll < 0.76) {                                               // coins over raw ore
      const ingot = $dataItems[INGOTS[Math.floor(rng() * INGOTS.length)]];
      return { gold: between(200, 600), objs: ingot ? [{ obj: ingot, qty: between(1, 3) }] : [] };
    }
    if (roll < 0.86) {                                               // coins mixed with gemstones
      const crystal = $dataItems[MAT.CRYSTAL];
      return { gold: between(300, 800), objs: crystal ? [{ obj: crystal, qty: between(1, 2) }] : [] };
    }
    if (roll < 0.94) {                                               // a trinket lost in the pile
      const trinket = randomTrinket(TRINKET_MAX_PRICE, rng);
      return { gold: between(150, 500), objs: trinket ? [{ obj: trinket, qty: 1 }] : [] };
    }
    if (roll < 0.99) return { gold: between(2200, 4000), objs: [] }; // a genuine treasure
    return { gold: between(5, 40), objs: [], fools: true };          // fool's gold
  }

  CUSTOM_HANDLERS.Gold = (name, tiles) => {
    showChoiceMenu([T('Terrain.collect')], () => {
      const hoard = rollGoldHoard(tiles[0]);
      for (const t of tiles) clearFeatureTileData(t.x, t.y);
      if ($gameMap) $gameMap.requestRefresh();
      recordDismantled(tiles, name);
      $gameParty.gainGold(hoard.gold);
      grantObjects(hoard.objs);
      if (typeof AudioManager !== "undefined") AudioManager.playSe({ name: "Coin", volume: 90, pitch: 100, pan: 0 });
      showGoldPopup(hoard.gold);
      if (hoard.objs.length) showRewardPopupObjects(hoard.objs);
      if (hoard.fools) {
        showLoreMessage(T('Terrain.foolsGold'));
      }
    });
  };

  // --- Beer: Drink (hunger, and the whole party gets Drunk) or Pick up (498) ---
  CUSTOM_HANDLERS.Beer = (name, tiles) => {
    showChoiceMenu([T('Terrain.drink'), T('Terrain.pickUp')], (index) => {
      for (const t of tiles) clearFeatureTileData(t.x, t.y);
      if ($gameMap) $gameMap.requestRefresh();
      recordDismantled(tiles, name);
      const beer = $dataItems[BEER_ITEM_ID];
      if (index === 0) {
        const leader = $gameParty.leader();
        if (leader && beer) leader.addHunger(hungerRecoveryForItem(beer));
        // Shared round: everyone drinks, everyone ends up drunk.
        for (const a of $gameParty.members()) a.addState(DRUNK_STATE_ID);
        playActionSe(VERB.PICK);
      } else {
        if (beer) grantObjects([{ obj: beer, qty: 1 }]);
        playActionSe(VERB.PICK);
        showRewardPopupObjects([{ obj: beer, qty: 1 }]);
      }
    });
  };

  // --- Library: generated book title/author/description, never removed ---
  CUSTOM_HANDLERS.Library = (name, tiles) => {
    const t = tiles[0];
    const RBG = window.RandomBookGenerator;
    if (!RBG) return;
    const rng = seededRngForTile(t.x, t.y, 0x1157A2);
    if (typeof RBG.generateTitle !== "function") return;
    const title = RBG.generateTitle(rng);
    const author = typeof RBG.generateAuthor === "function" ? RBG.generateAuthor(rng) : "";
    const description = typeof RBG.generateDescription === "function" ? RBG.generateDescription(rng) : "";
    const heading = author ? `"${title}" — ${author}` : `"${title}"`;
    showLoreMessage(description ? [heading, description] : [heading]);
  };

  // --- Chair / Throne / Stool: sit, exactly like a region-102 seat tile ---
  const SIT_FEATURES = ["Chair", "Throne", "Stool"];  // i18n-ignore  feature ids
  for (const n of SIT_FEATURES) {
    CUSTOM_HANDLERS[n] = (name, tiles, info, character) => {
      const scene = SceneManager._scene;
      if (scene && typeof scene.showSitOptions === "function") scene.showSitOptions(character);
    };
  }

  // --- Statue: a generated inscription, never removed ---
  CUSTOM_HANDLERS.Statue = (name, tiles) => {
    const t = tiles[0];
    const RBG = window.RandomBookGenerator;
    if (!RBG) return;
    const rng = seededRngForTile(t.x, t.y, 0x57A700E);
    const subject = RBG.randomSubject(rng);
    showLoreMessage(T('Terrain.statue', { subject: subject }));
  };

  // --- Vase (+ ice/plant variants): Break -> random food item ---
  for (const n of ["Vase", "VaseIce", "VasePlant"]) {  // i18n-ignore  feature ids
    CUSTOM_HANDLERS[n] = (name, tiles) => {
      showChoiceMenu([T('Terrain.breakIt')], () => {
        for (const t of tiles) clearFeatureTileData(t.x, t.y);
        if ($gameMap) $gameMap.requestRefresh();
        recordDismantled(tiles, name);
        const food = randomFrom(itemsWithCategory("Food"));  // i18n-ignore  item category
        if (food) {
          grantObjects([{ obj: food, qty: 1 }]);
          showRewardPopupObjects([{ obj: food, qty: 1 }]);
        }
        AudioManager.playSe({ name: "Crash", volume: 90, pitch: 100, pan: 0 });
      });
    };
  }

  // --- Map: opens the fullscreen world map, never removed ---
  CUSTOM_HANDLERS.Map = () => {
    PluginManager.callCommand($gameMap._interpreter || {}, "WorldMap", "openWorldMap", {});
  };

  // --- Pentagram: refill the whole party's MP, never removed ---
  CUSTOM_HANDLERS.Pentagram = () => {
    for (const a of $gameParty.members()) a.setMp(a.mmp);
    if (typeof AudioManager !== "undefined") AudioManager.playSe({ name: "Decision1", volume: 90, pitch: 100, pan: 0 });
    showLoreMessage(T('Terrain.mpRefilled'));
  };

  // --- Bed / Campfire / Tent: open the sleep menu, never removed ---
  for (const n of ["Bed", "Campfire", "Tent"]) {  // i18n-ignore  feature ids
    CUSTOM_HANDLERS[n] = () => {
      const scene = SceneManager._scene;
      if (scene && typeof scene.openSleepMenu === "function") scene.openSleepMenu("main");
    };
  }

  // --- Shovel: Pick Up -> item 138 ---
  CUSTOM_HANDLERS.Shovel = (name, tiles) => {
    showChoiceMenu([verbLabel(VERB.PICK)], () => {
      for (const t of tiles) clearFeatureTileData(t.x, t.y);
      if ($gameMap) $gameMap.requestRefresh();
      recordDismantled(tiles, name);
      const shovel = $dataItems[SHOVEL_ITEM_ID];
      if (shovel) {
        grantObjects([{ obj: shovel, qty: 1 }]);
        showRewardPopupObjects([{ obj: shovel, qty: 1 }]);
      }
      playActionSe(VERB.PICK);
    });
  };

  // --- Sack: Open -> a random set of food items (ContainerSystemUI) ---
  CUSTOM_HANDLERS.Sack = (name, tiles) => {
    const t = tiles[0];
    showChoiceMenu([T('Terrain.open')], () => {
      const containerId = proceduralContainerId(name, t.x, t.y);
      generateSeededLoot(containerId, "Food", null, null, 5, seededRngForTile(t.x, t.y, 0x5ACC));  // i18n-ignore  item category
      AudioManager.playSe({ name: "Open1", volume: 90, pitch: 100, pan: 0 });
      openLootContainer(containerId);
    });
  };

  // --- Crate (+ ice variant): Open -> random cheap goods (ContainerSystemUI) ---
  for (const n of ["Crate", "CrateIce"]) {  // i18n-ignore  feature ids
    CUSTOM_HANDLERS[n] = (name, tiles) => {
      const t = tiles[0];
      showChoiceMenu([T('Terrain.open')], () => {
        const containerId = proceduralContainerId(name, t.x, t.y);
        generateSeededLoot(containerId, "Trash", "Tools", null, 4, seededRngForTile(t.x, t.y, 0xC4A7E));  // i18n-ignore  item categories
        AudioManager.playSe({ name: "Open1", volume: 90, pitch: 100, pan: 0 });
        openLootContainer(containerId);
      });
    };
  }

  // --- Torch / Candle: toggle a light on/off via DynamicLightingSystem ---
  for (const n of ["Torch", "Candle"]) {  // i18n-ignore  feature ids
    CUSTOM_HANDLERS[n] = (name, tiles) => {
      const t = tiles[0];
      const lit = isLit(t.x, t.y);
      const label = lit ? T('Terrain.blowOut') : T('Terrain.lightUp');
      showChoiceMenu([label], () => {
        setLit(t.x, t.y, !lit);
        if (window.$gameLighting && typeof window.$gameLighting.setAdHocLight === "function") {
          window.$gameLighting.setAdHocLight(`${t.x},${t.y}`, t.x, t.y, !lit);
        }
        AudioManager.playSe({ name: "Switch2", volume: 90, pitch: 100, pan: 0 });
      });
    };
  }

  // --- Weapon: a random unexpensive weapon (a rare one in a patron's vault),
  // then disappears ---
  CUSTOM_HANDLERS.Weapon = (name, tiles) => {
    showChoiceMenu([verbLabel(VERB.PICK)], () => {
      for (const t of tiles) clearFeatureTileData(t.x, t.y);
      if ($gameMap) $gameMap.requestRefresh();
      recordDismantled(tiles, name);
      const weapon = inPatronVault()
        ? (randomRareWeapon(VAULT_WEAPON_MIN_PRICE) || randomCheapWeapon(CHEAP_WEAPON_MAX_PRICE))
        : randomCheapWeapon(CHEAP_WEAPON_MAX_PRICE);
      if (weapon) {
        grantObjects([{ obj: weapon, qty: 1 }]);
        showRewardPopupObjects([{ obj: weapon, qty: 1 }]);
      }
      AudioManager.playSe({ name: "Equip1", volume: 90, pitch: 100, pan: 0 });
    });
  };

  // --- Clock: the procedural clock overlay, never removed ---
  CUSTOM_HANDLERS.Clock = (name, tiles) => {
    const t = tiles[0];
    if (window.ProceduralAnalogClock && typeof window.ProceduralAnalogClock.showAt === "function") {
      window.ProceduralAnalogClock.showAt($gameMap.mapId(), t.x, t.y);
    }
  };

  // --- Mirror: calls Common Event 169, never removed ---
  CUSTOM_HANDLERS.Mirror = () => {
    $gameTemp.reserveCommonEvent(169);
  };

  // --- Fountain: Drink (hunger) or Bathe (100% hygiene), never removed ---
  CUSTOM_HANDLERS.Fountain = () => {
    showChoiceMenu([T('Terrain.drink'), T('Terrain.bathe')], (index) => {
      AudioManager.playSe({ name: "Water2", volume: 90, pitch: 100, pan: 0 });
      if (index === 0) {
        const leader = $gameParty.leader();
        if (leader) leader.addHunger(15);
      } else {
        for (const a of $gameParty.members()) a.addHygiene(1000);
      }
    });
  };

  // --- Book: a random category:Books item, then disappears ---
  CUSTOM_HANDLERS.Book = (name, tiles) => {
    showChoiceMenu([verbLabel(VERB.PICK)], () => {
      for (const t of tiles) clearFeatureTileData(t.x, t.y);
      if ($gameMap) $gameMap.requestRefresh();
      recordDismantled(tiles, name);
      const book = randomFrom(itemsWithCategory("Books"));  // i18n-ignore  item category
      if (book) {
        grantObjects([{ obj: book, qty: 1 }]);
        showRewardPopupObjects([{ obj: book, qty: 1 }]);
      }
      playActionSe(VERB.PICK);
    });
  };

  // --- Structure entrances: descend/climb into a coordinate-seeded generated
  // structure biome (Sewer, LootCellar, TempleInside, CaveDen). The seed is
  // perturbed per entrance tile so two entrances on the same map open onto
  // different, but deterministic, structures. The border of the generated map
  // returns the player here (WorldMapReturn's _dungeonSession).
  //
  // Entering is a MOVEMENT, not an action-button interaction: every entrance
  // below is registered in WALK_ENTRANCES and fired by the Game_Player
  // moveStraight hook at the bottom of this file. Each entry returns true only
  // when the party actually went in, so a refused entrance does not lock out
  // the next step.
  function enterStructureBiome(t, biomeName, seSound) {
    const pg = $gameSystem._procGenData;
    if (!pg) return false;
    // The entrance tile is passed as the seed salt. It used to be poked into
    // pg.seed instead, which did nothing at all: procMapSeed builds the seed from
    // the WORLD seed and coordinates and never reads pg.seed, so every grate on a
    // square opened onto one and the same sewer.
    const salt = ((t.x * 131) + (t.y * 977)) | 0;
    PluginManager.callCommand($gameMap._interpreter || {}, "WorldMapReturn", "startForcedBiome",
      { Biome: biomeName, Salt: salt });
    AudioManager.playSe({ name: seSound || "Door1", volume: 90, pitch: 100, pan: 0 });
    return true;
  }

  // Feature name -> "the party walked into this, take them in". Populated by the
  // entrance handlers below and read by tryWalkEntrance / tryInteract.
  const WALK_ENTRANCES = {};

  // --- Grate: descends into a fresh Sewer biome, seeded from the grate tile ---
  WALK_ENTRANCES.Grate = (tiles) => enterStructureBiome(tiles[0], "Sewer");  // i18n-ignore  biome id

  // --- StairsDown: descends into a loot cellar (gold, wine, chests, and
  // maybe one lurking enemy around the party's level) ---
  //
  // The hatch of a Bunker-origin start is one of these. It gets the 'bunker'
  // session instead of the plain 'sandbox' one, so climbing back out rebuilds
  // the bunker's own surface square (see WorldMapReturn.exitDungeonSession)
  // rather than leaving the surface to be re-resolved off the cellar's map.
  function isBunkerHatch(t) {
    const rec = $gameSystem._bunkerOrigin;
    const pg = $gameSystem._procGenData;
    if (!rec || !pg) return false;
    return pg.originX === rec.worldX && pg.originY === rec.worldY &&
      t.x === rec.entranceX && t.y === rec.entranceY;
  }

  WALK_ENTRANCES.StairsDown = (tiles) => {
    const bunker = isBunkerHatch(tiles[0]);
    if (!enterStructureBiome(tiles[0], "LootCellar")) return false;
    if (bunker && $gameSystem._procGenData) {
      const pg = $gameSystem._procGenData;
      // Keep the entrance salt the forced-biome command just set, so the
      // cellar's terrain records stay keyed the way every other cellar's are.
      const sess = pg._dungeonSession;
      pg._dungeonSession = { type: "bunker", salt: sess ? sess.salt : 0 };
    }
    return true;
  };

  // --- Hatch: a patron's private way down into their own vault (the
  // PatronVault biome, generated by PatreonRewards.openHatch). Only ever
  // stamped on that patron's own world square, and never dismantled: it is not
  // in the dismantle table and this handler removes nothing, so the hatch is
  // still there on every later visit. Faced anywhere else it does nothing. ---
  WALK_ENTRANCES.Hatch = (tiles) => {
    const PR = window.PatreonRewards;
    if (!PR || typeof PR.openHatch !== "function") return false;
    if (typeof PR.isPatronHatch === "function" && !PR.isPatronHatch(tiles[0])) return false;
    PR.openHatch(tiles[0]);
    return true;
  };

  // --- StairsUp: ascends into a temple of long connected halls guarded by
  // enemies far above the party's level ---
  WALK_ENTRANCES.StairsUp = (tiles) => enterStructureBiome(tiles[0], "TempleInside");

  // --- Cave: enters a single-chamber cave den (from a cramped hollow to a
  // full-map cavern) packed with one seeded enemy species and old bones ---
  WALK_ENTRANCES.Cave = (tiles) => enterStructureBiome(tiles[0], "CaveDen");

  // --- Building and dungeon doors: walked into like every other entrance, and
  // handed to ProceduralHouseSystem, which owns the interiors (the seeded house
  // / inn / shop / tower-block pools, the lock and lockpick rules, the door
  // swing, and the return point). The tile is passed explicitly: the party is
  // stopped in front of an impassable door but stands ON a passable doorway,
  // so only the entrance tile itself identifies which building this is. ---
  function enterBuildingDoor(name, x, y) {
    const PHS = window.ProceduralHouseSystem;
    if (!PHS || typeof PHS.enterDoorFeatureAt !== "function") return false;
    return PHS.enterDoorFeatureAt(name, x, y) === true;
  }
  for (const doorName of ["DoorHouse", "DoorInn", "DoorShop", "DoorSkyscraper", "DoorDungeon"]) {  // i18n-ignore  Features.json ids
    WALK_ENTRANCES[doorName] = (tiles, x, y) => enterBuildingDoor(doorName, x, y);
  }

  // The map keeps taking input while the transfer fades, and an impassable
  // entrance is bumped into on every frame the direction is held, so an opened
  // entrance is held shut for a moment. The window is short enough to heal
  // itself if an entry ever fails silently.
  let _walkEntranceLockUntil = 0;

  // The party has stepped onto (or been stopped by) the tile at x,y: if it holds
  // a structure entrance, go in. Returns true when an entrance took over.
  function tryWalkEntrance(x, y) {
    // Cheapest rejections first: this runs on every step, and on every frame a
    // direction is held against an impassable tile.
    if (Graphics.frameCount < _walkEntranceLockUntil) return false;
    if ($gamePlayer.isInVehicle()) return false;
    // Surface only. Entrances are placed on surface biomes, but the same names
    // are also used as decor inside generated structures (a grate mounted on a
    // dungeon wall), and brushing past one of those must not open a second
    // structure from inside the first.
    const pg = $gameSystem._procGenData;
    if (!pg || pg._dungeonSession) return false;
    if (pg.biomeLayerStack && pg.biomeLayerStack.length > 0) return false;

    const info = featureAt(x, y);
    if (!info || !info.name) return false;
    const enter = WALK_ENTRANCES[info.name];
    if (!enter) return false;

    if ($gameMap.isEventRunning()) return false;
    if ($gameMessage && $gameMessage.isBusy && $gameMessage.isBusy()) return false;
    // Never override a real event standing on the tile (an entrance event of
    // its own, a chest, an NPC): the same rule the action button follows.
    if ($gameMap.events().some(e => e && e.x === x && e.y === y)) return false;

    const tiles = computeFootprint(x, y, info.layer, info.tileId);
    // x,y is the tile actually walked into/onto; tiles is its whole footprint.
    if (!enter(tiles, x, y)) return false;
    _walkEntranceLockUntil = Graphics.frameCount + 60;
    return true;
  }

  // --- Stove: opens the cooking menu, never removed ---
  CUSTOM_HANDLERS.Stove = () => {
    PluginManager.callCommand($gameMap._interpreter || {}, "CookingSystem", "openCookingMenu", {});
  };

  // --- Piano: opens the playable visual keyboard, never removed ---
  CUSTOM_HANDLERS.Piano = () => {
    PluginManager.callCommand($gameMap._interpreter || {}, "VisualPiano", "openPiano", {});
  };

  // --- GasPump / RefuelStation: opens the vehicle refuel station, never
  // removed. Both names are tagged on the Road tileset (the pumps come from
  // two different source sheets), so both must reach the station, otherwise
  // one of them falls through to the generic dismantle table. ---
  CUSTOM_HANDLERS.GasPump = () => {
    const scene = SceneManager._scene;
    if (scene && typeof scene.showRefuelWindow === "function") scene.showRefuelWindow();
  };
  CUSTOM_HANDLERS.RefuelStation = CUSTOM_HANDLERS.GasPump;

  // --- Skull: a random item whose name contains "Skull", then disappears ---
  CUSTOM_HANDLERS.Skull = (name, tiles) => {
    showChoiceMenu([verbLabel(VERB.PICK)], () => {
      for (const t of tiles) clearFeatureTileData(t.x, t.y);
      if ($gameMap) $gameMap.requestRefresh();
      recordDismantled(tiles, name);
      const skullItem = randomFrom(itemsWithNameContaining("skull"));
      if (skullItem) {
        grantObjects([{ obj: skullItem, qty: 1 }]);
        showRewardPopupObjects([{ obj: skullItem, qty: 1 }]);
      }
      playActionSe(VERB.PICK);
    });
  };

  // --- Spike: a random BodyPart item + 1 wood, then dismantled ---
  CUSTOM_HANDLERS.Spike = (name, tiles) => {
    showChoiceMenu([verbLabel(VERB.DISMANTLE)], () => {
      for (const t of tiles) clearFeatureTileData(t.x, t.y);
      if ($gameMap) $gameMap.requestRefresh();
      recordDismantled(tiles, name);
      const bodyPart = randomFrom(itemsWithCategory("BodyPart"));
      const wood = $dataItems[MAT.WOOD];
      const entries = [];
      if (bodyPart) entries.push({ obj: bodyPart, qty: 1 });
      if (wood) entries.push({ obj: wood, qty: 1 });
      grantObjects(entries);
      playActionSe(VERB.DISMANTLE);
      showRewardPopupObjects(entries);
    });
  };

  // --- TilledSoil: a farm plot, never harvested for loose plant matter. Empty
  // soil opens the plant growth menu for this exact tile (PlantGrowthSystem
  // keeps procedural plots in the world folder, so a field sown here is the
  // same field in every savegame of the world). Soil that already carries a
  // crop has a plant event standing on it, which handles its own menu. ---
  CUSTOM_HANDLERS.TilledSoil = (name, tiles) => {
    const t = tiles[0];
    if (window.PlantGrowthSystem && typeof window.PlantGrowthSystem.openProceduralPlot === "function") {
      window.PlantGrowthSystem.openProceduralPlot(t.x, t.y);
    }
  };

  // --- SignItems / SignInn: a one-line dialogue, never removed ---
  CUSTOM_HANDLERS.SignItems = () => showLoreMessage(T('Terrain.signShop'));
  CUSTOM_HANDLERS.SignInn   = () => showLoreMessage(T('Terrain.signInn'));

  // Public entry: attempt a terrain interaction with the tile the character
  // faces. Returns true if a menu was opened (interaction handled).
  function tryInteract(character) {
    if (!character || !$gameMap || $gameMap.mapId() !== PROC_MAP_ID) return false;
    if ($gameMessage && $gameMessage.isBusy && $gameMessage.isBusy()) return false;
    const U = window.ProcGenUtils;
    if (!U) return false;

    const d = character.direction();
    const x = $gameMap.roundXWithDirection(character.x, d);
    const y = $gameMap.roundYWithDirection(character.y, d);

    // Never override real events sitting on the faced tile.
    if ($gameMap.events().some(e => e && e.x === x && e.y === y)) return false;

    const info = featureAt(x, y);
    if (!info || !info.name) return false;

    // SignPost / SignPostIce have their own Read / Dismantle / Cancel menu.
    if (info.name === "SignPost" || info.name === "SignPostIce") {
      const tiles = computeFootprint(x, y, info.layer, info.tileId);
      showSignPostMenu(info.name, tiles);
      return true;
    }

    // Structure entrances are walked into, never pressed (see WALK_ENTRANCES and
    // the moveStraight hook below). The action button is still consumed here, so
    // a cave mouth or a hatch can never fall through to the generic dismantle
    // table and be harvested for wood.
    if (WALK_ENTRANCES[info.name]) return true;

    // Bespoke, non-generic interactions (Gold, Beer, Library, sittable
    // furniture, ...). Checked before the generic dismantle table so a name
    // present in both never falls through to the wrong behaviour.
    const customHandler = CUSTOM_HANDLERS[info.name];
    if (customHandler) {
      const tiles = computeFootprint(x, y, info.layer, info.tileId);
      customHandler(info.name, tiles, info, character);
      return true;
    }

    let cfg = classify(info.name);
    // Unnamed scenery inside a prefab: generic salvage rather than nothing.
    if (!cfg && !SKIP.has(info.name) && prefabFixtureAt(x, y, info.tileId)) {
      cfg = DEFAULT_CONFIG;
    }
    if (!cfg) return false;

    const tiles = computeFootprint(x, y, info.layer, info.tileId);
    showDismantleMenu(info.name, cfg, tiles);
    return true;
  }

  // ==========================================================================
  // Hooks
  // ==========================================================================
  // Re-apply stored removals whenever the proc map (re)loads a coordinate.
  const _Game_Map_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    _Game_Map_setup.call(this, mapId);
    if (mapId === PROC_MAP_ID) {
      applyDismantledToMap();
      // Surfacing puts the party back on the very tile they went in by, so give
      // the entrance a moment before it can swallow a still-held direction key.
      _walkEntranceLockUntil = Graphics.frameCount + 60;
    }
  };

  // Movement-driven terrain: what the party walks onto, or walks into.
  //   - a successful step lands them ON the tile: a Puddle wets the whole party
  //     (State 28), a passable entrance (a grate in the floor) swallows them.
  //   - a failed step means they walked INTO the tile ahead and were stopped by
  //     it, which is how an impassable entrance (a cave mouth, stairs set
  //     against a wall) is entered.
  const _Game_Player_moveStraight_terrain = Game_Player.prototype.moveStraight;
  Game_Player.prototype.moveStraight = function (d) {
    _Game_Player_moveStraight_terrain.call(this, d);
    if (!$gameMap || $gameMap.mapId() !== PROC_MAP_ID) return;
    if (this.isMovementSucceeded()) {
      const info = featureAt(this.x, this.y);
      if (info && info.name === "Puddle") {  // i18n-ignore  feature id
        for (const a of $gameParty.members()) a.addState(28);
      }
      tryWalkEntrance(this.x, this.y);
    } else {
      tryWalkEntrance($gameMap.roundXWithDirection(this.x, d),
        $gameMap.roundYWithDirection(this.y, d));
    }
  };

  window.TerrainInteractions = {
    tryInteract, applyDismantledToMap,
    // Every removal recorded for one proc-map square (biome + world coordinate),
    // read by ProceduralMapPrefabs so a prefab never re-stamps scenery the party
    // already took apart on that square. Other squares running the same prefab
    // are untouched: the key is the world coordinate, not the prefab.
    removedTilesFor,
    // Exposed so FurnitureSystem's Features tab can price a placeable feature
    // off the SAME reward table dismantling it would actually pay out (no
    // duplicated classification data). Returns null for un-dismantlable /
    // skipped names (doors, signs, pure terrain autotiles, ...).
    classify(name) { return classify(name); },
    // Every currently-lit Torch/Candle tile on the current proc-map coordinate;
    // DynamicLightingSystem re-creates their ad hoc lights from this on load.
    getLitTiles,
  };
  // Legacy alias (pre-rename): same object, so wraps applied through either
  // name are seen by every consumer.
  window.TerrainDismantle = window.TerrainInteractions;
})();
