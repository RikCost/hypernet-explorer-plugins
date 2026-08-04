/*:
 * @target MZ
 * @plugindesc Opens a shop with a fixed-per-location item set (seeded by map coordinates and world seed) whose daily stock is rerolled each in-game day.
 * @author OmniLex
 *
 * @command OpenDailyShop
 * @text Open Daily Shop
 * @desc Opens the randomized shop based on event location and date. Excludes food items.
 *
 * @command randomDailyTavern
 * @text Open Daily Tavern
 * @desc Opens the randomized tavern with only food items based on event location and date.
 *
 * @command openDailyArmor
 * @text Open Daily Armor Shop
 * @desc Opens the randomized armor shop with only armor items based on event location and date.
 *
 * @command openDailyWeapon
 * @text Open Daily Weapon Shop
 * @desc Opens the randomized weapon shop with only weapon items based on event location and date.
 *
 * @command openDailyPharmacy
 * @text Open Daily Pharmacy
 * @desc Opens the randomized pharmacy with only medical category items based on event location and date.
 *
 * @command openDailyMagicShop
 * @text Open Daily Magic Shop
 * @desc Opens the randomized magic shop with only potion, magic, and monster category items based on event location and date.
 *
 * @command openDailyLuxury
 * @text Open Daily Luxury Shop
 * @desc Opens the randomized luxury shop with artisan category items or high-price items (>300000 gold) based on event location and date.
 *
 * @command openDailyAdventurer
 * @text Open Daily Adventurer Shop
 * @desc Opens the randomized adventurer shop with medical, food, weapons, armor, counterfeits, and magic category items based on event location and date.
 *
 * @command openDailyLibrary
 * @text Open Daily Library Shop
 * @desc Opens the randomized adventurer shop with book items based on event location and date.
 *
 * @command openDailyTools
 * @text Open Daily Tools Shop
 * @desc Opens the randomized tools shop with items tagged <Category: Essential> based on event location and date.
 *
 * @command openDailyAlchemistry
 * @text Open Daily Alchemistry Shop
 * @desc Opens the randomized alchemistry shop with only alchemistry category items based on event location and date.
 *
 * @command openOrganTrader
 * @text Open Organ Trader
 * @desc Opens the organ trader shop selling only BodyPart category items based on event location and date.
 *
 * @command openThemedShop
 * @text Open Themed Shop (ID based)
 * @desc Opens a themed shop whose pool is a hand-picked set of item IDs. Selection rerolls daily.
 *
 * @arg shopType
 * @text Shop Type
 * @type select
 * @option Academy Bookstore
 * @value academy
 * @option Antiques Dealer
 * @value antiques
 * @option Arctic Outfitter
 * @value arcticOutfitter
 * @option Augmentation Clinic
 * @value cyberClinic
 * @option Bakery
 * @value bakery
 * @option Betting Parlor
 * @value bettingParlor
 * @option Butcher
 * @value butcher
 * @option Camping Outfitter
 * @value camping
 * @option Casalinghi
 * @value casalinghi
 * @option Cheese & Deli
 * @value deli
 * @option Coffee House
 * @value cafe
 * @option Drogheria
 * @value drogheria
 * @option Electronics Store
 * @value electronics
 * @option Enoteca
 * @value enoteca
 * @option Fast Food Joint
 * @value fastFood
 * @option Fertility Clinic
 * @value fertilityClinic
 * @option Fisherman's Shop
 * @value fisherman
 * @option Florist
 * @value florist
 * @option Garage
 * @value garage
 * @option Gift Shop
 * @value giftShop
 * @option Greengrocer
 * @value greengrocer
 * @option Grimoire Emporium
 * @value grimoire
 * @option Gym Supplies
 * @value gym
 * @option Hardware Store
 * @value hardware
 * @option Hunter's Lodge
 * @value hunter
 * @option Ice Cream Parlor
 * @value iceCream
 * @option Jeweler
 * @value jeweler
 * @option Jungle Trader
 * @value jungleTrader
 * @option Junk Shop
 * @value junkShop
 * @option Liquor Store
 * @value liquor
 * @option Materials Depot
 * @value materials
 * @option Music Store
 * @value musicStore
 * @option Newsstand
 * @value newsstand
 * @option Occult Curiosity Shop
 * @value occult
 * @option Optician
 * @value optician
 * @option Pet Shop
 * @value petShop
 * @option Pizzeria
 * @value pizzeria
 * @option Reliquary
 * @value reliquary
 * @option Spy Supplier
 * @value spy
 * @option Stationery Shop
 * @value stationery
 * @option Street Dealer
 * @value streetDealer
 * @option Street Food Stall
 * @value streetFood
 * @option Supermarket
 * @value supermarket
 * @option Surplus Armory
 * @value surplusArmory
 * @option Tabaccheria
 * @value tabaccheria
 * @option Tailor
 * @value tailor
 * @option Toy Store
 * @value toyStore
 * @option Trattoria
 * @value trattoria
 * @option Travel Agency
 * @value travelAgency
 * @option Wellness Boutique
 * @value wellness
 * @default supermarket
 * @desc Which themed shop to open.
 *
 * @command openDailySpellShop
 * @text Open Daily Spell Shop
 * @desc Teaches spells (Magic only) drawn from a few randomly chosen magic schools. Rerolls daily.
 *
 * @command openDailySkillShop
 * @text Open Daily Skill Shop
 * @desc Teaches skills (Skills only) drawn from a few randomly chosen skill categories. Rerolls daily.
*/

(() => {
  const pluginName = "RandomDailyShop";

  // Items always stocked in the tavern, regardless of the daily random selection
  const TAVERN_FIXED_IDS = [499, 179, 573, 22, 39, 24, 438, 535, 430, 439, 460, 518, 468, 529, 188, 182, 183, 184];

  // Parse game date from variable 113
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

  // Utility to get game date string (YYYY-MM-DD) from variable 113
  function getCurrentDateKey() {
    const gameDate = getGameDateFromVariable();
    // Format to YYYY-MM-DD (e.g., "2001-01-01")
    const yearStr = gameDate.year.toString();
    const monthStr = String(gameDate.month + 1).padStart(2, '0');
    const dayStr = String(gameDate.day).padStart(2, '0');
    return `${yearStr}-${monthStr}-${dayStr}`;
  }

  // Simple seeded random number generator
  function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  // Canonical world seed (history seed) used to make every shop world-consistent
  function getWorldSeed() {
    let historySeed = 19002001;
    if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
      historySeed = window.HistoryManager.getSeed();
    } else if (typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._historySeed !== undefined) {
      historySeed = $gameSystem._historySeed;
    }
    return historySeed >>> 0;
  }

  // Generate seed from world seed, map ID, x, y coordinates, and date
  function generateSeed(mapId, x, y, dateKey) {
    const dateNum = parseInt(dateKey.replace(/-/g, ''), 10);
    const base = mapId * 10000000 + x * 10000 + y * 100 + (dateNum % 10000);
    return (base ^ getWorldSeed()) >>> 0;
  }

  // Seeded shuffle using the generated seed
  function seededShuffle(array, seed) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = Math.floor((seed / 233280) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Small deterministic string hash so a shop-type label can act as a stable
  // per-kind salt on top of the mapId/x/y/world seed.
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  }

  // Fixed per-shop seed: identical every day, salted by shop kind so two shop
  // types sharing coordinates never draw the same item ordering.
  function generateLocationSeed(mapId, x, y, kind) {
    const base = mapId * 10000000 + x * 10000 + y * 100;
    return (base ^ getWorldSeed() ^ hashString(kind)) >>> 0;
  }

  // How many items a shop stocks: fixed per-location, drawn once from 6-12.
  function pickShopItemCount(seed) {
    seed = (seed * 9301 + 49297) % 233280;
    return 6 + Math.floor((seed / 233280) * 7);
  }

  // Category detection functions
  function isFoodItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: food>') ||
           item.note.toLowerCase().includes('<category:food>');
  }

  function isMedicalItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: medical>') ||
           item.note.toLowerCase().includes('<category:medical>');
  }

  function isPotionItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: potion>') ||
           item.note.toLowerCase().includes('<category:potion>');
  }

  function isMagicItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: magic>') ||
           item.note.toLowerCase().includes('<category:magic>');
  }

  function isMonsterItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: monsters>') ||
           item.note.toLowerCase().includes('<category:monsters>');
  }

  function isArtisanItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: artisan>') ||
           item.note.toLowerCase().includes('<category:artisan>');
  }

  function isCounterfeitItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: counterfeits>') ||
           item.note.toLowerCase().includes('<category:counterfeits>');
  }
  function isBookItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: books>') ||
           item.note.toLowerCase().includes('<category:books>');
  }
  function isEssentialItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: tools>') ||
            item.note.toLowerCase().includes('<category:tools>');
  }

  function isAlchemistryItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: alchemistry>') ||
           item.note.toLowerCase().includes('<category:alchemistry>');
  }

  function isBodyPartItem(item) {
    if (!item || !item.note) return false;
    return item.note.toLowerCase().includes('<category: bodypart>') ||
           item.note.toLowerCase().includes('<category:bodypart>');
  }
  function isHighValueItem(item) {
    return item && item.price && item.price > 300000;
  }

  function isArtifact(item) {
    if (!item) return false;
    return item.id >= 1500 || (item.note && item.note.toLowerCase().includes('<category: artifact>'));
  }

  function injectRareArtifact(items, seed, typeStr) {
    const isSandbox = (typeof $gameSystem !== 'undefined' && $gameSystem._isSandboxMode) || 
                      (typeof $gameParty !== 'undefined' && $gameParty.leader() && $gameParty.leader().name().toLowerCase() === "test");

    if (isSandbox || seededRandom(seed + 999) < 0.02) { // 100% in sandbox, 2% otherwise
      const validArtifacts = [];
      const checkArtifact = (item) => {
        if (!item || !isArtifact(item)) return false;
        if (typeof $gameParty !== 'undefined' && $gameParty.hasItem(item, true)) return false;
        return true;
      };

      if (typeStr === 'item' || typeStr === 'all') {
        if (typeof $dataItems !== 'undefined') {
          for (let i = 1500; i < $dataItems.length; i++) {
            if (checkArtifact($dataItems[i])) validArtifacts.push($dataItems[i]);
          }
        }
      }
      if (typeStr === 'weapon' || typeStr === 'all') {
        if (typeof $dataWeapons !== 'undefined') {
          for (let i = 1500; i < $dataWeapons.length; i++) {
            if (checkArtifact($dataWeapons[i])) validArtifacts.push($dataWeapons[i]);
          }
        }
      }
      if (typeStr === 'armor' || typeStr === 'all') {
        if (typeof $dataArmors !== 'undefined') {
          for (let i = 1500; i < $dataArmors.length; i++) {
            if (checkArtifact($dataArmors[i])) validArtifacts.push($dataArmors[i]);
          }
        }
      }
      if (validArtifacts.length > 0) {
        const art = validArtifacts[Math.floor(seededRandom(seed + 888) * validArtifacts.length)];
        if (items.length > 0) items[0] = art;
        else items.push(art);
      }
    }
    return items;
  }

  // Get all available items from database
  function getAllItems(excludeFood = false) {
    const allItems = [];

    // Collect all valid item entries
    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (item && item.name) {
        if (excludeFood && isFoodItem(item)) continue;
        if (isArtifact(item)) continue;
        if (isBodyPartItem(item)) continue;
        allItems.push(item);
      }
    }
    for (let i = 1; i < $dataWeapons.length; i++) {
      const weapon = $dataWeapons[i];
      if (weapon && weapon.name && !isArtifact(weapon)) allItems.push(weapon);
    }
    for (let i = 1; i < $dataArmors.length; i++) {
      const armor = $dataArmors[i];
      if (armor && armor.name && !isArtifact(armor)) allItems.push(armor);
    }

    return allItems;
  }

  // Get only food items from database
  function getFoodItems() {
    const foodItems = [];

    // Collect all valid food item entries
    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (item && item.name && isFoodItem(item)) {
        foodItems.push(item);
      }
    }

    return foodItems;
  }
  function getFoodItems() {
    const foodItems = [];

    // Collect all valid food item entries
    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (item && item.name && isFoodItem(item)) {
        foodItems.push(item);
      }
    }

    return foodItems;
  }
  function getBookItems() {
    const bookItems = [];

    // Collect all valid medical item entries
    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (item && item.name && isBookItem(item)) {
        bookItems.push(item);
      }
    }

    return bookItems;
  }

  function getMedicalItems() {
    const medicalItems = [];

    // Collect all valid medical item entries
    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (item && item.name && isMedicalItem(item)) {
        medicalItems.push(item);
      }
    }

    return medicalItems;
  }

  function getAlchemistryItems() {
    const alchemistryItems = [];
    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (item && item.name && isAlchemistryItem(item)) {
        alchemistryItems.push(item);
      }
    }
    return alchemistryItems;
  }

  function getMagicShopItems() {
    const magicItems = [];

    // Collect all valid potion, magic, and monster items
    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (item && item.name && (isPotionItem(item) || isMagicItem(item) || isMonsterItem(item))) {
        magicItems.push(item);
      }
    }

    return magicItems;
  }

  // Fixed item selection per shop, cached by location only (mapId_x_y) so the
  // assortment never changes; only the daily stock rolled by ItemSystemShop does.
  const shopInventoryCache = {};
  const tavernInventoryCache = {};
  const libraryInventoryCache = {};

  const armorShopCache = {};
  const weaponShopCache = {};
  const pharmacyCache = {};
  const magicShopCache = {};
  const luxuryShopCache = {};
  const adventurerShopCache = {};
  const toolsShopCache = {};
  const alchemistryShopCache = {};
  const organTraderCache = {};

  function getShopItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!shopInventoryCache[locKey]) {
      const allItems = getAllItems(true); // Exclude food items
      const seed = generateLocationSeed(mapId, x, y, 'shop');
      const shuffled = seededShuffle(allItems, seed);
      shopInventoryCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    const items = [...shopInventoryCache[locKey]];
    const dailySeed = generateSeed(mapId, x, y, getCurrentDateKey());
    return injectRareArtifact(items, dailySeed, 'all');
  }

  function getTavernItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!tavernInventoryCache[locKey]) {
      // Exclude fixed items from the random pool to avoid duplicates
      const fixedSet = new Set(TAVERN_FIXED_IDS);
      const foodItems = getFoodItems().filter(item => !fixedSet.has(item.id));
      const seed = generateLocationSeed(mapId, x, y, 'tavern');
      const shuffled = seededShuffle(foodItems, seed);
      tavernInventoryCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    return tavernInventoryCache[locKey];
  }


  
  function getLibraryItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!libraryInventoryCache[locKey]) {
      const foodItems = getBookItems();
      const seed = generateLocationSeed(mapId, x, y, 'library');
      const shuffled = seededShuffle(foodItems, seed);
      libraryInventoryCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    return libraryInventoryCache[locKey];
  }

  function getArmorShopItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!armorShopCache[locKey]) {
      const allArmors = [];
      for (let i = 1; i < $dataArmors.length; i++) {
        const armor = $dataArmors[i];
        if (armor && armor.name && !isArtifact(armor)) allArmors.push(armor);
      }
      const seed = generateLocationSeed(mapId, x, y, 'armor');
      const shuffled = seededShuffle(allArmors, seed);
      armorShopCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    const items = [...armorShopCache[locKey]];
    const dailySeed = generateSeed(mapId, x, y, getCurrentDateKey());
    return injectRareArtifact(items, dailySeed, 'armor');
  }

  function getWeaponShopItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!weaponShopCache[locKey]) {
      const allWeapons = [];
      for (let i = 1; i < $dataWeapons.length; i++) {
        const weapon = $dataWeapons[i];
        if (weapon && weapon.name && !isArtifact(weapon)) allWeapons.push(weapon);
      }
      const seed = generateLocationSeed(mapId, x, y, 'weapon');
      const shuffled = seededShuffle(allWeapons, seed);
      weaponShopCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    const items = [...weaponShopCache[locKey]];
    const dailySeed = generateSeed(mapId, x, y, getCurrentDateKey());
    return injectRareArtifact(items, dailySeed, 'weapon');
  }

  function getPharmacyItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!pharmacyCache[locKey]) {
      const medicalItems = getMedicalItems();
      const seed = generateLocationSeed(mapId, x, y, 'pharmacy');
      const shuffled = seededShuffle(medicalItems, seed);
      pharmacyCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    return pharmacyCache[locKey];
  }

  function getMagicShopInventory(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!magicShopCache[locKey]) {
      const magicItems = getMagicShopItems();
      const seed = generateLocationSeed(mapId, x, y, 'magic');
      const shuffled = seededShuffle(magicItems, seed);
      magicShopCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    return magicShopCache[locKey];
  }



  function getLuxuryShopItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!luxuryShopCache[locKey]) {
      const luxuryItems = [];

      // Collect artisan items and high-value items from all sources
      for (let i = 1; i < $dataItems.length; i++) {
        const item = $dataItems[i];
        if (item && item.name && (isArtisanItem(item) || isHighValueItem(item))) {
          if (!isArtifact(item)) luxuryItems.push(item);
        }
      }
      for (let i = 1; i < $dataWeapons.length; i++) {
        const weapon = $dataWeapons[i];
        if (weapon && weapon.name && isHighValueItem(weapon)) {
          if (!isArtifact(weapon)) luxuryItems.push(weapon);
        }
      }
      for (let i = 1; i < $dataArmors.length; i++) {
        const armor = $dataArmors[i];
        if (armor && armor.name && isHighValueItem(armor)) {
          if (!isArtifact(armor)) luxuryItems.push(armor);
        }
      }

      const seed = generateLocationSeed(mapId, x, y, 'luxury');
      const shuffled = seededShuffle(luxuryItems, seed);
      luxuryShopCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    const items = [...luxuryShopCache[locKey]];
    const dailySeed = generateSeed(mapId, x, y, getCurrentDateKey());
    return injectRareArtifact(items, dailySeed, 'all');
  }

  function getAdventurerShopItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!adventurerShopCache[locKey]) {
      const adventurerItems = [];

      // Collect medical, food, counterfeits, potion, magic, monster items
      for (let i = 1; i < $dataItems.length; i++) {
        const item = $dataItems[i];
        if (item && item.name && (isMedicalItem(item) || isFoodItem(item) ||
            isCounterfeitItem(item) || isPotionItem(item) ||
            isMagicItem(item) || isMonsterItem(item))) {
          if (!isArtifact(item)) adventurerItems.push(item);
        }
      }

      // Also add all weapons and armor for adventurer shop
      for (let i = 1; i < $dataWeapons.length; i++) {
        const weapon = $dataWeapons[i];
        if (weapon && weapon.name && !isArtifact(weapon)) {
          adventurerItems.push(weapon);
        }
      }
      for (let i = 1; i < $dataArmors.length; i++) {
        const armor = $dataArmors[i];
        if (armor && armor.name && !isArtifact(armor)) {
          adventurerItems.push(armor);
        }
      }

      const seed = generateLocationSeed(mapId, x, y, 'adventurer');
      const shuffled = seededShuffle(adventurerItems, seed);
      adventurerShopCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    const items = [...adventurerShopCache[locKey]];
    const dailySeed = generateSeed(mapId, x, y, getCurrentDateKey());
    return injectRareArtifact(items, dailySeed, 'all');
  }

  // Where the shop being opened stands. Callers that pass explicit coordinates
  // (remote orders placed from a seat) get that venue's own stock; everyone else
  // is located from the event that ran the plugin command, as before.
  function resolveShopLocation(mapId, x, y) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { mapId: Number.isFinite(mapId) ? mapId : $gameMap.mapId(), x: x, y: y };
    }
    const event = $gameMap.event($gameMap._interpreter.eventId());
    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return null;
    }
    return { mapId: $gameMap.mapId(), x: event.x, y: event.y };
  }

  // Open the shop with location-based random inventory (excluding food)
  function openDailyShop() {
    // Get the event's coordinates
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getShopItems(mapId, x, y);

    const goods = items.map(item => {
      let type;
      if (DataManager.isItem(item)) type = 0;
      else if (DataManager.isWeapon(item)) type = 1;
      else if (DataManager.isArmor(item)) type = 2;
      else return null;
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  // Open the tavern with location-based random food inventory
  function openDailyTavern(mapId, x, y) {
    const loc = resolveShopLocation(mapId, x, y);
    if (!loc) return;

    const randomItems = getTavernItems(loc.mapId, loc.x, loc.y);

    // Fixed items always appear first
    const fixedGoods = TAVERN_FIXED_IDS
      .map(id => $dataItems[id])
      .filter(item => item && item.name)
      .map(item => [0, item.id, 0, 0]);

    const randomGoods = randomItems.map(item => {
      let type;
      if (DataManager.isItem(item)) type = 0;
      else if (DataManager.isWeapon(item)) type = 1;
      else if (DataManager.isArmor(item)) type = 2;
      else return null;
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    const goods = [...fixedGoods, ...randomGoods];

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  // Open the armor shop with location-based random armor
  function openDailyArmor() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getArmorShopItems(mapId, x, y);

    const goods = items.map(item => {
      let type = 2; // Armor type
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  // Open the weapon shop with location-based random weapons
  function openDailyWeapon() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getWeaponShopItems(mapId, x, y);

    const goods = items.map(item => {
      let type = 1; // Weapon type
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  // Open the pharmacy with location-based random medical items
  function openDailyPharmacy() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getPharmacyItems(mapId, x, y);

    const goods = items.map(item => {
      let type = 0; // Item type
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  // Open the magic shop with location-based random potions, magic, and monster items
  function openDailyMagicShop() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getMagicShopInventory(mapId, x, y);

    const goods = items.map(item => {
      let type = 0; // Item type
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

    function openDailyLibrary() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getLibraryItems(mapId, x, y);

    const goods = items.map(item => {
      let type = 0; // Item type
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }


  // Open the luxury shop with location-based random luxury items
  function openDailyLuxury() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getLuxuryShopItems(mapId, x, y);

    const goods = items.map(item => {
      let type;
      if (DataManager.isItem(item)) type = 0;
      else if (DataManager.isWeapon(item)) type = 1;
      else if (DataManager.isArmor(item)) type = 2;
      else return null;
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  function getToolsShopItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!toolsShopCache[locKey]) {
      const toolsItems = [];
      for (let i = 1; i < $dataItems.length; i++) {
        const item = $dataItems[i];
        if (item && item.name && isEssentialItem(item)) {
          toolsItems.push(item);
        }
      }
      const seed = generateLocationSeed(mapId, x, y, 'tools');
      const shuffled = seededShuffle(toolsItems, seed);
      toolsShopCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    return toolsShopCache[locKey];
  }

  // Open the adventurer shop with location-based random adventurer supplies
  function openDailyAdventurer() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getAdventurerShopItems(mapId, x, y);

    const goods = items.map(item => {
      let type;
      if (DataManager.isItem(item)) type = 0;
      else if (DataManager.isWeapon(item)) type = 1;
      else if (DataManager.isArmor(item)) type = 2;
      else return null;
      return [type, item.id, 0, 0];
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  function openDailyTools() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getToolsShopItems(mapId, x, y);

    const goods = items.map(item => {
      return [0, item.id, 0, 0]; // All tools are items
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  function getOrganTraderItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!organTraderCache[locKey]) {
      const bodyParts = [];
      for (let i = 1; i < $dataItems.length; i++) {
        const item = $dataItems[i];
        if (item && item.name && isBodyPartItem(item)) bodyParts.push(item);
      }
      const seed = generateLocationSeed(mapId, x, y, 'organTrader');
      const shuffled = seededShuffle(bodyParts, seed);
      organTraderCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    return organTraderCache[locKey];
  }

  function openOrganTrader() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getOrganTraderItems(mapId, x, y);

    const goods = items.map(item => [0, item.id, 0, 0]);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  function getAlchemistryShopItems(mapId, x, y) {
    const locKey = `${mapId}_${x}_${y}`;

    if (!alchemistryShopCache[locKey]) {
      const items = getAlchemistryItems();
      const seed = generateLocationSeed(mapId, x, y, 'alchemistry');
      const shuffled = seededShuffle(items, seed);
      alchemistryShopCache[locKey] = shuffled.slice(0, pickShopItemCount(seed));
    }

    return alchemistryShopCache[locKey];
  }

  function openDailyAlchemistryShop() {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    const mapId = $gameMap.mapId();
    const x = event.x;
    const y = event.y;

    const items = getAlchemistryShopItems(mapId, x, y);

    const goods = items.map(item => {
      return [0, item.id, 0, 0]; // All are items
    }).filter(Boolean);

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  //=========================================================================
  // ID-based themed shops
  //-------------------------------------------------------------------------
  // Unlike the category-driven shops above, these draw from a hand-picked set
  // of item IDs. A fixed 6-12 of them are chosen once per location (seeded by
  // map/coords/world seed/shop type) and never change; only the daily stock
  // of each chosen item varies.
  //   stockMult:  multiplies the per-item stock rolled by ItemSystemShop
  //   fixed:      IDs always on the shelf at every location of that shop type,
  //               listed first, on top of the random draw (same idea as
  //               TAVERN_FIXED_IDS). For items a mechanic depends on being
  //               buyable somewhere, e.g. the lockpick.
  //   dining:     venue that serves prepared food and drink, so a seated player
  //               can order from it remotely (see the remote-ordering section
  //               below). Grocers selling only raw supplies are left out.
  //=========================================================================
  const THEMED_SHOPS = {
    iceCream: {
      get label() { return T('DailyShop.shopType.iceCream'); },
      ids: [458, 469, 511, 540, 488, 543, 560, 589, 562, 432, 443, 439, 461,
            471, 472, 477, 719, 485, 467, 492, 448, 476, 590],
      dining: true
    },
    fastFood: {
      get label() { return T('DailyShop.shopType.fastFood'); },
      ids: [481, 519, 450, 451, 460, 462, 474, 500, 447, 457, 442, 445, 461,
            439, 458, 433, 468, 453, 720, 464, 441, 440, 436, 432],
      dining: true
    },
    gym: {
      get label() { return T('DailyShop.shopType.gym'); },
      ids: [52, 53, 36, 40, 41, 33, 55, 54, 26, 47, 17, 18, 23, 431, 463, 195,
            315, 325, 331, 832, 833, 834, 50, 723, 728, 91, 87, 38],
    },
    fisherman: {
      get label() { return T('DailyShop.shopType.fisherman'); },
      ids: [123, 167, 141, 425, 507, 523, 508, 501, 513, 576, 569, 531, 532,
            581, 120, 811, 813, 810, 155, 161, 116, 121, 807, 78, 805, 870],
    },
    supermarket: {
      get label() { return T('DailyShop.shopType.supermarket'); },
      ids: [418, 421, 423, 429, 431, 433, 435, 436, 437, 438, 440, 441, 442,
            443, 444, 445, 446, 447, 448, 452, 453, 454, 455, 456, 459, 463,
            464, 465, 466, 467, 471, 475, 492, 499, 510, 528, 533, 535, 536,
            862, 858, 1, 3, 5, 25, 115, 118, 119, 120, 127, 132, 136,
            177, 178, 179, 185, 711, 804, 806, 807],
      stockMult: 6
    },
    cafe: {
      get label() { return T('DailyShop.shopType.cafe'); },
      ids: [459, 528, 564, 547, 585, 467, 434, 455, 516, 574, 471, 439, 540,
            560, 468, 473, 196, 543, 511, 589, 719, 178, 711],
      dining: true
    },
    liquor: {
      get label() { return T('DailyShop.shopType.liquor'); },
      ids: [480, 498, 517, 535, 544, 572, 587, 552, 557, 568, 37, 178, 466,
            441, 440, 442, 445, 444, 449, 461, 898],
    },
    electronics: {
      get label() { return T('DailyShop.shopType.electronics'); },
      ids: [122, 133, 134, 136, 137, 143, 144, 149, 153, 154, 157, 160, 162,
            179, 185, 186, 190, 193, 721, 726, 394, 852, 853, 854, 135, 130,
            388, 387],
    },
    hardware: {
      get label() { return T('DailyShop.shopType.hardware'); },
      ids: [138, 156, 814, 811, 813, 132, 119, 807, 118, 121, 115, 870, 859,
            863, 867, 855, 856, 146, 406, 151, 374, 739, 861, 868, 805, 804],
      fixed: [374],
    },
    camping: {
      get label() { return T('DailyShop.shopType.camping'); },
      ids: [125, 126, 129, 815, 806, 813, 810, 807, 804, 809, 808, 120, 121,
            136, 137, 142, 116, 117, 152, 159, 161, 512, 421, 465, 466, 418,
            123, 811],
    },
    butcher: {
      get label() { return T('DailyShop.shopType.butcher'); },
      ids: [862, 430, 465, 452, 479, 486, 496, 497, 514, 522, 527, 529, 538,
            548, 573, 577, 550, 524, 493, 860, 575, 500, 505, 539],
    },
    bakery: {
      get label() { return T('DailyShop.shopType.bakery'); },
      ids: [454, 424, 419, 533, 456, 471, 439, 443, 488, 540, 511, 562, 560,
            589, 719, 539, 505, 536, 432, 428],
      dining: true
    },
    greengrocer: {
      get label() { return T('DailyShop.shopType.greengrocer'); },
      ids: [423, 437, 448, 476, 499, 435, 546, 554, 555, 583, 584, 591, 590,
            551, 578, 563, 565, 792, 858, 406, 660, 240, 492, 429],
    },
    deli: {
      get label() { return T('DailyShop.shopType.deli'); },
      ids: [510, 542, 828, 456, 462, 440, 524, 479, 438, 473, 550, 567, 535,
            452, 465, 493, 587, 466],
      dining: true
    },
    streetFood: {
      get label() { return T('DailyShop.shopType.streetFood'); },
      ids: [470, 478, 482, 484, 489, 490, 491, 494, 495, 502, 503, 504, 520,
            521, 525, 475, 477, 485, 501, 508, 530, 483, 487, 433],
      dining: true
    },
    trattoria: {
      get label() { return T('DailyShop.shopType.trattoria'); },
      ids: [518, 541, 549, 545, 553, 536, 531, 532, 540, 511, 473, 550, 524,
            720, 719, 535, 459, 510, 567, 573],
      dining: true
    },
    giftShop: {
      get label() { return T('DailyShop.shopType.giftShop'); },
      ids: [114, 192, 316, 318, 313, 311, 321, 322, 710, 128, 127, 113, 144,
            150, 163, 185, 189, 180, 211, 326, 332],
    },
    newsstand: {
      get label() { return T('DailyShop.shopType.newsstand'); },
      ids: [711, 178, 181, 182, 183, 187, 442, 445, 441, 436, 431, 418, 113,
            127, 159, 161, 179, 124, 528, 185],
    },
    tabaccheria: {
      get label() { return T('DailyShop.shopType.tabaccheria'); },
      ids: [178, 181, 182, 183, 187, 711, 113, 127, 124, 528, 442, 445, 436,
            441, 466, 179, 122, 153, 161, 159, 130, 185, 543, 459, 719, 184,
            535, 544, 480, 115],
    },
    hunter: {
      get label() { return T('DailyShop.shopType.hunter'); },
      ids: [78, 79, 712, 465, 486, 514, 515, 811, 145, 138, 121, 813, 129,
            774, 758, 766, 806, 868, 860, 512, 147, 76],
    },
    occult: {
      get label() { return T('DailyShop.shopType.occult'); },
      ids: [352, 354, 346, 675, 676, 683, 673, 724, 725, 650, 652, 97, 98,
            262, 264, 680, 349, 359, 360, 355, 679, 682, 348],
    },
    streetDealer: {
      get label() { return T('DailyShop.shopType.streetDealer'); },
      ids: [178, 22, 29, 30, 31, 35, 37, 380, 43, 39, 24, 32, 2, 356, 358,
            361, 376, 375, 381, 714],
    },
    spy: {
      get label() { return T('DailyShop.shopType.spy'); },
      ids: [374, 375, 377, 378, 379, 381, 382, 383, 384, 385, 386, 387, 388,
            389, 390, 391, 392, 393, 394, 148, 157, 158, 718],
      fixed: [374],
    },
    stationery: {
      get label() { return T('DailyShop.shopType.stationery'); },
      ids: [113, 127, 128, 148, 230, 647, 672, 386, 262, 711, 394, 393, 130,
            185, 159, 161, 145, 277],
    },
    toyStore: {
      get label() { return T('DailyShop.shopType.toyStore'); },
      ids: [124, 318, 726, 180, 710, 348, 347, 316, 432, 446, 181, 182, 183,
            187, 193, 192, 114, 186],
    },
    arcticOutfitter: {
      get label() { return T('DailyShop.shopType.arcticOutfitter'); },
      ids: [208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 155, 579, 529,
            815, 812, 655, 678, 121, 120, 467],
    },
    jungleTrader: {
      get label() { return T('DailyShop.shopType.jungleTrader'); },
      ids: [623, 624, 625, 626, 627, 628, 629, 630, 631, 632, 633, 634, 588,
            476, 472, 141, 810, 869],
    },
    wellness: {
      get label() { return T('DailyShop.shopType.wellness'); },
      ids: [604, 605, 606, 607, 608, 609, 610, 611, 177, 184, 434, 516, 574,
            869, 42, 229, 192, 4, 15, 13],
    },
    materials: {
      get label() { return T('DailyShop.shopType.materials'); },
      ids: [849, 850, 851, 852, 853, 854, 855, 856, 857, 858, 859, 860, 861,
            862, 863, 864, 865, 866, 867, 868, 869, 870, 871],
    },
    enoteca: {
      get label() { return T('DailyShop.shopType.enoteca'); },
      ids: [535, 587, 517, 572, 544, 568, 552, 557, 480, 498, 524, 510, 542,
            581, 550, 543, 466, 473, 567, 501, 528, 585],
      dining: true
    },
    pizzeria: {
      get label() { return T('DailyShop.shopType.pizzeria'); },
      ids: [536, 460, 462, 720, 473, 451, 450, 442, 445, 480, 535, 540, 719,
            510, 456, 532, 539, 505, 549, 518, 458, 481],
      dining: true
    },
    optician: {
      get label() { return T('DailyShop.shopType.optician'); },
      ids: [233, 142, 217, 242, 679, 683, 150, 249, 158, 144, 143, 867, 234,
            135, 676, 388, 390, 130],
    },
    jeweler: {
      get label() { return T('DailyShop.shopType.jeweler'); },
      ids: [242, 334, 332, 322, 328, 866, 865, 864, 211, 214, 649, 659, 685,
            675, 681, 677, 678, 674, 673, 316, 241, 663],
    },
    tailor: {
      get label() { return T('DailyShop.shopType.tailor'); },
      ids: [132, 861, 868, 235, 231, 239, 246, 212, 682, 384, 91, 330, 325,
            834, 326, 329, 152, 117, 116, 815],
    },
    musicStore: {
      get label() { return T('DailyShop.shopType.musicStore'); },
      ids: [236, 133, 134, 154, 185, 186, 190, 321, 213, 1428, 193, 726, 179,
            122, 184, 187, 543],
    },
    antiques: {
      get label() { return T('DailyShop.shopType.antiques'); },
      ids: [331, 324, 313, 327, 333, 97, 249, 241, 234, 150, 320, 710, 675,
            289, 262, 317, 312, 323, 294, 290],
    },
    florist: {
      get label() { return T('DailyShop.shopType.florist'); },
      ids: [114, 671, 792, 757, 681, 192, 240, 660, 670, 406, 858, 869, 690,
            165, 674, 626, 229, 119, 546],
    },
    petShop: {
      get label() { return T('DailyShop.shopType.petShop'); },
      ids: [27, 710, 145, 147, 680, 777, 752, 862, 78, 1423, 311, 121, 126,
            807, 869, 858, 32],
    },
    fertilityClinic: {
      get label() { return T('DailyShop.shopType.fertilityClinic'); },
      ids: [716, 717, 729, 730, 738, 737, 32, 733, 734, 887, 962, 958, 1, 884,
            19, 59, 949],
    },
    cyberClinic: {
      get label() { return T('DailyShop.shopType.cyberClinic'); },
      ids: [731, 732, 733, 734, 735, 736, 59, 763, 768, 769, 857, 851, 853,
            727, 722, 715, 852, 961, 960],
    },
    travelAgency: {
      get label() { return T('DailyShop.shopType.travelAgency'); },
      ids: [159, 161, 163, 155, 137, 135, 128, 129, 130, 152, 142, 164, 131,
            166, 668, 696, 234, 1442, 162, 120],
    },
    garage: {
      get label() { return T('DailyShop.shopType.garage'); },
      ids: [164, 131, 146, 909, 917, 854, 863, 928, 855, 814, 156, 167, 668,
            852, 870, 138, 811, 856, 864],
    },
    drogheria: {
      get label() { return T('DailyShop.shopType.drogheria'); },
      ids: [1, 177, 884, 890, 896, 883, 886, 894, 901, 905, 893, 115, 132,
            861, 118, 13, 11, 7, 867],
    },
    casalinghi: {
      get label() { return T('DailyShop.shopType.casalinghi'); },
      ids: [118, 119, 807, 804, 809, 120, 232, 1427, 542, 811, 115, 867, 805,
            121, 136, 179, 132, 870],
    },
    bettingParlor: {
      get label() { return T('DailyShop.shopType.bettingParlor'); },
      ids: [181, 182, 183, 187, 124, 311, 313, 323, 1437, 1440, 178, 544, 568,
            26, 346, 312, 322, 445],
    },
    reliquary: {
      get label() { return T('DailyShop.shopType.reliquary'); },
      ids: [45, 265, 278, 282, 293, 263, 275, 276, 115, 692, 1401, 498, 229,
            230, 673, 681, 355, 267, 266, 264],
    },
    surplusArmory: {
      get label() { return T('DailyShop.shopType.surplusArmory'); },
      ids: [512, 718, 76, 78, 80, 73, 79, 77, 712, 88, 1430, 1426, 136, 129,
            808, 141, 715, 940, 957, 811],
    },
    junkShop: {
      get label() { return T('DailyShop.shopType.junkShop'); },
      ids: [836, 828, 829, 830, 831, 832, 833, 834, 835, 710, 320, 317, 312,
            424, 709, 349, 346, 347, 356, 358, 361, 419, 423],
      fixed: [374],
    },
    academy: {
      get label() { return T('DailyShop.shopType.academy'); },
      ids: [1421, 1422, 1423, 1424, 1425, 1426, 1427, 1428, 1429, 1430, 1431,
            1433, 1435, 1436, 1437, 1438, 1440, 1441, 1442, 1443, 145, 147],
    },
    grimoire: {
      get label() { return T('DailyShop.shopType.grimoire'); },
      ids: [1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407, 1409, 1410, 1411,
            1412, 1413, 1414, 1415, 1416, 1417, 1418, 1419, 1420, 262],
    }
  };

  const themedShopCaches = {};

  function getThemedShopItems(shopType, mapId, x, y) {
    const def = THEMED_SHOPS[shopType];
    if (!def) {
      console.warn(`RandomDailyShop: unknown themed shop "${shopType}".`);
      return [];
    }

    const locKey = `${mapId}_${x}_${y}`;
    if (!themedShopCaches[shopType]) themedShopCaches[shopType] = {};
    const cache = themedShopCaches[shopType];

    if (!cache[locKey]) {
      // Always-stocked items come first and are kept out of the random draw so
      // they cannot show up twice.
      const fixedSet = new Set(def.fixed || []);
      const fixedItems = [...fixedSet]
        .map(id => $dataItems[id])
        .filter(item => item && item.name);
      // Dedupe the ID list so a typo'd repeat cannot eat two shelf slots.
      const pool = [...new Set(def.ids)]
        .filter(id => !fixedSet.has(id))
        .map(id => $dataItems[id])
        .filter(item => item && item.name);
      const seed = generateLocationSeed(mapId, x, y, shopType);
      const shuffled = seededShuffle(pool, seed);
      cache[locKey] = [...fixedItems, ...shuffled.slice(0, pickShopItemCount(seed))];
    }

    return cache[locKey];
  }

  // ItemSystemShop rolls the per-item stock; a shop can ask for a fatter roll
  // (supermarkets) by setting $gameTemp._dailyShopStockMult before the scene starts.
  if (typeof Scene_Shop !== 'undefined' && Scene_Shop.prototype.generateRandomStock) {
    const _generateRandomStock = Scene_Shop.prototype.generateRandomStock;
    Scene_Shop.prototype.generateRandomStock = function (item) {
      // A shop can run out of any given item for the day.
      if (Math.random() < 0.12) return 0;
      const base = _generateRandomStock.call(this, item);
      const mult = ($gameTemp && $gameTemp._dailyShopStockMult) || 1;
      return Math.max(1, Math.round(base * mult));
    };

    const _Scene_Shop_terminate_stockMult = Scene_Shop.prototype.terminate;
    Scene_Shop.prototype.terminate = function () {
      _Scene_Shop_terminate_stockMult.call(this);
      if ($gameTemp) $gameTemp._dailyShopStockMult = 1;
    };
  }

  function openThemedShop(shopType, mapId, x, y) {
    const def = THEMED_SHOPS[shopType];
    if (!def) {
      console.warn(`RandomDailyShop: unknown themed shop "${shopType}".`);
      return;
    }

    const loc = resolveShopLocation(mapId, x, y);
    if (!loc) return;

    const items = getThemedShopItems(shopType, loc.mapId, loc.x, loc.y);
    const goods = items.map(item => [0, item.id, 0, 0]);

    $gameTemp._dailyShopStockMult = def.stockMult || 1;

    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, false);
  }

  //=========================================================================
  // Remote ordering (dining venues)
  //-------------------------------------------------------------------------
  // A venue that serves prepared food or drink can be ordered from without
  // walking up to its counter: MovementInteractionSystem offers this from the
  // seated menu, so a player at a table can order across the room. The map is
  // scanned for events running one of this plugin's dining commands, and every
  // hit keeps the event's coordinates so the order draws that venue's own daily
  // stock rather than a fresh roll from wherever the player is sitting.
  //=========================================================================

  // Event plugin commands store the plugin's path-prefixed name
  // ("Economy/RandomDailyShop" on newer maps, bare "RandomDailyShop" on older
  // ones), so compare on the last path segment only.
  function isThisPlugin(name) {
    return String(name || "").split("/").pop() === pluginName;
  }

  function diningVenueForCommand(command, args) {
    if (command === "randomDailyTavern") {
      return { kind: "tavern", shopType: "", label: T('DailyShop.venue.tavern') };
    }
    if (command === "openThemedShop") {
      const shopType = String((args && args.shopType) || "").trim();
      const def = THEMED_SHOPS[shopType];
      if (def && def.dining) return { kind: "themed", shopType: shopType, label: def.label };
    }
    return null;
  }

  // Every dining venue on the current map, nearest first. Each entry carries the
  // venue's location plus its own opener, so callers never need to know which
  // flavour of shop command sits behind it.
  function findDiningVenues() {
    const venues = [];
    if (typeof $gameMap === "undefined" || !$gameMap || !$gameMap.events) return venues;

    for (const event of $gameMap.events()) {
      if (!event || event._erased) continue;
      const data = event.event();
      if (!data || !data.pages) continue;

      let venue = null;
      for (const page of data.pages) {
        for (const command of (page.list || [])) {
          if (command.code !== 357) continue;
          const params = command.parameters || [];
          if (!isThisPlugin(params[0])) continue;
          venue = diningVenueForCommand(params[1], params[3]);
          if (venue) break;
        }
        if (venue) break;
      }
      if (!venue) continue;

      venue.eventId = event.eventId();
      venue.mapId = $gameMap.mapId();
      venue.x = event.x;
      venue.y = event.y;
      venue.distance = $gamePlayer
        ? $gameMap.distance(event.x, event.y, $gamePlayer.x, $gamePlayer.y)
        : 0;
      venues.push(venue);
    }

    venues.sort((a, b) => a.distance - b.distance);
    return venues;
  }

  function openDiningVenue(venue) {
    if (!venue) return;
    if (venue.kind === "tavern") {
      openDailyTavern(venue.mapId, venue.x, venue.y);
      return;
    }
    openThemedShop(venue.shopType, venue.mapId, venue.x, venue.y);
  }

  //=========================================================================
  // Daily spell / skill teachers
  //-------------------------------------------------------------------------
  // Two shops that trade in abilities instead of goods. Each day the shop
  // draws a handful of schools (stypeId 1 = Magic) or categories
  // (stypeId 2 = Skills) and offers a slice of them for gold; buying teaches
  // the ability to the selected party member and clears it off the shelf.
  //=========================================================================
  const TEACH_SCHOOLS_PER_DAY = 3;   // how many schools/categories open each day
  const TEACH_OFFER_COUNT = 8;       // how many abilities end up on the shelf

  const isRealSkillEntry = s =>
    s && s.name && !s.name.startsWith("<") && !s.name.startsWith("ESK");

  const prettifySchool = s => String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2");

  function skillSchool(skill) {
    return skill && skill.meta && skill.meta.category ? String(skill.meta.category) : "";
  }

  // Gold price of an ability: driven by its upkeep, with esoteric and
  // forbidden lore charging what the market will bear.
  function teachingPrice(skill) {
    let price = 600 + (skill.mpCost || 0) * 260 + (skill.tpCost || 0) * 320;
    if (skill.meta && skill.meta.Esoteric) price *= 3;
    if (skill.meta && skill.meta.Forbidden) price *= 8;
    // Even a tutor's fee can be talked down (specialization 127).
    if (window.SpecializationXP) {
      price *= window.SpecializationXP.discount('Haggling', 0.05, 0.75);
    }
    return Math.max(300, Math.round(price / 50) * 50);
  }

  const teachShopCaches = { magic: {}, skill: {} };

  function getDailyTeachingOffers(mode, mapId, x, y) {
    const dateKey = getCurrentDateKey();
    const cacheKey = `${mapId}_${x}_${y}_${dateKey}`;
    const cache = teachShopCaches[mode];

    if (!cache[cacheKey]) {
      const stypeId = mode === "magic" ? 1 : 2;
      const all = $dataSkills.filter(s =>
        isRealSkillEntry(s) && s.stypeId === stypeId && skillSchool(s));

      const schools = [...new Set(all.map(skillSchool))].sort();
      const seed = generateSeed(mapId, x, y, dateKey);
      const picked = seededShuffle(schools, seed).slice(0, TEACH_SCHOOLS_PER_DAY);
      const pickedSet = new Set(picked);

      const pool = all.filter(s => pickedSet.has(skillSchool(s)));
      const offers = seededShuffle(pool, seed + 7).slice(0, TEACH_OFFER_COUNT);

      cache[cacheKey] = { schools: picked, offers, key: cacheKey };
    }

    return cache[cacheKey];
  }

  // Abilities already bought here today stay bought — tracked on $gameSystem so
  // it survives saves, and keyed by date so tomorrow's stock is clean.
  function soldRecord(mode, cacheKey) {
    if (!$gameSystem._dailyTeachShopSold) $gameSystem._dailyTeachShopSold = {};
    const store = $gameSystem._dailyTeachShopSold;
    const key = `${mode}_${cacheKey}`;
    if (!store[key]) store[key] = [];
    return store[key];
  }

  function isSoldOut(mode, cacheKey, skillId) {
    return soldRecord(mode, cacheKey).includes(skillId);
  }

  function markSold(mode, cacheKey, skillId) {
    const rec = soldRecord(mode, cacheKey);
    if (!rec.includes(skillId)) rec.push(skillId);
  }

  //----- Scene -------------------------------------------------------------
  // Parchment two-page spread, styled with the same shared classes the other
  // book-like menus use (#menu-container / .book-spread / .left-page).
  function injectTeachShopStyle() {
    if (document.getElementById("daily-teach-shop-style")) return;
    const el = document.createElement("style");
    el.id = "daily-teach-shop-style";
    el.textContent = `
    #menu-container .teach-list { display:flex; flex-direction:column; gap:8px; overflow-y:auto; padding-right:6px; flex-grow:1; }
    #menu-container .teach-actor, #menu-container .teach-card {
        font-family:'Lora',serif; cursor:pointer; border-radius:5px;
        border:1.5px solid var(--border-primary-hover-translucent-15,#bba16d);
        background:var(--bg-card-translucent-5, rgba(43,28,17,0.05));
        transition:all .15s ease; color:var(--text-primary-hover,#2b251d);
    }
    #menu-container .teach-actor { padding:8px 12px; display:flex; justify-content:space-between; align-items:center; }
    #menu-container .teach-card  { padding:10px 14px; display:flex; flex-direction:column; gap:4px; }
    #menu-container .teach-actor.sel, #menu-container .teach-card.sel {
        border-color:var(--accent-gold-pure,#b8860b);
        background:var(--bg-tertiary-focus-translucent-45, rgba(184,134,11,0.18));
        box-shadow:0 0 8px var(--border-primary-hover-translucent-15,rgba(184,134,11,0.4));
    }
    #menu-container .teach-card.taught { border-color:#2e7d32; background:rgba(46,125,50,0.18); }
    #menu-container .teach-card.locked { opacity:0.45; cursor:not-allowed; }
    #menu-container .teach-name { font-weight:bold; font-size:1.02em; display:flex; justify-content:space-between; gap:8px; }
    #menu-container .teach-price { color:var(--accent-gold-pure,#b8860b); font-weight:bold; }
    #menu-container .teach-meta { font-size:0.72em; text-transform:uppercase; letter-spacing:0.5px; opacity:0.8; }
    #menu-container .teach-forbidden { color:#a01818; font-weight:bold; }
    #menu-container .teach-desc { font-size:0.82em; opacity:0.85; line-height:1.35; }
    #menu-container .teach-empty { text-align:center; padding:40px 20px; font-style:italic; opacity:0.7; font-family:'Lora',serif; color:var(--text-primary-hover,#5d483b); }
    #menu-container .teach-info { padding:10px 12px; border-radius:4px; margin-top:auto;
        background:var(--bg-card-translucent-5, rgba(184,134,11,0.05));
        border:1px solid var(--border-primary-hover-translucent-15, rgba(184,134,11,0.2));
        font-family:'Lora',serif; font-size:0.82em; color:var(--text-primary-hover,#2b251d); }
    #menu-container .teach-info .row { display:flex; justify-content:space-between; margin-top:4px; gap:10px; }
    `;
    document.head.appendChild(el);
  }

  const TeachInput = {
    init(scene) { this.scene = scene; this.active = false; },
    activate() { this.active = true; },
    deactivate() { this.active = false; this.scene = null; },
    update() {
      if (!this.active || !this.scene) return;
      const sc = this.scene;
      if (sc._busy) return;
      const onOffers = sc._focus === "offers";
      const len = onOffers ? sc._offers.length : $gameParty.members().length;

      if (Input.isTriggered("cancel")) {
        SoundManager.playCancel();
        if (onOffers) { sc._focus = "party"; sc.redraw(); }
        else sc.popScene();
        return;
      }
      if (Input.isTriggered("ok")) {
        if (onOffers) sc.buyOffer(sc._offerIdx);
        else { sc._focus = "offers"; sc._offerIdx = 0; SoundManager.playOk(); sc.redraw(); }
        return;
      }
      if (len === 0) {
        if (onOffers && (Input.isTriggered("left") || Input.isTriggered("right"))) {
          sc._focus = "party"; SoundManager.playCursor(); sc.redraw();
        }
        return;
      }
      if (Input.isTriggered("right") && !onOffers) { sc._focus = "offers"; sc._offerIdx = 0; SoundManager.playCursor(); sc.redraw(); return; }
      if (Input.isTriggered("left") && onOffers) { sc._focus = "party"; SoundManager.playCursor(); sc.redraw(); return; }

      let idx = onOffers ? sc._offerIdx : sc._actorIdx;
      let moved = false;
      if (Input.isRepeated("down")) { idx = (idx + 1) % len; moved = true; }
      else if (Input.isRepeated("up")) { idx = (idx - 1 + len) % len; moved = true; }
      if (moved) {
        SoundManager.playCursor();
        if (onOffers) { sc._offerIdx = idx; sc.redraw(); }
        else sc.selectActor(idx);
      }
    }
  };

  function Scene_DailyTeachShop() { this.initialize(...arguments); }
  Scene_DailyTeachShop.prototype = Object.create(Scene_MenuBase.prototype);
  Scene_DailyTeachShop.prototype.constructor = Scene_DailyTeachShop;
  window.Scene_DailyTeachShop = Scene_DailyTeachShop;

  Scene_DailyTeachShop.prototype.create = function () {
    Scene_MenuBase.prototype.create.call(this);
    if (this._windowLayer) this._windowLayer.visible = false;
    if (this._cancelButton) this._cancelButton.visible = false;

    const p = $gameTemp._dailyTeachShopParams || { mode: "magic", mapId: 1, x: 0, y: 0 };
    this._mode = p.mode === "skill" ? "skill" : "magic";

    const data = getDailyTeachingOffers(this._mode, p.mapId, p.x, p.y);
    this._schools = data.schools;
    this._offers = data.offers;
    this._stockKey = data.key;

    this._focus = "party";
    this._actorIdx = 0;
    this._offerIdx = 0;
    this._taughtIdx = -1;
    this._busy = false;
    this._actor = $gameParty.members()[0] || $gameParty.leader();

    injectTeachShopStyle();
    TeachInput.init(this);
    this.createDOM();
  };

  Scene_DailyTeachShop.prototype.update = function () {
    Scene_MenuBase.prototype.update.call(this);
    TeachInput.update();
  };

  Scene_DailyTeachShop.prototype.terminate = function () {
    TeachInput.deactivate();
    if (this._dom) {
      const c = this._dom;
      c.style.transition = "opacity .2s ease-out";
      c.style.opacity = "0";
      c.style.pointerEvents = "none";
      setTimeout(() => { if (c && c.parentNode) c.parentNode.removeChild(c); }, 200);
      this._dom = null;
    }
    Scene_MenuBase.prototype.terminate.call(this);
  };

  Scene_DailyTeachShop.prototype.headerTitle = function () {
    const it = ConfigManager.language === "it";
    if (this._mode === "skill") return T('DailyShop.ui.skillTrainer');
    return T('DailyShop.ui.spellTrader');
  };

  // Why an offer can't be bought right now; null means it can.
  Scene_DailyTeachShop.prototype.blockReason = function (skill) {
    const it = ConfigManager.language === "it";
    if (isSoldOut(this._mode, this._stockKey, skill.id)) return T('DailyShop.ui.soldOut');
    const actor = this._actor;
    if (!actor) return T('DailyShop.ui.noPupil');
    if (actor.skills().some(k => k && k.id === skill.id)) return T('DailyShop.ui.alreadyKnown');
    if ((skill.mpCost || 0) > actor.mmp) return T('DailyShop.ui.beyondMpReach');
    if ($gameParty.gold() < teachingPrice(skill)) return T('DailyShop.ui.notEnoughGold');
    return null;
  };

  Scene_DailyTeachShop.prototype.selectActor = function (i) {
    const members = $gameParty.members();
    if (i < 0 || i >= members.length) return;
    this._actorIdx = i;
    this._actor = members[i];
    this.redraw();
  };

  Scene_DailyTeachShop.prototype.buyOffer = function (i) {
    const skill = this._offers[i];
    if (!skill || this._busy || this.blockReason(skill)) {
      SoundManager.playBuzzer();
      return;
    }
    this._busy = true;
    const paid = teachingPrice(skill);
    $gameParty.loseGold(paid);
    if (window.SpecializationXP) {
      window.SpecializationXP.awardForValue('Haggling', paid);
    }
    this._actor.learnSkill(skill.id);
    markSold(this._mode, this._stockKey, skill.id);
    SoundManager.playUseSkill();
    this._taughtIdx = i;
    this.redraw();
    setTimeout(() => {
      this._taughtIdx = -1;
      this._busy = false;
      if (this._dom) this.redraw();
    }, 700);
  };

  Scene_DailyTeachShop.prototype.createDOM = function () {
    this._dom = document.createElement("div");
    this._dom.id = "menu-container";
    this._dom.style.opacity = "0";
    this._dom.style.transition = "opacity .22s ease-out";
    document.body.appendChild(this._dom);
    this.redraw();
    TeachInput.activate();
    setTimeout(() => { if (this._dom) this._dom.style.opacity = "1"; }, 16);
  };

  // Never name this "render": a Scene is a PIXI.Container and the renderer
  // calls container.render() every frame, which would rebuild the overlay 60
  // times a second and stop the scene's own children being drawn.
  Scene_DailyTeachShop.prototype.redraw = function () {
    if (!this._dom) return;
    const it = ConfigManager.language === "it";
    const back = T('DailyShop.ui.back');
    const isMagic = this._mode === "magic";

    let actorsHTML = "";
    $gameParty.members().forEach((a, idx) => {
      const sel = (this._focus === "party" && idx === this._actorIdx) ? "sel" : "";
      actorsHTML += `<div class="teach-actor focusable ${sel}" onclick="SceneManager._scene.selectActor(${idx})">
          <span>${a.name()}</span><span class="teach-price">${a.mp}/${a.mmp} MP</span></div>`;
    });

    const blurb = isMagic
      ? (T('DailyShop.ui.theSchoolsOnDisplayRotate'))
      : (T('DailyShop.ui.theDisciplinesTaughtRotateEvery'));

    const schoolsHTML = this._schools.map(s =>
      `<div class="row"><span>${prettifySchool(s)}</span></div>`).join("");

    const leftHTML = `
      <div class="left-page">
        <div style="position:relative; display:flex; align-items:center; justify-content:center; border-bottom:2px dashed var(--border-primary-hover-translucent-15,#bba16d); padding-bottom:8px; margin-bottom:14px; min-height:40px;">
          <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position:absolute; left:0;">${back}</div>
          <h2 class="title" style="margin:0; border:none; font-size:1.7em;">${this.headerTitle()}</h2>
        </div>
        <div style="font-family:'Lora',serif; font-style:italic; opacity:0.8; font-size:0.85em; margin-bottom:12px; color:var(--text-primary-hover,#58180D);">${blurb}</div>
        <div style="font-family:'Lora',serif; font-weight:bold; font-size:0.9em; margin-bottom:6px; color:var(--text-primary-hover,#58180D);">${T('DailyShop.ui.pupil')}</div>
        <div class="teach-list">${actorsHTML}</div>
        <div class="teach-info">
          <div style="font-weight:bold; color:var(--accent-gold-pure,#b8860b);">${isMagic ? (T('DailyShop.ui.todaySSchools')) : (T('DailyShop.ui.todaySDisciplines'))}</div>
          ${schoolsHTML}
          <div class="row" style="margin-top:8px; border-top:1px solid var(--border-primary-hover-translucent-15,rgba(184,134,11,0.2)); padding-top:6px;">
            <span>${T('DailyShop.ui.gold')}</span><span class="teach-price">${$gameParty.gold()}</span>
          </div>
        </div>
      </div>`;

    let cardsHTML = "";
    if (!this._offers.length) {
      cardsHTML = `<div class="teach-empty">${T('DailyShop.ui.nothingToTeachToday')}</div>`;
    } else {
      this._offers.forEach((s, idx) => {
        const sel = (this._focus === "offers" && idx === this._offerIdx) ? "sel" : "";
        const taught = (this._taughtIdx === idx) ? "taught" : "";
        const reason = this.blockReason(s);
        const locked = reason ? "locked" : "";
        const forb = (s.meta && s.meta.Forbidden)
          ? `<span class="teach-forbidden">✦ ${T('DailyShop.ui.forbidden')}</span>` : "";
        const cost = (s.mpCost ? `${s.mpCost} MP` : "") +
                     (s.mpCost && s.tpCost ? " · " : "") +
                     (s.tpCost ? `${s.tpCost} TP` : "");
        const desc = (s.description || "").replace(/\n/g, " ");
        cardsHTML += `<div class="teach-card focusable ${sel} ${taught} ${locked}" onclick="SceneManager._scene.buyOffer(${idx})">
            <div class="teach-name"><span>${s.name}</span><span class="teach-price">${teachingPrice(s)}G</span></div>
            <div class="teach-meta">${prettifySchool(skillSchool(s))}${cost ? " · " + cost : ""} ${forb}</div>
            <div class="teach-desc">${desc}</div>
            ${reason ? `<div class="teach-meta" style="color:#a01818;">${reason}</div>` : ""}
          </div>`;
      });
    }

    const rightHTML = `
      <div class="right-page">
        <h2 class="title" style="font-size:1.5em; margin-bottom:12px;">${isMagic ? (T('DailyShop.ui.spellsForSale')) : (T('DailyShop.ui.techniquesForSale'))}</h2>
        <div class="teach-list">${cardsHTML}</div>
      </div>`;

    this._dom.innerHTML = `<div class="book-spread">${leftHTML}${rightHTML}</div>`;
  };

  function openDailyTeachShop(mode) {
    const eventId = $gameMap._interpreter.eventId();
    const event = $gameMap.event(eventId);

    if (!event) {
      console.warn("RandomDailyShop: Could not find event to determine location.");
      return;
    }

    $gameTemp._dailyTeachShopParams = {
      mode: mode === "skill" ? "skill" : "magic",
      mapId: $gameMap.mapId(),
      x: event.x,
      y: event.y
    };
    SceneManager.push(Scene_DailyTeachShop);
  }

  // Plugin command registration
  PluginManager.registerCommand(pluginName, "OpenDailyShop", () => {
    openDailyShop();
  });

  PluginManager.registerCommand(pluginName, "randomDailyTavern", () => {
    openDailyTavern();
  });

  PluginManager.registerCommand(pluginName, "openDailyArmor", () => {
    openDailyArmor();
  });

  PluginManager.registerCommand(pluginName, "openDailyWeapon", () => {
    openDailyWeapon();
  });

  PluginManager.registerCommand(pluginName, "openDailyPharmacy", () => {
    openDailyPharmacy();
  });

  PluginManager.registerCommand(pluginName, "openDailyMagicShop", () => {
    openDailyMagicShop();
  });

  PluginManager.registerCommand(pluginName, "openDailyLuxury", () => {
    openDailyLuxury();
  });

  PluginManager.registerCommand(pluginName, "openDailyAdventurer", () => {
    openDailyAdventurer();
  });

    PluginManager.registerCommand(pluginName, "openDailyLibrary", () => {
    openDailyLibrary();
  });

  PluginManager.registerCommand(pluginName, "openDailyTools", () => {
    openDailyTools();
  });

  PluginManager.registerCommand(pluginName, "openDailyAlchemistry", () => {
    openDailyAlchemistryShop();
  });

  PluginManager.registerCommand(pluginName, "openOrganTrader", () => {
    openOrganTrader();
  });

  PluginManager.registerCommand(pluginName, "openThemedShop", args => {
    openThemedShop(String(args.shopType || "").trim());
  });

  PluginManager.registerCommand(pluginName, "openDailySpellShop", () => {
    openDailyTeachShop("magic");
  });

  PluginManager.registerCommand(pluginName, "openDailySkillShop", () => {
    openDailyTeachShop("skill");
  });


  // Optional: script call for events
  window.openRandomDailyShop = openDailyShop;
  window.openRandomDailyTavern = openDailyTavern;
  window.openRandomDailyArmor = openDailyArmor;
  window.openRandomDailyWeapon = openDailyWeapon;
  window.openRandomDailyPharmacy = openDailyPharmacy;
  window.openRandomDailyMagicShop = openDailyMagicShop;
  window.openRandomDailyLuxury = openDailyLuxury;
  window.openRandomDailyAdventurer = openDailyAdventurer;
  window.openRandomDailyLibrary = openDailyLibrary;
  window.openRandomDailyTools = openDailyTools;
  window.openRandomDailyAlchemistry = openDailyAlchemistryShop;

  // Expose getShopItems for compatibility with other plugins (e.g., StealingSystem)
  window.getRandomDailyShopItems = getShopItems;
  window.getRandomDailyTavernItems = getTavernItems;
  window.getRandomLibraryItems = getLibraryItems;

  window.getRandomDailyArmorItems = getArmorShopItems;
  window.getRandomDailyWeaponItems = getWeaponShopItems;
  window.getRandomDailyPharmacyItems = getPharmacyItems;
  window.getRandomDailyMagicItems = getMagicShopInventory;
  window.getRandomDailyLuxuryItems = getLuxuryShopItems;
  window.getRandomDailyAdventurerItems = getAdventurerShopItems;
  window.getRandomDailyToolsItems = getToolsShopItems;
  window.getRandomDailyAlchemistryItems = getAlchemistryShopItems;
  window.openRandomOrganTrader = openOrganTrader;
  window.getRandomOrganTraderItems = getOrganTraderItems;

  // Themed (ID-based) shops: generic entry points plus one convenience
  // wrapper per type, e.g. openRandomDailySupermarket() / getRandomDailySupermarketItems().
  window.openRandomThemedShop = openThemedShop;
  window.getRandomThemedShopItems = getThemedShopItems;
  window.RandomDailyThemedShops = THEMED_SHOPS;

  // Remote ordering surface used by MovementInteractionSystem's seated menu.
  window.RandomDailyShop = window.RandomDailyShop || {};
  window.RandomDailyShop.findDiningVenues = findDiningVenues;
  window.RandomDailyShop.openDiningVenue = openDiningVenue;
  window.RandomDailyShop.themedShops = THEMED_SHOPS;

  // Daily spell / skill teachers
  window.openRandomDailySpellShop = () => openDailyTeachShop("magic");
  window.openRandomDailySkillShop = () => openDailyTeachShop("skill");
  window.getRandomDailySpellShopOffers = (mapId, x, y) => getDailyTeachingOffers("magic", mapId, x, y);
  window.getRandomDailySkillShopOffers = (mapId, x, y) => getDailyTeachingOffers("skill", mapId, x, y);

  for (const shopType of Object.keys(THEMED_SHOPS)) {
    const suffix = shopType.charAt(0).toUpperCase() + shopType.slice(1);
    window[`openRandomDaily${suffix}`] = () => openThemedShop(shopType);
    window[`getRandomDaily${suffix}Items`] = (mapId, x, y) => getThemedShopItems(shopType, mapId, x, y);  // i18n-ignore  global function name
  }

})();