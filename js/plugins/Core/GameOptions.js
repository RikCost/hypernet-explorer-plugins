/*:
 * @target MZ
 * @plugindesc v1.1 Divided options menu into thematic tabs and provides an entry point for other plugins. Merged with VolumePercentageDisplay.
 * @author Omni-Lex & Assistant
 *
 * @help GameOptions.js
 *
 * This plugin restructures the Options menu to use tabs at the top.
 * It provides a global object `GameOptions` for other plugins to register their options.
 *
 * Entry Point for other plugins:
 * GameOptions.registerOption(symbol, name, getter, setter, category, type, statusTextFn, cursorRightFn, cursorLeftFn)
 *
 * Parameters from VolumePercentageDisplay are included.
 *
 * @param barColor1
 * @text Bar Color 1 (Start)
 * @desc The starting gradient color for the volume bar
 * @type number
 * @min 0
 * @max 31
 * @default 20
 *
 * @param barColor2
 * @text Bar Color 2 (End)
 * @desc The ending gradient color for the volume bar
 * @type number
 * @min 0
 * @max 31
 * @default 21
 *
 * @param defaultBgmVolume
 * @text Default BGM Volume
 * @desc Default volume for background music (0-100)
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param defaultBgsVolume
 * @text Default BGS Volume
 * @desc Default volume for background sounds (0-100)
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param defaultMeVolume
 * @text Default ME Volume
 * @desc Default volume for music effects (0-100)
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param defaultSeVolume
 * @text Default SE Volume
 * @desc Default volume for sound effects (0-100)
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param defaultFootstepsVolume
 * @text Default Footsteps Volume
 * @desc Default volume for footstep sounds (0-100)
 * @type number
 * @min 0
 * @max 100
 * @default 30
 */

const GameOptions = {
    _options: {},
    _themesCache: null,

    /**
     * Scan css/themes directory and load all theme files dynamically.
     * @returns {string[]} An array of theme filenames.
     */
    getThemes: function () {
        if (this._themesCache) return this._themesCache;

        const defaultTheme = 'omega_tower.css';
        let themes = [defaultTheme];

        if (Utils.isNwjs()) {
            try {
                const fs = require('fs');
                const path = require('path');
                const base = path.dirname(process.mainModule.filename);
                const themesDir = path.join(base, 'css', 'themes');
                if (fs.existsSync(themesDir)) {
                    const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.css'));
                    const otherFiles = [];
                    files.forEach(file => {
                        if (file !== defaultTheme && file !== 'vars.css') {
                            otherFiles.push(file);
                        }
                    });
                    otherFiles.sort();
                    themes = themes.concat(otherFiles);
                }
            } catch (e) {
                console.error("GameOptions: Failed to load theme files dynamically.", e);
            }
        } else {
            // Web browser fallback
            themes.push('omega_tower.css');
        }

        this._themesCache = themes;
        return themes;
    },

    /**
     * Persist a theme selection to disk WITHOUT applying it live.
     * Writes the chosen preset into css/vars.css so it loads on next restart.
     * Used when the player changes the theme at runtime: applying a freshly
     * loaded stylesheet live causes class/token "bleeding" against the already
     * rendered scene, so the new theme only takes effect after a restart.
     * @param {number} themeIndex - Index of theme in getThemes list.
     */
    persistTheme: function (themeIndex) {
        const themes = this.getThemes();
        const themeFile = themes[themeIndex] || themes[0];
        if (!themeFile) return;

        if (Utils.isNwjs()) {
            try {
                const fs = require('fs');
                const path = require('path');
                const base = path.dirname(process.mainModule.filename);
                const themesDir = path.join(base, 'css', 'themes');
                const selectedThemePath = path.join(themesDir, themeFile);
                const varsPath = path.join(base, 'css', 'vars.css');

                if (fs.existsSync(selectedThemePath)) {
                    const content = fs.readFileSync(selectedThemePath, 'utf8');
                    // Write to disk for persistence across restarts only.
                    fs.writeFileSync(varsPath, content, 'utf8');
                }
            } catch (e) {
                console.error("GameOptions: Failed to persist theme.", e);
            }
        }
    },

    /**
     * Apply a theme stylesheet dynamically. Writes to vars.css in NW.js and
     * injects it live. Only used at boot (when the scene is built against the
     * already-persisted theme), never on a live theme change.
     * @param {number} themeIndex - Index of theme in getThemes list.
     */
    applyTheme: function (themeIndex) {
        const themes = this.getThemes();
        const themeFile = themes[themeIndex] || themes[0];
        if (!themeFile) return;

        if (Utils.isNwjs()) {
            try {
                const fs = require('fs');
                const path = require('path');
                const base = path.dirname(process.mainModule.filename);
                const themesDir = path.join(base, 'css', 'themes');
                const selectedThemePath = path.join(themesDir, themeFile);
                const varsPath = path.join(base, 'css', 'vars.css');

                if (fs.existsSync(selectedThemePath)) {
                    const content = fs.readFileSync(selectedThemePath, 'utf8');
                    // Write to disk for persistence across restarts
                    fs.writeFileSync(varsPath, content, 'utf8');
                    // Apply instantly via injected <style>, cascade order ensures it
                    // overrides the linked stylesheet without requiring a reload/re-fetch.
                    let style = document.getElementById('active-theme-override');
                    if (!style) {
                        style = document.createElement('style');
                        style.id = 'active-theme-override';
                        document.head.appendChild(style);
                    }
                    style.textContent = content;
                    // Force a repaint. Updating the :root vars alone won't make
                    // Chromium repaint cached gradient/url() background-images on
                    // surfaces that weren't structurally mutated (e.g. the options
                    // menu's #menu-container / .book-spread). Without this, scenes
                    // that only re-render a small inner subtree show no theme change.
                    this._forceRepaint();
                }
            } catch (e) {
                console.error("GameOptions: Failed to apply theme.", e);
            }
        }
    },

    /**
     * Force a synchronous repaint of the DOM. Toggling display off/on invalidates
     * the body's layout and paint subtree so var-driven background-images pick up
     * the new theme values. The state is reverted before the browser yields, so
     * no intermediate frame is painted (no visible flicker).
     */
    _forceRepaint: function () {
        const b = document.body;
        if (!b) return;
        const prev = b.style.display;
        b.style.display = 'none';
        void b.offsetHeight; // force reflow
        b.style.display = prev;
    },

    /**
     * Register a new option
     * @param {string} symbol - Unique identifier (matches ConfigManager property)
     * @param {string|function} name - Display name in the menu. Pass a function
     *        when the label must follow the active language (it is resolved
     *        every time the list is built, e.g. the Language option itself).
     * @param {function} getter - Function returning the current value
     * @param {function} setter - Function accepting the new value
     * @param {string} category - Tab ID ('audio', 'video', 'gameplay', 'experimental')
     * @param {string} type - 'boolean' or 'number'
     * @param {function} statusTextFn - Optional function returning custom status text
     * @param {function} cursorRightFn - Optional function for custom right action
     * @param {function} cursorLeftFn - Optional function for custom left action
     */
    registerOption: function (symbol, name, getter, setter, category = 'gameplay', type = 'boolean', statusTextFn = null, cursorRightFn = null, cursorLeftFn = null) {
        this._options[symbol] = { name, getter, setter, category, type, statusTextFn, cursorRightFn, cursorLeftFn };
    },

    // Hardcoded order and categorization. Gameplay is first so it opens by default.
    tabs: [
        {
            id: 'gameplay',
            nameKey: 'gameplay',
            categories: ['gameplay'],
            // Language leads the page: it is the setting that decides how every
            // other one reads, so it must stay first.
            symbols: [
                'language', 'fogOfWar', 'fowEnabled', 'enemySpawnMode', 'enemyDifficulty',
                'cpuPartyMembers', 'skillCategoryMode', 'commandRemember', 'smoothBattleLog'
            ]
        },
        {
            id: 'video',
            nameKey: 'video',
            categories: ['video'],
            symbols: [
                'enemyBattlers', 'fullscreen', 'uiScale', 'fontScale', 'globalLighting', 'nightLight',
                'activeTheme', 'partyHud', 'showFps', 'titleBackground'
            ]
        },
        {
            id: 'audio',
            nameKey: 'audio',
            categories: ['audio'],
            symbols: ['battleMusicName', 'bgmMute', 'bgmVolume', 'bgsVolume', 'meVolume', 'seVolume', 'footstepsVolume', 'uisVolume', 'vscVolume', 'masterVolume']
        },
        {
            id: 'shader',
            nameKey: 'shader',
            categories: ['shader'],
            symbols: [
                'retroEnabled', 'retroDownscale', 'retroColorLevels', 'retroVertexSnap', 'retroDither'
            ]
        },
        {
            id: 'experimental',
            nameKey: 'experimental',
            categories: ['experimental'],
            symbols: [
                'weaponSprites3D', 'cardCombat', 'mapBattleMode', 'asciiModeEnabled', 'asciiHudEnabled'
            ]
        }
    ]
};

window.GameOptions = GameOptions;

(() => {
    'use strict';

    const pluginName = "GameOptions";
    const parameters = PluginManager.parameters(pluginName);
    const barColor1 = Number(parameters['barColor1'] || 20);
    const barColor2 = Number(parameters['barColor2'] || 21);
    const defaultBgmVolume = Number(parameters['defaultBgmVolume'] || 90);
    const defaultBgsVolume = Number(parameters['defaultBgsVolume'] || 50);
    const defaultMeVolume = Number(parameters['defaultMeVolume'] || 90);
    const defaultSeVolume = Number(parameters['defaultSeVolume'] || 90);
    const defaultFootstepsVolume = Number(parameters['defaultFootstepsVolume'] || 30);

    //=============================================================================
    // Retro shader config (the low-poly/low-res shader helper, PSXShader.js)
    //=============================================================================
    // Defaults mirror the shader helper. The look is a light period flavour
    // rather than a full emulation: a small wobble, shallow banding and a gentle
    // downsample, so the 3D scenes stay legible. vertexSnap and colorLevels are
    // stored as raw tunables; downscale and dither are stored as 0..100
    // percentages so they map cleanly onto the slider UI.
    const RETRO_DEFAULTS = {
        enabled: true,
        vertexSnap: 420,   // lower = chunkier
        colorLevels: 48,   // fewer = more banding
        downscale: 88,     // percent of full resolution; lower = more pixelated
        dither: 18         // percent dither strength
    };

    // Bumped whenever the defaults above are retuned. A config written before
    // the current tuning is pulled back onto the new defaults once, otherwise
    // every existing player keeps the old heavy settings forever.
    const RETRO_TUNE = 2;

    // Push the stored config onto the live shader helper. Vertex snap, color
    // levels and dither are baked into the GLSL when a material is patched, so
    // those take effect for models built after the change (next battle/scene);
    // enabled and downscale are read per frame and update instantly.
    function applyRetroConfig() {
        const shader = window.PSXShader;
        if (!shader) return;
        shader.enabled = ConfigManager.retroEnabled !== false;
        shader.vertexSnap = ConfigManager.retroVertexSnap != null ? ConfigManager.retroVertexSnap : RETRO_DEFAULTS.vertexSnap;
        shader.colorLevels = ConfigManager.retroColorLevels != null ? ConfigManager.retroColorLevels : RETRO_DEFAULTS.colorLevels;
        const down = ConfigManager.retroDownscale != null ? ConfigManager.retroDownscale : RETRO_DEFAULTS.downscale;
        shader.downscale = Math.max(0.1, down / 100);
        const dith = ConfigManager.retroDither != null ? ConfigManager.retroDither : RETRO_DEFAULTS.dither;
        shader.dither = dith / 100;
    }

    //=============================================================================
    // Interface scaling (UI zoom + font size)
    //=============================================================================
    // Both are whole percentages stepped through a select-style row. UI Scale
    // zooms the DOM menu overlays (every parchment menu roots at #menu-container,
    // see the `#menu-container > *` rule in theme.css); Font Scale drives the
    // root font size the DOM menus size their text from AND the canvas window
    // font size used by RPG Maker's own windows.
    const SCALE_MIN = 70, SCALE_MAX = 150, SCALE_STEP = 5, SCALE_DEFAULT = 100;
    const clampScale = (v) => {
        const n = Number(v);
        if (!isFinite(n)) return SCALE_DEFAULT;
        return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) / SCALE_STEP) * SCALE_STEP;
    };

    GameOptions.uiScale = () => clampScale(ConfigManager.uiScale) / 100;
    GameOptions.fontScale = () => clampScale(ConfigManager.fontScale) / 100;

    // Applied to the document root so it survives scene changes; every DOM menu
    // built afterwards picks it up with no extra wiring.
    function applyInterfaceScale() {
        const root = document.documentElement;
        if (!root) return;
        root.style.setProperty('--ui-scale', String(GameOptions.uiScale()));
        const fs = GameOptions.fontScale();
        root.style.setProperty('--ui-font-scale', String(fs));
        root.style.fontSize = (16 * fs) + 'px';
    }
    GameOptions.applyInterfaceScale = applyInterfaceScale;

    // Canvas windows read their size from here, so the same slider scales the
    // in-game message/menu windows. Open windows pick it up on their next refresh.
    const _Game_System_mainFontSize = Game_System.prototype.mainFontSize;
    Game_System.prototype.mainFontSize = function () {
        return Math.round(_Game_System_mainFontSize.call(this) * GameOptions.fontScale());
    };

    //=============================================================================
    // Enemy difficulty (stat scaling)
    //=============================================================================
    // Stored as a 0..100 slider so it reuses the standard number/slider UI.
    // 50 is the neutral middle: no stat edits at all. Each step away from the
    // middle is worth 2% per point, so the ends read as -100% / +100%.
    const ENEMY_DIFFICULTY_DEFAULT = 50;
    const ENEMY_DIFFICULTY_SCALE = 2;

    // Slider value -> signed stat percentage shown to the player.
    const enemyDifficultyPercent = function (value) {
        const v = value != null ? value : ENEMY_DIFFICULTY_DEFAULT;
        return Math.round((v - ENEMY_DIFFICULTY_DEFAULT) * ENEMY_DIFFICULTY_SCALE);
    };

    // Multiplier applied to every enemy parameter. Exactly 1 while the slider
    // sits in the middle, which keeps the vanilla numbers byte-identical.
    GameOptions.enemyStatMultiplier = function () {
        const pct = enemyDifficultyPercent(ConfigManager.enemyDifficulty);
        if (pct === 0) return 1;
        return Math.max(0, 1 + pct / 100);
    };

    // Signed percentage, exposed for other plugins/UI that want to display it.
    GameOptions.enemyDifficultyPercent = function () {
        return enemyDifficultyPercent(ConfigManager.enemyDifficulty);
    };

    // Label for the option row and the inspect panel, e.g. "Normal", "+40%".
    const enemyDifficultyLabel = function (value) {
        const pct = enemyDifficultyPercent(value);
        if (pct === 0) return T('GameOptions.normal');
        return (pct > 0 ? '+' : '') + pct + '%';
    };

    //=============================================================================
    // ConfigManager (Merged from VolumePercentageDisplay)
    //=============================================================================

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _ConfigManager_applyData.call(this, config);

        // Apply defaults if not set. Read straight off the stored config (and
        // coerce), rather than trusting whatever is already on ConfigManager:
        // a config written by an older build can carry a null/NaN volume, which
        // is not `undefined` and would otherwise survive into the sliders.
        const volume = (stored, fallback) => {
            const n = Number(stored);
            return isFinite(n) ? n.clamp(0, 100) : fallback;
        };
        if (this.bgmVolume === undefined) this.bgmVolume = defaultBgmVolume;
        if (this.bgsVolume === undefined) this.bgsVolume = defaultBgsVolume;
        if (this.meVolume === undefined) this.meVolume = defaultMeVolume;
        if (this.seVolume === undefined) this.seVolume = defaultSeVolume;
        this.footstepsVolume = volume(config.footstepsVolume, defaultFootstepsVolume);

        // Volume the BGM mute toggle restores when it is switched back off.
        // Kept separate from bgmVolume so muting can survive a save/load.
        this.bgmVolumeBeforeMute = config.bgmVolumeBeforeMute !== undefined
            ? config.bgmVolumeBeforeMute
            : defaultBgmVolume;

        // MUSH Audio Engine defaults
        if (this.uisVolume === undefined) this.uisVolume = 100;
        if (this.vscVolume === undefined) this.vscVolume = 100;
        if (this.masterVolume === undefined) this.masterVolume = 100;

        // Enemy battler display mode: 0 = 2D (default battler image), 1 = 3D
        // (procedural/GLB models), 2 = Sprites (<Char:> sprite from enemy info).
        // Migrates the old standalone charBasedSprites toggle into this 3-way.
        this.enemyBattlers = config.enemyBattlers !== undefined
            ? config.enemyBattlers
            : (config.charBasedSprites ? 2 : 1);
        // Back-compat mirror for any code still reading charBasedSprites.
        this.charBasedSprites = (this.enemyBattlers === 2);
        this.activeTheme = config.activeTheme !== undefined ? config.activeTheme : 0;
        this.showFps = config.showFps !== undefined ? config.showFps : false;
        // Procedural 3D weapon models (Weapon/WeaponSystemProcedural.js): off by
        // default, the 2D weapon sprites are the supported look.
        this.weaponSprites3D = config.weaponSprites3D !== undefined ? config.weaponSprites3D : false;
        // Title screen background style: 0 Random, 1 Cards, 2 Space
        // (planets + stars + black holes + galaxies), 3 Artifacts, 4 Bestiary,
        // 5 Weapons, 6 Enemies 3D, 7 Hyperverse (default), 8 Camper Drive
        this.titleBackground = config.titleBackground !== undefined ? config.titleBackground : 7;
        // CPU party members: when on, every party member except the leader
        // (first member) is auto-controlled in battle. Disabled by default.
        this.cpuPartyMembers = config.cpuPartyMembers !== undefined ? config.cpuPartyMembers : false;
        // Roguelike card combat (BattleSystem/RoguelikeCardSystem.js): off by
        // default. Independent of the per-save Switch 45 set at character
        // creation - either one enables card battles.
        this.cardCombat = config.cardCombat !== undefined ? config.cardCombat : false;
        // Tactical map battle (BattleSystem/MapBattleMode.js): off by default.
        this.mapBattleMode = config.mapBattleMode !== undefined ? config.mapBattleMode : false;
        // The two alternate battle layers are mutually exclusive; a config that
        // somehow carries both on is resolved in favour of card combat here so
        // the menu never shows two "on" rows that fight over the next battle.
        if (this.cardCombat && this.mapBattleMode) this.mapBattleMode = false;
        // Enemy spawn mode (BattleSystemEnhancedEncounters.js): 0 = Balanced
        // (default; roaming enemies at/below party level + one much-higher boss
        // per proc map), 1 = Realistic (current biome/nation spawn formula).
        this.enemySpawnMode = config.enemySpawnMode !== undefined ? config.enemySpawnMode : 0;
        // Enemy difficulty slider: 0..100 with 50 = untouched stats. Anything
        // else scales every enemy parameter (see the Game_Enemy.paramBase hook).
        this.enemyDifficulty = config.enemyDifficulty !== undefined ? config.enemyDifficulty : ENEMY_DIFFICULTY_DEFAULT;

        // Retro shader tunables. The `psx*` fallbacks migrate configs written
        // before the options were renamed.
        const stale = (config.retroTune || 0) < RETRO_TUNE;
        const retro = (key, legacy, fallback) => {
            if (stale) return fallback;
            if (config[key] !== undefined) return config[key];
            if (config[legacy] !== undefined) return config[legacy];
            return fallback;
        };
        this.retroTune = RETRO_TUNE;
        this.retroEnabled = retro('retroEnabled', 'psxEnabled', RETRO_DEFAULTS.enabled);
        this.retroVertexSnap = retro('retroVertexSnap', 'psxVertexSnap', RETRO_DEFAULTS.vertexSnap);
        this.retroColorLevels = retro('retroColorLevels', 'psxColorLevels', RETRO_DEFAULTS.colorLevels);
        this.retroDownscale = retro('retroDownscale', 'psxDownscale', RETRO_DEFAULTS.downscale);
        this.retroDither = retro('retroDither', 'psxDither', RETRO_DEFAULTS.dither);
        applyRetroConfig();

        // Interface scaling
        this.uiScale = clampScale(config.uiScale !== undefined ? config.uiScale : SCALE_DEFAULT);
        this.fontScale = clampScale(config.fontScale !== undefined ? config.fontScale : SCALE_DEFAULT);
        applyInterfaceScale();

        if (Graphics._fpsCounter) {
            if (this.showFps) {
                Graphics._fpsCounter._boxDiv.style.display = "block";
                Graphics._fpsCounter._showFps = true;
            } else {
                Graphics._fpsCounter._boxDiv.style.display = "none";
            }
            Graphics._fpsCounter._update();
        }

        // Apply the loaded theme immediately
        GameOptions.applyTheme(this.activeTheme);
    };

    // Override to use 1% increments for volume
    ConfigManager.volumeOffset = function () {
        return 1;
    };

    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _ConfigManager_makeData.call(this);
        config.footstepsVolume = this.footstepsVolume;
        config.bgmVolumeBeforeMute = this.bgmVolumeBeforeMute;
        config.enemyBattlers = this.enemyBattlers;
        config.charBasedSprites = this.charBasedSprites;
        config.activeTheme = this.activeTheme;
        config.showFps = this.showFps;
        config.weaponSprites3D = this.weaponSprites3D;
        config.titleBackground = this.titleBackground;
        config.cpuPartyMembers = this.cpuPartyMembers;
        config.cardCombat = this.cardCombat;
        config.mapBattleMode = this.mapBattleMode;
        config.enemySpawnMode = this.enemySpawnMode;
        config.enemyDifficulty = this.enemyDifficulty;
        config.retroTune = RETRO_TUNE;
        config.retroEnabled = this.retroEnabled;
        config.retroVertexSnap = this.retroVertexSnap;
        config.retroColorLevels = this.retroColorLevels;
        config.retroDownscale = this.retroDownscale;
        config.retroDither = this.retroDither;
        config.uiScale = this.uiScale;
        config.fontScale = this.fontScale;
        return config;
    };

    //=============================================================================
    // Simplified Window_OptionsTabs (Hidden, maintained for compatibility)
    //=============================================================================
    class Window_OptionsTabs extends Window_Command {
        constructor(rect) {
            super(rect);
            this.visible = false;
            this._lastIndex = -1;
        }
        isOpenAndActive() {
            return this.isOpen() && this.active;
        }
        processTouch() {
            // Do nothing to prevent standard window touch handling from interfering with custom DOM
        }
        makeCommandList() {
            GameOptions.tabs.forEach(tab => {
                this.addCommand(T('GameOptions.label.' + tab.nameKey), 'tab', true, tab.id);
            });
        }
        maxCols() {
            return 1;
        }
        setOptionsWindow(optionsWindow) {
            this._optionsWindow = optionsWindow;
        }
        update() {
            super.update();
            if (this._optionsWindow && this._lastIndex !== this.index()) {
                this._lastIndex = this.index();
                this._optionsWindow.refresh();
                this._optionsWindow.select(0);
            }
            if (this.active && Input.isRepeated('left')) {
                this.deactivate();
                this._optionsWindow.activate();
                this._optionsWindow.select(0);
            }
        }
    }

    //=============================================================================
    // Simplified Window_Options (Hidden, maintained for compatibility)
    //=============================================================================
    const _Window_Options_makeCommandList = Window_Options.prototype.makeCommandList;
    Window_Options.prototype.makeCommandList = function () {
        if (!SceneManager._scene._optionsTabsWindow) {
            _Window_Options_makeCommandList.call(this);
            return;
        }
        const currentTabId = SceneManager._scene._optionsTabsWindow.currentExt();
        const tab = GameOptions.tabs.find(t => t.id === currentTabId);
        if (!tab) return;

        // A registered name may be a function so the label re-resolves against
        // the active language every time the list is rebuilt.
        const optionName = opt => (typeof opt.name === 'function' ? opt.name() : opt.name);

        const coreSymbols = ['alwaysDash', 'commandRemember', 'bgmVolume', 'bgsVolume', 'meVolume', 'seVolume'];
        tab.symbols.forEach(symbol => {
            const custom = GameOptions._options[symbol];
            if (custom) {
                this.addCommand(optionName(custom), symbol);
            } else if (coreSymbols.includes(symbol)) {
                let name = symbol;
                if (symbol === 'alwaysDash') name = TextManager.alwaysDash;
                else if (symbol === 'commandRemember') name = TextManager.commandRemember;
                else if (symbol === 'bgmVolume') name = TextManager.bgmVolume;
                else if (symbol === 'bgsVolume') name = TextManager.bgsVolume;
                else if (symbol === 'meVolume') name = TextManager.meVolume;
                else if (symbol === 'seVolume') name = TextManager.seVolume;
                this.addCommand(name, symbol);
            }
        });

        const tabCategories = tab.categories || [tab.id];
        for (const symbol in GameOptions._options) {
            const opt = GameOptions._options[symbol];
            if (tabCategories.includes(opt.category) && !tab.symbols.includes(symbol)) {
                this.addCommand(optionName(opt), symbol);
            }
        }
    };

    const _Window_Options_getConfigValue = Window_Options.prototype.getConfigValue;
    Window_Options.prototype.getConfigValue = function (symbol) {
        const custom = GameOptions._options[symbol];
        if (custom && custom.getter) {
            return custom.getter.call(this);
        }
        return _Window_Options_getConfigValue.call(this, symbol);
    };

    const _Window_Options_setConfigValue = Window_Options.prototype.setConfigValue;
    Window_Options.prototype.setConfigValue = function (symbol, value) {
        const custom = GameOptions._options[symbol];
        if (custom && custom.setter) {
            custom.setter.call(this, value);
            return;
        }
        _Window_Options_setConfigValue.call(this, symbol, value);
    };

    const _Window_Options_statusText = Window_Options.prototype.statusText;
    Window_Options.prototype.statusText = function (index) {
        const symbol = this.commandSymbol(index);
        const custom = GameOptions._options[symbol];
        if (custom) {
            if (custom.statusTextFn) {
                return custom.statusTextFn.call(this, this.getConfigValue(symbol));
            }
            const value = this.getConfigValue(symbol);
            if (custom.type === 'number') {
                return value + "%";
            }
            return this.booleanStatusText(value);
        }
        return _Window_Options_statusText.call(this, index);
    };

    const _Window_Options_cursorRight = Window_Options.prototype.cursorRight;
    Window_Options.prototype.cursorRight = function (wrap) {
        const index = this.index();
        const symbol = this.commandSymbol(index);
        const custom = GameOptions._options[symbol];

        if (custom && custom.cursorRightFn) {
            custom.cursorRightFn.call(this);
            this.redrawItem(index);
        } else if (custom && custom.type === 'number') {
            let value = Number(this.getConfigValue(symbol));
            if (!isFinite(value)) value = 0;
            value = (value + 1).clamp(0, 100);
            this.setConfigValue(symbol, value);
            this.redrawItem(index);
        } else if (this.isVolumeSymbol(symbol)) {
            let value = this.getConfigValue(symbol);
            value = (value + 1).clamp(0, 100);
            this.setConfigValue(symbol, value);
            this.redrawItem(index);
        } else {
            _Window_Options_cursorRight.call(this, wrap);
        }
    };

    const _Window_Options_cursorLeft = Window_Options.prototype.cursorLeft;
    Window_Options.prototype.cursorLeft = function (wrap) {
        const index = this.index();
        const symbol = this.commandSymbol(index);
        const custom = GameOptions._options[symbol];

        if (custom && custom.cursorLeftFn) {
            custom.cursorLeftFn.call(this);
            this.redrawItem(index);
        } else if (custom && custom.type === 'number') {
            let value = Number(this.getConfigValue(symbol));
            if (!isFinite(value)) value = 0;
            value = (value - 1).clamp(0, 100);
            this.setConfigValue(symbol, value);
            this.redrawItem(index);
        } else if (this.isVolumeSymbol(symbol)) {
            let value = this.getConfigValue(symbol);
            value = (value - 1).clamp(0, 100);
            this.setConfigValue(symbol, value);
            this.redrawItem(index);
        } else {
            _Window_Options_cursorLeft.call(this, wrap);
        }
    };

    const _Window_Options_update = Window_Options.prototype.update;
    Window_Options.prototype.update = function () {
        const wasIndex0 = this.index() === 0;
        _Window_Options_update.call(this);
        if (this.active && wasIndex0 && Input.isRepeated('up')) {
            this.deactivate();
            this.deselect();
            SceneManager._scene._optionsTabsWindow.activate();
        }
    };

    Window_Options.prototype.isOpenAndActive = function () {
        return this.isOpen() && this.active;
    };

    Window_Options.prototype.processTouch = function () {
        // Do nothing to prevent standard window touch handling from interfering with custom DOM
    };

    //=============================================================================
    // Scene_Options (D&D Double Page Parchment Layout Redesign)
    //=============================================================================
    const _Scene_Options_create = Scene_Options.prototype.create;
    Scene_Options.prototype.create = function () {
        // Compatibility with MUSH Audio Engine
        if (window.Mush && window.Mush.parameters && window.Mush.parameters.mushAudioEngine) {
            const par = window.Mush.parameters.mushAudioEngine;
            if (par.menuOptions.uisVolumeFeature && par.genFeatures.uis) {
                GameOptions.registerOption('uisVolume', T.param(par.menuOptions.uisVolumeText, 'GameOptions.label.uiVolume'),
                    () => ConfigManager.uisVolume,
                    (value) => ConfigManager.uisVolume = value,
                    'audio', 'number');
            }
            if (par.menuOptions.vscVolumeFeature) {
                GameOptions.registerOption('vscVolume', T.param(par.menuOptions.vscVolumeText, 'GameOptions.label.voiceVolume'),
                    () => ConfigManager.vscVolume,
                    (value) => ConfigManager.vscVolume = value,
                    'audio', 'number');
            }
            if (par.menuOptions.masterVolumeFeature) {
                GameOptions.registerOption('masterVolume', T.param(par.menuOptions.masterVolumeText, 'GameOptions.label.masterVolume'),
                    () => ConfigManager.masterVolume,
                    (value) => ConfigManager.masterVolume = value,
                    'audio', 'number');
            }
        }

        Scene_MenuBase.prototype.create.call(this);

        // Hidden windows kept purely as data/config helpers. They never handle
        // input themselves, the standalone OptionsInputManager drives the scene.
        this._optionsWindow = new Window_Options(new Rectangle(0, 0, 1, 1));
        this._optionsWindow.visible = false;
        this.addWindow(this._optionsWindow);

        this._optionsTabsWindow = new Window_OptionsTabs(new Rectangle(0, 0, 1, 1));
        this._optionsTabsWindow.visible = false;
        this._optionsTabsWindow.setOptionsWindow(this._optionsWindow);
        this.addWindow(this._optionsTabsWindow);

        this._optionsTabsWindow.deactivate();
        this._optionsWindow.deactivate();
        this._optionsWindow.deselect();

        // DOM navigation state (source of truth)
        this._activeTab = 0;              // Gameplay is first -> opens by default
        this._selectedIndex = 0;
        this._activeSection = 'tabs';     // 'tabs' | 'options'
        this._closing = false;

        // Build initial option list for the default tab
        this.refreshTabData();

        // WASD tracking (see menurework spec §2)
        this._wasdInput = { up: false, down: false, left: false, right: false };
        this._wasdHeld = { up: false, down: false, left: false, right: false };
        this._wasdHoldFrames = { up: 0, down: 0, left: 0, right: 0 };
        this._wasdListener = (event) => {
            if (event.repeat) return;
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
            const key = event.key.toLowerCase();
            if (key === 'w') { this._wasdInput.up = true; this._wasdHeld.up = true; event.preventDefault(); }
            if (key === 's') { this._wasdInput.down = true; this._wasdHeld.down = true; event.preventDefault(); }
            if (key === 'a') { this._wasdInput.left = true; this._wasdHeld.left = true; event.preventDefault(); }
            if (key === 'd') { this._wasdInput.right = true; this._wasdHeld.right = true; event.preventDefault(); }
        };
        this._wasdUpListener = (event) => {
            const key = event.key.toLowerCase();
            if (key === 'w') { this._wasdHeld.up = false; this._wasdHoldFrames.up = 0; }
            if (key === 's') { this._wasdHeld.down = false; this._wasdHoldFrames.down = 0; }
            if (key === 'a') { this._wasdHeld.left = false; this._wasdHoldFrames.left = 0; }
            if (key === 'd') { this._wasdHeld.right = false; this._wasdHoldFrames.right = 0; }
        };
        window.addEventListener('keydown', this._wasdListener);
        window.addEventListener('keyup', this._wasdUpListener);

        this.createUIOptionsDOM();
        OptionsInputManager.activate(this);
    };

    Scene_Options.prototype.createUIOptionsDOM = function () {
        this._dndContainer = document.createElement('div');
        this._dndContainer.id = 'menu-container';
        this._dndContainer.style.opacity = "0";
        this._dndContainer.style.transition = "opacity 0.22s ease-out";
        document.body.appendChild(this._dndContainer);

        const it = ConfigManager.language === 'it';
        const mainTitle =T('GameOptions.preferences');
        const backLabel =T('GameOptions.back');

        // Spec skeleton: book-spread -> left-page (header bar + tab strip + list) + right-page (inspect)
        this._dndContainer.innerHTML = `
            <div class="book-spread">
                <div class="left-page">
                    <div class="page-header-bar">
                        <button class="back-button" id="opt-back-btn" onclick="SceneManager._scene.goBack()">${backLabel}</button>
                        <h2 class="title">${mainTitle}</h2>
                    </div>
                    <div class="backpack-tabs" id="options-categories"></div>
                    <div id="options-list" class="pockets-scroll"></div>
                </div>
                <div class="right-page">
                    <div class="item-inspect" id="options-inspect"></div>
                </div>
            </div>
        `;

        this.renderTabs();
        this.renderOptions();
        this.updateHighlight();

        this._dndContainer.addEventListener("wheel", (e) => {
            e.preventDefault();
            const list = document.getElementById('options-list');
            if (list) list.scrollTop += e.deltaY;
        }, { passive: false });

        this._dndContainer.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.goBack();
        });

        // Hover preview: moving the mouse over an option row updates the right
        // page (inspect) to that row without committing the selection; leaving
        // the list reverts to the currently selected option. Delegated on the
        // list element so it survives the innerHTML rebuilds in renderOptions.
        const optionsList = this._dndContainer.querySelector('#options-list');
        if (optionsList) {
            optionsList.addEventListener('mouseover', (e) => {
                const row = e.target.closest && e.target.closest('.option-row');
                if (!row || !optionsList.contains(row)) return;
                const idx = parseInt(row.dataset.idx, 10);
                if (!isNaN(idx)) this.previewOption(idx);
            });
            optionsList.addEventListener('mouseleave', () => this.clearPreview());
        }

        // Force reflow and trigger smooth fade-in once painted
        setTimeout(() => {
            if (this._dndContainer) this._dndContainer.style.opacity = "1";
        }, 16);
    };

    //=========================================================================
    // Random game-icon picker (no emojis, draw from the IconSet bitmap)
    //=========================================================================
    // A curated pool of recognizable, non-blank IconSet indices.
    const ICON_POOL = [
        64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
        80, 81, 82, 83, 84, 87, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
        160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 176, 177, 178, 179,
        208, 209, 210, 211, 212, 213, 214, 215, 311, 312, 313
    ];
    // Stable hash -> a "random" but consistent icon for a given key.
    const pickIcon = (key) => {
        let h = 0;
        const s = String(key);
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return ICON_POOL[h % ICON_POOL.length];
    };

    //=========================================================================
    // Settings preview images (img/pictures/Settings/)
    //=========================================================================
    // Each option symbol may map to an illustrative image shown in the inspect
    // panel. Boolean toggles use {on, off} variants; sliders/selects use {img}.
    // Empty placeholder files exist for every entry, swap in real art anytime.
    const SETTINGS_IMAGE_DIR = 'img/pictures/Settings/';
    const OPTION_IMAGES = {
        // Gameplay
        fogOfWar:        { on: 'FogOfWarON',        off: 'FogOfWarOFF' },
        autoIdle:        { on: 'AutoIdleON',        off: 'AutoIdleOFF' },
        commandRemember: { on: 'CommandRememberON', off: 'CommandRememberOFF' },
        autosaveEnabled: { on: 'AutoSaveON',        off: 'AutoSaveOFF' },
        categorizeInBattle: { on: 'CategorizeSkillsON', off: 'CategorizeSkillsOFF' },
        // Skill Categorization 3-way select (0 Role, 1 School, 2 Off).
        skillCategoryMode: { states: ['SkillCategoryRole', 'SkillCategorySchool', 'SkillCategoryOff'] },
        // Enemy spawn mode has no art on purpose: an abstract chart explained it
        // worse than words did, so it relies on the written explanation below.
        enemyDifficulty: { img: 'EnemyDifficulty' },
        combatMode:      { on: 'CombatModeON',      off: 'CombatModeOFF' },
        autosaveInterval: { img: 'SaveInterval' },
        battleLogBgOpacity: { img: 'BattleLogOpacity' },
        language:        { img: 'Language' }, // i18n-ignore: icon filename
        // Tactical map battle (BattleSystem/MapBattleMode.js).
        mapBattleMode:   { on: 'MapBattleON',       off: 'MapBattleOFF' },
        cpuPartyMembers: { on: 'CpuPartyON',        off: 'CpuPartyOFF' },
        // Video
        enemyBattlers:   { states: ['EnemyBattlers2D', 'EnemyBattlers3D', 'EnemyBattlersSprites'] },
        fullscreen:      { on: 'FullscreenON',      off: 'FullscreenOFF' },
        globalLighting:  { on: 'GlobalLightingON',  off: 'GlobalLightingOFF' },
        nightLight:      { on: 'NightLightON',      off: 'NightLightOFF' },
        charBasedSprites: { on: 'CharSpritesON',    off: 'CharSpritesOFF' },
        showFps:         { on: 'ShowFpsON',         off: 'ShowFpsOFF' },
        activeTheme:     { img: 'ActiveTheme' },
        battleMusicName: { img: 'BattleMusic' },
        titleBackground: { img: 'TitleBackground' },
        uiScale:         { img: 'UiScale' },
        fontScale:       { img: 'FontScale' },
        TDDP_pixelPerfectMode: { on: 'PixelPerfectON', off: 'PixelPerfectOFF' },
        TDDP_allowStretching:  { on: 'StretchingON',   off: 'StretchingOFF' },
        // Shader (the low-poly/low-res retro pass, PSXShader.js). Every one of
        // these changes what the 3D scenes look like, so each gets its own shot.
        retroEnabled:    { on: 'RetroShaderON',     off: 'RetroShaderOFF' },
        retroDownscale:  { img: 'RetroResolution' },
        retroDither:     { img: 'RetroDither' },
        retroColorLevels: { img: 'RetroColorLevels' },
        retroVertexSnap: { img: 'RetroVertexSnap' },
        // Experimental: ASCII mode is a 3-way select (0 Off, 1 On, 2 Only UI).
        asciiModeEnabled: { states: ['AsciiModeOFF', 'AsciiModeON', 'AsciiHUDON'] },
        asciiHudEnabled: { on: 'AsciiHUDON',        off: 'AsciiHUDOFF' },
        cardCombat:      { on: 'CardCombatON',      off: 'CardCombatOFF' },
        // 3D
        battler3d:       { on: 'Battler3DON',       off: 'Battler3DOFF' },
        enemyBattlerMode: { on: 'EnemyBattlerON',   off: 'EnemyBattlerOFF' },
        weaponSprites3D: { on: '3dWeaponsON',       off: '3dWeaponsOFF' },
        ebBackgrounds:   { on: 'AnimatedBGON',      off: 'AnimatedBGOFF' }
    };

    //=========================================================================
    // Per-option warnings (inspect panel)
    //=========================================================================


    // Most entries above still point at a blank 1x1 stub (~70 bytes) rather than
    // real art. Those must not render, an empty framed box next to the option is
    // worse than no illustration at all, so the file is measured once and any
    // stub is treated as "no image". Web builds cannot stat files; there the
    // <img> onload handler below catches the same case from naturalWidth.
    const PLACEHOLDER_MAX_BYTES = 256;
    const _imageUsableCache = {};
    const settingsImageUsable = (relPath) => {
        if (relPath in _imageUsableCache) return _imageUsableCache[relPath];
        let usable = true;
        if (Utils.isNwjs()) {
            let fs, full;
            try {
                fs = require('fs');
                const path = require('path');
                const base = path.dirname(process.mainModule.filename);
                full = path.join(base, relPath.split('/').join(path.sep));
            } catch (e) {
                // No filesystem access here; leave it to the <img> handlers.
                full = null;
            }
            if (full) {
                try {
                    const stat = fs.statSync(full);
                    usable = stat.isFile() && stat.size > PLACEHOLDER_MAX_BYTES;
                } catch (e) {
                    usable = false; // missing file
                }
            }
        }
        _imageUsableCache[relPath] = usable;
        return usable;
    };

    // Resolve the preview image path for an option given its current value.
    const settingsImageFor = (symbol, value) => {
        const entry = OPTION_IMAGES[symbol];
        if (!entry) return null;
        let name = null;
        if (entry.states) {
            // Multi-state select: one image per integer value (clamped).
            const idx = Math.max(0, Math.min(entry.states.length - 1, value | 0));
            name = entry.states[idx];
        } else if (entry.on || entry.off) {
            name = value ? entry.on : entry.off;
        } else {
            name = entry.img;
        }
        if (!name) return null;
        const path = SETTINGS_IMAGE_DIR + name + '.png';
        return settingsImageUsable(path) ? path : null;
    };

    Scene_Options.prototype.drawOptionIcons = function () {
        if (!this._dndContainer) return;
        const bitmap = ImageManager.loadSystem('IconSet');
        const canvases = this._dndContainer.querySelectorAll('canvas[data-icon]');
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
    };

    //=========================================================================
    // Standalone input manager (menurework spec §5), keyboard + controller
    //=========================================================================
    const OptionsInputManager = {
        _scene: null,
        _active: false,
        activate(scene) { this._scene = scene; this._active = true; },
        deactivate() { this._active = false; this._scene = null; },
        update() {
            const scene = this._scene;
            if (!this._active || !scene || !scene._dndContainer) return;

            // WASD hold-repeat simulation (spec §2)
            for (const dir of ['up', 'down', 'left', 'right']) {
                if (scene._wasdHeld[dir]) {
                    scene._wasdHoldFrames[dir]++;
                    const t = scene._wasdHoldFrames[dir];
                    if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
                        scene._wasdInput[dir] = true;
                    }
                } else {
                    scene._wasdHoldFrames[dir] = 0;
                }
            }
            const isDown = Input.isRepeated('down') || scene._wasdInput.down;
            const isUp = Input.isRepeated('up') || scene._wasdInput.up;
            const isRight = Input.isRepeated('right') || scene._wasdInput.right;
            const isLeft = Input.isRepeated('left') || scene._wasdInput.left;
            scene._wasdInput.up = scene._wasdInput.down = scene._wasdInput.left = scene._wasdInput.right = false;

            // L1/R1 tab cycling, fires from anywhere (spec §2)
            if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
                scene.cycleTab(Input.isTriggered('pageup') ? -1 : 1);
                return;
            }

            // OK
            if (Input.isTriggered('ok')) { scene.handleOk(); return; }

            // Cancel, always check both 'escape' and 'cancel' (gamepad B)
            if (Input.isTriggered('escape') || Input.isTriggered('cancel')) {
                scene.handleCancel();
                return;
            }

            if (isUp || isDown || isLeft || isRight) {
                scene.handleMove({ up: isUp, down: isDown, left: isLeft, right: isRight });
            }
        }
    };
    window._OptionsInputManager = OptionsInputManager;

    //=========================================================================
    // Rendering
    //=========================================================================
    Scene_Options.prototype._optionsList = function () {
        return this._optionsWindow._list || [];
    };

    Scene_Options.prototype.refreshTabData = function () {
        this._optionsTabsWindow.select(this._activeTab);
        this._optionsWindow.refresh();
    };

    Scene_Options.prototype.renderTabs = function () {
        const c = this._dndContainer && this._dndContainer.querySelector('#options-categories');
        if (!c) return;
        const it = ConfigManager.language === 'it';
        c.innerHTML = GameOptions.tabs.map((tab, idx) => {
            const dispName = T('GameOptions.label.' + tab.nameKey);
            const icon = pickIcon(tab.id);
            return `<div class="backpack-tab" data-tab="${idx}" onclick="SceneManager._scene.selectTab(${idx})">
                        <canvas class="opt-tab-icon" width="18" height="18" data-icon="${icon}"></canvas>
                        <span>${dispName}</span>
                    </div>`;
        }).join('');
        this.drawOptionIcons();
    };

    Scene_Options.prototype.renderOptions = function () {
        const c = this._dndContainer && this._dndContainer.querySelector('#options-list');
        if (!c) return;
        const w = this._optionsWindow;
        const list = this._optionsList();
        const it = ConfigManager.language === 'it';
        const t = (en, i) => it ? i : en;

        if (list.length === 0) {
            c.innerHTML = `<div class="item-grid-empty">${T('GameOptions.noSettingsHere')}</div>`;
            return;
        }

        c.innerHTML = list.map((cmd, idx) => {
            const symbol = cmd.symbol;
            const name = cmd.name;
            const custom = GameOptions._options[symbol];
            const value = w.getConfigValue(symbol);
            const iconHTML = `<canvas class="opt-row-icon" width="20" height="20" data-icon="${pickIcon(symbol)}"></canvas>`;
            const labelHTML = `<span class="option-label">${iconHTML}<span class="option-name">${name}</span></span>`;

            // Number / volume slider. A slider may provide a statusTextFn when the
            // raw 0..100 position is not what the player should read (e.g. enemy
            // difficulty, where the middle means "no change").
            if ((custom && custom.type === 'number') || w.isVolumeSymbol(symbol)) {
                // A stale config can hand back null/NaN; never let that reach the
                // label ("undefined%") or the fill width.
                const num = Number(value);
                const pct = isFinite(num) ? num.clamp(0, 100) : 0;
                const valueStr = (custom && custom.statusTextFn) ? w.statusText(idx) : `${pct}%`;
                return `<div class="option-row option-row--slider" data-idx="${idx}" onclick="SceneManager._scene.focusOption(${idx})">
                            <div class="option-row-head">
                                ${labelHTML}
                                <span class="option-value">${valueStr}</span>
                            </div>
                            <div class="option-slider-bar" onclick="event.stopPropagation(); SceneManager._scene.setSliderValue(${idx}, event)">
                                <div class="option-slider-fill" style="width: ${pct}%"></div>
                            </div>
                        </div>`;
            }

            // Custom select-list options (theme, etc.)
            if (custom && custom.cursorLeftFn && custom.cursorRightFn) {
                const statusStr = w.statusText(idx);
                return `<div class="option-row" data-idx="${idx}" onclick="SceneManager._scene.focusOption(${idx})">
                            ${labelHTML}
                            <span class="option-status-toggle enabled option-select">
                                <span class="arrow-btn" onclick="event.stopPropagation(); SceneManager._scene.decreaseOption(${idx})">◀</span>
                                <span class="option-select-val">${statusStr}</span>
                                <span class="arrow-btn" onclick="event.stopPropagation(); SceneManager._scene.increaseOption(${idx})">▶</span>
                            </span>
                        </div>`;
            }

            // Boolean toggle
            return `<div class="option-row" data-idx="${idx}" onclick="SceneManager._scene.toggleOption(${idx})">
                        ${labelHTML}
                        <span class="option-status-toggle ${value ? 'enabled' : 'disabled'}">${value ? T('GameOptions.active') : T('GameOptions.inactive')}</span>
                    </div>`;
        }).join('');
        this.drawOptionIcons();
    };

    Scene_Options.prototype.renderInspect = function (overrideIdx) {
        const container = this._dndContainer && this._dndContainer.querySelector('#options-inspect');
        if (!container) return;
        const it = ConfigManager.language === 'it';
        const t = (en, i) => it ? i : en;
        const tab = GameOptions.tabs[this._activeTab];
        const tabName = T('GameOptions.label.' + tab.nameKey);
        const w = this._optionsWindow;
        const list = this._optionsList();

        // A hovered row previews its details on the right page without moving the
        // committed selection. Falls back to the selected index when not hovering.
        const hasPreview = overrideIdx != null && !!list[overrideIdx];

        // Tab summary (no option focused, or empty list)
        if ((this._activeSection !== 'options' && !hasPreview) || list.length === 0) {
            container.classList.add('item-inspect--empty');
            container.innerHTML = `
                <div class="title">${tabName}</div>
                <div class="inspect-placeholder-text">${T('GameOptions.settingsInSection', { count: list.length })}</div>
                <div class="inspect-lore">
                    <div class="inspect-bullet-item">${T('GameOptions.pressOrOkToEdit')}</div>
                    <div class="inspect-bullet-item">${T('GameOptions.l1R1SwitchTabs')}</div>
                    <div class="inspect-bullet-item">${T('GameOptions.adjustTheFocusedValue')}</div>
                </div>`;
            return;
        }

        container.classList.remove('item-inspect--empty');
        const idx = hasPreview ? overrideIdx : this._selectedIndex;
        const cmd = list[idx];
        const symbol = cmd.symbol;
        const custom = GameOptions._options[symbol];
        const isNum = (custom && custom.type === 'number') || w.isVolumeSymbol(symbol);
        const isSelect = custom && custom.cursorLeftFn && custom.cursorRightFn;
        const typeLabel = isNum ? T('GameOptions.slider') : isSelect ? T('GameOptions.selection') : T('GameOptions.toggle');

        let valStr;
        if (isNum) valStr = (custom && custom.statusTextFn) ? w.statusText(idx) : w.getConfigValue(symbol) + '%';
        else if (isSelect) valStr = w.statusText(idx);
        else valStr = w.getConfigValue(symbol) ? T('GameOptions.active2') : T('GameOptions.inactive2');

        const ctrlHint = (isNum || isSelect)
            ? T('GameOptions.toAdjust')
            : T('GameOptions.okOrToToggle');

        // Pass the live value so boolean toggles pick on/off art and multi-state
        // selects (Skill Categorization, Enemy Battlers) pick their per-state art.
        const imgVal = isNum ? null : w.getConfigValue(symbol);
        const imgPath = settingsImageFor(symbol, imgVal);
        // The wrapper is dropped outright when the art is missing or is still a
        // blank stub, so no empty frame is left sitting on the page.
        const imgHTML = imgPath
            ? `<div class="opt-inspect-img-wrap"><img class="opt-inspect-img" src="${imgPath}" alt=""
                    onerror="this.parentNode.style.display='none';"
                    onload="if(this.naturalWidth<=2||this.naturalHeight<=2)this.parentNode.style.display='none';"></div>`
            : '';

        // Options whose new value only takes effect after a game restart.
        const RESTART_REQUIRED = ['activeTheme'];
        const restartHTML = RESTART_REQUIRED.includes(symbol)
            ? `<div class="inspect-bullet-item" style="color: var(--border-focus-hover); font-weight: bold;">${T('GameOptions.requiresRestartToApply')}</div>`
            : '';

        // Per-option warnings shown under the value.
        // Per-option warnings live in GameOptions.warn, keyed by option symbol.
        const noteKey = 'GameOptions.warn.' + symbol;
        const noteHTML = T.has(noteKey)
            ? `<div class="inspect-bullet-item" style="color: var(--border-focus-hover); font-weight: bold;">${T(noteKey)}</div>`
            : '';

        // Plain-language explanation of what the option does. `desc.<symbol>` is
        // the general sentence; `descState.<symbol>` is one line per value of a
        // select, with the value in force highlighted. Options with neither key
        // simply render no explanation block.
        const descKey = 'GameOptions.desc.' + symbol;
        const stateKey = 'GameOptions.descState.' + symbol;
        const stateLines = T.has(stateKey) ? T.list(stateKey) : [];
        const curValue = isNum ? -1 : (w.getConfigValue(symbol) | 0);
        const descLines = [];
        if (T.has(descKey)) descLines.push(`<div class="inspect-bullet-item">${T(descKey)}</div>`);
        stateLines.forEach((line, i) => {
            const on = i === curValue;
            const style = on ? ' style="color: var(--border-focus-hover);"' : '';
            descLines.push(`<div class="inspect-bullet-item"${style}>${line}</div>`);
        });
        const descHTML = descLines.length
            ? `<div class="inspect-section-title">${T('GameOptions.howItWorks')}</div>${descLines.join('')}`
            : '';

        container.innerHTML = `
            <div class="inspect-header">
                <div class="inspect-frame"><canvas class="inspect-canvas" width="36" height="36" data-icon="${pickIcon(symbol)}"></canvas></div>
                <div class="inspect-title-box">
                    <div class="inspect-name">${cmd.name}</div>
                    <div class="inspect-rarity" style="color: var(--border-focus-hover);">${tabName} · ${typeLabel}</div>
                </div>
            </div>
            ${imgHTML}
            <div class="inspect-lore">
                ${descHTML}
                <div class="inspect-section-title">${T('GameOptions.currentValue')}</div>
                <div class="inspect-spec-row"><span class="inspect-spec-label">${cmd.name}</span><span class="inspect-spec-value">${valStr}</span></div>
                ${noteHTML}
                <div class="inspect-section-title">${T('GameOptions.controls')}</div>
                <div class="inspect-bullet-item">${ctrlHint}</div>
                <div class="inspect-bullet-item">${T('GameOptions.toBrowse')}</div>
                <div class="inspect-bullet-item">${T('GameOptions.l1R1SwitchTabs2')}</div>
                ${restartHTML}
            </div>`;
        this.drawOptionIcons();
    };

    // Hover preview helpers: render the inspect panel for a hovered row without
    // changing the committed selection. _hoverPreviewIdx guards against redundant
    // re-renders as mouseover bubbles up from a row's child elements.
    Scene_Options.prototype.previewOption = function (index) {
        if (this._hoverPreviewIdx === index) return;
        this._hoverPreviewIdx = index;
        this.renderInspect(index);
    };

    Scene_Options.prototype.clearPreview = function () {
        if (this._hoverPreviewIdx == null) return;
        this._hoverPreviewIdx = null;
        this.renderInspect();
    };

    // Lightweight selection update, no full grid rebuild on plain navigation
    Scene_Options.prototype.updateHighlight = function () {
        if (!this._dndContainer) return;
        const tabEls = this._dndContainer.querySelectorAll('.backpack-tab');
        tabEls.forEach((el, i) => {
            el.classList.toggle('active', i === this._activeTab);
            el.classList.toggle('selected', this._activeSection === 'tabs' && i === this._activeTab);
        });
        const rows = this._dndContainer.querySelectorAll('.option-row');
        rows.forEach((el, i) => {
            el.classList.toggle('active', this._activeSection === 'options' && i === this._selectedIndex);
        });
        if (this._activeSection === 'options') {
            const active = this._dndContainer.querySelector('.option-row.active');
            if (active) active.scrollIntoView({ block: 'nearest' });
        }
        // Real navigation clears any stale hover preview so the next mouseover
        // (even onto the same row) re-renders the right page.
        this._hoverPreviewIdx = null;
        this.renderInspect();
    };

    //=========================================================================
    // Navigation (keyboard / controller -> via OptionsInputManager)
    //=========================================================================
    Scene_Options.prototype.handleMove = function (d) {
        if (this._activeSection === 'tabs') {
            if (d.left) this.cycleTab(-1);
            else if (d.right) this.cycleTab(1);
            else if (d.down) this.enterOptions();
            return;
        }
        // options section (single-column list)
        const total = this._optionsList().length;
        if (d.up) {
            if (this._selectedIndex > 0) {
                this._selectedIndex--;
                SoundManager.playCursor();
                this.updateHighlight();
            } else {
                this._activeSection = 'tabs';
                SoundManager.playCursor();
                this.updateHighlight();
            }
        } else if (d.down) {
            if (this._selectedIndex < total - 1) {
                this._selectedIndex++;
                SoundManager.playCursor();
                this.updateHighlight();
            }
        } else if (d.left) {
            this.adjustValue(-1);
        } else if (d.right) {
            this.adjustValue(1);
        }
    };

    Scene_Options.prototype.handleOk = function () {
        if (this._activeSection === 'tabs') { this.enterOptions(); return; }
        this.activateOption(this._selectedIndex);
    };

    Scene_Options.prototype.handleCancel = function () {
        if (this._activeSection === 'options') {
            this._activeSection = 'tabs';
            SoundManager.playCancel();
            this.updateHighlight();
        } else {
            this.goBack();
        }
    };

    Scene_Options.prototype.enterOptions = function () {
        if (this._optionsList().length === 0) return;
        this._activeSection = 'options';
        this._selectedIndex = 0;
        SoundManager.playCursor();
        this.updateHighlight();
    };

    Scene_Options.prototype.cycleTab = function (dir) {
        const n = GameOptions.tabs.length;
        this._activeTab = (this._activeTab + dir + n) % n;
        this._selectedIndex = 0;
        SoundManager.playCursor();
        this.refreshTabData();
        this.renderTabs();
        this.renderOptions();
        this.updateHighlight();
    };

    // Adjust the focused option's value: number/volume -> slider, select -> cycle, boolean -> toggle
    Scene_Options.prototype.adjustValue = function (dir) {
        const w = this._optionsWindow;
        const idx = this._selectedIndex;
        const symbol = w.commandSymbol(idx);
        if (!symbol) return;
        const custom = GameOptions._options[symbol];
        w.select(idx);
        const isNum = (custom && custom.type === 'number') || w.isVolumeSymbol(symbol);
        const isSelect = custom && (custom.cursorLeftFn || custom.cursorRightFn);
        if (isNum || isSelect) {
            if (dir > 0) w.cursorRight(false); else w.cursorLeft(false);
        } else {
            w.setConfigValue(symbol, !w.getConfigValue(symbol));
            w.redrawItem(idx);
        }
        SoundManager.playCursor();
        this.renderOptions();
        this.updateHighlight();
    };

    // OK on an option: sliders do nothing; select/boolean advance/toggle
    Scene_Options.prototype.activateOption = function (idx) {
        const w = this._optionsWindow;
        const symbol = w.commandSymbol(idx);
        if (!symbol) return;
        const custom = GameOptions._options[symbol];
        const isNum = (custom && custom.type === 'number') || w.isVolumeSymbol(symbol);
        if (isNum) return;
        this._selectedIndex = idx;
        this.adjustValue(1);
    };

    //=========================================================================
    // Mouse handlers (invoked from inline onclick)
    //=========================================================================
    Scene_Options.prototype.selectTab = function (index) {
        if (index === this._activeTab && this._activeSection === 'tabs') return;
        this._activeTab = index;
        this._selectedIndex = 0;
        this._activeSection = 'tabs';
        SoundManager.playOk();
        this.refreshTabData();
        this.renderTabs();
        this.renderOptions();
        this.updateHighlight();
    };

    Scene_Options.prototype.focusOption = function (index) {
        this._activeSection = 'options';
        this._selectedIndex = index;
        SoundManager.playCursor();
        this.updateHighlight();
    };

    Scene_Options.prototype.toggleOption = function (index) {
        this._activeSection = 'options';
        this._selectedIndex = index;
        this.activateOption(index);
    };

    Scene_Options.prototype.increaseOption = function (index) {
        this._activeSection = 'options';
        this._selectedIndex = index;
        this.adjustValue(1);
    };

    Scene_Options.prototype.decreaseOption = function (index) {
        this._activeSection = 'options';
        this._selectedIndex = index;
        this.adjustValue(-1);
    };

    Scene_Options.prototype.setSliderValue = function (index, event) {
        const w = this._optionsWindow;
        const symbol = w.commandSymbol(index);
        const rect = event.currentTarget.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        let newValue = Math.round((clickX / rect.width) * 100).clamp(0, 100);

        this._activeSection = 'options';
        this._selectedIndex = index;
        w.select(index);
        w.setConfigValue(symbol, newValue);
        w.redrawItem(index);
        SoundManager.playCursor();
        this.renderOptions();
        this.updateHighlight();
    };

    //=========================================================================
    // Lifecycle
    //=========================================================================
    Scene_Options.prototype.update = function () {
        Scene_MenuBase.prototype.update.call(this);
        OptionsInputManager.update();
    };

    Scene_Options.prototype.goBack = function () {
        if (this._closing) return;
        this._closing = true;
        SoundManager.playCancel();
        if (this._dndContainer) {
            this._dndContainer.style.opacity = "0";
            this._dndContainer.style.pointerEvents = "none";
            setTimeout(() => this.popScene(), 220);
        } else {
            this.popScene();
        }
    };

    Scene_Options.prototype.terminate = function () {
        if (this._wasdListener) {
            window.removeEventListener('keydown', this._wasdListener);
            window.removeEventListener('keyup', this._wasdUpListener);
            this._wasdListener = this._wasdUpListener = null;
        }
        OptionsInputManager.deactivate();
        ConfigManager.save();
        if (this._dndContainer) {
            if (this._dndContainer.parentNode) {
                this._dndContainer.parentNode.removeChild(this._dndContainer);
            }
            this._dndContainer = null;
        }
        const style = document.getElementById("options-styles");
        if (style) style.remove();
        const fonts = document.getElementById("fonts");
        if (fonts) fonts.remove();
        Scene_MenuBase.prototype.terminate.call(this);
    };

    //=========================================================================
    // Mute BGM (sits right above the BGM Volume slider in the Audio tab)
    //=========================================================================
    // A plain toggle: turning it on drops bgmVolume to 0 (which stops the
    // playing track immediately, since ConfigManager.bgmVolume writes straight
    // through to AudioManager), turning it off restores the volume the player
    // had before muting. The state is derived from bgmVolume itself, so
    // dragging the slider back up unmutes the toggle with no extra bookkeeping.
    GameOptions.registerOption('bgmMute', T('GameOptions.label.muteBgm'),
        () => ConfigManager.bgmVolume === 0,
        (value) => {
            if (value) {
                if (ConfigManager.bgmVolume > 0) {
                    ConfigManager.bgmVolumeBeforeMute = ConfigManager.bgmVolume;
                }
                ConfigManager.bgmVolume = 0;
            } else {
                const prev = ConfigManager.bgmVolumeBeforeMute;
                ConfigManager.bgmVolume = (prev > 0) ? prev : defaultBgmVolume;
            }
        },
        'audio', 'boolean');

    // Register Footsteps Volume (Merged from VolumePercentageDisplay).
    // The getter defends against a null/NaN value inherited from an older
    // config, which would otherwise render as "undefined%".
    GameOptions.registerOption('footstepsVolume', T('GameOptions.label.footstepsVolume'),
        () => {
            const v = Number(ConfigManager.footstepsVolume);
            return isFinite(v) ? v : defaultFootstepsVolume;
        },
        (value) => ConfigManager.footstepsVolume = value,
        'audio', 'number');

    // Enemy battler display mode: cycle 2D -> 3D -> Sprites. Replaces the old
    // standalone Char-based Sprites toggle (Sprites == that behaviour).
    // 3D (the procedural models) is the default.
    const enemyBattlerNames = () => T.list('GameOptions.enemyBattler');
    const setEnemyBattlers = (v) => {
        ConfigManager.enemyBattlers = v;
        ConfigManager.charBasedSprites = (v === 2); // keep the legacy mirror in sync
    };
    GameOptions.registerOption('enemyBattlers', T('GameOptions.label.enemyBattlers'),
        () => ConfigManager.enemyBattlers !== undefined ? ConfigManager.enemyBattlers : 1,
        (value) => setEnemyBattlers(value),
        'video', 'boolean',
        (value) => enemyBattlerNames()[value] || enemyBattlerNames()[1],
        function () {
            let v = this.getConfigValue('enemyBattlers');
            if (v === undefined) v = 1;
            v = (v + 1) % 3;
            this.setConfigValue('enemyBattlers', v);
        },
        function () {
            let v = this.getConfigValue('enemyBattlers');
            if (v === undefined) v = 1;
            v = (v - 1 + 3) % 3;
            this.setConfigValue('enemyBattlers', v);
        }
    );

    // Register Show FPS
    GameOptions.registerOption('showFps', T('GameOptions.label.showFps'),
        () => ConfigManager.showFps,
        (value) => {
            ConfigManager.showFps = value;
            if (Graphics._fpsCounter) {
                if (value) {
                    Graphics._fpsCounter._boxDiv.style.display = "block";
                    Graphics._fpsCounter._showFps = true;
                } else {
                    Graphics._fpsCounter._boxDiv.style.display = "none";
                }
                Graphics._fpsCounter._update();
            }
        },
        'video', 'boolean');

    // Register Theme Switcher
    const themes = GameOptions.getThemes();
    const themeNames = themes.map(t => {
        const baseName = t.replace('.css', '');
        return baseName.split(/[_-]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    });

    GameOptions.registerOption('activeTheme', T('GameOptions.label.activeTheme'),
        () => ConfigManager.activeTheme !== undefined ? ConfigManager.activeTheme : 0,
        (value) => {
            ConfigManager.activeTheme = value;
            // Persist only; live application bleeds the freshly loaded theme's
            // classes/tokens onto the current scene. Takes effect on restart.
            GameOptions.persistTheme(value);
        },
        'video', 'boolean',
        (value) => themeNames[value] || themeNames[0],
        function () {
            let v = this.getConfigValue('activeTheme');
            v = (v + 1) % themeNames.length;
            this.setConfigValue('activeTheme', v);
        },
        function () {
            let v = this.getConfigValue('activeTheme');
            v = (v - 1 + themeNames.length) % themeNames.length;
            this.setConfigValue('activeTheme', v);
        }
    );

    GameOptions.registerOption('weaponSprites3D', T('GameOptions.label.weaponSprites3d'),
        () => ConfigManager.weaponSprites3D,
        (value) => ConfigManager.weaponSprites3D = value,
        'experimental', 'boolean');

    // Roguelike deck combat (BattleSystem/RoguelikeCardSystem.js) and tactical
    // map battle (BattleSystem/MapBattleMode.js) are alternate battle layers:
    // both replace the standard battle scene, so turning one on turns the other
    // off. Off by default; the new value is picked up by the next battle (the
    // running battle keeps the mode it started with).
    GameOptions.registerOption('cardCombat', T('GameOptions.label.cardCombat'),
        () => ConfigManager.cardCombat === true,
        (value) => {
            ConfigManager.cardCombat = !!value;
            if (value) ConfigManager.mapBattleMode = false;
        },
        'experimental', 'boolean');

    // Map Battle replaces the standard battle scene the same way card combat
    // does, so it sits next to it under Experimental. Off by default; it is
    // still offered up front as a combat mode during character creation.
    GameOptions.registerOption('mapBattleMode', T('GameOptions.label.mapBattle'),
        () => ConfigManager.mapBattleMode === true,
        (value) => {
            ConfigManager.mapBattleMode = !!value;
            if (value) ConfigManager.cardCombat = false;
        },
        'experimental', 'boolean');

    //=========================================================================
    // Retro shader options (the low-poly/low-res 3D shader, PSXShader.js)
    //=========================================================================
    // Master toggle.
    GameOptions.registerOption('retroEnabled', T('GameOptions.label.retroShader'),
        () => ConfigManager.retroEnabled,
        (value) => { ConfigManager.retroEnabled = value; applyRetroConfig(); },
        'shader', 'boolean');

    // Internal render resolution slider (lower = more pixelated). 100% disables
    // the low-res downsample pass entirely.
    GameOptions.registerOption('retroDownscale', T('GameOptions.label.renderResolution'),
        () => ConfigManager.retroDownscale != null ? ConfigManager.retroDownscale : RETRO_DEFAULTS.downscale,
        (value) => { ConfigManager.retroDownscale = value; applyRetroConfig(); },
        'shader', 'number');

    // Dither strength slider.
    GameOptions.registerOption('retroDither', T('GameOptions.label.dithering'),
        () => ConfigManager.retroDither != null ? ConfigManager.retroDither : RETRO_DEFAULTS.dither,
        (value) => { ConfigManager.retroDither = value; applyRetroConfig(); },
        'shader', 'number');

    // Color depth select (shades per channel; fewer = more banding).
    const RETRO_COLOR_MIN = 2, RETRO_COLOR_MAX = 64, RETRO_COLOR_STEP = 2;
    GameOptions.registerOption('retroColorLevels', T('GameOptions.label.colorLevels'),
        () => ConfigManager.retroColorLevels != null ? ConfigManager.retroColorLevels : RETRO_DEFAULTS.colorLevels,
        (value) => { ConfigManager.retroColorLevels = value; applyRetroConfig(); },
        'shader', 'boolean',
        (value) => String(value),
        function () {
            let v = this.getConfigValue('retroColorLevels');
            v = Math.min(RETRO_COLOR_MAX, v + RETRO_COLOR_STEP);
            this.setConfigValue('retroColorLevels', v);
        },
        function () {
            let v = this.getConfigValue('retroColorLevels');
            v = Math.max(RETRO_COLOR_MIN, v - RETRO_COLOR_STEP);
            this.setConfigValue('retroColorLevels', v);
        }
    );

    // Vertex snap grid select (lower = chunkier wobble).
    const RETRO_SNAP_MIN = 40, RETRO_SNAP_MAX = 300, RETRO_SNAP_STEP = 10;
    GameOptions.registerOption('retroVertexSnap', T('GameOptions.label.vertexSnap'),
        () => ConfigManager.retroVertexSnap != null ? ConfigManager.retroVertexSnap : RETRO_DEFAULTS.vertexSnap,
        (value) => { ConfigManager.retroVertexSnap = value; applyRetroConfig(); },
        'shader', 'boolean',
        (value) => String(value),
        function () {
            let v = this.getConfigValue('retroVertexSnap');
            v = Math.min(RETRO_SNAP_MAX, v + RETRO_SNAP_STEP);
            this.setConfigValue('retroVertexSnap', v);
        },
        function () {
            let v = this.getConfigValue('retroVertexSnap');
            v = Math.max(RETRO_SNAP_MIN, v - RETRO_SNAP_STEP);
            this.setConfigValue('retroVertexSnap', v);
        }
    );

    //=========================================================================
    // Interface scaling (Video tab)
    //=========================================================================
    // Stepped selects rather than 0..100 sliders: the useful range is 70..150%,
    // which the plain slider row cannot express.
    const registerScaleOption = (symbol, name) => {
        const step = (dir) => function () {
            const v = clampScale(this.getConfigValue(symbol) + dir * SCALE_STEP);
            this.setConfigValue(symbol, v);
        };
        GameOptions.registerOption(symbol, name,
            () => clampScale(ConfigManager[symbol]),
            (value) => { ConfigManager[symbol] = clampScale(value); applyInterfaceScale(); },
            'video', 'boolean',
            (value) => clampScale(value) + '%',
            step(1), step(-1)
        );
    };
    registerScaleOption('uiScale', T('GameOptions.label.uiScaling'));
    registerScaleOption('fontScale', T('GameOptions.label.fontScaling'));

    // Title Screen Background switcher (select between the floating-card,
    // 3D planet, or 3D procedural weapon backgrounds; Random reshuffles each launch)
    const titleBgNames = () => T.list('GameOptions.titleBackground');
    // Cycle order as seen by the player: Hyperverse (the default) first, Camper
    // Drive second, then the rest, with Random always last. The stored config
    // ids keep their original numbering so existing configs stay valid; only the
    // order they are stepped through changes. Mirrors
    // Scene_Title.getAvailableBackgroundModes in Titlescreen.js.
    const TITLE_BG_ORDER = [7, 8, 1, 2, 4, 3, 5, 6, 0];
    const stepTitleBg = (v, dir) => {
        let i = TITLE_BG_ORDER.indexOf(v);
        if (i < 0) i = 0;
        return TITLE_BG_ORDER[(i + dir + TITLE_BG_ORDER.length) % TITLE_BG_ORDER.length];
    };
    GameOptions.registerOption('titleBackground', T('GameOptions.label.titleBackground'),
        () => ConfigManager.titleBackground !== undefined ? ConfigManager.titleBackground : 7,
        (value) => ConfigManager.titleBackground = value,
        'video', 'boolean',
        (value) => titleBgNames()[value] || titleBgNames()[0],
        function () {
            this.setConfigValue('titleBackground', stepTitleBg(this.getConfigValue('titleBackground'), 1));
        },
        function () {
            this.setConfigValue('titleBackground', stepTitleBg(this.getConfigValue('titleBackground'), -1));
        }
    );

    // Enemy Spawn Mode select (0 Balanced default, 1 Realistic). Consumed by
    // BattleSystemEnhancedEncounters.js via BSE.Helpers.getSpawnMode().
    const enemySpawnNames = () => T.list('GameOptions.enemySpawn');
    GameOptions.registerOption('enemySpawnMode', T('GameOptions.label.enemySpawn'),
        () => ConfigManager.enemySpawnMode !== undefined ? ConfigManager.enemySpawnMode : 0,
        (value) => ConfigManager.enemySpawnMode = value,
        'gameplay', 'boolean',
        (value) => enemySpawnNames()[value] || enemySpawnNames()[0],
        function () {
            let v = this.getConfigValue('enemySpawnMode');
            if (v === undefined) v = 0;
            v = (v + 1) % 2;
            this.setConfigValue('enemySpawnMode', v);
        },
        function () {
            let v = this.getConfigValue('enemySpawnMode');
            if (v === undefined) v = 0;
            v = (v - 1 + 2) % 2;
            this.setConfigValue('enemySpawnMode', v);
        }
    );

    //=========================================================================
    // Enemy Difficulty slider (buff / nerf every enemy parameter)
    //=========================================================================
    // Slider stays a plain 0..100 number so it renders (and click-drags) like
    // the volume sliders; the displayed value is the signed stat percentage.
    GameOptions.registerOption('enemyDifficulty', T('GameOptions.label.enemyDifficulty'),
        () => ConfigManager.enemyDifficulty != null ? ConfigManager.enemyDifficulty : ENEMY_DIFFICULTY_DEFAULT,
        (value) => ConfigManager.enemyDifficulty = value,
        'gameplay', 'number',
        (value) => enemyDifficultyLabel(value));

    // Scale enemy parameters at paramBase so buffs/states and Health_Core's
    // limb-damage modifiers (which hook Game_Enemy.param) still layer on top of
    // the adjusted base. Enemies already in a running battle keep the stats they
    // were built with; the new value applies from the next battle on.
    const _Game_Enemy_paramBase_difficulty = Game_Enemy.prototype.paramBase;
    Game_Enemy.prototype.paramBase = function (paramId) {
        const base = _Game_Enemy_paramBase_difficulty.call(this, paramId);
        const mult = GameOptions.enemyStatMultiplier();
        if (mult === 1) return base;
        return Math.round(base * mult);
    };

    //=========================================================================
    // CPU Party Members (auto-control every party member except the leader)
    //=========================================================================
    // Registered here, consumed via the Game_Actor.isAutoBattle override below.
    GameOptions.registerOption('cpuPartyMembers', T('GameOptions.label.cpuPartyMembers'),
        () => ConfigManager.cpuPartyMembers,
        (value) => ConfigManager.cpuPartyMembers = value,
        'gameplay', 'boolean');

    // When the option is on, treat any in-battle actor that isn't the party
    // leader (first member) as auto-battle. This is the same mechanism the
    // SummonSystem uses for summoned actors: isAutoBattle() true makes
    // canInput() false (no command window) and makeActions() auto-selects
    // actions via makeAutoBattleActions(), so no changes to the battle turn
    // loop or command windows are needed.
    // Apply the interface scale once at load as well: a config that fails to
    // load never reaches applyData, and the menus should still open at a sane
    // (100%) scale rather than with the tokens unset.
    applyInterfaceScale();

    // A second human is playing: local split-screen (SplitScreenMultiplayer.js)
    // or a live network session (MultiplayerSystem.js drives switch 66
    // "connected" and switch 67 "multiplayer mode"). Shared with
    // BattleSystem/MapBattleMode.js, which asks the same question about the
    // tactical command menu.
    window.isMultiplayerSession = function () {
        const ss = window.SplitScreenManager || window.$gameSplitScreen;
        if (ss && ss.active) return true;
        if (window.$gameSwitches) {
            if ($gameSwitches.value(66) || $gameSwitches.value(67)) return true;
        }
        const nm = window.NetworkManager;
        return !!(nm && nm.isConnected && nm.isConnected());
    };

    // The option's effective state. Ignored outright in multiplayer: party slot
    // 2 (and beyond) is the OTHER player's character there, and handing it to the
    // auto-battle AI would take the controller out of their hands.
    window.isCpuPartyMembersActive = function () {
        return ConfigManager.cpuPartyMembers === true && !window.isMultiplayerSession();
    };

    const _Game_Actor_isAutoBattle_cpuParty = Game_Actor.prototype.isAutoBattle;
    Game_Actor.prototype.isAutoBattle = function () {
        if (window.isCpuPartyMembersActive() && $gameParty.inBattle()
            && this !== $gameParty.leader()) {
            return true;
        }
        return _Game_Actor_isAutoBattle_cpuParty.call(this);
    };

})();
