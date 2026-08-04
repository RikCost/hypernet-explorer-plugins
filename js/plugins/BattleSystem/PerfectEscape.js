/*:
 * @plugindesc Makes player escape from battle 100% successful.
 * @author Omni-Lex
 * @target MZ MV
 * @help PerfectEscape.js
 * 
 * This plugin ensures that player escape attempts from battle
 * always succeed (100% success rate).
 * 
 * No plugin parameters are needed.
 * Just install the plugin and enable it in your project.
 * 
 * Compatible with RPG Maker MV and MZ.
 */

(function() {
    // Override the escape success rate calculation
    Game_BattlerBase.prototype.makeEscapeRatio = function() {
        return 1.0; // 100% success rate
    };
    
    // Force the escape ratio to 100% and delegate to the vanilla processEscape
    // so the standard "escaped" message still displays (the previous
    // reimplementation dropped it by never calling the original).
    var _BattleManager_processEscape = BattleManager.processEscape;
    BattleManager.processEscape = function() {
        this._escapeRatio = 1.0;
        return _BattleManager_processEscape.call(this);
    };
})();
