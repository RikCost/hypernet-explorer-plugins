/*:
 * @target MZ
 * @plugindesc Shop Management System v2.1.1
 * @author Omni-Lex
 * @url
 * @help
 * ============================================================================
 * Shop Management Plugin for RPG Maker MZ
 * ============================================================================
 *
 * This plugin creates a comprehensive shop management system with support
 * for multiple shops, role-based gameplay, production, delivery, and inventory.
 *
 * Setup Instructions:
 * 1. Tag items with <Category: [YourCategory]> in their note box
 * 2. Add recipes to items: <Recipe: 866x2, 867x1, 869x2, 868x1>
 * 3. Create "Delivery" events on maps where deliveries can be made
 * 4. Material items should be in the ID range 849-871
 * 5. Initialize shops with initializeShop command before use
 *
 * Price Display:
 * - Prices are displayed in euros using conversion: 1200 gold = 12€
 * - Example: 1212 gold = 12.12€
 *
 * @param defaultPriceMultiplier
 * @text Default Price Multiplier
 * @desc Multiplier for base item prices
 * @type number
 * @decimals 2
 * @default 1.5
 *
 * @param producingInterval
 * @text NPC Producing Interval
 * @desc Frames between automatic NPC production attempts
 * @type number
 * @default 300
 *
 * @param deliveryMinGold
 * @text Minimum Delivery Gold
 * @desc Minimum gold earned from deliveries
 * @type number
 * @default 10000
 *
 * @param deliveryMaxGold
 * @text Maximum Delivery Gold
 * @desc Maximum gold earned from deliveries
 * @type number
 * @default 40000
 *
 * @param materialStartId
 * @text Material Start ID
 * @desc Starting item ID for materials
 * @type number
 * @default 849
 *
 * @param materialEndId
 * @text Material End ID
 * @desc Ending item ID for materials
 * @type number
 * @default 871
 *
 * @param producingTileId
 * @text Producing Tile ID
 * @desc Tile ID where NPC must stand to produce (default: 108)
 * @type number
 * @default 108
 *
 * @param npcProducerEventId
 * @text NPC Producer Event ID
 * @desc Event ID of the NPC producer on the current map
 * @type number
 * @default 1
 *
 * @param randomQuantityMin
 * @text Random Quantity Minimum
 * @desc Minimum random starting quantity for event items
 * @type number
 * @default 1
 *
 * @param randomQuantityMax
 * @text Random Quantity Maximum
 * @desc Maximum random starting quantity for event items
 * @type number
 * @default 10
 *
 * @param defaultStockItems
 * @text Default Stock Items Count
 * @desc Number of random category items to add to starting stock (3-8)
 * @type number
 * @default 5
 *
 * @command initializeShop
 * @text Initialize Shop
 * @desc Initialize a new shop with category and switch
 *
 * @arg shopId
 * @text Shop ID
 * @type text
 * @default shop1
 *
 * @arg category
 * @text Item Category
 * @type text
 * @default Food
 * @desc Category tag for items this shop can produce/sell
 *
 * @arg switchId
 * @text Control Switch ID
 * @type switch
 * @default 1
 * @desc Switch that controls this shop's operation
 *
 * @arg eventIds
 * @text Event IDs for Random Stock
 * @type text
 * @default
 * @desc Comma-separated list of item IDs to add random starting quantities (e.g., 1,2,3,4)
 *
 * @command setCurrentShop
 * @text Set Current Shop
 * @desc Set the active shop for operations
 *
 * @arg shopId
 * @text Shop ID
 * @type text
 * @default shop1
 *
 * @command openShopManagement
 * @text Open Shop Management
 * @desc Opens the shop management interface
 *
 * @command closeShopPermanently
 * @text Close Shop Permanently
 * @desc Permanently close a shop and reset its data
 *
 * @arg shopId
 * @text Shop ID
 * @type text
 * @default shop1
 *
 * @command startWork
 * @text Start Work
 * @desc Removes actors 2 & 3, activates job systems
 *
 * @command stopWork
 * @text Stop Work
 * @desc Re-adds actors 2 & 3, deactivates job systems
 *
 * @command switchRole
 * @text Switch Role
 * @desc Switch between Manager, Cook, and Rider roles
 *
 * @arg role
 * @text Role
 * @type select
 * @option Manager
 * @option Producer
 * @option Rider
 * @default Manager
 *
 * @command newDelivery
 * @text New Delivery
 * @desc Start a new delivery to a random visited map
 *
 * @command completeDelivery
 * @text Complete Delivery
 * @desc Complete current delivery and earn gold
 *
 * @command orderMaterials
 * @text Order Materials
 * @desc Order materials from warehouse
 *
 * @arg materialId
 * @text Material Item ID
 * @type number
 * @min 849
 * @max 871
 * @default 849
 *
 * @arg amount
 * @text Amount
 * @type number
 * @min 1
 * @default 10
 *
 * @command setMenuPrice
 * @text Set Menu Price
 * @desc Set price for a food item
 *
 * @arg itemId
 * @text Item ID
 * @type item
 * @default 1
 *
 * @arg price
 * @text Price
 * @type number
 * @min 1
 * @default 100
 *
 * @command produceItem
 * @text Produce Item
 * @desc Manually produce an item
 *
 * @arg shopId
 * @text Shop ID
 * @type text
 * @default shop1
 *
 * @arg itemId
 * @text Item ID
 * @type item
 * @default 1
 *
 * @command startProducingMiniGame
 * @text Start Producing Mini-Game
 * @desc Start the producing mini-game (placeholder)
 *
 * @command showDeliveryInfo
 * @text Show Delivery Info
 * @desc Shows current delivery destination, NPC info and timer
 *
 * @param deliveryTimeLimit
 * @text Delivery Time Limit
 * @desc Time limit for deliveries in seconds
 * @type number
 * @default 120
 */

(() => {
  "use strict";

  const pluginName = "ShopManagement";
  const parameters = PluginManager.parameters(pluginName);

  // Gate the economy/producing logs so they don't spam the console every tick.
  const DEBUG = false;
  const debugLog = (...args) => { if (DEBUG) console.log(...args); };

  // Category -> item list memo. Item notes are static, so the per-category
  // $dataItems scan (with a fresh RegExp per item) is done once and reused.
  const _categoryItemsCache = new Map();
  function getCategoryItems(category) {
    let list = _categoryItemsCache.get(category);
    if (!list) {
      list = $dataItems.filter((item) => item && isItemInCategory(item, category));
      _categoryItemsCache.set(category, list);
    }
    return list;
  }

  const defaultPriceMultiplier = Number(
    parameters["defaultPriceMultiplier"] || 1.5
  );
  const producingInterval = Number(parameters["producingInterval"] || 300);
  const deliveryMinGold = Number(parameters["deliveryMinGold"] || 10000);
  const deliveryMaxGold = Number(parameters["deliveryMaxGold"] || 40000);
  const materialStartId = Number(parameters["materialStartId"] || 849);
  const materialEndId = Number(parameters["materialEndId"] || 871);
  const deliveryTimeLimit = Number(parameters["deliveryTimeLimit"] || 120);
  const producingTileId = Number(parameters["producingTileId"] || 108);
  const npcProducerEventId = Number(parameters["npcProducerEventId"] || 1);
  const randomQuantityMin = Number(parameters["randomQuantityMin"] || 1);
  const randomQuantityMax = Number(parameters["randomQuantityMax"] || 10);
  const defaultStockItems = Number(parameters["defaultStockItems"] || 5);
  function refreshEconomy() {
    const currentShop = getCurrentShop();
    if (currentShop && currentShop.isAutoOperating) {
        currentShop.refreshEconomy();
    }
    
    // Optionally refresh all shops
    for (const shopId in shopData.shops) {
        const shop = shopData.shops[shopId];
        if (shop.isAutoOperating && shop !== currentShop) {
            shop.refreshEconomy();
        }
    }
}

  // Helper function to convert gold to euros
  function goldToEuros(goldAmount) {
    return (goldAmount / 100).toFixed(2);
  }

  // Helper function to format price in euros
  function formatEuroPrice(goldAmount) {
    return `€${goldToEuros(goldAmount)}`;
  }

  // Plugin Data Structure - Now supports multiple shops
  let shopData = {
    shops: {},
    currentShopId: null,
    globalData: {
      visitedMaps: [],
      currentDelivery: null,
      deliveryNPC: {
        name: "",
        spriteIndex: 0,
        spriteName: "",
      },
    },
  };

  // Helper function to generate random warehouse materials
  function generateRandomWarehouseMaterials() {
    const materials = {};
    const numMaterials = Math.floor(Math.random() * 8) + 5; // 5-12 different materials
    const availableMaterialIds = [];

    // Create array of available material IDs
    for (let id = materialStartId; id <= materialEndId; id++) {
      if ($dataItems[id]) {
        availableMaterialIds.push(id);
      }
    }

    // Shuffle and select random materials
    const shuffledIds = [...availableMaterialIds].sort(
      () => Math.random() - 0.5
    );
    const selectedIds = shuffledIds.slice(
      0,
      Math.min(numMaterials, availableMaterialIds.length)
    );

    // Assign random quantities to selected materials
    for (const materialId of selectedIds) {
      const randomQuantity = Math.floor(Math.random() * 30) + 10; // 10-39 quantity
      materials[materialId] = randomQuantity;
    }

    return materials;
  }

  // Shop class structure
  class Shop {
    constructor(id, category, switchId, eventIds = "") {
      this.id = id;
      this.category = category;
      this.switchId = switchId;
      this.isWorking = false;
      this.currentRole = "Manager";  // i18n-ignore  role id, switched by switchRole
      this.menuPrices = {};
      this.stockInventory = {};
      this.warehouseInventory = {};
      this.npcProducingTimer = 0;
      this.productionQueue = [];
      this.balance = 200000; // Starting balance: 2000.00€
      this.lastUpdateTime = Date.now();
      // Economy accrual is driven by game time (var 114, total game minutes) so
      // it does not advance while the game is closed. lastUpdateTime is kept only
      // for the human-readable status display.
      this.lastUpdateGameMin = ($gameVariables ? $gameVariables.value(114) : 0);
      this.isAutoOperating = true; // Shop operates automatically
      this.salesPerHour = 12; // Average sales per hour
      this.productionPerHour = 8; // Average production per hour
      this.restockThreshold = 3; // Restock when materials drop below this
      this.maxMaterialStock = 50; // Maximum materials to keep in warehouse
      // Initialize with default items
      this.initializeDefaultInventory();

      // Add random quantities for specified event IDs
      if (eventIds && eventIds.trim()) {
        this.addRandomEventItems(eventIds);
      }
    }
    // NEW METHOD: Main economy refresh function
    refreshEconomy() {
        const nowMin = ($gameVariables ? $gameVariables.value(114) : 0);
        // Backfill on legacy saves so the first refresh after load doesn't jump.
        if (this.lastUpdateGameMin === undefined || this.lastUpdateGameMin === null) {
            this.lastUpdateGameMin = nowMin;
        }
        const minutesElapsed = nowMin - this.lastUpdateGameMin;
        const hoursElapsed = minutesElapsed / 60;

        if (hoursElapsed < 0.1) return; // Skip if less than 6 game-minutes passed

        // Process automatic operations
        this.simulateSales(hoursElapsed);
        this.simulateProduction(hoursElapsed);
        this.simulateRestocking(hoursElapsed);

        // Update last update markers
        this.lastUpdateGameMin = nowMin;
        this.lastUpdateTime = Date.now();
    }
    
    // NEW METHOD: Simulate sales over time
    simulateSales(hoursElapsed) {
        // A shop run by somebody who knows the trade moves more stock in the
        // same hours (Retail Management, specialization 726).
        const retail = window.SpecializationXP
            ? window.SpecializationXP.multiplier('Retail Management', 0.10) : 1;
        const expectedSales = Math.floor(this.salesPerHour * hoursElapsed * (0.5 + Math.random()) * retail);
        let actualSales = 0;
        
        // Get available stock items
        const availableSlots = [];
        for (let slotIndex = 1; slotIndex <= 7; slotIndex++) {
            const slot = this.stockInventory[slotIndex];
            if (slot && slot.amount > 0) {
                availableSlots.push({
                    slotIndex: slotIndex,
                    itemId: slot.itemId,
                    amount: slot.amount,
                    price: this.menuPrices[slot.itemId] || 1000
                });
            }
        }
        
        if (availableSlots.length === 0) {
            debugLog(`${this.id}: No items available for sale`);
            return;
        }
        
        // Simulate sales
        for (let i = 0; i < expectedSales && availableSlots.length > 0; i++) {
            // Select random item to sell (weighted by availability)
            const randomSlot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
            
            // Sell one unit
            this.stockInventory[randomSlot.slotIndex].amount--;
            this.balance += randomSlot.price;
            actualSales++;
            
            // Remove from available slots if sold out
            if (this.stockInventory[randomSlot.slotIndex].amount <= 0) {
                this.stockInventory[randomSlot.slotIndex] = null;
                const slotIndex = availableSlots.indexOf(randomSlot);
                if (slotIndex > -1) {
                    availableSlots.splice(slotIndex, 1);
                }
            } else {
                // Update amount in availableSlots
                randomSlot.amount = this.stockInventory[randomSlot.slotIndex].amount;
            }
        }
        
        if (actualSales > 0) {
            const revenue = actualSales * 1200; // Average price estimate
            debugLog(`${this.id}: Sold ${actualSales} items, earned ${formatEuroPrice(revenue)}`);
            // Running a shop that actually sells things is how the trade is
            // learned. Capped per day like every other repeatable activity.
            if (window.SpecializationXP) {
                window.SpecializationXP.awardForValue('Retail Management', revenue);
            }
        }
    }
    
    // NEW METHOD: Simulate production over time
    simulateProduction(hoursElapsed) {
        const expectedProduction = Math.floor(this.productionPerHour * hoursElapsed * (0.7 + Math.random() * 0.6));
        let actualProduction = 0;
        
        // Get category items that can be produced
        const categoryItems = getCategoryItems(this.category);

        if (categoryItems.length === 0) return;
        
        // Attempt production
        for (let i = 0; i < expectedProduction; i++) {
            const randomItem = categoryItems[Math.floor(Math.random() * categoryItems.length)];
            const recipe = getRecipe(randomItem);
            
            if (recipe && hasIngredients(recipe, this)) {
                consumeIngredients(recipe, this);
                if (addToStock(randomItem.id, 1, this)) {
                    actualProduction++;
                }
            } else if (!recipe) {
                // Items without recipes can be produced for free
                if (addToStock(randomItem.id, 1, this)) {
                    actualProduction++;
                }
            }
        }
        
        if (actualProduction > 0) {
            debugLog(`${this.id}: Produced ${actualProduction} items`);
        }
    }
    
    // NEW METHOD: Simulate automatic restocking
    simulateRestocking(hoursElapsed) {
        let totalRestockCost = 0;
        
        // Check each material type and restock if needed
        for (let materialId = materialStartId; materialId <= materialEndId; materialId++) {
            const item = $dataItems[materialId];
            if (!item) continue;
            
            const currentStock = this.warehouseInventory[materialId] || 0;
            
            // Restock if below threshold
            if (currentStock < this.restockThreshold) {
                const restockAmount = this.maxMaterialStock - currentStock;
                const costPerUnit = Math.floor(item.price * 0.8); // Materials cost 80% of base price
                const totalCost = restockAmount * costPerUnit;
                
                // Check if shop can afford restocking
                if (this.balance >= totalCost) {
                    this.warehouseInventory[materialId] = (this.warehouseInventory[materialId] || 0) + restockAmount;
                    this.balance -= totalCost;
                    totalRestockCost += totalCost;
                    
                    debugLog(`${this.id}: Restocked ${restockAmount}x ${item.name} for ${formatEuroPrice(totalCost)}`);
                } else {
                    debugLog(`${this.id}: Cannot afford to restock ${item.name} (need ${formatEuroPrice(totalCost)})`);
                }
            }
        }
        
        if (totalRestockCost > 0) {
            debugLog(`${this.id}: Total restocking cost: ${formatEuroPrice(totalRestockCost)}`);
        }
    }
    
    // NEW METHOD: Get shop financial status
    getFinancialStatus() {
        return {
            balance: this.balance,
            balanceFormatted: formatEuroPrice(this.balance),
            lastUpdate: new Date(this.lastUpdateTime).toLocaleString(),
            hoursInactive: (Date.now() - this.lastUpdateTime) / (1000 * 60 * 60)
        };
    }
    
    // NEW METHOD: Manual balance adjustment (for debugging/events)
    adjustBalance(amount, reason = "Manual adjustment") {  // i18n-ignore  debugLog text only
        this.balance += amount;
        debugLog(`${this.id}: ${reason} - Balance changed by ${formatEuroPrice(amount)} to ${formatEuroPrice(this.balance)}`);
    }
    // Replace the Shop constructor's initializeDefaultInventory method
    initializeDefaultInventory() {
      // Initialize warehouse with random materials from 849-871 range
      this.warehouseInventory = generateRandomWarehouseMaterials();

      // Initialize stock as 7 slots with max 9 items each
      this.stockInventory = {};
      this.stockSlots = 7;
      this.maxItemsPerSlot = 9;

      // Find all items with matching category tag for stock
      const categoryItems = [];
      for (let i = 1; i < $dataItems.length; i++) {
        const item = $dataItems[i];
        if (item && isItemInCategory(item, this.category)) {
          categoryItems.push(item);
        }
      }

      // If no category items found, use fallback items
      if (categoryItems.length === 0) {
        console.warn(
          `No items found with category "${this.category}". Using fallback items.`
        );
        // Add some basic fallback items to first 2 slots
        this.stockInventory[1] = {
          itemId: 1,
          amount: Math.floor(Math.random() * 2) + 1,
        };
        this.stockInventory[2] = {
          itemId: 2,
          amount: Math.floor(Math.random() * 2) + 1,
        };
      } else {
        // Randomly select 7 items from category items (or less if not enough available)
        const shuffledItems = [...categoryItems].sort(
          () => Math.random() - 0.5
        );
        const selectedItems = shuffledItems.slice(
          0,
          Math.min(7, categoryItems.length)
        );

        // Initialize each slot with a random item and 1-2 copies
        for (let slotIndex = 1; slotIndex <= 7; slotIndex++) {
          if (selectedItems[slotIndex - 1]) {
            const item = selectedItems[slotIndex - 1];
            const randomAmount = Math.floor(Math.random() * 2) + 1; // 1-2 copies

            this.stockInventory[slotIndex] = {
              itemId: item.id,
              amount: randomAmount,
            };

            debugLog(
              `Slot ${slotIndex}: Added ${randomAmount}x ${item.name} (Category: ${this.category})`
            );
          } else {
            // Empty slot
            this.stockInventory[slotIndex] = null;
          }
        }
      }

      // Set default prices for all items in slots
      for (let slotIndex = 1; slotIndex <= 7; slotIndex++) {
        const slot = this.stockInventory[slotIndex];
        if (slot) {
          const item = $dataItems[slot.itemId];
          if (item) {
            this.menuPrices[slot.itemId] = Math.floor(
              item.price * defaultPriceMultiplier
            );
          }
        }
      }
    }

    addRandomEventItems(eventIds) {
      const idList = eventIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id);

      // Check if these are material IDs (849-871) for warehouse override
      const materialIds = idList.filter((id) => {
        const itemId = Number(id);
        return itemId >= materialStartId && itemId <= materialEndId;
      });

      const stockIds = idList.filter((id) => {
        const itemId = Number(id);
        return itemId < materialStartId || itemId > materialEndId;
      });

      // If material IDs are provided, replace warehouse inventory
      if (materialIds.length > 0) {
        debugLog(
          `Overriding warehouse with specified materials: ${materialIds.join(
            ", "
          )}`
        );
        this.warehouseInventory = {}; // Clear existing warehouse

        for (const itemIdStr of materialIds) {
          const itemId = Number(itemIdStr);

          // Validate item exists
          if (!$dataItems[itemId]) {
            console.warn(
              `Material ID ${itemId} not found in database, skipping.`
            );
            continue;
          }

          // Generate random quantity for warehouse materials
          const randomQuantity = Math.floor(Math.random() * 30) + 10; // 10-39 quantity
          this.warehouseInventory[itemId] = randomQuantity;

          debugLog(
            `Added ${randomQuantity}x ${$dataItems[itemId].name} to ${this.id} warehouse`
          );
        }
      }

      // Add non-material IDs to stock
      for (const itemIdStr of stockIds) {
        const itemId = Number(itemIdStr);

        // Validate item exists
        if (!$dataItems[itemId]) {
          console.warn(`Item ID ${itemId} not found in database, skipping.`);
          continue;
        }

        // Generate random quantity for stock items
        const randomQuantity =
          Math.floor(
            Math.random() * (randomQuantityMax - randomQuantityMin + 1)
          ) + randomQuantityMin;

        // Add to stock inventory
        this.stockInventory[itemId] =
          (this.stockInventory[itemId] || 0) + randomQuantity;

        // Set default price if not already set
        if (!this.menuPrices[itemId]) {
          const item = $dataItems[itemId];
          this.menuPrices[itemId] = Math.floor(
            item.price * defaultPriceMultiplier
          );
        }

        debugLog(
          `Added ${randomQuantity}x ${$dataItems[itemId].name} to ${this.id} stock`
        );
      }
    }
  }

  // Save/Load System
  const _DataManager_makeSaveContents = DataManager.makeSaveContents;
  DataManager.makeSaveContents = function () {
    const contents = _DataManager_makeSaveContents.call(this);
    contents.shopManagement = shopData;
    return contents;
  };

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    if (contents.shopManagement) {
      shopData = contents.shopManagement;
    }
  };

  // Get current shop
  function getCurrentShop() {
    if (!shopData.currentShopId) return null;
    return shopData.shops[shopData.currentShopId];
  }

  // Track visited maps
  const _Game_Player_performTransfer = Game_Player.prototype.performTransfer;
  Game_Player.prototype.performTransfer = function () {
    _Game_Player_performTransfer.call(this);
    if (!shopData.globalData.visitedMaps.includes($gameMap.mapId())) {
      shopData.globalData.visitedMaps.push($gameMap.mapId());
    }
  };

  // Helper Functions
  function isItemInCategory(item, category) {
    if (!item) return false;
    const regex = new RegExp(`<Category:\\s*${category}>`, "i");
    return regex.test(item.note);
  }

  function getRecipe(item) {
    if (!item || !item.note) return null;
    const match = item.note.match(/<Recipe:\s*(.+)>/i);
    if (!match) return null;

    const recipe = {};
    const ingredients = match[1].split(",");
    ingredients.forEach((ing) => {
      const [itemId, amount] = ing
        .trim()
        .split("x")
        .map((n) => parseInt(n));
      recipe[itemId] = amount;
    });
    return recipe;
  }

  function hasIngredients(recipe, shop) {
    for (const [itemId, amount] of Object.entries(recipe)) {
      const currentAmount = shop.warehouseInventory[itemId] || 0;
      if (currentAmount < amount) return false;
    }
    return true;
  }

  function consumeIngredients(recipe, shop) {
    for (const [itemId, amount] of Object.entries(recipe)) {
      shop.warehouseInventory[itemId] =
        (shop.warehouseInventory[itemId] || 0) - amount;
      if (shop.warehouseInventory[itemId] <= 0) {
        delete shop.warehouseInventory[itemId];
      }
    }
  }

  function addToStock(itemId, amount = 1, shop, specificSlot = null) {
    // If specific slot is provided, add to that slot only
    if (specificSlot !== null && specificSlot >= 1 && specificSlot <= 7) {
      const slot = shop.stockInventory[specificSlot];
      if (!slot) {
        // Empty slot - create new entry
        shop.stockInventory[specificSlot] = {
          itemId: itemId,
          amount: Math.min(amount, shop.maxItemsPerSlot),
        };
        return true;
      } else if (slot.itemId === itemId) {
        // Same item - add amount up to max
        const newAmount = Math.min(slot.amount + amount, shop.maxItemsPerSlot);
        slot.amount = newAmount;
        return true;
      }
      return false; // Slot occupied by different item
    }

    // Find existing slot with same item
    for (let slotIndex = 1; slotIndex <= 7; slotIndex++) {
      const slot = shop.stockInventory[slotIndex];
      if (
        slot &&
        slot.itemId === itemId &&
        slot.amount < shop.maxItemsPerSlot
      ) {
        const spaceAvailable = shop.maxItemsPerSlot - slot.amount;
        const amountToAdd = Math.min(amount, spaceAvailable);
        slot.amount += amountToAdd;
        return true;
      }
    }

    // Find empty slot
    for (let slotIndex = 1; slotIndex <= 7; slotIndex++) {
      if (!shop.stockInventory[slotIndex]) {
        shop.stockInventory[slotIndex] = {
          itemId: itemId,
          amount: Math.min(amount, shop.maxItemsPerSlot),
        };
        return true;
      }
    }

    return false; // No space available
  }

  // Replace the removeFromStock function
  function removeFromStock(itemId, amount = 1, shop, specificSlot = null) {
    if (specificSlot !== null && specificSlot >= 1 && specificSlot <= 7) {
      const slot = shop.stockInventory[specificSlot];
      if (!slot || slot.itemId !== itemId) return false;

      if (slot.amount >= amount) {
        slot.amount -= amount;
        if (slot.amount <= 0) {
          shop.stockInventory[specificSlot] = null;
        }
        return true;
      }
      return false;
    }

    // Find slot with the item
    for (let slotIndex = 1; slotIndex <= 7; slotIndex++) {
      const slot = shop.stockInventory[slotIndex];
      if (slot && slot.itemId === itemId) {
        if (slot.amount >= amount) {
          slot.amount -= amount;
          if (slot.amount <= 0) {
            shop.stockInventory[slotIndex] = null;
          }
          return true;
        }
      }
    }

    return false;
  }

  function findDeliveryMaps() {
    const validMaps = [];
    for (const mapId of shopData.globalData.visitedMaps) {
      validMaps.push(mapId);
    }
    return validMaps;
  }

  function getMapDisplayName(mapId) {
    // WorldMapReturn names the place rather than the map file, which is the only
    // way a destination on the procedural map reads as somewhere ("Fields
    // (88,131)") instead of "ProceduralRoom", the one map every world square
    // reuses.
    if (window.WorldMapReturn && window.WorldMapReturn.placeName) {
      const named = window.WorldMapReturn.placeName(mapId);
      if (named) return named;
    }

    let mapName = T('ShopManagement.mapN', { id: mapId });

    if (window.$dataMapInfos && $dataMapInfos[mapId]) {
      const mapInfo = $dataMapInfos[mapId];
      mapName = mapInfo.name;

      if ($gameMap.mapId() === mapId) {
        mapName = $gameMap.displayName() || mapInfo.name;
      }
    }

    return mapName;
  }

  // Plugin Commands
  PluginManager.registerCommand(pluginName, "initializeShop", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const shopId = args.shopId;
    const category = args.category;
    const switchId = Number(args.switchId);
    const eventIds = args.eventIds || "";

    // Create new shop with event IDs
    shopData.shops[shopId] = new Shop(shopId, category, switchId, eventIds);

    // Set as current shop if none selected
    if (!shopData.currentShopId) {
      shopData.currentShopId = shopId;
    }

    // Turn on the switch
    $gameSwitches.setValue(switchId, true);
    window.skipLocalization = true;
    $gameMessage.add(T('ShopManagement.msg.initialized', { shop: shopId }));
    $gameMessage.add(T('ShopManagement.msg.category', { category: category }));
    $gameMessage.add(
      T('ShopManagement.msg.stocked')
    );

    // Show information about added event items
    if (eventIds && eventIds.trim()) {
      $gameMessage.add(
        T('ShopManagement.msg.extraItems', { items: eventIds })
      );
    }
    window.skipLocalization = false;

  });

  PluginManager.registerCommand(pluginName, "setCurrentShop", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const shopId = args.shopId;
    window.skipLocalization = true;

    if (!shopData.shops[shopId]) {
      $gameMessage.add(T('ShopManagement.msg.notFound', { shop: shopId }));
      return;
    }

    shopData.currentShopId = shopId;
    $gameMessage.add(T('ShopManagement.msg.currentShop', { shop: shopId }));
    window.skipLocalization = false;

  });

  // NOTE: The earlier "openShopManagement" registration that referenced a bare
  // (undefined) Scene_ShopManagement was dead — the window-guarded registration
  // below overwrote it. Removed to avoid the latent ReferenceError.

  PluginManager.registerCommand(pluginName, "closeShopPermanently", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const shopId = args.shopId;
    const shop = shopData.shops[shopId];
    window.skipLocalization = true;

    if (!shop) {
      $gameMessage.add(T('ShopManagement.msg.notFound', { shop: shopId }));
      return;
    }
    window.skipLocalization = false;

    // Turn off the switch
    $gameSwitches.setValue(shop.switchId, false);

    // Delete shop data
    delete shopData.shops[shopId];

    // Clear current shop if it was this one
    if (shopData.currentShopId === shopId) {
      shopData.currentShopId = null;
    }
    window.skipLocalization = true;

    $gameMessage.add(T('ShopManagement.msg.closed', { shop: shopId }));
    window.skipLocalization = false;

  });

  PluginManager.registerCommand(pluginName, "startWork", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const shop = getCurrentShop();
    if (!shop) {
      $gameMessage.add(T('ShopManagement.msg.noShopInit'));
      return;
    }

    shop.isWorking = true;

    // Remove actors 2 and 3 from party
    if ($gameParty._actors.includes(2)) {
      $gameParty.removeActor(2);
    }
    if ($gameParty._actors.includes(3)) {
      $gameParty.removeActor(3);
    }

    // Start NPC systems
    shop.npcProducingTimer = 0;
    window.skipLocalization = true;

    $gameMessage.add(T('ShopManagement.msg.nowOpen', { shop: shop.id }));
    window.skipLocalization = false;

  });

  PluginManager.registerCommand(pluginName, "stopWork", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const shop = getCurrentShop();
    if (!shop) return;

    shop.isWorking = false;

    // Re-add actors 2 and 3 to party
    $gameParty.addActor(2);
    $gameParty.addActor(3);

    // Stop NPC systems
    shop.npcProducingTimer = 0;
    shopData.globalData.currentDelivery = null;

    $gameMessage.add(T('ShopManagement.msg.shiftEnded'));
  });

  PluginManager.registerCommand(pluginName, "switchRole", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const shop = getCurrentShop();
    if (!shop) return;

    shop.currentRole = args.role;
    $gameMessage.add(T('ShopManagement.msg.switchedRole', { role: args.role }));
  });

  PluginManager.registerCommand(pluginName, "newDelivery", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const validMaps = findDeliveryMaps();
    if (validMaps.length === 0) {
      $gameMessage.add(T('ShopManagement.msg.noLocations'));
      return;
    }

    const randomMap = validMaps[Math.floor(Math.random() * validMaps.length)];

    // Generate random NPC details
    // i18n-ignore-start  customer given names, kept as proper nouns
    const npcNames = [
      "Sarah",
      "Mike",
      "Emma",
      "John",
      "Lisa",
      "David",
      "Amy",
      "Tom",
      "Jessica",
      "Robert",
    ];
    // i18n-ignore-end
    const npcSprites = [
      "Actor1",
      "Actor2",
      "Actor3",
      "People1",
      "People2",
      "People3",
      "People4",
    ];

    shopData.globalData.currentDelivery = {
      mapId: randomMap,
      startTime: Date.now(),
    };

    shopData.globalData.deliveryNPC = {
      name: npcNames[Math.floor(Math.random() * npcNames.length)],
      spriteName: npcSprites[Math.floor(Math.random() * npcSprites.length)],
      spriteIndex: Math.floor(Math.random() * 8),
    };

    // Start the 2-minute timer
    $gameTimer.start(deliveryTimeLimit * 60);

    // This would activate the Delivery event's self switch A
    $gameSelfSwitches.setValue([randomMap, 1, "A"], true);

    // Get map name
    const mapName = getMapDisplayName(randomMap);

    $gameMessage.add(T('ShopManagement.msg.newDelivery'));
    $gameMessage.add(T('ShopManagement.msg.customer', { name: shopData.globalData.deliveryNPC.name }));
    $gameMessage.add(T('ShopManagement.msg.location', { location: mapName }));
    $gameMessage.add(
      T('ShopManagement.msg.timeLimit', {
        time: `${Math.floor(deliveryTimeLimit / 60)}:${(deliveryTimeLimit % 60)
          .toString()
          .padStart(2, "0")}`,
      })
    );
  });

  PluginManager.registerCommand(pluginName, "completeDelivery", (args) => {
    refreshEconomy(); // ADD THIS LINE
    if (!shopData.globalData.currentDelivery) {
      $gameMessage.add(T('ShopManagement.msg.noDelivery'));
      return;
    }

    // Check if delivery was on time (read timer state BEFORE stopping it)
    const timeLeft = $gameTimer.seconds();
    const onTime = $gameTimer.isWorking() && timeLeft > 0;

    // Stop the timer
    $gameTimer.stop();

    // Turn off delivery event switch
    const mapId = shopData.globalData.currentDelivery.mapId;
    $gameSelfSwitches.setValue([mapId, 1, "A"], false);

    // Calculate gold based on time
    let gold =
      Math.floor(Math.random() * (deliveryMaxGold - deliveryMinGold + 1)) +
      deliveryMinGold;

    if (!onTime) {
      gold = Math.floor(gold * 0.5);
      $gameMessage.add(T('ShopManagement.msg.deliveryLate'));
    } else {
      $gameMessage.add(T('ShopManagement.msg.deliveryDone'));
    }

    $gameParty.gainGold(gold);
    $gameMessage.add(T('ShopManagement.msg.earned', { amount: formatEuroPrice(gold) }));
    // Running the route is what teaches the route (Shipping, 742).
    if (window.SpecializationXP) {
      window.SpecializationXP.awardCapped('Shipping', onTime ? 2 : 1);
    }

    // Reset and start new delivery
    shopData.globalData.currentDelivery = null;
    PluginManager.callCommand(this, pluginName, "newDelivery", {});
  });

  PluginManager.registerCommand(pluginName, "orderMaterials", (args) => {
    refreshEconomy(); // ADD THIS LINE
    const shop = getCurrentShop();
    if (!shop) {
      $gameMessage.add(T('ShopManagement.msg.noShop'));
      return;
    }

    const itemId = Number(args.materialId);
    const amount = Number(args.amount);

    if (itemId < materialStartId || itemId > materialEndId) {
      $gameMessage.add(T('ShopManagement.msg.badMaterial'));
      return;
    }

    shop.warehouseInventory[itemId] =
      (shop.warehouseInventory[itemId] || 0) + amount;

    const item = $dataItems[itemId];
    $gameMessage.add(T('ShopManagement.msg.ordered', { count: amount, material: item.name }));
  });

  PluginManager.registerCommand(pluginName, "showDeliveryInfo", (args) => {
    refreshEconomy(); // ADD THIS LINE
    if (!shopData.globalData.currentDelivery) {
      $gameMessage.add(T('ShopManagement.msg.noDelivery'));
      return;
    }

    const mapName = getMapDisplayName(
      shopData.globalData.currentDelivery.mapId
    );
    const npc = shopData.globalData.deliveryNPC;

    $gameMessage.add(T('ShopManagement.msg.deliveryHeader'));
    $gameMessage.add(T('ShopManagement.msg.customer', { name: npc.name }));
    $gameMessage.add(
      T('ShopManagement.msg.character', { sprite: npc.spriteName, index: npc.spriteIndex + 1 })
    );
    $gameMessage.add(T('ShopManagement.msg.location', { location: mapName }));

    if ($gameTimer.isWorking()) {
      const seconds = Math.floor($gameTimer.seconds());
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      $gameMessage.add(
        T('ShopManagement.msg.timeLeft',
          { minutes: minutes, seconds: secs.toString().padStart(2, "0") })
      );
    } else {
      $gameMessage.add(T('ShopManagement.msg.timerOff'));
    }
  });

  // NPC Production System (runs in background)
  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);

    const shop = getCurrentShop();
    if (shop && shop.isWorking) {
      updateNPCProducing(shop);
    }
  };

  function updateNPCProducing(shop) {
    // Check if NPC producer event exists and is on the producing tile
    const producerEvent = $gameMap.event(npcProducerEventId);
    if (!producerEvent) return;

    // Get the tile ID at the producer's position
    const x = producerEvent.x;
    const y = producerEvent.y;

    // Check all layers for the producing tile
    let isOnProducingTile = false;
    for (let z = 0; z < 4; z++) {
      const tileId = $gameMap.tileId(x, y, z);
      if (tileId === producingTileId) {
        isOnProducingTile = true;
        break;
      }
    }

    // Only proceed with production if on the correct tile
    if (!isOnProducingTile) {
      shop.npcProducingTimer = 0;
      return;
    }

    // Increment producing timer
    shop.npcProducingTimer++;

    if (shop.npcProducingTimer >= producingInterval) {
      shop.npcProducingTimer = 0;

      // Try to produce random item from shop's category
      const categoryItems = getCategoryItems(shop.category);

      if (categoryItems.length > 0) {
        const randomItem =
          categoryItems[Math.floor(Math.random() * categoryItems.length)];
        const recipe = getRecipe(randomItem);

        if (recipe && hasIngredients(recipe, shop)) {
          consumeIngredients(recipe, shop);
          addToStock(randomItem.id, 1, shop);

          // Visual feedback for production
          $gameTemp.requestAnimation([producerEvent], 1229);

          debugLog(
            `NPC produced ${randomItem.name} at tile ${producingTileId}`
          );
        }
      }
    }
  }

  // ── Window / Scene UI removed, handled by ShopManagementUI.js ─────────

  // Debugging helper (kept for console use)
  function addItemToShop(shopId, itemId, amount, isStock = true) {
    const shop = shopData.shops[shopId];
    if (!shop) { debugLog(`Shop ${shopId} not found!`); return false; }
    if (isStock) {
      // Stock is slot-keyed ({itemId, amount} objects); route through addToStock
      return addToStock(itemId, amount, shop);
    }
    shop.warehouseInventory[itemId] = (shop.warehouseInventory[itemId] || 0) + amount;
    return true;
  }

  // Expose data API for ShopManagementUI.js
  window.ShopManagement = {
    getData:               () => shopData,
    getCurrentShop,
    goldToEuros,
    formatEuroPrice,
    isItemInCategory,
    getRecipe,
    hasIngredients,
    consumeIngredients,
    addToStock,
    removeFromStock,
    getMapDisplayName,
    defaultPriceMultiplier,
  };

  // Debug globals
  window.$shopData       = shopData;
  window.$addItemToShop  = addItemToShop;
  window.$getCurrentShop = getCurrentShop;
  window.$formatEuroPrice = formatEuroPrice;

  // Plugin commands, UI scene is defined in ShopManagementUI.js
  PluginManager.registerCommand(pluginName, 'openShopManagement', () => {
    if (window.Scene_ShopManagement) SceneManager.push(window.Scene_ShopManagement);
  });

  PluginManager.registerCommand(pluginName, 'openStock', () => {
    window._shopMgmtInitTab = 'stock';
    if (window.Scene_ShopManagement) SceneManager.push(window.Scene_ShopManagement);
  });

  PluginManager.registerCommand(pluginName, 'openWarehouse', () => {
    window._shopMgmtInitTab = 'warehouse';
    if (window.Scene_ShopManagement) SceneManager.push(window.Scene_ShopManagement);
  });

  PluginManager.registerCommand(pluginName, 'startProducingMiniGame', () => {
    const shop = getCurrentShop();
    if (!shop) { $gameMessage.add(T('ShopManagement.msg.noShop')); return; }
    if (!shop.isWorking) { $gameMessage.add(T('ShopManagement.msg.mustBeOpen')); return; }
    const categoryItems = $dataItems.filter(item => item && isItemInCategory(item, shop.category));
    if (categoryItems.length > 0) {
      const randomItem = categoryItems[Math.floor(Math.random() * categoryItems.length)];
      const recipe = getRecipe(randomItem);
      if (recipe && hasIngredients(recipe, shop)) {
        consumeIngredients(recipe, shop);
        addToStock(randomItem.id, 1, shop);
        $gameMessage.add(T('ShopManagement.msg.produced', { item: randomItem.name }));
      } else {
        $gameMessage.add(T('ShopManagement.msg.notEnoughMats'));
      }
    }
  });
})();
