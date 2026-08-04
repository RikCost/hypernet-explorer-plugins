// ============================================================================
// Battle System Enhanced - Map UI & Enemy Level Nameplates
// For RPG Maker MZ
// ============================================================================

/*:
 * @target MZ
 * @plugindesc v2.0 Level Display: enemy level labels on map character sprites.
 * @author Combined by Claude, modified by OmniLex
 * @pluginName BattleSystemEnhancedLevelDisplay
 *
 * @help
 * ============================================================================
 * BattleSystemEnhancedLevelDisplay, Sub-module
 * ============================================================================
 *
 * Requires BattleSystemEnhanced.js (Core) and all preceding sub-modules.
 *
 * Provides overworld UI element layer by attaching floating numeric level tags
 * relative to visible map character rendering points.
 *
 * Loading order (LAST):
 *   1. BattleSystemEnhanced.js (Core)
 *   2. BattleSystemEnhancedEncounters.js
 *   3. BattleSystemEnhancedState.js
 *   4. BattleSystemEnhancedDeath.js
 *   5. BattleSystemEnhancedMechanics.js
 *   6. BattleSystemEnhancedLevelDisplay.js (THIS PLUGIN)
 */

(() => {
    'use strict';

    if (!window.BattleSystemEnhanced) {
        console.error('BattleSystemEnhancedLevelDisplay: Core plugin not loaded!');
        return;
    }
    const BSE = window.BattleSystemEnhanced;

    // ========================================================================
    // 1. Helper: Get enemy level from event
    // ========================================================================

    function getEnemyLevelFromEvent(event) {
        if (!event._fixedTroopId || event._fixedTroopId === 0) return 0;
        const troop = $dataTroops[event._fixedTroopId];
        if (!troop || !troop.members.length) return 0;
        let maxLevel = 0;
        for (const member of troop.members) {
            const enemyData = $dataEnemies[member.enemyId];
            if (enemyData && enemyData.note) {
                const level = BSE.Helpers.getEnemyLevel(enemyData.note);
                if (level > maxLevel) maxLevel = level;
            }
        }
        return maxLevel;
    }

    // Expose for other modules (used in enemy-vs-enemy combat)
    window.getEnemyLevelFromEvent = getEnemyLevelFromEvent;

    // ========================================================================
    // 2. Sprite_Character - Override update for enemy level labels
    // ========================================================================

    const _Sprite_Character_update_EnemyLevel = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function() {
        _Sprite_Character_update_EnemyLevel.call(this);
        this.updateEnemyLevelLabel();
    };

    Sprite_Character.prototype.updateEnemyLevelLabel = function() {
        const character = this._character;
        if (!character || !character.eventId) return;
        const eventId = character.eventId();
        if (!eventId) return;
        // For an event sprite, this._character IS the Game_Event, so use it
        // directly instead of re-resolving $gameMap.event(eventId) every frame
        // for every character sprite on the map.
        const event = character;
        const eventData = event.event ? event.event() : null;
        if (!eventData) return;

        // Only show for events with a fixed troop ID assigned. If the troop was
        // cleared (e.g. the enemy was defeated), remove any stale label instead
        // of leaving it floating on the map.
        if (!event._fixedTroopId || event._fixedTroopId === 0) {
            if (this._enemyLevelLabel) {
                this.removeChild(this._enemyLevelLabel);
                this._enemyLevelLabel = null;
            }
            this._lastEnemyTroopId = 0;
            return;
        }

        // Check if troop changed or label doesn't exist yet
        if (this._lastEnemyTroopId !== event._fixedTroopId) {
            this._lastEnemyTroopId = event._fixedTroopId;

            // Remove old label if exists
            if (this._enemyLevelLabel) {
                this.removeChild(this._enemyLevelLabel);
                this._enemyLevelLabel = null;
            }

            const enemyLevel = getEnemyLevelFromEvent(event);
            if (enemyLevel > 0) {
                this.createEnemyLevelLabel(enemyLevel);
            }
        }
    };

    Sprite_Character.prototype.createEnemyLevelLabel = function(level) {
        const party = $gameParty.members();
        const medianLevel = party.length > 0 ? BSE.Helpers.getMedianLevel(party) : 1;
        const levelDiff = level - medianLevel;

        let color = '#FFFFFF';
        if (levelDiff > 30) color = '#FF0000';
        else if (levelDiff > 15) color = '#FFFF00';

        this._enemyLevelLabel = new Sprite();
        this._enemyLevelLabel.bitmap = new Bitmap(80, 30);
        this._enemyLevelLabel.anchor.x = 0.5;
        this._enemyLevelLabel.anchor.y = 1;

        const bitmap = this._enemyLevelLabel.bitmap;
        bitmap.fontFace = 'GameFont';
        bitmap.fontSize = 18;
        bitmap.textColor = color;
        bitmap.outlineColor = 'rgba(0, 0, 0, 0.8)';
        bitmap.outlineWidth = 4;

        bitmap.drawText(`L. ${level}`, 0, 0, 80, 30, 'center');
        this._enemyLevelLabel.y = -50;
        this.addChild(this._enemyLevelLabel);
    };

})();