/*:
 * @target MZ
 * @plugindesc Character preset management system with save/load functionality and UI windows
 * @author Omni-Lex
 * @orderAfter CharacterCreationShared
 * @orderAfter StartingEquipment
 * @orderBefore ClassSelection
 * @orderBefore CharacterCreation
 *
 * @command saveCharacterPreset
 * @text Save Character Preset
 * @desc Saves the current character as a preset for future use
 *
 * @command savePartyMember
 * @text Send Away Party Member
 * @desc Retires a party member: removes them and files them as a playable dossier for this world
 *
 * @arg memberIndex
 * @text Party Slot
 * @desc Which party slot to retire. The leader (slot 1) cannot be retired, and the party is never left empty.
 * @type select
 * @option 2nd Party Member
 * @value 2
 * @option 3rd Party Member
 * @value 3
 * @default 2
 *
 * @help
 * This plugin manages character presets:
 * - Default preset data (Bubba, Em, Selene)
 * - Endless dossiers (endless: true) that are never spent for the world, and
 *   are listed first on the selection board
 * - Procedural dossier backgrounds (proceduralLore: "em") and hometowns
 *   (proceduralHometown: "em")
 * - Dossier vehicles (vehicle: { key, mapId, x, y, worldX, worldY }) parked for
 *   their owner at creation time
 * - Dossier skins (skins: [{ key, sprite, spriteIndex, busts }]), the alternate
 *   looks a pre-made character can be played as, picked on the dossier page
 * - Preset CRUD operations (create, read, update, delete)
 * - Character creation completion tracking
 * - Preset selection UI (Window_CharacterPresets)
 * - Stats explanation UI (Window_StatsExplanation)
 *
 * Dependencies:
 * - CharacterCreationShared.js (for trait application)
 * - StartingEquipment.js (for equipment management)
 *
 * Functions exported to global namespace:
 * - window.CharacterPresets.getCharacterPresets()
 * - window.CharacterPresets.getAvailableCharacterPresets()
 * - window.CharacterPresets.retirePartyMember(actorId)
 * - window.CharacterPresets.unretirePartyMember(presetId)
 * - window.CharacterPresets.getAvailableRetiredPresets()
 * - window.CharacterPresets.isPresetUsed(presetId)
 * - window.CharacterPresets.isPresetEndless(presetId)
 * - window.CharacterPresets.markPresetUsed(presetId)
 * - window.CharacterPresets.getPresetSwitchIds()
 * - window.CharacterPresets.getPresetLore(preset)
 * - window.CharacterPresets.getPresetHometown(preset)
 * - window.CharacterPresets.getPresetSkins(preset)
 * - window.CharacterPresets.getPresetSkin(preset, index)
 * - window.CharacterPresets.getPresetSkinLabel(skin)
 * - window.CharacterPresets.getEmBackstory()
 * - window.CharacterPresets.isEmPlaythrough()
 * - window.CharacterPresets.isBeastCrew()
 * - window.CharacterPresets.emLabel(key, fallback)
 * - window.CharacterPresets.camperName(fallback)
 * - window.CharacterPresets.applyPresetVehicle(preset)
 * - window.CharacterPresets.removePresetById(presetId)
 * - window.CharacterPresets.getNextPresetId()
 * - window.CharacterPresets.markStepCompleted(stepIndex)
 * - window.CharacterPresets.isStepCompleted(stepIndex)
 * - window.CharacterPresets.Window_CharacterPresets
 * - window.CharacterPresets.Window_StatsExplanation
 */

(() => {
  const pluginName = "CharacterPresets";

  //=============================================================================
  // Default Character Presets Data
  //=============================================================================

  // Some historical dossiers were drawn more than once: the same person in a
  // second outfit, a second office, a second state of being. Those alternates
  // are skins, picked on the dossier page before the character is taken, and a
  // skin is a sprite and a bust that share one asset name (img/characters/Skab
  // and img/busts). `key` is the label the skin reads by, resolved from
  // CharPresets.skin.<key>; only the walk-cycle sheets qualify, since a skin is
  // what the player then walks around as.
  const skin = (key, asset) => ({
    key,
    sprite: "Skab/!$" + asset,
    spriteIndex: 0,
    busts: asset,
  });

  // i18n-ignore-start: proper names, nation keys into HistorySimulator_COUNTRIES
  // and asset ids. Each dossier's prose lives in CharPresets.lore.<id>.
  let CharacterPresets = [
    {
      id: 1,
      name: "Bubba",
      classId: 54,
      sprite: "Fantasy_Characters1",
      spriteIndex: 1,
      mapId: 722,
      x: 55,
      y: 48,
      switches: [49, 50],
      birthDate: "1968-07-14", // Date of birth
      nationId: "Ireland", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 90000,
      items: [
        { id: 1, amount: 5 },   // Potion x5
        { id: 111, amount: 1 }, // Liminal cuffs - summons The Beast
      ],
      weapons: [{ id: 12, amount: 1 }], // Axe x1
      armors: [{ id: 4, amount: 1 }], // Ring x1
      equips: [null, null, null, null, null],
      skills: [10],
      traits: [],
      specializations: [
        { id: 173, level: 5 }, // Mechanics (Master)
        { id: 296, level: 3 }, // Welding
        { id: 285, level: 3 }, // Truck Driving
        { id: 96, level: 2 },  // Electrical Wiring
      ],
      busts: "Bubba",
    },
    {
      id: 2,
      name: "Em",
      classId: 2,
      sprite: "Other/!$Em",
      spriteIndex: 1,
      mapId: 722,
      x: 48,
      y: 48,
      switches: [48, 50],
      birthDate: "1982-11-03", // Date of birth
      // The one fixed point across her branches: whatever else that dimension
      // did with history, Em was born in Britain in it. The town is not fixed,
      // only the country (see proceduralHometown / buildEmTownName below).
      nationId: "United Kingdom", // Nation of birth (key into HistorySimulator_COUNTRIES)
      proceduralHometown: "em", // Rolled per incarnation; the first one is Wimbledon
      gender: 1, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "asexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "aromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 20000,
      items: [{ id: 111, amount: 1 }], // Liminal cuffs
      weapons: [{ id: 6, amount: 1 }],
      armors: [
        { id: 434, amount: 1 },
        { id: 435, amount: 1 },
      ],
      equips: [null, null, null, null, null],
      skills: [],
      traits: [],
      specializations: [
        { id: 165, level: 4 }, // Magic Theory
        { id: 73, level: 3 },  // Spell Concentration
        { id: 164, level: 2 }, // Lucid Dreaming
      ],
      busts: "Em",
      // The Beast is waiting outside where she left it. Parked on her home map
      // (722) and mirrored onto the world map at 88,131 so it is visible and
      // boardable from map 315 too, not only from the tile it physically sits on.
      vehicle: { key: "camper", mapId: 722, x: 49, y: 44, worldX: 88, worldY: 131 },
      // Never spent: every playthrough of every world can pick Em again.
      endless: true,
      // Her background is rolled instead of written (see buildEmLore).
      proceduralLore: "em",
    },
    {
      id: 3,
      name: "Selene",
      classId: 6,
      sprite: "School01RM",
      spriteIndex: 2,
      mapId: 561,
      x: 15,
      y: 11,
      switches: [58],
      birthDate: "1991-04-22", // Date of birth
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 1, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "homosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "homoromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 5000000,
      items: [],
      weapons: [],
      armors: [],
      equips: [],
      skills: [],
      traits: [],
      specializations: [
        { id: 1, level: 3 },   // Accounting
        { id: 259, level: 3 }, // Stock Trading
        { id: 186, level: 2 }, // Negotiation
      ],
      busts: "Selene",
    },
    {
      id: 4,
      name: "Giulio Andreotti",
      classId: 6, // CEO (power broker / statesman, closest analog to career politician)
      sprite: "Skab/!$Andreotti",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1919-01-14", // Date of birth
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 2000000, // 20,000€ - decades as the most powerful man in Italian politics
      items: [
        { id: 127, amount: 1 }, // Pocket Notebook - kept files on everyone
        { id: 711, amount: 1 }, // Newspaper
      ],
      weapons: [],
      armors: [{ id: 378, amount: 1 }], // Envoy's Sashed Coat
      equips: [null, null, null, null, null],
      skills: [],
      traits: [7, 98, 116, 174], // Genius, Tactician, Devout, Infamous
      specializations: [
        { id: 706, level: 4 }, // Political Science
        { id: 350, level: 3 }, // Espionage - kept files on everyone
        { id: 277, level: 2 }, // Theology
        { id: 218, level: 2 }, // Public Speaking
      ],
      busts: "Andreotti",
      skins: [
        skin("statesman", "Andreotti"),
        skin("arcane", "AndreottiArcane"),
        skin("pontiff", "AndreottiPope"),
        skin("seated", "AndreottiSitting"),
      ],
    },
    {
      id: 5,
      name: "Margherita Hack",
      classId: 53, // Physicist (astrophysicist)
      sprite: "Skab/!$MargheritaHack",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1922-06-12", // Date of birth
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 1, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 150000, // 1,500€ - famously modest academic salary
      items: [{ id: 150, amount: 1 }], // Telescope
      weapons: [],
      armors: [{ id: 404, amount: 1 }], // Shifting Sight Glasses
      equips: [null, null, null, null, null],
      skills: [],
      traits: [7, 18, 37, 117], // Genius, Vegetarian, Skeptic, Atheist
      specializations: [
        { id: 23, level: 5 },  // Astronomy (Master)
        { id: 202, level: 4 }, // Physics
        { id: 429, level: 3 }, // Radio Astronomy
      ],
      busts: "MargheritaHack",
      skins: [
        skin("astronomer", "MargheritaHack"),
        skin("eva", "MargheritaHackEVA"),
        skin("flightSuit", "MargheritaHackSpace"),
      ],
    },
    {
      id: 6,
      name: "Bill Clinton",
      classId: 35, // Bard (charismatic orator and saxophonist)
      sprite: "Skab/!$BillClinton",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1946-08-19", // Date of birth
      // No nationId: the United States is not a nation tracked by HistorySimulator_COUNTRIES
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 4000000, // 40,000€ - wealthy career politician and public speaker
      items: [175],
      weapons: [],
      armors: [{ id: 311, amount: 1 }], // Deal-Closer Suit
      equips: [null, null, null, null, null],
      skills: [],
      traits: [81, 132, 143, 174], // Charismatic, Scholar, Bard, Infamous
      specializations: [
        { id: 820, level: 5 }, // Saxophone (Master) - the Arsenio Hall Show sax solo
        { id: 218, level: 4 }, // Public Speaking
        { id: 186, level: 3 }, // Negotiation
        { id: 155, level: 2 }, // Law - Yale Law, Arkansas AG
      ],
      busts: "BillClinton",
    },
    {
      id: 7,
      name: "Richard Benson",
      classId: 60, // Entertainer (flamboyant Italian TV showman)
      sprite: "Skab/!$RichardBenson",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 800000, // 8,000€ - TV celebrity earnings
      items: [],
      weapons: [],
      armors: [{ id: 298, amount: 1 }], // Rhinestone Denim Suit
      equips: [null, null, null, null, null],
      skills: [],
      traits: [81, 82, 143, 173], // Charismatic, Extrovert, Bard, Famous
      specializations: [
        { id: 3, level: 3 },   // Acting
        { id: 218, level: 3 }, // Public Speaking
        { id: 240, level: 2 }, // Singing
        { id: 82, level: 2 },  // Dancing
      ],
      busts: "RichardBenson",
    }, /*
    {
      id: 8,
      name: "Silvio Berlusconi",
      classId: 6, // CEO (media mogul / businessman)
      sprite: "Skab/!$Berlusconi",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1936-09-29", // Date of birth
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 8000000, // 80,000€ - media tycoon, once Italy's richest man
      items: [],
      weapons: [],
      armors: [{ id: 410, amount: 1 }], // Dominion Power Suit
      equips: [null, null, null, null, null],
      skills: [],
      traits: [81, 85, 131, 174], // Charismatic, Ambitious, Wealthy, Infamous
      specializations: [
        { id: 1, level: 3 },   // Accounting
        { id: 218, level: 4 }, // Public Speaking
        { id: 231, level: 3 }, // Seduction
        { id: 259, level: 2 }, // Stock Trading
      ],
      busts: "Berlusconi",
    },
    {
      id: 9,
      name: "Carlo Azeglio Ciampi",
      classId: 48, // Academic (central banker / technocrat)
      sprite: "Skab/!$Ciampi",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1920-12-09", // Date of birth
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 1200000, // 12,000€ - respected technocrat, Bank of Italy governor turned President
      items: [],
      weapons: [],
      armors: [{ id: 183, amount: 1 }], // Formal Service Tunic
      equips: [null, null, null, null, null],
      skills: [],
      traits: [95, 132, 171, 92], // Stoic, Scholar, Honest, Humble
      specializations: [
        { id: 1, level: 4 },   // Accounting
        { id: 259, level: 3 }, // Stock Trading
        { id: 258, level: 3 }, // Statistics
        { id: 135, level: 2 }, // History
      ],
      busts: "Ciampi",
    },
    {
      id: 10,
      name: "Mario Draghi",
      classId: 32, // Commander ("whatever it takes" crisis leadership)
      sprite: "Skab/!$MarioDraghi",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1947-09-03", // Date of birth
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 3000000, // 30,000€ - ECB President turned Italian PM
      items: [],
      weapons: [],
      armors: [{ id: 420, amount: 1 }], // Broker's Formal Array
      equips: [null, null, null, null, null],
      skills: [],
      traits: [7, 40, 98, 173], // Genius, Workaholic, Tactician, Famous
      specializations: [
        { id: 259, level: 5 }, // Stock Trading (Master)
        { id: 1, level: 4 },   // Accounting
        { id: 156, level: 3 }, // Leadership
        { id: 258, level: 3 }, // Statistics
      ],
      busts: "MarioDraghi",
      skins: [
        skin("banker", "MarioDraghi"),
        skin("ascended", "MarioDraghiAscended"),
      ],
    },*/
    {
      id: 8,
      name: "Pope Petrus II",
      classId: 59, // Priest
      sprite: "Skab/!$Ratzinger",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1927-04-16", // Date of birth
      nationId: "Italy", // Elected Pope while resident in Vatican City (not tracked separately)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 500000, // 5,000€ - personal vow of modesty despite the office
      items: [],
      weapons: [],
      armors: [{ id: 519, amount: 1 }], // High Cleric's Vestments
      equips: [null, null, null, null, null],
      skills: [],
      traits: [132, 116, 83, 50], // Scholar, Devout, Introvert, Ascetic
      specializations: [
        { id: 277, level: 5 }, // Theology (Master)
        { id: 199, level: 4 }, // Philosophy
        { id: 174, level: 3 }, // Meditation
        { id: 159, level: 3 }, // Linguistics
      ],
      busts: "Ratzinger",
    },
    {
      id: 9,
      name: "Rita Levi-Montalcini",
      classId: 42, // Scientist (Nobel-laureate neurologist)
      sprite: "Skab/!$RitaLeviMontalcini",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1909-04-22", // Date of birth
      nationId: "Italy", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 1, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 600000, // 6,000€ - senator for life, lifelong modest academic
      items: [{ id: 954, amount: 1 }], // Penicillin Precursors
      weapons: [],
      armors: [{ id: 511, amount: 1 }], // Iron Conviction Robes
      equips: [null, null, null, null, null],
      skills: [],
      traits: [7, 40, 97, 129], // Genius, Workaholic, Survivalist, Exiled
      specializations: [
        { id: 682, level: 5 }, // Neurology (Master)
        { id: 11, level: 4 },  // Anatomy
        { id: 511, level: 3 }, // Biochemical Engineering
        { id: 634, level: 2 }, // Immunology
      ],
      busts: "RitaLeviMontalcini",
      skins: [
        skin("senator", "RitaLeviMontalcini"),
        skin("labCoat", "RitaLeviMontalciniScientist"),
      ],
    },
    {
      id: 10,
      name: "Aleister Crowley",
      classId: 8, // Cultist (founder of Thelema)
      sprite: "Skab/!$AleisterCrowley",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1875-10-12", // Date of birth
      nationId: "United Kingdom", // Nation of birth (key into HistorySimulator_COUNTRIES)
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "bisexual", // key into js/db/NPC/Orientations.json (sexual); well documented in his own writing
      romanticOrientation: "biromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 300000, // 3,000€ - squandered his inherited fortune, died in poverty
      items: [{ id: 1404, amount: 1 }], // Forbidden Magic Grimoire
      weapons: [],
      armors: [{ id: 531, amount: 1 }], // Robes of the Great Beast
      equips: [null, null, null, null, null],
      skills: [1404, 1405, 1477, 1492, 1513, 1558, 1567, 1570, 1580, 1600, 1617, 1655, 1668, 1679, 1685, 1700, 1707],
      traits: [81, 118, 104, 174], // Charismatic, Heretic, Drug Dependent, Infamous
      specializations: [
        { id: 165, level: 5 }, // Magic Theory (Master)
        { id: 309, level: 3 }, // Alchemy
        { id: 22, level: 3 },  // Astrology
        { id: 137, level: 3 }, // Hypnosis
      ],
      busts: "AleisterCrowley",
      skins: [
        skin("magus", "AleisterCrowley"),
        // Asset name keeps the misspelling both files were shipped with.
        skin("arcane", "AleisteirCrowleyArcane"),
      ],
    },
    {
      id: 11,
      name: "Kofi Annan",
      classId: 39, // Sage (elder statesman / diplomat)
      sprite: "Skab/!$KofiAnnan",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1938-04-08", // Date of birth
      // No nationId: Ghana is not a nation tracked by HistorySimulator_COUNTRIES
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 700000, // 7,000€ - UN Secretary-General, Nobel Peace Prize laureate
      items: [],
      weapons: [],
      armors: [{ id: 378, amount: 1 }], // Envoy's Sashed Coat
      equips: [null, null, null, null, null],
      skills: [],
      traits: [33, 81, 88, 171], // Empath, Charismatic, Generous, Honest
      specializations: [
        { id: 88, level: 5 },  // Diplomacy (Master)
        { id: 218, level: 3 }, // Public Speaking
        { id: 159, level: 3 }, // Linguistics
        { id: 706, level: 3 }, // Political Science
      ],
      busts: "KofiAnnan",
    },
    {
      id: 12,
      name: "George W. Bush",
      classId: 32, // Commander (wartime president)
      sprite: "Skab/!$GeorgeWBush",
      spriteIndex: 0,
      mapId: 708,
      x: 24,
      y: 12,
      switches: [],
      birthDate: "1946-07-06", // Date of birth
      // No nationId: the United States is not a nation tracked by HistorySimulator_COUNTRIES
      gender: 0, // 0=Male 1=Female 2=Non-binary 3=Cocoon
      sexualOrientation: "heterosexual", // key into js/db/NPC/Orientations.json (sexual)
      romanticOrientation: "heteroromantic", // key into js/db/NPC/Orientations.json (romantic)
      money: 5000000, // 50,000€ - Texas oil family wealth plus presidential post-career earnings
      items: [{ id: 131, amount: 1 }], // Bike - avid post-presidency mountain biker
      weapons: [],
      armors: [],
      equips: [null, null, null, null, null],
      skills: [],
      traits: [116, 172, 89, 160], // Devout, Blunt, Loyal, Optimist
      specializations: [
        { id: 156, level: 3 }, // Leadership
        { id: 31, level: 3 },  // Baseball - managing partner of the Texas Rangers
        { id: 277, level: 2 }, // Theology
        { id: 218, level: 2 }, // Public Speaking
      ],
      busts: "GeorgeWBush",
    }
  ];
  // i18n-ignore-end

  //=============================================================================
  // Procedural dossier lore (Em)
  //=============================================================================
  // Em is the one dossier that is never spent (endless: true), and the reason is
  // diegetic: the Em who walks out of character creation is never the same Em.
  // Each pick is a different branch of her, so her background cannot be a fixed
  // paragraph. It is composed out of five banks, one sentence each, from a seed
  // rolled once per playthrough and kept on $gameSystem (_emDimensionSeed): the
  // text is therefore stable while the player browses the dossier and for the
  // whole life of the resulting save, and freshly rolled on the next new game.

  const EM_BANK_COUNT = 5;

  /**
   * 32-bit integer hash, the same avalanche mix the other world-seeded
   * generators use, so one seed spreads evenly over the banks.
   * @param {number} n - Input integer
   * @returns {number} Hashed unsigned 32-bit integer
   */
  function mix32(n) {
    let h = n | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * The dimension Em is arriving from in this playthrough. Rolled on first use
   * and stored on $gameSystem, so it is stable for this save and different in
   * the next new game (where $gameSystem is fresh). Mixed with the world seed so
   * the roll still belongs to the world it happens in.
   * @returns {number} Seed for buildEmLore
   */
  function emDimensionSeed() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return 1;
    if (!$gameSystem._emDimensionSeed) {
      const worldSeed = window.HistoryManager && window.HistoryManager.getSeed
        ? window.HistoryManager.getSeed() | 0
        : 0;
      const roll = Math.floor(Math.random() * 0x7fffffff);
      $gameSystem._emDimensionSeed = mix32(worldSeed ^ roll) || 1;
    }
    return $gameSystem._emDimensionSeed;
  }

  /**
   * Compose one Em background out of the banks.
   * @param {number} seed - Dimension seed
   * @returns {{en: string, it: string}} Localized lore
   */
  function buildEmLore(seed) {
    const parts = [];
    for (let i = 0; i < EM_BANK_COUNT; i++) {
      const bank = T.pool('CharPresets.emBank.' + i);
      if (bank.length) parts.push(bank[mix32(seed + i * 0x9e3779b9) % bank.length]);
    }
    return parts.join(" ");
  }

  /**
   * Lore of a dossier, resolving procedural backgrounds. Every consumer of
   * preset.lore should go through this instead of reading the field directly.
   * @param {object} preset - Preset dossier
   * @returns {string} Lore in the active language, or "" when there is none
   */
  function getPresetLore(preset) {
    if (!preset) return "";
    if (preset.proceduralLore === "em") return buildEmLore(emDimensionSeed());
    const key = 'CharPresets.lore.' + preset.id;
    if (T.has(key)) return T(key);
    // A retired party member's generated dossier carries its own sentence.
    const own = preset.lore;
    if (!own) return "";
    return typeof own === "string" ? own : (T.language() === "it" ? (own.it || own.en) : (own.en || own.it)) || "";
  }

  //=============================================================================
  // Procedural hometown (Em)
  //=============================================================================
  // Em is always British, in every branch she falls out of, but only the first
  // Em a world ever receives is from the Wimbledon that exists here. Every one
  // after her comes from a town that rhymes with it and does not exist on this
  // branch's maps: Kembledon, Brambledon, Thimbledon. The number of Ems a world
  // has already taken lives in $gameSystem._emIncarnations (world-scoped, see
  // recordEndlessPick), and the town picked for THIS playthrough is locked onto
  // $gameSystem._emHometown the first time anything asks for it, exactly like
  // the dimension seed: the dossier the player reads is the dossier they get,
  // and it stays that way for the life of the save even after the world counter
  // has moved on for the next playthrough.

  const EM_HOMETOWN_ORIGINAL = "Wimbledon";   // i18n-ignore: place name

  // First syllables; the suffix is always "bledon".
  // i18n-ignore-start: syllables of an invented place name, not prose
  const EM_TOWN_PREFIXES = [
    "Wem", "Ham", "Hem", "Kem", "Cam", "Bram", "Grim", "Tram", "Dun", "Fen",
    "Marl", "Pen", "Rud", "Sud", "Thim", "Tarn", "Wal", "Wor", "Yar", "Shel",
    "Stan", "Nor", "Hal", "Mor", "Pil", "Wen", "Wist", "Cor", "Ram", "Tid",
  ];
  // i18n-ignore-end

  /**
   * Name of the town this Em is from, for every incarnation after the first.
   * @param {number} seed - Dimension seed
   * @param {number} index - How many Ems this world has already taken
   * @returns {string} Town name ending in "bledon"
   */
  function buildEmTownName(seed, index) {
    const roll = mix32(seed + (index | 0) * 0x85ebca6b);
    return EM_TOWN_PREFIXES[roll % EM_TOWN_PREFIXES.length] + "bledon";
  }

  /**
   * Hometown of the Em of this playthrough. Rolled and locked on first use.
   * @returns {string} Town name
   */
  function emHometown() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) {
      return EM_HOMETOWN_ORIGINAL;
    }
    if (!$gameSystem._emHometown) {
      const index = $gameSystem._emIncarnations | 0;
      $gameSystem._emHometown = index > 0
        ? buildEmTownName(emDimensionSeed(), index)
        : EM_HOMETOWN_ORIGINAL;
    }
    return $gameSystem._emHometown;
  }

  /**
   * Hometown of a dossier, resolving procedural ones. Consumers should go
   * through this instead of reading preset.hometown directly.
   * @param {object} preset - Preset dossier
   * @returns {string} Town name, or "" when the dossier names no town
   */
  function getPresetHometown(preset) {
    if (!preset) return "";
    if (preset.proceduralHometown === "em") return emHometown();
    return preset.hometown || "";
  }

  //=============================================================================
  // Em's canon backstory (docs/Lore.odt)
  //=============================================================================
  // The branch she fell out of is rolled (buildEmLore above), but what was done
  // to her is fixed in every one of them, and it is the only party member's
  // history the life simulator can never produce: she has no simulated past,
  // because the Solomonic Ritual took it. The Empathize History tab prints this
  // whenever Em is the one being looked at. {town} is her rolled hometown.


  /**
   * Em's fixed history, with her rolled hometown filled in.
   * @param {string} [lang] - "it" or "en" (defaults to the current language)
   * @returns {{paragraphs: string[], branch: string}} Canon paragraphs plus the
   *   procedural paragraph describing the branch THIS Em arrived from
   */
  function getEmBackstory(lang) {
    const code = (lang || (typeof ConfigManager !== "undefined" ? ConfigManager.language : "en")) === "it" ? "it" : "en";
    const preset = getBasePresets().find((entry) => entry && entry.proceduralLore === "em") || null;
    const town = getPresetHometown(preset) || EM_HOMETOWN_ORIGINAL;
    const lore = getPresetLore(preset);
    return {
      paragraphs: T.pool('CharPresets.emBackstory').map((line) =>
        line.replace(/\{town\}/g, town)
      ),
      branch: lore || "",
    };
  }

  //=============================================================================
  // Em's register (UI relabelling while she is in play)
  //=============================================================================
  // Em is twenty-something, British, missing most of her life and refuses to
  // treat any of it with the gravity everyone else does. While she is in the
  // party the interface picks up her vocabulary: nobody rests, they nap; nobody
  // waits, they waste time; the party's leisure meter is a boredom meter. It is
  // cosmetic only, so every consumer passes the ordinary label as the fallback
  // and gets it straight back on an ordinary playthrough.
  //
  // Switch 48 is Em's dossier switch, 49 is Bubba's. The camper is The Beast to
  // both of them (it is his, and they share it), so its rename answers to
  // either, while the rest of the register is Em's alone.

  const EM_SWITCH = 48;
  const BUBBA_SWITCH = 49;
  const EM_NAME = "Em";


  /**
   * Whether Em is in play. Switch 48 is set by her dossier when creation ends,
   * so it survives her being handed the party lead later; the name check covers
   * an Em who joined outside creation, or a run whose switches were reset.
   * @returns {boolean} True while Em travels with the party
   */
  function isEmPlaythrough() {
    if (typeof $gameSwitches !== "undefined" && $gameSwitches && $gameSwitches.value(EM_SWITCH)) {
      return true;
    }
    if (typeof $gameParty !== "undefined" && $gameParty && $gameParty.members) {
      return $gameParty.members().some((member) => member && member.name() === EM_NAME);
    }
    return false;
  }

  /**
   * Whether the camper is The Beast for this party: Em's dossier, Bubba's, or
   * either of them travelling with it.
   * @returns {boolean} True when the camper answers to its name
   */
  function isBeastCrew() {
    if (typeof $gameSwitches !== "undefined" && $gameSwitches &&
      ($gameSwitches.value(EM_SWITCH) || $gameSwitches.value(BUBBA_SWITCH))) {
      return true;
    }
    return isEmPlaythrough();
  }

  /**
   * A label in Em's register, or the ordinary one when she is not in play.
   * @param {string} key - Key into CharPresets.emLabel
   * @param {string} fallback - Label used on an ordinary playthrough
   * @returns {string} Label to display
   */
  function emLabel(key, fallback) {
    if (!isEmPlaythrough()) return fallback;
    const full = 'CharPresets.emLabel.' + key;
    return T.has(full) ? T(full) : fallback;
  }

  /**
   * What the camper is called for this party.
   * @param {string} [fallback] - Name used by everyone else
   * @returns {string} "The Beast" for Em and Bubba, the fallback otherwise
   */
  function camperName(fallback) {
    const plain = fallback || T('CharPresets.camper');
    if (!isBeastCrew()) return plain;
    return T('CharPresets.theBeast');
  }

  //=============================================================================
  // Preset Management Functions
  //=============================================================================

  /**
   * Hand-authored + save-local presets, the array that write operations own
   * @returns {array} Array of preset objects (live reference, safe to mutate)
   */
  function getBasePresets() {
    // $gameSystem is serialized into the save file, so presets stored here
    // survive a restart. $dataSystem is re-seeded from the database on every
    // boot and is never serialized, so it must not be used for persistence.
    if (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._characterPresets) {
      return $gameSystem._characterPresets;
    }
    return CharacterPresets;
  }

  /**
   * Retired party members, world-scoped (see retirePartyMember)
   * @returns {array} Array of preset objects
   */
  function getRetiredPresets() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return [];
    const list = $gameSystem._retiredCharacterPresets;
    return Array.isArray(list) ? list : [];
  }

  /**
   * Get current character presets (dossiers + retired party members)
   * @returns {array} Array of preset objects (read-only: may be a fresh array)
   */
  function getCharacterPresets() {
    const base = getBasePresets();
    const retired = getRetiredPresets();
    const all = retired.length ? base.concat(retired) : base.slice();
    // Endless dossiers (Em) head the board: they are the only ones always
    // there, whatever the world has already spent. Sorted rather than kept
    // first in the array literal, so presets restored from an older save
    // ($gameSystem._characterPresets) come out in the same order too.
    return all.sort((a, b) => (b.endless ? 1 : 0) - (a.endless ? 1 : 0));
  }

  //=============================================================================
  // Per-world preset usage
  //=============================================================================
  // A pre-made character belongs to the world, not to a single playthrough: once
  // someone has started as Bubba in a world, that dossier is spent and no later
  // savegame of the same world can pick it again. The used ids live on
  // $gameSystem._usedCharacterPresets, which WorldManager redirects into the
  // world folder (world.json). Without WorldManager it degrades gracefully to a
  // plain per-save property.

  /**
   * Ids of presets already played in the current world
   * @returns {number[]} Used preset ids
   */
  function getUsedPresetIds() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return [];
    const ids = $gameSystem._usedCharacterPresets;
    return Array.isArray(ids) ? ids : [];
  }

  /**
   * Whether a dossier is exempt from the one-play-per-world rule. Em is the only
   * one: she is a different Em every time, so there is nothing to spend.
   * @param {number} presetId - Preset ID
   * @returns {boolean} Endless status
   */
  function isPresetEndless(presetId) {
    const preset = getCharacterPresets().find((entry) => entry.id === presetId);
    return !!(preset && preset.endless);
  }

  /**
   * Whether a preset has already been played in this world
   * @param {number} presetId - Preset ID
   * @returns {boolean} Used status
   */
  function isPresetUsed(presetId) {
    if (isPresetEndless(presetId)) return false;
    return getUsedPresetIds().indexOf(presetId) >= 0;
  }

  /**
   * Count an endless dossier being played, so the world knows how many of her
   * it has already taken (Em's hometown is her incarnation number, see
   * emHometown). Assigns rather than increments in place, because the field is
   * a WorldManager getter/setter pair backed by world.json.
   * @param {number} presetId - Preset ID being played
   */
  function recordEndlessPick(presetId) {
    const preset = getCharacterPresets().find((entry) => entry.id === presetId);
    if (!preset || preset.proceduralHometown !== "em") return;
    // Resolve before bumping: the town this playthrough gets is the one the
    // dossier showed, and the new count only applies to the next Em.
    emHometown();
    $gameSystem._emIncarnations = ($gameSystem._emIncarnations | 0) + 1;
  }

  /**
   * Retire a preset for the whole world (called when one is picked)
   * @param {number} presetId - Preset ID
   */
  function markPresetUsed(presetId) {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return;
    if (!(presetId > 0)) return;
    recordEndlessPick(presetId);
    if (isPresetEndless(presetId) || isPresetUsed(presetId)) return;
    // Assign a new array instead of pushing: the WorldManager-backed field is a
    // getter/setter pair, so only a completed write reaches the world file.
    $gameSystem._usedCharacterPresets = getUsedPresetIds().concat(presetId);
  }

  /**
   * Presets that can still be picked in this world
   * @returns {array} Array of preset objects
   */
  function getAvailableCharacterPresets() {
    const used = getUsedPresetIds();
    return getCharacterPresets().filter(
      (preset) => preset.endless || used.indexOf(preset.id) < 0
    );
  }

  //=============================================================================
  // Dossier skins (alternate looks)
  //=============================================================================
  // A dossier without a `skins` list still has exactly one look, built here out
  // of the fields it already carries, so every consumer can treat presets
  // uniformly instead of branching on whether alternates exist. The first entry
  // is always the dossier's own sprite and bust.

  /**
   * Every look a dossier can be played as.
   * @param {object} preset - Preset dossier
   * @returns {Array<{key: string, sprite: string, spriteIndex: number, busts: string}>}
   */
  function getPresetSkins(preset) {
    if (!preset) return [];
    if (Array.isArray(preset.skins) && preset.skins.length > 0) return preset.skins;
    return [{
      key: "",
      sprite: preset.sprite,
      spriteIndex: preset.spriteIndex || 0,
      busts: preset.busts,
    }];
  }

  /**
   * One look of a dossier, by position. Out-of-range indices wrap back to the
   * dossier's own look rather than returning nothing.
   * @param {object} preset - Preset dossier
   * @param {number} index - Position in the skin list
   * @returns {object|null} Skin record
   */
  function getPresetSkin(preset, index) {
    const skins = getPresetSkins(preset);
    if (skins.length === 0) return null;
    const i = Number(index) || 0;
    return skins[(i % skins.length + skins.length) % skins.length];
  }

  /**
   * What a skin reads as on the dossier page.
   * @param {object} skinData - Skin record from getPresetSkins
   * @returns {string} Localized label
   */
  function getPresetSkinLabel(skinData) {
    if (!skinData || !skinData.key) return "";
    return T("CharPresets.skin." + skinData.key);
  }

  //=============================================================================
  // Preset -> Empathize identity sync
  //=============================================================================
  // Presets carry curated identity data (gender, orientation, birth date/
  // nation) that the character-creation dossier already displays, but that
  // data used to stop there: nothing carried it onto the actor or onto the
  // NPCSociety profile the Empathize menu reads from ($gameSystem._npcSociety,
  // keyed by name). Left alone, opening Empathize on a preset-based party
  // member (window.NPCEmpathize.openForActor) rolled a fresh, unrelated
  // random profile the first time it was viewed, contradicting the dossier
  // (wrong gender/pronouns, wrong birth year/place).
  //
  // ensureProfile() only exists once NPCSociety's DataLoader has finished its
  // async fetches, which is not guaranteed yet during character creation. So
  // rather than depending on the profile existing right now, the desired
  // identity is stashed on $gameSystem._pendingPartyIdentity[name] and
  // NPCSociety.ensureProfile (NPC/NPCSociety.js) applies it the moment the
  // profile is actually generated, whenever that happens to be.

  /**
   * Sync a preset's curated identity onto the actor and (eventually) its
   * Empathize/NPCSociety profile.
   * @param {object} preset - Preset dossier
   * @param {Game_Actor} actor - Actor the preset was just applied to
   */
  function applyPresetIdentity(preset, actor) {
    if (!preset || !actor) return;

    if (preset.gender !== undefined && actor.setGender) {
      actor.setGender(preset.gender);
    }

    const name = actor.name();
    if (!name || typeof $gameSystem === "undefined" || !$gameSystem) return;

    const pending = {};
    if (preset.gender !== undefined) pending.gender = preset.gender;
    if (preset.sexualOrientation) pending.sexualKey = preset.sexualOrientation;
    if (preset.romanticOrientation) pending.romanticKey = preset.romanticOrientation;
    if (preset.birthDate) {
      const year = parseInt(String(preset.birthDate).slice(0, 4), 10);
      if (!isNaN(year)) pending.birthYear = year;
    }
    // A named hometown is the more precise birthplace, so it wins over the
    // nation; it also becomes the party's hometown, the same field the
    // CharacterCreation hometown step writes (NPCSociety reads it for the
    // home-settlement opinion bonus).
    const hometown = getPresetHometown(preset);
    if (hometown) {
      pending.birthplace = hometown;
      $gameSystem._ccHometown = hometown;
    } else if (preset.nationId) {
      pending.birthplace = preset.nationId;
    }
    if (Object.keys(pending).length === 0) return;

    if (!$gameSystem._pendingPartyIdentity) $gameSystem._pendingPartyIdentity = {};
    $gameSystem._pendingPartyIdentity[name] = pending;

    // Opportunistic immediate apply: if NPCSociety is already loaded (e.g. a
    // preset picked mid-playthrough rather than at boot), this creates and
    // seeds the profile right away instead of waiting for the first
    // Empathize view. ensureProfile() consumes and clears the pending entry
    // itself, so this is safe to call even when it's a no-op.
    window.NPCSocietyRegistry?.ensureProfile?.(name, preset.classId);
  }

  //=============================================================================
  // Preset vehicles
  //=============================================================================
  //
  // A dossier can start its owner with a vehicle already parked somewhere (Em's
  // camper). The parked spot lives in window.VehiclePosition, the single source
  // of truth VehicleSystem re-places every Game_Vehicle from on map load, so the
  // vehicle shows up both on the map it is parked on and on the world map at the
  // dossier's world coordinates.

  // Vehicle key -> { Game_Vehicle type, availability switch }.
  const PRESET_VEHICLES = {
    camper: { type: "ship", switchId: 51 },
    car: { type: "boat", switchId: 64 },
    airship: { type: "airship", switchId: 0 }
  };

  /**
   * Park the vehicle a preset dossier ships with, if it has one.
   * @param {object} preset - Preset dossier (reads preset.vehicle)
   */
  function applyPresetVehicle(preset) {
    const spec = preset && preset.vehicle;
    if (!spec) return;

    const key = spec.key || "camper";
    const meta = PRESET_VEHICLES[key];
    if (!meta) {
      console.warn(`CharacterPresets: preset "${preset.name}" wants unknown vehicle "${key}"`);
      return;
    }

    const mapId = Number(spec.mapId) || 0;
    const x = Number(spec.x) || 0;
    const y = Number(spec.y) || 0;
    // World-map coords default to the tile itself when the vehicle is parked on
    // the world map, so a dossier only has to spell them out when it is not.
    const worldX = (spec.worldX !== undefined) ? Number(spec.worldX) : (mapId === 315 ? x : 0);
    const worldY = (spec.worldY !== undefined) ? Number(spec.worldY) : (mapId === 315 ? y : 0);

    if (window.VehiclePosition) {
      window.VehiclePosition.set(key, mapId, x, y, worldX, worldY);
    } else {
      console.warn("CharacterPresets: VehicleSystem not loaded; preset vehicle not parked.");
    }

    // The car and the bike share the engine's single 'boat' vehicle, so the
    // shared slot has to be told which one it currently is.
    if (key === "car") $gameSystem._boatType = "car";

    // Makes the vehicle available to the menus and events that gate on it.
    if (meta.switchId > 0) $gameSwitches.setValue(meta.switchId, true);

    // Place it now as well: the player is transferred straight to the dossier's
    // home map, and reconcileToStore only moves vehicles on map load.
    const vehicle = (typeof $gameMap !== "undefined" && $gameMap) ? $gameMap.vehicle(meta.type) : null;
    if (vehicle) {
      vehicle.setLocation(mapId, x, y);
      vehicle.refresh();
    }
  }

  /**
   * Save character presets to game data
   * @param {array} presets - Array of preset objects
   */
  function saveCharacterPresets(presets) {
    // Persist on $gameSystem (serialized with the save file) rather than
    // $dataSystem (re-seeded from the database on boot, never saved).
    if (typeof $gameSystem !== "undefined" && $gameSystem) {
      $gameSystem._characterPresets = presets;
    }
  }

  /**
   * Get the next available preset ID
   * @returns {number} Next preset ID
   */
  function getNextPresetId() {
    // Base presets only: retired party members own the separate 1000+ band
    // (getNextRetiredPresetId), so the two never hand out the same id.
    const currentPresets = getBasePresets();
    if (currentPresets.length === 0) {
      return 1;
    }
    const maxId = Math.max(...currentPresets.map((preset) => preset.id || 0));
    return maxId + 1;
  }

  /**
   * Remove a preset by ID (called when pregenerated character dies)
   * @param {number} presetId - Preset ID to remove
   * @returns {boolean} Success status
   */
  function removePresetById(presetId) {
    // An endless dossier survives its own death: killing one Em only ends that
    // branch of her, so she stays in the pool (permadeath calls this).
    if (isPresetEndless(presetId)) {
      return false;
    }

    // Retired party members live in the world folder, not in the preset array.
    // Assign a new array: the WorldManager-backed field is a getter/setter pair,
    // so only a completed write reaches world.json.
    const retired = getRetiredPresets();
    const retiredIndex = retired.findIndex((preset) => preset.id === presetId);
    if (retiredIndex >= 0) {
      const removed = retired[retiredIndex];
      $gameSystem._retiredCharacterPresets = retired.filter((_, i) => i !== retiredIndex);
      console.log(`Removed retired character from pool: "${removed.name}" (ID: ${presetId})`);
      return true;
    }

    const currentPresets = getBasePresets();
    const index = currentPresets.findIndex((preset) => preset.id === presetId);

    if (index >= 0) {
      const removedPreset = currentPresets[index];
      currentPresets.splice(index, 1);
      saveCharacterPresets(currentPresets);
      CharacterPresets = currentPresets;
      console.log(`Removed preset from pool: "${removedPreset.name}" (ID: ${presetId})`);
      return true;
    } else {
      console.warn(`Preset with ID ${presetId} not found in pool`);
      return false;
    }
  }

  /**
   * Save current character as preset
   */
  function saveCurrentCharacterAsPreset() {
    const actor = $gameParty.leader();
    if (!actor) {
      window.skipLocalization = true;
      $gameMessage.add(T('CharPresets.noCharacterToSave'));
      window.skipLocalization = false;
      return;
    }

    const currentMapId = $gameMap.mapId();
    const playerX = $gamePlayer.x;
    const playerY = $gamePlayer.y;

    // Get current active switches
    const activeSwitches = [];
    for (let i = 1; i <= $gameSystem.switchesCount; i++) {
      if ($gameSwitches.value(i)) {
        activeSwitches.push(i);
      }
    }

    // Save inventory, money, equips, and skills
    const money = $gameParty.gold();
    const items = $gameParty
      .items()
      .map((item) => ({ id: item.id, amount: $gameParty.numItems(item) }));
    const weapons = $gameParty
      .weapons()
      .map((item) => ({ id: item.id, amount: $gameParty.numItems(item) }));
    const armors = $gameParty
      .armors()
      .map((item) => ({ id: item.id, amount: $gameParty.numItems(item) }));
    const equips = actor.equips().map((item) => (item ? item.id : null));
    const skills = actor.skills().map((skill) => skill.id);

    // Get traits from actor if available
    const traits = (actor._selectedTraits || []).map((trait) => trait.id || 0).filter((id) => id > 0);

    // Get current presets
    const currentPresets = getBasePresets();

    // Check if a preset with this name already exists
    const existingIndex = currentPresets.findIndex(
      (preset) => preset.name === actor.name()
    );

    // Generate or reuse preset ID
    let presetId;
    if (existingIndex >= 0) {
      presetId = currentPresets[existingIndex].id;
    } else {
      presetId = getNextPresetId();
    }

    const newPreset = {
      id: presetId,
      name: actor.name(),
      classId: actor._classId,
      sprite: actor._characterName,
      spriteIndex: actor._characterIndex,
      mapId: currentMapId,
      x: playerX,
      y: playerY,
      switches: activeSwitches.slice(0, 10),
      money: money,
      items: items,
      weapons: weapons,
      armors: armors,
      equips: equips,
      skills: skills,
      traits: traits,
      isCreature: $gameSwitches.value(77),
      gender: actor.gender ? actor.gender() : 0,
    };

    if (existingIndex >= 0) {
      currentPresets[existingIndex] = newPreset;
      window.skipLocalization = true;
      $gameMessage.add(T('CharPresets.presetUpdated', { name: newPreset.name }));
      window.skipLocalization = false;
    } else {
      currentPresets.push(newPreset);
      window.skipLocalization = true;
      $gameMessage.add(T('CharPresets.presetSaved', { name: newPreset.name, id: presetId }));
      window.skipLocalization = false;
    }

    saveCharacterPresets(currentPresets);
    CharacterPresets = currentPresets;
  }

  /**
   * Send a companion away: retire them into a world dossier and drop them from
   * the party. The event-facing wrapper around retirePartyMember, kept for the
   * "SendAwayPartyMember" common events (108 / 109).
   * @param {number} memberPosition - 1-based party slot (2 = second member)
   */
  function savePartyMemberAsPreset(memberPosition = 2) {
    const partyMembers = $gameParty.members();
    const position = parseInt(memberPosition) || 2;
    const targetActor = partyMembers[position - 1];

    window.skipLocalization = true;
    if (!targetActor) {
      $gameMessage.add(T('CharPresets.noMemberAtPosition', { position: position }));
      window.skipLocalization = false;
      return;
    }

    const result = retirePartyMember(targetActor.actorId());
    if (!result.ok) {
      if (result.reason === "lastMember") {
        $gameMessage.add(T('CharPresets.partyCannotBeEmpty'));
      } else if (result.reason === "isLeader") {
        $gameMessage.add(T('CharPresets.leaderCannotLeave', { name: targetActor.name() }));
      } else {
        $gameMessage.add(T('CharPresets.cannotLeaveNow', { name: targetActor.name() }));
      }
      window.skipLocalization = false;
      return;
    }

    $gameMessage.add(T('CharPresets.memberRetired', { name: targetActor.name() }));
    window.skipLocalization = false;
  }

  //=============================================================================
  // Retiring a party member ("set inactive")
  //=============================================================================
  // The Dynamics menu can bench a companion instead of dismissing them for
  // good. A retired member is snapshotted into a dossier stored in the world
  // folder ($gameSystem._retiredCharacterPresets -> world.json
  // "retiredCharacters", see WorldManager.js), so every later playthrough of
  // the same world can pick them up in character creation as a pre-made
  // character. Like every dossier they are then spent for the whole world.

  // Maps a retired member is not allowed to call home: the world map and the
  // procedural sandbox have no persistent geometry to walk back into, so a new
  // character starting there would spawn in a regenerated nowhere. Falls back
  // to the station most hand-authored dossiers already start from.
  const UNHOMEABLE_MAP_IDS = [315, 636];
  const FALLBACK_HOME = { mapId: 708, x: 24, y: 12 };

  /**
   * Next id for a retired dossier. Kept in its own 1000+ band so it can never
   * collide with a hand-authored preset id (or with getNextPresetId's output).
   * Spent ids count as taken: a dossier that has been played, or that has walked
   * back into a party, leaves the retired list but its id must never be handed
   * out again, or the world's spent list would hide whoever inherits it.
   * @returns {number} Next retired preset ID
   */
  function getNextRetiredPresetId() {
    const ids = getRetiredPresets().map((preset) => preset.id || 0);
    const spent = getUsedPresetIds().filter((id) => id >= 1000);
    return Math.max(1000, ...ids, ...spent, 0) + 1;
  }

  /**
   * Build the dossier for a member being benched.
   * @param {Game_Actor} actor - Member leaving the active party
   * @returns {object} Preset object
   */
  // Switches 77/78/79 flag Actor 1/2/3 as portrayed by a battler image.
  function isCreatureSlot(actor) {
    const slot = actor && actor.actorId ? actor.actorId() : 0;
    return !!($gameSwitches && slot >= 1 && slot <= 3 && $gameSwitches.value(76 + slot));
  }

  function buildRetiredPreset(actor) {
    const minute = $gameVariables ? ($gameVariables.value(114) || 0) : 0;
    // Same calendar the roster history prints (NPCSystemParty.js).
    const dateStr = window.PartyRoster && window.PartyRoster.dateOf
      ? window.PartyRoster.dateOf(minute)
      : "";

    const home = UNHOMEABLE_MAP_IDS.includes($gameMap.mapId())
      ? FALLBACK_HOME
      : { mapId: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y };

    // Gear worn on the way out travels with them. _applyPreset equips out of
    // the party's stock, so every worn piece is listed both as inventory and as
    // an equip slot; nothing is taken off the party that it still holds.
    const equips = actor.equips().map((item) => (item ? item.id : null));
    const weapons = [];
    const armors = [];
    actor.equips().forEach((item, slotId) => {
      if (!item) return;
      const isWeapon = actor.equipSlots()[slotId] === 1;
      (isWeapon ? weapons : armors).push({ id: item.id, amount: 1 });
    });

    const specializations = Object.keys(actor._specLevels || {}).map((id) => ({
      id: Number(id),
      level: actor._specLevels[id],
    }));

    const className = actor.currentClass() ? actor.currentClass().name : "";
    const leaderName = $gameParty.leader() ? $gameParty.leader().name() : "";
    // Written once, in the language the retirement happened in: this dossier
    // is generated data, not a shipped string, so it has no key of its own.
    const lore = T(dateStr ? 'CharPresets.retiredLoreDated' : 'CharPresets.retiredLore', {
      leader: leaderName || T('CharPresets.theParty'),
      role: className || T('CharPresets.companion'),
      date: dateStr,
      level: actor.level,
    });

    return {
      id: getNextRetiredPresetId(),
      name: actor.name(),
      classId: actor._classId,
      sprite: actor.characterName(),
      spriteIndex: actor.characterIndex(),
      mapId: home.mapId,
      x: home.x,
      y: home.y,
      // Deliberately empty: a dossier must not switch on live story flags.
      switches: [],
      level: actor.level,
      money: 0,
      items: [],
      weapons,
      armors,
      equips,
      skills: actor.skills().map((skill) => skill.id),
      traits: (actor._selectedTraits || []).map((trait) => trait.id || 0).filter((id) => id > 0),
      specializations,
      busts: actor.vnBust ? actor.vnBust() : "",
      // A creature or a recruited monster is portrayed by a battler image, not
      // by a bust, so the dossier carries the image and the enemy it came from
      // (the status screen builds that enemy's 3D model from the id).
      battler: actor.vnBattler ? actor.vnBattler() : "",
      enemyId: actor._recruitedEnemyId || 0,
      isCreature: isCreatureSlot(actor),
      gender: actor.gender ? actor.gender() : 0,
      retired: true,
      retiredAtMin: minute,
      retiredDate: dateStr,
      retiredClassName: className,
      lore,
    };
  }

  /**
   * Bench a party member: snapshot them as a world dossier and remove them from
   * the active party. The leader never leaves, so the party can never end up
   * empty and never ends up leaderless: hand the party over first (Dynamics ->
   * Roster -> Make Leader), then retire the old leader.
   * @param {number} actorId - Actor to retire
   * @returns {object} { ok: boolean, reason?: string, preset?: object }
   */
  function retirePartyMember(actorId) {
    if (!$gameParty || !$gameActors) return { ok: false, reason: "noParty" };
    const actor = $gameParty.members().find((mem) => mem.actorId() === actorId);
    if (!actor) return { ok: false, reason: "notInParty" };
    if ($gameParty.members().length <= 1) return { ok: false, reason: "lastMember" };
    if ($gameParty.members()[0].actorId() === actorId) return { ok: false, reason: "isLeader" };

    const preset = buildRetiredPreset(actor);
    // Assign a new array, the WorldManager-backed field is a getter/setter pair.
    $gameSystem._retiredCharacterPresets = getRetiredPresets()
      .filter((entry) => entry.name !== preset.name)
      .concat(preset);

    // Tells the roster-history hook (NPCSystemParty.js) this departure was a
    // retirement rather than a dismissal or a death.
    if ($gameTemp) $gameTemp._partyRetiringActorId = actorId;
    $gameParty.removeActor(actorId);
    if ($gameTemp) $gameTemp._partyRetiringActorId = null;

    return { ok: true, preset };
  }

  //=============================================================================
  // Calling a retired member back ("set active")
  //=============================================================================
  // The bench belongs to the world, not to the savegame that filled it: every
  // playthrough of this world sees the same inactive dossiers in Dynamics ->
  // Roster and can call any of them back into an open party slot. Doing so
  // takes them off the world's books for good, so no other savegame can pick
  // them up in character creation or call them back a second time.

  // Actor 1 is the player, so a companion slot is Actor 2 or Actor 3: three
  // travellers at most, the same ceiling character creation builds a party to.
  const MAX_ACTIVE_PARTY = 3;

  /**
   * First free companion slot, or 0 when the party is full. Mirrors an NPC
   * recruit (NPCSystemParty.js): Actor 2, then Actor 3, except in multiplayer
   * (Switch 67) where Actor 3 is reserved for the remote guest.
   * @returns {number} Actor id, or 0
   */
  function freeCompanionActorId() {
    if (!$gameParty) return 0;
    const taken = $gameParty._actors || [];
    if ($gameSwitches && $gameSwitches.value(67)) {
      return taken.includes(3) ? 0 : 3;
    }
    if (!taken.includes(2)) return 2;
    if (!taken.includes(3)) return 3;
    return 0;
  }

  /**
   * Inactive dossiers this world can still call back. One already played in
   * character creation is spent, so it stays out of the roster's bench too.
   * @returns {array} Array of preset objects
   */
  function getAvailableRetiredPresets() {
    const used = getUsedPresetIds();
    return getRetiredPresets().filter((preset) => used.indexOf(preset.id) < 0);
  }

  /**
   * Write a retired dossier back onto a companion actor slot. The slot may hold
   * whoever last used it (an old recruit, or this same member before they were
   * benched), so every field is overwritten rather than merged.
   * @param {object} preset - Retired dossier
   * @param {Game_Actor} actor - Actor slot receiving them
   */
  function applyRetiredPreset(preset, actor) {
    actor.setName(preset.name);
    if (preset.sprite) {
      actor.setCharacterImage(preset.sprite, preset.spriteIndex || 0);
    }
    if ($dataClasses[preset.classId]) {
      actor.changeClass(preset.classId, false);
    }
    // After the class change, so the exp curve is the one they come back on.
    actor.changeLevel(Math.max(1, Math.min(99, preset.level || 1)), false);

    // initSkills drops the previous occupant's list and relearns the class
    // skills up to this level; the dossier's own skills go on top.
    actor.initSkills();
    (preset.skills || []).forEach((skillId) => {
      if ($dataSkills[skillId]) actor.learnSkill(skillId);
    });

    // The gear on the way out comes back with them. Strip the slot first with
    // forceChangeEquip (which does not pay the old occupant's equipment into
    // the party's stock), then hand the party one copy of each dossier piece
    // and equip it, so nothing is duplicated and nothing is conjured twice.
    actor.equips().forEach((item, slotId) => {
      if (item) actor.forceChangeEquip(slotId, null);
    });
    (preset.equips || []).forEach((itemId, slotId) => {
      if (!(itemId > 0)) return;
      const etypeId = actor.equipSlots()[slotId];
      const item = etypeId === 1 ? $dataWeapons[itemId] : $dataArmors[itemId];
      if (!item) return;
      $gameParty.gainItem(item, 1);
      actor.changeEquip(slotId, item);
    });

    if (Array.isArray(preset.traits) && preset.traits.length &&
        window.CharacterCreationUtils && window.CharacterCreationUtils.applyTraitsToActor) {
      window.CharacterCreationUtils.applyTraitsToActor(actor, preset.traits);
    }

    actor._specLevels = {};
    if (Array.isArray(preset.specializations) && actor.setSpecializationTrainedLevel) {
      preset.specializations.forEach((entry) => {
        if (entry && entry.id) actor.setSpecializationTrainedLevel(entry.id, entry.level);
      });
    }

    // Switches 77/78/79 say whether Actor 1/2/3 is a creature; the slot may
    // still be flagged from whoever held it before, and a retired companion is
    // recorded as one or not in their own dossier.
    const slot = actor.actorId();
    if ($gameSwitches && slot >= 1 && slot <= 3) {
      $gameSwitches.setValue(76 + slot, !!preset.isCreature);
    }

    if (actor.setGender && preset.gender !== undefined) actor.setGender(preset.gender);
    // Whoever held the slot before is gone, including the monster it may have
    // been recruited from.
    actor._recruitedEnemyId = 0;
    if (preset.busts && actor.setVnBust) {
      actor.setVnBust(preset.busts);
      if (actor.setPortraitMode) actor.setPortraitMode("bust");
    } else if (preset.battler && actor.setVnBattler) {
      // Portrayed by a battler image (a creature, or a monster recruited in
      // battle). Leaving the portrait mode unset lets the status screen build
      // the 3D model of the recorded enemy when one resolves, and fall back to
      // the flat battler image when it does not.
      if (actor.setVnBust) actor.setVnBust("");
      actor.setVnBattler(preset.battler);
      if (actor.setPortraitMode) actor.setPortraitMode(0);
      actor._recruitedEnemyId = preset.enemyId || 0;
    }

    // Anatomy skills need no call here: Health_Core grants them on addActor.
    actor.refresh();
    // They have been resting since the day they were benched.
    actor.recoverAll();
  }

  /**
   * Call an inactive member back into the party.
   * @param {number} presetId - Retired dossier id
   * @returns {object} { ok: boolean, reason?: string, actorId?: number, preset?: object }
   */
  function unretirePartyMember(presetId) {
    if (!$gameParty || !$gameActors) return { ok: false, reason: "noParty" };

    const preset = getAvailableRetiredPresets().find((entry) => entry.id === presetId);
    if (!preset) return { ok: false, reason: "notRetired" };
    if ($gameParty.members().some((mem) => mem.name() === preset.name)) {
      return { ok: false, reason: "alreadyHere" };
    }
    if ($gameParty.members().length >= MAX_ACTIVE_PARTY) {
      return { ok: false, reason: "partyFull" };
    }

    const actorId = freeCompanionActorId();
    if (!actorId) return { ok: false, reason: "partyFull" };
    const actor = $gameActors.actor(actorId);
    if (!actor) return { ok: false, reason: "partyFull" };

    applyRetiredPreset(preset, actor);
    $gameParty.addActor(actorId);
    if ($gameVariables) $gameVariables.setValue(29, $gameParty.members().length);

    // Off the bench for good. Both writes assign a new array: the fields are
    // WorldManager getter/setter pairs backed by world.json, so only a
    // completed write reaches the world folder every savegame reads.
    $gameSystem._retiredCharacterPresets = getRetiredPresets()
      .filter((entry) => entry.id !== presetId);
    // Recorded as spent rather than simply dropped, so the id is never dealt
    // to a later retirement (getNextRetiredPresetId).
    $gameSystem._usedCharacterPresets = getUsedPresetIds().concat(presetId);

    return { ok: true, actorId, preset };
  }

  //=============================================================================
  // Character Creation Tracking Functions
  //=============================================================================

  /**
   * Mark a character creation step as completed
   * @param {number} stepIndex - Step index
   */
  function markStepCompleted(stepIndex) {
    // Completion state lives on $gameSystem so it is per-save and does not
    // leak between save files loaded in the same session.
    if (!$gameSystem) return;
    if (!$gameSystem._characterCreationCompleted) {
      $gameSystem._characterCreationCompleted = {};
    }
    $gameSystem._characterCreationCompleted[stepIndex] = true;
  }

  /**
   * Check if a character creation step is completed
   * @param {number} stepIndex - Step index
   * @returns {boolean} Completion status
   */
  function isStepCompleted(stepIndex) {
    if (!$gameSystem || !$gameSystem._characterCreationCompleted) {
      return false;
    }
    return $gameSystem._characterCreationCompleted[stepIndex] || false;
  }

  /**
   * Check if first character creation is completed
   * @returns {boolean} Completion status
   */
  function hasCompletedFirstCreation() {
    return !!($gameSystem && $gameSystem._hasCompletedFirstCreation);
  }

  /**
   * Mark first character creation as complete
   */
  function markFirstCreationComplete() {
    if ($gameSystem && !$gameSystem._hasCompletedFirstCreation) {
      $gameSystem._hasCompletedFirstCreation = true;
    }
  }

  //=============================================================================
  // DataManager Hooks
  //=============================================================================

  const _DataManager_onLoad = DataManager.onLoad;
  DataManager.onLoad = function (object) {
    _DataManager_onLoad.call(this, object);
    if (object === $dataSystem) {
      if (!$dataSystem.classLevels) {
        $dataSystem.classLevels = {};
      }
      if (!$dataSystem.characterPresets) {
        $dataSystem.characterPresets = [...CharacterPresets];
      } else {
        CharacterPresets = $dataSystem.characterPresets;
      }
      // Creation-completion state is per-save and lives on $gameSystem, not
      // $dataSystem (which is shared across save files in one session).
    }
  };

  //=============================================================================
  // Dossier switches
  //=============================================================================
  // A dossier's switches (Em's 48, Bubba's 49, Selene's 58, the shared 50) say
  // that THIS playthrough is that character's, and the whole social layer reads
  // them. They belong to the savegame that picked the dossier and to no other:
  // they are per-savegame switches (WorldManager's privateSwitches list), they
  // start off in every new game, and only applying a preset turns one on. The
  // playthrough that applied one is recorded in $gameSystem._currentPresetId.

  /**
   * Every switch id any dossier (hand-authored or retired) turns on
   * @returns {number[]} Switch ids
   */
  function getPresetSwitchIds() {
    const ids = new Set();
    for (const preset of getCharacterPresets()) {
      for (const id of preset.switches || []) {
        if (id > 0) ids.add(id);
      }
    }
    return Array.from(ids);
  }

  /**
   * Re-apply the dossier switches of the preset this savegame was started with.
   * Only used to migrate savegames written while those switches still lived in
   * the world's shared state, which no longer hands them out.
   */
  function restoreDossierSwitches() {
    if (typeof $gameSystem === "undefined" || !$gameSystem || !$gameSwitches) return;
    const presetId = $gameSystem._currentPresetId;
    if (!(presetId > 0)) return;
    const preset = getCharacterPresets().find((p) => p.id === presetId);
    if (!preset || !Array.isArray(preset.switches)) return;
    // Only while that character is still travelling with the party: dying
    // clears their switch (NPCSystemParty.js) and it has to stay cleared.
    if (!$gameParty || !$gameParty.members().some((a) => a.name() === preset.name)) return;
    preset.switches.forEach((id) => {
      if (id > 0) $gameSwitches.setValue(id, true);
    });
  }

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    // Saves written before the dossier switches became per-savegame kept them
    // only in the world folder, so they arrive here unset. Anything newer
    // carries them in its own binary and is left alone.
    if (window.WorldManager && window.WorldManager.activeWorldName &&
        !contents.privateSwitchSchema) {
      restoreDossierSwitches();
    }
  };

  const _DataManager_setupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function () {
    _DataManager_setupNewGame.call(this);
    // Reset character creation completion flags for new game.
    // These run AFTER WorldManager.applyPublicState() so they override any
    // world-state switch values that WorldManager restored (e.g. Switch 33
    // "character creation complete" being stuck from a previous playthrough).
    if ($gameSystem) {
      $gameSystem._characterCreationCompleted = {};
      $gameSystem._hasCompletedFirstCreation = false;
      $gameSystem._currentPresetId = 0;
    }
    $gameSwitches.setValue(10, false);  // class selected
    $gameSwitches.setValue(13, false);  // character created
    $gameSwitches.setValue(33, false);  // character creation sequence complete
    // No new playthrough is Em's, Bubba's or Selene's until its own creation
    // picks that dossier, whatever an older savegame of this world played.
    getPresetSwitchIds().forEach((id) => $gameSwitches.setValue(id, false));
  };

  //=============================================================================
  // Window_CharacterPresets - Preset Selection UI
  //=============================================================================

  class Window_CharacterPresets extends Window_Selectable {
    initialize(rect) {
      // Only presets still free in this world; a played one never comes back.
      this._data = getAvailableCharacterPresets();
      // Which look each dossier is currently being shown in, kept per preset id
      // so moving the cursor away and back keeps the skin the player chose.
      // Set before super, which draws, and drawing reads it.
      this._skinIndexById = {};
      this._skinHandler = null;
      super.initialize(rect);

      // Preload all character sprites, alternate looks included: the DOM
      // dossier sizes a big-character frame from the loaded bitmap, so a skin
      // nobody has loaded yet would render at the wrong aspect ratio.
      this._loadedBitmaps = [];
      this._data.forEach((preset, index) => {
        getPresetSkins(preset).forEach((skinData, skinIdx) => {
          const bitmap = ImageManager.loadCharacter(skinData.sprite);
          if (skinIdx === 0) this._loadedBitmaps[index] = bitmap;
          bitmap.addLoadListener(() => {
            this.refresh();
          });
        });
      });

      this.refresh();
      this.select(0);
      this.activate();
    }

    maxItems() {
      return this._data ? this._data.length : 0;
    }

    maxCols() {
      if (!this._data || this._data.length === 0) return 1;
      return Math.min(this._data.length, 3); // Max 3 columns
    }

    itemHeight() {
      return 120; // Fixed height for character display
    }

    itemAt(index) {
      return this._data && this._data[index] ? this._data[index] : null;
    }

    //-------------------------------------------------------------------------
    // Skins: alternate looks for the dossier under the cursor
    //-------------------------------------------------------------------------

    /**
     * Which look a dossier is currently being shown in.
     * @param {number} [presetIndex] - Board position; defaults to the cursor
     * @returns {number} Position in that dossier's skin list
     */
    skinIndex(presetIndex) {
      const preset = this.itemAt(presetIndex === undefined ? this.index() : presetIndex);
      if (!preset) return 0;
      const stored = (this._skinIndexById || {})[preset.id] || 0;
      const count = getPresetSkins(preset).length;
      return count > 0 ? Math.min(stored, count - 1) : 0;
    }

    /**
     * The look the highlighted dossier would be played as right now.
     * @returns {object|null} Skin record
     */
    currentSkin() {
      return getPresetSkin(this.currentPreset(), this.skinIndex());
    }

    /**
     * Show the highlighted dossier in one of its other looks.
     * @param {number} skinIdx - Position in the skin list
     */
    selectSkin(skinIdx) {
      const preset = this.currentPreset();
      if (!preset) return;
      const skins = getPresetSkins(preset);
      if (skins.length < 2) return;
      const next = (Number(skinIdx) % skins.length + skins.length) % skins.length;
      if (next === this.skinIndex()) return;
      this._skinIndexById[preset.id] = next;
      SoundManager.playCursor();
      this.refresh();
      if (this._skinHandler) this._skinHandler();
    }

    /**
     * Step through the highlighted dossier's looks.
     * @param {number} dir - +1 forward, -1 back
     */
    cycleSkin(dir) {
      this.selectSkin(this.skinIndex() + (dir > 0 ? 1 : -1));
    }

    /**
     * Called whenever the shown look changes, so the scene can redraw the
     * parchment dossier the player is actually reading.
     * @param {Function} handler - Callback
     */
    setSkinHandler(handler) {
      this._skinHandler = handler;
    }

    drawItem(index) {
      const preset = this.itemAt(index);
      if (!preset) return;

      const skinData = getPresetSkin(preset, this.skinIndex(index));
      const rect = this.itemRect(index);
      const padding = 8;

      // Draw background
      this.contents.fillRect(
        rect.x + 2,
        rect.y + 2,
        rect.width - 4,
        rect.height - 4,
        "rgba(0, 0, 0, 0.3)"
      );

      // Draw character sprite
      const spriteY = rect.y + padding;
      const spriteHeight = 48;
      this.drawCharacterSprite(
        skinData ? skinData.sprite : preset.sprite,
        skinData ? skinData.spriteIndex : preset.spriteIndex,
        rect.x + rect.width / 2 - 24,
        spriteY
      );

      // Draw character name
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(
        preset.name,
        rect.x,
        spriteY + spriteHeight + 4,
        rect.width,
        "center"
      );

      // Draw class name
      this.resetTextColor();
      const className = $dataClasses[preset.classId]
        ? $dataClasses[preset.classId].name
        : T('CharPresets.unknownClass');
      this.drawText(
        className,
        rect.x,
        spriteY + spriteHeight + this.lineHeight() + 4,
        rect.width,
        "center"
      );
    }

    drawCharacterSprite(spriteName, spriteIndex, x, y) {
      const bitmap = ImageManager.loadCharacter(spriteName);
      if (bitmap.isReady()) {
        const characterWidth = bitmap.width / 12; // 12 characters per sheet
        const characterHeight = bitmap.height / 8; // 8 directions

        const col = spriteIndex % 4;
        const row = Math.floor(spriteIndex / 4);

        const sx = col * characterWidth * 3; // Each character has 3 frames
        const sy = row * characterHeight * 4; // Each character has 4 directions

        // Draw the down-facing sprite (direction 0, frame 1 - middle frame)
        const frameWidth = characterWidth;
        const frameHeight = characterHeight;
        const frameX = sx + frameWidth; // Middle frame
        const frameY = sy; // Down direction

        this.contents.blt(
          bitmap,
          frameX,
          frameY,
          frameWidth,
          frameHeight,
          x,
          y,
          48,
          48
        );
      }
    }

    processOk() {
      const preset = this.itemAt(this.index());
      if (preset) {
        this.playOkSound();
        this.callOkHandler();
      }
    }

    currentPreset() {
      return this.itemAt(this.index());
    }
  }

  //=============================================================================
  // Window_StatsExplanation - Stats Help Window
  //=============================================================================

  class Window_StatsExplanation extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this._handlers = {};
      this.refresh();
      this.activate();
    }

    setHandler(symbol, method) {
      this._handlers[symbol] = method;
    }

    isHandled(symbol) {
      return !!this._handlers[symbol];
    }

    callHandler(symbol) {
      if (this.isHandled(symbol)) {
        this._handlers[symbol]();
      }
    }

    close() {
      this.openness = 0;
    }

    refresh() {
      this.contents.clear();
      let y = 0;
      const lineHeight = this.lineHeight();

      // Title
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(T('CharPresets.statsExplanation'), 0, y, this.contentsWidth(), "center");
      y += lineHeight * 1.5;
      this.resetTextColor();

      // One row per attribute, in the order the character sheet shows them.
      for (const stat of ["str", "con", "dex", "int", "wis", "psi"]) {
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(T('CharPresets.stat.' + stat + '.label'), 0, y, this.contentsWidth());
        y += lineHeight;
        this.resetTextColor();
        this.drawTextEx(T('CharPresets.stat.' + stat + '.desc'), this.itemPadding(), y);
        y += lineHeight * 1.5;
      }
    }

    update() {
      super.update();
      if (
        this.active &&
        (Input.isTriggered("cancel") || TouchInput.isCancelled())
      ) {
        if (this.isHandled("cancel")) {
          this.callHandler("cancel");
        }
      }
    }
  }

  //=============================================================================
  // Plugin Commands
  //=============================================================================

  PluginManager.registerCommand(pluginName, "saveCharacterPreset", () => {
    saveCurrentCharacterAsPreset();
  });

  const savePartyMemberCommand = (args) => {
    const memberIndex = args.memberIndex ? parseInt(args.memberIndex) : 1;
    savePartyMemberAsPreset(memberIndex);
  };
  PluginManager.registerCommand(pluginName, "savePartyMember", savePartyMemberCommand);
  // Legacy keys: older events invoke this command through ClassSelector or the file name.
  PluginManager.registerCommand("ClassSelector", "savePartyMember", savePartyMemberCommand);
  PluginManager.registerCommand("CharacterCreationPresets", "savePartyMember", savePartyMemberCommand);

  //=============================================================================
  // Exports to Global Namespace
  //=============================================================================

  window.CharacterPresets = {
    // Functions
    getCharacterPresets,
    getBasePresets,
    getRetiredPresets,
    getAvailableRetiredPresets,
    getAvailableCharacterPresets,
    retirePartyMember,
    unretirePartyMember,
    getUsedPresetIds,
    isPresetUsed,
    isPresetEndless,
    markPresetUsed,
    getPresetSwitchIds,
    getPresetLore,
    getPresetHometown,
    getPresetSkins,
    getPresetSkin,
    getPresetSkinLabel,
    getEmBackstory,
    isEmPlaythrough,
    isBeastCrew,
    emLabel,
    camperName,
    saveCharacterPresets,
    getNextPresetId,
    removePresetById,
    applyPresetIdentity,
    applyPresetVehicle,
    saveCurrentCharacterAsPreset,
    savePartyMemberAsPreset,
    markStepCompleted,
    isStepCompleted,
    hasCompletedFirstCreation,
    markFirstCreationComplete,

    // Windows
    Window_CharacterPresets,
    Window_StatsExplanation
  };

  // Backward compatibility
  window.removePresetById = removePresetById;
  window.getNextPresetId = getNextPresetId;

  console.log(`${pluginName} loaded successfully.`);
})();
