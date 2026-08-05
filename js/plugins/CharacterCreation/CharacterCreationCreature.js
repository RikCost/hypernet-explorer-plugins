/*:
 * @target MZ
 * @plugindesc Creature creation system for character creation flow
 * @author Omni-Lex
 * @orderAfter Health_Core
 * @orderAfter CharacterCreation
 *
 * @help
 * This plugin provides a creature creation interface that integrates
 * with the character creation flow. It allows players to create custom
 * creatures by selecting:
 * - Archetype (baseline or hybrid)
 * - Battler image
 * - Character sprite
 *
 * The system automatically integrates with the Health_Core archetype
 * system and returns to the trait selection after completion.
 */

(() => {
  const pluginName = "CharacterCreationCreature";

  // Helper function to get skill display name from a skill ID or array of IDs
  function getSkillDisplayName(skillId) {
    if (Array.isArray(skillId)) {
      const names = skillId
        .filter((id) => id)
        .map((id) => ($dataSkills && $dataSkills[id] ? $dataSkills[id].name : T('Creature.skillFallback', { id: id })));
      return names.length ? names.join(", ") : null;
    }
    if (!skillId || skillId === 0) return null;
    return $dataSkills && $dataSkills[skillId] ? $dataSkills[skillId].name : T('Creature.skillFallback', { id: skillId });
  }

  // ============================================================================
  // Window_ArchetypeSelect - List of available archetypes
  // ============================================================================
  function Window_ArchetypeSelect() {
    this.initialize(...arguments);
  }

  Window_ArchetypeSelect.prototype = Object.create(Window_Selectable.prototype);
  Window_ArchetypeSelect.prototype.constructor = Window_ArchetypeSelect;

  Window_ArchetypeSelect.prototype.initialize = function (rect) {
    Window_Selectable.prototype.initialize.call(this, rect);
    this._data = [];
    this.refresh();
  };

  Window_ArchetypeSelect.prototype.processCursorMove = function () {};
  Window_ArchetypeSelect.prototype.processHandling = function () {};
  // All mouse interaction goes through the DOM overlay. The window itself is
  // invisible, so leaving TouchInput alive lets a hover over its (unrelated)
  // rectangle move the index and cycle the cards under the pointer.
  Window_ArchetypeSelect.prototype.processTouch = function () {};

  Window_ArchetypeSelect.prototype.maxCols = function () {
    return 2;
  };

  Window_ArchetypeSelect.prototype.maxItems = function () {
    return this._data ? this._data.length : 0;
  };

  Window_ArchetypeSelect.prototype.item = function () {
    return this._data && this.index() >= 0 ? this._data[this.index()] : null;
  };

  Window_ArchetypeSelect.prototype.makeItemList = function () {
    this._data = [];
    const { EnemyArchetypes } = window.Health || {};
    if (EnemyArchetypes) {
      for (const key in EnemyArchetypes) {
        this._data.push({
          key: key,
          name: window.getArchetypeText(`enemyArchetypes.${key.toLowerCase()}.name`) /* i18n-ignore: enemyArchetypes.json key */ || key
        });
      }
    }
  };

  Window_ArchetypeSelect.prototype.drawItem = function (index) {
    const item = this._data[index];
    if (item) {
      const rect = this.itemLineRect(index);
      this.drawText(item.name, rect.x, rect.y, rect.width);
    }
  };

  Window_ArchetypeSelect.prototype.refresh = function () {
    this.makeItemList();
    Window_Selectable.prototype.refresh.call(this);
  };

  // Patch to call 'select' handler for live updates
  const _Window_ArchetypeSelect_select = Window_ArchetypeSelect.prototype.select;
  Window_ArchetypeSelect.prototype.select = function (index) {
    _Window_ArchetypeSelect_select.call(this, index);
    if (this.isHandled('select')) {
      this.callHandler('select');
    }
  };

  // ============================================================================
  // Window_BattlerList - List of battler images
  // ============================================================================
  function Window_BattlerList() {
    this.initialize(...arguments);
  }

  Window_BattlerList.prototype = Object.create(Window_Selectable.prototype);
  Window_BattlerList.prototype.constructor = Window_BattlerList;

  Window_BattlerList.prototype.initialize = function (rect) {
    this._data = [];
    this._archetypes = [];
    Window_Selectable.prototype.initialize.call(this, rect);
  };

  Window_BattlerList.prototype.setArchetypes = function (archetypes) {
    this._archetypes = archetypes || [];
    this.refresh();
  };

  Window_BattlerList.prototype.processCursorMove = function () {};
  Window_BattlerList.prototype.processHandling = function () {};
  Window_BattlerList.prototype.processTouch = function () {};

  Window_BattlerList.prototype.maxCols = function () {
    return 2; // Matches the 2-column visual grid
  };

  Window_BattlerList.prototype.maxItems = function () {
    return this._data ? this._data.length : 0;
  };

  Window_BattlerList.prototype.itemHeight = function () {
    return this.lineHeight();
  };

  Window_BattlerList.prototype.makeItemList = function () {
    this._data = [];
    if (!$dataEnemies) return;

    for (const enemy of $dataEnemies) {
      if (!enemy || !enemy.name) continue;

      const note = enemy.note || "";
      const archetypeMatch = note.match(/<Archetype:\s*(.*?)>/);
      if (archetypeMatch) {
        const arch = archetypeMatch[1].trim();
        if (this._archetypes.length === 0 || this._archetypes.includes(arch)) {
          // Avoid duplicate battlers if they have the same name (optional, but cleaner)
          // Actually, different enemies might have the same name but different battlers, 
          // or same battler but different names. Let's keep them all for variety unless identical.
          this._data.push({
            id: enemy.id,
            name: enemy.name,
            battlerName: enemy.battlerName
          });
        }
      }
    }

    // Sort alphabetically by enemy name
    this._data.sort((a, b) => a.name.localeCompare(b.name));

    // Offer a fully custom 3D creature as the first option (when the 3D editor
    // is available). Selecting it opens the part-mixing model editor seeded from
    // the chosen archetype(s) instead of picking a fixed battler image.
    if (window.CC3DModel && window.CC3DModel.isAvailable && window.CC3DModel.isAvailable() && window.Scene_CC3DModel) {
      this._data.unshift({ id: 0, custom: true, battlerName: null, name: T('Creature.custom3D') });
    }
  };

  Window_BattlerList.prototype.item = function () {
    return this._data[this.index()];
  };

  Window_BattlerList.prototype.drawItem = function (index) {
    const item = this._data[index];
    if (item) {
      const rect = this.itemLineRect(index);
      this.drawText(item.name, rect.x, rect.y, rect.width);
    }
  };

  Window_BattlerList.prototype.refresh = function () {
    this.makeItemList();
    this.contents.clear();
    this.drawAllItems();
  };

  Window_BattlerList.prototype.select = function (index) {
    Window_Selectable.prototype.select.call(this, index);
    // Trigger the select handler when selection changes
    if (this.isHandled('select')) {
      this.callHandler('select');
    }
  };

  // ============================================================================
  // Window_BattlerPreview - Preview of selected battler
  // ============================================================================
  function Window_BattlerPreview() {
    this.initialize(...arguments);
  }

  Window_BattlerPreview.prototype = Object.create(Window_Base.prototype);
  Window_BattlerPreview.prototype.constructor = Window_BattlerPreview;

  Window_BattlerPreview.prototype.initialize = function (rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this._currentBattler = null;
  };

  Window_BattlerPreview.prototype.setBattler = function (filename) {
    if (this._currentBattler !== filename) {
      this._currentBattler = filename;
      this.refresh();
    }
  };

  Window_BattlerPreview.prototype.refresh = function () {
    this.contents.clear();

    if (!this._currentBattler) {
      this.drawText(T('Creature.selectABattler'), 0, 0, this.contentsWidth(), 'center');
      return;
    }

    const bitmap = ImageManager.loadEnemy(this._currentBattler);
    if (!bitmap.isReady()) {
      bitmap.addLoadListener(() => this.refresh());
      return;
    }

    // Draw the battler image centered in the preview window
    const maxWidth = this.contentsWidth() - 16;
    const maxHeight = this.contentsHeight() - 16;

    // Calculate aspect ratio and scale accordingly
    const scale = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height);
    const scaledWidth = Math.floor(bitmap.width * scale);
    const scaledHeight = Math.floor(bitmap.height * scale);

    // Center the battler in the window
    const x = Math.floor((this.contentsWidth() - scaledWidth) / 2);
    const y = Math.floor((this.contentsHeight() - scaledHeight) / 2);

    // Draw the battler image
    this.contents.blt(
      bitmap,
      0, 0, bitmap.width, bitmap.height,
      x, y, scaledWidth, scaledHeight
    );
  };

  // ============================================================================
  // Animal sprite entries moved from CharacterSpriteGridSelector
  // isAnimal: true → drawn without forced fixed direction
  // ============================================================================
  const ANIMAL_SPRITE_ENTRIES = [
    { displayName: 'Animals01Color_0', path: 'Animals01Color', index: 0 },
    { displayName: 'Animals01Color_1', path: 'Animals01Color', index: 1 },
    { displayName: 'Animals01Color_2', path: 'Animals01Color', index: 2 },
    { displayName: 'Animals01Color_3', path: 'Animals01Color', index: 3 },
    { displayName: 'Animals01Color_4', path: 'Animals01Color', index: 4 },
    { displayName: 'FarmAnimals01RM_0', path: 'FarmAnimals01RM', index: 0 },
    { displayName: 'FarmAnimals01RM_1', path: 'FarmAnimals01RM', index: 1 },
    { displayName: 'FarmAnimals01RM_2', path: 'FarmAnimals01RM', index: 2 },
    { displayName: 'FarmAnimals01RM_3', path: 'FarmAnimals01RM', index: 3 },
    { displayName: 'FarmAnimals01RM_4', path: 'FarmAnimals01RM', index: 4 },
    { displayName: 'FarmAnimals01RM_5', path: 'FarmAnimals01RM', index: 5 },
    { displayName: 'FarmAnimals01RM_6', path: 'FarmAnimals01RM', index: 6 },
    { displayName: 'FarmAnimals01RM_7', path: 'FarmAnimals01RM', index: 7 },
    { displayName: 'FarmAnimals02RM_0', path: 'FarmAnimals02RM', index: 0 },
    { displayName: 'FarmAnimals02RM_1', path: 'FarmAnimals02RM', index: 1 },
    { displayName: 'FarmAnimals02RM_2', path: 'FarmAnimals02RM', index: 2 },
    { displayName: 'FarmAnimals02RM_3', path: 'FarmAnimals02RM', index: 3 },
    { displayName: 'FarmAnimals02RM_4', path: 'FarmAnimals02RM', index: 4 },
    { displayName: 'FarmAnimals02RM_5', path: 'FarmAnimals02RM', index: 5 },
    { displayName: 'FarmAnimals02RM_6', path: 'FarmAnimals02RM', index: 6 },
    { displayName: 'FarmAnimals02RM_7', path: 'FarmAnimals02RM', index: 7 },
    { displayName: 'MV_Chick', path: 'Animals/!$MV_Chick', index: 0 },
    { displayName: 'MV_Chicken_1', path: 'Animals/!$MV_Chicken_1', index: 0 },
    { displayName: 'MV_Chicken_2', path: 'Animals/!$MV_Chicken_2', index: 0 },
    { displayName: 'MV_Chicken_3', path: 'Animals/!$MV_Chicken_3', index: 0 },
    { displayName: 'MV_Chicken_4', path: 'Animals/!$MV_Chicken_4', index: 0 },
    { displayName: 'MV_Chicken_5', path: 'Animals/!$MV_Chicken_5', index: 0 },
    { displayName: 'MV_Chicken_6', path: 'Animals/!$MV_Chicken_6', index: 0 },
    { displayName: 'MV_Chicken_7', path: 'Animals/!$MV_Chicken_7', index: 0 },
    { displayName: 'MV_Chicken_Old', path: 'Animals/!$MV_Chicken_Old', index: 0 },
    { displayName: 'MV_Cow_Baby_1', path: 'Animals/!$MV_Cow_Baby_1', index: 0 },
    { displayName: 'MV_Cow_Baby_2', path: 'Animals/!$MV_Cow_Baby_2', index: 0 },
    { displayName: 'MV_Duckling_1', path: 'Animals/!$MV_Duckling_1', index: 0 },
    { displayName: 'MV_Duckling_2', path: 'Animals/!$MV_Duckling_2', index: 0 },
    { displayName: 'MV_Goat_Baby_1', path: 'Animals/!$MV_Goat_Baby_1', index: 0 },
    { displayName: 'MV_Goat_Baby_2', path: 'Animals/!$MV_Goat_Baby_2', index: 0 },
    { displayName: 'MV_Piglet_1', path: 'Animals/!$MV_Piglet_1', index: 0 },
    { displayName: 'MV_Piglet_2', path: 'Animals/!$MV_Piglet_2', index: 0 },
  ];

  // ============================================================================
  // Window_CharacterSelect - Grid of character sprites (monsters + animals)
  // ============================================================================
  function Window_CharacterSelect() {
    this.initialize(...arguments);
  }

  Window_CharacterSelect.prototype = Object.create(Window_Selectable.prototype);
  Window_CharacterSelect.prototype.constructor = Window_CharacterSelect;

  Window_CharacterSelect.prototype.initialize = function (rect) {
    this._images = [];  // array of { displayName, path, index, isAnimal }
    this._bitmaps = [];
    this._archetypes = [];
    Window_Selectable.prototype.initialize.call(this, rect);
    this.loadImages();
  };

  Window_CharacterSelect.prototype.setArchetypes = function (archetypes) {
    this._archetypes = archetypes || [];
    this.loadImages();
  };

  Window_CharacterSelect.prototype.processCursorMove = function () {};
  Window_CharacterSelect.prototype.processHandling = function () {};
  Window_CharacterSelect.prototype.processTouch = function () {};

  Window_CharacterSelect.prototype.maxCols = function () {
    return 4; // Matches the 4-column visual grid
  };

  Window_CharacterSelect.prototype.maxItems = function () {
    return this._images.length;
  };

  Window_CharacterSelect.prototype.itemHeight = function () {
    return 120;
  };

  Window_CharacterSelect.prototype.loadImages = function () {
    this._images = [];
    this._bitmaps = [];

    const formatName = (name) => {
      let n = name.replace(/[\$!]/g, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
      const words = n.split(' ');
      if (words.length >= 2) {
        words.shift();
      }
      return words.join(' ');
    };

    const entries = [];

    const { EnemyArchetypes } = window.Health || {};
    const allowedSprites = new Set();
    if (EnemyArchetypes && this._archetypes.length > 0) {
      for (const archKey of this._archetypes) {
        const arch = EnemyArchetypes[archKey];
        if (arch && arch.sprites) {
          arch.sprites.forEach(s => allowedSprites.add(s));
        }
      }
    }

    // Load monster sprites from img/characters/Monsters/
    const fs = require('fs');
    const path = require('path');
    const monstersPath = path.join(path.dirname(process.mainModule.filename), 'img/characters/Monsters/');

    try {
      const files = fs.readdirSync(monstersPath);
      for (const file of files) {
        const filePath = path.join(monstersPath, file);
        if (fs.statSync(filePath).isFile() && /\.(png|jpg|jpeg)$/i.test(file)) {
          const name = file.replace(/\.(png|jpg|jpeg)$/i, '');
          const normalizedName = name.replace(/^[\$!]/, '');

          // Only include if in allowedSprites or if no archetypes were provided (default behavior)
          if (this._archetypes.length === 0 || allowedSprites.has(normalizedName)) {
            entries.push({ displayName: formatName(name), path: 'Monsters/' + name, index: 0, isAnimal: false });
          }
        }
      }
    } catch (error) {
      console.error('Error loading monster character images:', error);
    }

    // Add animal sprites only if no specific archetype filter is active or if specifically allowed
    // For now, we only show animals if no archetype filter is active
    if (this._archetypes.length === 0) {
      for (const a of ANIMAL_SPRITE_ENTRIES) {
        entries.push({ displayName: formatName(a.displayName), path: a.path, index: a.index, isAnimal: true });
      }
    }

    // Sort all entries alphabetically by displayName (case-insensitive)
    entries.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

    this._images = entries;
    this._bitmaps = entries.map(e => ImageManager.loadCharacter(e.path));

    this.refresh();
  };

  Window_CharacterSelect.prototype.item = function () {
    return this._images[this.index()] || null;
  };

  Window_CharacterSelect.prototype.drawItem = function (index) {
    if (index < 0 || index >= this._images.length) return;

    const entry = this._images[index];
    const rect = this.itemRect(index);
    const bitmap = this._bitmaps[index];

    if (!bitmap) return;
    if (!bitmap.isReady()) {
      bitmap.addLoadListener(() => this.redrawItem(index));
      return;
    }

    let pw, ph, sx, sy;

    if (entry.isAnimal) {
      // Animals: respect isBigCharacter flag, no hardcoded frame/direction forcing
      const big = ImageManager.isBigCharacter(entry.path);
      if (big) {
        // !$ single big character: 3 frames × 4 directions
        pw = bitmap.width / 3;
        ph = bitmap.height / 4;
        const pattern = 1;                  // standing frame
        const dirRow = 0;                   // row 0 = facing down
        sx = pattern * pw;
        sy = dirRow * ph;
      } else {
        // Multi-character sheet: 12 columns × 8 rows
        pw = bitmap.width / 12;
        ph = bitmap.height / 8;
        const ci = entry.index;
        const pattern = 1;
        sx = ((ci % 4) * 3 + pattern) * pw;
        sy = (Math.floor(ci / 4) * 4) * ph;  // row 0 within character = facing down
      }
    } else {
      // Monsters: forced middle column, facing down (existing behaviour)
      pw = bitmap.width / 3;
      ph = bitmap.height / 4;
      sx = pw;   // column 1
      sy = 0;    // row 0 = facing down
    }

    // Sprite drawing area (top part)
    const textHeight = 24;
    const spriteRectHeight = rect.height - textHeight;
    const scale = Math.min((rect.width - 8) / pw, (spriteRectHeight - 8) / ph, 1.0);
    const dw = pw * scale;
    const dh = ph * scale;
    const dx = rect.x + (rect.width - dw) / 2;
    const dy = rect.y + (spriteRectHeight - dh) / 2;

    this.contents.blt(bitmap, sx, sy, pw, ph, dx, dy, dw, dh);

    // Name drawing area (bottom part)
    const oldFontSize = this.contents.fontSize;
    this.contents.fontSize = 14;
    this.drawText(entry.displayName, rect.x, rect.y + spriteRectHeight, rect.width, 'center');
    this.contents.fontSize = oldFontSize;
  };

  Window_CharacterSelect.prototype.refresh = function () {
    this.contents.clear();
    this.drawAllItems();
  };

  Window_CharacterSelect.prototype.update = function () {
    Window_Selectable.prototype.update.call(this);
  };

  // ============================================================================
  // Window_CreateCreatureMode - Baseline/Hybrid choice
  // ============================================================================
  function Window_CreateCreatureMode() {
    this.initialize(...arguments);
  }

  Window_CreateCreatureMode.prototype = Object.create(Window_Command.prototype);
  Window_CreateCreatureMode.prototype.constructor = Window_CreateCreatureMode;

  Window_CreateCreatureMode.prototype.initialize = function (rect) {
    Window_Command.prototype.initialize.call(this, rect);
  };

  Window_CreateCreatureMode.prototype.processCursorMove = function () {};
  Window_CreateCreatureMode.prototype.processHandling = function () {};
  Window_CreateCreatureMode.prototype.processTouch = function () {};

  Window_CreateCreatureMode.prototype.maxCols = function () {
    return 2;
  };

  Window_CreateCreatureMode.prototype.makeCommandList = function () {
    this.addCommand(T('Creature.baseline'), "baseline");
    this.addCommand(T('Creature.hybrid'), "hybrid");
  };

  Window_CreateCreatureMode.prototype.cursorDown = function (wrap) {
    this.cursorRight(wrap);
  };

  Window_CreateCreatureMode.prototype.cursorUp = function (wrap) {
    this.cursorLeft(wrap);
  };


  // ============================================================================
  // Window_ArchetypeParts - Display archetype parts
  // ============================================================================
  function Window_ArchetypeParts() {
    this.initialize(...arguments);
  }

  Window_ArchetypeParts.prototype = Object.create(Window_Base.prototype);
  Window_ArchetypeParts.prototype.constructor = Window_ArchetypeParts;

  Window_ArchetypeParts.prototype.initialize = function (rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this._arch1Key = null;
    this._arch2Key = null;
  };

  Window_ArchetypeParts.prototype.setArchetypes = function (arch1Key, arch2Key) {
    if (this._arch1Key !== arch1Key || this._arch2Key !== arch2Key) {
      this._arch1Key = arch1Key;
      this._arch2Key = arch2Key;
      this.refresh();
    }
  };

  Window_ArchetypeParts.prototype.refresh = function () {
    this.contents.clear();
    const { EnemyArchetypes } = window.Health || {};
    if (!EnemyArchetypes) return;

    const arch1 = this._arch1Key ? EnemyArchetypes[this._arch1Key] : null;
    const arch2 = this._arch2Key ? EnemyArchetypes[this._arch2Key] : null;

    if (!arch1 && !arch2) {
      this.drawText(T('Creature.selectAnArchetype'), 0, 0, this.contentsWidth(), "center");
      return;
    }

    const mergedParts = {};

    // Add parts from Arch 1
    if (arch1) {
      for (const partKey in arch1.parts) {
        mergedParts[partKey] = { part: arch1.parts[partKey], from: 1 };
      }
    }
    // Add/overwrite parts from Arch 2
    if (arch2) {
      for (const partKey in arch2.parts) {
        mergedParts[partKey] = { part: arch2.parts[partKey], from: 2 };
      }
    }

    let y = 0;
    const lineHeight = this.lineHeight();
    const titleWidth = this.contentsWidth() / 2;

    // Draw Titles
    if (arch1) {
      this.changeTextColor(ColorManager.systemColor());
      const arch1Name = window.getArchetypeText(`enemyArchetypes.${this._arch1Key.toLowerCase()}.name`) /* i18n-ignore: enemyArchetypes.json key */ || this._arch1Key;
      this.drawText(arch1Name, 0, y, titleWidth);
      this.resetTextColor();
    }
    if (arch2) {
      this.changeTextColor(ColorManager.crisisColor());
      const arch2Name = window.getArchetypeText(`enemyArchetypes.${this._arch2Key.toLowerCase()}.name`) /* i18n-ignore: enemyArchetypes.json key */ || this._arch2Key;
      this.drawText(arch2Name, titleWidth, y, titleWidth);
      this.resetTextColor();
    }
    y += lineHeight + 4;
    this.contents.fillRect(0, y - 2, this.contentsWidth(), 2, ColorManager.gaugeBackColor());

    // Draw Merged Part List
    for (const partKey in mergedParts) {
      const { part, from } = mergedParts[partKey];
      const name = window.getArchetypeText(part.name);

      // Color-code based on origin
      if (from === 2) {
        // From Arch 2 (or overwrite)
        this.changeTextColor(ColorManager.crisisColor());
      } else {
        // From Arch 1
        this.changeTextColor(ColorManager.normalColor());
      }

      this.drawText(name, 0, y, this.contentsWidth());
      y += lineHeight;

      // Stop if window is full
      if (y > this.contentsHeight() - lineHeight) {
        this.drawText("...", 0, y, this.contentsWidth());
        break;
      }
    }

    this.resetTextColor();
  };

  // ============================================================================
  // Scene_CreateCreature - Main creature creation scene
  // ============================================================================
  function Scene_CreateCreature() {
    this.initialize(...arguments);
  }

  Scene_CreateCreature.prototype = Object.create(Scene_MenuBase.prototype);
  Scene_CreateCreature.prototype.constructor = Scene_CreateCreature;

  // Static method to set target actor ID before opening the scene
  Scene_CreateCreature.setTargetActorId = function (actorId) {
    Scene_CreateCreature._targetActorId = actorId || 1;
  };

  Scene_CreateCreature.prototype.initialize = function () {
    Scene_MenuBase.prototype.initialize.call(this);
    this._selectedArchetype1 = null;
    this._selectedArchetype2 = null;
    this._selectedBattler = null;
    this._selectedCharacter = null;
    this._mode = 'hybrid'; // resolved at confirm: 'baseline' (1 archetype) or 'hybrid' (2)
    this._step = 1; // 1 = archetype(s), 3 = battler, 4 = character (old mode/arch2 steps merged into 1)
    this._targetActorId = Scene_CreateCreature._targetActorId || 1; // Target actor ID (default: 1, can be 1, 2, or 3)
    this._lastStepDOM = -1;
    this._creatureGenSeed = null; // random 3D look seed of the current preview
    this._customModel = false;    // custom 3D model chosen at the battler step
    this._customArchetypeKeys = null;
  };

  Scene_CreateCreature.prototype.create = function () {
    Scene_MenuBase.prototype.create.call(this);
    // Battler step shows a live procedural 3D model (reusing the Bestiary
    // viewer) when the 3D battler system is available; otherwise it falls back
    // to the flat 2D enemy image.
    this._show3DCreature = (typeof THREE !== 'undefined' && window.Battler3D && !!window.Battler3D.create);
    this._creature3D = null;
    this._creature3DEnemyId = -1;
    this._wasdInput = { up: false, down: false, left: false, right: false };
    this._wasdHeld = { up: false, down: false, left: false, right: false };
    this._wasdHoldFrames = { up: 0, down: 0, left: 0, right: 0 };
    this._wasdListener = (event) => {
      if (event.repeat) return;
      const windowObj = this._getActiveWindow();
      if (!windowObj || !windowObj.active) return;
      const key = event.key.toLowerCase();
      if (key === "w") { this._wasdInput.up = true; this._wasdHeld.up = true; event.preventDefault(); }
      if (key === "s") { this._wasdInput.down = true; this._wasdHeld.down = true; event.preventDefault(); }
      if (key === "a") { this._wasdInput.left = true; this._wasdHeld.left = true; event.preventDefault(); }
      if (key === "d") { this._wasdInput.right = true; this._wasdHeld.right = true; event.preventDefault(); }
    };
    this._wasdUpListener = (event) => {
      const key = event.key.toLowerCase();
      if (key === "w") { this._wasdHeld.up = false; this._wasdHoldFrames.up = 0; }
      if (key === "s") { this._wasdHeld.down = false; this._wasdHoldFrames.down = 0; }
      if (key === "a") { this._wasdHeld.left = false; this._wasdHoldFrames.left = 0; }
      if (key === "d") { this._wasdHeld.right = false; this._wasdHoldFrames.right = 0; }
    };
    window.addEventListener("keydown", this._wasdListener);
    window.addEventListener("keyup", this._wasdUpListener);
    this.createHelpWindow();
    this.createModeWindow();
    this.createArchetypeWindow();
    this.createArchetypePartsWindow();
    this.createBattlerWindow();
    this.createCharacterWindow();

    // Resume after the custom 3D model editor. The editor is a separate scene,
    // so RMMZ recreated this one fresh on pop; restore the flow from the static
    // and land on the sprite step (confirm) or back on the battler step (cancel)
    // rather than restarting from archetype selection.
    const resume = Scene_CreateCreature._resumeCreature;
    if (resume) {
      Scene_CreateCreature._resumeCreature = null;
      this._targetActorId = resume.targetActorId || this._targetActorId;
      this._selectedArchetype1 = resume.arch1 || null;
      this._selectedArchetype2 = resume.arch2 || null;
      this._mode = resume.mode || "baseline";
      this._customArchetypeKeys = resume.keys || null;
      const result = window.Scene_CC3DModel ? window.Scene_CC3DModel._creatureResult : null;
      if (window.Scene_CC3DModel) window.Scene_CC3DModel._creatureResult = null;
      if (result === "confirm") {
        this._customModel = true;
        this.showStep(4); // model saved -> pick the overworld sprite
      } else {
        this._customModel = false;
        this.showStep(3); // cancelled -> back to battler / Custom selection
      }
    } else {
      this.showStep(1);
    }
    this.createUIOverlay();
  };

  Scene_CreateCreature.prototype.terminate = function () {
    Scene_MenuBase.prototype.terminate.call(this);
    this.cleanupCreature3D();
    if (this._wasdListener) {
      window.removeEventListener("keydown", this._wasdListener);
      this._wasdListener = null;
    }
    if (this._wasdUpListener) {
      window.removeEventListener("keyup", this._wasdUpListener);
      this._wasdUpListener = null;
    }
    if (this._dndContainer) {
      this._dndContainer.style.display = "none";
    }
  };

  Scene_CreateCreature.prototype.createUIOverlay = function () {
    // 1. Mute MZ windows
    if (this._helpWindow) {
      this._helpWindow.visible = false;
      this._helpWindow.opacity = 0;
    }
    if (this._modeWindow) {
      this._modeWindow.visible = false;
      this._modeWindow.opacity = 0;
    }
    if (this._archetypeWindow) {
      this._archetypeWindow.visible = false;
      this._archetypeWindow.opacity = 0;
    }
    if (this._archetypePartsWindow) {
      this._archetypePartsWindow.visible = false;
      this._archetypePartsWindow.opacity = 0;
    }
    if (this._battlerListWindow) {
      this._battlerListWindow.visible = false;
      this._battlerListWindow.opacity = 0;
    }
    if (this._battlerPreviewWindow) {
      this._battlerPreviewWindow.visible = false;
      this._battlerPreviewWindow.opacity = 0;
    }
    if (this._characterWindow) {
      this._characterWindow.visible = false;
      this._characterWindow.opacity = 0;
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

    this._lastStep = -1;
    this._lastIndex = -1;
    this._lastStepDOM = -1;

    // Wheel + L2/R2 scrolling for the card boards. See CCScroll.
    if (window.CCScroll) window.CCScroll.bindWheel(this._dndContainer);

    this.refreshUIOverlayDOM();
  };

  Scene_CreateCreature.prototype.getSpriteStyle = function (spriteName, spriteIndex, scale) {
    if (!spriteName) return "";
    const sz = Math.round(48 * (scale || 1));
    const isBig = ImageManager.isBigCharacter(spriteName);
    const url = `img/characters/${spriteName}.png`;
    if (isBig) {
      return `background-image: url('${url}'); background-position: 50% 0%; background-size: 300% 400%; width: ${sz}px; height: ${sz}px; image-rendering: pixelated;`;
    } else {
      const col = spriteIndex % 4;
      const row = Math.floor(spriteIndex / 4);
      const fx = col * 3 + 1;
      const fy = row * 4;
      const pctX = (fx / 11) * 100;
      const pctY = (fy / 7) * 100;
      return `background-image: url('${url}'); background-position: ${pctX}% ${pctY}%; background-size: 1200% 800%; width: ${sz}px; height: ${sz}px; image-rendering: pixelated;`;
    }
  };

  Scene_CreateCreature.prototype.refreshUIOverlayDOM = function () {
    if (!this._dndContainer) return;

    const activeIndex = this._step === 0 ? this._modeWindow.index() :
      this._step === 1 || this._step === 2 ? this._archetypeWindow.index() :
      this._step === 3 ? this._battlerListWindow.index() :
      this._characterWindow.index();

    // Only a real step change rebuilds the whole spread. The archetype screen is
    // always in multi-select ('hybrid') mode, so keying off the mode rebuilt both
    // pages on every cursor move and made the board flash.
    const isStepChange = (this._lastStepDOM !== this._step);

    let leftHtml = "";
    let rightHtml = "";

    if (this._step === 0) {
      // --- INCUBATION MODE SELECTION (STEP 0) ---
      const activeIdx = this._modeWindow.index();

      leftHtml = `
        <div class="cc-page cc-page-left">
          <h2 class="cc-header-gothic">${T('CharCreate.creatureCreation')}</h2>
          <p class="cc-text-desc">${T('CharCreate.chooseATypeOfCreation')}</p>

          <div class="cc-select-grid cc-spaced">
            <div class="cc-card-option ${activeIdx === 0 ? 'selected' : ''}" onclick="SceneManager._scene.onModeCardClick(0)">
              <div class="cc-option-title">${T('CharCreate.baselineCreature')}</div>
            </div>
            <div class="cc-card-option ${activeIdx === 1 ? 'selected' : ''}" onclick="SceneManager._scene.onModeCardClick(1)">
              <div class="cc-option-title">${T('CharCreate.hybridMonstrosity')}</div>
            </div>
          </div>
        </div>
      `;

      rightHtml = `
        <div class="cc-page cc-page-right cc-page-centered">
          <h2 class="cc-header-gothic">${T('CharCreate.archetipes')}</h2>

          
          <div class="cc-tube-container">
            <div class="cc-tube-fluid"></div>
            <div class="cc-tube-label">TUBE-01</div>   <!-- i18n-ignore: equipment serial -->
          </div>

          <div class="cc-button-panel" style="margin-top: 16px;">
            <button class="cc-btn-treaty" onclick="SceneManager._scene.onCreationCancel()">${T('CharCreate.cancel')}</button>
            <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onModeCardConfirm()">${T('CharCreate.continue')}</button>
          </div>
        </div>
      `;
    } else if (this._step === 1 || this._step === 2) {
      // --- BASE/HYBRID ARCHETYPE SELECTION (STEP 1 & 2) ---
      const activeItem = this._archetypeWindow.item();
      const activeIdx = this._archetypeWindow.index();

      let leftSubheaderName = "";
      let partsHtml = "";

      if (this._mode === 'baseline') {
        if (activeItem) {
          leftSubheaderName = activeItem.name;
          const { EnemyArchetypes } = window.Health || {};
          const arch = EnemyArchetypes ? EnemyArchetypes[activeItem.key] : null;
          if (arch) {
            // Base skills section
            let skillsHtml = "";
            if (arch.skills && arch.skills.length > 0) {
              skillsHtml = `<div class="cc-dossier-section-title" style="color: #b87333; font-weight: bold; margin: 4px 0 2px 0; font-size: 0.85rem;">${T('CharCreate.baseSkills')}</div>` +
                arch.skills.map(sid => {
                  const sname = getSkillDisplayName(sid) || sid;
                  return `<div class="cc-dossier-row" style="margin-bottom: 0;"><span class="cc-dossier-label" style="color: #b87333;">${sname}</span><span class="cc-dossier-value" style="font-size: 0.75rem; color: #888;">#${sid}</span></div>`;
                }).join("");
            }
            // Parts section
            let bodyHtml = "";
            if (arch.parts) {
              bodyHtml = `<div class="cc-dossier-section-title" style="color: #4a7c59; font-weight: bold; margin: 4px 0 2px 0; font-size: 0.85rem;">${T('CharCreate.anatomy')}</div>` +
                Object.keys(arch.parts).map(k => {
                  const p = arch.parts[k];
                  const name = window.getArchetypeText(p.name) || p.name;
                  const skillName = getSkillDisplayName(p.skillId);
                  const skillInfo = skillName ? `<span style="font-size: 0.75rem; color: #888; font-style: italic;">, ${skillName}</span>` : "";
                  return `
                    <div class="cc-dossier-row" style="margin-bottom: 0;">
                      <span class="cc-dossier-label">${name}:</span>
                      <span class="cc-dossier-value">${p.hpPercent}% HP${skillInfo}</span>
                    </div>
                  `;
                }).join("");
            }
            partsHtml = skillsHtml + bodyHtml;
          }
        }
      } else {
        // Hybrid mode: display parts of BOTH selected archetypes
        const { EnemyArchetypes } = window.Health || {};
        const arch1 = this._selectedArchetype1 ? EnemyArchetypes[this._selectedArchetype1] : null;
        const arch2 = this._selectedArchetype2 ? EnemyArchetypes[this._selectedArchetype2] : null;

        if (!arch1 && !arch2) {
          // No selections: show hovered/active item as preview
          if (activeItem) {
            leftSubheaderName = activeItem.name + ` (${T('CharCreate.preview')})`;
            const arch = EnemyArchetypes ? EnemyArchetypes[activeItem.key] : null;
            if (arch) {
              // Base skills section
              let skillsHtml = "";
              if (arch.skills && arch.skills.length > 0) {
                skillsHtml = `<div class="cc-dossier-section-title" style="color: #b87333; font-weight: bold; margin: 4px 0 2px 0; font-size: 0.85rem;">${T('CharCreate.baseSkills')}</div>` +
                  arch.skills.map(sid => {
                    const sname = getSkillDisplayName(sid) || sid;
                    return `<div class="cc-dossier-row" style="margin-bottom: 0;"><span class="cc-dossier-label" style="color: #b87333;">${sname}</span><span class="cc-dossier-value" style="font-size: 0.75rem; color: #888;">#${sid}</span></div>`;
                  }).join("");
              }
              // Parts section
              let bodyHtml = "";
              if (arch.parts) {
                bodyHtml = `<div class="cc-dossier-section-title" style="color: #4a7c59; font-weight: bold; margin: 4px 0 2px 0; font-size: 0.85rem;">${T('CharCreate.anatomy')}</div>` +
                  Object.keys(arch.parts).map(k => {
                    const p = arch.parts[k];
                    const name = window.getArchetypeText(p.name) || p.name;
                    const skillName = getSkillDisplayName(p.skillId);
                    const skillInfo = skillName ? `<span style="font-size: 0.75rem; color: #888; font-style: italic;">, ${skillName}</span>` : "";
                    return `
                      <div class="cc-dossier-row" style="margin-bottom: 0;">
                        <span class="cc-dossier-label">${name}:</span>
                        <span class="cc-dossier-value">${p.hpPercent}% HP${skillInfo}</span>
                      </div>
                    `;
                  }).join("");
              }
              partsHtml = skillsHtml + bodyHtml;
            }
          } else {
            leftSubheaderName = "...";
            partsHtml = `<div class="cc-text-desc" style="font-style: italic; grid-column: span 2; width: 100%; text-align: center;">${T('CharCreate.selectArchetypes')}</div>`;
          }
        } else {
          // Merged display
          const name1 = this._selectedArchetype1 ? (window.getArchetypeText(`enemyArchetypes.${this._selectedArchetype1.toLowerCase()}.name`) /* i18n-ignore: enemyArchetypes.json key */ || this._selectedArchetype1) : "";
          const name2 = this._selectedArchetype2 ? (window.getArchetypeText(`enemyArchetypes.${this._selectedArchetype2.toLowerCase()}.name`) /* i18n-ignore: enemyArchetypes.json key */ || this._selectedArchetype2) : "";
          
          if (name1 && name2) {
            leftSubheaderName = `${name1} + ${name2}`;
          } else {
            leftSubheaderName = name1 || name2;
          }

          const mergedParts = {};
          if (arch1) {
            for (const partKey in arch1.parts) {
              mergedParts[partKey] = { part: arch1.parts[partKey], from: 1 };
            }
          }
          if (arch2) {
            for (const partKey in arch2.parts) {
              mergedParts[partKey] = { part: arch2.parts[partKey], from: 2 };
            }
          }

          // Base skills from both archetypes (unique union)
          const mergedSkillIds = new Set();
          if (arch1 && arch1.skills) arch1.skills.forEach(sid => mergedSkillIds.add(sid));
          if (arch2 && arch2.skills) arch2.skills.forEach(sid => mergedSkillIds.add(sid));
          let skillsHtml = "";
          if (mergedSkillIds.size > 0) {
            skillsHtml = `<div class="cc-dossier-section-title" style="color: #b87333; font-weight: bold; margin: 4px 0 2px 0; font-size: 0.85rem;">${T('CharCreate.baseSkills')}</div>` +
              Array.from(mergedSkillIds).map(sid => {
                const sname = getSkillDisplayName(sid) || sid;
                const fromArch1 = arch1 && arch1.skills && arch1.skills.includes(sid);
                const fromArch2 = arch2 && arch2.skills && arch2.skills.includes(sid);
                let badges = "";
                if (fromArch1 && fromArch2) {
                  badges = `<span style="font-size: 0.62rem; padding: 1px 3px; background: rgba(130, 45, 45, 0.15); color: #822d2d; border-radius: 4px; margin-left: 4px; font-weight: bold; font-family: monospace;">${T('Creature.ui.primaryBadge')}</span><span style="font-size: 0.62rem; padding: 1px 3px; background: rgba(90, 61, 117, 0.15); color: #5a3d75; border-radius: 4px; margin-left: 2px; font-weight: bold; font-family: monospace;">${T('Creature.ui.secondaryBadge')}</span>`;
                } else if (fromArch1) {
                  badges = `<span style="font-size: 0.62rem; padding: 1px 3px; background: rgba(130, 45, 45, 0.15); color: #822d2d; border-radius: 4px; margin-left: 4px; font-weight: bold; font-family: monospace;">${T('Creature.ui.primaryBadge')}</span>`;
                } else {
                  badges = `<span style="font-size: 0.62rem; padding: 1px 3px; background: rgba(90, 61, 117, 0.15); color: #5a3d75; border-radius: 4px; margin-left: 4px; font-weight: bold; font-family: monospace;">${T('Creature.ui.secondaryBadge')}</span>`;
                }
                return `<div class="cc-dossier-row" style="margin-bottom: 0;"><span class="cc-dossier-label" style="color: #b87333;">${sname}</span><span class="cc-dossier-value" style="font-size: 0.75rem; color: #888;">#${sid}${badges}</span></div>`;
              }).join("");
          }

          let bodyHtml = `<div class="cc-dossier-section-title" style="color: #4a7c59; font-weight: bold; margin: 4px 0 2px 0; font-size: 0.85rem;">${T('CharCreate.anatomy')}</div>` +
            Object.keys(mergedParts).map(partKey => {
              const { part, from } = mergedParts[partKey];
              const name = window.getArchetypeText(part.name) || part.name;
              const originLabel = from === 2 
                ? `<span style="font-size: 0.68rem; padding: 1px 4px; background: rgba(90, 61, 117, 0.15); color: #5a3d75; border-radius: 4px; margin-left: 6px; font-weight: bold; font-family: monospace;">${T('Creature.ui.secondaryBadge')}</span>`
                : `<span style="font-size: 0.68rem; padding: 1px 4px; background: rgba(130, 45, 45, 0.15); color: #822d2d; border-radius: 4px; margin-left: 6px; font-weight: bold; font-family: monospace;">${T('Creature.ui.primaryBadge')}</span>`;
              const skillName = getSkillDisplayName(part.skillId);
              const skillInfo = skillName ? `<span style="font-size: 0.75rem; color: #888; font-style: italic;">, ${skillName}</span>` : "";
              
              return `
                <div class="cc-dossier-row" style="margin-bottom: 0; display: flex; align-items: center;">
                  <div style="display: flex; align-items: center;">
                    <span class="cc-dossier-label" style="color: ${from === 2 ? '#5a3d75' : '#822d2d'}">${name}</span>
                    ${originLabel}
                  </div>
                  <span class="cc-dossier-value" style="font-weight: bold;">${part.hpPercent}% HP${skillInfo}</span>
                </div>
              `;
            }).join("");

          partsHtml = skillsHtml + bodyHtml;
        }
      }

      const archetypeCards = this._archetypeWindow._data.map((item, idx) => {
        // Committed picks show the checkmark badge (.selected); in hybrid mode a
        // Primary/Secondary caption disambiguates the two. Baseline mode marks
        // the cursor itself as selected. The cursor on an unpicked card gets the
        // lighter .highlighted state.
        let isSelected = false;
        let selectionBadge = "";

        if (this._mode === 'baseline') {
          isSelected = idx === activeIdx;
        } else {
          if (this._selectedArchetype1 === item.key) {
            isSelected = true;
            selectionBadge = `<div class="cc-archetype-role" style="color: #822d2d; font-weight: bold; font-size: 0.72rem; margin-top: 2px;">${T('CharCreate.primary')}</div>`;
          } else if (this._selectedArchetype2 === item.key) {
            isSelected = true;
            selectionBadge = `<div class="cc-archetype-role" style="color: #5a3d75; font-weight: bold; font-size: 0.72rem; margin-top: 2px;">${T('CharCreate.secondary')}</div>`;
          }
        }

        const isCursor = !isSelected && idx === activeIndex;
        return `
          <div class="cc-card-option ${isSelected ? 'selected' : isCursor ? 'highlighted' : ''}" onclick="SceneManager._scene.onArchetypeCardClick(${idx})">
            <div class="cc-option-title">${item.name}</div>
            ${selectionBadge}
          </div>
        `;
      }).join("");

      const stepTitle = T('CharCreate.archetypeS');

      const stepDesc = T('CharCreate.selectOneArchetypeTemplateForABaselineCreatu');

      const isConfirmDisabled = !this._selectedArchetype1;
      const bothReady = !!this._selectedArchetype1; // ready to confirm with one or two picks
      const confirmFocusStyle = bothReady ? ' outline: 3px solid #c8a96e; outline-offset: 2px; box-shadow: 0 0 10px rgba(200,169,110,0.6);' : '';

      leftHtml = `
        <div class="cc-page cc-page-left" style="display: flex; flex-direction: column;">
          <h2 class="cc-header-gothic">${stepTitle}</h2>
          <p class="cc-text-desc">${stepDesc}</p>

          <div class="cc-select-grid cc-compact cc-three-col" style="flex: 1; min-height: 0; overflow-y: auto; align-content: start;">
            ${archetypeCards}
          </div>
        </div>
      `;

      rightHtml = `
        <div class="cc-page cc-page-right">
          <h2 class="cc-header-gothic">${T('CharCreate.biology')}</h2>

          <div class="cc-dossier-card" style="margin-top: 16px; flex: 1; min-height: 0; overflow-y: auto;">
            <h3 class="cc-subheader">${leftSubheaderName || "..."}</h3>
            <div class="cc-dossier-grid cc-dossier-grid-single">
              ${partsHtml || `<div class="cc-text-desc" style="font-style: italic; width: 100%; text-align: center;">${T('CharCreate.noAnatomicalOrgansDefined')}</div>`}
            </div>
          </div>

          <div class="cc-button-panel" style="margin-top: 16px;">
            <button class="cc-btn-treaty" onclick="SceneManager._scene.onArchetypeCancel()">${T('CharCreate.back')}</button>
            <button class="cc-btn-treaty confirm" ${isConfirmDisabled ? 'disabled style="opacity: 0.5; pointer-events: none;"' : `style="${confirmFocusStyle}"`} onclick="SceneManager._scene.onArchetypeConfirm()">${T('CharCreate.confirmBlueprint')}</button>
          </div>
        </div>
      `;
    } else if (this._step === 3) {
      // --- BATTLER SELECTION (STEP 3) ---
      const activeItem = this._battlerListWindow.item();
      const activeIdx = this._battlerListWindow.index();

      // Resolve a procedural 3D archetype for the highlighted enemy. When the 3D
      // battler system is available and this enemy maps to a model, show a single
      // live viewport (mirroring the Bestiary); otherwise fall back to the 2D
      // enemy image.
      const activeEnemy = (activeItem && activeItem.id && $dataEnemies) ? $dataEnemies[activeItem.id] : null;
      const activeArchKey = (activeEnemy && window.Battler3D && window.Battler3D.resolveKey)
        ? window.Battler3D.resolveKey(activeEnemy) : null;
      const canShow3D = this._show3DCreature && !!activeArchKey;

      let previewImgHtml = "";
      if (activeItem && activeItem.custom) {
        previewImgHtml = `
          <div style="text-align: center; padding: 24px;">
            <div style="font-size: 2.4rem; margin-bottom: 12px;">&#128736;</div>
            <div style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary-hover); margin-bottom: 8px;">${T('CharCreate.custom3dModel')}</div>
            <div style="font-size: 0.9rem; color: #5c4b3d; max-width: 320px; margin: 0 auto; line-height: 1.4;">${T('CharCreate.sculptAUniqueCreatureFromMixedPartsSeededFro')}</div>
          </div>
        `;
      } else if (canShow3D) {
        const hint = T('CharCreate.dragToRotateWheelToZoomMiddleDragToPan');
        previewImgHtml = `
          <canvas id="creature-3d-canvas" style="width: 100%; height: 380px; min-height: 380px; display: block; cursor: grab; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.4));"></canvas>
          <div style="text-align: center; font-size: 11px; color: rgba(94,47,23,0.55); margin-top: 6px;">${hint}</div>
        `;
      } else if (activeItem && activeItem.battlerName) {
        previewImgHtml = `
          <img src="img/enemies/${activeItem.battlerName}.png" style="max-width: 100%; max-height: 560px; object-fit: contain; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.4));" />
        `;
      } else {
        previewImgHtml = `<span style="font-size: 0.95rem; color: #5c4b3d; font-style: italic;">${T('CharCreate.loadingBattlerAsset')}</span>`;
      }

      // Name-only cards, so they render as compact rows rather than the
      // poster-sized cards the archetype steps use.
      const battlerCards = this._battlerListWindow._data.map((item, idx) => {
        const isSelected = idx === activeIdx;
        return `
          <div class="cc-wanted-card cc-card-compact ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.onBattlerCardClick(${idx})">
            <div class="cc-wanted-name">${item.name}</div>
          </div>
        `;
      }).join("");

      leftHtml = `
        <div class="cc-page cc-page-left" style="align-items: center; justify-content: flex-start;">
          <h2 class="cc-header-gothic" style="margin-bottom: 20px;">${T('CharCreate.profileImage')}</h2>
          <div style="width: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
            ${previewImgHtml}
          </div>
        </div>
      `;

      rightHtml = `
        <div class="cc-page cc-page-right">
          <h2 class="cc-header-gothic">${T('CharCreate.profileImageSelection')}</h2>
          <p class="cc-text-desc">${T('CharCreate.chooseAProfileImage')}</p>

          <div class="cc-presets-board" style="grid-template-columns: repeat(2, 1fr); gap: 8px; flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; margin-top: 16px; align-content: start;">
            ${battlerCards}
          </div>

          <div class="cc-button-panel">
            <button class="cc-btn-treaty" onclick="SceneManager._scene.onBattlerCancel()">${T('CharCreate.back')}</button>
            <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onBattlerOk()">${T('CharCreate.confirm')}</button>
          </div>
        </div>
      `;
    } else if (this._step === 4) {
      // --- CHARACTER SPRITE SELECTION (STEP 4) ---
      const activeItem = this._characterWindow.item();
      const activeIdx = this._characterWindow.index();

      const largeSpriteStyle = activeItem ? this.getSpriteStyle(activeItem.path, activeItem.index, 4) : '';

      const spriteCards = this._characterWindow._images.map((item, idx) => {
        const isSelected = idx === activeIdx;
        return `
          <div class="cc-wanted-card ${isSelected ? 'selected' : ''}" style="padding: 10px 4px; display: flex; flex-direction: column; align-items: center; justify-content: center;" onclick="SceneManager._scene.onCharacterCardClick(${idx})">
            <div class="cc-wanted-sprite" style="${this.getSpriteStyle(item.path, item.index)}; margin-bottom: 4px;"></div>
            <div style="font-family: 'Lora', serif; font-size: 0.72rem; color: #4a3b2c; text-align: center; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; width: 100%;">${item.displayName}</div>
          </div>
        `;
      }).join("");

      leftHtml = `
        <div class="cc-page cc-page-left" style="display: flex; flex-direction: column;">
          <h2 class="cc-header-gothic">${T('CharCreate.sprites')}</h2>

          <div class="cc-presets-board" style="grid-template-columns: repeat(4, 1fr); flex: 1; overflow-y: auto; overflow-x: hidden; gap: 8px; margin-top: 16px; align-content: start;">
            ${spriteCards}
          </div>
        </div>
      `;

      rightHtml = `
        <div class="cc-page cc-page-right" style="align-items: center; justify-content: center;">
          <h2 class="cc-header-gothic" style="margin-bottom: 24px;">${T('CharCreate.selectedSprite')}</h2>
          <p class="cc-text-desc" style="text-align: center;">
            ${T('CharCreate.creatureSynthesisComplete')}
          </p>

          <div style="margin: 24px 0; display: flex; flex-direction: column; align-items: center;">
            <div class="cc-wanted-sprite" style="${largeSpriteStyle}; margin-bottom: 16px;"></div>
            <div style="font-family: 'Lora', serif; font-size: 1.1rem; color: #2b1c11; font-weight: bold;">
              ${activeItem ? activeItem.displayName : "..."}
            </div>
          </div>

          <div class="cc-button-panel" style="margin-top: auto; width: 100%;">
            <button class="cc-btn-treaty" onclick="SceneManager._scene.onCharacterCancel()">${T('CharCreate.back')}</button>
            <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onCharacterOk()">${T('CharCreate.confirm')}</button>
          </div>
        </div>
      `;
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

    if (isStepChange) {
      // Step changed - fully update both page wrappers inside the spread
      spread.innerHTML = `
        ${leftHtml}
        ${rightHtml}
      `;
    } else {
      // Only selection index changed - optimized partial update!
      const leftPage = spread.querySelector(".cc-page-left");
      const rightPage = spread.querySelector(".cc-page-right");

      if (this._step === 0) {
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
      } else if (this._step === 1 || this._step === 2) {
        // Archetype cards are on the left (compact list), biology on the right.
        if (rightPage && rightHtml) {
          const rightInnerHtml = rightHtml.replace(/^\s*<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
          rightPage.innerHTML = rightInnerHtml;
        }
        if (leftPage) {
          const cards = leftPage.querySelectorAll(".cc-card-option");
          cards.forEach((card, idx) => {
            const item = this._archetypeWindow._data[idx];
            const committed = item &&
              (this._selectedArchetype1 === item.key || this._selectedArchetype2 === item.key);
            const isSelected = this._mode === 'baseline' ? idx === activeIndex : !!committed;
            card.classList.toggle("selected", isSelected);
            card.classList.toggle("highlighted", !isSelected && idx === activeIndex);
            // Keep the Primary/Secondary caption in step with the picks without
            // rebuilding the board.
            const oldBadge = card.querySelector(".cc-archetype-role");
            if (oldBadge) oldBadge.remove();
            if (this._mode !== 'baseline' && item) {
              let badgeText = "";
              let badgeColor = "";
              if (this._selectedArchetype1 === item.key) {
                badgeText = T('CharCreate.primary');
                badgeColor = "#822d2d";
              } else if (this._selectedArchetype2 === item.key) {
                badgeText = T('CharCreate.secondary');
                badgeColor = "#5a3d75";
              }
              if (badgeText) {
                const badge = document.createElement("div");
                badge.className = "cc-archetype-role";
                badge.style.cssText = `color: ${badgeColor}; font-weight: bold; font-size: 0.72rem; margin-top: 2px;`;
                badge.textContent = badgeText;
                card.appendChild(badge);
              }
            }
          });
        }
      } else if (this._step === 3) {
        // Cards are on the right; preview image is on the left, update both
        if (leftPage && leftHtml) {
          const leftInnerHtml = leftHtml.replace(/^\s*<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
          leftPage.innerHTML = leftInnerHtml;
        }
        if (rightPage) {
          const cards = rightPage.querySelectorAll(".cc-wanted-card");
          cards.forEach((card, idx) => {
            card.classList.toggle("selected", idx === activeIndex);
          });
        }
      } else if (this._step === 4) {
        // Cards are on the left; sprite preview is on the right, update both
        if (rightPage && rightHtml) {
          const rightInnerHtml = rightHtml.replace(/^\s*<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
          rightPage.innerHTML = rightInnerHtml;
        }
        if (leftPage) {
          const cards = leftPage.querySelectorAll(".cc-wanted-card");
          cards.forEach((card, idx) => {
            card.classList.toggle("selected", idx === activeIndex);
          });
        }
      }
    }

    // Record states for the next check
    this._lastIndex = activeIndex;
    this._lastStep = this._step;
    this._lastStepDOM = this._step;

    this._scrollToSelectedCard();
    this._syncCreature3D();
  };

  // ============================================================================
  // 3D battler viewport for the battler step (ported from Bestiary.js).
  // Shows a single live procedural model for the highlighted enemy with
  // orbit / pan / zoom, reused across selection changes.
  // ============================================================================
  Scene_CreateCreature.prototype._syncCreature3D = function () {
    // Only the battler step (3) hosts the 3D viewport.
    if (this._step !== 3 || !this._show3DCreature) {
      this.cleanupCreature3D();
      return;
    }
    const item = this._battlerListWindow ? this._battlerListWindow.item() : null;
    const enemy = (item && item.id && $dataEnemies) ? $dataEnemies[item.id] : null;
    const archKey = (enemy && window.Battler3D && window.Battler3D.resolveKey)
      ? window.Battler3D.resolveKey(enemy) : null;
    const canvas = document.getElementById('creature-3d-canvas');
    if (!enemy || !archKey || !canvas) {
      this.cleanupCreature3D();
      return;
    }
    // The left page is rebuilt on every selection change, so the canvas node is
    // new each time. Only skip re-init when both the canvas node and the enemy
    // are unchanged.
    if (this._creature3D && this._creature3D.canvas === canvas && this._creature3DEnemyId === enemy.id) {
      return;
    }
    // initCreature3D() calls cleanupCreature3D() which resets _creature3DEnemyId
    // to -1, so record the id AFTER init for the guard above to take effect.
    this.initCreature3D(enemy, archKey);
    this._creature3DEnemyId = enemy.id;
  };

  Scene_CreateCreature.prototype.initCreature3D = function (enemyData, archKey) {
    this.cleanupCreature3D();
    if (typeof THREE === 'undefined' || !window.Battler3D || !window.Battler3D.create) return;
    const canvas = document.getElementById('creature-3d-canvas');
    if (!canvas) return;

    const rect   = canvas.getBoundingClientRect();
    const width  = Math.max(1, Math.round(rect.width)  || 320);
    const height = Math.max(1, Math.round(rect.height) || 320);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const keyLight  = new THREE.DirectionalLight(0xfff2d0, 1.4); keyLight.position.set(3, 5, 4);   scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.7); fillLight.position.set(-3, -2, 2); scene.add(fillLight);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 300);
    camera.position.set(0, 0, 8);

    const pivot = new THREE.Group();
    scene.add(pivot);

    const state = {
      renderer, canvas, scene, camera, pivot,
      model: null, rafId: 0, disposed: false, dragging: false, attackTimer: 0, frameAcc: 0,
      activeButton: -1, prev: { x: 0, y: 0 }, clock: new THREE.Clock(), listeners: {}
    };
    this._creature3D = state;

    // Fake battler so the model uses its deterministic per-id look.
    const fakeBattler = { enemyId: () => enemyData.id, index: () => 0 };
    // Every click on a DIFFERENT model re-rolls a random generation seed, so
    // proportions, textures and colours vary between views of the same
    // archetype. The seed is restored right after construction (the seeded
    // draws all happen in the constructor) and persisted on confirm so the
    // previewed look is the one kept (see onBattlerOk / CC3DModel).
    const reseed = 'cc' + (1 + Math.floor(Math.random() * 0x7ffffffe));
    this._creatureGenSeed = reseed;
    const prevGenSeed = window.Battler3D.getGenSeed ? window.Battler3D.getGenSeed() : null;
    if (window.Battler3D.setGenSeed) window.Battler3D.setGenSeed(reseed);
    const battler = window.Battler3D.create(archKey, 0, 0, fakeBattler);
    if (window.Battler3D.setGenSeed && prevGenSeed != null) window.Battler3D.setGenSeed(prevGenSeed);
    if (!battler) {
      try { renderer.dispose(); } catch (e) {}
      try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) {}
      this._creature3D = null;
      return;
    }

    Promise.resolve(battler.load(null, 0, 0, 0)).then(() => {
      if (state.disposed || !battler.model) return;
      try { battler.update(1 / 60); } catch (e) {}
      const box    = new THREE.Box3().setFromObject(battler.model);
      const size   = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const holder = new THREE.Group();
      holder.position.copy(center).multiplyScalar(-1);
      holder.add(battler.model);
      if (window.PSXShader) window.PSXShader.applyToObject(battler.model);
      pivot.add(holder);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      // Frame on the model's ACTUAL bounding box (the per-id sizeMul is already
      // baked into the geometry, so id size variation stays visible). Dividing
      // sizeMul back out here pulled the camera too close for large-id creatures
      // and clipped them against the viewport edges, so fit on maxDim directly
      // and keep a margin large enough that the attack lunge never clips (#100).
      const fitDist = maxDim / (2 * Math.tan((40 * Math.PI / 180) / 2));
      camera.position.set(0, 0, fitDist * 1.4);
      camera.lookAt(0, 0, 0);
      state.model = battler;
      state.attackTimer = 1.2;
    }).catch(() => {});

    // ── Mouse / touch controls (mirror the Bestiary 3D preview) ─────────
    const L = state.listeners;
    L.onDown = (e) => {
      if (e.button === 0 || e.button === 1) {
        state.activeButton = e.button; state.dragging = true;
        state.prev = { x: e.clientX, y: e.clientY };
        if (e.button === 1) e.preventDefault();
        canvas.style.cursor = 'grabbing';
      }
    };
    L.onMove = (e) => {
      if (state.activeButton === -1) return;
      const dx = e.clientX - state.prev.x, dy = e.clientY - state.prev.y;
      if (state.activeButton === 0) {
        pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012;
      } else if (state.activeButton === 1) {
        const ps = 0.0035 * camera.position.z;
        camera.position.x -= dx * ps; camera.position.y += dy * ps;
      }
      state.prev = { x: e.clientX, y: e.clientY };
    };
    L.onUp = () => { state.activeButton = -1; state.dragging = false; canvas.style.cursor = 'grab'; };
    L.onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't let the page's wheel handler also scroll the list
      camera.position.z = Math.max(1.5, Math.min(60, camera.position.z + e.deltaY * 0.012));
    };
    L.onAux = (e) => { if (e.button === 1) e.preventDefault(); };
    L.onCtx = (e) => e.preventDefault();
    L.onTStart = (e) => { if (e.touches.length === 1) { state.dragging = true; state.activeButton = 0; state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } };
    L.onTMove = (e) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - state.prev.x, dy = e.touches[0].clientY - state.prev.y;
        pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012;
        state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    L.onTEnd = () => { state.dragging = false; state.activeButton = -1; };

    canvas.addEventListener('mousedown',   L.onDown);
    canvas.addEventListener('mousemove',   L.onMove);
    window.addEventListener('mouseup',     L.onUp);
    canvas.addEventListener('wheel',       L.onWheel, { passive: false });
    canvas.addEventListener('auxclick',    L.onAux);
    canvas.addEventListener('contextmenu', L.onCtx);
    canvas.addEventListener('touchstart',  L.onTStart);
    canvas.addEventListener('touchmove',   L.onTMove);
    window.addEventListener('touchend',    L.onTEnd);

    const FRAME = 1 / 30;
    const animate = () => {
      if (state.disposed) return;
      state.rafId = requestAnimationFrame(animate);
      state.frameAcc += Math.min(state.clock.getDelta(), 0.05);
      if (state.frameAcc < FRAME) return;
      const dt = state.frameAcc;
      state.frameAcc = 0;
      if (state.model) {
        state.attackTimer -= dt;
        if (state.attackTimer <= 0 && state.model.currentAnimation === 'idle') {
          const anim = (state.model.hasAnimation('specialattack') && Math.random() < 0.4)
            ? 'specialattack' : 'attack';
          try { state.model.playAnimation(anim, false); } catch (e) {}
          state.attackTimer = 2.4 + Math.random() * 1.6;
        }
        try { state.model.update(dt); } catch (e) {}
      }
      if (window.PSXShader) {
        window.PSXShader.render(renderer, scene, camera);
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();
  };

  Scene_CreateCreature.prototype.cleanupCreature3D = function () {
    const s = this._creature3D;
    if (!s) return;
    s.disposed = true;
    cancelAnimationFrame(s.rafId);
    const L = s.listeners || {}, c = s.canvas;
    if (c) {
      c.removeEventListener('mousedown',   L.onDown);
      c.removeEventListener('mousemove',   L.onMove);
      c.removeEventListener('wheel',       L.onWheel);
      c.removeEventListener('auxclick',    L.onAux);
      c.removeEventListener('contextmenu', L.onCtx);
      c.removeEventListener('touchstart',  L.onTStart);
      c.removeEventListener('touchmove',   L.onTMove);
    }
    window.removeEventListener('mouseup',  L.onUp);
    window.removeEventListener('touchend', L.onTEnd);
    // A new WebGLRenderer is built for every model previewed, so the context has
    // to be released here as well: dispose() alone leaves it alive and the
    // browser eventually evicts the OLDEST live context, which is the game's own
    // canvas (it blanks to black).
    try { s.renderer.dispose(); } catch (e) {}
    try { if (s.renderer.forceContextLoss) s.renderer.forceContextLoss(); } catch (e) {}
    this._creature3D = null;
    this._creature3DEnemyId = -1;
  };

  Scene_CreateCreature.prototype._scrollToSelectedCard = function () {
    let boardSelector = null;
    let cardSelector = '.cc-wanted-card';
    let activeIndex = -1;
    if (this._step === 1 || this._step === 2) {
      // The archetype board is the compact grid on the LEFT page and its cards
      // are .cc-card-option, not the poster cards the other steps use.
      boardSelector = '.cc-page-left .cc-select-grid';
      cardSelector = '.cc-card-option';
      activeIndex = this._archetypeWindow.index();
    } else if (this._step === 3) {
      boardSelector = '.cc-page-right .cc-presets-board';
      activeIndex = this._battlerListWindow.index();
    } else if (this._step === 4) {
      boardSelector = '.cc-page-left .cc-presets-board';
      activeIndex = this._characterWindow.index();
    } else {
      return;
    }
    const board = this._dndContainer && this._dndContainer.querySelector(boardSelector);
    if (!board) return;
    const cards = board.querySelectorAll(cardSelector);
    const card = cards[activeIndex];
    if (!card) return;
    const boardRect = board.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.bottom > boardRect.bottom) {
      board.scrollTop += cardRect.bottom - boardRect.bottom + 4;
    } else if (cardRect.top < boardRect.top) {
      board.scrollTop -= boardRect.top - cardRect.top + 4;
    }
  };

  Scene_CreateCreature.prototype.onModeCardClick = function (index) {
    if (this._modeWindow) {
      this._modeWindow.select(index);
      this.refreshUIOverlayDOM();
    }
  };

  Scene_CreateCreature.prototype.onModeCardConfirm = function () {
    if (this._modeWindow) {
      this._modeWindow.processOk();
    }
  };

  Scene_CreateCreature.prototype.onArchetypeCardClick = function (index) {
    if (!this._archetypeWindow) return;
    this._archetypeWindow.select(index);
    const item = this._archetypeWindow._data[index];
    if (item) this._toggleArchetype(item.key);
    this.refreshUIOverlayDOM();
  };

  // Toggle an archetype in/out of the (max two) selection. The first pick is the
  // primary; a second distinct pick is the secondary (making a hybrid). Selecting
  // an already-chosen archetype removes it; picking a third replaces the secondary.
  Scene_CreateCreature.prototype._toggleArchetype = function (key) {
    if (this._selectedArchetype1 === key) {
      this._selectedArchetype1 = this._selectedArchetype2;
      this._selectedArchetype2 = null;
    } else if (this._selectedArchetype2 === key) {
      this._selectedArchetype2 = null;
    } else if (!this._selectedArchetype1) {
      this._selectedArchetype1 = key;
    } else if (!this._selectedArchetype2) {
      this._selectedArchetype2 = key;
    } else {
      this._selectedArchetype2 = key;
    }
  };

  Scene_CreateCreature.prototype.onBattlerCardClick = function (index) {
    if (this._battlerListWindow) {
      this._battlerListWindow.select(index);
      this.refreshUIOverlayDOM();
    }
  };

  Scene_CreateCreature.prototype.onCharacterCardClick = function (index) {
    if (this._characterWindow) {
      this._characterWindow.select(index);
      this.refreshUIOverlayDOM();
    }
  };

  Scene_CreateCreature.prototype._getActiveWindow = function () {
    switch (this._step) {
      case 0: return this._modeWindow;
      case 1:
      case 2: return this._archetypeWindow;
      case 3: return this._battlerListWindow;
      case 4: return this._characterWindow;
      default: return null;
    }
  };

  Scene_CreateCreature.prototype.updateUIInput = function () {
    const windowObj = this._getActiveWindow();
    if (!windowObj || !windowObj.active) return;

    if (Input.isTriggered("ok")) {
      switch (this._step) {
        case 0: SoundManager.playOk(); this.onModeCardConfirm(); return;
        case 1:
        case 2: SoundManager.playOk(); this.onArchetypeOk(); return;
        case 3: SoundManager.playOk(); this.onBattlerOk(); return;
        case 4: SoundManager.playOk(); this.onCharacterOk(); return;
      }
    }

    if (Input.isTriggered("cancel")) {
      switch (this._step) {
        case 0: SoundManager.playCancel(); this.onCreationCancel(); return;
        case 1:
        case 2: SoundManager.playCancel(); this.onArchetypeCancel(); return;
        case 3: SoundManager.playCancel(); this.onBattlerCancel(); return;
        case 4: SoundManager.playCancel(); this.onCharacterCancel(); return;
      }
    }

    const maxItems = windowObj.maxItems();
    if (maxItems <= 0) return;

    const index = windowObj.index();

    // Simulate MZ repeat timing for held WASD keys so hold speed matches arrow keys/controller
    for (const dir of ["up", "down", "left", "right"]) {
      if (this._wasdHeld[dir]) {
        this._wasdHoldFrames[dir]++;
        const t = this._wasdHoldFrames[dir];
        if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
          this._wasdInput[dir] = true;
        }
      } else {
        this._wasdHoldFrames[dir] = 0;
      }
    }

    const isDown  = Input.isTriggered("down")  || Input.isRepeated("down")  || this._wasdInput.down;
    const isUp    = Input.isTriggered("up")    || Input.isRepeated("up")    || this._wasdInput.up;
    const isRight = Input.isTriggered("right") || Input.isRepeated("right") || this._wasdInput.right;
    const isLeft  = Input.isTriggered("left")  || Input.isRepeated("left")  || this._wasdInput.left;

    this._wasdInput.up = false;
    this._wasdInput.down = false;
    this._wasdInput.left = false;
    this._wasdInput.right = false;

    const cols = windowObj.maxCols();
    const singleRow = maxItems <= cols;
    let newIndex = index;

    if (singleRow) {
      if (isRight || isDown) {
        newIndex = (index + 1) % maxItems;
      } else if (isLeft || isUp) {
        newIndex = (index - 1 + maxItems) % maxItems;
      }
    } else {
      if (isDown) {
        newIndex = (index + cols < maxItems) ? index + cols : index % cols;
      } else if (isUp) {
        if (index - cols >= 0) { newIndex = index - cols; }
        else { let t = Math.floor((maxItems - 1) / cols) * cols + (index % cols); if (t >= maxItems) t -= cols; newIndex = t >= 0 ? t : 0; }
      } else if (isRight && index % cols < cols - 1 && index + 1 < maxItems) {
        newIndex = index + 1;
      } else if (isLeft && index % cols > 0) {
        newIndex = index - 1;
      }
    }

    if (newIndex !== index) {
      SoundManager.playCursor();
      windowObj.select(newIndex);
      this.refreshUIOverlayDOM();
    }
  };

  // CCScroll hook: the board holding this step's cards, so the triggers (and a
  // wheel notch that lands off the board) always scroll the active list.
  Scene_CreateCreature.prototype.ccScrollTarget = function () {
    if (!this._dndContainer) return null;
    let selector = null;
    if (this._step === 1 || this._step === 2) {
      selector = '.cc-page-left .cc-select-grid'; // archetype cards use the compact grid
    } else if (this._step === 3) {
      selector = '.cc-page-right .cc-presets-board'; // battler cards are on the right
    } else if (this._step === 4) {
      selector = '.cc-page-left .cc-presets-board';  // sprite cards are on the left
    }
    return selector ? this._dndContainer.querySelector(selector) : null;
  };

  Scene_CreateCreature.prototype.update = function () {
    Scene_MenuBase.prototype.update.call(this);

    if (this._dndContainer && this._dndContainer.style.display !== "none") {
      this.updateUIInput();
      if (window.CCScroll) window.CCScroll.update(this._dndContainer);

      const isMode = this._step === 0;
      const isArch1 = this._step === 1;
      const isArch2 = this._step === 2;
      const isBattler = this._step === 3;
      const isChar = this._step === 4;

      const currentIndex = isMode ? this._modeWindow.index() :
        isArch1 || isArch2 ? this._archetypeWindow.index() :
          isBattler ? this._battlerListWindow.index() :
            this._characterWindow.index();

      if (this._lastStep !== this._step || this._lastIndex !== currentIndex) {
        this._lastStep = this._step;
        this._lastIndex = currentIndex;
        this.refreshUIOverlayDOM();
      }
    }
  };

  // --- Window Creation ---

  Scene_CreateCreature.prototype.createHelpWindow = function () {
    const rect = this.helpWindowRect();
    this._helpWindow = new Window_Help(rect);
    this._helpWindow.visible = false;
    this._helpWindow.opacity = 0;
    this.addWindow(this._helpWindow);
  };

  Scene_CreateCreature.prototype.createModeWindow = function () {
    const rect = this.modeWindowRect();
    this._modeWindow = new Window_CreateCreatureMode(rect);
    this._modeWindow.setHandler('baseline', this.onModeSelect.bind(this, 'baseline'));
    this._modeWindow.setHandler('hybrid', this.onModeSelect.bind(this, 'hybrid'));
    this._modeWindow.setHandler('cancel', this.onCreationCancel.bind(this));
    this._modeWindow.visible = false;
    this._modeWindow.opacity = 0;
    this.addWindow(this._modeWindow);
  };

  Scene_CreateCreature.prototype.createArchetypeWindow = function () {
    const rect = this.archetypeListRect();
    this._archetypeWindow = new Window_ArchetypeSelect(rect);
    this._archetypeWindow.setHandler('ok', this.onArchetypeOk.bind(this));
    this._archetypeWindow.setHandler('cancel', this.onArchetypeCancel.bind(this));
    this._archetypeWindow.setHandler('select', this.onArchetypeSelect.bind(this));
    this._archetypeWindow.visible = false;
    this._archetypeWindow.opacity = 0;
    this.addWindow(this._archetypeWindow);
  };

  Scene_CreateCreature.prototype.createArchetypePartsWindow = function () {
    const rect = this.archetypePartsRect();
    this._archetypePartsWindow = new Window_ArchetypeParts(rect);
    this._archetypePartsWindow.visible = false;
    this._archetypePartsWindow.opacity = 0;
    this.addWindow(this._archetypePartsWindow);
  };

  Scene_CreateCreature.prototype.createBattlerWindow = function () {
    const listRect = this.battlerListRect();
    this._battlerListWindow = new Window_BattlerList(listRect);
    this._battlerListWindow.setHandler('ok', this.onBattlerOk.bind(this));
    this._battlerListWindow.setHandler('cancel', this.onBattlerCancel.bind(this));
    this._battlerListWindow.setHandler('select', this.onBattlerSelect.bind(this));
    this._battlerListWindow.visible = false;
    this._battlerListWindow.opacity = 0;
    this.addWindow(this._battlerListWindow);

    const previewRect = this.battlerPreviewRect();
    this._battlerPreviewWindow = new Window_BattlerPreview(previewRect);
    this._battlerPreviewWindow.visible = false;
    this._battlerPreviewWindow.opacity = 0;
    this.addWindow(this._battlerPreviewWindow);
  };

  Scene_CreateCreature.prototype.createCharacterWindow = function () {
    const rect = this.fullMainWindowRect();
    this._characterWindow = new Window_CharacterSelect(rect);
    this._characterWindow.setHandler('ok', this.onCharacterOk.bind(this));
    this._characterWindow.setHandler('cancel', this.onCharacterCancel.bind(this));
    this._characterWindow.visible = false;
    this._characterWindow.opacity = 0;
    this.addWindow(this._characterWindow);
  };

  // --- Window Rects ---

  Scene_CreateCreature.prototype.helpWindowRect = function () {
    const ww = Graphics.boxWidth;
    const wh = this.calcWindowHeight(2, false);
    return new Rectangle(0, 0, ww, wh);
  };

  Scene_CreateCreature.prototype.modeWindowRect = function () {
    const ww = 240;
    const wh = this.calcWindowHeight(2, true);
    const wx = (Graphics.boxWidth - ww) / 2;
    const wy = (Graphics.boxHeight - wh) / 2;
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_CreateCreature.prototype.mainRectY = function () {
    return this._helpWindow ? (this._helpWindow.y + this._helpWindow.height) : 0;
  };

  Scene_CreateCreature.prototype.mainRectHeight = function () {
    return Graphics.boxHeight - this.mainRectY();
  };

  Scene_CreateCreature.prototype.archetypeListRect = function () {
    const wy = this.mainRectY();
    const wh = this.mainRectHeight();
    const ww = Math.floor(Graphics.boxWidth * 0.5);
    return new Rectangle(0, wy, ww, wh);
  };

  Scene_CreateCreature.prototype.archetypePartsRect = function () {
    const wy = this.mainRectY();
    const wh = this.mainRectHeight();
    const ww = Graphics.boxWidth - Math.floor(Graphics.boxWidth * 0.5);
    const wx = Graphics.boxWidth - ww;
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_CreateCreature.prototype.fullMainWindowRect = function () {
    const wy = this.mainRectY();
    const wh = this.mainRectHeight();
    return new Rectangle(0, wy, Graphics.boxWidth, wh);
  };

  Scene_CreateCreature.prototype.battlerListRect = function () {
    const wy = this.mainRectY();
    const wh = this.mainRectHeight();
    const ww = Math.floor(Graphics.boxWidth * 0.3);
    return new Rectangle(0, wy, ww, wh);
  };

  Scene_CreateCreature.prototype.battlerPreviewRect = function () {
    const wy = this.mainRectY();
    const wh = this.mainRectHeight();
    const ww = Graphics.boxWidth - Math.floor(Graphics.boxWidth * 0.3);
    const wx = Graphics.boxWidth - ww;
    return new Rectangle(wx, wy, ww, wh);
  };

  // --- Step Management ---

  Scene_CreateCreature.prototype.showStep = function (step) {
    this._step = step;
    this._wasdInput = { up: false, down: false, left: false, right: false };
    this._wasdHeld = { up: false, down: false, left: false, right: false };
    this._wasdHoldFrames = { up: 0, down: 0, left: 0, right: 0 };

    // Hide all windows
    this._modeWindow.hide();
    this._modeWindow.deactivate();

    this._archetypeWindow.hide();
    this._archetypeWindow.deactivate();

    this._archetypePartsWindow.hide();

    this._battlerListWindow.hide();
    this._battlerListWindow.deactivate();
    this._battlerPreviewWindow.hide();

    this._characterWindow.hide();
    this._characterWindow.deactivate();

    switch (step) {
      case 0: // Mode Select
        this._helpWindow.setText(T('Creature.selectCreationMode'));
        this._modeWindow.show();
        this._modeWindow.activate();
        this._modeWindow.select(0);
        break;
      case 1: // Archetype(s) - single screen: pick one (baseline) or two (hybrid)
        this._mode = 'hybrid'; // multi-select while on this screen; resolved at confirm
        this._helpWindow.setText(T('Creature.selectOneOrTwoArchetypes'));
        this._selectedArchetype1 = null;
        this._selectedArchetype2 = null;
        this._archetypeWindow.show();
        this._archetypeWindow.activate();
        this._archetypeWindow.select(0);
        this._archetypePartsWindow.setArchetypes(null, null);
        this._archetypePartsWindow.show();
        this.onArchetypeSelect(); // Update parts list for first item
        break;
      case 2: // Archetype 2 (Hybrid only)
        this._helpWindow.setText(T('Creature.selectHybridArchetype'));
        this._archetypeWindow.show();
        this._archetypeWindow.activate();
        this._archetypeWindow.select(0);
        this._archetypePartsWindow.setArchetypes(this._selectedArchetype1, null);
        this._archetypePartsWindow.show();
        this.onArchetypeSelect(); // Update parts list for first item
        break;
      case 3: // Battler
        this._helpWindow.setText(T('Creature.selectABattlerImage'));
        const archsForBattlers = [this._selectedArchetype1];
        if (this._mode === 'hybrid' && this._selectedArchetype2) {
          archsForBattlers.push(this._selectedArchetype2);
        }
        this._battlerListWindow.setArchetypes(archsForBattlers);
        this._battlerListWindow.show();
        this._battlerListWindow.activate();
        this._battlerPreviewWindow.show();
        this._battlerListWindow.select(0);
        this.onBattlerSelect(); // Update preview for first item
        break;
      case 4: // Character
        this._helpWindow.setText(T('Creature.selectACharacterSprite'));
        const archetypes = [this._selectedArchetype1];
        if (this._mode === 'hybrid' && this._selectedArchetype2) {
          archetypes.push(this._selectedArchetype2);
        }
        this._characterWindow.setArchetypes(archetypes);
        this._characterWindow.show();
        this._characterWindow.activate();
        this._characterWindow.select(0);
        break;
    }
  };

  // --- Event Handlers ---

  Scene_CreateCreature.prototype.onModeSelect = function (mode) {
    this._mode = mode;
    this.showStep(1); // Go to Archetype 1 selection
  };

  Scene_CreateCreature.prototype.onArchetypeSelect = function () {
    const item = this._archetypeWindow.item();
    if (!item) return;

    const currentKey = item.key;
    if (this._step === 1) {
      this._archetypePartsWindow.setArchetypes(currentKey, null);
    } else if (this._step === 2) {
      this._archetypePartsWindow.setArchetypes(this._selectedArchetype1, currentKey);
    }
  };

  Scene_CreateCreature.prototype.onArchetypeOk = function () {
    const item = this._archetypeWindow.item();
    if (!item) return;
    const key = item.key;
    // Enter on an already-selected archetype confirms the blueprint (one pick =
    // baseline creature, two picks = hybrid). Enter on any other archetype adds
    // it to the selection.
    if (this._selectedArchetype1 === key || this._selectedArchetype2 === key) {
      this.onArchetypeConfirm();
      return;
    }
    this._toggleArchetype(key);
    // processOk() deactivates the window; re-activate so navigation continues.
    this._archetypeWindow.activate();
    this.refreshUIOverlayDOM();
  };

  Scene_CreateCreature.prototype.onArchetypeConfirm = function () {
    if (!this._selectedArchetype1) return; // need at least one archetype
    // Resolve the final creation mode from how many archetypes were chosen.
    this._mode = this._selectedArchetype2 ? 'hybrid' : 'baseline';
    this.showStep(3); // proceed to battler, then sprite
  };

  Scene_CreateCreature.prototype.onArchetypeCancel = function () {
    // The archetype screen is now the first step, so Back aborts creature creation.
    this.onCreationCancel();
  };

  Scene_CreateCreature.prototype.onBattlerSelect = function () {
    const item = this._battlerListWindow.item();
    const battlerName = item ? item.battlerName : null;
    if (this._battlerPreviewWindow) {
      this._battlerPreviewWindow.setBattler(battlerName);
    }
  };

  // Collect up to three distinct Battler3D archetype keys from the enemies
  // listed for the chosen creature archetype(s), used to seed the custom model.
  Scene_CreateCreature.prototype._collectBattler3DKeys = function () {
    const keys = [];
    if (!window.Battler3D || !window.Battler3D.resolveKey || !this._battlerListWindow) return keys;
    for (const it of this._battlerListWindow._data) {
      if (!it || it.custom || !it.id) continue;
      const enemy = $dataEnemies[it.id];
      const k = enemy ? window.Battler3D.resolveKey(enemy) : null;
      if (k && keys.indexOf(k) === -1) keys.push(k);
      if (keys.length >= 3) break;
    }
    return keys;
  };

  Scene_CreateCreature.prototype.onBattlerOk = function () {
    const item = this._battlerListWindow.item();
    // Custom 3D creature: open the model editor IMMEDIATELY (seeded from the
    // chosen archetypes). The editor is pushed over this scene; on confirm it
    // pops back and we resume at the sprite step (see create()).
    if (item && item.custom) {
      this._customModel = true;
      this._selectedBattler = null;
      // A creature is portrayed EITHER by a 2D battler image OR by a 3D model.
      // Recording the pick on the actor keeps the two from competing later.
      const customActor = $gameActors.actor(this._targetActorId);
      if (customActor && customActor.setPortraitMode) customActor.setPortraitMode("model");
      const keys = this._collectBattler3DKeys();
      this._customArchetypeKeys = keys;
      if (window.Scene_CC3DModel && window.CC3DModel && window.CC3DModel.isAvailable()) {
        Scene_CreateCreature._resumeCreature = {
          targetActorId: this._targetActorId,
          arch1: this._selectedArchetype1,
          arch2: this._selectedArchetype2,
          mode: this._mode,
          keys: keys
        };
        window.Scene_CC3DModel.setup(this._targetActorId, null, { creature: true, initArchetypes: keys });
        SceneManager.push(window.Scene_CC3DModel);
        return;
      }
      // 3D editor unavailable: fall back to picking a sprite directly.
      this.showStep(4);
      return;
    }
    const battlerName = item ? item.battlerName : null;
    if (battlerName) {
      this._customModel = false;
      this._selectedBattler = battlerName;
      // Save the battler image name on the actor (portrait fields moved off the
      // old global variables) and mark this creature as 2D-portrayed, so no 3D
      // model is built for it.
      const battlerActor = $gameActors.actor(this._targetActorId);
      if (battlerActor) {
        battlerActor.setVnBattler(battlerName);
        if (battlerActor.setPortraitMode) battlerActor.setPortraitMode("sprite");
      }
      // Keep the randomized 3D look previewed for this creature: the status
      // screen rebuilds the model with this same seed.
      if (this._creatureGenSeed && window.CC3DModel && window.CC3DModel.setCreatureSeed) {
        window.CC3DModel.setCreatureSeed(this._targetActorId, this._creatureGenSeed);
      }
      this.showStep(4); // Go to Character
    }
  };

  Scene_CreateCreature.prototype.onBattlerCancel = function () {
    this.showStep(1); // Back to Archetype selection screen
  };

  Scene_CreateCreature.prototype.onCharacterOk = function () {
    const entry = this._characterWindow.item();
    if (entry) {
      this._selectedCharacter = entry;
      // Custom creature: the 3D model was already built and saved (config lives
      // in CC3DModel), so clear the 2D battler image and the status screen
      // renders the custom model instead of a flat enemy portrait.
      if (this._customModel) {
        const modelActor = $gameActors.actor(this._targetActorId);
        if (modelActor) modelActor.setVnBattler("");
      }
      this.applyCreatureSettings();
      if (this.startNameInput()) return;
      if (this.startClassSelection()) return;
      this.popScene();
    }
  };

  // Pre-fill the name field with a generated name, the way the humanoid branch
  // does with its Markov step, so the player edits a suggestion instead of the
  // database placeholder. The current name is kept when no generator is loaded.
  function suggestCreatureName(actor) {
    if (!window.generateSeededMarkovName) return;
    const actorId = actor.actorId();
    const seed = (Date.now() + actorId * 7919) >>> 0;
    try {
      const name = window.generateSeededMarkovName(
        seed & 0xffff,
        (seed >>> 16) & 0xffff,
        actorId,
        "names", // i18n-ignore: TextGen database id
        2,
        4,
        12
      );
      if (name && name !== T('Markov.unknownName')) {
        actor.setName(name.charAt(0).toUpperCase() + name.slice(1));
      }
    } catch (e) {
      // Generator unavailable: the creature keeps the name it already has.
    }
  }

  // The humanoid branch of the wizard is named by common event 97 (a generated
  // suggestion, then the name input screen) between gender and class; creatures
  // never run that event, so the name is asked for here instead, once the
  // creature is built and before its class is picked.
  //
  // Only the wizard flow names anything: a creature built from the
  // CreateCreature plugin command is an existing character changing shape, and
  // keeps the name it already has.
  Scene_CreateCreature.prototype.startNameInput = function () {
    const wizard = window.Scene_CharacterCreation;
    if (!wizard || wizard._interruptedStep < 0) return false;
    if (typeof Scene_Name === "undefined") return false;
    const stack = SceneManager._stack;
    if (!stack) return false;
    const actor = $gameActors.actor(this._targetActorId);
    if (!actor) return false;

    // The naming screen returns to exactly where this scene would have gone
    // without it: the class selector when the wizard routes there, otherwise
    // the scene that opened the builder.
    let returnScene;
    if (this.prepareClassSelection()) {
      returnScene = window.Scene_ClassSelection;
    } else if (stack.length) {
      returnScene = stack.pop();
    } else {
      return false;
    }

    suggestCreatureName(actor);
    SceneManager.goto(Scene_Name);
    // NameInsert forces its own 16-character limit; the argument is the engine
    // default the name input screen would otherwise use.
    SceneManager.prepareNextScene(this._targetActorId, 16);
    stack.push(returnScene);
    return true;
  };

  // The creature is built: hand over to the class selector, scoped to the
  // classes its archetype(s) support. Unlike the humanoid flow there is no
  // archetype-of-classes step , the creature's own archetypes already decided
  // the roster, so the player goes straight into the class list (which is the
  // Monster class alone when the two archetypes support nothing in common).
  //
  // Only the wizard flow routes here: a creature built from the CreateCreature
  // plugin command (no paused wizard) keeps popping back where it came from.
  Scene_CreateCreature.prototype.startClassSelection = function () {
    if (!this.prepareClassSelection()) return false;
    SceneManager.goto(window.Scene_ClassSelection);
    return true;
  };

  // Everything startClassSelection does except the scene change itself, so the
  // name step can set the hand-over up and let the naming screen return into
  // the class selector.
  Scene_CreateCreature.prototype.prepareClassSelection = function () {
    const wizard = window.Scene_CharacterCreation;
    if (!wizard || wizard._interruptedStep < 0) return false;
    if (!window.Scene_ClassSelection || !window.CreatureClasses) return false;

    const classIds = window.CreatureClasses.forArchetypes(
      this._selectedArchetype1,
      this._selectedArchetype2
    );
    window.$ccArchetypeClassFilter = classIds;
    window.$ccCreatureClassFlow = {
      actorId: this._targetActorId,
      arch1: this._selectedArchetype1,
      arch2: this._selectedArchetype2,
    };
    // The class selector resumes the wizard itself (traits on confirm, this
    // scene on cancel), so drop the pending resume point.
    wizard._interruptedStep = -1;
    // The wizard pushed this scene, leaving itself on the scene stack for a
    // popScene() that is no longer coming. Drop that entry, or the wizard would
    // restart when it pops itself at the end of creation.
    const stack = SceneManager._stack;
    if (stack && stack.length && stack[stack.length - 1] === wizard) {
      stack.pop();
    }
    return true;
  };

  Scene_CreateCreature.prototype.onCharacterCancel = function () {
    this.showStep(3); // Back to Battler
  };

  // Cancelling out of the very first creature screen (mode select) aborts
  // creature creation. The wizard's gender handler pre-set the resume point to
  // the post-class step (so a completed creature lands on traits); on cancel we
  // override it to resume at the gender step (3) instead, so Back returns to an
  // interactive step rather than falling through to traits with a half-built
  // creature.
  Scene_CreateCreature.prototype.onCreationCancel = function () {
    if (window.Scene_CharacterCreation) {
      // interruptedStep + 1 is the resume step, so CHARACTER_TYPE resumes on
      // the gender step.
      window.Scene_CharacterCreation._interruptedStep =
        (window.CCSteps && window.CCSteps.CHARACTER_TYPE) != null
          ? window.CCSteps.CHARACTER_TYPE
          : 3;
    }
    this.popScene();
  };

  // --- Logic Functions ---

  Scene_CreateCreature.prototype.applyCreatureSettings = function () {
    const actor = $gameActors.actor(this._targetActorId);
    if (!actor) return;

    actor._isCreatureActor = true;

    // Use the changeArchetype function from Health_Core if available
    const changeArchetype = window.changeArchetypeForActor || this.changeArchetypeLocal.bind(this);

    // Apply Archetype(s)
    if (this._mode === 'baseline' && this._selectedArchetype1) {
      changeArchetype(actor, this._selectedArchetype1);
    } else if (this._mode === 'hybrid' && this._selectedArchetype1 && this._selectedArchetype2) {
      this.applyHybridArchetype(actor);
    }

    // Set character sprite
    if (this._selectedCharacter) {
      actor.setCharacterImage(this._selectedCharacter.path, this._selectedCharacter.index);
    }

    console.log(`Creature created for Actor ${this._targetActorId}:`);
    console.log('  Mode:', this._mode);
    console.log('  Archetype 1:', this._selectedArchetype1);
    console.log('  Archetype 2:', this._selectedArchetype2);
    console.log('  Battler:', this._selectedBattler, `(saved on actor ${this._targetActorId})`);
    console.log('  Character:', this._selectedCharacter?.path, 'index', this._selectedCharacter?.index);
  };

  // Local implementation of changeArchetype for standalone use
  Scene_CreateCreature.prototype.changeArchetypeLocal = function (actor, archetypeName) {
    if (!actor) return false;

    const { EnemyArchetypes } = window.Health || {};

    if (!EnemyArchetypes || !EnemyArchetypes[archetypeName]) {
      console.warn(`Archetype "${archetypeName}" not found in EnemyArchetypes`);
      return false;
    }

    const archetype = EnemyArchetypes[archetypeName];

    // Clear existing stat modifiers
    if (actor._statModifiers) {
      for (const param in actor._statModifiers) {
        actor._statModifiers[param] = 0;
      }
    } else {
      actor._statModifiers = {};
    }

    // Initialize new body parts from archetype
    actor._bodyParts = {};
    actor._currentArchetype = archetypeName;

    for (const partKey in archetype.parts) {
      const archetypePart = archetype.parts[partKey];
      const hpPercentage = archetypePart.hpPercent / 100;

      actor._bodyParts[partKey] = {
        name: window.getArchetypeText ? window.getArchetypeText(archetypePart.name) : archetypePart.name,
        maxHp: Math.round(actor.mhp * hpPercentage),
        currentHp: Math.round(actor.mhp * hpPercentage),
        vital: false,
        damaged: false,
        canCutoff: archetypePart.canCutoff || false,
        statEffect: archetypePart.statEffect || null,
        damageMsg: window.getArchetypeText ? window.getArchetypeText(archetypePart.msg) : archetypePart.msg,
        specialEffect: archetypePart.specialEffect || null,
        appliedStatEffect: false,
        skillId: archetypePart.skillId || [],
      };
    }

    // Learn skills from part skillIds (supports a single id or an array of ids)
    // plus any type-based body-part skills (Mouth/Hands/Eyes/Feet).
    const _hc = window.HealthCore;
    for (const partKey in actor._bodyParts) {
      const part = actor._bodyParts[partKey];
      const ids = _hc && _hc.getPartSkillIds
        ? _hc.getPartSkillIds(part, partKey)
        : (part && part.skillId ? [].concat(part.skillId) : []);
      for (const skillId of ids) {
        if (skillId && $dataSkills[skillId]) actor.learnSkill(skillId);
      }
    }

    // Set reproduction variable based on actor ID
    if ($gameVariables) {
      var reproductionValue = archetype.reproduction !== undefined ? archetype.reproduction : 0;
      var actorId = actor.actorId();
      if (actorId === 1) {
        $gameVariables.setValue(87, reproductionValue);
      } else if (actorId === 2) {
        $gameVariables.setValue(115, reproductionValue);
      } else if (actorId === 3) {
        $gameVariables.setValue(116, reproductionValue);
      }
    }

    // Clear all learned skills and add archetype's base skills
    if (archetype.skills && archetype.skills.length > 0) {
      const currentSkills = actor.skills().slice();
      currentSkills.forEach(skillId => {
        actor.forgetSkill(skillId.id);
      });

      archetype.skills.forEach(skillId => {
        if ($dataSkills[skillId]) {
          actor.learnSkill(skillId);
        }
      });

      // Re-learn body-part skills wiped by the clear above (mirrors the hybrid path).
      for (const partKey in actor._bodyParts) {
        const part = actor._bodyParts[partKey];
        const ids = _hc && _hc.getPartSkillIds
          ? _hc.getPartSkillIds(part, partKey)
          : (part && part.skillId ? [].concat(part.skillId) : []);
        for (const skillId of ids) {
          if (skillId && $dataSkills[skillId]) actor.learnSkill(skillId);
        }
      }
    }

    // Refresh actor parameters
    actor.refresh();

    return true;
  };

  Scene_CreateCreature.prototype.applyHybridArchetype = function (actor) {
    const { EnemyArchetypes } = window.Health || {};
    const arch1 = EnemyArchetypes[this._selectedArchetype1];
    const arch2 = EnemyArchetypes[this._selectedArchetype2];
    if (!arch1 || !arch2) return;

    const mergedParts = {};

    // Add parts from Arch 1
    for (const partKey in arch1.parts) {
      mergedParts[partKey] = arch1.parts[partKey];
    }
    // Add/overwrite parts from Arch 2
    for (const partKey in arch2.parts) {
      mergedParts[partKey] = arch2.parts[partKey];
    }

    // Clear existing actor data
    actor._statModifiers = {};
    actor._bodyParts = {};
    actor._currentArchetype = `${this._selectedArchetype1} / ${this._selectedArchetype2}`;

    // Apply new merged parts to actor
    for (const partKey in mergedParts) {
      const archetypePart = mergedParts[partKey];
      const hpPercentage = archetypePart.hpPercent / 100;

      actor._bodyParts[partKey] = {
        name: window.getArchetypeText ? window.getArchetypeText(archetypePart.name) : archetypePart.name,
        maxHp: Math.round(actor.mhp * hpPercentage),
        currentHp: Math.round(actor.mhp * hpPercentage),
        vital: false,
        damaged: false,
        canCutoff: archetypePart.canCutoff || false,
        statEffect: archetypePart.statEffect || null,
        damageMsg: window.getArchetypeText ? window.getArchetypeText(archetypePart.msg) : archetypePart.msg,
        specialEffect: archetypePart.specialEffect || null,
        appliedStatEffect: false,
        skillId: archetypePart.skillId || [],
      };
    }

    // Learn skills from part skillIds (merged parts, arch2 overrides arch1 for same key)
    for (const partKey in mergedParts) {
      const ids = window.HealthCore && window.HealthCore.getPartSkillIds
        ? window.HealthCore.getPartSkillIds(mergedParts[partKey], partKey)
        : [].concat(mergedParts[partKey].skillId || []);
      for (const sid of ids) {
        if (sid && $dataSkills[sid]) actor.learnSkill(sid);
      }
    }

    // Clear all learned skills and add base skills from BOTH archetypes (unique union)
    const currentSkills = actor.skills().slice();
    currentSkills.forEach(skill => {
      actor.forgetSkill(skill.id);
    });
    const mergedSkillIds = new Set();
    if (arch1.skills) arch1.skills.forEach(sid => mergedSkillIds.add(sid));
    if (arch2.skills) arch2.skills.forEach(sid => mergedSkillIds.add(sid));
    mergedSkillIds.forEach(skillId => {
      if ($dataSkills[skillId]) {
        actor.learnSkill(skillId);
      }
    });

    // Re-learn part skills (they may overlap with base skills, which is fine)
    for (const partKey in mergedParts) {
      const ids = window.HealthCore && window.HealthCore.getPartSkillIds
        ? window.HealthCore.getPartSkillIds(mergedParts[partKey], partKey)
        : [].concat(mergedParts[partKey].skillId || []);
      for (const sid of ids) {
        if (sid && $dataSkills[sid]) actor.learnSkill(sid);
      }
    }

    // Use Arch 2 (dominant) for reproduction
    const dominantArchetype = arch2;

    // Set reproduction variable based on actor ID
    if ($gameVariables) {
      var reproductionValue = dominantArchetype.reproduction !== undefined ? dominantArchetype.reproduction : 0;
      var actorId = actor.actorId();
      if (actorId === 1) {
        $gameVariables.setValue(87, reproductionValue);
      } else if (actorId === 2) {
        $gameVariables.setValue(115, reproductionValue);
      } else if (actorId === 3) {
        $gameVariables.setValue(116, reproductionValue);
      }
    }

    // Refresh actor parameters
    actor.refresh();
  };

  // Expose Scene_CreateCreature globally
  window.Scene_CreateCreature = Scene_CreateCreature;

  // Standalone creature application, reused by the Quick-mode inline creature
  // picker in CharacterCreation.js. Builds a Scene_CreateCreature-shaped context
  // so all the existing archetype/hybrid logic (body parts, skills, reproduction,
  // sprite) runs without opening the full creature scene.
  //   mode: 'baseline' | 'hybrid'
  //   characterEntry: { path, index } overworld sprite, or null
  //   battlerName: battler image name stored on the actor, or null
  window.applyCreatureSelection = function (actorId, mode, arch1Key, arch2Key, characterEntry, battlerName) {
    if (typeof Scene_CreateCreature === 'undefined') return null;
    const ctx = Object.create(Scene_CreateCreature.prototype);
    ctx._targetActorId = actorId;
    ctx._mode = mode;
    ctx._selectedArchetype1 = arch1Key;
    ctx._selectedArchetype2 = arch2Key || null;
    ctx._selectedBattler = battlerName || null;
    ctx._selectedCharacter = characterEntry || null;
    const targetActor = $gameActors.actor(actorId);
    if (battlerName && targetActor) {
      targetActor.setVnBattler(battlerName);
      // Inline picker creatures are portrayed by their 2D battler image.
      if (targetActor.setPortraitMode) targetActor.setPortraitMode("sprite");
    }
    ctx.applyCreatureSettings();
    return ctx;
  };

  // ============================================================================
  // Weapon equip override for creature actors
  // Allows equipping weapons only when the archetype has a compatible limb part.
  // Human actors are unaffected (no _isCreatureActor flag).
  // ============================================================================
  const CREATURE_WEAPON_PARTS = new Set(['LEFT_HAND', 'RIGHT_HAND', 'MOUTH', 'RIGHT_FOOT', 'LEFT_FOOT']);

  const _Game_Actor_equipSlots = Game_Actor.prototype.equipSlots;
  Game_Actor.prototype.equipSlots = function () {
    const base = _Game_Actor_equipSlots.call(this);
    if (!this._isCreatureActor || !this._bodyParts) return base;

    const weaponPartCount = Object.keys(this._bodyParts).filter(k => CREATURE_WEAPON_PARTS.has(k)).length;
    const nonWeaponSlots = base.filter(s => s !== 1); // strip class-defined weapon slots
    if (weaponPartCount >= 2) {
      return [1, 1, ...nonWeaponSlots]; // dual wield
    } else if (weaponPartCount === 1) {
      return [1, ...nonWeaponSlots];
    }
    return nonWeaponSlots; // no compatible limb → no weapons
  };

  console.log(`${pluginName} loaded successfully.`);
})();
