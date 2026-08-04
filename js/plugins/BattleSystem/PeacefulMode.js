//=============================================================================
// PeacefulMode.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v1.0.0 Peaceful difficulty: enemies don't attack unless hurt, a Talk battle command, and no-death respawns.
 * @author Assistant
 *
 * @help PeacefulMode.js
 *
 * Implements the "Peaceful" difficulty selected in character creation
 * (stored on $gameSystem._peacefulMode by CharacterCreation.js).
 *
 * While Peaceful mode is active:
 *
 *  - When a battle starts the monsters will NOT act. Each turn an unprovoked
 *    enemy skips its action and the battle log shows an archetype-flavoured
 *    idle line (e.g. an Insectoid "is buzzing around", an AquaticFish "is
 *    swimming happily"). Archetype comes from the enemy's <Archetype: X> note.
 *
 *  - An enemy only starts fighting back once the player damages its HP with a
 *    skill or attack during the player's turn. Provocation is per-enemy, so
 *    untouched monsters keep idling.
 *
 *  - A new "Talk" battle command is added before Attack. It opens the
 *    EnemyTalkSystem talk menu.
 *
 *  - On a party wipe / game over the party simply respawns at the last respawn
 *    point and no party member dies (the whole party is revived and healed).
 *
 *  - Roaming map enemies whose enemy note asks them to follow (<Movement:
 *    Approach>) wander randomly instead (handled in
 *    BattleSystemEnhancedEncounters.js).
 *
 * Load order: AFTER BattleSystemEnhanchedCommands.js, EnemyTalkSystem.js,
 * BattleSystemEnhancedDeath.js and IndividualBattleTurns.js.
 */

(() => {
  "use strict";

  //=============================================================================
  // Public namespace / mode check
  //=============================================================================

  const PeacefulMode = {
    isActive() {
      return !!(window.$gameSystem && $gameSystem._peacefulMode);
    },
  };
  window.PeacefulMode = PeacefulMode;

  //=============================================================================
  // Archetype-flavoured idle lines (shown when an enemy skips its turn)
  //=============================================================================

  // Lines live in js/i18n/<lang>/plugins/PeacefulMode.json under
  // idle.<archetype>, keyed by the lowercased <Archetype: X> token, with
  // idle.default for anything unlisted. {name} is replaced by the enemy's
  // display name. Each entry holds an array; one line is picked per turn.

  PeacefulMode.idleMessage = function (enemy) {
    let pool = null;
    if (enemy && typeof enemy.getArchetype === "function") {
      const arch = enemy.getArchetype();
      if (arch) {
        const key = "PeacefulMode.idle." + String(arch).toLowerCase();
        if (T.has(key)) pool = T.pool(key);
      }
    }
    if (!pool || !pool.length) pool = T.pool("PeacefulMode.idle.default");
    const line = pool[Math.floor(Math.random() * pool.length)];
    const name = (enemy && enemy.name) ? enemy.name() : "?";
    return line.replace(/\{name\}/g, name);
  };

  //=============================================================================
  // Provocation: an enemy starts fighting back once the player damages its HP
  //=============================================================================

  const _Game_Action_executeHpDamage = Game_Action.prototype.executeHpDamage;
  Game_Action.prototype.executeHpDamage = function (target, value) {
    _Game_Action_executeHpDamage.call(this, target, value);
    if (!PeacefulMode.isActive()) return;
    // Only HP loss (value > 0) dealt by a player action provokes the target.
    if (value > 0 && target && target.isEnemy && target.isEnemy()) {
      const subject = this.subject();
      if (subject && subject.isActor && subject.isActor()) {
        target._peacefulProvoked = true;
      }
    }
  };

  //=============================================================================
  // Enemy turn skip: unprovoked enemies idle instead of acting
  //=============================================================================

  const _BattleManager_processTurn = BattleManager.processTurn;
  BattleManager.processTurn = function () {
    const subject = this._subject;
    if (PeacefulMode.isActive() && subject && subject.isEnemy && subject.isEnemy() && !subject._peacefulProvoked) {
      subject.clearActions();
      if (this._logWindow) {
        this._logWindow.push("addText", PeacefulMode.idleMessage(subject));
        this._logWindow.push("wait");
      }
      // Mirror the vanilla "no action" path: end the action while the subject
      // is still set, then clear it.
      this.endAction();
      this._subject = null;
      return;
    }
    _BattleManager_processTurn.call(this);
  };

  //=============================================================================
  // Talk battle command (added before Attack)
  //=============================================================================

  // The talk menu lives in EnemyTalkSystem.js; only add the command if present.
  const talkSystemLoaded = () => typeof Scene_Battle.prototype.openTalkMenu === "function";

  const _Window_ActorCommand_makeCommandList = Window_ActorCommand.prototype.makeCommandList;
  Window_ActorCommand.prototype.makeCommandList = function () {
    _Window_ActorCommand_makeCommandList.call(this);
    // Talk is a Peaceful-mode-only battle command.
    if (!PeacefulMode.isActive()) return;
    if (!this._actor || !talkSystemLoaded()) return;
    if (typeof this.addCommandWithIcon !== "function") return;
    // Build the Talk entry, then move it to the very front so it sits before Attack.
    this.addCommandWithIcon(T("PeacefulMode.cmd.talk"), "talk", true, null, 4);
    const talkCmd = this._list.pop();
    this._list.unshift(talkCmd);
  };

  const _Scene_Battle_createActorCommandWindow = Scene_Battle.prototype.createActorCommandWindow;
  Scene_Battle.prototype.createActorCommandWindow = function () {
    _Scene_Battle_createActorCommandWindow.call(this);
    if (this._actorCommandWindow) {
      this._actorCommandWindow.setHandler("talk", this.commandTalk.bind(this));
    }
  };

  // Peaceful adds the Talk row, so the command menu is one row taller. Lift it
  // up so the bottom command (e.g. Flee) stays on-screen.
  const _Scene_Battle_actorCommandWindowRect = Scene_Battle.prototype.actorCommandWindowRect;
  Scene_Battle.prototype.actorCommandWindowRect = function () {
    const rect = _Scene_Battle_actorCommandWindowRect.call(this);
    if (PeacefulMode.isActive()) {
      const shift = Math.floor(Graphics.boxHeight * 0.12);
      rect.y = Math.max(0, rect.y - shift);
      rect.height += shift;
    }
    return rect;
  };

  Scene_Battle.prototype.commandTalk = function () {
    if (typeof this.openTalkMenu === "function") {
      this.openTalkMenu();
    } else if (this._actorCommandWindow) {
      this._actorCommandWindow.activate();
    }
  };

  //=============================================================================
  // No-death respawn: on a wipe the whole party is revived and respawned
  //=============================================================================

  function revivePartyFully() {
    $gameParty.members().forEach((member) => {
      if (!member) return;
      member.removeState(member.deathStateId());
      member.setHp(member.mhp);
      member.setMp(member.mmp);
    });
  }

  const _Game_Actor_processMapDeath = Game_Actor.prototype.processMapDeath;
  Game_Actor.prototype.processMapDeath = function () {
    if (PeacefulMode.isActive()) revivePartyFully();
    _Game_Actor_processMapDeath.call(this);
  };

  const _Scene_Map_handleActor1Respawn = Scene_Map.prototype.handleActor1Respawn;
  Scene_Map.prototype.handleActor1Respawn = function () {
    if (PeacefulMode.isActive()) revivePartyFully();
    _Scene_Map_handleActor1Respawn.call(this);
  };

})();
