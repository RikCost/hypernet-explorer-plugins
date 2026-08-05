/*:
 * @target MZ
 * @plugindesc v1.0.0 Item System Utilities - Common functions for item systems
 * @author Omni-Lex
 * @help ItemSystemUtils.js
 *
 * This plugin provides shared utility functions for item systems.
 * It should be loaded BEFORE ItemSystemInventory and ItemSystemShop.
 *
 * Provides:
 * - Weight system calculations
 * - Item category checking
 * - Nutrition value extraction
 * - Text formatting utilities
 * - Actor bust image paths
 *
 * Terms of Use:
 * Free for use in both commercial and non-commercial projects.
 */

(function () {
  "use strict";

  //=============================================================================
  // Plugin Parameters
  //=============================================================================
  const BASE_CARRY_WEIGHT = 60000; // 60kg in grams (minimum per character)
  const COS_WEIGHT_BONUS = 300; // 300g per COS point (constitution / param 3)
  const FOR_WEIGHT_BONUS = 500; // 500g per FOR point (strength / param 2)
  const OVERENCUMBERED_SPEED_PENALTY = 0.5; // 50% movement speed
  const FOOD_HP_RECOVERY_VARIABLE_ID = 28;
  const FOOD_COMMON_EVENT_ACTOR1 = 23;
  const FOOD_COMMON_EVENT_ACTOR2 = 24;
  const FOOD_COMMON_EVENT_ACTOR3 = 25;
  const { SpritesAssociation } = window.Sprites || {};

  //=============================================================================
  // Weight caches (perf): item notes are static, so per-item weight is parsed
  // once; total/max carry weight are recomputed only when inventory, equipment
  // or party composition changes (dirty flag set by the aliases below).
  //=============================================================================
  const _itemWeightCache = new Map();
  let _weightCacheDirty = true;
  let _cachedTotalWeight = 0;
  let _cachedMaxCarryWeight = 0;

  function invalidateWeightCache() {
    _weightCacheDirty = true;
  }

  //=============================================================================
  // Stack Cap: items/weapons/armors can stack up to 9999 (raised from the
  // RMMZ default of 99). Game_Party.gainItem clamps to this via maxItems(item).
  //=============================================================================
  Game_Party.prototype.maxItems = function (/*item*/) {
    return 9999;
  };

  //=============================================================================
  // Global Item System Utilities
  //=============================================================================

  window.ItemSystemUtils = {
    // Export constants
    BASE_CARRY_WEIGHT,
    COS_WEIGHT_BONUS,
    FOR_WEIGHT_BONUS,
    OVERENCUMBERED_SPEED_PENALTY,
    FOOD_HP_RECOVERY_VARIABLE_ID,
    FOOD_COMMON_EVENT_ACTOR1,
    FOOD_COMMON_EVENT_ACTOR2,
    FOOD_COMMON_EVENT_ACTOR3,

    /**
     * Get item weight from note tag
     */
    getItemWeight: function (item) {
      if (!item || !item.note) return 1; // Minimum 1 gram

      let grams = _itemWeightCache.get(item);
      if (grams === undefined) {
        const match = item.note.match(/<weight:\s*(\d+)>/i);
        if (match) {
          grams = Math.max(1, parseInt(match[1]));
          // Food is modestly lightened so survival stocking does not overencumber (#141).
          if (this.isFoodItem(item)) grams = Math.max(1, Math.round(grams * 0.5));
        } else {
          grams = 1; // Default 1 gram
        }
        _itemWeightCache.set(item, grams);
      }
      return grams;
    },

    /**
     * Calculate total inventory weight (only unequipped items)
     */
    calculateTotalWeight: function () {
      if (_weightCacheDirty) this._refreshWeightCaches();
      return _cachedTotalWeight;
    },

    _computeTotalWeight: function () {
      let totalWeight = 0;

      // 1. Regular items
      const items = $gameParty.items();
      for (const item of items) {
        totalWeight += this.getItemWeight(item) * $gameParty.numItems(item);
      }

      // 2. Get a copy of weapon and armor counts
      const weapons = Object.assign({}, $gameParty._weapons);
      const armors = Object.assign({}, $gameParty._armors);

      // 3. Subtract equipped items
      for (const actor of $gameParty.members()) {
        for (const equip of actor.equips()) {
          if (equip) {
            if (DataManager.isWeapon(equip)) {
              if (weapons[equip.id]) {
                weapons[equip.id]--;
              }
            } else if (DataManager.isArmor(equip)) {
              if (armors[equip.id]) {
                armors[equip.id]--;
              }
            }
          }
        }
      }

      // 4. Calculate weight of unequipped weapons
      for (const weaponId in weapons) {
        if (weapons[weaponId] > 0) {
          const weapon = $dataWeapons[weaponId];
          totalWeight += this.getItemWeight(weapon) * weapons[weaponId];
        }
      }

      // 5. Calculate weight of unequipped armors
      for (const armorId in armors) {
        if (armors[armorId] > 0) {
          const armor = $dataArmors[armorId];
          totalWeight += this.getItemWeight(armor) * armors[armorId];
        }
      }

      return totalWeight;
    },

    /**
     * Calculate max carry weight.
     * Each party member contributes a base of 60kg (minimum), increased by
     * their FOR (strength / param 2) and COS (constitution / param 3).
     */
    calculateMaxCarryWeight: function () {
      if (_weightCacheDirty) this._refreshWeightCaches();
      return _cachedMaxCarryWeight;
    },

    _computeMaxCarryWeight: function () {
      const members = $gameParty.members();
      if (!members.length) return BASE_CARRY_WEIGHT;

      let total = 0;
      for (const actor of members) {
        const str = actor.param(2); // FOR / strength
        const con = actor.param(3); // COS / constitution
        total += BASE_CARRY_WEIGHT + str * FOR_WEIGHT_BONUS + con * COS_WEIGHT_BONUS;
      }

      return total;
    },

    _refreshWeightCaches: function () {
      _cachedTotalWeight = this._computeTotalWeight();
      _cachedMaxCarryWeight = this._computeMaxCarryWeight();
      _weightCacheDirty = false;
    },

    /**
     * Invalidate the cached total/max carry weight (recomputed lazily).
     */
    invalidateWeightCache: invalidateWeightCache,

    /**
     * Check if party is overencumbered
     */
    isOverencumbered: function () {
      return this.calculateTotalWeight() > this.calculateMaxCarryWeight();
    },

    /**
     * Format weight for display
     */
    formatWeight: function (grams) {
      if (grams < 1000) {
        return grams + "g";
      } else {
        return (grams / 1000).toFixed(1) + "kg";
      }
    },

    /**
     * Get nutrition value from item note tag
     */
    getNutritionValue: function (item, nutrient) {
      if (!item || !item.note) return 0;
      const regex = new RegExp(`<${nutrient}:\\s*(\\d+)>`, "i");
      const match = item.note.match(regex);
      return match ? parseInt(match[1]) : 0;
    },

    //=========================================================================
    // Need restoration (Hunger / Sleep / Hygiene / Social / Fun)
    //
    // Non-food consumables can declare which survival need they replenish via a
    // note tag:  <NeedRestore: leisure 40>  (or several, comma-separated:
    // <NeedRestore: hygiene 30, social 15>). The amount is a 1-100 satisfaction
    // value applied directly to the actor's need meter on use. Food items keep
    // using <calories:>/<protein:>/<fat:> for hunger instead.
    //=========================================================================
    NEED_KEYS: ["hunger", "sleep", "hygiene", "social", "leisure"],
    // Displayed label per need; "leisure" reads as "Fun" everywhere else in the UI.
    // Both label tables now resolve on read; NEED_KEYS above stay the ids.
    get NEED_LABELS() { return T.obj('ItemUtils.need'); },
    get NEED_LABELS_IT() { return T.obj('ItemUtils.need'); },
    NEED_ADDERS:    { hunger: "addHunger", sleep: "addSleep", hygiene: "addHygiene", social: "addSocial", leisure: "addLeisure" },
    NEED_COLORS:    { hunger: "#c0392b", sleep: "#2980b9", hygiene: "#16a085", social: "#8e44ad", leisure: "#d4a64e" },

    /**
     * Localized label for a need key.
     */
    getNeedLabel: function (key) {
      return this.NEED_LABELS[key] || key;
    },

    /**
     * Parse <NeedRestore: ...> tags into [{ key, amount, label, color }].
     * Returns an empty array when the item declares none.
     */
    getNeedRestores: function (item) {
      if (!item || !item.note) return [];
      const out = [];
      const re = /<needRestore:\s*([^>]+)>/gi;
      let m;
      while ((m = re.exec(item.note)) !== null) {
        m[1].split(",").forEach((part) => {
          const t = part.trim().match(/([a-zA-Z]+)\s*[:= ]\s*(\d+)/);
          if (!t) return;
          const key = t[1].toLowerCase();
          if (!this.NEED_KEYS.includes(key)) return;
          out.push({
            key,
            amount: Math.max(1, Math.min(100, parseInt(t[2], 10))),
            label: this.getNeedLabel(key),
            color: this.NEED_COLORS[key] || "#5c4033",
          });
        });
      }
      return out;
    },

    /**
     * Silently apply an item's declared need restoration to a single actor.
     * The actor need methods already write where each meter lives (the extended
     * meters of a recruited member live on their society profile), so only
     * hunger and sleep, which the party shares, are mirrored onto the profile
     * of a recruited member so the society simulation sees the meal too.
     * Returns the applied restores.
     */
    applyNeedRestores: function (actor, item) {
      const restores = this.getNeedRestores(item);
      if (!restores.length || !actor) return [];
      const isLeaderActor = actor.actorId && actor.actorId() === 1;
      const profile = (!isLeaderActor && window.NPCSocietyRegistry && window.NPCSocietyRegistry.getProfile)
        ? window.NPCSocietyRegistry.getProfile(actor.name())
        : null;
      restores.forEach((r) => {
        const adder = this.NEED_ADDERS[r.key];
        if (adder && typeof actor[adder] === "function") actor[adder](r.amount);
        const mirrored = r.key === "hunger" || r.key === "sleep";
        if (mirrored && profile && typeof profile[r.key] === "number") {
          profile[r.key] = Math.max(0, Math.min(100, profile[r.key] + r.amount));
        }
      });
      return restores;
    },

    /**
     * Check if item has Food category
     */
    isFoodItem: function (item) {
      if (!item || !item.note) return false;
      return /<category:Food>/i.test(item.note);
    },

    /**
     * Check if item has Tools category
     */
    isToolsItem: function (item) {
      if (!item || !item.note) return false;
      return /<category:Tools>/i.test(item.note);
    },

    /**
     * Check if item has Medical category
     */
    isMedicalItem: function (item) {
      if (!item || !item.note) return false;
      return /<category:Medical>/i.test(item.note);
    },

    /**
     * Count items in each category
     */
    countMedicalItems: function () {
      return $gameParty.allItems().filter((item) => DataManager.isItem(item) && this.isMedicalItem(item)).length;
    },

    countFoodItems: function () {
      return $gameParty.allItems().filter((item) => DataManager.isItem(item) && this.isFoodItem(item)).length;
    },

    countToolsItems: function () {
      return $gameParty.allItems().filter((item) => DataManager.isItem(item) && this.isToolsItem(item)).length;
    },

    countWeapons: function () {
      return $gameParty.weapons().length;
    },

    countArmors: function () {
      return $gameParty.armors().length;
    },

    countMaterials: function () {
      return $gameParty.allItems().filter((item) => DataManager.isItem(item) && item.itypeId === 2).length;
    },

    countTrash: function () {
      return $gameParty.allItems().filter((item) => item && (!DataManager.isItem(item) || item.itypeId !== 2)).length;
    },

    /**
     * Get the raw category name from item note tag
     */
    getRawCategoryFromNote: function (item) {
      if (!item || !item.note) return null;
      const match = item.note.match(/<category:\s*(\w+)>/i);
      return match ? match[1] : null;
    },

    /**
     * Get item category name for display
     */
    getItemCategoryName: function (item) {
      if (!item) return null;

      // First, check if item has a category tag in notes
      const rawCategory = this.getRawCategoryFromNote(item);
      if (rawCategory) {
        return rawCategory; // Return the exact category name from the tag
      }

      // If no category tag, return general item type
      if (DataManager.isItem(item)) {
        if (item.itypeId === 2) {
          return T('ItemUtils.category.materials');
        }
        return T('ItemUtils.category.item');
      }
      if (DataManager.isWeapon(item)) {
        // Return the actual weapon type name (Light, Sword, Heavy, etc.)
        let weaponTypeName = $dataSystem.weaponTypes[item.wtypeId];
        if (window.translateText && typeof window.translateText === "function") {
          weaponTypeName = window.translateText(weaponTypeName);
        }
        return weaponTypeName;
      }
      if (DataManager.isArmor(item)) {
        // Return the actual armor type name (Helmet, Armor, Shield, etc.)
        let armorTypeName = $dataSystem.armorTypes[item.atypeId];
        if (window.translateText && typeof window.translateText === "function") {
          armorTypeName = window.translateText(armorTypeName);
        }
        return armorTypeName;
      }

      if (this.isFoodItem(item)) {
        return T('ItemUtils.category.food');
      }
      if (this.isToolsItem(item)) {
        return T('ItemUtils.category.tools');
      }

      // Return general item type for all other items
      if (DataManager.isItem(item)) {
        if (item.itypeId === 2) {
          return T('ItemUtils.category.materials');
        }
        return T('ItemUtils.category.item');
      }

      return null;
    },

    /**
     * Get bust image path based on actor ID and custom variables
     */
    getActorBustImagePath: function (actor) {
      if (!actor) return null;

      const actorId = actor.actorId && actor.actorId();
      const characterName = actor.characterName();

      // Player 1 (Actor 1) special handling
      if (actorId === 1) {
        // Priority 1: Check Variable 109 (Player 1 bust name)
        const player1BustName = $gameActors.actor(1).vnBust();
        if (player1BustName && player1BustName !== "") {
          return "img/busts/" + player1BustName;
        }

        // Priority 2: If Switch 77 is ON, use Variable 106 for monster form
        if ($gameSwitches.value(77)) {
          const player1MonsterName = $gameActors.actor(1).vnBattler();
          if (player1MonsterName && player1MonsterName !== "") {
            return "img/enemies/" + player1MonsterName;
          }
        }

        // Priority 3: Fall back to SpritesAssociation
        if (characterName && SpritesAssociation) {
          const spritesheetName = characterName.split('.')[0];
          const characterIndex = actor.characterIndex();

          if (SpritesAssociation[spritesheetName] &&
            SpritesAssociation[spritesheetName][characterIndex]) {
            const bustName = SpritesAssociation[spritesheetName][characterIndex];
            return "img/busts/" + bustName;
          }
        }

        return "img/busts/7";
      }

      // Players 2 & 3: same priority as Player 1. The bust name comes first,
      // then the battler image when the slot is flagged as a creature (switch
      // 78/79) - that field holds an img/enemies/ name, never a bust one.
      if (actorId === 2 || actorId === 3) {
        const bustName = actor.vnBust();
        if (bustName && bustName !== "") {
          return "img/busts/" + bustName;
        }
        if ($gameSwitches.value(actorId === 2 ? 78 : 79)) {
          const monsterName = actor.vnBattler();
          if (monsterName && monsterName !== "") {
            return "img/enemies/" + monsterName;
          }
        }
      }

      // Fallback to SpritesAssociation for actors 2 & 3
      if (characterName && SpritesAssociation) {
        const spritesheetName = characterName.split('.')[0];
        const characterIndex = actor.characterIndex();

        if (SpritesAssociation[spritesheetName] &&
          SpritesAssociation[spritesheetName][characterIndex]) {
          const bustName = SpritesAssociation[spritesheetName][characterIndex];
          return "img/busts/" + bustName;
        }
      }

      // Final fallback to default bust path structure
      return "img/busts/7";
    },

    /**
     * Truncate text and add ellipsis if needed
     */
    truncateTextWithEllipsis: function (text, maxLength) {
      if (text.length > maxLength) {
        return text.substring(0, maxLength - 3) + "...";
      }
      return text;
    },

    /**
     * Check if item has specific category
     */
    hasItemCategory: function (item, category) {
      if (!item || !item.note) return false;
      const regex = new RegExp(`<category:${category}>`, "i");
      return regex.test(item.note);
    },

    /**
     * Rarity Tiers configuration
     */
    RARITY_TIERS: [
      // i18n-ignore-start  rarity ids; the label is ItemUtils.rarity.<id>
      { name: "Common", colorCode: "#FFFFFF", minPrice: 0, maxPrice: 999 },
      { name: "Uncommon", colorCode: "#1AFF1A", minPrice: 1000, maxPrice: 9999 },
      { name: "Rare", colorCode: "#0080FF", minPrice: 10000, maxPrice: 99999 },
      { name: "Epic", colorCode: "#8000FF", minPrice: 100000, maxPrice: 999999 },
      { name: "Legendary", colorCode: "#FF8000", minPrice: 1000000, maxPrice: Infinity }
    ],
    // i18n-ignore-end
    rarityLabel: function (id) {
      const key = 'ItemUtils.rarity.' + String(id || '');
      return T.has(key) ? T(key) : String(id || '');
    },

    /**
     * Get item rarity based on price
     */
    getItemRarity: function (item) {
      if (!item) return this.RARITY_TIERS[0];
      const price = item.price || 0;
      return this.RARITY_TIERS.find(tier => 
        price >= tier.minPrice && 
        (tier.maxPrice === null || tier.maxPrice === undefined || price <= tier.maxPrice)
      ) || this.RARITY_TIERS[0];
    }
  };

  // Load rarity from JSON
  fetch('js/db/Items/Rarity.json')
    .then(response => response.json())
    .then(data => {
      window.ItemSystemUtils.RARITY_TIERS = data;
    })
    .catch(err => {
      console.warn("Failed to load Rarity.json, using fallback tiers:", err);
    });

  //=============================================================================
  // Weight cache invalidation hooks
  //=============================================================================

  const _Game_Party_gainItem = Game_Party.prototype.gainItem;
  Game_Party.prototype.gainItem = function (item, amount, includeEquip) {
    _Game_Party_gainItem.call(this, item, amount, includeEquip);
    invalidateWeightCache();
  };

  const _Game_Party_addActor = Game_Party.prototype.addActor;
  Game_Party.prototype.addActor = function (actorId) {
    _Game_Party_addActor.call(this, actorId);
    invalidateWeightCache();
  };

  const _Game_Party_removeActor = Game_Party.prototype.removeActor;
  Game_Party.prototype.removeActor = function (actorId) {
    _Game_Party_removeActor.call(this, actorId);
    invalidateWeightCache();
  };

  const _Game_Actor_changeEquip = Game_Actor.prototype.changeEquip;
  Game_Actor.prototype.changeEquip = function (slotId, item) {
    _Game_Actor_changeEquip.call(this, slotId, item);
    invalidateWeightCache();
  };

  const _Game_Actor_forceChangeEquip = Game_Actor.prototype.forceChangeEquip;
  Game_Actor.prototype.forceChangeEquip = function (slotId, item) {
    _Game_Actor_forceChangeEquip.call(this, slotId, item);
    invalidateWeightCache();
  };

  // Actor params (FOR/COS) can also change on level up / state changes;
  // refresh() runs on those occasions (not per frame), so hook it too.
  const _Game_Actor_refresh = Game_Actor.prototype.refresh;
  Game_Actor.prototype.refresh = function () {
    _Game_Actor_refresh.call(this);
    invalidateWeightCache();
  };

  // New game / loaded save replace $gameParty entirely.
  const _DataManager_createGameObjects = DataManager.createGameObjects;
  DataManager.createGameObjects = function () {
    _DataManager_createGameObjects.call(this);
    invalidateWeightCache();
  };

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    invalidateWeightCache();
  };

  //=============================================================================
  // Game_Player Movement Speed Override
  //=============================================================================

  const _Game_Player_realMoveSpeed = Game_Player.prototype.realMoveSpeed;
  Game_Player.prototype.realMoveSpeed = function () {
    let speed = _Game_Player_realMoveSpeed.call(this);

    // Apply encumbrance penalty (skip in sandbox/test mode)
    const isSandbox = ($gameSystem && $gameSystem._isSandboxMode) ||
      ($gameParty && $gameParty.leader && $gameParty.leader() && $gameParty.leader().name() === "Test");  // i18n-ignore  debug account name
    if (!isSandbox && window.ItemSystemUtils && window.ItemSystemUtils.isOverencumbered()) {
      speed = Math.max(1, speed * OVERENCUMBERED_SPEED_PENALTY);
    }

    return speed;
  };

})();

/* =========================================================================
 * Procedural Lore Tokens (integrated into the Item System).
 * Resolves {nation}/{leader}/{title}/{govType}/{city}/{faction}/{deity}
 * tokens in an item or armor <Lore:> string, deterministically per item id,
 * from the live world-generation system (NPCPolitics / NPCWorldWeb), with a
 * static lore-flavored fallback when the world is not generated yet.
 * Exposed as window.ItemSystemUtils.fillLore(template, refId, reseed) and the
 * back-compat alias window.ArmorLore.fill used by the inventory/shop/item UIs.
 * The third argument is optional and defaults to 0; pass a non-zero nonce to
 * preview a different roll of the same lore (see HypernetObjectIndex.js). It
 * never writes anything back, so the canonical text is untouched.
 * ========================================================================= */
(function () {
  "use strict";

  // i18n-ignore-start  invented world proper nouns: nations, leaders, titles
  // and government forms, used only when world gen has not produced any yet
  var FALLBACK = {
    nation: ["Varlenia", "the Serene Republic of Ghent", "the Naguka Reach", "Beagle",
             "the Antwerp Pale", "the Verden Holdfast", "the Abyssal Marches", "New Westford"],
    leader: ["Margaret Thatcher", "Aleister Crowley", "Eris", "General Voss",
             "Archon Maelis", "Solomon Vane", "Enrico Mattei", "Iris Calder"],
    title:  ["Sultan", "Prime Minister", "Archon", "General Secretary",
             "High Priest", "First Speaker", "Warlord"],
    govType:["the sultanate", "the serene republic", "the technocracy",
             "the warband confederacy", "the divine pantheon", "the corporatocracy"],
    city:   ["Beagle", "Ghent", "Antwerp", "Varlenia City", "the Road's end",
             "Westford", "the City of Ghosts"],
    faction:["the Mages Guild", "the Archive Foundation", "the Hypercapitalist Collective",
             "Esoteric Heavy Industries", "the Trucker Society", "the Gods"],
    deity:  ["Eris", "the Asphalt God", "the slain Father", "a bound demiurge",
             "the Prime Deity", "an oil-born elemental"]
  };
  // i18n-ignore-end

  function worldSeed() {
    try {
      if (window.NPCShared && typeof NPCShared.worldSeed === "function") return NPCShared.worldSeed() >>> 0;
      if (window.HistoryManager && typeof HistoryManager.getSeed === "function") return HistoryManager.getSeed() >>> 0;
    } catch (e) {}
    return 19002001;
  }

  // reseed is an optional extra mixin (default 0) that lets a caller ask for a
  // different roll of the same lore without touching the world seed or the item
  // id. Only the Object Index's "randomize" preview uses it; at 0 every stage
  // below is bit-identical to what it produced before the parameter existed.
  function roll(refId, salt, reseed) {
    var h = (worldSeed() ^ (((refId | 0) + 1) * 2654435761) ^ (salt * 0x9E3779B1)) >>> 0;
    if (reseed) h = (h ^ mixReseed(reseed)) >>> 0;
    h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
    return h >>> 0;
  }

  // Avalanche the reseed before it is mixed in, so consecutive nonces (1, 2, 3)
  // do not produce neighbouring streams that pick the same options.
  function mixReseed(n) {
    var h = (n >>> 0) || 0x9E3779B1;
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function pickFrom(arr, refId, salt, reseed) {
    if (!arr || !arr.length) return null;
    var v = arr[roll(refId, salt, reseed) % arr.length];
    if (v && typeof v === "object") v = v.name || v.group || v.title || null;
    return (typeof v === "string" && v.length) ? v : null;
  }

  function powerNames() {
    try { if (window.NPCPolitics && typeof NPCPolitics.listPowers === "function") { var p = NPCPolitics.listPowers(); if (p && p.length) return p; } } catch (e) {}
    return null;
  }
  function cityNames() {
    try { if (window.NPCWorldWeb && typeof NPCWorldWeb.listGroups === "function") { var g = NPCWorldWeb.listGroups(); if (g && g.length) return g; } } catch (e) {}
    return null;
  }
  function powerObj(name) {
    try { if (window.NPCPolitics && typeof NPCPolitics.getPower === "function") return NPCPolitics.getPower(name); } catch (e) {}
    return null;
  }

  function resolve(refId, reseed) {
    var ctx = {};
    var powers = powerNames();
    var cities = cityNames();
    ctx.nation  = pickFrom(powers, refId, 1, reseed) || pickFrom(FALLBACK.nation, refId, 1, reseed);
    ctx.faction = pickFrom(powers, refId, 3, reseed) || pickFrom(FALLBACK.faction, refId, 3, reseed);
    ctx.city    = pickFrom(cities, refId, 2, reseed) || pickFrom(FALLBACK.city, refId, 2, reseed);
    var p = powerObj(ctx.nation);
    if (p) {
      try {
        var head = p.politicians && p.headId != null ? p.politicians[p.headId] : null;
        ctx.leader  = (head && head.name) || pickFrom(FALLBACK.leader, refId, 4, reseed);
        ctx.title   = p.headTitle || pickFrom(FALLBACK.title, refId, 5, reseed);
        ctx.govType = p.govType ? ("the " + p.govType) : pickFrom(FALLBACK.govType, refId, 6, reseed);
      } catch (e) {}
    }
    if (!ctx.leader)  ctx.leader  = pickFrom(FALLBACK.leader, refId, 4, reseed);
    if (!ctx.title)   ctx.title   = pickFrom(FALLBACK.title, refId, 5, reseed);
    if (!ctx.govType) ctx.govType = pickFrom(FALLBACK.govType, refId, 6, reseed);
    ctx.deity = pickFrom(FALLBACK.deity, refId, 7, reseed);
    return ctx;
  }

  // ---- Combinatorial skill-lore generator -------------------------------
  // A <Lore:> value of the form "#School" (or "#School!" to force the
  // forbidden family) is not a finished sentence but a directive: build the
  // lore at runtime from the js/db/Skills/Lore.json grammar, seeded from the
  // live world seed XOR the skill id, so every world tells its own history.
  // The assembled text still carries {faction}/{city}/... tokens, which the
  // normal token pass below fills. See gen_skill_lore.py.
  function grammar() {
    return (window.Skills && window.Skills.Lore) ? window.Skills.Lore : null;
  }

  // Deterministic xorshift stream seeded by worldSeed ^ refId. Distinct from
  // roll() (which mixes a per-call salt) so the sentence shape follows the
  // world seed rather than the token layout.
  function loreRng(refId, reseed) {
    var s = (worldSeed() ^ (((refId | 0) + 1) * 2246822519)) >>> 0;
    if (reseed) s = (s ^ mixReseed(reseed)) >>> 0;
    if (!s) s = 0x9E3779B1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s;
    };
  }
  function rpick(rng, arr) {
    if (!arr || !arr.length) return "";
    return arr[rng() % arr.length];
  }
  function capFirst(str) {
    if (!str) return str;
    return str.replace(/^(\s*)([a-z])/, function (m, sp, c) { return sp + c.toUpperCase(); });
  }

  function generateLore(directive, refId, reseed) {
    var g = grammar();
    if (!g) return "";
    var forceForbidden = false;
    var key = directive.replace(/^#/, "");
    if (key.slice(-1) === "!") { forceForbidden = true; key = key.slice(0, -1); }
    // category alias -> archetype
    if (g.categoryArchetype && g.categoryArchetype[key]) key = g.categoryArchetype[key];
    var arch = (g.archetypes && g.archetypes[key]) || g.fallbackArchetype || null;
    if (!arch) return "";
    var famName = forceForbidden && g.families && g.families.forbidden ? "forbidden" : arch.family;
    var fam = (g.families && g.families[famName]) || (g.families && g.families.generic) || null;
    if (!fam) return "";
    var rng = loreRng(refId, reseed);
    var tmpl = rpick(rng, fam.templates) || "";
    // Pre-roll one pick from each bank so repeated slots stay consistent.
    var banks = {
      art:       rpick(rng, arch.art),
      era:       rpick(rng, arch.era),
      mechanism: rpick(rng, arch.mechanism),
      attrib:    rpick(rng, arch.attrib)
    };
    var tokBankName = (fam.tokens === "arcane") ? "arcane" : "worldly";
    var tokBank = (g.tokenBanks && g.tokenBanks[tokBankName]) || [];
    banks.token = rpick(rng, tokBank);
    var out = tmpl.replace(/\{(\w+?)(_cap)?\}/g, function (m, name, cap) {
      var lname = name.charAt(0).toLowerCase() + name.slice(1);
      var val = banks[lname];
      // Not a grammar slot (e.g. {faction}) -> leave it for the token pass.
      if (val == null) return m;
      // Capitalize when the slot name was written capitalized or ends in _cap.
      var wantCap = cap === "_cap" || (name[0] >= "A" && name[0] <= "Z");
      return wantCap ? capFirst(val) : val;
    });
    return out;
  }

  // Capitalize the first letter of the string and of each sentence. Token
  // clauses are authored lowercase (e.g. "the Mages Guild ...") so they read
  // naturally mid-sentence; after assembly a clause may land at a sentence
  // start, so normalize here.
  function capSentences(str) {
    return str.replace(/(^|[.!?]\s+)([a-z])/g, function (m, pre, c) { return pre + c.toUpperCase(); });
  }

  // reseed (optional, default 0) varies every stage below without touching the
  // world seed or the item id, so a caller can preview an alternative reading of
  // the same lore. Omit it and the output is exactly what it has always been.
  function fill(template, refId, reseed) {
    if (!template || typeof template !== "string") return template;
    var t = template, generated = false;
    reseed = reseed >>> 0;
    if (t.charAt(0) === "#") {
      t = generateLore(t, refId | 0, reseed);
      if (!t) return "";
      generated = true;
    }
    // Combinatorial {a | b | c} groups first (same service the item
    // descriptions use, seeded per refId); it leaves single-option groups such
    // as {faction} alone for the token pass below.
    if (t.indexOf("|") !== -1 && window.ItemDescription) {
      t = window.ItemDescription.resolve(
        t, "lore:" + (refId | 0) + (reseed ? ":" + reseed : "")
      );
    }
    if (t.indexOf("{") !== -1) {
      var ctx = resolve(refId | 0, reseed);
      t = t.replace(/\{(\w+)\}/g, function (m, key) { return (ctx[key] != null) ? ctx[key] : m; });
    }
    // Always: a token clause is authored lowercase ("the Mages Guild ...") and
    // may land at the start of a sentence once assembled, whether the lore was
    // generated from a #directive or written inline in the note.
    return capSentences(t);
  }

  // Convenience: resolved <Lore:> text for an item/armor, or "" if none.
  // The <Lore:> tag holds a translation key (LoreItems.<id>, LoreWeapons.<id>,
  // LoreArmors.<id>, LoreSkills.<id>); the template lives in
  // js/i18n/<lang>/lore/. A tag that still holds a literal template or a
  // #School directive is used as written, so nothing has to be lifted to work.
  function loreTemplate(value) {
    var v = String(value == null ? "" : value).trim();
    if (!v) return "";
    return (typeof T === "function" && T.has(v)) ? T(v) : v;
  }

  function loreFor(item, reseed) {
    if (!item || !item.meta || !item.meta.Lore) return "";
    return fill(loreTemplate(item.meta.Lore), item.id, reseed);
  }

  window.ItemSystemUtils = window.ItemSystemUtils || {};
  window.ItemSystemUtils.fillLore = fill;
  window.ItemSystemUtils.resolveLoreTokens = resolve;
  window.ItemSystemUtils.loreFor = loreFor;
  window.ItemSystemUtils.loreTemplate = loreTemplate;
  window.ArmorLore = { fill: fill, resolve: resolve, loreFor: loreFor };
})();

/* =========================================================================
 * Combinatorial item descriptions.
 *
 * Every real entry in data/Items.json writes its `description` as a
 * combinatorial template rather than a fixed phrase, e.g.
 *
 *   {Kills germs | Sterilizes hands}; {restores | rebuilds} hygiene.
 *
 * Groups nest and may hold whole phrases, so one template covers dozens of
 * wordings. The pick is NOT random: for a given world seed (default 19002001,
 * read through HistoryManager/NPCShared) each item always resolves to the same
 * wording, and different items resolve differently, exactly like the enemy
 * <En:> descriptions handled by EnemyDescription.js. Change the world seed and
 * every item's phrasing re-rolls together.
 *
 * Resolution happens IN PLACE on $dataItems, so the cramped core help box, the
 * inventory/shop DOM panels and the localization exporter all read a finished
 * string with no per-consumer wiring. The raw templates are kept aside and the
 * pass re-runs whenever the world seed changes (new game, save load, setSeed).
 *
 * Exposed as window.ItemDescription (resolve / describe / raw / apply) and
 * window.ItemSystemUtils.resolveVariants.
 * ========================================================================= */
(function () {
  "use strict";

  // ---- seed helpers (same xorshift stream as NPCShared / EnemyDescription) --
  function nameHash(str) {
    try {
      if (window.NPCShared && typeof NPCShared.nameHash === "function") return NPCShared.nameHash(str) >>> 0;
    } catch (e) {}
    var h = 5381, s = String(str);
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h || 1;
  }

  function worldSeed() {
    try {
      if (window.NPCShared && typeof NPCShared.worldSeed === "function") return NPCShared.worldSeed() >>> 0;
      if (window.HistoryManager && typeof HistoryManager.getSeed === "function") return HistoryManager.getSeed() >>> 0;
    } catch (e) {}
    return 19002001; // canon default
  }

  // Avalanche (murmur3 finalizer). xorshift is linear, so two items whose seeds
  // differ in a few bits would otherwise open with the same picks and whole runs
  // of neighbouring ids would read alike. Mixing first decorrelates them.
  function mix32(h) {
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function makeRng(seed) {
    var s = mix32((seed || 1) >>> 0) || 0x9e3779b1;
    return function () {
      var x = s;
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5;  x >>>= 0;
      s = x;
      return x / 4294967296;
    };
  }

  // ---- template parsing ----------------------------------------------------
  // Nodes: { t:'text', v:string } | { t:'choice', opts:[nodes,...] }
  // A brace group with a single option is NOT a choice: it is left verbatim
  // (braces included) so lore tokens like {faction} survive this pass and are
  // still filled by fillLore() downstream.
  function trimSeq(nodes) {
    if (nodes.length && nodes[0].t === "text") {
      nodes[0].v = nodes[0].v.replace(/^[ \t]+/, "");
      if (!nodes[0].v) nodes.shift();
    }
    if (nodes.length && nodes[nodes.length - 1].t === "text") {
      var last = nodes[nodes.length - 1];
      last.v = last.v.replace(/[ \t]+$/, "");
      if (!last.v) nodes.pop();
    }
    return nodes;
  }

  function parseTemplate(text) {
    var i = 0;

    function parseSeq(top) {
      var nodes = [], buf = "";
      var flush = function () { if (buf) { nodes.push({ t: "text", v: buf }); buf = ""; } };
      while (i < text.length) {
        var c = text[i];
        if (c === "{") {
          flush(); i++;
          var group = parseChoice();
          if (group.opts.length > 1) nodes.push(group);
          else { // single option: keep the braces, resolve anything inside
            nodes.push({ t: "text", v: "{" });
            var inner = group.opts[0] || [];
            for (var k = 0; k < inner.length; k++) nodes.push(inner[k]);
            nodes.push({ t: "text", v: "}" });
          }
        } else if (!top && (c === "|" || c === "}")) break;
        else { buf += c; i++; }
      }
      flush();
      return nodes;
    }

    function parseChoice() {
      var opts = [trimSeq(parseSeq(false))];
      while (text[i] === "|") { i++; opts.push(trimSeq(parseSeq(false))); }
      if (text[i] === "}") i++; // consume closing brace
      return { t: "choice", opts: opts };
    }

    return parseSeq(true);
  }

  // Fix an indefinite article that the chosen option just flipped, e.g.
  // "a {shard | ember}" -> "an ember". Only an article directly preceding a
  // resolved choice is touched, so authored prose is never disturbed.
  var ARTICLE_TAIL = /\b([Aa])n?([ \t]+)$/;

  function evalNodes(nodes, rng) {
    var out = "";
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.t === "text") { out += n.v; continue; }
      var idx = n.opts.length <= 1 ? 0 : Math.floor(rng() * n.opts.length) % n.opts.length;
      var s = evalNodes(n.opts[idx] || [], rng);
      var m = out.match(ARTICLE_TAIL);
      if (m && /[A-Za-z]/.test(s.charAt(0))) {
        var art = /^[aeiou]/i.test(s) ? "an" : "a";
        if (m[1] === "A") art = art.charAt(0).toUpperCase() + art.slice(1);
        out = out.slice(0, out.length - m[0].length) + art + m[2];
      }
      out += s;
    }
    return out;
  }

  // Tidy the spacing that option trimming leaves behind and collapse a word
  // repeated by two neighbouring synonym groups landing on the same term.
  function tidy(s) {
    return s
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([.,;:!?)])/g, "$1")
      .replace(/([([])[ \t]+/g, "$1")
      .replace(/\b(\w+)(?:[ \t]+\1\b)+/gi, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function hasVariants(text) {
    return typeof text === "string" && text.indexOf("{") !== -1 && text.indexOf("|") !== -1;
  }

  function resolve(text, seedKey) {
    if (typeof text !== "string" || text.indexOf("{") === -1) return text;
    var key = (seedKey === undefined || seedKey === null) ? text : seedKey;
    var rng = makeRng((worldSeed() ^ nameHash(key)) >>> 0);
    return tidy(evalNodes(parseTemplate(text), rng));
  }

  // ---- in-place pass over $dataItems ---------------------------------------
  var templates = null;   // id -> raw template, captured before the first pass
  var appliedSeed = null; // world seed the text currently in $dataItems reflects

  function captureTemplates() {
    templates = {};
    for (var i = 1; i < $dataItems.length; i++) {
      var item = $dataItems[i];
      if (item && hasVariants(item.description)) templates[i] = item.description;
    }
  }

  function apply(force) {
    if (typeof $dataItems === "undefined" || !$dataItems || !$dataItems.length) return;
    var seed = worldSeed() >>> 0;
    if (!force && appliedSeed === seed) return;
    if (!templates) captureTemplates();
    for (var id in templates) {
      var item = $dataItems[id];
      if (item) item.description = resolve(templates[id], "item:" + id);
    }
    appliedSeed = seed;
  }

  function raw(itemId) {
    if (!templates) {
      if (typeof $dataItems === "undefined" || !$dataItems) return "";
      captureTemplates();
    }
    return templates[Number(itemId)] || "";
  }

  function describe(itemId) {
    apply();
    var item = (typeof $dataItems !== "undefined" && $dataItems) ? $dataItems[Number(itemId)] : null;
    return item ? String(item.description || "") : "";
  }

  // ---- hooks: run once the database is up, and on every world-seed change --
  var _onDatabaseLoaded = Scene_Boot.prototype.onDatabaseLoaded;
  Scene_Boot.prototype.onDatabaseLoaded = function () {
    _onDatabaseLoaded.call(this);
    apply();
  };

  var _setupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function () {
    _setupNewGame.call(this);
    apply();
  };

  var _extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _extractSaveContents.call(this, contents);
    apply();
  };

  // Cheap safety net for a seed changed mid-play (HistoryManager.setSeed):
  // apply() is a single comparison when the seed has not moved.
  var _setItem = Window_Help.prototype.setItem;
  Window_Help.prototype.setItem = function (item) {
    apply();
    _setItem.call(this, item);
  };

  window.ItemSystemUtils = window.ItemSystemUtils || {};
  window.ItemSystemUtils.resolveVariants = resolve;
  window.ItemDescription = {
    resolve: resolve,
    describe: describe,
    raw: raw,
    apply: apply,
    hasVariants: hasVariants
  };
})();
