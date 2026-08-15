/*:
 * @target MZ
 * @plugindesc Shared utilities for character creation system (localization, gender, traits, constants)
 * @author Omni-Lex
 * @orderAfter DB
 * @orderAfter TraitSelector
 * @orderBefore StartingEquipment
 * @orderBefore CharacterPresets
 * @orderBefore ClassSelection
 * @orderBefore CharacterCreation
 *
 * @help
 * This plugin provides shared utilities for the character creation system:
 * - Localization helpers (getLocalizedChoice)
 * - Gender and reproductive type management
 * - Trait application system (integrates with TraitSelector)
 * - Shared constants (variable IDs, gender/reproduction types)
 * - Parameter modification helpers
 *
 * Dependencies:
 * - DB.js (for localization support)
 * - TraitSelector.js (for trait integration)
 * - Health_Core.js (for archetype system)
 *
 * DO NOT call this plugin directly. It provides utilities for other plugins.
 */

(() => {
  const pluginName = "CharacterCreationShared";


  //=============================================================================
  // Constants - Variable IDs
  //=============================================================================
  const VAR_PLAYER1_GENDER = 38;
  const VAR_PLAYER2_GENDER = 39;
  const VAR_PLAYER3_GENDER = 40;
  const VAR_PLAYER1_REPRODUCTIVE_TYPE = 87;
  const VAR_PLAYER2_REPRODUCTIVE_TYPE = 115;
  const VAR_PLAYER3_REPRODUCTIVE_TYPE = 116;

  //=============================================================================
  // Constants - Gender & Reproduction Types
  //=============================================================================
  const GENDER_TYPES = {
    MALE: 0,
    FEMALE: 1,
    NON_BINARY: 2,
    COCOON: 3
  };

  const REPRODUCTION_TYPES = {
    NONE: -1,
    TESTICLES: 0,    // Male
    UTERUS: 1,       // Female
    OVIPAROUS: 2,    // Egg-laying
    PLANT: 3,        // Spore-based
    MITOSIS: 4       // Asexual (Cocoon)
  };

  //=============================================================================
  // Localization Helpers
  //=============================================================================

  /**
   * Build a menu choice from an already resolved name and description.
   * @param {string} name - Display name
   * @param {string} symbol - Choice symbol
   * @param {string} description - Display description
   * @param {*} value - Optional value
   * @param {string} bgImage - Optional background image
   * @returns {object} Choice object
   */
  function getLocalizedChoice(name, symbol, description, value = null, bgImage = "") {
    return {
      name: name,
      symbol: symbol,
      description: description,
      value: value,
      bgImage: bgImage
    };
  }

  /**
   * Database display name (item, weapon, armor, skill, class, ...) in the
   * active language. data/*.json holds the English names and
   * Hendrix_Localization swaps them at draw time through its
   * Bitmap.drawText / drawTextEx hooks, reading js/i18n/<lang>/items.json and
   * friends. The character creation screens are DOM, so they never reach those
   * hooks: a name pasted straight into HTML stays English in every other
   * language. Every creation panel routes database names through here instead.
   * @param {object|string} entry - Database record, or a raw name
   * @returns {string} Translated name (the original when no translation loaded)
   */
  function dbName(entry) {
    const name = typeof entry === "string" ? entry : (entry && entry.name) || "";
    if (!name) return "";
    return typeof window.Hendrix_Localization === "function"
      ? window.Hendrix_Localization(name)
      : name;
  }

  //=============================================================================
  // Gender & Reproduction System
  //=============================================================================

  /**
   * Get gender variable ID for party member index
   * @param {number} memberIndex - Party member index (0, 1, 2)
   * @returns {number} Gender variable ID
   */
  function getGenderVariableId(memberIndex) {
    switch (memberIndex) {
      case 0: return VAR_PLAYER1_GENDER;
      case 1: return VAR_PLAYER2_GENDER;
      case 2: return VAR_PLAYER3_GENDER;
      default:
        console.warn(`Invalid party member index: ${memberIndex}`);
        return VAR_PLAYER1_GENDER;
    }
  }

  /**
   * Get reproductive type variable ID for party member index
   * @param {number} memberIndex - Party member index (0, 1, 2)
   * @returns {number} Reproductive type variable ID
   */
  function getReproductiveVariableId(memberIndex) {
    switch (memberIndex) {
      case 0: return VAR_PLAYER1_REPRODUCTIVE_TYPE;
      case 1: return VAR_PLAYER2_REPRODUCTIVE_TYPE;
      case 2: return VAR_PLAYER3_REPRODUCTIVE_TYPE;
      default:
        console.warn(`Invalid party member index: ${memberIndex}`);
        return VAR_PLAYER1_REPRODUCTIVE_TYPE;
    }
  }

  /**
   * Apply gender selection and set reproductive type
   * @param {number} memberIndex - Party member index (0, 1, 2)
   * @param {number} genderValue - Gender value (0=Male, 1=Female, 2=Non-binary, 3=Cocoon)
   */
  function applyGenderAndReproduction(memberIndex, genderValue) {
    const genderVar = getGenderVariableId(memberIndex);
    const reproductiveVar = getReproductiveVariableId(memberIndex);

    // Set gender variable
    $gameVariables.setValue(genderVar, genderValue);

    // Set reproduction type based on gender
    switch (genderValue) {
      case GENDER_TYPES.MALE:
        $gameVariables.setValue(reproductiveVar, REPRODUCTION_TYPES.TESTICLES);
        break;
      case GENDER_TYPES.FEMALE:
        $gameVariables.setValue(reproductiveVar, REPRODUCTION_TYPES.UTERUS);
        break;
      case GENDER_TYPES.NON_BINARY:
        // Random (0-4: Testicles, Uterus, Oviparous, Plant, Mitosis)
        $gameVariables.setValue(reproductiveVar, Math.floor(Math.random() * 5));
        break;
      case GENDER_TYPES.COCOON:
        $gameVariables.setValue(reproductiveVar, REPRODUCTION_TYPES.MITOSIS);
        break;
      default:
        console.warn(`Unknown gender value: ${genderValue}`);
        $gameVariables.setValue(reproductiveVar, REPRODUCTION_TYPES.NONE);
    }
  }

  /**
   * Set random gender for a party member
   * @param {number} memberIndex - Party member index (0, 1, 2)
   */
  function applyRandomGender(memberIndex) {
    const randomGender = Math.floor(Math.random() * 4); // 0-3
    applyGenderAndReproduction(memberIndex, randomGender);
  }

  /**
   * Get gender choices for selection menu
   * @returns {array} Array of gender choice objects
   */
  function getGenderChoices() {
    return [
      {
        name: T('CharCreate.male'),
        symbol: "gender",
        value: GENDER_TYPES.MALE
      },
      {
        name: T('CharCreate.female'),
        symbol: "gender",
        value: GENDER_TYPES.FEMALE
      },
      {
        name: T('CharCreate.nonBinary'),
        symbol: "gender",
        value: GENDER_TYPES.NON_BINARY
      },
      {
        name: T('CharCreate.cocoon'),
        symbol: "gender",
        value: GENDER_TYPES.COCOON
      }
    ];
  }

  //=============================================================================
  // Trait Application System
  //=============================================================================

  /**
   * Apply traits to an actor using trait IDs from TraitSelector
   * @param {Game_Actor} actor - Actor to apply traits to
   * @param {array} traitIds - Array of trait IDs
   */
  function applyTraitsToActor(actor, traitIds) {
    if (!actor || !traitIds || traitIds.length === 0) return;

    // Try to use TraitSelector's applyTraitsByIds method if available
    const TraitSelectorScene = window.Scene_TraitSelector;
    if (TraitSelectorScene && TraitSelectorScene.prototype.applyTraitsByIds) {
      try {
        const tempScene = new TraitSelectorScene();
        tempScene.applyTraitsByIds(traitIds, actor.actorId());
        return;
      } catch (e) {
        console.error('Error using TraitSelector.applyTraitsByIds:', e);
        // Fall through to manual application
      }
    }

    // Fallback: manual trait application if TraitSelector not available
    console.warn('TraitSelector plugin not fully loaded, using fallback trait application');
    const TraitsArray = window.Health && window.Health.Traits;
    if (!TraitsArray) {
      console.error('Cannot apply traits: TraitSelector/DB not loaded');
      return;
    }

    // Store selected traits on the actor
    if (!actor._selectedTraits) {
      actor._selectedTraits = [];
    }

    const selectedTraits = [];

    // Collect trait objects by ID
    traitIds.forEach((traitId) => {
      const trait = TraitsArray.find((t) => t.id === traitId);
      if (trait) {
        selectedTraits.push(trait);
      } else {
        console.warn(`Trait with ID ${traitId} not found in TraitSelector data`);
      }
    });

    // Apply each selected trait
    selectedTraits.forEach((trait) => {
      // Apply positive bonuses
      Object.keys(trait.positive || {}).forEach((param) => {
        addParamToActor(actor, param, trait.positive[param]);
      });

      // Apply negative bonuses
      Object.keys(trait.negative || {}).forEach((param) => {
        addParamToActor(actor, param, trait.negative[param]);
      });

      // Learn skills
      (trait.skills || []).forEach((skillId) => {
        if ($dataSkills[skillId]) {
          actor.learnSkill(skillId);
        }
      });

      // Add items
      (trait.items || []).forEach((itemId) => {
        if ($dataItems[itemId]) {
          $gameParty.gainItem($dataItems[itemId], 1);
        }
      });

      // Add equipment
      (trait.equipment || []).forEach((itemId) => {
        if ($dataWeapons[itemId]) {
          $gameParty.gainItem($dataWeapons[itemId], 1);
        } else if ($dataArmors[itemId]) {
          $gameParty.gainItem($dataArmors[itemId], 1);
        }
      });

      // Set switches
      (trait.switches || []).forEach((switchId) => {
        $gameSwitches.setValue(switchId, true);
      });
    });

    // Store selected traits and refresh
    actor._selectedTraits = selectedTraits;
    actor.refresh();
  }

  /**
   * Add parameter modification to actor
   * @param {Game_Actor} actor - Actor to modify
   * @param {string} paramName - Parameter name (hp, mp, atk, def, mat, mdf, agi, luk, eva)
   * @param {number} value - Value to add
   */
  function addParamToActor(actor, paramName, value) {
    const paramMap = {
      hp: 0,
      mp: 1,
      atk: 2,
      def: 3,
      mat: 4,
      mdf: 5,
      agi: 6,
      luk: 7
    };

    const paramId = paramMap[paramName];
    if (typeof paramId === 'number') {
      if (!actor._paramPlus) {
        actor._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
      }
      actor._paramPlus[paramId] = (actor._paramPlus[paramId] || 0) + value;
    } else if (paramName === 'eva') {
      console.log(`Evasion modifier: ${value} (implement via traits if needed)`);
    }
  }

  //=============================================================================
  // The navigation bar every creation screen ends with
  //=============================================================================
  // One shape for every step, sub-step and side menu the creator opens: Back on
  // the far left, whatever extra actions the step offers (Random, Skip, ...) in
  // the middle, and Continue on the far right. The three slots are always
  // emitted, empty or not, so a step that has no Back button (the first one) or
  // no extras does not slide Continue across the bar , the two controls the
  // player navigates with sit in exactly the same place on every screen.
  //
  // A slot is never given `display: none` for the same reason: a control that is
  // temporarily unavailable is hidden with `visibility` (see ccSetButtonShown)
  // and keeps its footprint.
  const CCButtons = {
    // Labels, so no screen invents its own wording for the same control.
    backLabel() { return T("CharCreate.back"); },
    continueLabel() { return T("CharCreate.continue"); },
    randomLabel() { return T("CharCreate.randomBust"); },
    titleLabel() { return T("CharCreate.returnToTitle"); },

    /**
     * One button.
     * @param {string} label - Text on the button
     * @param {object} opts - { onclick, id, confirm (gold styling), highlighted
     *                          (keyboard/controller cursor is on it), attrs }
     * @returns {string} HTML
     */
    button(label, opts = {}) {
      const { onclick = "", id = "", confirm = false, highlighted = false, attrs = "" } = opts;
      const cls = ["cc-btn-treaty", confirm ? "confirm" : "", highlighted ? "highlighted" : ""]
        .filter(Boolean).join(" ");
      return `<button class="${cls}"` +
        `${id ? ` id="${id}"` : ""}${onclick ? ` onclick="${onclick}"` : ""}` +
        `${attrs ? ` ${attrs}` : ""}>${label}</button>`;
    },

    /**
     * The bar itself. Every slot takes raw HTML (or an array of it), so a step
     * that wants two extras just passes both.
     * @param {object} slots - { back, middle, next, style }
     * @returns {string} HTML
     */
    panel(slots = {}) {
      const { back = "", middle = "", next = "", style = "" } = slots;
      const mid = Array.isArray(middle) ? middle.join("") : middle;
      return `
        <div class="cc-button-panel cc-nav"${style ? ` style="${style}"` : ""}>
          <div class="cc-nav-slot cc-nav-back">${back}</div>
          <div class="cc-nav-slot cc-nav-mid">${mid}</div>
          <div class="cc-nav-slot cc-nav-next">${next}</div>
        </div>
      `;
    },

    /**
     * Same bar, built into an existing element for the screens that wire their
     * buttons up with addEventListener rather than inline handlers.
     * @param {Element} panelEl - The .cc-button-panel element
     * @returns {object} { back, mid, next } slot elements
     */
    slots(panelEl) {
      if (!panelEl) return { back: null, mid: null, next: null };
      panelEl.classList.add("cc-button-panel", "cc-nav");
      panelEl.innerHTML =
        `<div class="cc-nav-slot cc-nav-back"></div>` +
        `<div class="cc-nav-slot cc-nav-mid"></div>` +
        `<div class="cc-nav-slot cc-nav-next"></div>`;
      return {
        back: panelEl.querySelector(".cc-nav-back"),
        mid: panelEl.querySelector(".cc-nav-mid"),
        next: panelEl.querySelector(".cc-nav-next"),
      };
    },

    /**
     * Show / hide a control without moving its neighbours.
     * @param {Element} el - The button
     * @param {boolean} shown - Whether it can be used
     */
    setShown(el, shown) {
      if (!el) return;
      el.style.visibility = shown ? "visible" : "hidden";
      el.style.pointerEvents = shown ? "" : "none";
    },
  };

  //=============================================================================
  // Scrolling for the DOM overlays (mouse wheel + L2/R2 triggers)
  //=============================================================================
  // RMMZ swallows every wheel event at the document level (rmmz_core.js,
  // TouchInput._onWheel calls preventDefault), so no DOM overlay ever scrolls
  // on its own: each scrollable pane needs an explicit handler. CCScroll is
  // that handler, shared by every character creation scene, plus a per-frame
  // poll of the analog triggers so L2/R2 scroll exactly what a wheel would.
  //
  // The wheel handler is bound once per container element and resolves
  // everything live from the DOM, so it survives the scene swaps that reuse
  // the shared #character-creation-container without leaking stale closures.
  //
  // A scene can steer it by defining either of these methods:
  //   ccScrollTarget()  -> Element the triggers (and a wheel that lands outside
  //                        any pane) should scroll
  //   ccScrollStep(dir) -> handle one notch itself (dir is -1 up / +1 down);
  //                        return true when consumed, e.g. to move a selection
  //                        instead of scrolling
  const CCScroll = {
    // Pixels per frame at a fully pulled trigger, and the pull below which a
    // trigger reads as released (some pads rest slightly above zero).
    TRIGGER_SPEED: 26,
    TRIGGER_DEADZONE: 0.15,
    // Key-repeat cadence, in frames, for scenes that take discrete steps.
    STEP_WAIT: 20,
    STEP_INTERVAL: 5,
    // How deep below the container a scrollable pane can sit. Panes are always
    // a page's own child or grandchild, so the walk stays cheap even when a
    // pane holds hundreds of cards.
    MAX_DEPTH: 5,

    _px: -1,
    _py: -1,
    _hold: 0,
    _regions: null,
    _regionsAt: -1,

    isScrollable(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.scrollHeight - el.clientHeight < 2) return false;
      const overflow = getComputedStyle(el).overflowY;
      return overflow === "auto" || overflow === "scroll";
    },

    // Nearest scrollable pane at or above `node`, stopping at `root`.
    regionAt(node, root) {
      let el = node;
      while (el && el.nodeType === 1) {
        if (this.isScrollable(el)) return el;
        if (el === root) break;
        el = el.parentElement;
      }
      return null;
    },

    // Every scrollable pane inside `root`, in document order. A pane is never
    // searched for nested panes, and the walk is depth limited, so this stays
    // cheap; the result is cached for a few frames because it only ever runs
    // while a trigger is held.
    regions(root) {
      if (!root) return [];
      if (this._regions && this._regionsAt === Graphics.frameCount) return this._regions;
      const found = [];
      const walk = (el, depth) => {
        if (depth > this.MAX_DEPTH) return;
        for (const child of el.children) {
          if (this.isScrollable(child)) {
            found.push(child);
          } else {
            walk(child, depth + 1);
          }
        }
      };
      walk(root, 0);
      this._regions = found;
      this._regionsAt = Graphics.frameCount;
      return found;
    },

    regionUnderPointer(root) {
      if (this._px < 0 || !document.elementFromPoint) return null;
      const el = document.elementFromPoint(this._px, this._py);
      if (!el || !root.contains(el)) return null;
      return this.regionAt(el, root);
    },

    // The pane L2/R2 act on: whatever the scene names, else the one under the
    // pointer, else the details page (the right page of a spread, which the
    // selection cursor never scrolls for you), else the first pane there is.
    target(root) {
      const scene = SceneManager._scene;
      if (scene && typeof scene.ccScrollTarget === "function") {
        const named = scene.ccScrollTarget();
        if (this.isScrollable(named)) return named;
      }
      const hovered = this.regionUnderPointer(root);
      if (hovered) return hovered;
      const regions = this.regions(root);
      return regions.find((r) => r.closest(".cc-page-right")) || regions[0] || null;
    },

    // Wheel deltas arrive in pixels, lines or pages depending on the device.
    _wheelDelta(e) {
      if (e.deltaMode === 1) return e.deltaY * 40;
      if (e.deltaMode === 2) return e.deltaY * 400;
      return e.deltaY;
    },

    _onWheel(e, root) {
      const scene = SceneManager._scene;
      if (scene && typeof scene.ccScrollStep === "function" &&
        scene.ccScrollStep(e.deltaY > 0 ? 1 : -1)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const pane = this.regionAt(e.target, root) || this.target(root);
      if (!pane) return;
      pane.scrollTop += this._wheelDelta(e);
      e.preventDefault();
      e.stopPropagation();
    },

    // Idempotent: the overlay container outlives the scene that built it.
    bindWheel(container) {
      if (!container || container._ccScrollBound) return;
      container._ccScrollBound = true;
      container.addEventListener("wheel", (e) => this._onWheel(e, container), { passive: false });
      container.addEventListener("pointermove", (e) => {
        this._px = e.clientX;
        this._py = e.clientY;
      });
    },

    // Per-frame trigger poll. Call from the scene's update() while the overlay
    // is visible: L2 scrolls up, R2 scrolls down.
    update(container) {
      if (!container || container.style.display === "none") return;
      const pads = window.AnalogStickInput;
      if (!pads) return;
      const dz = this.TRIGGER_DEADZONE;
      const pull = (v) => (v > dz ? (v - dz) / (1 - dz) : 0);
      const amount = (pull(pads.rightTrigger()) - pull(pads.leftTrigger())) * this.TRIGGER_SPEED;
      if (!amount) {
        this._hold = 0;
        return;
      }
      this._hold++;
      const scene = SceneManager._scene;
      if (scene && typeof scene.ccScrollStep === "function") {
        // Discrete stepping repeats on the same cadence as a held direction.
        const t = this._hold;
        const fires = t === 1 || (t >= this.STEP_WAIT && (t - this.STEP_WAIT) % this.STEP_INTERVAL === 0);
        if (fires && scene.ccScrollStep(amount > 0 ? 1 : -1)) return;
      }
      const pane = this.target(container);
      if (pane) pane.scrollTop += amount;
    }
  };

  //=============================================================================
  // Creature classes , which classes an EnemyArchetypes archetype can be played
  // as. Every archetype in js/db/Health/EnemyArchetypes.json carries its own
  // roster (DataService loads the file as window.Health.EnemyArchetypes), as
  // two arrays of $dataClasses ids:
  //
  //   classes         , the civilised roster, ids 1-62. The humanoids, the
  //                     slime and the mimic take all 62, everyone else the
  //                     classes their culture, creed or nature supports.
  //   creatureClasses , the monstrous roster, ids 63-70 (Feral, Mimic,
  //                     Monster, Mana Cyborg, Ghost, Zombie, Mutant, Drone).
  //                     Never empty, so every archetype can be played as the
  //                     thing it is.
  //
  // A creature built from two archetypes is offered the classes supported by
  // BOTH of them; when the two share nothing, only the fallback (Monster) is
  // offered. Ids are checked against $dataClasses on every call, so a removed
  // class simply drops out of the roster.
  //=============================================================================

  // Offered when an archetype (or a hybrid) supports nothing else.
  const CREATURE_FALLBACK_CLASS_ID = 65; // Monster

  // Highest id of the civilised roster. Everything above it, Feral (63) and
  // every class after it, is a creature class and is only ever reached through
  // an archetype's creatureClasses roster: a person is never built from one,
  // nor rolled into one by any of the randomizers.
  const SENTIENT_CLASS_MAX = 62;

  const CreatureClasses = {
    _data() {
      return (window.Health && window.Health.EnemyArchetypes) || null;
    },

    // Drops ids no class in the database answers to.
    _known(ids) {
      if (!Array.isArray(ids)) return [];
      return ids.filter((id) => $dataClasses[id] && $dataClasses[id].name);
    },

    // Severed hides every Magical class, unbound hides every Mundane one
    // (both/untagged always pass); see window.MagicNature. Freelancer (1)
    // and Monster (65, CREATURE_FALLBACK_CLASS_ID) are tagged
    // <Nature: Both> in Classes.json specifically so this never strips them.
    // Falls back to the unfiltered set when a scope would be emptied
    // entirely, so a narrow archetype or hybrid is never left with nothing
    // to be at all.
    _magicAllowed(ids) {
      const MN = window.MagicNature;
      if (!MN || !MN.isFiltering()) return ids;
      const kept = ids.filter((id) => MN.allowsData($dataClasses[id]));
      return kept.length > 0 ? kept : ids;
    },

    // Class id of the "nothing fits" class, Monster by default.
    fallbackId() {
      return CREATURE_FALLBACK_CLASS_ID;
    },

    // Highest class id a person can be built from.
    sentientMax() {
      return SENTIENT_CLASS_MAX;
    },

    // True when the id belongs to the monstrous roster (Feral upward).
    isCreatureClass(classId) {
      return Number(classId) > SENTIENT_CLASS_MAX;
    },

    // Every class a person may be built from or rolled into, the one list the
    // humanoid randomizers draw on.
    sentientRoster() {
      const ids = ($dataClasses || [])
        .filter((c) => c && c.id > 0 && c.id <= SENTIENT_CLASS_MAX && c.name)
        .map((c) => c.id);
      return this._magicAllowed(ids);
    },

    // The civilised roster of a single archetype key, [] when the archetype is
    // unknown.
    civilisedFor(key) {
      const data = this._data();
      if (!key || !data || !data[key]) return [];
      return this._magicAllowed(this._known(data[key].classes));
    },

    // The monstrous roster of a single archetype key, [] when the archetype is
    // unknown.
    creatureFor(key) {
      const data = this._data();
      if (!key || !data || !data[key]) return [];
      return this._magicAllowed(this._known(data[key].creatureClasses));
    },

    // Everything a single archetype can be played as, its own kind last.
    forArchetype(key) {
      return this.civilisedFor(key).concat(this.creatureFor(key));
    },

    // The two rosters a finished creature is offered, kept apart so the class
    // browser can head them ("Non Sentient" / "Sentient"). One archetype: its
    // own two lists. Two: the intersection of each. The creature list is never
    // empty , a pair that shares nothing at all is still a Monster.
    groupsForArchetypes(key1, key2) {
      const pick = (getter) => {
        let ids = this[getter](key1);
        if (key2 && key2 !== key1) {
          const second = new Set(this[getter](key2));
          ids = ids.filter((id) => second.has(id));
        }
        return ids;
      };
      const creature = pick("creatureFor");
      const sentient = pick("civilisedFor");
      if (!creature.length && !sentient.length) {
        return { creature: [this.fallbackId()], sentient: [] };
      }
      return { creature, sentient };
    },

    // The same two rosters as one flat list, the creature's own kind first.
    // Never empty.
    forArchetypes(key1, key2) {
      const groups = this.groupsForArchetypes(key1, key2);
      return groups.creature.concat(groups.sentient);
    },

    // Same, resolved from an actor's stored archetype ("A" or "A / B", written
    // by Health_Core / the creature builder).
    forActor(actor) {
      const stored = actor && actor._currentArchetype;
      if (!stored) return [this.fallbackId()];
      const parts = String(stored).split("/").map((s) => s.trim()).filter(Boolean);
      return this.forArchetypes(parts[0], parts[1]);
    },
  };

  //=============================================================================
  // Exports to Global Namespace
  //=============================================================================

  window.CCScroll = CCScroll;
  window.CCButtons = CCButtons;
  window.CreatureClasses = CreatureClasses;
  // Global alias: the creation panels are template-literal heavy, and every
  // database name they print goes through this.
  window.CCDbName = dbName;

  window.CharacterCreationUtils = {
    // Constants
    VAR_PLAYER1_GENDER,
    VAR_PLAYER2_GENDER,
    VAR_PLAYER3_GENDER,
    VAR_PLAYER1_REPRODUCTIVE_TYPE,
    VAR_PLAYER2_REPRODUCTIVE_TYPE,
    VAR_PLAYER3_REPRODUCTIVE_TYPE,
    GENDER_TYPES,
    REPRODUCTION_TYPES,

    // Localization
    getLocalizedChoice,
    dbName,

    // Gender & Reproduction
    getGenderVariableId,
    getReproductiveVariableId,
    applyGenderAndReproduction,
    applyRandomGender,
    getGenderChoices,

    // Traits
    applyTraitsToActor,
    addParamToActor
  };

  console.log(`${pluginName} loaded successfully.`);
})();
