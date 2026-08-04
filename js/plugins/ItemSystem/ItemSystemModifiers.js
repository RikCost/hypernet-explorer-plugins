/*:
 * @target MZ
 * @plugindesc v1.0.0 Item System Modifiers - Adds modifiers to weapons and armors
 * @author Omni-Lex
 * @help ItemSystemModifiers.js
 *
 * This plugin handles modifiers for weapons and armors.
 * It reads the modifier from the item's note tag: <modifier: Name>
 *
 * Supported Modifiers:
 * - Sharp: Increases STR, increases price. (Weapon only)
 * - Refined: Increases CON and WIS, increases price. (Both)
 * - Poisoned: Adds poison trait, changes price. (Weapon only)
 * - Worn: Decreases CON and WIS, decreases price. (Armor only)
 *
 * Modifiers can change:
 * - Params (stat bonuses)
 * - Price (multiplier)
 * - Traits (status effects, etc.)
 */

(function() {
    "use strict";

    // i18n-ignore-start  the key is the <modifier:> note-tag value; the
    // `name` below is shadowed by the getter that follows
    // i18n-ignore-start  the key is the <modifier:> note-tag value; the
    // `name` below is shadowed by the getter that follows
    const Modifiers = {
        // --- Weapon Modifiers ---
        'Sharp': {
            name: 'Sharp',
            params: [0, 0, 15, 0, 0, 0, 0, 0], // +15 STR
            priceRate: 1.5,
            traits: [],
            exclusive: 'weapon'
        },
        'Venomous': {
            name: 'Venomous',
            params: [0, 0, 5, 0, 0, 0, 0, 0], // +5 STR
            priceRate: 1.3,
            traits: [
                { code: 13, dataId: 4, value: 1.0 } // Attack State: Poison (100%)
            ],
            exclusive: 'weapon'
        },
        'Blinding': {
            name: 'Blinding',
            params: [0, 0, 5, 0, 0, 0, 0, 0], // +5 STR
            priceRate: 1.3,
            traits: [
                { code: 13, dataId: 5, value: 0.5 } // Attack State: Blind (50%)
            ],
            exclusive: 'weapon'
        },
        'Chilling': {
            name: 'Chilling',
            params: [0, 0, 5, 0, 0, 0, 0, 0], // +5 STR
            priceRate: 1.4,
            traits: [
                { code: 13, dataId: 11, value: 0.3 } // Attack State: Freeze (30%)
            ],
            exclusive: 'weapon'
        },
        'Stunning': {
            name: 'Stunning',
            params: [0, 0, 5, 0, 0, 0, 0, 0], // +5 STR
            priceRate: 1.4,
            traits: [
                { code: 13, dataId: 13, value: 0.3 } // Attack State: Stun (30%)
            ],
            exclusive: 'weapon'
        },
        'Vampiric': {
            name: 'Vampiric',
            params: [0, 0, 5, 0, 0, 0, 0, 0], // +5 STR
            priceRate: 1.6,
            traits: [
                { code: 22, dataId: 7, value: 0.05 } // HRG +5%
            ],
            exclusive: 'weapon'
        },
        'Focusing': {
            name: 'Focusing',
            params: [0, 0, 5, 0, 0, 0, 0, 0], // +5 STR
            priceRate: 1.4,
            traits: [
                { code: 22, dataId: 2, value: 0.20 } // CRI +20%
            ],
            exclusive: 'weapon'
        },
        'Berserk': {
            name: 'Berserk',
            params: [0, 0, 30, -15, 0, 0, 0, 0], // +30 STR, -15 CON
            priceRate: 1.5,
            traits: [
                { code: 21, dataId: 2, value: 1.5 }, // ATK rate 150%
                { code: 21, dataId: 3, value: 0.7 }  // DEF rate 70%
            ],
            exclusive: 'weapon'
        },

        // --- Weapon Conditions (as Modifiers) ---
        'Perfect': { name: 'Perfect', params: [0, 0, 10, 0, 0, 0, 0, 0], priceRate: 1.2, exclusive: 'weapon' },
        'Dull': { name: 'Dull', params: [0, 0, -5, 0, 0, 0, 0, 0], priceRate: 0.8, exclusive: 'weapon' },
        'Chipped': { name: 'Chipped', params: [0, 0, -10, 0, 0, 0, 0, 0], priceRate: 0.6, exclusive: 'weapon' },
        'Broken': { name: 'Broken', params: [0, 0, -20, 0, 0, 0, 0, 0], priceRate: 0.2, exclusive: 'weapon' },

        // --- Armor Modifiers ---
        'Refined': {
            name: 'Refined',
            params: [0, 0, 0, 10, 0, 10, 0, 0], // +10 CON, +10 WIS
            priceRate: 1.3,
            traits: [],
            exclusive: 'both'
        },
        'Worn': {
            name: 'Worn',
            params: [0, 0, 0, -5, 0, -5, 0, 0], // -5 CON, -5 WIS
            priceRate: 0.7, // 30% discount
            traits: [],
            exclusive: 'armor'
        },
        'Regenerative': {
            name: 'Regenerative',
            params: [0, 0, 0, 5, 0, 0, 0, 0], // +5 CON
            priceRate: 1.5,
            traits: [
                { code: 22, dataId: 7, value: 0.05 } // HRG +5%
            ],
            exclusive: 'armor'
        },
        'Retaliating': {
            name: 'Retaliating',
            params: [0, 0, 0, 5, 0, 0, 0, 0], // +5 CON
            priceRate: 1.4,
            traits: [
                { code: 22, dataId: 6, value: 0.30 } // CNT +30%
            ],
            exclusive: 'armor'
        },
        'Insulated': {
            name: 'Insulated',
            params: [0, 0, 0, 5, 0, 5, 0, 0], // +5 CON, +5 WIS
            priceRate: 1.3,
            traits: [
                { code: 14, dataId: 11, value: 0 } // State Resistance: Freeze
            ],
            exclusive: 'armor'
        },
        'Antidote': {
            name: 'Antidote',
            params: [0, 0, 0, 5, 0, 5, 0, 0], // +5 CON, +5 WIS
            priceRate: 1.3,
            traits: [
                { code: 14, dataId: 4, value: 0 } // State Resistance: Poison
            ],
            exclusive: 'armor'
        },
        'Blessed': {
            name: 'Blessed',
            params: [0, 0, 0, 5, 0, 10, 0, 0], // +5 CON, +10 WIS
            priceRate: 1.8,
            traits: [
                { code: 11, dataId: 1, value: 0.8 } // Element Rate: Physical 80% (20% reduction)
            ],
            exclusive: 'armor'
        }
    };
    // i18n-ignore-end
    // The printed label resolves on read, keyed by the modifier id.
    Object.keys(Modifiers).forEach(id => Object.defineProperty(Modifiers[id], 'name', {
        get: () => T('ItemModifiers.' + id)
    }));
    // i18n-ignore-end
    // The printed label resolves on read, keyed by the modifier id.
    Object.keys(Modifiers).forEach(id => Object.defineProperty(Modifiers[id], 'name', {
        get: () => T('ItemModifiers.' + id)
    }));

    // Perf: item notes are static, so the parsed modifier (and the {traits}
    // wrapper pushed into traitObjects) is memoized per item object.
    const _modifierCache = new WeakMap();
    const _traitsWrapperCache = new WeakMap();

    window.ItemSystemModifiers = {
        getModifier: function(item) {
            if (!item || !item.note) return null;
            if (_modifierCache.has(item)) return _modifierCache.get(item);
            let result = null;
            const match = item.note.match(/<modifier:\s*(\w+)>/i);
            if (match) {
                const name = match[1];
                const modifier = Modifiers[name];
                if (modifier) {
                    // Check exclusivity
                    if (modifier.exclusive === 'weapon' && !DataManager.isWeapon(item)) {
                        result = null;
                    } else if (modifier.exclusive === 'armor' && !DataManager.isArmor(item)) {
                        result = null;
                    } else {
                        result = modifier;
                    }
                }
            }
            _modifierCache.set(item, result);
            return result;
        },

        isEquippedByParty: function(item) {
            if (!item || typeof $gameParty === 'undefined' || !$gameParty.members) return false;
            return $gameParty.members().some(actor =>
                actor && actor.equips && actor.equips().includes(item));
        },

        getModifiedParam: function(item, paramId) {
            const modifier = this.getModifier(item);
            let value = item.params[paramId];
            // Only fold the modifier bonus in when the item is not currently
            // equipped. For equipped items Game_Actor.paramPlus already adds the
            // modifier params to the actor, so adding it here too would
            // double-count in any actor-total UI path.
            if (modifier && modifier.params && !this.isEquippedByParty(item)) {
                value += modifier.params[paramId] || 0;
            }
            return value;
        },

        getModifiedPrice: function(item) {
            const modifier = this.getModifier(item);
            let price = item.price;
            if (modifier && modifier.priceRate) {
                price = Math.floor(price * modifier.priceRate);
            }
            return price;
        },

        getModifiedTraits: function(item) {
            const modifier = this.getModifier(item);
            let traits = [...(item.traits || [])];
            if (modifier && modifier.traits) {
                traits = traits.concat(modifier.traits);
            }
            return traits;
        }
    };



    // Apply modifiers to actor stats when equipped
    const _Game_Actor_paramPlus = Game_Actor.prototype.paramPlus;
    Game_Actor.prototype.paramPlus = function(paramId) {
        let value = _Game_Actor_paramPlus.call(this, paramId);
        for (const item of this.equips()) {
            if (item) {
                const modifier = window.ItemSystemModifiers.getModifier(item);
                if (modifier && modifier.params) {
                    value += modifier.params[paramId] || 0;
                }
            }
        }
        return value;
    };

    // Apply modifiers to actor traits when equipped
    const _Game_Actor_traitObjects = Game_Actor.prototype.traitObjects;
    Game_Actor.prototype.traitObjects = function() {
        const objects = _Game_Actor_traitObjects.call(this);
        for (const item of this.equips()) {
            if (item) {
                const modifier = window.ItemSystemModifiers.getModifier(item);
                if (modifier && modifier.traits && modifier.traits.length > 0) {
                    // Reuse the dummy traits object (traits are static per item)
                    let wrapper = _traitsWrapperCache.get(item);
                    if (!wrapper) {
                        wrapper = { traits: modifier.traits };
                        _traitsWrapperCache.set(item, wrapper);
                    }
                    objects.push(wrapper);
                }
            }
        }
        return objects;
    };

})();
