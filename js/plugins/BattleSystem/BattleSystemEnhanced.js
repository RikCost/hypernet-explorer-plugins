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
 * @param levelDampGrace
 * @text Level Gap Grace
 * @desc Levels an enemy may outrank the attacker before damage damping starts.
 * @type number
 * @default 4
 *
 * @param levelDampScale
 * @text Level Gap Scale
 * @desc Higher = gentler damping. Gap above grace is divided by this.
 * @type number
 * @default 9
 *
 * @param levelDampCurve
 * @text Level Gap Curve
 * @desc Exponent of the damping curve. Above 1 it bites harder as the gap widens.
 * @type number
 * @decimals 2
 * @default 1.6
 *
 * @param levelDampFloor
 * @text Level Gap Floor
 * @desc Lowest damage multiplier the gap alone can impose (0.10 = 10% damage).
 * @type number
 * @decimals 2
 * @default 0.10
 *
 * @param levelDampLeverageCap
 * @text Tactical Leverage Cap
 * @desc How much of the damping tactics (crits, weakness, debuffs) can undo.
 * @type number
 * @decimals 2
 * @default 0.80
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
 * @command startPetrodemonBattle
 * @text Start Petrodemon Battle
 * @desc Raises a unique procedural petrodemon boss and fights it here and now.
 *
 * @arg difficulty
 * @text Difficulty
 * @desc easy is below the party's level, normal slightly above it, then progressively harder.
 * @type select
 * @option easy
 * @option normal
 * @option difficult
 * @option brutal
 * @option hellish
 * @default normal
 *
 * @command fightRandomPetrodemon
 * @text Fight Random Petrodemon
 * @desc Raises a petrodemon at a difficulty rolled at random, from easy to hellish.
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
    BSE.Params.levelDampGrace       = Number(parameters['levelDampGrace'] || 4);
    BSE.Params.levelDampScale       = Number(parameters['levelDampScale'] || 9);
    BSE.Params.levelDampCurve       = Number(parameters['levelDampCurve'] || 1.6);
    BSE.Params.levelDampFloor       = Number(parameters['levelDampFloor'] || 0.10);
    BSE.Params.levelDampLeverageCap = Number(parameters['levelDampLeverageCap'] || 0.80);

    // ------------------------------------------------------------------
    // 3. SHARED STATE (module-level closures, exposed via BSE.Data)
    // ------------------------------------------------------------------
    BSE.Data._persistentEnemyData  = {};
    BSE.Data._currentBattleEventId = null;
    BSE.Data._currentEventId       = null;
    BSE.Data._currentMapId         = null;
    // `title` / `lines` are the spoils popup's extra copy (a felled petrodemon
    // names itself and reports the OIL options it paid out); both are cleared
    // at the start of every victory. `levelUps` are the levels the fight paid
    // for, held back from the battle's message box and shown as toasts on the
    // map once the spoils have been read out.
    BSE.Data._battleRewards        = {
        exp: 0, gold: 0, items: [], knowledge: 0, title: null, lines: [], levelUps: []
    };
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

    // Nearby monsters that joined the current battle (see startPersistentBattle
    // and section 5b of the encounters module). Read it through
    // BSE.Helpers.getReinforcement(), never directly: an arena fight, a trial or
    // any other battle set up outside startPersistentBattle would otherwise see
    // whatever the previous overworld encounter left behind.
    BSE.State.reinforcement = null;

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
     * The reinforcements in the battle being fought right now: which troop slot
     * they were built into, how many members the troop that started the fight
     * contributed (they hold indexes 0..baseSize-1), and one entry per joining
     * map event. Answers a neutral, empty record for every battle that was not
     * set up by startPersistentBattle against a reinforced troop.
     */
    BSE.Helpers.getReinforcement = function() {
        const r = BSE.State.reinforcement;
        if (r && $gameTroop && $gameTroop._troopId === r.troopId) return r;
        return {
            troopId: 0,
            baseSize: ($gameTroop && $gameTroop.members().length) || 0,
            joined: []
        };
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
     * Roguelite and Peaceful are the modes a death is walked off in: the party
     * gets back up and the run continues. Hardcore / Blood and Oil (switch 9)
     * end it instead, so nothing is handed back there.
     */
    BSE.Helpers.isForgivingDeathMode = function() {
        if (window.PeacefulMode && window.PeacefulMode.isActive()) return true;
        return !$gameSwitches.value(9);
    };

    /**
     * Every need meter of every party member back to full: hunger and sleep,
     * which live on the actor, and hygiene / social / leisure, which live on
     * the actor for the player and on the society profile for a recruited
     * companion (setExtendedNeed resolves that). Called on a death the party
     * walks away from, so nobody gets back up already starving or filthy.
     */
    BSE.Helpers.refillPartyNeeds = function() {
        const TDS = window.TimeDateSystem || {};
        const maxHunger = TDS.maxHunger || 100;
        const maxSleep  = TDS.maxSleep  || 100;
        const maxNeed   = TDS.maxNeed   || 100;
        for (const member of $gameParty.members()) {
            if (!member) continue;
            if (member._hunger !== undefined) member._hunger = maxHunger;
            if (member._sleep !== undefined) member._sleep = maxSleep;
            if (member.setExtendedNeed) {
                member.setExtendedNeed('hygiene', maxNeed);
                member.setExtendedNeed('social', maxNeed);
                member.setExtendedNeed('leisure', maxNeed);
            }
            // The low-need warnings only fire on the way INTO a low band, so
            // forget the bands the party was in or the next dip stays silent.
            member._prevHungerState = 'normal';
            member._prevSleepState = 'normal';
            member._prevExtNeedStates = {};
        }
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
    // 4b. LEVEL-GAP DAMAGE DAMPING (party -> enemy only)
    //
    //   A low-level party may always kill a much higher-level enemy, but not
    //   by trading raw hits: the wider the gap between the attacker's level
    //   and the enemy's <Level:X>, the more of the attack's damage is damped.
    //   The curve is flat inside a grace band, then accelerates (curve > 1)
    //   and bottoms out at the floor, so the gap alone never zeroes a hit.
    //
    //   Tactics buy the damage back. Critical hits, elemental weakness, the
    //   debuffs and crippling states the party has landed and its own buffs
    //   all count as leverage, which undoes up to leverageCap of the damping.
    //   Slip damage (poison and the like) never passes through here at all,
    //   so damage-over-time is another way through a big gap.
    //
    //   Damage the party TAKES is untouched: this only ever scales an actor's
    //   outgoing HP damage against an enemy.
    // ------------------------------------------------------------------

    /**
     * Level of any battler, 0 when an enemy carries no <Level:X> tag.
     * Cached on the shared $dataEnemies entry, this runs per damage roll.
     */
    BSE.Helpers.getBattlerLevel = function(battler) {
        if (!battler) return 0;
        if (battler.isActor && battler.isActor()) return battler.level || 0;
        if (!battler.isEnemy || !battler.isEnemy()) return 0;
        const enemyData = battler.enemy();
        if (!enemyData) return 0;
        if (enemyData._bseLevel === undefined) {
            enemyData._bseLevel = BSE.Helpers.getEnemyLevel(enemyData.note);
        }
        return enemyData._bseLevel;
    };

    /**
     * A state counts as detrimental when it restricts the target, weakens one
     * of its params or drains its HP. Nothing in the database flags a state as
     * good or bad, so its traits are what we read.
     */
    function isDetrimentalState(state) {
        if (!state) return false;
        if (state._bseHarmful !== undefined) return state._bseHarmful;
        let harmful = state.restriction > 0;
        if (!harmful && state.traits) {
            harmful = state.traits.some(t =>
                (t.code === Game_BattlerBase.TRAIT_PARAM && t.value < 1) ||
                (t.code === Game_BattlerBase.TRAIT_XPARAM && t.dataId === 7 && t.value < 0)
            );
        }
        state._bseHarmful = harmful;
        return harmful;
    }

    /**
     * How much of the level damping the party has earned back on this hit.
     * 0 = raw numbers only, 1 = fully offset (capped by leverageCap).
     */
    BSE.Helpers.tacticalLeverage = function(subject, target, action, critical) {
        let leverage = 0;
        if (critical) leverage += 0.5;
        if (action && action.calcElementRate) {
            const rate = action.calcElementRate(target);
            if (rate > 1) leverage += Math.min(0.5, (rate - 1) * 0.5);
        }
        let debuffs = 0;
        if (target._buffs) {
            for (const level of target._buffs) if (level < 0) debuffs++;
        }
        leverage += Math.min(0.4, debuffs * 0.1);
        const crippled = target.states().filter(isDetrimentalState).length;
        leverage += Math.min(0.45, crippled * 0.15);
        let buffs = 0;
        if (subject._buffs) {
            for (const level of subject._buffs) if (level > 0) buffs++;
        }
        leverage += Math.min(0.2, buffs * 0.05);
        return Math.min(1, leverage);
    };

    /**
     * Multiplier applied to an actor's outgoing damage against an enemy.
     * Always 1 when the attacker is the enemy's equal or better, when the
     * enemy has no declared level, or in the sandbox / playtest character.
     */
    BSE.Helpers.levelDampingFactor = function(subject, target, action, critical) {
        if (!subject || !target) return 1;
        if (!subject.isActor || !subject.isActor()) return 1;
        if (!target.isEnemy || !target.isEnemy()) return 1;
        if ($gameSystem && $gameSystem._isSandboxMode) return 1;
        const leader = $gameParty.leader();
        if (leader && leader.name() === "Test") return 1; // i18n-ignore: playtest character name
        const enemyLevel = BSE.Helpers.getBattlerLevel(target);
        if (enemyLevel <= 0) return 1;
        const gap = enemyLevel - BSE.Helpers.getBattlerLevel(subject) - BSE.Params.levelDampGrace;
        if (gap <= 0) return 1;
        const scale = Math.max(1, BSE.Params.levelDampScale);
        const damp = Math.max(
            BSE.Params.levelDampFloor,
            1 / (1 + Math.pow(gap / scale, BSE.Params.levelDampCurve))
        );
        const leverage = BSE.Helpers.tacticalLeverage(subject, target, action, critical) *
            BSE.Params.levelDampLeverageCap;
        return damp + (1 - damp) * leverage;
    };

    const _Game_Action_makeDamageValue_BSE = Game_Action.prototype.makeDamageValue;
    Game_Action.prototype.makeDamageValue = function(target, critical) {
        const value = _Game_Action_makeDamageValue_BSE.call(this, target, critical);
        // HP damage and HP drain only: healing, MP damage and every recovery
        // effect keep their full value.
        if (value <= 0 || !this.checkDamageType([1, 5])) return value;
        const factor = BSE.Helpers.levelDampingFactor(this.subject(), target, this, critical);
        if (factor >= 1) return value;
        // A damped hit still lands: chip damage is the point, zero is not.
        return Math.max(1, value * factor);
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

        // The monsters standing nearby pile in (see section 5b of the encounters
        // module). The battle is then set up against a combined troop, and the
        // joiners' map events are remembered so the state module can clear them
        // on a win and hand their HP back on a flee.
        let setupTroopId = troopId;
        BSE.State.reinforcement = null;
        if (BSE.Functions.getJoiningEnemyEvents && $gameMap.mapId() === mapId) {
            const joiners = BSE.Functions.getJoiningEnemyEvents(eventId);
            if (joiners.length) {
                const built = BSE.Functions.buildReinforcedTroop(troopId, joiners, mapId);
                if (built.joined.length) {
                    setupTroopId = built.troopId;
                    BSE.State.reinforcement = {
                        troopId: built.troopId,
                        baseSize: $dataTroops[troopId].members.length,
                        joined: built.joined
                    };
                }
            }
        }

        BattleManager.setup(setupTroopId, false, false);
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
        // An authored map id and tile: no procedural square to put back, and
        // any wild camp the party had set is no longer where they wake up.
        $gameSystem._respawnProcSurface = null;
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

    // A petrodemon is generated per fight rather than picked out of the
    // database (see section 17 of the encounters module).
    PluginManager.registerCommand(pluginName, "startPetrodemonBattle", function(args) {
        if (!BSE.Functions.startPetrodemonBattle) return;
        BSE.Functions.startPetrodemonBattle(args && args.difficulty);
    });

    PluginManager.registerCommand(pluginName, "fightRandomPetrodemon", function(args) {
        if (!BSE.Functions.startPetrodemonBattle) return;
        const tiers = BSE.Data.PETRO_DIFFICULTIES || ['normal'];
        BSE.Functions.startPetrodemonBattle(tiers[Math.floor(Math.random() * tiers.length)]);
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
            // Resolve first: the selection may be the Random sentinel, which is
            // no more a bgm file name than __none__ or __map__ are.
            const mss = window.MusicSelectionSystem;
            const sel = (mss && mss.resolveBattleBgmName)
                ? mss.resolveBattleBgmName()
                : ConfigManager.battleMusicName;
            $gameSystem._battleBgm = {
                name: sel || 'RandomMind/Battle',
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
    // 15b. WHICH MONSTER A SINGLE-TARGET ACTION HITS
    //
    //   A fight is rarely one on one any more (see section 7: the monsters
    //   standing nearby pile in), so an attack, a skill or an item aimed at one
    //   enemy asks the player which one it lands on. A lone monster is the only
    //   thing on the field that can be hit, so it is targeted without a prompt
    //   and the turn goes straight through: the player is never made to confirm
    //   a choice they do not have.
    // ------------------------------------------------------------------
    const _Scene_Battle_startEnemySelection_BSE = Scene_Battle.prototype.startEnemySelection;
    Scene_Battle.prototype.startEnemySelection = function() {
        const alive = $gameTroop.aliveMembers();
        if (alive.length === 1) {
            const action = BattleManager.inputtingAction();
            // The troop index, not the position in the living: a dead monster
            // still holds its slot in $gameTroop.members().
            if (action) action.setTarget(alive[0].index());
            this.hideSubInputWindows();
            this.selectNextCommand();
            return;
        }
        _Scene_Battle_startEnemySelection_BSE.call(this);
    };

    // ------------------------------------------------------------------
    // 15c. A KILLED MONSTER LEAVES THE FIELD
    //
    //   The collapse effect is requested by the battle log as it reads out the
    //   killing blow, so a death that happens away from an action's result (slip
    //   damage at the end of a turn, a passive, a wound to a vital organ) never
    //   asks for one and the body stands there. Nobody saw that while a fight
    //   ended on its only monster's death; with the rest of the pack still
    //   swinging (section 7) it is on screen for the rest of the battle.
    //   Catch those deaths here, once the log has finished with the battler so
    //   its own collapse is never doubled up.
    // ------------------------------------------------------------------
    const _Sprite_Enemy_update_BSE = Sprite_Enemy.prototype.update;
    Sprite_Enemy.prototype.update = function() {
        _Sprite_Enemy_update_BSE.call(this);
        const enemy = this._enemy;
        // _appeared is still true only while nothing has taken the body away.
        if (!enemy || !this._appeared || !enemy.isDead() || this.isEffecting()) return;
        if (enemy.isEffectRequested()) return;
        const log = SceneManager._scene && SceneManager._scene._logWindow;
        if (log && log.isBusy && log.isBusy()) return;
        enemy.performCollapse();
    };

    // ------------------------------------------------------------------
    // 15d. WHICH TWO WEAPONS SWING THIS TURN
    //
    //   A character with more than two hands can carry up to eight weapons,
    //   but nobody swings eight of them. Two are drawn at random when the turn
    //   is handed over (Game_Actor#rollTurnWeapons, ItemSystemEquipment.js) and
    //   only those two contribute their elements, their attack skills and their
    //   sounds for the round. Since the pair is a roll, the log says out loud
    //   which two came to hand: the player is choosing their next action on the
    //   strength of it.
    //
    //   Everyone carrying two weapons or fewer is silent here, which is almost
    //   everyone.
    // ------------------------------------------------------------------
    const _BattleManager_startAction_pair = BattleManager.startAction;
    BattleManager.startAction = function() {
        const subject = this._subject;
        if (subject && subject.isActor && subject.isActor() && subject.allWeapons
            && subject.allWeapons().length > 2 && this._logWindow) {
            const pair = subject.activeWeapons();
            // _turnWeaponIndexes is replaced by each roll and by nothing else,
            // so comparing the reference announces the pair once per turn
            // rather than once per repeat of a multi-hit action.
            if (pair.length >= 2 && subject._pairAnnouncedFor !== subject._turnWeaponIndexes) {
                subject._pairAnnouncedFor = subject._turnWeaponIndexes;
                this._logWindow.push("addText", T('Battle.weapons.pair', {
                    actor: subject.name(), first: pair[0].name, second: pair[1].name
                }));
            }
        }
        _BattleManager_startAction_pair.call(this);
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