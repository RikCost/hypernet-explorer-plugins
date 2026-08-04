// ============================================================================
// Battle System Enhanced - Core & Commands
// For RPG Maker MZ
// ============================================================================

/*:
 * @target MZ
 * @plugindesc v2.0 Core module: config, i18n, plugin commands, shared namespace.
 * @author Combined by Claude, modified by OmniLex
 * @pluginName BattleSystemEnhanced
 *
 * @param respawnMapVar
 * @text Respawn Map Variable ID
 * @desc Game variable ID to store respawn map ID
 * @type variable
 * @default 25
 *
 * @param respawnXVar
 * @text Respawn X Variable ID
 * @desc Game variable ID to store respawn X coordinate
 * @type variable
 * @default 26
 *
 * @param respawnYVar
 * @text Respawn Y Variable ID
 * @desc Game variable ID to store respawn Y coordinate
 * @type variable
 * @default 27
 *
 * @param respawnCountryIDVar
 * @text Respawn Country ID Variable ID
 * @desc Game variable ID to store respawn country ID
 * @type variable
 * @default 112
 *
 * @command startBattle
 * @text Start Event Battle
 * @desc Start a battle with the event's fixed troop and maintain HP state
 *
 * @arg eventId
 * @text Event ID
 * @desc The ID of the event to battle with (use 0 for event running this command)
 * @type number
 * @default 0
 *
 * @command setRespawnPoint
 * @text Set Respawn Point
 * @desc Set the map ID and coordinates where the player will respawn
 *
 * @arg mapId
 * @text Map ID
 * @desc The ID of the map to respawn on
 * @type number
 * @default 1
 *
 * @arg x
 * @text X Coordinate
 * @desc The X coordinate to respawn at
 * @type number
 * @default 21
 *
 * @arg y
 * @text Y Coordinate
 * @desc The Y coordinate to respawn at
 * @type number
 * @default 26
 *
 * @command restore
 * @text Restore Inventory
 * @desc Restores the player's gold and inventory from their last death point and removes the gravestone data.
 *
 * @help
 * ============================================================================
 * BattleSystemEnhanced, Core Module
 * ============================================================================
 *
 * This is the core module of the BattleSystemEnhanced plugin suite.
 * It provides the shared namespace, plugin parameters, i18n pipeline,
 * and all plugin command registrations.
 *
 * SUB-MODULES (load in this order AFTER this plugin):
 *   1. BattleSystemEnhancedEncounters.js , Encounter & Spawning Engine
 *   2. BattleSystemEnhancedState.js      , Persistent Battles & Rewards
 *   3. BattleSystemEnhancedDeath.js      , Gravestone & Respawn Mechanics
 *   4. BattleSystemEnhancedMechanics.js  , Combat Safety & Level Warnings
 *   5. BattleSystemEnhancedLevelDisplay.js— Map UI & Nameplates
 *
 * Terms of Use:
 * Free for use in both commercial and non-commercial projects.
 */

(() => {
    const pluginName = "BattleSystemEnhanced";

    // ------------------------------------------------------------------
    // 1. SHARED GLOBAL NAMESPACE
    // ------------------------------------------------------------------
    window.BattleSystemEnhanced = window.BattleSystemEnhanced || {};
    const BSE = window.BattleSystemEnhanced;

    BSE.Params    = BSE.Params    || {};
    BSE.Data      = BSE.Data      || {};
    BSE.Helpers   = BSE.Helpers   || {};
    BSE.Functions = BSE.Functions || {};
    BSE.State     = BSE.State     || {};

    // ------------------------------------------------------------------
    // 2. PLUGIN PARAMETERS
    // ------------------------------------------------------------------
    const parameters = PluginManager.parameters(pluginName);
    BSE.Params.respawnMapVar        = Number(parameters['respawnMapVar'] || 25);
    BSE.Params.respawnXVar          = Number(parameters['respawnXVar'] || 26);
    BSE.Params.respawnYVar          = Number(parameters['respawnYVar'] || 27);
    BSE.Params.respawnCountryIDVar  = Number(parameters['respawnCountryIDVar'] || 112);

    // ------------------------------------------------------------------
    // 3. SHARED STATE (module-level closures, exposed via BSE.Data)
    // ------------------------------------------------------------------
    BSE.Data._persistentEnemyData  = {};
    BSE.Data._currentBattleEventId = null;
    BSE.Data._currentEventId       = null;
    BSE.Data._currentMapId         = null;
    BSE.Data._battleRewards        = { exp: 0, gold: 0, items: [], knowledge: 0 };
    BSE.Data._needsRespawn         = false;
    BSE.Data._enemyCharSprites     = {};
    BSE.Data._mapCorpses           = [];
    BSE.Data._enemyPartDamage      = {};

    // Convenience accessors so sub-modules can read/write
    BSE.State.persistentEnemyData  = BSE.Data._persistentEnemyData;
    BSE.State.currentBattleEventId = BSE.Data._currentBattleEventId;
    BSE.State.currentEventId       = BSE.Data._currentEventId;
    BSE.State.currentMapId         = BSE.Data._currentMapId;
    BSE.State.battleRewards        = BSE.Data._battleRewards;
    BSE.State.needsRespawn         = BSE.Data._needsRespawn;
    BSE.State.enemyCharSprites     = BSE.Data._enemyCharSprites;
    BSE.State.mapCorpses           = BSE.Data._mapCorpses;
    BSE.State.enemyPartDamage      = BSE.Data._enemyPartDamage;

    // ------------------------------------------------------------------
    // 4. SHARED HELPER FUNCTIONS
    // ------------------------------------------------------------------

    /**
     * Extract enemy level from <Level:X> note tag
     */
    BSE.Helpers.getEnemyLevel = function(note) {
        if (!note) return 0;
        const m = note.match(/<Level:\s*(\d+)>/i);
        return m ? parseInt(m[1], 10) : 0;
    };

    /**
     * Get the median level of the party
     */
    BSE.Helpers.getMedianLevel = function(party) {
        const levels = party.map(m => m.level).sort((a, b) => a - b);
        const mid = Math.floor(levels.length / 2);
        return levels.length % 2
            ? levels[mid]
            : (levels[mid - 1] + levels[mid]) / 2;
    };

    /**
     * Extract archetype from enemy note
     */
    BSE.Helpers.getEnemyArchetype = function(enemyData) {
        if (!enemyData) return null;
        // Notes never change at runtime; parse once and cache on the shared
        // $dataEnemies object (undefined = not yet computed; null is a valid
        // cached "no archetype"). This is hit from per-frame movement/combat.
        if (enemyData._bseArchetype !== undefined) return enemyData._bseArchetype;
        let archetype = null;
        if (enemyData.note) {
            const archetypeMatch = enemyData.note.match(/<Archetype:\s*(.+?)>/i);
            if (archetypeMatch) archetype = archetypeMatch[1].trim();
        }
        enemyData._bseArchetype = archetype;
        return archetype;
    };

    /**
     * Get the archetype of the first enemy in an event's troop
     */
    BSE.Helpers.getEventArchetype = function(event) {
        if (!event || !event._fixedTroopId) return null;
        // Cache on the event, keyed on troop id so a re-fixed event recomputes.
        if (event._bseArchTroop === event._fixedTroopId) return event._bseArch;
        const troop = $dataTroops[event._fixedTroopId];
        let archetype = null;
        if (troop && troop.members.length) {
            const enemy = $dataEnemies[troop.members[0].enemyId];
            if (enemy) archetype = BSE.Helpers.getEnemyArchetype(enemy);
        }
        event._bseArchTroop = event._fixedTroopId;
        event._bseArch = archetype;
        return archetype;
    };

    /**
     * Cached <Climb> note-tag check. Called from the per-frame realMoveSpeed /
     * canPass movement overrides, so memoize on the shared $dataEnemies object.
     */
    BSE.Helpers.enemyHasClimb = function(enemyData) {
        if (!enemyData) return false;
        if (enemyData._bseClimb !== undefined) return enemyData._bseClimb;
        enemyData._bseClimb = !!(enemyData.note && enemyData.note.includes('<Climb>'));
        return enemyData._bseClimb;
    };

    /**
     * Check if a tile is aquatic (region 99 or MovementSystem water)
     */
    BSE.Helpers.isAquaticTile = function(x, y) {
        if (window.MovementSystem && window.MovementSystem.isWaterTile) {
            return window.MovementSystem.isWaterTile(x, y);
        }
        if (!$gameMap) return false;
        return $gameMap.regionId(x, y) === 99;
    };

    // ------------------------------------------------------------------
    // 5. i18n
    //   Banks live in js/i18n/<lang>/plugins/Battle.json. T.pool takes the
    //   translated array whole, so a shorter one never mixes in English.
    // ------------------------------------------------------------------
    BSE.Helpers.bi18nList = function(path) {
        const key = 'Battle.' + path;
        return T.has(key) ? T.pool(key) : null;
    };

    // ------------------------------------------------------------------
    // 6. DataManager, Load Enemy Char Sprites
    // ------------------------------------------------------------------
    const _DataManager_isDatabaseLoaded = DataManager.isDatabaseLoaded;
    DataManager.isDatabaseLoaded = function() {
        if (!_DataManager_isDatabaseLoaded.call(this)) return false;
        if (!this._enemyCharSpritesLoaded) {
            this.loadEnemyCharSprites($dataEnemies);
            this._enemyCharSpritesLoaded = true;
        }
        return true;
    };

    DataManager.loadEnemyCharSprites = function(data) {
        const sprites = BSE.Data._enemyCharSprites;
        for (let i = 1; i < data.length; i++) {
            const enemy = data[i];
            if (enemy && enemy.note) {
                const charMatch = enemy.note.match(/<Char:(.+?)>/i);
                if (charMatch) {
                    sprites[i] = charMatch[1];
                }
            }
        }
    };

    // ------------------------------------------------------------------
    // 7. startPersistentBattle (shared core function)
    // ------------------------------------------------------------------
    BSE.Functions.startPersistentBattle = function(troopId, persistentId, eventId, mapId) {
        const pData = BSE.State.persistentEnemyData;
        if (!pData[persistentId]) {
            pData[persistentId] = { troopId: troopId, enemyHp: {} };
        }
        if ($gameSystem.getBattleCooldown() > 0) return;

        // Tactical map battle (MapBattleMode.js): fights play out on the live
        // map instead of pushing Scene_Battle. Presentation-only redirect -
        // MapBattleMode still calls BattleManager.setup itself and reuses all
        // of the win/lose/flee/recruit rules below untouched.
        if (window.isMapBattleMode && window.isMapBattleMode() && window.MapBattleMode) {
            window.MapBattleMode.begin(troopId, persistentId, eventId, mapId);
            return;
        }

        $gameMessage._eventActivator = $gameMessage._eventActivator || window._battleActivatorOverride || "p1";
        window._battleActivatorOverride = null;

        $gameSystem._p1PreBattlePos = {
            mapId: $gameMap.mapId(),
            x: $gamePlayer.x,
            y: $gamePlayer.y,
            d: $gamePlayer.direction()
        };
        if (window.$gameSplitScreen && window.$gameSplitScreen.active && window.$gameSplitScreen.p2Event) {
            const p2 = window.$gameSplitScreen.p2Event;
            $gameSystem._p2PreBattlePos = {
                mapId: $gameMap.mapId(),
                x: p2.x, y: p2.y, d: p2.direction()
            };
        } else {
            $gameSystem._p2PreBattlePos = null;
        }

        BSE.State.currentBattleEventId = persistentId;
        BSE.State.currentEventId = eventId;
        BSE.State.currentMapId = mapId;
        BSE.State.needsRespawn = false;

        BattleManager.setup(troopId, false, false);
        SceneManager.push(Scene_Battle);
    };

    // ------------------------------------------------------------------
    // 8. PLUGIN COMMAND REGISTRATIONS (forwarding pattern)
    // ------------------------------------------------------------------

    PluginManager.registerCommand(pluginName, "startBattle", function(args) {
        if ($gamePlayer.isInVehicle()) return;
        if ($gameSystem.getBattleCooldown() > 0) return;
        $gameSwitches.setValue(115, true);

        const eventId = Number(args.eventId) || this._eventId;
        const event = $gameMap.event(eventId);
        if (event && event._fixedTroopId > 0) {
            const persistentId = `${$gameMap.mapId()}_${eventId}`;
            BSE.Functions.startPersistentBattle(
                event._fixedTroopId, persistentId, eventId, $gameMap.mapId()
            );
        }
    });

    PluginManager.registerCommand(pluginName, "setRespawnPoint", function(args) {
        $gameVariables.setValue(BSE.Params.respawnMapVar, Number(args.mapId));
        $gameVariables.setValue(BSE.Params.respawnXVar, Number(args.x));
        $gameVariables.setValue(BSE.Params.respawnYVar, Number(args.y));
        $gameSystem._respawnPointSet = true;
    });

    PluginManager.registerCommand(pluginName, "restore", function(args) {
        if (BSE.Functions.executeRestoreCommand) {
            BSE.Functions.executeRestoreCommand();
        }
    });

    PluginManager.registerCommand(pluginName, "damageActor", function(args) {
        if (BSE.Functions.executeDamageActor) {
            BSE.Functions.executeDamageActor(args);
        }
    });

    PluginManager.registerCommand(pluginName, "resetHealthProtection", function(args) {
        if (BSE.Functions.executeResetHealthProtection) {
            BSE.Functions.executeResetHealthProtection();
        }
    });

    PluginManager.registerCommand(pluginName, "checkHealthProtection", function(args) {
        if (BSE.Functions.executeCheckHealthProtection) {
            BSE.Functions.executeCheckHealthProtection();
        }
    });

    // ------------------------------------------------------------------
    // 9. Data Save/Load Handling
    // ------------------------------------------------------------------
    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        _DataManager_extractSaveContents.call(this, contents);
        const pData = BSE.State.persistentEnemyData;
        if (contents.persistentEnemyData) {
            Object.assign(pData, contents.persistentEnemyData);
        }
        if (contents.enemyCharSprites) {
            Object.assign(BSE.Data._enemyCharSprites, contents.enemyCharSprites);
        }
        if (contents.healthProtectionUsed) {
            Object.assign(BSE.State._healthProtectionUsed || {}, contents.healthProtectionUsed);
        }
    };

    const _DataManager_makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function() {
        const contents = _DataManager_makeSaveContents.call(this);
        contents.persistentEnemyData = BSE.State.persistentEnemyData;
        contents.enemyCharSprites = BSE.Data._enemyCharSprites;
        contents.healthProtectionUsed = BSE.State._healthProtectionUsed || {};
        return contents;
    };

    // ------------------------------------------------------------------
    // 10. DataManager.setupNewGame
    // ------------------------------------------------------------------
    const _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function() {
        _DataManager_setupNewGame.call(this);
        $gameVariables.setValue(BSE.Params.respawnMapVar, 708);
        $gameVariables.setValue(BSE.Params.respawnXVar, 24);
        $gameVariables.setValue(BSE.Params.respawnYVar, 12);
        $gameVariables.setValue(BSE.Params.respawnCountryIDVar, 121);
    };

    // ------------------------------------------------------------------
    // 11. Sprite_Character – Apply Enemy Hue & Flash
    // ------------------------------------------------------------------
    (function() {
        const _SC_update = Sprite_Character.prototype.update;
        Sprite_Character.prototype.update = function() {
            _SC_update.call(this);
            if (this._flashDuration > 0) {
                this._flashDuration--;
                if (this._flashDuration === 0) {
                    this.setBlendColor([0, 0, 0, 0]);
                }
            }
            const char = this._character;
            const hue = char && char._characterHue;
            if (hue) {
                if (!this._hueFilter) {
                    this._hueFilter = new PIXI.filters.ColorMatrixFilter();
                    this.filters = [this._hueFilter];
                    this._appliedHue = null;
                }
                // Rebuilding the ColorMatrix every frame is wasteful when the hue
                // hasn't changed; only recompute when it actually differs.
                if (this._appliedHue !== hue) {
                    this._hueFilter.reset();
                    this._hueFilter.hue(hue, false);
                    this._appliedHue = hue;
                }
            } else if (this._hueFilter) {
                this.filters = null;
                this._hueFilter = null;
                this._appliedHue = null;
            }
        };
    })();

    // ------------------------------------------------------------------
    // 12. Scene_Map – stopAudioOnBattleStart
    // ------------------------------------------------------------------
    const _Scene_Map_stopAudio = Scene_Map.prototype.stopAudioOnBattleStart;
    Scene_Map.prototype.stopAudioOnBattleStart = function() {
        if ($gameSystem && typeof $gameSystem.battleBgm === 'function') {
            $gameSystem._battleBgm = {
                name: ConfigManager.battleMusicName || 'RandomMind/Battle',
                volume: 90, pitch: 100, pan: 0
            };
        }
        _Scene_Map_stopAudio.call(this);
    };

    // ------------------------------------------------------------------
    // 13. Corpse Interaction
    // ------------------------------------------------------------------
    const _Game_Player_checkTriggerHere = Game_Player.prototype.checkEventTriggerHere;
    Game_Player.prototype.checkEventTriggerHere = function(triggers) {
        _Game_Player_checkTriggerHere.call(this, triggers);
        if (!triggers.includes(0)) return;
        if ($gameMap.isEventRunning() || SceneManager.isSceneChanging()) return;
        const corpses = BSE.State.mapCorpses.filter(c => c.mapId === $gameMap.mapId());
        const corpse = corpses.find(c => c.x === this.x && c.y === this.y);
        if (corpse && typeof Scene_BodyPartHarvest !== 'undefined') {
            SceneManager.push(Scene_BodyPartHarvest);
            SceneManager.prepareNextScene(corpse);
        }
    };

    const _Game_Player_checkTriggerThere = Game_Player.prototype.checkEventTriggerThere;
    Game_Player.prototype.checkEventTriggerThere = function(triggers) {
        _Game_Player_checkTriggerThere.call(this, triggers);
        if (!triggers.includes(0)) return;
        if ($gameMap.isEventRunning() || SceneManager.isSceneChanging()) return;
        const corpses = BSE.State.mapCorpses.filter(c => c.mapId === $gameMap.mapId());
        if (corpses.find(c => c.x === this.x && c.y === this.y)) return;
        const x2 = $gameMap.roundXWithDirection(this.x, this.direction());
        const y2 = $gameMap.roundYWithDirection(this.y, this.direction());
        const corpse = corpses.find(c => c.x === x2 && c.y === y2);
        if (corpse && typeof Scene_BodyPartHarvest !== 'undefined') {
            SceneManager.push(Scene_BodyPartHarvest);
            SceneManager.prepareNextScene(corpse);
        }
    };

    // ------------------------------------------------------------------
    // 14. window.BSE export
    // ------------------------------------------------------------------
    window.BSE = {
        get mapCorpses()      { return BSE.State.mapCorpses; },
        get enemyPartDamage() { return BSE.State.enemyPartDamage; }
    };

    // ------------------------------------------------------------------
    // 15. Party Command Restriction (split-screen)
    // ------------------------------------------------------------------
    const _Window_PartyCommand_process = Window_PartyCommand.prototype.processHandling;
    Window_PartyCommand.prototype.processHandling = function() {
        if (window.$gameSplitScreen && window.$gameSplitScreen.active && $gameMessage._eventActivator) {
            if ($gameMessage._eventActivator === "p2") {
                this.processP2Handling();
                return;
            }
        }
        _Window_PartyCommand_process.call(this);
    };

    // ------------------------------------------------------------------
    // 16. Scene_Gameover – redirect to map
    // ------------------------------------------------------------------
    Scene_Gameover.prototype.start = function() {
        AudioManager.stopBgm();
        SceneManager.goto(Scene_Map);
    };

    // ------------------------------------------------------------------
    // 17. window.getEnemyEventsJSON
    // ------------------------------------------------------------------
    window.getEnemyEventsJSON = function() {
        const enemyEvents = $gameMap.events().filter(ev => {
            const eventData = ev.event();
            return eventData && eventData.name === "Enemy";
        });
        const enemyData = enemyEvents.map(event => ({
            eventId: event.eventId(),
            troopId: event._fixedTroopId || 0,
            x: event.x,
            y: event.y,
            mapId: $gameMap.mapId()
        }));
        return JSON.stringify({
            mapId: $gameMap.mapId(),
            mapName: $dataMap.displayName || $dataMap.name || T('Battle.unknownMap'),
            enemyCount: enemyData.length,
            enemies: enemyData
        }, null, 2);
    };

    // ------------------------------------------------------------------
    // 18. Game_Player.executeEncounter (disable default)
    // ------------------------------------------------------------------
    Game_Player.prototype.executeEncounter = function() {};

})();

/* =========================
 * BattleSystemEnhanced - Safe Monster Image Loader
 * ========================= */
(() => {
    'use strict';
    if (typeof Sprite_Character !== 'undefined') {
        const _orig = Sprite_Character.prototype.setCharacterBitmap;
        Sprite_Character.prototype.setCharacterBitmap = function() {
            const name = this._characterName || "";
            if (/^Monsters\//i.test(name)) {
                try { _orig.call(this); } catch (e) {
                    console.error("[BattleSystemEnhanced] Failed to load character image:", name, e);
                    const fw = 48, fh = 48;
                    const bmp = new Bitmap(fw * 3, fh * 4);
                    bmp.fillRect(0, 0, bmp.width, bmp.height, "#222222");
                    bmp.drawText("MISSING", 0, Math.floor(bmp.height / 2) - 12, bmp.width, 24, "center");
                    this.bitmap = bmp;
                    this._isBigCharacter = false;
                    this.setFrame(0, 0, fw, fh);
                }
            } else {
                _orig.call(this);
            }
        };
    }
    if (typeof ImageManager !== 'undefined') {
        const _loadBmp = ImageManager.loadBitmap;
        ImageManager.loadBitmap = function(folder, filename) {
            try { return _loadBmp.call(this, folder, filename); } catch (e) {
                if (typeof folder === "string" && /img\/characters\/Monsters\/?$/i.test(folder)) {
                    console.error("[BattleSystemEnhanced] Failed to load bitmap:", folder, filename, e);
                    const bmp = new Bitmap(144, 192);
                    bmp.fillRect(0, 0, 144, 192, "#222222");
                    bmp.drawText("MISSING", 0, 84, 144, 24, "center");
                    return bmp;
                }
                throw e;
            }
        };
    }
})();