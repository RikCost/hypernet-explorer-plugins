/*:
 * @target MZ
 * @plugindesc Summon System v2.0.0
 * @author Omni-Lex
 * @version 2.0.0
 * @description v2.0.0 Summons an enemy as a temporary, CPU-controlled 4th party member until battle ends.
 *
 * @param summonActorId
 * @text Summon Actor ID
 * @desc Actor ID used as the summon proxy (default: 4). Should be a dedicated dummy actor.
 * @type actor
 * @default 4
 *
 * @command startSummon
 * @text Summon Enemy
 * @desc Summons the given enemy as a CPU-controlled 4th party member until the battle ends.
 *
 * @arg enemyId
 * @text Enemy ID
 * @desc ID of the enemy to summon.
 * @type enemy
 * @default 1
 *
 * @help SummonSystem.js
 *
 * ============================================================================
 * Summon System Plugin (v2.0)
 * ============================================================================
 *
 * Call the "Summon Enemy" plugin command DURING a battle with an enemy ID.
 * That enemy joins as a temporary 4th party member with:
 *   - Its own party health bar (the monster's <Char:...> walking sprite).
 *   - The enemy's stats and skills.
 *   - Full CPU (auto-battle) control, no manual input.
 *
 * The summon does NOT receive the 1-HP death protection that the normal
 * party members have. When it dies it is removed from the battle entirely
 * and cannot be revived. It is also removed automatically when the battle
 * ends, restoring the proxy actor to its clean database state.
 *
 * Requires the BattleSystemEnhanced suite (loaded BEFORE this plugin) so the
 * monster <Char:...> sprites and HUD party bars are available.
 *
 * ============================================================================
 */

(() => {
    'use strict';

    const pluginName = 'SummonSystem';
    const parameters = PluginManager.parameters(pluginName);
    const summonActorId = Number(parameters['summonActorId'] || 4);

    // ------------------------------------------------------------------
    // Module state (battle-only, never persisted)
    // ------------------------------------------------------------------
    let isSummonActive = false;     // a summon currently occupies the party
    let summonEnemyId = 0;          // the enemy template currently summoned
    let pendingRemoval = false;     // summon died, awaiting a safe removal point

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    // Resolve the monster walking-sprite name (without the "Monsters/" prefix).
    function getEnemyCharName(enemy) {
        if (!enemy) return null;
        const BSE = window.BattleSystemEnhanced;
        if (BSE && BSE.Data && BSE.Data._enemyCharSprites) {
            const v = BSE.Data._enemyCharSprites[enemy.id];
            if (v) return v;
        }
        if (enemy.note) {
            const m = enemy.note.match(/<Char:\s*(.+?)>/i);
            if (m) return m[1].trim();
        }
        return null;
    }

    // Rebuild the HUD party/enemy bars so the summon's bar appears/disappears.
    function rebuildBattleBars() {
        const scene = SceneManager._scene;
        if (scene instanceof Scene_Battle &&
            scene._spriteset &&
            typeof scene.removeBattleHealthBars === 'function' &&
            typeof scene.createBattleHealthBars === 'function') {
            scene.removeBattleHealthBars();
            scene.createBattleHealthBars();
        }
    }

    function refreshBattle() {
        if ($gameParty.inBattle()) {
            // MZ has no BattleManager.refreshStatus (that was MV); guard for compatibility.
            if (typeof BattleManager.refreshStatus === 'function') {
                BattleManager.refreshStatus();
            }
            $gameTemp.requestBattleRefresh();
        }
    }

    // ------------------------------------------------------------------
    // Plugin command
    // ------------------------------------------------------------------
    PluginManager.registerCommand(pluginName, 'startSummon', args => {
        startSummon(Number(args.enemyId || 1));
    });

    function startSummon(enemyId) {
        if (!$gameParty.inBattle()) {
            $gameMessage.add(T('Battle.summon.battleOnly'));
            return;
        }
        if (isSummonActive) {
            $gameMessage.add(T('Battle.summon.alreadyActive'));
            return;
        }
        const enemy = $dataEnemies[enemyId];
        if (!enemy) return;
        if ($gameParty._actors.includes(summonActorId)) {
            // Proxy actor is already a real party member; abort to avoid clobbering it.
            return;
        }

        isSummonActive = true;
        summonEnemyId = enemyId;
        pendingRemoval = false;

        configureSummonActor(enemy);

        $gameParty.addActor(summonActorId);

        // The summon never benefits from the party 1-HP death protection.
        const BSE = window.BattleSystemEnhanced;
        if (BSE && BSE.Helpers && BSE.Helpers.useHealthProtection) {
            BSE.Helpers.useHealthProtection(summonActorId);
        }

        // Make sure the freshly added member has actions ready if the turn is already underway.
        const actor = $gameActors.actor(summonActorId);
        if (actor && actor.canMove()) actor.makeActions();

        rebuildBattleBars();
        refreshBattle();

        $gameMessage.add(T('Battle.summon.summoned', { name: enemy.name }));
    }

    // Turn the proxy actor into a copy of the enemy (name, stats, skills, sprite).
    function configureSummonActor(enemy) {
        const actor = $gameActors.actor(summonActorId);
        if (!actor) return;

        // Clean slate from the database, then overlay the enemy data.
        actor.setup(summonActorId);
        actor.setName(enemy.name);

        // Skills: copy every action skill the enemy can use.
        actor._skills = [];
        if (enemy.actions) {
            for (const action of enemy.actions) {
                if (action.skillId && action.skillId > 0) {
                    actor.learnSkill(action.skillId);
                }
            }
        }

        // Monster walking sprite for the party bar (img/characters/Monsters/<Char>.png).
        const charName = getEnemyCharName(enemy);
        if (charName) {
            actor.setCharacterImage('Monsters/' + charName, 0);
        }
        if (enemy.battlerName) actor._battlerName = enemy.battlerName;
        actor._faceName = '';
        actor._faceIndex = 0;

        // Stats now resolve to the enemy's params (see paramBase override); top off resources.
        actor.recoverAll();
        actor.clearActions();
    }

    // Remove the summon from battle and restore the proxy actor.
    function removeSummon() {
        if (!isSummonActive) return;
        isSummonActive = false;   // unlock removeActor + revert param/auto overrides
        pendingRemoval = false;
        summonEnemyId = 0;

        $gameParty.removeActor(summonActorId);

        const actor = $gameActors.actor(summonActorId);
        if (actor) actor.setup(summonActorId); // reset proxy to clean database state

        rebuildBattleBars();
        refreshBattle();
    }

    // Remove the summon once the engine is at a safe point (no action in progress).
    function flushSummonRemoval() {
        if (!isSummonActive || !pendingRemoval) return;
        const actor = $gameActors.actor(summonActorId);
        if (!actor || !actor.isDead()) {
            pendingRemoval = false;
            return;
        }
        removeSummon();
    }

    // ------------------------------------------------------------------
    // Game_Actor overrides (active only while this actor is the summon)
    // ------------------------------------------------------------------

    const _Game_Actor_paramBase = Game_Actor.prototype.paramBase;
    Game_Actor.prototype.paramBase = function(paramId) {
        if (isSummonActive && summonEnemyId && this.actorId() === summonActorId) {
            const enemy = $dataEnemies[summonEnemyId];
            if (enemy && enemy.params) return enemy.params[paramId];
        }
        return _Game_Actor_paramBase.call(this, paramId);
    };

    // CPU control: auto-battle makes the actions and canInput() returns false,
    // so the summon is skipped during manual input selection.
    const _Game_Actor_isAutoBattle = Game_Actor.prototype.isAutoBattle;
    Game_Actor.prototype.isAutoBattle = function() {
        if (isSummonActive && this.actorId() === summonActorId) return true;
        return _Game_Actor_isAutoBattle.call(this);
    };

    // Death -> schedule removal from battle (cannot be revived afterwards).
    const _Game_Actor_die = Game_Actor.prototype.die;
    Game_Actor.prototype.die = function() {
        _Game_Actor_die.call(this);
        if (isSummonActive && this.actorId() === summonActorId) {
            pendingRemoval = true;
        }
    };

    // Protect the summon from being dropped by anything other than this plugin.
    const _Game_Party_removeActor = Game_Party.prototype.removeActor;
    Game_Party.prototype.removeActor = function(actorId) {
        if (isSummonActive && actorId === summonActorId) return;
        _Game_Party_removeActor.call(this, actorId);
    };

    // ------------------------------------------------------------------
    // BattleManager hooks
    // ------------------------------------------------------------------

    const _BattleManager_endAction = BattleManager.endAction;
    BattleManager.endAction = function() {
        _BattleManager_endAction.call(this);
        flushSummonRemoval();
    };

    const _BattleManager_endTurn = BattleManager.endTurn;
    BattleManager.endTurn = function() {
        _BattleManager_endTurn.call(this);
        flushSummonRemoval();
    };

    const _BattleManager_endBattle = BattleManager.endBattle;
    BattleManager.endBattle = function(result) {
        if (isSummonActive) removeSummon();
        _BattleManager_endBattle.call(this, result);
    };

    // ------------------------------------------------------------------
    // Save/Load - summon is battle-only, always clear on load
    // ------------------------------------------------------------------
    const _Game_System_onAfterLoad = Game_System.prototype.onAfterLoad;
    Game_System.prototype.onAfterLoad = function() {
        _Game_System_onAfterLoad.call(this);
        isSummonActive = false;
        summonEnemyId = 0;
        pendingRemoval = false;
    };

    // ------------------------------------------------------------------
    // Public helpers
    // ------------------------------------------------------------------
    window.isSummonActive = function() { return isSummonActive; };
    window.endSummon = function() { removeSummon(); };

})();
