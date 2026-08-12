/*:
 * @target MZ
 * @plugindesc Implements a cooking system that allows combining two recovery items for enhanced effects.
 * @author Omni-Lex
 * 
 * @param Play Recovery Sound
 * @type boolean
 * @desc Play recovery sound when cooking effect is applied
 * @default true
 * 
 * @param Recovery Sound
 * @type file
 * @dir audio/se/
 * @desc Sound effect to play when cooking effect is applied
 * @default Recovery
 * @parent Play Recovery Sound
 * 
 * @command openCookingMenu
 * @text Open Cooking Menu
 * @desc Opens the cooking menu where players can combine items
 * 
 * @command cookItems
 * @text Cook Items
 * @desc Combines two items from the player's inventory
 * @arg item1Id
 * @type number
 * @text First Item ID
 * @desc ID of the first item to combine
 * @arg item2Id
 * @type number
 * @text Second Item ID
 * @desc ID of the second item to combine
 * 
 * @help 
 * CookingSystem.js
 * 
 * This plugin implements a cooking system that allows players to combine
 * two recovery items (HP or MP) for enhanced effects. The first item's
 * recovery value is doubled, then the second item's recovery is added.
 * 
 * When cooking the same item with itself, a random adjective will be applied
 * with a bonus or penalty to the healing effect.
 * 
 * The cooked item name will be a combination of the first and second item names.
 * If an item has multiple words, it takes the first word of the first item and
 * the last word of the second item.
 * 
 * If two of the same item are used, the name will be "Random Adjective Item"
 * where the adjective determines if there's a bonus or penalty effect.
 * 
 * Plugin Commands:
 * - openCookingMenu: Opens the cooking menu interface
 * - cookItems: Directly combine specified items by their IDs
 * 
 * You can call these commands from event pages using the plugin command feature.
 */

(() => {
    'use strict';

    const pluginName = "CookingSystem";

    //=============================================================================
    // Plugin Parameters
    //=============================================================================
    const parameters = PluginManager.parameters(pluginName);
    const playRecoverySound = parameters['Play Recovery Sound'] === 'true';
    const recoverySoundName = parameters['Recovery Sound'] || 'Recovery';
    const requiredItemIds = [127, 128]; // Replace with your desired item IDs

    //=============================================================================
    // i18n
    //=============================================================================
    // Copy lives in js/i18n/<lang>/plugins/Cooking.json and is read through the
    // shared resolver, so there is no second loader and no boot race.
    // Resolve a dot-path under the Cooking namespace (e.g. 'ui.cookButton').
    const _ci18n = (path, vars) => {
        const key = 'Cooking.' + path;
        return T.has(key) ? T(key, vars) : path;
    };


    // Load on boot
    //=============================================================================
    // Plugin Commands
    //=============================================================================
    PluginManager.registerCommand(pluginName, "openCookingMenu", args => {
        SceneManager.push(Scene_Cooking);
    });

    PluginManager.registerCommand(pluginName, "cookItems", args => {
        const item1Id = Number(args.item1Id);
        const item2Id = Number(args.item2Id);

        const item1 = $dataItems[item1Id];
        const item2 = $dataItems[item2Id];

        if (item1 && item2 && $gameParty.hasItem(item1) && $gameParty.hasItem(item2)) {
            CookingSystem.cookItems(item1, item2);
        } else {
            console.error("CookingSystem: Invalid items or not enough items in inventory");
        }
    });

    //=============================================================================
    // CookingSystem
    //=============================================================================
    const CookingSystem = {
        _item1: null,
        _item2: null,

        isFoodItem: function (item) {
            if (!item) return false;
            return item && item.meta && item.meta.category === "Food";
        },

        getRecoveryValues: function (item) {
            let hunger = 0;
            let tp = 0;
            let mp = 0;

            if (!item || !item.meta) return { hunger, tp, mp };

            // Extract food stats from meta tags
            const calories = item.meta.calories ? parseInt(item.meta.calories) : 0;
            const protein = item.meta.protein ? parseInt(item.meta.protein) : 0;
            const fat = item.meta.fat ? parseInt(item.meta.fat) : 0;

            hunger = calories;
            tp = protein;
            mp = fat;

            return { hunger, tp, mp };
        },

        createCookedItemName: function (item1, item2) {
            const tr = (name) => (window.translateText ? window.translateText(name) : name);
            // If items are the same, use a random adjective
            if (item1 === item2) {
                return this.getRandomAdjectiveForSameItem(item1) + " " + tr(item1.name);
            }
            // Otherwise combine names as before

            const firstWord = tr(item1.name).split(' ')[0];
            const lastWord = tr(item2.name).split(' ').pop();
            return firstWord + " " + lastWord;
        },

        // Deterministic pseudo-random in [0,1) so the cook preview matches the
        // result actually applied by cookItems (no per-render re-roll).
        _seededRandom: function (seed) {
            const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
            return x - Math.floor(x);
        },

        getRandomAdjectiveForSameItem: function (item) {
            // Choose the adjective deterministically from the item id so the
            // preview render and cookItems() always agree.
            const seed = item && item.id ? item.id : 0;
            const rand = this._seededRandom(seed * 2 + 1);
            let adjectiveKey;

            if (rand < 0.35) {
                adjectiveKey = 'positive'; // 35% chance
                this._lastAdjectiveEffect = 'positive';
            } else if (rand < 0.75) {
                adjectiveKey = 'neutral';  // 40% chance
                this._lastAdjectiveEffect = 'neutral';
            } else {
                adjectiveKey = 'negative'; // 25% chance
                this._lastAdjectiveEffect = 'negative';
            }

            // Pull the adjective bank from the namespace. T.pool takes the
            // translated array whole, so a shorter one never mixes in English.
            const list = T.pool('Cooking.adjectives.' + adjectiveKey);

            if (list && list.length > 0) {
                return list[Math.floor(this._seededRandom(seed * 2 + 2) * list.length)];
            }

            // Fallback plain labels if JSON not loaded yet
            return adjectiveKey;
        },

        getMultiplierForSameItem: function () {
            // Use the last adjective effect to determine the multiplier
            if (this._lastAdjectiveEffect === "positive") {
                return 1.5; // 50% bonus
            } else if (this._lastAdjectiveEffect === "neutral") {
                return 0.75; // 25% penalty
            } else {
                return 0.25; // 75% penalty
            }
        },

        // Whoever the Cooking menu's party switcher currently has at the stove.
        // Called from a plugin command instead (no scene, no switcher), it is
        // the leader, which is what every award defaulted to before.
        activeCook: function () {
            const scene = SceneManager._scene;
            if (scene && typeof scene.cookActor === 'function') {
                const actor = scene.cookActor();
                if (actor) return actor;
            }
            return ($gameParty && $gameParty.leader) ? $gameParty.leader() : null;
        },

        cookItems: function (item1, item2) {

            // Remove items from inventory
            $gameParty.loseItem(item1, 1);
            $gameParty.loseItem(item2, 1);

            // Inventory changed: drop the active scene's cached food list.
            if (SceneManager._scene && SceneManager._scene.invalidateFoodList) {
                SceneManager._scene.invalidateFoodList();
            }

            // Get plugin parameters from TimeDateSystem
            const params = PluginManager.parameters('TimeDateSystem');
            const maxHunger = Number(params['maxHunger'] || 100);
            const overeatMaxHunger = Number(params['overeatMaxHunger'] || 150);
            const overeatStateId = Number(params['overeatStateId'] || 41);
            const calorieFactor = Number(params['calorieFactor'] || 0.10);
            const proteinFactor = Number(params['proteinFactor'] || 2.00);
            const fatFactor = Number(params['fatFactor'] || 1.50);

            // Calculate nutritional values (hunger = calories, tp = protein, mp = fat)
            const item1Nutrition = this.getRecoveryValues(item1);
            const item2Nutrition = this.getRecoveryValues(item2);

            // Check if same item is used twice
            const isSameItem = item1 === item2;
            let multiplier = 1.0;

            // Roll the cooked name first so getMultiplierForSameItem() reads the
            // freshly rolled adjective effect (createCookedItemName re-rolls
            // _lastAdjectiveEffect). Otherwise the applied multiplier would be
            // taken from a stale roll and disagree with the shown flavor text.
            const cookedName = this.createCookedItemName(item1, item2);

            // A meal made is a thing the party did (Diary.js). Written here so
            // the name is the one already rolled, never a second roll.
            if (window.Diary) window.Diary.onCrafted('cook', cookedName, 1);

            if (isSameItem) {
                // For same item, use random adjective effect multiplier
                multiplier = this.getMultiplierForSameItem();
            }

            // Double first item's nutrition and add second item's nutrition (with potential modifier)
            let totalCalories = item1Nutrition.hunger * 2;
            let totalProtein = item1Nutrition.tp * 2;
            let totalFat = item1Nutrition.mp * 2;

            if (isSameItem) {
                totalCalories += item2Nutrition.hunger * multiplier;
                totalProtein += item2Nutrition.tp * multiplier;
                totalFat += item2Nutrition.mp * multiplier;
            } else {
                totalCalories += item2Nutrition.hunger;
                totalProtein += item2Nutrition.tp;
                totalFat += item2Nutrition.mp;
            }

            // Calculate hunger recovery using the same formula as TimeDateSystem.
            // A cook who knows what they are doing wastes less of the same two
            // ingredients (Cooking, specialization 75). It is the member the
            // switcher has at the stove who is judged, not the party's best.
            const cook = this.activeCook();
            const cookSkill = window.SpecializationXP
                ? window.SpecializationXP.multiplierFor(cook, 'Cooking', 0.10) : 1;
            const totalHungerRecovery =
                ((totalCalories * calorieFactor) +
                 (totalProtein * proteinFactor) +
                 (totalFat * fatFactor)) * cookSkill;

            // Distribute recovery proportionally to each member's hunger deficit
            const { partySize, hungerPerMember } = this.distributeHungerToParty(totalHungerRecovery, maxHunger);

            // Show message with recovery amounts and flavor text for same-item cooking
            let recoverMsg = _ci18n('messages.prepared', { name: cookedName });

            // Add flavor text for same item cooking
            if (isSameItem) {
                if (this._lastAdjectiveEffect === 'positive') {
                    recoverMsg += _ci18n('messages.sameItemPositive');
                } else if (this._lastAdjectiveEffect === 'neutral') {
                    recoverMsg += _ci18n('messages.sameItemNeutral');
                } else {
                    recoverMsg += _ci18n('messages.sameItemNegative');
                }
            }

            // Convert hunger to percentage (per member, after split)
            const hungerPercent = Math.floor((hungerPerMember / maxHunger) * 100);

            if (hungerPercent > 0) {
                recoverMsg += _ci18n('messages.recoveredHunger', { percent: hungerPercent });
            }

            recoverMsg += _ci18n('messages.splitAmong', { count: partySize });
            // Everything a cooked dish did is reported through the shared
            // notification service: the dish itself, the Hunger it restored,
            // and the Cooking tier if this one pushed the cook over the line.
            if (window.ParchmentToast) {
                const gained = window.SpecializationXP
                    ? (window.SpecializationXP.award('Cooking', isSameItem ? 1 : 2,
                        { actor: cook, silent: true }) || [])
                    : [];
                window.ParchmentToast.group([
                    () => window.ParchmentToast.show(recoverMsg, {
                        severity: "info",
                        duration: 180,
                        icon: item1 ? item1.iconIndex : undefined
                    }),
                    ...(hungerPercent > 0
                        ? [() => window.ParchmentToast.need('hunger', hungerPercent)]
                        : []),
                    ...gained.map(g => () => window.SpecializationXP.announce(g))
                ]);
            }

            // Play recovery sound if enabled
            if (playRecoverySound) {
                AudioManager.playSe({
                    name: recoverySoundName,
                    pan: 0,
                    pitch: 100,
                    volume: 90
                });
            }

            // Clear selected items
            this._item1 = null;
            this._item2 = null;

            // Refresh the screen - corrected to use proper RPG Maker MZ method
            $gameMap.requestRefresh();

            // If we're in a scene with refreshStatus, call it
            if (SceneManager._scene && SceneManager._scene.refreshStatus) {
                SceneManager._scene.refreshStatus();
            }
        },

        // Distribute a total hunger recovery amount proportionally across the
        // party's hunger deficits. Returns { partySize, hungerPerMember }.
        distributeHungerToParty: function (totalHungerRecovery, maxHunger) {
            const members = $gameParty.members().filter(a => a);
            const partySize = members.length;
            members.forEach(a => { if (a._hunger === undefined) a._hunger = maxHunger; });

            const deficits = members.map(a => Math.max(0, maxHunger - a._hunger));
            const totalDeficit = deficits.reduce((s, d) => s + d, 0);

            let totalActualRecovery = 0;
            if (totalDeficit > 0) {
                const effectiveRecovery = Math.min(totalHungerRecovery, totalDeficit);
                members.forEach((actor, i) => {
                    const share = effectiveRecovery * (deficits[i] / totalDeficit);
                    actor._hunger = Math.min(maxHunger, actor._hunger + share);
                    totalActualRecovery += share;
                });
            }

            const hungerPerMember = partySize > 0 ? totalActualRecovery / partySize : 0;
            return { partySize, hungerPerMember };
        },

        // Eat a single raw ingredient, splitting its nutrition across the party.
        eatSingleItem: function (item) {
            if (!item || !$gameParty.hasItem(item)) {
                SoundManager.playBuzzer();
                return false;
            }

            // Remove one unit from inventory
            $gameParty.loseItem(item, 1);

            // Inventory changed: drop the active scene's cached food list.
            if (SceneManager._scene && SceneManager._scene.invalidateFoodList) {
                SceneManager._scene.invalidateFoodList();
            }

            // Get plugin parameters from TimeDateSystem
            const params = PluginManager.parameters('TimeDateSystem');
            const maxHunger = Number(params['maxHunger'] || 100);
            const calorieFactor = Number(params['calorieFactor'] || 0.10);
            const proteinFactor = Number(params['proteinFactor'] || 2.00);
            const fatFactor = Number(params['fatFactor'] || 1.50);

            const nutrition = this.getRecoveryValues(item);

            const totalHungerRecovery =
                (nutrition.hunger * calorieFactor) +
                (nutrition.tp * proteinFactor) +
                (nutrition.mp * fatFactor);

            const { partySize, hungerPerMember } = this.distributeHungerToParty(totalHungerRecovery, maxHunger);

            const itemName = window.translateText ? window.translateText(item.name) : item.name;
            let recoverMsg = _ci18n('messages.ate', { name: itemName });

            const hungerPercent = Math.floor((hungerPerMember / maxHunger) * 100);
            if (hungerPercent > 0) {
                recoverMsg += _ci18n('messages.recoveredHunger', { percent: hungerPercent });
            }
            recoverMsg += _ci18n('messages.splitAmong', { count: partySize });

            // Same pairing as a cooked dish: what was eaten, then what it did
            // to the party's Hunger.
            if (window.ParchmentToast) {
                window.ParchmentToast.group([
                    () => window.ParchmentToast.show(recoverMsg, {
                        severity: "info",
                        duration: 180,
                        icon: item ? item.iconIndex : undefined
                    }),
                    ...(hungerPercent > 0
                        ? [() => window.ParchmentToast.need('hunger', hungerPercent)]
                        : [])
                ]);
            }

            if (playRecoverySound) {
                AudioManager.playSe({
                    name: recoverySoundName,
                    pan: 0,
                    pitch: 100,
                    volume: 90
                });
            }

            $gameMap.requestRefresh();
            if (SceneManager._scene && SceneManager._scene.refreshStatus) {
                SceneManager._scene.refreshStatus();
            }
            return true;
        },

        getAvailableRecoveryItems: function () {
            return $gameParty.items().filter(item => this.isFoodItem(item));
        },

        setFirstItem: function (item) {
            this._item1 = item;
        },

        setSecondItem: function (item) {
            this._item2 = item;
        },

        clearSelectedItems: function () {
            this._item1 = null;
            this._item2 = null;
        },

        getFirstItem: function () {
            return this._item1;
        },

        getSecondItem: function () {
            return this._item2;
        }
    };

    window.CookingSystem = CookingSystem;

    //=============================================================================
    // Scene_Cooking
    //=============================================================================
    function Scene_Cooking() {
        this.initialize(...arguments);
    }

    Scene_Cooking.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_Cooking.prototype.constructor = Scene_Cooking;

    Scene_Cooking.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
        CookingSystem.clearSelectedItems();
    };

    // Who is at the stove. The party switcher in the header picks them, and it
    // is their Cooking that decides how much of the meal survives the pan.
    Scene_Cooking.prototype.cookMembers = function () {
        return ($gameParty && $gameParty.members) ? $gameParty.members() : [];
    };

    Scene_Cooking.prototype.cookActor = function () {
        const members = this.cookMembers();
        if (!members.length) return null;
        const idx = Math.max(0, Math.min(members.length - 1, this._cookActorIndex || 0));
        return members[idx];
    };

    Scene_Cooking.prototype.selectCookActor = function (index) {
        const members = this.cookMembers();
        if (!members.length) return;
        const next = ((index % members.length) + members.length) % members.length;
        if (next === this._cookActorIndex) return;
        this._cookActorIndex = next;
        SoundManager.playCursor();
        this.refreshUICooking();
    };

    Scene_Cooking.prototype.cycleCookActor = function (dir) {
        this.selectCookActor((this._cookActorIndex || 0) + dir);
    };

    Scene_Cooking.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);
        this._cookActorIndex = 0;
        // Name the skill this menu runs on, and whose hands are on it.
        if (window.SpecBadge) {
            window.SpecBadge.show('Cooking', { actor: this.cookActor() });  // i18n-ignore  Specialization.json id
        }
        if (window.CharSwitcher) {
            window.CharSwitcher.installTabKey(this, (dir) => this.cycleCookActor(dir));
        }
        this.createHelpWindow();
        this.createItemListWindow();
        this.createConfirmWindow();
    };

    Scene_Cooking.prototype.createHelpWindow = function () {
        this._helpWindow = new Window_Help(new Rectangle(0, 0, Graphics.boxWidth, this.calcWindowHeight(2, false)));
        this.addWindow(this._helpWindow);
        this.updateHelpMessage();
    };

    Scene_Cooking.prototype.createItemListWindow = function () {
        const y = this._helpWindow.height;
        const height = Graphics.boxHeight - y - this.calcWindowHeight(2, false);

        this._itemListWindow = new Window_CookingItemList(new Rectangle(0, y, Graphics.boxWidth, height));
        this._itemListWindow.setHandler("ok", this.onItemOk.bind(this));
        this._itemListWindow.setHandler("cancel", this.onItemCancel.bind(this));
        this._itemListWindow.refresh();
        this._itemListWindow.activate();
        this._itemListWindow.select(0);
        this.addWindow(this._itemListWindow);
    };

    Scene_Cooking.prototype.createConfirmWindow = function () {
        const y = Graphics.boxHeight - this.calcWindowHeight(2, false);
        this._confirmWindow = new Window_CookingConfirm(new Rectangle(0, y, Graphics.boxWidth, this.calcWindowHeight(2, false)));
        this._confirmWindow.setHandler("cook", this.onCookOk.bind(this));
        this._confirmWindow.setHandler("cancel", this.onCookCancel.bind(this));
        this._confirmWindow.deactivate();
        this.addWindow(this._confirmWindow);
    };

    Scene_Cooking.prototype.onItemOk = function () {
        const selectedItem = this._itemListWindow.item();

        if (!CookingSystem.getFirstItem()) {
            // First item selection
            CookingSystem.setFirstItem(selectedItem);
            this.updateHelpMessage();
            this._itemListWindow.refresh();
            this._itemListWindow.activate();
        } else {
            // Second item selection
            CookingSystem.setSecondItem(selectedItem);

            // Check if we have enough of the same item if selecting it twice
            if (CookingSystem.getFirstItem() === selectedItem && $gameParty.numItems(selectedItem) < 2) {
                SoundManager.playBuzzer();
                this._itemListWindow.activate();
                return;
            }

            // Update confirm window and activate it
            this._confirmWindow.refresh();
            this._itemListWindow.deactivate();
            this._confirmWindow.activate();
            this._confirmWindow.select(0);
            this.updateHelpMessage();
        }
    };

    Scene_Cooking.prototype.onItemCancel = function () {
        if (CookingSystem.getFirstItem()) {
            // If we've selected the first item, clear it
            CookingSystem.clearSelectedItems();
            this.updateHelpMessage();
            this._itemListWindow.refresh();
            this._itemListWindow.activate();
        } else {
            // Otherwise, exit the scene
            this.popScene();
        }
    };

    Scene_Cooking.prototype.updateHelpMessage = function () {
        if (!CookingSystem.getFirstItem()) {
            this._helpWindow.setText(_ci18n('ui.selectFirstIngredient'));
        } else if (!CookingSystem.getSecondItem()) {
            this._helpWindow.setText(_ci18n('ui.selectSecondIngredient', { name: CookingSystem.getFirstItem().name }));
        } else {
            const item1 = CookingSystem.getFirstItem();
            const item2 = CookingSystem.getSecondItem();
            const cookedName = CookingSystem.createCookedItemName(item1, item2);
            this._helpWindow.setText(_ci18n('ui.confirmCook', { item1: item1.name, item2: item2.name, result: cookedName }));
        }
    };

    Scene_Cooking.prototype.refreshStatus = function () {
        if (this._itemListWindow) this._itemListWindow.refresh();
    };

    Scene_Cooking.prototype.onCookOk = function () {
        const item1 = CookingSystem.getFirstItem();
        const item2 = CookingSystem.getSecondItem();

        if (item1 && item2 &&
            $gameParty.hasItem(item1) &&
            $gameParty.hasItem(item2)) {

            // Check if both items are the same and we have at least 2
            if (item1 === item2 && $gameParty.numItems(item1) < 2) {
                SoundManager.playBuzzer();
                this._confirmWindow.activate();
                return;
            }

            // Cook the items
            CookingSystem.cookItems(item1, item2);

            // Clear selections and close all menus to return to map
            CookingSystem.clearSelectedItems();
            SceneManager.pop();
            SceneManager.pop();
        } else {
            SoundManager.playBuzzer();
            this._confirmWindow.activate();
        }
    };

    Scene_Cooking.prototype.onCookCancel = function () {
        this._confirmWindow.deactivate();
        CookingSystem.setSecondItem(null);
        this.updateHelpMessage();
        this._itemListWindow.activate();
    };

    //=============================================================================
    // Window_CookingItemList
    //=============================================================================
    function Window_CookingItemList() {
        this.initialize(...arguments);
    }

    Window_CookingItemList.prototype = Object.create(Window_ItemList.prototype);
    Window_CookingItemList.prototype.constructor = Window_CookingItemList;

    Window_CookingItemList.prototype.initialize = function (rect) {
        Window_ItemList.prototype.initialize.call(this, rect);
        this._category = "item";
        this.refresh();
    };

    Window_CookingItemList.prototype.includes = function (item) {
        return item && item.itypeId === 1 && CookingSystem.isFoodItem(item)
    };

    Window_CookingItemList.prototype.isEnabled = function (item) {
        if (!item) return false;

        const firstItem = CookingSystem.getFirstItem();
        if (!firstItem) return true;

        // If selecting the same item, check if we have enough
        if (item === firstItem) {
            return $gameParty.numItems(item) >= 2;
        }

        return true;
    };

    Window_CookingItemList.prototype.drawItem = function (index) {
        const item = this.itemAt(index);
        if (item) {
            const rect = this.itemLineRect(index);
            const firstItem = CookingSystem.getFirstItem();

            // Highlight the first selected item
            if (item === firstItem) {
                this.changePaintOpacity(true);
                this.contents.fillRect(rect.x, rect.y, rect.width, rect.height, 'rgba(255, 255, 128, 0.3)');
            }

            this.changePaintOpacity(this.isEnabled(item));
            this.drawItemName(item, rect.x, rect.y, rect.width);
            this.drawItemNumber(item, rect.x, rect.y, rect.width);
        }
    };

    Window_CookingItemList.prototype.needsNumber = function () {
        return true;
    };

    Window_CookingItemList.prototype.maxCols = function () {
        return 1;
    };

    //=============================================================================
    // Window_CookingConfirm
    //=============================================================================
    function Window_CookingConfirm() {
        this.initialize(...arguments);
    }

    Window_CookingConfirm.prototype = Object.create(Window_HorzCommand.prototype);
    Window_CookingConfirm.prototype.constructor = Window_CookingConfirm;

    Window_CookingConfirm.prototype.initialize = function (rect) {
        Window_HorzCommand.prototype.initialize.call(this, rect);
        this.refresh();
    };

    Window_CookingConfirm.prototype.makeCommandList = function () {
        const item1 = CookingSystem.getFirstItem();
        const item2 = CookingSystem.getSecondItem();
        this.addCommand(_ci18n('ui.cookButton'), 'cook', item1 && item2);
        this.addCommand(_ci18n('ui.cancelButton'), 'cancel');
    };

    Window_CookingConfirm.prototype.maxCols = function () {
        return 2;
    };

    // =============================================================================
    // HTML5 overlay / ASCII Mode Compatibility
    // =============================================================================

    // Cache the available-food list on the scene: getAvailableRecoveryItems()
    // filters the whole party inventory (regex per note) and was called several
    // times per frame. The list only changes when an item is cooked/eaten, which
    // pops the scene, so caching for the scene's lifetime is safe.
    Scene_Cooking.prototype.getCachedFoodList = function () {
        if (!this._cachedFoodList) {
            this._cachedFoodList = CookingSystem.getAvailableRecoveryItems();
        }
        return this._cachedFoodList;
    };
    Scene_Cooking.prototype.invalidateFoodList = function () {
        this._cachedFoodList = null;
    };

    const _Scene_Cooking_start = Scene_Cooking.prototype.start;
    Scene_Cooking.prototype.start = function () {
        if (_Scene_Cooking_start) _Scene_Cooking_start.call(this);
        else Scene_MenuBase.prototype.start.call(this);

        this._cachedFoodList = null;
        this._asciiCookingSig = null;

        if (window.AsciiMode && window.AsciiMode.active !== 0) {
            window.AsciiMode.createCanvas();
            if (window.AsciiMode.canvas) window.AsciiMode.canvas.style.display = 'block';

            // Deactivate and hide normal windows
            if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
            if (this._itemListWindow) { this._itemListWindow.deactivate(); this._itemListWindow.hide(); }
            if (this._confirmWindow) { this._confirmWindow.deactivate(); this._confirmWindow.hide(); }

            this._selectedIndex = 0;
            this._activeWindow = 'list'; // 'list', 'confirm'
            this._selectedConfirmIndex = 0; // 0: Cook, 1: Cancel
            return;
        }

        // Hide standard windows for custom HTML overlay
        if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
        if (this._itemListWindow) { this._itemListWindow.deactivate(); this._itemListWindow.hide(); }
        if (this._confirmWindow) { this._confirmWindow.deactivate(); this._confirmWindow.hide(); }

        // Initialize D&D Cooking view
        this._activeArea = "pantry";
        this._pantryIndex = 0;
        this._confirmIndex = 0;

        this.initUICooking();
        this.refreshUICooking();
    };

    const _Scene_Cooking_update = Scene_Cooking.prototype.update;
    Scene_Cooking.prototype.update = function () {
        if (window.AsciiMode && window.AsciiMode.active !== 0) {
            this.updateAsciiCookingInput();
            this.renderAsciiCooking();
            Scene_Base.prototype.update.call(this);
            return;
        }

        this.updateUICookingInput();
        Scene_MenuBase.prototype.update.call(this);
    };

    const _Scene_Cooking_terminate = Scene_Cooking.prototype.terminate;
    Scene_Cooking.prototype.terminate = function () {
        if (window.AsciiMode && window.AsciiMode.canvas) {
            window.AsciiMode.canvas.style.display = 'none';
        }
        if (window.CharSwitcher) window.CharSwitcher.removeTabKey(this);
        if (window.SpecBadge) window.SpecBadge.hide();

        // Cleanup D&D container
        const container = document.getElementById("cooking-container");
        if (container) {
            container.remove();
        }

        // Cleanup style block to prevent main menu shrinking/leakage
        const style = document.getElementById("cooking-style");
        if (style) {
            style.remove();
        }

        if (_Scene_Cooking_terminate) _Scene_Cooking_terminate.call(this);
        else Scene_MenuBase.prototype.terminate.call(this);
    };

    Scene_Cooking.prototype.updateAsciiCookingInput = function () {
        const list = this.getCachedFoodList();

        if (this._activeWindow === 'list') {
            if (list.length === 0) {
                if (Input.isTriggered('cancel')) {
                    SceneManager.pop();
                    SoundManager.playCancel();
                }
                return;
            }
            if (Input.isRepeated('down')) {
                this._selectedIndex = (this._selectedIndex + 1) % list.length;
                SoundManager.playCursor();
            }
            if (Input.isRepeated('up')) {
                this._selectedIndex = (this._selectedIndex - 1 + list.length) % list.length;
                SoundManager.playCursor();
            }
            if (Input.isTriggered('ok')) {
                const selectedItem = list[this._selectedIndex];

                if (!CookingSystem.getFirstItem()) {
                    CookingSystem.setFirstItem(selectedItem);
                    SoundManager.playOk();
                } else {
                    CookingSystem.setSecondItem(selectedItem);

                    if (CookingSystem.getFirstItem() === selectedItem && $gameParty.numItems(selectedItem) < 2) {
                        SoundManager.playBuzzer();
                        CookingSystem.setSecondItem(null);
                    } else {
                        this._activeWindow = 'confirm';
                        this._selectedConfirmIndex = 0;
                        SoundManager.playOk();
                    }
                }
            }
            if (Input.isTriggered('shift')) {
                // Eat the focused ingredient raw, splitting effects across the party
                const eatItem = list[this._selectedIndex];
                if (CookingSystem.eatSingleItem(eatItem)) {
                    CookingSystem.clearSelectedItems();
                    SceneManager.pop();
                }
                return;
            }
            if (Input.isTriggered('cancel')) {
                if (CookingSystem.getFirstItem()) {
                    CookingSystem.clearSelectedItems();
                    SoundManager.playCancel();
                } else {
                    SceneManager.pop();
                    SoundManager.playCancel();
                }
            }
        } else if (this._activeWindow === 'confirm') {
            if (Input.isRepeated('right') || Input.isRepeated('left')) {
                this._selectedConfirmIndex = (this._selectedConfirmIndex + 1) % 2;
                SoundManager.playCursor();
            }
            if (Input.isTriggered('ok')) {
                if (this._selectedConfirmIndex === 0) { // Cook
                    const item1 = CookingSystem.getFirstItem();
                    const item2 = CookingSystem.getSecondItem();
                    if (item1 && item2 && $gameParty.hasItem(item1) && $gameParty.hasItem(item2)) {
                        if (item1 === item2 && $gameParty.numItems(item1) < 2) {
                            SoundManager.playBuzzer();
                        } else {
                            CookingSystem.cookItems(item1, item2);
                            CookingSystem.clearSelectedItems();
                            SceneManager.pop();
                            SceneManager.pop();
                        }
                    } else {
                        SoundManager.playBuzzer();
                    }
                } else { // Cancel
                    this._activeWindow = 'list';
                    CookingSystem.setSecondItem(null);
                    SoundManager.playCancel();
                }
            }
            if (Input.isTriggered('cancel')) {
                this._activeWindow = 'list';
                CookingSystem.setSecondItem(null);
                SoundManager.playCancel();
            }
        }
    };

    Scene_Cooking.prototype.renderAsciiCooking = function () {
        const ctx = window.AsciiMode.context;
        const canvas = window.AsciiMode.canvas;
        if (!ctx || !canvas) return;

        // Only repaint when selection / mode / list state changed, instead of
        // clearing and redrawing the whole canvas every frame.
        const _item1 = CookingSystem.getFirstItem();
        const _item2 = CookingSystem.getSecondItem();
        const _list = this.getCachedFoodList();
        const sig = [
            this._activeWindow, this._selectedIndex, this._selectedConfirmIndex,
            _item1 ? _item1.id : -1, _item2 ? _item2.id : -1, _list.length
        ].join('|');
        if (sig === this._asciiCookingSig) return;
        this._asciiCookingSig = sig;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const fontSize = window.AsciiMode.fontSize;
        ctx.font = `${fontSize}px ${window.AsciiMode.fontFamily}`;

        // Header
        ctx.fillStyle = '#FFD700';
        ctx.textAlign = 'center';
        ctx.fillText("--- COOKING ---", canvas.width / 2, 30);

        // Help Text
        ctx.fillStyle = '#FFFFFF';
        let helpText = T('Cooking.ui.selectIngredients');
        const item1 = CookingSystem.getFirstItem();
        const item2 = CookingSystem.getSecondItem();

        if (!item1) {
            helpText = _ci18n('ui.selectFirstIngredient');
        } else if (!item2) {
            helpText = _ci18n('ui.selectSecondIngredient', { name: item1.name });
        } else {
            const resultName = CookingSystem.createCookedItemName(item1, item2);
            helpText = _ci18n('ui.confirmCook', { item1: item1.name, item2: item2.name, result: resultName });
        }
        ctx.fillText(helpText, canvas.width / 2, 70);

        // Shift-to-eat hint
        if (this._activeWindow === 'list') {
            ctx.fillStyle = '#9ACD32';
            ctx.fillText(`[Shift / X] ${_ci18n('ui.eatButton')}`, canvas.width / 2, 95);
        }

        // List
        const list = this.getCachedFoodList();
        const listY = 120;
        const listX = 50;

        ctx.textAlign = 'left';
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const y = listY + i * (fontSize + 10);

            const isSelected = this._selectedIndex === i && this._activeWindow === 'list';
            const isFirstSelected = item1 === item;

            if (isSelected) {
                ctx.fillStyle = '#FF0000';
                ctx.fillText(`> ${item.name}`, listX, y);
            } else if (isFirstSelected) {
                ctx.fillStyle = '#00FFFF';
                ctx.fillText(`* ${item.name}`, listX, y);
            } else {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(`  ${item.name}`, listX, y);
            }

            ctx.fillStyle = '#FFFF00';
            ctx.fillText(`x${$gameParty.numItems(item)}`, listX + 300, y);
        }

        // Details
        const selectedItem = list[this._selectedIndex];
        if (selectedItem) {
            this.renderCookingItemDetails(selectedItem, 450, listY);
        }

        // Confirm Box
        if (this._activeWindow === 'confirm') {
            const boxWidth = 400;
            const boxHeight = 100;
            const bX = (canvas.width - boxWidth) / 2;
            const bY = (canvas.height - boxHeight) / 2;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.fillRect(bX, bY, boxWidth, boxHeight);
            ctx.strokeStyle = '#FFFFFF';
            ctx.strokeRect(bX, bY, boxWidth, boxHeight);

            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.fillText(T('Cooking.ui.cookTheseItems'), canvas.width / 2, bY + 30);

            const options = [
                `[ ${_ci18n('ui.cookButton')} ]`,
                `[ ${_ci18n('ui.cancelButton')} ]`
            ];
            for (let i = 0; i < options.length; i++) {
                const x = bX + (i + 1) * (boxWidth / 3);
                if (this._selectedConfirmIndex === i) {
                    ctx.fillStyle = '#FF0000';
                } else {
                    ctx.fillStyle = '#FFFF00';
                }
                ctx.fillText(options[i], x, bY + 70);
            }
        }
    };

    Scene_Cooking.prototype.renderCookingItemDetails = function (item, x, y) {
        const ctx = window.AsciiMode.context;
        const fontSize = window.AsciiMode.fontSize;
        const lineHeight = fontSize + 6;
        let currentY = y;

        ctx.fillStyle = '#FFD700';
        ctx.textAlign = 'left';
        ctx.fillText(item.name, x, currentY);
        currentY += lineHeight;

        ctx.strokeStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(x, currentY);
        ctx.lineTo(x + 300, currentY);
        ctx.stroke();
        currentY += 10;

        ctx.fillStyle = '#FFFFFF';

        const calories = item.meta.calories ? item.meta.calories : "0";
        const protein = item.meta.protein ? item.meta.protein : "0";
        const fat = item.meta.fat ? item.meta.fat : "0";

        this.drawCookingKeyValue(T('Cooking.nutrition.calories'), calories, x, currentY);
        currentY += lineHeight;
        this.drawCookingKeyValue(T('Cooking.nutrition.protein'), protein, x, currentY);
        currentY += lineHeight;
        this.drawCookingKeyValue(T('Cooking.nutrition.fat'), fat, x, currentY);
        currentY += lineHeight;
    };

    Scene_Cooking.prototype.drawCookingKeyValue = function (key, value, x, y) {
        const ctx = window.AsciiMode.context;
        ctx.fillStyle = '#00FFFF';
        ctx.fillText(key + ":", x, y);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(value, x + 100, y);
    };

    // =============================================================================
    // D&D Modern HTML Overlay Implementation
    // =============================================================================

    Scene_Cooking.prototype.popScene = function () {
        Input.clear();
        TouchInput.clear();
        Scene_MenuBase.prototype.popScene.call(this);
    };

    Scene_Cooking.prototype.initUICooking = function () {
        let container = document.getElementById("cooking-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "cooking-container";
            document.body.appendChild(container);
        }

        const backBtnText = T('Cooking.back');
        const pantryTitle = T('Cooking.ingredients');

        // Set static structure once if it's empty or not initialized
        if (!container.querySelector(".book-spread")) {
            container.innerHTML = `
                <div class="book-spread">
                    <div class="left-page">
                        <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
                          <div class="back-button focusable" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                            ${backBtnText}
                          </div>
                          <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${pantryTitle}</h2>
                        </div>
                        <div class="pantry-list-container" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"></div>
                    </div>
                    <div class="right-page">
                        <div id="cooking-companion-row" class="companion-switcher companion-switcher--header"></div>

                        <div class="pot-label">${T('Cooking.nutritionalBase')}</div>
                        <div class="slot-container-1"></div>
                        
                        <div class="hearth-area">
                            <div class="cauldron"></div>
                            <div class="hearth-fire"></div>
                        </div>
                        
                        <div class="pot-label">${T('Cooking.aromaticBinder')}</div>
                        <div class="slot-container-2"></div>
                        
                        <div class="result-card-container"></div>
                        
                        <div class="cooking-actions">
                            <div class="btn primary" id="cook-btn"></div>
                            <div class="btn" id="cancel-btn"></div>
                        </div>
                    </div>
                </div>
            `;

            // Make back button functional
            const backBtn = container.querySelector(".back-button");
            if (backBtn) {
                backBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    SoundManager.playCancel();
                    this.popScene();
                });
            }

            // Scrollwheel should work in left column for moving up and down the scrollbox
            container.addEventListener("wheel", (e) => {
                const list = container.querySelector(".pantry-list");
                if (list) {
                    list.scrollTop += e.deltaY;
                }
            });
        }
    };

    Scene_Cooking.prototype.refreshUICooking = function () {
        const container = document.getElementById("cooking-container");
        if (!container) return;

        // The party switcher heads the right page: the same companion-tab row
        // the Skills and Training menus use.
        const compRow = document.getElementById("cooking-companion-row");
        if (compRow && window.CharSwitcher) {
            // The switcher heads the page in place of its old title, so it is
            // drawn even for a party of one: the single name says whose hands
            // the skill badge underneath is reporting.
            const members = this.cookMembers();
            let tabs = "";
            members.forEach((m, idx) => {
                const sel = idx === (this._cookActorIndex || 0) ? "selected" : "";
                tabs += `<div class="companion-tab ${sel}" onclick="SceneManager._scene.selectCookActor(${idx})">${m.name()}</div>`;
            });
            compRow.innerHTML = window.CharSwitcher.inner(
                `<div class="companion-tabs-row">${tabs}</div>`, members.length);
        }
        if (window.SpecBadge) {
            window.SpecBadge.show('Cooking', { actor: this.cookActor() });  // i18n-ignore  Specialization.json id
        }

        const itemsList = this.getCachedFoodList();
        const item1 = CookingSystem.getFirstItem();
        const item2 = CookingSystem.getSecondItem();

        // 1. Render Pantry List
        const pantryListContainer = container.querySelector(".pantry-list-container");
        if (pantryListContainer) {
            let pantryHTML = "";
            if (itemsList.length === 0) {
                pantryHTML = `
                    <div class="empty-pantry-msg">
                        ${T('Cooking.yourBackpackContainsNoEdible')}
                    </div>
                `;
            } else {
                pantryHTML = `<div class="pantry-list">`;
                itemsList.forEach((item, idx) => {
                    const isSelected = item === item1 || item === item2;
                    const isFocused = this._activeArea === "pantry" && this._pantryIndex === idx;
                    const isEnabled = this._itemListWindow ? this._itemListWindow.isEnabled(item) : true;

                    const cName = isSelected ? "pantry-item selected-ingredient" : "pantry-item";
                    const fName = isFocused ? `${cName} focused` : cName;
                    const finalClass = isEnabled ? fName : `${fName} disabled`;

                    const nut = CookingSystem.getRecoveryValues(item);
                    const iconIdx = item.iconIndex;
                    const iconStyle = `background: url('img/system/IconSet.png') -${(iconIdx % 16) * 32}px -${Math.floor(iconIdx / 16) * 32}px no-repeat;`;

                    pantryHTML += `
                        <div class="${finalClass}" data-idx="${idx}">
                            <div class="item-icon" style="${iconStyle}"></div>
                            <div class="item-details">
                                <span class="item-name">${window.translateText ? window.translateText(item.name) : item.name}</span>
                                <span class="item-stats">
                                    Cal: ${nut.hunger} | Prot: ${nut.tp} | Fat: ${nut.mp}
                                </span>
                            </div>
                            <span class="item-qty">x${$gameParty.numItems(item)}</span>
                            <div class="eat-raw-btn focusable" data-eat-idx="${idx}" title="${_ci18n('ui.eatButton')}">${_ci18n('ui.eatButton')}</div>
                        </div>
                    `;
                });
                pantryHTML += `</div>`;
            }
            pantryListContainer.innerHTML = pantryHTML;

            // Bind click handlers for mouse support
            if (itemsList.length > 0) {
                const itemNodes = pantryListContainer.querySelectorAll(".pantry-item");
                itemNodes.forEach(node => {
                    node.addEventListener("click", () => {
                        const idx = parseInt(node.getAttribute("data-idx"));
                        const clickedItem = itemsList[idx];

                        if (this._itemListWindow && !this._itemListWindow.isEnabled(clickedItem)) {
                            SoundManager.playBuzzer();
                            return;
                        }

                        this._activeArea = "pantry";
                        this._pantryIndex = idx;

                        if (!CookingSystem.getFirstItem()) {
                            CookingSystem.setFirstItem(clickedItem);
                            SoundManager.playOk();
                        } else if (!CookingSystem.getSecondItem()) {
                            CookingSystem.setSecondItem(clickedItem);
                            if (CookingSystem.getFirstItem() === clickedItem && $gameParty.numItems(clickedItem) < 2) {
                                SoundManager.playBuzzer();
                                CookingSystem.setSecondItem(null);
                            } else {
                                SoundManager.playOk();
                                this._activeArea = "confirm";
                                this._confirmIndex = 0;
                            }
                        } else {
                            SoundManager.playBuzzer();
                        }
                        this.refreshUICooking();
                    });
                });

                // Bind "Eat Raw" buttons (eat a single ingredient, split across party)
                const eatNodes = pantryListContainer.querySelectorAll(".eat-raw-btn");
                eatNodes.forEach(node => {
                    node.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const idx = parseInt(node.getAttribute("data-eat-idx"));
                        const eatItem = itemsList[idx];
                        if (CookingSystem.eatSingleItem(eatItem)) {
                            CookingSystem.clearSelectedItems();
                            this.popScene();
                        }
                    });
                });
            }
        }

        // 2. Render Slots
        const slotContainer1 = container.querySelector(".slot-container-1");
        if (slotContainer1) {
            let slot1HTML = `
                <div class="ingredient-slot">
                    <span class="empty-slot-text">${T('Cooking.selectBase')}</span>
                </div>
            `;
            if (item1) {
                const iconIdx = item1.iconIndex;
                const iconStyle = `background: url('img/system/IconSet.png') -${(iconIdx % 16) * 32}px -${Math.floor(iconIdx / 16) * 32}px no-repeat;`;
                slot1HTML = `
                    <div class="ingredient-slot filled">
                        <div class="item-icon" style="${iconStyle}"></div>
                        <div class="item-details">
                            <span class="item-name">${window.translateText ? window.translateText(item1.name) : item1.name}</span>
                            <span class="item-stats">Cal: ${item1.meta.calories || 0} | Prot: ${item1.meta.protein || 0} | Fat: ${item1.meta.fat || 0}</span>
                        </div>
                    </div>
                `;
            }
            slotContainer1.innerHTML = slot1HTML;
        }

        const slotContainer2 = container.querySelector(".slot-container-2");
        if (slotContainer2) {
            let slot2HTML = `
                <div class="ingredient-slot">
                    <span class="empty-slot-text">${T('Cooking.selectBinder')}</span>
                </div>
            `;
            if (item2) {
                const iconIdx = item2.iconIndex;
                const iconStyle = `background: url('img/system/IconSet.png') -${(iconIdx % 16) * 32}px -${Math.floor(iconIdx / 16) * 32}px no-repeat;`;
                slot2HTML = `
                    <div class="ingredient-slot filled">
                        <div class="item-icon" style="${iconStyle}"></div>
                        <div class="item-details">
                            <span class="item-name">${window.translateText ? window.translateText(item2.name) : item2.name}</span>
                            <span class="item-stats">Cal: ${item2.meta.calories || 0} | Prot: ${item2.meta.protein || 0} | Fat: ${item2.meta.fat || 0}</span>
                        </div>
                    </div>
                `;
            }
            slotContainer2.innerHTML = slot2HTML;
        }

        // 3. Render Result Card
        const resultCardContainer = container.querySelector(".result-card-container");
        if (resultCardContainer) {
            let resultCardHTML = "";
            if (item1 && item2) {
                const cookedName = CookingSystem.createCookedItemName(item1, item2);
                const item1Nutrition = CookingSystem.getRecoveryValues(item1);
                const item2Nutrition = CookingSystem.getRecoveryValues(item2);

                const isSameItem = item1 === item2;
                let multiplier = 1.0;
                if (isSameItem) {
                    multiplier = CookingSystem.getMultiplierForSameItem();
                }

                let totalCalories = item1Nutrition.hunger * 2;
                let totalProtein = item1Nutrition.tp * 2;
                let totalFat = item1Nutrition.mp * 2;

                if (isSameItem) {
                    totalCalories += item2Nutrition.hunger * multiplier;
                    totalProtein += item2Nutrition.tp * multiplier;
                    totalFat += item2Nutrition.mp * multiplier;
                } else {
                    totalCalories += item2Nutrition.hunger;
                    totalProtein += item2Nutrition.tp;
                    totalFat += item2Nutrition.mp;
                }

                // Get formula params
                const params = PluginManager.parameters('TimeDateSystem');
                const maxHunger = Number(params['maxHunger'] || 100);
                const calorieFactor = Number(params['calorieFactor'] || 0.10);
                const proteinFactor = Number(params['proteinFactor'] || 2.00);
                const fatFactor = Number(params['fatFactor'] || 1.50);

                const totalHungerRecovery =
                    (totalCalories * calorieFactor) +
                    (totalProtein * proteinFactor) +
                    (totalFat * fatFactor);

                const previewMembers = $gameParty.members().filter(a => a);
                const partySize = previewMembers.length;
                const previewDeficits = previewMembers.map(a => Math.max(0, maxHunger - (a._hunger === undefined ? maxHunger : a._hunger)));
                const previewTotalDeficit = previewDeficits.reduce((s, d) => s + d, 0);
                const previewEffective = previewTotalDeficit > 0 ? Math.min(totalHungerRecovery, previewTotalDeficit) : 0;
                const hungerPerMember = partySize > 0 ? previewEffective / partySize : 0;
                const hungerPercent = Math.floor((hungerPerMember / maxHunger) * 100);

                let adjectiveMsg = "";
                if (isSameItem) {
                    if (CookingSystem._lastAdjectiveEffect === 'positive') {
                        adjectiveMsg = `<div style="font-size:10px; color:#27ae60; font-weight:bold; margin-top:2px;">${T('Cooking.extraordinaryEffect50')}</div>`;
                    } else if (CookingSystem._lastAdjectiveEffect === 'neutral') {
                        adjectiveMsg = `<div style="font-size:10px; color:#f39c12; font-weight:bold; margin-top:2px;">${T('Cooking.minorEffect25')}</div>`;
                    } else {
                        adjectiveMsg = `<div style="font-size:10px; color:#c0392b; font-weight:bold; margin-top:2px;">${T('Cooking.disastrousEffect75')}</div>`;
                    }
                }

                resultCardHTML = `
                    <div class="result-card">
                        <div class="result-header">
                            <span>${cookedName}</span>
                        </div>
                        ${adjectiveMsg}
                        <div class="result-nutrition">
                            <div class="nut-box">
                                ${T('Cooking.calories')}
                                <span class="nut-val">${Math.floor(totalCalories)}</span>
                            </div>
                            <div class="nut-box">
                                ${T('Cooking.protein')}
                                <span class="nut-val">${Math.floor(totalProtein)}g</span>
                            </div>
                            <div class="nut-box">
                                ${T('Cooking.fat')}
                                <span class="nut-val">${Math.floor(totalFat)}g</span>
                            </div>
                        </div>
                        <div class="recovery-preview">
                            +${hungerPercent}% ${T('Cooking.satietyPerMember')} (${T('Cooking.split')} ${partySize})
                        </div>
                    </div>
                `;
            } else {
                resultCardHTML = `
                    <div class="cooking-empty-hint">
                        <p>
                            ${T('Cooking.combineANutritionalBaseAnd')}
                        </p>
                    </div>
                `;
            }
            resultCardContainer.innerHTML = resultCardHTML;
        }

        // 4. Update Actions Buttons
        const isCookEnabled = item1 && item2;
        const isCookFocused = this._activeArea === "confirm" && this._confirmIndex === 0;
        const isCancelFocused = this._activeArea === "confirm" && this._confirmIndex === 1;

        const cookBtn = container.querySelector("#cook-btn");
        if (cookBtn) {
            cookBtn.className = isCookEnabled ? (isCookFocused ? "btn primary focused" : "btn primary") : "btn primary disabled";
            cookBtn.textContent = _ci18n('ui.cookButton');
            // Re-bind click handler
            const newCookBtn = cookBtn.cloneNode(true);
            cookBtn.parentNode.replaceChild(newCookBtn, cookBtn);
            newCookBtn.addEventListener("click", () => {
                if (isCookEnabled) {
                    this.onCookOk();
                } else {
                    SoundManager.playBuzzer();
                }
            });
        }

        const cancelBtn = container.querySelector("#cancel-btn");
        if (cancelBtn) {
            cancelBtn.className = isCancelFocused ? "btn focused" : "btn";
            cancelBtn.textContent = item1 ? (T('Cooking.clearSelection')) : _ci18n('ui.cancelButton');
            const newCancelBtn = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            newCancelBtn.addEventListener("click", () => {
                if (item1) {
                    CookingSystem.clearSelectedItems();
                    SoundManager.playCancel();
                    this._activeArea = "pantry";
                    this._pantryIndex = 0;
                    this.refreshUICooking();
                } else {
                    SoundManager.playCancel();
                    this.popScene();
                }
            });
        }
    };

    Scene_Cooking.prototype.updateUICookingInput = function () {
        const itemsList = this.getCachedFoodList();
        const item1 = CookingSystem.getFirstItem();
        const item2 = CookingSystem.getSecondItem();

        // Shoulder buttons change who is cooking, wherever the cursor is (TAB
        // does the same on a keyboard, through CharSwitcher).
        if (Input.isTriggered('pagedown')) { this.cycleCookActor(1); return; }
        if (Input.isTriggered('pageup')) { this.cycleCookActor(-1); return; }

        if (this._activeArea === "pantry") {
            if (itemsList.length === 0) {
                if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    SoundManager.playCancel();
                    this.popScene();
                }
                return;
            }

            if (Input.isRepeated('down')) {
                this._pantryIndex = (this._pantryIndex + 1) % itemsList.length;
                SoundManager.playCursor();
                this.refreshUICooking();

                // Adjust scroll position dynamically
                const container = document.getElementById("cooking-container");
                if (container) {
                    const activeRow = container.querySelector(".pantry-item.focused");
                    if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
                }
            } else if (Input.isRepeated('up')) {
                this._pantryIndex = (this._pantryIndex - 1 + itemsList.length) % itemsList.length;
                SoundManager.playCursor();
                this.refreshUICooking();

                // Adjust scroll position dynamically
                const container = document.getElementById("cooking-container");
                if (container) {
                    const activeRow = container.querySelector(".pantry-item.focused");
                    if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
                }
            } else if (Input.isTriggered('right') && item1 && item2) {
                this._activeArea = "confirm";
                this._confirmIndex = 0;
                SoundManager.playCursor();
                this.refreshUICooking();
            } else if (Input.isTriggered('shift')) {
                // Eat the focused ingredient raw, splitting effects across the party
                const eatItem = itemsList[this._pantryIndex];
                if (CookingSystem.eatSingleItem(eatItem)) {
                    CookingSystem.clearSelectedItems();
                    this.popScene();
                }
            } else if (Input.isTriggered('ok')) {
                const selectedItem = itemsList[this._pantryIndex];
                const isEnabled = this._itemListWindow ? this._itemListWindow.isEnabled(selectedItem) : true;

                if (!isEnabled) {
                    SoundManager.playBuzzer();
                    return;
                }

                if (!CookingSystem.getFirstItem()) {
                    CookingSystem.setFirstItem(selectedItem);
                    SoundManager.playOk();
                } else if (!CookingSystem.getSecondItem()) {
                    CookingSystem.setSecondItem(selectedItem);
                    if (CookingSystem.getFirstItem() === selectedItem && $gameParty.numItems(selectedItem) < 2) {
                        SoundManager.playBuzzer();
                        CookingSystem.setSecondItem(null);
                    } else {
                        SoundManager.playOk();
                        this._activeArea = "confirm";
                        this._confirmIndex = 0;
                    }
                }
                this.refreshUICooking();
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                if (CookingSystem.getFirstItem()) {
                    CookingSystem.clearSelectedItems();
                    SoundManager.playCancel();
                    this._activeArea = "pantry";
                    this.refreshUICooking();
                } else {
                    SoundManager.playCancel();
                    this.popScene();
                }
            }
        } else if (this._activeArea === "confirm") {
            if (Input.isRepeated('left') || Input.isRepeated('right') || Input.isRepeated('up') || Input.isRepeated('down')) {
                this._confirmIndex = (this._confirmIndex + 1) % 2;
                SoundManager.playCursor();
                this.refreshUICooking();
            } else if (Input.isTriggered('left') && this._confirmIndex === 0) {
                this._activeArea = "pantry";
                SoundManager.playCursor();
                this.refreshUICooking();
            } else if (Input.isTriggered('ok')) {
                if (this._confirmIndex === 0) { // Prepare Dish
                    this.onCookOk();
                } else { // Cancel / Clear
                    CookingSystem.clearSelectedItems();
                    SoundManager.playCancel();
                    this._activeArea = "pantry";
                    this._pantryIndex = 0;
                    this.refreshUICooking();
                }
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                CookingSystem.clearSelectedItems();
                SoundManager.playCancel();
                this._activeArea = "pantry";
                this._pantryIndex = 0;
                this.refreshUICooking();
            }
        }
    };

    Scene_Cooking.prototype.onCookOk = function () {
        const item1 = CookingSystem.getFirstItem();
        const item2 = CookingSystem.getSecondItem();
        if (item1 && item2 && $gameParty.hasItem(item1) && $gameParty.hasItem(item2)) {
            if (item1 === item2 && $gameParty.numItems(item1) < 2) {
                SoundManager.playBuzzer();
            } else {
                CookingSystem.cookItems(item1, item2);
                CookingSystem.clearSelectedItems();
                SoundManager.playOk();
                this.popScene();
            }
        } else {
            SoundManager.playBuzzer();
        }
    };

    //=============================================================================
    // Scene_Menu additions
    //=============================================================================
    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function () {
        _Scene_Menu_createCommandWindow.call(this);
        this._commandWindow.setHandler("cooking", this.commandCooking.bind(this));
    };

    Scene_Menu.prototype.commandCooking = function () {
        SceneManager.push(Scene_Cooking);
    };

    //=============================================================================
    // Window_MenuCommand additions to add cooking to the menu
    //=============================================================================
    const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
    Window_MenuCommand.prototype.addOriginalCommands = function () {
        _Window_MenuCommand_addOriginalCommands.call(this);

        // Check if player has any of the required items
        const hasRequiredItem = requiredItemIds.some(itemId => {
            const item = $dataItems[itemId];
            return item && $gameParty.hasItem(item);
        });

        this.addCommand(_ci18n('ui.menuLabel'), 'cooking', hasRequiredItem, 219);
    };
})();