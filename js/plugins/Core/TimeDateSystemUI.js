/*:
 * @target MZ
 * @plugindesc v1.0.0 Parchment DOM popup for the TimeDateSystem sleep menu.
 * @author Hypernet
 * @help
 * === TimeDateSystem UI v1.0.0 ===
 *
 * UI layer for the TimeDateSystem.js sleep menu. Replaces the old
 * Window_SleepMenu (native Window_Command) with a parchment army-dialog
 * popup following the unified D&D pockets design language.
 *
 * Defines on Scene_Map:
 *   openSleepMenu(mode)      - "main" (default), "sleep", "wait", "post_sleep"
 *   openWaitMenu()           - the wait list on its own, resting not offered
 *   openCryogenicSleepMenu() - opens directly to cryo year selection
 *   closeSleepMenu(keepBlocking)
 *   execSleepMenuCommand(key)
 *   cancelSleepMenu()
 *
 * Resting is an entry-point decision. Beds, campfires, tents and world-map
 * camps open the menu as a rest ("main"), where Sleep refills the sleep meter
 * in full whatever wake-up hour is picked. The menu tile and the T hotkey open
 * openWaitMenu(), which only runs the clock forward and never rests the party.
 *
 * Must be placed AFTER Core/TimeDateSystem in the plugin manager.
 * Requires css/theme.css (.army-dialog-overlay / .army-dialog /
 * .army-dialog-options / .army-dialog-btn--row).
 */

(function () {
  "use strict";

  if (!window.TimeDateSystem || !window.TimeDateSystem.sleepMenuI18n) {
    throw new Error("TimeDateSystemUI.js requires TimeDateSystem.js!");
  }


  // While Em travels with the party the rest menu picks up her vocabulary
  // (CharacterCreationPresets.emLabel): nobody rests, they nap, and nobody
  // waits, they waste time. Every other playthrough gets the table unchanged,
  // since each label is passed in as its own fallback.
  function sleepLabels() {
    const base = window.TimeDateSystem.sleepMenuI18n;
    const CP = window.CharacterPresets;
    if (!CP || !CP.emLabel || !CP.isEmPlaythrough || !CP.isEmPlaythrough()) return base;
    return Object.assign({}, base, {
      titleMain:  CP.emLabel("restTitle",    base.titleMain),
      titleSleep: CP.emLabel("sleepHowLong", base.titleSleep),
      titleWait:  CP.emLabel("waitHowLong",  base.titleWait),
      sleep:      CP.emLabel("sleep",        base.sleep),
      wait:       CP.emLabel("wait",         base.wait),
      wakeup:     CP.emLabel("wakeup",       base.wakeup),
      dream:      CP.emLabel("dream",        base.dream),
    });
  }

  // Sleeping is decided by the entry point, not by proximity: a bed, a
  // campfire, a tent or a world-map camp opens the menu as a rest (mode
  // "main", sleeping allowed), while the menu tile and the T hotkey open the
  // wait list directly, where the clock runs forward but nobody rests.
  function sleepAllowedFor(scene) {
    return !!(scene && scene._sleepMenuAllowSleep);
  }

  // Duration label for a possibly fractional hour count (0.5 -> "30 Minutes").
  function durationLabel(t, h) {
    if (h === 0.5) return t.halfHour;
    if (h === 1) return t.hourWait;
    return t.hours.format(h);
  }

  // Clock time the player will wake up at after sleeping/waiting `h` hours,
  // shown to the right of the duration so the choice reads "2 Hours -> 14:00".
  function wakeTimeLabel(h) {
    const TDS = window.TimeDateSystem;
    if (!TDS || !TDS.getGameTimeMinutes || !TDS.getDateTimeFromMinutes) return "";
    const mins = TDS.getGameTimeMinutes() + Math.round(h * 60);
    const dt = TDS.getDateTimeFromMinutes(mins);
    return dt && dt.time24 ? dt.time24 : "";
  }

  // Both Sleep and Wait now share the same duration range: a half-hour nap
  // up to a full 24-hour day, at every hour mark (no more sparse jumps, no
  // more six-hour cap on waiting).
  const ALL_HOURS = [0.5].concat(
    Array.from({ length: 24 }, (_, i) => i + 1)
  );

  function commandsForMode(mode, allowSleep) {
    const t = sleepLabels();
    if (mode === "sleep") {
      const cmds = ALL_HOURS.map((h) => ({
        key: "hours_" + h,
        label: durationLabel(t, h),
        rightLabel: wakeTimeLabel(h),
      }));
      cmds.push({ key: "cancel_sleep", label: t.cancel });
      return cmds;
    }
    // Bethesda-style waiting: available anywhere (T on the map), passes the
    // clock without resting the party, so it never refills the sleep meter.
    if (mode === "wait") {
      const cmds = ALL_HOURS.map((h) => ({
        key: "wait_" + h,
        label: durationLabel(t, h),
        rightLabel: wakeTimeLabel(h),
      }));
      cmds.push({ key: "cancel_wait", label: t.cancel });
      return cmds;
    }
    // Only shown after a long sleep that rolled a dream (see TimeDateSystem's
    // _finishSleepAdvance): take the dream, or cancel it and just wake up.
    if (mode === "post_sleep") {
      return [
        { key: "dream", label: t.dream },
        { key: "wakeup", label: t.cancel },
      ];
    }
    if (mode === "cryo") {
      const years = (window.TimeDateSystem.getCryoYears &&
        window.TimeDateSystem.getCryoYears()) || [];
      const cmds = years.map((y) => ({
        key: "cryo_" + y,
        label: (y >= 2012 ? t.cryoFinalYear : t.cryoYear).format(y),
      }));
      cmds.push({ key: "cancel_sleep", label: t.cancel });
      return cmds;
    }
    // Main menu: the wait/sleep choice that fronts both duration lists
    // (cryogenic sleep has its own command). Sleeping needs a place to rest,
    // waiting is always allowed.
    const mainCommands = [];
    if (allowSleep) mainCommands.push({ key: "sleep", label: t.sleep });
    mainCommands.push({ key: "wait", label: t.wait });
    mainCommands.push({ key: "save", label: t.save });
    // Hardcore (Permadeath) and Blood and Oil use terminal death, so there is
    // no respawn point to set; hide the option in those modes (Switch 9).
    if (!(window.$gameSwitches && $gameSwitches.value(9))) {
      mainCommands.push({ key: "respawn", label: t.respawn });
    }
    mainCommands.push({ key: "cancel", label: t.cancel });
    return mainCommands;
  }

  // RMMZ swallows every wheel event at the document level (rmmz_core.js,
  // TouchInput._onWheel calls preventDefault), so the duration list never
  // scrolls on its own and the scrollbar can only be dragged. The overlay
  // handles the wheel itself instead; it is bound once per overlay and looks
  // the pane up live, since the dialog's innerHTML is rebuilt on every refresh.
  function bindSleepMenuWheel(el) {
    if (!el || el._sleepMenuWheelBound) return;
    el._sleepMenuWheelBound = true;
    el.addEventListener(
      "wheel",
      (e) => {
        const pane = el.querySelector(".army-dialog-options--scroll");
        if (!pane) return;
        e.preventDefault();
        // Wheel deltas arrive in pixels, lines or pages depending on the device.
        const step = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
        pane.scrollTop += e.deltaY * step;
      },
      { passive: false }
    );
  }

  function titleForMode(mode) {
    const t = sleepLabels();
    if (mode === "sleep") return t.titleSleep;
    if (mode === "wait") return t.titleWait;
    if (mode === "post_sleep") return t.titlePostSleep;
    if (mode === "cryo") return t.titleCryo;
    return t.titleMain;
  }

  //=============================================================================
  // SleepMenuInputManager
  //=============================================================================

  const SleepMenuInputManager = {
    _scene: null,
    _active: false,
    _openedFrame: 0,
    _wasdInput: { up: false, down: false },
    _wasdHeld: { up: false, down: false },
    _wasdHoldFrames: { up: 0, down: 0 },
    // A/D are a one-shot Sleep<->Wait toggle, not a held-repeat scrub, so
    // they only need a simple "was pressed this frame" flag.
    _adInput: { left: false, right: false },
    _keydownListener: null,
    _keyupListener: null,

    activate(scene) {
      this._scene = scene;
      this._active = true;
      this._openedFrame = Graphics.frameCount;
      this._wasdInput.up = this._wasdInput.down = false;
      this._wasdHeld.up = this._wasdHeld.down = false;
      this._wasdHoldFrames.up = this._wasdHoldFrames.down = 0;
      this._adInput.left = this._adInput.right = false;
      if (!this._keydownListener) {
        this._keydownListener = (event) => {
          if (event.repeat) return;
          const key = event.key.toLowerCase();
          if (key === "w") { this._wasdInput.up = true; this._wasdHeld.up = true; event.preventDefault(); }
          if (key === "s") { this._wasdInput.down = true; this._wasdHeld.down = true; event.preventDefault(); }
          if (key === "a") { this._adInput.left = true; event.preventDefault(); }
          if (key === "d") { this._adInput.right = true; event.preventDefault(); }
        };
        this._keyupListener = (event) => {
          const key = event.key.toLowerCase();
          if (key === "w") { this._wasdHeld.up = false; this._wasdHoldFrames.up = 0; }
          if (key === "s") { this._wasdHeld.down = false; this._wasdHoldFrames.down = 0; }
        };
        window.addEventListener("keydown", this._keydownListener);
        window.addEventListener("keyup", this._keyupListener);
      }
    },

    deactivate() {
      this._active = false;
      this._scene = null;
      if (this._keydownListener) {
        window.removeEventListener("keydown", this._keydownListener);
        window.removeEventListener("keyup", this._keyupListener);
        this._keydownListener = null;
        this._keyupListener = null;
      }
    },

    update() {
      if (!this._active || !this._scene) return;
      const scene = this._scene;
      if (!scene._sleepMenuEl) return;
      // Swallow the key press that opened the menu
      if (Graphics.frameCount - this._openedFrame < 4) return;

      // WASD hold-repeat simulation (matches MZ key-repeat timing)
      for (const dir of ["up", "down"]) {
        if (this._wasdHeld[dir]) {
          this._wasdHoldFrames[dir]++;
          const held = this._wasdHoldFrames[dir];
          if (held > Input.keyRepeatWait && (held - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
            this._wasdInput[dir] = true;
          }
        } else {
          this._wasdHoldFrames[dir] = 0;
        }
      }

      const isUp = Input.isRepeated("up") || this._wasdInput.up;
      const isDown = Input.isRepeated("down") || this._wasdInput.down;
      this._wasdInput.up = this._wasdInput.down = false;

      // Left/Right (arrow keys, A/D, or a gamepad d-pad/stick, all of which
      // RPG Maker's Input class already maps to "left"/"right") flips the
      // Sleep <-> Wait selector while a duration list is open.
      const isLeft = Input.isTriggered("left") || this._adInput.left;
      const isRight = Input.isTriggered("right") || this._adInput.right;
      this._adInput.left = this._adInput.right = false;
      if (
        (isLeft || isRight) &&
        (scene._sleepMenuMode === "sleep" || scene._sleepMenuMode === "wait")
      ) {
        scene._toggleSleepMenuType();
        return;
      }

      const cmds = commandsForMode(scene._sleepMenuMode, sleepAllowedFor(scene));
      const total = cmds.length;
      if (isUp) {
        scene._sleepMenuIndex = (scene._sleepMenuIndex - 1 + total) % total;
        SoundManager.playCursor();
        scene._updateSleepMenuHighlight(true);
        return;
      }
      if (isDown) {
        scene._sleepMenuIndex = (scene._sleepMenuIndex + 1) % total;
        SoundManager.playCursor();
        scene._updateSleepMenuHighlight(true);
        return;
      }
      if (Input.isTriggered("ok")) {
        const cmd = cmds[scene._sleepMenuIndex];
        if (cmd) scene.execSleepMenuCommand(cmd.key);
        return;
      }
      if (Input.isTriggered("escape") || Input.isTriggered("cancel") || TouchInput.isCancelled()) {
        scene.cancelSleepMenu();
      }
    },
  };

  //=============================================================================
  // Scene_Map, sleep menu popup
  //=============================================================================

  Scene_Map.prototype.openSleepMenu = function (mode) {
    this._sleepMenuMode = mode || "main";
    this._sleepMenuIndex = 0;
    // Remember whether the wait list is the entry point (T with no bed nearby)
    // or a page under the rest menu, so Cancel goes back to the right place.
    this._sleepMenuDirectWait = this._sleepMenuMode === "wait";
    // Resting is an entry-point decision: everything but the direct wait list
    // was opened from a bed, a campfire, a tent or a camp, so it may sleep.
    this._sleepMenuAllowSleep = !this._sleepMenuDirectWait;
    $gameTemp._sleepMenuOpen = true;
    if (!this._sleepMenuEl) {
      const el = document.createElement("div");
      el.id = "sleep-menu-overlay";
      el.className = "army-dialog-overlay";
      el.style.opacity = "0";
      el.style.transition = "opacity 0.22s ease-out";
      document.body.appendChild(el);
      this._sleepMenuEl = el;
      setTimeout(() => {
        if (this._sleepMenuEl) this._sleepMenuEl.style.opacity = "1";
      }, 16);
    }
    this._refreshSleepMenuDOM();
    SleepMenuInputManager.activate(this);
  };

  // The T hotkey / menu tile: pure Bethesda waiting. The clock runs forward
  // and the needs wear down, but the party never rests, so this entry point
  // can neither refill the sleep meter nor reach the sleep list.
  Scene_Map.prototype.openWaitMenu = function () {
    this.openSleepMenu("wait");
  };

  // Opens directly to cryogenic sleep year selection (bypassing the main menu)
  Scene_Map.prototype.openCryogenicSleepMenu = function () {
    this._sleepMenuMode = "cryo";
    this._sleepMenuIndex = 0;
    this._sleepMenuDirectWait = false;
    this._sleepMenuAllowSleep = true;
    $gameTemp._sleepMenuOpen = true;
    if (!this._sleepMenuEl) {
      const el = document.createElement("div");
      el.id = "sleep-menu-overlay";
      el.className = "army-dialog-overlay";
      el.style.opacity = "0";
      el.style.transition = "opacity 0.22s ease-out";
      document.body.appendChild(el);
      this._sleepMenuEl = el;
      setTimeout(() => {
        if (this._sleepMenuEl) this._sleepMenuEl.style.opacity = "1";
      }, 16);
    }
    this._refreshSleepMenuDOM();
    SleepMenuInputManager.activate(this);
  };

  Scene_Map.prototype._refreshSleepMenuDOM = function () {
    if (!this._sleepMenuEl) return;
    bindSleepMenuWheel(this._sleepMenuEl);
    const mode = this._sleepMenuMode;
    const cmds = commandsForMode(mode, sleepAllowedFor(this));
    const optionsHTML = cmds
      .map((cmd, i) => {
        const inner = cmd.rightLabel
          ? `<span class="army-dialog-btn__label">${cmd.label}</span><span class="army-dialog-btn__wake">${cmd.rightLabel}</span>`
          : cmd.label;
        return `<div class="army-dialog-btn army-dialog-btn--row${
          cmd.rightLabel ? " army-dialog-btn--split" : ""
        }${i === this._sleepMenuIndex ? " selected" : ""}" data-cmd="${
          cmd.key
        }">${inner}</div>`;
      })
      .join("");
    const isDuration = mode === "sleep" || mode === "wait";
    const typeSelectorHTML = isDuration ? this._sleepMenuTypeSelectorHTML() : "";
    this._sleepMenuEl.innerHTML = `
      <div class="army-dialog">
        <h3>${titleForMode(mode)}</h3>
        ${typeSelectorHTML}
        <div class="army-dialog-options${isDuration ? " army-dialog-options--scroll" : ""}">${optionsHTML}</div>
      </div>`;
    this._sleepMenuEl.querySelectorAll(".army-dialog-btn").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        this._sleepMenuIndex = i;
        this.execSleepMenuCommand(btn.dataset.cmd);
      });
      btn.addEventListener("mouseenter", () => {
        if (this._sleepMenuIndex !== i) {
          this._sleepMenuIndex = i;
          this._updateSleepMenuHighlight();
        }
      });
    });
    if (isDuration) {
      const arrows = this._sleepMenuEl.querySelectorAll(".army-dialog-type-arrow");
      arrows.forEach((arrow) => {
        arrow.addEventListener("click", () => this._toggleSleepMenuType());
      });
      // The list is rebuilt scrolled to the top, so a selection kept across a
      // Sleep <-> Wait flip has to be brought back under the cursor.
      this._updateSleepMenuHighlight(true);
    }
  };

  // Sleep <-> Wait toggle row shown above the duration list. Only offered
  // when both choices are actually available (Sleep needs a place to rest);
  // otherwise there is nothing to switch to and the row is omitted.
  Scene_Map.prototype._sleepMenuTypeSelectorHTML = function () {
    const t = sleepLabels();
    if (!sleepAllowedFor(this)) return "";
    const label = this._sleepMenuMode === "sleep" ? t.sleep : t.wait;
    return `<div class="army-dialog-type-selector">
      <span class="army-dialog-type-arrow" data-dir="left">&#9668;</span>
      <span class="army-dialog-type-label">${label}</span>
      <span class="army-dialog-type-arrow" data-dir="right">&#9658;</span>
    </div>`;
  };

  // Flips between the Sleep and Wait duration lists in place, keeping the
  // same duration highlighted since both lists share the same hour range.
  Scene_Map.prototype._toggleSleepMenuType = function () {
    const target = this._sleepMenuMode === "sleep" ? "wait" : "sleep";
    if (target === "sleep" && !sleepAllowedFor(this)) return;
    SoundManager.playCursor();
    this._sleepMenuMode = target;
    this._refreshSleepMenuDOM();
  };

  // scroll: drag the list along with the cursor. Keyboard and pad navigation
  // pass it, since the duration list runs well past the bottom of its pane and
  // a cursor moved off screen would otherwise be invisible; the mouse never
  // does, because the row it highlights is by definition already under the
  // pointer and nudging the list would move it out from under it.
  Scene_Map.prototype._updateSleepMenuHighlight = function (scroll) {
    if (!this._sleepMenuEl) return;
    let selected = null;
    this._sleepMenuEl.querySelectorAll(".army-dialog-btn").forEach((btn, i) => {
      const on = i === this._sleepMenuIndex;
      btn.classList.toggle("selected", on);
      if (on) selected = btn;
    });
    if (scroll && selected && selected.scrollIntoView) {
      selected.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  Scene_Map.prototype._setSleepMenuMode = function (mode) {
    this._sleepMenuMode = mode;
    this._sleepMenuIndex = 0;
    this._refreshSleepMenuDOM();
  };

  // keepBlocking: leaves $gameTemp._sleepMenuOpen on so the player stays frozen
  // through the fade/sleep sequence until the post-sleep menu resolves.
  Scene_Map.prototype.closeSleepMenu = function (keepBlocking) {
    SleepMenuInputManager.deactivate();
    if (!keepBlocking) $gameTemp._sleepMenuOpen = false;
    if (this._sleepMenuEl) {
      const el = this._sleepMenuEl;
      this._sleepMenuEl = null;
      el.style.transition = "opacity 0.2s ease-out";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 200);
    }
  };

  Scene_Map.prototype.cancelSleepMenu = function () {
    SoundManager.playCancel();
    if (this._sleepMenuMode === "sleep") {
      this._setSleepMenuMode("main");
    } else if (this._sleepMenuMode === "wait") {
      // Backing out returns to the rest menu when that is where waiting was
      // picked from, and closes outright when T opened the wait list directly.
      if (this._sleepMenuDirectWait) {
        this.closeSleepMenu();
      } else {
        this._setSleepMenuMode("main");
      }
    } else if (this._sleepMenuMode === "cryo") {
      // Cryogenic sleep is a direct entry point, so cancel closes the menu
      this.closeSleepMenu();
    } else if (this._sleepMenuMode === "post_sleep") {
      // Backing out of the post-sleep menu must still fade the screen back in
      this.closeSleepMenu();
      $gameScreen.startFadeIn(60);
    } else {
      this.closeSleepMenu();
    }
  };

  Scene_Map.prototype.execSleepMenuCommand = function (key) {
    if (key.startsWith("hours_")) {
      const hours = Number(key.slice(6));
      SoundManager.playOk();
      this.closeSleepMenu(true);
      this.startSleepSequence(hours);
      return;
    }
    if (key.startsWith("wait_")) {
      const hours = Number(key.slice(5));
      SoundManager.playOk();
      this.closeSleepMenu(true);
      this.startSleepSequence(hours, true);
      return;
    }
    if (key.startsWith("cryo_")) {
      const year = Number(key.slice(5));
      const minutes = window.TimeDateSystem.getCryoAdvanceMinutes
        ? window.TimeDateSystem.getCryoAdvanceMinutes(year)
        : 0;
      if (minutes > 0) {
        SoundManager.playOk();
        this.closeSleepMenu(true);
        this.startCryoSequence(minutes);
      } else {
        this.cancelSleepMenu();
      }
      return;
    }
    switch (key) {
      case "sleep":
        SoundManager.playOk();
        this._setSleepMenuMode("sleep");
        break;
      case "wait":
        SoundManager.playOk();
        this._setSleepMenuMode("wait");
        break;
      case "save":
        SoundManager.playOk();
        this.closeSleepMenu();
        SceneManager.push(Scene_Save);
        break;
      case "respawn":
        this.setSleepRespawnPoint();
        SoundManager.playOk();
        break;
      case "cancel":
      case "cancel_sleep":
      case "cancel_wait":
        this.cancelSleepMenu();
        break;
      case "wakeup":
        SoundManager.playOk();
        this.closeSleepMenu();
        $gameScreen.startFadeIn(60);
        break;
      case "dream":
        SoundManager.playOk();
        this.closeSleepMenu();
        PluginManager.callCommand(this, "DreamSystem", "StartDream", {});
        $gameScreen.startFadeIn(60);
        break;
    }
  };

  const _Scene_Map_update_sleepUI = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update_sleepUI.call(this);
    SleepMenuInputManager.update();
  };

  // Esc doubles as the "menu" key in MZ, block the main menu while the popup
  // is open or the player would cancel the dialog and open the menu at once.
  const _Scene_Map_isMenuEnabled_sleepUI = Scene_Map.prototype.isMenuEnabled;
  Scene_Map.prototype.isMenuEnabled = function () {
    if ($gameTemp._sleepMenuOpen) return false;
    return _Scene_Map_isMenuEnabled_sleepUI.call(this);
  };

  const _Scene_Map_terminate_sleepUI = Scene_Map.prototype.terminate;
  Scene_Map.prototype.terminate = function () {
    SleepMenuInputManager.deactivate();
    if (this._sleepMenuEl) {
      const el = this._sleepMenuEl;
      this._sleepMenuEl = null;
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    _Scene_Map_terminate_sleepUI.call(this);
  };
})();