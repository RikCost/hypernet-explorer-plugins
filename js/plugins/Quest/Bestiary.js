
/*
* @target MZ
* @plugindesc v1.4.0 - Premium bestiary-style Monster Collection with double-page parchment layout.
* @author Omni-Lex (Modified by OmniLex)
* @url
*
* @help
* =============================================================================
* Monster CD Collection System (bestiary Style by OmniLex) - Parchment Edition
* =============================================================================
* This plugin overlays a beautiful double-page tea-stained parchment book menu
* to track all encountered enemies.
*
* Left Page: Discovered creatures pockets with walking character animations.
* Right Page: Highly detailed creature portfolios with 4 custom alchemical tabs:
*   - Info: High-res battler portrait and description.
*   - Combat: D&D stats (STR, CON, etc.) and active element weaknesses/resists.
*   - Ecology: Biomes, time of day, blood types, weights, speeds, and abilities.
*   - Spoils: Harvester drops, percentage drop rates, and combat skills.
*
* Fully supports keyboard, mouse, and gamepad arrow navigation.
* Keeps original AsciiMode compatibility in tact.
*
* @param menuText
* @text CD Case Menu Text
* @desc Text displayed in the main menu for the CD Case option
* @default bestiary
*
* @command OpenBestiary
* @text Open bestiary
* @desc Opens the monster collection menu
*
* @command RevealEntries
* @text Reveal Entries
* @desc Marks a number of not-yet-discovered creatures as encountered in the bestiary.
*
* @arg amount
* @text Amount
* @type number
* @min 1
* @desc How many undiscovered creatures to reveal (lowest enemy IDs first).
* @default 1
*/

(() => {
    'use strict';

    const pluginName = "Bestiary"; // i18n-ignore: plugin id

    // An ecology note-tag value, named for the panel. The value stays the id,
    // so an unlisted (modded) tag still reads as written.
    function ecologyLabel(group, id) {
        const key = 'Bestiary.' + group + '.' + String(id).toLowerCase();
        return T.has(key) ? T(key) : String(id);
    }

    let _statsI18n = null;
    let _enemiesI18n = null;

    const _loadStatsI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/stats.json`;
        try {
            const response = await fetch(url);
            _statsI18n = await response.json();
        } catch (e) {
            console.error('Bestiary: Failed to load i18n data from ' + url, e);
            _statsI18n = {};
        }
    };

    const _loadEnemiesI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/enemies.json`;
        try {
            const response = await fetch(url);
            _enemiesI18n = await response.json();
        } catch (e) {
            console.error('Bestiary: Failed to load enemies i18n from ' + url, e);
            _enemiesI18n = {};
        }
    };

    const _si18n = (key) => {
        if (_statsI18n && _statsI18n[key]) {
            return _statsI18n[key];
        }
        return key;
    };

    _loadStatsI18n();
    _loadEnemiesI18n();

    //=============================================================================
    // Custom Parameter Names (mapped to D&D standard)
    //=============================================================================
    const getShortParamName = function (paramId) {
        const shortParamNames = [
            _si18n("HP"),
            _si18n("MP"),
            _si18n("ATT"),
            _si18n("DEF"),
            _si18n("M.ATT"),
            _si18n("M.DEF"),
            _si18n("AGILITY"),
            _si18n("LUCK")
        ];
        return shortParamNames[paramId] || "???";
    };

    const getEnemyL10n = function (enemyId) {
        if (_enemiesI18n && _enemiesI18n[enemyId]) {
            return _enemiesI18n[enemyId];
        }
        return null;
    };

    // Some Enemies.json entries are pure organizational spacers used to divide
    // the database editor's list into level brackets (name "<-- 1-10 -->", note
    // <LevelBracket>). They are never assigned to any troop, so they should
    // never appear as a "discovered creature" - if one leaks into the
    // encountered list (e.g. via RevealEntries counting them as a reveal), it
    // occupies a slot in the bestiary list and throws off which card is which.
    const isDividerEnemy = function (enemy) {
        if (!enemy) return true;
        if (typeof enemy.name === "string" && enemy.name.startsWith("<--")) return true;
        if (/<LevelBracket>/i.test(enemy.note || "")) return true;
        return false;
    };

    // Default generation seed for the 3D portrait: the current world seed, so a
    // bestiary entry shows the creature as this world grew it. Falls back to the
    // canonical "esoteric" (baseline look) when no history seed exists yet.
    const worldGenSeed = function () {
        try {
            if (window.HistoryManager && typeof window.HistoryManager.getSeed === "function") {
                const s = window.HistoryManager.getSeed();
                if (s !== null && s !== undefined && s !== "") return String(s);
            }
        } catch (e) {}
        return "esoteric";
    };

    //=============================================================================
    // Game_System - For storing encountered monsters
    //=============================================================================
    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        _Game_System_initialize.call(this);
        this._usedMonstersInBattle = [];
        this._encounteredMonsters = [];
    };

    Game_System.prototype.encounteredMonsters = function () {
        if (!this._encounteredMonsters) this._encounteredMonsters = [];
        return this._encounteredMonsters;
    };

    Game_System.prototype.markMonsterAsEncountered = function (enemyId) {
        if (!this._encounteredMonsters) this._encounteredMonsters = [];
        if (!this._encounteredMonsters.includes(enemyId)) {
            this._encounteredMonsters.push(enemyId);
        }
    };

    Game_System.prototype.isMonsterEncountered = function (enemyId) {
        if ($gameSystem && $gameSystem._isSandboxMode) return true;
        if ($gameParty && $gameParty.leader() && $gameParty.leader().name() === "Test") return true; // i18n-ignore: playtest character name
        if ($gameActors && $gameActors.actor(1) && $gameActors.actor(1).name() === "Test") return true; // i18n-ignore: playtest character name
        return this.encounteredMonsters().includes(enemyId);
    };

    Game_System.prototype.resetUsedMonstersInBattle = function () {
        this._usedMonstersInBattle = [];
    };

    Game_System.prototype.markMonsterAsUsed = function (index) {
        if (!this._usedMonstersInBattle) this._usedMonstersInBattle = [];
        this._usedMonstersInBattle.push(index);
    };

    Game_System.prototype.isMonsterUsedInBattle = function (index) {
        if (!this._usedMonstersInBattle) this._usedMonstersInBattle = [];
        return this._usedMonstersInBattle.includes(index);
    };

    //=============================================================================
    // Register Plugin Commands
    //=============================================================================
    PluginManager.registerCommand(pluginName, "OpenBestiary", () => {
        SceneManager.push(Scene_CDCollection);
    });

    // Legacy command name kept for old events (Item: Bestiary).
    PluginManager.registerCommand(pluginName, "OpenCDCase", () => {
        SceneManager.push(Scene_CDCollection);
    });

    // Reveal a number of not-yet-discovered creatures (lowest enemy IDs first),
    // letting events grant bestiary knowledge as a reward without a battle.
    PluginManager.registerCommand(pluginName, "RevealEntries", args => {
        if (!$gameSystem) return;
        const amount = Math.max(0, parseInt(args.amount, 10) || 0);
        if (!amount) return;
        let revealed = 0;
        for (let id = 1; id < $dataEnemies.length && revealed < amount; id++) {
            const enemy = $dataEnemies[id];
            if (!enemy || enemy.id <= 0) continue;
            if (isDividerEnemy(enemy)) continue;
            if (!$gameSystem.encounteredMonsters().includes(id)) {
                $gameSystem.markMonsterAsEncountered(id);
                revealed++;
            }
        }
    });

    //=============================================================================
    // Add bestiary to Main Menu Command Lists
    //=============================================================================
    const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
    Window_MenuCommand.prototype.addOriginalCommands = function () {
        _Window_MenuCommand_addOriginalCommands.call(this);
        this.addCommand(T('Bestiary.bestiary'), 'bestiary', true, 294);
    };

    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function () {
        _Scene_Menu_createCommandWindow.call(this);
        this._commandWindow.setHandler('bestiary', this.commandBestiary.bind(this));
    };

    Scene_Menu.prototype.commandBestiary = function () {
        SceneManager.push(Scene_CDCollection);
    };

    //=============================================================================
    // Track enemy encounters to mark them as seen
    //=============================================================================
    const _Game_Enemy_setup = Game_Enemy.prototype.setup;
    Game_Enemy.prototype.setup = function (enemyId, x, y) {
        _Game_Enemy_setup.call(this, enemyId, x, y);
        if ($gameSystem) {
            $gameSystem.markMonsterAsEncountered(enemyId);
        }
    };

    const _Game_Troop_setup = Game_Troop.prototype.setup;
    Game_Troop.prototype.setup = function (troopId) {
        _Game_Troop_setup.call(this, troopId);
        this.members().forEach(enemy => {
            if (enemy) {
                $gameSystem.markMonsterAsEncountered(enemy.enemyId());
            }
        });
    };

    //=============================================================================
    // Scene_CDCollection (Parchment Codex Overlay)
    //=============================================================================
    class Scene_CDCollection extends Scene_MenuBase {
        isReady() {
            return _statsI18n !== null && _enemiesI18n !== null && super.isReady();
        }

        create() {
            super.create();

            // Deactivate and hide default canvas help windows
            if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }

            this._monsterList = [];
            this._selectedIndex = 0;
            this._activeTab = 0; // 0: Info, 1: Combat, 2: Ecology, 3: Drops
            this._activeArea = 'list'; // 'list' or 'tabs'
            this._pageTab = 0; // Left-page pockets: 0 = Earth, 1 = Aliens

            this._spriteAnimFrame = 1;
            this._spriteAnimTimer = 0;

            // Portrait view mode: 3D procedural model vs the 2D battler sketch.
            this._show3DBestiary = (typeof THREE !== 'undefined' && window.Battler3D && !!window.Battler3D.create);
            // Per-enemy generation seed for the 3D portrait (world seed by default,
            // re-rollable from the button under the viewport).
            this._bestiaryGenSeeds = {};

            this.buildUIBestiaryData();
            this.initUIBestiaryDOM();
            this.refreshUIBestiary();
        }

        update() {
            this.updateUIBestiaryInput();
            this.updateUIBestiarySpriteAnimations();
            super.update();
        }

        terminate() {
            if (this._intersectionObserver) {
                this._intersectionObserver.disconnect();
            }
            this.cleanupBestiary3D();
            const container = document.getElementById("bestiary-container");
            if (container) container.remove();
            super.terminate();
        }

        // =============================================================================
        // 3D portrait viewer (procedural Battler3D model with orbit / pan / zoom)
        // =============================================================================

        // Seed bucket for a pockets entry. Alien species share a base enemy for
        // stats and archetype, so key them on their own species id instead.
        bestiarySeedKey(mon) {
            if (!mon) return "0";
            return mon.speciesKey ? String(mon.speciesKey) : String(mon.id);
        }

        // Generation seed used for this entry's 3D portrait. Starts on the world
        // seed and only changes when the player re-rolls it.
        bestiaryGenSeed(key) {
            if (!this._bestiaryGenSeeds) this._bestiaryGenSeeds = {};
            if (this._bestiaryGenSeeds[key] == null) {
                this._bestiaryGenSeeds[key] = worldGenSeed();
            }
            return this._bestiaryGenSeeds[key];
        }

        randomizeBestiaryGenSeed(key) {
            if (!this._bestiaryGenSeeds) this._bestiaryGenSeeds = {};
            this._bestiaryGenSeeds[key] = String(1 + Math.floor(Math.random() * 0x7ffffffe));
            return this._bestiaryGenSeeds[key];
        }

        initBestiary3D(enemyData, archKey, seedKey) {
            this.cleanupBestiary3D();
            if (typeof THREE === 'undefined' || !window.Battler3D || !window.Battler3D.create) return;
            const canvas = document.getElementById('bestiary-3d-canvas');
            if (!canvas) return;

            const rect   = canvas.getBoundingClientRect();
            const width  = Math.max(1, Math.round(rect.width)  || 320);
            const height = Math.max(1, Math.round(rect.height) || 320);

            const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
            renderer.setSize(width, height, false);
            // Render at 1:1 device pixels. This is a small preview, so the hi-DPI
            // multiplier (up to 4x the fragment work on Retina screens) is the
            // single biggest cost here and buys almost nothing visually.
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
            this._bestiary3D = state;

            // Fake battler so the model uses its deterministic per-id look.
            const fakeBattler = { enemyId: () => enemyData.id, index: () => 0 };
            // Build under this entry's generation seed (world seed unless the
            // player re-rolled it). All seeded draws happen in the constructor, so
            // the global seed is restored immediately after create.
            const entrySeed = this.bestiaryGenSeed(seedKey != null ? seedKey : String(enemyData.id));
            const prevGenSeed = window.Battler3D.getGenSeed ? window.Battler3D.getGenSeed() : null;
            if (window.Battler3D.setGenSeed) window.Battler3D.setGenSeed(entrySeed);
            const battler = window.Battler3D.create(archKey, 0, 0, fakeBattler);
            if (window.Battler3D.setGenSeed && prevGenSeed != null) window.Battler3D.setGenSeed(prevGenSeed);
            if (!battler) {
                try { renderer.dispose(); } catch (e) {}
                try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) {}
                this._bestiary3D = null;
                return;
            }

            Promise.resolve(battler.load(null, 0, 0, 0)).then(() => {
                if (state.disposed || !battler.model) return;
                try { battler.update(1 / 60); } catch (e) {}
                const box    = new THREE.Box3().setFromObject(battler.model);
                const size   = new THREE.Vector3(); box.getSize(size);
                const center = new THREE.Vector3(); box.getCenter(center);
                // Carry the centring offset on a parent holder rather than on the
                // model itself. The family idle animations rewrite
                // model.position.{x,y} every frame with an absolute value
                // (baseY + bob), so subtracting `center` straight from
                // model.position would be undone on the very next update() and the
                // model would drift off-centre (forcing a manual pan to recentre).
                // Offsetting the holder leaves the model's local position free for
                // the animation while pinning its geometric centre to the pivot
                // origin the camera looks at.
                const holder = new THREE.Group();
                holder.position.copy(center).multiplyScalar(-1);
                holder.add(battler.model);
                if (window.PSXShader) window.PSXShader.applyToObject(battler.model);
                pivot.add(holder);
                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                const fitDist = maxDim / (2 * Math.tan((40 * Math.PI / 180) / 2));
                // Frame the model large in the viewport. The holder offset above
                // puts the model dead-centre at the origin; aim the camera straight
                // at it so it stays centred for every body plan, and keep a small
                // margin so the attack lunge never pushes it past the edge.
                camera.position.set(0, 0, fitDist * 1.2);
                camera.lookAt(0, 0, 0);
                state.model = battler;
                state.attackTimer = 1.2; // first attack shortly after it appears
            }).catch(() => {});

            // ── Mouse / touch controls (mirror the equipment 3D preview) ─────────
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

            const FRAME = 1 / 30; // cap the preview to ~30fps to halve GPU/CPU work
            const animate = () => {
                if (state.disposed) return;
                state.rafId = requestAnimationFrame(animate);
                state.frameAcc += Math.min(state.clock.getDelta(), 0.05);
                if (state.frameAcc < FRAME) return;
                const dt = state.frameAcc;
                state.frameAcc = 0;
                if (state.model) {
                    // Periodically trigger a one-shot combat animation so the entry
                    // shows the creature attacking (alternating skill / special).
                    state.attackTimer -= dt;
                    if (state.attackTimer <= 0 && state.model.currentAnimation === 'idle') {
                        const anim = (state.model.hasAnimation('specialattack') && Math.random() < 0.4)
                            ? 'specialattack' : 'attack';
                        try { state.model.playAnimation(anim, false); } catch (e) {}
                        state.attackTimer = 2.4 + Math.random() * 1.6;
                    }
                    try { state.model.update(dt); } catch (e) {}
                }
                // No automatic spin: the model holds its facing until the user drags.
                if (window.PSXShader) {
                    window.PSXShader.render(renderer, scene, camera);
                } else {
                    renderer.render(scene, camera);
                }
            };
            animate();
        }

        cleanupBestiary3D() {
            const s = this._bestiary3D;
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
            // dispose() leaves the WebGL context alive. The browser caps live
            // contexts and force-loses the OLDEST past the cap, which is the
            // game's own canvas: PIXI then silently stops rendering and the
            // picture freezes until the game is restarted. Release it, then swap
            // in a clean canvas node, since the element a context was lost on
            // can never host a new one.
            try { s.renderer.dispose(); } catch (e) {}
            try { if (s.renderer.forceContextLoss) s.renderer.forceContextLoss(); } catch (e) {}
            if (c && c.parentNode) c.parentNode.replaceChild(c.cloneNode(false), c);
            this._bestiary3D = null;
        }

        buildUIBestiaryData() {
            // Earth tab: encountered hardcoded enemies. Alien tab: discovered
            // procedural species (each keyed to a base enemy for stats/look but
            // shown under its procedural name).
            this._earthList = [];
            const allEnemies = $dataEnemies.filter(enemy => enemy && enemy.id > 0 && !isDividerEnemy(enemy));
            allEnemies.forEach(enemy => {
                if ($gameSystem.isMonsterEncountered(enemy.id)) {
                    const l10n = getEnemyL10n(enemy.id);
                    const noteData = this.parseMonsterNotes(enemy.note, enemy.id);
                    this._earthList.push({
                        id: enemy.id,
                        name: l10n ? l10n.name : enemy.name,
                        battlerName: enemy.battlerName,
                        character: noteData.character,
                        enemy: enemy,
                        noteData: noteData
                    });
                }
            });

            this._alienList = [];
            const disc = (window.GalaxySim && window.GalaxySim.getDiscoveredAlienSpecies)
                ? window.GalaxySim.getDiscoveredAlienSpecies() : [];
            disc.forEach(sp => {
                const enemy = $dataEnemies[sp.enemyId];
                if (!enemy || isDividerEnemy(enemy)) return;
                const noteData = this.parseMonsterNotes(enemy.note, sp.enemyId);
                this._alienList.push({
                    id: sp.enemyId,
                    name: sp.name,
                    battlerName: enemy.battlerName,
                    character: noteData.character,
                    enemy: enemy,
                    noteData: noteData,
                    isAlien: true,
                    speciesKey: sp.key
                });
            });

            if (this._pageTab == null) this._pageTab = 0;
            this._monsterList = this._pageTab === 1 ? this._alienList : this._earthList;
        }

        // Switch the left-page pockets between Earth and Alien species. Forces the
        // cached list DOM to rebuild for the newly active tab.
        switchBestiaryPageTab(tab) {
            if (tab === this._pageTab) return;
            this._pageTab = tab;
            this._selectedIndex = 0;
            this.buildUIBestiaryData();
            const vp = document.getElementById("bestiary-list-viewport");
            if (vp) vp.innerHTML = "";
            if (window.SoundManager) SoundManager.playCursor();
            this.refreshUIBestiary();
        }

        initUIBestiaryDOM() {
            if (!document.getElementById("bestiary-container")) {
                const container = document.createElement("div");
                container.id = "bestiary-container";
                document.body.appendChild(container);
            }
        }

        refreshUIBestiary() {
            const container = document.getElementById("bestiary-container");
            if (!container) return;

            // 1. Build the high-level double-page layout frame once if not already present
            if (!document.getElementById("bestiary-layout")) {
                container.innerHTML = `
                    <div class="book-spread" id="bestiary-layout">
                        <div class="left-page">
                            <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #5e2f17; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
                              <div class="back-button focusable">
                                ${T('Bestiary.back')}
                              </div>

                              <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${T('Bestiary.bestiary')}</h2>
                            </div>
                            <div id="bestiary-page-tabs" style="display:flex; gap:8px; justify-content:center; margin-bottom:12px;">
                              <div class="bestiary-page-tab focusable" data-page="0" style="cursor:pointer; padding:4px 14px; border:1px solid #5e2f17; border-radius:4px; font-weight:bold;">${T('Bestiary.earth')}</div>
                              <div class="bestiary-page-tab focusable" data-page="1" style="cursor:pointer; padding:4px 14px; border:1px solid #5e2f17; border-radius:4px; font-weight:bold;">${T('Bestiary.aliens')}</div>
                            </div>
                            <div class="list-viewport" id="bestiary-list-viewport"></div>
                        </div>

                        <div class="right-page">
                            <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #5e2f17; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
                              <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${T('Bestiary.speciesPortfolio')}</h2>
                            </div>
                            <div id="bestiary-portfolio-container" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"></div>
                        </div>
                    </div>
                `;

                // Bind back button handler
                const backBtn = container.querySelector(".back-button");
                if (backBtn) {
                    backBtn.addEventListener("click", () => {
                        SoundManager.playCancel();
                        SceneManager.pop();

                    });
                }

                // Wheel scroll on list viewport regardless of focus
                container.addEventListener("wheel", (e) => {
                    e.preventDefault();
                    const viewport = document.getElementById("bestiary-list-viewport");
                    if (viewport) viewport.scrollTop += e.deltaY;
                }, { passive: false });

                // Earth / Aliens page-tab clicks (wired once on the persistent layout).
                container.querySelectorAll(".bestiary-page-tab").forEach(tabEl => {
                    tabEl.addEventListener("click", () => {
                        this.switchBestiaryPageTab(parseInt(tabEl.getAttribute("data-page"), 10));
                    });
                });
            }

            // Reflect the active page tab styling every refresh.
            document.querySelectorAll("#bestiary-page-tabs .bestiary-page-tab").forEach(tabEl => {
                const active = parseInt(tabEl.getAttribute("data-page"), 10) === this._pageTab;
                tabEl.style.background = active ? "#5e2f17" : "transparent";
                tabEl.style.color = active ? "#f0e0c0" : "#5e2f17";
            });

            // 2. Build the left scrollable pockets cards once
            const listViewport = document.getElementById("bestiary-list-viewport");
            if (listViewport && listViewport.children.length === 0) {
                let leftListHTML = "";
                if (this._monsterList.length === 0) {
                    leftListHTML = `
                        <div class="bestiary-list-empty">
                            ${T('Bestiary.noMonstersEncountered')}
                        </div>
                    `;
                } else {


                    this._selectedIndex = Math.max(0, Math.min(this._monsterList.length - 1, this._selectedIndex));

                    this._monsterList.forEach((mon, idx) => {
                        const levelBadge = mon.noteData.level ? `LV: ${mon.noteData.level}` : "";
                        const archetype = mon.noteData.archetype ? `| ${mon.noteData.archetype}` : "";

                        leftListHTML += `
                            <div class="monster-card" id="monster-card-${idx}" data-idx="${idx}">
                                <div class="monster-sprite-frame">
                                    <canvas class="monster-sprite-canvas" id="bestiary-canvas-${idx}" data-idx="${idx}" width="32" height="32"></canvas>
                                </div>
                                <div class="monster-meta">
                                    <span class="monster-name">${mon.name}</span>
                                    <span class="monster-subtitle">${levelBadge} ${archetype}</span>
                                </div>
                            </div>
                        `;
                    });
                }

                listViewport.innerHTML = leftListHTML;

                // Bind card click handlers
                const cards = listViewport.querySelectorAll(".monster-card");
                cards.forEach(card => {
                    card.addEventListener("click", () => {
                        const idx = parseInt(card.getAttribute("data-idx"));
                        this._selectedIndex = idx;
                        this._activeArea = 'list';
                        SoundManager.playOk();
                        this.refreshUIBestiary();
                    });
                });

                // Set up Intersection Observer for scroll-based dynamic canvas loading
                this.setupUIBestiaryIntersectionObserver();
            }

            // 3. Update left list card active classes dynamically (no DOM recreation)
            if (this._monsterList.length > 0) {
                this._monsterList.forEach((mon, idx) => {
                    const card = document.getElementById(`monster-card-${idx}`);
                    if (card) {
                        const isSelected = idx === this._selectedIndex;
                        const isFocused = isSelected && this._activeArea === 'list';

                        if (isSelected) {
                            card.classList.add("selected");
                        } else {
                            card.classList.remove("selected");
                        }
                        if (isFocused) {
                            card.classList.add("focused");
                        } else {
                            card.classList.remove("focused");
                        }
                    }
                });
            }

            // 4. Re-render only the right page portfolio (Creature Lexicon Tab Details)
            const portfolioContainer = document.getElementById("bestiary-portfolio-container");
            if (portfolioContainer) {
                let rightPageHTML = "";
                if (this._monsterList.length > 0) {
                    const mon = this._monsterList[this._selectedIndex];
                    const enemy = mon.enemy;
                    const noteData = mon.noteData;

                    // Resolve a procedural 3D archetype for this enemy (if any).
                    const archKey = (window.Battler3D && window.Battler3D.resolveKey)
                        ? window.Battler3D.resolveKey(enemy) : null;
                    const can3D = this._show3DBestiary && !!archKey;

                    // Portfolio Header info
                    const levelBadge = noteData.level ? `LV: ${noteData.level}` : "LV: ??";
                    const archBadge = noteData.archetype ? `<span class="badge">${noteData.archetype}</span>` : "";

                    // Render tabs
                    const tabs = [
                        T('Bestiary.lexicon'),
                        T('Bestiary.vitality'),
                        T('Bestiary.ecology'),
                        T('Bestiary.extraction')
                    ];
                    let tabsHTML = `<div class="portfolio-tabs">`;
                    tabs.forEach((tab, idx) => {
                        const activeClass = idx === this._activeTab ? "active" : "";
                        const focusedClass = (idx === this._activeTab && this._activeArea === 'tabs') ? "focused" : "";
                        tabsHTML += `<div class="portfolio-tab ${activeClass} ${focusedClass}" data-tab="${idx}">${tab}</div>`;
                    });
                    tabsHTML += `</div>`;

                    // Render active tab contents
                    let contentHTML = "";
                    if (this._activeTab === 0) {
                        // Tab 0: Lexicon / Portrait & Info
                        let imgHTML = `
                            <div style="font-size:40px; color:rgba(94,47,23,0.3); font-style:italic;">${T('Bestiary.drawing')}</div>
                        `;

                        if (enemy.battlerName) {
                            const path = `img/enemies/${enemy.battlerName}.png`;
                            imgHTML = `<img class="portrait-sketch-image" src="${path}" />`;
                        }

                        // 3D/2D toggle (only when a procedural archetype exists).
                        let toggleHTML = "";
                        if (archKey) {
                            const label = can3D
                                ? (T('Bestiary.3dModel'))
                                : (T('Bestiary.2dSketch'));
                            toggleHTML = `<button id="bestiary-3d-toggle" style="position:absolute; top:8px; right:8px; z-index:5; cursor:pointer; padding:4px 10px; font-family:inherit; font-size:12px; font-weight:bold; color:#5e2f17; background:rgba(244,232,208,0.92); border:1.5px solid #5e2f17; border-radius:4px;"><span style="margin-right:4px;">&#x21c4;</span>${label}</button>`;
                        }

                        const portraitInner = can3D
                            ? `<canvas id="bestiary-3d-canvas" style="width:100%; height:100%; min-height:380px; display:block; cursor:grab;"></canvas>`
                            : imgHTML;

                        const hintHTML = can3D
                            ? `<div class="bestiary-3d-hint" style="text-align:center; font-size:11px; color:rgba(94,47,23,0.55); margin-top:2px;">${T('Bestiary.dragToRotateWheelTo')}</div>`
                            : "";

                        // Seed re-roll: shows the seed this specimen was grown from
                        // (the world seed until the player rolls a new one).
                        const seedHTML = can3D
                            ? `<div style="display:flex; justify-content:center; align-items:center; gap:8px; margin-top:6px;">
                                   <button id="bestiary-seed-reroll" style="cursor:pointer; padding:4px 10px; font-family:inherit; font-size:12px; font-weight:bold; color:#5e2f17; background:rgba(244,232,208,0.92); border:1.5px solid #5e2f17; border-radius:4px;"><span style="margin-right:4px;">&#x2684;</span>${T('Bestiary.randomizeSeed')}</button>
                                   <span style="font-size:11px; color:rgba(94,47,23,0.6); font-style:italic;">${T('Bestiary.seed')}: ${this.bestiaryGenSeed(this.bestiarySeedKey(mon))}</span>
                               </div>`
                            : "";

                        // The live 3D model gets a larger, transparent viewport (no
                        // dark inset gradient) so the bigger battler reads against the
                        // parchment page; the 2D sketch keeps the framed look.
                        const sketchStyle = can3D
                            ? "position:relative; height:380px; background:transparent; box-shadow:none; border-color:rgba(94,47,23,0.22);"
                            : "position:relative;";

                        contentHTML = `
                            <div class="portrait-sketch" style="${sketchStyle}">
                                ${toggleHTML}
                                ${portraitInner}
                            </div>
                            ${hintHTML}
                            ${seedHTML}
                            <p class="portfolio-description">${noteData.description || (T('Bestiary.noBiologicalDescriptionRegistered'))}</p>
                        `;
                    } else if (this._activeTab === 1) {
                        // Tab 1: Vitality / Stats & Elemental Affinities
                        const params = enemy.params || [0, 0, 0, 0, 0, 0, 0, 0];

                        let statsGridHTML = `<div class="stats-grid">`;
                        for (let i = 0; i < 8; i++) {




                            statsGridHTML += `
                                <div class="stat-card">
                                    <span class="stat-label">${getShortParamName(i)}</span>
                                    <span class="stat-val">${params[i]}</span>
                                </div>
                            `;
                        }
                        statsGridHTML += `</div>`;





                        // Calculate active element rate weaknesses
                        const elements = T.list('Bestiary.elements');
                        const rates = {};
                        for (let i = 1; i < elements.length; i++) {
                            rates[i] = 1.0;
                        }
                        if (enemy.traits) {
                            enemy.traits.forEach(trait => {
                                if (trait.code === 11) { // Element Rate
                                    const elId = trait.dataId;
                                    if (rates[elId] !== undefined) {
                                        rates[elId] *= trait.value;
                                    }
                                }
                            });
                        }

                        let affinitiesGridHTML = "";
                        const activeRates = [];
                        for (let i = 1; i < elements.length; i++) {
                            if (rates[i] !== 1.0) {
                                activeRates.push({ name: elements[i], rate: rates[i] });
                            }
                        }

                        if (activeRates.length > 0) {
                            affinitiesGridHTML += `
                                <h4 class="affinities-header">${T('Bestiary.elementalAffinities')}</h4>
                                <div class="affinities-grid">
                            `;
                            activeRates.forEach(obj => {
                                const valClass = obj.rate > 1.0 ? "weakness" : "resistance";
                                const formattedRate = obj.rate + "x";
                                affinitiesGridHTML += `
                                    <div class="affinity-row">
                                        <span style="font-weight:bold; color:#8c7667;">${obj.name}</span>
                                        <span class="affinity-val ${valClass}">${formattedRate}</span>
                                    </div>
                                `;
                            });
                            affinitiesGridHTML += `</div>`;
                        } else {
                            affinitiesGridHTML += `
                                <h4 class="affinities-header">${T('Bestiary.elementalAffinities')}</h4>
                                <p style="font-size:12px; color:rgba(94,47,23,0.5); font-style:italic;">${T('Bestiary.noElementalWeaknessOrResistance')}</p>
                            `;
                        }

                        contentHTML = `
                            ${statsGridHTML}
                            ${affinitiesGridHTML}
                        `;
                    } else if (this._activeTab === 2) {
                        // Tab 2: Ecology / Biology specs list
                        let speedText = noteData.speed || "3";
                        const speedVal = parseInt(speedText);
                        if (speedVal <= 1) speedText = T('Bestiary.slower');
                        else if (speedVal === 2) speedText = T('Bestiary.slow');
                        else if (speedVal === 3) speedText = T('Bestiary.normal');
                        else if (speedVal === 4) speedText = T('Bestiary.fast');
                        else if (speedVal >= 5) speedText = T('Bestiary.faster');

                        const abilities = [];
                        if (noteData.talk) abilities.push(T('Bestiary.talk'));
                        if (noteData.climb) abilities.push(T('Bestiary.climb'));
                        if (noteData.floating) abilities.push(T('Bestiary.floating'));
                        const abilitiesText = abilities.length > 0 ? abilities.join(", ") : (T('Bestiary.none'));

                        // Behavioral role (Predator/Hunter/Prey/Neutral) with color coding
                        // Keys are the <Predator>/<Hunter>/... note tags; the word
                        // comes from Bestiary.behavior.<id>.
                        const behaviorMap = {
                            Predator: { key: "Bestiary.behavior.predator", color: "#8c1d0f" },
                            Hunter:   { key: "Bestiary.behavior.hunter",   color: "#b5651d" },
                            Prey:     { key: "Bestiary.behavior.prey",     color: "#27ae60" },
                            Neutral:  { key: "Bestiary.behavior.neutral",  color: "#5e6b7a" }
                        };
                        const behaviorInfo = noteData.behavior ? behaviorMap[noteData.behavior] : null;
                        const behaviorText = behaviorInfo
                            ? `<span style="font-weight:bold; color:${behaviorInfo.color};">${T(behaviorInfo.key)}</span>`
                            : (T('Bestiary.unknown'));

                        // The 3 nations where this enemy is most commonly found,
                        // derived from the shared nation-seeded spawn frequency.
                        const bseHelpers = window.BattleSystemEnhanced && window.BattleSystemEnhanced.Helpers;
                        let rangeText = T('Bestiary.unknown');
                        if (bseHelpers && bseHelpers.getTopNationsForEnemy) {
                            const nations = bseHelpers.getTopNationsForEnemy(enemy.id, 3);
                            if (nations.length > 0) rangeText = nations.map(n => n.name).join(", ");
                        }

                        contentHTML = `
                            <div class="ecology-list">
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.trophicRole')}</span>
                                    <span class="ecology-val">${behaviorText}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.naturalHabitat')}</span>
                                    <span class="ecology-val">${window.BiomeNames.displayList(noteData.biome) || T('Bestiary.proceduralWorld')}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.commonTerritories')}</span>
                                    <span class="ecology-val">${rangeText}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.dailyCycle')}</span>
                                    <span class="ecology-val">${noteData.timeOfDay ? ecologyLabel('activity', noteData.timeOfDay) : T('Bestiary.fluid')}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.bloodComposition')}</span>
                                    <span class="ecology-val">${noteData.bloodType ? ecologyLabel('blood', noteData.bloodType) : T('Bestiary.redStandard')}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.weightMass')}</span>
                                    <span class="ecology-val">${noteData.weight || T('Bestiary.unknownWeight')}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.relativeSpeed')}</span>
                                    <span class="ecology-val">${speedText}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.locomotion')}</span>
                                    <span class="ecology-val">${noteData.movement || (T('Bestiary.terrestrial'))}</span>
                                </div>
                                <div class="ecology-row">
                                    <span class="ecology-lbl">${T('Bestiary.inherentAttributes')}</span>
                                    <span class="ecology-val">${abilitiesText}</span>
                                </div>
                            </div>
                        `;
                    } else if (this._activeTab === 3) {
                        // Tab 3: Drops / Reagents harvesting, rewards and actions
                        let spoilsHTML = `
                            <div class="drops-section">
                                <h4 class="affinities-header">${T('Bestiary.rewards')}</h4>
                                <div style="display:flex; justify-content:space-between; padding:4px 8px; font-size:13px; font-weight:bold;">
                                    <span>${T('Bestiary.exp')}: <span style="color:#8c1d0f;">${enemy.exp}</span></span>
                                    <span>${T('Bestiary.gold')}: <span style="color:#27ae60;">${enemy.gold / 100} €</span></span>
                                </div>
                            </div>
                        `;

                        // Drops harvest
                        let dropsHTML = `<div class="drops-section"><h4 class="affinities-header">${T('Bestiary.harvestableReagents')}</h4>`;
                        const drops = enemy.dropItems.filter(drop => drop.kind > 0);
                        if (drops.length > 0) {
                            drops.forEach(drop => {
                                let item = null;
                                if (drop.kind === 1) item = $dataItems[drop.dataId];
                                if (drop.kind === 2) item = $dataWeapons[drop.dataId];
                                if (drop.kind === 3) item = $dataArmors[drop.dataId];

                                if (item) {
                                    const chance = Math.floor(100 / drop.denominator);
                                    const iconIdx = item.iconIndex;
                                    const iconStyle = `
                                        background: url('img/system/IconSet.png') -${(iconIdx % 16) * 24}px -${Math.floor(iconIdx / 16) * 24}px no-repeat;
                                    `;
                                    const rarity = window.ItemSystemUtils.getItemRarity(item);

                                    dropsHTML += `
                                        <div class="harvest-row">
                                            <div class="harvest-meta">
                                                <span class="harvest-icon" style="${iconStyle}"></span>
                                                <span class="harvest-name" style="color: ${rarity.colorCode}">${item.name}</span>
                                            </div>
                                            <span class="harvest-chance">${T('Bestiary.harvestChance', { chance: chance })}</span>
                                        </div>
                                    `;
                                }
                            });
                        } else {
                            dropsHTML += `<p style="font-size:12px; color:rgba(94,47,23,0.5); font-style:italic;">${T('Bestiary.noExtractableReagents')}</p>`;
                        }
                        dropsHTML += `</div>`;

                        // Action skills
                        let actionsHTML = `<div class="drops-section"><h4 class="affinities-header">${T('Bestiary.combatAbilities')}</h4>`;
                        const actions = enemy.actions || [];
                        if (actions.length > 0) {
                            const skillIds = [...new Set(actions.map(a => a.skillId))];
                            skillIds.forEach(id => {
                                const skill = $dataSkills[id];
                                if (skill) {
                                    const iconIdx = skill.iconIndex;
                                    const iconStyle = `
                                        background: url('img/system/IconSet.png') -${(iconIdx % 16) * 24}px -${Math.floor(iconIdx / 16) * 24}px no-repeat;
                                    `;
                                    actionsHTML += `
                                        <div class="harvest-row">
                                            <div class="harvest-meta">
                                                <span class="harvest-icon" style="${iconStyle}"></span>
                                                <span class="harvest-name" style="font-weight:bold;">${skill.name}</span>
                                            </div>
                                        </div>
                                    `;
                                }
                            });
                        } else {
                            actionsHTML += `<p style="font-size:12px; color:rgba(94,47,23,0.5); font-style:italic;">${T('Bestiary.noCombatAbilitiesRegistered')}</p>`;
                        }
                        actionsHTML += `</div>`;

                        contentHTML = `
                            ${spoilsHTML}
                            ${dropsHTML}
                            ${actionsHTML}
                        `;
                    }

                    rightPageHTML = `
                        <div class="portfolio">
                            <div class="portfolio-header">
                                <span class="portfolio-name">${mon.name}</span>
                                <div class="portfolio-badges">
                                    <span class="badge">${levelBadge}</span>
                                    ${archBadge}
                                </div>
                            </div>
                            ${tabsHTML}
                            <div class="portfolio-content">
                                ${contentHTML}
                            </div>
                        </div>
                    `;
                } else {
                    rightPageHTML = `<div style="flex:1;"></div>`;
                }

                // Tear down any previous 3D viewer before its canvas is removed.
                this.cleanupBestiary3D();
                portfolioContainer.innerHTML = rightPageHTML;

                // Bind tabs click dynamically (only on newly drawn tab elements)
                const tabElList = portfolioContainer.querySelectorAll(".portfolio-tab");
                tabElList.forEach(tab => {
                    tab.addEventListener("click", () => {
                        const tabId = parseInt(tab.getAttribute("data-tab"));
                        this._activeTab = tabId;
                        this._activeArea = 'tabs';
                        SoundManager.playOk();
                        this.refreshUIBestiary();
                    });
                });

                // Bind the 3D/2D toggle and spin up the live model on the Info tab.
                if (this._monsterList.length > 0) {
                    const toggleBtn = portfolioContainer.querySelector("#bestiary-3d-toggle");
                    if (toggleBtn) {
                        toggleBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            SoundManager.playOk();
                            this._show3DBestiary = !this._show3DBestiary;
                            this.refreshUIBestiary();
                        });
                    }
                    const mon2 = this._monsterList[this._selectedIndex];
                    const seedKey2 = this.bestiarySeedKey(mon2);
                    const rerollBtn = portfolioContainer.querySelector("#bestiary-seed-reroll");
                    if (rerollBtn) {
                        rerollBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            SoundManager.playOk();
                            this.randomizeBestiaryGenSeed(seedKey2);
                            this.refreshUIBestiary();
                        });
                    }
                    const archKey2 = (window.Battler3D && window.Battler3D.resolveKey)
                        ? window.Battler3D.resolveKey(mon2.enemy) : null;
                    if (this._activeTab === 0 && this._show3DBestiary && archKey2) {
                        this.initBestiary3D(mon2.enemy, archKey2, seedKey2);
                    }
                }
            }

            // 5. Draw canvas walking graphic for the selected row right away
            if (this._monsterList.length > 0) {
                this.drawUIBestiaryCanvas(this._selectedIndex);
            }
        }

        // =============================================================================
        // Dynamic Intersection Observer Scroll Loader
        // =============================================================================
        setupUIBestiaryIntersectionObserver() {
            if (this._intersectionObserver) {
                this._intersectionObserver.disconnect();
            }

            // Create IntersectionObserver to dynamically draw canvases only when visible in viewport
            this._intersectionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const canvas = entry.target;
                        const idx = parseInt(canvas.getAttribute("data-idx"));
                        this.drawUIBestiaryCanvas(idx);
                    }
                });
            }, {
                root: document.getElementById("bestiary-list-viewport"),
                rootMargin: "50px", // Preload slightly before scrolling into viewport
                threshold: 0.05
            });

            // Observe all card canvases
            const canvases = document.querySelectorAll(".monster-sprite-canvas");
            canvases.forEach(canvas => {
                this._intersectionObserver.observe(canvas);
            });
        }

        // Helper to draw walking animation frames to character canvas
        drawUIBestiaryCanvas(idx) {
            const canvas = document.getElementById(`bestiary-canvas-${idx}`);
            if (!canvas) return;

            const mon = this._monsterList[idx];
            if (!mon) return;

            const charName = mon.character;
            if (charName) {
                const bitmap = ImageManager.loadCharacter('Monsters/' + charName);
                bitmap.addLoadListener(() => {
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;

                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.imageSmoothingEnabled = false;

                    const isSingle = charName.startsWith('$');
                    let pw, ph;
                    if (isSingle) {
                        pw = bitmap.width / 3;
                        ph = bitmap.height / 4;
                    } else {
                        pw = bitmap.width / 12;
                        ph = bitmap.height / 8;
                    }

                    const isSelected = idx === this._selectedIndex;
                    let patternFrame = 1; // Stand frame
                    if (isSelected) {
                        patternFrame = this._spriteAnimFrame;
                    }

                    const sx = patternFrame * pw;
                    const sy = 0; // Direction row: Facing down

                    ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, 0, 0, canvas.width, canvas.height);
                });
            } else {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = 'rgba(94,47,23,0.3)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }
        }

        // Cycle 4-frame character walking animation
        updateUIBestiarySpriteAnimations() {
            this._spriteAnimTimer++;
            if (this._spriteAnimTimer >= 15) {
                this._spriteAnimTimer = 0;

                const frames = [0, 1, 2, 1];
                const curIdx = frames.indexOf(this._spriteAnimFrame);
                const nextIdx = (curIdx + 1) % 4;
                this._spriteAnimFrame = frames[nextIdx];

                // Redraw character canvas of only the selected row for performance
                if (this._monsterList.length > 0) {
                    this.drawUIBestiaryCanvas(this._selectedIndex);
                }
            }
        }

        // =============================================================================
        // Keyboard & Gamepad navigation inputs
        // =============================================================================
        updateUIBestiaryInput() {
            if (this._monsterList.length === 0) {
                if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    this.popScene();
                    SoundManager.playCancel();
                }
                return;
            }

            // L1/R1 cycle the right-page detail tabs from anywhere in the scene
            if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
                const dir = Input.isTriggered('pageup') ? -1 : 1;
                this._activeTab = (this._activeTab + dir + 4) % 4;
                SoundManager.playCursor();
                this.refreshUIBestiary();
                return;
            }

            if (this._activeArea === 'list') {
                if (Input.isRepeated('down')) {
                    this._selectedIndex = (this._selectedIndex + 1) % this._monsterList.length;
                    SoundManager.playCursor();
                    this.refreshUIBestiary();

                    const container = document.getElementById("bestiary-container");
                    if (container) {
                        const focused = container.querySelector(".monster-card.focused");
                        if (focused) focused.scrollIntoView({ block: "nearest" });
                    }
                } else if (Input.isRepeated('up')) {
                    this._selectedIndex = (this._selectedIndex - 1 + this._monsterList.length) % this._monsterList.length;
                    SoundManager.playCursor();
                    this.refreshUIBestiary();

                    const container = document.getElementById("bestiary-container");
                    if (container) {
                        const focused = container.querySelector(".monster-card.focused");
                        if (focused) focused.scrollIntoView({ block: "nearest" });
                    }
                } else if (Input.isRepeated('left')) {
                    this._activeArea = 'tabs';
                    this._activeTab = 3; // Focus rightmost tab (Extraction) on left page
                    SoundManager.playOk();
                    this.refreshUIBestiary();
                } else if (Input.isTriggered('ok')) {
                    this._activeArea = 'tabs';
                    this._activeTab = 0; // Focus first tab (Lexicon) on left page
                    SoundManager.playOk();
                    this.refreshUIBestiary();
                } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    this.popScene();
                    SoundManager.playCancel();
                }
            } else if (this._activeArea === 'tabs') {
                if (Input.isRepeated('right')) {
                    if (this._activeTab === 3) {
                        this._activeArea = 'list';
                    } else {
                        this._activeTab = (this._activeTab + 1) % 4;
                    }
                    SoundManager.playCursor();
                    this.refreshUIBestiary();
                } else if (Input.isRepeated('left')) {
                    this._activeTab = (this._activeTab - 1 + 4) % 4;
                    SoundManager.playCursor();
                    this.refreshUIBestiary();
                } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    this._activeArea = 'list';
                    SoundManager.playCancel();
                    this.refreshUIBestiary();
                }
            }
        }

        // Notes parsed fields helper
        parseMonsterNotes(notes, enemyId) {
            const result = {
                level: null, description: null, character: null, archetype: null, biome: null,
                timeOfDay: null, bloodType: null, rarity: null, weight: null,
                speed: null, movement: null, talk: false, climb: false, floating: false,
                behavior: null
            };







            if (enemyId) {
                const l10n = getEnemyL10n(enemyId);
                const lang = ConfigManager.language || 'en';
                // English descriptions use combinatorial {a | b | c} inline text
                // resolved (seeded from the world seed) by EnemyDescription. Other
                // languages keep their i18n/<lang>/enemies.json translation.
                let desc = null;
                if (window.EnemyDescription && lang === 'en') {
                    desc = window.EnemyDescription.describe(enemyId);
                }
                if (!desc && l10n && l10n.description) {
                    desc = l10n.description;
                }
                if (desc) result.description = desc;
            }

            if (!notes) return result;

            const levelMatch = notes.match(/<Level:\s*(\d+)>/i);
            if (levelMatch) result.level = levelMatch[1];

            const charMatch = notes.match(/<Char:\s*([^>]+)>/i);
            if (charMatch) result.character = charMatch[1].trim();

            const archetypeMatch = notes.match(/<Archetype:\s*([^>]+)>/i);
            if (archetypeMatch) result.archetype = archetypeMatch[1].trim();

            const biomeMatch = notes.match(/<Biome:\s*([^>]+)>/i);
            if (biomeMatch) result.biome = biomeMatch[1].trim();

            // i18n-ignore-start: note-tag ids, named by ecologyLabel() on render
            if (notes.match(/<Nocturnal>/i)) result.timeOfDay = "Nocturnal";
            else if (notes.match(/<Diurnal>/i)) result.timeOfDay = "Diurnal";
            else if (notes.match(/<Crepuscular>/i)) result.timeOfDay = "Crepuscular";

            if (notes.match(/<GreenBlood>/i)) result.bloodType = "Green";
            else if (notes.match(/<BlueBlood>/i)) result.bloodType = "Blue";
            else if (notes.match(/<BlackBlood>/i)) result.bloodType = "Black";
            else if (notes.match(/<NoBlood>/i)) result.bloodType = "None";
            // i18n-ignore-end

            const rarityMatch = notes.match(/<Rarity:\s*([^>]+)>/i);
            if (rarityMatch) result.rarity = rarityMatch[1].trim();

            const weightMatch = notes.match(/<Weight:\s*([^>]+)>/i);
            if (weightMatch) result.weight = weightMatch[1].trim();

            const speedMatch = notes.match(/<Speed:\s*(\d+)>/i);
            if (speedMatch) result.speed = speedMatch[1];

            const movementMatch = notes.match(/<Movement:\s*([^>]+)>/i);
            if (movementMatch) result.movement = movementMatch[1].trim();

            if (notes.match(/<Talk>/i)) result.talk = true;
            if (notes.match(/<Climb>/i)) result.climb = true;
            if (notes.match(/<Floating>/i)) result.floating = true;

            // i18n-ignore-start: note-tag ids, keys into behaviorMap
            if (notes.match(/<Predator>/i)) result.behavior = "Predator";
            else if (notes.match(/<Hunter>/i)) result.behavior = "Hunter";
            else if (notes.match(/<Prey>/i)) result.behavior = "Prey";
            else if (notes.match(/<Neutral>/i)) result.behavior = "Neutral";
            // i18n-ignore-end

            return result;
        }
    }

    window.Scene_CDCollection = Scene_CDCollection;

    //=============================================================================
    // Battle Integration & Initialization
    //=============================================================================
    const _BattleManager_initMembers = BattleManager.initMembers;
    BattleManager.initMembers = function () {
        _BattleManager_initMembers.call(this);
        $gameSystem.resetUsedMonstersInBattle();
    };

    // =============================================================================
    // Secondary ASCII Mode Fallback Compatibility
    // =============================================================================
    if (window.AsciiMode) {
        const _Scene_CDCollection_start = Scene_CDCollection.prototype.start;
        Scene_CDCollection.prototype.start = function () {
            _Scene_CDCollection_start.call(this);
            if (window.AsciiMode.active !== 0) {
                window.AsciiMode.createCanvas();
                if (window.AsciiMode.canvas) window.AsciiMode.canvas.style.display = 'block';

                const container = document.getElementById("bestiary-container");
                if (container) container.style.display = 'none';

                this._selectedCDIndex = 0;
                this._asciiMonsters = this._monsterList;
            }
        };

        const _Scene_CDCollection_terminate = Scene_CDCollection.prototype.terminate;
        Scene_CDCollection.prototype.terminate = function () {
            if (window.AsciiMode.canvas) {
                window.AsciiMode.canvas.style.display = 'none';
            }
            _Scene_CDCollection_terminate.call(this);
        };

        const _Scene_CDCollection_update = Scene_CDCollection.prototype.update;
        Scene_CDCollection.prototype.update = function () {
            if (window.AsciiMode.active !== 0) {
                this.updateAsciiBestiaryInput();
                this.renderAsciiBestiary();
                Scene_Base.prototype.update.call(this);
                return;
            }
            _Scene_CDCollection_update.call(this);
        };

        Scene_CDCollection.prototype.updateAsciiBestiaryInput = function () {
            const list = this._asciiMonsters;
            if (list.length === 0) {
                if (Input.isTriggered('cancel')) {
                    SceneManager.pop();
                    SoundManager.playCancel();
                }
                return;
            }

            if (Input.isRepeated('down')) {
                this._selectedCDIndex = (this._selectedCDIndex + 1) % list.length;
                SoundManager.playCursor();
            }
            if (Input.isRepeated('up')) {
                this._selectedCDIndex = (this._selectedCDIndex - 1 + list.length) % list.length;
                SoundManager.playCursor();
            }
            if (Input.isTriggered('cancel')) {
                SceneManager.pop();
                SoundManager.playCancel();
            }
        };

        Scene_CDCollection.prototype.renderAsciiBestiary = function () {
            const ctx = window.AsciiMode.context;
            if (!ctx) return;

            ctx.clearRect(0, 0, window.AsciiMode.canvas.width, window.AsciiMode.canvas.height);
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, window.AsciiMode.canvas.width, window.AsciiMode.canvas.height);

            const fontSize = window.AsciiMode.fontSize;
            ctx.font = `${fontSize}px ${window.AsciiMode.fontFamily}`;

            // Header
            ctx.fillStyle = '#FFD700';
            ctx.textAlign = 'center';
            ctx.fillText("--- BESTIARY ---", window.AsciiMode.canvas.width / 2, 30);

            // List
            const list = this._asciiMonsters;
            const listY = 80;
            const listX = 50;
            const detailX = 400;

            ctx.textAlign = 'left';
            for (let i = 0; i < list.length; i++) {
                const monster = list[i];
                const y = listY + i * (fontSize + 10);

                if (i === this._selectedCDIndex) {
                    ctx.fillStyle = '#FF0000';
                    ctx.fillText(`> ${monster.name}`, listX, y);
                } else {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillText(`  ${monster.name}`, listX, y);
                }
            }

            // Details
            const selectedMonster = list[this._selectedCDIndex];
            if (selectedMonster) {
                this.renderAsciiMonsterDetails(selectedMonster.enemy, detailX, listY);
            }
        };

        Scene_CDCollection.prototype.renderAsciiMonsterDetails = function (enemy, x, y) {
            const ctx = window.AsciiMode.context;
            const fontSize = window.AsciiMode.fontSize;
            const lineHeight = fontSize + 6;
            let currentY = y;

            const l10n = getEnemyL10n(enemy.id);
            const name = l10n ? l10n.name : enemy.name;

            ctx.fillStyle = '#FFD700';
            ctx.textAlign = 'left';
            ctx.fillText(name, x, currentY);
            currentY += lineHeight;

            ctx.strokeStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.moveTo(x, currentY);
            ctx.lineTo(x + 300, currentY);
            ctx.stroke();
            currentY += 10;

            ctx.fillStyle = '#FFFFFF';

            // Draw Params
            const params = enemy.params || [0, 0, 0, 0, 0, 0, 0, 0];

            for (let i = 0; i < 8; i++) {
                const val = params[i];
                const label = getShortParamName(i);
                this.drawAsciiKeyValue(label, val.toString(), x, currentY);
                currentY += lineHeight;
            }

            currentY += 10;
            this.drawAsciiKeyValue("EXP", enemy.exp.toString(), x, currentY);
            currentY += lineHeight;
            this.drawAsciiKeyValue(T('Bestiary.gold'), (enemy.gold / 100).toString() + " €", x, currentY);
        };

        Scene_CDCollection.prototype.drawAsciiKeyValue = function (key, value, x, y) {
            const ctx = window.AsciiMode.context;
            ctx.fillStyle = '#00FFFF';
            ctx.fillText(key + ":", x, y);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(value, x + 100, y);
        };
    }

})();