//=============================================================================
// ActorCharacterFields.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Per-character fields (gender, bust/battler portrait, equipment-derived stats) stored directly on the actor instead of in global game variables.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ActorCharacterFields.js
 * ============================================================================
 * These per-character values used to live in fixed global game variables, one
 * block per protagonist. They now live on the Game_Actor itself, so they are
 * party-private, travel with the character, and no longer occupy variable ids:
 *
 *   gender() / setGender(v) .................  0=Male 1=Female 2=Non-binary 3=Cocoon
 *   vnBattler() / setVnBattler(v) ...........  monster/battler portrait image name (or 0)
 *   vnBust() / setVnBust(v) .................  bust portrait image name (or 0)
 *   portraitMode() / setPortraitMode(v) .....  "bust" | "sprite" | "model" (or 0)
 *   pvArcane/pvSubstance/pvStealth/pvIntimidation() + setters ... equip-derived stats
 *
 * portraitMode is the exclusive art style chosen at character creation. A
 * humanoid picks "bust" (hand-drawn portrait) or "model" (procedural 3D); a
 * creature picks "sprite" (2D enemy battler image) or "model". Only the chosen
 * one is ever built or displayed, so the two never compete.
 *
 * All plugins and events that used the old variables (gender 38-40, battler
 * 106-108, bust 109/117/118, stats 121-130) were rewritten to call these
 * accessors, and those variable ids were freed in System.json.
 * ============================================================================
 */

(() => {
    "use strict";

    // Numeric field: integer, default 0.
    function defNumField(getter, setter, key) {
        Game_Actor.prototype[getter] = function () {
            return this[key] === undefined || this[key] === null ? 0 : this[key];
        };
        Game_Actor.prototype[setter] = function (value) {
            this[key] = Math.floor(Number(value) || 0);
        };
    }

    // Free-form field (image name string, or 0 when unset). Default 0 keeps the
    // old `if (name) { ... }` falsy checks behaving as before.
    function defRawField(getter, setter, key) {
        Game_Actor.prototype[getter] = function () {
            return this[key] === undefined || this[key] === null ? 0 : this[key];
        };
        Game_Actor.prototype[setter] = function (value) {
            this[key] = value;
        };
    }

    defNumField("gender", "setGender", "_pvGender");

    defRawField("vnBattler", "setVnBattler", "_pvBattler");
    defRawField("vnBust", "setVnBust", "_pvBust");
    defRawField("portraitMode", "setPortraitMode", "_pvPortraitMode");

    defNumField("pvArcane", "setPvArcane", "_pvArcane");
    defNumField("pvSubstance", "setPvSubstance", "_pvSubstance");
    defNumField("pvStealth", "setPvStealth", "_pvStealth");
    defNumField("pvIntimidation", "setPvIntimidation", "_pvIntimidation");
})();
