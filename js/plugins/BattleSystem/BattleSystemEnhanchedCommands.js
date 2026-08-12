//=============================================================================
// BattleSystemEnhanchedCommands.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v3.0.0 HTML-rendered battle command window (crispy, like battlelog)
 * @author Assistant
 *
 * @help BattleSystemEnhanchedCommands.js
 *
 * Reworked actor command window for battle:
 * - HTML/CSS rendering identical in style to MPP_SmoothBattleLog2
 * - Per-command colored gradient bars with solid dark base
 * - Left accent stripe with command-type color
 * - Icon + label layout using Lora font
 * - Selection highlight updates immediately
 * - Reload command support (requires WeaponSystem.js)
 *
 * Load order: Must load AFTER WeaponSystem.js
 */

(() => {
  "use strict";

  //=============================================================================
  // Row geometry
  //=============================================================================
  // One source of truth for the size of a command row. itemHeight() is the row
  // the invisible canvas window hit-tests against, so the HTML rows have to be
  // drawn at exactly the same height or a click lands on the wrong command:
  // both come from ROW_HEIGHT, and theme.css owns the colours only.
  const ROW_HEIGHT = 40;
  const ICON_PX    = 22;   // IconSet cells are 32px, scaled down to this
  const LABEL_PX   = 16;
  const MENU_WIDTH = 176;

  const ICON_SHEET_COLS = 16;   // IconSet.png is 16 cells across

  //=============================================================================
  // Command color palette
  //=============================================================================

  const COMMAND_COLORS = {
    move:         { accent: "#44dd44", rgb: [25,  140, 25 ] },
    attack:       { accent: "#e63232", rgb: [180, 25,  25 ] },
    reload:       { accent: "#e68832", rgb: [180, 100, 25 ] },
    defense:      { accent: "#3388ff", rgb: [25,  80,  180] },
    skill:        { accent: "#9944ee", rgb: [90,  35,  170] },
    basic:        { accent: "#66bbdd", rgb: [40,  120, 150] },
    item:         { accent: "#44cc88", rgb: [25,  140, 80 ] },
    guard:        { accent: "#ffdd44", rgb: [140, 120, 25 ] },
    switchspirit: { accent: "#cc66ff", rgb: [120, 50,  170] },
    escape:       { accent: "#aaaaaa", rgb: [90,  90,  90 ] },
  };

  const getCommandColors = (symbol) =>
    COMMAND_COLORS[symbol] || { accent: "#888888", rgb: [60, 60, 60] };

  // Fallback icons for commands injected by other plugins through the base
  // addCommand (which carries no iconIndex), keyed by symbol.
  const FALLBACK_ICONS = {
    move:         82,
    attack:       97,
    reload:       115,
    defense:      81,
    skill:        101,
    basic:        248,
    item:         209,
    guard:        125,
    switchspirit: 73,
    escape:       140,
  };

  // Mirrors CategorizedBattleSkills' category resolution: skills without an explicit
  // <category:...> note fall into the "Basic" catch-all category.
  const getSkillCategory = (skill) =>
    (skill && skill.meta && typeof skill.meta.category === 'string' && skill.meta.category.trim()) || "Basic";

  const isUsableSkill = (skill) =>
    skill && skill.name && skill.name.trim() && !skill.name.startsWith('<--');

  //=============================================================================
  // Scale helper (same pattern as MPP_SmoothBattleLog2)
  //=============================================================================

  // getBoundingClientRect() forces a synchronous layout; cache the canvas rect
  // and only recompute on resize instead of every frame from the command
  // window's per-frame update.
  let _cachedCmdScale = null;
  window.addEventListener('resize', () => { _cachedCmdScale = null; });

  function _cmdGetScale() {
    if (_cachedCmdScale) return _cachedCmdScale;
    const el = document.getElementById('gameCanvas');
    if (!el) return { sx: 1, sy: 1, ox: 0, oy: 0 };
    const r = el.getBoundingClientRect();
    _cachedCmdScale = {
      sx: r.width  / Graphics.width,
      sy: r.height / Graphics.height,
      ox: r.left,
      oy: r.top
    };
    return _cachedCmdScale;
  }

  //=============================================================================
  // Window_ActorCommand - Command List
  //=============================================================================

  Window_ActorCommand.prototype.makeCommandList = function () {
    if (!this._actor) return;

    // Map Battle Mode (MapBattleMode.js): lets the acting battler reposition
    // on the map (range driven by DEX/agi) before choosing an action. Only
    // usable once per turn; MapBattleMode itself owns the enabled/used state.
    if (window.MapBattleMode && window.MapBattleMode.isActive()) {
      const canMove = window.MapBattleMode.canUseMoveCommand(this._actor);
      this.addCommandWithIcon("", "move", canMove, null, 82);
    }

    // Ranged weapons (those with a bullet config) swap the attack icon for the
    // equipped weapon's own icon, and replace the Defense command with Reload.
    const bulletConfig = this._actor.getWeaponBulletConfig
      ? this._actor.getWeaponBulletConfig()
      : null;
    const hasRanged = !!bulletConfig;

    let attackIcon = 97;
    let attackExt = null;
    if (hasRanged) {
      const weapon = this._actor.weapons()[0];
      if (weapon && weapon.iconIndex > 0) attackIcon = weapon.iconIndex;
      // The live projectile count rides on the Attack command itself.
      attackExt = { current: this._actor.getCurrentBullets(), max: bulletConfig.max };
    }
    // Attack is ALWAYS enabled. It is the one action a battler can never be
    // left without, and every gate that used to grey it out read as a bug at
    // the counter: the attack skill's own cost (it is paid out of TP, so an
    // actor opening a fight below it could not swing), an empty magazine, or
    // Map Battle Mode's range check. None of those are legible from the button,
    // so the swing is offered and whatever refuses it does so where the reason
    // can be shown (the ammo counter on the command, the miss in the log).
    this.addCommandWithIcon("", "attack", true, attackExt, attackIcon);

    if (hasRanged) {
      // Reload doubles as Defense for ranged actors: commandReload both recharges
      // projectiles and guards. The bullet count now shows on Attack instead.
      this.addCommandWithIcon("", "reload", true, null, 115);
    } else {
      const defenseSkill = $dataSkills[2];
      const canDefend = defenseSkill && this._actor.canUse(defenseSkill);
      // Use the equipped off-hand item's icon (etypeId 2) when present.
      const offHand = this._actor.equips().find(e => e && e.etypeId === 2);
      const defenseIcon = (offHand && offHand.iconIndex > 0) ? offHand.iconIndex : 81;
      this.addCommandWithIcon("", "defense", canDefend, null, defenseIcon);
    }

    // One command per skill type (Magic, Skills, ...), each opening that type's
    // carried loadout (CategorizedBattleSkills.js). A type holding nothing the
    // actor can pay for greys out but still OPENS: the list is where the reason
    // is legible, one greyed cost per skill, and each unaffordable skill buzzes
    // there instead. Only a type with nothing carried refuses to open, since
    // there would be nothing to read.
    const skillTypes = this._actor.skillTypes();
    for (let i = skillTypes.length - 1; i >= 0; i--) {
      const stypeId = skillTypes[i];
      const iconIndex = stypeId === 2 ? 76 : 101;
      const carried = window.BattleLoadout
        ? window.BattleLoadout.battleSkills(this._actor, stypeId)
        : this._actor.skills().filter(skill => skill && skill.stypeId === stypeId);
      const listed = carried.filter(isUsableSkill);
      this.addCommandWithIcon("", "skill", listed.length > 0, stypeId, iconIndex,
        !this.hasCastableSkill(listed));
    }

    // The Basic kit is its own top-level command: those are the engine's
    // fallback moves and are always carried, so they never crowd a loadout.
    const basicKit = this._actor.skills()
      .filter(skill => isUsableSkill(skill) && getSkillCategory(skill) === "Basic"); // i18n-ignore: <category:Basic> note tag
    this.addCommandWithIcon("", "basic", basicKit.length > 0, null, 248,
      !this.hasCastableSkill(basicKit));

    // Backpack/Item: disabled (greyed + buzzer) when the party holds no
    // battle-usable item. Mirrors Window_BattleItem.includes ($gameParty.canUse).
    const hasUsableItem = $gameParty.allItems().some(item => $gameParty.canUse(item));
    this.addCommandWithIcon("", "item",  hasUsableItem,          null, 209);
    // Note: the standalone Guard command is intentionally omitted, it duplicates
    // the Defense command (both cast skill 2). The sole escape option is "Run" below.

    // Escape/Run row: always shown and always usable. Fleeing succeeds 100% via
    // PerfectEscape.js, so Run no longer hinges on BattleManager.canEscape() (the
    // game's main battle path sets canEscape=false). Handler set in
    // createActorCommandWindow (#110).
    this.addCommandWithIcon("", "escape", true, null, 140);
  };

  // Whether a skill/magic/basic list holds anything the actor can act with this
  // instant, the same question Game_Action asks when the turn resolves (MP/TP
  // payable, skill type not sealed, skill not sealed, weapon type allowed,
  // usable in battle). Nothing castable dims the row without locking it.
  Window_ActorCommand.prototype.hasCastableSkill = function (skills) {
    if (!this._actor || !skills || skills.length === 0) return false;
    return skills.some(skill => isUsableSkill(skill) && this._actor.canUse(skill));
  };

  // The command under the cursor, or true when there is nothing to read: used by
  // the handlers as a second line of defence against input routed past
  // isCurrentItemEnabled by another plugin.
  Window_ActorCommand.prototype.isCurrentCommandEnabled = function () {
    if (!this._list) return true;
    const cmd = this._list[this.index()];
    return !cmd || cmd.enabled !== false;
  };

  // `enabled` is the gate the input layer reads (a disabled row buzzes and opens
  // nothing); `dim` is the look alone, for a row that still opens but has
  // nothing usable behind it.
  Window_ActorCommand.prototype.addCommandWithIcon = function (name, symbol, enabled, ext, iconIndex, dim) {
    this._list.push({ name, symbol, enabled, ext, iconIndex, dim: !!dim });
  };

  Window_ActorCommand.prototype.getCommandName = function (symbol, ext) {
    switch (symbol) {
      case "move":    return T('Battle.cmd.move');
      case "attack":
        return (ext && typeof ext === "object" && ext.current != null)
          ? `${TextManager.attack} (${ext.current})`
          : TextManager.attack;
      case "defense": return T('Battle.cmd.defense');
      case "skill":   return ext ? ($dataSystem.skillTypes[ext] || T('Battle.cmd.skill')) : T('Battle.cmd.skills');
      case "basic":   return T('Battle.cmd.basic');
      case "guard":   return TextManager.guard;
      case "item":    return TextManager.item;
      case "reload":  return T('Battle.cmd.reload');
      case "escape":  return T('Battle.cmd.run');
      default:        return "";
    }
  };

  //=============================================================================
  // Window_ActorCommand - Layout (canvas window is invisible, just for input)
  //=============================================================================

  Window_ActorCommand.prototype.itemHeight    = function () { return ROW_HEIGHT; };
  // Visible rows / hit-test bound must track the EXACT command count. Padding to a
  // fixed minimum (e.g. max(6, n)) inflates the window height; because the window is
  // bottom-pinned and the HTML items render from its top, that padding pushes the
  // commands up and leaves a gap below them so they no longer sit at the bottom edge.
  Window_ActorCommand.prototype._visibleCommandCount = function () {
    const n = this._list ? this._list.length : 0;
    return Math.max(1, n);
  };
  Window_ActorCommand.prototype.numVisibleRows  = function () { return this._visibleCommandCount(); };
  Window_ActorCommand.prototype.maxVisibleItems = function () { return this._visibleCommandCount(); };
  Window_ActorCommand.prototype.maxCols       = function () { return 1; };
  Window_ActorCommand.prototype.itemWidth     = function () {
    return Math.floor((this.innerWidth + this.colSpacing()) / this.maxCols() - this.colSpacing());
  };

  // After the command list is (re)built, grow the window so every command sits inside
  // the hit-testable inner rect.
  const _Window_ActorCommand_refresh = Window_ActorCommand.prototype.refresh;
  Window_ActorCommand.prototype.refresh = function () {
    _Window_ActorCommand_refresh.call(this);
    const h = this.fittingHeight(this._visibleCommandCount());
    if (this.height !== h) {
      this.height = h;
      this.createContents();
    }
    // Bottom-align the menu: keep the list's bottom edge pinned so adding or
    // removing commands grows the window upward instead of pushing the lower
    // options off the bottom of the screen (or leaving a gap below).
    const scene = SceneManager._scene;
    if (scene && scene._bseCommandBottomY != null) {
      const newY = scene._bseCommandBottomY - this.height;
      if (this.y !== newY) this.y = newY;
    }
  };

  //=============================================================================
  // Window_ActorCommand - No canvas drawing (HTML replaces it)
  //=============================================================================

  Window_ActorCommand.prototype.drawItem    = function () {};
  Window_ActorCommand.prototype.drawAllItems = function () {
    this._rebuildCmdHtml();
  };
  Window_ActorCommand.prototype.refreshCursor = function () {
    this.setCursorRect(0, 0, 0, 0);
  };

  //=============================================================================
  // Window_ActorCommand - HTML Overlay Init
  //=============================================================================

  const _Window_ActorCommand_initialize = Window_ActorCommand.prototype.initialize;
  Window_ActorCommand.prototype.initialize = function (rect) {
    _Window_ActorCommand_initialize.call(this, rect);
    this.opacity      = 0;
    this.backOpacity  = 0;
    this.frameVisible = false;
    this.hideBackgroundDimmer();
    this._initCmdHtml();
  };

  Window_ActorCommand.prototype._initCmdHtml = function () {
    const old = document.getElementById('html-actorcmd-overlay');
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = 'html-actorcmd-overlay';
    root.style.cssText =
      'position:fixed;display:none;z-index:350;pointer-events:none;' +
      'transform-origin:top left;';
    document.body.appendChild(root);
    this._cmdHtmlRoot = root;

  };

  //=============================================================================
  // Window_ActorCommand - Rebuild HTML items
  //=============================================================================

  Window_ActorCommand.prototype._rebuildCmdHtml = function () {
    if (!this._cmdHtmlRoot || !this._list) return;

    const root = this._cmdHtmlRoot;
    root.innerHTML = '';

    // The rows are laid over the window's INNER rect (see _updateCmdHtmlPos),
    // which is the rect the canvas window hit-tests commands in.
    const rowW = this.innerWidth || (this.width - this.padding * 2);

    for (let i = 0; i < this._list.length; i++) {
      const cmd       = this._list[i];
      const isSel     = (i === this.index());
      // Locked and merely-nothing-usable both read as greyed; only the first
      // refuses to open.
      const isLit     = cmd.enabled !== false && !cmd.dim;
      const { accent, rgb } = getCommandColors(cmd.symbol);

      // Outer item container
      const item = document.createElement('div');
      item.className = 'actorcmd-item';
      item.style.width  = rowW + 'px';
      item.style.height = ROW_HEIGHT + 'px';

      // Dark base layer
      const darkBase = document.createElement('div');
      darkBase.className = 'actorcmd-darkbase';
      item.appendChild(darkBase);

      // Colored gradient layer
      const grad = document.createElement('div');
      grad.className = 'actorcmd-gradient';
      const a0 = isSel ? 0.88 : 0.60;
      const a1 = isSel ? 0.32 : 0.18;
      grad.style.background =
        `linear-gradient(to right, rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a0}) 0%, ` +
        `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a1}) 55%, transparent 100%)`;
      item.appendChild(grad);

      // Left accent stripe
      const stripe = document.createElement('div');
      stripe.className = 'actorcmd-stripe' + (isSel ? ' sel' : '');
      stripe.style.background = accent;
      stripe.style.color = accent; // for box-shadow currentColor
      item.appendChild(stripe);

      // Top highlight (selected)
      if (isSel) {
        const hl = document.createElement('div');
        hl.className = 'actorcmd-top-hl';
        item.appendChild(hl);
      }

      // Bottom separator
      const sep = document.createElement('div');
      sep.className = 'actorcmd-sep';
      sep.style.background = isSel ? accent : 'rgba(255,255,255,0.09)';
      item.appendChild(sep);

      // Icon (fall back to a per-symbol default for commands added by other
      // plugins without an explicit iconIndex)
      const iconIdx = cmd.iconIndex || FALLBACK_ICONS[cmd.symbol] || 0;
      if (iconIdx > 0) {
        const col   = iconIdx % ICON_SHEET_COLS;
        const row   = Math.floor(iconIdx / ICON_SHEET_COLS);
        const icon  = document.createElement('div');
        icon.className = 'actorcmd-icon' + (isLit ? '' : ' dim');
        icon.style.width  = ICON_PX + 'px';
        icon.style.height = ICON_PX + 'px';
        // The whole sheet is scaled down with the cell, so the cell offsets
        // shrink by the same factor.
        icon.style.backgroundSize = `${ICON_SHEET_COLS * ICON_PX}px auto`;
        icon.style.backgroundPosition =
          `${-col * ICON_PX}px ${-row * ICON_PX}px`;
        item.appendChild(icon);
      }

      // Label (fall back to the command's own name for symbols this window
      // doesn't know about, e.g. plugin-injected commands)
      const name  = this.getCommandName(cmd.symbol, cmd.ext) || cmd.name || "";
      const label = document.createElement('div');
      label.className = 'actorcmd-label' + (isLit ? '' : ' dim');
      label.style.fontSize = LABEL_PX + 'px';
      label.textContent = (typeof translateText === 'function') ? translateText(name) : name;
      item.appendChild(label);

      root.appendChild(item);
    }
  };

  //=============================================================================
  // Window_ActorCommand - Update: position overlay each frame
  //=============================================================================

  const _Window_ActorCommand_update = Window_ActorCommand.prototype.update;
  Window_ActorCommand.prototype.update = function () {
    _Window_ActorCommand_update.apply(this, arguments);

    // Keep canvas layer invisible
    this.opacity      = 0;
    this.backOpacity  = 0;
    this.frameVisible = false;
    if (this._contentsBackSprite) this._contentsBackSprite.visible = false;

    this._updateCmdHtmlPos();
  };

  Window_ActorCommand.prototype._updateCmdHtmlPos = function () {
    if (!this._cmdHtmlRoot) return;

    const opacity = this.visible ? (this.openness / 255) : 0;
    const s       = this._cmdHtmlRoot.style;

    // Read scale AFTER the closed-window guard, so a hidden command menu does
    // no work (and, before caching, forced no reflow).
    if (opacity <= 0) {
      if (this._cmdLastDisplay !== 'none') {
        s.display = 'none';
        this._cmdLastDisplay = 'none';
      }
      return;
    }

    const sc = _cmdGetScale();

    // Resolve global canvas position via PIXI transform chain
    let pt;
    if (typeof this.getGlobalPosition === 'function') {
      pt = this.getGlobalPosition();
    } else {
      pt = { x: this.x, y: this.y };
      let node = this.parent;
      while (node) { pt.x += node.x || 0; pt.y += node.y || 0; node = node.parent; }
    }

    // The rows are laid over the window's inner rect, not its frame: that is
    // where the canvas window puts item 0, so the HTML the player clicks and
    // the row the click resolves to are the same rectangle.
    const pad = this.padding || 0;

    // Dirty-check each property: only touch the DOM when a value actually
    // changed, instead of rewriting all five style props every frame.
    const left       = (sc.ox + (pt.x + pad) * sc.sx) + 'px';
    const top        = (sc.oy + (pt.y + pad) * sc.sy) + 'px';
    const transform  = `scale(${sc.sx}, ${sc.sy})`;
    const opacityStr = String(opacity);

    if (this._cmdLastDisplay !== 'block') { s.display = 'block'; this._cmdLastDisplay = 'block'; }
    if (this._cmdLastLeft !== left)           { s.left = left; this._cmdLastLeft = left; }
    if (this._cmdLastTop !== top)             { s.top = top; this._cmdLastTop = top; }
    if (this._cmdLastTransform !== transform) { s.transform = transform; this._cmdLastTransform = transform; }
    if (this._cmdLastOpacity !== opacityStr)  { s.opacity = opacityStr; this._cmdLastOpacity = opacityStr; }
  };

  //=============================================================================
  // Window_ActorCommand - Cleanup
  //=============================================================================

  const _Window_ActorCommand_destroy = Window_ActorCommand.prototype.destroy;
  Window_ActorCommand.prototype.destroy = function (options) {
    if (this._cmdHtmlRoot && this._cmdHtmlRoot.parentNode) {
      this._cmdHtmlRoot.parentNode.removeChild(this._cmdHtmlRoot);
    }
    this._cmdHtmlRoot = null;
    if (typeof _Window_ActorCommand_destroy === 'function') {
      _Window_ActorCommand_destroy.call(this, options);
    }
  };

  //=============================================================================
  // Window_ActorCommand - Selection triggers rebuild
  //=============================================================================

  const _Window_ActorCommand_select = Window_ActorCommand.prototype.select;
  Window_ActorCommand.prototype.select = function (index) {
    _Window_ActorCommand_select.call(this, index);
    if (this._list && this._list.length > 0) this.refresh();
  };

  //=============================================================================
  // Scene_Battle - Window rect & positioning
  //=============================================================================

  // Default right-edge placement. Nudge the menu so it sits clear of the weapon
  // sprite while keeping the (sometimes wide) labels fully on-screen.
  Scene_Battle.prototype._bseCommandRightX = function (cmdWidth) {
    const rightEdge = Graphics.boxWidth + Math.floor((Graphics.width - Graphics.boxWidth) / 2);
    const xOffset   = -30;
    return rightEdge - cmdWidth + xOffset;
  };

  // In split-screen, place the command menu on the active player's side:
  // Player 1 on the left, Player 2 on the right (the regular position).
  Scene_Battle.prototype._bseCommandX = function (cmdWidth) {
    const rightX = this._bseCommandRightX(cmdWidth);
    const split  = window.$gameSplitScreen && window.$gameSplitScreen.active;
    const actor  = BattleManager.actor();
    const onLeft = split && actor && actor.multiplayerPlayerId && actor.multiplayerPlayerId() === 1;
    if (!onLeft) return rightX;
    // Pin Player 1's menu near the left edge, mirroring the right margin.
    const xOffset = -30;
    return -xOffset;
  };

  Scene_Battle.prototype.actorCommandWindowRect = function () {
    const cmdWidth = MENU_WIDTH;
    // Pin the command menu to the bottom edge of the screen. refresh() bottom-aligns
    // the window to _bseCommandBottomY, so the last command always sits just above the
    // bottom margin and the list grows upward as more commands are exposed.
    const margin = 12;
    this._bseCommandBottomY = Graphics.boxHeight - margin;
    const height = this.windowAreaHeight();
    const y = this._bseCommandBottomY - height;
    return new Rectangle(this._bseCommandX(cmdWidth), y, cmdWidth, height);
  };

  // Re-place the command window each time an actor starts inputting so it
  // follows whichever player is active during a split-screen battle.
  const _BSEC_startActorCommandSelection = Scene_Battle.prototype.startActorCommandSelection;
  Scene_Battle.prototype.startActorCommandSelection = function () {
    _BSEC_startActorCommandSelection.call(this);
    if (this._actorCommandWindow) {
      this._actorCommandWindow.x = this._bseCommandX(this._actorCommandWindow.width);
    }
  };

  //=============================================================================
  // Scene_Battle - Handlers
  //=============================================================================

  Scene_Battle.prototype.createCancelButton = function () {};

  const _Scene_Battle_createActorCommandWindow = Scene_Battle.prototype.createActorCommandWindow;
  Scene_Battle.prototype.createActorCommandWindow = function () {
    _Scene_Battle_createActorCommandWindow.call(this);
    this._actorCommandWindow.setHandler("reload",  this.commandReload.bind(this));
    this._actorCommandWindow.setHandler("defense", this.commandDefense.bind(this));
    this._actorCommandWindow.setHandler("basic",   this.commandBasic.bind(this));
    this._actorCommandWindow.setHandler("escape",  this.commandEscape.bind(this));
  };

  // Guard: refuse to open a skill/magic/basic menu when its command is disabled
  // (i.e. the actor has no skills for it). Even though disabled commands normally
  // buzz at the input layer, this makes "don't open an empty menu" explicit and
  // robust against other plugins that might route past isCurrentItemEnabled.
  Scene_Battle.prototype._bseCurrentCommandEnabled = function () {
    const win = this._actorCommandWindow;
    if (!win) return true;
    return win.isCurrentCommandEnabled();
  };

  // Open the skill window showing only Basic-category skills across all skill types.
  Scene_Battle.prototype.commandBasic = function () {
    if (!this._bseCurrentCommandEnabled()) {
      SoundManager.playBuzzer();
      this._actorCommandWindow.activate();
      return;
    }
    this._skillWindow.setActor(BattleManager.actor());
    if (this._skillWindow.setBasicMode) this._skillWindow.setBasicMode(true);
    this._skillWindow.setStypeId(0);
    this._skillWindow.refresh();
    this._skillWindow.show();
    this._skillWindow.activate();
  };

  // A normal skill-type command clears any lingering Basic view.
  const _Scene_Battle_commandSkill = Scene_Battle.prototype.commandSkill;
  Scene_Battle.prototype.commandSkill = function () {
    if (!this._bseCurrentCommandEnabled()) {
      SoundManager.playBuzzer();
      this._actorCommandWindow.activate();
      return;
    }
    if (this._skillWindow.setBasicMode) this._skillWindow.setBasicMode(false);
    _Scene_Battle_commandSkill.call(this);
  };

  Scene_Battle.prototype.commandDefense = function () {
    BattleManager.inputtingAction().setSkill(2);
    this.selectNextCommand();
  };

  Scene_Battle.prototype.commandReload = function () {
    const actor = BattleManager.actor();
    if (actor) {
      actor.reloadBullets();
      // Reloading also raises the actor's guard via the Defense skill (id 2).
      const defenseSkill = $dataSkills[2];
      if (defenseSkill && actor.canUse(defenseSkill)) {
        BattleManager.inputtingAction().setSkill(2);
      } else {
        BattleManager.inputtingAction().setGuard();
      }
      this.selectNextCommand();
    }
  };

  Scene_Battle.prototype.selectPreviousCommand = function () {
    if (BattleManager.selectPreviousCommand()) {
      this.startActorCommandSelection();
    } else {
      SoundManager.playBuzzer();
    }
  };

  Scene_Battle.prototype.changeInputWindow = function () {
    this.hideSubInputWindows();
    if (BattleManager.isInputting()) {
      if (BattleManager.actor()) {
        this.startActorCommandSelection();
      }
    } else {
      this.endCommandSelection();
    }
  };

  const _Window_ActorCommand_processOk = Window_ActorCommand.prototype.processOk;
  Window_ActorCommand.prototype.processOk = function () {
    _Window_ActorCommand_processOk.call(this);
    TouchInput.clear();
  };

  //=============================================================================
  // Compatibility stubs
  //=============================================================================

  Window_ActorCommand.prototype.addSkillCommand  = function (stypeId) { this.addCommand("", "skill", true, stypeId, 101); };
  Window_ActorCommand.prototype.addItemCommand   = function ()         { this.addCommand("", "item",  true, 176); };
  Window_ActorCommand.prototype.addGuardCommand  = function ()         { this.addCommand("", "guard", this._actor.canGuard(), 52); };

})();
