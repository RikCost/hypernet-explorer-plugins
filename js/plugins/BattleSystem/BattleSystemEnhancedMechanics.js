// ============================================================================
// Battle System Enhanced - Combat Safety & Level Warnings
// For RPG Maker MZ
// ============================================================================

/*:
 * @target MZ
 * @plugindesc v2.1 Mechanics module: health protection, danger warnings, stat requirement fumbles, commands.
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
 * vs enemy level warnings), the top-screen warning toast, the stat requirement
 * fumble roll (<StatReq: STAT N>, window.SkillStatReq), and debug commands.
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
    // 7. ENEMY MERCY: A NON-BOSS <TALK> ENEMY MAY SPARE THE PARTY
    //
    //   On its turn, a <Talk> enemy that is not a <Boss> weighs the fight it is
    //   in and can walk away unharmed, without a corpse, when any of these
    //   hold: it so outclasses the party that finishing them is beneath it
    //   (the same level gap the battle-start danger warning above uses), the
    //   party has already won it over through the talk menu (EnemyTalkSystem's
    //   disposition), or the party is already down a member or fighting on
    //   critical HP and it takes pity rather than finish them off.
    //   MERCY_CHANCE keeps this a "sometimes", not a guarantee, and the roll
    //   only happens for an eligible enemy that still has a turn to act, so a
    //   failed roll is silent and the enemy simply attacks as normal.
    // ========================================================================

    const MERCY_CHANCE = 0.05;
    const MERCY_DISPOSITION_THRESHOLD = 70;
    const MERCY_LEVEL_GAP = 13; // matches checkAndShowDangerousEnemyWarning above

    function enemyMercyEligible(enemy) {
        if (!enemy || !enemy.isAlive || !enemy.isAlive()) return false;
        if (($gameSystem && $gameSystem._isSandboxMode)) return false;
        const leader = $gameParty.leader();
        if (leader && leader.name() === "Test") return false; // i18n-ignore: playtest character name
        const data = enemy.enemy();
        if (!data) return false;
        const note = data.note || "";
        if (/<Boss>/i.test(note)) return false;
        if (!/<Talk>/i.test(note)) return false;
        if (enemy.isUnrecruitable && enemy.isUnrecruitable()) return false;
        return true;
    }

    function enemyOutclassesParty(enemy) {
        const party = $gameParty.members();
        if (!party.length) return false;
        const enemyLevel = BSE.Helpers.getBattlerLevel(enemy);
        if (enemyLevel <= 0) return false;
        return enemyLevel > BSE.Helpers.getMedianLevel(party) + MERCY_LEVEL_GAP;
    }

    function partyWonEnemyOver(enemy) {
        return !!(enemy.disposition && enemy.disposition() >= MERCY_DISPOSITION_THRESHOLD);
    }

    function partyIsHurting() {
        return $gameParty.members().some(m => m && (m.isDead() || m.isDying()));
    }

    // Which pool of dialogue fits, in priority order: a friendship earned
    // through the talk menu comes first (the rarer, more deliberate reason),
    // then pity for a party already reeling, then simple condescension.
    function mercyReason(enemy) {
        if (partyWonEnemyOver(enemy)) return 'friendly';
        if (partyIsHurting()) return 'pity';
        if (enemyOutclassesParty(enemy)) return 'tooStrong';
        return null;
    }

    function rollEnemyMercy(enemy) {
        if (!enemyMercyEligible(enemy)) return null;
        const reason = mercyReason(enemy);
        if (!reason) return null;
        return Math.random() < MERCY_CHANCE ? reason : null;
    }

    function spareParty(enemy, reason) {
        const pool = BSE.Helpers.bi18nList('mercy.' + reason) || [];
        const line = pool[Math.floor(Math.random() * pool.length)] || '';
        window.skipLocalization = true;
        $gameMessage.add(enemy.name() + ": " + line);
        window.skipLocalization = false;
        // Gone whole, not killed: no corpse, and its map event is removed
        // until the player returns to the map, exactly like a talked-round
        // recruit leaving the field (EnemyTalkSystem.js).
        enemy.hide();
        if ($gameTroop.aliveMembers().length === 0) BattleManager.abort();
    }

    const _Game_Enemy_makeActions_mercy = Game_Enemy.prototype.makeActions;
    Game_Enemy.prototype.makeActions = function() {
        const reason = rollEnemyMercy(this);
        if (reason) {
            this.clearActions();
            spareParty(this, reason);
            return;
        }
        _Game_Enemy_makeActions_mercy.call(this);
    };

    // ========================================================================
    // 8. STAT REQUIREMENT FUMBLES
    // ========================================================================
    // Every skill names a base stat and a floor for it (`<StatReq: INT 14>`,
    // read by window.SkillStatReq in the Core module). Nothing bars a character
    // from carrying or casting a skill they are short on: they simply do not
    // have the grip on it yet, and the action can come apart in their hands.
    //
    // The roll is taken ONCE per action, not once per target, so a spell thrown
    // at the whole troop either lands on all of them or on none. The cost is
    // paid either way - Game_Battler.useItem has already run by the time the
    // action is invoked, and a spell that fizzles halfway out still burns the MP
    // it was pushed with.

    function statReqFumble(action) {
        if (!action || action._statReqFumbled !== undefined) return action ? action._statReqFumbled : false;
        action._statReqFumbled = false;
        const subject = action.subject && action.subject();
        const item = action.item && action.item();
        if (!subject || !item || !action.isSkill || !action.isSkill()) return false;
        if (!window.SkillStatReq) return false;
        const chance = window.SkillStatReq.failChance(subject, item);
        if (chance > 0 && Math.random() < chance) action._statReqFumbled = true;
        return action._statReqFumbled;
    }
    BSE.Helpers.rollStatReqFumble = statReqFumble;

    // Rolled where the action is announced, so the battle log can say what went
    // wrong before the first target is touched.
    const _BattleManager_startAction_statReq = BattleManager.startAction;
    BattleManager.startAction = function() {
        const subject = this._subject;
        const action = subject && subject.currentAction && subject.currentAction();
        if (action) statReqFumble(action);
        _BattleManager_startAction_statReq.call(this);
    };

    const _Window_BattleLog_startAction_statReq = Window_BattleLog.prototype.startAction;
    Window_BattleLog.prototype.startAction = function(subject, action, targets) {
        _Window_BattleLog_startAction_statReq.call(this, subject, action, targets);
        if (action && statReqFumble(action)) {
            const item = action.item();
            const req = window.SkillStatReq.of(item);
            this.push('addText', T('Battle.statReq.fumble', {
                actor: subject.name(),
                skill: item.name,
                stat: window.SkillStatReq.statName(req.stat)
            }));
        }
    };

    // A fumbled action reaches its targets and does nothing to them. The result
    // is left reading as a miss so every HUD, log and animation already written
    // for a miss says the right thing without being taught a new word.
    const _Game_Action_apply_statReq = Game_Action.prototype.apply;
    Game_Action.prototype.apply = function(target) {
        if (statReqFumble(this)) {
            const result = target.result();
            result.clear();
            result.used = true;
            result.missed = true;
            return;
        }
        _Game_Action_apply_statReq.call(this, target);
    };

    // ========================================================================
    // 9. PLUGIN COMMAND FORWARDING
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