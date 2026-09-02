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
 *
 * The party's own faction:
 *   $gameFactions.hasPlayerFaction() - Has this world a banner of its own?
 *   $gameFactions.foundPlayerFaction(name) - Raise it, once per world. An
 *     empty name takes a procedurally rolled one.
 *   $gameFactions.swearPlayerFactionTo(hyperpowerId) - Swear it to a power, or
 *     null to renounce and stand alone again.
 *   $gameFactions.playerFactionRoster() - {party, army, total}
 *   SceneManager.push(Scene_PlayerFaction) - Open its management screen
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

// The register is built as markup, and since the party names its own faction
// and its own characters, anything read back out of those is written through
// here rather than straight into innerHTML.
FRS.escapeText = (text) => String(text == null ? "" : text)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

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
  return this.reputationColorOf(this.getReputation(factionId));
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
// Standing, made good on
//=============================================================================
//
// getReputationPerks above has always promised the player a 10, 25 and 40 per
// cent discount, services withdrawn at -20 and a hall that will not deal with
// them at all at -40. Nothing implemented any of it: reputation was moved from
// 44 places and asked from six, four of which only drew it. These are the
// numbers that list is describing, defined once so a counter, a courier and an
// employer all quote the same standing.
//
// Which faction is owed the courtesy is a question of WHERE the party is: the
// power that holds the country they are standing in, and the first faction that
// answers to it. A place no power holds (the sea, a procedural nowhere, a world
// whose history was never run) has nobody to be in favour with, and everything
// below falls back to neutral.
const STANDING_DISCOUNTS = [[80, 0.40], [60, 0.25], [40, 0.10]];
// Being disliked is not a discount in reverse: a hall that would rather not
// serve you charges for the trouble before it stops serving you.
const STANDING_SURCHARGES = [[-60, 0.35], [-40, 0.20], [-20, 0.08]];
// At and below this, "refuse to interact" in the perk list is literal.
const STANDING_REFUSAL = -40;

Game_Factions.prototype.hyperpowerHoldingCountry = function (country) {
  if (!country) return null;
  const name = String(country);
  for (const hp of this.getHyperpowers()) {
    if (hp.data && hp.data.homeNation === name) return hp;
    if (this.countriesOfHyperpower(hp.name).includes(name)) return hp;
  }
  return null;
};

// Where the party is standing, as the weather system knows it: it is the one
// place in the tree that resolves a map to a real country.
Game_Factions.prototype.currentCountryName = function () {
  const cc = (typeof $gameWeather !== "undefined" && $gameWeather)
    ? $gameWeather.currentCountry : null;
  if (!cc) return null;
  return cc.country || cc.name || null;
};

// The faction whose good opinion is worth something here, or null.
Game_Factions.prototype.localFactionId = function () {
  const hp = this.hyperpowerHoldingCountry(this.currentCountryName());
  if (!hp) return null;
  const factions = this.getHyperpowerFactions(hp.id);
  return factions.length ? factions[0].id : null;
};

// The standing that governs a counter here, for this character. Falls back to
// the party leader, since a shop is served by whoever is in front.
Game_Factions.prototype.localStanding = function (actor) {
  const id = this.localFactionId();
  if (id === null) return 0;
  const who = actor || (window.$gameParty && $gameParty.leader ? $gameParty.leader() : null);
  return this.getReputationFor(who, id);
};

// The multiplier a marked price is quoted at. One number, so a discount and a
// surcharge can never both apply and the bands stay where the perk list says.
Game_Factions.prototype.standingPriceMultiplier = function (actor) {
  const rep = this.localStanding(actor);
  for (const [floor, off] of STANDING_DISCOUNTS) if (rep >= floor) return 1 - off;
  for (const [ceil, on] of STANDING_SURCHARGES) if (rep <= ceil) return 1 + on;
  return 1;
};

// Whether the hall will deal with the party at all.
Game_Factions.prototype.standingRefusesService = function (actor) {
  return this.localFactionId() !== null && this.localStanding(actor) <= STANDING_REFUSAL;
};

Game_Factions.prototype.standingRefusalThreshold = function () {
  return STANDING_REFUSAL;
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

// The nine reputation bands, low to high, as the suffix of the class and of
// the --faction-rep-* token that inks it. The ramp itself lives in the themes
// (css/themes/*.css), so the terminal preset can pitch it against black
// instead of being stuck with the parchment preset's greens.
Game_Factions.REP_BANDS = [
  [80, "exalted"], [60, "revered"], [40, "honored"], [20, "friendly"],
  [-20, "neutral"], [-40, "unfriendly"], [-60, "hostile"], [-80, "hated"],
];

Game_Factions.prototype.reputationBandOf = function (reputation) {
  for (const [floor, band] of Game_Factions.REP_BANDS) {
    if (reputation >= floor) return band;
  }
  return "nemesis";
};

// The class a DOM element carries to be inked by the band. Prefer this over
// reputationColorOf everywhere the badge is HTML: it keeps the colour in the
// stylesheet where a preset can reach it.
Game_Factions.prototype.reputationClassOf = function (reputation) {
  return "faction-rep--" + this.reputationBandOf(reputation);
};

// The literal colour of a band, resolved from the theme at call time. Only for
// the canvas windows, which cannot carry a class: Window_Base.changeTextColor
// wants a string.
Game_Factions.prototype.reputationColorOf = function (reputation) {
  const token = "--faction-rep-" + this.reputationBandOf(reputation);
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || "#ffffff";
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
// The party's own faction
//=============================================================================
//
// A party may raise one banner of its own, and only one: founding is a thing
// the world remembers, not the savegame. The record lives on $gameFactions,
// which WorldManager already keeps in the world folder (npcs.json, field
// "factions"), so every savegame of that world walks into the same faction
// with the same roll and the same allegiance.
//
// It is NOT written into the Factions.json array. That array's indices are
// what NPCSociety rolls an NPC's `factionIndex` against, and appending to it
// would both move every existing index and start handing the player's banner
// out to strangers. The screens that list factions ask for this record
// separately instead.

// Well clear of the shipped ids (Factions.json stops at 66), so a standing key
// of its own can never collide with one of theirs.
Game_Factions.PLAYER_FACTION_ID = 900;

// The emblem it flies until there is a way to choose one.
Game_Factions.PLAYER_FACTION_ICON = 84;

Game_Factions.prototype.playerFaction = function () {
  return this._playerFaction || null;
};

Game_Factions.prototype.hasPlayerFaction = function () {
  return !!this._playerFaction;
};

// A name rolled out of the word banks in the language book, so an impatient
// founder never has to type one. Rolled with Math.random rather than the world
// seed: the founder can ask for another until one of them fits.
Game_Factions.prototype.rollPlayerFactionName = function () {
  const pool = (key) => (typeof T.pool === "function" ? T.pool(key) : []);
  const pick = (key) => {
    const bank = pool(key);
    return bank.length ? bank[Math.floor(Math.random() * bank.length)] : "";
  };
  const forms = pool("Factions.player.nameForm");
  const form = forms.length ? forms[Math.floor(Math.random() * forms.length)] : "{adj} {noun}";
  const parts = {
    adj: pick("Factions.player.nameAdj"),
    noun: pick("Factions.player.nameNoun"),
    ward: pick("Factions.player.nameWard"),
  };
  const name = String(form)
    .replace(/\{(\w+)\}/g, (m, k) => parts[k] || "")
    .replace(/\s+/g, " ")
    .trim();
  return name || T("Factions.player.fallbackName");
};

// The one founding. Answers null when this world already has a banner: the
// screens ask hasPlayerFaction() first, and this is the last word on it.
Game_Factions.prototype.foundPlayerFaction = function (name) {
  if (this._playerFaction) return null;
  const typed = String(name == null ? "" : name).trim().slice(0, 48);
  this._playerFaction = {
    id: Game_Factions.PLAYER_FACTION_ID,
    name: typed || this.rollPlayerFactionName(),
    isPlayer: true,
    iconIndex: Game_Factions.PLAYER_FACTION_ICON,
    // The power it has sworn to, by name, so it reads exactly like the
    // `parentHyperpower` every other faction carries. Null is "sworn to
    // nobody", which is where a new banner starts.
    parentHyperpower: null,
    founded: this._todayStamp(),
  };
  return this._playerFaction;
};

Game_Factions.prototype.renamePlayerFaction = function (name) {
  const record = this.playerFaction();
  if (!record) return false;
  const typed = String(name == null ? "" : name).trim().slice(0, 48);
  if (!typed) return false;
  record.name = typed;
  return true;
};

// The day it was raised, in whatever the clock plugin prints. A build without
// the clock simply has no date to show.
Game_Factions.prototype._todayStamp = function () {
  const TDS = window.TimeDateSystem;
  if (TDS && typeof TDS.getDateString === "function") {
    try { return TDS.getDateString(); } catch (e) { /* no clock, no date */ }
  }
  return null;
};

// Swearing to a power. `hyperpowerId` null renounces and stands the banner up
// on its own again.
Game_Factions.prototype.swearPlayerFactionTo = function (hyperpowerId) {
  const record = this.playerFaction();
  if (!record) return false;
  if (hyperpowerId === null || hyperpowerId === undefined) {
    record.parentHyperpower = null;
    return true;
  }
  const hp = this.getHyperpower(Number(hyperpowerId));
  if (!hp) return false;
  record.parentHyperpower = hp.name;
  return true;
};

// The power it answers to, resolved, or null while it stands alone.
Game_Factions.prototype.playerFactionOverlord = function () {
  const record = this.playerFaction();
  if (!record || !record.parentHyperpower) return null;
  return this.getHyperpowers().find((hp) => hp.name === record.parentHyperpower) || null;
};

// Who has joined. Nobody is recruited into it from the outside yet: it is the
// people already sworn to the party, which is the party itself plus every
// soldier the army has hired (Army/ArmyManager.js).
Game_Factions.prototype.playerFactionRoster = function () {
  const party = [];
  const members = (window.$gameParty && $gameParty.allMembers) ? $gameParty.allMembers() : [];
  (members || []).forEach((m) => { if (m) party.push(m.name()); });

  const army = [];
  const troops = (window.$gameArmy && $gameArmy.getTroops) ? $gameArmy.getTroops() : [];
  (troops || []).forEach((t) => {
    if (!t) return;
    const named = FactionDataManager.instance ? FactionDataManager.instance.t(t.name) : String(t.name);
    army.push(named);
  });

  return { party: party, army: army, total: party.length + army.length };
};

// What the banner is worth as a body, for the wiki's stat line. It has no
// centuries behind it, so the numbers are the roll's own: what the party can
// do, and how many of them there are.
Game_Factions.prototype.playerFactionStats = function () {
  const members = (window.$gameParty && $gameParty.members) ? ($gameParty.members() || []) : [];
  const live = members.filter(Boolean);
  const mean = (read) => live.length
    ? Math.round(live.reduce((sum, m) => sum + (Number(read(m)) || 0), 0) / live.length)
    : 0;
  const roster = this.playerFactionRoster();
  return {
    arcane: mean((m) => m.mat || 0),
    velocity: mean((m) => m.agi || 0),
    information: Math.min(400, roster.total * 8),
  };
};

// The accord scale a median standing lands on. Standings run -100..100 and the
// accords run -2..2, so the bands are the reputation bands folded in pairs.
Game_Factions.PLAYER_ACCORD_BANDS = [[60, 2], [20, 1], [-20, 0], [-60, -1]];

// A banner raised this year has signed nothing with anybody, so what it holds
// towards a power is what the people under it hold: the MEDIAN of every party
// member's standing with that power, read on the accord scale. The median and
// not the mean, so one loathed companion cannot drag the whole faction into a
// war and one adored one cannot buy it an alliance.
Game_Factions.prototype.playerAccordValue = function (standingKey) {
  const members = (window.$gameParty && $gameParty.members)
    ? ($gameParty.members() || []).filter(Boolean) : [];
  if (!members.length) return 0;
  const values = members.map((m) => this.getReputationFor(m, standingKey)).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  for (const band of Game_Factions.PLAYER_ACCORD_BANDS) {
    if (median >= band[0]) return band[1];
  }
  return -2;
};

// The list row the faction screen prints it as, shaped exactly like the rows
// getFactionList builds for the shipped factions so every reader downstream
// (the badge, the dossier, the accords) needs no special case beyond the
// `isPlayer` flag itself.
Game_Factions.prototype.playerFactionRecord = function () {
  const record = this.playerFaction();
  if (!record) return null;
  const overlord = this.playerFactionOverlord();
  return {
    kind: "faction",
    isSub: !!overlord,
    isPlayer: true,
    faction: record,
    hyperpower: overlord,
    standingKey: String(record.id),
    name: record.name,
    iconIndex: record.iconIndex,
    children: [],
  };
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
// Most of the row is inherited - a branch that agreed with its government about
// nothing would not still be one of its branches - so roughly a third of the
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
// own parent, because that line is the interesting one - a branch that has
// drifted off its government's row can be reading it as hostile.
Game_Factions.prototype.getAccordsFor = function (record) {
  if (!record) return [];
  const isPower = record.kind === "hyperpower";
  if (!isPower && !record.faction) return [];
  // The party's own banner is not in the rolled table at all: its line with
  // each power is the party's own median standing (playerAccordValue).
  const isPlayer = !isPower && !!record.faction.isPlayer;

  return this.getHyperpowers()
    .filter((hp) => !isPower || hp.id !== record.hyperpower.id)
    .map((hp) => {
      const value = isPower
        ? this.getPowerAccord(record.hyperpower.id, hp.id)
        : isPlayer
          ? this.playerAccordValue(this.hyperpowerStandingKey(hp.id))
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
// The Archive article for the hyperpower the cursor is standing on, the same
// one the page's own button opens. A row that is a faction rather than a power,
// or a build without the Archive, simply has nothing to open.
Scene_FactionStatus.prototype.openHighlightedWiki = function () {
  const list = this.getFactionList();
  const entry = list[this._dndSelectedIndex];
  // The party's own banner answers Confirm with its management screen: that is
  // the useful page, and the Archive article for it says less than this one.
  if (entry && entry.isPlayer) {
    this.openPlayerFaction();
    return;
  }
  const power = entry && entry.kind === "hyperpower" ? entry.hyperpower : null;
  if (!power || !window.NPCEmpathize || typeof window.NPCEmpathize.openEntity !== "function") {
    SoundManager.playBuzzer();
    return;
  }
  SoundManager.playOk();
  window.NPCEmpathize.openEntity("power", power.name);
};

Scene_FactionStatus.prototype.getFactionList = function () {
  // The tree, built branch by branch. A top-level row carries its own children
  // rather than the whole thing being flattened up front, so the ordering
  // below can never move a sub-faction out from under its power.
  const groups = [];

  // The party's own banner, when it has raised one: a branch of the power it
  // swore to, or a group of its own standing among the independents. A
  // register opened to pick a faction for somebody else never lists it, since
  // it has no entry in Factions.json for that caller to look up afterwards.
  const playerRow = this._selectMode ? null : $gameFactions.playerFactionRecord();

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
    // A banner sworn to this power is listed under it like any other branch.
    if (playerRow && playerRow.hyperpower && playerRow.hyperpower.id === hp.id) {
      power.children.push(playerRow);
    }
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

  if (playerRow && !playerRow.hyperpower) groups.push(playerRow);

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
  // out - kept solely as the header of children that matched - is slotted by
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
    const reputationClass = $gameFactions.reputationClassOf(reputation);

    return `
      <div class="faction-row ${isFocused} ${isSub}" onclick="SceneManager._scene.selectUIFaction(${idx})">
        ${subMarker}
        ${!item.isSub && item.iconIndex ? `
          <div class="faction-icon-frame">
            <canvas class="facrep-01" id="fac-canvas-${idx}" width="32" height="32"></canvas>
          </div>
        ` : ""}
        <div class="faction-info">
          <span class="faction-name">${FRS.escapeText(item.name)}</span>
        </div>
        <span class="faction-rep-badge ${reputationClass}">${reputationLevel} (${reputation})</span>
      </div>
    `;
  };

  const backBtnText = T("Factions.back");
  const factionsTitle = T("Factions.title");
  // One banner per world: before it is raised the button founds it, after it
  // is raised the same button opens the room where it is run. A register
  // opened to pick a faction for somebody else does not offer it at all.
  const ownBtnText = $gameFactions.hasPlayerFaction()
    ? T("Factions.player.manageButton")
    : T("Factions.player.formButton");
  const ownBtnHTML = this._selectMode ? "" : `
        <div class="back-button focusable facrep-23" onclick="SceneManager._scene.openPlayerFaction()">
          ${ownBtnText}
        </div>`;

  const leftPageHTML = `
    <div class="left-page">
      <div class="page-header-bar facrep-02">
        <div class="back-button focusable facrep-03" onclick="SceneManager._scene.popScene()">
          ${backBtnText}
        </div>
        <h2 class="title facrep-04">${factionsTitle}</h2>${ownBtnHTML}
      </div>
      ${this._factionBar ? this._factionBar.html() : ""}
      <div class="backpack-grid facrep-05" id="factions-grid"></div>
    </div>
  `;

  // Determine left page key to see if left page needs full render.
  // The badges are per character, so a change of character is a full redraw.
  const ownFaction = $gameFactions.playerFaction();
  const leftPageKey = `${factionList.length}:${viewed ? viewed.actorId() : 0}:` +
    `${ownFaction ? ownFaction.name + "/" + (ownFaction.parentHyperpower || "") : ""}:` +
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
    switcherHTML = `<div class="companion-switcher facrep-06">` +
      window.CharSwitcher.inner(`<div class="companion-tabs-row">${tabs}</div>`, members.length) +
      `</div>`;
  }

  // Generate Right Page: Political Heraldry Codicil
  let rightPageHTML = "";

  if (!selectedRecord) {
    rightPageHTML = `
      <div class="right-page">
        ${switcherHTML}
        <div class="faction-heraldry-card facrep-07">
          <div class="facrep-08"></div>
          <h3 class="title facrep-09">${T("Factions.selectTitle")}</h3>
          <p class="facrep-10">
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
    const factionNameHTML = FRS.escapeText(factionName);
    const isPlayerFaction = !!selectedRecord.isPlayer;
    // The party's banner has no dossier written for it: its own page is the
    // roll it is carrying and the day it was raised.
    const description = isPlayerFaction
      ? T("Factions.player.dossier", { name: factionNameHTML })
      : faction
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
        <div class="facrep-11">
          <strong>${T("Factions.councilLeaders")}</strong> <span>${leaderNames}</span>
        </div>
      `;
    }

    // The two offices a power holds: who governs it, and who it answers to.
    // The moral guide is drawn from a fixed set (Leaders.json `moralGuide`) and
    // succeeds by that power's own rule - a crown by descent, a papacy by
    // conclave, the Archive's by seniority (HistorySimulator).
    let officesHTML = "";
    if (isPower && window.HistoryManager) {
      const HM = window.HistoryManager;
      const moral = HM.getMoralGuide ? HM.getMoralGuide(hp.name) : null;
      // The political office answers with whoever holds it, written down or
      // elected (HistorySimulator.politicalLeaderOf).
      const political = HM.politicalLeaderOf
        ? HM.politicalLeaderOf(hp.name)
        : ((HM.getCurrentLeaders ? HM.getCurrentLeaders() : HM._currentLeaders || {})[hp.name] || null);
      const row = (labelKey, leader) => leader ? `
        <div class="facrep-12">
          <span><strong>${T(labelKey)}</strong></span>
          <span>${FactionDataManager.instance.t(leader.name)}</span>
        </div>` : "";
      const both = row("Factions.moralGuide", moral) + row("Factions.politicalLeader", political);
      if (both) {
        officesHTML = `<div class="facrep-13">${both}</div>`;
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
          <div class="facrep-11">
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
          <div class="facrep-14">
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
        <div class="facrep-14">
          <strong>${T("Factions.controlledCountries", { count: held.length })}</strong>
          <span>${held.length
            ? held.map(n => (window.WorldNames ? window.WorldNames.any(n) : n)).join(", ")
            : T("Factions.holdsNothing")}</span>
        </div>
      `;
    }

    // What the party's own banner holds: who has joined it, who it answers to,
    // and the way back into the screen where both are changed.
    let ownFactionHTML = "";
    if (isPlayerFaction) {
      const roster = $gameFactions.playerFactionRoster();
      const overlord = $gameFactions.playerFactionOverlord();
      const rows = [
        `<div class="facrep-12"><span><strong>${T("Factions.player.membersLbl")}</strong></span>` +
        `<span>${T("Factions.player.membersLine", {
          total: roster.total, party: roster.party.length, army: roster.army.length,
        })}</span></div>`,
        `<div class="facrep-12"><span><strong>${T("Factions.player.allegianceLbl")}</strong></span>` +
        `<span>${overlord ? this.hyperpowerLabel(overlord) : T("Factions.player.noOverlord")}</span></div>`,
      ];
      if (faction.founded) {
        rows.push(`<div class="facrep-12"><span><strong>${T("Factions.player.foundedLbl")}</strong></span>` +
          `<span>${FRS.escapeText(faction.founded)}</span></div>`);
      }
      ownFactionHTML = `<div class="facrep-13">${rows.join("")}</div>
        <div class="faction-wiki-button focusable facrep-24"
             onclick="SceneManager._scene.openPlayerFaction()">
          ${T("Factions.player.manageButton")}
        </div>`;
    }

    // ...and the long version of the same dossier, in the Archive's own wiki.
    let wikiHTML = "";
    if ((isPower || isPlayerFaction) && window.NPCEmpathize
      && typeof window.NPCEmpathize.openEntity === "function") {
      const kind = isPower ? "power" : "faction";
      const target = encodeURIComponent(isPower ? hp.name : factionName).replace(/'/g, "%27");
      wikiHTML = `
        <div class="faction-wiki-button focusable"
             onclick="window.NPCEmpathize.openEntity('${kind}', '${target}')">
          ${T("Factions.openWiki")}
        </div>
      `;
    }

    // This character's standing, named as well as numbered.
    const rep = $gameFactions.getReputationFor(viewed, selectedRecord.standingKey);
    const standingHTML = viewed ? `
      <div class="facrep-15">
        <span>${T("Factions.standingOf", { name: viewed.name() })}</span>
        <span class="facrep-16 ${$gameFactions.reputationClassOf(rep)}">${$gameFactions.reputationLevelOf(rep)} (${rep})</span>
      </div>
    ` : "";

    // A seat at the assembly, when the plugin that hands them out is loaded.
    let postHTML = "";
    if (viewed && window.ONUAssembly && typeof window.ONUAssembly.postLabelFor === "function") {
      const label = window.ONUAssembly.postLabelFor(viewed, selectedRecord.standingKey);
      if (label) {
        postHTML = `<div class="facrep-17">${label}</div>`;
      }
    }

    // Where this entry stands with every hyperpower in the world, not with the
    // first three independents that happened to be listed. A branch keeps its
    // own accords, so it can be reading them off a different line from its
    // parent's (Game_Factions.getAccordsFor).
    const relationsHTML = $gameFactions.getAccordsFor(selectedRecord).map(accord => {
      const relClass = accord.value > 0 ? "faction-accord--allied"
        : accord.value < 0 ? "faction-accord--hostile"
        : "faction-accord--neutral";
      return `
        <div class="facrep-18">
          <span>${T(accord.isOwnPower ? "Factions.versusOwn" : "Factions.versus", { name: accord.name })}</span>
          <span class="facrep-16 ${relClass}">${$gameFactions.relationshipNameOf(accord.value)}</span>
        </div>
      `;
    }).join("");

    rightPageHTML = `
      <div class="right-page">
        ${switcherHTML}
        <div class="faction-heraldry-card">
          <div class="heraldry-emblem-box">
            <canvas class="facrep-19" id="heraldry-canvas" width="32" height="32"></canvas>
          </div>

          <div class="heraldry-header">
            <h3 class="heraldry-title">${factionNameHTML}</h3>
          </div>

          <div class="inspect-lore facrep-20">
            ${description}
          </div>

          ${officesHTML}
          ${currentGovHTML}
          ${leadersHTML}
          ${branchesHTML}
          ${countriesHTML}
          ${ownFactionHTML}
          ${wikiHTML}
          ${standingHTML}
          ${postHTML}

          <div class="politics-grid">
            <h4 class="facrep-21">${T("Factions.diplomaticAgreements")}</h4>
            <div class="faction-accords" id="faction-accords">
              ${relationsHTML || `<div class="facrep-22">${T("Factions.independent")}</div>`}
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
  // The founding panel is modal: while it is up the register neither moves its
  // cursor nor answers Cancel by leaving.
  if (this._foundPanel) return;
  // A focused search field owns the keyboard (UI/MenuSearchBar.js).
  if (window.MenuSearchBar && window.MenuSearchBar.isTyping()) return;
  UIFactionsInputManager.update();
};

const _Scene_FactionStatus_terminate = Scene_FactionStatus.prototype.terminate;
Scene_FactionStatus.prototype.terminate = function () {
  _Scene_FactionStatus_terminate.call(this);
  if (this._foundPanel) {
    if (this._foundPanel.parentNode) this._foundPanel.parentNode.removeChild(this._foundPanel);
    this._foundPanel = null;
  }
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
    } else if (Input.isTriggered('shift')) {
      // The page's own banner button, for a hand that never touches the mouse:
      // before a faction is founded there is no row to press Confirm on.
      if (!this._scene._selectMode) this._scene.openPlayerFaction();
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
      // Nor can it be given the party's own banner, which is world state and
      // has no entry in Factions.json for the caller to look up afterwards.
      if (!entry || !entry.faction || entry.isPlayer) {
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
    // Not picking a faction for somebody else: Confirm opens the long dossier
    // in the Archive, which is what the button on the page does. It was the one
    // control on this screen a cursor could not reach - the list walks with the
    // stick, but the wiki was a click and nothing else.
    scene.openHighlightedWiki();
  },

  handleCancel: function () {
    SoundManager.playCancel();
    this._scene.popScene();
  }
};

//=============================================================================
// Founding a faction of your own
//=============================================================================
//
// The register's own button. One banner per world: before it is raised this
// opens the founding panel, after it is raised it opens the room where the
// faction is run (Scene_PlayerFaction).

Scene_FactionStatus.prototype.openPlayerFaction = function () {
  if ($gameFactions.hasPlayerFaction()) {
    SoundManager.playOk();
    SceneManager.push(Scene_PlayerFaction);
    return;
  }
  this.openFoundingPanel();
};

// The panel is a sibling of the book rather than a child of it: the spread is
// re-rendered whole on every cursor move, and a field being typed into cannot
// survive that.
Scene_FactionStatus.prototype.openFoundingPanel = function () {
  if (this._foundPanel) return;
  SoundManager.playOk();

  const panel = document.createElement("div");
  panel.className = "facrep-25";
  panel.innerHTML = `
    <div class="facrep-26">
      <h3 class="title facrep-09">${T("Factions.player.foundTitle")}</h3>
      <p class="facrep-10">${T("Factions.player.foundHint")}</p>
      <input class="facrep-27" type="text" maxlength="48"
             aria-label="${T("Factions.player.nameLbl")}">
      <div class="facrep-28">
        <div class="back-button focusable facrep-03"
             onclick="SceneManager._scene.rerollFactionName()">${T("Factions.player.reroll")}</div>
        <div class="back-button focusable facrep-03"
             onclick="SceneManager._scene.confirmFounding()">${T("Factions.player.confirm")}</div>
        <div class="back-button focusable facrep-03"
             onclick="SceneManager._scene.closeFoundingPanel()">${T("Factions.player.cancel")}</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  this._foundPanel = panel;

  const field = panel.querySelector("input");
  // Set through the property, never through the markup: a rolled name is
  // prose and has no business being pasted into an attribute.
  field.value = $gameFactions.rollPlayerFactionName();
  // A focused field owns the keyboard. RPG Maker listens on the document, so
  // every key has to be stopped at the element or the game reads it too.
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") this.confirmFounding();
    else if (e.key === "Escape") this.closeFoundingPanel();
  });
  field.addEventListener("keyup", (e) => e.stopPropagation());
  field.addEventListener("keypress", (e) => e.stopPropagation());
  field.focus();
  field.select();
};

Scene_FactionStatus.prototype.rerollFactionName = function () {
  if (!this._foundPanel) return;
  SoundManager.playCursor();
  const field = this._foundPanel.querySelector("input");
  if (!field) return;
  field.value = $gameFactions.rollPlayerFactionName();
  field.focus();
  field.select();
};

Scene_FactionStatus.prototype.closeFoundingPanel = function () {
  if (!this._foundPanel) return;
  SoundManager.playCancel();
  if (this._foundPanel.parentNode) this._foundPanel.parentNode.removeChild(this._foundPanel);
  this._foundPanel = null;
};

Scene_FactionStatus.prototype.confirmFounding = function () {
  if (!this._foundPanel) return;
  const field = this._foundPanel.querySelector("input");
  const typed = field ? field.value : "";
  // Founding is once and for all, and the button should never have offered it
  // a second time: refuse rather than overwrite a banner that already flies.
  if ($gameFactions.hasPlayerFaction()) {
    SoundManager.playBuzzer();
    this.closeFoundingPanel();
    return;
  }
  const record = $gameFactions.foundPlayerFaction(typed);
  SoundManager.playOk();
  if (this._foundPanel.parentNode) this._foundPanel.parentNode.removeChild(this._foundPanel);
  this._foundPanel = null;

  if (window.ParchmentToast) {
    window.ParchmentToast.show(
      T("Factions.player.foundedToast", { name: FRS.escapeText(record.name) }),
      { severity: "info", key: "player-faction" });
  }

  // Land the cursor on the row that was just added, wherever the tree put it.
  this._dndLastLeftPageKey = null;
  const list = this.getFactionList();
  const idx = list.findIndex((row) => row && row.isPlayer);
  if (idx >= 0) this._dndSelectedIndex = idx;
  this.refreshUIFactions();
};

//=============================================================================
// Scene_PlayerFaction - running the banner you raised
//=============================================================================
//
// The left page is the roll: who has joined, counted and named. The right page
// is the allegiance: the powers this faction may swear itself to, and the way
// back out of a vow already taken.

function Scene_PlayerFaction() {
  this.initialize(...arguments);
}

Scene_PlayerFaction.prototype = Object.create(Scene_MenuBase.prototype);
Scene_PlayerFaction.prototype.constructor = Scene_PlayerFaction;
window.Scene_PlayerFaction = Scene_PlayerFaction;

Scene_PlayerFaction.prototype.initialize = function () {
  Scene_MenuBase.prototype.initialize.call(this);
  this._pfIndex = 0;
};

Scene_PlayerFaction.prototype.create = function () {
  Scene_MenuBase.prototype.create.call(this);
  this._pfIndex = 0;

  this._pfContainer = document.createElement("div");
  this._pfContainer.id = "menu-container";
  this._pfContainer.style.opacity = "0";
  this._pfContainer.style.transition = "opacity 0.22s ease-out";
  document.body.appendChild(this._pfContainer);

  // Same reason as the register: RPG Maker preventDefaults wheel on the
  // document, so a DOM overlay has to scroll itself.
  this._pfContainer.addEventListener("wheel", (e) => {
    const box = e.target.closest("#pf-roster, #pf-allegiance, .left-page, .right-page");
    if (box) box.scrollTop += e.deltaY;
    e.stopPropagation();
    e.preventDefault();
  }, { passive: false });

  this.refreshPlayerFaction();

  setTimeout(() => {
    if (this._pfContainer) this._pfContainer.style.opacity = "1";
  }, 16);
};

// The rows the right page walks: standing alone first, then every power that
// could be sworn to. The vow already taken is not offered again.
Scene_PlayerFaction.prototype.allegianceOptions = function () {
  const overlord = $gameFactions.playerFactionOverlord();
  const rows = [];
  if (overlord) rows.push({ id: null, name: T("Factions.player.renounce"), current: false });
  else rows.push({ id: null, name: T("Factions.player.noOverlord"), current: true });
  $gameFactions.getHyperpowers().forEach((hp) => {
    rows.push({
      id: hp.id,
      name: $gameFactions.hyperpowerLabel(hp),
      current: !!overlord && overlord.id === hp.id,
    });
  });
  return rows;
};

Scene_PlayerFaction.prototype.refreshPlayerFaction = function () {
  if (!this._pfContainer) return;
  const record = $gameFactions.playerFaction();
  if (!record) { this.popScene(); return; }

  const roster = $gameFactions.playerFactionRoster();
  const overlord = $gameFactions.playerFactionOverlord();
  const options = this.allegianceOptions();
  if (this._pfIndex >= options.length) this._pfIndex = options.length - 1;

  const nameRow = (label, value) =>
    `<div class="facrep-12"><span><strong>${label}</strong></span><span>${value}</span></div>`;

  const memberTags = (names) => names.length
    ? `<div class="facrep-29">${names.map((n) =>
        `<span class="facrep-30">${FRS.escapeText(n)}</span>`).join("")}</div>`
    : `<div class="facrep-22">${T("Factions.player.emptyRoll")}</div>`;

  const leftPageHTML = `
    <div class="left-page">
      <div class="page-header-bar facrep-02">
        <div class="back-button focusable facrep-03" onclick="SceneManager._scene.popScene()">
          ${T("Factions.back")}
        </div>
        <h2 class="title facrep-04">${FRS.escapeText(record.name)}</h2>
        <div class="back-button focusable facrep-23"
             onclick="SceneManager._scene.openRenamePanel()">${T("Factions.player.rename")}</div>
      </div>
      <div class="facrep-13">
        ${nameRow(T("Factions.player.membersLbl"), T("Factions.player.membersLine", {
          total: roster.total, party: roster.party.length, army: roster.army.length,
        }))}
        ${nameRow(T("Factions.player.allegianceLbl"),
          overlord ? $gameFactions.hyperpowerLabel(overlord) : T("Factions.player.noOverlord"))}
        ${record.founded ? nameRow(T("Factions.player.foundedLbl"), FRS.escapeText(record.founded)) : ""}
      </div>
      <div class="backpack-grid facrep-05" id="pf-roster">
        <h4 class="facrep-21">${T("Factions.player.companionsLbl", { count: roster.party.length })}</h4>
        ${memberTags(roster.party)}
        <h4 class="facrep-21">${T("Factions.player.soldiersLbl", { count: roster.army.length })}</h4>
        ${memberTags(roster.army)}
      </div>
    </div>
  `;

  const optionHTML = options.map((option, idx) => {
    const selected = this._pfIndex === idx ? "selected" : "";
    const badge = option.current
      ? `<span class="faction-rep-badge faction-rep--exalted">${T("Factions.player.currentVow")}</span>`
      : "";
    return `
      <div class="faction-row ${selected}" onclick="SceneManager._scene.chooseAllegiance(${idx})">
        <div class="faction-info"><span class="faction-name">${FRS.escapeText(option.name)}</span></div>
        ${badge}
      </div>
    `;
  }).join("");

  const rightPageHTML = `
    <div class="right-page">
      <div class="faction-heraldry-card">
        <div class="heraldry-header">
          <h3 class="heraldry-title">${T("Factions.player.allegianceTitle")}</h3>
        </div>
        <div class="inspect-lore facrep-20">${T("Factions.player.allegianceHint")}</div>
        <div class="faction-accords" id="pf-allegiance">${optionHTML}</div>
      </div>
    </div>
  `;

  this._pfContainer.innerHTML = `<div class="book-spread">${leftPageHTML}${rightPageHTML}</div>`;

  const list = this._pfContainer.querySelector("#pf-allegiance");
  const row = list ? list.children[this._pfIndex] : null;
  if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
};

Scene_PlayerFaction.prototype.movePlayerFactionCursor = function (delta) {
  const options = this.allegianceOptions();
  const next = this._pfIndex + delta;
  if (next < 0 || next >= options.length) return;
  SoundManager.playCursor();
  this._pfIndex = next;
  this.refreshPlayerFaction();
};

Scene_PlayerFaction.prototype.chooseAllegiance = function (idx) {
  const options = this.allegianceOptions();
  const option = options[idx];
  if (!option) return;
  this._pfIndex = idx;
  if (option.current) {
    SoundManager.playBuzzer();
    this.refreshPlayerFaction();
    return;
  }
  SoundManager.playOk();
  $gameFactions.swearPlayerFactionTo(option.id);
  const record = $gameFactions.playerFaction();
  if (window.ParchmentToast) {
    window.ParchmentToast.show(
      option.id === null
        ? T("Factions.player.renouncedToast", { faction: FRS.escapeText(record.name) })
        : T("Factions.player.swornToast", {
          faction: FRS.escapeText(record.name), power: FRS.escapeText(option.name),
        }),
      { severity: "info", key: "player-faction" });
  }
  this._pfIndex = 0;
  this.refreshPlayerFaction();
};

Scene_PlayerFaction.prototype.openRenamePanel = function () {
  if (this._pfRenamePanel) return;
  SoundManager.playOk();
  const record = $gameFactions.playerFaction();

  const panel = document.createElement("div");
  panel.className = "facrep-25";
  panel.innerHTML = `
    <div class="facrep-26">
      <h3 class="title facrep-09">${T("Factions.player.rename")}</h3>
      <p class="facrep-10">${T("Factions.player.renameHint")}</p>
      <input class="facrep-27" type="text" maxlength="48"
             aria-label="${T("Factions.player.nameLbl")}">
      <div class="facrep-28">
        <div class="back-button focusable facrep-03"
             onclick="SceneManager._scene.rerollRename()">${T("Factions.player.reroll")}</div>
        <div class="back-button focusable facrep-03"
             onclick="SceneManager._scene.confirmRename()">${T("Factions.player.confirm")}</div>
        <div class="back-button focusable facrep-03"
             onclick="SceneManager._scene.closeRenamePanel()">${T("Factions.player.cancel")}</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  this._pfRenamePanel = panel;

  const field = panel.querySelector("input");
  field.value = record ? record.name : "";
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") this.confirmRename();
    else if (e.key === "Escape") this.closeRenamePanel();
  });
  field.addEventListener("keyup", (e) => e.stopPropagation());
  field.addEventListener("keypress", (e) => e.stopPropagation());
  field.focus();
  field.select();
};

Scene_PlayerFaction.prototype.rerollRename = function () {
  if (!this._pfRenamePanel) return;
  SoundManager.playCursor();
  const field = this._pfRenamePanel.querySelector("input");
  if (!field) return;
  field.value = $gameFactions.rollPlayerFactionName();
  field.focus();
  field.select();
};

Scene_PlayerFaction.prototype.closeRenamePanel = function () {
  if (!this._pfRenamePanel) return;
  SoundManager.playCancel();
  if (this._pfRenamePanel.parentNode) this._pfRenamePanel.parentNode.removeChild(this._pfRenamePanel);
  this._pfRenamePanel = null;
};

Scene_PlayerFaction.prototype.confirmRename = function () {
  if (!this._pfRenamePanel) return;
  const field = this._pfRenamePanel.querySelector("input");
  const renamed = $gameFactions.renamePlayerFaction(field ? field.value : "");
  if (renamed) SoundManager.playOk(); else SoundManager.playBuzzer();
  if (this._pfRenamePanel.parentNode) this._pfRenamePanel.parentNode.removeChild(this._pfRenamePanel);
  this._pfRenamePanel = null;
  this.refreshPlayerFaction();
};

Scene_PlayerFaction.prototype.update = function () {
  Scene_MenuBase.prototype.update.call(this);
  // A focused field owns the keyboard, here as everywhere else.
  if (this._pfRenamePanel) return;
  if (window.MenuSearchBar && window.MenuSearchBar.isTyping()) return;

  if (Input.isTriggered("down")) this.movePlayerFactionCursor(1);
  else if (Input.isTriggered("up")) this.movePlayerFactionCursor(-1);
  // The rename button, for a hand that never touches the mouse.
  else if (Input.isTriggered("shift")) this.openRenamePanel();
  else if (Input.isTriggered("ok")) this.chooseAllegiance(this._pfIndex);
  else if (Input.isTriggered("cancel") || TouchInput.isCancelled()) {
    SoundManager.playCancel();
    this.popScene();
  }
};

Scene_PlayerFaction.prototype.terminate = function () {
  Scene_MenuBase.prototype.terminate.call(this);
  this.closeRenamePanel();
  if (this._pfContainer) {
    const container = this._pfContainer;
    container.style.transition = "opacity 0.2s ease-out";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    setTimeout(() => {
      if (container && container.parentNode) container.parentNode.removeChild(container);
    }, 200);
    this._pfContainer = null;
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

