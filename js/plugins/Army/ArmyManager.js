/*:
 * @plugindesc Mount & Blade style Army Management System v1.1.0 [Claude+GPT]
 * @author Omni-Lex & Antigravity
 * @target MZ
 *
 * @param showInMenu
 * @text Show in Menu
 * @type boolean
 * @default true
 * @desc Whether to add the Army option to the main menu.
 *
 * @param menuText
 * @text Menu Command Text
 * @type string
 * @default Army
 * @desc The text shown for the Army command in the menu.
 *
 * @param maxArmySize
 * @text Maximum Army Size
 * @type number
 * @min 1
 * @max 999
 * @default 100
 * @desc Maximum number of troops you can have in your army.
 *
 * @command buyTroops
 * @text Buy Troops
 * @desc Opens the troop recruitment window.
 * @arg factionId
 * @type number
 * @min -1
 * @default -1
 * @desc The faction ID to recruit from (-1 for all factions).
 *
 * @command debugAddTroops
 * @text Debug: Add All Faction Troops
 * @desc [DEBUG] Adds all troop types from a random faction (10 of each type).
 *
 * @help
 * Army Management System - Mount & Blade Warband Style
 *
 * Refactored to support the D&D Parchment Double-Page Pockets Layout.
 */

var Imported = Imported || {};
Imported.ArmyManager = true;

var ArmyManager = ArmyManager || {};
ArmyManager.Params = PluginManager.parameters("ArmyManager");

ArmyManager.Params.showInMenu = String(ArmyManager.Params.showInMenu || "true").toLowerCase() === "true";
ArmyManager.Params.menuText = T.param(ArmyManager.Params.menuText, 'ArmyManager.menu');
ArmyManager.Params.maxArmySize = Number(ArmyManager.Params.maxArmySize || 100);

// Troop role markers: real IconSet glyphs (indices per js/db/Sprites/Icons.json)
// instead of emoji. Melee is the default when a troop has no special role.
const ARMY_ROLE_ICONS = { support: 176, ranged: 370, melee: 322 };

function armyIconHTML(iconIndex, size = 18) {
  const x = (iconIndex % 16) * size;
  const y = Math.floor(iconIndex / 16) * size;
  return `<span style="display:inline-block;vertical-align:middle;width:${size}px;height:${size}px;` +
    `background-image:url('img/system/IconSet.png');background-size:${size * 16}px auto;` +
    `background-position:-${x}px -${y}px;image-rendering:pixelated;flex-shrink:0;"></span>`;
}

function armyRoleIconHTML(role) {
  return armyIconHTML(ARMY_ROLE_ICONS[role] || ARMY_ROLE_ICONS.melee);
}

let _statsI18n = null;

const _loadStatsI18n = async () => {
  const lang = ConfigManager.language || 'en';
  const url = `js/i18n/${lang}/stats.json`;
  try {
    const response = await fetch(url);
    _statsI18n = await response.json();
  } catch (e) {
    console.error('ArmyManager: Failed to load i18n data from ' + url, e);
  }
};

const _si18n = (key) => {
  if (_statsI18n && _statsI18n[key]) {
    return _statsI18n[key];
  }
  return key;
};

_loadStatsI18n();

// Get localized stat label
function getStatLabel(stat) {
  const labels = {
    HP: _si18n("HP"),
    MP: _si18n("MP"),
    ATK: _si18n("ATT"),
    DEF: _si18n("CON"),
    MAT: _si18n("M.ATT"),
    MDF: _si18n("M.DEF"),
    AGI: _si18n("AGILITY"),
    LUK: _si18n("LUCK")
  };

  return labels[stat] || stat;
}

//=============================================================================
// Game_Army - Manages army data
//=============================================================================

function Game_Army() {
  this.initialize(...arguments);
}

Game_Army.prototype.initialize = function () {
  this._troops = []; // Array of troop objects
  this._nextTroopId = 1;
  this._squads = []; // Array of squad objects
  this._nextSquadId = 1;
};

Game_Army.prototype.getTroops = function () {
  return this._troops;
};

Game_Army.prototype.getTroopCount = function () {
  return this._troops.length;
};

Game_Army.prototype.canRecruitMore = function () {
  return this._troops.length < ArmyManager.Params.maxArmySize;
};

Game_Army.prototype.addTroop = function (factionId, troopData) {
  if (!this.canRecruitMore()) {
    return false;
  }

  const troop = {
    id: this._nextTroopId++,
    factionId: factionId,
    name: troopData.name,
    name_it: troopData.name_it,
    hp: troopData.hp,
    mp: troopData.mp,
    atk: troopData.atk,
    def: troopData.def,
    mat: troopData.mat,
    mdf: troopData.mdf,
    agi: troopData.agi,
    luk: troopData.luk,
    hiringCost: troopData.hiringCost,
    weeklyCost: troopData.weeklyCost,
    role: troopData.role, // Store role for icon display
    squadId: null // Not in a squad by default
  };

  this._troops.push(troop);
  return true;
};

Game_Army.prototype.removeTroop = function (troopId) {
  const index = this._troops.findIndex(t => t.id === troopId);
  if (index >= 0) {
    // Remove from squad if assigned
    const troop = this._troops[index];
    if (troop.squadId) {
      this.removeTroopFromSquad(troopId);
    }
    this._troops.splice(index, 1);
    return true;
  }
  return false;
};

Game_Army.prototype.getTotalWeeklyCost = function () {
  return this._troops.reduce((sum, troop) => sum + troop.weeklyCost, 0);
};

Game_Army.prototype.getCoherence = function () {
  if (this._troops.length === 0) return 100;

  // Count troops by faction
  const factionCounts = {};
  for (const troop of this._troops) {
    factionCounts[troop.factionId] = (factionCounts[troop.factionId] || 0) + 1;
  }

  // Find largest faction group
  const maxCount = Math.max(...Object.values(factionCounts));

  // Coherence is percentage of largest faction group
  return Math.floor((maxCount / this._troops.length) * 100);
};

Game_Army.prototype.getFactionBreakdown = function () {
  const breakdown = {};

  for (const troop of this._troops) {
    if (!breakdown[troop.factionId]) {
      const faction = $gameFactions ? $gameFactions.getFaction(troop.factionId) : null;
      const useItalian = ConfigManager.language === 'it';

      let factionName = T('ArmyManager.unknownFaction');
      if (faction) {
        factionName = useItalian && faction.name_it ? faction.name_it : faction.name;
      }

      breakdown[troop.factionId] = {
        name: factionName,
        count: 0
      };
    }
    breakdown[troop.factionId].count++;
  }

  return breakdown;
};

//=============================================================================
// Squad Management
//=============================================================================

Game_Army.prototype.getSquads = function () {
  return this._squads;
};

Game_Army.prototype.createSquad = function (troopName) {
  const squad = {
    id: this._nextSquadId++,
    name: troopName,
    leaderId: null, // Actor ID of the leader
    troopIds: [] // Array of troop IDs in this squad
  };
  this._squads.push(squad);
  return squad;
};

Game_Army.prototype.getSquadById = function (squadId) {
  return this._squads.find(s => s.id === squadId);
};

Game_Army.prototype.assignLeaderToSquad = function (squadId, actorId) {
  const squad = this.getSquadById(squadId);
  if (squad) {
    squad.leaderId = actorId;
    return true;
  }
  return false;
};

Game_Army.prototype.removeLeaderFromSquad = function (squadId) {
  const squad = this.getSquadById(squadId);
  if (squad) {
    squad.leaderId = null;
    return true;
  }
  return false;
};

Game_Army.prototype.addTroopToSquad = function (troopId, squadId) {
  const troop = this._troops.find(t => t.id === troopId);
  const squad = this.getSquadById(squadId);

  if (!troop || !squad) return false;

  // Verify troop name matches squad
  if (troop.name !== squad.name) return false;

  // Remove from old squad if any
  if (troop.squadId) {
    this.removeTroopFromSquad(troopId);
  }

  troop.squadId = squadId;
  if (!squad.troopIds.includes(troopId)) {
    squad.troopIds.push(troopId);
  }
  return true;
};

Game_Army.prototype.removeTroopFromSquad = function (troopId) {
  const troop = this._troops.find(t => t.id === troopId);
  if (!troop || !troop.squadId) return false;

  const squad = this.getSquadById(troop.squadId);
  if (squad) {
    const index = squad.troopIds.indexOf(troopId);
    if (index >= 0) {
      squad.troopIds.splice(index, 1);
    }

    // Remove empty squads
    if (squad.troopIds.length === 0) {
      const squadIndex = this._squads.findIndex(s => s.id === squad.id);
      if (squadIndex >= 0) {
        this._squads.splice(squadIndex, 1);
      }
    }
  }

  troop.squadId = null;
  return true;
};

Game_Army.prototype.getTroopWithBonuses = function (troopId) {
  const troop = this._troops.find(t => t.id === troopId);
  if (!troop) return null;

  const troopWithBonuses = { ...troop };

  if (troop.squadId) {
    const squad = this.getSquadById(troop.squadId);
    if (squad && squad.leaderId) {
      const leader = $gameActors.actor(squad.leaderId);
      if (leader) {
        const bonusPercent = 0.08;
        troopWithBonuses.hp = Math.floor(troop.hp + leader.mhp * bonusPercent);
        troopWithBonuses.mp = Math.floor(troop.mp + leader.mmp * bonusPercent);
        troopWithBonuses.atk = Math.floor(troop.atk + leader.atk * bonusPercent);
        troopWithBonuses.def = Math.floor(troop.def + leader.def * bonusPercent);
        troopWithBonuses.mat = Math.floor(troop.mat + leader.mat * bonusPercent);
        troopWithBonuses.mdf = Math.floor(troop.mdf + leader.mdf * bonusPercent);
        troopWithBonuses.agi = Math.floor(troop.agi + leader.agi * bonusPercent);
        troopWithBonuses.luk = Math.floor(troop.luk + leader.luk * bonusPercent);
        troopWithBonuses.hasLeader = true;
        troopWithBonuses.leaderName = leader.name();
      }
    }
  }

  return troopWithBonuses;
};

Game_Army.prototype.autoOrganizeSquads = function () {
  const troopsByName = {};
  for (const troop of this._troops) {
    if (!troopsByName[troop.name]) {
      troopsByName[troop.name] = [];
    }
    troopsByName[troop.name].push(troop);
  }

  for (const troopName in troopsByName) {
    const troops = troopsByName[troopName];
    if (troops.length >= 2) {
      let squad = this._squads.find(s => s.name === troopName);
      if (!squad) {
        squad = this.createSquad(troopName);
      }

      for (const troop of troops) {
        this.addTroopToSquad(troop.id, squad.id);
      }
    }
  }
};

//=============================================================================
// Workforce: "scientist" role troops never fight (see ArmyBattleView.js
// _setupPlayerArmy/_setupEnemyArmy), instead they passively work the party's
// active Tech Tree research project (ProceduralTechTree.js) every game day.
//=============================================================================
function isScientistTroop(troop) {
  return /scientist/i.test(String((troop && troop.role) || ""));
}

Game_Army.prototype.getScientistTroops = function () {
  return this._troops.filter(isScientistTroop);
};

// Delivers a day's worth of materials for the active research project
// straight into the party's inventory, one line per required material
// (all of them advance together, not one material at a time).
Game_Army.prototype.produceDailyMaterials = function () {
  if (!window.ProceduralTechTree || !$gameParty) return;
  if (!this.getScientistTroops().length) return;

  const project = window.ProceduralTechTree.getActiveProject();
  if (!project) return;
  const tree = window.ProceduralTechTree.treeById(project.treeId);
  const node = tree && tree.byId[project.nodeId];
  if (!node) return;

  const output = window.ProceduralTechTree.workforceDailyOutput(node);
  const delivered = [];
  output.forEach(m => {
    if (m.qty <= 0) return;
    const item = $dataItems[m.id];
    if (!item) return;
    $gameParty.gainItem(item, m.qty);
    delivered.push({ item: item, qty: m.qty });
  });

  if (delivered.length && window.ParchmentToast && typeof window.ParchmentToast.show === "function") {
    const dbName = it => (typeof window.translateText === "function") ? window.translateText(it.name) : it.name;
    const names = delivered.map(d => `${dbName(d.item)} x${d.qty}`).join(", ");
    window.ParchmentToast.show(T('ArmyManager.workforceDelivered', { list: names }), { severity: "info", duration: 150 });
  }
};

// Runs once per in-game day (Variable 113's date string rolling over), the
// same day-boundary pattern RealEstateMarket.js uses for its own daily tick.
let _armyWorkforceRawDate = null;
let _armyWorkforceDayKeyCache = "";
function armyWorkforceDayKey() {
  const dateStr = ($gameVariables && $gameVariables.value(113)) || "";
  if (dateStr === _armyWorkforceRawDate) return _armyWorkforceDayKeyCache;
  _armyWorkforceRawDate = dateStr;
  const parts = String(dateStr).split(" ").filter(Boolean);
  _armyWorkforceDayKeyCache = parts.slice(0, 3).join(" ");
  return _armyWorkforceDayKeyCache;
}

let _armyWorkforceFrameTick = 0;
const _Scene_Map_update_ArmyWorkforce = Scene_Map.prototype.update;
Scene_Map.prototype.update = function () {
  _Scene_Map_update_ArmyWorkforce.call(this);
  if (typeof $gameArmy === "undefined" || !$gameArmy || !$gameSystem) return;
  if (++_armyWorkforceFrameTick < 60) return;
  _armyWorkforceFrameTick = 0;
  const dayKey = armyWorkforceDayKey();
  if (!dayKey) return;
  if ($gameSystem._armyLastProductionDayKey === undefined) {
    $gameSystem._armyLastProductionDayKey = dayKey;
    return;
  }
  if ($gameSystem._armyLastProductionDayKey !== dayKey) {
    $gameSystem._armyLastProductionDayKey = dayKey;
    $gameArmy.produceDailyMaterials();
  }
};

//=============================================================================
// DataManager Integration
//=============================================================================

const _DataManager_createGameObjects_ArmyManager = DataManager.createGameObjects;
DataManager.createGameObjects = function () {
  _DataManager_createGameObjects_ArmyManager.call(this);
  $gameArmy = new Game_Army();
};

const _DataManager_makeSaveContents_ArmyManager = DataManager.makeSaveContents;
DataManager.makeSaveContents = function () {
  const contents = _DataManager_makeSaveContents_ArmyManager.call(this);
  contents.army = $gameArmy;
  return contents;
};

const _DataManager_extractSaveContents_ArmyManager = DataManager.extractSaveContents;
DataManager.extractSaveContents = function (contents) {
  _DataManager_extractSaveContents_ArmyManager.call(this, contents);
  $gameArmy = contents.army || new Game_Army();
};

//=============================================================================
// UI Styles Injections
//=============================================================================
function loadUIArmyResources() {

}

//=============================================================================
// Keyboard Input Managers
//=============================================================================
class UIArmyInputManager {
  static init(container, scene) {
    this.container = container;
    this.scene = scene;
    this.active = false;
  }
  static activate() { this.active = true; }
  static deactivate() { this.active = false; }
  static update() {
    if (!this.active) return;

    // If confirmation dialog is open
    if (this.scene._confirmOpen) {
      if (Input.isTriggered('left') || Input.isTriggered('right')) {
        SoundManager.playCursor();
        this.scene._confirmChoice = this.scene._confirmChoice === 'yes' ? 'no' : 'yes';
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('ok')) {
        this.scene.handleConfirmOk();
      } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
        SoundManager.playCancel();
        this.scene._confirmOpen = false;
        this.scene.refreshUIDOM();
      }
      return;
    }

    // L1/R1 cycle between the command and troop tabs from anywhere
    if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
      SoundManager.playCursor();
      this.scene._activeTab = this.scene._activeTab === 'commands' ? 'troops' : 'commands';
      this.scene.refreshUIDOM();
      return;
    }

    if (this.scene._activeTab === 'commands') {
      const cmdCount = this.scene.commandList().length;
      if (Input.isTriggered('down')) {
        SoundManager.playCursor();
        this.scene._commandIndex = (this.scene._commandIndex + 1) % cmdCount;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('up')) {
        SoundManager.playCursor();
        this.scene._commandIndex = (this.scene._commandIndex - 1 + cmdCount) % cmdCount;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('ok')) {
        this.scene.handleCommandOk();
      } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
        SoundManager.playCancel();
        this.scene.popScene();
      }
    } else if (this.scene._activeTab === 'troops') {
      const troops = $gameArmy.getTroops();
      if (troops.length === 0) return;

      if (Input.isTriggered('down')) {
        SoundManager.playCursor();
        this.scene._troopIndex = (this.scene._troopIndex + 1) % troops.length;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('up')) {
        SoundManager.playCursor();
        this.scene._troopIndex = (this.scene._troopIndex - 1 + troops.length) % troops.length;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('ok')) {
        this.scene.promptReleaseTroop(this.scene._troopIndex);
      } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
        SoundManager.playCancel();
        this.scene._activeTab = 'commands';
        this.scene.refreshUIDOM();
      }
    }
  }
}

class UIBuyTroopsInputManager {
  static init(container, scene) {
    this.container = container;
    this.scene = scene;
    this.active = false;
  }
  static activate() { this.active = true; }
  static deactivate() { this.active = false; }
  static update() {
    if (!this.active) return;
    const shop = this.scene._troopShopWindow;
    if (!shop) return;
    const maxItems = shop.maxItems();
    if (maxItems === 0) {
      if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
        SoundManager.playCancel();
        this.scene.popScene();
      }
      return;
    }

    if (Input.isTriggered('down')) {
      SoundManager.playCursor();
      this.scene._selectedIndex = (this.scene._selectedIndex + 1) % maxItems;
      this.scene.refreshUIDOM();
    } else if (Input.isTriggered('up')) {
      SoundManager.playCursor();
      this.scene._selectedIndex = (this.scene._selectedIndex - 1 + maxItems) % maxItems;
      this.scene.refreshUIDOM();
    } else if (Input.isTriggered('ok')) {
      this.scene.buyTroopAtIndex(this.scene._selectedIndex);
    } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
      SoundManager.playCancel();
      this.scene.popScene();
    }
  }
}

class UISquadsInputManager {
  static init(container, scene) {
    this.container = container;
    this.scene = scene;
    this.active = false;
  }
  static activate() { this.active = true; }
  static deactivate() { this.active = false; }
  static update() {
    if (!this.active) return;

    if (this.scene._activeTab === 'squads') {
      const squads = $gameArmy.getSquads();
      if (squads.length === 0) {
        if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
          SoundManager.playCancel();
          this.scene.popScene();
        }
        return;
      }

      if (Input.isTriggered('down')) {
        SoundManager.playCursor();
        this.scene._squadIndex = (this.scene._squadIndex + 1) % squads.length;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('up')) {
        SoundManager.playCursor();
        this.scene._squadIndex = (this.scene._squadIndex - 1 + squads.length) % squads.length;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('ok')) {
        SoundManager.playOk();
        this.scene._activeTab = 'leaders';
        this.scene._leaderIndex = 0;
        this.scene.refreshLeaderList();
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
        SoundManager.playCancel();
        this.scene.popScene();
      }
    } else if (this.scene._activeTab === 'leaders') {
      const leaders = this.scene._leadersList;
      if (leaders.length === 0) return;

      if (Input.isTriggered('down')) {
        SoundManager.playCursor();
        this.scene._leaderIndex = (this.scene._leaderIndex + 1) % leaders.length;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('up')) {
        SoundManager.playCursor();
        this.scene._leaderIndex = (this.scene._leaderIndex - 1 + leaders.length) % leaders.length;
        this.scene.refreshUIDOM();
      } else if (Input.isTriggered('ok')) {
        this.scene.selectLeaderAtIndex(this.scene._leaderIndex);
      } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
        SoundManager.playCancel();
        this.scene._activeTab = 'squads';
        this.scene.refreshUIDOM();
      }
    }
  }
}

//=============================================================================
// Scene and Window Definitions (Standard MZ Boilerplate & Dummies)
//=============================================================================

function Scene_Army() {
  this.initialize(...arguments);
}
Scene_Army.prototype = Object.create(Scene_MenuBase.prototype);
Scene_Army.prototype.constructor = Scene_Army;
Scene_Army.prototype.initialize = function () {
  Scene_MenuBase.prototype.initialize.call(this);
};
window.Scene_Army = Scene_Army;

function Scene_BuyTroops() {
  this.initialize(...arguments);
}
Scene_BuyTroops.prototype = Object.create(Scene_MenuBase.prototype);
Scene_BuyTroops.prototype.constructor = Scene_BuyTroops;
Scene_BuyTroops.prototype.initialize = function () {
  Scene_MenuBase.prototype.initialize.call(this);
};
Scene_BuyTroops.prototype.prepare = function (factionId) {
  this._factionId = factionId;
};
window.Scene_BuyTroops = Scene_BuyTroops;

function Scene_Squads() {
  this.initialize(...arguments);
}
Scene_Squads.prototype = Object.create(Scene_MenuBase.prototype);
Scene_Squads.prototype.constructor = Scene_Squads;
Scene_Squads.prototype.initialize = function () {
  Scene_MenuBase.prototype.initialize.call(this);
};
window.Scene_Squads = Scene_Squads;

// Dummy Windows inheriting from Window_Base
function Window_ArmyInfo() {
  this.initialize(...arguments);
}
Window_ArmyInfo.prototype = Object.create(Window_Base.prototype);
Window_ArmyInfo.prototype.constructor = Window_ArmyInfo;
Window_ArmyInfo.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
};
window.Window_ArmyInfo = Window_ArmyInfo;

function Window_ArmyCommand() {
  this.initialize(...arguments);
}
Window_ArmyCommand.prototype = Object.create(Window_Base.prototype);
Window_ArmyCommand.prototype.constructor = Window_ArmyCommand;
Window_ArmyCommand.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
};
window.Window_ArmyCommand = Window_ArmyCommand;

function Window_TroopList() {
  this.initialize(...arguments);
}
Window_TroopList.prototype = Object.create(Window_Base.prototype);
Window_TroopList.prototype.constructor = Window_TroopList;
Window_TroopList.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
};
window.Window_TroopList = Window_TroopList;

function Window_TroopStats() {
  this.initialize(...arguments);
}
Window_TroopStats.prototype = Object.create(Window_Base.prototype);
Window_TroopStats.prototype.constructor = Window_TroopStats;
Window_TroopStats.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
};
window.Window_TroopStats = Window_TroopStats;

function Window_RecruitStats() {
  this.initialize(...arguments);
}
Window_RecruitStats.prototype = Object.create(Window_Base.prototype);
Window_RecruitStats.prototype.constructor = Window_RecruitStats;
Window_RecruitStats.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
};
window.Window_RecruitStats = Window_RecruitStats;

function Window_SquadList() {
  this.initialize(...arguments);
}
Window_SquadList.prototype = Object.create(Window_Base.prototype);
Window_SquadList.prototype.constructor = Window_SquadList;
Window_SquadList.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
};
window.Window_SquadList = Window_SquadList;

function Window_LeaderSelect() {
  this.initialize(...arguments);
}
Window_LeaderSelect.prototype = Object.create(Window_Base.prototype);
Window_LeaderSelect.prototype.constructor = Window_LeaderSelect;
Window_LeaderSelect.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
};
window.Window_LeaderSelect = Window_LeaderSelect;

function Window_TroopShop() {
  this.initialize(...arguments);
}
Window_TroopShop.prototype = Object.create(Window_Base.prototype);
Window_TroopShop.prototype.constructor = Window_TroopShop;
Window_TroopShop.prototype.initialize = function (rect) {
  Window_Base.prototype.initialize.call(this, rect);
  this._factionId = -1;
  this._data = [];
};
Window_TroopShop.prototype.setFactionFilter = function (factionId) {
  this._factionId = factionId;
  this.makeItemList();
};
Window_TroopShop.prototype.makeItemList = function () {
  this._data = [];
  const allFactions = $gameFactions ? $gameFactions.getAllFactions() : [];
  const targetFactions = this._factionId === -1 ? allFactions : allFactions.filter(f => f.id === this._factionId);
  for (const f of targetFactions) {
    if (f.troops) {
      for (const troop of f.troops) {
        this._data.push({ factionId: f.id, troop: troop });
      }
    }
  }
};
Window_TroopShop.prototype.maxItems = function () {
  return this._data ? this._data.length : 0;
};
window.Window_TroopShop = Window_TroopShop;

//=============================================================================
// Scene_Army - Main army management scene
//=============================================================================

Scene_Army.prototype.create = function () {
  loadUIArmyResources();
  Scene_MenuBase.prototype.create.call(this);

  if (this._windowLayer) {
    this._windowLayer.visible = false;
  }
  if (this._cancelButton) {
    this._cancelButton.visible = false;
  }

  this._activeTab = 'commands'; // 'commands' or 'troops'
  this._commandIndex = 0;
  this._troopIndex = 0;
  this._confirmOpen = false;
  this._confirmChoice = 'no';
  this._troopToRelease = null;

  this.createDummyWindows();
  this.createUIDOM();
};

Scene_Army.prototype.createDummyWindows = function () {
  const rect = new Rectangle(0, 0, 0, 0);
  this._helpWindow = new Window_Help(rect);
  this._infoWindow = new Window_ArmyInfo(rect);
  this._commandWindow = new Window_ArmyCommand(rect);
  this._troopListWindow = new Window_TroopList(rect);
  this._statsWindow = new Window_TroopStats(rect);
  this._helpWindow.visible = false;
  this._infoWindow.visible = false;
  this._commandWindow.visible = false;
  this._troopListWindow.visible = false;
  this._statsWindow.visible = false;
  this.addWindow(this._helpWindow);
  this.addWindow(this._infoWindow);
  this.addWindow(this._commandWindow);
  this.addWindow(this._troopListWindow);
  this.addWindow(this._statsWindow);
};

Scene_Army.prototype.createUIDOM = function () {
  this._dndContainer = document.createElement('div');
  this._dndContainer.id = 'menu-container';
  document.body.appendChild(this._dndContainer);

  UIArmyInputManager.init(this._dndContainer, this);
  UIArmyInputManager.activate();
  this.refreshUIDOM();
};

Scene_Army.prototype.refreshUIDOM = function () {
  if (!this._dndContainer) return;

  const troops = $gameArmy.getTroops();
  const troopCount = $gameArmy.getTroopCount();
  const maxTroops = ArmyManager.Params.maxArmySize;
  const weeklyCost = $gameArmy.getTotalWeeklyCost();
  const coherence = $gameArmy.getCoherence();
  const breakdown = $gameArmy.getFactionBreakdown();

  const weeklyEuros = (weeklyCost / 100).toFixed(2);
  const useItalian = ConfigManager.language === 'it';

  // Coherence color scale
  let coherenceColor = "var(--text-cost-bad)"; // low red
  if (coherence >= 80) coherenceColor = "var(--text-cost-ok)"; // high green
  else if (coherence >= 50) coherenceColor = "var(--accent-gold-2)"; // gold

  // Command buttons list (Left Page)
  const cmds = this.commandList();
  let commandsHTML = "";
  cmds.forEach((cmd, idx) => {
    const isSelected = this._activeTab === 'commands' && idx === this._commandIndex;
    commandsHTML += `
      <div class="choice-card ${isSelected ? 'selected' : ''}" onclick="SceneManager._scene.clickCommand(${idx})">
        ${cmd.label}
      </div>
    `;
  });

  // Faction breakdown list
  let factionRows = "";
  const sortedBreakdown = Object.values(breakdown).sort((a, b) => b.count - a.count);
  if (sortedBreakdown.length > 0) {
    sortedBreakdown.forEach(f => {
      factionRows += `
            <tr>
                <td>${f.name}</td>
                <td style="text-align:right; font-weight:bold;">${f.count}</td>
            </tr>
        `;
    });
  } else {
    factionRows = `<tr><td colspan="2" style="text-align:center; font-style:italic; color:var(--text-card-medium);">${T('ArmyManager.noRegiments')}</td></tr>`;
  }

  // Troops Roster (Right Page)
  let rosterHTML = "";
  if (troops.length > 0) {
    troops.forEach((troop, idx) => {
      const isSelected = this._activeTab === 'troops' && idx === this._troopIndex;
      const name = useItalian && troop.name_it ? troop.name_it : troop.name;
      const euros = (troop.weeklyCost / 100).toFixed(2);

      const roleIcon = armyRoleIconHTML(troop.role);

      rosterHTML += `
            <div class="choice-card ${isSelected ? 'selected' : ''}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px;" onclick="SceneManager._scene.clickTroop(${idx})">
                <span class="role-badge">${roleIcon} ${name}</span>
                <span style="font-size:0.85em; font-family:'Lora', serif; color:var(--text-card-medium);">€${euros}/w</span>
            </div>
        `;
    });
  } else {
    rosterHTML = `
        <div style="text-align:center; color:var(--text-card-medium); font-style:italic; font-size:0.9em; padding-top:40px;">
            ${T('ArmyManager.emptyArmy')}
        </div>
    `;
  }

  // Selected troop dossier
  let dossierHTML = "";
  if (this._activeTab === 'troops' && troops[this._troopIndex]) {
    const baseTroop = troops[this._troopIndex];
    const troop = $gameArmy.getTroopWithBonuses(baseTroop.id);
    const name = useItalian && troop.name_it ? troop.name_it : troop.name;
    const faction = $gameFactions ? $gameFactions.getFaction(troop.factionId) : null;
    const factionName = faction ? (useItalian && faction.name_it ? faction.name_it : faction.name) : T('ArmyManager.independent');

    const leaderText = troop.hasLeader ? `
        <div style="margin-bottom: 6px; font-family:'Lora', serif; font-size:0.85em; color:var(--text-text-alt-17); font-weight:bold; text-align:center;">
             ${T('ArmyManager.ledByCommander', { name: troop.leaderName })}
        </div>
    ` : "";

    const stats = [
      { label: getStatLabel("HP"), base: baseTroop.hp, val: troop.hp },
      { label: getStatLabel("MP"), base: baseTroop.mp, val: troop.mp },
      { label: getStatLabel("ATK"), base: baseTroop.atk, val: troop.atk },
      { label: getStatLabel("DEF"), base: baseTroop.def, val: troop.def },
      { label: getStatLabel("MAT"), base: baseTroop.mat, val: troop.mat },
      { label: getStatLabel("MDF"), base: baseTroop.mdf, val: troop.mdf },
      { label: getStatLabel("AGI"), base: baseTroop.agi, val: troop.agi },
      { label: getStatLabel("LUK"), base: baseTroop.luk, val: troop.luk }
    ];

    let statsGrid = "";
    stats.forEach(st => {
      const bonus = st.val - st.base;
      const bonusSpan = bonus > 0 ? `<span class="stat-bonus">(+${bonus})</span>` : "";
      statsGrid += `
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-primary-hover-translucent-15); padding:4px 0;">
                <span style="font-weight:bold; font-family:'Lora', serif; color:var(--text-primary-hover); font-size:0.95em;">${st.label}:</span>
                <span style="font-family:'Lora', serif; font-size:0.9em; font-weight:bold; color:var(--text-muted-hover);">${st.val} ${bonusSpan}</span>
            </div>
        `;
    });

    dossierHTML = `
        <div class="army-card" style="margin-top: 15px; animation: fadeIn 0.3s ease;">
            <h3 style="margin:0 0 4px 0; font-family:'Lora', serif; color:var(--text-primary-hover); font-size:1.15em; text-align:center; font-weight:bold;">
                ${name}
            </h3>
            <div style="font-style:italic; font-size:0.82em; color:var(--text-card-medium); text-align:center; margin-bottom:8px;">
                Regiment: ${factionName}
            </div>
            
            ${leaderText}

            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:6px 16px;">
                ${statsGrid}
            </div>
            
            <div style="display:flex; justify-content:space-between; margin-top:10px; padding-top:6px; border-top:1px solid var(--border-primary-hover-translucent-15); font-family:'Lora', serif; font-size:0.82em;">
                <span>${T('ArmyManager.hiringBounty')} <strong>€${(troop.hiringCost / 100).toFixed(2)}</strong></span>
                <span>${T('ArmyManager.upkeep')} <strong>€${(troop.weeklyCost / 100).toFixed(2)}${T('ArmyManager.perWeekShort')}</strong></span>
            </div>
            <div style="text-align:center; margin-top:8px; font-size:0.8em; color:var(--accent-red-2); font-weight:bold;">
                ${T('ArmyManager.pressOkToRelease')}
            </div>
        </div>
    `;
  } else {
    dossierHTML = `
        <div class="prophecy-pane" style="text-align:center; color:var(--text-card-medium); font-style:italic; font-size:0.88em; margin-top:15px; min-height:140px;">
            ${T('ArmyManager.dossierHint')}
        </div>
    `;
  }

  // Cursive parchment confirmation box overlay
  let confirmDialogHTML = "";
  if (this._confirmOpen && this._troopToRelease) {
    const name = useItalian && this._troopToRelease.name_it ? this._troopToRelease.name_it : this._troopToRelease.name;
    confirmDialogHTML = `
        <div class="army-dialog-overlay">
            <div class="army-dialog">
                <h3>${T('ArmyManager.releaseTitle')}</h3>
                <p>${T('ArmyManager.releaseBody', { name: `<strong>${name}</strong>` })}</p>
                <div class="army-dialog-buttons">
                    <button class="army-dialog-btn ${this._confirmChoice === 'yes' ? 'selected' : ''}" onclick="SceneManager._scene.confirmRelease('yes')">${T('ArmyManager.yes')}</button>
                    <button class="army-dialog-btn ${this._confirmChoice === 'no' ? 'selected' : ''}" onclick="SceneManager._scene.confirmRelease('no')">${T('ArmyManager.no')}</button>
                </div>
            </div>
        </div>
    `;
  }

  this._dndContainer.innerHTML = `
    <div class="book-spread">
        <!-- Left Page: Overview & Commands -->
        <div class="left-page" style="display:flex; flex-direction:column; justify-content:space-between;">
            <div>
                <div class="page-header-bar">
                    <div class="back-button focusable" onclick="SceneManager._scene.leaveCamp()">${useItalian ? 'Indietro' : 'Back'}</div>
                    <h2 class="title">${T('ArmyManager.armyOverview')}</h2>
                </div>

                <div class="vitals-box" style="padding:10px 14px; background:var(--bg-primary-hover-translucent-35); border:1px solid var(--border-primary-hover-translucent-15); margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; font-family:'Lora', serif; font-size:0.85em; color:var(--text-muted-hover); margin-bottom:4px;">
                        <span>${T('ArmyManager.companyStrength')}</span>
                        <span style="font-weight:bold;">${T('ArmyManager.troopsOf', { count: troopCount, max: maxTroops })}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-family:'Lora', serif; font-size:0.85em; color:var(--text-muted-hover); margin-bottom:4px;">
                        <span>${T('ArmyManager.weeklyBaseUpkeep')}</span>
                        <span style="font-weight:bold; color:var(--text-cost-bad);">€${weeklyEuros}</span>
                    </div>
                    <div style="font-family:'Lora', serif; font-size:0.82em; color:var(--text-primary-hover); font-weight:bold; display:flex; justify-content:space-between; margin-top:6px;">
                        <span>${T('ArmyManager.militaryCoherence')}</span>
                        <span style="color:${coherenceColor};">${coherence}%</span>
                    </div>
                    <div class="coherence-bar-outer">
                        <div class="coherence-bar-fill" style="width: ${coherence}%; background: ${coherenceColor};"></div>
                    </div>
                </div>

                <div class="choices-scroll" style="margin-bottom:12px;">
                    ${commandsHTML}
                </div>

                <div class="army-card" style="padding: 8px 12px; max-height:160px; overflow-y:auto;">
                    <h4 style="margin:0 0 4px 0; font-family:'Lora', serif; font-size:0.9em; color:var(--text-primary-hover); border-bottom:1px solid var(--border-primary-hover-translucent-15); padding-bottom:3px; font-weight:bold;">
                        ${T('ArmyManager.regimentalBreakdown')}
                    </h4>
                    <table class="army-table">
                        <thead>
                            <tr>
                                <th>${T('ArmyManager.factionRegiment')}</th>
                                <th style="text-align:right;">${T('ArmyManager.troops')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${factionRows}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style="font-family:'Lora', serif; font-size:0.8em; color:var(--text-card-medium); font-style:italic; text-align:center; border-top:1px dashed var(--border-primary-hover-translucent-15); padding-top:6px; margin-top:auto; margin-bottom:0;">
                Mount & Blade Army Manual ✦ Esoteric Industries
            </div>
        </div>

        <!-- Right Page: Roster & Dossier -->
        <div class="right-page" style="display:flex; flex-direction:column; justify-content:space-between; height:100%;">
            <div>
                <h2 class="title">${this._activeTab === 'troops' ? T('ArmyManager.companyRoster') : T('ArmyManager.companyDossier')}</h2>
                
                <div class="choices-scroll" style="max-height:210px; overflow-y:auto; padding-right:4px;">
                    ${rosterHTML}
                </div>

                ${dossierHTML}
            </div>
        </div>
    </div>
    ${confirmDialogHTML}
  `;
};

// Single source of truth for the left-page command cards. "Leave Camp" is no
// longer a card: the standard .back-button in the page header handles it.
Scene_Army.prototype.commandList = function () {
  return [
    { label: T('ArmyManager.reviewTroops'), key: "troops" },
    { label: T('ArmyManager.manageSquads'), key: "squads" }
  ];
};

Scene_Army.prototype.leaveCamp = function () {
  if (this._confirmOpen) return;
  SoundManager.playCancel();
  this.popScene();
};

Scene_Army.prototype.clickCommand = function (index) {
  if (this._confirmOpen) return;
  this._commandIndex = index;
  this._activeTab = 'commands';
  this.handleCommandOk();
};

Scene_Army.prototype.clickTroop = function (index) {
  if (this._confirmOpen) return;
  this._troopIndex = index;
  this._activeTab = 'troops';
  this.refreshUIDOM();
};

Scene_Army.prototype.handleCommandOk = function () {
  if (this._commandIndex === 0) {
    // Review Troops
    const troops = $gameArmy.getTroops();
    if (troops.length > 0) {
      SoundManager.playOk();
      this._activeTab = 'troops';
      this._troopIndex = 0;
      this.refreshUIDOM();
    } else {
      SoundManager.playBuzzer();
    }
  } else if (this._commandIndex === 1) {
    // Manage Squads
    SoundManager.playOk();
    SceneManager.push(Scene_Squads);
  }
};

Scene_Army.prototype.promptReleaseTroop = function (index) {
  const troops = $gameArmy.getTroops();
  const troop = troops[index];
  if (troop) {
    SoundManager.playOk();
    this._confirmOpen = true;
    this._confirmChoice = 'no';
    this._troopToRelease = troop;
    this.refreshUIDOM();
  }
};

Scene_Army.prototype.confirmRelease = function (choice) {
  this._confirmChoice = choice;
  this.handleConfirmOk();
};

Scene_Army.prototype.handleConfirmOk = function () {
  if (this._confirmChoice === 'yes' && this._troopToRelease) {
    SoundManager.playOk();
    $gameArmy.removeTroop(this._troopToRelease.id);
    this._confirmOpen = false;
    this._troopToRelease = null;

    // adjust index
    const troops = $gameArmy.getTroops();
    if (this._troopIndex >= troops.length) {
      this._troopIndex = Math.max(0, troops.length - 1);
    }

    if (troops.length === 0) {
      this._activeTab = 'commands';
    }

    this.refreshUIDOM();
  } else {
    SoundManager.playCancel();
    this._confirmOpen = false;
    this._troopToRelease = null;
    this.refreshUIDOM();
  }
};

Scene_Army.prototype.terminate = function () {
  Scene_MenuBase.prototype.terminate.call(this);
  UIArmyInputManager.deactivate();
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

//=============================================================================
// Scene_BuyTroops - Troop recruitment scene
//=============================================================================

Scene_BuyTroops.prototype.create = function () {
  loadUIArmyResources();
  Scene_MenuBase.prototype.create.call(this);

  if (this._windowLayer) {
    this._windowLayer.visible = false;
  }
  if (this._cancelButton) {
    this._cancelButton.visible = false;
  }

  this._selectedIndex = 0;
  this._feedbackText = "";
  this._feedbackTimer = null;

  this.createDummyWindows();
  this.createUIDOM();
};

Scene_BuyTroops.prototype.createDummyWindows = function () {
  const rect = new Rectangle(0, 0, 0, 0);
  this._helpWindow = new Window_Help(rect);
  this._goldWindow = new Window_Gold(rect);
  this._troopShopWindow = new Window_TroopShop(rect);
  this._statsWindow = new Window_RecruitStats(rect);
  this._helpWindow.visible = false;
  this._goldWindow.visible = false;
  this._troopShopWindow.visible = false;
  this._statsWindow.visible = false;
  this.addWindow(this._helpWindow);
  this.addWindow(this._goldWindow);
  this.addWindow(this._troopShopWindow);
  this.addWindow(this._statsWindow);

  this._troopShopWindow.setFactionFilter(this._factionId);
};

Scene_BuyTroops.prototype.createUIDOM = function () {
  this._dndContainer = document.createElement('div');
  this._dndContainer.id = 'menu-container';
  document.body.appendChild(this._dndContainer);

  UIBuyTroopsInputManager.init(this._dndContainer, this);
  UIBuyTroopsInputManager.activate();
  this.refreshUIDOM();
};

Scene_BuyTroops.prototype.refreshUIDOM = function () {
  if (!this._dndContainer) return;

  const shop = this._troopShopWindow;
  const list = shop._data || [];
  const useItalian = ConfigManager.language === 'it';
  const playerGold = $gameParty.gold();
  const playerEuros = (playerGold / 100).toFixed(2);
  const troopCount = $gameArmy.getTroopCount();
  const maxTroops = ArmyManager.Params.maxArmySize;

  // Build shop items list
  let itemsHTML = "";
  if (list.length > 0) {
    list.forEach((item, index) => {
      const troop = item.troop;
      const isSelected = index === this._selectedIndex;
      const name = useItalian && troop.name_it ? troop.name_it : troop.name;
      const hiringPrice = (troop.hiringCost / 100).toFixed(2);
      const canAfford = playerGold >= troop.hiringCost;

      const roleIcon = armyRoleIconHTML(troop.role);

      itemsHTML += `
            <div class="choice-card ${isSelected ? 'selected' : ''}" style="display:flex; justify-content:space-between; align-items:center; opacity: ${canAfford ? 1 : 0.6};" onclick="SceneManager._scene.clickShopItem(${index})">
                <span class="role-badge">${roleIcon} ${name}</span>
                <span style="font-size:0.88em; font-family:'Lora', serif; font-weight:bold; color: ${canAfford ? 'var(--text-primary-hover)' : 'var(--text-disabled)'};">€${hiringPrice}</span>
            </div>
        `;
    });
  } else {
    itemsHTML = `
        <div style="text-align:center; font-style:italic; color:var(--text-card-medium); padding-top:40px;">
            ${T('ArmyManager.noLocalTroops')}
        </div>
    `;
  }

  // Selected troop detailed dossier (Left Page)
  let selectedDossierHTML = "";
  if (list[this._selectedIndex]) {
    const item = list[this._selectedIndex];
    const troop = item.troop;
    const name = useItalian && troop.name_it ? troop.name_it : troop.name;
    const faction = $gameFactions ? $gameFactions.getFaction(item.factionId) : null;
    const factionName = faction ? (useItalian && faction.name_it ? faction.name_it : faction.name) : T('ArmyManager.independent');

    const stats = [
      { label: getStatLabel("HP"), val: troop.hp },
      { label: getStatLabel("MP"), val: troop.mp },
      { label: getStatLabel("ATK"), val: troop.atk },
      { label: getStatLabel("DEF"), val: troop.def },
      { label: getStatLabel("MAT"), val: troop.mat },
      { label: getStatLabel("MDF"), val: troop.mdf },
      { label: getStatLabel("AGI"), val: troop.agi },
      { label: getStatLabel("LUK"), val: troop.luk }
    ];

    let statsGrid = "";
    stats.forEach(st => {
      statsGrid += `
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-primary-hover-translucent-15); padding:4px 0;">
                <span style="font-weight:bold; font-family:'Lora', serif; color:var(--text-primary-hover); font-size:0.95em;">${st.label}:</span>
                <span style="font-family:'Lora', serif; font-size:0.9em; font-weight:bold; color:var(--text-muted-hover);">${st.val}</span>
            </div>
        `;
    });

    selectedDossierHTML = `
        <div class="army-card" style="margin-top: 15px; animation: fadeIn 0.25s ease;">
            <h3 style="margin:0 0 3px 0; font-family:'Lora', serif; color:var(--text-primary-hover); font-size:1.15em; text-align:center; font-weight:bold;">
                ${name}
            </h3>
            <div style="font-style:italic; font-size:0.82em; color:var(--text-card-medium); text-align:center; margin-bottom:8px;">
                Faction: ${factionName}
            </div>

            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:6px 16px;">
                ${statsGrid}
            </div>
            
            <div style="display:flex; justify-content:space-between; margin-top:10px; padding-top:6px; border-top:1px solid var(--border-primary-hover-translucent-15); font-family:'Lora', serif; font-size:0.85em;">
                <span>${T('ArmyManager.hiringCost')} <strong style="color:var(--text-primary-hover);">€${(troop.hiringCost / 100).toFixed(2)}</strong></span>
                <span>${T('ArmyManager.upkeep')} <strong style="color:var(--text-text-alt-17);">€${(troop.weeklyCost / 100).toFixed(2)}${T('ArmyManager.perWeekShort')}</strong></span>
            </div>
        </div>
    `;
  } else {
    selectedDossierHTML = `
        <div class="prophecy-pane" style="text-align:center; color:var(--text-card-medium); font-style:italic; font-size:0.9em; margin-top:15px; min-height:140px;">
            ${T('ArmyManager.recruitHint')}
        </div>
    `;
  }

  // Interactive micro-feedback calligraphy notes
  const feedbackHTML = this._feedbackText ? `
    <div style="text-align:center; font-family:'Lora', serif; font-style:italic; font-size:0.85em; padding:8px; border:1px dashed var(--accent-gold-2); background:var(--bg-primary-hover-translucent-35); border-radius:4px; margin-top:10px; color:var(--text-primary-hover); animation:fadeIn 0.2s ease;">
         ${this._feedbackText}
    </div>
  ` : "";

  this._dndContainer.innerHTML = `
    <div class="book-spread">
        <!-- Left Page: Recruitment Station -->
        <div class="left-page" style="display:flex; flex-direction:column; justify-content:space-between;">
            <div>
                <div class="page-header-bar">
                    <div class="back-button focusable" onclick="SceneManager._scene.leaveCamp()">${T('ArmyManager.back')}</div>
                    <h2 class="title">${T('ArmyManager.recruitCamp')}</h2>
                </div>

                <div style="font-family: 'Lora', serif; font-size: 0.85em; color: var(--text-primary-hover); font-style: italic; background: var(--bg-primary-hover-translucent-35); border: 1px dashed var(--text-primary-hover); padding: 10px 14px; border-radius: 4px; margin-bottom: 12px; line-height: 1.4; text-align: justify;">
                    "${T('ArmyManager.recruitBlurb')}"
                </div>

                <div class="vitals-box" style="padding:10px 14px; background:var(--bg-primary-hover-translucent-35); border:1px solid var(--border-primary-hover-translucent-15); margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; font-family:'Lora', serif; font-size:0.85em; color:var(--text-muted-hover); margin-bottom:4px;">
                        <span>${T('ArmyManager.companyChest')}</span>
                        <span style="font-weight:bold; color:var(--text-cost-ok);">€${playerEuros}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-family:'Lora', serif; font-size:0.85em; color:var(--text-muted-hover); margin-bottom:4px;">
                        <span>${T('ArmyManager.regimentLimit')}</span>
                        <span style="font-weight:bold;">${T('ArmyManager.troopsOf', { count: troopCount, max: maxTroops })}</span>
                    </div>
                </div>

                ${selectedDossierHTML}
                ${feedbackHTML}
            </div>

            <div style="font-family:'Lora', serif; font-size:0.8em; color:var(--text-card-medium); font-style:italic; text-align:center; border-top:1px dashed var(--border-primary-hover-translucent-15); padding-top:6px; margin-top:auto; margin-bottom:0;">
                ${T('ArmyManager.escToCampPockets')}
            </div>
        </div>

        <!-- Right Page: Available Troops -->
        <div class="right-page" style="display:flex; flex-direction:column; height:100%;">
            <h2 class="title">${T('ArmyManager.hireMercenaries')}</h2>
            
            <div class="choices-scroll" style="max-height: 480px; overflow-y:auto; padding-right:4px; margin-top:10px;">
                ${itemsHTML}
            </div>
        </div>
    </div>
  `;
};

Scene_BuyTroops.prototype.leaveCamp = function () {
  SoundManager.playCancel();
  this.popScene();
};

Scene_BuyTroops.prototype.clickShopItem = function (index) {
  this._selectedIndex = index;
  this.refreshUIDOM();
  this.buyTroopAtIndex(index);
};

Scene_BuyTroops.prototype.buyTroopAtIndex = function (index) {
  const shop = this._troopShopWindow;
  const list = shop._data || [];
  const item = list[index];
  if (!item) return;

  if (!$gameArmy.canRecruitMore()) {
    SoundManager.playBuzzer();
    this.showFeedback(T('ArmyManager.atCapacity'));
    return;
  }

  if ($gameParty.gold() < item.troop.hiringCost) {
    SoundManager.playBuzzer();
    this.showFeedback(T('ArmyManager.noMoney'));
    return;
  }

  // Buy troop
  $gameParty.loseGold(item.troop.hiringCost);
  $gameArmy.addTroop(item.factionId, item.troop);

  // Faction reputation bonus
  if ($gameFactions && item.factionId !== undefined && item.factionId >= 0) {
    $gameFactions.changeReputation(item.factionId, 1);
  }

  SoundManager.playShop();

  const useItalian = ConfigManager.language === 'it';
  const troopName = useItalian && item.troop.name_it ? item.troop.name_it : item.troop.name;
  this.showFeedback(T('ArmyManager.contracted', { name: troopName }));
};

Scene_BuyTroops.prototype.showFeedback = function (text) {
  this._feedbackText = text;
  this.refreshUIDOM();

  if (this._feedbackTimer) clearTimeout(this._feedbackTimer);
  this._feedbackTimer = setTimeout(() => {
    this._feedbackText = "";
    this.refreshUIDOM();
  }, 3000);
};

Scene_BuyTroops.prototype.terminate = function () {
  Scene_MenuBase.prototype.terminate.call(this);
  UIBuyTroopsInputManager.deactivate();
  if (this._feedbackTimer) clearTimeout(this._feedbackTimer);
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

//=============================================================================
// Scene_Squads - Squad management scene
//=============================================================================

Scene_Squads.prototype.create = function () {
  loadUIArmyResources();
  Scene_MenuBase.prototype.create.call(this);

  if (this._windowLayer) {
    this._windowLayer.visible = false;
  }
  if (this._cancelButton) {
    this._cancelButton.visible = false;
  }

  // Auto organize
  $gameArmy.autoOrganizeSquads();

  this._activeTab = 'squads'; // 'squads' or 'leaders'
  this._squadIndex = 0;
  this._leaderIndex = 0;
  this._leadersList = [];

  this.createDummyWindows();
  this.createUIDOM();
};

Scene_Squads.prototype.createDummyWindows = function () {
  const rect = new Rectangle(0, 0, 0, 0);
  this._helpWindow = new Window_Help(rect);
  this._squadListWindow = new Window_SquadList(rect);
  this._leaderSelectWindow = new Window_LeaderSelect(rect);
  this._helpWindow.visible = false;
  this._squadListWindow.visible = false;
  this._leaderSelectWindow.visible = false;
  this.addWindow(this._helpWindow);
  this.addWindow(this._squadListWindow);
  this.addWindow(this._leaderSelectWindow);
};

Scene_Squads.prototype.createUIDOM = function () {
  this._dndContainer = document.createElement('div');
  this._dndContainer.id = 'menu-container';
  document.body.appendChild(this._dndContainer);

  UISquadsInputManager.init(this._dndContainer, this);
  UISquadsInputManager.activate();
  this.refreshUIDOM();
};

Scene_Squads.prototype.refreshLeaderList = function () {
  const squads = $gameArmy.getSquads();
  const squad = squads[this._squadIndex];
  if (!squad) {
    this._leadersList = [];
    return;
  }

  this._leadersList = [];
  if (squad.leaderId) {
    this._leadersList.push({ actorId: -1, name: T('ArmyManager.removeLeader') });
  }

  const members = $gameParty.members();
  members.forEach(member => {
    this._leadersList.push({ actorId: member.actorId(), name: member.name() });
  });
};

Scene_Squads.prototype.refreshUIDOM = function () {
  if (!this._dndContainer) return;

  const squads = $gameArmy.getSquads();
  const useItalian = ConfigManager.language === 'it';

  // Left Page: Squad list
  let squadsHTML = "";
  if (squads.length > 0) {
    squads.forEach((sq, idx) => {
      const isSelected = this._activeTab === 'squads' && idx === this._squadIndex;
      let leaderName = T('ArmyManager.noOfficer');
      if (sq.leaderId) {
        const actor = $gameActors.actor(sq.leaderId);
        if (actor) leaderName = T('ArmyManager.leaderNamed', { name: actor.name() });
      }

      squadsHTML += `
            <div class="choice-card ${isSelected ? 'selected' : ''}" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px;" onclick="SceneManager._scene.clickSquad(${idx})">
                <span class="role-badge">${sq.name} ${T.n('ArmyManager.troopCount', sq.troopIds.length, { n: sq.troopIds.length })}</span>
                <span style="font-size:0.82em; font-family:'Lora', serif; font-weight:bold; color:var(--text-text-alt-17);">${leaderName}</span>
            </div>
        `;
    });
  } else {
    squadsHTML = `
        <div style="text-align:center; font-style:italic; color:var(--text-card-medium); padding-top:40px;">
            ${T('ArmyManager.noSquads')}
        </div>
    `;
  }

  // Right Page: Leader selections
  let leadersHTML = "";
  if (this._activeTab === 'leaders') {
    const squad = squads[this._squadIndex];
    this.refreshLeaderList();

    this._leadersList.forEach((item, index) => {
      const isSelected = index === this._leaderIndex;
      const isRemove = item.actorId === -1;

      let statusText = "";
      let isLeadingOther = false;

      if (!isRemove) {
        isLeadingOther = $gameArmy.getSquads().some(s => s.leaderId === item.actorId && s.id !== squad.id);
        if (isLeadingOther) {
          statusText = `<span style="font-size:0.8em; color:var(--text-disabled); font-style:italic;">${T('ArmyManager.leadingOtherSquad')}</span>`;
        }
      }

      leadersHTML += `
            <div class="choice-card ${isSelected ? 'selected' : ''}" style="display:flex; justify-content:space-between; align-items:center; opacity: ${isLeadingOther ? 0.5 : 1};" onclick="SceneManager._scene.clickLeader(${index})">
                <span style="font-family:'Lora', serif; font-weight:bold; color: ${isRemove ? 'var(--text-text-alt-5-hover)' : 'var(--text-muted-hover)'};">${item.name}</span>
                ${statusText}
            </div>
        `;
    });
  } else {
    leadersHTML = `
        <div style="text-align:center; color:var(--text-card-medium); font-style:italic; font-size:0.9em; padding-top:40px;">
            ${T('ArmyManager.squadHint')}
        </div>
    `;
  }

  this._dndContainer.innerHTML = `
    <div class="book-spread">
        <!-- Left Page: Regimental Squads -->
        <div class="left-page" style="display:flex; flex-direction:column; justify-content:space-between;">
            <div>
                <div class="page-header-bar">
                    <div class="back-button focusable" onclick="SceneManager._scene.leaveCamp()">${T('ArmyManager.back')}</div>
                    <h2 class="title">${T('ArmyManager.squadOfficers')}</h2>
                </div>

                <div style="font-family: 'Lora', serif; font-size: 0.85em; color: var(--text-primary-hover); font-style: italic; background: var(--bg-primary-hover-translucent-35); border: 1px dashed var(--text-primary-hover); padding: 10px 14px; border-radius: 4px; margin-bottom: 12px; line-height: 1.4; text-align: justify;">
                    "${T('ArmyManager.squadBlurb')}"
                </div>

                <div class="choices-scroll" style="max-height: 320px; overflow-y:auto; padding-right:4px;">
                    ${squadsHTML}
                </div>
            </div>

            <div style="font-family:'Lora', serif; font-size:0.8em; color:var(--text-card-medium); font-style:italic; text-align:center; border-top:1px dashed var(--border-primary-hover-translucent-15); padding-top:6px; margin-top:auto; margin-bottom:0;">
                ${T('ArmyManager.escToCompanyCamp')}
            </div>
        </div>

        <!-- Right Page: Officer Assignment -->
        <div class="right-page" style="display:flex; flex-direction:column; height:100%;">
            <h2 class="title">${T('ArmyManager.assignOfficer')}</h2>
            
            <div class="choices-scroll" style="max-height: 480px; overflow-y:auto; padding-right:4px; margin-top:10px;">
                ${leadersHTML}
            </div>
        </div>
    </div>
  `;
};

Scene_Squads.prototype.leaveCamp = function () {
  SoundManager.playCancel();
  this.popScene();
};

Scene_Squads.prototype.clickSquad = function (index) {
  this._squadIndex = index;
  this._activeTab = 'leaders';
  this._leaderIndex = 0;
  SoundManager.playOk();
  this.refreshUIDOM();
};

Scene_Squads.prototype.clickLeader = function (index) {
  this._leaderIndex = index;
  this.selectLeaderAtIndex(index);
};

Scene_Squads.prototype.selectLeaderAtIndex = function (index) {
  this.refreshLeaderList();
  const squad = $gameArmy.getSquads()[this._squadIndex];
  const item = this._leadersList[index];
  if (!squad || !item) return;

  // Verify leader isn't busy
  if (item.actorId !== -1) {
    const isLeadingOther = $gameArmy.getSquads().some(s => s.leaderId === item.actorId && s.id !== squad.id);
    if (isLeadingOther) {
      SoundManager.playBuzzer();
      return;
    }
  }

  // Set leader
  if (item.actorId === -1) {
    $gameArmy.removeLeaderFromSquad(squad.id);
  } else {
    $gameArmy.assignLeaderToSquad(squad.id, item.actorId);
  }

  SoundManager.playUseSkill();
  this._activeTab = 'squads';
  this.refreshUIDOM();
};

Scene_Squads.prototype.terminate = function () {
  Scene_MenuBase.prototype.terminate.call(this);
  UISquadsInputManager.deactivate();
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

//=============================================================================
// Scene Updates
//=============================================================================

const _Scene_Army_update = Scene_Army.prototype.update;
Scene_Army.prototype.update = function () {
  _Scene_Army_update.call(this);
  UIArmyInputManager.update();
};

const _Scene_BuyTroops_update = Scene_BuyTroops.prototype.update;
Scene_BuyTroops.prototype.update = function () {
  _Scene_BuyTroops_update.call(this);
  UIBuyTroopsInputManager.update();
};

const _Scene_Squads_update = Scene_Squads.prototype.update;
Scene_Squads.prototype.update = function () {
  _Scene_Squads_update.call(this);
  UISquadsInputManager.update();
};

//=============================================================================
// Plugin Commands
//=============================================================================

PluginManager.registerCommand("ArmyManager", "buyTroops", args => {
  const factionId = Number(args.factionId || -1);
  SceneManager.push(Scene_BuyTroops);
  SceneManager.prepareNextScene(factionId);
});

// Grants up to `count` troops of random types, all belonging to `factionId`,
// respecting the army size cap. Used by the character-creation Faction
// Leader / Deserter origins (player-chosen faction) as well as any other
// caller that wants a "starting roster from this faction" grant. Returns the
// number of troops actually added.
ArmyManager.grantRandomTroops = function (factionId, count) {
  const faction = $gameFactions ? $gameFactions.getFaction(factionId) : null;
  if (!faction || !faction.troops || !faction.troops.length) return 0;
  let granted = 0;
  for (let i = 0; i < count; i++) {
    if (!$gameArmy.canRecruitMore()) break;
    const troop = faction.troops[Math.floor(Math.random() * faction.troops.length)];
    $gameArmy.addTroop(factionId, troop);
    granted++;
  }
  return granted;
};

// Grants up to `count` troops of random types from random eligible factions
// (any faction with a non-empty troop roster), for a faction-agnostic
// "independent" starting army. Used by the Independent Warlord origin.
// Returns the number of troops actually added.
ArmyManager.grantRandomTroopsMixed = function (count) {
  const allFactions = $gameFactions ? $gameFactions.getAllFactions() : [];
  const eligible = allFactions.filter(f => f.troops && f.troops.length);
  if (!eligible.length) return 0;
  let granted = 0;
  for (let i = 0; i < count; i++) {
    if (!$gameArmy.canRecruitMore()) break;
    const faction = eligible[Math.floor(Math.random() * eligible.length)];
    const troop = faction.troops[Math.floor(Math.random() * faction.troops.length)];
    $gameArmy.addTroop(faction.id, troop);
    granted++;
  }
  return granted;
};

PluginManager.registerCommand("ArmyManager", "debugAddTroops", args => {
  const allFactions = $gameFactions ? $gameFactions.getAllFactions() : [];
  const factionsWithTroops = allFactions.filter(f => f.troops && f.troops.length > 0);

  if (factionsWithTroops.length === 0) {
    console.warn("[ArmyManager] No factions with troops available!");
    return;
  }

  const randomFaction = factionsWithTroops[Math.floor(Math.random() * factionsWithTroops.length)];
  const useItalian = ConfigManager.language === 'it';
  const factionName = useItalian && randomFaction.name_it ? randomFaction.name_it : randomFaction.name;

  let totalAdded = 0;
  const troopCounts = {};

  for (const troop of randomFaction.troops) {
    let addedCount = 0;

    for (let i = 0; i < 10; i++) {
      if ($gameArmy.canRecruitMore()) {
        $gameArmy.addTroop(randomFaction.id, troop);
        addedCount++;
        totalAdded++;
      } else {
        console.warn(`[ArmyManager] Army at max capacity! Only added ${totalAdded} troops total.`);
        break;
      }
    }

    if (addedCount > 0) {
      const troopName = useItalian && troop.name_it ? troop.name_it : troop.name;
      troopCounts[troopName] = addedCount;
    }

    if (!$gameArmy.canRecruitMore()) break;
  }

  for (const [troopName, count] of Object.entries(troopCounts)) {
  }
});
