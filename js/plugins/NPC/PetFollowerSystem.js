//=============================================================================
// PetFollowerSystem.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc PetFollowerSystem v1.0.0 — recruit a 4th companion as a pet/follower that trails the party on the map without joining battle.
 * @author Esoteric Heavy Industries
 *
 * @help PetFollowerSystem.js
 *
 * A pet/follower is a companion that walks behind the party on the map but is
 * NOT a party member: it never joins battle, cannot die, and can never be the
 * target of a skill or item (all of which follow naturally from it not being an
 * actor in $gameParty).
 *
 * Cosmetics only: an enemy recruited from one that has the <Talk> tag becomes a
 * "follower"; one without <Talk> becomes a "pet". The distinction only changes
 * the wording in menus and join text, nothing mechanical.
 *
 * Recruiting (see EnemyTalkSystem.js) always routes through the shared API
 * below. Only ONE pet/follower trails the party at a time (the "active" one);
 * recruiting another while one is active simply switches which one follows.
 * Every recruited pet is kept in the registry and can be re-activated or
 * released from the Pets page in the main menu (CustomMainMenuLayout.js).
 *
 * Public API (window.PetSystem):
 *   registerPet(record)  → adds/updates a pet record, does not change active
 *   recruitPet(record)   → registerPet + setActive (used on recruitment)
 *   getPets()            → array of pet records
 *   getPet(id)           → one record or null
 *   getActivePet()       → the active (following) record or null
 *   setActivePet(id)     → make a registered pet the active follower
 *   renamePet(id, name)  → give a registered pet a new name
 *   releasePet(id)       → remove a pet from the registry
 *   refreshFollower()    → re-sync the on-map trailing sprite
 *
 * Pet record fields: { id, name, characterName, characterIndex, isFollower,
 *   enemyId, enemyName, level, archetype, note, skillIds }
 */

//-----------------------------------------------------------------------------
// Game_PetFollower  (global so JsonEx can reconstruct it from saves)
//
// An extra trailing follower slot that is not backed by a party member. It
// draws the currently active pet's sprite, or nothing when there is no active
// pet. It chases the follower ahead of it via the normal Game_Followers chain.
//-----------------------------------------------------------------------------
function Game_PetFollower() {
    this.initialize(...arguments);
}

Game_PetFollower.prototype = Object.create(Game_Follower.prototype);
Game_PetFollower.prototype.constructor = Game_PetFollower;

Game_PetFollower.prototype.initialize = function (memberIndex) {
    Game_Follower.prototype.initialize.call(this, memberIndex);
};

// Not backed by an actor.
Game_PetFollower.prototype.actor = function () {
    return null;
};

Game_PetFollower.prototype.isVisible = function () {
    const pet = window.PetSystem && window.PetSystem.getActivePet();
    return !!pet && $gamePlayer.followers().isVisible();
};

Game_PetFollower.prototype.refresh = function () {
    const pet = this.isVisible() ? (window.PetSystem && window.PetSystem.getActivePet()) : null;
    const characterName = pet ? pet.characterName : "";
    const characterIndex = pet ? (pet.characterIndex || 0) : 0;
    this.setImage(characterName, characterIndex);
};

window.Game_PetFollower = Game_PetFollower;

(() => {
    "use strict";

    //-------------------------------------------------------------------------
    // Game_Followers — append the pet slot to the trailing follower chain.
    //-------------------------------------------------------------------------

    Game_Followers.prototype.ensurePetFollower = function () {
        if (!this._data) this._data = [];
        if (!this._data.some(f => f instanceof Game_PetFollower)) {
            const pf = new Game_PetFollower(this._data.length);
            // Snap to the player so a slot created mid-map (e.g. loading an old
            // save) doesn't briefly appear at the map corner before it catches up.
            // Skip while $dataMap is null (Game_Followers construction during
            // DataManager.createGameObjects): locate() -> refreshBushDepth()
            // reads $dataMap.width and would crash. The map-setup player locate
            // positions followers anyway in that case.
            if (typeof $dataMap !== "undefined" && $dataMap &&
                typeof $gamePlayer !== "undefined" && $gamePlayer && $gamePlayer.locate) {
                pf.locate($gamePlayer.x, $gamePlayer.y);
            }
            this._data.push(pf);
        }
    };

    const _Game_Followers_setup = Game_Followers.prototype.setup;
    Game_Followers.prototype.setup = function () {
        _Game_Followers_setup.call(this);
        this.ensurePetFollower();
    };

    // The pet slot must be present in _data before the spriteset builds its
    // follower sprites, so old saves (which predate the slot) still get one.
    const _Spriteset_Map_createCharacters = Spriteset_Map.prototype.createCharacters;
    Spriteset_Map.prototype.createCharacters = function () {
        if ($gamePlayer && $gamePlayer.followers()) {
            $gamePlayer.followers().ensurePetFollower();
        }
        _Spriteset_Map_createCharacters.call(this);
    };

    //-------------------------------------------------------------------------
    // window.PetSystem — registry + active-follower management.
    //-------------------------------------------------------------------------

    // Same ceiling the name-entry screen uses for actors (AltNameInput.js), so a
    // pet name can never be longer than a party member's.
    const PET_NAME_MAX_LENGTH = 16;

    function _store() {
        if (!$gameSystem) return null;
        if (!$gameSystem._petRegistry) $gameSystem._petRegistry = [];
        return $gameSystem._petRegistry;
    }

    function _refreshFollower() {
        if ($gamePlayer && $gamePlayer.followers()) {
            $gamePlayer.followers().refresh();
        }
    }

    window.PetSystem = {
        // The rename field in the Pets page caps typing at the same length
        // renamePet() enforces.
        NAME_MAX_LENGTH: PET_NAME_MAX_LENGTH,

        getPets() {
            return _store() || [];
        },

        getPet(id) {
            const list = _store();
            if (!list) return null;
            return list.find(p => p && p.id === id) || null;
        },

        getActivePet() {
            if (!$gameSystem || $gameSystem._activePetId == null) return null;
            return this.getPet($gameSystem._activePetId);
        },

        registerPet(record) {
            const list = _store();
            if (!list) return null;
            if (!$gameSystem._petIdCounter) $gameSystem._petIdCounter = 0;
            const pet = {
                id: ++$gameSystem._petIdCounter,
                name: String(record.name || T('PetFollower.defaultName')),
                characterName: record.characterName || "",
                characterIndex: record.characterIndex || 0,
                isFollower: !!record.isFollower,
                enemyId: record.enemyId || 0,
                enemyName: record.enemyName || "",
                level: record.level || 1,
                archetype: record.archetype || null,
                note: record.note || "",
                skillIds: Array.isArray(record.skillIds) ? record.skillIds.slice() : [],
            };
            list.push(pet);
            return pet;
        },

        recruitPet(record) {
            const pet = this.registerPet(record);
            if (pet) this.setActivePet(pet.id);
            return pet;
        },

        setActivePet(id) {
            if (!$gameSystem) return;
            const pet = this.getPet(id);
            $gameSystem._activePetId = pet ? pet.id : null;
            _refreshFollower();
        },

        // A pet joins under the name of the monster it was; the player renames it
        // from the Pets page. An empty or whitespace-only name is refused (the
        // pet keeps the one it has) and anything longer than the name-entry limit
        // is cut, so the registry never holds a name a menu row cannot show.
        renamePet(id, name) {
            const pet = this.getPet(id);
            if (!pet) return null;
            const trimmed = String(name == null ? "" : name).trim().slice(0, PET_NAME_MAX_LENGTH);
            if (!trimmed) return pet;
            pet.name = trimmed;
            return pet;
        },

        releasePet(id) {
            const list = _store();
            if (!list) return;
            const idx = list.findIndex(p => p && p.id === id);
            if (idx < 0) return;
            list.splice(idx, 1);
            if ($gameSystem._activePetId === id) {
                // Fall back to the most recently recruited remaining pet, if any.
                $gameSystem._activePetId = list.length ? list[list.length - 1].id : null;
            }
            _refreshFollower();
        },

        refreshFollower() {
            _refreshFollower();
        },
    };

    console.log("[PetFollowerSystem] v1.0.0 loaded.");
})();
