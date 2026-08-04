//=============================================================================
// Stealing System Plugin
// Version: 1.0.1
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Advanced stealing system that scans shop events and calculates steal chances
 * @author Omni-Lex
 *
 * @command openStealWindow
 * @text Open Steal Window
 * @desc Opens the stealing window to steal from nearby shops
 *
 * @help
 * This plugin creates a stealing system for RPG Maker MZ.
 *
 * Features:
 * - Scans current map for shop events
 * - Calculates steal percentage based on player agility, item value, and weight
 * - Shows stealable items with success percentages
 * - Handles steal attempts and stores results
 * - Italian translation support
 * - Compatible with RandomDailyShop plugin: automatically generates daily item lists
 *   for events within 5 tiles using the RandomDailyShop OpenDailyShop command
 *
 * Item Note Tags:
 * <Weight: X> - Sets item weight in grams (e.g., <Weight: 500>)
 *
 * Plugin Command:
 * openStealWindow - Opens the stealing interface
 *
 * The system will:
 * - Store stolen item value in Variable 79
 * - Call Common Event 125 only when a steal attempt fails (caught)
 *
 * Proximity Rules:
 * - Standard shops (Shop Processing command): Scanned entire map
 * - RandomDailyShop merchants: Only scanned if within 5 tiles of player
 *
 * RandomDailyShop Integration:
 * If an event uses the RandomDailyShop plugin command (OpenDailyShop) and is within
 * 5 tiles of the player, the stealing system will automatically detect it and generate
 * the daily random items for that event's location based on coordinates and current date.
 * This allows stealing from dynamic shop inventory at nearby locations.
 */

(() => {
    const pluginName = "StealingSystem";

    //=============================================================================
    // Translation System
    //=============================================================================
    

    // Kept as an accessor so every call site (SS().translate('stealTitle'))
    // stays as it was; the copy is in js/i18n/<lang>/plugins/Steal.json.
    function translate(key) {
        const full = 'Steal.' + String(key || '');
        return T.has(full) ? T(full) : key;
    }

    function goldToEuros(gold) {
        // 100 gold = 1 euro
        const euros = gold / 100;
        return `€${euros.toFixed(2)}`;
    }

    PluginManager.registerCommand(pluginName, "openStealWindow", args => {
        if (window.Scene_Steal) SceneManager.push(window.Scene_Steal);
    });

    //=============================================================================
    // DataManager - Extract item weight from notes
    //=============================================================================
    
    DataManager.getItemWeight = function(item) {
        if (!item || !item.note) return 100; // Default weight
        const match = item.note.match(/<Weight:\s*(\d+)>/i);
        return match ? parseInt(match[1]) : 100;
    };

    //=============================================================================
    // Game_System - Store shop data
    //=============================================================================
    
    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _Game_System_initialize.call(this);
        this._lastStealValue = 0;
    };

    //=============================================================================
    // Steal Calculator
    //=============================================================================
    
    class StealCalculator {
        static calculateStealChance(item, agility) {
            const baseChance = 50;
            const agilityBonus = agility * 0.5; // 0.5% per point of agility
            const value = item.price || 0;
            const weight = DataManager.getItemWeight(item);
            
            // Penalties
            const valuePenalty = Math.min(value / 100, 30); // Max 30% penalty
            const weightPenalty = Math.min(weight / 100, 30); // Max 30% penalty
            
            // Practised hands (Pickpocketing, specialization 203). Four points
            // a tier, inside the same clamp, so it never becomes a certainty.
            const trained = window.SpecializationXP
                ? (window.SpecializationXP.partyLevel('Pickpocketing') - 1) * 4 : 0;

            let chance = baseChance + agilityBonus + trained - valuePenalty - weightPenalty;

            // Clamp between 5% and 95%
            return Math.max(5, Math.min(95, Math.floor(chance)));
        }

        static performSteal(chance) {
            // Every attempt teaches, caught or not. Losing the item is already
            // punishment enough without also learning nothing from it.
            if (window.SpecializationXP) {
                window.SpecializationXP.awardCapped('Pickpocketing', 1, { soloist: true });
            }
            return Math.random() * 100 < chance;
        }
    }

    //=============================================================================
    // Shop Scanner - Finds shops on current map
    //=============================================================================
    
    class ShopScanner {
        static DAILY_SHOP_PROXIMITY = 5; // Tiles

        static DAILY_SHOP_COMMANDS = {
            'OpenDailyShop':       'getRandomDailyShopItems',
            'randomDailyTavern':   'getRandomDailyTavernItems',
            'openDailyArmor':      'getRandomDailyArmorItems',
            'openDailyWeapon':     'getRandomDailyWeaponItems',
            'openDailyPharmacy':   'getRandomDailyPharmacyItems',
            'openDailyMagicShop':  'getRandomDailyMagicItems',
            'openDailyLuxury':     'getRandomDailyLuxuryItems',
            'openDailyAdventurer': 'getRandomDailyAdventurerItems',
            'openDailyLibrary':    'getRandomLibraryItems',
            'openDailyTools':      'getRandomDailyToolsItems',
            'openDailyAlchemistry':'getRandomDailyAlchemistryItems',
        };

        static scanMapForShops() {
            const items = [];
            const events = $gameMap.events();
            const playerX = $gamePlayer.x;
            const playerY = $gamePlayer.y;

            for (const event of events) {
                if (!event) continue;
                const shopItems = this.extractShopItems(event, playerX, playerY);
                items.push(...shopItems);
            }

            // Remove duplicates
            const uniqueItems = [];
            const seen = new Set();

            for (const item of items) {
                const key = `${item.type}_${item.id}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueItems.push(item);
                }
            }

            return uniqueItems;
        }

        static isWithinProximity(eventX, eventY, playerX, playerY, distance) {
            // Manhattan distance
            const dist = Math.abs(eventX - playerX) + Math.abs(eventY - playerY);
            return dist <= distance;
        }

        static extractShopItems(event, playerX, playerY) {
            const items = [];
            const pages = event.event().pages;
            let hasStandardShop = false;
            let dailyShopCommand = null; // stores matched RandomDailyShop command name

            // First pass: check what types of shops this event has
            for (const page of pages) {
                const list = page.list;
                for (const command of list) {
                    if (command.code === 302) {
                        hasStandardShop = true;
                    }
                    if (command.code === 357) {
                        const params = command.parameters;
                        if (params && params[0] === 'RandomDailyShop' && this.DAILY_SHOP_COMMANDS[params[1]]) {
                            dailyShopCommand = params[1];
                        }
                    }
                }
            }

            // Daily shops are only scanned when player is within proximity
            if (dailyShopCommand && !this.isWithinProximity(event.x, event.y, playerX, playerY, this.DAILY_SHOP_PROXIMITY)) {
                dailyShopCommand = null;
            }

            const sourceMapId = $gameMap.mapId();
            const sourceEventId = event.eventId();

            // Second pass: extract items
            for (const page of pages) {
                const list = page.list;
                for (let i = 0; i < list.length; i++) {
                    const command = list[i];

                    // Command 302: standard Shop Processing ,  scan entire map
                    if (command.code === 302) {
                        const firstGoods = command.parameters;
                        if (firstGoods && firstGoods.length >= 2) {
                            const type = firstGoods[0];
                            const id = firstGoods[1];
                            let itemData = null;
                            let itemType = '';

                            if (type === 0 && id > 0) {
                                itemData = $dataItems[id];
                                itemType = 'item';
                            } else if (type === 1 && id > 0) {
                                itemData = $dataWeapons[id];
                                itemType = 'weapon';
                            } else if (type === 2 && id > 0) {
                                itemData = $dataArmors[id];
                                itemType = 'armor';
                            }

                            if (itemData) {
                                items.push({ type: itemType, id, data: itemData, sourceMapId, sourceEventId });
                            }
                        }

                        let j = i + 1;
                        while (j < list.length && list[j].code === 605) {
                            const goods = list[j].parameters;
                            if (goods && goods.length >= 2) {
                                const type = goods[0];
                                const id = goods[1];
                                let itemData = null;
                                let itemType = '';

                                if (type === 0 && id > 0) {
                                    itemData = $dataItems[id];
                                    itemType = 'item';
                                } else if (type === 1 && id > 0) {
                                    itemData = $dataWeapons[id];
                                    itemType = 'weapon';
                                } else if (type === 2 && id > 0) {
                                    itemData = $dataArmors[id];
                                    itemType = 'armor';
                                }

                                if (itemData) {
                                    items.push({ type: itemType, id, data: itemData, sourceMapId, sourceEventId });
                                }
                            }
                            j++;
                        }
                    }

                    // Command 357: RandomDailyShop plugin command ,  only when within proximity
                    if (command.code === 357 && dailyShopCommand) {
                        const params = command.parameters;
                        if (params && params[0] === 'RandomDailyShop' && params[1] === dailyShopCommand) {
                            const dailyItems = this.getDailyShopItems(event, dailyShopCommand);
                            for (const di of dailyItems) {
                                di.sourceMapId = sourceMapId;
                                di.sourceEventId = sourceEventId;
                            }
                            items.push(...dailyItems);
                        }
                    }
                }
            }

            // Fallback: If no shop items found, and the event is the currently active interpreter event (e.g. NPC Pickpocketing)
            if (items.length === 0 && event.eventId() === $gameMap._interpreter.eventId()) {
                const npcItems = this.generateNPCItems(event);
                items.push(...npcItems);
            }

            return items;
        }

        static generateNPCItems(event) {
            const items = [];
            try {
                const mapId = $gameMap.mapId();
                const x = event.x;
                const y = event.y;
                const eventId = event.eventId();
                
                // Use Variable 113 to seed the daily generation consistently
                const dateKey = $gameVariables.value(113) || new Date().toDateString();
                const seedStr = `${mapId}_${eventId}_${x}_${y}_${dateKey}`;
                let seed = 0;
                for (let i = 0; i < seedStr.length; i++) {
                    seed = (seed * 31 + seedStr.charCodeAt(i)) & 0x7fffffff;
                }
                
                const seededRandom = () => {
                    seed = (seed * 9301 + 49297) % 233280;
                    return seed / 233280;
                };

                // Gather low/medium value items
                const validItems = [];
                if (typeof $dataItems !== 'undefined') {
                    for (let i = 1; i < $dataItems.length; i++) {
                        const item = $dataItems[i];
                        if (item && item.name && !item.name.startsWith("---") && item.price > 0 && item.price <= 5000) {
                            validItems.push({ type: 'item', id: i, data: item });
                        }
                    }
                }
                if (typeof $dataWeapons !== 'undefined') {
                    for (let i = 1; i < $dataWeapons.length; i++) {
                        const weapon = $dataWeapons[i];
                        if (weapon && weapon.name && !weapon.name.startsWith("---") && weapon.price > 0 && weapon.price <= 5000) {
                            validItems.push({ type: 'weapon', id: i, data: weapon });
                        }
                    }
                }
                if (typeof $dataArmors !== 'undefined') {
                    for (let i = 1; i < $dataArmors.length; i++) {
                        const armor = $dataArmors[i];
                        if (armor && armor.name && !armor.name.startsWith("---") && armor.price > 0 && armor.price <= 5000) {
                            validItems.push({ type: 'armor', id: i, data: armor });
                        }
                    }
                }

                if (validItems.length > 0) {
                    const numItems = Math.floor(seededRandom() * 3) + 1; // 1 to 3 items
                    const sourceMapId = mapId;
                    const sourceEventId = eventId;
                    
                    for (let k = 0; k < numItems; k++) {
                        const idx = Math.floor(seededRandom() * validItems.length);
                        const selected = validItems[idx];
                        items.push({
                            type: selected.type,
                            id: selected.id,
                            data: selected.data,
                            sourceMapId,
                            sourceEventId
                        });
                    }
                }
            } catch (e) {
                console.error("StealingSystem: Error generating NPC items:", e);
            }
            return items;
        }

        static getDailyShopItems(event, commandName = 'OpenDailyShop') {
            const items = [];

            const getterName = this.DAILY_SHOP_COMMANDS[commandName] || 'getRandomDailyShopItems';
            if (!window[getterName]) {
                console.warn(`StealingSystem: ${getterName} not found for RandomDailyShop command '${commandName}'.`);
                return items;
            }

            try {
                const mapId = $gameMap.mapId();
                const x = event.x;
                const y = event.y;

                const dailyShopItems = window[getterName](mapId, x, y);

                // Convert items to stealing system format
                if (dailyShopItems && Array.isArray(dailyShopItems)) {
                    for (const item of dailyShopItems) {
                        if (item && item.name) {
                            let itemType = '';

                            if (DataManager.isItem(item)) {
                                itemType = 'item';
                            } else if (DataManager.isWeapon(item)) {
                                itemType = 'weapon';
                            } else if (DataManager.isArmor(item)) {
                                itemType = 'armor';
                            }

                            if (itemType) {
                                items.push({
                                    type: itemType,
                                    id: item.id,
                                    data: item
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("StealingSystem: Error generating daily shop items:", e);
            }

            return items;
        }
    }


    // Public API consumed by StealingSystemUI.js
    window.StealingSystem = {
        scanItems:    () => ShopScanner.scanMapForShops(),
        calcChance:   (item, agi) => StealCalculator.calculateStealChance(item, agi),
        performSteal: (chance) => StealCalculator.performSteal(chance),
        fmt:          goldToEuros,
        translate,
        reduceStock: (entry) => {
            if (!entry.sourceMapId || !entry.sourceEventId || !$gameSystem._shopStocks) return;
            const mapStocks = $gameSystem._shopStocks[entry.sourceMapId];
            if (!mapStocks) return;
            const shopData = mapStocks[entry.sourceEventId];
            if (!shopData) return;
            const d = entry.data;
            let key = '';
            if (DataManager.isItem(d))        key = 'i_' + d.id;
            else if (DataManager.isWeapon(d)) key = 'w_' + d.id;
            else if (DataManager.isArmor(d))  key = 'a_' + d.id;
            if (key && shopData[key] !== undefined) shopData[key] = Math.max(0, shopData[key] - 1);
        },
    };
    window.StealCalculator = StealCalculator;
    window.ShopScanner = ShopScanner;
})();