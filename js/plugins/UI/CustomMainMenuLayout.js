/*:
 * @target MZ
 * @plugindesc Fully custom D&D 5e-style Parchment Character Sheet & Adventure Manual UI DOM Overlay [Claude+GPT].
 * @author Esoteric Heavy Industries
 *
 * @help
 * This plugin:
 * - Overlays a gorgeous procedural tea-stained parchment double-page manual.
 * - Left Page: Commands Pockets with classic typography, icons, and hotkeys.
 * - Right Page: D&D 5e Character Sheet mapping stats to STR, CON, DEX, INT, WIS, and PSI.
 * - Renders alchemical fluid tubes for HP/MP/TP and exhaustion bars for Hunger/Sleep.
 * - Renders companion circular frames to switch active character sheets dynamically.
 * - Renders dynamic pixel character portraits directly on DOM canvases.
 * - Maintains full keyboard, mouse, and gamepad arrow key navigation support.
 * - Owns the game's hotkey layout, laid out to Bethesda (Skyrim/Fallout)
 *   muscle memory. Every key lives in the HOTKEYS table near the top of the
 *   file, which drives Input.keyMapper, the badges on the pockets tiles, the
 *   in-menu shortcuts and the on-map shortcuts at once.
 *
 *     Tab  Open / close the menu        T  Wait (passes time, no rest)
 *     I    Inventory                    J  Journal (Quest Log)
 *     P    Magic (Skills)               C  Character (Status)
 *     R    Ready gear (Equip)           M  Map (minimap toggle)
 *     V    Vehicles                     B  Build
 *     F    Factions                     H  Holdings (Assets)
 *     K    Cooking                      L  Lore (Codex)
 *     N    Training                     Y  Bestiary
 *     U    Biologics                    O  Options
 *     G    Sandbox (tester only)        1-9 Favourite items (on the map)
 *     1/2/3 Thinker / Multiplayer / Hypernet (inside the menu only)
 *     F5   Quicksave, F9 Quickload (Core/SaveSystem.js)
 *
 *   W/A/S/D move, Z/X are ok/cancel and Q/E zoom the world map
 *   (Map/WorldMap.js), so none of those are available for commands.
 */

(function () {
    const pluginName = "CustomMainMenuLayout";

    // Escape user-controllable text (player/party/pet names) before innerHTML
    // injection so a `<` in a name can't break or inject markup.
    function escapeHtml(str) {
        return String(str ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[c]);
    }

    // While Em travels with the party the menu picks up her vocabulary: the
    // needs cards and a handful of tiles answer to her register instead of the
    // clinical one (CharacterCreationPresets.emLabel). Every other party gets
    // the fallback passed in here, so this is a no-op on an ordinary run.
    function emLabel(key, label) {
        return window.CharacterPresets?.emLabel?.(key, label) ?? label;
    }

    // The Hypernet command is only usable while the party carries a device able
    // to reach the Hypernet. The plain Hexphone Communicator (160) deliberately
    // does NOT count, it has no Hypernet uplink. Edit this list to add/remove
    // qualifying gear.
    const INTERNET_CAPABLE_ITEM_IDS = [
        153, // Color Flip Mobile Phone ("just enough internet")
        157, // Encrypted Burner Phone (networked encrypted messaging)
        162, // EHI Pilot PDA ("stays online")
        394  // Investigative Laptop (online espionage/decryption software)
    ];

    // Hypernet is available when the party carries an internet-capable device,
    // or unconditionally for the "Test" player / while sandbox mode is active.
    function isHypernetAvailable() {
        const isTester = typeof $gameActors !== "undefined" && $gameActors && $gameActors.actor(1) && $gameActors.actor(1).name() === "Test"; // i18n-ignore: tester account name, matched literally
        const isSandbox = !!(typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._isSandboxMode);
        if (isTester || isSandbox) return true;
        if (typeof $gameParty === "undefined" || !$gameParty || typeof $dataItems === "undefined") return false;
        return INTERNET_CAPABLE_ITEM_IDS.some(id => {
            const item = $dataItems[id];
            return item && $gameParty.hasItem(item);
        });
    }

    // =========================================================================
    // Hotkey layout (Bethesda-style)
    // =========================================================================
    // ONE table drives everything: the Input.keyMapper entries, the badge
    // printed on each pockets tile, the in-menu shortcuts and the on-map
    // shortcuts. Add keys here and nowhere else, the badge and the key it
    // claims used to be declared separately and had drifted apart on half the
    // commands (Equip advertised U but listened on E, Save advertised I but
    // listened on A, ...).
    //
    // The layout follows Skyrim/Fallout muscle memory:
    //   T Wait · I Inventory · J Journal(Quests) · P Magic(Skills)
    //   C Character(Status) · M Map · R Ready gear(Equip) · Tab open/close menu
    //   F5 quicksave · F9 quickload (see Core/SaveSystem.js)
    //
    // Reserved and unavailable: W/A/S/D (movement), Z/X (ok/cancel),
    // Q/E (Map/WorldMap.js zoom, that plugin loads later and wins the mapping).
    // `input` overrides the derived "letter_<key>" symbol for keys another
    // plugin already owns; `code` is omitted for those so we don't fight over
    // Input.keyMapper.
    const HOTKEYS = [
        { symbol: "item",        key: "I", code: 73 },
        { symbol: "sleep_menu",  key: "T", code: 84 },
        { symbol: "quest_log",   key: "J", code: 74 },
        { symbol: "skill",       key: "P", code: 80 },
        { symbol: "status1",     key: "C", code: 67 },
        { symbol: "equip",       key: "R", code: 82 },
        { symbol: "world_map",   key: "M", input: "world_map_toggle" }, // owned by Map/WorldMap.js
        { symbol: "vehicles",    key: "V", code: 86 },
        { symbol: "build",       key: "B", code: 66 },
        { symbol: "factions",    key: "F", code: 70 },
        { symbol: "assets",      key: "H", code: 72 },
        { symbol: "cooking",     key: "K", code: 75 },
        { symbol: "help",        key: "L", code: 76 },
        { symbol: "training",    key: "N", code: 78 },
        { symbol: "bestiary",    key: "Y", code: 89 },
        { symbol: "biologics",   key: "U", code: 85 },
        { symbol: "options",     key: "O", code: 79 },
        { symbol: "sandbox",     key: "G", code: 71 },
        // Digits stay the favourites hotbar on the map (ItemSystem/
        // ItemSystemInventory.js already maps 1-9 to it, Skyrim-style), so these
        // three only listen on the symbols that plugin defines and are reachable
        // by key from inside the menu, never from the field.
        { symbol: "thinker",     key: "1", input: "1" },
        { symbol: "multiplayer", key: "2", input: "2" },
        { symbol: "hypernet",    key: "3", input: "3" }
    ];

    // Input symbol each hotkey listens on, and the badge lookup used by the
    // pockets tiles. Commands missing from HOTKEYS (Save, Resign, Dynamics,
    // Pets, Tools) simply render without a badge.
    HOTKEYS.forEach(h => { h.input = h.input || ("letter_" + h.key.toLowerCase()); });
    const HOTKEY_LABELS = {};
    HOTKEYS.forEach(h => { HOTKEY_LABELS[h.symbol] = h.key; });

    const COMMAND_ICONS = {
        item: 209,
        equip: 96,
        skill: 133,
        status1: 263,
        specializations: 306,
        sleep_menu: 11,
        save: 121,
        cooking: 219,
        thinker: 359,
        build: 390,
        quest_log: 191,
        training: 189,
        research: 79,
        bestiary: 267,
        world_map: 190,
        factions: 132,
        biologics: 84,
        help: 186,
        options: 83,
        tools: 252,
        dynamics: 196,
        sandbox: 245,
        multiplayer: 79,
        hypernet: 248,
        gameEnd: 248,
        assets: 229,
        pets: 113,
        vehicles: 82,
        army: 77
    };

    // =========================================================================
    // Resources Loader
    // =========================================================================
    function loadUIResources() {
        if (!document.getElementById('stylesheet')) {

        }
    }

    loadUIResources();

    // =========================================================================
    // Input tracking fallback for RPG Maker
    // =========================================================================
    let lastInputType = 'keyboard';
    const _Input_onKeyDown = Input._onKeyDown;
    Input._onKeyDown = function (event) {
        _Input_onKeyDown.call(this, event);
        lastInputType = 'keyboard';
    };

    const _TouchInput_onTrigger = TouchInput._onTrigger;
    TouchInput._onTrigger = function (x, y) {
        _TouchInput_onTrigger.call(this, x, y);
        lastInputType = 'mouse';
    };

    const _Input_pollGamepads = Input._pollGamepads;
    Input._pollGamepads = function () {
        _Input_pollGamepads.call(this);
        const gamepads = navigator.getGamepads();
        if (gamepads) {
            for (const gamepad of gamepads) {
                if (gamepad && gamepad.buttons.some(b => b.pressed)) {
                    lastInputType = 'gamepad';
                    break;
                }
            }
        }
    };

    // Claim the keys declared in HOTKEYS. Entries without a `code` are owned by
    // another plugin (see the table) and are only listened to, never remapped.
    HOTKEYS.forEach(h => {
        if (h.code) Input.keyMapper[h.code] = h.input;
    });

    // =========================================================================
    // UIMenuInputManager (Full keyboard & gamepad menu navigator overlay)
    // =========================================================================
    class UIMenuInputManager {
        static init(menuContainer) {
            this.container = menuContainer;
            this.activeElements = [];
            this.focusIndex = 0;
            this.active = false;
            this.cols = 2;
        }

        static activate(cols = 2) {
            this.activeElements = Array.from(this.container.querySelectorAll('.focusable'));
            this.focusIndex = 0;
            this.cols = cols;
            this.active = true;
            this.buildRows();
            this.updateFocus();
        }

        // The commands pockets are split into logical groups of any size, so a tile's
        // column is no longer just (index % cols): a group with an odd number of
        // entries shifts everything after it. Bucket the focusable tiles into real
        // visual rows by their on-screen position and navigate on that instead.
        // this._rows stays null when geometry is unavailable (hidden container),
        // in which case navigation falls back to the flat index maths.
        static buildRows() {
            this._rows = null;
            const boxes = this.activeElements.map(el => el.getBoundingClientRect());
            if (!boxes.length || boxes.every(b => !b.width && !b.height)) return;

            const rows = [];
            boxes.forEach((box, i) => {
                const row = rows.find(r => Math.abs(r.top - box.top) <= Math.max(4, box.height / 2));
                if (row) row.items.push({ index: i, left: box.left });
                else rows.push({ top: box.top, items: [{ index: i, left: box.left }] });
            });
            rows.sort((a, b) => a.top - b.top);
            rows.forEach(r => r.items.sort((a, b) => a.left - b.left));
            this._rows = rows;
        }

        // Position of the focused tile as [row, column] within this._rows.
        static focusPosition() {
            if (!this._rows) return null;
            for (let r = 0; r < this._rows.length; r++) {
                const c = this._rows[r].items.findIndex(it => it.index === this.focusIndex);
                if (c >= 0) return [r, c];
            }
            return null;
        }

        // Step one row up or down, landing on the tile horizontally closest to the
        // one we left. Wraps around the ends like the old index maths did.
        static moveRow(delta) {
            const pos = this.focusPosition();
            if (!pos) return false;
            const [row, col] = pos;
            const left = this._rows[row].items[col].left;
            const target = this._rows[(row + delta + this._rows.length) % this._rows.length];
            let best = target.items[0];
            target.items.forEach(it => {
                if (Math.abs(it.left - left) < Math.abs(best.left - left)) best = it;
            });
            this.focusIndex = best.index;
            return true;
        }

        // Step within the current row; does not wrap onto the neighbouring rows.
        static moveColumn(delta) {
            const pos = this.focusPosition();
            if (!pos) return false;
            const [row, col] = pos;
            const next = this._rows[row].items[col + delta];
            if (!next) return true;
            this.focusIndex = next.index;
            return true;
        }

        static deactivate() {
            this.active = false;
        }

        static update() {
            if (!this.active || this.activeElements.length === 0) return;

            let moved = false;
            const len = this.activeElements.length;

            if (Input.isTriggered('down') || Input.isRepeated('down')) {
                if (!this.moveRow(1)) {
                    if (this.focusIndex + this.cols < len) {
                        this.focusIndex += this.cols;
                    } else {
                        this.focusIndex = this.focusIndex % this.cols;
                    }
                }
                moved = true;
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                if (!this.moveRow(-1)) {
                    if (this.focusIndex - this.cols >= 0) {
                        this.focusIndex -= this.cols;
                    } else {
                        let target = Math.floor((len - 1) / this.cols) * this.cols + (this.focusIndex % this.cols);
                        if (target >= len) target -= this.cols;
                        this.focusIndex = target >= 0 ? target : 0;
                    }
                }
                moved = true;
            } else if (Input.isTriggered('right') || Input.isRepeated('right')) {
                if (this.moveColumn(1)) {
                    moved = true;
                } else if (this.focusIndex % this.cols < this.cols - 1 && this.focusIndex + 1 < len) {
                    this.focusIndex += 1;
                    moved = true;
                }
            } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
                if (this.moveColumn(-1)) {
                    moved = true;
                } else if (this.focusIndex % this.cols > 0) {
                    this.focusIndex -= 1;
                    moved = true;
                }
            } else if (Input.isTriggered('ok')) {
                SoundManager.playOk();
                const el = this.activeElements[this.focusIndex];
                if (el) el.click();
            } else if (Input.isTriggered('cancel') || Input.isTriggered('tab')) {
                // Tab backs out of the menu the way it opened it (Bethesda).
                const scene = SceneManager._scene;
                if (!scene || !scene.backOutOneLevel || !scene.backOutOneLevel()) {
                    SoundManager.playCancel();
                    SceneManager._scene.popScene();
                }
            }

            // Keyboard direct hotkeys when the menu is open. The Sandbox tile is
            // hidden unless the actor is named Test or sandbox mode is active
            // (#92), and triggerHotkey only fires on tiles that exist, so the
            // gate is implicit.
            HOTKEYS.forEach(h => {
                if (Input.isTriggered(h.input)) this.triggerHotkey(h.symbol);
            });

            if (moved) {
                SoundManager.playCursor();
                this.updateFocus();
            }
        }

        static triggerHotkey(symbol) {
            const el = this.container.querySelector(`[data-symbol="${symbol}"]`);
            // Greyed-out tiles (Sleep away from a bed, Build on the world map)
            // stop mouse clicks through pointer-events, but el.click() ignores
            // that, so the hotkey has to respect it explicitly.
            if (el && el.style.pointerEvents !== "none") {
                SoundManager.playOk();
                el.click();
            }
        }

        static updateFocus() {
            this.activeElements.forEach((el, idx) => {
                if (idx === this.focusIndex) {
                    el.classList.add('selected');
                    el.scrollIntoView({ block: 'nearest' });
                } else {
                    el.classList.remove('selected');
                }
            });
        }
    }

    // =========================================================================
    // Scene_Menu - Intercept and replace layout with D&D HTML Overlay
    // =========================================================================
    const _Scene_Menu_create = Scene_Menu.prototype.create;
    Scene_Menu.prototype.create = function () {
        // Clear TouchInput immediately to prevent the opening right-click/touch from carrying over and immediately closing the menu!
        if (typeof TouchInput !== 'undefined' && typeof TouchInput.clear === 'function') {
            TouchInput.clear();
        }

        const members = $gameParty.members();
        const actor = $gameParty.menuActor();
        this._selectedActorIndex = members.indexOf(actor);
        if (this._selectedActorIndex < 0) this._selectedActorIndex = 0;
        this._isToolsPage = false;
        this._isWorldMapPage = false;
        this._isDynamicsPage = false;
        this._dynamicsView = 'hub';
        this._dynamicsPendingRetireId = null;
        this._isPetsPage = false;
        this._isVehiclesPage = false;
        this._rightClickStartedOnMenu = false;

        _Scene_Menu_create.call(this);

        // Hide ALL default game canvas windows to clean the screen
        if (this._commandWindow) this._commandWindow.visible = false;
        if (this._statusWindow) this._statusWindow.visible = false;
        if (this._goldWindow) this._goldWindow.visible = false;
        if (this._hungerSleepStatusWindow) this._hungerSleepStatusWindow.visible = false;
        if (this._timeTemperatureWindow) this._timeTemperatureWindow.visible = false;
        if (this._bountyWindow) this._bountyWindow.visible = false;
        if (this._menuRightColumnWindow) this._menuRightColumnWindow.visible = false;
        if (this._cancelButton) this._cancelButton.visible = false;

        // Check if our persistent menu DOM container already exists in the body
        const existing = document.getElementById('menu-container');
        if (existing) {
            this._dndContainer = existing;

            // Cancel any pending backdrop dissolve scheduled by the outgoing transition
            // so the menu doesn't fade away just as we return to it.
            if (existing._dndHideTimer) {
                clearTimeout(existing._dndHideTimer);
                existing._dndHideTimer = null;
            }
            existing._dndHideToken = (existing._dndHideToken || 0) + 1;
            existing.style.zIndex = ""; // restore the CSS stacking order (1000)

            UIMenuInputManager.init(this._dndContainer);
            this.addMenuEventListeners(); // Ensure context menu right-click listener is bound
            this.refreshUIMenuDOM(false); // Draw instantly in background

            this._dndContainer.style.pointerEvents = "auto";

            // Temporarily disable entrance animation so it doesn't flicker/rustle
            const spread = this._dndContainer.querySelector(".book-spread");
            if (spread) {
                spread.style.animation = "none";
            }

            // Snap the parchment back in instantly (no fade). The content is already
            // drawn above, so it covers the outgoing window's scene change in one frame
            // instead of cross-fading through it.
            this._dndContainer.style.transition = "none";
            this._dndContainer.style.opacity = "1";
        } else {
            // First open: create DOM container fresh
            this.createUIMenuDOM();
        }
    };

    Scene_Menu.prototype.selectedActor = function () {
        const members = $gameParty.members();
        return members[this._selectedActorIndex] || members[0];
    };

    Scene_Menu.prototype.switchSelectedActor = function (index) {
        if (index === this._selectedActorIndex) return;
        SoundManager.playCursor();
        this._selectedActorIndex = index;
        this.refreshUIMenuDOM(true); // Enable premium smooth transitions!
    };

    Scene_Menu.prototype.getMemberNeeds = function (mem) {
        // Shared needs vocabulary lives in TimeDateSystem.js (window.PartyNeeds),
        // so the menu and the travel HUD report identical values.
        if (window.PartyNeeds) return window.PartyNeeds.getMemberNeeds(mem);

        // Fallback if TimeDateSystem hasn't loaded: player keeps full needs at 100.
        const profile = window.NPCSocietyRegistry?.getProfile?.(mem.name());
        const isPlayer = mem.actorId() === 1;
        return {
            hunger:  isPlayer ? (mem.hungerPercent ? mem.hungerPercent() : 100) : Math.round(profile?.hunger  ?? 100),
            sleep:   isPlayer ? (mem.sleepPercent  ? mem.sleepPercent()  : 100) : Math.round(profile?.sleep   ?? 100),
            hygiene: isPlayer ? 100 : Math.round(profile?.hygiene ?? 100),
            social:  isPlayer ? 100 : Math.round(profile?.social  ?? 100),
            leisure: isPlayer ? 100 : Math.round(profile?.leisure ?? 100),
        };
    };

    Scene_Menu.prototype.showToolsPage = function () {
        SoundManager.playOk();
        this._isToolsPage = true;
        this.refreshUIMenuDOM(true); // Enable premium smooth transitions!
    };

    Scene_Menu.prototype.hideToolsPage = function () {
        SoundManager.playCancel();
        this._isToolsPage = false;
        this.refreshUIMenuDOM(true); // Enable premium smooth transitions!
    };

    Scene_Menu.prototype.addMenuEventListeners = function () {
        if (!this._dndContainer || this._dndContainer._hasContextMenuListener) return;

        this._rightClickStartedOnMenu = false;

        this._dndContainer.addEventListener('mousedown', (event) => {
            if (event.button === 2) { // Right click down
                this._rightClickStartedOnMenu = true;
            }
        });

        this._dndContainer.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation(); // Stop event propagation so standard TouchInput on document does not receive it

            if (!this._rightClickStartedOnMenu) {
                return; // Ignore right-clicks that started on the map and were only released here
            }
            this._rightClickStartedOnMenu = false;

            const scene = SceneManager._scene;
            if (scene && scene.isActive()) {
                if (!scene.backOutOneLevel || !scene.backOutOneLevel()) {
                    SoundManager.playCancel();
                    scene.popScene();
                }
            }
        });

        this._dndContainer._hasContextMenuListener = true;
    };

    Scene_Menu.prototype.createUIMenuDOM = function () {
        this._dndContainer = document.createElement('div');
        this._dndContainer.id = 'menu-container';
        this._dndContainer.style.opacity = "0";
        this._dndContainer.style.transition = "opacity 0.22s ease-out";
        document.body.appendChild(this._dndContainer);

        this.addMenuEventListeners(); // Ensure context menu right-click listener is bound

        UIMenuInputManager.init(this._dndContainer);
        this.refreshUIMenuDOM(false); // Initial load: draw instantly

        // Force reflow and trigger smooth fade-in
        setTimeout(() => {
            if (this._dndContainer) {
                this._dndContainer.style.opacity = "1";
            }
        }, 16);
    };

    Scene_Menu.prototype.fadeTransitionLeftPage = function (newHtml, newKey) {
        const spread = this._dndContainer ? this._dndContainer.querySelector(".book-spread") : null;
        if (!spread) return;
        const leftPageContainer = spread.querySelector(".left-page");
        if (!leftPageContainer) return;

        leftPageContainer.style.transition = "opacity 0.12s ease-out, transform 0.12s ease-out";
        leftPageContainer.style.opacity = "0";
        leftPageContainer.style.transform = "translateX(-6px)";

        setTimeout(() => {
            this._dndLastLeftPageKey = newKey;
            leftPageContainer.innerHTML = newHtml;

            // Pets page renders its portraits on the left page.
            this.drawAllPetPortraits();
            // Dynamics roster renders its member portraits on the left page.
            this.drawAllRosterPortraits();
            // Vehicles page renders its sprites on the left page.
            this.drawAllVehicleSprites();

            // Re-bind focusable commands in new list immediately so keyboard/gamepad navigation finds them
            UIMenuInputManager.activate(this._isWorldMapPage ? 1 : 3);

            leftPageContainer.style.transition = "opacity 0.15s ease-in, transform 0.15s ease-in";
            leftPageContainer.style.opacity = "1";
            leftPageContainer.style.transform = "translateX(0px)";
        }, 120);
    };

    Scene_Menu.prototype.fadeTransitionRightPage = function (newHtml, actor) {
        const spread = this._dndContainer ? this._dndContainer.querySelector(".book-spread") : null;
        if (!spread) return;
        const rightPageContainer = spread.querySelector(".right-page");
        if (!rightPageContainer) return;

        rightPageContainer.style.transition = "opacity 0.12s ease-out, transform 0.12s ease-out";
        rightPageContainer.style.opacity = "0";
        rightPageContainer.style.transform = "translateX(6px)";

        setTimeout(() => {
            rightPageContainer.innerHTML = newHtml;

            // Render Canvases for portraits
            this.drawAllPartyPortraits();

            rightPageContainer.style.transition = "opacity 0.15s ease-in, transform 0.15s ease-in";
            rightPageContainer.style.opacity = "1";
            rightPageContainer.style.transform = "translateX(0px)";
        }, 120);
    };

    // Single back-out ladder shared by the ESC/Tab key, the gamepad cancel button
    // and the right-click handler, so a newly added pockets page can never be
    // wired into one path and forgotten in another. Returns true when a nested
    // page absorbed the cancel; false means "nothing nested left, close the menu".
    // Each hideXPage() plays its own cancel SE, so callers must not play one too.
    Scene_Menu.prototype.backOutOneLevel = function () {
        if (this._isWorldMapPage) {
            this.hideWorldMapPage();
        } else if (this._isToolsPage) {
            this.hideToolsPage();
        } else if (this._isDynamicsPage) {
            this.hideDynamicsPage();
        } else if (this._isPetsPage) {
            this.hidePetsPage();
        } else if (this._isVehiclesPage) {
            this.hideVehiclesPage();
        } else {
            return false;
        }
        return true;
    };

    Scene_Menu.prototype.showDynamicsPage = function () {
        SoundManager.playOk();
        this._isDynamicsPage = true;
        this._dynamicsView = 'hub';
        this._dynamicsPendingRetireId = null;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.hideDynamicsPage = function () {
        SoundManager.playCancel();
        this._dynamicsPendingRetireId = null;
        // Backing out of a sub-page lands on the Dynamics hub; only the hub
        // itself closes back to the pockets.
        if (this._dynamicsView && this._dynamicsView !== 'hub') {
            this._dynamicsView = 'hub';
        } else {
            this._isDynamicsPage = false;
        }
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.showPetsPage = function () {
        SoundManager.playOk();
        this._isPetsPage = true;
        this._petRenameId = null;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.hidePetsPage = function () {
        SoundManager.playCancel();
        this._isPetsPage = false;
        // An open name field is abandoned with the page, so coming back never
        // reopens it half-typed.
        this._petRenameId = null;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.showVehiclesPage = function () {
        SoundManager.playOk();
        this._isVehiclesPage = true;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.hideVehiclesPage = function () {
        SoundManager.playCancel();
        this._isVehiclesPage = false;
        this.refreshUIMenuDOM(true);
    };

    // Summon an owned vehicle: close the menu (back to the map) then teleport the
    // vehicle beside the player. Spawning needs Scene_Map, so it runs after popScene.
    Scene_Menu.prototype.spawnUIVehicle = function (key) {
        if (!window.MergedVehicleSystem) return;
        // Indoors (a house, a vehicle cabin, or a procedural interior such as a
        // dungeon, sewer or loot cellar) there is nowhere for most vehicles to
        // land, so the button is inert rather than closing the menu on a summon
        // that cannot happen. The bike answers true everywhere.
        if (window.MergedVehicleSystem.canSpawnHere &&
            !window.MergedVehicleSystem.canSpawnHere(key)) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playOk();
        this.popScene();
        setTimeout(() => {
            if (window.MergedVehicleSystem) window.MergedVehicleSystem.spawnVehicleByKey(key);
        }, 100);
    };

    // Open the repair / upgrade workshop for an owned vehicle (pushes its scene
    // on top of the menu; backing out returns here).
    Scene_Menu.prototype.repairUIVehicle = function (key) {
        if (!window.MergedVehicleSystem) return;
        SoundManager.playOk();
        window.MergedVehicleSystem.openRepairByKey(key);
    };

    Scene_Menu.prototype.setActivePet = function (petId) {
        if (!window.PetSystem) return;
        SoundManager.playOk();
        window.PetSystem.setActivePet(petId);
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.releasePet = function (petId) {
        if (!window.PetSystem) return;
        SoundManager.playCancel();
        this._petRenameId = null;
        window.PetSystem.releasePet(petId);
        this.refreshUIMenuDOM(false);
    };

    // Renaming a pet: the row turns into a name field (see the Pets page), which
    // takes the keyboard for itself. Every key event is stopped at the field so
    // the menu's own navigator and the hotkey mapper never see the typing, which
    // is why Enter and Escape are answered here rather than by the menu.
    Scene_Menu.prototype.startPetRename = function (petId) {
        if (!window.PetSystem || !window.PetSystem.getPet(petId)) return;
        SoundManager.playOk();
        this._petRenameId = petId;
        this.refreshUIMenuDOM(false);
        const field = document.getElementById('pet-rename-input');
        if (field) {
            field.focus();
            field.select();
        }
    };

    Scene_Menu.prototype.cancelPetRename = function () {
        if (this._petRenameId == null) return;
        SoundManager.playCancel();
        this._petRenameId = null;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.confirmPetRename = function () {
        const petId = this._petRenameId;
        if (petId == null || !window.PetSystem) return;
        const field = document.getElementById('pet-rename-input');
        const typed = field ? field.value : '';
        // An empty name is refused by renamePet, so the pet simply keeps the one
        // it has instead of turning into a blank row.
        if (!String(typed).trim()) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playOk();
        window.PetSystem.renamePet(petId, typed);
        this._petRenameId = null;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.onPetRenameKey = function (event) {
        if (!event) return;
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            this.confirmPetRename();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.cancelPetRename();
        }
    };

    // Draws a pet record's overworld sprite (Down-facing frame) onto its canvas.
    Scene_Menu.prototype.drawPetPortrait = function (pet, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !pet || !pet.characterName) return;

        const bitmap = ImageManager.loadCharacter(pet.characterName);
        const drawPortrait = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingEnabled = false;

            const isBig = ImageManager.isBigCharacter(pet.characterName);
            const pw = bitmap.width / (isBig ? 3 : 12);
            const ph = bitmap.height / (isBig ? 4 : 8);

            const charIndex = pet.characterIndex || 0;
            const sx = ((charIndex % 4) * 3 + 1) * pw;
            const sy = (Math.floor(charIndex / 4) * 4) * ph;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const fit = Math.min(canvas.width / pw, canvas.height / ph);
            const dw = pw * fit;
            const dh = ph * fit;
            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;
            ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, dx, dy, dw, dh);
        };

        if (bitmap.isReady()) drawPortrait();
        else bitmap.addLoadListener(drawPortrait);
    };

    Scene_Menu.prototype.drawAllPetPortraits = function () {
        if (!window.PetSystem) return;
        window.PetSystem.getPets().forEach(pet => {
            this.drawPetPortrait(pet, `pet-canvas-${pet.id}`);
        });
    };

    // Draws a vehicle's overworld character sprite (Left-facing frame) onto its
    // Vehicles-menu canvas.
    Scene_Menu.prototype.drawVehicleSprite = function (info, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !info || !info.spriteName) return;

        const bitmap = ImageManager.loadCharacter(info.spriteName);
        const render = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx || !bitmap.width || !bitmap.height) return;
            ctx.imageSmoothingEnabled = false;

            const isBig = ImageManager.isBigCharacter(info.spriteName);
            const pw = bitmap.width / (isBig ? 3 : 12);
            const ph = bitmap.height / (isBig ? 4 : 8);
            const blockX = isBig ? 0 : (info.spriteIndex % 4) * 3;
            const blockY = isBig ? 0 : Math.floor(info.spriteIndex / 4) * 4;
            const sx = (blockX + 1) * pw; // middle (standing) pattern
            const sy = (blockY + 1) * ph; // row 1 = left-facing direction

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const fit = Math.min(canvas.width / pw, canvas.height / ph);
            const dw = pw * fit;
            const dh = ph * fit;
            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;
            ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, dx, dy, dw, dh);
        };

        if (bitmap.isReady()) render();
        else bitmap.addLoadListener(render);
    };

    Scene_Menu.prototype.drawAllVehicleSprites = function () {
        if (!this._isVehiclesPage || !window.MergedVehicleSystem || !window.MergedVehicleSystem.getOwnedVehicles) return;
        window.MergedVehicleSystem.getOwnedVehicles().forEach(v => {
            this.drawVehicleSprite(v, `vehicle-canvas-${v.key}`);
        });
    };

    // =========================================================================
    // Party Dynamics page: a hub of three sub-pages
    //   roster  , promote a leader, bench a member (retiring them into a
    //             character-creation dossier for this world)
    //   wiki    , the Empathize encyclopedia opened on its Party section
    //   history , every member who ever travelled along, with the date they
    //             left and, when it applies, their date of death
    // =========================================================================

    Scene_Menu.prototype.setDynamicsView = function (view) {
        SoundManager.playOk();
        this._dynamicsView = view;
        this._dynamicsPendingRetireId = null;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.openDynamicsWiki = function () {
        if (!window.NPCEmpathize?.openWiki) return;
        SoundManager.playOk();
        window.NPCEmpathize.openWiki('party');
    };

    Scene_Menu.prototype.promoteUIPartyLeader = function (actorId) {
        const result = window.PartyRoster?.setLeader?.(actorId);
        if (!result || !result.ok) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playOk();
        // The leader is the menu's default actor, so keep the right page in sync.
        this._selectedActorIndex = 0;
        this.refreshUIMenuDOM(false);
    };

    // First click arms the row, second one confirms: benching a companion sends
    // them off the roster for the rest of this playthrough.
    Scene_Menu.prototype.askRetireUIMember = function (actorId) {
        SoundManager.playCursor();
        this._dynamicsPendingRetireId = actorId;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.cancelRetireUIMember = function () {
        SoundManager.playCancel();
        this._dynamicsPendingRetireId = null;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.retireUIMember = function (actorId) {
        const actor = $gameActors.actor(actorId);
        const name = actor ? actor.name() : '';
        const result = window.CharacterPresets?.retirePartyMember?.(actorId);
        this._dynamicsPendingRetireId = null;

        if (!result || !result.ok) {
            SoundManager.playBuzzer();
            const reason = result ? result.reason : '';
            const message = reason === 'lastMember'
                ? T('MainMenu.dynamics.partyEmpty')
                : reason === 'isLeader'
                    ? T('MainMenu.dynamics.isLeader', { name })
                    : T('MainMenu.dynamics.cannotRetire', { name: name || T('MainMenu.roster.thatMember') });
            window.ParchmentToast?.show?.(message, { severity: 'warning', duration: 200 });
            this.refreshUIMenuDOM(false);
            return;
        }

        SoundManager.playOk();
        window.ParchmentToast?.show?.(
            T('MainMenu.dynamics.nowInactive', { name }),
            { severity: 'info', duration: 220 }
        );
        // The roster shrank, so the right-page selection may point past the end.
        this._selectedActorIndex = Math.min(this._selectedActorIndex, $gameParty.members().length - 1);
        this.refreshUIMenuDOM(false);
    };

    // Calls an inactive member back into a free party slot. The bench is
    // world-scoped (world.json "retiredCharacters"), so it holds everyone every
    // savegame of this world has ever benched, and taking one clears them from
    // the bench for all of them.
    Scene_Menu.prototype.reactivateUIMember = function (presetId) {
        const result = window.CharacterPresets?.unretirePartyMember?.(presetId);

        if (!result || !result.ok) {
            SoundManager.playBuzzer();
            const message = (result && result.reason === 'partyFull')
                ? T('MainMenu.dynamics.inactiveFull')
                : T('MainMenu.dynamics.cannotRejoin', { name: T('MainMenu.roster.thatMember') });
            window.ParchmentToast?.show?.(message, { severity: 'warning', duration: 200 });
            this.refreshUIMenuDOM(false);
            return;
        }

        SoundManager.playOk();
        window.ParchmentToast?.show?.(
            T('MainMenu.dynamics.rejoined', { name: result.preset.name }),
            { severity: 'info', duration: 220 }
        );
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.generateUIDynamicsPageHTML = function () {
        const view = this._dynamicsView || 'hub';
        if (view === 'roster') return this.generateUIDynamicsRosterHTML();
        if (view === 'history') return this.generateUIDynamicsHistoryHTML();

        const partySize = $gameParty.members().length;
        const pastCount = (window.PartyRoster?.history?.() ?? []).filter(e => e.status !== 'active').length;
        const wikiEnabled = !!window.NPCEmpathize?.openWiki;

        // The hint ink is left to CSS (.pockets-hint) so each theme can set a
        // readable colour; a hardcoded brown was unreadable on the dark themes.
        const tile = (label, hint, iconIndex, action, enabled) => `
                        <div class="command-item dynamics-tile focusable" style="width:100%;opacity:${enabled ? 1 : 0.45};pointer-events:${enabled ? 'auto' : 'none'};"
                            onclick="${enabled ? action : ''}/* i18n-ignore: inline handler */">
                            <span class="icon" style="background: url('img/system/IconSet.png') -${(iconIndex % 16) * 32}px -${Math.floor(iconIndex / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                            <span style="display:flex;flex-direction:column;align-items:flex-start;">
                                <span>${label}</span>
                                <span class="pockets-hint" style="font-size:0.72em;">${hint}</span>
                            </span>
                        </div>`;

        return `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="SceneManager._scene?.hideDynamicsPage?.()">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.dynamics.title')}</h2>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px;">
                        ${tile(T('MainMenu.dynamics.roster'), T('MainMenu.dynamics.rosterSub', { count: partySize }), COMMAND_ICONS.dynamics,
                            "SceneManager._scene?.setDynamicsView?.('roster')", true)}
                        ${tile(T('MainMenu.dynamics.wiki'), T('MainMenu.dynamics.wikiHint'), 191,
                            "SceneManager._scene?.openDynamicsWiki?.()", wikiEnabled)}
                        ${tile(T('MainMenu.dynamics.history'), pastCount ? T.n('MainMenu.dynamics.historySub', pastCount) : T('MainMenu.dynamics.historyHint'), 187,
                            "SceneManager._scene?.setDynamicsView?.('history')", true)}
                    </div>
                </div>`;
    };

    Scene_Menu.prototype.generateUIDynamicsRosterHTML = function () {
        const members = $gameParty.members();
        const canRetire = members.length > 1;
        let memberRows = '';

        members.forEach((mem, idx) => {
            const actorId  = mem.actorId();
            const isLeader = (idx === 0);
            const pending  = this._dynamicsPendingRetireId === actorId;
            // The leader stays: hand the party over first, then bench them.
            const canRetireThis = canRetire && !isLeader;

            const leaderBtn = isLeader
                ? `<div class="command-item" style="flex:1;opacity:0.6;pointer-events:none;">${T('MainMenu.roster.leader')}</div>`
                : `<div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.promoteUIPartyLeader?.(${actorId})">${T('MainMenu.roster.makeLeader')}</div>`;

            // Retiring is a one-way door, so the row asks twice.
            const retireBtns = pending
                ? `<div class="command-item focusable" style="flex:1;color:#8b1010;" onclick="SceneManager._scene?.retireUIMember?.(${actorId})">${T('MainMenu.roster.confirm')}</div>
                            <div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.cancelRetireUIMember?.()">${T('MainMenu.roster.cancel')}</div>`
                : (canRetireThis
                    ? `<div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.askRetireUIMember?.(${actorId})">${T('MainMenu.roster.setInactive')}</div>`
                    : `<div class="command-item" style="flex:1;opacity:0.45;pointer-events:none;">${T('MainMenu.roster.setInactive')}</div>`);

            memberRows += `
                    <div class="npc-dynamics-member" style="margin-bottom:16px;border-bottom:1px dashed rgba(74,39,17,0.25);padding-bottom:12px;display:flex;gap:12px;align-items:center;">
                        <div class="portrait-frame" style="flex-shrink:0;">
                            <canvas id="roster-canvas-${actorId}" width="48" height="48"></canvas>
                        </div>
                        <div style="flex:1;">
                            <div style="font-family:'Lora',serif;font-size:1.05em;color:#58180D;font-weight:bold;margin-bottom:6px;">
                                ${escapeHtml(mem.name())}
                                <span style="font-size:0.78em;font-weight:normal;color:#7a5c3a;margin-left:6px;">${escapeHtml(mem.currentClass() ? mem.currentClass().name : '')} Lv.${mem.level}${isLeader ? ' · leads the party' : ''}</span>
                            </div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                ${leaderBtn}
                                ${retireBtns}
                                <div class="command-item focusable" style="flex:1;" onclick="window.NPCEmpathize?.openForActor(${actorId})">${T('MainMenu.roster.empathize')}</div>
                            </div>
                        </div>
                    </div>`;
        });

        if (!members.length) {
            memberRows = `<div style="opacity:0.6;font-style:italic;margin-top:24px;font-family:'Lora',serif;">${T('MainMenu.dynamics.noMembers')}</div>`;
        }

        const footNote = canRetire
            ? T('MainMenu.dynamics.inactiveHint')
            : T('MainMenu.dynamics.lastMember');

        return `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="SceneManager._scene?.setDynamicsView?.('hub')">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.dynamics.rosterTitle')}</h2>
                    </div>
                    ${memberRows}
                    <div style="font-size:0.78em;color:#7a5c3a;font-style:italic;margin-top:4px;">${footNote}</div>
                    ${this.generateUIDynamicsBenchHTML()}
                </div>`;
    };

    // The bench: every member any savegame of this world has set inactive, and
    // the way back into a free party slot. Three travellers is the ceiling
    // character creation builds to, so it is the ceiling here as well.
    Scene_Menu.prototype.generateUIDynamicsBenchHTML = function () {
        const MAX_ACTIVE_PARTY = 3;
        const bench = window.CharacterPresets?.getAvailableRetiredPresets?.() ?? [];
        const hasRoom = $gameParty.members().length < MAX_ACTIVE_PARTY;

        let rows = '';
        bench.forEach(preset => {
            const className = preset.retiredClassName
                || ($dataClasses[preset.classId] ? $dataClasses[preset.classId].name : '');
            const since = preset.retiredDate
                ? T('MainMenu.dynamics.inactiveSince', { date: escapeHtml(preset.retiredDate) })
                : '';
            const recallBtn = hasRoom
                ? `<div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.reactivateUIMember?.(${preset.id})">${T('MainMenu.roster.setActive')}</div>`
                : `<div class="command-item" style="flex:1;opacity:0.45;pointer-events:none;">${T('MainMenu.roster.setActive')}</div>`;

            rows += `
                    <div class="npc-dynamics-member" style="margin-bottom:16px;border-bottom:1px dashed rgba(74,39,17,0.25);padding-bottom:12px;display:flex;gap:12px;align-items:center;">
                        <div class="portrait-frame" style="flex-shrink:0;">
                            <canvas id="bench-canvas-${preset.id}" width="48" height="48"></canvas>
                        </div>
                        <div style="flex:1;">
                            <div style="font-family:'Lora',serif;font-size:1.05em;color:#58180D;font-weight:bold;margin-bottom:6px;">
                                ${escapeHtml(preset.name)}
                                <span style="font-size:0.78em;font-weight:normal;color:#7a5c3a;margin-left:6px;">${escapeHtml(className)} ${T('MainMenu.roster.levelAbbr')}${preset.level || 1}</span>
                            </div>
                            <div style="font-size:0.78em;color:#7a5c3a;font-style:italic;margin-bottom:6px;">${since}</div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                ${recallBtn}
                            </div>
                        </div>
                    </div>`;
        });

        if (!rows) {
            rows = `<div style="opacity:0.6;font-style:italic;font-family:'Lora',serif;">${T('MainMenu.dynamics.inactiveEmpty')}</div>`;
        }

        const benchNote = !bench.length
            ? ''
            : (hasRoom ? T('MainMenu.dynamics.inactiveWorldHint') : T('MainMenu.dynamics.inactiveFull'));

        return `
                    <h2 class="tools-title" style="margin-top:18px;">${T('MainMenu.dynamics.inactiveTitle')}</h2>
                    ${rows}
                    ${benchNote ? `<div style="font-size:0.78em;color:#7a5c3a;font-style:italic;margin-top:4px;">${benchNote}</div>` : ''}`;
    };

    Scene_Menu.prototype.generateUIDynamicsHistoryHTML = function () {
        const STATUS_LABELS = {
            active:  { label: T('MainMenu.roster.travelling'), color: '#3c6b2f' },
            retired: { label: T('MainMenu.roster.inactive'),   color: '#7a5c3a' },
            left:    { label: T('MainMenu.roster.departed'),   color: '#7a5c3a' },
            died:    { label: T('MainMenu.roster.dead'),       color: '#8b1010' },
        };
        const entries = window.PartyRoster?.history?.() ?? [];
        let rows = '';

        entries.forEach(entry => {
            const status = STATUS_LABELS[entry.status] || STATUS_LABELS.left;
            const dates = [];
            if (entry.joinedDate) dates.push(T('MainMenu.roster.joined', { date: escapeHtml(entry.joinedDate) }));
            if (entry.status === 'died' && entry.deathDate) dates.push(T('MainMenu.roster.died', { date: escapeHtml(entry.deathDate) }));
            else if (entry.status === 'retired' && entry.leftDate) dates.push(T('MainMenu.roster.retired', { date: escapeHtml(entry.leftDate) }));
            else if (entry.status === 'left' && entry.leftDate) dates.push(T('MainMenu.roster.left', { date: escapeHtml(entry.leftDate) }));
            const dateLine = dates.length
                ? dates.join(' · ')
                : (entry.status === 'active' ? T('MainMenu.roster.travellingWithYou') : T('MainMenu.roster.dateUnrecorded'));

            rows += `
                    <div class="npc-dynamics-member" style="margin-bottom:12px;border-bottom:1px dashed rgba(74,39,17,0.25);padding-bottom:10px;">
                        <div style="font-family:'Lora',serif;font-size:1.02em;color:#58180D;font-weight:bold;">
                            ${escapeHtml(entry.name)}${entry.status === 'died' ? ' <span style="color:#8b1010;">✝</span>' : ''}
                            <span style="font-size:0.78em;font-weight:normal;color:${status.color};margin-left:6px;">${status.label}</span>
                        </div>
                        <div style="font-size:0.8em;color:#7a5c3a;">
                            ${escapeHtml(entry.className || '')}${entry.className ? ' · ' : ''}${T('MainMenu.roster.levelAbbr')}${entry.level}${entry.isLeader ? T('MainMenu.roster.partyLeader') : ''}
                        </div>
                        <div style="font-size:0.78em;color:#7a5c3a;font-style:italic;">${dateLine}</div>
                    </div>`;
        });

        if (!rows) {
            rows = `<div style="opacity:0.6;font-style:italic;margin-top:24px;font-family:'Lora',serif;">${T('MainMenu.roster.noRecords')}</div>`;
        }

        return `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="SceneManager._scene?.setDynamicsView?.('hub')">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.dynamics.historyTitle')}</h2>
                    </div>
                    ${rows}
                </div>`;
    };

    Scene_Menu.prototype.showWorldMapPage = function () {
        SoundManager.playOk();
        this._isWorldMapPage = true;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.hideWorldMapPage = function () {
        SoundManager.playCancel();
        this._isWorldMapPage = false;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.triggerUITravel = function (action) {
        SoundManager.playOk();
        if (action === "return") {
            if (typeof this.commandWorldMap === "function") {
                this.commandWorldMap();
            } else {
                console.warn("commandWorldMap is not defined on Scene_Menu!");
            }
        } else if (action === "goUp") {
            if (typeof this.commandGoUp === "function") {
                this.commandGoUp();
            } else {
                console.warn("commandGoUp is not defined on Scene_Menu!");
            }
        } else if (action === "goDown") {
            if (typeof this.commandGoDown === "function") {
                this.commandGoDown();
            } else {
                console.warn("commandGoDown is not defined on Scene_Menu!");
            }
        } else if (action === "toggleMinimap") {
            if (typeof this.commandToggleMinimap === "function") {
                this.commandToggleMinimap();
            } else {
                console.warn("commandToggleMinimap is not defined on Scene_Menu!");
            }
        } else if (action === "open") {
            if (typeof this.commandOpenWorldMap === "function") {
                this.commandOpenWorldMap();
            } else {
                console.warn("commandOpenWorldMap is not defined on Scene_Menu!");
            }
        }
    };

    // "Return to Ship" (alien planet surface only): board the Starship interior
    // via VehicleSystem, then close the menu so the reserved transfer runs.
    Scene_Menu.prototype.commandReturnToShip = function () {
        if (window.MergedVehicleSystem &&
            typeof window.MergedVehicleSystem.enterAirshipInterior === "function") {
            AudioManager.playSe({ name: "Teleport", pan: 0, pitch: 100, volume: 90 });
            // Skip the interior command's own SE so the teleport isn't doubled.
            window.MergedVehicleSystem.enterAirshipInterior({ silent: true });
            SceneManager.pop();
        } else {
            SoundManager.playBuzzer();
            console.warn("commandReturnToShip: MergedVehicleSystem unavailable.");
        }
    };

    // Vehicles page: "Teleport to Ship" on the Starship row boards its interior.
    Scene_Menu.prototype.teleportToShipUI = function () {
        if (window.MergedVehicleSystem &&
            typeof window.MergedVehicleSystem.enterAirshipInterior === "function") {
            AudioManager.playSe({ name: "Teleport", pan: 0, pitch: 100, volume: 90 });
            window.MergedVehicleSystem.enterAirshipInterior({ silent: true });
            SceneManager.pop();
        } else {
            SoundManager.playBuzzer();
        }
    };

    Scene_Menu.prototype.refreshUIMenuDOM = function (useTransitions = false) {
        if (!this._dndContainer) return;

        const actor = this.selectedActor();
        if (!actor) return;

        // Parse survival parameters safely
        const weatherName = (window.WeatherNames && window.weatherName)
            ? window.WeatherNames.label(window.weatherName)
            : T('MainMenu.weather.clear');
        const temperature = $gameVariables.value(61) || 20;

        // Money formatting
        const goldValue = $gameParty ? $gameParty._gold : 0;
        const formattedGold = this.formatUIMoneyValue(goldValue);
        const currencyUnit = $dataSystem ? $dataSystem.currencyUnit : "€";

        // Army upkeep row (only rendered while the player fields troops)
        let armyUpkeepHTML = "";
        if (typeof $gameArmy !== "undefined" && $gameArmy && $gameArmy.getTroopCount() > 0) {
            const formattedUpkeep = this.formatUIMoneyValue($gameArmy.getTotalWeeklyCost());
            armyUpkeepHTML = `
                    <div class="clock-row">
                        <span class="clock-label">${T('MainMenu.label.armyUpkeep')}</span>
                        <span class="clock-value bounty-highlight">${formattedUpkeep} ${currencyUnit}/week</span>
                    </div>`;
        }

        // Bounty
        const bountyValue = $gameVariables.value(66) || 0;
        let formattedBounty = T('MainMenu.roster.none');
        if (bountyValue > 0) {
            formattedBounty = (bountyValue / 100).toFixed(2) + " " + currencyUnit;
        }

        // Date/Time
        const gameMinutes = $gameVariables.value(114) || 0;
        const dateTime = this.getUIDateTime(gameMinutes);

        const members = $gameParty.members();

        // Clamp selected actor index in case the party shrank since last render.
        if (this._selectedActorIndex >= members.length) {
            this._selectedActorIndex = 0;
        }

        // Party bio cards: every member is rendered as a full portrait + name/class
        // + HP/MP/AP block (same template as the old single header). The active
        // member is highlighted; clicking a card makes that member active so the
        // needs panel and Skills/Equip/Status commands target them.
        let partyBioHTML = '';
        members.forEach((mem, idx) => {
            const memHpPct = Math.floor(mem.hpRate() * 100);
            const memHpColor = memHpPct <= 25 ? '#d9433a' : (memHpPct <= 50 ? '#e2933a' : 'var(--text-text-alt-7)');
            const isSelected = (idx === this._selectedActorIndex);
            partyBioHTML += `
                <div class="bio-row party-bio-card${isSelected ? ' selected' : ''}"${''/* i18n-ignore: css classes */}
                     onclick="SceneManager._scene.switchSelectedActor(${idx})">
                    <div class="portrait-frame">
                        <canvas id="actor-canvas-${idx}" width="48" height="48"></canvas>
                    </div>
                    <div class="bio-text">
                        <h3 class="char-name">${escapeHtml(mem.name())}</h3>
                        <p class="char-class">${mem.currentClass() ? mem.currentClass().name : T('MainMenu.roster.classless')} (${T('MainMenu.roster.levelAbbr')} ${mem.level})</p>
                    </div>
                    <div class="bio-vitals">
                        <div class="bio-vital"><span class="bio-vital-lbl">${T('MainMenu.vital.hp')}</span><span class="bio-vital-val" style="color:${memHpColor};">${mem.hp}/${mem.mhp}</span></div>
                        <div class="bio-vital"><span class="bio-vital-lbl">${T('MainMenu.vital.mp')}</span><span class="bio-vital-val">${mem.mp}/${mem.mmp}</span></div>
                        <div class="bio-vital"><span class="bio-vital-lbl">${T('MainMenu.vital.ap')}</span><span class="bio-vital-val">${Math.floor(mem.tp)}</span></div>
                    </div>
                </div>
            `;
        });

        // Needs computation: the needs panel reflects the active (selected) member.
        const allMemberNeeds = members.map(m => this.getMemberNeeds(m));
        const displayNeeds = allMemberNeeds[this._selectedActorIndex] || allMemberNeeds[0] || {};
        const medHunger  = displayNeeds.hunger  ?? 100;
        const medSleep   = displayNeeds.sleep   ?? 100;
        const medHygiene = displayNeeds.hygiene;
        const medSocial  = displayNeeds.social;
        const medLeisure = displayNeeds.leisure;

        // Uniform needs palette: gold when healthy, orange when low, red when
        // critical. Every needs bar shares this so the page reads as one scale
        // instead of one arbitrary hue per need.
        const needColor = (p) => p <= 20 ? '#d9433a' : (p <= 50 ? '#e2933a' : '#d4a64e');

        const needDefs = [
            { label: emLabel("needHunger",  T('MainMenu.need.hunger')),  val: medHunger },
            { label: emLabel("needSleep",   T('MainMenu.need.sleep')),   val: medSleep },
            { label: emLabel("needHygiene", T('MainMenu.need.hygiene')), val: medHygiene },
            { label: emLabel("needSocial",  T('MainMenu.need.social')),  val: medSocial },
            { label: emLabel("needLeisure", T('MainMenu.need.fun')),     val: medLeisure }
        ];
        let needsCardsHTML = "";
        needDefs.forEach(n => {
            if (n.val === null || n.val === undefined) return;
            const c = needColor(n.val);
            needsCardsHTML += `
                    <div class="survival-card">
                        <span class="survival-lbl">${n.label}</span>
                        <span class="survival-val" style="color:${c};">${n.val}%</span>
                        <div class="survival-bar">
                            <div class="survival-bar-fill" style="width:${n.val}%; background:${c};"></div>
                        </div>
                    </div>`;
        });

        // Left Page: Commands Pockets, Tools Pockets, or Travel Pockets
        let leftPageHTML = "";
        if (this._isWorldMapPage) {
            // Render Travel choices
            leftPageHTML = `
                <div class="travel-pockets" style="display: flex; flex-direction: column; height: 100%; justify-content: space-between;">
                    <div class="tools-header" style="margin-bottom: 20px;">
                        <h2 class="title" style="font-family: 'Lora', serif; font-size: 2.2em; color: #58180D; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin: 0;">${T('MainMenu.travel.worldMapTitle')}</h2>
                    </div>
                    <div class="commands-grid" style="display: flex; flex-direction: column; gap: 15px; flex-grow: 1;">
            `;

            // 1. Return to World Map
            const canReturn = $gameMap.mapId() !== 315; // only if not already on world map
            if (canReturn) {
                leftPageHTML += `
                    <div class="command-item focusable" data-symbol="travel_return" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('return')">
                        <span class="icon" style="background: url('img/system/IconSet.png') -${(310 % 16) * 32}px -${Math.floor(310 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                        <span>${T('MainMenu.cmd.returnToWorldMap')}</span>
                    </div>
                `;
            }

            // 2. Underground layer shifts
            if ($gameMap.mapId() === 636) { // procedural map
                const procGenData = $gameSystem._procGenData;
                const isUnderground = procGenData && procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0;
                const currentBiome = procGenData && procGenData.currentBiome && window.ProcGenUtils ? window.ProcGenUtils.getBiomeByName(procGenData.currentBiome) : null;
                const hasUnderground = currentBiome && currentBiome.lowerLayer;

                if (isUnderground) {
                    leftPageHTML += `
                        <div class="command-item focusable" data-symbol="travel_goUp" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('goUp')">
                            <span class="icon" style="background: url('img/system/IconSet.png') -${(311 % 16) * 32}px -${Math.floor(311 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                            <span>${T('MainMenu.travel.goUp')}</span>
                        </div>
                    `;
                } else if (hasUnderground) {
                    leftPageHTML += `
                        <div class="command-item focusable" data-symbol="travel_goDown" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('goDown')">
                            <span class="icon" style="background: url('img/system/IconSet.png') -${(311 % 16) * 32}px -${Math.floor(311 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                            <span>${T('MainMenu.travel.goDown')}</span>
                        </div>
                    `;
                }
            }

            // 3. Toggle World Map (Minimap)
            leftPageHTML += `
                <div class="command-item focusable" data-symbol="travel_toggleMinimap" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('toggleMinimap')">
                    <span class="icon" style="background: url('img/system/IconSet.png') -${(186 % 16) * 32}px -${Math.floor(186 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                    <span>${T('MainMenu.travel.toggleMinimap')}</span>
                </div>
            `;

            // 3b. Open World Map (Actual Zoomable Map)
            leftPageHTML += `
                <div class="command-item focusable" data-symbol="travel_open" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('open')">
                    <span class="icon" style="background: url('img/system/IconSet.png') -${(310 % 16) * 32}px -${Math.floor(310 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                    <span>${T('MainMenu.travel.openMap')}</span>
                </div>
            `;

            // 4. Cancel / Back
            leftPageHTML += `
                        <div class="command-item focusable" data-symbol="travel_cancel" onclick="if(SceneManager._scene && typeof SceneManager._scene.hideWorldMapPage === 'function') SceneManager._scene.hideWorldMapPage()">
                            <span class="icon" style="background: url('img/system/IconSet.png') -${(16 % 16) * 32}px -${Math.floor(16 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                            <span>${T('MainMenu.travel.resume')}</span>
                        </div>
                    </div>
                </div>
            `;
        } else if (this._isToolsPage) {
            // Render Tools List
            leftPageHTML = `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="if(SceneManager._scene && typeof SceneManager._scene.hideToolsPage === 'function') SceneManager._scene.hideToolsPage()">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.page.tools')}</h2>
                    </div>
                    <div class="commands-grid">
                        <div class="command-item focusable" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUICommand === 'function') SceneManager._scene.triggerUICommand('hexphone')">
                            <span class="icon" style="background: url('img/system/IconSet.png') -${(187 % 16) * 32}px -${Math.floor(187 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                            <span>${T('MainMenu.tools.hexphone')}</span>
                        </div>
                        <div class="command-item focusable" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUICommand === 'function') SceneManager._scene.triggerUICommand('alchemistry')">
                            <span class="icon" style="background: url('img/system/IconSet.png') -${(180 % 16) * 32}px -${Math.floor(180 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                            <span>${T('MainMenu.tools.alchemistryKit')}</span>
                        </div>
                        ${this.generateUIToolItemsListHTML()}
                    </div>
                </div>
            `;
        } else if (this._isDynamicsPage) {
            leftPageHTML = this.generateUIDynamicsPageHTML();
        } else if (this._isPetsPage) {
            const pets = window.PetSystem ? window.PetSystem.getPets() : [];
            const activePet = window.PetSystem ? window.PetSystem.getActivePet() : null;
            const activeId = activePet ? activePet.id : null;
            let petRows = '';
            pets.forEach(pet => {
                const isActive = (pet.id === activeId);
                const isRenaming = (this._petRenameId === pet.id);
                const typeLabel = pet.isFollower ? T('MainMenu.roster.follower') : T('MainMenu.roster.pet');
                const activeBtn = isActive
                    ? `<div class="command-item" style="flex:1;opacity:0.6;pointer-events:none;">${T('MainMenu.roster.following')}</div>`
                    : `<div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.setActivePet?.(${pet.id})">${T('MainMenu.roster.setActive')}</div>`;
                const activeTag = isActive ? ` · ${T('MainMenu.pets.active')}` : '';
                // While a pet is being renamed its row hands the whole button
                // strip over to the name field, so there is no way to release or
                // re-leash it by mistake with the keyboard captured by typing.
                const maxLen = window.PetSystem?.NAME_MAX_LENGTH ?? 16;
                const buttons = isRenaming
                    ? `<input type="text" id="pet-rename-input" class="pet-rename-input" style="flex:2;min-width:0;"
                            maxlength="${maxLen}" autocomplete="off" spellcheck="false"
                            value="${escapeHtml(pet.name)}"
                            onkeydown="SceneManager._scene?.onPetRenameKey?.(event)"
                            onkeyup="event.stopPropagation()"
                            onkeypress="event.stopPropagation()">
                        <div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.confirmPetRename?.()">${T('MainMenu.roster.confirm')}</div>
                        <div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.cancelPetRename?.()">${T('MainMenu.roster.cancel')}</div>`
                    : `${activeBtn}
                        <div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.startPetRename?.(${pet.id})">${T('MainMenu.pets.rename')}</div>
                        <div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.releasePet?.(${pet.id})">${T('MainMenu.pets.release')}</div>`;
                petRows += `
                    <div class="npc-dynamics-member" style="margin-bottom:16px;border-bottom:1px dashed rgba(74,39,17,0.25);padding-bottom:12px;display:flex;gap:12px;align-items:center;">
                        <div class="portrait-frame" style="flex-shrink:0;">
                            <canvas id="pet-canvas-${pet.id}" width="48" height="48"></canvas>
                        </div>
                        <div style="flex:1;">
                            <div style="font-family:'Lora',serif;font-size:1.05em;color:#58180D;font-weight:bold;margin-bottom:4px;">
                                ${escapeHtml(pet.name)}
                                <span style="font-size:0.78em;font-weight:normal;color:#7a5c3a;margin-left:6px;">${typeLabel}${activeTag} · ${T('MainMenu.roster.levelAbbr')}${pet.level}</span>
                            </div>
                            <div style="display:flex;gap:10px;align-items:center;">
                                ${buttons}
                            </div>
                        </div>
                    </div>`;
            });
            if (!pets.length) {
                petRows = `<div style="opacity:0.6;font-style:italic;margin-top:24px;font-family:'Lora',serif;">${T('MainMenu.pets.none')}</div>`;
            }
            leftPageHTML = `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="SceneManager._scene?.hidePetsPage?.()">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.page.pets')}</h2>
                    </div>
                    ${petRows}
                </div>`;
        } else if (this._isVehiclesPage) {
            const vehicles = window.MergedVehicleSystem && window.MergedVehicleSystem.getOwnedVehicles
                ? window.MergedVehicleSystem.getOwnedVehicles() : [];
            // Indoors (a house, a vehicle's own cabin, a procedural interior
            // such as a dungeon, crypt, sewer, loot cellar or cave) only the
            // bike can be summoned. The others are drawn inert there rather
            // than left to fail once the menu has already closed.
            const canSpawnKey = (key) => !window.MergedVehicleSystem?.canSpawnHere ||
                window.MergedVehicleSystem.canSpawnHere(key);
            let anyBlocked = false;
            let vehicleRows = '';
            vehicles.forEach(v => {
                const fuelLine = v.usesFuel
                    ? `<span style="font-size:0.78em;font-weight:normal;color:#7a5c3a;margin-left:6px;">Fuel ${Math.floor(v.fuel)}L / ${v.max}L</span>`
                    : `<span style="font-size:0.78em;font-weight:normal;color:#7a5c3a;margin-left:6px;">${T('MainMenu.vehicles.noFuelNeeded')}</span>`;
                const repairBtn = v.hasRepair
                    ? `<div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.repairUIVehicle?.('${v.key}')">${T('MainMenu.roster.repair')}</div>`
                    : '';
                // The Starship also offers a direct "Teleport to Ship" into its interior.
                const boardBtn = v.type === 'airship'
                    ? `<div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.teleportToShipUI?.()">${T('MainMenu.cmd.teleportToShip')}</div>`
                    : '';
                // Disabled tiles drop `focusable` as well as the handler, so the
                // menu's focus ring walks straight past them.
                const canSpawn = canSpawnKey(v.key);
                if (!canSpawn) anyBlocked = true;
                const spawnBtn = canSpawn
                    ? `<div class="command-item focusable" style="flex:1;" onclick="SceneManager._scene?.spawnUIVehicle?.('${v.key}')">${T('MainMenu.vehicles.spawn')}</div>`
                    : `<div class="command-item is-disabled" style="flex:1;" title="${escapeHtml(T('MainMenu.vehicles.spawnIndoors'))}">${T('MainMenu.vehicles.spawn')}</div>`;
                vehicleRows += `
                    <div class="npc-dynamics-member" style="margin-bottom:16px;border-bottom:1px dashed rgba(74,39,17,0.25);padding-bottom:12px;display:flex;gap:12px;align-items:center;">
                        <div class="portrait-frame" style="flex-shrink:0;">
                            <canvas id="vehicle-canvas-${v.key}" width="48" height="48"></canvas>
                        </div>
                        <div style="flex:1;">
                            <div style="font-family:'Lora',serif;font-size:1.05em;color:#58180D;font-weight:bold;margin-bottom:4px;">
                                ${escapeHtml(v.name)}${fuelLine}
                            </div>
                            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                                ${spawnBtn}
                                ${repairBtn}
                                ${boardBtn}
                            </div>
                        </div>
                    </div>`;
            });
            if (!vehicles.length) {
                vehicleRows = `<div style="opacity:0.6;font-style:italic;margin-top:24px;font-family:'Lora',serif;">${T('MainMenu.vehicles.none')}</div>`;
            }
            const indoorsNote = anyBlocked
                ? `<div class="pockets-hint" style="font-style:italic;margin-bottom:12px;font-family:'Lora',serif;">${T('MainMenu.vehicles.spawnIndoors')}</div>`
                : '';
            leftPageHTML = `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="SceneManager._scene?.hideVehiclesPage?.()">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.page.vehicles')}</h2>
                    </div>
                    ${indoorsNote}
                    ${vehicleRows}
                </div>`;
        } else {
            // On the procedural map (636) surface the "Return to world map" travel
            // command as the very first pockets entry, copied from the World Map
            // submenu, so the player can bail out to map 315 without drilling in.
            const procReturnHTML = ($gameMap.mapId() === 636) ? `
                    <div class="command-item focusable" data-symbol="travel_return" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('return')">
                        <span class="icon" style="background: url('img/system/IconSet.png') -${(310 % 16) * 32}px -${Math.floor(310 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                        <span>${T('MainMenu.cmd.returnToWorldMap')}</span>
                    </div>
            ` : "";

            // "Return to Ship" teleports into the Starship interior via
            // VehicleSystem. It is offered whenever the party is planetside and
            // hasn't reboarded: on an alien planet surface, at any hand-authored
            // landing location (tracked by _awayFromShip until they return), and
            // always on the world map (map 315).
            const onAlienSurface = $gameMap.mapId() === 636 &&
                !!(window.GalaxySim && window.GalaxySim.isAlienSurface && window.GalaxySim.isAlienSurface());
            const awayFromShip = !!($gameSystem && $gameSystem._awayFromShip);
            const showReturnToShip = onAlienSurface || awayFromShip || $gameMap.mapId() === 315;
            const returnToShipHTML = showReturnToShip ? `
                    <div class="command-item focusable" data-symbol="return_to_ship" onclick="if(SceneManager._scene && typeof SceneManager._scene.commandReturnToShip === 'function') SceneManager._scene.commandReturnToShip()">
                        <span class="icon" style="background: url('img/system/IconSet.png') -${(313 % 16) * 32}px -${Math.floor(313 / 16) * 32}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                        <span>${T('MainMenu.cmd.returnToShip')}</span>
                    </div>
            ` : "";

            // Render Commands Pockets. The tiles are bundled into unlabelled
            // logical groups separated by a full-width rule, so the 3-column
            // pockets reads as coherent blocks instead of one long alphabet soup:
            //   character (self)  ·  party (companions)  ·  travel & rest  ·
            //   activities  ·  records & standing  ·  network  ·  system.
            // The character block is always first; on the procedural map the
            // travel block leads with the "Return to world map" escape hatch.
            const commandGroups = [
                // Sandbox: tester/sandbox-only tools, surfaced as the very first
                // pockets entry when the player is named "test" or sandbox mode is
                // active. Collapses away entirely otherwise (the tile returns "").
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.sandbox'), "sandbox"),
                ],
                // Character: your active member's sheet, gear and body
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.backpack'), "item"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.equip'), "equip"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.skills'), "skill"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.status'), "status1"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.specializations'), "specializations"),
                    this.generateUICommandItemHTML(emLabel("menuBiologics", T('MainMenu.cmd.biologics')), "biologics"),
                ],
                // Party: the people and creatures travelling with you
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.dynamics'), "dynamics"),
                    this.generateUICommandItemHTML(emLabel("menuThinker", T('MainMenu.cmd.thinker')), "thinker"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.pets'), "pets"),
                    this.generateUICommandItemHTML(emLabel("menuWorkforce", T('MainMenu.cmd.workforce')), "army"),
                ],
                // Travel & rest
                [
                    procReturnHTML,
                    returnToShipHTML,
                    this.generateUICommandItemHTML(T('MainMenu.cmd.worldMap'), "world_map"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.vehicles'), "vehicles"),
                    this.generateUICommandItemHTML(emLabel("menuWait", T('MainMenu.cmd.wait')), "sleep_menu"),
                ],
                // Activities: things you do in the world
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.cooking'), "cooking"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.build'), "build"),
                    this.generateUICommandItemHTML(emLabel("menuTraining", T('MainMenu.cmd.training')), "training"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.research'), "research"),
                ],
                // Records & standing: the pockets you consult
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.questLog'), "quest_log"),
                    this.generateUICommandItemHTML(emLabel("menuBestiary", T('MainMenu.cmd.bestiary')), "bestiary"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.archive'), "help"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.factions'), "factions"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.assets'), "assets"),
                ],
                // Network: online features
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.hypernet'), "hypernet"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.multiplayer'), "multiplayer"),
                ],
                // System: meta / out-of-world
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.save'), "save"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.preferences'), "options"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.tools'), "tools"),
                    this.generateUICommandItemHTML(emLabel("menuResign", T('MainMenu.cmd.resign')), "gameEnd"),
                ],
            ];
            // Hidden tiles (e.g. Sandbox off the tester save) collapse away, so a
            // group that ends up empty must not leave a dangling separator.
            const groupSeparatorHTML = `<div class="command-group-separator"></div>`;
            const commandsHTML = commandGroups
                .map((group) => group.filter((html) => html && html.trim()).join("\n"))
                .filter((html) => html)
                .join(`\n${groupSeparatorHTML}\n`);

            leftPageHTML = `
                <div class="commands-grid">
                    ${commandsHTML}
                </div>
            `;
        }

        // Right Page: Character Sheet or World Map Details
        let rightPageHTML = "";
        if (this._isWorldMapPage) {
            // Get current coordinate and biome details
            const worldX = ($gameMap.mapId() === 315) ? ($gamePlayer.x || 0) : ($gameVariables.value(43) || 0);
            const worldY = ($gameMap.mapId() === 315) ? ($gamePlayer.y || 0) : ($gameVariables.value(44) || 0);

            // Calculate which 8x8 block we are in (each block is 32x32 units)
            const col = Math.max(1, Math.min(8, Math.floor(worldX / 32) + 1));
            const row = Math.max(1, Math.min(8, Math.floor(worldY / 32) + 1));

            let currentRegionName = T('MainMenu.place.unknownLand');

            if ($gameMap.mapId() === 315) {
                currentRegionName = T('MainMenu.place.worldWilderness');
            } else if ($gameMap.mapId() === 636) {
                // The procedural map tracks the square's biome as `currentBiome`;
                // the codex shows the name that biome declares for itself.
                const procGenData = $gameSystem._procGenData;
                const biome = procGenData && procGenData.currentBiome;
                currentRegionName = biome ? window.BiomeNames.display(biome) : T('MainMenu.place.proceduralSector');
            } else {
                currentRegionName = ($dataMap && $dataMap.displayName) || T('MainMenu.place.localSector');
            }

            rightPageHTML = `
                <div class="travel-codex" style="font-family: 'Lora', serif; color: #1a1a1a; display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
                    
                    <div style="background: rgba(88, 24, 13, 0.04); border: 1px solid rgba(88, 24, 13, 0.15); border-radius: 6px; padding: 12px; margin-bottom: 12px; box-shadow: inset 0 0 10px rgba(0,0,0,0.05);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px dashed rgba(88, 24, 13, 0.15); padding-bottom: 4px; font-size: 0.9em;">
                            <span style="font-weight: bold; color: #58180D;">${T('MainMenu.label.location')}</span>
                            <span>${currentRegionName}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px dashed rgba(88, 24, 13, 0.15); padding-bottom: 4px; font-size: 0.9em;">
                            <span style="font-weight: bold; color: #58180D;">${T('MainMenu.label.worldCoordinates')}</span>
                            <span>X: ${worldX} | Y: ${worldY}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px dashed rgba(88, 24, 13, 0.15); padding-bottom: 4px; font-size: 0.9em;">
                            <span style="font-weight: bold; color: #58180D;">${T('MainMenu.label.sector')}</span>
                            <span>${T('MainMenu.label.rowColumn', { row: row, col: col })}</span>
                        </div>
                    </div>

                    <!-- Map Segment Image Container -->
                    <div style="position: relative; width: 100%; border: 3px double #58180D; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); overflow: hidden; background: #ecdcb9; display: flex; justify-content: center; align-items: center; aspect-ratio: 4 / 3; margin-top: auto; margin-bottom: auto;">
                        <img src="img/worldmap/row-${row}-column-${col}.jpg" style="width: 100%; height: 100%; object-fit: cover; display: block; filter: sepia(0.12) contrast(1.02);" />
                        
                        <!-- Player Indicator Pin Overlay on the local segment map (0-31 range mapped to 0-100%) -->
                        <div style="position: absolute; left: ${((worldX % 32) / 32) * 100}%; top: ${((worldY % 32) / 32) * 100}%; width: 12px; height: 12px; background: #c62828; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 8px rgba(0,0,0,0.6); transform: translate(-50%, -50%); animation: dndPulse 1.8s infinite ease-in-out;"></div>
                    </div>

                
                    <style>
                    @keyframes dndPulse {
                        0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(198, 40, 40, 0.7); }
                        70% { transform: translate(-50%, -50%) scale(1.2); box-shadow: 0 0 0 6px rgba(198, 40, 40, 0); }
                        100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(198, 40, 40, 0); }
                    }
                    </style>
                </div>
            `;
        } else {
            rightPageHTML = `
                <div class="party-bio-list">
                    ${partyBioHTML}
                </div>

                <div class="survival-box">
                    ${needsCardsHTML}
                </div>

                <div class="pockets-clock">
                    <div class="clock-row">
                        <span class="clock-label">${T('MainMenu.label.timeDate')}</span>
                        <span class="clock-value">${dateTime.dateShort} | ${dateTime.time24}</span>
                    </div>
                    <div class="clock-row">
                        <span class="clock-label">${T('MainMenu.label.weather')}</span>
                        <span class="clock-value">${weatherName} (${temperature}°C)</span>
                    </div>
                    <div class="clock-row">
                        <span class="clock-label">${T('MainMenu.label.currentCash')}</span>
                        <span class="clock-value cash-highlight">${formattedGold} ${currencyUnit}</span>
                    </div>${armyUpkeepHTML}
                    <div class="clock-row">
                        <span class="clock-label">${T('MainMenu.label.currentBounty')}</span>
                        <span class="clock-value bounty-highlight">${formattedBounty}</span>
                    </div>
                </div>
            `;
        }

        // Determine left page key to see if left page needs full render. The
        // Dynamics sub-view is part of the key so hub/roster/history swaps
        // actually redraw the page.
        // Roster edits (a promotion, an armed or completed retirement, someone
        // called back off the bench) change the page without changing the view,
        // so they are folded into the key too.
        const dynamicsKey = this._isDynamicsPage
            ? [
                this._dynamicsView || 'hub',
                this._dynamicsPendingRetireId || 0,
                $gameParty.members().map(mem => mem.actorId()).join('-'),
                (window.CharacterPresets?.getAvailableRetiredPresets?.() ?? []).map(p => p.id).join('-')
            ].join(':')
            : '';
        // Releasing a pet, handing the leash to another one, renaming one or
        // opening the name field changes the page without changing which page it
        // is, so all of it is part of the key.
        const petsKey = this._isPetsPage
            ? [
                (window.PetSystem?.getPets?.() ?? []).map(p => `${p.id}.${p.name}`).join('-'),
                window.PetSystem?.getActivePet?.()?.id ?? 0,
                this._petRenameId || 0
            ].join(':')
            : '';
        const leftPageKey = `${this._isToolsPage}_${this._isWorldMapPage}_${this._isDynamicsPage}${dynamicsKey}_${this._isPetsPage}${petsKey}_${this._isVehiclesPage}`;
        let spread = this._dndContainer.querySelector(".book-spread");

        if (!spread) {
            // Initial load - Render instantly
            this._dndLastLeftPageKey = leftPageKey;
            this._dndContainer.innerHTML = `
                <div class="book-spread">
                    <div class="left-page">
                        ${leftPageHTML}
                    </div>
                    <div class="right-page">
                        ${rightPageHTML}
                    </div>
                </div>
            `;
            spread = this._dndContainer.querySelector(".book-spread");

            // Render Canvases for portraits immediately
            this.drawAllPartyPortraits();
            this.drawAllPetPortraits();
            this.drawAllRosterPortraits();
            this.drawAllVehicleSprites();

            // Re-bind input mappings
            UIMenuInputManager.activate(this._isWorldMapPage ? 1 : 3);
        } else {
            // Subsequent updates
            if (useTransitions) {
                // Smooth transition switching
                if (this._dndLastLeftPageKey !== leftPageKey) {
                    this.fadeTransitionLeftPage(leftPageHTML, leftPageKey);
                }
                this.fadeTransitionRightPage(rightPageHTML, actor);
            } else {
                // Direct updates (e.g. for simple state reflows if any)
                const leftPageContainer = spread.querySelector(".left-page");
                const rightPageContainer = spread.querySelector(".right-page");

                if (this._dndLastLeftPageKey !== leftPageKey || !leftPageContainer.innerHTML.trim()) {
                    this._dndLastLeftPageKey = leftPageKey;
                    leftPageContainer.innerHTML = leftPageHTML;
                }

                if (rightPageContainer) {
                    rightPageContainer.innerHTML = rightPageHTML;
                }

                // Render Canvases for portraits
                this.drawAllPartyPortraits();
                this.drawAllPetPortraits();
                this.drawAllRosterPortraits();
                this.drawAllVehicleSprites();

                // Re-bind input mappings
                UIMenuInputManager.activate(this._isWorldMapPage ? 1 : 3);
            }
        }
    };

    Scene_Menu.prototype.generateUICommandItemHTML = function (label, symbol) {
        // Sandbox is hidden entirely unless the player is named "test" (any
        // case) or sandbox mode is active.
        const sandboxTester = $gameActors && $gameActors.actor(1) && $gameActors.actor(1).name().toLowerCase() === "test";
        const sandboxActive = !!($gameSystem && $gameSystem._isSandboxMode);
        if (symbol === "sandbox") {
            if (!sandboxTester && !sandboxActive) return "";
        }

        const iconIndex = COMMAND_ICONS[symbol] || 0;
        const x = (iconIndex % 16) * 32;
        const y = Math.floor(iconIndex / 16) * 32;
        const hotkey = HOTKEY_LABELS[symbol] ? `<span class="hotkey-badge">${HOTKEY_LABELS[symbol]}</span>` : "";

        // Check if command is enabled in standard menu list
        // Waiting is always allowed: it only runs the clock forward and never
        // rests the party, so no bed or camp is needed for the tile.
        let enabled = true;
        if (symbol === "build") enabled = window.FurnitureSystem?.canBuildOnCurrentMap?.() ?? ($gameMap.mapId() !== 315);
        if (symbol === "sandbox") enabled = sandboxTester || sandboxActive;
        if (symbol === "hypernet") enabled = isHypernetAvailable();

        const opacity = enabled ? 1 : 0.45;
        const pointerEvents = enabled ? "auto" : "none";

        let clickAction = `if(SceneManager._scene && typeof SceneManager._scene.triggerUICommand === 'function') SceneManager._scene.triggerUICommand('${symbol}')`;
        if (symbol === "tools") {
            clickAction = `if(SceneManager._scene && typeof SceneManager._scene.showToolsPage === 'function') SceneManager._scene.showToolsPage()`;
        }
        if (symbol === "pets") {
            clickAction = `if(SceneManager._scene && typeof SceneManager._scene.showPetsPage === 'function') SceneManager._scene.showPetsPage()`;
        }
        if (symbol === "vehicles") {
            clickAction = `if(SceneManager._scene && typeof SceneManager._scene.showVehiclesPage === 'function') SceneManager._scene.showVehiclesPage()`;
        }
        if (symbol === "dynamics") {
            // Dynamics is a hub: roster management, the Empathize wiki's Party
            // section, and the roster history.
            clickAction = `if(SceneManager._scene && typeof SceneManager._scene.showDynamicsPage === 'function') SceneManager._scene.showDynamicsPage()`;
        }

        return `
            <div class="command-item focusable" data-symbol="${symbol}" style="opacity:${opacity}; pointer-events:${pointerEvents};" onclick="${clickAction}">
                <span class="icon" style="background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                <span>${label}</span>
                ${hotkey}
            </div>
        `;
    };

    Scene_Menu.prototype.generateUIToolItemsListHTML = function () {
        let html = "";
        const seen = new Set();
        for (let i = 1; i < $dataItems.length; i++) {
            const item = $dataItems[i];
            if (!item) continue;
            const category = item.meta ? (item.meta.category || item.meta.Category) : null;
            if (!category || String(category).trim().toLowerCase() !== "tools") continue;
            if (!$gameParty.hasItem(item)) continue;
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            const iconIndex = item.iconIndex || 0;
            const x = (iconIndex % 16) * 32;
            const y = Math.floor(iconIndex / 16) * 32;
            html += `
                <div class="command-item focusable" data-symbol="tool_${item.id}" onclick="if(SceneManager._scene && typeof SceneManager._scene.useUIToolItem === 'function') SceneManager._scene.useUIToolItem(${item.id})">
                    <span class="icon" style="background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85);"></span>
                    <span>${item.name}</span>
                </div>
            `;
        }
        return html;
    };

    // Draws every party member's portrait into its own bio-card canvas.
    Scene_Menu.prototype.drawAllPartyPortraits = function () {
        $gameParty.members().forEach((mem, idx) => {
            this.drawUIActorPortrait(mem, `actor-canvas-${idx}`);
        });
    };

    // Dynamics -> Roster renders its own portraits on the left page, keyed by
    // actor id so a leader swap doesn't shuffle the sprites.
    Scene_Menu.prototype.drawAllRosterPortraits = function () {
        if (!this._isDynamicsPage || this._dynamicsView !== 'roster') return;
        $gameParty.members().forEach(mem => {
            this.drawUIActorPortrait(mem, `roster-canvas-${mem.actorId()}`);
        });
        // The bench has dossiers, not actors: drawUIActorPortrait only ever asks
        // for the sprite sheet and the index, so hand it those two.
        const bench = window.CharacterPresets?.getAvailableRetiredPresets?.() ?? [];
        bench.forEach(preset => {
            if (!preset.sprite) return;
            this.drawUIActorPortrait({
                characterName: () => preset.sprite || '',
                characterIndex: () => preset.spriteIndex || 0
            }, `bench-canvas-${preset.id}`);
        });
    };

    // Renders actor graphic directly on canvas
    Scene_Menu.prototype.drawUIActorPortrait = function (actor, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const bitmap = ImageManager.loadCharacter(actor.characterName());
        const drawPortrait = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.imageSmoothingEnabled = false;

            const isBig = ImageManager.isBigCharacter(actor.characterName());
            const pw = bitmap.width / (isBig ? 3 : 12);
            const ph = bitmap.height / (isBig ? 4 : 8);

            const charIndex = actor.characterIndex();
            const sx = ((charIndex % 4) * 3 + 1) * pw; // Down center frame coordinate
            const sy = (Math.floor(charIndex / 4) * 4) * ph; // Down face line row

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Draw sprite preserving its aspect ratio, centered inside the canvas (#165)
            const fit = Math.min(canvas.width / pw, canvas.height / ph);
            const dw = pw * fit;
            const dh = ph * fit;
            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;
            ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, dx, dy, dw, dh);
        };

        if (bitmap.isReady()) {
            drawPortrait();
        } else {
            bitmap.addLoadListener(drawPortrait);
        }
    };

    Scene_Menu.prototype.triggerUICommand = function (symbol) {
        // Prepare active actor index for skills/equips/status page mapping
        const personalSymbols = ["skill", "equip", "status1", "thinker", "specializations"];
        if (personalSymbols.includes(symbol)) {
            $gameParty.setMenuActor(this.selectedActor());

            // Directly push personal scenes to bypass hidden status selector
            if (symbol === "skill") {
                SceneManager.push(Scene_Skill);
                return;
            } else if (symbol === "equip") {
                SceneManager.push(Scene_Equip);
                return;
            } else if (symbol === "status1") {
                SceneManager.push(Scene_Status);
                return;
            } else if (symbol === "specializations") {
                if (typeof Scene_Specializations !== "undefined") {
                    SceneManager.push(Scene_Specializations);
                } else if (typeof window.Scene_Specializations !== "undefined") {
                    SceneManager.push(window.Scene_Specializations);
                } else {
                    console.warn("Scene_Specializations is not defined!");
                }
                return;
            }
        }

        let commandSymbol = symbol;
        if (symbol === "world_map") {
            commandSymbol = "worldMapMenu";
        }

        if (this._commandWindow && this._commandWindow._handlers[commandSymbol]) {
            this._commandWindow.callHandler(commandSymbol);
        } else {
            // Scene navigation direct fallback just in case handlers mapping gets bypassed
            switch (symbol) {
                case "world_map":
                case "worldMapMenu":
                    if (typeof this.commandWorldMapMenu === 'function') {
                        this.commandWorldMapMenu();
                    } else {
                        console.warn("commandWorldMapMenu is not defined on Scene_Menu!");
                    }
                    break;
                case "item":
                    SceneManager.push(Scene_EnhancedItem);
                    break;
                case "skill":
                    SceneManager.push(Scene_Skill);
                    break;
                case "equip":
                    SceneManager.push(Scene_Equip);
                    break;
                case "status1":
                    SceneManager.push(Scene_Status);
                    break;
                case "save":
                    SceneManager.push(Scene_Save);
                    break;
                case "options":
                    SceneManager.push(Scene_Options);
                    break;
                case "gameEnd":
                    SceneManager.push(Scene_GameEnd);
                    break;
                case "quest_log":
                    SceneManager.push(Scene_KanbanQuest);
                    break;
                case "training":
                    SceneManager.push(Scene_SkillEncyclopedia);
                    break;
                case "research":
                    if (typeof Scene_TechTree !== "undefined") {
                        SceneManager.push(Scene_TechTree);
                    } else {
                        console.warn("Scene_TechTree is not defined!");
                    }
                    break;
                case "cooking":
                    SceneManager.push(Scene_Cooking);
                    break;
                case "help":
                    SceneManager.push(Scene_Help);
                    break;
                case "hypernet":
                    // Open Hypernet consistently with the ungated map W-key shortcut
                    // and the OpenHypernetOS plugin command, which do not require a
                    // device. Previously the menu tile alone buzzed when no
                    // internet-capable item was held, so it "did not work from the
                    // main menu" while working elsewhere (#68).
                    if (typeof Scene_HypernetOS !== "undefined") {
                        SceneManager.push(Scene_HypernetOS);
                    } else if (typeof window.Scene_HypernetOS !== "undefined") {
                        SceneManager.push(window.Scene_HypernetOS);
                    } else {
                        console.warn("Scene_HypernetOS is not defined!");
                    }
                    break;
                case "dynamics":
                    this.showDynamicsPage();
                    break;
                case "pets":
                    this.showPetsPage();
                    break;
                case "army":
                    if (typeof Scene_Army !== "undefined") {
                        SceneManager.push(Scene_Army);
                    } else if (typeof window.Scene_Army !== "undefined") {
                        SceneManager.push(window.Scene_Army);
                    } else {
                        console.warn("Scene_Army is not defined!");
                    }
                    break;
                case "build":
                    // Close the pause menu and open the on-map build overlay.
                    $gameTemp._fbOpenPending = true;
                    this.popScene();
                    break;
                case "bestiary":
                    if (typeof Scene_CDCollection !== "undefined") {
                        SceneManager.push(Scene_CDCollection);
                    } else {
                        console.warn("Scene_CDCollection is not defined!");
                    }
                    break;
                case "factions":
                    if (typeof Scene_FactionStatus !== "undefined") {
                        SceneManager.push(Scene_FactionStatus);
                    } else {
                        console.warn("Scene_FactionStatus is not defined!");
                    }
                    break;
                case "biologics":
                    if (typeof Scene_BiologicSimulation !== "undefined") {
                        SceneManager.push(Scene_BiologicSimulation);
                    } else {
                        console.warn("Scene_BiologicSimulation is not defined!");
                    }
                    break;
                case "sandbox":
                    if (typeof Scene_SandboxMenu !== "undefined") {
                        SceneManager.push(Scene_SandboxMenu);
                    } else {
                        console.warn("Scene_SandboxMenu is not defined!");
                    }
                    break;
                case "assets":
                    if (typeof Scene_AssetsMenu !== "undefined") {
                        SceneManager.push(Scene_AssetsMenu);
                    } else if (typeof window.Scene_AssetsMenu !== "undefined") {
                        SceneManager.push(window.Scene_AssetsMenu);
                    } else {
                        console.warn("Scene_AssetsMenu is not defined!");
                    }
                    break;
                case "thinker":
                    if (typeof Scene_Thinker !== "undefined") {
                        SceneManager.push(Scene_Thinker);
                    } else {
                        console.warn("Scene_Thinker is not defined!");
                    }
                    break;
                case "sleep_menu":
                    // Back to the map first, the wait popup lives there.
                    SceneManager.pop();
                    setTimeout(() => {
                        const map = SceneManager._scene;
                        if (!(map instanceof Scene_Map)) return;
                        // Waiting only: resting is reached from a bed, campfire,
                        // tent or a world-map camp, never from the menu.
                        if (map.openWaitMenu) map.openWaitMenu();
                    }, 200);
                    break;
                default:
                    console.warn("D&D Overlay triggered fallback for unknown symbol:", symbol);
                    break;
            }
        }
    };

    Scene_Menu.prototype.useUIToolItem = function (itemId) {
        const item = $dataItems[itemId];
        if (item && $gameParty.hasItem(item)) {
            SoundManager.playUseItem();
            if (item.consumable) {
                $gameParty.loseItem(item, 1);
            }
            const action = new Game_Action($gameParty.leader());
            action.setItemObject(item);
            action.applyGlobal();
            this.popScene();
        }
    };

    // Helper: DateTime Parser
    Scene_Menu.prototype.getUIDateTime = function (minutes) {
        const date = new Date(2001, 0, 1, 10, 0, 0);
        date.setMinutes(date.getMinutes() + minutes);

        const months = [
            "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
            "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
        ];

        const dayNum = String(date.getDate()).padStart(2, "0");
        const monthNum = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear();
        const yearShort = String(year).slice(-2);
        const hours = String(date.getHours()).padStart(2, "0");
        const mins = String(date.getMinutes()).padStart(2, "0");

        return {
            time24: `${hours}:${mins}`,
            dateShort: `${dayNum}/${monthNum}/${yearShort}`
        };
    };

    Scene_Menu.prototype.formatUIMoneyValue = function (value) {
        const valueStr = value.toString();
        if (valueStr.length <= 2) {
            return "0." + valueStr.padStart(2, '0');
        }
        const mainPart = valueStr.slice(0, -2);
        const decimalPart = valueStr.slice(-2);
        const result = mainPart + "." + decimalPart;
        return result.endsWith(".00") ? mainPart : result;
    };

    Scene_Menu.prototype.getUIReproductionName = function (type) {
        switch (type) {
            case -1: return T('MainMenu.reproduction.none');
            case 0: return T('MainMenu.reproduction.testicles');
            case 1: return T('MainMenu.reproduction.uterus');
            case 2: return T('MainMenu.reproduction.oviparous');
            case 3: return T('MainMenu.reproduction.plant');
            case 4: return T('MainMenu.reproduction.mitosis');
            default: return T('MainMenu.reproduction.unknown');
        }
    };

    Scene_Menu.prototype.getUIGenderName = function (gender) {
        switch (gender) {
            case 0: return T('MainMenu.gender.male');
            case 1: return T('MainMenu.gender.female');
            case 2: return T('MainMenu.gender.nonBinary');
            case 3: return T('MainMenu.gender.cocoon');
            default: return T('MainMenu.gender.fluid');
        }
    };

    // Direct Hooks for MZ Scene_Menu update cycles
    const _Scene_Menu_update = Scene_Menu.prototype.update;
    Scene_Menu.prototype.update = function () {
        _Scene_Menu_update.call(this);
        // Intercept inputs with UIMenuInputManager
        UIMenuInputManager.update();
    };

    // Clean up DOM overlays on leaving Scene_Menu
    const _Scene_Menu_terminate = Scene_Menu.prototype.terminate;
    Scene_Menu.prototype.terminate = function () {
        _Scene_Menu_terminate.call(this);
        UIMenuInputManager.deactivate();

        const isReturningToMap = SceneManager.isNextScene(Scene_Map) || (SceneManager._nextScene instanceof Scene_Map);

        if (this._dndContainer) {
            const container = this._dndContainer;
            if (isReturningToMap) {
                // Completely destroy the DOM instantly when returning to map to ensure no lingering events or elements block clicks!
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }
                this._dndContainer = null;
            } else {
                // Opening a linked submenu: instead of cross-fading the menu out (which
                // briefly blends two pages), keep the parchment fully visible as a
                // backdrop so the incoming window fades IN over it. The new scene's own
                // DOM overlay is appended after this one, so it naturally stacks on top.
                container.style.transition = "none";
                container.style.opacity = "1";
                container.style.pointerEvents = "none";
                // Sit just above the game canvas but below any incoming overlay so the
                // new window always renders on top of the backdrop, whatever its z-index.
                container.style.zIndex = "2";

                // Once the incoming window has settled on top, gently dissolve the
                // backdrop so it never blocks canvas-only submenus. Re-entering the
                // menu (see create) cancels this pending dissolve.
                if (container._dndHideTimer) clearTimeout(container._dndHideTimer);
                const token = (container._dndHideToken = (container._dndHideToken || 0) + 1);
                container._dndHideTimer = setTimeout(() => {
                    if (container._dndHideToken !== token) return; // superseded by re-open
                    container._dndHideTimer = null;
                    container.style.transition = "opacity 0.4s ease-out";
                    container.style.opacity = "0";
                    container.style.pointerEvents = "none";
                }, 250);
            }
        }
    };

    // =========================================================================
    // External map hotkey interception fallbacks
    // =========================================================================
    const _Scene_Map_updateScene = Scene_Map.prototype.updateScene;
    Scene_Map.prototype.updateScene = function () {
        _Scene_Map_updateScene.call(this);
        if (!SceneManager.isSceneChanging() && this.isActive() && !this.isBusy()) {
            this.updateMenuHotkeys();
        }
    };

    // What each hotkey does when pressed on the map. Commands with no entry
    // here are menu-only: World Map is handled by Map/WorldMap.js itself,
    // Vehicles/Pets open a page inside Scene_Menu, and the digit commands
    // (Thinker, Multiplayer, Hypernet) must not fire on the field because the
    // number row is the favourites hotbar there.
    // Keys live in HOTKEYS, actions live here.
    const MAP_HOTKEY_ACTIONS = {
        item:       () => pushMapScene(typeof Scene_EnhancedItem !== "undefined" && Scene_EnhancedItem),
        skill:      () => pushPersonalScene(typeof Scene_Skill !== "undefined" && Scene_Skill),
        equip:      () => pushPersonalScene(typeof Scene_Equip !== "undefined" && Scene_Equip),
        status1:    () => pushPersonalScene(typeof Scene_Status !== "undefined" && Scene_Status),
        quest_log:  () => pushMapScene(typeof Scene_KanbanQuest !== "undefined" && Scene_KanbanQuest),
        help:       () => pushMapScene(typeof Scene_Help !== "undefined" && Scene_Help),
        cooking:    () => pushMapScene(typeof Scene_Cooking !== "undefined" && Scene_Cooking),
        training:   () => pushMapScene(typeof Scene_SkillEncyclopedia !== "undefined" && Scene_SkillEncyclopedia),
        bestiary:   () => pushMapScene(typeof Scene_CDCollection !== "undefined" && Scene_CDCollection),
        factions:   () => pushMapScene(typeof Scene_FactionStatus !== "undefined" && Scene_FactionStatus),
        biologics:  () => pushMapScene(typeof Scene_BiologicSimulation !== "undefined" && Scene_BiologicSimulation),
        assets:     () => pushMapScene(typeof Scene_AssetsMenu !== "undefined" && Scene_AssetsMenu),
        options:    () => pushMapScene(typeof Scene_Options !== "undefined" && Scene_Options),
        sandbox:    () => {
            if ($gameSystem && $gameSystem._isSandboxMode) {
                pushMapScene(typeof Scene_SandboxMenu !== "undefined" && Scene_SandboxMenu);
            }
        },
        build:      scene => {
            const canBuild = window.FurnitureSystem?.canBuildOnCurrentMap?.() ?? ($gameMap.mapId() !== 315);
            if (canBuild) {
                SoundManager.playOk();
                PluginManager.callCommand(scene, 'FurnitureSystem', 'openBuilder', {});
            }
        },
        // Bethesda's T: passes the clock without resting, so it never refills
        // the sleep meter (see Core/TimeDateSystemUI.js).
        sleep_menu: scene => {
            if (!scene.openWaitMenu) return;
            SoundManager.playOk();
            scene.openWaitMenu();
        }
    };

    function pushMapScene(sceneClass) {
        if (!sceneClass) return;
        SoundManager.playOk();
        SceneManager.push(sceneClass);
    }

    // Scenes that read $gameParty.menuActor(): point them at the party leader,
    // the same actor the menu preselects.
    function pushPersonalScene(sceneClass) {
        if (!sceneClass) return;
        $gameParty.setMenuActor($gameParty.members()[0]);
        pushMapScene(sceneClass);
    }

    Scene_Map.prototype.updateMenuHotkeys = function () {
        if ($gameMap.isEventRunning()) return;
        if ($gameTemp._sleepMenuOpen) return; // the wait/rest popup owns the keyboard

        HOTKEYS.forEach(h => {
            const action = MAP_HOTKEY_ACTIONS[h.symbol];
            if (action && Input.isTriggered(h.input)) action(this);
        });
    };

    // Tab opens the pause menu, matching the Bethesda convention (and closing it
    // again from inside, see UIMenuInputManager). Esc/right-click still work.
    const _Scene_Map_isMenuCalled = Scene_Map.prototype.isMenuCalled;
    Scene_Map.prototype.isMenuCalled = function () {
        return _Scene_Map_isMenuCalled.call(this) || Input.isTriggered('tab');
    };

    Scene_Menu.prototype.commandWorldMapMenu = function () {
        this.showWorldMapPage();
    };

    // Override Scene_MenuBase background creation to skip the PIXI blur filter
    // applied to the screen snapshot, avoids the jarring blur/deblur on every window open.
    Scene_MenuBase.prototype.createBackground = function () {
        this._backgroundSprite = new Sprite();
        this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
        this.addChild(this._backgroundSprite);
        this.setBackgroundOpacity(192);
    };

    // ─── Scene_GameEnd, parchment DOM overlay ───────────────────────────────

    const _Scene_GameEnd_create = Scene_GameEnd.prototype.create;
    Scene_GameEnd.prototype.create = function () {
        _Scene_GameEnd_create.call(this);
        this._commandWindow.opacity = 0;
        this._commandWindow.contentsOpacity = 0;

        const old = document.getElementById('game-end-parchment');
        if (old) old.remove();

        const root = document.createElement('div');
        root.id = 'game-end-parchment';

        const commands = [
            { text: TextManager.gameEnd, handler: 'toTitle' },
            { text: TextManager.cancel,  handler: 'cancel'  }
        ];
        this._geEls = [];
        commands.forEach((cmd, idx) => {
            const el = document.createElement('div');
            el.className = 'game-end-parchment-item';
            el.textContent = cmd.text;
            el.addEventListener('mouseenter', () => this._commandWindow.select(idx));
            el.addEventListener('click', () => {
                SoundManager.playOk();
                this._commandWindow.select(idx);
                this._commandWindow.callHandler(cmd.handler);
            });
            root.appendChild(el);
            this._geEls.push(el);
        });

        document.body.appendChild(root);
        this._geParchment = root;
        this._geLastIdx = -1;
    };

    const _Scene_GameEnd_update = Scene_GameEnd.prototype.update;
    Scene_GameEnd.prototype.update = function () {
        _Scene_GameEnd_update.call(this);
        if (!this._geParchment || !this._commandWindow) return;
        const idx = this._commandWindow.index();
        if (idx !== this._geLastIdx) {
            this._geLastIdx = idx;
            this._geEls.forEach((el, i) => {
                el.style.background = i === idx ? 'rgba(74,39,17,0.15)' : 'transparent';
                el.style.borderColor = i === idx ? '#4a2711' : 'transparent';
            });
        }
    };

    const _Scene_GameEnd_terminate = Scene_GameEnd.prototype.terminate;
    Scene_GameEnd.prototype.terminate = function () {
        _Scene_GameEnd_terminate.call(this);
        const el = document.getElementById('game-end-parchment');
        if (el) el.remove();
        this._geParchment = null;
        this._geEls = null;
    };

})();
