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
  this._i18nDataEN = null;
  this._leadersData = {};
  this._ready = false;
  this._readyPromise = Promise.all([
    this._loadI18nData(),
    this._loadCountriesData(),
    this._loadGeopoliticsData(),
    this._loadFactionsData(),
    this._loadLeadersData()
  ]).then(() => {
    this._resolveLeaders();
    this._ready = true;
  });
  this._setupGeopoliticalData();
};

// The keys stored on faction/troop data ("factions.magesguild.troops.x.name",
// "roles.support", "formations.circle", ...) are dotted paths into these five
// files merged into one lookup table. Loaded twice: once for the active
// language and once for English, so .t() always has an English answer to
// fall back on when a translation is missing or a language pack is thin.
FactionDataManager.I18N_SOURCES = [
  { file: "faction.json", key: null },
  { file: "ideology.json", key: null },
  { file: "personalities.json", key: "personalities" },
  { file: "roles.json", key: "roles" },
  { file: "formations.json", key: "formations" }
];

FactionDataManager.prototype._loadI18nSet = async function (lang) {
  const out = {};
  await Promise.all(FactionDataManager.I18N_SOURCES.map(async (src) => {
    try {
      const response = await fetch(`js/i18n/${lang}/${src.file}`);
      const data = await response.json();
      if (src.key) out[src.key] = data;
      else Object.assign(out, data);
    } catch (e) {
      console.error(`Failed to load ${src.file} i18n data (${lang})`, e);
    }
  }));
  return out;
};

FactionDataManager.prototype._loadI18nData = async function () {
  const lang = ConfigManager.language || "en";
  this._i18nDataEN = await this._loadI18nSet("en");
  this._i18nData = (lang === "en") ? this._i18nDataEN : await this._loadI18nSet(lang);
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
        faction: item.faction || 'Neutral',
        // The continent it stands on. World generation only lets a power take
        // nations in its own region (HistorySimulator.handleNationPolitics),
        // so this has to survive the trip from the data file.
        region: item.region || null
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

FactionDataManager.prototype._digI18n = function (root, path) {
  if (!root) return undefined;
  if (root[path] !== undefined) return root[path];
  const keys = path.split(".");
  let current = root;
  for (const key of keys) {
    if (current == null || current[key] === undefined) return undefined;
    current = current[key];
  }
  return current;
};

// Resolves a dotted i18n path stored on faction/troop/role/formation data
// (e.g. "factions.magesguild.troops.apprenticemage.name"). Falls back to the
// English data set when the active language is missing the key, and to the
// raw key itself (never blank) when neither has it.
FactionDataManager.prototype.t = function (path) {
  let value = this._digI18n(this._i18nData, path);
  if (value === undefined) value = this._digI18n(this._i18nDataEN, path);
  if (value === undefined) return path;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.name === "string") return value.name;
  return path;
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

//=============================================================================
// World initialization
//=============================================================================

// The diplomatic accords are rolled when the world is made, not when somebody
// first opens the faction screen, so every savegame of the world reads the same
// treaties (they live in the world folder, npcs.json "diplomacy"). Runs after
// politics, since it is the same layer of the world: who is in office and who
// they have signed with. Throwing while the faction table is still loading is
// how a step asks WorldManager to try it again.
if (typeof window !== "undefined" && window.WorldManager?.registerWorldInitializer) {
  window.WorldManager.registerWorldInitializer("factionDiplomacy", 55, () => {
    if (!$gameFactions || !FactionDataManager.instance
      || !Array.isArray(FactionDataManager.instance._factions)
      || !FactionDataManager.instance._factions.length) {
      throw new Error("FactionDataManager: factions not loaded yet");
    }
    const table = $gameFactions.generateDiplomacy();
    if (!table) throw new Error("FactionDataManager: hyperpowers not loaded yet");
    $gameSystem._factionDiplomacy = table;
  });
}

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

// Applies `change` to a faction AND to the hyperpower it answers to: earning a
// branch's goodwill colours the power's standing too, which is read under its
// own "hp:<id>" key (Factions.json `parentHyperpower`).
Game_Factions.prototype.changeReputationWithParents = function (factionId, change) {
  this.changeReputation(factionId, change);
  const faction = this.getFaction(factionId);
  const hp = this.hyperpowerOfFaction(faction);
  if (hp) this.changeReputation(this.hyperpowerStandingKey(hp.id), change);
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

//=============================================================================
// Per-character standing
//=============================================================================
//
// The number above is the world's: it is shared by every savegame of the world
// (npcs.json) and it is what every existing caller moves. It is not, however,
// what a hall thinks of the person standing in it. Each actor carries their own
// DELTA on top of it, so two travellers can be welcome in different places, and
// a delegate's seat is theirs and not the party's.
//
// The delta is a plain own property on Game_Actor, which is what puts it in the
// binary savegame (the same convention as actor._diseases and actor._cravings).
// Keys are faction ids written as strings, plus "hp:<id>" for the five
// hyperpowers that have no faction entry of their own and therefore no slot in
// the world array (Goblin Horde, Free States of Midwest, Cascadia Protectorate,
// Eastern Seaboard, Continental Union).
const FACTION_REP_MIN = -100;
const FACTION_REP_MAX = 100;

const _factionRepClamp = (v) =>
  Math.max(FACTION_REP_MIN, Math.min(FACTION_REP_MAX, Math.round(Number(v) || 0)));

// A standing key is either a faction id (number, or a numeric string) or one of
// the synthetic "hp:<id>" keys. Returns null for anything else.
Game_Factions.prototype.standingKey = function (factionId) {
  if (typeof factionId === "number" && Number.isFinite(factionId)) return String(factionId);
  const s = String(factionId == null ? "" : factionId);
  if (/^-?\d+$/.test(s)) return s;
  if (/^hp:\d+$/.test(s)) return s;
  return null;
};

// The actor's own ledger, created on first write. Read paths tolerate its
// absence so a savegame made before this existed reads as "no opinions yet".
Game_Factions.prototype.actorDeltas = function (actor) {
  if (!actor) return null;
  if (!actor._factionRep) actor._factionRep = {};
  return actor._factionRep;
};

// The world's number for a key. Synthetic "hp:" keys have no world slot, so
// they answer 0 and live entirely in the per-character ledger.
Game_Factions.prototype.baseStanding = function (factionId) {
  const key = this.standingKey(factionId);
  if (key === null || key.charAt(0) === "h") return 0;
  return this.getReputation(Number(key));
};

// What this character is worth to that faction: the world's opinion plus their
// own. Falls back to the world number when no actor is given, so a call site
// that has not been taught about characters yet keeps working.
Game_Factions.prototype.getReputationFor = function (actor, factionId) {
  const key = this.standingKey(factionId);
  if (key === null) return 0;
  const base = this.baseStanding(key);
  if (!actor) return _factionRepClamp(base);
  const deltas = actor._factionRep;
  const delta = deltas ? Number(deltas[key]) || 0 : 0;
  return _factionRepClamp(base + delta);
};

// Moves one character's opinion only. The world number is left alone: a caller
// that wants both moves both.
Game_Factions.prototype.changeReputationFor = function (actor, factionId, change) {
  const key = this.standingKey(factionId);
  if (key === null || !actor || !change) return;
  const deltas = this.actorDeltas(actor);
  // The delta is clamped against the band the total can occupy, so a character
  // cannot bank goodwill past the ceiling and spend it later.
  const base = this.baseStanding(key);
  const current = Number(deltas[key]) || 0;
  const wanted = current + Number(change);
  deltas[key] = Math.max(FACTION_REP_MIN - base, Math.min(FACTION_REP_MAX - base, Math.round(wanted)));
};

Game_Factions.prototype.setReputationFor = function (actor, factionId, value) {
  const key = this.standingKey(factionId);
  if (key === null || !actor) return;
  const deltas = this.actorDeltas(actor);
  deltas[key] = _factionRepClamp(value) - this.baseStanding(key);
};

// The same bands and colours the world number uses, read for one character.
Game_Factions.prototype.reputationLevelOf = function (reputation) {
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

Game_Factions.prototype.reputationColorOf = function (reputation) {
  if (reputation >= 80) return "#00FF00";
  if (reputation >= 60) return "#32CD32";
  if (reputation >= 40) return "#90EE90";
  if (reputation >= 20) return "#98FB98";
  if (reputation >= -20) return "#FFFFFF";
  if (reputation >= -40) return "#FFA07A";
  if (reputation >= -60) return "#FF6347";
  if (reputation >= -80) return "#FF4500";
  return "#FF0000";
};

Game_Factions.prototype.getReputationLevelFor = function (actor, factionId) {
  return this.reputationLevelOf(this.getReputationFor(actor, factionId));
};

Game_Factions.prototype.getReputationColorFor = function (actor, factionId) {
  return this.reputationColorOf(this.getReputationFor(actor, factionId));
};

//=============================================================================
// Hyperpower parentage
//=============================================================================
//
// `parentHyperpower` in Factions.json holds the NAME a power is filed under in
// js/db/WorldGen/Hyperpowers.json. It used to hold that power's numeric id,
// which collided with the faction ids and filed the whole Mages Guild branch
// under faction 8, the Naguka. The lore's tree is hyperpower -> the factions
// that answer to it, so that is what these resolve.

// Ordered [name, data] pairs from Hyperpowers.json, sorted by id.
Game_Factions.prototype.getHyperpowers = function () {
  const src = (window.WorldGen && window.WorldGen.Hyperpowers &&
    window.WorldGen.Hyperpowers.hyperpowers) ||
    (FactionDataManager.instance && FactionDataManager.instance._hyperpowers) || {};
  return Object.keys(src)
    .map((name) => ({ name: name, id: Number(src[name].id), data: src[name] }))
    .filter((h) => Number.isFinite(h.id))
    .sort((a, b) => a.id - b.id);
};

Game_Factions.prototype.getHyperpower = function (hyperpowerId) {
  return this.getHyperpowers().find((h) => h.id === hyperpowerId) || null;
};

// Every faction that answers to a hyperpower. `parentHyperpower` in
// Factions.json holds the power's NAME, the key it is filed under in
// Hyperpowers.json, so the two files are joined by name rather than by an id
// that used to collide with the faction ids.
Game_Factions.prototype.getHyperpowerFactions = function (hyperpowerId) {
  const hp = this.getHyperpower(hyperpowerId);
  if (!hp) return [];
  return this.getAllFactions()
    .filter((f) => f && f.parentHyperpower === hp.name)
    .sort((a, b) => a.id - b.id);
};

// The power a faction answers to, or null for an orphan. An orphan is listed in
// the book like any other faction, but it holds no seat at the assembly, takes
// no nation and cannot be sworn to.
Game_Factions.prototype.hyperpowerOfFaction = function (faction) {
  if (!faction || !faction.parentHyperpower) return null;
  return this.getHyperpowers().find((hp) => hp.name === faction.parentHyperpower) || null;
};

Game_Factions.prototype.isOrphanFaction = function (faction) {
  return !!faction && !faction.parentHyperpower;
};

// Every nation a power currently holds. The world simulation's map wins, since
// a century of conquest moves nations between powers; the country table answers
// for a world whose history was never run.
Game_Factions.prototype.countriesOfHyperpower = function (powerName) {
  const held = [];
  const sim = window.HistoryManager && window.HistoryManager.getNationsState
    ? window.HistoryManager.getNationsState() : null;
  if (sim && Object.keys(sim).length) {
    for (const [nation, info] of Object.entries(sim)) {
      if (info && info.controller === powerName) held.push(nation);
    }
    if (held.length) return held.sort();
  }
  const countries = (window.WorldGen && window.WorldGen.Countries) || [];
  return countries
    .filter((c) => c && (c.controller === powerName || (c.controller === "Neutral" && c.faction === powerName)))
    .map((c) => c.country)
    .sort();
};

// The leaders a faction can field: it has none of its own any more. It fields
// the political class of every nation its power holds, and of the nation that
// power is seated in (Leaders.json `country`). An orphan fields nobody.
Game_Factions.prototype.getFactionLeaders = function (faction) {
  const hp = this.hyperpowerOfFaction(faction);
  if (!hp) return [];
  const HM = window.HistoryManager;
  if (HM && typeof HM.leaderPoolFor === "function") {
    const pool = HM.leaderPoolFor(hp.name);
    if (pool && pool.length) return pool;
  }
  const book = (window.WorldGen && window.WorldGen.Leaders) || {};
  const nations = new Set(this.countriesOfHyperpower(hp.name));
  if (hp.data && hp.data.homeNation) nations.add(hp.data.homeNation);
  return Object.values(book).filter((l) => l && nations.has(l.country));
};

// No faction speaks for a hyperpower any longer: a power's own head faction is
// not in Factions.json at all, and its troops were handed down to the branches
// that answer to it. Kept as a null answer because a good deal of code still
// asks the question.
Game_Factions.prototype.getHyperpowerHead = function () {
  return null;
};

// The emblem a power is drawn under: its own (Hyperpowers.json `iconIndex`,
// inherited from the head faction it used to be spoken for by), or the first of
// its branches to carry one.
Game_Factions.prototype.hyperpowerIcon = function (hyperpowerId) {
  const hp = this.getHyperpower(hyperpowerId);
  if (hp && hp.data && hp.data.iconIndex) return hp.data.iconIndex;
  const branch = this.getHyperpowerFactions(hyperpowerId).find((f) => f && f.iconIndex);
  return branch ? branch.iconIndex : 0;
};

// Factions that answer to nobody: the orphans, which stand on their own.
Game_Factions.prototype.getIndependentFactions = function () {
  return this.getAllFactions()
    .filter((f) => f && !f.parentHyperpower)
    .sort((a, b) => a.id - b.id);
};

// The standing key a hyperpower is read and written through. Every power now
// has one of its own, since none of them is spoken for by a faction.
Game_Factions.prototype.hyperpowerStandingKey = function (hyperpowerId) {
  return "hp:" + hyperpowerId;
};

// The name a hyperpower is read under. Its key in Hyperpowers.json is English
// prose, so a translation is looked for first, then the localized name of the
// faction that speaks for it, and only then the raw key.
Game_Factions.prototype.hyperpowerLabel = function (hp) {
  if (!hp) return "";
  const slug = String(hp.name).toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = "Factions.power." + slug;
  if (typeof T.has === "function" && T.has(key)) return T(key);
  return hp.name;
};

//=============================================================================
// Diplomatic accords
//=============================================================================
//
// Who has signed what with whom. The accords are rolled ONCE, when the world is
// made, out of the world seed, and written into the world folder (npcs.json
// "diplomacy", reached through $gameSystem._factionDiplomacy), so every
// savegame of a world walks into the same geopolitics instead of each one
// rolling its own.
//
// Two layers:
//   powers   the hyperpower-to-hyperpower table, and it is symmetric: if
//            Britannia has signed nothing but threats with the Soviet Union,
//            the Soviet Union has signed the same with Britannia.
//   factions one row per faction that answers to a power. It STARTS from its
//            power's row and then drifts, because a branch is not its parent:
//            an intelligence bureau can be at war with a power its own
//            government still trades with. Independents get a row of their own.
//
// Values are the same -2..2 scale as getRelationship, so getRelationshipName
// reads them without translation.

// How likely each accord is when one is rolled from nothing. Weighted towards
// the middle: a world where every power hates every other power is not a world
// with any diplomacy left in it.
Game_Factions.ACCORD_WEIGHTS = [
  { value: -2, weight: 8 },
  { value: -1, weight: 20 },
  { value: 0, weight: 36 },
  { value: 1, weight: 24 },
  { value: 2, weight: 12 },
];

Game_Factions.prototype._accordRng = function (salt) {
  const shared = window.NPCShared;
  const seed = shared && typeof shared.worldSeed === "function" ? shared.worldSeed() >>> 0 : 1;
  let hash = 5381;
  const text = String(salt);
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  if (shared && shared.Rng) return new shared.Rng((seed ^ hash) >>> 0);
  // Standalone fallback (tests, or a build without the NPC suite): the same
  // xorshift the suite uses, so a seed means the same world either way.
  let state = ((seed ^ hash) >>> 0) || 1;
  return {
    next() {
      state ^= state << 13; state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5; state >>>= 0;
      return state / 4294967296;
    },
  };
};

Game_Factions.prototype._rollAccord = function (rng) {
  const table = Game_Factions.ACCORD_WEIGHTS;
  const total = table.reduce((sum, row) => sum + row.weight, 0);
  let roll = rng.next() * total;
  for (const row of table) {
    roll -= row.weight;
    if (roll <= 0) return row.value;
  }
  return 0;
};

// A branch's own line on one power, drifted off whatever its parent signed.
// Most of the row is inherited — a branch that agreed with its government about
// nothing would not still be one of its branches — so roughly a third of the
// columns move, and only rarely by the two steps that make a real break.
Game_Factions.prototype._driftAccord = function (rng, base) {
  const roll = rng.next();
  let value = base;
  if (roll < 0.05) value = base + 2;
  else if (roll < 0.19) value = base + 1;
  else if (roll < 0.31) value = base - 1;
  else if (roll < 0.35) value = base - 2;
  return Math.max(-2, Math.min(2, value));
};

// Roll the whole table. Called once per world, by the world initializer below.
Game_Factions.prototype.generateDiplomacy = function () {
  const powers = this.getHyperpowers();
  if (!powers.length) return null;

  const table = { version: 1, powers: {}, factions: {} };

  powers.forEach((hp) => { table.powers[hp.id] = {}; });
  powers.forEach((a, i) => {
    powers.slice(i + 1).forEach((b) => {
      const rng = this._accordRng("accord:" + a.id + ":" + b.id);
      const value = this._rollAccord(rng);
      table.powers[a.id][b.id] = value;
      table.powers[b.id][a.id] = value;
    });
  });

  this.getAllFactions().forEach((faction) => {
    if (!faction) return;
    const rng = this._accordRng("accord:faction:" + faction.id);
    const parentPower = this.hyperpowerOfFaction(faction);
    const parent = parentPower ? parentPower.id : undefined;
    const row = {};
    powers.forEach((hp) => {
      if (parent !== undefined && hp.id === parent) {
        // Its own power: a branch is loyal by default, and only rarely not.
        row[hp.id] = rng.next() < 0.15 ? this._driftAccord(rng, 1) : 2;
        return;
      }
      const base = parent !== undefined ? (table.powers[parent] || {})[hp.id] : undefined;
      row[hp.id] = base === undefined ? this._rollAccord(rng) : this._driftAccord(rng, base);
    });
    table.factions[faction.id] = row;
  });

  return table;
};

// The world's table, rolled on first ask if the world predates this system.
Game_Factions.prototype.diplomacy = function () {
  if (typeof $gameSystem === "undefined" || !$gameSystem) return null;
  let table = $gameSystem._factionDiplomacy;
  if (table && table.powers) return table;
  table = this.generateDiplomacy();
  if (table) $gameSystem._factionDiplomacy = table;
  return table;
};

Game_Factions.prototype.getPowerAccord = function (hyperpowerIdA, hyperpowerIdB) {
  if (hyperpowerIdA === hyperpowerIdB) return 2;
  const table = this.diplomacy();
  const row = table && table.powers ? table.powers[hyperpowerIdA] : null;
  const value = row ? row[hyperpowerIdB] : undefined;
  return value === undefined ? 0 : value;
};

// What one faction has signed with one power. A faction that speaks for a power
// answers with that power's own line, so the head and the power never disagree.
Game_Factions.prototype.getFactionAccord = function (factionId, hyperpowerId) {
  const faction = this.getFaction(factionId);
  if (!faction) return 0;
  const table = this.diplomacy();
  const row = table && table.factions ? table.factions[factionId] : null;
  const value = row ? row[hyperpowerId] : undefined;
  if (value !== undefined) return value;
  // No row: fall back to whatever its power signed, and to nothing at all for
  // an independent.
  const parentPower = this.hyperpowerOfFaction(faction);
  if (parentPower) return this.getPowerAccord(parentPower.id, hyperpowerId);
  return 0;
};

// Every accord one list entry holds, one per hyperpower, in the powers' own
// order. A power is not listed against itself; a BRANCH is listed against its
// own parent, because that line is the interesting one — a branch that has
// drifted off its government's row can be reading it as hostile.
Game_Factions.prototype.getAccordsFor = function (record) {
  if (!record) return [];
  const isPower = record.kind === "hyperpower";
  if (!isPower && !record.faction) return [];

  return this.getHyperpowers()
    .filter((hp) => !isPower || hp.id !== record.hyperpower.id)
    .map((hp) => {
      const value = isPower
        ? this.getPowerAccord(record.hyperpower.id, hp.id)
        : this.getFactionAccord(record.faction.id, hp.id);
      return {
        hyperpower: hp,
        name: this.hyperpowerLabel(hp),
        value: value,
        isOwnPower: !isPower && record.faction.parentHyperpower === hp.name,
      };
    });
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
  return this.relationshipNameOf(this.getRelationship(factionId1, factionId2));
};

// The same five words, read off a bare -2..2 value: the diplomatic accords are
// scored on that scale too and name themselves through here.
Game_Factions.prototype.relationshipNameOf = function (relationship) {
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

// Factions are found by their own `id`, never by their slot in the file: the
// heads that used to sit in Factions.json are gone and the ids that are left
// have gaps in them (js/db/WorldGen/Factions.json).
Game_Factions.prototype.getFaction = function (factionId) {
  const id = Number(factionId);
  if (!Number.isFinite(id)) return null;
  const all = FactionDataManager.instance._factions || [];
  return all.find((f) => f && f.id === id) || null;
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
  // Whose standings the page shows. Opens on whoever the menu was last on.
  const members = this.switchableMembers();
  const menuActor = (window.$gameParty && $gameParty.menuActor) ? $gameParty.menuActor() : null;
  this._repActorIndex = Math.max(0, members.indexOf(menuActor));

  // The shared search + filter strip (UI/MenuSearchBar.js), sitting under the
  // title as it does in every other list menu. A faction has a name and
  // nothing else worth ordering on, and since the list is a tree the ordering
  // runs A-Z WITHIN it rather than across it, which is what the tag is named
  // after (see getFactionList).
  this._factionBar = window.MenuSearchBar ? window.MenuSearchBar.create({
    id: 'factions',
    placeholder: T('Factions.searchPlaceholder'),
    sorts: ['name'],
    sortLabels: { name: T('Factions.sortName') },
    onChange: () => {
      this._dndSelectedIndex = 0;
      this.refreshUIFactions();
      if (this._factionBar) this._factionBar.restoreFocus();
    }
  }) : null;

  this.createUIFactionsOverlay();
  if (window.CharSwitcher) {
    window.CharSwitcher.installTabKey(this, (dir) => this.cycleRepActor(dir));
  }
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
    const box = e.target.closest("#factions-grid, #faction-accords, .right-page");
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

// The name a hyperpower is shown under, resolved once for both pages
// (Game_Factions.hyperpowerLabel).
Scene_FactionStatus.prototype.hyperpowerLabel = function (hp) {
  return $gameFactions.hyperpowerLabel(hp);
};

// The tree the lore describes: a hyperpower, then the factions that answer to
// it, then the independents that answer to nobody.
//
// `parentHyperpower` in Factions.json names the power a faction answers to, and
// no faction speaks for a power: a power's row IS the power, read through its
// own "hp:<id>" standing key, wearing the emblem of the first branch under it.
// A faction with no `parentHyperpower` is an orphan: still listed, still with a
// standing of its own, but sworn to nobody and seated nowhere.
Scene_FactionStatus.prototype.getFactionList = function () {
  // The tree, built branch by branch. A top-level row carries its own children
  // rather than the whole thing being flattened up front, so the ordering
  // below can never move a sub-faction out from under its power.
  const groups = [];

  $gameFactions.getHyperpowers().forEach((hp) => {
    const power = {
      kind: "hyperpower",
      isSub: false,
      hyperpower: hp,
      faction: null,
      standingKey: $gameFactions.hyperpowerStandingKey(hp.id),
      name: this.hyperpowerLabel(hp),
      iconIndex: $gameFactions.hyperpowerIcon(hp.id),
      children: [],
    };
    power.children = $gameFactions.getHyperpowerFactions(hp.id)
      .map((child) => ({
        kind: "faction",
        isSub: true,
        faction: child,
        hyperpower: hp,
        standingKey: String(child.id),
        name: FactionDataManager.instance.t(child.name),
        iconIndex: child.iconIndex,
      }));
    groups.push(power);
  });

  $gameFactions.getIndependentFactions().forEach((faction) => {
    groups.push({
      kind: "faction",
      isSub: false,
      faction: faction,
      standingKey: String(faction.id),
      name: FactionDataManager.instance.t(faction.name),
      iconIndex: faction.iconIndex,
      children: [],
    });
  });

  const flatten = (rows) => rows.reduce((out, row) => out.concat([row], row.children || []), []);
  if (!this._factionBar) return flatten(groups);

  // The search strip filters and orders a FLAT list, and handing it the
  // flattened tree is what tore every sub-faction away from its power: an A-Z
  // pass interleaved Britannia's divisions with the Vatican's orders and left
  // each one sitting under whichever unrelated power happened to land above
  // it. So the strip's answer is read as a RANK and re-applied within the
  // tree: powers ordered against powers, children only against their own
  // siblings. A power whose own name misses the query still stands as the
  // header for children that match it, so a hit is never shown parentless.
  const rank = new Map();
  this._factionBar
    .apply(flatten(groups), (row) => ({ name: row.name }))
    .forEach((row, i) => rank.set(row, i));

  const rankOf = (row) => (rank.has(row) ? rank.get(row) : Infinity);
  // A power stands where its OWN name puts it. Only a power the query filtered
  // out — kept solely as the header of children that matched — is slotted by
  // the first of those children instead.
  const groupRank = (group) =>
    rank.has(group)
      ? rank.get(group)
      : (group.children || []).reduce((best, child) => Math.min(best, rankOf(child)), Infinity);

  const list = [];
  groups
    .map((group) => ({
      group,
      kids: (group.children || []).filter((child) => rank.has(child))
        .sort((a, b) => rankOf(a) - rankOf(b)),
    }))
    .filter((entry) => rank.has(entry.group) || entry.kids.length)
    .sort((a, b) => groupRank(a.group) - groupRank(b.group))
    .forEach((entry) => {
      list.push(entry.group);
      entry.kids.forEach((child) => list.push(child));
    });

  return list;
};

// Whose standings the page is showing. The switcher lives on the right page,
// as it does in every other book spread.
Scene_FactionStatus.prototype.switchableMembers = function () {
  return (window.$gameParty && $gameParty.members) ? $gameParty.members().filter((m) => !!m) : [];
};

Scene_FactionStatus.prototype.viewedActor = function () {
  const members = this.switchableMembers();
  if (!members.length) return null;
  const idx = Math.max(0, Math.min(members.length - 1, this._repActorIndex || 0));
  return members[idx];
};

Scene_FactionStatus.prototype.switchRepActor = function (index) {
  const members = this.switchableMembers();
  if (index < 0 || index >= members.length || index === this._repActorIndex) return;
  SoundManager.playCursor();
  this._repActorIndex = index;
  this.refreshUIFactions();
};

Scene_FactionStatus.prototype.cycleRepActor = function (dir) {
  const members = this.switchableMembers();
  if (members.length <= 1) return;
  const next = ((this._repActorIndex || 0) + dir + members.length) % members.length;
  this.switchRepActor(next);
};

Scene_FactionStatus.prototype.refreshUIFactions = function () {
  if (!this._dndContainer) return;

  const factionList = this.getFactionList();

  if (this._dndSelectedIndex >= factionList.length) {
    this._dndSelectedIndex = Math.max(0, factionList.length - 1);
  }

  const selectedRecord = factionList[this._dndSelectedIndex] || null;
  // Standings are read for one character at a time: the world's opinion plus
  // that traveller's own. See Game_Factions.getReputationFor.
  const viewed = this.viewedActor();

  // Generate Left Page: Faction Politics Spread. The rows themselves are filled
  // in by the windowed list further down (UI/MenuVirtualList.js): reading one
  // standing costs a lookup per row, and only the rows on the page are worth
  // paying for.
  const factionRowHTML = (item, idx) => {
    if (!item) return "";
    const isFocused = this._dndSelectedIndex === idx ? "selected" : "";
    const isSub = item.isSub ? "faction-sub" : "";
    const subMarker = item.isSub ? `<span class="faction-sub-marker">⤍</span>` : "";

    const reputation = $gameFactions.getReputationFor(viewed, item.standingKey);
    const reputationLevel = $gameFactions.reputationLevelOf(reputation);
    const reputationColor = $gameFactions.reputationColorOf(reputation);

    return `
      <div class="faction-row ${isFocused} ${isSub}" onclick="SceneManager._scene.selectUIFaction(${idx})">
        ${subMarker}
        ${!item.isSub && item.iconIndex ? `
          <div class="faction-icon-frame">
            <canvas id="fac-canvas-${idx}" width="32" height="32" style="width:24px; height:24px"></canvas>
          </div>
        ` : ""}
        <div class="faction-info">
          <span class="faction-name">${item.name}</span>
        </div>
        <span class="faction-rep-badge" style="color: ${reputationColor}">${reputationLevel} (${reputation})</span>
      </div>
    `;
  };

  const backBtnText = T("Factions.back");
  const factionsTitle = T("Factions.title");

  const leftPageHTML = `
    <div class="left-page">
      <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%">
        <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position: absolute; font-family: 'Lora', serif; font-size: 0.96rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); display: inline-flex; height: fit-content">
          ${backBtnText}
        </div>
        <h2 class="title" style="border: none; margin: 0; padding: 0">${factionsTitle}</h2>
      </div>
      ${this._factionBar ? this._factionBar.html() : ""}
      <div class="backpack-grid" style="display:flex; flex-direction:column; flex: 1 1 auto; min-height: 0" id="factions-grid"></div>
    </div>
  `;

  // Determine left page key to see if left page needs full render.
  // The badges are per character, so a change of character is a full redraw.
  const leftPageKey = `${factionList.length}:${viewed ? viewed.actorId() : 0}:` +
    (this._factionBar ? this._factionBar.query + this._factionBar.sortDir : '');
  const leftPageContainer = this._dndContainer.querySelector(".left-page");

  // The character switcher belongs at the top of the RIGHT page, right
  // aligned, as it does in every other book spread in the game.
  const members = this.switchableMembers();
  let switcherHTML = "";
  if (members.length > 1 && window.CharSwitcher) {
    const tabs = members.map((m, i) => {
      const sel = (this._repActorIndex || 0) === i ? "selected" : "";
      return `<div class="companion-tab ${sel}" onclick="SceneManager._scene.switchRepActor(${i})">${m.name()}</div>`;
    }).join("");
    switcherHTML = `<div class="companion-switcher" style="flex:0 0 auto; justify-content:flex-end; min-height:26px; margin-bottom:8px">` +
      window.CharSwitcher.inner(`<div class="companion-tabs-row">${tabs}</div>`, members.length) +
      `</div>`;
  }

  // Generate Right Page: Political Heraldry Codicil
  let rightPageHTML = "";

  if (!selectedRecord) {
    rightPageHTML = `
      <div class="right-page">
        ${switcherHTML}
        <div class="faction-heraldry-card" style="justify-content: center; text-align: center; padding: 40px 10px">
          <div style="font-size: 3.85em; margin-bottom: 20px"></div>
          <h3 class="title" style="border:none; margin-bottom: 10px">${T("Factions.selectTitle")}</h3>
          <p style="font-family: 'Lora', serif; line-height: 1.6; color: #6b5242">
            ${T("Factions.selectHint")}
          </p>
        </div>
      </div>
    `;
  } else {
    // A hyperpower's dossier is read off its head faction where it has one, so
    // an entry with no faction of its own still has a description to show.
    const faction = selectedRecord.faction;
    const isPower = selectedRecord.kind === "hyperpower";
    const hp = selectedRecord.hyperpower;
    const factionName = selectedRecord.name;
    const description = faction
      ? FactionDataManager.instance.t(faction.description)
      : T("Factions.noDossier");

    // Who speaks for it. A hyperpower answers with its own roster, including
    // the second track (holy_leaders) where the power keeps one.
    const leaderSource = isPower
      ? [].concat(hp.data.leaders || [], hp.data.holy_leaders || [])
      : (faction && faction.leaders) || [];
    let leadersHTML = "";
    if (leaderSource.length > 0) {
      const leaderNames = leaderSource.slice(0, 8).map(l => {
        if (l && l.name) return FactionDataManager.instance.t(l.name);
        return FactionDataManager.instance.t(l);
      }).join(", ");
      leadersHTML = `
        <div style="margin-top: 15px; font-family: 'Lora', serif; font-size: 0.928em; border-top: 1px solid #c9b4a1; padding-top: 10px">
          <strong>${T("Factions.councilLeaders")}</strong> <span>${leaderNames}</span>
        </div>
      `;
    }

    // The two offices a power holds: who governs it, and who it answers to.
    // The moral guide is drawn from a fixed set (Leaders.json `moralGuide`) and
    // succeeds by that power's own rule — a crown by descent, a papacy by
    // conclave, the Archive's by seniority (HistorySimulator).
    let officesHTML = "";
    if (isPower && window.HistoryManager) {
      const HM = window.HistoryManager;
      const moral = HM.getMoralGuide ? HM.getMoralGuide(hp.name) : null;
      const political = (HM.getCurrentLeaders ? HM.getCurrentLeaders() : HM._currentLeaders || {})[hp.name] || null;
      const row = (labelKey, leader) => leader ? `
        <div style="display:flex; justify-content:space-between; font-family:'Lora', serif; font-size:0.928em">
          <span><strong>${T(labelKey)}</strong></span>
          <span>${FactionDataManager.instance.t(leader.name)}</span>
        </div>` : "";
      const both = row("Factions.moralGuide", moral) + row("Factions.politicalLeader", political);
      if (both) {
        officesHTML = `<div style="margin-top:12px; border-top:1px solid #c9b4a1; padding-top:10px">${both}</div>`;
      }
    }

    // The present day, where the roster above is the past: whichever real
    // political party (or, since not everyone answers to one, independent
    // politician) NPCPolitics currently has sitting in this hyperpower's own
    // seat of power. Only hyperpowers NPCPolitics actually simulates have
    // this (Mages Guild, Free States of Midwest and a few others are lore
    // only, so `live` is null for them and nothing is shown).
    let currentGovHTML = "";
    if (isPower && window.NPCPolitics) {
      const live = window.NPCPolitics.getPower(hp.name);
      if (live) {
        const head = live.politicians?.[live.headId];
        const rulingParty = live.parties?.find(p => p.id === live.rulingPartyId);
        const partyLine = rulingParty ? FactionDataManager.instance.t(rulingParty.name) : T("Factions.independentParty");
        currentGovHTML = `
          <div style="margin-top: 15px; font-family: 'Lora', serif; font-size: 0.928em; border-top: 1px solid #c9b4a1; padding-top: 10px">
            <strong>${T("Factions.currentGovernment")}</strong>
            ${head ? `<span>${FactionDataManager.instance.t(head.name)}</span> (${window.NPCPolitics.powerLabel(live, "headTitle")}), ` : ""}${T("Factions.rulingPartyLine", { party: partyLine })}
          </div>
        `;
      }
    }

    // The branches that answer to this power, so the tree is readable from the
    // dossier as well as from the list.
    let branchesHTML = "";
    if (isPower) {
      const branches = $gameFactions.getHyperpowerFactions(hp.id);
      if (branches.length) {
        branchesHTML = `
          <div style="margin-top: 12px; font-family: 'Lora', serif; font-size: 0.928em">
            <strong>${T("Factions.branches")}</strong> <span>${branches.map(b => FactionDataManager.instance.t(b.name)).join(", ")}</span>
          </div>
        `;
      }
    }

    // What it actually holds. The world simulation's map wins (a century of
    // conquests moves nations between powers); the country table answers for a
    // world whose history was never run.
    let countriesHTML = "";
    if (isPower) {
      const held = $gameFactions.countriesOfHyperpower(hp.name);
      countriesHTML = `
        <div style="margin-top: 12px; font-family: 'Lora', serif; font-size: 0.928em">
          <strong>${T("Factions.controlledCountries", { count: held.length })}</strong>
          <span>${held.length
            ? held.map(n => (window.WorldNames ? window.WorldNames.any(n) : n)).join(", ")
            : T("Factions.holdsNothing")}</span>
        </div>
      `;
    }

    // ...and the long version of the same dossier, in the Archive's own wiki.
    let wikiHTML = "";
    if (isPower && window.NPCEmpathize && typeof window.NPCEmpathize.openEntity === "function") {
      const target = encodeURIComponent(hp.name).replace(/'/g, "%27");
      wikiHTML = `
        <div class="faction-wiki-button focusable"
             onclick="window.NPCEmpathize.openEntity('power', '${target}')">
          ${T("Factions.openWiki")}
        </div>
      `;
    }

    // This character's standing, named as well as numbered.
    const rep = $gameFactions.getReputationFor(viewed, selectedRecord.standingKey);
    const standingHTML = viewed ? `
      <div style="display:flex; justify-content:space-between; margin-top:12px; font-family:'Lora', serif; font-size:0.928em; border-top:1px solid #c9b4a1; padding-top:10px">
        <span>${T("Factions.standingOf", { name: viewed.name() })}</span>
        <span style="color:${$gameFactions.reputationColorOf(rep)}; font-weight:bold">${$gameFactions.reputationLevelOf(rep)} (${rep})</span>
      </div>
    ` : "";

    // A seat at the assembly, when the plugin that hands them out is loaded.
    let postHTML = "";
    if (viewed && window.ONUAssembly && typeof window.ONUAssembly.postLabelFor === "function") {
      const label = window.ONUAssembly.postLabelFor(viewed, selectedRecord.standingKey);
      if (label) {
        postHTML = `<div style="margin-top:8px; font-family:'Lora', serif; font-size:0.928em; color:#2e7d32">${label}</div>`;
      }
    }

    // Where this entry stands with every hyperpower in the world, not with the
    // first three independents that happened to be listed. A branch keeps its
    // own accords, so it can be reading them off a different line from its
    // parent's (Game_Factions.getAccordsFor).
    const relationsHTML = $gameFactions.getAccordsFor(selectedRecord).map(accord => {
      let relColor = "#6b5242"; // Neutral
      if (accord.value > 0) relColor = "#2e7d32"; // Allied/Friendly
      if (accord.value < 0) relColor = "#c62828"; // Hostile
      return `
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-family: 'Lora', serif; font-size: 0.928em; border-bottom: 1px dashed #d1c2b4; padding-bottom: 2px">
          <span>${T(accord.isOwnPower ? "Factions.versusOwn" : "Factions.versus", { name: accord.name })}</span>
          <span style="color: ${relColor}; font-weight: bold">${$gameFactions.relationshipNameOf(accord.value)}</span>
        </div>
      `;
    }).join("");

    rightPageHTML = `
      <div class="right-page">
        ${switcherHTML}
        <div class="faction-heraldry-card">
          <div class="heraldry-emblem-box">
            <canvas id="heraldry-canvas" width="32" height="32" style="width:36px; height:36px; image-rendering: pixelated"></canvas>
          </div>

          <div class="heraldry-header">
            <h3 class="heraldry-title">${factionName}</h3>
          </div>

          <div class="inspect-lore" style="flex-grow: 1; max-height: 180px; padding-right:5px; margin-bottom: 15px">
            ${description}
          </div>

          ${officesHTML}
          ${currentGovHTML}
          ${leadersHTML}
          ${branchesHTML}
          ${countriesHTML}
          ${wikiHTML}
          ${standingHTML}
          ${postHTML}

          <div class="politics-grid">
            <h4 style="font-family: 'Lora', serif; font-size: 1.095em; color: #58180D; margin: 0 0 8px 0; border-bottom: 1px solid #d1c2b4; padding-bottom: 4px">${T("Factions.diplomaticAgreements")}</h4>
            <div class="faction-accords" id="faction-accords">
              ${relationsHTML || `<div style="font-family:'Lora', serif; font-size:0.928em; color:#8c715c">${T("Factions.independent")}</div>`}
            </div>
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
  } else {
    // Left page already drawn! Update only the right page in-place (the rows
    // themselves are repainted with the window below).
    const rightPageContainer = this._dndContainer.querySelector(".right-page");
    if (rightPageContainer) {
      rightPageContainer.outerHTML = rightPageHTML;
    }
  }

  // The roll of factions, windowed, with each visible row's emblem drawn as it
  // comes on screen (UI/MenuVirtualList.js).
  const grid = this._dndContainer.querySelector("#factions-grid");
  if (grid) {
    window.MenuVirtualList.render(grid, {
      key: leftPageKey,
      count: factionList.length,
      renderItem: (idx) => factionRowHTML(factionList[idx], idx),
      onWindow: (win, from, to) => {
        for (let idx = from; idx < to; idx++) {
          const item = factionList[idx];
          if (item && !item.isSub && item.iconIndex) {
            this.drawUIFactionEmblem(item.iconIndex, `fac-canvas-${idx}`);
          }
        }
      }
    });
    // Scroll active item into view, by index: the row is only in the DOM once
    // the window reaches it.
    window.MenuVirtualList.scrollToIndex(grid, this._dndSelectedIndex);
  }

  if (selectedRecord && selectedRecord.iconIndex) {
    this.drawUIFactionEmblem(selectedRecord.iconIndex, "heraldry-canvas");
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
  // A focused search field owns the keyboard (UI/MenuSearchBar.js).
  if (window.MenuSearchBar && window.MenuSearchBar.isTyping()) return;
  UIFactionsInputManager.update();
};

const _Scene_FactionStatus_terminate = Scene_FactionStatus.prototype.terminate;
Scene_FactionStatus.prototype.terminate = function () {
  _Scene_FactionStatus_terminate.call(this);
  if (this._factionBar) { this._factionBar.dispose(); this._factionBar = null; }
  UIFactionsInputManager.deactivate();
  if (window.CharSwitcher) window.CharSwitcher.removeTabKey(this);
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

    if (Input.isTriggered('pagedown')) {
      this._scene.cycleRepActor(1);
    } else if (Input.isTriggered('pageup')) {
      this._scene.cycleRepActor(-1);
    } else if (Input.isTriggered('down')) {
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
      // Five hyperpowers have no faction of their own, so there is no id to
      // hand back: a caller asking for a faction cannot be given one of those.
      if (!entry || !entry.faction) {
        SoundManager.playBuzzer();
        return;
      }
      SoundManager.playOk();
      if (scene._onConfirm) {
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



// The canvas fallback list groups the same way the DOM spread does: by
// hyperpower, which each faction names in `parentHyperpower`. No faction stands
// in for a power any more, so a power's row is the power itself.
Window_FactionStatus.prototype.makeItemList = function () {

  this._data = [];

  $gameFactions.getHyperpowers().forEach((hp) => {

    $gameFactions.getHyperpowerFactions(hp.id).forEach((child) => {

      this._data.push({ faction: child, isSub: true });

    });

  });

  $gameFactions.getIndependentFactions().forEach((faction) => {

    this._data.push({ faction: faction, isSub: false });

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

