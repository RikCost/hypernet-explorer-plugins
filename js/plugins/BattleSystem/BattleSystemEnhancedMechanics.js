// ============================================================================
// Battle System Enhanced - Combat Safety & Level Warnings
// For RPG Maker MZ
// ============================================================================

/*:
 * @target MZ
 * @plugindesc v2.0 Mechanics module: health protection, danger warnings, commands.
 * @author Combined by Claude, modified by OmniLex
 * @pluginName BattleSystemEnhancedMechanics
 *
 * @help
 * ============================================================================
 * BattleSystemEnhancedMechanics, Sub-module
 * ============================================================================
 *
 * Requires BattleSystemEnhanced.js (Core) and sub-modules to be loaded first.
 *
 * Provides health protection (death prevention), danger assessment (median level
 * vs enemy level warnings), the top-screen warning toast, and debug commands.
 *
 * Loading order:
 *   1. BattleSystemEnhanced.js (Core)
 *   2. BattleSystemEnhancedEncounters.js
 *   3. BattleSystemEnhancedState.js
 *   4. BattleSystemEnhancedDeath.js
 *   5. BattleSystemEnhancedMechanics.js (THIS PLUGIN)
 *   6. BattleSystemEnhancedLevelDisplay.js
 */

(() => {
    'use strict';

    if (!window.BattleSystemEnhanced) {
        console.error('BattleSystemEnhancedMechanics: Core plugin not loaded!');
        return;
    }
    const BSE = window.BattleSystemEnhanced;

    // ========================================================================
    // 1. HEALTH PROTECTION SYSTEM
    // ========================================================================

    BSE.State._healthProtectionUsed = {};

    BSE.Functions.resetHealthProtection = function() {
        BSE.State._healthProtectionUsed = {};
        $gameParty.members().forEach((actor, index) => {
            BSE.State._healthProtectionUsed[actor.actorId()] = false;
        });
    };

    BSE.Helpers.hasHealthProtection = function(actorId) {
        return !BSE.State._healthProtectionUsed[actorId];
    };

    BSE.Helpers.useHealthProtection = function(actorId) {
        BSE.State._healthProtectionUsed[actorId] = true;
    };


    // ========================================================================
    // 2. BATTLE START DANGER WARNING
    // ========================================================================

    function checkAndShowDangerousEnemyWarning() {
        if (!$gameTroop || !$gameTroop.members().length) return;
        const party = $gameParty.members();
        if (!party.length) return;
        // Sandbox mode or the "Test" playtest character: skip the turn-0
        // "this enemy is too strong" retreat warning entirely.
        const leader = $gameParty.leader();
        if (($gameSystem && $gameSystem._isSandboxMode) || (leader && leader.name() === "Test")) return; // i18n-ignore: playtest character name
        const partyMedian = BSE.Helpers.getMedianLevel(party);
        const highestEnemyLevel = Math.max(...$gameTroop.members().map(enemy => {
            const enemyData = $dataEnemies[enemy.enemyId()];
            return enemyData ? BSE.Helpers.getEnemyLevel(enemyData.note) : 0;
        }));
        if (highestEnemyLevel > partyMedian + 13) {
            showDangerWarning(party);
        }
    }

    function showDangerWarning(party) {
        let message;
        if (party.length === 1) {
            const pool = BSE.Helpers.bi18nList('dangerWarning.single') || [];
            message = party[0].name() + ": " + (pool[Math.floor(Math.random() * pool.length)] || '');
        } else {
            const randomMember = party[Math.floor(Math.random() * party.length)];
            const pool = BSE.Helpers.bi18nList('dangerWarning.party') || [];
            message = randomMember.name() + ": " + (pool[Math.floor(Math.random() * pool.length)] || '');
        }
        const cardMode = window.isCardCombatMode ? window.isCardCombatMode() : $gameSwitches.value(45);
        if (cardMode && (!window.AsciiMode || !window.AsciiMode.active)) {
            showTopScreenMessage(message);
        } else {
            window.skipLocalization = true;
            $gameMessage.add(message);
            window.skipLocalization = false;
        }
    }

    // ========================================================================
    // 3. Top-screen warning (shared ParchmentToast HTML popup)
    // ========================================================================

    function showTopScreenMessage(message) {
        if (SceneManager._scene && SceneManager._scene.constructor === Scene_Battle) {
            if (window.ParchmentToast) {
                window.ParchmentToast.show(message, { severity: "danger", duration: 180 });
            } else {
                $gameMessage.add(message);
            }
        }
    }

    // ========================================================================
    // 4. BattleManager - Integrate Danger Warning on Start
    // ========================================================================

    // This overrides the displayStartMessages from State module to add danger check
    BattleManager.displayStartMessages = function() {
        checkAndShowDangerousEnemyWarning();
    };

    // ========================================================================
    // 5. Game_Actor setHp - Health Protection Override
    // ========================================================================

    // Eris Trial battle (troop 1342, the Eris = enemy 1343 troop): during the
    // first 10 turns the 1-HP protection is ALWAYS on for every party member and
    // is never consumed, so nobody can die while Eris mockingly toys with them.
    const ERIS_TRIAL_TROOP_ID = 1342;
    function erisTrialInvulnerable() {
        return (
            $gameParty.inBattle() &&
            $gameTroop._troopId === ERIS_TRIAL_TROOP_ID &&
            $gameTroop.turnCount() <= 10
        );
    }

    const _Game_Actor_setHp = Game_Actor.prototype.setHp;
    Game_Actor.prototype.setHp = function(hp) {
        const oldHp = this.hp;
        const wasAlive = !this.isDead();
        _Game_Actor_setHp.call(this, hp);

        // Blood and Oil mode: death is lethal - the regular once-per-battle 1-HP
        // protection charge is disabled entirely (the Eris Trial special case,
        // handled above, still applies).
        const bloodAndOil = !!($gameSystem && $gameSystem._bloodAndOilMode);

        if (wasAlive && this.isDead() && oldHp > 1 && erisTrialInvulnerable()) {
            // Always survive on 1 HP, do NOT spend the regular protection charge.
            _Game_Actor_setHp.call(this, 1);
        } else if (!bloodAndOil && wasAlive && this.isDead() && BSE.Helpers.hasHealthProtection(this.actorId()) && oldHp > 1) {
            BSE.Helpers.useHealthProtection(this.actorId());
            _Game_Actor_setHp.call(this, 1);
            if ($gameParty.inBattle()) {
                // Protection sound could be added here
            }
        }

        // Handle map deaths
        if (oldHp > 0 && this.hp <= 0 && !$gameParty.inBattle()) {
            if (this === $gameParty.members()[0]) {
                this.processMapDeath();
            } else if (this === $gameParty.members()[1]) {
                $gameSystem.setActor2Died(true, this.name());
                $gameMap.requestRefresh();
            }
        }
    };

    // ========================================================================
    // 6. BattleManager - Reset Health Protection on Setup
    // ========================================================================

    const _BattleManager_setup_HP = BattleManager.setup;
    BattleManager.setup = function(troopId, canEscape, canLose) {
        _BattleManager_setup_HP.call(this, troopId, canEscape, canLose);
        BSE.Functions.resetHealthProtection();
    };

    // ========================================================================
    // 7. PLUGIN COMMAND FORWARDING
    // ========================================================================

    BSE.Functions.executeDamageActor = function(args) {
        const actorId = parseInt(args.actorId) || 1;
        const amount = parseInt(args.damage) || 0;
        if (amount > 0 && $gameActors.actor(actorId)) {
            const actor = $gameActors.actor(actorId);
            actor.gainHp(-amount);
            if (!$gameParty.inBattle()) {
                $gameTemp.requestAnimation([$gamePlayer], 1229);
                $gameScreen.startFlash([255, 0, 0, 128], 30);
            }
        }
    };

    BSE.Functions.executeResetHealthProtection = function() {
        BSE.Functions.resetHealthProtection();
        window.skipLocalization = true;
        $gameMessage.add(T('Battle.healthProtection.reset'));
        window.skipLocalization = false;
    };

    BSE.Functions.executeCheckHealthProtection = function() {
        const party = $gameParty.members();
        party.forEach((actor, index) => {
            const hasProtection = BSE.Helpers.hasHealthProtection(actor.actorId());
            const status = hasProtection ? T('Battle.healthProtection.available') : T('Battle.healthProtection.used');
            window.skipLocalization = true;
            $gameMessage.add(T('Battle.healthProtection.status', { actor: actor.name(), status: status }));
            window.skipLocalization = false;
        });
    };

})();