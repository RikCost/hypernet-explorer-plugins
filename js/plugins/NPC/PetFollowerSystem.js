//=============================================================================
// PetFollowerSystem.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc PetFollowerSystem v1.1.0 — recruit a 4th companion as a pet/follower that trails the party on the map without joining battle.
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
 * A third kind of record is a CHILD: whatever a party member's pregnancy
 * produces (a baby, a hatchling, a clone, a sprout) is registered here too, so
 * the family walks in the same line as the pets. A child wears the sprite of
 * the party member who bore it and carries a generated name.
 *
 * Public API (window.PetSystem):
 *   registerPet(record)  → adds/updates a pet record, does not change active
 *   recruitPet(record)   → registerPet + setActive (used on recruitment)
 *   birthChild(actor, o) → register a newborn from a parent actor
 *   getPets()            → array of pet records
 *   getPet(id)           → one record or null
 *   getChildren()        → the child records only
 *   getActivePet()       → the active (following) record or null
 *   setActivePet(id)     → make a registered pet the active follower
 *   renamePet(id, name)  → give a registered pet a new name
 *   releasePet(id)       → remove a pet from the registry
 *   abandonPet(id)       → file the crime, then remove it (see below)
 *   refreshFollower()    → re-sync the on-map trailing sprite
 *
 * Abandonment is the only way to be rid of a companion, and it is an offence:
 * leaving a pet behind is filed with the nEuroPolice as pet abandonment, and
 * leaving a child behind as the graver charge of child abandonment.
 *
 * Pet record fields: { id, name, characterName, characterIndex, isFollower,
 *   isChild, parentName, bornOn, enemyId, enemyName, level, archetype, note,
 *   skillIds }
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

    // The bank a newborn's name is drawn from. Plain given names rather than one
    // of the personality registers the procedural citizens use: a child has no
    // trade yet.
    const CHILD_NAME_DB = "names";  // i18n-ignore  js/db/TextGen/names.json id

    // Unlike a procedural citizen (whose name must come back the same on every
    // visit to its square), a birth happens once, so the name is rolled freely
    // and then kept in the record.
    function _newbornName() {
        if (!window.generateSeededMarkovName) return null;
        const seed = ((Math.random() * 0x7fffffff) >>> 0) ^ (Graphics.frameCount * 2654435761 >>> 0);
        try {
            const gen = window.generateSeededMarkovName(
                seed & 0xffff, (seed >>> 16) & 0xffff, (seed & 0x7fff) || 1,
                CHILD_NAME_DB, 2, 4, 12
            );
            // The generator answers with its own sentinel when the bank is
            // unusable; that is not a name, so the caller falls back.
            if (gen && gen !== "Unknown" && gen !== T('Markov.unknownName')) return gen;  // i18n-ignore: Markov generator sentinel
        } catch (e) {}
        return null;
    }

    // A newborn is its own person and looks like one: the sprite comes from the
    // Skab pixel pack, the same wardrobe every procedural citizen is drawn from
    // (js/db/WorldGen/NPCs.json, npc entries under Skab/). A mitosis clone is
    // the exception and is handed its parent's sprite by the caller.
    // Beta sheets are dealt here only in a world created with beta sprites on,
    // so the pool is asked for fresh each time rather than memoized: activating
    // another world changes the answer (window.SpriteCatalog does the caching).
    function _randomSkabSprite() {
        const skab = (k) => k.indexOf("Skab/") === 0;
        const name = window.SpriteCatalog?.pickNpcKey
            ? window.SpriteCatalog.pickNpcKey(Math.random(), { filter: skab })
            : null;
        if (!name) return null;
        // A "!$" sheet holds one character in a 3x4 grid, so its index is always 0.
        const index = name.includes("!$") ? 0 : Math.floor(Math.random() * 8);
        return { characterName: name, characterIndex: index };
    }

    // The charge an abandonment is filed under, or null when there is none. A
    // follower is a creature that talked its way into the party of its own
    // accord (an enemy with the <Talk> note) and is free to be sent away again,
    // so no law is broken. A pet is a dependent animal and a child is a person:
    // leaving either behind is an offence, the child by far the graver one.
    function _abandonCrimeKey(pet) {
        if (!pet) return null;
        if (pet.isChild) return "abandonChild";  // i18n-ignore  PresetCrimes.json key
        if (pet.isFollower) return null;
        return "abandonPet";                     // i18n-ignore  PresetCrimes.json key
    }

    // ---- Mitosis --------------------------------------------------------
    // A clone is not a child but a second copy of somebody who already exists,
    // so it is named after the original and numbered: "Ada #1", "Ada #2". The
    // number counts every copy the world already holds, whether it is walking
    // in the party or waiting in the followers menu, so no two copies of the
    // same person ever share a name.

    function _copyBaseName(name) {
        return String(name == null ? "" : name).replace(/\s*#\d+\s*$/, "").trim();
    }

    function _nextCopyNumber(baseName) {
        const pattern = new RegExp("^" + baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*#(\\d+)$");
        let highest = 0;
        const consider = (name) => {
            const m = pattern.exec(String(name == null ? "" : name).trim());
            if (m) highest = Math.max(highest, Number(m[1]) || 0);
        };
        if ($gameParty) $gameParty.members().forEach(a => consider(a.name()));
        (_store() || []).forEach(p => consider(p && p.name));
        return highest + 1;
    }

    // Actor 2, then Actor 3. Multiplayer (Switch 67) reserves Actor 3 for the
    // remote guest, exactly as recruiting an NPC does (NPCSystemParty.js), so a
    // clone there can only take Actor 3 when nobody is in it.
    function _freeCompanionSlot() {
        if (!$gameParty || !$gameParty._actors) return 0;
        if ($gameSwitches && $gameSwitches.value(67)) {
            return $gameParty._actors.includes(3) ? 0 : 3;
        }
        if (!$gameParty._actors.includes(2)) return 2;
        if (!$gameParty._actors.includes(3)) return 3;
        return 0;
    }

    // Per-actor slots that hold what used to live in global variables
    // (ActorCharacterFields.js) and the switches/variables the creature and
    // reproduction systems still key by party position.
    const CREATURE_SWITCHES = { 1: 77, 2: 78, 3: 79 };
    const REPRODUCTION_VARS = { 1: 87, 2: 115, 3: 116 };

    function _copyActorInto(actorId, source, name) {
        const clone = $gameActors && $gameActors.actor(actorId);
        if (!clone) return null;
        // Start from the database entry so nothing of a previous occupant of the
        // slot (a companion who left, a guest) survives into the copy.
        clone.setup(actorId);
        clone.setName(name);
        if (source._classId) clone.changeClass(source._classId, false);
        clone.changeLevel(source.level(), false);
        clone.setCharacterImage(source.characterName(), source.characterIndex());
        clone.setFaceImage(source.faceName(), source.faceIndex());
        clone.setBattlerImage(source.battlerName());
        (source._skills || []).forEach(id => clone.learnSkill(id));
        if (clone.setGender && source.gender) clone.setGender(source.gender());
        if (clone.setVnBust && source.vnBust) clone.setVnBust(source.vnBust());
        if (clone.setVnBattler && source.vnBattler) clone.setVnBattler(source.vnBattler());
        // A creature divides into a creature, and whatever divided can divide
        // again: the copy inherits both flags from the original's slot.
        const sourceId = source.actorId();
        if ($gameSwitches && CREATURE_SWITCHES[sourceId] && CREATURE_SWITCHES[actorId]) {
            $gameSwitches.setValue(CREATURE_SWITCHES[actorId], $gameSwitches.value(CREATURE_SWITCHES[sourceId]));
        }
        if ($gameVariables && REPRODUCTION_VARS[sourceId] && REPRODUCTION_VARS[actorId]) {
            $gameVariables.setValue(REPRODUCTION_VARS[actorId], $gameVariables.value(REPRODUCTION_VARS[sourceId]));
        }
        clone.recoverAll();
        $gameParty.addActor(actorId);
        if ($gameVariables) $gameVariables.setValue(29, $gameParty.members().length);
        return clone;
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

        getChildren() {
            return this.getPets().filter(p => p && p.isChild);
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
                isChild: !!record.isChild,
                parentName: record.parentName || "",
                bornOn: record.bornOn || "",
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
            // Last gate on the rule EnemyTalkSystem owns: a <NoRecruit> creature
            // (a petrodemon) is never a pet, a follower or anyone's company,
            // whichever path asked.
            const unrecruitable = window.EnemyTalk && window.EnemyTalk.isUnrecruitableData;
            if (record && unrecruitable && unrecruitable({ note: record.note || '' })) return null;
            const pet = this.registerPet(record);
            if (pet) this.setActivePet(pet.id);
            return pet;
        },

        // A pregnancy of any kind ending (a birth, a clutch of eggs, a clone, a
        // planted seed) hands the offspring over here. It gets a face of its own
        // out of the Skab pixel pack and a name of its own, unless the caller
        // supplies them (a mitosis clone is its parent twice over, sprite
        // included). A newborn only takes the leash when nothing else is
        // following, so a birth never displaces the pet already walking with the
        // party.
        birthChild(actor, record) {
            if (!actor) return null;
            const opts = record || {};
            const look = (opts.characterName)
                ? { characterName: opts.characterName, characterIndex: opts.characterIndex || 0 }
                : (_randomSkabSprite() || { characterName: actor.characterName(), characterIndex: actor.characterIndex() });
            const child = this.registerPet({
                name: opts.name || _newbornName() || T('PetFollower.defaultChildName'),
                characterName: look.characterName,
                characterIndex: look.characterIndex,
                isChild: true,
                parentName: actor.name(),
                bornOn: $gameVariables ? String($gameVariables.value(113) || "") : "",
                level: 1,
            });
            if (!child) return null;
            if (!this.getActivePet()) this.setActivePet(child.id);
            else _refreshFollower();
            return child;
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

        // Mitosis does not make a child, it makes a second of somebody. The copy
        // takes a place in the party when there is one free, and otherwise walks
        // behind it as a companion. Either way it is named after the original
        // and numbered. Returns { name, copyNumber, joined, actorId, child }.
        mitosisSplit(actor) {
            if (!actor) return null;
            const base = _copyBaseName(actor.name()) || T('PetFollower.defaultChildName');
            const copyNumber = _nextCopyNumber(base);
            const name = base + " #" + copyNumber;

            const slot = _freeCompanionSlot();
            if (slot) {
                const clone = _copyActorInto(slot, actor, name);
                if (clone) return { name, copyNumber, joined: true, actorId: slot, child: null };
            }
            // No room to travel: the copy is registered like any other offspring,
            // wearing the original's sprite because that is what it is.
            const child = this.birthChild(actor, {
                name,
                characterName: actor.characterName(),
                characterIndex: actor.characterIndex(),
            });
            return { name, copyNumber, joined: false, actorId: 0, child };
        },

        // What an abandonment would be charged as, for a caller that wants to
        // say so before it happens (the Pets page warns first). Null when the
        // parting is lawful.
        abandonCrimeFor(id) {
            const key = _abandonCrimeKey(this.getPet(id));
            if (!key || !window.CrimeSystem || !window.CrimeSystem.getPresetCrime) return null;
            const preset = window.CrimeSystem.getPresetCrime(key);
            if (!preset) return null;
            return Object.assign({}, preset, {
                key: key,
                name: window.CrimeSystem.presetCrimeName
                    ? window.CrimeSystem.presetCrimeName(key)
                    : preset.name,
            });
        },

        // Leaving a companion behind. The record goes the same way a release
        // went, but the act is filed with the nEuroPolice first when there is
        // anything to file. The charge is filed before the record is dropped,
        // so the notification can still name what was abandoned.
        abandonPet(id) {
            const pet = this.getPet(id);
            if (!pet) return null;
            const key = _abandonCrimeKey(pet);
            if (key && window.CrimeSystem && window.CrimeSystem.addPresetCrime) {
                window.CrimeSystem.addPresetCrime(key);
            }
            this.releasePet(id);
            return pet;
        },

        refreshFollower() {
            _refreshFollower();
        },
    };

    console.log("[PetFollowerSystem] v1.1.0 loaded.");
})();
