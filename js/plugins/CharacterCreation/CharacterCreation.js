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
  // The cog the Settings tab wears. IconSet has no dedicated gear, so the
  // stone wheel (the one round, toothed glyph in the sheet) stands in for one.
  const SETTINGS_TAB_ICON = 83;

  // Stable hash -> a consistent icon for a given setting key.
  const pickSettingIcon = (key) => {
    let h = 0;
    const s = String(key);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return SETTINGS_ICON_POOL[h % SETTINGS_ICON_POOL.length];
  };

  // Preview plate per enemy spawn mode, indexed by the stored setting value
  // (0 Distance from spawn, 1 Party Level, 2 Biome, 3 Chaos). The same files
  // the options menu shows for this setting; see GameOptions.js, OPTION_IMAGES.
  const ENEMY_SPAWN_IMAGES = [
    "EnemySpawnDistance", "EnemySpawnPartyLevel", "EnemySpawnBiome", "EnemySpawnChaos",
  ];

  // Robust i18n resolver with safe fallback that never leaks raw keys
  function ccT(key, fallback) {
    if (typeof T === 'function') {
      try {
        if (T.has && T.has(key)) {
          const res = T(key);
          if (typeof res === 'string' && res.trim() && res !== key) return res;
        }
      } catch (e) {}
    }
    return fallback != null ? fallback : key;
  }

  // The same, for a line that names numbers. ccT cannot carry parameters, and
  // a readout that prints two blood concentrations needs them.
  function ccTp(key, params, fallback) {
    if (typeof T === 'function') {
      try {
        if (T.has && T.has(key)) {
          const res = T(key, params);
          if (typeof res === 'string' && res.trim() && res !== key) return res;
        }
      } catch (e) {}
    }
    return fallback != null ? fallback : key;
  }

  // The attribute abbreviations every stat box is labelled with. They live in
  // js/i18n/<lang>/stats.json, which sits outside what window.T covers, so
  // CharacterCreationShared reads that bank and this is the guarded way in:
  // English stands in where the shared plugin has not loaded.
  const CC_STAT_FALLBACK = {
    HP: "HP", MP: "MP", AP: "AP", STR: "STR", CON: "CON",
    INT: "INT", WIS: "WIS", DEX: "DEX", PSI: "PSI"
  };
  function ccStatLabels() {
    return (typeof window.CCStatLabels === 'function') ? window.CCStatLabels() : CC_STAT_FALLBACK;
  }
  function ccStatLabel(abbr) {
    if (typeof window.CCStatLabel === 'function') return window.CCStatLabel(abbr);
    return CC_STAT_FALLBACK[String(abbr || '').toUpperCase()] || abbr;
  }

  // A localized list, with an English one to fall back on where the namespace
  // is not loaded (a harness, a stripped build).
  function ccList(key, fallback) {
    try {
      if (typeof T === 'function' && T.list) {
        const list = T.list(key);
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e) {}
    return fallback || [];
  }

  // ==========================================================================
  // The body a character is built with
  // ==========================================================================
  // Two answers the Bio tab asks for and nothing else in the wizard does: the
  // reproductive organs the character starts with, and where their body sits
  // between an oestrogenic and an androgenic endocrine balance.
  //
  // They are asked SEPARATELY from gender on purpose. Picking male or female
  // still defaults the organs to testes or a uterus, because that is the body
  // those words usually come with and a default is what the player expects to
  // find already filled in; picking non-binary or cocoon defaults nothing at
  // all and leaves whatever is there. Either way the selector below is the
  // final word: the gender pick writes a default into it, and the player may
  // move it straight off again.
  const CC_REPRODUCTION_FALLBACK = {
    NONE: -1, TESTICLES: 0, UTERUS: 1, OVIPAROUS: 2, PLANT: 3, MITOSIS: 4
  };
  function ccReproTypes() {
    const CCU = window.CharacterCreationUtils;
    return (CCU && CCU.REPRODUCTION_TYPES) || CC_REPRODUCTION_FALLBACK;
  }
  // The five organ labels are the biologic panel's own (js/i18n/*/plugins/
  // Biologic.json), so the sheet, the register and this selector all call a
  // uterus the same thing.
  function ccReproLabels() {
    return ccList('Biologic.reproductionType', [
      "Testicles (Male)", "Mammalian (Uterus)", "Oviparous (Egg-laying)",
      "Plant-based (Seeds)", "Mitosis (Cell division)"
    ]);
  }
  function ccReproChoices() {
    const R = ccReproTypes();
    const labels = ccReproLabels();
    return [
      { val: R.TESTICLES, label: labels[0] },
      { val: R.UTERUS, label: labels[1] },
      { val: R.OVIPAROUS, label: labels[2] },
      { val: R.PLANT, label: labels[3] },
      { val: R.MITOSIS, label: labels[4] },
      { val: R.NONE, label: ccT('CharCreate.reproNone', "None (sterile)") }
    ];
  }
  // Where a body sits reads as a phrase rather than as a number: "leaning
  // androgenic" is what the slider is actually saying.
  function ccHormoneLean(balance) {
    const bands = ccList('CharCreate.hormoneLean', [
      "Strongly oestrogenic", "Oestrogenic", "Evenly balanced",
      "Androgenic", "Strongly androgenic"
    ]);
    const index = balance < 15 ? 0 : balance < 35 ? 1 : balance < 65 ? 2 : balance < 85 ? 3 : 4;
    return bands[index] || bands[bands.length - 1] || "";
  }

  // ==========================================================================
  // What the naming step carries besides its screens
  // ==========================================================================
  // Common event 97 opened the name and sprite screens, and did three other
  // things on the way past. They are done here now, in the same order the event
  // did them, so removing the event changed nothing about what a new character
  // starts with.
  const CREATION_PAGE_TURN_SE = { name: "PixelUI/PixelUI (1)", volume: 90, pitch: 100, pan: 0 };
  const CREATION_START_GOLD = 2000; // per humanoid member, as the event gave it
  const SWITCH_CREATION_NAMED = 12;
  // Switch 100 is the tutorial's own: while it is on, the name is not the
  // player's to type (the event asked the same question before its Name Input).
  const SWITCH_TUTORIAL = 100;
  // The Markov call the event made, argument for argument. Plugin commands are
  // registered under the bare file name (Utils.extractFileName), which is why
  // this says MarkovTextGenerator where the event said UI/MarkovTextGenerator.
  const CREATION_NAME_MARKOV = {
    plugin: "MarkovTextGenerator",
    command: "generateName",
    args: {
      databaseId: "names", chainOrder: "2", minChars: "4", maxChars: "12",
      useWordMode: "false", variableId: "4", displayInMessage: "false",
    },
  };

  // Open one queued sub-screen for `actorId`. False when its scene is missing,
  // so the queue can move on rather than strand the wizard.
  function openCreationSubScreen(screen, actorId) {
    if (screen === "sprite") {
      if (!window.Scene_SpriteGridSelector) return false;
      SceneManager.push(window.Scene_SpriteGridSelector);
      if (SceneManager._nextScene && SceneManager._nextScene.setActor) {
        SceneManager._nextScene.setActor(actorId);
      }
      return true;
    }
    if (screen === "name") {
      if (typeof Scene_Name === "undefined" || !$dataActors[actorId]) return false;
      SceneManager.push(Scene_Name);
      // Length is overridden by AltNameInput's own prepare; the event passed 8.
      SceneManager.prepareNextScene(actorId, 8);
      return true;
    }
    return false;
  }

  // Em's dossier grows restless if it sits unpicked on the preset board: ten
  // seconds in she starts heckling from inside her own card, then again every
  // few seconds until she is picked or the board closes. It borrows
  // NPCConversation's speech-bubble look (the "npc-thought-bubble" class)
  // outright so it reads exactly like the town's bubbles, but anchors on her
  // card's own screen rect instead of a map event: the preset board is DOM
  // already, so there is no projection math to do, and no NPCBubbleLayout
  // arbiter is needed since only one of these can ever be on screen.
  const EM_RESTLESS_DELAY_MS = 10000;
  const EM_RESTLESS_INTERVAL_MS = 6000;
  const EM_RESTLESS_DISPLAY_MS = 4000;
  const EM_RESTLESS_FADE_MS = 350;
  window.EmRestlessBubble = window.EmRestlessBubble || {
    _el: null,
    _card: null,
    _hideAt: 0,
    _fadeAt: 0,

    _element() {
      if (this._el) return this._el;
      const el = document.createElement("div");
      el.className = "npc-thought-bubble";
      document.body.appendChild(el);
      this._el = el;
      return el;
    },

    show(card, text) {
      if (!card || !text) return;
      const el = this._element();
      el.textContent = text;
      el.classList.remove("fading");
      el.style.display = "block";
      void el.offsetWidth; // restart the transition on a recycled element
      el.classList.add("visible");
      this._card = card;
      this._hideAt = Date.now() + EM_RESTLESS_DISPLAY_MS;
      this._fadeAt = 0;
      this._reposition();
    },

    // Card sits in a scrollable board, so its screen rect is re-read every
    // frame rather than cached once at show() time.
    _reposition() {
      if (!this._card || !this._el) return;
      const rect = this._card.getBoundingClientRect();
      const h = this._el.offsetHeight || 0;
      this._el.style.left = `${rect.left + rect.width / 2}px`;
      this._el.style.top = `${rect.top - h - 14}px`;
    },

    update() {
      if (!this._el || this._el.style.display === "none") return;
      const now = Date.now();
      if (this._fadeAt) {
        if (now >= this._fadeAt) this.release();
        return;
      }
      if (now >= this._hideAt) {
        this._el.classList.remove("visible");
        this._el.classList.add("fading");
        this._fadeAt = now + EM_RESTLESS_FADE_MS;
        return;
      }
      this._reposition();
    },

    release() {
      if (!this._el) return;
      this._el.classList.remove("visible", "fading");
      this._el.style.display = "none";
      this._card = null;
      this._hideAt = 0;
      this._fadeAt = 0;
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
  // The shared Back / extras / Continue bar (CharacterCreationShared.js).
  const CCButtons = window.CCButtons;
  const { equipRandomCompatibleWeapon, GLOBAL_STARTER_SKILLS, applyStartingGear, getClassStartingItems, giveClassStartingItems } = window.StartingEquipment || {};
  const { getCharacterPresets, getAvailableCharacterPresets, markPresetUsed, unmarkPresetUsed, getPresetLore, getPresetHometown, getPresetSkins, getPresetSkin, getPresetSkinLabel, markStepCompleted, isStepCompleted, hasCompletedFirstCreation, Window_CharacterPresets, getEmRestlessLine } = window.CharacterPresets || {};
  // Which button leafs through a dossier's looks, named on a chip under the
  // thumbnail row: the shoulder buttons when a pad is plugged in, TAB
  // otherwise. A pad can be plugged in (or its battery die) while the board is
  // open, so the chip is kept in step rather than only stamped once.
  function skinKeyPadOn() {
    const pad = window.AnalogStickInput;
    return !!(pad && typeof pad.hasPad === "function" && pad.hasPad());
  }
  // i18n-ignore-start: physical controller / keyboard button ids
  function skinKeyLabel() { return skinKeyPadOn() ? "L1 R1" : "TAB"; }
  // i18n-ignore-end

  // Alternate looks a dossier can be played as. Falls back to the dossier's own
  // sprite and bust when the presets plugin is an older build without skins.
  function presetSkins(preset) {
    if (typeof getPresetSkins === "function") return getPresetSkins(preset);
    return preset
      ? [{ key: "", sprite: preset.sprite, spriteIndex: preset.spriteIndex || 0, busts: preset.busts }]
      : [];
  }
  // What a look is called on its thumbnail ("Statesman", "Arcane", "Pontiff").
  // A dossier with only its own look has no label to print, and none is needed:
  // the row is not drawn at all in that case.
  function presetSkinLabel(skinData) {
    if (typeof getPresetSkinLabel === "function") return getPresetSkinLabel(skinData) || "";
    return "";
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
    // The world decides what level its people are made at, and it has to be
    // settled before the gear is dealt so a level 40 party is not kitted out
    // for a level 1 one.
    applyWorldStartingLevel();
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

  // --- The world's starting level ----------------------------------------
  // A world is created with the level its people are built at (world.json →
  // startLevel, set on the creation form). Every member the wizard finishes is
  // raised to it, class skills and all: a world begun in a later year opens on
  // monsters no level 1 party can stand in front of, and this is what makes
  // those years playable. Never lowers anybody, so a pre-made dossier keeps
  // whatever rank it was written at when that is the higher of the two, and a
  // world that never touched the option (or an older world) answers 1 and this
  // does nothing at all.
  function applyWorldStartingLevel() {
    const WM = window.WorldManager;
    const level = (WM && WM.startingLevel) ? WM.startingLevel() : 1;
    if (!(level > 1)) return;
    $gameParty.allMembers().forEach((actor) => {
      if (!actor || actor.level >= level) return;
      // `true` shows the level-up log; the party is standing in a menu, so it
      // is passed as false and the skills are learned silently.
      actor.changeLevel(Math.min(99, level), false);
    });
  }

  // --- Starting supplies -------------------------------------------------
  // Handed out once, the first time a party finishes creation: cheap healing
  // food/consumables, plus a spare weapon for every member and a couple of
  // spare armor pieces so the party always has a backup to fall back on.
  // Low-price healing food / consumables: [itemId, quantity].
  const STARTER_CONSUMABLES = [
    [3, 3],   // Acetaminophen Tablets (heals 20% HP)
    [16, 2],  // Pseudoephedrine Tabs (heals 15% HP)
  ];
  // Spare armor pieces (cheap, low weight): [armorId, quantity].
  const STARTER_SPARE_ARMORS = [
    [4, 1], // Motion Defense Hat
    [2, 1], // Siege Breaker Armor
  ];

  // --- The three staples every party opens on ----------------------------
  // Whatever the world, the class or the dossier, a party starts able to heal,
  // to cast and to eat, and starts with those three things one keypress away:
  // the kit below is granted here and bound to hotbar slots 1, 2 and 3. The
  // food is one type, rolled per playthrough, so two worlds do not open on the
  // same packed lunch.
  const STARTER_HEALING_POTION = [648, 6]; // Health Potion
  const STARTER_MANA_TONIC = [21, 3];      // Mana Tonic
  const STARTER_FOOD_QTY = 6;
  // Ceiling on the rolled food, in gold (100 gold = €1): a starting meal, not a
  // delicacy. Keeps the roll among the mundane end of the Food category.
  const STARTER_FOOD_PRICE_CAP = 300;
  // A packed lunch has to be worth eating: below this the Food category is
  // water, garnishes and seasonings rather than a meal.
  const STARTER_FOOD_MIN_CALORIES = 50;
  // Used when the roll finds nothing (a stripped Items.json, a bad filter).
  const STARTER_FOOD_FALLBACK = [421, 423]; // Granola Bar, Bruised Apple

  /**
   * Every cheap, usable, hotbar-able Food item fit to open a game on.
   *
   * Beyond price this rules out three kinds of Food entry that are not a meal:
   * raw produce (anything carrying a <Forage:> tag, i.e. picked, not prepared),
   * garnishes and drinking water (too few calories to count), and anything that
   * inflicts a state when eaten (raw meat and its food poisoning).
   * @returns {array} $dataItems entries (possibly empty)
   */
  function starterFoodPool() {
    const utils = window.ItemSystemUtils;
    return $dataItems.filter((item) => {
      if (!item || !item.name || !item.name.trim()) return false;
      // Slots hold item ids and the bar only takes usable items, so the roll
      // has to obey the same rule the star does.
      if (item.occasion !== 0 && item.occasion !== 2) return false;
      if ((item.price || 0) > STARTER_FOOD_PRICE_CAP) return false;
      const isFood = utils && utils.isFoodItem
        ? utils.isFoodItem(item)
        : /<category:Food>/i.test(item.note || ""); // i18n-ignore: item-category tag
      if (!isFood) return false;
      const note = item.note || "";
      if (/<Forage:/i.test(note)) return false;
      const calories = note.match(/<calories:\s*([\d.]+)>/i);
      if (!calories || Number(calories[1]) < STARTER_FOOD_MIN_CALORIES) return false;
      // Effect code 21 is "add state" — a food that does that is a mistake
      // waiting to happen on slot 3.
      return !(item.effects || []).some((effect) => effect && effect.code === 21);
    });
  }

  /**
   * The one food type this playthrough opens on.
   * @returns {object|null} An $dataItems entry, or null if even the fallback is missing
   */
  function rollStarterFood() {
    const pool = starterFoodPool();
    if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
    const fallback = STARTER_FOOD_FALLBACK.map((id) => $dataItems[id]).filter(Boolean);
    return fallback.length > 0 ? fallback[Math.floor(Math.random() * fallback.length)] : null;
  }

  /**
   * Grant the three staples and bind them to hotbar slots 1-3.
   * The bar is ItemSystemHotbar's; a build without it simply gets the items.
   */
  function giveStarterStaples() {
    const bind = [];
    [STARTER_HEALING_POTION, STARTER_MANA_TONIC].forEach(([id, qty]) => {
      const item = $dataItems[id];
      if (!item) {
        console.warn(`CharacterCreation: starter staple ${id} not found.`);
        bind.push(null);
        return;
      }
      $gameParty.gainItem(item, qty);
      bind.push(item);
    });

    const food = rollStarterFood();
    if (food) $gameParty.gainItem(food, STARTER_FOOD_QTY);
    bind.push(food);

    const hotbar = window.ItemHotbar;
    if (!hotbar) return;
    bind.forEach((item, slot) => {
      if (item) hotbar.assign(slot, item);
    });
  }

  function giveStartingSupplies() {
    if ($gameSystem._ccStarterSuppliesGiven) return;
    $gameSystem._ccStarterSuppliesGiven = true;

    // Potions, tonics and the rolled food, on hotbar 1-3.
    giveStarterStaples();

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
  // the player took (full, normal, quick, random, creature, tutorial, preset). Doing it
  // here instead of at class confirmation also means the preset step's gold
  // wipe can no longer swallow it.
  // The class bonus is the raw <Money:> value: it used to be tripled (with a
  // 3000 gold floor) because only the first member ever received it, which is
  // no longer the case now that every member is paid.
  const CC_BASE_START_EUROS = 100;
  const CC_BASE_START_GOLD = CC_BASE_START_EUROS * 100; // 100 gold = €1

  // What the wealth band a character was raised in is worth on the day they
  // leave home, in gold, indexed by tier (destitute .. wealthy). It is money
  // they BRING, so it is added to the party purse alongside their class's
  // <Money:> and their traits', and every member pays in their own.
  //
  // The top of the band sits about where the richest classes do (CEO, €10,000):
  // being born to money is worth as much as having made it, and no more.
  const CC_WEALTH_START_GOLD = [0, 25000, 100000, 300000, 1000000];

  function classStartingMoney(classId) {
    const classData = $dataClasses[classId];
    const match = classData && classData.note && classData.note.match(/<Money:(\d+)>/i);
    return match ? Number(match[1]) : 0;
  }

  // A picked build is written to actor._selectedTraits as whole trait objects
  // by the trait plugin and as bare trait ids by the boards that pick them, and
  // reading it raw is how the two halves of creation stopped recognising each
  // other's picks: the board saw "[object Object]" where an id should be, so a
  // trait could be bought and never sold back. Nothing reads the field
  // directly any more, it comes through one of these two.
  function selectedTraitObjects(actor) {
    const bank = (window.Health && window.Health.Traits) || [];
    return ((actor && actor._selectedTraits) || [])
      .map((entry) => (entry && typeof entry === "object")
        ? entry
        : bank.find((t) => String(t.id) === String(entry)))
      .filter(Boolean);
  }

  function selectedTraitIds(actor) {
    return ((actor && actor._selectedTraits) || [])
      .map((entry) => (entry && typeof entry === "object") ? entry.id : entry)
      .filter((id) => id !== null && id !== undefined);
  }

  function traitStartingMoney(actor) {
    return selectedTraitObjects(actor).reduce((sum, trait) => sum + (Number(trait.money) || 0), 0);
  }

  // A member's wealth band, and what it pays in. Only the detailed editor asks
  // the question (profile.wealthTierChosen); a character who was never asked
  // brings nothing extra, so every other creation path is left exactly as it
  // was. The society store is read directly rather than through
  // NPCSocietyRegistry.getProfile, which would MINT a profile for a member who
  // has none , a whole rolled stranger, on the last step of creation, for an
  // answer that is only ever there when it was written by hand.
  function wealthStartingMoney(actor) {
    const society = $gameSystem && $gameSystem._npcSociety;
    const profile = actor && society ? society[actor.name()] : null;
    const tier = profile && profile.wealthTierChosen;
    if (tier == null) return 0;
    return CC_WEALTH_START_GOLD[Math.max(0, Math.min(4, tier))] || 0;
  }

  function giveStartingMoney() {
    if ($gameSystem._ccStartingMoneyGiven) return;
    $gameSystem._ccStartingMoneyGiven = true;

    let gold = CC_BASE_START_GOLD;
    $gameParty.members().forEach((actor) => {
      // A non-sentient creature (one of the creature classes, see NPCCreature)
      // brings nothing into the purse. It was never asked its wealth band , the
      // detailed editor does not offer the row to a beast , and it has no use
      // for what its class or its traits would otherwise have paid in. All
      // three contributions are dropped rather than only the band, so a
      // character switched to a creature class after the fact cannot carry a
      // banker's purse in on four legs.
      const NC = window.NPCCreature;
      if (NC && NC.isNonSentientActor(actor)) return;
      gold += classStartingMoney(actor._classId) +
        traitStartingMoney(actor) +
        wealthStartingMoney(actor);
    });
    $gameParty.gainGold(gold);
  }

  // The detailed editor names each wealth band with what it pays in, so the row
  // and the payout are read off one table.
  window.CharacterCreationMoney = {
    wealthGold(tier) {
      return CC_WEALTH_START_GOLD[Math.max(0, Math.min(4, Number(tier) || 0))] || 0;
    },
    formatWealth(tier) {
      const gold = this.wealthGold(tier);
      const shared = window.NPCShared;
      return shared && shared.formatMoney ? shared.formatMoney(gold) : String(gold);
    },
  };

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
  const resolveTraitName = (name, traitId) => {
    if (!name && !traitId) return null;
    if (typeof name === "object" && name !== null) {
      // A trait record that still carries its own pair rather than a key.
      const lang = (typeof ConfigManager !== 'undefined' && ConfigManager.language) || (typeof T !== 'undefined' && T.language ? T.language() : "en");
      return lang === "it" ? (name.it || name.en) : name.en;
    }
    const lang = (typeof ConfigManager !== 'undefined' && ConfigManager.language) || (typeof T !== 'undefined' && T.language ? T.language() : "en");
    const bank = (lang === "it" ? _traitI18nData : _traitI18nDataEn) || _traitI18nData;
    const key = String(traitId || name || "").toLowerCase().replace(/[-\s]/g, "_");
    if (bank && bank.traits && bank.traits[key] && bank.traits[key].name) {
      return bank.traits[key].name;
    }
    if (typeof name === "string" && name.includes(".")) {
      const localized = resolveI18nPath(name, _traitI18nData);
      if (localized) return localized;
      const english = resolveI18nPath(name, _traitI18nDataEn);
      if (english) return english;
    }
    return name || traitId;
  };

  // Resolve a single trait description value to its display string.
  const resolveTraitDesc = (desc, traitId) => {
    if (typeof desc === "object" && desc !== null) {
      const lang = (typeof ConfigManager !== 'undefined' && ConfigManager.language) || (typeof T !== 'undefined' && T.language ? T.language() : "en");
      return lang === "it" ? (desc.it || desc.en) : desc.en;
    }
    const lang = (typeof ConfigManager !== 'undefined' && ConfigManager.language) || (typeof T !== 'undefined' && T.language ? T.language() : "en");
    const bank = (lang === "it" ? _traitI18nData : _traitI18nDataEn) || _traitI18nData;
    const key = String(traitId || "").toLowerCase().replace(/[-\s]/g, "_");
    if (bank && bank.traits && bank.traits[key] && bank.traits[key].description) {
      return bank.traits[key].description;
    }
    if (typeof desc === "string" && desc.includes(".")) {
      const localized = resolveI18nPath(desc, _traitI18nData);
      if (localized) return localized;
      const english = resolveI18nPath(desc, _traitI18nDataEn);
      if (english) return english;
    }
    return desc || "";
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

  // CC_MUSIC_TRACKS plus any player tracks dropped into audio/bgm/BattleMusic,
  // led by the Biome and Random entries so a pick made in the options menu still
  // reads back here instead of silently showing the first track. Biome is the
  // default battle music, so it heads the list.
  // Resolved at runtime since MusicSelectionSystem.js loads after this plugin.
  function getCCMusicTracks() {
    const mss = window.MusicSelectionSystem;
    const custom = (mss && mss.scanCustomTracks) ? mss.scanCustomTracks() : [];
    const biome = (mss && mss.MUSIC_BIOME)
      ? [{ name: T('MusicSelection.trackBiome'), value: mss.MUSIC_BIOME }]
      : [];
    const random = (mss && mss.MUSIC_RANDOM)
      ? [{ name: T('MusicSelection.trackRandom'), value: mss.MUSIC_RANDOM }]
      : [];
    return biome.concat(random, ccMusicTracks(), custom);
  }

  // No origin begins inside a vehicle any more: the camper and the car are
  // parked out in the world with the party standing beside them (see
  // startVehicleOrigin), so their interiors are somewhere to climb into rather
  // than somewhere to wake up. Nor does any origin end on world map 315 — the
  // ones that begin "somewhere in the world" begin on the ground of that
  // somewhere (startOnProceduralSquare). The space origin is the one exception
  // to both, and it is not on Earth at all.
  const GAME_START_MAP_ID = 557; // the map every new game / permadeath reset lands on

  // Full creation mode is disabled for now: the "Full" choice is hidden from the
  // creationMode step and every flow behaves as Normal (so the Full-only flavor
  // steps, hometown and birthdate, never come up). Flip this back to true to
  // restore the mode; nothing else needs changing.
  const FULL_CREATION_MODE_ENABLED = false;

  // --- Creation modes ------------------------------------------------------
  // How much of the wizard a party walks through. The value is persisted on
  // $gameSystem._ccCreationMode, since the mode step is asked once per party
  // and every later member has to be built the same way.
  //
  //   QUICK     three questions , name, sprite, class , and nothing else.
  //             Gender and body archetype are read off the chosen sprite's
  //             NPCs.json record, the bust is the one that sprite comes with
  //             (never browsed), traits are rolled. A creature is asked for its
  //             archetype(s), its monster sprite and its class, and wears the
  //             3D look that belongs to that sprite.
  //   NORMAL    the wizard's ordinary per-character flow. This is the mode
  //             that used to be called Quick.
  //   FULL      the detailed life sim (FULL_CREATION_MODE_ENABLED).
  //   DETAILED  the Empathize dossier editor (CharacterCreationFull.js).
  const CC_MODE = {
    QUICK: "quick",
    NORMAL: "normal",
    FULL: "full",
    DETAILED: "detailed",
  };

  // Saves written before the fast Quick mode existed stored the (then only)
  // board flow under the name "quick"; that flow is called Normal now. The
  // stamp below is written beside every mode chosen since, so an old save is
  // read as Normal rather than silently switching to the three-question wizard.
  const CC_MODE_STAMP = 2;

  function storedCreationMode() {
    if (!$gameSystem || !$gameSystem._ccCreationMode) return null;
    const mode = $gameSystem._ccCreationMode;
    if (mode === CC_MODE.QUICK && $gameSystem._ccCreationModeStamp !== CC_MODE_STAMP) {
      return CC_MODE.NORMAL;
    }
    return mode;
  }

  function setCreationMode(mode) {
    Scene_CharacterCreation._creationMode = mode;
    $gameSystem._ccCreationMode = mode;
    $gameSystem._ccCreationModeStamp = CC_MODE_STAMP;
  }

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
  const ITEM_EMPTY_SPELLBOOK = 262;   // arcanist (to copy what they learn into)
  const ITEM_TELESCOPE = 150;         // mercenary / space / crash / stranded (reading a distance before crossing it)
  const ITEM_SKELETON_KEY = 739;      // skeleton key holder (the whole loadout)
  const ITEM_ONU_TERMINAL = 379;      // diplomat (remote access into the assembly)

  // --- Beginning out in the world ----------------------------------------
  // No origin ends its wizard standing on the world map (315). The world map is
  // the thing you look at a journey on, not a place to be put down in: an origin
  // that begins "somewhere in the world" begins INSIDE that somewhere, on the
  // procedural square at those world coordinates, exactly as walking onto the
  // square from the map would put you there. The space origin is the one
  // exception in the whole table, and it is not on Earth at all.
  //
  // Answers false when the square could not be built, so a caller can fall back
  // rather than reserving a transfer into an empty map.
  const PROC_MAP_START = { x: 32, y: 32 }; // centre of the 64x64 procedural map

  function proceduralMapId() {
    return (window.WorldMapReturn && window.WorldMapReturn.procMapId) || 636;
  }

  function startOnProceduralSquare(options) {
    if (!$gameSystem || !$gameSystem.generateOriginBiomeMap) return false;
    const built = $gameSystem.generateOriginBiomeMap(options || {});
    if (!built) return false;
    // The square that was actually built is where this party is from, whether
    // it was named by the origin or rolled here (see the start anchor above).
    anchorAt(built.worldX, built.worldY);
    // The two "the procedural map is live" flags WorldMapReturn's startProcGen
    // raises; without them the square loads as a dead map with no borders and
    // no way back out to the world map.
    $gameVariables.setValue(110, 1);
    $gameVariables.setValue(111, 1);
    // The centre is only where the party is aimed. Which tile they are actually
    // set down on is settled once the square exists (ccPlaceOnPassableTile).
    if ($gameTemp) $gameTemp._ccProcSquareLanding = true;
    $gamePlayer.reserveTransfer(proceduralMapId(), PROC_MAP_START.x, PROC_MAP_START.y, 2, 0);
    return true;
  }

  // Camper / car origin: the party wakes up beside their vehicle out in the
  // world, not sitting inside it and not at a city they were asked to name. A
  // procedural square is built for them (the same landing the bike origin gets)
  // and VehicleSystem parks the vehicle on a passable tile next to the player
  // once the map has loaded, unmounted, so the first thing they do is decide
  // whether to get in. The keys item comes from the origin's own loadout.
  //
  // `kind` is one of the flags VehicleSystem answers to: "camper" (the ship
  // slot), "car" or "bike" (the boat slot, via $gameSystem._boatType).
  function startVehicleOrigin(kind) {
    if ($gameTemp) $gameTemp._ccVehicleFieldStart = kind;
    if (startOnProceduralSquare({ rng: Math.random })) return;
    // Nothing could be generated (no biome data at all): the tower gate is the
    // one landing that needs no world behind it.
    if ($gameTemp) $gameTemp._ccVehicleFieldStart = null;
    console.warn(`CharacterCreation: no overland square for the ${kind} origin; starting at the tower gate instead.`);
    startDungeonOrigin();
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
    // Same landing as the camper origin: keys, and the van parked beside them.
    startVehicleOrigin("camper");
  }

  // CEO origin: start rich and in charge. Hand the party €1,000,000 in cash
  // (100 gold = €1) and a controlling 80% stake in LimeCorp registered on the
  // company exchange (RealEstateMarket via window.AssetRegistry), then drop the
  // player into the LimeCorp HQ (map 1036) at 25,31 facing down. The same stake
  // is what the stock terminal shows under the LIME ticker: both screens read
  // the one share register.
  const CEO_START_EUROS = 1000000;           // €1,000,000
  const CEO_START_GOLD = CEO_START_EUROS * 100; // 100 gold = €1
  const CEO_COMPANY_KEY = "LimeCorp";
  const CEO_OWNERSHIP = 0.8;                  // 80% controlling stake
  const CEO_START = { mapId: 1036, x: 25, y: 31, dir: 2 }; // facing down
  const CEO_PLACE = "Ghent";                  // HQ's town: the anchor's world square

  function startCEOOrigin() {
    $gameParty.gainGold(CEO_START_GOLD);

    // Grant an 80% stake in LimeCorp. giveShares needs a share count, so read
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

    // Home ground is the town the HQ stands in.
    anchorAtPlace(CEO_PLACE, { x: 84, y: 120 });
    $gamePlayer.reserveTransfer(CEO_START.mapId, CEO_START.x, CEO_START.y, CEO_START.dir, 0);
  }

  // Bike origin: give the bike item and drop the player into a RANDOM non-ocean
  // procedural biome (never onto the world map). Unlike the camper and the car
  // the square is picked from the world seed, so a bike start lands in the same
  // place every time in a given world. VehicleSystem places the player in a
  // passable 4x4 zone with the bike beside them on map load (see
  // _ccVehicleFieldStart handling there).
  function startBikeOrigin() {
    $gameSystem._boatType = "bike";
    if ($gameTemp) $gameTemp._ccVehicleFieldStart = "bike";

    const built = $gameSystem.generateRandomBikeBiomeMap
      ? $gameSystem.generateRandomBikeBiomeMap() : null;
    if (built) {
      // The seeded square the bike rolled is this party's home ground.
      anchorAt(built.worldX, built.worldY);
      // Proc map is 64x64; aimed at the center. VehicleSystem repositions the
      // player into a passable 4x4 zone once the map is loaded, and
      // ccPlaceOnPassableTile catches them if it cannot find one.
      $gameVariables.setValue(110, 1);
      $gameVariables.setValue(111, 1);
      if ($gameTemp) $gameTemp._ccProcSquareLanding = true;
      $gamePlayer.reserveTransfer(proceduralMapId(), PROC_MAP_START.x, PROC_MAP_START.y, 2, 0);
      return;
    }
    if ($gameTemp) $gameTemp._ccVehicleFieldStart = null;
    console.warn("CharacterCreation: no overland square for the bike origin; starting at the tower gate instead.");
    startDungeonOrigin();
  }

  // Full Automation origin: a RANDOM land square of the world, standing on the ground
  // of it, with 4x the usual pile of crafting materials (handed out by the origin's
  // loadout), and every party member trained in the full spectrum of crafting
  // specializations used by the Thinker and Blacksmithing systems.
  const MATERIAL_ITEM_ID_MIN = 849; // first <category:Crafting> material
  const MATERIAL_ITEM_ID_MAX = 871; // last  <category:Crafting> material
  const EMPTY_LOT_MATERIAL_QTY = 160; // of every material (4x)

  // Crafting specializations granted by the Full Automation origin.
  // These cover everything the Thinker system (Fabrication, Weaponsmithing, Armor Smithing, Carpentry,
  // Metalworking, Cooking, Alchemy, Electronics) and the Blacksmithing system (Bladesmithing, Tailoring,
  // Leatherworking, Jewelry Making, Gunsmithing, etc.) use.
  const CRAFTING_SPEC_IDS = [
    20,   // Armor Smithing     (Crafting) — Blacksmithing main
    321,  // Bladesmithing      (Crafting) — Blacksmithing main
    40,   // Blacksmithing      (Crafting) — Blacksmithing main
    102,  // Fabrication        (Crafting) — Thinker main bench
    807,  // Weaponsmithing     (Crafting) — Thinker weapons
    58,   // Carpentry          (Crafting) — Thinker lifestyle / building
    269,  // Tailoring          (Crafting) — Blacksmithing armor
    157,  // Leatherworking     (Crafting) — Blacksmithing armor
    176,  // Metalworking       (Crafting) — Thinker tools / building
    643,  // Jewelry Making     (Crafting) — Blacksmithing accessories
    616,  // Gunsmithing        (Crafting) — Blacksmithing ranged
    540,  // CNC Machining      (Crafting) — precision fabrication
    121,  // Glassblowing       (Crafting) — artisan goods
    215,  // Pottery            (Crafting) — artisan goods
    287,  // Upholstery         (Crafting) — furniture
    460,  // Underwater Welding (Crafting) — advanced fabrication
    309,  // Alchemy            (Arcana)   — Thinker potions / magic items
    49,   // Brewing            (Culinary) — Thinker beverages
    75,   // Cooking            (Culinary) — Thinker food
    328,  // Campfire Cooking   (Culinary) — survival food
    98,   // Electronics        (Science)  — Thinker espionage / gadgets
  ];

  function startEmptyLotOrigin() {
    // Grant every party member randomized medium-high levels in all crafting
    // specializations used by the Thinker and Blacksmithing systems.
    const members = $gameParty.members();
    members.forEach(actor => {
      if (!actor || !actor.setSpecializationTrainedLevel) return;
      CRAFTING_SPEC_IDS.forEach(specId => {
        // Randomize level between 3 (Advanced) and 5 (Master)
        const level = 3 + Math.floor(Math.random() * 3);
        actor.setSpecializationTrainedLevel(specId, level);
      });
    });
    if (startOnProceduralSquare({ rng: Math.random })) return;
    console.warn("CharacterCreation: no overland square for the Full Automation origin; starting at the tower gate instead.");
    startDungeonOrigin();
  }

  // Stranded origin: drop the party on foot on the ground of a RANDOM one of
  // these hand-picked world squares — remote spots scattered across the map,
  // with nothing but the castaway kit its loadout lists. Every one of them is a
  // land square (Fields / ForestTropical / Mountain / City); never add an Ocean
  // coordinate here. A square that drifts over water after a world-map repaint
  // simply fails to build, and the castaway is rolled somewhere else instead.
  const STRANDED_COORDS = [
    { x: 115, y: 89 }, { x: 84, y: 46 }, { x: 86, y: 50 }, { x: 85, y: 53 },
    { x: 71, y: 61 }, { x: 67, y: 63 }, { x: 69, y: 64 }, { x: 70, y: 68 },
    { x: 213, y: 230 }, { x: 220, y: 234 }, { x: 8, y: 225 }, { x: 49, y: 145 },
    { x: 57, y: 149 }, { x: 119, y: 182 }, { x: 121, y: 184 }, { x: 131, y: 216 },
    { x: 120, y: 228 },
  ];

  // The castaway is measured from the shore they washed up on, like everybody
  // else is measured from where they began: startOnProceduralSquare anchors the
  // square it builds, so the coast the party opens their eyes on is level 1
  // ground and the world grows more dangerous the further inland they walk. It
  // used to be pinned to the space center instead - the place they were trying
  // to reach - which put a party that landed on 213,230 half a world away from
  // its own anchor and opened the game on level 79 wildlife.
  function startStrandedOrigin() {
    const spot = STRANDED_COORDS[Math.floor(Math.random() * STRANDED_COORDS.length)];
    if (startOnProceduralSquare({ worldX: spot.x, worldY: spot.y })) return;
    // The written square is no longer land (or there is no biome data for it):
    // any other coast will do for somebody who did not choose this one either.
    if (startOnProceduralSquare({ rng: Math.random })) return;
    console.warn("CharacterCreation: no overland square for the stranded origin; starting at the tower gate instead.");
    startDungeonOrigin();
  }

  // --- The start anchor ----------------------------------------------------
  // The world square the "Distance from spawn" encounter mode measures this
  // party's whole world from (BattleSystemEnhancedEncounters, getStartAnchor):
  // level 1 standing on it, the top of the roster at the farthest square from
  // it. It belongs to the savegame, it is written once, and nothing that
  // happens afterwards moves it - so EVERY origin states it here, at the moment
  // it settles where the party begins, rather than leaving the encounter system
  // to pick it up off whichever map happens to load first. An origin that says
  // nothing is an origin measured from a square it may never have stood on.
  //
  // Three kinds of answer, one per kind of landing:
  //   anchorAt(x, y)        a square this origin knows now - the procedural
  //                         square it just built, or the world tile of the
  //                         authored map it is transferring into.
  //   anchorAtSpaceCenter() the two starts that never stand on an Earth square
  //                         at all (space, crash-landed): the Green Witch Space
  //                         Center, the pad they lifted off from or were trying
  //                         to get back to.
  //   deferred              the picker origins, which do not know where they
  //                         are going until the player says: FastTravelSystem
  //                         writes the anchor as it lands them (ccAnchorStart).
  //
  // captureStartAnchor over in the encounter plugin stays as the net under all
  // of it (a preset dossier, the tutorial, a save whose origin predates this),
  // and it never overwrites an anchor that is already set.
  function anchorAt(x, y) {
    const BSEH = window.BattleSystemEnhanced && window.BattleSystemEnhanced.Helpers;
    if (BSEH && typeof BSEH.setStartAnchor === "function") {
      BSEH.setStartAnchor(x, y);
    }
  }

  function anchorAtSpaceCenter() {
    const BSEH = window.BattleSystemEnhanced && window.BattleSystemEnhanced.Helpers;
    if (BSEH && typeof BSEH.anchorAtSpaceCenter === "function") {
      BSEH.anchorAtSpaceCenter();
    }
  }

  // The world square of a named place, for the origins that transfer straight
  // into an authored map. Read from the shared destination table (the same
  // `base` the encounter plugin resolves a map's <MapGroup> through), so moving
  // a town on the world map moves the anchor of the origins that begin in it,
  // and the fallback only stands in when the table has not been published yet.
  function anchorAtPlace(key, fallback) {
    const dest = window.WorkSystem && window.WorkSystem.Destinations;
    const entry = dest && dest[key];
    const base = entry && entry.base;
    if (base && typeof base.x === "number" && typeof base.y === "number") {
      anchorAt(base.x, base.y);
      return;
    }
    if (fallback) anchorAt(fallback.x, fallback.y);
  }

  // The Omega Tower's own world square: where every origin is anchored once
  // Earth is gone and the tower is the only ground left (startAtOmegaTower).
  function anchorAtOmegaTower() {
    const BSEH = window.BattleSystemEnhanced && window.BattleSystemEnhanced.Helpers;
    if (BSEH && typeof BSEH.getOmegaTowerCoords === "function") {
      const c = BSEH.getOmegaTowerCoords();
      if (c) anchorAt(c.x, c.y);
    }
  }

  // Mayor origin: a huge stockpile (50x of every crafting material, handed out
  // by the loadout) and the choice of a starting city through the picker. The
  // mayor arrives on foot and with nothing to drive: see
  // startWorldMapPickerOrigin for where the picked place actually puts them.
  const MAYOR_MATERIAL_QTY = 50; // of every material (id 849-871)

  // --- Beginning after the end -------------------------------------------
  // Every origin below is written to put the party somewhere on Earth, and in a
  // world begun after 21 December 2012 there is no Earth to put them on (switch
  // 199, WorldMapTransfer.earthLost). What each origin GRANTS still stands - the
  // CEO is still rich, the warlord still has an army - but where it was going
  // does not exist, so they all begin in the same place: the Omega Tower, the
  // only ground left. Called after the origin's own branch has run, so the
  // grants happen first and only the destination is overruled.
  function startsAtOmegaTower() {
    const WMT = window.WorldMapTransfer;
    return !!(WMT && WMT.earthLost && WMT.earthLost());
  }

  function startAtOmegaTower() {
    const WMT = window.WorldMapTransfer;
    const t = (WMT && WMT.towerLanding)
      ? WMT.towerLanding() : { mapId: 635, x: 13, y: 38, dir: 8 };
    if ($gameTemp) {
      // Every "say where you begin" flag names a place on a planet that is not
      // there, and so does the vehicle that would have been parked beside the
      // party on one of its squares.
      $gameTemp._openCharacterCreationTrainTravel = false;
      $gameTemp._characterCreationTravelMode = false;
      $gameTemp._characterCreationTravelType = null;
      $gameTemp._ccVehicleFieldStart = null;
    }
    // Runs after the origin's own branch, and overrules its anchor along with
    // its destination: a square of a planet that is not there is not where this
    // party is from. The tower is, because it is the only place left.
    anchorAtOmegaTower();
    $gamePlayer.reserveTransfer(t.mapId, t.x, t.y, t.dir, 0);
  }

  // The full destination picker: the camper network lists every place on the
  // map, and FastTravelSystem's plain character-creation transfer walks the
  // party into the place they picked , through its own door where it has one,
  // and onto the ground of its own square where it has not (ccCreationLanding
  // there). Never onto the world map itself. Shared by every origin that begins
  // nowhere in particular but still lets the player say where.
  function startWorldMapPickerOrigin() {
    if (!$gameTemp) return;
    // Nothing to pick from: the cities went with the planet. This also catches
    // the faction origins, which come back through here after their own picker.
    if (startsAtOmegaTower()) { startAtOmegaTower(); return; }
    $gameTemp._openCharacterCreationTrainTravel = true;     // opens the picker
    $gameTemp._characterCreationTravelType = "camper";      // full city list, world-map landing
    $gameTemp._characterCreationTravelMode = true;          // free, uncancellable
  }

  function startMayorOrigin() {
    startWorldMapPickerOrigin();
  }

  // --- Backing out of the starting place picker ----------------------------
  // Picking an origin is not only a line in a menu: by the time the picker
  // opens the gear has been handed out, the cash paid, the troops recruited and
  // the switches set. So "back to the origin list" cannot simply close the
  // picker, it has to undo the choice, and the cheapest honest way to undo
  // something this wide is to keep a copy of everything it is about to touch.
  // The copy is taken at the top of the origin handler, before a single grant
  // runs, and put back when the player asks for the list again.
  //
  // Only the persistent game objects are copied. The map and the player are
  // deliberately left alone: no picker origin reserves a transfer, so the party
  // is still standing where the wizard left it and the running scene keeps
  // pointing at objects that are still valid.
  const ORIGIN_SNAPSHOT_GLOBALS = [
    "$gameSystem", "$gameSwitches", "$gameVariables", "$gameActors", "$gameParty",
    // Not every world has these: the army and faction ledgers are their own
    // plugins' globals, and the warlord, the faction leader and the deserter all
    // write to them.
    "$gameArmy", "$gameFactions",
  ];

  function captureOriginSnapshot() {
    if (!$gameTemp) return;
    const snapshot = {};
    try {
      for (const key of ORIGIN_SNAPSHOT_GLOBALS) {
        const value = window[key];
        if (value) snapshot[key] = JsonEx.stringify(value);
      }
    } catch (e) {
      console.warn("CharacterCreation: could not copy the state the origin is about to change; backing out of the starting place picker will be unavailable.", e);
      $gameTemp._ccOriginSnapshot = null;
      return;
    }
    $gameTemp._ccOriginSnapshot = snapshot;
  }

  function clearOriginSnapshot() {
    if ($gameTemp) $gameTemp._ccOriginSnapshot = null;
  }

  // True while the origin just chosen can still be taken back.
  function canReopenOriginStep() {
    return !!($gameTemp && $gameTemp._ccOriginSnapshot);
  }

  // Puts the world back the way it stood before the origin was chosen and
  // reopens the origin step. Answers whether it could.
  function reopenOriginStep() {
    if (!canReopenOriginStep()) return false;
    const snapshot = $gameTemp._ccOriginSnapshot;
    clearOriginSnapshot();
    try {
      for (const key of ORIGIN_SNAPSHOT_GLOBALS) {
        if (snapshot[key]) window[key] = JsonEx.parse(snapshot[key]);
      }
    } catch (e) {
      console.error("CharacterCreation: could not undo the chosen origin.", e);
      return false;
    }
    // Every flag that was pointing the player at a starting place, including the
    // one that reopens the picker on the next map frame.
    $gameTemp._openCharacterCreationTrainTravel = false;
    $gameTemp._characterCreationTravelMode = false;
    $gameTemp._characterCreationTravelType = null;
    $gameTemp._ccVehicleFieldStart = null;
    $gamePlayer.refresh();
    Scene_CharacterCreation._isCreatureMode = false;
    Scene_CharacterCreation._creationMode =
      storedCreationMode() || Scene_CharacterCreation._creationMode;
    Scene_CharacterCreation.clearSubScreens();
    Scene_CharacterCreation._interruptedStep = -1;
    Scene_CharacterCreation.prepare(STEP.ORIGIN);
    SceneManager.push(Scene_CharacterCreation);
    return true;
  }

  // FastTravelSystem draws the picker and owns its Back button, so it asks here
  // whether there is an origin to go back to, and says when there is no longer
  // one (the journey was confirmed, the origin stands).
  window.CharacterCreationOrigin = {
    canReopen: canReopenOriginStep,
    reopen: reopenOriginStep,
    clearSnapshot: clearOriginSnapshot,
  };

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
      { id: ITEM_TELESCOPE, qty: 1 },
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
      { id: ITEM_TELESCOPE, qty: 1 },
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
      { id: ITEM_TELESCOPE, qty: 1 },
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
    // Walked out of a clinic with the hardware still settling: painkillers to
    // live with it, spray for what is still open, and a scalpel to work on
    // each other with when the next one goes wrong.
    origin_augmented: [
      { id: ITEM_PAINKILLERS, qty: 3, each: true },
      { id: ITEM_MEDICAL_SPRAY, qty: 2, each: true },
      { id: ITEM_OINTMENT, qty: 2, each: true },
      { id: ITEM_NANITES, qty: 1, each: true },
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_PORTABLE_CHARGER, qty: 1 },
    ],
    // A collector travels light: the cards are not items, so the kit is only
    // what it takes to get from one table to the next.
    origin_card_collector: [
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_TRAVEL_JOURNAL, qty: 1 },
      { id: ITEM_RATION_BAR, qty: 2, each: true },
      { id: ITEM_CALMING_TEA, qty: 2, each: true },
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
    // A working library and the light to read it by. Everything else the
    // arcanist carries is dealt from the shelves (see rollArcanistLoadout).
    origin_arcanist: [
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_EMPTY_SPELLBOOK, qty: 1, each: true },
      { id: ITEM_CANDLE, qty: 2 },
      { id: ITEM_MANA_POTION, qty: 2, each: true },
      { id: ITEM_CALMING_TEA, qty: 2, each: true },
    ],
    // A soldier for hire keeps the boring half of the kit the same whoever is
    // paying: map, glass, whetstone, rations. The guns and the medicine are
    // whatever the last contract left in the bag (see rollMercenaryLoadout).
    origin_mercenary: [
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_TELESCOPE, qty: 1 },
      { id: ITEM_WHETSTONE, qty: 1 },
      { id: ITEM_FIELD_RATION, qty: 3, each: true },
      { id: ITEM_SPRING_WATER, qty: 2, each: true },
    ],
    // Put down somewhere nobody chose, with the rite still warm. The kit is
    // what was in reach when it went wrong: candles, chalk, a bedroll and
    // enough water to work out where the nearest road is. The staff, the robe
    // and the foci are rolled (see rollLostConvokerLoadout).
    origin_lost_convoker: [
      { id: ITEM_CANDLE, qty: 3 },
      { id: ITEM_EMPTY_SPELLBOOK, qty: 1, each: true },
      { id: ITEM_MANA_POTION, qty: 2, each: true },
      { id: ITEM_BEDROLL, qty: 1 },
      { id: ITEM_FIELD_RATION, qty: 3, each: true },
      { id: ITEM_SPRING_WATER, qty: 3, each: true },
    ],
    // One key and nothing else. Deliberately the thinnest loadout in the table:
    // no rations, no potions, no light. Whoever carries this walked out of
    // somewhere with the only thing worth taking, and everything else has to be
    // opened, taken or bought on the way.
    origin_skeleton_key: [
      { id: ITEM_SKELETON_KEY, qty: 1 },
    ],
    // One energy drink, and a bag of Hyperdeck parts rolled on top of it (see
    // rollHypernetExplorerLoadout). No rations, no light, no map: whoever this
    // is has been buying components instead of food.
    origin_hypernet_explorer: [
      { id: ITEM_ENERGY_DRINK, qty: 1, each: true },
    ],
    // A seat at the assembly, worked from a distance: one terminal, nothing else.
    origin_diplomat: [
      { id: ITEM_ONU_TERMINAL, qty: 1 },
    ],
    // The case itself is rolled off the disease shelf (rollPlagueSpreaderLoadout);
    // this is what it is carried in and what the carrier takes when a seal goes.
    // Nobody handles that many vials without expecting to open one by accident.
    origin_plague: [
      { id: ITEM_TRAVEL_BACKPACK, qty: 1 },
      { id: ITEM_LOCAL_MAP, qty: 1 },
      { id: ITEM_EMPTY_FLASK, qty: 1 },
      { id: ITEM_HEALTH_POTION, qty: 2, each: true },
      { id: ITEM_MEDICAL_SPRAY, qty: 2, each: true },
      { id: ITEM_PAINKILLERS, qty: 3, each: true },
      { id: ITEM_OINTMENT, qty: 2, each: true },
    ],
  };

  // --- The origin's own three, on hotbar 4-6 ------------------------------
  // Slots 1-3 are the same everywhere (potion, tonic, food; see
  // giveStarterStaples). Slots 4-6 are where the origin speaks: the three
  // things from ITS kit that a player of that start reaches for first — the
  // bike for the cyclist, the flashlight and rope for the delver, the escape
  // kit for the wanted.
  //
  // Every id below must be map-usable, i.e. occasion "always" (0) or "outside
  // battle" (2), because that is all the favourites bar accepts. This still
  // rules out a few origins' signature objects: the lockpick, the cooking pot,
  // the utensil set and the skeleton key are occasion "never", and the
  // ballpoint pen and resonance scanner are battle-only — so those origins
  // field their next-best three instead.
  // Staples are never repeated here; bindOriginFavorites skips anything already
  // sitting on slots 1-3.
  // Run auditOriginFavorites() from the console after editing this table.
  const ORIGIN_FAVORITES = {
    // Reading the line, sleeping on it, patching yourself up on it.
    origin_train: [ITEM_LOCAL_MAP, ITEM_BEDROLL, ITEM_MEDICAL_SPRAY],
    // Orbit: call the ship down, know where you are, talk to it.
    origin_space: [ITEM_LOW_ORBIT_PIN, ITEM_STAR_MAP, ITEM_PILOT_PDA],
    // The camper itself, what moves it, and where you sleep in it.
    origin_camper: [ITEM_LIMINAL_CUFFS, ITEM_FUEL_TANK, ITEM_SLEEPING_BAG],
    // The car itself, what moves it, and what tells it where to go.
    origin_car: [ITEM_CAR, ITEM_FUEL_TANK, ITEM_GPS],
    // The bike, the patch kit that keeps it rolling, and the bottle.
    origin_bike: [ITEM_BIKE, ITEM_SEWING_KIT, ITEM_WATER_BOTTLE],
    // Breaking ground: dig it, build it, carry it.
    origin_lot: [ITEM_SHOVEL, ITEM_TOOLMAKER_MULTITOOL, ITEM_CRAFTSMAN_BACKPACK],
    // Governing: take the note, give the speech, know the ward.
    origin_mayor: [ITEM_POCKET_NOTEBOOK, ITEM_ORATORS_ELIXIR, ITEM_LOCAL_MAP],
    // Delving: light first, rope second, the way out third.
    origin_dungeon: [ITEM_FLASHLIGHT, ITEM_CLIMBING_ROPE, ITEM_ROUTES_MAP],
    // Wanted: the way out, the untraceable call, the way past a lock.
    origin_criminal: [ITEM_ESCAPE_KIT, ITEM_BURNER_PHONE, ITEM_LIMINAL_CUFFS],
    // Castaway: get off the shore, catch dinner, carry water.
    origin_stranded: [ITEM_INFLATABLE_DINGHY, ITEM_FISHING_ROD, ITEM_EMPTY_FLASK],
    // Sealed cellar: light, power, and something to dig out with.
    origin_bunker: [ITEM_FLASHLIGHT, ITEM_PORTABLE_CHARGER, ITEM_SHOVEL],
    // Corner office: the phone, the watch, and the coffee holding it together.
    origin_ceo: [ITEM_CELLPHONE, ITEM_WRISTWATCH, ITEM_DEADLINE_COFFEE],
    // Inheritance: the lens, the amber, and the journal to write it all down.
    origin_artifact: [ITEM_LENS_OF_REVELATION, ITEM_MEMORY_AMBER, ITEM_TRAVEL_JOURNAL],
    // Wreck: call the ship down, fix what is left, see in the dark.
    origin_crash: [ITEM_LOW_ORBIT_PIN, ITEM_MULTITOOL, ITEM_FLASHLIGHT],
    // Warband: keep the edge, hit harder, feel none of it.
    origin_warlord: [ITEM_WHETSTONE, ITEM_FIGHTERS_BOOSTER, ITEM_MORPHINE],
    // Quartermaster: the rope, the stone, the map of what you hold.
    origin_faction_leader: [ITEM_ELVEN_ROPE, ITEM_WHETSTONE, ITEM_LOCAL_MAP],
    // Fresh implants: the nanites, the spray, and the charge they run on.
    origin_augmented: [ITEM_NANITES, ITEM_MEDICAL_SPRAY, ITEM_PORTABLE_CHARGER],
    // Between tables: the journal of who plays where, the map, the tea.
    origin_card_collector: [ITEM_TRAVEL_JOURNAL, ITEM_LOCAL_MAP, ITEM_CALMING_TEA],
    // Gone AWOL: the kit, the stick, and the road home.
    origin_deserter: [ITEM_ESCAPE_KIT, ITEM_WALKING_STICK, ITEM_LOCAL_MAP],
    // The library on the move: what to write in, what to cast with, the light.
    origin_arcanist: [ITEM_EMPTY_SPELLBOOK, ITEM_MANA_POTION, ITEM_CANDLE],
    // Hired: read the field, keep the edge, know the ground.
    origin_mercenary: [ITEM_TELESCOPE, ITEM_WHETSTONE, ITEM_LOCAL_MAP],
    // Rite gone wrong: cast again, light it, and sleep somewhere.
    origin_lost_convoker: [ITEM_MANA_POTION, ITEM_CANDLE, ITEM_BEDROLL],
    // Deliberately empty: the key is the whole loadout and it is occasion
    // "never", so there is nothing here the bar can hold. Slots 4-6 stay free,
    // which suits a start that has to take everything else off somebody.
    origin_skeleton_key: [],
    // Carrying it: seal what leaks, and treat what you catch.
    origin_plague: [ITEM_MEDICAL_SPRAY, ITEM_PAINKILLERS, ITEM_EMPTY_FLASK],
    // Nothing but the drink: components are occasion "never", so there is
    // nothing else in this loadout the quick bar can hold.
    origin_hypernet_explorer: [ITEM_ENERGY_DRINK],
    // One terminal is the whole seat; nothing else to reach for.
    origin_diplomat: [ITEM_ONU_TERMINAL],
  };

  // Slots 4-6, zero-based. Slots 1-3 belong to the staples.
  const ORIGIN_FAVORITE_FIRST_SLOT = 3;

  /**
   * Put an origin's three signature items on hotbar slots 4-6.
   * A build without ItemSystemHotbar simply gets the items.
   * @param {string} symbol - Origin symbol, e.g. "origin_bike"
   */
  function bindOriginFavorites(symbol) {
    const hotbar = window.ItemHotbar;
    if (!hotbar) return;
    let slot = ORIGIN_FAVORITE_FIRST_SLOT;
    (ORIGIN_FAVORITES[symbol] || []).forEach((id) => {
      const item = $dataItems[id];
      if (!item || !hotbar.isFavoritable(item)) {
        console.warn(`CharacterCreation: origin favourite ${id} (${symbol}) is missing or not map-usable.`);
        return;
      }
      // Assigning an item that is already on the bar VACATES its old slot, so a
      // pick that duplicates a staple would empty slot 1-3 rather than fill 4-6.
      if (hotbar.slotOf(item) >= 0) return;
      hotbar.assign(slot, item);
      slot++;
    });
  }

  /**
   * Check every ORIGIN_FAVORITES row against the origin it belongs to and
   * report what a player would not actually get. Run from the console after
   * editing the table.
   * @returns {array} Offending { origin, problems } rows
   */
  function auditOriginFavorites() {
    const offenders = [];
    Object.keys(ORIGIN_LOADOUTS).forEach((symbol) => {
      const picks = ORIGIN_FAVORITES[symbol];
      const problems = [];
      if (!picks) {
        problems.push("no favourites row");
      } else {
        const granted = {};
        (ORIGIN_LOADOUTS[symbol] || []).forEach((entry) => {
          if (!entry.kind || entry.kind === "item") granted[entry.id] = true;
        });
        picks.forEach((id) => {
          const item = $dataItems[id];
          if (!item || !item.name || !item.name.trim()) {
            problems.push(`item ${id} missing`);
            return;
          }
          // The bar only takes occasion 0 / 2; anything else silently no-ops.
          if (item.occasion !== 0 && item.occasion !== 2) {
            problems.push(`${item.name} is not usable on the map (occasion ${item.occasion})`);
          }
          if (!granted[id]) problems.push(`${item.name} is not in the origin's loadout`);
          if (id === STARTER_HEALING_POTION[0] || id === STARTER_MANA_TONIC[0]) {
            problems.push(`${item.name} is already a staple on slots 1-3`);
          }
        });
        if (new Set(picks).size !== picks.length) problems.push("duplicate picks");
      }
      if (problems.length > 0) {
        offenders.push({ origin: symbol, problems });
        console.warn(`CharacterCreation: ${symbol} favourites — ${problems.join("; ")}`);
      }
    });
    return offenders;
  }

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

  // A loadout row can name an item, a weapon or an armor; `kind` says which
  // database to read it from. Rows written without one are items, which is
  // every hand-authored row in ORIGIN_LOADOUTS above.
  function loadoutEntryData(entry) {
    if (!entry) return null;
    if (entry.kind === "weapon") return $dataWeapons[entry.id] || null;
    if (entry.kind === "armor") return $dataArmors[entry.id] || null;
    return $dataItems[entry.id] || null;
  }

  // --- Rolled loadouts -----------------------------------------------------
  // Two origins do not carry a fixed kit. The Arcanist's library and the
  // Mercenary's hardware are dealt out of the database, so no two parties start
  // with the same gear. What they must never do is change while the player is
  // reading them: the origin board redraws its right page on every cursor move,
  // and a kit that reshuffled as the player stepped through the list would be
  // impossible to choose between. So the deal is a pure function of ONE seed,
  // rolled once per creation run (_ccOriginRollSeed, cleared by the
  // characterCreation plugin command) and salted per origin. The dossier and
  // the grant call the same function and get the same answer, and stepping off
  // an origin and back onto it changes nothing.
  function originRollSeed() {
    if (!$gameSystem) return 1;
    if (!$gameSystem._ccOriginRollSeed) {
      $gameSystem._ccOriginRollSeed = Math.floor(Math.random() * 0x7ffffffe) + 1;
    }
    return $gameSystem._ccOriginRollSeed;
  }

  // mulberry32, the same small deterministic generator the rest of the project
  // uses for seeded content.
  function seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function textSalt(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const rngInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
  const rngPick = (rng, list) => (list && list.length ? list[Math.floor(rng() * list.length)] : null);
  // `count` distinct entries, in the order they were drawn.
  function rngPickSome(rng, list, count) {
    const pool = (list || []).slice();
    const picked = [];
    while (picked.length < count && pool.length > 0) {
      picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    return picked;
  }

  // Real database row: skips the blank padding entries and the
  // "<-- Category -->" dividers that separate the blocks.
  function isRealDbEntry(entry) {
    if (!entry || !entry.name) return false;
    const name = entry.name.trim();
    return name.length > 0 && !name.startsWith("<--");
  }

  // Price caps, in gold. Everything a rolled origin hands out is starting gear,
  // so the pools are cut by shop price the way the class starter weapons are:
  // cheap is what a beginner owns, and no stat scoring is involved.
  const WTYPE_STAFF = 6;                    // wands, staves, the grimoire family
  const RANGED_WTYPES = [7, 8, 9];          // Bow, Projectile, Gun
  const ATYPE_ROBE = 2;
  const ATYPE_LIGHT_ARMOR = 3;
  const ETYPE_HEAD = 3;
  const ETYPE_BODY = 4;
  const ETYPE_GEAR = 5;
  const PARAM_MAT = 4;                      // params index of Magic Attack
  const ARCANE_WEAPON_PRICE_CAP = 10000;    // a novice's first grimoire, not an archmage's
  const ARCANE_WEAPON_MIN_MAT = 5;          // below this a staff is a stick, not a focus
  const ARCANE_ROBE_PRICE_CAP = 10000;
  const GRIMOIRE_BOOK_PRICE_CAP = 100000;   // leaves out the 900,000g Forbidden Magic one
  const MAGIC_ITEM_PRICE_CAP = 10000;
  // A hired gun is armed, not improvising: the floors keep the slingshots and
  // the bent arrows out of a mercenary's hands without reaching the tier a
  // level 1 party has no business carrying.
  const RANGED_WEAPON_PRICE_FLOOR = 1500;
  const RANGED_WEAPON_PRICE_CAP = 9000;
  const FIELD_ARMOR_PRICE_FLOOR = 900;
  const FIELD_ARMOR_PRICE_CAP = 6000;
  const MEDICAL_ITEM_PRICE_CAP = 1500;
  const SURVIVAL_ITEM_PRICE_CAP = 6000;
  const MEDICINE_EFFECT_CODES = [11, 12, 22]; // recover HP, recover MP, remove state

  // Every pool a rolled origin draws from, derived from the live database so a
  // re-indexed Weapons.json or a newly authored grimoire is picked up without a
  // hardcoded id going stale. Built once: the databases are stable after load
  // and the dossier asks for this on every cursor move.
  let _originPoolCache = null;
  const ORIGIN_COMPONENT_PRICE_CAP = 60000;   // 600 euro, mundane and near-mundane parts

  function originPools() {
    if (_originPoolCache) return _originPoolCache;
    const inCategory = (entry, cat) =>
      new RegExp(`<category:\\s*${cat}\\s*>`, "i").test((entry && entry.note) || "");
    const byPrice = (a, b) => a.price - b.price;
    const weapons = $dataWeapons.filter((w) => isRealDbEntry(w) && w.price > 0);
    const armors = $dataArmors.filter((a) => isRealDbEntry(a) && a.price > 0);
    const items = $dataItems.filter((i) => isRealDbEntry(i) && i.price > 0);

    _originPoolCache = {
      // A grimoire in this database is a staff-type weapon that carries real
      // magic (a MAT bonus worth the name), plus anything actually named as a
      // book of spells. The MAT floor is what keeps the walking sticks and the
      // mop handles filed under Staff out of a spellcaster's hands.
      arcaneWeapons: weapons.filter((w) =>
        w.price <= ARCANE_WEAPON_PRICE_CAP &&
        ((w.wtypeId === WTYPE_STAFF && (w.params || [])[PARAM_MAT] >= ARCANE_WEAPON_MIN_MAT) ||
          /grimoire|grimorie|tome|codex|spellbook/i.test(w.name))
      ).sort(byPrice),
      // Robes (armor type 2) are the magical wardrobe: a body piece to wear and
      // a hat or a charm to go with it.
      robeBodies: armors.filter((a) =>
        a.atypeId === ATYPE_ROBE && a.etypeId === ETYPE_BODY && a.price <= ARCANE_ROBE_PRICE_CAP
      ).sort(byPrice),
      robeCharms: armors.filter((a) =>
        a.atypeId === ATYPE_ROBE && (a.etypeId === ETYPE_HEAD || a.etypeId === ETYPE_GEAR) &&
        a.price <= ARCANE_ROBE_PRICE_CAP
      ).sort(byPrice),
      // The school primers (items 1400+, one per magical discipline). They are
      // <category:Tools>, so the loadout clamps each to a single copy however
      // big the party: what varies is HOW MANY schools the party starts with.
      grimoireBooks: items.filter((i) =>
        /<Grimoire:/i.test(i.note || "") && i.price <= GRIMOIRE_BOOK_PRICE_CAP
      ).sort(byPrice),
      magicItems: items.filter((i) => inCategory(i, "Magic") && i.price <= MAGIC_ITEM_PRICE_CAP).sort(byPrice),
      rangedWeapons: weapons.filter((w) =>
        RANGED_WTYPES.includes(w.wtypeId) &&
        w.price >= RANGED_WEAPON_PRICE_FLOOR && w.price <= RANGED_WEAPON_PRICE_CAP
      ).sort(byPrice),
      fieldArmors: armors.filter((a) =>
        a.atypeId === ATYPE_LIGHT_ARMOR && a.etypeId === ETYPE_BODY &&
        a.price >= FIELD_ARMOR_PRICE_FLOOR && a.price <= FIELD_ARMOR_PRICE_CAP
      ).sort(byPrice),
      // A medic's bag, not a chemist's: only medicine that actually restores
      // HP or MP or clears a status, which is what leaves the recreational half
      // of the Medical shelf (cocaine, angel dust, opium) out of it.
      medicalItems: items.filter((i) =>
        inCategory(i, "Medical") && i.price <= MEDICAL_ITEM_PRICE_CAP &&
        (i.effects || []).some((e) => e && MEDICINE_EFFECT_CODES.includes(e.code))
      ).sort(byPrice),
      survivalItems: items.filter((i) => inCategory(i, "Survival") && i.price <= SURVIVAL_ITEM_PRICE_CAP).sort(byPrice),
      // The sealed shelf: one vial per disease in the library, each naming what
      // is in it. Read off the tag rather than the category so a vial is only
      // ever dealt when it really carries a disease id to open.
      diseaseVials: items.filter((i) => /<DiseaseVial:/i.test(i.note || "")).sort(byPrice),
      // The pharmacy proper, every item that actually treats something
      // (tools/health/gen_medicines.py writes the tag), which is what a carrier
      // keeps for the day their own stock turns on them.
      medicines: items.filter((i) => /<Medicine:/i.test(i.note || "")).sort(byPrice),
      // The 240 <Esoteric> spells the Arcanist studies. The 52 that also carry
      // <Forbidden> are left out: those are the end of a school, not the start
      // of one, and four of them dealt at level 1 would end the game before it
      // began.
      esotericSkills: $dataSkills.filter((s) =>
        isRealDbEntry(s) && s.meta && s.meta.Esoteric && !s.meta.Forbidden
      ),
      // The rites that actually call something onto the field: a Convokation
      // skill whose common event is one of SummonSystem's. Read off the event
      // rather than off a list of ids, so a rite added later is picked up
      // without touching this. <Forbidden> is left out, which is what keeps the
      // elder entity out of a level 1 spellbook.
      // Hyperdeck parts, capped well below the arcane end of the shelf: what
      // somebody scavenging components would plausibly have accumulated, not a
      // scrying mirror and a bottled storm.
      components: items.filter((i) =>
        inCategory(i, "Component") && i.price <= ORIGIN_COMPONENT_PRICE_CAP
      ).sort(byPrice),
      summonSkills: $dataSkills.filter((s) => {
        if (!isRealDbEntry(s) || (s.meta && s.meta.Forbidden)) return false;
        if (!/<category:\s*Convokation\s*>/i.test(s.note || "")) return false;
        return (s.effects || []).some((e) => {
          if (!e || e.code !== 44) return false;
          const event = $dataCommonEvents[e.dataId];
          return !!event && /^SUM: /.test(event.name || "");   // i18n-ignore: common event name
        });
      }),
    };
    return _originPoolCache;
  }

  const ARCANIST_SKILLS_PER_MEMBER = 4;
  const ARCANIST_BOOKS_MIN = 2;
  const ARCANIST_BOOKS_MAX = 4;
  const ARCANIST_RELICS_MIN = 3;
  const ARCANIST_RELICS_MAX = 5;
  const LOST_CONVOKER_SKILLS_PER_MEMBER = 8;
  const LOST_CONVOKER_FOCI_MIN = 2;
  const LOST_CONVOKER_FOCI_MAX = 4;
  const MERCENARY_MEDICINE_MIN = 4;
  const MERCENARY_MEDICINE_MAX = 6;
  const MERCENARY_SURVIVAL_MIN = 3;
  const MERCENARY_SURVIVAL_MAX = 5;
  const PLAGUE_VIALS_MIN = 10;
  const PLAGUE_VIALS_MAX = 14;
  const PLAGUE_MEDICINE_MIN = 5;
  const PLAGUE_MEDICINE_MAX = 7;
  const HYPERNET_PARTS_MIN = 12;
  const HYPERNET_PARTS_MAX = 20;
  const HYPERNET_PART_STACK_MIN = 1;
  const HYPERNET_PART_STACK_MAX = 4;

  // A rolled deal has two halves: `perMember` is the gear rolled for one
  // character (so it can be worn by the character it was rolled for) and
  // `entries` is the whole deal written as loadout rows, which is what the
  // dossier lists and what the grant hands over.
  function rollArcanistLoadout(rng, size) {
    const pools = originPools();
    const perMember = [];
    const entries = [];
    for (let i = 0; i < size; i++) {
      const weapon = rngPick(rng, pools.arcaneWeapons);
      const robe = rngPick(rng, pools.robeBodies);
      const charm = rngPick(rng, pools.robeCharms);
      const skills = rngPickSome(rng, pools.esotericSkills, ARCANIST_SKILLS_PER_MEMBER);
      perMember.push({
        weaponId: weapon ? weapon.id : 0,
        armorIds: [robe, charm].filter(Boolean).map((a) => a.id),
        skillIds: skills.map((s) => s.id),
      });
      if (weapon) entries.push({ kind: "weapon", id: weapon.id, qty: 1 });
      if (robe) entries.push({ kind: "armor", id: robe.id, qty: 1 });
      if (charm) entries.push({ kind: "armor", id: charm.id, qty: 1 });
    }
    rngPickSome(rng, pools.grimoireBooks, rngInt(rng, ARCANIST_BOOKS_MIN, ARCANIST_BOOKS_MAX))
      .forEach((book) => entries.push({ id: book.id, qty: 1 }));
    rngPickSome(rng, pools.magicItems, rngInt(rng, ARCANIST_RELICS_MIN, ARCANIST_RELICS_MAX))
      .forEach((relic) => entries.push({ id: relic.id, qty: 1, each: true }));
    return { perMember, entries };
  }

  // The Lost Convoker: no college, no coach, no idea where they are. What they
  // do have is a spellbook full of rites, because whatever put them down in the
  // middle of nowhere was one of them.
  function rollLostConvokerLoadout(rng, size) {
    const pools = originPools();
    const perMember = [];
    const entries = [];
    for (let i = 0; i < size; i++) {
      const staff = rngPick(rng, pools.arcaneWeapons);
      const robe = rngPick(rng, pools.robeBodies);
      const rites = rngPickSome(rng, pools.summonSkills, LOST_CONVOKER_SKILLS_PER_MEMBER);
      perMember.push({
        weaponId: staff ? staff.id : 0,
        armorIds: robe ? [robe.id] : [],
        skillIds: rites.map((s) => s.id),
      });
      if (staff) entries.push({ kind: "weapon", id: staff.id, qty: 1 });
      if (robe) entries.push({ kind: "armor", id: robe.id, qty: 1 });
    }
    rngPickSome(rng, pools.magicItems, rngInt(rng, LOST_CONVOKER_FOCI_MIN, LOST_CONVOKER_FOCI_MAX))
      .forEach((focus) => entries.push({ id: focus.id, qty: 1 }));
    return { perMember, entries };
  }

  function rollMercenaryLoadout(rng, size) {
    const pools = originPools();
    const perMember = [];
    const entries = [];
    for (let i = 0; i < size; i++) {
      const weapon = rngPick(rng, pools.rangedWeapons);
      const vest = rngPick(rng, pools.fieldArmors);
      perMember.push({
        weaponId: weapon ? weapon.id : 0,
        armorIds: vest ? [vest.id] : [],
        skillIds: [],
      });
      if (weapon) entries.push({ kind: "weapon", id: weapon.id, qty: 1 });
      if (vest) entries.push({ kind: "armor", id: vest.id, qty: 1 });
    }
    rngPickSome(rng, pools.medicalItems, rngInt(rng, MERCENARY_MEDICINE_MIN, MERCENARY_MEDICINE_MAX))
      .forEach((med) => entries.push({ id: med.id, qty: rngInt(rng, 1, 2), each: true }));
    rngPickSome(rng, pools.survivalItems, rngInt(rng, MERCENARY_SURVIVAL_MIN, MERCENARY_SURVIVAL_MAX))
      .forEach((kit) => entries.push({ id: kit.id, qty: 1 }));
    return { perMember, entries };
  }

  // The Plague Spreader carries the library rather than a kit: a case of sealed
  // vials off the disease shelf and the pharmacy to survive owning them. No
  // weapon, no armour and nothing taught, so there is no perMember share.
  function rollPlagueSpreaderLoadout(rng) {
    const pools = originPools();
    const entries = [];
    rngPickSome(rng, pools.diseaseVials, rngInt(rng, PLAGUE_VIALS_MIN, PLAGUE_VIALS_MAX))
      .forEach((vial) => entries.push({ id: vial.id, qty: 1 }));
    rngPickSome(rng, pools.medicines, rngInt(rng, PLAGUE_MEDICINE_MIN, PLAGUE_MEDICINE_MAX))
      .forEach((med) => entries.push({ id: med.id, qty: 2, each: true }));
    return { perMember: [], entries };
  }

  // Hypernet Explorer: a heap of loose parts and nothing else. Both HOW MANY
  // distinct parts and HOW MANY of each are rolled, which is what makes it a
  // heap rather than a list, and the dossier states every count exactly because
  // it reads these same rows.
  function rollHypernetExplorerLoadout(rng) {
    const pools = originPools();
    const entries = [];
    rngPickSome(rng, pools.components, rngInt(rng, HYPERNET_PARTS_MIN, HYPERNET_PARTS_MAX))
      .forEach((part) => entries.push({
        id: part.id,
        qty: rngInt(rng, HYPERNET_PART_STACK_MIN, HYPERNET_PART_STACK_MAX),
      }));
    return { perMember: [], entries };
  }

  const ORIGIN_ROLLS = {
    origin_arcanist: rollArcanistLoadout,
    origin_mercenary: rollMercenaryLoadout,
    origin_lost_convoker: rollLostConvokerLoadout,
    origin_plague: rollPlagueSpreaderLoadout,
    origin_hypernet_explorer: rollHypernetExplorerLoadout,
  };

  // The deal for an origin, memoized on what it is a function of (the run's
  // seed, the origin and the party size) so the board is not re-rolling the
  // whole database on every keypress.
  let _originRollCache = {};
  function originRoll(symbol) {
    const roller = ORIGIN_ROLLS[symbol];
    if (!roller) return null;
    const size = loadoutPartySize();
    const seed = originRollSeed();
    const key = `${symbol}:${seed}:${size}`;
    if (!_originRollCache[key]) {
      _originRollCache[key] = roller(seededRng((seed ^ textSalt(symbol)) >>> 0), size);
    }
    return _originRollCache[key];
  }

  // How many Hyperdeck parts this run's Hypernet Explorer was dealt, counting
  // the stacks and not the rows, so the dossier states the size of the heap.
  function hypernetPartCount() {
    const roll = originRoll("origin_hypernet_explorer");
    if (!roll) return 0;
    return roll.entries.reduce((total, entry) => total + (entry.qty || 0), 0);
  }

  // How many sealed vials this run's Plague Spreader was dealt, so the dossier
  // states the size of the case rather than "a lot". Counted off the same rolled
  // entries the grant hands over, never a second roll.
  function plagueVialCount() {
    const roll = originRoll("origin_plague");
    if (!roll) return 0;
    return roll.entries.filter((entry) => {
      const data = loadoutEntryData(entry);
      return !!data && /<DiseaseVial:/i.test(data.note || "");
    }).length;
  }

  // Called when a fresh creation run begins: the next party is dealt a new kit.
  function resetOriginRoll() {
    if ($gameSystem) $gameSystem._ccOriginRollSeed = 0;
    _originRollCache = {};
  }

  // The resolved loadout of an origin: its own kit and nothing else, quantities
  // already scaled to the party. Rows with the same entry are merged so the
  // dossier lists each one exactly once.
  function resolveOriginLoadout(symbol) {
    const size = loadoutPartySize();
    const rolled = originRoll(symbol);
    const entries = (ORIGIN_LOADOUTS[symbol] || []).concat(rolled ? rolled.entries : []);
    const merged = [];
    const byKey = {};
    for (const entry of entries) {
      const data = loadoutEntryData(entry);
      if (!data) continue;
      const kind = entry.kind || "item";
      const key = `${kind}:${entry.id}`;
      const qty = isToolItem(data) ? 1 : entry.qty * (entry.each ? size : 1);
      if (byKey[key]) {
        byKey[key].qty = isToolItem(data) ? 1 : byKey[key].qty + qty;
      } else {
        byKey[key] = { kind, id: entry.id, qty };
        merged.push(byKey[key]);
      }
    }
    return merged;
  }

  function grantOriginLoadout(symbol) {
    for (const entry of resolveOriginLoadout(symbol)) {
      const data = loadoutEntryData(entry);
      if (data) {
        $gameParty.gainItem(data, entry.qty);
      } else {
        console.warn(`CharacterCreation: starting ${entry.kind} ${entry.id} not found.`);
      }
    }
    // The party is holding the kit now, so its three signature items can take
    // hotbar 4-6 (the staples took 1-3 in giveStarterStaples).
    bindOriginFavorites(symbol);
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

  // Augmented origin: everybody walks out of the clinic already carrying
  // hardware. What each member gets is rolled from the sockets their OWN
  // anatomy has, through Health_Core's name matcher, so a creature is fitted
  // in its BODY or its wings rather than in a humanoid's torso, and a socket
  // is only ever used once. The dearest augments are left in the catalogue:
  // this is a start, not a treasure chest.
  const AUGMENTED_ORIGIN_MIN = 2;
  const AUGMENTED_ORIGIN_MAX = 3;
  const AUGMENTED_ORIGIN_MAX_COST = 500000; // 5,000 EUR a piece

  // Card Collector origin: the party arrives with a shelf already built and a
  // legal deck already sleeved, so the first person they meet can be played
  // rather than asked for a booster pack.
  const CARD_ORIGIN_CARDS = 100;

  // Every OTHER start is handed enough to sit down at a table with a little
  // room to move: a legal deck is nine cards, and two spare copies are what
  // makes it a deck the player can change rather than the only hand they own.
  // The card game is part of the world rather than one scenario's toy, and a
  // party that cannot make a legal deck is simply refused a duel. It is not
  // listed on the origin dossier because it is not what makes an origin what
  // it is.
  const CARD_MINIMUM_SPARE = 2;

  function grantMinimumCards() {
    const CG = window.CardGame;
    if (!CG) return;
    CG.ensureStarterEffects();
    const short = CG.DECK_MIN + CARD_MINIMUM_SPARE - CG.totalOwned();
    if (short > 0) dealCards(short);
  }

  function grantStartingCards() {
    const CG = window.CardGame;
    if (!CG) {
      console.warn("CharacterCreation: card collector origin needs Cards/CardGameCore; no cards were dealt.");
      return;
    }
    // The five effect cards come with any party; these are on top of them.
    CG.ensureStarterEffects();
    dealCards(CARD_ORIGIN_CARDS);

    // Sleeved and ready: the strongest legal deck the shelf can make, saved as
    // the active one so a duel never has to be built first.
    const cards = CG.autoDeck();
    if (CG.deckLegality(cards).ok) {
      CG.saveDeck(null, { name: T('CharCreate.cardCollectorDeckName'), cards });
      CG.setActiveDeck(CG.decks().length - 1);
    }
  }

  // A spread rather than a pile of commons: the rarity table a booster rolls
  // on, run often enough to fill the shelf, with the streak bonus off.
  function dealCards(count) {
    const CG = window.CardGame;
    const rolled = [];
    while (rolled.length < count) {
      const pack = CG.rollBooster(CG.PACK_SIZE, {});
      if (!pack.length) break; // an empty catalogue never loops forever
      for (const key of pack) {
        if (rolled.length < count) rolled.push(key);
      }
    }
    for (const key of rolled) CG.addCard(key, 1);
  }

  function grantStartingAugments() {
    const types = window.Health && window.Health.ProstheticTypes;
    const api = window.HealthCore;
    if (!types || !api || !api.implantsForPart) {
      console.warn("CharacterCreation: augmented origin needs Health_Core; nobody was fitted.");
      return;
    }
    for (const actor of $gameParty.members()) {
      if (!actor._bodyParts && api.ensureBodyPartSkills) api.ensureBodyPartSkills(actor);
      const sockets = Object.keys(actor._bodyParts || {});
      if (!sockets.length) continue;
      // Walk the sockets in a random order and fit the first affordable thing
      // each one accepts, until this member has their share.
      const shuffled = sockets.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const wanted = AUGMENTED_ORIGIN_MIN +
        Math.floor(Math.random() * (AUGMENTED_ORIGIN_MAX - AUGMENTED_ORIGIN_MIN + 1));
      let fitted = 0;
      for (const partKey of shuffled) {
        if (fitted >= wanted) break;
        if (actor._prosthetics && actor._prosthetics[partKey]) continue;
        const candidates = api.implantsForPart(partKey).filter((key) => {
          const augment = types[key];
          return augment && (augment.cost || 0) <= AUGMENTED_ORIGIN_MAX_COST;
        });
        if (!candidates.length) continue;
        const key = candidates[Math.floor(Math.random() * candidates.length)];
        if (window.ProstheticShop && window.ProstheticShop.installImplant) {
          window.ProstheticShop.installImplant(actor, partKey, key);
          fitted++;
        }
      }
    }
  }

  // Arcanist / Mercenary origins: the gear was already handed over by
  // grantOriginLoadout (one table, one list, the same rows the dossier
  // promised), so all that is left is to put the pieces rolled FOR a member ON
  // that member and, for the arcanist, to teach the four spells they studied.
  // Everything here reads the same deal the board showed, so what the player
  // saw is what they are wearing.
  function applyRolledPersonalGear(symbol) {
    const roll = originRoll(symbol);
    if (!roll) return;
    const members = $gameParty.members();
    members.forEach((actor, index) => {
      const share = roll.perMember[index];
      if (!share) return;
      (share.skillIds || []).forEach((skillId) => {
        if ($dataSkills[skillId]) actor.learnSkill(skillId);
      });
      const wear = (gear) => {
        if (!gear || !actor.canEquip(gear)) return;
        // The first free slot that would take this piece. A hand takes a
        // weapon or a shield alike, so the type alone no longer names a slot
        // (ItemSystem/ItemSystemEquipment.js, window.HandSlots).
        const slots = actor.equipSlots();
        for (let slotId = 0; slotId < slots.length; slotId++) {
          if (actor.equips()[slotId]) continue;
          const fits = window.HandSlots
            ? window.HandSlots.hasRoomFor(actor, slotId, gear)
            : slots[slotId] === (gear.etypeId || 1);
          if (!fits) continue;
          try {
            actor.changeEquip(slotId, gear);
            return;
          } catch (e) {
            /* incompatible slot - try the next one it could go in */
          }
        }
      };
      wear($dataWeapons[share.weaponId]);
      (share.armorIds || []).forEach((id) => wear($dataArmors[id]));
    });
  }

  function startArcanistOrigin() {
    applyRolledPersonalGear("origin_arcanist");
    startWorldMapPickerOrigin();
  }

  function startMercenaryOrigin() {
    applyRolledPersonalGear("origin_mercenary");
    startWorldMapPickerOrigin();
  }

  // Lost Convoker origin: the rite worked, and it put them down somewhere
  // nobody picked. Unlike the castaway's hand-written spots this is a genuinely
  // random square of the world, which is the same landing the empty-lot origin
  // gets.
  function startLostConvokerOrigin() {
    applyRolledPersonalGear("origin_lost_convoker");
    if (startOnProceduralSquare({ rng: Math.random })) return;
    console.warn("CharacterCreation: no overland square for the lost-convoker origin; starting at the tower gate instead.");
    startDungeonOrigin();
  }

  // Hypernet Explorer origin: the Hypernet Point (map 1), the terminal room in
  // the Omega Tower, facing down. A fixed address rather than a random house:
  // the origin begins among the machines it is about, and the tower square is
  // the anchor the party returns to.
  const HYPERNET_ORIGIN = { mapId: 1, x: 26, y: 33, dir: 2 };

  function startHypernetExplorerOrigin() {
    // The one origin that already lives inside a Hyperdeck. Every other party
    // is handed a cupboard cast-off built out of the scrap end of the
    // catalogue; this one gets a deck rolled from the whole of it.
    try {
      if (window.HyperDeck && window.HyperDeck.rollStartingDeck) {
        window.HyperDeck.rollStartingDeck(Math.random, { everything: true });
      }
    } catch (e) {
      console.warn("CharacterCreation: could not re-roll the starting Hyperdeck.", e);
    }
    anchorAtOmegaTower();
    $gamePlayer.reserveTransfer(
      HYPERNET_ORIGIN.mapId, HYPERNET_ORIGIN.x, HYPERNET_ORIGIN.y, HYPERNET_ORIGIN.dir, 0
    );
  }

  // Dungeon-entrance origin: the OmegaTower interior gate (map 635), facing up.
  const DUNGEON_ORIGIN = { mapId: 635, x: 13, y: 37, dir: 8 };

  // Dungeon-entrance origin: start at the tower gate with the delve kit its
  // loadout lists (extra potions, routes map, flashlight, climbing rope). It
  // used to hand out random items until the party's carry limit was full, which
  // no dossier could state honestly.
  //
  // Also the fallback landing of every origin whose own square could not be
  // built, so the anchor is written here too: whoever ends up at the gate is
  // from the gate. Those fallbacks are only ever reached before anything was
  // anchored (the square that failed to build never wrote one), so this cannot
  // move an anchor another origin already meant.
  function startDungeonOrigin() {
    anchorAtOmegaTower();
    $gamePlayer.reserveTransfer(
      DUNGEON_ORIGIN.mapId, DUNGEON_ORIGIN.x, DUNGEON_ORIGIN.y, DUNGEON_ORIGIN.dir, 0
    );
  }

  // Diplomat origin: the ONU assembly's seat of business, Brussels (map 400).
  const DIPLOMAT_ORIGIN = { mapId: 400, x: 41, y: 15, dir: 2 }; // facing down
  const DIPLOMAT_PLACE = "Brusselles";  // the assembly's town: the anchor's world square

  // Diplomat origin: start in Brussels with the ONU Terminal its loadout lists,
  // remote access into the assembly (see ONUAssembly.js).
  function startDiplomatOrigin() {
    anchorAtPlace(DIPLOMAT_PLACE, { x: 89, y: 121 });
    $gamePlayer.reserveTransfer(
      DIPLOMAT_ORIGIN.mapId, DIPLOMAT_ORIGIN.x, DIPLOMAT_ORIGIN.y, DIPLOMAT_ORIGIN.dir, 0
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
    // Anchored on the square the cellar was actually dug under, after the
    // re-anchor above has had its say, so home ground is the hatch they climb
    // out of rather than the square the bunker was first proposed for.
    anchorAt(record.worldX, record.worldY);
    pg._dungeonSession = { type: "bunker" };
  }

  // Artifact Heir origin: inherit one of the world's 13 generated historical
  // artifacts (HistorySimulator.js ids 1501-1513, each existing as an item,
  // a weapon AND an armor variant) at random, with whatever provenance the
  // history sim rolled for it. Spawn is the full city picker (the train's own
  // three-station whitelist belongs to origin_train alone); the artifact itself
  // is the one random part of any origin's loadout.
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
      // The world is told the day it changed hands: the chain of holders this
      // artifact has carried since 1900 gains the party as its newest link,
      // and the Archive carries the inheritance alongside it.
      if (window.HistoryManager && window.HistoryManager.recordArtifactCustody) {
        const leader = $gameParty.leader();
        if (leader) {
          try {
            window.HistoryManager.recordArtifactCustody(kind.key, artifactId, leader.name(), "inherited");
          } catch (e) {
            console.warn("CharacterCreation: artifact custody record failed", e);
          }
        }
      }
    } else {
      console.warn(`CharacterCreation: artifact ${kind.key}:${artifactId} not found; artifact heir origin gave nothing.`);
    }
    startWorldMapPickerOrigin();
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
    // Wherever the wreck ended up, Earth is measured from the pad they were
    // trying to get back to (see anchorAtSpaceCenter).
    anchorAtSpaceCenter();
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
  // weeks of upkeep for the granted troops. Spawn is the full city picker: an
  // army does not ride in on the beginners' train.
  const WARLORD_TROOP_COUNT = 40;

  function startWarlordOrigin() {
    if (window.ArmyManager && window.ArmyManager.grantRandomTroopsMixed) {
      window.ArmyManager.grantRandomTroopsMixed(WARLORD_TROOP_COUNT);
    }
    if (typeof $gameArmy !== "undefined" && $gameArmy) {
      const upkeep = $gameArmy.getTotalWeeklyCost() * 2; // 2 weeks of upkeep
      if (upkeep > 0) $gameParty.gainGold(upkeep);
    }
    startWorldMapPickerOrigin();
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
    startWorldMapPickerOrigin();
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
      startWorldMapPickerOrigin();
      return;
    }
    Scene_CharacterCreation._interruptedStep = STEP.ORIGIN;
    Scene_CharacterCreation._resumeOnStep = false;
    SceneManager.push(window.Scene_FactionStatus);
    SceneManager.prepareNextScene("select", (factionId) => {
      finishFactionOrigin(factionId, isPositive);
    });
  }

  // --- Inline class list helpers ------------------------------------------
  // Specialization points a member is given to spend during creation. One
  // number, read by the board, by the +/- buttons and by the summary, so a
  // budget change cannot leave the three disagreeing.
  const CC_SPEC_BUDGET = 12;

  // The board's own tab, sitting in front of the categories: the ones this
  // member already stands above Untrained in, bought or granted. It is an id,
  // not a label, so it never collides with a Specialization.json category.
  const SPEC_TAB_CURRENT = "Current";

  // ── Creature archetypes ─────────────────────────────────────────────────
  // Two namespaces name the same creatures: Health/Archetypes.json spells them
  // in CamelCase ("Crustacean") and is the ONLY vocabulary the body-part merge
  // understands, while Battler3D registers its structures in lowercase
  // ("crustacean"). A key coming back out of a 3D picker is therefore useless
  // to the health side until it is spelled the health side's way, which is what
  // this does. Anything with no Archetypes.json entry answers null, so a caller
  // can tell "no such archetype" from "spelled differently".
  function healthArchetypeKey(key) {
    const table = (window.Health && window.Health.Archetypes) || null;
    if (!key || !table) return null;
    const raw = String(key);
    if (table[raw]) return raw;
    const lower = raw.toLowerCase();
    for (const k in table) {
      if (k.toLowerCase() === lower) return k;
    }
    return null;
  }

  // Every archetype a creature can be built from, in Archetypes.json order.
  function creatureArchetypeKeys() {
    const table = (window.Health && window.Health.Archetypes) || null;
    return table ? Object.keys(table) : [];
  }

  // What an archetype is called on screen. The names live in
  // js/i18n/<lang>/enemyArchetypes.json, keyed by the lowercased archetype, and
  // are read through the same service the health menu and the creature builder
  // use, so all three agree.
  function archetypeDisplayName(key) {
    if (!key) return "";
    if (typeof window.getArchetypeText === "function") {
      const name = window.getArchetypeText(`enemyArchetypes.${String(key).toLowerCase()}.name`) /* i18n-ignore: enemyArchetypes.json key */;
      if (name) return name;
    }
    return String(key);
  }

  // The archetypes a member is built from, primary first, always in health
  // spelling. A body may be spliced from two of them; the second one is
  // optional and never repeats the first.
  function actorArchetypeKeys(actor) {
    if (!actor) return [];
    const raw = (actor._creatureArchetypes && actor._creatureArchetypes.length)
      ? actor._creatureArchetypes
      : [actor._currentArchetype];
    const keys = [];
    for (const key of raw) {
      const canonical = healthArchetypeKey(key);
      if (canonical && !keys.includes(canonical)) keys.push(canonical);
    }
    return keys.slice(0, 2);
  }

  function actorArchetypeKey(actor) {
    return actorArchetypeKeys(actor)[0] || null;
  }

  function actorSecondaryArchetypeKey(actor) {
    return actorArchetypeKeys(actor)[1] || null;
  }

  // Put a body on a member: the health spellings are stored (so the body parts
  // merge), the anatomy is rebuilt from the pair, and the 3D config with it.
  // False when nothing in the list names an archetype at all, so a caller can
  // leave the member as it was rather than blanking it.
  function applyArchetypesToActor(actor, keys) {
    if (!actor) return false;
    const canonical = [];
    for (const key of keys || []) {
      const one = healthArchetypeKey(key);
      if (one && !canonical.includes(one)) canonical.push(one);
    }
    if (!canonical.length) return false;
    actor._creatureArchetypes = canonical;
    actor._currentArchetype = canonical[0];
    // The 3D model is settled BEFORE the body, because the model is where the
    // body's grafted parts come from. A primary that changed opens the sculptor
    // on a monster of the new kind; a changed second half only adds or swaps
    // the limbs it brought, leaving anything sculpted by hand alone.
    const CC3D = window.CC3DModel;
    if (CC3D && CC3D.applyArchetypesToConfig && CC3D.setConfig) {
      const cfg = CC3D.applyArchetypesToConfig(CC3D.getConfig(actor.actorId()), canonical);
      if (cfg) {
        CC3D.setConfig(actor.actorId(), cfg);
        // What the model wears IS what the body is made of, so the graft record
        // is rewritten from the model every time either of them moves.
        if (CC3D.graftedParts) {
          const grafts = CC3D.graftedParts(cfg, canonical);
          actor._ccGraftedParts = Object.keys(grafts.parts).length ? grafts.parts : null;
          actor._ccReplacedParts = grafts.replaced.length ? grafts.replaced : null;
        }
      }
    }
    // The anatomy is rebuilt, not merely merged: a member who already had a
    // body kept the old one, so swapping archetype changed the name on the tab
    // and nothing else.
    actor._bodyParts = null;
    if (typeof window.initializeBodyParts === "function") {
      window.initializeBodyParts(actor);
    } else if (window.HealthCore && window.HealthCore.mergeArchetypeParts) {
      window.HealthCore.mergeArchetypeParts(canonical);
    }
    return true;
  }

  // The primary alone, keeping whatever second archetype the member carries
  // (unless the new primary IS that one, in which case the pair collapses).
  function applyArchetypeToActor(actor, key) {
    return applyArchetypesToActor(actor, [key, actorSecondaryArchetypeKey(actor)]);
  }

  // Shared so the sprite board can settle a member's body from the sheet they
  // were given (CharacterCreationShared.applyIdentityFromSprite): one call puts
  // the archetype on, rebuilds the anatomy and regenerates the 3D model.
  window.applyArchetypesToActor = applyArchetypesToActor;

  // A creature is never left without a body to be drawn as: the moment a member
  // becomes one it is given the model its archetype implies (the kind it
  // already carries, or the first archetype there is), so the sculptor opens on
  // a real monster and every panel has a model to show instead of a bust.
  function ensureCreatureModel(actor) {
    if (!actor) return false;
    const CC3D = window.CC3DModel;
    const hasConfig = !!(CC3D && CC3D.getConfig && CC3D.getConfig(actor.actorId()));
    const primary = actorArchetypeKey(actor);
    if (hasConfig && primary) return true;
    const key = primary || healthArchetypeKey("Goblin") || creatureArchetypeKeys()[0];
    if (!key) return false;
    return applyArchetypesToActor(actor, [key, actorSecondaryArchetypeKey(actor)]);
  }

  // The second half of a spliced body. An empty key drops it and leaves the
  // member built from its primary alone.
  function applySecondaryArchetypeToActor(actor, key) {
    const primary = actorArchetypeKey(actor);
    if (!primary) return false;
    if (!key) return applyArchetypesToActor(actor, [primary]);
    return applyArchetypesToActor(actor, [primary, key]);
  }

  // The whole sentient roster, which is what the board modes' class step lists.
  // A person is built from ids 1-62 alone; the creature classes above them
  // belong to the creature branch, dealt out of the archetype's own
  // creatureClasses list.
  //
  // Memoized: $dataClasses is stable after load and the class-step picker asks
  // for the list on every cursor move (the right-page details), which used to
  // re-filter the whole class table on each keypress.
  // Keyed on the world's magic level too (window.CreatureClasses.sentientRoster
  // filters by it), so switching into a differently-natured world within the
  // same session does not keep serving the first world's cached roster.
  let _sentientClassCache = null;
  let _sentientClassCacheKey = null;
  function getSentientClassList() {
    const key = (window.MagicNature && window.MagicNature.level()) || "normal";
    if (_sentientClassCache && _sentientClassCacheKey === key) return _sentientClassCache;
    _sentientClassCacheKey = key;
    _sentientClassCache = window.CreatureClasses.sentientRoster()
      .map((id) => ({ id, name: $dataClasses[id].name }));
    return _sentientClassCache;
  }

  // Hometown choices for the Full-mode hometown step (asked right after
  // Origin): every location from js/db/WorkSystem/Destinations.json (loaded
  // as window.WorkSystem.Destinations), sorted alphabetically. Falls back to
  // a short Belgian list if the data is not loaded yet.
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

  // --- Personality --------------------------------------------------------
  // A character's disposition is one of the archetypes in
  // js/db/Health/PersonalityData.json, stored as an index on their NPC society
  // profile (personalityIndex). Everything downstream reads it from there: the
  // party's own banter (PartyBanter), the thoughts they think (NPCConversation),
  // the biologic sim's stress response and the Empathize dossier. Left alone,
  // the profile carries the one the society generator rolled from the name
  // seed, which is why the step can simply be skipped rather than randomized
  // when a mode does not ask.
  //
  // Whichever shape the file is in, and whichever loader got there first, the
  // same list PartyBanter reads (see personalityList there).
  function personalityCatalog() {
    const loader = window._NPCSocietyDataLoader;
    if (loader && Array.isArray(loader.personalities)) return loader.personalities;
    const data = window.Health && window.Health.PersonalityData;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.list)) return data.list;
    return [];
  }

  // The archetype's name / description in the active language. The English
  // `name` on the record is the personality's id (every by-name lookup in the
  // other plugins keys on it), so both are reached from it out of
  // js/i18n/<lang>/plugins/Personality.json.
  function _personalityKey(entry, field) {
    if (!entry || !entry.name) return "";
    return "Personality." + String(entry.name).toLowerCase().replace(/[^a-z0-9]/g, "") + "." + field;
  }

  function personalityLabel(entry) {
    if (!entry) return "";
    const key = _personalityKey(entry, "name");
    if (key && window.T && window.T.has(key)) return window.T(key);
    return window.CCDbName(entry.name || "");
  }

  function personalityDescription(entry) {
    if (!entry) return "";
    const key = _personalityKey(entry, "description");
    return (key && window.T && window.T.has(key)) ? window.T(key) : "";
  }

  // Writes the pick onto the member's society profile, minting one if this name
  // has none yet (the name is settled well before this step: it is typed on the
  // gender step's name screen). Silent when the NPC system is not loaded, the
  // same way the trait step is silent without TraitSelector.
  function applyPersonalityIndex(actorId, index) {
    const actor = $gameActors ? $gameActors.actor(actorId) : null;
    if (!actor || !actor.name() || !window.NPCSocietyRegistry) return;
    try {
      const cls = actor.currentClass();
      window.NPCSocietyRegistry.ensureProfile(actor.name(), cls ? cls.id : null);
      const profile = window.NPCSocietyRegistry.getProfile(actor.name());
      if (profile) profile.personalityIndex = index;
    } catch (e) {
      console.warn("CharacterCreation: could not set personality", e);
    }
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
        return [{ name: T('CharCreate.continue'), symbol: "confirm" }];
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
      // Creation Mode, how much of the wizard this party walks through (see
      // CC_MODE). Asked once per party (showOnlyOnce); the chosen mode drives
      // which steps appear and how they behave for every member. Persisted to
      // $gameSystem so reprise paths keep it.
      id: "creationMode",
      showOnlyOnce: true,
      get title() {
        return T('CharCreate.chooseCreationMode');
      },
      get choices() {
        const choices = [
          // Quick first: it is the shortest way into the game, three questions
          // and the character is playing.
          getLocalizedChoice(T('CharCreate.choice.modeQuick.name'), "mode_quick", T('CharCreate.choice.modeQuick.desc')),
          getLocalizedChoice(T('CharCreate.choice.modeNormal.name'), "mode_normal", T('CharCreate.choice.modeNormal.desc')),
        ];
        // Full mode is disabled for now (FULL_CREATION_MODE_ENABLED).
        if (FULL_CREATION_MODE_ENABLED) {
          choices.push(
            getLocalizedChoice(T('CharCreate.choice.modeFull.name'), "mode_full", T('CharCreate.choice.modeFull.desc'))
          );
        }
        // Detailed mode sits between the wizard and the pre-made
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
          setCreationMode(CC_MODE.DETAILED);
          markStepCompleted(STEP.CREATION_MODE);
          this.nextStep();
          return;
        }
        const mode = symbol === "mode_quick" ? CC_MODE.QUICK
          : (symbol === "mode_full" && FULL_CREATION_MODE_ENABLED) ? CC_MODE.FULL
            : CC_MODE.NORMAL;
        setCreationMode(mode);
        markStepCompleted(STEP.CREATION_MODE);
        this.nextStep();
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
          // A person is portrayed by their bust, never by a sculpted model:
          // the art style follows what the character IS, it is not asked for.
          if (currentActor && currentActor.setPortraitMode) currentActor.setPortraitMode("bust");
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
          // A creature is portrayed by its own model, never by a 2D bust, and it
          // has a valid one from the moment it is made.
          if (currentActor) {
            if (currentActor.setPortraitMode) currentActor.setPortraitMode("model");
            ensureCreatureModel(currentActor);
          }

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
            description: "Traditional male biology and identity. Pronouns: He/Him. Associated with testicular/insemination biology.",
          },
          {
            name: T('CharCreate.female'),
            symbol: "gender",
            value: 1,
            description: "Traditional female biology and identity. Pronouns: She/Her. Associated with uterine/gestation biology.",
          },
          {
            name: T('CharCreate.nonBinary'),
            symbol: "gender",
            value: 2,
            description: "Fluid or non-conforming presentation. Pronouns: They/Them. Features adaptable biological traits.",
          },
          {
            name: T('CharCreate.cocoon'),
            symbol: "gender",
            value: 3,
            description: "Metamorphic, synthetic, or vegetative chassis. Pronouns: It/They. Operates via mitotic or engineered reproduction.",
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

        this.leaveGenderStep();
      },
    },
    {
      // Macro BIO Step (the page a new character opens on): Ideology, Morality, Hometown, Age, Personality, Wealth, Blood Type (Optional)
      id: "bio",
      get title() {
        return T('CharCreate.biography') || "Biography & Ideology";
      },
      get choices() {
        return [];
      },
      handler: function () {
        markStepCompleted(STEP.BIO);
        this.nextStep();
      },
    },
    {
      // Class
      id: "class",
      get title() {
        if (Scene_CharacterCreation._isCreatureMode) {
          return T('CharCreate.chooseYourSkills');
        }
        return T('CharCreate.chooseYourClass');
      },
      get choices() {
        const baseChoices = [];

        // A creature is offered every class there is, not only the ones its
        // archetype was born to: what it can be played as is the player's
        // call. The roster is grouped, monstrous kinds first under their own
        // head, so the classes that read as a creature are the ones the board
        // opens on.
        const creatureActor = Scene_CharacterCreation.getCurrentActor();
        if (Scene_CharacterCreation._isCreatureMode && creatureActor && window.CreatureClasses) {
          const classChoice = (id, group) => {
            const c = $dataClasses[id];
            if (!c) return null;
            const passiveDesc =
              (window.BattleSystemPassiveSkills &&
                window.BattleSystemPassiveSkills.getPassiveDescription(id)) ||
              T('CharCreate.startAsClass', { name: window.CCDbName(c) });
            return {
              name: window.CCDbName(c),
              symbol: "quick_class_" + id,
              description: passiveDesc,
              value: id,
              group,
              groupTitle: group === "creature"
                ? T('ClassSelect.ui.nonSentient')
                : T('ClassSelect.ui.sentient'),
            };
          };
          const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
          const creatureIds = typeof window.CreatureClasses.creatureRoster === "function"
            ? window.CreatureClasses.creatureRoster()
            : (window.CreatureClasses.forActor(creatureActor) || []);
          const creatureCards = creatureIds.map((id) => classChoice(id, "creature")).filter(Boolean).sort(byName);
          // The civilised half of the board belongs to the folk archetypes
          // alone (Humanoid, Elven, Dwarf, Goblin and their like, flagged
          // "sentient" in Archetypes.json). A beast, an ooze or a swarm is
          // offered the monstrous kinds and nothing else: a slime has no
          // profession, and a spliced body is only as civilised as its worse
          // half.
          const sentientAllowed = typeof window.CreatureClasses.sentientAllowedFor === "function"
            ? window.CreatureClasses.sentientAllowedFor(
                actorArchetypeKey(creatureActor), actorSecondaryArchetypeKey(creatureActor))
            : true;
          const sentientCards = sentientAllowed
            ? getSentientClassList().map((c) => classChoice(c.id, "sentient")).filter(Boolean).sort(byName)
            : [];
          const creatureRoster = creatureCards.concat(sentientCards);
          if (creatureRoster.length) return creatureRoster;
        }

        // Board modes: the whole sentient roster is listed on one step, with
        // the highlighted class's dossier on the right page.
        if (Scene_CharacterCreation.usesFullClassList()) {
          getSentientClassList().forEach((c) => {
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
          // The roster reads as an alphabet, and the roll that skips reading it
          // sits at the head of the board instead of at the end of a long list.
          baseChoices.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
          baseChoices.unshift(
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
        if (symbol && symbol.indexOf("quick_class_") === 0) {
          const classId = this.currentStepData().choices[index].value;
          // Board modes: apply the chosen class directly.
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
          this.nextStep();
          return;
        }
        if (symbol === "select_class") {
          window.$ccArchetypeClassFilter = null;
          window.$ccCreatureClassFlow = null;
          this.closeStepUI();
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
          // A person is rolled out of the sentient roster alone (1-62), and
          // narrowed by the world's magic level like every other roll; the
          // creature classes above it belong to the archetypes that list them
          // in Archetypes.json.
          const validClassIds = window.CreatureClasses.sentientRoster();
          if (validClassIds.length > 0) {
            const randomClass = {
              id: validClassIds[Math.floor(Math.random() * validClassIds.length)],
            };
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
      handler: function (symbol) {
        if (symbol === "random_traits") {
          const targetActorId = Scene_CharacterCreation.getCurrentActorId();
          if (window.randomizeTraitsForActor) {
            window.randomizeTraitsForActor(targetActorId);
          }
        }
        markStepCompleted(STEP.TRAITS);
        this.nextStep();
      },
    },
    {
      // Specializations (Optional)
      id: "specializations",
      get title() {
        return T('CharCreate.specializations') || "Specializations";
      },
      get choices() {
        return [];
      },
      handler: function () {
        markStepCompleted(STEP.SPECIALIZATIONS);
        this.nextStep();
      },
    },
    {
      // Personality. Asked of every member in Normal mode (and Full), of
      // creatures as much as of people - a beast has a temperament, which is
      // what a personality is. Quick mode never asks: its characters keep the
      // disposition the society generator rolled for their name, which is
      // exactly what this step overrides.
      id: "personality",
      get title() {
        return T('CharCreate.selectYourPersonality');
      },
      get choices() {
        const list = personalityCatalog();
        const choices = list.map((entry, index) => ({
          name: personalityLabel(entry),
          symbol: "personality_" + index,
          description: personalityDescription(entry),
          value: index,
        }));
        choices.push(getLocalizedChoice(
          T('CharCreate.choice.randomPersonality.name'), "personality_random",
          T('CharCreate.choice.randomPersonality.desc')
        ));
        return choices;
      },
      handler: function (symbol, index) {
        const list = personalityCatalog();
        let picked = -1;
        if (symbol === "personality_random") {
          if (list.length) picked = Math.floor(Math.random() * list.length);
        } else {
          const choice = this.currentStepData().choices[index];
          picked = choice ? choice.value : -1;
        }
        if (picked >= 0) {
          applyPersonalityIndex(Scene_CharacterCreation.getCurrentActorId(), picked);
        }
        this.nextStep();
      },
    },
    {
      // Birth date (Full mode only). Asked per member; skipped in the board modes.
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
      // Origin, where the character starts the game. The last interactive step
      // of every creation run for every mode but Full, which still asks one
      // more thing after this (the hometown step right below): it is reached
      // once per run (arriving here ends the wizard, or hands off to the
      // hometown step), and a run always belongs to a brand new party, so it
      // is NOT showOnlyOnce. It used to be, which meant the completion flag
      // written by the first party silenced the step for every later party
      // built in the same savegame, ending creation with no starting point
      // chosen. Hidden entirely in tutorial mode (the tutorial flow ends at
      // the add-member step, on the tutorial map).
      id: "origin",
      get title() {
        return T('CharCreate.chooseYourOrigin');
      },
      get choices() {
        return [
          getLocalizedChoice(T('CharCreate.choice.originTrain.name'), "origin_train", T('CharCreate.choice.originTrain.desc')),
          getLocalizedChoice(T('CharCreate.choice.originStranded.name'), "origin_stranded", T('CharCreate.choice.originStranded.desc')),
          getLocalizedChoice(T('CharCreate.choice.originSpace.name'), "origin_space", T('CharCreate.choice.originSpace.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCamper.name'), "origin_camper", T('CharCreate.choice.originCamper.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCar.name'), "origin_car", T('CharCreate.choice.originCar.desc')),
          getLocalizedChoice(T('CharCreate.choice.originBike.name'), "origin_bike", T('CharCreate.choice.originBike.desc')),
          getLocalizedChoice(T('CharCreate.choice.originLot.name'), "origin_lot", T('CharCreate.choice.originLot.desc')),
          getLocalizedChoice(T('CharCreate.choice.originDungeon.name'), "origin_dungeon", T('CharCreate.choice.originDungeon.desc')),
          getLocalizedChoice(T('CharCreate.choice.originMayor.name'), "origin_mayor", T('CharCreate.choice.originMayor.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCriminal.name'), "origin_criminal", T('CharCreate.choice.originCriminal.desc')),
          getLocalizedChoice(T('CharCreate.choice.originBunker.name'), "origin_bunker", T('CharCreate.choice.originBunker.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCeo.name'), "origin_ceo", T('CharCreate.choice.originCeo.desc')),
          getLocalizedChoice(T('CharCreate.choice.originArtifact.name'), "origin_artifact", T('CharCreate.choice.originArtifact.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCrash.name'), "origin_crash", T('CharCreate.choice.originCrash.desc')),
          getLocalizedChoice(T('CharCreate.choice.originWarlord.name'), "origin_warlord", T('CharCreate.choice.originWarlord.desc')),
          getLocalizedChoice(T('CharCreate.choice.originFactionLeader.name'), "origin_faction_leader", T('CharCreate.choice.originFactionLeader.desc')),
          getLocalizedChoice(T('CharCreate.choice.originDeserter.name'), "origin_deserter", T('CharCreate.choice.originDeserter.desc')),
          getLocalizedChoice(T('CharCreate.choice.originAugmented.name'), "origin_augmented", T('CharCreate.choice.originAugmented.desc')),
          getLocalizedChoice(T('CharCreate.choice.originCardCollector.name'), "origin_card_collector", T('CharCreate.choice.originCardCollector.desc')),
          getLocalizedChoice(T('CharCreate.choice.originArcanist.name'), "origin_arcanist", T('CharCreate.choice.originArcanist.desc')),
          getLocalizedChoice(T('CharCreate.choice.originMercenary.name'), "origin_mercenary", T('CharCreate.choice.originMercenary.desc')),
          getLocalizedChoice(T('CharCreate.choice.originLostConvoker.name'), "origin_lost_convoker", T('CharCreate.choice.originLostConvoker.desc')),
          getLocalizedChoice(T('CharCreate.choice.originSkeletonKey.name'), "origin_skeleton_key", T('CharCreate.choice.originSkeletonKey.desc')),
          getLocalizedChoice(T('CharCreate.choice.originPlague.name'), "origin_plague", T('CharCreate.choice.originPlague.desc')),
          getLocalizedChoice(T('CharCreate.choice.originDiplomat.name'), "origin_diplomat", T('CharCreate.choice.originDiplomat.desc')),
          getLocalizedChoice(T('CharCreate.choice.originHypernetExplorer.name'), "origin_hypernet_explorer", T('CharCreate.choice.originHypernetExplorer.desc')),
        ];
      },
      handler: function (symbol) {
        // Before a single grant: the state this choice is about to rewrite, kept
        // so the player can walk back out of the starting place picker and pick
        // another origin (see reopenOriginStep).
        captureOriginSnapshot();
        markStepCompleted(STEP.ORIGIN);
        // Full mode asks for a hometown right after Origin, from the full
        // Destinations.json list (see the "hometown" step just below this one
        // in the array); every other mode goes straight into the chosen
        // origin's own starting-place logic, exactly as before.
        if (Scene_CharacterCreation.creationMode() === CC_MODE.FULL) {
          this._pendingOriginSymbol = symbol;
          this.nextStep();
          return;
        }
        this._finishOriginChoice(symbol);
      },
    },
    {
      // Hometown (Full mode only), asked right after Origin: every location in
      // js/db/WorkSystem/Destinations.json, in the same scrollable dropdown
      // list every other long picker in this wizard uses. Stored on
      // $gameSystem._ccHometown before the chosen origin's own starting-place
      // logic runs (see _finishOriginChoice). Every other mode never reaches
      // this step (see _stepHiddenForMode / _stepAutoAdvances).
      id: "hometown",
      get title() {
        return T('CharCreate.chooseYourHometown');
      },
      get choices() {
        const dest = window.WorkSystem && window.WorkSystem.Destinations;
        return getHometownList().map((town) => {
          const country = dest && dest[town] && dest[town].country;
          return getLocalizedChoice(town, town, country || "");
        });
      },
      handler: function (symbol) {
        $gameSystem._ccHometown = symbol;
        markStepCompleted(STEP.HOMETOWN);
        this._finishOriginChoice(this._pendingOriginSymbol);
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
      GENDER: byId.gender,
      CLASS: byId.class,
      TRAITS: byId.traits,
      SPECIALIZATIONS: byId.specializations,
      BIO: byId.bio,
      PERSONALITY: byId.personality,
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
    static _creationMode = null; // CC_MODE.* (runtime; mirrors $gameSystem._ccCreationMode)
    static _randomizedAllParty = false; // True after "Randomize all party" jumped straight to origin
    static _subScreens = [];      // The chain of screens one step hands over to
    static _subScreenIndex = 0;   // Position in that chain: the next one to open
    static _resumeOnStep = false; // Resume ON the interrupted step (Back), not after it

    // ========================================================================
    // Sub-screens: the separate scenes a step hands the player to
    // ========================================================================
    // The name / sprite step used to be common event 97. Reaching it meant
    // popping the wizard off the scene stack, loading the MAP back, waiting for
    // its interpreter to pick the reserved event up, and only then pushing the
    // sprite board; the event pushed the name prompt after it and called back
    // into the wizard through the repriseCreation plugin command. A whole map
    // load in the middle of creation, papered over with a black veil so the
    // player would not see it, and the return trip always landed one step
    // FORWARD - so backing out of either screen skipped the very step the
    // player was trying to get back to.
    //
    // The screens are opened directly now, as a chain with a cursor in it.
    // SceneManager stacks scene CLASSES rather than instances, so closing one
    // always builds a fresh wizard; while the cursor still has somewhere to go
    // that fresh wizard opens the next screen instead of drawing anything (see
    // create), which costs one frame and shows nothing.
    //
    // The cursor is what makes Back mean Back. Confirming a screen advances it;
    // backing out of one rewinds it by two, so the screen BEFORE the one being
    // left is opened again - the player walks the chain backwards exactly as
    // they walked it forwards. Backing out of the first screen has nothing left
    // to rewind to, so the chain ends and the wizard is told to reopen the step
    // that started it.
    static openSubScreens(fromStep, screens) {
      this._interruptedStep = fromStep;
      this._resumeOnStep = false;
      this._subScreens = screens.slice();
      this._subScreenIndex = 0;
      return this._openNextSubScreen();
    }

    // True while the chain still has a screen to open.
    static hasPendingSubScreen() {
      return this._subScreenIndex < this._subScreens.length;
    }

    // Opens the next screen in the chain, skipping any whose scene is not
    // loaded. True when one was opened, false when the wizard should resume.
    static _openNextSubScreen() {
      const actorId = (this._currentPartyMemberIndex || 0) + 1;
      while (this.hasPendingSubScreen()) {
        const screen = this._subScreens[this._subScreenIndex++];
        if (openCreationSubScreen(screen, actorId)) return true;
      }
      return false;
    }

    // Called by a sub-screen the player backed out of instead of confirming.
    static cancelSubScreens() {
      if (this._interruptedStep < 0) return false;
      // The cursor sits one past the screen being left, so -2 lands on the one
      // before it. Below zero there is no earlier screen: end the chain and
      // resume on the step that opened it.
      this._subScreenIndex -= 2;
      if (this._subScreenIndex < 0) {
        this._subScreenIndex = this._subScreens.length;
        this._resumeOnStep = true;
      }
      return true;
    }

    // Drop any chain in progress, for the paths that abandon the whole run.
    static clearSubScreens() {
      this._subScreens = [];
      this._subScreenIndex = 0;
      this._resumeOnStep = false;
    }

    // True while a chain is open, i.e. while the wizard is paused on a member
    // waiting for one of these screens to close.
    static isInSubScreen() {
      return this._interruptedStep >= 0;
    }

    // Where a Back should land, given the step that opened the screen being
    // backed out of. Walks past anything setupStep() would immediately skip,
    // and past a step that does not ask a question of its own but hands
    // straight over to the screen just left - Quick mode's gender step is one,
    // it exists only to open the sprite board, so landing on it would put the
    // player right back where they came from and there would be no way out.
    static backLandingStep(step) {
      const first = this.getStartingStep();
      let s = step;
      while (s > first && (this._stepAutoAdvances(s) || this._stepHandsOverImmediately(s))) {
        s--;
      }
      return Math.max(first, s);
    }

    static _stepHandsOverImmediately(step) {
      return step === STEP.GENDER && !this._isCreatureMode;
    }

    // The mode this party is being built in, as one of CC_MODE. Reads the
    // runtime flag, falling back to the persisted value so reprise paths behave
    // consistently, and answers Normal for anything it cannot make sense of.
    static creationMode() {
      // The tutorial is always a streamlined single-character flow, and it is
      // never asked which mode to run in.
      if (this._tutorialMode) return CC_MODE.NORMAL;
      const mode = this._creationMode || storedCreationMode();
      if (mode === CC_MODE.FULL && !FULL_CREATION_MODE_ENABLED) return CC_MODE.NORMAL;
      if (mode === CC_MODE.QUICK || mode === CC_MODE.FULL || mode === CC_MODE.DETAILED) {
        return mode;
      }
      return CC_MODE.NORMAL;
    }

    // True when the party is being built in Quick mode: the fast three-question
    // flow (name, sprite, class), everything else settled from those answers.
    static isQuickMode() {
      return this.creationMode() === CC_MODE.QUICK;
    }

    // True when the party is being built in Normal mode, the wizard's ordinary
    // per-character flow (this is what used to be called Quick, before the
    // faster mode above took the name).
    static isNormalMode() {
      return this.creationMode() === CC_MODE.NORMAL;
    }

    // True for both of the wizard's own board-driven flows, as opposed to Full
    // (the detailed life sim) and Detailed (the Empathize dossier editor).
    // Everything they share , the inline class list and its two-column layout ,
    // keys off this rather than off one mode.
    static usesQuickFlow() {
      const mode = this.creationMode();
      return mode === CC_MODE.QUICK || mode === CC_MODE.NORMAL;
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

    // True when the CLASS step lists the whole sentient roster inline, one
    // class to a card, with the highlighted one's dossier on the right page.
    // Quick and Normal only: Full mode opens the detailed class browser,
    // creature mode has its own base/hybrid picker and the tutorial defaults to
    // Mana Cyborg.
    static usesFullClassList() {
      return this.usesQuickFlow() && !this._isCreatureMode && !this._tutorialMode;
    }

    // Steps that are skipped purely because of the chosen creation mode (as
    // opposed to tutorial/creature/member-index rules). Used by both
    // _stepAutoAdvances (Back/Forward) and setupStep (forward skip).
    static _stepHiddenForMode(step) {
      if (this.isQuickMode()) {
        // Quick mode asks three things and settles the rest from them: the
        // name and the sprite (the gender step opens both screens itself),
        // then the class. The portrait is always the bust the sprite comes
        // with, gender and body archetype are read off that sprite's NPCs.json
        // record, traits are rolled and the personality stays the one the
        // society generator dealt this name.
        //
        // The gender step itself is NOT hidden: it is the step that opens the
        // name / sprite screens (setupStep), so Back must still land on it.
        if (step === STEP.TRAITS) return true;
        if (step === STEP.PERSONALITY) return true;
        if (step === STEP.HOMETOWN) return true;
        if (step === STEP.BIRTHDATE) return true;
        return false;
      }
      if (!this.isNormalMode()) return false;
      // Normal mode: trait selection is interactive (same as Full, first member
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
        if (step === STEP.PERSONALITY) return true;          // personality left as rolled
        if (step === STEP.CLASS) return true;                // class fixed to Mana Cyborg
        if (step === STEP.ADD_MEMBER) return true;           // single-character party (ends)
      }
      // Creation mode is never asked during the tutorial: it is always a
      // streamlined single-character flow, so it goes straight to the humanoid /
      // creature choice. Guarded on the switch as well as the in-scene flag
      // (same as the origin step), since the flag is cleared at add-member.
      // The exception is Detailed mode, which the tutorial does offer, so the
      // step stays interactive whenever that plugin is loaded.
      if (step === STEP.CREATION_MODE && isTutorialFlow() && !detailedModeAvailable()) return true;

      // Detailed mode: the character-type step hands the whole member over to
      // the Empathize editor, so every step it covers is walked past by
      // Back/Forward and the editor is the only landing point per member.
      if (Scene_CharacterCreation.isDetailedMode() && detailedModeAvailable() &&
          [STEP.GENDER, STEP.CLASS, STEP.TRAITS, STEP.PERSONALITY,
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
      if (step === STEP.TRAITS && memberIndex >= 1) return true;      // members 2/3 auto traits
      // Nothing to choose between without PersonalityData.json loaded; the
      // profile keeps whatever the society generator rolled.
      if (step === STEP.PERSONALITY && personalityCatalog().length === 0) return true;
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
      // The class roster's search strip and element filter live on the class,
      // so a run that ended mid-search would otherwise open the next one on a
      // roster narrowed to something nobody typed.
      this._classSearchQuery = "";
      this._classHoverIndex = -1;
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

    // Applied from the 3D Political Graph's onSelect callback, which fires
    // during confirmSelection() - before SceneManager has swapped _scene back
    // to the wizard, so SceneManager._scene is still the graph itself there.
    // Writing straight onto the actor sidesteps that stale reference; the
    // wizard picks the new value up on its own next render.
    static applyIdeologySelection(id) {
      const actor = this.getCurrentActor();
      if (!actor || !id) return;
      actor._ideologyId = id;
      actor._bioSet = true;
      if (window.NPCSociety && window.NPCSociety.getActorProfile) {
        const prof = window.NPCSociety.getActorProfile(actor.actorId());
        if (prof) prof.ideologyId = id;
      }
    }
    // Detailed mode: hand this member over to the Empathize editor
    // (CharacterCreationFull.js) instead of walking the wizard's own
    // per-character steps. The editor resumes the wizard at the add-member
    // prompt when it closes, so the steps it covers (portrait, gender, class,
    // traits, hometown, birth date) are never reached; _stepAutoAdvances walks
    // Back past them for the same reason. Answers true when it has taken over.
    startDetailedEditor(memberIndex) {
      if (!Scene_CharacterCreation.isDetailedMode() || !detailedModeAvailable()) return false;
      this._ccHandingOver = true;
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
      if (availablePresets().length === 0) {
        SoundManager.playBuzzer();
        if (this._gridWindow) this._gridWindow.activate();
        return;
      }
      // A party carries one dossier at most: it is the dossier that decides the
      // purse, the kit and where the party wakes up.
      if (this._hasPresetInParty(true)) {
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
      if (!this._presetTitleWindow) this.createPresetTitleWindow();
      if (!this._presetWindow) this.createPresetWindow();
      if (this._presetWindow) {
        this._presetWindow.select(0);
        this._presetWindow.activate();
      }
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
    // Taking a dossier fills the member's seat and nothing else. It used to
    // set the party down on the dossier's own map the instant it was picked,
    // which ended creation before the other two seats could be filled; the
    // landing is remembered here and only walked when the party is confirmed.
    onPresetSelect() {
      const index = this._presetWindow ? this._presetWindow.index() : 0;
      this.onApplyPresetToCurrentMember(index);
    }

    // Where a taken dossier means to put the party down, kept until the party
    // is confirmed. Cleared on the way out (see onFinishPartyCreation).
    _recordPresetLanding(preset) {
      if (!preset) return;
      $gameSystem._ccPresetLanding = {
        id: preset.id,
        name: preset.name,
        mapId: preset.mapId,
        x: preset.x,
        y: preset.y,
        tutorialOnly: !!preset.tutorialOnly
      };
    }

    // The landing a taken dossier asked for, walked at the end of creation
    // instead of at the moment the dossier was picked. Returns true when it
    // took the party somewhere, so the scenario logic knows to stand down.
    _walkPresetLanding() {
      const landing = $gameSystem._ccPresetLanding;
      if (!landing) return false;
      $gameSystem._ccPresetLanding = null;

      $gameSwitches.setValue(13, true);
      $gameSwitches.setValue(33, true);
      markFirstCreationComplete();
      grantMinimumCards();

      if (landing.tutorialOnly) {
        Scene_CharacterCreation._tutorialMode = false;
        beginTutorialControlsLegend();
      } else {
        const target = $dataMapInfos && $dataMapInfos[landing.mapId];
        if ($gameTemp) $gameTemp._ccOriginLanding = true;
        if (startsAtOmegaTower()) {
          startAtOmegaTower();
        } else if (target) {
          $gamePlayer.reserveTransfer(landing.mapId, landing.x, landing.y, 2, 0);
        } else {
          console.error(
            `CharacterCreation: preset "${landing.name}" points at missing map ${landing.mapId}; staying put`
          );
        }
      }
      return true;
    }

    // Applies one preset dossier (class, inventory, skills, traits, gear,
    // switches) onto the actor being created. `skinData` is the look picked on
    // the dossier page; without one the dossier's own sprite and bust stand.
    _applyPreset(preset, actor, skinData) {
      const look = skinData || presetSkins(preset)[0] || preset;

      // Mark preset properties on actor
      actor._isPresetActor = true;
      actor._presetKey = (preset.name || preset.id || "").toString().toLowerCase();
      actor._presetName = preset.name;
      actor._presetId = preset.id;

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

      if (preset.characterType === "creature") {
        if (Array.isArray(preset.archetypes) && preset.archetypes.length > 0 &&
            typeof window.applyCreatureSelection === "function") {
          const mode = preset.archetypes.length >= 2 ? "hybrid" : "baseline";
          window.applyCreatureSelection(
            actor.actorId(),
            mode,
            preset.archetypes[0],
            preset.archetypes[1] || null,
            null,
            null
          );
        }
      } else {
        // A humanoid dossier must not inherit a creature flag left over from
        // whatever the seat was set to before the preset was applied, or its
        // bust never shows: _getActorBust treats any creature-flagged actor
        // as a monster drawn from its 3D model instead of a 2D portrait.
        actor._isCreatureActor = false;
        const slot = $gameParty.members().indexOf(actor);
        if (slot >= 0) $gameSwitches.setValue(77 + slot, false);
        if (actor.setPortraitMode) actor.setPortraitMode("bust");
        Scene_CharacterCreation._isCreatureMode = false;
      }

      // Apply preset traits if defined
      if (preset.traits && Array.isArray(preset.traits) && preset.traits.length > 0) {
        actor._selectedTraits = [...preset.traits];
        if (typeof applyTraitsToActor === 'function') {
          applyTraitsToActor(actor, preset.traits);
        }
      }

      // Apply preset specializations
      if (preset.specializations && Array.isArray(preset.specializations)) {
        if (!actor._specTrained) actor._specTrained = {};
        preset.specializations.forEach((entry) => {
          if (entry && entry.id) {
            actor._specTrained[entry.id] = entry.level;
            if (actor.setSpecializationTrainedLevel) {
              actor.setSpecializationTrainedLevel(entry.id, entry.level);
            }
          }
        });
      }

      // Equip items from preset
      (preset.equips || []).forEach((entry, slotId) => {
        const itemId = (entry && typeof entry === 'object') ? entry.id : entry;
        if (itemId > 0) {
          const isWeapon = (entry && typeof entry === 'object')
            ? !!entry.w
            : actor.equipSlots()[slotId] === 1;
          const item = isWeapon ? $dataWeapons[itemId] : $dataArmors[itemId];
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

      if (look.busts) {
        actor.setVnBust(look.busts);
        if (actor.setPortraitMode) actor.setPortraitMode("bust");
      }

      // Set switches
      if (preset.switches && Array.isArray(preset.switches)) {
        preset.switches.forEach((switchId) => {
          $gameSwitches.setValue(switchId, true);
        });
      }

      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const creatureSwitchId = 77 + currentMemberIndex;

      if (preset.characterType) {
        $gameSwitches.setValue(creatureSwitchId, preset.characterType === "creature");
      } else if (preset.isCreature !== undefined) {
        $gameSwitches.setValue(creatureSwitchId, preset.isCreature);
      } else {
        $gameSwitches.setValue(creatureSwitchId, false);
      }

      if (preset.gender !== undefined) {
        $gameVariables.setValue(38 + currentMemberIndex, preset.gender);
        actor._gender = preset.gender;
        if (actor.setGender) actor.setGender(preset.gender);
      }

      window.CharacterPresets?.applyPresetIdentity?.(preset, actor);
      window.CharacterPresets?.applyPresetVehicle?.(preset);

      // A dossier is played as it was written, so the Bio page it hands over is
      // already answered rather than sitting on its own defaults with nobody
      // allowed to touch them.
      this._initPresetBio(preset, actor);

      actor.refresh();
    }

    // The bio a dossier implies. Age comes off its birth date, wealth off its
    // purse, and everything the dossier does not state is settled from its own
    // id so the same person is always the same person.
    _initPresetBio(preset, actor) {
      if (!preset || !actor) return;
      const memberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      actor._bioSet = true;

      const nowYear = (window.TimeDateSystem && window.TimeDateSystem.getCurrentDateObj)
        ? window.TimeDateSystem.getCurrentDateObj().getFullYear() : 2012;
      const birthYear = parseInt(String(preset.birthDate || "").slice(0, 4), 10);
      if (!isNaN(birthYear)) {
        const age = Math.max(1, nowYear - birthYear);
        if (!$gameSystem._ccBirthAge) $gameSystem._ccBirthAge = [];
        $gameSystem._ccBirthAge[memberIdx] = age;
      }

      // Euros, the way the rest of the game counts money: destitute under 200,
      // working class under 1000, middle class under 5000, wealthy above it.
      const euros = (Number(preset.money) || 0) / 100;
      actor._wealthTier = euros >= 5000 ? 3 : euros >= 1000 ? 2 : euros >= 200 ? 1 : 0;

      if (actor._morality == null) actor._morality = 0;
      if (!actor._jobId) actor._jobId = 0;

      if (!actor._ccBloodType && !actor._bloodType) {
        const bloods = (window.BloodTypeService && window.BloodTypeService.list && window.BloodTypeService.list()) || [];
        const common = bloods.filter((b) => b && b.rarityKey === "common");
        const pool = common.length ? common : bloods;
        if (pool.length) {
          const blood = pool[(Number(preset.id) || 0) % pool.length];
          actor._ccBloodType = blood.id;
          actor._bloodType = blood.id;
          if (window.BloodTypeService && window.BloodTypeService.setForActor) {
            window.BloodTypeService.setForActor(actor, blood.id);
          }
        }
      }
    }

    onPresetCancel() {
      // The tutorial's dossier choice is mandatory: there is nowhere to back
      // out to (see startTutorialPresetSelection), so the board stays open.
      if (Scene_CharacterCreation._tutorialMode) {
        SoundManager.playBuzzer();
        return;
      }

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
      const SC = Scene_CharacterCreation;

      // The chain still has a screen to open, so this instance exists only to
      // open it (see create). The resume point belongs to the instance that
      // will actually use it, so leave it alone.
      this._isSubScreenRelay = SC.hasPendingSubScreen();
      if (this._isSubScreenRelay) {
        this._step = SC._interruptedStep;
        return;
      }

      // Resuming from a screen the step handed the player to (the sprite board,
      // the name prompt, the creature builder, the trait selector). Confirming
      // one moves the wizard on; BACKING OUT of the first screen of a chain
      // sets _resumeOnStep, and then the wizard reopens the step that started
      // it - or the last real question before it, where that step is one that
      // would only hand straight back over (see backLandingStep).
      if (SC._interruptedStep >= 0) {
        if (SC._resumeOnStep) {
          this._step = SC.backLandingStep(SC._interruptedStep);
        } else {
          this._step = SC._interruptedStep + 1;
        }
        SC._interruptedStep = -1;
        SC._resumeOnStep = false;
      } else {
        this._step = SC._startStep;
        SC._startStep = 0;
      }

      // Reset traits flag for a fresh character creation, i.e. when starting at
      // (or before) the first interactive step rather than resuming mid-flow.
      if (this._step <= SC.getStartingStep()) {
        SC._traitsProcessed = false;
        SC._currentPartyMemberIndex = 0;
        // Start character creation with only 1 character (Actor 1)
        if ($gameParty && $gameParty.members().length > 1) {
          const extraMembers = $gameParty.members().slice(1);
          extraMembers.forEach(m => $gameParty.removeActor(m.actorId()));
        }
      }
    }

    create() {
      // Relay: a queued sub-screen is opened before anything is built, so this
      // instance draws nothing at all and is gone on the next frame. Only the
      // bare scene skeleton is set up - no background snapshot, no windows, no
      // DOM overlay - which is what keeps the hop invisible.
      if (this._isSubScreenRelay) {
        Scene_Base.prototype.create.call(this);
        this.createWindowLayer();
        if (!Scene_CharacterCreation._openNextSubScreen()) {
          // Every remaining screen turned out to be unavailable: fall through
          // and build the wizard normally, on the step after the one that
          // opened the chain (what it was waiting for is simply not there).
          this._isSubScreenRelay = false;
          this._step = Scene_CharacterCreation._interruptedStep + 1;
          Scene_CharacterCreation._interruptedStep = -1;
          Scene_CharacterCreation._resumeOnStep = false;
        } else {
          return;
        }
      }

      super.create();
      // Ambient loops carried over from wherever the game was before (a biome
      // BGS from the previous playthrough, a map ambience behind the title)
      // would keep running under the whole wizard, so silence them on entry.
      AudioManager.stopBgs();
      // Cached after the first call, so every entry point into the wizard can
      // ask for it and only the first one pays.
      warmCreationAssets();
      this.createTitleWindow();
      this.createGridWindow();
      if (Scene_CharacterCreation._tutorialMode) {
        // The tutorial never builds a character step by step: it opens
        // straight onto its own three-dossier board (see
        // startTutorialPresetSelection), the same preset UI used everywhere
        // else in the wizard.
        this.startTutorialPresetSelection();
      } else {
        this.setupStep();
      }
      this.createUIOverlay();
    }

    // Applies the defaults the tutorial's SETTINGS/DIFFICULTY/COMBAT_MODE
    // steps used to set silently (roguelite difficulty, classic RPG combat,
    // Map Battle off), then opens the tutorial's own preset board in place
    // of the step-by-step wizard.
    startTutorialPresetSelection() {
      $gameSwitches.setValue(9, false);   // permadeath off (roguelite)
      $gameSystem._bloodAndOilMode = false;
      $gameSwitches.setValue(45, false);  // card combat off
      $gameSwitches.setValue(46, false);  // monster mode off
      if (!hasCompletedFirstCreation()) {
        ConfigManager.mapBattleMode = false;
        ConfigManager.save();
      }
      if (window.CharacterPresets && typeof window.CharacterPresets.resetTutorialPresetRolls === "function") {
        window.CharacterPresets.resetTutorialPresetRolls();
      }
      // showPresetSelection()'s DOM renderer only reads this._step to rule
      // out the settings step; park it on a harmless index first (the same
      // one the ordinary "existing character" choice leaves it on).
      this._step = STEP.CREATION_MODE;
      this.showPresetSelection();
    }

    // Leaving the wizard, whether for good or only as far as one of the screens
    // a step opens. The overlay is torn down at once rather than faded: the
    // screen that follows shares the very same #character-creation-container
    // and starts filling it on the same frame, so a 200ms fade-out was 200ms of
    // the NEXT screen sitting there half transparent, which read as the wizard
    // being slow. A scene change is already its own transition.
    terminate() {
      super.terminate();
      if (window.EmRestlessBubble) window.EmRestlessBubble.release();
      const container = this._dndContainer;
      if (!container) return;
      if (window._ccOverlayTimeout) {
        clearTimeout(window._ccOverlayTimeout);
        window._ccOverlayTimeout = null;
      }
      container.style.transition = "none";
      container.innerHTML = "";
      container.style.display = "none";
      container.style.opacity = "1";
      container.style.pointerEvents = "auto";
    }

    createUIOverlay() {
      // A step handed this member over to another screen from setupStep(),
      // which runs before this - the Empathize editor in Detailed mode, or the
      // sprite board in Quick mode, where the gender question is never put.
      // Paint nothing, or the wizard's board would flash for the frame before
      // the scene change lands.
      if (this._ccHandingOver) return;
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

    // ── RPG Maker IconSet Renderer (Icons.json reference) ──
    _ccIconHtml(iconIndex, size = 24) {
      if (iconIndex == null || iconIndex < 0) return "";
      const col = iconIndex % 16;
      const row = Math.floor(iconIndex / 16);
      return `<span class="cc-rpg-icon" style="background-image: url('img/system/IconSet.png'); background-size: ${size * 16}px auto; background-position: -${col * size}px -${row * size}px; width: ${size}px; height: ${size}px; image-rendering: pixelated; display: inline-block; vertical-align: middle; flex-shrink: 0;"></span>`;
    }

    // The thumbnail a party tab wears: the member's own walking sprite, facing
    // the reader and zoomed onto the head and shoulders, so a tab is read by
    // the face on it rather than by a coloured dot. A slot with no sprite yet
    // keeps the dot, which is all there is to say about an empty seat.
    _ccTabPortraitHtml(actor, isDone) {
      const spriteName = actor && actor.characterName && actor.characterName();
      if (!spriteName) {
        return `<span class="cc-tab-dot ${isDone ? 'done' : ''}"></span>`;
      }
      const style = this.getSpriteStyle(spriteName, actor.characterIndex());
      return `
        <span class="cc-tab-portrait ${isDone ? 'done' : ''}">
          <span class="cc-tab-portrait-sprite" style="${style}"></span>
        </span>
      `;
    }

    // ── Item Hover Tooltip Handlers ──
    onItemHover(event, type, id, qty) {
      let item = null;
      if (type === "weapon") item = $dataWeapons[id];
      else if (type === "armor") item = $dataArmors[id];
      else if (type === "skill") item = $dataSkills[id];
      else item = $dataItems[id];
      if (!item) return;

      let tooltip = document.getElementById("cc-item-tooltip");
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "cc-item-tooltip";
        tooltip.className = "cc-item-tooltip";
        document.body.appendChild(tooltip);
      }

      const name = window.CCDbName(item);
      const desc = item.description || ccT('CharCreate.standardIssueGear', "Standard issue item or gear.");
      const iconHtml = this._ccIconHtml(item.iconIndex, 20);
      const typeLabel = type ? type.toUpperCase() : "ITEM";
      // A skill has no shop price, so the card that describes one says what it
      // costs to cast instead of pretending it is for sale.
      const isSkill = type === "skill";
      const price = !isSkill && item.price ? `${item.price}€` : "";

      let statsHtml = "";
      if (isSkill) {
        if (item.mpCost > 0) {
          statsHtml += `<span class="ts-badge neg">${T('SkillMaster.mpLabel')} ${item.mpCost}</span> `;
        }
        if (item.tpCost > 0) {
          statsHtml += `<span class="ts-badge neg">${T('SkillMaster.apLabel')} ${item.tpCost}</span> `;
        }
        // What the skill is trained as, so a spell on the growth plan can be
        // read as the specialization it belongs to.
        const spec = window.SkillSpecs && window.SkillSpecs.forSkill
          ? window.SkillSpecs.forSkill(item) : null;
        const specName = spec && (window.Specializations && window.Specializations.displayName
          ? window.Specializations.displayName(spec) : spec.name);
        if (specName) statsHtml += `<span class="ts-badge pos">${specName}</span> `;
      } else if (item.params) {
        const statNames = ["MHP", "MMP", "ATK", "DEF", "MAT", "MDF", "AGI", "LUK"];
        item.params.forEach((v, idx) => {
          if (v !== 0) {
            statsHtml += `<span class="ts-badge ${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : ''}${v} ${statNames[idx]}</span> `;
          }
        });
      }

      tooltip.innerHTML = `
        <div class="cc-item-tooltip-header">
          ${iconHtml}
          <span class="cc-item-tooltip-title">${name}</span>
          <span class="cc-item-tooltip-type">${typeLabel}</span>
        </div>
        <div class="cc-item-tooltip-desc">${desc}</div>
        ${statsHtml ? `<div class="cc-item-tooltip-stats">${statsHtml}</div>` : ""}
        ${price ? `<div class="cc-item-tooltip-price">${ccT('CharCreate.estimatedValue', 'Estimated Value')}: ${price}</div>` : ""}
      `;

      tooltip.style.display = "block";
      const mouseX = (event && event.clientX) || 100;
      const mouseY = (event && event.clientY) || 100;
      tooltip.style.left = `${Math.min(window.innerWidth - 330, mouseX + 16)}px`;
      tooltip.style.top = `${Math.min(window.innerHeight - 180, mouseY + 16)}px`;
    }

    onItemLeave() {
      const tooltip = document.getElementById("cc-item-tooltip");
      if (tooltip) tooltip.style.display = "none";
    }

    // ── Top Folder Tabs (Party Tabs Left, Step Tabs Right) ──
    _renderTopFolderTabsHtml() {
      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isPetActive = !!Scene_CharacterCreation._isPetMode;
      const isScenarioMode = !!Scene_CharacterCreation._isScenarioMode || this._step === STEP.ORIGIN;
      const isSettingsActive = (this._step === STEP.SETTINGS) || (CharacterCreationData[this._step] && CharacterCreationData[this._step].isSettingsStep);
      const partyMembers = $gameParty ? $gameParty.members() : [];
      const partySize = partyMembers.length;

      // Which slot of the rail the pad is resting on, when it is resting on one
      // that is not also the open page (the empty party slot).
      const railFocus = Scene_CharacterCreation._railFocus;

      // 0. Settings Tab (First Tab on the Left)
      const settingsTabHtml = `
        <div class="cc-folder-tab ${isSettingsActive ? 'active' : ''}" onclick="SceneManager._scene.onSettingsTabClick()" title="${ccT('CharCreate.initialSettings', 'Initial Settings')}">
          ${this._ccIconHtml(SETTINGS_TAB_ICON, 16)}
          <span>${ccT('CharCreate.settings', 'Settings')}</span>
        </div>
      `;

      // 1. Top Left: Party Member Tabs + Pet Slot
      const partyTabsHtml = partyMembers.map((partyActor, idx) => {
        const name = partyActor.name() || `Member ${idx + 1}`;
        const isActive = !isSettingsActive && !isScenarioMode && !isPetActive && idx === currentMemberIndex;
        const isComp = partyActor.name() && partyActor._classId > 0 && partyActor.characterName();
        const roman = idx === 0 ? 'I' : (idx === 1 ? 'II' : 'III');
        const isLeader = idx === 0;

        const removeBtn = !isLeader ? `
          <span class="cc-tab-remove-x" title="${ccT('CharCreate.deleteMember', 'Remove Member')}" onclick="event.stopPropagation(); SceneManager._scene.onRemovePartyMember(${idx}, event)">
            ✕
          </span>
        ` : '';

        return `
          <div class="cc-folder-tab ${isActive ? 'active' : ''}" onclick="SceneManager._scene.onPartyMemberTabClick(${idx})">
            ${this._ccTabPortraitHtml(partyActor, isComp)}
            <span><b>${roman}</b> ${name}</span>
            ${removeBtn}
          </div>
        `;
      }).join("");

      // The empty seat. The pad walks onto it like any other tab (it is the slot
      // L1/R1 stop on when the party is short a member) and Confirm fills it.
      const addBtnHtml = partySize < 3 ? `
        <div class="cc-folder-tab cc-tab-add-plus ${railFocus === 'add' ? 'selected' : ''}" title="${ccT('CharCreate.addPartyMember', 'Add Member')}" onclick="SceneManager._scene.onAddPartyMember()">
          +
        </div>
      ` : '';

      const pet = $gameSystem._partyPet;
      const petName = pet ? pet.name : ccT('CharCreate.companion', "Pet / Follower");
      const removePetBtn = pet ? `
        <span class="cc-tab-remove-x" title="${ccT('CharCreate.releasePet', 'Release Companion')}" onclick="event.stopPropagation(); SceneManager._scene.onRemovePet(event)">
          ✕
        </span>
      ` : '';

      const petTabHtml = `
        <div class="cc-folder-tab cc-pet-tab ${!isSettingsActive && !isScenarioMode && isPetActive ? 'active' : ''}" onclick="SceneManager._scene.onPetTabClick()">
          <span class="cc-tab-dot ${pet ? 'done' : ''}"></span>
          <span>${petName}</span>
          ${removePetBtn}
        </div>
      `;

      // 2. Top Right: Creation Step Tabs
      const tabs = this._getCreationTabs();
      const isPreset = !!this._presetWindow;

      // The settings page belongs to no character, so the step rail that edits one
      // is not drawn beside it: it would offer six tabs none of which can be the
      // open page.
      const stepTabsHtml = isSettingsActive ? '' : isScenarioMode ? `
        <div class="cc-folder-tab active" onclick="SceneManager._scene.onReturnToPartyDossier()">
          ${this._ccIconHtml(190, 16)} <span>${ccT('CharCreate.scenarioShared', "Scenario & Origin")}</span>
        </div>
      ` : tabs.map((tab) => {
        if (tab.id === "origin") return ""; // Origin is moved to dedicated scenario confirm
        const isTabActive = !isSettingsActive && !isPreset && !isPetActive && (this._step === tab.step || (tab.id === 'archetype' && this._step === STEP.GENDER));
        const isCompleted = this._isTabCompleted(tab.id);

        return `
          <div class="cc-folder-tab ${isTabActive ? 'active' : ''}" onclick="SceneManager._scene.onTabClick(${tab.step}, '${tab.id}')">
            ${this._ccIconHtml(tab.iconIndex, 16)}
            <span>${tab.title.replace(/\s*\(Optional\)/i, "")}</span>
            ${isCompleted ? '<span class="cc-tab-done-mark">✓</span>' : ''}
          </div>
        `;
      }).join("");

      // The scenario page is the party's, not any one member's: the rail of
      // member tabs would offer pages that cannot be opened from here, so the
      // scenario tab stands alone.
      const leftTabsHtml = isScenarioMode ? '' : `
            ${settingsTabHtml}
            ${partyTabsHtml}
            ${addBtnHtml}
            ${petTabHtml}`;

      return `
        <div class="cc-dossier-top-bar">
          <div class="cc-folder-tabs-left">
            ${leftTabsHtml}
          </div>
          <div class="cc-folder-tabs-right">
            ${stepTabsHtml}
          </div>
        </div>
      `;
    }

    // ── Helper methods for connected busts and currency ──
    _formatGoldToEuros(gold) {
      const euros = (Number(gold) || 0) / 100;
      const isIt = (typeof ConfigManager !== 'undefined' && ConfigManager.language === 'it');
      return euros.toLocaleString(isIt ? 'it-IT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€';
    }

    // True when this member is a monster, whichever way it was made one: the
    // flag the creature builder writes, a monstrous class, or the per-slot
    // creature switch the character-type step sets.
    _isCreatureActorFor(actor) {
      if (!actor) return false;
      if (actor._isCreatureActor) return true;
      const CC = window.CreatureClasses;
      if (CC && CC.isCreatureClass && actor._classId && CC.isCreatureClass(actor._classId)) return true;
      const members = ($gameParty && $gameParty.members()) || [];
      const slot = members.indexOf(actor);
      if (slot >= 0 && typeof $gameSwitches !== "undefined" && $gameSwitches.value(77 + slot)) return true;
      return false;
    }

    _getActorBust(actor) {
      if (!actor) return null;
      // A monster has no bust: it is drawn as the model it was sculpted from,
      // and a 2D portrait borrowed off a sprite sheet would be somebody else.
      if (this._isCreatureActorFor(actor)) return null;
      if (actor.vnBust && actor.vnBust()) return actor.vnBust();
      const spriteName = actor.characterName();
      const spriteIndex = actor.characterIndex();
      let busts = null;
      if (window.SpriteCatalog && window.SpriteCatalog.busts) {
        busts = window.SpriteCatalog.busts(spriteName);
      }
      if ((!busts || !busts.length) && window.Sprites && window.Sprites.SpritesAssociation) {
        busts = window.Sprites.SpritesAssociation[spriteName];
      }
      if (busts && busts.length) {
        return busts[spriteIndex] !== undefined && busts[spriteIndex] !== null ? busts[spriteIndex] : busts[0];
      }
      return null;
    }

    // Every portrait the wizard paints comes through here, and it is drawn as
    // a CSS background, which has no onerror to catch a miss. window.BustPath
    // is what knows where a name's file really is (a dossier's portrait lives
    // in img/busts/presets/, everybody else's in the flat folder), so a name
    // that resolves to nothing becomes the house bust rather than an empty
    // frame and a load error. A character with no bust at all still answers ""
    // so the panels that draw a 3D body instead keep drawing it.
    _getBustUrl(bustName) {
      if (!bustName) return "";
      if (window.BustPath) return window.BustPath.url(bustName, "img/busts/7.png");
      const raw = String(bustName).replace(/^img\/busts\//i, "").replace(/\.png$/i, "");
      return `img/busts/${raw}.png`;
    }

    _hasPresetInParty(excludeCurrentMember = true) {
      const currentIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      for (let i = 0; i < 3; i++) {
        if (excludeCurrentMember && i === currentIdx) continue;
        const actor = $gameActors.actor(i + 1);
        if (actor && actor._isPresetActor) return true;
      }
      return false;
    }

    _isActorLockedPreset(actor) {
      if (!actor) actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor || !actor._isPresetActor) return false;
      const name = (actor._presetName || actor.name() || "").trim().toLowerCase();
      const key = (actor._presetKey || "").trim().toLowerCase();
      if (name === "em" || key === "em") {
        return false;
      }
      return true;
    }

    // Drops a taken dossier's lock: the type pills are the one way out of one
    // (see onSetCharacterType), since every other control refuses to touch a
    // locked preset actor and there would otherwise be no way back from a
    // dossier picked by mistake. The dossier itself goes back into the
    // world's pool, since this playthrough never actually kept it.
    _clearPresetLock(actor) {
      if (!actor || !actor._isPresetActor) return;
      if (actor._presetId && typeof unmarkPresetUsed === "function") {
        unmarkPresetUsed(actor._presetId);
      }
      if ($gameSystem && $gameSystem._currentPresetId === actor._presetId) {
        $gameSystem._currentPresetId = 0;
      }
      actor._isPresetActor = false;
      actor._presetKey = "";
      actor._presetName = "";
      actor._presetId = 0;
    }

    // True when the seat being edited holds a dossier that is played as it was
    // written. Every control that would rewrite the character asks this first,
    // so a taken dossier keeps the class, face, bio and kit it came with.
    _presetEditBlocked() {
      if (this._presetWindow) return false;   // the dossier board itself is not a member sheet
      return this._isActorLockedPreset(Scene_CharacterCreation.getCurrentActor());
    }

    // The same question, answered out loud: the buzzer is how the board says no.
    _refusePresetEdit() {
      if (!this._presetEditBlocked()) return false;
      SoundManager.playBuzzer();
      return true;
    }

    // ── Compact Left Sidebar Column ──
    // One loadout line: icon, name, and an optional value on the right. The
    // sidebar, the class dossier and the scenario sheet all print their skills
    // and their kit through this, so the three lists read as the same list.
    _ccLoadoutRowHtml(iconIndex, name, value, opts) {
      const o = opts || {};
      const hover = o.hover || "";
      return `
        <div class="cc-compact-loadout-item"
             style="display:flex; justify-content:space-between; align-items:center; padding:3px 2px; background:transparent !important; border:none !important; box-shadow:none !important;${hover ? ' cursor:pointer;' : ''}" ${hover}>
          <span class="cc-dossier-label" style="display:flex; align-items:center; gap:8px; font-size:1.02rem; color:${o.nameColor || '#fff'}; font-weight:bold; font-family:'Lora',serif; min-width:0;">
            <span class="cc-loadout-icon" style="flex-shrink:0;">${this._ccIconHtml(iconIndex, 18)}</span>
            <span class="cc-loadout-name">${name}</span>
          </span>
          ${value ? `<span class="cc-dossier-value" style="font-size:1.02rem; font-weight:bold; color:${o.valueColor || '#fff'}; font-family:'Lora',serif; margin-left:8px; flex-shrink:0;">${value}</span>` : ''}
        </div>
      `;
    }

    // The hover attributes any loadout row wears to raise the inspect card.
    // Items had one and skills did not, so the sidebar could tell you what a
    // sling does but not what a spell does.
    _ccHoverAttrs(type, id, qty) {
      return `onmouseenter="SceneManager._scene.onItemHover(event, '${type}', ${id}, ${qty == null ? 1 : qty})" onmouseleave="SceneManager._scene.onItemLeave()"`;
    }

    // A loadout block: the sidebar's gold rule with its tally, then the rows.
    // `open` lets the rows run their full length instead of scrolling inside
    // the sidebar's short well, which is what a dossier page wants. `extraClass`
    // switches the rows from the default single column to another layout, e.g.
    // the class dossier's weapon proficiencies, which read better as a grid.
    _ccLoadoutSectionHtml(title, count, rowsHtml, emptyText, open, extraClass) {
      return `
        <div style="margin-top:2px;">
          <div style="font-size:1.05rem; font-weight:bold; color:#ffd700; border-bottom:1px solid rgba(218,165,32,0.3); padding-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
            <span>${title}</span>
            ${count === null || count === undefined ? '' : `<span style="font-size:0.85rem; color:#ffd700; opacity:0.85;">${count}</span>`}
          </div>
          <div class="cc-compact-loadout-grid ${open ? 'cc-loadout-open' : ''} ${extraClass || ''}">
            ${rowsHtml || `<span style="font-size:0.88rem; color:rgba(255,255,255,0.45); font-style:italic; padding:6px; text-align:center;">${emptyText || ''}</span>`}
          </div>
        </div>
      `;
    }

    _renderCompactSidebarHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      // Guarded before the actor is read, not after: with no current member the
      // three reads below threw and took the whole overlay refresh with them,
      // leaving a blank screen instead of an empty sidebar.
      if (!actor) return `<div class="cc-compact-sidebar"></div>`;

      // The companion board reads its own dossier down the sidebar, the way a
      // character does: the picked beast, its numbers and its nature, with the
      // whole board left over for the roster.
      if (Scene_CharacterCreation._isPetMode) return this._petSidebarHtml();

      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isCreature = !actor._isPresetActor && !this._presetWindow && !!(actor._isCreatureActor || $gameSwitches.value(77 + currentMemberIndex));
      const isPreset = !!this._presetWindow;
      const isPetActive = false;

      const isLocked = this._isActorLockedPreset(actor);

      const classData = $dataClasses[actor._classId];
      const className = classData ? window.CCDbName(classData) : "Class";
      // The identity card reads as an occupation, not a body: "{job} {class}",
      // e.g. "Jobless Witch". The job is the same one the Bio tab tracks
      // (actor._jobId, 0 = jobless), so both places always agree.
      const identityJobs = (window.WorkSystem && window.WorkSystem.Jobs) || [];
      const identityJobId = actor._jobId != null ? actor._jobId : 0;
      const identityJob = identityJobId > 0 ? (identityJobs.find((j) => j.id === identityJobId) || null) : null;
      const jobName = identityJob
        ? (window.WorkSystem && window.WorkSystem.jobName ? window.WorkSystem.jobName(identityJob) : (identityJob.name || `Job #${identityJob.id}`))
        : ccT('CharCreate.bio.joblessShort', 'Jobless');

      const startingGold = 200000 + (typeof classStartingMoney === 'function' ? classStartingMoney(actor._classId) : 0) + (typeof traitStartingMoney === 'function' ? traitStartingMoney(actor) : 0);
      const startingMoneyFormatted = this._formatGoldToEuros(startingGold);

      let avatarStyle = "";
      if (actor.characterName()) {
        avatarStyle = this.getSpriteStyle(actor.characterName(), actor.characterIndex());
      }

      // 1. Identity Card (Sprite on Left of Name opens Sprite Gallery + Randomize Button + Class/Gender)
      const identityHeaderHtml = `
        <div class="cc-compact-identity-card">
          <div style="display:flex; gap:10px; align-items:center;">
            ${!isPetActive ? `
              <div class="cc-compact-avatar-wrap" title="${isLocked ? ccT('CharCreate.spriteLockedHint', 'Preset sprite (locked)') : ccT('CharCreate.spriteClickHint', 'Sprite: click to open the grid selector')}" onclick="${isLocked ? 'SoundManager.playBuzzer()' : 'SceneManager._scene.onOpenSpriteGallery()'}">
                <div class="cc-compact-avatar" style="${avatarStyle}"></div>
              </div>
            ` : ''}
            <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width:0;">
              <div style="display:flex; gap:4px; align-items:center;">
                <input type="text" class="cc-bio-select cc-name-input" style="font-family:'Lora',serif; font-weight:bold; font-size:1.15rem; color:#ffd700; background:rgba(0,0,0,0.4); border:1px solid rgba(218,165,32,0.35); border-radius:4px; padding:3px 8px; height:32px; width:100%; box-sizing:border-box; ${isLocked ? 'opacity:0.85; cursor:not-allowed;' : ''}" value="${actor.name() || ccT('CharCreate.defaultName', 'Hero')}" oninput="SceneManager._scene.onNameChange(this.value)" placeholder="${ccT('CharCreate.defaultName', 'Hero')}" ${isLocked ? 'readonly disabled' : ''} />
                ${!isLocked ? `
                  <button class="cc-profile-open-btn cc-profile-open-btn--icon" onclick="SceneManager._scene.onRandomizeNameClick()" title="${ccT('CharCreate.randomize', 'Randomize Name')}">
                    ${this._ccIconHtml(83, 16)}
                  </button>
                ` : ''}
              </div>
              <div style="display:flex; align-items:center; font-size:0.95rem; color:#ded1c1; padding:0 2px;">
                <span style="font-weight:700; color:#ffd700;">${jobName} ${className}</span>
              </div>
            </div>
          </div>
        </div>
      `;

      // 2. Full-Width Portrait Showcase Card (2D Bust for Humanoid, 3D Archetype Selector + Studio for Creature)
      let profileBoxHtml = "";
      if (!isPetActive) {
        if (isCreature) {
          // The archetypes a creature can actually BE, named the way the rest of
          // the game names them. This used to list Battler3D's ~600 raw
          // lowercase structure keys ("bigcat", "chromaticmanticore"), none of
          // which the health side could resolve back to a body.
          const currentArch = actorArchetypeKey(actor) || "Goblin";
          const secondArch = actorSecondaryArchetypeKey(actor) || "";

          // A creature is its model, so the card names the model it already has
          // (settled from its archetype the moment it was made) and opens the
          // sculptor. No 2D bust is ever borrowed for a monster.
          const modelLabel = secondArch
            ? `${archetypeDisplayName(currentArch)} / ${archetypeDisplayName(secondArch)}`
            : archetypeDisplayName(currentArch);

          // The primary/secondary archetype pickers live on the Bio tab now,
          // alongside the rest of who the creature is. The sidebar keeps only
          // the model preview and the shortcut into the sculptor.
          profileBoxHtml = `
            <div class="cc-compact-portrait-card" style="display:flex; flex-direction:column; gap:6px;">
              <div class="cc-compact-bust-full empty" onclick="SceneManager._scene.onOpenCreature3DStudio()">
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:6px;">
                  ${this._ccIconHtml(224, 28)}
                  <span style="font-size:0.9rem; color:#ffd700; font-weight:600;">${ccT('CharCreate.custom3dModel', '3D Model')}: ${modelLabel}</span>
                </div>
              </div>
              <div style="padding:0 2px;">
                <button class="cc-compact-edit-btn" style="width:100%; height:32px; justify-content:center;" onclick="SceneManager._scene.onOpenCreature3DStudio()">
                  ${this._ccIconHtml(224, 16)} <span>${ccT('CharCreate.custom3dModel', '3D Studio (Custom)')}</span>
                </button>
              </div>
            </div>
          `;
        } else {
          const bustName = this._getActorBust(actor);
          const bustUrl = this._getBustUrl(bustName);

          // The portrait is its own button now: the bust is clicked and the
          // gallery opens on it. The Appearance button underneath said the
          // same thing twice and ate a row of the sidebar.
          const bustTitle = isLocked
            ? ccT('CharCreate.bustLockedHint', 'Preset portrait (locked)')
            : ccT('CharCreate.bustClickHint', 'Portrait: click to choose a bust');
          const bustClick = isLocked ? 'SoundManager.playBuzzer()' : 'SceneManager._scene.onOpenBustGallery()';

          profileBoxHtml = `
            <div class="cc-compact-portrait-card">
              ${bustUrl ? `
                <div class="cc-compact-bust-full ${isLocked ? 'locked' : ''}" title="${bustTitle}" onclick="${bustClick}" style="background-image: url('${bustUrl}');"></div>
              ` : `
                <div class="cc-compact-bust-full empty ${isLocked ? 'locked' : ''}" title="${bustTitle}" onclick="${bustClick}">
                  <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:6px;">
                    ${this._ccIconHtml(224, 28)}
                    <span style="font-size:0.9rem; color:rgba(218,165,32,0.7); font-weight:600;">${ccT('CharCreate.noBustSelected', 'No portrait chosen')}</span>
                  </div>
                </div>
              `}
              ${isLocked ? `
                <div class="cc-compact-portrait-controls">
                  <div style="font-size:0.85rem; color:#ffd700; text-align:center; padding:4px 0; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px;">
                    ${this._ccIconHtml(195, 14)} <span>${ccT('CharCreate.presetLocked', 'Preset')}</span>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }
      }

      // 3. Core 8-Stat Grid (Status Screen Styled with Red HP and Modifiers)
      // Traits push their positive/negative deltas into actor._paramPlus the
      // moment they are toggled (see onTraitToggle -> _ccApplyTraitIds), so
      // folding it in here is what makes a stat change show up on the sidebar
      // as soon as the trait is picked, not only once the sheet is left and
      // reopened.
      const _baseStatNoEquip = (paramId, fallback) => {
        if (!classData) return fallback;
        const base = classData.params[paramId][1];
        const plus = (actor && actor._paramPlus) ? (actor._paramPlus[paramId] || 0) : 0;
        const rate = (actor && typeof actor.paramRate === "function") ? actor.paramRate(paramId) : 1;
        return Math.round((base + plus) * rate) || fallback;
      };
      const SL = ccStatLabels();
      const stats = [
        { label: SL.HP,  val: _baseStatNoEquip(0, 450), color: "#ef5350" },
        { label: SL.MP,  val: _baseStatNoEquip(1, 100), color: "#64b5f6" },
        { label: SL.STR, val: _baseStatNoEquip(2, 12),  color: "#e57373" },
        { label: SL.CON, val: _baseStatNoEquip(3, 10),  color: "#ffb74d" },
        { label: SL.DEX, val: _baseStatNoEquip(6, 10),  color: "#ffd54f" },
        { label: SL.INT, val: _baseStatNoEquip(4, 10),  color: "#ba68c8" },
        { label: SL.WIS, val: _baseStatNoEquip(5, 10),  color: "#4db6ac" },
        { label: SL.PSI, val: _baseStatNoEquip(7, 10),  color: "#f06292" }
      ];
      // HP and MP used to be two bar gauges above the stat grid; now they lead
      // it as plain boxes like every other stat, freeing the two bar rows'
      // worth of height for the portrait above to grow into.
      const statsHtml = `
        <div class="cc-vitals-block">
          <div class="cc-stat-grid">
            ${stats.map((st, idx) => {
              const isVital = idx < 2; // HP, MP
              if (isVital) {
                return `
                  <div class="cc-stat-box">
                    <span class="cc-stat-label" style="color:${st.color};">${st.label}</span>
                    <span class="cc-stat-val">${st.val}</span>
                  </div>
                `;
              }
              const mod = Math.floor((st.val - 10) / 2);
              const modStr = mod >= 0 ? "+" + mod : String(mod);
              return `
                <div class="cc-stat-box">
                  <span class="cc-stat-label">${st.label}</span>
                  <span class="cc-stat-val">${st.val} <span class="cc-stat-mod">(${modStr})</span></span>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;

      // 5. Level-1 Starting Skills — loadout row layout (matches Starting Items)
      const lv1SkillsList = [];
      if (classData && classData.learnings) {
        classData.learnings
          .filter(l => l.level === 1)
          .forEach(l => {
            const sk = $dataSkills[l.skillId];
            if (sk) lv1SkillsList.push({ name: window.CCDbName(sk), iconIndex: sk.iconIndex || 79, id: sk.id });
          });
      }
      const skillsLoadoutHtml = lv1SkillsList.map((sk) => this._ccLoadoutRowHtml(sk.iconIndex, sk.name, "",
        { hover: this._ccHoverAttrs("skill", sk.id) })).join("");

      const skillsSectionHtml = this._ccLoadoutSectionHtml(
        T('CharCreate.startingSkills'),
        ccTp('CharCreate.skillCount', { n: lv1SkillsList.length }, lv1SkillsList.length + ' skills'),
        skillsLoadoutHtml,
        T('CharCreate.noStartingSkills')
      );

      // 6. Starting Items & Money in Inventory
      const itemsList = [];
      actor.weapons().forEach((w) => {
        if (w) itemsList.push({ name: window.CCDbName(w), iconIndex: w.iconIndex || 116, qty: 1, type: "weapon", id: w.id });
      });
      actor.armors().forEach((a) => {
        if (a) itemsList.push({ name: window.CCDbName(a), iconIndex: a.iconIndex || 144, qty: 1, type: "armor", id: a.id });
      });
      if (typeof getClassStartingItems === "function") {
        const classItems = getClassStartingItems(actor._classId) || [];
        classItems.forEach((entry) => {
          const item = $dataItems[entry.id];
          if (item) itemsList.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: entry.qty || 1, type: "item", id: item.id });
        });
      }

      const moneyRowHtml = this._ccLoadoutRowHtml(
        208,
        ccT('CharCreate.startingFunds', 'Starting Funds'),
        startingMoneyFormatted,
        { nameColor: '#ffd700', valueColor: '#a5d6a7' }
      );

      const loadoutItemsHtml = itemsList.map((it) => this._ccLoadoutRowHtml(
        it.iconIndex, it.name, `x${it.qty}`,
        { hover: `onmouseenter="SceneManager._scene.onItemHover(event, '${it.type}', ${it.id}, ${it.qty})" onmouseleave="SceneManager._scene.onItemLeave()"` }
      )).join("");

      const startingItemsSectionHtml = this._ccLoadoutSectionHtml(
        T('CharCreate.startingItems'),
        ccTp('CharCreate.entryCount', { n: itemsList.length + 1 }, (itemsList.length + 1) + ' entries'),
        moneyRowHtml + loadoutItemsHtml,
        T('CharCreate.noGear')
      );

      // 7. The traits the member carries, priced the way the trait board prices
      // them, plus whatever illness they walk in with. It reads down the
      // sidebar beside the skills and the kit, so what a character IS is on the
      // same page as what they were given, on every step and not just on the
      // trait board.
      const traitRowsHtml = selectedTraitObjects(actor).map((tr) => {
        const cost = Number.isFinite(Number(tr.cost)) ? Number(tr.cost) : 1;
        const price = cost < 0
          ? `+${-cost}`
          : String(cost);
        return this._ccLoadoutRowHtml(
          tr.icon || 87,
          (tr.name && resolveTraitName(tr.name, tr.id)) || tr.id,
          price,
          { valueColor: cost < 0 ? '#a5d6a7' : '#ffd700' }
        );
      }).join("");

      const illnessRowsHtml = ((actor._ccDiseases) || []).map((id) => {
        const card = this._ccDiseaseCards().find((c) => c.diseaseId === id);
        if (!card) return "";
        return this._ccLoadoutRowHtml(card.icon || 180, card.name, "", { nameColor: '#f87171' });
      }).filter(Boolean).join("");

      const traitTotal = selectedTraitObjects(actor).length + ((actor._ccDiseases || []).length);
      const traitsSectionHtml = this._ccLoadoutSectionHtml(
        T('CharCreate.traits'),
        ccTp('CharCreate.traitCount', { n: traitTotal }, traitTotal + ' traits'),
        traitRowsHtml + illnessRowsHtml,
        T('CharCreate.noDefiningTraits')
      );

      return `
        <div class="cc-compact-sidebar">
          ${identityHeaderHtml}
          ${profileBoxHtml}
          ${statsHtml}
          ${skillsSectionHtml}
          ${traitsSectionHtml}
          ${startingItemsSectionHtml}
          <div class="cc-compact-actions" style="margin-top:auto; display:flex; flex-direction:column; gap:6px;">
            <button class="cc-compact-btn" onclick="SceneManager._scene.onQuickRandomizeMember()">${ccT('CharCreate.randomizeMember', 'Randomize Member')}</button>
            <button class="cc-compact-btn" onclick="SceneManager._scene.createTotalRandomPartyAll()">${ccT('CharCreate.randomizeParty', 'Randomize Party')}</button>
            <button class="cc-compact-btn primary" onclick="SceneManager._scene.onProceedToScenario()">${this._hasPresetInParty(false) ? ccT('CharCreate.startGame', 'Start Game') : ccT('CharCreate.confirmPartyScenario', 'Confirm Party & Scenario')}</button>
          </div>
        </div>
      `;
    }

    // ── Persistent Personal Dossier (Stats + Inventory + Money + Connected Bust) ──
    _renderPersonalDossierHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return `<div class="cc-page cc-page-right"></div>`;

      const classData = $dataClasses[actor._classId];
      const className = classData ? window.CCDbName(classData) : "Class";
      const genderName = actor.genderName ? actor.genderName() : ($gameVariables.value(38 + (Scene_CharacterCreation._currentPartyMemberIndex || 0)) === 0 ? "Male ♂" : "Female ♀");
      const startingGold = 200000 + (typeof classStartingMoney === 'function' ? classStartingMoney(actor._classId) : 0) + (typeof traitStartingMoney === 'function' ? traitStartingMoney(actor) : 0);
      const startingMoneyFormatted = this._formatGoldToEuros(startingGold);
      const bustName = this._getActorBust(actor);
      const bustUrl = this._getBustUrl(bustName);

      // 8 Core Stats (HP, MP, STR, CON, INT, WIS, DEX, PSI)
      // Use class lv1 base × trait param rates only — equipment flat bonuses excluded.
      const _dossierStatNoEquip = (paramId, fallback) => {
        if (!classData) return fallback;
        const base = classData.params[paramId][1];
        const rate = (actor && typeof actor.paramRate === "function") ? actor.paramRate(paramId) : 1;
        return Math.round(base * rate) || fallback;
      };
      const SL = ccStatLabels();
      const stats = [
        { label: SL.HP,  val: _dossierStatNoEquip(0, 450), color: "#81c784" },
        { label: SL.MP,  val: _dossierStatNoEquip(1, 100), color: "#64b5f6" },
        { label: SL.STR, val: _dossierStatNoEquip(2, 12),  color: "#e57373" },
        { label: SL.CON, val: _dossierStatNoEquip(3, 10),  color: "#ffb74d" },
        { label: SL.INT, val: _dossierStatNoEquip(4, 10),  color: "#ba68c8" },
        { label: SL.WIS, val: _dossierStatNoEquip(5, 10),  color: "#4db6ac" },
        { label: SL.DEX, val: _dossierStatNoEquip(6, 10),  color: "#ffd54f" },
        { label: SL.PSI, val: _dossierStatNoEquip(7, 10),  color: "#f06292" }
      ];

      const statBoxes = stats.map(st => `
        <div class="cc-stat-box">
          <span class="cc-stat-label">${st.label}</span>
          <span class="cc-stat-val">${st.val}</span>
        </div>
      `).join("");

      // Personal Inventory Items
      const itemsList = [];
      actor.weapons().forEach(w => {
        if (w) itemsList.push({ name: window.CCDbName(w), iconIndex: w.iconIndex || 116, qty: 1, type: "weapon", id: w.id });
      });
      actor.armors().forEach(a => {
        if (a) itemsList.push({ name: window.CCDbName(a), iconIndex: a.iconIndex || 144, qty: 1, type: "armor", id: a.id });
      });
      if (typeof getClassStartingItems === "function") {
        const classItems = getClassStartingItems(actor._classId) || [];
        classItems.forEach(entry => {
          const item = $dataItems[entry.id];
          if (item) itemsList.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: entry.qty || 1, type: "item", id: item.id });
        });
      }
      {
        selectedTraitObjects(actor).forEach(tr => {
          if (tr && tr.items) {
            tr.items.forEach(entry => {
              const itemId = (typeof entry === "object") ? entry.id : entry;
              const qty = (typeof entry === "object") ? (entry.qty || 1) : 1;
              const item = $dataItems[itemId];
              if (item) itemsList.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: qty, type: "item", id: item.id });
            });
          }
        });
      }

      const itemsRows = itemsList.map(it => `
        <div class="cc-compact-loadout-item"
             onmouseenter="SceneManager._scene.onItemHover(event, '${it.type}', ${it.id}, ${it.qty})"
             onmouseleave="SceneManager._scene.onItemLeave()">
          <span class="cc-loadout-icon">${this._ccIconHtml(it.iconIndex, 14)}</span>
          <span class="cc-loadout-name">${it.name}</span>
          <span class="cc-loadout-qty">x${it.qty}</span>
        </div>
      `).join("") || `<span style="font-size:0.75rem; color:rgba(255,255,255,0.4); font-style:italic;">${ccT('CharCreate.noPersonalEquipment', 'No personal equipment')}</span>`;

      // Traits badges
      const traitsBadges = selectedTraitObjects(actor).map(tr => {
        const name = (tr.name && resolveTraitName(tr.name, tr.id)) || tr.id;
        return `<span class="cc-element-badge" style="margin:2px; font-size:0.8rem;">${name}</span>`;
      }).join(" ");

      return `
        <div class="cc-page cc-page-right" style="display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:8px;">
            <div class="cc-money-badge" style="font-size:0.95rem;">
              ${this._ccIconHtml(208, 16)} <span>${startingMoneyFormatted}</span>
            </div>
          </div>

          <div class="cc-dossier-photo-frame" style="display:flex; align-items:center; justify-content:center; gap:16px; min-height:150px; padding:8px; background:rgba(0,0,0,0.5); border:1px solid rgba(218,165,32,0.3); border-radius:8px; margin-bottom:10px;">
            ${bustUrl ? `
              <div class="cc-dossier-large-bust" style="background-image: url('${bustUrl}');"></div>
            ` : ''}
            <div class="cc-wanted-sprite" style="${this.getSpriteStyle(actor.characterName(), actor.characterIndex())}; transform: scale(2); margin: 6px 0;"></div>
          </div>

          <div class="cc-dossier-card" style="padding:10px; margin-bottom:10px;">
            <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${ccT('CharCreate.name', 'Name')}:</span><span class="cc-dossier-value">${actor.name()}</span></div>
            <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${ccT('ClassSelect.vocation', 'Vocation')}:</span><span class="cc-dossier-value">${className}</span></div>
            <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${ccT('CharCreate.gender', 'Gender')}:</span><span class="cc-dossier-value">${genderName}</span></div>
          </div>

          <div style="margin-bottom:8px;">
            <span class="cc-dossier-label" style="font-size:0.85rem; display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${ccT('CharCreate.coreAttributes', 'Core Attributes')}</span>
            <div class="cc-stat-grid">${statBoxes}</div>
          </div>

          <div class="cc-dossier-card" style="padding:8px; margin-bottom:8px; flex:1; min-height:0; display:flex; flex-direction:column;">
            <span class="cc-dossier-label" style="font-size:0.85rem; display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${ccT('CharCreate.personalInventory', 'Personal Inventory & Gear')}</span>
            <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">
              ${itemsRows}
            </div>
          </div>

          ${traitsBadges ? `
            <div style="margin-top:2px;">
              <span class="cc-dossier-label" style="font-size:0.8rem; display:block; margin-bottom:3px; text-transform:uppercase;">${ccT('CharCreate.traits', 'Traits')}</span>
              <div style="display:flex; flex-wrap:wrap; gap:3px;">${traitsBadges}</div>
            </div>
          ` : ''}
        </div>
      `;
    }

    // ── Dedicated Scenario / Mission Dossier Page ──
    // ── The scenario board ───────────────────────────────────────────────────
    // The last question of creation: where this party wakes up. The scenarios
    // are the question, so they hold the left page; the right page is the
    // answer sheet, the party as it will actually be played, one full dossier
    // per member, headed by the kit this scenario alone hands out.

    // What the scenario adds to the party purse on top of what the characters
    // themselves bring.
    _scenarioGoldBonus(originSymbol) {
      const additions = {
        "origin_train": 0,
        "origin_cargo": 50000,
        "origin_castaway": 10000,
        "origin_camper": 150000,
        "origin_ceo": 10000000,
        "origin_augmented": 25000,
        "origin_underground": 100000,
        "origin_random": 100000
      };
      return additions[originSymbol] || 0;
    }

    _scenarioItemRowHtml(entry) {
      return this._ccLoadoutRowHtml(entry.iconIndex, entry.name, `x${entry.qty}`, {
        hover: `onmouseenter="SceneManager._scene.onItemHover(event, '${entry.type}', ${entry.id}, ${entry.qty})" onmouseleave="SceneManager._scene.onItemLeave()"`
      });
    }

    // One member's whole sheet: who they are, what they can take, what they
    // know and what they are carrying when the game starts.
    _scenarioMemberSheetHtml(actor) {
      const classData = $dataClasses[actor._classId];
      const className = classData ? window.CCDbName(classData) : T('CharCreate.class');
      const bustUrl = this._getBustUrl(this._getActorBust(actor));
      const money = 200000
        + (typeof classStartingMoney === 'function' ? classStartingMoney(actor._classId) : 0)
        + (typeof traitStartingMoney === 'function' ? traitStartingMoney(actor) : 0);

      const stat = (label, value) => `
        <div class="cc-scenario-stat"><span>${label}</span><b>${value}</b></div>
      `;

      const traitBadges = selectedTraitObjects(actor).map((tr) => {
        const name = (tr.name && resolveTraitName(tr.name, tr.id)) || tr.id;
        return `<span class="cc-element-badge">${name}</span>`;
      }).filter(Boolean).join("");

      const illnessBadges = ((actor._ccDiseases) || []).map((id) => {
        const card = this._ccDiseaseCards().find((c) => c.diseaseId === id);
        return card ? `<span class="cc-element-badge bad">${card.name}</span>` : "";
      }).filter(Boolean).join("");

      const actorSkills = actor.skills().filter(Boolean);
      const skillRows = actorSkills.map((sk) =>
        this._ccLoadoutRowHtml(sk.iconIndex || 79, window.CCDbName(sk), "",
          { hover: this._ccHoverAttrs("skill", sk.id) })
      ).join("");

      const carried = [];
      actor.weapons().forEach((w) => {
        if (w) carried.push({ name: window.CCDbName(w), iconIndex: w.iconIndex || 116, qty: 1, type: "weapon", id: w.id });
      });
      actor.armors().forEach((a) => {
        if (a) carried.push({ name: window.CCDbName(a), iconIndex: a.iconIndex || 144, qty: 1, type: "armor", id: a.id });
      });
      if (typeof getClassStartingItems === "function") {
        (getClassStartingItems(actor._classId) || []).forEach((e) => {
          const item = $dataItems[e.id];
          if (item) carried.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: e.qty || 1, type: "item", id: item.id });
        });
      }

      const section = (title, body) => body
        ? `<div class="cc-scenario-section"><h4>${title}</h4>${body}</div>` : "";

      return `
        <div class="cc-scenario-sheet">
          <div class="cc-scenario-sheet-head">
            ${bustUrl ? `<div class="cc-scenario-sheet-bust" style="background-image:url('${bustUrl}');"></div>` : ''}
            <div class="cc-scenario-sheet-sprite" style="${this.getSpriteStyle(actor.characterName(), actor.characterIndex())}"></div>
            <div class="cc-scenario-sheet-id">
              <span class="cc-scenario-sheet-name">${actor.name()}</span>
              <span class="cc-scenario-sheet-class">${className}</span>
              <span class="cc-scenario-sheet-money">${this._formatGoldToEuros(money)}</span>
            </div>
          </div>

          <div class="cc-scenario-stat-grid">
            ${stat(T('CharCreate.abbrev.hp'), actor.mhp)}
            ${stat(T('CharCreate.abbrev.mp'), actor.mmp)}
            ${stat(T('CharCreate.abbrev.str'), actor.param(2))}
            ${stat(T('CharCreate.abbrev.con'), actor.param(3))}
            ${stat(T('CharCreate.abbrev.int'), actor.param(4))}
            ${stat(T('CharCreate.abbrev.wis'), actor.param(5))}
            ${stat(T('CharCreate.abbrev.dex'), actor.param(6))}
            ${stat(T('CharCreate.abbrev.psi'), actor.param(7))}
          </div>

          ${section(T('CharCreate.traits'), traitBadges ? `<div class="cc-badge-wrap cc-badge-grid-3">${traitBadges}</div>` : "")}
          ${section(ccT('Traits.tabDiseases', 'Diseases'), illnessBadges ? `<div class="cc-badge-wrap cc-badge-grid-3">${illnessBadges}</div>` : "")}
          ${this._ccLoadoutSectionHtml(
            T('CharCreate.startingSkills'),
            ccTp('CharCreate.skillCount', { n: actorSkills.length }, actorSkills.length + ' skills'),
            skillRows,
            T('CharCreate.noStartingSkills'),
            true,
            'cc-loadout-grid-cols-3'
          )}
          ${this._ccLoadoutSectionHtml(
            T('CharCreate.startingItems'),
            ccTp('CharCreate.entryCount', { n: carried.length }, carried.length + ' entries'),
            carried.map((e) => this._scenarioItemRowHtml(e)).join(""),
            T('CharCreate.noGear'),
            true,
            'cc-loadout-grid-cols-3'
          )}
        </div>
      `;
    }

    _renderScenarioDossierHtml() {
      const stepData = CharacterCreationData[STEP.ORIGIN] || { choices: [] };
      const activeIndex = this._gridWindow ? this._gridWindow.index() : 0;
      const originChoice = (stepData.choices && stepData.choices[activeIndex]) || {};
      const originSymbol = originChoice.symbol || $gameSystem._ccOriginSymbol || "origin_train";

      const partyMembers = $gameParty ? $gameParty.members() : [];
      let totalGold = 0;
      partyMembers.forEach((a) => {
        totalGold += 200000
          + (typeof classStartingMoney === 'function' ? classStartingMoney(a._classId) : 0)
          + (typeof traitStartingMoney === 'function' ? traitStartingMoney(a) : 0);
      });
      totalGold += this._scenarioGoldBonus(originSymbol);

      // The kit this scenario alone hands out, on top of what the characters
      // already carry: the one thing the choice on the left actually changes
      // about the loadout, so it is shown apart rather than folded into the
      // party's consolidated inventory where it used to be invisible.
      const exclusive = (resolveOriginLoadout(originSymbol) || []).map((e) => {
        const data = loadoutEntryData(e);
        if (!data) return null;
        const type = e.kind === "weapon" || e.kind === "armor" ? e.kind : "item";
        return { name: window.CCDbName(data), iconIndex: data.iconIndex || 176, qty: e.qty || 1, type, id: data.id };
      }).filter(Boolean);
      const goldBonus = this._scenarioGoldBonus(originSymbol);

      // The party's shared bag, apart from the scenario's own exclusive kit:
      // what the party is already carrying going into the choice above.
      const partyInventory = $gameParty.allItems().filter((it) => it && it.name).map((it) => {
        const type = DataManager.isWeapon(it) ? "weapon" : DataManager.isArmor(it) ? "armor" : "item";
        return { name: window.CCDbName(it), iconIndex: it.iconIndex || 176, qty: $gameParty.numItems(it), type, id: it.id };
      });

      // A scenario card is its name: the line under it is the brief on the
      // right page, and printing it twice only made the list harder to scan.
      const scenarioCards = (stepData.choices || []).map((choice, index) => `
        <div class="cc-card-option cc-scenario-card ${index === activeIndex ? 'selected' : ''}"
             onclick="SceneManager._scene.onOptionCardClick(${index})">
          <div class="cc-option-title">${choice.name}</div>
        </div>
      `).join("");

      return `
        <div class="cc-scenario-dossier">
          <div class="cc-page cc-page-left cc-scenario-list">
            <div class="cc-scenario-list-head">
              <h2 class="cc-subheader">${ccT('CharCreate.scenarioPickPrompt', 'Pick the scenario this party starts in')}</h2>
              <span class="ts-count">${(stepData.choices || []).length}</span>
            </div>
            <div class="cc-select-grid cc-scenario-grid">
              ${scenarioCards}
            </div>
            <button class="cc-compact-btn cc-scenario-back" onclick="SceneManager._scene.onReturnToPartyDossier()">
              ${this._ccIconHtml(82, 16)} <span>${ccT('CharCreate.returnToParty', 'Return to Party Configuration')}</span>
            </button>
          </div>

          <div class="cc-page cc-page-right cc-scenario-brief">
            <div class="cc-scenario-brief-head">
              <h2 class="cc-header-gothic">${originChoice.name || ""}</h2>
              <div class="cc-money-badge">${this._ccIconHtml(208, 16)} <span>${this._formatGoldToEuros(totalGold)}</span></div>
            </div>
            <p class="cc-class-quote">${this.cleanText(originChoice.description || "")}</p>

            <div class="cc-scenario-brief-body">
              <div class="cc-dossier-card cc-class-section">
                <h3 class="cc-subheader">
                  <span>${ccT('CharCreate.scenarioExclusiveItems', 'Exclusive kit')}</span>
                  ${goldBonus ? `<span class="cc-scenario-bonus">+${this._formatGoldToEuros(goldBonus)}</span>` : ''}
                </h3>
                ${exclusive.length
                  ? `<div class="cc-compact-loadout-grid cc-loadout-open cc-loadout-grid-cols">${exclusive.map((e) => this._scenarioItemRowHtml(e)).join("")}</div>`
                  : `<span class="cc-class-none">${ccT('CharCreate.scenarioNoExclusiveItems', 'No exclusive kit for this scenario')}</span>`}
              </div>

              <div class="cc-dossier-card cc-class-section">
                <h3 class="cc-subheader">
                  <span>${ccT('CharCreate.scenarioPartyInventory', 'Party inventory')}</span>
                  ${partyInventory.length ? `<span class="ts-count">${partyInventory.length}</span>` : ''}
                </h3>
                ${partyInventory.length
                  ? `<div class="cc-compact-loadout-grid cc-loadout-open cc-loadout-grid-cols-3">${partyInventory.map((e) => this._scenarioItemRowHtml(e)).join("")}</div>`
                  : `<span class="cc-class-none">${ccT('CharCreate.scenarioNoPartyInventory', 'The party is not carrying anything yet')}</span>`}
              </div>

              <h3 class="cc-subheader cc-scenario-roster-head">
                <span>${ccT('CharCreate.scenarioRoster', 'Party dossiers')}</span>
                <span class="ts-count">${partyMembers.length}</span>
              </h3>
              <div class="cc-scenario-sheets">
                ${partyMembers.map((a) => this._scenarioMemberSheetHtml(a)).join("")}
              </div>
            </div>

            <button class="cc-compact-btn primary cc-scenario-embark" onclick="SceneManager._scene.onFinishPartyCreation()">${ccT('CharCreate.embark', "Embark & Begin Journey")}</button>
          </div>
        </div>
      `;
    }

    onProceedToScenario() {
      // If any party member is a preset character, skip scenario selection and finalize immediately!
      if (this._hasPresetInParty(false)) {
        this.onFinishPartyCreation();
        return;
      }
      Scene_CharacterCreation._isScenarioMode = true;
      this._step = STEP.ORIGIN;
      SoundManager.playOk();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onReturnToPartyDossier() {
      Scene_CharacterCreation._isScenarioMode = false;
      this._step = STEP.CLASS;
      SoundManager.playCancel();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    refreshUIOverlayDOM() {
      if (this._ccHandingOver) return;
      if (!this._dndContainer) return;

      const _curStepData = this._step < CharacterCreationData.length ? CharacterCreationData[this._step] : null;
      if (!_curStepData) return;
      if (_curStepData.isSettingsStep) {
        this._refreshSettingsDOM();
        return;
      }

      // Leaving the settings page gives the character's sidebar back, and the
      // tab bar is due a rewrite the next time settings is opened.
      this._tabsShowSettings = false;
      const _openLayout = this._dndContainer.querySelector(".cc-unified-layout");
      if (_openLayout) _openLayout.classList.remove("cc-settings-mode");

      const isPreset = !!this._presetWindow;
      const isScenario = !!Scene_CharacterCreation._isScenarioMode || this._step === STEP.ORIGIN;
      const activeIndex = isPreset ? (this._presetWindow ? this._presetWindow.index() : 0) : (this._gridWindow ? this._gridWindow.index() : 0);
      const currentStep = this._step;
      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isPetMode = !!Scene_CharacterCreation._isPetMode;

      // ── Memoization Check to Prevent 60 FPS Dom Rebuilding & Tab Flickering ──
      if (this._lastIndex === activeIndex && 
          this._lastStep === currentStep && 
          this._lastPresetMode === isPreset && 
          this._lastMemberIndex === currentMemberIndex &&
          this._lastPetMode === isPetMode &&
          this._lastScenarioMode === isScenario) {
        return;
      }

      if (this._presetTitleWindow) {
        this._presetTitleWindow.visible = false;
        this._presetTitleWindow.opacity = 0;
      }
      if (this._presetWindow) {
        this._presetWindow.visible = false;
        this._presetWindow.opacity = 0;
      }

      let leftHtml = "";
      let rightHtml = "";

      if (isScenario) {
        const scenarioContent = this._renderScenarioDossierHtml();
        this._dndContainer.innerHTML = `
          <div class="cc-unified-layout">
            <div class="cc-top-folder-tabs-slot">${this._renderTopFolderTabsHtml()}</div>
            <div class="cc-dossier-main">
              ${scenarioContent}
            </div>
          </div>
        `;
        this._lastIndex = activeIndex;
        this._lastStep = currentStep;
        this._lastPresetMode = isPreset;
        this._lastMemberIndex = currentMemberIndex;
        this._lastPetMode = isPetMode;
        this._lastScenarioMode = isScenario;
        return;
      }

      if (Scene_CharacterCreation._isPetMode) {
        // The dossier moved to the sidebar, so the roster takes the whole board.
        leftHtml = this._petPickerLeftHtml();
        rightHtml = "";
      } else if (isPreset) {
        const preset = this._presetWindow.currentPreset();
        const skins = preset ? presetSkins(preset) : [];
        const currentSkinIdx = this._presetWindow && this._presetWindow.skinIndex ? this._presetWindow.skinIndex(activeIndex) : 0;
        const currentSkin = skins[currentSkinIdx] || skins[0] || preset;
        const className = preset && $dataClasses[preset.classId] ? window.CCDbName($dataClasses[preset.classId]) : T('CharCreate.class');
        // A dossier's prose lives in the i18n bank under CharPresets.lore.<id>,
        // and Em's is composed on the spot; reading preset.lore straight off the
        // record found nothing for every dossier but a retired party member, so
        // the panel had fallen back to the generic line for all of them.
        const presetLore = preset
          ? (typeof getPresetLore === "function" ? getPresetLore(preset) : (preset.lore || ""))
          : "";
        const presetGold = preset ? (preset.money || 200000) : 200000;
        const presetMoneyFormatted = this._formatGoldToEuros(presetGold);

        // Some dossiers were drawn more than once: the same person in a second
        // outfit, a second office, a second state of being. Those alternates
        // are picked here, before the character is taken, and the look chosen
        // is the one they are then played as. Only shown for a dossier that
        // actually has more than one, so nobody else grows an empty row.
        const skinsHtml = skins.length > 1 ? `
            <div class="cc-skins-row">
              ${skins.map((s, si) => `
                <div class="cc-wanted-card cc-skin-card ${si === currentSkinIdx ? 'selected' : ''}"
                     onclick="SceneManager._scene.onPresetSkinClick(${si})">
                  <div class="cc-wanted-sprite" style="${this.getSpriteStyle(s.sprite, s.spriteIndex)}"></div>
                  <div class="cc-skin-name">${this.cleanText(presetSkinLabel(s))}</div>
                </div>
              `).join("")}
            </div>
            <div class="cc-skins-hint">
              <span class="cc-key-chip" data-pad="${skinKeyPadOn() ? "1" : "0"}">${skinKeyLabel()}</span>
              <span>${T('CharPresets.skinHint')} (${currentSkinIdx + 1}/${skins.length})</span>
            </div>` : "";

        rightHtml = preset ? `
          <div class="cc-page cc-page-right" style="display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:8px;">
              <div class="cc-money-badge">${presetMoneyFormatted}</div>
            </div>
            <div class="cc-dossier-photo-frame">
              <div class="cc-wanted-sprite" style="${this.getSpriteStyle(currentSkin.sprite, currentSkin.spriteIndex)}; transform:scale(1.8); margin:6px 0;"></div>
            </div>
            ${skinsHtml}
            <div class="cc-dossier-card" style="padding:10px; margin-bottom:10px;">
              <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${ccT('CharCreate.dossierName', 'Name')}</span><span class="cc-dossier-value">${preset.name}</span></div>
              <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${T('CharCreate.vocation')}</span><span class="cc-dossier-value">${className}</span></div>
            </div>
            <div style="flex:1; min-height:0; overflow-y:auto;">
              <p class="cc-text-desc" style="font-size:1.15rem; text-align:left; color:#ded1c1;">
                ${this.cleanText(presetLore || ccT('CharCreate.presetNoLore', 'A distinguished operative prepared for network field operations.'))}
              </p>
            </div>
            <button class="cc-sidebar-btn primary" style="margin-top:10px; width:100%; justify-content:center; height:44px; font-size:1.1rem;" onclick="SceneManager._scene.onApplyPresetToCurrentMember(${activeIndex})">
              ${this._ccIconHtml(189, 18)} <span>${T('CharCreate.applyToMember')}</span>
            </button>
          </div>
        ` : `<div class="cc-page cc-page-right"></div>`;

        const presets = availablePresets();
        const presetsCards = presets.map((p, index) => {
          const isSelected = index === activeIndex;
          const cardSkins = presetSkins(p);
          const cardSkin = cardSkins[this._presetWindow && this._presetWindow.skinIndex ? this._presetWindow.skinIndex(index) : 0] || cardSkins[0] || p;
          return `
            <div class="cc-wanted-card ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onPresetCardClick(${index})">
              <div class="cc-wanted-sprite" style="${this.getSpriteStyle(cardSkin.sprite, cardSkin.spriteIndex)}"></div>
              <div class="cc-wanted-name">${p.name}</div>
              <div class="cc-wanted-class">${$dataClasses[p.classId] ? window.CCDbName($dataClasses[p.classId]) : "Operative"}</div>
            </div>
          `;
        }).join("");

        leftHtml = `
          <div class="cc-page cc-page-left">
            <div class="cc-presets-board">${presetsCards}</div>
          </div>
        `;
      } else {
        const stepData = this.currentStepData();

        if (this._step === STEP.TRAITS || this._isTraitPickerStep()) {
          leftHtml = this._traitPickerLeftHtml();
          rightHtml = this._traitPickerRightHtml();
        } else if (this._step === STEP.SPECIALIZATIONS || this._isSpecsPickerStep()) {
          leftHtml = this._specsPickerLeftHtml();
          rightHtml = this._specsPickerRightHtml();
        } else if (this._step === STEP.BIO || this._isBioPickerStep()) {
          leftHtml = this._bioPickerLeftHtml();
          rightHtml = this._bioPickerRightHtml();
        } else if (this._step === STEP.CLASS || this._isClassPickerStep()) {
          leftHtml = this._classPickerLeftHtml(stepData, activeIndex);
          rightHtml = this._classPickerRightHtml(stepData, activeIndex);
        } else if (this._step === STEP.GENDER && this._isCurrentMemberCreature()) {
          leftHtml = this._archetypeStepLeftHtml();
          rightHtml = this._archetypeStepRightHtml();
        } else if (this._step === STEP.GENDER) {
          // A person is never asked here any more: the step hands straight over
          // to the sprite and name screens (setupStep), and their gender comes
          // off the sprite and is changed on the Bio tab. Nothing to draw.
          leftHtml = `<div class="cc-page cc-page-left"></div>`;
          rightHtml = `<div class="cc-page cc-page-right"></div>`;
        } else {
          // Every other step asks its own question. It used to be drawn by the
          // class picker, which looked the highlighted row up in $dataClasses
          // and so headed the birth-date, hometown and personality boards with a
          // class name and a class passive nobody had asked about.
          leftHtml = this._choiceStepFullHtml(stepData, activeIndex);
          rightHtml = "";
        }
      }

      const unifiedLayout = this._dndContainer.querySelector(".cc-unified-layout");
      if (!unifiedLayout || this._lastScenarioMode !== isScenario || this._lastPetMode !== isPetMode || this._lastPresetMode !== isPreset) {
        this._dndContainer.innerHTML = `
          <div class="cc-unified-layout">
            <div class="cc-top-folder-tabs-slot">${this._renderTopFolderTabsHtml()}</div>
            <div class="cc-dossier-main">
              <div class="cc-sidebar-slot">${this._renderCompactSidebarHtml()}</div>
              <div class="cc-content-pane${this._presetEditBlocked() ? ' cc-preset-locked' : ''}">
                <div class="cc-pockets-spread">
                  ${leftHtml}
                  ${rightHtml}
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        this._refreshTopFolderTabs();

        const pane = this._dndContainer.querySelector(".cc-content-pane");
        if (pane) pane.classList.toggle("cc-preset-locked", this._presetEditBlocked());

        const sidebarSlot = this._dndContainer.querySelector(".cc-sidebar-slot");
        if (sidebarSlot) {
          sidebarSlot.innerHTML = this._renderCompactSidebarHtml();
        } else {
          const sidebar = this._dndContainer.querySelector(".cc-compact-sidebar");
          if (sidebar) sidebar.outerHTML = this._renderCompactSidebarHtml();
        }

        const spread = this._dndContainer.querySelector(".cc-pockets-spread");
        if (spread) {
          spread.innerHTML = `
            ${leftHtml}
            ${rightHtml}
          `;
        }
      }

      this._lastIndex = activeIndex;
      this._lastStep = currentStep;
      this._lastPresetMode = isPreset;
      this._lastMemberIndex = currentMemberIndex;
      this._lastPetMode = isPetMode;
      this._lastScenarioMode = isScenario;

      if (isPetMode) {
        this._attachPetVirtualScroll();
      }
    }

    // Swaps one whole page column of the spread for freshly built markup.
    // The builders already return the column's own <div class="cc-page ...">
    // wrapper, so the wrapper is swapped along with its contents. The old code
    // tried to strip that wrapper with a regex that only matched wrappers
    // carrying nothing but a class attribute; every builder that also sets an
    // inline style slipped through, so a whole new page was nested INSIDE the
    // page being refreshed. .cc-page is 45%/55% wide and never shrinks, so each
    // hover or pick shrank the column to a fraction of the one before it until
    // the board was unreadable.
    _ccSwapPage(el, html) {
      if (!el) return null;
      const holder = document.createElement("template");
      holder.innerHTML = String(html).trim();
      const fresh = holder.content.firstElementChild;
      if (!fresh) { el.innerHTML = ""; return el; }
      // A page entering the spread fades and slides in; that is meant for a
      // genuine step change, not for the dozens of swaps a hovering cursor
      // makes, so a swapped-in page is exempted from it.
      fresh.style.animation = "none";
      const scroller = el.scrollTop;
      el.replaceWith(fresh);
      fresh.scrollTop = scroller;
      return fresh;
    }

    // The plain board every step that is not one of the bespoke ones is drawn
    // with: the step's own title, the highlighted choice's own name and its own
    // description, and its choices as cards. No database lookup of any kind, so
    // nothing from an unrelated table can leak into the header.
    _choiceStepFullHtml(stepData, activeIndex) {
      const choices = (stepData && stepData.choices) || [];
      const choice = choices[activeIndex] || {};

      const optionCards = choices.map((ch, index) => {
        const isSelected = index === activeIndex;
        return `
          <div class="cc-card-option ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onOptionCardClick(${index})">
            <div class="cc-option-title" style="font-size:1.18rem; margin:0 auto; text-align:center;">${ch.name || ""}</div>
          </div>
        `;
      }).join("");

      const description = this.cleanText(choice.description || "");

      return `
        <div class="cc-page cc-page-full" style="display:flex; flex-direction:column; padding: 24px 36px; width:100%; box-sizing:border-box;">
          <div class="cc-class-header" style="text-align:center; margin-bottom:16px; display:flex; flex-direction:column; align-items:center; gap:6px;">
            <h2 class="cc-header-gothic" style="font-size:2.4rem; margin:0; color:#ffd700; font-family:'Lora',serif;">${choice.name || (stepData && stepData.title) || ""}</h2>
            ${description ? `<p style="font-size:1.18rem; line-height:1.45; color:#ded1c1; text-align:center; margin:0; max-width:850px; font-style:italic;">${description}</p>` : ''}
          </div>
          <div class="cc-select-grid cc-compact cc-two-col" style="flex:1; min-height:0; overflow-y:auto; align-content:start; gap:10px; width:100%;">
            ${optionCards}
          </div>
        </div>
      `;
    }

    // ── Class board ──────────────────────────────────────────────────────────
    // The class step is a spread, not a wall of buttons: the roster is on the
    // left, narrowed by a search strip, and everything the choice actually
    // decides (growth, proficiencies, the skills it opens with and the ones it
    // grows into, the kit it starts with) is on the right.

    // The class behind one choice card, or null for the board's own commands
    // (Random, Browse the full roster).
    _classOfChoice(choice) {
      if (!choice) return null;
      const symbol = choice.symbol || "";
      if (symbol.indexOf("quick_class_") !== 0 && symbol !== "mana_cyborg") return null;
      const id = symbol === "mana_cyborg" ? 66 : choice.value;
      return $dataClasses[id] || null;
    }

    // The class's own line, in the active language, or its signature passive
    // when it has one: the note field carries both languages at once.
    _classNote(c, fallback) {
      let note = (c && c.note) || fallback || "";
      if (ConfigManager.language === "it") {
        const match = note.match(/<it:\s*([\s\S]*?)>/);
        note = match ? match[1].trim() : note.replace(/<[^>]+>/g, "").trim();
      } else {
        const match = note.match(/<en:\s*([\s\S]*?)>/);
        note = match ? match[1].trim() : note.replace(/<(it|en):\s*[\s\S]*?>/g, "").trim();
      }
      if (c && window.BattleSystemPassiveSkills) {
        const passiveDesc = window.BattleSystemPassiveSkills.getPassiveDescription(c.id);
        if (passiveDesc) note = passiveDesc;
      }
      return note;
    }

    _classElementId(c) {
      const match = ((c && c.note) || "").match(/<elem:\s*(\d+)>/);
      return match ? parseInt(match[1], 10) : 0;
    }

    _classElementName(elementId) {
      if (!elementId || !$dataSystem.elements[elementId]) return "";
      const key = 'ClassSelect.element.' + elementId;
      return T.has(key) ? T(key) : $dataSystem.elements[elementId];
    }

    _classPickerLeftHtml(stepData, activeIndex) {
      const choices = (stepData && stepData.choices) || [];
      const query = (Scene_CharacterCreation._classSearchQuery || "").toLowerCase().trim();
      const actor = Scene_CharacterCreation.getCurrentActor();
      const currentClassId = actor ? actor._classId : 0;

      const visible = choices.map((ch, index) => ({ ch, index })).filter(({ ch }) => {
        const c = this._classOfChoice(ch);
        if (!c) return !query;   // commands only show on the unfiltered board
        if (!query) return true;
        return (ch.name || "").toLowerCase().indexOf(query) >= 0;
      });

      // A card carries the name and nothing else: the numbers behind it are the
      // dossier's job, and reading a name is what the board is for.
      // A grouped roster (the creature board: monstrous kinds, then people)
      // heads each run of cards where it starts, so the two are told apart
      // without reading the names.
      let lastGroup = null;
      const cardsHtml = visible.map(({ ch, index }) => {
        const c = this._classOfChoice(ch);
        const isSelected = index === activeIndex;
        const isCurrent = c && c.id === currentClassId;
        let head = "";
        if (ch.group && ch.group !== lastGroup) {
          lastGroup = ch.group;
          head = `<div class="cc-class-group-head">${ch.groupTitle || ""}</div>`;
        }
        return `
          ${head}
          <div class="cc-card-option cc-class-card ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''}"
               onclick="SceneManager._scene.onOptionCardClick(${index})">
            <div class="cc-option-title">${ch.name || ""}</div>
          </div>
        `;
      }).join("");

      const emptyHtml = `<div class="cc-class-empty">${ccT('CharCreate.noClassMatches', 'No class matches that search.')}</div>`;

      return `
        <div class="cc-page cc-page-left cc-class-board" style="display:flex; flex-direction:column;">
          <input type="text" class="cc-bio-select cc-class-search" value="${query.replace(/"/g, '&quot;')}"
                 placeholder="${ccT('CharCreate.search', 'Search...')}"
                 oninput="SceneManager._scene.onClassSearch(this.value)" />
          <div class="cc-select-grid cc-compact cc-two-col cc-class-grid">
            ${cardsHtml || emptyHtml}
          </div>
        </div>
      `;
    }

    // The icon each element wears, shared with the status screen's element row.
    _classElementIcon(elementId) {
      const ELEMENT_ICONS = [0, 96, 64, 65, 66, 67, 68, 69, 70, 71];
      return ELEMENT_ICONS[elementId] || 0;
    }

    // The magical system the class casts through (<MagicalSystem:> on the
    // class note), in the active language.
    _classMagicSystem(c) {
      const match = ((c && c.note) || "").match(/<MagicalSystem:\s*([^>]+)>/i);
      if (!match) return "";
      const key = match[1].trim();
      const label = T('SkillsMenu.magicSystem.' + key);
      return label && label !== 'SkillsMenu.magicSystem.' + key ? label : key;
    }

    _classPickerRightHtml(stepData, activeIndex) {
      const choices = (stepData && stepData.choices) || [];
      const choice = choices[activeIndex] || {};
      const c = this._classOfChoice(choice);

      // Random / browse commands have no dossier to show, only their own line.
      if (!c) {
        return `
          <div class="cc-page cc-page-right cc-class-detail" style="display:flex; flex-direction:column; justify-content:center;">
            <h2 class="cc-header-gothic" style="text-align:center;">${choice.name || ""}</h2>
            <p class="cc-class-quote">${this.cleanText(choice.description || "")}</p>
          </div>
        `;
      }

      const actor = Scene_CharacterCreation.getCurrentActor();
      const isCurrent = !!(actor && actor._classId === c.id);
      const note = this._classNote(c, choice.description);

      // What the class IS, rather than what its numbers are: the element it
      // fights with, the magical system it casts through and the passive it
      // carries into every battle. The stat table the page used to open with
      // said less than any of the three.
      const elementId = this._classElementId(c);
      // Physical is what a class with no element of its own reads as, so it is
      // left unsaid: the row would be noise on most of the roster.
      const showElement = elementId > 1;
      const elementName = showElement ? this._classElementName(elementId) : "";
      const magicSystem = this._classMagicSystem(c);
      const passives = window.BattleSystemPassiveSkills;
      const passiveName = passives && passives.getPassiveName ? passives.getPassiveName(c.id) : "";
      const passiveDesc = passives && passives.getPassiveEffect ? passives.getPassiveEffect(c.id) : "";

      const metaRow = (label, value) => value
        ? `<div class="cc-dossier-row"><span class="cc-dossier-label">${label}</span><span class="cc-dossier-value">${value}</span></div>`
        : "";
      const elementValue = elementName
        ? `${this._ccIconHtml(this._classElementIcon(elementId), 18)} <span>${elementName}</span>`
        : "";
      // The element now has its own badge under the class name, so the
      // profile card only needs the magic system it casts through.
      const metaRows = [
        metaRow(T('ClassSelect.magicSystemHeading'), magicSystem),
      ].join("");

      const passiveHtml = passiveName ? `
        <div class="cc-class-passive">
          <div class="cc-class-passive-name">${this._ccIconHtml(87, 18)} <span>${passiveName}</span></div>
          ${passiveDesc ? `<p class="cc-class-passive-desc">${passiveDesc}</p>` : ''}
        </div>
      ` : "";

      // Weapon proficiencies read as a list of arms, one per line with its own
      // icon, exactly like the skills below them: a row of word chips made the
      // reader parse a paragraph to learn what the class can hold.
      const hasEquipTrait = (code, dataId) =>
        (c.traits || []).some((t) => t.code === code && t.dataId === dataId && t.value === 1);
      const weaponNames = {
        1: T('CharCreate.light'), 2: T('CharCreate.sword'), 3: T('CharCreate.heavy'),
        4: T('CharCreate.axe'), 5: T('CharCreate.whip'), 6: T('CharCreate.staff'),
        7: T('CharCreate.bow'), 8: T('CharCreate.projectile'), 9: T('CharCreate.gun'),
        10: T('CharCreate.claw'), 11: T('CharCreate.glove'), 12: T('CharCreate.spear')
      };
      const weaponIcons = (window.StartingEquipment && window.StartingEquipment.weaponTypeIcons) || {};
      const weaponRows = [];
      for (let wId = 1; wId <= 12; wId++) {
        if (hasEquipTrait(51, wId)) {
          weaponRows.push(this._ccLoadoutRowHtml(weaponIcons[wId] || 96, weaponNames[wId] || "", ""));
        }
      }

      // Element rates that are not 100%: the class's own resistances and holes.
      const affinityBadges = (c.traits || [])
        .filter((t) => t.code === 11 && t.value !== 1 && $dataSystem.elements[t.dataId])
        .map((t) => {
          const pct = Math.round(t.value * 100);
          const resistant = t.value < 1;
          return `<span class="cc-element-badge ${resistant ? 'good' : 'bad'}">${this._classElementName(t.dataId)} ${pct}%</span>`;
        });

      const learnings = c.learnings || [];
      const roadmapRows = learnings
        .filter((l) => l.level > 1)
        .sort((a, b) => a.level - b.level)
        .map((l) => {
          const sk = $dataSkills[l.skillId];
          if (!sk) return "";
          return this._ccLoadoutRowHtml(sk.iconIndex || 79, window.CCDbName(sk),
            `${ccT('CharCreate.abbrev.level', 'Lv')} ${l.level}`,
            { valueColor: '#ffd700', hover: this._ccHoverAttrs("skill", sk.id) });
        }).join("");

      const card = (title, body) => body
        ? `<div class="cc-dossier-card cc-class-section"><h3 class="cc-subheader">${title}</h3>${body}</div>`
        : "";
      const badgeRow = (badges) => badges.length
        ? `<div class="cc-badge-wrap">${badges.join("")}</div>` : "";

      return `
        <div class="cc-page cc-page-right cc-class-detail" style="display:flex; flex-direction:column;">
          <div class="cc-class-detail-head">
            <h2 class="cc-header-gothic" style="margin:0;">${window.CCDbName(c)}</h2>
            ${showElement ? `<div class="cc-badge-wrap" style="justify-content:center;">
              <span class="cc-element-badge${isCurrent ? ' good' : ''}">${elementValue}</span>
            </div>` : ''}
            ${note ? `<p class="cc-class-quote">"${note}"</p>` : ''}
          </div>

          <div class="cc-class-detail-body">
            ${card(ccT('CharCreate.classProfile', 'Class Profile'), metaRows + passiveHtml)}
            ${this._ccLoadoutSectionHtml(
              T('CharCreate.startingWeaponProficiencies'),
              null,
              weaponRows.join(""),
              T('CharCreate.none'),
              true,
              'cc-loadout-grid-cols'
            )}
            ${card(ccT('CharCreate.elementalAffinities', 'Elemental Affinities'), badgeRow(affinityBadges))}
            ${Scene_CharacterCreation.isQuickMode() ? "" : this._ccLoadoutSectionHtml(T('CharCreate.skillRoadmap'), null, roadmapRows, "", true)}
          </div>
        </div>
      `;
    }

    onClassSearch(query) {
      Scene_CharacterCreation._classSearchQuery = query || "";
      // Only the roster is redrawn: rebuilding the spread would take the search
      // field, and the caret in it, away between one keystroke and the next.
      const container = this._dndContainer;
      const leftPage = container && container.querySelector(".cc-page-left");
      if (!leftPage) { this._lastStep = -1; this.refreshUIOverlayDOM(); return; }
      const activeIndex = this._gridWindow ? this._gridWindow.index() : 0;
      const fresh = this._ccSwapPage(leftPage, this._classPickerLeftHtml(this.currentStepData(), activeIndex));
      const input = fresh && fresh.querySelector(".cc-class-search");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    // The class dossier follows the PICK, never the pointer: the right page
    // used to be rewritten by every card the mouse crossed on its way to the
    // one being aimed at, so the sheet being read kept vanishing.

    // ── Archetype step (creatures) ──────────────────────────────────────────
    // A creature's identity step asks WHAT IT IS, not what gender it presents
    // as, so where a person sees the gender board a creature sees the archetype
    // roster. The tab has always been called "Archetype"; until now it opened
    // the gender board anyway, which is why picking an archetype from it was
    // impossible. (A creature's gender still lives on the Bio tab, with the
    // rest of its registry details.)
    // Each card carries what the choice is worth: the archetype's name, how
    // many parts the body would have, and which half of a spliced body it is
    // already filling. A click picks the primary, the corner button picks the
    // second half, so both halves are settled on the one board.
    _archetypeStepLeftHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return `<div class="cc-page cc-page-left"></div>`;
      const primary = actorArchetypeKey(actor);
      const secondary = actorSecondaryArchetypeKey(actor);
      const table = (window.Health && window.Health.Archetypes) || {};

      const cards = creatureArchetypeKeys().map((key) => {
        const isPrimary = key === primary;
        const isSecondary = key === secondary;
        const entry = table[key] || null;
        const partCount = entry && entry.parts ? Object.keys(entry.parts).length : 0;
        const role = isPrimary
          ? `<span class="cc-role-badge primary">${ccT('CharCreate.primary', 'Primary')}</span>`
          : (isSecondary ? `<span class="cc-role-badge secondary">${ccT('CharCreate.secondary', 'Secondary')}</span>` : "");
        // Nothing is its own other half, so the pick-as-second button is left
        // off the card that already holds the primary.
        const secondBtn = isPrimary ? "" : `
          <button class="cc-archetype-second-btn" title="${ccT('CharCreate.secondaryArchetype', 'Secondary Archetype')}"
                  onclick="event.stopPropagation(); SceneManager._scene.onSelectArchetypeSecondCard('${key}')">${isSecondary ? '-' : '+'}</button>
        `;
        return `
          <div class="cc-card-option cc-archetype-card ${isPrimary ? 'selected' : ''} ${isSecondary ? 'is-secondary' : ''}" onclick="SceneManager._scene.onSelectArchetypeCard('${key}')">
            <div class="cc-option-title" style="font-size:1.02rem; margin:0; text-align:center; line-height:1.15;">${archetypeDisplayName(key)}</div>
            <div class="cc-archetype-card-meta">${partCount} ${ccT('CharCreate.bodyParts', 'Body parts')}</div>
            ${role}
            ${secondBtn}
          </div>
        `;
      }).join("");

      return `
        <div class="cc-page cc-page-left" style="display:flex; flex-direction:column;">
          <h3 class="cc-subheader" style="font-size:1.35rem; margin:0 0 2px 0;">${ccT('CharCreate.chooseAnArchetype', 'Choose an archetype')}</h3>
          <p class="cc-text-desc" style="margin:0 0 8px 0; font-size:0.95rem; text-align:left; color:#ded1c1; opacity:0.85;">
            ${ccT('CharCreate.archetypeBoardHint', 'Pick one archetype for a baseline body, or add a second to splice a hybrid.')}
          </p>
          <div class="cc-select-grid cc-compact cc-three-col cc-archetype-grid" style="flex:1; min-height:0; overflow-y:auto; align-content:start; gap:8px; margin-top:0; padding-right:6px;">
            ${cards}
          </div>
        </div>
      `;
    }

    // The body the pick builds, part by part, the way the creature builder has
    // always printed it: every part with the share of HP it carries and, on a
    // spliced body, which archetype it came from.
    _archetypeAnatomyRowsHtml(keys) {
      const HC = window.HealthCore;
      const table = (window.Health && window.Health.Archetypes) || {};
      let parts;
      if (HC && HC.mergeArchetypeParts) {
        parts = HC.mergeArchetypeParts(keys);
      } else {
        parts = {};
        (keys || []).forEach((key, index) => {
          const entry = table[key];
          for (const partKey in (entry && entry.parts) || {}) {
            if (!parts[partKey]) parts[partKey] = Object.assign({}, entry.parts[partKey], { fromArchetype: index });
          }
        });
      }
      const partKeys = Object.keys(parts || {});
      if (!partKeys.length) {
        return `<p class="cc-text-desc" style="text-align:left; font-size:1.02rem; color:#ded1c1;">${ccT('CharCreate.noAnatomicalOrgansDefined', 'No anatomical organs defined')}</p>`;
      }
      const spliced = (keys || []).length > 1;
      return partKeys.map((partKey) => {
        const part = parts[partKey];
        const name = (HC && HC.archetypePartName)
          ? HC.archetypePartName(part)
          : ((window.getArchetypeText ? window.getArchetypeText(part.name) : part.name) || partKey);
        const badge = !spliced ? "" : (part.fromArchetype === 1
          ? `<span class="cc-role-badge secondary">${ccT('CharCreate.secondary', 'Secondary')}</span>`
          : `<span class="cc-role-badge primary">${ccT('CharCreate.primary', 'Primary')}</span>`);
        return `
          <div class="cc-archetype-part-row cc-dossier-row" style="font-size:1.02rem; padding:2px 0;">
            <span class="cc-dossier-label">${name}${badge}</span>
            <span class="cc-dossier-value">${part.hpPercent}% HP${part.vital ? ` ${ccT('CharCreate.vital', 'Vital')}` : ''}</span>
          </div>
        `;
      }).join("");
    }

    _archetypeStepRightHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return `<div class="cc-page cc-page-right"></div>`;
      const keys = actorArchetypeKeys(actor);
      const current = keys[0] || null;
      const secondary = keys[1] || null;
      const table = (window.Health && window.Health.Archetypes) || {};
      const anatomyRows = this._archetypeAnatomyRowsHtml(keys);
      const partCount = (anatomyRows.match(/cc-archetype-part-row/g) || []).length;
      const classIds = [];
      keys.forEach((key) => {
        const entry = table[key] || null;
        ((entry && (entry.creatureClasses || entry.classes)) || []).forEach((id) => {
          if (!classIds.includes(id)) classIds.push(id);
        });
      });
      const classNames = classIds
        .map((id) => ($dataClasses[id] ? window.CCDbName($dataClasses[id]) : null))
        .filter(Boolean);
      const title = secondary
        ? `${archetypeDisplayName(current)} + ${archetypeDisplayName(secondary)}`
        : (archetypeDisplayName(current) || ccT('CharCreate.pending', 'Pending'));

      return `
        <div class="cc-page cc-page-right" style="display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:center; align-items:center; min-height:64px; margin:4px 0 10px 0;">
            <div class="cc-header-gothic" style="font-size:2.1rem; color:#ffd700; font-family:'Lora',serif; text-align:center;">
              ${title}
            </div>
          </div>

          <div class="cc-dossier-card" style="margin-bottom:10px; padding:10px 12px;">
            <div class="cc-dossier-row" style="font-size:1.05rem; padding:3px 0;">
              <span class="cc-dossier-label">${ccT('CharCreate.bodyParts', 'Body parts')}:</span>
              <span class="cc-dossier-value">${partCount}</span>
            </div>
            <div class="cc-dossier-row" style="font-size:1.05rem; padding:3px 0;">
              <span class="cc-dossier-label">${ccT('CharCreate.classesOfThisArchetype', 'Classes of this archetype')}:</span>
              <span class="cc-dossier-value">${classNames.length}</span>
            </div>
          </div>

          <div class="cc-dossier-card" style="flex:1; min-height:0; overflow-y:auto; padding:10px 12px;">
            <h3 class="cc-subheader" style="font-size:1.25rem; margin-top:0;">${ccT('CharCreate.anatomy', 'Anatomy')}</h3>
            ${anatomyRows}
            <h3 class="cc-subheader" style="font-size:1.25rem;">${ccT('CharCreate.classesOfThisArchetype', 'Classes of this archetype')}</h3>
            <p class="cc-text-desc" style="text-align:left; font-size:1.02rem; line-height:1.5; color:#ded1c1;">
              ${classNames.length ? classNames.join(", ") : ccT('CharCreate.onlyWhatYourArchetypesSupport', 'Only what your archetypes support.')}
            </p>
          </div>

          <button class="cc-sidebar-btn primary" style="margin-top:10px; width:100%; justify-content:center; height:40px;" onclick="SceneManager._scene.onOpenCreature3DStudio()">
            ${this._ccIconHtml(224, 16)} <span>${ccT('CharCreate.custom3dModel', '3D Model')}</span>
          </button>
        </div>
      `;
    }

    // Everything that reads the chosen archetype after a pick: the sidebar and
    // the tab subtitle always, the two pages of the board only while the board
    // is the thing on screen. Repainting them unconditionally is what put the
    // archetype spread over whatever tab the sidebar's dropdown was used from.
    _repaintArchetypeStep() {
      const container = this._dndContainer;
      if (!container) { this.refreshUIOverlayDOM(); return; }
      if (this._step === STEP.GENDER && this._isCurrentMemberCreature()) {
        // The page's own wrapper is dropped, since the element being filled IS
        // that wrapper. The pattern has to allow the newline the template
        // starts with, or the whole spread ends up nested inside itself.
        const strip = (html) => html
          .replace(/^\s*<div class="cc-page[^>]*>/, "")
          .replace(/<\/div>\s*$/, "");
        const leftPage = container.querySelector(".cc-page-left");
        if (leftPage) leftPage.innerHTML = strip(this._archetypeStepLeftHtml());
        const rightPage = container.querySelector(".cc-page-right");
        if (rightPage) rightPage.innerHTML = strip(this._archetypeStepRightHtml());
      }
      // The archetype picks also live on the Bio tab now: repaint it too, so a
      // primary pick that collapses the secondary back to "None" (picking the
      // half already held) shows that instead of leaving a stale option
      // selected in an unrepainted dropdown.
      if (this._step === STEP.BIO && this._isCurrentMemberCreature()) {
        const leftPage = container.querySelector(".cc-page-left");
        if (leftPage) leftPage.outerHTML = this._bioPickerLeftHtml();
      }
      const sidebar = container.querySelector(".cc-compact-sidebar");
      if (sidebar) sidebar.outerHTML = this._renderCompactSidebarHtml();
      this._refreshTopFolderTabs();
    }

    onSelectArchetypeCard(key) {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      if (!applyArchetypeToActor(actor, key)) {
        SoundManager.playBuzzer();
        return;
      }
      SoundManager.playOk();
      this._repaintArchetypeStep();
    }

    // The same card taken as the second archetype. Picking the one already
    // held there drops it again, so the corner button toggles.
    onSelectArchetypeSecondCard(key) {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const isSecond = actorSecondaryArchetypeKey(actor) === key;
      if (!applySecondaryArchetypeToActor(actor, isSecond ? null : key)) {
        SoundManager.playBuzzer();
        return;
      }
      SoundManager.playOk();
      this._repaintArchetypeStep();
    }

    // Point the static creature flag at whoever is being built now. The flag is
    // what the linear flow reads (which steps to skip, where the gender step
    // hands over, what Back means), and it used to be written only when the
    // player toggled the humanoid/creature switch. Switching party tabs left it
    // describing the PREVIOUS member: opening a creature and then going back to
    // a person left that person unable to reach the class step, and confirming
    // their identity step handed them to the creature builder.
    static currentMemberIsCreature() {
      const actor = this.getCurrentActor();
      const memberIndex = this._currentPartyMemberIndex || 0;
      return !!(actor && (actor._isCreatureActor || $gameSwitches.value(77 + memberIndex)));
    }

    static syncCreatureModeToCurrentMember() {
      this._isCreatureMode = this.currentMemberIsCreature();
      return this._isCreatureMode;
    }

    // True while the member being built is a creature, whichever way it was
    // made one. The static flag alone lies after a party-tab switch, so the
    // member's own record is what answers.
    _isCurrentMemberCreature() {
      return Scene_CharacterCreation.currentMemberIsCreature();
    }

    // Rewrites the top tab bar wherever it sits: the main board wraps it in a
    // slot, the settings board writes it straight into the layout.
    _refreshTopFolderTabs() {
      const container = this._dndContainer;
      if (!container) return;
      const slot = container.querySelector(".cc-top-folder-tabs-slot");
      if (slot) { slot.innerHTML = this._renderTopFolderTabsHtml(); return; }
      const bar = container.querySelector(".cc-dossier-top-bar");
      if (bar) bar.outerHTML = this._renderTopFolderTabsHtml();
    }

    // ── Sidebar Tabs & Completion Calculation ──
    _getCreationTabs() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      const memberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isCreature = !!(actor && (actor._isCreatureActor || $gameSwitches.value(77 + memberIndex)));

      // Bio leads the strip: it is where the character is named, given a face
      // and given a past, so it is the first thing a player is asked for.
      const bio = {
        id: "bio",
        iconIndex: 183,
        title: ccT('CharCreate.biography', 'Bio & Ideology'),
        subtitle: (actor && actor._bioSet) ? ccT('CharCreate.customized', "Customized") : ccT('CharCreate.optional', "Optional"),
        step: STEP.BIO
      };
      const archetype = {
        id: "archetype",
        iconIndex: 292,
        title: ccT('CharCreate.archetype', "Archetype"),
        subtitle: archetypeDisplayName(actorArchetypeKey(actor)) || ccT('CharCreate.pending', "Choose"),
        step: STEP.GENDER
      };
      const klass = {
        id: "class",
        iconIndex: 322,
        title: ccT('CharCreate.class', "Class"),
        subtitle: (actor && $dataClasses[actor._classId] && window.CCDbName($dataClasses[actor._classId])) || ccT('CharCreate.pending', "Choose"),
        step: STEP.CLASS
      };
      const traits = {
        id: "traits",
        iconIndex: 87,
        title: ccT('CharCreate.traits', 'Traits'),
        subtitle: actor && actor._selectedTraits && actor._selectedTraits.length > 0 ? `${actor._selectedTraits.length} traits` : ccT('CharCreate.optional', "Optional"),
        step: STEP.TRAITS
      };
      const specializations = {
        id: "specializations",
        iconIndex: 126,
        title: ccT('CharCreate.specializations', 'Specializations'),
        subtitle: (actor && actor._specPointsSpent ? `${actor._specPointsSpent} pts` : ccT('CharCreate.optional', "Optional")),
        step: STEP.SPECIALIZATIONS
      };

      return isCreature
        ? [bio, archetype, klass, traits, specializations]
        : [bio, klass, traits, specializations];
    }

    _isTabCompleted(tabId) {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return false;
      const memberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isCreature = !!(actor._isCreatureActor || $gameSwitches.value(77 + memberIndex));

      switch (tabId) {
        case "archetype":
          return isCreature ? !!(actor._creatureArchetypes && actor._creatureArchetypes.length > 0) : true;
        case "appearance":
        case "identity":
          return !!(actor.name() && actor.name().trim() && actor.name() !== "Unnamed" && actor.name() !== "Harold" && actor.characterName() && actor.characterName().length > 0);
        case "class":
          return !!(actor._classId && actor._classId > 0);
        case "traits":
        case "specializations":
        case "bio":
        case "personality":
          return true; // Optional steps
        case "origin":
          return !!($gameSystem._ccOriginSymbol || actor._originSymbol);
        default:
          return true;
      }
    }

    // How a character is portrayed is not a choice any more: a person wears a
    // hand-drawn bust, a creature wears its sculpted 3D model. So this opens
    // the one editor that belongs to what the member already is.
    onOpenProfileVisualEditor() {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const memberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isCreature = !!(actor._isCreatureActor || $gameSwitches.value(77 + memberIndex));

      if (isCreature && window.Scene_CC3DModel && window.CC3DModel &&
          window.CC3DModel.isAvailable && window.CC3DModel.isAvailable()) {
        const archetypes = actor._creatureArchetypes || ["Goblin"];
        window.Scene_CC3DModel.setup(actor.actorId(), Scene_CharacterCreation, {
          creature: true,
          initArchetypes: archetypes,
          returnByPop: true,
          confirmPops: 1
        });
        this.markReturnStep();
        this.closeStepUI();
        SceneManager.push(window.Scene_CC3DModel);
        return;
      }

      this.onOpenSpriteGallery();
    }

    onSetCharacterType(type) {
      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const creatureSwitchId = 77 + currentMemberIndex;
      const actor = Scene_CharacterCreation.getCurrentActor();

      // The type pills are the one way out of a taken dossier: every other
      // control still refuses a locked preset actor, but clicking a pill here
      // (Humanoid, Creature, or Preset again to browse a different one) drops
      // the lock instead of being refused, or the player would be stuck with
      // whatever dossier they first applied with no way back.
      if (this._isActorLockedPreset(actor)) {
        this._clearPresetLock(actor);
      }

      if (type === 'preset') {
        this.showPresetSelection();
        return;
      }

      if (this._presetWindow) {
        this.onPresetCancel();
      }

      if (type === 'creature') {
        $gameSwitches.setValue(creatureSwitchId, true);
        Scene_CharacterCreation._isCreatureMode = true;
        if (actor) {
          actor._isCreatureActor = true;
          if (actor._classId < 63) {
            actor.changeClass(65, false);
          }
          if (!actorArchetypeKey(actor)) {
            const archetypes = creatureArchetypeKeys().filter((k) => k !== "Humanoid");
            const randomArch = archetypes[Math.floor(Math.random() * archetypes.length)] || "Goblin";
            applyArchetypeToActor(actor, randomArch);
          }
          if (actor.setPortraitMode) actor.setPortraitMode("model");
          applyArchetypeToActor(actor, actorArchetypeKey(actor));
          // Whatever happened above, the member leaves here with a model to be
          // drawn as: a creature is never portrayed by a borrowed 2D bust.
          ensureCreatureModel(actor);
        }
      } else {
        $gameSwitches.setValue(creatureSwitchId, false);
        Scene_CharacterCreation._isCreatureMode = false;
        if (actor) {
          actor._isCreatureActor = false;
          if (actor._classId >= 63) {
            actor.changeClass(1, false);
          }
          if (actor.setPortraitMode) actor.setPortraitMode("bust");
        }
      }

      SoundManager.playOk();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onTabClick(stepIndex, tabId) {
      Scene_CharacterCreation._isPetMode = false;
      Scene_CharacterCreation._isScenarioMode = false;
      // Only a deliberate visit to the Class tab opens the class step for a
      // creature; the linear flow still walks past it.
      this._classStepRequested = (tabId === "class");
      if (this._presetWindow) {
        this.onPresetCancel();
      }
      if (tabId === "specializations") {
        this._step = STEP.SPECIALIZATIONS;
      } else if (tabId === "bio") {
        this._step = STEP.BIO;
      } else if (tabId === "traits") {
        this._step = STEP.TRAITS;
      } else if (tabId === "origin") {
        this._step = STEP.ORIGIN;
        Scene_CharacterCreation._isScenarioMode = true;
      } else if (tabId === "class") {
        this._step = STEP.CLASS;
      } else if (tabId === "identity" || tabId === "archetype") {
        this._step = STEP.GENDER;
      } else {
        this._step = stepIndex;
      }
      this.setupStep();
      SoundManager.playCursor();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onSettingsTabClick() {
      this._pageRailFocused = false;
      Scene_CharacterCreation._railFocus = null;
      Scene_CharacterCreation._isPetMode = false;
      Scene_CharacterCreation._isScenarioMode = false;
      if (this._presetWindow) {
        this.onPresetCancel();
      }
      this._step = STEP.SETTINGS;
      this.setupStep();
      SoundManager.playCursor();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // ── The rail on the open page (trait / talent / companion categories) ──
    //
    // These used to be mouse-only: nothing on a pad could reach them, so a
    // player on a controller saw whichever category the board opened on and no
    // other. They are reached the way a list is reached, by walking up off the
    // top row of the grid; Left and Right then walk the rail and the board
    // follows, and Down (or Confirm) drops back onto the cards.
    _activePageRail() {
      if (Scene_CharacterCreation._isPetMode) {
        return {
          ids: this._petCategories().map((c) => c.id),
          active: Scene_CharacterCreation._activePetCategory || "all",
          select: (id) => this.onPetCategorySelect(id),
        };
      }
      if (this._step === STEP.TRAITS) {
        return {
          ids: this._traitCategories().map((c) => c.id),
          active: Scene_CharacterCreation._activeTraitCategory || "all",
          select: (id) => this.onTraitCategorySelect(id),
        };
      }
      if (this._step === STEP.SPECIALIZATIONS) {
        return {
          ids: this._specsCategories(),
          active: Scene_CharacterCreation._activeSpecCategory || "All",
          select: (id) => this.onSpecCategorySelect(id),
        };
      }
      return null;
    }

    _leavePageRail(playSound) {
      if (!this._pageRailFocused) return;
      this._pageRailFocused = false;
      if (playSound) SoundManager.playCursor();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // Returns true when the rail has taken the press.
    updatePageRailInput(windowObj) {
      const rail = this._activePageRail();
      if (!rail || rail.ids.length < 2) {
        this._pageRailFocused = false;
        return false;
      }

      if (!this._pageRailFocused) {
        // Up off the top row steps onto the rail above the grid.
        const onTopRow = !windowObj ||
          (windowObj.index() < (windowObj.maxCols ? windowObj.maxCols() : 1));
        if (onTopRow && (Input.isTriggered("up") || Input.isRepeated("up"))) {
          this._pageRailFocused = true;
          SoundManager.playCursor();
          this._lastStep = -1;
          this._lastIndex = -1;
          this.refreshUIOverlayDOM();
          return true;
        }
        return false;
      }

      const cur = Math.max(0, rail.ids.indexOf(rail.active));
      if (Input.isTriggered("right") || Input.isRepeated("right")) {
        rail.select(rail.ids[(cur + 1) % rail.ids.length]);
        return true;
      }
      if (Input.isTriggered("left") || Input.isRepeated("left")) {
        rail.select(rail.ids[(cur - 1 + rail.ids.length) % rail.ids.length]);
        return true;
      }
      if (Input.isTriggered("down") || Input.isRepeated("down") || Input.isTriggered("ok")) {
        this._leavePageRail(true);
        return true;
      }
      if (Input.isTriggered("cancel") || TouchInput.isCancelled()) {
        this._leavePageRail(false);
        return true;
      }
      return true;
    }

    // ── The top rail, walked with the shoulder buttons ─────────────────────
    //
    // L1 / R1 (and TAB, for a keyboard) step along the rail exactly as they
    // step along the backpack's category tabs: Settings, then the party in
    // order, then the empty seat if the party is short one, then the
    // companion. Landing on the empty seat does not open a page - there is no
    // character there yet - so it is marked as the resting slot and Confirm
    // fills it.
    _topRailEntries() {
      const entries = [{ kind: "settings" }];
      const size = $gameParty ? $gameParty.size() : 0;
      for (let i = 0; i < size; i++) entries.push({ kind: "member", index: i });
      if (size < 3) entries.push({ kind: "add" });
      entries.push({ kind: "pet" });
      return entries;
    }

    _topRailIndex(entries) {
      if (Scene_CharacterCreation._railFocus === "add") {
        const i = entries.findIndex((e) => e.kind === "add");
        if (i >= 0) return i;
      }
      const stepData = this._step < CharacterCreationData.length ? CharacterCreationData[this._step] : null;
      const isSettings = this._step === STEP.SETTINGS || (stepData && stepData.isSettingsStep);
      if (isSettings) return 0;
      if (Scene_CharacterCreation._isPetMode) {
        const i = entries.findIndex((e) => e.kind === "pet");
        if (i >= 0) return i;
      }
      const member = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const i = entries.findIndex((e) => e.kind === "member" && e.index === member);
      return i >= 0 ? i : 0;
    }

    _openTopRailEntry(entry) {
      if (!entry) return;
      if (entry.kind !== "add") Scene_CharacterCreation._railFocus = null;
      switch (entry.kind) {
        case "settings": this.onSettingsTabClick(); break;
        case "member":   this.onPartyMemberTabClick(entry.index); break;
        case "pet":      this.onPetTabClick(); break;
        case "add":
          Scene_CharacterCreation._railFocus = "add";
          SoundManager.playCursor();
          this._lastStep = -1;
          this._lastIndex = -1;
          this.refreshUIOverlayDOM();
          break;
      }
    }

    cycleTopRail(direction) {
      const entries = this._topRailEntries();
      if (entries.length < 2) return;
      const cur = this._topRailIndex(entries);
      const next = (cur + direction + entries.length) % entries.length;
      this._openTopRailEntry(entries[next]);
    }

    // Read before any other input on every page of the wizard, so the rail is
    // reachable from wherever the cursor happens to be. Returns true when it
    // has taken the press.
    updateTopRailInput() {
      if (Scene_CharacterCreation._isScenarioMode || this._step === STEP.ORIGIN) return false;
      if (Input.isTriggered("pageup")) { this.cycleTopRail(-1); return true; }
      if (Input.isTriggered("pagedown") || Input.isTriggered("tab")) { this.cycleTopRail(1); return true; }
      // Resting on the empty seat: Confirm fills it, Cancel steps back onto the
      // last party tab. Nothing else on the page may read the pad meanwhile.
      if (Scene_CharacterCreation._railFocus === "add") {
        if (Input.isTriggered("ok")) {
          this.onAddPartyMember();
          return true;
        }
        if (Input.isTriggered("cancel") || TouchInput.isCancelled()) {
          Scene_CharacterCreation._railFocus = null;
          SoundManager.playCancel();
          this._lastStep = -1;
          this._lastIndex = -1;
          this.refreshUIOverlayDOM();
          return true;
        }
        return true;
      }
      return false;
    }

    onPartyMemberTabClick(memberIndex) {
      this._pageRailFocused = false;
      Scene_CharacterCreation._isPetMode = false;
      Scene_CharacterCreation._isScenarioMode = false;
      if (memberIndex >= $gameParty.size()) return;
      Scene_CharacterCreation._currentPartyMemberIndex = memberIndex;
      Scene_CharacterCreation.syncCreatureModeToCurrentMember();
      // Switching members always lands on the Bio tab, the first thing a
      // player is asked about whoever they just selected.
      this._step = STEP.BIO;
      if (this._presetWindow) {
        this.onPresetCancel();
      }
      this.setupStep();
      SoundManager.playCursor();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // The board's own confirmation sheet. window.confirm() paints an OS dialog
    // in the host browser's chrome, in the host's own colours and typeface, over
    // a screen that is otherwise entirely ours; this asks the same question on
    // the same parchment. Answers through the callback, never blocking.
    _ccConfirm(opts, onAccept) {
      const container = this._dndContainer || document.getElementById("character-creation-container");
      if (!container) { onAccept(); return; }

      const existing = container.querySelector(".cc-modal-veil");
      if (existing) existing.remove();

      const veil = document.createElement("div");
      veil.className = "cc-modal-veil";
      veil.innerHTML = `
        <div class="cc-modal" role="dialog" aria-modal="true">
          <h3 class="cc-modal-title">${opts.title || ""}</h3>
          <p class="cc-modal-body">${opts.body || ""}</p>
          <div class="cc-modal-actions">
            <button class="cc-sidebar-btn cc-modal-cancel">${opts.cancelLabel || T('CharCreate.cancel')}</button>
            <button class="cc-sidebar-btn primary cc-modal-accept">${opts.acceptLabel || T('CharCreate.confirm')}</button>
          </div>
        </div>
      `;

      const close = () => {
        document.removeEventListener("keydown", onKey, true);
        veil.remove();
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); SoundManager.playCancel(); close(); }
        else if (e.key === "Enter") { e.stopPropagation(); close(); onAccept(); }
      };
      veil.addEventListener("click", (e) => { if (e.target === veil) { SoundManager.playCancel(); close(); } });
      veil.querySelector(".cc-modal-cancel").addEventListener("click", () => { SoundManager.playCancel(); close(); });
      veil.querySelector(".cc-modal-accept").addEventListener("click", () => { close(); onAccept(); });
      document.addEventListener("keydown", onKey, true);

      container.appendChild(veil);
      veil.querySelector(".cc-modal-accept").focus();
    }

    onRemovePartyMember(idx, event) {
      if (event) event.stopPropagation();
      if (idx === 0) return;

      const partyMembers = $gameParty.members();
      if (idx >= partyMembers.length) return;
      const targetActor = partyMembers[idx];
      const name = targetActor ? targetActor.name() : ccT('CharCreate.unnamed', 'Unnamed');

      this._ccConfirm({
        title: ccT('CharCreate.removeMemberTitle', 'Remove from party'),
        body: ccTp('CharCreate.removeMemberBody', { name }, name + ' will be removed from the party.'),
        acceptLabel: ccT('CharCreate.deleteMember', 'Remove Member')
      }, () => this._removePartyMemberConfirmed(idx));
    }

    _removePartyMemberConfirmed(idx) {
      const partyMembers = $gameParty.members();
      if (idx <= 0 || idx >= partyMembers.length) return;
      const targetActor = partyMembers[idx];
      const actorId = targetActor.actorId();
      $gameParty.removeActor(actorId);
      $gameSwitches.setValue(77 + idx, false);

      if (Scene_CharacterCreation._currentPartyMemberIndex >= $gameParty.size()) {
        Scene_CharacterCreation._currentPartyMemberIndex = Math.max(0, $gameParty.size() - 1);
      }
      Scene_CharacterCreation.syncCreatureModeToCurrentMember();

      SoundManager.playCancel();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onAddPartyMember() {
      Scene_CharacterCreation._railFocus = null;
      if ($gameParty.size() >= 3) return;

      const existingIds = $gameParty.members().map((a) => a.actorId());
      let newActorId = 1;
      for (let id = 1; id <= 3; id++) {
        if (!existingIds.includes(id)) {
          newActorId = id;
          break;
        }
      }

      $gameParty.addActor(newActorId);
      const actor = $gameActors.actor(newActorId);
      const newIdx = $gameParty.members().indexOf(actor);

      // Randomize in humanoid mode with 2D sprite so it's fully ready and editable
      this._randomizeMemberCharacter(newIdx, { forceHumanoid: true, force2D: true });

      Scene_CharacterCreation._currentPartyMemberIndex = newIdx;
      Scene_CharacterCreation._isCreatureMode = false;
      Scene_CharacterCreation._isScenarioMode = false;
      Scene_CharacterCreation._isPetMode = false;
      // A new recruit opens on Bio, the page that names it and gives it a face,
      // rather than on whatever page the member before it was left on.
      this._step = STEP.BIO;
      if (this._titleWindow) this.setupStep();

      SoundManager.playOk();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onQuickRandomizeMember() {
      if (this._refusePresetEdit()) return;
      const memberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      this._randomizeMemberCharacter(memberIndex);
      Scene_CharacterCreation._lastMemberWasRandom = true;
      SoundManager.playOk();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // The board keeps its allocation as card ranks (0 to 4) on the member, in
    // its own scratch field, because the class and the traits underneath it can
    // still change while the wizard is open. Embarking is where it becomes the
    // member's actual training: level = rank + 1, and never below the head start
    // the class and the traits already grant, which specializationLevel() takes
    // care of on its own.
    _commitSpecPoints() {
      const members = ($gameParty && $gameParty.allMembers) ? $gameParty.allMembers() : [];
      members.forEach((actor) => {
        if (!actor || !actor._specTrained || !actor.setSpecializationTrainedLevel) return;
        const ctx = this._specGrantContext(actor);
        const catalog = this._specsCatalog();
        Object.keys(actor._specTrained).forEach((key) => {
          const spec = catalog.find((sp) => String(sp.id) === String(key));
          const rank = Math.max(actor._specTrained[key] || 0, this._specGrantRankIn(ctx, spec));
          if (rank > 0) actor.setSpecializationTrainedLevel(Number(key), rank + 1);
        });
      });
    }

    onFinishPartyCreation() {
      this._commitSpecPoints();
      const p1 = $gameActors.actor(1);
      if (!p1 || !p1.name() || p1.name() === "Unnamed") {
        if (p1) p1.setName(ccT('CharCreate.defaultName', 'Hero'));
      }
      if (!p1 || !p1._classId) {
        if (p1) p1.changeClass(1, false);
      }
      if (!$gameSystem._ccOriginSymbol) {
        $gameSystem._ccOriginSymbol = "origin_train";
      }

      if ($gameSystem._partyPet && window.PetSystem && window.PetSystem.recruitPet) {
        const traits = this._petTraits();
        window.PetSystem.recruitPet({
          id: $gameSystem._partyPet.id,
          name: $gameSystem._partyPet.name || "Companion",
          characterName: $gameSystem._partyPet.sprite,
          characterIndex: $gameSystem._partyPet.spriteIndex || 0,
          isFollower: traits.sentient, // sentient = free to leave = a follower, not a dependent pet
          enemyName: $gameSystem._partyPet.species,
          level: 1,
          archetype: $gameSystem._partyPet.kind,
          note: $gameSystem._partyPet.desc,
          sentient: traits.sentient,
          magical: traits.magical,
          geneticFreak: traits.geneticFreak,
        });
      }

      SoundManager.playOk();
      markFirstCreationComplete();
      if (this._dndContainer) {
        this._dndContainer.style.display = "none";
      }
      // A party holding a dossier lands where the dossier says, not where a
      // scenario would have put it: the scenario board was never shown.
      if (this._walkPresetLanding()) {
        this.popScene();
        return;
      }
      this._finishOriginChoice($gameSystem._ccOriginSymbol);
    }

    onNameChange(newName) {
      if (this._presetEditBlocked()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor || !newName || !newName.trim()) return;
      actor.setName(newName.trim());
      // The field that fired this sits IN the sidebar, and the board is redrawn
      // every frame, so invalidating the memo here threw the input away between
      // one keystroke and the next and the caret went with it: a name could only
      // ever be typed one letter at a time. The memo is deliberately left valid
      // and only the party tab, the other place the name shows, is rewritten.
      this._refreshTopFolderTabs();
    }

    onRandomizeNameClick() {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (actor) {
        let generated = "";
        if (window.NPCSociety && window.NPCSociety.generateActorName) {
          generated = window.NPCSociety.generateActorName(actor);
        }
        if (!generated) {
          const pool = ["Aiden", "Lyra", "Kael", "Vesper", "Soren", "Ember", "Rowan", "Zephyr", "Dante", "Selene", "Marcus", "Elena", "Valerius", "Iris", "Nox"];
          generated = pool[Math.floor(Math.random() * pool.length)];
        }
        actor.setName(generated);
        SoundManager.playOk();
        this._lastStep = -1;
        this._lastIndex = -1;
        this.refreshUIOverlayDOM();
      }
    }

    // Handing the screen to a gallery is a round trip: SceneManager.pop builds
    // a BRAND NEW wizard on the way back, and with nothing remembered that
    // wizard opened on step 0 - the initial settings page - instead of the
    // character whose portrait or sprite was just clicked. Leaving the step
    // behind as the resume point is what makes Escape (and the pad's B, and
    // the right mouse button) land back on the sheet it was called from.
    markReturnStep() {
      Scene_CharacterCreation._startStep = this._step;
    }

    onOpenSpriteGallery() {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      const isCreature = !!(actor && actor._isCreatureActor);

      if (isCreature) {
        this.onOpenCreature3DStudio();
        return;
      }

      // Humanoid: strictly open 2D Sprite Grid Selector & Connected Bust
      const selectorScene = window.Scene_CharacterSpriteGridSelector || window.Scene_SpriteGridSelector;
      if (selectorScene) {
        if (selectorScene.setup) {
          selectorScene.setup(actor ? actor.actorId() : 1, Scene_CharacterCreation);
        }
        this.markReturnStep();
        this.closeStepUI();
        SceneManager.push(selectorScene);
        if (SceneManager._nextScene && SceneManager._nextScene.setActor) {
          SceneManager._nextScene.setActor(actor ? actor.actorId() : 1);
        }
      }
    }

    // Clicking the sidebar portrait asks one question only: which bust. The
    // sprite keeps its own route in through the avatar beside the name.
    onOpenBustGallery() {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (actor && actor._isCreatureActor) {
        this.onOpenCreature3DStudio();
        return;
      }
      if (!window.Scene_BustSelector) {
        this.onOpenSpriteGallery();
        return;
      }
      // Pushed straight over the wizard, so confirming pops once and lands
      // back here instead of hunting for a sprite grid that was never opened.
      window.Scene_BustSelector._confirmPops = 1;
      this.markReturnStep();
      this.closeStepUI();
      SceneManager.push(window.Scene_BustSelector);
      if (SceneManager._nextScene && SceneManager._nextScene.setActor) {
        SceneManager._nextScene.setActor(actor ? actor.actorId() : 1);
      }
    }

    onSelectCreatureArchetype(modelKey) {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      // The dropdown offers archetypes, so the key is always one Archetypes.json
      // knows; storing it unchanged used to leave the member with a spelling the
      // body-part merge could not resolve, i.e. a creature with no body at all.
      if (!applyArchetypeToActor(actor, modelKey)) {
        SoundManager.playBuzzer();
        return;
      }
      SoundManager.playOk();
      this._repaintArchetypeStep();
    }

    // The sidebar's other half. An empty value is the None entry: the member
    // goes back to being built from its primary alone.
    onSelectCreatureSecondaryArchetype(modelKey) {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      if (!applySecondaryArchetypeToActor(actor, modelKey || null)) {
        SoundManager.playBuzzer();
        return;
      }
      SoundManager.playOk();
      this._repaintArchetypeStep();
    }

    onOpenCreature3DStudio() {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      if (window.Scene_CC3DModel && window.CC3DModel && window.CC3DModel.isAvailable && window.CC3DModel.isAvailable()) {
        // Sculpting one is what makes the model the creature's portrait.
        if (actor.setPortraitMode) actor.setPortraitMode("model");
        const archetypes = (actor && actor._creatureArchetypes) || [actor._currentArchetype || "Goblin"];
        window.Scene_CC3DModel.setup(actor.actorId(), Scene_CharacterCreation, {
          creature: true,
          initArchetypes: archetypes,
          returnByPop: true,
          confirmPops: 1
        });
        this.markReturnStep();
        this.closeStepUI();
        SceneManager.push(window.Scene_CC3DModel);
      }
    }

    onApplyPresetToCurrentMember(presetIndex) {
      const presets = availablePresets();
      const preset = presets[presetIndex] || (this._presetWindow && this._presetWindow.currentPreset());
      if (!preset) return;
      // One dossier to a party: a second one would overwrite the first one's
      // purse, kit and landing.
      if (this._hasPresetInParty(true)) {
        SoundManager.playBuzzer();
        return;
      }
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (actor) {
        const skins = presetSkins(preset);
        const skinIdx = this._presetWindow && this._presetWindow.skinIndex ? this._presetWindow.skinIndex(presetIndex) : 0;
        const skinData = skins[skinIdx] || skins[0] || preset;
        try {
          this._applyPreset(preset, actor, skinData);
        } catch (e) {
          console.error(`CharacterCreation: failed to apply preset "${preset.name}"`, e);
        }
        if (!preset.tutorialOnly && typeof markPresetUsed === "function") {
          markPresetUsed(preset.id);
        }
        actor.refresh();
        actor.recoverAll();
        $gameSystem._currentPresetId = preset.id;
        this._recordPresetLanding(preset);
        SoundManager.playOk();
      }
      this.onPresetCancel();
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
        const traitNames = selectedTraitObjects(mActor)
          .map((tr) => resolveTraitName(tr.name, tr.id))
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
        Scene_CharacterCreation.usesQuickFlow();
    }

    // True when the ORIGIN step renders the list-left / description-right spread.
    _isOriginPickerStep() {
      return this._step === STEP.ORIGIN;
    }

    // True when the PERSONALITY step renders the same spread. Guarded on the
    // catalogue as well: with no archetypes loaded the step is skipped before it
    // ever draws, and the one remaining "Random" card belongs on the ordinary
    // right page rather than alone on a two-page spread.
    _isPersonalityPickerStep() {
      return this._step === STEP.PERSONALITY && personalityCatalog().length > 0;
    }

    // One row per member naming the spells the rolled deal taught them, so a
    // party can read exactly which esoteric skills they are being handed rather
    // than a count. Empty for an origin that teaches nothing.
    _rolledSkillRows(symbol, row) {
      const roll = originRoll(symbol);
      if (!roll) return [];
      const members = $gameParty ? $gameParty.members() : [];
      const rows = [];
      roll.perMember.forEach((share, index) => {
        if (!share.skillIds || share.skillIds.length === 0) return;
        const names = share.skillIds
          .map((id) => $dataSkills[id])
          .filter(Boolean)
          .map((skill) => window.CCDbName(skill))
          .join(", ");
        const who = members[index] ? members[index].name() : String(index + 1);
        rows.push(row(who, names));
      });
      return rows;
    }

    // Builds the right page for the origin step: the highlighted origin's
    // description plus a short "what you start with" dossier.
    _originStepDetailsHtml(stepData, activeIndex) {
      const choice = (stepData.choices && stepData.choices[activeIndex]) || {};
      const row = (label, value) =>
        `<div class="cc-dossier-row"><span class="cc-dossier-label">${label}</span><span class="cc-dossier-value">${value}</span></div>`;
      // Loadout row: icon + real name on the left, quantity on the right,
      // read out of the database the entry names (items, but also the weapons
      // and the armor a rolled origin deals) so it always matches what is
      // actually granted. The name goes through CCDbName: this page is DOM, so
      // it never reaches the draw-time translator that localizes database names
      // elsewhere.
      const itemRow = (entry) => {
        const data = loadoutEntryData(entry);
        if (!data) return "";
        return `
          <div class="cc-dossier-row">
            <span class="cc-dossier-label" style="display:flex; align-items:center; gap:6px">
              <span style="${this._ccIconStyle(data.iconIndex)}"></span>${window.CCDbName(data)}
            </span>
            <span class="cc-dossier-value">x${entry.qty}</span>
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
        origin_lot: [
          row(T('CharCreate.start'), T('CharCreate.aRandomWorldMapTile')),
          row(T('CharCreate.specializations'), T('CharCreate.craftingSpecsAllMembers', { count: CRAFTING_SPEC_IDS.length })),
        ],
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
          row(T('CharCreate.start'), T('CharCreate.limecorpHeadquarters')),
          row(T('CharCreate.assets'), T('CharCreate.80OfLimecorpShares')),
        ],
        origin_artifact: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.inheritance'), T('CharCreate.1AncientArtifactDrawnAtRandom')),
        ],
        origin_crash: [row(T('CharCreate.start'), T('CharCreate.aRandomPlanetInAnUnchartedGalaxy'))],
        origin_warlord: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.troops'), T('CharCreate.40FromRandomFactions')),
          row(T('CharCreate.upkeep'), T('CharCreate.2WeeksOfTheirWagesInCash')),
        ],
        origin_faction_leader: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.troops'), T('CharCreate.40FromTheFactionYouPick')),
          row(T('CharCreate.upkeep'), T('CharCreate.2WeeksOfTheirWagesInCash')),
        ],
        origin_deserter: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.troops'), T('CharCreate.40FromTheFactionYouDeserted')),
        ],
        origin_augmented: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.augments'), T('CharCreate.augmentsPerMember', {
            min: AUGMENTED_ORIGIN_MIN, max: AUGMENTED_ORIGIN_MAX
          })),
        ],
        origin_card_collector: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.collection'), T('CharCreate.cardsInCollection', { count: CARD_ORIGIN_CARDS })),
          row(T('CharCreate.deck'), T('CharCreate.cardsSleevedDeck')),
        ],
        origin_arcanist: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.esotericSpells'), T('CharCreate.esotericSpellsPerMember', {
            count: ARCANIST_SKILLS_PER_MEMBER,
          })),
        ].concat(this._rolledSkillRows("origin_arcanist", row)),
        origin_mercenary: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.armament'), T('CharCreate.oneRangedWeaponEach')),
        ],
        origin_lost_convoker: [
          row(T('CharCreate.start'), T('CharCreate.aRandomSquareOfTheWorld')),
          row(T('CharCreate.summoningRites'), T('CharCreate.summoningRitesPerMember', {
            count: LOST_CONVOKER_SKILLS_PER_MEMBER,
          })),
        ].concat(this._rolledSkillRows("origin_lost_convoker", row)),
        origin_skeleton_key: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.supplies'), T('CharCreate.nothingButTheKey')),
        ],
        origin_plague: [
          row(T('CharCreate.start'), T('CharCreate.aCityOfYourChoice')),
          row(T('CharCreate.stock'), T('CharCreate.sealedVials', { count: plagueVialCount() })),
        ],
        origin_diplomat: [
          row(T('CharCreate.start'), T('CharCreate.theOnuAssemblyInBrussels')),
        ],
        origin_hypernet_explorer: [
          row(T('CharCreate.start'), T('CharCreate.theHypernetPoint')),
          row(T('CharCreate.components'), T('CharCreate.componentsCarried', {
            count: hypernetPartCount(),
          })),
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
      const itemsHtml = resolveOriginLoadout(choice.symbol).map(itemRow).join("");

      // Where you land and what you are carrying read differently and are laid
      // out differently. The context rows are sentences and keep the full width
      // of the page; the loadout is a list of short "icon name / xN" rows, and a
      // generous origin runs to a dozen of them, so they are set two to a line
      // rather than as one long column the page has to scroll through.
      const contextRows = (contexts[choice.symbol] || []).join("") + cashRow;
      const itemsGrid = itemsHtml
        ? `<div class="cc-dossier-grid cc-loadout-grid">${itemsHtml}</div>`
        : "";
      const dossierHtml = (contextRows || itemsGrid)
        ? `<div class="cc-dossier-card"><h3 class="cc-subheader">${T('CharCreate.startingOut')}</h3>${contextRows}${itemsGrid}</div>`
        : "";

      return `
        <div class="cc-page cc-page-right" style="display: flex">
          <h2 class="cc-header-gothic">${choice.name || ""}</h2>
          <p style="font-size: 1.329rem; line-height: 1.45; color: var(--text-card-dark); text-align: center; margin-bottom: 16px">
            ${this.cleanText(choice.description || "")}
          </p>

          <div style="flex: 1; min-height: 0; overflow-y: auto">
            ${dossierHtml}
          </div>
          <button class="cc-sidebar-btn primary" style="margin-top: 12px; width: 100%; justify-content: center; height: 42px; font-size: 1.05rem;" onclick="SceneManager._scene.onFinishPartyCreation()">
            ${this._ccIconHtml(78, 20)} <span>${T('CharCreate.embark') || "Embark & Begin Journey"}</span>
          </button>
        </div>
      `;
    }

    // Builds the right page for the personality step: what the highlighted
    // disposition is, one line it puts in the character's head, and what it does
    // to the body carrying it (PersonalityData.json `modifiers`, which the
    // biologic sim multiplies the baselines by). The Random card has no
    // archetype to read, so it shows its own description alone.
    _personalityStepDetailsHtml(stepData, activeIndex) {
      const choice = (stepData.choices && stepData.choices[activeIndex]) || {};
      const entry = choice.symbol === "personality_random"
        ? null : personalityCatalog()[choice.value];

      const row = (label, value) =>
        `<div class="cc-dossier-row"><span class="cc-dossier-label">${label}</span><span class="cc-dossier-value">${value}</span></div>`;

      // "prefrontalCortex" -> "Prefrontal Cortex", then through the translators:
      // the vitals and hormones are named in the biologic panel's own strings,
      // the brain regions in js/i18n/<lang>/brain.json (an English-source file,
      // so it is the database translator that answers for those).
      const statLabel = (key) => {
        if (T.has('Biologic.' + key)) return T('Biologic.' + key);
        const words = String(key)
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return window.CCDbName(words);
      };

      // A modifier is a multiplier on the baseline: 1.3 reads as +30%, 0.9 as
      // -10%, and the sign is what the player is actually reading for.
      const modRows = [];
      const modifiers = (entry && entry.modifiers) || {};
      Object.keys(modifiers).forEach((group) => {
        const stats = modifiers[group] || {};
        Object.keys(stats).forEach((key) => {
          const pct = Math.round((Number(stats[key]) - 1) * 100);
          if (!pct) return;
          modRows.push(row(statLabel(key), (pct > 0 ? "+" : "") + pct + "%"));
        });
      });

      // The archetype's own voice: PersonalityData.json carries its thoughts in
      // English and Italian only, so anything else reads the English bank.
      const thoughts = (entry && entry.thoughts) || null;
      const voice = thoughts
        ? (thoughts[T.language()] || thoughts.en || [])[0] || "" : "";

      const voiceHtml = voice
        ? `<div class="cc-dossier-card"><h3 class="cc-subheader">${T('CharCreate.personalityVoice')}</h3>
             <p class="cc-text-desc" style="margin-bottom: 0; font-style: italic">"${this.cleanText(voice)}"</p>
           </div>`
        : "";
      const modsHtml = modRows.length
        ? `<div class="cc-dossier-card"><h3 class="cc-subheader">${T('CharCreate.personalityBody')}</h3>
             <div class="cc-dossier-grid">${modRows.join("")}</div>
           </div>`
        : "";

      return `
        <div class="cc-page cc-page-right" style="display: flex">
          <h2 class="cc-header-gothic">${choice.name || ""}</h2>
          <p style="font-size: 1.329rem; line-height: 1.45; color: var(--text-card-dark); text-align: center; margin-bottom: 16px">
            ${this.cleanText(choice.description || "")}
          </p>

          <div style="flex: 1; min-height: 0; overflow-y: auto">
            ${voiceHtml}
            ${modsHtml}
          </div>
        </div>
      `;
    }

    _isTraitPickerStep() {
      return this._step === STEP.TRAITS;
    }

    // The illnesses a character can be created already carrying. They are not
    // traits and do not live in window.Health.Traits: the library dresses them
    // as cards so one grid draws both, and the trait plugin hands them over.
    _ccDiseaseCards() {
      const api = window.TraitPoints;
      if (!api || typeof api.diseaseCards !== "function") return [];
      if (!this._ccDiseaseCardCache || !this._ccDiseaseCardCache.length) {
        this._ccDiseaseCardCache = api.diseaseCards() || [];
      }
      return this._ccDiseaseCardCache;
    }

    // Every card the board can draw, whichever tab is open.
    _ccTraitBank() {
      return ((window.Health && window.Health.Traits) || []).concat(this._ccDiseaseCards());
    }

    // The card ids that are currently picked: bound traits plus, as card ids,
    // the illnesses the character already carries (those are kept as bare
    // disease ids on the actor, which is what the illness library wants).
    _ccPickedCardIds(actor) {
      const traits = selectedTraitIds(actor).map(String);
      const diseases = ((actor && actor._ccDiseases) || []).map((id) => "disease:" + id);
      return traits.concat(diseases);
    }

    _traitCategories() {
      return [
        { id: "all", label: ccT("CharCreate.filterAll", "All"), icon: 87 },
        { id: "genetic", label: ccT('Traits.tabGenetic', "Genetic"), icon: 292 },
        { id: "physical", label: ccT('Traits.tabPhysical', "Physical"), icon: 135 },
        { id: "mental", label: ccT('Traits.tabMental', "Mental"), icon: 183 },
        { id: "magical", label: ccT('Traits.tabMagical', "Magical"), icon: 165 },
        { id: "diseases", label: ccT('Traits.tabDiseases', "Diseases"), icon: 177 }
      ];
    }

    _traitPickerLeftHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      const traitBank = this._ccTraitBank();
      const selectedTraits = this._ccPickedCardIds(actor);
      const activeCategory = Scene_CharacterCreation._activeTraitCategory || "all";
      const categories = this._traitCategories();

      const railFocused = !!this._pageRailFocused;
      const tabsHtml = categories.map((cat) => {
        const isActive = activeCategory === cat.id;
        return `
          <div class="ts-tab ${isActive ? 'active' : ''} ${isActive && railFocused ? 'selected' : ''}" onclick="SceneManager._scene.onTraitCategorySelect('${cat.id}')">
            ${this._ccIconHtml(cat.icon, 16)} <span>${cat.label}</span>
          </div>
        `;
      }).join("");

      // Filter traits. "All" is all TRAITS: illnesses are free and have their
      // own tab, so mixing them into the priced list would only bury it.
      const filtered = activeCategory === "all"
        ? traitBank.filter((t) => !t.diseaseId)
        : activeCategory === "diseases"
          ? traitBank.filter((t) => !!t.diseaseId)
          : traitBank.filter((t) => !t.diseaseId && t.category === activeCategory);

      const cardsHtml = filtered.map((trait) => {
        const isSelected = selectedTraits.some((id) => String(id) === String(trait.id));
        const name = (trait.name && resolveTraitName(trait.name, trait.id)) || trait.id;
        // An illness costs nothing, so it carries no price tag.
        const cost = Number.isFinite(Number(trait.cost)) ? Number(trait.cost) : 1;
        const costHtml = trait.diseaseId
          ? ""
          : `<span class="trait-cost ${cost < 0 ? 'refund' : ''}">${cost < 0 ? `+${-cost}` : cost}</span>`;

        return `
          <div class="cc-card-option ${isSelected ? 'selected' : ''}"
               onclick="SceneManager._scene.onTraitToggle('${trait.id}')"
               onmouseenter="SceneManager._scene.onTraitCardHover('${trait.id}')">
            <span class="cc-rpg-icon" style="${this._ccIconStyle(trait.icon || 87, 20)}"></span>
            <div class="cc-option-title">${name}</div>
            ${costHtml}
          </div>
        `;
      }).join("");

      const emptyHtml = `<div class="cc-class-empty">${ccT('Traits.noneInCategory', 'Nothing here')}</div>`;

      return `
        <div class="cc-page cc-page-left ts-page cc-trait-board" style="display: flex; flex-direction: column;">
          <div class="ts-tab-row">${tabsHtml}</div>
          <div class="cc-select-grid cc-trait-grid">
            ${cardsHtml || emptyHtml}
          </div>
        </div>
      `;
    }

    _traitPickerRightHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      const traitBank = this._ccTraitBank();
      const selectedTraits = this._ccPickedCardIds(actor);
      const hoveredId = Scene_CharacterCreation._hoveredTraitId || selectedTraits[0] || (traitBank[0] && traitBank[0].id);
      const hoveredTrait = traitBank.find((t) => String(t.id) === String(hoveredId)) || traitBank[0];

      // The purse used to head the card grid on the left page; it reads as the
      // sheet's running total, so it heads the sheet page instead. An illness
      // is not bought: it is something the character walks in already
      // carrying, so it never touches the purse.
      let spent = 0, refunded = 0;
      selectedTraits.forEach((id) => {
        const tr = traitBank.find((t) => String(t.id) === String(id));
        if (tr && !tr.diseaseId) {
          const cost = Number.isFinite(Number(tr.cost)) ? Number(tr.cost) : 1;
          if (cost >= 0) spent += cost;
          else refunded -= cost;
        }
      });
      const credit = Math.min(refunded, 6);
      const remaining = 10 + credit - spent;

      const purseHtml = `
        <div class="ts-purse ts-purse--sheet">
          <div class="ts-purse-cell spend">
            <span class="ts-purse-value">${spent}</span>
            <span class="ts-purse-label">${ccT('Traits.purseSpent', 'Spent')}</span>
          </div>
          <div class="ts-purse-cell refund">
            <span class="ts-purse-value">+${refunded}</span>
            <span class="ts-purse-label">${ccT('Traits.purseRefunds', 'Refunds')}</span>
          </div>
          <div class="ts-purse-cell ${remaining < 0 ? 'over' : ''}">
            <span class="ts-purse-value">${remaining}</span>
            <span class="ts-purse-label">${ccT('Traits.purseLeft', 'Remaining')}</span>
          </div>
        </div>
      `;

      // Details of hovered trait
      let detailHtml = "";
      if (hoveredTrait) {
        const name = hoveredTrait.diseaseId
          ? hoveredTrait.name
          : ((hoveredTrait.name && resolveTraitName(hoveredTrait.name, hoveredTrait.id)) || hoveredTrait.id);
        const desc = hoveredTrait.diseaseId
          ? (hoveredTrait.description || "")
          : ((hoveredTrait.description && resolveTraitDesc(hoveredTrait.description, hoveredTrait.id)) || "");
        const cost = Number.isFinite(Number(hoveredTrait.cost)) ? Number(hoveredTrait.cost) : 1;
        const costBadge = hoveredTrait.diseaseId
          ? `<span class="trait-cost refund">${ccT('Traits.tabDiseases', 'Diseases')}</span>`
          : cost < 0
            ? `<span class="trait-cost refund">+${-cost} ${ccT('Traits.refundWord', 'refund')}</span>`
            : `<span class="trait-cost">${cost} ${ccT('Traits.pts', 'pts')}</span>`;

        let statRows = "";
        if (hoveredTrait.positive) {
          statRows += Object.entries(hoveredTrait.positive)
            .map(([k, v]) => `<span class="cc-element-badge" style="color:var(--text-forest-green, #4ade80)">+${v} ${k.toUpperCase()}</span>`)
            .join(" ");
        }
        if (hoveredTrait.negative) {
          statRows += Object.entries(hoveredTrait.negative)
            .map(([k, v]) => `<span class="cc-element-badge" style="color:var(--accent-red-3, #f87171)">${v} ${k.toUpperCase()}</span>`)
            .join(" ");
        }

        let extraGrants = "";
        if (hoveredTrait.skills && hoveredTrait.skills.length > 0 && typeof $dataSkills !== "undefined") {
          const sNames = hoveredTrait.skills.map((sid) => ($dataSkills[sid] ? $dataSkills[sid].name : `Skill #${sid}`)).join(", ");
          extraGrants += `<div style="font-size:0.85rem; color:var(--text-text-alt-2); margin-top:4px;"><strong>${ccT('Traits.grantsSkills', 'Skills')}:</strong> ${sNames}</div>`;
        }

        detailHtml = `
          <div class="cc-dossier-card ts-detail-card" style="margin-bottom:10px;">
            <div class="ts-detail-head">
              <span class="cc-rpg-icon" style="${this._ccIconStyle(hoveredTrait.icon || 87, 26)}"></span>
              <span class="ts-detail-label">${name}</span>
              ${costBadge}
            </div>
            <div class="ts-detail-desc">${desc}</div>
            ${statRows ? `<div class="ts-badge-row" style="justify-content:flex-start; margin-top:6px;">${statRows}</div>` : ''}
            ${extraGrants}
          </div>
        `;
      }

      // Selected chips: traits carry their price, illnesses carry none.
      const chipFor = (id) => {
        const tr = traitBank.find((t) => String(t.id) === String(id));
        if (!tr) return "";
        const name = tr.diseaseId ? tr.name : ((tr.name && resolveTraitName(tr.name, tr.id)) || id);
        const cost = Number.isFinite(Number(tr.cost)) ? Number(tr.cost) : 1;
        const badge = tr.diseaseId
          ? ""
          : `<span class="trait-cost ${cost < 0 ? 'refund' : ''}">${cost < 0 ? `+${-cost}` : cost}</span>`;
        return `
          <div class="cc-picked-chip ${tr.diseaseId ? 'illness' : ''}" onclick="SceneManager._scene.onTraitToggle('${tr.id}')">
            <span class="cc-rpg-icon" style="${this._ccIconStyle(tr.icon || 87, 18)}"></span>
            <span>${name}</span>
            ${badge}
            <span class="cc-slot-remove">&#10005;</span>
          </div>
        `;
      };
      const traitOnlyIds = selectedTraits.filter((id) => String(id).indexOf("disease:") !== 0);
      const diseaseIds = selectedTraits.filter((id) => String(id).indexOf("disease:") === 0);
      const pickedChips = traitOnlyIds.map(chipFor).filter(Boolean).join("");
      const diseaseChips = diseaseIds.map(chipFor).filter(Boolean).join("");

      // Calculate total bonuses
      const totals = { hp: 0, mp: 0, atk: 0, def: 0, mat: 0, mdf: 0, agi: 0, luk: 0 };
      selectedTraits.forEach((id) => {
        const tr = traitBank.find((t) => String(t.id) === String(id));
        if (tr) {
          Object.keys(tr.positive || {}).forEach((k) => { if (totals[k] !== undefined) totals[k] += tr.positive[k]; });
          Object.keys(tr.negative || {}).forEach((k) => { if (totals[k] !== undefined) totals[k] += tr.negative[k]; });
        }
      });
      const bonusBadges = Object.entries(totals)
        .filter(([k, v]) => v !== 0)
        .map(([k, v]) => `<span class="cc-element-badge" style="color:${v > 0 ? 'var(--text-forest-green, #4ade80)' : 'var(--accent-red-3, #f87171)'}">${v > 0 ? '+' : ''}${v} ${k.toUpperCase()}</span>`)
        .join(" ") || `<span style="opacity:0.6; font-size:0.88rem">${ccT('CharCreate.noDefiningTraits', 'No trait modifiers')}</span>`;

      const totalBonusesTitle = (ccT('Traits.totalBonuses', 'Total Modifiers')).replace(/[:\s]+$/, '');

      return `
        <div class="cc-page cc-page-right ts-page cc-trait-detail" style="display: flex; flex-direction: column;">
          <div class="ts-sheet-head">
            ${purseHtml}
            <div class="ts-sheet-actions">
              <button class="cc-profile-open-btn" onclick="SceneManager._scene.onTraitResetForCurrentActor()">${ccT('Traits.resetTraits', 'Reset')}</button>
              <button class="cc-profile-open-btn" onclick="SceneManager._scene.onRandomizeTraitsForCurrentActor()">${ccT('CharCreate.randomize', 'Randomize')}</button>
            </div>
          </div>

          ${detailHtml}

          <div class="ts-picked-block">
            <h3 class="cc-subheader ts-section-head">
              <span>${ccT('Traits.selectedTraitsLabel', 'Selected Traits')}</span>
              <span class="ts-count">${traitOnlyIds.length}/8</span>
            </h3>
            <div class="cc-picked-row">
              ${pickedChips || `<span class="cc-picked-empty">${ccT('CharCreate.noDefiningTraits', 'None selected')}</span>`}
            </div>
          </div>

          ${diseaseChips ? `
            <div class="ts-picked-block">
              <h3 class="cc-subheader ts-section-head">
                <span>${ccT('Traits.tabDiseases', 'Diseases')}</span>
                <span class="ts-count">${diseaseIds.length}</span>
              </h3>
              <div class="cc-picked-row">${diseaseChips}</div>
            </div>
          ` : ''}

          <div class="cc-dossier-card ts-summary">
            <div class="ts-summary-row">
              <span class="cc-dossier-label">${totalBonusesTitle}:</span>
              <div class="ts-badge-row" style="justify-content:flex-start;">${bonusBadges}</div>
            </div>
          </div>
        </div>
      `;
    }

    onTraitCategorySelect(category) {
      Scene_CharacterCreation._activeTraitCategory = category;
      SoundManager.playCursor();
      const container = this._dndContainer;
      if (container) {
        const leftPage = container.querySelector(".cc-page-left");
        if (leftPage) {
          this._ccSwapPage(leftPage, this._traitPickerLeftHtml());
          return;
        }
      }
      this.refreshUIOverlayDOM();
    }

    onTraitCardHover(traitId) {
      if (String(Scene_CharacterCreation._hoveredTraitId) === String(traitId)) return;
      Scene_CharacterCreation._hoveredTraitId = traitId;
      const rightPage = this._dndContainer && this._dndContainer.querySelector(".cc-page-right");
      if (rightPage) {
        this._ccSwapPage(rightPage, this._traitPickerRightHtml());
      }
    }

    onTraitToggle(traitId) {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      if (!actor._selectedTraits) actor._selectedTraits = [];
      const traitBank = this._ccTraitBank();
      const trait = traitBank.find((t) => String(t.id) === String(traitId));
      if (!trait) return;

      // An illness is not bought and does not count against the eight picks:
      // it is handed straight to the illness library, which owns whatever it
      // grants. Nothing on this path touches the trait purse.
      if (trait.diseaseId) {
        this._toggleStartingDisease(actor, trait);
        this._refreshTraitBoard();
        return;
      }

      const picked = selectedTraitIds(actor);
      const idx = picked.findIndex((id) => String(id) === String(trait.id));
      if (idx >= 0) {
        picked.splice(idx, 1);
        SoundManager.playCancel();
      } else {
        const selectedObjects = picked
          .map((id) => traitBank.find((t) => String(t.id) === String(id)))
          .filter(Boolean);
        const cost = Number.isFinite(Number(trait.cost)) ? Number(trait.cost) : 1;
        let spent = 0, refunded = 0;
        selectedObjects.forEach((t) => {
          const c = Number.isFinite(Number(t.cost)) ? Number(t.cost) : 1;
          if (c >= 0) spent += c;
          else refunded -= c;
        });
        const credit = Math.min(refunded, 6);
        const remaining = 10 + credit - spent;
        if (selectedObjects.length >= 8) {
          SoundManager.playBuzzer();
          return;
        }
        if (cost < 0 && (refunded - cost > 6)) {
          SoundManager.playBuzzer();
          return;
        }
        if (cost >= 0 && cost > remaining) {
          SoundManager.playBuzzer();
          return;
        }
        // Check incompatibility
        const incompatible = selectedObjects.some((bound) =>
          (trait.incompatible || []).some((incId) => String(incId) === String(bound.id)) ||
          (bound.incompatible || []).some((incId) => String(incId) === String(trait.id))
        );
        if (incompatible) {
          SoundManager.playBuzzer();
          return;
        }
        picked.push(trait.id);
        SoundManager.playOk();
      }

      this._ccApplyTraitIds(actor, picked);
      this._refreshTraitBoard();
    }

    // Writes a picked list back onto the member and re-applies what it grants.
    // The appliers all end by storing the whole trait objects, so the list is
    // never assumed to still be ids after this: every read goes back through
    // selectedTraitIds / selectedTraitObjects.
    _ccApplyTraitIds(actor, ids) {
      actor._selectedTraits = ids.slice();
      if (typeof applyTraitsToActor === 'function') {
        applyTraitsToActor(actor, ids);
      } else if (window.Scene_TraitSelector && typeof window.Scene_TraitSelector.prototype.applyTraitsByIds === 'function') {
        window.Scene_TraitSelector.prototype.applyTraitsByIds(ids, actor.actorId());
      }
    }

    // Puts the whole build down: every trait and every illness chosen here goes
    // back, and what they granted goes back with them, so the purse reads full
    // again and the member starts the step from nothing.
    onTraitResetForCurrentActor() {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const hadSomething = selectedTraitIds(actor).length > 0 || ((actor._ccDiseases || []).length > 0);
      if (!hadSomething) {
        SoundManager.playBuzzer();
        return;
      }

      const TP = window.TraitPoints;
      if (TP && TP.revertGrants) TP.revertGrants(actor, actor._selectedTraits);
      actor._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
      this._ccApplyTraitIds(actor, []);
      actor._selectedTraits = [];

      const api = window.DiseaseSystem;
      ((actor._ccDiseases || []).slice()).forEach((id) => {
        if (api && api.cureActor) api.cureActor(actor, id);
      });
      actor._ccDiseases = [];

      if (actor.refresh) actor.refresh();
      SoundManager.playCancel();
      this._refreshTraitBoard();
    }

    // Both pages of the trait spread plus the dossier sidebar, redrawn from the
    // actor as it stands now.
    _refreshTraitBoard() {
      const container = this._dndContainer;
      if (!container) { this.refreshUIOverlayDOM(); return; }
      this._ccSwapPage(container.querySelector(".cc-page-left"), this._traitPickerLeftHtml());
      this._ccSwapPage(container.querySelector(".cc-page-right"), this._traitPickerRightHtml());
      const sidebarSlot = container.querySelector(".cc-sidebar-slot");
      if (sidebarSlot) sidebarSlot.innerHTML = this._renderCompactSidebarHtml();
      this._refreshTopFolderTabs();
    }

    // Picks up or puts down an illness the character starts the game with. The
    // library owns what it does; all that is kept here is which ones were
    // chosen at creation, so putting one down again can cure exactly that one.
    _toggleStartingDisease(actor, card) {
      if (!actor._ccDiseases) actor._ccDiseases = [];
      const api = window.DiseaseSystem;
      const at = actor._ccDiseases.indexOf(card.diseaseId);
      if (at >= 0) {
        actor._ccDiseases.splice(at, 1);
        if (api && api.cureActor) api.cureActor(actor, card.diseaseId);
        SoundManager.playCancel();
      } else {
        actor._ccDiseases.push(card.diseaseId);
        if (api && api.infectActor) {
          api.infectActor(actor, card.diseaseId, null, null, { silent: true, diagnosed: true });
        }
        SoundManager.playOk();
      }
    }

    onRandomizeTraitsForCurrentActor() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const targetActorId = (Scene_CharacterCreation._currentPartyMemberIndex || 0) + 1;
      if (window.randomizeTraitsForActor) {
        window.randomizeTraitsForActor(targetActorId);
      } else {
        const traitBank = (window.Health && window.Health.Traits) || [];
        const picked = [];
        const drawbacks = traitBank.filter((t) => (Number(t.cost) || 1) < 0 && t.category !== "genetic");
        const positives = traitBank.filter((t) => (Number(t.cost) || 1) >= 0 && t.category !== "genetic");
        if (drawbacks.length > 0) {
          picked.push(drawbacks[Math.floor(Math.random() * drawbacks.length)].id);
        }
        for (let i = 0; i < 2 && positives.length > 0; i++) {
          const p = positives[Math.floor(Math.random() * positives.length)];
          if (!picked.includes(p.id)) picked.push(p.id);
        }
        this._ccApplyTraitIds(actor, picked);
      }
      SoundManager.playOk();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onTraitConfirm() {
      markStepCompleted(STEP.TRAITS);
      SoundManager.playOk();
      this.nextStep();
    }

    // ── Specializations Step Helpers & Handlers ──
    _isSpecsPickerStep() {
      return this._step === STEP.SPECIALIZATIONS;
    }

    _specsCatalog() {
      if (window.Specializations && window.Specializations.ready && window.Specializations.list) {
        return window.Specializations.list;
      }
      // i18n-ignore-start: a mirror of Specialization.json, shown only when
      // window.Specializations has not loaded. The live path names every entry
      // through Specializations.displayName / categoryLabel.
      return [
        { id: 1, name: "Accounting", category: "Commerce", stat: "INT", description: "Keeping and interpreting financial ledgers and transaction records." },
        { id: 2, name: "Acrobatics", category: "Athletics", stat: "DEX", description: "Controlled tumbling, vaulting, and balance in motion." },
        { id: 3, name: "Acting", category: "Social", stat: "PSI", description: "Portraying characters convincingly for an audience." },
        { id: 10, name: "Algorithm Design", category: "Technology", stat: "INT", description: "Formulating computational steps for hypernet routines." },
        { id: 20, name: "Anatomy", category: "Medicine", stat: "INT", description: "Knowledge of physical structures and biological organs." },
        { id: 30, name: "Arcane Synthesis", category: "Arcana", stat: "INT", description: "Channeling raw mana into stable thaumaturgical constructs." },
        { id: 40, name: "Blacksmithing", category: "Crafting", stat: "STR", description: "Forging steel, alloys, and tempered blades." },
        { id: 50, name: "Brawling", category: "Combat", stat: "STR", description: "Close-quarters unarmed pugilism and dirty infighting." },
        { id: 60, name: "Cybernetics", category: "Technology", stat: "INT", description: "Maintaining and augmenting neural prosthetic cyberware." },
        { id: 70, name: "Marksmanship", category: "Combat", stat: "DEX", description: "Precision shooting with ballistic and projectile weaponry." },
        { id: 80, name: "Lockpicking", category: "Crime", stat: "DEX", description: "Bypassing tumblers, digital pins, and electronic security." },
        { id: 90, name: "Persuasion", category: "Social", stat: "PSI", description: "Influencing negotiations and securing favorable terms." },
        { id: 100, name: "Survival", category: "Survival", stat: "CON", description: "Foraging, navigation, and wilderness endurance." },
        { id: 110, name: "Culinary Arts", category: "Culinary", stat: "DEX", description: "Preparing nourishing and morale-boosting cuisine." },
      ];
    }

    _specsCategories() {
      if (window.Specializations && window.Specializations.ready && window.Specializations.categories) {
        return [SPEC_TAB_CURRENT, "All", ...window.Specializations.categories];
      }
      return [SPEC_TAB_CURRENT, "All", "Combat", "Technology", "Crafting", "Social", "Medicine", "Athletics", "Commerce", "Crime", "Arcana", "Survival", "Culinary"];
      // i18n-ignore-end
    }

    // The class and the traits a member walks in with already hand them a head
    // start in some specializations. Both tables live on the specialization
    // itself (Specialization.json "classStart" / "traitStart"), so the whole
    // grant is worked out from one context built once per redraw instead of
    // rummaging through the trait bank for every one of the 800 entries.
    _specGrantContext(actor) {
      if (!actor) return { className: null, slugs: [] };
      let cls = null;
      if (typeof $dataClasses !== "undefined" && $dataClasses && actor._classId) cls = $dataClasses[actor._classId];
      if (!cls && actor.currentClass) cls = actor.currentClass();
      const bank = (window.Health && window.Health.Traits) || [];
      const slugs = ((actor._selectedTraits) || []).map((entry) => {
        // The board keeps bound traits as ids, the older selector kept the
        // whole trait object. Either is read here.
        const trait = (entry && entry.name) ? entry : bank.find((t) => String(t.id) === String(entry));
        return (trait && trait.name) ? String(trait.name).split(".")[1] : null;
      }).filter(Boolean);
      return { className: cls ? cls.name : null, slugs };
    }

    // The head start itself, as a card rank (0 to 4). When the class and more
    // than one trait name the same specialization, the most generous of them
    // is the one that counts.
    _specGrantRankIn(ctx, spec) {
      if (!ctx || !spec) return 0;
      let best = 1;
      if (ctx.className && spec.classStart) {
        const lvl = spec.classStart[ctx.className] || 0;
        if (lvl > best) best = lvl;
      }
      if (spec.traitStart) {
        ctx.slugs.forEach((slug) => {
          const lvl = spec.traitStart[slug] || 0;
          if (lvl > best) best = lvl;
        });
      }
      return Math.max(0, Math.min(5, best) - 1);
    }

    _specGrantRank(actor, spec) {
      return this._specGrantRankIn(this._specGrantContext(actor), spec);
    }

    // What the card shows: the points spent on it, never below the free head
    // start the class and the traits already gave.
    _specRankIn(ctx, actor, spec) {
      if (!actor || !spec) return 0;
      const trained = (actor._specTrained && actor._specTrained[spec.id]) || 0;
      return Math.max(trained, this._specGrantRankIn(ctx, spec));
    }

    _specRank(actor, spec) {
      return this._specRankIn(this._specGrantContext(actor), actor, spec);
    }

    // Every specialization the member already stands above Untrained in,
    // whether it was bought or granted. This is what the "Current" tab lists.
    _specsWithLevels(actor) {
      if (!actor) return [];
      const ctx = this._specGrantContext(actor);
      return this._specsCatalog().filter((sp) => this._specRankIn(ctx, actor, sp) > 0);
    }

    // The specialization catalogue narrowed by the open category tab and the
    // search field. One filter, used by the board and by every partial redraw
    // of it, so a search can never survive a category change (or the reverse)
    // just because two copies of the filter disagreed on how to read a spec's
    // description.
    _filteredSpecs() {
      const catalog = this._specsCatalog();
      const activeCat = Scene_CharacterCreation._activeSpecCategory || "All";
      const q = (Scene_CharacterCreation._specSearchQuery || "").toLowerCase().trim();
      const S = window.Specializations || {};
      const nameOf = (sp) => (S.displayName ? S.displayName(sp) : sp.name) || "";
      const descOf = (sp) => (S.describe ? S.describe(sp) : sp.description) || "";

      const byCat = activeCat === "All"
        ? catalog
        : activeCat === SPEC_TAB_CURRENT
          ? this._specsWithLevels(Scene_CharacterCreation.getCurrentActor())
          : catalog.filter((sp) => sp.category === activeCat);
      const sorted = byCat.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      if (!q) return sorted;
      return sorted.filter((sp) =>
        nameOf(sp).toLowerCase().includes(q) ||
        descOf(sp).toLowerCase().includes(q) ||
        (sp.stat && sp.stat.toLowerCase().includes(q))
      );
    }

    // How many of the budget points are still unspent, and the spend recorded
    // on the member while we are counting them.
    _specsRemaining(actor) {
      if (!actor) return 0;
      if (!actor._specTrained) actor._specTrained = {};
      // Only the ranks bought above a class or trait head start are paid for:
      // the head start itself was never taken out of the purse.
      const ctx = this._specGrantContext(actor);
      const catalog = this._specsCatalog();
      let spent = 0;
      Object.keys(actor._specTrained).forEach((k) => {
        const spec = catalog.find((sp) => String(sp.id) === String(k));
        const floor = this._specGrantRankIn(ctx, spec);
        spent += Math.max(0, (actor._specTrained[k] || 0) - floor);
      });
      actor._specPointsSpent = spent;
      return Math.max(0, CC_SPEC_BUDGET - spent);
    }

    // One card per specialization. Shared by the first draw and by every
    // in-place redraw of the grid.
    _specCardsHtml(specs, actor, remaining) {
      const S = window.Specializations || {};
      const ctx = this._specGrantContext(actor);
      return specs.map((spec) => {
        const specName = S.displayName ? S.displayName(spec) : spec.name;
        const specCatLabel = S.categoryLabel ? S.categoryLabel(spec.category) : (spec.category || "General");
        // A class or trait head start is a floor the card can never fall below.
        const grantRank = this._specGrantRankIn(ctx, spec);
        const currentRank = Math.max((actor && actor._specTrained && actor._specTrained[spec.id]) || 0, grantRank);
        const isHovered = Scene_CharacterCreation._hoveredSpecId === spec.id;
        const pipsHtml = [1, 2, 3, 4].map((tier) => `<div class="cc-spec-pip ${currentRank >= tier ? 'active' : ''}${grantRank >= tier ? ' bonus' : ''}"></div>`).join("");
        return `
          <div class="cc-spec-card ${isHovered ? 'selected' : ''}" data-spec-id="${spec.id}" onmouseenter="SceneManager._scene.onSpecCardHover(${spec.id})">
            <div class="cc-spec-info">
              <div class="cc-spec-title">${specName}</div>
              <div class="cc-spec-meta">
                <span class="cc-spec-stat-badge">${ccStatLabel(spec.stat || 'INT')}</span>
                <span class="cc-spec-cat-label">${specCatLabel}</span>
              </div>
            </div>
            <div class="cc-spec-controls">
              <button class="cc-spec-btn cc-spec-btn-minus" ${currentRank <= grantRank ? 'disabled' : ''} onclick="SceneManager._scene.onSpecPointAdjust(${spec.id}, -1)">-</button>
              <div class="cc-spec-pips">${pipsHtml}</div>
              <button class="cc-spec-btn cc-spec-btn-plus" ${(remaining <= 0 || currentRank >= 4) ? 'disabled' : ''} onclick="SceneManager._scene.onSpecPointAdjust(${spec.id}, 1)">+</button>
            </div>
          </div>
        `;
      }).join("");
    }

    // The grid's contents, or the line that says the filter matched nothing.
    _specGridInnerHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      const remaining = this._specsRemaining(actor);
      const cards = this._specCardsHtml(this._filteredSpecs(), actor, remaining);
      if (cards.length > 0) return cards;
      return `<div style="grid-column: 1 / -1; text-align:center; padding:20px; color:#a89f91; font-size:0.9rem;">${T('SpecMenu.ui.noMatches')}</div>`;
    }

    // Redraw just the card grid in place, leaving the search field (and the
    // caret sitting in it) exactly where it is.
    _refreshSpecGrid() {
      const grid = this._dndContainer && this._dndContainer.querySelector(".cc-spec-grid");
      if (!grid) { this.refreshUIOverlayDOM(); return false; }
      grid.innerHTML = this._specGridInnerHtml();
      grid.scrollTop = 0;
      return true;
    }

    _specsPickerLeftHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return `<div class="cc-page cc-page-left"></div>`;

      const activeCat = Scene_CharacterCreation._activeSpecCategory || "All";
      const categories = this._specsCategories();
      const remaining = this._specsRemaining(actor);
      const budget = CC_SPEC_BUDGET;

      // Category Tabs. Each tab carries its own category on the element, so a
      // later redraw can move the highlight without having to work out which
      // tab is which from its translated label.
      const railFocused = !!this._pageRailFocused;
      const catTabsHtml = categories.map((cat) => {
        const isActive = cat === activeCat;
        const catLabel = cat === "All"
          ? T('SpecMenu.ui.all')
          : cat === SPEC_TAB_CURRENT
            ? ccT('CharCreate.specsCurrent', "Current")
            : ((window.Specializations && window.Specializations.categoryLabel) ? window.Specializations.categoryLabel(cat) : cat);
        return `
          <button class="cc-spec-tab ${isActive ? 'active' : ''} ${isActive && railFocused ? 'selected' : ''}" data-cat="${cat}" onclick="SceneManager._scene.onSpecCategorySelect('${cat}')">
            ${catLabel}
          </button>
        `;
      }).join("");

      return `
        <div class="cc-page cc-page-left cc-spec-board ts-page" style="display: flex; flex-direction: column;">
          <div style="display:flex; align-items:center; justify-content:flex-end; margin-bottom:8px">
            <div class="ts-purse" style="display:flex; gap:6px; font-size:0.88rem;">
              <span class="ts-purse-chip">${T('CharCreate.budgetPoints', { remaining: remaining, total: budget })}</span>
            </div>
          </div>
          <div class="cc-spec-tab-row">${catTabsHtml}</div>
          <div style="margin-bottom:6px;">
            <input type="text" class="cc-bio-select" style="padding:4px 10px; font-size:0.85rem; height:30px;" placeholder="${T('SpecMenu.ui.searchPlaceholder')}" oninput="SceneManager._scene.onSpecSearch(this.value)" value="${Scene_CharacterCreation._specSearchQuery || ''}">
          </div>
          <div class="cc-spec-grid" style="padding-bottom: 24px;">
            ${this._specGridInnerHtml()}
          </div>
        </div>
      `;
    }

    _specsPickerRightHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      const catalog = this._specsCatalog();
      if (!actor) return `<div class="cc-page cc-page-right"></div>`;
      if (!actor._specTrained) actor._specTrained = {};

      // Everything the member stands above Untrained in, the granted head
      // starts included, so the roll matches what the "Current" tab lists.
      const grantCtx = this._specGrantContext(actor);
      const trainedEntries = this._specsWithLevels(actor)
        .map((sp) => [sp.id, this._specRankIn(grantCtx, actor, sp), this._specGrantRankIn(grantCtx, sp)]);
      const hoveredId = Scene_CharacterCreation._hoveredSpecId || (trainedEntries[0] ? Number(trainedEntries[0][0]) : catalog[0]?.id);
      const hoveredSpec = catalog.find((s) => s.id === hoveredId) || catalog[0];

      // The rank ladder is the specialization menu's own wording, so a tier
      // is named the same here as it is there (js/i18n/*/plugins/SpecMenu.json).
      const rankNames = ccList('SpecMenu.rankNames',
        ["Untrained", "Novice (+1)", "Adept (+2)", "Expert (+3)", "Master (+4)"]);
      const rankName = (r) => (window.Specializations && window.Specializations.levelName) ? window.Specializations.levelName(r) : (rankNames[r] || rankNames[0]);

      let detailHtml = "";
      if (hoveredSpec) {
        const specName = (window.Specializations && window.Specializations.displayName) ? window.Specializations.displayName(hoveredSpec) : hoveredSpec.name;
        const specDesc = (window.Specializations && window.Specializations.describe) ? window.Specializations.describe(hoveredSpec) : (hoveredSpec.description || "");
        const catLabel = (window.Specializations && window.Specializations.categoryLabel) ? window.Specializations.categoryLabel(hoveredSpec.category) : (hoveredSpec.category || "General");
        const rank = this._specRankIn(grantCtx, actor, hoveredSpec);
        const grantRank = this._specGrantRankIn(grantCtx, hoveredSpec);
        const rankLabel = rankName(rank);

        detailHtml = `
          <div class="cc-dossier-card ts-detail" style="padding: 10px 12px; margin-bottom: 8px;">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:8px; border-bottom:1px solid rgba(218,165,32,0.25); padding-bottom:6px;">
              <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                <span class="cc-spec-stat-badge" style="font-size:0.85rem; flex-shrink:0;">${ccStatLabel(hoveredSpec.stat || 'INT')}</span>
                <span style="font-family:'Lora',serif; font-size:1.15rem; font-weight:bold; color:#ffd700; overflow-wrap:break-word; line-height:1.2;">${specName}</span>
              </div>
              <span class="trait-cost" style="font-size:0.82rem; white-space:nowrap; flex-shrink:0;">${rankLabel}</span>
            </div>
            <div style="font-size:0.88rem; color:#ded1c1; line-height:1.4; margin-bottom:8px">${specDesc || ccT('CharCreate.specGenericDesc', 'Proficiency acquired through rigorous study and fieldwork.')}</div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccT('SpecMenu.ui.category', 'Category')}:</span><span class="cc-dossier-value">${catLabel}</span></div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccT('SpecMenu.ui.governingStat', 'Governing Attribute')}:</span><span class="cc-dossier-value">${ccStatLabel(hoveredSpec.stat || "INT")}</span></div>
            ${grantRank > 0 ? `<div class="cc-dossier-row"><span class="cc-dossier-label">${ccT('CharCreate.specGranted', 'Granted by Class and Traits')}:</span><span class="cc-dossier-value">${rankName(grantRank + 1)}</span></div>` : ''}
          </div>
        `;
      }

      // Trained Specs Badges using .cc-spec-badge-chip to avoid overlapping cards
      const trainedBadges = trainedEntries.map(([idStr, rank, grantRank]) => {
        const spec = catalog.find((s) => s.id === Number(idStr));
        const name = spec ? ((window.Specializations && window.Specializations.displayName) ? window.Specializations.displayName(spec) : spec.name) : `Spec #${idStr}`;
        return `
          <div class="cc-spec-badge-chip${grantRank >= rank ? ' granted' : ''}" onmouseenter="SceneManager._scene.onSpecCardHover(${idStr})">
            <span style="max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
            <span class="cc-spec-stat-badge" style="padding:0 4px;">${rankName(rank)}</span>
          </div>
        `;
      }).join("");

      return `
        <div class="cc-page cc-page-right cc-spec-detail ts-page" style="display: flex; flex-direction: column;">
          <div style="display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:6px; margin-bottom:8px">
            <button class="cc-profile-open-btn" onclick="SceneManager._scene.onSuggestSpecsForCurrentActor()">${ccT('CharCreate.suggestSpecs', 'Suggested')}</button>
            <button class="cc-profile-open-btn" onclick="SceneManager._scene.onResetSpecsForCurrentActor()">${ccT('CharCreate.resetSpecs', 'Reset')}</button>
            <button class="cc-profile-open-btn" onclick="SceneManager._scene.onRandomizeSpecsForCurrentActor()">${ccT('CharCreate.randomize', 'Randomize')}</button>
          </div>
          ${detailHtml}

          <h3 class="cc-subheader" style="margin-top:10px; margin-bottom:6px">
            <span>${ccT('CharCreate.allocatedTalents', 'Allocated Talents')} (${trainedEntries.length})</span>
          </h3>
          <div style="display:flex; flex-wrap:wrap; align-content:start; min-height:48px; margin-bottom:10px; gap:4px;">
            ${trainedBadges || `<span style="opacity:0.6; font-size:0.88rem; padding:6px;">${ccT('CharCreate.noTalentsSpent', 'No specialization points allocated yet.')}</span>`}
          </div>
        </div>
      `;
    }

    onSpecCategorySelect(category) {
      Scene_CharacterCreation._activeSpecCategory = category;
      SoundManager.playCursor();
      const container = this._dndContainer;
      if (!container) { this.refreshUIOverlayDOM(); return; }

      // The tabs are ".cc-spec-tab" and always have been; this looked for
      // ".cc-spec-tab-btn", found nothing, and so the highlight never left the
      // tab the board opened on however many times the player changed category.
      const tabBtns = container.querySelectorAll(".cc-spec-tab");
      const railFocused = !!this._pageRailFocused;
      tabBtns.forEach((btn) => {
        const isActive = btn.getAttribute("data-cat") === category;
        btn.classList.toggle("active", isActive);
        btn.classList.toggle("selected", isActive && railFocused);
      });

      this._refreshSpecGrid();
    }

    onSpecSearch(query) {
      Scene_CharacterCreation._specSearchQuery = query || "";
      // Only the grid is rewritten: rebuilding the board would take the search
      // field, and the caret in it, away between one keystroke and the next.
      this._refreshSpecGrid();
    }

    onSpecCardHover(specId) {
      Scene_CharacterCreation._hoveredSpecId = specId;
      const rightPage = this._dndContainer && this._dndContainer.querySelector(".cc-page-right");
      if (rightPage) {
        this._ccSwapPage(rightPage, this._specsPickerRightHtml());
      }
    }

    onSpecPointAdjust(specId, delta) {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      if (!actor._specTrained) actor._specTrained = {};

      const budget = CC_SPEC_BUDGET;
      const grantCtx = this._specGrantContext(actor);
      const spec = this._specsCatalog().find((sp) => String(sp.id) === String(specId));
      // The head start the class and the traits hand out is the floor: it was
      // never paid for, so it can never be sold back for a point elsewhere.
      const grantRank = this._specGrantRankIn(grantCtx, spec);
      const current = Math.max(actor._specTrained[specId] || 0, grantRank);
      let spent = budget - this._specsRemaining(actor);

      if (delta > 0) {
        if (spent >= budget || current >= 4) {
          SoundManager.playBuzzer();
          return;
        }
        actor._specTrained[specId] = current + 1;
        spent++;
        SoundManager.playOk();
      } else if (delta < 0) {
        if (current <= grantRank) {
          SoundManager.playBuzzer();
          return;
        }
        actor._specTrained[specId] = current - 1;
        spent--;
        SoundManager.playCancel();
      }

      actor._specPointsSpent = spent;
      const remaining = Math.max(0, budget - spent);

      // Fast in-place DOM update without blowing away the entire UI or resetting scroll
      const container = this._dndContainer;
      if (container) {
        // 1. Update budget text
        const budgetChip = container.querySelector(".ts-purse-chip");
        if (budgetChip) {
          budgetChip.innerHTML = T('CharCreate.budgetPoints', { remaining: remaining, total: budget });
        }

        // 2. Update the changed card's pips & minus button
        const newRank = Math.max(actor._specTrained[specId] || 0, grantRank);
        const card = container.querySelector(`.cc-spec-card[data-spec-id="${specId}"]`);
        if (card) {
          const minusBtn = card.querySelector(".cc-spec-btn-minus");
          if (minusBtn) minusBtn.disabled = (newRank <= grantRank);

          const pips = card.querySelectorAll(".cc-spec-pip");
          pips.forEach((pip, idx) => {
            pip.classList.toggle("active", idx < newRank);
            pip.classList.toggle("bonus", idx < grantRank);
          });
        }

        // 3. Update all cards' plus buttons based on remaining points and rank
        const catalogById = new Map(this._specsCatalog().map((sp) => [String(sp.id), sp]));
        const allCards = container.querySelectorAll(".cc-spec-card[data-spec-id]");
        allCards.forEach((c) => {
          const cId = c.getAttribute("data-spec-id");
          const cGrant = this._specGrantRankIn(grantCtx, catalogById.get(String(cId)));
          const cRank = Math.max(actor._specTrained[cId] || 0, cGrant);
          const plusBtn = c.querySelector(".cc-spec-btn-plus");
          if (plusBtn) {
            plusBtn.disabled = (remaining <= 0 || cRank >= 4);
          }
        });

        // 4. Update right page details and allocated talents list
        const rightPage = container.querySelector(".cc-page-right");
        if (rightPage) {
          this._ccSwapPage(rightPage, this._specsPickerRightHtml());
        }
        return;
      }

      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // The full spec board redraw every board-wide button (Randomize, Suggested,
    // Reset) ends on, once it has finished touching actor._specTrained.
    _redrawSpecBoard() {
      const contentPane = this._dndContainer && this._dndContainer.querySelector(".cc-content-pane");
      if (contentPane) {
        contentPane.innerHTML = `
          <div class="cc-pockets-spread">
            ${this._specsPickerLeftHtml()}
            ${this._specsPickerRightHtml()}
          </div>
        `;
        return;
      }
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // Spends `remaining` (a closure-shared counter local to the caller) into
    // fresh picks, cheapest bias toward small purchases so one big roll does
    // not empty the purse into a single specialization. Shared by Randomize
    // and by whatever budget Suggested leaves over.
    _randomSpendSpecs(actor, grantCtx, catalog, remaining) {
      let left = remaining;
      let attempts = 0;
      while (left > 0 && attempts < 400) {
        attempts++;
        const spec = catalog[Math.floor(Math.random() * catalog.length)];
        if (!spec) continue;
        const floor = this._specGrantRankIn(grantCtx, spec);
        const current = Math.max(actor._specTrained[spec.id] || 0, floor);
        if (current < 4) {
          const add = Math.min(left, 4 - current, Math.floor(Math.random() * 2) + 1);
          actor._specTrained[spec.id] = current + add;
          left -= add;
        }
      }
      return left;
    }

    onRandomizeSpecsForCurrentActor() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const catalog = this._specsCatalog();
      actor._specTrained = {};
      if (!Array.isArray(catalog) || catalog.length === 0) return;

      // Points are rolled on top of whatever the class and the traits already
      // gave, never underneath it.
      const grantCtx = this._specGrantContext(actor);
      this._randomSpendSpecs(actor, grantCtx, catalog, CC_SPEC_BUDGET);

      SoundManager.playOk();
      this._redrawSpecBoard();
    }

    // Clears every point the player spent, keeping only the free tiers the
    // class and traits grant: a clean refund back to a full purse, with
    // nothing else about the board reset.
    onResetSpecsForCurrentActor() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      actor._specTrained = {};
      SoundManager.playCancel();
      this._redrawSpecBoard();
    }

    // A one-click starting build for the class actually picked: every
    // specialization the class has a head start in (Specialization.json
    // classStart) gets maxed out, richest affinity first, before anything
    // else is touched. A class with fewer affinities than the budget affords
    // spends what is left over the same way Randomize does, so the purse is
    // never left holding points back.
    onSuggestSpecsForCurrentActor() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const catalog = this._specsCatalog();
      actor._specTrained = {};
      if (!Array.isArray(catalog) || catalog.length === 0) return;

      const grantCtx = this._specGrantContext(actor);
      const className = grantCtx.className;
      let remaining = CC_SPEC_BUDGET;

      const affinityOrder = catalog
        .filter((sp) => className && sp.classStart && sp.classStart[className])
        .sort((a, b) => (b.classStart[className] || 0) - (a.classStart[className] || 0));

      affinityOrder.forEach((spec) => {
        if (remaining <= 0) return;
        const floor = this._specGrantRankIn(grantCtx, spec);
        const current = Math.max(actor._specTrained[spec.id] || 0, floor);
        if (current >= 4) return;
        const add = Math.min(remaining, 4 - current);
        actor._specTrained[spec.id] = current + add;
        remaining -= add;
      });

      if (remaining > 0) {
        this._randomSpendSpecs(actor, grantCtx, catalog, remaining);
      }

      SoundManager.playOk();
      this._redrawSpecBoard();
    }

    // ── Macro BIO Step Helpers & Handlers ──
    _isBioPickerStep() {
      return this._step === STEP.BIO;
    }

    _formatIdeologyName(raw) {
      if (!raw) return this._formatIdeologyName("pragmatist");
      let key = typeof raw === "object" ? (raw.id || raw.key || raw.name) : raw;
      if (!key.startsWith("ideology.")) key = "ideology." + key;

      if (typeof T === "function") {
        try {
          const trans = T(key);
          if (trans && trans !== key && !trans.startsWith("ideology.")) return trans;
        } catch (e) {}
      }
      if (window.DataService && window.DataService.t) {
        try {
          const trans = window.DataService.t(key);
          if (trans && trans !== key && !trans.startsWith("ideology.")) return trans;
        } catch (e) {}
      }

      return String(key).split(".").pop().split(/[_\-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }

    // The organs this member is carrying right now. The variable is the store
    // (Health_BiologicSimulation reads the same one), CharacterCreationUtils
    // owns which variable that is.
    _currentReproductionType() {
      const memberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const CCU = window.CharacterCreationUtils;
      if (CCU && CCU.getReproductionType) return CCU.getReproductionType(memberIdx);
      return $gameVariables.value([87, 115, 116][memberIdx] || 87);
    }

    // Where this character's body sits on the endocrine scale: their own answer
    // if they have one, otherwise the default for the gender they carry.
    _currentHormoneBalance() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      const CCU = window.CharacterCreationUtils;
      if (CCU && CCU.hormoneBalanceOf) return CCU.hormoneBalanceOf(actor);
      const own = (actor && actor.hormoneBalance) ? actor.hormoneBalance() : null;
      return own === null || own === undefined ? 50 : own;
    }

    // What the slider is actually doing to the blood, named and numbered. The
    // ranges come from the system that will hold the hormones there
    // (window.HormoneBalance, Health_BiologicSimulation), so the panel never
    // promises a body the simulation would not build.
    _hormoneReadoutHtml(balance) {
      const lean = ccHormoneLean(balance);
      const HB = window.HormoneBalance;
      if (!HB || !HB.rangeFor) return `<b>${lean}</b>`;
      const test = HB.rangeFor("testosterone", balance);
      const est = HB.rangeFor("estrogen", balance);
      if (!test || !est) return `<b>${lean}</b>`;
      const numbers = ccTp('CharCreate.hormoneReadout', {
        tLow: Math.round(test.min), tHigh: Math.round(test.max),
        eLow: Math.round(est.min), eHigh: Math.round(est.max)
      }, `Testosterone ${Math.round(test.min)}-${Math.round(test.max)} ng/dL, estrogen ${Math.round(est.min)}-${Math.round(est.max)} pg/mL`);
      return `<b>${lean}</b> &middot; ${numbers}`;
    }

    // Humanoid / Creature / Preset used to sit in the sidebar on every step;
    // it now opens straight into the Bio tab, so it leads that tab the same
    // way it used to lead the sidebar.
    _renderTypePillsHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return "";
      const isPreset = !!this._presetWindow;
      const isPresetActor = !!(actor._isPresetActor);
      const hasAnotherPreset = this._hasPresetInParty(true);
      const isPresetDisabled = hasAnotherPreset && !isPresetActor;
      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isCreature = !isPresetActor && !isPreset && !!(actor._isCreatureActor || $gameSwitches.value(77 + currentMemberIndex));
      return `
        <div class="cc-compact-type-pills" style="margin-bottom:10px;">
          <div class="cc-compact-type-pill ${!isCreature && !isPresetActor && !isPreset ? 'active' : ''}" onclick="SceneManager._scene.onSetCharacterType('humanoid')">
            ${ccT('CharCreate.humanoid', 'Humanoid')}
          </div>
          <div class="cc-compact-type-pill ${isCreature && !isPresetActor && !isPreset ? 'active' : ''}" onclick="SceneManager._scene.onSetCharacterType('creature')">
            ${ccT('CharCreate.creature', 'Creature')}
          </div>
          <div class="cc-compact-type-pill ${(isPresetActor || isPreset) ? 'active' : ''} ${isPresetDisabled ? 'disabled' : ''}"
               style="${isPresetDisabled ? 'opacity:0.35; cursor:not-allowed;' : ''}"
               title="${isPresetDisabled ? ccT('CharCreate.onlyOnePreset', 'Only 1 preset character allowed in the party') : ccT('CharCreate.presetDossiers', 'Preset Dossiers')}"
               onclick="${isPresetDisabled ? 'SoundManager.playBuzzer()' : "SceneManager._scene.onSetCharacterType('preset')"}">
            ${ccT('CharCreate.preset', 'Preset')}
          </div>
        </div>
      `;
    }

    // The body a creature is spliced from. Both selects funnel through
    // applyArchetypesToActor (see onSelectCreatureArchetype /
    // onSelectCreatureSecondaryArchetype), which settles the 3D config from
    // the full canonical pair every time: changing the primary rebuilds the
    // model as the new kind, changing the secondary re-grafts its parts onto
    // it. Neither call is special-cased here, they already share the one path.
    _creatureArchetypeBioHtml(actor) {
      const currentArch = actorArchetypeKey(actor) || "Goblin";
      const secondArch = actorSecondaryArchetypeKey(actor) || "";
      // Neither list offers what the other one holds: the two halves of a
      // spliced body are always two different archetypes.
      const archetypeOptions = (selected, taken) => creatureArchetypeKeys()
        .filter((opt) => opt !== taken)
        .map((opt) => `<option value="${opt}" ${opt === selected ? 'selected' : ''}>${archetypeDisplayName(opt)}</option>`)
        .join("");
      const primaryOptionsHtml = archetypeOptions(currentArch, secondArch);
      const secondaryOptionsHtml = `<option value="" ${secondArch ? '' : 'selected'}>${ccT('CharCreate.none', 'None')}</option>` +
        archetypeOptions(secondArch, currentArch);
      return `
        <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
          <div class="cc-bio-section-title">${this._ccIconHtml(224, 16)} <span>${ccT('CharCreate.primaryArchetype', 'Primary Archetype')}</span></div>
          <select class="cc-bio-select" onchange="SceneManager._scene.onSelectCreatureArchetype(this.value)">
            ${primaryOptionsHtml}
          </select>
          <div class="cc-bio-section-title" style="margin-top:10px;">${this._ccIconHtml(224, 16)} <span>${ccT('CharCreate.secondaryArchetype', 'Secondary Archetype')}</span></div>
          <select class="cc-bio-select" onchange="SceneManager._scene.onSelectCreatureSecondaryArchetype(this.value)">
            ${secondaryOptionsHtml}
          </select>
        </div>
      `;
    }

    _bioPickerLeftHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return `<div class="cc-page cc-page-left"></div>`;

      const typePillsHtml = this._renderTypePillsHtml();
      const memberIdxForType = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isCreatureActor = !!(actor._isCreatureActor || $gameSwitches.value(77 + memberIdxForType));
      const archetypeBioHtml = isCreatureActor ? this._creatureArchetypeBioHtml(actor) : "";

      // Gender picker
      const genders = [
        { val: 0, label: ccT('CharCreate.bio.gender.male', "Male ♂") },
        { val: 1, label: ccT('CharCreate.bio.gender.female', "Female ♀") },
        { val: 2, label: ccT('CharCreate.bio.gender.nonBinary', "Non binary ⚦") },
        { val: 3, label: ccT('CharCreate.bio.gender.cocoon', "Cocoon ⯐") }
      ];
      const currentMemberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const currentGender = $gameVariables.value(38 + currentMemberIdx);
      const genderChipsHtml = genders.map((g) => {
        const isSelected = currentGender === g.val;
        return `<button class="cc-bio-chip ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onSetActorGender(${g.val})">${g.label}</button>`;
      }).join("");

      // Reproductive organs: the gender pick writes a default in here, and this
      // is where the player overrides it.
      const currentRepro = this._currentReproductionType();
      const reproChipsHtml = ccReproChoices().map((r) => {
        const isSelected = currentRepro === r.val;
        return `<button class="cc-bio-chip ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onBioOptionChange('reproduction', ${r.val})">${r.label}</button>`;
      }).join("");

      // And the endocrine balance the body runs at.
      const hormoneBalance = this._currentHormoneBalance();

      // Ideologies
      const allIdeologies = (window.NPCShared && window.NPCShared.ideologyList && window.NPCShared.ideologyList()) || [];
      const currentIdeology = actor._ideologyId || "pragmatist";

      // A handful of creeds used to sit above the list as chips, which said that
      // those seven were the ones worth having. Every creed is in the list (and
      // on the graph beside it), so the list is the only way one is picked. The
      // fallback is still needed for the case where no ideology bank loaded.
      const coreQuickPicks = [
        { id: "techno_monism" },
        { id: "transhumanism" },
        { id: "cyber_anarchism" },
        { id: "democratic_socialist" },
        { id: "high_frequency_trader" },
        { id: "neo_feudalism" },
        { id: "pragmatist" },
      ];

      // Full dropdown options with clean translated names
      const ideologyOptionsHtml = (allIdeologies.length > 0 ? allIdeologies : coreQuickPicks).map((item) => {
        const id = item.id || item;
        const displayName = this._formatIdeologyName(item);
        const isSelected = currentIdeology === id;
        return `<option value="${id}" ${isSelected ? 'selected' : ''}>${displayName}</option>`;
      }).join("");

      // Morality Alignments
      const alignments = [
        { val: 2, label: ccT('CharCreate.bio.morality.saintly', "Saintly (+2)") },
        { val: 1, label: ccT('CharCreate.bio.morality.principled', "Principled (+1)") },
        { val: 0, label: ccT('CharCreate.bio.morality.pragmatic', "Pragmatic (0)") },
        { val: -1, label: ccT('CharCreate.bio.morality.ruthless', "Ruthless (-1)") },
        { val: -2, label: ccT('CharCreate.bio.morality.vile', "Vile (-2)") },
      ];
      const currentMorality = actor._morality != null ? actor._morality : 0;
      const moralityChips = alignments.map((a) => {
        const isSelected = currentMorality === a.val;
        return `<button class="cc-bio-chip ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onBioOptionChange('morality', ${a.val})">${a.label}</button>`;
      }).join("");

      // Hometowns
      const hometowns = (window.WorkSystem && window.WorkSystem.Destinations)
        ? Object.keys(window.WorkSystem.Destinations)
        : ["Paris", "Tokyo", "Neo-Cairo", "Brussels", "Berlin", "London", "Rome", "New York", "Geneva", "Athens"];
      const currentHometown = $gameSystem._ccHometown || "Paris";
      const hometownOptions = hometowns.map((city) => `<option value="${city}" ${city === currentHometown ? 'selected' : ''}>${city}</option>`).join("");

      // Age Bands
      const ageBands = [
        { key: "age_young", label: ccT('CharCreate.bio.age.young', "Young (18-25)"), age: 22 },
        { key: "age_adult", label: ccT('CharCreate.bio.age.adult', "Adult (26-40)"), age: 32 },
        { key: "age_middle", label: ccT('CharCreate.bio.age.middle', "Middle-Aged (41-60)"), age: 48 },
        { key: "age_elder", label: ccT('CharCreate.bio.age.elder', "Elder (61+)"), age: 68 },
      ];
      const memberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const currentAge = ($gameSystem._ccBirthAge && $gameSystem._ccBirthAge[memberIdx]) || 28;
      const ageChips = ageBands.map((band) => {
        const isSelected = Math.abs(currentAge - band.age) < 10;
        return `<button class="cc-bio-chip ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onBioOptionChange('age', ${band.age})">${band.label}</button>`;
      }).join("");

      // Wealth Tiers
      const wealthTiers = [
        { tier: 0, label: ccT('CharCreate.bio.wealth.destitute', "Destitute") },
        { tier: 1, label: ccT('CharCreate.bio.wealth.working', "Working Class") },
        { tier: 2, label: ccT('CharCreate.bio.wealth.middle', "Middle Class") },
        { tier: 3, label: ccT('CharCreate.bio.wealth.wealthy', "Wealthy") },
      ];
      const currentWealth = actor._wealthTier != null ? actor._wealthTier : 2;
      const wealthChips = wealthTiers.map((w) => {
        const isSelected = currentWealth === w.tier;
        return `<button class="cc-bio-chip ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onBioOptionChange('wealth', ${w.tier})">${w.label}</button>`;
      }).join("");

      // Blood Types from BloodTypeService or comprehensive list
      const bloodList = (window.BloodTypeService && window.BloodTypeService.list && window.BloodTypeService.list()) || [
        { id: "O_POS", type: "O+", rarityKey: "common", category: "standard" },
        { id: "A_POS", type: "A+", rarityKey: "common", category: "standard" },
        { id: "B_POS", type: "B+", rarityKey: "common", category: "standard" },
        { id: "AB_POS", type: "AB+", rarityKey: "uncommon", category: "standard" },
        { id: "O_NEG", type: "O-", rarityKey: "uncommon", category: "standard" },
        { id: "A_NEG", type: "A-", rarityKey: "uncommon", category: "standard" },
        { id: "B_NEG", type: "B-", rarityKey: "rare", category: "standard" },
        { id: "AB_NEG", type: "AB-", rarityKey: "rare", category: "standard" },
        { id: "SYNTH_DELTA", type: "Synthetic-Δ", rarityKey: "rare", category: "synthetic" },
        { id: "SYNTH_PSI", type: "Synthetic-Ψ", rarityKey: "veryRare", category: "synthetic" },
        { id: "AZURE_HEMOCYANIN", type: "Azure (Hemocyanin)", rarityKey: "veryRare", category: "exotic" },
        { id: "CHLOROCRUORIN", type: "Chlorocruorin (Green)", rarityKey: "veryRare", category: "exotic" },
        { id: "RH_NULL", type: "Rh-null", rarityKey: "ultraRare", category: "rare_human" },
        { id: "BOMBAY_HH", type: "Bombay (hh)", rarityKey: "ultraRare", category: "rare_human" },
        { id: "DUFFY_NEG", type: "Duffy-", rarityKey: "veryRare", category: "rare_human" },
        { id: "DIEGO_B_NEG", type: "Diego(b-)", rarityKey: "veryRare", category: "rare_human" },
        { id: "KIDD_B_NEG", type: "Kidd(b-)", rarityKey: "veryRare", category: "rare_human" },
        { id: "COLTON_NEG", type: "Colton(a-)", rarityKey: "veryRare", category: "rare_human" },
        { id: "LUTHERAN_NEG", type: "Lutheran(a-b-)", rarityKey: "veryRare", category: "rare_human" }
      ];

      const currentBloodId = actor._ccBloodType || actor._bloodType || "O_POS";
      const currentBloodEntry = bloodList.find(b => b.id === currentBloodId || b.type === currentBloodId) || bloodList[0];

      // Transfusion party compatibility
      const compat = (window.BloodTypeService && window.BloodTypeService.checkPartyCompatibility)
        ? window.BloodTypeService.checkPartyCompatibility(actor, currentBloodEntry.id)
        : { canDonateTo: [], canReceiveFrom: [] };

      const otherMembersCount = ($gameParty && $gameParty.members)
        ? $gameParty.members().filter(m => m && (typeof m.actorId === 'function' ? m.actorId() : m._actorId) !== (typeof actor.actorId === 'function' ? actor.actorId() : actor._actorId)).length
        : 0;

      let compatHtml = "";
      if (otherMembersCount > 0) {
        compatHtml = `
          <div style="margin-top:6px; padding:6px 10px; background:rgba(0,0,0,0.3); border:1px solid rgba(218,165,32,0.22); border-radius:4px; font-size:0.83rem;">
            <div style="font-weight:bold; color:#ffd700; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
              <span>${ccT('CharCreate.bio.compatTitle', "Party Transfusion Compatibility")}</span>
              <span style="font-size:0.78rem; color:#ded1c1; opacity:0.85;">${ccT('CharCreate.bio.compatSelected', "Selected")}: <b>${currentBloodEntry.type}</b></span>
            </div>
            <div style="display:flex; flex-direction:column; gap:3px;">
              <div style="color:#a5d6a7; display:flex; align-items:center; gap:6px;">
                <span style="color:#81c784; font-weight:bold;">↳ ${ccT('CharCreate.bio.canDonate', "Can donate to:")}</span>
                <span>${compat.canDonateTo.length > 0 ? compat.canDonateTo.map(m => `<b>${m.name}</b> (${m.type})`).join(", ") : `<span style="color:#ef9a9a; font-style:italic;">${ccT('CharCreate.bio.noDonor', "None (Incompatible donor)")}</span>`}</span>
              </div>
              <div style="color:#90caf9; display:flex; align-items:center; gap:6px;">
                <span style="color:#64b5f6; font-weight:bold;">↳ ${ccT('CharCreate.bio.canReceive', "Can receive from:")}</span>
                <span>${compat.canReceiveFrom.length > 0 ? compat.canReceiveFrom.map(m => `<b>${m.name}</b> (${m.type})`).join(", ") : `<span style="color:#ef9a9a; font-style:italic;">${ccT('CharCreate.bio.noRecipient', "None (Requires matched donor)")}</span>`}</span>
              </div>
            </div>
          </div>
        `;
      } else {
        // One line per blood id worth remarking on, and one catch-all for any
        // other antigen-null profile. The wording is i18n's (CharCreate.bio.
        // bloodTrait), keyed by the same id BloodTypeService hands out.
        const BLOOD_TRAIT_IDS = ["O_NEG", "AB_POS", "SYNTH_DELTA", "AZURE_HEMOCYANIN", "RH_NULL", "BOMBAY_HH"];
        const traitKey = BLOOD_TRAIT_IDS.includes(currentBloodEntry.id)
          ? currentBloodEntry.id
          : (currentBloodEntry.rareAntigen ? "RARE_ANTIGEN" : null);
        const specialTrait = traitKey ? ccT('CharCreate.bio.bloodTrait.' + traitKey, "") : "";
        if (specialTrait) {
          compatHtml = `
            <div style="margin-top:6px; padding:5px 8px; background:rgba(0,0,0,0.25); border:1px solid rgba(218,165,32,0.18); border-radius:4px; font-size:0.8rem; color:#e0d5c1;">
              <span style="color:#ffd700; font-weight:bold;">${ccT('CharCreate.bio.traitLabel', "Trait:")}</span> ${specialTrait}
            </div>
          `;
        }
      }

      const standardBloods = bloodList.filter(b => b.category === "standard");
      const specialBloods = bloodList.filter(b => b.category !== "standard");

      const renderChips = (list) => list.map((bt) => {
        const isSelected = currentBloodEntry.id === bt.id || currentBloodId === bt.type;
        return `<button class="cc-bio-chip ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onBioOptionChange('blood', '${bt.id}')" title="${bt.type} (${bt.rarityKey})">${bt.type}</button>`;
      }).join("");

      // Jobs / Occupations from Jobs.json (0 = Jobless)
      const allJobs = (window.WorkSystem && window.WorkSystem.Jobs) || [];
      const currentJobId = actor._jobId != null ? actor._jobId : 0;
      const currentJob = currentJobId > 0 ? (allJobs.find(j => j.id === currentJobId) || null) : null;
      const currentJobName = currentJob ? (window.WorkSystem && window.WorkSystem.jobName ? window.WorkSystem.jobName(currentJob) : (currentJob.name || `Job #${currentJob.id}`)) : ccT('CharCreate.bio.jobless', "Jobless / Unemployed");

      const joblessOptionHtml = `<option value="0" ${currentJobId === 0 ? 'selected' : ''}>-- ${ccT('CharCreate.bio.joblessOption', "Jobless / No occupation")} --</option>`;
      const jobOptionsHtml = joblessOptionHtml + allJobs.map((j) => {
        const jName = window.WorkSystem && window.WorkSystem.jobName ? window.WorkSystem.jobName(j) : (j.name || `Job #${j.id}`);
        const isSelected = currentJob && currentJob.id === j.id;
        return `<option value="${j.id}" ${isSelected ? 'selected' : ''}>${jName} (${j.category} - ${j.spec})</option>`;
      }).join("");

      let jobItemsBadges = "";
      if (currentJob && Array.isArray(currentJob.items) && currentJob.items.length > 0) {
        jobItemsBadges = currentJob.items.map((itemId) => {
          const item = (typeof $dataItems !== 'undefined' && $dataItems[itemId]) ? $dataItems[itemId] : null;
          const itemName = item ? item.name : `Item #${itemId}`;
          const iconIndex = item ? item.iconIndex : 160;
          return `
            <span class="cc-element-badge" style="padding:2px 7px; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px; text-transform:none;">
              ${this._ccIconHtml(iconIndex, 14)} <span>${itemName}</span>
            </span>
          `;
        }).join(" ");
      }

      return `
        <div class="cc-page cc-page-left ts-page" style="display:flex; flex-direction:column;">
          <div class="cc-bio-container" style="flex:1; min-height:0; overflow-y:auto; padding-right:6px; padding-bottom:24px;">
            ${typePillsHtml}
            ${archetypeBioHtml}
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(246, 16)} <span>${ccT('CharCreate.identityProfile', "Gender & Presentation")}</span></div>
              <div class="cc-bio-chips-row">${genderChipsHtml}</div>
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(267, 16)} <span>${ccT('CharCreate.reproductiveOrgans', "Reproductive Organs")}</span></div>
              <div class="cc-bio-chips-row">${reproChipsHtml}</div>
              <div class="cc-bio-section-title" style="margin-top:10px;">${this._ccIconHtml(179, 16)} <span>${ccT('CharCreate.hormoneBalance', "Endocrine Balance")}</span></div>
              <div class="cc-bio-slider-row">
                <span class="cc-bio-slider-end">${ccT('CharCreate.hormoneOestrogenic', "Oestrogenic")}</span>
                <input id="cc-hormone-slider" class="cc-bio-slider" type="range" min="0" max="100" step="1" value="${hormoneBalance}"
                  oninput="SceneManager._scene.onHormoneSliderPreview(this.value)"
                  onchange="SceneManager._scene.onBioOptionChange('hormones', this.value)">
                <span class="cc-bio-slider-end">${ccT('CharCreate.hormoneAndrogenic', "Androgenic")}</span>
              </div>
              <div id="cc-hormone-readout" class="cc-bio-slider-readout">${this._hormoneReadoutHtml(hormoneBalance)}</div>
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(193, 16)} <span>${ccT('CharCreate.professionJob', "Profession / Starting Occupation")}</span></div>
              <select class="cc-bio-select" onchange="SceneManager._scene.onBioOptionChange('job', this.value)">
                ${jobOptionsHtml}
              </select>
              ${jobItemsBadges ? `
                <div style="margin-top:6px; display:flex; flex-direction:column; gap:3px;">
                  <div style="font-size:0.75rem; color:#a89f91;">${ccT('CharCreate.bio.jobGear', "Starting job gear & tools granted:")}</div>
                  <div style="display:flex; flex-wrap:wrap; gap:4px;">${jobItemsBadges}</div>
                </div>
              ` : (currentJobId === 0 ? `
                <div style="font-size:0.75rem; color:#a89f91; font-style:italic; margin-top:4px;">
                  ${ccT('CharCreate.bio.noJobGear', "No initial professional equipment or work tools provided.")}
                </div>
              ` : '')}
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(183, 16)} <span>${ccT('CharCreate.creedIdeology', "Creed & Philosophical Ideology")}</span></div>
              <div style="display:flex; gap:6px; align-items:center;">
                <select id="cc-ideology-select" class="cc-bio-select" style="flex:1;" onchange="SceneManager._scene.onBioOptionChange('ideology', this.value)">
                  ${ideologyOptionsHtml}
                </select>
                <button type="button" class="cc-bio-chip" onclick="if(window.PoliticalGraph3D && SceneManager._scene){ SceneManager._scene.markReturnStep(); SceneManager._scene.closeStepUI(); window.PoliticalGraph3D.openModal({ focusId: (document.getElementById('cc-ideology-select') ? document.getElementById('cc-ideology-select').value : ''), onSelect: function(id) { Scene_CharacterCreation.applyIdeologySelection(id); } }); }" title="${ccT('CharCreate.openPoliticalGraph', 'Open the political graph')}">${ccT('CharCreate.politicalGraph', 'Graph')}</button>
              </div>
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(190, 16)} <span>${ccT('CharCreate.originCity', "Hometown / Settlement of Origin")}</span></div>
              <select class="cc-bio-select" onchange="SceneManager._scene.onBioOptionChange('hometown', this.value)">${hometownOptions}</select>
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(246, 16)} <span>${ccT('CharCreate.moralityAlignment', "Moral Disposition & Alignment")}</span></div>
              <div class="cc-bio-chips-row">${moralityChips}</div>
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(113, 16)} <span>${ccT('CharCreate.ageBand', "Age Generation")}</span></div>
              <div class="cc-bio-chips-row">${ageChips}</div>
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; border-bottom:1px solid rgba(218,165,32,0.12) !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(208, 16)} <span>${ccT('CharCreate.socialStanding', "Social Standing & Background")}</span></div>
              <div class="cc-bio-chips-row">${wealthChips}</div>
            </div>
            <div class="cc-bio-section" style="background:transparent !important; border:none !important; box-shadow:none !important; padding:6px 0 10px 0;">
              <div class="cc-bio-section-title">${this._ccIconHtml(176, 16)} <span>${ccT('CharCreate.bloodType', "Serology / Blood Type")}</span></div>
              <div style="font-size:0.75rem; color:#a89f91; margin-bottom:4px;">${ccT('CharCreate.bio.bloodStandard', "Standard ABO / Rh")}</div>
              <div class="cc-bio-chips-row" style="margin-bottom:6px;">${renderChips(standardBloods)}</div>
              <div style="font-size:0.75rem; color:#a89f91; margin-bottom:4px;">${ccT('CharCreate.bio.bloodExotic', "Synthetic, Rare & Exotic")}</div>
              <div class="cc-bio-chips-row">${renderChips(specialBloods)}</div>
              ${compatHtml}
            </div>
          </div>
        </div>
      `;
    }

    _bioPickerRightHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return `<div class="cc-page cc-page-right"></div>`;

      const memberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const hometown = $gameSystem._ccHometown || "Paris";
      const age = ($gameSystem._ccBirthAge && $gameSystem._ccBirthAge[memberIdx]) || 28;
      const ideologyNameFormatted = this._formatIdeologyName(actor._ideologyId || "pragmatist");
      
      const bloodList = (window.BloodTypeService && window.BloodTypeService.list && window.BloodTypeService.list()) || [];
      const currentBloodId = actor._ccBloodType || actor._bloodType || "O_POS";
      const currentBloodEntry = bloodList.find(b => b.id === currentBloodId || b.type === currentBloodId);
      const bloodLabel = currentBloodEntry ? currentBloodEntry.type : (actor._bloodType || "O+");

      // The prose forms of the two, which are not the chip captions: a chip
      // reads "Middle Class", the sentence reads "a middle class upbringing".
      const WEALTH_ADJ = ["destitute", "working", "middle", "wealthy"];
      const wealthAdjKey = WEALTH_ADJ[actor._wealthTier != null ? actor._wealthTier : 2] || "middle";
      const wealthLabel = ccT('CharCreate.bio.wealthAdj.' + wealthAdjKey, wealthAdjKey);

      const MORALITY_ADJ = { 2: "saintly", 1: "principled", 0: "pragmatic", "-1": "ruthless", "-2": "vile" };
      const moralityAdjKey = MORALITY_ADJ[actor._morality != null ? actor._morality : 0] || "pragmatic";
      const moralityDesc = ccT('CharCreate.bio.moralityAdj.' + moralityAdjKey, moralityAdjKey);

      let avatarStyle = "";
      if (actor.characterName()) {
        avatarStyle = this.getSpriteStyle(actor.characterName(), actor.characterIndex());
      }
      const classData = $dataClasses[actor._classId];
      const className = classData ? window.CCDbName(classData) : ccT('CharCreate.defaultClassName', 'Operative');

      // Two paragraphs written from what the picker on the left holds. Each
      // language phrases them its own way, so the whole sentence is the i18n
      // entry and the fields are dropped into it as parameters.
      const storyParams = {
        hometown, name: actor.name(), ideology: ideologyNameFormatted,
        morality: moralityDesc, wealth: wealthLabel, age, blood: bloodLabel
      };
      const storyHtml = `
        <p class="cc-text-desc" style="text-align:left; font-size:1.05rem; line-height:1.65; color:#f0e6d2; margin-bottom:10px;">
          ${ccTp('CharCreate.bio.storyPara1', storyParams, '')}
        </p>
        <p class="cc-text-desc" style="text-align:left; font-size:1.05rem; line-height:1.65; color:#ded1c1; margin-bottom:12px;">
          ${ccTp('CharCreate.bio.storyPara2', storyParams, '')}
        </p>
      `;

      return `
        <div class="cc-page cc-page-right ts-page" style="display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:8px;">
            <button class="cc-profile-open-btn" onclick="SceneManager._scene.onRandomizeBioForCurrentActor()">${ccT('CharCreate.randomize', 'Randomize')}</button>
          </div>

          <div class="cc-dossier-card" style="flex:1; min-height:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:12px;">
            <div class="cc-bio-identity">
              <span class="cc-compact-avatar" style="${avatarStyle}; width: 28px; height: 28px;"></span>
              <span class="cc-bio-identity-name">${actor.name()}</span>
              <span class="cc-bio-identity-class">(${className})</span>
            </div>

            <h3 class="cc-subheader" style="font-size:1.35rem; margin-top:2px; margin-bottom:4px; border-bottom:1px solid rgba(218,165,32,0.25); padding-bottom:4px;">
              ${ccT('CharCreate.narrativeHistory', 'Backstory & Life Record')}
            </h3>
            ${storyHtml}

          </div>
        </div>
      `;
    }

    onSetActorGender(genderVal) {
      const memberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      $gameVariables.setValue(38 + memberIdx, genderVal);
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (actor) {
        actor._gender = genderVal;
        if (actor.setGender) actor.setGender(genderVal);
      }
      // Male and female default the organ selector to testes and a uterus,
      // which is the body those words usually come with. Non-binary and cocoon
      // name no body at all, so `keepOrgans` leaves whatever is selected
      // exactly as it is, and so does the slider below.
      const CCU = window.CharacterCreationUtils;
      if (CCU && CCU.applyGenderAndReproduction) {
        CCU.applyGenderAndReproduction(memberIdx, genderVal, { keepOrgans: true });
      }
      // The endocrine slider follows the same rule with one more of its own: a
      // balance the player has already moved is theirs, and picking a gender
      // afterwards does not drag it back. Only a body nobody has tuned takes
      // the default (hormoneBalance() answers null until somebody says).
      const untouched = !actor || !actor.hormoneBalance || actor.hormoneBalance() === null;
      if (actor && actor.setHormoneBalance && untouched && (genderVal === 0 || genderVal === 1) &&
          CCU && CCU.defaultHormoneBalance) {
        actor.setHormoneBalance(CCU.defaultHormoneBalance(genderVal));
      }
      SoundManager.playCursor();
      const container = this._dndContainer;
      if (container) {
        const leftPage = container.querySelector(".cc-page-left");
        this._ccSwapPage(leftPage, this._bioPickerLeftHtml());
        const rightPage = container.querySelector(".cc-page-right");
        this._ccSwapPage(rightPage, this._bioPickerRightHtml());
        const sidebar = container.querySelector(".cc-compact-sidebar");
        if (sidebar) sidebar.outerHTML = this._renderCompactSidebarHtml();
        return;
      }
      this.refreshUIOverlayDOM();
    }

    onBioOptionChange(field, value) {
      if (this._refusePresetEdit()) return;
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const memberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      actor._bioSet = true;

      if (field === "job") {
        const jobId = Number(value) || 0;
        actor._jobId = jobId;
        if (actor._grantedJobItemIds && $gameParty) {
          actor._grantedJobItemIds.forEach(id => {
            if (typeof $dataItems !== 'undefined' && $dataItems[id]) {
              if (typeof $gameParty.loseItem === 'function') {
                $gameParty.loseItem($dataItems[id], 1);
              } else if (typeof $gameParty.gainItem === 'function') {
                $gameParty.gainItem($dataItems[id], -1);
              }
            }
          });
          actor._grantedJobItemIds = [];
        }
        if (jobId > 0) {
          const allJobs = (window.WorkSystem && window.WorkSystem.Jobs) || [];
          const jobData = allJobs.find(j => j.id === jobId);
          if (jobData && Array.isArray(jobData.items)) {
            actor._grantedJobItemIds = [...jobData.items];
            if ($gameParty) {
              jobData.items.forEach(id => {
                if (typeof $dataItems !== 'undefined' && $dataItems[id]) {
                  $gameParty.gainItem($dataItems[id], 1);
                }
              });
            }
          }
        }
      } else if (field === "ideology") {
        actor._ideologyId = value;
        if (window.NPCSociety && window.NPCSociety.getActorProfile) {
          const prof = window.NPCSociety.getActorProfile(actor.actorId());
          if (prof) prof.ideologyId = value;
        }
      } else if (field === "morality") {
        actor._morality = Number(value);
      } else if (field === "hometown") {
        $gameSystem._ccHometown = value;
      } else if (field === "age") {
        if (!$gameSystem._ccBirthAge) $gameSystem._ccBirthAge = [];
        $gameSystem._ccBirthAge[memberIdx] = Number(value);
      } else if (field === "wealth") {
        actor._wealthTier = Number(value);
      } else if (field === "blood") {
        actor._ccBloodType = value;
        actor._bloodType = value;
        if (window.BloodTypeService && window.BloodTypeService.setForActor) {
          window.BloodTypeService.setForActor(actor, value);
        }
      } else if (field === "reproduction") {
        // The player's own answer, which outranks whatever the gender pick
        // defaulted into the selector.
        const CCU = window.CharacterCreationUtils;
        if (CCU && CCU.setReproductionType) CCU.setReproductionType(memberIdx, Number(value));
        else $gameVariables.setValue([87, 115, 116][memberIdx] || 87, Number(value));
      } else if (field === "hormones") {
        // Written on the actor, where Health_BiologicSimulation reads it to
        // build (and then hold) the blood. Saying it at all is what makes it
        // theirs: an untouched body answers null and keeps taking its gender's
        // default, here and in the simulation both.
        if (actor.setHormoneBalance) actor.setHormoneBalance(Number(value));
      }

      SoundManager.playOk();
      const container = this._dndContainer;
      if (container) {
        const leftPage = container.querySelector(".cc-page-left");
        this._ccSwapPage(leftPage, this._bioPickerLeftHtml());
        const rightPage = container.querySelector(".cc-page-right");
        this._ccSwapPage(rightPage, this._bioPickerRightHtml());
        return;
      }
      this.refreshUIOverlayDOM();
    }

    // Live feedback while the handle is being dragged. A full re-render on
    // every input event would rebuild the input mid-drag and drop it, so this
    // writes the value and repaints the one line that reports it; the release
    // (onchange) then goes through onBioOptionChange like every other control.
    onHormoneSliderPreview(value) {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor || !actor.setHormoneBalance) return;
      const balance = Math.max(0, Math.min(100, Number(value) || 0));
      actor.setHormoneBalance(balance);
      const readout = document.getElementById("cc-hormone-readout");
      if (readout) readout.innerHTML = this._hormoneReadoutHtml(balance);
    }

    onRandomizeBioForCurrentActor() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return;
      const memberIdx = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      actor._bioSet = true;

      const allJobs = (window.WorkSystem && window.WorkSystem.Jobs) || [];
      if (allJobs.length > 0) {
        const randomJob = allJobs[Math.floor(Math.random() * allJobs.length)];
        this.onBioOptionChange("job", randomJob.id);
      }

      const ideologies = ["techno_monism", "neo_feudalism", "cyber_anarchism", "transhumanism", "econ_dominion", "pragmatist", "democratic_socialist", "high_frequency_trader"];
      actor._ideologyId = ideologies[Math.floor(Math.random() * ideologies.length)];
      if (window.NPCSociety && window.NPCSociety.getActorProfile) {
        const prof = window.NPCSociety.getActorProfile(actor.actorId());
        if (prof) prof.ideologyId = actor._ideologyId;
      }

      actor._morality = Math.floor(Math.random() * 5) - 2;

      const hometowns = ["Paris", "Tokyo", "Neo-Cairo", "Brussels", "Berlin", "London", "Rome", "New York", "Geneva", "Athens"];
      $gameSystem._ccHometown = hometowns[Math.floor(Math.random() * hometowns.length)];

      if (!$gameSystem._ccBirthAge) $gameSystem._ccBirthAge = [];
      $gameSystem._ccBirthAge[memberIdx] = 18 + Math.floor(Math.random() * 52);

      actor._wealthTier = Math.floor(Math.random() * 4);

      // A body as well as a life: any of the six organ sets, and a balance
      // anywhere on the scale rather than one of the two defaults.
      const reproChoices = ccReproChoices();
      this.onBioOptionChange("reproduction", reproChoices[Math.floor(Math.random() * reproChoices.length)].val);
      if (actor.setHormoneBalance) actor.setHormoneBalance(Math.floor(Math.random() * 101));

      const bloodList = (window.BloodTypeService && window.BloodTypeService.list && window.BloodTypeService.list()) || [];
      if (bloodList.length > 0) {
        const picked = bloodList[Math.floor(Math.random() * bloodList.length)];
        actor._ccBloodType = picked.id;
        actor._bloodType = picked.type || picked.id;
        if (window.BloodTypeService && window.BloodTypeService.setForActor) {
          window.BloodTypeService.setForActor(actor, picked.id);
        }
      } else {
        const bloodTypes = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "Synthetic-Δ", "Azure (Hemocyanin)"];
        actor._bloodType = bloodTypes[Math.floor(Math.random() * bloodTypes.length)];
      }

      SoundManager.playOk();
      const container = this._dndContainer;
      if (container) {
        const leftPage = container.querySelector(".cc-page-left");
        this._ccSwapPage(leftPage, this._bioPickerLeftHtml());
        const rightPage = container.querySelector(".cc-page-right");
        this._ccSwapPage(rightPage, this._bioPickerRightHtml());
        const sidebar = container.querySelector(".cc-compact-sidebar");
        if (sidebar) sidebar.outerHTML = this._renderCompactSidebarHtml();
        return;
      }
      this.refreshUIOverlayDOM();
    }

    // ── Pet / Follower Companion Selection Screen ──
    _petCatalog() {
      if (this._cachedPetCatalog && this._cachedPetCatalog.length > 0) {
        return this._cachedPetCatalog;
      }

      const catalog = [];
      const npcDb = (window.WorldGen && window.WorldGen.NPCs) || {};

      const formatName = (raw) => {
        return raw
          .replace(/^.*[\/\\]/, '')
          .replace(/^[\$!]+/, '')
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
          .trim();
      };

      const classifyKind = (entry, name) => {
        if (entry && entry.animal) return "Animal";
        if (entry && entry.creature) return "Creature";
        if (entry && entry.zombie) return "Undead";
        const lower = name.toLowerCase();
        if (/dog|cat|wolf|bear|falcon|crow|pig|cow|deer|fox|bat|rabbit|mole|goat|hyena|lion|tiger|horse|eagle|fish|whale|turtle|snake|toad|frog|beetle|ant|fly|crab|spider|scorpion|snail|bee|wasp|chicken|goose|pigeon|sheep|donkey|monkey|kangaroo|elephant|panda|penguin|otter|duck|camel|boar|rat|squirrel|skunk|opossum|weasel|slug|moth|grasshopper|chick|bull|doe|pug|mastiff|beaver|badger|hawk|raven|alligator|crocodile|dolphin|flamingo|leech|lizard|lobster|magpie|mule|parrot|pelican|poodle|rooster|salmon|seagull|shark|sparrow|viper|vulture|yak|zebra/.test(lower)) {
          return "Animal";
        }
        if (/golem|automaton|construct|mecha|turret|blade|dummy|statue|cube|sign|cone|tank|robot|sentinel|drone/.test(lower)) {
          return "Construct";
        }
        if (/zombie|skeleton|lich|ghost|specter|wight|mummy|cadaver|revenant|undead|bones|skull|ghoul|walker|death|exhumed|dessicated|necro|ossified|rot|shuffler/.test(lower)) {
          return "Undead";
        }
        return "Creature";
      };

      // 1. Load from NPCs.json database (animal, creature, beast entries)
      for (const [spriteKey, data] of Object.entries(npcDb)) {
        if (!data || (data.animal !== true && data.creature !== true && data.Archetype !== "Beast")) continue;
        const cleanName = formatName(spriteKey);
        const kind = classifyKind(data, cleanName);
        const id = spriteKey.toLowerCase().replace(/[^a-z0-9]/g, '_');

        let hash = 0;
        for (let i = 0; i < spriteKey.length; i++) {
          hash = (hash * 31 + spriteKey.charCodeAt(i)) & 0xffff;
        }
        const hp = 80 + (hash % 240);
        const atk = 10 + ((hash >> 3) % 26);
        const def = 8 + ((hash >> 6) % 22);
        const agi = 8 + ((hash >> 9) % 24);

        const icon = kind === "Animal" ? 292 : (kind === "Construct" ? 141 : (kind === "Undead" ? 136 : 176));
        const desc = `A companion attuned to the surrounding ecosystem. Resilient, vigilant, and devoted to trailing and safeguarding the party.`;

        catalog.push({
          id: id,
          name: cleanName,
          species: cleanName,
          kind: kind,
          icon: icon,
          sprite: spriteKey,
          spriteIndex: 0,
          hp: hp,
          atk: atk,
          def: def,
          agi: agi,
          desc: desc
        });
      }

      // 2. Also check img/characters/Monsters if Node fs is available
      try {
        const fs = require('fs');
        const path = require('path');
        const monstersPath = path.join(path.dirname(process.mainModule.filename), 'img/characters/Monsters/');
        if (fs.existsSync(monstersPath)) {
          const files = fs.readdirSync(monstersPath).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
          for (const file of files) {
            const rawName = file.replace(/\.(png|jpg|jpeg)$/i, '');
            const spriteKey = "Monsters/" + rawName;
            const id = spriteKey.toLowerCase().replace(/[^a-z0-9]/g, '_');
            if (catalog.some(c => c.id === id)) continue;
            const cleanName = formatName(rawName);
            const kind = classifyKind(null, cleanName);

            let hash = 0;
            for (let i = 0; i < rawName.length; i++) {
              hash = (hash * 31 + rawName.charCodeAt(i)) & 0xffff;
            }
            const hp = 80 + (hash % 240);
            const atk = 10 + ((hash >> 3) % 26);
            const def = 8 + ((hash >> 6) % 22);
            const agi = 8 + ((hash >> 9) % 24);
            const icon = kind === "Animal" ? 292 : (kind === "Construct" ? 141 : (kind === "Undead" ? 136 : 176));

            catalog.push({
              id: id,
              name: cleanName,
              species: cleanName,
              kind: kind,
              icon: icon,
              sprite: spriteKey,
              spriteIndex: 0,
              hp: hp,
              atk: atk,
              def: def,
              agi: agi,
              desc: `A wilderness ${kind.toLowerCase()} companion attuned to the surrounding ecosystem.`
            });
          }
        }
      } catch (e) {}

      catalog.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      this._cachedPetCatalog = catalog;
      return catalog;
    }

    _petCategories() {
      return [
        { id: "all",       label: ccT('CharCreate.filterAll', 'All') },
        { id: "Animal",    label: ccT('CharCreate.petKindAnimals', 'Animals') },
        { id: "Creature",  label: ccT('CharCreate.petKindCreatures', 'Creatures') },
        { id: "Construct", label: ccT('CharCreate.petKindConstructs', 'Constructs') },
        { id: "Undead",    label: ccT('CharCreate.petKindUndead', 'Undead') },
      ];
    }

    _petPickerLeftHtml() {
      const activeCat = Scene_CharacterCreation._activePetCategory || "all";
      const searchQuery = (Scene_CharacterCreation._petSearchQuery || "").trim().toLowerCase();
      const categories = this._petCategories();
      const catalog = this._petCatalog();
      let filtered = activeCat === "all" ? catalog : catalog.filter((p) => p.kind === activeCat);
      if (searchQuery) {
        filtered = filtered.filter((p) => p.name.toLowerCase().includes(searchQuery) || p.kind.toLowerCase().includes(searchQuery));
      }

      const petRailFocused = !!this._pageRailFocused;
      const catTabsHtml = categories.map((cat) => `
        <button class="ts-tab ${cat.id === activeCat ? 'active' : ''} ${cat.id === activeCat && petRailFocused ? 'selected' : ''}" onclick="SceneManager._scene.onPetCategorySelect('${cat.id}')">
          ${cat.label}
        </button>
      `).join("");

      // Store filtered list for the virtual scroll handler
      Scene_CharacterCreation._petVirtFiltered = filtered;
      // Reset scroll offset when filter/search changes
      const filterKey = activeCat + "|" + searchQuery;
      if (Scene_CharacterCreation._petVirtFilterKey !== filterKey) {
        Scene_CharacterCreation._petVirtFilterKey = filterKey;
        Scene_CharacterCreation._petVirtScrollTop = 0;
      }

      // Render only the initial visible window of cards (no full 600+ render)
      const initialCards = this._buildPetCardsWindow(filtered, 0);

      return `
        <div class="cc-page cc-page-full ts-page" style="display:flex; flex-direction:column;">
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="text" class="backpack-search-input cc-rail-search"
                   placeholder="${ccT('CharCreate.petSearchPlaceholder', 'Search companion monsters...')}"
                   value="${Scene_CharacterCreation._petSearchQuery || ''}"
                   oninput="SceneManager._scene.onPetSearch(this.value)" />
            <span class="cc-count-badge">${ccTp('CharCreate.petCount', { n: filtered.length }, filtered.length + ' monsters')}</span>
          </div>
          <div class="ts-tab-row">${catTabsHtml}</div>
          <div class="cc-pet-grid" id="cc-pet-grid-virt">
            ${initialCards}
          </div>
        </div>
      `;
    }

    // ── Virtual scroll: what the grid actually measures ──
    // The window used to be computed from guesses: four columns, a 110px card
    // and a 480px viewport. The grid is `auto-fill minmax(130px, 1fr)`, so it
    // draws five or six columns on a wide board, and every guessed row was a
    // row of height the spacer added and nothing filled: the roster ended
    // halfway up a scrollbar that kept going. The live grid is measured
    // instead, and the guesses are only the fallback for the first render,
    // before there is a grid to measure.
    _petGridMetrics() {
      const CARD_MIN = 130;
      const GAP = 8;
      const fallback = { cols: 4, rowH: 118, viewH: 480 };
      const grid = typeof document !== "undefined" && document.getElementById
        ? document.getElementById("cc-pet-grid-virt") : null;
      if (!grid) return fallback;

      let cols = 0;
      if (typeof window !== "undefined" && window.getComputedStyle) {
        const template = window.getComputedStyle(grid).gridTemplateColumns || "";
        cols = template.split(" ").filter((v) => v && v !== "none").length;
      }
      if (!cols) {
        const inner = (grid.clientWidth || 0) - 12; // the grid's own 6px padding
        cols = Math.max(1, Math.floor((inner + GAP) / (CARD_MIN + GAP)));
      }
      const card = grid.querySelector(".cc-pet-card");
      const rowH = ((card && card.offsetHeight) || (fallback.rowH - GAP)) + GAP;
      const viewH = grid.clientHeight || fallback.viewH;
      return { cols: cols, rowH: rowH, viewH: viewH };
    }

    // ── Virtual scroll: card window renderer ──
    // Renders a slice of `filtered` that covers the viewport + overscan buffer.
    // `scrollTop` is the current scroll position of the grid container.
    _buildPetCardsWindow(filtered, scrollTop, metrics) {
      if (!filtered || filtered.length === 0) {
        return `<div class="cc-empty-note">${ccT('CharCreate.petNoneFound', 'No companion monsters match this filter')}</div>`;
      }

      const OVERSCAN_ROWS = 3; // extra rows rendered above/below the viewport
      const m = metrics || this._petGridMetrics();
      const COLS = Math.max(1, m.cols);
      const ROW_H = Math.max(1, m.rowH);

      const visibleRows = Math.ceil(m.viewH / ROW_H) + OVERSCAN_ROWS * 2;
      const visibleCount = visibleRows * COLS;

      const totalItems  = filtered.length;
      const totalRows   = Math.ceil(totalItems / COLS);
      const totalHeight = totalRows * ROW_H;

      const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN_ROWS);
      const startIdx = firstRow * COLS;
      const endIdx   = Math.min(totalItems, startIdx + visibleCount);

      const topPad    = firstRow * ROW_H;
      const renderedRows = Math.ceil((endIdx - startIdx) / COLS);
      // The last rendered row has no gap under it, and the grid's own gap sits
      // between the spacer and the cards: counting a full row height for both
      // is what left a strip of nothing under the final card.
      const bottomPad = Math.max(0, totalHeight - topPad - renderedRows * ROW_H);

      const selectedPet = $gameSystem._partyPet;
      const slice = filtered.slice(startIdx, endIdx);

      const cardsHtml = slice.map((pet) => {
        const isSelected = selectedPet && selectedPet.id === pet.id;
        return `
          <div class="cc-pet-card ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onPetCardSelect('${pet.id}')">
            <div class="cc-pet-avatar">
              <div style="${this.getSpriteStyle(pet.sprite, pet.spriteIndex || 0)}; transform: scale(1.2);"></div>
            </div>
            <div class="cc-pet-name" title="${pet.name}">${pet.name}</div>
            <div class="cc-pet-kind">${pet.kind}</div>
          </div>
        `;
      }).join("");

      // Spacer divs maintain correct scrollbar height without DOM nodes for off-screen cards
      const topSpacer    = topPad    > 0 ? `<div style="grid-column:1/-1; height:${topPad}px; pointer-events:none;"></div>` : "";
      const bottomSpacer = bottomPad > 0 ? `<div style="grid-column:1/-1; height:${bottomPad}px; pointer-events:none;"></div>` : "";

      return `${topSpacer}${cardsHtml}${bottomSpacer}`;
    }

    // ── Virtual scroll: attach scroll listener after DOM insertion ──
    // Called once per full DOM rebuild. Re-binds are guarded by _petVirtBound.
    _attachPetVirtualScroll() {
      const grid = document.getElementById("cc-pet-grid-virt");
      if (!grid || grid._petVirtBound) return;
      grid._petVirtBound = true;

      // The first window was built before this grid existed, off the fallback
      // guesses, so it is rebuilt once now that the real column count, card
      // height and viewport can be measured. Without this the scrollbar is
      // sized for a grid nobody is looking at.
      const savedScroll = Scene_CharacterCreation._petVirtScrollTop || 0;
      const remeasure = (scrollTop) => {
        const filtered = Scene_CharacterCreation._petVirtFiltered || [];
        grid.innerHTML = this._buildPetCardsWindow(filtered, scrollTop, this._petGridMetrics());
        grid._petVirtBound = true; // re-mark after innerHTML wipe
      };
      if (savedScroll > 0) grid.scrollTop = savedScroll;
      remeasure(savedScroll);

      // Passive scroll listener: patches grid content only, no layout rebuild
      grid.addEventListener("scroll", () => {
        const st = grid.scrollTop;
        Scene_CharacterCreation._petVirtScrollTop = st;
        remeasure(st);
      }, { passive: true });

      // A board that changes width (the window resized, the sidebar folded)
      // changes its column count with it, so the window is measured again.
      if (typeof ResizeObserver !== "undefined" && !grid._petVirtResize) {
        grid._petVirtResize = new ResizeObserver(() => remeasure(grid.scrollTop));
        grid._petVirtResize.observe(grid);
      }
    }

    // The three optional traits a chosen companion can carry, kept as one
    // scene-level toggle set: they describe how the eventual companion is
    // built, not any one catalogue entry, the same way its eventual name is
    // never tied to the card being previewed either.
    _petTraits() {
      if (!Scene_CharacterCreation._petTraits) {
        Scene_CharacterCreation._petTraits = { sentient: false, magical: false, geneticFreak: false };
      }
      return Scene_CharacterCreation._petTraits;
    }

    // The companion sidebar: the beast the board is pointing at, its numbers and
    // its nature. This used to be the right half of the spread, which cost the
    // roster half its width and said nothing the sidebar could not.
    _petSidebarHtml() {
      const catalog = this._petCatalog();
      const selectedPet = $gameSystem._partyPet;
      const hoveredId = Scene_CharacterCreation._hoveredPetId || (selectedPet ? selectedPet.id : (catalog[0] && catalog[0].id));
      const pet = catalog.find((p) => p.id === hoveredId) || catalog[0];
      if (!pet) return `<div class="cc-compact-sidebar"></div>`;
      const isChosen = selectedPet && selectedPet.id === pet.id;
      const traits = this._petTraits();
      const attrs = (window.PetSystem && window.PetSystem.previewAttrs)
        ? window.PetSystem.previewAttrs(traits.sentient, traits.magical, traits.geneticFreak)
        : { STR: 10, CON: 10, INT: 10, WIS: 10, PSI: 10 };

      return `
        <div class="cc-compact-sidebar cc-pet-sidebar">
          <div class="cc-compact-identity-card">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <span class="cc-pet-sidebar-name">${pet.name}</span>
              <button class="cc-profile-open-btn" onclick="SceneManager._scene.onRandomizePet()">${ccT('CharCreate.randomize', 'Randomize')}</button>
            </div>
          </div>

          <div class="cc-pet-portrait">
            <div class="cc-wanted-sprite" style="${this.getSpriteStyle(pet.sprite, pet.spriteIndex || 0)}; transform: scale(2);"></div>
          </div>

          <div class="cc-dossier-card" style="padding:10px; margin-bottom:8px;">
            <h3 class="cc-subheader" style="font-size:1.05rem; margin-bottom:6px;">${T('CharCreate.companionStats') || "Companion Vitals"}</h3>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccT('CharCreate.petSpecies', 'Species')}</span><span class="cc-dossier-value">${pet.species}</span></div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccT('CharCreate.petClassification', 'Classification')}</span><span class="cc-dossier-value">${pet.kind}</span></div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccT('CharCreate.petMaxHp', 'Max HP')}</span><span class="cc-dossier-value">${pet.hp}</span></div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccT('CharCreate.petCombatPower', 'Combat power')}</span><span class="cc-dossier-value">${ccStatLabel('STR')} ${pet.atk} / ${ccStatLabel('CON')} ${pet.def} / ${ccStatLabel('DEX')} ${pet.agi}</span></div>
          </div>

          <div class="cc-dossier-card" style="padding:10px; margin-bottom:8px;">
            <h3 class="cc-subheader" style="font-size:1.05rem; margin-bottom:6px;">${ccT('CharCreate.petTraitsTitle', 'Traits')}</h3>
            <div style="display:flex; gap:6px; margin-bottom:8px;">
              <button class="cc-pet-trait-toggle ${traits.sentient ? 'active' : ''}" onclick="SceneManager._scene.onTogglePetTrait('sentient')">${ccT('CharCreate.petTraitSentient', 'Sentient')}</button>
              <button class="cc-pet-trait-toggle ${traits.magical ? 'active' : ''}" onclick="SceneManager._scene.onTogglePetTrait('magical')">${ccT('CharCreate.petTraitMagical', 'Magical')}</button>
              <button class="cc-pet-trait-toggle ${traits.geneticFreak ? 'active' : ''}" onclick="SceneManager._scene.onTogglePetTrait('geneticFreak')">${ccT('CharCreate.petTraitGeneticFreak', 'Genetic Freak')}</button>
            </div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccStatLabel('STR')} / ${ccStatLabel('CON')}</span><span class="cc-dossier-value">${attrs.STR} / ${attrs.CON}</span></div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccStatLabel('INT')} / ${ccStatLabel('WIS')}</span><span class="cc-dossier-value">${attrs.INT} / ${attrs.WIS}</span></div>
            <div class="cc-dossier-row"><span class="cc-dossier-label">${ccStatLabel('PSI')}</span><span class="cc-dossier-value">${attrs.PSI}</span></div>
          </div>

          <div class="cc-dossier-card cc-pet-nature" style="padding:10px;">
            <h3 class="cc-subheader" style="font-size:1.05rem; margin-bottom:6px;">${T('CharCreate.behavioralTraits') || "Behavior & Nature"}</h3>
            <p class="cc-text-desc cc-text-desc--body">${pet.desc}</p>
          </div>

          <div class="cc-compact-actions" style="margin-top:auto; display:flex; flex-direction:column; gap:6px;">
            <button class="cc-compact-btn ${isChosen ? '' : 'primary'}" onclick="SceneManager._scene.onPetCardSelect('${pet.id}')">${isChosen ? ccT('CharCreate.selectedCompanion', 'Companion selected') : ccT('CharCreate.chooseAsCompanion', 'Choose as initial companion')}</button>
            <button class="cc-compact-btn primary" onclick="SceneManager._scene.onProceedToScenario()">${this._hasPresetInParty(false) ? ccT('CharCreate.startGame', 'Start Game') : ccT('CharCreate.confirmPartyScenario', 'Confirm Party & Scenario')}</button>
          </div>
        </div>
      `;
    }

    onPetTabClick() {
      this._pageRailFocused = false;
      Scene_CharacterCreation._railFocus = null;
      Scene_CharacterCreation._isPetMode = true;
      if (this._presetWindow) this.onPresetCancel();
      SoundManager.playCursor();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onPetSearch(query) {
      Scene_CharacterCreation._petSearchQuery = query;
      const activeCat = Scene_CharacterCreation._activePetCategory || "all";
      const q = (query || "").trim().toLowerCase();
      const catalog = this._petCatalog();
      let filtered = activeCat === "all" ? catalog : catalog.filter((p) => p.kind === activeCat);
      if (q) {
        filtered = filtered.filter((p) => p.name.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q));
      }
      Scene_CharacterCreation._petVirtFiltered = filtered;
      Scene_CharacterCreation._petVirtScrollTop = 0;

      const grid = document.getElementById("cc-pet-grid-virt");
      // The tally beside the search box, which the page prints as a count badge:
      // the old selector named the money badge and never found anything, so the
      // count froze at whatever the last full rebuild had written.
      const badge = this._dndContainer && this._dndContainer.querySelector(".cc-count-badge");
      if (badge) {
        badge.textContent = ccTp('CharCreate.petCount', { n: filtered.length }, filtered.length + ' monsters');
      }
      if (grid) {
        grid.scrollTop = 0;
        grid.innerHTML = this._buildPetCardsWindow(filtered, 0, this._petGridMetrics());
        grid._petVirtBound = true;
      } else {
        this._lastStep = -1;
        this._lastIndex = -1;
        this.refreshUIOverlayDOM();
      }
    }

    onPetCategorySelect(category) {
      Scene_CharacterCreation._activePetCategory = category;
      Scene_CharacterCreation._petVirtScrollTop = 0;
      SoundManager.playCursor();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // Flips one of the three optional traits and redraws just the sidebar,
    // the same in-place update onPetCardSelect does for a new hover.
    onTogglePetTrait(key) {
      const traits = this._petTraits();
      traits[key] = !traits[key];
      SoundManager.playCursor();

      const sidebarSlot = this._dndContainer && this._dndContainer.querySelector(".cc-sidebar-slot");
      const sidebar = this._dndContainer && this._dndContainer.querySelector(".cc-compact-sidebar");
      if (sidebarSlot) sidebarSlot.innerHTML = this._petSidebarHtml();
      else if (sidebar) sidebar.outerHTML = this._petSidebarHtml();
      else {
        this._lastStep = -1;
        this._lastIndex = -1;
        this.refreshUIOverlayDOM();
      }
    }

    onPetCardSelect(petId) {
      const pet = this._petCatalog().find((p) => p.id === petId);
      if (!pet) return;
      $gameSystem._partyPet = pet;
      Scene_CharacterCreation._hoveredPetId = petId;
      SoundManager.playOk();

      const sidebarSlot = this._dndContainer && this._dndContainer.querySelector(".cc-sidebar-slot");
      const sidebar = this._dndContainer && this._dndContainer.querySelector(".cc-compact-sidebar");
      const grid = document.getElementById("cc-pet-grid-virt");
      if ((sidebarSlot || sidebar) && grid) {
        if (sidebarSlot) sidebarSlot.innerHTML = this._petSidebarHtml();
        else sidebar.outerHTML = this._petSidebarHtml();
        const cards = grid.querySelectorAll(".cc-pet-card");
        cards.forEach((c) => {
          if (c.getAttribute("onclick") && c.getAttribute("onclick").includes(`'${petId}'`)) {
            c.classList.add("selected");
          } else {
            c.classList.remove("selected");
          }
        });
        const tabDot = this._dndContainer && this._dndContainer.querySelector(".cc-pet-tab .cc-tab-dot");
        if (tabDot) tabDot.classList.add("done");
        const petTabLabel = this._dndContainer && this._dndContainer.querySelector(".cc-pet-tab span:nth-child(2)");
        if (petTabLabel) petTabLabel.textContent = pet.name;
      } else {
        this._lastStep = -1;
        this._lastIndex = -1;
        this.refreshUIOverlayDOM();
      }
    }

    onRemovePet(event) {
      if (event) event.stopPropagation();
      $gameSystem._partyPet = null;
      SoundManager.playCancel();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onRandomizePet() {
      const catalog = this._petCatalog();
      const pet = catalog[Math.floor(Math.random() * catalog.length)];
      $gameSystem._partyPet = pet;
      Scene_CharacterCreation._hoveredPetId = pet.id;
      SoundManager.playOk();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    // Renders an IconSet glyph inline via CSS background-position (same
    // approach as TraitSelector.getIconStyle) so dossier item rows don't need
    // a canvas draw pass on every cursor move.
    _ccIconStyle(iconIndex, size = 32) {
      if (!iconIndex) return "";
      const col = iconIndex % 16;
      const row = Math.floor(iconIndex / 16);
      return `background-image: url('img/system/IconSet.png'); background-size: ${size * 16}px auto; background-position: -${col * size}px -${row * size}px; width: ${size}px; height: ${size}px; image-rendering: pixelated; display: inline-block; flex-shrink: 0;`;
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

    // Keeps the chip under the look thumbnails naming the button that is
    // actually there right now. Cheap: the DOM is only touched when the answer
    // changes.
    syncSkinKeyChip() {
      if (!this._dndContainer) return;
      const chip = this._dndContainer.querySelector(".cc-skins-hint .cc-key-chip");
      if (!chip) return;
      const onPad = skinKeyPadOn() ? "1" : "0";
      if (chip.dataset.pad === onPad) return;
      chip.dataset.pad = onPad;
      chip.textContent = skinKeyLabel();
    }

    // The highlighted dossier changed look (thumbnail, shoulder button, TAB).
    // Only three things on screen follow the look, so they are patched in
    // place: rebuilding the spread here reloaded every poster's sprite, which
    // made the board blink and threw away the dossier's scroll position on
    // each step through the looks.
    onPresetSkinChange() {
      if (!this._dndContainer || !this._presetWindow) return;
      const spread = this._dndContainer.querySelector(".cc-pockets-spread");
      const preset = this._presetWindow.currentPreset();
      if (!spread || !preset) {
        // No spread built yet (or nothing highlighted): fall back to the full
        // rebuild, which also stamps the board from scratch.
        this._lastStep = -1;
        this._lastIndex = -1;
        this.refreshUIOverlayDOM();
        return;
      }

      const skins = presetSkins(preset);
      const skinIdx = this._presetWindow.skinIndex ? this._presetWindow.skinIndex() : 0;
      const skin = skins[skinIdx] || skins[0] || preset;
      const spriteStyle = this.getSpriteStyle(skin.sprite, skin.spriteIndex);

      // The dossier portrait keeps the layout it was drawn with.
      const portrait = spread.querySelector(".cc-page-right .cc-dossier-photo-frame .cc-wanted-sprite");
      if (portrait) {
        portrait.setAttribute("style", `${spriteStyle}; transform:scale(1.8); margin:6px 0;`);
      }

      // Which thumbnail wears the stamp, and the count under the row.
      spread.querySelectorAll(".cc-skin-card").forEach((el, i) => {
        el.classList.toggle("selected", i === skinIdx);
      });
      const hint = spread.querySelector(".cc-skins-hint span:last-child");
      if (hint) hint.textContent = `${T('CharPresets.skinHint')} (${skinIdx + 1}/${skins.length})`;

      // The board poster of the dossier being read, so the two agree. Scoped to
      // the board so the look thumbnails, which are wanted cards too, are left
      // alone.
      const cards = spread.querySelectorAll(".cc-page-left .cc-presets-board .cc-wanted-card");
      const card = cards[this._presetWindow.index()];
      const boardSprite = card && card.querySelector(".cc-wanted-sprite");
      if (boardSprite) boardSprite.setAttribute("style", spriteStyle);
    }

    onOptionCardClick(index) {
      if (this._refusePresetEdit()) return;
      if (!this._gridWindow) return;
      const stepData = this.currentStepData();
      if (stepData && stepData.choices && stepData.choices[index]) {
        const choice = stepData.choices[index];
        const actor = Scene_CharacterCreation.getCurrentActor();

        if (this._step === STEP.CLASS) {
          this._gridWindow.select(index);
          if (choice.symbol && choice.symbol.indexOf("quick_class_") === 0) {
            const classId = choice.value;
            if (actor) {
              actor.changeClass(classId, true);
              if (typeof equipRandomCompatibleWeapon === "function") equipRandomCompatibleWeapon(actor, classId);
              if (typeof giveClassStartingItems === "function") giveClassStartingItems(actor, classId);
            }
          } else if (choice.symbol === "select_class") {
            window.$ccArchetypeClassFilter = null;
            window.$ccCreatureClassFlow = null;
            this.closeStepUI();
            SceneManager.goto(Scene_ClassSelection);
            return;
          } else if (choice.symbol === "mana_cyborg") {
            if (actor) {
              actor.changeClass(66, false);
              if (typeof equipRandomCompatibleWeapon === 'function') equipRandomCompatibleWeapon(actor, 66);
              if (typeof giveClassStartingItems === "function") giveClassStartingItems(actor, 66);
            }
          } else if (choice.symbol === "random_class") {
            const validClassIds = window.CreatureClasses ? window.CreatureClasses.sentientRoster() : [];
            if (validClassIds.length > 0 && actor) {
              const rId = validClassIds[Math.floor(Math.random() * validClassIds.length)];
              actor.changeClass(rId, true);
              if (typeof equipRandomCompatibleWeapon === "function") equipRandomCompatibleWeapon(actor, rId);
              if (typeof giveClassStartingItems === "function") giveClassStartingItems(actor, rId);
            }
          }
        } else if (this._step === STEP.ORIGIN) {
          const isAlreadySelected = (this._gridWindow.index() === index) && ($gameSystem._ccOriginSymbol === choice.symbol);
          this._gridWindow.select(index);
          if (choice.symbol) {
            this._selectedOrigin = choice.symbol;
            $gameSystem._ccOriginSymbol = choice.symbol;
            if (actor) actor._originSymbol = choice.symbol;
            if (typeof captureOriginSnapshot === "function") captureOriginSnapshot();
          }
          if (isAlreadySelected) {
            this.onFinishPartyCreation();
            return;
          }
        } else if (this._step === STEP.PERSONALITY) {
          this._gridWindow.select(index);
          if (actor) {
            let pIdx = 0;
            if (choice.symbol === "personality_random") {
              const catalog = personalityCatalog();
              if (catalog.length > 0) {
                pIdx = Math.floor(Math.random() * catalog.length);
              }
            } else {
              pIdx = Number.isFinite(Number(choice.value)) ? Number(choice.value) : index;
            }
            actor._personalityIndex = pIdx;
            if (typeof applyPersonalityChoice === "function") {
              applyPersonalityChoice(actor, pIdx);
            }
          }
        } else if (this._step === STEP.HOMETOWN) {
          this._gridWindow.select(index);
          $gameSystem._ccHometown = choice.symbol;
        } else {
          this._gridWindow.select(index);
        }

        markStepCompleted(this._step);
        SoundManager.playOk();
      }

      const container = this._dndContainer;
      if (container) {
        const stepData2 = this.currentStepData();
        const choice2 = (stepData2 && stepData2.choices && stepData2.choices[index]) || {};

        // The class board is a spread whose roster is narrowed by its search
        // strip, so a card's position on screen is not its choice index:
        // both pages are rebuilt from the index instead of being patched by
        // DOM order, which used to highlight whichever card happened to sit
        // where the picked one would have been on the unfiltered board.
        if (this._step === STEP.CLASS || this._isClassPickerStep()) {
          Scene_CharacterCreation._classHoverIndex = index;
          this._ccSwapPage(container.querySelector(".cc-page-left"), this._classPickerLeftHtml(stepData2, index));
          this._ccSwapPage(container.querySelector(".cc-page-right"), this._classPickerRightHtml(stepData2, index));
          const sidebarSlot = container.querySelector(".cc-sidebar-slot");
          if (sidebarSlot) sidebarSlot.innerHTML = this._renderCompactSidebarHtml();
          this._refreshTopFolderTabs();
          this._lastIndex = index;
          return;
        }

        // The scenario board's right page is the party as this scenario leaves
        // it: the exclusive kit and the money change with the choice, so the
        // whole spread is rebuilt rather than the highlight being moved.
        if (this._step === STEP.ORIGIN) {
          const dossier = container.querySelector(".cc-scenario-dossier");
          if (dossier) {
            dossier.outerHTML = this._renderScenarioDossierHtml();
            this._lastIndex = index;
            return;
          }
        }

        // Update selected option card styling
        const cards = container.querySelectorAll(".cc-card-option");
        cards.forEach((c, idx) => {
          c.classList.toggle("selected", idx === index);
        });

        // Every other board heads itself with the highlighted choice's own name
        // and description, which used to stay frozen on the first entry however
        // far the cursor moved.
        const headerH2 = container.querySelector(".cc-class-header h2");
        const headerP = container.querySelector(".cc-class-header p");
        if (headerH2) headerH2.textContent = choice2.name || "";
        if (headerP) headerP.textContent = this.cleanText(choice2.description || "");

        // Update sidebar
        const sidebar = container.querySelector(".cc-compact-sidebar");
        if (sidebar) sidebar.outerHTML = this._renderCompactSidebarHtml();

        // Update folder tabs
        this._refreshTopFolderTabs();

        this._lastIndex = index;
        return;
      }

      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onOptionCardConfirm(index) {
      this.onOptionCardClick(index);
    }

    // --- Settings Step Helpers ---

    _buildSettingsRows() {
      const scene = this;
      if (ConfigManager.fogOfWar === undefined) ConfigManager.fogOfWar = false;
      if (ConfigManager.enemyBattlers === undefined) ConfigManager.enemyBattlers = 1;
      if (!ConfigManager.battleMusicName) {
        const mss = window.MusicSelectionSystem;
        ConfigManager.battleMusicName = (mss && mss.MUSIC_BIOME) || "RandomMind/Battle";
      }
      // ASCII mode is not offered here; it lives in the in-game options menu
      // (GameOptions.js), which owns its own defaults.
      if (ConfigManager.activeTheme === undefined) ConfigManager.activeTheme = 0;
      if (ConfigManager.partyHud === undefined) ConfigManager.partyHud = true;
      if (ConfigManager.cpuPartyMembers === undefined) ConfigManager.cpuPartyMembers = false;
      // Party Level (1) is the default the world is written for; ConfigManager
      // seeds the same value, this only covers a config that never had one.
      if (ConfigManager.enemySpawnMode === undefined) ConfigManager.enemySpawnMode = 1;
      if (ConfigManager.dialogueMode === undefined) ConfigManager.dialogueMode = 'empathize';
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
          // Enemy spawn mode: what decides the level of everything roaming the
          // world (BattleSystemEnhancedEncounters.js, BSE.Helpers.getSpawnMode).
          // It shapes the whole run rather than one screen of it, so it is asked
          // here, on the first page of creation, as well as in the options menu
          // (Options > Gameplay > Enemy Spawn), which owns the very same
          // ConfigManager.enemySpawnMode and can still change it later.
          //
          // Mode names and the blurb for the highlighted one are read from the
          // options menu's own strings, so the two pages can never end up
          // describing a mode differently, and a new mode has to be added in
          // one place only.
          key: 'enemySpawnMode',
          label: T('GameOptions.label.enemySpawn'),
          get _modes() { return T.list('GameOptions.enemySpawn'); },
          get description() {
            const states = T.list('GameOptions.descState.enemySpawnMode');
            return states[this.currentIndex] || T('GameOptions.desc.enemySpawnMode');
          },
          get currentIndex() {
            const v = ConfigManager.enemySpawnMode;
            const count = this._modes.length;
            return (Number.isInteger(v) && v >= 0 && v < count) ? v : 0;
          },
          get currentLabel() {
            return this._modes[this.currentIndex] || this._modes[0] || '';
          },
          _changeBy(delta) {
            const count = this._modes.length;
            if (!count) return;
            ConfigManager.enemySpawnMode = (this.currentIndex + delta + count) % count;
          },
          next() { this._changeBy(1); },
          prev() { this._changeBy(-1); },
        },
        {
          // How a talking NPC with nothing scripted to say answers you: a
          // personality-driven Socialize line (Empathize) or Markov-generated
          // text from their own word bank (Markovian). Mirrors Options >
          // Gameplay > NPC Dialogue Mode, which owns the same
          // ConfigManager.dialogueMode and can still change it later.
          key: 'dialogueMode',
          label: T('GameOptions.label.dialogueMode'),
          description: T('GameOptions.desc.dialogueMode'),
          get _modes() { return T.list('GameOptions.dialogueMode'); },
          get _values() { return ['empathize', 'markovian']; },
          get currentIndex() {
            const i = this._values.indexOf(ConfigManager.dialogueMode);
            return i >= 0 ? i : 0;
          },
          get currentLabel() {
            return this._modes[this.currentIndex] || this._modes[0] || '';
          },
          _changeBy(delta) {
            const values = this._values;
            const count = values.length;
            ConfigManager.dialogueMode = values[(this.currentIndex + delta + count) % count];
          },
          next() { this._changeBy(1); },
          prev() { this._changeBy(-1); },
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
          key: 'partyHud',
          label: T('CharCreate.partyHud'),
          description: T('CharCreate.aCardForEveryPartyMemberInTheTopLeftCornerOf'),
          imageOff: "Settings/PartyHudOFF",
          imageOn:  "Settings/PartyHudON",
          captionOff: T('CharCreate.theMapIsLeftClearNoPartyCardsOverIt'),
          captionOn: T('CharCreate.healthMagicStatesAndUrgentNeedsAtAGlance'),
          get currentIndex() { return ConfigManager.partyHud === false ? 1 : 0; },
          get currentLabel() { return this.currentIndex === 0 ? T('CharCreate.yes') : T('CharCreate.no'); },
          next() { ConfigManager.partyHud = ConfigManager.partyHud === false; },
          prev() { ConfigManager.partyHud = ConfigManager.partyHud === false; },
        },
        {
          key: 'enemyBattlers',
          label: T('CharCreate.enemyBattlers'),
          description: T('CharCreate.howEnemiesAreShownInBattle2dTheClassicBattle'),
          // No preview images, so this row shows no captions.
          // 1 = 3D (default), 2 = Sprites, 3 = 2D battler images. See
          // window.EnemyBattlerModes.
          _apply(mode) {
            ConfigManager.enemyBattlers = window.EnemyBattlerModes.normalize(mode);
            ConfigManager.charBasedSprites = (ConfigManager.enemyBattlers === 2); // legacy mirror
          },
          get currentIndex() {
            return window.EnemyBattlerModes.normalize(ConfigManager.enemyBattlers);
          },
          get currentLabel() {
            // Same names the options menu shows, in EnemyBattlerModes order.
            const names = T.list('GameOptions.enemyBattler');
            const i = window.EnemyBattlerModes.VALUES.indexOf(this.currentIndex);
            return names[Math.max(0, i)] || "3D";
          },
          next() { this._apply(window.EnemyBattlerModes.step(this.currentIndex, 1)); },
          prev() { this._apply(window.EnemyBattlerModes.step(this.currentIndex, -1)); },
        },
        {
          // Still a work in progress (hence the label), so it sits low on the
          // page and starts off; the options menu owns the same setting.
          key: 'fogOfWar',
          label: T('CharCreate.fogOfWar'),
          description: T('CharCreate.revealsTheMapGraduallyAsYouExploreUnvisitedA'),
          imageOff: "Settings/FogOfWarOFF",
          imageOn:  "Settings/FogOfWarON",
          captionOff: T('CharCreate.theEntireMapIsFullyRevealedNoHiddenAreas'),
          captionOn: T('CharCreate.exploreTileByTileDarknessVeilsTheUnknown'),
          get currentIndex() { return ConfigManager.fogOfWar === true ? 0 : 1; },
          get currentLabel() { return this.currentIndex === 0 ? T('CharCreate.yes') : T('CharCreate.no'); },
          next() { ConfigManager.fogOfWar = ConfigManager.fogOfWar !== true; },
          prev() { ConfigManager.fogOfWar = ConfigManager.fogOfWar !== true; },
        },
        {
          key: 'battleMusic',
          label: T('CharCreate.battleMusic'),
          // A getter, not a fixed line: the Biome entry needs a word of its own
          // to explain that the track comes from the ground the fight is on.
          get description() {
            const mss = window.MusicSelectionSystem;
            return (mss && ConfigManager.battleMusicName === mss.MUSIC_BIOME)
              ? T('MusicSelection.biomeEachPlace')
              : T('CharCreate.musicTrackPlayedDuringCombatPressToPreviewTr');
          },
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
            const mss = window.MusicSelectionSystem;
            // Random and Biome must not reach playBgm as file names: they
            // audition a draw and the local biome's theme instead.
            if (mss && mss.previewTrackValue) {
              mss.previewTrackValue(val, 90);
            } else if (val && val !== "__none__" && val !== "__map__" && val !== "__biome__") {
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
      // The rows are built by setupStep. A refresh that beats it here (a
      // handler that repaints before the step has been set up) used to throw
      // on the row lookup below and take the whole overlay down with it.
      if (!this._settingsRows || !this._settingsRows.length) {
        this._settingsRows = this._buildSettingsRows();
      }
      const hash = this._settingsStateHash();
      if (this._lastSettingsHash === hash) return;
      this._lastSettingsHash = hash;

      const rows = this._settingsRows;
      const rowIdx = Scene_CharacterCreation._settingsRowIndex;
      const currentRow = rows[rowIdx];

      // Left page: option name as title, OFF image + caption, ON image + caption
      let previewHtml = '';
      if (currentRow.imageOff || currentRow.imageOn) {
        // One plate, not two: the setting is either on or off, and showing the
        // state it is NOT in beside the state it IS in only made the reader
        // work out which of the pair was the live one. The plate the page does
        // show is given the whole width for it. Both picture rows read index 0
        // as the on state (see _buildSettingsRows).
        const isOn = currentRow.currentIndex === 0;
        const file = isOn ? currentRow.imageOn : currentRow.imageOff;
        const caption = isOn ? currentRow.captionOn : currentRow.captionOff;
        previewHtml = file ? `
          <div class="cc-settings-img-stack">
            <div class="cc-settings-img-entry">
              <img src="img/pictures/${file}.png" class="cc-settings-preview-img" alt="${currentRow.currentLabel || ''}">
              <p class="cc-settings-img-caption">${caption || ''}</p>
            </div>
          </div>
        ` : '';
      } else if (currentRow.key === 'battleMusic') {
        previewHtml = `<div class="cc-settings-glyph">♪</div>`;
      } else if (currentRow.key === 'activeTheme') {
        previewHtml = `
          <div class="cc-settings-glyph">◈</div>
          <p class="cc-settings-value">${currentRow.currentLabel}</p>
        `;
      } else if (currentRow.key === 'enemySpawnMode') {
        // One plate per mode, the same files the options menu uses
        // (GameOptions.js, OPTION_IMAGES.enemySpawnMode). Any of them that is
        // still an empty stub fails to load and hides itself, leaving the skull
        // and the mode's own blurb, which is all this panel showed before.
        const plate = ENEMY_SPAWN_IMAGES[currentRow.currentIndex];
        const plateHtml = plate ? `
          <img src="img/pictures/Settings/${plate}.png" class="cc-settings-preview-img"
               alt="${currentRow.currentLabel}"
               onload="if(this.naturalWidth<8){this.style.display='none'}else{this.previousElementSibling.style.display='none'}"
               onerror="this.style.display='none'">` : '';
        previewHtml = `
          <div class="cc-settings-img-stack">
            <div class="cc-settings-img-entry">
              <div class="cc-settings-glyph">☠</div>
              ${plateHtml}
              <p class="cc-settings-value">${currentRow.currentLabel}</p>
            </div>
          </div>
        `;
      }

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

      const leftHtml = `
        <div class="cc-page cc-page-left">
          <div class="cc-settings-list">${rowsHtml}</div>
        </div>
      `;

      const rightHtml = `
        <div class="cc-page cc-page-right">
          <div class="cc-dossier-card cc-settings-detail">
            <h3 class="cc-subheader cc-settings-detail-title">${currentRow.label}</h3>
            <p class="cc-settings-desc">${currentRow.description}</p>
            ${previewHtml}
          </div>
        </div>
      `;

      let layout = this._dndContainer.querySelector(".cc-unified-layout");
      if (!layout) {
        // Same skeleton the main board builds, slots and all: leaving the
        // settings board's own shape here meant the board the player went to
        // next could not find the tab slot, so the top bar kept showing
        // Settings as the open tab however far they moved on.
        this._dndContainer.innerHTML = `
          <div class="cc-unified-layout">
            <div class="cc-top-folder-tabs-slot">${this._renderTopFolderTabsHtml()}</div>
            <div class="cc-dossier-main">
              <div class="cc-sidebar-slot">${this._renderCompactSidebarHtml()}</div>
              <div class="cc-content-pane">
                <div class="cc-pockets-spread">
                  <div class="cc-page cc-page-left"></div>
                  <div class="cc-page cc-page-right"></div>
                </div>
              </div>
            </div>
          </div>
        `;
        layout = this._dndContainer.querySelector(".cc-unified-layout");
      }

      // The settings page belongs to the party, not to any one character, so
      // the character's sidebar is put away while it is open and the page takes
      // the board's whole width.
      layout.classList.add("cc-settings-mode");

      // The board the player came from left its own tab marked as the open one.
      // The bar is rewritten once on arrival (not on every keypress, which would
      // rebuild it under the cursor) so Settings is the tab that reads as open.
      if (!this._tabsShowSettings) {
        this._tabsShowSettings = true;
        this._refreshTopFolderTabs();
      }

      let spread = layout.querySelector(".cc-pockets-spread");
      if (!spread) {
        const contentPane = layout.querySelector(".cc-content-pane") || layout;
        contentPane.innerHTML = `<div class="cc-pockets-spread"><div class="cc-page cc-page-left"></div><div class="cc-page cc-page-right"></div></div>`;
        spread = layout.querySelector(".cc-pockets-spread");
      }

      // Moving the cursor or nudging a value used to rewrite the whole spread:
      // both pages were thrown away and rebuilt, which replayed the page-enter
      // animation, reloaded every preview image and re-created the row icons on
      // every keypress. Only the parts that actually changed are touched now.
      //   - the row list is rebuilt only when the settings themselves change
      //     (a different set of rows, or the very first render);
      //   - a value or focus change re-stamps the .active class and rewrites the
      //     one label that moved;
      //   - the preview page is rebuilt only when the row it describes, or that
      //     row's value, is what changed.
      const listEl = spread.querySelector(".cc-settings-list");
      const rowEls = listEl ? listEl.children : null;
      const structureStale = !rowEls || rowEls.length !== rows.length;
      const previewKey = `${rowIdx}:${currentRow.currentIndex}`;
      const innerOf = (html) => html.replace(/^\s*<div[^>]*>/, "").replace(/<\/div>\s*$/, "");

      if (structureStale) {
        spread.innerHTML = `${leftHtml}${rightHtml}`;
        this._drawSettingsIcons();
        this._lastPreviewKey = previewKey;
        return;
      }

      for (let i = 0; i < rows.length; i++) {
        const rowEl = rowEls[i];
        rowEl.classList.toggle("active", i === rowIdx);
        const valueEl = rowEl.querySelector(".option-select-val");
        if (valueEl && valueEl.textContent !== rows[i].currentLabel) {
          valueEl.textContent = rows[i].currentLabel;
        }
      }

      if (this._lastPreviewKey !== previewKey) {
        this._lastPreviewKey = previewKey;
        const rightPage = spread.querySelector(".cc-page-right");
        if (rightPage) rightPage.innerHTML = innerOf(rightHtml);
      }
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
      this._ccHandingOver = false;
      if (this._dndContainer) {
        this._dndContainer.style.display = "flex";
      }
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
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

      // Creation mode: never asked during the tutorial. Normal is applied
      // silently and the wizard moves straight on to the humanoid / creature
      // choice. (Guarded on the switch as well as the in-scene flag, like the
      // origin step below.) Detailed mode is the exception, the tutorial offers
      // it, so the step is shown whenever CharacterCreationFull is loaded.
      if (this._step === STEP.CREATION_MODE && isTutorialFlow() && !detailedModeAvailable()) {
        setCreationMode(CC_MODE.NORMAL);
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

      // Character Type selection is integrated directly into the sidebar toggle.
      // Automatically advance past STEP.CHARACTER_TYPE.
      if (this._step === STEP.CHARACTER_TYPE) {
        this._step++;
        this.setupStep();
        return;
      }

      // Creatures do not meet class selection on the way through: every mode
      // builds them in the full creature scene, which settles their class, and
      // the wizard resumes past it. Asking for it by name is another matter -
      // the Class tab on a creature's dossier used to land here and be bounced
      // straight on to Traits, so the tab did nothing at all.
      if (this._step === STEP.CLASS && Scene_CharacterCreation._isCreatureMode &&
          !this._classStepRequested) {
        this._step++;
        this.setupStep();
        return;
      }

      // Gender & Identity Step: Interactive setup
      if (this._step === STEP.GENDER && Scene_CharacterCreation._tutorialMode) {
        this._step++;
        this.setupStep();
        return;
      }

      // The gender board is gone. A person's gender comes off the sprite they
      // are given (applyIdentityFromSprite) and is changed on the Bio tab
      // afterwards, so this step no longer asks anything: it opens the sprite
      // and name screens and moves on. A creature still owns the slot, where it
      // is the archetype board.
      if (this._step === STEP.GENDER && !this._isCurrentMemberCreature()) {
        this.leaveGenderStep();
        return;
      }

      // Traits Step: Interactive optional selection
      if (this._step === STEP.TRAITS && isTutorial) {
        this._step++;
        this.setupStep();
        return;
      }

      // Personality: nothing to pick from without PersonalityData.json, and the
      // tutorial does not ask (like traits and class). Either way the member
      // keeps the disposition their society profile was rolled with.
      if (this._step === STEP.PERSONALITY &&
          (isTutorial || personalityCatalog().length === 0)) {
        this._step++;
        this.setupStep();
        return;
      }

      // Whatever else the chosen mode hides: the Full-only flavor steps
      // (hometown / birth date) in both board modes, plus Quick's portrait,
      // trait and personality steps, all already settled above.
      if (Scene_CharacterCreation._stepHiddenForMode(this._step)) {
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
      // The character-type step is the starting step for the 2nd/3rd member
      // too, but Back there still has somewhere real to go (the previous
      // member's "add another?" prompt), so it keeps its cancel handler.
      const isLaterMemberTypeStep = this._step === STEP.CHARACTER_TYPE &&
        (Scene_CharacterCreation._currentPartyMemberIndex || 0) > 0;
      if (this._step <= firstStep && !isLaterMemberTypeStep) {
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
      this._classStepRequested = false;
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
      this._classStepRequested = false;
      // Character-type step for the second or third party member: this is
      // where "add_member" landed after adding the actor and jumping ahead,
      // so Back undoes exactly that (drops the actor it just added) and
      // returns to the previous member's "add another?" prompt instead of
      // falling through to the title screen.
      if (this._step === STEP.CHARACTER_TYPE && (Scene_CharacterCreation._currentPartyMemberIndex || 0) > 0) {
        const removedIndex = Scene_CharacterCreation._currentPartyMemberIndex;
        $gameParty.removeActor(removedIndex + 1); // Actor IDs are 1-based
        Scene_CharacterCreation._currentPartyMemberIndex = removedIndex - 1;
        Scene_CharacterCreation._isCreatureMode = false;
        this._step = STEP.ADD_MEMBER;
        this.setupStep();
        return;
      }

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
      // setupStep() would immediately auto-advance past, and every step that
      // asks nothing of its own but hands straight over to another screen (the
      // gender slot of a person, which only opens the sprite and name screens).
      // Otherwise Back lands on a step that jumps forward again, making it a
      // no-op. Never go below the first interactive step.
      const firstStep = Scene_CharacterCreation.getStartingStep();
      this._step--;
      while (this._step > firstStep &&
             (Scene_CharacterCreation._stepAutoAdvances(this._step) ||
              Scene_CharacterCreation._stepHandsOverImmediately(this._step))) {
        this._step--;
      }
      if (this._step < firstStep) this._step = firstStep;
      this.setupStep();
    }
    onGridOk() {
      if (this._refusePresetEdit()) return;
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

    // The chosen origin's own starting-place logic: grants, then puts the
    // party down somewhere. Shared by the origin step's handler (every mode
    // but Full, which runs this immediately) and the hometown step's handler
    // (Full mode, which runs this once a hometown from Destinations.json has
    // been picked).
    _finishOriginChoice(symbol) {
      // Whatever this origin decides below, the party is about to be set down
      // somewhere for the first time. Checked once on arrival, so no origin
      // can begin standing inside the scenery of a square that was generated
      // for it (see the landing pass in Scene_Map.onMapLoaded).
      if ($gameTemp) $gameTemp._ccOriginLanding = true;
      // Finalize the first creation here (end of the flow). This used to live
      // in the settings step, which now runs first, so it moved to the origin
      // step. markFirstCreationComplete is idempotent.
      markFirstCreationComplete();
      // Supplies and gear are handed out here and only here, from the single
      // ORIGIN_LOADOUTS table the "Starting Out" dossier reads, so no branch
      // below can duplicate an item or quietly hand out something unlisted.
      grantOriginLoadout(symbol);
      // Nobody starts unable to play cards. The collector's own branch deals
      // a shelf below; this is the floor everyone else stands on.
      if (symbol !== "origin_card_collector") grantMinimumCards();
      if (symbol === "origin_space") {
        // Begun off Earth: measured from the pad they lifted off from.
        anchorAtSpaceCenter();
        $gamePlayer.reserveTransfer(721, 27, 7, 2, 0);
      } else if (symbol === "origin_camper") {
        startVehicleOrigin("camper");
      } else if (symbol === "origin_car") {
        startVehicleOrigin("car");
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
      } else if (symbol === "origin_card_collector") {
        grantStartingCards();
        // A collector goes where the games are, and that is any city.
        startWorldMapPickerOrigin();
      } else if (symbol === "origin_arcanist") {
        startArcanistOrigin();
      } else if (symbol === "origin_mercenary") {
        startMercenaryOrigin();
      } else if (symbol === "origin_lost_convoker") {
        startLostConvokerOrigin();
      } else if (symbol === "origin_skeleton_key") {
        // Nothing but the key: every door in the world is as good a starting
        // point as any other, so the player says which one.
        startWorldMapPickerOrigin();
      } else if (symbol === "origin_plague") {
        // A carrier goes where the people are, and the case travels with them:
        // the player picks the city the first seal gets broken in.
        startWorldMapPickerOrigin();
      } else if (symbol === "origin_diplomat") {
        startDiplomatOrigin();
      } else if (symbol === "origin_hypernet_explorer") {
        startHypernetExplorerOrigin();
      } else if (symbol === "origin_augmented") {
        grantStartingAugments();
        // Nowhere in particular to be: the clinic is behind them and any
        // city on the map will do.
        startWorldMapPickerOrigin();
      } else if (symbol === "origin_train") {
        // The one origin that really boards the train: the starting service
        // only runs to the three beginner stations, which is the whitelist
        // FastTravelSystem applies to the 'train' network in creation mode.
        if ($gameTemp) {
          $gameTemp._openCharacterCreationTrainTravel = true;
          $gameTemp._characterCreationTravelType = "train";
          $gameTemp._characterCreationTravelMode = true;
        }
      } else {
        // Default: pick any city on the map and land there on foot.
        startWorldMapPickerOrigin();
      }
      // The two faction origins returned above and land through
      // startWorldMapPickerOrigin, which answers this on its own; everything
      // else has just chosen a spot on a planet that is not there.
      if (startsAtOmegaTower()) startAtOmegaTower();
      // This origin put the party down itself instead of ending in the
      // starting place picker, so there is no picker to walk back out of and
      // no copy of the old world worth keeping.
      if (!$gameTemp || !$gameTemp._openCharacterCreationTrainTravel) clearOriginSnapshot();
      this.popScene();
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
      // hasCompletedFirstCreation only flips at the origin step, which is
      // reached once per run (after every party member), so it stays false
      // while building the 2nd/3rd member too. Nothing has been committed
      // yet ONLY while the first member is still being built; from then on a
      // full actor already sits in the party, so Back must never drop the
      // player at the title screen and silently lose it.
      if ((Scene_CharacterCreation._currentPartyMemberIndex || 0) > 0) return false;
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
      Scene_CharacterCreation.clearSubScreens();
      Scene_CharacterCreation._isCreatureMode = false;
      Scene_CharacterCreation._traitsProcessed = false;
      Scene_CharacterCreation._currentPartyMemberIndex = 0;
      Scene_CharacterCreation._lastMemberWasRandom = false;
      Scene_CharacterCreation._tutorialMode = false;
      Scene_CharacterCreation._settingsRowIndex = 0;
      Scene_CharacterCreation._creationMode = null;
      Scene_CharacterCreation._randomizedAllParty = false;
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
      SoundManager.playCancel();
      this.previousStep();
    }

    // What the gender step does once it is finished, whichever way it was
    // reached: a creature is handed to the creature builder, a person to the
    // sprite board and the name prompt. Quick mode never asks the gender
    // question itself , the sprite answers it , but still comes through here,
    // so this is the one place that knows where the wizard goes next.
    leaveGenderStep() {
      if (!Scene_CharacterCreation._isCreatureMode) {
        this.startNamingScreens();
        return;
      }

      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const actorId = currentMemberIndex + 1;

      if (typeof Scene_CreateCreature === 'undefined') {
        console.warn('Scene_CreateCreature not found. Make sure CharacterCreationCreature.js is loaded.');
        // Skip to trait selection (nextStep increments CLASS -> TRAITS)
        this._step = STEP.CLASS;
        this.nextStep();
        return;
      }

      // Both modes open the full creature scene so the whole archetype roster
      // is available (single screen: pick one archetype or two for a hybrid);
      // Quick mode simply asks less of it once the archetypes are settled.
      //
      // Save the step to resume at after creature creation (trait selection).
      // interruptedStep + 1 is the resume step, so CLASS resumes on TRAITS.
      Scene_CharacterCreation._interruptedStep = STEP.CLASS;
      Scene_CharacterCreation._resumeOnStep = false;
      if (Scene_CreateCreature.setTargetActorId) {
        Scene_CreateCreature.setTargetActorId(actorId);
      }
      this.closeStepUI();
      SceneManager.push(Scene_CreateCreature);
    }

    // Naming a person: a suggested name off the Markov generator, the sprite
    // board, then the name prompt with that suggestion already in it. This was
    // common event 97; see the sub-screen block on Scene_CharacterCreation for
    // why it no longer is.
    startNamingScreens() {
      const actorId = Scene_CharacterCreation.getCurrentActorId();

      AudioManager.playSe(CREATION_PAGE_TURN_SE);
      $gameParty.gainGold(CREATION_START_GOLD);
      $gameSwitches.setValue(SWITCH_CREATION_NAMED, true);
      // The suggestion has to exist before the prompt opens, so it is generated
      // here rather than between the two screens. Aimed at the member actually
      // being built: the event could only ever name actor 1, which is why it
      // needed the interpreter hooks that used to sit at the bottom of this file.
      PluginManager.callCommand(this, CREATION_NAME_MARKOV.plugin, CREATION_NAME_MARKOV.command,
        Object.assign({ actorId: String(actorId) }, CREATION_NAME_MARKOV.args));

      this.closeStepUI();

      const screens = ["sprite"];
      if (!$gameSwitches.value(SWITCH_TUTORIAL)) screens.push("name");
      if (!Scene_CharacterCreation.openSubScreens(this._step, screens)) {
        // Neither screen is loaded: nothing to wait for, so carry straight on
        // and put the board back, since nothing is taking the screen after all.
        Scene_CharacterCreation._interruptedStep = -1;
        this.reopenStepUI();
        this.nextStep();
      }
    }

    // Put the step's UI away before handing the screen to something else, so
    // the wizard's windows and overlay cannot show through or eat input. The
    // flag also stops createUIOverlay/refreshUIOverlayDOM painting a board that
    // is about to be replaced, for the case where the handover happens during
    // setupStep(), i.e. before the overlay has been built at all.
    closeStepUI() {
      this._ccHandingOver = true;
      if (this._dndContainer) this._dndContainer.style.display = "none";
      this.hideUI();
      if (this._titleWindow) {
        this._titleWindow.deactivate();
        this._titleWindow.close();
      }
      if (this._gridWindow) {
        this._gridWindow.deactivate();
        this._gridWindow.close();
      }
    }

    // Undo closeStepUI for the rare case where the hand-over did not happen
    // after all, so the step it was leaving stays usable.
    reopenStepUI() {
      this._ccHandingOver = false;
      if (this._dndContainer) this._dndContainer.style.display = "flex";
      if (this._titleWindow) this._titleWindow.open();
      if (this._gridWindow) this._gridWindow.open();
      this.showUI();
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
    _randomizeMemberCharacter(currentMemberIndex, options = {}) {
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

      // Randomly decide: regular character (forceHumanoid forces regular)
      const isCreature = options.forceHumanoid ? false : (Math.random() < 0.2);

      if (isCreature) {
        // Set up as creature
        $gameSwitches.setValue(creatureSwitchId, true);
        Scene_CharacterCreation._isCreatureMode = true;
        currentActor._isCreatureActor = true;
        currentActor.changeClass(65, false);
      } else {
        // Set up as regular character
        $gameSwitches.setValue(creatureSwitchId, false);
        Scene_CharacterCreation._isCreatureMode = false;
        currentActor._isCreatureActor = false;

        // Random class selection, out of the sentient roster alone (1-62): the
        // creature classes above it belong to a creature's archetypes.
        const validClasses = (window.CreatureClasses && window.CreatureClasses.sentientRoster)
          ? window.CreatureClasses.sentientRoster()
          : [1, 2, 3, 4, 5, 6, 7, 8];
        if (validClasses.length > 0) {
          const randomClass = { id: validClasses[Math.floor(Math.random() * validClasses.length)] };
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
        const traitBank = (window.Health && window.Health.Traits && window.Health.Traits.length > 0)
          ? window.Health.Traits
          : ((window.HealthCore && window.HealthCore.Traits) || [
            { id: "claustrophobic", name: "Claustrophobic", cost: -3 },
            { id: "genius", name: "Genius", cost: 3 },
            { id: "athletic", name: "Athletic", cost: 5 },
            { id: "lucky", name: "Lucky", cost: 3 },
            { id: "paranoid", name: "Paranoid", cost: -1 }
          ]);
        const picked = [];
        const drawbacks = traitBank.filter((t) => (Number(t.cost) || 1) < 0 && t.category !== "genetic");
        const positives = traitBank.filter((t) => (Number(t.cost) || 1) >= 0 && t.category !== "genetic");
        if (drawbacks.length > 0) {
          picked.push(drawbacks[Math.floor(Math.random() * drawbacks.length)].id);
        }
        for (let i = 0; i < 2 && positives.length > 0; i++) {
          const p = positives[Math.floor(Math.random() * positives.length)];
          if (p && !picked.includes(p.id)) picked.push(p.id);
        }
        currentActor._selectedTraits = picked;
        if (typeof applyTraitsToActor === 'function') {
          applyTraitsToActor(currentActor, picked);
        }
      }

      // Random Specializations (Allocate 12 budget points across catalog)
      const specCatalog = this._specsCatalog ? this._specsCatalog() : ((window.Specializations && window.Specializations.list) || []);
      currentActor._specTrained = {};
      if (Array.isArray(specCatalog) && specCatalog.length > 0) {
        // The class and the traits were rolled a moment ago, so their head
        // starts are read now and the budget is spent strictly on top of them.
        const specGrantCtx = this._specGrantContext ? this._specGrantContext(currentActor) : null;
        let specRemaining = CC_SPEC_BUDGET;
        let attempts = 0;
        while (specRemaining > 0 && attempts < 400) {
          attempts++;
          const spec = specCatalog[Math.floor(Math.random() * specCatalog.length)];
          if (!spec) continue;
          const floor = specGrantCtx ? this._specGrantRankIn(specGrantCtx, spec) : 0;
          const currentRank = Math.max(currentActor._specTrained[spec.id] || 0, floor);
          if (currentRank < 4) {
            const add = Math.min(specRemaining, 4 - currentRank, Math.floor(Math.random() * 2) + 1);
            currentActor._specTrained[spec.id] = currentRank + add;
            specRemaining -= add;
          }
        }
        currentActor._specPointsSpent = CC_SPEC_BUDGET - specRemaining;
      }

      // Random Bio & Ideology
      currentActor._bioSet = true;
      const allIdeologies = (window.NPCShared && window.NPCShared.ideologyList && window.NPCShared.ideologyList()) || [];
      const coreIdeologies = ["techno_monism", "neo_feudalism", "cyber_anarchism", "transhumanism", "pragmatist", "democratic_socialist", "high_frequency_trader"];
      const idPool = allIdeologies.length > 0 ? allIdeologies.map(i => i.id || i) : coreIdeologies;
      currentActor._ideologyId = idPool[Math.floor(Math.random() * idPool.length)];
      if (window.NPCSociety && window.NPCSociety.getActorProfile) {
        const prof = window.NPCSociety.getActorProfile(currentActor.actorId());
        if (prof) prof.ideologyId = currentActor._ideologyId;
      }

      currentActor._morality = Math.floor(Math.random() * 5) - 2;

      const hometowns = (window.WorkSystem && window.WorkSystem.Destinations)
        ? Object.keys(window.WorkSystem.Destinations)
        : ["Paris", "Tokyo", "Neo-Cairo", "Brussels", "Berlin", "London", "Rome", "New York", "Geneva", "Athens"];
      $gameSystem._ccHometown = hometowns[Math.floor(Math.random() * hometowns.length)];

      if (!$gameSystem._ccBirthAge) $gameSystem._ccBirthAge = [];
      $gameSystem._ccBirthAge[currentMemberIndex] = 18 + Math.floor(Math.random() * 52);

      currentActor._wealthTier = Math.floor(Math.random() * 4);

      // A body as well as a life, exactly as the Bio tab's own randomizer does.
      const reproRoll = ccReproChoices();
      const CCU_random = window.CharacterCreationUtils;
      const rolledRepro = reproRoll[Math.floor(Math.random() * reproRoll.length)].val;
      if (CCU_random && CCU_random.setReproductionType) CCU_random.setReproductionType(currentMemberIndex, rolledRepro);
      else $gameVariables.setValue([87, 115, 116][currentMemberIndex] || 87, rolledRepro);
      if (currentActor.setHormoneBalance) currentActor.setHormoneBalance(Math.floor(Math.random() * 101));

      const bloodList = (window.BloodTypeService && window.BloodTypeService.list && window.BloodTypeService.list()) || [];
      if (bloodList.length > 0) {
        const pickedBlood = bloodList[Math.floor(Math.random() * bloodList.length)];
        currentActor._ccBloodType = pickedBlood.id;
        currentActor._bloodType = pickedBlood.type || pickedBlood.id;
        if (window.BloodTypeService && window.BloodTypeService.setForActor) {
          window.BloodTypeService.setForActor(currentActor, pickedBlood.id);
        }
      } else {
        const bloodTypes = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "Synthetic-Δ", "Azure (Hemocyanin)"];
        currentActor._bloodType = bloodTypes[Math.floor(Math.random() * bloodTypes.length)];
      }

      // Random Job & Job Items
      const allJobs = (window.WorkSystem && window.WorkSystem.Jobs) || [];
      if (allJobs.length > 0) {
        const randomJob = allJobs[Math.floor(Math.random() * allJobs.length)];
        currentActor._jobId = randomJob.id;
        if (Array.isArray(randomJob.items) && $gameParty) {
          if (currentActor._grantedJobItemIds) {
            currentActor._grantedJobItemIds.forEach(id => {
              if (typeof $dataItems !== 'undefined' && $dataItems[id]) {
                if (typeof $gameParty.loseItem === 'function') {
                  $gameParty.loseItem($dataItems[id], 1);
                } else if (typeof $gameParty.gainItem === 'function') {
                  $gameParty.gainItem($dataItems[id], -1);
                }
              }
            });
          }
          currentActor._grantedJobItemIds = [...randomJob.items];
          randomJob.items.forEach(id => {
            if (typeof $dataItems !== 'undefined' && $dataItems[id]) {
              $gameParty.gainItem($dataItems[id], 1);
            }
          });
        }
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
      if (this.updateTopRailInput()) return;
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
      } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
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

      // The rail comes first, so the shoulder buttons reach the party tabs from
      // any page. The one exception is the dossier board, whose own shoulder
      // buttons leaf a preset through its alternate looks.
      if (!this._presetWindow && this.updateTopRailInput()) return;

      const isPreset = !!this._presetWindow;
      const windowObj = isPreset ? this._presetWindow : this._gridWindow;
      if (!windowObj || !windowObj.active) return;

      const maxItems = windowObj.maxItems();
      if (maxItems <= 0) {
        // Nothing to move between, but Back must still work: an empty preset
        // board would otherwise trap the player with no way out.
        if ((Input.isTriggered('cancel') || TouchInput.isCancelled()) && isPreset) {
          SoundManager.playCancel();
          this.onPresetCancel();
        }
        return;
      }

      // Dossiers that were drawn more than once can be leafed through into
      // their other looks without leaving the card. The shoulder buttons do it
      // both ways; TAB steps forward, and is the button the chip under the
      // thumbnails names on a keyboard. Shift still works, for the builds that
      // taught it (W is remapped to "up" game-wide, so it is not free).
      if (isPreset && windowObj.cycleSkin) {
        if (Input.isTriggered('pagedown') || Input.isTriggered('tab') ||
            Input.isTriggered('shift')) {
          windowObj.cycleSkin(1);
          return;
        }
        if (Input.isTriggered('pageup')) {
          windowObj.cycleSkin(-1);
          return;
        }
      }

      // A pad can be plugged in, or run out of battery, while the board is
      // open, so the chip that names the look button is kept in step.
      if (isPreset) this.syncSkinKeyChip();

      // The category rail above the grid, walked with the same stick.
      if (this.updatePageRailInput(windowObj)) return;

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
      } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
        // ESC, the pad's B/Circle, and a RIGHT-CLICK anywhere on the page all
        // mean the same thing here: one step back. The right button used to be
        // read by nobody (the grid window's processTouch is stubbed out so the
        // DOM cards can own the mouse), so it fell through to RMMZ's default
        // handling and was as likely to confirm the highlighted card as to do
        // nothing - which is how backing out could walk the wizard FORWARD.
        const firstStep = Scene_CharacterCreation.getStartingStep();
        const isLaterMemberTypeStep = this._step === STEP.CHARACTER_TYPE &&
          (Scene_CharacterCreation._currentPartyMemberIndex || 0) > 0;
        if (isPreset) {
          SoundManager.playCancel();
          this.onPresetCancel();
        } else if (this._step > firstStep || isLaterMemberTypeStep) {
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

    update() {
      super.update();

      // A relay instance has no UI and is replaced on the next frame; a scene
      // that has handed over is on its way out and its board is already down.
      // Either way there is nothing to draw and no input of ours to read - the
      // frames between a hand-over and the scene change are exactly where a
      // stale board would flash back up and eat the next screen's first click.
      if (this._isSubScreenRelay || this._ccHandingOver) return;

      if (this._dndContainer) {
        this._dndContainer.style.display = "flex";
        this.updateUIInput();
        if (window.CCScroll) window.CCScroll.update(this._dndContainer);
        this.refreshUIOverlayDOM();
        this.updateEmRestlessBubble();
      }
    }

    // Em's card starts heckling the player once her dossier has sat unpicked
    // on the board for EM_RESTLESS_DELAY_MS, and again every
    // EM_RESTLESS_INTERVAL_MS after that. The clock is kept here rather than
    // stamped once when the board opens, so re-entering preset mode (Cancel
    // then back in) always gives her the same ten seconds of patience.
    updateEmRestlessBubble() {
      const bubble = window.EmRestlessBubble;
      if (!bubble) return;
      if (!this._presetWindow || this._presetApplied) {
        bubble.release();
        this._emBoardOpenedAt = 0;
        this._emBubbleNextAt = 0;
        return;
      }
      if (!this._emBoardOpenedAt) this._emBoardOpenedAt = Date.now();
      bubble.update();

      const now = Date.now();
      if (now - this._emBoardOpenedAt < EM_RESTLESS_DELAY_MS) return;
      if (this._emBubbleNextAt && now < this._emBubbleNextAt) return;
      if (typeof getEmRestlessLine !== "function" || !this._dndContainer) return;

      const presets = availablePresets();
      const emIndex = presets.findIndex((p) => p && p.name === "Em");
      if (emIndex === -1) return; // not on the board this world (already played, or not this preset set)
      const card = this._dndContainer.querySelectorAll(".cc-page-left .cc-presets-board .cc-wanted-card")[emIndex];
      if (!card) return;

      this._emBubbleLastLine = getEmRestlessLine(this._emBubbleLastLine);
      bubble.show(card, this._emBubbleLastLine);
      this._emBubbleNextAt = now + EM_RESTLESS_INTERVAL_MS;
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
      // The board modes' class/creature picker renders as a two-column grid, so
      // the selection cursor must move in two columns too (left/right +
      // up/down).
      const sc = this._scene;
      if (sc && sc._step === STEP.CLASS &&
          Scene_CharacterCreation.usesQuickFlow()) {
        return 2;
      }
      // The origin step renders three across (cc-three-col), so the cursor has
      // to move in three columns or left/right would do nothing and up/down
      // would skip two entries at a time. The personality list is laid out the
      // same way, and only while it actually renders as the picker.
      if (sc && sc._step === STEP.ORIGIN) {
        return 3;
      }
      if (sc && sc._isPersonalityPickerStep && sc._isPersonalityPickerStep()) {
        return 3;
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

  //=============================================================================
  // Tutorial controls legend
  //=============================================================================
  // Shown once, right after the tutorial's own preset pick ends character
  // creation: a top-right, black-backed window naming every core control
  // together with its keyboard/mouse/controller equivalents. Each row lights
  // gold the first time the player actually exercises that control (any
  // device counts, since RPG Maker MZ's Input already merges keyboard and
  // gamepad presses onto the same symbol); once every row has lit, the
  // window closes itself and is never shown again for this save.

  const TUTORIAL_CONTROLS = [
    { id: "up", labelKey: "CharCreate.controls.up", key: "↑" },
    { id: "down", labelKey: "CharCreate.controls.down", key: "↓" },
    { id: "left", labelKey: "CharCreate.controls.left", key: "←" },
    { id: "right", labelKey: "CharCreate.controls.right", key: "→" },
    { id: "ok", labelKey: "CharCreate.controls.action", key: "Z / Enter", mouseKey: "CharCreate.controls.leftClick", pad: "A" },
    { id: "cancel", labelKey: "CharCreate.controls.back", key: "X / Esc", mouseKey: "CharCreate.controls.rightClick", pad: "B" },
    { id: "shift", labelKey: "CharCreate.controls.run", keyKey: "CharCreate.controls.holdShift", pad: "X" },
    { id: "menu", labelKey: "CharCreate.controls.menu", key: "Esc", pad: "Y" },
    { id: "mapSheet", labelKey: "CharCreate.controls.openMap", key: "M" },
    { id: "hotbar", labelKey: "CharCreate.controls.hotbarCycle", key: "Tab", pad: "L1 / R1" },
  ];

  // The world map (315) answers to two controls no other map has: T / Select
  // stops the journey and walks the party into whatever stands on the square
  // they are on (WorldMapReturn's wmrToggle), and the triggers pull the camera
  // in and out (MousePan's zoom, which is confined to that one sheet). They are
  // listed under the core rows while the party is out there, and they keep
  // their own "already used once" record, so the legend can finish on the world
  // map long after the walking rows were learnt indoors.
  const WORLD_MAP_LEGEND_MAP_ID = 315;

  const WORLD_MAP_CONTROLS = [
    { id: "visitPlace", labelKey: "CharCreate.controls.visitPlace", key: "T", pad: "Select" },
    { id: "worldZoom", labelKey: "CharCreate.controls.zoom", key: "+ / -", pad: "L2 / R2" },
  ];

  function isWorldMapControl(id) {
    return WORLD_MAP_CONTROLS.some((entry) => entry.id === id);
  }

  // Which rows of a merged lit-record belong to one list, so each list keeps
  // its own record and neither can close the other.
  function litSubset(lit, entries) {
    const out = {};
    for (const entry of entries) if (lit[entry.id]) out[entry.id] = true;
    return out;
  }

  // Arms the legend for the map the tutorial just finished on. Idempotent
  // against a save that has already finished it, so re-running the tutorial
  // plugin command (or picking a second tutorial dossier, if that ever
  // becomes possible) never brings it back.
  function beginTutorialControlsLegend() {
    if (!$gameSystem || $gameSystem._tutorialControlsLegendSeen) return;
    $gameSystem._tutorialControlsLegendActive = true;
    $gameSystem._tutorialControlsLit = {};
  }

  function coreLegendVisible() {
    return !!($gameSystem && $gameSystem._tutorialControlsLegendActive &&
      !$gameSystem._tutorialControlsLegendSeen);
  }

  // The world map rows stand on their own: standing on map 315 is enough to
  // show them, whether or not the party ever went through the tutorial, and
  // they are gone for good once both have been used once.
  function worldLegendVisible() {
    if (!$gameSystem || !$gameMap) return false;
    if ($gameSystem._worldMapControlsSeen) return false;
    return $gameMap.mapId() === WORLD_MAP_LEGEND_MAP_ID;
  }

  class Window_TutorialControls extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      // No parchment skin: a plain black panel is painted in refresh() instead.
      this.opacity = 0;
      this._lit = Object.assign(
        {},
        ($gameSystem && $gameSystem._tutorialControlsLit) || {},
        ($gameSystem && $gameSystem._worldMapControlsLit) || {}
      );
      this.refresh();
    }

    static rowHeight() {
      return 26;
    }

    static windowWidth() {
      return 360;
    }

    static windowHeight() {
      const rows = TUTORIAL_CONTROLS.length + WORLD_MAP_CONTROLS.length;
      return rows * Window_TutorialControls.rowHeight() + 32;
    }

    // The rows on show right now: the core list until it is done with, plus the
    // world map pair whenever the party is standing on the world map.
    entries() {
      const rows = [];
      if (coreLegendVisible()) rows.push(...TUTORIAL_CONTROLS);
      if (worldLegendVisible()) rows.push(...WORLD_MAP_CONTROLS);
      return rows;
    }

    isLit(id) {
      return !!this._lit[id];
    }

    // Lights one row if it wasn't already lit, persisting the change so a
    // save/reload resumes with the same rows lit. Returns true on a real change.
    markLit(id) {
      if (this._lit[id]) return false;
      this._lit[id] = true;
      if ($gameSystem) {
        $gameSystem._tutorialControlsLit = litSubset(this._lit, TUTORIAL_CONTROLS);
        $gameSystem._worldMapControlsLit = litSubset(this._lit, WORLD_MAP_CONTROLS);
      }
      SoundManager.playCursor();
      this.refresh();
      return true;
    }

    isListComplete(entries) {
      return entries.every((entry) => this._lit[entry.id]);
    }

    isComplete() {
      return this.isListComplete(TUTORIAL_CONTROLS);
    }

    rowText(entry) {
      const key = entry.key || (entry.keyKey ? T(entry.keyKey) : "");
      const mouse = entry.mouseKey ? T(entry.mouseKey) : "";
      const pad = entry.pad || "";
      return [key, mouse, pad].filter(Boolean).join(" / ");
    }

    refresh() {
      if (!this.contents) return;
      this.contents.clear();
      const rows = this.entries();
      if (!rows.length) return;
      const rh = Window_TutorialControls.rowHeight();
      this.contents.fillRect(0, 0, this.innerWidth, rows.length * rh + 12, "rgba(0, 0, 0, 0.82)");
      this.contents.fontSize = 16;
      let y = 6;
      for (const entry of rows) {
        const lit = !!this._lit[entry.id];
        this.changeTextColor(lit ? "#ffd700" : "#ffffff");
        const label = T(entry.labelKey);
        this.drawText(`${label}: ${this.rowText(entry)}`, 8, y, this.innerWidth - 16, "left");
        y += rh;
      }
    }
  }

  const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
  Scene_Map.prototype.createAllWindows = function () {
    _Scene_Map_createAllWindows.call(this);
    this.createTutorialControlsWindow();
  };

  Scene_Map.prototype.createTutorialControlsWindow = function () {
    if (!coreLegendVisible() && !worldLegendVisible()) return;
    const width = Window_TutorialControls.windowWidth();
    const height = Window_TutorialControls.windowHeight();
    const rect = new Rectangle(Graphics.boxWidth - width - 16, 16, width, height);
    this._tutorialControlsWindow = new Window_TutorialControls(rect);
    this.addWindow(this._tutorialControlsWindow);
  };

  // The camera zoom is not a button press: the wheel, the +/- keys and the
  // triggers all end up moving Game_Screen's scale, so the legend watches the
  // scale itself and counts any change made on the world map as the control
  // having been used.
  let lastLegendZoom = null;

  function zoomControlUsed() {
    const zoom = $gameScreen ? $gameScreen.zoomScale() : 1;
    const moved = lastLegendZoom !== null && Math.abs(zoom - lastLegendZoom) > 0.0005;
    lastLegendZoom = zoom;
    if (moved) return true;
    return !!(Input.isRepeated("mapZoomIn") || Input.isRepeated("mapZoomOut") ||
      Input.isRepeated("zoomIn") || Input.isRepeated("zoomOut"));
  }

  const _Scene_Map_update_tutorialControls = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update_tutorialControls.call(this);
    this.updateTutorialControlsWindow();
  };

  Scene_Map.prototype.updateTutorialControlsWindow = function () {
    const win = this._tutorialControlsWindow;
    if (!win) return;

    if (coreLegendVisible()) {
      if (Input.isTriggered("up")) win.markLit("up");
      if (Input.isTriggered("down")) win.markLit("down");
      if (Input.isTriggered("left")) win.markLit("left");
      if (Input.isTriggered("right")) win.markLit("right");
      if (Input.isTriggered("ok") || TouchInput.isTriggered()) win.markLit("ok");
      if (Input.isTriggered("escape") || TouchInput.isCancelled()) {
        win.markLit("cancel");
        win.markLit("menu");
      }
      if (Input.isTriggered("menu")) win.markLit("menu");
      if (Input.isPressed("shift")) win.markLit("shift");
      // The map sheet (WorldMap.js, M) and the item bar's L1/R1 step
      // (ItemSystemHotbar.js, pageup/pagedown) are read under their own
      // symbols, so a rebind still lights the row.
      if (Input.isTriggered("world_map_toggle")) win.markLit("mapSheet");
      if (Input.isTriggered("pageup") || Input.isTriggered("pagedown") || Input.isTriggered("tab")) win.markLit("hotbar");
    }

    const onWorldMap = worldLegendVisible();
    if (onWorldMap) {
      if (Input.isTriggered("wmrToggle")) win.markLit("visitPlace");
      if (zoomControlUsed()) win.markLit("worldZoom");
    } else {
      lastLegendZoom = null;
    }

    if (coreLegendVisible() && win.isListComplete(TUTORIAL_CONTROLS) && $gameSystem) {
      $gameSystem._tutorialControlsLegendSeen = true;
      $gameSystem._tutorialControlsLegendActive = false;
      win.refresh();
    }
    if (onWorldMap && win.isListComplete(WORLD_MAP_CONTROLS) && $gameSystem) {
      $gameSystem._worldMapControlsSeen = true;
      win.refresh();
    }

    if (!coreLegendVisible() && !worldLegendVisible()) {
      this._windowLayer.removeChild(win);
      win.destroy();
      this._tutorialControlsWindow = null;
    }
  };

  // The heaviest thing any step opens is the sprite board: it builds its sheet
  // list and scans img/busts (hundreds of files) the first time it is entered.
  // Both are cached for the session, so doing it here - while the player is
  // still reading the first page of the wizard - means the sprite step has
  // nothing left to wait for. (The old call here was to preloadBustData, a
  // function no plugin has defined for a long time.)
  function warmCreationAssets() {
    if (window.SpriteBoard && window.SpriteBoard.warm) window.SpriteBoard.warm();
    else if (window.BustGallery && window.BustGallery.load) window.BustGallery.load();
  }

  // Plugin Commands
  PluginManager.registerCommand(pluginName, "characterCreation", () => {
    warmCreationAssets();
    // A brand new party: nothing of a previous run's hand-over is still owed.
    Scene_CharacterCreation._interruptedStep = -1;
    Scene_CharacterCreation.clearSubScreens();

    // Tutorial mode: Switch 100 ON and player is on map 1414
    const isTutorial = $gameSwitches.value(100) && $gameMap.mapId() === 1414;
    Scene_CharacterCreation._tutorialMode = isTutorial;
    Scene_CharacterCreation._currentPartyMemberIndex = 0;
    Scene_CharacterCreation._railFocus = null;
    // A new party is dealt a new kit: the origins that roll their loadout hold
    // one seed for the whole run, so the board never reshuffles under the
    // player, and the next run rolls again.
    resetOriginRoll();
    // Pick up any previously chosen mode (subsequent creations skip the
    // mode step via showOnlyOnce); null means the mode step will set it.
    // Detailed is never carried over: the mode step is silenced once a
    // savegame has built a party, so a carried-over Detailed would lock every
    // later party into the editor with no board and no way back.
    const carriedMode = storedCreationMode();
    Scene_CharacterCreation._creationMode =
      (carriedMode === CC_MODE.DETAILED ? null : carriedMode) || null;

    const startStep = Scene_CharacterCreation.getStartingStep();
    Scene_CharacterCreation.prepare(startStep);

    // Set the current actor's initial class to 1 at the start
    const actor = Scene_CharacterCreation.getCurrentActor();
    if (actor) {
      actor.changeClass(1, false);
    }

    SceneManager.push(Scene_CharacterCreation);
  });

  // Where a reprise picks the flow back up: one step past the one that was
  // interrupted, or back on the last real question before it when the screen in
  // between was backed out of rather than confirmed (see cancelSubScreens).
  // Consumes both markers.
  function resumeStepAfterInterrupt() {
    const SC = Scene_CharacterCreation;
    const step = SC._resumeOnStep
      ? SC.backLandingStep(SC._interruptedStep)
      : SC._interruptedStep + 1;
    SC._interruptedStep = -1;
    // A reprise re-enters the wizard from outside, so whatever chain was open
    // is over whether or not it ran to the end.
    SC.clearSubScreens();
    return step;
  }

  PluginManager.registerCommand(pluginName, "repriseCreation", () => {
    let startStep;

    if (Scene_CharacterCreation._interruptedStep >= 0) {
      startStep = resumeStepAfterInterrupt();
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
      storedCreationMode() || Scene_CharacterCreation._creationMode;
    Scene_CharacterCreation.prepare(startStep);
    SceneManager.push(Scene_CharacterCreation);
  });

  PluginManager.registerCommand(pluginName, "repriseCreationCreature", () => {
    Scene_CharacterCreation._creationMode =
      storedCreationMode() || Scene_CharacterCreation._creationMode;

    // The board modes have no separate creature reprise: fall back to a plain
    // humanoid one so the flow can never strand the player in a disabled
    // creature path.
    if (Scene_CharacterCreation.usesQuickFlow()) {
      let startStep = Scene_CharacterCreation._interruptedStep >= 0
        ? resumeStepAfterInterrupt()
        : STEP.CLASS;
      while (startStep < CharacterCreationData.length) {
        const stepData = CharacterCreationData[startStep];
        if (stepData.showOnlyOnce && isStepCompleted(startStep)) {
          startStep++;
        } else {
          break;
        }
      }
      Scene_CharacterCreation._isCreatureMode = false;
      Scene_CharacterCreation.clearSubScreens();
      Scene_CharacterCreation.prepare(startStep);
      SceneManager.push(Scene_CharacterCreation);
      return;
    }

    let startStep;

    if (Scene_CharacterCreation._interruptedStep >= 0) {
      startStep = resumeStepAfterInterrupt();
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

  // The naming step used to be an event, and an event's actor id is a fixed 1:
  // the Markov generator wrote its suggestion onto actor 1 and the Name Input
  // that followed edited actor 1, so two Game_Interpreter hooks used to sit
  // here rewriting both to point at the member actually being built. The wizard
  // opens those screens itself now (startNamingScreens), aimed at the right
  // actor to begin with, so the hooks are gone with the event.

  // ==========================================================================
  // Battle Test: auto-build a random, slightly under-levelled party
  //
  // Whenever a Battle Test is launched from the editor with exactly three test
  // battlers, the test party is replaced with 3 members that have random
  // classes, genders, equipment and traits (any other party size is left
  // untouched, so a deliberately hand-built roster still runs as configured).
  // Levels are derived from the troop's enemy <Level: N> notes and kept below
  // the enemy median, so the party median level is always lower than the
  // troop's (the enemies stay the tougher side of the test).
  // ==========================================================================

  const BATTLE_TEST_TRIGGER_NAME = "test"; // matched case-insensitively
  const BATTLE_TEST_PARTY_SIZE = 3; // the only test party size that gets randomized

  // The actor ids the battle-test party is made of, but only when it holds
  // exactly BATTLE_TEST_PARTY_SIZE members; null otherwise.
  function battleTestPartyActorIds() {
    if (typeof $gameParty === "undefined" || !$gameParty) return null;
    const ids = ($gameParty._actors || []).slice();
    return ids.length === BATTLE_TEST_PARTY_SIZE ? ids : null;
  }

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

  // True when Actor 1's database name is the battle-test trigger. Checked off
  // $dataActors directly (not $gameActors) so it can run before createGameObjects,
  // while the raw test troop data is still safe to rewrite in place.
  function isBattleTestTriggerActor() {
    const a1 = typeof $dataActors !== "undefined" && $dataActors[1];
    return !!(a1 && a1.name && a1.name.trim().toLowerCase() === BATTLE_TEST_TRIGGER_NAME);
  }

  // <Level: N> off a single enemy's note, or null.
  function enemyNoteLevel(enemyData) {
    if (!enemyData || !enemyData.note) return null;
    const m = enemyData.note.match(/<Level:\s*(\d+)>/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function isBossEnemyData(enemyData) {
    return !!(enemyData && enemyData.note && /<Boss>/i.test(enemyData.note));
  }

  // A flanking enemy for the test troop: never a boss or a database divider
  // row, biased toward whatever level is closest to the center enemy's own
  // (widening the search band until something qualifies).
  function pickFlankingEnemyId(centerLevel) {
    const pool = [];
    for (let id = 1; id < $dataEnemies.length; id++) {
      const e = $dataEnemies[id];
      if (!e || !e.name || e.name.trim().startsWith("<--")) continue;
      if (isBossEnemyData(e)) continue;
      pool.push(e);
    }
    if (pool.length === 0) return null;
    if (centerLevel == null) return pool[Math.floor(Math.random() * pool.length)].id;
    let candidates = [];
    for (let band = 2; candidates.length === 0 && band <= 20; band += 2) {
      candidates = pool.filter((e) => {
        const lvl = enemyNoteLevel(e);
        return lvl != null && Math.abs(lvl - centerLevel) <= band;
      });
    }
    if (candidates.length === 0) candidates = pool;
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }

  // Same even-spread-across-the-screen layout the map battle system's own
  // troop reinforcement uses (BattleSystemEnhancedEncounters.js's
  // joinerPosition), so a reinforced test troop looks like any other multi
  // enemy fight instead of enemies stacked on one spot.
  function reinforcementPosition(slot, totalMembers) {
    const w = (typeof Graphics !== "undefined" && Graphics.boxWidth) || 816;
    const h = (typeof Graphics !== "undefined" && Graphics.boxHeight) || 624;
    const cy = h * 0.5;
    const usable = w * 0.8;
    const pitch = totalMembers > 1 ? usable / (totalMembers - 1) : 0;
    const startX = (w - usable) / 2;
    const x = totalMembers > 1 ? startX + slot * pitch : w / 2;
    const y = cy + (slot % 2 === 0 ? -28 : 28);
    return {
      x: Math.max(64, Math.min(w - 64, Math.round(x))),
      y: Math.max(120, Math.min(h - 80, Math.round(y))),
    };
  }

  // Battle Test: turn the editor's single test-troop enemy into a small group.
  //
  // Runs before the vanilla setup (which reads $dataTroops[testTroopId] to
  // build $gameTroop), so the extra members go through the exact same troop
  // setup pipeline as the original one - no bypassed per-enemy plugin hooks.
  // The original enemy stays the "center" of the group (the middle slot when
  // there are 3); the rest are drawn from other <Level: N> enemies close to
  // its own level. An enemy tagged <Boss> is left fighting alone, same as it
  // would be encountered for real.
  function reinforceTestTroopMembers() {
    const troopId = $dataSystem.testTroopId;
    const troop = $dataTroops[troopId];
    // Only a troop set up as a single enemy is a "test this one monster" case;
    // a tester who already built a multi-enemy test troop by hand is left alone.
    if (!troop || !Array.isArray(troop.members) || troop.members.length !== 1) return;
    if (troop._testReinforced) return;

    const center = troop.members[0];
    const centerData = $dataEnemies[center.enemyId];
    if (!centerData || isBossEnemyData(centerData)) return;

    const totalCount = Math.random() < 0.5 ? 2 : 3;
    const centerLevel = enemyNoteLevel(centerData);
    const centerSlot = totalCount === 3 ? 1 : 0;

    const members = [];
    for (let slot = 0; slot < totalCount; slot++) {
      const pos = reinforcementPosition(slot, totalCount);
      const enemyId =
        slot === centerSlot ? center.enemyId : pickFlankingEnemyId(centerLevel) || center.enemyId;
      members.push({ enemyId, x: pos.x, y: pos.y, hidden: false });
    }

    troop.members = members;
    troop._testReinforced = true;
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
    // Aliens are never in the ordinary pool: the catalogue deals one on its own
    // share of the same draw, so a rolled character can turn out not to be from
    // here, exactly as rarely as a rolled citizen can.
    let charName = window.SpriteCatalog
      ? window.SpriteCatalog.pickNpcKey(Math.random())
      : null;
    if (!charName) {
      const keys = Object.keys(npcData).filter((k) => npcData[k] && npcData[k].npc === true && npcData[k].vip !== true);
      if (keys.length === 0) return null;
      charName = keys[Math.floor(Math.random() * keys.length)];
    }
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

    // Random class out of the sentient roster (1-62); the creature classes are
    // never dealt to a person.
    let classId = actor._classId;
    const validClasses = window.CreatureClasses.sentientRoster();
    if (validClasses.length > 0) {
      classId = validClasses[Math.floor(Math.random() * validClasses.length)];
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

  function setupRandomBattleTestParty(actorIds) {
    const enemyMedian = getTroopMedianEnemyLevel() || 10;
    // Cap so every member is strictly below the enemy median (floored at 1),
    // which keeps the party's median level under the troop's.
    const cap = Math.max(1, enemyMedian - 1);
    const baseLevel = Math.max(1, enemyMedian - 2);
    // Whoever the editor put in the test party keeps their slot; only what
    // they are made of is rerolled.
    const ids =
      actorIds && actorIds.length === BATTLE_TEST_PARTY_SIZE ? actorIds.slice() : [1, 2, 3];

    // Rebuild the party as exactly those 3 members.
    for (const id of $gameParty._actors.slice()) {
      $gameParty.removeActor(id);
    }
    for (let i = 0; i < ids.length; i++) {
      const actorId = ids[i];
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
    try {
      if (isBattleTestTriggerActor()) reinforceTestTroopMembers();
    } catch (e) {
      console.error("[BattleTest] Failed to reinforce test troop:", e);
    }
    _DataManager_setupBattleTest.call(this);
    try {
      const ids = battleTestPartyActorIds();
      if (ids) {
        setupRandomBattleTestParty(ids);
      } else {
        console.log(
          "[BattleTest] Test party is not " +
            BATTLE_TEST_PARTY_SIZE +
            " members - left exactly as configured."
        );
      }
    } catch (e) {
      console.error("[BattleTest] Failed to build random party:", e);
    }
  };

  // Rebuild the current party as `memberCount` (max 3) fully random members,
  // all at the same level, through the character creator's own randomization
  // rules: an NPC sprite/name drawn only from npc:true entries in NPCs.json,
  // a random sentient class, random traits (which grant their own items and
  // equipment), a class-compatible weapon plus random armor per slot, and the
  // baseline starter skills - the same recipe randomizeBattleTestActor uses to
  // build a Battle Test roster, generalized to any level/size and exposed for
  // callers outside this file (e.g. Sandbox Mode's "Party" name override).
  // Finishes with the same starting purse a normal creation run hands out.
  window.CharacterCreationParty = window.CharacterCreationParty || {};
  window.CharacterCreationParty.randomizeFullParty = function (level, memberCount) {
    const count = Math.max(1, Math.min(3, memberCount || 3));
    const lvl = Math.max(1, Math.min(99, level || 1));

    for (const id of $gameParty._actors.slice()) {
      $gameParty.removeActor(id);
    }
    for (let i = 0; i < count; i++) {
      const actorId = i + 1;
      $gameParty.addActor(actorId);
      randomizeBattleTestActor($gameActors.actor(actorId), i, lvl);
    }

    if ($gamePlayer) $gamePlayer.refresh();
    giveStartingMoney();
  };

  // --- Where an origin actually sets the party down --------------------------
  // The overland origins used to land on world map 315 and be walked onto a
  // passable tile of it once it had loaded. They begin on the ground of a
  // procedural square now (startOnProceduralSquare), which picks the SQUARE out
  // of the biome cache before the transfer is even reserved , but not the tile.
  // The square does not exist until it is generated, and the middle of a fresh
  // one is as likely to be the inside of a boulder, a tree trunk, a wall or a
  // pond as it is to be open ground. A party set down there is stuck in the
  // scenery, so the landing tile is settled here, once the terrain is real.
  //
  // A tile is somewhere to stand only if it can be walked off in every
  // direction (so no party member is boxed in by a feature drawn around them),
  // has nothing already standing on it, and is not a floor that hurts.
  //
  // "Can be walked off" is asked the way the player themselves asks it, through
  // Game_CharacterBase.canPass. The raw tileset flags (Game_Map.checkPassage)
  // are not the answer on a procedural square: every special terrain there is
  // layered on top of Game_Map.isPassable instead - deep water (region 99),
  // blocked tiles (region 10), the always-open path network (region 5 / 13),
  // cliffs, mountain (terrain tag 4) and ice (terrain tag 7). Read through the
  // flags alone a lake and a mountainside both look like open ground, which is
  // how an origin could still set the party down inside one.
  const CC_LANDING_DIRS = [2, 4, 6, 8];

  function ccCanStepOff(x, y, d) {
    return $gamePlayer.canPass(x, y, d);
  }

  // Something solid standing on the tile: an event that blocks a walker. Used
  // by the relaxed pass, which cares only about what makes a landing
  // impossible, not about what makes it untidy.
  function ccBlockingEventAt(x, y) {
    return $gameMap.eventsXy(x, y).some(
      (ev) => !ev._erased && ev.isNormalPriority() && !ev.isThrough()
    );
  }

  function ccIsStandableTile(x, y) {
    if (!$gameMap.isValid(x, y)) return false;
    if ($gameMap.eventsXy(x, y).length > 0) return false;
    if ($gameMap.isDamageFloor(x, y)) return false;
    return CC_LANDING_DIRS.every((d) => ccCanStepOff(x, y, d));
  }

  // The same question asked at its lowest bar: the party is not stuck here.
  // The tile can be walked off in at least ONE direction and nothing solid is
  // standing on it. Only ever a second pass, so a square whose open ground is
  // all narrow - a cave, a corridor, a walled yard, a jetty - still answers
  // with somewhere to put the party down instead of leaving them in the rock.
  function ccIsUnstuckTile(x, y) {
    if (!$gameMap.isValid(x, y)) return false;
    if (ccBlockingEventAt(x, y)) return false;
    return CC_LANDING_DIRS.some((d) => ccCanStepOff(x, y, d));
  }

  // The nearest tile to (cx, cy) the test answers for, walking outward in
  // square rings so the party lands as close to where they were aimed as the
  // terrain allows. Null when the whole map fails the test.
  function ccFindTileNear(cx, cy, test) {
    if (test(cx, cy)) return { x: cx, y: cy };
    const reach = Math.max($gameMap.width(), $gameMap.height());
    for (let ring = 1; ring < reach; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          // The ring itself, not the filled square inside it.
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          if (test(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
        }
      }
    }
    return null;
  }

  // Somewhere to stand if the square holds one, and failing that anywhere the
  // party is at least not walled in. Answers null only for a square with no
  // walkable tile at all (open sea, which no origin lands on).
  function ccFindStandableTile(cx, cy) {
    return ccFindTileNear(cx, cy, ccIsStandableTile) ||
           ccFindTileNear(cx, cy, ccIsUnstuckTile);
  }

  // Move the party onto a tile they can stand on, if they are not on one
  // already. Deliberately a no-op when the tile the party is on can be walked
  // out of, so it does not fight the landings that are somebody else's to make:
  // VehicleSystem puts the vehicle origins down in a 4x4 clearing of its own
  // choosing (and leaves the player alone when it cannot find one, which is the
  // case this catches), and an origin that begins in a cellar or a cave means
  // the cramped tile it named. Only being walled in - or standing on a floor
  // that hurts - is overruled, and the tile it moves to is a properly open one
  // wherever the square holds any.
  function ccPlaceOnPassableTile() {
    const x = $gamePlayer.x, y = $gamePlayer.y;
    if (ccIsUnstuckTile(x, y) && !$gameMap.isDamageFloor(x, y)) return;
    const tile = ccFindStandableTile(x, y);
    if (!tile) {
      console.warn("CharacterCreation: nowhere to stand on the origin's square; the party was left where it landed.");
      return;
    }
    console.log(`CharacterCreation: landing tile (${x},${y}) cannot be stood on; the party was moved to (${tile.x},${tile.y}).`);
    $gamePlayer.locate(tile.x, tile.y);
  }

  // VehicleSystem places the vehicle origins itself, in a 4x4 clearing wide
  // enough to park in, and its own test is the looser of the two (it asks
  // whether a tile is passable, not whether anything is standing on it). It
  // calls this once it is done so the last word on where the party is standing
  // is always the same one. Read off window at call time, so which of the two
  // plugins loaded first does not matter.
  window.CCOriginPlacement = {
    placeOnStandableTile: ccPlaceOnPassableTile,
    isStandableTile: ccIsStandableTile,
  };

  const _CC_SceneMap_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    const enteringGameStartMap =
      $gamePlayer.isTransferring() && $gamePlayer.newMapId() === GAME_START_MAP_ID;
    _CC_SceneMap_onMapLoaded.call(this);
    // The square an origin begins on has just been built: put the party on a
    // tile of it they can actually stand on.
    if ($gameTemp && $gameTemp._ccProcSquareLanding && $gameMap.mapId() === proceduralMapId()) {
      $gameTemp._ccProcSquareLanding = false;
      ccPlaceOnPassableTile();
    }
    // The same guarantee for every OTHER route a freshly created party reaches
    // the procedural map by: the bunker's cellar and any other forced biome
    // (started through WorldMapReturn rather than through
    // startOnProceduralSquare), a wrecked ship's alien surface, the square a
    // picker origin was walked onto. None of them raise the flag above, and all
    // of them are terrain generated a moment ago, with no guarantee that the
    // tile the transfer named is anything but the inside of a rock or the
    // middle of a lake. Answered once, on the first map the party is set down
    // on after creation, and only when that map is the procedural one.
    if ($gameTemp && $gameTemp._ccOriginLanding && $gameMap.mapId() !== GAME_START_MAP_ID) {
      $gameTemp._ccOriginLanding = false;
      if ($gameMap.mapId() === proceduralMapId()) ccPlaceOnPassableTile();
    }
    // Hide the player sprite the instant it lands on the game-start map, so it
    // never pops in mid-fade; Scene_Map.update below reveals it the moment the
    // fade-in completes.
    if (enteringGameStartMap) {
      $gamePlayer.setImage("", 0);
      if ($gameTemp) $gameTemp._ccRevealSpriteOnFadeIn = true;
    }
  };

  // --- Nobody is left standing in the empty carriage -----------------------
  // The starting map is not a place: it is the black, all but tileless room the
  // creation wizard is drawn over, and the party is only ever meant to pass
  // through it. Most origins leave it through the starting place picker, which
  // is asked for with a flag on $gameTemp and lands the party off a real-time
  // timer, and neither is watched by anything: a frame swallowed by an overlay,
  // a scene rebuilt at the wrong moment or a landing that threw all end the same
  // way, with the player walking around an empty black map and no way out of it.
  //
  // So the map answers for itself. Once an origin has been chosen and the party
  // is standing here with nothing pending at all, the picker is asked for again;
  // if that is not taken either, they are put on the beginners' train platform,
  // which is where the start map's own quickstart branch sends them.
  const START_MAP_RESCUE_DELAY = 90;      // frames of nothing happening first
  const START_MAP_RESCUE_LANDING = { mapId: 708, x: 19, y: 12, dir: 2 }; // Ghent platform

  // Everything that means "the party is on its way out of here after all".
  function ccStartMapIsSettled() {
    if (!$gameTemp) return true;
    if ($gamePlayer.isTransferring()) return true;
    if (SceneManager.isSceneChanging()) return true;
    if ($gameTemp._openCharacterCreationTrainTravel) return true;   // picker asked for
    if ($gameTemp._characterCreationTravelMode) return true;        // picker open
    if ($gameTemp._ccVehicleFieldStart) return true;                // a vehicle origin placing itself
    if (document.getElementById("travel-overlay")) return true;     // i18n-ignore  DOM id
    if ($gameMap.isEventRunning()) return true;                     // the start map's own autorun
    return false;
  }

  function ccStartMapNeedsRescue() {
    if (!$gameMap || $gameMap.mapId() !== GAME_START_MAP_ID) return false;
    if (!$gameSystem || !$gameSystem._ccOriginSymbol) return false; // no origin chosen yet
    return !ccStartMapIsSettled();
  }

  function ccRescueFromStartMap() {
    const attempt = ($gameTemp._ccStartMapRescues || 0) + 1;
    $gameTemp._ccStartMapRescues = attempt;
    if (attempt === 1) {
      console.warn("CharacterCreation: the party was left on the starting map with no journey to take; the starting place picker was asked for again.");
      $gameTemp._characterCreationTravelType =
        $gameSystem._ccOriginSymbol === "origin_train" ? "train" : "camper";
      $gameTemp._characterCreationTravelMode = true;
      $gameTemp._openCharacterCreationTrainTravel = true;
      return;
    }
    console.warn("CharacterCreation: the starting place picker did not take either; the party was put on the beginners' platform.");
    const t = START_MAP_RESCUE_LANDING;
    $gamePlayer.setMovementLock(false);
    $gamePlayer.reserveTransfer(t.mapId, t.x, t.y, t.dir, 0);
  }

  const _CC_SceneMap_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _CC_SceneMap_update.call(this);
    if ($gameTemp && $gameTemp._ccRevealSpriteOnFadeIn && !this.isFading()) {
      $gameTemp._ccRevealSpriteOnFadeIn = false;
      $gamePlayer.refresh();
    }
    // Counted in frames of the map actually running, so the wait is a wait the
    // player can see: every scene the wizard and the picker put on top of the
    // map stops it, and any of them being open resets the count anyway.
    if ($gameTemp && !this.isFading()) {
      if (ccStartMapNeedsRescue()) {
        $gameTemp._ccStartMapIdle = ($gameTemp._ccStartMapIdle || 0) + 1;
        if ($gameTemp._ccStartMapIdle >= START_MAP_RESCUE_DELAY) {
          $gameTemp._ccStartMapIdle = 0;
          ccRescueFromStartMap();
        }
      } else if ($gameTemp._ccStartMapIdle) {
        $gameTemp._ccStartMapIdle = 0;
      }
    }
  };

  // Export to global namespace
  window.Scene_CharacterCreation = Scene_CharacterCreation;

  console.log(`${pluginName} loaded successfully.`);
})();
