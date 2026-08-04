//=============================================================================
// TraitSelector.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Trait Selector Menu v1.3.0
 * @author Omni-Lex
 * @version 1.3.0
 * @description A trait selection menu that affects player stats and abilities
 *
 * @help TraitSelector.js
 *
 * This plugin creates a trait selection menu where players must choose 4 traits
 * that will affect their character's base stats, skills, items, and equipment.
 *
 * The scene is drawn entirely by the shared character creation overlay
 * (#character-creation-container), so it uses the same book spread, cards,
 * dossier panels and treaty buttons as every other creation step.
 *
 * Plugin Command:
 * Use "Open Trait Selector" in the plugin commands menu
 *
 * Script call to open the trait selector:
 * SceneManager.push(Scene_TraitSelector);
 *
 * @command openTraitSelector
 * @text Open Trait Selector
 * @desc Opens the trait selection menu
 *
 * @command openTraitSelectorForCreation
 * @text Open Trait Selector (Character Creation)
 * @desc Opens the trait selector and returns to character creation when done
 *
 * @arg actorId
 * @text Actor ID
 * @desc The ID of the actor to apply traits to (leave blank for default)
 * @type actor
 * @default 1
 *
 * @command randomizeTraits
 * @text Randomize Traits
 * @desc Randomly selects and applies 5 compatible traits to the actor
 *
 * @param switchIds
 * @text Switch IDs to Reset
 * @desc Comma-separated list of switch IDs that will be turned OFF when opening the menu
 * @type string
 * @default 1,2,3,4,5,6,7,8,9,10,11,12
 *
 * @param actorId
 * @text Actor ID
 * @desc The ID of the actor that will receive the trait bonuses
 * @type actor
 * @default 1
 */

(() => {
  "use strict";

  const pluginName = "TraitSelector";
  const parameters = PluginManager.parameters(pluginName);
  const switchIds = String(parameters["switchIds"] || "")
    .split(",")
    .map((id) => parseInt(id.trim()))
    .filter((id) => id > 0);
  const actorId = parseInt(parameters["actorId"]) || 1;
  const getTraits = () => (window.Health ? window.Health.Traits || [] : []);
  // Database display names, localized. This plugin loads before
  // CharacterCreationShared, so the lookup stays lazy.
  const dbName = (entry) =>
    window.CCDbName ? window.CCDbName(entry) : (entry && entry.name) || "";

  // Columns in the trait card grid; keep in sync with .cc-trait-grid in
  // theme.css so keyboard up/down moves the cursor by one visual row.
  const TRAIT_GRID_COLS = 4;

  const TRAIT_CATEGORIES = ["genetic", "physical", "mental", "magical"];
  const TRAIT_CATEGORY_LABELS = {
    genetic: "tabGenetic",
    physical: "tabPhysical",
    mental: "tabMental",
    magical: "tabMagical",
  };   // i18n-ignore: keys into Traits.<tab*>

  const t = (key) => T('Traits.' + key);

  let _statsI18n = null;

  const _loadStatsI18n = async () => {
    const lang = ConfigManager.language || 'en';
    const url = `js/i18n/${lang}/stats.json`;
    try {
      const response = await fetch(url);
      _statsI18n = await response.json();
    } catch (e) {
      console.error('TraitSelector: Failed to load i18n data from ' + url, e);
    }
  };

  const _si18n = (key) => {
    if (_statsI18n && _statsI18n[key]) {
      return _statsI18n[key];
    }
    return key;
  };

  _loadStatsI18n();

  let i18nData = null;

  const loadI18nData = async () => {
    const lang = ConfigManager.language || "en";
    const url = `js/i18n/${lang}/traits.json`;
    try {
      const response = await fetch(url);
      i18nData = await response.json();
    } catch (e) {
      console.error("TraitSelector: Failed to load i18n data from " + url, e);
    }
  };

  const resolveI18nPath = (path, obj) => {
    if (!path || !obj) return null;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  // Register plugin commands
  PluginManager.registerCommand(pluginName, "openTraitSelector", (args) => {
    Scene_TraitSelector.prepare(false, null);
    SceneManager.push(Scene_TraitSelector);
  });

  // New command: Open trait selector during character creation
  PluginManager.registerCommand(pluginName, "openTraitSelectorForCreation", (args) => {
    const targetActorId = args.actorId ? parseInt(args.actorId) : actorId;
    Scene_TraitSelector.prepare(true, targetActorId);
    SceneManager.push(Scene_TraitSelector);
  });

  // Helper function to get translated trait property
  const getTraitText = (trait, type) => {
    if (!trait) return "";
    const intKey = trait[type];
    if (intKey && i18nData) {
      const localized = resolveI18nPath(intKey, i18nData);
      if (localized) return localized;
    }
    const useTranslation = ConfigManager.language === "it";
    const value = trait[type];
    if (typeof value === "object" && value !== null) {
      return useTranslation ? value.it : value.en;
    }
    return value || (trait[type] || "");
  };

  const getParamDisplayName = (paramKey) => {
    const displayNames = {
      hp: _si18n("HP"),
      mp: _si18n("MP"),
      atk: _si18n("ATT"),
      def: _si18n("DEF"),
      mat: _si18n("M.ATT"),
      mdf: _si18n("M.DEF"),
      agi: _si18n("AGILITY"),
      luk: _si18n("LUCK"),
      eva: "EVA"
    };

    return displayNames[paramKey] || paramKey;
  };

  // Specializations (js/db/Skills/Specialization.json via SpecializationMenu.js)
  // that this trait grants a head start in, sorted by name. Returns [] until
  // window.Specializations finishes its async load.
  const getTraitGrantedSpecializations = (trait) => {
    if (!trait || !trait.name || !window.Specializations || !window.Specializations.ready) return [];
    const slug = trait.name.split(".")[1];
    if (!slug) return [];
    const rows = [];
    window.Specializations.list.forEach((spec) => {
      const lvl = spec.traitStart && spec.traitStart[slug];
      if (lvl) rows.push({ name: spec.name, levelName: window.Specializations.levelName(lvl) });
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  };

  //-----------------------------------------------------------------------------
  // Scene_TraitSelector
  //-----------------------------------------------------------------------------
  // The whole scene is the shared character creation overlay: a book spread
  // whose LEFT page holds the category tabs, the trait cards and the details of
  // the highlighted trait, and whose RIGHT page holds the four bound slots, the
  // running tally and the granted skills. No RPG Maker window is drawn, the
  // cursor lives in the scene itself.

  class Scene_TraitSelector extends Scene_MenuBase {
    static _returnToCharacterCreation = false; // Flag to control return behavior
    static _targetActorId = null; // Track which actor to apply traits to

    static prepare(returnToCreation = false, targetActorId = null) {
      Scene_TraitSelector._returnToCharacterCreation = returnToCreation;
      Scene_TraitSelector._targetActorId = targetActorId;
    }

    create() {
      super.create();
      this._selectedTraits = [];
      this._currentCategory = TRAIT_CATEGORIES[0];
      this._cursor = 0;
      // Confirmation prompt: null when closed, otherwise the focused answer.
      this._confirmYes = null;
      this._categoryCache = {};
      // Only keyboard movement scrolls the grid to the cursor; mouse hover
      // must never yank the list under the pointer.
      this._keyboardCursor = true;
      loadI18nData().then(() => {
        this.resetSwitches();
        this.resetActorTraits();
        this.createUIOverlay();
      });
    }

    terminate() {
      super.terminate();
      if (this._dndContainer) {
        this._dndContainer.style.display = "none";
      }
    }

    createBackground() {
      this._backgroundSprite = new Sprite();
      this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
      this.addChild(this._backgroundSprite);
    }

    createUIOverlay() {
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
      this._dndContainer.style.display = "flex";
      this._dndContainer.style.opacity = "1";
      this._dndContainer.style.pointerEvents = "auto";
      this._dndContainer.innerHTML = ""; // Wipe clean to prevent stale DOM layout leaking

      this._sig = { category: null, selection: null, cursor: -1, hover: -1, specsReady: null, confirm: null };
      this._cardEls = [];
      // Wheel + L2/R2 scrolling for the pages. See CCScroll.
      if (window.CCScroll) window.CCScroll.bindWheel(this._dndContainer);
      this.buildOverlayDOM();
    }

    // CCScroll hook: the triggers scroll the card grid, the pane the cursor
    // lives in (a wheel over any other pane still scrolls that pane).
    ccScrollTarget() {
      return this._el ? this._el.grid : null;
    }

    // Sprite from IconSet.png at an arbitrary size. The sheet is 16 icons wide
    // at 32px each, so scaling the whole sheet keeps every cell square.
    getIconStyle(iconIndex, size = 32) {
      const box = `width:${size}px; height:${size}px; display:inline-block; flex:0 0 auto;`;
      if (!iconIndex) return box;
      const col = iconIndex % 16;
      const row = Math.floor(iconIndex / 16);
      return `${box} background-image:url('img/system/IconSet.png'); background-size:${size * 16}px auto; background-position:-${col * size}px -${row * size}px; image-rendering:pixelated;`;
    }

    currentTraits() {
      const category = this._currentCategory || TRAIT_CATEGORIES[0];
      if (!this._categoryCache) this._categoryCache = {};
      if (!this._categoryCache[category]) {
        const rows = getTraits().filter((trait) => (trait.category || "mental") === category);
        // Do not memoise an empty result: window.Health may still be loading.
        if (!rows.length) return rows;
        this._categoryCache[category] = rows;
      }
      return this._categoryCache[category];
    }

    currentTrait() {
      return this.currentTraits()[this._cursor] || null;
    }

    onTabClick(category) {
      if (this._currentCategory === category) return;
      SoundManager.playCursor();
      this._currentCategory = category;
      this._cursor = 0;
      this.syncOverlay(false);
    }

    cycleCategory(step) {
      const at = TRAIT_CATEGORIES.indexOf(this._currentCategory);
      const next = TRAIT_CATEGORIES[(at + step + TRAIT_CATEGORIES.length) % TRAIT_CATEGORIES.length];
      this.onTabClick(next);
    }

    // A trait can be bound unless it is already bound, the four slots are full,
    // or it clashes with something already bound.
    traitState(trait) {
      const selected = this._selectedTraits.includes(trait);
      const incompatible = !selected && this._selectedTraits.some(
        (bound) =>
          (trait.incompatible || []).includes(bound.id) ||
          (bound.incompatible || []).includes(trait.id)
      );
      const blocked = !selected && (incompatible || this._selectedTraits.length >= 4);
      return { selected, incompatible, blocked };
    }

    calculateTotalBonuses() {
      const totals = { hp: 0, mp: 0, atk: 0, def: 0, mat: 0, mdf: 0, agi: 0, luk: 0 };
      this._selectedTraits.forEach((trait) => {
        Object.keys(trait.positive || {}).forEach((k) => { if (totals[k] !== undefined) totals[k] += trait.positive[k]; });
        Object.keys(trait.negative || {}).forEach((k) => { if (totals[k] !== undefined) totals[k] += trait.negative[k]; });
      });
      return totals;
    }

    // --- Overlay rendering -------------------------------------------------
    // The markup is built exactly once; every later change patches only the
    // panel that actually changed (state classes on the cards, the detail
    // card, the bound slots). Nothing rebuilds on cursor movement, so the
    // overlay never flickers.

    buildOverlayDOM() {
      const tabsHtml = TRAIT_CATEGORIES.map((category) =>
        `<div class="cc-card-option" data-category="${category}"><div class="cc-option-title">${t(TRAIT_CATEGORY_LABELS[category])}</div></div>`
      ).join("");

      this._dndContainer.innerHTML = `
        <div class="cc-pockets-spread">
          <div class="cc-page cc-page-left" style="display: flex; flex-direction: column;">
            <h2 class="cc-header-gothic">${t('titleTraits')}</h2>
            <p class="cc-text-desc" style="margin-bottom: 0;">${t("headerText")}</p>

            <div class="cc-select-grid cc-compact cc-tab-row" id="ts-tabs">${tabsHtml}</div>
            <div class="cc-select-grid cc-compact cc-trait-grid" id="ts-grid"></div>
            <div id="ts-info" style="flex: 0 0 auto; height: 26%; min-height: 148px; overflow-y: auto; margin-top: 12px;"></div>
          </div>

          <div class="cc-page cc-page-right" style="display: flex; flex-direction: column;">
            <h2 class="cc-header-gothic">${t("selectedTraitsLabel")}</h2>

            <div class="cc-dossier-card" id="ts-slots"></div>

            <div class="cc-dossier-card">
              <h3 class="cc-subheader">${t("totalBonuses")}</h3>
              <div id="ts-bonuses" style="display: flex; flex-wrap: wrap; gap: 6px;"></div>
            </div>

            <div class="cc-dossier-card" style="flex: 1 1 auto; min-height: 80px; overflow-y: auto;">
              <h3 class="cc-subheader">${t("finalSkills")}</h3>
              <div id="ts-skills" style="display: flex; flex-wrap: wrap; gap: 6px;"></div>
            </div>

            <div class="cc-button-panel">
              <button class="cc-btn-treaty confirm" id="ts-btn-confirm">${t('confirm')}</button>
            </div>
          </div>

          <div id="ts-prompt" style="position: absolute; inset: 0; z-index: 1200; display: none; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.55);"></div>
        </div>
      `;

      const q = (selector) => this._dndContainer.querySelector(selector);
      this._el = {
        tabs: q("#ts-tabs"),
        grid: q("#ts-grid"),
        info: q("#ts-info"),
        slots: q("#ts-slots"),
        bonuses: q("#ts-bonuses"),
        skills: q("#ts-skills"),
        prompt: q("#ts-prompt"),
      };

      this._el.tabs.querySelectorAll(".cc-card-option").forEach((el) => {
        el.addEventListener("click", () => this.onTabClick(el.dataset.category));
      });
      q("#ts-btn-confirm").addEventListener("click", () => this.openPrompt());

      this.syncOverlay(true);
    }

    // Rebuilds the card grid. Only ever called on a category switch.
    renderGrid() {
      const traits = this.currentTraits();
      const frag = document.createDocumentFragment();
      this._cardEls = traits.map((trait, idx) => {
        const el = document.createElement("div");
        el.className = "cc-card-option";
        el.innerHTML = `
          <span style="${this.getIconStyle(trait.icon, 22)}"></span>
          <div class="cc-option-title">${getTraitText(trait, "name")}</div>
        `;
        el.addEventListener("click", () => this.onTraitCardClick(idx));
        el.addEventListener("mouseenter", () => this.onTraitCardHover(idx));
        frag.appendChild(el);
        return el;
      });
      this._el.grid.innerHTML = "";
      this._el.grid.appendChild(frag);
      this._el.grid.scrollTop = 0;

      this._el.tabs.querySelectorAll(".cc-card-option").forEach((el) => {
        el.classList.toggle("selected", el.dataset.category === this._currentCategory);
      });

      this._sig.category = this._currentCategory;
      this._sig.cursor = -1;
    }

    // Toggles state classes in place, no markup is recreated.
    syncCards(scrollToCursor) {
      const traits = this.currentTraits();
      this._cardEls.forEach((el, idx) => {
        const trait = traits[idx];
        if (!trait) return;
        const state = this.traitState(trait);
        el.classList.toggle("selected", state.selected);
        el.classList.toggle("disabled", state.blocked);
        el.classList.toggle("highlighted", idx === this._cursor);
      });
      if (scrollToCursor && this._keyboardCursor && this._cardEls[this._cursor]) {
        this._cardEls[this._cursor].scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    }

    // Detail card for the trait under the cursor.
    renderInfo(trait) {
      if (!trait) {
        this._el.info.innerHTML = "";
        return;
      }

      const statBadges = (stats, color) => Object.keys(stats || {}).map((key) => {
        const value = stats[key];
        const sign = value > 0 ? "+" : "";
        return `<span class="cc-element-badge" style="color: ${color};">${getParamDisplayName(key)} ${sign}${value}</span>`;
      }).join("");

      const iconBadge = (iconIndex, label, suffix) =>
        `<span class="cc-element-badge"><span style="${this.getIconStyle(iconIndex, 16)} margin-right: 6px;"></span>${label}${suffix ? ` ${suffix}` : ""}</span>`;

      // trait.items is a flat array with one entry per copy, so tally by id.
      const itemCounts = {};
      (trait.items || []).forEach((id) => { itemCounts[id] = (itemCounts[id] || 0) + 1; });
      const itemBadges = Object.keys(itemCounts).map((id) => {
        const item = $dataItems[id];
        return item ? iconBadge(item.iconIndex, dbName(item), itemCounts[id] > 1 ? `x${itemCounts[id]}` : "") : "";
      }).join("");

      const skillBadges = (trait.skills || []).map((id) => {
        const skill = $dataSkills[id];
        return skill ? iconBadge(skill.iconIndex, dbName(skill), "") : "";
      }).join("");

      const specBadges = getTraitGrantedSpecializations(trait)
        .map((row) => `<span class="cc-element-badge">${row.name} (${row.levelName})</span>`)
        .join("");

      const row = (label, content) => content ? `
        <div class="cc-dossier-row" style="align-items: flex-start; gap: 8px;">
          <span class="cc-dossier-label" style="flex: 0 0 auto;">${label}</span>
          <span style="display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end;">${content}</span>
        </div>
      ` : "";

      this._el.info.innerHTML = `
        <div class="cc-dossier-card" style="margin-bottom: 0;">
          <h3 class="cc-subheader" style="display: flex; align-items: center; gap: 8px;">
            <span style="${this.getIconStyle(trait.icon, 22)}"></span>${getTraitText(trait, "name")}
          </h3>
          <p class="cc-text-desc" style="text-align: left; margin-bottom: 10px;">${getTraitText(trait, "description")}</p>
          ${row(t("benefits"), statBadges(trait.positive, "var(--text-forest-green)"))}
          ${row(t("drawbacks"), statBadges(trait.negative, "var(--accent-red-3)"))}
          ${row(t("grantsSkills"), skillBadges)}
          ${row(t("startingItems"), itemBadges)}
          ${row(`${_si18n("Specializations")}:`, specBadges)}
        </div>
      `;
    }

    renderSlots() {
      let html = "";
      for (let i = 0; i < 4; i++) {
        const trait = this._selectedTraits[i];
        html += trait ? `
          <div class="cc-dossier-row" data-slot="${i}" style="cursor: pointer; align-items: center;">
            <span class="cc-dossier-label" style="display: flex; align-items: center; gap: 8px;">
              <span style="${this.getIconStyle(trait.icon, 20)}"></span>${i + 1}. ${getTraitText(trait, "name")}
            </span>
            <span class="cc-slot-remove">✕</span>
          </div>
        ` : `
          <div class="cc-dossier-row" style="opacity: 0.55;">
            <span class="cc-dossier-label">${i + 1}. ${t("emptySlot")}</span>
          </div>
        `;
      }
      this._el.slots.innerHTML = html;
      this._el.slots.querySelectorAll("[data-slot]").forEach((node) => {
        const slot = parseInt(node.dataset.slot, 10);
        node.addEventListener("click", () => this.onSlotClick(slot));
        node.addEventListener("mouseenter", () => this.onSlotHover(slot));
      });
    }

    renderBonuses() {
      const totals = this.calculateTotalBonuses();
      const badges = Object.keys(totals).filter((key) => totals[key] !== 0).map((key) => {
        const value = totals[key];
        const color = value > 0 ? "var(--text-forest-green)" : "var(--accent-red-3)";
        return `<span class="cc-element-badge" style="color: ${color};">${getParamDisplayName(key)} ${value > 0 ? "+" : ""}${value}</span>`;
      }).join("");
      this._el.bonuses.innerHTML = badges ||
        `<span class="cc-dossier-value" style="font-style: italic;">${t('noBonusesYet')}</span>`;
    }

    renderSkills() {
      const ids = [];
      this._selectedTraits.forEach((trait) => {
        (trait.skills || []).forEach((id) => {
          if ($dataSkills[id] && !ids.includes(id)) ids.push(id);
        });
      });
      this._el.skills.innerHTML = ids.length ? ids.map((id) => {
        const skill = $dataSkills[id];
        return `<span class="cc-element-badge"><span style="${this.getIconStyle(skill.iconIndex, 16)} margin-right: 6px;"></span>${dbName(skill)}</span>`;
      }).join("") : `<span class="cc-dossier-value" style="font-style: italic;">${t("noSkills")}</span>`;
    }

    // "Confirm these traits?" — yes or no, nothing else.
    renderPrompt() {
      const layer = this._el.prompt;
      if (this._confirmYes === null) {
        layer.style.display = "none";
        layer.innerHTML = "";
        this._promptBtns = null;
        return;
      }
      if (!this._promptBtns) {
        layer.innerHTML = `
          <div style="padding: 24px 32px; text-align: center; background: var(--gradient-1); border: 2px solid var(--border-primary-hover-translucent-15); border-radius: 10px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);">
            <h2 class="cc-header-gothic" style="margin: 0 0 18px 0; font-size: 1.5rem;">${t('confirmTraits')}</h2>
            <div class="cc-button-panel" style="margin-top: 0; padding-top: 0;">
              <button class="cc-btn-treaty confirm" data-yes="1">${t('yes')}</button>
              <button class="cc-btn-treaty" data-yes="0">${t('no')}</button>
            </div>
          </div>
        `;
        this._promptBtns = Array.from(layer.querySelectorAll("[data-yes]"));
        this._promptBtns.forEach((btn) => {
          btn.addEventListener("click", () => this.answerPrompt(btn.dataset.yes === "1"));
        });
      }
      layer.style.display = "flex";
      this._promptBtns.forEach((btn) => {
        btn.classList.toggle("highlighted", (btn.dataset.yes === "1") === this._confirmYes);
      });
    }

    // Single entry point: compares cheap signatures and patches only what
    // actually changed. Safe to call every frame.
    syncOverlay(force) {
      if (!this._el) return;
      const sig = this._sig;

      // The grid also rebuilds when window.Health lands after the first render
      // (the category was empty at build time).
      const starved = this._cardEls.length === 0 && this.currentTraits().length > 0;
      if (force || starved || sig.category !== this._currentCategory) this.renderGrid();

      const selectionSig = this._selectedTraits.map((trait) => trait.id).join(",");
      const selectionChanged = force || sig.selection !== selectionSig;
      if (selectionChanged) {
        sig.selection = selectionSig;
        this.renderSlots();
        this.renderBonuses();
        this.renderSkills();
      }

      const cursorChanged = sig.cursor !== this._cursor;
      if (cursorChanged || selectionChanged) {
        sig.cursor = this._cursor;
        this.syncCards(cursorChanged);
      }

      // window.Specializations loads asynchronously; fold its readiness into
      // the signature so the open card picks the rows up when it lands.
      const specsReady = !!(window.Specializations && window.Specializations.ready);
      const hovered = this.currentTrait();
      const hoverId = hovered ? hovered.id : -1;
      if (sig.hover !== hoverId || sig.specsReady !== specsReady) {
        sig.hover = hoverId;
        sig.specsReady = specsReady;
        this.renderInfo(hovered);
      }

      if (sig.confirm !== this._confirmYes) {
        sig.confirm = this._confirmYes;
        this.renderPrompt();
      }
    }

    // --- Interaction -------------------------------------------------------

    onTraitCardClick(index) {
      this._cursor = index;
      this.toggleTrait(this.currentTrait());
    }

    onTraitCardHover(index) {
      if (this._cursor !== index) {
        this._keyboardCursor = false;
        this._cursor = index;
      }
    }

    onSlotHover(slotIndex) {
      const trait = this._selectedTraits[slotIndex];
      if (!trait) return;
      this._currentCategory = trait.category || "mental";
      const index = this.currentTraits().indexOf(trait);
      if (index >= 0) {
        // Unlike a hover over the grid, this one may point far outside the
        // visible rows, so the card is scrolled into view.
        this._keyboardCursor = true;
        this._cursor = index;
      }
    }

    onSlotClick(slotIndex) {
      const trait = this._selectedTraits[slotIndex];
      if (trait) this.releaseTrait(trait);
    }

    // Binds a free trait, releases a bound one, buzzes on anything blocked.
    toggleTrait(trait) {
      if (!trait) return;
      const state = this.traitState(trait);
      if (state.selected) {
        this.releaseTrait(trait);
      } else if (state.blocked) {
        SoundManager.playBuzzer();
      } else {
        SoundManager.playOk();
        this._selectedTraits.push(trait);
        this.syncOverlay(false);
      }
    }

    releaseTrait(trait) {
      const at = this._selectedTraits.indexOf(trait);
      if (at < 0) return;
      SoundManager.playCancel();
      this._selectedTraits.splice(at, 1);
      this.syncOverlay(false);
    }

    releaseLast() {
      if (this._selectedTraits.length > 0) {
        this.releaseTrait(this._selectedTraits[this._selectedTraits.length - 1]);
      } else {
        SoundManager.playBuzzer();
      }
    }

    openPrompt() {
      if (this._selectedTraits.length !== 4) {
        SoundManager.playBuzzer();
        return;
      }
      SoundManager.playOk();
      this._confirmYes = true;
      this.syncOverlay(false);
    }

    answerPrompt(yes) {
      if (!yes) {
        SoundManager.playCancel();
        this._confirmYes = null;
        this.syncOverlay(false);
        return;
      }
      SoundManager.playOk();
      this._confirmYes = null;
      this.applyTraits();
      Scene_TraitSelector._returnToCharacterCreation = false;
      Scene_TraitSelector._targetActorId = null;
      this.popScene();
    }

    updateInput() {
      if (this._confirmYes !== null) {
        if (Input.isTriggered("left") || Input.isTriggered("right")) {
          SoundManager.playCursor();
          this._confirmYes = !this._confirmYes;
        } else if (Input.isTriggered("ok")) {
          this.answerPrompt(this._confirmYes);
        } else if (Input.isTriggered("cancel")) {
          this.answerPrompt(false);
        }
        return;
      }

      // L1 / R1 on a pad, Q / PageUp-PageDown on the keyboard, cycle the tabs.
      if (Input.isTriggered("pageup")) { this.cycleCategory(-1); return; }
      if (Input.isTriggered("pagedown")) { this.cycleCategory(1); return; }

      const maxItems = this.currentTraits().length;
      if (maxItems <= 0) return;

      const cols = TRAIT_GRID_COLS;
      let index = Math.min(this._cursor, maxItems - 1);
      let moved = false;

      if (Input.isRepeated("down")) {
        index = (index + cols < maxItems) ? index + cols : index % cols;
        moved = true;
      } else if (Input.isRepeated("up")) {
        if (index - cols >= 0) {
          index -= cols;
        } else {
          let target = Math.floor((maxItems - 1) / cols) * cols + (index % cols);
          if (target >= maxItems) target -= cols;
          index = target >= 0 ? target : 0;
        }
        moved = true;
      } else if (Input.isRepeated("right") && index % cols < cols - 1 && index + 1 < maxItems) {
        index++; moved = true;
      } else if (Input.isRepeated("left") && index % cols > 0) {
        index--; moved = true;
      } else if (Input.isTriggered("ok")) {
        // With four traits bound the only thing left to do is seal them, so OK
        // raises the prompt instead of buzzing on a blocked card. OK on a bound
        // card still releases it.
        const trait = this.currentTrait();
        if (this._selectedTraits.length >= 4 && !this._selectedTraits.includes(trait)) {
          this.openPrompt();
        } else {
          this.toggleTrait(trait);
        }
      } else if (Input.isTriggered("cancel")) {
        this.releaseLast();
      }

      if (moved) {
        SoundManager.playCursor();
        this._keyboardCursor = true;
        this._cursor = index;
      }
    }

    update() {
      super.update();

      if (this._dndContainer && this._dndContainer.style.display !== "none") {
        this.updateInput();
        if (window.CCScroll) window.CCScroll.update(this._dndContainer);
        // syncOverlay is signature-driven: it touches the DOM only when
        // something really changed, so polling it every frame is free.
        this.syncOverlay(false);
      }
    }

    // --- Applying the picked traits ---------------------------------------

    applyTraits() {
      const targetId = Scene_TraitSelector._targetActorId || actorId;
      const actor = $gameActors.actor(targetId);

      if (!actor) {
        console.error(`Actor with ID ${targetId} not found!`);
        return;
      }

      // Revert any previously applied trait grants first so re-entering this
      // step (via Back) does not stack param bonuses or re-grant skills/items.
      revertTraitGrants(actor, actor._selectedTraits);
      actor._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];

      // Store selected traits on the actor
      actor._selectedTraits = this._selectedTraits.slice(); // Copy array

      this._selectedTraits.forEach((trait) => {
        Object.keys(trait.positive).forEach((param) => {
          this.addParam(actor, param, trait.positive[param]);
        });
        Object.keys(trait.negative).forEach((param) => {
          this.addParam(actor, param, trait.negative[param]);
        });

        trait.skills.forEach((skillId) => {
          if ($dataSkills[skillId]) {
            actor.learnSkill(skillId);
          }
        });

        trait.items.forEach((itemId) => {
          if ($dataItems[itemId]) {
            $gameParty.gainItem($dataItems[itemId], 1);
          }
        });

        trait.equipment.forEach((itemId) => {
          if ($dataWeapons[itemId]) {
            $gameParty.gainItem($dataWeapons[itemId], 1);
          } else if ($dataArmors[itemId]) {
            $gameParty.gainItem($dataArmors[itemId], 1);
          }
        });

        trait.switches.forEach((switchId) => {
          $gameSwitches.setValue(switchId, true);
        });
      });

      actor.refresh();
    }

    // New method to apply traits by ID array (for use by other plugins like ClassSelector)
    applyTraitsByIds(traitIds, targetActorId = null) {
      const targetId = targetActorId || actorId;
      const actor = $gameActors.actor(targetId);

      if (!actor) {
        console.error(`Actor with ID ${targetId} not found!`);
        return;
      }

      if (!traitIds || traitIds.length === 0) {
        console.warn('No trait IDs provided');
        return;
      }

      // Get the Traits array from ProstheticsData
      const TraitsArray = window.Health && window.Health.Traits;
      if (!TraitsArray) {
        console.error('Traits array not found. Is DB.js loaded?');
        return;
      }

      // Revert any previously applied trait grants first so re-applying (via
      // preset/programmatic path) does not stack param bonuses or re-grant
      // skills/items/equipment (mirrors applyTraits).
      revertTraitGrants(actor, actor._selectedTraits);
      actor._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];

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
          this.addParam(actor, param, trait.positive[param]);
        });

        // Apply negative bonuses
        Object.keys(trait.negative || {}).forEach((param) => {
          this.addParam(actor, param, trait.negative[param]);
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

      console.log(
        `Applied ${selectedTraits.length} trait(s) to actor ${targetId}: ${selectedTraits
          .map((t) => getTraitText(t, 'name'))
          .join(', ')}`
      );
    }

    addParam(actor, paramName, value) {
      const paramMap = {
        hp: 0,      // Max HP (unchanged)
        mp: 1,      // Max MP (unchanged)
        atk: 2,     // STR (was atk)
        def: 3,     // CON (was def)
        mat: 4,     // INT (was mat)
        mdf: 5,     // SAG (was mdf)
        agi: 6,     // DES (was agi)
        luk: 7,     // PSI (was luk)
      };

      const paramId = paramMap[paramName];
      if (typeof paramId === "number") {
        if (!actor._paramPlus) {
          actor._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
        }
        actor._paramPlus[paramId] = (actor._paramPlus[paramId] || 0) + value;
      }
    }

    resetActorTraits() {
      const targetId = Scene_TraitSelector._targetActorId || actorId;
      const actor = $gameActors.actor(targetId);

      if (!actor) {
        console.error(`Actor with ID ${targetId} not found!`);
        return;
      }

      // Reset all parameter bonuses to 0
      actor._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
      actor.refresh();
    }

    resetSwitches() {
      switchIds.forEach((id) => {
        $gameSwitches.setValue(id, false);
      });
    }
  }

  // Reverse a previously applied set of trait grants so re-applying does not
  // stack. Forgets trait skills and removes granted items/equipment. Param
  // bonuses are handled separately by fully resetting _paramPlus.
  function revertTraitGrants(actor, traits) {
    if (!actor || !traits) return;
    traits.forEach((trait) => {
      (trait.skills || []).forEach((skillId) => {
        if ($dataSkills[skillId]) {
          actor.forgetSkill(skillId);
        }
      });
      (trait.items || []).forEach((itemId) => {
        if ($dataItems[itemId]) {
          $gameParty.loseItem($dataItems[itemId], 1);
        }
      });
      (trait.equipment || []).forEach((itemId) => {
        if ($dataWeapons[itemId]) {
          $gameParty.loseItem($dataWeapons[itemId], 1);
        } else if ($dataArmors[itemId]) {
          $gameParty.loseItem($dataArmors[itemId], 1);
        }
      });
    });
  }

  // Helper function to randomize traits for a specific actor
  function randomizeTraitsForActor(targetActorId = null) {
    const targetId = targetActorId || actorId;

    // Get available traits (excluding incompatible ones as we select).
    // Genetic-category traits are never randomly picked: they represent inherent
    // biology decided elsewhere in creation, so random rolls draw only from the
    // physical / mental / magical categories.
    const availableTraits = getTraits().filter(
      (trait) => (trait.category || "mental") !== "genetic"
    );
    const selectedTraits = [];

    // Select 4 random traits (changed from 5 to 4 for consistency)
    while (selectedTraits.length < 4 && availableTraits.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableTraits.length);
      const trait = availableTraits[randomIndex];

      // Check if this trait is compatible with already selected traits
      const isCompatible = !selectedTraits.some(selected =>
        trait.incompatible.includes(selected.id) ||
        selected.incompatible.includes(trait.id)
      );

      if (isCompatible) {
        selectedTraits.push(trait);
      }

      // Remove this trait from available pool regardless
      availableTraits.splice(randomIndex, 1);
    }

    // Apply the traits
    const actor = $gameActors.actor(targetId);

    if (!actor) {
      console.error(`Actor with ID ${targetId} not found!`);
      return;
    }

    // Revert previously applied trait grants so double-randomizing does not
    // leave stale skills or duplicate items, then reset param bonuses.
    revertTraitGrants(actor, actor._selectedTraits);
    actor._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
    actor._selectedTraits = [];

    const paramMap = {
      hp: 0, mp: 1, atk: 2, def: 3,
      mat: 4, mdf: 5, agi: 6, luk: 7
    };

    // Apply each selected trait
    selectedTraits.forEach((trait) => {
      // Apply positive and negative bonuses
      [trait.positive, trait.negative].forEach((stats) => {
        Object.keys(stats || {}).forEach((param) => {
          const paramId = paramMap[param];
          if (typeof paramId === "number") {
            actor._paramPlus[paramId] = (actor._paramPlus[paramId] || 0) + stats[param];
          }
        });
      });

      // Learn skills
      trait.skills.forEach((skillId) => {
        if ($dataSkills[skillId]) {
          actor.learnSkill(skillId);
        }
      });

      // Add items
      trait.items.forEach((itemId) => {
        if ($dataItems[itemId]) {
          $gameParty.gainItem($dataItems[itemId], 1);
        }
      });

      // Add equipment
      trait.equipment.forEach((itemId) => {
        if ($dataWeapons[itemId]) {
          $gameParty.gainItem($dataWeapons[itemId], 1);
        } else if ($dataArmors[itemId]) {
          $gameParty.gainItem($dataArmors[itemId], 1);
        }
      });

      // Set switches
      trait.switches.forEach((switchId) => {
        $gameSwitches.setValue(switchId, true);
      });
    });

    // Store selected traits
    actor._selectedTraits = selectedTraits;
    actor.refresh();

    console.log("Randomized traits:", selectedTraits.map(t => getTraitText(t, "name")).join(", "));
  }

  PluginManager.registerCommand(pluginName, "randomizeTraits", (args) => {
    randomizeTraitsForActor(actorId);
  });

  // Export globally
  window.Scene_TraitSelector = Scene_TraitSelector;
  window.randomizeTraitsForActor = randomizeTraitsForActor;
})();
