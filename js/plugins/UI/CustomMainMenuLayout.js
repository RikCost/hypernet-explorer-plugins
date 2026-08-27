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
 *     Tab  Open / close the menu        J  Journal (Quest Log)
 *     I    Inventory                    U  Magic (Spells)
 *     C    Character (Status)           O  Outfit (Equip)
 *     M    Map (minimap toggle)         R  Rest (Wait / Sleep)
 *     B    Build                        V  Vehicles
 *     H    Help (Codex)                 F  Factions
 *     K    Cooking                      N  Training
 *     Y    Bestiary                     G  Sandbox (tester only)
 *     1-9  Favourite items (on the map)
 *     1/2/3 Thinker / Multiplayer / Hypernet (inside the menu only)
 *     F5   Quicksave, F9 Quickload (Core/SaveSystem.js)
 *
 *   W/A/S/D move, Z/X are ok/cancel and Q/E zoom the world map
 *   (Map/WorldMap.js), so none of those are available for commands. T is
 *   world map <-> procedural map (Map/WorldMapReturn.js). Assets, Biologics
 *   and Options have no dedicated hotkey and open from their pockets tile.
 */

(function () {
    const pluginName = "CustomMainMenuLayout";

    // Escape user-controllable text (player/party/pet names) before innerHTML
    // injection so a `<` in a name can't break or inject markup.
    const HTML_ESCAPES = {
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    };
    function escapeHtml(str) {
        return String(str ?? "").replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
    }

    // While Em travels with the party the menu picks up her vocabulary: the
    // needs cards and a handful of tiles answer to her register instead of the
    // clinical one (CharacterCreationPresets.emLabel). Every other party gets
    // the fallback passed in here, so this is a no-op on an ordinary run.
    function emLabel(key, label) {
        return window.CharacterPresets?.emLabel?.(key, label) ?? label;
    }

    // Both travel entries that offer the world map are one row doing three jobs:
    // on Earth it goes back to map 315, on another planet's surface there is no
    // world map to go back to and the press opens the landing-site picker
    // instead, and on a floor of the tower it calls the lift, which is the only
    // way off a floor (WorldMapReturn's commandWorldMap decides, this only
    // names it).
    function worldMapReturnLabel() {
        if (window.GalaxySim?.isAlienSurface?.()) return T('MainMenu.cmd.chooseLandingSite');
        if (window.DungeonFloors?.insideTower?.()) return T('MainMenu.cmd.returnToElevator');
        return T('MainMenu.cmd.returnToWorldMap');
    }

    // The 3D voxel world (VoxelWorld/*) is up behind the menu. The map under it
    // is whatever the party walked out of - very often map 315 itself, since a
    // free walk starts from the world map - so the travel page cannot decide
    // what to offer from the map id alone: out here the only entry that makes
    // sense is "return to the world map", which ends the walk or the drive and
    // puts the party down on the square they reached. "Stop travel" would visit
    // that square instead, generating a procedural map nobody asked for.
    function inVoxelWorld() {
        return !!(window.VoxelWorldSystem && window.VoxelWorldSystem.isActive() &&
                  !window.VoxelWorldSystem.isTitleDrive());
    }

    // The Hyperdeck tile is always usable: every party owns a deck, and the
    // deck decides for itself whether it can boot. It used to be gated on
    // carrying an internet-capable device, which is no longer what the machine
    // is made of.

    // The Alchemistry bench is a thing you carry, not a place: the tile is only
    // usable while the party holds the portable kit, and is greyed out (rather
    // than hidden) the way the Hypernet tile is when no device is carried.
    const ALCHEMISTRY_KIT_ITEM_ID = 390;

    function isAlchemistryAvailable() {
        if (typeof $gameParty === "undefined" || !$gameParty || typeof $dataItems === "undefined") return false;
        const kit = $dataItems[ALCHEMISTRY_KIT_ITEM_ID];
        return !!(kit && $gameParty.hasItem(kit));
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
    //   I Inventory · J Journal (Quest Log) · U Magic(Spells)
    //   C Character(Status) · M Map · O Outfit(Equip) · R Rest(Wait)
    //   B Build · H Help · Tab open/close menu
    //   F5 quicksave · F9 quickload (see Core/SaveSystem.js)
    //
    // Reserved and unavailable: W/A/S/D (movement), Z/X (ok/cancel),
    // Q/E (Map/WorldMap.js zoom, that plugin loads later and wins the mapping),
    // T (Map/WorldMapReturn.js: world map <-> procedural map toggle).
    //
    // Assets, Biologics and Options lost their keys to Help, Spells and Equip
    // respectively: they carry no badge and open from their pockets tile.
    // `input` overrides the derived "letter_<key>" symbol for keys another
    // plugin already owns; `code` is omitted for those so we don't fight over
    // Input.keyMapper.
    const HOTKEYS = [
        { symbol: "item",        key: "I", code: 73 },
        { symbol: "quest_log",   key: "J", code: 74 },
        { symbol: "skill",       key: "U", code: 85 },
        { symbol: "status1",     key: "C", code: 67 },
        { symbol: "equip",       key: "O", code: 79 },
        { symbol: "sleep_menu",  key: "R", code: 82 },
        { symbol: "world_map",   key: "M", input: "world_map_toggle" }, // owned by Map/WorldMap.js
        { symbol: "vehicles",    key: "V", code: 86 },
        { symbol: "build",       key: "B", code: 66 },
        { symbol: "factions",    key: "F", code: 70 },
        { symbol: "cooking",     key: "K", code: 75 },
        { symbol: "help",        key: "H", code: 72 },
        { symbol: "training",    key: "N", code: 78 },
        { symbol: "bestiary",    key: "Y", code: 89 },
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
    // Pets, Tools, Assets, Biologics, Options) simply render without a badge.
    HOTKEYS.forEach(h => { h.input = h.input || ("letter_" + h.key.toLowerCase()); });
    const HOTKEY_LABELS = {};
    HOTKEYS.forEach(h => { HOTKEY_LABELS[h.symbol] = h.key; });

    // Every index here is a cell of img/system/IconSet.png (16 cells to a row,
    // 464 cells in all). The sheet has been redrawn since these were first
    // picked, so they are chosen from what the cell actually shows today, not
    // from what it used to hold: keep them in step with js/db/Sprites/Icons.json
    // whenever the sheet changes again.
    const COMMAND_ICONS = {
        item: 209,
        equip: 137,
        skill: 70,
        status1: 188,
        specializations: 87,
        sleep_menu: 205,
        save: 121,
        cooking: 219,
        thinker: 290,
        blacksmithing: 108,
        alchemistry: 180,
        build: 210,
        quest_log: 231,
        diary: 189,
        training: 193,
        research: 225,
        bestiary: 291,
        cards: 416,
        world_map: 190,
        factions: 132,
        biologics: 84,
        augments: 143,
        search: 247,
        help: 186,
        options: 83,
        tools: 216,
        dynamics: 196,
        sandbox: 245,
        multiplayer: 246,
        hypernet: 306,
        gameEnd: 214,
        assets: 313,
        pets: 298,
        vehicles: 195,
        army: 131
    };

    // The rows that are not main-menu commands: the World Map page, the Tools
    // pocket and the Dynamics tiles. They live here so every icon the menu
    // draws is picked from one table instead of being spelled out inline.
    const PAGE_ICONS = {
        travelReturn: 140,
        travelGoUp: 73,
        travelGoDown: 74,
        travelMinimap: 151,
        travelOpenMap: 190,
        travelAtlas: 229,
        travelResume: 249,
        travelStop: 282,
        returnToShip: 296,
        hexphone: 206,
        alchemistryKit: 180,
        dynamicsRoster: 196,
        dynamicsTurnOrder: 220,
        dynamicsWiki: 234,
        dynamicsHistory: 230
    };

    // One cell of the sheet, as an inline background. Every icon in the menu
    // goes through here: the offsets used to be written out by hand at a dozen
    // call sites, which is how half of them drifted off their cell.
    //
    // The sheet is drawn at 32px to the cell but the menu draws its icons in a
    // smaller box, so the whole sheet is scaled to that box instead of being
    // sampled on the native grid: sampling it natively is what cut every icon
    // down to its top left corner (the magnifier lost its handle). The box
    // size comes from --icon-size on the element, so one stylesheet rule
    // decides it and the offsets follow; the fallback keeps the icons whole
    // even if the rule is missing.
    const ICON_CELL = "var(--icon-size, 24px)";
    const iconStyle = index => {
        const col = index % 16;
        const row = Math.floor(index / 16);
        return "width:" + ICON_CELL + "; height:" + ICON_CELL + ";" +
            "background-image:url('img/system/IconSet.png');" +
            "background-repeat:no-repeat;" +
            "background-size:calc(" + ICON_CELL + " * 16) auto;" +
            "background-position:calc(" + ICON_CELL + " * -" + col + ") calc(" + ICON_CELL + " * -" + row + ")";
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
            if (!this.active) return;

            // A focused text field owns the keyboard (the search bar above the
            // party cards, a pet's name field). Their key events are stopped at
            // the element so Input never sees the typing, but the gamepad poll
            // and any key pressed before the field took focus still reach here,
            // and "I" must type an i rather than open the backpack.
            const focused = document.activeElement;
            if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) return;

            // Keep the TAB/L1-R1 hint honest with whatever input the player is
            // actually on right now, not just whichever one the menu happened
            // to open with (a pad player who starts moving the cursor before
            // ever pressing a shoulder button should still see "L1 / R1").
            const hintScene = SceneManager._scene;
            if (hintScene && hintScene._dndContainer && hintScene.uiSwitchHintText) {
                const hint = hintScene._dndContainer.querySelector(".party-switch-hint");
                if (hint) {
                    const text = hintScene.uiSwitchHintText();
                    if (hint.textContent !== text) hint.textContent = text;
                }
            }

            // Walking the party comes before the back-out check because TAB is
            // shared between the two: while the roster cards are on the page it
            // steps to the next member (so the needs panel reports each of them
            // in turn), and only the cancel key leaves the menu. The shoulder
            // buttons do the same on a pad, backwards and forwards.
            const menuScene = SceneManager._scene;
            if (menuScene && menuScene.canCycleSelectedActor && menuScene.canCycleSelectedActor()) {
                if (Input.isTriggered('pageup')) {
                    menuScene.cycleSelectedActor(-1);
                    return;
                }
                if (Input.isTriggered('pagedown') || Input.isTriggered('tab')) {
                    menuScene.cycleSelectedActor(1);
                    return;
                }
            }

            // Backing out is answered before anything else: a page can be empty
            // of focusable tiles (a Followers list with nobody in it, a Vehicles
            // list with nothing owned) and the cancel key still has to work
            // there, so it must not sit behind the focus-ring guard below.
            if (Input.isTriggered('cancel') || Input.isTriggered('tab')) {
                // Tab backs out of the menu the way it opened it (Bethesda).
                const scene = SceneManager._scene;
                if (!scene || !scene.backOutOneLevel || !scene.backOutOneLevel()) {
                    SoundManager.playCancel();
                    if (scene) scene.popScene();
                }
                return;
            }

            if (this.activeElements.length === 0) return;

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

    // Published so menus living in other plugins can hand the navigator over; WorldMapReturn
    // suspends it while the world map choice window owns the input.
    window.UIMenuInputManager = UIMenuInputManager;

    // =========================================================================
    // Canvas window paint deferral
    // =========================================================================
    // Every parchment menu in the game still builds the engine's own windows,
    // because that is where the plugins hang their command handlers (see
    // triggerUICommand), and then hides all of them in the same frame because
    // the DOM overlay draws the menu itself. Scene_Menu does it at the end of
    // create() below; the backpack does it at ItemSystemInventory.js
    // Scene_EnhancedItem.prototype.create, and so on through every scene
    // reachable from the pockets.
    //
    // Painting those windows into contents bitmaps nobody ever sees is pure
    // waste on every open, and it is the expensive half of building them:
    // Window_MenuStatus blits a 144x144 face plus three gauges per party member
    // (pulling those faces through ImageManager to do it), and the backpack's
    // item list lays out an icon and two text runs for every single thing the
    // party is carrying.
    //
    // So: painting is suspended for the whole of any menu scene's create(), and
    // settled up the instant it returns (SceneManager.onSceneCreate, which runs
    // immediately after create() and before the scene is ever rendered).
    // Windows still on screen at that point paint right there, so nothing
    // flashes blank; windows the scene hid stay unpainted, and pick the work up
    // on their next update if they are ever shown after all. Only the drawing is
    // ever skipped, never makeCommandList or anything else a plugin reads back.
    let deferringMenuWindowPaint = false;
    const deferredPaintWindows = [];

    const _Window_Selectable_drawAllItems = Window_Selectable.prototype.drawAllItems;
    Window_Selectable.prototype.drawAllItems = function () {
        if (deferringMenuWindowPaint) {
            if (!this._dndPaintPending) {
                this._dndPaintPending = true;
                deferredPaintWindows.push(this);
            }
            return;
        }
        _Window_Selectable_drawAllItems.call(this);
    };

    const _Window_Selectable_update = Window_Selectable.prototype.update;
    Window_Selectable.prototype.update = function () {
        if (this._dndPaintPending && this.visible) {
            this._dndPaintPending = false;
            this.paint();
        }
        _Window_Selectable_update.call(this);
    };

    // Scene_MenuBase.prototype.create is the first thing every menu scene's own
    // create() calls, so this is the earliest point at which the suspension can
    // start and still cover the whole scene.
    const _Scene_MenuBase_create = Scene_MenuBase.prototype.create;
    Scene_MenuBase.prototype.create = function () {
        deferringMenuWindowPaint = true;
        _Scene_MenuBase_create.call(this);
    };

    // Belt and braces: if a scene's create() ever throws, onSceneCreate below
    // never runs, and without this the suspension would stay latched on for the
    // rest of the session and every list in the game would draw blank.
    const _SceneManager_changeScene = SceneManager.changeScene;
    SceneManager.changeScene = function () {
        deferringMenuWindowPaint = false;
        deferredPaintWindows.length = 0;
        _SceneManager_changeScene.call(this);
    };

    const _SceneManager_onSceneCreate = SceneManager.onSceneCreate;
    SceneManager.onSceneCreate = function () {
        deferringMenuWindowPaint = false;
        while (deferredPaintWindows.length > 0) {
            const win = deferredPaintWindows.pop();
            if (win._dndPaintPending && win.visible) {
                win._dndPaintPending = false;
                win.paint();
            }
        }
        _SceneManager_onSceneCreate.call(this);
    };

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
        // Nobody has been singled out yet, so the addictions card opens on the
        // party as a whole. Clicking a member card pins it to that member.
        this._needsActorPinned = false;
        this._isToolsPage = false;
        this._isWorldMapPage = false;
        this._isDynamicsPage = false;
        this._dynamicsView = 'hub';
        this._dynamicsPendingRetireId = null;
        this._isPetsPage = false;
        this._petAbandonId = null;
        this._isVehiclesPage = false;
        this._rightClickStartedOnMenu = false;

        // Painting of the windows built in here is suspended for the whole of
        // create() and settled up once it returns, see the deferral above.
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
            existing.style.display = ""; // back into the layout if the dissolve finished

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

    // Re-read the focusable tiles after something has replaced part of a page
    // without going through a full refreshUIMenuDOM (the search page patches
    // just its results list as the player types, see CustomMainMenuSearch.js).
    // Without this the navigator would keep walking DOM nodes that are gone.
    Scene_Menu.prototype.rebindMenuFocus = function () {
        UIMenuInputManager.activate(this._isWorldMapPage ? 1 : 3);
    };

    Scene_Menu.prototype.selectedActor = function () {
        const members = $gameParty.members();
        return members[this._selectedActorIndex] || members[0];
    };

    Scene_Menu.prototype.switchSelectedActor = function (index) {
        // Even re-picking the member already shown is a deliberate pick, so it
        // opens their own addiction bars in place of the party summary.
        if (index === this._selectedActorIndex && this._needsActorPinned) return;
        SoundManager.playCursor();
        this._needsActorPinned = true;
        this._selectedActorIndex = index;
        this.updateRightPageSelection();
    };

    // TAB / L1-R1 and a clicked bio card both land here: only the selection
    // highlight and the needs/addiction bars actually change, so this patches
    // those two things in place (letting the CSS transitions already on
    // .party-bio-card and .survival-bar-fill animate it) instead of fading
    // out and rebuilding the whole right page for a value change.
    Scene_Menu.prototype.updateRightPageSelection = function () {
        const spread = this._dndContainer ? this._dndContainer.querySelector(".book-spread") : null;
        const rightPageContainer = spread ? spread.querySelector(".right-page") : null;
        const partyList = rightPageContainer ? rightPageContainer.querySelector(".party-bio-list") : null;

        // The travel codex and a live search own the right page instead of the
        // party sheet, so there is nothing here to patch: fall back to the
        // normal fade/rebuild.
        if (!partyList) {
            this.refreshUIMenuDOM(true);
            return;
        }

        partyList.querySelectorAll(".party-bio-card").forEach((el, idx) => {
            el.classList.toggle("selected", idx === this._selectedActorIndex);
        });

        const hint = rightPageContainer.querySelector(".party-switch-hint");
        if (hint) hint.textContent = this.uiSwitchHintText();

        const box = rightPageContainer.querySelector(".survival-box");
        if (!box) return;

        const defs = this.getUINeedsCardDefs($gameParty.members());
        const existing = new Map();
        box.querySelectorAll(".survival-card").forEach(el => existing.set(el.dataset.need, el));

        // A card the new member doesn't have (an addiction only the previous
        // member carried) is dropped; one only the new member has is appended.
        existing.forEach((el, key) => {
            if (!defs.some(d => d.key === key)) el.remove();
        });

        defs.forEach(def => {
            const el = existing.get(def.key);
            if (!el) {
                box.insertAdjacentHTML("beforeend", this.renderUINeedsCardHTML(def));
                return;
            }
            // The band is a class, so an in place refresh swaps the class
            // rather than repainting the colour by hand.
            const BANDS = ["gauge-band--bad", "gauge-band--warn", "gauge-band--ok"];
            const valEl = el.querySelector(".survival-val");
            valEl.textContent = `${def.val}%`;
            const fill = el.querySelector(".survival-bar-fill");
            fill.style.width = `${def.val}%`;
            for (const target of [valEl, fill]) {
                target.classList.remove(...BANDS);
                target.classList.add(def.band);
            }
        });
    };

    // The roster cards only exist on the sheet that carries the needs panel, so
    // the party walk is offered exactly where it has something to move: not on
    // the travel codex, not while a search has taken the spread over, and not
    // for a party of one.
    Scene_Menu.prototype.canCycleSelectedActor = function () {
        if (this._isWorldMapPage) return false;
        if (window.MenuSearch && window.MenuSearch.isActive()) return false;
        return $gameParty.members().length > 1;
    };

    Scene_Menu.prototype.cycleSelectedActor = function (delta) {
        const members = $gameParty.members();
        if (members.length < 2) return;
        const count = members.length;
        const next = ((this._selectedActorIndex + delta) % count + count) % count;
        this.switchSelectedActor(next);
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
            // Vehicles page renders its sprites on the left page, and stands
            // the selected one on the turntable on the right.
            this.drawAllVehicleSprites();
            this.refreshGaragePreview();

            // Re-bind focusable commands in new list immediately so keyboard/gamepad navigation finds them
            UIMenuInputManager.activate(this._isWorldMapPage ? 1 : 3);
            if (window.MenuSearch) window.MenuSearch.afterRender(this);

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
            if (window.MenuSearch) window.MenuSearch.afterRender(this);

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
        // A live search covers both pages, so it is the first thing a cancel
        // takes back (CustomMainMenuSearch.js).
        if (window.MenuSearch && window.MenuSearch.isActive()) {
            window.MenuSearch.clear(this);
            return true;
        }
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
        this._petAbandonId = null;
        this._petTrainId = null;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.hidePetsPage = function () {
        SoundManager.playCancel();
        this._isPetsPage = false;
        // An open name field or a pending abandonment is dropped with the page,
        // so coming back never reopens it half-typed or one press from parting
        // with somebody.
        this._petRenameId = null;
        this._petAbandonId = null;
        this._petTrainId = null;
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
        this.closeGaragePreview();
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

    // Sending away whatever the party called. Unlike abandoning an animal this
    // breaks no law: a summon was never anyone's to keep.
    Scene_Menu.prototype.dismissSummonUI = function () {
        if (!window.SummonSystem || !window.SummonSystem.dismissMapSummon) return;
        SoundManager.playCancel();
        window.SummonSystem.dismissMapSummon();
        this.refreshUIMenuDOM(false);
    };

    // Combat training. Picking a drill takes over the row's button strip the
    // same way renaming does, so there is no way to abandon or re-leash a
    // companion with the class chips open.
    Scene_Menu.prototype.startPetTraining = function (petId) {
        if (!window.PetSystem || !window.PetSystem.canTrain(petId)) return;
        SoundManager.playOk();
        this._petRenameId = null;
        this._petAbandonId = null;
        this._petTrainId = petId;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.cancelPetTraining = function () {
        if (this._petTrainId == null) return;
        SoundManager.playCancel();
        this._petTrainId = null;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.confirmPetTraining = function (classId) {
        const petId = this._petTrainId;
        if (petId == null || !window.PetSystem) return;
        if (!window.PetSystem.startTraining(petId, classId)) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playOk();
        this._petTrainId = null;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.stopPetTraining = function (petId) {
        if (!window.PetSystem) return;
        SoundManager.playCancel();
        window.PetSystem.stopTraining(petId);
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.promotePetTrainee = function (petId) {
        if (!window.PetSystem) return;
        if (!window.PetSystem.promoteTrainee(petId)) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playOk();
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.setActivePet = function (petId) {
        if (!window.PetSystem) return;
        SoundManager.playOk();
        window.PetSystem.setActivePet(petId);
        this.refreshUIMenuDOM(false);
    };

    // Abandoning a companion. A follower came along of its own accord and may
    // leave the same way, but a pet or a child left behind is a charge with a
    // bounty on it, so the row asks once and says what it will cost.
    Scene_Menu.prototype.petAbandonWarning = function (pet) {
        const charge = window.PetSystem?.abandonCrimeFor?.(pet.id);
        if (!charge) return T('MainMenu.pets.abandonFree', { name: escapeHtml(pet.name) });
        const fine = window.CrimeSystem
            ? window.CrimeSystem.goldToEuros(charge.bounty || 0)
            : String(charge.bounty || 0);
        return T('MainMenu.pets.abandonWarn', {
            name: escapeHtml(pet.name),
            crime: escapeHtml(charge.name || ''),
            fine: fine,
        });
    };

    Scene_Menu.prototype.startPetAbandon = function (petId) {
        if (!window.PetSystem || !window.PetSystem.getPet(petId)) return;
        SoundManager.playOk();
        this._petRenameId = null;
        this._petAbandonId = petId;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.cancelPetAbandon = function () {
        if (this._petAbandonId == null) return;
        SoundManager.playCancel();
        this._petAbandonId = null;
        this.refreshUIMenuDOM(false);
    };

    Scene_Menu.prototype.confirmPetAbandon = function () {
        const petId = this._petAbandonId;
        if (petId == null || !window.PetSystem) return;
        SoundManager.playCancel();
        this._petAbandonId = null;
        window.PetSystem.abandonPet(petId);
        this.refreshUIMenuDOM(false);
    };

    // Renaming a pet: the row turns into a name field (see the Pets page), which
    // takes the keyboard for itself. Every key event is stopped at the field so
    // the menu's own navigator and the hotkey mapper never see the typing, which
    // is why Enter and Escape are answered here rather than by the menu.
    Scene_Menu.prototype.startPetRename = function (petId) {
        if (!window.PetSystem || !window.PetSystem.getPet(petId)) return;
        SoundManager.playOk();
        this._petAbandonId = null;
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
        // The canvases only exist on the Pets page, so anywhere else this was
        // one getElementById plus a character-sheet load per pet, child and
        // follower on every refresh, all of it landing on nothing.
        if (!this._isPetsPage) return;
        // A summon with no registry record of its own still has a row and a
        // canvas, and it is drawn from the same sprite fields a pet carries.
        const summon = window.SummonSystem?.mapSummonInfo?.() ?? null;
        if (summon && !summon.petId) this.drawPetPortrait(summon, 'summon-canvas');
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
    // Party Dynamics page: a hub of four sub-pages
    //   roster    , promote a leader, bench a member (retiring them into a
    //               character-creation dossier for this world)
    //   turnorder , the order the party acts in, member 1 first
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
        // Handing over the lead is the same act here as it is with Tab out on
        // the map (Core/AutoIdleExplorer.js): the two of them exchange tiles, so
        // the party is standing where it was once the menu closes again. That
        // path reorders through PartyRoster.setLeader itself; the plain call is
        // the fallback for when the map layer is not loaded.
        const lead = window.AutoIdleExplorer?.lead;
        const ok = lead?.switchTo
            ? lead.switchTo(actorId, { pan: false })
            : !!window.PartyRoster?.setLeader?.(actorId)?.ok;
        if (!ok) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playOk();
        // The leader is the menu's default actor, so keep the right page in sync.
        this._selectedActorIndex = 0;
        this.refreshUIMenuDOM(false);
    };

    // Turn order is the party's own marching order; the first nudge pins the
    // order the player is looking at, so nothing jumps about.
    Scene_Menu.prototype.moveUITurnOrder = function (actorId, delta) {
        if (!window.BattleTurnOrder?.move?.(actorId, delta)) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playCursor();
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
        if (view === 'turnorder') return this.generateUIDynamicsTurnOrderHTML();

        const partySize = $gameParty.members().length;
        const pastCount = (window.PartyRoster?.history?.() ?? []).filter(e => e.status !== 'active').length;
        const wikiEnabled = !!window.NPCEmpathize?.openWiki;
        const turnOrderEnabled = !!window.BattleTurnOrder;
        const firstToAct = turnOrderEnabled ? (window.BattleTurnOrder.members()[0] ?? null) : null;

        // The hint ink is left to CSS (.pockets-hint) so each theme can set a
        // readable colour; a hardcoded brown was unreadable on the dark themes.
        const tile = (label, hint, iconIndex, action, enabled) => `
                        <div class="command-item dynamics-tile focusable mainmenu-01" style="opacity:${enabled ? 1 : 0.45}; pointer-events:${enabled ? 'auto' : 'none'}"
                            onclick="${enabled ? action : ''}/* i18n-ignore: inline handler */">
                            <span class="icon mainmenu-02" style="${iconStyle(iconIndex)}"></span>
                            <span class="mainmenu-03">
                                <span>${label}</span>
                                <span class="pockets-hint mainmenu-04">${hint}</span>
                            </span>
                        </div>`;

        return `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="SceneManager._scene?.hideDynamicsPage?.()">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.dynamics.title')}</h2>
                    </div>
                    <div class="mainmenu-05">
                        ${tile(T('MainMenu.dynamics.roster'), T('MainMenu.dynamics.rosterSub', { count: partySize }), PAGE_ICONS.dynamicsRoster,
                            "SceneManager._scene?.setDynamicsView?.('roster')", true)}
                        ${tile(T('MainMenu.dynamics.turnOrder'),
                            firstToAct ? T('MainMenu.dynamics.turnOrderSub', { name: escapeHtml(firstToAct.name()) }) : T('MainMenu.dynamics.turnOrderHint'),
                            PAGE_ICONS.dynamicsTurnOrder, "SceneManager._scene?.setDynamicsView?.('turnorder')", turnOrderEnabled && partySize > 0)}
                        ${tile(T('MainMenu.dynamics.wiki'), T('MainMenu.dynamics.wikiHint'), PAGE_ICONS.dynamicsWiki,
                            "SceneManager._scene?.openDynamicsWiki?.()", wikiEnabled)}
                        ${tile(T('MainMenu.dynamics.history'), pastCount ? T.n('MainMenu.dynamics.historySub', pastCount) : T('MainMenu.dynamics.historyHint'), PAGE_ICONS.dynamicsHistory,
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
                ? `<div class="command-item mainmenu-06">${T('MainMenu.roster.leader')}</div>`
                : `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.promoteUIPartyLeader?.(${actorId})">${T('MainMenu.roster.makeLeader')}</div>`;

            // Retiring is a one-way door, so the row asks twice.
            const retireBtns = pending
                ? `<div class="command-item focusable mainmenu-08" onclick="SceneManager._scene?.retireUIMember?.(${actorId})">${T('MainMenu.roster.confirm')}</div>
                            <div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.cancelRetireUIMember?.()">${T('MainMenu.roster.cancel')}</div>`
                : (canRetireThis
                    ? `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.askRetireUIMember?.(${actorId})">${T('MainMenu.roster.setInactive')}</div>`
                    : `<div class="command-item mainmenu-09">${T('MainMenu.roster.setInactive')}</div>`);

            memberRows += `
                    <div class="npc-dynamics-member mainmenu-10">
                        <div class="portrait-frame">
                            <canvas id="roster-canvas-${actorId}" width="48" height="48"></canvas>
                        </div>
                        <div class="mainmenu-07">
                            <div class="mainmenu-11">
                                ${escapeHtml(mem.name())}
                                <span class="mainmenu-12">${escapeHtml(mem.currentClass() ? mem.currentClass().name : '')} Lv.${mem.level}${isLeader ? ' · leads the party' : ''}</span>
                            </div>
                            <div class="mainmenu-13">
                                ${leaderBtn}
                                ${retireBtns}
                                <div class="command-item focusable mainmenu-07" onclick="window.NPCEmpathize?.openForActor(${actorId})">${T('MainMenu.roster.empathize')}</div>
                            </div>
                        </div>
                    </div>`;
        });

        if (!members.length) {
            memberRows = `<div class="mainmenu-14">${T('MainMenu.dynamics.noMembers')}</div>`;
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
                    <div class="mainmenu-15">${footNote}</div>
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
                ? `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.reactivateUIMember?.(${preset.id})">${T('MainMenu.roster.setActive')}</div>`
                : `<div class="command-item mainmenu-09">${T('MainMenu.roster.setActive')}</div>`;

            rows += `
                    <div class="npc-dynamics-member mainmenu-10">
                        <div class="portrait-frame">
                            <canvas id="bench-canvas-${preset.id}" width="48" height="48"></canvas>
                        </div>
                        <div class="mainmenu-07">
                            <div class="mainmenu-11">
                                ${escapeHtml(preset.name)}
                                <span class="mainmenu-12">${escapeHtml(className)} ${T('MainMenu.roster.levelAbbr')}${preset.level || 1}</span>
                            </div>
                            <div class="mainmenu-16">${since}</div>
                            <div class="mainmenu-13">
                                ${recallBtn}
                            </div>
                        </div>
                    </div>`;
        });

        if (!rows) {
            rows = `<div class="mainmenu-17">${T('MainMenu.dynamics.inactiveEmpty')}</div>`;
        }

        const benchNote = !bench.length
            ? ''
            : (hasRoom ? T('MainMenu.dynamics.inactiveWorldHint') : T('MainMenu.dynamics.inactiveFull'));

        return `
                    <h2 class="tools-title mainmenu-18">${T('MainMenu.dynamics.inactiveTitle')}</h2>
                    ${rows}
                    ${benchNote ? `<div class="mainmenu-15">${benchNote}</div>` : ''}`;
    };

    // Turn order: the party acts in this order, member 1 first, whatever their
    // DEX says (window.BattleTurnOrder, in BattleSystem/IndividualBattleTurns.js).
    // The troop is still ranked by the speed formula, so DEX decides when the
    // monsters get to answer, not the order among the party.
    Scene_Menu.prototype.generateUIDynamicsTurnOrderHTML = function () {
        const order = window.BattleTurnOrder?.members?.() ?? [];
        // $dataSystem.terms is localised in place (Core/Hendrix_Localization.js),
        // so the param term is already the label the rest of the sheet prints.
        const dexLabel = escapeHtml(TextManager.param(6));
        let rows = '';

        order.forEach((mem, idx) => {
            const actorId = mem.actorId();
            const first = (idx === 0);
            const last = (idx === order.length - 1);
            const step = (delta, label, disabled) => (disabled
                ? `<div class="command-item mainmenu-19">${label}</div>`
                : `<div class="command-item focusable mainmenu-20" onclick="SceneManager._scene?.moveUITurnOrder?.(${actorId}, ${delta})">${label}</div>`);

            rows += `
                    <div class="npc-dynamics-member mainmenu-10">
                        <div class="mainmenu-21">${idx + 1}</div>
                        <div class="portrait-frame">
                            <canvas id="roster-canvas-${actorId}" width="48" height="48"></canvas>
                        </div>
                        <div class="mainmenu-07">
                            <div class="mainmenu-11">
                                ${escapeHtml(mem.name())}
                                <span class="mainmenu-12">${dexLabel} ${mem.agi}${first ? ' · ' + T('MainMenu.dynamics.actsFirst') : ''}</span>
                            </div>
                            <div class="mainmenu-13">
                                ${step(-1, T('MainMenu.dynamics.moveUp'), first)}
                                ${step(1, T('MainMenu.dynamics.moveDown'), last)}
                            </div>
                        </div>
                    </div>`;
        });

        if (!rows) {
            rows = `<div class="mainmenu-14">${T('MainMenu.dynamics.noMembers')}</div>`;
        }

        return `
                <div class="tools-pockets">
                    <div class="page-header-bar">
                        <div class="back-button" onclick="SceneManager._scene?.setDynamicsView?.('hub')">${T('MainMenu.dynamics.back')}</div>
                        <h2 class="tools-title">${T('MainMenu.dynamics.turnOrderTitle')}</h2>
                    </div>
                    ${rows}
                    <div class="mainmenu-22">${T('MainMenu.dynamics.turnOrderNote', { stat: dexLabel })}</div>
                </div>`;
    };

    Scene_Menu.prototype.generateUIDynamicsHistoryHTML = function () {
        const STATUS_LABELS = {
            active:  { label: T('MainMenu.roster.travelling'), band: "roster--active" },
            retired: { label: T('MainMenu.roster.inactive'),   band: "roster--retired" },
            left:    { label: T('MainMenu.roster.departed'),   band: "roster--left" },
            died:    { label: T('MainMenu.roster.dead'),       band: "roster--died" },
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
                    <div class="npc-dynamics-member mainmenu-23">
                        <div class="mainmenu-24">
                            ${escapeHtml(entry.name)}${entry.status === 'died' ? ' <span class="mainmenu-25">✝</span>' : ''}
                            <span class="mainmenu-26 ${status.band}">${status.label}</span>
                        </div>
                        <div class="mainmenu-27">
                            ${escapeHtml(entry.className || '')}${entry.className ? ' · ' : ''}${T('MainMenu.roster.levelAbbr')}${entry.level}${entry.isLeader ? T('MainMenu.roster.partyLeader') : ''}
                        </div>
                        <div class="mainmenu-28">${dateLine}</div>
                    </div>`;
        });

        if (!rows) {
            rows = `<div class="mainmenu-14">${T('MainMenu.roster.noRecords')}</div>`;
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
        } else if (action === "atlas") {
            // The atlas is a scene of its own: it opens over the menu and the
            // menu is still there when it closes, so nothing is popped here.
            if (window.WorldAtlas) {
                window.WorldAtlas.open();
            } else {
                console.warn("WorldAtlas is not loaded!");
            }
        } else if (action === "stop") {
            if (typeof this.commandStop === "function") {
                this.commandStop();
            } else {
                console.warn("commandStop is not defined on Scene_Menu!");
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

    // The left page's identity: which page is showing, plus everything about
    // that page's own state that changes what it says. It is worked out before
    // the page itself is built so an unchanged page can be left alone instead of
    // rendered into a string that is then thrown away: clicking a party card
    // redraws only the right page, but used to rebuild all ~45 pockets tiles
    // (and every T() lookup behind them) to compare a key and discard the result.
    Scene_Menu.prototype.uiLeftPageKey = function () {
        // The Dynamics sub-view is part of the key so hub/roster/history swaps
        // actually redraw the page. Roster edits (a promotion, an armed or
        // completed retirement, someone called back off the bench) change the
        // page without changing the view, so they are folded in too.
        const dynamicsKey = this._isDynamicsPage
            ? [
                this._dynamicsView || 'hub',
                this._dynamicsPendingRetireId || 0,
                $gameParty.members().map(mem => mem.actorId()).join('-'),
                (window.CharacterPresets?.getAvailableRetiredPresets?.() ?? []).map(p => p.id).join('-'),
                // Reordering the turn order leaves the party itself untouched,
                // so the pinned order has to be part of the key of its own.
                (window.BattleTurnOrder?.pinned?.() ?? []).join('-')
            ].join(':')
            : '';
        // Abandoning a pet, handing the leash to another one, renaming one or
        // opening the name field or the abandonment warning changes the page
        // without changing which page it is, so all of it is part of the key.
        const petsKey = this._isPetsPage
            ? [
                (window.PetSystem?.getPets?.() ?? []).map(p => `${p.id}.${p.name}`).join('-'),
                window.PetSystem?.getActivePet?.()?.id ?? 0,
                this._petRenameId || 0,
                this._petAbandonId || 0,
                this._petTrainId || 0,
                // A drill advancing, finishing or being called off changes the
                // row without changing anything else on the page.
                (window.PetSystem?.getPets?.() ?? [])
                    .map(p => `${p.id}.${p.training ? p.training.done + '/' + (p.training.ready ? 1 : 0) : ''}`).join('-'),
                // Calling something, or sending it away, adds or removes a row.
                window.SummonSystem?.mapSummonInfo?.()?.name ?? ''
            ].join(':')
            : '';
        // A search takes over the left page, and every change to the query, the
        // filters or the selected row redraws it, so the whole search state is
        // part of the key.
        const searchKey = window.MenuSearch ? window.MenuSearch.stateKey() : '';
        return `${this._isToolsPage}_${this._isWorldMapPage}_${this._isDynamicsPage}${dynamicsKey}_${this._isPetsPage}${petsKey}_${this._isVehiclesPage}_${searchKey}`;
    };

    // Uniform needs palette: gold when healthy, orange when low, red when
    // critical. Every needs bar shares this so the page reads as one scale
    // instead of one arbitrary hue per need. Addictions read the other way
    // round: the bar fills with the craving, so a full one is somebody in
    // withdrawal, not somebody content.

    // The needs/addiction cards for the selected member, as a stable-keyed
    // list. Shared by the full render (generateUIRightPageHTML) and the TAB
    // in-place update (updateRightPageSelection) below, so the two never
    // drift apart from each other.
    Scene_Menu.prototype.getUINeedsCardDefs = function (members) {
        members = members || $gameParty.members();
        const allMemberNeeds = members.map(m => this.getMemberNeeds(m));
        const displayNeeds = allMemberNeeds[this._selectedActorIndex] || allMemberNeeds[0] || {};
        const medHunger  = displayNeeds.hunger  ?? 100;
        const medSleep   = displayNeeds.sleep   ?? 100;
        const medHygiene = displayNeeds.hygiene;
        const medSocial  = displayNeeds.social;
        const medLeisure = displayNeeds.leisure;

        const raw = [
            { key: 'hunger',  label: emLabel("needHunger",  T('MainMenu.need.hunger')),  val: medHunger },
            { key: 'sleep',   label: emLabel("needSleep",   T('MainMenu.need.sleep')),   val: medSleep },
            { key: 'hygiene', label: emLabel("needHygiene", T('MainMenu.need.hygiene')), val: medHygiene },
            { key: 'social',  label: emLabel("needSocial",  T('MainMenu.need.social')),  val: medSocial },
            { key: 'leisure', label: emLabel("needLeisure", T('MainMenu.need.fun')),     val: medLeisure }
        ];
        const defs = raw
            .filter(n => n.val !== null && n.val !== undefined)
            .map(n => ({ key: n.key, label: n.label, val: n.val, band: window.NeedGauge.band(n.val) }));

        // Until a member has been clicked the panel is the party's, so the
        // card is one summary line, "Addictions (X)" over the worst craving
        // anyone is carrying; picking a member opens their own substances one
        // by one.
        const addictions = window.AddictionSystem;
        if (addictions) {
            if (this._needsActorPinned) {
                addictions.cravingsFor(members[this._selectedActorIndex]).forEach(c => {
                    const val = Math.round(c.value);
                    defs.push({ key: `addiction-${c.key}`, label: escapeHtml(c.label), val, band: window.NeedGauge.cravingBand(val) });
                });
            } else {
                const count = addictions.partyAddictCount();
                if (count > 0) {
                    const worst = addictions.partyWorst();
                    const val = Math.round(worst ? worst.value : 0);
                    defs.push({ key: 'addiction-party', label: T('TimeDate.addiction.partyCard', { count }), val, band: window.NeedGauge.cravingBand(val) });
                }
            }
        }
        return defs;
    };

    Scene_Menu.prototype.renderUINeedsCardHTML = function (def) {
        return `
                    <div class="survival-card" data-need="${def.key}">
                        <span class="survival-lbl">${def.label}</span>
                        <span class="survival-val gauge-ink ${def.band}">${def.val}%</span>
                        <div class="survival-bar">
                            <div class="survival-bar-fill gauge-fill ${def.band}" style="width:${def.val}%"></div>
                        </div>
                    </div>`;
    };

    // The TAB / L1-R1 party-walk hint reflects whichever input the player
    // last actually used (see lastInputType above), so a pad player is never
    // told to press a key their controller doesn't have.
    Scene_Menu.prototype.uiSwitchHintText = function () {
        return lastInputType === 'gamepad'
            ? T('MainMenu.roster.switchHintGamepad')
            : T('MainMenu.roster.switchHintKeyboard');
    };

    // The garage: whichever vehicle is selected on the left page, stood on a
    // turntable on the right one. A real 3D model of the thing - the camper, the
    // car, the bike, the dinghy, the broom, and the party's own starship out of
    // the galaxy simulation - rather than the walking sprite the list shows.
    // Where there is no model (or no WebGL to draw it with) the card falls back
    // to naming the vehicle, and the sprite in the list still carries it.
    Scene_Menu.prototype.generateUIGarageHTML = function () {
        const owned = (window.MergedVehicleSystem && window.MergedVehicleSystem.getOwnedVehicles)
            ? window.MergedVehicleSystem.getOwnedVehicles() : [];
        if (!owned.length) {
            return `<div class="mainmenu-14">${T('MainMenu.vehicles.none')}</div>`;
        }
        let sel = owned.find(v => v.key === this._vehiclesSelected) || owned[0];
        this._vehiclesSelected = sel.key;
        const has = window.VehicleModels && window.VehicleModels.has(sel.key);
        const stand = has
            ? `<canvas id="garage-model-canvas" class="garage-canvas"></canvas>`
            : `<div class="mainmenu-14">${T('MainMenu.vehicles.noModel')}</div>`;
        const fuelLine = sel.usesFuel
            ? `${T('VehicleSystem.status.fuel')} ${Math.floor(sel.fuel)} / ${sel.max}`
            : T('MainMenu.vehicles.noFuelNeeded');
        const parked = sel.parkedAt
            ? `<div class="mainmenu-41">${T('MainMenu.vehicles.parkedAt')} ${escapeHtml(sel.parkedAt)}</div>`
            : '';
        return `
            <h2 class="cc-header-gothic">${escapeHtml(sel.name)}</h2>
            <div class="garage-stand">${stand}</div>
            <div class="mainmenu-38">${fuelLine}</div>
            ${parked}`;
    };

    // Put the selected vehicle on the turntable, taking down whatever was on it
    // before. One live WebGL context at a time, and it is handed back the moment
    // the page or the scene closes (closeGaragePreview).
    Scene_Menu.prototype.refreshGaragePreview = function () {
        this.closeGaragePreview();
        if (!this._isVehiclesPage || !window.VehicleModels) return;
        const canvas = document.getElementById('garage-model-canvas');
        if (!canvas) return;
        this._garagePreview = window.VehicleModels.createPreview(canvas, this._vehiclesSelected);
    };

    Scene_Menu.prototype.closeGaragePreview = function () {
        if (this._garagePreview) {
            this._garagePreview.dispose();
            this._garagePreview = null;
        }
    };

    // Clicking a vehicle in the list stands THAT one on the turntable.
    Scene_Menu.prototype.selectUIVehicle = function (key) {
        if (this._vehiclesSelected === key) return;
        SoundManager.playCursor();
        this._vehiclesSelected = key;
        this.refreshUIMenuDOM(true);
    };

    Scene_Menu.prototype.generateUIRightPageHTML = function () {
        // The world map codex and the search result card are self-contained, so
        // the party cards, the needs bars and the clock block below are only
        // gathered when the sheet they belong to is the one being drawn.
        if (this._isWorldMapPage) return this.generateUITravelCodexHTML();
        if (this._isVehiclesPage) return this.generateUIGarageHTML();
        if (window.MenuSearch && window.MenuSearch.isActive()) {
            // While searching, the right page is the selected result's own
            // detail card. The field that found it is on the left page with the
            // results, as it is in every other list menu.
            return window.MenuSearch.rightPageHTML();
        }

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

        // Bounty, and how badly the police want the party for it. The two say
        // different things - the bounty is the standing record, the heat is
        // whether anyone is looking right now - so they sit on the same row
        // rather than in two places the eye has to join up. The chip goes red
        // once the heat is past the threshold an officer gives chase at, which
        // is the only number on this page that changes what happens on the map.
        const bountyValue = $gameVariables.value(66) || 0;
        let formattedBounty = T('MainMenu.roster.none');
        if (bountyValue > 0) {
            formattedBounty = (bountyValue / 100).toFixed(2) + " " + currencyUnit;
        }
        let wantedHTML = "";
        const heatPercent = window.CrimeSystem ? window.CrimeSystem.heatPercent() : 0;
        if (heatPercent > 0) {
            const chasing = window.CrimeSystem.isWanted();
            wantedHTML = `<span class="wanted-chip${chasing ? ' wanted-chip--chased' : ''}"
                        title="${T('MainMenu.label.wantedHeat')}">${T('MainMenu.value.wantedLevel', { pct: heatPercent })}</span>`;
        }

        // Date/Time
        const gameMinutes = $gameVariables.value(114) || 0;
        const dateTime = this.getUIDateTime(gameMinutes);

        const members = $gameParty.members();

        // Party bio cards: every member is rendered as a full portrait + name/class
        // + HP/MP/AP block (same template as the old single header). The active
        // member is highlighted; clicking a card makes that member active so the
        // needs panel and Skills/Equip/Status commands target them.
        let partyBioHTML = '';
        members.forEach((mem, idx) => {
            const memHpPct = Math.floor(mem.hpRate() * 100);
            const memHpBand = memHpPct <= 25 ? 'gauge-band--bad'
                : memHpPct <= 50 ? 'gauge-band--warn' : '';
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
                        <div class="bio-vital"><span class="bio-vital-lbl">${T('MainMenu.vital.hp')}</span><span class="bio-vital-val gauge-ink ${memHpBand}">${mem.hp}/${mem.mhp}</span></div>
                        <div class="bio-vital"><span class="bio-vital-lbl">${T('MainMenu.vital.mp')}</span><span class="bio-vital-val">${mem.mp}/${mem.mmp}</span></div>
                        <div class="bio-vital"><span class="bio-vital-lbl">${T('MainMenu.vital.ap')}</span><span class="bio-vital-val">${Math.floor(mem.tp)}</span></div>
                    </div>
                </div>
            `;
        });

        // Needs computation: the needs panel reflects the active (selected) member.
        let needsCardsHTML = "";
        this.getUINeedsCardDefs(members).forEach(def => {
            needsCardsHTML += this.renderUINeedsCardHTML(def);
        });

        // Only worth telling the player about the walk when there is somebody
        // else to walk to.
        const switchHintHTML = members.length > 1
            ? `<div class="party-switch-hint">${this.uiSwitchHintText()}</div>`
            : '';

        return `
            <div class="party-bio-list">
                ${partyBioHTML}
            </div>
            ${switchHintHTML}

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
                    <span class="clock-value bounty-highlight">${formattedBounty}${wantedHTML}</span>
                </div>
            </div>
        `;
    };

    // Left Page: Commands Pockets, Tools Pockets, or Travel Pockets
    Scene_Menu.prototype.generateUILeftPageHTML = function () {
        let leftPageHTML = "";
        if (window.MenuSearch && window.MenuSearch.isActive()) {
            // A live query takes the whole left page: the results list and its
            // filter/sort bar (CustomMainMenuSearch.js).
            leftPageHTML = window.MenuSearch.leftPageHTML();
        } else if (this._isWorldMapPage) {
            // Render Travel choices
            leftPageHTML = `
                <div class="travel-pockets mainmenu-29">
                    <div class="tools-header mainmenu-30">
                        <h2 class="title mainmenu-31">${T('MainMenu.travel.worldMapTitle')}</h2>
                    </div>
                    <div class="commands-grid mainmenu-32">
            `;

            // 1. Return to World Map — planetside the same row opens the
            // landing-site picker instead (see WorldMapReturn's commandWorldMap).
            // ...unless the party is out in the 3D world, where this row is the
            // way back in even though the map underneath is 315 (inVoxelWorld).
            const canReturn = $gameMap.mapId() !== 315 || inVoxelWorld();
            if (canReturn) {
                leftPageHTML += `
                    <div class="command-item focusable" data-symbol="travel_return" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('return')">
                        <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelReturn)}"></span>
                        <span>${worldMapReturnLabel()}</span>
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
                            <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelGoUp)}"></span>
                            <span>${T('MainMenu.travel.goUp')}</span>
                        </div>
                    `;
                } else if (hasUnderground) {
                    leftPageHTML += `
                        <div class="command-item focusable" data-symbol="travel_goDown" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('goDown')">
                            <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelGoDown)}"></span>
                            <span>${T('MainMenu.travel.goDown')}</span>
                        </div>
                    `;
                }
            }

            // 3. Toggle World Map (Minimap)
            leftPageHTML += `
                <div class="command-item focusable" data-symbol="travel_toggleMinimap" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('toggleMinimap')">
                    <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelMinimap)}"></span>
                    <span>${T('MainMenu.travel.toggleMinimap')}</span>
                </div>
            `;

            // 3b. Open World Map (Actual Zoomable Map)
            leftPageHTML += `
                <div class="command-item focusable" data-symbol="travel_open" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('open')">
                    <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelOpenMap)}"></span>
                    <span>${T('MainMenu.travel.openMap')}</span>
                </div>
            `;

            // 3c. World Atlas (Map/WorldAtlas.js): the political sheet, who
            // holds what and what the weather does there. Nothing here travels.
            if (window.WorldAtlas && window.WorldAtlas.isAvailable()) {
                leftPageHTML += `
                    <div class="command-item focusable" data-symbol="travel_atlas" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('atlas')">
                        <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelAtlas)}"></span>
                        <span>${T('MainMenu.travel.openAtlas')}</span>
                    </div>
                `;
            }

            // 4. Cancel / Back
            leftPageHTML += `
                        <div class="command-item focusable" data-symbol="travel_cancel" onclick="if(SceneManager._scene && typeof SceneManager._scene.hideWorldMapPage === 'function') SceneManager._scene.hideWorldMapPage()">
                            <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelResume)}"></span>
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
                            <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.hexphone)}"></span>
                            <span>${T('MainMenu.tools.hexphone')}</span>
                        </div>
                        ${isAlchemistryAvailable() ? `
                        <div class="command-item focusable" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUICommand === 'function') SceneManager._scene.triggerUICommand('alchemistry')">
                            <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.alchemistryKit)}"></span>
                            <span>${T('MainMenu.tools.alchemistryKit')}</span>
                        </div>` : ''}
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
            // Whatever the party has called and is walking with (SummonSystem.js).
            // A familiar is an animal somebody owns as well as a rite they cast,
            // so it already has a row here: that row gets the send-away button
            // rather than the creature being listed twice.
            const summon = window.SummonSystem?.mapSummonInfo?.() ?? null;
            const summonPetId = summon ? (summon.petId || 0) : 0;
            const summonNote = (info) => info.bound
                ? T('MainMenu.pets.summonBound')
                : T('MainMenu.pets.summonSteps', { steps: info.stepsLeft });
            const dismissBtn = `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.dismissSummonUI?.()">${T('MainMenu.pets.dismissSummon')}</div>`;
            const className = (id) => {
                const data = $dataClasses && $dataClasses[id];
                if (!data) return '';
                return window.CCDbName ? window.CCDbName(data) : data.name;
            };

            const petRow = (pet) => {
                const isActive = (pet.id === activeId);
                const isRenaming = (this._petRenameId === pet.id);
                const isAbandoning = (this._petAbandonId === pet.id);
                const isChoosingDrill = (this._petTrainId === pet.id);
                const drill = window.PetSystem?.trainingInfo?.(pet.id) ?? null;
                const typeLabel = pet.isChild
                    ? T('MainMenu.roster.child')
                    : (pet.isFollower ? T('MainMenu.roster.follower') : T('MainMenu.roster.pet'));
                const activeBtn = isActive
                    ? `<div class="command-item mainmenu-06">${T('MainMenu.roster.following')}</div>`
                    : `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.setActivePet?.(${pet.id})">${T('MainMenu.roster.setActive')}</div>`;
                const activeTag = isActive ? ` · ${T('MainMenu.pets.active')}` : '';
                const isSummoned = (summonPetId === pet.id);
                const summonTag = isSummoned ? ` · ${T('MainMenu.pets.summoned')}` : '';
                // While a pet is being renamed its row hands the whole button
                // strip over to the name field, so there is no way to abandon or
                // re-leash it by mistake with the keyboard captured by typing.
                const maxLen = window.PetSystem?.NAME_MAX_LENGTH ?? 16;
                let buttons;
                if (isRenaming) {
                    buttons = `<input type="text" id="pet-rename-input" class="pet-rename-input mainmenu-33"
                            maxlength="${maxLen}" autocomplete="off" spellcheck="false"
                            value="${escapeHtml(pet.name)}"
                            onkeydown="SceneManager._scene?.onPetRenameKey?.(event)"
                            onkeyup="event.stopPropagation()"
                            onkeypress="event.stopPropagation()">
                        <div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.confirmPetRename?.()">${T('MainMenu.roster.confirm')}</div>
                        <div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.cancelPetRename?.()">${T('MainMenu.roster.cancel')}</div>`;
                } else if (isAbandoning) {
                    // Walking away from a dependent is an offence, so the row
                    // says which charge and what it costs before it is done.
                    buttons = `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.confirmPetAbandon?.()">${T('MainMenu.roster.confirm')}</div>
                        <div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.cancelPetAbandon?.()">${T('MainMenu.roster.cancel')}</div>`;
                } else if (isChoosingDrill) {
                    // The drills this creature's archetype supports, as chips.
                    // A humanoid that talks is offered the whole civilised
                    // roster, so the strip scrolls rather than pushing the rest
                    // of the page off the parchment.
                    const options = window.PetSystem?.trainingOptions?.(pet.id) ?? [];
                    const chips = options.map(id => `
                        <div class="command-item focusable mainmenu-20" onclick="SceneManager._scene?.confirmPetTraining?.(${id})">${escapeHtml(className(id))}</div>`).join('');
                    buttons = `<div class="mainmenu-34">${chips}</div>
                        <div class="command-item focusable mainmenu-20" onclick="SceneManager._scene?.cancelPetTraining?.()">${T('MainMenu.roster.cancel')}</div>`;
                } else {
                    // A companion being drilled is doing one thing only: the
                    // row offers finishing it or calling it off, nothing else.
                    let drillBtns = '';
                    if (drill && drill.ready) {
                        drillBtns = `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.promotePetTrainee?.(${pet.id})">${T('MainMenu.pets.trainJoin')}</div>
                        <div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.stopPetTraining?.(${pet.id})">${T('MainMenu.pets.trainStop')}</div>`;
                    } else if (drill) {
                        drillBtns = `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.stopPetTraining?.(${pet.id})">${T('MainMenu.pets.trainStop')}</div>`;
                    } else if (window.PetSystem?.canTrain?.(pet.id)) {
                        drillBtns = `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.startPetTraining?.(${pet.id})">${T('MainMenu.pets.train')}</div>`;
                    }
                    buttons = `${activeBtn}
                        ${isSummoned ? dismissBtn : ''}
                        ${drillBtns}
                        <div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.startPetAbandon?.(${pet.id})">${T('MainMenu.pets.abandon')}</div>
                        <div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.startPetRename?.(${pet.id})">${T('MainMenu.pets.rename')}</div>`;
                }
                const parentLine = pet.isChild && pet.parentName
                    ? `<div class="mainmenu-35">${T('MainMenu.pets.childOf', { parent: escapeHtml(pet.parentName) })}</div>`
                    : '';
                const warning = isAbandoning
                    ? `<div class="mainmenu-36">${this.petAbandonWarning(pet)}</div>`
                    : '';
                // What the drill is doing right now, or what one would cost.
                let drillLine = '';
                if (isChoosingDrill) {
                    drillLine = T('MainMenu.pets.trainChoose', {
                        days: window.PetSystem?.trainingDays?.(pet.id) ?? 0,
                    });
                } else if (drill && drill.ready) {
                    drillLine = T('MainMenu.pets.trainReady', { className: className(drill.classId) });
                } else if (drill) {
                    const percent = Math.floor(100 * (drill.done || 0) / Math.max(1, drill.need));
                    drillLine = T('MainMenu.pets.trainProgress', {
                        className: className(drill.classId),
                        percent: percent,
                    });
                    // Only the companion on the leash is being drilled; the rest
                    // are waiting their turn, and the row says so.
                    if (!isActive) drillLine += ' ' + T('MainMenu.pets.trainPaused');
                }
                const drillNote = drillLine
                    ? `<div class="mainmenu-37">${escapeHtml(drillLine)}</div>`
                    : '';
                // The three optional traits chosen when the companion was taken
                // in (or carried over from its <Talk> tag) each lean its base
                // attributes one way; a child inherits none of them and skips
                // the line entirely.
                let traitsLine = '';
                if (!pet.isChild) {
                    const attrs = pet.attrs || { STR: 10, CON: 10, INT: 10, WIS: 10, PSI: 10 };
                    const SL = window.CCStatLabel || ((k) => k);
                    const traitTags = [
                        pet.sentient ? T('MainMenu.pets.traitSentient') : null,
                        pet.magical ? T('MainMenu.pets.traitMagical') : null,
                        pet.geneticFreak ? T('MainMenu.pets.traitGeneticFreak') : null,
                    ].filter(Boolean).join(' · ');
                    const statLine = `${SL('STR')} ${attrs.STR} · ${SL('CON')} ${attrs.CON} · ${SL('INT')} ${attrs.INT} · ${SL('WIS')} ${attrs.WIS} · ${SL('PSI')} ${attrs.PSI}`;
                    traitsLine = `<div class="mainmenu-35">${statLine}${traitTags ? ' · ' + traitTags : ''}</div>`;
                }
                return `
                    <div class="npc-dynamics-member mainmenu-10">
                        <div class="portrait-frame">
                            <canvas id="pet-canvas-${pet.id}" width="48" height="48"></canvas>
                        </div>
                        <div class="mainmenu-07">
                            <div class="mainmenu-38">
                                ${escapeHtml(pet.name)}
                                <span class="mainmenu-12">${typeLabel}${activeTag}${summonTag} · ${T('MainMenu.roster.levelAbbr')}${pet.level}</span>
                            </div>
                            ${isSummoned ? `<div class="mainmenu-35">${summonNote(summon)}</div>` : ''}
                            ${traitsLine}
                            ${drillNote}
                            ${parentLine}
                            ${warning}
                            <div class="mainmenu-39">
                                ${buttons}
                            </div>
                        </div>
                    </div>`;
            };

            // A rite the party is walking with that is nobody's animal: it has no
            // registry record of its own, so it is drawn as a row of its own and
            // the only thing that can be done with it is to send it away.
            const summonRows = (summon && !summonPetId) ? `
                    <div class="npc-dynamics-member mainmenu-10">
                        <div class="portrait-frame">
                            <canvas id="summon-canvas" width="48" height="48"></canvas>
                        </div>
                        <div class="mainmenu-07">
                            <div class="mainmenu-38">
                                ${escapeHtml(summon.name)}
                                <span class="mainmenu-12">${T('MainMenu.pets.summoned')} · ${T('MainMenu.roster.levelAbbr')}${summon.level}</span>
                            </div>
                            <div class="mainmenu-35">${summonNote(summon)}</div>
                            <div class="mainmenu-39">
                                ${dismissBtn}
                            </div>
                        </div>
                    </div>` : '';

            // Three kinds of company, kept apart: animals taken in, offspring
            // born to the party, and creatures that talked their way in.
            const groups = [
                { label: T('MainMenu.pets.groupPets'), rows: pets.filter(p => !p.isChild && !p.isFollower) },
                { label: T('MainMenu.pets.groupChildren'), rows: pets.filter(p => p.isChild) },
                { label: T('MainMenu.pets.groupFollowers'), rows: pets.filter(p => !p.isChild && p.isFollower) },
            ];
            let petRows = groups
                .filter(g => g.rows.length)
                .map(g => `
                    <div class="mainmenu-40">${g.label}</div>
                    ${g.rows.map(petRow).join('')}`)
                .join('');
            if (!pets.length && !summonRows) {
                petRows = `<div class="mainmenu-14">${T('MainMenu.pets.none')}</div>`;
            }
            if (summonRows) {
                petRows = `
                    <div class="mainmenu-40">${T('MainMenu.pets.groupSummons')}</div>
                    ${summonRows}${petRows}`;
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
                    ? `<span class="mainmenu-12">Fuel ${Math.floor(v.fuel)}L / ${v.max}L</span>`
                    : `<span class="mainmenu-12">${T('MainMenu.vehicles.noFuelNeeded')}</span>`;
                const repairBtn = v.hasRepair
                    ? `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.repairUIVehicle?.('${v.key}')">${T('MainMenu.roster.repair')}</div>`
                    : '';
                // The Starship also offers a direct "Teleport to Ship" into its interior.
                const boardBtn = v.type === 'airship'
                    ? `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.teleportToShipUI?.()">${T('MainMenu.cmd.teleportToShip')}</div>`
                    : '';
                // Disabled tiles drop `focusable` as well as the handler, so the
                // menu's focus ring walks straight past them.
                const canSpawn = canSpawnKey(v.key);
                if (!canSpawn) anyBlocked = true;
                const spawnBtn = canSpawn
                    ? `<div class="command-item focusable mainmenu-07" onclick="SceneManager._scene?.spawnUIVehicle?.('${v.key}')">${T('MainMenu.vehicles.spawn')}</div>`
                    : `<div class="command-item is-disabled mainmenu-07" title="${escapeHtml(T('MainMenu.vehicles.spawnIndoors'))}">${T('MainMenu.vehicles.spawn')}</div>`;
                // Where it was left standing: the place and the exact tile, so a
                // camper parked outside Ghent station can be walked back to as
                // well as summoned.
                const parkedLine = v.parkedAt
                    ? `<div class="mainmenu-41">${T('MainMenu.vehicles.parkedAt')} ${escapeHtml(v.parkedAt)}</div>`
                    : '';
                const isShown = (this._vehiclesSelected || vehicles[0].key) === v.key;
                vehicleRows += `
                    <div class="npc-dynamics-member mainmenu-10${isShown ? ' garage-shown' : ''}">
                        <div class="portrait-frame focusable" onclick="SceneManager._scene?.selectUIVehicle?.('${v.key}')" title="${escapeHtml(T('MainMenu.vehicles.show'))}">
                            <canvas id="vehicle-canvas-${v.key}" width="48" height="48"></canvas>
                        </div>
                        <div class="mainmenu-07">
                            <div class="mainmenu-38">
                                ${escapeHtml(v.name)}${fuelLine}
                            </div>
                            ${parkedLine}
                            <div class="mainmenu-42">
                                ${spawnBtn}
                                ${repairBtn}
                                ${boardBtn}
                            </div>
                        </div>
                    </div>`;
            });
            if (!vehicles.length) {
                vehicleRows = `<div class="mainmenu-14">${T('MainMenu.vehicles.none')}</div>`;
            }
            const indoorsNote = anyBlocked
                ? `<div class="pockets-hint mainmenu-43">${T('MainMenu.vehicles.spawnIndoors')}</div>`
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
            // T jumps straight between the world map and the procedural map
            // (Map/WorldMapReturn.js), skipping the "Visit / Make a camp / Cancel"
            // choice window entirely, so both hand-rolled travel tiles below carry
            // its badge like any other hotkeyed command tile.
            const worldMapToggleBadge = '<span class="hotkey-badge">T</span>';

            // On the world map (315) surface the "Stop travel" command as the
            // first pockets entry: it visits whatever tile the party is standing
            // on (settlement, hardcoded location, or a freshly generated
            // procedural map), the same destination the T hotkey reaches directly.
            const stopTravelHTML = ($gameMap.mapId() === 315 && !inVoxelWorld()) ? `
                    <div class="command-item focusable" data-symbol="travel_stop" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('stop')">
                        <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelStop)}"></span>
                        <span>${T('MainMenu.cmd.stopTravel')}</span>
                        ${worldMapToggleBadge}
                    </div>
            ` : "";

            // Off the world map, surface the "Return to map" travel command as
            // the very first pockets entry, copied from the World Map submenu, so
            // the player can bail out to map 315 without drilling in. It is not
            // the procedural map's alone: a house, a shop, a cellar or a
            // hand-made town map is left the same way (Map/WorldMapReturn.js).
            const procReturnHTML = ($gameMap.mapId() !== 315 || inVoxelWorld()) ? `
                    <div class="command-item focusable" data-symbol="travel_return" onclick="if(SceneManager._scene && typeof SceneManager._scene.triggerUITravel === 'function') SceneManager._scene.triggerUITravel('return')">
                        <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.travelReturn)}"></span>
                        <span>${worldMapReturnLabel()}</span>
                        ${worldMapToggleBadge}
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
                        <span class="icon mainmenu-02" style="${iconStyle(PAGE_ICONS.returnToShip)}"></span>
                        <span>${T('MainMenu.cmd.returnToShip')}</span>
                    </div>
            ` : "";

            // Render Commands Pockets. The tiles are bundled into unlabelled
            // logical groups separated by a full-width rule, so the 3-column
            // pockets reads as coherent blocks instead of one long alphabet soup:
            //   character (self)  ·  party (companions)  ·  travel & rest  ·
            //   activities  ·  records & standing  ·  system.
            // The character block is always first; the travel block leads with
            // whichever escape hatch applies to the current map ("Stop travel"
            // on the world map, "Return to map" on the procedural map).
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
                    this.generateUICommandItemHTML(T('MainMenu.cmd.augments'), "augments"),
                    // Opens the results page on everything the party carries,
                    // knows and can make, with the field that narrows it at its
                    // head (UI/CustomMainMenuSearch.js).
                    this.generateUICommandItemHTML(T('MainMenu.cmd.search'), "search"),
                ],
                // Party: the people and creatures travelling with you
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.dynamics'), "dynamics"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.pets'), "pets"),
                    this.generateUICommandItemHTML(emLabel("menuWorkforce", T('MainMenu.cmd.workforce')), "army"),
                ],
                // Travel & rest
                [
                    stopTravelHTML,
                    procReturnHTML,
                    returnToShipHTML,
                    this.generateUICommandItemHTML(T('MainMenu.cmd.worldMap'), "world_map"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.vehicles'), "vehicles"),
                    this.generateUICommandItemHTML(emLabel("menuWait", T('MainMenu.cmd.wait')), "sleep_menu"),
                ],
                // Activities: things you do in the world
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.tools'), "tools"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.cooking'), "cooking"),
                    // The workbench sits with the other benches, immediately
                    // ahead of the anvil it shares its recipes with.
                    this.generateUICommandItemHTML(emLabel("menuThinker", T('MainMenu.cmd.thinker')), "thinker"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.blacksmithing'), "blacksmithing"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.alchemistry'), "alchemistry"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.build'), "build"),
                    this.generateUICommandItemHTML(emLabel("menuTraining", T('MainMenu.cmd.training')), "training"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.research'), "research"),
                ],
                // Records & standing: the pockets you consult
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.questLog'), "quest_log"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.diary'), "diary"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.hyperdeck'), "hypernet"),
                    this.generateUICommandItemHTML(emLabel("menuBestiary", T('MainMenu.cmd.bestiary')), "bestiary"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.cards'), "cards"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.archive'), "help"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.factions'), "factions"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.assets'), "assets"),
                ],
                // System: meta / out-of-world
                [
                    this.generateUICommandItemHTML(T('MainMenu.cmd.save'), "save"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.multiplayer'), "multiplayer"),
                    this.generateUICommandItemHTML(T('MainMenu.cmd.preferences'), "options"),
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

            // The search field sits at the head of the pockets, the same place
            // the Skills scene, the Bestiary, the workbench, the forge and the
            // trait picker keep theirs (UI/MenuSearchBar.js). Typing in it
            // replaces this whole page with the results.
            leftPageHTML = `
                ${window.MenuSearch ? window.MenuSearch.barHTML() : ''}
                <div class="commands-grid">
                    ${commandsHTML}
                </div>
            `;
        }

        return leftPageHTML;
    };

    // The right page while the Travel pockets are open: where the party is
    // standing, and the world-map segment it is standing on.
    Scene_Menu.prototype.generateUITravelCodexHTML = function () {
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

        return `
                <div class="travel-codex mainmenu-44">
                    
                    <div class="mainmenu-45">
                        <div class="mainmenu-46">
                            <span class="mainmenu-47">${T('MainMenu.label.location')}</span>
                            <span>${currentRegionName}</span>
                        </div>
                        <div class="mainmenu-46">
                            <span class="mainmenu-47">${T('MainMenu.label.worldCoordinates')}</span>
                            <span>X: ${worldX} | Y: ${worldY}</span>
                        </div>
                        <div class="mainmenu-46">
                            <span class="mainmenu-47">${T('MainMenu.label.sector')}</span>
                            <span>${T('MainMenu.label.rowColumn', { row: row, col: col })}</span>
                        </div>
                    </div>

                    <!-- Map Segment Image Container -->
                    <div class="mainmenu-48">
                        <img class="mainmenu-49" src="img/worldmap/row-${row}-column-${col}.jpg" />
                        
                        <!-- Player Indicator Pin Overlay on the local segment map (0-31 range mapped to 0-100%) -->
                        <div class="mainmenu-50" style="left:${((worldX % 32) / 32) * 100}%; top:${((worldY % 32) / 32) * 100}%"></div>
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
    };

    Scene_Menu.prototype.refreshUIMenuDOM = function (useTransitions = false) {
        if (!this._dndContainer) return;

        const actor = this.selectedActor();
        if (!actor) return;

        // Clamp selected actor index in case the party shrank since last render.
        if (this._selectedActorIndex >= $gameParty.members().length) {
            this._selectedActorIndex = 0;
        }

        const leftPageKey = this.uiLeftPageKey();
        let spread = this._dndContainer.querySelector(".book-spread");

        if (!spread) {
            // Initial load - Render instantly. Building the page can settle the
            // state it was built from (the search results clamp their own
            // selection, see gather() in CustomMainMenuSearch), so the key that
            // is remembered is always read back afterwards.
            const leftHTML = this.generateUILeftPageHTML();
            this._dndLastLeftPageKey = this.uiLeftPageKey();
            this._dndContainer.innerHTML = `
                <div class="book-spread">
                    <div class="left-page">
                        ${leftHTML}
                    </div>
                    <div class="right-page">
                        ${this.generateUIRightPageHTML()}
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
            if (window.MenuSearch) window.MenuSearch.afterRender(this);
        } else {
            // Subsequent updates. The left page is only built when it is going
            // to be used: most refreshes come from the right page (a party card
            // picked, a need ticking over) and leave the pockets untouched.
            if (useTransitions) {
                // Smooth transition switching
                if (this._dndLastLeftPageKey !== leftPageKey) {
                    const leftHTML = this.generateUILeftPageHTML();
                    this.fadeTransitionLeftPage(leftHTML, this.uiLeftPageKey());
                }
                this.fadeTransitionRightPage(this.generateUIRightPageHTML(), actor);
            } else {
                // Direct updates (e.g. for simple state reflows if any)
                const leftPageContainer = spread.querySelector(".left-page");
                const rightPageContainer = spread.querySelector(".right-page");

                if (this._dndLastLeftPageKey !== leftPageKey || !leftPageContainer.innerHTML.trim()) {
                    leftPageContainer.innerHTML = this.generateUILeftPageHTML();
                    this._dndLastLeftPageKey = this.uiLeftPageKey();
                }

                if (rightPageContainer) {
                    rightPageContainer.innerHTML = this.generateUIRightPageHTML();
                }

                // Render Canvases for portraits
                this.drawAllPartyPortraits();
                this.drawAllPetPortraits();
                this.drawAllRosterPortraits();
                this.drawAllVehicleSprites();

                // Re-bind input mappings
                UIMenuInputManager.activate(this._isWorldMapPage ? 1 : 3);
                if (window.MenuSearch) window.MenuSearch.afterRender(this);
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
        const hotkey = HOTKEY_LABELS[symbol] ? `<span class="hotkey-badge">${HOTKEY_LABELS[symbol]}</span>` : "";

        // Check if command is enabled in standard menu list
        // Waiting is always allowed: it only runs the clock forward and never
        // rests the party, so no bed or camp is needed for the tile.
        let enabled = true;
        if (symbol === "build") enabled = window.FurnitureSystem?.canBuildOnCurrentMap?.() ?? ($gameMap.mapId() !== 315);
        if (symbol === "sandbox") enabled = sandboxTester || sandboxActive;
        if (symbol === "alchemistry") enabled = isAlchemistryAvailable();

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
            <div class="command-item focusable" data-symbol="${symbol}" style="opacity:${opacity}; pointer-events:${pointerEvents}" onclick="${clickAction}">
                <span class="icon mainmenu-02" style="${iconStyle(iconIndex)}"></span>
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
            html += `
                <div class="command-item focusable" data-symbol="tool_${item.id}" onclick="if(SceneManager._scene && typeof SceneManager._scene.useUIToolItem === 'function') SceneManager._scene.useUIToolItem(${item.id})">
                    <span class="icon mainmenu-02" style="${iconStyle(iconIndex)}"></span>
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
        // Turn Order draws the same member rows, under the same canvas ids;
        // only Roster carries the bench underneath them.
        const PORTRAIT_VIEWS = ['roster', 'turnorder'];
        if (!this._isDynamicsPage || !PORTRAIT_VIEWS.includes(this._dynamicsView)) return;
        $gameParty.members().forEach(mem => {
            this.drawUIActorPortrait(mem, `roster-canvas-${mem.actorId()}`);
        });
        if (this._dynamicsView !== 'roster') return;
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
                    if (typeof Scene_Cooking !== "undefined") {
                        SceneManager.push(Scene_Cooking);
                    } else {
                        console.warn("Scene_Cooking is not defined!");
                    }
                    break;
                case "alchemistry":
                    if (typeof window.Scene_Alchemistry !== "undefined") {
                        SceneManager.push(window.Scene_Alchemistry);
                    } else {
                        console.warn("Scene_Alchemistry is not defined!");
                    }
                    break;
                case "help":
                    // Guarded like every other tile above: HelpMenu.js owns the scene, and a
                    // bare push threw a ReferenceError whenever that plugin was not loaded.
                    if (typeof window.Scene_Help !== "undefined") {
                        SceneManager.push(window.Scene_Help);
                    } else {
                        console.warn("Scene_Help is not defined!");
                    }
                    break;
                case "hypernet":
                    // The tile opens the machine, not the desktop: the Hyperdeck
                    // boots into Archways XP once it has the parts to do it. The
                    // map W-key shortcut and the OpenHypernetOS plugin command
                    // still go straight to the desktop with no boot (#68).
                    if (window.Scene_HyperDeck) {
                        SceneManager.push(window.Scene_HyperDeck);
                    } else if (window.Scene_HypernetOS) {
                        SceneManager.push(window.Scene_HypernetOS);
                    } else {
                        console.warn("Scene_HyperDeck is not defined!");
                    }
                    break;
                case "dynamics":
                    this.showDynamicsPage();
                    break;
                case "diary":
                    if (window.Scene_Diary) {
                        SceneManager.push(window.Scene_Diary);
                    } else {
                        console.warn("Scene_Diary is not defined!");
                    }
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
                case "cards":
                    if (typeof Scene_CardCollection !== "undefined") {
                        SceneManager.push(Scene_CardCollection);
                    } else if (typeof window.Scene_CardCollection !== "undefined") {
                        SceneManager.push(window.Scene_CardCollection);
                    } else {
                        console.warn("Scene_CardCollection is not defined!");
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
                case "augments":
                    if (typeof Scene_PartyAugments !== "undefined") {
                        SceneManager.push(Scene_PartyAugments);
                    } else {
                        console.warn("Scene_PartyAugments is not defined!");
                    }
                    break;
                case "search":
                    // Stays on this page, but opens the results over it: the
                    // tile shows everything the party has, unfiltered, and the
                    // field at the head of that page narrows it from there
                    // (CustomMainMenuSearch.js).
                    if (window.MenuSearch) {
                        window.MenuSearch.open();
                    } else {
                        console.warn("MenuSearch is not defined!");
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
        // The turntable holds a live WebGL context; leaving the menu hands it back.
        if (this.closeGaragePreview) this.closeGaragePreview();
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

                    // Once it has finished dissolving, take it out of the layout
                    // rather than leaving a transparent full-screen parchment
                    // behind. An opacity:0 tree is still a laid-out tree: it
                    // matches every "#menu-container ..." rule in theme.css and
                    // is re-styled and re-measured along with the submenu's own
                    // spread on top of it, for as long as the player stays in
                    // that submenu. create() below puts it back.
                    container._dndHideTimer = setTimeout(() => {
                        if (container._dndHideToken !== token) return;
                        container._dndHideTimer = null;
                        container.style.display = "none";
                    }, 400);
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
        blacksmithing: () => pushMapScene(typeof Scene_Blacksmithing !== "undefined" && Scene_Blacksmithing),
        training:   () => pushMapScene(typeof Scene_SkillEncyclopedia !== "undefined" && Scene_SkillEncyclopedia),
        bestiary:   () => pushMapScene(typeof Scene_CDCollection !== "undefined" && Scene_CDCollection),
        factions:   () => pushMapScene(typeof Scene_FactionStatus !== "undefined" && Scene_FactionStatus),
        biologics:  () => pushMapScene(typeof Scene_BiologicSimulation !== "undefined" && Scene_BiologicSimulation),
        augments:   () => pushMapScene(typeof Scene_PartyAugments !== "undefined" && Scene_PartyAugments),
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

        // The pad's half of R. Clicking the left stick has no Input.gamepadMapper
        // action on it, so it is polled raw through AnalogStickInput the same way
        // Map/WorldMap.js polls Start for the map sheet; binding it in the mapper
        // would make every key sharing that action fire twice. Map/MapLegend.js
        // draws it as the wait row's pad chip.
        const padWait = window.AnalogStickInput &&
            window.AnalogStickInput.isButtonTriggered(window.AnalogStickInput.BUTTON.L3);
        if (padWait && MAP_HOTKEY_ACTIONS.sleep_menu) {
            MAP_HOTKEY_ACTIONS.sleep_menu(this);
            return;
        }

        // One key opens one screen. Two hotkeys read as triggered on the same
        // frame (a chord, a stuck gamepad mapping) used to push both scenes, so
        // the player had to close a menu they never asked for to get back to the
        // map. The first match wins and the rest of the frame is ignored.
        for (const h of HOTKEYS) {
            const action = MAP_HOTKEY_ACTIONS[h.symbol];
            if (action && Input.isTriggered(h.input)) { action(this); return; }
        }
    };

    // Tab steps the item hotbar (see ItemSystemHotbar.js), the same as L1/R1;
    // it no longer opens the pause menu. Esc/right-click still work for that.

    Scene_Menu.prototype.commandWorldMapMenu = function () {
        this.showWorldMapPage();
    };

    // ─── The screen snapshot every menu backdrop sits on ────────────────────
    // Scene_Map.terminate snapshots the screen for the incoming menu scene to
    // sit on (rmmz_scenes.js), and Bitmap.snap pays for that twice: a
    // gl.readPixels stall that drains the whole GPU pipeline into JS memory,
    // then PIXI's Extract.arrayPostDivide unpremultiplying those pixels one at
    // a time in a JS loop. At 1280x720 that is ~920k iterations on the very
    // frame the menu opens, and it is the most expensive single thing between
    // the keypress and the parchment appearing.
    //
    // None of it is needed. The snapshot is only ever handed to a Sprite (every
    // SceneManager.backgroundBitmap() consumer in the game does exactly that),
    // and a Sprite wants a GPU texture, so the pixels never have to come back
    // to the CPU at all: the stage is rendered straight into a RenderTexture
    // and the Bitmap is handed out wrapping that texture. Full resolution, no
    // readback, no blur, no downscale.
    function snapBackgroundToTexture(stage) {
        const width = Graphics.width;
        const height = Graphics.height;
        const bitmap = new Bitmap();
        const renderTexture = PIXI.RenderTexture.create({ width, height });
        if (stage) {
            const renderer = Graphics.app.renderer;
            renderer.render(stage, renderTexture);
            stage.worldTransform.identity();
        }

        bitmap._renderTexture = renderTexture;
        bitmap._baseTexture = renderTexture.baseTexture;
        // Bitmap reads its size off the canvas it does not have here, and
        // Sprite refuses to draw a bitmap that never reports itself loaded.
        Object.defineProperty(bitmap, 'width', { value: width, configurable: true });
        Object.defineProperty(bitmap, 'height', { value: height, configurable: true });
        bitmap._loadingState = 'loaded';

        // Insurance for any consumer that wants real pixels (blt, getPixel,
        // anything touching .canvas or .context): pay for the readback then,
        // once, instead of on every menu open. The texture stays the one the
        // sprites are drawing, so it must survive the canvas being built.
        bitmap._ensureCanvas = function () {
            if (this._canvas) return;
            const texture = this._renderTexture;
            const keep = this._baseTexture;
            Bitmap.prototype._createCanvas.call(this, width, height);
            this._baseTexture = keep;
            if (texture) {
                const canvas = Graphics.app.renderer.extract.canvas(texture);
                this._context.drawImage(canvas, 0, 0);
                canvas.width = 0;
                canvas.height = 0;
            }
        };

        bitmap.destroy = function () {
            if (this._renderTexture) {
                this._renderTexture.destroy({ destroyBase: true });
                this._renderTexture = null;
            }
            this._baseTexture = null;
            this._destroyCanvas();
        };

        return bitmap;
    }

    SceneManager.snapForBackground = function () {
        if (this._backgroundBitmap) {
            this._backgroundBitmap.destroy();
        }
        this._backgroundBitmap = snapBackgroundToTexture(this._scene);
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
                el.classList.toggle('sprite-frame--picked', i === idx);
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
