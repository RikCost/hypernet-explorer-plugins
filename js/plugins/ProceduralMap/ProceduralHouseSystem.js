
/*:
 * @target MZ
 * @plugindesc Handles a system of procedural houses and multi-floor buildings.
 * @author Omni-Lex
 *
 * @param spawnRegionId
 * @text Spawn Region ID
 * @desc Region ID to spawn player at in house (default: 13)
 * @type number
 * @default 13
 *
 * @param lockDoors
 * @text Lock Doors
 * @desc When ON, all procedural house doors are locked and cannot be entered
 * @type boolean
 * @default false
 *
 * @command visitHouse
 * @text Visit House
 * @desc Transports the player to a house with modified NPCs
 *
 * @arg poolName
 * @text Pool Name
 * @desc The name of the house pool to use (leave empty for random from all pools)
 * @type string
 * @default
 *
 * @arg facing
 * @text Use Facing Direction
 * @desc When true, uses the tile the player is facing instead of event location
 * @type boolean
 * @default false
 *
 * @command exitHouse
 * @text Exit House
 * @desc Transports the player back to where they were before entering the house
 *
 * @command enterMultiBuilding
 * @text Enter Multi-Floor Building
 * @desc Transports the player to a procedurally generated multi-floor building.
 *
 * @arg baseFloorPool
 * @text Base Floor Pool
 * @desc The name of the house pool to use for the ground floor.
 * @type string
 *
 * @arg upperFloorsPool
 * @text Upper Floors Pool
 * @desc The name of the house pool to use for all other floors.
 * @type string
 *
 * @arg numFloors
 * @text Number of Floors
 * @desc The total number of floors in the building.
 * @type number
 * @min 1
 * @default 3
 *
 * @arg facing
 * @text Use Facing Direction
 * @desc When true, uses the tile the player is facing instead of event location
 * @type boolean
 * @default false
 *
 * @command NextFloor
 * @text Go to Next Floor
 * @desc Moves the player to the next floor in a multi-floor building.
 *
 * @command PreviousFloor
 * @text Go to Previous Floor
 * @desc Moves the player to the previous floor in a multi-floor building.
 *
 * @command Elevator
 * @text Open Elevator
 * @desc Shows a floor picker (every floor except the current) and rides to the chosen floor with a distance-based delay.
 */

(() => {
  "use strict";
  const pluginName = "ProceduralHouseSystem";

  window.ProceduralHouseSystem = {
      currentHouseSeed: null,
      getCurrentHouseSeed() {
          return this.currentHouseSeed;
      },
      housePoolParentIds: [1132, 1133, 1134, 1135, 1136, 1137, 1394, 1156, 1157],
      // Public helpers for NPCSimulationCore home assignment
      _selectHouse(seed, poolName) { return selectHouse(seed, poolName); },
      _getHouseList(poolName) { return getHouseList(poolName, true); },
      // ── Building identity (NPC residents) ────────────────────────────────
      // Descriptor of the building the player is currently inside: the town map
      // + entrance tile that identifies it, its pool/type, and which floor is
      // being shown. NPCSystem uses this to decide who lives (or hangs out)
      // here. Returns null when not inside a generated building.
      getCurrentBuilding() { return _currentBuilding; },
      getCurrentFloorIndex() { return _currentBuilding ? _currentBuilding.floorIndex : 0; },
      // A "public" building is a skyscraper: nobody lives there, the whole town
      // passes through it. Everything else is residential and gets occupants.
      isBuildingPublic(building) { return isBuildingPublic(building); },
      isPublicPool(poolName) { return isPublicPool(poolName); },
      isResidentialBuilding(building) { return isResidentialBuilding(building); },
      isPublicInteriorMap(mapId) { return isPublicInteriorMap(mapId); },
      normalizePoolName(poolName) { return normalizePoolName(poolName); },
      buildingKey(building, groupName) { return buildingKey(building, groupName); },
      floorInteriorMapId(building, floorIndex) { return floorInteriorMapId(building, floorIndex); },
      // ── Player ownership API (buying procedural houses, one floor at a time) ──
      isInsideHouse() { return getCurrentOwnershipKey() !== null; },
      getCurrentOwnershipKey() { return getCurrentOwnershipKey(); },
      // Per-instance container discriminator (ContainerSystem). The ownership key
      // (entrance map+tile, plus `_f<floor>` for multi-floor buildings) uniquely
      // identifies the physical building the player is currently inside, so each
      // reuse of a shared interior template keeps independent container loot.
      // Returns null when not inside a generated house/building.
      getContainerInstanceKey() { return getCurrentOwnershipKey(); },
      isCurrentFloorOwned() { return isCurrentFloorOwned(); },
      // Only <BuildRights: Owner> houses can be bought. Free houses already allow
      // building (no purchase needed) and Disabled houses can never be owned.
      canOfferPurchase() {
        return getCurrentOwnershipKey() !== null
          && getCurrentBuildRights() === 'Owner'  // i18n-ignore  note-tag value
          && !isCurrentFloorOwned();
      },
      getCurrentFloorPrice(opinion) { return getCurrentFloorPrice(opinion); },
      buyCurrentFloor() { return buyCurrentFloor(); },
      // Directly grants ownership of an entrance the player has not yet walked
      // into (used by FurnitureSystem's House tab: the door is bought and paid
      // for up front, before it is ever entered), so its interior opens with
      // <BuildRights: Owner> already satisfied instead of requiring a second,
      // in-house purchase.
      markEntranceOwned(mapId, x, y) { return markEntranceOwned(mapId, x, y); },
      // Read-only listing of every owned floor for the Assets pockets. Each entry
      // exposes the entrance map name + tile so the player can locate the deed.
      listOwnedHouses() { return listOwnedHouses(); },
      // Procedural-map interactive FEATURES: press action facing DoorHouse/
      // DoorInn/DoorShop/DoorSkyscraper/DoorDungeon to enter, or SignPark/SignBus
      // for camper recall / bus fast-travel (replaces the old tile-id matching).
      tryProcMapInteract(character) { return tryProcMapInteract(character); },
  };
  const parameters = PluginManager.parameters(pluginName);
  
  const parentMapConfig = {
    "houses": 1132,
    "skyscrapers": 1133,
    "huts": 1134,
    "villas": 1135,
    "floors": 1136,
    "skyfloors": 1137,
    "abandoned": 1394,
    "inns": 1156,
    "shops": 1157
  };
  
  const housePoolsJSON = {
    "abandoned": [1395, 1396, 1397],
    "houses": [638, 640, 641, 642, 643, 644, 648, 649, 651, 653, 653, 656],
    "huts": [646, 665, 669, 670, 673],
    "skyscrapers": [649, 671, 672],
    "villas": [644, 647, 650, 652, 655, 657, 658, 661, 662, 666, 668],
    "skyfloors": [1143, 1144, 1145, 1146, 1147, 1148, 1149, 1150, 1151],
    "floors": [1138, 1139, 1140, 1141, 1142, 1152, 1153, 1154, 1155],
    "inns": [1390,1391],
    "shops": [1392,1393]
  };
  
  let housePools = null;
  let housePoolsInitialized = false;

  function getChildMapsOfParent(parentId) {
    const childMaps = [];
    if (!$dataMapInfos) return childMaps;
    for (let i = 1; i < $dataMapInfos.length; i++) {
      const mapInfo = $dataMapInfos[i];
      if (mapInfo && mapInfo.parentId === parentId) {
        childMaps.push(i);
      }
    }
    return childMaps.sort((a, b) => a - b);
  }

  function generateAutomaticHousePools() {
    const pools = {};
    for (const [poolName, parentId] of Object.entries(parentMapConfig)) {
      pools[poolName] = getChildMapsOfParent(parentId);
    }
    return pools;
  }

  // The old "housePools" plugin parameter was removed. Pools are now derived
  // straight from parentMapConfig: each pool is the set of child maps of its
  // parent map in MapInfos (e.g. "inns" -> every map under parent 1156, "shops"
  // -> every map under 1157). This is what fixes visitHouse("inns") landing the
  // player in a normal house, the old param default carried no inns/shops keys,
  // so those pool names fell through to the "all houses" catch-all. housePoolsJSON
  // is only an emergency fallback for the rare case where map metadata is not
  // available at call time.
  function initializeHousePools() {
    if ($dataMapInfos) {
      const autoPools = generateAutomaticHousePools();
      const hasValidPools = Object.values(autoPools).some(maps => maps.length > 0);
      if (hasValidPools) return autoPools;
    }
    return housePoolsJSON;
  }

  function ensureHousePoolsInitialized() {
    if (!housePoolsInitialized) {
      housePools = initializeHousePools();
      housePoolsInitialized = true;
    }
  }

  // Storage
  const houseReturnPoints = {};
  const multiBuildingStructures = {};

  let _mapGroupsData = null;
  function loadMapGroupsData() {
    if (_mapGroupsData !== null) return;
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'js/db/WorldGen/MapGroups.json', false);
      xhr.send();
      _mapGroupsData = xhr.status === 200 ? JSON.parse(xhr.responseText) : {};
    } catch(e) {
      _mapGroupsData = {};
    }
  }

  function findPlaytestFallbackLocation() {
    loadMapGroupsData();
    const currentMapId = $gameMap.mapId();
    let groupBuildings = [];
    let allBuildings = [];
    let allGroupNames = [];
    for (const [name, group] of Object.entries(_mapGroupsData)) {
      const buildings = group.residentialBuildings || [];
      buildings.forEach(b => { allBuildings.push(b); allGroupNames.push(name); });
      if (group.maps && group.maps.includes(currentMapId)) {
        buildings.forEach(b => groupBuildings.push({ building: b, groupName: name }));
      }
    }
    if (groupBuildings.length > 0) {
      const pick = groupBuildings[Math.floor(Math.random() * groupBuildings.length)];
      return { building: pick.building, groupName: pick.groupName };
    }
    if (allBuildings.length === 0) return null;
    const idx = Math.floor(Math.random() * allBuildings.length);
    return { building: allBuildings[idx], groupName: allGroupNames[idx] };
  }

  // Session tracking
  let currentHouseSessionId = null;
  let currentMultiBuilding = null;
  let _postTransferActions = null;
  let _savedBgm = null;
  // Event that triggered the current door entry (so the open animation, now
  // driven by the plugin, can swing the right door). Captured per command call.
  let _callerEventId = 0;
  // Active door-open animation state, polled in Scene_Map.update.
  let _doorEntry = null;
  // Active elevator ride: screen fades to black, then after a distance-based
  // wait the floor transfer fires. Polled in Scene_Map.update.
  let _elevatorTransit = null;

  PluginManager.registerCommand(pluginName, "visitHouse", function (args) {
    if (doorEntryBusy()) return;
    _callerEventId = (typeof this.eventId === "function") ? this.eventId() : 0;
    // houseId/alwaysOpen are undeclared, optional extra args (not shown in the
    // Plugin Command GUI): FurnitureSystem-built doors set them so the door
    // always opens onto the SPECIFIC template the player bought (instead of
    // the normal seeded-random pick from the pool) and is never locked.
    const forcedId = args.houseId ? Number(args.houseId) : null;
    const forceOpen = args.alwaysOpen === "true" || args.alwaysOpen === true;
    visitHouse(args.poolName || "", args.facing === "true" || args.facing === true, forcedId, forceOpen);
  });

  PluginManager.registerCommand(pluginName, "exitHouse", (args) => {
    exitHouse();
  });

  PluginManager.registerCommand(pluginName, "enterMultiBuilding", function (args) {
    if (doorEntryBusy()) return;
    _callerEventId = (typeof this.eventId === "function") ? this.eventId() : 0;
    enterMultiBuilding(args.baseFloorPool, args.upperFloorsPool, Number(args.numFloors), args.facing === "true" || args.facing === true);
  });

  PluginManager.registerCommand(pluginName, "NextFloor", (args) => {
    changeFloor('next');
  });

  PluginManager.registerCommand(pluginName, "PreviousFloor", (args) => {
    changeFloor('previous');
  });

  PluginManager.registerCommand(pluginName, "Elevator", (args) => {
    openElevator();
  });

  function createLocationKey() {
    return `${$gameMap.mapId()}_${$gamePlayer.x}_${$gamePlayer.y}`;
  }

  function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  // Canonical world seed so generated buildings are consistent per world
  function getWorldSeed() {
    let historySeed = 19002001;
    if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
      historySeed = window.HistoryManager.getSeed();
    } else if (typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._historySeed !== undefined) {
      historySeed = $gameSystem._historySeed;
    }
    return historySeed >>> 0;
  }

  function createSeed(mapId, x, y) {
    return ((mapId * 1000000 + x * 1000 + y) ^ getWorldSeed()) >>> 0;
  }

  function getSeededRandomFromArray(array, seed) {
    if (array.length === 0) return null;
    const index = Math.floor(seededRandom(seed) * array.length);
    return array[index];
  }

  function getEventCoordinates(useFacing = false) {
    let eventX = $gamePlayer.x;
    let eventY = $gamePlayer.y;
    const frontX = $gamePlayer.x + ($gamePlayer.direction() === 6 ? 1 : $gamePlayer.direction() === 4 ? -1 : 0);
    const frontY = $gamePlayer.y + ($gamePlayer.direction() === 2 ? 1 : $gamePlayer.direction() === 8 ? -1 : 0);

    if (useFacing) {
      eventX = frontX;
      eventY = frontY;
    } else {
      const event = $gameMap.eventIdXy(frontX, frontY);
      if (event > 0) {
        eventX = frontX;
        eventY = frontY;
      }
    }
    return { x: eventX, y: eventY };
  }

  function getHouseList(poolName, excludeFloorPools = false) {
    ensureHousePoolsInitialized();
    const excludedPools = ['skyfloors', 'floors'];
    
    // Normalize poolName and handle singular/plural mapping
    let targetPoolName = poolName ? poolName.trim() : "";
    if (targetPoolName !== "") {
      if (housePools[targetPoolName]) {
        return [...housePools[targetPoolName]];
      }
      const pluralized = targetPoolName.endsWith('s') ? targetPoolName : (targetPoolName === 'house' ? 'houses' : targetPoolName + 's');
      if (housePools[pluralized]) {
        return [...housePools[pluralized]];
      }
    }

    if (!targetPoolName || targetPoolName === "") {
      const allHouses = new Set();
      Object.entries(housePools).forEach(([poolKey, poolMaps]) => {
        if (excludeFloorPools && excludedPools.includes(poolKey)) return;
        poolMaps.forEach(mapId => allHouses.add(mapId));
      });
      return Array.from(allHouses);
    }
    if (excludeFloorPools && excludedPools.includes(targetPoolName)) return getHouseList("", true);
    console.warn(`House pool "${poolName}" not found.`);
    return getHouseList("", excludeFloorPools);
  }

  function saveHouseReturnPoint(useFacing = false) {
    const eventCoords = getEventCoordinates(useFacing);
    const returnPoint = {
      mapId: $gameMap.mapId(),
      eventX: eventCoords.x,
      eventY: eventCoords.y,
      direction: $gamePlayer.direction(),
    };
    // A door on the procedural map: record the square it stands on, so leaving
    // the building puts the party back on that exact square. Taken here rather
    // than in the individual entry paths so every kind of entrance gets one --
    // single houses, tower blocks and everything that reaches this function.
    if ($gameMap.mapId() === PROC_MAP_ID) {
      const wmr = window.WorldMapReturn;
      if (wmr && typeof wmr.snapshotProcSurface === "function") {
        returnPoint.savedBiomeData = wmr.snapshotProcSurface();
      }
    }
    const sessionId = Date.now() + "_" + Math.random();
    houseReturnPoints[sessionId] = returnPoint;
    currentHouseSessionId = sessionId;
    return sessionId;
  }

  function selectHouse(seed, poolName) {
    const houseList = getHouseList(poolName, true);
    if (houseList.length === 0) return null;
    return getSeededRandomFromArray(houseList, seed);
  }

  // ── Building identity: residential vs. public ───────────────────────────────
  // Every building the player can walk into is either a HOME (a house, hut,
  // villa, abandoned shell, inn, shop, or a low-rise with residential floors),
  // which belongs to specific NPCs of the surrounding town, or a PUBLIC space
  // (a skyscraper and its upper floors), which belongs to nobody and is instead
  // frequented by the whole town at any hour. NPCSystem branches on this.
  //
  // Skyscraper interiors live under the "Skyscrapers" (1133) and "SkyScraper
  // Floors" (1137) parent maps, so the interior template alone is enough to
  // classify a building even when the entrance descriptor is unavailable. This
  // is what makes the rule hold for the hardcoded map pools as well as for
  // procedural towns.
  const PUBLIC_PARENT_IDS = [1133, 1137];
  const PUBLIC_POOLS = new Set(["skyscrapers", "skyfloors"]);

  // Pool names are authored inconsistently across map events ("skyscraper",
  // "skyscrapers", "house", ""), so normalize the same way getHouseList does.
  function normalizePoolName(poolName) {
    const n = String(poolName || "").trim().toLowerCase();
    if (!n) return "";
    if (n === "house") return "houses";
    return n.endsWith("s") ? n : n + "s";
  }

  function isPublicPool(poolName) {
    return PUBLIC_POOLS.has(normalizePoolName(poolName));
  }

  // Only private homes can be locked. The night lockpick/bash prompt (and the
  // lockDoors block) applies to the houses, villas and huts pools; every other
  // pool (shops, inns, skyscrapers, abandoned, floors, ...) is always visitable.
  const LOCKABLE_POOLS = new Set(["houses", "villas", "huts"]);

  function isLockablePool(poolName) {
    return LOCKABLE_POOLS.has(normalizePoolName(poolName));
  }

  // A door event whose Note contains "unlocked" is authored as permanently open:
  // it skips the lockDoors block and the night lockpick/bash prompt whatever its
  // pool is. Read from the event that issued the current entry command.
  function isCallerDoorUnlocked() {
    if (!_callerEventId || !$gameMap) return false;
    const ev = $gameMap.event(_callerEventId);
    const note = (ev && ev.event() && ev.event().note) || "";
    return /unlocked/i.test(note);
  }

  function isPublicInteriorMap(mapId) {
    if (!mapId || !$dataMapInfos || !$dataMapInfos[mapId]) return false;
    return PUBLIC_PARENT_IDS.includes($dataMapInfos[mapId].parentId);
  }

  function isBuildingPublic(building) {
    if (!building) return false;
    if (building.type === "enterMultiBuilding") {
      // enterMultiBuilding defaults an empty base pool to "skyscrapers", so an
      // untagged multi-floor entrance is a skyscraper too.
      if (isPublicPool(building.baseFloorPool || "skyscrapers")) return true;
    } else if (isPublicPool(building.poolName)) {
      return true;
    }
    return isPublicInteriorMap(building.interiorMapId);
  }

  // Inns and shops are commercial: they are staffed (see NPCSystem's <Shop>
  // handling), not lived in, so no townsperson is given one as an address.
  const COMMERCIAL_PARENT_IDS = [1156, 1157];
  const COMMERCIAL_POOLS = new Set(["inns", "shops"]);

  function buildingBasePool(building) {
    return building.type === "enterMultiBuilding"
      ? normalizePoolName(building.baseFloorPool || "skyscrapers")
      : normalizePoolName(building.poolName);
  }

  // True for the buildings that townspeople are actually assigned to live in:
  // houses, huts, villas, abandoned shells and residential walk-ups.
  function isResidentialBuilding(building) {
    if (!building) return false;
    if (isBuildingPublic(building)) return false;
    if (COMMERCIAL_POOLS.has(buildingBasePool(building))) return false;
    const interior = building.interiorMapId;
    if (interior && $dataMapInfos && $dataMapInfos[interior] &&
        COMMERCIAL_PARENT_IDS.includes($dataMapInfos[interior].parentId)) return false;
    return true;
  }

  // Stable identity for a physical building, used as the occupancy key. Map 636
  // is reused for every procedural world tile, so the settlement group name has
  // to be part of the key: without it two towns with a door on the same tile
  // would share residents.
  function buildingKey(building, groupName) {
    if (!building) return null;
    const g = groupName || building.groupName || "";
    return `${g}|${building.mapId}_${building.x}_${building.y}`;
  }

  // Which interior template a given floor of a building resolves to. Mirrors
  // generateMultiBuildingStructure exactly, so an NPC's home floor maps to the
  // same interior the player walks into. Used to give per-floor residents the
  // right homeMapId without having to enter the building first.
  function floorInteriorMapId(building, floorIndex = 0) {
    if (!building) return null;
    if (building.type !== 'enterMultiBuilding') {
      return selectHouse(building.seed, building.poolName || 'houses');
    }
    if (!floorIndex) {
      return selectHouse(building.seed, building.baseFloorPool || 'skyscrapers');
    }
    const upper = getHouseList(building.upperFloorsPool || 'skyfloors');
    return getSeededRandomFromArray(upper, building.seed + floorIndex * 777);
  }

  // The building the player is currently inside (null when outdoors). Kept in
  // sync by every entry point and by each floor change, and persisted with the
  // save alongside currentMultiBuilding.
  let _currentBuilding = null;

  function setCurrentBuilding(building) {
    _currentBuilding = building;
    window.ProceduralHouseSystem.currentHouseSeed = building ? building.seed : null;
  }

  // Floor moves keep the same physical building, only the shown floor changes.
  function setCurrentFloor(floorIndex, interiorMapId) {
    if (!_currentBuilding) return;
    _currentBuilding.floorIndex = floorIndex;
    _currentBuilding.interiorMapId = interiorMapId;
  }

  // ── Player ownership of procedural houses ──────────────────────────────────
  // Ownership is keyed by the building entrance plus the current floor index, so
  // each floor of a multi-floor building can be bought independently. Single
  // houses are floor 0. State lives on $gameSystem so it persists with saves.

  function _hashKey(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }

  // Reads the current map's <BuildRights: Free|Owner|Disabled> tag, preferring
  // FurnitureSystem's parser so both plugins agree. Defaults to Free.
  function getCurrentBuildRights() {
    if (window.FurnitureSystem?.getMapBuildRights) {
      return window.FurnitureSystem.getMapBuildRights();
    }
    const note = ($dataMap && $dataMap.note) || '';
    const m = note.match(/<BuildRights:\s*(\w+)>/i);
    // i18n-ignore-start  <BuildRights:> note-tag values
    if (!m) return 'Free';
    const v = m[1].toLowerCase();
    if (v === 'disabled') return 'Disabled';
    if (v === 'owner') return 'Owner';
    return 'Free';
    // i18n-ignore-end
  }

  function getCurrentOwnershipKey() {
    if (currentMultiBuilding) {
      return `${currentMultiBuilding.entranceKey}_f${currentMultiBuilding.currentFloorIndex}`;
    }
    const rp = houseReturnPoints[currentHouseSessionId];
    if (rp) return `${rp.mapId}_${rp.eventX}_${rp.eventY}_f0`;
    return null;
  }

  function getOwnedHouses() {
    if (typeof $gameSystem === 'undefined' || !$gameSystem) return {};
    if (!$gameSystem._ownedProcHouses) $gameSystem._ownedProcHouses = {};
    return $gameSystem._ownedProcHouses;
  }

  function isCurrentFloorOwned() {
    const key = getCurrentOwnershipKey();
    if (!key) return false;
    if (getOwnedHouses()[key]) return true;
    // Companion residences inherited on party-join grant build rights inside the
    // matching interior template (NPCSystemParty.registerNPCHouse). The home is an
    // abstract template assignment with no placed entrance, so the interior map id
    // is the only concrete signal available to match on.
    return isCurrentInheritedHouse();
  }

  function isCurrentInheritedHouse() {
    if (typeof $gameSystem === 'undefined' || !$gameSystem) return false;
    const list = $gameSystem._npcInheritedHouses;
    if (!Array.isArray(list) || !list.length) return false;
    const mapId = $gameMap ? $gameMap.mapId() : null;
    return mapId != null && list.some(h => h.mapId === mapId);
  }

  // Price in gold (100 gold = 1 euro). A stable per-floor base price is derived
  // from the ownership key and world seed, then discounted by NPC disposition:
  // +100 opinion gives a 50% discount, -100 adds a 50% surcharge.
  function getCurrentFloorPrice(opinion) {
    const key = getCurrentOwnershipKey();
    if (!key) return 0;
    const h = (_hashKey(key) ^ getWorldSeed()) >>> 0;
    const base = 30000 + Math.floor(seededRandom(h) * 60000); // 300€ .. 900€
    const op = Math.max(-100, Math.min(100, Number(opinion) || 0));
    const mult = 1 - (op / 200);
    return Math.max(1000, Math.round(base * mult / 100) * 100);
  }

  function buyCurrentFloor() {
    const key = getCurrentOwnershipKey();
    if (!key) return false;
    getOwnedHouses()[key] = {
      day: (typeof $gameVariables !== 'undefined' ? $gameVariables.value(113) : 0),
      gameMin: (typeof $gameVariables !== 'undefined' ? $gameVariables.value(114) : 0),
    };
    return true;
  }

  function markEntranceOwned(mapId, x, y) {
    const key = `${mapId}_${x}_${y}_f0`;
    getOwnedHouses()[key] = {
      day: (typeof $gameVariables !== 'undefined' ? $gameVariables.value(113) : 0),
      gameMin: (typeof $gameVariables !== 'undefined' ? $gameVariables.value(114) : 0),
    };
    return key;
  }

  // Returns every owned floor with its deterministic base value (gold) and the
  // entrance map name/coordinates. Ownership keys are `${mapId}_${x}_${y}_f${floor}`
  // where mapId/x/y identify the map and tile of the entrance event the player
  // used to enter, so the value can be looked up in $dataMapInfos.
  function listOwnedHouses() {
    const owned = getOwnedHouses();
    return Object.keys(owned).map(key => {
      const m = key.match(/^(\d+)_(\d+)_(\d+)_f(\d+)$/);
      const mapId = m ? Number(m[1]) : null;
      const x = m ? Number(m[2]) : null;
      const y = m ? Number(m[3]) : null;
      const floor = m ? Number(m[4]) : 0;
      const h = (_hashKey(key) ^ getWorldSeed()) >>> 0;
      const value = 30000 + Math.floor(seededRandom(h) * 60000); // gold (300-900 EUR)
      let mapName = T('ProceduralHouse.unknownLocation');
      if (mapId != null && $dataMapInfos && $dataMapInfos[mapId] && $dataMapInfos[mapId].name) {
        mapName = $dataMapInfos[mapId].name;
      }
      const rec = owned[key] || {};
      return { key, mapId, x, y, floor, value, mapName, day: rec.day, gameMin: rec.gameMin };
    });
  }

  function findEventByName(name) {
    return $gameMap.events().find(event => event && event.event() && event.event().name === name);
  }

  function updateStairVisibility() {
    if (!currentMultiBuilding) return;
    const floor = currentMultiBuilding.currentFloorIndex;
    const total = currentMultiBuilding.structure.totalFloors;
    // i18n-ignore-start  event names
    const upstairsEvent = findEventByName("Upstairs");
    const downstairsEvent = findEventByName("Downstairs");
    // i18n-ignore-end
    if (upstairsEvent && floor >= total - 1) $gameMap.event(upstairsEvent.eventId()).erase();
    if (downstairsEvent && floor <= 0) $gameMap.event(downstairsEvent.eventId()).erase();
    $gameMap.refresh();
  }

  function generateMultiBuildingStructure(seed, basePool, upperPool, numFloors) {
    const totalFloors = 1 + numFloors;
    const structure = { floors: [], totalFloors: totalFloors };
    const baseFloorList = getHouseList(basePool);
    const upperFloorsList = getHouseList(upperPool);
    if (baseFloorList.length === 0 || upperFloorsList.length === 0) return null;
  
    structure.floors.push(getSeededRandomFromArray(baseFloorList, seed));
    for (let i = 0; i < numFloors; i++) {
      structure.floors.push(getSeededRandomFromArray(upperFloorsList, seed + (i + 1) * 777));
    }
    return structure;
  }

  function findPositionWithRegionId(regionId) {
    if (!$dataMap) return { x: 0, y: 0 };
    for (let y = 0; y < $dataMap.height; y++) {
      for (let x = 0; x < $dataMap.width; x++) {
        if ($gameMap.regionId(x, y) === regionId) return { x, y };
      }
    }
    // Fallback: search for any passable tile starting from the center of the map
    const centerX = Math.floor($dataMap.width / 2);
    const centerY = Math.floor($dataMap.height / 2);
    if ($gameMap.isPassable(centerX, centerY, 2)) {
      return { x: centerX, y: centerY };
    }
    for (let y = 0; y < $dataMap.height; y++) {
      for (let x = 0; x < $dataMap.width; x++) {
        if ($gameMap.isPassable(x, y, 2)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  function findAllPositionsWithRegionId(regionId) {
    const positions = [];
    if (!$dataMap) return positions;
    for (let y = 0; y < $dataMap.height; y++) {
      for (let x = 0; x < $dataMap.width; x++) {
        if ($gameMap.regionId(x, y) === regionId) positions.push({ x, y });
      }
    }
    return positions;
  }

  function getSeededStairPositions(seed) {
    const positions = findAllPositionsWithRegionId(14);
    if (positions.length === 0) return { upstairs: null, downstairs: null };
    const idx1 = Math.floor(seededRandom(seed) * positions.length);
    const upstairs = positions[idx1];
    let downstairs;
    if (positions.length >= 2) {
      let idx2 = Math.floor(seededRandom(seed + 1337) * (positions.length - 1));
      if (idx2 >= idx1) idx2++;
      downstairs = positions[idx2];
    } else {
      downstairs = positions[idx1];
    }
    return { upstairs, downstairs };
  }

  function placeStairsAtSeededPosition(seed) {
    const { upstairs, downstairs } = getSeededStairPositions(seed);
    if (!upstairs) return;
    // i18n-ignore-start  event names
    const upstairsEvent = findEventByName("Upstairs");
    const downstairsEvent = findEventByName("Downstairs");
    // i18n-ignore-end
    if (upstairsEvent) upstairsEvent.locate(upstairs.x, upstairs.y);
    if (downstairsEvent) downstairsEvent.locate(downstairs.x, downstairs.y);
  }

  function getMapDirection(tagName) {
    if ($dataMap && $dataMap.note) {
      const match = $dataMap.note.match(new RegExp(`<${tagName}:(\\w+)>`, "i"));
      if (match) {
        switch (match[1].toLowerCase()) {
          case "down": return 2;
          case "left": return 4;
          case "right": return 6;
          case "up": return 8;
        }
      }
    }
    return null;
  }

  // Night runs from 20:00 to 06:00, matching the proc-map biome/ambience cutoff.
  function isNightTime() {
    try {
      if (window.TimeDateSystem && typeof window.TimeDateSystem.getGameTimeMinutes === 'function') {
        const dt = window.TimeDateSystem.getDateTimeFromMinutes(window.TimeDateSystem.getGameTimeMinutes());
        const hour = parseInt(dt.hours, 10);
        return hour >= 20 || hour < 6;
      }
    } catch (e) {}
    return false;
  }

  // Pending house-entry context while the night lockpick minigame is running.
  let _pendingNightHouse = null;

  // ── Bashed-door memory ──────────────────────────────────────────────────────
  // Once a door is bashed open it stays openable (no locked-door prompt) for one
  // in-game day. Keyed by the door tile so each entrance is tracked separately,
  // and stored on $gameSystem so it persists with saves.
  const BASH_OPEN_MINUTES = 1440; // a bashed door stays open for 24h game-time

  function getDoorKey(useFacing) {
    const c = getEventCoordinates(useFacing);
    return `${$gameMap.mapId()}_${c.x}_${c.y}`;
  }

  function getBashedDoors() {
    if (typeof $gameSystem === 'undefined' || !$gameSystem) return {};
    if (!$gameSystem._bashedDoors) $gameSystem._bashedDoors = {};
    return $gameSystem._bashedDoors;
  }

  function isTileBashedOpen(mapId, x, y) {
    const key = `${mapId}_${x}_${y}`;
    const bashedAt = getBashedDoors()[key];
    if (bashedAt === undefined) return false;
    const now = (typeof $gameVariables !== 'undefined') ? $gameVariables.value(114) : 0;
    if (now >= bashedAt && now - bashedAt <= BASH_OPEN_MINUTES) return true;
    delete getBashedDoors()[key]; // expired (or time rolled back) - relock
    return false;
  }

  function isDoorBashedOpen(useFacing) {
    const c = getEventCoordinates(useFacing);
    return isTileBashedOpen($gameMap.mapId(), c.x, c.y);
  }

  function markDoorBashed(useFacing) {
    const now = (typeof $gameVariables !== 'undefined') ? $gameVariables.value(114) : 0;
    getBashedDoors()[getDoorKey(useFacing)] = now;
  }

  // ── Door interaction trigger ─────────────────────────────────────────────────
  // A door's RMMZ trigger is chosen at runtime from its lock state:
  //   closed (locked) -> 0 Action Button  (deliberate press to get the menu, so
  //                       just bumping a locked door does nothing)
  //   open            -> 2 Event Touch    (walk into it and you go in)
  // The data trigger on these events is left as-is and simply overridden here.
  const TRIGGER_ACTION = 0;
  const TRIGGER_EVENT_TOUCH = 2;

  // A door event is any event whose active page runs a visitHouse /
  // enterMultiBuilding plugin command. Returns its facing flag and the pool it
  // leads into (so the lock rules can tell a home from a shop), or null.
  function eventDoorInfo(event) {
    if (!event || typeof event.page !== 'function') return null;
    const page = event.page();
    if (!page || !page.list) return null;
    for (const c of page.list) {
      if (c.code === 357 && String(c.parameters[0]).includes('ProceduralHouseSystem')) {
        const cmd = c.parameters[1];
        if (cmd === 'visitHouse' || cmd === 'enterMultiBuilding') {
          const a = c.parameters[3] || {};
          // enterMultiBuilding defaults an empty base pool to "skyscrapers".
          const poolName = cmd === 'enterMultiBuilding'
            ? (a.baseFloorPool || "skyscrapers")
            : (a.poolName || "");
          // FurnitureSystem-built player doors set this (undeclared, not shown
          // in the Plugin Command GUI): they are always open, never locked,
          // regardless of pool or time of day.
          const alwaysOpen = a.alwaysOpen === 'true' || a.alwaysOpen === true;
          return { useFacing: a.facing === 'true' || a.facing === true, poolName: poolName, alwaysOpen: alwaysOpen };
        }
      }
    }
    return null;
  }

  function isDoorClosedForEvent(event, poolName, alwaysOpen) {
    if (alwaysOpen) return false;
    if (!isLockablePool(poolName)) return false;
    if (parameters["lockDoors"] === "true") return true;
    if (!isNightTime()) return false;
    if (isTileBashedOpen($gameMap.mapId(), event.x, event.y)) return false;
    return true;
  }

  function applyDoorTrigger(event) {
    const info = eventDoorInfo(event);
    if (!info) return;
    event._trigger = isDoorClosedForEvent(event, info.poolName, info.alwaysOpen) ? TRIGGER_ACTION : TRIGGER_EVENT_TOUCH;
  }

  function refreshAllDoorTriggers() {
    if (typeof $gameMap === 'undefined' || !$gameMap || !$gameMap.events) return;
    for (const ev of $gameMap.events()) applyDoorTrigger(ev);
  }

  // A door entry already animating, or a transfer already reserved, must not be
  // restarted by the player bumping/touching the door again.
  function doorEntryBusy() {
    return _doorEntry !== null ||
      (typeof $gamePlayer !== 'undefined' && $gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring());
  }

  // Door triggers depend on time of day; flip them whenever night state changes
  // while the player stays on a map (map load already sets them via the page hook).
  let _lastDoorNightState = null;
  function updateDoorTriggersForTime() {
    const night = isNightTime();
    if (_lastDoorNightState === null) { _lastDoorNightState = night; return; }
    if (night !== _lastDoorNightState) {
      _lastDoorNightState = night;
      refreshAllDoorTriggers();
    }
  }

  // Override the page-derived trigger for door events on every page setup
  // (map load / page change), so doors start out with the correct interaction.
  const _Game_Event_setupPageSettings = Game_Event.prototype.setupPageSettings;
  Game_Event.prototype.setupPageSettings = function () {
    _Game_Event_setupPageSettings.call(this);
    applyDoorTrigger(this);
  };

  // ── Procedural-map interactive FEATURES (map 636) ────────────────────────────
  // Buildings, dungeons and signposts on the procedural map are used by pressing
  // the action button while FACING a terrain feature, resolved by name via
  // ProcGenUtils. This replaces the old tile-id -> common-event matching.
  //   DoorHouse      -> a 1-or-2-floor house      (seeded from the tile)
  //   DoorInn        -> an inn
  //   DoorShop       -> a shop
  //   DoorSkyscraper -> a 4-to-10-floor building  (seeded from the tile)
  //   DoorDungeon    -> a coordinate-seeded dungeon (Dungeon/Crypt/Sewer/... by biome)
  //   SignPark       -> recalls (summons) the camper to the player
  //   SignBus        -> the fast-travel map, boarding as a Bus
  const PROC_MAP_ID = 636;
  const INTERACT_FEATURES = new Set([
    "DoorHouse", "DoorInn", "DoorShop", "DoorSkyscraper", "DoorDungeon",
    "SignPark", "SignBus"
  ]);

  // tilesetId -> { tileId: featureName }, built lazily via ProcGenUtils.
  const _featureLookupCache = {};
  function getFeatureLookup(tilesetId) {
    if (_featureLookupCache[tilesetId]) return _featureLookupCache[tilesetId];
    const U = window.ProcGenUtils;
    if (!U || !U.Cache || !U.createTileToFeatureMap) return {};
    const map = U.createTileToFeatureMap(U.Cache.getTilesetFeatures(tilesetId));
    _featureLookupCache[tilesetId] = map;
    return map;
  }

  // Name of the interactive feature on the tile the character faces, or null.
  function facedInteractFeatureName(character) {
    const U = window.ProcGenUtils;
    if (!U || !$gameMap) return null;
    const tileset = $gameMap.tileset();
    const tilesetId = tileset ? tileset.id : 0;
    if (!tilesetId) return null;
    const d = character.direction();
    const x = $gameMap.roundXWithDirection(character.x, d);
    const y = $gameMap.roundYWithDirection(character.y, d);
    const lookup = getFeatureLookup(tilesetId);
    for (const z of [4, 3, 2]) {
      const tileId = $gameMap.tileId(x, y, z);
      if (tileId !== 0) {
        const name = U.getFeatureNameFromTileId(tileId, lookup);
        if (INTERACT_FEATURES.has(name)) return name;
      }
    }
    return null;
  }

  // A deterministic floor count in [min, max] derived from the faced door tile,
  // so the same door always leads to the same building layout.
  function seededFloorCount(useFacing, min, max, salt) {
    const c = getEventCoordinates(useFacing);
    const seed = (createSeed($gameMap.mapId(), c.x, c.y) ^ salt) >>> 0;
    return min + Math.floor(seededRandom(seed) * (max - min + 1));
  }

  // DoorHouse picks its interior pool from the surrounding chunk's biome: proper
  // settlements (City/Village/Burg, incl. their Desert/Ice/... variants) use the
  // normal townhouse pool, while any other biome (a lone farmstead, a hamlet on
  // a Plains/Forest/... tile, ...) gets a rural home instead, seeded from the
  // door tile so the same door always resolves to the same pool.
  function isSettlementBiomeName(name) {
    const n = (name || "").toLowerCase();
    return n.includes("city") || n.includes("village") || n.includes("burg");
  }

  function residentialPoolForDoor(useFacing) {
    const biomeName = ($gameSystem._procGenData && $gameSystem._procGenData.currentBiome) || "";
    if (isSettlementBiomeName(biomeName)) return "houses";
    const c = getEventCoordinates(useFacing);
    const seed = (createSeed($gameMap.mapId(), c.x, c.y) ^ 0x48565A) >>> 0;
    return seededRandom(seed) < 0.5 ? "huts" : "villas";
  }

  // Descend through a DoorDungeon tile into a procedural, coordinate-seeded
  // dungeon. WorldMapReturn resolves the dungeon type from the surface biome's
  // lowerLayer (Cave-family/none -> Dungeon, else Crypt / Sewer / ...).
  function enterSeededDungeon() {
    const key = "WorldMapReturn:enterDungeonDoor";
    if (PluginManager._commands && PluginManager._commands[key]) {
      PluginManager.callCommand($gameMap._interpreter || {}, "WorldMapReturn", "enterDungeonDoor", {});
    } else {
      console.warn("WorldMapReturn not available for DoorDungeon.");
    }
  }

  // SignBus opens the fast-travel map in Bus mode (starting from the player's
  // current world location). No-op if the fast-travel plugin/scene is absent.
  function openBusFastTravel() {
    const sc = SceneManager._scene;
    if (sc instanceof Scene_Map && typeof sc.startFastTravel === "function") sc.startFastTravel("bus");
  }
  // SignPark recalls (summons) the camper to the player via VehicleSystem's
  // summonCamper plugin command. No-op if VehicleSystem is absent.
  function recallCamper() {
    const key = "VehicleSystem:summonCamper";
    if (PluginManager._commands && PluginManager._commands[key]) {
      PluginManager.callCommand($gameMap._interpreter || {}, "VehicleSystem", "summonCamper", {});
    } else {
      console.warn("VehicleSystem not available for SignPark.");
    }
  }

  // Public: attempt to use the interactive feature the player faces on the proc
  // map. Returns true if handled (caller then stops other interactions).
  function tryProcMapInteract(character) {
    if (!character || !$gameMap || $gameMap.mapId() !== PROC_MAP_ID) return false;
    if (doorEntryBusy()) return false;
    if ($gameMessage && $gameMessage.isBusy && $gameMessage.isBusy()) return false;
    const name = facedInteractFeatureName(character);
    if (!name) return false;
    // These FEATURES are tiles, not events, so there is no door event to swing.
    _callerEventId = 0;
    switch (name) {
      case "DoorHouse": {
        const pool = residentialPoolForDoor(true);
        // Huts are always single-floor; only houses/villas roll a 2nd floor.
        if (pool !== "huts" && seededFloorCount(true, 1, 2, 0x484F) >= 2) {
          enterMultiBuilding(pool, "floors", 1, true);
        } else {
          visitHouse(pool, true);
        }
        break;
      }
      case "DoorInn":
        visitHouse("inns", true);
        break;
      case "DoorShop":
        visitHouse("shops", true);
        break;
      case "DoorSkyscraper": {
        const totalFloors = seededFloorCount(true, 4, 10, 0x534B);
        enterMultiBuilding("skyscrapers", "skyfloors", totalFloors - 1, true);
        break;
      }
      case "DoorDungeon":
        enterSeededDungeon();
        break;
      case "SignPark":
        recallCamper();
        break;
      case "SignBus":
        openBusFastTravel();
        break;
      default:
        return false;
    }
    return true;
  }

  function visitHouse(poolName = "", useFacing = false, forcedHouseId = null, forceOpen = false) {
    const houseList = getHouseList(poolName, true);
    if (houseList.length === 0) return;
    attemptDoorEntry(useFacing, () => performHouseEntry(poolName, useFacing, forcedHouseId), poolName, forceOpen);
  }

  // Shared door gate for every entrance (houses, multi-floor buildings, shops,
  // inns, ...). The door-open animation and the transfer are both deferred to
  // `doEntry` so nothing happens until the door actually opens:
  //   - non-lockable pool   -> always open (only houses/villas/huts can lock).
  //   - "unlocked" in the door event's Note -> always open.
  //   - lockDoors param ON  -> fully blocked ("Get out of my house!").
  //   - daytime / bashed    -> open animation, then doEntry.
  //   - night (locked)      -> lockpick / bash / cancel menu. Only lockpick
  //                            success, skeleton key, or bash open the door;
  //                            cancel and lockpick failure leave it shut with
  //                            no animation.
  function attemptDoorEntry(useFacing, doEntry, poolName, forceOpen) {
    // FurnitureSystem-built player doors pass forceOpen: always open, never
    // locked, no lockpick/bash prompt, regardless of pool or time of day.
    if (forceOpen || isCallerDoorUnlocked() || !isLockablePool(poolName)) {
      openDoorAndEnter(doEntry);
      return;
    }
    if (parameters["lockDoors"] === "true") {
      window.skipLocalization = true;
      $gameMessage.add(T('ProceduralHouse.getOut'));
      window.skipLocalization = false;
      return;
    }
    // A door already bashed open within the last day skips the prompt.
    if (isNightTime() && !isDoorBashedOpen(useFacing)) {
      showLockedDoorChoices(useFacing, doEntry);
      return;
    }
    openDoorAndEnter(doEntry);
  }

  function showLockedDoorChoices(useFacing, doEntry) {
    const hasLockpick = $dataItems[374] && $gameParty.hasItem($dataItems[374]);
    const choices = [];
    const actions = [];
    if (hasLockpick) { choices.push(T('ProceduralHouse.lockpick')); actions.push('lockpick'); }
    choices.push(T('ProceduralHouse.bash')); actions.push('bash');
    choices.push(T('ProceduralHouse.cancel')); actions.push('cancel');

    window.skipLocalization = true;
    $gameMessage.add(T('ProceduralHouse.doorLocked'));
    $gameMessage.setChoices(choices, 0, choices.length - 1);
    $gameMessage.setChoiceBackground(0);
    $gameMessage.setChoicePositionType(2);
    window.skipLocalization = false;
    $gameMessage.setChoiceCallback((index) => {
      const action = actions[index];
      if (action === 'lockpick') {
        startNightLockpick(useFacing, doEntry);
      } else if (action === 'bash') {
        bashDoor(useFacing, doEntry);
      }
      // 'cancel' (or window dismissed): stay outside, no door animation.
    });
  }

  function startNightLockpick(useFacing, doEntry) {
    // A skeleton key (item 740) opens any lock without the minigame. We handle
    // it here so the no-scene auto-success path never strands the entry.
    if ($dataItems[740] && $gameParty.hasItem($dataItems[740])) {
      $gameParty.loseItem($dataItems[740], 1);
      window.skipLocalization = true;
      $gameMessage.add(T('ProceduralHouse.usedSkeletonKey'));
      window.skipLocalization = false;
      openDoorAndEnter(doEntry);
      return;
    }
    if (typeof LockpickTetris === 'undefined') return;
    _pendingNightHouse = { useFacing: useFacing, doEntry: doEntry };
    hookLockpickForHouse();
    // Randomized lock complexity, clamped to the minigame's 1-10 range.
    const difficulty = 3 + Math.floor(Math.random() * 6); // 3..8
    LockpickTetris.start(difficulty, 0, 0, '', '');
  }

  // Mirrors PeekPlugin: wrap popScene once to resolve the pending entry when the
  // lockpick minigame succeeds. Lockpicking is never a crime, so whether it
  // succeeds or fails nothing is logged here; failure simply opens no door.
  function hookLockpickForHouse() {
    if (typeof Scene_LockpickTetris === 'undefined') return;
    if (Scene_LockpickTetris._houseHooked) return;
    Scene_LockpickTetris._houseHooked = true;
    const _popScene = Scene_LockpickTetris.prototype.popScene;
    Scene_LockpickTetris.prototype.popScene = function() {
      if (_pendingNightHouse) {
        const pending = _pendingNightHouse;
        _pendingNightHouse = null;
        if (this.success) {
          AudioManager.playSe({ name: "lock_01", volume: 100, pitch: 100, pan: 0 });
          openDoorAndEnter(pending.doEntry);
        }
        // failure: no animation, no entry, no crime.
      }
      _popScene.call(this);
    };
  }

  // Bashing the door always counts as breaking and entering.
  function bashDoor(useFacing, doEntry) {
    if (typeof CrimeSystem !== 'undefined') {
      CrimeSystem.addPresetCrime("breakingAndEntering");
    }
    AudioManager.playSe({ name: "Crash", volume: 100, pitch: 100, pan: 0 });
    markDoorBashed(useFacing);
    openDoorAndEnter(doEntry);
  }

  // ── Door-open animation ─────────────────────────────────────────────────────
  // Plays the open SE, swings the door event open (the turn cycle the events
  // used to do inline), steps the player into the doorway, then runs `doEntry`
  // (the actual transfer). Driving it here means the animation only ever plays
  // when the door truly opens - never on a cancelled or failed locked door.
  function openDoorAndEnter(doEntry) {
    const ev = _callerEventId ? $gameMap.event(_callerEventId) : null;
    AudioManager.playSe({ name: "Open1", volume: 90, pitch: 100, pan: 0 });
    if (ev) {
      ev.forceMoveRoute({
        repeat: false, skippable: false, wait: true,
        list: [
          { code: 17 },                  // turn left
          { code: 15, parameters: [3] }, // wait 3
          { code: 18 },                  // turn right
          { code: 15, parameters: [3] }, // wait 3
          { code: 19 },                  // turn up
          { code: 37 },                  // through on
          { code: 0 }
        ]
      });
    }
    _doorEntry = { eventId: _callerEventId, doEntry: doEntry, phase: ev ? 'door' : 'player' };
  }

  // Frame-polled state machine: wait for the door swing, then step the player
  // forward, then fire the transfer. Player input is locked while the player's
  // forced step runs (Game_Player.canMove respects move-route forcing).
  function updateDoorEntry() {
    const de = _doorEntry;
    const ev = de.eventId ? $gameMap.event(de.eventId) : null;
    if (de.phase === 'door') {
      if (!ev || (!ev.isMoveRouteForcing() && !ev.isMoving())) {
        $gamePlayer.forceMoveRoute({
          repeat: false, skippable: true, wait: true,
          list: [ { code: 12 }, { code: 0 } ] // 1 step forward
        });
        de.phase = 'player';
      }
    } else if (de.phase === 'player') {
      if (!$gamePlayer.isMoveRouteForcing() && !$gamePlayer.isMoving()) {
        AudioManager.playSe({ name: "Move1", volume: 90, pitch: 100, pan: 0 });
        _doorEntry = null;
        if (de.doEntry) de.doEntry();
      }
    }
  }

  function performHouseEntry(poolName = "", useFacing = false, forcedHouseId = null) {
    const houseList = getHouseList(poolName, true);
    if (houseList.length === 0) return;

    const eventCoords = getEventCoordinates(useFacing);
    const seed = createSeed($gameMap.mapId(), eventCoords.x, eventCoords.y);

    saveHouseReturnPoint(useFacing);
    const houseId = forcedHouseId || selectHouse(seed, poolName);
    if (!houseId) return;

    _savedBgm = AudioManager._bgm;
    // Identify the building for the NPC system before the transfer, while
    // $gameMap is still the town map the entrance sits on.
    setCurrentBuilding({
      mapId: $gameMap.mapId(), x: eventCoords.x, y: eventCoords.y, seed,
      type: 'visitHouse', poolName: poolName || '',
      totalFloors: 1, floorIndex: 0, capacity: 2,
      interiorMapId: houseId,
    });

    _postTransferActions = {
        type: 'house',
        spawnRegionId: Number(parameters["spawnRegionId"] || 13),
        originalDirection: $gamePlayer.direction(),
        seed: seed
    };
    $gamePlayer.reserveTransfer(houseId, 0, 0, $gamePlayer.direction(), 0);
  }

  function enterMultiBuilding(baseFloorPool, upperFloorsPool, numFloors, useFacing = false) {
    if (numFloors < 1) return;
    if (!baseFloorPool || baseFloorPool === "") baseFloorPool = "skyscrapers";
    if (!upperFloorsPool || upperFloorsPool === "") upperFloorsPool = "skyfloors";
    attemptDoorEntry(useFacing, () => performMultiBuildingEntry(baseFloorPool, upperFloorsPool, numFloors, useFacing), baseFloorPool);
  }

  function performMultiBuildingEntry(baseFloorPool, upperFloorsPool, numFloors, useFacing = false) {
    const locationKey = createLocationKey();
    const eventCoords = getEventCoordinates(useFacing);
    const seed = createSeed($gameMap.mapId(), eventCoords.x, eventCoords.y);

    let structure = multiBuildingStructures[locationKey] || generateMultiBuildingStructure(seed, baseFloorPool, upperFloorsPool, numFloors);
    if (!structure) return;
    multiBuildingStructures[locationKey] = structure;

    _savedBgm = AudioManager._bgm;
    saveHouseReturnPoint(useFacing);
    currentMultiBuilding = {
        entranceKey: locationKey,
        currentFloorIndex: 0,
        structure: structure,
        baseSeed: seed
    };

    // A multi-floor entrance is one building with `totalFloors` separate floors.
    // Residential ones (baseFloorPool "houses") house one NPC household per
    // floor; skyscrapers are public and get no residents at all.
    setCurrentBuilding({
      mapId: $gameMap.mapId(), x: eventCoords.x, y: eventCoords.y, seed,
      type: 'enterMultiBuilding',
      baseFloorPool: baseFloorPool, upperFloorsPool: upperFloorsPool,
      numFloors: numFloors,
      totalFloors: structure.totalFloors, floorIndex: 0,
      capacity: structure.totalFloors,
      interiorMapId: structure.floors[0],
    });

    _postTransferActions = {
        type: 'multiBuildingEnter',
        spawnRegionId: Number(parameters["spawnRegionId"] || 13),
        originalDirection: $gamePlayer.direction(),
        seed: seed
    };
    $gamePlayer.reserveTransfer(structure.floors[0], 0, 0, $gamePlayer.direction(), 0);
  }

  function changeFloor(direction) {
    if (!currentMultiBuilding) return;
    const current = currentMultiBuilding.currentFloorIndex;
    const total = currentMultiBuilding.structure.totalFloors;
    const nextIndex = direction === 'next' ? current + 1 : current - 1;

    if (nextIndex >= 0 && nextIndex < total) {
        _savedBgm = AudioManager._bgm;
        currentMultiBuilding.currentFloorIndex = nextIndex;
        setCurrentFloor(nextIndex, currentMultiBuilding.structure.floors[nextIndex]);
        const floorSeed = currentMultiBuilding.baseSeed + nextIndex * 5000;
        _postTransferActions = { 
            type: 'floorChange', 
            direction: direction,
            seed: floorSeed
        };
        $gamePlayer.reserveTransfer(currentMultiBuilding.structure.floors[nextIndex], 0, 0, $gamePlayer.direction(), 0);
    }
  }

  // Human-friendly label for a floor index in the elevator picker.
  function elevatorFloorLabel(index) {
    return index === 0 ? T('ProceduralHouse.groundFloor')
      : T('ProceduralHouse.floorNumbered', { n: index });
  }

  // Show a choice list of every floor except the current one, then ride to the
  // chosen floor. Only works inside a multi-floor building.
  function openElevator() {
    if (!currentMultiBuilding || !currentMultiBuilding.structure) {
      window.skipLocalization = true;
      $gameMessage.add(T('ProceduralHouse.noElevator'));
      window.skipLocalization = false;
      return;
    }
    if (_elevatorTransit) return;
    const total = currentMultiBuilding.structure.totalFloors;
    const current = currentMultiBuilding.currentFloorIndex;
    const choices = [];
    const targets = [];
    // List top-down, like a real elevator panel (top floor first).
    for (let i = total - 1; i >= 0; i--) {
      if (i === current) continue;
      choices.push(elevatorFloorLabel(i));
      targets.push(i);
    }
    choices.push(T('ProceduralHouse.cancel'));
    targets.push(-1);

    window.skipLocalization = true;
    $gameMessage.add(T('ProceduralHouse.selectFloor'));
    $gameMessage.setChoices(choices, 0, choices.length - 1);
    $gameMessage.setChoiceBackground(0);
    $gameMessage.setChoicePositionType(2);
    window.skipLocalization = false;
    $gameMessage.setChoiceCallback((index) => {
      const target = targets[index];
      if (target >= 0) startElevatorTransit(target);
    });
  }

  // Fade the screen to black, wait a spell proportional to how many floors the
  // elevator has to travel, then hand off to the queued floor transfer.
  function startElevatorTransit(targetFloorIndex) {
    if (!currentMultiBuilding) return;
    const total = currentMultiBuilding.structure.totalFloors;
    if (targetFloorIndex < 0 || targetFloorIndex >= total) return;
    if (targetFloorIndex === currentMultiBuilding.currentFloorIndex) return;

    const distance = Math.abs(targetFloorIndex - currentMultiBuilding.currentFloorIndex);
    const fadeFrames = 30;
    // Ride time scales with distance: fade + ~2/3 second per floor travelled.
    const waitFrames = fadeFrames + distance * 40;
    $gameScreen.startFadeOut(fadeFrames);
    _elevatorTransit = { framesLeft: waitFrames, targetFloorIndex: targetFloorIndex };
  }

  // Perform the actual floor swap once the ride wait elapses. Landing is handled
  // by the 'elevator' post-transfer action in onMapLoaded.
  function performElevatorFloorChange(targetFloorIndex) {
    if (!currentMultiBuilding) return;
    _savedBgm = AudioManager._bgm;
    currentMultiBuilding.currentFloorIndex = targetFloorIndex;
    setCurrentFloor(targetFloorIndex, currentMultiBuilding.structure.floors[targetFloorIndex]);
    const floorSeed = currentMultiBuilding.baseSeed + targetFloorIndex * 5000;
    _postTransferActions = { type: 'elevator', seed: floorSeed };
    // Fade type 2 (no fade): the screen is already black from startFadeOut, so
    // we skip the transfer's own fade and fade back in after landing.
    $gamePlayer.reserveTransfer(currentMultiBuilding.structure.floors[targetFloorIndex], 0, 0, $gamePlayer.direction(), 2);
  }

  function updateElevatorTransit() {
    if (!_elevatorTransit) return;
    if (_elevatorTransit.framesLeft > 0) {
      _elevatorTransit.framesLeft--;
      return;
    }
    const target = _elevatorTransit.targetFloorIndex;
    _elevatorTransit = null;
    performElevatorFloorChange(target);
  }

  function exitHouse() {
    const returnPoint = houseReturnPoints[currentHouseSessionId];
    if (returnPoint) {
      if (returnPoint.mapId === PROC_MAP_ID && $gameSystem._procGenData) {
        // Put the square the door stands on back exactly as it was: world
        // coordinates first (a building must never relocate the party to another
        // world tile, or a later border crossing teleports them somewhere else
        // entirely), then the biome description the map was built from.
        //
        // The generated tiles themselves are NOT rebuilt: entering a building
        // never touches procGenData.generatedMapData, and WorldMapReturn's
        // performTransfer hook re-injects that same array on the way back into
        // map 636. Only when it has gone missing (an old save, an excursion that
        // cleared it) does restoreProcSurface rebuild it, from this square's own
        // canonical seed. This is the same restore the forced-biome structures
        // use, so both routes back onto the procedural map agree tile for tile.
        const wmr = window.WorldMapReturn;
        // Not every return point carries a snapshot (one recorded before this
        // was shared, restored from an older save), so fall back to the live
        // procgen state, which entering a building never changes anyway.
        const savedBiome = returnPoint.savedBiomeData || $gameSystem._procGenData;
        const restored = wmr && typeof wmr.restoreProcSurface === "function"
          ? wmr.restoreProcSurface(savedBiome)
          : false;
        if (!restored) {
          // Nothing left describing the square. Re-assert the world coordinates
          // at least, so whatever rebuilds it does so where the party actually
          // stands and a later border crossing cannot fling them across the map.
          const originX = (savedBiome && savedBiome.originX) || $gameVariables.value(43);
          const originY = (savedBiome && savedBiome.originY) || $gameVariables.value(44);
          $gameVariables.setValue(43, originX);
          $gameVariables.setValue(44, originY);
          $gameSystem._procGenData.originX = originX;
          $gameSystem._procGenData.originY = originY;
        }
      }
      $gamePlayer.reserveTransfer(returnPoint.mapId, returnPoint.eventX, returnPoint.eventY + 1, 2, 0);
      delete houseReturnPoints[currentHouseSessionId];
      currentHouseSessionId = null;
      currentMultiBuilding = null;
      setCurrentBuilding(null);
    } else {
      const result = findPlaytestFallbackLocation();
      if (result) {
        const { building, groupName } = result;
        setCurrentBuilding({ ...building, floorIndex: 0, interiorMapId: $gameMap.mapId() });
        window.ProceduralHouseSystem._playtestFallbackGroupName = groupName;
        if ($gameMap.setupNPCControllers) $gameMap.setupNPCControllers();
        currentMultiBuilding = null;
        setCurrentBuilding(null);
        window.ProceduralHouseSystem._playtestFallbackGroupName = null;
        $gamePlayer.reserveTransfer(building.mapId, building.x, building.y + 1, 2, 0);
      }
    }
  }

  // If the loaded map has no BGM set, continue playing the saved BGM from the previous map.
  function continueSavedBgm() {
    if (!_savedBgm) return;
    const mapBgm = $dataMap && $dataMap.bgm;
    const hasNoBgm = !mapBgm || !mapBgm.name || mapBgm.name.trim() === '';
    if (hasNoBgm) {
      AudioManager._bgm = _savedBgm;
      AudioManager.bgmPlay(_savedBgm);
    }
  }

  // Swap the ambience over to the interior's own biome (HousesInside, Office,
  // CastleInside, ...). An interior biome with no BGS list stops the outdoor
  // ambience instead of leaving the street sounds bleeding through the walls;
  // one with no BGM list leaves the saved outdoor track playing, which is what
  // continueSavedBgm above has just restored.
  function applyInteriorBiomeAudio() {
    const wmr = window.WorldMapReturn;
    if (wmr && typeof wmr.updateBiomeAudio === 'function') {
      wmr.updateBiomeAudio();
    } else {
      AudioManager.stopBgs();
    }
  }

  const _Scene_Map_update_door = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function() {
    _Scene_Map_update_door.call(this);
    updateDoorTriggersForTime();
    if (_doorEntry) updateDoorEntry();
    if (_elevatorTransit) updateElevatorTransit();
  };

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function() {
      _Scene_Map_onMapLoaded.call(this);
      if (_postTransferActions) {
          const actions = _postTransferActions;
          switch(actions.type) {
              case 'house':
              case 'multiBuildingEnter':
                  const pos = findPositionWithRegionId(actions.spawnRegionId);
                  const mapDir = getMapDirection('houseDirection');
                  $gamePlayer.locate(pos.x, pos.y);
                  $gamePlayer.setDirection(mapDir !== null ? mapDir : actions.originalDirection);
                  if (actions.type === 'house') {
                    // i18n-ignore-start  event names
                    const upstairsEvent = findEventByName("Upstairs");
                    const downstairsEvent = findEventByName("Downstairs");
                    // i18n-ignore-end
                    if (upstairsEvent) $gameMap.event(upstairsEvent.eventId()).erase();
                    if (downstairsEvent) $gameMap.event(downstairsEvent.eventId()).erase();
                    $gameMap.refresh();
                    // Furniture-system decoration disabled for now.
                    // if ($gameSystem.generateHouseDecor) $gameSystem.generateHouseDecor(actions.seed);
                    currentMultiBuilding = null;
                  } else if (actions.type === 'multiBuildingEnter') {
                    placeStairsAtSeededPosition(actions.seed);
                    updateStairVisibility();
                    // Furniture-system decoration disabled for now.
                    // if ($gameSystem.generateHouseDecor) $gameSystem.generateHouseDecor(actions.seed);
                  }
                  continueSavedBgm();
                  applyInteriorBiomeAudio();
                  break;
              case 'elevator': {
                  placeStairsAtSeededPosition(actions.seed);
                  // Land south of the first "Elevator" event; fall back to the
                  // downward stairs, then to the spawn region tile.
                  // i18n-ignore-start  event names
                  const elevatorEvent = findEventByName("Elevator");
                  const downstairsEvent = findEventByName("Downstairs");
                  // i18n-ignore-end
                  if (elevatorEvent) {
                      $gamePlayer.locate(elevatorEvent.x, elevatorEvent.y + 1);
                      $gamePlayer.setDirection(2);
                  } else if (downstairsEvent) {
                      $gamePlayer.locate(downstairsEvent.x, downstairsEvent.y + 1);
                      $gamePlayer.setDirection(2);
                  } else {
                      const pos = findPositionWithRegionId(Number(parameters["spawnRegionId"] || 13));
                      $gamePlayer.locate(pos.x, pos.y);
                  }
                  updateStairVisibility();
                  // Furniture-system decoration disabled for now.
                  // if ($gameSystem.generateHouseDecor) $gameSystem.generateHouseDecor(actions.seed);
                  continueSavedBgm();
                  applyInteriorBiomeAudio();
                  // Screen was faded to black for the ride; fade it back in.
                  $gameScreen.startFadeIn(30);
                  break;
              }
              case 'floorChange': {
                  placeStairsAtSeededPosition(actions.seed);
                  const stairPos = getSeededStairPositions(actions.seed);
                  const hasRegion14 = stairPos.upstairs !== null;
                  if (hasRegion14) {
                      const landingPos = actions.direction === 'next' ? stairPos.downstairs : stairPos.upstairs;
                      $gamePlayer.locate(landingPos.x, landingPos.y);
                  } else {
                      const eventName = actions.direction === 'next' ? "Downstairs" : "Upstairs";  // i18n-ignore  event names
                      const event = findEventByName(eventName);
                      if (event) $gamePlayer.locate(event.x, event.y);
                  }
                  updateStairVisibility();
                  // Furniture-system decoration disabled for now.
                  // if ($gameSystem.generateHouseDecor) $gameSystem.generateHouseDecor(actions.seed);
                  continueSavedBgm();
                  applyInteriorBiomeAudio();
                  break;
              }
          }
          _savedBgm = null;
          _postTransferActions = null;
      }
  };

  const _DataManager_setupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function () {
    _DataManager_setupNewGame.call(this);
    Object.keys(houseReturnPoints).forEach(k => delete houseReturnPoints[k]);
    Object.keys(multiBuildingStructures).forEach(k => delete multiBuildingStructures[k]);
    currentHouseSessionId = null;
    currentMultiBuilding = null;
    _doorEntry = null;
    _elevatorTransit = null;
    _callerEventId = 0;
    _pendingNightHouse = null;
    _lastDoorNightState = null;
    setCurrentBuilding(null);
  };

  const _DataManager_makeSaveContents = DataManager.makeSaveContents;
  DataManager.makeSaveContents = function () {
    const contents = _DataManager_makeSaveContents.call(this);
    if (!contents.proceduralHouseSystem) contents.proceduralHouseSystem = {};
    contents.proceduralHouseSystem.houseReturnPoints = houseReturnPoints;
    contents.proceduralHouseSystem.multiBuildingStructures = multiBuildingStructures;
    contents.proceduralHouseSystem.currentHouseSessionId = currentHouseSessionId;
    contents.proceduralHouseSystem.currentMultiBuilding = currentMultiBuilding;
    contents.proceduralHouseSystem.currentBuilding = _currentBuilding;
    return contents;
  };

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    if (contents.proceduralHouseSystem) {
        const system = contents.proceduralHouseSystem;
        Object.assign(houseReturnPoints, system.houseReturnPoints || {});
        Object.assign(multiBuildingStructures, system.multiBuildingStructures || {});
        currentHouseSessionId = system.currentHouseSessionId || null;
        currentMultiBuilding = system.currentMultiBuilding || null;
        setCurrentBuilding(system.currentBuilding || null);
    } else if (contents.treasureRoomSystem) {
        // Backwards compatibility migration
        const system = contents.treasureRoomSystem;
        Object.assign(houseReturnPoints, system.houseReturnPoints || {});
        Object.assign(multiBuildingStructures, system.multiBuildingStructures || {});
        currentHouseSessionId = system.currentHouseSessionId || null;
        currentMultiBuilding = system.currentMultiBuilding || null;
        setCurrentBuilding(null); // predates the building descriptor
    }
  };
})();
