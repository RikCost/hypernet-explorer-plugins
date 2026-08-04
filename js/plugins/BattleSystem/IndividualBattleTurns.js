//=============================================================================
// RPG Maker MZ - Individual Turn Battle System - Version 1.1
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Implements a battle system where your action takes place straight after your input.
 * @author Fomar0153
 *
 * @param Battle Turn Order Formula
 * @type string
 * @desc This is a calculation that determines the initial battle order.
 * @default this.agi + Math.randomInt(this.agi / 2)
 *
 * @param Use Party Command Window
 * @type boolean
 * @desc If you hit cancel on the Actor Command Window, show the Party Command Window instead of skipping the turn.
 * @default true
 *
 * @param Add Pass to Party Command Window
 * @type boolean
 * @desc If you are using thr party command window, would you like the pass option added to it?
 * @default true
 *
 * @param Pass Command Name
 * @type string
 * @desc This is the text displayed for the pass command.
 * @default Pass
 *
 * @help Fomar0153_IndividualTurnBattleSystem.js
 * Some examples of the Battle Turn Order Formula:
 * this.agi
 * The battle order will strictly be in order of agility.
 * this.agi + Math.randomInt(this.agi / 2)
 * This will bias the turn order to the fastest combatants but allow for some deviation.
 *
 * Version 1.0 -> 1.1
 * Bug fixes! Specifically to do with restrictions on status effects.
 */

var Fomar = Fomar || {};
Fomar.ITBS = {};

Fomar.ITBS.parameters = PluginManager.parameters('Fomar0153_IndividualTurnBattleSystem');

Fomar.ITBS.battleAgi = Fomar.ITBS.parameters["Battle Turn Order Formula"] || "this.agi";
Fomar.ITBS.partyCommand = (Fomar.ITBS.parameters["Use Party Command Window"] == "true");
Fomar.ITBS.passCommand = (Fomar.ITBS.parameters["Add Pass to Party Command Window"] == "true");
Fomar.ITBS.passText = Fomar.ITBS.parameters["Pass Command Name"] || "Pass";

(() => {

  BattleManager.isTpb = function() {
    return true;
  };

  Fomar.ITBS.BattleManager_initMembers = BattleManager.initMembers;
  BattleManager.initMembers = function() {
    Fomar.ITBS.BattleManager_initMembers.call(this);
    this._battlers = [];
  };

  // Build a fresh round (fastest first per side). With a small party (1-2
  // members) we keep the classic "whole party, then every enemy" ordering.
  // With 3+ active members the party would otherwise fire off 3-4 actions
  // before any enemy responds, so we interleave one enemy turn after each
  // party member. Rebuilding this each round keeps the cadence stable even if
  // the queue was disturbed during the previous round.
  BattleManager.makeITBSRound = function() {
    const all = $gameParty.aliveMembers().concat($gameTroop.aliveMembers());
    // Mid-fight reinforcements never ran onBattleStart, so ensure every battler
    // entering the round has _battleAgi computed before sorting; otherwise the
    // `_battleAgi || 0` fallback would always place them last.
    all.forEach(b => { if (b._battleAgi === undefined) b.updateBattleAgi(); });
    all.sort((a, b) => (b._battleAgi || 0) - (a._battleAgi || 0));
    const actors = all.filter(b => b.isActor());
    const enemies = all.filter(b => !b.isActor());

    if (actors.length < 3 || enemies.length === 0) {
      return actors.concat(enemies);
    }

    // Interleave so that EVERY party member is immediately followed by an enemy
    // turn. Enemies are cycled, so when there are fewer enemies than party
    // members an enemy will take more than one turn in the round (that is the
    // only way to honour "an enemy acts after every member"). The same enemy
    // can therefore appear multiple times in the queue, which is why the
    // dequeue in updateTpb removes by position (shift) and not by value, since
    // RMMZ's Array.remove() would otherwise strip every copy at once.
    const round = [];
    for (let ai = 0; ai < actors.length; ai++) {
      round.push(actors[ai]);
      round.push(enemies[ai % enemies.length]);
    }
    // If there are more enemies than party members, the ones not yet placed
    // still act once, at the end of the round.
    for (let k = actors.length; k < enemies.length; k++) {
      round.push(enemies[k]);
    }
    return round;
  };

  Fomar.ITBS.BattleManager_startBattle = BattleManager.startBattle;
  BattleManager.startBattle = function() {
    Fomar.ITBS.BattleManager_startBattle.call(this);
    // First round uses the same ordering rules as every other round.
    this._battlers = this.makeITBSRound();

    // Split-screen adjustment: player who triggered battle goes first
    if (window.$gameSplitScreen && window.$gameSplitScreen.active) {
      const activator = $gameMessage._eventActivator || "p1";
      let triggeringActor = null;
      if (activator === "p2" && $gameParty.members().length >= 2) {
        triggeringActor = $gameParty.members()[1]; // Player 2
      } else {
        triggeringActor = $gameParty.members()[0]; // Player 1
      }

      if (triggeringActor) {
        const index = this._battlers.indexOf(triggeringActor);
        if (index >= 0) {
          this._battlers.splice(index, 1); // Remove from current position
          this._battlers.unshift(triggeringActor); // Move to front
        }
      }
    }
  };

  BattleManager.updateTurn = function(timeActive) {
    $gameParty.requestMotionRefresh();
    // Honour vanilla forced actions (BattleManager.forceAction). The custom
    // ITBS round loop never consulted _actionForcedBattler, so any forceAction
    // (e.g. MimicSkillSystem's MimicMirror) was a silent no-op. Process it
    // ahead of the normal queue and let the "action" phase take over.
    if (this.isActionForced()) {
      this.processForcedAction();
      return;
    }
    if (!this._subject && !this._currentActor) {
      this.updateTpb();
    }
    if (this._subject) {
      this.processTurn();
    }
  };

  BattleManager.updateTpb = function() {
    // Drop anyone who has died since being queued so a corpse never holds a
    // slot. This also removes every remaining (duplicate) entry of an enemy
    // that has died, so a cycled enemy never acts again once killed.
    this._battlers = this._battlers.filter(member => member && member.isAlive());
    // When the round is finished, start a new one. Rebuilding from scratch
    // keeps the per-round ordering (see makeITBSRound) stable, even if the
    // queue was disturbed during the previous round.
    if (this._battlers.length === 0) {
      this._battlers = this.makeITBSRound();
    }
    if (this._battlers[0]) {
      this._battlers[0].onTurnEnd();
      if (this._battlers[0].isActor()) {
        if (this._battlers[0].canMove()) {
          if (this._battlers[0].canInput()) {
            this._inputting = true;
            this._currentActor = this._battlers[0];
            this._currentActor.makeActions();
            this.startActorInput();
          } else {
            this._subject = this._battlers[0];
            this._subject.makeActions();
          }
        }
      } else {
        this._subject = this._battlers[0];
        this._subject.makeActions();
        $gameTroop.increaseTurn();
      }
      // Remove only THIS entry (by position). The same enemy may appear again
      // later in the round when cycled, so we must not use Array.remove() here,
      // which would strip every copy of that enemy from the queue.
      this._battlers.shift();
    }
  };

  BattleManager.updateTpbInput = function() {
    // done elsewhere now
  };

  BattleManager.finishActorInput = function() {
    if (this._currentActor) {
      this._subject = this._currentActor;
      this._inputting = false;
    }
  };

  BattleManager.changeCurrentActor = function(forward) {
      this._currentActor = null;
  };

  // Compute a battler's turn-order value. Shared by onBattleStart and the
  // per-round lazy init in makeITBSRound so reinforcements are ordered too.
  Game_Battler.prototype.updateBattleAgi = function(advantageous) {
    // Compile the turn-order formula once with new Function instead of eval-ing
    // the string for every battler every round. eval() deopts the whole method;
    // the formula only references `this` and the global Math. Fall back to eval
    // if a custom formula fails to compile.
    if (Fomar.ITBS._battleAgiFn === undefined) {
      try {
        Fomar.ITBS._battleAgiFn = new Function('return (' + Fomar.ITBS.battleAgi + ');'); // i18n-ignore: compiled formula source
      } catch (e) {
        Fomar.ITBS._battleAgiFn = null;
      }
    }
    this._battleAgi = Fomar.ITBS._battleAgiFn
      ? Fomar.ITBS._battleAgiFn.call(this)
      : eval(Fomar.ITBS.battleAgi);
    if (advantageous) {
      this._battleAgi *= 2;
    }
  };

  Fomar.ITBS.Game_Battler_onBattleStart = Game_Battler.prototype.onBattleStart;
  Game_Battler.prototype.onBattleStart = function(advantageous) {
    Fomar.ITBS.Game_Battler_onBattleStart.call(this);
    this.updateBattleAgi(advantageous);
  };

  Game_Battler.prototype.canInput = function() {
    return Game_BattlerBase.prototype.canInput.call(this);
  };

  Game_Battler.prototype.applyTpbPenalty = function() {
    // surely failing to escape is penalty enough?
  };

  Window_StatusBase.prototype.placeTimeGauge = function(actor, x, y) {
    // no time bar, thanks
  };

  Window_PartyCommand.prototype.makeCommandList = function() {
    this.addCommand(TextManager.fight, "fight");
    if (Fomar.ITBS.passCommand) {
      this.addCommand(Fomar.ITBS.passText, "pass");
    }
    this.addCommand(TextManager.escape, "escape", BattleManager.canEscape());
  };

  Fomar.ITBS.Scene_Battle_createPartyCommandWindow = Scene_Battle.prototype.createPartyCommandWindow;
  Scene_Battle.prototype.createPartyCommandWindow = function() {
    Fomar.ITBS.Scene_Battle_createPartyCommandWindow.call(this);
    this._partyCommandWindow.setHandler("pass", this.commandPass.bind(this));
  };

  Scene_Battle.prototype.startPartyCommandSelection = function() {
    this._statusWindow.show();
    this._statusWindow.open();
    this._actorCommandWindow.close();
    this._partyCommandWindow.setup();
  };

  Scene_Battle.prototype.commandCancel = function() {
    if (Fomar.ITBS.partyCommand) {
      this.startPartyCommandSelection();
    } else {
      this.selectPreviousCommand();
    }
  };

  Scene_Battle.prototype.commandFight = function() {
    this._partyCommandWindow.close();
    this._actorCommandWindow.open();
    this._actorCommandWindow.activate();
  };

  Scene_Battle.prototype.commandPass = function() {
    this.selectNextCommand();
  };

  Scene_Battle.prototype.commandEscape = function() {
    BattleManager.processEscape();
    this.selectNextCommand();
  };

})();
