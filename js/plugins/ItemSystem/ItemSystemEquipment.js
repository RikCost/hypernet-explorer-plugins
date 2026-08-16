/*:
 * @target MZ
 * @plugindesc Character Switch Equip Menu v1.6.0 (D&D Parchment Modern Edition)
 * @author Omni-Lex
 * @version 1.6.0
 * @description Modernized Equip screen into a premium D&D double-page character codex. Syncs variables 121-132.
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help ItemSystemEquipment.js
 *
 * Business-logic layer. Must be listed before ItemSystemEquipmentUI.js.
 * Exposes window.EquipI18n and window.EquipParams for the UI layer.
 *
 * Armor Type Stats:
 * - Clothes (Type 1): Substance 100%, Stealth 100%
 * - Robe (Type 2): Arcane 100%
 * - Light Armor (Type 3): Stealth 100%
 * - Heavy Armor (Type 4): Intimidation 100%
 *
 * Weapon Type Stats:
 * - Dagger (Type 1): Stealth 100%
 * - Sword (Type 2): Intimidation 100%
 * - Heavy (Type 3): Intimidation 100%
 * - Axe (Type 4): Intimidation 100%
 * - Whip (Type 5): Substance 100%
 * - Staff (Type 6): Arcane 100%
 * - Bow (Type 7): Stealth 100%
 * - Projectile (Type 8): Substance 100%
 * - Gun (Type 9): Substance 100%
 * - Claw (Type 10): Intimidation 100%
 *
 * Weapon Proficiency:
 * - Any class can equip any weapon type. How well it is wielded comes from the
 *   matching "Weapons" specialization (js/db/Skills/Specialization.json), which
 *   starts at Intermediate (level 3) for the weapon types the class used to be
 *   limited to and Untrained for the rest.
 * - Weapon parameters are scaled by proficiency level:
 *   Untrained 33%, Beginner 67%, Intermediate 100%, Advanced 110%, Master 125%.
 * - Winning a battle grants 1 proficiency point per equipped weapon type, so an
 *   untrained weapon carried long enough catches up.
 *
 * Weapon Scaling (shown when weapon slot selected):
 * - No attack skill: STR scaling
 * - Attack skill 840: DEX scaling
 * - Attack skill 841: MIX scaling
 * - Attack skill 842: PSI scaling
 * - Attack skill 843: INT scaling
 * - Attack skill 844: CON scaling
 * - Attack skill 845: WIS scaling
 *
 * @param enableSwitching
 * @text Enable Character Switching
 * @desc Enable switching characters with Left/Right keys in equip menu
 * @type boolean
 * @default true
 *
 * @param switchSound
 * @text Switch Sound Effect
 * @desc Play sound when switching characters
 * @type boolean
 * @default true
 */

(() => {
    'use strict';

    const pluginName = 'ItemSystemEquipment';
    const parameters = PluginManager.parameters(pluginName);

    // Copy lives in js/i18n/<lang>/plugins/Equip.json. The i18n[lang][key]
    // shape is kept so the UI's `i18n[lang] || i18n['en']` call sites and
    // window.EquipI18n consumers are unchanged.
    const equipText = new Proxy({}, {
        get: (_, key) => T('Equip.' + String(key))
    });
    const i18n = new Proxy({}, { get: () => equipText });

    // =============================================================================
    // Core Actor Custom Stats Engine (Variable Persistency Sync)
    // =============================================================================

    Game_Actor.prototype.calculateCustomStats = function () {
        const equips = this.equips();
        const statContributions = { arcane: 0, substance: 0, stealth: 0, intimidation: 0 };
        let totalRelevantPieces = 0;

        for (let i = 0; i < equips.length; i++) {
            const item = equips[i];
            if (!item) continue;

            if (DataManager.isWeapon(item)) {
                totalRelevantPieces++;
                switch (item.wtypeId) {
                    case 1: statContributions.stealth++;       break; // Dagger
                    case 2: statContributions.intimidation++;  break; // Sword
                    case 3: statContributions.intimidation++;  break; // Heavy
                    case 4: statContributions.intimidation++;  break; // Axe
                    case 5: statContributions.substance++;     break; // Whip
                    case 6: statContributions.arcane++;        break; // Staff
                    case 7: statContributions.stealth++;       break; // Bow
                    case 8: statContributions.substance++;     break; // Projectile
                    case 9: statContributions.substance++;     break; // Gun
                    case 10: statContributions.intimidation++; break; // Claw
                }
            } else if (DataManager.isArmor(item)) {
                const atypeId = item.atypeId;
                if (atypeId >= 1 && atypeId <= 4) {
                    totalRelevantPieces++;
                    switch (atypeId) {
                        case 1: statContributions.substance++; statContributions.stealth++; break; // Clothes
                        case 2: statContributions.arcane++;        break; // Robe
                        case 3: statContributions.stealth++;       break; // Light Armor
                        case 4: statContributions.intimidation++;  break; // Heavy Armor
                    }
                }
            }
        }

        const stats = { arcane: 0, substance: 0, stealth: 0, intimidation: 0 };
        if (totalRelevantPieces > 0) {
            stats.arcane       = Math.round((statContributions.arcane       / totalRelevantPieces) * 100);
            stats.substance    = Math.round((statContributions.substance    / totalRelevantPieces) * 100);
            stats.stealth      = Math.round((statContributions.stealth      / totalRelevantPieces) * 100);
            stats.intimidation = Math.round((statContributions.intimidation / totalRelevantPieces) * 100);
        }
        return stats;
    };

    Game_Actor.prototype.saveCustomStatsToVariables = function () {
        const stats   = this.calculateCustomStats();
        const actorId = this.actorId();
        if (actorId === 1) {
            $gameActors.actor(1).setPvArcane(stats.arcane);
            $gameActors.actor(1).setPvSubstance(stats.substance);
            $gameActors.actor(1).setPvStealth(stats.stealth);
            $gameActors.actor(1).setPvIntimidation(stats.intimidation);
        } else if (actorId === 2) {
            $gameActors.actor(2).setPvArcane(stats.arcane);
            $gameActors.actor(2).setPvSubstance(stats.substance);
            $gameActors.actor(2).setPvStealth(stats.stealth);
            $gameActors.actor(2).setPvIntimidation(stats.intimidation);
        } else if (actorId === 3) {
            $gameActors.actor(3).setPvArcane(stats.arcane);
            $gameActors.actor(3).setPvSubstance(stats.substance);
            // Actor 3's last two stats used to be dumped into Variables 131 and
            // 132, left over from before the pv* actor fields existed. 131 is
            // the police heat (CrimeSystem), so every equip change re-wrote the
            // party's wanted level to actor 3's stealth percentage and the
            // police were after a party that had never committed a crime.
            $gameActors.actor(3).setPvStealth(stats.stealth);
            $gameActors.actor(3).setPvIntimidation(stats.intimidation);
        }
    };

    const _Game_Actor_changeEquip = Game_Actor.prototype.changeEquip;
    Game_Actor.prototype.changeEquip = function (slotId, item) {
        if (!this._equips) this._equips = [];
        if (slotId >= 0) {
            while (this._equips.length <= slotId) this._equips.push(new Game_Item());
        }
        _Game_Actor_changeEquip.call(this, slotId, item);
        this.saveCustomStatsToVariables();
    };

    const _Game_Actor_forceChangeEquip = Game_Actor.prototype.forceChangeEquip;
    Game_Actor.prototype.forceChangeEquip = function (slotId, item) {
        if (!this._equips) this._equips = [];
        if (slotId >= 0) {
            while (this._equips.length <= slotId) this._equips.push(new Game_Item());
        }
        _Game_Actor_forceChangeEquip.call(this, slotId, item);
        this.saveCustomStatsToVariables();
    };

    Game_Actor.prototype.randomEquipments = function () {
        const maxSlots = this.equipSlots().length;
        this.clearEquipments();
        for (let i = 0; i < maxSlots; i++) {
            if (this.isEquipChangeOk(i)) this.changeEquip(i, this.randomEquipItem(i));
        }
    };

    Game_Actor.prototype.randomEquipItem = function (slotId) {
        const etypeId = this.equipSlots()[slotId];
        const itemList = etypeId === 1
            ? $gameParty.weapons().filter(w => this.canEquip(w))
            : $gameParty.armors().filter(a => a.etypeId === etypeId && this.canEquip(a));
        if (itemList.length === 0) return null;
        return itemList[Math.floor(Math.random() * itemList.length)];
    };

    // =============================================================================
    // Weapon proficiency
    // =============================================================================
    //
    // Classes no longer gate which weapons can be picked up: anyone may equip
    // anything. What a class knows is expressed as a specialization level in the
    // "Weapons" category of js/db/Skills/Specialization.json (one entry per
    // weapon type, tagged with its wtypeId). A class starts at Intermediate
    // (level 3) in the weapon types it used to be restricted to, Untrained in
    // the rest.
    //
    // Below Intermediate a weapon fights at a fraction of its listed stats; at
    // Intermediate it applies in full; above it gains a small bonus. Winning
    // battles with a weapon equipped trains its proficiency, so an untrained
    // weapon carried long enough eventually performs normally.

    const PROFICIENT_LEVEL = 3;
    const LEVEL_MULTIPLIER = [1, 1 / 3, 2 / 3, 1, 1.1, 1.25]; // indexed by level
    const BATTLE_EXP = 1;

    const WeaponProficiency = {
        PROFICIENT_LEVEL,

        // wtypeId is the cheap weapon test: DataManager.isWeapon scans the whole
        // weapon database, and this runs inside paramPlus.
        specFor(weapon) {
            if (!weapon || !weapon.wtypeId) return null;
            const db = window.Specializations;
            return db && db.ready ? db.forWtype(weapon.wtypeId) : null;
        },

        // Anything without proficiency data (Specialization.json still loading,
        // or a weapon type with no specialization) counts as proficient, so
        // nothing is ever penalised for missing data.
        levelFor(actor, weapon) {
            const spec = this.specFor(weapon);
            if (!spec || !actor || !actor.specializationLevel) return PROFICIENT_LEVEL;
            return actor.specializationLevel(spec.id);
        },

        multiplierForLevel(level) {
            const clamped = Math.max(1, Math.min(LEVEL_MULTIPLIER.length - 1, level));
            return LEVEL_MULTIPLIER[clamped];
        },

        multiplier(actor, weapon) {
            return this.multiplierForLevel(this.levelFor(actor, weapon));
        },

        isUntrained(actor, weapon) {
            return this.levelFor(actor, weapon) < PROFICIENT_LEVEL;
        },

        levelNameFor(actor, weapon) {
            const db = window.Specializations;
            if (!db || !db.ready) return '';
            return db.levelName(this.levelFor(actor, weapon));
        },

        // One point per battle won for each distinct weapon type carried.
        rewardBattle() {
            if (!$gameParty || !window.Specializations || !window.Specializations.ready) return;
            $gameParty.battleMembers().forEach(actor => {
                if (!actor || !actor.isAlive() || !actor.gainSpecializationExp) return;
                const trained = [];
                actor.equips().forEach(item => {
                    const spec = this.specFor(item);
                    if (!spec || trained.includes(spec.id)) return;
                    trained.push(spec.id);
                    // Through the shared award service, so the toast matches
                    // the rest of the game. `soloist` is the point here: only
                    // the hand that swung the weapon learns it, no share to
                    // the party members who merely watched it happen.
                    if (window.SpecializationXP) {
                        window.SpecializationXP.award(spec, BATTLE_EXP, { actor, soloist: true });
                    } else {
                        actor.gainSpecializationExp(spec.id, BATTLE_EXP);
                    }
                });
            });
        }
    };

    // Any class may equip any weapon type; proficiency handles the rest.
    Game_BattlerBase.prototype.isEquipWtypeOk = function (/* wtypeId */) {
        return true;
    };

    // Scale an equipped weapon's parameters by its wielder's proficiency. Applied
    // as a delta on top of the stock paramPlus sum so it stacks cleanly with the
    // other paramPlus wrappers (item modifiers, diseases).
    Game_Actor.prototype.weaponProficiencyParamDelta = function (paramId) {
        let delta = 0;
        const equips = this.equips();
        for (let i = 0; i < equips.length; i++) {
            const item = equips[i];
            if (!item || !item.wtypeId || !item.params) continue;
            const base = item.params[paramId] || 0;
            if (!base) continue;
            const mult = WeaponProficiency.multiplier(this, item);
            if (mult !== 1) delta += Math.round(base * mult) - base;
        }
        return delta;
    };

    const _Game_Actor_paramPlus_proficiency = Game_Actor.prototype.paramPlus;
    Game_Actor.prototype.paramPlus = function (paramId) {
        return _Game_Actor_paramPlus_proficiency.call(this, paramId) + this.weaponProficiencyParamDelta(paramId);
    };

    // "Optimize" scores candidates by raw parameters, which would happily hand a
    // character a powerful weapon they cannot use. Score weapons by what they
    // would actually deliver in that character's hands instead.
    const _Game_Actor_calcEquipItemPerformance = Game_Actor.prototype.calcEquipItemPerformance;
    Game_Actor.prototype.calcEquipItemPerformance = function (item) {
        const performance = _Game_Actor_calcEquipItemPerformance.call(this, item);
        if (!item || !item.wtypeId) return performance;
        return Math.round(performance * WeaponProficiency.multiplier(this, item));
    };

    // Scoring alone is not enough: a legendary weapon the character is untrained
    // with can still outscore every trained one they own. "Optimize" therefore
    // ignores weapons below Intermediate outright, and only falls back to the
    // untrained pool when the character owns nothing they are proficient with.
    // "Random" is deliberately left alone, it may still pick anything.
    const _Game_Actor_bestEquipItem = Game_Actor.prototype.bestEquipItem;
    Game_Actor.prototype.bestEquipItem = function (slotId) {
        const etypeId = this.equipSlots()[slotId];
        if (etypeId !== 1) return _Game_Actor_bestEquipItem.call(this, slotId);

        const items = $gameParty.equipItems()
            .filter(item => item.etypeId === etypeId && this.canEquip(item));
        const trained = items.filter(item => !WeaponProficiency.isUntrained(this, item));
        const pool = trained.length > 0 ? trained : items;

        let bestItem = null;
        let bestPerformance = -1000;
        for (const item of pool) {
            const performance = this.calcEquipItemPerformance(item);
            if (performance > bestPerformance) {
                bestPerformance = performance;
                bestItem = item;
            }
        }
        return bestItem;
    };

    const _BattleManager_processVictory_proficiency = BattleManager.processVictory;
    BattleManager.processVictory = function () {
        WeaponProficiency.rewardBattle();
        _BattleManager_processVictory_proficiency.call(this);
    };

    Game_Actor.prototype.getWeaponScalingType = function (weapon) {
        if (!weapon || !DataManager.isWeapon(weapon)) return null;
        const attackSkills = weapon.traits.filter(t => t.code === 35);
        if (attackSkills.length === 0) return 'STR';
        for (const skill of attackSkills) {
            switch (skill.dataId) {
                case 840: return 'DEX';
                case 841: return 'MIX';
                case 842: return 'PSI';
                case 843: return 'INT';
                case 844: return 'CON';
                case 845: return 'WIS';
            }
        }
        return null;
    };

    // Expose to UI layer
    window.WeaponProficiency = WeaponProficiency;
    window.EquipI18n   = i18n;
    window.EquipParams = {
        enableSwitching: parameters['enableSwitching'] === 'true',
        switchSound:     parameters['switchSound'] === 'true'
    };
})();
