//=============================================================================
// MPP_SmoothBattleLog2_VerticalScaleAnimation.js
//=============================================================================
// Copyright (c) 2018 Mokusei Penguin
// Modified to include color-coded names and vertical scale animation
// Released under the MIT license
// http://opensource.org/licenses/mit-license.php
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Change the display method and behavior of the battle log with name highlighting and vertical scale animation.
 * @author Mokusei Penguin (Modified)
 * @url
 *
 * @help [version 2.2]
 * This plugin is for RPG Maker MZ.
 * 
 * ▼ Overview
 *  - By making the battle log display method cumulative, sentences will not
 *    disappear immediately even if the log progresses quickly.
 *  - You can check the battle past log from the party command.
 *  - Character names are color-coded: All actors are blue and enemies are red.
 *  - Magic, ability, and item names appear in white.
 *  - Battle log has a vertical scale animation from the middle when appearing and disappearing.
 *  - Battle log starts hidden at the beginning of battle.
 * 
 * ▼ Log Type
 *  〇 all
 *   - The battle log window disappears after a certain amount of time has
 *     passed since the last log was displayed.
 *  〇 1-line
 *   - The logs are deleted in order from the log that has passed a certain
 *     period of time since it was displayed.
 *
 * @param Log Type
 * @desc 
 * @type select
 * @option all
 * @option 1-line
 * @default 1-line
 * 
 * @param Max Lines
 * @desc Maximum number of lines displayed in the battle log
 * @type number
 * @min 1
 * @default 4
 * 
 * @param Message Speed
 * @desc Battle log display speed
 * @type number
 * @default 8
 * 
 * @param View Duration
 * @desc Battle log display time
 * (0:Always displayed)
 * @type number
 * @default 150
 * 
 * @param Font Size
 * @desc The size of the characters in the battle log
 * @type number
 * @min 6
 * @default 26
 * 
 * @param Wait New Line?
 * @desc Whether or not there is a weight when a new log is added.
 * If it behaves strangely, enable it.
 * @type boolean
 * @default false
 * 
 * @param Start Messages On Log?
 * @desc Whether to display the battle start message in the log
 * @type boolean
 * @default false
 * 
 * @param Log Command
 * @desc Command name to display battle past log
 * (Hide when empty)
 * @default Battle Log
 * 
 * @param Animation Speed
 * @desc Speed of the vertical scale animation (higher = faster)
 * @type number
 * @min 1
 * @default 5
 *
 * @param Battle Log BG Opacity
 * @desc Opacity of the battle log background (0-100%)
 * @type number
 * @min 0
 * @max 100
 * @default 0
 *
 */

(() => {
    'use strict';
    
    // Plugin Parameters
    const pluginName = 'MPP_SmoothBattleLog2_FadeEnhancements';
    const params = PluginManager.parameters(pluginName);
    
    const CONFIG = {
        logType: params['Log Type'] || '1-line',
        maxLines: 6,
        messageSpeed: Number(params['Message Speed'] || 8),
        fontSize: Number(params['Font Size'] || 26),
        viewDuration: -1,
        waitNewLine: params['Wait New Line?'] === 'true',
        startMessagesOnLog: params['Start Messages On Log?'] === 'true',
        logCommand: params['Log Command'] || '',
        animationSpeed: Number(params['Animation Speed'] || 8),
        battleLogBgOpacity: Number(params['Battle Log BG Opacity'] ?? 0),
        colors: {
            actor: 1,   // Bright gold for actors
            actor2: 4,  // Bright gold for Actor 2
            actor3: 5,  // Bright gold for Actor 3
            enemy: 2,   // Red for enemies
            item: 0     // White for ability/magic/item names
        }
    };
    
    // Element ID (1-9) → color index in colorMap (10-18)
    const ELEMENT_COLORS = {
        1: 10,  // Physical
        2: 11,  // Fire
        3: 12,  // Ice
        4: 13,  // Thunder
        5: 14,  // Water
        6: 15,  // Petro
        7: 16,  // Wind
        8: 17,  // Sacred
        9: 18   // Cursed
    };

    // Helper Functions
    // Canvas element + scale are cached; recomputed on window resize or when the
    // internal Graphics size changes, instead of getElementById +
    // getBoundingClientRect every battle frame.
    let _msgCanvasEl = null;
    let _msgScaleCache = null;
    window.addEventListener('resize', () => { _msgScaleCache = null; });

    function _msgGetScale() {
        if (_msgScaleCache &&
            _msgScaleCache.gw === Graphics.width &&
            _msgScaleCache.gh === Graphics.height) {
            return _msgScaleCache;
        }
        if (!_msgCanvasEl || !_msgCanvasEl.isConnected) {
            _msgCanvasEl = document.getElementById('gameCanvas');
        }
        if (!_msgCanvasEl) return { sx: 1, sy: 1, ox: 0, oy: 0, gw: 0, gh: 0 };
        const r = _msgCanvasEl.getBoundingClientRect();
        _msgScaleCache = {
            sx: r.width / Graphics.width,
            sy: r.height / Graphics.height,
            ox: r.left,
            oy: r.top,
            gw: Graphics.width,
            gh: Graphics.height
        };
        return _msgScaleCache;
    }

    // Writes a style property only when its value changed, tracking last-applied
    // values on a per-element cache. `important` uses setProperty with priority.
    function _setStyleIfChanged(el, prop, value, important) {
        const cache = el._sblStyleCache || (el._sblStyleCache = {});
        if (cache[prop] === value) return;
        cache[prop] = value;
        if (important) {
            el.style.setProperty(prop, value, 'important');
        } else {
            el.style[prop] = value;
        }
    }

    const BATTLELOG_COLOR_MAP = {
        0: '#FFFFFF',
        1: '#FFD700',  // bright gold, party members
        2: '#EF4444',  // red, enemies
        3: '#0ea5e9',
        4: '#FFD700',  // gold, actor2
        5: '#FFD700',  // gold, actor3
        6: '#d97706',
        7: '#4b5563',
        10: '#AAAAAA',
        11: '#FF6622',
        12: '#88CCFF',
        13: '#FFE030',
        14: '#4499FF',
        15: '#AA8855',
        16: '#77DD55',
        17: '#FFEEAA',
        18: '#BB44CC',
        23: '#4ade80',
        24: '#ef4444',
        25: '#a855f7',
    };

    function parseColorCodes(text) {
        let html = '';
        let lastIndex = 0;
        // Support both numeric palette indices (\c[3]) and raw hex colors (\c[#6C5CE7])
        const regex = /\\c\[(#[0-9A-Fa-f]{3,8}|\d+)\]/gi;
        let match;
        let openSpan = false;
        while ((match = regex.exec(text)) !== null) {
            const seg = text.substring(lastIndex, match.index);
            if (seg) html += seg;
            if (openSpan) { html += '</span>'; openSpan = false; }
            const token = match[1];
            const color = token.charAt(0) === '#'
                ? token
                : (BATTLELOG_COLOR_MAP[parseInt(token, 10)] || BATTLELOG_COLOR_MAP[0]);
            html += `<span style="color:${color};">`;
            openSpan = true;
            lastIndex = regex.lastIndex;
        }
        const tail = text.substring(lastIndex);
        if (tail) html += tail;
        if (openSpan) html += '</span>';
        return html;
    }

    function parseBattleLogTextToHtml(text) {
        if (!text) return '';
        // Split multi-line entries (action header + per-reaction lines) into separate divs
        const segments = text.split('\n');
        let result = '';
        for (let seg of segments) {
            // Extract per-segment mx indentation
            let indentPx = 0;
            const mxMatch = seg.match(/\\mx\[(\d+)\]/i);
            if (mxMatch) {
                indentPx = parseInt(mxMatch[1], 10);
                seg = seg.replace(/\\mx\[\d+\]/gi, '');
            }
            seg = seg
                .replace(/\\v\[\d+\]/gi, '')
                .replace(/\\i\[\d+\]/gi, '')
                .replace(/\\n\[\d+\]/gi, '')
                .replace(/\\n/g, '<br/>')
                .replace(/\n/g, '<br/>');
            const styleAttr = indentPx > 0 ? ` style="padding-left:${indentPx}px;"` : '';
            result += `<div class="battlelog-line"${styleAttr}>${parseColorCodes(seg)}</div>`;
        }
        return result;
    }

    // Read a state's <Hex: #RRGGBB> color from its note (used to tint status words)
    function getStateHexColor(state) {
        if (!state || !state.note) return null;
        const m = state.note.match(/<Hex:\s*(#[0-9A-Fa-f]{3,8})>/i);
        return m ? m[1] : null;
    }

    const __base = (obj, prop) => {
        if (obj.hasOwnProperty(prop)) {
            return obj[prop];
        } else {
            const proto = Object.getPrototypeOf(obj);
            return function() { return proto[prop].apply(this, arguments); };
        }
    };
    function _getStarIndex(subject) {
        if (!subject) return 0; // no bound battler (system/log message): use safe default
        if (subject.isActor && subject.isActor()) {
          // Map actor IDs to variable IDs
          const map = { 1: 38, 2: 39, 3: 40 };
          const varId = map[subject.actorId()] || null;
          const val = varId ? $gameVariables.value(varId) : 0;
          return val;
        }
        /*
        if (subject._gender !== undefined) {
          return subject._gender;
        }*/
        return 0; // fallback
      }
      function _replaceStars(text, subject) {
        const idx = _getStarIndex(subject);
        const table = { 0: 'o', 1: 'a', 2: '*' };
        const ch = table[idx] || 'o';
        return text.replace(/\*/g, ch);
      }
      
      
    // Optimize: Precompute triangular numbers for common values
    const TRI_CACHE_SIZE = 50;
    const triCache = Array(TRI_CACHE_SIZE).fill(0).map((_, i) => i * (i + 1) / 2);
    const formulaTri = n => {
        return n < TRI_CACHE_SIZE ? triCache[n] : n * (n + 1) / 2;
    };

    //-------------------------------------------------------------------------
    // ConfigManager - Battle Log BG Opacity Setting
    //-------------------------------------------------------------------------

    Object.defineProperty(ConfigManager, 'battleLogBgOpacity', {
        get: function() {
            return this._battleLogBgOpacity !== undefined ? this._battleLogBgOpacity : CONFIG.battleLogBgOpacity;
        },
        set: function(value) {
            this._battleLogBgOpacity = value;
        },
        configurable: true
    });

    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function() {
        const config = _ConfigManager_makeData.call(this);
        config.battleLogBgOpacity = this.battleLogBgOpacity;
        return config;
    };

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function(config) {
        _ConfigManager_applyData.call(this, config);
        this.battleLogBgOpacity = config.battleLogBgOpacity !== undefined ? config.battleLogBgOpacity : CONFIG.battleLogBgOpacity;
    };

    //-------------------------------------------------------------------------
    // Window_Options - Add Battle Log BG Opacity Option
    //-------------------------------------------------------------------------

    if (window.GameOptions) {
        window.GameOptions.registerOption('battleLogBgOpacity', T('BattleLog.bgOpacity'), 
            () => ConfigManager.battleLogBgOpacity,
            (value) => ConfigManager.battleLogBgOpacity = value,
            'gameplay', 'custom',
            function(value) { return value + "%"; },
            function() { 
                const last = ConfigManager.battleLogBgOpacity;
                const value = Math.min(last + 10, 100);
                ConfigManager.battleLogBgOpacity = value;
                ConfigManager.save();
            },
            function() { 
                const last = ConfigManager.battleLogBgOpacity;
                const value = Math.max(last - 10, 0);
                ConfigManager.battleLogBgOpacity = value;
                ConfigManager.save();
            }
        );
    } else {
        const _Window_Options_addGeneralOptions = Window_Options.prototype.addGeneralOptions;
        Window_Options.prototype.addGeneralOptions = function() {
            _Window_Options_addGeneralOptions.call(this);
            this.addCommand(T('BattleLog.bgOpacity'), "battleLogBgOpacity");
        };

        const _Window_Options_statusText = Window_Options.prototype.statusText;
        Window_Options.prototype.statusText = function(index) {
            const symbol = this.commandSymbol(index);
            if (symbol === "battleLogBgOpacity") {
                return this.getConfigValue(symbol) + "%";
            }
            return _Window_Options_statusText.call(this, index);
        };

        const _Window_Options_processOk = Window_Options.prototype.processOk;
        Window_Options.prototype.processOk = function() {
            const index = this.index();
            const symbol = this.commandSymbol(index);
            if (symbol === "battleLogBgOpacity") {
                const value = this.getConfigValue(symbol);
                this.changeValue(symbol, (value + 10) % 110);
                return;
            }
            _Window_Options_processOk.call(this);
        };

        const _Window_Options_cursorRight = Window_Options.prototype.cursorRight;
        Window_Options.prototype.cursorRight = function() {
            const index = this.index();
            const symbol = this.commandSymbol(index);
            if (symbol === "battleLogBgOpacity") {
                const value = this.getConfigValue(symbol);
                this.changeValue(symbol, Math.min(value + 10, 100));
                return;
            }
            _Window_Options_cursorRight.call(this);
        };

        const _Window_Options_cursorLeft = Window_Options.prototype.cursorLeft;
        Window_Options.prototype.cursorLeft = function() {
            const index = this.index();
            const symbol = this.commandSymbol(index);
            if (symbol === "battleLogBgOpacity") {
                const value = this.getConfigValue(symbol);
                this.changeValue(symbol, Math.max(value - 10, 0));
                return;
            }
            _Window_Options_cursorLeft.call(this);
        };
    }

    //-------------------------------------------------------------------------
    // Game_Temp - Battle Log History Storage
    //-------------------------------------------------------------------------
    
    const _Game_Temp_initialize = Game_Temp.prototype.initialize;
    Game_Temp.prototype.initialize = function() {
        _Game_Temp_initialize.apply(this, arguments);
        this._battleLog = [];
    };

    Game_Temp.prototype.clearBattleLog = function() {
        this._battleLog = [];
    };

    Game_Temp.prototype.battleLog = function() {
        return this._battleLog;
    };

    Game_Temp.prototype.addBattleLog = function(text) {
        this._battleLog.push(text);
        if (this._battleLog.length > 100) this._battleLog.shift();
    };

    //-------------------------------------------------------------------------
    // Name Cache Systems - Optimize color-coding
    //-------------------------------------------------------------------------
    
    // Cache for colored names - avoids repeated string replacements
    const NameColorCache = new class {
        constructor() {
            this.initialize();
        }
        
        initialize() {
            this._actorCache = new Map();
            this._enemyCache = new Map();
            this._abilityCache = new Map();
            this._initialized = false;
        }
        
        buildCache() {
            if (this._initialized) return;
            
            // Cache actor names
            const actors = $gameParty.battleMembers();
            actors.forEach(actor => {
                if (!actor || !actor.name()) return;
                
                const name = actor.name();
                if (actor.actorId() === 2) {
                    this._actorCache.set(name, `\\c[${CONFIG.colors.actor2}]${name}\\c[0]`);
                } else if (actor.actorId() === 3) {
                    this._actorCache.set(name, `\\c[${CONFIG.colors.actor3}]${name}\\c[0]`);
                } else {
                    this._actorCache.set(name, `\\c[${CONFIG.colors.actor}]${name}\\c[0]`);
                }
            });
            
            // Skip enemy name caching - all enemies will be displayed as "Enemy"
            
            // Cache skill and item names
            const skills = $dataSkills.filter(skill => skill && skill.name);
            const items = $dataItems.filter(item => item && item.name);
            
            [...skills, ...items].forEach(item => {
                if (!item || !item.name || item.name.length <= 1) return;
                const name = item.name;
                this._abilityCache.set(name, `\\c[${CONFIG.colors.item}]${name}\\c[0]`);
            });
            
            this._initialized = true;
        }
        
        // Get the colored version of a name, or null if not found
        getColoredName(name) {
            if (this._actorCache.has(name)) return this._actorCache.get(name);
            if (this._enemyCache.has(name)) return this._enemyCache.get(name);
            if (this._abilityCache.has(name)) return this._abilityCache.get(name);
            return null;
        }
        
        // Get colored name for a specific entity
        getActorName(actor) {
            if (!actor) return '';
            const name = actor.name();
            const translatedName = typeof window.translateText === 'function' ? window.translateText(name) : name;
            
            let color = CONFIG.colors.actor;
            if (actor.actorId() === 2) color = CONFIG.colors.actor2;
            if (actor.actorId() === 3) color = CONFIG.colors.actor3;

            return `\\c[${color}]${translatedName}\\c[0]`;
        }
        
        getEnemyName(enemy) {
            if (!enemy) return '';
            const name = enemy.name();
            const translatedName = typeof window.translateText === 'function' ? window.translateText(name) : name;
            return `\\c[${CONFIG.colors.enemy}]${translatedName}\\c[0]`;
        }
        
        getItemName(item) {
            if (!item) return '';
            const name = item.name;
            const translatedName = typeof window.translateText === 'function' ? window.translateText(name) : name;
            const elementId = item.damage && item.damage.elementId;
            const colorIdx = ELEMENT_COLORS[elementId] !== undefined ? ELEMENT_COLORS[elementId] : CONFIG.colors.item;
            return `\\c[${colorIdx}]${translatedName}\\c[0]`;
        }
        
        refresh() {
            this.initialize();
        }
    }();

    //-------------------------------------------------------------------------
    // BattleManager - Handle Start Messages
    //-------------------------------------------------------------------------
    const _Game_Enemy_setup = Game_Enemy.prototype.setup;
    Game_Enemy.prototype.setup = function(enemyId, x, y) {
    _Game_Enemy_setup.call(this, enemyId, x, y);
    // 0 = male (o), 1 = female (a)
    //this._gender = this._gender !== undefined ? this._gender : (Math.random() < 0.5 ? 0 : 1);
    };
    const _BattleManager_displayStartMessages = BattleManager.displayStartMessages;
    BattleManager.displayStartMessages = function() {
        if (!CONFIG.startMessagesOnLog) {
            _BattleManager_displayStartMessages.apply(this, arguments);
        }
    };

    BattleManager.displayStartMessagesOnLog = function() {
        // Initialize the name cache
        NameColorCache.buildCache();
        
        // Display enemy emergence with colored names
        for (const name of $gameTroop.enemyNames()) {
            const coloredName = NameColorCache.getColoredName(name) || 
                `\\c[${CONFIG.colors.enemy}]${name}\\c[0]`;
            this._logWindow.push('addText', TextManager.emerge.format(coloredName));
        }
        
        // Display initiative message if applicable
        const message = this.initiativeMessage();
        if (message) {
            this._logWindow.push('wait');
            this._logWindow.push('addText', message);
        }
        this._logWindow.push('clear');
    };

    BattleManager.initiativeMessage = function() {
        if (this._preemptive) {
            return TextManager.preemptive.format($gameParty.name());
        } else if (this._surprise) {
            return TextManager.surprise.format($gameParty.name());
        }
        return null;
    };

    const _BattleManager_endBattle = BattleManager.endBattle;
    BattleManager.endBattle = function(result) {
        _BattleManager_endBattle.apply(this, arguments);
        this._logWindow.clearSmoothBattleLog();
        // Clear name cache when battle ends
        NameColorCache.refresh();
    };

    //-------------------------------------------------------------------------
    // Window_Base - Process Escape Characters
    //-------------------------------------------------------------------------
    
    const _Window_Base_processEscapeCharacter = Window_Base.prototype.processEscapeCharacter;
    Window_Base.prototype.processEscapeCharacter = function(code, textState) {
        if (code === 'MX') {
            textState.x += this.obtainEscapeParam(textState);
        } else if (code === 'CHAR') {
            // Handle character image escape code
            const filename = this.obtainEscapeParam(textState);
            if (filename) {
                try {
                    const charImage = ImageManager.loadBitmap('img/characters/Monsters/', filename);
                    this.contents.blt(
                        charImage,
                        0, 0,                    // src x,y
                        48, 48,                  // src w,h (48x48 crop)
                        textState.x, textState.y, // dest x,y
                        48, 48                   // dest w,h
                    );
                    textState.x = 48;       // move text position
                } catch (error) {
                    console.warn('Character escape image not found:', filename);
                    // Use fallback image
                    try {
                        const fallbackImage = ImageManager.loadBitmap('img/busts/', '7');
                        this.contents.blt(
                            fallbackImage,
                            0, 0,
                            fallbackImage.width,
                            fallbackImage.height,
                            textState.x, textState.y,
                            36, 36
                        );
                        textState.x = 48;
                    } catch (fallbackError) {
                        console.warn('Fallback escape image also not found');
                    }
                }
            }
        } else {
            _Window_Base_processEscapeCharacter.apply(this, arguments);
        }
    };
    
    const _Window_Base_resetFontSettings = __base(Window_Base.prototype, 'resetFontSettings');
    Window_Base.prototype.resetFontSettings = function() {
        _Window_Base_resetFontSettings.apply(this, arguments);
        this.contents.fontSize = CONFIG.fontSize;
    };

    //-------------------------------------------------------------------------
    // Sprite_BattleLog - Individual Log Line Sprite
    //-------------------------------------------------------------------------
    
    function Sprite_BattleLog() {
        this.initialize(...arguments);
    }

    Sprite_BattleLog.prototype = Object.create(Sprite.prototype);
    Sprite_BattleLog.prototype.constructor = Sprite_BattleLog;

    Sprite_BattleLog.prototype.initialize = function(width, height) {
        Sprite.prototype.initialize.call(this);
        this.bitmap = new Bitmap(width, height);
        this._scrollXDuration = 0;
        this._viewDuration = -1;
    };

    // Optimize: Combined update logic for better performance
    Sprite_BattleLog.prototype.update = function(y, max) {
        Sprite.prototype.update.call(this);
        
        // Update durations
        if (this._scrollXDuration > 0) this._scrollXDuration--;
        if (this._viewDuration > 0) this._viewDuration--;
        
        // Calculate positions once
        const height = this.bitmap.height;
        const clampedY = y.clamp(0, max * height);
        
        // Update position
        this.x = this._scrollXDuration > 0 ? formulaTri(this._scrollXDuration) / 2 : 0;
        this.y = clampedY;
        
        // Update frame
        const fy = Math.max(-y, 0);
        this.setFrame(0, fy, this.bitmap.width, height - fy);
        
        // Update opacity - simplified calculation
        this.opacity = 255 - (this._scrollXDuration * 20);
    };

    Sprite_BattleLog.prototype.isPassed = function() {
        return this._viewDuration === 0;
    };

    Sprite_BattleLog.prototype.popup = function(scrollXDuration = 12) {
        this._scrollXDuration = scrollXDuration;
        if (CONFIG.logType === '1-line') {
            this._viewDuration = CONFIG.viewDuration || -1;
        }
    };

    //-------------------------------------------------------------------------
    // Window_BattleLog - Main Battle Log Window
    //-------------------------------------------------------------------------
    

    const _Window_BattleLog_initialize = Window_BattleLog.prototype.initialize;
    Window_BattleLog.prototype.initialize = function(rect) {
        // Wide panel whose left edge lines up with the party sprite column
        // (HUD: PCARD_COL_LEFT 90 - bust offset 22 = ~68). Leaves a right margin for the command menu.
        const customHeight = this.fittingHeight(this.maxLines());
        const customX = 68;
        const customWidth = Math.max(520, Graphics.width - customX - 300);

        // Vertical offset compensation for game centering
        const yOffset = Math.floor((Graphics.height - Graphics.boxHeight) / 2);
        const pad = this.padding || 12;

        // The battle hotbar (BattleSystemEnhancedHUD.js) sits in the same
        // column, just under the log; room for it is reserved here so the
        // two never overlap.
        const hotbarReserve = (window.BattleHotbar && window.BattleHotbar.reservedHeight) || 90;

        // Position at center-bottom of the screen
        const customY = Graphics.height - customHeight - 20 - hotbarReserve - yOffset - pad;

        const customRect = new Rectangle(customX, customY, customWidth, customHeight);
    
        _Window_BattleLog_initialize.call(this, customRect);

        // --- MODIFICATIONS START ---
        this.frameVisible = false; // This line hides the window border.
        // --- MODIFICATIONS END ---

        // Parallel to _lines: which pushed lines are toast-style, i.e. a
        // notification redirected here instead of a floating ParchmentToast
        // while in battle. Kept in lockstep with _lines at every
        // push/shift/clear site below.
        this._lineToast = [];

        this._clearDuration = 0;
        this._logScrollYDuration = 0;
        this._logScrollY = this.lineHeight();
        this.opacity = 0; // Completely transparent canvas window
        this.backOpacity = 0; // No background on canvas
        
        // Animation properties
        this._animationState = 'hidden'; // New property to track animation state
        this._animationTimer = 0; // Timer for animation
        this._originalHeight = customHeight; // Store the original height
        this._originalY = this.y; // Store the original Y position
        this._targetHeight = 0; // Target height (start at 0)
        this.height = 0; // Start with height of 0
        this.visible = false; // Start hidden
    
        this.createLogSprites();
        this.drawBackground();
        
        // Optimization: Initialize and build the color cache when creating the log window
        NameColorCache.buildCache();

        // Remove stale overlay if present
        const old = document.getElementById('html-battlelog-overlay');
        if (old) old.remove();

        // Create the new HTML Battle Log overlay root - styled like DialogueSystem.js
        const root = document.createElement('div');
        root.id = 'html-battlelog-overlay';
        root.style.cssText = 
            'position:fixed;display:none;z-index:400;pointer-events:none;' +
            'box-sizing:border-box;overflow:hidden;' +
            'background:transparent;' +
            'border:none;' +
            'outline:none;';
        this._htmlBattleLogRoot = root;
        document.body.appendChild(root);

        // Hide original sprites
        if (this._logSprites) {
            for (const sprite of this._logSprites) {
                sprite.visible = false;
            }
        }
    };
    

    // Main methods
    Window_BattleLog.prototype.maxLines = function() {
        return 6;
    };

    Window_BattleLog.prototype.messageSpeed = function() {
        return CONFIG.messageSpeed;
    };
    
    Window_BattleLog.prototype.createLogSprites = function() {
        this._logSprites = [];
        const width = this.itemWidth();
        const height = this.itemHeight();
        // Only create the exact number of sprites needed (+1 for shifting)
        for (let i = 0; i <= this.maxLines(); i++) {
            const sprite = new Sprite_BattleLog(width, height);
            this._logSprites[i] = sprite;
            this.addInnerChild(sprite);
        }
    };

    // Color coding utilities
    Window_BattleLog.prototype.colorCharacterNames = function(text) {
        if (!text) return text;

        let modifiedText = text;

        // Use live party members so names set after cache init (e.g. character creation) are caught
        if (typeof $gameParty !== 'undefined' && $gameParty && $gameParty.battleMembers) {
            for (const actor of $gameParty.battleMembers()) {
                if (!actor || !actor.name() || actor.name().length <= 1) continue;
                const name = actor.name();
                let color = CONFIG.colors.actor;
                if (actor.actorId() === 2) color = CONFIG.colors.actor2;
                else if (actor.actorId() === 3) color = CONFIG.colors.actor3;
                try {
                    modifiedText = modifiedText.replace(
                        new RegExp(`\\b${name}\\b`, 'g'),
                        `\\c[${color}]${name}\\c[0]`
                    );
                } catch(e) {}
            }
        }

        // Color skill/item names from cache
        NameColorCache.buildCache();
        for (const [name, replacement] of NameColorCache._abilityCache) {
            if (name && name.length > 1) {
                try {
                    modifiedText = modifiedText.replace(new RegExp(`\\b${name}\\b`, 'g'), replacement);
                } catch(e) {}
            }
        }

        return modifiedText;
    };

    // Text and layout handling
    Window_BattleLog.prototype.indentText = function(text) {
        return text;
    };
    
    Window_BattleLog.prototype.drawBackground = function() {
        // Do nothing to prevent drawing any background onto the contentsBack bitmap
    };

    Window_BattleLog.prototype.backRect = function() {
        return new Rectangle(0, 0, this.innerWidth, this.innerHeight);
    };

    const _Window_BattleLog_lineRect = Window_BattleLog.prototype.lineRect;
    Window_BattleLog.prototype.lineRect = function(index) {
        const rect = _Window_BattleLog_lineRect.apply(this, arguments);
        rect.y = 0;
        return rect;
    };

    // Drawing and text updates
Window_BattleLog.prototype.drawLineText = function(index) {
    const sprite = this._logSprites[index + 1];
    if (sprite) {
        let text = this._lines[index];
        sprite._isToast = !!(this._lineToast && this._lineToast[index]);
        sprite._htmlText = parseBattleLogTextToHtml(text);
    }
};
const _Window_BattleLog_resetFontSettings = Window_BattleLog.prototype.resetFontSettings;
Window_BattleLog.prototype.resetFontSettings = function() {
    _Window_BattleLog_resetFontSettings.apply(this, arguments);
    this.contents.outlineColor = 'rgba(0, 0, 0, 1)'; // Solid black outline
    this.contents.outlineWidth = 2; // Thicker outline (default is 3)
};

    // Core functionality for log line management
    Window_BattleLog.prototype.addText = function(text, isToast) {
        // Apply translation here if translateText is available globally

        if (typeof translateText === 'function') {
            text = translateText(text);
        }
        const coloredText = this.colorCharacterNames(text);
        const indentText = this.indentText(coloredText);

        this._lines.push(indentText);
        if (!this._lineToast) this._lineToast = [];
        this._lineToast.push(!!isToast);
        if (this.numLines() > this.maxLines()) this.shiftLine();

        $gameTemp.addBattleLog(indentText);
        const index = this.numLines() - 1;
        this._logSprites[index + 1].popup();
        this.drawLineText(index);

        // Start scale in if window is hidden
        if (this._animationState === 'hidden' || this._animationState === 'scaling-out') {
            this.startScaleIn();
        }

        this.wait();
        this._clearDuration = 0;
    };

    // A transient notification (ParchmentToast and friends, redirected here
    // while in battle instead of floating over the HUD), drawn as an
    // ordinary combat line.
    Window_BattleLog.prototype.addToast = function(text) {
        this.addText(text, true);
    };

    Window_BattleLog.prototype.appendToActionLine = function(text) {
        if (this._lines.length === 0) {
            this.addText(text);
            return;
        }
        if (typeof translateText === 'function') text = translateText(text);
        if (this._currentSubject) text = _replaceStars(text, this._currentSubject);
        // Reactions to player actions (enemy takes hit): small indent.
        // Reactions to enemy actions (player takes hit): larger indent.
        const lastIndex = this._lines.length - 1;
        this._lines[lastIndex] += '\n' + text;
        this.drawLineText(lastIndex);
        this.wait();
        this._clearDuration = 0;
    };

    Window_BattleLog.prototype.shiftLine = function() {
        this._lines.shift();
        if (this._lineToast) this._lineToast.shift();
        const sprite = this._logSprites.shift();
        sprite.bitmap.clear();
        sprite._htmlText = '';
        this._logSprites.push(sprite);
        // After the shift, _logSprites[0] now holds the removed line's old content.
        // Clear it immediately so it doesn't overlap with _logSprites[1] during the scroll animation.
        if (this._logSprites[0]) {
            this._logSprites[0].bitmap.clear();
            this._logSprites[0]._htmlText = '';
        }
        this._logScrollY -= this.lineHeight();
        this._logScrollYDuration = 16;
    };

    // Animation control methods - Optimized calculations
    Window_BattleLog.prototype.startScaleIn = function() {
        this._animationState = 'scaling-in';
        this._animationTimer = 0;
        this._targetHeight = this._originalHeight;
        this.visible = true;
    };
    
    Window_BattleLog.prototype.startScaleOut = function() {
        if (this._animationState === 'visible') {
            this._animationState = 'scaling-out';
            this._animationTimer = 0;
            this._targetHeight = 0;
        }
    };
    
    // Precompute easing values for common animation progress points
    const EASING_CACHE_SIZE = 100;
    const easedInValues = Array(EASING_CACHE_SIZE).fill(0).map((_, i) => {
        const progress = i / (EASING_CACHE_SIZE - 1);
        return progress * progress; // Quadratic ease-in
    });
    
    const easedOutValues = Array(EASING_CACHE_SIZE).fill(0).map((_, i) => {
        const progress = i / (EASING_CACHE_SIZE - 1);
        return 1 - Math.pow(1 - progress, 3); // Cubic ease-out
    });
    
    Window_BattleLog.prototype.updateScaleAnimation = function() {
        const animSpeed = CONFIG.animationSpeed;
        
        if (this._animationState === 'scaling-in') {
            this._animationTimer += animSpeed;
            
            // Calculate progress (0 to 1)
            const fullDuration = 45;
            const progress = Math.min(1, this._animationTimer / fullDuration);
            
            // Get eased progress from cache or calculate it
            let easedProgress;
            if (progress >= 1) {
                easedProgress = 1;
            } else {
                const index = Math.floor(progress * (EASING_CACHE_SIZE - 1));
                easedProgress = easedOutValues[index];
            }
            
            // Set the new height and adjust y position to grow from the middle
            const newHeight = Math.floor(this._targetHeight * easedProgress);
            const heightDiff = this._originalHeight - newHeight;
            
            this.height = newHeight;
            this.y = this._originalY + (heightDiff / 2);
            
            if (progress >= 1) {
                this.height = this._originalHeight;
                this.y = this._originalY;
                this._animationState = 'visible';
            }
        } else if (this._animationState === 'scaling-out') {
            this._animationTimer += animSpeed;
            
            // Calculate progress (0 to 1)
            const fullDuration = 45;
            const progress = Math.min(1, this._animationTimer / fullDuration);
            
            // Get eased progress from cache or calculate it
            let easedProgress;
            if (progress >= 1) {
                easedProgress = 1;
            } else {
                const index = Math.floor(progress * (EASING_CACHE_SIZE - 1));
                easedProgress = easedInValues[index];
            }
            
            // Set the new height and adjust y position to shrink to the middle
            const newHeight = Math.floor(this._originalHeight * (1 - easedProgress));
            const heightDiff = this._originalHeight - newHeight;
            
            this.height = newHeight;
            this.y = this._originalY + (heightDiff / 2);
            
            if (progress >= 1) {
                this.height = 0;
                this.y = this._originalY + (this._originalHeight / 2);
                this._animationState = 'hidden';
                this.visible = false;
            }
        }
    };

    // Update methods
    const _Window_BattleLog_update = Window_BattleLog.prototype.update;
    Window_BattleLog.prototype.update = function() {
        const yOffset = Math.floor((Graphics.height - Graphics.boxHeight) / 2);
        const pad = this.padding || 12;

        // Bottom, left edge aligned with the party sprite column, pinned every frame.
        // The same hotbar reserve initialize() uses has to be applied here too,
        // or this per-frame pin drops the log straight back onto the bar.
        const hotbarReserve = (window.BattleHotbar && window.BattleHotbar.reservedHeight) || 90;
        const logH = this._originalHeight || this.fittingHeight(this.maxLines());
        this._originalY = Graphics.height - logH - 20 - hotbarReserve - yOffset - pad;
        if (this.y !== this._originalY) {
            this.y = this._originalY;
        }
        // Left-aligned with the party sprite column, except in split-screen
        // battles where the log is centred between the two players' HUDs.
        let targetX = 68;
        if (window.$gameSplitScreen && window.$gameSplitScreen.active) {
            targetX = Math.floor((Graphics.width - this.width) / 2);
        }
        if (this.x !== targetX) {
            this.x = targetX;
        }
        
        _Window_BattleLog_update.apply(this, arguments);
        this.updateLogScroll();
        this.updateLogSprites();
        this.updateScaleAnimation();

        // Keep canvas elements invisible
        this.opacity = 0;
        this.backOpacity = 0;
        this.frameVisible = false;
        if (this._contentsBackSprite) {
            this._contentsBackSprite.visible = false;
        }
        if (this._logSprites) {
            for (const sprite of this._logSprites) {
                sprite.visible = false;
            }
        }

        // Update HTML Battle Log Overlay
        if (this._htmlBattleLogRoot) {
            const sc = _msgGetScale();
            const pad = this.padding || 12;
            
            // Position root container - aligned physically to the enemy bar (no playfield xOffset)
            // Only write each property when its value actually changed.
            const root = this._htmlBattleLogRoot;
            _setStyleIfChanged(root, 'left', (sc.ox + this.x * sc.sx) + 'px');
            _setStyleIfChanged(root, 'top', (sc.oy + (this.y + yOffset) * sc.sy) + 'px');
            _setStyleIfChanged(root, 'width', (this.width * sc.sx) + 'px');
            _setStyleIfChanged(root, 'height', (this.height * sc.sy) + 'px');
            _setStyleIfChanged(root, 'padding', Math.round(pad * sc.sy) + 'px ' + Math.round(pad * sc.sx) + 'px');

            // Panel background on the root container (not per-line) - no borders or shadows
            const bgOpacityRoot = (ConfigManager.battleLogBgOpacity !== undefined ? ConfigManager.battleLogBgOpacity : CONFIG.battleLogBgOpacity) / 100;
            _setStyleIfChanged(root, 'border', 'none', true);
            _setStyleIfChanged(root, 'box-shadow', 'none', true);
            _setStyleIfChanged(root, 'outline', 'none', true);
            if (bgOpacityRoot > 0) {
                _setStyleIfChanged(root, 'background', `rgba(0, 0, 0, ${bgOpacityRoot * 0.85})`);
                _setStyleIfChanged(root, 'borderRadius', '4px');
            } else {
                _setStyleIfChanged(root, 'background', 'transparent');
                _setStyleIfChanged(root, 'borderRadius', '0');
            }

            // Visibility - ensure it stays completely hidden at the start of battle (before scaling in)
            _setStyleIfChanged(root, 'display',
                (this.visible && this.openness > 0 && this._animationState !== 'hidden') ? 'block' : 'none');
            
            // Sync and update HTML line elements
            const container = this._htmlBattleLogRoot;
            if (!this._htmlLineEls) {
                this._htmlLineEls = [];
            }
            
            const baseFontSize = CONFIG.fontSize || 26;
            const scaledFont = Math.round(baseFontSize * sc.sy * 0.85);
            
            let currentTop = -Math.round(this._logScrollY * sc.sy);
            const defaultLineHeight = Math.round(this.lineHeight() * sc.sy);
            
            for (let i = 0; i < this._logSprites.length; i++) {
                const sprite = this._logSprites[i];
                let el = this._htmlLineEls[i];
                
                if (!el) {
                    el = document.createElement('div');
                    el.className = 'battlelog-line-container';
                    el.style.position = 'absolute';
                    el.style.width = '100%';
                    el.style.boxSizing = 'border-box';
                    // Force wrapping so long lines never get clipped on the right edge
                    el.style.whiteSpace = 'normal';
                    el.style.wordBreak = 'normal';
                    el.style.overflowWrap = 'break-word';
                    container.appendChild(el);
                    this._htmlLineEls[i] = el;
                }
                
                // Update text content (also invalidates the cached measured height)
                const htmlContent = sprite._htmlText || '';
                if (el.innerHTML !== htmlContent) {
                    el.innerHTML = htmlContent;
                    el._sblCachedHeight = null;
                }

                // A notification redirected here from ParchmentToast reads as
                // an ordinary combat line, no highlight box behind it.
                const isToast = !!sprite._isToast;
                if (el._sblIsToast !== isToast) {
                    el._sblIsToast = isToast;
                    el._sblCachedHeight = null;
                }
                _setStyleIfChanged(el, 'background', 'transparent');
                _setStyleIfChanged(el, 'borderRadius', '0');
                _setStyleIfChanged(el, 'padding', '0');

                // Update position and opacity matching the sprite (only on change)
                _setStyleIfChanged(el, 'left', (sprite.x * sc.sx) + 'px');
                _setStyleIfChanged(el, 'top', currentTop + 'px');
                _setStyleIfChanged(el, 'opacity', (sprite.opacity / 255).toString());
                // A font-size change (e.g. after a resize) alters the measured
                // height, so invalidate the cached height when it changes.
                if (el._sblFontSize !== scaledFont) {
                    el._sblFontSize = scaledFont;
                    el._sblCachedHeight = null;
                }
                _setStyleIfChanged(el, 'fontSize', scaledFont + 'px');

                // Only show if there is active text
                _setStyleIfChanged(el, 'display', htmlContent ? 'block' : 'none');

                // Dynamically accumulate position based on actual height. The
                // measured rect only changes when the HTML changes, so cache it
                // per line and avoid the per-frame getBoundingClientRect reflow.
                if (htmlContent) {
                    let h = el._sblCachedHeight;
                    if (h == null) {
                        const rect = el.getBoundingClientRect();
                        h = rect.height > 0 ? rect.height : defaultLineHeight;
                        el._sblCachedHeight = h;
                    }
                    currentTop += h;
                } else {
                    currentTop += defaultLineHeight;
                }
            }
        }
    };

    const _Window_BattleLog_destroy = Window_BattleLog.prototype.destroy;
    Window_BattleLog.prototype.destroy = function(options) {
        if (this._htmlBattleLogRoot && this._htmlBattleLogRoot.parentNode) {
            this._htmlBattleLogRoot.parentNode.removeChild(this._htmlBattleLogRoot);
        }
        this._htmlBattleLogRoot = null;
        this._htmlLineEls = null;
        if (typeof _Window_BattleLog_destroy === 'function') {
            _Window_BattleLog_destroy.call(this, options);
        }
    };
    Window_BattleLog.prototype.updateLogScroll = function() {
        if (this._logScrollYDuration > 0) {
            const d = this._logScrollYDuration;
            const sy = this.lineHeight() - this._logScrollY;
            this._logScrollY += sy * d / formulaTri(d);
            this._logScrollYDuration--;
        }
    };
    
    Window_BattleLog.prototype.updateLogSprites = function() {
        const lineHeight = this.lineHeight();
        const maxLine = this.maxLines() - 1;
        
        // Only update visible sprites for better performance
        for (let i = 0; i < this._logSprites.length; i++) {
            const sprite = this._logSprites[i];
            sprite.update(lineHeight * i - this._logScrollY, maxLine);
        }
        
    };
    
    Window_BattleLog.prototype._updateContentsBack = function() {
        const bitmap = this._contentsBackSprite.bitmap;
        if (bitmap) {
            const lineHeight = this.lineHeight();
            let height = (this.numLines() + 1) * lineHeight - this._logScrollY;
            height = Math.min(height, bitmap.height);
            this._contentsBackSprite.setFrame(0, 0, bitmap.width, height);
        }
    };

    // Clear and reset methods
    const _Window_BattleLog_clear = Window_BattleLog.prototype.clear;
    Window_BattleLog.prototype.clear = function() {
        this._baseLineStack = [];
        if (CONFIG.logType === 'all') this._clearDuration = CONFIG.viewDuration;
    };
    
    Window_BattleLog.prototype.clearSmoothBattleLog = function() {
        _Window_BattleLog_clear.call(this);
        this._lineToast = [];
        for (const sprite of this._logSprites) {
            sprite.bitmap.clear();
            sprite._htmlText = '';
        }
        this._logScrollYDuration = 0;
        this._logScrollY = this.lineHeight();
    };

    // Called at the start of each battler's action to replace the previous turn's log
    Window_BattleLog.prototype.clearForNewAction = function() {
        this._lines = [];
        this._lineToast = [];
        if (this._baseLineStack) this._baseLineStack = [];
        for (const sprite of this._logSprites) {
            sprite.bitmap.clear();
            sprite._htmlText = '';
        }
        this._logScrollYDuration = 0;
        this._logScrollY = this.lineHeight();
        // Snap out of scale-out so the next addText triggers a fresh scale-in
        if (this._animationState === 'scaling-out') {
            this._animationState = 'hidden';
            this.visible = false;
            this.height = 0;
            this.y = this._originalY + (this._originalHeight / 2);
        }
    };

    // Overrides for battle log behavior
    Window_BattleLog.prototype.waitForEffect = function() {};
    Window_BattleLog.prototype.startTurn = function() {};
    Window_BattleLog.prototype.popBaseLine = function() {
        if (this._baseLineStack) this._baseLineStack.pop();
    };

    const _Window_BattleLog_waitForNewLine = Window_BattleLog.prototype.waitForNewLine;
    Window_BattleLog.prototype.waitForNewLine = function() {
        if (CONFIG.waitNewLine) {
            _Window_BattleLog_waitForNewLine.apply(this, arguments);
        }
    };

    // Battle action display with color coding - optimized
    const _Window_BattleLog_displayAction = Window_BattleLog.prototype.displayAction;
    Window_BattleLog.prototype.displayAction = function(subject, item) {
        this._currentSubject = subject;

        const numMethods = this._methods.length;

        // Get colored name directly from cache
        let subjectName;
        if (subject.isActor()) {
            subjectName = NameColorCache.getActorName(subject);
        } else {
            subjectName = NameColorCache.getEnemyName(subject);
        }
        
        if (DataManager.isSkill(item) || DataManager.isItem(item)) {
            // Get colored item name from cache
            const itemName = NameColorCache.getItemName(item);
            
            if (item.message1) {
                this.push("addText", item.message1.format(subjectName, itemName));
            }
            if (item.message2) {
                this.push("addText", item.message2.format(subjectName, itemName));
            }
        } else {
            // For basic attacks - show the weapon name (or "Bare fists" if unarmed)
            let weaponName = null;
            if (subject.isActor() && typeof subject.weapons === 'function') {
                const weapon = subject.weapons()[0];
                if (weapon) {
                    weaponName = weapon.name;
                }
            }
            if (!weaponName) {
                weaponName = T('BattleLog.bareFists');
            }
            const attacksWith = T('BattleLog.attacksWith');
            this.push("addText", attacksWith.format(subjectName, weaponName));
        }
        
        if (this._methods.length === numMethods) {
            _Window_BattleLog_displayAction.apply(this, arguments);
        }
    };
    // Resolve an embedded archetype i18n key (e.g. "enemyArchetypes.humanoid.head.msg").
    // Some parts (like the humanoid head) have no ".msg" entry, so getArchetypeText
    // echoes the raw key back. In that case fall back to the part's ".name", then to a
    // humanized last segment, so the part name always appears instead of the raw key.
    // Mirrors the enemy-side getPartDamageMsg fallback in Health_Monsters.js.
    function resolveArchetypeKey(key) {
        const tr = typeof window.getArchetypeText === 'function'
            ? window.getArchetypeText
            : (typeof translateText === 'function' ? translateText : (k => k));
        const resolved = v => v && v !== undefined && !/^enemyArchetypes\./.test(v);
        let v = tr(key);
        if (resolved(v) && v !== key) return v;
        // ".msg" missing → try the part's localized ".name"
        if (/\.msg$/.test(key)) {
            const nameKey = key.replace(/\.msg$/, '.name');
            v = tr(nameKey);
            if (resolved(v) && v !== nameKey) return v;
        }
        // Last resort: humanize the part segment (skip trailing "msg"/"name")
        const parts = key.split('.').filter(p => p !== 'msg' && p !== 'name');
        const seg = parts[parts.length - 1] || key;
        return seg.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    const _Window_BattleLog_addText = Window_BattleLog.prototype.addText;
    Window_BattleLog.prototype.addText = function(text, isToast) {
      // Resolve embedded i18n dot-key paths before translating the full string
      // e.g. "enemyArchetypes.frog.tongue.msg" → "Tongue severed!" (player-hit part names)
      text = text.replace(/\benemyArchetypes(?:\.\w+)+/g, resolveArchetypeKey);
      if (typeof translateText === 'function') {
        text = translateText(text);
      }
      text = _replaceStars(text, this._currentSubject);
      return _Window_BattleLog_addText.call(this, text, isToast);
    };
    
    // Damage display with colored names
    Window_BattleLog.prototype.displayMiss = function(target) {
        let fmt;
        if (target.result().physical) {
            fmt = target.isActor() ? TextManager.actorNoHit : TextManager.enemyNoHit;
        } else {
            fmt = TextManager.actionFailure;
        }
        
        // Get colored target name from cache
        let targetName;
        if (target.isActor()) {
            targetName = NameColorCache.getActorName(target);
        } else {
            targetName = NameColorCache.getEnemyName(target);
        }
        
        this.push("appendToActionLine", fmt.format(targetName));
    };

    Window_BattleLog.prototype.displayEvasion = function(target) {
        let fmt;
        if (target.result().physical) {
            fmt = target.isActor() ? TextManager.actorDodge : TextManager.enemyDodge;
        } else {
            fmt = TextManager.actionFailure;
        }
        if (!fmt) fmt = T('BattleLog.dodged');
        let targetName;
        if (target.isActor()) {
            targetName = NameColorCache.getActorName(target);
        } else {
            targetName = NameColorCache.getEnemyName(target);
        }
        this.push("appendToActionLine", fmt.format(targetName));
    };

    Window_BattleLog.prototype.displayHpDamage = function(target) {
        if (target.result().hpAffected) {
            if (target.result().hpDamage > 0 && !target.result().drain) {
                this.push("performDamage", target);
            }
            if (target.result().hpDamage < 0) {
                this.push("performRecovery", target);
            }
            let targetName;
            if (target.isActor()) {
                targetName = NameColorCache.getActorName(target);
            } else {
                targetName = NameColorCache.getEnemyName(target);
            }
            const result = target.result();
            const damage = result.hpDamage;
            const isActor = target.isActor();
            let text;
            if (damage > 0 && result.drain) {
                text = TextManager.actorDrain.format(targetName, TextManager.hp, damage);
            } else if (damage > 0) {
                text = isActor
                    ? TextManager.actorDamage.format(targetName, damage)
                    : TextManager.enemyDamage.format(targetName, damage);
            } else if (damage < 0) {
                text = isActor
                    ? TextManager.actorRecovery.format(targetName, TextManager.hp, -damage)
                    : TextManager.enemyRecovery.format(targetName, TextManager.hp, -damage);
            } else {
                text = isActor
                    ? TextManager.actorNoDamage.format(targetName)
                    : TextManager.enemyNoDamage.format(targetName);
            }
            this.push("appendToActionLine", text);
        }
    };

    Window_BattleLog.prototype._formatParamList = function(params) {
        if (params.length === 1) return params[0];
        if (params.length === 2) {
            return params[0] + T('BattleLog.listPair') + params[1];
        }
        return params.slice(0, -1).join(', ') + T('BattleLog.listLast') + params[params.length - 1];
    };

    Window_BattleLog.prototype.displayChangedBuffs = function(target) {
        const result = target.result();
        const isIt = ConfigManager.language === 'it';
        if (result.addedBuffs.length > 0) {
            const paramStr = this._formatParamList(result.addedBuffs.map(id => TextManager.param(id)));
            this.push('appendToActionLine', `\\c[23]${isIt ? paramStr + ' aumentati!' : paramStr + ' increased!'}\\c[0]`);
        }
        if (result.addedDebuffs.length > 0) {
            const paramStr = this._formatParamList(result.addedDebuffs.map(id => TextManager.param(id)));
            this.push('appendToActionLine', `\\c[24]${isIt ? paramStr + ' diminuiti!' : paramStr + ' decreased!'}\\c[0]`);
        }
        if (result.removedBuffs.length > 0) {
            const paramStr = this._formatParamList(result.removedBuffs.map(id => TextManager.param(id)));
            this.push('appendToActionLine', isIt ? paramStr + ' normalizzati!' : paramStr + ' restored!');
        }
    };

    // Color the status word(s) in added-state messages using the state's <Hex> color,
    // while keeping the battler's name in its own color. Replaces the default so the
    // message joins the action's reaction lines like damage/buff text.
    Window_BattleLog.prototype.displayAddedStates = function(target) {
        const result = target.result();
        const states = result.addedStateObjects();
        const targetName = target.isActor()
            ? NameColorCache.getActorName(target)
            : NameColorCache.getEnemyName(target);
        for (const state of states) {
            if (state.id === target.deathStateId()) {
                this.push("performCollapse", target);
            }
            let stateText = target.isActor() ? state.message1 : state.message2;
            if (!stateText) continue;
            if (typeof translateText === 'function') stateText = translateText(stateText);
            const hex = getStateHexColor(state);
            let line;
            if (hex) {
                // Tint everything except the name so "paralyzed", "frozen", etc. take the hex color
                const parts = stateText.split('%1');
                const before = parts[0] || '';
                const after = parts.slice(1).join('%1');
                line = (before ? `\\c[${hex}]${before}\\c[0]` : '')
                    + targetName
                    + (after ? `\\c[${hex}]${after}\\c[0]` : '');
            } else {
                line = stateText.format(targetName);
            }
            this.push("appendToActionLine", line);
            this.push("waitForEffect");
        }
    };

    const _Window_BattleLog_displayDeath = Window_BattleLog.prototype.displayDeath;
    Window_BattleLog.prototype.displayDeath = function(target) {
        _Window_BattleLog_displayDeath.apply(this, arguments);
        if (!target.isActor()) {
            this.push('wait');
            this.push('startScaleOut');
        }
    };

    Window_BattleLog.prototype.displayRegeneration = function(subject) {
        if (subject.result().hpDamage < 0) {
            const value = Math.abs(subject.result().hpDamage);
            
            // Get colored subject name from cache
            let subjectName;
            if (subject.isActor()) {
                subjectName = NameColorCache.getActorName(subject);
            } else {
                subjectName = NameColorCache.getEnemyName(subject);
            }
            
            // Format: "[Name] recovered [X] HP!"
            if(ConfigManager.language === 'it'){
                this.push("addText", subjectName + " recupera " + value + " HP!");
            }else{
                this.push("addText", subjectName + " recovered " + value + " HP!");

            }
        }
    };

    //-------------------------------------------------------------------------
    // Window_PastBattleLog - Log History Window
    //-------------------------------------------------------------------------
    
    function Window_PastBattleLog() {
        this.initialize(...arguments);
    }

    Window_PastBattleLog.prototype = Object.create(Window_Selectable.prototype);
    Window_PastBattleLog.prototype.constructor = Window_PastBattleLog;

    Window_PastBattleLog.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this.openness = 0;
        this._data = [];
    };

    Window_PastBattleLog.prototype.maxItems = function() {
        return this._data.length;
    };

    Window_PastBattleLog.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        this.drawTextEx(this._data[index], rect.x, rect.y, rect.width);
    };

    Window_PastBattleLog.prototype.refresh = function() {
        this._data = $gameTemp.battleLog();
        Window_Selectable.prototype.refresh.call(this);
    };

    Window_PastBattleLog.prototype.selectBottom = function() {
        this.select(Math.max(this.maxItems() - 1, 0));
    };

    //-------------------------------------------------------------------------
    // Window_PartyCommand - Add Log Command
    //-------------------------------------------------------------------------
    
    const _Window_PartyCommand_makeCommandList = Window_PartyCommand.prototype.makeCommandList;
    Window_PartyCommand.prototype.makeCommandList = function() {
        _Window_PartyCommand_makeCommandList.apply(this, arguments);
        if (CONFIG.logCommand !== '') {
            this.addCommand(CONFIG.logCommand, 'pastLog');
        }
    };

    //-------------------------------------------------------------------------
    // Scene_Battle - Integration with Battle Scene
    //-------------------------------------------------------------------------
    
    const _Scene_Battle_isAnyInputWindowActive = Scene_Battle.prototype.isAnyInputWindowActive;
    Scene_Battle.prototype.isAnyInputWindowActive = function() {
        return _Scene_Battle_isAnyInputWindowActive.apply(this, arguments) ||
                this._pastLogWindow.active;
    };

    const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
    Scene_Battle.prototype.terminate = function() {
        _Scene_Battle_terminate.apply(this, arguments);
        $gameTemp.clearBattleLog();
        // Clear name cache on battle termination
        NameColorCache.refresh();
    };

    const _Scene_Battle_createDisplayObjects = Scene_Battle.prototype.createDisplayObjects;
    Scene_Battle.prototype.createDisplayObjects = function() {
        _Scene_Battle_createDisplayObjects.apply(this, arguments);
        if (CONFIG.startMessagesOnLog) {
            BattleManager.displayStartMessagesOnLog();
        }
    };

    const _Scene_Battle_createAllWindows = Scene_Battle.prototype.createAllWindows;
    Scene_Battle.prototype.createAllWindows = function() {
        _Scene_Battle_createAllWindows.apply(this, arguments);
        this.createPastLogWindow();
    };

    Scene_Battle.prototype.logWindowRect = function() {
        const wx = -Math.floor((Graphics.width - Graphics.boxWidth) / 2);
        const wy = 0;
        const ww = Graphics.width;
        const wh = this.calcWindowHeight(CONFIG.maxLines, false);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_Battle.prototype.createPastLogWindow = function() {
        const rect = this.pastLogWindowRect();
        const pastLogWindow = new Window_PastBattleLog(rect);
        pastLogWindow.setHandler('cancel', this.onPastLogCancel.bind(this));
        this.addWindow(pastLogWindow);
        this._pastLogWindow = pastLogWindow;
    };

    Scene_Battle.prototype.pastLogWindowRect = function() {
        const wx = 0;
        const wy = 0;
        const ww = Graphics.boxWidth;
        const wh = this._statusWindow.y;
        return new Rectangle(wx, wy, ww, wh);
    };
    
    const _Scene_Battle_createPartyCommandWindow = Scene_Battle.prototype.createPartyCommandWindow;
    Scene_Battle.prototype.createPartyCommandWindow = function() {
        _Scene_Battle_createPartyCommandWindow.apply(this, arguments);
        const commandWindow = this._partyCommandWindow;
        commandWindow.setHandler('pastLog', this.commandPastLog.bind(this));
    };

    Scene_Battle.prototype.commandPastLog = function() {
        this._pastLogWindow.refresh();
        this._pastLogWindow.open();
        this._pastLogWindow.selectBottom();
        this._pastLogWindow.activate();
    };

    Scene_Battle.prototype.onPastLogCancel = function() {
        this._pastLogWindow.close();
        this._pastLogWindow.deactivate();
        this._partyCommandWindow.activate();
    };

    const _Scene_Battle_closeCommandWindows = Scene_Battle.prototype.closeCommandWindows;
    Scene_Battle.prototype.closeCommandWindows = function() {
        _Scene_Battle_closeCommandWindows.apply(this, arguments);
        this._pastLogWindow.close();
        this._pastLogWindow.deactivate();
    };

    // Do not hide the smooth battle log window when the help window is active (e.g. during skill/item selection)
    Scene_Battle.prototype.updateLogWindowVisibility = function() {
        this._logWindow.visible = true;
    };
    
    
})();