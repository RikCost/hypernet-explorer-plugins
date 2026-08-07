/*:
 * @target MZ
 * @plugindesc Character creation flow orchestrator with step-by-step wizard UI
 * @author Omni-Lex
 * @orderAfter CharacterCreationShared
 * @orderAfter StartingEquipment
 * @orderAfter CharacterPresets
 * @orderAfter ClassSelection
 * @orderAfter TraitSelector
 * @orderAfter Health_Core
 * @command characterCreation
 * @text Character Creation
 * @desc Starts the character creation sequence
 *
 * @command repriseCreation
 * @text Reprise Creation
 * @desc Resumes character creation from class selection step
 *
 * @command repriseCreationCreature
 * @text Reprise Creation Creature
 * @desc Resumes character creation from gender selection (for creatures)
 *
 * @command repriseTraitSelection
 * @text Reprise Trait Selection
 * @desc Opens the trait selector for re-selecting traits
 *
 * @arg actorId
 * @text Actor ID
 * @desc The ID of the actor to select traits for
 * @type actor
 * @default 1
 *
 * @help
 * This plugin orchestrates the entire character creation flow.
 */

(() => {
  const pluginName = "CharacterCreation";

  // Curated, non-blank IconSet indices for the settings-row icons. Mirrors the
  // pool used by the parchment options menu (GameOptions.js) so the initial
  // settings list reads exactly like Scene_Options' left page.
  const SETTINGS_ICON_POOL = [
    64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
    80, 81, 82, 83, 84, 87, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
    160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 176, 177, 178, 179,
    208, 209, 210, 211, 212, 213, 214, 215, 311, 312, 313
  ];
  // Stable hash -> a consistent icon for a given setting key.
  const pickSettingIcon = (key) => {
    let h = 0;
    const s = String(key);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return SETTINGS_ICON_POOL[h % SETTINGS_ICON_POOL.length];
  };

  // Full-screen black veil used to hide the brief return to the map while a
  // reserved common event spins up the next scene (e.g. the sprite/bust
  // selector). Without it the map flashes for a frame and the selector shows
  // an empty list until its async asset scan finishes. The veil is removed by
  // the destination scene once it has finished loading, with a safety timeout.
  window.CCTransitionVeil = window.CCTransitionVeil || {
    _el: null,
    _timeout: null,
    show() {
      if (this._el) return;
      const el = document.createElement("div");
      el.id = "cc-transition-veil";
      el.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;background:#000;" +
        "z-index:2147483646;pointer-events:none;transition:opacity 0.2s ease;";
      document.body.appendChild(el);
      this._el = el;
      // Safety: never leave the screen black if the destination scene never
      // calls hide() (e.g. an unexpected flow change).
      if (this._timeout) clearTimeout(this._timeout);
      this._timeout = setTimeout(() => this.hide(), 8000);
    },
    hide() {
      if (this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = null;
      }
      const el = this._el;
      if (!el) return;
      this._el = null;
      el.style.opacity = "0";
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    },
  };

  // Import dependencies from other plugins
  const {
    getLocalizedChoice,
    applyGenderAndReproduction,
    applyRandomGender,
    getGenderChoices,
    applyTraitsToActor,
    VAR_PLAYER1_GENDER,
    VAR_PLAYER2_GENDER,
    VAR_PLAYER3_GENDER,
    VAR_PLAYER1_REPRODUCTIVE_TYPE,
    VAR_PLAYER2_REPRODUCTIVE_TYPE,
    VAR_PLAYER3_REPRODUCTIVE_TYPE
  } = window.CharacterCreationUtils || {};
  const { equipRandomCompatibleWeapon, GLOBAL_STARTER_SKILLS, applyStartingGear, getClassStartingItems, giveClassStartingItems } = window.StartingEquipment || {};
  const { getCharacterPresets, getAvailableCharacterPresets, markPresetUsed, getPresetLore, getPresetHometown, getPresetSkins, getPresetSkin, getPresetSkinLabel, markStepCompleted, isStepCompleted, hasCompletedFirstCreation, Window_CharacterPresets } = window.CharacterPresets || {};
  // Alternate looks a dossier can be played as. Falls back to the dossier's own
  // sprite and bust when the presets plugin is an older build without skins.
  function presetSkins(preset) {
    if (typeof getPresetSkins === "function") return getPresetSkins(preset);
    return preset
      ? [{ key: "", sprite: preset.sprite, spriteIndex: preset.spriteIndex || 0, busts: preset.busts }]
      : [];
  }
  // Presets still free in this world (each pre-made character can be played
  // only once per world). Falls back to the full list if the presets plugin is
  // an older build without the per-world API.
  function availablePresets() {
    if (typeof getAvailableCharacterPresets === "function") return getAvailableCharacterPresets();
    return typeof getCharacterPresets === "function" ? getCharacterPresets() : [];
  }
  // The tutorial is a streamlined single-character flow that must build a
  // character from scratch, so pre-made dossiers are never offered there. The
  // in-scene flag is cleared at the add-member step, hence the switch 100
  // fallback (same guard the origin step uses).
  function isTutorialFlow() {
    if (typeof Scene_CharacterCreation !== "undefined" && Scene_CharacterCreation._tutorialMode) return true;
    return !!($gameSwitches && $gameSwitches.value(100));
  }
  // Detailed creation mode lives in CharacterCreationFull.js: the whole
  // character sheet is edited inside the Empathize panel instead of being
  // walked step by step. The option only exists while that plugin is loaded,
  // and unlike the other modes it is offered during the tutorial too.
  function detailedModeAvailable() {
    const full = window.CharacterCreationFull;
    return !!(full && full.isAvailable && full.isAvailable());
  }
  const _markFirstCreationComplete = (window.CharacterPresets || {}).markFirstCreationComplete;
  // Every creation-finished path calls this; besides the original bookkeeping
  // it schedules the new-playthrough autosave (SaveSystem assigns the next
  // free slot and saves once the map has loaded).
  function markFirstCreationComplete() {
    if (_markFirstCreationComplete) _markFirstCreationComplete();
    giveStartingSupplies();
    giveStartingMoney();
    // Every member finishes fully equipped: fill any empty equip slot with a
    // random low-stat compatible piece (weapon + every armor slot). Preset and
    // class-chosen gear already in a slot is left untouched. Idempotent, so it
    // is safe to run on each of the (idempotent) completion paths.
    fillPartyStartingEquipment();
    if (window.SaveSystem && window.SaveSystem.scheduleNewPlaythroughSave) {
      window.SaveSystem.scheduleNewPlaythroughSave();
    }
  }

  // --- Starting supplies -------------------------------------------------
  // Handed out once, the first time a party finishes creation: cheap healing
  // food/consumables, plus a spare weapon for every member and a couple of
  // spare armor pieces so the party always has a backup to fall back on.
  // Low-price healing food / consumables: [itemId, quantity].
  const STARTER_CONSUMABLES = [
    [421, 3], // Granola Bar (food, restores hunger)
    [423, 2], // Bruised Apple (food)
    [3, 3],   // Acetaminophen Tablets (heals 20% HP)
    [16, 2],  // Pseudoephedrine Tabs (heals 15% HP)
  ];
  // Spare armor pieces (cheap, low weight): [armorId, quantity].
  const STARTER_SPARE_ARMORS = [
    [4, 1], // Motion Defense Hat
    [2, 1], // Siege Breaker Armor
  ];

  function giveStartingSupplies() {
    if ($gameSystem._ccStarterSuppliesGiven) return;
    $gameSystem._ccStarterSuppliesGiven = true;

    // Healing food / consumables.
    STARTER_CONSUMABLES.forEach(([id, qty]) => {
      const item = $dataItems[id];
      if (item) $gameParty.gainItem(item, qty);
    });

    // One spare weapon per member, drawn from the member's class weapon pool
    // (the same limited pools used to equip the primary weapon).
    const SE = window.StartingEquipment;
    if (SE && SE.getCompatibleWeaponTypes && SE.getCompatibleWeapons) {
      $gameParty.members().forEach((actor) => {
        const types = SE.getCompatibleWeaponTypes(actor._classId);
        const pool = SE.getCompatibleWeapons(types);
        if (pool.length > 0) {
          const spare = pool[Math.floor(Math.random() * pool.length)];
          if (spare) $gameParty.gainItem(spare, 1);
        }
      });
    }

    // Spare equipment.
    STARTER_SPARE_ARMORS.forEach(([id, qty]) => {
      const armor = $dataArmors[id];
      if (armor) $gameParty.gainItem(armor, qty);
    });
  }

  // --- Starting money ----------------------------------------------------
  // Every party begins with a flat 100€ purse (100 gold = €1) on top of the
  // money each of its members brings in from their class <Money:> notetag and
  // from their traits (optional "money" field, in gold). Preset money is
  // applied by the preset step itself and simply adds to this.
  //
  // Handed out once, from markFirstCreationComplete (the end-of-creation hook),
  // so it lands after every class / trait / preset step no matter which path
  // the player took (full, quick, random, creature, tutorial, preset). Doing it
  // here instead of at class confirmation also means the preset step's gold
  // wipe can no longer swallow it.
  // The class bonus is the raw <Money:> value: it used to be tripled (with a
  // 3000 gold floor) because only the first member ever received it, which is
  // no longer the case now that every member is paid.
  const CC_BASE_START_EUROS = 100;
  const CC_BASE_START_GOLD = CC_BASE_START_EUROS * 100; // 100 gold = €1

  function classStartingMoney(classId) {
    const classData = $dataClasses[classId];
    const match = classData && classData.note && classData.note.match(/<Money:(\d+)>/i);
    return match ? Number(match[1]) : 0;
  }

  function traitStartingMoney(actor) {
    const traits = (actor && actor._selectedTraits) || [];
    return traits.reduce((sum, trait) => sum + (Number(trait && trait.money) || 0), 0);
  }

  function giveStartingMoney() {
    if ($gameSystem._ccStartingMoneyGiven) return;
    $gameSystem._ccStartingMoneyGiven = true;

    let gold = CC_BASE_START_GOLD;
    $gameParty.members().forEach((actor) => {
      gold += classStartingMoney(actor._classId) + traitStartingMoney(actor);
    });
    $gameParty.gainGold(gold);
  }
  const { Scene_ClassSelection } = window.ClassSelection || {};

  // --- Trait i18n resolution ---------------------------------------------
  // Trait names are stored as i18n key paths (e.g. "traits.monk-trained.name").
  // Resolve them against the active-language trait bank, falling back to the
  // English bank whenever the localized entry is missing or empty.
  let _traitI18nData = null;   // active language
  let _traitI18nDataEn = null; // english fallback

  const resolveI18nPath = (path, obj) => {
    if (!path || !obj) return null;
    return path.split(".").reduce((acc, part) => (acc && acc[part] != null ? acc[part] : null), obj);
  };

  const loadTraitI18nData = async () => {
    const lang = ConfigManager.language || "en";
    const fetchBank = async (l) => {
      try {
        const response = await fetch(`js/i18n/${l}/traits.json`);
        return await response.json();
      } catch (e) {
        console.error("CharacterCreation: Failed to load trait i18n from js/i18n/" + l + "/traits.json", e);
        return null;
      }
    };
    _traitI18nData = await fetchBank(lang);
    _traitI18nDataEn = lang === "en" ? _traitI18nData : await fetchBank("en");
  };
  loadTraitI18nData();

  // Resolve a single trait name value to its display string.
  const resolveTraitName = (name) => {
    if (!name) return null;
    if (typeof name === "object") {
      // A trait record that still carries its own pair rather than a key.
      return T.language() === "it" ? (name.it || name.en) : name.en;
    }
    if (typeof name === "string" && name.includes(".")) {
      const localized = resolveI18nPath(name, _traitI18nData);
      if (localized) return localized;
      const english = resolveI18nPath(name, _traitI18nDataEn);
      if (english) return english;
    }
    return name;
  };

  // The wizard's own theme. Started once (settings page) and never restarted:
  // every later request goes through AudioManager.playBgm, which leaves the
  // track playing when it is already this one.
  // i18n-ignore-next-line: bgm file name
  const CREATION_BGM = "KevinMacLeod/Jazz/Cool Vibes";

  // Music tracks for the initial settings step (values must match MusicSelectionSystem.js)
  // i18n-ignore-start: bgm file names. Only the first three carry a label of
  // their own (CharCreate.musicTrack); the rest are shown as the file is named.
  const CC_MUSIC_TRACK_FILES = [
    "RandomMind/Battle", "ZaneMusic/shortcuts", "Moogify/MelodicTechno",
    "Battle1", "Battle2", "Battle3", "Battle4",
    "Battle5", "Battle6", "Battle7", "Battle8",
  ];
  // i18n-ignore-end
  // Built per call, not once: the label has to follow a language change.
  function ccMusicTracks() {
    return CC_MUSIC_TRACK_FILES.map((value) => {
      const key = 'CharCreate.musicTrack.' + value.split('/').pop();
      return { name: T.has(key) ? T(key) : value.split('/').pop(), value: value };
    });
  }

  // CC_MUSIC_TRACKS plus any player tracks dropped into audio/bgm/BattleMusic.
  // Resolved at runtime since MusicSelectionSystem.js loads after this plugin.
  function getCCMusicTracks() {
    const mss = window.MusicSelectionSystem;
    const custom = (mss && mss.scanCustomTracks) ? mss.scanCustomTracks() : [];
    return ccMusicTracks().concat(custom);
  }

  // Vehicle interiors the camper / car origins drop the player into. The
  // matching world-map position (where the vehicle is parked) is chosen by the
  // player through the fast-travel city picker; FastTravelSystem parks the
  // vehicle there and sends the player here, and stepping out of the interior
  // (returnToCamper / returnToCar) spawns the vehicle beside them at that city.
  const CAMPER_INTERIOR = { mapId: 327, x: 4, y: 6 };
  const CAR_INTERIOR = { mapId: 1094, x: 7, y: 8 };
  const WORLD_MAP_ID = 315;
  const GAME_START_MAP_ID = 557; // the map every new game / permadeath reset lands on

  // Full creation mode is disabled for now: the "Full" choice is hidden from the
  // creationMode step and every flow behaves as Quick (so the Full-only flavor
  // steps, hometown and birthdate, never come up). Flip this back to true to
  // restore the two-mode wizard; nothing else needs changing.
  const FULL_CREATION_MODE_ENABLED = false;

  // Starting items handed out by the origins (see ORIGIN_LOADOUTS below).
  const ITEM_LIMINAL_CUFFS = 111; // camper
  const ITEM_BIKE = 131;          // bike
  const ITEM_CAR = 164;           // car
  const ITEM_LOW_ORBIT_PIN = 166; // space
  const ITEM_INFLATABLE_DINGHY = 167; // stranded
  const ITEM_FISHING_ROD = 123;   // stranded
  const ITEM_LOCAL_MAP = 161;     // train
  const ITEM_LOCKPICK = 374;      // criminal
  const ITEM_WRISTWATCH = 130;    // CEO
  const ITEM_INVITATION_LETTER = 713; // train

  // The train kit: the traveller's supplies. No other origin gets this set.
  const ITEM_HEALTH_POTION = 648;   // 800 HP
  const ITEM_PAINKILLERS = 3;       // Acetaminophen Tablets, 20% max HP
  const ITEM_MANA_POTION = 651;     // 500 MP
  const ITEM_MEDICAL_SPRAY = 19;    // removes every status ailment
  const ITEM_GRANOLA_BAR = 421;     // 150 cal
  const ITEM_BOTTLED_WATER = 418;
  const ITEM_BEDROLL = 125;
  const ITEM_LANTERN = 121;
  const ITEM_TRAVEL_BACKPACK = 129;

  // Thematic extras.
  const ITEM_WATER_BOTTLE = 120;      // bike
  const ITEM_STAR_MAP = 163;          // space
  const ITEM_PILOT_PDA = 162;         // space
  const ITEM_UV_SUNGLASSES = 142;     // space
  const ITEM_PORTABLE_CHARGER = 122;  // space / bunker
  const ITEM_NANITES = 59;            // space (Regeneration Nanites)
  const ITEM_ELECTROLYTE_POWDER = 17; // space / bunker
  const ITEM_FUEL_TANK = 146;         // camper / car / crash
  const ITEM_COOKING_POT = 807;       // camper / stranded / faction leader
  const ITEM_UTENSIL_SET = 809;       // camper
  const ITEM_SLEEPING_BAG = 815;      // camper (Comfort Sleeping Bag)
  const ITEM_MP3_PLAYER = 133;        // camper
  const ITEM_INSTANT_NOODLES = 433;   // camper
  const ITEM_STRONG_COFFEE = 459;     // camper
  const ITEM_IBUPROFEN = 25;          // camper / faction leader
  const ITEM_GPS = 137;               // car
  const ITEM_EARBUDS = 154;           // car
  const ITEM_COFFEE_CUP = 528;        // car
  const ITEM_POTATO_CRISPS = 441;     // car
  const ITEM_FIZZY_SODA = 442;        // car
  const ITEM_OINTMENT = 11;           // car / deserter (Bacitracin)
  const ITEM_SEWING_KIT = 132;        // bike (patch kit)
  const ITEM_COMPACT_UMBRELLA = 152;  // bike
  const ITEM_PROTEIN_BAR = 431;       // bike / criminal
  const ITEM_MIXED_NUTS = 466;        // bike
  const ITEM_MUSCLE_RUB = 15;         // bike (Methyl Salicylate)
  const ITEM_SHOVEL = 138;            // empty lot / bunker
  const ITEM_CRAFTSMAN_BACKPACK = 151; // empty lot
  const ITEM_TOOLMAKER_MULTITOOL = 156; // empty lot
  const ITEM_CANNED_VEGETABLES = 435; // empty lot / bunker
  const ITEM_PORRIDGE = 428;          // empty lot
  const ITEM_CANDLE = 115;            // empty lot
  const ITEM_POCKET_NOTEBOOK = 127;   // mayor
  const ITEM_BALLPOINT_PEN = 113;     // mayor
  const ITEM_ORATORS_ELIXIR = 46;     // mayor
  const ITEM_FRESH_BREAD = 454;       // mayor
  const ITEM_CHEESE_WHEEL = 510;      // mayor
  const ITEM_AGED_WINE = 535;         // mayor
  const ITEM_CLIMBING_ROPE = 813;     // dungeon
  const ITEM_ROUTES_MAP = 159;        // dungeon (Omega tower routes)
  const ITEM_FLASHLIGHT = 136;        // dungeon / crash
  const ITEM_ELVEN_WAYBREAD = 646;    // dungeon / artifact heir
  const ITEM_WARNING_AMULET = 673;    // dungeon
  const ITEM_FAIRY_LANTERN = 812;     // dungeon
  const ITEM_BURNER_PHONE = 157;      // criminal
  const ITEM_ESCAPE_KIT = 808;        // criminal / deserter
  const ITEM_INVISIBLE_INK_PEN = 148; // criminal
  const ITEM_RED_COCAINE = 22;        // criminal
  const ITEM_JUMBO_COLA = 445;        // criminal
  const ITEM_VENISON_JERKY = 465;     // stranded
  const ITEM_SPRING_WATER = 429;      // stranded (also cures poison)
  const ITEM_WALKING_STICK = 806;     // stranded / deserter
  const ITEM_EMPTY_FLASK = 805;       // stranded / crash
  const ITEM_WILD_BERRIES = 448;      // stranded
  const ITEM_CANNED_MEAT = 452;       // bunker
  const ITEM_FIELD_RATION = 512;      // bunker / warlord / deserter
  const ITEM_CELLPHONE = 149;         // CEO
  const ITEM_DEADLINE_COFFEE = 564;   // CEO
  const ITEM_GOURMET_CHOCOLATE = 543; // CEO
  const ITEM_PREMIUM_WHISKEY = 572;   // CEO
  const ITEM_ENERGY_DRINK = 23;       // CEO
  const ITEM_RESONANCE_SCANNER = 139; // artifact heir
  const ITEM_TRAVEL_JOURNAL = 128;    // artifact heir
  const ITEM_MEMORY_AMBER = 675;      // artifact heir
  const ITEM_LENS_OF_REVELATION = 679; // artifact heir
  const ITEM_CALMING_TEA = 434;       // artifact heir
  const ITEM_MULTITOOL = 814;         // crash / warlord
  const ITEM_RATION_BAR = 463;        // crash (Nutrient-Fortified Bar)
  const ITEM_REGENERATION_HERB = 42;  // crash
  const ITEM_WHETSTONE = 811;         // warlord / faction leader
  const ITEM_MORPHINE = 43;           // warlord
  const ITEM_FIGHTERS_BOOSTER = 50;   // warlord
  const ITEM_STRONG_ALE = 480;        // warlord
  const ITEM_ELVEN_ROPE = 810;        // faction leader
  const ITEM_HEARTY_STEW = 534;       // faction leader
  const ITEM_HONEY_MEAD = 517;        // faction leader
  const ITEM_ROCK_HARD_BREAD = 424;   // deserter

  function giveStartingItem(itemId, qty = 1) {
    const item = $dataItems[itemId];
    if (item) {
      $gameParty.gainItem(item, qty);
    } else {
      console.warn(`CharacterCreation: starting item ${itemId} not found.`);
    }
  }

  // Camper / car origin: open the fast-travel city picker (carsharing for the
  // car, camper network for the camper). The keys item comes from the origin's
  // loadout. Picking a city is handled by FastTravelSystem in characterCreation
  // mode: it parks the vehicle at that city on the world map and transfers the
  // player into the vehicle interior instead of charging fuel/time.
  function startVehicleOrigin(transportType, interior) {
    if (!$gameTemp) return;
    $gameTemp._openCharacterCreationTrainTravel = true;     // opens the picker
    $gameTemp._characterCreationTravelType = transportType; // which network
    $gameTemp._characterCreationTravelMode = true;          // free, uncancellable
    $gameTemp._ccVehicleStart = {
      transport: transportType,
      interiorMapId: interior.mapId,
      interiorX: interior.x,
      interiorY: interior.y,
    };
  }

  // Criminal origin: same camper start as origin_camper, but the party begins
  // already wanted, carrying a 10,000€ bounty. CrimeSystem tracks bounties in
  // gold and displays them in euros via goldToEuros (euros = gold / 100), so a
  // 10,000€ bounty is 1,000,000 gold recorded as one starting crime.
  const CRIMINAL_START_BOUNTY_GOLD = 1000000; // = 10,000€ (euros = gold / 100)

  function startCriminalOrigin() {
    if (window.CrimeSystem && window.CrimeSystem.addCrime) {
      const crimeName = T('CharCreate.pastLife');
      window.CrimeSystem.addCrime(crimeName, CRIMINAL_START_BOUNTY_GOLD);
    } else {
      console.warn("CharacterCreation: CrimeSystem unavailable; criminal start bounty not applied.");
    }
    // Same landing as the camper origin: keys + city picker + vehicle interior.
    startVehicleOrigin("camper", CAMPER_INTERIOR);
  }

  // CEO origin: start rich and in charge. Hand the party €1,000,000 in cash
  // (100 gold = €1) and a controlling 80% stake in LemonCorp registered on the
  // company exchange (RealEstateMarket via window.AssetRegistry), then drop the
  // player into the LemonCorp HQ (map 1036) at 25,31 facing down.
  const CEO_START_EUROS = 1000000;           // €1,000,000
  const CEO_START_GOLD = CEO_START_EUROS * 100; // 100 gold = €1
  const CEO_COMPANY_KEY = "LemonCorp";
  const CEO_OWNERSHIP = 0.8;                  // 80% controlling stake
  const CEO_START = { mapId: 1036, x: 25, y: 31, dir: 2 }; // facing down

  function startCEOOrigin() {
    $gameParty.gainGold(CEO_START_GOLD);

    // Grant an 80% stake in LemonCorp. giveShares needs a share count, so read
    // the company's total shares from the exchange and take 80% of it.
    if (window.AssetRegistry && window.AssetRegistry.giveShares) {
      const company = window.AssetRegistry.getCompany(CEO_COMPANY_KEY);
      if (company && company.totalShares > 0) {
        window.AssetRegistry.giveShares(CEO_COMPANY_KEY, Math.floor(company.totalShares * CEO_OWNERSHIP));
      } else {
        console.warn(`CharacterCreation: company "${CEO_COMPANY_KEY}" not found; CEO stake not granted.`);
      }
    } else {
      console.warn("CharacterCreation: AssetRegistry unavailable; CEO stake not granted.");
    }

    $gamePlayer.reserveTransfer(CEO_START.mapId, CEO_START.x, CEO_START.y, CEO_START.dir, 0);
  }

  // Bike origin: give the bike item and drop the player into a RANDOM non-ocean
  // procedural biome (never onto the world map). We generate the biome map up
  // front, then transfer to the procedural map (636); VehicleSystem places the
  // player in a passable 4x4 zone with the bike beside them on map load (see
  // _ccBikeStart handling).
  function startBikeOrigin() {
    $gameSystem._boatType = "bike";
    if ($gameTemp) $gameTemp._ccBikeStart = true;

    const procMapId =
      (window.WorldMapReturn && window.WorldMapReturn.procMapId) || 636;
    if ($gameSystem.generateRandomBikeBiomeMap && $gameSystem.generateRandomBikeBiomeMap()) {
      // Proc map is 64x64; start near the center. VehicleSystem repositions the
      // player into a passable 4x4 zone once the map is loaded.
      $gamePlayer.reserveTransfer(procMapId, 32, 32, 2, 0);
    } else {
      // Fallback: old world-map bike start if procedural generation is unavailable.
      $gamePlayer.reserveTransfer(WORLD_MAP_ID, 88, 130, 2, 0);
    }
  }

  // Empty-lot origin: drop the party onto a RANDOM passable, non-water tile of
  // the world map (315) with a big pile of crafting materials (handed out by the
  // origin's loadout). The exact tile is chosen once the world map is loaded
  // (see the Scene_Map.onMapLoaded hook near the bottom of this file); here we
  // flag the start and reserve a provisional landing tile.
  const MATERIAL_ITEM_ID_MIN = 849; // first <category:Crafting> material
  const MATERIAL_ITEM_ID_MAX = 871; // last  <category:Crafting> material
  const EMPTY_LOT_MATERIAL_QTY = 40; // of every material

  function startEmptyLotOrigin() {
    if ($gameTemp) $gameTemp._ccEmptyLotStart = true;
    // Provisional tile, repositioned to a random land tile in onMapLoaded.
    $gamePlayer.reserveTransfer(WORLD_MAP_ID, 88, 130, 2, 0);
  }

  // Stranded origin: drop the party on foot at a RANDOM one of these hand-picked
  // world-map (315) coordinates — remote spots scattered across the map, with
  // nothing but the castaway kit its loadout lists. Every one of them is a land
  // square (Fields / ForestTropical / Mountain / City); never add an Ocean
  // coordinate here, and see the onMapLoaded hook that re-lands one that drifts
  // over water after a world-map repaint.
  const STRANDED_COORDS = [
    { x: 115, y: 89 }, { x: 84, y: 46 }, { x: 86, y: 50 }, { x: 85, y: 53 },
    { x: 71, y: 61 }, { x: 67, y: 63 }, { x: 69, y: 64 }, { x: 70, y: 68 },
    { x: 213, y: 230 }, { x: 220, y: 234 }, { x: 8, y: 225 }, { x: 49, y: 145 },
    { x: 57, y: 149 }, { x: 119, y: 182 }, { x: 121, y: 184 }, { x: 131, y: 216 },
    { x: 120, y: 228 },
  ];

  function startStrandedOrigin() {
    const spot = STRANDED_COORDS[Math.floor(Math.random() * STRANDED_COORDS.length)];
    if ($gameTemp) $gameTemp._ccStrandedStart = true;
    $gamePlayer.reserveTransfer(WORLD_MAP_ID, spot.x, spot.y, 2, 0);
  }

  // Mayor origin: a huge stockpile (50x of every crafting material, handed out
  // by the loadout) and the choice of a starting city through the picker, just
  // like the camper / car origins. Unlike those vehicle origins the mayor starts
  // on foot on the world map at the chosen city (no vehicle, no interior): we
  // open the character-creation picker on the camper network (which lists every
  // city and lands on world map 315) but WITHOUT an _ccVehicleStart, so
  // FastTravelSystem uses its plain character-creation transfer to the picked
  // city instead of parking a vehicle and dropping into its interior.
  const MAYOR_MATERIAL_QTY = 50; // of every material (id 849-871)

  function startMayorOrigin() {
    if (!$gameTemp) return;
    $gameTemp._openCharacterCreationTrainTravel = true;     // opens the picker
    $gameTemp._characterCreationTravelType = "camper";      // full city list, world-map landing
    $gameTemp._characterCreationTravelMode = true;          // free, uncancellable
  }

  // --- Starting loadouts ---------------------------------------------------
  // ONE table drives both what an origin hands out and what the "Starting Out"
  // dossier promises: grantOriginLoadout() gives exactly the rows
  // _originStepDetailsHtml lists, so the two can never drift apart. Nothing here
  // is random and nothing is left implicit: every origin states its items, their
  // quantities and its cash.
  //
  // An entry is { id, qty, each }. `each` means "qty per party member", so a
  // trio starts with three times the supplies of a lone wanderer; without it the
  // quantity is flat. Anything in the <category:Tools> family is clamped to a
  // single copy whatever the party size — three explorers need three ration
  // packs, not three low orbit pins.
  function materialLoadout(qty) {
    const list = [];
    for (let id = MATERIAL_ITEM_ID_MIN; id <= MATERIAL_ITEM_ID_MAX; id++) list.push({ id, qty });
    return list;
  }

  // Every origin carries its OWN supplies: there is no shared kit handed out on
  // top. What a party eats, heals with and sleeps under is part of the fantasy
  // of where it starts, so a bunker's canned meat and torch never show up in a
  // CEO's briefcase. The traveller's kit below (potions, granola, bedroll,
  // lantern, invitation letter) belongs to the train origin alone.
  const ORIGIN_LOADOUTS = {
    origin_train: [
      { id: ITEM_HEALTH_POTION, qty: 2, each: true },
      { id: ITEM_PAINKILLERS, qty: 2, each: true },
      { id: ITEM_MANA_POTION, qty: 1, each: true },
      { id: ITEM_MEDICAL_SPRAY, qty: 1, each: true },
      { id: ITEM_GRANOLA_BAR, qty: 3, each: true },
      { id: ITEM_BOTTLED_WATER, qty: 2, each: true },
      { id: ITEM_BEDROLL, qty: 1 },
      { id: ITEM_LANTERN, qty: 1 },
      { id: ITEM_INVITATION_LETTER, qty: 1 },
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_TRAVEL_BACKPACK, qty: 1 },
    ],
    // Orbital issue: everything freeze-dried, nothing that spills.
    origin_space: [
      { id: ITEM_LOW_ORBIT_PIN, qty: 1 },
      { id: ITEM_STAR_MAP, qty: 1 },
      { id: ITEM_PILOT_PDA, qty: 1 },
      { id: ITEM_PORTABLE_CHARGER, qty: 1 },
      { id: ITEM_UV_SUNGLASSES, qty: 1 },
      { id: ITEM_NANITES, qty: 1, each: true },
      { id: ITEM_ELECTROLYTE_POWDER, qty: 3, each: true },
      { id: ITEM_RATION_BAR, qty: 4, each: true },
    ],
    // Road life: a kitchen on wheels and something to listen to.
    origin_camper: [
      { id: ITEM_LIMINAL_CUFFS, qty: 1 },
      { id: ITEM_FUEL_TANK, qty: 1 },
      { id: ITEM_COOKING_POT, qty: 1 },
      { id: ITEM_UTENSIL_SET, qty: 1 },
      { id: ITEM_SLEEPING_BAG, qty: 1 },
      { id: ITEM_MP3_PLAYER, qty: 1 },
      { id: ITEM_INSTANT_NOODLES, qty: 4, each: true },
      { id: ITEM_STRONG_COFFEE, qty: 2, each: true },
      { id: ITEM_IBUPROFEN, qty: 2, each: true },
    ],
    // Motorway diet: petrol-station food, eaten at the wheel.
    origin_car: [
      { id: ITEM_CAR, qty: 1 },
      { id: ITEM_FUEL_TANK, qty: 1 },
      { id: ITEM_GPS, qty: 1 },
      { id: ITEM_EARBUDS, qty: 1 },
      { id: ITEM_OINTMENT, qty: 2, each: true },
      { id: ITEM_COFFEE_CUP, qty: 2, each: true },
      { id: ITEM_POTATO_CRISPS, qty: 3, each: true },
      { id: ITEM_FIZZY_SODA, qty: 2, each: true },
    ],
    // Saddlebag weight: nothing that isn't worth carrying uphill.
    origin_bike: [
      { id: ITEM_BIKE, qty: 1 },
      { id: ITEM_WATER_BOTTLE, qty: 1 },
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_SEWING_KIT, qty: 1 },
      { id: ITEM_COMPACT_UMBRELLA, qty: 1 },
      { id: ITEM_MUSCLE_RUB, qty: 2, each: true },
      { id: ITEM_PROTEIN_BAR, qty: 4, each: true },
      { id: ITEM_MIXED_NUTS, qty: 2, each: true },
    ],
    // Homesteading: materials, tools, and food that keeps in a crate.
    origin_lot: materialLoadout(EMPTY_LOT_MATERIAL_QTY).concat([
      { id: ITEM_SHOVEL, qty: 1 },
      { id: ITEM_CRAFTSMAN_BACKPACK, qty: 1 },
      { id: ITEM_TOOLMAKER_MULTITOOL, qty: 1 },
      { id: ITEM_CANDLE, qty: 1 },
      { id: ITEM_CANNED_VEGETABLES, qty: 3, each: true },
      { id: ITEM_PORRIDGE, qty: 2, each: true },
    ]),
    // Office of the mayor: paperwork, a banquet, and a speech to give.
    origin_mayor: materialLoadout(MAYOR_MATERIAL_QTY).concat([
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_POCKET_NOTEBOOK, qty: 1 },
      { id: ITEM_BALLPOINT_PEN, qty: 1 },
      { id: ITEM_WRISTWATCH, qty: 1 },
      { id: ITEM_ORATORS_ELIXIR, qty: 1, each: true },
      { id: ITEM_FRESH_BREAD, qty: 2, each: true },
      { id: ITEM_CHEESE_WHEEL, qty: 1 },
      { id: ITEM_AGED_WINE, qty: 1 },
    ]),
    // Delve kit: light, rope, and more potions than anyone else starts with.
    origin_dungeon: [
      { id: ITEM_HEALTH_POTION, qty: 3, each: true },
      { id: ITEM_MANA_POTION, qty: 2, each: true },
      { id: ITEM_ROUTES_MAP, qty: 1 },
      { id: ITEM_FLASHLIGHT, qty: 1 },
      { id: ITEM_FAIRY_LANTERN, qty: 1 },
      { id: ITEM_CLIMBING_ROPE, qty: 1 },
      { id: ITEM_WARNING_AMULET, qty: 1 },
      { id: ITEM_ELVEN_WAYBREAD, qty: 3, each: true },
    ],
    // Wanted: nothing traceable, everything disposable.
    origin_criminal: [
      { id: ITEM_LIMINAL_CUFFS, qty: 1 },
      { id: ITEM_LOCKPICK, qty: 2, each: true },
      { id: ITEM_BURNER_PHONE, qty: 1 },
      { id: ITEM_ESCAPE_KIT, qty: 1 },
      { id: ITEM_INVISIBLE_INK_PEN, qty: 1 },
      { id: ITEM_RED_COCAINE, qty: 1, each: true },
      { id: ITEM_PROTEIN_BAR, qty: 3, each: true },
      { id: ITEM_JUMBO_COLA, qty: 2, each: true },
    ],
    // Castaway: what washed ashore with you, and what you can catch.
    origin_stranded: [
      { id: ITEM_INFLATABLE_DINGHY, qty: 1 },
      { id: ITEM_FISHING_ROD, qty: 1 },
      { id: ITEM_COOKING_POT, qty: 1 },
      { id: ITEM_WALKING_STICK, qty: 1 },
      { id: ITEM_EMPTY_FLASK, qty: 1 },
      { id: ITEM_VENISON_JERKY, qty: 3, each: true },
      { id: ITEM_SPRING_WATER, qty: 2, each: true },
      { id: ITEM_WILD_BERRIES, qty: 2, each: true },
    ],
    // Sealed cellar: tinned calories and batteries, no fresh anything.
    origin_bunker: [
      { id: ITEM_FLASHLIGHT, qty: 1 },
      { id: ITEM_SHOVEL, qty: 1 },
      { id: ITEM_PORTABLE_CHARGER, qty: 1 },
      { id: ITEM_CANNED_MEAT, qty: 4, each: true },
      { id: ITEM_CANNED_VEGETABLES, qty: 3, each: true },
      { id: ITEM_FIELD_RATION, qty: 2, each: true },
      { id: ITEM_ELECTROLYTE_POWDER, qty: 2, each: true },
    ],
    // Corner office: no supplies, only expenses.
    origin_ceo: [
      { id: ITEM_WRISTWATCH, qty: 1 },
      { id: ITEM_CELLPHONE, qty: 1 },
      { id: ITEM_PREMIUM_WHISKEY, qty: 1 },
      { id: ITEM_DEADLINE_COFFEE, qty: 2, each: true },
      { id: ITEM_ENERGY_DRINK, qty: 2, each: true },
      { id: ITEM_GOURMET_CHOCOLATE, qty: 1, each: true },
    ],
    // Inheritance: instruments for reading what you were left.
    origin_artifact: [
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_RESONANCE_SCANNER, qty: 1 },
      { id: ITEM_TRAVEL_JOURNAL, qty: 1 },
      { id: ITEM_LENS_OF_REVELATION, qty: 1 },
      { id: ITEM_MEMORY_AMBER, qty: 1 },
      { id: ITEM_ELVEN_WAYBREAD, qty: 2, each: true },
      { id: ITEM_CALMING_TEA, qty: 2, each: true },
    ],
    // Wreck salvage: whatever was still bolted down after the landing.
    origin_crash: [
      { id: ITEM_LOW_ORBIT_PIN, qty: 1 },
      { id: ITEM_FUEL_TANK, qty: 1 },
      { id: ITEM_MULTITOOL, qty: 1 },
      { id: ITEM_FLASHLIGHT, qty: 1 },
      { id: ITEM_EMPTY_FLASK, qty: 1 },
      { id: ITEM_RATION_BAR, qty: 3, each: true },
      { id: ITEM_REGENERATION_HERB, qty: 2, each: true },
    ],
    // Camp of an army that answers to nobody: blades, booze and morphine.
    origin_warlord: [
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_WHETSTONE, qty: 1 },
      { id: ITEM_MULTITOOL, qty: 1 },
      { id: ITEM_MORPHINE, qty: 1, each: true },
      { id: ITEM_FIGHTERS_BOOSTER, qty: 1, each: true },
      { id: ITEM_FIELD_RATION, qty: 3, each: true },
      { id: ITEM_STRONG_ALE, qty: 2, each: true },
    ],
    // A faction's own quartermaster: a proper camp, properly fed.
    origin_faction_leader: [
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_WHETSTONE, qty: 1 },
      { id: ITEM_COOKING_POT, qty: 1 },
      { id: ITEM_ELVEN_ROPE, qty: 1 },
      { id: ITEM_IBUPROFEN, qty: 2, each: true },
      { id: ITEM_HEARTY_STEW, qty: 2, each: true },
      { id: ITEM_HONEY_MEAD, qty: 2, each: true },
    ],
    // Ran with what was in the pack: stolen rations and a way through doors.
    origin_deserter: [
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_ESCAPE_KIT, qty: 1 },
      { id: ITEM_WALKING_STICK, qty: 1 },
      { id: ITEM_LOCKPICK, qty: 1, each: true },
      { id: ITEM_OINTMENT, qty: 2, each: true },
      { id: ITEM_FIELD_RATION, qty: 2, each: true },
      { id: ITEM_ROCK_HARD_BREAD, qty: 2, each: true },
    ],
  };

  // How many characters the loadout is being sized for. The origin step is the
  // last one in the wizard, so the whole party already exists by then.
  function loadoutPartySize() {
    const size = $gameParty ? $gameParty.members().length : 0;
    return Math.max(1, size);
  }

  // <category:Tools> items are one per party however many members it has.
  function isToolItem(item) {
    return !!(item && item.note && /<category:\s*Tools\s*>/i.test(item.note));
  }

  // The resolved loadout of an origin: its own kit and nothing else, quantities
  // already scaled to the party. Rows with the same item are merged so the
  // dossier lists each item exactly once.
  function resolveOriginLoadout(symbol) {
    const size = loadoutPartySize();
    const entries = ORIGIN_LOADOUTS[symbol] || [];
    const merged = [];
    const byId = {};
    for (const entry of entries) {
      const item = $dataItems[entry.id];
      if (!item) continue;
      const qty = isToolItem(item) ? 1 : entry.qty * (entry.each ? size : 1);
      if (byId[entry.id]) {
        byId[entry.id].qty = isToolItem(item) ? 1 : byId[entry.id].qty + qty;
      } else {
        byId[entry.id] = { id: entry.id, qty };
        merged.push(byId[entry.id]);
      }
    }
    return merged;
  }

  function grantOriginLoadout(symbol) {
    for (const entry of resolveOriginLoadout(symbol)) {
      giveStartingItem(entry.id, entry.qty);
    }
  }

  // Cash the party will be holding once creation ends, in euros: the base
  // allowance plus every member's class and trait money (giveStartingMoney,
  // which runs at the end of this step), plus whatever the origin adds. Used by
  // the dossier so the money on offer is stated as a number, never as "rich".
  function plannedStartingEuros(symbol) {
    let gold = $gameParty ? $gameParty.gold() : 0;
    if (!$gameSystem._ccStartingMoneyGiven) {
      gold += CC_BASE_START_GOLD;
      $gameParty.members().forEach((actor) => {
        gold += classStartingMoney(actor._classId) + traitStartingMoney(actor);
      });
    }
    if (symbol === "origin_ceo") gold += CEO_START_GOLD;
    return Math.floor(gold / 100); // 100 gold = €1
  }

  // Dungeon-entrance origin: the OmegaTower interior gate (map 635), facing up.
  const DUNGEON_ORIGIN = { mapId: 635, x: 13, y: 37, dir: 8 };

  // Dungeon-entrance origin: start at the tower gate with the delve kit its
  // loadout lists (extra potions, routes map, flashlight, climbing rope). It
  // used to hand out random items until the party's carry limit was full, which
  // no dossier could state honestly.
  function startDungeonOrigin() {
    $gamePlayer.reserveTransfer(
      DUNGEON_ORIGIN.mapId, DUNGEON_ORIGIN.x, DUNGEON_ORIGIN.y, DUNGEON_ORIGIN.dir, 0
    );
  }

  // Guaranteed gold hoards down in the bunker. ProceduralMapBiomeGenerator owns
  // the number and publishes it; read at render time because that plugin loads
  // after this one.
  function bunkerGoldPiles() {
    return (window.WorldGen && window.WorldGen.BUNKER_GOLD_PILES) || 6;
  }

  // Bunker origin: the party wakes up in a sealed loot cellar under a random
  // overland world square. ProceduralMapBiomeGenerator picks the square, builds
  // its surface map with a permanent StairsDown hatch stamped on it, and
  // guarantees the gold hoards down in the cellar; stepping onto the cellar's
  // border climbs out through that hatch (WorldMapReturn's 'bunker' session),
  // and the hatch stays there forever, so the bunker can always be gone back to.
  function startBunkerOrigin() {
    const record = $gameSystem.prepareBunkerOrigin ? $gameSystem.prepareBunkerOrigin() : null;
    if (!record) {
      console.warn("CharacterCreation: bunker origin unavailable; starting at the tower gate instead.");
      startDungeonOrigin();
      return;
    }
    // Generates the cellar at the bunker's world square and reserves the
    // transfer into it. The seed is the square's own, so descending the hatch
    // later rebuilds this very cellar.
    PluginManager.callCommand(
      $gameMap._interpreter || {}, "WorldMapReturn", "startForcedBiome", { Biome: "LootCellar" }
    );
    const pg = $gameSystem._procGenData;
    if (!pg) return;
    // Creation started from the world map re-anchors the square to the player's
    // own world position (startForcedBiome calls generateProceduralMap there).
    // Follow it, so the cellar just generated and the hatch stamped on the
    // surface stay on the same square; the exit rebuilds that surface and
    // re-records the hatch tile.
    if (pg.originX !== record.worldX || pg.originY !== record.worldY) {
      record.worldX = pg.originX;
      record.worldY = pg.originY;
      record.biome = ($gameSystem.getBiomeFromCache
        ? $gameSystem.getBiomeFromCache(pg.originX, pg.originY)
        : null) || "Fields";
      record.entranceX = null;
      record.entranceY = null;
    }
    pg._dungeonSession = { type: "bunker" };
  }

  // Artifact Heir origin: inherit one of the world's 13 generated historical
  // artifacts (HistorySimulator.js ids 1501-1513, each existing as an item,
  // a weapon AND an armor variant) at random, with whatever provenance the
  // history sim rolled for it. Spawn is the default train/city-picker, same
  // as origin_train; the artifact itself is the one random part of any
  // origin's loadout.
  function startArtifactHeirOrigin() {
    const artifactId = 1501 + Math.floor(Math.random() * 13);
    const kinds = [
      { key: "items", data: $dataItems },
      { key: "weapons", data: $dataWeapons },
      { key: "armors", data: $dataArmors },
    ];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const artifact = kind.data[artifactId];
    if (artifact) {
      $gameParty.gainItem(artifact, 1);
      const record = window.HistoryManager && window.HistoryManager.getArtifactRecord
        ? window.HistoryManager.getArtifactRecord(`${kind.key}:${artifactId}`)
        : null;
      if (record) {
        console.log(`CharacterCreation: Artifact Heir inherits the ${record.name} (${record.origin} ${record.action}, ${record.date}).`);
      }
    } else {
      console.warn(`CharacterCreation: artifact ${kind.key}:${artifactId} not found; artifact heir origin gave nothing.`);
    }
    if ($gameTemp) {
      $gameTemp._openCharacterCreationTrainTravel = true;
      $gameTemp._characterCreationTravelMode = true;
    }
  }

  // Crash Landed origin (WIP): the party is stranded on a random planet in an
  // uncharted, randomly-seeded galaxy. The starship survives the crash but is
  // badly damaged, nearly out of local fuel and completely out of SB-Bridge
  // (Schrodingerite) jump charges; the low orbit pin (item 166, same one the
  // Space origin grants) marks the way back once repairs and refueling make
  // the ship flight-worthy again.
  function pickRandomCrashPlanet() {
    if (!window.GalaxySim || !window.GalaxySim.getDataManager) return null;
    const dm = window.GalaxySim.getDataManager();
    const gxSeed = Math.floor(Math.random() * 0x7fffffff);
    const systems = dm.generateGalaxySystems(gxSeed) || [];
    const withPlanets = systems.filter((s) => s.planets && s.planets.length > 0);
    if (!withPlanets.length) return null;
    const system = withPlanets[Math.floor(Math.random() * withPlanets.length)];
    const planet = system.planets[Math.floor(Math.random() * system.planets.length)];
    return { system, planet, gxSeed };
  }

  const CRASH_LANDED_FUEL = 200;        // out of a 10,000-unit map-fuel tank (var 95)
  const CRASH_LANDED_HYPERFLUX = 500;   // out of 92,000
  const CRASH_SHIP_DAMAGE_PERCENT = 70; // heavy damage, several critical parts near/at 0

  function startCrashLandedOrigin() {
    const pick = pickRandomCrashPlanet();
    if (!pick) {
      console.warn("CharacterCreation: GalaxySim unavailable; crash-landed origin fell back to a plain space start.");
      $gamePlayer.reserveTransfer(721, 27, 7, 2, 0);
      return;
    }

    const dm = window.GalaxySim.getDataManager();
    // Every other start leaves the ship at its default berth in Earth orbit
    // (StarMapDataManager.parkAtHomeOrbit); this one crashed it here, so the
    // ship's own position has to follow the party to the wreck site.
    dm.teleportToPlanetOrbit(pick.system.name, pick.planet.name);
    if ($gameSystem) $gameSystem._shipOrbitEarthInit = true;
    $gameVariables.setValue(95, CRASH_LANDED_FUEL);
    dm.setHyperflux(CRASH_LANDED_HYPERFLUX);
    dm.setSchrodingerite(0);

    // Marks the crash site so the party can find their way back once the
    // ship flies again; consumed wherever a "return to crash site" option is
    // added (WIP: no such consumer exists yet).
    $gameSystem._crashSitePin = {
      kind: "planet",
      name: pick.planet.name,
      systemName: pick.system.name,
      galaxySeed: pick.gxSeed,
    };

    if (window.VehicleSystemRepair) {
      window.VehicleSystemRepair.initializeVehicleHealth();
      window.VehicleSystemRepair.applyDamage("airship", CRASH_SHIP_DAMAGE_PERCENT);
    }

    window.GalaxySim.enterPlanetSurface(pick.planet, {});
  }

  // Independent Warlord origin: start with a mixed roster of 40 random troops
  // drawn from random factions (ArmyManager.js), with no faction reputation
  // change (the party owes allegiance to no one) and enough gold to cover two
  // weeks of upkeep for the granted troops. Spawn is the default
  // train/city-picker, same as origin_train.
  const WARLORD_TROOP_COUNT = 40;

  function startWarlordOrigin() {
    if (window.ArmyManager && window.ArmyManager.grantRandomTroopsMixed) {
      window.ArmyManager.grantRandomTroopsMixed(WARLORD_TROOP_COUNT);
    }
    if (typeof $gameArmy !== "undefined" && $gameArmy) {
      const upkeep = $gameArmy.getTotalWeeklyCost() * 2; // 2 weeks of upkeep
      if (upkeep > 0) $gameParty.gainGold(upkeep);
    }
    if ($gameTemp) {
      $gameTemp._openCharacterCreationTrainTravel = true;
      $gameTemp._characterCreationTravelMode = true;
    }
  }

  // Faction Leader / Deserter origins: both let the player pick a faction
  // through the same Factions menu (Scene_FactionStatus, in selection mode)
  // and grant 40 troops of that faction. Faction Leader sets reputation with
  // the faction AND its parent chain positive and grants 2 weeks of troop
  // upkeep money; Deserter sets the same chain negative (having deserted, not
  // been given leave) and grants no upkeep money.
  const FACTION_ORIGIN_TROOP_COUNT = 40;
  const FACTION_ORIGIN_REPUTATION = 50;

  function finishFactionOrigin(factionId, isPositive) {
    if (window.ArmyManager && window.ArmyManager.grantRandomTroops) {
      window.ArmyManager.grantRandomTroops(factionId, FACTION_ORIGIN_TROOP_COUNT);
    }
    if (typeof $gameFactions !== "undefined" && $gameFactions && $gameFactions.changeReputationWithParents) {
      $gameFactions.changeReputationWithParents(
        factionId, isPositive ? FACTION_ORIGIN_REPUTATION : -FACTION_ORIGIN_REPUTATION
      );
    }
    if (isPositive && typeof $gameArmy !== "undefined" && $gameArmy) {
      const upkeep = $gameArmy.getTotalWeeklyCost() * 2; // 2 weeks of upkeep
      if (upkeep > 0) $gameParty.gainGold(upkeep);
    }
    if ($gameTemp) {
      $gameTemp._openCharacterCreationTrainTravel = true;
      $gameTemp._characterCreationTravelMode = true;
    }
  }

  // Pauses the wizard (same pause/resume pattern as creature creation, via
  // Scene_CharacterCreation._interruptedStep) and pushes Scene_FactionStatus
  // on top of it in selection mode. _interruptedStep is set to ORIGIN, the
  // very last step, so once Scene_FactionStatus pops back to a freshly
  // (re)constructed Scene_CharacterCreation, its step index lands past the
  // end of CharacterCreationData and the wizard pops itself immediately,
  // matching what every other origin does at the end of its handler.
  function startFactionPickerOrigin(isPositive) {
    if (!window.Scene_FactionStatus || typeof $gameFactions === "undefined" || !$gameFactions) {
      console.warn("CharacterCreation: FactionDataManager unavailable; faction origin skipped.");
      if ($gameTemp) {
        $gameTemp._openCharacterCreationTrainTravel = true;
        $gameTemp._characterCreationTravelMode = true;
      }
      return;
    }
    Scene_CharacterCreation._interruptedStep = STEP.ORIGIN;
    SceneManager.push(window.Scene_FactionStatus);
    SceneManager.prepareNextScene("select", (factionId) => {
      finishFactionOrigin(factionId, isPositive);
    });
  }

  // --- Quick mode helpers -------------------------------------------------
  // The eight major class archetypes for the Quick-mode two-step class picker.
  // Each archetype groups a set of classes resolved by name against the live
  // $dataClasses. Any valid class (creature id 65 excluded) not matched by name
  // is appended to the final "Outsider" archetype, so the full roster stays
  // reachable even if a class is renamed. Archetypes that resolve to zero
  // classes are dropped.
  //
  // Result is memoized per language: $dataClasses is stable after load, so the
  // grouping only needs computing once (the class-step picker calls this on
  // every cursor move via the right-page details, which used to re-filter the
  // whole class list each keypress).
  let _quickArchetypesCache = null;
  let _quickArchetypesCacheLang = null;
  function getQuickArchetypes() {
    const lang = ConfigManager.language || "en";
    if (_quickArchetypesCache && _quickArchetypesCacheLang === lang) {
      return _quickArchetypesCache;
    }
    // i18n-ignore-start: class names, matched against $dataClasses
    const groups = [
      {
        key: "warrior",
        name: T('CharCreate.warrior'),
        blurb: T('CharCreate.disciplinedFrontLineFighters'),
        names: ["Knight", "Berserker", "Samurai", "Gladiator", "Guardian", "Barbarian", "Paladin", "Mercenary", "Commander"],
      },
      {
        key: "brawler",
        name: T('CharCreate.brawler'),
        blurb: T('CharCreate.unarmedAndMartialSpecialists'),
        names: ["Wrestler", "Martial Artist", "Monk", "Brawler", "Boxer", "Pro Wrestler", "Acrobat"],
      },
      {
        key: "mage",
        name: T('CharCreate.mage'),
        blurb: T('CharCreate.wieldersOfArcanePower'),
        names: ["Witch", "Elementalist", "Enchanter", "Fire Mage", "Ice Mage", "Archmage", "Illusionist", "Sage", "Spellblade", "Battlemage"],
      },
      {
        key: "occult",
        name: T('CharCreate.occultist'),
        blurb: T('CharCreate.darkAndForbiddenArts'),
        names: ["Warlock", "Necromancer", "Cultist", "Vampire", "Wretch", "Bard"],
      },
      {
        key: "holy",
        name: T('CharCreate.devout'),
        blurb: T('CharCreate.healersAndTheFaithful'),
        names: ["Nun", "Cleric", "Oracle", "Priest", "Combat Medic", "Demigod", "Doctor", "Nurse"],
      },
      {
        key: "scholar",
        name: T('CharCreate.scholar'),
        blurb: T('CharCreate.mindsOfScienceAndStudy'),
        names: ["Scientist", "Academic", "Psychologist", "Archaeologist", "Physicist", "Meteorologist", "Journalist", "Mechanic"],
      },
      {
        key: "survivor",
        name: T('CharCreate.survivor'),
        blurb: T('CharCreate.huntersRangersAndLaborers'),
        names: ["Ranger", "Scout", "Hunter-Gatherer", "Farmer", "Lumberjack", "Firefighter", "Construction Worker", "Chef"],
      },
      {
        key: "outsider",
        name: T('CharCreate.outsider'),
        blurb: T('CharCreate.misfitsAndTheUnclassifiable'),
        names: ["Freelancer", "CEO", "Police Officer", "Shopkeeper", "Entertainer", "Cyborg", "Beast", "Mimic", "Monster"],
      },
    ];
    // i18n-ignore-end

    const valid = $dataClasses.filter((c) => c && c.id !== 65);
    const byName = {};
    valid.forEach((c) => { byName[c.name] = c; });
    const used = new Set();

    groups.forEach((g) => {
      g.classes = [];
      g.names.forEach((n) => {
        const c = byName[n];
        if (c && !used.has(c.id)) {
          g.classes.push({ id: c.id, name: c.name });
          used.add(c.id);
        }
      });
    });

    // Append any class not matched by name into the final archetype so the
    // whole roster is reachable even after renames.
    const last = groups[groups.length - 1];
    valid.forEach((c) => {
      if (!used.has(c.id)) {
        last.classes.push({ id: c.id, name: c.name });
        used.add(c.id);
      }
    });

    _quickArchetypesCache = groups.filter((g) => g.classes.length > 0);
    _quickArchetypesCacheLang = lang;
    return _quickArchetypesCache;
  }

  // Hometown choices for the Full-mode hometown step: every location from
  // js/db/WorkSystem/Destinations.json (loaded as window.WorkSystem.Destinations),
  // sorted alphabetically. Falls back to a short Belgian list if the data is not
  // loaded yet.
  function getHometownList() {
    const dest = window.WorkSystem && window.WorkSystem.Destinations;
    if (dest && typeof dest === "object") {
      const names = Object.keys(dest);
      if (names.length > 0) {
        return names.sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" })
        );
      }
    }
    // i18n-ignore-start: place names
    return [
      "Ghent", "Antwerp", "Brussels", "Bruges",
      "Ostend", "Liege", "Charleroi",
    ];
    // i18n-ignore-end
  }

  // The procedural 3D model editor needs three.js and the custom-humanoid
  // builder. Without them the portrait step has only one real answer, so it is
  // skipped entirely and the character keeps the bust portrait.
  function portraitModelAvailable() {
    return !!(window.CC3DModel && window.CC3DModel.isAvailable && window.CC3DModel.isAvailable());
  }

  const CharacterCreationData = [
    {
      // Initial Settings (options) - now shown FIRST, before difficulty.
      // Shown only once on the very first character creation.
      id: "settings",
      showOnlyOnce: true,
      isSettingsStep: true,
      get title() {
        return T('CharCreate.initialSettings');
      },
      get choices() {
        return [{ name: T('CharCreate.confirm'), symbol: "confirm" }];
      },
      handler: function () {
        ConfigManager.save();
        markStepCompleted(STEP.SETTINGS);
        // Finalization (markFirstCreationComplete) now happens at the end of
        // creation (origin step) instead of here, since settings is shown first.
        this.nextStep();
      },
    },
    {
      // Difficulty - Show only once
      id: "difficulty",
      get title() {
        return T('CharCreate.selectDifficulty');
      },
      showOnlyOnce: true,
      get choices() {
        // Ordered from the harshest ruleset down to the gentlest, so Peaceful
        // sits at the bottom of the list rather than leading it.
        return [
          getLocalizedChoice(T('CharCreate.choice.roguelite.name'), "roguelite", T('CharCreate.choice.roguelite.desc')),
          getLocalizedChoice(T('CharCreate.choice.permadeath.name'), "permadeath", T('CharCreate.choice.permadeath.desc')),
          getLocalizedChoice(T('CharCreate.choice.bloodAndOil.name'), "blood_and_oil", T('CharCreate.choice.bloodAndOil.desc')),
          getLocalizedChoice(T('CharCreate.choice.peaceful.name'), "peaceful", T('CharCreate.choice.peaceful.desc')),
        ];
      },
      handler: function (symbol) {
        $gameSwitches.setValue(9, symbol === "permadeath" || symbol === "blood_and_oil");
        $gameSystem._bloodAndOilMode = (symbol === "blood_and_oil");
        $gameSystem._peacefulMode = (symbol === "peaceful");
        $gameSwitches.setValue(33, true);
        markStepCompleted(STEP.DIFFICULTY); // Mark this step as completed
        this.nextStep();
      },
    },
    {
      // Combat Mode - RPG / Map Battle / Cards / Monsters. Asked once per party
      // (showOnlyOnce); flips the per-save switches RoguelikeCardSystem reads
      // (45 = Cards, 46 = Monsters). The Cards/Monsters choice is locked for the
      // save because those are $gameSwitches and the step never reappears; Map
      // Battle is a ConfigManager option (Options > Gameplay > Map Battle), so
      // picking it here just presets that toggle and it can still be changed
      // later. See docs/tasks/roguelike-card-rework.md.
      id: "combatMode",
      showOnlyOnce: true,
      get title() {
        return T('CharCreate.selectCombatMode');
      },
      get choices() {
        return [
          getLocalizedChoice(T('CharCreate.choice.combatRpg.name'), "combat_rpg", T('CharCreate.choice.combatRpg.desc')),
          getLocalizedChoice(T('CharCreate.choice.combatMap.name'), "combat_map", T('CharCreate.choice.combatMap.desc')),
          getLocalizedChoice(T('CharCreate.choice.combatCards.name'), "combat_cards", T('CharCreate.choice.combatCards.desc')),
          getLocalizedChoice(T('CharCreate.choice.combatMonsters.name'), "combat_monsters", T('CharCreate.choice.combatMonsters.desc')),
        ];
      },
      handler: function (symbol) {
        // RPG (default) leaves both switches off.
        $gameSwitches.setValue(45, symbol === "combat_cards");
        $gameSwitches.setValue(46, symbol === "combat_monsters");
        // Map Battle is a global option rather than a save switch, so it is set
        // both ways here: picking another mode must also clear a Map Battle the
        // player had left on from a previous playthrough, otherwise "Classic
        // RPG" would still open fights on the map. Cards and Map Battle are
        // mutually exclusive battle layers (GameOptions enforces the same).
        ConfigManager.mapBattleMode = (symbol === "combat_map");
        if (ConfigManager.mapBattleMode) ConfigManager.cardCombat = false;
        ConfigManager.save();
        markStepCompleted(STEP.COMBAT_MODE);
        this.nextStep();
      },
    },
    {
      // Creation Mode - Full vs Quick. Asked once per party (showOnlyOnce);
      // the chosen mode drives which steps appear and how they behave for
      // every member. Persisted to $gameSystem so reprise paths keep it.
      id: "creationMode",
      showOnlyOnce: true,
      get title() {
        return T('CharCreate.chooseCreationMode');
      },
      get choices() {
        const choices = [
          getLocalizedChoice(T('CharCreate.choice.modeQuick.name'), "mode_quick", T('CharCreate.choice.modeQuick.desc')),
        ];
        // Full mode is disabled for now (FULL_CREATION_MODE_ENABLED).
        if (FULL_CREATION_MODE_ENABLED) {
          choices.push(
            getLocalizedChoice(T('CharCreate.choice.modeFull.name'), "mode_full", T('CharCreate.choice.modeFull.desc'))
          );
        }
        // Detailed mode sits between the quick wizard and the pre-made
        // dossiers: every field of the character sheet is edited by hand in
        // the Empathize panel. Offered during the tutorial as well.
        if (detailedModeAvailable()) {
          choices.push(
            getLocalizedChoice(T('CharCreate.choice.modeDetailed.name'), "mode_detailed", T('CharCreate.choice.modeDetailed.desc'), 84)
          );
        }
        // Pre-made characters are spent once played, so the option is offered
        // only while this world still has at least one free dossier, and never
        // during the tutorial (which always builds a fresh character).
        if (!isTutorialFlow() && availablePresets().length > 0) {
          choices.push(
            getLocalizedChoice(T('CharCreate.choice.existingCharacter.name'), "existing_character", T('CharCreate.choice.existingCharacter.desc'))
          );
        }
        return choices;
      },
      handler: function (symbol) {
        if (symbol === "existing_character") {
          // Pre-made character: skip the rest of the wizard and pick a preset.
          this.showPresetSelection();
          return;
        }
        if (symbol === "mode_detailed") {
          // The wizard keeps running; the character-type step hands over to the
          // Empathize editor (see setupStep) for this and every later member.
          Scene_CharacterCreation._creationMode = "detailed";
          $gameSystem._ccCreationMode = "detailed";
          markStepCompleted(STEP.CREATION_MODE);
          this.nextStep();
          return;
        }
        const mode = (symbol === "mode_quick" || !FULL_CREATION_MODE_ENABLED) ? "quick" : "full";
        Scene_CharacterCreation._creationMode = mode;
        $gameSystem._ccCreationMode = mode;
        markStepCompleted(STEP.CREATION_MODE);
        this.nextStep();
      },
    },
    {
      // Hometown (Full mode only). A party-level question asked once up front
      // (showOnlyOnce), alongside the other once-per-party steps, so members 2/3
      // never see it again and Back navigation stays clean. Skipped in Quick
      // mode. Stored on $gameSystem._ccHometown.
      id: "hometown",
      showOnlyOnce: true,
      get title() {
        return T('CharCreate.chooseYourHometown');
      },
      get choices() {
        return [
          getLocalizedChoice(T('CharCreate.choice.hometownPick.name'), "hometown_pick", T('CharCreate.choice.hometownPick.desc')),
          getLocalizedChoice(T('CharCreate.choice.hometownRandom.name'), "hometown_random", T('CharCreate.choice.hometownRandom.desc'), 136),
        ];
      },
      handler: function (symbol) {
        if (symbol === "hometown_random") {
          const towns = getHometownList();
          $gameSystem._ccHometown = towns[Math.floor(Math.random() * towns.length)];
          markStepCompleted(STEP.HOMETOWN);
          this.nextStep();
          return;
        }
        // "Pick on map": open the same fast-travel city picker the Mayor/
        // Camper/Car origins use, but in a non-travelling "hometown pick"
        // mode (see FastTravelSystem.js's executeTravel). Popping out of the
        // wizard here and resuming it afterward via repriseCreation mirrors
        // startWaitingForCommonEvent's pause/resume pattern; passing 0 as the
        // common event id means no common event is reserved, only the pause.
        markStepCompleted(STEP.HOMETOWN);
        if ($gameTemp) {
          $gameTemp._openCharacterCreationTrainTravel = true;
          $gameTemp._characterCreationTravelType = "camper"; // full city list, world-map landing
          $gameTemp._characterCreationTravelMode = true;     // free, uncancellable
          $gameTemp._ccHometownPick = true;
        }
        this.startWaitingForCommonEvent(0, true);
      },
    },
    {
      // World History, handled at world creation (see WorldManagerUI),
      // so this step is always skipped. Kept in place so the step layout
      // stays consistent.
      id: "worldHistory",
      autoSkip: true,
      get title() {
        return T('CharCreate.worldHistory');
      },
      showOnlyOnce: true,
      get choices() {
        return [];
      },
      handler: function () {
        markStepCompleted(STEP.WORLD_HISTORY);
        this.nextStep();
      },
    },
    {
      // Character Type Selection
      id: "characterType",
      get title() {
        return T('CharCreate.chooseCharacterType');
      },
      get choices() {
        const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;

        if (Scene_CharacterCreation._tutorialMode) {
          return [
            getLocalizedChoice(T('CharCreate.choice.newCharacter2.name'), "new_character", T('CharCreate.choice.newCharacter2.desc')),
            getLocalizedChoice(T('CharCreate.choice.createCreature2.name'), "create_creature", T('CharCreate.choice.createCreature2.desc'))
          ];
        }

        const allChoices = [
          getLocalizedChoice(T('CharCreate.choice.newCharacter.name'), "new_character", T('CharCreate.choice.newCharacter.desc')),
        ];

        allChoices.push(
          getLocalizedChoice(T('CharCreate.choice.createCreature.name'), "create_creature", T('CharCreate.choice.createCreature.desc'))
        );

        allChoices.push(
          getLocalizedChoice(T('CharCreate.choice.totalRandom.name'), "total_random", T('CharCreate.choice.totalRandom.desc'), 136)
        );

        // Only show "Randomize all party" for the first party member.
        if (currentMemberIndex === 0) {
          allChoices.push(
            getLocalizedChoice(T('CharCreate.choice.randomizeAllParty.name'), "randomize_all_party", T('CharCreate.choice.randomizeAllParty.desc'), 136)
          );
        }

        // Pre-made dossiers are NOT offered here: they live on the
        // creation-mode step alone.

        return allChoices;
      },
      handler: function (symbol) {
        // Randomize the scenic backdrop whenever the player picks a character type
        // (new character, creature, total random, randomize party, or existing preset).
        if (typeof this.randomizeSceneBackground === "function") {
          this.randomizeSceneBackground();
        }
        // Reset the random-member flag for this member; only "Total Random"
        // re-sets it (which unlocks the Reroll option on the add-member step).
        Scene_CharacterCreation._lastMemberWasRandom = false;
        // Clear the randomize-all marker; only "Randomize all party" re-sets it.
        Scene_CharacterCreation._randomizedAllParty = false;
        if (symbol === "new_character") {
          // Set current actor class to 1 for regular character
          const currentActor = Scene_CharacterCreation.getCurrentActor();
          if (currentActor) {
            currentActor.changeClass(1, false);
          }

          // Get the correct creature switch based on current party member (77, 78, or 79)
          const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
          const creatureSwitchId = 77 + currentMemberIndex; // 77 for actor 1, 78 for actor 2, 79 for actor 3

          // Set creature switch OFF for normal character
          $gameSwitches.setValue(creatureSwitchId, false);
          if (this.startDetailedEditor(currentMemberIndex)) return;
          this.nextStep(); // Continue to gender selection
        } else if (symbol === "create_creature") {
          // Set current actor class to 65 for creature
          const currentActor = Scene_CharacterCreation.getCurrentActor();
          if (currentActor) {
            currentActor.changeClass(65, false);
          }

          // Get the correct creature switch based on current party member (77, 78, or 79)
          const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
          const creatureSwitchId = 77 + currentMemberIndex; // 77 for actor 1, 78 for actor 2, 79 for actor 3

          // Set creature switch ON for creature mode
          $gameSwitches.setValue(creatureSwitchId, true);
          Scene_CharacterCreation._isCreatureMode = true;

          if (this.startDetailedEditor(currentMemberIndex)) return;
          this.nextStep(); // Continue to gender selection

        } else if (symbol === "total_random") {
          // Total randomization: skip all steps and create random character
          this.createTotalRandomCharacter();
        } else if (symbol === "randomize_all_party") {
          // Randomize every party slot, then jump straight to the options step
          this.createTotalRandomPartyAll();
        } else {
          // Go to preset selection
          this.showPresetSelection();
        }
      },
    },
    {
      // Portrait style. A humanoid is portrayed EITHER by a hand-drawn bust OR
      // by a procedural 3D model, never both: the pick decides which of the two
      // editors runs after the sprite grid, and is stored on the actor
      // (portraitMode) so every portrait surface shows exactly one of them.
      // Creatures make the equivalent choice (2D battler vs 3D model) inside
      // the creature scene, so this step is skipped for them.
      id: "portrait",
      get title() {
        return T('CharCreate.howIsYourCharacterPortrayed');
      },
      get choices() {
        return [
          getLocalizedChoice(T('CharCreate.choice.portraitBust.name'), "portrait_bust", T('CharCreate.choice.portraitBust.desc')),
          getLocalizedChoice(T('CharCreate.choice.portraitModel.name'), "portrait_model", T('CharCreate.choice.portraitModel.desc')),
        ];
      },
      handler: function (symbol) {
        const actor = Scene_CharacterCreation.getCurrentActor();
        if (actor && actor.setPortraitMode) {
          actor.setPortraitMode(symbol === "portrait_model" ? "model" : "bust");
        }
        this.nextStep();
      },
    },
    {
      // Gender
      id: "gender",
      get title() {
        return T('CharCreate.selectYourGender');
      },
      get choices() {
        return [
          {
            name: T('CharCreate.male'),
            symbol: "gender",
            value: 0,
          },
          {
            name: T('CharCreate.female'),
            symbol: "gender",
            value: 1,
          },
          {
            name: T('CharCreate.nonBinary'),
            symbol: "gender",
            value: 2,
          },
          {
            name: T('CharCreate.cocoon'),
            symbol: "gender",
            value: 3,
          },
        ];
      },
      handler: function (symbol, index) {
        const choice = this.currentStepData().choices[index];
        if (choice) {
          const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;

          // Determine which gender and reproductive type variables to use
          let genderVar, reproductiveVar;
          switch (currentMemberIndex) {
            case 0:
              genderVar = VAR_PLAYER1_GENDER;
              reproductiveVar = VAR_PLAYER1_REPRODUCTIVE_TYPE;
              break;
            case 1:
              genderVar = VAR_PLAYER2_GENDER;
              reproductiveVar = VAR_PLAYER2_REPRODUCTIVE_TYPE;
              break;
            case 2:
              genderVar = VAR_PLAYER3_GENDER;
              reproductiveVar = VAR_PLAYER3_REPRODUCTIVE_TYPE;
              break;
            default:
              console.warn(`Invalid party member index: ${currentMemberIndex}`);
              genderVar = VAR_PLAYER1_GENDER;
              reproductiveVar = VAR_PLAYER1_REPRODUCTIVE_TYPE;
          }

          // Set gender variable
          $gameVariables.setValue(genderVar, choice.value);

          // Set reproduction type based on gender
          switch (choice.value) {
            case 0: // Male
              $gameVariables.setValue(reproductiveVar, 0); // Testicles
              break;
            case 1: // Female
              $gameVariables.setValue(reproductiveVar, 1); // Uterus
              break;
            case 2: // Non-binary
              $gameVariables.setValue(reproductiveVar, Math.floor(Math.random() * 5)); // Random (0-4)
              break;
            case 3: // Cocoon
              $gameVariables.setValue(reproductiveVar, 4); // Mitosis
              break;
          }
        }

        // If in creature mode, skip to creature creator. Both Quick and Full
        // mode open the full creature scene so the whole archetype roster is
        // available (single screen: pick one archetype or two for a hybrid).
        if (Scene_CharacterCreation._isCreatureMode) {
          // Get the current actor ID (1, 2, or 3)
          const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
          const actorId = currentMemberIndex + 1;

          // Check if Scene_CreateCreature is available
          if (typeof Scene_CreateCreature !== 'undefined') {
            // Save the step to resume at after creature creation (trait selection).
            // interruptedStep + 1 is the resume step, so CLASS resumes on TRAITS.
            Scene_CharacterCreation._interruptedStep = STEP.CLASS;

            // Set the target actor ID for Scene_CreateCreature
            if (Scene_CreateCreature.setTargetActorId) {
              Scene_CreateCreature.setTargetActorId(actorId);
            }

            // Open the creature creation UI
            SceneManager.push(Scene_CreateCreature);
          } else {
            console.warn('Scene_CreateCreature not found. Make sure CharacterCreationCreature.js is loaded.');
            // Skip to trait selection (nextStep increments CLASS -> TRAITS)
            this._step = STEP.CLASS;
            this.nextStep();
          }
        } else {
          this.startWaitingForCommonEvent(97, true);
        }
      },
    },
    {
      // Class
      id: "class",
      get title() {
        if (Scene_CharacterCreation._isCreatureMode) {
          return T('CharCreate.chooseYourSkills');
        }
        // Quick-mode step 1 picks an archetype before the class itself.
        if (Scene_CharacterCreation.isQuickMode() &&
            Scene_CharacterCreation._quickArchIndex == null) {
          return T('CharCreate.chooseAnArchetype');
        }
        return T('CharCreate.chooseYourClass');
      },
      get choices() {
        const baseChoices = [];

        // Quick and Full mode: no detailed class browser. Two-step picker -
        // first choose one of the eight major archetypes, then a class within it.
        if (Scene_CharacterCreation.usesArchetypeClassPicker()) {
          const archetypes = getQuickArchetypes();
          const archIndex = Scene_CharacterCreation._quickArchIndex;

          // Step 2: an archetype is open - list its classes. Back is handled by
          // the right-page Back button (returns to the archetype list).
          if (archIndex != null && archetypes[archIndex]) {
            archetypes[archIndex].classes.forEach((c) => {
              // Show the class's signature passive skill as its description.
              const passiveDesc =
                (window.BattleSystemPassiveSkills &&
                  window.BattleSystemPassiveSkills.getPassiveDescription(c.id)) ||
                T('CharCreate.startAsClass', { name: window.CCDbName(c) });
              baseChoices.push({
                name: window.CCDbName(c),
                symbol: "quick_class_" + c.id,
                description: passiveDesc,
                value: c.id,
              });
            });
            return baseChoices;
          }

          // Step 1: list the eight archetypes plus a Random option.
          archetypes.forEach((g, i) => {
            baseChoices.push({
              name: g.name,
              symbol: "quick_arch_" + i,
              description: g.blurb,
              value: i,
            });
          });
          baseChoices.push(
            getLocalizedChoice(T('CharCreate.choice.randomClass.name'), "random_class", T('CharCreate.choice.randomClass.desc'), 136)
          );
          return baseChoices;
        }

        baseChoices.push(
          getLocalizedChoice(T('CharCreate.choice.selectClass.name'), "select_class", T('CharCreate.choice.selectClass.desc')),
          getLocalizedChoice(T('CharCreate.choice.randomClass.name'), "random_class", T('CharCreate.choice.randomClass.desc')),
        );

        return baseChoices;
      },
      handler: function (symbol, index) {
        if (symbol && symbol.indexOf("quick_arch_") === 0) {
          // Archetype step 1: open an archetype.
          const archIndex = parseInt(symbol.slice("quick_arch_".length), 10);
          // Full mode: open the detailed class browser, scoped to the chosen
          // archetype's classes. Quick mode keeps the inline two-step list.
          if (!Scene_CharacterCreation.isQuickMode()) {
            const archetypes = getQuickArchetypes();
            const g = archetypes[archIndex];
            window.$ccArchetypeClassFilter =
              g && g.classes ? g.classes.map((c) => c.id) : null;
            window.$ccCreatureClassFlow = null;
            SoundManager.playOk();
            SceneManager.goto(Scene_ClassSelection);
            return;
          }
          Scene_CharacterCreation._quickArchIndex = archIndex;
          SoundManager.playOk();
          this.refreshCurrentStepChoices();
          return;
        }
        if (symbol && symbol.indexOf("quick_class_") === 0) {
          const classId = this.currentStepData().choices[index].value;
          // Quick-mode step 2: apply the chosen class directly.
          const currentActor = Scene_CharacterCreation.getCurrentActor();
          if (currentActor) {
            currentActor.changeClass(classId, true);
            if (typeof equipRandomCompatibleWeapon === "function") {
              equipRandomCompatibleWeapon(currentActor, classId);
            }
            if (typeof giveClassStartingItems === "function") {
              giveClassStartingItems(currentActor, classId);
            }
          }
          Scene_CharacterCreation._quickArchIndex = null;
          this.nextStep();
          return;
        }
        if (symbol === "select_class") {
          window.$ccArchetypeClassFilter = null;
          window.$ccCreatureClassFlow = null;
          SceneManager.goto(Scene_ClassSelection);
        } else if (symbol === "mana_cyborg") {
          const currentActor = Scene_CharacterCreation.getCurrentActor();
          if (currentActor) {
            currentActor.changeClass(66, false);
            if (typeof equipRandomCompatibleWeapon === 'function') {
              equipRandomCompatibleWeapon(currentActor, 66);
            }
            if (typeof giveClassStartingItems === "function") {
              giveClassStartingItems(currentActor, 66);
            }
          }
          this.nextStep();
        } else {
          const validClasses = $dataClasses.filter((c) => c && c.id !== 65); // Exclude creature class
          if (validClasses.length > 0) {
            const randomClass =
              validClasses[Math.floor(Math.random() * validClasses.length)];
            const currentActor = Scene_CharacterCreation.getCurrentActor();
            if (currentActor) {
              currentActor.changeClass(randomClass.id, true);
              // Equip random compatible weapon for the random class
              if (typeof equipRandomCompatibleWeapon === "function") {
                equipRandomCompatibleWeapon(currentActor, randomClass.id);
              }
              if (typeof giveClassStartingItems === "function") {
                giveClassStartingItems(currentActor, randomClass.id);
              }
            }
          }
          Scene_CharacterCreation._quickArchIndex = null;
          this.nextStep();
        }
      },
    },
    {
      // Traits
      id: "traits",
      get title() {
        return T('CharCreate.selectYourTraits');
      },
      get choices() {
        return [
          getLocalizedChoice(T('CharCreate.choice.pickTraits.name'), "pick_traits", T('CharCreate.choice.pickTraits.desc'), 106),
          getLocalizedChoice(T('CharCreate.choice.randomTraits.name'), "random_traits", T('CharCreate.choice.randomTraits.desc'), 136),
        ];
      },
      handler: function (symbol, index) {
        if (symbol === "pick_traits") {
          // Open trait selector scene directly
          const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
          const targetActorId = currentMemberIndex + 1; // Actor IDs are 1-based

          // Save current step so we can resume after trait selection.
          // interruptedStep + 1 is the resume step, so TRAITS resumes on ADD_MEMBER.
          Scene_CharacterCreation._interruptedStep = STEP.TRAITS;

          // Prepare TraitSelector to return to character creation
          if (window.Scene_TraitSelector) {
            window.Scene_TraitSelector.prepare(true, targetActorId);
            SceneManager.push(window.Scene_TraitSelector);
          } else {
            console.error("Scene_TraitSelector not loaded!");
            this.nextStep();
          }
        } else if (symbol === "random_traits") {
          // Apply random traits using the TraitSelector plugin command
          const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
          const targetActorId = currentMemberIndex + 1; // Actor IDs are 1-based

          // Call randomizeTraits from TraitSelector
          if (window.randomizeTraitsForActor) {
            window.randomizeTraitsForActor(targetActorId);
          } else {
            console.warn("TraitSelector randomizeTraitsForActor not available, using common event fallback");
            const choice = this.currentStepData().choices[index];
            this.startWaitingForCommonEvent(choice.value);
            return;
          }

          // Move to next step
          this.nextStep();
        } else {
          const choice = this.currentStepData().choices[index];
          this.startWaitingForCommonEvent(choice.value);
        }
      },
    },
    {
      // Birth date (Full mode only). Asked per member; skipped in Quick mode.
      // Stored as an age per member on $gameSystem._ccBirthAge[index].
      id: "birthdate",
      get title() {
        return T('CharCreate.chooseYourBirthDate');
      },
      get choices() {
        return [
          getLocalizedChoice(T('CharCreate.choice.ageYoung.name'), "age_young", T('CharCreate.choice.ageYoung.desc')),
          getLocalizedChoice(T('CharCreate.choice.ageAdult.name'), "age_adult", T('CharCreate.choice.ageAdult.desc')),
          getLocalizedChoice(T('CharCreate.choice.ageMiddle.name'), "age_middle", T('CharCreate.choice.ageMiddle.desc')),
          getLocalizedChoice(T('CharCreate.choice.ageElder.name'), "age_elder", T('CharCreate.choice.ageElder.desc')),
          getLocalizedChoice(T('CharCreate.choice.ageRandom.name'), "age_random", T('CharCreate.choice.ageRandom.desc'), 136),
        ];
      },
      handler: function (symbol) {
        const ranges = {
          age_young: [18, 25],
          age_adult: [26, 40],
          age_middle: [41, 60],
          age_elder: [61, 90],
        };
        let key = symbol;
        if (key === "age_random") {
          const keys = Object.keys(ranges);
          key = keys[Math.floor(Math.random() * keys.length)];
        }
        const [lo, hi] = ranges[key] || ranges.age_adult;
        const age = lo + Math.floor(Math.random() * (hi - lo + 1));
        const idx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
        if (!$gameSystem._ccBirthAge) $gameSystem._ccBirthAge = [];
        $gameSystem._ccBirthAge[idx] = age;
        this.nextStep();
      },
    },
    {
      // Add Party Member
      id: "addMember",
      get title() {
        return T('CharCreate.addAnotherPartyMember');
      },
      get choices() {
        const choices = [
          getLocalizedChoice(T('CharCreate.choice.addMember.name'), "add_member", T('CharCreate.choice.addMember.desc'), null),
          getLocalizedChoice(T('CharCreate.choice.noMoreMembers.name'), "no_more_members", T('CharCreate.choice.noMoreMembers.desc'), null),
        ];
        // When this member was built via "Total Random", let the player keep
        // rerolling it until they are happy with the result.
        if (Scene_CharacterCreation._lastMemberWasRandom) {
          choices.push(
            getLocalizedChoice(T('CharCreate.choice.rerollCharacter.name'), "reroll_character", T('CharCreate.choice.rerollCharacter.desc'), 136)
          );
        }
        return choices;
      },
      handler: function (symbol, index) {
        if (symbol === "reroll_character") {
          // Re-randomize the current member and refresh the left-hand dossier
          // without leaving the add-member step.
          const idx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
          this._randomizeMemberCharacter(idx);
          Scene_CharacterCreation._lastMemberWasRandom = true;
          SoundManager.playOk();
          // Force a full DOM rebuild so the regenerated character (name, class,
          // gender, traits, sprite, backstory) shows in the left dossier.
          this._lastStep = -1;
          this._lastIndex = -1;
          this.refreshUIOverlayDOM();
          return;
        }
        if (symbol === "add_member") {
          // Check if party is full (max 3 members)
          const currentPartySize = $gameParty.size();

          if (currentPartySize >= 3) {
            // Party is full, proceed to initial settings step
            this.nextStep();
            return;
          }

          // Set current party member index for next character
          const nextMemberIndex = $gameParty.size(); // This will be 1 or 2 (for actors 2 or 3)
          Scene_CharacterCreation._currentPartyMemberIndex = nextMemberIndex;

          // Add the next actor to the party
          $gameParty.addActor(nextMemberIndex + 1); // Actor IDs are 1-based (1, 2, 3)

          // Set next actor's class to 1 by default
          const nextActor = $gameActors.actor(nextMemberIndex + 1);
          if (nextActor) {
            nextActor.changeClass(1, false);
          }

          // Reset creature mode flag for new character
          Scene_CharacterCreation._isCreatureMode = false;

          // Go back to Character Type Selection for the new member
          // (nextStep increments WORLD_HISTORY -> CHARACTER_TYPE, skipping the
          // already-completed settings/difficulty steps).
          this._step = STEP.WORLD_HISTORY;
          this.nextStep();
        } else {
          // Proceed to initial settings step (shown only the first time)
          this.nextStep();
        }
      },
    },
    {
      // Origin, where the character starts the game. The last step of every
      // creation run: it is reached once per run (arriving here ends the
      // wizard), and a run always belongs to a brand new party, so it is NOT
      // showOnlyOnce. It used to be, which meant the completion flag written by
      // the first party silenced the step for every later party built in the
      // same savegame, ending creation with no starting point chosen. Hidden
      // entirely in tutorial mode (the tutorial flow ends at the add-member
      // step, on the tutorial map).
      id: "origin",
      get title() {
        return T('CharCreate.chooseYourOrigin');
      },
      get choices() {
        return [
          getLocalizedChoice(T('CharCreate.choice.originTrain.name'), "origin_train", T('CharCreate.choice.originTrain.desc')),
          getLocalizedChoice(T('CharCreate.choice.originSpace.name'), "origin_space", T('CharCreate.choice.originSpace.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCamper.name'), "origin_camper", T('CharCreate.choice.originCamper.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCar.name'), "origin_car", T('CharCreate.choice.originCar.desc')),
          getLocalizedChoice(T('CharCreate.choice.originBike.name'), "origin_bike", T('CharCreate.choice.originBike.desc')),
          getLocalizedChoice(T('CharCreate.choice.originLot.name'), "origin_lot", T('CharCreate.choice.originLot.desc')),
          getLocalizedChoice(T('CharCreate.choice.originDungeon.name'), "origin_dungeon", T('CharCreate.choice.originDungeon.desc')),
          getLocalizedChoice(T('CharCreate.choice.originMayor.name'), "origin_mayor", T('CharCreate.choice.originMayor.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCriminal.name'), "origin_criminal", T('CharCreate.choice.originCriminal.desc')),
          getLocalizedChoice(T('CharCreate.choice.originStranded.name'), "origin_stranded", T('CharCreate.choice.originStranded.desc')),
          getLocalizedChoice(T('CharCreate.choice.originBunker.name'), "origin_bunker", T('CharCreate.choice.originBunker.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCeo.name'), "origin_ceo", T('CharCreate.choice.originCeo.desc')),
          getLocalizedChoice(T('CharCreate.choice.originArtifact.name'), "origin_artifact", T('CharCreate.choice.originArtifact.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCrash.name'), "origin_crash", T('CharCreate.choice.originCrash.desc')),
          getLocalizedChoice(T('CharCreate.choice.originWarlord.name'), "origin_warlord", T('CharCreate.choice.originWarlord.desc')),
          getLocalizedChoice(T('CharCreate.choice.originFactionLeader.name'), "origin_faction_leader", T('CharCreate.choice.originFactionLeader.desc')),
          getLocalizedChoice(T('CharCreate.choice.originDeserter.name'), "origin_deserter", T('CharCreate.choice.originDeserter.desc')),
        ];
      },
      handler: function (symbol) {
        markStepCompleted(STEP.ORIGIN);
        // Finalize the first creation here (end of the flow). This used to live
        // in the settings step, which now runs first, so it moved to the origin
        // step. markFirstCreationComplete is idempotent.
        markFirstCreationComplete();
        // Supplies and gear are handed out here and only here, from the single
        // ORIGIN_LOADOUTS table the "Starting Out" dossier reads, so no branch
        // below can duplicate an item or quietly hand out something unlisted.
        grantOriginLoadout(symbol);
        if (symbol === "origin_space") {
          $gamePlayer.reserveTransfer(721, 27, 7, 2, 0);
        } else if (symbol === "origin_camper") {
          startVehicleOrigin("camper", CAMPER_INTERIOR);
        } else if (symbol === "origin_car") {
          startVehicleOrigin("carsharing", CAR_INTERIOR);
        } else if (symbol === "origin_bike") {
          startBikeOrigin();
        } else if (symbol === "origin_lot") {
          startEmptyLotOrigin();
        } else if (symbol === "origin_dungeon") {
          startDungeonOrigin();
        } else if (symbol === "origin_mayor") {
          startMayorOrigin();
        } else if (symbol === "origin_criminal") {
          startCriminalOrigin();
        } else if (symbol === "origin_stranded") {
          startStrandedOrigin();
        } else if (symbol === "origin_bunker") {
          startBunkerOrigin();
        } else if (symbol === "origin_ceo") {
          startCEOOrigin();
        } else if (symbol === "origin_artifact") {
          startArtifactHeirOrigin();
        } else if (symbol === "origin_crash") {
          startCrashLandedOrigin();
        } else if (symbol === "origin_warlord") {
          startWarlordOrigin();
        } else if (symbol === "origin_faction_leader") {
          // Pauses the wizard and opens the faction picker; finishFactionOrigin
          // (called from its confirm callback) does the granting, and the
          // picker's own popScene() ends the wizard. Must not fall through to
          // the unconditional popScene() below, which would end the wizard
          // (and the freshly-pushed Scene_FactionStatus with it) immediately.
          startFactionPickerOrigin(true);
          return;
        } else if (symbol === "origin_deserter") {
          startFactionPickerOrigin(false);
          return;
        } else {
          // Default: board the train and pick a destination on the map.
          if ($gameTemp) {
            $gameTemp._openCharacterCreationTrainTravel = true;
            $gameTemp._characterCreationTravelMode = true;
          }
        }
        this.popScene();
      },
    },
  ];

  // Named step indices derived from the data array above. Every place that used
  // to hardcode a numeric step (here and in the sibling plugins) references
  // these instead, so the wizard order can be changed by simply reordering the
  // array. Also exposed as window.CCSteps for the class-selector / creature
  // plugins which resume the wizard at specific steps.
  const STEP = (() => {
    const byId = {};
    CharacterCreationData.forEach((s, i) => { if (s && s.id) byId[s.id] = i; });
    return {
      SETTINGS: byId.settings,
      DIFFICULTY: byId.difficulty,
      COMBAT_MODE: byId.combatMode,
      CREATION_MODE: byId.creationMode,
      WORLD_HISTORY: byId.worldHistory,
      CHARACTER_TYPE: byId.characterType,
      PORTRAIT: byId.portrait,
      GENDER: byId.gender,
      CLASS: byId.class,
      TRAITS: byId.traits,
      HOMETOWN: byId.hometown,
      BIRTHDATE: byId.birthdate,
      ADD_MEMBER: byId.addMember,
      ORIGIN: byId.origin,
    };
  })();
  window.CCSteps = STEP;

  // --- Scene_CharacterCreation ---
  class Scene_CharacterCreation extends Scene_MenuBase {
    static _interruptedStep = -1; // Add this line
    static _startStep = 0;
    static _isCreatureMode = false; // Track if started from creature command
    static _traitsProcessed = false; // Track if traits step has been processed once
    static _currentPartyMemberIndex = 0; // Track which party member is being created (0=first, 1=second, 2=third)
    static _lastMemberWasRandom = false; // True when the current member was built via "Total Random" (enables Reroll on the add-member step)
    static _tutorialMode = false; // Tutorial mode: streamlined single-character creation
    static _settingsRowIndex = 0; // Currently focused row in the initial settings step
    static _creationMode = null; // "full" | "quick" (runtime; mirrors $gameSystem._ccCreationMode)
    static _randomizedAllParty = false; // True after "Randomize all party" jumped straight to origin
    static _quickArchIndex = null; // Quick-mode two-step class picker: open archetype index, null = archetype list

    // True when the party is being built in Quick mode. Reads the runtime flag,
    // falling back to the persisted value so reprise paths behave consistently.
    static isQuickMode() {
      if (!FULL_CREATION_MODE_ENABLED) return true; // Full mode disabled: everything runs Quick
      if (this._tutorialMode) return true; // tutorial is always a quick, single-character flow
      if (this._creationMode) return this._creationMode === "quick";
      return !!($gameSystem && $gameSystem._ccCreationMode === "quick");
    }

    // True when the party being built right now chose Detailed mode: the
    // wizard's per-character steps are replaced by the Empathize editor
    // (CharacterCreationFull.js), which every member goes through in turn.
    //
    // Deliberately reads the runtime flag only. The persisted mode is seeded
    // back into it when a creation run starts, and the mode step is
    // showOnlyOnce: were Detailed read from there too, a savegame that once
    // used it would be locked into it for every later party, with no way back
    // to the ordinary board (see the characterCreation plugin command).
    static isDetailedMode() {
      return this._creationMode === "detailed";
    }

    // True when the CLASS step should present the two-step archetype picker
    // instead of the legacy "Select a class" / detailed browser flow. Both Quick
    // and Full mode use it; only creature mode (inline base/hybrid picker) and
    // tutorial mode (Mana Cyborg default) keep their own CLASS layouts.
    static usesArchetypeClassPicker() {
      return !this._isCreatureMode && !this._tutorialMode;
    }

    // Steps that are skipped purely because of the chosen creation mode (as
    // opposed to tutorial/creature/member-index rules). Used by both
    // _stepAutoAdvances (Back/Forward) and setupStep (forward skip).
    static _stepHiddenForMode(step) {
      if (!this.isQuickMode()) return false;
      // Quick mode: trait selection is interactive (same as Full, first member
      // only; members 2/3 still auto-randomize via memberIndex >= 1). Only the
      // Full-only flavor steps are skipped.
      if (step === STEP.HOMETOWN) return true;
      if (step === STEP.BIRTHDATE) return true;
      return false;
    }
    // Returns true when setupStep() would auto-advance past this step without
    // ever showing an interactive choice. This mirrors every forward-skip in
    // setupStep() (tutorial defaults, creatures skipping class selection,
    // party members 2/3 auto-randomizing traits, the add-member step when the
    // party is full, etc.) plus the static autoSkip / completed showOnlyOnce
    // rules. Back/forward navigation must skip these so they never count as a
    // landing step (otherwise Back becomes a no-op or underflows the step).
    static _stepAutoAdvances(step) {
      const stepData = CharacterCreationData[step];
      if (!stepData) return false;
      if (stepData.autoSkip) return true;
      if (hasCompletedFirstCreation() && stepData.showOnlyOnce && isStepCompleted(step)) {
        return true;
      }
      // Combat mode step is disabled for now (kept in code); always auto-skip so
      // Back/Forward navigation never lands on it. See setupStep().
      if (step === STEP.COMBAT_MODE) return true;

      const isTutorial = Scene_CharacterCreation._tutorialMode;
      const isCreature = Scene_CharacterCreation._isCreatureMode;
      const memberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;

      if (isTutorial) {
        if (step === STEP.SETTINGS) return true;             // settings skipped
        if (step === STEP.DIFFICULTY) return true;           // difficulty auto-applied
        if (step === STEP.COMBAT_MODE) return true;          // combat mode default (RPG)
        if (step === STEP.TRAITS) return true;               // traits skipped
        if (step === STEP.CLASS) return true;                // class fixed to Mana Cyborg
        if (step === STEP.ADD_MEMBER) return true;           // single-character party (ends)
      }
      // Creation mode is never asked during the tutorial: it is always a quick,
      // single-character flow, so the wizard goes straight to the humanoid /
      // creature choice. Guarded on the switch as well as the in-scene flag
      // (same as the origin step), since the flag is cleared at add-member.
      // The exception is Detailed mode, which the tutorial does offer, so the
      // step stays interactive whenever that plugin is loaded.
      if (step === STEP.CREATION_MODE && isTutorialFlow() && !detailedModeAvailable()) return true;

      // Detailed mode: the character-type step hands the whole member over to
      // the Empathize editor, so every step it covers is walked past by
      // Back/Forward and the editor is the only landing point per member.
      if (Scene_CharacterCreation.isDetailedMode() && detailedModeAvailable() &&
          [STEP.PORTRAIT, STEP.GENDER, STEP.CLASS, STEP.TRAITS,
           STEP.HOMETOWN, STEP.BIRTHDATE].includes(step)) {
        return true;
      }

      if (Scene_CharacterCreation._stepHiddenForMode(step)) return true; // quick-mode skips
      // Party-level "once" steps are interactive only while building the first
      // member; for members 2/3 they are already settled, so Back/Forward (and
      // getStartingStep) skip them. This keeps Back at the character-type step a
      // no-op for later members instead of dropping them into settings/mode.
      if (memberIndex >= 1 &&
          (step === STEP.SETTINGS || step === STEP.DIFFICULTY || step === STEP.COMBAT_MODE ||
           step === STEP.CREATION_MODE || step === STEP.HOMETOWN)) {
        return true;
      }
      // Creatures skip the class step in both modes (the creature is built in the
      // full creature scene, then the flow resumes on traits).
      if (step === STEP.CLASS && isCreature) return true;
      // Portrait style: creatures choose theirs inside the creature scene (2D
      // battler vs 3D model), and without the 3D editor there is nothing to
      // choose between.
      if (step === STEP.PORTRAIT && (isCreature || isTutorial || !portraitModelAvailable())) return true;
      if (step === STEP.TRAITS && memberIndex >= 1) return true;      // members 2/3 auto traits
      if (step === STEP.ADD_MEMBER && $gameParty.size() >= 3) return true; // party already full
      if (step === STEP.ORIGIN && $gameSwitches.value(100)) return true;   // tutorial switch ends at origin

      return false;
    }
    static getStartingStep() {
      // The first genuinely interactive step: walk forward over every step
      // setupStep() would auto-advance past.
      let step = 0;
      while (step < CharacterCreationData.length && this._stepAutoAdvances(step)) {
        step++;
      }
      return step;
    }
    static prepare(startStep = 0) {
      this._startStep = startStep;
    }
    // Helper method to get the current actor being created
    static getCurrentActor() {
      const actorId = this._currentPartyMemberIndex + 1; // Actor IDs are 1-based
      return $gameActors.actor(actorId);
    }
    // Helper method to get current actor ID
    static getCurrentActorId() {
      return this._currentPartyMemberIndex + 1;
    }
    // Detailed mode: hand this member over to the Empathize editor
    // (CharacterCreationFull.js) instead of walking the wizard's own
    // per-character steps. The editor resumes the wizard at the add-member
    // prompt when it closes, so the steps it covers (portrait, gender, class,
    // traits, hometown, birth date) are never reached; _stepAutoAdvances walks
    // Back past them for the same reason. Answers true when it has taken over.
    startDetailedEditor(memberIndex) {
      if (!Scene_CharacterCreation.isDetailedMode() || !detailedModeAvailable()) return false;
      this._ccDetailedHandover = true;
      this.hideUI();
      // The board's DOM overlay is separate from the RMMZ windows and would sit
      // over the panel until terminate() fades it out, so it is dropped here,
      // the same thing the tutorial's end-of-flow branch does.
      if (this._dndContainer) this._dndContainer.style.display = "none";
      window.CharacterCreationFull.open(memberIndex || 0);
      return true;
    }

    hideUI() {
      if (this._titleWindow) {
        this._titleWindow.visible = false;
        this._titleWindow.opacity = 0;
      }
      if (this._gridWindow) {
        this._gridWindow.deactivate();
        this._gridWindow.visible = false;
        this._gridWindow.opacity = 0;
      }
    }
    // Add these methods to Scene_CharacterCreation class

    showPresetSelection() {
      // Nothing left to pick in this world (or the tutorial, which never offers
      // pre-made characters): stay on the current step instead of opening an
      // empty board (which had no items to select or cancel from).
      if (isTutorialFlow() || availablePresets().length === 0) {
        SoundManager.playBuzzer();
        if (this._gridWindow) this._gridWindow.activate();
        return;
      }

      // Hide current windows
      if (this._titleWindow) {
        this._titleWindow.visible = false;
        this._titleWindow.opacity = 0;
      }
      if (this._gridWindow) {
        this._gridWindow.visible = false;
        this._gridWindow.opacity = 0;
      }

      // Create preset selection windows
      this.createPresetTitleWindow();
      this.createPresetWindow();
    }

    createPresetTitleWindow() {
      const rect = this.titleWindowRect();
      this._presetTitleWindow = new Window_CharacterCreationTitle(rect);
      this._presetTitleWindow.setTitle(T('CharCreate.selectCharacter'));
      this._presetTitleWindow.visible = false;
      this._presetTitleWindow.opacity = 0;
      this.addWindow(this._presetTitleWindow);
    }

    createPresetWindow() {
      const rect = this.presetWindowRect();
      this._presetWindow = new Window_CharacterPresets(rect);
      this._presetWindow.setHandler("ok", this.onPresetSelect.bind(this));
      this._presetWindow.setHandler("cancel", this.onPresetCancel.bind(this));
      // Leafing through a dossier's alternate looks leaves the cursor where it
      // is, so the parchment overlay has to be told to redraw.
      if (this._presetWindow.setSkinHandler) {
        this._presetWindow.setSkinHandler(this.onPresetSkinChange.bind(this));
      }
      this._presetWindow.visible = false;
      this._presetWindow.opacity = 0;
      this.addWindow(this._presetWindow);
    }

    presetWindowRect() {
      const titleRect = this.titleWindowRect();
      const x = 50;
      const y = titleRect.y + titleRect.height + 20;
      const width = Graphics.boxWidth - 100;
      const height = Graphics.boxHeight - y - 50;
      return new Rectangle(x, y, width, height);
    }

    // MODIFIED: Reworked to apply full character preset data (inventory, skills, equips, etc.)
    onPresetSelect() {
      // The scene keeps updating (and reading input) through the fade-out after
      // popScene, so guard against applying the same dossier twice.
      if (this._presetApplied) return;
      const preset = this._presetWindow && this._presetWindow.currentPreset();
      if (!preset) return;
      this._presetApplied = true;

      const skinData = this._presetWindow.currentSkin
        ? this._presetWindow.currentSkin()
        : null;

      const actor = Scene_CharacterCreation.getCurrentActor();
      if (actor) {
        try {
          this._applyPreset(preset, actor, skinData);
        } catch (e) {
          // A broken field in one dossier must never strand the player inside
          // the wizard with no way out: log it and start with what was applied.
          console.error(
            `CharacterCreation: failed to apply preset "${preset.name}"`, e
          );
        }

        // Retire the dossier for the whole world: a pre-made character can be
        // played only once per world, across every savegame of that world.
        if (typeof markPresetUsed === "function") {
          markPresetUsed(preset.id);
        }

        // The preset path ends creation on the spot (no origin step), so close
        // it out here: creation switches, completion bookkeeping, and the
        // new-playthrough save that markFirstCreationComplete schedules.
        actor.refresh();
        actor.recoverAll();
        $gameSwitches.setValue(13, true); // character created
        $gameSwitches.setValue(33, true); // creation sequence complete
        markFirstCreationComplete();

        // Track the current preset ID for death removal
        $gameSystem._currentPresetId = preset.id;

        // Transfer player to the dossier's home location
        const target = $dataMapInfos && $dataMapInfos[preset.mapId];
        if (target) {
          $gamePlayer.reserveTransfer(preset.mapId, preset.x, preset.y, 2, 0);
        } else {
          console.error(
            `CharacterCreation: preset "${preset.name}" points at missing map ${preset.mapId}; staying put`
          );
        }
      }

      // Drop the parchment overlay before the scene fades out, like every other
      // path that ends creation.
      if (this._dndContainer) {
        this._dndContainer.style.display = "none";
      }
      this.popScene();
    }

    // Applies one preset dossier (class, inventory, skills, traits, gear,
    // switches) onto the actor being created. `skinData` is the look picked on
    // the dossier page; without one the dossier's own sprite and bust stand.
    _applyPreset(preset, actor, skinData) {
      const look = skinData || presetSkins(preset)[0] || preset;

      // Set actor properties
      actor.setName(preset.name);
      actor.setCharacterImage(look.sprite, look.spriteIndex || 0);

      // A stale dossier classId would otherwise take the actor's class down
      // with it; fall back to the default class instead.
      if ($dataClasses[preset.classId]) {
        actor.changeClass(preset.classId, false);
      } else {
        console.error(
          `CharacterCreation: preset "${preset.name}" has unknown class ${preset.classId}`
        );
      }

      // Retired party members (Dynamics -> Roster -> Set Inactive) carry the
      // level they reached; hand-authored dossiers have no level field and stay
      // on the wizard's starting level. Set after the class change so the exp
      // curve matches the new class.
      if (preset.level > 1) {
        actor.changeLevel(Math.max(1, Math.min(99, preset.level)), false);
      }

      // Clear party's current inventory and gold
      $gameParty.initAllItems();
      $gameParty.gainGold(-$gameParty.gold());

      // Apply preset money and items
      $gameParty.gainGold(preset.money || 0);
      (preset.items || []).forEach((itemData) => {
        if ($dataItems[itemData.id])
          $gameParty.gainItem($dataItems[itemData.id], itemData.amount);
      });
      (preset.weapons || []).forEach((itemData) => {
        if ($dataWeapons[itemData.id])
          $gameParty.gainItem($dataWeapons[itemData.id], itemData.amount);
      });
      (preset.armors || []).forEach((itemData) => {
        if ($dataArmors[itemData.id])
          $gameParty.gainItem($dataArmors[itemData.id], itemData.amount);
      });

      // Global requirement: Add item 591
      if ($dataItems[714]) {
        $gameParty.gainItem($dataItems[714], 1);
      }

      // Learn additional skills from preset
      (preset.skills || []).forEach((skillId) => {
        actor.learnSkill(skillId);
      });

      // NEW: Add global starter skills
      GLOBAL_STARTER_SKILLS.forEach((skillId) => {
        if ($dataSkills[skillId]) {
          actor.learnSkill(skillId);
        }
      });

      // Refresh actor to apply class traits
      actor.refresh();

      // Apply preset traits if defined
      if (preset.traits && Array.isArray(preset.traits) && preset.traits.length > 0) {
        applyTraitsToActor(actor, preset.traits);
      }

      // Apply preset specializations (js/db/Skills/Specialization.json ids),
      // if defined. setSpecializationTrainedLevel is added by
      // UI/SpecializationMenu.js onto Game_Actor.
      if (preset.specializations && Array.isArray(preset.specializations) && actor.setSpecializationTrainedLevel) {
        preset.specializations.forEach((entry) => {
          if (entry && entry.id) actor.setSpecializationTrainedLevel(entry.id, entry.level);
        });
      }

      // Equip items from preset
      (preset.equips || []).forEach((itemId, slotId) => {
        if (itemId > 0) {
          const etypeId = actor.equipSlots()[slotId];
          let item = null;
          if (etypeId === 1) {
            item = $dataWeapons[itemId];
          } else {
            item = $dataArmors[itemId];
          }
          if (item) {
            actor.changeEquip(slotId, item);
          }
        }
      });

      // Store class name in variable
      const classParams = PluginManager.parameters("CharacterCreationClassSelector");
      const variableId = Number(classParams["classNameVariable"] || 0);
      if (variableId > 0) {
        const cls = $dataClasses[preset.classId];
        $gameVariables.setValue(
          variableId,
          cls ? cls.name : ""
        );
      }

      // Pre-made dossiers ship with a drawn bust, so that is their portrait.
      // Every alternate look was drawn twice, sprite and bust, so the portrait
      // follows whichever look was picked.
      if (look.busts) {
        const presetActor = $gameActors.actor(1);
        presetActor.setVnBust(look.busts);
        if (presetActor.setPortraitMode) presetActor.setPortraitMode("bust");
      }

      // Set switches
      if (preset.switches && Array.isArray(preset.switches)) {
        preset.switches.forEach((switchId) => {
          $gameSwitches.setValue(switchId, true);
        });
      }

      // Restore creature/normal character flag from preset
      // Get the correct creature switch based on current party member (77, 78, or 79)
      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const creatureSwitchId = 77 + currentMemberIndex; // 77 for actor 1, 78 for actor 2, 79 for actor 3

      if (preset.isCreature !== undefined) {
        $gameSwitches.setValue(creatureSwitchId, preset.isCreature);
      } else {
        // Default to OFF (normal character) for backwards compatibility
        $gameSwitches.setValue(creatureSwitchId, false);
      }

      // Sync gender/orientation/birth data onto the actor and its Empathize
      // (NPCSociety) profile, so a pre-made character's dossier stays
      // consistent instead of the Empathize panel rolling a random identity
      // the first time it's viewed.
      window.CharacterPresets?.applyPresetIdentity?.(preset, actor);

      // Park the vehicle the dossier ships with (Em's camper), if any.
      window.CharacterPresets?.applyPresetVehicle?.(preset);

      actor.refresh();
    }

    onPresetCancel() {
      // Return to character type selection
      if (this._presetTitleWindow) {
        this._presetTitleWindow.close();
        this._presetTitleWindow = null;
      }
      if (this._presetWindow) {
        this._presetWindow.close();
        this._presetWindow = null;
      }

      // Re-activate grid window for keyboard input (DOM handles visuals)
      if (this._gridWindow) {
        this._gridWindow.activate();
      }

      this.refreshUIOverlayDOM();
    }

    showUI() {
      // DOM handles visuals; just re-activate grid window for keyboard input
      if (this._gridWindow) {
        this._gridWindow.activate();
      }
    }

    initialize() {
      super.initialize();

      // Check if we're resuming from an interrupted step (e.g., after creature creation)
      if (Scene_CharacterCreation._interruptedStep >= 0) {
        this._step = Scene_CharacterCreation._interruptedStep + 1;
        Scene_CharacterCreation._interruptedStep = -1;
      } else {
        this._step = Scene_CharacterCreation._startStep;
        Scene_CharacterCreation._startStep = 0;
      }

      this._waitingForCommonEvent = false;
      this._interpreter = null;

      // Reset traits flag for a fresh character creation, i.e. when starting at
      // (or before) the first interactive step rather than resuming mid-flow.
      if (this._step <= Scene_CharacterCreation.getStartingStep()) {
        Scene_CharacterCreation._traitsProcessed = false;
      }
    }

    create() {
      super.create();
      // Ambient loops carried over from wherever the game was before (a biome
      // BGS from the previous playthrough, a map ambience behind the title)
      // would keep running under the whole wizard, so silence them on entry.
      AudioManager.stopBgs();
      this.createTitleWindow();
      this.createGridWindow();
      this.setupStep();
      this.createUIOverlay();
    }

    terminate() {
      super.terminate();
      if (this._dndContainer) {
        const container = this._dndContainer;
        container.style.transition = "opacity 0.2s ease-out";
        container.style.opacity = "0";
        container.style.pointerEvents = "none";
        
        if (window._ccOverlayTimeout) {
          clearTimeout(window._ccOverlayTimeout);
        }
        window._ccOverlayTimeout = setTimeout(() => {
          if (container) {
            container.innerHTML = "";
            container.style.display = "none";
            container.style.opacity = "1";
            container.style.pointerEvents = "auto";
          }
          window._ccOverlayTimeout = null;
        }, 200);
      }
    }

    createUIOverlay() {
      // Detailed mode handed this member over to the Empathize editor from
      // setupStep(), which runs before this: paint nothing, or the wizard's
      // board would flash for the frame before the scene change lands.
      if (this._ccDetailedHandover) return;
      // 1. Mute native windows
      if (this._titleWindow) {
        this._titleWindow.visible = false;
        this._titleWindow.opacity = 0;
      }
      if (this._gridWindow) {
        this._gridWindow.visible = false;
        this._gridWindow.opacity = 0;
      }

      // 2. Create container
      let container = document.getElementById("character-creation-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "character-creation-container";
        document.body.appendChild(container);
      }
      
      // Clear any pending timeout and ensure styles are clean
      if (window._ccOverlayTimeout) {
        clearTimeout(window._ccOverlayTimeout);
        window._ccOverlayTimeout = null;
      }
      
      this._dndContainer = container;
      this._dndContainer.style.transition = "none";
      this._dndContainer.style.display = "flex";
      this._dndContainer.style.opacity = "1";
      this._dndContainer.style.pointerEvents = "auto";
      this._dndContainer.innerHTML = ""; // Wipe clean to prevent stale DOM layout leaking

      this._lastIndex = -1;
      this._lastStep = -1;
      this._lastPresetMode = false;
      // Force the memoized party panel to rebuild on the first render of this scene.
      this._partyPanelSig = null;
      this._partyPanelHtml = null;
      // Re-apply any previously chosen random backdrop so it survives scene/DOM rebuilds.
      this.applySceneBackground(Scene_CharacterCreation._sceneBgImage);
      // Wheel scrolling for every pane of the spread (the details page above
      // all), with L2/R2 doing the same from a controller. See CCScroll.
      if (window.CCScroll) window.CCScroll.bindWheel(this._dndContainer);
      this.refreshUIOverlayDOM();
    }

    // CCScroll hook: the hometown step is a dropdown, so a wheel notch or a
    // trigger pull moves the highlighted row instead of scrolling the list.
    ccScrollStep(dir) {
      const stepData = this.currentStepData();
      if (!stepData || stepData.id !== "hometown") return false;
      const w = this._gridWindow;
      if (!w || !w.active) return false;
      const max = w.maxItems();
      if (max <= 0) return false;
      const idx = Math.max(0, Math.min(max - 1, w.index() + dir));
      if (idx === w.index()) return true;
      SoundManager.playCursor();
      w.select(idx);
      this.refreshUIOverlayDOM();
      return true;
    }

    // Scenic battlebacks used as a randomized backdrop behind the parchment pockets.
    static get SCENE_BACKDROPS() {
      return [
        // i18n-ignore-start: img/battlebacks file names
        "Bridge", "Castle", "Castle1", "Cliff", "Clouds", "Colosseum", "Crystal",
        "Cyberspace", "DarkSpace", "DemonCastle1", "DemonicWorld", "Desert",
        "DirtCave", "Forest", "Fort1", "GrassMaze", "Grassland", "IceCave",
        "IceMaze", "Lava", "LavaCave", "PoisonSwamp", "Port", "RockCave",
        "Ruins1", "Ruins2", "Sand", "Ship", "Snowfield", "Space", "Temple",
        "Tower", "Town1", "Town2", "Town3", "Town4", "Town5", "Wasteland",
        // i18n-ignore-end
      ];
    }

    // Pick a random scenic battleback and use it as the scene backdrop.
    randomizeSceneBackground() {
      const list = Scene_CharacterCreation.SCENE_BACKDROPS;
      const name = list[Math.floor(Math.random() * list.length)];
      Scene_CharacterCreation._sceneBgImage = name;
      this.applySceneBackground(name);
    }

    // Apply (or clear) the randomized backdrop on the overlay container, keeping a
    // dark gradient on top so the parchment text stays readable.
    applySceneBackground(name) {
      if (!this._dndContainer) return;
      if (!name) {
        this._dndContainer.style.backgroundImage = "";
        return;
      }
      const url = `img/battlebacks2/${name}.png`;
      this._dndContainer.style.backgroundImage =
        `linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0.82)), url('${url}')`;
      this._dndContainer.style.backgroundSize = "cover";
      this._dndContainer.style.backgroundPosition = "center";
      this._dndContainer.style.backgroundRepeat = "no-repeat";
    }

    cleanText(str) {
      if (!str) return "";
      return str.replace(/\\C\[\d+\]/gi, "").replace(/\\C/gi, "");
    }

    // Current age of a preset dossier, computed against the live in-game
    // calendar (TimeDateSystem / Variable 114) rather than the real-world
    // clock, so it reflects the game's own timeline. Returns null when the
    // preset has no birthDate or the time system isn't available yet.
    calculatePresetAge(birthDate) {
      if (!birthDate) return null;
      const parts = birthDate.split("-").map(Number);
      const birthYear = parts[0];
      const birthMonth = parts[1] || 1;
      const birthDay = parts[2] || 1;
      if (!birthYear) return null;
      if (!window.TimeDateSystem || !window.TimeDateSystem.getGameTimeMinutes || !window.TimeDateSystem.getDateTimeFromMinutes) {
        return null;
      }
      const minutes = window.TimeDateSystem.getGameTimeMinutes();
      const currentDate = window.TimeDateSystem.getDateTimeFromMinutes(minutes);
      let age = currentDate.year - birthYear;
      const curMonth = Number(currentDate.monthNum);
      if (curMonth < birthMonth || (curMonth === birthMonth && currentDate.day < birthDay)) {
        age -= 1;
      }
      return age >= 0 ? age : null;
    }

    // Preset birthDate is stored as "YYYY-MM-DD"; the dossier displays dates
    // as DD/MM/YYYY.
    formatPresetBirthDate(birthDate) {
      if (!birthDate) return "";
      const parts = birthDate.split("-");
      if (parts.length !== 3) return birthDate;
      const [year, month, day] = parts;
      return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
    }

    getSpriteStyle(spriteName, spriteIndex) {
      if (!spriteName) return "";
      const isBig = ImageManager.isBigCharacter(spriteName);
      const url = `img/characters/${spriteName}.png`;
      if (isBig) {
        // Big-character ($) sheets are always a 3-col x 4-row grid, but the
        // per-frame aspect ratio varies by pack (this project's sheets are
        // not the RTP's square 48x48 frame). Forcing a fixed 48x48 box
        // squishes/crops any sheet whose frame isn't square, so size the box
        // from the actual bitmap dimensions to keep frames undistorted.
        const bitmap = ImageManager.loadCharacter(spriteName);
        const frameW = (bitmap.width || 144) / 3;
        const frameH = (bitmap.height || 192) / 4;
        const displayWidth = 48;
        const displayHeight = Math.round(displayWidth * (frameH / frameW));
        return `background-image: url('${url}'); background-position: 50% 0%; background-size: 300% 400%; width: ${displayWidth}px; height: ${displayHeight}px;`;
      } else {
        const col = spriteIndex % 4;
        const row = Math.floor(spriteIndex / 4);
        const fx = col * 3 + 1; // Standing middle
        const fy = row * 4;     // Facing down
        const pctX = (fx / 11) * 100;
        const pctY = (fy / 7) * 100;
        return `background-image: url('${url}'); background-position: ${pctX}% ${pctY}%; background-size: 1200% 800%; width: 48px; height: 48px;`;
      }
    }

    refreshUIOverlayDOM() {
      if (this._ccDetailedHandover) return; // the Empathize editor is taking over
      if (!this._dndContainer) return;

      // Settings step uses its own renderer
      const _curStepData = this._step < CharacterCreationData.length ? CharacterCreationData[this._step] : null;
      // The wizard has finished (setupStep called popScene without resetting
      // _step): the scene keeps updating during the fade-out, but there is no
      // step data left to render. Bail out so we never read .choices off
      // undefined (issue #117).
      if (!_curStepData) return;
      if (_curStepData.isSettingsStep) {
        this._refreshSettingsDOM();
        return;
      }

      const isPreset = !!this._presetWindow;

      // 1. Mute dynamic preset windows if they exist
      if (this._presetTitleWindow) {
        this._presetTitleWindow.visible = false;
        this._presetTitleWindow.opacity = 0;
      }
      if (this._presetWindow) {
        this._presetWindow.visible = false;
        this._presetWindow.opacity = 0;
      }

      const activeIndex = isPreset ? (this._presetWindow ? this._presetWindow.index() : 0) : (this._gridWindow ? this._gridWindow.index() : 0);
      const currentStep = this._step;

      // Check if anything has actually changed
      if (this._lastIndex === activeIndex && this._lastStep === currentStep && this._lastPresetMode === isPreset) {
        return; // No change, skip updating DOM!
      }

      // Check if it's a structural change (step change or mode change)
      const isStepOrModeChange = (this._lastStep !== currentStep || this._lastPresetMode !== isPreset);

      let leftHtml = "";
      let rightHtml = "";

      if (isPreset) {
        // --- PRESET SELECTION MODE ---
        const preset = this._presetWindow.currentPreset();
        if (preset) {
          const className = $dataClasses[preset.classId] ? $dataClasses[preset.classId].name : "Unknown";

          let traitsHtml = "";
          if (preset.traits && preset.traits.length > 0) {
            const traitBank = (window.Health && window.Health.Traits) || [];
            traitsHtml = preset.traits.map(traitId => {
              const trait = traitBank.find((t) => t.id === traitId);
              if (!trait) return "";
              const traitName = resolveTraitName(trait.name) || trait.name;
              return `<div class="cc-element-badge" style="margin: 2px;">${traitName}</div>`;
            }).filter(Boolean).join(" ");
          }
          if (!traitsHtml) {
            traitsHtml = `<span style="font-size: 0.85rem; color: #5c4b3d; font-style: italic;">${T('CharCreate.noDefiningTraits')}</span>`;
          }

          let skillsHtml = "";
          if (preset.skills && preset.skills.length > 0) {
            skillsHtml = preset.skills.map(id => {
              const skill = $dataSkills[id];
              return skill ? `<div class="cc-element-badge" style="margin: 2px;">${window.CCDbName(skill)}</div>` : "";
            }).join(" ");
          } else {
            skillsHtml = `<span style="font-size: 0.85rem; color: #5c4b3d; font-style: italic;">${T('CharCreate.noSkillsLearned')}</span>`;
          }

          let specsHtml = "";
          if (preset.specializations && preset.specializations.length > 0 && window.Specializations && window.Specializations.ready) {
            specsHtml = preset.specializations.map((entry) => {
              const spec = window.Specializations.byId.get(entry.id);
              if (!spec) return "";
              const levelName = window.Specializations.levelName(entry.level);
              return `<div class="cc-element-badge" style="margin: 2px;">${spec.name} <span style="opacity:0.7;">(${levelName})</span></div>`;
            }).filter(Boolean).join(" ");
          }
          if (!specsHtml) {
            specsHtml = `<span style="font-size: 0.85rem; color: #5c4b3d; font-style: italic;">${T('CharCreate.noSpecializations')}</span>`;
          }

          let gearHtml = "";
          if (preset.items && preset.items.length > 0) {
            gearHtml += preset.items.map(itemData => {
              const item = $dataItems[itemData.id];
              return item ? `<div style="font-size: 0.85rem; padding: 2px 0;">${window.CCDbName(item)} x${itemData.amount}</div>` : "";
            }).join("");
          }
          if (preset.weapons && preset.weapons.length > 0) {
            gearHtml += preset.weapons.map(itemData => {
              const item = $dataWeapons[itemData.id];
              return item ? `<div style="font-size: 0.85rem; padding: 2px 0;">${window.CCDbName(item)} x${itemData.amount}</div>` : "";
            }).join("");
          }
          if (preset.armors && preset.armors.length > 0) {
            gearHtml += preset.armors.map(itemData => {
              const item = $dataArmors[itemData.id];
              return item ? `<div style="font-size: 0.85rem; padding: 2px 0;">${window.CCDbName(item)} x${itemData.amount}</div>` : "";
            }).join("");
          }
          if (!gearHtml) {
            gearHtml = `<span style="font-size: 0.85rem; color: #5c4b3d; font-style: italic;">${T('CharCreate.emptyBackpack')}</span>`;
          }

          let originRows = "";
          // Resolved, not read raw: an endless dossier (Em) is from a different
          // town every incarnation.
          const presetHometownRaw = typeof getPresetHometown === "function"
            ? getPresetHometown(preset)
            : (preset.hometown || "");
          // A town that is a travel destination reads by its Destinations.json
          // "name"; an invented one (Em's "...bledon") reads as it stands.
          const presetHometown = (presetHometownRaw && window.WorkSystem?.destinationName)
            ? window.WorkSystem.destinationName(presetHometownRaw)
            : presetHometownRaw;
          if (presetHometown) {
            originRows += `<div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.hometown')}:</span><span class="cc-dossier-value">${presetHometown}</span></div>`;
          }
          if (preset.nationId) {
            originRows += `<div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.nationOfBirth')}:</span><span class="cc-dossier-value">${preset.nationId}</span></div>`;
          }
          if (preset.birthDate) {
            originRows += `<div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.dateOfBirth')}:</span><span class="cc-dossier-value">${this.formatPresetBirthDate(preset.birthDate)}</span></div>`;
            const presetAge = this.calculatePresetAge(preset.birthDate);
            if (presetAge !== null) {
              originRows += `<div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.currentAge')}:</span><span class="cc-dossier-value">${presetAge}</span></div>`;
            }
          }
          const originCardHtml = originRows ? `
              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.origin')}</h3>
                ${originRows}
              </div>
          ` : "";

          // Resolved, not read raw: an endless dossier (Em) rolls a different
          // background for every playthrough.
          // Already resolved to the active language by the presets plugin.
          const loreText = typeof getPresetLore === "function" ? getPresetLore(preset) : "";
          const loreCardHtml = loreText ? `
              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.background')}</h3>
                <div style="font-size: 0.85rem; line-height: 1.4;">${loreText}</div>
              </div>
          ` : "";

          // Some of these people were drawn more than once. The dossier shows
          // the look the player is currently reading it in, and offers the
          // others as a row of thumbnails under the portrait.
          const skins = presetSkins(preset);
          const skinIdx = this._presetWindow.skinIndex ? this._presetWindow.skinIndex() : 0;
          const currentSkin = skins[skinIdx] || skins[0] || preset;
          const skinsCardHtml = skins.length > 1 ? `
              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharPresets.skins')}</h3>
                <div class="cc-skins-row">
                  ${skins.map((s, i) => `
                    <div class="cc-wanted-card cc-skin-card${i === skinIdx ? ' selected' : ''}" onclick="SceneManager._scene.onPresetSkinClick(${i})">
                      <div class="cc-wanted-sprite" style="${this.getSpriteStyle(s.sprite, s.spriteIndex)}"></div>
                      <div class="cc-skin-name">${typeof getPresetSkinLabel === "function" ? getPresetSkinLabel(s) : ""}</div>
                    </div>
                  `).join("")}
                </div>
                <div class="cc-skins-hint">${T('CharPresets.skinHint')}</div>
              </div>
          ` : "";

          rightHtml = `
            <div class="cc-page cc-page-right">
              <h2 class="cc-header-gothic">${T('CharCreate.personalDossier')}</h2>

              <div class="cc-wanted-sprite" style="${this.getSpriteStyle(currentSkin.sprite, currentSkin.spriteIndex)}; margin: 0 auto 16px auto; transform: scale(1.6);"></div>

              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.identityProfile')}</h3>
                <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.vocation')}:</span><span class="cc-dossier-value">${className}</span></div>
                <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.startingWealth')}:</span><span class="cc-dossier-value">${(preset.money / 100).toFixed(2)}€</span></div>
              </div>
              ${skinsCardHtml}
              ${loreCardHtml}
              ${originCardHtml}
              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.traits')}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${traitsHtml}
                </div>
              </div>

              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.skills')}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${skillsHtml}
                </div>
              </div>

              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.specializations')}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${specsHtml}
                </div>
              </div>

              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.equipment')}</h3>
                <div style="display: flex; flex-direction: column;">
                  ${gearHtml}
                </div>
              </div>
            </div>
          `;
        }

        // Same list the preset window holds: only dossiers still free in this
        // world, so card indices line up with the selection index.
        const presets = availablePresets();

        const presetsCards = presets.map((p, index) => {
          const isSelected = index === activeIndex;
          const className = $dataClasses[p.classId]
            ? window.CCDbName($dataClasses[p.classId])
            : T('CharCreate.unknownVocation');
          // An endless dossier (Em) is never spent and never the same twice, so
          // its card wears a running border instead of the pinned-poster look.
          const endlessClass = p.endless ? " cc-card-endless" : "";
          const endlessRing = p.endless ? `<div class="cc-endless-ring"></div>` : "";
          // The poster shows the dossier in whichever look it is filed under
          // right now, so the board agrees with the page being read.
          const cardSkins = presetSkins(p);
          const cardSkin = cardSkins[this._presetWindow.skinIndex ? this._presetWindow.skinIndex(index) : 0] || cardSkins[0] || p;
          return `
            <div class="cc-wanted-card${endlessClass} ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onPresetCardClick(${index})">
              ${endlessRing}
              <div class="cc-wanted-sprite" style="${this.getSpriteStyle(cardSkin.sprite, cardSkin.spriteIndex)}"></div>
              <div class="cc-wanted-name">${p.name}</div>
              <div class="cc-wanted-class">${className}</div>
            </div>
          `;
        }).join("");

        leftHtml = `
          <div class="cc-page cc-page-left">
            <h2 class="cc-header-gothic">${T('CharCreate.presetCharacters')}</h2>

            <div class="cc-presets-board">
              ${presetsCards}
            </div>

            <div class="cc-button-panel">
              <button class="cc-btn-treaty" onclick="SceneManager._scene.onPresetCancelClick()">${T('CharCreate.back')}</button>
            </div>
          </div>
        `;
      } else {
        // --- CUSTOM WIZARD SELECTION MODE ---
        // The left-page party panel is memoized (see _wizardPartyPanelHtml):
        // rebuilding it runs NPC-society lore generation for up to three actors,
        // which must not happen on every cursor move.
        leftHtml = this._wizardPartyPanelHtml();

        const stepData = this.currentStepData();

        const optionCards = stepData.choices.map((choice, index) => {
          const isSelected = index === activeIndex;
          let genderSymbol = "";
          if (this._step === STEP.GENDER) {
            const symbols = ["♂", "♀", "⚦", ""];
            genderSymbol = `<div class="cc-gender-icon">${symbols[choice.value] || "⚦"}</div>`;
          }

          return `
            <div class="cc-card-option ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onOptionCardClick(${index})">
              ${genderSymbol}
              <div class="cc-option-title">${choice.name}</div>
              <div class="cc-option-desc">${this.cleanText(choice.description)}</div>
            </div>
          `;
        }).join("");

        const firstStep = Scene_CharacterCreation.getStartingStep();
        const showBackButton = this._step > firstStep;
        // On the very first step of a new game there is nothing to go back to
        // inside the wizard, so the slot holds the way out to the title screen.
        const backBtnHtml = showBackButton
          ? `<button class="cc-btn-treaty" onclick="SceneManager._scene.onCancel()">${T('CharCreate.back')}</button>`
          : (this.canExitToTitle()
            ? `<button class="cc-btn-treaty" onclick="SceneManager._scene.exitToTitle()">${T('CharCreate.returnToTitle')}</button>`
            : "");

        // Archetype/creature class picker uses a two-column grid.
        const isQuickClassStep = this._step === STEP.CLASS &&
          (Scene_CharacterCreation.isQuickMode() ||
            Scene_CharacterCreation.usesArchetypeClassPicker());
        // Archetype/class picker spread: list on the LEFT page, details of the
        // highlighted entry on the RIGHT page (creature mode keeps its layout).
        const isClassPicker = this._isClassPickerStep();
        // Origin step: same list-left / details-right spread as the class picker.
        const isOriginPicker = this._isOriginPickerStep();
        // Hometown step lists every destination, so it renders as a compact
        // scrollable dropdown (keyboard / controller / mouse / wheel) instead of
        // big cards.
        const isHometownStep = stepData.id === "hometown";
        let gridClass = "cc-select-grid";
        if (isQuickClassStep) gridClass += " cc-two-col";
        if (isClassPicker || isOriginPicker) gridClass += " cc-compact";
        if (isHometownStep) gridClass += " cc-dropdown-list";

        const buttonPanelHtml = `
            <div class="cc-button-panel">
              ${backBtnHtml}
              <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onOptionCardConfirm()">${T('CharCreate.confirm')}</button>
            </div>
        `;

        if (isClassPicker) {
          // Class step: the selection list (archetypes, or an archetype's
          // classes) replaces the party panel on the LEFT page. The RIGHT page
          // shows live details for whatever entry is highlighted, plus the
          // Back/Confirm buttons.
          leftHtml = `
            <div class="cc-page cc-page-left" style="display: flex; flex-direction: column;">
              <h2 class="cc-header-gothic">${stepData.title}</h2>

              <div class="${gridClass}" style="flex: 1; min-height: 0; overflow-y: auto; align-content: start;">
                ${optionCards}
              </div>
            </div>
          `;
          rightHtml = this._classStepDetailsHtml(stepData, activeIndex, buttonPanelHtml);
        } else if (isOriginPicker) {
          // Origin step: the list of origins fills the LEFT page; the RIGHT page
          // shows the highlighted origin's description and starting loadout.
          leftHtml = `
            <div class="cc-page cc-page-left" style="display: flex; flex-direction: column;">
              <h2 class="cc-header-gothic">${stepData.title}</h2>

              <div class="${gridClass}" style="flex: 1; min-height: 0; overflow-y: auto; align-content: start;">
                ${optionCards}
              </div>
            </div>
          `;
          rightHtml = this._originStepDetailsHtml(stepData, activeIndex, buttonPanelHtml);
        } else {
          rightHtml = `
          <div class="cc-page cc-page-right">
            <h2 class="cc-header-gothic">${stepData.title}</h2>

            <div class="${gridClass}">
              ${optionCards}
            </div>

            ${buttonPanelHtml}
          </div>
        `;
        }
      }

      // Find or create .cc-pockets-spread
      let spread = this._dndContainer.querySelector(".cc-pockets-spread");
      if (!spread) {
        this._dndContainer.innerHTML = `
          <div class="cc-pockets-spread">
            <div class="cc-page cc-page-left"></div>
            <div class="cc-page cc-page-right"></div>
          </div>
        `;
        spread = this._dndContainer.querySelector(".cc-pockets-spread");
      }

      if (isStepOrModeChange) {
        // Step or mode changed - fully update both page wrappers inside the spread
        spread.innerHTML = `
          ${leftHtml}
          ${rightHtml}
        `;
      } else {
        // Only selection index changed - optimized partial update!
        const leftPage = spread.querySelector(".cc-page-left");
        const rightPage = spread.querySelector(".cc-page-right");

        if (isPreset) {
          // Preset selection mode: explorer grid on the left page, dossier on the right page
          if (rightPage && rightHtml) {
            // Update dossier text by stripping wrapper tag
            const rightInnerHtml = rightHtml.replace(/^\s*<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
            rightPage.innerHTML = rightInnerHtml;
          }
          if (leftPage) {
            // Only update selected classes on the explorer grid cards
            const cards = leftPage.querySelectorAll(".cc-wanted-card");
            cards.forEach((card, idx) => {
              if (idx === activeIndex) {
                card.classList.add("selected");
              } else {
                card.classList.remove("selected");
              }
            });
          }
        } else if (this._isClassPickerStep() || this._isOriginPickerStep()) {
          // Class / origin picker: the list lives on the LEFT page (only the
          // highlight moves), while the RIGHT page re-renders the highlighted
          // entry's details.
          if (rightPage && rightHtml) {
            const rightInnerHtml = rightHtml.replace(/^\s*<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
            rightPage.innerHTML = rightInnerHtml;
          }
          if (leftPage) {
            const cards = leftPage.querySelectorAll(".cc-card-option");
            cards.forEach((card, idx) => {
              if (idx === activeIndex) {
                card.classList.add("selected");
              } else {
                card.classList.remove("selected");
              }
            });
          }
        } else {
          // Custom wizard mode: the party panel (left page) never changes on a
          // pure cursor move, so leave it untouched and only re-stamp the
          // selected option card on the right page. This avoids rebuilding the
          // left DOM (and reloading its character sprites) on every keypress,
          // which was the main source of navigation lag.
          if (rightPage) {
            const cards = rightPage.querySelectorAll(".cc-card-option");
            cards.forEach((card, idx) => {
              if (idx === activeIndex) {
                card.classList.add("selected");
              } else {
                card.classList.remove("selected");
              }
            });
          }
        }
      }

      // Auto-scroll selected card into view (Preset card or Option card depending on mode)
      setTimeout(() => {
        const selector = isPreset ? ".cc-wanted-card.selected" : ".cc-card-option.selected";
        const selectedCard = this._dndContainer.querySelector(selector);
        if (selectedCard) {
          selectedCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 10);

      // Record states for the next check
      this._lastIndex = activeIndex;
      this._lastStep = currentStep;
      this._lastPresetMode = isPreset;
    }

    // Memoized left-page party panel for the custom wizard. Rebuilding it runs
    // NPC-society lore generation (history simulation + backstory) for up to
    // three actors, so it must not run on every cursor move. We build a cheap
    // change signature from each member's displayed data (class, gender, name,
    // traits, gear) plus the active member, step and language; when the
    // signature is unchanged the cached HTML is returned untouched. This keeps
    // option navigation lag-free, since a plain cursor move never alters the
    // party panel.
    _wizardPartyPanelHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return this._partyPanelHtml || "";

      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const partyMembers = $gameParty.members();

      // Gather cheap per-member display data and build a change signature.
      const rows = [];
      const sigParts = [ConfigManager.language, this._step, currentMemberIndex];
      for (let i = 0; i < 3; i++) {
        const isEditing = (i === currentMemberIndex);
        const mActor = $gameActors.actor(i + 1);
        const mInParty = partyMembers.some((a) => a.actorId() === (i + 1));

        // Player 1 (i === 0) shows as vacant while still on the pre-customization
        // steps (step < 3) when currently creating Player 1.
        const isSlotVacant =
          (!mInParty && !isEditing) ||
          (i === 0 && currentMemberIndex === 0 && this._step < 3);

        if (isSlotVacant) {
          rows.push({ vacant: true, i });
          sigParts.push(i + ":V");
          continue;
        }

        const mClassId = mActor._classId;
        const mGenderVal = $gameVariables.value(38 + i);
        const name = mActor.name() || "";
        const traitNames = (mActor._selectedTraits || [])
          .map((tr) => resolveTraitName(tr && tr.name))
          .filter(Boolean);
        const equipNames = (mActor.equips() || []).filter((e) => e).map((e) => window.CCDbName(e));

        rows.push({ vacant: false, i, isEditing, mActor, mClassId, mGenderVal, name, traitNames, equipNames });
        sigParts.push(
          i + ":" + mClassId + ":" + mGenderVal + ":" + name +
          ":" + traitNames.join("|") + ":" + equipNames.join("|")
        );
      }

      // Everything the party starts with, so the loadout is visible before the
      // wizard is confirmed: the shared bag plus each member's equipped gear.
      const invEntries = this._startingInventoryEntries();
      sigParts.push("inv:" + invEntries.map((e) => e.name + "x" + e.qty + (e.note || "")).join("|"));

      const sig = sigParts.join("~");
      if (this._partyPanelSig === sig && this._partyPanelHtml != null) {
        return this._partyPanelHtml;
      }
      this._partyPanelSig = sig;

      // Minimal HTML escape for procedurally generated backstory text.
      const escLore = (s) => String(s || "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      let cardsHtml = "";
      for (const r of rows) {
        if (r.vacant) {
          const slotName = r.i === 0 ? "I" : (r.i === 1 ? "II" : "III");
          cardsHtml += `
            <div class="cc-party-card vacant">
              <div class="cc-party-card-badge">${T('CharCreate.slotVacant', { slot: slotName })}</div>
              <div class="cc-party-card-vacant-text">${T('CharCreate.pendingSense')}</div>
            </div>
          `;
          continue;
        }

        const { i, isEditing, mActor, mClassId, mGenderVal, name, traitNames, equipNames } = r;
        const mClassName = $dataClasses[mClassId] ? window.CCDbName($dataClasses[mClassId]) : T('CharCreate.none');

        const mHp = mActor.mhp;
        const mMp = mActor.mmp;
        const mStr = mActor.param(2);
        const mCon = mActor.param(3);
        const mMat = mActor.param(4);
        const mMdf = mActor.param(5);
        const mAgi = mActor.param(6);
        const mLuk = mActor.param(7);

        let mGenderLabel = T('CharCreate.none2');
        if (mGenderVal === 0) mGenderLabel = T('CharCreate.male');
        else if (mGenderVal === 1) mGenderLabel = T('CharCreate.female');
        else if (mGenderVal === 2) mGenderLabel = T('CharCreate.nonBinary2');
        else if (mGenderVal === 3) mGenderLabel = T('CharCreate.cocoon');

        const badgeText = isEditing ? T('CharCreate.registering') : T('CharCreate.finalized');
        const nameText = name || T('CharCreate.unnamedAlly');

        // NPC-system lore: generate the society profile + historical backstory
        // now so the narrative can sit behind the card and be browsed in the wiki.
        const lore = this._ensureActorLore(mActor, mGenderVal);
        const narrative = lore && lore.backstory
          ? (window.NPCHistSim?.narrativeOf?.(lore.backstory) ?? lore.backstory.narrative ?? "")
          : "";

        const traitsHtml = traitNames.length
          ? `<div class="cc-party-card-detail"><span class="cc-detail-label">${T('CharCreate.traits2')}:</span> <span class="cc-detail-text">${traitNames.join(", ")}</span></div>`
          : "";
        const equipHtml = equipNames.length
          ? `<div class="cc-party-card-detail"><span class="cc-detail-label">${T('CharCreate.gear')}:</span> <span class="cc-detail-text">${equipNames.join(", ")}</span></div>`
          : "";
        const loreHtml = narrative
          ? `<div class="cc-party-card-lore">${escLore(narrative)}</div>`
          : "";

        cardsHtml += `
          <div class="cc-party-card ${isEditing ? 'active' : ''}">
            <div class="cc-party-card-badge">${badgeText}</div>
            <div class="cc-party-card-header">
              <div class="cc-party-card-name">${nameText}</div>
              <div class="cc-party-card-class">${mClassName} (${mGenderLabel})</div>
            </div>
            <div class="cc-party-card-body">
              <div class="cc-party-card-stats-grid">
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.hp')}</span><span class="value">${mHp}</span></div>
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.mp')}</span><span class="value">${mMp}</span></div>
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.str')}</span><span class="value">${mStr}</span></div>
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.con')}</span><span class="value">${mCon}</span></div>
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.dex')}</span><span class="value">${mAgi}</span></div>
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.int')}</span><span class="value">${mMat}</span></div>
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.wis')}</span><span class="value">${mMdf}</span></div>
                <div class="cc-party-card-stat"><span class="label">${T('CharCreate.abbrev.psi')}</span><span class="value">${mLuk}</span></div>
              </div>
              ${traitsHtml}
              ${equipHtml}
              ${loreHtml}
            </div>
          </div>
        `;
      }

      cardsHtml += this._startingInventoryHtml(invEntries);

      this._partyPanelHtml = `
        <div class="cc-page cc-page-left">
          <h2 class="cc-header-gothic">${T('CharCreate.yourParty')}</h2>
          <div class="cc-party-cards-container">
            ${cardsHtml}
          </div>
        </div>
      `;
      return this._partyPanelHtml;
    }

    // Every item the party owns right now: the shared bag with its counts,
    // followed by whatever each member is already wearing (equipped gear never
    // shows up in the bag, so it has to be collected per actor).
    _startingInventoryEntries() {
      const entries = [];
      for (const item of $gameParty.allItems()) {
        if (!item || !item.name) continue;
        entries.push({ item, qty: $gameParty.numItems(item), name: window.CCDbName(item), note: "" });
      }
      for (const member of $gameParty.members()) {
        for (const gear of member.equips()) {
          if (!gear || !gear.name) continue;
          entries.push({ item: gear, qty: 1, name: window.CCDbName(gear), note: member.name() });
        }
      }
      return entries;
    }

    // The inventory card that closes the party panel, under the last slot.
    _startingInventoryHtml(entries) {
      const title = T('CharCreate.startingInventory');
      if (!entries.length) {
        return `
          <div class="cc-party-card">
            <div class="cc-party-card-header">
              <div class="cc-party-card-name">${title}</div>
            </div>
            <div class="cc-party-card-body">
              <div class="cc-party-card-vacant-text">${T('CharCreate.nothingYet')}</div>
            </div>
          </div>
        `;
      }

      const chips = entries.map((e) => {
        const worn = e.note
          ? `<span class="cc-inv-worn">${T('CharCreate.wornBy')} ${e.note}</span>`
          : "";
        const count = e.qty > 1 ? `<span class="cc-inv-qty">x${e.qty}</span>` : "";
        return `
          <div class="cc-inv-chip">
            <span style="${this._ccIconStyle(e.item.iconIndex, 22)}"></span>
            <span class="cc-inv-name">${e.name}</span>
            ${count}
            ${worn}
          </div>
        `;
      }).join("");

      return `
        <div class="cc-party-card">
          <div class="cc-party-card-header">
            <div class="cc-party-card-name">${title}</div>
            <div class="cc-party-card-class">${entries.length} ${T('CharCreate.entries')}</div>
          </div>
          <div class="cc-party-card-body">
            <div class="cc-inv-list">${chips}</div>
          </div>
        </div>
      `;
    }

    // Generate the NPC-system lore (society profile + historical backstory) for
    // a finalized actor so it can be shown behind the party card and browsed
    // later in the Party section of the NPC wiki (openForActor). Called only
    // when a member's signature changes (see _wizardPartyPanelHtml), never on a
    // plain cursor move.
    _ensureActorLore(actor, genderVal) {
      if (!actor || !actor.name()) return null;
      const name = actor.name();
      try {
        // Backstory pulls from the world timeline; run history once if absent.
        // Read through HistoryManager so the active-world store (WorldManager)
        // and the $gameSystem fallback are treated uniformly.
        const hasHistory = window.HistoryManager
          ? window.HistoryManager.getEvents().length
          : ($gameSystem._historicalEvents && $gameSystem._historicalEvents.length);
        if (!hasHistory && !this._loreHistoryRan && window.HistoryManager) {
          this._loreHistoryRan = true;
          window.HistoryManager.runSimulation();
        }
        if (window.NPCSocietyRegistry) {
          const cls = actor.currentClass();
          const profile = window.NPCSocietyRegistry.ensureProfile(name, cls ? cls.id : null);
          // Drive backstory pronouns from the gender the player picked here
          // (0 he, 1 she, 2 they, 3 xe). Regenerate the cached backstory if the
          // gender changed so the narrative and the NPC wiki stay in sync.
          if (profile && typeof genderVal === "number" && profile.gender !== genderVal) {
            profile.gender = genderVal;
            profile.backstory = null;
          }
          // Flag creatures so the backstory reads "born in the wilds near
          // <city>" instead of being born into a nation. A creature that took a
          // class of its own is still a creature, so the built flag decides and
          // the Monster class is only the fallback signal.
          const isCreature =
            !!actor._isCreatureActor || (cls ? cls.id === 65 : false);
          if (profile && profile.isCreature !== isCreature) {
            profile.isCreature = isCreature;
            profile.backstory = null;
          }
        }
        if (window.NPCHistSim) window.NPCHistSim.generateBackstoryNow(name);
      } catch (e) {
        console.warn("CharacterCreation: ensureActorLore failed", e);
      }
      return window.NPCSocietyRegistry ? window.NPCSocietyRegistry.getProfile(name) : null;
    }

    // --- Class step: right-page details for the highlighted entry ----------

    // True when the CLASS step renders the list-left / details-right spread.
    // Creature mode keeps its own inline layout.
    _isClassPickerStep() {
      return this._step === STEP.CLASS &&
        !Scene_CharacterCreation._isCreatureMode &&
        (Scene_CharacterCreation.isQuickMode() ||
          Scene_CharacterCreation.usesArchetypeClassPicker());
    }

    // True when the ORIGIN step renders the list-left / description-right spread.
    _isOriginPickerStep() {
      return this._step === STEP.ORIGIN;
    }

    // Builds the right page for the origin step: the highlighted origin's
    // description plus a short "what you start with" dossier. The Back/Confirm
    // button panel always renders at the bottom of this page.
    _originStepDetailsHtml(stepData, activeIndex, buttonsHtml) {
      const choice = (stepData.choices && stepData.choices[activeIndex]) || {};
      const row = (label, value) =>
        `<div class="cc-dossier-row"><span class="cc-dossier-label">${label}</span><span class="cc-dossier-value">${value}</span></div>`;
      // Item row: icon + real item name on the left, quantity on the right,
      // sourced from $dataItems so it always matches what's actually granted.
      // The name goes through CCDbName: this page is DOM, so it never reaches
      // the draw-time translator that localizes database names elsewhere.
      const itemRow = (id, qty) => {
        const item = $dataItems[id];
        if (!item) return "";
        return `
          <div class="cc-dossier-row">
            <span class="cc-dossier-label" style="display:flex;align-items:center;gap:6px;">
              <span style="${this._ccIconStyle(item.iconIndex)}"></span>${window.CCDbName(item)}
            </span>
            <span class="cc-dossier-value">x${qty}</span>
          </div>
        `;
      };

      // Non-item context rows (where you land / extra effects), keyed by symbol.
      const contexts = {
        origin_train: [row(T('CharCreate.start'), T('CharCreate.trainPickADestination'))],
        origin_space: [row(T('CharCreate.start'), T('CharCreate.deepSpace'))],
        origin_camper: [row(T('CharCreate.start'), T('CharCreate.yourCamperParkedInACity'))],
        origin_car: [row(T('CharCreate.start'), T('CharCreate.yourCarParkedInACity'))],
        origin_bike: [row(T('CharCreate.start'), T('CharCreate.aRandomOverlandBiome'))],
        origin_lot: [row(T('CharCreate.start'), T('CharCreate.aRandomWorldMapTile'))],
        origin_dungeon: [row(T('CharCreate.start'), T('CharCreate.theTowerGate'))],
        origin_mayor: [row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice'))],
        origin_criminal: [
          row(T('CharCreate.start'), T('CharCreate.yourCamperParkedInACity')),
          row(T('CharCreate.bounty'), T('CharCreate.10000OnYourHead')),
        ],
        origin_stranded: [row(T('CharCreate.start'), T('CharCreate.aRandomRemoteWorldMapSpot'))],
        origin_bunker: [
          row(T('CharCreate.start'), T('CharCreate.aLootCellarUnderARandomBiome')),
          row(T('CharCreate.hoards'), T('CharCreate.goldPilesInCellar', { count: bunkerGoldPiles() })),
          row(T('CharCreate.wayBack'), T('CharCreate.aPermanentHatchOnTheSurface')),
        ],
        origin_ceo: [
          row(T('CharCreate.start'), T('CharCreate.lemoncorpHeadquarters')),
          row(T('CharCreate.assets'), T('CharCreate.80OfLemoncorpShares')),
        ],
        origin_artifact: [
          row(T('CharCreate.start'), T('CharCreate.trainPickADestination')),
          row(T('CharCreate.inheritance'), T('CharCreate.1AncientArtifactDrawnAtRandom')),
        ],
        origin_crash: [row(T('CharCreate.start'), T('CharCreate.aRandomPlanetInAnUnchartedGalaxy'))],
        origin_warlord: [
          row(T('CharCreate.start'), T('CharCreate.trainPickADestination')),
          row(T('CharCreate.troops'), T('CharCreate.40FromRandomFactions')),
          row(T('CharCreate.upkeep'), T('CharCreate.2WeeksOfTheirWagesInCash')),
        ],
        origin_faction_leader: [
          row(T('CharCreate.start'), T('CharCreate.trainPickADestination')),
          row(T('CharCreate.troops'), T('CharCreate.40FromTheFactionYouPick')),
          row(T('CharCreate.upkeep'), T('CharCreate.2WeeksOfTheirWagesInCash')),
        ],
        origin_deserter: [
          row(T('CharCreate.start'), T('CharCreate.trainPickADestination')),
          row(T('CharCreate.troops'), T('CharCreate.40FromTheFactionYouDeserted')),
        ],
      };

      // Cash first (an exact figure, never an adjective), then every item this
      // origin hands out, in the quantities the party will actually receive.
      const cashRow = row(
        T('CharCreate.cash'),
        T('CharCreate.cashAmount', {
          amount: plannedStartingEuros(choice.symbol).toLocaleString(
            T.language() === "it" ? "it-IT" : "en-US"),
        })
      );
      const itemsHtml = resolveOriginLoadout(choice.symbol).map((e) => itemRow(e.id, e.qty)).join("");

      const rows = (contexts[choice.symbol] || []).join("") + cashRow + itemsHtml;
      const dossierHtml = rows
        ? `<div class="cc-dossier-card"><h3 class="cc-subheader">${T('CharCreate.startingOut')}</h3>${rows}</div>`
        : "";

      return `
        <div class="cc-page cc-page-right" style="display: flex; flex-direction: column;">
          <h2 class="cc-header-gothic">${choice.name || ""}</h2>
          <p style="font-size: 0.92rem; line-height: 1.45; color: #3d2f26; font-style: italic; text-align: center; margin-bottom: 16px;">
            ${this.cleanText(choice.description || "")}
          </p>

          <div style="flex: 1; min-height: 0; overflow-y: auto;">
            ${dossierHtml}
          </div>
          ${buttonsHtml || ""}
        </div>
      `;
    }

    // Renders an IconSet glyph inline via CSS background-position (same
    // approach as TraitSelector.getIconStyle) so dossier item rows don't need
    // a canvas draw pass on every cursor move.
    _ccIconStyle(iconIndex, size = 32) {
      if (!iconIndex) return "";
      const col = iconIndex % 16;
      const row = Math.floor(iconIndex / 16);
      // The sheet is 16 icons wide at 32px each; scaling the whole sheet keeps
      // every cell square at any requested size.
      return `background-image: url('img/system/IconSet.png'); background-size: ${size * 16}px auto; background-position: -${col * size}px -${row * size}px; width: ${size}px; height: ${size}px; image-rendering: pixelated; display: inline-block; flex-shrink: 0;`;
    }

    // Builds the right page for the class step based on the highlighted choice:
    // an archetype shows its roster of classes, a class shows its full details.
    // The Back/Confirm button panel always renders at the bottom of this page.
    _classStepDetailsHtml(stepData, activeIndex, buttonsHtml) {
      const choice = (stepData.choices && stepData.choices[activeIndex]) || {};
      const symbol = choice.symbol || "";
      const buttons = buttonsHtml || "";

      if (symbol.indexOf("quick_class_") === 0) {
        return this._classDetailsPageHtml(choice.value, buttons);
      }
      if (symbol.indexOf("quick_arch_") === 0) {
        const g = getQuickArchetypes()[choice.value];
        if (g) return this._archetypeOverviewPageHtml(g, buttons);
      }

      // Random class / fallback: just the choice's own description.
      return `
        <div class="cc-page cc-page-right" style="display: flex; flex-direction: column;">
          <h2 class="cc-header-gothic">${choice.name || ""}</h2>
          <p style="font-size: 0.92rem; line-height: 1.45; color: #3d2f26; font-style: italic; text-align: center; margin-bottom: 16px;">
            ${this.cleanText(choice.description || "")}
          </p>
          ${buttons}
        </div>
      `;
    }

    // Right page while an archetype is highlighted: its blurb plus the list of
    // classes belonging to it.
    _archetypeOverviewPageHtml(g, buttonsHtml) {
      const rows = (g.classes || []).map((c) => `
          <div class="cc-dossier-row">
            <span class="cc-dossier-label">${window.CCDbName(c)}</span>
          </div>
        `).join("");

      return `
        <div class="cc-page cc-page-right" style="display: flex; flex-direction: column;">
          <h2 class="cc-header-gothic">${g.name}</h2>
          <p style="font-size: 0.92rem; line-height: 1.45; color: #3d2f26; font-style: italic; text-align: center; margin-bottom: 12px;">
            "${g.blurb}"
          </p>

          <div class="cc-dossier-card" style="flex: 1; min-height: 0; overflow-y: auto;">
            <h3 class="cc-subheader">${T('CharCreate.classesOfThisArchetype')}</h3>
            ${rows}
          </div>
          ${buttonsHtml || ""}
        </div>
      `;
    }

    // Right page while a class is highlighted: passive, element, base stats,
    // equipment proficiencies, starting skills and the level-up skill roadmap.
    _classDetailsPageHtml(classId, buttonsHtml) {
      const c = $dataClasses[classId];
      if (!c) return `<div class="cc-page cc-page-right"></div>`;

      // Localized flavor note, replaced by the signature passive when defined.
      let note = c.note || "";
      if (ConfigManager.language === "it") {
        const match = note.match(/<it:\s*([\s\S]*?)>/);
        note = match ? match[1].trim() : note.replace(/<[^>]+>/g, "").trim();
      } else {
        const match = note.match(/<en:\s*([\s\S]*?)>/);
        note = match ? match[1].trim() : note.replace(/<(it|en):\s*[\s\S]*?>/g, "").trim();
      }
      if (window.BattleSystemPassiveSkills) {
        const passiveDesc =
          window.BattleSystemPassiveSkills.getPassiveDescription(classId);
        if (passiveDesc) note = passiveDesc;
      }

      // Element affinity from the <elem:> notetag.
      let elementHtml = "";
      const elemMatch = (c.note || "").match(/<elem:\s*(\d+)>/);
      if (elemMatch) {
        const elementId = parseInt(elemMatch[1]);
        if (elementId > 0 && elementId < $dataSystem.elements.length) {
          // Same table the class selector draws from; the <elem:> tag holds
          // the engine's element id, and $dataSystem is the fallback.
          const elemKey = 'ClassSelect.element.' + elementId;
          const elementName = T.has(elemKey) ? T(elemKey) : $dataSystem.elements[elementId];
          elementHtml = `<div class="cc-element-badge">${elementName}</div>`;
        }
      }

      // Base (level 1) parameters.
      const hp = c.params[0][1];
      const mp = c.params[1][1];
      const str = c.params[2][1];
      const con = c.params[3][1];
      const mat = c.params[4][1];
      const mdf = c.params[5][1];
      const agi = c.params[6][1];
      const luk = c.params[7][1];

      // Equipment proficiencies: weapon types (trait 51) and armor types (52).
      const hasEquipTrait = (code, dataId) =>
        (c.traits || []).some((t) => t.code === code && t.dataId === dataId && t.value === 1);
      const weaponNames = {
        1: T('CharCreate.light'),
        2: T('CharCreate.sword'),
        3: T('CharCreate.heavy'),
        4: T('CharCreate.axe'),
        5: T('CharCreate.whip'),
        6: T('CharCreate.staff'),
        7: T('CharCreate.bow'),
        8: T('CharCreate.projectile'),
        9: T('CharCreate.gun'),
        10: T('CharCreate.claw'),
        11: T('CharCreate.glove'),
        12: T('CharCreate.spear')
      };
      const equipBadges = [];
      for (let wId = 1; wId <= 12; wId++) {
        if (hasEquipTrait(51, wId)) {
          equipBadges.push(`<span class="cc-element-badge" style="margin: 2px; font-size: 0.72rem;">${weaponNames[wId] || "Weapon"}</span>`);
        }
      }
      const armorTypes = $dataSystem.armorTypes || [];
      for (let aId = 1; aId < armorTypes.length; aId++) {
        if (armorTypes[aId] && hasEquipTrait(52, aId)) {
          equipBadges.push(`<span class="cc-element-badge" style="margin: 2px; font-size: 0.72rem;">${armorTypes[aId]}</span>`);
        }
      }

      // Starting (level 1) skills.
      const learnings = c.learnings || [];
      let lv1SkillsHtml = learnings
        .filter((l) => l.level === 1)
        .map((l) => {
          const sk = $dataSkills[l.skillId];
          return sk ? `<div class="cc-element-badge" style="margin: 2px;">${window.CCDbName(sk)}</div>` : "";
        }).join(" ");
      if (!lv1SkillsHtml) {
        lv1SkillsHtml = `<span style="font-size: 0.85rem; color: #5c4b3d; font-style: italic;">${T('CharCreate.noStartingSkills')}</span>`;
      }

      // Thematic class starting items (Items.json only), granted alongside the
      // weapon roll when this class is confirmed. See CharacterCreationEquipment.js.
      const classItems = typeof getClassStartingItems === "function" ? getClassStartingItems(classId) : [];
      const classItemsHtml = classItems
        .map((e) => {
          const it = $dataItems[e.id];
          if (!it) return "";
          return `
            <div class="cc-dossier-row">
              <span class="cc-dossier-label" style="display:flex;align-items:center;gap:6px;">
                <span style="${this._ccIconStyle(it.iconIndex)}"></span>${window.CCDbName(it)}
              </span>
              <span class="cc-dossier-value">x${e.qty}</span>
            </div>
          `;
        }).join("");
      const startingItemsCardHtml = classItemsHtml
        ? `
            <div class="cc-dossier-card" style="margin-bottom: 8px;">
              <h3 class="cc-subheader">${T('CharCreate.startingItems')}</h3>
              ${classItemsHtml}
            </div>
          `
        : "";

      // Level-up skill roadmap (everything unlocked past level 1).
      const roadmapRows = learnings
        .filter((l) => l.level > 1)
        .sort((a, b) => a.level - b.level)
        .map((l) => {
          const sk = $dataSkills[l.skillId];
          return sk ? `
            <div class="cc-dossier-row">
              <span class="cc-dossier-label">Lv. ${l.level}:</span>
              <span class="cc-dossier-value">${window.CCDbName(sk)}</span>
            </div>
          ` : "";
        }).join("");
      const roadmapHtml = roadmapRows
        ? `
            <div class="cc-dossier-card">
              <h3 class="cc-subheader">${T('CharCreate.skillRoadmap')}</h3>
              ${roadmapRows}
            </div>
          `
        : "";

      return `
        <div class="cc-page cc-page-right" style="display: flex; flex-direction: column;">
          <h2 class="cc-header-gothic">${window.CCDbName(c)}</h2>
          <p style="font-size: 0.92rem; line-height: 1.45; color: #3d2f26; font-style: italic; text-align: center; margin-bottom: 12px;">
            "${note}"
          </p>

          <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 12px;">
            ${elementHtml}
          </div>

          <div style="flex: 1; min-height: 0; overflow-y: auto;">
            <div class="cc-dossier-card" style="margin-bottom: 8px;">
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                <div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.hp')}</span><span class="cc-dossier-value">${hp}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.str')}</span><span class="cc-dossier-value">${str}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.dex')}</span><span class="cc-dossier-value">${agi}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.wis')}</span><span class="cc-dossier-value">${mdf}</span></div>
                </div>
                <div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.mp')}</span><span class="cc-dossier-value">${mp}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.con')}</span><span class="cc-dossier-value">${con}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.int')}</span><span class="cc-dossier-value">${mat}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.abbrev.psi')}</span><span class="cc-dossier-value">${luk}</span></div>
                </div>
              </div>
            </div>

            <div class="cc-dossier-card" style="margin-bottom: 8px;">
              <h3 class="cc-subheader">${T('CharCreate.equipmentProficiencies')}</h3>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${equipBadges.join("") || T('CharCreate.none')}
              </div>
            </div>

            <div class="cc-dossier-card" style="margin-bottom: 8px;">
              <h3 class="cc-subheader">${T('CharCreate.startingSkills')}</h3>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${lv1SkillsHtml}
              </div>
            </div>

            ${startingItemsCardHtml}
            ${roadmapHtml}
          </div>
          ${buttonsHtml || ""}
        </div>
      `;
    }

    onPresetCardClick(index) {
      if (this._presetWindow) {
        if (this._presetWindow.index() === index) {
          this.onPresetSelect();
        } else {
          this._presetWindow.select(index);
          this.refreshUIOverlayDOM();
        }
      }
    }

    onPresetCancelClick() {
      this.onPresetCancel();
    }

    // A thumbnail in the dossier's look picker was clicked.
    onPresetSkinClick(skinIndex) {
      if (this._presetWindow && this._presetWindow.selectSkin) {
        this._presetWindow.selectSkin(skinIndex);
      }
    }

    // The highlighted dossier changed look (thumbnail, shoulder button, Shift).
    // The cursor has not moved, so the overlay's own change check would skip
    // the redraw: force the full rebuild, since the board poster and the
    // dossier portrait both follow the look.
    onPresetSkinChange() {
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onOptionCardClick(index) {
      if (!this._gridWindow) return;
      const stepData = this.currentStepData();
      // Hometown dropdown: clicking the already-highlighted row confirms it, so
      // a long list is one click to highlight + one to pick (or just navigate).
      if (stepData && stepData.id === "hometown" && this._gridWindow.index() === index) {
        this.onOptionCardConfirm(index);
        return;
      }
      this._gridWindow.select(index);
      this.refreshUIOverlayDOM();
    }

    onOptionCardConfirm(index) {
        if (!this._gridWindow) return;
        const selectedIndex = (index !== undefined) ? index : this._gridWindow.index();
        this._gridWindow.select(selectedIndex);
        this._gridWindow.activate();
        this.onGridOk();
    }

    // --- Settings Step Helpers ---

    _buildSettingsRows() {
      const scene = this;
      if (ConfigManager.fogOfWar === undefined) ConfigManager.fogOfWar = true;
      if (ConfigManager.globalLighting === undefined) ConfigManager.globalLighting = true;
      if (ConfigManager.enemyBattlers === undefined) ConfigManager.enemyBattlers = 1;
      if (!ConfigManager.battleMusicName) ConfigManager.battleMusicName = "RandomMind/Battle";
      // ASCII mode is not offered here; it lives in the in-game options menu
      // (GameOptions.js), which owns its own defaults.
      if (ConfigManager.activeTheme === undefined) ConfigManager.activeTheme = 0;
      if (ConfigManager.cpuPartyMembers === undefined) ConfigManager.cpuPartyMembers = false;
      return [
        {
          key: 'language',
          label: T('CharCreate.language'),
          description: T('CharCreate.gameLanguageAnyMissingTranslationFallsBackTo'),
          get _langs() {
            const api = window.HendrixLocalization;
            return (api && api.getAvailableLanguages) ? api.getAvailableLanguages() : ['en'];
          },
          get currentIndex() {
            const i = this._langs.indexOf(ConfigManager.language);
            return i >= 0 ? i : 0;
          },
          get currentLabel() {
            const sym = this._langs[this.currentIndex] || 'en';
            const api = window.HendrixLocalization;
            if (api && api.getLanguageMenuLabel) return api.getLanguageMenuLabel(sym);
            return (api && api.getLanguageName) ? api.getLanguageName(sym) : sym.toUpperCase();
          },
          _changeBy(delta) {
            const langs = this._langs;
            if (!langs.length) return;
            const next = (this.currentIndex + delta + langs.length) % langs.length;
            const api = window.HendrixLocalization;
            if (api && api.setLanguage) api.setLanguage(langs[next]);
            else ConfigManager.language = langs[next];
            // Rebuild the rows so every label/description re-translates live.
            scene._settingsRows = scene._buildSettingsRows();
            scene._lastSettingsHash = null;
          },
          next() { this._changeBy(1); },
          prev() { this._changeBy(-1); },
        },
        {
          key: 'fogOfWar',
          label: T('CharCreate.fogOfWar'),
          description: T('CharCreate.revealsTheMapGraduallyAsYouExploreUnvisitedA'),
          imageOff: "Settings/FogOfWarOFF",
          imageOn:  "Settings/FogOfWarON",
          captionOff: T('CharCreate.theEntireMapIsFullyRevealedNoHiddenAreas'),
          captionOn: T('CharCreate.exploreTileByTileDarknessVeilsTheUnknown'),
          get currentIndex() { return ConfigManager.fogOfWar === false ? 1 : 0; },
          get currentLabel() { return this.currentIndex === 0 ? T('CharCreate.yes') : T('CharCreate.no'); },
          next() { ConfigManager.fogOfWar = ConfigManager.fogOfWar === false; },
          prev() { ConfigManager.fogOfWar = ConfigManager.fogOfWar === false; },
        },
        {
          key: 'cpuPartyMembers',
          label: T('CharCreate.cpuPartyMembers'),
          description: T('CharCreate.everyPartyMemberExceptTheLeaderActsAutomatic'),
          captionOff: T('CharCreate.youManuallyControlEveryPartyMemberSActions'),
          captionOn: T('CharCreate.onlyTheLeaderIsControlledByYouTheRestFightOn'),
          get currentIndex() { return ConfigManager.cpuPartyMembers ? 0 : 1; },
          get currentLabel() { return this.currentIndex === 0 ? T('CharCreate.yes') : T('CharCreate.no'); },
          next() { ConfigManager.cpuPartyMembers = !ConfigManager.cpuPartyMembers; },
          prev() { ConfigManager.cpuPartyMembers = !ConfigManager.cpuPartyMembers; },
        },
        {
          key: 'enemyBattlers',
          label: T('CharCreate.enemyBattlers'),
          description: T('CharCreate.howEnemiesAreShownInBattle2dTheClassicBattle'),
          captionOff: T('CharCreate.classic2dBattlerImages'),
          captionOn: T('CharCreate.3dRendersProceduralModelsSpritesUsesTheEnemy'),
          // 0 = 2D, 1 = 3D, 2 = Sprites
          _apply(index) {
            ConfigManager.enemyBattlers = index;
            ConfigManager.charBasedSprites = (index === 2); // legacy mirror
          },
          get currentIndex() {
            return ConfigManager.enemyBattlers !== undefined ? ConfigManager.enemyBattlers : 1;
          },
          get currentLabel() {
            const i = this.currentIndex;
            return i === 0 ? "2D" : i === 1 ? "3D" : T('CharCreate.sprites');
          },
          next() { this._apply((this.currentIndex + 1) % 3); },
          prev() { this._apply((this.currentIndex + 2) % 3); },
        },
        {
          key: 'globalLighting',
          label: T('CharCreate.globalLighting'),
          description: T('CharCreate.masterSwitchForTheDynamicLightingSystemStree'),
          captionOff: T('CharCreate.allDynamicLightsAreDisabledBestPerformance'),
          captionOn: T('CharCreate.streetlightsAndAmbientLightingReactToTheTime'),
          get currentIndex() { return ConfigManager.globalLighting === false ? 1 : 0; },
          get currentLabel() { return this.currentIndex === 0 ? "ON" : "OFF"; },
          next() { ConfigManager.globalLighting = ConfigManager.globalLighting === false; },
          prev() { ConfigManager.globalLighting = ConfigManager.globalLighting === false; },
        },
        {
          key: 'battleMusic',
          label: T('CharCreate.battleMusic'),
          description: T('CharCreate.musicTrackPlayedDuringCombatPressToPreviewTr'),
          get currentIndex() {
            const idx = getCCMusicTracks().findIndex(t => t.value === ConfigManager.battleMusicName);
            return idx >= 0 ? idx : 0;
          },
          get currentLabel() {
            const t = getCCMusicTracks()[this.currentIndex];
            return t ? t.name : T('CharCreate.musicTrack.Battle');
          },
          _changeBy(delta) {
            const tracks = getCCMusicTracks();
            const next = (this.currentIndex + delta + tracks.length) % tracks.length;
            ConfigManager.battleMusicName = tracks[next].value;
            const val = ConfigManager.battleMusicName;
            if (val && val !== "__none__" && val !== "__map__") {
              AudioManager.playBgm({ name: val, volume: 90, pitch: 100, pan: 0 });
            }
          },
          next() { this._changeBy(1); },
          prev() { this._changeBy(-1); },
        },
        {
          key: 'activeTheme',
          label: T('CharCreate.uiTheme'),
          description: T('CharCreate.visualThemeAppliedToMenusAndHudPressToSwitch'),
          get _themes() { return window.GameOptions ? window.GameOptions.getThemes() : ['archive_foundation.css']; },
          get _themeNames() {
            return this._themes.map(t => {
              const base = t.replace('.css', '');
              return base.split(/[_-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            });
          },
          get currentIndex() {
            const idx = ConfigManager.activeTheme !== undefined ? ConfigManager.activeTheme : 0;
            return Math.max(0, Math.min(idx, this._themes.length - 1));
          },
          get currentLabel() { return this._themeNames[this.currentIndex] || this._themeNames[0]; },
          _changeBy(delta) {
            const next = (this.currentIndex + delta + this._themes.length) % this._themes.length;
            ConfigManager.activeTheme = next;
            // Persist only; applying live bleeds the freshly loaded theme's
            // classes onto the current scene. Takes effect on restart.
            if (window.GameOptions) window.GameOptions.persistTheme(next);
          },
          next() { this._changeBy(1); },
          prev() { this._changeBy(-1); },
        },
      ];
    }

    _settingsStateHash() {
      if (!this._settingsRows) return '';
      return `${Scene_CharacterCreation._settingsRowIndex}:${this._settingsRows.map(r => r.currentIndex).join(',')}`;
    }

    _buildFogGridHTML(fogEnabled) {
      const size = 9, center = 4;
      let cells = '';
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const dist = Math.sqrt((r - center) ** 2 + (c - center) ** 2);
          const isPlayer = r === center && c === center;
          let cls, content = '';
          if (isPlayer) {
            cls = 'cc-fog-cell cc-fog-visible cc-fog-player'; content = '@';
          } else if (!fogEnabled) {
            cls = 'cc-fog-cell cc-fog-visible';
          } else if (dist <= 2.4) {
            cls = 'cc-fog-cell cc-fog-visible';
          } else if (dist <= 3.6) {
            cls = 'cc-fog-cell cc-fog-seen';
          } else {
            cls = 'cc-fog-cell cc-fog-dark';
          }
          cells += `<div class="${cls}">${content}</div>`;
        }
      }
      return `<div class="cc-fog-grid">${cells}</div>`;
    }

    _refreshSettingsDOM() {
      if (!this._dndContainer) return;
      const hash = this._settingsStateHash();
      if (this._lastSettingsHash === hash) return;
      this._lastSettingsHash = hash;

      const rows = this._settingsRows;
      const rowIdx = Scene_CharacterCreation._settingsRowIndex;
      const currentRow = rows[rowIdx];

      // Left page: option name as title, OFF image + caption, ON image + caption
      let previewHtml = '';
      if (currentRow.imageOff || currentRow.imageOn) {
        const offPath = currentRow.imageOff ? `img/pictures/${currentRow.imageOff}.png` : null;
        const onPath  = currentRow.imageOn  ? `img/pictures/${currentRow.imageOn}.png`  : null;
        previewHtml = `
          <div class="cc-settings-img-stack">
            ${offPath ? `
              <div class="cc-settings-img-entry">
                <img src="${offPath}" class="cc-settings-preview-img" alt="${T('CharCreate.previewOff')}">
                <p class="cc-settings-img-caption">${currentRow.captionOff || ''}</p>
              </div>` : ''}
            ${onPath ? `
              <div class="cc-settings-img-entry">
                <img src="${onPath}" class="cc-settings-preview-img" alt="${T('CharCreate.previewOn')}">
                <p class="cc-settings-img-caption">${currentRow.captionOn || ''}</p>
              </div>` : ''}
          </div>
        `;
      } else if (currentRow.key === 'battleMusic') {
        previewHtml = `
          <div style="text-align:center;font-size:3.5rem;margin:16px 0;">♪</div>
          <p class="cc-settings-hint">${T('CharCreate.toCycleTracksPreviewPlaysAutomatically')}</p>
        `;
      } else if (currentRow.key === 'activeTheme') {
        previewHtml = `
          <div style="text-align:center;font-size:3.5rem;margin:16px 0;">◈</div>
          <p style="text-align:center;font-size:1.1rem;font-weight:bold;margin:8px 0;">${currentRow.currentLabel}</p>
          <p class="cc-settings-hint">${T('CharCreate.toCycleThemesRequiresRestartToApply')}</p>
        `;
      } else if (currentRow.key === 'globalLighting') {
        const on = currentRow.currentIndex === 0;
        // Light (70) / Dark (71) IconSet glyphs, drawn at 64px.
        const lightIcon = on ? 70 : 71;
        previewHtml = `
          <div style="text-align:center;margin:16px 0;"><span style="display:inline-block;width:64px;height:64px;background-image:url('img/system/IconSet.png');background-size:1024px auto;background-position:-${(lightIcon % 16) * 64}px -${Math.floor(lightIcon / 16) * 64}px;image-rendering:pixelated;"></span></div>
          <p class="cc-settings-img-caption" style="text-align:center;">${on ? currentRow.captionOn : currentRow.captionOff}</p>
        `;
      }

      const leftHtml = `
        <div class="cc-page cc-page-left">
          <h2 class="cc-header-gothic">${T('CharCreate.settingsPreview')}</h2>
          <div class="cc-dossier-card" style="flex:1;display:flex;flex-direction:column;align-items:center;background:transparent;border:none;box-shadow:none;">
            <h3 class="cc-subheader" style="text-align:center;color:#ffcc66;">${currentRow.label}</h3>
            <p style="font-size:0.88rem;color:#d8cba8;margin-bottom:8px;text-align:center;">${currentRow.description}</p>
            ${previewHtml}
          </div>
          <p class="cc-settings-hint" style="margin-top:auto;padding-top:12px;">
            ${T('CharCreate.navigateChangeValueEnterConfirm')}
          </p>
        </div>
      `;

      // Right-page rows reuse the options-menu left-page structure: one
      // .option-row per setting with the ◀ value ▶ select control, so the list
      // reads exactly like Scene_Options' #options-list.
      const rowsHtml = rows.map((row, i) => {
        const isActive = i === rowIdx;
        const icon = pickSettingIcon(row.key);
        return `
          <div class="option-row ${isActive ? 'active' : ''}" data-idx="${i}"
               onclick="SceneManager._scene.onSettingsRowClick(${i})">
            <span class="option-label">
              <canvas class="opt-row-icon" width="20" height="20" data-icon="${icon}"></canvas>
              <span class="option-name">${row.label}</span>
            </span>
            <span class="option-status-toggle enabled option-select">
              <span class="arrow-btn" onclick="event.stopPropagation(); SceneManager._scene.onSettingsArrow(${i}, -1)">&#9664;</span>
              <span class="option-select-val">${row.currentLabel}</span>
              <span class="arrow-btn" onclick="event.stopPropagation(); SceneManager._scene.onSettingsArrow(${i}, 1)">&#9654;</span>
            </span>
          </div>
        `;
      }).join('');

      // Settings is now the first step on a first-time creation, so only show
      // the Back button when there is actually an earlier step to return to.
      // With no earlier step it becomes the way back to the title screen.
      const showSettingsBack = this._step > Scene_CharacterCreation.getStartingStep();
      const settingsBackBtn = showSettingsBack
        ? `<button class="cc-btn-treaty" onclick="SceneManager._scene.onCancel()">${T('CharCreate.back')}</button>`
        : (this.canExitToTitle()
          ? `<button class="cc-btn-treaty" onclick="SceneManager._scene.exitToTitle()">${T('CharCreate.returnToTitle')}</button>`
          : "");

      const rightHtml = `
        <div class="cc-page cc-page-right">
          <h2 class="cc-header-gothic">${T('CharCreate.initialSettings')}</h2>
          <div class="cc-settings-list">${rowsHtml}</div>
          <div class="cc-button-panel" style="margin-top:auto;padding-top:12px;">
            ${settingsBackBtn}
            <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onSettingsConfirm()">
              ${T('CharCreate.confirm')}
            </button>
          </div>
        </div>
      `;

      let spread = this._dndContainer.querySelector(".cc-pockets-spread");
      if (!spread) {
        this._dndContainer.innerHTML = `<div class="cc-pockets-spread"><div class="cc-page cc-page-left"></div><div class="cc-page cc-page-right"></div></div>`;
        spread = this._dndContainer.querySelector(".cc-pockets-spread");
      }
      spread.innerHTML = `${leftHtml}${rightHtml}`;
      this._drawSettingsIcons();
    }

    // Draw the IconSet glyph onto every settings-row canvas. Mirrors
    // Scene_Options.drawOptionIcons so the row icons match the options menu.
    _drawSettingsIcons() {
      if (!this._dndContainer) return;
      const canvases = this._dndContainer.querySelectorAll('canvas[data-icon]');
      if (!canvases.length) return;
      const bitmap = ImageManager.loadSystem('IconSet');
      const draw = () => {
        canvases.forEach(canvas => {
          const iconIndex = parseInt(canvas.dataset.icon, 10);
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const size = canvas.width;
          ctx.clearRect(0, 0, size, size);
          ctx.imageSmoothingEnabled = false;
          const sx = (iconIndex % 16) * 32;
          const sy = Math.floor(iconIndex / 16) * 32;
          ctx.drawImage(bitmap.canvas, sx, sy, 32, 32, 0, 0, size, size);
        });
      };
      if (bitmap.isReady()) draw();
      else bitmap.addLoadListener(draw);
    }

    _injectSettingsStyles() {
      // CSS lives in theme.css, nothing to inject at runtime
    }

    onSettingsConfirm() {
      SoundManager.playOk();
      // Any battle-music preview started from the settings is replaced here with
      // the creation theme so it does not bleed into later steps. Nothing is
      // stopped first: AudioManager.playBgm leaves an identical track playing
      // where it is, so leaving this page never restarts music that is already
      // the creation theme (a preceding stopBgm made every confirm restart it).
      AudioManager.playBgm({ name: CREATION_BGM, volume: 90, pitch: 100, pan: 0 });
      const stepData = CharacterCreationData[this._step];
      if (stepData && stepData.handler) {
        stepData.handler.call(this);
      }
    }

    onSettingsRowClick(index) {
      const rows = this._settingsRows;
      if (!rows) return;
      if (Scene_CharacterCreation._settingsRowIndex === index) {
        rows[index].next(); // Second click on same row: cycle value
      } else {
        Scene_CharacterCreation._settingsRowIndex = index;
      }
      SoundManager.playCursor();
      this._lastSettingsHash = null;
      this.refreshUIOverlayDOM();
    }

    // Clicking a row's ◀ / ▶ arrow focuses that row and steps its value, the
    // same as decreaseOption/increaseOption in the parchment options menu.
    onSettingsArrow(index, dir) {
      const rows = this._settingsRows;
      if (!rows || !rows[index]) return;
      Scene_CharacterCreation._settingsRowIndex = index;
      if (dir > 0) rows[index].next(); else rows[index].prev();
      SoundManager.playCursor();
      this._lastSettingsHash = null;
      this.refreshUIOverlayDOM();
    }

    start() {
      super.start();
    }

    createTitleWindow() {
      const rect = this.titleWindowRect();
      this._titleWindow = new Window_CharacterCreationTitle(rect);
      this.addWindow(this._titleWindow);
    }

    createGridWindow() {
      const rect = this.gridWindowRect();
      this._gridWindow = new Window_CharacterCreationGrid(rect);
      this._gridWindow.setScene(this);
      this._gridWindow.setHandler("ok", this.onGridOk.bind(this));
      // MODIFIED: Call onCancel instead of popScene
      this.addWindow(this._gridWindow);
    }

    titleWindowRect() {
      const width = Graphics.boxWidth;
      const height = this.calcWindowHeight(1, false);
      return new Rectangle(0, 0, width, height);
    }

    gridWindowRect() {
      const titleRect = this.titleWindowRect();
      const x = 0;
      const y = titleRect.y + titleRect.height;
      const width = Graphics.boxWidth;
      const height = Graphics.boxHeight - y;
      return new Rectangle(x, y, width, height);
    }

    setupStep() {
      if (this._step >= CharacterCreationData.length) {
        this.popScene();
        return;
      }

      // Skip purely static steps that carry no interactive UI: autoSkip steps,
      // and once-only steps already completed on a prior playthrough. This
      // mirrors nextStep() so that any manual `this._step++` landing on such a
      // step (e.g. a mode skip advancing onto worldHistory) advances cleanly
      // instead of rendering an empty step.
      {
        const sd = CharacterCreationData[this._step];
        if (sd.autoSkip ||
            (hasCompletedFirstCreation() && sd.showOnlyOnce && isStepCompleted(this._step))) {
          this._step++;
          this.setupStep();
          return;
        }
      }

      // ── Class step: clean up all learned character skills ──
      if (this._step === STEP.CLASS) {
        // Each genuine entry into the class step starts at the archetype list
        // (Quick-mode two-step picker); internal refreshes don't run setupStep.
        Scene_CharacterCreation._quickArchIndex = null;
        const currentActor = Scene_CharacterCreation.getCurrentActor();
        if (currentActor && currentActor._skills) {
          // Remove all learned skills (non-class skills)
          const learnedSkills = currentActor._skills.clone();
          learnedSkills.forEach(skillId => {
            currentActor.forgetSkill(skillId);
          });
        }
      }

      // Combat mode: step disabled for now (kept in code). Default to classic
      // RPG combat (switches 45/46 off) and skip without ever showing the
      // choice, for every creation mode. Remove this block to re-enable.
      if (this._step === STEP.COMBAT_MODE) {
        $gameSwitches.setValue(45, false);
        $gameSwitches.setValue(46, false);
        // Map Battle (BattleSystem/MapBattleMode.js) is a ConfigManager option,
        // not a save switch, so a copy of the game that has it on carries it
        // into a brand new party. The step's handler used to clear it; with the
        // step skipped, the FIRST creation of a playthrough clears it here so a
        // new game always starts on the classic battle scene. Later creations
        // (adding a party member) leave it alone: by then it is the player's own
        // Options > Gameplay choice.
        if (!hasCompletedFirstCreation()) {
          ConfigManager.mapBattleMode = false;
          ConfigManager.save();
        }
        markStepCompleted(STEP.COMBAT_MODE);
        this._step++;
        this.setupStep();
        return;
      }

      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isTutorial = Scene_CharacterCreation._tutorialMode;

      // ── TUTORIAL MODE: auto-skip steps and silently apply defaults ──
      if (isTutorial) {
        // Settings: skipped silently (kept at defaults) and marked complete.
        if (this._step === STEP.SETTINGS) {
          markStepCompleted(STEP.SETTINGS);
          this._step++;
          this.setupStep();
          return;
        }

        // Difficulty: always apply roguelite silently.
        if (this._step === STEP.DIFFICULTY) {
          $gameSwitches.setValue(9, false);
          $gameSystem._bloodAndOilMode = false;
          $gameSwitches.setValue(33, true);
          markStepCompleted(STEP.DIFFICULTY);
          this._step++;
          this.setupStep();
          return;
        }

        // Combat mode: tutorial always uses classic RPG combat (switches off).
        if (this._step === STEP.COMBAT_MODE) {
          $gameSwitches.setValue(45, false);
          $gameSwitches.setValue(46, false);
          markStepCompleted(STEP.COMBAT_MODE);
          this._step++;
          this.setupStep();
          return;
        }

        // Class: fixed to Mana Cyborg (class 66) in tutorial - apply and skip.
        if (this._step === STEP.CLASS) {
          if (!Scene_CharacterCreation._isCreatureMode) {
            const currentActor = Scene_CharacterCreation.getCurrentActor();
            if (currentActor) {
              currentActor.changeClass(66, false);
              if (typeof equipRandomCompatibleWeapon === 'function') {
                equipRandomCompatibleWeapon(currentActor, 66);
              }
              if (typeof giveClassStartingItems === "function") {
                giveClassStartingItems(currentActor, 66);
              }
            }
          }
          this._step++;
          this.setupStep();
          return;
        }

        // Traits: skip entirely, no traits applied.
        if (this._step === STEP.TRAITS) {
          this._step++;
          this.setupStep();
          return;
        }

        // Add Party Member: end creation immediately (only 1 character in
        // tutorial). The settings step already ran first, so the tutorial flow
        // finishes here. No origin and no travel picker: the tutorial starts
        // where it is being played, on the Icebush map, and the player is meant
        // to walk around it rather than be put straight on a train out.
        if (this._step === STEP.ADD_MEMBER) {
          markFirstCreationComplete();
          Scene_CharacterCreation._tutorialMode = false;
          if (this._dndContainer) {
            this._dndContainer.style.display = "none";
          }
          this.popScene();
          return;
        }
      }
      // ── END TUTORIAL MODE skips ──

      // Creation mode: never asked during the tutorial. Quick is applied
      // silently and the wizard moves straight on to the humanoid / creature
      // choice. (Guarded on the switch as well as the in-scene flag, like the
      // origin step below.) Detailed mode is the exception, the tutorial offers
      // it, so the step is shown whenever CharacterCreationFull is loaded.
      if (this._step === STEP.CREATION_MODE && isTutorialFlow() && !detailedModeAvailable()) {
        Scene_CharacterCreation._creationMode = "quick";
        $gameSystem._ccCreationMode = "quick";
        markStepCompleted(STEP.CREATION_MODE);
        this._step++;
        this.setupStep();
        return;
      }

      // Origin: not available while the tutorial switch (100) is active. The
      // tutorial has its own starting point, so creation just ends here and the
      // player stays where they are. (The in-scene _tutorialMode flag is
      // cleared at the add-member step, so guard on the switch directly.)
      if (this._step === STEP.ORIGIN && $gameSwitches.value(100)) {
        markStepCompleted(STEP.ORIGIN);
        // End-of-creation finalize (settings no longer does it). Idempotent.
        markFirstCreationComplete();
        this.popScene();
        return;
      }

      // Safety: creatures never go through class selection (both Quick and Full
      // mode build the creature in the full creature scene, then resume here).
      if (this._step === STEP.CLASS && Scene_CharacterCreation._isCreatureMode) {
        this._step++;
        this.setupStep();
        return;
      }

      // Portrait style is only asked of humanoids, and only when the 3D editor
      // is actually available. Everyone who skips it keeps the bust portrait.
      if (this._step === STEP.PORTRAIT &&
          (Scene_CharacterCreation._isCreatureMode ||
           Scene_CharacterCreation._tutorialMode ||
           !portraitModelAvailable())) {
        if (!Scene_CharacterCreation._isCreatureMode) {
          const portraitActor = Scene_CharacterCreation.getCurrentActor();
          if (portraitActor && portraitActor.setPortraitMode) portraitActor.setPortraitMode("bust");
        }
        this._step++;
        this.setupStep();
        return;
      }

      // Auto-randomize traits for characters 2 and 3 (both Quick and Full mode
      // ask the first member interactively; see the "traits" step above).
      if (this._step === STEP.TRAITS && currentMemberIndex >= 1) {
        const targetActorId = currentMemberIndex + 1; // Actor IDs are 1-based

        // Call randomizeTraits from TraitSelector
        if (window.randomizeTraitsForActor) {
          window.randomizeTraitsForActor(targetActorId);
        } else {
          console.warn("TraitSelector randomizeTraitsForActor not available for auto-randomization");
        }

        // Skip to next step (Add Party Member prompt)
        this._step++;
        this.setupStep();
        return;
      }

      // Quick mode: skip the Full-only flavor steps (hometown / birth date).
      if ((this._step === STEP.HOMETOWN || this._step === STEP.BIRTHDATE) &&
          Scene_CharacterCreation.isQuickMode()) {
        this._step++;
        this.setupStep();
        return;
      }

      // Skip "Add another party member?" step if party is already full (3 members)
      if (this._step === STEP.ADD_MEMBER && $gameParty.size() >= 3) {
        // Party is full, skip the add-member prompt and continue to the origin.
        this._step++;
        this.setupStep();
        return;
      }

      // ── Initial Settings: initialize settings state ──
      if (this._step === STEP.SETTINGS) {
        this._settingsRows = this._buildSettingsRows();
        Scene_CharacterCreation._settingsRowIndex = 0;
        this._injectSettingsStyles();
        if (this._gridWindow) this._gridWindow.deactivate();
        this._lastSettingsHash = null; // force DOM refresh
        this.refreshUIOverlayDOM();
        return;
      }

      const stepData = this.currentStepData();
      this._titleWindow.setTitle(stepData.title);
      this._gridWindow.setChoices(stepData.choices);

      // The settings step deactivates the grid window (it has its own input
      // handler). Re-activate it on every interactive step so keyboard Back/OK
      // keep working afterwards (updateUIInput bails when the window is inactive),
      // otherwise cancel from later steps such as "add party member?" is a no-op (#102).
      this._gridWindow.activate();

      // NEW: Conditionally set cancel handler based on current step
      const firstStep = Scene_CharacterCreation.getStartingStep();
      if (this._step <= firstStep) {
        // Completely disable cancel handler on first step
        this._gridWindow.setHandler("cancel", null);
      } else {
        // Enable cancel handler for subsequent steps
        this._gridWindow.setHandler("cancel", this.onCancel.bind(this));
      }
    }

    currentStepData() {
      return CharacterCreationData[this._step];
    }

    nextStep() {
      this._step++;
      // autoSkip steps are always skipped; showOnlyOnce steps only once the
      // first creation is already complete.
      while (this._step < CharacterCreationData.length) {
        const stepData = CharacterCreationData[this._step];
        if (stepData.autoSkip ||
            (hasCompletedFirstCreation() && stepData.showOnlyOnce && isStepCompleted(this._step))) {
          this._step++;
        } else {
          break;
        }
      }
      this.setupStep();
    }

    // NEW: Handles going to the previous step.
    previousStep() {
      // Returning from a "Randomize all party" jump: the whole party was filled
      // and the wizard leapt straight to the origin step. Back should undo that,
      // trim the auto-added members back to the first one, and return to the
      // character-type selection.
      if (this._step === STEP.ORIGIN && Scene_CharacterCreation._randomizedAllParty) {
        Scene_CharacterCreation._randomizedAllParty = false;
        $gameParty.members().slice().forEach((a) => {
          if (a.actorId() !== 1) $gameParty.removeActor(a.actorId());
        });
        Scene_CharacterCreation._currentPartyMemberIndex = 0;
        Scene_CharacterCreation._isCreatureMode = false;
        Scene_CharacterCreation._lastMemberWasRandom = false;
        this._step = STEP.CHARACTER_TYPE;
        this.setupStep();
        return;
      }

      // If we're in creature mode and at the gender step, go back to character
      // type selection and exit creature mode.
      if (Scene_CharacterCreation._isCreatureMode && this._step === STEP.GENDER) {
        this._step = STEP.CHARACTER_TYPE;
        Scene_CharacterCreation._isCreatureMode = false; // Exit creature mode
        this.setupStep();
        return;
      }

      // If we're in creature mode and at the traits step, go back to gender,
      // skipping the (creature-only) creation method and class steps.
      if (Scene_CharacterCreation._isCreatureMode && this._step === STEP.TRAITS) {
        this._step = STEP.GENDER;
        this.setupStep();
        return;
      }

      // Walk back to the previous interactive step, skipping every step that
      // setupStep() would immediately auto-advance past (otherwise Back lands
      // on a step that jumps forward again, making it a no-op). Never go below
      // the first interactive step.
      const firstStep = Scene_CharacterCreation.getStartingStep();
      this._step--;
      while (this._step > firstStep && Scene_CharacterCreation._stepAutoAdvances(this._step)) {
        this._step--;
      }
      if (this._step < firstStep) this._step = firstStep;
      this.setupStep();
    }
    onGridOk() {
      const stepData = this.currentStepData();
      const index = this._gridWindow.index();
      const choice = stepData.choices[index];
      if (!choice) {
        return; 
    }
      if (stepData.handler) {
        stepData.handler.call(this, choice.symbol, index);
      }
    }

    // Re-render the current step's choices in place (same step, new option
    // set). Used by the Quick-mode two-step class picker when toggling between
    // the archetype list and an archetype's class list.
    refreshCurrentStepChoices() {
      const stepData = this.currentStepData();
      if (this._titleWindow) this._titleWindow.setTitle(stepData.title);
      if (this._gridWindow) this._gridWindow.setChoices(stepData.choices);
      // Force a full card rebuild even though the step number is unchanged.
      this._lastStep = -1;
      this.refreshUIOverlayDOM();
    }

    // True while the wizard is the first thing a brand-new game shows: nothing
    // has been committed yet, so the only sensible Back from its first step is
    // the title screen. Creations entered from a running game (a second party
    // member, a reprise from the creature builder) must never offer it.
    canExitToTitle() {
      if (typeof hasCompletedFirstCreation !== "function") return false;
      return !hasCompletedFirstCreation();
    }

    // Abandon a new game from the first step and go back to the title. Nothing
    // has been saved yet, so the half-built party is simply dropped; New Game
    // builds a fresh set of game objects. The static flow state outlives the
    // scene, so it is reset here or the next New Game would resume this
    // abandoned wizard mid-step.
    exitToTitle() {
      SoundManager.playCancel();
      Scene_CharacterCreation._interruptedStep = -1;
      Scene_CharacterCreation._startStep = 0;
      Scene_CharacterCreation._isCreatureMode = false;
      Scene_CharacterCreation._traitsProcessed = false;
      Scene_CharacterCreation._currentPartyMemberIndex = 0;
      Scene_CharacterCreation._lastMemberWasRandom = false;
      Scene_CharacterCreation._tutorialMode = false;
      Scene_CharacterCreation._settingsRowIndex = 0;
      Scene_CharacterCreation._creationMode = null;
      Scene_CharacterCreation._randomizedAllParty = false;
      Scene_CharacterCreation._quickArchIndex = null;
      this.hideUI();
      this.fadeOutAll();
      SceneManager.goto(Scene_Title);
    }

    onCancel() {
      // First step of a new game's creation: Back leaves for the title screen
      // rather than doing nothing (the wizard opens straight after New Game,
      // so there is no other way out of it).
      if (this._step <= Scene_CharacterCreation.getStartingStep() && this.canExitToTitle()) {
        this.exitToTitle();
        return;
      }
      // Class step: Back unwinds the picker one level at a time. (Quick mode)
      // from an open archetype's class list back to the archetype list.
      if (this._step === STEP.CLASS && !Scene_CharacterCreation._isCreatureMode) {
        if (Scene_CharacterCreation.isQuickMode() &&
            Scene_CharacterCreation._quickArchIndex != null) {
          Scene_CharacterCreation._quickArchIndex = null;
          SoundManager.playCancel();
          this.refreshCurrentStepChoices();
          return;
        }
      }
      SoundManager.playCancel();
      this.previousStep();
    }
    // MODIFIED: Destroys windows before running the common event.
    startWaitingForCommonEvent(commonEventId, showVeil) {
      // Save the current step before interrupting
      Scene_CharacterCreation._interruptedStep = this._step;

      // Cover the brief map flash while the reserved CE pushes the next scene.
      if (showVeil && window.CCTransitionVeil) {
        window.CCTransitionVeil.show();
      }

      // Hide/close UI first to avoid overlap or input issues
      this.hideUI();
      if (this._titleWindow) {
        this._titleWindow.deactivate();
        this._titleWindow.close();
      }
      if (this._gridWindow) {
        this._gridWindow.deactivate();
        this._gridWindow.close();
      }

      // Reserve CE for Scene_Map so event commands run safely on the map interpreter
      if ($dataCommonEvents[commonEventId]) {
        $gameTemp.reserveCommonEvent(commonEventId);
      }

      // Return to the map; the reserved CE will start as soon as the map interpreter is free
      SceneManager.pop();
    }

    // NEW: Creates a completely random character and skips to Add Party Member step
    createTotalRandomCharacter() {
      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;

      if (!this._randomizeMemberCharacter(currentMemberIndex)) {
        this.nextStep();
        return;
      }

      // Remember that this member was rolled randomly so the add-member step can
      // offer a "Reroll character" option.
      Scene_CharacterCreation._lastMemberWasRandom = true;

      // A random character has everything decided already, so skip the trait
      // and flavor steps and land directly on the Add Party Member prompt.
      this._step = STEP.ADD_MEMBER;
      this.setupStep();
    }

    // Randomize every party slot at once, then jump straight to the origin step
    // instead of asking to add more members. (Settings/difficulty already ran at
    // the start of the flow.)
    createTotalRandomPartyAll() {
      const MAX_PARTY = 3;

      for (let i = 0; i < MAX_PARTY; i++) {
        const actorId = i + 1; // Actor IDs are 1-based
        // Make sure the slot exists in the party before randomizing it.
        if (!$gameParty.members().some((a) => a.actorId() === actorId)) {
          $gameParty.addActor(actorId);
        }
        Scene_CharacterCreation._isCreatureMode = false;
        this._randomizeMemberCharacter(i);
      }

      // Reset back to the first member for any downstream references.
      Scene_CharacterCreation._currentPartyMemberIndex = 0;
      Scene_CharacterCreation._isCreatureMode = false;
      // Remember this jump so Back from origin can return to character-type
      // selection instead of stepping through skipped per-member steps.
      Scene_CharacterCreation._randomizedAllParty = true;

      // Jump to the origin step (nextStep increments ADD_MEMBER -> ORIGIN). The
      // origin handler finalizes creation.
      this._step = STEP.ADD_MEMBER;
      this.nextStep();
    }

    // Randomizes a single party member (name, class/creature, gender,
    // reproduction, traits, sprite and bust). Returns false if the actor is
    // missing. Does NOT advance the wizard step.
    _randomizeMemberCharacter(currentMemberIndex) {
      Scene_CharacterCreation._currentPartyMemberIndex = currentMemberIndex;
      const currentActor = Scene_CharacterCreation.getCurrentActor();

      if (!currentActor) {
        console.error("No actor available for randomization!");
        return false;
      }

      // Generate random name using Markov chain from "names" database
      let randomName = "Random";
      if (window.generateSeededMarkovName) {
        // Use current timestamp and actor index as seed for variety
        const seed = Date.now() + currentMemberIndex * 1000;
        randomName = window.generateSeededMarkovName(
          Math.floor(seed / 1000),  // worldX equivalent
          Math.floor(seed % 1000),  // worldY equivalent
          currentMemberIndex + 1,   // eventId equivalent (use actor index)
          "names",                  // database ID
          2,                        // chain order
          4,                        // min characters
          12                        // max characters
        );
      } else if (window.TextGen) {
        // Fallback: pick a random name from the names database
        const namesDB = window.TextGen.names;
        if (namesDB && namesDB.en) {
          const namesList = namesDB.en.trim().split(/\s+/);
          if (namesList.length > 0) {
            randomName = namesList[Math.floor(Math.random() * namesList.length)];
          }
        }
      }

      // Set the actor's name
      currentActor.setName(randomName);

      // Get the correct creature switch based on current party member (77, 78, or 79)
      const creatureSwitchId = 77 + currentMemberIndex; // 77 for actor 1, 78 for actor 2, 79 for actor 3

      // Randomly decide: regular character (80%) or creature (20%)
      const isCreature = Math.random() < 0.2;

      if (isCreature) {
        // Set up as creature
        $gameSwitches.setValue(creatureSwitchId, true);
        Scene_CharacterCreation._isCreatureMode = true;
        currentActor.changeClass(65, false);
      } else {
        // Set up as regular character
        $gameSwitches.setValue(creatureSwitchId, false);
        Scene_CharacterCreation._isCreatureMode = false;

        // Random class selection
        const validClasses = $dataClasses.filter((c) => c && c.id !== 65); // Exclude creature class
        if (validClasses.length > 0) {
          const randomClass = validClasses[Math.floor(Math.random() * validClasses.length)];
          currentActor.changeClass(randomClass.id, true);

          // Equip random weapon for the class
          if (typeof equipRandomCompatibleWeapon === "function") {
            equipRandomCompatibleWeapon(currentActor, randomClass.id);
          }
          if (typeof giveClassStartingItems === "function") {
            giveClassStartingItems(currentActor, randomClass.id);
          }
        }
      }

      // Random gender (0-3: Male, Female, Non-binary, Cocoon)
      const randomGender = Math.floor(Math.random() * 4);

      // Determine which variables to use based on party member index
      let genderVar, reproductiveVar;
      switch (currentMemberIndex) {
        case 0:
          genderVar = VAR_PLAYER1_GENDER;
          reproductiveVar = VAR_PLAYER1_REPRODUCTIVE_TYPE;
          break;
        case 1:
          genderVar = VAR_PLAYER2_GENDER;
          reproductiveVar = VAR_PLAYER2_REPRODUCTIVE_TYPE;
          break;
        case 2:
          genderVar = VAR_PLAYER3_GENDER;
          reproductiveVar = VAR_PLAYER3_REPRODUCTIVE_TYPE;
          break;
        default:
          genderVar = VAR_PLAYER1_GENDER;
          reproductiveVar = VAR_PLAYER1_REPRODUCTIVE_TYPE;
      }

      // Set gender variable
      $gameVariables.setValue(genderVar, randomGender);

      // Set reproduction type based on gender
      switch (randomGender) {
        case 0: // Male
          $gameVariables.setValue(reproductiveVar, 0); // Testicles
          break;
        case 1: // Female
          $gameVariables.setValue(reproductiveVar, 1); // Uterus
          break;
        case 2: // Non-binary
          $gameVariables.setValue(reproductiveVar, Math.floor(Math.random() * 5)); // Random (0-4)
          break;
        case 3: // Cocoon
          $gameVariables.setValue(reproductiveVar, 4); // Mitosis
          break;
      }

      // Random traits
      const targetActorId = currentMemberIndex + 1; // Actor IDs are 1-based
      // Randomized humanoids are portrayed by the bust picked just below; they
      // never get a sculpted 3D model, so pin the exclusive portrait style.
      const randomActor = $gameActors.actor(targetActorId);
      if (randomActor && randomActor.setPortraitMode) randomActor.setPortraitMode("bust");
      if (window.randomizeTraitsForActor) {
        window.randomizeTraitsForActor(targetActorId);
      } else {
        console.warn("TraitSelector randomizeTraitsForActor not available for total randomization");
      }

      // Random sprite selection
      let selectedSprite = null;
      if (window.selectRandomSpriteForActor) {
        selectedSprite = window.selectRandomSpriteForActor(targetActorId);
        if (selectedSprite) {
          console.log(`Total Random: Selected sprite ${selectedSprite.name} (${selectedSprite.index}) for actor ${targetActorId}`);
        } else {
          console.warn("Total Random: no sprite options available for actor " + targetActorId);
        }
      } else {
        console.warn("selectRandomSpriteForActor not available for total randomization");
      }

      // Set bust based on SpritesAssociation for the selected sprite
      if (selectedSprite && window.Sprites && window.Sprites.SpritesAssociation) {
        const SpritesAssociation = window.Sprites.SpritesAssociation;
        const spriteName = selectedSprite.name;
        const spriteIndex = selectedSprite.index;

        // Check if this sprite has an associated bust
        if (SpritesAssociation[spriteName] && SpritesAssociation[spriteName][spriteIndex]) {
          const associatedBust = SpritesAssociation[spriteName][spriteIndex];

          // The bust is a bust for every member: it belongs in the actor's own
          // bust field, not the monster-battler one.
          if (randomActor) {
            randomActor.setVnBust(associatedBust);
            console.log(`Total Random: Set bust ${associatedBust} for actor ${targetActorId}`);
          }
        } else {
          // No association found, fall back to random bust selection
          console.log(`Total Random: No SpritesAssociation found for ${spriteName}[${spriteIndex}], selecting random bust`);
          if (window.selectRandomBustForActor) {
            const selectedBust = window.selectRandomBustForActor(targetActorId);
            console.log(`Total Random: Selected random bust ${selectedBust} for actor ${targetActorId}`);
          }
        }
      } else {
        // SpritesAssociation not available, fall back to random bust selection
        console.log(`Total Random: SpritesAssociation not available, selecting random bust`);
        if (window.selectRandomBustForActor) {
          const selectedBust = window.selectRandomBustForActor(targetActorId);
          console.log(`Total Random: Selected random bust ${selectedBust} for actor ${targetActorId}`);
        }
      }

      return true;
    }

    updateSettingsInput() {
      const rows = this._settingsRows;
      if (!rows || rows.length === 0) return;
      const idx = Scene_CharacterCreation._settingsRowIndex;

      if (Input.isTriggered('down') || Input.isRepeated('down')) {
        Scene_CharacterCreation._settingsRowIndex = (idx + 1) % rows.length;
        SoundManager.playCursor();
        this._lastSettingsHash = null;
        this.refreshUIOverlayDOM();
      } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
        Scene_CharacterCreation._settingsRowIndex = (idx - 1 + rows.length) % rows.length;
        SoundManager.playCursor();
        this._lastSettingsHash = null;
        this.refreshUIOverlayDOM();
      } else if (Input.isTriggered('right') || Input.isRepeated('right')) {
        rows[idx].next();
        SoundManager.playCursor();
        this._lastSettingsHash = null;
        this.refreshUIOverlayDOM();
      } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
        rows[idx].prev();
        SoundManager.playCursor();
        this._lastSettingsHash = null;
        this.refreshUIOverlayDOM();
      } else if (Input.isTriggered('ok')) {
        this.onSettingsConfirm();
      } else if (Input.isTriggered('cancel')) {
        SoundManager.playCancel();
        this.onCancel();
      }
    }

    updateUIInput() {
      // Settings step: use dedicated input handler instead of grid navigation
      const _sd = this._step < CharacterCreationData.length ? CharacterCreationData[this._step] : null;
      if (_sd && _sd.isSettingsStep) {
        this.updateSettingsInput();
        return;
      }

      const isPreset = !!this._presetWindow;
      const windowObj = isPreset ? this._presetWindow : this._gridWindow;
      if (!windowObj || !windowObj.active) return;

      const maxItems = windowObj.maxItems();
      if (maxItems <= 0) {
        // Nothing to move between, but Back must still work: an empty preset
        // board would otherwise trap the player with no way out.
        if (Input.isTriggered('cancel') && isPreset) {
          SoundManager.playCancel();
          this.onPresetCancel();
        }
        return;
      }

      // Dossiers that were drawn more than once can be leafed through into
      // their other looks without leaving the card. The shoulder buttons do it
      // both ways; Shift steps forward, being the one spare keyboard key here
      // (W is remapped to "up" game-wide).
      if (isPreset && windowObj.cycleSkin) {
        if (Input.isTriggered('pagedown') || Input.isTriggered('shift')) {
          windowObj.cycleSkin(1);
          return;
        }
        if (Input.isTriggered('pageup')) {
          windowObj.cycleSkin(-1);
          return;
        }
      }

      let moved = false;
      let index = windowObj.index();

      if (Input.isTriggered('down') || Input.isRepeated('down')) {
        const cols = windowObj.maxCols();
        if (index + cols < maxItems) {
          index += cols;
        } else {
          index = index % cols;
        }
        moved = true;
      } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
        const cols = windowObj.maxCols();
        if (index - cols >= 0) {
          index -= cols;
        } else {
          let target = Math.floor((maxItems - 1) / cols) * cols + (index % cols);
          if (target >= maxItems) target -= cols;
          index = target >= 0 ? target : 0;
        }
        moved = true;
      } else if (Input.isTriggered('right') || Input.isRepeated('right')) {
        const cols = windowObj.maxCols();
        if (cols > 1 && index % cols < cols - 1 && index + 1 < maxItems) {
          index += 1;
          moved = true;
        }
      } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
        const cols = windowObj.maxCols();
        if (cols > 1 && index % cols > 0) {
          index -= 1;
          moved = true;
        }
      } else if (Input.isTriggered('ok')) {
        SoundManager.playOk();
        if (isPreset) {
          this.onPresetSelect();
        } else {
          this.onGridOk();
        }
      } else if (Input.isTriggered('cancel')) {
        const firstStep = Scene_CharacterCreation.getStartingStep();
        if (isPreset) {
          SoundManager.playCancel();
          this.onPresetCancel();
        } else if (this._step > firstStep) {
          SoundManager.playCancel();
          this.onCancel();
        } else if (this.canExitToTitle()) {
          // First step of a new game: Cancel leaves for the title screen.
          this.exitToTitle();
        }
      }

      if (moved) {
        SoundManager.playCursor();
        windowObj.select(index);
        this.refreshUIOverlayDOM();
      }
    }

    // MODIFIED: Recreates windows after common event completion.
    update() {
      super.update();

      if (this._waitingForCommonEvent) {
        if (this._interpreter) this._interpreter.update();

        // When the CE completes, resume the flow
        if (!this._interpreter || !this._interpreter.isRunning()) {
          this._interpreter = null;
          this._waitingForCommonEvent = false;

          // Advance to the step after the CE (you were doing this already)
          this._step++;
          this.showUI();
          this.setupStep();
          if (this._dndContainer) {
            this._dndContainer.style.display = "flex";
            this.refreshUIOverlayDOM();
          }
        }
      }

      if (this._dndContainer) {
        if (this._waitingForCommonEvent) {
          this._dndContainer.style.display = "none";
        } else {
          this._dndContainer.style.display = "flex";
          this.updateUIInput();
          if (window.CCScroll) window.CCScroll.update(this._dndContainer);
          this.refreshUIOverlayDOM();
        }
      }
    }
  }

  // --- Window_CharacterCreationTitle ---
  class Window_CharacterCreationTitle extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this._title = "";
    }
    setTitle(title) {
      if (this._title !== title) {
        this._title = title;
        this.refresh();
      }
    }
    refresh() {
      this.contents.clear();
      this.drawText(this._title, 0, 0, this.contents.width, "center");
    }
  }

  // --- Window_CharacterCreationGrid (FIXED) ---
  // Replace the existing Window_CharacterCreationGrid class with this updated version
  class Window_CharacterCreationGrid extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._choices = [];
      this._scene = null;
    }

    setScene(scene) {
      this._scene = scene;
      this.refresh();
    }

    // Add after the select() method in Window_CharacterCreationGrid
    select(index) {
      const lastIndex = this.index();
      super.select(index);

      // Play music preview when hovering over battle music choices
      if (
        this.index() !== lastIndex &&
        this._choices &&
        this._choices.length > 0
      ) {
      }
    }
    processTouch() {
      // All mouse interaction is handled via DOM onclick, block RMMZ's
      // TouchInput path so it can't fire processOk/deactivate under DOM buttons.
    }

    setChoices(choices) {
      this._choices = choices || [];
      this._choices.forEach((choice) => {
        if (choice.bgImage) {
          const bitmap = ImageManager.loadPicture(choice.bgImage);
          bitmap.addLoadListener(() => this.refresh());
        }
      });
      this.refresh();
      this.select(0);
      this.activate();
    }

    maxItems() {
      return this._choices ? this._choices.length : 0;
    }

    maxCols() {
      // Quick-mode class/archetype/creature picker renders as a two-column grid,
      // so the selection cursor must move in two columns too (left/right + up/down).
      const sc = this._scene;
      if (sc && sc._step === STEP.CLASS &&
          (Scene_CharacterCreation.isQuickMode() ||
            Scene_CharacterCreation.usesArchetypeClassPicker())) {
        return 2;
      }
      return 1;
    }

    itemHeight() {
      const numRows = Math.ceil(this.maxItems() / this.maxCols());
      if (numRows === 0) {
        return this.innerHeight;
      }
      return Math.floor(this.innerHeight / numRows);
    }

    // NEW: Helper method to wrap text without breaking words
    wrapText(text, maxWidth) {
      if (!text) return [];

      // Handle color codes and other escape sequences
      const words = text.split(" ");
      const lines = [];
      let currentLine = "";

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine + (currentLine ? " " : "") + word;

        // Measure the text width (accounting for escape sequences)
        const testWidth = this.textSizeEx(testLine).width;

        if (testWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          if (currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            // Single word is too long, force it on its own line
            lines.push(word);
          }
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    }

    // NEW: Calculate text size including escape sequences
    textSizeEx(text) {
      const tempTextState = this.createTextState(text, 0, 0, 0);
      tempTextState.drawing = false; // Don't actually draw
      this.processAllText(tempTextState);
      return {
        width: tempTextState.outputWidth,
        height: tempTextState.outputHeight,
      };
    }

    // UPDATED: Improved drawItem method with proper word wrapping
    drawItem(index) {
      const choice = this._choices[index];
      if (!choice) return;

      const rect = this.itemRect(index);

      // Draw background image if available
      if (choice.bgImage) {
        const bitmap = ImageManager.loadPicture(choice.bgImage);
        if (bitmap.isReady()) {
          this.contents.blt(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            rect.x,
            rect.y,
            rect.width,
            rect.height
          );
        }
      }

      // Draw semi-transparent background for text readability
      const textPadding = 8;
      this.contents.fillRect(
        rect.x + 4,
        rect.y + 4,
        rect.width - 8,
        rect.height - 8,
        "rgba(0, 0, 0, 0.6)"
      );

      // Draw choice name (title)
      this.resetFontSettings();
      this.changeTextColor(ColorManager.systemColor());
      this.contents.fontSize += 4;

      this.drawText(
        choice.name,
        rect.x,
        rect.y + textPadding,
        rect.width,
        "center"
      );

      // Draw description with word wrapping
      this.resetFontSettings();
      if (choice.description) {
        const descY = rect.y + textPadding + this.lineHeight() + 4; // Add small gap
        const availableWidth = rect.width - textPadding * 2;
        const availableHeight = rect.height - (descY - rect.y) - textPadding;

        this.drawWrappedDescription(
          choice.description,
          rect.x + textPadding,
          descY,
          availableWidth,
          availableHeight
        );
      }
    }

    // NEW: Method to draw wrapped description text
    drawWrappedDescription(description, x, y, maxWidth, maxHeight) {
      const wrappedLines = this.wrapText(description, maxWidth);
      const lineHeight = this.lineHeight();
      const maxLines = Math.floor(maxHeight / lineHeight);

      // Limit the number of lines to fit in the available space
      const linesToDraw = Math.min(wrappedLines.length, maxLines);

      for (let i = 0; i < linesToDraw; i++) {
        const lineY = y + i * lineHeight;
        let lineText = wrappedLines[i];

        // If this is the last line we can draw and there are more lines, add ellipsis
        if (i === linesToDraw - 1 && wrappedLines.length > maxLines) {
          // Check if we need to truncate to fit ellipsis
          const ellipsis = "...";
          const ellipsisWidth = this.textWidth(ellipsis);

          while (
            this.textSizeEx(lineText + ellipsis).width > maxWidth &&
            lineText.length > 0
          ) {
            lineText = lineText.slice(0, -1);
          }
          lineText += ellipsis;
        }

        // Draw the line using drawTextEx to handle color codes
        this.drawTextEx(lineText, x, lineY, maxWidth);
      }
    }
  }

  // Plugin Commands
  PluginManager.registerCommand(pluginName, "characterCreation", () => {
    if (typeof window.preloadBustData === 'function') window.preloadBustData();

    // Tutorial mode: Switch 100 ON and player is on map 1414
    const isTutorial = $gameSwitches.value(100) && $gameMap.mapId() === 1414;
    Scene_CharacterCreation._tutorialMode = isTutorial;
    Scene_CharacterCreation._currentPartyMemberIndex = 0;
    // Pick up any previously chosen mode (subsequent creations skip the
    // mode step via showOnlyOnce); null means the mode step will set it.
    // Detailed is never carried over: the mode step is silenced once a
    // savegame has built a party, so a carried-over Detailed would lock every
    // later party into the editor with no board and no way back.
    const carriedMode = $gameSystem && $gameSystem._ccCreationMode;
    Scene_CharacterCreation._creationMode =
      (carriedMode === "detailed" ? null : carriedMode) || null;

    const startStep = Scene_CharacterCreation.getStartingStep();
    Scene_CharacterCreation.prepare(startStep);

    // Set the current actor's initial class to 1 at the start
    const actor = Scene_CharacterCreation.getCurrentActor();
    if (actor) {
      actor.changeClass(1, false);
    }

    SceneManager.push(Scene_CharacterCreation);
  });

  PluginManager.registerCommand(pluginName, "repriseCreation", () => {
    let startStep;

    if (Scene_CharacterCreation._interruptedStep >= 0) {
      startStep = Scene_CharacterCreation._interruptedStep + 1;
      Scene_CharacterCreation._interruptedStep = -1;
    } else {
      startStep = STEP.CLASS; // resume a humanoid at class selection
      while (startStep < CharacterCreationData.length) {
        const stepData = CharacterCreationData[startStep];
        if (stepData.showOnlyOnce && isStepCompleted(startStep)) {
          startStep++;
        } else {
          break;
        }
      }
    }

    Scene_CharacterCreation._isCreatureMode = false;
    Scene_CharacterCreation._creationMode =
      ($gameSystem && $gameSystem._ccCreationMode) || Scene_CharacterCreation._creationMode;
    Scene_CharacterCreation.prepare(startStep);
    SceneManager.push(Scene_CharacterCreation);
  });

  PluginManager.registerCommand(pluginName, "repriseCreationCreature", () => {
    Scene_CharacterCreation._creationMode =
      ($gameSystem && $gameSystem._ccCreationMode) || Scene_CharacterCreation._creationMode;

    // Quick mode has no creatures: fall back to a normal humanoid reprise so
    // the flow can never strand the player in a disabled creature path.
    if (Scene_CharacterCreation.isQuickMode()) {
      let startStep = Scene_CharacterCreation._interruptedStep >= 0
        ? Scene_CharacterCreation._interruptedStep + 1
        : STEP.CLASS;
      Scene_CharacterCreation._interruptedStep = -1;
      while (startStep < CharacterCreationData.length) {
        const stepData = CharacterCreationData[startStep];
        if (stepData.showOnlyOnce && isStepCompleted(startStep)) {
          startStep++;
        } else {
          break;
        }
      }
      Scene_CharacterCreation._isCreatureMode = false;
      Scene_CharacterCreation.prepare(startStep);
      SceneManager.push(Scene_CharacterCreation);
      return;
    }

    let startStep;

    if (Scene_CharacterCreation._interruptedStep >= 0) {
      startStep = Scene_CharacterCreation._interruptedStep + 1;
      Scene_CharacterCreation._interruptedStep = -1;
    } else {
      startStep = STEP.GENDER; // resume a creature at gender selection
      while (startStep < CharacterCreationData.length) {
        const stepData = CharacterCreationData[startStep];
        if (stepData.showOnlyOnce && isStepCompleted(startStep)) {
          startStep++;
        } else {
          break;
        }
      }
    }

    Scene_CharacterCreation._isCreatureMode = true;
    Scene_CharacterCreation.prepare(startStep);
    SceneManager.push(Scene_CharacterCreation);
  });

  PluginManager.registerCommand(pluginName, "repriseTraitSelection", (args) => {
    const targetActorId = args.actorId ? parseInt(args.actorId) : 1;

    if (window.Scene_TraitSelector) {
      window.Scene_TraitSelector.prepare(true, targetActorId);
      SceneManager.push(window.Scene_TraitSelector);
    } else {
      console.error("Scene_TraitSelector not available!");
    }
  });

  // ==========================================================================
  // Battle Test: auto-build a random, slightly under-levelled party
  //
  // When a Battle Test is launched from the editor and Actor 1 is named "Test",
  // the test party is replaced with 3 members that have random classes, genders,
  // equipment and traits. Levels are derived from the troop's enemy <Level: N>
  // notes and kept below the enemy median, so the party median level is always
  // lower than the troop's (the enemies stay the tougher side of the test).
  // ==========================================================================

  const BATTLE_TEST_TRIGGER_NAME = "test"; // matched case-insensitively

  // Median enemy level from <Level: N> notes in the current troop, or null.
  function getTroopMedianEnemyLevel() {
    if (typeof $gameTroop === "undefined" || !$gameTroop) return null;
    const levels = [];
    for (const member of $gameTroop.members()) {
      const enemy = member && member.enemy ? member.enemy() : null;
      if (!enemy || !enemy.note) continue;
      const m = enemy.note.match(/<Level:\s*(\d+)>/i);
      if (m) {
        const lvl = parseInt(m[1], 10);
        if (lvl > 0) levels.push(lvl);
      }
    }
    if (levels.length === 0) return null;
    levels.sort((a, b) => a - b);
    const mid = Math.floor(levels.length / 2);
    return levels.length % 2 === 0
      ? Math.round((levels[mid - 1] + levels[mid]) / 2)
      : levels[mid];
  }

  // Generate a name using a sprite's own Markov voice (its NPCs.json markovDB),
  // falling back to generic NPC name pools. Returns null if generation is
  // unavailable.
  function generateNpcMarkovName(markovDB, seedSalt) {
    if (!window.generateSeededMarkovName) return null;
    const seed = (Date.now() + seedSalt * 7919) >>> 0;
    const wx = seed & 0xffff;
    const wy = (seed >>> 16) & 0xffff;
    const tryDB = (db) => {
      if (!db) return null;
      try {
        const n = window.generateSeededMarkovName(wx, wy, seedSalt + 1, db, 2, 4, 12);
        return n && n !== "Unknown" && n !== "NPC" ? n : null;   // i18n-ignore: generator sentinels
      } catch (e) {
        return null;
      }
    };
    const name = tryDB(markovDB) || tryDB("npc") || tryDB("names");
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
  }

  // Pick a random NPCs.json sprite (npc:true) and apply its character image,
  // name and bust to the actor. Returns the chosen NPCs.json entry (for its
  // Gender), or null if the sprite database is unavailable.
  function applyRandomNpcSpriteAndName(actor, memberIndex) {
    const npcData = window.WorldGen && window.WorldGen.NPCs;
    if (!npcData) return null;
    // A rolled face is a face nobody chose, so beta sheets stay out of it unless
    // the world was created with them enabled. Browsing the sprite grid still
    // shows them all.
    const keys = window.SpriteCatalog
      ? window.SpriteCatalog.npcKeys()
      : Object.keys(npcData).filter((k) => npcData[k] && npcData[k].npc === true);
    if (keys.length === 0) return null;

    const charName = keys[Math.floor(Math.random() * keys.length)];
    const entry = npcData[charName];
    // "$" sheets are single-character (index 0 only); standard sheets hold 8.
    const maxIndex = charName.includes("$") ? 0 : 7;
    const charIndex = Math.floor(Math.random() * (maxIndex + 1));

    actor.setCharacterImage(charName, charIndex);

    // Bust: use the sprite's own bust mapping, stored on the actor itself (the
    // old per-player bust variables were retired). These characters are always
    // portrayed by that bust, never by a sculpted 3D model.
    const bust = (entry.busts && (entry.busts[charIndex] ?? entry.busts[0])) || null;
    if (bust) {
      actor.setVnBust(bust);
      if (actor.setPortraitMode) actor.setPortraitMode("bust");
    }

    const name = generateNpcMarkovName(entry.markovDB, memberIndex);
    if (name) actor.setName(name);

    return entry;
  }

  // Rough "power" score for an armor, used to bias starting gear toward weak
  // pieces. Sum of positive param bonuses (weighted heavily) plus shop price.
  function armorPowerScore(a) {
    const params = Array.isArray(a.params)
      ? a.params.reduce((s, v) => s + Math.max(0, v), 0)
      : 0;
    return params * 10 + (a.price || 0);
  }

  // Pick a random "low stat" armor from a candidate list: rank by power and
  // draw from the weakest tier (bottom third, 1-5 pieces) so new characters
  // start deliberately under-geared rather than rolling a legendary.
  function pickLowStatArmor(candidates) {
    if (!candidates || candidates.length === 0) return null;
    const scored = candidates
      .map((a) => ({ a, score: armorPowerScore(a) }))
      .sort((p, q) => p.score - q.score);
    const tierSize = Math.max(1, Math.min(5, Math.ceil(scored.length / 3)));
    const tier = scored.slice(0, tierSize);
    return tier[Math.floor(Math.random() * tier.length)].a;
  }

  // Fill every EMPTY equip slot for an actor with a random low-stat compatible
  // piece: the weapon slot draws from the class's curated low-tier weapon pool,
  // every armor slot draws a weak compatible armor. Slots that already hold an
  // item (preset gear, or the weapon picked during class selection) are left
  // untouched, so this both completes custom characters and fills the gaps in
  // preset characters. Safe to call repeatedly.
  function equipLowStatGearForActor(actor) {
    if (!actor) return;
    const slots = actor.equipSlots(); // etypeId per slot
    const equips = actor.equips();    // current item per slot (null if empty)
    for (let slotId = 0; slotId < slots.length; slotId++) {
      if (equips[slotId]) continue; // already equipped - keep it
      const etypeId = slots[slotId];

      if (etypeId === 1) {
        // Weapon slot: draw from the class's curated low-tier weapon pool.
        const SE = window.StartingEquipment;
        if (!(SE && SE.getCompatibleWeaponTypes && SE.getCompatibleWeapons)) continue;
        const pool = SE.getCompatibleWeapons(
          SE.getCompatibleWeaponTypes(actor._classId)
        ).filter((w) => actor.canEquip(w));
        if (pool.length === 0) continue;
        const weapon = pool[Math.floor(Math.random() * pool.length)];
        $gameParty.gainItem(weapon, 1);
        try {
          actor.changeEquip(slotId, weapon);
        } catch (e) {
          /* incompatible roll - leave the slot empty */
        }
        continue;
      }

      const candidates = $dataArmors.filter(
        (a) =>
          a &&
          a.name &&
          !a.name.trim().startsWith("<--") &&
          a.etypeId === etypeId &&
          actor.canEquip(a)
      );
      const armor = pickLowStatArmor(candidates);
      if (!armor) continue;
      $gameParty.gainItem(armor, 1);
      try {
        actor.changeEquip(slotId, armor);
      } catch (e) {
        /* incompatible roll - leave the slot empty */
      }
    }
  }

  // Fill empty equip slots for every current party member (end-of-creation).
  function fillPartyStartingEquipment() {
    if (!$gameParty) return;
    $gameParty.members().forEach((actor) => equipLowStatGearForActor(actor));
  }

  // Equip a random compatible armor in every non-weapon equip slot.
  function equipRandomArmorsForActor(actor) {
    const slots = actor.equipSlots(); // etypeId per slot
    for (let slotId = 0; slotId < slots.length; slotId++) {
      if (slots[slotId] === 1) continue; // weapon slot - handled separately
      const candidates = $dataArmors.filter(
        (a) =>
          a &&
          a.name &&
          !a.name.trim().startsWith("<--") &&
          a.etypeId === slots[slotId] &&
          actor.canEquip(a)
      );
      if (candidates.length === 0) continue;
      const armor = candidates[Math.floor(Math.random() * candidates.length)];
      $gameParty.gainItem(armor, 1);
      try {
        actor.changeEquip(slotId, armor);
      } catch (e) {
        /* incompatible roll - leave the slot empty */
      }
    }
  }

  // Randomize one actor: class, gender/reproduction, level, equipment, traits.
  function randomizeBattleTestActor(actor, memberIndex, level) {
    if (!actor) return;

    // Sprite + name (and bust) from a random NPCs.json npc:true entry.
    const npcEntry = applyRandomNpcSpriteAndName(actor, memberIndex);

    // Random non-creature class.
    let classId = actor._classId;
    const validClasses = $dataClasses.filter((c) => c && c.id !== 65);
    if (validClasses.length > 0) {
      classId = validClasses[Math.floor(Math.random() * validClasses.length)].id;
      actor.changeClass(classId, false);
    }

    // Level (set after the class change so exp matches the new class).
    actor.changeLevel(Math.max(1, Math.min(99, level)), false);

    // Gender + matching reproduction type. Prefer the chosen sprite's gender so
    // identity matches the sprite the player sees, otherwise roll randomly.
    const genderVars = [VAR_PLAYER1_GENDER, VAR_PLAYER2_GENDER, VAR_PLAYER3_GENDER];
    const reproVars = [
      VAR_PLAYER1_REPRODUCTIVE_TYPE,
      VAR_PLAYER2_REPRODUCTIVE_TYPE,
      VAR_PLAYER3_REPRODUCTIVE_TYPE,
    ];
    const genderVar = genderVars[memberIndex];
    const reproVar = reproVars[memberIndex];
    const gender =
      npcEntry && npcEntry.Gender != null ? npcEntry.Gender : Math.floor(Math.random() * 4);
    if (genderVar) $gameVariables.setValue(genderVar, gender);
    if (reproVar) {
      const repro =
        gender === 0 ? 0 : gender === 1 ? 1 : gender === 3 ? 4 : Math.floor(Math.random() * 5);
      $gameVariables.setValue(reproVar, repro);
    }

    // Random traits (param bonuses, skills, bonus gear into inventory).
    if (window.randomizeTraitsForActor) {
      window.randomizeTraitsForActor(actor.actorId());
    }

    // Equipment: a random weapon for the class + random armor per slot.
    if (typeof equipRandomCompatibleWeapon === "function") {
      equipRandomCompatibleWeapon(actor, classId);
    }
    equipRandomArmorsForActor(actor);

    // Baseline skills so the actor can actually act in the test.
    if (Array.isArray(GLOBAL_STARTER_SKILLS)) {
      GLOBAL_STARTER_SKILLS.forEach((id) => {
        if ($dataSkills[id]) actor.learnSkill(id);
      });
    }

    actor.recoverAll();
  }

  function setupRandomBattleTestParty() {
    const enemyMedian = getTroopMedianEnemyLevel() || 10;
    // Cap so every member is strictly below the enemy median (floored at 1),
    // which keeps the party's median level under the troop's.
    const cap = Math.max(1, enemyMedian - 1);
    const baseLevel = Math.max(1, enemyMedian - 2);

    // Rebuild the party as exactly 3 members (actors 1-3).
    for (const id of $gameParty._actors.slice()) {
      $gameParty.removeActor(id);
    }
    for (let i = 0; i < 3; i++) {
      const actorId = i + 1;
      $gameParty.addActor(actorId);
      const level = Math.min(baseLevel + (i - 1), cap);
      randomizeBattleTestActor($gameActors.actor(actorId), i, level);
    }

    if ($gamePlayer) $gamePlayer.refresh(); // reflect the new leader sprite

    console.log(
      `[BattleTest] Built random party (enemy median lvl ${enemyMedian}, party cap lvl ${cap}).`
    );
  }

  const _DataManager_setupBattleTest = DataManager.setupBattleTest;
  DataManager.setupBattleTest = function () {
    _DataManager_setupBattleTest.call(this);
    try {
      const actor1 = $gameActors.actor(1);
      if (actor1 && actor1.name().trim().toLowerCase() === BATTLE_TEST_TRIGGER_NAME) {
        setupRandomBattleTestParty();
      }
    } catch (e) {
      console.error("[BattleTest] Failed to build random party:", e);
    }
  };

  // --- Overland origin placement -----------------------------------------
  // An origin must never put the party on an Ocean square: about half the world
  // map is open sea, and the procedural map behind such a square is water with
  // no land to stand on. Water is identified by region 99 or terrain tag 3 (see
  // CLAUDE.md) AND by the biome the procedural generator reads at that column,
  // which is the classification that actually decides what the square becomes.
  const CC_WATER_BIOME_RE = /^(ocean|lake|seabed|sea\b)/i;

  function ccIsWaterWorldTile(x, y) {
    if ($gameMap.regionId(x, y) === 99) return true;
    if ($gameMap.terrainTag(x, y) === 3) return true;
    const biome =
      $gameSystem && $gameSystem.getBiomeFromWorldCoordinates
        ? $gameSystem.getBiomeFromWorldCoordinates(x, y)
        : null;
    return typeof biome === "string" && CC_WATER_BIOME_RE.test(biome);
  }

  // Once the world map is loaded, drop the player onto a random passable,
  // non-water land tile (Empty-lot origin). A passable tile must be walkable in
  // every direction and free of events.
  function ccFindRandomLandTile() {
    if (!$gameMap) return null;
    const w = $gameMap.width();
    const h = $gameMap.height();
    for (let i = 0; i < 500; i++) {
      const x = Math.floor(Math.random() * w);
      const y = Math.floor(Math.random() * h);
      if (ccIsWaterWorldTile(x, y)) continue;
      if (!$gameMap.checkPassage(x, y, 0x0f)) continue;
      if ($gameMap.eventsXy(x, y).length > 0) continue;
      return { x, y };
    }
    return null;
  }

  // Move the player onto the landing tile and keep the fast-travel world coords
  // (variables 43/44) in sync with it.
  function ccLocateOnWorldMap(x, y) {
    $gamePlayer.locate(x, y);
    $gameVariables.setValue(43, x);
    $gameVariables.setValue(44, y);
  }

  const _CC_SceneMap_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    const enteringGameStartMap =
      $gamePlayer.isTransferring() && $gamePlayer.newMapId() === GAME_START_MAP_ID;
    _CC_SceneMap_onMapLoaded.call(this);
    if ($gameTemp && $gameTemp._ccEmptyLotStart && $gameMap.mapId() === WORLD_MAP_ID) {
      $gameTemp._ccEmptyLotStart = false;
      const tile = ccFindRandomLandTile();
      if (tile) ccLocateOnWorldMap(tile.x, tile.y);
    }
    // The stranded spots are hand-picked land, but they are coordinates written
    // by hand against a world map that can be repainted: if one of them ever
    // ends up over water, land the castaway somewhere else rather than at sea.
    if ($gameTemp && $gameTemp._ccStrandedStart && $gameMap.mapId() === WORLD_MAP_ID) {
      $gameTemp._ccStrandedStart = false;
      if (ccIsWaterWorldTile($gamePlayer.x, $gamePlayer.y)) {
        const tile = ccFindRandomLandTile();
        if (tile) ccLocateOnWorldMap(tile.x, tile.y);
      } else {
        $gameVariables.setValue(43, $gamePlayer.x);
        $gameVariables.setValue(44, $gamePlayer.y);
      }
    }
    // Hide the player sprite the instant it lands on the game-start map, so it
    // never pops in mid-fade; Scene_Map.update below reveals it the moment the
    // fade-in completes.
    if (enteringGameStartMap) {
      $gamePlayer.setImage("", 0);
      if ($gameTemp) $gameTemp._ccRevealSpriteOnFadeIn = true;
    }
  };

  const _CC_SceneMap_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _CC_SceneMap_update.call(this);
    if ($gameTemp && $gameTemp._ccRevealSpriteOnFadeIn && !this.isFading()) {
      $gameTemp._ccRevealSpriteOnFadeIn = false;
      $gamePlayer.refresh();
    }
  };

  // Export to global namespace
  window.Scene_CharacterCreation = Scene_CharacterCreation;

  console.log(`${pluginName} loaded successfully.`);
})();
