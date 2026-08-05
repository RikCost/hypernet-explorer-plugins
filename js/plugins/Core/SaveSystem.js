/*:
 * @target MZ
 * @plugindesc Autosave on map transition after X minutes with a visual icon.
 * @author esoteric-heavy-industries
 *
 * @param defaultEnabled
 * @text Default Enabled
 * @type boolean
 * @default true
 *
 * @param defaultInterval
 * @text Default Interval (minutes)
 * @type number
 * @min 1
 * @max 60
 * @default 5
 */

(() => {
    const params = PluginManager.parameters("SaveSystem");
    const DEFAULT_ENABLED = params.defaultEnabled !== "false";
    const DEFAULT_INTERVAL = Number(params.defaultInterval) || 5;
    const SAVE_SLOT = 0;
    const ICON_INDEX = 79; // The icon index you requested

    //=========================================================================
    // Slot-locked playthroughs
    //=========================================================================
    // Each playthrough is bound to one savefile slot ($gameSystem.savefileId,
    // assigned right after character creation). Manual saving is only allowed
    // into that slot or into the autosave slot 0, which is shared by every
    // playthrough of the world. Loading the autosave resumes the playthrough
    // that wrote it (its binding is part of the save contents).

    // The slot a brand-new playthrough gets: one past the highest used slot
    // (file2 exists -> file3), falling back to the lowest empty slot when the
    // end of the list is reached.
    function nextPlaythroughSlot() {
        let highest = 0;
        for (let i = 1; i <= DataManager.maxSavefiles(); i++) {
            if (DataManager.savefileInfo(i)) highest = i;
        }
        if (highest < DataManager.maxSavefiles()) return highest + 1;
        // emptySavefileId() scans the whole global info array, which reaches
        // past the party band once quicksaves have been written, so a slot
        // beyond the band is not a slot a playthrough may claim.
        const empty = DataManager.emptySavefileId();
        return empty > 0 && empty <= DataManager.maxSavefiles() ? empty : -1;
    }

    //=========================================================================
    // Quicksave slots
    //=========================================================================
    // F5 rotates over three dedicated quicksave slots instead of writing over
    // the playthrough's own save. They sit above the 1..maxSavefiles party band
    // so they never consume a playthrough slot, and they are always writable: a
    // quicksave may overwrite any quicksave, whichever playthrough wrote it.
    const QUICK_SLOT_IDS = [101, 102, 103];

    function isQuickSlot(index) {
        return QUICK_SLOT_IDS.indexOf(index) >= 0;
    }

    function quickSlotNumber(index) {
        return QUICK_SLOT_IDS.indexOf(index) + 1;
    }

    function quickSlotTime(index) {
        const info = DataManager.savefileInfo(index);
        return info && info.timestamp ? info.timestamp : 0;
    }

    // Where the next quicksave goes: the first free slot, then the oldest one.
    function nextQuickSlot() {
        const free = QUICK_SLOT_IDS.find(id => !DataManager.savefileInfo(id));
        if (free !== undefined) return free;
        return QUICK_SLOT_IDS.reduce((a, b) => (quickSlotTime(b) < quickSlotTime(a) ? b : a));
    }

    // The most recent quicksave, or 0 when none has been written yet.
    function latestQuickSlot() {
        const used = QUICK_SLOT_IDS.filter(id => DataManager.savefileInfo(id));
        if (!used.length) return 0;
        return used.reduce((a, b) => (quickSlotTime(b) > quickSlotTime(a) ? b : a));
    }

    // Which playthrough wrote a quicksave. A terminal death takes its own
    // quicksaves down with it (see deletePlaythroughSaves), so F9 can never
    // undo a permadeath run.
    function stampQuickOwner(index) {
        const info = DataManager.savefileInfo(index);
        if (!info) return;
        info.quickOwner = window.$gameSystem ? $gameSystem.savefileId() : 0;
        DataManager.saveGlobalInfo();
    }

    function canSaveTo(index) {
        if (index === 0) return true; // shared world autosave, manually writable
        if (isQuickSlot(index)) return true; // a quicksave is always overwritable
        const bound = $gameSystem.savefileId();
        if (bound > 0) return index === bound;
        // Unbound playthrough (e.g. sandbox): may only claim an empty slot.
        return !DataManager.savefileInfo(index);
    }

    window.SaveSystem = window.SaveSystem || {};
    window.SaveSystem.nextPlaythroughSlot = nextPlaythroughSlot;
    window.SaveSystem.canSaveTo = canSaveTo;
    window.SaveSystem.quickSlotIds = () => QUICK_SLOT_IDS.slice();
    window.SaveSystem.isQuickSlot = isQuickSlot;
    window.SaveSystem.nextQuickSlot = nextQuickSlot;
    window.SaveSystem.latestQuickSlot = latestQuickSlot;
    // Called when character creation completes; the save itself happens on
    // the next Scene_Map start so the player is already on a real map.
    window.SaveSystem.scheduleNewPlaythroughSave = function () {
        if ($gameTemp) $gameTemp._pendingNewPlaythroughSave = true;
    };

    // --- Last save location tracking -------------------------------------
    // Each time the world is saved we remember where the player was standing.
    // The respawn logic (roguelite / normal death) reads this so the player
    // wakes at their most recent save point. The first location ever saved is
    // also kept as the character-creation starting location, used as the
    // fallback when no later save location exists.
    function recordSaveLocation() {
        if (!window.$gamePlayer || !window.$gameMap || !window.$gameSystem) return;
        const mapId = $gameMap.mapId();
        if (!(mapId > 0)) return;
        const loc = { mapId, x: $gamePlayer.x, y: $gamePlayer.y, dir: $gamePlayer.direction() };
        $gameSystem._lastSaveLocation = loc;
        if (!$gameSystem._creationStartLocation) {
            $gameSystem._creationStartLocation = { mapId: loc.mapId, x: loc.x, y: loc.y, dir: loc.dir };
            // First time we know where the player actually started (their chosen
            // origin's spawn tile): in normal / peaceful play, where death is
            // non-terminal, register it as the BattleSystemEnhanced respawn point
            // (vars 25/26/27 + the _respawnPointSet flag). Skipped for the
            // tutorial (switch 100) and for permadeath / blood-and-oil (switch 9),
            // where a run ends on death instead of respawning.
            if (window.$gameSwitches &&
                !$gameSwitches.value(9) &&
                !$gameSwitches.value(100)) {
                $gameVariables.setValue(25, loc.mapId);
                $gameVariables.setValue(26, loc.x);
                $gameVariables.setValue(27, loc.y);
                const countryId = $gameVariables.value(86);
                if (countryId > 0) $gameVariables.setValue(112, countryId);
                $gameSystem._respawnPointSet = true;
            }
        }
    }
    window.SaveSystem.recordSaveLocation = recordSaveLocation;
    window.SaveSystem.getLastSaveLocation = function () {
        return (window.$gameSystem && $gameSystem._lastSaveLocation) || null;
    };
    window.SaveSystem.getCreationStartLocation = function () {
        return (window.$gameSystem && $gameSystem._creationStartLocation) || null;
    };

    const _Scene_Map_start_newPlaythrough = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _Scene_Map_start_newPlaythrough.call(this);
        if ($gameTemp && $gameTemp._pendingAutosaveIcon) {
            $gameTemp._pendingAutosaveIcon = false;
            this._showAutosaveIcon();
        }
        // Origins that end in the travel picker (train, camper, car) are not
        // finished until the player has chosen a destination and landed on it,
        // so the save waits: it - and the creation start location it records -
        // must point at the real starting map, not the departure placeholder.
        const creationTravelPending = $gameTemp &&
            ($gameTemp._openCharacterCreationTrainTravel ||
                $gameTemp._characterCreationTravelMode);
        if ($gameTemp && $gameTemp._pendingNewPlaythroughSave && !creationTravelPending) {
            $gameTemp._pendingNewPlaythroughSave = false;
            const slot = nextPlaythroughSlot();
            if (slot > 0) {
                $gameSystem.setSavefileId(slot);
                recordSaveLocation();
                $gameSystem.onBeforeSave();
                this._showAutosaveIcon();
                DataManager.saveGame(slot)
                    .then(() => console.log(`New playthrough bound and saved to slot ${slot}`))
                    .catch(() => { });
            }
        }
    };

    // --- Config & Options Logic (Persisting settings) ---
    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _ConfigManager_makeData.call(this);
        config.autosaveEnabled = this.autosaveEnabled;
        config.autosaveInterval = this.autosaveInterval;
        return config;
    };

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _ConfigManager_applyData.call(this, config);
        this.autosaveEnabled = config.autosaveEnabled !== undefined ? config.autosaveEnabled : DEFAULT_ENABLED;
        // A config written by an older build can hold null (a NaN interval is
        // serialised that way), which is not `undefined` and used to survive
        // straight into the menu as "undefined min". Coerce and fall back.
        this.autosaveInterval = normalizeInterval(config.autosaveInterval);
    };

    // Interval steps offered by the option row, in minutes. Stepping through a
    // fixed list keeps the useful values one press apart instead of walking
    // 1..60 a minute at a time.
    const INTERVAL_STEPS = [1, 3, 5, 10, 15, 20, 30, 45, 60];

    function normalizeInterval(value) {
        const n = Number(value);
        if (!isFinite(n) || n <= 0) return DEFAULT_INTERVAL;
        // Snap onto the nearest offered step so the arrows always advance.
        return INTERVAL_STEPS.reduce((best, step) =>
            Math.abs(step - n) < Math.abs(best - n) ? step : best, INTERVAL_STEPS[0]);
    }

    function stepInterval(dir) {
        const current = normalizeInterval(ConfigManager.autosaveInterval);
        const i = INTERVAL_STEPS.indexOf(current);
        const next = INTERVAL_STEPS[(i + dir + INTERVAL_STEPS.length) % INTERVAL_STEPS.length];
        ConfigManager.autosaveInterval = next;
        ConfigManager.save();
    }

    if (window.GameOptions) {
        const it = ConfigManager.language === "it";
        window.GameOptions.registerOption('autosaveEnabled',T('SaveSystem.autoSave'),
            () => ConfigManager.autosaveEnabled,
            (value) => ConfigManager.autosaveEnabled = value,
            'gameplay', 'boolean');

        window.GameOptions.registerOption('autosaveInterval',T('SaveSystem.saveInterval'),
            () => normalizeInterval(ConfigManager.autosaveInterval),
            (value) => ConfigManager.autosaveInterval = normalizeInterval(value),
            'gameplay', 'custom',
            function (value) { return normalizeInterval(value) + " min"; },
            function () { stepInterval(1); },
            function () { stepInterval(-1); }
        );
    } else {
        const _Window_Options_makeCommandList = Window_Options.prototype.makeCommandList;
        Window_Options.prototype.makeCommandList = function () {
            _Window_Options_makeCommandList.call(this);
            const it = ConfigManager.language === "it";
            this.addCommand(T('SaveSystem.autoSave'), "autosaveEnabled");
            this.addCommand(T('SaveSystem.saveInterval'), "autosaveInterval");
        };

        const _Window_Options_statusText = Window_Options.prototype.statusText;
        Window_Options.prototype.statusText = function (index) {
            const symbol = this.commandSymbol(index);
            if (symbol === "autosaveInterval") return this.getConfigValue(symbol) + " min";
            return _Window_Options_statusText.call(this, index);
        };

        const _Window_Options_isVolumeSymbol = Window_Options.prototype.isVolumeSymbol;
        Window_Options.prototype.isVolumeSymbol = function (symbol) {
            return symbol === "autosaveInterval" || _Window_Options_isVolumeSymbol.call(this, symbol);
        };

        const _Window_Options_changeVolume = Window_Options.prototype.changeVolume;
        Window_Options.prototype.changeVolume = function (symbol, forward, wrap) {
            if (symbol === "autosaveInterval") {
                const last = this.getConfigValue(symbol);
                const value = (last + (forward ? 1 : -1)).clamp(1, 60);
                this.changeValue(symbol, value);
                return;
            }
            _Window_Options_changeVolume.call(this, symbol, forward, wrap);
        };
    }

    // --- Scene_Map Logic ---

    const _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function () {
        if (SceneManager.isNextScene(Scene_Map)) {
            this._checkAutosaveOnTransition();
        }
        _Scene_Map_terminate.call(this);
    };

    Scene_Map.prototype._checkAutosaveOnTransition = function () {
        if (!ConfigManager.autosaveEnabled) return;
        if ($gameSystem._lastAutosaveFrame === undefined) {
            $gameSystem._lastAutosaveFrame = Graphics.frameCount;
            return;
        }

        const framesPassed = Graphics.frameCount - $gameSystem._lastAutosaveFrame;
        const intervalFrames = ConfigManager.autosaveInterval * 60 * 60;

        // Graphics.frameCount is session-relative and resets each launch. A save
        // made in a longer prior session leaves a baseline larger than the current
        // frame count, giving a negative delta; re-baseline instead of suppressing.
        if (framesPassed < 0) {
            $gameSystem._lastAutosaveFrame = Graphics.frameCount;
            return;
        }

        if (framesPassed >= intervalFrames) {
            $gameSystem._lastAutosaveFrame = Graphics.frameCount;
            this._executeAutosave();
        }
    };

    Scene_Map.prototype._executeAutosave = function () {
        // This runs during terminate() while the scene is dying, so the icon would
        // never be visible here. Defer it to the incoming Scene_Map via $gameTemp.
        if ($gameTemp) $gameTemp._pendingAutosaveIcon = true;
        recordSaveLocation();
        $gameSystem.onBeforeSave();
        DataManager.saveGame(SAVE_SLOT)
            .then(() => console.log("Autosave Successful"))
            .catch(() => { });
    };

    // Helper to draw Icon 79 at bottom left
    Scene_Map.prototype._showAutosaveIcon = function () {
        const iconSet = ImageManager.loadSystem("IconSet");
        const sprite = new Sprite(iconSet);

        // Calculate Icon Source (Icons are 32x32)
        const sx = (ICON_INDEX % 16) * 32;
        const sy = Math.floor(ICON_INDEX / 16) * 32;
        sprite.setFrame(sx, sy, 32, 32);

        // Position: Bottom Left (16px padding)
        sprite.x = 16;
        sprite.y = Graphics.boxHeight - 48;
        sprite.z = 9; // Ensure it's on top of map but under transitions

        // Add to the scene
        this.addChild(sprite);

        // Simple fade out after 2 seconds
        sprite.opacity = 255;
        const fadeOut = setInterval(() => {
            // Stop if the scene was torn down before the fade finished, so the
            // timer can never leak past the sprite's lifetime.
            if (!sprite.parent) {
                clearInterval(fadeOut);
                return;
            }
            if (sprite.opacity > 0) {
                sprite.opacity -= 15;
            } else {
                this.removeChild(sprite);
                clearInterval(fadeOut);
            }
        }, 50);
    };

    // --- Save Menu UI (Remains the same) ---
    const _Window_SavefileList_maxItems = Window_SavefileList.prototype.maxItems;
    Window_SavefileList.prototype.maxItems = function () {
        return _Window_SavefileList_maxItems.call(this) + 1;
    };

    Window_SavefileList.prototype.drawItem = function (index) {
        const savefileId = index;
        const info = DataManager.savefileInfo(savefileId);
        const rect = this.itemRectWithPadding(index);
        const it = ConfigManager.language === "it";

        if (index === 0) {
            this.changePaintOpacity(true);
            this.drawText(T('SaveSystem.autoSave'), rect.x, rect.y + 4, 180);
            if (info) {
                this.changePaintOpacity(this.isEnabled(savefileId));
                this.drawContents(info, rect);
            } else {
                this.changePaintOpacity(false);
                this.drawText(T('SaveSystem.empty'), rect.x, rect.y + 4, rect.width, "right");
            }
        } else {
            this.changePaintOpacity(this.isEnabled(savefileId));
            this.drawText(TextManager.file + " " + index, rect.x, rect.y + 4, 180);
            if (info) this.drawContents(info, rect);
        }
    };

    // =========================================================================
    // UISaveSystem Overhaul - D&D Book Spread Save/Load Screen
    // =========================================================================

    function escapeHtml(str) {
        return String(str ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[c]);
    }

    // Resolves the bust image for an actor via Sprites.SpritesAssociation
    // (same lookup NPCEmpathize uses), falling back to the generic bust.
    function resolveBustForActor(actor) {
        if (!actor) return "7";
        const charName = actor.characterName();
        const charIndex = actor.characterIndex();
        if (charName && window.Sprites?.SpritesAssociation) {
            const sa = window.Sprites.SpritesAssociation;
            const bust = sa[charName.split('.')[0]]?.[charIndex];
            if (bust) return String(bust);
        }
        return "7";
    }

    // Draws the actor's standing/front sprite frame at its native resolution
    // (no stretching) so the canvas can be fit into its box without
    // distorting or cropping the character.
    function drawCharacterOnCanvas(canvas, characterName, characterIndex) {
        if (!characterName) return;
        const bitmap = ImageManager.loadCharacter(characterName);
        const draw = () => {
            if (!bitmap.width || !bitmap.height) return;

            const isBigCharacter = ImageManager.isBigCharacter(characterName);
            const cols = isBigCharacter ? 3 : 12;
            const rows = isBigCharacter ? 4 : 8;
            const frameWidth = Math.floor(bitmap.width / cols);
            const frameHeight = Math.floor(bitmap.height / rows);

            // Match the canvas's internal resolution to the sprite's native
            // frame size; CSS (object-fit: contain) handles display sizing
            // so the full frame is always visible, never cropped.
            canvas.width = frameWidth;
            canvas.height = frameHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            let sx = 0;
            let sy = 0;

            if (isBigCharacter) {
                sx = frameWidth * 1;
                sy = 0;
            } else {
                const blockX = characterIndex % 4;
                const blockY = Math.floor(characterIndex / 4);
                sx = frameWidth * (blockX * 3 + 1);
                sy = frameHeight * (blockY * 4 + 0);
            }

            ctx.drawImage(bitmap._image || bitmap.image || bitmap.canvas || bitmap, sx, sy, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
        };

        if (bitmap.isReady()) {
            draw();
        } else {
            bitmap.addLoadListener(draw);
        }
    }

    // Extends the savefile info with full party details (name, class, level,
    // sprite, bust) so the save/load screen can show more than tiny sprites.
    const _DataManager_makeSavefileInfo_party = DataManager.makeSavefileInfo;
    DataManager.makeSavefileInfo = function () {
        const info = _DataManager_makeSavefileInfo_party.call(this);
        info.partyInfo = $gameParty.battleMembers().map(actor => ({
            name: actor.name(),
            level: actor.level,
            className: actor.currentClass() ? actor.currentClass().name : "",
            characterName: actor.characterName(),
            characterIndex: actor.characterIndex(),
            hp: actor.hp,
            mhp: actor.mhp,
            mp: actor.mp,
            mmp: actor.mmp,
            bust: resolveBustForActor(actor)
        }));
        return info;
    };

    class UIFileInputManager {
        static init(container, scene) {
            this.container = container;
            this.scene = scene;
            this.active = false;
            this._focusMode = 'slots'; // 'slots' | 'actions'
            this._actionIndex = 0;
        }

        static activate() {
            this.active = true;
            this.updateFocus();
        }

        static deactivate() {
            this.active = false;
        }

        static _getActionButtons() {
            return Array.from(this.container.querySelectorAll('.action-btn.focusable'));
        }

        static update() {
            if (!this.active) return;
            // A confirmation modal swallows all input until it is dismissed.
            if (this.scene._confirmModal) {
                this._updateConfirmModal();
                return;
            }
            if (this._focusMode === 'slots') {
                this._updateSlots();
            } else {
                this._updateActions();
            }
        }

        static _updateConfirmModal() {
            const btns = this.scene.confirmModalButtons();
            if (btns.length === 0) return;

            if (Input.isTriggered('right') || Input.isTriggered('down')) {
                this.scene._confirmModalIndex = (this.scene._confirmModalIndex + 1) % btns.length;
                SoundManager.playCursor();
                this.scene.updateConfirmModalFocus();
            } else if (Input.isTriggered('left') || Input.isTriggered('up')) {
                this.scene._confirmModalIndex =
                    (this.scene._confirmModalIndex - 1 + btns.length) % btns.length;
                SoundManager.playCursor();
                this.scene.updateConfirmModalFocus();
            } else if (Input.isTriggered('ok')) {
                const btn = btns[this.scene._confirmModalIndex];
                if (btn) btn.click();
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                TouchInput.clear();
                SoundManager.playCancel();
                this.scene.closeConfirmModal();
            }
        }

        static _updateSlots() {
            const slots = this.scene._visibleSlots || [0];
            let pos = slots.indexOf(this.scene._selectedIndex);
            if (pos < 0) pos = 0;
            let index = this.scene._selectedIndex;
            let moved = false;

            if (Input.isTriggered('down') || Input.isRepeated('down')) {
                index = slots[(pos + 1) % slots.length];
                moved = true;
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                index = slots[(pos - 1 + slots.length) % slots.length];
                moved = true;
            } else if (Input.isTriggered('right')) {
                const btns = this._getActionButtons();
                if (btns.length > 0) {
                    this._focusMode = 'actions';
                    this._actionIndex = 0;
                    SoundManager.playCursor();
                    this.updateFocus();
                    return;
                }
            } else if (Input.isTriggered('ok')) {
                SoundManager.playOk();
                this.scene.executePrimaryAction(index);
                return;
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                SoundManager.playCancel();
                TouchInput.clear();
                this.scene.popScene();
                return;
            }

            if (moved) {
                SoundManager.playCursor();
                this.scene._selectedIndex = index;
                this.scene.refreshUIDOM();
            }
        }

        static _updateActions() {
            const btns = this._getActionButtons();
            if (btns.length === 0) {
                this._focusMode = 'slots';
                this.updateFocus();
                return;
            }

            if (Input.isTriggered('down') || Input.isRepeated('down')) {
                this._actionIndex = (this._actionIndex + 1) % btns.length;
                SoundManager.playCursor();
                this.updateFocus();
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                this._actionIndex = (this._actionIndex - 1 + btns.length) % btns.length;
                SoundManager.playCursor();
                this.updateFocus();
            } else if (Input.isTriggered('ok')) {
                const btn = btns[this._actionIndex];
                if (btn) btn.click();
            } else if (Input.isTriggered('left') || Input.isTriggered('cancel')) {
                this._focusMode = 'slots';
                if (Input.isTriggered('cancel')) {
                    SoundManager.playCancel();
                } else {
                    SoundManager.playCursor();
                }
                TouchInput.clear();
                this.updateFocus();
            }
        }

        static updateFocus() {
            const items = Array.from(this.container.querySelectorAll('.save-item'));
            items.forEach(el => {
                const saveId = parseInt(el.getAttribute('data-id'));
                if (saveId === this.scene._selectedIndex) {
                    el.classList.add('selected');
                    if (this._focusMode === 'slots') {
                        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                } else {
                    el.classList.remove('selected');
                }
            });

            const btns = this._getActionButtons();
            btns.forEach((btn, i) => {
                if (this._focusMode === 'actions' && i === this._actionIndex) {
                    btn.classList.add('focused');
                } else {
                    btn.classList.remove('focused');
                }
            });
        }
    }

    const _Scene_File_create = Scene_File.prototype.create;
    Scene_File.prototype.create = function () {
        _Scene_File_create.call(this);

        if (this._windowLayer) {
            this._windowLayer.visible = false;
        }
        if (this._helpWindow) {
            this._helpWindow.visible = false;
        }
        if (this._listWindow) {
            this._listWindow.visible = false;
        }

        const firstId = this.firstSavefileId() || 1;
        // A quicksave slot lives above the party band, so it must not be
        // clamped back into it when the load screen opens on the newest file.
        this._selectedIndex = isQuickSlot(firstId)
            ? firstId
            : firstId.clamp(0, DataManager.maxSavefiles());

        this.createUIDOM();
    };

    const _Scene_File_terminate = Scene_File.prototype.terminate;
    Scene_File.prototype.terminate = function () {
        _Scene_File_terminate.call(this);
        UIFileInputManager.deactivate();
        this.removeUIContainer();
    };

    const _Scene_File_update = Scene_File.prototype.update;
    Scene_File.prototype.update = function () {
        _Scene_File_update.call(this);
        UIFileInputManager.update();
    };

    Scene_File.prototype.createUIDOM = function () {
        this._dndContainer = document.createElement('div');
        this._dndContainer.id = 'save-menu-container';
        document.body.appendChild(this._dndContainer);

        const useTranslation = ConfigManager.language === "it";
        const backBtnText =T('SaveSystem.back');
        const leftPageTitle =T('SaveSystem.diary');
        const rightPageTitle =T('SaveSystem.log');

        this._dndContainer.innerHTML = `
            <div class="save-book-spread">
                <div class="save-left-page" style="width: 57.5%; padding: 35px 50px 35px 45px;">
                    <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
                      <div class="back-button focusable" onclick="SoundManager.playCancel(); SceneManager.pop();" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                        ${backBtnText}
                      </div>
                      <h2 class="save-title" style="border: none; margin: 0; padding: 0; text-align: center;">${leftPageTitle}</h2>
                    </div>
                    <div class="save-list"></div>
                </div>

                <div class="save-right-page" style="width: 42.5%; padding: 35px 45px 35px 50px;">
                    <h2 class="save-title" style="margin-bottom: 20px;">${rightPageTitle}</h2>
                    <div class="save-details-container"></div>
                    <div class="actions-bar" style="display: none;"></div>
                </div>
            </div>
        `;

        // Stop mouse/touch/wheel event propagation to game canvas so PIXI doesn't intercept inputs
        const stopPropagationEvents = ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'wheel'];
        stopPropagationEvents.forEach(evt => {
            this._dndContainer.addEventListener(evt, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });

        // Right-click should close the screen (act as Back) instead of opening
        // the browser context menu. Must not be passive so preventDefault works.
        this._dndContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            SoundManager.playCancel();
            SceneManager.pop();
        }, { passive: false });

        UIFileInputManager.init(this._dndContainer, this);
        this.buildSaveList();
        this.refreshUIDOM();
    };

    // Both modes list the shared autosave (slot 0) plus every slot of this
    // world that holds a savefile (savegames live in the world folder, so the
    // list is already scoped to the active world).
    // Save mode additionally puts the playthrough's own slot right below the
    // autosave; the other parties are shown underneath it as read-only entries
    // (they can be inspected, loaded or deleted, but never written to).
    // The three quicksave slots close the list: all of them in save mode (any
    // may be written over), only the written ones in load mode.
    Scene_File.prototype.visibleSlotIds = function () {
        const withFiles = [];
        for (let i = 1; i <= DataManager.maxSavefiles(); i++) {
            if (DataManager.savefileInfo(i)) withFiles.push(i);
        }
        const quick = this.mode() === "save"
            ? QUICK_SLOT_IDS.slice()
            : QUICK_SLOT_IDS.filter(id => DataManager.savefileInfo(id));
        if (this.mode() === "save") {
            const bound = $gameSystem.savefileId();
            const ownSlot = bound > 0 ? bound : nextPlaythroughSlot();
            const ids = [0];
            if (ownSlot > 0) ids.push(ownSlot);
            for (const i of withFiles) {
                if (i !== ownSlot) ids.push(i);
            }
            return [...ids, ...quick];
        }
        return [0, ...withFiles, ...quick];
    };

    Scene_File.prototype.buildSaveList = function () {
        const saveList = this._dndContainer.querySelector('.save-list');
        if (!saveList) return;

        const useTranslation = ConfigManager.language === "it";
        const bound = $gameSystem.savefileId();
        let listHTML = "";
        this._visibleSlots = this.visibleSlotIds();
        if (!this._visibleSlots.includes(this._selectedIndex)) {
            if (this.mode() === "save") {
                const ownSlot = bound > 0 ? bound : nextPlaythroughSlot();
                this._selectedIndex = (ownSlot > 0 && this._visibleSlots.includes(ownSlot))
                    ? ownSlot
                    : (this._visibleSlots[0] || 0);
            } else {
                this._selectedIndex = this._visibleSlots[1] !== undefined ? this._visibleSlots[1] : 0;
            }
        }
        for (const i of this._visibleSlots) {
            const info = DataManager.savefileInfo(i);
            let summaryText = "";
            let slotName = "";
            // In save mode the parties that are not this playthrough are shown
            // but cannot be written to; mark them so the list makes that clear.
            const locked = this.mode() === "save" && !canSaveTo(i);

            if (i === 0) {
                slotName =T('SaveSystem.autosave');
                summaryText = info ? info.playtime : (T('SaveSystem.none'));
            } else if (isQuickSlot(i)) {
                // "QUICKSAVE 2 - Party of Ariel": the F5 rotation, named the
                // same way as a party slot so the list reads consistently.
                slotName = T('SaveSystem.quickslot', { n: quickSlotNumber(i) });
                const leader = savefileLeaderName(info);
                if (leader) {
                    slotName += " - " + T('SaveSystem.partyOf', { name: escapeHtml(leader) });
                }
                summaryText = info ? info.playtime : (T('SaveSystem.empty'));
            } else {
                // "SLOT 2 - Party of Ariel": the slot is named after whoever
                // leads the party recorded in it; an empty slot keeps the
                // bare slot number.
                slotName = T('SaveSystem.slot', { n: i });
                const leader = savefileLeaderName(info);
                if (leader) {
                    slotName += " - " + T('SaveSystem.partyOf', { name: escapeHtml(leader) });
                }
                if (i === bound) {
                    slotName +=T('SaveSystem.current');
                }
                summaryText = info ? info.playtime : (T('SaveSystem.new'));
                if (locked) {
                    summaryText +=T('SaveSystem.readOnly');
                }
            }

            listHTML += `
                <div class="save-item focusable${locked ? " locked" : ""}" data-id="${i}" onclick="SceneManager._scene.selectSavefileByClick(${i})">
                    <span class="save-id">${slotName}</span>
                    <span class="save-summary">${summaryText}</span>
                </div>
            `;
        }
        saveList.innerHTML = listHTML;

        // Stop wheel event propagation to let browser scroll natively
        saveList.addEventListener('wheel', (e) => {
            e.stopPropagation();
        }, { passive: true });
    };

    // Leader of the party recorded in a savefile: the slot is named after them.
    function savefileLeaderName(info) {
        if (!info || !Array.isArray(info.partyInfo) || !info.partyInfo.length) return "";
        return info.partyInfo[0].name || "";
    }

    function gaugeHTML(kind, value, max) {
        const rate = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
        return `<div class="save-member-gauge"><div class="save-member-gauge-fill ${kind}" style="width: ${(rate * 100).toFixed(1)}%;"></div></div>`;
    }

    function memberStatHTML(kind, label, value, max) {
        if (typeof value !== "number") return "";
        return `
            <div class="save-member-stat">
                <span class="save-member-stat-label ${kind}">${label}</span>
                ${gaugeHTML(kind, value, max || 0)}
                <span class="save-member-stat-value">${value} / ${max || 0}</span>
            </div>
        `;
    }

    // Right page party roster: sprite, name, class, level and current HP/MP of
    // every member recorded in the savefile. Savefiles written before the
    // roster carried those numbers fall back to the plain sprite row.
    function buildPartyMembersHTML(info) {
        const party = Array.isArray(info.partyInfo) ? info.partyInfo : [];
        if (party.length) {
            const rows = party.map(member => {
                const meta = [];
                if (member.level) meta.push(T('SaveSystem.levelShort', { n: member.level }));
                if (member.className) meta.push(escapeHtml(member.className));
                return `
                    <div class="save-member">
                        <canvas class="char-sprite-canvas" width="48" height="48" data-name="${escapeHtml(member.characterName || "")}" data-index="${member.characterIndex || 0}"></canvas>
                        <div class="save-member-body">
                            <div class="save-member-head">
                                <span class="save-member-name">${escapeHtml(member.name || "")}</span>
                                <span class="save-member-meta">${meta.join(" · ")}</span>
                            </div>
                            ${memberStatHTML("hp", T('SaveSystem.hpShort'), member.hp, member.mhp)}
                            ${memberStatHTML("mp", T('SaveSystem.mpShort'), member.mp, member.mmp)}
                        </div>
                    </div>
                `;
            }).join("");
            return `<div class="party-members-list">${rows}</div>`;
        }
        const chars = Array.isArray(info.characters) ? info.characters : [];
        const sprites = chars.map(char =>
            `<canvas class="char-sprite-canvas" width="48" height="48" data-name="${escapeHtml(char[0] || "")}" data-index="${char[1] || 0}"></canvas>`
        ).join("");
        return `<div class="party-characters">${sprites}</div>`;
    }

    // World folder summary shown on the right page (see Core/WorldManager.js)
    function buildWorldInfoHTML(useTranslation) {
        const WM = window.WorldManager;
        if (!WM || !WM.activeWorldName) return "";
        const gen = WM.getField("artifacts", "generated") || {};
        const artifactCount = (gen.items || []).length + (gen.weapons || []).length + (gen.armors || []).length;
        let dateStr = "";
        if (window.TimeDateSystem && window.TimeDateSystem.getDateTimeFromMinutes) {
            dateStr = window.TimeDateSystem.getDateTimeFromMinutes(WM.worldClockMinutes()).fullDate;
        }
        return `
            <div style="border: 1px dashed rgba(255,204,102,0.35); background: rgba(60,42,0,0.25); padding: 10px 14px; margin-bottom: 15px; font-family: 'Lora', serif;">
                <h4 style="margin: 0 0 6px 0; color: #ffcc66; border-bottom: 1px dashed rgba(255,204,102,0.25); padding-bottom: 3px;">
                    ${T('SaveSystem.world')}: ${escapeHtml(WM.activeWorldName)}
                </h4>
                <div class="detail-row">
                    <span class="detail-label">${T('SaveSystem.worldDate')}</span>
                    <span>${escapeHtml(dateStr) || "?"}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">${T('SaveSystem.generatedArtifacts')}</span>
                    <span>${artifactCount}</span>
                </div>
            </div>
        `;
    }

    Scene_File.prototype.refreshUIDOM = function () {
        if (!this._dndContainer) return;

        const useTranslation = ConfigManager.language === "it";
        const worldHTML = buildWorldInfoHTML(useTranslation);

        // Update selected class on left list
        const items = this._dndContainer.querySelectorAll('.save-item');
        items.forEach(el => {
            const saveId = parseInt(el.getAttribute('data-id'));
            if (saveId === this._selectedIndex) {
                el.classList.add('selected');
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                el.classList.remove('selected');
            }
        });

        // Update right details
        const info = DataManager.savefileInfo(this._selectedIndex);
        let rightPageHTML = "";

        if (info) {
            const charsHTML = buildPartyMembersHTML(info);

            const dateStr = new Date(info.timestamp).toLocaleString(T('SaveSystem.dateLocale'));

            const showSave = this.mode() === "save" && canSaveTo(this._selectedIndex);
            const showLoad = true; // any existing savefile can be loaded
            // Another party of this world: visible and loadable, never writable.
            const lockedNote = (this.mode() === "save" && !showSave)
                ? `<div style="width: 100%; text-align: center; font-family: 'Lora', serif; font-style: italic; font-size: 0.85em; color: #c8b088; margin-top: auto; padding-top: 10px;">
                        ${T('SaveSystem.anotherPartyOfThisWorld')}
                   </div>`
                : "";
            rightPageHTML = `
                <div class="save-details-card" style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
                    <div>
                        ${worldHTML}
                        <h3 class="detail-title">${info.title || T('SaveSystem.adventureLog')}</h3>
                        <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                            <div class="detail-row">
                                <span class="detail-label">${T('SaveSystem.playTime')}</span>
                                <span>${info.playtime}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${T('SaveSystem.recordedOn')}</span>
                                <span>${dateStr}</span>
                            </div>
                        </div>
                        
                        <h4 style="margin: 15px 0 5px 0; font-family: 'Lora', serif; color: #ffcc66; border-bottom: 1px dashed rgba(255,204,102,0.25); padding-bottom: 3px;">
                            ${T('SaveSystem.partyMembers')}
                        </h4>
                        ${charsHTML}
                    </div>

                    ${lockedNote}

                    <div style="display: flex; gap: 10px; justify-content: center; width: 100%; margin-top: ${lockedNote ? "6px" : "auto"}; padding-top: 10px; flex-wrap: wrap;">
                        ${showSave ? `
                        <button class="action-btn focusable" onclick="SceneManager._scene.executeSaveGame(${this._selectedIndex})" style="min-width: 90px; cursor: pointer; user-select: none;">
                            ${T('SaveSystem.save')}
                        </button>` : ""}
                        ${showLoad ? `
                        <button class="action-btn focusable" onclick="SceneManager._scene.loadSavefile(${this._selectedIndex})" style="min-width: 90px; cursor: pointer; user-select: none; background: #2e7d32; border-color: rgba(46, 125, 50, 0.4); color: #fff;">
                            ${T('SaveSystem.load')}
                        </button>` : ""}
                        <button class="action-btn focusable" onclick="SceneManager._scene.deleteSavefile(${this._selectedIndex})" style="min-width: 90px; cursor: pointer; user-select: none; background: rgba(130, 45, 45, 0.85); color: #fff; border-color: rgba(130, 45, 45, 0.4);">
                            ${T('SaveSystem.delete')}
                        </button>
                    </div>
                </div>
            `;
        } else {
            const isSave = this.mode() === "save";
            const emptyText = isSave
                ? (T('SaveSystem.thisPageOfHistoryRemains'))
                : (T('SaveSystem.thisMemorySlotHasNo'));

            let saveBtnHTML = "";
            if (isSave && canSaveTo(this._selectedIndex)) {
                saveBtnHTML = `
                    <div style="display: flex; gap: 15px; justify-content: center; width: 100%; margin-top: 20px;">
                        <button class="action-btn focusable" onclick="SceneManager._scene.executePrimaryAction(${this._selectedIndex})" style="min-width: 140px; cursor: pointer; user-select: none;">
                            ${T('SaveSystem.save')}
                        </button>
                    </div>
                `;
            }

            rightPageHTML = `
                <div class="save-details-card" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height: 100%;">
                    <div style="width: 100%;">${worldHTML}</div>
                    <div style="font-family: 'Lora', serif; font-size: 0.95em; color: #c8b088; font-style: italic; background: rgba(40,28,8,0.5); border: 1px dashed rgba(255,204,102,0.35); padding: 25px; border-radius: 4px; line-height: 1.6; text-align: center; max-width: 80%;">
                        "${emptyText}"
                    </div>
                    ${saveBtnHTML}
                </div>
            `;
        }

        const detailsContainer = this._dndContainer.querySelector('.save-details-container');
        if (detailsContainer) {
            detailsContainer.innerHTML = rightPageHTML;
            // Sync mouse hover into the controller/keyboard focus model
            detailsContainer.querySelectorAll('.action-btn.focusable').forEach((btn, i) => {
                btn.addEventListener('mouseenter', () => {
                    UIFileInputManager._focusMode = 'actions';
                    UIFileInputManager._actionIndex = i;
                    UIFileInputManager.updateFocus();
                });
            });
        }

        this.drawUICharacters();

        UIFileInputManager.activate();
    };

    Scene_File.prototype.removeUIContainer = function (immediate) {
        if (this._dndContainer) {
            const container = this._dndContainer;
            this._dndContainer = null;
            if (immediate) {
                // Synchronous teardown: used when loading so the overlay can
                // never linger on top of the map during the async scene change.
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }
                return;
            }
            container.style.transition = "opacity 0.2s ease-out";
            container.style.opacity = "0";
            container.style.pointerEvents = "none";
            setTimeout(() => {
                if (container && container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }, 200);
        }
    };

    Scene_File.prototype.drawUICharacters = function () {
        const canvases = this._dndContainer.querySelectorAll('.char-sprite-canvas');
        canvases.forEach(canvas => {
            const charName = canvas.getAttribute('data-name');
            const charIndex = parseInt(canvas.getAttribute('data-index'));
            if (charName) {
                drawCharacterOnCanvas(canvas, charName, charIndex);
            }
        });
    };

    Scene_File.prototype.selectSavefileByClick = function (index) {
        if (this._selectedIndex === index) {
            this.executePrimaryAction(index);
        } else {
            SoundManager.playCursor();
            this._selectedIndex = index;
            this.refreshUIDOM();
        }
    };

    // In-DOM confirmation window (replaces the native confirm() dialog so it
    // matches the parchment book theme and never freezes the canvas).
    const CONFIRM_MODAL_CSS = `
        .save-modal-overlay {
            position: fixed; inset: 0; z-index: 1200;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0, 0, 0, 0.62);
            font-family: 'Lora', 'Times New Roman', serif;
            animation: saveModalFade 0.18s ease-out;
        }
        @keyframes saveModalFade { from { opacity: 0; } to { opacity: 1; } }
        .save-modal {
            width: min(460px, 78vw);
            padding: 26px 30px 22px 30px;
            box-sizing: border-box;
            text-align: center;
            color: #e6d6ae;
            border: 3px double #bba16d;
            border-radius: 4px;
            background:
                linear-gradient(rgba(30, 20, 6, 0.94), rgba(20, 13, 4, 0.97));
            box-shadow: 0 18px 50px rgba(0, 0, 0, 0.7), inset 0 0 60px rgba(255, 204, 102, 0.06);
            animation: saveModalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes saveModalPop { from { transform: scale(0.94); } to { transform: scale(1); } }
        .save-modal-title {
            margin: 0 0 12px 0;
            font-size: 1.15rem;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffcc66;
            border-bottom: 1px dashed rgba(255, 204, 102, 0.3);
            padding-bottom: 8px;
        }
        .save-modal-message {
            font-size: 0.95rem;
            font-style: italic;
            line-height: 1.55;
            color: #c8b088;
            margin-bottom: 22px;
        }
        .save-modal-buttons { display: flex; gap: 12px; justify-content: center; }
        .save-modal-btn {
            min-width: 110px;
            font-family: 'Lora', serif;
            font-size: 0.9rem;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 9px 18px;
            border-radius: 4px;
            border: 1.5px solid rgba(255, 204, 102, 0.35);
            background: rgba(60, 42, 0, 0.5);
            color: #e6d6ae;
            cursor: pointer;
            user-select: none;
            transition: all 0.15s ease;
        }
        .save-modal-btn.danger {
            background: rgba(130, 45, 45, 0.85);
            border-color: rgba(130, 45, 45, 0.5);
            color: #fff;
        }
        .save-modal-btn:hover, .save-modal-btn.focused {
            filter: brightness(1.35);
            box-shadow: 0 0 12px rgba(255, 204, 102, 0.35);
        }
    `;

    Scene_File.prototype.showConfirmModal = function (opts) {
        if (!this._dndContainer) return;
        this.closeConfirmModal();

        const overlay = document.createElement('div');
        overlay.className = 'save-modal-overlay';
        overlay.innerHTML = `
            <style>${CONFIRM_MODAL_CSS}</style>
            <div class="save-modal" role="dialog" aria-modal="true">
                <h3 class="save-modal-title">${escapeHtml(opts.title)}</h3>
                <div class="save-modal-message">${escapeHtml(opts.message)}</div>
                <div class="save-modal-buttons">
                    <button type="button" class="save-modal-btn save-modal-cancel">${escapeHtml(opts.cancelLabel)}</button>
                    <button type="button" class="save-modal-btn danger save-modal-confirm">${escapeHtml(opts.confirmLabel)}</button>
                </div>
            </div>
        `;

        const cancel = () => {
            SoundManager.playCancel();
            this.closeConfirmModal();
        };
        overlay.querySelector('.save-modal-cancel').addEventListener('click', cancel);
        overlay.querySelector('.save-modal-confirm').addEventListener('click', () => {
            const cb = opts.onConfirm;
            this.closeConfirmModal();
            if (cb) cb();
        });
        // Clicking the dimmed backdrop (outside the window) cancels.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
        overlay.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cancel();
        }, { passive: false });
        ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'wheel']
            .forEach(evt => overlay.addEventListener(evt, (e) => e.stopPropagation(), { passive: true }));

        this._dndContainer.appendChild(overlay);
        this._confirmModal = overlay;
        // Cancel is the default focus so a stray OK press never deletes.
        this._confirmModalIndex = 0;
        this.updateConfirmModalFocus();
    };

    Scene_File.prototype.confirmModalButtons = function () {
        if (!this._confirmModal) return [];
        return Array.from(this._confirmModal.querySelectorAll('.save-modal-btn'));
    };

    Scene_File.prototype.updateConfirmModalFocus = function () {
        this.confirmModalButtons().forEach((btn, i) => {
            btn.classList.toggle('focused', i === this._confirmModalIndex);
        });
    };

    Scene_File.prototype.closeConfirmModal = function () {
        if (this._confirmModal) {
            if (this._confirmModal.parentNode) this._confirmModal.parentNode.removeChild(this._confirmModal);
            this._confirmModal = null;
        }
    };

    Scene_File.prototype.deleteSavefile = function (index) {
        const info = DataManager.savefileInfo(index);
        if (!info) {
            SoundManager.playBuzzer();
            return;
        }

        const useTranslation = ConfigManager.language === "it";
        this.showConfirmModal({
            title:T('SaveSystem.deleteParty'),
            message:T('SaveSystem.areYouSureYouWant'),
            confirmLabel:T('SaveSystem.delete'),
            cancelLabel:T('SaveSystem.cancel'),
            onConfirm: () => {
                SoundManager.playOk();
                const saveName = DataManager.makeSavename(index);
                // StorageManager.remove() only returns a Promise on the
                // localforage backend; the local-file backend (NW.js) unlinks
                // synchronously and returns undefined, so it cannot be chained
                // directly. Promise.resolve() normalizes both.
                let removal;
                try {
                    removal = Promise.resolve(StorageManager.remove(saveName));
                } catch (e) {
                    removal = Promise.reject(e);
                }
                removal.then(() => {
                    if (DataManager._globalInfo) {
                        DataManager._globalInfo[index] = null;
                    }
                    DataManager.saveGlobalInfo();
                    this.buildSaveList();
                    this.refreshUIDOM();
                }).catch((err) => {
                    console.error(err);
                    SoundManager.playBuzzer();
                });
            }
        });
    };

    Scene_File.prototype.loadSavefile = function (index) {
        const info = DataManager.savefileInfo(index);
        if (!info) {
            SoundManager.playBuzzer();
            return;
        }
        
        SoundManager.playLoad();
        // Tear the DOM overlay down right away. loadGame() resolves
        // asynchronously and the scene only terminates after fadeOutAll()
        // finishes, so relying on terminate() left the overlay sitting on top
        // of the loaded map. Removing it here makes it vanish the moment LOAD
        // is pressed, regardless of scene-transition timing.
        UIFileInputManager.deactivate();
        this.removeUIContainer(true);
        this.fadeOutAll();

        DataManager.loadGame(index)
            .then(() => {
                $gameSystem.onAfterLoad();
                if ($gameSystem.versionId() !== $dataSystem.versionId) {
                    const mapId = $gameMap.mapId();
                    const x = $gamePlayer.x;
                    const y = $gamePlayer.y;
                    const d = $gamePlayer.direction();
                    $gamePlayer.reserveTransfer(mapId, x, y, d, 0);
                    $gamePlayer.requestMapReload();
                }
                SceneManager.goto(Scene_Map);
            })
            .catch((error) => {
                console.error(error);
                SoundManager.playBuzzer();
                // Load failed: rebuild the overlay and fade back in so the
                // player can pick another slot instead of being stranded on a
                // blank, faded-out screen.
                this.createUIDOM();
                this.startFadeIn(this.slowFadeSpeed(), false);
            });
    };

    Scene_File.prototype.executeSaveGame = function (index) {
        // Slot lock: only the playthrough's own slot, the shared autosave
        // slot 0 or a quicksave slot can be written.
        if (this.mode() !== "save" || !canSaveTo(index)) {
            SoundManager.playBuzzer();
            return;
        }

        // Saving to the autosave or a quicksave slot keeps the playthrough
        // bound to its own slot.
        if (index > 0 && !isQuickSlot(index)) $gameSystem.setSavefileId(index);
        recordSaveLocation();
        $gameSystem.onBeforeSave();
        DataManager.saveGame(index)
            .then(() => {
                if (isQuickSlot(index)) stampQuickOwner(index);
                SoundManager.playSave();
                this.popScene();
            })
            .catch(() => {
                SoundManager.playBuzzer();
            });
    };

    Scene_File.prototype.executePrimaryAction = function (index) {
        if (this.mode() === "save") {
            this.executeSaveGame(index);
            return;
        }

        if (!DataManager.savefileInfo(index)) {
            SoundManager.playBuzzer();
            return;
        }

        this.loadSavefile(index);
    };

    // =========================================================================
    // Hardcore / Blood-and-Oil Game Over
    // =========================================================================
    // When Switch 9 is ON (Permadeath or Blood and Oil difficulty) the death of
    // Actor 1 is terminal: the playthrough's manual save slot is wiped, a Game
    // Over screen with run statistics is shown, then control returns to the
    // main menu. The shared autosave (slot 0) is intentionally left intact.
    // Roguelite (Switch 9 OFF) is unaffected and keeps its respawn behaviour.

    // Stat lines shown on the Game Over screen. This is an editable dictionary
    // mapping a display label to the RPG Maker variable to read. Value forms:
    //   "Label": 66                                  -> $gameVariables.value(66)
    //   "Label": { variable: 66 }                    -> same, explicit
    //   "Label": { variable: 66, prefix: "", suffix: " EUR" }
    //   "Label": { it: "Etichetta", variable: 66 }   -> localized label (Italian)
    // i18n-ignore-start: map keys are ids; the display side is SaveSystem.stat
    window.SaveSystem.gameOverStats = window.SaveSystem.gameOverStats || {
        "Bounty": { key: "bounty", variable: 66, suffix: " EUR" },
        "Floor Reached": { key: "floorReached", variable: 2 },
        "Arena Wins": { key: "arenaWins", variable: 22 },
        "Difficulty": { key: "difficulty", variable: 21 }
    };
    // i18n-ignore-end

    // A stat entry may name its own key under SaveSystem.stat; a mod that adds
    // one without a key still reads, using its map key as the English label.
    function resolveStatEntry(key, val) {
        let label = key;
        let variable = null;
        let prefix = "";
        let suffix = "";
        if (typeof val === "number") {
            variable = val;
        } else if (val && typeof val === "object") {
            variable = val.variable;
            if (val.key && T.has('SaveSystem.stat.' + val.key)) label = T('SaveSystem.stat.' + val.key);
            prefix = val.prefix || "";
            suffix = val.suffix || "";
        }
        const raw = (variable != null && window.$gameVariables) ? $gameVariables.value(variable) : "";
        return { label, value: prefix + raw + suffix };
    }

    // Deletes the manual save slot bound to the current playthrough, plus every
    // quicksave that playthrough wrote (or death would be undoable with F9).
    // Slot 0 (the shared autosave) and other parties' quicksaves are never
    // touched.
    window.SaveSystem.deletePlaythroughSaves = function () {
        const bound = $gameSystem ? $gameSystem.savefileId() : 0;
        if (!(bound > 0)) return;
        const ownQuick = QUICK_SLOT_IDS.filter(id => {
            const info = DataManager.savefileInfo(id);
            return info && info.quickOwner === bound;
        });
        for (const index of [bound, ...ownQuick]) {
            const saveName = DataManager.makeSavename(index);
            try {
                const result = StorageManager.remove(saveName);
                if (result && typeof result.catch === "function") result.catch(() => { });
            } catch (e) { /* storage backend may be synchronous or unavailable */ }
            if (DataManager._globalInfo) DataManager._globalInfo[index] = null;
        }
        DataManager.saveGlobalInfo();
    };

    // Em (the endless dossier, CharacterCreationPresets.js) is never really
    // gone: killing one only ends that branch of her, and she stays pickable in
    // every later playthrough of the world. The Game Over screen says so, both
    // when she led the run and when she was only travelling with it. Switch 48
    // is the one her dossier sets, so an Em who joined outside creation counts
    // too; the name check covers a run whose switches were reset.
    function isEmInPlay() {
        if (window.$gameSwitches && $gameSwitches.value(48)) return true;
        if (window.$gameParty && $gameParty.members) {
            return $gameParty.members().some((member) => member && member.name() === "Em");
        }
        return false;
    }

    // Entry point for a terminal death. Wipes the manual save (only in a
    // Switch 9 run), stops audio, and opens the Game Over screen.
    window.SaveSystem.triggerGameOver = function () {
        if (window.$gameSwitches && $gameSwitches.value(9)) {
            window.SaveSystem.deletePlaythroughSaves();
        }
        if (window.AudioManager) {
            AudioManager.stopBgm();
            AudioManager.stopBgs();
        }
        SceneManager.goto(Scene_HardcoreGameOver);
    };

    class Scene_HardcoreGameOver extends Scene_Base {
        create() {
            super.create();
            this.createBlackBackground();
            this._inputReady = false;
            this._returning = false;
            this.createUIDOM();
        }

        createBlackBackground() {
            this._backSprite = new ScreenSprite();
            this._backSprite.setBlack();
            this.addChild(this._backSprite);
        }

        start() {
            super.start();
            this.startFadeIn(this.slowFadeSpeed(), false);
            if (window.AudioManager) {
                AudioManager.stopBgm();
                AudioManager.stopBgs();
                if ($dataSystem && $dataSystem.gameoverMe && $dataSystem.gameoverMe.name) {
                    AudioManager.playMe($dataSystem.gameoverMe);
                }
            }
            // Hold input briefly so the screen is read before it can be dismissed.
            this._inputTimer = setTimeout(() => { this._inputReady = true; }, 900);
        }

        createUIDOM() {
            const it = ConfigManager.language === "it";
            const leader = (window.$gameParty && $gameParty.leader) ? $gameParty.leader() : null;
            const name = leader ? leader.name() : (T('SaveSystem.theAdventurer'));
            const playtime = (window.$gameSystem && $gameSystem.playtimeText) ? $gameSystem.playtimeText() : "";

            let statsHTML = "";
            const stats = window.SaveSystem.gameOverStats || {};
            for (const key in stats) {
                const { label, value } = resolveStatEntry(key, stats[key]);
                statsHTML += `
                    <div class="hgo-stat-row">
                        <span class="hgo-stat-label">${escapeHtml(label)}</span>
                        <span class="hgo-stat-dots"></span>
                        <span class="hgo-stat-value">${escapeHtml(value)}</span>
                    </div>`;
            }
            if (playtime) {
                statsHTML += `
                    <div class="hgo-stat-row">
                        <span class="hgo-stat-label">${T('SaveSystem.playTime2')}</span>
                        <span class="hgo-stat-dots"></span>
                        <span class="hgo-stat-value">${escapeHtml(playtime)}</span>
                    </div>`;
            }

            const titleText =T('SaveSystem.youDied');
            const epitaph = T('SaveSystem.epitaph', { name: escapeHtml(name) });
            const btnText =T('SaveSystem.returnToMainMenu');
            const emHTML = isEmInPlay()
                ? `<div class="hgo-em">${T('SaveSystem.emWillReturnSomehowWitches')}</div>`
                : "";

            const c = document.createElement('div');
            c.id = 'hardcore-gameover-container';
            // The layout-critical properties are written inline (and !important)
            // so no stylesheet loaded by another plugin can collapse the overlay
            // back to a static block in the top-left corner.
            c.style.cssText = [
                'position: fixed !important',
                'left: 0 !important', 'top: 0 !important',
                'right: 0 !important', 'bottom: 0 !important',
                'width: 100% !important', 'height: 100% !important',
                'margin: 0 !important',
                'display: flex !important',
                'align-items: center !important',
                'justify-content: center !important',
                'z-index: 10000 !important'
            ].join(';');
            c.innerHTML = `
                <style>
                    #hardcore-gameover-container {
                        background: radial-gradient(ellipse at center, rgba(40,0,0,0.55) 0%, rgba(0,0,0,0.92) 70%, #000 100%);
                        font-family: 'Lora', 'Times New Roman', serif; color: #c9b48a;
                        opacity: 0; animation: hgo-fade 1.6s ease forwards;
                        user-select: none; cursor: pointer;
                        overflow: hidden;
                    }
                    @keyframes hgo-fade { to { opacity: 1; } }
                    #hardcore-gameover-container .hgo-panel {
                        flex: 1 1 auto;
                        width: 100%; height: 100%;
                        display: flex; flex-direction: column;
                        align-items: center; justify-content: center;
                        text-align: center;
                        padding: clamp(16px, 4vh, 48px) clamp(16px, 6vw, 80px);
                        box-sizing: border-box;
                    }
                    #hardcore-gameover-container .hgo-title {
                        font-size: clamp(48px, 11vmin, 128px); font-weight: bold; letter-spacing: 0.12em;
                        color: #8b1a1a; margin: 0 0 clamp(4px, 1vh, 12px) 0;
                        text-shadow: 0 0 18px rgba(139,26,26,0.65), 0 2px 4px #000;
                    }
                    #hardcore-gameover-container .hgo-epitaph {
                        font-style: italic; font-size: clamp(16px, 3vmin, 28px); color: #b8a079;
                        margin-bottom: clamp(16px, 4vh, 40px);
                    }
                    #hardcore-gameover-container .hgo-em {
                        font-style: italic; font-size: clamp(15px, 2.6vmin, 24px);
                        color: #b48ad0; letter-spacing: 0.03em;
                        margin: calc(-1 * clamp(8px, 2vh, 20px)) 0 clamp(16px, 4vh, 40px) 0;
                        text-shadow: 0 0 12px rgba(150,90,200,0.55), 0 2px 4px #000;
                        animation: hgo-em-pulse 3.4s ease-in-out infinite;
                    }
                    @keyframes hgo-em-pulse {
                        0%, 100% { opacity: 0.72; }
                        50%      { opacity: 1; }
                    }
                    #hardcore-gameover-container .hgo-stats {
                        border-top: 1px solid rgba(201,180,138,0.25);
                        border-bottom: 1px solid rgba(201,180,138,0.25);
                        padding: clamp(12px, 2.5vh, 26px) 8px;
                        margin: 0 auto clamp(20px, 5vh, 46px) auto;
                        width: 100%; max-width: min(620px, 70vw);
                    }
                    #hardcore-gameover-container .hgo-stat-row {
                        display: flex; align-items: baseline; justify-content: center; gap: 10px;
                        font-size: clamp(14px, 2.2vmin, 22px); margin: 6px 0;
                    }
                    #hardcore-gameover-container .hgo-stat-label { white-space: nowrap; color: #c9b48a; }
                    #hardcore-gameover-container .hgo-stat-value { white-space: nowrap; color: #f0e3c0; font-weight: bold; }
                    #hardcore-gameover-container .hgo-stat-dots { display: none; }
                    #hardcore-gameover-container .hgo-button {
                        display: inline-block; font-family: 'Lora', serif; font-size: clamp(14px, 2.2vmin, 22px);
                        background: #5a1414; color: #ecdcb9; padding: 0.6em 1.6em; border: 1.5px solid #2a0a0a;
                        border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;
                        transition: all 0.2s ease; cursor: pointer;
                    }
                    #hardcore-gameover-container .hgo-button:hover { background: #7a1c1c; box-shadow: 0 0 14px rgba(139,26,26,0.6); }
                </style>
                <div class="hgo-panel">
                    <h1 class="hgo-title">${titleText}</h1>
                    <div class="hgo-epitaph">${epitaph}</div>
                    ${emHTML}
                    ${statsHTML ? `<div class="hgo-stats">${statsHTML}</div>` : ""}
                    <div class="hgo-button" onclick="SceneManager._scene && SceneManager._scene.returnToTitle()">${btnText}</div>
                </div>`;
            document.body.appendChild(c);
            this._dom = c;

            const stop = ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'contextmenu', 'wheel'];
            stop.forEach(evt => c.addEventListener(evt, (e) => e.stopPropagation(), { passive: true }));
        }

        update() {
            super.update();
            if (this._inputReady && !this._returning && this.isActive()) {
                if (Input.isTriggered('ok') || Input.isTriggered('cancel') || TouchInput.isTriggered()) {
                    this.returnToTitle();
                }
            }
        }

        returnToTitle() {
            if (this._returning) return;
            this._returning = true;
            this._inputReady = false;
            SoundManager.playOk();
            this.removeUIContainer();
            this.fadeOutAll();
            SceneManager.goto(Scene_Title);
        }

        removeUIContainer() {
            if (this._dom && this._dom.parentNode) {
                this._dom.parentNode.removeChild(this._dom);
            }
            this._dom = null;
        }

        terminate() {
            super.terminate();
            if (this._inputTimer) clearTimeout(this._inputTimer);
            this.removeUIContainer();
        }
    }

    

    window.Scene_HardcoreGameOver = Scene_HardcoreGameOver;

    // =========================================================================
    // F5 Quicksave / F9 Quickload Integration
    // =========================================================================

    // F5 quicksave / F9 quickload, as in Bethesda's games. F9 (120) overrides
    // RPG Maker's default debug menu. Quickload used to sit on F10 (121), which
    // UI/ResolutionSwitcher.js loads later and claims for its own toggle, so the
    // binding never fired.
    Input.keyMapper[116] = 'quicksave';
    Input.keyMapper[120] = 'quickload';

    // F5 is the browser/NW.js reload key: swallow it before the host acts on it,
    // or quicksaving would restart the game.
    document.addEventListener('keydown', event => {
        if (event.keyCode === 116) event.preventDefault();
    });

    const _Scene_Map_update_quicks = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update_quicks.call(this);
        
        // Prevent actions if a scene transition or event is blocking the player
        if (this.isBusy() || $gameMap.isEventRunning() || $gameMessage.isBusy()) return;

        if (Input.isTriggered('quicksave')) {
            this.executeQuicksave();
        } else if (Input.isTriggered('quickload')) {
            this.executeQuickload();
        }
    };

    // F5 fills the three quicksave slots in turn, then keeps rolling over the
    // oldest one: a quicksave never refuses to write and never touches the
    // playthrough's own save.
    Scene_Map.prototype.getQuicksaveSlot = function() {
        return nextQuickSlot();
    };

    // F9 reloads the newest of the three.
    Scene_Map.prototype.getQuickloadSlot = function() {
        return latestQuickSlot();
    };

    Scene_Map.prototype.executeQuicksave = function() {
        if (!$gameSystem.isSaveEnabled()) {
            SoundManager.playBuzzer();
            this.showQuickPopup("Saving Disabled");
            return;
        }

        const slot = this.getQuicksaveSlot();
        window.SaveSystem.recordSaveLocation();
        $gameSystem.onBeforeSave();

        DataManager.saveGame(slot)
            .then(() => {
                stampQuickOwner(slot);
                SoundManager.playSave();
                this.showQuickPopup("Quicksaved To Slot", { n: quickSlotNumber(slot) });
            })
            .catch(() => {
                SoundManager.playBuzzer();
                this.showQuickPopup("Quicksave Failed");
            });
    };

    Scene_Map.prototype.executeQuickload = function() {
        const slot = this.getQuickloadSlot();

        if (slot > 0 && DataManager.savefileInfo(slot)) {
            SoundManager.playLoad();

            // Set a flag so the popup shows after the map finishes loading
            if ($gameTemp) $gameTemp._showQuickloadPopup = quickSlotNumber(slot);

            DataManager.loadGame(slot)
                .then(() => {
                    $gameSystem.onAfterLoad();
                    if ($gameSystem.versionId() !== $dataSystem.versionId) {
                        const mapId = $gameMap.mapId();
                        const x = $gamePlayer.x;
                        const y = $gamePlayer.y;
                        const d = $gamePlayer.direction();
                        $gamePlayer.reserveTransfer(mapId, x, y, d, 0);
                        $gamePlayer.requestMapReload();
                    }
                    SceneManager.goto(Scene_Map);
                })
                .catch((error) => {
                    console.error("Quickload failed:", error);
                    SoundManager.playBuzzer();
                    this.showQuickPopup("Load Failed");
                });
        } else {
            SoundManager.playBuzzer();
            this.showQuickPopup("No Quicksave Found");
        }
    };

    // Displays a temporary popup via the shared standardized toast
    // i18n-ignore-start: map keys are the English labels the call sites pass
    const QUICK_POPUP_KEYS = {
        "Saving Disabled": "savingDisabled",
        "Game Quicksaved": "gameQuicksaved",
        "Quicksaved To Slot": "quicksavedToSlot",
        "Quicksave Failed": "quicksaveFailed",
        "Load Failed": "loadFailed",
        "No Quicksave Found": "noQuicksaveFound",
        "Game Loaded": "gameLoaded",
        "Quicksave Loaded": "quicksaveLoaded",
    };
    // i18n-ignore-end
    Scene_Map.prototype.showQuickPopup = function(text, params) {
        if (!window.ParchmentToast) return;
        const key = QUICK_POPUP_KEYS[text];
        const msg = key ? T('SaveSystem.quick.' + key, params) : text;
        const isError = /Failed|Disabled|No Quicksave/.test(text);
        window.ParchmentToast.show(msg, {
            severity: isError ? "warning" : "info",
            duration: 120,
        });
    };

    // Intercept map start to show the load popup if a quickload just finished
    const _Scene_Map_start_quickload = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _Scene_Map_start_quickload.call(this);
        if ($gameTemp && $gameTemp._showQuickloadPopup) {
            const n = $gameTemp._showQuickloadPopup;
            $gameTemp._showQuickloadPopup = false;
            if (typeof n === "number") {
                this.showQuickPopup("Quicksave Loaded", { n });
            } else {
                this.showQuickPopup("Game Loaded");
            }
        }
    };
})();