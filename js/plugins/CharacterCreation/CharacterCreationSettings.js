/*:
 * @target MZ
 * @plugindesc The initial-settings page of character creation: the option rows, their preview plates and their input
 * @author Omni-Lex
 * @orderAfter CharacterCreation
 *
 * @help
 * Lifted out of CharacterCreation.js. The Settings tab of the wizard is the
 * options menu shown before a world exists, so it builds its own rows
 * (language, difficulty, enemy spawn, fog of war, creation music, mods...)
 * and draws them on the parchment spread with a preview plate facing them.
 * 
 * Every method here was a method of Scene_CharacterCreation and still is:
 * the class body below is copied onto its prototype at load.
 *
 * DO NOT call this plugin directly.
 */

(() => {
  "use strict";

  const Scene_CharacterCreation = window.Scene_CharacterCreation;
  if (!Scene_CharacterCreation) return;

  const {
    pickSettingIcon,
    ENEMY_SPAWN_IMAGES,
    CREATION_BGM,
    getCCMusicTracks,
    CharacterCreationData,
  } = window.CCKit;

  // Written as a class body so the methods move onto the wizard exactly as
  // they were declared while they still lived inside it, accessors and all.
  class CCSettingsPage {
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
      // Biome (0) is the default: the world as it stands, with the place
      // deciding what lives there. ConfigManager seeds the same value, this
      // only covers a config that never had one.
      if (ConfigManager.enemySpawnMode === undefined) ConfigManager.enemySpawnMode = 0;
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
               data-nav-skip data-nav-owner="updateSettingsInput"
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
  }

  for (const key of Object.getOwnPropertyNames(CCSettingsPage.prototype)) {
    if (key === "constructor") continue;
    Object.defineProperty(
      Scene_CharacterCreation.prototype, key,
      Object.getOwnPropertyDescriptor(CCSettingsPage.prototype, key)
    );
  }
})();
