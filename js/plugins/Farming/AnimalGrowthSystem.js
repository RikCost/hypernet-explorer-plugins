/*:
 * @target MZ
 * @plugindesc v2.0.0 Animal Growth System - animal lifecycle, produce and ownership. Buying happens in the Build menu, management in the Assets menu.
 * @author Omni-Lex
 *
 * @help AnimalGrowthSystem v2.0.0
 * ============================================================
 * Manages an animal husbandry system driven by the
 * TimeDateSystem (Variable 114 = game minutes).
 *
 * --- Where the UI lives ---
 * There is no separate animal scene any more.
 *  - BUYING happens in the on-map Build menu (FurnitureSystem.js), on its
 *    "Animals" tab: pick an animal, then click a tile to place it. Animals
 *    always cost money, never crafting materials.
 *  - OWNING / SELLING / PETTING happens in the Assets menu
 *    (Economy/AssetsMenu.js), where every bought animal is listed as a
 *    "Livestock" asset with Collect / Sell / Make Pet actions.
 *  - Talking to an animal on the map collects whatever it has ready.
 *
 * --- Persistence ---
 * A bought animal is stored against the *map key*, not the map id: the
 * procedural biome map (id 636) streams a different place for every world
 * coordinate, so the composite key FurnitureSystem uses
 * (proc:<biome>:<wx>,<wy>:<depth>) is what makes an animal come back at the
 * exact coordinate where it was bought. Ordinary maps use their map id. Either
 * way the animal is respawned from the record every time the map loads.
 *
 * --- Growth Logic ---
 * - Animals grow from Baby to Adult over their defined growthDays.
 * - Animals that only have an Adult stage start as adults.
 * - Adult animals produce items at defined intervals.
 * - Sprite sheets use rows as growth stages:
 *   Baby = direction DOWN (row 0), Adult = direction LEFT (row 1).
 *
 * --- Legacy "Animal" events ---
 * An event named "Animal" still works as a single animal slot driven by the
 * SellAnimal / CollectProduce / RemoveAnimal plugin commands; AnimalMenu and
 * BuyAnimal now simply open the Build menu on the Animals tab.
 *
 * @command AnimalMenu
 * @text Animal Menu
 * @desc Opens the Build menu on the Animals tab (buy animals with money).
 *
 * @command BuyAnimal
 * @text Buy Animal
 * @desc Opens the Build menu on the Animals tab.
 *
 * @command SellAnimal
 * @text Sell Animal
 * @desc Sells the animal held by the calling "Animal" event slot.
 *
 * @command CollectProduce
 * @text Collect Produce
 * @desc Collects any ready produce from the animal at the calling event.
 *
 * @command RemoveAnimal
 * @text Remove Animal
 * @desc Removes the animal at the calling event without giving gold.
 *
 * @command InteractAnimal
 * @text Interact With Animal
 * @desc Internal: fired by a placed animal when the player talks to it.
 * @arg uid
 * @text Animal UID
 * @desc Internal placement id.
 * @type string
 */

(() => {
  "use strict";

  const pluginName = "AnimalGrowthSystem";

  // ============================================================
  //  CONSTANTS
  // ============================================================

  const GAME_TIME_VAR = 114;
  const MINUTES_PER_DAY = 1440;

  // Direction per growth stage: 2=down (baby), 4=left (adult)
  const STAGE_DIRS = { baby: 2, adult: 4 };
  const STAGE_NAMES = {
    get baby() { return T('AnimalGrowth.stage.baby'); },
    get adult() { return T('AnimalGrowth.stage.adult'); }
  };

  // ============================================================
  //  ANIMAL DATABASE
  // ============================================================

  // produces: array of { itemId, interval (in days), yieldMin, yieldMax }
  // Produce ids are real database items: 438 Fresh Milk, 861 Cloth (wool),
  // 862 Meat, 868 Leather. (They used to all point at 575, which the
  // 565-587 -> 849-871 material migration turned into a food item.)

  const ANIMAL_DB = {
    Chicken: {
      adultSkins: [
        "Animals/!$MV_Chicken_1", "Animals/!$MV_Chicken_2", "Animals/!$MV_Chicken_3",
        "Animals/!$MV_Chicken_4", "Animals/!$MV_Chicken_5", "Animals/!$MV_Chicken_6", "Animals/!$MV_Chicken_7"
      ],
      babySkins: ["Animals/!$MV_Chick"],
      hasBaby: true,
      buyCostBaby: 2000,
      buyCostAdult: 5000,
      sellValueBaby: 1000,
      sellValueAdult: 2500,
      growthDays: 7,
      produces: [
        { itemId: 862, interval: 1, yieldMin: 1, yieldMax: 3 }
      ]
    },
    Cow: {
      adultSkins: [
        "Animals/!$MV_Cow", "Animals/!$MV_Cow_Big", "Animals/!$MV_Cow_Big_2",
        "Animals/!$MV_Cow_Big_3", "Animals/!$MV_Cow_Big_4", "Animals/!$MV_Cow_Big_5"
      ],
      babySkins: ["Animals/!$MV_Cow_Baby_1", "Animals/!$MV_Cow_Baby_2"],
      hasBaby: true,
      buyCostBaby: 10000,
      buyCostAdult: 30000,
      sellValueBaby: 5000,
      sellValueAdult: 15000,
      growthDays: 14,
      produces: [
        { itemId: 438, interval: 2, yieldMin: 1, yieldMax: 2 },
        { itemId: 868, interval: 5, yieldMin: 1, yieldMax: 1 }
      ]
    },
    Dog: {
      adultSkins: [
        "Animals/!$MV_Dog_Basenji", "Animals/!$MV_Dog_German_Shepherd",
        "Animals/!$MV_Dog_Labrador", "Animals/!$MV_Dog_Shepherd"
      ],
      babySkins: [],
      hasBaby: false,
      buyCostAdult: 20000,
      sellValueAdult: 10000,
      growthDays: 0,
      produces: []
    },
    Donkey: {
      adultSkins: [
        "Animals/!$MV_Donkey", "Animals/!$MV_Donkey_2", "Animals/!$MV_Donkey_3",
        "Animals/!$MV_Donkey_4", "Animals/!$MV_Donkey_Front_Ears_Up"
      ],
      babySkins: ["Animals/!$MV_Donkey_Baby_1", "Animals/!$MV_Donkey_Baby_2"],
      hasBaby: true,
      buyCostBaby: 8000,
      buyCostAdult: 20000,
      sellValueBaby: 4000,
      sellValueAdult: 10000,
      growthDays: 14,
      produces: []
    },
    Duck: {
      adultSkins: [
        "Animals/!$MV_Duck_1", "Animals/!$MV_Duck_2", "Animals/!$MV_Duck_3", "Animals/!$MV_Duck_4"
      ],
      babySkins: ["Animals/!$MV_Duckling_1", "Animals/!$MV_Duckling_2"],
      hasBaby: true,
      buyCostBaby: 1500,
      buyCostAdult: 4000,
      sellValueBaby: 750,
      sellValueAdult: 2000,
      growthDays: 5,
      produces: [
        { itemId: 862, interval: 2, yieldMin: 1, yieldMax: 2 }
      ]
    },
    Goat: {
      adultSkins: [
        "Animals/!$MV_Goat_1", "Animals/!$MV_Goat_2", "Animals/!$MV_Goat_3", "Animals/!$MV_Goat_4"
      ],
      babySkins: ["Animals/!$MV_Goat_Baby_1", "Animals/!$MV_Goat_Baby_2"],
      hasBaby: true,
      buyCostBaby: 6000,
      buyCostAdult: 15000,
      sellValueBaby: 3000,
      sellValueAdult: 7500,
      growthDays: 10,
      produces: [
        { itemId: 438, interval: 2, yieldMin: 1, yieldMax: 2 }
      ]
    },
    Pig: {
      adultSkins: [
        "Animals/!$MV_Pig_1", "Animals/!$MV_Pig_2", "Animals/!$MV_Pig_3",
        "Animals/!$MV_Pig_4", "Animals/!$MV_Pig_5"
      ],
      babySkins: ["Animals/!$MV_Piglet_1", "Animals/!$MV_Piglet_2"],
      hasBaby: true,
      buyCostBaby: 5000,
      buyCostAdult: 12000,
      sellValueBaby: 2500,
      sellValueAdult: 6000,
      growthDays: 10,
      produces: [
        { itemId: 862, interval: 3, yieldMin: 1, yieldMax: 2 }
      ]
    },
    Rabbit: {
      adultSkins: [
        "Animals/!$MV_Rabbit_1", "Animals/!$MV_Rabbit_2", "Animals/!$MV_Rabbit_3",
        "Animals/!$MV_Rabbit_4", "Animals/!$MV_Rabbit_5", "Animals/!$MV_Rabbit_6"
      ],
      babySkins: ["Animals/!$MV_Rabbit_Baby_1", "Animals/!$MV_Rabbit_Baby_2", "Animals/!$MV_Rabbit_Baby_3"],
      hasBaby: true,
      buyCostBaby: 1000,
      buyCostAdult: 3000,
      sellValueBaby: 500,
      sellValueAdult: 1500,
      growthDays: 5,
      produces: [
        { itemId: 868, interval: 3, yieldMin: 1, yieldMax: 2 }
      ]
    },
    Rooster: {
      adultSkins: [
        "Animals/!$MV_Rooster_1", "Animals/!$MV_Rooster_2", "Animals/!$MV_Rooster_3",
        "Animals/!$MV_Rooster_4", "Animals/!$MV_Rooster_5", "Animals/!$MV_Rooster_6", "Animals/!$MV_Rooster_7"
      ],
      babySkins: [],
      hasBaby: false,
      buyCostAdult: 4000,
      sellValueAdult: 2000,
      growthDays: 0,
      produces: []
    },
    Sheep: {
      adultSkins: [
        "Animals/!$MV_Sheep_1", "Animals/!$MV_Sheep_2", "Animals/!$MV_Sheep_3", "Animals/!$MV_Sheep_4",
        "Animals/!$MV_Sheep_5", "Animals/!$MV_Sheep_6", "Animals/!$MV_Sheep_7", "Animals/!$MV_Sheep_8",
        "Animals/!$MV_Sheep_9", "Animals/!$MV_Sheep_10", "Animals/!$MV_Sheep_11"
      ],
      babySkins: ["Animals/!$MV_Sheep_Baby_1", "Animals/!$MV_Sheep_Baby_2"],
      hasBaby: true,
      buyCostBaby: 4000,
      buyCostAdult: 10000,
      sellValueBaby: 2000,
      sellValueAdult: 5000,
      growthDays: 10,
      produces: [
        { itemId: 861, interval: 3, yieldMin: 1, yieldMax: 3 }
      ]
    }
  };

  // Old variants that don't fit numbered pattern ,  treated as extra adult skins
  // !$MV_Chicken_Old -> extra Chicken adult skin
  // !$MV_Goat_Old    -> extra Goat adult skin
  ANIMAL_DB.Chicken.adultSkins.push("Animals/!$MV_Chicken_Old");
  ANIMAL_DB.Goat.adultSkins.push("Animals/!$MV_Goat_Old");

  // ============================================================
  //  HELPERS
  // ============================================================

  function animalKey(mapId, eventId) {
    return `${mapId}_${eventId}`;
  }

  function getRecord(mapId, eventId) {
    if (!$gameSystem._animalData) $gameSystem._animalData = {};
    return $gameSystem._animalData[animalKey(mapId, eventId)] || null;
  }

  function saveRecord(mapId, eventId, rec) {
    if (!$gameSystem._animalData) $gameSystem._animalData = {};
    $gameSystem._animalData[animalKey(mapId, eventId)] = rec;
    updateSelfSwitch(mapId, eventId, rec);
  }

  function deleteRecord(mapId, eventId) {
    if (!$gameSystem._animalData) $gameSystem._animalData = {};
    delete $gameSystem._animalData[animalKey(mapId, eventId)];
    if ($gameSelfSwitches) {
      $gameSelfSwitches.setValue([mapId, eventId, "A"], true);
    }
  }

  function updateSelfSwitch(mapId, eventId, rec) {
    if (!$gameSelfSwitches) return;
    const hasAnimal = !!(rec && rec.animalId);
    $gameSelfSwitches.setValue([mapId, eventId, "A"], !hasAnimal);
  }

  function gameMinutes() {
    return ($gameVariables ? $gameVariables.value(GAME_TIME_VAR) : 0) || 0;
  }

  function isAnimalEvent(event) {
    // Cached per event (event names are static per map) so the per-frame
    // Game_Event.update hook doesn't lowercase the name every call.
    if (event._isAnimalEvt !== undefined) return event._isAnimalEvt;
    if (!$dataMap || !$dataMap.events) return false;
    const data = $dataMap.events[event._eventId];
    event._isAnimalEvt = !!(data && (data.name || "").toLowerCase() === "animal");
    return event._isAnimalEvt;
  }

  function randomPick(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function calcGrowthProgress(rec, def) {
    if (!def.hasBaby || def.growthDays <= 0) return 1.0;
    const elapsed = rec.effectiveGrowthMinutes || 0;
    return Math.min(elapsed / (def.growthDays * MINUTES_PER_DAY), 1.0);
  }

  function getStage(rec, def) {
    if (!def.hasBaby) return "adult";
    return calcGrowthProgress(rec, def) >= 1.0 ? "adult" : "baby";
  }

  function getCurrentSprite(rec, def) {
    const stage = getStage(rec, def);
    if (stage === "baby") {
      return rec.babySkin || (def.babySkins[0] || def.adultSkins[0]);
    }
    return rec.adultSkin || def.adultSkins[0];
  }

  function sellValueOf(rec, def) {
    if (!def) return 0;
    return (rec.stage === "baby") ? (def.sellValueBaby || 0) : (def.sellValueAdult || 0);
  }

  function buyCostOf(def, stage) {
    if (!def) return 0;
    return (stage === "baby") ? (def.buyCostBaby || 0) : (def.buyCostAdult || 0);
  }

  // Count total animal events on current map
  function countAnimalEvents() {
    if (!$gameMap || !$dataMap || !$dataMap.events) return 0;
    let count = 0;
    for (const ev of $gameMap.events()) {
      if (ev && isAnimalEvent(ev)) count++;
    }
    return count;
  }

  // Count occupied animal events on current map
  function countOccupiedSlots() {
    if (!$gameMap || !$gameSystem._animalData) return 0;
    const mapId = $gameMap.mapId();
    let count = 0;
    for (const ev of $gameMap.events()) {
      if (!ev || !isAnimalEvent(ev)) continue;
      const rec = getRecord(mapId, ev._eventId);
      if (rec && rec.animalId) count++;
    }
    return count;
  }

  function hasFreeSlot() {
    return countOccupiedSlots() < countAnimalEvents();
  }

  // ============================================================
  //  PLACEMENT STORE (animals bought from the Build menu)
  // ============================================================

  // Placed animals are stored per *map key*, not per map id. The procedural
  // biome map (id 636) is one reused map that streams a different place for
  // every world coordinate, so keying by map id alone would make an animal
  // bought at one coordinate appear at every other. FurnitureSystem already
  // solves this with a composite key (proc:<biome>:<wx>,<wy>:<depth>), so the
  // same key is reused here and animals come back exactly where they were left,
  // on ordinary and procedural maps alike.
  function currentMapKey() {
    const fs = window.FurnitureSystem;
    if (fs && typeof fs.furnitureMapKey === "function") {
      try {
        const key = fs.furnitureMapKey();
        if (key != null) return String(key);
      } catch (e) { /* fall back to the plain map id */ }
    }
    return String($gameMap ? $gameMap.mapId() : 0);
  }

  function placementStore() {
    if (!$gameSystem) return {};
    if (!$gameSystem._animalPlacements) $gameSystem._animalPlacements = {};
    return $gameSystem._animalPlacements;
  }

  function placementsAt(mapKey) {
    const store = placementStore();
    if (!store[mapKey]) store[mapKey] = [];
    return store[mapKey];
  }

  function allPlacements() {
    const store = placementStore();
    const out = [];
    for (const [mapKey, list] of Object.entries(store)) {
      for (const rec of (list || [])) {
        if (rec && rec.animalId) out.push({ rec, mapKey });
      }
    }
    return out;
  }

  function findPlacement(uid) {
    const n = Number(uid);
    for (const entry of allPlacements()) {
      if (entry.rec.uid === n) return entry;
    }
    return null;
  }

  function nextPlacementUid() {
    if (!$gameSystem._animalPlacementUid) $gameSystem._animalPlacementUid = 0;
    return ++$gameSystem._animalPlacementUid;
  }

  // A fresh animal record. Shared by the Build menu (placements) and the
  // legacy "Animal" event slots so both age and produce identically.
  function newRecord(animalId, stage) {
    const def = ANIMAL_DB[animalId];
    if (!def) return null;
    const now = gameMinutes();
    const isBaby = stage === "baby" && def.hasBaby;
    const finalStage = isBaby ? "baby" : "adult";
    const produceTimers = {};
    if (finalStage === "adult") {
      for (let i = 0; i < (def.produces || []).length; i++) produceTimers[`p${i}`] = now;
    }
    return {
      animalId,
      boughtAt: now,
      lastUpdateMinutes: now,
      effectiveGrowthMinutes: isBaby ? 0 : def.growthDays * MINUTES_PER_DAY,
      stage: finalStage,
      adultSkin: randomPick(def.adultSkins),
      babySkin: isBaby ? randomPick(def.babySkins) : null,
      paid: buyCostOf(def, finalStage),
      produceTimers,
    };
  }

  // ============================================================
  //  PRODUCTION
  // ============================================================

  // commit=false is a pure read (used by hasReadyProduce) and must not touch
  // rec.produceTimers. commit=true (collectProduce) accumulates every elapsed
  // batch that built up over a long absence and advances the timer by the
  // consumed batches, keeping the sub-interval remainder.
  function checkProduce(rec, def, commit = false) {
    if (!def.produces || def.produces.length === 0) return [];
    if (getStage(rec, def) !== "adult") return [];
    const now = gameMinutes();
    const ready = [];
    if (!rec.produceTimers) {
      if (!commit) return [];   // don't create the map on a read-only query
      rec.produceTimers = {};
    }
    for (let i = 0; i < def.produces.length; i++) {
      const prod = def.produces[i];
      const key = `p${i}`;
      if (rec.produceTimers[key] === undefined) {
        // Timer not started yet: only the mutating path may start the clock.
        if (commit) rec.produceTimers[key] = now;
        continue;
      }
      const needed = prod.interval * MINUTES_PER_DAY;
      if (!(needed > 0)) continue;
      const elapsed = now - rec.produceTimers[key];
      const batches = Math.floor(elapsed / needed);
      if (batches >= 1) {
        let qty = 0;
        for (let b = 0; b < batches; b++) {
          qty += prod.yieldMin + Math.floor(Math.random() * (prod.yieldMax - prod.yieldMin + 1));
        }
        ready.push({ itemId: prod.itemId, qty, prodIndex: i, batches });
        if (commit) rec.produceTimers[key] += batches * needed; // keep remainder
      }
    }
    return ready;
  }

  function collectProduce(rec, def) {
    const items = checkProduce(rec, def, true);
    // A party that knows livestock gets more out of the same animal, and gets
    // better at it by doing the round (see window.SpecializationXP).
    const skill = window.SpecializationXP
      ? window.SpecializationXP.multiplier("Animal Husbandry", 0.1) : 1;
    for (const r of items) {
      const item = $dataItems[r.itemId];
      if (item) {
        r.qty = Math.max(1, Math.round(r.qty * skill));
        $gameParty.gainItem(item, r.qty);
      }
    }
    if (items.length && window.SpecializationXP) {
      window.SpecializationXP.award("Animal Husbandry", 1);
    }
    return items;
  }

  function hasReadyProduce(rec, def) {
    return checkProduce(rec, def, false).length > 0;
  }

  // Announces a collection through the message window, in the caller's voice.
  function reportCollected(items) {
    for (const r of items) {
      const item = $dataItems[r.itemId];
      if (!item) continue;
      window.skipLocalization = true;
      $gameMessage.add(T('AnimalGrowth.collected', { icon: item.iconIndex, item: item.name, qty: r.qty }));
      window.skipLocalization = false;
    }
  }

  // ============================================================
  //  GROWTH UPDATE
  // ============================================================

  // Ages one record by however much game time has passed since it was last
  // looked at. Works for both storage shapes, so a placed animal keeps growing
  // while the player is on the other side of the world.
  function updateRecordGrowth(rec) {
    if (!rec || !rec.animalId) return false;
    const def = ANIMAL_DB[rec.animalId];
    if (!def) return false;
    const now = gameMinutes();
    if (rec.lastUpdateMinutes === undefined) rec.lastUpdateMinutes = now;
    if (!def.hasBaby) { rec.lastUpdateMinutes = now; return false; }

    const elapsed = now - rec.lastUpdateMinutes;
    if (elapsed <= 0) return false;

    rec.effectiveGrowthMinutes = (rec.effectiveGrowthMinutes || 0) + elapsed;
    rec.lastUpdateMinutes = now;

    const oldStage = rec.stage;
    rec.stage = getStage(rec, def);

    // When transitioning to adult, initialize produce timers
    if (oldStage === "baby" && rec.stage === "adult") {
      rec.produceTimers = {};
      for (let i = 0; i < (def.produces || []).length; i++) {
        rec.produceTimers[`p${i}`] = now;
      }
    }
    return oldStage !== rec.stage;
  }

  function updateGrowth(mapId, eventId) {
    const rec = getRecord(mapId, eventId);
    if (!rec || !rec.animalId) return;
    updateRecordGrowth(rec);
    saveRecord(mapId, eventId, rec);
  }

  // Ages every stored animal (placements and event slots alike).
  function updateAllGrowth() {
    for (const { rec } of allPlacements()) updateRecordGrowth(rec);
    const data = $gameSystem && $gameSystem._animalData;
    if (data) {
      for (const rec of Object.values(data)) updateRecordGrowth(rec);
    }
  }

  function applySprite(event, rec) {
    if (!rec || !rec.animalId) {
      event.setImage("", 0);
      return;
    }
    const def = ANIMAL_DB[rec.animalId];
    if (!def) return;
    const sprite = getCurrentSprite(rec, def);
    event.setImage(sprite, 0);
    event._direction = STAGE_DIRS[rec.stage] || 2;
    event._directionFix = false;
    event.setWalkAnime(false);
    event.setStepAnime(true);
    event._animalStageShown = rec.stage;
  }

  function refreshMapAnimals() {
    if (!$gameMap || !$gameSystem) return;
    const mapId = $gameMap.mapId();
    for (const ev of $gameMap.events()) {
      if (!ev || !isAnimalEvent(ev)) continue;
      if (ev._animalUid) continue;   // placed animals own their own refresh
      updateGrowth(mapId, ev._eventId);
      const rec = getRecord(mapId, ev._eventId);
      applySprite(ev, rec);
      updateSelfSwitch(mapId, ev._eventId, rec);
    }
  }

  // ============================================================
  //  SPRITE SERVICES (shared with the Build menu / Assets menu)
  // ============================================================

  // Row within a character sheet for a growth stage: baby = row 0, adult = row 1.
  function stageRow(stage) {
    const dir = STAGE_DIRS[stage] || 2;
    return dir === 2 ? 0 : dir === 4 ? 1 : dir === 6 ? 2 : 3;
  }

  // Draws one character-sheet cell onto an HTML canvas element, centred and
  // scaled to fit. Used by every panel that shows an animal.
  function drawSpriteOnCanvas(cv, spriteName, stage) {
    if (!cv || !spriteName) return;
    const row = stageRow(stage);
    const bm = ImageManager.loadCharacter(spriteName);
    const render = () => {
      if (!bm || !bm.isReady() || !cv.getContext) return;
      const isBig = ImageManager.isBigCharacter(spriteName);
      const cols = isBig ? 3 : 12;
      const rows = isBig ? 4 : 8;
      const sw = bm.width / cols;
      const sh = bm.height / rows;
      const scale = Math.min(cv.height / sh, cv.width / sw, 3.0);
      const dw = Math.round(sw * scale);
      const dh = Math.round(sh * scale);
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        bm.canvas,
        0, row * sh, sw, sh,
        Math.round((cv.width - dw) / 2),
        Math.round((cv.height - dh) / 2),
        dw, dh
      );
    };
    if (bm.isReady()) render();
    else bm.addLoadListener(render);
  }

  // A single-frame Bitmap of an animal, for the Build menu's placement ghost.
  // The sheet's frame size is unknown until it loads, so the bitmap starts
  // tile-sized and resizes itself once the art is in.
  function frameBitmap(spriteName, stage) {
    const bmp = new Bitmap(48, 48);
    if (!spriteName) return bmp;
    const row = stageRow(stage);
    const src = ImageManager.loadCharacter(spriteName);
    const paint = () => {
      const isBig = ImageManager.isBigCharacter(spriteName);
      const cols = isBig ? 3 : 12;
      const rows = isBig ? 4 : 8;
      const sw = Math.floor(src.width / cols);
      const sh = Math.floor(src.height / rows);
      if (sw <= 0 || sh <= 0) return;
      bmp.resize(sw, sh);
      bmp.clear();
      bmp.blt(src, 0, row * sh, sw, sh, 0, 0);
    };
    if (src.isReady()) paint();
    else src.addLoadListener(paint);
    return bmp;
  }

  // ============================================================
  //  PLACED ANIMALS ON THE MAP
  // ============================================================

  // A placed animal is a real (dynamically spawned) event named "Animal", so it
  // renders, blocks and can be talked to through the normal engine paths. The
  // record stays the source of truth: the event is rebuilt from it on every map
  // load, which is why a wandering event id never has to be persisted.
  function spawnAnimalEvent(rec) {
    if (!$dataMap || !$gameMap) return null;
    const def = ANIMAL_DB[rec.animalId];
    if (!def) return null;
    if (!$dataMap.events) $dataMap.events = [null];
    const eventId = $dataMap.events.length;
    const sprite = getCurrentSprite(rec, def);
    $dataMap.events[eventId] = {
      id: eventId, name: "Animal", note: "",
      x: rec.x, y: rec.y,
      pages: [{
        conditions: {
          actorId: 1, actorValid: false, itemId: 1, itemValid: false,
          selfSwitchCh: "A", selfSwitchValid: false,
          switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
          variableId: 1, variableValid: false
        },
        directionFix: true,
        image: {
          tileId: 0, characterName: sprite, characterIndex: 0,
          direction: STAGE_DIRS[rec.stage] || 2, pattern: 1
        },
        list: [
          { code: 357, indent: 0, parameters: [pluginName, "InteractAnimal", "Interact With Animal", { uid: String(rec.uid) }] },  // i18n-ignore  plugin command id  // i18n-ignore  plugin command id
          { code: 0, indent: 0, parameters: [] }
        ],
        moveFrequency: 3,
        moveRoute: { list: [{ code: 0 }], repeat: true, skippable: false, wait: false },
        moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: true,
        through: false, trigger: 0, walkAnime: false
      }]
    };
    if (!$gameMap._events) $gameMap._events = [];
    const ev = new Game_Event($gameMap.mapId(), eventId);
    ev._animalUid = rec.uid;
    ev._isAnimalEvt = true;
    applySprite(ev, rec);
    $gameMap._events[eventId] = ev;
    return ev;
  }

  function findAnimalEvent(uid) {
    if (!$gameMap) return null;
    for (const ev of $gameMap.events()) {
      if (ev && ev._animalUid === uid) return ev;
    }
    return null;
  }

  // ============================================================
  //  FARMSTEAD LIVESTOCK (procedural maps)
  // ============================================================
  //
  // Somebody works this field. A procedural square carrying tilled soil - a
  // Farm biome, a village with crops behind it, a lone smallholding on a
  // Plains tile - is a farm, and a farm that has been ploughed but keeps no
  // animals reads as abandoned. Every such square is dealt 0 to 3 head of
  // livestock, ONCE, the first time the party ever walks onto it.
  //
  // They are the farm's, not the party's: the record carries `wild: true`, so
  // they never turn up in the Assets portfolio and cannot be sold, but they
  // graze, grow, produce and can be petted like any other animal, because they
  // go through the very same placement record every bought animal does.
  //
  // The roll is seeded on the square's own composite key (biome + world
  // coordinate + depth), so which animals a farm keeps is the same in every
  // savegame of the world and the same on every visit; and it is dealt once
  // and stored, so clearing a farm out does not repopulate it on the next load.
  const FARMSTEAD_MAX = 3;          // head of livestock a square can be dealt
  const FARMSTEAD_RING = 2;         // how far from the soil they are put down
  const PROC_MAP_ID_AGS = 636;

  // Only the procedural map grows crops procedurally; an authored farm map is
  // hand-populated and must not have livestock invented on top of it.
  function isProceduralMap() {
    return !!$gameMap && $gameMap.mapId() === PROC_MAP_ID_AGS;
  }

  function farmsteadDealt() {
    if (!$gameSystem._animalFarmsteads) $gameSystem._animalFarmsteads = {};
    return $gameSystem._animalFarmsteads;
  }

  // Every tile id the current tileset draws tilled soil with. Read from the
  // tileset's own <TilledSoil:> declaration, which is what the biome generator
  // stamps the fields from (ProceduralMapBiomeGenerator.placeTilledFields), so
  // the two can never disagree about what a ploughed tile is.
  function tilledSoilTileIds() {
    const U = window.ProcGenUtils;
    const tileset = $gameMap && $gameMap.tileset();
    if (!U || !U.Cache || !tileset) return null;
    const features = U.Cache.getTilesetFeatures(tileset.id) || {};
    const ids = new Set();
    for (const v of features["TilledSoil"] || []) {  // i18n-ignore  Features.json id
      if (v.type === "single" && v.tileId) ids.add(v.tileId);
      else if (v.grid) for (const row of v.grid) for (const t of row) if (t) ids.add(t);
    }
    return ids.size ? ids : null;
  }

  // Where livestock may stand: NEAR the crop, never in it. An animal dropped on
  // a sown tile stands in the middle of the plants and hides the crop event, so
  // the pasture is the ring of open ground around the field rather than the
  // field itself.
  function farmsteadPastureTiles() {
    const soilIds = tilledSoilTileIds();
    if (!soilIds) return [];
    const w = $gameMap.width();
    const h = $gameMap.height();
    const isSoil = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      for (const z of [1, 2, 3]) if (soilIds.has($gameMap.tileId(x, y, z))) return true;
      return false;
    };

    const soil = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (isSoil(x, y)) soil.push({ x, y });
    }
    if (!soil.length) return [];

    const seen = new Set();
    const pasture = [];
    for (const s of soil) {
      for (let dy = -FARMSTEAD_RING; dy <= FARMSTEAD_RING; dy++) {
        for (let dx = -FARMSTEAD_RING; dx <= FARMSTEAD_RING; dx++) {
          const x = s.x + dx, y = s.y + dy;
          const key = `${x},${y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (isSoil(x, y)) continue;            // the crop is not a pasture
          if (!canPlaceAnimalAt(x, y)) continue;
          pasture.push({ x, y });
        }
      }
    }
    return pasture;
  }

  // A stream of the square's own identity, so a farm keeps the same animals in
  // every savegame of the world and on every visit.
  function farmsteadRng(mapKey) {
    const U = window.ProcGenUtils;
    let h = 0x9e3779b1;
    const s = String(mapKey);
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    if (U && typeof U.getWorldSeed === "function") h = (h ^ (U.getWorldSeed() >>> 0)) | 0;
    if (U && typeof U.createSeededRandom === "function") return U.createSeededRandom(h >>> 0);
    return Math.random;
  }

  function spawnFarmsteadAnimals() {
    if (!isProceduralMap() || !$dataMap || !$gameMap) return;
    const key = currentMapKey();
    const dealt = farmsteadDealt();
    if (dealt[key]) return;                      // this square has had its turn

    const pasture = farmsteadPastureTiles();
    // No tilled soil (or nowhere to stand): not a farm, and not marked either,
    // because a square can be ploughed later and should be dealt its stock then.
    if (!pasture.length) return;

    dealt[key] = true;
    const rng = farmsteadRng(key);
    const count = Math.floor(rng() * (FARMSTEAD_MAX + 1));   // 0-3
    if (count === 0) return;

    const breeds = Object.keys(ANIMAL_DB);
    const list = placementsAt(key);
    for (let i = 0; i < count && pasture.length; i++) {
      const spot = pasture.splice(Math.floor(rng() * pasture.length), 1)[0];
      // Re-checked: an earlier animal in this same pass may have taken the tile.
      if (!canPlaceAnimalAt(spot.x, spot.y)) continue;
      const animalId = breeds[Math.floor(rng() * breeds.length)];
      const def = ANIMAL_DB[animalId];
      // A working farm keeps grown stock and the odd young one.
      const stage = (def.hasBaby && rng() < 0.25) ? "baby" : "adult";
      const rec = newRecord(animalId, stage);
      if (!rec) continue;
      rec.uid = nextPlacementUid();
      rec.x = spot.x;
      rec.y = spot.y;
      rec.mapId = $gameMap.mapId();
      rec.mapName = mapDisplayName(key);
      rec.wild = true;        // the farm's, never the party's
      rec.paid = 0;
      list.push(rec);
    }
  }

  // Rebuilds every animal owned at the current map key. Called before the
  // spriteset builds its character sprites so the animals are drawn with it.
  function spawnPlacedAnimals() {
    if (!$dataMap || !$gameMap) return;
    const key = currentMapKey();
    // The procedural map keeps the same $dataMap object across world
    // coordinates, so the already-spawned list is scoped to the key it was
    // built for and reset whenever the key changes.
    if ($dataMap._animalSpawnKey !== key) {
      $dataMap._animalSpawnKey = key;
      $dataMap._animalSpawned = [];
    }
    const list = placementsAt(key);
    for (const rec of list) {
      if (!rec || !rec.animalId) continue;
      if ($dataMap._animalSpawned.includes(rec.uid)) continue;
      updateRecordGrowth(rec);
      if (spawnAnimalEvent(rec)) $dataMap._animalSpawned.push(rec.uid);
    }
  }

  // True when a tile can take a new animal: on the map, walkable, and not
  // already occupied by an event (including another animal).
  function canPlaceAnimalAt(x, y) {
    if (!$gameMap || !$gameMap.isValid(x, y)) return false;
    if ($gameMap.eventIdXy(x, y) > 0) return false;
    // An animal stands on its tile like any character, so never drop one on
    // top of the player (or a follower): they would be walled in.
    if ($gamePlayer && $gamePlayer.pos(x, y)) return false;
    if ($gamePlayer && $gamePlayer.followers && $gamePlayer.followers().isSomeoneCollided(x, y)) return false;
    return $gameMap.isPassable(x, y, 2);
  }

  // Buys and places an animal at a tile. Money is charged by the caller (the
  // Build menu) so it can honour its own free-build rules.
  function placeAnimal(animalId, stage, x, y) {
    const def = ANIMAL_DB[animalId];
    if (!def) return null;
    const rec = newRecord(animalId, stage);
    if (!rec) return null;
    rec.uid = nextPlacementUid();
    rec.x = x;
    rec.y = y;
    rec.mapId = $gameMap ? $gameMap.mapId() : 0;
    rec.mapName = mapDisplayName(currentMapKey());
    placementsAt(currentMapKey()).push(rec);
    const ev = spawnAnimalEvent(rec);
    if (ev && $dataMap) {
      if (!$dataMap._animalSpawned) $dataMap._animalSpawned = [];
      $dataMap._animalSpawned.push(rec.uid);
      // The spriteset only builds character sprites once per map, so a
      // mid-session spawn has to be given its sprite explicitly.
      const spriteset = SceneManager._scene && SceneManager._scene._spriteset;
      if (spriteset && typeof spriteset.addAnimalCharacterSprite === "function") {
        spriteset.addAnimalCharacterSprite(ev);
      }
    }
    // Buying and settling an animal is the first half of keeping one.
    if (window.SpecializationXP) window.SpecializationXP.award("Animal Husbandry", 1);
    return rec;
  }

  // Drops a placed animal: removes the record and erases its on-map event.
  function removePlacement(uid) {
    const found = findPlacement(uid);
    if (!found) return null;
    const list = placementsAt(found.mapKey);
    const idx = list.indexOf(found.rec);
    if (idx >= 0) list.splice(idx, 1);
    const ev = findAnimalEvent(found.rec.uid);
    if (ev) ev.erase();
    if ($dataMap && Array.isArray($dataMap._animalSpawned)) {
      const si = $dataMap._animalSpawned.indexOf(found.rec.uid);
      if (si >= 0) $dataMap._animalSpawned.splice(si, 1);
    }
    return found.rec;
  }

  // Human-readable place name for a stored map key: either a procedural world
  // coordinate or a plain map name.
  function mapDisplayName(mapKey) {
    const key = String(mapKey);
    const proc = key.match(/^proc:([^:]*):(-?\d+),(-?\d+)(?::(\d+))?$/);
    if (proc) {
      const depth = Number(proc[4] || 0);
      const below = depth > 0 ? `, -${depth}` : "";
      return `${proc[1] || "Wilderness"} (${proc[2]},${proc[3]}${below})`;
    }
    const id = Number(key);
    if (Number.isFinite(id) && $dataMapInfos && $dataMapInfos[id]) {
      return $dataMapInfos[id].name || T('AnimalGrowth.mapNumbered', { id: id });
    }
    return T('AnimalGrowth.mapNumbered', { id: key });
  }

  // ============================================================
  //  OWNERSHIP ACTIONS (used by the Assets menu)
  // ============================================================

  // Every bought animal, ready for a portfolio listing.
  function listOwnedAnimals() {
    updateAllGrowth();
    const now = gameMinutes();
    const out = [];
    for (const { rec, mapKey } of allPlacements()) {
      // A farm's own stock is not the party's property, so it never appears in
      // the portfolio. It still grows and produces; it is just not an asset.
      if (rec.wild) continue;
      const def = ANIMAL_DB[rec.animalId];
      if (!def) continue;
      const stage = rec.stage || "adult";
      const progress = calcGrowthProgress(rec, def);
      const remaining = Math.max(0, def.growthDays * MINUTES_PER_DAY - (rec.effectiveGrowthMinutes || 0));
      const produces = (def.produces || []).map((prod, i) => {
        const item = $dataItems ? $dataItems[prod.itemId] : null;
        const timer = rec.produceTimers ? rec.produceTimers[`p${i}`] : undefined;
        const needed = prod.interval * MINUTES_PER_DAY;
        const elapsed = timer === undefined ? 0 : now - timer;
        return {
          itemId: prod.itemId,
          name: item ? item.name : T('AnimalGrowth.itemNumbered', { id: prod.itemId }),
          yieldMin: prod.yieldMin, yieldMax: prod.yieldMax,
          intervalDays: prod.interval,
          ready: stage === "adult" && timer !== undefined && elapsed >= needed,
          daysLeft: Math.max(0, Math.ceil((needed - elapsed) / MINUTES_PER_DAY)),
        };
      });
      out.push({
        uid: rec.uid,
        mapKey,
        mapName: rec.mapName || mapDisplayName(mapKey),
        animalId: rec.animalId,
        stage,
        stageName: STAGE_NAMES[stage] || stage,
        x: rec.x, y: rec.y,
        sprite: getCurrentSprite(rec, def),
        paid: rec.paid || 0,
        value: sellValueOf(rec, def),
        growthPct: Math.floor(progress * 100),
        daysToAdult: Math.ceil(remaining / MINUTES_PER_DAY),
        produces,
        hasReady: hasReadyProduce(rec, def),
      });
    }
    out.sort((a, b) => a.animalId.localeCompare(b.animalId) || a.uid - b.uid);
    return out;
  }

  function collectFromPlacement(uid) {
    const found = findPlacement(uid);
    if (!found) return [];
    const def = ANIMAL_DB[found.rec.animalId];
    if (!def) return [];
    updateRecordGrowth(found.rec);
    return collectProduce(found.rec, def);
  }

  // Sells a placed animal for its stage value and removes it from the world.
  function sellPlacement(uid) {
    const found = findPlacement(uid);
    if (!found) return null;
    // Nobody sells an animal they never bought. A farm's own stock is not on
    // the portfolio in the first place, so this is a backstop rather than a
    // path the player can reach.
    if (found.rec.wild) return null;
    const def = ANIMAL_DB[found.rec.animalId];
    const value = sellValueOf(found.rec, def);
    removePlacement(uid);
    if ($gameParty) $gameParty.gainGold(value);
    return { animalId: found.rec.animalId, stage: found.rec.stage, value };
  }

  // Promotes a placed animal into a pet: it stops being an asset and starts
  // trailing the party (PetFollowerSystem.js). No money changes hands.
  function petPlacement(uid) {
    const found = findPlacement(uid);
    if (!found) return null;
    const def = ANIMAL_DB[found.rec.animalId];
    if (!def) return null;
    const rec = found.rec;
    const sprite = getCurrentSprite(rec, def);
    if (!window.PetSystem || typeof window.PetSystem.recruitPet !== "function") return null;
    const pet = window.PetSystem.recruitPet({
      name: rec.animalId,
      characterName: sprite,
      characterIndex: 0,
      isFollower: false,
      note: T('AnimalGrowth.petNote', { stage: STAGE_NAMES[rec.stage] || rec.stage, animal: rec.animalId, place: rec.mapName || mapDisplayName(found.mapKey) }),
    });
    removePlacement(uid);
    return pet;
  }

  // ============================================================
  //  HOOKS
  // ============================================================

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    _Scene_Map_onMapLoaded.call(this);
    refreshMapAnimals();
  };

  // Placed animals must exist as events BEFORE the spriteset builds its
  // character sprites, exactly like FurnitureSystem's placed house doors.
  const _Spriteset_Map_createLowerLayer = Spriteset_Map.prototype.createLowerLayer;
  Spriteset_Map.prototype.createLowerLayer = function () {
    // The farm's own stock is dealt first, so a square being walked onto for
    // the first time has its livestock in the placement list before the spawn
    // pass below turns that list into events.
    spawnFarmsteadAnimals();
    spawnPlacedAnimals();
    _Spriteset_Map_createLowerLayer.call(this);
  };

  // Gives a mid-session spawned animal its character sprite without rebuilding
  // the whole spriteset.
  Spriteset_Map.prototype.addAnimalCharacterSprite = function (event) {
    if (!this._characterSprites || !this._tilemap) return;
    const sprite = new Sprite_Character(event);
    this._characterSprites.push(sprite);
    this._tilemap.addChild(sprite);
  };

  const _Game_Event_update = Game_Event.prototype.update;
  Game_Event.prototype.update = function (sceneActive) {
    _Game_Event_update.call(this, sceneActive);
    if (!isAnimalEvent(this)) return;
    // Placed animals: keep the sheet row locked to the growth stage and swap
    // the sprite the moment a baby becomes an adult. Checked on a slow beat so
    // this per-frame hook stays cheap.
    if (this._animalUid) {
      if ((Graphics.frameCount & 63) !== 0) return;
      const found = findPlacement(this._animalUid);
      if (!found) return;
      updateRecordGrowth(found.rec);
      if (this._animalStageShown !== found.rec.stage) applySprite(this, found.rec);
      const dir = STAGE_DIRS[found.rec.stage] || 2;
      if (this._direction !== dir) this._direction = dir;
      return;
    }
    // Legacy event slots: cache the record key (stable per event) and only
    // write when changed, to keep this hook allocation-free.
    if (this._animalRecKey === undefined) {
      this._animalRecKey = animalKey($gameMap.mapId(), this._eventId);
    }
    const data = $gameSystem._animalData;
    const rec = data ? data[this._animalRecKey] : null;
    if (rec && rec.animalId && ANIMAL_DB[rec.animalId]) {
      const dir = STAGE_DIRS[rec.stage] || 2;
      if (this._direction !== dir) this._direction = dir;
    }
  };

  const _Game_Event_setupPageSettings = Game_Event.prototype.setupPageSettings;
  Game_Event.prototype.setupPageSettings = function () {
    _Game_Event_setupPageSettings.call(this);
    if (!$gameMap || !isAnimalEvent(this)) return;
    if (this._animalUid) {
      const found = findPlacement(this._animalUid);
      if (found) applySprite(this, found.rec);
      return;
    }
    const rec = getRecord($gameMap.mapId(), this._eventId);
    if (rec && rec.animalId) applySprite(this, rec);
  };

  const _Game_Event_lock = Game_Event.prototype.lock;
  Game_Event.prototype.lock = function () {
    if (isAnimalEvent(this)) return;
    _Game_Event_lock.call(this);
  };

  // ============================================================
  //  PLUGIN COMMANDS
  // ============================================================

  // Buying moved into the Build menu, so both legacy commands now just open it
  // on the Animals tab.
  function openAnimalsTab() {
    const fs = window.FurnitureSystem;
    if (fs && typeof fs.openBuildMenu === "function" && fs.openBuildMenu("animals")) return;
    window.skipLocalization = true;
    $gameMessage.add(T('AnimalGrowth.cannotKeep'));
    window.skipLocalization = false;
  }

  PluginManager.registerCommand(pluginName, "AnimalMenu", openAnimalsTab);
  PluginManager.registerCommand(pluginName, "BuyAnimal", openAnimalsTab);

  PluginManager.registerCommand(pluginName, "SellAnimal", function () {
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    updateGrowth(mapId, eventId);
    const rec = getRecord(mapId, eventId);
    if (!rec || !rec.animalId) {
      window.skipLocalization = true;
      $gameMessage.add(T('AnimalGrowth.noAnimalToSell'));
      window.skipLocalization = false;
      return;
    }
    const def = ANIMAL_DB[rec.animalId];
    const val = sellValueOf(rec, def);
    $gameParty.gainGold(val);
    SoundManager.playShop();
    window.skipLocalization = true;
    $gameMessage.add(T('AnimalGrowth.sold', { animal: rec.animalId, amount: (val / 100).toFixed(2) }));
    window.skipLocalization = false;
    deleteRecord(mapId, eventId);
    const ev = $gameMap.event(eventId);
    if (ev) applySprite(ev, null);
  });

  PluginManager.registerCommand(pluginName, "CollectProduce", function () {
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    updateGrowth(mapId, eventId);
    const rec = getRecord(mapId, eventId);
    if (!rec || !rec.animalId) return;
    const def = ANIMAL_DB[rec.animalId];
    if (!def) return;
    const items = collectProduce(rec, def);
    if (items.length > 0) {
      SoundManager.playShop();
      reportCollected(items);
      saveRecord(mapId, eventId, rec);
    } else {
      window.skipLocalization = true;
      $gameMessage.add(T('AnimalGrowth.nothingToCollect'));
      window.skipLocalization = false;
    }
  });

  PluginManager.registerCommand(pluginName, "RemoveAnimal", function () {
    const eventId = this.eventId();
    const mapId = $gameMap.mapId();
    const rec = getRecord(mapId, eventId);
    if (!rec || !rec.animalId) return;
    deleteRecord(mapId, eventId);
    const ev = $gameMap.event(eventId);
    if (ev) applySprite(ev, null);
  });

  // Talking to a placed animal: hand over anything it has ready, otherwise
  // report how it is doing.
  PluginManager.registerCommand(pluginName, "InteractAnimal", function (args) {
    const found = findPlacement(args && args.uid);
    if (!found) return;
    const rec = found.rec;
    const def = ANIMAL_DB[rec.animalId];
    if (!def) return;
    updateRecordGrowth(rec);
    const items = collectProduce(rec, def);
    if (items.length > 0) {
      SoundManager.playShop();
      reportCollected(items);
      return;
    }
    window.skipLocalization = true;
    if (rec.stage === "baby") {
      const remaining = Math.max(0, def.growthDays * MINUTES_PER_DAY - (rec.effectiveGrowthMinutes || 0));
      const days = Math.ceil(remaining / MINUTES_PER_DAY);
      $gameMessage.add(T.n('AnimalGrowth.youngAnimal', days, { animal: rec.animalId }));
    } else if ((def.produces || []).length === 0) {
      $gameMessage.add(T('AnimalGrowth.pleased', { animal: rec.animalId }));
    } else {
      $gameMessage.add(T('AnimalGrowth.nothingReady', { animal: rec.animalId }));
    }
    window.skipLocalization = false;
  });

  // Public API for NPCSimulationCore, FurnitureSystem, AssetsMenu and others
  window.AnimalGrowthSystem = {
    ANIMAL_DB,
    STAGE_NAMES,
    STAGE_DIRS,
    MINUTES_PER_DAY,
    getRecord:          (mapId, eventId) => getRecord(mapId, eventId),
    saveRecord:         (mapId, eventId, rec) => saveRecord(mapId, eventId, rec),
    deleteRecord:       (mapId, eventId) => deleteRecord(mapId, eventId),
    updateGrowth:       (mapId, eventId) => updateGrowth(mapId, eventId),
    hasReadyProduce:    (rec, def) => hasReadyProduce(rec, def),
    collectProduce:     (rec, def) => collectProduce(rec, def),
    calcGrowthProgress: (rec, def) => calcGrowthProgress(rec, def),
    getCurrentSprite:   (rec, def) => getCurrentSprite(rec, def),
    gameMinutes:        () => gameMinutes(),
    randomPick:         (arr) => randomPick(arr),
    hasFreeSlot:        () => hasFreeSlot(),
    applySprite:        (event, rec) => applySprite(event, rec),
    // Build menu services
    buyCostOf:          (def, stage) => buyCostOf(def, stage),
    canPlaceAnimalAt:   (x, y) => canPlaceAnimalAt(x, y),
    placeAnimal:        (animalId, stage, x, y) => placeAnimal(animalId, stage, x, y),
    drawSpriteOnCanvas: (cv, sprite, stage) => drawSpriteOnCanvas(cv, sprite, stage),
    frameBitmap:        (sprite, stage) => frameBitmap(sprite, stage),
    // Assets menu services
    listOwnedAnimals:   () => listOwnedAnimals(),
    collectFromPlacement: (uid) => collectFromPlacement(uid),
    sellPlacement:      (uid) => sellPlacement(uid),
    petPlacement:       (uid) => petPlacement(uid),
    mapDisplayName:     (key) => mapDisplayName(key),
  };

})();
