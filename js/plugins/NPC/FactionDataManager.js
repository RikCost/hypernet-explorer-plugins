/*:
 * @plugindesc Faction Reputation System for RPG Maker RZ
 * @author Omni-Lex
 *
 * @param showInMenu
 * @text Show in Menu
 * @type boolean
 * @default true
 * @desc Whether to add the Faction Status option to the main menu.
 *
 * @param menuText
 * @text Menu Command Text
 * @type string
 * @default Factions
 * @desc The text shown for the Faction Status command in the menu.
 *
 * @param startingValues
 * @text Starting Reputation Values
 * @type string
 * @default 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
 * @desc Comma-separated starting values for factions.
 *
 * @command open
 * @text Open Faction Screen
 * @desc Opens the faction reputation screen.
 *
 * @command setReputation
 * @text Set Reputation
 * @desc Sets a faction's reputation to a specific value.
 * @arg factionId
 * @type number
 * @min 0
 * @max 17
 * @desc The ID of the faction (0-17).
 * @arg value
 * @type number
 * @min -100
 * @max 100
 * @desc The reputation value (-100 to 100).
 *
 * @command changeReputation
 * @text Change Reputation
 * @desc Changes a faction's reputation by the specified amount.
 * @arg factionId
 * @type number
 * @min 0
 * @max 17
 * @desc The ID of the faction (0-17).
 * @arg change
 * @type number
 * @min -100
 * @max 100
 * @desc The amount to change reputation by (-100 to 100).
 *
 * @command getFactionsByType
 * @text Get Factions by Type
 * @desc Gets all factions of a specific type and stores their count and IDs in variables.
 * @arg typeName
 * @type select
 * @option hardcoded
 * @desc The type of factions to get.
 * @arg variableId
 * @type variable
 * @desc The variable ID to store the count in. Subsequent variables will store faction IDs.
 *
 * @command getHighestReputationFaction
 * @text Get Highest Reputation Faction
 * @desc Gets the faction ID with the highest reputation.
 * @arg variableId
 * @type variable
 * @desc The variable ID to store the faction ID in.
 *
 * @command getLowestReputationFaction
 * @text Get Lowest Reputation Faction
 * @desc Gets the faction ID with the lowest reputation.
 * @arg variableId
 * @type variable
 * @desc The variable ID to store the faction ID in.
 *
 * @command checkQuestAvailability
 * @text Check Quest Availability
 * @desc Checks if a quest is available based on faction reputation.
 * @arg questId
 * @type number
 * @desc The ID of the quest.
 * @arg factionId
 * @type number
 * @min 0
 * @max 17
 * @desc The ID of the faction (0-17).
 * @arg requiredRep
 * @type number
 * @min -100
 * @max 100
 * @desc The required reputation (-100 to 100).
 * @arg switchId
 * @type switch
 * @desc The switch ID to store the result in (ON if available).
 *
 * @command getAvailableQuestCount
 * @text Get Available Quest Count
 * @desc Gets the number of available quests for a faction.
 * @arg factionId
 * @type number
 * @min 0
 * @max 17
 * @desc The ID of the faction (0-17).
 * @arg variableId
 * @type variable
 * @desc The variable ID to store the count in.
 *
 * @help
 * This plugin implements a faction reputation system with 3 hardcoded factions
 * and 7 procedurally generated factions. Reputation ranges from -100 to +100.
 *
 * Plugin Commands:
 *
 * FactionReputationSystem open
 *   - Opens the faction reputation screen
 *
 * FactionReputationSystem setReputation factionId value
 *   - Sets a faction's reputation to a specific value
 *   - Example: FactionReputationSystem setReputation 0 50
 *
 * FactionReputationSystem changeReputation factionId change
 *   - Changes a faction's reputation by the specified amount
 *   - Example: FactionReputationSystem changeReputation 0 10
 *
 * Script Calls:
 *   $gameFactions.getReputation(factionId) - Get reputation value
 *   $gameFactions.setReputation(factionId, value) - Set reputation
 *   $gameFactions.getReputationLevel(factionId) - Get level text
 *   SceneManager.push(Scene_FactionStatus) - Open faction screen
 */

//=============================================================================
// Plugin Parameters and Setup
//=============================================================================

let $gameFactions = null;

var Imported = Imported || {};
Imported.FactionReputationSystem = true;

var FRS = FRS || {};
FRS.Params = PluginManager.parameters("FactionDataManager");

FRS.Params.showInMenu =
  String(FRS.Params.showInMenu || "true").toLowerCase() === "true";
FRS.Params.menuText = () => T.param(FRS.Params.menuText, "Factions.menuCommand");
FRS.Params.startingValues = String(
  FRS.Params.startingValues || "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"
)
  .split(",")
  .map(Number);

//=============================================================================
// Faction Data Manager
//=============================================================================

function FactionDataManager() {
  this.initialize(...arguments);
}

FactionDataManager.prototype.initialize = function () {
  this._factions = [];
  this._i18nData = null;
  this._leadersData = {};
  this._ready = false;
  this._readyPromise = Promise.all([
    this._loadI18nData(),
    this._loadCountriesData(),
    this._loadGeopoliticsData(),
    this._loadFactionsData(),
    this._loadIdeologyI18nData(),
    this._loadPersonalitiesI18nData(),
    this._loadRolesI18nData(),
    this._loadFormationsI18nData(),
    this._loadLeadersData()
  ]).then(() => {
    this._resolveLeaders();
    this._ready = true;
  });
  this._setupGeopoliticalData();
};

FactionDataManager.prototype._loadI18nData = async function () {
  const lang = ConfigManager.language || "en";
  try {
    const response = await fetch(`js/i18n/${lang}/faction.json`);
    this._i18nData = await response.json();
  } catch (e) {
    console.error("Failed to load faction i18n data", e);
  }
};

FactionDataManager.prototype._loadIdeologyI18nData = async function () {
  const lang = ConfigManager.language || "en";
  try {
    const response = await fetch(`js/i18n/${lang}/ideology.json`);
    const data = await response.json();
    this._i18nData = { ...this._i18nData, ...data };
  } catch (e) {
    console.error("Failed to load ideology i18n data", e);
  }
};

FactionDataManager.prototype._loadPersonalitiesI18nData = async function () {
  const lang = ConfigManager.language || "en";
  try {
    const response = await fetch(`js/i18n/${lang}/personalities.json`);
    const data = await response.json();
    this._i18nData = { ...this._i18nData, personalities: data };
  } catch (e) {
    console.error("Failed to load personalities i18n data", e);
  }
};

FactionDataManager.prototype._loadRolesI18nData = async function () {
  const lang = ConfigManager.language || "en";
  try {
    const response = await fetch(`js/i18n/${lang}/roles.json`);
    const data = await response.json();
    this._i18nData = { ...this._i18nData, roles: data };
  } catch (e) {
    console.error("Failed to load roles i18n data", e);
  }
};

FactionDataManager.prototype._loadFormationsI18nData = async function () {
  const lang = ConfigManager.language || "en";
  try {
    const response = await fetch(`js/i18n/${lang}/formations.json`);
    const data = await response.json();
    this._i18nData = { ...this._i18nData, formations: data };
  } catch (e) {
    console.error("Failed to load formations i18n data", e);
  }
};

FactionDataManager.prototype._loadLeadersData = async function () {
  try {
    const response = await fetch(`js/db/WorldGen/Leaders.json`);
    this._leadersData = await response.json();
  } catch (e) {
    console.error("Failed to load leaders data", e);
  }
};

FactionDataManager.prototype._resolveLeaders = function () {
  const leaders = this._leadersData;
  if (!leaders) return;

  // Resolve Factions
  if (this._factions) {
    this._factions.forEach(faction => {
      if (faction.leaders) {
        faction.leaders = faction.leaders.map(key => leaders[key] || { name: key });
      }
    });
  }

  // Resolve Geopolitics (Hyperpowers and Historical Factions)
  if (this._hyperpowers) {
    for (const power in this._hyperpowers) {
      if (this._hyperpowers[power].leaders) {
        this._hyperpowers[power].leaders = this._hyperpowers[power].leaders.map(key => leaders[key] || { name: key });
      }
      // holy_leaders use the same key->object resolution (e.g. papacy track).
      if (this._hyperpowers[power].holy_leaders) {
        this._hyperpowers[power].holy_leaders = this._hyperpowers[power].holy_leaders.map(key => leaders[key] || { name: key });
      }
    }
  }

  if (this._historicalFactions) {
    for (const faction in this._historicalFactions) {
      if (this._historicalFactions[faction].leaders) {
        this._historicalFactions[faction].leaders = this._historicalFactions[faction].leaders.map(key => leaders[key] || { name: key });
      }
    }
  }
};

FactionDataManager.prototype._loadCountriesData = async function () {
  try {
    const response = await fetch(`js/db/WorldGen/Countries.json`);
    const data = await response.json();
    this._countries = {};
    for (const item of data) {
      this._countries[item.country] = {
        controller: item.controller || 'Neutral',
        faction: item.faction || 'Neutral'
      };
    }
  } catch (e) {
    console.error("Failed to load countries data", e);
  }
};

FactionDataManager.prototype._loadGeopoliticsData = async function () {
  try {
    const response = await fetch(`js/db/WorldGen/Hyperpowers.json`);
    const data = await response.json();
    this._hyperpowers = data.hyperpowers || {};
    this._historicalFactions = data.factions || {};
  } catch (e) {
    console.error("Failed to load geopolitics data", e);
  }
};

FactionDataManager.prototype._loadFactionsData = async function () {
  try {
    const response = await fetch(`js/db/WorldGen/Factions.json`);
    this._factions = await response.json();
    this._buildRelationshipMatrix();
  } catch (e) {
    console.error("Failed to load factions data", e);
  }
};

FactionDataManager.prototype._buildRelationshipMatrix = function () {
  const n = Array.isArray(this._factions) ? this._factions.length : 0;
  if (n === 0) return;

  // Initialize NxN matrix to 0
  this._relationships = Array.from({ length: n }, () => new Array(n).fill(0));

  // Populate from explicit relationships[] arrays in each faction entry, if present
  let hasExplicit = false;
  this._factions.forEach((faction, i) => {
    if (!Array.isArray(faction.relationships)) return;
    hasExplicit = true;
    faction.relationships.forEach(({ factionId, strength }) => {
      const j = Number(factionId);
      if (j >= 0 && j < n && i !== j) {
        const s = Math.max(-2, Math.min(2, Number(strength) || 0));
        this._relationships[i][j] = s;
        this._relationships[j][i] = s; // mirror
      }
    });
  });

  // Fallback: derive from factionType pairings when no explicit data exists
  if (!hasExplicit) {
    const TYPE_COMPAT = {
      Law:      { Criminal: -2, Military: 1,  Religious: 0, Mercenary: -1 },
      Criminal: { Law: -2,      Military: -1, Religious: -1, Mercenary: 1  },
      Military: { Law: 1,       Criminal: -1, Religious: 0,  Mercenary: -1 },
      Religious:{ Law: 0,       Criminal: -1, Military: 0,   Mercenary: 0  },
      Mercenary:{ Law: -1,      Criminal: 1,  Military: -1,  Religious: 0  },
    };
    this._factions.forEach((fi, i) => {
      this._factions.forEach((fj, j) => {
        if (i >= j) return;
        const ti = fi.type || fi.factionType || '';
        const tj = fj.type || fj.factionType || '';
        const s = TYPE_COMPAT[ti]?.[tj] ?? TYPE_COMPAT[tj]?.[ti] ?? 0;
        this._relationships[i][j] = s;
        this._relationships[j][i] = s;
      });
    });
  }
};

FactionDataManager.prototype.t = function (path) {
  if (!this._i18nData) return path;
  if (this._i18nData[path] !== undefined) return this._i18nData[path];
  const keys = path.split(".");
  let current = this._i18nData;
  for (const key of keys) {
    if (current[key] === undefined) return path;
    current = current[key];
  }
  return typeof current === "string" ? current : (current.name || path);
};

FactionDataManager.prototype._setupGeopoliticalData = function () {
  // Data is now loaded from Geopolitics.json in _loadGeopoliticsData
};



FactionDataManager.instance = new FactionDataManager();

//=============================================================================
// Register Plugin Commands
//=============================================================================

PluginManager.registerCommand("FactionDataManager", "open", (args) => {
  SceneManager.push(Scene_FactionStatus);
});

PluginManager.registerCommand("FactionDataManager", "setReputation", (args) => {
  const factionId = Number(args.factionId || 0);
  const value = Number(args.value || 0);
  $gameFactions.setReputation(factionId, value);
});

PluginManager.registerCommand(
  "FactionDataManager",
  "changeReputation",
  (args) => {
    const factionId = Number(args.factionId || 0);
    const change = Number(args.change || 0);
    $gameFactions.changeReputation(factionId, change);
  }
);

PluginManager.registerCommand(
  "FactionDataManager",
  "getFactionsByType",
  (args) => {
    const typeName = String(args.typeName || "");
    const variableId = Number(args.variableId || 0);
    $gameFactions.getFactionsByType(typeName, variableId);
  }
);

PluginManager.registerCommand(
  "FactionDataManager",
  "getHighestReputationFaction",
  (args) => {
    const variableId = Number(args.variableId || 0);
    $gameFactions.getHighestReputationFaction(variableId);
  }
);

PluginManager.registerCommand(
  "FactionDataManager",
  "getLowestReputationFaction",
  (args) => {
    const variableId = Number(args.variableId || 0);
    $gameFactions.getLowestReputationFaction(variableId);
  }
);

PluginManager.registerCommand(
  "FactionDataManager",
  "checkQuestAvailability",
  (args) => {
    const questId = Number(args.questId || 0);
    const factionId = Number(args.factionId || 0);
    const requiredRep = Number(args.requiredRep || 0);
    const switchId = Number(args.switchId || 0);
    $gameFactions.checkQuestAvailability(
      questId,
      factionId,
      requiredRep,
      switchId
    );
  }
);

PluginManager.registerCommand(
  "FactionDataManager",
  "getAvailableQuestCount",
  (args) => {
    const factionId = Number(args.factionId || 0);
    const variableId = Number(args.variableId || 0);
    $gameFactions.getAvailableQuestCount(factionId, variableId);
  }
);

//=============================================================================
// Menu Integration
//=============================================================================

const _Window_MenuCommand_makeCommandList_FactionDataManager =
  Window_MenuCommand.prototype.makeCommandList;
Window_MenuCommand.prototype.makeCommandList = function () {
  _Window_MenuCommand_makeCommandList_FactionDataManager.call(this);
  if (FRS.Params.showInMenu) {
    this.addCommand(FRS.Params.menuText(), "factions", true);
    // Set icon for the newly added command
    this._list[this._list.length - 1].icon = 247;
  }
};

const _Scene_Menu_createCommandWindow_FactionDataManager =
  Scene_Menu.prototype.createCommandWindow;
Scene_Menu.prototype.createCommandWindow = function () {
  _Scene_Menu_createCommandWindow_FactionDataManager.call(this);
  this._commandWindow.setHandler(
    "factions",
    this.commandFactionStatus.bind(this)
  );
};

Scene_Menu.prototype.commandFactionStatus = function () {
  SceneManager.push(Scene_FactionStatus);
};

//=============================================================================
// Game_Factions - Handles faction data and operations
//=============================================================================

function Game_Factions() {
  this.initialize(...arguments);
}

Game_Factions.prototype.initialize = function () {
  this._reputations = [];
  this.initializeReputations();
};

Game_Factions.prototype.initializeReputations = function () {
  // Initialize reputations from plugin parameters
  const numFactions = FactionDataManager.instance._factions.length;
  this._reputations = FRS.Params.startingValues.slice(0, numFactions);

  // Fill with zeros if there are not enough values
  while (this._reputations.length < numFactions) {
    this._reputations.push(0);
  }
};

Game_Factions.prototype.getReputation = function (factionId) {
  if (factionId >= 0 && factionId < this._reputations.length) {
    return this._reputations[factionId];
  }
  return 0;
};

Game_Factions.prototype.setReputation = function (factionId, value) {
  if (factionId >= 0 && factionId < this._reputations.length) {
    this._reputations[factionId] = Math.max(-100, Math.min(100, value));

    // Update relationships with other factions
    this.updateRelatedFactions(factionId, value);
  }
};

Game_Factions.prototype.changeReputation = function (factionId, change) {
  if (factionId >= 0 && factionId < this._reputations.length) {
    const newValue = this.getReputation(factionId) + change;
    this.setReputation(factionId, newValue);
  }
};

// Applies `change` to factionId AND every ancestor in its parentFaction chain
// (walked all the way up, not just one level, since some entries in
// Factions.json are two hops from their true root). Used by the character
// creation Faction Leader / Deserter origins, where joining or deserting a
// sub-faction should also color the player's standing with its parent(s).
Game_Factions.prototype.changeReputationWithParents = function (factionId, change) {
  this.changeReputation(factionId, change);
  const seen = new Set([factionId]);
  let current = this.getFaction(factionId);
  while (current && current.parentFaction !== undefined && !seen.has(current.parentFaction)) {
    seen.add(current.parentFaction);
    this.changeReputation(current.parentFaction, change);
    current = this.getFaction(current.parentFaction);
  }
};

Game_Factions.prototype.updateRelatedFactions = function (factionId, newValue) {
  // Skip if relationships aren't initialized
  if (!FactionDataManager.instance || !FactionDataManager.instance._relationships) {
    // Relationships system not set up, skip related faction updates
    return;
  }

  // Check if this is a significant reputation change
  const oldValue = this.getReputation(factionId);
  const change = newValue - oldValue;

  // Only update related factions if change is significant (>= 10 points)
  if (Math.abs(change) >= 10) {
    for (let i = 0; i < FactionDataManager.instance._factions.length; i++) {
      if (i !== factionId) {
        const relationship = FactionDataManager.instance._relationships[factionId][i];

        // Update related faction's reputation based on relationship
        if (relationship !== 0) {
          const relatedChange = Math.floor(change * relationship * 0.2);
          if (relatedChange !== 0) {
            this.changeReputation(i, relatedChange);
          }
        }
      }
    }
  }
};

Game_Factions.prototype.getReputationLevel = function (factionId) {
  const reputation = this.getReputation(factionId);

  // The band is a label, not an id: nothing matches on it.
  if (reputation >= 80) return T("Factions.repLevel.exalted");
  if (reputation >= 60) return T("Factions.repLevel.revered");
  if (reputation >= 40) return T("Factions.repLevel.honored");
  if (reputation >= 20) return T("Factions.repLevel.friendly");
  if (reputation >= -20) return T("Factions.repLevel.neutral");
  if (reputation >= -40) return T("Factions.repLevel.unfriendly");
  if (reputation >= -60) return T("Factions.repLevel.hostile");
  if (reputation >= -80) return T("Factions.repLevel.hated");
  return T("Factions.repLevel.nemesis");
};

Game_Factions.prototype.getReputationColor = function (factionId) {
  const reputation = this.getReputation(factionId);

  if (reputation >= 80) return "#00FF00"; // Bright green
  if (reputation >= 60) return "#32CD32"; // Lime green
  if (reputation >= 40) return "#90EE90"; // Light green
  if (reputation >= 20) return "#98FB98"; // Pale green
  if (reputation >= -20) return "#FFFFFF"; // White
  if (reputation >= -40) return "#FFA07A"; // Light salmon
  if (reputation >= -60) return "#FF6347"; // Tomato
  if (reputation >= -80) return "#FF4500"; // Orange red
  return "#FF0000"; // Red
};

Game_Factions.prototype.getReputationPerks = function (factionId) {
  const reputation = this.getReputation(factionId);
  const perks = [];

  // Generic perks based on reputation level
  if (reputation >= 20) {
    perks.push(T("Factions.perk.basicServices"));
  }
  if (reputation >= 40) {
    perks.push(T("Factions.perk.discount10"));
    perks.push(T("Factions.perk.uncommonItems"));
  }
  if (reputation >= 60) {
    perks.push(T("Factions.perk.discount25"));
    perks.push(T("Factions.perk.rareItems"));
    perks.push(T("Factions.perk.battleSupport"));
  }
  if (reputation >= 80) {
    perks.push(T("Factions.perk.discount40"));
    perks.push(T("Factions.perk.exclusiveItems"));
    perks.push(T("Factions.perk.specialQuests"));
    perks.push(T("Factions.perk.safeHouses"));
  }

  // Negative perks
  if (reputation <= -20) {
    perks.push(T("Factions.perk.servicesUnavailable"));
  }
  if (reputation <= -40) {
    perks.push(T("Factions.perk.refuseInteract"));
    perks.push(T("Factions.perk.suspiciousGuards"));
  }
  if (reputation <= -60) {
    perks.push(T("Factions.perk.dangerousTerritory"));
    perks.push(T("Factions.perk.attackOnSight"));
  }
  if (reputation <= -80) {
    perks.push(T("Factions.perk.bountyHunters"));
    perks.push(T("Factions.perk.alliesTurn"));
  }

  return perks;
};

Game_Factions.prototype.getRelationship = function (factionId1, factionId2) {
  // Return 0 if relationships aren't initialized
  if (!FactionDataManager.instance || !FactionDataManager.instance._relationships) {
    return 0;
  }

  if (
    factionId1 >= 0 &&
    factionId1 < FactionDataManager.instance._factions.length &&
    factionId2 >= 0 &&
    factionId2 < FactionDataManager.instance._factions.length
  ) {
    return FactionDataManager.instance._relationships[factionId1][factionId2];
  }
  return 0;
};

Game_Factions.prototype.getRelationshipName = function (
  factionId1,
  factionId2
) {
  const relationship = this.getRelationship(factionId1, factionId2);

  switch (relationship) {
    case 2:
      return T("Factions.relation.allied");
    case 1:
      return T("Factions.relation.friendly");
    case 0:
      return T("Factions.relation.neutral");
    case -1:
      return T("Factions.relation.unfriendly");
    case -2:
      return T("Factions.relation.hostile");
    default:
      return T("Factions.relation.unknown");
  }
};

Game_Factions.prototype.getAllFactions = function () {
  return FactionDataManager.instance._factions;
};

Game_Factions.prototype.getFaction = function (factionId) {
  if (factionId >= 0 && factionId < FactionDataManager.instance._factions.length) {
    return FactionDataManager.instance._factions[factionId];
  }
  return null;
};

Game_Factions.prototype.getFactionsByType = function (typeName, variableId) {
  let factionIds = [];

  // Map faction types to indices
  const typeIndices = {
    hardcoded: [0, 1, 2],
  };

  // Get faction IDs by type
  if (typeIndices[typeName]) {
    factionIds = typeIndices[typeName];
  }

  // Store count in variableId
  $gameVariables.setValue(variableId, factionIds.length);

  // Store faction IDs in subsequent variables
  for (let i = 0; i < factionIds.length; i++) {
    $gameVariables.setValue(variableId + i + 1, factionIds[i]);
  }
};

Game_Factions.prototype.getHighestReputationFaction = function (variableId) {
  let highestRepFaction = 0;
  let highestRep = -101;

  for (let i = 0; i < this._reputations.length; i++) {
    if (this._reputations[i] > highestRep) {
      highestRep = this._reputations[i];
      highestRepFaction = i;
    }
  }

  $gameVariables.setValue(variableId, highestRepFaction);
};

Game_Factions.prototype.getLowestReputationFaction = function (variableId) {
  let lowestRepFaction = 0;
  let lowestRep = 101;

  for (let i = 0; i < this._reputations.length; i++) {
    if (this._reputations[i] < lowestRep) {
      lowestRep = this._reputations[i];
      lowestRepFaction = i;
    }
  }

  $gameVariables.setValue(variableId, lowestRepFaction);
};

Game_Factions.prototype.checkQuestAvailability = function (
  questId,
  factionId,
  requiredRep,
  switchId
) {
  const reputation = this.getReputation(factionId);
  const isAvailable = reputation >= requiredRep;

  $gameSwitches.setValue(switchId, isAvailable);
};

Game_Factions.prototype.getAvailableQuestCount = function (
  factionId,
  variableId
) {
  // This is a placeholder function that would normally check quest data
  // For now, we'll simulate based on reputation
  const reputation = this.getReputation(factionId);
  let questCount = 0;

  if (reputation >= -20) questCount += 1;
  if (reputation >= 20) questCount += 1;
  if (reputation >= 40) questCount += 1;
  if (reputation >= 60) questCount += 2;
  if (reputation >= 80) questCount += 3;

  $gameVariables.setValue(variableId, questCount);
};

//=============================================================================
// DataManager Integration
//=============================================================================

const _DataManager_createGameObjects = DataManager.createGameObjects;
DataManager.createGameObjects = function () {
  _DataManager_createGameObjects.call(this);
  // A new game in an existing world continues that world's reputations.
  const worldFactions = window.WorldManager && window.WorldManager.activeWorldName
    ? window.WorldManager.getField("npcs", "factions")
    : null;
  $gameFactions = worldFactions || new Game_Factions();
};

const _DataManager_makeSaveContents = DataManager.makeSaveContents;
DataManager.makeSaveContents = function () {
  const contents = _DataManager_makeSaveContents.call(this);
  // Faction reputations are world state: they live in the world folder
  // (npcs.json) instead of the binary savegame.
  if (window.WorldManager) {
    window.WorldManager.setField("npcs", "factions", $gameFactions);
  } else {
    contents.factions = $gameFactions;
  }
  return contents;
};

const _DataManager_extractSaveContents = DataManager.extractSaveContents;
DataManager.extractSaveContents = function (contents) {
  _DataManager_extractSaveContents.call(this, contents);
  const worldFactions = window.WorldManager
    ? window.WorldManager.getField("npcs", "factions")
    : null;
  $gameFactions = worldFactions || contents.factions;
  if (!$gameFactions) {
    $gameFactions = new Game_Factions();
  }
  // Migrate factions from old saves into the world store
  if (window.WorldManager && !worldFactions && contents.factions) {
    window.WorldManager.setField("npcs", "factions", contents.factions);
  }
  // Re-establish the singleton instance on the loaded object if it's lost
  if ($gameFactions && !FactionDataManager.instance) {
    FactionDataManager.instance = new FactionDataManager();
  }
};

//=============================================================================
// Scene_FactionStatus
//=============================================================================

function Scene_FactionStatus() {
  this.initialize(...arguments);
}

Scene_FactionStatus.prototype = Object.create(Scene_MenuBase.prototype);
Scene_FactionStatus.prototype.constructor = Scene_FactionStatus;
window.Scene_FactionStatus = Scene_FactionStatus;

Scene_FactionStatus.prototype.initialize = function () {
  Scene_MenuBase.prototype.initialize.call(this);
  this._selectMode = false;
  this._onConfirm = null;
};

// Selection mode: pushed with SceneManager.push(Scene_FactionStatus) then
// SceneManager.prepareNextScene("select", callback) (same convention as
// Scene_BuyTroops.prepare in ArmyManager.js). While in this mode, confirming
// a faction calls `callback(factionId)` and pops the scene instead of the
// normal no-op OK. Used by the character-creation Faction Leader / Deserter
// origins to let the player pick a faction with this same browser.
Scene_FactionStatus.prototype.prepare = function (mode, onConfirm) {
  this._selectMode = mode === "select";
  this._onConfirm = typeof onConfirm === "function" ? onConfirm : null;
};

Scene_FactionStatus.prototype.create = function () {
  Scene_MenuBase.prototype.create.call(this);
  this.createFactionStatusWindow();

  if (this._factionStatusWindow) {
    this._factionStatusWindow.visible = false;
    this._factionStatusWindow.deactivate();
  }

  this._dndSelectedIndex = 0;
  this.createUIFactionsOverlay();
};

Scene_FactionStatus.prototype.createFactionStatusWindow = function () {
  const rect = this.factionStatusWindowRect();
  this._factionStatusWindow = new Window_FactionStatus(rect);
  this._factionStatusWindow.setHandler("cancel", this.popScene.bind(this));
  this.addWindow(this._factionStatusWindow);
};

Scene_FactionStatus.prototype.factionStatusWindowRect = function () {
  const wx = 0;
  const wy = this.mainAreaTop();
  const ww = Graphics.boxWidth;
  const wh = this.mainAreaHeight();
  return new Rectangle(wx, wy, ww, wh);
};

Scene_FactionStatus.prototype.createUIFactionsOverlay = function () {


  // Create Factions DOM container
  this._dndContainer = document.createElement("div");
  this._dndContainer.id = "menu-container";
  this._dndContainer.style.opacity = "0";
  this._dndContainer.style.transition = "opacity 0.22s ease-out";
  document.body.appendChild(this._dndContainer);

  // RPG Maker attaches a document-level wheel listener that preventDefaults,
  // which kills native scrolling inside DOM overlays: without this the left
  // faction list could not be scrolled with the wheel at all. Scroll the
  // scrollable region under the pointer ourselves and stop the event before it
  // reaches the game. Bound on the container, which survives every refresh
  // (the pages inside it are re-rendered).
  this._dndContainer.addEventListener("wheel", (e) => {
    const box = e.target.closest("#factions-grid, .right-page");
    if (box) box.scrollTop += e.deltaY;
    e.stopPropagation();
    e.preventDefault();
  }, { passive: false });

  this.refreshUIFactions();
  UIFactionsInputManager.activate(this);

  setTimeout(() => {
    if (this._dndContainer) {
      this._dndContainer.style.opacity = "1";
    }
  }, 16);
};

Scene_FactionStatus.prototype.getFactionList = function () {
  const allFactions = $gameFactions.getAllFactions();
  const mainFactions = allFactions.filter((f) => f.parentFaction === undefined);
  const subFactions = allFactions.filter((f) => f.parentFaction !== undefined);

  mainFactions.sort((a, b) => a.id - b.id);

  const list = [];
  mainFactions.forEach((mainFaction) => {
    list.push({ faction: mainFaction, isSub: false });
    const children = subFactions.filter((sub) => sub.parentFaction === mainFaction.id);
    children.sort((a, b) => a.id - b.id);
    children.forEach((child) => {
      list.push({ faction: child, isSub: true });
    });
  });
  return list;
};

Scene_FactionStatus.prototype.refreshUIFactions = function () {
  if (!this._dndContainer) return;

  const factionList = this.getFactionList();

  if (this._dndSelectedIndex >= factionList.length) {
    this._dndSelectedIndex = Math.max(0, factionList.length - 1);
  }

  const selectedRecord = factionList[this._dndSelectedIndex] || null;

  // Generate Left Page: Faction Politics Spread
  let listHTML = "";
  factionList.forEach((item, idx) => {
    const faction = item.faction;
    const isFocused = this._dndSelectedIndex === idx ? "selected" : "";
    const isSub = item.isSub ? "faction-sub" : "";
    const subMarker = item.isSub ? `<span class="faction-sub-marker">⤍</span>` : "";

    const factionName = FactionDataManager.instance.t(faction.name);
    const reputation = $gameFactions.getReputation(faction.id);
    const reputationLevel = $gameFactions.getReputationLevel(faction.id);
    const reputationColor = $gameFactions.getReputationColor(faction.id);
    const canvasId = `fac-canvas-${idx}`;

    listHTML += `
      <div class="faction-row ${isFocused} ${isSub}" onclick="SceneManager._scene.selectUIFaction(${idx})">
        ${subMarker}
        ${!item.isSub && faction.iconIndex ? `
          <div class="faction-icon-frame">
            <canvas id="${canvasId}" width="32" height="32" style="width:24px; height:24px;"></canvas>
          </div>
        ` : ""}
        <div class="faction-info">
          <span class="faction-name">${factionName}</span>
        </div>
        <span class="faction-rep-badge" style="color: ${reputationColor};">${reputationLevel} (${reputation})</span>
      </div>
    `;
  });

  const backBtnText = T("Factions.back");
  const factionsTitle = T("Factions.title");

  const leftPageHTML = `
    <div class="left-page">
      <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
        <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
          ${backBtnText}
        </div>
        <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${factionsTitle}</h2>
      </div>
      <div class="backpack-grid" style="display:flex; flex-direction:column; overflow-y:auto; flex: 1 1 auto; min-height: 0; padding-right:5px;" id="factions-grid">
        ${listHTML}
      </div>
    </div>
  `;

  // Determine left page key to see if left page needs full render
  const leftPageKey = `${factionList.length}`;
  const leftPageContainer = this._dndContainer.querySelector(".left-page");

  // Generate Right Page: Political Heraldry Codicil
  let rightPageHTML = "";

  if (!selectedRecord) {
    rightPageHTML = `
      <div class="right-page">
        <div class="faction-heraldry-card" style="justify-content: center; text-align: center; padding: 40px 10px;">
          <div style="font-size: 4em; margin-bottom: 20px;"></div>
          <h3 class="title" style="border:none; margin-bottom: 10px;">${T("Factions.selectTitle")}</h3>
          <p style="font-family: 'Lora', serif; font-style: italic; line-height: 1.6; color: #6b5242;">
            ${T("Factions.selectHint")}
          </p>
        </div>
      </div>
    `;
  } else {
    const faction = selectedRecord.faction;
    const factionName = FactionDataManager.instance.t(faction.name);
    const description = FactionDataManager.instance.t(faction.description);

    let leadersHTML = "";
    if (faction.leaders && faction.leaders.length > 0) {
      const leaderNames = faction.leaders.map(l => {
        if (l && l.name) {
          return FactionDataManager.instance.t(l.name);
        }
        return FactionDataManager.instance.t(l);
      }).join(", ");
      leadersHTML = `
        <div style="margin-top: 15px; font-family: 'Lora', serif; font-size: 0.9em; border-top: 1px solid #c9b4a1; padding-top: 10px;">
          <strong>${T("Factions.councilLeaders")}</strong> <span style="font-style: italic;">${leaderNames}</span>
        </div>
      `;
    }

    let relationsHTML = "";
    const allFactionsList = $gameFactions.getAllFactions();
    const otherParentFactions = allFactionsList.filter(f => f.parentFaction === undefined && f.id !== faction.id).slice(0, 3);

    otherParentFactions.forEach(other => {
      const relValue = $gameFactions.getRelationship(faction.id, other.id);
      const relName = $gameFactions.getRelationshipName(faction.id, other.id);
      let relColor = "#6b5242"; // Neutral
      if (relValue > 0) relColor = "#2e7d32"; // Allied/Friendly
      if (relValue < 0) relColor = "#c62828"; // Hostile

      relationsHTML += `
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-family: 'Lora', serif; font-size: 0.9em; border-bottom: 1px dashed #d1c2b4; padding-bottom: 2px;">
          <span>vs. ${FactionDataManager.instance.t(other.name)}</span>
          <span style="color: ${relColor}; font-weight: bold;">${relName}</span>
        </div>
      `;
    });

    rightPageHTML = `
      <div class="right-page">
        <div class="faction-heraldry-card">
          <div class="heraldry-emblem-box">
            <canvas id="heraldry-canvas" width="32" height="32" style="width:36px; height:36px; image-rendering: pixelated;"></canvas>
          </div>
          
          <div class="heraldry-header">
            <h3 class="heraldry-title">${factionName}</h3>
          </div>

          <div class="inspect-lore" style="flex-grow: 1; max-height: 180px; overflow-y: auto; padding-right:5px; margin-bottom: 15px;">
            ${description}
          </div>

          ${leadersHTML}

          <div class="politics-grid">
            <h4 style="font-family: 'Lora', serif; font-size: 1.1em; color: #58180D; margin: 0 0 8px 0; border-bottom: 1px solid #d1c2b4; padding-bottom: 4px;">${T("Factions.diplomaticAgreements")}</h4>
            ${relationsHTML || `<div style="font-family:'Lora', serif; font-style:italic; font-size:0.9em; color:#8c715c;">${T("Factions.independent")}</div>`}
          </div>

        </div>
      </div>
    `;
  }

  if (!leftPageContainer || this._dndLastLeftPageKey !== leftPageKey) {
    this._dndLastLeftPageKey = leftPageKey;
    // Draw double page spread
    this._dndContainer.innerHTML = `
      <div class="book-spread">
        ${leftPageHTML}
        ${rightPageHTML}
      </div>
    `;

    // Draw emblems on canvases
    factionList.forEach((item, idx) => {
      const faction = item.faction;
      if (!item.isSub && faction.iconIndex) {
        this.drawUIFactionEmblem(faction.iconIndex, `fac-canvas-${idx}`);
      }
    });
  } else {
    // Left page already drawn! Update only dynamic classes in-place
    // 1. Faction rows
    const rows = leftPageContainer.querySelectorAll(".faction-row");
    rows.forEach((row, idx) => {
      if (this._dndSelectedIndex === idx) {
        row.classList.add("selected");
      } else {
        row.classList.remove("selected");
      }
    });

    // 2. Update right page in-place
    const rightPageContainer = this._dndContainer.querySelector(".right-page");
    if (rightPageContainer) {
      rightPageContainer.outerHTML = rightPageHTML;
    }
  }

  if (selectedRecord && selectedRecord.faction.iconIndex) {
    this.drawUIFactionEmblem(selectedRecord.faction.iconIndex, "heraldry-canvas");
  }

  // Scroll active item into view
  const selectedElem = this._dndContainer.querySelector(".faction-row.selected");
  if (selectedElem) {
    selectedElem.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
};

Scene_FactionStatus.prototype.drawUIFactionEmblem = function (iconIndex, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const bitmap = ImageManager.loadSystem("IconSet");

  const drawIcon = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 32, 32);
    ctx.imageSmoothingEnabled = false;

    const pw = 32;
    const ph = 32;
    const sx = (iconIndex % 16) * pw;
    const sy = Math.floor(iconIndex / 16) * ph;

    ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, 0, 0, 32, 32);
  };

  if (bitmap.isReady()) {
    drawIcon();
  } else {
    bitmap.addLoadListener(drawIcon);
  }
};

Scene_FactionStatus.prototype.selectUIFaction = function (idx) {
  SoundManager.playCursor();
  this._dndSelectedIndex = idx;
  this.refreshUIFactions();
};

// Scene hook updates & intercepts
const _Scene_FactionStatus_update = Scene_FactionStatus.prototype.update;
Scene_FactionStatus.prototype.update = function () {
  _Scene_FactionStatus_update.call(this);
  UIFactionsInputManager.update();
};

const _Scene_FactionStatus_terminate = Scene_FactionStatus.prototype.terminate;
Scene_FactionStatus.prototype.terminate = function () {
  _Scene_FactionStatus_terminate.call(this);
  UIFactionsInputManager.deactivate();
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

// Keyboard and Gamepad Interceptor for Factions Screen
const UIFactionsInputManager = {
  _scene: null,
  _active: false,

  activate: function (scene) {
    this._scene = scene;
    this._active = true;
  },

  deactivate: function () {
    this._active = false;
    this._scene = null;
  },

  update: function () {
    if (!this._active || !this._scene) return;

    if (Input.isTriggered('down')) {
      this.handleMove("down");
    } else if (Input.isTriggered('up')) {
      this.handleMove("up");
    } else if (Input.isTriggered('ok')) {
      this.handleOk();
    } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
      this.handleCancel();
    }
  },

  handleMove: function (dir) {
    const scene = this._scene;
    const list = scene.getFactionList();
    const count = list.length;

    if (dir === "down") {
      if (scene._dndSelectedIndex < count - 1) {
        SoundManager.playCursor();
        scene._dndSelectedIndex++;
        scene.refreshUIFactions();
      }
    } else if (dir === "up") {
      if (scene._dndSelectedIndex > 0) {
        SoundManager.playCursor();
        scene._dndSelectedIndex--;
        scene.refreshUIFactions();
      }
    }
  },

  handleOk: function () {
    const scene = this._scene;
    if (scene && scene._selectMode) {
      const list = scene.getFactionList();
      const entry = list[scene._dndSelectedIndex];
      SoundManager.playOk();
      if (entry && scene._onConfirm) {
        const callback = scene._onConfirm;
        scene._onConfirm = null;
        callback(entry.faction.id);
      }
      scene.popScene();
      return;
    }
    SoundManager.playOk();
  },

  handleCancel: function () {
    SoundManager.playCancel();
    this._scene.popScene();
  }
};



//=============================================================================

// Window_FactionStatus

//=============================================================================



function Window_FactionStatus() {

  this.initialize(...arguments);

}



Window_FactionStatus.prototype = Object.create(Window_Selectable.prototype);

Window_FactionStatus.prototype.constructor = Window_FactionStatus;



Window_FactionStatus.prototype.initialize = function (rect) {

  Window_Selectable.prototype.initialize.call(this, rect);

  this.makeItemList();

  this.refresh();

  this.activate();

};



Window_FactionStatus.prototype.makeItemList = function () {

  this._data = [];

  const allFactions = $gameFactions.getAllFactions();

  const mainFactions = allFactions.filter((f) => f.parentFaction === undefined);

  const subFactions = allFactions.filter((f) => f.parentFaction !== undefined);



  mainFactions.sort((a, b) => a.id - b.id);



  mainFactions.forEach((mainFaction) => {

    this._data.push({ faction: mainFaction, isSub: false });

    const children = subFactions.filter(

      (sub) => sub.parentFaction === mainFaction.id

    );

    children.sort((a, b) => a.id - b.id);

    children.forEach((child) => {

      this._data.push({ faction: child, isSub: true });

    });

  });

};



Window_FactionStatus.prototype.maxItems = function () {

  return this._data ? this._data.length : 0;

};



Window_FactionStatus.prototype.itemHeight = function () {



  return this.lineHeight(); // Each item takes one line



};



Window_FactionStatus.prototype.drawItem = function (index) {



  const item = this._data[index];



  const faction = item.faction;



  if (faction) {



    const rect = this.itemLineRect(index);







    // Determine which language to use for name and description



    const factionName = FactionDataManager.instance.t(faction.name);







    const reputation = $gameFactions.getReputation(faction.id);



    const reputationLevel = $gameFactions.getReputationLevel(faction.id);



    const reputationColor = $gameFactions.getReputationColor(faction.id);







    const iconWidth = ImageManager.iconWidth;



    const baseTextIndent = iconWidth + 4; // Space for icon + padding



    const subFactionIndent = 32; // Additional indent for subfactions







    let currentTextX = rect.x;







    // Draw icon for main factions



    if (!item.isSub && faction.iconIndex) {



      this.drawIcon(faction.iconIndex, currentTextX, rect.y);



    }







    // Adjust textX based on whether it's a subfaction or main faction



    if (item.isSub) {



      currentTextX += baseTextIndent + subFactionIndent; // Subfactions get icon space + additional indent



    } else {



      currentTextX += baseTextIndent; // Main factions just get icon space



    }







    const availableWidth = rect.width - (currentTextX - rect.x);



    const textY = rect.y;







    // Draw faction name (left-aligned)



    this.changeTextColor(ColorManager.normalColor());



    this.drawText(factionName, currentTextX, textY, availableWidth / 2, "left");







    // Draw reputation (right-aligned)



    this.changeTextColor(reputationColor);



    const repText = reputationLevel + ` (${reputation})`;



    this.drawText(repText, currentTextX + availableWidth / 2, textY, availableWidth / 2, "right");



  }



};



Window_FactionStatus.prototype.update = function () {

  Window_Selectable.prototype.update.call(this);

  if (this.isOpenAndActive()) {

    if (Input.isTriggered("ok") || Input.isTriggered("cancel")) {

      SoundManager.playCancel();

      this.callHandler("cancel");

    }

  }

};

