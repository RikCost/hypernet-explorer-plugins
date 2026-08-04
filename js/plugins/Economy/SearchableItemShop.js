/*:
 * @target MZ
 * @plugindesc v1.5.0 Creates a grid-based item shop with category filtering, two-stage navigation, delivery system, and i18n support.
 * @author Omni-Lex (Refactored)
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * SearchableItemShop.js
 * * This plugin creates a grid-based shop interface for 
 * RPG Maker MZ that displays all available items, weapons, and armor.
 * * Features:
 * - Grid-based layout for categories and items
 * - Two-stage navigation: category selection first, then item selection
 * - Category filtering for items, weapons, armor, and skills
 * - Custom categories via item notes
 * - Purchase confirmation dialog with delivery time display
 * - Delivery system: items take 1-7 days to arrive based on price
 * - Maximum 6 items can be ordered at once
 * - Skill learning for actor one (60% discount on skills)
 * - Dynamically calculated tax on all non-skill items based on game variable 54.
 * - Items sorted by price (lowest to highest)
 * - Prices displayed on the left side for better readability
 * - Filters out items with price 0 or empty names
 * - Italian and English language support
 * * How to use:
 * 1. Add this plugin to your project.
 * 2. Add category tags to your items in the database notes field:
 * <category:Enhancers>
 * <category:Jungle>
 * Multiple categories can be added to the same item.
 * 3. Call the plugin command "OpenSearchableShop" to open the shop.
 * 4. Call the plugin command "RetireDeliveredItems" to collect arrived items.
 * 5. The tax for non-skill items is calculated based on variable 54.
 * The standard value is 66666. Any deviation is calculated as a
 * percentage, multiplied by 10, and then added to or subtracted
 * from the base 30% tax rate. The tax cannot go below 30%.
 *
 * @command OpenSearchableShop
 * @desc Opens the searchable item shop.
 * @command OpenLimitedShop
 * @desc Opens the limited item shop.
 * @command RetireDeliveredItems
 * @desc Collects all delivered items and adds them to inventory.
 *
 */

(() => {
    'use strict';

    // --- HypercapitalisEmporiumApp ---
    window.HypercapitalisEmporiumApp = {
        appInstance: null,
        win: null,
        launch: function(params) {
            if (!window.HypernetWindowManager) return;
            
            if (!this.win || !document.getElementById('app-store')) {
                this.win = window.HypernetWindowManager.createWindow({
                    id: 'app-store',
                    title: T('Stockbusters.ui.windowTitle'),
                    icon: 191,
                    width: 900,
                    height: 650,
                    contentHTML: '<div id="emporium-content" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: #ece9d8;"></div>'
                });

                // The shop runs its own grid/category/buy navigation, so the OS
                // focus ring yields directional / OK / cancel input to it.
                this.win.dataset.selfNav = '1';

                this.appInstance = new Scene_SearchableShop();
                this.appInstance._isAppMode = true; // Flag for internal checks
                this.appInstance.prepare(params);
                this.appInstance.create();
                
                this.win.addEventListener('hypernet-closed', () => {
                    if (this.appInstance) {
                        this.appInstance.terminate();
                        this.appInstance = null;
                    }
                    this.win = null;
                });
            } else {
                window.HypernetWindowManager.bringToFront(this.win);
            }
        },
        update: function() {
            if (this.appInstance && this.win) {
                // Only process input if window is active
                if (this.win.classList.contains('active')) {
                    this.appInstance.update();
                } else {
                    // Just update base windows so they don't die
                    if (this.appInstance._categoryGridWindow) this.appInstance._categoryGridWindow.update();
                    if (this.appInstance._itemListWindow) this.appInstance._itemListWindow.update();
                    if (this.appInstance._buyWindow) this.appInstance._buyWindow.update();
                }
            }
        }
    };

    // Register inside HypernetOS core app registry
    if (window.HypernetOS) {
        window.HypernetOS.registerApp({
            id: 'app-hypernet-shop',
            name: T('Stockbusters.ui.appName'),
            icon: 191,
            launchFn: function(params) {
                window.HypercapitalisEmporiumApp.launch(params);
            },
            desktopShortcut: true
        });
    }


    const pluginName = "SearchableItemShop";

    // --- Helper Function to Parse Game Date ---
    function getGameDateFromVariable() {
        const dateStr = $gameVariables.value(113) || '01 JAN 2001 12:00';
        // Format: "01 JAN 2001 12:00"
        const parts = dateStr.split(' ').filter(Boolean);
        if (parts.length < 4) {
            return { day: 1, month: 0, year: 2001, hours: 8, minutes: 0 };
        }

        const day = parseInt(parts[0]) || 1;
        const monthStr = (parts[1] || '').toUpperCase();
        const year = parseInt(parts[2]) || 2001;
        const timeStr = (parts[3] || '12:00').split(':');
        const hours = parseInt(timeStr[0]) || 0;
        const minutes = parseInt(timeStr[1]) || 0;

        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        let month = months.indexOf(monthStr);
        if (month === -1) {
            const itMonths = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
            month = itMonths.indexOf(monthStr);
        }
        if (month === -1) {
            month = 0;
        }

        return { day, month, year, hours, minutes };
    }

    // --- Helper Function to Convert Game Date to Milliseconds ---
    function gameDateToMilliseconds(dateObj) {
        const jsDate = new Date(dateObj.year, dateObj.month, dateObj.day, dateObj.hours, dateObj.minutes, 0);
        return jsDate.getTime();
    }

    // --- Delivery System Management ---
    const DeliveryManager = {
        getOrderedItems: function () {
            if (!$dataSystem.deliveryOrders) {
                $dataSystem.deliveryOrders = [];
            }
            return $dataSystem.deliveryOrders;
        },

        addOrder: function (item, deliveryTime, price) {
            const orders = this.getOrderedItems();
            const gameDate = getGameDateFromVariable();
            const currentTime = gameDateToMilliseconds(gameDate);
            const deliveryDate = currentTime + (deliveryTime * 24 * 60 * 60 * 1000); // Convert days to milliseconds

            orders.push({
                item: item,
                deliveryDate: deliveryDate,
                price: price,
                orderedAt: currentTime
            });
        },

        getOrderCount: function () {
            return this.getOrderedItems().length;
        },

        isItemOrdered: function (item) {
            const orders = this.getOrderedItems();
            return orders.some(order =>
                order.item.id === item.id &&
                order.item.etypeId === item.etypeId
            );
        },

        getItemDeliveryTime: function (item) {
            const orders = this.getOrderedItems();
            const order = orders.find(order =>
                order.item.id === item.id &&
                order.item.etypeId === item.etypeId
            );

            if (order) {
                const gameDate = getGameDateFromVariable();
                const currentTime = gameDateToMilliseconds(gameDate);
                const timeLeft = order.deliveryDate - currentTime;
                return Math.max(0, Math.ceil(timeLeft / (24 * 60 * 60 * 1000))); // Convert to days
            }
            return 0;
        },

        calculateDeliveryTime: function (price) {
            // Find the most expensive item to set the scale
            const maxPrice = this.getMaxPrice();
            const minDays = 1;
            const maxDays = 7;

            // Calculate delivery time based on price (linear scale)
            const ratio = Math.min(price / maxPrice, 1);
            return Math.max(minDays, Math.ceil(ratio * maxDays));
        },

        getMaxPrice: function () {
            let maxPrice = 10000; // Default fallback

            // Check all items, weapons, and armors to find the maximum price
            for (let i = 1; i < $dataItems.length; i++) {
                const item = $dataItems[i];
                if (item && item.price > maxPrice) {
                    maxPrice = item.price;
                }
            }

            for (let i = 1; i < $dataWeapons.length; i++) {
                const weapon = $dataWeapons[i];
                if (weapon && weapon.price > maxPrice) {
                    maxPrice = weapon.price;
                }
            }

            for (let i = 1; i < $dataArmors.length; i++) {
                const armor = $dataArmors[i];
                if (armor && armor.price > maxPrice) {
                    maxPrice = armor.price;
                }
            }

            return maxPrice;
        },

        retireDeliveredItems: function () {
            const orders = this.getOrderedItems();
            const gameDate = getGameDateFromVariable();
            const currentTime = gameDateToMilliseconds(gameDate);
            const deliveredItems = [];
            const remainingOrders = [];

            for (const order of orders) {
                if (currentTime >= order.deliveryDate) {
                    deliveredItems.push(order);
                } else {
                    remainingOrders.push(order);
                }
            }

            // Update the orders list
            $dataSystem.deliveryOrders = remainingOrders;

            // Add delivered items to inventory
            for (const order of deliveredItems) {
                const item = order.item;
                if (item.stypeId && (item.stypeId === 1 || item.stypeId === 2)) {
                    // Learn skill
                    $gameActors.actor(1).learnSkill(item.id);
                } else {
                    // Add item to inventory
                    $gameParty.gainItem(item, 1);
                }
            }

            return deliveredItems.length;
        }
    };

    // --- Translation Function ---
    // Translates text based on the game's language setting.
    // Uses Italian if ConfigManager.language is "it", otherwise defaults to English.
    const tr = (en, it) => ConfigManager.language === "it" ? it : en;

    // --- Custom Category Translation ---
    // Translates custom category names read from item notes.
    const trCustom = (categoryName) => {
        // The category id stays English (it is matched against the
        // <category:> note tag); only the label is translated.
        const key = 'Stockbusters.category.' + String(categoryName || '');
        return T.has(key) ? T(key) : categoryName;
        return translations[categoryName] || categoryName;
    };

    // --- Dynamic Tax Calculation ---
    // Calculates tax based on the value of game variable 54.
    const calculateDynamicTax = () => {
        const standardValue = 66666;
        const currentValue = $gameVariables.value(53);
        const baseTax = 1.00; // Base 100% tax (minimum)
        const maxTax = 10.00; // Maximum 1000% tax

        const deviation = currentValue - standardValue;
        const percentageDeviation = deviation / standardValue;
        const taxAdjustment = percentageDeviation * 9; // Scale to 0-9 range for 100%-1000%

        const newTax = baseTax + taxAdjustment;

        // The tax can't go below 100% or above 1000%
        return Math.max(baseTax, Math.min(maxTax, newTax));
    };


    //=============================================================================
    // Plugin Parameters
    //=============================================================================
    const parameters = PluginManager.parameters(pluginName);

    //=============================================================================
    // Plugin Commands
    //=============================================================================
    PluginManager.registerCommand(pluginName, "OpenSearchableShop", args => {
        SceneManager.push(Scene_HypernetOS);
        SceneManager.prepareNextScene({ autoLaunch: 'shop' });
    });

    PluginManager.registerCommand(pluginName, "OpenLimitedShop", args => {
        const mapId = $gameMap.mapId();
        const eventId = $gameMap._interpreter.eventId();
        const event = $gameMap.event(eventId);
        const coordinates = event ? [event.x, event.y] : [0, 0];

        let historySeed = 19002001;
        if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
            historySeed = window.HistoryManager.getSeed();
        } else if ($gameSystem && $gameSystem._historySeed !== undefined) {
            historySeed = $gameSystem._historySeed;
        }

        // Create seed string from these parameters
        const seedString = `${mapId}-${coordinates[0]}-${coordinates[1]}-${historySeed}`;

        // Create a limited shop with the seed
        const limitedShopParams = {
            isLimited: true,
            seedString: seedString,
            maxSkills: 6
        };

        SceneManager.push(Scene_HypernetOS);
        SceneManager.prepareNextScene({ autoLaunch: 'app-hypernet-shop', shopParams: limitedShopParams });
    });

    PluginManager.registerCommand(pluginName, "RetireDeliveredItems", args => {
        const deliveredCount = DeliveryManager.retireDeliveredItems();

        if (deliveredCount > 0) {
            $gameMessage.add(T('Stockbusters.text.delivered', { count: deliveredCount }));
            SoundManager.playShop();
        } else {
            $gameMessage.add(T('Stockbusters.text.noItemsReadyForDelivery'));
        }
    });

    //=============================================================================
    // Window_ShopHeader
    //=============================================================================
    function Window_ShopHeader() {
        this.initialize(...arguments);
    }

    Window_ShopHeader.prototype = Object.create(Window_Base.prototype);
    Window_ShopHeader.prototype.constructor = Window_ShopHeader;

    Window_ShopHeader.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.refresh();
    };

    Window_ShopHeader.prototype.refresh = function () {
        this.contents.clear();
        this.contents.fontSize += 6;

        // Show order count
        const orderCount = DeliveryManager.getOrderCount();
        const orderText = T('Stockbusters.text.orderCount', { count: orderCount });

        this.drawText(T('Stockbusters.ui.siteName'), 0, 0, this.width - 200, 'center');
        this.drawText(orderText, this.width - 200, 0, 180, 'right');
        this.contents.fontSize -= 6;
    };

    //=============================================================================
    // Window_ShopTitle - Added new window for category grid title
    //=============================================================================
    function Window_ShopTitle() {
        this.initialize(...arguments);
    }

    Window_ShopTitle.prototype = Object.create(Window_Base.prototype);
    Window_ShopTitle.prototype.constructor = Window_ShopTitle;

    Window_ShopTitle.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.refresh();
    };

    Window_ShopTitle.prototype.refresh = function () {
        this.contents.clear();
        this.contents.fontSize += 8;
        this.drawText(T('Stockbusters.ui.siteName'), 0, 0, this.width - this.padding * 2, 'center');
        this.contents.fontSize += 4;
        this.drawText(T('Stockbusters.text.selectACategory'), 0, this.lineHeight(), this.width - this.padding * 2, 'center');
        this.contents.fontSize -= 12; // Reset to original size
    };

    //=============================================================================
    // Window_CategoryGrid
    //=============================================================================
    function Window_CategoryGrid() {
        this.initialize(...arguments);
    }

    Window_CategoryGrid.prototype = Object.create(Window_Selectable.prototype);
    Window_CategoryGrid.prototype.constructor = Window_CategoryGrid;

    Window_CategoryGrid.prototype.initialize = function (rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._categories = [];
        this._isLimited = false;
        this._availableItemsMap = new Map();
        this.makeCategories();
        this.refresh();
        this.select(0);
        this.activate();
    };

    Window_CategoryGrid.prototype.setLimitedMode = function (isLimited, availableItemsMap) {
        this._isLimited = isLimited;
        this._availableItemsMap = availableItemsMap || new Map();
        this.makeCategories();
        this.refresh();
        this.select(0);
    };

    Window_CategoryGrid.prototype.maxCols = function () {
        return 3;
    };

    Window_CategoryGrid.prototype.colSpacing = function () {
        return 16;
    };

    Window_CategoryGrid.prototype.rowSpacing = function () {
        return 16;
    };

    Window_CategoryGrid.prototype.itemWidth = function () {
        return Math.floor((this.innerWidth - this.colSpacing() * (this.maxCols() - 1)) / this.maxCols());
    };

    Window_CategoryGrid.prototype.itemHeight = function () {
        return 80;
    };

    Window_CategoryGrid.prototype.maxItems = function () {
        return this._categories ? this._categories.length : 0;
    };

    Window_CategoryGrid.prototype.category = function () {
        return this._categories && this.index() >= 0 ? this._categories[this.index()] : null;
    };

    Window_CategoryGrid.prototype.makeCategories = function () {
        // Create all category objects for the grid
        this._categories = [];

        // "All Items" is always included
        this._categories.push({ name: T('Stockbusters.text.allItems'), symbol: "all_items", icon: 209 });

        // Only add categories if not in limited mode or if they have items
        if (!this._isLimited || this._availableItemsMap.get("skills")) {
            this._categories.push({ name: T('Stockbusters.text.skills'), symbol: "skills", icon: 64 });
        }

        if (!this._isLimited || this._availableItemsMap.get("spells")) {
            this._categories.push({ name: T('Stockbusters.text.spells'), symbol: "spells", icon: 101 });
        }

        // Add weapon categories
        if (!this._isLimited || this._availableItemsMap.get("all_weapons")) {
            this._categories.push({ name: T('Stockbusters.text.weapons'), symbol: "all_weapons", icon: 322 });
        }

        const weaponTypes = [
            { name: T('Stockbusters.text.daggers'), symbol: "weapon_1", icon: 326 },
            { name: T('Stockbusters.text.swords'), symbol: "weapon_2", icon: 335 },
            { name: T('Stockbusters.text.heavy'), symbol: "weapon_3", icon: 223 },
            { name: T('Stockbusters.text.axes'), symbol: "weapon_4", icon: 99 },
            { name: T('Stockbusters.text.whips'), symbol: "weapon_5", icon: 353 },
            { name: T('Stockbusters.text.staves'), symbol: "weapon_6", icon: 356 },
            { name: T('Stockbusters.text.bows'), symbol: "weapon_7", icon: 370 },
            { name: T('Stockbusters.text.projectiles'), symbol: "weapon_8", icon: 102 },
            { name: T('Stockbusters.text.guns'), symbol: "weapon_9", icon: 115 },
            { name: T('Stockbusters.text.claws'), symbol: "weapon_10", icon: 292 },
            { name: T('Stockbusters.text.gloves'), symbol: "weapon_11", icon: 142 },
            { name: T('Stockbusters.text.spears'), symbol: "weapon_12", icon: 378 }
        ];

        // Only add weapon types with items in limited mode
        for (const weaponType of weaponTypes) {
            if (!this._isLimited || this._availableItemsMap.get(weaponType.symbol)) {
                this._categories.push(weaponType);
            }
        }

        // Add armor categories
        if (!this._isLimited || this._availableItemsMap.get("all_armors")) {
            this._categories.push({ name: T('Stockbusters.text.equipment'), symbol: "all_armors", icon: 137 });
        }

        const armorTypes = [
            { name: T('Stockbusters.text.generalEquip'), symbol: "armor_1", icon: 136 },
            { name: T('Stockbusters.text.magicEquip'), symbol: "armor_2", icon: 138 },
            { name: T('Stockbusters.text.lightEquip'), symbol: "armor_3", icon: 135 },
            { name: T('Stockbusters.text.heavyEquip'), symbol: "armor_4", icon: 139 },
            { name: T('Stockbusters.text.shields'), symbol: "shields", icon: 125 }
        ];

        // Only add armor types with items in limited mode
        for (const armorType of armorTypes) {
            if (!this._isLimited || this._availableItemsMap.get(armorType.symbol)) {
                this._categories.push(armorType);
            }
        }

        // Add custom categories
        const customCategories = this.collectCustomCategories();

        // Add custom categories only if they have items in limited mode
        for (const category of customCategories) {
            const symbol = "custom_" + category;
            if (!this._isLimited || this._availableItemsMap.get(symbol)) {
                let icon = 245; // Default icon

                // i18n-ignore-start  item-category ids from the <category:> tag
                // Assign specific icons based on category name
                switch (category) {
                    case "Arctic": icon = 67; break;
                    case "Artisan": icon = 188; break;
                    case "Combat": icon = 334; break;
                    case "Collectibles": icon = 210; break;
                    case "Counterfeits": icon = 306; break;
                    case "Enhancers": icon = 179; break;
                    case "Espionage": icon = 130; break;
                    case "Books": icon = 186; break;
                    case "Tools": icon = 83; break;
                    case "Food": icon = 265; break;
                    case "Homeopathy": icon = 273; break;
                    case "Jungle": icon = 277; break;
                    case "Lifestyle": icon = 84; break;
                    case "Magic": icon = 72; break;
                    case "Medical": icon = 176; break;
                    case "Monsters": icon = 293; break;
                    case "Plants": icon = 182; break;
                    case "Recovery": icon = 180; break;
                    case "Survival": icon = 209; break;
                    case "Trash": icon = 289; break;
                    case "Misc": icon = 245; break;
                    // i18n-ignore-end
                }

                this._categories.push({ name: trCustom(category), symbol: symbol, icon: icon });
            }
        }
    };

    // This function is defined twice in the original code. This is the version used by the runtime.
    Window_CategoryGrid.prototype.collectCustomCategories = function () {
        const categories = new Set();

        // Function to extract categories from notes
        const extractCategories = (item) => {
            if (item && item.note) {
                const regex = /<category:([^>]*)>/gi;
                let match;
                while ((match = regex.exec(item.note)) !== null) {
                    categories.add(match[1]);
                }
            }
        };

        // Items
        for (let i = 1; i < $dataItems.length; i++) {
            extractCategories($dataItems[i]);
        }

        // Weapons
        for (let i = 1; i < $dataWeapons.length; i++) {
            extractCategories($dataWeapons[i]);
        }

        // Armors
        for (let i = 1; i < $dataArmors.length; i++) {
            extractCategories($dataArmors[i]);
        }

        return Array.from(categories).sort();
    };

    Window_CategoryGrid.prototype.drawItem = function (index) {
        const category = this._categories[index];
        if (category) {
            const rect = this.itemRect(index);
            const iconBoxWidth = ImageManager.iconWidth + 4;
            this.resetTextColor();

            // Draw icon
            this.drawIcon(category.icon, rect.x + (rect.width - ImageManager.iconWidth) / 2, rect.y + 4);

            // Draw name
            this.contents.fontSize -= 2;
            this.drawText(category.name, rect.x, rect.y + iconBoxWidth, rect.width, 'center');
            this.contents.fontSize += 2;
        }
    };

    Window_CategoryGrid.prototype.refresh = function () {
        this.createContents();
        this.drawAllItems();
    };

    //=============================================================================
    // Window_GridItemList
    //=============================================================================
    function Window_GridItemList() {
        this.initialize(...arguments);
    }

    Window_GridItemList.prototype = Object.create(Window_Selectable.prototype);
    Window_GridItemList.prototype.constructor = Window_GridItemList;

    Window_GridItemList.prototype.initialize = function (rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._data = [];
        this._category = "all_items";
        this._isLimited = false;
        this._limitedItems = [];
        this._seedRNG = null;
        this._maxSkills = 0;
        this.refresh();
        this.select(0);
        this.deactivate();
        this.hide();
    };

    Window_GridItemList.prototype.setLimitedMode = function (isLimited, seedString, maxSkills) {
        this._isLimited = isLimited;
        this._maxSkills = maxSkills;

        if (isLimited && seedString) {
            // Create a seeded random number generator
            this._seedRNG = this.createRNG(seedString);
            this._limitedItems = this.generateLimitedItemSelection();
        }

        this.refresh();
    };

    // Modify the generateLimitedItemSelection method to limit weapons to exactly 7
    Window_GridItemList.prototype.generateLimitedItemSelection = function () {
        const selection = [];
        const availableItemsMap = new Map();

        // Helper function to add items to the selection
        const addToSelection = (items, type, maxCount) => {
            if (!items || items.length === 0) return;

            // Create a copy and shuffle it using the seeded RNG
            const shuffled = [...items];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(this._seedRNG() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            // Take a limited number of items
            const count = Math.min(maxCount, shuffled.length);
            const selectedItems = shuffled.slice(0, count);

            // Add to selection and mark category as having items
            for (const item of selectedItems) {
                // Add null check before accessing item properties
                if (!item) continue;

                selection.push(item);

                // Update the available items map for categories
                if (DataManager.isItem(item) && item.itypeId === 1) {
                    availableItemsMap.set("all_items", true);
                } else if (DataManager.isWeapon(item)) {
                    availableItemsMap.set("all_weapons", true);
                    availableItemsMap.set(`weapon_${item.wtypeId}`, true);
                } else if (DataManager.isArmor(item)) {
                    availableItemsMap.set("all_armors", true);
                    if (item.atypeId === 5 || item.atypeId === 6) {
                        availableItemsMap.set("shields", true);
                    }
                    availableItemsMap.set(`armor_${item.atypeId}`, true);
                } else if (item.stypeId) {
                    if (item.stypeId === 1) {
                        availableItemsMap.set("skills", true);
                    } else if (item.stypeId === 2) {
                        availableItemsMap.set("spells", true);
                    }
                }

                // Check for custom categories
                if (item.note) {
                    const regex = /<category:([^>]*)>/gi;
                    let match;
                    while ((match = regex.exec(item.note)) !== null) {
                        availableItemsMap.set("custom_" + match[1], true);
                    }
                }
            }
        };

        // Get valid items (price > 0 and has name)
        const validItems = [];
        const validWeapons = [];
        const validArmors = [];
        const validSkills = [];
        const validSpells = [];

        // Collect items
        for (let i = 1; i < $dataItems.length; i++) {
            const item = $dataItems[i];
            if (item && item.price > 0 && item.name && item.name.trim() !== '') {
                validItems.push(item);
            }
        }

        // Collect weapons
        for (let i = 1; i < $dataWeapons.length; i++) {
            const weapon = $dataWeapons[i];
            if (weapon && weapon.price > 0 && weapon.name && weapon.name.trim() !== '') {
                validWeapons.push(weapon);
            }
        }

        // Collect armors
        for (let i = 1; i < $dataArmors.length; i++) {
            const armor = $dataArmors[i];
            if (armor && armor.price > 0 && armor.name && armor.name.trim() !== '') {
                validArmors.push(armor);
            }
        }

        // Collect skills and spells
        for (let i = 1; i < $dataSkills.length; i++) {
            const skill = $dataSkills[i];
            if (skill && skill.mpCost > 0 && skill.name && skill.name.trim() !== '' &&
                !$gameActors.actor(1).hasSkill(skill.id)) {
                if (skill.stypeId === 1) {
                    validSkills.push(skill);
                } else if (skill.stypeId === 2) {
                    validSpells.push(skill);
                }
            }
        }

        // Add a selection of each type to the final selection
        addToSelection(validItems, "items", 10 + Math.floor(this._seedRNG() * 10)); // 10-19 items
        addToSelection(validWeapons, "weapons", 7); // Exactly 7 weapons as requested
        addToSelection(validArmors, "armors", 5 + Math.floor(this._seedRNG() * 5)); // 5-9 armors

        // Limited number of skills as specified
        const totalSkills = this._maxSkills;
        const skillCount = Math.min(Math.floor(totalSkills / 2), validSkills.length);
        const spellCount = Math.min(totalSkills - skillCount, validSpells.length);

        addToSelection(validSkills, "skills", skillCount);
        addToSelection(validSpells, "spells", spellCount);

        return { items: selection, categories: availableItemsMap };
    };

    Window_GridItemList.prototype.createRNG = function (seed) {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }

        // Simple RNG function that uses the seed
        return function () {
            hash = (hash * 9301 + 49297) % 233280;
            return hash / 233280;
        };
    };

    Window_GridItemList.prototype.maxCols = function () {
        return 2;
    };

    Window_GridItemList.prototype.colSpacing = function () {
        return 16;
    };

    Window_GridItemList.prototype.rowSpacing = function () {
        return 16;
    };

    Window_GridItemList.prototype.itemWidth = function () {
        return Math.floor((this.innerWidth - this.colSpacing() * (this.maxCols() - 1)) / this.maxCols());
    };

    Window_GridItemList.prototype.itemHeight = function () {
        return 80;
    };

    Window_GridItemList.prototype.maxItems = function () {
        return this._data ? this._data.length : 0;
    };

    Window_GridItemList.prototype.item = function () {
        return this._data && this.index() >= 0 ? this._data[this.index()] : null;
    };

    Window_GridItemList.prototype.setCategory = function (category) {
        if (this._category !== category) {
            this._category = category;
            this.refresh();
            this.scrollTo(0, 0);
            this.select(0);
        }
    };

    Window_GridItemList.prototype.isItemCategoryValid = function (item) {
        if (!item) return false;

        // All items category shows all consumable items
        if (this._category === "all_items") {
            return DataManager.isItem(item) && item.itypeId === 1;
        }

        return false;
    };

    Window_GridItemList.prototype.isWeaponCategoryValid = function (item) {
        if (!DataManager.isWeapon(item)) return false;

        if (this._category === "all_weapons") {
            return true;
        } else if (this._category.startsWith("weapon_")) {
            const typeId = parseInt(this._category.split("_")[1]);
            return item.wtypeId === typeId;
        }

        return false;
    };

    Window_GridItemList.prototype.isArmorCategoryValid = function (item) {
        if (!DataManager.isArmor(item)) return false;

        if (this._category === "all_armors") {
            return true;
        } else if (this._category === "shields") {
            // Combined shields category (types 5 and 6)
            return item.atypeId === 5 || item.atypeId === 6;
        } else if (this._category.startsWith("armor_")) {
            const typeId = parseInt(this._category.split("_")[1]);
            return item.atypeId === typeId;
        }

        return false;
    };

    Window_GridItemList.prototype.hasCustomCategory = function (item, categoryName) {
        if (!item || !item.note) return false;

        const regex = new RegExp("<category:" + categoryName + ">", "i");
        return regex.test(item.note);
    };

    Window_GridItemList.prototype.isSkillCategoryValid = function (item) {
        if (!item) return false;

        // Filter out skills with no MP cost (effectively price=0)
        if (!item.mpCost || item.mpCost === 0) return false;

        // Filter out skills with empty names
        if (!item.name || item.name.trim() === '') return false;

        if (this._category === "skills") {
            return item.stypeId === 1 && !$gameActors.actor(1).hasSkill(item.id);
        } else if (this._category === "spells") {
            return item.stypeId === 2 && !$gameActors.actor(1).hasSkill(item.id);
        }

        return false;
    };

    // Modify the includes method to only show selected items in limited mode
    Window_GridItemList.prototype.includes = function (item) {
        if (!item) return false;

        // Filter out items with price 0 or empty names
        if (item.price === 0 || !item.name || item.name.trim() === '') {
            return false;
        }

        // In limited mode, only include items that are in the limited selection
        if (this._isLimited) {
            const limitedItems = this._limitedItems.items || [];
            return limitedItems.includes(item) && this.categoryMatches(item);
        }

        // Custom category handling
        if (this._category.startsWith("custom_")) {
            const categoryName = this._category.replace("custom_", "");
            return this.hasCustomCategory(item, categoryName);
        }

        // Check item category
        if (this.isItemCategoryValid(item)) return true;

        // Check weapon category
        if (this.isWeaponCategoryValid(item)) return true;

        // Check armor category
        if (this.isArmorCategoryValid(item)) return true;

        // Check skill category
        if (this.isSkillCategoryValid(item)) return true;

        return false;
    };

    Window_GridItemList.prototype.categoryMatches = function (item) {
        // Custom category handling
        if (this._category.startsWith("custom_")) {
            const categoryName = this._category.replace("custom_", "");
            return this.hasCustomCategory(item, categoryName);
        }

        // Check item category
        if (this._category === "all_items" && DataManager.isItem(item) && item.itypeId === 1) {
            return true;
        }

        // Check weapon category
        if (this._category === "all_weapons" && DataManager.isWeapon(item)) {
            return true;
        } else if (this._category.startsWith("weapon_") && DataManager.isWeapon(item)) {
            const typeId = parseInt(this._category.split("_")[1]);
            return item.wtypeId === typeId;
        }

        // Check armor category
        if (this._category === "all_armors" && DataManager.isArmor(item)) {
            return true;
        } else if (this._category === "shields" && DataManager.isArmor(item)) {
            return item.atypeId === 5 || item.atypeId === 6;
        } else if (this._category.startsWith("armor_") && DataManager.isArmor(item)) {
            const typeId = parseInt(this._category.split("_")[1]);
            return item.atypeId === typeId;
        }

        // Check skill category
        if (this._category === "skills" && item.stypeId === 1) {
            return true;
        } else if (this._category === "spells" && item.stypeId === 2) {
            return true;
        }

        return false;
    };

    // Modify makeItemList to handle limited mode more directly
    Window_GridItemList.prototype.makeItemList = function () {
        this._data = [];

        if (this._isLimited) {
            // In limited mode, filter from pre-selected items based on current category
            const items = this._limitedItems.items || [];

            for (const item of items) {
                if (this.categoryMatches(item)) {
                    this._data.push(item);
                }
            }
        } else {
            // Original code for normal mode
            // For custom categories, check all item types
            if (this._category.startsWith("custom_")) {
                const categoryName = this._category.replace("custom_", "");

                // Check items
                for (let i = 1; i < $dataItems.length; i++) {
                    const item = $dataItems[i];
                    if (item && this.hasCustomCategory(item, categoryName)) {
                        // Filter out items with price 0 or empty names
                        if (item.price === 0 || !item.name || item.name.trim() === '') {
                            continue;
                        }
                        this._data.push(item);
                    }
                }

                // Check weapons
                for (let i = 1; i < $dataWeapons.length; i++) {
                    const weapon = $dataWeapons[i];
                    if (weapon && this.hasCustomCategory(weapon, categoryName)) {
                        // Filter out weapons with price 0 or empty names
                        if (weapon.price === 0 || !weapon.name || weapon.name.trim() === '') {
                            continue;
                        }
                        this._data.push(weapon);
                    }
                }

                // Check armors
                for (let i = 1; i < $dataArmors.length; i++) {
                    const armor = $dataArmors[i];
                    if (armor && this.hasCustomCategory(armor, categoryName)) {
                        // Filter out armors with price 0 or empty names
                        if (armor.price === 0 || !armor.name || armor.name.trim() === '') {
                            continue;
                        }
                        this._data.push(armor);
                    }
                }
            } else {
                // Add items if category is relevant
                if (this._category === "all_items") {
                    for (let i = 1; i < $dataItems.length; i++) {
                        const item = $dataItems[i];
                        if (item && this.includes(item)) {
                            this._data.push(item);
                        }
                    }
                }

                // Add weapons if category is relevant
                if (this._category === "all_weapons" || this._category.startsWith("weapon_")) {
                    for (let i = 1; i < $dataWeapons.length; i++) {
                        const weapon = $dataWeapons[i];
                        if (weapon && this.includes(weapon)) {
                            this._data.push(weapon);
                        }
                    }
                }

                // Add armors if category is relevant
                if (this._category === "all_armors" || this._category === "shields" || this._category.startsWith("armor_")) {
                    for (let i = 1; i < $dataArmors.length; i++) {
                        const armor = $dataArmors[i];
                        if (armor && this.includes(armor)) {
                            this._data.push(armor);
                        }
                    }
                }

                // Add skills if category is skills or spells
                if (this._category === "skills" || this._category === "spells") {
                    for (let i = 1; i < $dataSkills.length; i++) {
                        const skill = $dataSkills[i];
                        if (skill && this.includes(skill)) {
                            this._data.push(skill);
                        }
                    }
                }
            }
        }

        // Sort items by price
        this.sortItemsByPrice();
    };

    Window_GridItemList.prototype.sortItemsByPrice = function () {
        if (!this._data || this._data.length === 0) return;

        this._data.sort((a, b) => {
            const priceA = this.getItemRawPrice(a);
            const priceB = this.getItemRawPrice(b);
            return priceA - priceB; // Sort from lowest to highest price
        });
    };

    Window_GridItemList.prototype.getItemRawPrice = function (item) {
        if (!item) return 0;

        if (this._isLimited) {
            // In limited mode, use the original price without modifications
            if (item.stypeId && (item.stypeId === 1 || item.stypeId === 2)) {
                return (item.mpCost || 0) * 1000 + 1000;
            } else {
                return item.price;
            }
        } else {
            // Original code for normal mode
            if (this._category === "skills" || this._category === "spells" || (item.stypeId && (item.stypeId === 1 || item.stypeId === 2))) {
                // Calculate price for skills with 60% discount
                const mpCost = item.mpCost || 0;
                const basePrice = (mpCost * 1000) + 1000;
                return Math.floor(basePrice * 0.4);
            } else {
                // Apply dynamic tax for all non-skill items
                const tax = calculateDynamicTax();
                return Math.floor(item.price * (1 + tax));
            }
        }
    };


    Window_GridItemList.prototype.drawItem = function (index) {
        const item = this._data[index];
        if (item) {
            const rect = this.itemRect(index);
            const iconBoxWidth = ImageManager.iconWidth + 4;
            this.resetTextColor();

            // Check if item is already ordered
            const isOrdered = DeliveryManager.isItemOrdered(item);
            if (isOrdered) {
                this.changePaintOpacity(0.6);
            }

            this.drawIcon(item.iconIndex, rect.x + 2, rect.y + 2);

            // Draw item name with reduced width to fit
            const nameWidth = rect.width - iconBoxWidth - 4;
            const itemName = item.name;

            // Calculate available space based on smaller font
            this.contents.fontSize -= 2;
            const maxChars = Math.floor(nameWidth / (this.textWidth("A") * 1.1));
            const truncatedName = itemName.length > maxChars
                ? itemName.substring(0, maxChars - 3) + "..."
                : itemName;

            this.drawText(truncatedName, rect.x + iconBoxWidth, rect.y, nameWidth);

            // Draw price below name with smaller font
            const priceText = this.getPriceText(item);
            this.drawText(priceText, rect.x + iconBoxWidth, rect.y + this.lineHeight() * 1.2, nameWidth, 'right');

            // Draw "ORDERED" if item is ordered
            if (isOrdered) {
                const orderedText = T('Stockbusters.text.ordered');
                this.changeTextColor(this.systemColor());
                this.drawText(orderedText, rect.x + iconBoxWidth, rect.y + this.lineHeight() * 0.6, nameWidth, 'left');
                this.resetTextColor();
            }

            this.contents.fontSize += 2;
            this.changePaintOpacity(true);
        }
    };

    Window_GridItemList.prototype.getPriceText = function (item) {
        if (!item) return "";

        const formatPrice = (value) => {
            const euros = (value / 100).toFixed(2);
            return (euros.endsWith(".00") ? parseInt(euros) : euros) + " €";
        };
        if (this._isLimited) {
            // In limited mode, show raw prices without tax/discount mentions
            if (item.stypeId && (item.stypeId === 1 || item.stypeId === 2)) {
                const basePrice = (item.mpCost * 1000) + 1000;
                return formatPrice(basePrice);
            } else {
                return formatPrice(item.price);
            }
        } else {
            // Original code for normal mode
            if (this._category === "skills" || this._category === "spells") {
                const mpCost = item.mpCost || 0;
                const basePrice = (mpCost * 1000) + 1000;
                const discountedPrice = Math.floor(basePrice * 0.4);
                return formatPrice(discountedPrice);
            } else {
                const tax = calculateDynamicTax();
                const increasedPrice = Math.floor(item.price * (1 + tax));
                return formatPrice(increasedPrice);
            }
        }
    };


    Window_GridItemList.prototype.refresh = function () {
        this.makeItemList();
        this.createContents();
        this.drawAllItems();
    };

    Window_GridItemList.prototype.updateHelp = function () {
        if (this.item()) {
            this._helpWindow.setItem(this.item());
        }
    };

    //=============================================================================
    // Window_BuyConfirmation
    //=============================================================================
    function Window_BuyConfirmation() {
        this.initialize(...arguments);
    }

    Window_BuyConfirmation.prototype = Object.create(Window_Command.prototype);
    Window_BuyConfirmation.prototype.constructor = Window_BuyConfirmation;

    Window_BuyConfirmation.prototype.initialize = function (rect) {
        const adjustedRect = new Rectangle(rect.x, rect.y, rect.width, rect.height + 120);
        Window_Command.prototype.initialize.call(this, adjustedRect);
        this._item = null;
        this._isSkill = false;
        this._isLimited = false;
        this.openness = 0;
        this.deactivate();
    };

    Window_BuyConfirmation.prototype.setLimitedMode = function (isLimited) {
        this._isLimited = isLimited;
    };

    Window_BuyConfirmation.prototype.makeCommandList = function () {
        const isOrdered = this._item && DeliveryManager.isItemOrdered(this._item);
        const maxOrdersReached = DeliveryManager.getOrderCount() >= 6;
        const canAfford = this._item && $gameParty.gold() >= this.getItemPrice();

        if (isOrdered) {
            // If item is already ordered, show delivery time instead of buy option
            const deliveryTime = DeliveryManager.getItemDeliveryTime(this._item);
            const timeText = deliveryTime > 0
                ? T('Stockbusters.text.arrivesInDays', { days: deliveryTime })
                : T('Stockbusters.text.readyForPickup');
            this.addCommand(timeText, "delivery_info", false);
        } else {
            // Show buy option with appropriate enabled state
            const enabled = canAfford && !maxOrdersReached;
            const buttonText = this._isLimited
                ? T('Stockbusters.text.buy')
                : T('Stockbusters.text.order');
            this.addCommand(buttonText, "buy", enabled);
        }

        this.addCommand(T('Stockbusters.text.cancel'), "cancel");
    };

    Window_BuyConfirmation.prototype.getItemPrice = function () {
        if (!this._item) return 0;

        if (this._isLimited) {
            // In limited mode, use raw prices
            if (this._isSkill) {
                const mpCost = this._item.mpCost || 0;
                return (mpCost * 1000) + 1000;
            } else {
                return this._item.price;
            }
        } else {
            // Original code for normal mode
            if (this._isSkill) {
                // Apply 60% discount for skills
                const mpCost = this._item.mpCost || 0;
                const basePrice = (mpCost * 1000) + 1000;
                return Math.floor(basePrice * 0.4);
            } else {
                // Apply dynamic tax for all non-skill items, then whatever the
                // party's Haggling is worth against it (see SpecializationXP).
                const tax = calculateDynamicTax();
                const haggle = window.SpecializationXP
                    ? window.SpecializationXP.discount('Haggling', 0.05, 0.75) : 1;
                return Math.max(1, Math.floor(this._item.price * (1 + tax) * haggle));
            }
        }
    };

    Window_BuyConfirmation.prototype.itemRect = function (index) {
        const rect = Window_Selectable.prototype.itemRect.call(this, index);
        rect.y += 350;
        return rect;
    };

    Window_BuyConfirmation.prototype.buttonY = function () {
        return this.innerHeight - this.lineHeight();
    };

    Window_BuyConfirmation.prototype.setItem = function (item, isSkill) {
        this._item = item;
        this._isSkill = isSkill;
        this.refresh();
    };

    Window_BuyConfirmation.prototype.drawItem = function (index) {
        const rect = this.itemLineRect(index);
        const align = index === 0 ? 'center' : 'center';
        this.resetTextColor();
        this.changePaintOpacity(this.isCommandEnabled(index));
        this.drawText(this.commandName(index), rect.x, rect.y, rect.width, align);
    };

    Window_BuyConfirmation.prototype.refresh = function () {
        Window_Command.prototype.refresh.call(this);
        if (this._item) {
            const itemY = this.padding;
            const nameY = itemY;
            const descY = nameY + this.lineHeight() * 1.2;
            const priceY = descY + this.lineHeight() * 3.5;
            const canAfford = $gameParty.gold() >= this.getItemPrice();
            const isOrdered = DeliveryManager.isItemOrdered(this._item);
            const maxOrdersReached = DeliveryManager.getOrderCount() >= 6;

            const formatPrice = (value) => {
                const str = (value / 100).toFixed(2);
                return str.endsWith(".00") ? parseInt(str) + " €" : str + " €";
            };

            // Draw item icon and name
            this.drawIcon(this._item.iconIndex, 10, itemY);
            this.drawText(this._item.name, 50, itemY, this.innerWidth - 60, 'left');

            // Draw item description with word wrap, then the combinatorial
            // world-seeded lore under it in a dimmer tone.
            const description = window.translateText ? window.translateText(this._item.description) : this._item.description;
            const usedLines = this.drawItemDescription(description, 10, descY, this.innerWidth - 20);
            if (window.ItemSystemUtils && typeof window.ItemSystemUtils.loreFor === 'function') {
                const loreText = window.ItemSystemUtils.loreFor(this._item);
                if (loreText) {
                    this.changePaintOpacity(false);
                    this.drawItemDescription(loreText, 10, descY + (usedLines + 1) * this.lineHeight(), this.innerWidth - 20);
                    this.changePaintOpacity(true);
                }
            }

            // Draw horizontal line
            const lineY = priceY - this.lineHeight() / 2;
            this.contents.fillRect(10, lineY, this.innerWidth - 20, 2, this.systemColor());

            // Draw price or delivery info
            this.changePaintOpacity(canAfford);
            let priceText;

            if (isOrdered) {
                // Show delivery information
                const deliveryTime = DeliveryManager.getItemDeliveryTime(this._item);
                if (deliveryTime.value > 0) {
                    if (deliveryTime.unit === 'hours') {
                        priceText = T('Stockbusters.text.arrivesInHours', { hours: deliveryTime.value });
                    } else {
                        priceText = T('Stockbusters.text.arrivesInMinutes', { minutes: deliveryTime.value });
                    }
                } else {
                    priceText = T('Stockbusters.text.thisItemIsReadyFor');
                }
            } else {
                // Show price and delivery time
                const price = this.getItemPrice();
                const deliveryMinutes = DeliveryManager.calculateDeliveryTime(price);

                let deliveryText;
                if (deliveryMinutes >= 60) {
                    const hours = Math.ceil(deliveryMinutes / 60);
                    deliveryText = T('Stockbusters.text.deliveryHours', { hours: hours });
                } else {
                    deliveryText = T('Stockbusters.text.deliveryMinutes', { minutes: deliveryMinutes });
                }

                if (this._isLimited) {
                    // In limited mode, show raw prices without discount/tax
                    const priceString = formatPrice(price);
                    priceText = this._isSkill
                        ? T('Stockbusters.text.learningCost') + priceString
                        : T('Stockbusters.text.price') + priceString;
                } else {
                    // Normal mode with discount/tax
                    const priceString = formatPrice(price);
                    if (this._isSkill) {
                        priceText = T('Stockbusters.text.learningCost') + priceString + T('Stockbusters.text.60Off');
                    } else {
                        const tax = calculateDynamicTax();
                        const taxPercentage = Math.round(tax * 100);
                        const taxText = T('Stockbusters.text.taxSuffix', { percent: taxPercentage });
                        priceText = T('Stockbusters.text.price') + priceString + taxText;
                    }
                }

                priceText += deliveryText;
            }

            this.drawText(priceText, 0, priceY, this.innerWidth, 'center');
            this.changePaintOpacity(true);

            // Draw current gold and order status
            const goldY = priceY + this.lineHeight() * 2;
            this.drawText(T('Stockbusters.text.yourMoney') + formatPrice($gameParty.gold()), 0, goldY, this.innerWidth, 'center');

            const orderStatusY = goldY + this.lineHeight();
            const orderCount = DeliveryManager.getOrderCount();
            this.drawText(T('Stockbusters.text.orderCount', { count: orderCount }), 0, orderStatusY, this.innerWidth, 'center');

            // Show warning if max orders reached
            if (maxOrdersReached && !isOrdered) {
                const warningY = orderStatusY + this.lineHeight();
                this.changeTextColor(ColorManager.textColor(2)); // Red color
                this.drawText(T('Stockbusters.text.maximumOrdersReached'), 0, warningY, this.innerWidth, 'center');
                this.resetTextColor();
            }
        }
    };

    // Returns how many lines were drawn, so a caller can stack a second block
    // (the lore) underneath.
    Window_BuyConfirmation.prototype.drawItemDescription = function (text, x, y, width, maxLines) {
        if (!text) return 0;

        const lineHeight = this.lineHeight();
        maxLines = maxLines || 6;

        this.contents.fontSize -= 2;

        // Split text into words
        const words = text.split(' ');
        let line = '';
        let lineCount = 0;

        for (let i = 0; i < words.length; i++) {
            const testLine = line + words[i] + ' ';
            const testWidth = this.textWidth(testLine);

            if (testWidth > width) {
                this.drawText(line, x, y + lineCount * lineHeight, width);
                line = words[i] + ' ';
                lineCount++;

                if (lineCount >= maxLines - 1 && i < words.length - 1) {
                    line = line.trim() + '...';
                    this.drawText(line, x, y + lineCount * lineHeight, width);
                    break;
                }
            } else {
                line = testLine;
            }
        }

        if (line && lineCount < maxLines) {
            this.drawText(line, x, y + lineCount * lineHeight, width);
            lineCount++;
        }

        this.contents.fontSize += 2;
        return lineCount;
    };

    //=============================================================================
    // Scene_SearchableShop
    //=============================================================================
    function Scene_SearchableShop() {
        this.initialize(...arguments);
    }

    Scene_SearchableShop.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_SearchableShop.prototype.constructor = Scene_SearchableShop;

    Scene_SearchableShop.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
        this._isLimited = false;
        this._seedString = "";
        this._maxSkills = 0;
    };

    Scene_SearchableShop.prototype.prepare = function (params) {
        if (params) {
            this._isLimited = params.isLimited || false;
            this._seedString = params.seedString || "";
            this._maxSkills = params.maxSkills || 0;
        }
    };

    // Modify create to pass limited mode parameters and establish the D&D overlay
    Scene_SearchableShop.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createHeaderWindow();
        this.createCategoryGridWindow();
        this.createItemListWindow();
        this.createBuyConfirmationWindow();

        // Hide standard MZ canvas windows
        if (this._helpWindow) this._helpWindow.visible = false;
        if (this._headerWindow) this._headerWindow.visible = false;
        if (this._categoryGridWindow) this._categoryGridWindow.visible = false;
        if (this._itemListWindow) this._itemListWindow.visible = false;
        if (this._buyWindow) this._buyWindow.visible = false;

        // Set limited mode if needed
        if (this._isLimited) {
            this._itemListWindow.setLimitedMode(true, this._seedString, this._maxSkills);
            const availableCategories = this._itemListWindow._limitedItems.categories;
            this._categoryGridWindow.setLimitedMode(true, availableCategories);
            this._buyWindow.setLimitedMode(true);
        }

        // Activate initial stage
        this._categoryGridWindow.activate();
        this._itemListWindow.deactivate();
        this._itemListWindow.hide();

        this.createUIShopDOM();
    };

    Scene_SearchableShop.prototype.createHeaderWindow = function () {
        const rect = this.headerWindowRect();
        this._headerWindow = new Window_ShopHeader(rect);
        this.addWindow(this._headerWindow);
    };

    Scene_SearchableShop.prototype.headerWindowRect = function () {
        const wx = 0;
        const wy = this.helpWindowRect().height;
        const ww = Graphics.boxWidth;
        const wh = this.calcWindowHeight(1, false);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_SearchableShop.prototype.createCategoryGridWindow = function () {
        const rect = this.categoryGridWindowRect();
        this._categoryGridWindow = new Window_CategoryGrid(rect);
        this._categoryGridWindow.setHandler("ok", this.onCategoryOk.bind(this));
        this._categoryGridWindow.setHandler("cancel", this.popScene.bind(this));
        this.addWindow(this._categoryGridWindow);
    };

    Scene_SearchableShop.prototype.categoryGridWindowRect = function () {
        const wx = 0;
        const wy = 0;
        const ww = Graphics.boxWidth;
        const wh = Graphics.boxHeight;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_SearchableShop.prototype.createItemListWindow = function () {
        const rect = this.itemListWindowRect();
        this._itemListWindow = new Window_GridItemList(rect);
        this._itemListWindow.setHelpWindow(this._helpWindow);
        this._itemListWindow.setHandler("ok", this.onItemOk.bind(this));
        this._itemListWindow.setHandler("cancel", this.onItemCancel.bind(this));
        this.addWindow(this._itemListWindow);
    };

    Scene_SearchableShop.prototype.itemListWindowRect = function () {
        const wx = 0;
        const wy = 0;
        const ww = Graphics.boxWidth;
        const wh = Graphics.boxHeight;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_SearchableShop.prototype.createBuyConfirmationWindow = function () {
        const rect = this.buyConfirmationWindowRect();
        this._buyWindow = new Window_BuyConfirmation(rect);
        this._buyWindow.setHandler("buy", this.onBuyOk.bind(this));
        this._buyWindow.setHandler("delivery_info", this.onDeliveryInfo.bind(this));
        this._buyWindow.setHandler("cancel", this.onBuyCancel.bind(this));
        this.addWindow(this._buyWindow);
    };

    Scene_SearchableShop.prototype.buyConfirmationWindowRect = function () {
        const ww = 600;
        const wh = this.calcWindowHeight(12, true);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = (Graphics.boxHeight - wh) / 2;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_SearchableShop.prototype.onCategoryOk = function () {
        const category = this._categoryGridWindow.category();
        if (category) {
            this._categoryGridWindow.hide();
            this._categoryGridWindow.deactivate();
            this._helpWindow.show();
            this._headerWindow.show();
            this._itemListWindow.setCategory(category.symbol);
            this._itemListWindow.show();
            this._itemListWindow.activate();
            this._itemListWindow.select(0);
            this.refreshUIShopDOM();
        }
    };

    Scene_SearchableShop.prototype.onItemOk = function () {
        const item = this._itemListWindow.item();
        const isSkill = this._itemListWindow._category === "skills" || this._itemListWindow._category === "spells";

        if (item) {
            this._buyWindow.setItem(item, isSkill);
            this._buyWindow.open();
            this._buyWindow.activate();
            this._buyWindow.select(0);
            this.refreshUIShopDOM();
        }
    };

    Scene_SearchableShop.prototype.onItemCancel = function () {
        this._itemListWindow.hide();
        this._itemListWindow.deactivate();
        this._helpWindow.hide();
        this._headerWindow.hide();
        this._categoryGridWindow.show();
        this._categoryGridWindow.activate();
        this.refreshUIShopDOM();
    };

    Scene_SearchableShop.prototype.onBuyOk = function () {
        const item = this._itemListWindow.item();
        if (item) {
            const price = this._buyWindow.getItemPrice();

            if (price > $gameParty.gold()) {
                SoundManager.playBuzzer();
                this._buyWindow.close();
                this._itemListWindow.activate();
                this.refreshUIShopDOM();
                return;
            }

            if (!this._isLimited) {
                if (DeliveryManager.getOrderCount() >= 6) {
                    SoundManager.playBuzzer();
                    this._buyWindow.close();
                    this._itemListWindow.activate();
                    this.refreshUIShopDOM();
                    return;
                }

                if (DeliveryManager.isItemOrdered(item)) {
                    SoundManager.playBuzzer();
                    this._buyWindow.close();
                    this._itemListWindow.activate();
                    this.refreshUIShopDOM();
                    return;
                }
            }

            $gameParty.loseGold(price);
            // Buying teaches Haggling, scaled by what the deal was worth.
            if (window.SpecializationXP) {
                window.SpecializationXP.awardForValue('Haggling', price);
            }
            const isSkill = this._itemListWindow._category === "skills" || this._itemListWindow._category === "spells";

            if (this._isLimited) {
                if (isSkill) {
                    $gameActors.actor(1).learnSkill(item.id);
                } else {
                    $gameParty.gainItem(item, 1);
                }
                SoundManager.playShop();
            } else {
                const deliveryTime = DeliveryManager.calculateDeliveryTime(price);
                DeliveryManager.addOrder(item, deliveryTime, price);
                SoundManager.playShop();
            }

            this._buyWindow.close();
            this._itemListWindow.refresh();
            this._headerWindow.refresh();
            this._itemListWindow.activate();
            this.refreshUIShopDOM();
        }
    };

    Scene_SearchableShop.prototype.onDeliveryInfo = function () {
        this._buyWindow.close();
        this._itemListWindow.activate();
        this.refreshUIShopDOM();
    };

    Scene_SearchableShop.prototype.onBuyCancel = function () {
        this._buyWindow.close();
        this._itemListWindow.activate();
        this.refreshUIShopDOM();
    };

    Scene_SearchableShop.prototype.terminate = function () {
        Scene_MenuBase.prototype.terminate.call(this);
        if (this._dndContainer) {
            const container = this._dndContainer;
            container.style.transition = "opacity 0.2s ease-out";
            container.style.opacity = "0";
            container.style.pointerEvents = "none";
            setTimeout(() => {
                if (container && container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }, 200);
            this._dndContainer = null;
        }
    };

    // --- DOM Creation and Rendering Methods ---

    function getIconSpriteHTML(iconIndex, size = 32) {
        if (!iconIndex) return `<div style="width:${size}px; height:${size}px; display:inline-block; flex-shrink:0;"></div>`;
        const cols = 16;
        const col = iconIndex % cols;
        const row = Math.floor(iconIndex / cols);
        const posX = -(col * 32);
        const posY = -(row * 32);
        return `
            <div style="width: ${size}px; height: ${size}px; overflow: hidden; display: inline-block; position: relative; flex-shrink: 0; border-radius: 4px; vertical-align: middle;">
                <div style="
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 512px;
                    height: 2048px;
                    background-image: url('img/system/IconSet.png');
                    background-position: ${posX}px ${posY}px;
                    background-repeat: no-repeat;
                    transform: scale(${size / 32});
                    transform-origin: 0 0;
                "></div>
            </div>
        `;
    }

    Scene_SearchableShop.prototype.createUIShopDOM = function () {
        this._dndContainer = document.createElement('div');
        this._dndContainer.id = 'menu-container';
        this._dndContainer.style.width = '100%';
        this._dndContainer.style.height = '100%';
        this._dndContainer.style.display = 'flex';
        this._dndContainer.style.flexDirection = 'column';
        this._dndContainer.style.fontFamily = "'Tahoma', sans-serif";
        this._dndContainer.style.color = '#000';
        this._dndContainer.style.boxSizing = 'border-box';

        const parent = document.getElementById('emporium-content');
        if (parent) {
            parent.appendChild(this._dndContainer);
        } else {
            // Fallback for non-app mode
            this._dndContainer.style.position = 'absolute';
            this._dndContainer.style.top = '0';
            this._dndContainer.style.left = '0';
            this._dndContainer.style.zIndex = '1000';
            this._dndContainer.style.background = '#ece9d8';
            document.body.appendChild(this._dndContainer);
        }

        // Initialize empty structure so we don't redraw everything later
        this._dndContainer.innerHTML = `
            <div style="background: #d3e5fa; padding: 6px 12px; border-bottom: 1px solid #7f9db9; font-size: 11px; font-weight: bold; color: #0b2f70; display: flex; justify-content: space-between; align-items: center; user-select: none; box-sizing: border-box; height: 28px;">
                <span>${this._isLimited ? T('Stockbusters.text.theArchmageSBazaar') : T('Stockbusters.text.stockbustersOnlineWares')}</span>
                <span id="emporium-gold-display" style="color: #27ae60; font-size: 12px; font-weight: 700;">0 €</span>
            </div>
            <div style="display: flex; flex: 1; overflow: hidden; height: calc(100% - 28px); box-sizing: border-box;">
                <!-- Left Sidebar Categories -->
                <div id="emporium-left-page" style="width: 190px; min-width: 190px; padding: 12px; border-right: 1px solid #7f9db9; background: #ece9d8; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; overflow-y: auto; user-select: none; height: 100%;"></div>
                <!-- Right Main Content Panel -->
                <div id="emporium-right-page" style="flex: 1; padding: 12px; overflow-y: auto; background: #ffffff; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; height: 100%;"></div>
            </div>
            <div id="emporium-modal-overlay" style="display: none; position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.5); z-index: 2000; justify-content: center; align-items: center;">
                <div id="emporium-modal-content" style="background: #ece9d8; border: 3px solid #0054e3; border-radius: 4px; padding: 20px; width: 400px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: 'Tahoma', sans-serif; font-size: 12px;"></div>
            </div>
        `;
        
        this._lastStage = null;
        this.refreshUIShopDOM();
    };

    Scene_SearchableShop.prototype.refreshUIShopDOM = function () {
        if (!this._dndContainer) return;

        let stage = 'category';
        if (this._buyWindow && this._buyWindow.isOpen() && this._buyWindow.active) {
            stage = 'confirm';
        } else if (this._itemListWindow && this._itemListWindow.visible && this._itemListWindow.active) {
            stage = 'item';
        }

        const formatPrice = (value) => {
            const euros = (value / 100).toFixed(2);
            return (euros.endsWith(".00") ? parseInt(euros) : euros) + " €";
        };

        const activeGold = $gameParty.gold();
        const activeOrdersCount = DeliveryManager.getOrderCount();

        const goldDisplay = document.getElementById('emporium-gold-display');
        if (goldDisplay) {
            goldDisplay.innerText = `${T('Stockbusters.text.gold')}: ${formatPrice(activeGold)}`;
        }

        let leftPageHTML = "";
        let rightPageHTML = "";
        
        const modalOverlay = document.getElementById('emporium-modal-overlay');
        const modalContent = document.getElementById('emporium-modal-content');

        const categories = this._categoryGridWindow._categories || [];
        const selectedIndex = this._categoryGridWindow.index();

        if (stage === 'category') {
            let gridHTML = `<div style="font-weight: bold; font-size: 10px; text-transform: uppercase; color: #5c6c8c; margin-bottom: 6px; letter-spacing: 0.5px;">${T('Stockbusters.ui.catalogCategories')}</div>`;
            categories.forEach((cat, idx) => {
                const isSelected = idx === selectedIndex;
                const bg = isSelected ? '#316ac5' : 'transparent';
                const color = isSelected ? '#ffffff' : '#333333';
                const border = isSelected ? '1px solid #1a3c75' : '1px solid transparent';
                
                gridHTML += `
                    <div style="padding: 8px 12px; margin-bottom: 3px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 3px; background: ${bg}; color: ${color}; border: ${border}; box-sizing: border-box; transition: background 0.1s;" onclick="if(window.HypercapitalisEmporiumApp && window.HypercapitalisEmporiumApp.appInstance) window.HypercapitalisEmporiumApp.appInstance.selectCategoryItem(${idx})">
                        ${getIconSpriteHTML(cat.icon, 20)}
                        <span style="font-weight: bold; font-size: 11px;">${cat.name}</span>
                    </div>
                `;
            });
            leftPageHTML = gridHTML;

            // Active Deliveries
            const orders = DeliveryManager.getOrderedItems() || [];
            let ordersHTML = "";

            if (orders.length === 0) {
                ordersHTML = `<div style="text-align: center; color: #666; margin-top: 15px; font-size: 11px; font-style: italic;">${T('Stockbusters.text.noActiveDeliveriesInTransit')}</div>`;
            } else {
                const gameDate = getGameDateFromVariable();
                const currentTime = gameDateToMilliseconds(gameDate);

                orders.forEach((order) => {
                    const timeLeft = order.deliveryDate - currentTime;
                    const daysLeft = Math.max(0, Math.ceil(timeLeft / (24 * 60 * 60 * 1000)));
                    const timeLabel = daysLeft > 0 ? T('Stockbusters.text.daysLeft', { days: daysLeft }) : T('Stockbusters.text.readyForPickup');
                    const timeColor = daysLeft > 0 ? '#0054e3' : '#27ae60';

                    ordersHTML += `
                        <div style="border: 1px solid #c5c2af; border-radius: 4px; padding: 6px 10px; margin-bottom: 6px; background: #fdfcfa; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05); box-sizing: border-box;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                ${getIconSpriteHTML(order.item.iconIndex, 20)}
                                <strong style="font-size: 11.5px; color: #333;">${order.item.name}</strong>
                            </div>
                            <span style="font-size: 10.5px; color: ${timeColor}; font-weight: bold;">${timeLabel}</span>
                        </div>
                    `;
                });
            }

            rightPageHTML = `
                <div style="display: flex; flex-direction: column; gap: 15px; height: 100%; box-sizing: border-box; overflow-y: auto; width: 100%;">
                    <div style="border-bottom: 1px solid #7f9db9; padding-bottom: 10px;">
                        <h2 style="margin: 0 0 4px 0; color: #0b2f70; font-size: 15px; font-weight: bold;">${T('Stockbusters.text.emporiumCatalogRegistry')}</h2>
                        <div style="color: #666; font-size: 11px;">${T('Stockbusters.text.welcomeToTheChronostaticAlchemical')}</div>
                    </div>
                    
                    <div style="background: #fdfdfd; border: 1px dashed #7f9db9; border-radius: 4px; padding: 12px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.02); box-sizing: border-box;">
                        <h3 style="margin: 0 0 10px 0; color: #0b2f70; font-size: 12px; font-weight: bold; display: flex; align-items: center; gap: 6px;">
                            ${T('Stockbusters.text.activeOrders')} <span style="font-size: 11px; font-weight: normal; color: #666;">(${activeOrdersCount}/6)</span>
                        </h3>
                        ${ordersHTML}
                    </div>
                </div>
            `;
            
            modalOverlay.style.display = 'none';

        } else if (stage === 'item' || stage === 'confirm') {
            const category = this._categoryGridWindow.category();
            const items = this._itemListWindow._data || [];
            const selectedIndex = this._itemListWindow.index();

            let gridHTML = `<div style="font-weight: bold; font-size: 10px; text-transform: uppercase; color: #5c6c8c; margin-bottom: 6px; letter-spacing: 0.5px;">${T('Stockbusters.ui.catalogCategories')}</div>`;
            categories.forEach((cat, idx) => {
                const isSelected = category && cat.name === category.name;
                const bg = isSelected ? '#316ac5' : 'transparent';
                const color = isSelected ? '#ffffff' : '#333333';
                const border = isSelected ? '1px solid #1a3c75' : '1px solid transparent';
                
                gridHTML += `
                    <div style="padding: 8px 12px; margin-bottom: 3px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 3px; background: ${bg}; color: ${color}; border: ${border}; box-sizing: border-box; transition: background 0.1s;" onclick="if(window.HypercapitalisEmporiumApp && window.HypercapitalisEmporiumApp.appInstance) window.HypercapitalisEmporiumApp.appInstance.selectCategoryItem(${idx})">
                        ${getIconSpriteHTML(cat.icon, 20)}
                        <span style="font-weight: bold; font-size: 11px;">${cat.name}</span>
                    </div>
                `;
            });
            leftPageHTML = gridHTML;

            let itemsHTML = "";
            items.forEach((item, idx) => {
                const isSelected = idx === selectedIndex;
                const isOrdered = DeliveryManager.isItemOrdered(item);
                const rawPrice = this._itemListWindow.getItemRawPrice(item);
                const priceText = formatPrice(rawPrice);
                
                const activeStyle = isSelected ? 'background: #316ac5; color: white;' : 'background: #fdfdfd; color: #333333;';
                const borderStyle = isSelected ? 'border: 1px solid #1a3c75;' : 'border: 1px solid #c5c2af;';
                const orderedStyle = isOrdered ? 'opacity: 0.55;' : '';

                itemsHTML += `
                    <div style="padding: 8px 12px; margin-bottom: 4px; border-radius: 3px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 2px rgba(0,0,0,0.02); ${activeStyle} ${borderStyle} ${orderedStyle}" onclick="if(window.HypercapitalisEmporiumApp && window.HypercapitalisEmporiumApp.appInstance) window.HypercapitalisEmporiumApp.appInstance.selectShopItem(${idx})">
                        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex-grow: 1; margin-right: 8px; box-sizing: border-box;">
                            ${getIconSpriteHTML(item.iconIndex, 20)}
                            <span style="font-weight: bold; font-size: 11.5px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; max-width: 150px;">${item.name}</span>
                        </div>
                        <div style="font-weight: bold; font-size: 11px; flex-shrink: 0;">${priceText}</div>
                    </div>
                `;
            });

            if (items.length === 0) {
                itemsHTML = `<div style="text-align: center; color: #666; margin-top: 20px; font-style: italic; font-size: 11px;">${T('Stockbusters.text.noProductsAvailable')}</div>`;
            }

            const selectedItem = this._itemListWindow.item();
            let inspectorHTML = "";

            if (!selectedItem) {
                inspectorHTML = `
                    <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; flex-grow: 1; text-align: center; color: #7f8c8d; font-style: italic; font-size: 11px; border: 1px dashed #7f9db9; border-radius: 4px; background: #fcfcfc; padding: 15px; height: 100%; box-sizing: border-box;">
                        <span>${T('Stockbusters.text.selectAProductToView')}</span>
                    </div>
                `;
            } else {
                const price = this._buyWindow.getItemPrice();
                const isOrdered = DeliveryManager.isItemOrdered(selectedItem);
                const canAfford = activeGold >= price;
                const maxOrdersReached = activeOrdersCount >= 6;

                let actionButtonHTML = "";
                if (isOrdered) {
                    actionButtonHTML = `<button disabled style="width: 100%; padding: 8px; font-weight: bold; border-radius: 4px; border: 1px solid #ccc; background: #e2e2e2; color: #888; font-size: 11px;">${T('Stockbusters.text.alreadyOrdered')}</button>`;
                } else if (!canAfford) {
                    actionButtonHTML = `<button disabled style="width: 100%; padding: 8px; font-weight: bold; border-radius: 4px; border: 1px solid #ccc; background: #f5dcdc; color: #c0392b; font-size: 11px;">${T('Stockbusters.text.insufficientFunds')}</button>`;
                } else if (maxOrdersReached && !this._isLimited) {
                    actionButtonHTML = `<button disabled style="width: 100%; padding: 8px; font-weight: bold; border-radius: 4px; border: 1px solid #ccc; background: #e2e2e2; color: #888; font-size: 11px;">${T('Stockbusters.text.maxOrdersReached')}</button>`;
                } else {
                    actionButtonHTML = `<button onclick="if(window.HypercapitalisEmporiumApp && window.HypercapitalisEmporiumApp.appInstance) window.HypercapitalisEmporiumApp.appInstance.onItemOk()" style="width: 100%; padding: 8px; font-weight: bold; border-radius: 4px; background: linear-gradient(to bottom, #53a93f 0%, #3c8227 100%); color: white; cursor: pointer; border: 1px solid #205416; font-size: 11px; text-shadow: 0 1px 1px #000; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">${this._isLimited ? T('Stockbusters.text.acquireItem') : T('Stockbusters.text.orderItem')}</button>`;
                }

                const descTranslated = window.translateText ? window.translateText(selectedItem.description) : selectedItem.description;
                // Combinatorial, world-seeded lore shown under the short description.
                let loreBlockHTML = "";
                if (window.ItemSystemUtils && typeof window.ItemSystemUtils.loreFor === "function") {
                    const loreText = window.ItemSystemUtils.loreFor(selectedItem);
                    if (loreText) loreBlockHTML = `<div style="margin-top:6px;padding-top:6px;border-top:1px dotted #c3d3e3;opacity:0.85;">${loreText}</div>`;
                }

                inspectorHTML = `
                    <div style="display: flex; flex-direction: column; gap: 12px; height: 100%; box-sizing: border-box;">
                        <!-- Detail Header -->
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; border-bottom: 1px solid #ccc; padding-bottom: 10px; box-sizing: border-box;">
                            ${getIconSpriteHTML(selectedItem.iconIndex, 36)}
                            <div style="font-weight: bold; font-size: 13px; color: #0b2f70; text-align: center; word-break: break-all;">${selectedItem.name}</div>
                        </div>
                        
                        <!-- Description -->
                        <div style="flex-grow: 1; overflow-y: auto; background: #fdfdfd; border: 1px solid #7f9db9; border-radius: 3px; padding: 8px 10px; font-size: 11px; line-height: 1.45; color: #555; font-style: italic; text-align: justify; box-shadow: inset 0 1px 2px rgba(0,0,0,0.02); box-sizing: border-box;">
                            ${descTranslated || T('Stockbusters.text.noDescription')}
                            ${loreBlockHTML}
                        </div>

                        <!-- Price & Action -->
                        <div style="border-top: 1px solid #ccc; padding-top: 8px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; flex-shrink: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 13.5px;">
                                <span style="color: #666; font-size: 11px; text-transform: uppercase;">${T('Stockbusters.ui.totalCost')}</span>
                                <span style="color: #0054e3;">${formatPrice(price)}</span>
                            </div>
                            ${actionButtonHTML}
                        </div>
                    </div>
                `;
            }

            rightPageHTML = `
                <div style="display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #7f9db9; padding-bottom: 6px; margin-bottom: 10px; height: 28px; box-sizing: border-box; flex-shrink: 0;">
                    <button onclick="if(window.HypercapitalisEmporiumApp && window.HypercapitalisEmporiumApp.appInstance) window.HypercapitalisEmporiumApp.appInstance.onItemCancel()" style="padding: 2px 8px; font-weight: bold; cursor: pointer; border: 1px solid #7f9db9; border-radius: 3px; background: linear-gradient(to bottom, #fff 0%, #ece9d8 100%); font-size: 11px; display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 12px; font-weight: bold;">←</span> ${T('Stockbusters.text.back')}
                    </button>
                    <div style="font-weight: bold; color: #0b2f70; font-size: 13px;">${category ? category.name : "Wares"}</div>
                </div>
                
                <div style="display: flex; gap: 15px; flex-grow: 1; height: calc(100% - 38px); overflow: hidden; box-sizing: border-box;">
                    <!-- Item Grid Left Column -->
                    <div style="flex: 1.3; overflow-y: auto; padding-right: 4px; box-sizing: border-box; height: 100%;">
                        ${itemsHTML}
                    </div>
                    
                    <!-- Inspector Card Right Column -->
                    <div style="flex: 0.7; border: 1px solid #7f9db9; border-radius: 4px; background: #f4f7fc; padding: 12px; box-sizing: border-box; height: 100%;">
                        ${inspectorHTML}
                    </div>
                </div>
            `;

            if (stage === 'confirm' && selectedItem) {
                modalOverlay.style.display = 'flex';
                modalContent.innerHTML = `
                    <h2 style="margin-top: 0; color: #0054e3; border-bottom: 2px solid #0054e3; padding-bottom: 10px; font-size: 15px;">${T('Stockbusters.text.confirmTransaction')}</h2>
                    <p style="font-size: 13px; margin: 15px 0 20px 0;">
                        ${T('Stockbusters.text.transfer')} <strong>${formatPrice(price)}</strong> ${T('Stockbusters.text.for')} <strong>${selectedItem.name}</strong>?
                    </p>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button onclick="if(window.HypercapitalisEmporiumApp && window.HypercapitalisEmporiumApp.appInstance) window.HypercapitalisEmporiumApp.appInstance.onBuyOk()" style="padding: 6px 18px; font-weight: bold; background: #0054e3; border: 1px solid #1a3c75; border-radius: 3px; color: white; cursor: pointer;">${T('Stockbusters.text.authorize')}</button>
                        <button onclick="if(window.HypercapitalisEmporiumApp && window.HypercapitalisEmporiumApp.appInstance) window.HypercapitalisEmporiumApp.appInstance.onBuyCancel()" style="padding: 6px 18px; font-weight: bold; border: 1px solid #7f9db9; border-radius: 3px; cursor: pointer; background: linear-gradient(to bottom, #fff 0%, #ece9d8 100%);">${T('Stockbusters.text.cancel2')}</button>
                    </div>
                `;
            } else {
                modalOverlay.style.display = 'none';
            }
        }

        const leftEl = document.getElementById('emporium-left-page');
        const rightEl = document.getElementById('emporium-right-page');
        
        // Only update innerHTML if it has changed to prevent full redraws
        if (leftEl && leftEl.innerHTML !== leftPageHTML) {
            leftEl.innerHTML = leftPageHTML;
        }
        if (rightEl && rightEl.innerHTML !== rightPageHTML) {
            rightEl.innerHTML = rightPageHTML;
        }
    };

    Scene_SearchableShop.prototype.selectCategoryItem = function (idx) {
        if (this._categoryGridWindow) {
            const currentIdx = this._categoryGridWindow.index();
            this._categoryGridWindow.select(idx);
            if (currentIdx === idx) {
                this.onCategoryOk();
            } else {
                SoundManager.playCursor();
            }
            this.refreshUIShopDOM();
        }
    };

    Scene_SearchableShop.prototype.selectShopItem = function (idx) {
        if (this._itemListWindow) {
            const currentIdx = this._itemListWindow.index();
            this._itemListWindow.select(idx);
            if (currentIdx === idx) {
                this.onItemOk();
            } else {
                SoundManager.playCursor();
            }
            this.refreshUIShopDOM();
        }
    };

    Scene_SearchableShop.prototype.update = function () {
        if (!this._isAppMode) Scene_MenuBase.prototype.update.call(this);

        // Add handling for ESC key (cancel) when buy window is open
        if (this._buyWindow.isOpen() && (Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled())) {
            this.onBuyCancel();
            this.refreshUIShopDOM();
            return;
        }

        if (this._dndContainer) {
            let moved = false;
            let okPressed = false;
            let cancelPressed = false;

            let stage = 'category';
            if (this._buyWindow && this._buyWindow.isOpen() && this._buyWindow.active) {
                stage = 'confirm';
            } else if (this._itemListWindow && this._itemListWindow.visible && this._itemListWindow.active) {
                stage = 'item';
            }

            if (stage === 'category') {
                const maxCols = 3;
                const currentIndex = this._categoryGridWindow.index();
                const maxItems = this._categoryGridWindow.maxItems();

                if (Input.isTriggered('down') || Input.isRepeated('down') || this.isKeyPressed('KeyS')) {
                    if (maxItems > 0) {
                        const nextIndex = Math.min(maxItems - 1, currentIndex + maxCols);
                        this._categoryGridWindow.select(nextIndex);
                        moved = true;
                    }
                } else if (Input.isTriggered('up') || Input.isRepeated('up') || this.isKeyPressed('KeyW')) {
                    if (maxItems > 0) {
                        const prevIndex = Math.max(0, currentIndex - maxCols);
                        this._categoryGridWindow.select(prevIndex);
                        moved = true;
                    }
                } else if (Input.isTriggered('left') || Input.isRepeated('left') || this.isKeyPressed('KeyA')) {
                    if (maxItems > 0) {
                        const prevIndex = currentIndex > 0 ? currentIndex - 1 : maxItems - 1;
                        this._categoryGridWindow.select(prevIndex);
                        moved = true;
                    }
                } else if (Input.isTriggered('right') || Input.isRepeated('right') || this.isKeyPressed('KeyD')) {
                    if (maxItems > 0) {
                        const nextIndex = currentIndex < maxItems - 1 ? currentIndex + 1 : 0;
                        this._categoryGridWindow.select(nextIndex);
                        moved = true;
                    }
                }

                if (Input.isTriggered('ok') || this.isKeyPressed('Enter') || this.isKeyPressed('Space')) {
                    okPressed = true;
                } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                    cancelPressed = true;
                }
            } else if (stage === 'item') {
                const maxCols = 2;
                const currentIndex = this._itemListWindow.index();
                const maxItems = this._itemListWindow.maxItems();

                if (Input.isTriggered('down') || Input.isRepeated('down') || this.isKeyPressed('KeyS')) {
                    if (maxItems > 0) {
                        const nextIndex = Math.min(maxItems - 1, currentIndex + maxCols);
                        this._itemListWindow.select(nextIndex);
                        moved = true;
                    }
                } else if (Input.isTriggered('up') || Input.isRepeated('up') || this.isKeyPressed('KeyW')) {
                    if (maxItems > 0) {
                        const prevIndex = Math.max(0, currentIndex - maxCols);
                        this._itemListWindow.select(prevIndex);
                        moved = true;
                    }
                } else if (Input.isTriggered('left') || Input.isRepeated('left') || this.isKeyPressed('KeyA')) {
                    if (maxItems > 0) {
                        const prevIndex = currentIndex > 0 ? currentIndex - 1 : maxItems - 1;
                        this._itemListWindow.select(prevIndex);
                        moved = true;
                    }
                } else if (Input.isTriggered('right') || Input.isRepeated('right') || this.isKeyPressed('KeyD')) {
                    if (maxItems > 0) {
                        const nextIndex = currentIndex < maxItems - 1 ? currentIndex + 1 : 0;
                        this._itemListWindow.select(nextIndex);
                        moved = true;
                    }
                }

                if (Input.isTriggered('ok') || this.isKeyPressed('Enter') || this.isKeyPressed('Space')) {
                    okPressed = true;
                } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                    cancelPressed = true;
                }
            } else if (stage === 'confirm') {
                const currentIndex = this._buyWindow.index();
                const maxItems = this._buyWindow.maxItems();

                if (Input.isTriggered('left') || this.isKeyPressed('KeyA') || Input.isTriggered('up') || this.isKeyPressed('KeyW')) {
                    const prevIndex = currentIndex > 0 ? currentIndex - 1 : maxItems - 1;
                    this._buyWindow.select(prevIndex);
                    moved = true;
                } else if (Input.isTriggered('right') || this.isKeyPressed('KeyD') || Input.isTriggered('down') || this.isKeyPressed('KeyS')) {
                    const nextIndex = currentIndex < maxItems - 1 ? currentIndex + 1 : 0;
                    this._buyWindow.select(nextIndex);
                    moved = true;
                }

                if (Input.isTriggered('ok') || this.isKeyPressed('Enter') || this.isKeyPressed('Space')) {
                    const symbol = this._buyWindow.currentSymbol();
                    if (symbol === 'buy') {
                        this.onBuyOk();
                    } else if (symbol === 'delivery_info') {
                        this.onDeliveryInfo();
                    } else if (symbol === 'cancel') {
                        this.onBuyCancel();
                    }
                    moved = true;
                } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                    this.onBuyCancel();
                    moved = true;
                }
            }

            if (moved) {
                this.refreshUIShopDOM();
            } else if (okPressed) {
                if (stage === 'category') {
                    this.onCategoryOk();
                } else if (stage === 'item') {
                    this.onItemOk();
                }
                this.refreshUIShopDOM();
            } else if (cancelPressed) {
                if (stage === 'category') {
                    SoundManager.playCancel();
                    // Top level: back out of the shop. As an OS app that means
                    // closing its window; standalone it pops the scene.
                    if (this._isAppMode) {
                        const w = document.getElementById('app-store');
                        if (w && window.HypernetOS) {
                            window.HypernetOS.WindowManager.closeWindow(w);
                        }
                    } else {
                        this.popScene();
                    }
                } else if (stage === 'item') {
                    SoundManager.playCancel();
                    this.onItemCancel();
                }
                this.refreshUIShopDOM();
            }
        }
    };

    Scene_SearchableShop.prototype.isKeyPressed = function (key) {
        return Input._currentState[key] && !Input._previousState[key];
    };

})();