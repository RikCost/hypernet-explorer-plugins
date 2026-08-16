/*:
 * @target MZ
 * @plugindesc Starting equipment and weapon management system for character creation
 * @author Omni-Lex
 * @orderAfter CharacterCreationShared
 * @orderBefore CharacterPresets
 * @orderBefore CharacterCreation
 *
 * @help
 * This plugin manages starting equipment for characters:
 * - Starter weapon pool per weapon type, derived from shop price
 * - Weapon type icon mapping
 * - Compatible weapon detection for classes
 * - Random weapon selection and equipment
 * - Thematic starting items per class, held to a price budget
 * - Global starter skills
 *
 * Starting gear is chosen by PRICE, never by stats: the weapon pool is the
 * cheapest weapons of each type in the database, and a class item loadout must
 * fit CLASS_ITEM_BUDGET. Items granted by traits are not covered by either and
 * stay exactly as the trait defines them.
 *
 * Dependencies:
 * - CharacterCreationShared.js
 *
 * Functions exported to global namespace:
 * - window.StartingEquipment.equipRandomCompatibleWeapon(actor, classId)
 * - window.StartingEquipment.getCompatibleWeapons(compatibleTypes)
 * - window.StartingEquipment.getCompatibleWeaponTypes(classId)
 * - window.StartingEquipment.getStarterWeaponPool()
 * - window.StartingEquipment.auditClassStartingItems()
 * - window.StartingEquipment.GLOBAL_STARTER_SKILLS
 * - window.StartingEquipment.weaponTypeIcons
 */

(() => {
  const pluginName = "StartingEquipment";

  //=============================================================================
  // Constants - Global Starter Skills
  //=============================================================================

  // Skills that all characters learn on creation
  const GLOBAL_STARTER_SKILLS = [2, 836, 837, 838, 839, 847];

  //=============================================================================
  // Constants - Weapon Type Icons
  //=============================================================================

  const weaponTypeIcons = {
    1: 96,   // Dagger / Light
    2: 97,   // Sword
    3: 98,   // Flail / Heavy
    4: 99,   // Axe
    5: 100,  // Whip
    6: 101,  // Staff
    7: 102,  // Bow
    8: 114,  // Crossbow / Projectile
    9: 104,  // Gun
    10: 105, // Claw
    11: 106, // Glove
    12: 107  // Spear
  };

  //=============================================================================
  // Starter Weapon Pool (derived from price, not from stats)
  //=============================================================================

  // A starting character carries the cheapest junk its class can hold: the pool
  // is the low end of the shop price list for each weapon type, which is also
  // the low end of the level curve, so no stat scoring is involved.
  //
  // This used to be a hardcoded table of weapon ids, and it went stale the
  // moment Weapons.json was re-indexed: the ids no longer pointed at the type
  // they were filed under, and the pool was handing out end-game artifacts
  // (Glove resolved to weapon 31, the level 95 / 112000g Timeflow Manipulator;
  // Spear to the Dragon Daggar and Memory Thief) and, worse, the nameless
  // "<-- Light -->" divider rows. Deriving the pool from the database means it
  // cannot drift out of sync again.
  const STARTER_PRICE_CAP = 2000;  // gold; above this it is not starting gear
  const STARTER_POOL_MAX = 8;      // never offer more than the N cheapest
  const STARTER_POOL_MIN = 3;      // ... but always offer this many if they exist

  let starterPoolCache = null;

  /**
   * Real weapon entry test: skips the blank padding rows and the
   * "<-- Category -->" dividers that separate the weapon type blocks.
   * @param {object} weapon - $dataWeapons entry
   * @returns {boolean}
   */
  function isRealWeapon(weapon) {
    if (!weapon || !weapon.name) return false;
    const name = weapon.name.trim();
    return name.length > 0 && !name.startsWith("<--");
  }

  /**
   * Build the {wtypeId: [weaponId, ...]} starter pool from $dataWeapons.
   * @returns {object}
   */
  function buildStarterWeaponPool() {
    const pool = {};
    if (typeof $dataWeapons === "undefined" || !Array.isArray($dataWeapons)) {
      return pool;
    }

    const byType = {};
    $dataWeapons.forEach((weapon) => {
      if (!isRealWeapon(weapon) || !weapon.wtypeId || !(weapon.price > 0)) return;
      (byType[weapon.wtypeId] = byType[weapon.wtypeId] || []).push(weapon);
    });

    Object.keys(byType).forEach((typeId) => {
      const sorted = byType[typeId].sort((a, b) => a.price - b.price);
      const cheap = sorted.filter((w) => w.price <= STARTER_PRICE_CAP);
      // A type with nothing under the cap still has to arm its classes, so fall
      // back to the cheapest few it does have.
      const picked = cheap.length >= STARTER_POOL_MIN ? cheap : sorted.slice(0, STARTER_POOL_MIN);
      pool[typeId] = picked.slice(0, STARTER_POOL_MAX).map((w) => w.id);
    });

    return pool;
  }

  /**
   * Memoized starter pool. Built on first use (the database is not loaded when
   * this plugin's body runs).
   * @returns {object} {wtypeId: [weaponId, ...]}
   */
  function getStarterWeaponPool() {
    if (!starterPoolCache || Object.keys(starterPoolCache).length === 0) {
      starterPoolCache = buildStarterWeaponPool();
    }
    return starterPoolCache;
  }

  //=============================================================================
  // Weapon Functions
  //=============================================================================

  /**
   * Get compatible weapon type IDs for a class
   * @param {number} classId - Class ID
   * @returns {array} Array of weapon type IDs
   */
  function getCompatibleWeaponTypes(classId) {
    const classData = $dataClasses[classId];
    if (!classData) {
      console.warn(`Class with ID ${classId} not found in database`);
      return [];
    }

    // Get the weapon type array from the class data
    // In RPG Maker MZ, this is stored in classData.traits as type code 51 (Weapon Equip)
    const weaponTypes = [];

    if (classData.traits && Array.isArray(classData.traits)) {
      classData.traits.forEach((trait) => {
        // Trait code 51 is weapon equip type
        if (trait.code === 51) {
          weaponTypes.push(trait.dataId);
        }
      });
    }

    return weaponTypes;
  }

  /**
   * Weapon types a class can be armed with at creation. Same as the declared
   * equip types, except that a class declaring none (Archmage, Beast) falls
   * back to every type rather than starting bare-handed: class weapon locks
   * were converted into the Weapons specializations, so any class can hold
   * anything, it is only worse at it.
   * @param {number} classId - Class ID
   * @returns {array} Array of weapon type IDs
   */
  function getStarterWeaponTypes(classId) {
    const declared = getCompatibleWeaponTypes(classId);
    if (declared.length > 0) return declared;
    return Object.keys(getStarterWeaponPool()).map(Number);
  }

  /**
   * Get weapons for compatible types from the limited pool
   * @param {array} compatibleTypes - Array of weapon type IDs (empty means all)
   * @returns {array} Array of weapon objects
   */
  function getCompatibleWeapons(compatibleTypes) {
    const compatibleWeapons = [];
    const pool = getStarterWeaponPool();
    const types =
      compatibleTypes && compatibleTypes.length > 0
        ? compatibleTypes
        : Object.keys(pool).map(Number);

    // For each compatible weapon type, get weapons from the pool
    types.forEach((typeId) => {
      const weaponsOfType = pool[typeId];
      if (weaponsOfType && Array.isArray(weaponsOfType)) {
        // Add valid weapons from this type's pool to the compatible list
        weaponsOfType.forEach((weaponId) => {
          const weapon = $dataWeapons[weaponId];
          if (isRealWeapon(weapon)) {
            compatibleWeapons.push(weapon);
          }
        });
      }
    });

    return compatibleWeapons;
  }

  /**
   * Equip random compatible weapon for a class
   * @param {Game_Actor} actor - Actor to equip
   * @param {number} classId - Class ID
   * @returns {boolean} Success status
   */
  function equipRandomCompatibleWeapon(actor, classId) {
    if (!actor || !classId) {
      console.warn('Invalid actor or class ID');
      return false;
    }

    // Get compatible weapon types from the class
    const compatibleTypes = getStarterWeaponTypes(classId);

    // Get weapons from the limited pool that match compatible types
    const compatibleWeapons = getCompatibleWeapons(compatibleTypes);
    if (compatibleWeapons.length === 0) {
      console.warn(`No weapons found in pool for compatible types [${compatibleTypes.join(', ')}] for class ${classId}`);
      return false;
    }

    // Select a random weapon from the compatible list
    const randomWeapon = compatibleWeapons[Math.floor(Math.random() * compatibleWeapons.length)];

    if (!randomWeapon) {
      console.warn(`Failed to select random weapon for class ${classId}`);
      return false;
    }

    // Add weapon to party inventory
    $gameParty.gainItem(randomWeapon, 1);

    // Equip weapon to actor (slot 0 is weapon slot)
    try {
      actor.changeEquip(0, randomWeapon);
      console.log(`Equipped ${randomWeapon.name} (Type: ${randomWeapon.wtypeId}) to ${actor.name()} (Class: ${classId})`);
      return true;
    } catch (e) {
      console.error(`Failed to equip weapon: ${e}`);
      return false;
    }
  }

  /**
   * Learn global starter skills for an actor
   * @param {Game_Actor} actor - Actor to teach skills to
   */
  function learnStarterSkills(actor) {
    if (!actor) {
      console.warn('Invalid actor for learning starter skills');
      return;
    }

    GLOBAL_STARTER_SKILLS.forEach((skillId) => {
      if ($dataSkills[skillId]) {
        actor.learnSkill(skillId);
      } else {
        console.warn(`Starter skill ${skillId} not found in database`);
      }
    });
  }

  //=============================================================================
  // Constants - Class Starting Items (Items.json only, no weapons/armors)
  //=============================================================================

  // Thematic starting-item loadout per class, keyed by class name (matched
  // against $dataClasses).
  // Every entry is { id, qty } into $dataItems.
  //
  // A loadout is judged by PRICE, not by what its items do: the whole kit must
  // stay under CLASS_ITEM_BUDGET (checked by auditClassStartingItems below),
  // which keeps a new character in cheap, mundane gear. Traits are the other
  // half of the starting kit and are deliberately not bound by this: whatever a
  // trait hands out is the trait's business.
  // i18n-ignore-start: keys are $dataClasses names, matched not shown
  const CLASS_STARTING_ITEMS = {
    "Freelancer": [{ id: 814, qty: 1 }, { id: 1441, qty: 1 }],          // Multi-tool, Vocation Skill Book
    "Witch": [{ id: 262, qty: 1 }, { id: 1402, qty: 1 }, { id: 168, qty: 1 }], // Empty Spellbook, Void Magic Grimoire, Flying broom
    "Nun": [{ id: 1401, qty: 1 }, { id: 604, qty: 2 }],                 // Holy Magic Grimoire, Minimum Vitality Tincture
    "Knight": [{ id: 1422, qty: 1 }, { id: 811, qty: 1 }],              // Swordsmanship Skill Book, Whetstone
    "Convoker": [{ id: 1411, qty: 1 }, { id: 680, qty: 1 }],            // Convokation Grimoire, Fae Bell of Summoning
    "CEO": [{ id: 191, qty: 1 }, { id: 379, qty: 1 }],                  // Career Package, Negotiator's Manual
    "Vampire": [{ id: 652, qty: 1 }, { id: 751, qty: 1 }],              // Vial of Miasma, Zombie Hand
    "Cultist": [{ id: 1404, qty: 1 }, { id: 359, qty: 1 }],             // Forbidden Magic Grimoire, Empty Demon Container
    "Combat Medic": [{ id: 19, qty: 2 }, { id: 33, qty: 1 }],           // Medical Spray, Endurance Injection
    "Elementalist": [{ id: 1435, qty: 1 }, { id: 649, qty: 1 }],        // Electromancy Grimoire, Thunder Crystal
    "Martial Artist": [{ id: 1421, qty: 1 }, { id: 81, qty: 1 }],       // Martial Arts Skill Book, Karate Combo EP:
    "Enchanter": [{ id: 1406, qty: 1 }, { id: 647, qty: 1 }],           // Arcanism Grimoire, Enchanted Quill
    "Berserker": [{ id: 87, qty: 1 }, { id: 88, qty: 1 }],              // Berserker Amulet, Guard Breaker
    "Acrobat": [{ id: 654, qty: 1 }, { id: 810, qty: 1 }],              // Swift Wind Elixir, Elven Rope
    "Monk": [{ id: 90, qty: 1 }, { id: 722, qty: 1 }],                  // Perfect Block EP:, Mental Focus Training
    "Brawler": [{ id: 723, qty: 1 }, { id: 832, qty: 1 }],              // Fighter's Focus, Used Hand Wraps
    "Boxer": [{ id: 833, qty: 1 }, { id: 834, qty: 1 }],                // Cracked Mouthguard, Torn Gloves
    "Pro Wrestler": [{ id: 320, qty: 1 }, { id: 313, qty: 1 }],         // Wooden Chair, Vintage Fight Poster
    "Fire Mage": [{ id: 1400, qty: 1 }, { id: 658, qty: 1 }],           // Pyromancy Grimoire, Fireball Scroll
    "Ice Mage": [{ id: 1418, qty: 1 }, { id: 655, qty: 1 }],            // Cryomancy Grimoire, Frost Bomb
    "Rogue": [{ id: 1431, qty: 1 }, { id: 374, qty: 1 }],               // Roguery Skill Book, Lockpick
    "Paladin": [{ id: 1401, qty: 1 }, { id: 662, qty: 1 }],             // Holy Magic Grimoire, Shield Scroll
    "Warlock": [{ id: 1404, qty: 1 }, { id: 666, qty: 1 }],             // Forbidden Magic Grimoire, Scroll of Destruction
    "Ranger": [{ id: 1433, qty: 1 }, { id: 810, qty: 1 }],              // Pastoral Skill Book, Elven Rope
    "Cleric": [{ id: 1419, qty: 1 }, { id: 648, qty: 2 }],              // Healing Grimoire, Health Potion
    "Samurai": [{ id: 1422, qty: 1 }, { id: 277, qty: 1 }],             // Swordsmanship Skill Book, Etiquette
    "Archmage": [{ id: 1406, qty: 1 }, { id: 657, qty: 1 }],            // Arcanism Grimoire, Archmage's Elixir
    "Scout": [{ id: 1430, qty: 1 }, { id: 137, qty: 1 }],               // Tactical Skill Book, Portable GPS Navigator
    "Oracle": [{ id: 1412, qty: 1 }, { id: 650, qty: 1 }],              // Augury Grimoire, Dream Dust
    "Gladiator": [{ id: 314, qty: 1 }, { id: 324, qty: 1 }],            // Champion's Tooth, Ancient Fighting Coin
    "Necromancer": [{ id: 1403, qty: 1 }, { id: 724, qty: 1 }],         // Necromancy Grimoire, Floating skull
    "Commander": [{ id: 1429, qty: 1 }, { id: 234, qty: 1 }],           // Leadership Skill Book, Navigator's Compass
    "Guardian": [{ id: 662, qty: 1 }, { id: 656, qty: 1 }],             // Shield Scroll, Dragon Scale Barrier
    "Spellblade": [{ id: 1435, qty: 1 }, { id: 1422, qty: 1 }],         // Electromancy Grimoire, Swordsmanship Skill Book
    "Bard": [{ id: 1428, qty: 1 }, { id: 236, qty: 1 }],                // Performance Skill Book, Magician's Flute
    "Illusionist": [{ id: 1415, qty: 1 }, { id: 663, qty: 1 }],         // Illusion Grimoire, Invisibility Scroll
    "Battlemage": [{ id: 1400, qty: 1 }, { id: 661, qty: 1 }],          // Pyromancy Grimoire, Lightning Bolt Scroll
    "Mercenary": [{ id: 385, qty: 1 }, { id: 73, qty: 1 }],             // Secure Transport Case, Molotov Cocktail
    "Sage": [{ id: 1407, qty: 1 }, { id: 34, qty: 1 }],                 // Meta Magic Grimoire, Wisdom Elixir
    "Barbarian": [{ id: 79, qty: 1 }, { id: 653, qty: 1 }],             // Throwing Axe, Giant's Potion
    // The lab classes all carry the portable Alchemistry Kit (390): it is what
    // opens the Alchemistry bench from the main menu, so a character whose
    // trade is a laboratory starts able to use one.
    "Doctor": [{ id: 244, qty: 1 }, { id: 19, qty: 1 }, { id: 390, qty: 1 }],   // Surgical Tools, Medical Spray, Alchemistry Kit
    "Scientist": [{ id: 1425, qty: 1 }, { id: 944, qty: 1 }, { id: 390, qty: 1 }], // Alchemistry Skill Book, Silver Nitrate, Alchemistry Kit
    "Firefighter": [{ id: 1438, qty: 1 }, { id: 813, qty: 1 }],         // Idromancy Grimoire, Climbing Rope
    "Police Officer": [{ id: 143, qty: 1 }, { id: 76, qty: 1 }],        // Pocket Video Recorder, Caltrops
    "Chef": [{ id: 1427, qty: 1 }, { id: 232, qty: 1 }],                // Cooking Skill Book, Chef's Spice Blend
    "Journalist": [{ id: 144, qty: 1 }, { id: 711, qty: 1 }],           // Digital Camera, Newspaper
    "Construction Worker": [{ id: 138, qty: 1 }, { id: 863, qty: 2 }],  // Shovel, Salvaged steel
    "Academic": [{ id: 299, qty: 1 }, { id: 127, qty: 1 }],             // Scholar's Legal Tome, Pocket Notebook
    "Psychologist": [{ id: 722, qty: 1 }, { id: 378, qty: 1 }],         // Mental Focus Training, Truth-Revealing Solution
    "Archaeologist": [{ id: 354, qty: 1 }, { id: 121, qty: 1 }],        // Fake Treasure Map, Lantern
    "Nurse": [{ id: 19, qty: 1 }, { id: 17, qty: 2 }, { id: 390, qty: 1 }], // Medical Spray, Electrolyte Powder, Alchemistry Kit
    "Hunter-Gatherer": [{ id: 1423, qty: 1 }, { id: 806, qty: 1 }],     // Bestial Skill Book, Walking Stick
    "Physicist": [{ id: 139, qty: 1 }, { id: 140, qty: 1 }, { id: 390, qty: 1 }], // Resonance Scanner, Raman probe, Alchemistry Kit
    "Mechanic": [{ id: 146, qty: 1 }, { id: 814, qty: 1 }],             // Fuel tank, Multi-tool
    "Shopkeeper": [{ id: 1437, qty: 1 }, { id: 721, qty: 1 }],          // Economy Skill Book, Massive Storage Drive
    "Farmer": [{ id: 1433, qty: 1 }, { id: 240, qty: 1 }],              // Pastoral Skill Book, Botanist's Seed Collection
    "Lumberjack": [{ id: 151, qty: 1 }, { id: 814, qty: 1 }],           // Craftsman's Backpack, Multi-tool
    "Meteorologist": [{ id: 1439, qty: 1 }, { id: 117, qty: 1 }],       // Aeromancy Grimoire, Umbrella
    "Priest": [{ id: 1401, qty: 1 }, { id: 264, qty: 1 }],              // Holy Magic Grimoire, 92 Days of Solomon
    "Entertainer": [{ id: 1428, qty: 1 }, { id: 186, qty: 1 }],         // Performance Skill Book, Pocket Sound System
    "Demigod": [{ id: 1405, qty: 1 }, { id: 646, qty: 1 }],             // Astral Magic Grimoire, Elven Waybread
    "Wretch": [{ id: 836, qty: 1 }, { id: 828, qty: 1 }],               // Rubbish, Expired Cheese
    "Beast": [{ id: 27, qty: 1 }, { id: 627, qty: 1 }],                 // Beast Tongue Elixir, Jaguar Musk Gland
    "Mimic": [{ id: 709, qty: 2 }, { id: 347, qty: 1 }],                // Unidentified Item, Not-So-Magic Bean
    "Monster": [{ id: 725, qty: 1 }, { id: 89, qty: 1 }],               // Spirit Parasite, Broken Cryocell
    "Mana Cyborg": [{ id: 1420, qty: 1 }, { id: 122, qty: 1 }],         // Technomagical Grimoire, Portable Charger
  };
  // i18n-ignore-end

  /**
   * Get the thematic starting-item loadout for a class (display + grant use).
   * @param {number} classId - Class ID
   * @returns {array} Array of { id, qty } entries (empty if none defined)
   */
  function getClassStartingItems(classId) {
    const classData = $dataClasses[classId];
    if (!classData) return [];
    return CLASS_STARTING_ITEMS[classData.name] || [];
  }

  /**
   * Grant a class's thematic starting items to the party inventory.
   * @param {Game_Actor} actor - Actor whose class was just chosen (unused for
   *   the grant itself, since items go to the shared party inventory, but kept
   *   for a consistent signature with equipRandomCompatibleWeapon)
   * @param {number} classId - Class ID
   */
  function giveClassStartingItems(actor, classId) {
    getClassStartingItems(classId).forEach((entry) => {
      const item = $dataItems[entry.id];
      if (item) {
        $gameParty.gainItem(item, entry.qty);
      } else {
        console.warn(`StartingEquipment: class starting item ${entry.id} not found.`);
      }
    });
  }

  /**
   * Total shop value of a class loadout, in gold.
   * @param {number} classId - Class ID
   * @returns {number}
   */
  function getClassStartingItemsValue(classId) {
    return getClassStartingItems(classId).reduce((sum, entry) => {
      const item = $dataItems[entry.id];
      return sum + (item ? (item.price || 0) * (entry.qty || 1) : 0);
    }, 0);
  }

  // Ceiling for a whole class loadout, in gold (100 gold = 1 EUR), i.e. 100 EUR
  // of goods on top of the party's 100 EUR purse. Anything dearer than this is
  // not starting gear, it is treasure.
  const CLASS_ITEM_BUDGET = 10000;

  /**
   * Check every class loadout against CLASS_ITEM_BUDGET and report the ones
   * that break it, together with any entry pointing at a missing or blank item.
   * Run from the console after editing the table.
   * @returns {array} Offending { class, total, items } rows
   */
  function auditClassStartingItems() {
    const offenders = [];
    Object.keys(CLASS_STARTING_ITEMS).forEach((className) => {
      const entries = CLASS_STARTING_ITEMS[className];
      const broken = entries.filter((entry) => {
        const item = $dataItems[entry.id];
        return !item || !item.name || !item.name.trim();
      });
      const total = entries.reduce((sum, entry) => {
        const item = $dataItems[entry.id];
        return sum + (item ? (item.price || 0) * (entry.qty || 1) : 0);
      }, 0);
      if (total > CLASS_ITEM_BUDGET || broken.length > 0) {
        offenders.push({ class: className, total, items: entries });
        console.warn(
          `StartingEquipment: ${className} loadout is ${total}g` +
            (broken.length ? ` and has ${broken.length} missing item(s)` : "") +
            ` (budget ${CLASS_ITEM_BUDGET}g).`
        );
      }
    });
    return offenders;
  }

  /**
   * Apply starting gear to an actor (weapon + skills)
   * @param {Game_Actor} actor - Actor to equip
   * @param {number} classId - Class ID
   */
  function applyStartingGear(actor, classId) {
    if (!actor || !classId) {
      console.warn('Invalid actor or class ID for starting gear');
      return;
    }

    // Equip random weapon
    equipRandomCompatibleWeapon(actor, classId);

    // Learn starter skills
    learnStarterSkills(actor);

    console.log(`Applied starting gear to ${actor.name()} (Class: ${classId})`);
  }

  //=============================================================================
  // Exports to Global Namespace
  //=============================================================================

  window.StartingEquipment = {
    // Constants
    GLOBAL_STARTER_SKILLS,
    weaponTypeIcons,
    STARTER_PRICE_CAP,
    CLASS_ITEM_BUDGET,

    // The derived starter pool, kept under its old name for outside readers.
    get weaponsForType() {
      return getStarterWeaponPool();
    },

    // Functions
    getStarterWeaponPool,
    getStarterWeaponTypes,
    getCompatibleWeaponTypes,
    getCompatibleWeapons,
    equipRandomCompatibleWeapon,
    learnStarterSkills,
    applyStartingGear,
    getClassStartingItems,
    getClassStartingItemsValue,
    giveClassStartingItems,
    auditClassStartingItems
  };

  console.log(`${pluginName} loaded successfully.`);
})();
