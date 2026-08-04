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
 * - Weapon type to weapon ID mapping (weapon pools)
 * - Weapon type icon mapping
 * - Compatible weapon detection for classes
 * - Random weapon selection and equipment
 * - Global starter skills
 *
 * Dependencies:
 * - CharacterCreationShared.js
 *
 * Functions exported to global namespace:
 * - window.StartingEquipment.equipRandomCompatibleWeapon(actor, classId)
 * - window.StartingEquipment.getCompatibleWeapons(compatibleTypes)
 * - window.StartingEquipment.getCompatibleWeaponTypes(classId)
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
  // Constants - Weapon Pools by Type
  //=============================================================================

  // Weapon pool for each weapon type - limited selection of weapon IDs
  // Maps weapon type ID to array of available weapon IDs for that type
  const weaponsForType = {
    1: [43, 44, 173],      // Dagger
    2: [1, 2],             // Sword
    3: [13, 172],          // Heavy
    4: [171, 19],          // Axe
    5: [211],              // Whip
    6: [7],                // Staff
    7: [37],               // Bow
    8: [39, 64],           // Projectile
    9: [58, 59, 62],       // Gun
    10: [12],              // Claw
    11: [31],              // Glove
    12: [25, 26]           // Spear
  };

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
   * Get weapons for compatible types from the limited pool
   * @param {array} compatibleTypes - Array of weapon type IDs
   * @returns {array} Array of weapon objects
   */
  function getCompatibleWeapons(compatibleTypes) {
    if (!compatibleTypes || compatibleTypes.length === 0) {
      console.warn('No compatible weapon types provided');
      return [];
    }

    const compatibleWeapons = [];

    // For each compatible weapon type, get weapons from the pool
    compatibleTypes.forEach((typeId) => {
      const weaponsOfType = weaponsForType[typeId];
      if (weaponsOfType && Array.isArray(weaponsOfType)) {
        // Add valid weapons from this type's pool to the compatible list
        weaponsOfType.forEach((weaponId) => {
          const weapon = $dataWeapons[weaponId];
          if (weapon) {
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
    const compatibleTypes = getCompatibleWeaponTypes(classId);
    if (compatibleTypes.length === 0) {
      console.warn(`No compatible weapon types found for class ${classId}`);
      return false;
    }

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
  // against $dataClasses like getQuickArchetypes() in CharacterCreation.js).
  // Every entry is { id, qty } into $dataItems.
  // i18n-ignore-start: keys are $dataClasses names, matched not shown
  const CLASS_STARTING_ITEMS = {
    "Freelancer": [{ id: 814, qty: 1 }, { id: 1441, qty: 1 }],           // Multi-tool, Vocation Skill Book
    "Witch": [{ id: 262, qty: 1 }, { id: 1402, qty: 1 }],                // Empty Spellbook, Void Magic Grimoire
    "Nun": [{ id: 1401, qty: 1 }, { id: 604, qty: 2 }],                  // Holy Magic Grimoire, Minimum Vitality Tincture
    "Knight": [{ id: 1422, qty: 1 }, { id: 811, qty: 1 }],               // Swordsmanship Skill Book, Whetstone
    "Wrestler": [{ id: 319, qty: 1 }, { id: 315, qty: 2 }],              // Corner Cutman Kit, Grip Powder
    "CEO": [{ id: 191, qty: 1 }, { id: 379, qty: 1 }],                   // Career Package, Negotiator's Manual
    "Vampire": [{ id: 652, qty: 1 }, { id: 682, qty: 1 }],               // Vial of Miasma, Cloak of Shadows
    "Cultist": [{ id: 1404, qty: 1 }, { id: 359, qty: 1 }],              // Forbidden Magic Grimoire, Empty Demon Container
    "Combat Medic": [{ id: 19, qty: 2 }, { id: 33, qty: 1 }],            // Medical Spray, Endurance Injection
    "Elementalist": [{ id: 1400, qty: 1 }, { id: 649, qty: 1 }],         // Elemental Grimoire, Thunder Crystal
    "Martial Artist": [{ id: 1421, qty: 1 }, { id: 81, qty: 1 }],        // Martial Arts Skill Book, Karate Combo EP:
    "Enchanter": [{ id: 1406, qty: 1 }, { id: 672, qty: 1 }],            // Arcanism Grimoire, Scribe's Prismatic Ink
    "Berserker": [{ id: 87, qty: 1 }, { id: 88, qty: 1 }],               // Berserker Amulet, Guard Breaker
    "Acrobat": [{ id: 91, qty: 1 }],                                     // Crystal Running Shoes
    "Monk": [{ id: 90, qty: 1 }, { id: 722, qty: 1 }],                   // Perfect Block EP:, Mental Focus Training
    "Brawler": [{ id: 723, qty: 1 }, { id: 832, qty: 1 }],               // Fighter's Focus, Used Hand Wraps
    "Boxer": [{ id: 833, qty: 1 }, { id: 834, qty: 1 }],                 // Cracked Mouthguard, Torn Gloves
    "Pro Wrestler": [{ id: 328, qty: 1 }, { id: 323, qty: 1 }],          // Championship Belt, Tournament Trophy
    "Fire Mage": [{ id: 1400, qty: 1 }, { id: 658, qty: 1 }],            // Elemental Grimoire, Fireball Scroll
    "Ice Mage": [{ id: 1400, qty: 1 }, { id: 655, qty: 1 }],             // Elemental Grimoire, Frost Bomb
    "Rogue": [{ id: 1431, qty: 1 }, { id: 374, qty: 1 }],                // Roguery Skill Book, Lockpick
    "Paladin": [{ id: 1401, qty: 1 }, { id: 662, qty: 1 }],              // Holy Magic Grimoire, Shield Scroll
    "Warlock": [{ id: 1404, qty: 1 }, { id: 666, qty: 1 }],              // Forbidden Magic Grimoire, Scroll of Destruction
    "Ranger": [{ id: 1424, qty: 1 }, { id: 810, qty: 1 }],               // Natural Skill Book, Elven Rope
    "Cleric": [{ id: 1419, qty: 1 }, { id: 648, qty: 2 }],               // Healing Grimoire, Health Potion
    "Samurai": [{ id: 1422, qty: 1 }, { id: 97, qty: 1 }],               // Swordsmanship Skill Book, Ancient Scroll
    "Archmage": [{ id: 1406, qty: 1 }, { id: 685, qty: 1 }],             // Arcanism Grimoire, Mage's Crystal
    "Scout": [{ id: 1430, qty: 1 }, { id: 137, qty: 1 }],                // Tactical Skill Book, Portable GPS Navigator
    "Oracle": [{ id: 1412, qty: 1 }, { id: 676, qty: 1 }],               // Augury Grimoire, Seer's Thimble
    "Gladiator": [{ id: 314, qty: 1 }, { id: 324, qty: 1 }],             // Champion's Tooth, Ancient Fighting Coin
    "Necromancer": [{ id: 1403, qty: 1 }, { id: 724, qty: 1 }],          // Necromancy Grimoire, Floating skull
    "Commander": [{ id: 1429, qty: 1 }, { id: 234, qty: 1 }],            // Leadership Skill Book, Navigator's Compass
    "Guardian": [{ id: 662, qty: 1 }, { id: 656, qty: 1 }],              // Shield Scroll, Dragon Scale Barrier
    "Spellblade": [{ id: 1400, qty: 1 }, { id: 1422, qty: 1 }],          // Elemental Grimoire, Swordsmanship Skill Book
    "Bard": [{ id: 1428, qty: 1 }, { id: 236, qty: 1 }],                 // Performance Skill Book, Magician's Flute
    "Illusionist": [{ id: 1415, qty: 1 }, { id: 663, qty: 1 }],          // Illusion Grimoire, Invisibility Scroll
    "Battlemage": [{ id: 1418, qty: 1 }, { id: 661, qty: 1 }],           // Tempest Grimoire, Lightning Bolt Scroll
    "Mercenary": [{ id: 385, qty: 1 }, { id: 73, qty: 1 }],              // Secure Transport Case, Molotov Cocktail
    "Sage": [{ id: 1407, qty: 1 }, { id: 34, qty: 1 }],                  // Meta Magic Grimoire, Wisdom Elixir
    "Barbarian": [{ id: 79, qty: 1 }, { id: 653, qty: 1 }],              // Throwing Axe, Giant's Potion
    "Doctor": [{ id: 244, qty: 1 }, { id: 48, qty: 1 }],                 // Surgical Tools, Ultimate Booster
    "Scientist": [{ id: 962, qty: 1 }, { id: 390, qty: 1 }],             // Horseshoe Crab Blood, Field Analysis Kit
    "Firefighter": [{ id: 808, qty: 1 }, { id: 813, qty: 1 }],           // Escape kit, Climbing Rope
    "Police Officer": [{ id: 381, qty: 1 }, { id: 388, qty: 1 }],        // Trace Removal Powder, Covert Recorder
    "Chef": [{ id: 1427, qty: 1 }, { id: 232, qty: 1 }],                 // Cooking Skill Book, Chef's Spice Blend
    "Journalist": [{ id: 386, qty: 1 }, { id: 144, qty: 1 }],            // Journalist's Endless Notepad, Digital Camera
    "Construction Worker": [{ id: 138, qty: 1 }, { id: 156, qty: 1 }],   // Shovel, Toolmaker's Multi-tool
    "Academic": [{ id: 299, qty: 1 }, { id: 127, qty: 1 }],              // Scholar's Legal Tome, Pocket Notebook
    "Psychologist": [{ id: 722, qty: 1 }, { id: 378, qty: 1 }],          // Mental Focus Training, Truth-Revealing Solution
    "Archaeologist": [{ id: 354, qty: 1 }, { id: 249, qty: 1 }],         // Fake Treasure Map, Astronomer's Astrolabe
    "Nurse": [{ id: 19, qty: 1 }, { id: 17, qty: 2 }],                   // Medical Spray, Electrolyte Powder
    "Hunter-Gatherer": [{ id: 1423, qty: 1 }, { id: 806, qty: 1 }],      // Bestial Skill Book, Walking Stick
    "Physicist": [{ id: 139, qty: 1 }, { id: 140, qty: 1 }],             // Resonance Scanner, Raman probe
    "Mechanic": [{ id: 146, qty: 1 }, { id: 814, qty: 1 }],              // Fuel tank, Multi-tool
    "Shopkeeper": [{ id: 1437, qty: 1 }, { id: 387, qty: 1 }],           // Economy Skill Book, Precision Digital Scale
    "Farmer": [{ id: 1433, qty: 1 }, { id: 240, qty: 1 }],               // Pastoral Skill Book, Botanist's Seed Collection
    "Lumberjack": [{ id: 151, qty: 1 }, { id: 814, qty: 1 }],            // Craftsman's Backpack, Multi-tool
    "Meteorologist": [{ id: 216, qty: 1 }, { id: 150, qty: 1 }],         // Aurora Essence, Telescope
    "Priest": [{ id: 1401, qty: 1 }, { id: 264, qty: 1 }],               // Holy Magic Grimoire, 92 Days of Solomon
    "Entertainer": [{ id: 1428, qty: 1 }, { id: 186, qty: 1 }],          // Performance Skill Book, Pocket Sound System
    "Demigod": [{ id: 697, qty: 1 }, { id: 692, qty: 1 }],               // Wish-Granting Orb, Ambrosia
    "Wretch": [{ id: 836, qty: 1 }, { id: 828, qty: 1 }],                // Rubbish, Expired Cheese
    "Beast": [{ id: 27, qty: 1 }, { id: 627, qty: 1 }],                  // Beast Tongue Elixir, Jaguar Musk Gland
    "Mimic": [{ id: 709, qty: 2 }, { id: 347, qty: 1 }],                 // Unidentified Item, Not-So-Magic Bean
    "Monster": [{ id: 725, qty: 1 }, { id: 89, qty: 1 }],                // Spirit Parasite, Broken Cryocell
    "Mana Cyborg": [{ id: 731, qty: 1 }, { id: 732, qty: 1 }],           // Neuro-Quantum Amplifier, Overdrive Implant
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
    weaponsForType,

    // Functions
    getCompatibleWeaponTypes,
    getCompatibleWeapons,
    equipRandomCompatibleWeapon,
    learnStarterSkills,
    applyStartingGear,
    getClassStartingItems,
    giveClassStartingItems
  };

  console.log(`${pluginName} loaded successfully.`);
})();
