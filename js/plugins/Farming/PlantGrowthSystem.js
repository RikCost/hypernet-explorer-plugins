/*:
 * @target MZ
 * @plugindesc v1.1.0 Plant Growth System - simulates plant lifecycle using game time, seasons and weather.
 * @author Omni-Lex
 *
 * @help PlantGrowthSystem v1.1.0
 * ============================================================
 * Manages a realistic plant growth lifecycle driven by the
 * TimeDateSystem (Variable 114 = game minutes) and WeatherSystem
 * ($gameWeather.getSeason / currentWeatherType).
 *
 * --- Setup ---
 * 1. Name any event "Plant" on the map.
 * 2. Add a Comment command with the plant name to auto-initialize it.
 * 3. Call plugin command "CheckGrowth" from that event to open
 * the plant management menu.
 * 4. Plant sprites must be in img/characters/Plants/
 * e.g. !$Watermelon.png  (single-character, no-shadow prefix)
 * The sprite sheet uses 4 rows (down/left/right/up) as
 * growth stages, first column (pattern 0) is displayed.
 *
 * --- Map Tags ---
 * <Greenhouse>  Growth runs at max speed all year regardless of season.
 *
 * --- Growth Logic ---
 * - Plants only grow during their defined seasons (unless Greenhouse).
 * - Rain: +30% growth speed.  Storm: +10%.  Snow: -50%.
 * - Greenhouse multiplier: x1.5.
 * - Out-of-season plants are dormant (no effective time accumulates).
 * - A plant standing at 100% is harvested on the spot when the player
 *   interacts with it: the growth menu only opens on a plot still growing.
 *
 * --- Procedural Map Fields (map 636) ---
 * Tilled soil generated on the procedural map is farmable. The first visit to a
 * world coordinate rolls, from the world seed, which contiguous patches of
 * tilled soil are sown and with which crop, so a whole field grows the same
 * plant. Plots are stored in the active world folder (plants.json), NOT in the
 * savegame, so a field sown, grown or harvested in one savegame is the same
 * field in every other savegame of that world.
 *   - A sown tile carries an injected "Plant" event: face it to open this menu.
 *   - Empty tilled soil has no event: facing it opens the growth menu through
 *     ProceduralTerrainInteractions.
 *   - Harvesting or clearing a procedural plot frees the soil to be sown again.
 *
 * --- Sprite Stages ---
 * Stage 0 Seedling  -> direction DOWN  (row 0, pattern 0)
 * Stage 1 Sprout    -> direction LEFT  (row 1, pattern 0)
 * Stage 2 Growing   -> direction RIGHT (row 2, pattern 0)
 * Stage 3 Mature    -> direction UP    (row 3, pattern 0)
 *
 * @command PlantMenu
 * @text Plant Menu
 * @desc Harvests a plant already at 100%, otherwise opens the plant interaction menu.
 *
 * @command CheckGrowth
 * @text Check Growth
 * @desc Harvests a plant already at 100%, otherwise opens the full plant management scene.
 *
 * @command PlantSeed
 * @text Plant Seed
 * @desc Silently plants a seed at the calling event without opening the menu.
 *
 * @arg plantId
 * @text Plant
 * @desc Name of the plant to plant (must match a PLANT_DB key exactly).
 * @type combo
 * @option Tomato
 * @option Watermelon
 * @option Wheat
 * @option Pumpkin
 * @option Carrot
 * @option Potato
 * @option Mushroom
 * @option Sunflower
 * @option Strawberry
 * @option Corn
 * @option Lavender
 * @option Onion
 * @option Cabbage
 * @option Eggplant
 * @option Pepper
 * @default Tomato
 *
 * @command HarvestPlant
 * @text Harvest Plant
 * @desc Harvests the plant at the calling event and gives items. Does nothing if no plant is present.
 *
 * @command RemovePlant
 * @text Remove Plant
 * @desc Removes the plant at the calling event without giving any items.
 *
 * @command SetGrowthStage
 * @text Set Growth Stage
 * @desc Forces the plant at the calling event to a specific growth stage.
 *
 * @arg stage
 * @text Stage
 * @desc 0 = Seedling, 1 = Sprout, 2 = Growing, 3 = Mature.
 * @type select
 * @option Seedling (0)
 * @value 0
 * @option Sprout (1)
 * @value 1
 * @option Growing (2)
 * @value 2
 * @option Mature (3)
 * @value 3
 * @default 3
 */

(() => {
  "use strict";

  const pluginName = "PlantGrowthSystem";

  // ============================================================
  //  CONSTANTS
  // ============================================================

  const GAME_TIME_VAR = 114; // Variable storing total game minutes (TimeDateSystem)
  const MINUTES_PER_DAY = 1440;

  // Direction per growth stage: 2=down, 4=left, 6=right, 8=up
  const STAGE_DIRS = [2, 4, 6, 8];
  const stageName = (i) => T.list('PlantGrowth.stage')[i] || '';

  // Weather growth multipliers (applied when in-season)
  const WEATHER_MULT = { none: 1.0, rain: 1.3, storm: 1.1, snow: 0.5 };

  // Greenhouse bonus when map has <Greenhouse> tag
  const GREENHOUSE_MULT = 1.5;


  // ============================================================
  //  PLANT DATABASE
  // ============================================================

  const PLANT_DB = {
    Tomato: { sprite: "Plants/!$Tomato", itemId: 575, cost: 200, seasons: ["SPRING", "SUMMER"], growthDays: 14, yieldMin: 2, yieldMax: 5 },
    Watermelon: { sprite: "Plants/!$Watermelon", itemId: 575, cost: 800, seasons: ["SUMMER"], growthDays: 30, yieldMin: 1, yieldMax: 3 },
    Wheat: { sprite: "Plants/!$Wheat", itemId: 575, cost: 150, seasons: ["SPRING", "SUMMER"], growthDays: 20, yieldMin: 3, yieldMax: 6 },
    Pumpkin: { sprite: "Plants/!$Pumpkin", itemId: 575, cost: 300, seasons: ["AUTUMN"], growthDays: 25, yieldMin: 1, yieldMax: 2 },
    Carrot: { sprite: "Plants/!$Carrot", itemId: 575, cost: 100, seasons: ["SPRING", "AUTUMN"], growthDays: 10, yieldMin: 3, yieldMax: 7 },
    Potato: { sprite: "Plants/!$Potato", itemId: 575, cost: 120, seasons: ["SPRING", "AUTUMN"], growthDays: 12, yieldMin: 4, yieldMax: 8 },
    Mushroom: { sprite: "Plants/!$Mushroom", itemId: 575, cost: 250, seasons: ["AUTUMN", "WINTER"], growthDays: 7, yieldMin: 2, yieldMax: 5 },
    Sunflower: { sprite: "Plants/!$Sunflower", itemId: 575, cost: 200, seasons: ["SUMMER"], growthDays: 15, yieldMin: 2, yieldMax: 4 },
    Strawberry: { sprite: "Plants/!$Strawberry", itemId: 575, cost: 350, seasons: ["SPRING"], growthDays: 18, yieldMin: 3, yieldMax: 8 },
    Corn: { sprite: "Plants/!$Corn", itemId: 575, cost: 400, seasons: ["SUMMER"], growthDays: 25, yieldMin: 2, yieldMax: 5 },
    Lavender: { sprite: "Plants/!$Lavender", itemId: 575, cost: 300, seasons: ["SPRING", "SUMMER"], growthDays: 21, yieldMin: 2, yieldMax: 6 },
    Onion: { sprite: "Plants/!$Onion", itemId: 575, cost: 80, seasons: ["SPRING", "AUTUMN", "WINTER"], growthDays: 10, yieldMin: 4, yieldMax: 8 },
    Cabbage: { sprite: "Plants/!$Cabbage", itemId: 575, cost: 100, seasons: ["SPRING", "AUTUMN"], growthDays: 15, yieldMin: 2, yieldMax: 5 },
    Eggplant: { sprite: "Plants/!$Eggplant", itemId: 575, cost: 250, seasons: ["SUMMER"], growthDays: 20, yieldMin: 2, yieldMax: 4 },
    Pepper: { sprite: "Plants/!$Pepper", itemId: 193, cost: 200, seasons: ["SUMMER"], growthDays: 18, yieldMin: 3, yieldMax: 6 },
    Ananas: { sprite: "Plants/!$Ananas", itemId: 575, cost: 600, seasons: ["SUMMER"], growthDays: 28, yieldMin: 1, yieldMax: 2 },
    Grapes: { sprite: "Plants/!$Grapes", itemId: 575, cost: 300, seasons: ["SUMMER", "AUTUMN"], growthDays: 22, yieldMin: 4, yieldMax: 8 },
    Cactus: { sprite: "Plants/!$Cactus", itemId: 575, cost: 150, seasons: ["SUMMER"], growthDays: 35, yieldMin: 1, yieldMax: 3 },
    Beanstalk: { sprite: "Plants/!$Beanstalk", itemId: 575, cost: 1000, seasons: ["SPRING", "SUMMER"], growthDays: 45, yieldMin: 5, yieldMax: 10 }
  };

  // ============================================================
  //  HELPERS
  // ============================================================

  function plantKey(mapId, eventId) {
    return `${mapId}_${eventId}`;
  }

  function getRecord(mapId, eventId) {
    const tile = procTileForEvent(mapId, eventId);
    if (tile) return procGetTile(tile);
    if (!$gameSystem._plantData) $gameSystem._plantData = {};
    return $gameSystem._plantData[plantKey(mapId, eventId)] || null;
  }

  function saveRecord(mapId, eventId, rec) {
    const tile = procTileForEvent(mapId, eventId);
    if (tile) {
      // Procedural plots live in the world folder, keyed by tile: the event ids
      // they are injected under change from visit to visit.
      procSaveTile(tile, rec);
      return;
    }
    if (!$gameSystem._plantData) $gameSystem._plantData = {};
    $gameSystem._plantData[plantKey(mapId, eventId)] = rec;
    updateSelfSwitch(mapId, eventId, rec);
  }

  function updateSelfSwitch(mapId, eventId, rec) {
    if (!$gameSelfSwitches) return;
    // Injected procedural plots must never write a self switch: their event ids
    // are recycled by whatever the next visit injects into map 636.
    if (procTileForEvent(mapId, eventId)) return;
    const isGrowing = !!(rec && !rec.removed && rec.plantId);
    $gameSelfSwitches.setValue([mapId, eventId, "A"], !isGrowing);
  }

  function gameMinutes() {
    return ($gameVariables ? $gameVariables.value(GAME_TIME_VAR) : 0) || 0;
  }

  // Canonical world-RNG root (HistorySimulator seed) so procedural gardens are
  // reproducible across reloads instead of rolling fresh Math.random() each time.
  function worldSeed() {
    try {
      if (window.HistoryManager && typeof window.HistoryManager.getSeed === "function") {
        return window.HistoryManager.getSeed() >>> 0;
      }
    } catch (e) {}
    return 19002001;
  }

  // Deterministic 0..1 value from the world seed plus a set of integer inputs.
  function seededUnit(...ints) {
    let h = worldSeed() >>> 0;
    for (const n of ints) {
      h = Math.imul(h ^ (n >>> 0), 0x01000193) >>> 0;
    }
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function currentSeason() {
    if ($gameWeather && typeof $gameWeather.getSeason === "function") {
      return $gameWeather.getSeason();
    }
    const dateStr = ($gameVariables && $gameVariables.value(113)) || "01 JAN 2001 12:00";
    const parts = dateStr.split(" ").filter(Boolean);
    const monthStr = (parts[1] || "JAN").toUpperCase();
    const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    let m = MONTHS.indexOf(monthStr);
    if (m === -1) {
      const itMonths = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
      m = itMonths.indexOf(monthStr);
    }
    if (m === -1) {
      m = 0;
    }
    if (m >= 2 && m <= 4) return "SPRING";
    if (m >= 5 && m <= 7) return "SUMMER";
    if (m >= 8 && m <= 10) return "AUTUMN";
    return "WINTER";
  }

  function currentWeather() {
    return ($gameWeather && $gameWeather.currentWeatherType) || "none";
  }

  function isGreenhouse() {
    return !!($dataMap && $dataMap.note && $dataMap.note.includes("<Greenhouse>"));
  }

  function growthMult(greenhouse) {
    if (greenhouse) return GREENHOUSE_MULT;
    return WEATHER_MULT[currentWeather()] ?? 1.0;
  }

  function calcStage(effectiveMins, growthDays) {
    const ratio = Math.min(effectiveMins / (growthDays * MINUTES_PER_DAY), 1.0);
    if (ratio >= 1.0) return 3;
    return Math.floor(ratio * 4);
  }

  function calcProgress(effectiveMins, growthDays) {
    return Math.min(effectiveMins / (growthDays * MINUTES_PER_DAY), 1.0);
  }

  function calcYield(def, effectiveMins) {
    const r = calcProgress(effectiveMins, def.growthDays);
    const base = Math.max(def.yieldMin,
      Math.round(def.yieldMin + (def.yieldMax - def.yieldMin) * r));
    // A trained farmer in the party brings more off the same plot (the best
    // Farming level anyone has - see window.SpecializationXP).
    const skill = window.SpecializationXP
      ? window.SpecializationXP.multiplier("Farming", 0.12) : 1;
    return Math.max(1, Math.round(base * skill));
  }

  // Working a plot is how the party learns to farm: sowing and harvesting both
  // count, and the first few goes are enough to leave Untrained behind.
  function trainFarming(points) {
    if (window.SpecializationXP) window.SpecializationXP.award("Farming", points || 1);
  }

  function isPlantEvent(event) {
    // Cached per event (event names are static per map) so the per-frame
    // Game_Event.update hook doesn't lowercase the name every call.
    if (event._isPlantEvt !== undefined) return event._isPlantEvt;
    if (!$dataMap || !$dataMap.events) return false;
    const data = $dataMap.events[event._eventId];
    event._isPlantEvt = !!(data && (data.name || "").toLowerCase() === "plant");
    return event._isPlantEvt;
  }

  function getPresetPlantId(eventId) {
    if (!$dataMap || !$dataMap.events) return null;
    const evData = $dataMap.events[eventId];
    if (!evData) return null;
    const plantNames = Object.keys(PLANT_DB);
    for (const page of evData.pages || []) {
      for (const cmd of page.list || []) {
        if (cmd.code !== 108 && cmd.code !== 408) continue;
        const text = (cmd.parameters[0] || "").trim();
        const match = plantNames.find((id) => id.toLowerCase() === text.toLowerCase());
        if (match) return match;
      }
    }
    return null;
  }

  function maybeInitPresetPlant(mapId, eventId) {
    if (getRecord(mapId, eventId)) return;
    const plantId = getPresetPlantId(eventId);
    if (!plantId) return;
    const def = PLANT_DB[plantId];
    const now = gameMinutes();
    // Deterministic per-plant roll (seeded by world seed + map/event) so preset
    // gardens reproduce identically instead of randomizing on every fresh load.
    const stage = Math.floor(seededUnit(mapId, eventId, 1) * 4);
    const lo = stage / 4;
    const hi = (stage + 1) / 4;
    const ratio = lo + seededUnit(mapId, eventId, 2) * (hi - lo);
    const effectiveMins = ratio * def.growthDays * MINUTES_PER_DAY;
    saveRecord(mapId, eventId, {
      plantId,
      plantedAt: now,
      lastUpdateMinutes: now,
      effectiveGrowthMinutes: effectiveMins,
      stage: calcStage(effectiveMins, def.growthDays),
      removed: false,
    });
  }

  // ============================================================
  //  PROCEDURAL MAP PLOTS (map 636)
  // ============================================================
  // Tilled soil generated on the procedural map (see placeTilledFields in
  // ProceduralMapBiomeGenerator) is farmable. On the first visit to a world
  // coordinate every contiguous patch of tilled soil rolls, from the world
  // seed, whether it holds a crop and which one, so a whole field grows the
  // same plant. The plots themselves are stored in the ACTIVE WORLD FOLDER
  // (save/worlds/<name>/plants.json) keyed by proc-map key + tile, so a field
  // sown, grown or harvested in one savegame is the same field in every other
  // savegame of that world.
  //
  // A plot that holds a plant gets a "Plant" event injected on top of it (the
  // sprite and the usual plant menu); an empty plot has no event and is opened
  // through the terrain interaction menu (ProceduralTerrainInteractions).

  const PROC_MAP_ID = 636;
  const PROC_PATCH_SOWN_CHANCE = 0.6;  // patches of tilled soil that hold a crop
  const PROC_TILE_SOWN_CHANCE = 0.85;  // tiles of a sown patch that hold a plant
  const PROC_MAX_PLANT_EVENTS = 200;   // hard ceiling on injected plant events

  // eventId -> "x,y" for the plant events injected into the current proc map.
  let _procTileByEvent = {};
  // The $dataMap the events above were injected into, plus the map key they
  // were spawned for, so rebuilding Scene_Map never injects a second copy.
  let _procSpawnedData = null;
  let _procSpawnedKey = null;

  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // Composite per-coordinate key (biome + world coordinate + depth), the same
  // one the furniture and terrain systems use, so plots track the exact world
  // tile they were sown on.
  function procMapKey() {
    if (window.FurnitureSystem && typeof window.FurnitureSystem.furnitureMapKey === "function") {
      return String(window.FurnitureSystem.furnitureMapKey());
    }
    return String($gameMap ? $gameMap.mapId() : 0);
  }

  // save/worlds/<name>/plants.json:
  //   { plots: { "<mapKey>": { "x,y": record } }, seeded: { "<mapKey>": true } }
  function procStore() {
    if (!window.WorldManager || typeof window.WorldManager.getFile !== "function") return null;
    const store = window.WorldManager.getFile("plants");
    if (!store.plots) store.plots = {};
    if (!store.seeded) store.seeded = {};
    return store;
  }

  function procPlots(create) {
    const store = procStore();
    if (!store) return null;
    const key = procMapKey();
    if (!store.plots[key] && create) store.plots[key] = {};
    return store.plots[key] || null;
  }

  // Flush immediately so other savegames in the same world see the change even
  // before the next in-game save.
  function procFlush() {
    if (!window.WorldManager || typeof window.WorldManager.flush !== "function") return;
    try { window.WorldManager.flush(); } catch (e) { /* non-fatal */ }
  }

  function procTileForEvent(mapId, eventId) {
    if (mapId !== PROC_MAP_ID) return null;
    return _procTileByEvent[eventId] || null;
  }

  function procGetTile(tileKey) {
    const plots = procPlots(false);
    return (plots && plots[tileKey]) || null;
  }

  function procSaveTile(tileKey, rec) {
    const plots = procPlots(true);
    if (plots) plots[tileKey] = rec;
  }

  // Takes the injected event off the map for good. Erasing it would leave it
  // standing on the tile (an erased event still occupies its square), which
  // would keep the terrain menu from re-opening the plot, so the event is
  // dropped from the map and from the loaded map data instead.
  function removeProcPlantEvent(eventId) {
    if (!eventId || !$gameMap) return;
    const ev = $gameMap._events ? $gameMap._events[eventId] : null;
    if (ev) {
      ev.setImage("", 0);
      ev.setOpacity(0);
      ev.setThrough(true);
    }
    if ($gameMap._events) $gameMap._events[eventId] = undefined;
    if ($dataMap && $dataMap.events) $dataMap.events[eventId] = null;
  }

  // Forget a plot entirely (harvested / cleared): the soil goes back to being
  // an empty tilled tile the player can sow again.
  function procClearTile(tileKey, eventId) {
    const plots = procPlots(false);
    if (plots) delete plots[tileKey];
    if (eventId) {
      delete _procTileByEvent[eventId];
      if ($gameMap && $gameMap.mapId() === PROC_MAP_ID) removeProcPlantEvent(eventId);
    }
    procFlush();
  }

  // Same, for a plot reached through its injected event. Returns false for a
  // hand-authored plant event (which keeps its record and its event).
  function clearProcPlot(mapId, eventId) {
    const tile = procTileForEvent(mapId, eventId);
    if (!tile) return false;
    procClearTile(tile, eventId);
    return true;
  }

  // Every tile id the current tileset tags as TilledSoil.
  function tilledTileIds() {
    const U = window.ProcGenUtils;
    const tileset = $gameMap ? $gameMap.tileset() : null;
    if (!U || !U.Cache || !tileset) return null;
    const variants = U.Cache.getTilesetFeatures(tileset.id)["TilledSoil"];
    if (!variants || !variants.length) return null;
    const ids = new Set();
    for (const v of variants) {
      if (v.type === "single" && v.tileId) ids.add(v.tileId);
      else if (v.type === "grid" && v.grid) {
        for (const row of v.grid) for (const tid of row) if (tid) ids.add(tid);
      }
    }
    return ids.size ? ids : null;
  }

  function isTilledTile(x, y, ids) {
    for (const z of [2, 3]) {
      if (ids.has($gameMap.tileId(x, y, z))) return true;
    }
    return false;
  }

  function scanTilledTiles(ids) {
    const tiles = [];
    const w = $gameMap.width();
    const h = $gameMap.height();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isTilledTile(x, y, ids)) tiles.push({ x, y });
      }
    }
    return tiles;
  }

  // Contiguous (4-neighbour) groups of tilled tiles: one crop type per group.
  function tilledPatches(tiles) {
    const open = new Set(tiles.map(t => `${t.x},${t.y}`));
    const patches = [];
    for (const t of tiles) {
      const start = `${t.x},${t.y}`;
      if (!open.has(start)) continue;
      const patch = [];
      const stack = [t];
      open.delete(start);
      while (stack.length) {
        const cur = stack.pop();
        patch.push(cur);
        const around = [
          { x: cur.x - 1, y: cur.y }, { x: cur.x + 1, y: cur.y },
          { x: cur.x, y: cur.y - 1 }, { x: cur.x, y: cur.y + 1 },
        ];
        for (const n of around) {
          const nk = `${n.x},${n.y}`;
          if (!open.has(nk)) continue;
          open.delete(nk);
          stack.push(n);
        }
      }
      patches.push(patch);
    }
    return patches;
  }

  // First visit to this world coordinate: roll what grows in each field.
  function seedProcPlots(tiles) {
    const store = procStore();
    if (!store) return;
    const key = procMapKey();
    const plots = procPlots(true);
    if (!plots) return;
    const keyHash = hashStr(key);
    const now = gameMinutes();
    const plantIds = Object.keys(PLANT_DB);

    for (const patch of tilledPatches(tiles)) {
      const anchor = patch[0];
      if (seededUnit(keyHash, anchor.x, anchor.y, 11) > PROC_PATCH_SOWN_CHANCE) continue; // left fallow
      const plantId = plantIds[Math.floor(seededUnit(keyHash, anchor.x, anchor.y, 12) * plantIds.length)];
      const def = PLANT_DB[plantId];
      if (!def) continue;
      // One sowing date for the whole field, jittered a little per plant.
      const patchRatio = 0.1 + seededUnit(keyHash, anchor.x, anchor.y, 13) * 0.9;

      for (const t of patch) {
        const tileKey = `${t.x},${t.y}`;
        if (plots[tileKey]) continue;
        if (seededUnit(keyHash, t.x, t.y, 14) > PROC_TILE_SOWN_CHANCE) continue; // gap in the rows
        const jitter = (seededUnit(keyHash, t.x, t.y, 15) - 0.5) * 0.2;
        const ratio = Math.max(0.02, Math.min(1, patchRatio + jitter));
        const effectiveMins = ratio * def.growthDays * MINUTES_PER_DAY;
        plots[tileKey] = {
          plantId,
          plantedAt: Math.max(0, now - Math.round(effectiveMins)),
          lastUpdateMinutes: now,
          effectiveGrowthMinutes: effectiveMins,
          stage: calcStage(effectiveMins, def.growthDays),
          removed: false,
        };
      }
    }

    store.seeded[key] = true;
    procFlush();
  }

  // A "Plant" event carrying the same plugin command the hand-authored plant
  // events use, injected straight into the loaded map data.
  function injectPlantEvent(x, y, tileKey) {
    if (!$dataMap || !$dataMap.events || !$gameMap) return null;
    const id = $dataMap.events.length;
    $dataMap.events[id] = {
      id, name: "Plant", note: "", x, y,
      pages: [{
        conditions: {
          actorId: 1, actorValid: false, itemId: 1, itemValid: false,
          selfSwitchCh: "A", selfSwitchValid: false,
          switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
          variableId: 1, variableValid: false, variableValue: 0,
        },
        directionFix: true,
        image: { tileId: 0, characterName: "", characterIndex: 0, direction: 2, pattern: 0 },
        list: [
          { code: 357, indent: 0, parameters: ["Farming/PlantGrowthSystem", "PlantMenu", "Plant Menu", {}] },  // i18n-ignore  plugin command id
          { code: 0, indent: 0, parameters: [] },
        ],
        moveFrequency: 3,
        moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
        moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false,
        trigger: 0, walkAnime: false,
      }],
    };
    // Registered BEFORE the event is built: Game_Event's constructor refreshes
    // the page, and the sprite hook resolves the record through this map.
    _procTileByEvent[id] = tileKey;
    const ev = new Game_Event($gameMap.mapId(), id);
    ev._procPlantTile = tileKey;
    $gameMap._events[id] = ev;
    return ev;
  }

  // The event standing on a plot, injecting one if the plot has just been sown.
  function ensureProcPlantEvent(tileKey) {
    if (!$gameMap || $gameMap.mapId() !== PROC_MAP_ID) return null;
    for (const id of Object.keys(_procTileByEvent)) {
      if (_procTileByEvent[id] !== tileKey) continue;
      const ev = $gameMap.event(Number(id));
      if (ev) return ev;
    }
    const [x, y] = tileKey.split(",").map(Number);
    if (isNaN(x) || isNaN(y)) return null;
    return injectPlantEvent(x, y, tileKey);
  }

  function spawnProcPlantEvents(ids) {
    const plots = procPlots(false);
    if (!plots) return;
    let count = 0;
    for (const tileKey of Object.keys(plots)) {
      const rec = plots[tileKey];
      if (!rec || rec.removed || !rec.plantId) continue;
      const [x, y] = tileKey.split(",").map(Number);
      if (isNaN(x) || isNaN(y)) continue;
      // The soil itself is gone (dismantled, or the tile no longer generates as
      // a field): the plot goes with it.
      if (!isTilledTile(x, y, ids)) { delete plots[tileKey]; continue; }
      if ($gameMap.eventsXy(x, y).length > 0) continue; // never stack on a real event
      if (count >= PROC_MAX_PLANT_EVENTS) break;
      if (injectPlantEvent(x, y, tileKey)) count++;
    }
  }

  function setupProcPlots() {
    if (!$gameMap || $gameMap.mapId() !== PROC_MAP_ID || !$dataMap) return;
    const key = procMapKey();
    if (_procSpawnedData === $dataMap && _procSpawnedKey === key) return;
    _procTileByEvent = {};
    _procSpawnedData = $dataMap;
    _procSpawnedKey = key;

    // Features the player already removed here are cleared first, so soil that
    // was picked up never sprouts a plant again.
    if (window.TerrainInteractions && typeof window.TerrainInteractions.applyDismantledToMap === "function") {
      try { window.TerrainInteractions.applyDismantledToMap(); } catch (e) { /* non-fatal */ }
    }

    const ids = tilledTileIds();
    if (!ids) return;
    const tiles = scanTilledTiles(ids);
    if (!tiles.length) return;

    const store = procStore();
    if (store && !store.seeded[key]) seedProcPlots(tiles);
    spawnProcPlantEvents(ids);
  }

  // Opens the growth menu for a procedural plot by tile, with or without a
  // plant on it. Called by ProceduralTerrainInteractions when the player faces
  // tilled soil that carries no plant event.
  function openProceduralPlot(x, y) {
    if (!$gameMap || $gameMap.mapId() !== PROC_MAP_ID) return;
    if (!procStore()) return; // no world folder: nothing could be remembered
    const tileKey = `${x},${y}`;
    const ev = $gameMap.eventsXy(x, y).find(e => e && e._procPlantTile === tileKey);
    const eventId = ev ? ev.eventId() : 0;
    if (eventId) updateGrowth(PROC_MAP_ID, eventId);
    const rec = procGetTile(tileKey);
    if (isRipe(rec)) {
      harvestPlot(PROC_MAP_ID, eventId, tileKey, rec);
      return;
    }
    const args = { mapId: PROC_MAP_ID, eventId, tile: tileKey, rec };
    if (rec && !rec.removed && rec.plantId) {
      Scene_PlantMenu._openArgs = args;
      SceneManager.push(Scene_PlantMenu);
    } else {
      Scene_PlantQuickMenu._openArgs = args;
      SceneManager.push(Scene_PlantQuickMenu);
    }
  }

  // ============================================================
  //  GROWTH UPDATE
  // ============================================================

  function updateGrowth(mapId, eventId) {
    const rec = getRecord(mapId, eventId);
    if (!rec || rec.removed || !rec.plantId) return;
    const def = PLANT_DB[rec.plantId];
    if (!def) return;

    const now = gameMinutes();
    const elapsed = now - rec.lastUpdateMinutes;
    if (elapsed <= 0) {
      // Time went backwards (e.g. a reset time variable). Resync the baseline so the
      // plant does not stay frozen until game time climbs back past the old value.
      if (elapsed < 0) {
        rec.lastUpdateMinutes = now;
        saveRecord(mapId, eventId, rec);
      }
      return;
    }

    const greenhouse = isGreenhouse();
    const inSeason = greenhouse || def.seasons.includes(currentSeason());

    if (inSeason) {
      rec.effectiveGrowthMinutes += elapsed * growthMult(greenhouse);
    }
    rec.lastUpdateMinutes = now;
    rec.stage = calcStage(rec.effectiveGrowthMinutes, def.growthDays);
    saveRecord(mapId, eventId, rec);
  }

  // A plot standing at 100% is simply picked: interacting with a ripe plant
  // harvests it where it stands rather than opening the growth menu, which has
  // nothing left to tell the player about it.
  function isRipe(rec) {
    if (!rec || rec.removed || !rec.plantId) return false;
    const def = PLANT_DB[rec.plantId];
    if (!def) return false;
    return calcProgress(rec.effectiveGrowthMinutes, def.growthDays) >= 1.0;
  }

  // The same harvest Scene_PlantMenu performs, with no scene to pop: the plot
  // pays out, is emptied and (procedurally) goes back to bare tilled soil.
  function harvestPlot(mapId, eventId, tile, rec) {
    const def = PLANT_DB[rec.plantId];
    const item = def ? $dataItems[def.itemId] : null;
    if (item) {
      const qty = calcYield(def, rec.effectiveGrowthMinutes);
      $gameParty.gainItem(item, qty);
      trainFarming(2);
      SoundManager.playShop();
      window.skipLocalization = true;
      $gameMessage.add(T('PlantGrowth.harvested', { icon: item.iconIndex, item: item.name, qty: qty }));
      window.skipLocalization = false;
      // The party's own record of what it did (Diary.js).
      if (window.Diary) window.Diary.onHarvested(item.name);
    }

    rec.removed = true;
    rec.plantId = null;
    rec.stage = 0;
    if (tile) procSaveTile(tile, rec);
    else saveRecord(mapId, eventId, rec);
    const ev = eventId ? $gameMap.event(eventId) : null;
    if (ev) applySprite(ev, rec);
    if (tile) procClearTile(tile, eventId);
  }

  function applySprite(event, rec) {
    if (!rec || rec.removed || !rec.plantId) {
      event.setImage("", 0);
      return;
    }
    const def = PLANT_DB[rec.plantId];
    if (!def) return;
    event.setImage(def.sprite, 0);
    event._direction = STAGE_DIRS[rec.stage] || 2;  // bypass setDirection's directionFix guard
    event._directionFix = false;
    event.setWalkAnime(false);
    event.setStepAnime(false);
    event._pattern = 0;
  }

  function refreshMapPlants() {
    if (!$gameMap || !$gameSystem) return;
    const mapId = $gameMap.mapId();
    for (const ev of $gameMap.events()) {
      if (!ev || !isPlantEvent(ev)) continue;
      maybeInitPresetPlant(mapId, ev._eventId);
      updateGrowth(mapId, ev._eventId);
      const rec = getRecord(mapId, ev._eventId);
      applySprite(ev, rec);
      updateSelfSwitch(mapId, ev._eventId, rec);
    }
  }

  // ============================================================
  //  HOOKS
  // ============================================================

  // Tracks the last in-game minute plants were ticked, so the on-map update below can
  // advance growth without re-processing every frame.
  let _lastPlantTickMinute = -1;

  // Leaving the procedural map drops the injected-plot bookkeeping, so coming
  // back to a world square always rebuilds its fields from the world folder.
  const _Game_Map_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    _Game_Map_setup.call(this, mapId);
    if (mapId !== PROC_MAP_ID) {
      _procTileByEvent = {};
      _procSpawnedData = null;
      _procSpawnedKey = null;
    }
  };

  // Procedural plots are injected here: the transfer has been performed (map
  // data and events are current) but the spriteset does not exist yet, so the
  // plant sprites are created like any other event's. Running on every
  // Scene_Map build (guarded against a second injection) also covers loading a
  // savegame made while standing in a field.
  const _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
  Scene_Map.prototype.createDisplayObjects = function () {
    try {
      setupProcPlots();
    } catch (e) {
      console.error("[PlantGrowthSystem] procedural plot setup failed", e);
    }
    _Scene_Map_createDisplayObjects.call(this);
  };

  // Injected plots are not in the map data a load rebuilds from, so the ones
  // restored with the savegame are dropped and re-injected from the world
  // folder when the map is displayed again.
  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    _procTileByEvent = {};
    _procSpawnedData = null;
    _procSpawnedKey = null;
    if ($gameMap && $gameMap._events) {
      for (let i = 0; i < $gameMap._events.length; i++) {
        const ev = $gameMap._events[i];
        if (ev && ev._procPlantTile) $gameMap._events[i] = undefined;
      }
    }
  };

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    _Scene_Map_onMapLoaded.call(this);
    _lastPlantTickMinute = gameMinutes();
    refreshMapPlants();
  };

  // Tick plants while the player stays on the map (growth previously only advanced on
  // map load and interaction). Throttled to once per in-game minute to stay cheap.
  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);
    const nowMin = gameMinutes();
    if (nowMin !== _lastPlantTickMinute) {
      _lastPlantTickMinute = nowMin;
      refreshMapPlants();
    }
  };

  const _Game_Event_update = Game_Event.prototype.update;
  Game_Event.prototype.update = function (sceneActive) {
    _Game_Event_update.call(this, sceneActive);
    if (!isPlantEvent(this)) return;
    // Cache the record key (stable per event) and only write when changed,
    // to keep this per-frame hook allocation-free. Procedural plots read their
    // record straight out of the world-folder store, by tile.
    if (this._plantRecKey === undefined) {
      this._plantRecKey = plantKey($gameMap.mapId(), this._eventId);
    }
    let rec;
    if (this._procPlantTile) {
      rec = procGetTile(this._procPlantTile);
    } else {
      const data = $gameSystem._plantData;
      rec = data ? data[this._plantRecKey] : null;
    }
    if (rec && !rec.removed && rec.plantId) {
      const dir = STAGE_DIRS[rec.stage] || 2;
      if (this._direction !== dir) this._direction = dir;
      if (this._pattern !== 0) this._pattern = 0;
    }
  };

  // Hook setupPageSettings ,  the exact moment RPG Maker writes image+direction from
  // the page data. Overriding here wins regardless of how many refreshes fire.
  const _Game_Event_setupPageSettings = Game_Event.prototype.setupPageSettings;
  Game_Event.prototype.setupPageSettings = function () {
    _Game_Event_setupPageSettings.call(this);
    if (!$gameMap || !isPlantEvent(this)) return;
    // Rebuilt event objects (re-entering a world square whose map data is still
    // loaded) lose the tile marker, so restore it from the injection map.
    const tile = procTileForEvent($gameMap.mapId(), this._eventId);
    if (tile) this._procPlantTile = tile;
    const rec = getRecord($gameMap.mapId(), this._eventId);
    if (rec && !rec.removed && rec.plantId) applySprite(this, rec);
  };

  // Prevent lock() from turning the plant to face the player on interaction.
  const _Game_Event_lock = Game_Event.prototype.lock;
  Game_Event.prototype.lock = function () {
    if (isPlantEvent(this)) return;
    _Game_Event_lock.call(this);
  };

  // ============================================================
  //  PLUGIN COMMANDS
  // ============================================================

  PluginManager.registerCommand(pluginName, "PlantMenu", function () {
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    updateGrowth(mapId, eventId);
    const rec = getRecord(mapId, eventId);
    const tile = procTileForEvent(mapId, eventId);
    if (isRipe(rec)) {
      harvestPlot(mapId, eventId, tile, rec);
      return;
    }
    if (rec && !rec.removed && rec.plantId) {
      Scene_PlantMenu._openArgs = { mapId, eventId, tile, rec };
      SceneManager.push(Scene_PlantMenu);
    } else {
      Scene_PlantQuickMenu._openArgs = { mapId, eventId, tile, rec };
      SceneManager.push(Scene_PlantQuickMenu);
    }
  });

  PluginManager.registerCommand(pluginName, "CheckGrowth", function () {
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    updateGrowth(mapId, eventId);
    const rec = getRecord(mapId, eventId);
    const tile = procTileForEvent(mapId, eventId);
    if (isRipe(rec)) {
      harvestPlot(mapId, eventId, tile, rec);
      return;
    }
    Scene_PlantMenu._openArgs = { mapId, eventId, tile, rec };
    SceneManager.push(Scene_PlantMenu);
  });

  PluginManager.registerCommand(pluginName, "PlantSeed", function (args) {
    const plantId = String(args.plantId || "").trim();
    if (!PLANT_DB[plantId]) return;
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    const now = gameMinutes();
    saveRecord(mapId, eventId, { plantId, plantedAt: now, lastUpdateMinutes: now, effectiveGrowthMinutes: 0, stage: 0, removed: false });
    if (procTileForEvent(mapId, eventId)) procFlush();
    const ev = $gameMap.event(eventId);
    if (ev) applySprite(ev, getRecord(mapId, eventId));
    if (window.Diary) window.Diary.onSown(PLANT_DB[plantId].name || plantId);
  });

  PluginManager.registerCommand(pluginName, "HarvestPlant", function () {
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    updateGrowth(mapId, eventId);
    const rec = getRecord(mapId, eventId);
    if (!rec || rec.removed || !rec.plantId) return;
    const def = PLANT_DB[rec.plantId];
    const item = $dataItems[def.itemId];
    if (item && rec.stage >= 2) {
      const qty = calcYield(def, rec.effectiveGrowthMinutes);
      $gameParty.gainItem(item, qty);
      trainFarming(2);
      window.skipLocalization = true;
      $gameMessage.add(T('PlantGrowth.harvested', { icon: item.iconIndex, item: item.name, qty: qty }));
      window.skipLocalization = false;
      // The party's own record of what it did (Diary.js).
      if (window.Diary) window.Diary.onHarvested(item.name);
    }
    rec.removed = true;
    rec.plantId = null;
    rec.stage = 0;
    saveRecord(mapId, eventId, rec);
    const ev = $gameMap.event(eventId);
    if (ev) applySprite(ev, rec);
    clearProcPlot(mapId, eventId);
  });

  PluginManager.registerCommand(pluginName, "RemovePlant", function () {
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    const rec = getRecord(mapId, eventId);
    if (!rec || rec.removed || !rec.plantId) return;
    rec.removed = true;
    rec.plantId = null;
    rec.stage = 0;
    saveRecord(mapId, eventId, rec);
    const ev = $gameMap.event(eventId);
    if (ev) applySprite(ev, rec);
    clearProcPlot(mapId, eventId);
  });

  PluginManager.registerCommand(pluginName, "SetGrowthStage", function (args) {
    const stage = Number(args.stage ?? 3);
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    updateGrowth(mapId, eventId);
    const rec = getRecord(mapId, eventId);
    if (!rec || rec.removed || !rec.plantId) return;
    const def = PLANT_DB[rec.plantId];
    const midRatio = (stage + 0.5) / 4;
    rec.effectiveGrowthMinutes = Math.min(midRatio * def.growthDays * MINUTES_PER_DAY, def.growthDays * MINUTES_PER_DAY);
    rec.stage = calcStage(rec.effectiveGrowthMinutes, def.growthDays);
    saveRecord(mapId, eventId, rec);
    const ev = $gameMap.event(eventId);
    if (ev) applySprite(ev, rec);
  });

  // ============================================================
  //  MANUAL & PANEL LAYOUT INTERFACE SYSTEMS
  // ============================================================

  function loadUIResources() {

  }

  function iconHtml(iconIndex) {
    const x = (iconIndex % 16) * 32;
    const y = Math.floor(iconIndex / 16) * 32;
    return `<span style="background:url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width:32px; height:32px; display:inline-block; transform:scale(0.75); image-rendering:pixelated; flex-shrink:0;"></span>`;
  }

  class UIPlantInputManager {
    static init(container) {
      this.container = container;
      this.activeElements = [];
      this.focusIndex = 0;
      this.active = false;
      this.cols = 1;
    }

    static activate(cols = 1) {
      this.activeElements = Array.from(this.container.querySelectorAll('.focusable'));
      this.focusIndex = 0;
      this.cols = cols;
      this.active = true;
      this.updateFocus();
    }

    static deactivate() {
      this.active = false;
    }

    static update() {
      if (!this.active || this.activeElements.length === 0) return;

      let moved = false;
      const len = this.activeElements.length;

      if (Input.isTriggered('down') || Input.isRepeated('down')) {
        if (this.focusIndex + this.cols < len) {
          this.focusIndex += this.cols;
        } else {
          this.focusIndex = this.focusIndex % this.cols;
        }
        moved = true;
      } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
        if (this.focusIndex - this.cols >= 0) {
          this.focusIndex -= this.cols;
        } else {
          let target = Math.floor((len - 1) / this.cols) * this.cols + (this.focusIndex % this.cols);
          if (target >= len) target -= this.cols;
          this.focusIndex = target >= 0 ? target : 0;
        }
        moved = true;
      } else if (Input.isTriggered('right') || Input.isRepeated('right')) {
        if (this.focusIndex % this.cols < this.cols - 1 && this.focusIndex + 1 < len) {
          this.focusIndex += 1;
          moved = true;
        }
      } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
        if (this.focusIndex % this.cols > 0) {
          this.focusIndex -= 1;
          moved = true;
        }
      } else if (Input.isTriggered('ok')) {
        SoundManager.playOk();
        const el = this.activeElements[this.focusIndex];
        if (el) el.click();
      } else if (Input.isTriggered('cancel')) {
        SoundManager.playCancel();
        SceneManager._scene.popScene();
      }

      if (moved) {
        SoundManager.playCursor();
        this.updateFocus();
      }
    }

    static updateFocus() {
      this.activeElements.forEach((el, idx) => {
        if (idx === this.focusIndex) {
          el.classList.add('selected');
          el.scrollIntoView({ block: 'nearest' });
          if (typeof SceneManager._scene.onUIFocusChange === 'function') {
            SceneManager._scene.onUIFocusChange(el);
          }
        } else {
          el.classList.remove('selected');
        }
      });
    }
  }

  // Header line of a plot panel: a hand-authored plot is named by its event, a
  // procedural one by the tile it occupies on the current world square.
  function plotLabel(mapId, eventId, tile) {
    if (tile) {
      const [x, y] = String(tile).split(",");
      return T('PlantGrowth.fieldPlot', { x: x, y: y });
    }
    return T('PlantGrowth.mapPlot', { map: mapId, plot: eventId });
  }

  function drawUIPlantSprite(plantId, stage, canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const def = PLANT_DB[plantId];
    if (!def) return;
    const bitmap = ImageManager.loadCharacter(def.sprite);
    const drawSprite = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      const isBig = ImageManager.isBigCharacter(def.sprite);
      const pw = bitmap.width / (isBig ? 3 : 12);
      const ph = bitmap.height / (isBig ? 4 : 8);
      const sx = 0;
      const sy = stage * ph;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / pw, canvas.height / ph, 2.5);
      const dx = Math.floor((canvas.width - pw * scale) / 2);
      const dy = Math.floor(canvas.height - ph * scale);

      ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, dx, dy, pw * scale, ph * scale);
    };

    if (bitmap.isReady()) {
      drawSprite();
    } else {
      bitmap.addLoadListener(drawSprite);
    }
  }

  // ============================================================
  //  SCENE: Plant Menu (D&D Parchment Double-Page Pockets)
  // ============================================================

  class Scene_PlantMenu extends Scene_MenuBase {
    initialize() {
      super.initialize();
      const a = Scene_PlantMenu._openArgs || {};
      this._mapId = a.mapId || 0;
      this._eventId = a.eventId || 0;
      this._tile = a.tile || null;
      this._rec = a.rec || null;
    }

    create() {
      super.create();
      // Name the skill this menu runs on while it is open.
      if (window.SpecBadge) window.SpecBadge.show('Farming');  // i18n-ignore  Specialization.json id
      this.createUIMenuDOM();
    }

    _hasPlant() {
      return !!(this._rec && !this._rec.removed && this._rec.plantId);
    }

    _plotLabel() {
      return plotLabel(this._mapId, this._eventId, this._tile);
    }

    _onHarvest() {
      if (!this._hasPlant()) return;
      const rec = this._rec;
      const def = PLANT_DB[rec.plantId];
      const item = $dataItems[def.itemId];
      if (item && rec.stage >= 2) {
        const qty = calcYield(def, rec.effectiveGrowthMinutes);
        $gameParty.gainItem(item, qty);
        trainFarming(2);
        SoundManager.playShop();
        window.skipLocalization = true;
        $gameMessage.add(T('PlantGrowth.harvested', { icon: item.iconIndex, item: item.name, qty: qty }));
        window.skipLocalization = false;
        // The party's own record of what it did (Diary.js).
        if (window.Diary) window.Diary.onHarvested(item.name);
      }

      rec.removed = true;
      rec.plantId = null;
      rec.stage = 0;
      this._emptyPlot(rec);
      this.popScene();
    }

    _onRemove() {
      if (!this._hasPlant()) return;
      const rec = this._rec;
      rec.removed = true;
      rec.plantId = null;
      rec.stage = 0;
      this._emptyPlot(rec);
      SoundManager.playCancel();
      this.popScene();
    }

    // Writes the emptied plot back. A procedural plot then loses its injected
    // event and goes back to being bare tilled soil the player can sow again.
    _emptyPlot(rec) {
      if (this._tile) procSaveTile(this._tile, rec);
      else saveRecord(this._mapId, this._eventId, rec);
      const ev = this._eventId ? $gameMap.event(this._eventId) : null;
      if (ev) applySprite(ev, rec);
      if (this._tile) procClearTile(this._tile, this._eventId);
    }

    createUIMenuDOM() {
      loadUIResources();

      this._dndContainer = document.createElement('div');
      this._dndContainer.id = 'menu-container';
      document.body.appendChild(this._dndContainer);

      this._dndContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        SoundManager.playCancel();
        this.popScene();
      });

      UIPlantInputManager.init(this._dndContainer);
      this.refreshUIMenuDOM();
    }

    refreshUIMenuDOM() {
      if (!this._dndContainer) return;
      if (!this._hasPlant()) {
        this.popScene();
        return;
      }

      const rec = this._rec;
      const def = PLANT_DB[rec.plantId];
      if (!def) return;

      const item = $dataItems[def.itemId];
      const itemName = item ? item.name : T('PlantGrowth.itemNumbered', { id: def.itemId });
      const itemIcon = item ? item.iconIndex : 0;
      const x = (itemIcon % 16) * 32;
      const y = Math.floor(itemIcon / 16) * 32;

      const progress = calcProgress(rec.effectiveGrowthMinutes, def.growthDays);
      const progressPercent = Math.floor(progress * 100);

      const curSeason = currentSeason();
      const greenhouse = isGreenhouse();
      const inSeason = greenhouse || def.seasons.includes(curSeason);

      const speedMult = growthMult(greenhouse);
      const currentMult = inSeason ? speedMult : 0.0;

      const canYield = rec.stage >= 2;
      const yieldText = canYield ? `${calcYield(def, rec.effectiveGrowthMinutes)} – ${def.yieldMax}` : T('PlantGrowth.yieldNone');

      let readyEstimateText = T('PlantGrowth.readyNow');
      let readyColor = "#2e7d32";
      if (rec.stage < 3) {
        const rem = Math.max(0, def.growthDays * MINUTES_PER_DAY - rec.effectiveGrowthMinutes);
        const days = Math.ceil(rem / MINUTES_PER_DAY);
        readyEstimateText = inSeason ? T.n('PlantGrowth.inDays', days) : T('PlantGrowth.inDaysPaused', { days: days });
        readyColor = inSeason ? "#4a1d0f" : "#ee7777";
      }

      const leftPageHTML = `
        <div class="tools-pockets" style="height:100%; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <h2 class="title" style="margin-bottom:8px;">${T('Plant.ui.cropPlot')}</h2>
            <div class="plant-desc" style="margin-bottom:18px;">${this._plotLabel()}</div>
            
            <div style="display:flex; justify-content:center; align-items:center; flex-direction:column; margin-bottom:20px;">
              <div class="portrait-frame" style="width:110px; height:110px; border-radius:12px; margin-bottom:8px; display:flex; align-items:center; justify-content:center;">
                <canvas id="plant-sprite-canvas" width="96" height="96"></canvas>
              </div>
              <div style="font-family:'Lora', serif; font-size:1.6em; color:#58180D; font-weight:bold; text-align:center;">
                ${rec.plantId}
              </div>
              <div style="font-family:'Lora', serif; font-size:0.9em; font-style:italic; color:#5d483b;">
                ${T('PlantGrowth.stageLine', { name: stageName(rec.stage), n: rec.stage })}
              </div>
            </div>

            <div class="vitals-box" style="margin-bottom:15px; padding:12px 18px;">
              <div class="vital-row" style="margin-bottom:6px;">
                <span class="vital-lbl" style="width:90px;">${T('PlantGrowth.growthLabel')}</span>
                <div class="flask-container" style="height:14px; border-radius:7px;">
                  <div class="flask-fill hp-fill" style="width: ${progressPercent}%; background: linear-gradient(to right, #2e7d32 0%, #4caf50 40%, #81c784 100%);"></div>
                </div>
                <span class="vital-vals" style="width:50px; font-weight:bold;">${progressPercent}%</span>
              </div>
              <div style="text-align:right; font-family:monospace; font-size:0.8em; color:#5d483b; margin-top:2px;">
                ${T('PlantGrowth.dayOf', { day: Math.floor(rec.effectiveGrowthMinutes / MINUTES_PER_DAY), total: def.growthDays })}
              </div>
            </div>

            <div class="cc-dossier-card" style="margin-bottom:0; padding:12px 16px;">
              <div class="cc-dossier-row">
                <span class="cc-dossier-label">${T('PlantGrowth.expectedYield')}</span>
                <span class="cc-dossier-value" style="font-weight:bold; color:${canYield ? '#2e7d32' : '#ee7777'}">${yieldText}</span>
              </div>
              <div class="cc-dossier-row" style="border-bottom:none; padding-bottom:0; margin-bottom:0;">
                <span class="cc-dossier-label">${T('PlantGrowth.produces')}</span>
                <span class="cc-dossier-value" style="display:flex; align-items:center; gap:6px;">
                  <span style="background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.75);"></span>
                  <strong>${itemName}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      `;

      const harvestEnabled = rec.stage >= 2;
      const harvestOpacity = harvestEnabled ? 1.0 : 0.45;
      const harvestPointerEvents = harvestEnabled ? "auto" : "none";

      const rightPageHTML = `
        <div class="tools-pockets" style="height:100%; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <h2 class="title" style="margin-bottom:8px;">${T('PlantGrowth.conditionsActions')}</h2>
            <div class="plant-desc" style="margin-bottom:18px;">${T('PlantGrowth.plotBlurb')}</div>

            <div class="cc-dossier-card" style="margin-bottom:20px; padding:14px 18px;">
              <div class="cc-subheader" style="margin-bottom:10px;">${T('PlantGrowth.growingConditions')}</div>
              <div class="cc-dossier-row">
                <span class="cc-dossier-label">${T('PlantGrowth.seasonLabel')}</span>
                <span class="cc-dossier-value" style="font-weight:bold; color:#58180D;">${curSeason}</span>
              </div>
              <div class="cc-dossier-row">
                <span class="cc-dossier-label">${T('PlantGrowth.greenhouseLabel')}</span>
                <span class="cc-dossier-value">${greenhouse ? T('PlantGrowth.greenhouseYes') : T('PlantGrowth.no')}</span>
              </div>
              <div class="cc-dossier-row">
                <span class="cc-dossier-label">${T('PlantGrowth.weatherLabel')}</span>
                <span class="cc-dossier-value">${currentWeather().toUpperCase()} (${speedMult.toFixed(1)}x)</span>
              </div>
              <div class="cc-dossier-row">
                <span class="cc-dossier-label">${T('PlantGrowth.growthSpeed')}</span>
                <span class="cc-dossier-value" style="font-weight:bold; color:${currentMult > 0 ? '#2e7d32' : '#ee7777'}">${currentMult.toFixed(1)}x</span>
              </div>
              <div class="cc-dossier-row" style="border-bottom:none; padding-bottom:0; margin-bottom:0;">
                <span class="cc-dossier-label">${T('PlantGrowth.readyLabel')}</span>
                <span class="cc-dossier-value" style="font-weight:bold; color:${readyColor};">${readyEstimateText}</span>
              </div>
            </div>

            <div class="cc-subheader" style="margin-bottom:10px;">${T('PlantGrowth.actions')}</div>
            <div class="plant-grid">
              <div class="command-item focusable" style="opacity:${harvestOpacity}; pointer-events:${harvestPointerEvents}; margin-bottom:8px;" onclick="SceneManager._scene._onHarvest()">
                ${iconHtml(263)}
                <span style="font-weight:bold;">${T('PlantGrowth.cmd.harvest')}</span>
              </div>
              <div class="command-item focusable" style="border-color:rgba(130, 45, 45, 0.4); color:#822d2d; margin-bottom:8px;" onclick="SceneManager._scene._onRemove()">
                ${iconHtml(217)}
                <span style="font-weight:bold;">${T('PlantGrowth.clearPlot')}</span>
              </div>
              <div class="command-item focusable" onclick="SceneManager._scene.popScene()">
                ${iconHtml(186)}
                <span>${T('PlantGrowth.close')}</span>
              </div>
            </div>
          </div>
        </div>
      `;

      this._dndContainer.innerHTML = `
        <div class="book-spread">
          <div class="left-page">
            ${leftPageHTML}
          </div>
          <div class="right-page">
            ${rightPageHTML}
          </div>
        </div>
      `;

      UIPlantInputManager.activate(1);
      drawUIPlantSprite(rec.plantId, rec.stage, "plant-sprite-canvas");
    }

    update() {
      super.update();
      UIPlantInputManager.update();
    }

    terminate() {
      super.terminate();
      UIPlantInputManager.deactivate();
      if (this._dndContainer) {
        const container = this._dndContainer;
        container.style.transition = "opacity 0.2s ease-out";
        container.style.opacity = "0";
        container.style.pointerEvents = "none";
        setTimeout(() => {
          if (container && container.parentNode) {
            container.parentNode.removeChild(container);
          }
        }, 200);
        this._dndContainer = null;
      }
    }
  }

  // ============================================================
  //  WINDOW: Plant Info
  // ============================================================


  // ============================================================
  //  WINDOW: Plant Command
  // ============================================================

  let _cmdIsEmpty = false;


  // ============================================================
  //  WINDOW: Plant Select
  // ============================================================


  // ============================================================
  //  WINDOW: Plant Preview (Animated)
  // ============================================================



  // ============================================================
  //  SCENE: Plant Quick Menu
  // ============================================================

  // ============================================================
  //  SCENE: Plant Quick Menu (D&D Parchment Double-Page Register)
  // ============================================================

  class Scene_PlantQuickMenu extends Scene_MenuBase {
    initialize() {
      super.initialize();
      const a = Scene_PlantQuickMenu._openArgs || {};
      this._mapId = a.mapId || 0;
      this._eventId = a.eventId || 0;
      this._tile = a.tile || null;
      this._rec = a.rec || null;

      this._previewPlantId = null;
      this._previewStage = 0;
      this._previewTimer = 0;
    }

    create() {
      super.create();
      this._createCommandWindow();

      // Hide standard command window
      if (this._commandWindow) {
        this._commandWindow.visible = false;
        this._commandWindow.active = false;
      }

      this.createUIMenuDOM();
    }

    _hasPlant() {
      return !!(this._rec && !this._rec.removed && this._rec.plantId);
    }

    _plotLabel() {
      return plotLabel(this._mapId, this._eventId, this._tile);
    }

    _createCommandWindow() {
      const ww = Math.floor(Graphics.boxWidth * 0.5);
      const rows = this._hasPlant() ? 4 : 2;
      const wh = this.calcWindowHeight(rows, true);
      const wx = Math.floor((Graphics.boxWidth - ww) / 2);
      const wy = Math.floor((Graphics.boxHeight - wh) / 2);
      _quickHasPlant = this._hasPlant();
      this._commandWindow = new Window_PlantQuickCommand(new Rectangle(wx, wy, ww, wh));
      this.addWindow(this._commandWindow);
    }

    createUIMenuDOM() {
      loadUIResources();

      this._dndContainer = document.createElement('div');
      this._dndContainer.id = 'menu-container';
      document.body.appendChild(this._dndContainer);

      this._dndContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        SoundManager.playCancel();
        this.popScene();
      });

      UIPlantInputManager.init(this._dndContainer);
      this.refreshUIMenuDOM();
    }

    onUIFocusChange(el) {
      const plantId = el.getAttribute('data-plant');
      if (plantId) {
        this._previewPlantId = plantId;
        this._previewStage = 0;
        this._previewTimer = 0;

        const titleEl = document.getElementById("preview-seed-name");
        if (titleEl) titleEl.innerText = plantId;

        const stageLbl = document.getElementById("preview-stage-name");
        if (stageLbl) stageLbl.innerText = T('PlantGrowth.stageLine', { name: stageName(0), n: 0 });

        const def = PLANT_DB[plantId];
        if (def) {
          const detailEl = document.getElementById("preview-seed-details");
          if (detailEl) {
            const seasonText = def.seasons.join(", ");
            detailEl.innerHTML = `
              <div class="cc-dossier-row" style="font-size:0.85rem; margin-bottom:4px;">
                <span class="cc-dossier-label">${T('Plant.ui.growingSeasons')}</span>
                <span class="cc-dossier-value" style="font-weight:bold; color:#58180D;">${seasonText}</span>
              </div>
              <div class="cc-dossier-row" style="font-size:0.85rem; margin-bottom:4px;">
                <span class="cc-dossier-label">${T('Plant.ui.growthDuration')}</span>
                <span class="cc-dossier-value" style="font-weight:bold;">${T('Plant.ui.days', { count: def.growthDays })}</span>
              </div>
              <div class="cc-dossier-row" style="font-size:0.85rem; margin-bottom:0; border-bottom:none; padding-bottom:0;">
                <span class="cc-dossier-label">${T('Plant.ui.yieldRange')}</span>
                <span class="cc-dossier-value">×${def.yieldMin} – ${def.yieldMax}</span>
              </div>
            `;
          }
        }

        drawUIPlantSprite(plantId, 0, "plant-preview-canvas");
      } else {
        this._previewPlantId = null;
        const titleEl = document.getElementById("preview-seed-name");
        if (titleEl) titleEl.innerText = T('PlantGrowth.closeDash');

        const stageLbl = document.getElementById("preview-stage-name");
        if (stageLbl) stageLbl.innerText = "";

        const detailEl = document.getElementById("preview-seed-details");
        if (detailEl) detailEl.innerHTML = `<p style='text-align:center; font-style:italic;'>${T('Plant.ui.goBackToMap')}</p>`;

        const canvas = document.getElementById("plant-preview-canvas");
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }

    onPlantSeedClick(plantId) {
      const def = PLANT_DB[plantId];
      if (!def || $gameParty.gold() < def.cost) {
        SoundManager.playBuzzer();
        return;
      }
      $gameParty.loseGold(def.cost);
      const now = gameMinutes();
      const newRec = { plantId, plantedAt: now, lastUpdateMinutes: now, effectiveGrowthMinutes: 0, stage: 0, removed: false };
      let ev;
      if (this._tile) {
        // Procedural plot: the world folder holds the record, and the sown tile
        // needs a plant event of its own to show the crop.
        procSaveTile(this._tile, newRec);
        procFlush();
        ev = ensureProcPlantEvent(this._tile);
        if (ev) this._eventId = ev.eventId();
      } else {
        saveRecord(this._mapId, this._eventId, newRec);
        ev = $gameMap.event(this._eventId);
      }
      this._rec = newRec;
      trainFarming(1);
      if (ev) applySprite(ev, newRec);
      SoundManager.playShop();
      window.skipLocalization = true;
      $gameMessage.add(T('PlantGrowth.planted', { plant: plantId }));
      window.skipLocalization = false;
      if (window.Diary) window.Diary.onSown((PLANT_DB[plantId] || {}).name || plantId);
      this.popScene();
    }

    refreshUIMenuDOM() {
      if (!this._dndContainer) return;

      const curSeason = currentSeason();
      const greenhouse = isGreenhouse();
      const weather = currentWeather().toUpperCase();

      const leftPageHTML = `
        <div class="tools-pockets" style="height:100%; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <h2 class="title" style="margin-bottom:8px;">${T('Plant.ui.emptyPlot')}</h2>
            <div class="plant-desc" style="margin-bottom:18px;">${this._plotLabel()}</div>
            
            <div style="display:flex; justify-content:center; align-items:center; flex-direction:column; margin-bottom:20px;">
              <div class="portrait-frame" style="width:110px; height:110px; border-radius:12px; margin-bottom:8px; display:flex; align-items:center; justify-content:center;">
                <canvas id="plant-preview-canvas" width="96" height="96"></canvas>
              </div>
              <div id="preview-seed-name" style="font-family:'Lora', serif; font-size:1.6em; color:#58180D; font-weight:bold; text-align:center;">
                ${T('Plant.ui.selectASeed')}
              </div>
              <div id="preview-stage-name" style="font-family:'Lora', serif; font-size:0.9em; font-style:italic; color:#5d483b;">
                -
              </div>
            </div>

            <div id="preview-seed-details" class="cc-dossier-card" style="margin-bottom:20px; padding:12px 16px;">
              <p style="text-align:center; font-style:italic; margin:0; color:#5d483b; font-size:0.9em;">
                ${T('PlantGrowth.pickSeedHint')}
              </p>
            </div>

            <div class="cc-dossier-card" style="background:rgba(88, 24, 13, 0.03); border-style:solid; border-color:rgba(88, 24, 13, 0.15); padding:10px 14px;">
              <p style="font-family:'Lora', serif; font-size:0.82em; color:#5d483b; text-align:center; line-height:1.45; margin:0; font-style:italic;">
                "${T('PlantGrowth.seedBlurb')}"
              </p>
            </div>
          </div>
        </div>
      `;

      let seedGridHTML = "";
      for (const [id, def] of Object.entries(PLANT_DB)) {
        const canAfford = $gameParty ? $gameParty.gold() >= def.cost : false;
        const inSeason = greenhouse || def.seasons.includes(curSeason);

        const priceText = (def.cost / 100).toFixed(2) + "€";
        const dotColor = inSeason ? "#2e7d32" : "#9e9e9e";
        const costColor = canAfford ? "#58180D" : "#cc2222";

        seedGridHTML += `
          <div class="command-item focusable" data-plant="${id}" onclick="SceneManager._scene.onPlantSeedClick('${id}')" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="background:${dotColor}; width:8px; height:8px; border-radius:50%; display:inline-block;"></span>
              <span style="font-weight:bold;">${id}</span>
              <span style="font-size:0.7em; font-style:italic; color:#5d483b;">(${def.growthDays}d)</span>
            </div>
            <div style="font-weight:bold; color:${costColor}; font-family:monospace; font-size:0.9em;">
              ${priceText}
            </div>
          </div>
        `;
      }

      const rightPageHTML = `
        <div class="tools-pockets" style="height:100%; display:flex; flex-direction:column; justify-content:space-between;">
          <div style="display:flex; flex-direction:column; height:100%;">
            <h2 class="title" style="margin-bottom:8px;">${T('PlantGrowth.seeds')}</h2>
            
            <div style="display:flex; justify-content:space-between; font-family:'Lora', serif; font-size:0.78em; color:#5d483b; margin-bottom:12px; border-bottom:1px solid rgba(88,24,13,0.1); padding-bottom:4px;">
              <span>${T('PlantGrowth.seasonLabel')} <strong>${curSeason}</strong></span>
              <span>${T('PlantGrowth.weatherLabel')} <strong>${weather}</strong></span>
              <span>${T('PlantGrowth.greenhouseLabel')} <strong>${greenhouse ? T('PlantGrowth.yes') : T('PlantGrowth.no')}</strong></span>
            </div>

            <div class="plant-grid" style="flex-grow:1; max-height:410px; overflow-y:auto; margin-bottom:12px; padding-right:4px;">
              ${seedGridHTML}
            </div>

            <div class="command-item focusable" onclick="SceneManager._scene.popScene()" style="margin-top:auto;">
              ${iconHtml(186)}
              <span style="font-weight:bold;">${T('Plant.ui.close')}</span>
            </div>
          </div>
        </div>
      `;

      this._dndContainer.innerHTML = `
        <div class="book-spread">
          <div class="left-page">
            ${leftPageHTML}
          </div>
          <div class="right-page">
            ${rightPageHTML}
          </div>
        </div>
      `;

      UIPlantInputManager.activate(1);
    }

    update() {
      super.update();
      UIPlantInputManager.update();

      if (this._previewPlantId) {
        this._previewTimer++;
        if (this._previewTimer >= 40) {
          this._previewTimer = 0;
          this._previewStage = (this._previewStage + 1) % 4;

          drawUIPlantSprite(this._previewPlantId, this._previewStage, "plant-preview-canvas");

          const stageLbl = document.getElementById("preview-stage-name");
          if (stageLbl) {
            stageLbl.innerText = T('PlantGrowth.stageLine', { name: stageName(this._previewStage), n: this._previewStage });
          }
        }
      }
    }

    terminate() {
      super.terminate();
      UIPlantInputManager.deactivate();
      if (this._dndContainer) {
        const container = this._dndContainer;
        container.style.transition = "opacity 0.2s ease-out";
        container.style.opacity = "0";
        container.style.pointerEvents = "none";
        setTimeout(() => {
          if (container && container.parentNode) {
            container.parentNode.removeChild(container);
          }
        }, 200);
        this._dndContainer = null;
      }
    }
  }

  // ============================================================
  //  WINDOW: Plant Quick Command
  // ============================================================

  let _quickHasPlant = false;

  class Window_PlantQuickCommand extends Window_Command {
    initialize(rect) {
      this._hasPlant = _quickHasPlant;
      super.initialize(rect);
    }
    makeCommandList() {
      if (this._hasPlant) {
        this.addCommand(T('PlantGrowth.cmd.check'), "check");
        this.addCommand(T('PlantGrowth.cmd.harvest'), "harvest");
        this.addCommand(T('PlantGrowth.cmd.remove'), "remove");
        this.addCommand(T('PlantGrowth.cmd.cancel'), "cancel");
      } else {
        this.addCommand(T('PlantGrowth.cmd.plant'), "plant");
        this.addCommand(T('PlantGrowth.cmd.cancel'), "cancel");
      }
    }
    maxCols() { return 1; }
    numVisibleRows() { return this._hasPlant ? 4 : 2; }
  }

  // Public API for NPCSimulationCore and other plugins
  window.PlantGrowthSystem = {
    getRecord: (mapId, eventId) => getRecord(mapId, eventId),
    updateGrowth: (mapId, eventId) => updateGrowth(mapId, eventId),
    // Procedural map (636) plots, stored per world coordinate in the world
    // folder. ProceduralTerrainInteractions opens an empty tilled tile here.
    openProceduralPlot: (x, y) => openProceduralPlot(x, y),
    getProceduralPlot: (x, y) => procGetTile(`${x},${y}`),
    PLANT_DB,
  };

})();