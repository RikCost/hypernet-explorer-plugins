(() => {

  // A severed-magic world has no magic in it, so a magic meter is a bar that
  // can only ever be full and can never be spent: it is not drawn at all.
  // Read live rather than cached , the answer belongs to the world, and one
  // session can open a different one. See window.MagicNature.
  function hideMpBar() {
    const MN = window.MagicNature;
    return !!(MN && typeof MN.level === "function" && MN.level() === "severed");
  }

  "use strict";
  const pluginName = "BattleSystemEnhancedHUD";
  const parameters = PluginManager.parameters(pluginName);
  const barWidth = 600;
  const enemyLargeBarWidth = 620;
  const barHeight = Number(parameters["BarHeight"] || 25);
  const barSpacing = 70;
  const playerBarX = Number(parameters["PlayerBarX"] || 60);
  const enemyBarX = Number(470);
  const barsY = Number(parameters["BarsY"] || 20);
  const playerHPColor1 = String(parameters["PlayerHPColor1"] || "#ff4444");
  const playerHPColor2 = String(parameters["PlayerHPColor2"] || "#ff0000");
  const enemyHPColor1 = String(parameters["EnemyHPColor1"] || "#ff4444");
  const enemyHPColor2 = String(parameters["EnemyHPColor2"] || "#ff0000");
  const mpBarColor1 = String(parameters["MPBarColor1"] || "#44aaff");
  const mpBarColor2 = String(parameters["MPBarColor2"] || "#0066cc");
  const tpColor1 = String(parameters["TPColor1"] || "#ffcc00");
  const tpColor2 = String(parameters["TPColor2"] || "#ff9900");
  const damageColor = String(parameters["DamageColor"] || "#ffffff");
  const mpSkillColor = String(parameters["MPSkillColor"] || "#44aaff");
  const tpSkillColor = String(parameters["TPSkillColor"] || "#ff9900");
  const animationSpeed = Number(parameters["AnimationSpeed"] || 5);
  const gradientSpeed = Number(parameters["GradientSpeed"] || 1);
  const tpOrbSize = Number(parameters["TPOrbSize"] || 56);
  const tpOrbOffsetX = Number(-40);
  const enemyTpOrbOffsetX = Number(315);
  const angleSize = Number(parameters["AngleSize"] || 15);
  const borderThickness = Number(parameters["BorderThickness"] || 2);
  const borderColor = String(parameters["BorderColor"] || "#000000");
  // Stat change display parameters
  const statDisplayOffsetY = 100; // Offset below MP bar
  const statTextColor = "#FFCC00"; // Yellow text for stat changes
  const statDisplayHeight = 18; // Increased height for stat display
  const DAMAGE_FLASH_DURATION = 20; // frames the actor sprite tints red + shakes on a hit

  // Compact enemy bars. A lone monster keeps the large top-right bar with its
  // weaknesses and severed parts; the moment a second one joins the fight every
  // enemy drops to a small party-styled bar, and those are stacked in a column
  // in the SAME top-right corner the single bar occupies. They used to be drawn
  // under each monster's own feet, which put text over the creatures, moved with
  // every lunge and stagger, and left the troop unreadable the moment two of
  // them stood close together.
  const miniBarWidth = 260;
  const miniBarBitmapHeight = 78;
  const miniBarRightMargin = 40; // matches the large single-enemy bar's margin
  const miniBarColumnTop = 35; // top edge of the highest compact bar
  const miniBarStackStep = 70; // vertical distance between stacked bars
  const miniBarColumnBottom = 24; // air kept under the lowest bar
  const MINI = {
    padX: 8,
    ang: 8, // skew of the angled bar, matching the party cards
    thickness: 8,
    nameH: 18,
    hpY: 19,
  };
  MINI.mpY = MINI.hpY + MINI.thickness + 3;
  MINI.chipY = MINI.mpY + MINI.thickness + 5;

  function miniBarGeometry(width) {
    const x = MINI.padX + MINI.ang;
    return { x, w: Math.max(20, width - x - MINI.padX) };
  }

  // Compact bars belong to the ordinary battle scene: a tactical map battle
  // (MapBattleMode) builds its own bar layout on Scene_Map, where the monsters
  // are map events rather than battler sprites to sit under.
  function multipleEnemiesInBattle() {
    if (!$gameTroop || $gameTroop.members().length <= 1) return false;
    return SceneManager._scene instanceof Scene_Battle;
  }

  let _footPosScratch = null;

  // Where a battler stands on screen, in scene coordinates. In a 3D battle the
  // 2D sprite is hidden and keeps its untouched layout slot, so the model itself
  // is asked for its position (its root sits at the creature's feet); otherwise
  // the battler sprite answers, offset by the battle field it lives in.
  function battlerFootPosition(battler) {
    const scene = SceneManager._scene;
    const spriteset = scene && scene._spriteset;
    if (!battler || !spriteset) return null;

    const scene3d = spriteset._battle3DScene;
    if (
      scene3d &&
      scene3d.camera &&
      typeof THREE !== "undefined" &&
      typeof spriteset.get3DModel === "function" &&
      (typeof scene3d.hasModels !== "function" || scene3d.hasModels())
    ) {
      const model = spriteset.get3DModel(battler);
      const root = model && model.model;
      if (root) {
        const v = _footPosScratch || (_footPosScratch = new THREE.Vector3());
        root.getWorldPosition(v);
        v.project(scene3d.camera);
        if (isFinite(v.x) && isFinite(v.y) && v.z <= 1) {
          return {
            x: (v.x * 0.5 + 0.5) * Graphics.width,
            y: (-v.y * 0.5 + 0.5) * Graphics.height,
          };
        }
      }
    }

    const sprites = spriteset._enemySprites || [];
    const sprite = sprites.find((s) => s && s._battler === battler);
    if (!sprite) return null;
    const field = spriteset._battleField;
    return {
      x: sprite.x + (field ? field.x : 0),
      y: sprite.y + (field ? field.y : 0),
    };
  }

  // The same reading taken over the creature's head instead of under its feet,
  // for the target chevron. A 3D model is measured (the top of the box it
  // actually occupies, projected through the battle camera) rather than assumed,
  // since a duck and a giant do not wear a marker at the same height; a 2D
  // battler answers with the top of its own bitmap.
  let _headBoxScratch = null;
  let _headPosScratch = null;
  let _headBoxOwner = null;    // whose box _headBoxScratch currently holds
  let _headBoxFrame = -999;
  const HEAD_BOX_TTL = 10;     // frames a measured head box is trusted for
  const HEAD_FALLBACK_H = 120; // when nothing can be measured

  function battlerHeadPosition(battler) {
    const scene = SceneManager._scene;
    const spriteset = scene && scene._spriteset;
    if (!battler || !spriteset) return null;

    const scene3d = spriteset._battle3DScene;
    if (
      scene3d &&
      scene3d.camera &&
      typeof THREE !== "undefined" &&
      typeof spriteset.get3DModel === "function" &&
      (typeof scene3d.hasModels !== "function" || scene3d.hasModels())
    ) {
      const model = spriteset.get3DModel(battler);
      const root = model && model.model;
      if (root && root.visible) {
        const box = _headBoxScratch || (_headBoxScratch = new THREE.Box3());
        // Measuring the box walks every mesh of the model and updates the whole
        // subtree's world matrices, and the chevron asks for it on every frame the
        // target picker is open. A breathing idle does not change how tall a
        // creature is from one frame to the next, so the reading is held for a few
        // frames per model; the chevron's own bob is what the eye reads anyway.
        const now = Graphics.frameCount;
        if (_headBoxOwner !== root || now - _headBoxFrame >= HEAD_BOX_TTL) {
          box.setFromObject(root);
          _headBoxOwner = root;
          _headBoxFrame = now;
        }
        if (!box.isEmpty()) {
          const v = _headPosScratch || (_headPosScratch = new THREE.Vector3());
          v.set(
            (box.min.x + box.max.x) / 2,
            box.max.y,
            (box.min.z + box.max.z) / 2
          );
          v.project(scene3d.camera);
          if (isFinite(v.x) && isFinite(v.y) && v.z <= 1) {
            return {
              x: (v.x * 0.5 + 0.5) * Graphics.width,
              y: (-v.y * 0.5 + 0.5) * Graphics.height,
            };
          }
        }
      }
    }

    const foot = battlerFootPosition(battler);
    if (!foot) return null;
    const sprites = spriteset._enemySprites || [];
    const sprite = sprites.find((s) => s && s._battler === battler);
    const height =
      sprite && sprite.bitmap && sprite.bitmap.height
        ? sprite.bitmap.height
        : HEAD_FALLBACK_H;
    return { x: foot.x, y: foot.y - height };
  }

  Game_Actor.prototype.traitObjectsWithoutStates = function() {
    const objects = [];
    objects.push(this.actor(), this.currentClass());
    for (const item of this.equips()) {
      if (item) {
        objects.push(item);
      }
    }
    return objects;
  };

  Game_Actor.prototype.paramWithoutStatesAndBuffs = function(paramId) {
    const basePlus = this.paramBasePlus(paramId);
    
    // Calculate paramRate using traitObjectsWithoutStates
    const traitObjects = this.traitObjectsWithoutStates();
    const rate = traitObjects.reduce((r, obj) => {
      if (obj && obj.traits) {
        const paramTraits = obj.traits.filter(t => t.code === 21 && t.dataId === paramId);
        return r * paramTraits.reduce((pr, t) => pr * t.value, 1);
      }
      return r;
    }, 1);
    
    let value = basePlus * rate;
    const maxValue = this.paramMax(paramId);
    const minParam = this.paramMin(paramId);
    return Math.round(value.clamp(minParam, maxValue));
  };

  // --- HTML Text Overlay Implementation ---
  ;

  let _cachedScale = null;
  window.addEventListener('resize', () => { _cachedScale = null; });

  function _hudGetScale() {
    if (_cachedScale) return _cachedScale;
    const el = document.getElementById('gameCanvas');
    if (!el) return { sx: 1, sy: 1, ox: 0, oy: 0 };
    const r = el.getBoundingClientRect();
    _cachedScale = {
      sx: r.width / Graphics.width,
      sy: r.height / Graphics.height,
      ox: r.left,
      oy: r.top
    };
    return _cachedScale;
  }

  class HtmlTextOverlay {
    constructor(parentSprite) {
      this.parentSprite = parentSprite;
      this.root = document.createElement('div');
      this.root.style.cssText = 'position:fixed;display:none;z-index:100;pointer-events:none;font-family:"Lora",serif;transform-origin:top left;';
      document.body.appendChild(this.root);
      this._pool = [];
      this._usedCount = 0;
    }

    update() {
      const visible = this.parentSprite && this.parentSprite.visible &&
                      this.parentSprite.worldAlpha > 0 && this.parentSprite.parent;
      if (!visible) {
        if (this._lastVisible !== false) {
          this.root.style.display = 'none';
          this._lastVisible = false;
        }
        return;
      }

      const sc = _hudGetScale();
      let pt = { x: 0, y: 0 };
      if (typeof this.parentSprite.getGlobalPosition === 'function') {
        pt = this.parentSprite.getGlobalPosition();
      } else {
        let node = this.parentSprite;
        while (node) {
          pt.x += node.x;
          pt.y += node.y;
          node = node.parent;
        }
      }

      const left = (sc.ox + pt.x * sc.sx).toFixed(1);
      const top  = (sc.oy + pt.y * sc.sy).toFixed(1);
      const transform = `scale(${sc.sx.toFixed(4)}, ${sc.sy.toFixed(4)})`;
      const opacity = this.parentSprite.worldAlpha;

      if (this._lastVisible !== true || this._lastLeft !== left ||
          this._lastTop !== top || this._lastTransform !== transform ||
          this._lastOpacity !== opacity) {
        this.root.style.display   = 'block';
        this.root.style.left      = left + 'px';
        this.root.style.top       = top  + 'px';
        this.root.style.transform = transform;
        this.root.style.opacity   = opacity;
        this._lastVisible   = true;
        this._lastLeft      = left;
        this._lastTop       = top;
        this._lastTransform = transform;
        this._lastOpacity   = opacity;
      }
    }

    clear() {
      this._usedCount = 0;
      for (const el of this._pool) {
        el.style.display = 'none';
      }
    }

    _getEl() {
      if (this._usedCount < this._pool.length) {
        const el = this._pool[this._usedCount++];
        el.style.display = '';
        return el;
      }
      const el = document.createElement('div');
      this.root.appendChild(el);
      this._pool.push(el);
      this._usedCount++;
      return el;
    }

    addText(text, x, y, width, align, fontSize, color, bold, outlineColor, outlineWidth = 2, fontFace = "Lora, serif", lineHeight = null) {
      const el = this._getEl();
      el.innerHTML = text;
      el.style.position = 'absolute';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = width ? width + 'px' : '';
      el.style.textAlign = align || 'left';
      el.style.fontSize = fontSize + 'px';
      el.style.color = color || '#ffffff';
      el.style.fontWeight = bold ? 'bold' : 'normal';
      el.style.fontFamily = fontFace;
      if (lineHeight) {
        el.style.lineHeight = lineHeight + 'px';
      } else {
        el.style.lineHeight = '';
      }
      if (outlineColor && outlineWidth > 0) {
        const w = outlineWidth;
        el.style.textShadow = `-${w}px -${w}px 0 ${outlineColor},${w}px -${w}px 0 ${outlineColor},-${w}px ${w}px 0 ${outlineColor},${w}px ${w}px 0 ${outlineColor},-${w}px 0 0 ${outlineColor},${w}px 0 0 ${outlineColor},0 -${w}px 0 ${outlineColor},0 ${w}px 0 ${outlineColor}`;
      } else {
        el.style.textShadow = 'none';
      }
      el.style.whiteSpace = 'nowrap';
      // Reset chip/badge box styling so pooled elements reused as plain text stay clean
      el.style.background = '';
      el.style.border = '';
      el.style.borderRadius = '';
      el.style.boxShadow = '';
      el.style.padding = '';
      el.style.height = '';
      el.style.boxSizing = '';
      // Rows that laid a name and a level tag side by side leave flex behind
      el.style.alignItems = '';
      el.style.gap = '';
      return el;
    }

    destroy() {
      if (this.root && this.root.parentNode) {
        this.root.parentNode.removeChild(this.root);
      }
      this._pool = [];
    }
  }

  const isMobileDevice = Utils.isMobileDevice(); // Detect if running on mobile
  const useMobileOptimization = false; // Set to true to force optimization even on desktop
  const { SpritesAssociation } = window.Sprites || {};

  let _statsI18n = null;

  const _loadStatsI18n = async () => {
    const lang = ConfigManager.language || 'en';
    const url = `js/i18n/${lang}/stats.json`;
    try {
      const response = await fetch(url);
      _statsI18n = await response.json();
    } catch (e) {
      console.error('BattleSystemEnhancedHUD: Failed to load i18n data from ' + url, e);
    }
  };

  const _si18n = (key) => {
    if (_statsI18n && _statsI18n[key]) {
      return _statsI18n[key];
    }
    return key;
  };

  _loadStatsI18n();

  // Battle UI fixes parameters
  const helpWindowHeightBonus = Number(
    parameters["HelpWindowHeightBonus"] || 20
  );

  const elementIcons = [0, 96, 64, 65, 66, 67, 68, 69, 70, 71];

  const statDisplayPlayerX = Number(
    parameters["StatDisplayPlayerX"] || Graphics.width / 2 - 200
  );
  const statDisplayEnemyX = Number(
    parameters["StatDisplayEnemyX"] || Graphics.width / 2 + 100
  );
  const statDisplayY = Number(parameters["StatDisplayY"] || 50);

  function getEnemyLevel(battler) {
    if (!battler.isEnemy || !battler.isEnemy()) return "";

    const notes = battler.enemy().note || "";
    const levelMatch = notes.match(/<Level:\s*(\d+)>/i);

    if (levelMatch && levelMatch[1]) {
      return "L." + levelMatch[1];
    }
    return "";
  }
  function getResponsiveBarPositions() {
    const screenWidth = Graphics.width;
    return {
      playerBarX: 60,
      enemyBarX: screenWidth - barWidth - 60,
      barsY: 35 // Optimized top margin
    };
  }

  function getStatusTag(state) {
    if (!state) return "";
    return window.translateText(state.name);
  }

  // Read a state's <Hex: #RRGGBB> color from its note, for tinting status tags
  function getStateHexColor(state) {
    if (!state || !state.note) return null;
    const m = state.note.match(/<Hex:\s*(#[0-9A-Fa-f]{3,8})>/i);
    return m ? m[1] : null;
  }

  // Helper function to collect status tags for display
  function getStatusTags(battler) {
    if (!battler || !battler.states) return [];

    const tags = [];
    const states = battler.states();

    for (const state of states) {
      const tag = getStatusTag(state);
      if (tag) {
        tags.push(tag);
      }
    }

    return tags;
  }

  // Helper function to get bust image path using SpritesAssociation
  function getBustImagePath(actor) {
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
      if (characterName && window.Sprites && SpritesAssociation) {
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

    // Players 2 & 3: Use SpritesAssociation based on sprite
    if (characterName && window.Sprites && SpritesAssociation) {
      const spritesheetName = characterName.split('.')[0];
      const characterIndex = actor.characterIndex();

      if (SpritesAssociation[spritesheetName] &&
        SpritesAssociation[spritesheetName][characterIndex]) {
        const bustName = SpritesAssociation[spritesheetName][characterIndex];
        return "img/busts/" + bustName;
      }
    }

    // Fallback to default bust path structure
    return "img/busts/" + characterName + "/" + actor.characterIndex();
  }

  //=========================================================================
  // Battle UI Fixes - Window_Help modifications
  //=========================================================================

  const _Window_Help_initialize = Window_Help.prototype.initialize;
  Window_Help.prototype.initialize = function (rect) {
    // Adjust height if in battle (optional bonus)
    if ($gameParty && $gameParty.inBattle && $gameParty.inBattle()) {
      rect.height += helpWindowHeightBonus;
    }
    _Window_Help_initialize.call(this, rect);

    // Always create the HTML overlay (it will be hidden when not needed)
    const old = document.getElementById('html-battle-help-overlay');
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = 'html-battle-help-overlay';
    root.style.cssText =
        'position:fixed;display:flex;flex-direction:column;justify-content:center;z-index:501;pointer-events:none;' +
        'box-sizing:border-box;overflow-y:auto;' +
        'background:var(--text-danger-hover);' +
        'border:3px solid var(--border-subtle);border-radius:6px;' +
        'outline:1px solid var(--border-subtle-translucent-40);outline-offset:-7px;' +
        'background-image:radial-gradient(ellipse at center,' +
        'transparent 40%,var(--bg-brown-vignette-10) 100%);' +
        'padding:16px 20px;' +
        'font-family:\'Lora\',serif;font-weight:bold;color:var(--text-primary-hover);line-height:1.2;' +
        'transform:translateX(115%);opacity:0;' +
        'transition:transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.3s ease;';
    this._htmlHelpRoot = root;
    document.body.appendChild(root);
  };

  const _Window_Help_destroy = Window_Help.prototype.destroy || Window_Base.prototype.destroy;
  Window_Help.prototype.destroy = function (options) {
      if (this._htmlHelpRoot && this._htmlHelpRoot.parentNode) {
          this._htmlHelpRoot.parentNode.removeChild(this._htmlHelpRoot);
      }
      this._htmlHelpRoot = null;
      if (_Window_Help_destroy) _Window_Help_destroy.call(this, options);
  };

  const _Window_Help_show = Window_Help.prototype.show;
  Window_Help.prototype.show = function () {
      _Window_Help_show.call(this);
  };

  const _Window_Help_hide = Window_Help.prototype.hide;
  Window_Help.prototype.hide = function () {
      _Window_Help_hide.call(this);
  };

  const _Window_Help_render = Window_Help.prototype.render;
  Window_Help.prototype.render = function (renderer) {
      if ($gameParty.inBattle()) {
          return; // Prevent PIXI rendering
      }
      _Window_Help_render.call(this, renderer);
  };

  const _Window_Help__render = Window_Help.prototype._render;
  Window_Help.prototype._render = function (renderer) {
      if ($gameParty.inBattle()) {
          return; // Prevent PIXI rendering
      }
      _Window_Help__render.call(this, renderer);
  };

  const _Window_Help_update = Window_Help.prototype.update;
  Window_Help.prototype.update = function () {
      _Window_Help_update.call(this);

      if (!this._htmlHelpRoot) return;

      // Only display the custom HTML help overlay in battle scenes
      const inBattle = $gameParty && typeof $gameParty.inBattle === 'function' && $gameParty.inBattle();
      const txt = (this._text || '').trim();

      if (!inBattle || !this.visible || this.height === 0 || this.width === 0 || !txt) {
          if (this._htmlHelpSlideState !== 'hidden') {
              this._htmlHelpSlideState = 'hidden';
              this._htmlHelpRoot.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
              this._htmlHelpRoot.style.transform = 'translateX(115%)';
              this._htmlHelpRoot.style.opacity = '0';
              this._htmlHelpRoot.style.pointerEvents = 'none';
          }
          this._lastRawHelpText = null;
          return;
      }

      if (txt !== this._lastRawHelpText) {
          this._lastRawHelpText = txt;
          let text = this._text || '';
          if (typeof window.translateText === 'function') {
              text = window.translateText(text);
          }
          
          text = text.replace(/\\C\[\d+\]/gi, '')
                     .replace(/\\V\[\d+\]/gi, '')
                     .replace(/\\N\[\d+\]/gi, '')
                     .replace(/\\P\[\d+\]/gi, '')
                     .replace(/\\G/gi, '');

          // Convert \I[n] icon codes into inline iconset spans so element
          // icons render to the left of their name in the help box.
          text = text.replace(/\\I\[(\d+)\]/gi, function (m, n) {
              const idx = Number(n);
              const ix = (idx % 16) * 32;
              const iy = Math.floor(idx / 16) * 32;
              return '<span style="background:url(\'img/system/IconSet.png\') -' + ix +
                  'px -' + iy + 'px no-repeat;width:32px;height:32px;display:inline-block;' +
                  'vertical-align:middle;image-rendering:pixelated;margin-right:4px;"></span>';
          });

          // Wrap in a single block child so the flex-column root does not
          // stack the inline icon span as its own row above the element name.
          const formattedText = '<div>' + text.replace(/\n/g, '<br/>') + '</div>';
          if (this._htmlHelpRoot.innerHTML !== formattedText) {
              this._htmlHelpRoot.innerHTML = formattedText;
          }
      }

      const sc = _hudGetScale();
      const pad = this.padding || 12;
      const s = this._htmlHelpRoot.style;

      // The box belongs to the list page under it, so it takes that page's
      // width and stands directly on its top edge (window.BattleListPage,
      // published by whichever of the skill / item pages is open). A page whose
      // height follows its contents would otherwise leave the description
      // stranded halfway up the screen.
      const page = window.BattleListPage || { MARGIN: 20, GAP: 10, TOP: 184, width: 420, height: 460 };
      const fixedW = page.width * sc.sx;

      // Anchor the box by its bottom-right corner (just above the skill selector)
      // and let width/height grow with the content so the box autosizes to its text.
      // Both pages hang from page.TOP, so the box stands on that one line and
      // does not move when the player switches between them.
      const rightEdgeX = sc.ox + (Graphics.width * sc.sx) - (page.MARGIN * sc.sx);
      const bottomEdgeY = sc.oy + (page.TOP - page.GAP) * sc.sy;

      const rightStr = Math.max(0, window.innerWidth - rightEdgeX) + 'px';
      const bottomStr = Math.max(0, window.innerHeight - bottomEdgeY) + 'px';
      const widthStr = fixedW + 'px';
      const paddingStr = Math.round(pad * sc.sy) + 'px ' + Math.round(pad * sc.sx) + 'px';

      const baseFontSize = (typeof this.standardFontSize === 'function')
          ? this.standardFontSize() : 24;
      const scaledFont = Math.round(baseFontSize * sc.sy * 0.85);
      const fontSizeStr = scaledFont + 'px';

      if (s.left !== '') s.left = '';
      if (s.top !== '') s.top = '';
      if (s.width !== widthStr) s.width = widthStr;
      if (s.height !== 'auto') s.height = 'auto';
      if (s.right !== rightStr) s.right = rightStr;
      if (s.bottom !== bottomStr) s.bottom = bottomStr;
      if (s.maxWidth !== widthStr) s.maxWidth = widthStr;
      if (s.padding !== paddingStr) s.padding = paddingStr;
      if (s.fontSize !== fontSizeStr) s.fontSize = fontSizeStr;

      // Apply the slide-in animation transition
      if (this._htmlHelpSlideState !== 'shown') {
          this._htmlHelpSlideState = 'shown';
          s.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.3s ease';
          s.transform = 'translateX(0)';
          s.opacity = '1';
          s.pointerEvents = 'auto';
      }
  };

  const _Scene_Battle_helpWindowRect = Scene_Battle.prototype.helpWindowRect;
  Scene_Battle.prototype.helpWindowRect = function () {
    const rect = _Scene_Battle_helpWindowRect.call(this);
    rect.height += helpWindowHeightBonus;
    return rect;
  };

  // Adjust other windows to account for taller help window
  const _Scene_Battle_skillWindowRect = Scene_Battle.prototype.skillWindowRect;
  Scene_Battle.prototype.skillWindowRect = function () {
    const rect = _Scene_Battle_skillWindowRect.call(this);
    rect.y += helpWindowHeightBonus;
    rect.height -= helpWindowHeightBonus + 200;
    return rect;
  };

  const _Scene_Battle_itemWindowRect = Scene_Battle.prototype.itemWindowRect;
  Scene_Battle.prototype.itemWindowRect = function () {
    const rect = _Scene_Battle_itemWindowRect.call(this);
    rect.y += helpWindowHeightBonus;
    rect.height -= helpWindowHeightBonus + 200;
    return rect;
  };

  //=========================================================================
  // Battle UI Fixes - Window_BattleItem single column
  //=========================================================================

  // -------------------------------------------------------------------------
  // HTML Battle Item Overlay ,  parchment overlay matching DialogueSystem
  // -------------------------------------------------------------------------


  function getIconStyle(iconIndex) {
      const x = (iconIndex % 16) * 32;
      const y = Math.floor(iconIndex / 16) * 32;
      return `background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; display: inline-block; vertical-align: middle; image-rendering: pixelated; transform: scale(0.75); margin-right: 4px;`;
  }

  //=============================================================================
  // Window_BattleItem Categorization
  //=============================================================================
  const MIN_ITEMS_FOR_CATEGORIZATION = 10;

  Window_BattleItem.prototype.isCategorized = function () {
    if (!$gameParty) return false;
    const totalItems = $gameParty.allItems().filter(item => this.includes(item)).length;
    return totalItems > MIN_ITEMS_FOR_CATEGORIZATION;
  };

  const _Window_BattleItem_makeItemList = Window_BattleItem.prototype.makeItemList;
  Window_BattleItem.prototype.makeItemList = function () {
    if (this.isCategorized()) {
      if (!this.visible) {
        this._categoryMode = true;
        this._selectedCategory = null;
      }
      if (this._categoryMode) {
        const categoriesSet = new Set();
        const allItems = $gameParty.allItems().filter(item => this.includes(item));
        for (const item of allItems) {
          const cat = (item.meta && typeof item.meta.category === 'string' && item.meta.category.trim()) || "General";
          categoriesSet.add(cat);
        }
        this._data = Array.from(categoriesSet).sort();
      } else {
        this._data = $gameParty.allItems().filter(item => {
          if (!this.includes(item)) return false;
          const cat = (item.meta && typeof item.meta.category === 'string' && item.meta.category.trim()) || "General";
          return cat === this._selectedCategory;
        });
      }
    } else {
      _Window_BattleItem_makeItemList.call(this);
    }
  };

  const _Window_BattleItem_processOk = Window_BattleItem.prototype.processOk;
  Window_BattleItem.prototype.processOk = function () {
    if (this.isCategorized() && this._categoryMode) {
      if (this.isCurrentItemEnabled()) {
        SoundManager.playOk();
        this._selectedCategory = this.item();
        this._categoryMode = false;
        this.refresh();
        this.select(0);
        this.activate();
      } else {
        this.playBuzzerSound();
      }
    } else {
      _Window_BattleItem_processOk.call(this);
    }
  };

  const _Window_BattleItem_processCancel = Window_BattleItem.prototype.processCancel;
  Window_BattleItem.prototype.processCancel = function () {
    if (this.isCategorized() && !this._categoryMode) {
      SoundManager.playCancel();
      this._categoryMode = true;
      this._selectedCategory = null;
      this.refresh();
      this.select(0);
      this.activate();
    } else {
      _Window_BattleItem_processCancel.call(this);
    }
  };

  const _Window_BattleItem_isEnabled = Window_BattleItem.prototype.isEnabled;
  Window_BattleItem.prototype.isEnabled = function (item) {
    if (typeof item === 'string') {
      return $gameParty.allItems().some(x => {
        if (!this.includes(x)) return false;
        const cat = (x.meta && typeof x.meta.category === 'string' && x.meta.category.trim()) || "General";
        return cat === item && $gameParty.canUse(x);
      });
    }
    return _Window_BattleItem_isEnabled.call(this, item);
  };

  const _Window_BattleItem_updateHelp = Window_BattleItem.prototype.updateHelp;
  Window_BattleItem.prototype.updateHelp = function () {
    if (this.isCategorized() && this._categoryMode) {
      if (this._helpWindow) {
        this._helpWindow.setText('');
      }
    } else {
      _Window_BattleItem_updateHelp.call(this);
    }
  };

  const _Window_BattleItem_initialize = Window_BattleItem.prototype.initialize;
  Window_BattleItem.prototype.initialize = function (rect) {
    _Window_BattleItem_initialize.call(this, rect);
    
    // Remove old overlay if any
    const old = document.getElementById('html-battle-item-overlay');
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = 'html-battle-item-overlay';
    root.style.cssText =
        'position:fixed;z-index:501;pointer-events:none;' +
        'box-sizing:border-box;overflow-y:auto;display:grid;' +
        'background:var(--text-danger-hover);' +
        'border:3px solid var(--border-subtle);border-radius:6px;' +
        'outline:1px solid var(--border-subtle-translucent-40);outline-offset:-7px;' +
        'background-image:radial-gradient(ellipse at center,' +
        'transparent 40%,var(--bg-brown-vignette-10) 100%);' +
        'padding:16px 12px;' +
        'transform:translateX(115%);opacity:0;' +
        'transition:transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.3s ease;';
    
    // Right click to cancel / back out
    root.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.active && typeof this.processCancel === 'function') {
            this.processCancel();
        }
    });

    root.addEventListener("wheel", (e) => {
        e.preventDefault();
        root.scrollTop += e.deltaY;
    }, { passive: false });

    this._htmlItemRoot = root;
    document.body.appendChild(root);
  };

  // Keep the window logically active/visible to the engine for keyboard/controller input,
  // but prevent PIXI from drawing its canvas graphics.
  Window_BattleItem.prototype.render = function (renderer) {
      // Prevent PIXI rendering
  };

  Window_BattleItem.prototype._render = function (renderer) {
      // Prevent PIXI rendering
  };

  const _Window_BattleItem_destroy = Window_BattleItem.prototype.destroy || Window_Selectable.prototype.destroy;
  Window_BattleItem.prototype.destroy = function (options) {
      if (this._htmlItemRoot && this._htmlItemRoot.parentNode) {
          this._htmlItemRoot.parentNode.removeChild(this._htmlItemRoot);
      }
      this._htmlItemRoot = null;
      if (_Window_BattleItem_destroy) _Window_BattleItem_destroy.call(this, options);
  };

  const _Window_BattleItem_show = Window_BattleItem.prototype.show;
  Window_BattleItem.prototype.show = function () {
      if (this.isCategorized()) {
          this._categoryMode = true;
          this._selectedCategory = null;
      } else {
          this._categoryMode = false;
          this._selectedCategory = null;
      }
      this.refresh();
      _Window_BattleItem_show.call(this);
      this.select(0);
      if (this._htmlItemRoot) {
          this._buildItemHtml();
          setTimeout(() => {
              if (this._htmlItemRoot && this.visible) {
                  this._htmlItemRoot.style.transform = 'translateX(0)';
                  this._htmlItemRoot.style.opacity = '1';
                  this._htmlItemRoot.style.pointerEvents = 'auto';
              }
          }, 0);
      }
  };

  const _Window_BattleItem_hide = Window_BattleItem.prototype.hide;
  Window_BattleItem.prototype.hide = function () {
      _Window_BattleItem_hide.call(this);
      if (this._htmlItemRoot) {
          this._htmlItemRoot.style.transform = 'translateX(115%)';
          this._htmlItemRoot.style.opacity = '0';
          this._htmlItemRoot.style.pointerEvents = 'none';
      }
  };

  const _Window_BattleItem_refresh = Window_BattleItem.prototype.refresh;
  Window_BattleItem.prototype.refresh = function () {
      _Window_BattleItem_refresh.call(this);
      if (this._htmlItemRoot) {
          this._buildItemHtml();
      }
  };

  // Always return 1 column for battle items to prevent name truncation
  Window_BattleItem.prototype.maxCols = function () {
    return 1;
  };

  // No column spacing needed for single column
  Window_BattleItem.prototype.colSpacing = function () {
    return 0;
  };

  Window_BattleItem.prototype.processTouch = function () {
    // Disable standard touch inputs to prevent conflict with custom HTML overlay events
  };

  Window_BattleItem.prototype.processCursorMove = function () {
      if (this.isCursorMovable()) {
          const isP2 = window.$gameSplitScreen && window.$gameSplitScreen.active &&
              this._actor && this._actor.multiplayerPlayerId && this._actor.multiplayerPlayerId() === 2;
          const input = isP2 ? window.$gameSplitScreen : Input;

          if (input.isRepeated("down")) {
              if (this.index() >= this.maxItems() - 1) {
                  this.select(0);
                  this.playCursorSound();
              } else {
                  this.cursorDown(input.isTriggered("down"));
              }
          } else if (input.isRepeated("up")) {
              if (this.index() <= 0) {
                  this.select(this.maxItems() - 1);
                  this.playCursorSound();
              } else {
                  this.cursorUp(input.isTriggered("up"));
              }
          } else if (input.isRepeated("right")) {
              this.cursorRight(input.isTriggered("right"));
          } else if (input.isRepeated("left")) {
              this.cursorLeft(input.isTriggered("left"));
          } else {
              if (!this.isHandled("pagedown") && input.isRepeated("pagedown")) this.cursorPagedown();
              if (!this.isHandled("pageup") && input.isRepeated("pageup")) this.cursorPageup();
          }
      }
  };

  Window_BattleItem.prototype.drawItem = function (index) {
    // No-op: custom HTML overlay handles rendering, prevents canvas drawing crashes
  };

  Window_BattleItem.prototype._buildItemHtml = function () {
      const root = this._htmlItemRoot;
      if (!root) return;
      root.innerHTML = '';

      root.style.display = 'grid';
      root.style.gridTemplateColumns = '1fr';
      root.style.gridGap = '6px 12px';
      root.style.alignContent = 'start';

      const sc = _hudGetScale();
      const baseFontSize = (typeof this.standardFontSize === 'function')
          ? this.standardFontSize() : 24;
      const scaledFont = Math.round(baseFontSize * sc.sy * 0.85);

      const self = this;
      const items = this._data || [];

      this._htmlItemEls = items.map((item, i) => {
          const el = document.createElement('div');
          el.dataset.idx = i;
          el.style.cssText =
              'font-family:\'Lora\',serif;font-weight:bold;color:var(--text-primary-hover);' +
              'padding:6px 12px;border-radius:4px;cursor:pointer;' +
              'border:2px solid transparent;transition:background 0.1s, border-color 0.1s;' +
              'display:flex;align-items:center;justify-content:space-between;' +
              'user-select:none;box-sizing:border-box;min-height:40px;';
          el.style.fontSize = scaledFont + 'px';

          // Left side: Icon + Name
          const leftDiv = document.createElement('div');
          leftDiv.style.cssText = 'display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

          if (typeof item === 'string') {
              // Category Mode
              const iconIndex = 209; // Generic bag icon
              const iconSpan = document.createElement('span');
              iconSpan.style.cssText = getIconStyle(iconIndex);
              leftDiv.appendChild(iconSpan);

              const nameSpan = document.createElement('span');
              nameSpan.textContent = item;
              leftDiv.appendChild(nameSpan);
              el.appendChild(leftDiv);

              // Right side: Item count in this category
              const rightDiv = document.createElement('div');
              rightDiv.style.cssText = 'display:flex;align-items:center;font-size:85%;font-weight:bold;color:var(--text-primary-hover);';

              const count = $gameParty.allItems().filter(x => {
                  if (!self.includes(x)) return false;
                  const cat = (x.meta && typeof x.meta.category === 'string' && x.meta.category.trim()) || "General";
                  return cat === item;
              }).length;

              const countSpan = document.createElement('span');
              countSpan.textContent = '(' + count + ')';
              rightDiv.appendChild(countSpan);
              el.appendChild(rightDiv);

              const isEnabled = $gameParty.allItems().some(x => {
                  if (!self.includes(x)) return false;
                  const cat = (x.meta && typeof x.meta.category === 'string' && x.meta.category.trim()) || "General";
                  return cat === item && $gameParty.canUse(x);
              });
              if (!isEnabled) {
                  el.style.opacity = '0.4';
              }
          } else if (item) {
              // Standard Item Mode
              const iconIndex = item.iconIndex;
              const iconSpan = document.createElement('span');
              iconSpan.style.cssText = getIconStyle(iconIndex);
              leftDiv.appendChild(iconSpan);

              const nameSpan = document.createElement('span');
              nameSpan.textContent = item.name;
              leftDiv.appendChild(nameSpan);
              el.appendChild(leftDiv);

              // Right side: Quantity / Number
              const rightDiv = document.createElement('div');
              rightDiv.style.cssText = 'display:flex;align-items:center;font-size:85%;font-weight:bold;color:var(--text-primary-hover);';

              const count = $gameParty.numItems(item);
              const countSpan = document.createElement('span');
              countSpan.textContent = 'x' + count;
              rightDiv.appendChild(countSpan);
              el.appendChild(rightDiv);

              // Enable/disable based on whether party can use the item in battle
              const isEnabled = $gameParty.canUse(item);
              if (!isEnabled) {
                  el.style.opacity = '0.4';
              }
          } else {
              el.style.visibility = 'hidden';
          }

          el.addEventListener('mouseover', () => {
              if (self.active && typeof self.select === 'function') {
                  self.select(i);
              }
          });

          el.addEventListener('click', () => {
              if (self.active && typeof self.select === 'function') {
                  self.select(i);
              }
              if (self.active && typeof self.processOk === 'function') {
                  self.processOk();
              }
          });

          root.appendChild(el);
          return el;
      });
  };

  const _Window_BattleItem_update = Window_BattleItem.prototype.update;
  Window_BattleItem.prototype.update = function () {
      _Window_BattleItem_update.call(this);

      if (!this._htmlItemRoot) return;

      const isClosed = !this.visible || this.openness === 0 || !this.isOpen() || this.height === 0 || this.width === 0;

      if (isClosed) {
          if (this._lastStateClosed !== true) {
              this._htmlItemRoot.style.transform = 'translateX(115%)';
              this._htmlItemRoot.style.opacity = '0';
              this._htmlItemRoot.style.pointerEvents = 'none';
              this._lastStateClosed = true;
              this._lastIdx = null;
          }
          return;
      }

      this._lastStateClosed = false;

      const sc = _hudGetScale();
      const pad = this.padding || 12;
      const s = this._htmlItemRoot.style;
      const idx = this.index();

      if (this._lastIdx !== idx || this._lastSx !== sc.sx || this._lastSy !== sc.sy) {
          this._lastIdx = idx;
          this._lastSx = sc.sx;
          this._lastSy = sc.sy;

          // The page hangs from the top line both battle lists share
          // (window.BattleListPage), so switching between items and skills
          // never moves the panel, and reaches down to the bottom margin.
          const page = window.BattleListPage;
          const ITEM_W = 340;
          const ITEM_H = page ? page.maxHeight() : 420;
          const ITEM_TOP = page ? page.TOP : 184;
          const scaledW = ITEM_W * sc.sx;
          const scaledH = ITEM_H * sc.sy;
          // The description box stands on this page while it is the open one.
          if (page) page.set(ITEM_W, ITEM_H);

          const targetLeft = sc.ox + (Graphics.width * sc.sx) - scaledW - (20 * sc.sx);
          const targetTop = sc.oy + (ITEM_TOP * sc.sy);

          s.left = targetLeft + 'px';
          s.top = targetTop + 'px';
          s.width = scaledW + 'px';
          s.height = scaledH + 'px';
          s.padding = Math.round(pad * sc.sy) + 'px ' + Math.round(pad * sc.sx) + 'px';

          s.transform = 'translateX(0)';
          s.opacity = '1';
          s.pointerEvents = 'auto';

          const baseFontSize = (typeof this.standardFontSize === 'function')
              ? this.standardFontSize() : 24;
          const scaledFont = Math.round(baseFontSize * sc.sy * 0.85);

          if (this._htmlItemEls) {
              this._htmlItemEls.forEach((el, i) => {
                  el.style.fontSize = scaledFont + 'px';
                  if (i === idx) {
                      el.style.background = 'var(--bg-subtle-translucent-15)';
                      el.style.borderColor = 'var(--border-subtle)';
                  } else {
                      el.style.background = 'transparent';
                      el.style.borderColor = 'transparent';
                  }
              });

              // Scroll the selected element into view for keyboard/controller navigation
              if (this._htmlItemEls[idx]) {
                  const container = this._htmlItemRoot;
                  const el = this._htmlItemEls[idx];
                  const cRect = container.getBoundingClientRect();
                  const eRect = el.getBoundingClientRect();
                  if (eRect.top < cRect.top) {
                      container.scrollTop -= cRect.top - eRect.top;
                  } else if (eRect.bottom > cRect.bottom) {
                      container.scrollTop += eRect.bottom - cRect.bottom;
                  }
              }
          }
      }
  };

  // Make sure regular item windows (outside battle) keep their normal behavior
  const _Window_ItemList_maxCols = Window_ItemList.prototype.maxCols;
  Window_ItemList.prototype.maxCols = function () {
    // Only affect battle item window, not regular item lists
    if (this.constructor === Window_BattleItem) {
      return 1;
    }
    return _Window_ItemList_maxCols.call(this);
  };

  // Ensure help window text wrapping works properly with increased height
  const _Window_Help_refresh = Window_Help.prototype.refresh;
  Window_Help.prototype.refresh = function () {
    _Window_Help_refresh.call(this);
    if (this._htmlHelpRoot) {
      let text = this._text || '';
      // Strip common raw RPG Maker MZ canvas color and icon text codes
      text = text.replace(/\\C\[\d+\]/gi, '');
      text = text.replace(/\\I\[\d+\]/gi, '');
      text = text.replace(/\\V\[\d+\]/gi, '');
      text = text.replace(/\\N\[\d+\]/gi, '');
      text = text.replace(/\\P\[\d+\]/gi, '');
      text = text.replace(/\\G/gi, '');

      // Render double newlines or single newlines cleanly as <br/>
      this._htmlHelpRoot.innerHTML = text.replace(/\n/g, '<br/>');
    }
  };

  //=========================================================================
  // Original Battle Bar Code continues below
  //=========================================================================

  function Sprite_BattleBar() {
    this.initialize(...arguments);
  }
  Sprite_BattleBar.prototype = Object.create(Sprite.prototype);
  Sprite_BattleBar.prototype.constructor = Sprite_BattleBar;
  // Expose so other plugins (e.g. class passives) can extend the battle bars.
  window.Sprite_BattleBar = Sprite_BattleBar;
  Sprite_BattleBar.prototype.initialize = function (battler, isPlayer = false, customWidth = null, customHeight = null, isInactive = false) {
    Sprite.prototype.initialize.call(this);
    this._htmlOverlay = new HtmlTextOverlay(this);
    this._battler = battler;
    this._isPlayer = isPlayer;
    this._isInactiveMember = isInactive;
    this._gradientPhase = Math.random() * Math.PI * 2;
    this._barBitmapWidth = customWidth || barWidth;

    const isSimpleDisplay =
      this._isPlayer &&
      this._battler.actorId;

    if (isSimpleDisplay) {
      this._playerCardWidth = customWidth || 400;
      this._playerCardHeight = customHeight || 190;
      this._wavePhase = 0;
      this.createSimpleDisplayBackground();
      this.createSimpleStatusDisplay();
      // Always show the player TP/AP orb.
      if (!isInactive) this.createPlayerTPOrb();
      this._damageFlashTimer = 0;
      this._damageFlashSprite = null;
      this.createDamageFlashOverlay();
    } else {
      // Original initialization for enemies
      this._minimalEnemy = !isPlayer && multipleEnemiesInBattle();
      if (this._minimalEnemy) this._barBitmapWidth = miniBarWidth;
      this.bitmap = new Bitmap(
        this._barBitmapWidth,
        this._minimalEnemy ? miniBarBitmapHeight : barHeight * 8
      ); // Increased height for more info
      this._lastHp = battler.hp;
      this._lastMaxHp = battler.mhp;
      this._lastMp = battler.mp;
      this._lastMaxMp = battler.mmp;
      this._lastTp = battler.tp;
      this._mpFlashAmount = 0;
      this._mpFlashTimer = 0;
      this._mpFlashState = false;
      this._projectedTp = battler.tp;
      this._currentSkill = null;
      this._displayHp = battler.hp;
      this._damageChunkHp = battler.hp;
      this._animationCount = 0;
      this._wavePhase = 0;

      // Create TP Orb first so it appears behind other elements. A compact bar
      // carries neither the TP orb nor the stat readout: those belong to the
      // single-enemy bar, and under a monster they would only bury the field.
      if (!this._minimalEnemy) this.createTPOrb();
      this.refresh();
      this.createDamageOverlay();

      // CHANGED: Add stat display for ALL characters (not just actor 1)
      if (!this._minimalEnemy) this.createStatDisplay();
    }
  };

  Sprite_BattleBar.prototype.createDamageFlashOverlay = function () {
    // Damage feedback is now a red tint + shake applied to the actor's own 2D
    // sprite (see update()/triggerDamageFlash), so no red square overlay sprite
    // is created here. Kept as a no-op so existing call sites stay valid.
    this._damageFlashSprite = null;
    this._damageShakeX = 0;
  };
  // Add a method to update the position of the stat display
  Sprite_BattleBar.prototype.updateStatDisplayPosition = function (x, y) {
    if (this._statDisplay) {
      this._statDisplay.x = x;
      this._statDisplay.y = y;
    }
  };

  // Replace the createStatDisplay method with this new version:
  Sprite_BattleBar.prototype.createStatDisplay = function () {
    this._statDisplay = new Sprite();
    this._statDisplay.bitmap = new Bitmap(
      barWidth * 2.5,
      statDisplayHeight * 15
    );

    // Position at the top center of the screen
    const xCenterOffset = 20; // Adjust this value to move left/right from center

    if (this._isPlayer) {
      this._statDisplay.x = 40; // Slightly left of center
      this._statDisplay.y = 75; // Top of screen with some padding
    } else {
      this._statDisplay.x = Graphics.width / 2 + xCenterOffset + 30; // Slightly right of center
      this._statDisplay.y = 200; // Top of screen with some padding
    }

    // Make sure the sprite is added to the scene, not as a child of the bar
    if (SceneManager._scene) {
      SceneManager._scene.addChild(this._statDisplay);
    } else {
      this.addChild(this._statDisplay);
    }
    this._statHtmlOverlay = new HtmlTextOverlay(this._statDisplay);

    // Set visibility
    this._statDisplay.visible = true;

    // Store UNBUFFED base stats using paramBase instead of param
    this._baseStats = {
      atk: this._battler.paramBase(2), // Attack (unbuffed)
      def: this._battler.paramBase(3), // Defense (unbuffed)
      mat: this._battler.paramBase(4), // Magic Attack (unbuffed)
      mdf: this._battler.paramBase(5), // Magic Defense (unbuffed)
      agi: this._battler.paramBase(6), // Agility (unbuffed)
      luk: this._battler.paramBase(7), // Luck (unbuffed)
    };

    // Initialize states hash
    this._lastStatesHash = this._battler
      .states()
      .map((s) => s.id)
      .join(",");

    // Call refresh to display initial buffs/debuffs
    this.refreshStatDisplay();
  };

  Sprite_BattleBar.prototype.refreshStatDisplay = function () {
    if (!this._battler || !this._statDisplay) {
      return;
    }

    // Remove cycling stats for enemies to avoid overlay with element display
    if (!this._isPlayer) {
      this._statDisplay.bitmap.clear();
      return;
    }

    const b = this._battler;
    const bitmap = this._statDisplay.bitmap;
    bitmap.clear();
    if (this._statHtmlOverlay) this._statHtmlOverlay.clear();
    bitmap.fontFace = $gameSystem.mainFontFace();
    bitmap.fontSize = 30;
    bitmap.outlineColor = "black";
    bitmap.outlineWidth = 2;

    let params = [
      { id: 2, name: "STR", base: this._baseStats.atk },
      { id: 3, name: "CON", base: this._baseStats.def },
      { id: 4, name: "INT", base: this._baseStats.mat },
      { id: 5, name: "WIS", base: this._baseStats.mdf },
      { id: 6, name: "DEX", base: this._baseStats.agi },
      { id: 7, name: "PSI", base: this._baseStats.luk },
    ];

    // Collect all stat diffs (only stats, no statuses)
    const statParts = params.reduce((arr, p) => {
      const current = this._battler.param(p.id);
      const base = this._battler.isActor() ? this._battler.paramWithoutStatesAndBuffs(p.id) : p.base;
      const diff = current - base;
      if (diff !== 0) {
        const sign = diff > 0 ? "+" : "";
        const color = diff > 0 ? "#00ff00" : "#ff4444";
        arr.push({ text: `${p.name}${sign}${diff.toFixed(0)}`, color });
      }
      return arr;
    }, []);

    // Collect status tags
    const statusTags = getStatusTags(this._battler);

    // Initialize cycling timers if not already set
    if (this._statCycleTimer === undefined) {
      this._statCycleTimer = 0;
      this._statCycleIndex = 0;
    }
    if (this._statusCycleTimer === undefined) {
      this._statusCycleTimer = 0;
      this._statusCycleIndex = 0;
    }

    const lineHeight = 24;
    let xPosition = 0;
    let hasContent = false;

    // Handle stat display
    if (statParts.length > 0) {
      // Draw all stats with more space
      for (const currentPart of statParts) {
        bitmap.textColor = currentPart.color;
        const textWidth = bitmap.measureTextWidth(currentPart.text);
        if (this._statHtmlOverlay) this._statHtmlOverlay.addText(currentPart.text, xPosition, 0, textWidth + 55, "left", 30, currentPart.color, false, "black", 2);
        // bitmap.drawText(currentPart.text, xPosition, 0, textWidth + 55, lineHeight, "left");
        xPosition += textWidth + 55;
        hasContent = true;
      }
    }

    // Handle status display, icon + name, left-aligned on a second row
    const activePlayerStates = b.states().filter(s => s.iconIndex > 0);
    if (activePlayerStates.length > 0) {
      const iconBitmap = ImageManager.loadSystem("IconSet");
      const pw = ImageManager.iconWidth;
      const ph = ImageManager.iconHeight;
      const iconSize = 20;
      let stateX = 0;
      const stateY = 30;
      for (const state of activePlayerStates) {
        const stateName = window.translateText ? window.translateText(state.name) : state.name;
        const iconIdx = state.iconIndex;
        const sx = (iconIdx % 16) * pw;
        const sy = Math.floor(iconIdx / 16) * ph;
        bitmap.blt(iconBitmap, sx, sy, pw, ph, stateX, stateY + 2, iconSize, iconSize);
        if (this._statHtmlOverlay) {
          this._statHtmlOverlay.addText(stateName, stateX + iconSize + 4, stateY, 120, "left", 20, "#ffdd99", true, "black", 2, "Lora, serif", iconSize + 4);
        }
        stateX += iconSize + Math.max(80, Math.ceil(bitmap.measureTextWidth(stateName) * 1.8)) + 10;
        hasContent = true;
      }
    }
    // Body parts for enemies are now handled in the main refresh() method
    // to avoid overlay issues and ensure proper positioning under the bar

    this._statDisplay.visible = hasContent;
  };
  Sprite_BattleBar.prototype.setCurrentSkill = function (skill) {
    this._currentSkill = skill;
    if (skill && this._battler) {
      const tpCost = this._battler.skillTpCost(skill);
      // Only show projected TP if the battler has enough TP to use the skill
      if (this._battler.tp >= tpCost) {
        this._projectedTp = Math.max(0, this._battler.tp - tpCost);
      } else {
        this._projectedTp = this._battler.tp;
      }
    } else {
      this._projectedTp = this._battler ? this._battler.tp : 0;
    }
    this.refreshTPOrb();
  };
  Sprite_BattleBar.prototype.setMpFlashAmount = function (amount) {
    this._mpFlashAmount = amount || 0;
    if (amount > 0) {
      this._mpFlashTimer = 0;
      this._mpFlashState = true;
    }
  };
  Sprite_BattleBar.prototype.createDamageOverlay = function () {
    this._damageOverlay = new Sprite();
    this._damageOverlay.bitmap = new Bitmap(
      this._barBitmapWidth,
      this._minimalEnemy ? MINI.thickness : barHeight
    );
    this._damageOverlay.y = this._minimalEnemy ? MINI.hpY : 0;
    this.addChild(this._damageOverlay);
  };
  Sprite_BattleBar.prototype.createTPOrb = function () {
    this._tpOrb = new Sprite();
    this._tpOrb.bitmap = new Bitmap(tpOrbSize, tpOrbSize);
    this._tpOrb.x = tpOrbOffsetX;
    this._tpOrb.y = -3;
    this.addChild(this._tpOrb);
    this._tpOrbHtmlOverlay = new HtmlTextOverlay(this._tpOrb);
    this.refreshTPOrb();
  };

  Sprite_BattleBar.prototype.createPlayerTPOrb = function () {
    const GAP = 12;
    const cardH = this._playerCardHeight || 190;
    const playerOrbSize = 40; // smaller than the enemy orb (tpOrbSize)
    this._playerTpOrb = new Sprite();
    this._playerTpOrb.bitmap = new Bitmap(playerOrbSize, playerOrbSize);
    // Center orb vertically on the HP/MP bar stack (midpoint of the two bars)
    const orbCenterInBitmap = 70;
    this._playerTpOrb.x = -playerBarX + GAP;
    this._playerTpOrb.y = -cardH + orbCenterInBitmap - Math.floor(playerOrbSize / 2);
    this.addChild(this._playerTpOrb);
    this._playerTpOrbHtmlOverlay = new HtmlTextOverlay(this._playerTpOrb);
    this.refreshPlayerTPOrb();
  };

  Sprite_BattleBar.prototype.refreshPlayerTPOrb = function () {
    if (!this._battler || !this._playerTpOrb) return;
    const savedOrb = this._tpOrb;
    this._tpOrb = this._playerTpOrb;
    this.refreshTPOrb();
    this._tpOrb = savedOrb;
  };
  const _Sprite_BattleBar_destroy = Sprite_BattleBar.prototype.destroy || Sprite.prototype.destroy;
  Sprite_BattleBar.prototype.destroy = function (options) {
    if (this._htmlOverlay) this._htmlOverlay.destroy();
    if (this._statHtmlOverlay) this._statHtmlOverlay.destroy();
    if (this._tpOrbHtmlOverlay) this._tpOrbHtmlOverlay.destroy();
    if (this._playerTpOrbHtmlOverlay) this._playerTpOrbHtmlOverlay.destroy();
    if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.destroy();
    if (_Sprite_BattleBar_destroy) _Sprite_BattleBar_destroy.call(this, options);
  };

  Sprite_BattleBar.prototype.update = function () {
    Sprite.prototype.update.call(this);
    // A monster that has left the field takes its bar with it: killed, or talked
    // round and hidden (EnemyTalkSystem). The scene sweeps the bars too, but it
    // does so AFTER its children have updated and not at all while another plugin
    // is driving the scene (Health_Monsters' Check panel), so the bar and the DOM
    // text it carries would outlive the creature by a frame or by a whole panel.
    // Decided here, they go in the same frame the battler does.
    if (this._battler && !this._isPlayer) {
      this.visible = this._battler.isAlive();
    }
    if (this._htmlOverlay) this._htmlOverlay.update();
    if (this._statHtmlOverlay) this._statHtmlOverlay.update();
    if (this._tpOrbHtmlOverlay) this._tpOrbHtmlOverlay.update();
    if (this._playerTpOrbHtmlOverlay) this._playerTpOrbHtmlOverlay.update();
    if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.update();
    if (!this._battler) {
      return;
    }

    // Always update gradient animations for a live feeling
    this.updateGradientAnimation();

    // Handle simple display for all player actors
    const isSimpleDisplay =
      this._isPlayer &&
      this._battler.actorId;

    if (isSimpleDisplay) {
      // NEW: Animate the background pattern
      if (this._backgroundPattern) {
        this._backgroundPattern.origin.x += 0.5;
        this._backgroundPattern.origin.y += 0.25;
      }

      const b = this._battler;

      // Damage chunk + flash tracking
      if (b.hp < this._lastHp) {
        this.triggerDamageFlash();
        this._damageChunkHp = this._displayHp;
        this._displayHp = b.hp;
      } else if (b.hp > this._lastHp) {
        this._displayHp = b.hp;
        this._damageChunkHp = b.hp;
      }

      // Animate depletion chunk
      let chunkAnimating = false;
      if (this._damageChunkHp > this._displayHp) {
        this._damageChunkHp = Math.max(
          this._displayHp,
          this._damageChunkHp - b.mhp / (60 * animationSpeed)
        );
        chunkAnimating = true;
      }

      // UPDATE DAMAGE FLASH: tint the actor's own 2D sprite red and shake it
      // slightly (no red square overlay). The shake offset is applied below when
      // the bust position is set.
      if (this._damageFlashTimer > 0) {
        this._damageFlashTimer--;
        const t = this._damageFlashTimer / DAMAGE_FLASH_DURATION; // 1 -> 0
        if (this._bustSprite) {
          this._bustSprite.setBlendColor([255, 0, 0, Math.floor(t * 180)]);
        }
        // Decaying horizontal shake (a few px, alternating each frame)
        this._damageShakeX = Math.round(Math.sin(this._damageFlashTimer * 1.4) * 6 * t);
        if (this._damageFlashTimer <= 0) {
          this._damageShakeX = 0;
          if (this._bustSprite) this._bustSprite.setBlendColor([0, 0, 0, 0]);
        }
      }

      const activeActor = BattleManager._currentActor ||
        (BattleManager._subject && BattleManager._subject.isActor() ? BattleManager._subject : null);
      const activeActorId = activeActor ? activeActor.actorId() : 0;
      const isActive = this._battler && (this._battler === activeActor);
      const isTargeted = !!(SceneManager._scene &&
                          SceneManager._scene._actorWindow &&
                          SceneManager._scene._actorWindow.active &&
                          this._battler.isSelected());

      // The gold selection band on the party card is dropped: targeting is
      // read from the ally-target list instead, and the pulsing band on the
      // card doubled it up.
      if (this._selectionHighlight && this._selectionHighlight.visible) {
        this._selectionHighlight.visible = false;
        this._selectionHighlight.opacity = 0;
      }

      // Player box stays at its assigned column position
      const targetY = this._targetY !== undefined ? this._targetY : Graphics.height - 20;
      this.y += (targetY - this.y) * 0.15;

      // Targeting is shown via the gold name + card bob, so keep the parchment
      // selection box hidden (it read as an empty box over the actor card).
      if (this._parchmentBackground) {
        this._parchmentBackground.visible = false;
      }
      if (this._solidBackground) {
        this._solidBackground.visible = false;
      }
      if (this._backgroundPattern) {
        this._backgroundPattern.visible = false;
      }
      if (this._backgroundOverlay) {
        this._backgroundOverlay.visible = false;
      }

      const isAlive = b.isAlive();

      if (this._bustSprite && this._bustImage && this._bustImage.isReady()) {
        // Every living party member renders their own sprite at the left of their
        // bars. The active (inputting/acting) member walks in place; the rest hold
        // a static idle frame.
        // Dead members keep their portrait, shown greyed and dimmed instead of
        // being hidden behind a solid black box (issue #167).
        this._bustSprite.visible = true;

        if (isAlive) {
          this._bustSprite.setColorTone([0, 0, 0, 0]);
          this._bustSprite.opacity += (255 - this._bustSprite.opacity) * 0.15;
        } else {
          // Fully desaturate (4th tone channel = greyscale amount) and dim.
          this._bustSprite.setColorTone([0, 0, 0, 255]);
          this._bustSprite.opacity += (130 - this._bustSprite.opacity) * 0.15;
        }

        if (this._usingWorldSprite) {
          this.updateWalkAnimation(isActive);
          // Crisp pixel-art upscaling for the actor walking sprite
          if (this._bustSprite.texture && this._bustSprite.texture.baseTexture) {
            this._bustSprite.texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          }
          if (this._bustSprite.bitmap && this._bustSprite.bitmap._baseTexture) {
            this._bustSprite.bitmap._baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          }
          const frameH = this._worldFrameH || 48;
          const targetScale = 72 / frameH; // constant size; active member stands out via gold name
          this._bustSprite.scale.x = targetScale;
          this._bustSprite.scale.y = targetScale;
        } else {
          // LINEAR smoothing keeps hand-drawn busts / battler images smooth
          if (this._bustSprite.texture && this._bustSprite.texture.baseTexture) {
            this._bustSprite.texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
          }
          if (this._bustSprite.bitmap && this._bustSprite.bitmap._baseTexture) {
            this._bustSprite.bitmap._baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
          }
          const baseScale = 104 / this._bustImage.height; // constant size; no zoom on active turn
          this._bustSprite.scale.x = baseScale;
          this._bustSprite.scale.y = baseScale;
        }

        // Sit in the face column to the left of this card's bars. The bust is a
        // child of the card sprite, so these are local (card-relative) offsets.
        const bob = isTargeted ? -10 : 0;
        // Tucked close to the TP/AP orb so the sprite + orb read as one group.
        // _damageShakeX adds a brief shake when the actor takes a hit.
        this._bustSprite.x = -playerBarX - 22 + (this._damageShakeX || 0);
        this._bustSprite.y = -8 + bob;
      }

      // Mouse/touch targeting interaction:
      if (SceneManager._scene &&
          SceneManager._scene._actorWindow &&
          SceneManager._scene._actorWindow.active &&
          isAlive) {
        const cardWidth = this._playerCardWidth || 160;
        const cardHeight = this._playerCardHeight || 190;
        const tx = TouchInput.x;
        const ty = TouchInput.y;
        const left = this.x - playerBarX;
        const top = this.y - cardHeight;
        
        if (tx >= left && tx <= left + cardWidth && ty >= top && ty <= this.y) {
          const idx = $gameParty.battleMembers().indexOf(this._battler);
          if (idx >= 0 && SceneManager._scene._actorWindow.index() !== idx) {
            SceneManager._scene._actorWindow.select(idx);
          }
          if (TouchInput.isTriggered()) {
            SceneManager._scene._actorWindow.processOk();
          }
        }
      }

      // Cheap per-frame change detection (numeric values + booleans).
      let needsStatusRefresh =
        b.hp !== this._lastHp ||
        b.mhp !== this._lastMaxHp ||
        b.mp !== this._lastMp ||
        b.mmp !== this._lastMaxMp ||
        b.tp !== this._lastTp ||
        chunkAnimating ||
        this._lastActiveActorId !== activeActorId ||
        this._lastIsTargeted !== isTargeted;

      // The states/buffs/class-chip hashes each allocate an array + string every
      // frame, and the class chips require a call into another plugin. These
      // change rarely, so only recompute them a few times per second (or when a
      // cheap check already forced a refresh) instead of on every single frame.
      this._statusHashCounter = (this._statusHashCounter || 0) + 1;
      let currentStatesHash = this._lastStatesHash;
      let currentBuffsHash = this._lastBuffsHash;
      let currentClassChipHash = this._lastClassChipHash;
      if (needsStatusRefresh || this._statusHashCounter % 6 === 0) {
        currentStatesHash = this._battler.states().map((s) => s.id).join(",");
        currentBuffsHash = this._battler._buffs.join(",");
        // Hash the live class-gimmick chips so pins/combo/chi/etc. refresh the card.
        currentClassChipHash = "";
        if (window.BattleSystemPassiveSkills &&
            typeof window.BattleSystemPassiveSkills.getBattleChips === "function") {
          const cc = window.BattleSystemPassiveSkills.getBattleChips(this._battler);
          currentClassChipHash = cc.map((c) => c.label).join("|");
        }
        if (this._lastStatesHash !== currentStatesHash ||
            this._lastBuffsHash !== currentBuffsHash ||
            this._lastClassChipHash !== currentClassChipHash) {
          needsStatusRefresh = true;
        }
      }

      if (needsStatusRefresh) {
        this._lastIsTargeted = isTargeted;
        this.refreshSimpleStatus();
        this._lastHp = b.hp;
        this._lastMaxHp = b.mhp;
        this._lastMp = b.mp;
        this._lastMaxMp = b.mmp;
        this._lastTp = b.tp;
        this._lastStatesHash = currentStatesHash;
        this._lastBuffsHash = currentBuffsHash;
        this._lastActiveActorId = activeActorId;
        this._lastClassChipHash = currentClassChipHash;
      }
      return;
    }

    const b = this._battler;
    if (b.hp < this._lastHp) {
      this._damageChunkHp = this._displayHp;
      this._displayHp = b.hp;
      this.updateDamageOverlay();
    } else if (b.hp > this._lastHp) {
      this._displayHp = b.hp;
      this._damageChunkHp = b.hp;
      this.updateDamageOverlay();
    }

    if (this._damageChunkHp > this._displayHp) {
      this._damageChunkHp = Math.max(
        this._displayHp,
        this._damageChunkHp - b.mhp / (60 * animationSpeed)
      );
      this.updateDamageOverlay();
    }

    // Only refresh if values have changed
    if (
      b.hp !== this._lastHp ||
      b.mhp !== this._lastMaxHp ||
      b.mp !== this._lastMp ||
      b.mmp !== this._lastMaxMp ||
      b.tp !== this._lastTp
    ) {
      this.refresh();

      // Only refresh TP orb if TP has changed
      if (this._tpOrb && b.tp !== this._lastTp) {
        this.refreshTPOrb();
      }

      this._lastHp = b.hp;
      this._lastMaxHp = b.mhp;
      this._lastMp = b.mp;
      this._lastMaxMp = b.mmp;
      this._lastTp = b.tp;
    }

    // CHANGED: Check for stat changes or states for ALL characters (not just actor 1)
    if (this._statDisplay && this._battler) {
      // The states/buffs hash allocates arrays + strings; states change rarely,
      // so sample it every few frames (more sparsely on mobile) rather than every
      // frame. The interval is imperceptible for buff/debuff display.
      const statCheckInterval = (isMobileDevice || useMobileOptimization) ? 10 : 6;
      if ((this._statCheckCount = ((this._statCheckCount || 0) + 1) % statCheckInterval) === 0) {
        const statesHash = this._battler.states().map(s => s.id).sort().join(',');
        const buffsHash  = this._battler._buffs ? this._battler._buffs.join(',') : '';
        const combined   = statesHash + '|' + buffsHash;
        if (combined !== this._lastStatCheckHash) {
          this._lastStatCheckHash = combined;
          this.refreshStatDisplay();
        }
      }
    }
  };
  Sprite_BattleBar.prototype.updateGradientAnimation = function () {
    // Update gradient phase for all animations
    this._gradientPhase += 0.01 * gradientSpeed;
    if (this._gradientPhase > Math.PI * 2) {
      this._gradientPhase -= Math.PI * 2;
    }

    // Only update wave phase if not in mobile mode (for TP orb)
    if (!(isMobileDevice || useMobileOptimization)) {
      this._wavePhase += 0.02 * gradientSpeed;
      if (this._wavePhase > Math.PI * 2) {
        this._wavePhase -= Math.PI * 2;
      }
    }

    // Refresh only if values changed or it's been at least 2 frames (for performance)
    const isSimpleDisplay =
      this._isPlayer &&
      this._battler &&
      this._battler.actorId;

    this._refreshCounter = (this._refreshCounter || 0) + 1;
    // Bars/orbs only need to redraw a few times per second to look animated;
    // redrawing every other frame (30Hz) was a major source of canvas/DOM churn.
    const shouldRefreshGradient = this._refreshCounter % 4 === 0;

    // Skip the expensive redraws while the bar cannot be seen or the battler
    // is dead (dead enemy bars are hidden instantly by the scene, so there is
    // no death animation to keep feeding here).
    if (!this.visible || this.worldVisible === false) return;
    if (this._battler.isDead()) return;

    if (!isSimpleDisplay) {
      if (shouldRefreshGradient) {
        this.refresh();
        if (this._tpOrb) {
          this.refreshTPOrb();
        }
      }
    } else {
      if (this._playerTpOrb && shouldRefreshGradient) {
        this.refreshPlayerTPOrb();
      }
    }
  };

  Sprite_BattleBar.prototype.updateDamageOverlay = function () {
    const w = this.bitmap.width;
    const b = this._battler;
    const hpRate = this._displayHp / Math.max(1, b.mhp);
    const dmgRate = this._damageChunkHp / Math.max(1, b.mhp);
    this._damageOverlay.bitmap.clear();
    const ctx = this._damageOverlay.bitmap.context;
    if (this._minimalEnemy) {
      const geo = miniBarGeometry(w);
      const hpWidth = geo.w * hpRate;
      const dmgWidth = geo.w * dmgRate;
      if (dmgWidth > hpWidth) {
        ctx.fillStyle = damageColor;
        ctx.beginPath();
        ctx.moveTo(geo.x + hpWidth, 0);
        ctx.lineTo(geo.x + dmgWidth, 0);
        ctx.lineTo(geo.x + dmgWidth - MINI.ang, MINI.thickness);
        ctx.lineTo(geo.x + hpWidth - MINI.ang, MINI.thickness);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    if (this._isPlayer) {
      const dmgWidth = (w - borderThickness * 2) * dmgRate;
      const hpWidth = (w - borderThickness * 2) * hpRate;
      const dmgX = w - dmgWidth - borderThickness;
      const dmgChunkWidth = dmgWidth - hpWidth;
      if (dmgChunkWidth > 0) {
        ctx.fillStyle = damageColor;
        ctx.fillRect(dmgX, 0, dmgChunkWidth, barHeight);
      }
    } else {
      const hpWidth = (w - borderThickness * 2) * hpRate;
      const dmgWidth = (w - borderThickness * 2) * dmgRate;
      if (dmgWidth > hpWidth) {
        const chunkX = borderThickness + hpWidth;
        const chunkWidth = dmgWidth - hpWidth;
        ctx.fillStyle = damageColor;
        ctx.fillRect(chunkX, 0, chunkWidth, barHeight);
      }
    }
  };
  Sprite_BattleBar.prototype.refreshTPOrb = function () {
    if (!this._battler || !this._tpOrb) {
      return;
    }

    if (window.AsciiMode && window.AsciiMode.active) {
      this._tpOrb.visible = false;
      return;
    } else {
      this._tpOrb.visible = true;
    }

    const b = this._battler;
    let displayValue, maxValue, rate;

    // TP logic
    displayValue = Math.min(b.tp, 99);
    maxValue = 99;
    rate = displayValue / maxValue;

    const bitmap = this._tpOrb.bitmap;
    const orbSize = bitmap.width; // player and enemy orbs can differ in size
    const radius = orbSize / 2;
    const center = radius;
    const orbFont = Math.round(orbSize * 0.42);

    bitmap.clear();
    bitmap.drawCircle(center, center, radius, "#333333");
    bitmap.drawCircle(center, center, radius - 2, "#222222");
    const liquidHeight = Math.floor((orbSize - 4) * rate);

    const ctx = bitmap.context;
    const gradientFactor = (Math.sin(this._gradientPhase) + 1) / 2;

    if (liquidHeight > 0) {
      // Check if using mobile optimization
      if (isMobileDevice || useMobileOptimization) {
        // Simple block fill for mobile (much faster)
        ctx.save();
        ctx.beginPath();
        ctx.arc(center, center, radius - 2, 0, Math.PI * 2, false);
        ctx.clip();

        // Create a simple gradient
        const orbGradient = ctx.createLinearGradient(
          0,
          orbSize,
          0,
          orbSize - liquidHeight
        );
        orbGradient.addColorStop(0, tpColor1);
        orbGradient.addColorStop(1, tpColor2);

        // Draw a simple rectangle instead of wave pattern
        ctx.fillStyle = orbGradient;
        ctx.fillRect(0, orbSize - liquidHeight, orbSize, liquidHeight);
        ctx.restore();
      } else {
        // Original liquid animation for desktop
        const waveAmplitude = 3;
        const waveFrequency = 3;
        const orbGradient = ctx.createLinearGradient(
          0,
          orbSize,
          0,
          orbSize - liquidHeight
        );
        orbGradient.addColorStop(0, tpColor1);
        orbGradient.addColorStop(0.5 + gradientFactor * 0.5, tpColor2);
        orbGradient.addColorStop(1, tpColor1);

        ctx.save();
        ctx.beginPath();
        ctx.arc(center, center, radius - 2, 0, Math.PI * 2, false);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(0, orbSize);
        ctx.lineTo(0, orbSize - liquidHeight);

        // This loop is optimized to run with larger steps to save on sine evaluations
        for (let x = 0; x <= orbSize; x += 3) {
          const y =
            orbSize -
            liquidHeight +
            Math.sin(
              (x / orbSize) * Math.PI * waveFrequency + this._wavePhase
            ) *
            waveAmplitude *
            rate;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(orbSize, orbSize - liquidHeight + Math.sin(Math.PI * waveFrequency + this._wavePhase) * waveAmplitude * rate);

        ctx.lineTo(orbSize, orbSize);
        ctx.closePath();
        ctx.fillStyle = orbGradient;
        ctx.fill();
        ctx.restore();
      }
    }

    // Display the value
    bitmap.fontSize = 16;
    bitmap.textColor = "#ffffff";

    const overlay = this._tpOrb === this._playerTpOrb ? this._playerTpOrbHtmlOverlay : this._tpOrbHtmlOverlay;
    if (overlay) overlay.clear();

    if (
      this._currentSkill &&
      this._battler.skillTpCost(this._currentSkill) > 0
    ) {
      const originalTp = Math.floor(b.tp);
      const projectedTp = Math.floor(this._projectedTp);
      const textColor = projectedTp < originalTp ? "#ff9900" : "#ffffff";
      bitmap.textColor = textColor;
      if (overlay) overlay.addText(projectedTp, 0, center - Math.round(orbFont / 2), orbSize, "center", orbFont, textColor, true, "rgba(0,0,0,0.5)", 2);
    } else {
      if (overlay) overlay.addText(Math.floor(b.tp), 0, center - Math.round(orbFont / 2), orbSize, "center", orbFont, "#ffffff", true, "rgba(0,0,0,0.5)", 2);
    }

    // Add highlight effect (simplified for mobile)
    if (!(isMobileDevice || useMobileOptimization)) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const highlight = ctx.createRadialGradient(
        center - radius / 4,
        center - radius / 4,
        0,
        center - radius / 4,
        center - radius / 4,
        radius / 2
      );
      highlight.addColorStop(0, "rgba(255,255,255,0.4)");
      highlight.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.arc(
        center - radius / 4,
        center - radius / 4,
        radius / 2,
        0,
        Math.PI * 2,
        false
      );
      ctx.fill();
      ctx.restore();
    }

    bitmap._baseTexture.update();
  };

  Sprite_BattleBar.prototype.refresh = function () {
    if (!this._battler) {
      return;
    }
    const w = this.bitmap.width;
    const b = this._battler;
    const hpRate = this._displayHp / Math.max(1, b.mhp);
    this.bitmap.clear();
    if (this._htmlOverlay) this._htmlOverlay.clear();

    // ASCII Mode Rendering
    if (window.AsciiMode && window.AsciiMode.active) {
      this.bitmap.fontSize = 12;
      this.bitmap.textColor = "#ffffff";
      this.bitmap.fontFace = "monospace";
      this.bitmap.outlineWidth = 0; // No outline for ASCII look

      let y = 0;
      const lineHeight = 16;

      // Draw Name and Level
      const levelStr = b.level ? ` L.${b.level}` : "";
      const nameStr = b.name() + levelStr;
      this.bitmap.textColor = "#ffd700"; // Gold for names
      if (this._htmlOverlay) this._htmlOverlay.addText(nameStr, 0, y, w, "left", 12, "#ffd700", false, null, 0, "monospace", lineHeight);
      y += lineHeight;

      // Draw HP. A compact bar (several enemies on the field) gets a short gauge
      // so neighbouring monsters' bars do not run into each other.
      const hpCells = this._minimalEnemy ? 14 : 60;
      const gaugeCells = this._minimalEnemy ? 14 : 45;
      const hpBars = Math.floor(hpRate * hpCells);
      const hpStr = `[${'='.repeat(Math.max(0, hpBars))}${' '.repeat(Math.max(0, hpCells - hpBars))}]`;
      this.bitmap.textColor = "#ff4444"; // Red for HP
      if (this._htmlOverlay) this._htmlOverlay.addText(`HP ${hpStr} ${Math.floor(this._displayHp)}/${b.mhp}`, 0, y, w, "left", 12, "#ff4444", false, null, 0, "monospace", lineHeight);
      y += lineHeight;

      // Draw MP , unless there is no magic in this world at all, in which
      // case there is nothing to spend it on and the row is not drawn (the
      // line below it closes up, rather than leaving a gap).
      if (!hideMpBar()) {
        const mpRate = b.mp / Math.max(1, b.mmp);
        const mpBars = Math.floor(mpRate * gaugeCells);
        const mpStr = `[${'*'.repeat(Math.max(0, mpBars))}${' '.repeat(Math.max(0, gaugeCells - mpBars))}]`;
        this.bitmap.textColor = "#00ffff"; // Cyan for MP
        if (this._htmlOverlay) this._htmlOverlay.addText(`MP ${mpStr} ${b.mp}/${b.mmp}`, 0, y, w, "left", 12, "#00ffff", false, null, 0, "monospace", lineHeight);
        y += lineHeight;
      }

      // Draw TP
      const tpRate = b.tp / 100;
      const tpBars = Math.floor(tpRate * gaugeCells);
      const tpStr = `${_si18n("TP")} [${'^'.repeat(Math.max(0, tpBars))}${' '.repeat(Math.max(0, gaugeCells - tpBars))}] ${Math.floor(b.tp)}/100`;
      this.bitmap.textColor = "#00ff00"; // Green for TP
      if (!this._minimalEnemy && this._htmlOverlay) this._htmlOverlay.addText(tpStr, 0, y, w, "left", 12, "#00ff00", false, null, 0, "monospace", lineHeight);
      if (!this._minimalEnemy) y += lineHeight;

      // For enemies, draw weaknesses, states, and body parts
      if (!this._isPlayer && !this._minimalEnemy) {
        this.bitmap.fontSize = 10;

        // Elements
        let weakElements = [];
        // Check if elementIcons is defined, otherwise fallback
        const elemIcons = typeof elementIcons !== 'undefined' ? elementIcons : [];
        for (let i = 1; i < elemIcons.length; i++) {
          const rate = b.elementRate(i);
          if (rate >= 2.0 && i !== 1) {
            const rawName = $dataSystem.elements[i] || "";
            const name = window.translateText ? window.translateText(rawName) : rawName;
            const multiplier = Math.floor(rate);
            weakElements.push(`${name} x${multiplier}`);
          }
        }
        if (weakElements.length > 0) {
          this.bitmap.textColor = "#ff00ff"; // Magenta for weaknesses
          if (this._htmlOverlay) this._htmlOverlay.addText(`WEAK: ${weakElements.join(', ')}`, 0, y, w, "left", 10, "#ff00ff", false, null, 0, "monospace", lineHeight);
          y += lineHeight;
        }

        // States
        const activeStates = b.states().map(s => window.translateText ? window.translateText(s.name) : s.name);
        if (activeStates.length > 0) {
          this.bitmap.textColor = "#ffff00"; // Yellow for states
          if (this._htmlOverlay) this._htmlOverlay.addText(`STAT: ${activeStates.join(', ')}`, 0, y, w, "left", 10, "#ffff00", false, null, 0, "monospace", lineHeight);
          y += lineHeight;
        }

        // Body Parts
        if (b._bodyParts) {
          const archetype = window.Health && window.Health.EnemyArchetypes ? window.Health.EnemyArchetypes[b._archetypeName] : null;
          if (archetype) {
            let destroyedParts = [];
            for (const partKey in b._bodyParts) {
              const part = b._bodyParts[partKey];
              if (part.destroyed) {
                const basePart = archetype.parts[partKey];
                if (basePart) {
                  const partName = window.getArchetypeText ? window.getArchetypeText(basePart.name) : partKey;
                  destroyedParts.push(partName);
                }
              }
            }
            if (destroyedParts.length > 0) {
              this.bitmap.textColor = "#ff4444"; // Red for destroyed parts
              if (this._htmlOverlay) this._htmlOverlay.addText(`DMG: ${destroyedParts.join(', ')}`, 0, y, w, "left", 10, "#ff4444", false, null, 0, "monospace", lineHeight);
              y += lineHeight;
            }
          }
        }
      }

      this.bitmap._baseTexture.update();
      return;
    }

    if (this._minimalEnemy) {
      this.refreshMinimalEnemyBar();
      return;
    }

    // NEW: Animated gradient logic
    const gradientWidth = w * 1.5;
    const scrollX = w * 0.5 * Math.sin(this._gradientPhase);
    const gradientOffset = w / 2 - scrollX;

    const ctx = this.bitmap.context;
    if (this._isPlayer) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w - angleSize, barHeight);
      ctx.lineTo(0, barHeight);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = "#222";
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderThickness;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w - angleSize, barHeight);
      ctx.lineTo(0, barHeight);
      ctx.closePath();
      ctx.stroke();

      // NEW: Apply the moving gradient
      const playerGradient = ctx.createLinearGradient(
        gradientOffset - gradientWidth / 2,
        0,
        gradientOffset + gradientWidth / 2,
        0
      );
      playerGradient.addColorStop(0, playerHPColor2);
      playerGradient.addColorStop(0.5, playerHPColor1);
      playerGradient.addColorStop(1, playerHPColor2);

      const hpWidth = (w - borderThickness * 2) * hpRate;
      const hpX = w - hpWidth - borderThickness;
      if (hpWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(w - borderThickness, borderThickness);
        ctx.lineTo(
          w - borderThickness - angleSize,
          barHeight - borderThickness
        );
        ctx.lineTo(hpX, barHeight - borderThickness);
        ctx.lineTo(hpX, borderThickness);
        ctx.closePath();
        ctx.clip(); // Clip the drawing to the bar shape
        ctx.fillStyle = playerGradient;
        ctx.fillRect(0, 0, w, barHeight); // Fill the clipped area
        ctx.restore();
      }

      // Draw MP bar (skipped outright where the world has no magic in it)
      if (!hideMpBar()) {
        const mpY = barHeight + 5;
        const mpHeight = barHeight / 2;
        const mpRate = b.mp / Math.max(1, b.mmp);
        ctx.beginPath();
        ctx.moveTo(0, mpY);
        ctx.lineTo(w, mpY);
        ctx.lineTo(w - Math.floor(angleSize / 2), mpY + mpHeight);
        ctx.lineTo(0, mpY + mpHeight);
        ctx.lineTo(0, mpY);
        ctx.closePath();
        ctx.fillStyle = "#111";
        ctx.fill();

        // NEW: Apply moving gradient to MP bar
        const mpGradient = ctx.createLinearGradient(
          gradientOffset - gradientWidth / 2,
          0,
          gradientOffset + gradientWidth / 2,
          0
        );
        mpGradient.addColorStop(0, mpBarColor2);
        mpGradient.addColorStop(0.5, mpBarColor1);
        mpGradient.addColorStop(1, mpBarColor2);

        if (mpRate > 0) {
          const mpWidth = (w - 4) * mpRate;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(2, mpY + 2);
          ctx.lineTo(mpWidth + 2, mpY + 2);
          ctx.lineTo(mpWidth - Math.floor(angleSize / 3) + 2, mpY + mpHeight - 2);
          ctx.lineTo(2, mpY + mpHeight - 2);
          ctx.closePath();
          ctx.clip();
          ctx.fillStyle = mpGradient;
          ctx.fillRect(0, mpY, w, mpHeight);
          ctx.restore();

          // MP Flash logic (unchanged)
          if (this._mpFlashAmount > 0 && this._mpFlashState) {
            const mpFlashRate = this._mpFlashAmount / Math.max(1, b.mmp);
            const mpFlashWidth = (w - 4) * mpFlashRate;
            const mpFlashX = 2 + (mpWidth - mpFlashWidth);
            if (mpFlashX >= 2 && mpFlashWidth > 0) {
              ctx.save();
              ctx.globalAlpha = 0.6;
              ctx.fillStyle = "#ffffff";
              ctx.beginPath();
              ctx.moveTo(mpFlashX, mpY + 2);
              ctx.lineTo(mpFlashX + mpFlashWidth, mpY + 2);
              ctx.lineTo(
                mpFlashX + mpFlashWidth - Math.floor(angleSize / 3),
                mpY + mpHeight - 2
              );
              ctx.lineTo(mpFlashX, mpY + mpHeight - 2);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
          }
        }
      }
    } else {
      // Enemy Bar (mirrored, identical to player shape)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w - angleSize, barHeight);
      ctx.lineTo(0, barHeight);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = "#222";
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderThickness;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w - angleSize, barHeight);
      ctx.lineTo(0, barHeight);
      ctx.closePath();
      ctx.stroke();

      // Enemy HP Fill (fills right to left, matching player bar shape)
      const enemyGradient = ctx.createLinearGradient(
        gradientOffset - gradientWidth / 2,
        0,
        gradientOffset + gradientWidth / 2,
        0
      );
      enemyGradient.addColorStop(0, enemyHPColor2);
      enemyGradient.addColorStop(0.5, enemyHPColor1);
      enemyGradient.addColorStop(1, enemyHPColor2);

      const hpWidth = (w - borderThickness * 2) * hpRate;
      const hpEndX = borderThickness + hpWidth;
      if (hpWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(borderThickness, borderThickness);
        ctx.lineTo(hpEndX, borderThickness);
        ctx.lineTo(hpEndX, barHeight - borderThickness);
        ctx.lineTo(borderThickness, barHeight - borderThickness);
        ctx.closePath();
        ctx.clip();
        ctx.fillStyle = enemyGradient;
        ctx.fillRect(0, 0, w, barHeight);

        // Shine strip (top half of HP fill)
        const hiH = Math.max(1, Math.floor(barHeight / 2));
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(borderThickness, borderThickness, hpWidth, hiH);
        ctx.restore();
      }

      // Enemy MP Bar (same rule as the party's)
      if (!hideMpBar()) {
      const mpY = barHeight + 5;
      const mpHeight = barHeight / 2;
      const mpRate = b.mp / Math.max(1, b.mmp);
      ctx.beginPath();
      ctx.moveTo(0, mpY);
      ctx.lineTo(w, mpY);
      ctx.lineTo(w - Math.floor(angleSize / 2), mpY + mpHeight);
      ctx.lineTo(0, mpY + mpHeight);
      ctx.lineTo(0, mpY);
      ctx.closePath();
      ctx.fillStyle = "#111";
      ctx.fill();

      // Enemy MP Fill
      const mpGradient = ctx.createLinearGradient(
        gradientOffset - gradientWidth / 2,
        0,
        gradientOffset + gradientWidth / 2,
        0
      );
      mpGradient.addColorStop(0, mpBarColor2);
      mpGradient.addColorStop(0.5, mpBarColor1);
      mpGradient.addColorStop(1, mpBarColor2);

      if (mpRate > 0) {
        const mpWidth = (w - 4) * mpRate;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(2, mpY + 2);
        ctx.lineTo(mpWidth + 2, mpY + 2);
        ctx.lineTo(mpWidth - Math.floor(angleSize / 3) + 2, mpY + mpHeight - 2);
        ctx.lineTo(2, mpY + mpHeight - 2);
        ctx.closePath();
        ctx.clip();
        ctx.fillStyle = mpGradient;
        ctx.fillRect(0, mpY, w, mpHeight);
        
        // Shine strip (top half of MP fill)
        const mpHiH = Math.max(1, Math.floor(mpHeight / 2));
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(2, mpY + 2, mpWidth, mpHiH);
        ctx.restore();
      }
      }
    }
    this.bitmap._baseTexture.update();
    this.bitmap.textColor = "#ffffff";
    this.bitmap.fontSize = 12;
    this.bitmap.fontBold = true;
    this.bitmap.fontFace = $gameSystem.mainFontFace();
    if (this._isPlayer) {
      // Draw name with level on top line
      const actorLevel = b.level ? ` L.${b.level}` : "";
      const nameWithLevel = b.name() + actorLevel;
      this.bitmap.fontSize = 12;
      if (this._htmlOverlay) this._htmlOverlay.addText(nameWithLevel, 0, -3, w - 20, "right", 24, "#ffffff", true, "black", 1, "Lora, serif", barHeight);

    }
    else {
      const level = getEnemyLevel(b);
      const rawName = window.translateText(b.name());
      const nameText = level ? `${rawName} ${level}` : rawName;

      this.bitmap.fontSize = 12;
      this.bitmap.fontBold = true;
      this.bitmap.fontFace = $gameSystem.mainFontFace();

      const maxWidth = w - 110;
      const textWidth = this.bitmap.measureTextWidth(nameText);

      if (textWidth > maxWidth) {
        if (!this._scaledTextSprite) {
          this._scaledTextSprite = new Sprite();
          this._scaledTextSprite.bitmap = new Bitmap(textWidth + 20, barHeight);
          this.addChild(this._scaledTextSprite);
        } else if (this._scaledTextSprite.bitmap.width < textWidth + 20) {
          this._scaledTextSprite.bitmap.resize(textWidth + 20, barHeight);
        }

        // we omit PIXI text rendering logic for scaled text sprite
        if (this._lastDrawnNameText !== nameText) {
          this._lastDrawnNameText = nameText;
        }

        const scaleFactor = maxWidth / textWidth;
        this._scaledTextSprite.scale.x = scaleFactor;
        this._scaledTextSprite.scale.y = 1;
        this._scaledTextSprite.x = 15;
        this._scaledTextSprite.y = 0;
        this._scaledTextSprite.visible = true;
      } else {
        if (this._scaledTextSprite) {
          this._scaledTextSprite.visible = false;
        }
      }

      if (this._htmlOverlay) {
        // Reserve a right-hand column for the HP number so long names truncate
        // instead of colliding, sized to the number actually on screen rather
        // than to the longest one imaginable, so the name keeps the rest.
        this.bitmap.fontSize = 24;
        const hpRoom = Math.max(
          40,
          Math.ceil(this.bitmap.measureTextWidth(String(Math.floor(b.hp)))) + 16
        );
        this.bitmap.fontSize = 12;
        // Box ends where the HP number's own column begins (its right edge sits
        // at w - 60, see rightPadding below).
        const nameBoxW = Math.max(60, w - 60 - hpRoom - 15);
        const nameEl = this._htmlOverlay.addText(
          level ? `<span>${rawName}</span><span>${level}</span>` : rawName,
          15, 0, nameBoxW, "left", 24, "#ffffff", true, "black", 1, "Lora, serif", barHeight
        );
        if (nameEl) {
          nameEl.style.overflow = "hidden";
          nameEl.style.textOverflow = "ellipsis";
          if (level) {
            // The level is not part of what gets cut: the name shrinks to an
            // ellipsis on its own and "L.12" always stays beside it.
            nameEl.style.display = "flex";
            nameEl.style.alignItems = "baseline";
            nameEl.style.gap = "6px";
            const nameSpan = nameEl.children[0];
            const lvSpan = nameEl.children[1];
            nameSpan.style.cssText =
              "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
            lvSpan.style.cssText = "flex:0 0 auto;";
          }
        }
      }
    }

    // HP numbers right-aligned on HP bar
    const hpBarRate = b.hp / Math.max(1, b.mhp);
    let hpNumColor = "#ffffff";
    if (hpBarRate <= 0.25) hpNumColor = "#ff4444";
    else if (hpBarRate <= 0.5) hpNumColor = "#ffff00";
    this.bitmap.fontSize = 12;
    this.bitmap.fontBold = true;
    this.bitmap.outlineColor = "black";
    this.bitmap.outlineWidth = 2;
    this.bitmap.textColor = hpNumColor;

    const rightPadding = this._isPlayer ? 5 : 60;
    if (this._htmlOverlay) this._htmlOverlay.addText(`${Math.floor(b.hp)}`, 0, 0, w - rightPadding, "right", 24, hpNumColor, true, "black", 1, "Lora, serif", barHeight);

    // MP numbers right-aligned on MP bar (players only)
    const mpNumBarY = barHeight + 5;
    const mpNumH = Math.floor(barHeight / 2);
    this.bitmap.fontSize = 10;
    this.bitmap.fontBold = false;
    this.bitmap.textColor = mpBarColor1;
    if (this._isPlayer && this._htmlOverlay) this._htmlOverlay.addText(`${Math.floor(b.mp)}`, 0, mpNumBarY - 2, w - rightPadding, "right", 20, mpBarColor1, true, null, 0, "Lora, serif", mpNumH);

    // Draw elemental weaknesses and states for enemies
    if (!this._isPlayer) {
      let weakX = 15;
      let weakY = barHeight + 18;
      const targetSize = 16;
      // Measure at the HTML render size (targetSize + 4) so element widths
      // line up and adjacent weaknesses never overlap.
      this.bitmap.fontSize = targetSize + 4;
      this.bitmap.fontBold = true;
      this.bitmap.outlineColor = "black";
      this.bitmap.outlineWidth = 2;

      const iconBitmap = ImageManager.loadSystem("IconSet");
      const pw = ImageManager.iconWidth;
      const ph = ImageManager.iconHeight;

      // 1. Elements
      let drewElement = false;
      for (let i = 1; i < elementIcons.length; i++) {
        const rate = b.elementRate(i);
        if (rate >= 2.0) {
          // Skip physical icon (element 1)
          if (i === 1) continue;

          const iconIndex = elementIcons[i];
          const rawName = $dataSystem.elements[i] || "";
          const name = window.translateText(rawName);
          const multiplier = Math.floor(rate);
          const text = `${name} ${multiplier}x`;

          const sx = (iconIndex % 16) * pw;
          const sy = Math.floor(iconIndex / 16) * ph;

          this.bitmap.blt(iconBitmap, sx, sy, pw, ph, weakX, weakY + 2, targetSize, targetSize);

          // Draw Text
          this.bitmap.textColor = "#ffffff";
          if (this._htmlOverlay) this._htmlOverlay.addText(text, weakX + targetSize + 4, weakY - 4, 120, "left", 20, "#ffffff", true, "black", 1, "Lora, serif", targetSize + 4);

          weakX += this.bitmap.measureTextWidth(text) + targetSize + 30;
          drewElement = true;

          if (weakX > w - 60) {
            weakX = 15;
            weakY += targetSize + 4;
          }
        }
      }

      // 2. States, all on a single horizontal line.
      // Start on a fresh line below any weaknesses so the two never overlap.
      const activeStates = b.states().filter(s => s.iconIndex > 0);
      if (activeStates.length > 0) {
        weakX = 15;
        weakY += drewElement ? targetSize + 6 : 2;
        this.bitmap.fontSize = 20; // match the HTML render size so widths line up
        for (const state of activeStates) {
          const stateName = window.translateText ? window.translateText(state.name) : state.name;
          const iconIndex = state.iconIndex;
          const sx = (iconIndex % 16) * pw;
          const sy = Math.floor(iconIndex / 16) * ph;
          this.bitmap.blt(iconBitmap, sx, sy, pw, ph, weakX, weakY + 2, targetSize, targetSize);
          const stateColor = getStateHexColor(state) || "#ffffff";
          this.bitmap.textColor = stateColor;
          if (this._htmlOverlay) this._htmlOverlay.addText(stateName, weakX + targetSize + 4, weakY - 4, 200, "left", 20, stateColor, true, "black", 1, "Lora, serif", targetSize + 4);
          // Advance horizontally so the next state sits beside this one
          weakX += targetSize + 8 + this.bitmap.measureTextWidth(stateName) + 16;
        }
        weakY += targetSize + 6;
      }
      // 3. Destroyed Body Parts
      if (b._bodyParts) {
        const archetype = window.Health && window.Health.EnemyArchetypes ? window.Health.EnemyArchetypes[b._archetypeName] : null;
        if (archetype) {
          // Always start body parts on a new line with extra padding 
          // to leave room for elements and statuses
          weakX = 15;
          weakY += (targetSize + 6);

          for (const partKey in b._bodyParts) {
            const part = b._bodyParts[partKey];
            if (part.destroyed) {
              const basePart = archetype.parts[partKey];
              if (!basePart) continue;

              const partName = window.getArchetypeText(basePart.name) || partKey;

              // Get stat effect string
              let effectStr = "";
              if (basePart.statEffect) {
                const paramId = basePart.statEffect.param;
                const amount = basePart.statEffect.amount;
                // Use consistent stat names
                const paramNames = [
                  _si18n("HP"),
                  _si18n("MP"),
                  _si18n("STR"),
                  _si18n("CON"),
                  _si18n("INT"),
                  _si18n("WIS"),
                  _si18n("DEX"),
                  _si18n("PSI")
                ];
                const paramName = paramNames[paramId] || "";
                const multiplier = (1 + amount / 100).toFixed(1);
                effectStr = ` (${paramName} ${multiplier}x)`;
              }

              this.bitmap.textColor = "#ff4444"; // Red for destroyed parts
              this.bitmap.fontSize = 11;
              const displayText = "X " + partName + effectStr;
              if (this._htmlOverlay) this._htmlOverlay.addText(displayText, weakX, weakY - 4, w - 30, "left", 20, "#ff4444", true, "black", 1, "Lora, serif", targetSize + 4);

              weakY += targetSize + 4;

              // Ensure we don't go out of bounds
              if (weakY > this.bitmap.height - 20) break;
            }
          }
        }
      }
    }
  };
  // Compact enemy bar: the same angled HP/MP pair the party cards carry, plus
  // the name, the level and the status chips. No weakness table, no severed
  // limbs, no TP orb: with a whole troop on screen those lists covered the
  // monsters they described.
  Sprite_BattleBar.prototype.refreshMinimalEnemyBar = function () {
    const b = this._battler;
    const bitmap = this.bitmap;
    const ctx = bitmap.context;
    const W = bitmap.width;
    const geo = miniBarGeometry(W);

    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const hpRate = clamp01(this._displayHp / Math.max(1, b.mhp));
    const chunkRate = clamp01(
      (this._damageChunkHp !== undefined ? this._damageChunkHp : b.hp) /
        Math.max(1, b.mhp)
    );

    const drawGauge = (y, rate, color, bright, dark, track) => {
      const ang = MINI.ang;
      const h = MINI.thickness;
      const fillW = Math.round(geo.w * clamp01(rate));
      ctx.fillStyle = track;
      ctx.beginPath();
      ctx.moveTo(geo.x, y);
      ctx.lineTo(geo.x + geo.w, y);
      ctx.lineTo(geo.x + geo.w - ang, y + h);
      ctx.lineTo(geo.x - ang, y + h);
      ctx.closePath();
      ctx.fill();
      if (fillW > 0) {
        const grad = ctx.createLinearGradient(geo.x, 0, geo.x + geo.w, 0);
        grad.addColorStop(0, dark);
        grad.addColorStop(0.3, color);
        grad.addColorStop(0.65, bright);
        grad.addColorStop(1, dark);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(geo.x, y);
        ctx.lineTo(geo.x + fillW, y);
        ctx.lineTo(geo.x + fillW - ang, y + h);
        ctx.lineTo(geo.x - ang, y + h);
        ctx.closePath();
        ctx.fill();
        const hiH = Math.max(1, Math.floor(h / 2));
        const hiAng = Math.floor(ang / 2);
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(geo.x, y);
        ctx.lineTo(geo.x + fillW, y);
        ctx.lineTo(geo.x + fillW - hiAng, y + hiH);
        ctx.lineTo(geo.x - hiAng, y + hiH);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(geo.x, y);
      ctx.lineTo(geo.x + geo.w, y);
      ctx.lineTo(geo.x + geo.w - ang, y + h);
      ctx.lineTo(geo.x - ang, y + h);
      ctx.closePath();
      ctx.stroke();
    };

    drawGauge(MINI.hpY, hpRate, "#ff3333", "#ff8888", "#660000", "rgba(100,0,0,0.45)");
    const hasMp = b.mmp > 0;
    if (hasMp) {
      drawGauge(
        MINI.mpY,
        b.mp / Math.max(1, b.mmp),
        "#3399ff",
        "#88ccff",
        "#003388",
        "rgba(0,30,80,0.45)"
      );
    }
    bitmap._baseTexture.update();

    // Depletion chunk rides on the overlay sprite, as it does on the big bar
    // (absent on the very first draw, which runs before the overlay is created)
    if (this._damageOverlay && chunkRate > hpRate) this.updateDamageOverlay();

    const isTargeted = !!(
      SceneManager._scene &&
      SceneManager._scene._enemyWindow &&
      SceneManager._scene._enemyWindow.active &&
      b.isSelected()
    );

    const level = getEnemyLevel(b);
    const rawName = window.translateText ? window.translateText(b.name()) : b.name();
    const liveRate = b.hp / Math.max(1, b.mhp);
    let hpNumColor = isTargeted ? "#ffd700" : "#ffffff";
    if (!isTargeted) {
      if (liveRate <= 0.25) hpNumColor = "#ff4444";
      else if (liveRate <= 0.5) hpNumColor = "#ffff00";
    }

    if (this._htmlOverlay) {
      // The name runs up to the HP number's column, which is only as wide as
      // the number standing in it.
      bitmap.fontSize = 16;
      const hpRoom = Math.max(
        30,
        Math.ceil(bitmap.measureTextWidth(String(Math.floor(b.hp)))) + 12
      );
      const nameBoxW = Math.max(40, geo.w + MINI.ang - hpRoom);
      const nameEl = this._htmlOverlay.addText(
        level ? `<span>${rawName}</span><span>${level}</span>` : rawName,
        geo.x - MINI.ang,
        -2,
        nameBoxW,
        "left",
        15,
        isTargeted ? "#ffd700" : "#ffffff",
        true,
        "black",
        1,
        "Lora, serif",
        MINI.nameH
      );
      if (nameEl) {
        nameEl.style.overflow = "hidden";
        nameEl.style.textOverflow = "ellipsis";
        if (level) {
          // Only the name is allowed to shorten; the level tag always shows.
          nameEl.style.display = "flex";
          nameEl.style.alignItems = "baseline";
          nameEl.style.gap = "5px";
          nameEl.children[0].style.cssText =
            "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
          nameEl.children[1].style.cssText = "flex:0 0 auto;";
        }
      }
      this._htmlOverlay.addText(
        String(Math.floor(b.hp)),
        geo.x,
        -2,
        geo.w,
        "right",
        16,
        hpNumColor,
        true,
        "black",
        1,
        "Lora, serif",
        MINI.nameH
      );

      // Status chips, styled like the party cards' and wrapped to two rows
      const activeStates = b.states().filter((s) => s.iconIndex > 0);
      if (activeStates.length > 0) {
        const chipFont = 11;
        const chipPadX = 6;
        const chipH = 16;
        const rowStartX = geo.x - MINI.ang;
        const rowMaxX = geo.x + geo.w;
        let rowX = rowStartX;
        const rowY = hasMp ? MINI.chipY : MINI.mpY;
        bitmap.fontSize = chipFont;
        bitmap.fontBold = true;
        for (const state of activeStates) {
          const sName = window.translateText ? window.translateText(state.name) : state.name;
          const chipW = Math.ceil(bitmap.measureTextWidth(sName)) + chipPadX * 2;
          // One row only: the rest of the ailments stay on the Check screen
          if (rowX > rowStartX && rowX + chipW > rowMaxX) break;
          const isDebuff = state.restriction && state.restriction > 0;
          const hex = getStateHexColor(state);
          const textColor = hex || (isDebuff ? "#ffd0d0" : "#ffe9c2");
          const edgeColor = hex || (isDebuff ? "rgba(255,150,150,0.6)" : "rgba(255,214,150,0.6)");
          const el = this._htmlOverlay.addText(
            sName,
            rowX,
            rowY,
            chipW,
            "center",
            chipFont,
            textColor,
            true,
            null,
            0,
            "Lora, serif",
            chipH - 2
          );
          if (el) {
            el.style.boxSizing = "border-box";
            el.style.height = chipH + "px";
            el.style.padding = "0 " + chipPadX + "px";
            el.style.background = isDebuff
              ? "linear-gradient(180deg, rgba(80,24,24,0.92), rgba(45,12,12,0.92))"
              : "linear-gradient(180deg, rgba(70,48,20,0.92), rgba(40,26,10,0.92))";
            el.style.border = "1px solid " + edgeColor;
            el.style.borderRadius = chipH / 2 + "px";
            el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.6)";
          }
          rowX += chipW + 4;
        }
      }
    }
  };

  // Where the compact bars stand: one column in the top-right corner, the same
  // corner the large single-enemy bar occupies, in troop order. The step is
  // squeezed when a big troop would otherwise run off the bottom of the screen.
  function layoutMinimalEnemyBars(sprites) {
    if (!sprites || sprites.length === 0) return;
    const w = sprites[0].bitmap ? sprites[0].bitmap.width : miniBarWidth;
    const x = Math.round(Math.max(4, Graphics.width - w - miniBarRightMargin));
    const room =
      Graphics.height - miniBarColumnTop - miniBarColumnBottom - miniBarBitmapHeight;
    const step =
      sprites.length > 1
        ? Math.min(miniBarStackStep, Math.max(28, room / (sprites.length - 1)))
        : miniBarStackStep;
    for (let i = 0; i < sprites.length; i++) {
      sprites[i].x = x;
      sprites[i].y = Math.round(miniBarColumnTop + i * step);
    }
  }

  // ==========================================================================
  // Target chevron
  // ==========================================================================
  // Which monster an action lands on is shown on the monster: a gold chevron
  // riding over its head, bobbing so it is never mistaken for scenery. The
  // engine's own picker was a box of names drawn across the middle of the
  // field, covering the very creatures it was naming. That window still exists
  // and still reads the input (every plugin that borrows it - the Check/Aim
  // menus, the card system - keeps working), but nothing of it is drawn.
  const CHEVRON_W = 34;
  const CHEVRON_H = 24;
  const CHEVRON_GAP = 12; // clear air between the chevron's tip and the head
  const CHEVRON_BOB = 5; // how far it rides up and down
  const CHEVRON_PERIOD = 22; // frames per bob
  const CHEVRON_COLOR = "#ffd700"; // the gold a targeted monster's name takes

  function makeChevronBitmap() {
    const bmp = new Bitmap(CHEVRON_W, CHEVRON_H + 4);
    const ctx = bmp.context;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(3, 4);
    ctx.lineTo(CHEVRON_W - 3, 4);
    ctx.lineTo(CHEVRON_W / 2, CHEVRON_H);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.stroke();
    ctx.fillStyle = CHEVRON_COLOR;
    ctx.fill();
    ctx.restore();
    bmp._baseTexture.update();
    return bmp;
  }

  Scene_Battle.prototype.createTargetChevron = function () {
    this._targetChevron = new Sprite(makeChevronBitmap());
    this._targetChevron.anchor.x = 0.5;
    this._targetChevron.anchor.y = 1; // the tip sits on the sprite's own y
    this._targetChevron.visible = false;
    this._targetChevronPhase = 0;
    this.addChild(this._targetChevron);
  };

  Scene_Battle.prototype.updateTargetChevron = function () {
    const chevron = this._targetChevron;
    if (!chevron) return;
    const win = this._enemyWindow;
    const picking = win && win.active && win.visible && win.isOpen();
    const enemy = picking ? win.enemy() : null;
    if (!enemy || !enemy.isAlive()) {
      chevron.visible = false;
      return;
    }
    const head = battlerHeadPosition(enemy);
    if (!head) {
      chevron.visible = false;
      return;
    }
    this._targetChevronPhase += 1;
    const bob = Math.sin(this._targetChevronPhase / CHEVRON_PERIOD) * CHEVRON_BOB;
    chevron.x = Math.round(head.x);
    chevron.y = Math.round(
      Math.max(chevron.height + 2, head.y - CHEVRON_GAP + bob)
    );
    chevron.visible = true;
  };

  const _Window_BattleEnemy_initialize = Window_BattleEnemy.prototype.initialize;
  Window_BattleEnemy.prototype.initialize = function (rect) {
    _Window_BattleEnemy_initialize.call(this, rect);
    // Kept alive for input, drawn not at all: frame, background, names and
    // cursor all go, leaving the chevron to say who is being aimed at.
    this.opacity = 0;
    this.contentsOpacity = 0;
    this.cursorVisible = false;
  };

  // ==========================================================================
  // Enemy target buttons: with 2+ living candidates the chevron says who is
  // aimed at, but a plain Attack leaves the actor's own command list standing
  // (the engine's default startEnemySelection never hides it, unlike Skill
  // and Item) - a frozen Attack/Defense/... list nothing can be done with
  // while a target is being chosen. That footprint is put to use instead: one
  // named row per candidate, replacing whatever command list sat there,
  // clickable to confirm the target. Hooked on Window_BattleEnemy itself, so
  // every caller that opens it (the ordinary attack/skill/item target,
  // Check/Aim in Health_Monsters, the card system) gets it for free, the same
  // way they already get the chevron (section 15b/7).
  // ==========================================================================
  const ENEMY_TARGET_ROW_H = 40;

  function _enemyTargetRoot() {
    let root = document.getElementById('html-enemytarget-overlay');
    if (!root) {
      root = document.createElement('div');
      root.id = 'html-enemytarget-overlay';
      root.style.cssText =
        'position:fixed;display:none;z-index:351;pointer-events:auto;' +
        'flex-direction:column;transform-origin:top left;';
      document.body.appendChild(root);
    }
    return root;
  }

  // The rect the actor's own command list occupies, in game pixels: the
  // footprint the name rows take over while a target is being chosen.
  function _enemyTargetSlot() {
    const scene = SceneManager._scene;
    const cmdWin = scene && scene._actorCommandWindow;
    if (!cmdWin) return null;
    let pt;
    if (typeof cmdWin.getGlobalPosition === 'function') {
      pt = cmdWin.getGlobalPosition();
    } else {
      pt = { x: cmdWin.x, y: cmdWin.y };
      let node = cmdWin.parent;
      while (node) { pt.x += node.x || 0; pt.y += node.y || 0; node = node.parent; }
    }
    const pad = cmdWin.padding || 0;
    return {
      x: pt.x + pad,
      bottom: pt.y + pad + (cmdWin.innerHeight != null ? cmdWin.innerHeight : (cmdWin.height - pad * 2)),
      w: cmdWin.innerWidth != null ? cmdWin.innerWidth : (cmdWin.width - pad * 2)
    };
  }

  function _buildEnemyTargetRows(win, slot) {
    const root = _enemyTargetRoot();
    root.innerHTML = '';
    const enemies = win._enemies || [];
    const sel = win.index();

    enemies.forEach((enemy, i) => {
      const isSel = i === sel;
      const item = document.createElement('div');
      item.className = 'actorcmd-item';
      item.style.width = slot.w + 'px';
      item.style.height = ENEMY_TARGET_ROW_H + 'px';
      item.style.cursor = 'pointer';

      const darkBase = document.createElement('div');
      darkBase.className = 'actorcmd-darkbase';
      item.appendChild(darkBase);

      const grad = document.createElement('div');
      grad.className = 'actorcmd-gradient';
      const a0 = isSel ? 0.88 : 0.60;
      const a1 = isSel ? 0.32 : 0.18;
      grad.style.background =
        `linear-gradient(to right, rgba(180,25,25,${a0}) 0%, rgba(180,25,25,${a1}) 55%, transparent 100%)`;
      item.appendChild(grad);

      const stripe = document.createElement('div');
      stripe.className = 'actorcmd-stripe' + (isSel ? ' sel' : '');
      stripe.style.background = CHEVRON_COLOR;
      stripe.style.color = CHEVRON_COLOR;
      item.appendChild(stripe);

      if (isSel) {
        const hl = document.createElement('div');
        hl.className = 'actorcmd-top-hl';
        item.appendChild(hl);
      }

      const sep = document.createElement('div');
      sep.className = 'actorcmd-sep';
      sep.style.background = isSel ? CHEVRON_COLOR : 'rgba(255,255,255,0.09)';
      item.appendChild(sep);

      const label = document.createElement('div');
      label.className = 'actorcmd-label';
      label.style.fontSize = '16px';
      label.style.marginLeft = '14px';
      const rawName = enemy.name();
      label.textContent = window.translateText ? window.translateText(rawName) : rawName;
      item.appendChild(label);

      // Hover moves the pick (and the chevron with it); the click confirms it,
      // the same two-step the party card touch-target already offers actors.
      item.addEventListener('mouseenter', () => {
        if (win.active && win.index() !== i) win.select(i);
      });
      item.addEventListener('pointerup', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (!win.active) return;
        win.select(i);
        win.processOk();
      });

      root.appendChild(item);
    });
  }

  // Hide/restore the actor command list around the picker's own lifetime,
  // remembering whatever visibility it already had (Attack leaves it
  // visible-but-frozen, Skill/Item already hid it before the picker opened)
  // so leaving the picker never shows a command list that was not there to
  // begin with.
  const _Window_BattleEnemy_show = Window_BattleEnemy.prototype.show;
  Window_BattleEnemy.prototype.show = function () {
    _Window_BattleEnemy_show.call(this);
    const scene = SceneManager._scene;
    const cmdWin = scene && scene._actorCommandWindow;
    if (cmdWin) {
      this._enemyTargetSavedCmdVisible = cmdWin.visible;
      cmdWin.hide();
    }
    this._enemyTargetLastIdx = null;
    this._enemyTargetLastCount = null;
  };

  const _Window_BattleEnemy_hide = Window_BattleEnemy.prototype.hide;
  Window_BattleEnemy.prototype.hide = function () {
    _Window_BattleEnemy_hide.call(this);
    const scene = SceneManager._scene;
    const cmdWin = scene && scene._actorCommandWindow;
    if (cmdWin && this._enemyTargetSavedCmdVisible) {
      cmdWin.show();
    }
    this._enemyTargetSavedCmdVisible = null;
    const root = document.getElementById('html-enemytarget-overlay');
    if (root) root.style.display = 'none';
  };

  Scene_Battle.prototype.updateEnemyTargetButtons = function () {
    const win = this._enemyWindow;
    const root = document.getElementById('html-enemytarget-overlay');
    const active = win && win.visible && win.isOpen && win.isOpen();
    if (!active) {
      if (root) root.style.display = 'none';
      return;
    }
    const enemies = win._enemies || [];
    const idx = win.index();
    if (
      root && root.style.display !== 'none' &&
      win._enemyTargetLastIdx === idx && win._enemyTargetLastCount === enemies.length
    ) {
      return; // nothing changed since the last frame
    }
    const slot = _enemyTargetSlot();
    if (!slot || enemies.length === 0) {
      if (root) root.style.display = 'none';
      return;
    }
    win._enemyTargetLastIdx = idx;
    win._enemyTargetLastCount = enemies.length;

    _buildEnemyTargetRows(win, slot);
    const listRoot = _enemyTargetRoot();
    const sc = _hudGetScale();
    const top = slot.bottom - enemies.length * ENEMY_TARGET_ROW_H;
    listRoot.style.display = 'flex';
    listRoot.style.left = (sc.ox + slot.x * sc.sx) + 'px';
    listRoot.style.top = (sc.oy + top * sc.sy) + 'px';
    listRoot.style.transform = `scale(${sc.sx}, ${sc.sy})`;
  };

  const _Window_SkillList_drawSkillCost =
    Window_SkillList.prototype.drawSkillCost;
  Window_SkillList.prototype.drawSkillCost = function (skill, x, y, width) {
    if (this._actor.skillTpCost(skill) > 0) {
      const tpCost = this._actor.skillTpCost(skill);
      const hasEnoughTp = this._actor.tp >= tpCost;
      if (hasEnoughTp) {
        this.changeTextColor(tpSkillColor);
      } else {
        this.changeTextColor("#888888");
      }
      this.drawText(tpCost, x, y, width, "right");
    } else if (this._actor.skillMpCost(skill) > 0) {
      const mpCost = this._actor.skillMpCost(skill);
      const hasEnoughMp = this._actor.mp >= mpCost;
      if (hasEnoughMp) {
        this.changeTextColor(mpSkillColor);
      } else {
        this.changeTextColor("#888888");
      }
      this.drawText(mpCost, x, y, width, "right");
    }
  };
  Window_SkillList.prototype.isSkillUsable = function (skill) {
    return this._actor && this._actor.canUse(skill);
  };
  const _Window_SkillList_refresh = Window_SkillList.prototype.refresh;
  Window_SkillList.prototype.refresh = function () {
    this._lastMp = this._actor ? this._actor.mp : null;
    this._lastTp = this._actor ? this._actor.tp : null;
    _Window_SkillList_refresh.call(this);
  };
  const _Window_SkillList_update = Window_SkillList.prototype.update;
  Window_SkillList.prototype.update = function () {
    _Window_SkillList_update.call(this);
    if (this._actor) {
      if (this._actor.mp !== this._lastMp || this._actor.tp !== this._lastTp) {
        this.refresh();
      }
    }
  };
  const _Window_SkillList_select = Window_SkillList.prototype.select;
  Window_SkillList.prototype.select = function (index) {
    _Window_SkillList_select.call(this, index);
    this.updateTPProjection();
  };
  Window_SkillList.prototype.updateTPProjection = function () {
    if (!this._actor || !this.active) {
      return;
    }
    const skill = this.item();
    const scene = SceneManager._scene;
    if (scene instanceof Scene_Battle && scene._battleHealthBarSprites) {
      for (const sprite of scene._battleHealthBarSprites) {
        if (sprite && sprite._battler === this._actor) {
          sprite.setCurrentSkill(skill);
          if (skill) {
            const mpCost = this._actor.skillMpCost(skill);
            sprite.setMpFlashAmount(mpCost);
          } else {
            sprite.setMpFlashAmount(0);
          }
          break;
        }
      }
    }
  };
  const _Window_SkillList_deactivate = Window_SkillList.prototype.deactivate;
  Window_SkillList.prototype.deactivate = function () {
    _Window_SkillList_deactivate.call(this);
    const scene = SceneManager._scene;
    if (scene instanceof Scene_Battle && scene._battleHealthBarSprites) {
      for (const sprite of scene._battleHealthBarSprites) {
        if (sprite && sprite._battler === this._actor) {
          sprite.setCurrentSkill(null);
          sprite.setMpFlashAmount(0);
          break;
        }
      }
    }
  };
  Window_Selectable.prototype.drawItemBackground = function (index) { };
  const _Window_SkillList_drawItem = Window_SkillList.prototype.drawItem;
  Window_SkillList.prototype.drawItem = function (index) {
    if (this._actor) {
      const skill = this._data[index];
      if (skill) {
        const rect = this.itemLineRect(index);
        const costWidth = this.costWidth();
        const skillName = this._actor.canUse(skill) ? skill.name : skill.name;
        this.changePaintOpacity(this._actor.canUse(skill));
        this.drawItemName(skill, rect.x, rect.y, rect.width - costWidth);
        this.drawSkillCost(skill, rect.x, rect.y, rect.width);
        this.changePaintOpacity(true);
      }
    }
  };
  const _Window_ItemList_drawItem = Window_ItemList.prototype.drawItem;
  Window_ItemList.prototype.drawItem = function (index) {
    const item = this._data[index];
    if (item) {
      const rect = this.itemLineRect(index);
      const nameWidth = rect.width;
      this.changePaintOpacity(this.isEnabled(item));
      this.drawItemName(item, rect.x, rect.y, nameWidth);
      this.changePaintOpacity(true);
    }
  };
  // Create a method to get status effects
  Sprite_BattleBar.prototype.getStatusEffects = function () {
    if (!this._battler) return [];
    return this._battler.states().map((state) => state.name);
  };

  const _Scene_Battle_createDisplayObjects =
    Scene_Battle.prototype.createDisplayObjects;
  Scene_Battle.prototype.createDisplayObjects = function () {
    _Scene_Battle_createDisplayObjects.call(this);
    this.createBattleHealthBars();
    // After the window layer, so the marker rides over the field rather than
    // under whatever window happens to be open.
    this.createTargetChevron();
  };
  Scene_Battle.prototype.createBattleHealthBars = function () {
    this._battleHealthBarSprites = [];
    const partyMembers = $gameParty.battleMembers();
    const positions = getResponsiveBarPositions();
    
    const PCARD_W = 200;
    const PCARD_H = 110; // bitmap height (kept so internal draw offsets stay valid)
    const PCARD_GAP = -14; // stack step ~96px: spaced enough to clear the MP-bar stat row
    const PCARD_STEP = PCARD_H + PCARD_GAP; // vertical distance between stacked cards
    const PCARD_COL_LEFT = 90; // leaves a left margin for the per-member sprite
    // Anchor the active party column to the top of the screen
    const PCARD_COL_TOP = 18; // y of the top edge of the highest active card
    // sprite.y is the BOTTOM edge of a card, so the first card's anchor sits one card-height down
    const activeFirstBottomY = PCARD_COL_TOP + PCARD_H;

    // Create Player Bars - vertical column on the top-left
    const numActive = partyMembers.length;
    // Bottom anchor of the lowest active card; inactive cards stack below it
    const activeLastBottomY = activeFirstBottomY + (numActive - 1) * PCARD_STEP;

    for (let i = 0; i < partyMembers.length; i += 1) {
      const actor = partyMembers[i];
      const sprite = new Sprite_BattleBar(actor, true, PCARD_W, PCARD_H);

      // anchor is bottom of card; content left edge = sprite.x - playerBarX
      sprite.x = PCARD_COL_LEFT + playerBarX;
      sprite.y = activeFirstBottomY + i * PCARD_STEP;
      sprite._targetY = sprite.y;

      const cardTopY = sprite.y - PCARD_H;
      sprite.updateStatDisplayPosition(
        sprite.x + PCARD_W + 10,
        cardTopY + Math.floor(PCARD_H / 2) - 15
      );

      this.addChild(sprite);
      this._battleHealthBarSprites.push(sprite);
    }

    // Inactive party members stack downward below the active block so they stay on-screen
    const activeMemberIds = new Set(partyMembers.map(a => a.actorId()));
    const inactiveMembers = $gameParty.members().filter(a => !activeMemberIds.has(a.actorId()));
    for (let i = 0; i < inactiveMembers.length; i++) {
      const actor = inactiveMembers[i];
      const sprite = new Sprite_BattleBar(actor, true, PCARD_W, PCARD_H, true);
      sprite.x = PCARD_COL_LEFT + playerBarX;
      sprite.y = activeLastBottomY + (i + 1) * PCARD_STEP;
      sprite._targetY = sprite.y;

      const cardTopY = sprite.y - PCARD_H;
      sprite.updateStatDisplayPosition(
        sprite.x + PCARD_W + 10,
        cardTopY + Math.floor(PCARD_H / 2) - 15
      );

      this.addChild(sprite);
      this._battleHealthBarSprites.push(sprite);
    }

    // Enemy bars, all in the top-right corner. A single monster keeps the large
    // bar with its weaknesses and severed parts; a troop gets one compact bar
    // each, stacked in the same corner rather than scattered over the field.
    const troop = $gameTroop.members();
    const minimalEnemyBars = troop.length > 1;
    const enemyBarW = minimalEnemyBars ? miniBarWidth : enemyLargeBarWidth || 400;
    const enemyRightMargin = 40;
    const enemyBarLeftX = Graphics.width - enemyBarW - enemyRightMargin;
    const miniBars = [];
    for (let i = 0; i < troop.length; i += 1) {
      const enemy = troop[i];
      if (enemy.isAlive()) {
        const sprite = new Sprite_BattleBar(enemy, false, enemyBarW);
        if (sprite._minimalEnemy) {
          miniBars.push(sprite);
        } else {
          sprite.x = enemyBarLeftX;
          sprite.y = positions.barsY + i * barSpacing;
        }
        this.addChild(sprite);
        this._battleHealthBarSprites.push(sprite);
      }
    }
    layoutMinimalEnemyBars(miniBars);
  };





  Scene_Battle.prototype.createEnemyHPSprite = function (enemy) {
    const sprite = new Sprite();
    sprite._enemy = enemy;
    sprite._lastHp = enemy.hp;

    sprite.bitmap = new Bitmap(200, 30);

    // Position under the enemy battler with resolution awareness
    const enemySprite = this._spriteset._enemySprites.find(s => s._battler === enemy);
    if (enemySprite) {
      sprite.x = enemySprite.x - 100;
      sprite.y = enemySprite.y + enemySprite.height / 2 - 200;
    }

    sprite._htmlOverlay = new HtmlTextOverlay(sprite);

    sprite.destroy = function (options) {
      if (this._htmlOverlay) this._htmlOverlay.destroy();
      Sprite.prototype.destroy.call(this, options);
    };

    sprite.update = function () {
      Sprite.prototype.update.call(this);
      if (this._htmlOverlay) this._htmlOverlay.update();

      if (!this._enemy || !this._enemy.isAlive()) {
        this.visible = false;
        return;
      }

      if (this._enemy.hp !== this._lastHp) {
        this.refreshHP();
        this._lastHp = this._enemy.hp;
      }
    };

    sprite.refreshHP = function () {
      this.bitmap.clear();
      if (this._htmlOverlay) this._htmlOverlay.clear();

      const hp = this._enemy.hp;
      const maxHp = this._enemy.mhp;
      const hpRate = hp / Math.max(1, maxHp);

      let color = "#ffffff";
      if (hpRate <= 0.25) color = "#ff4444";
      else if (hpRate <= 0.5) color = "#ffff00";
      else if (hpRate <= 0.75) color = "#ffaa00";

      if (this._htmlOverlay) this._htmlOverlay.addText(`${hp}`, 0, 0, 200, "center", 20, color, true, "black", 1, "Lora, serif", 30);
    };

    sprite.refreshHP();
    return sprite;
  };

  const _Scene_Battle_update = Scene_Battle.prototype.update;
  Scene_Battle.prototype.update = function () {
    _Scene_Battle_update.call(this);
    this.updateBattleHealthBars();
    this.updateTargetChevron();
    this.updateEnemyTargetButtons();
  };
  Scene_Battle.prototype.updateBattleHealthBars = function () {
    // Determine whose turn it is (inputting or executing)
    const activeActor = BattleManager._currentActor ||
      (BattleManager._subject && BattleManager._subject.isActor() ? BattleManager._subject : null);

    for (const sprite of this._battleHealthBarSprites) {
      if (sprite && sprite._battler) {
        if (sprite._isPlayer) {
          sprite.visible = true;
          // Inactive player cards have completely transparent backgrounds
          if (sprite._solidBackground) sprite._solidBackground.visible = false;
          if (sprite._backgroundPattern) sprite._backgroundPattern.visible = false;
          if (sprite._backgroundOverlay) sprite._backgroundOverlay.visible = false;
        } else {
          sprite.visible = sprite._battler.isAlive();
        }
      }
    }

    // The compact bars are a column, so a monster that falls leaves a gap in it:
    // re-stack them whenever the standing troop changes, and not otherwise (the
    // column is static, and re-laying it out every frame is pure churn).
    const miniBars = this._battleHealthBarSprites.filter(
      (s) => s && s.visible && s._minimalEnemy
    );
    if (miniBars.length !== this._miniBarColumnCount) {
      this._miniBarColumnCount = miniBars.length;
      layoutMinimalEnemyBars(miniBars);
    }
  };
  const _Window_ActorCommand_initialize =
    Window_ActorCommand.prototype.initialize;

  // Create a method to get stat display values
  Sprite_BattleBar.prototype.getStatChanges = function () {
    if (!this._battler) return {};

    const baseStats = this._baseStats || {};
    const changes = {};
    const params = [
      { id: 2, name: _si18n("ATT"), base: baseStats.atk },
      { id: 3, name: _si18n("DEF"), base: baseStats.def },
      { id: 4, name: _si18n("M.ATT"), base: baseStats.mat },
      { id: 5, name: _si18n("M.DEF"), base: baseStats.mdf },
      { id: 6, name: _si18n("AGILITY"), base: baseStats.agi },
      { id: 7, name: _si18n("LUCK"), base: baseStats.luk },
    ];

    for (const param of params) {
      const current = this._battler.param(param.id);
      const base = this._battler.isActor() ? this._battler.paramWithoutStatesAndBuffs(param.id) : param.base;
      const diff = current - base;

      if (diff !== 0) {
        changes[param.name] = diff;
      }
    }

    return changes;
  };
  Window_ActorCommand.prototype.initialize = function (rect) {
    if (rect) {
      const lineHeight = this.lineHeight();
      const itemPadding = this.itemPadding();
      const extraHeight = lineHeight + itemPadding * 2;
      rect.height += extraHeight;
    }
    _Window_ActorCommand_initialize.call(this, rect);
  };
  Window_ActorCommand.prototype.maxVisibleItems = function () {
    return 6;
  };
  Window_ActorCommand.prototype.numVisibleRows = function () {
    return 6;
  };
  Window_ActorCommand.prototype.windowHeight = function () {
    return this.fittingHeight(this.numVisibleRows());
  };
  const _Scene_Battle_updateActorCommandWindowPosition =
    Scene_Battle.prototype.updateActorCommandWindowPosition;
  Scene_Battle.prototype.updateActorCommandWindowPosition = function () {
    _Scene_Battle_updateActorCommandWindowPosition.call(this);
    if (
      this._actorCommandWindow.y + this._actorCommandWindow.height >
      Graphics.boxHeight
    ) {
      const overflow =
        this._actorCommandWindow.y +
        this._actorCommandWindow.height -
        Graphics.boxHeight;
      this._actorCommandWindow.y -= overflow + 4;
    }
  };
  Window_ActorCommand.prototype.updateLayoutForExtraCommand = function () {
    const height = this.windowHeight();
    if (this.height !== height) {
      this.height = height;
      this.createContents();
    }
  };
  const _Window_ActorCommand_refresh = Window_ActorCommand.prototype.refresh;
  Window_ActorCommand.prototype.refresh = function () {
    this.updateLayoutForExtraCommand();
    _Window_ActorCommand_refresh.call(this);
  };


  // Add the helper method for individual skill commands
  Window_ActorCommand.prototype.addSkillCommand = function (skillTypeId) {
    const name = $dataSystem.skillTypes[skillTypeId];
    this.addCommand(name, "skill", true, skillTypeId);
  };
  const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
  Scene_Battle.prototype.terminate = function () {
    _Scene_Battle_terminate.call(this);
    this.removeBattleHealthBars();
    if (this._targetChevron) {
      this.removeChild(this._targetChevron);
      if (typeof this._targetChevron.destroy === "function") {
        this._targetChevron.destroy({ children: true });
      }
      this._targetChevron = null;
    }
  };
  Scene_Battle.prototype.removeBattleHealthBars = function () {

    // Original cleanup code
    if (this._battleHealthBarSprites) {
      for (const sprite of this._battleHealthBarSprites) {
        if (sprite) {
          this.removeChild(sprite);
          if (sprite._statDisplay) {
            this.removeChild(sprite._statDisplay);
          }
          if (typeof sprite.destroy === 'function') {
            sprite.destroy({ children: true });
          }
        }
      }
      this._battleHealthBarSprites = [];
    }
  };

  //=========================================================================
  // NEW: Functions for the 'Simple Display' (Actors 2 & 3)
  //=========================================================================


  // MODIFIED: This now creates card-style layout for party members - aspect ratio aware
  Sprite_BattleBar.prototype.createSimpleStatusDisplay = function () {
    this._simpleStatusDisplay = new Sprite();

    const cardWidth = this._playerCardWidth || 160;
    const cardHeight = this._playerCardHeight || 190;
    const yOffset = -cardHeight;

    this._simpleStatusDisplay.bitmap = new Bitmap(cardWidth + 380, cardHeight);
    this._simpleStatusDisplay.x = -playerBarX;
    this._simpleStatusDisplay.y = yOffset;
    this.addChild(this._simpleStatusDisplay);
    this._simpleStatusHtmlOverlay = new HtmlTextOverlay(this._simpleStatusDisplay);

    // Store battler's initial state for comparison
    this._lastHp = this._battler.hp;
    this._lastMaxHp = this._battler.mhp;
    this._lastMp = this._battler.mp;
    this._lastMaxMp = this._battler.mmp;
    this._lastTp = this._battler.tp;
    this._lastStatesHash = this._battler
      .states()
      .map((s) => s.id)
      .join(",");
    this._displayHp = this._battler.hp;
    this._damageChunkHp = this._battler.hp;

    // Dedicated full bust sprite standing behind the card
    this._bustSprite = new Sprite();
    this._bustSprite.anchor.x = 0.5;
    this._bustSprite.anchor.y = 1.0;
    this.addChildAt(this._bustSprite, 0); // Behind backgrounds and overlay

    // Glowing selection band drawn behind this card's bars, shown only while the
    // member is a candidate target during skill/item targeting (see update()).
    this.createSelectionHighlight();

    // Load portrait: prefer the actor world (walking) sprite, fall back to bust/battler image
    this._bustImage = null;
    this._usingWorldSprite = false;
    this._worldFrameH = 48;
    this._shouldUseBust = !!this._battler.actorId;
    this._canvasNeedForceRefresh = true;

    // Always prefer the actor's world (walking) sprite when one exists; the
    // bust branch below is a legacy fallback only for actors with no character
    // sprite at all (e.g. some creature forms).
    const charName = this._battler.characterName ? this._battler.characterName() : "";

    if (this._shouldUseBust && charName) {
      // World sprite path
      const charBitmap = ImageManager.loadCharacter(charName);
      this._bustImage = charBitmap;
      this._usingWorldSprite = true;
      charBitmap.addLoadListener(() => {
        if (!this._bustSprite || !charBitmap || charBitmap.width <= 0) return;
        this._bustSprite.bitmap = charBitmap;
        this._applyWorldSpriteFrame();
        this._canvasNeedForceRefresh = true;
        this.refreshSimpleStatus();
      });
    } else if (this._shouldUseBust) {
      const fallbackImage = ImageManager.loadBitmap('img/busts/', '7');

      // Get bust image path using SpritesAssociation (supports Variables 106-109)
      const bustPath = getBustImagePath(this._battler);

      if (bustPath) {
        try {
          // Parse the bust path to separate directory and filename
          const lastSlashIndex = bustPath.lastIndexOf('/');
          let bustDir, bustFile;

          if (lastSlashIndex > 0) {
            bustDir = bustPath.substring(0, lastSlashIndex + 1);
            bustFile = bustPath.substring(lastSlashIndex + 1);
          } else {
            bustDir = "img/busts/";
            bustFile = bustPath;
          }

          this._bustImage = ImageManager.loadBitmap(bustDir, bustFile);
          if (this._bustImage) {
            this._bustImage.addLoadListener(() => {
              // Check if the image loaded successfully by verifying it has valid dimensions
              if (this._bustImage && this._bustImage.width > 0 && this._bustImage.height > 0) {
                if (this._bustSprite) {
                  this._bustSprite.bitmap = this._bustImage;
                }
                this._canvasNeedForceRefresh = true;
                this.refreshSimpleStatus();
              } else {
                // Use fallback if primary image failed
                this._bustImage = fallbackImage;
                fallbackImage.addLoadListener(() => {
                  if (this._bustSprite) {
                    this._bustSprite.bitmap = fallbackImage;
                  }
                  this._canvasNeedForceRefresh = true;
                  this.refreshSimpleStatus();
                });
              }
            });
          }
        } catch (error) {
          console.log("Failed to load bust image:", bustPath, "using fallback");
          this._bustImage = fallbackImage;
          fallbackImage.addLoadListener(() => {
            if (this._bustSprite) {
              this._bustSprite.bitmap = fallbackImage;
            }
            this._canvasNeedForceRefresh = true;
            this.refreshSimpleStatus();
          });
        }
      } else {
        // No valid path found, use fallback
        this._bustImage = fallbackImage;
        fallbackImage.addLoadListener(() => {
          if (this._bustSprite) {
            this._bustSprite.bitmap = fallbackImage;
          }
          this._canvasNeedForceRefresh = true;
          this.refreshSimpleStatus();
        });
      }
    }

    this._canvasNeedForceRefresh = true;
    this.refreshSimpleStatus();
  };

  // Build the gold "you can target this member" band. It covers the name + HP/MP
  // rows and sits just behind the bars bitmap (above the bust) so a selected
  // party member is unmistakable instead of only sharing the active member's
  // gold text + walking sprite.
  Sprite_BattleBar.prototype.createSelectionHighlight = function () {
    const cardWidth = this._playerCardWidth || 160;
    const cardHeight = this._playerCardHeight || 190;

    // Band bounds inside the highlight bitmap (matches the bar draw region in
    // refreshSimpleStatus: bars run from barAreaX-8 to barAreaX+barW, name+HP+MP
    // occupy roughly y 34..104 for a 110px-tall card).
    const barAreaX = 56;
    const pad = 6;
    const barW = cardWidth - barAreaX - pad + 90;
    // Start left of the TP/AP orb (orb spans bitmap x ~12-52) so it's inside the band too.
    const x = 4;
    const y = 30;
    const w = (barAreaX + barW) - x + 14;
    const h = 78;
    const r = 5; // slightly rounded corners, mostly square

    const bmp = new Bitmap(x + w + 12, cardHeight);
    const ctx = bmp.context;

    const roundRect = () => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    };

    // Soft outer glow around the band
    ctx.save();
    ctx.shadowColor = "rgba(255,210,90,0.9)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(255,210,90,0.35)";
    roundRect();
    ctx.fill();
    ctx.restore();

    // Warm translucent fill so the bars stay readable on top
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "rgba(255,214,80,0.34)");
    grad.addColorStop(1, "rgba(180,130,20,0.20)");
    ctx.fillStyle = grad;
    roundRect();
    ctx.fill();

    // Bright gold border
    ctx.strokeStyle = "rgba(255,230,130,0.95)";
    ctx.lineWidth = 2.5;
    roundRect();
    ctx.stroke();

    bmp._baseTexture.update();

    this._selectionHighlight = new Sprite(bmp);
    this._selectionHighlight.x = -playerBarX;
    this._selectionHighlight.y = -cardHeight;
    this._selectionHighlight.visible = false;
    this._selectionHighlight.opacity = 0;
    // Insert just behind the bars bitmap so bars/name draw over the band,
    // but in front of the bust sprite.
    const insertAt = this._simpleStatusDisplay
      ? this.getChildIndex(this._simpleStatusDisplay)
      : this.children.length;
    this.addChildAt(this._selectionHighlight, insertAt);
  };
  // Crop the actor's walking-sprite sheet down to a single down-facing idle cell
  Sprite_BattleBar.prototype._applyWorldSpriteFrame = function (pattern, dirRow) {
    const sprite = this._bustSprite;
    const bmp = this._bustImage;
    if (!sprite || !bmp || !bmp.isReady()) return;
    const charName = this._battler.characterName ? this._battler.characterName() : "";
    const charIndex = this._battler.characterIndex ? this._battler.characterIndex() : 0;
    const big = ImageManager.isBigCharacter(charName);
    const pw = bmp.width / (big ? 3 : 12);
    const ph = bmp.height / (big ? 4 : 8);
    const blockCol = big ? 0 : (charIndex % 4);
    const blockRow = big ? 0 : Math.floor(charIndex / 4);
    const pat = pattern === undefined ? 1 : pattern; // middle (idle) walk frame by default
    const dir = dirRow === undefined ? 0 : dirRow;   // down-facing by default
    const sx = (blockCol * 3 + pat) * pw;
    const sy = (blockRow * 4 + dir) * ph;
    sprite.bitmap = bmp;
    sprite.setFrame(sx, sy, pw, ph);
    this._worldFrameH = ph;
  };
  // Advance the walk-cycle for the active member; hold an idle frame otherwise.
  Sprite_BattleBar.prototype.updateWalkAnimation = function (isActive) {
    if (!this._usingWorldSprite) return;
    const WALK_PATTERNS = [1, 2, 1, 0]; // standard RPG Maker step cycle
    if (isActive) {
      // Slightly slow base pace; slows further as HP drops (a weary step).
      const b = this._battler;
      const hpRate = b && b.mhp > 0 ? b.hp / b.mhp : 1;
      const stepDelay = 14 + Math.round((1 - hpRate) * 16); // 14 frames full HP -> 30 near death
      this._walkAnimCount = (this._walkAnimCount || 0) + 1;
      if (this._walkAnimCount >= stepDelay) {
        this._walkAnimCount = 0;
        this._walkPatternIdx = ((this._walkPatternIdx || 0) + 1) % WALK_PATTERNS.length;
        this._applyWorldSpriteFrame(WALK_PATTERNS[this._walkPatternIdx], 0);
      }
    } else if (this._walkPatternIdx !== undefined) {
      // Reset to the static idle frame once it stops being active.
      this._walkPatternIdx = undefined;
      this._walkAnimCount = 0;
      this._applyWorldSpriteFrame(1, 0);
    }
  };
  Sprite_BattleBar.prototype.triggerDamageFlash = function () {
    // Flash the actor's own 2D sprite red and give it a slight shake.
    // The tint + shake are driven from update() while the timer counts down.
    this._damageFlashTimer = DAMAGE_FLASH_DURATION;
  };
  // MODIFIED: This now only draws the text and bust image
  // MODIFIED: This function creates the animated background for Actors 2 & 3 - covers info/bars area
  Sprite_BattleBar.prototype.createSimpleDisplayBackground = function () {
    // Cover the full card width (including face column)
    const cardW = this._playerCardWidth || 160;
    const cardH = this._playerCardHeight || 190;
    const bgH = cardH;
    const bgX = -playerBarX;
    const bgW = cardW;
    const bgY = -cardH;

    // Create parchment background sprite for active turn display
    const parchmentBitmap = new Bitmap(bgW, bgH);
    this.drawParchmentBackground(parchmentBitmap, bgW, bgH);
    this._parchmentBackground = new Sprite(parchmentBitmap);
    this._parchmentBackground.x = bgX;
    this._parchmentBackground.y = bgY;
    this._parchmentBackground.visible = false;
    this.addChild(this._parchmentBackground);

    if (this._isInactiveMember) {
      // Plain solid dark background for reserve/inactive members
      const plainBitmap = new Bitmap(bgW, bgH);
      plainBitmap.fillRect(0, 0, bgW, bgH, "#000000");
      this._backgroundPattern = new Sprite(plainBitmap);
      this._backgroundPattern.x = bgX;
      this._backgroundPattern.y = bgY;
      this._backgroundPattern.opacity = 255;
      this.addChild(this._backgroundPattern);
      return;
    }

    // No semi-transparent background for non-inactive members; the bars/name
    // draw directly over the battleback.
  };

  Sprite_BattleBar.prototype.drawParchmentBackground = function (bitmap, bgW, bgH) {
    bitmap.clear();
    const ctx = bitmap.context;
    
    // Fill background
    bitmap.fillRect(0, 0, bgW, bgH, "#ecdcb9");
    
    // Radial gradient matching DialogueSystem.js
    const grad = ctx.createRadialGradient(bgW / 2, bgH / 2, 0, bgW / 2, bgH / 2, Math.max(bgW, bgH) / 2);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.4, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(78,38,12,0.12)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bgW, bgH);
    
    // Outer border (#4a2711, 3px solid)
    ctx.strokeStyle = "#4a2711";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, bgW - 3, bgH - 3);
    
    // Inner border (rgba(74,39,17,0.45) 1px outline offset -7px)
    ctx.strokeStyle = "rgba(74,39,17,0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(7, 7, bgW - 14, bgH - 14);
    
    bitmap._baseTexture.update();
  };



  Sprite_BattleBar.prototype.refreshSimpleStatus = function () {
    if (!this._simpleStatusDisplay || !this._battler) return;
    const bitmap = this._simpleStatusDisplay.bitmap;
    const b = this._battler;
    const W = bitmap.width;
    if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.clear();

    if (window.AsciiMode && window.AsciiMode.active) {
      bitmap.clear();
      bitmap.fontSize = 12;
      bitmap.textColor = "#ffffff";
      bitmap.fontFace = "monospace";
      bitmap.outlineWidth = 0;

      let y = 0;
      const lineHeight = 16;

      const activeActor = BattleManager._currentActor ||
        (BattleManager._subject && BattleManager._subject.isActor() ? BattleManager._subject : null);
      const isActive = this._battler === activeActor;

      // Draw Name and Level
      const actorLevel = b.level ? ` L.${b.level}` : "";
      const nameStr = b.name() + actorLevel;
      bitmap.textColor = "#ffd700";
      if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.addText(nameStr, 0, y, W, "left", 12, "#ffd700", false, null, 0, "monospace", lineHeight);
      y += lineHeight;

      // Draw HP
      const hpRate = (this._displayHp !== undefined ? this._displayHp : b.hp) / Math.max(1, b.mhp);
      const hpBars = Math.floor(hpRate * 20);
      const hpStr = `[${'='.repeat(Math.max(0, hpBars))}${' '.repeat(Math.max(0, 20 - hpBars))}]`;
      bitmap.textColor = isActive ? "#ff4444" : "#ffffff";
      if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.addText(`HP ${hpStr} ${Math.floor(this._displayHp !== undefined ? this._displayHp : b.hp)}/${b.mhp}`, 0, y, W, "left", 12, isActive ? "#ff4444" : "#ffffff", false, null, 0, "monospace", lineHeight);
      y += lineHeight;

      // Draw MP
      if (b.mmp > 0) {
        const mpRate = b.mp / Math.max(1, b.mmp);
        const mpBars = Math.floor(mpRate * 20);
        const mpStr = `[${'='.repeat(Math.max(0, mpBars))}${' '.repeat(Math.max(0, 20 - mpBars))}]`;
        bitmap.textColor = isActive ? "#44aaff" : "#ffffff";
        if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.addText(`MP ${mpStr} ${Math.floor(b.mp)}/${b.mmp}`, 0, y, W, "left", 12, isActive ? "#44aaff" : "#ffffff", false, null, 0, "monospace", lineHeight);
        y += lineHeight;
      }

      bitmap._baseTexture.update();
      return;
    }

    const hpRateVal = (this._displayHp !== undefined ? this._displayHp : b.hp) / Math.max(1, b.mhp);
    const hpChunkRateVal = (this._damageChunkHp !== undefined ? this._damageChunkHp : b.hp) / Math.max(1, b.mhp);
    const mpRateVal = b.mp / Math.max(1, b.mmp);
    const isAlive = b.isAlive();
    const activeActor = BattleManager._currentActor ||
      (BattleManager._subject && BattleManager._subject.isActor() ? BattleManager._subject : null);
    let isActive = this._battler && (this._battler === activeActor);
    if (isActive && $gameParty && $gameParty.battleMembers().length <= 1) {
      isActive = false;
    }
    const isTargeted = !!(SceneManager._scene &&
                        SceneManager._scene._actorWindow &&
                        SceneManager._scene._actorWindow.active &&
                        this._battler.isSelected());

    const needCanvasRedraw = (
      hpRateVal !== this._lastDrawnHpRate ||
      hpChunkRateVal !== this._lastDrawnHpChunkRate ||
      mpRateVal !== this._lastDrawnMpRate ||
      isAlive !== this._lastDrawnIsAlive ||
      this._lastDrawnIsTargeted !== isTargeted ||
      this._lastDrawnIsActive !== isActive ||
      this._canvasNeedForceRefresh
    );

    if (needCanvasRedraw) {
      this._lastDrawnHpRate = hpRateVal;
      this._lastDrawnHpChunkRate = hpChunkRateVal;
      this._lastDrawnMpRate = mpRateVal;
      this._lastDrawnIsAlive = isAlive;
      this._lastDrawnIsTargeted = isTargeted;
      this._lastDrawnIsActive = isActive;
      this._canvasNeedForceRefresh = false;
      bitmap.clear();
    }

    const H = bitmap.height;
    const ctx = bitmap.context;
    const pad = 6;
    const cardWidth = this._playerCardWidth || 160;

    const GAP = 12;
    const barAreaX = 56; // Optimized to overlap HP/MP bars slightly with the TP orb
    // Shorter bars so the party panel clears the centered battle log
    const barW = cardWidth - barAreaX - pad + 90;
    // Name starts past the TP/AP orb (orb occupies bitmap x ~12-68) to avoid overlap
    const nameX = 74;

    const HP_COLOR = "#ff3333"; const HP_BRIGHT = "#ff8888"; const HP_DARK = "#660000";
    const MP_COLOR = "#3399ff"; const MP_BRIGHT = "#88ccff"; const MP_DARK = "#003388";
    const AP_COLOR = "#ffcc00"; const AP_BRIGHT = "#ffee77"; const AP_DARK = "#664400";

    if (needCanvasRedraw) {
      // Faint dead-tint only; the greyed portrait + dimmed bars convey death
      // without an opaque black rectangle over the card (issue #167).
      if (!isAlive) bitmap.fillRect(0, 0, cardWidth, H, "rgba(0,0,0,0.18)");
    }

    const nameColor = (isTargeted || isActive) ? "#ffd700" : "#ffffff";
    const nameOutline = "black";
    const nameOutlineW = 1;

    const BAR_OFFSET_Y = 18;
    let curY = 26 + BAR_OFFSET_Y;
    const actorLevel = b.level ? ` L.${b.level}` : "";
    const nameWithLevel = b.name() + actorLevel;
    if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.addText(nameWithLevel, nameX, curY - 2, Math.floor(barW * 0.75), "left", 18, nameColor, true, nameOutline, nameOutlineW, "Lora, serif", 20);

    const drawRow = (label, value, color, bright, dark, numColor, rate, numH, barH, trackColor, chunkRate = 0, numBelow = false) => {
      const activeNumColor = numColor;
      const activeOutlineColor = "black";
      const activeOutlineWidth = 1;
      
      if (!numBelow) {
        if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.addText(String(Math.floor(value)), barAreaX, curY - 2, barW, "right", 22, activeNumColor, true, activeOutlineColor, activeOutlineWidth, "Lora, serif", numH);
        curY += numH + 1;
      }
      
      if (needCanvasRedraw) {
        const ang = barH + 2;
        const fillW = Math.round(barW * Math.max(0, Math.min(1, rate)));
        const chunkW = Math.round(barW * Math.max(0, Math.min(1, chunkRate)));
        ctx.fillStyle = trackColor;
        ctx.beginPath();
        ctx.moveTo(barAreaX, curY);
        ctx.lineTo(barAreaX + barW, curY);
        ctx.lineTo(barAreaX + barW - ang, curY + barH);
        ctx.lineTo(barAreaX - ang, curY + barH);
        ctx.closePath();
        ctx.fill();
        if (chunkW > fillW) {
          ctx.fillStyle = damageColor;
          ctx.beginPath();
          ctx.moveTo(barAreaX + fillW, curY);
          ctx.lineTo(barAreaX + chunkW, curY);
          ctx.lineTo(barAreaX + chunkW - ang, curY + barH);
          ctx.lineTo(barAreaX + fillW - ang, curY + barH);
          ctx.closePath();
          ctx.fill();
        }
        if (fillW > 0) {
          const grad = ctx.createLinearGradient(barAreaX, 0, barAreaX + barW, 0);
          grad.addColorStop(0, dark);
          grad.addColorStop(0.3, color);
          grad.addColorStop(0.65, bright);
          grad.addColorStop(1, dark);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(barAreaX, curY);
          ctx.lineTo(barAreaX + fillW, curY);
          ctx.lineTo(barAreaX + fillW - ang, curY + barH);
          ctx.lineTo(barAreaX - ang, curY + barH);
          ctx.closePath();
          ctx.fill();
          const hiH = Math.max(1, Math.floor(barH / 2));
          const hiAng = Math.floor(ang / 2);
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.moveTo(barAreaX, curY);
          ctx.lineTo(barAreaX + fillW, curY);
          ctx.lineTo(barAreaX + fillW - hiAng, curY + hiH);
          ctx.lineTo(barAreaX - hiAng, curY + hiH);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // Draw solid black outline border around the player bar track matching the enemy bar style
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(barAreaX, curY);
        ctx.lineTo(barAreaX + barW, curY);
        ctx.lineTo(barAreaX + barW - ang, curY + barH);
        ctx.lineTo(barAreaX - ang, curY + barH);
        ctx.closePath();
        ctx.stroke();
      }
      curY += barH + (numBelow ? 1 : 2);
      if (numBelow) {
        if (this._simpleStatusHtmlOverlay) this._simpleStatusHtmlOverlay.addText(String(Math.floor(value)), barAreaX, curY - 2, barW, "right", 22, activeNumColor, true, activeOutlineColor, activeOutlineWidth, "Lora, serif", numH);
        curY += numH + 2;
      }
    };

    const hpDisplayRate = (this._displayHp || b.hp) / Math.max(1, b.mhp);
    const hpChunkRate = (this._damageChunkHp || b.hp) / Math.max(1, b.mhp);
    const hpRate = b.hp / Math.max(1, b.mhp);
    let hpNumColor = isTargeted ? "#ffd700" : "#ffffff";
    if (!isTargeted) {
      if (hpRate <= 0.25) hpNumColor = "#ff4444";
      else if (hpRate <= 0.5) hpNumColor = "#ffff00";
    }
    drawRow("HP", b.hp, HP_COLOR, HP_BRIGHT, HP_DARK, hpNumColor, hpDisplayRate, 16, 8, "rgba(100,0,0,0.4)", hpChunkRate);

    // MP bar, drawn below HP (hidden only for battlers with no MP pool).
    if (b.mmp > 0) {
      const mpRate = b.mp / Math.max(1, b.mmp);
      const mpNumColor = isTargeted ? "#ffd700" : "#aaddff";
      drawRow("MP", b.mp, MP_COLOR, MP_BRIGHT, MP_DARK, mpNumColor, mpRate, 16, 8, "rgba(0,30,80,0.4)");
    }

    const activeStates = b.states().filter(s => s.iconIndex > 0);

    const statNames = {
      2: _si18n("ATT"),
      3: _si18n("DEF"),
      4: _si18n("M.ATT"),
      5: _si18n("M.DEF"),
      6: _si18n("AGILITY"),
      7: _si18n("LUCK")
    };
    const affectedStats = [];
    for (let id = 2; id <= 7; id++) {
      const current = b.param(id);
      const base = (b.isActor() ? b.paramWithoutStatesAndBuffs(id) : b.paramBase(id)) || 1;
      const rate = current / base;
      if (Math.abs(rate - 1.0) > 0.05) {
        affectedStats.push({ name: statNames[id], value: `${Number(rate.toFixed(1))}x`, rate });
      }
    }

    // Status + stat tags placed BELOW the player bars (previously to the right of the MP
    // bar, where they spilled into the centered battle log). They flow left-to-right and
    // wrap within the bar width. Order: applied statuses first, then stat-change multipliers.
    const rowStartX = barAreaX - 8;          // left edge of the angled bars
    const rowMaxX = barAreaX + barW;          // wrap within the bar width
    const rowLineH = 22;
    let rowX = rowStartX;
    let rowY = curY + 4;                       // just below the MP number row

    // 1) Applied statuses, rendered as themed pill chips, tinted by the state's <Hex> color
    if (activeStates.length > 0) {
      const chipFont = 13;
      const chipPadX = 8;
      const chipH = 20;
      bitmap.fontSize = chipFont;
      bitmap.fontBold = true;
      for (const state of activeStates) {
        const sName = window.translateText ? window.translateText(state.name) : state.name;
        const textW = Math.ceil(bitmap.measureTextWidth(sName));
        const chipW = textW + chipPadX * 2;
        if (rowX > rowStartX && rowX + chipW > rowMaxX) { rowX = rowStartX; rowY += rowLineH; }
        // Color-code: restricting states read as debuffs (red), the rest as warm parchment
        const isDebuff = state.restriction && state.restriction > 0;
        const hex = getStateHexColor(state);
        const textColor = hex || (isDebuff ? "#ffd0d0" : "#ffe9c2");
        const borderColor = hex || (isDebuff ? "rgba(255,150,150,0.6)" : "rgba(255,214,150,0.6)");
        const bgGrad = isDebuff
          ? "linear-gradient(180deg, rgba(80,24,24,0.92), rgba(45,12,12,0.92))"
          : "linear-gradient(180deg, rgba(70,48,20,0.92), rgba(40,26,10,0.92))";
        if (this._simpleStatusHtmlOverlay) {
          const el = this._simpleStatusHtmlOverlay.addText(sName, rowX, rowY, chipW, "center", chipFont, textColor, true, null, 0, "Lora, serif", chipH - 2);
          el.style.boxSizing = "border-box";
          el.style.height = chipH + "px";
          el.style.padding = "0 " + chipPadX + "px";
          el.style.background = bgGrad;
          el.style.border = "1px solid " + borderColor;
          el.style.borderRadius = (chipH / 2) + "px";
          el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.6)";
        }
        rowX += chipW + 6;
      }
    }

    // 2) Stat-change multipliers after the statuses, continuing on the same (wrapping) row
    if (affectedStats.length > 0) {
      const statFont = 15;
      const statH = 20;
      bitmap.fontSize = statFont;
      bitmap.fontBold = true;
      for (const part of affectedStats) {
        const valColor = part.rate > 1.0 ? "#44ff44" : "#ff4444";
        const labelW = Math.ceil(bitmap.measureTextWidth(part.name)) + 6;
        const valW = Math.ceil(bitmap.measureTextWidth(part.value)) + 6;
        if (rowX > rowStartX && rowX + labelW + valW > rowMaxX) { rowX = rowStartX; rowY += rowLineH; }
        if (this._simpleStatusHtmlOverlay) {
          this._simpleStatusHtmlOverlay.addText(part.name, rowX, rowY, labelW, "left", statFont, "#ffffff", true, "black", 2, "Lora, serif", statH);
          this._simpleStatusHtmlOverlay.addText(part.value, rowX + labelW, rowY, valW, "left", statFont, valColor, true, "black", 2, "Lora, serif", statH);
        }
        rowX += labelW + valW + 12;
      }
    }

    // 3) Class-gimmick chips (Wrestler pins, Boxer combo, chi, decoys, souls,
    // attunement, night buff, ...). Sourced from BattleSystemPassiveSkills so the
    // class logic stays in one place; rendered as its own bright chip row.
    const classChips = (window.BattleSystemPassiveSkills &&
      typeof window.BattleSystemPassiveSkills.getBattleChips === "function")
      ? window.BattleSystemPassiveSkills.getBattleChips(b)
      : [];
    if (classChips && classChips.length > 0) {
      const chipFont = 14;
      const chipPadX = 8;
      const chipH = 21;
      // Start class chips on a fresh row so they read as a distinct band.
      if (rowX > rowStartX) { rowX = rowStartX; rowY += rowLineH; }
      bitmap.fontSize = chipFont;
      bitmap.fontBold = true;
      for (const chip of classChips) {
        const label = String(chip.label || "");
        if (!label) continue;
        const textW = Math.ceil(bitmap.measureTextWidth(label));
        const chipW = textW + chipPadX * 2;
        if (rowX > rowStartX && rowX + chipW > rowMaxX) { rowX = rowStartX; rowY += rowLineH; }
        const accent = chip.color || "#ffe9c2";
        if (this._simpleStatusHtmlOverlay) {
          const el = this._simpleStatusHtmlOverlay.addText(label, rowX, rowY, chipW, "center", chipFont, accent, true, "black", 2, "Lora, serif", chipH - 2);
          el.style.boxSizing = "border-box";
          el.style.height = chipH + "px";
          el.style.padding = "0 " + chipPadX + "px";
          el.style.background = "linear-gradient(180deg, rgba(30,26,44,0.94), rgba(16,14,26,0.94))";
          el.style.border = "1px solid " + accent;
          el.style.borderRadius = (chipH / 2) + "px";
          el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.7)";
        }
        rowX += chipW + 6;
      }
    }

    if (needCanvasRedraw) {
      bitmap._baseTexture.update();
    }
  };

  // (legacy stubs kept for compatibility)
  Sprite_BattleBar.prototype._drawVerticalCard = function (bitmap, b, cardWidth, cardHeight) {
    const name = b.name();
    const hp = b.hp;
    const mp = b.mp;
    const tp = b.tp;

    // ===== TOP SECTION: Name and Level =====
    const nameY = 6;
    bitmap.fontSize = 14;
    bitmap.fontBold = true;
    bitmap.textColor = "#ffffff";
    const actorLevel = b.level ? ` L.${b.level}` : "";
    const nameWithLevel = name + actorLevel;
    bitmap.drawText(nameWithLevel, 10, nameY, cardWidth - 20, 18, "center");

    // ===== DIVIDER =====
    const divider1Y = 27;
    bitmap.fillRect(10, divider1Y, cardWidth - 20, 1, "#444444");

    // ===== MIDDLE SECTION: Bust Image =====
    if (this._shouldUseBust && this._bustImage && this._bustImage.isReady()) {
      const imageAreaY = 32;
      const imageAreaHeight = 135;

      const maxBustWidth = cardWidth - 20;
      const maxBustHeight = imageAreaHeight - 10;
      const bustAspectRatio = this._bustImage.width / this._bustImage.height;

      let bustWidth = maxBustWidth;
      let bustHeight = Math.round(maxBustWidth / bustAspectRatio);

      if (bustHeight > maxBustHeight) {
        bustHeight = maxBustHeight;
        bustWidth = Math.round(bustHeight * bustAspectRatio);
      }

      const bustX = Math.floor((cardWidth - bustWidth) / 2);
      const bustY = imageAreaY + Math.floor((imageAreaHeight - bustHeight) / 2);

      bitmap.blt(
        this._bustImage,
        0,
        0,
        this._bustImage.width,
        this._bustImage.height,
        bustX,
        bustY,
        bustWidth,
        bustHeight
      );
    }

    // ===== DIVIDER 2 =====
    const divider2Y = 172;
    bitmap.fillRect(10, divider2Y, cardWidth - 20, 1, "#444444");

    // ===== BOTTOM SECTION: Stats Numbers Only =====
    const statsStartY = 180;
    bitmap.fontSize = 12;
    bitmap.fontBold = true;

    // HP
    const hpRate = hp / Math.max(1, b.mhp);
    let hpColor = "#00ff00";
    if (hpRate <= 0.25) hpColor = "#ff0000";
    else if (hpRate <= 0.5) hpColor = "#ffff00";

    bitmap.textColor = hpColor;
    const hpText = `${hp} HP`;
    bitmap.drawText(hpText, 12, statsStartY, cardWidth - 24, 18, "left");

    // MP
    bitmap.textColor = mpBarColor1;
    const mpText = `${mp} MP`;
    bitmap.drawText(mpText, 12, statsStartY + 28, cardWidth - 24, 18, "left");

    // TP
    bitmap.textColor = tpColor1;
    const tpText = `${Math.floor(tp)} AP`;
    bitmap.drawText(tpText, 12, statsStartY + 54, cardWidth - 24, 18, "left");
  };

  // Generic alchemical override: extract cropped face from full-body bust
  Window_Base.prototype.drawFace = function(faceName, faceIndex, x, y, width, height) {
    if (!faceName) return;
    width = width || ImageManager.faceWidth;
    height = height || ImageManager.faceHeight;
    
    let bitmap = ImageManager.loadBitmap("img/busts/", faceName);
    const drawClippedFace = () => {
      const sw = bitmap.width * 0.6;
      const sh = bitmap.width * 0.6;
      const sx = (bitmap.width - sw) / 2;
      const sy = bitmap.height * 0.05; // Upper bust face area
      this.contents.blt(bitmap, sx, sy, sw, sh, x, y, width, height);
    };

    bitmap.addLoadListener(() => {
      if (bitmap.width > 0 && bitmap.height > 0) {
        drawClippedFace();
      } else {
        // Fallback to '7' if primary bust loading fails
        bitmap = ImageManager.loadBitmap("img/busts/", "7");
        bitmap.addLoadListener(drawClippedFace);
      }
    });
  };

  // Hide the legacy RPG Maker actor selection window completely
  const _Window_BattleActor_initialize = Window_BattleActor.prototype.initialize;
  Window_BattleActor.prototype.initialize = function(rect) {
    _Window_BattleActor_initialize.call(this, rect);
    this.opacity = 0;
    this.contentsOpacity = 0;
  };

  const _Window_BattleActor_show = Window_BattleActor.prototype.show;
  Window_BattleActor.prototype.show = function() {
    // Temporarily map WASD to standard directional controls for smooth targeting
    this._originalKeyMapper = Object.assign({}, Input.keyMapper);
    Input.keyMapper[87] = "up";     // W
    Input.keyMapper[83] = "down";   // S
    Input.keyMapper[65] = "left";   // A
    Input.keyMapper[68] = "right";  // D
    
    _Window_BattleActor_show.call(this);
    this.opacity = 0;
    this.contentsOpacity = 0;
  };

  const _Window_BattleActor_hide = Window_BattleActor.prototype.hide;
  Window_BattleActor.prototype.hide = function() {
    _Window_BattleActor_hide.call(this);
    // Restore original key mappings when targeting is finished
    if (this._originalKeyMapper) {
      Input.keyMapper = this._originalKeyMapper;
      this._originalKeyMapper = null;
    }
  };

  // Prevent drawing legacy actor status/text at the bottom
  Window_BattleActor.prototype.drawItem = function(index) {
    // Do absolutely nothing to ensure legacy text is removed
  };

  // Override processCursorMove to support WASD, arrow keys, and gamepad D-pad in all directions
  Window_BattleActor.prototype.processCursorMove = function() {
    if (this.isCursorMovable()) {
      const maxItems = this.maxItems();
      if (maxItems > 0) {
        const lastIndex = this.index();
        if (Input.isRepeated("up") || Input.isRepeated("left")) {
          this.select((this.index() - 1 + maxItems) % maxItems);
        } else if (Input.isRepeated("down") || Input.isRepeated("right")) {
          this.select((this.index() + 1) % maxItems);
        }
        if (this.index() !== lastIndex) {
          this.playCursorSound();
        }
      }
    }
  };

  //=============================================================================
  // Battle Hotbar , Daggerfall-style quickbar of the acting member's first
  // nine synced (carried) skills. Numbers 1-9 cast instantly; the bar itself
  // can take keyboard/gamepad focus away from the actor command window with
  // Left/Right or L1/R1 (pageup/pagedown), since that vertical list never uses
  // horizontal input of its own (Window_ActorCommand.maxCols() is 1, so
  // cursorLeft/cursorRight are already no-ops there) and its few rows fit on
  // one page (so cursorPageup/Pagedown are no-ops too). See window.BattleHotbar.
  //=============================================================================
  const HOTBAR_SLOTS = 9;
  const HOTBAR_SLOT_PX = 52;
  const HOTBAR_MARGIN_BOTTOM = 2; // how close the bar itself sits to the bottom edge
  const HOTBAR_LOG_GAP = 56; // extra clearance kept between the log's own reserve and the bar

  // MPP_SmoothBattleLog2.js reads this to keep the log clear of the bar.
  window.BattleHotbar = window.BattleHotbar || {};
  window.BattleHotbar.reservedHeight = HOTBAR_SLOT_PX + HOTBAR_MARGIN_BOTTOM + HOTBAR_LOG_GAP;

  let _hotbarActive = false; // true once the bar, rather than the command list, owns direction input
  let _hotbarIndex = 0;
  let _hotbarActor = null;
  // Window_ActorCommand.processCursorMove hands off focus on the same Left/
  // Right press that updateBattleHotbar (later in the very same frame) would
  // otherwise also read as a repeat and step again; this eats that one frame.
  let _hotbarJustActivated = false;

  // The slot row itself, its markup, tooltip and canvas-synced placement, is
  // the shared widget (Core/HotbarUI.js); the item favourites bar on the map
  // is the same thing with a different set of entries behind it.
  const _hotbarBar = new HotbarUI({
    id: 'html-hotbar-overlay',
    slots: HOTBAR_SLOTS,
    slotPx: HOTBAR_SLOT_PX,
    marginBottom: HOTBAR_MARGIN_BOTTOM,
    zIndex: 352,
    onSlotClick: (i) => {
      const actor = BattleManager.actor();
      const skills = _hotbarSkills(actor);
      if (skills[i]) _hotbarUseSkill(actor, skills[i]);
    }
  });

  function _hotbarSkills(actor) {
    if (!actor || !window.BattleLoadout) return [];
    return window.BattleLoadout.ids(actor)
      .slice(0, HOTBAR_SLOTS)
      .map(id => $dataSkills[id])
      .filter(Boolean);
  }

  // The tooltip shows the skill's name and its cost only, nothing else.
  function _hotbarTooltipText(actor, skill) {
    let costText = '';
    if (actor.skillTpCost(skill) > 0) {
      costText = `${actor.skillTpCost(skill)} ${TextManager.tp}`;
    } else if (actor.skillMpCost(skill) > 0) {
      costText = `${actor.skillMpCost(skill)} ${TextManager.mp}`;
    }
    return costText ? `${skill.name} — ${costText}` : skill.name;
  }

  function _hotbarEntries(actor, skills) {
    const entries = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const skill = skills[i];
      entries.push(skill ? {
        iconIndex: skill.iconIndex,
        enabled: actor.canUse(skill),
        tooltip: _hotbarTooltipText(actor, skill)
      } : null);
    }
    return entries;
  }

  // Casts exactly the way choosing the skill from the ordinary skill list
  // and confirming it would (Scene_Battle.prototype.onSkillOk): the skill
  // and item windows are stood down first since either may be sitting open
  // underneath the bar.
  function _hotbarUseSkill(actor, skill) {
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Battle)) return false;
    if (!BattleManager.isInputting() || BattleManager.actor() !== actor) return false;
    const action = BattleManager.inputtingAction();
    if (!action) return false;
    if (!actor.canUse(skill)) {
      SoundManager.playBuzzer();
      return false;
    }
    if (scene._skillWindow) { scene._skillWindow.deactivate(); scene._skillWindow.hide(); }
    if (scene._itemWindow) { scene._itemWindow.deactivate(); scene._itemWindow.hide(); }
    _hotbarActive = false;
    action.setSkill(skill.id);
    actor.setLastBattleSkill(skill);
    SoundManager.playOk();
    scene.onSelectAction();
    return true;
  }

  // The bar is centred on the whole screen, not just the (off-center) log
  // column, and held well clear of the log above it (see HOTBAR_LOG_GAP).
  function _updateHotbarPosition(actor, skills) {
    _hotbarBar.render(_hotbarEntries(actor, skills), {
      selected: _hotbarIndex,
      active: _hotbarActive
    });

    // Dim the command list while the bar holds direction focus, so it never
    // reads as two things arguing over which is selected.
    const cmdRoot = document.getElementById('html-actorcmd-overlay');
    if (cmdRoot) cmdRoot.style.opacity = _hotbarActive ? '0.55' : '';
  }

  function _hideHotbar() {
    _hotbarBar.hide();
    const cmdRoot = document.getElementById('html-actorcmd-overlay');
    if (cmdRoot) cmdRoot.style.opacity = '';
  }

  const _Scene_Battle_update_hotbar = Scene_Battle.prototype.update;
  Scene_Battle.prototype.update = function () {
    _Scene_Battle_update_hotbar.call(this);
    this.updateBattleHotbar();
  };

  Scene_Battle.prototype.updateBattleHotbar = function () {
    // The card battle layer (RoguelikeCardSystem.js) plays skills as a hand
    // of cards instead, so the two never share the screen.
    if (window.isCardCombatMode && window.isCardCombatMode()) {
      _hideHotbar();
      return;
    }
    const actor = BattleManager.actor();
    const inputting = !!actor && BattleManager.isInputting() && !$gameMessage.isBusy();
    if (!inputting) {
      if (_hotbarActor) { _hotbarActive = false; _hotbarActor = null; }
      _hideHotbar();
      return;
    }
    if (actor !== _hotbarActor) {
      _hotbarActor = actor;
      _hotbarActive = false;
      _hotbarIndex = 0;
    }
    const skills = _hotbarSkills(actor);
    if (skills.length === 0) {
      _hideHotbar();
      return;
    }

    // Instant-cast hotkeys work whether or not the bar itself has focus.
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (skills[i] && Input.isTriggered(String(i + 1))) {
        _hotbarUseSkill(actor, skills[i]);
        return;
      }
    }

    if (_hotbarActive) {
      if (_hotbarJustActivated) {
        // The keypress that handed focus over was already consumed by
        // Window_ActorCommand.processCursorMove this same frame.
        _hotbarJustActivated = false;
      } else if (Input.isTriggered('cancel') || Input.isTriggered('up')) {
        _hotbarActive = false;
        SoundManager.playCancel();
      } else if (Input.isRepeated('left') || Input.isRepeated('pageup')) {
        // pageup/pagedown are the shoulder buttons L1/R1 (CustomCommandMapper.js).
        _hotbarIndex = (_hotbarIndex - 1 + skills.length) % skills.length;
        SoundManager.playCursor();
      } else if (Input.isRepeated('right') || Input.isRepeated('pagedown')) {
        _hotbarIndex = (_hotbarIndex + 1) % skills.length;
        SoundManager.playCursor();
      } else if (Input.isTriggered('ok')) {
        _hotbarUseSkill(actor, skills[_hotbarIndex]);
      }
    }

    _updateHotbarPosition(actor, skills);
  };

  const _Scene_Battle_terminate_hotbar = Scene_Battle.prototype.terminate;
  Scene_Battle.prototype.terminate = function () {
    _hotbarActive = false;
    _hotbarActor = null;
    _hideHotbar();
    _Scene_Battle_terminate_hotbar.call(this);
  };

  // Left/Right (and L1/R1, i.e. pageup/pagedown) hand focus to the bar from
  // the actor command list, entering on its last carried skill or its first
  // respectively; every other key (up/down/ok/cancel) is untouched. While the
  // bar holds focus the list's own cursor movement and OK/Cancel are suspended
  // so the two never fight over the same key press.
  const _Window_ActorCommand_processCursorMove_hotbar = Window_ActorCommand.prototype.processCursorMove;
  Window_ActorCommand.prototype.processCursorMove = function () {
    if (_hotbarActive) return;
    const cardMode = window.isCardCombatMode && window.isCardCombatMode();
    const back = Input.isTriggered('left') || Input.isTriggered('pageup');
    const fwd = Input.isTriggered('right') || Input.isTriggered('pagedown');
    if (!cardMode && this.isCursorMovable() && (back || fwd)) {
      const skills = _hotbarSkills(this._actor);
      if (skills.length > 0) {
        _hotbarActive = true;
        _hotbarJustActivated = true;
        _hotbarIndex = back ? skills.length - 1 : 0;
        SoundManager.playCursor();
        return;
      }
    }
    _Window_ActorCommand_processCursorMove_hotbar.call(this);
  };

  const _Window_ActorCommand_processHandling_hotbar = Window_ActorCommand.prototype.processHandling;
  Window_ActorCommand.prototype.processHandling = function () {
    if (_hotbarActive) return;
    _Window_ActorCommand_processHandling_hotbar.call(this);
  };
})();

//=============================================================================
// Enemy-attack animations shown over the party portraits
//
// This is a front-view battle: the party is drawn as portrait "cards" in the
// top-left (Sprite_BattleBar bust sprites), so there are no Sprite_Actor
// targets for the engine to play animations over. When an enemy uses an
// action that has a real animation aimed at the party, redirect it here:
//   - single target  -> a miniature animation over that member's portrait
//   - all/multi party -> one larger animation centered over the portrait column
//=============================================================================
(() => {
  "use strict";

  // Effekseer draws into a square viewport sized 4096 at full scale; shrinking
  // that viewport shrinks the whole effect proportionally.
  const MINI_SCALE = 0.08;  // single-target: sits over one portrait
  const GROUP_SCALE = 0.15; // whole-party: larger, spans the portrait column

  function activeBattleScene() {
    const scene = SceneManager._scene;
    return (scene && scene instanceof Scene_Battle) ? scene : null;
  }

  // Locate the party portrait card (Sprite_BattleBar) bound to an actor battler.
  function barSpriteFor(actor) {
    const scene = activeBattleScene();
    if (!scene || !scene._battleHealthBarSprites) return null;
    return scene._battleHealthBarSprites.find(
      s => s && s._isPlayer && s._battler === actor
    ) || null;
  }

  // Screen-space center of an actor's portrait (falls back to the card body).
  function portraitCenter(actor) {
    const bar = barSpriteFor(actor);
    if (!bar) return null;
    const bust = bar._bustSprite;
    if (bust && bust.bitmap && bust.bitmap.isReady && bust.bitmap.isReady()) {
      const p = bust.getGlobalPosition();          // anchor (0.5, 1.0) = bottom-center
      const h = bust.height || 100;
      return new Point(p.x, p.y - h * 0.5);         // lift to the visual center
    }
    const p = bar.getGlobalPosition();
    return new Point(p.x, p.y - 55);
  }

  // Play one animation over the given screen point(s) at a reduced viewport size.
  function playAnimationAt(animationId, points, viewportScale, targetBattlers) {
    if (!(animationId > 0) || !points || !points.length) return;
    const scene = activeBattleScene();
    const spriteset = scene && scene._spriteset;
    const animation = $dataAnimations[animationId];
    if (!spriteset || !animation || !spriteset._effectsContainer) return;

    // Invisible target sprites anchored at the requested screen points. They are
    // parented to the scene (identity transform), so world == local == point.
    const dummies = points.map(pt => {
      const d = new Sprite();
      d.x = pt.x;
      d.y = pt.y;
      scene.addChild(d);
      // The dummy is a direct child of the battle scene, but it is also torn
      // down together with the animation sprite below. When the battle scene is
      // destroyed both the animation-sprite cleanup and Stage.destroy's own child
      // sweep race to destroy the same dummy (Stage snapshots its children before
      // iterating, so it still holds the already-destroyed dummy). Make destroy
      // idempotent so the second call is a no-op instead of crashing with
      // "Cannot read property 'off' of null" on the freed texture.
      const _dDestroy = d.destroy;
      d.destroy = function (options) {
        if (this._destroyed) return;
        _dDestroy.call(this, options);
      };
      return d;
    });

    const mv = spriteset.isMVAnimation(animation);
    const sprite = new (mv ? Sprite_AnimationMV : Sprite_Animation)();
    sprite.targetObjects = targetBattlers || [];
    if (!mv) {
      sprite._viewportSize = 4096 * viewportScale;
    }
    sprite.setup(dummies, animation, false, 0, null);
    if (mv) {
      sprite.scale.x = viewportScale;
      sprite.scale.y = viewportScale;
    }
    spriteset._effectsContainer.addChild(sprite);
    spriteset._animationSprites.push(sprite);

    // Tear the dummy sprites down together with the animation.
    sprite._bseMiniDummies = dummies;
    const _destroy = sprite.destroy;
    sprite.destroy = function (options) {
      if (this._bseMiniDummies) {
        for (const d of this._bseMiniDummies) {
          if (d.parent) d.parent.removeChild(d);
          if (d.destroy) d.destroy();
        }
        this._bseMiniDummies = null;
      }
      _destroy.call(this, options);
    };
  }

  const _WBL_showAnimation = Window_BattleLog.prototype.showAnimation;
  Window_BattleLog.prototype.showAnimation = function (subject, targets, animationId) {
    // Map Battle Mode (MapBattleMode.js): combatants are real map characters,
    // not portrait cards, so let the default engine targeting reach their
    // actual on-map sprite instead of redirecting onto a portrait.
    if (window.MapBattleMode && window.MapBattleMode.isActive()) {
      _WBL_showAnimation.call(this, subject, targets, animationId);
      return;
    }
    if (animationId > 0 && subject && subject.isEnemy && subject.isEnemy() && Array.isArray(targets)) {
      const actorTargets = targets.filter(t => t && t.isActor && t.isActor());
      if (actorTargets.length > 0) {
        if (actorTargets.length === 1) {
          const c = portraitCenter(actorTargets[0]);
          if (c) playAnimationAt(animationId, [c], MINI_SCALE, actorTargets);
        } else {
          // Multi/all-party hit: one larger animation over the column centroid.
          const pts = actorTargets.map(portraitCenter).filter(Boolean);
          if (pts.length) {
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            playAnimationAt(animationId, [new Point(cx, cy)], GROUP_SCALE, actorTargets);
          }
        }
        // Let any non-actor targets keep the default handling.
        const otherTargets = targets.filter(t => !(t && t.isActor && t.isActor()));
        if (otherTargets.length > 0) {
          _WBL_showAnimation.call(this, subject, otherTargets, animationId);
        }
        return;
      }
    }
    _WBL_showAnimation.call(this, subject, targets, animationId);
  };
})();
