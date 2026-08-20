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

  // Preview plate per enemy spawn mode, indexed by the stored setting value
  // (0 Distance from spawn, 1 Party Level, 2 Biome, 3 Chaos). The same files
  // the options menu shows for this setting; see GameOptions.js, OPTION_IMAGES.
  const ENEMY_SPAWN_IMAGES = [
    "EnemySpawnDistance", "EnemySpawnPartyLevel", "EnemySpawnBiome", "EnemySpawnChaos",
  ];

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

  // Full-screen black veil used to hide the brief return to the map while the
  // wizard steps out to a screen that has to run on the MAP (the hometown
  // picker, which is the fast-travel city list). Without it the map flashes for
  // a frame. The veil is removed by the destination scene once it has finished
  // loading, with a safety timeout. The name/sprite screens no longer need it:
  // they are pushed straight from the wizard and the map is never visited.
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
  const { getCharacterPresets, getAvailableCharacterPresets, markPresetUsed, getPresetLore, getPresetHometown, getPresetSkins, getPresetSkin, getPresetSkinLabel, markStepCompleted, isStepCompleted, hasCompletedFirstCreation, Window_CharacterPresets, getEmRestlessLine } = window.CharacterPresets || {};
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

  function traitStartingMoney(actor) {
    const traits = (actor && actor._selectedTraits) || [];
    return traits.reduce((sum, trait) => sum + (Number(trait && trait.money) || 0), 0);
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
  // (100 gold = €1) and a controlling 80% stake in LemonCorp registered on the
  // company exchange (RealEstateMarket via window.AssetRegistry), then drop the
  // player into the LemonCorp HQ (map 1036) at 25,31 facing down.
  const CEO_START_EUROS = 1000000;           // €1,000,000
  const CEO_START_GOLD = CEO_START_EUROS * 100; // 100 gold = €1
  const CEO_COMPANY_KEY = "LemonCorp";
  const CEO_OWNERSHIP = 0.8;                  // 80% controlling stake
  const CEO_START = { mapId: 1036, x: 25, y: 31, dir: 2 }; // facing down
  const CEO_PLACE = "Ghent";                  // HQ's town: the anchor's world square

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

  // Hypernet Explorer origin: a random square of the world like the convoker's,
  // and then straight indoors. The house itself is picked by
  // ProceduralHouseSystem off the tile the party landed on, so which house it
  // is comes out of the same seeded pool every other door on that square draws
  // from. The entry cannot be made from here (it needs the square to exist and
  // the party to be standing on it), so it is deferred to the landing pass in
  // Scene_Map.onMapLoaded.
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
    if (startOnProceduralSquare({ rng: Math.random })) {
      if ($gameTemp) $gameTemp._ccHypernetHouseLanding = true;
      return;
    }
    console.warn("CharacterCreation: no overland square for the hypernet-explorer origin; starting at the tower gate instead.");
    startDungeonOrigin();
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
      // Hometown (Full mode only). A party-level question asked once up front
      // (showOnlyOnce), alongside the other once-per-party steps, so members 2/3
      // never see it again and Back navigation stays clean. Skipped in the
      // board modes. Stored on $gameSystem._ccHometown.
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
        // mode (see FastTravelSystem.js's executeTravel). That picker lives on
        // the map, so this is the one step that still steps out to it; it
        // resumes through repriseCreation when the pick is made.
        markStepCompleted(STEP.HOMETOWN);
        if ($gameTemp) {
          $gameTemp._openCharacterCreationTrainTravel = true;
          $gameTemp._characterCreationTravelType = "camper"; // full city list, world-map landing
          $gameTemp._characterCreationTravelMode = true;     // free, uncancellable
          $gameTemp._ccHometownPick = true;
        }
        this.pauseForMapScreen();
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

        this.leaveGenderStep();
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
        if (symbol === "pick_traits") {
          // Open trait selector scene directly
          const targetActorId = Scene_CharacterCreation.getCurrentActorId();

          // Save current step so we can resume after trait selection.
          // interruptedStep + 1 is the resume step, so TRAITS resumes on ADD_MEMBER.
          Scene_CharacterCreation._interruptedStep = STEP.TRAITS;
          Scene_CharacterCreation._resumeOnStep = false;

          // Prepare TraitSelector to return to character creation
          if (window.Scene_TraitSelector) {
            window.Scene_TraitSelector.prepare(true, targetActorId);
            this.closeStepUI();
            SceneManager.push(window.Scene_TraitSelector);
          } else {
            console.error("Scene_TraitSelector not loaded!");
            this.nextStep();
          }
        } else {
          // "Roll them for me", and anything a future choice adds here. The
          // fallback used to hand `choice.value` to a common event, but that
          // field is the choice's ICON index, so it reserved whatever event
          // happened to share a number with the icon. There is nothing to fall
          // back to: without the trait plugin the member simply keeps none.
          const targetActorId = Scene_CharacterCreation.getCurrentActorId();
          if (window.randomizeTraitsForActor) {
            window.randomizeTraitsForActor(targetActorId);
          } else {
            console.warn("TraitSelector randomizeTraitsForActor not available; no traits applied");
          }
          this.nextStep();
        }
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
      return step === STEP.GENDER && this.isQuickMode() && !this._isCreatureMode;
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
        if (step === STEP.PORTRAIT) return true;
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
          [STEP.PORTRAIT, STEP.GENDER, STEP.CLASS, STEP.TRAITS, STEP.PERSONALITY,
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
      // Nothing left to pick in this world: stay on the current step instead
      // of opening an empty board (which had no items to select or cancel
      // from). During the tutorial availablePresets() always answers its own
      // three dossiers (see getAvailableCharacterPresets), so this never
      // fires there.
      if (availablePresets().length === 0) {
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
        // The tutorial's own dossiers are exempt (see TUTORIAL_PRESETS):
        // they never belong to a world's spendable pool at all.
        const isTutorialPreset = !!preset.tutorialOnly;
        if (!isTutorialPreset && typeof markPresetUsed === "function") {
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
        // A pre-made character never sees the origin step, so the card floor
        // every other start stands on is handed over here instead. No dossier
        // carries cards of its own, so nothing can be doubled up.
        grantMinimumCards();

        // Track the current preset ID for death removal
        $gameSystem._currentPresetId = preset.id;

        if (isTutorialPreset) {
          // The tutorial starts wherever it is being played; never relocate
          // the player, and hand off to the post-tutorial controls legend.
          Scene_CharacterCreation._tutorialMode = false;
          beginTutorialControlsLegend();
        } else {
          // Transfer player to the dossier's home location - unless that home
          // was on Earth and Earth is gone, in which case there is one
          // address left.
          const target = $dataMapInfos && $dataMapInfos[preset.mapId];
          // Same landing check every origin gets, for a dossier whose home
          // address is a procedural square rather than an authored map.
          if ($gameTemp) $gameTemp._ccOriginLanding = true;
          if (startsAtOmegaTower()) {
            startAtOmegaTower();
          } else if (target) {
            $gamePlayer.reserveTransfer(preset.mapId, preset.x, preset.y, 2, 0);
          } else {
            console.error(
              `CharacterCreation: preset "${preset.name}" points at missing map ${preset.mapId}; staying put`
            );
          }
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

      // A creature dossier (characterType: "creature") is built from
      // Health_Core's own archetype system rather than an ordinary class
      // kit: 1 archetype key is a baseline body, 2 a hybrid merge. Reuses
      // the same entry point the Quick-mode inline creature picker uses, so
      // body parts, anatomy skills and the reproduction variable all come
      // out exactly as they would from the creature builder.
      if (preset.characterType === "creature" &&
          Array.isArray(preset.archetypes) && preset.archetypes.length > 0 &&
          typeof window.applyCreatureSelection === "function") {
        const mode = preset.archetypes.length >= 2 ? "hybrid" : "baseline";
        window.applyCreatureSelection(
          actor.actorId(),
          mode,
          preset.archetypes[0],
          preset.archetypes[1] || null,
          null, // sprite is already set above
          null
        );
      }

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
      (preset.equips || []).forEach((entry, slotId) => {
        // Newer dossiers record what each piece was ({ id, w }); older ones
        // stored a bare id and leaned on the slot's type to tell a weapon from
        // a shield, which a hand slot can no longer do.
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

      if (preset.characterType) {
        $gameSwitches.setValue(creatureSwitchId, preset.characterType === "creature");
      } else if (preset.isCreature !== undefined) {
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

    refreshUIOverlayDOM() {
      if (this._ccHandingOver) return; // another screen is taking over
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
              return `<div class="cc-element-badge" style="margin: 2px">${traitName}</div>`;
            }).filter(Boolean).join(" ");
          }
          if (!traitsHtml) {
            traitsHtml = `<span style="font-size: 1.219rem; color: var(--text-card-medium)">${T('CharCreate.noDefiningTraits')}</span>`;
          }

          let skillsHtml = "";
          if (preset.skills && preset.skills.length > 0) {
            skillsHtml = preset.skills.map(id => {
              const skill = $dataSkills[id];
              return skill ? `<div class="cc-element-badge" style="margin: 2px">${window.CCDbName(skill)}</div>` : "";
            }).join(" ");
          } else {
            skillsHtml = `<span style="font-size: 1.219rem; color: var(--text-card-medium)">${T('CharCreate.noSkillsLearned')}</span>`;
          }

          let specsHtml = "";
          if (preset.specializations && preset.specializations.length > 0 && window.Specializations && window.Specializations.ready) {
            specsHtml = preset.specializations.map((entry) => {
              const spec = window.Specializations.byId.get(entry.id);
              if (!spec) return "";
              const levelName = window.Specializations.levelName(entry.level);
              return `<div class="cc-element-badge" style="margin: 2px">${window.Specializations.displayName(spec)} <span style="opacity:0.7">(${levelName})</span></div>`;
            }).filter(Boolean).join(" ");
          }
          if (!specsHtml) {
            specsHtml = `<span style="font-size: 1.219rem; color: var(--text-card-medium)">${T('CharCreate.noSpecializations')}</span>`;
          }

          let gearHtml = "";
          if (preset.items && preset.items.length > 0) {
            gearHtml += preset.items.map(itemData => {
              const item = $dataItems[itemData.id];
              return item ? `<div style="font-size: 1.219rem; padding: 2px 0">${window.CCDbName(item)} x${itemData.amount}</div>` : "";
            }).join("");
          }
          if (preset.weapons && preset.weapons.length > 0) {
            gearHtml += preset.weapons.map(itemData => {
              const item = $dataWeapons[itemData.id];
              return item ? `<div style="font-size: 1.219rem; padding: 2px 0">${window.CCDbName(item)} x${itemData.amount}</div>` : "";
            }).join("");
          }
          if (preset.armors && preset.armors.length > 0) {
            gearHtml += preset.armors.map(itemData => {
              const item = $dataArmors[itemData.id];
              return item ? `<div style="font-size: 1.219rem; padding: 2px 0">${window.CCDbName(item)} x${itemData.amount}</div>` : "";
            }).join("");
          }
          if (!gearHtml) {
            gearHtml = `<span style="font-size: 1.219rem; color: var(--text-card-medium)">${T('CharCreate.emptyBackpack')}</span>`;
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
            originRows += `<div class="cc-dossier-row"><span class="cc-dossier-label">${T('CharCreate.nationOfBirth')}:</span><span class="cc-dossier-value">${window.WorldNames ? window.WorldNames.nation(preset.nationId) : preset.nationId}</span></div>`;
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
                <div style="font-size: 1.219rem; line-height: 1.4">${loreText}</div>
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
                <div class="cc-skins-hint"><span class="cc-key-chip" data-pad="${skinKeyPadOn() ? '1' : '0'}">${skinKeyLabel()}</span><span>${T('CharPresets.skinHint')}</span></div>
              </div>
          ` : "";

          rightHtml = `
            <div class="cc-page cc-page-right">
              <h2 class="cc-header-gothic">${T('CharCreate.personalDossier')}</h2>

              <div class="cc-wanted-sprite" style="${this.getSpriteStyle(currentSkin.sprite, currentSkin.spriteIndex)}; margin: 0 auto 16px auto; transform: scale(1.6)"></div>

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
                <div style="display: flex; flex-wrap: wrap; gap: 4px">
                  ${traitsHtml}
                </div>
              </div>

              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.skills')}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px">
                  ${skillsHtml}
                </div>
              </div>

              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.specializations')}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px">
                  ${specsHtml}
                </div>
              </div>

              <div class="cc-dossier-card">
                <h3 class="cc-subheader">${T('CharCreate.equipment')}</h3>
                <div style="display: flex; flex-direction: column">
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

            ${CCButtons.panel({
              back: Scene_CharacterCreation._tutorialMode
                ? ""
                : CCButtons.button(CCButtons.backLabel(), { onclick: "SceneManager._scene.onPresetCancelClick()" }),
            })}
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
        // The character-type step for the 2nd/3rd member IS the starting step
        // (settings/difficulty/etc. auto-skip once member 1 is done), but it
        // still has somewhere real to go back to: the previous member's
        // "add another?" prompt (see previousStep's undo branch).
        const isLaterMemberTypeStep = this._step === STEP.CHARACTER_TYPE &&
          (Scene_CharacterCreation._currentPartyMemberIndex || 0) > 0;
        const showBackButton = this._step > firstStep || isLaterMemberTypeStep;
        // On the very first step of a new game there is nothing to go back to
        // inside the wizard, so the slot holds the way out to the title screen.
        const backBtnHtml = showBackButton
          ? CCButtons.button(CCButtons.backLabel(), { onclick: "SceneManager._scene.onCancel()" })
          : (this.canExitToTitle()
            ? CCButtons.button(CCButtons.titleLabel(), { onclick: "SceneManager._scene.exitToTitle()" })
            : "");

        // Class/creature class picker uses a two-column grid.
        const isQuickClassStep = this._step === STEP.CLASS &&
          Scene_CharacterCreation.usesQuickFlow();
        // Class picker spread: list on the LEFT page, details of the
        // highlighted entry on the RIGHT page (creature mode keeps its layout).
        const isClassPicker = this._isClassPickerStep();
        // Origin step: same list-left / details-right spread as the class picker.
        const isOriginPicker = this._isOriginPickerStep();
        // Personality step: two dozen archetypes, so the same spread again.
        const isPersonalityPicker = this._isPersonalityPickerStep();
        // Hometown step lists every destination, so it renders as a compact
        // scrollable dropdown (keyboard / controller / mouse / wheel) instead of
        // big cards.
        const isHometownStep = stepData.id === "hometown";
        let gridClass = "cc-select-grid";
        if (isQuickClassStep) gridClass += " cc-two-col";
        if (isClassPicker || isOriginPicker || isPersonalityPicker) gridClass += " cc-compact";
        // Two dozen origins do not fit down one column without scrolling past
        // most of them, so they are laid out three across. Each entry is still
        // left-aligned: the names are long, and centring them left every entry
        // starting at a different x, so a column was ragged and slow to scan.
        if (isOriginPicker) gridClass += " cc-three-col cc-align-left";
        // The personality list is as long as the origin list and its names are
        // single words, so it reads better centred three across.
        if (isPersonalityPicker) gridClass += " cc-three-col";
        if (isHometownStep) gridClass += " cc-dropdown-list";

        // Every wizard step ends with the same bar, so Back and Continue never
        // move as the player walks the steps.
        const buttonPanelHtml = CCButtons.panel({
          back: backBtnHtml,
          next: CCButtons.button(CCButtons.continueLabel(), {
            onclick: "SceneManager._scene.onOptionCardConfirm()",
            confirm: true,
          }),
        });

        if (isClassPicker) {
          // Class step: the class list replaces the party panel on the LEFT
          // page. The RIGHT page shows live details for whatever entry is
          // highlighted, plus the Back/Confirm buttons.
          leftHtml = `
            <div class="cc-page cc-page-left" style="display: flex">
              <h2 class="cc-header-gothic">${stepData.title}</h2>

              <div class="${gridClass}" style="flex: 1; min-height: 0; overflow-y: auto; align-content: start">
                ${optionCards}
              </div>
            </div>
          `;
          rightHtml = this._classStepDetailsHtml(stepData, activeIndex, buttonPanelHtml);
        } else if (isOriginPicker) {
          // Origin step: the list of origins fills the LEFT page; the RIGHT page
          // shows the highlighted origin's description and starting loadout.
          leftHtml = `
            <div class="cc-page cc-page-left" style="display: flex">
              <h2 class="cc-header-gothic">${stepData.title}</h2>

              <div class="${gridClass}" style="flex: 1; min-height: 0; overflow-y: auto; align-content: start">
                ${optionCards}
              </div>
            </div>
          `;
          rightHtml = this._originStepDetailsHtml(stepData, activeIndex, buttonPanelHtml);
        } else if (isPersonalityPicker) {
          // Personality step: the archetypes fill the LEFT page; the RIGHT page
          // reads out what the highlighted disposition is and what it does to
          // the body that carries it.
          leftHtml = `
            <div class="cc-page cc-page-left" style="display: flex">
              <h2 class="cc-header-gothic">${stepData.title}</h2>

              <div class="${gridClass}" style="flex: 1; min-height: 0; overflow-y: auto; align-content: start">
                ${optionCards}
              </div>
            </div>
          `;
          rightHtml = this._personalityStepDetailsHtml(stepData, activeIndex, buttonPanelHtml);
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
        } else if (this._isClassPickerStep() || this._isOriginPickerStep() ||
                   this._isPersonalityPickerStep()) {
          // Class / origin / personality picker: the list lives on the LEFT page
          // (only the highlight moves), while the RIGHT page re-renders the
          // highlighted entry's details.
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
    // description plus a short "what you start with" dossier. The Back/Confirm
    // button panel always renders at the bottom of this page.
    _originStepDetailsHtml(stepData, activeIndex, buttonsHtml) {
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
          row(T('CharCreate.start'), T('CharCreate.lemoncorpHeadquarters')),
          row(T('CharCreate.assets'), T('CharCreate.80OfLemoncorpShares')),
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
          row(T('CharCreate.start'), T('CharCreate.aRandomHouseSomewhere')),
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
          ${buttonsHtml || ""}
        </div>
      `;
    }

    // Builds the right page for the personality step: what the highlighted
    // disposition is, one line it puts in the character's head, and what it does
    // to the body carrying it (PersonalityData.json `modifiers`, which the
    // biologic sim multiplies the baselines by). The Random card has no
    // archetype to read, so it shows its own description alone.
    _personalityStepDetailsHtml(stepData, activeIndex, buttonsHtml) {
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

    // Builds the right page for the class step: the highlighted class's full
    // details. The Back/Confirm button panel always renders at the bottom of
    // this page.
    _classStepDetailsHtml(stepData, activeIndex, buttonsHtml) {
      const choice = (stepData.choices && stepData.choices[activeIndex]) || {};
      const symbol = choice.symbol || "";
      const buttons = buttonsHtml || "";

      if (symbol.indexOf("quick_class_") === 0) {
        return this._classDetailsPageHtml(choice.value, buttons);
      }

      // Random class / fallback: just the choice's own description.
      return `
        <div class="cc-page cc-page-right" style="display: flex">
          <h2 class="cc-header-gothic">${choice.name || ""}</h2>
          <p style="font-size: 1.329rem; line-height: 1.45; color: var(--text-card-dark); text-align: center; margin-bottom: 16px">
            ${this.cleanText(choice.description || "")}
          </p>
          ${buttons}
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
          equipBadges.push(`<span class="cc-element-badge" style="margin: 2px; font-size: 1.081rem">${weaponNames[wId] || "Weapon"}</span>`);
        }
      }
      const armorTypes = $dataSystem.armorTypes || [];
      for (let aId = 1; aId < armorTypes.length; aId++) {
        if (armorTypes[aId] && hasEquipTrait(52, aId)) {
          equipBadges.push(`<span class="cc-element-badge" style="margin: 2px; font-size: 1.081rem">${armorTypes[aId]}</span>`);
        }
      }

      // Starting (level 1) skills.
      const learnings = c.learnings || [];
      let lv1SkillsHtml = learnings
        .filter((l) => l.level === 1)
        .map((l) => {
          const sk = $dataSkills[l.skillId];
          return sk ? `<div class="cc-element-badge" style="margin: 2px">${window.CCDbName(sk)}</div>` : "";
        }).join(" ");
      if (!lv1SkillsHtml) {
        lv1SkillsHtml = `<span style="font-size: 1.219rem; color: var(--text-card-medium)">${T('CharCreate.noStartingSkills')}</span>`;
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
              <span class="cc-dossier-label" style="display:flex; align-items:center; gap:6px">
                <span style="${this._ccIconStyle(it.iconIndex)}"></span>${window.CCDbName(it)}
              </span>
              <span class="cc-dossier-value">x${e.qty}</span>
            </div>
          `;
        }).join("");
      const startingItemsCardHtml = classItemsHtml
        ? `
            <div class="cc-dossier-card" style="margin-bottom: 8px">
              <h3 class="cc-subheader">${T('CharCreate.startingItems')}</h3>
              ${classItemsHtml}
            </div>
          `
        : "";

      // Level-up skill roadmap (everything unlocked past level 1). Quick mode
      // is the three-question flow, and a class dossier that scrolls on for
      // forty levels is exactly the reading it exists to skip: the card is left
      // out there and the dossier ends on the starting skills and items.
      const roadmapRows = Scene_CharacterCreation.isQuickMode() ? "" : learnings
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
        <div class="cc-page cc-page-right" style="display: flex">
          <h2 class="cc-header-gothic">${window.CCDbName(c)}</h2>
          <p style="font-size: 1.329rem; line-height: 1.45; color: var(--text-card-dark); text-align: center; margin-bottom: 12px">
            "${note}"
          </p>

          <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 12px">
            ${elementHtml}
          </div>

          <div style="flex: 1; min-height: 0; overflow-y: auto">
            <div class="cc-dossier-card" style="margin-bottom: 8px">
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px">
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

            <div class="cc-dossier-card" style="margin-bottom: 8px">
              <h3 class="cc-subheader">${T('CharCreate.equipmentProficiencies')}</h3>
              <div style="display: flex; flex-wrap: wrap; gap: 4px">
                ${equipBadges.join("") || T('CharCreate.none')}
              </div>
            </div>

            <div class="cc-dossier-card" style="margin-bottom: 8px">
              <h3 class="cc-subheader">${T('CharCreate.startingSkills')}</h3>
              <div style="display: flex; flex-wrap: wrap; gap: 4px">
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
      const portrait = spread.querySelector(".cc-page-right > .cc-wanted-sprite");
      if (portrait) {
        portrait.setAttribute(
          "style",
          `${spriteStyle}; margin: 0 auto 16px auto; transform: scale(1.6)`
        );
      }

      // Which thumbnail wears the stamp.
      spread.querySelectorAll(".cc-skin-card").forEach((el, i) => {
        el.classList.toggle("selected", i === skinIdx);
      });

      // The board poster of the dossier being read, so the two agree. Scoped to
      // the board so the look thumbnails, which are wanted cards too, are left
      // alone.
      const cards = spread.querySelectorAll(".cc-page-left .cc-presets-board .cc-wanted-card");
      const card = cards[this._presetWindow.index()];
      const boardSprite = card && card.querySelector(".cc-wanted-sprite");
      if (boardSprite) boardSprite.setAttribute("style", spriteStyle);
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
      if (ConfigManager.fogOfWar === undefined) ConfigManager.fogOfWar = false;
      if (ConfigManager.globalLighting === undefined) ConfigManager.globalLighting = true;
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
      // Loose (1) is the party's own default, and the row below reads it back.
      if (ConfigManager.partyFormation === undefined) ConfigManager.partyFormation = 1;
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
          // How the party walks the map (Core/AutoIdleExplorer.js). It is the
          // first thing a player sees once the game starts, so it is asked here
          // as well as in the options menu, which owns the same setting.
          key: 'partyFormation',
          label: T('CharCreate.partyFormation'),
          description: T('CharCreate.howTheRestOfThePartyWalksBehindTheLeader'),
          captionOff: T('CharCreate.theyMarchInTheLeaderSFootstepsOneTileApart'),
          captionOn: T('CharCreate.theyLiveTheirOwnLivesAroundTheLeader'),
          get currentIndex() { return ConfigManager.partyFormation ? 1 : 0; },
          get currentLabel() {
            const names = T.list('AutoIdle.formation.states');
            return names[this.currentIndex] || String(this.currentIndex);
          },
          _toggle() {
            ConfigManager.partyFormation = ConfigManager.partyFormation ? 0 : 1;
            const loose = window.AutoIdleExplorer && window.AutoIdleExplorer.loose;
            if (loose && loose.onModeChanged) loose.onModeChanged();
          },
          next() { this._toggle(); },
          prev() { this._toggle(); },
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
          <div style="text-align:center; font-size:4.081rem; margin:16px 0">♪</div>
        `;
      } else if (currentRow.key === 'activeTheme') {
        previewHtml = `
          <div style="text-align:center; font-size:4.081rem; margin:16px 0">◈</div>
          <p style="text-align:center; font-size:1.585rem; font-weight:bold; margin:8px 0">${currentRow.currentLabel}</p>
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
              <div style="text-align:center; font-size:4.081rem; margin:16px 0">☠</div>
              ${plateHtml}
              <p style="text-align:center; font-size:1.585rem; font-weight:bold; margin:8px 0">${currentRow.currentLabel}</p>
            </div>
          </div>
        `;
      } else if (currentRow.key === 'globalLighting') {
        const on = currentRow.currentIndex === 0;
        // Light (70) / Dark (71) IconSet glyphs, drawn at 64px.
        const lightIcon = on ? 70 : 71;
        previewHtml = `
          <div style="text-align:center; margin:16px 0"><span style="display:inline-block; width:64px; height:64px; background-image:url('img/system/IconSet.png'); background-size:1024px auto; background-position:-${(lightIcon % 16) * 64}px -${Math.floor(lightIcon / 16) * 64}px; image-rendering:pixelated"></span></div>
          <p class="cc-settings-img-caption">${on ? currentRow.captionOn : currentRow.captionOff}</p>
        `;
      }

      const leftHtml = `
        <div class="cc-page cc-page-left">
          <h2 class="cc-header-gothic">${T('CharCreate.settingsPreview')}</h2>
          <div class="cc-dossier-card" style="flex:1; display:flex; flex-direction:column; align-items:center; background:transparent; border:none; box-shadow:none">
            <h3 class="cc-subheader" style="text-align:center; color:#ffcc66">${currentRow.label}</h3>
            <p class="cc-settings-desc">${currentRow.description}</p>
            ${previewHtml}
          </div>
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
        ? CCButtons.button(CCButtons.backLabel(), { onclick: "SceneManager._scene.onCancel()" })
        : (this.canExitToTitle()
          ? CCButtons.button(CCButtons.titleLabel(), { onclick: "SceneManager._scene.exitToTitle()" })
          : "");

      const rightHtml = `
        <div class="cc-page cc-page-right">
          <h2 class="cc-header-gothic">${T('CharCreate.initialSettings')}</h2>
          <div class="cc-settings-list">${rowsHtml}</div>
          ${CCButtons.panel({
            back: settingsBackBtn,
            next: CCButtons.button(CCButtons.continueLabel(), {
              onclick: "SceneManager._scene.onSettingsConfirm()",
              confirm: true,
            }),
            style: "margin-top:auto;padding-top:12px;",
          })}
        </div>
      `;

      let spread = this._dndContainer.querySelector(".cc-pockets-spread");
      if (!spread) {
        this._dndContainer.innerHTML = `<div class="cc-pockets-spread"><div class="cc-page cc-page-left"></div><div class="cc-page cc-page-right"></div></div>`;
        spread = this._dndContainer.querySelector(".cc-pockets-spread");
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
        const leftPage = spread.querySelector(".cc-page-left");
        if (leftPage) leftPage.innerHTML = innerOf(leftHtml);
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

      // Safety: creatures never go through class selection (every mode builds
      // the creature in the full creature scene, then resumes here).
      if (this._step === STEP.CLASS && Scene_CharacterCreation._isCreatureMode) {
        this._step++;
        this.setupStep();
        return;
      }

      // Portrait style is only asked of humanoids, and only when the 3D editor
      // is actually available. Quick mode never asks either: its characters are
      // portrayed by the bust their sprite comes with. Everyone who skips it
      // keeps the bust portrait.
      if (this._step === STEP.PORTRAIT &&
          (Scene_CharacterCreation._isCreatureMode ||
           Scene_CharacterCreation._tutorialMode ||
           Scene_CharacterCreation.isQuickMode() ||
           !portraitModelAvailable())) {
        if (!Scene_CharacterCreation._isCreatureMode) {
          const portraitActor = Scene_CharacterCreation.getCurrentActor();
          if (portraitActor && portraitActor.setPortraitMode) portraitActor.setPortraitMode("bust");
        }
        this._step++;
        this.setupStep();
        return;
      }

      // Gender is not a question Quick mode puts to a person: it is read off
      // the sprite the player is about to choose (NPCs.json, see
      // applyIdentityFromSprite in CharacterCreationShared). The step still
      // runs, because it is the one that hands over to the name / sprite common
      // event, so leaving it is all there is left to do here.
      //
      // A creature has no such sheet to be read off , its sprite is a monster
      // battler picked in the creature builder, which answers for nothing about
      // gender , so Quick mode asks creatures the question outright, the same as
      // every other mode. (The handler leaves the step the same way.)
      if (this._step === STEP.GENDER && Scene_CharacterCreation.isQuickMode() &&
          !Scene_CharacterCreation._isCreatureMode) {
        this.leaveGenderStep();
        return;
      }

      // Auto-randomize traits: for characters 2 and 3 in every mode (the first
      // member is asked interactively; see the "traits" step above), and for
      // every member in Quick mode, which never asks.
      if (this._step === STEP.TRAITS &&
          (currentMemberIndex >= 1 || Scene_CharacterCreation.isQuickMode())) {
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

    // Step out of the wizard to a screen that has to run on the MAP: the
    // hometown picker is the fast-travel city list, which is a map overlay.
    // FastTravelSystem calls repriseCreation when it is done, which is what
    // brings the wizard back. No common event is involved.
    pauseForMapScreen() {
      Scene_CharacterCreation._interruptedStep = this._step;
      Scene_CharacterCreation._resumeOnStep = false;
      if (window.CCTransitionVeil) window.CCTransitionVeil.show();
      this.closeStepUI();
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

        // Random class selection, out of the sentient roster alone (1-62): the
        // creature classes above it belong to a creature's archetypes.
        const validClasses = window.CreatureClasses.sentientRoster();
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
    // Aliens are never in the ordinary pool: the catalogue deals one on its own
    // share of the same draw, so a rolled character can turn out not to be from
    // here, exactly as rarely as a rolled citizen can.
    let charName = window.SpriteCatalog
      ? window.SpriteCatalog.pickNpcKey(Math.random())
      : null;
    if (!charName) {
      const keys = Object.keys(npcData).filter((k) => npcData[k] && npcData[k].npc === true);
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

  // Opens a house on the square the party is standing on, through the same
  // command a player-built door uses: alwaysOpen so a night landing is never
  // met with a lockpick prompt, and no caller event so the door state machine
  // skips the swing and goes straight to the step-in.
  function ccEnterRandomHouse() {
    if (!window.ProceduralHouseSystem) {
      console.warn("CharacterCreation: ProceduralHouseSystem is not loaded; the hypernet-explorer origin was left outdoors.");
      return;
    }
    try {
      PluginManager.callCommand({}, "ProceduralHouseSystem", "visitHouse", {
        poolName: "houses",       // i18n-ignore  house pool id
        facing: "false",
        alwaysOpen: "true",
      });
    } catch (e) {
      console.warn("CharacterCreation: could not open a house for the hypernet-explorer origin.", e);
    }
  }

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
    // The Hypernet Explorer wakes up indoors, so once the square is built and
    // the party is standing somewhere legal on it, a house is opened for them.
    // Runs after both landing passes above, which are what guarantee the tile
    // the door entry starts its forced step from is a standable one.
    if ($gameTemp && $gameTemp._ccHypernetHouseLanding && $gameMap.mapId() === proceduralMapId()) {
      $gameTemp._ccHypernetHouseLanding = false;
      ccEnterRandomHouse();
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
