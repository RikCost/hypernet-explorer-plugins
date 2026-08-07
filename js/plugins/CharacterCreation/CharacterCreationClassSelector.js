/*:
 * @target MZ
 * @plugindesc Dynamic class selection system with detailed information, skill categories, and confirmation dialogs
 * @author Omni-Lex
 * @orderAfter CharacterCreationShared
 * @orderAfter StartingEquipment
 * @orderAfter CharacterPresets
 * @orderBefore CharacterCreation
 *
 * @command openClassSelection
 * @text Open Class Selection
 * @desc Opens the class selection menu
 *
 * @param availableClasses
 * @text Available Classes
 * @desc List of class IDs that can be selected (comma-separated)
 * @type string
 * @default 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66
 *
 * @param classNameVariable
 * @text Class Name Variable
 * @desc Variable ID to store the selected class name
 * @type variable
 * @default 1
 *
 * @help
 * This plugin provides a comprehensive class selection UI system:
 * - Window_ClassSelection (class list with levels)
 * - Window_ClassDetails (class description, stats, weapons, skills)
 * - Window_ClassConfirmation (confirmation dialog)
 * - Window_ClassLevelUpSkills (level-up skill list)
 * - Window_SkillCategories (primary/secondary skill categories from Categories.json)
 * - Window_ClassSelectionTitle (title bar)
 * - Scene_ClassSelection (scene orchestrator)
 *
 * Primary/secondary skill categories per class live in
 * js/db/Skills/Categories.json ("classSkillCategories"), the single source of
 * truth, not in class noteboxes.
 *
 * Class Notetags:
 * <en: English description here>
 * <it: Italian description here>
 * <elem: 2> (element ID: 1=Physical, 2=Fire, 3=Ice, etc.)
 *
 * Dependencies:
 * - CharacterCreationShared.js (for localization)
 * - StartingEquipment.js (for weapon equipment)
 * - CharacterPresets.js (for tracking functions)
 *
 * Exports:
 * - window.ClassSelection.Scene_ClassSelection
 */

(() => {
  "use strict";

  const pluginName = "CharacterCreationClassSelector";

  let _statsI18n = null;

  const _loadStatsI18n = async () => {
    const lang = ConfigManager.language || "en";
    const url = `js/i18n/${lang}/stats.json`;
    try {
      const response = await fetch(url);
      _statsI18n = await response.json();
    } catch (e) {
      console.error("CharacterCreationClassSelector: Failed to load i18n data from " + url, e);
    }
  };

  // The <elem:> tag stores the engine's element id; the label is resolved here,
  // falling back to $dataSystem so a newly added element still shows.
  const elementLabel = (elementId) => {
    const key = 'ClassSelect.element.' + elementId;
    return T.has(key) ? T(key) : $dataSystem.elements[elementId];
  };

  const _si18n = (key) => {
    if (_statsI18n && _statsI18n[key]) {
      return _statsI18n[key];
    }
    return key;
  };

  _loadStatsI18n();

  //=============================================================================
  // Class skill categories , single source of truth: js/db/Skills/Categories.json
  //=============================================================================

  let _classSkillCats = null;

  const _loadClassSkillCats = async () => {
    // Prefer the DataService-loaded copy; fall back to a direct fetch.
    const fromDS = window.Skills && window.Skills.Categories && window.Skills.Categories.classSkillCategories;
    if (fromDS) {
      _classSkillCats = fromDS;
      return;
    }
    try {
      const response = await fetch("js/db/Skills/Categories.json");
      const data = await response.json();
      _classSkillCats = data.classSkillCategories || {};
    } catch (e) {
      console.error("CharacterCreationClassSelector: Failed to load Categories.json", e);
      _classSkillCats = {};
    }
  };

  _loadClassSkillCats();

  // Returns { primary:[], secondary:[] } for a class id, sourced from Categories.json.
  const getClassSkillCats = (classId) => {
    const src =
      _classSkillCats ||
      (window.Skills && window.Skills.Categories && window.Skills.Categories.classSkillCategories);
    const e = src && (src[classId] || src[String(classId)]);
    return {
      primary: e && Array.isArray(e.primary) ? e.primary : [],
      secondary: e && Array.isArray(e.secondary) ? e.secondary : [],
    };
  };

  //=============================================================================
  // Specializations (js/db/Skills/Specialization.json via SpecializationMenu.js)
  // that a class grants a head start in, sorted by name. Returns [] until
  // window.Specializations finishes its async load.
  //=============================================================================

  const getClassGrantedSpecializations = (className) => {
    if (!className || !window.Specializations || !window.Specializations.ready) return [];
    const rows = [];
    window.Specializations.list.forEach((spec) => {
      const lvl = spec.classStart && spec.classStart[className];
      if (lvl) rows.push({ name: spec.name, levelName: window.Specializations.levelName(lvl) });
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  };

  const getClassSpecializationsHTML = (className) => {
    const rows = getClassGrantedSpecializations(className);
    if (!rows.length) return "";
    const badges = rows.map((r) =>
      `<div class="cc-element-badge" style="margin: 2px;">${r.name} <span style="opacity:0.7;">(${r.levelName})</span></div>`
    ).join(" ");
    return `
      <div class="cc-dossier-card">
        <h3 class="cc-subheader">${T('ClassSelect.startingSpecializations')}</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${badges}
        </div>
      </div>
    `;
  };

  //=============================================================================
  // Plugin Parameters
  //=============================================================================

  const parameters = PluginManager.parameters(pluginName);
  const availableClassesParam =
    parameters["availableClasses"] ||
    "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66";
  const availableClasses = availableClassesParam
    .split(",")
    .map((id) => Number(id.trim()));

  //=============================================================================
  // Aliases for dependencies
  //=============================================================================

  const { weaponTypeIcons } = window.StartingEquipment || {};
  const { equipRandomCompatibleWeapon, GLOBAL_STARTER_SKILLS, getClassStartingItems, giveClassStartingItems } = window.StartingEquipment || {};

  // IconSet glyph via CSS background-position (same convention as
  // TraitSelector.getIconStyle / Scene_CharacterCreation._ccIconStyle), used to
  // render the "Starting Items" dossier card below.
  function iconStyle(iconIndex) {
    if (!iconIndex) return "";
    const col = iconIndex % 16;
    const row = Math.floor(iconIndex / 16);
    const x = col * 32;
    const y = row * 32;
    return `background-image: url('img/system/IconSet.png'); background-position: -${x}px -${y}px; width: 32px; height: 32px; image-rendering: pixelated; display: inline-block; flex-shrink: 0;`;
  }
  const { markFirstCreationComplete } = window.CharacterPresets || {};

  //=============================================================================
  // Window_ClassSelection - Class List
  //=============================================================================

  class Window_ClassSelection extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._data = this.makeClassList();
      this.refresh();
      this.select(0);
      this.activate();
    }

    makeClassList() {
      let list = availableClasses.filter(
        (classId) => classId > 0 && $dataClasses[classId]
      );
      // Full-mode archetype flow scopes the scrollview to the chosen archetype's
      // classes. A null/empty filter means "show every available class".
      const filter = window.$ccArchetypeClassFilter;
      if (Array.isArray(filter) && filter.length > 0) {
        const allowed = new Set(filter);
        const scoped = list.filter((classId) => allowed.has(classId));
        if (scoped.length > 0) list = scoped;
      }
      return list;
    }

    maxItems() {
      return this._data ? this._data.length : 1;
    }

    itemAt(index) {
      return this._data ? this._data[index] : null;
    }

    drawItem(index) {
      const classId = this.itemAt(index);
      if (classId) {
        const rect = this.itemLineRect(index);
        const className = $dataClasses[classId].name;
        const classLevel = this.getClassLevel(classId);
        const displayText = `${className} (Lv. ${classLevel})`;
        this.drawText(displayText, rect.x, rect.y, rect.width);
      }
    }

    getClassLevel(classId) {
      const actor = $gameParty.members()[0];
      if (!actor) return 1;

      if (actor._classId === classId) {
        return actor._level;
      }

      return actor._classLevels ? actor._classLevels[classId] || 1 : 1;
    }

    processOk() {
      const classId = this.itemAt(this.index());
      if (classId) {
        this.playOkSound();
        this.callOkHandler();
      }
    }

    select(index) {
      super.select(index);
      this.callHandler("select");
    }

    onTouchSelect(trigger) {
      super.onTouchSelect(trigger);
      this.callHandler("select");
    }

    currentClass() {
      return $dataClasses[this.itemAt(this.index())];
    }

    currentClassId() {
      return this.itemAt(this.index());
    }
  }

  //=============================================================================
  // Window_ClassConfirmation - Confirmation Dialog
  //=============================================================================

  class Window_ClassConfirmation extends Window_Command {
    initialize(rect) {
      super.initialize(rect);
      this._message = "";
      this._classLevel = 1;
      this.openness = 0;
    }

    makeCommandList() {
      this.addCommand(T('ClassSelect.levelUpList'), "levelUpList");
      this.addCommand(T('ClassSelect.stats'), "stats");
      this.addCommand(T('ClassSelect.skillCategories'), "skillCategories");
      if (this._classLevel > 30) {
        this.addCommand(T('ClassSelect.prestige'), "prestige", false);
      }
      this.addCommand(T('ClassSelect.confirmClass'), "yes");
      this.addCommand(T('ClassSelect.cancel'), "no");
    }

    setClassLevel(level) {
      if (this._classLevel !== level) {
        this._classLevel = level;
        this.refresh();
      }
    }

    setMessage(message) {
      this._message = message || "";
      this.refresh();
    }

    refresh() {
      super.refresh();
      if (this._message) {
        const y = this.itemHeight() * this.maxItems();
        this.drawTextEx(this._message, this.itemPadding(), y, this.innerWidth - this.itemPadding() * 2);
      }
    }
  }

  //=============================================================================
  // Window_ClassLevelUpSkills - Level-Up Skills List
  //=============================================================================


  //=============================================================================
  // Window_SkillCategories - Skill Categories from Notetags
  //=============================================================================


  //=============================================================================
  // Window_ClassDetails - Class Information Display
  //=============================================================================

  class Window_ClassDetails extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this._class = null;
      this.refresh();
    }

    setClass(classData) {
      if (this._class !== classData) {
        this._class = classData;
        this.refresh();
      }
    }

    refresh() {
      this.contents.clear();
      if (this._class) {
        this.drawClassDetails();
      }
    }

    drawClassDetails() {
      const statsHeight = this.calcStatsHeight();
      const skillsHeight = this.calcSkillsHeight();
      this.drawClassNote();
      const bottomMargin = 10;
      const availableHeight = this.contents.height - bottomMargin;
      const statsStartY = availableHeight - statsHeight - skillsHeight;
      const skillsStartY = availableHeight - skillsHeight;
      this.drawParameters(statsStartY);
      this.drawLearnableSkills(skillsStartY);
    }

    calcStatsHeight() {
      return Math.ceil(6 / 2) * (this.lineHeight() * 0.9) + this.lineHeight();
    }

    calcSkillsHeight() {
      let skillCount = 0;
      if (this._class.learnings && this._class.learnings.length > 0) {
        skillCount = this._class.learnings.filter(
          (learning) => learning.level === 1
        ).length;
      }
      return (
        Math.max(1, skillCount) * (this.lineHeight() * 0.85) + this.lineHeight()
      );
    }

    drawClassNote() {
      let note = this._class.note || "No description available.";
      const rawNote = this._class.note || "";

      if (ConfigManager.language === "it") {
        const match = note.match(/<it:\s*([\s\S]*?)>/);
        if (match) {
          note = match[1].trim();
        } else {
          note = note.replace(/<[^>]+>/g, "").trim();
        }
      } else {
        const match = note.match(/<en:\s*([\s\S]*?)>/);
        if (match) {
          note = match[1].trim();
        } else {
          note = note.replace(/<(it|en):\s*[\s\S]*?>/g, "").trim();
        }
      }

      // Surface the class's signature passive instead of the flavor blurb.
      if (window.BattleSystemPassiveSkills && this._class) {
        const passiveDesc =
          window.BattleSystemPassiveSkills.getPassiveDescription(this._class.id);
        if (passiveDesc) note = passiveDesc;
      }

      this.changeTextColor(ColorManager.systemColor());
      this.resetTextColor();
      const maxLines = 3;
      const maxLength = this.contents.width * maxLines - 10;
      const truncatedNote =
        note.length > maxLength ? note.substring(0, maxLength) + "..." : note;

      let currentY = 0;
      this.drawTextEx(truncatedNote, 0, currentY, this.contents.width);

      // Extract and display element
      const elemMatch = rawNote.match(/<elem:\s*(\d+)>/);
      if (elemMatch) {
        const elementId = parseInt(elemMatch[1]);
        if (elementId > 0 && elementId < $dataSystem.elements.length) {
          const elementName = elementLabel(elementId);

          const elementIcons = [0, 96, 64, 65, 66, 67, 68, 69, 70, 71];
          const elementIcon = elementIcons[elementId] || 0;

          currentY += this.lineHeight() * 3 + 10;
          this.changeTextColor(ColorManager.systemColor());
          this.drawText(T('ClassSelect.elementHeading'), 0, currentY, 120);
          this.resetTextColor();
          this.drawText(elementName, 140, currentY, this.contents.width - 200);

          if (elementIcon > 0) {
            const textWidth = this.textWidth(elementName);
            this.drawIcon(elementIcon, 140 + textWidth + 8, currentY);
          }
        }
      }
    }

    drawWeaponAndMagicIcons(y) {
      let iconX = 0;
      const iconWidth = ImageManager.iconWidth + 4;
      for (let weaponTypeId = 1; weaponTypeId <= 12; weaponTypeId++) {
        if (this.canUseWeaponType(weaponTypeId)) {
          const icon = weaponTypeIcons ? weaponTypeIcons[weaponTypeId] : 96;
          this.drawIcon(icon, iconX, y);
          iconX += iconWidth;
        }
      }
    }

    canUseWeaponType(weaponTypeId) {
      if (!this._class || !this._class.traits) return false;
      return this._class.traits.some(
        (trait) =>
          trait.code === 51 &&
          trait.dataId === weaponTypeId &&
          trait.value === 1
      );
    }

    drawParameters(y) {
      const paramNames = [
        _si18n("ATT"),
        _si18n("DEF"),
        _si18n("M.ATT"),
        _si18n("M.DEF"),
        _si18n("AGILITY"),
        _si18n("LUCK")
      ];
      const paramIds = [2, 3, 4, 5, 6, 7];
      for (let i = 0; i < paramNames.length; i++) {
        const x = (i % 2) * (this.contents.width / 2);
        const paramY = y + Math.floor(i / 2) * (this.lineHeight() * 0.9);
        const paramValue = this._class.params[paramIds[i]][1];
        this.changeTextColor(ColorManager.textColor(1));
        this.drawText(paramNames[i] + ":", x, paramY, 80);
        this.resetTextColor();
        this.drawText(String(paramValue), x + 80, paramY, 60, "right");
      }
    }

    drawLearnableSkills(y) {
      this.drawWeaponAndMagicIcons(y);
      let level1Skills = [];
      if (this._class.learnings && this._class.learnings.length > 0) {
        level1Skills = this._class.learnings
          .filter((learning) => learning.level === 1)
          .map((learning) => $dataSkills[learning.skillId].name);
      }

      if (level1Skills.length === 0) {
        this.drawText(
          T('ClassSelect.noSkillsAtLevel1'),
          0,
          y + this.lineHeight(),
          this.contents.width
        );
        return;
      }
      let skillY = y + this.lineHeight() * 0.9;
      const skillLineHeight = this.lineHeight() * 0.85;
      for (const skillName of level1Skills) {
        this.drawText(skillName, 0, skillY, this.contents.width);
        skillY += skillLineHeight;
      }
    }
  }

  //=============================================================================
  // Window_ClassSelectionTitle - Title Bar
  //=============================================================================

  class Window_ClassSelectionTitle extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this.refresh();
    }

    refresh() {
      this.contents.clear();
      this.drawText(T('ClassSelect.selectYourClass'), 0, 0, this.contents.width, "center");
    }
  }

  //=============================================================================
  // Scene_ClassSelection - Scene Orchestrator
  //=============================================================================

  class Scene_ClassSelection extends Scene_MenuBase {
    create() {
      super.create();
      this.createTitleWindow();
      this.createClassWindow();
      this.createDetailsWindow();
      this.createUIOverlay();
    }

    terminate() {
      super.terminate();
      if (this._dndContainer) {
        this._dndContainer.style.display = "none";
      }
    }

    createUIOverlay() {
      // 1. Mute native windows
      if (this._titleWindow) {
        this._titleWindow.visible = false;
        this._titleWindow.opacity = 0;
      }
      if (this._classWindow) {
        this._classWindow.visible = false;
        this._classWindow.opacity = 0;
      }
      if (this._detailsWindow) {
        this._detailsWindow.visible = false;
        this._detailsWindow.opacity = 0;
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
      this._lastConfOpen = false;
      this._lastConfIndex = -1;
      this._lastShowSub = false;
      // Wheel + L2/R2 scrolling for the detail panes. See CCScroll.
      if (window.CCScroll) window.CCScroll.bindWheel(this._dndContainer);
      this.refreshUIOverlayDOM();
    }

    cleanText(str) {
      if (!str) return "";
      return str.replace(/\\C\[\d+\]/gi, "").replace(/\\C/gi, "");
    }

    splitCamelCase(text) {
      return text.replace(/([A-Z])/g, " $1").trim();
    }

    canUseWeaponType(c, weaponTypeId) {
      if (!c || !c.traits) return false;
      return c.traits.some(
        (trait) =>
          trait.code === 51 &&
          trait.dataId === weaponTypeId &&
          trait.value === 1
      );
    }

    refreshUIOverlayDOM() {
      if (!this._dndContainer) return;

      const isConfOpen = this._confirmationWindow && this._confirmationWindow.isOpen();
      const showSub = !!(this._levelUpListWindow || this._skillCategoriesWindow || this._statsWindow);
      const c = this._classWindow.currentClass();

      // Mute windows dynamically
      if (this._confirmationWindow) {
        this._confirmationWindow.visible = false;
        this._confirmationWindow.opacity = 0;
      }
      if (this._levelUpListWindow) {
        this._levelUpListWindow.visible = false;
        this._levelUpListWindow.opacity = 0;
      }
      if (this._skillCategoriesWindow) {
        this._skillCategoriesWindow.visible = false;
        this._skillCategoriesWindow.opacity = 0;
      }
      if (this._statsWindow) {
        this._statsWindow.visible = false;
        this._statsWindow.opacity = 0;
      }

      let leftHtml = "";
      let rightHtml = "";
      let overlayHtml = "";

      const activeCategory = isConfOpen ? (this._lastSoulConvergenceCategory || 'levelUpList') : '';

      if (isConfOpen) {
        // --- COVENANT / SOUL CONVERGENCE SPREAD VIEW (Split between two pages) ---
        const cmdSymbol = this._confirmationWindow.commandSymbol(this._confirmationWindow.index());
        let activeCategoryTemp = this._lastSoulConvergenceCategory || 'levelUpList';
        if (['levelUpList', 'stats', 'skillCategories'].includes(cmdSymbol)) {
          activeCategoryTemp = cmdSymbol;
          this._lastSoulConvergenceCategory = activeCategoryTemp;
        }

        const activeClass = (cat) => activeCategoryTemp === cat ? "selected" : "";
        const tabsHtml = `
          <div class="cc-select-grid" style="grid-template-columns: 1fr; gap: 12px; margin-bottom: 24px;">
            <div class="cc-card-option ${activeClass('levelUpList')}" onclick="SceneManager._scene.onSoulConvergenceTabClick('levelUpList')">
              <div class="cc-option-title" style="font-size: 1.1rem; margin: 0;">${T('CharCreate.skillRoadmap2')}</div>
            </div>
            <div class="cc-card-option ${activeClass('stats')}" onclick="SceneManager._scene.onSoulConvergenceTabClick('stats')">
              <div class="cc-option-title" style="font-size: 1.1rem; margin: 0;">${T('CharCreate.attributeBreakdown')}</div>
            </div>
            <div class="cc-card-option ${activeClass('skillCategories')}" onclick="SceneManager._scene.onSoulConvergenceTabClick('skillCategories')">
              <div class="cc-option-title" style="font-size: 1.1rem; margin: 0;">${T('CharCreate.skillsSpecialties')}</div>
            </div>
          </div>
        `;

        const isConfirmHighlighted = cmdSymbol === 'yes';
        const isBackHighlighted = cmdSymbol === 'no';
        const buttonPanelHtml = `
          <div class="cc-button-panel" style="display: flex; gap: 20px; justify-content: center; margin-top: auto; padding-top: 16px;">
            <button class="cc-btn-treaty ${isBackHighlighted ? 'highlighted' : ''}" onclick="SceneManager._scene.onSoulConvergenceBackClick()">${T('CharCreate.back')}</button>
            <button class="cc-btn-treaty confirm ${isConfirmHighlighted ? 'highlighted' : ''}" onclick="SceneManager._scene.onSoulConvergenceConfirmClick()">${T('CharCreate.confirmClass')}</button>
          </div>
        `;

        leftHtml = `
          <div class="cc-page cc-page-left" style="display: flex; flex-direction: column; justify-content: space-between;">
            ${activeCategoryTemp === 'levelUpList' ? `
              <h2 class="cc-header-gothic">${T('CharCreate.skillRoadmap3')}</h2>
              <p class="cc-text-desc">${T('CharCreate.initialSpecialSkillsAndProgressionUnlockedAl')}</p>
              <div class="cc-dossier-card" style="max-height: 480px; overflow-y: auto; margin-top: 12px; flex-grow: 1;">
                ${(c && c.learnings ? c.learnings.map(l => {
          const skill = $dataSkills[l.skillId];
          return skill ? `
                    <div class="cc-dossier-row">
                      <span class="cc-dossier-label">Lv. ${l.level}:</span>
                      <span class="cc-dossier-value">${window.CCDbName(skill)}</span>
                    </div>
                  ` : "";
        }).join("") : "") || `<div class="cc-text-desc">${T('CharCreate.noProgressionSkillsDefined')}</div>`}
              </div>
            ` : activeCategoryTemp === 'stats' ? `
              <h2 class="cc-header-gothic">${T('CharCreate.attributeBreakdown2')}</h2>
              <div class="cc-dossier-card" style="max-height: 480px; overflow-y: auto; margin-top: 12px; padding: 18px; flex-grow: 1;">
                ${[
              { name: "STR", desc: T('CharCreate.increasesPhysicalStrikePower') },
              { name: "CON", desc: T('CharCreate.decreasesPhysicalDamageTaken') },
              { name: "INT", desc: T('CharCreate.increasesSpellDamageAndAlchemicalPower') },
              { name: "WIS", desc: T('CharCreate.decreasesMagicalDamageTaken') },
              { name: "DEX", desc: T('CharCreate.increasesHitRateDodgeAndActionSpeed') },
              { name: "PSI", desc: T('CharCreate.increasesCriticalHitsAndAlchemicalAnomaliesC') }
            ].map(s => `
                  <div class="cc-dossier-row" style="margin-bottom: 12px; border-bottom: 1px dotted rgba(139, 90, 43, 0.2); padding-bottom: 6px;">
                    <span class="cc-dossier-label" style="min-width: 60px; display: inline-block;">${s.name}:</span>
                    <span class="cc-dossier-value" style="font-size: 0.88rem; line-height: 1.35; display: inline-block; vertical-align: top;">${s.desc}</span>
                  </div>
                `).join("")}
              </div>
            ` : `
              <h2 class="cc-header-gothic">${T('CharCreate.masteries')}</h2>
              <div class="cc-dossier-card" style="margin-top: 12px; padding: 18px; margin-bottom: 16px;">
                <h4 class="cc-subheader" style="color: #ffcc66; font-size: 1.1rem; margin-bottom: 8px;">${T('CharCreate.primaryMastery')}</h4>
                <p style="font-size: 0.95rem; color: #dddddd; line-height: 1.4;">${(c && getClassSkillCats(c.id).primary.length ? getClassSkillCats(c.id).primary.map(s => s.replace(/([A-Z])/g, ' $1').trim()).join(", ") : "") || T('CharCreate.none')}</p>
              </div>
              <div class="cc-dossier-card" style="padding: 18px; flex-grow: 1;">
                <h4 class="cc-subheader" style="color: #e9c46a; font-size: 1.1rem; margin-bottom: 8px;">${T('CharCreate.secondaryMastery')}</h4>
                <p style="font-size: 0.95rem; color: #dddddd; line-height: 1.4;">${(c && getClassSkillCats(c.id).secondary.length ? getClassSkillCats(c.id).secondary.map(s => s.replace(/([A-Z])/g, ' $1').trim()).join(", ") : "") || T('CharCreate.none')}</p>
              </div>
            `}
          </div>
        `;

        rightHtml = `
          <div class="cc-page cc-page-right" style="display: flex; flex-direction: column; justify-content: space-between;">
            <div style="position: absolute; top: -15px; left: 25%; transform: rotate(-12deg); font-family: 'Lora', serif; font-size: 1.6rem; color: #822d2d; border: 3px double #822d2d; padding: 2px 10px; border-radius: 4px; background: #faf2dc; font-weight: bold; letter-spacing: 2px; z-index: 20; pointer-events: none;">${T('ClassSelect.ui.covenantStamp')}</div>
            <h2 class="cc-header-gothic" style="margin-top: 10px;">${T('CharCreate.details')}</h2>
            
            <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center;"> 
              ${tabsHtml}
            </div>
            
            ${buttonPanelHtml}
          </div>
        `;
      } else {
        // --- NORMAL VOCATION DOSSIER VIEW ---
        const classList = this._classWindow._data;
        const activeIndex = this._classWindow.index();

        const classCards = classList.map((classId, index) => {
          const isSelected = index === activeIndex;
          const classObj = $dataClasses[classId];
          const className = classObj ? window.CCDbName(classObj) : T('ClassSelect.vocation');
          const classLevel = this._classWindow.getClassLevel(classId);

          return `
            <div class="cc-wanted-card cc-class-card ${isSelected ? 'selected' : ''}" style="padding: 18px 12px; border-width: 2px; border-style: solid;" onclick="SceneManager._scene.onClassCardClick(${index})">
              <div class="cc-wanted-name" style="color: #ffffff;">${className}</div>
              <div class="cc-wanted-class" style="color: #ffcc66; font-weight: bold; margin-top: 4px;">Lv. ${classLevel}</div>
            </div>
          `;
        }).join("");

        if (c) {
          // English, on purpose: it is the key Specialization.json's classStart
          // table is written against. Display goes through CCDbName instead.
          const className = c.name;
          let note = c.note || "";

          // Parse localized description
          if (ConfigManager.language === "it") {
            const match = note.match(/<it:\s*([\s\S]*?)>/);
            note = match ? match[1].trim() : note.replace(/<[^>]+>/g, "").trim();
          } else {
            const match = note.match(/<en:\s*([\s\S]*?)>/);
            note = match ? match[1].trim() : note.replace(/<(it|en):\s*[\s\S]*?>/g, "").trim();
          }

          // Surface the class's signature passive instead of the flavor blurb.
          if (window.BattleSystemPassiveSkills) {
            const passiveDesc =
              window.BattleSystemPassiveSkills.getPassiveDescription(c.id);
            if (passiveDesc) note = passiveDesc;
          }

          // Parse element
          let elementHtml = "";
          const elemMatch = c.note.match(/<elem:\s*(\d+)>/);
          if (elemMatch) {
            const elementId = parseInt(elemMatch[1]);
            if (elementId > 0 && elementId < $dataSystem.elements.length) {
              const elementName = elementLabel(elementId);
              elementHtml = `<div class="cc-element-badge" style="margin-top: 8px;">${elementName}</div>`;
            }
          }

          // Stat parameters
          const str = c.params[2][1];
          const con = c.params[3][1];
          const mat = c.params[4][1];
          const mdf = c.params[5][1];
          const agi = c.params[6][1];
          const luk = c.params[7][1];

          // Weapons proficiencies
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

          const weaponBadges = [];
          for (let wId = 1; wId <= 12; wId++) {
            if (this.canUseWeaponType(c, wId)) {
              weaponBadges.push(`<span class="cc-element-badge" style="margin: 2px; font-size: 0.72rem;">${weaponNames[wId] || "Weapon"}</span>`);
            }
          }

          // Initial Level 1 Skills
          let lv1SkillsHtml = "";
          if (c.learnings && c.learnings.length > 0) {
            const lv1 = c.learnings.filter(l => l.level === 1);
            if (lv1.length > 0) {
              lv1SkillsHtml = lv1.map(l => {
                const sk = $dataSkills[l.skillId];
                return sk ? `<div class="cc-element-badge" style="margin: 2px;">${window.CCDbName(sk)}</div>` : "";
              }).join(" ");
            }
          }
          if (!lv1SkillsHtml) {
            lv1SkillsHtml = `<span style="font-size: 0.85rem; color: #5c4b3d; font-style: italic;">${T('CharCreate.noStartingSkills')}</span>`;
          }

          // Thematic class starting items (Items.json only). See
          // CharacterCreationEquipment.js CLASS_STARTING_ITEMS.
          const classItems = typeof getClassStartingItems === "function" ? getClassStartingItems(c.id) : [];
          const classItemsHtml = classItems
            .map((e) => {
              const it = $dataItems[e.id];
              if (!it) return "";
              return `
                <div class="cc-dossier-row">
                  <span class="cc-dossier-label" style="display:flex;align-items:center;gap:6px;">
                    <span style="${iconStyle(it.iconIndex)}"></span>${window.CCDbName(it)}
                  </span>
                  <span class="cc-dossier-value">x${e.qty}</span>
                </div>
              `;
            }).join("");
          const startingItemsCardHtml = classItemsHtml
            ? `
                <div class="cc-dossier-card">
                  <h3 class="cc-subheader">${T('CharCreate.startingItems')}</h3>
                  ${classItemsHtml}
                </div>
              `
            : "";

          // Creature flow: the roster on screen is only what the creature's
          // archetypes support, so label it instead of implying the full list.
          const creatureNote = window.$ccCreatureClassFlow
            ? `<p class="cc-text-desc">${T('CharCreate.onlyWhatYourArchetypesSupport')}</p>`
            : "";

          leftHtml = `
            <div class="cc-page cc-page-left" style="display: flex; flex-direction: column;">
              <h2 class="cc-header-gothic">${T('CharCreate.classes')}</h2>
              ${creatureNote}

              <div class="cc-presets-board" style="grid-template-columns: repeat(2, 1fr); flex: 1; min-height: 0; overflow-y: auto; align-content: start;">
                ${classCards}
              </div>
            </div>
          `;

        rightHtml = `
          <div class="cc-page cc-page-right">
            <h2 class="cc-header-gothic">${window.CCDbName(c)}</h2>
            <p style="font-size: 0.92rem; line-height: 1.45; color: #3d2f26; font-style: italic; text-align: center; margin-bottom: 16px;">
              "${note}"
            </p>

            <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 16px;">
              ${elementHtml}
            </div>

            <div class="cc-dossier-card">
              <h3 class="cc-subheader">${T('CharCreate.startingWeaponProficiencies')}</h3>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${weaponBadges.join("") || T('CharCreate.none')}
              </div>
            </div>

            <div class="cc-dossier-card">
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                <div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">STR:</span><span class="cc-dossier-value">${str}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">DEX:</span><span class="cc-dossier-value">${agi}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">WIS:</span><span class="cc-dossier-value">${mdf}</span></div>
                </div>
                <div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">CON:</span><span class="cc-dossier-value">${con}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">INT:</span><span class="cc-dossier-value">${mat}</span></div>
                  <div class="cc-dossier-row"><span class="cc-dossier-label">PSI:</span><span class="cc-dossier-value">${luk}</span></div>
                </div>
              </div>
            </div>

            <div class="cc-dossier-card">
              <h3 class="cc-subheader">${T('CharCreate.startingSpecialSkills')}</h3>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${lv1SkillsHtml}
              </div>
            </div>

            ${startingItemsCardHtml}

            ${getClassSpecializationsHTML(className)}

            <div class="cc-button-panel" style="display: flex; gap: 20px; justify-content: center; margin-top: 16px;">
              <button class="cc-btn-treaty" onclick="SceneManager._scene.onClassCancel()">${T('CharCreate.back')}</button>
              <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onClassSelect()">${T('CharCreate.continue')}</button>
            </div>
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

      const activeIndex = this._classWindow ? this._classWindow.index() : 0;
      const isConfOpenChanged = (this._lastConfOpen !== isConfOpen);
      const isActiveCategoryChanged = (this._lastActiveCategory !== activeCategory);
      const isStructureChange = isConfOpenChanged || isActiveCategoryChanged || !spread.querySelector(".cc-page-left") || !spread.querySelector(".cc-page-right");

      if (isStructureChange) {
        spread.innerHTML = `
          ${leftHtml}
          ${rightHtml}
          ${overlayHtml}
        `;
      } else {
        // Optimized partial update!
        const leftPage = spread.querySelector(".cc-page-left");
        const rightPage = spread.querySelector(".cc-page-right");

        if (isConfOpen) {
          // --- SOUL CONVERGENCE VIEW (Optimized Update) ---
          if (rightPage) {
            const tabs = rightPage.querySelectorAll(".cc-card-option");
            tabs.forEach((tab, idx) => {
              const tabCategories = ['levelUpList', 'stats', 'skillCategories'];
              if (tabCategories[idx] === activeCategory) {
                tab.classList.add("selected");
              } else {
                tab.classList.remove("selected");
              }
            });

            const buttons = rightPage.querySelectorAll(".cc-btn-treaty");
            const cmdSymbol = this._confirmationWindow ? this._confirmationWindow.commandSymbol(this._confirmationWindow.index()) : '';
            buttons.forEach((btn) => {
              if (btn.classList.contains("confirm")) {
                if (cmdSymbol === 'yes') {
                  btn.classList.add("highlighted");
                } else {
                  btn.classList.remove("highlighted");
                }
              } else {
                if (cmdSymbol === 'no') {
                  btn.classList.add("highlighted");
                } else {
                  btn.classList.remove("highlighted");
                }
              }
            });
          }
        } else {
          // --- NORMAL VOCATION VIEW (Optimized Update) ---
          if (rightPage && rightHtml) {
            const rightInnerHtml = rightHtml.replace(/^\s*<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
            rightPage.innerHTML = rightInnerHtml;
          }

          if (leftPage) {
            const cards = leftPage.querySelectorAll(".cc-wanted-card");
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

      // Record states for the next check
      this._lastIndex = activeIndex;
      this._lastConfOpen = isConfOpen;
      this._lastConfIndex = (this._confirmationWindow && this._confirmationWindow.isOpen()) ? this._confirmationWindow.index() : -1;
      this._lastShowSub = showSub;
      this._lastActiveCategory = activeCategory;
    }

    onClassCardClick(index) {
      if (this._classWindow) {
        if (this._classWindow.index() === index) {
          this._classWindow.processOk();
        } else {
          this._classWindow.select(index);
          this.refreshUIOverlayDOM();
        }
      }
    }

    onConfCommandClick(index) {
      if (this._confirmationWindow) {
        if (this._confirmationWindow.index() === index) {
          this._confirmationWindow.processOk();
        } else {
          this._confirmationWindow.select(index);
          this.refreshUIOverlayDOM();
        }
      }
    }

    onSoulConvergenceTabClick(symbol) {
      if (this._confirmationWindow) {
        const idx = this._confirmationWindow.findSymbol(symbol);
        if (idx >= 0) {
          SoundManager.playOk();
          this._confirmationWindow.select(idx);
          this.refreshUIOverlayDOM();
        }
      }
    }

    onSoulConvergenceConfirmClick() {
      if (this._confirmationWindow) {
        const idx = this._confirmationWindow.findSymbol('yes');
        if (idx >= 0) {
          this._confirmationWindow.select(idx);
          this._confirmationWindow.processOk();
        }
      }
    }

    onSoulConvergenceBackClick() {
      if (this._confirmationWindow) {
        const idx = this._confirmationWindow.findSymbol('no');
        if (idx >= 0) {
          this._confirmationWindow.select(idx);
          this._confirmationWindow.processOk();
        }
      }
    }

    updateUIInput() {
      if (this._confirmationWindow && this._confirmationWindow.isOpen()) {
        const windowObj = this._confirmationWindow;
        if (!windowObj || !windowObj.active) return;

        const maxItems = windowObj.maxItems();
        if (maxItems <= 0) return;

        let moved = false;
        let index = windowObj.index();

        if (Input.isTriggered('down') || Input.isRepeated('down')) {
          if (index + 1 < maxItems) {
            index += 1;
          } else {
            index = 0;
          }
          moved = true;
        } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
          if (index - 1 >= 0) {
            index -= 1;
          } else {
            index = maxItems - 1;
          }
          moved = true;
        } else if (Input.isTriggered('ok')) {
          SoundManager.playOk();
          this.onSoulConvergenceConfirmClick();
          return;
        } else if (Input.isTriggered('cancel')) {
          SoundManager.playCancel();
          this.onConfirmationNo();
          return;
        }

        if (moved) {
          SoundManager.playCursor();
          windowObj.select(index);
          this.refreshUIOverlayDOM();
        }
      } else if (this._classWindow) {
        const windowObj = this._classWindow;
        if (!windowObj || !windowObj.active) return;

        const maxItems = windowObj.maxItems();
        if (maxItems <= 0) return;

        let moved = false;
        let index = windowObj.index();

        if (Input.isTriggered('down') || Input.isRepeated('down')) {
          if (index + 2 < maxItems) {
            index += 2;
          } else {
            index = index % 2;
          }
          moved = true;
        } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
          if (index - 2 >= 0) {
            index -= 2;
          } else {
            let target = Math.floor((maxItems - 1) / 2) * 2 + (index % 2);
            if (target >= maxItems) target -= 2;
            index = target >= 0 ? target : 0;
          }
          moved = true;
        } else if (Input.isTriggered('right') || Input.isRepeated('right')) {
          if (index % 2 === 0 && index + 1 < maxItems) {
            index += 1;
            moved = true;
          }
        } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
          if (index % 2 === 1 && index - 1 >= 0) {
            index -= 1;
            moved = true;
          }
        } else if (Input.isTriggered('ok')) {
          SoundManager.playOk();
          windowObj.processOk();
          return;
        } else if (Input.isTriggered('cancel')) {
          SoundManager.playCancel();
          this.onClassCancel();
          return;
        }

        if (moved) {
          SoundManager.playCursor();
          windowObj.select(index);
          this.refreshUIOverlayDOM();
        }
      }
    }

    update() {
      super.update();

      if (this._dndContainer && this._dndContainer.style.display !== "none") {
        const currentIndex = this._classWindow ? this._classWindow.index() : 0;
        const isConfOpen = this._confirmationWindow && this._confirmationWindow.isOpen();
        const confIndex = isConfOpen ? (this._confirmationWindow ? this._confirmationWindow.index() : 0) : -1;
        const showSub = !!(this._levelUpListWindow || this._skillCategoriesWindow || this._statsWindow);
        const activeCategory = isConfOpen ? (this._lastSoulConvergenceCategory || 'levelUpList') : '';

        if (this._lastIndex !== currentIndex ||
          this._lastConfOpen !== isConfOpen ||
          this._lastConfIndex !== confIndex ||
          this._lastShowSub !== showSub ||
          this._lastActiveCategory !== activeCategory) {
          this.refreshUIOverlayDOM();
        }

        this.updateUIInput();
        if (window.CCScroll) window.CCScroll.update(this._dndContainer);
      }
    }

    createTitleWindow() {
      const rect = this.titleWindowRect();
      this._titleWindow = new Window_ClassSelectionTitle(rect);
      this._titleWindow.visible = false;
      this._titleWindow.opacity = 0;
      this.addWindow(this._titleWindow);
    }

    createClassWindow() {
      const rect = this.classWindowRect();
      this._classWindow = new Window_ClassSelection(rect);
      this._classWindow.setHandler("ok", this.onClassSelect.bind(this));
      this._classWindow.setHandler("cancel", this.onClassCancel.bind(this));
      this._classWindow.setHandler(
        "select",
        this.onClassSelectionChange.bind(this)
      );
      this._classWindow.visible = false;
      this._classWindow.opacity = 0;
      this.addWindow(this._classWindow);
    }

    createDetailsWindow() {
      const rect = this.detailsWindowRect();
      this._detailsWindow = new Window_ClassDetails(rect);
      this._detailsWindow.visible = false;
      this._detailsWindow.opacity = 0;
      this.addWindow(this._detailsWindow);

      if (this._classWindow.currentClass()) {
        this._detailsWindow.setClass(this._classWindow.currentClass());
      }
    }

    titleWindowRect() {
      const padding = 24;
      const width = Graphics.boxWidth - padding * 2;
      const height = this.calcWindowHeight(1, false);
      return new Rectangle(padding, padding, width, height);
    }

    classWindowRect() {
      const titleHeight = this.titleWindowRect().height;
      const padding = 24;
      const width = Math.floor((Graphics.boxWidth - padding * 2) / 2);
      const top = padding + titleHeight + 8;
      const height = Graphics.boxHeight - top - padding;
      return new Rectangle(padding, top, width, height);
    }

    detailsWindowRect() {
      const titleHeight = this.titleWindowRect().height;
      const padding = 24;
      const classWidth = this.classWindowRect().width;
      const width = Math.floor((Graphics.boxWidth - padding * 2) / 2);
      const top = padding + titleHeight + 8;
      const height = Graphics.boxHeight - top - padding;
      const x = padding + classWidth + 8;
      return new Rectangle(x, top, width, height);
    }

    onClassSelectionChange() {
      if (this._classWindow.currentClass()) {
        this._detailsWindow.setClass(this._classWindow.currentClass());
      }
    }

    // A caller that PUSHED this selector over a scene of its own (the Detailed
    // creation editor) is returned to by popping, so it comes back with its own
    // state instead of the wizard restarting underneath it. Answers true when
    // it has taken the exit.
    _returnToPushingCaller() {
      if (!window.$ccClassReturnByPop) return false;
      window.$ccClassReturnByPop = false;
      window.$ccArchetypeClassFilter = null;
      window.$ccCreatureClassFlow = null;
      SceneManager.pop();
      return true;
    }

    onClassCancel() {
      if (this._returnToPushingCaller()) return;
      // Creature flow: the roster on screen was derived from the creature's
      // archetypes, so Back returns to the creature builder (where those
      // archetypes can be changed) rather than to the wizard's class step,
      // which creatures never see.
      const creatureFlow = window.$ccCreatureClassFlow;
      if (creatureFlow && window.Scene_CreateCreature && window.Scene_CharacterCreation) {
        window.$ccCreatureClassFlow = null;
        window.$ccArchetypeClassFilter = null;
        const wizard = window.Scene_CharacterCreation;
        wizard._isCreatureMode = true;
        // Restore the paused-wizard state the builder was originally opened
        // with: the resume point it aborts to, and its stack entry.
        wizard._interruptedStep =
          (window.CCSteps && window.CCSteps.CLASS) != null ? window.CCSteps.CLASS : 5;
        if (SceneManager._stack) SceneManager._stack.push(wizard);
        if (window.Scene_CreateCreature.setTargetActorId) {
          window.Scene_CreateCreature.setTargetActorId(creatureFlow.actorId);
        }
        SceneManager.goto(window.Scene_CreateCreature);
        return;
      }
      // Return to the class selection step in character creation
      if (window.Scene_CharacterCreation) {
        window.Scene_CharacterCreation._isCreatureMode = false;
        window.Scene_CharacterCreation.prepare(
          (window.CCSteps && window.CCSteps.CLASS) != null ? window.CCSteps.CLASS : 5
        );
        SceneManager.goto(window.Scene_CharacterCreation);
      } else {
        this.popScene();
      }
    }

    onClassSelect() {
      if (!this._confirmationWindow) {
        const rect = this.confirmationWindowRect();
        this._confirmationWindow = new Window_ClassConfirmation(rect);
        this._confirmationWindow.setHandler(
          "yes",
          this.onConfirmationYes.bind(this)
        );
        this._confirmationWindow.setHandler(
          "no",
          this.onConfirmationNo.bind(this)
        );
        this._confirmationWindow.setHandler(
          "levelUpList",
          this.onLevelUpList.bind(this)
        );
        this._confirmationWindow.setHandler("stats", this.onStats.bind(this));
        this._confirmationWindow.setHandler(
          "skillCategories",
          this.onSkillCategories.bind(this)
        );
        this._confirmationWindow.setHandler(
          "prestige",
          this.onPrestige.bind(this)
        );
        this.addWindow(this._confirmationWindow);
      }

      const classId = this._classWindow.currentClassId();
      const classLevel = this._classWindow.getClassLevel(classId);
      this._confirmationWindow.setClassLevel(classLevel);

      this._confirmationWindow.setMessage("");
      this._confirmationWindow.open();
      this._confirmationWindow.activate();

      const defaultIdx = this._confirmationWindow.findSymbol('levelUpList');
      this._confirmationWindow.select(defaultIdx >= 0 ? defaultIdx : 0);

      this._classWindow.deactivate();
    }

    onConfirmationYes() {
      const classId = this._classWindow.itemAt(this._classWindow.index());
      const className = $dataClasses[classId].name;

      // Get the current actor being created
      const Scene_CharacterCreation = window.Scene_CharacterCreation;
      const currentActor = Scene_CharacterCreation ? Scene_CharacterCreation.getCurrentActor() : null;
      const currentActorId = Scene_CharacterCreation ? Scene_CharacterCreation.getCurrentActorId() : null;

      // Set the class for the current actor
      if (currentActor) {
        currentActor.changeClass(classId, true);
        if (typeof giveClassStartingItems === "function") {
          giveClassStartingItems(currentActor, classId);
        }
      }

      // Creature flow: a classed creature keeps the base skills its body parts
      // grant on top of whatever the class brings, so re-teach them after the
      // class change.
      const creatureFlow = window.$ccCreatureClassFlow;
      if (creatureFlow) {
        window.$ccCreatureClassFlow = null;
        window.$ccArchetypeClassFilter = null;
        const creature = currentActor || $gameActors.actor(creatureFlow.actorId);
        if (creature && window.HealthCore && window.HealthCore.ensureBodyPartSkills) {
          window.HealthCore.ensureBodyPartSkills(creature);
        }
      }

      // Global requirement: Add item 591 to all new characters (only once for party member 1)
      const currentMemberIndex = Scene_CharacterCreation ? Scene_CharacterCreation._currentPartyMemberIndex : 0;
      if (currentMemberIndex === 0 && $dataItems[714]) {
        $gameParty.gainItem($dataItems[714], 1);
      }

      // Add global starter skills to current actor
      if (currentActor && GLOBAL_STARTER_SKILLS) {
        GLOBAL_STARTER_SKILLS.forEach((skillId) => {
          if ($dataSkills[skillId]) {
            currentActor.learnSkill(skillId);
          }
        });

        // Equip random compatible weapon for the selected class
        if (equipRandomCompatibleWeapon) {
          equipRandomCompatibleWeapon(currentActor, classId);
        }
      }

      // Starting money is NOT granted here: CharacterCreation.giveStartingMoney
      // hands out the party's 100€ base purse plus every member's class/trait
      // money at the end of creation, so it covers the quick-mode, random and
      // creature class paths too and cannot be wiped by the preset step.

      // Store class name in variable (only for party member 1)
      if (currentMemberIndex === 0) {
        const variableId = Number(parameters["classNameVariable"] || 0);
        if (variableId > 0) {
          $gameVariables.setValue(variableId, className);
        }
      }

      if (markFirstCreationComplete) {
        markFirstCreationComplete();
      }

      // Detailed creation editor: it owns the rest of the character sheet, so
      // the class change lands back in its panel rather than in the wizard.
      if (this._returnToPushingCaller()) return;

      // Resume character creation at the Traits step after confirming class selection
      if (Scene_CharacterCreation) {
        Scene_CharacterCreation.prepare(
          (window.CCSteps && window.CCSteps.TRAITS) != null ? window.CCSteps.TRAITS : 6
        );
        SceneManager.goto(Scene_CharacterCreation);
      } else {
        this.popScene();
      }
    }

    onConfirmationNo() {
      this._confirmationWindow.close();
      this._classWindow.activate();
    }

    onPrestige() {
      // Placeholder for future prestige functionality
    }

    confirmationWindowRect() {
      const width = 400;
      const classId = this._classWindow.currentClassId();
      const classLevel = this._classWindow.getClassLevel(classId);
      const commandCount = classLevel > 30 ? 6 : 5;
      const height = this.calcWindowHeight(commandCount, true);
      const x = (Graphics.boxWidth - width) / 2;
      const y = (Graphics.boxHeight - height) / 2;
      return new Rectangle(x, y, width, height);
    }

    onStats() {
      if (this._confirmationWindow) {
        this._confirmationWindow.activate();
      }
    }

    onLevelUpList() {
      if (this._confirmationWindow) {
        this._confirmationWindow.activate();
      }
    }

    onSkillCategories() {
      if (this._confirmationWindow) {
        this._confirmationWindow.activate();
      }
    }

    onSubWindowCancel() {
      if (this._levelUpListWindow) {
        this._levelUpListWindow.close();
        this._levelUpListWindow = null;
      }
      if (this._skillCategoriesWindow) {
        this._skillCategoriesWindow.close();
        this._skillCategoriesWindow = null;
      }
      if (this._statsWindow) {
        this._statsWindow.close();
        this._statsWindow = null;
      }
      if (this._confirmationWindow) {
        this._confirmationWindow.activate();
      }
    }

    statsWindowRect() {
      const width = 600;
      const height = this.calcWindowHeight(18, false);
      const x = (Graphics.boxWidth - width) / 2;
      const y = (Graphics.boxHeight - height) / 2;
      return new Rectangle(x, y, width, height);
    }

    levelUpListWindowRect() {
      const width = 600;
      const height = this.calcWindowHeight(15, true);
      const x = (Graphics.boxWidth - width) / 2;
      const y = (Graphics.boxHeight - height) / 2;
      return new Rectangle(x, y, width, height);
    }

    skillCategoriesWindowRect() {
      const width = 600;
      const height = this.calcWindowHeight(10, false);
      const x = (Graphics.boxWidth - width) / 2;
      const y = (Graphics.boxHeight - height) / 2;
      return new Rectangle(x, y, width, height);
    }
  }

  //=============================================================================
  // Plugin Commands
  //=============================================================================

  PluginManager.registerCommand(pluginName, "openClassSelection", () => {
    window.$ccArchetypeClassFilter = null;
    window.$ccCreatureClassFlow = null;
    SceneManager.push(Scene_ClassSelection);
  });

  //=============================================================================
  // Exports to Global Namespace
  //=============================================================================

  window.ClassSelection = {
    Scene_ClassSelection
  };

  // Backward compatibility
  window.Scene_ClassSelection = Scene_ClassSelection;

  console.log(`${pluginName} loaded successfully.`);
})();
