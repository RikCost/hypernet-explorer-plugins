/*:
 * @plugindesc Merged Vehicle & Movement System v3.3
 * @author Omni-Lex (Merged)
 * @target MZ
 *
 * @param CamperSettings
 * @text Camper Settings
 * 
 * @param CamperMaxFuel
 * @parent CamperSettings
 * @desc Maximum fuel capacity for camper in liters
 * @type number
 * @min 1
 * @default 100
 *
 * @param CamperFuelRate
 * @parent CamperSettings
 * @desc Fuel consumption rate per second for camper
 * @type number
 * @decimals 2
 * @min 0.01
 * @default 0.5
 *
 * @param CarSettings
 * @text Car Settings
 *
 * @param CarMaxFuel
 * @parent CarSettings
 * @desc Maximum fuel capacity for car in liters
 * @type number
 * @min 1
 * @default 60
 *
 * @param CarFuelRate
 * @parent CarSettings
 * @desc Fuel consumption rate per second for car
 * @type number
 * @decimals 2
 * @min 0.01
 * @default 0.3
 *
 * @param GeneralSettings
 * @text General Settings
 *
 * @param SearchRadius
 * @parent GeneralSettings
 * @desc Maximum search radius for finding valid position
 * @type number
 * @min 1
 * @default 5
 *
 * @param MovementSettings
 * @text Movement Settings
 *
 * @param speedBoostMultiplier
 * @parent MovementSettings
 * @text Speed Boost Multiplier
 * @type number
 * @decimals 2
 * @min 1.00
 * @max 5.00
 * @default 1.5
 * @desc Movement speed multiplier when holding Shift (1.5 = 50% faster)
 *
 * @command summonCamper
 * @text Summon Camper
 * @desc Teleports the camper to a nearby location
 *
 * @command summonCar
 * @text Summon Car
 * @desc Teleports the car to a nearby location
 *
 * @command summonBike
 * @text Summon Bike
 * @desc Teleports the bike to a nearby location
 *
 * @command summonBoat
 * @text Summon Boat
 * @desc Teleports the boat to a nearby water tile
 *
 * @command summonAirship
 * @text Summon Airship
 * @desc Teleports the airship (Starship) to a nearby location
 *
 * @command teleportToVehicle
 * @text Teleport To Vehicle
 * @desc Teleports player to specified vehicle
 * @arg vehicleType
 * @type select
 * @option Camper
 * @value ship
 * @option Car
 * @value boat
 * @option Airship
 * @value airship
 * @default ship
 *
 * @command saveCamperAndTravel
 * @text Save Camper and Travel
 * @desc Save camper position and enter interior
 *
 * @command saveCarAndTravel
 * @text Save Car and Travel
 * @desc Save car position and enter interior
 *
 * @command saveAirshipAndTravel
 * @text Save Airship and Travel
 * @desc Save airship position and enter interior (map 721)
 *
 * @command returnToCamper
 * @text Return to Camper
 * @desc Return to last camper position
 *
 * @command returnToCar
 * @text Return to Car
 * @desc Return to last car position
 *
 * @command returnToAirship
 * @text Return to Airship
 * @desc Return to last airship position
 *
 * @command returnAndRideCamper
 * @text Return and Ride Camper
 * @desc Return and automatically ride camper
 *
 * @command returnAndRideCar
 * @text Return and Ride Car
 * @desc Return and automatically ride car
 *
 * @command returnAndRideAirship
 * @text Return and Ride Airship
 * @desc Return and automatically ride airship
 *
 * @command initializeCamperPosition
 * @text Initialize Camper Position
 * @desc Spawns camper at current location of event with no animation
 *
 * @command showTravelOptions
 * @text Show Travel Options (Interior)
 * @desc Opens the travel/utility menu while inside a vehicle interior. Options depend on which interior map the player is in.
 *
 * @command openVehicleMenu
 * @text Open Vehicle Menu
 * @desc Opens the vehicle action menu (drive / enter / fast travel / storage / repairs...).
 * @arg vehicleType
 * @text Vehicle
 * @type select
 * @option Auto (ridden, interior or nearby vehicle)
 * @value auto
 * @option Camper
 * @value ship
 * @option Car
 * @value boat
 * @option Airship
 * @value airship
 * @default auto
 *
 * @help
 * ============================================================================
 * Merged Vehicle & Movement System v3.1
 * ============================================================================
 * 
 * Combines vehicle system with custom movement controls:
 * - Multiple vehicles with fuel systems (Camper, Car, Bike, Airship)
 * - Custom autorun behavior (disabled on map 315)
 * - Speed boost with Shift key when on foot
 * - Vehicles move at their full speed on non-315 maps
 * - Map 315 special rules:
 *   - On foot: Speed locked at 4, no dash
 *   - In vehicle: Speed locked at 5
 * 
 * ============================================================================
 * CHANGELOG v3.3:
 * - Fixed: a vehicle left in one procedural biome no longer stands in the next
 *   one. Every biome shares map id 636, so a parked vehicle is now taken off the
 *   map whenever the loaded biome is not the one it was left in (world square,
 *   layer depth and alien/Earth realm all have to match).
 * - Added: a park record carries the world-map tile its map corresponds to, read
 *   from the map's <Coords x y> notetag, so parking on an authored map shows the
 *   vehicle at that world tile on map 315.
 * - Added: when several vehicles are parked on one tile, only the last one parked
 *   is drawn and interacting asks which one is meant.
 * - Fixed: entering a vehicle interior no longer overwrites the vehicle's parked
 *   tile with the player's; the way back out is its own record.
 * ============================================================================
 * CHANGELOG v3.2:
 * - Added: persistent fuel gauge HUD (top-left) while driving a fuel vehicle;
 *   removed the "What would you like to do?" prompt text from the menu.
 * - Added: interacting with a parked vehicle from outside opens the action menu
 *   with "Start driving" (mounts it); "Stop driving" only shows while driving.
 * - Added: per-vehicle usesFuel / canRefuelAtPump flags.
 * - Changed: the Bike is fuel-free (never consumes or runs out of fuel).
 * - Changed: the Starship can no longer be refueled at a gas pump.
 * - Changed: parked airship now blocks the player (cannot walk over it).
 * ============================================================================
 * CHANGELOG v3.1:
 * - Fixed: summon() calls getConfig() before null-checking vehicle
 * - Fixed: checkVehicleInteriorBlock crashes when config is null
 * - Fixed: _returnToVehicle flag mapping for non-Camper/Car vehicles
 * - Fixed: _handleAutoRide skips Bike/Airship vehicle flags
 * - Fixed: Desynchronized help text vs actual default speed values
 * - Refactored: Extracted sprite selection helper to eliminate 4x duplication
 * - Refactored: Extracted showLocalizedMessage helper for skipLocalization pattern
 * - Refactored: Consolidated duplicate speedBoostMultiplier param binding
 * - Refactored: Removed fragile private property mutations for out-of-fuel
 * - Refactored: Named constant for AUTO_RIDE_DELAY_FRAMES
 * - Refactored: Safer vehicle null-guard pattern in all hooks
 * ============================================================================
 */

(() => {
  'use strict';

  const PLUGIN_NAME = 'VehicleSystem';
  const params = PluginManager.parameters(PLUGIN_NAME);

  // Shared constants
  const AUTO_RIDE_DELAY_FRAMES = 15;

  // Global fuel-consumption scale. Lower = vehicles burn less fuel per step.
  // Now that fuel lives in its own per-vehicle store (window.VehicleFuel) instead
  // of a shared RPG Maker variable that other events silently drained, the rate is
  // raised so on-map driving actually consumes the tank at a meaningful pace.
  const FUEL_CONSUMPTION_MULTIPLIER = 0.03;

  // ============================================================================
  // Configuration
  // ============================================================================
  //
  // SPEED SETTINGS GUIDE:
  // All movement speeds are centralized in VehicleConfig.SPEED (around line 263)
  // Edit the values there to change speeds everywhere:
  //   - onFootBase: Walking speed when not holding Shift
  //   - onFootAutorunBoost: Speed added by autorun system
  //   - map315OnFootSpeed: Walking speed on map 315 (restricted area)
  //   - vehicleMaxSpeed: Vehicle speed on maps other than 315
  //   - map315VehicleSpeed: Vehicle speed on map 315
  //   - speedBoostMultiplier: Speed multiplier when holding Shift
  // ============================================================================

  class VehicleConfig {
    static CAMPER = {
      type: 'ship',
      name: 'Camper',  // i18n-ignore  vehicle id
      maxFuel: Number(params.CamperMaxFuel || 100),
      fuelRate: Number(params.CamperFuelRate || 0.5),
      interior: {
        mapId: 327,
        x: 8,
        y: 7
      },
      sprites: {
        normal: { name: 'Vehicles/!$RV', index: 2 },  // i18n-ignore  sprite asset path
        large: { name: 'Vehicles/!$RV_large', index: 2 }  // i18n-ignore  sprite asset path
      },
      refuelEvent: 104,
      storageEvent: 118,
      repairEvent: 120,
      usesFuel: true,
      canRefuelAtPump: true,
      // Ground vehicles spend less game-time per tile while driving over a
      // world-map road biome. The Airship (flies) and Boat (water-only) do not.
      roadBoost: true,
      // Item that proves party ownership of this vehicle (see Items.json
      // <category:Vehicles>). Owning the item is what makes the vehicle appear in
      // the Vehicles menu and drivable/summonable.
      summonItemId: 111
    };

    static AIRSHIP = {
      type: 'airship',
      name: 'Starship',  // i18n-ignore  vehicle id
      maxFuel: 200,
      fuelRate: 0.8,
      interior: {
        mapId: 721,
        x: 25,
        y: 48,
        direction: 6  // Facing right (6 = right, 2 = down, 4 = left, 8 = up)
      },
      sprites: {
        normal: { name: 'Vehicles/!$Airship', index: 0 },  // i18n-ignore  sprite asset path
        large: { name: 'Vehicles/!$Airship', index: 0 }  // i18n-ignore  sprite asset path
      },
      refuelEvent: 122,
      storageEvent: 123,
      repairEvent: 124,
      usesFuel: true,
      // The Starship cannot be refueled at a roadside gas pump.
      canRefuelAtPump: false,
      summonItemId: 166
    };

    static CAR = {
      type: 'boat',
      name: 'Car',  // i18n-ignore  vehicle id
      maxFuel: Number(params.CarMaxFuel || 60),
      fuelRate: Number(params.CarFuelRate || 0.3),
      interior: {
        mapId: 1094,
        x: 8,
        y: 8
      },
      sprites: {
        normal: { name: 'Vehicles/!$Car', index: 0 },  // i18n-ignore  sprite asset path
        large: { name: 'Vehicles/!$Car_large', index: 0 }  // i18n-ignore  sprite asset path
      },
      refuelEvent: 116,
      storageEvent: 119,
      repairEvent: 121,
      maxSpeed: 6,
      usesFuel: true,
      canRefuelAtPump: true,
      roadBoost: true,
      // The Car, Bike and Boat all share the single engine 'boat' vehicle slot;
      // boatSubType is the discriminator stored in $gameSystem._boatType.
      boatSubType: 'car',
      summonItemId: 164
    };

    static BIKE = {
      type: 'boat',
      name: 'Bike',  // i18n-ignore  vehicle id
      maxFuel: 30,
      fuelRate: 0.15,
      interior: {
        mapId: 0,
        x: 0,
        y: 0
      },
      sprites: {
        normal: { name: 'Vehicles/!$Bike', index: 0 },  // i18n-ignore  sprite asset path
        riding: { name: 'Vehicles/!$BikeRiding', index: 0 }  // i18n-ignore  sprite asset path
      },
      refuelEvent: 0,
      storageEvent: 0,
      repairEvent: 0,
      maxSpeed: 6.5,
      // The bike is human-powered: it never needs fuel.
      usesFuel: false,
      canRefuelAtPump: false,
      roadBoost: true,
      boatSubType: 'bike',
      summonItemId: 131
    };

    // The Boat (inflatable dinghy) shares the engine 'boat' vehicle slot with the
    // Car and Bike (discriminated by $gameSystem._boatType === 'boat'). It needs no
    // fuel, has no interior/storage/repair, and can only travel on open water:
    // terrain tag 3 on the world (315) / procedural (636) maps, or region 99 anywhere.
    static BOAT = {
      type: 'boat',
      name: 'Boat',  // i18n-ignore  vehicle id
      maxFuel: 0,
      fuelRate: 0,
      interior: {
        mapId: 0,
        x: 0,
        y: 0
      },
      sprites: {
        normal: { name: 'Vehicles/!$Boat', index: 0 },  // i18n-ignore  sprite asset path
        large: { name: 'Vehicles/!$Boat_large', index: 0 }  // i18n-ignore  sprite asset path
      },
      refuelEvent: 0,
      storageEvent: 0,
      repairEvent: 0,
      maxSpeed: 5,
      // The boat is wind/paddle powered: it never needs fuel.
      usesFuel: false,
      canRefuelAtPump: false,
      boatSubType: 'boat',
      summonItemId: 167
    };

    static GENERAL = {
      searchRadius: Number(params.SearchRadius || 5),
      map315: {
        xVar: 43,
        yVar: 44,
        defaultX: 88,
        defaultY: 130
      }
    };

    // ========================================================================
    // Centralized Speed Settings - Edit these to adjust all movement speeds
    // ========================================================================
    static SPEED = {
      // ON FOOT SPEEDS (non-map 315)
      onFootBase: 4,                    // Base walking speed
      onFootAutorunBoost: 1,            // Boost from autorun (added to base)
      onFootMaxWithShift: null,         // Max speed with Shift (uses multiplier below)

      // ON FOOT SPEEDS (map 315 only)
      map315OnFootSpeed: 4,             // On foot walking speed on map 315

      // VEHICLE SPEEDS (non-map 315)
      vehicleMaxSpeed: 6,               // Default vehicle speed (per-vehicle maxSpeed overrides)
      bikeMaxSpeed: 6.5,                // Maximum speed for bike (see BIKE.maxSpeed)

      // VEHICLE SPEEDS (map 315 only)
      map315VehicleSpeed: 5,            // Vehicle speed on map 315

      // BOOST
      speedBoostMultiplier: Number(params.speedBoostMultiplier || 1.3)  // Shift key multiplier (#114: reduced from 1.5)
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Selects the appropriate sprite info for a vehicle config based on the current map.
   * On map 315, uses normal sprites; on other maps, prefers large sprites with fallback.
   */
  function selectVehicleSprite(config) {
    if (!config || !config.sprites) return null;
    const isMap315 = $gameMap.mapId() === 315;
    return isMap315 ? config.sprites.normal : (config.sprites.large || config.sprites.normal);
  }

  /**
   * Shows a localized (or skip-localized) message via the game message system.
   */
  function showLocalizedMessage(text) {
    window.skipLocalization = true;
    $gameMessage.add(text);
    window.skipLocalization = false;
  }

  /**
   * Refueling availability (replaces the old "Camper Refuel" common event 104).
   * Refueling is allowed when a "Fuel Pump" event is present on the current map,
   * or when standing over a City / Burg / Village biome tile on the world map (315).
   */
  function canRefuelHere() {
    const events = ($dataMap && $dataMap.events) ? $dataMap.events : [];
    if (events.some(e => e && e.name === 'Fuel Pump')) return true;  // i18n-ignore  event name

    if ($gameMap.mapId() === 315 && $gameSystem.getBiomeFromWorldCoordinates) {
      const biome = ($gameSystem.getBiomeFromWorldCoordinates($gamePlayer.x, $gamePlayer.y) || '').toLowerCase();
      if (biome.startsWith('city') || biome.startsWith('burg') || biome.startsWith('village')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Opens the refuel station UI in code, or reports that no pump is nearby.
   */
  function openVehicleRefuel() {
    if (!canRefuelHere()) {
      showLocalizedMessage(T('VehicleSystem.noGasPump'));
      return;
    }
    const scene = SceneManager._scene;
    if (scene && scene.showRefuelWindow) {
      $gamePlayer.setMovementLock(true);
      scene.showRefuelWindow();
    }
  }

  // What a vehicle is CALLED. config.name is an identifier (every branch below
  // and half this plugin switch on it), so display sites go through this
  // instead: Em's and Bubba's camper is The Beast, and it says so on the HUD,
  // in the action menu, in the vehicles pockets and on its own interior map
  // (CharacterCreationPresets.camperName, switches 48/49).
  function vehicleDisplayName(config) {
    if (!config) return '';
    // config.name is the id (matched by upgradeTypeForConfig, getReturnFlagName
    // and the config.name === 'X' guards); this is the only place it is shown.
    const label = T('VehicleSystem.vehicle.' + config.name);
    if (config.name !== 'Camper') return label;  // i18n-ignore  vehicle id
    return window.CharacterPresets?.camperName?.(label) ?? label;
  }

  // The same name for sentences that already supply the article ("The %1 is not
  // here"): the common noun lowercased, or the proper name with its own article
  // stripped, so The Beast never comes out as "the the beast".
  function vehicleNounName(config) {
    const shown = vehicleDisplayName(config);
    if (!config || shown === config.name) return String(shown).toLowerCase();
    return shown.replace(/^(the|la|il|lo)\s+/i, '');
  }

  // Maps a vehicle config to the VehicleUpgrades / maintenance type key.
  function upgradeTypeForConfig(config) {
    if (!config) return null;
    switch (config.name) {
      case 'Camper': return 'camper';  // i18n-ignore  vehicle id
      case 'Car': return 'car';  // i18n-ignore  vehicle id
      case 'Bike': return 'bike';  // i18n-ignore  vehicle id
      case 'Boat': return 'boat';  // i18n-ignore  vehicle id
      case 'Starship': return 'airship';  // i18n-ignore  vehicle id
      default: return null;
    }
  }

  // Effective max fuel for a config, accounting for the Expanded Tank upgrade.
  function configMaxFuel(config) {
    const base = config ? (config.maxFuel || 0) : 0;
    const type = upgradeTypeForConfig(config);
    if (type && window.VehicleUpgrades) return window.VehicleUpgrades.effectiveMaxFuel(type, base);
    return base;
  }

  // ============================================================================
  // Per-vehicle fuel store (window.VehicleFuel)
  // ============================================================================
  //
  // Fuel is NO LONGER kept in RPG Maker variables (the old Camper=65 / Car=71 /
  // Airship=146 / Bike=152 slots). Those were shared, unnamespaced globals: any
  // other event or plugin writing to variable 65 silently drained the camper's
  // tank, which is what emptied a full tank within a couple of metres.
  //
  // Instead each vehicle owns its own tank in a dedicated object on $gameSystem
  // (so it persists in saves) keyed by vehicle: 'camper' | 'car' | 'bike' |
  // 'airship'. Tanks are fully independent; the bike is human-powered and never
  // consumes or stores fuel. All fuel access across the vehicle plugins goes
  // through this one API.

  // The config a vehicle key names. The same keys address the fuel store, the
  // position store and the upgrade/maintenance types, so one lookup serves all.
  function configForVehicleKey(key) {
    switch (key) {
      case 'camper':  return VehicleConfig.CAMPER;
      case 'car':     return VehicleConfig.CAR;
      case 'bike':    return VehicleConfig.BIKE;
      case 'boat':    return VehicleConfig.BOAT;
      case 'airship': return VehicleConfig.AIRSHIP;
      default:        return null;
    }
  }

  const VehicleFuel = {
    // Fuel key for a Game_Vehicle config (or null for unsupported types).
    keyForConfig(config) { return upgradeTypeForConfig(config); },

    // Backing store, lazily created so it also appears in older saves.
    _store() {
      if (!$gameSystem._vehicleFuelData) $gameSystem._vehicleFuelData = {};
      return $gameSystem._vehicleFuelData;
    },

    usesFuel(key) {
      const c = configForVehicleKey(key);
      return !!(c && c.usesFuel);
    },

    // Effective tank capacity (honors the Expanded Tank upgrade).
    max(key) {
      return configMaxFuel(configForVehicleKey(key));
    },

    // Current litres in the tank. Fuel-free vehicles (bike) always read as full.
    get(key) {
      if (!this.usesFuel(key)) return this.max(key);
      const store = this._store();
      if (typeof store[key] !== 'number' || !isFinite(store[key])) {
        // Fresh tank (new save, or first access): start full.
        store[key] = this.max(key);
      }
      return store[key];
    },

    // Set the tank level, clamped to [0, max]. No-op for fuel-free vehicles.
    set(key, litres) {
      if (!this.usesFuel(key)) return;
      const v = Math.max(0, Math.min(this.max(key), isFinite(litres) ? litres : 0));
      this._store()[key] = v;
    },

    // Add fuel (refuel), clamped to the tank capacity.
    add(key, amount) { this.set(key, this.get(key) + (Number(amount) || 0)); },

    // Burn fuel, never below empty. No-op for fuel-free vehicles.
    consume(key, amount) {
      if (!this.usesFuel(key) || !(amount > 0)) return;
      this.set(key, this.get(key) - amount);
    },

    // True while the tank has fuel (or the vehicle needs none).
    has(key) {
      if (!this.usesFuel(key)) return true;
      return this.get(key) > 0;
    }
  };
  window.VehicleFuel = VehicleFuel;

  // ============================================================================
  // Per-vehicle position store (window.VehiclePosition)
  // ============================================================================
  //
  // A vehicle's parked map + tile coordinates are NOT kept in RPG Maker variables
  // (the old Camper 63/64/67, Car 69/70/72, Airship 144/145/147, Bike 150/151/153
  // slots) and are NOT world data either: like fuel, each vehicle owns its parked
  // location in a dedicated object on $gameSystem, so it lives in the savegame
  // alone and never leaks into the shared world folder. Keys are the vehicle keys
  // 'camper' | 'car' | 'bike' | 'boat' | 'airship'.
  //
  // This store is the single source of truth for where a parked vehicle sits.
  // Scene_Map re-places every Game_Vehicle from it on map load
  // (VehicleManager.reconcileToStore) AND takes off the map any vehicle that
  // belongs elsewhere: the procedural map is one reused map id (636), so without
  // that eviction a camper left in one biome keeps standing on the next biome's
  // terrain (over open water, half of it not even solid) as the player walks on.
  //
  // A park record is { mapId, x, y, worldX, worldY, alien, order }:
  //   mapId/x/y      the canonical parked tile, on whatever map it was left on
  //                  (world map, a procedural biome, or any authored map)
  //   worldX/worldY  the world-map (315) tile that map corresponds to. This is
  //                  where the vehicle is shown on the world map, and for a
  //                  procedural park it also says WHICH biome it was left in
  //   alien          parked on an alien landing grid, which reuses map 636 and the
  //                  world-coordinate variables as grid cells: such a park has no
  //                  world-map tile and is never shown on map 315
  //   layer          depth in the procedural layer stack, since one world square
  //                  generates a different map per cave floor / ocean depth
  //   order          park sequence, so when several vehicles share one tile the
  //                  last one parked there is the one drawn

  const VEHICLE_KEYS = ['camper', 'car', 'bike', 'boat', 'airship'];

  // The reused procedural map's id (owned by WorldMapReturn; 636 by default).
  function proceduralMapId() {
    return (window.WorldMapReturn && window.WorldMapReturn.procMapId) || 636;
  }

  // True while the loaded procedural map is an alien planet's landing grid.
  function isAlienSurfaceNow() {
    return !!(window.GalaxySim && window.GalaxySim.isAlienSurface &&
      window.GalaxySim.isAlienSurface());
  }

  // How deep in the layer stack (cave floors, ocean depths) the loaded procedural
  // map is. One world square generates a different map per depth, so a vehicle
  // left on the surface must not turn up in the cave under it.
  function currentProcLayer() {
    const pg = $gameSystem._procGenData;
    return (pg && pg.biomeLayerStack && pg.biomeLayerStack.length) || 0;
  }

  // World-map (map 315) coordinates the CURRENT map corresponds to. These are the
  // coords a parked vehicle is shown at on the world map, and the key that decides
  // whether a proc-map (636) vehicle belongs to the biome currently loaded:
  //   - Map 315:  the tile IS the world coord (use the player's tile).
  //   - Proc map: the world tile the biome was generated from, taken from
  //               procGenData (authoritative) and falling back to Vars 43/44.
  //   - Any other map: its <Coords x y> notetag if present, else the last known
  //               player world coords (Vars 43/44), else the map315 default spawn.
  function currentWorldCoords() {
    const mapId = $gameMap.mapId();
    const xVar = VehicleConfig.GENERAL.map315.xVar;
    const yVar = VehicleConfig.GENERAL.map315.yVar;
    if (mapId === 315) {
      return { x: $gamePlayer.x, y: $gamePlayer.y };
    }
    if (mapId === proceduralMapId()) {
      const pg = $gameSystem._procGenData;
      if (pg && typeof pg.originX === 'number' && typeof pg.originY === 'number') {
        return { x: pg.originX, y: pg.originY };
      }
      return { x: $gameVariables.value(xVar) || 0, y: $gameVariables.value(yVar) || 0 };
    }
    if ($gameMap._coordsDest) {
      return { x: $gameMap._coordsDest.x, y: $gameMap._coordsDest.y };
    }
    return {
      x: $gameVariables.value(xVar) || VehicleConfig.GENERAL.map315.defaultX,
      y: $gameVariables.value(yVar) || VehicleConfig.GENERAL.map315.defaultY
    };
  }

  /**
   * The world-map tile a given map corresponds to, for a map that is not
   * necessarily the one loaded (fast travel parks a vehicle on its destination
   * map before the transfer happens). Reads that map's <Coords x y> notetag
   * straight from its data file when it has to, so parking on a map tagged
   * <Coords 62 117> always puts the vehicle at 62,117 on the world map.
   */
  function worldCoordsForMap(mapId, x, y) {
    if (mapId === 315) return { x: Number(x) || 0, y: Number(y) || 0 };
    if (mapId === $gameMap.mapId()) return currentWorldCoords();
    const data = mapCache.getMapData(mapId);
    const note = (data && data.note) || '';
    const match = note.match(/<\s*coords\b\s*[:=]?\s*(\d+)\D+(\d+)\s*>/i);
    if (match) return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
    return currentWorldCoords();
  }

  // Park sequence counter, kept in the save so the "last one parked here" answer
  // survives reloading.
  function nextParkOrder() {
    const current = Number($gameSystem._vehicleParkOrder) || 0;
    $gameSystem._vehicleParkOrder = current + 1;
    return $gameSystem._vehicleParkOrder;
  }

  const VehiclePosition = {
    // Position key for a Game_Vehicle config (matches the fuel keys).
    keyForConfig(config) { return upgradeTypeForConfig(config); },

    // Backing store, lazily created so it also appears in older saves.
    _store() {
      if (!$gameSystem._vehiclePositionData) $gameSystem._vehiclePositionData = {};
      return $gameSystem._vehiclePositionData;
    },

    // The park record for a vehicle, or null if it was never parked.
    get(key) { return (key && this._store()[key]) || null; },

    // worldX / worldY are optional: when omitted they are resolved from the map
    // being parked on (its own tile on map 315, its <Coords> tag elsewhere), so
    // legacy callers that only pass a tile still get correct world coords.
    set(key, mapId, x, y, worldX, worldY) {
      if (!key) return;
      mapId = Number(mapId) || 0;
      x = Number(x) || 0;
      y = Number(y) || 0;
      let wx, wy;
      if (worldX !== undefined && worldY !== undefined) {
        wx = Number(worldX) || 0;
        wy = Number(worldY) || 0;
      } else {
        const wc = worldCoordsForMap(mapId, x, y);
        wx = wc.x; wy = wc.y;
      }
      const onProcMap = mapId === proceduralMapId() && mapId === $gameMap.mapId();
      const alien = onProcMap && isAlienSurfaceNow();
      const layer = onProcMap ? currentProcLayer() : 0;
      this._store()[key] = {
        mapId, x, y, worldX: wx, worldY: wy, alien, layer, order: nextParkOrder()
      };
    },

    mapId(key) { const p = this.get(key); return p ? p.mapId : 0; },
    x(key)     { const p = this.get(key); return p ? p.x : 0; },
    y(key)     { const p = this.get(key); return p ? p.y : 0; },
    order(key) { const p = this.get(key); return (p && Number(p.order)) || 0; },
    // World coords for map-315 display. A legacy record with no world coords only
    // has a usable one when it was parked on the world map itself.
    worldX(key) {
      const p = this.get(key);
      if (!p) return 0;
      if (typeof p.worldX === 'number') return p.worldX;
      return p.mapId === 315 ? p.x : 0;
    },
    worldY(key) {
      const p = this.get(key);
      if (!p) return 0;
      if (typeof p.worldY === 'number') return p.worldY;
      return p.mapId === 315 ? p.y : 0;
    },

    // ------------------------------------------------------------------------
    // Where the PLAYER stood when they boarded / entered the vehicle. This is a
    // separate record on purpose: the parked tile belongs to the vehicle and must
    // stay exactly where the vehicle is, so the "step back out of the interior"
    // destination can no longer overwrite it.
    // ------------------------------------------------------------------------
    setEntry(key, mapId, x, y) {
      if (!key) return;
      if (!$gameSystem._vehicleEntryData) $gameSystem._vehicleEntryData = {};
      $gameSystem._vehicleEntryData[key] = {
        mapId: Number(mapId) || 0, x: Number(x) || 0, y: Number(y) || 0
      };
    },

    // The spot to drop the player when they leave the vehicle's interior: where
    // they got in, as long as the vehicle is still parked on that same map,
    // otherwise wherever the vehicle has since been taken.
    exit(key) {
      const entry = key && $gameSystem._vehicleEntryData && $gameSystem._vehicleEntryData[key];
      if (entry && entry.mapId && entry.mapId === this.mapId(key)) {
        return { mapId: entry.mapId, x: entry.x, y: entry.y };
      }
      return resolveReturnDestination(key);
    }
  };
  window.VehiclePosition = VehiclePosition;

  /**
   * Where a "return to / teleport to" command should drop the player for a parked
   * vehicle. The canonical park may be the transient procedural map (636), which
   * cannot be entered directly without regenerating its biome. In that case send
   * the player to map 315 at the vehicle's world coords instead, where the vehicle
   * is always shown (reconcileToStore) and can be boarded. Otherwise use the stored
   * map/tile as-is.
   */
  function resolveReturnDestination(key) {
    const pos = VehiclePosition.get(key);
    if (!pos) return { mapId: 315, x: 0, y: 0 };
    if (pos.mapId === proceduralMapId() || !pos.mapId) {
      return { mapId: 315, x: VehiclePosition.worldX(key), y: VehiclePosition.worldY(key) };
    }
    return { mapId: pos.mapId, x: pos.x, y: pos.y };
  }

  /**
   * The tile a parked vehicle occupies on the map that is loaded right now, or
   * null when it is parked somewhere else. This is the one rule that decides
   * where a vehicle is visible:
   *   - map 315:    at its world coordinates, wherever it is actually parked
   *                 (an alien landing grid has no world tile, so it shows nothing)
   *   - proc map:   only when it was left in THIS biome (same world coordinates,
   *                 same realm), at the internal tile it was left on
   *   - any other:  only when it was parked on that very map
   */
  function parkedTileOnCurrentMap(key) {
    const pos = VehiclePosition.get(key);
    if (!pos || !pos.mapId) return null;

    const currentMap = $gameMap.mapId();
    const procMap = proceduralMapId();
    let tx, ty;

    if (currentMap === 315) {
      if (pos.alien) return null;
      tx = VehiclePosition.worldX(key);
      ty = VehiclePosition.worldY(key);
    } else if (currentMap === procMap) {
      if (pos.mapId !== procMap) return null;
      if (!!pos.alien !== isAlienSurfaceNow()) return null;
      if ((pos.layer || 0) !== currentProcLayer()) return null;
      const wc = currentWorldCoords();
      if (VehiclePosition.worldX(key) !== wc.x || VehiclePosition.worldY(key) !== wc.y) return null;
      tx = pos.x; ty = pos.y;
    } else {
      if (pos.mapId !== currentMap) return null;
      tx = pos.x; ty = pos.y;
    }

    if (!(tx > 0 || ty > 0)) return null;
    if (!$gameMap.isValid(tx, ty)) return null;
    return { x: tx, y: ty };
  }

  // Set while THIS plugin re-places a vehicle from the store, so the setLocation
  // hook below does not write those moves straight back into the store (an
  // eviction to map 0 would otherwise be recorded as the vehicle's parked spot).
  let movingVehicleInternally = false;

  function moveVehicleInternally(vehicle, mapId, x, y) {
    movingVehicleInternally = true;
    try {
      vehicle.setLocation(mapId, x, y);
    } finally {
      movingVehicleInternally = false;
    }
  }

  /**
   * Re-decides which vehicle is drawn on each tile of the current map, with
   * `preferred` (the one just parked or just picked) always on top.
   */
  function restackCurrentMap(preferred) {
    const mapId = $gameMap.mapId();
    vehicleManager.applyStacking(
      vehicleManager.activeSlots().filter(slot => slot.vehicle._mapId === mapId),
      preferred
    );
  }

  /**
   * Opens the repair + upgrade workshop for a vehicle. Prefers the in-code
   * scene (VehicleSystemRepair) and falls back to the legacy common event.
   */
  function openVehicleMaintenance(config) {
    const type = upgradeTypeForConfig(config);
    if (type && window.VehicleMaintenance) {
      window.VehicleMaintenance.open(type);
    } else if (config && config.repairEvent) {
      $gameTemp.reserveCommonEvent(config.repairEvent);
    }
  }

  // Camper aquatic mode: extra fuel drain while crossing water.
  const AQUATIC_FUEL_MULTIPLIER = 1.5;

  /**
   * True when the tile is open water the camper should cross in aquatic mode.
   * Mirrors the project's two water markers: terrain tag 3 and region 99.
   * Region 10 (blocked water) is deliberately excluded.
   */
  function isWaterTileForVehicle(x, y) {
    if ($gameMap.regionId(x, y) === 10) return false;
    if ($gameMap.regionId(x, y) === 99) return true;
    return $gameMap.terrainTag(x, y) === 3;
  }

  /**
   * True when the tile is navigable by the Boat (inflatable dinghy).
   * The boat is water-only: it may sit on open-water terrain (tag 3) but ONLY on
   * the world map (315) and the procedural map (636), and on region 99 water on
   * ANY map. Every other tile (dry land, blocked water region 10, etc.) is off-limits.
   */
  function isBoatPassableTile(x, y) {
    if (!$gameMap.isValid(x, y)) return false;
    if ($gameMap.regionId(x, y) === 10) return false;
    if ($gameMap.regionId(x, y) === 99) return true;
    const mapId = $gameMap.mapId();
    if ((mapId === 315 || mapId === proceduralMapId()) && $gameMap.terrainTag(x, y) === 3) return true;
    return false;
  }

  /**
   * True when the given engine 'boat'-slot vehicle is currently the Boat subtype
   * (as opposed to the Car or the Bike, which share the same slot).
   */
  function isBoatSubType(vehicle) {
    return !!(vehicle && vehicle.isBoat() && $gameSystem._boatType === 'boat');
  }

  // Ground vehicles burn less game-time per tile while over a world-map (315)
  // road biome. Their move speed is unchanged: a road saves time, not distance.
  // The Airship (flies) and Boat (water-only) are excluded via their config's
  // missing roadBoost flag.
  const ROAD_TIME_FACTOR = 0.5;  // fraction of the normal per-tile game-minutes on roads

  // Hard ceiling on the player's move speed. RPG Maker walks the player
  // 2^speed / 256 tiles per frame, so a speed of 8 covers a full tile in a
  // single frame: the player appears to jump straight over the tile they just
  // entered. Staying below 8 keeps every tile step visible.
  const MAX_MOVE_SPEED = 7;

  // True when the given world-map tile sits on a road biome.
  function isWorldRoadTile(x, y) {
    if ($gameMap.mapId() !== 315) return false;
    if (!$gameSystem.getBiomeFromWorldCoordinates) return false;
    const biome = ($gameSystem.getBiomeFromWorldCoordinates(x, y) || '').toLowerCase();
    return biome.includes('road');
  }

  // True when the player is driving a road-boostable vehicle over a world-map road.
  function isRidingOnWorldRoad() {
    if ($gameMap.mapId() !== 315 || !isPlayerRidingCustomVehicle()) return false;
    const config = vehicleManager.getConfig($gamePlayer.vehicle());
    if (!config || !config.roadBoost) return false;
    return isWorldRoadTile($gamePlayer.x, $gamePlayer.y);
  }

  /**
   * Safe region/terrain check for vehicle passability.
   * Returns true if the tile is blocked for vehicles.
   */
  function isVehicleBlockedTile(x, y, mapId) {
    const regionId = $gameMap.regionId(x, y);
    if (regionId === 10) return true;
    if (regionId === 4) return false;
    if (mapId === 315) {
      return $gameMap.terrainTag(x, y) === 3;
    }
    return false;
  }

  /**
   * Returns the first {x, y} tile in a (possibly unloaded) map with the given region ID,
   * or null if none found. Uses the synchronous mapCache loader.
   */
  function findRegionTile(mapId, regionId) {
    const mapData = mapCache.getMapData(mapId);
    if (!mapData) return null;
    const w = mapData.width;
    const h = mapData.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mapData.data[(5 * h + y) * w + x] === regionId) return { x, y };
      }
    }
    return null;
  }

  /**
   * Checks if a vehicle type uses our custom system (ship, boat, airship).
   */
  function isCustomVehicle(vehicle) {
    return vehicle && (vehicle.isShip() || vehicle.isBoat() || vehicle.isAirship());
  }

  /**
   * Checks if the player is riding a custom vehicle.
   */
  function isPlayerRidingCustomVehicle() {
    if (!$gamePlayer.isInVehicle()) return false;
    return isCustomVehicle($gamePlayer.vehicle());
  }

  // ============================================================================
  // ConfigManager - Remove autorun from options
  // ============================================================================

  const _ConfigManager_makeData = ConfigManager.makeData;
  ConfigManager.makeData = function () {
    const config = _ConfigManager_makeData.call(this);
    delete config.alwaysDash;
    return config;
  };

  const _ConfigManager_applyData = ConfigManager.applyData;
  ConfigManager.applyData = function (config) {
    _ConfigManager_applyData.call(this, config);
    this.alwaysDash = true;
  };

  // ============================================================================
  // Window_Options - Remove autorun option
  // ============================================================================

  if (window.GameOptions) {
    const videoTab = window.GameOptions.tabs.find(t => t.id === 'video');
    if (videoTab) {
      videoTab.symbols = videoTab.symbols.filter(s => s !== 'alwaysDash');
    }
  } else {
    const _Window_Options_addGeneralOptions = Window_Options.prototype.addGeneralOptions;
    Window_Options.prototype.addGeneralOptions = function () {
      _Window_Options_addGeneralOptions.call(this);
      this._list = this._list.filter(option => option.symbol !== 'alwaysDash');
    };
  }

  // ============================================================================
  // Cache Manager
  // ============================================================================

  class MapDataCache {
    constructor() {
      this._cache = new Map();
      this._interiorCache = new Map();
    }

    getMapData(mapId) {
      if (!this._cache.has(mapId)) {
        this._loadMapData(mapId);
      }
      return this._cache.get(mapId);
    }

    isInterior(mapId) {
      if (mapId === VehicleConfig.CAMPER.interior.mapId ||
        mapId === VehicleConfig.CAR.interior.mapId ||
        mapId === VehicleConfig.AIRSHIP.interior.mapId) {
        return true;
      }

      if (mapId === $gameMap.mapId() && $dataMap) {
        const note = $dataMap.note;
        if (note && note.includes('<Interior>') && !note.includes('<Covered>')) {
          return true;
        }
      }

      if (!this._interiorCache.has(mapId)) {
        const data = this.getMapData(mapId);
        const isInt = data && data.note &&
          data.note.includes('<Interior>') &&
          !data.note.includes('<Covered>');
        this._interiorCache.set(mapId, isInt);
      }
      return this._interiorCache.get(mapId);
    }

    _loadMapData(mapId) {
      if (!$dataMapInfos[mapId]) {
        this._cache.set(mapId, null);
        return;
      }

      try {
        const filename = 'Map%1.json'.format(mapId.padZero(3));
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'data/' + filename, false);
        xhr.overrideMimeType('application/json');
        xhr.send();

        if (xhr.status < 400) {
          this._cache.set(mapId, JSON.parse(xhr.responseText));
        } else {
          this._cache.set(mapId, null);
        }
      } catch (e) {
        this._cache.set(mapId, null);
      }
    }

    clear() {
      this._cache.clear();
      this._interiorCache.clear();
    }
  }

  const mapCache = new MapDataCache();

  // ============================================================================
  // Vehicle Manager
  // ============================================================================

  class VehicleManager {
    constructor() {
      this._initialized = false;
    }

    initialize() {
      if (this._initialized) return;

      if (!$gameSystem._boatType) $gameSystem._boatType = 'car';

      this._initializeVehicle(VehicleConfig.CAMPER);
      this._initializeVehicle(VehicleConfig.CAR);
      this._initializeVehicle(VehicleConfig.BIKE);
      this._initializeVehicle(VehicleConfig.BOAT);
      this._initializeVehicle(VehicleConfig.AIRSHIP);

      this._initialized = true;
    }

    _initializeVehicle(config) {
      // Touch the fuel store so a fresh vehicle starts with a full tank. The
      // level lives in window.VehicleFuel (per-vehicle data), not a shared
      // RPG Maker variable. VehicleFuel.get() lazily fills the tank on first read.
      if (config.usesFuel) {
        VehicleFuel.get(VehicleFuel.keyForConfig(config));
      }

      // The first time a vehicle is seen it adopts wherever the engine has it,
      // i.e. its System.json start position, so a vehicle the player has never
      // parked still stands where the project put it. The Car, Bike and Boat
      // share one engine slot, so only the sub-type that slot currently stands
      // for may claim its tile; the other two start unplaced (tile 0,0).
      const posKey = VehiclePosition.keyForConfig(config);
      if (VehiclePosition.get(posKey)) return;

      const vehicle = this.getVehicle(config.type);
      const slotIsThisVehicle = config.type !== 'boat' || $gameSystem._boatType === config.boatSubType;
      const adopt = !!vehicle && vehicle._mapId > 0 && slotIsThisVehicle &&
        !mapCache.isInterior(vehicle._mapId);
      if (adopt) {
        VehiclePosition.set(posKey, vehicle._mapId, vehicle.x, vehicle.y);
      } else {
        VehiclePosition.set(posKey, 315, 0, 0);
      }
    }

    // The vehicle key the engine's single 'boat' slot currently stands for. The
    // Car, the Bike and the Boat all share that one Game_Vehicle, so only one of
    // them can be physically present at a time.
    boatKey() {
      if ($gameSystem._boatType === 'bike') return 'bike';
      if ($gameSystem._boatType === 'boat') return 'boat';
      return 'car';
    }

    // Points the shared 'boat' slot at another sub-type (car / bike / boat),
    // rebuilding the config and sprite that go with it. Never runs while the
    // player is riding that slot.
    setBoatKey(key) {
      const config = configForVehicleKey(key);
      if (!config || config.type !== 'boat') return;
      if ($gameSystem._boatType === config.boatSubType) return;
      const vehicle = this.getVehicle('boat');
      if (vehicle && $gamePlayer.isInVehicle() && $gamePlayer.vehicle() === vehicle) return;
      $gameSystem._boatType = config.boatSubType;
      if (!vehicle) return;
      vehicle._config = this.getConfig(vehicle);
      const sprite = selectVehicleSprite(config);
      if (sprite) {
        vehicle._characterName = sprite.name;
        vehicle._characterIndex = sprite.index;
      }
    }

    // The three engine slots and the vehicle key each of them stands for now.
    activeSlots() {
      return [
        { key: 'camper', vehicle: this.getVehicle('ship') },
        { key: 'airship', vehicle: this.getVehicle('airship') },
        { key: this.boatKey(), vehicle: this.getVehicle('boat') }
      ].filter(slot => !!slot.vehicle);
    }

    // Re-place every parked (non-ridden) vehicle on the current map from the
    // internal position store, and take off the map any vehicle parked elsewhere.
    // Placing is what stops a memorized vehicle vanishing across map changes;
    // evicting is what stops a vehicle left in one procedural biome from standing
    // in the middle of the next one (all biomes share map id 636).
    reconcileToStore() {
      const currentMap = $gameMap.mapId();
      if (mapCache.isInterior(currentMap)) return;

      const ridden = $gamePlayer.isInVehicle() ? $gamePlayer.vehicle() : null;
      const boatVehicle = this.getVehicle('boat');

      // Decide which of the three shared-slot vehicles the 'boat' slot should be:
      // the one parked here, most recently parked first. With none parked here the
      // slot keeps its current sub-type and is simply taken off the map below.
      if (boatVehicle && ridden !== boatVehicle) {
        const parkedHere = ['car', 'bike', 'boat']
          .filter(key => !!parkedTileOnCurrentMap(key))
          .sort((a, b) => VehiclePosition.order(b) - VehiclePosition.order(a));
        if (parkedHere.length > 0) this.setBoatKey(parkedHere[0]);
      }

      const placed = [];
      this.activeSlots().forEach(({ key, vehicle }) => {
        vehicle._vsStacked = false;
        // Never move the vehicle the player is currently riding.
        if (vehicle === ridden) return;

        const tile = parkedTileOnCurrentMap(key);
        if (!tile) {
          // Parked elsewhere: map id 0 makes Game_Vehicle.pos() stop matching, so
          // the vehicle is neither drawn nor solid nor boardable here. The store
          // still holds its real spot, and it is put back when the player returns.
          if (vehicle._mapId === currentMap) moveVehicleInternally(vehicle, 0, vehicle.x, vehicle.y);
          return;
        }

        if (vehicle._mapId !== currentMap || vehicle.x !== tile.x || vehicle.y !== tile.y) {
          moveVehicleInternally(vehicle, currentMap, tile.x, tile.y);
        }
        placed.push({ key, vehicle });
      });

      this.applyStacking(placed);
    }

    // Several vehicles can be parked on one tile (most easily on the world map,
    // where every park is shown at its world coordinates). Only the last one
    // parked there is drawn; the others stay boardable through the chooser.
    // `preferred` is the Game_Vehicle that must be the one drawn regardless of
    // park order, which is how the vehicle picked out of the chooser comes to the top.
    applyStacking(placed, preferred) {
      const shown = new Map();  // "x,y" -> the slot currently drawn there
      placed.forEach(slot => {
        const tileKey = `${slot.vehicle.x},${slot.vehicle.y}`;
        const rival = shown.get(tileKey);
        if (!rival) {
          slot.vehicle._vsStacked = false;
          shown.set(tileKey, slot);
          return;
        }
        const slotWins = slot.vehicle === preferred ? true
          : rival.vehicle === preferred ? false
            : VehiclePosition.order(slot.key) > VehiclePosition.order(rival.key);
        const winner = slotWins ? slot : rival;
        const loser = slotWins ? rival : slot;
        winner.vehicle._vsStacked = false;
        loser.vehicle._vsStacked = true;
        shown.set(tileKey, winner);
      });
      placed.forEach(slot => slot.vehicle.refresh());
    }

    getVehicle(type) {
      return $gameMap.vehicle(type);
    }

    getConfig(vehicle) {
      if (!vehicle) return null;
      if (vehicle.isShip()) return VehicleConfig.CAMPER;
      if (vehicle.isBoat()) {
        if ($gameSystem._boatType === 'bike') return VehicleConfig.BIKE;
        if ($gameSystem._boatType === 'boat') return VehicleConfig.BOAT;
        return VehicleConfig.CAR;
      }
      if (vehicle.isAirship()) return VehicleConfig.AIRSHIP;
      return null;
    }

    /**
     * Returns the flag name prefix for auto-ride/spawn-after-transfer.
     * Returns null if the config/vehicle type is not supported for return commands.
     */
    getReturnFlagName(config) {
      if (!config) return null;
      if (config.type === 'ship') return 'Camper';  // i18n-ignore  vehicle id
      if (config.type === 'boat') return 'Car';  // i18n-ignore  vehicle id
      if (config.type === 'airship') return 'Starship';  // i18n-ignore  vehicle id
      return null;
    }

    // Only write when the value actually changed: Game_Variables.onChange
    // triggers a full map event-page refresh, which is expensive per frame.
    _setVarIfChanged(variableId, value) {
      if ($gameVariables.value(variableId) !== value) {
        $gameVariables.setValue(variableId, value);
      }
    }

    savePosition(vehicle) {
      const config = this.getConfig(vehicle);
      if (!config || mapCache.isInterior($gameMap.mapId())) return;
      const key = VehiclePosition.keyForConfig(config);
      const mapId = $gameMap.mapId();

      // Store the canonical parked tile on WHATEVER map we are on (world map 315,
      // the reused procedural map 636, or any regular map) together with the world
      // coordinates that map corresponds to. The world coords let the vehicle be
      // shown on map 315 no matter where it is actually parked, and (for the proc
      // map) identify which biome it was left in so it is only re-placed in that
      // biome, at the same internal tile, when that world square is revisited.
      const wc = currentWorldCoords();
      VehiclePosition.set(key, mapId, vehicle.x, vehicle.y, wc.x, wc.y);
      // The vehicle just parked is the one drawn where it stands, so it comes out
      // on top of anything already parked on that tile.
      if (!vehicle._driving) restackCurrentMap(vehicle);

      // Vars 43/44 are the PLAYER's world coordinates (shared across systems),
      // not vehicle-owned data; keep them in sync while driving on the world map.
      if (mapId === 315) {
        this._setVarIfChanged(VehicleConfig.GENERAL.map315.xVar, vehicle.x);
        this._setVarIfChanged(VehicleConfig.GENERAL.map315.yVar, vehicle.y);
      }
    }

    summon(vehicleType, subType) {
      if (mapCache.isInterior($gameMap.mapId())) {
        showLocalizedMessage(T('VehicleSystem.noSpaceToSummon'));
        return;
      }

      if (vehicleType === 'boat') {
        $gameSystem._boatType = subType || 'car';
      }

      const vehicle = this.getVehicle(vehicleType);
      if (!vehicle) return;

      const config = this.getConfig(vehicle);

      // Update graphic before teleport
      if (vehicle.refresh) vehicle.refresh();

      const pos = PositionFinder.findNearPlayer(vehicle);
      if (pos) {
        vehicle.setLocation($gameMap.mapId(), pos.x, pos.y);
        this.savePosition(vehicle);
        this._playTeleportEffect(vehicle);
      } else {
        showLocalizedMessage(T('VehicleSystem.noValidPosition'));
      }
    }

    _playTeleportEffect(/*target*/) {
      AudioManager.playSe({
        name: "Teleport",
        pan: 0,
        pitch: 100,
        volume: 90
      });
      // Animation removed from summoning as per request
      // $gameTemp.requestAnimation([target], 52);
    }
  }

  // ============================================================================
  // Position Finder
  // ============================================================================

  class PositionFinder {
    static findNearPlayer(character) {
      return this.findValidPosition($gamePlayer.x, $gamePlayer.y, character);
    }

    static findValidPosition(targetX, targetY, character) {
      const adjacent = this._checkAdjacent(targetX, targetY, character);
      if (adjacent) return adjacent;
      return this._spiralSearch(targetX, targetY, character);
    }

    static _checkAdjacent(x, y, character) {
      const directions = [2, 4, 6, 8];
      for (const d of directions) {
        const nx = $gameMap.roundXWithDirection(x, d);
        const ny = $gameMap.roundYWithDirection(y, d);
        if (this._isValidPosition(nx, ny, character)) {
          return { x: nx, y: ny };
        }
      }
      return null;
    }

    static _spiralSearch(centerX, centerY, character) {
      const maxRadius = VehicleConfig.GENERAL.searchRadius;

      for (let radius = 2; radius <= maxRadius; radius++) {
        for (let i = 0; i < radius * 2; i++) {
          const positions = [
            { x: centerX - radius + i, y: centerY - radius },
            { x: centerX + radius, y: centerY - radius + i },
            { x: centerX + radius - i, y: centerY + radius },
            { x: centerX - radius, y: centerY + radius - i }
          ];

          for (const pos of positions) {
            const x = $gameMap.roundX(pos.x);
            const y = $gameMap.roundY(pos.y);
            if (this._isValidPosition(x, y, character)) {
              return { x, y };
            }
          }
        }
      }
      return null;
    }

    static _isValidPosition(x, y, character) {
      if (!character) return false;
      // The airship (Starship) flies over everything, so any in-bounds tile is a
      // valid park/return spot. Region 10 stays blocked to avoid hard no-go zones (#135).
      if (character.isAirship && character.isAirship()) {
        if (!$gameMap.isValid(x, y)) return false;
        return $gameMap.regionId(x, y) !== 10;
      }
      // The Boat can only ever park/spawn on navigable water (see isBoatPassableTile).
      if (isBoatSubType(character)) {
        return isBoatPassableTile(x, y);
      }
      if (character.isShip() || character.isBoat()) {
        if (isVehicleBlockedTile(x, y, $gameMap.mapId())) return false;
        if ($gameMap.regionId(x, y) === 4) return true;
        if ($gameMap.terrainTag(x, y) === 3) return false;
        return $gameMap.isPassable(x, y, 0);
      }
      return $gameMap.isPassable(x, y, 0);
    }

    // Top-left of a 4x4 block of tiles that are all valid for both the player and
    // the given vehicle, so the player has room and the bike can sit beside them.
    // Returns null if no such block exists.
    static findPassable4x4(vehicle) {
      const w = $gameMap.width();
      const h = $gameMap.height();
      const blockValid = (ox, oy) => {
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            const x = ox + dx, y = oy + dy;
            if (!$gameMap.isPassable(x, y, 0)) return false;
            if (vehicle && !this._isValidPosition(x, y, vehicle)) return false;
          }
        }
        return true;
      };
      // Random scan first (variety), then a deterministic sweep as a fallback.
      for (let i = 0; i < 500; i++) {
        const ox = Math.floor(Math.random() * (w - 4));
        const oy = Math.floor(Math.random() * (h - 4));
        if (blockValid(ox, oy)) return { x: ox, y: oy };
      }
      for (let oy = 0; oy <= h - 4; oy++) {
        for (let ox = 0; ox <= w - 4; ox++) {
          if (blockValid(ox, oy)) return { x: ox, y: oy };
        }
      }
      return null;
    }

    // Random tile the given vehicle could sit on, scanning the current map.
    // Falls back to the world-map default spawn if no tile is found.
    static findRandomValidTile(character) {
      const w = $gameMap.width();
      const h = $gameMap.height();
      for (let i = 0; i < 500; i++) {
        const x = Math.floor(Math.random() * w);
        const y = Math.floor(Math.random() * h);
        if (this._isValidPosition(x, y, character)) {
          return { x, y };
        }
      }
      return { x: VehicleConfig.GENERAL.map315.defaultX, y: VehicleConfig.GENERAL.map315.defaultY };
    }
  }

  // ============================================================================
  // Fuel System
  // ============================================================================

  class FuelSystem {
    static consumeFuel(vehicle, deltaTime) {
      const config = vehicleManager.getConfig(vehicle);
      if (!config || !config.usesFuel) return;

      const key = VehicleFuel.keyForConfig(config);
      if (!VehicleFuel.has(key)) return;

      let consumption = config.fuelRate * deltaTime * FUEL_CONSUMPTION_MULTIPLIER;

      if ($gameMap.mapId() !== 315) {
        consumption /= 25;
      }

      // Camper in aquatic mode (crossing water) burns fuel faster.
      if (vehicle.isShip() && vehicle._isAquatic) {
        consumption *= AQUATIC_FUEL_MULTIPLIER;
      }

      VehicleFuel.consume(key, consumption);
    }

    static refuel(vehicle, amount) {
      const config = vehicleManager.getConfig(vehicle);
      if (!config) return;
      VehicleFuel.add(VehicleFuel.keyForConfig(config), amount);
    }

    static hasFuel(vehicle) {
      const config = vehicleManager.getConfig(vehicle);
      if (!config) return false;
      return VehicleFuel.has(VehicleFuel.keyForConfig(config));
    }

    static getFuel(vehicle) {
      const config = vehicleManager.getConfig(vehicle);
      if (!config) return 0;
      return VehicleFuel.get(VehicleFuel.keyForConfig(config));
    }
  }

  // ============================================================================
  // Vehicle Speed
  // ============================================================================

  /**
   * Speed a vehicle travels at: its own maxSpeed if it declares one, otherwise
   * the shared default. Vehicles reach this speed immediately.
   */
  function vehicleSpeedFor(vehicle) {
    const config = (vehicle && vehicle._config) || vehicleManager.getConfig(vehicle);
    return (config && config.maxSpeed) ? config.maxSpeed : VehicleConfig.SPEED.vehicleMaxSpeed;
  }

  // ============================================================================
  // Vehicle Extensions
  // ============================================================================

  const vehicleManager = new VehicleManager();

  const _Game_Vehicle_initialize = Game_Vehicle.prototype.initialize;
  Game_Vehicle.prototype.initialize = function (type) {
    _Game_Vehicle_initialize.call(this, type);

    if (this.isShip() || this.isBoat() || this.isAirship()) {
      this._config = vehicleManager.getConfig(this);
      this._fuelTimer = 0;
    }
  };

  // Anything that moves a vehicle (an event's "Set Vehicle Location", the fast
  // travel network, the 3D driving scene) parks it: record it, so the position
  // store stays the one description of where every vehicle is and reconcileToStore
  // can never evict a vehicle somebody else legitimately placed.
  const _Game_Vehicle_setLocation = Game_Vehicle.prototype.setLocation;
  Game_Vehicle.prototype.setLocation = function (mapId, x, y) {
    _Game_Vehicle_setLocation.call(this, mapId, x, y);
    if (movingVehicleInternally || this._driving) return;
    if (typeof $gameSystem === 'undefined' || !$gameSystem) return;
    if (!mapId || mapCache.isInterior(mapId)) return;
    const key = VehiclePosition.keyForConfig(vehicleManager.getConfig(this));
    if (!key) return;
    const pos = VehiclePosition.get(key);
    if (pos && pos.mapId === mapId && pos.x === x && pos.y === y) return;
    VehiclePosition.set(key, mapId, x, y);
  };

  const _Game_Vehicle_update = Game_Vehicle.prototype.update;
  Game_Vehicle.prototype.update = function () {
    _Game_Vehicle_update.call(this);

    // Track whether the camper is currently sitting on a water tile so the
    // sprite (half-size) and fuel drain (1.5x) can react to aquatic travel.
    if (this.isShip()) {
      this._isAquatic = !mapCache.isInterior($gameMap.mapId()) &&
        isWaterTileForVehicle(this.x, this.y);
    }

    if (isPlayerRidingCustomVehicle() && $gamePlayer.vehicle() === this) {

      // Force speed on map 315
      const speed = $gameMap.mapId() === 315
        ? VehicleConfig.SPEED.map315VehicleSpeed
        : vehicleSpeedFor(this);
      if ($gamePlayer._moveSpeed !== speed) {
        $gamePlayer.setMoveSpeed(speed);
      }

      // Fuel consumption is handled per-step in Game_Player.increaseSteps below.
    }
  };

  const _Game_Vehicle_updateMove = Game_Vehicle.prototype.updateMove;
  Game_Vehicle.prototype.updateMove = function () {
    _Game_Vehicle_updateMove.call(this);

    if (isPlayerRidingCustomVehicle() &&
      $gamePlayer.vehicle() === this &&
      this.isMoving() &&
      (this._lastSavedX !== this.x || this._lastSavedY !== this.y)) {
      this._lastSavedX = this.x;
      this._lastSavedY = this.y;
      vehicleManager.savePosition(this);
    }
  };

  const _Game_Player_increaseSteps_VS = Game_Player.prototype.increaseSteps;
  Game_Player.prototype.increaseSteps = function () {
    _Game_Player_increaseSteps_VS.call(this);
    if (isPlayerRidingCustomVehicle()) {
      const vehicle = this.vehicle();
      if (vehicle) FuelSystem.consumeFuel(vehicle, 1);
    }
  };

  const _Game_Vehicle_updateAnimation = Game_Vehicle.prototype.updateAnimation;
  Game_Vehicle.prototype.updateAnimation = function () {
    if (isPlayerRidingCustomVehicle() && $gamePlayer.vehicle() === this) {
      if (this.isMoving()) {
        _Game_Vehicle_updateAnimation.call(this);
      } else {
        this._animationCount = 0;
        this._pattern = 1;
      }
    } else {
      _Game_Vehicle_updateAnimation.call(this);
    }
  };

  const _Game_Vehicle_isMapPassable = Game_Vehicle.prototype.isMapPassable;
  Game_Vehicle.prototype.isMapPassable = function (x, y, d) {
    if (this.isShip() || this.isBoat() || this.isAirship()) {
      if (mapCache.isInterior($gameMap.mapId())) return false;
      if (!FuelSystem.hasFuel(this)) return false;

      const x2 = $gameMap.roundXWithDirection(x, d);
      const y2 = $gameMap.roundYWithDirection(y, d);

      // The Starship is an airship: it flies over everything (blocked tiles and
      // water alike). Only fuel and the interior-map rule above restrict it (#156).
      if (this.isAirship()) return true;

      // The Boat (dinghy) is water-only: passability is fully defined by
      // isBoatPassableTile (terrain 3 on the world/procedural maps, region 99 anywhere).
      if (isBoatSubType(this)) return isBoatPassableTile(x2, y2);

      // Camper enters aquatic mode automatically: open water is passable for it
      // (region 10 stays blocked, handled inside isWaterTileForVehicle).
      if (this.isShip() && isWaterTileForVehicle(x2, y2)) return true;

      if (isVehicleBlockedTile(x2, y2, $gameMap.mapId())) return false;

      if ($gameMap.mapId() !== 315) {
        const terrainTag = $gameMap.terrainTag(x2, y2);
        if (this.isShip()) {
          if (![0, 1, 2, 5, 6].includes(terrainTag)) return false;
        } else {
          if (![1, 5, 2, 7].includes(terrainTag)) return false;
        }
      }

      return $gameMap.isPassable(x2, y2, this.reverseDir(d));
    }
    return _Game_Vehicle_isMapPassable.call(this, x, y, d);
  };

  // Aquatic camper sprite: crop to the top half so it looks half-submerged while
  // crossing water, the same way the player sprite is cropped when swimming.
  const _Sprite_Character_updateFrame_VS = Sprite_Character.prototype.updateFrame;
  Sprite_Character.prototype.updateFrame = function () {
    _Sprite_Character_updateFrame_VS.call(this);
    const ch = this._character;
    if (ch instanceof Game_Vehicle && ch.isShip() && ch._isAquatic) {
      const frame = this._frame;
      if (frame.width > 0 && frame.height > 0) {
        this.setFrame(frame.x, frame.y, frame.width, Math.floor(frame.height / 2));
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Time at the wheel trains the matching specialization (SpecializationMenu.js).
  // Every vehicle teaches its own handling; the road vehicles also share the
  // general Car Driving skill, so a camper crew is not learning from scratch
  // when it takes the car out.
  // ---------------------------------------------------------------------------
  // Taking a boat out is three skills at once: working the hull, working the
  // wind, and knowing where you are once the shore is behind you.
  // i18n-ignore-start  Specialization.json ids awarded per ridden vehicle
  const RIDE_SPECS = {
    camper: ["RV Driving", "Car Driving"],
    car: ["Car Driving"],
    bike: ["Cycling"],
    boat: ["Boat Piloting", "Sailing", "Celestial Navigation"],
    airship: ["Aircraft Piloting", "Celestial Navigation"],
  };
  // i18n-ignore-end
  const RIDE_STEPS_PER_POINT = 50;

  const _Game_Player_increaseSteps = Game_Player.prototype.increaseSteps;
  Game_Player.prototype.increaseSteps = function () {
    _Game_Player_increaseSteps.call(this);
    if (!window.SpecializationXP || !window.VehicleUpgrades) return;
    const type = window.VehicleUpgrades.currentRiddenType();
    const specs = type && RIDE_SPECS[type];
    if (!specs) { this._rideSpecSteps = 0; return; }
    this._rideSpecSteps = (this._rideSpecSteps || 0) + 1;
    if (this._rideSpecSteps < RIDE_STEPS_PER_POINT) return;
    this._rideSpecSteps = 0;
    specs.forEach((name) => window.SpecializationXP.award(name, 1));
  };

  const _Game_Vehicle_getOn = Game_Vehicle.prototype.getOn;
  Game_Vehicle.prototype.getOn = function () {
    const result = _Game_Vehicle_getOn.call(this);

    if (this.isShip() || this.isBoat() || this.isAirship()) {
      vehicleManager.savePosition(this);

      // Remember where the player got in, so leaving the interior puts them back
      // there. This is deliberately NOT the vehicle's parked position: that one
      // belongs to the vehicle and must keep pointing at the tile it stands on.
      const config = vehicleManager.getConfig(this);
      if (config && !mapCache.isInterior($gameMap.mapId()) && $gameMap.mapId() !== proceduralMapId()) {
        VehiclePosition.setEntry(VehiclePosition.keyForConfig(config), $gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
      }

      this._fuelTimer = 0;

      if ($gameMap.mapId() === 315) {
        $gamePlayer.setMoveSpeed(VehicleConfig.SPEED.map315VehicleSpeed);
        $gamePlayer._dashing = true;
      } else {
        $gamePlayer.setMoveSpeed(vehicleSpeedFor(this));
      }
    }

    return result;
  };

  const _Game_Vehicle_getOff = Game_Vehicle.prototype.getOff;
  Game_Vehicle.prototype.getOff = function () {
    if (this.isShip() || this.isBoat() || this.isAirship()) {
      vehicleManager.savePosition(this);
      $gamePlayer._dashing = false;
    }

    const result = _Game_Vehicle_getOff.call(this);

    // Restore the parked sprite. While driving, refresh() blanks _characterName
    // (so the ridden graphic hides under the player); nothing else refreshes the
    // vehicle when the player stops on the same map, so without this the parked
    // vehicle turns invisible the instant the player stops driving.
    if (this.isShip() || this.isBoat() || this.isAirship()) {
      this.refresh();
      // The vehicle just left is the one on show where it now stands.
      restackCurrentMap(this);
    }

    // Set appropriate on-foot speed based on map
    if ($gameMap.mapId() === 315) {
      $gamePlayer.setMoveSpeed(VehicleConfig.SPEED.map315OnFootSpeed);
    } else {
      $gamePlayer.setMoveSpeed(VehicleConfig.SPEED.onFootBase);
    }

    $gamePlayer.followers().show();
    $gamePlayer.refresh();

    return result;
  };

  // ============================================================================
  // Player Movement Extensions
  // ============================================================================

  // Check for autorun enabled based on map
  Game_Player.prototype.isAutorunEnabled = function () {
    return $gameMap.mapId() !== 315;
  };

  // Block walking over a parked airship (default only checks boat/ship)
  const _Game_CharacterBase_isCollidedWithVehicles =
    Game_CharacterBase.prototype.isCollidedWithVehicles;
  Game_CharacterBase.prototype.isCollidedWithVehicles = function (x, y) {
    if (_Game_CharacterBase_isCollidedWithVehicles.call(this, x, y)) return true;
    const airship = $gameMap.airship();
    return !!airship && airship.posNt(x, y);
  };

  // ============================================================================
  // Sprite-sized collision
  // ============================================================================
  //
  // A parked camper is drawn six tiles long but stands on one tile, so the player
  // and every event walk straight through its body. window.VehicleFootprint reads
  // the opaque pixels of a character's current frame and turns them into the tiles
  // that frame really covers, so a big vehicle blocks what it looks like it blocks.
  //
  // Deliberately narrow: only the PLAYER and EVENTS are held to a footprint. Map
  // passability, vehicles under way and everything else keep the engine's one-tile
  // logic, and a character already standing inside a footprint is never held by it
  // (otherwise stepping off a camper would box the player in under its own body).
  //
  // RoadCarAI.js feeds its cars in through addSource(); anything else with an
  // oversized sprite can do the same.

  // Share of a tile the sprite must cover before that tile counts as solid, so a
  // few pixels of overhang do not steal a whole tile from the player.
  const FOOTPRINT_MIN_COVERAGE = 0.4;
  const FOOTPRINT_ALPHA = 8; // pixels below this alpha are not part of the sprite

  const footprintSheets = new Map(); // sheet name -> measured pixel boxes
  const footprintRects = new Map();  // sheet|index|direction|tiles -> tile offsets
  const footprintSources = [];       // extra suppliers of oversized characters

  /**
   * Measures the opaque bounding box of every frame in a character sheet. One
   * pass over the image, cached forever after (the result only depends on the
   * pixels). Returns null when the sheet cannot be read, which pins that sheet
   * to the engine's one-tile collision.
   */
  function measureCharacterSheet(name, bitmap) {
    const big = ImageManager.isBigCharacter(name);
    const cols = big ? 3 : 12;
    const rows = big ? 4 : 8;
    const w = bitmap.width;
    const h = bitmap.height;
    const fw = Math.floor(w / cols);
    const fh = Math.floor(h / rows);
    if (fw < 1 || fh < 1) return null;

    let pixels;
    try {
      const source = bitmap.image || bitmap.canvas;
      if (!source) return null;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');
      context.drawImage(source, 0, 0);
      pixels = context.getImageData(0, 0, w, h).data;
    } catch (e) {
      return null;
    }

    const cells = new Array(cols * rows).fill(null);
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / fh);
      if (row >= rows) break;
      for (let x = 0; x < w; x++) {
        if (pixels[(y * w + x) * 4 + 3] <= FOOTPRINT_ALPHA) continue;
        const col = Math.floor(x / fw);
        if (col >= cols) continue;
        const i = row * cols + col;
        const lx = x - col * fw;
        const ly = y - row * fh;
        const cell = cells[i];
        if (!cell) {
          cells[i] = { left: lx, right: lx, top: ly, bottom: ly };
        } else {
          if (lx < cell.left) cell.left = lx;
          if (lx > cell.right) cell.right = lx;
          if (ly < cell.top) cell.top = ly;
          if (ly > cell.bottom) cell.bottom = ly;
        }
      }
    }
    return { fw, fh, cols, cells };
  }

  /**
   * The pixel box one character index faces one way, taken as the union of its
   * three walking patterns so an animated frame never pokes out of its own
   * footprint. Null while the sheet is still loading.
   */
  function footprintPixelBox(name, index, direction) {
    if (!footprintSheets.has(name)) {
      const bitmap = ImageManager.loadCharacter(name);
      if (!bitmap || !bitmap.isReady() || !bitmap.width) return null;
      footprintSheets.set(name, measureCharacterSheet(name, bitmap));
    }
    const sheet = footprintSheets.get(name);
    if (!sheet) return null;

    const big = ImageManager.isBigCharacter(name);
    const blockX = big ? 0 : (index % 4) * 3;
    const blockY = big ? 0 : Math.floor(index / 4) * 4;
    const row = blockY + (direction - 2) / 2;
    let box = null;
    for (let pattern = 0; pattern < 3; pattern++) {
      const cell = sheet.cells[row * sheet.cols + blockX + pattern];
      if (!cell) continue;
      if (!box) {
        box = { left: cell.left, right: cell.right, top: cell.top, bottom: cell.bottom };
      } else {
        box.left = Math.min(box.left, cell.left);
        box.right = Math.max(box.right, cell.right);
        box.top = Math.min(box.top, cell.top);
        box.bottom = Math.max(box.bottom, cell.bottom);
      }
    }
    return box ? { box, fw: sheet.fw, fh: sheet.fh } : null;
  }

  /**
   * Tile offsets a pixel span [low, high) reaches, relative to the tile the
   * character stands on. The character's own tile is always part of it.
   */
  function coveredTileRange(low, high, size) {
    const need = size * FOOTPRINT_MIN_COVERAGE;
    let first = 0;
    let last = 0;
    for (let t = Math.floor(low / size); t <= Math.floor((high - 1) / size); t++) {
      const overlap = Math.min(high, (t + 1) * size) - Math.max(low, t * size);
      if (overlap < need) continue;
      if (t < first) first = t;
      if (t > last) last = t;
    }
    return { first, last };
  }

  /**
   * Tile offsets the character's current frame covers, or null when the sprite
   * is not measurable yet. The sprite is drawn anchored bottom-centre on its
   * tile, so the frame is placed the same way here.
   */
  function footprintRect(character) {
    const name = character.characterName ? character.characterName() : '';
    if (!name) return null;
    const index = character.characterIndex ? character.characterIndex() : 0;
    const direction = character.direction();
    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();
    const shiftY = character.shiftY ? character.shiftY() : 0;
    const key = `${name}|${index}|${direction}|${tw}x${th}|${shiftY}`;
    if (footprintRects.has(key)) return footprintRects.get(key);

    const measured = footprintPixelBox(name, index, direction);
    if (!measured) return null; // still loading: retry on the next check
    const { box, fw, fh } = measured;
    const left = tw / 2 - fw / 2 + box.left;
    const right = tw / 2 - fw / 2 + box.right + 1;
    const bottomEdge = th - shiftY;
    const top = bottomEdge - (fh - box.top);
    const bottom = bottomEdge - (fh - box.bottom - 1);

    const horizontal = coveredTileRange(left, right, tw);
    const vertical = coveredTileRange(top, bottom, th);
    const rect = {
      minDx: horizontal.first,
      maxDx: horizontal.last,
      minDy: vertical.first,
      maxDy: vertical.last
    };
    footprintRects.set(key, rect);
    return rect;
  }

  /** True when the character's sprite covers tile (x, y) on the current map. */
  function footprintCovers(character, x, y) {
    if (!character) return false;
    const dx = $gameMap.deltaX(x, character.x);
    const dy = $gameMap.deltaY(y, character.y);
    const rect = footprintRect(character);
    if (!rect) return dx === 0 && dy === 0;
    return dx >= rect.minDx && dx <= rect.maxDx && dy >= rect.minDy && dy <= rect.maxDy;
  }

  /**
   * Every character on this map whose whole sprite is solid right now: the parked
   * custom vehicles, plus whatever the registered sources add. A vehicle under
   * way is not in the list, so driving keeps the engine's one-tile collision.
   */
  function solidFootprintCharacters() {
    const list = [];
    const mapId = $gameMap.mapId();
    [$gameMap.boat(), $gameMap.ship(), $gameMap.airship()].forEach((vehicle) => {
      if (!vehicle || vehicle._mapId !== mapId) return;
      if (vehicle._driving || $gamePlayer.vehicle() === vehicle) return;
      if (vehicle._vsStacked) return;  // parked under another vehicle: not drawn
      if (!vehicle.characterName()) return;
      list.push(vehicle);
    });
    footprintSources.forEach((source) => {
      try {
        source(list);
      } catch (e) {
        /* a broken source must never block movement */
      }
    });
    return list;
  }

  window.VehicleFootprint = {
    /** Registers a supplier that pushes its oversized solid characters onto a list. */
    addSource(source) {
      if (typeof source === 'function' && !footprintSources.includes(source)) {
        footprintSources.push(source);
      }
    },
    covers: footprintCovers,
    rect: footprintRect,
    /** True when an oversized sprite stands between `mover` and tile (x, y). */
    blocks(mover, x, y) {
      if (!$gameMap || !$gamePlayer || !mover) return false;
      if (mover !== $gamePlayer && !(mover instanceof Game_Event)) return false;
      for (const character of solidFootprintCharacters()) {
        if (character === mover) continue;
        if (!footprintCovers(character, x, y)) continue;
        // Whoever is already under the sprite walks out of it freely.
        if (footprintCovers(character, mover.x, mover.y)) continue;
        return true;
      }
      return false;
    }
  };

  const _Game_CharacterBase_isCollidedWithCharacters =
    Game_CharacterBase.prototype.isCollidedWithCharacters;
  Game_CharacterBase.prototype.isCollidedWithCharacters = function (x, y) {
    if (_Game_CharacterBase_isCollidedWithCharacters.call(this, x, y)) return true;
    return window.VehicleFootprint.blocks(this, x, y);
  };

  // Override dash button check
  const _Game_Player_isDashButtonPressed = Game_Player.prototype.isDashButtonPressed;
  Game_Player.prototype.isDashButtonPressed = function () {
    // If in vehicle on map 315, always dash
    if (isPlayerRidingCustomVehicle() && $gameMap.mapId() === 315) {
      return true;
    }

    // On foot: no dash on map 315, otherwise check shift
    if ($gameMap.mapId() === 315) {
      return false;
    }
    return Input.isPressed('shift');
  };

  // Override real move speed
  const _Game_Player_realMoveSpeed = Game_Player.prototype.realMoveSpeed;
  Game_Player.prototype.realMoveSpeed = function () {
    // In vehicle: handle speed
    if (isPlayerRidingCustomVehicle()) {
      if ($gameMap.mapId() === 315) {
        // The Aero Streamlining upgrade grants a small world-map move-speed boost.
        let bonus = 0;
        const cfg = vehicleManager.getConfig($gamePlayer.vehicle());
        const type = upgradeTypeForConfig(cfg);
        if (type && window.VehicleUpgrades) bonus = window.VehicleUpgrades.mapSpeedBonus(type);
        return Math.min(
          VehicleConfig.SPEED.map315VehicleSpeed + bonus,
          MAX_MOVE_SPEED
        );
      } else {
        // Off the world map, holding Shift accelerates the vehicle just like it
        // does on foot. (On map 315 vehicles already dash permanently.)
        const boost = this.isDashButtonPressed()
          ? VehicleConfig.SPEED.speedBoostMultiplier
          : 1;
        return Math.min(this._moveSpeed * boost, MAX_MOVE_SPEED);
      }
    }

    // On foot on map 315: force speed
    if (!this.isInVehicle() && $gameMap.mapId() === 315) {
      return VehicleConfig.SPEED.map315OnFootSpeed;
    }

    // On foot on other maps: chain call and apply shift boost
    let speed = _Game_Player_realMoveSpeed.call(this);

    if (!this.isInVehicle()) {
      // Apply shift speed boost
      if (this.isDashButtonPressed()) {
        speed *= VehicleConfig.SPEED.speedBoostMultiplier;
      }
    }

    return speed;
  };

  // Override isDashing
  const _Game_Player_isDashing = Game_Player.prototype.isDashing;
  Game_Player.prototype.isDashing = function () {
    if ($gameMap.mapId() === 315) {
      // On map 315: vehicles dash, player doesn't
      if (isPlayerRidingCustomVehicle()) {
        return true;
      }
      return false;
    }

    if (this.isMoving() && !this.isInVehicle()) {
      // Always dashing when autorun enabled (non-315 maps)
      if (this.isAutorunEnabled()) {
        return true;
      }
    }
    return _Game_Player_isDashing.call(this);
  };

  // Override updateDashing
  const _Game_Player_updateDashing = Game_Player.prototype.updateDashing;
  Game_Player.prototype.updateDashing = function () {
    if (isPlayerRidingCustomVehicle() && $gameMap.mapId() === 315) {
      this._dashing = true;
      return;
    }

    if ($gameMap.mapId() === 315 && !this.isInVehicle()) {
      this._dashing = false;
      return;
    }

    _Game_Player_updateDashing.call(this);
  };

  // NOTE: out-of-fuel movement is blocked by Game_Vehicle.isMapPassable (which
  // returns false for every tile when the tank is empty). We deliberately do NOT
  // block it via Game_Player.canMove, because canMove also gates triggerButtonAction
  // (the OK/action button) — blocking it there would make the vehicle/travel menu
  // impossible to open while stranded, leaving the player permanently stuck.

  /**
   * Returns the custom vehicle the player is currently facing (or standing under,
   * for the airship), or null if none is boardable from the current tile.
   */
  /**
   * True when the vehicle stands on tile (x, y) OR its sprite covers it: a
   * parked camper is boarded by walking up to its body, not to the one tile it
   * happens to be pinned to (which its own footprint now blocks off anyway).
   */
  function vehicleReachableAt(vehicle, x, y) {
    if (!vehicle || vehicle._mapId !== $gameMap.mapId()) return false;
    if (vehicle.pos(x, y)) return true;
    return !vehicle._driving && window.VehicleFootprint.covers(vehicle, x, y);
  }

  function detectBoardableVehicle() {
    const d = $gamePlayer.direction();
    const x1 = $gamePlayer.x;
    const y1 = $gamePlayer.y;
    const x2 = $gameMap.roundXWithDirection(x1, d);
    const y2 = $gameMap.roundYWithDirection(y1, d);

    // Game_Vehicle.pos() already returns false when the vehicle is on another map.
    const airship = $gameMap.airship();
    if (airship && (vehicleReachableAt(airship, x1, y1) || vehicleReachableAt(airship, x2, y2))) {
      return airship;
    }
    const ship = $gameMap.ship();
    if (ship && vehicleReachableAt(ship, x2, y2)) {
      return ship;
    }
    const boat = $gameMap.boat();
    if (boat && vehicleReachableAt(boat, x2, y2)) {
      return boat;
    }
    return null;
  }

  /**
   * The Game_Vehicle a vehicle key is currently embodied by, or null when the
   * engine slot is standing for another vehicle (the Car, the Bike and the Boat
   * share one slot, so at most one of the three is materialized at a time).
   */
  function materializedVehicleFor(key) {
    const config = configForVehicleKey(key);
    if (!config) return null;
    const vehicle = vehicleManager.getVehicle(config.type);
    if (!vehicle) return null;
    if (config.type === 'boat' && vehicleManager.boatKey() !== key) return null;
    return vehicle;
  }

  /**
   * Brings a parked vehicle out of the store and onto its tile, swapping the
   * shared 'boat' slot over to it when it is the Car / Bike / Boat, and putting
   * it on top of whatever else is parked on that tile. Returns the Game_Vehicle,
   * or null when the vehicle is not parked on this map (or the slot is in use).
   */
  function materializeVehicle(key) {
    const tile = parkedTileOnCurrentMap(key);
    if (!tile) return null;
    vehicleManager.setBoatKey(key);
    const vehicle = materializedVehicleFor(key);
    if (!vehicle) return null;
    if ($gamePlayer.isInVehicle() && $gamePlayer.vehicle() === vehicle) return vehicle;
    moveVehicleInternally(vehicle, $gameMap.mapId(), tile.x, tile.y);
    restackCurrentMap(vehicle);
    return vehicle;
  }

  /**
   * Every vehicle key the player can interact with from where they stand, the
   * most recently parked first. Vehicles are read from the position store rather
   * than off the map, so one parked underneath another (or waiting for the shared
   * 'boat' slot) is offered just the same.
   */
  function reachableVehicleKeys() {
    const d = $gamePlayer.direction();
    const x1 = $gamePlayer.x;
    const y1 = $gamePlayer.y;
    const x2 = $gameMap.roundXWithDirection(x1, d);
    const y2 = $gameMap.roundYWithDirection(y1, d);

    return VEHICLE_KEYS.filter(key => {
      const tile = parkedTileOnCurrentMap(key);
      if (!tile) return false;
      // The airship is boarded from underneath as well as from in front.
      const isAirship = key === 'airship';
      if (tile.x === x2 && tile.y === y2) return true;
      if (isAirship && tile.x === x1 && tile.y === y1) return true;
      // An oversized parked sprite is boarded by walking up to its bodywork.
      const vehicle = materializedVehicleFor(key);
      if (!vehicle || vehicle._driving || vehicle._mapId !== $gameMap.mapId()) return false;
      return window.VehicleFootprint.covers(vehicle, x2, y2) ||
        (isAirship && window.VehicleFootprint.covers(vehicle, x1, y1));
    }).sort((a, b) => VehiclePosition.order(b) - VehiclePosition.order(a));
  }

  // ============================================================================
  // World-map events sitting under a vehicle
  // ============================================================================
  //
  // On the world map (315) a vehicle is parked by tile coordinate, so it can end
  // up on top of an interactable event (the "Teleport - <place>" city markers,
  // the Omega Tower doors, ...). The action button boards / opens the vehicle
  // before any event check runs, which would leave that event unreachable, so
  // the vehicle menu lists the overlapped events as extra choices instead.

  // Only action-button pages carrying real commands count: the invisible
  // CountryName labels blanketing map 315 have an empty page and are not
  // interactable, so they must never show up as a choice.
  function isInteractableMapEvent(event) {
    if (!event || !event.event()) return false;
    const page = event.page();
    if (!page || page.trigger !== 0) return false;
    const list = event.list();
    return !!(list && list.length > 1);
  }

  /**
   * Events the action button could otherwise have reached on the world map: the
   * tile the player stands on, plus the tile they face (where a parked vehicle
   * sits when it is boarded from outside).
   */
  function overlappedWorldMapEvents() {
    if (!$gameMap || $gameMap.mapId() !== 315) return [];
    const d = $gamePlayer.direction();
    const tiles = [
      { x: $gamePlayer.x, y: $gamePlayer.y },
      {
        x: $gameMap.roundXWithDirection($gamePlayer.x, d),
        y: $gameMap.roundYWithDirection($gamePlayer.y, d)
      }
    ];
    const found = [];
    tiles.forEach(tile => {
      $gameMap.eventsXy(tile.x, tile.y).forEach(event => {
        if (found.includes(event)) return;
        if (isInteractableMapEvent(event)) found.push(event);
      });
    });
    return found;
  }

  /**
   * Menu label for an overlapped world-map event. Destinations are named
   * "Teleport - <place>" on map 315 and read better as a travel line.
   */
  function worldMapEventLabel(event) {
    const name = (event.event().name || '').trim();
    const teleport = name.match(/^Teleport\s*-\s*(.+)$/i);
    if (teleport) {
      // The event name carries the Destinations.json key; the player reads the
      // "name" field of that entry.
      const key = teleport[1].trim();
      const place = window.WorkSystem?.destinationName
        ? window.WorkSystem.destinationName(key) : key;
      return T('VehicleSystem.travelTo', { place });
    }
    return name || T('VehicleSystem.examine');
  }

  /**
   * Boards the given custom vehicle ("Start driving"). Ships/boats reuse the
   * engine boarding flow; the airship is solid now, so the player is moved onto
   * its tile before mounting.
   */
  function startDrivingVehicle(vehicle) {
    if (vehicle.isAirship()) {
      const airship = $gameMap.airship();
      if (!airship) return;
      if (!airship.pos($gamePlayer.x, $gamePlayer.y)) {
        $gamePlayer.setThrough(true);
        $gamePlayer.setPosition(airship.x, airship.y);
        $gamePlayer.setThrough(false);
      }
      $gamePlayer._vehicleType = 'airship';
      $gamePlayer._vehicleGettingOn = true;
      $gamePlayer.gatherFollowers();
    } else {
      _Game_Player_getOnVehicle.call($gamePlayer);
      // The engine only boards from the tile the vehicle is pinned to. A player
      // who walked up to the bodywork instead is standing on the sprite but not
      // on that tile, so step them onto it and board by hand.
      if (!$gamePlayer.isInVehicle()) {
        $gamePlayer.setThrough(true);
        $gamePlayer.setPosition(vehicle.x, vehicle.y);
        $gamePlayer.setThrough(false);
        $gamePlayer._vehicleType = vehicle.isShip() ? 'ship' : 'boat';
        $gamePlayer._vehicleGettingOn = true;
        $gamePlayer.gatherFollowers();
      }
    }
  }

  // Item id the bike is stowed back into / deployed from (CharacterCreation ITEM_BIKE).
  const BIKE_ITEM_ID = 131;

  /**
   * Picks up a parked bike: removes it from the map and returns item 131 to the
   * inventory. The bike is the shared 'boat' vehicle, so we move it off-map
   * (mapId 0) which makes Game_Vehicle.pos() stop matching the current map and
   * the sprite turn transparent, effectively despawning it.
   */
  function pickUpBike(vehicle) {
    if (!vehicle) return;

    // If the player is somehow still mounted, dismount first.
    if ($gamePlayer.isInVehicle() && $gamePlayer.vehicle() === vehicle) {
      disembarkLeavingParked(vehicle);
    }

    vehicle.setLocation(0, vehicle.x, vehicle.y);
    VehiclePosition.set('bike', 0, vehicle.x, vehicle.y);

    if ($dataItems[BIKE_ITEM_ID]) {
      $gameParty.gainItem($dataItems[BIKE_ITEM_ID], 1);
    }

    AudioManager.playSe({ name: 'Equip1', pan: 0, pitch: 100, volume: 90 });
    showLocalizedMessage(T('VehicleSystem.pickedUpBike'));
  }

  /**
   * Forcibly removes the player from the vehicle while leaving the vehicle parked
   * where it is. Unlike Game_Player.getOffVehicle(), this does not require a
   * land-ok tile in front (which fails on water for ships), so the player can
   * safely enter the vehicle interior without dragging the vehicle along.
   */
  function disembarkLeavingParked(vehicle) {
    if (!vehicle) return;
    vehicle.getOff(); // _driving = false; custom hook saves pos + fixes speed/followers
    $gamePlayer._vehicleType = '';
    $gamePlayer._vehicleGettingOn = false;
    $gamePlayer._vehicleGettingOff = false;
    $gamePlayer.setThrough(false);
    $gamePlayer.setTransparent(false);
    $gamePlayer.refresh();
  }

  /**
   * Resolves the FastTravelSystem travel-type string for a given vehicle config,
   * or null if the vehicle has no fast-travel network (e.g. the Starship).
   */
  function getFastTravelType(config) {
    if (!config) return null;
    if (config.name === 'Camper') return 'camper';  // i18n-ignore  vehicle id
    if (config.name === 'Car') return 'carsharing';  // i18n-ignore  vehicle id
    if (config.name === 'Bike') return 'bicycle';  // i18n-ignore  vehicle id
    return null;
  }

  /**
   * Returns the vehicle config whose interior map matches the given map id, or
   * null if the map is not a known vehicle interior. (The bike has no interior.)
   */
  function getConfigByInteriorMapId(mapId) {
    const configs = [VehicleConfig.CAMPER, VehicleConfig.CAR, VehicleConfig.AIRSHIP];
    return configs.find(c => c.interior && c.interior.mapId > 0 && c.interior.mapId === mapId) || null;
  }

  /**
   * Launches the 3D camper road-driving scene ("liminal drive") from
   * CamperDrivingSystem.js and initializes it with the player actively driving
   * the camper (car view mode) rather than the default first-person interior view.
   * Camper-only; safely no-ops if CamperDrivingSystem is not loaded.
   */
  function engageLiminalDrive() {
    if (!window.CamperDrivingSystem || typeof window.CamperDrivingSystem.start !== 'function') {
      showLocalizedMessage(T('VehicleSystem.liminalUnavailable'));
      return;
    }
    window.CamperDrivingSystem.start(60, T('VehicleSystem.liminalDrive'), 100);
    const scene = window.CamperDrivingSystem._scene;
    if (scene && typeof scene._setMode === 'function') {
      scene._setMode('car');
    }
  }

  /**
   * True only for the Camper config when the CamperDrivingSystem is available.
   * Gates the "Engage liminal drive" menu option.
   */
  function canEngageLiminalDrive(config) {
    return !!(config && config.name === 'Camper' && window.CamperDrivingSystem);  // i18n-ignore  vehicle id
  }

  /**
   * Context-aware vehicle menu.
   *   isRiding === true  -> opened while driving (cancel key): first option "Stop driving".
   *   isRiding === false -> opened by interacting from outside: first option "Start driving".
   * No "What would you like to do?" prompt is shown; live fuel is on the HUD instead.
   */
  Game_Player.prototype.showVehicleActionMenu = function (vehicle, isRiding) {
    const config = vehicleManager.getConfig(vehicle);
    if (!config || $gameMessage.isBusy()) return;

    const choices = [];
    const handlers = [];

    if (isRiding) {
      choices.push(T('VehicleSystem.stopDriving'));
      handlers.push(() => {
        if (!$gamePlayer.isInVehicle()) return;
        // Try the normal dismount (steps the player onto adjacent land and parks
        // the vehicle behind them). If no land tile is free (over water / air),
        // dismount in place so the player is never left stranded aboard.
        $gamePlayer.getOffVehicle();
        if ($gamePlayer.isInVehicle()) {
          disembarkLeavingParked(vehicle);
        }
        // Persist the parked spot to the internal position store.
        vehicleManager.savePosition(vehicle);
      });
    } else {
      choices.push(T('VehicleSystem.startDriving'));
      handlers.push(() => startDrivingVehicle(vehicle));
    }

    if (config.interior && config.interior.mapId > 0) {
      choices.push(T('VehicleSystem.enterVehicle', { vehicle: vehicleNounName(config) }));
      handlers.push(() => {
        // Leave the vehicle parked on the current map; only the player enters.
        if ($gamePlayer.isInVehicle()) {
          disembarkLeavingParked(vehicle);
        }
        // Remember where the player entered from. The Exit / EndTravel command
        // puts them back there; without it the spot can be 0 (->0,0) or a stale
        // previous location.
        if (!mapCache.isInterior($gameMap.mapId()) && $gameMap.mapId() !== proceduralMapId()) {
          VehiclePosition.setEntry(VehiclePosition.keyForConfig(config), $gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
        }
        const direction = config.interior.direction || 2;
        $gamePlayer.reserveTransfer(
          config.interior.mapId,
          config.interior.x,
          config.interior.y,
          direction, 0
        );
        AudioManager.playSe({ name: "Door1", pan: 0, pitch: 100, volume: 90 });
      });
    }

    const fastTravelType = getFastTravelType(config);
    if (fastTravelType) {
      choices.push(T('VehicleSystem.fastTravel'));
      handlers.push(() => {
        // If the vehicle has an interior and the player isn't already inside it,
        // move them into the vehicle (region 13 spawn tile) and start the fast
        // travel there. Otherwise just open the travel UI in place.
        const interiorMapId = (config.interior && config.interior.mapId > 0) ? config.interior.mapId : 0;
        const insideVehicle = interiorMapId && $gameMap.mapId() === interiorMapId;

        if (interiorMapId && !insideVehicle) {
          if ($gamePlayer.isInVehicle()) {
            vehicleManager.savePosition(vehicle);
            $gamePlayer.getOffVehicle();
          }
          $gameTemp._pendingFastTravelType = fastTravelType;
          const delay = isRiding ? 1000 : 0;
          setTimeout(() => {
            const pos = findRegionTile(interiorMapId, 13);
            const tx = pos ? pos.x : config.interior.x;
            const ty = pos ? pos.y : config.interior.y;
            const direction = config.interior.direction || 2;
            $gamePlayer.reserveTransfer(interiorMapId, tx, ty, direction, 0);
            AudioManager.playSe({ name: "Door1", pan: 0, pitch: 100, volume: 90 });
          }, delay);
        } else {
          setTimeout(() => {
            if (SceneManager._scene && SceneManager._scene.startFastTravel) {
              SceneManager._scene.startFastTravel(fastTravelType);
            }
          }, 100);
        }
      });
    }

    // The Starship and the (fuel-free) bike are never refuelable at a gas pump.
    if (config.canRefuelAtPump && config.refuelEvent) {
      choices.push(T('VehicleSystem.refuel'));
      handlers.push(() => openVehicleRefuel());
    }
    if (config.storageEvent) {
      choices.push(T('VehicleSystem.storage'));
      handlers.push(() => $gameTemp.reserveCommonEvent(config.storageEvent));
    }
    if (config.repairEvent) {
      choices.push(T('VehicleSystem.repairs'));
      handlers.push(() => openVehicleMaintenance(config));
    }

    // Starship only: its hull is procedurally generated, so its look can be
    // re-rolled from the appearance editor.
    if (config.name === 'Starship' && window.GalaxySim && window.GalaxySim.openShipAppearance) {  // i18n-ignore  vehicle id
      choices.push(T('VehicleSystem.changeAppearance'));
      handlers.push(() => window.GalaxySim.openShipAppearance());
    }

    // Camper only: launch the 3D road scene with the player driving the camper.
    if (canEngageLiminalDrive(config)) {
      choices.push(T('VehicleSystem.engageLiminal'));
      handlers.push(() => engageLiminalDrive());
    }

    // Bike only: stow the parked bike back into the inventory as an item.
    if (!isRiding && config.name === 'Bike') {  // i18n-ignore  vehicle id
      choices.push(T('VehicleSystem.pickUp'));
      handlers.push(() => pickUpBike(vehicle));
    }

    // Starship only: pressing OK while riding opens the galaxy travel menu
    // (the 3D star map), where destinations are picked (#134).
    if (config.name === 'Starship' && window.GalaxySim &&  // i18n-ignore  vehicle id
        typeof window.GalaxySim.openStarMap === 'function') {
      choices.push(T('VehicleSystem.starMap'));
      handlers.push(() => {
        setTimeout(() => window.GalaxySim.openStarMap(), 100);
      });
    }

    // Every motorized vehicle has a radio (the human-powered bike and the
    // paddle/wind-powered boat, both fuel-free, do not).
    if (config.usesFuel && window.TunableRadio) {
      choices.push(T('VehicleSystem.radio'));
      handlers.push(() => window.TunableRadio.open());
    }

    // World map only: events the vehicle is parked on (or that the player is
    // standing on while the vehicle is in front of them) are unreachable with
    // the action button, because opening this menu already consumed the press.
    // Offer them here so the player picks the event or the vehicle.
    overlappedWorldMapEvents().forEach(event => {
      choices.push(worldMapEventLabel(event));
      handlers.push(() => event.start());
    });

    if (isRiding && window.WorldMapReturn) {
      const currentMapId = $gameMap.mapId();
      if (!vehicle.isAirship() && currentMapId === window.WorldMapReturn.worldMapId) {
        choices.push(T('VehicleSystem.visitMap'));
        handlers.push(() => window.WorldMapReturn.performVisitMap());
      } else if (currentMapId === window.WorldMapReturn.procMapId) {
        choices.push(T('VehicleSystem.returnToWorldMap'));
        handlers.push(() => window.WorldMapReturn.returnToWorldMap());
      } else {
        choices.push(T('VehicleSystem.continueDriving'));
        handlers.push(() => { });
      }
    } else {
      choices.push(isRiding ? T('VehicleSystem.continueDriving') : T('VehicleSystem.leave'));
      handlers.push(() => { });
    }

    const cancelIndex = choices.length - 1;
    $gameMessage.setChoices(choices, 0, cancelIndex);
    $gameMessage.setChoiceCallback((choice) => {
      const handler = handlers[choice];
      if (handler) handler();
    });
  };

  /**
   * Travel/utility menu shown while the player is INSIDE a vehicle's interior map.
   * The offered options depend on which interior the player is standing in (a
   * vehicle without a fast-travel network or storage/repair events simply omits
   * those rows). "Refuel" and "Enter <vehicle>" are intentionally never offered
   * here: the player is already inside, and a roadside pump is out of reach.
   */
  Game_Player.prototype.showVehicleInteriorMenu = function (config) {
    if (!config || $gameMessage.isBusy()) return;

    const choices = [];
    const handlers = [];

    const fastTravelType = getFastTravelType(config);
    if (fastTravelType) {
      choices.push(T('VehicleSystem.fastTravel'));
      handlers.push(() => {
        setTimeout(() => {
          if (SceneManager._scene && SceneManager._scene.startFastTravel) {
            SceneManager._scene.startFastTravel(fastTravelType);
          }
        }, 100);
      });
    }

    if (config.storageEvent) {
      choices.push(T('VehicleSystem.storage'));
      handlers.push(() => $gameTemp.reserveCommonEvent(config.storageEvent));
    }

    if (config.repairEvent) {
      choices.push(T('VehicleSystem.repairs'));
      handlers.push(() => openVehicleMaintenance(config));
    }

    // Starship only: its hull is procedurally generated, so its look can be
    // re-rolled from the appearance editor.
    if (config.name === 'Starship' && window.GalaxySim && window.GalaxySim.openShipAppearance) {  // i18n-ignore  vehicle id
      choices.push(T('VehicleSystem.changeAppearance'));
      handlers.push(() => window.GalaxySim.openShipAppearance());
    }

    // Camper only: launch the 3D road scene with the player driving the camper.
    if (canEngageLiminalDrive(config)) {
      choices.push(T('VehicleSystem.engageLiminal'));
      handlers.push(() => engageLiminalDrive());
    }

    // Every motorized vehicle has a radio (the human-powered bike does not).
    if (config.name !== 'Bike' && window.TunableRadio) {  // i18n-ignore  vehicle id
      choices.push(T('VehicleSystem.radio'));
      handlers.push(() => window.TunableRadio.open());
    }

    choices.push(T('VehicleSystem.cancel'));
    handlers.push(() => { });

    const cancelIndex = choices.length - 1;
    $gameMessage.setChoices(choices, 0, cancelIndex);
    $gameMessage.setChoiceCallback((choice) => {
      const handler = handlers[choice];
      if (handler) handler();
    });
  };

  // A vehicle whose action menu opens as soon as the current message closes: a
  // choice list cannot be replaced from inside its own callback (the message is
  // cleared right after it returns), so the follow-up menu waits one frame.
  let pendingVehicleMenu = null;

  /**
   * Asks which vehicle the player means when more than one is parked on the tile
   * they are interacting with. Picking one brings it to the top of the stack and
   * opens its usual action menu.
   */
  Game_Player.prototype.showVehicleChoiceMenu = function (keys) {
    if ($gameMessage.isBusy()) return;

    const choices = [];
    const handlers = [];

    keys.forEach(key => {
      const config = configForVehicleKey(key);
      if (!config) return;
      choices.push(vehicleDisplayName(config));
      handlers.push(() => {
        const vehicle = materializeVehicle(key);
        // The choice list is still closing, so the action menu is opened on the
        // first frame the message system is free again (see Scene_Map.update).
        if (vehicle) pendingVehicleMenu = vehicle;
      });
    });

    choices.push(T('VehicleSystem.leave'));
    handlers.push(() => { });

    const cancelIndex = choices.length - 1;
    $gameMessage.setChoices(choices, 0, cancelIndex);
    $gameMessage.setChoiceCallback((choice) => {
      const handler = handlers[choice];
      if (handler) handler();
    });
  };

  /**
   * Opens the menu of the parked vehicle the player is interacting with, asking
   * which one first when several share the tile. Returns true when it consumed
   * the action button.
   */
  Game_Player.prototype.openParkedVehicleMenu = function () {
    const keys = reachableVehicleKeys();
    if (keys.length > 1) {
      this.showVehicleChoiceMenu(keys);
      return true;
    }
    if (keys.length === 1) {
      const parked = materializeVehicle(keys[0]);
      if (parked) {
        this.showVehicleActionMenu(parked, false);
        return true;
      }
    }
    const vehicle = detectBoardableVehicle();
    if (vehicle && isCustomVehicle(vehicle)) {
      this.showVehicleActionMenu(vehicle, false);
      return true;
    }
    return false;
  };

  // Interacting with a parked custom vehicle from outside opens the action menu
  // ("Start driving") instead of boarding immediately.
  const _Game_Player_getOnVehicle = Game_Player.prototype.getOnVehicle;
  Game_Player.prototype.getOnVehicle = function () {
    if (!this.isInVehicle() && this.openParkedVehicleMenu()) {
      return true;
    }
    return _Game_Player_getOnVehicle.call(this);
  };

  // While riding a custom vehicle, the action button (A / ok) opens the vehicle
  // options menu ("Stop driving" is the first choice) instead of dismounting
  // immediately. Returning true consumes the press so no event/movement fires (#58).
  const _Game_Player_getOnOffVehicle = Game_Player.prototype.getOnOffVehicle;
  Game_Player.prototype.getOnOffVehicle = function () {
    if (isPlayerRidingCustomVehicle() && !$gameMessage.isBusy()) {
      this.showVehicleActionMenu(this.vehicle(), true);
      return true;
    }
    return _Game_Player_getOnOffVehicle.call(this);
  };

  // ============================================================================
  // Event Interaction Control
  // ============================================================================

  class EventInteractionControl {
    static isTransferEvent(x, y) {
      const events = $gameMap.eventsXy(x, y);
      return events.some(e => e && e.event() && e.event().name && e.event().name.toLowerCase().startsWith('transfer'));
    }

    static getTransferMapId(x, y) {
      const events = $gameMap.eventsXy(x, y);
      for (const event of events) {
        const name = event.event().name;
        if (name.toLowerCase().startsWith('transfer')) {
          const match = name.match(/\((\d+)/);
          if (match) return parseInt(match[1]);
        }
      }
      return null;
    }

    static checkVehicleInteriorBlock(x, y, vehicle) {
      if ($gameMap.mapId() === 315) return false;
      if (!this.isTransferEvent(x, y)) return false;

      const mapId = this.getTransferMapId(x, y);
      if (mapId && mapCache.isInterior(mapId)) {
        const config = vehicleManager.getConfig(vehicle);
        if (!config) return false;
        showLocalizedMessage(T('VehicleSystem.cannotFit', { vehicle: vehicleNounName(config) }));
        return true;
      }
      return false;
    }
  }

  const _Game_Player_checkEventTriggerHere = Game_Player.prototype.checkEventTriggerHere;
  Game_Player.prototype.checkEventTriggerHere = function (triggers) {
    if (isPlayerRidingCustomVehicle() && $gameMap.mapId() !== 315) {
      if (EventInteractionControl.checkVehicleInteriorBlock(this.x, this.y, $gamePlayer.vehicle())) {
        return false;
      }
      if (!EventInteractionControl.isTransferEvent(this.x, this.y)) {
        return false;
      }
    }
    return _Game_Player_checkEventTriggerHere.call(this, triggers);
  };

  const _Game_Player_checkEventTriggerThere = Game_Player.prototype.checkEventTriggerThere;
  Game_Player.prototype.checkEventTriggerThere = function (triggers) {
    if (isPlayerRidingCustomVehicle() && $gameMap.mapId() !== 315) {
      const d = this.direction();
      const x2 = $gameMap.roundXWithDirection(this.x, d);
      const y2 = $gameMap.roundYWithDirection(this.y, d);

      if (EventInteractionControl.checkVehicleInteriorBlock(x2, y2, $gamePlayer.vehicle())) {
        return false;
      }
      if (!EventInteractionControl.isTransferEvent(x2, y2)) {
        return false;
      }
    }
    return _Game_Player_checkEventTriggerThere.call(this, triggers);
  };

  // ============================================================================
  // Fuel HUD (top-left gauge shown while driving a fuel-using vehicle)
  // ============================================================================

  class Window_VehicleFuelHUD extends Window_Base {
    initialize() {
      super.initialize(new Rectangle(8, 8, 240, 90));
      this.opacity = 200;
      this._cacheKey = '';
      this.visible = false;
    }

    update() {
      super.update();
      const config = isPlayerRidingCustomVehicle()
        ? vehicleManager.getConfig($gamePlayer.vehicle())
        : null;
      const show = !!(config && config.usesFuel) && !$gameMessage.isBusy();
      this.visible = show;
      if (!show) return;

      const fuel = FuelSystem.getFuel($gamePlayer.vehicle());
      const key = `${config.name}:${fuel.toFixed(1)}:${configMaxFuel(config)}`;
      if (key !== this._cacheKey) {
        this._cacheKey = key;
        this._draw(config, fuel);
      }
    }

    _draw(config, fuel) {
      this.contents.clear();
      this.resetFontSettings();

      const w = this.contentsWidth();
      const max = configMaxFuel(config) || 1;
      const rate = Math.max(0, Math.min(1, fuel / max));

      this.drawText(vehicleDisplayName(config), 0, 0, w - 88, 'left');
      this.drawText(`${fuel.toFixed(1)}L`, w - 88, 0, 88, 'right');

      const gy = this.lineHeight() + 6;
      const gh = 12;
      const back = ColorManager.gaugeBackColor();
      const low = rate <= 0.25;
      const c1 = low ? ColorManager.textColor(18) : ColorManager.textColor(28);
      const c2 = low ? ColorManager.textColor(2) : ColorManager.textColor(24);
      this.contents.fillRect(0, gy, w, gh, back);
      this.contents.gradientFillRect(0, gy, Math.floor(w * rate), gh, c1, c2);
    }
  }

  // The fuel gauge is now rendered as an HTML bar in the bottom-right travel
  // HUD (MapInfoHUD in TimeDateSystem.js) via MergedVehicleSystem.getActiveFuelStatus().
  // The old top-left RPG Maker gauge window is intentionally no longer created.
  void Window_VehicleFuelHUD;

  // ============================================================================
  // Scene Map Extensions
  // ============================================================================

  // Remember when the player transfers OUT of a vehicle interior so the vehicle
  // can be re-spawned on the destination map (see _handleExitInteriorSpawn).
  // We skip this when an explicit "return to vehicle" command is already pending
  // (those set a _spawn*AfterTransfer flag handled by _handleAutoRide), so the
  // vehicle is never spawned twice.
  const _Game_Player_performTransfer = Game_Player.prototype.performTransfer;
  Game_Player.prototype.performTransfer = function () {
    if (this.isTransferring()) {
      const fromMapId = $gameMap.mapId();
      const spawnPending = $gameTemp._spawnCamperAfterTransfer ||
        $gameTemp._spawnCarAfterTransfer ||
        $gameTemp._spawnStarshipAfterTransfer;
      if (!spawnPending && fromMapId !== this._newMapId &&
        getConfigByInteriorMapId(fromMapId)) {
        $gameTemp._exitedVehicleInteriorMapId = fromMapId;
      }
    }
    _Game_Player_performTransfer.call(this);
  };

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    _Scene_Map_onMapLoaded.call(this);

    vehicleManager.initialize();

    // Test player / sandbox sessions receive every Vehicles-category item once,
    // so all vehicles are immediately owned and usable.
    grantAllVehicleItemsIfDebug();

    // Re-place parked vehicles from the internal position store so a vehicle is
    // always physically present where it was memorized (never silently vanishes).
    vehicleManager.reconcileToStore();

    // Update vehicle sprites based on map
    ['ship', 'boat', 'airship'].forEach(type => {
      const vehicle = vehicleManager.getVehicle(type);
      if (vehicle) {
        const config = vehicleManager.getConfig(vehicle);
        const sprite = selectVehicleSprite(config);
        if (sprite) {
          vehicle._characterName = sprite.name;
          vehicle._characterIndex = sprite.index;
          vehicle.refresh();
        }
      }
    });

    // Set correct player speed when entering a map
    if (!$gamePlayer.isInVehicle()) {
      if ($gameMap.mapId() === 315) {
        $gamePlayer.setMoveSpeed(VehicleConfig.SPEED.map315OnFootSpeed);
      } else {
        $gamePlayer.setMoveSpeed(VehicleConfig.SPEED.onFootBase);
      }
    }

    // Character-creation "bike" origin: the player is dropped into a freshly
    // generated procedural biome (picked in CharacterCreation.startBikeOrigin).
    // Place them in a passable 4x4 zone and park the bike on the tile beside them
    // (not mounted) so they can choose to ride off.
    if ($gameTemp._ccBikeStart && $gameMap.mapId() === proceduralMapId()) {
      $gameTemp._ccBikeStart = false;
      $gameSystem._boatType = 'bike';
      const boat = vehicleManager.getVehicle('boat');
      const zone = PositionFinder.findPassable4x4(boat);
      if (zone) {
        const px = zone.x + 1;
        const py = zone.y + 1;
        $gamePlayer.locate(px, py);
        $gamePlayer.setDirection(2);
      }
      if (boat) {
        // Park the bike on a passable tile beside the player (not mounted).
        const bikePos = PositionFinder.findNearPlayer(boat);
        if (bikePos) {
          boat.setLocation($gameMap.mapId(), bikePos.x, bikePos.y);
          vehicleManager.savePosition(boat);
          boat.refresh();
        }
      }
    }

    // Handle auto-ride after transfer
    this._handleAutoRide();

    // Spawn the vehicle on the map whenever the player walked out of its
    // interior through a plain Transfer event (no return command used).
    this._handleExitInteriorSpawn();

    if ($gameTemp._pendingFastTravelType) {
      const type = $gameTemp._pendingFastTravelType;
      $gameTemp._pendingFastTravelType = null;
      setTimeout(() => {
        const scene = SceneManager._scene;
        if (scene && scene.startFastTravel) scene.startFastTravel(type);
      }, 300);
    }
  };

  // When the player exits a vehicle interior onto a normal map (via a plain
  // Transfer event rather than a "return to vehicle" command), park the vehicle
  // beside the player so it is always physically present on the map. The sprite
  // is sized to the destination: the small/normal sprite on the world map (315)
  // and the large sprite everywhere else, via selectVehicleSprite().
  Scene_Map.prototype._handleExitInteriorSpawn = function () {
    const fromMapId = $gameTemp._exitedVehicleInteriorMapId;
    $gameTemp._exitedVehicleInteriorMapId = null;
    if (!fromMapId) return;

    // Arrived in another interior (e.g. one vehicle parked inside a building):
    // there is no room to spawn, so leave the vehicle where it was saved.
    if (mapCache.isInterior($gameMap.mapId())) return;

    const config = getConfigByInteriorMapId(fromMapId);
    if (!config) return;

    // The car and bike share the 'boat' slot; coming out of the car interior
    // means the boat is the car, so keep the sub-type consistent.
    if (config.type === 'boat') $gameSystem._boatType = 'car';

    const vehicle = vehicleManager.getVehicle(config.type);
    if (!vehicle) return;

    // Self-heal airship exit: ensure the player and followers are visible again,
    // regardless of how the player boarded. A failed getOffVehicle can leave the
    // player flagged isInAirship() with everything transparent/hidden (#158).
    if (config.type === 'airship') {
      $gamePlayer.setTransparent(false);
      $gamePlayer.followers().show();
      $gamePlayer.refresh();
    }

    const pos = PositionFinder.findNearPlayer(vehicle);
    if (!pos) return;

    vehicle.setLocation($gameMap.mapId(), pos.x, pos.y);
    vehicleManager.savePosition(vehicle);

    const sprite = selectVehicleSprite(config);
    if (sprite) {
      vehicle._characterName = sprite.name;
      vehicle._characterIndex = sprite.index;
    }
    vehicle.refresh();
  };

  Scene_Map.prototype._handleAutoRide = function () {
    if ($gameTemp._autoRideTimer > 0) return;

    const vehicleEntries = [
      { flag: '_spawnCamperAfterTransfer', autoFlag: '_autoRideCamperAfterSpawn', type: 'ship' },
      { flag: '_spawnCarAfterTransfer', autoFlag: '_autoRideCarAfterSpawn', type: 'boat' },
      { flag: '_spawnStarshipAfterTransfer', autoFlag: '_autoRideStarshipAfterSpawn', type: 'airship' }
    ];

    vehicleEntries.forEach(({ flag, autoFlag, type }) => {
      if (!$gameTemp[flag]) return;

      if (!mapCache.isInterior($gameMap.mapId())) {
        const vehicle = vehicleManager.getVehicle(type);
        const config = vehicleManager.getConfig(vehicle);
        const spawnData = $gameTemp[flag];

        if (vehicle && config) {
          const pos = PositionFinder.findValidPosition(spawnData.x, spawnData.y, vehicle);
          if (pos) {
            vehicle.setLocation($gameMap.mapId(), pos.x, pos.y);
            vehicleManager.savePosition(vehicle);

            if ($gameTemp[autoFlag]) {
              $gamePlayer.setPosition(pos.x, pos.y);
              $gameTemp._autoRideTimer = AUTO_RIDE_DELAY_FRAMES;
              $gameTemp._vehicleToRide = vehicle;
              $gameTemp._vehicleType = type;
            }
          }
        }
      }
      // Always clear the flag to prevent leaks
      $gameTemp[flag] = null;
      $gameTemp[autoFlag] = false;
    });
  };

  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);

    // A vehicle chosen from the "which one?" list opens its action menu here,
    // once the choice list it was picked from has finished closing.
    if (pendingVehicleMenu && !$gameMessage.isBusy()) {
      const vehicle = pendingVehicleMenu;
      pendingVehicleMenu = null;
      $gamePlayer.showVehicleActionMenu(vehicle, false);
    }

    // Menu (Y on gamepad) / ESC while riding opens the normal game menu. Using
    // 'menu' instead of 'cancel' moves it off the B button (which is now free
    // for back-out) while still firing on keyboard ESC (#58).
    if (isPlayerRidingCustomVehicle() && !$gameMessage.isBusy() &&
      (Input.isTriggered('menu') || TouchInput.isCancelled())) {
      SceneManager.push(Scene_Menu);
      Input.clear();
    }

    // Handle auto-ride timer
    if ($gameTemp._autoRideTimer > 0) {
      $gameTemp._autoRideTimer--;
      if ($gameTemp._autoRideTimer === 0) {
        this._executeAutoRide();
      }
    }
  };

  Scene_Map.prototype._executeAutoRide = function () {
    const vehicle = $gameTemp._vehicleToRide;
    const type = $gameTemp._vehicleType;

    if (vehicle && vehicle._mapId === $gameMap.mapId()) {
      $gamePlayer.setPosition(vehicle.x, vehicle.y);
      $gamePlayer._vehicleType = type;
      $gamePlayer.getOnVehicle();

      if (!$gamePlayer.isInVehicle()) {
        $gamePlayer._vehicleGettingOn = true;
        vehicle.getOn();
      }

      AudioManager.playSe({ name: 'Decision1', pan: 0, pitch: 100, volume: 90 });
    }

    $gameTemp._vehicleToRide = null;
    $gameTemp._vehicleType = null;
  };

  const _Scene_Map_updateCallMenu = Scene_Map.prototype.updateCallMenu;
  Scene_Map.prototype.updateCallMenu = function () {
    if (isPlayerRidingCustomVehicle()) {
      return;
    }
    _Scene_Map_updateCallMenu.call(this);
  };

  // ============================================================================
  // Plugin Commands
  // ============================================================================

  class PluginCommands {
    static register() {
      this._registerCommand('summonCamper', () => {
        vehicleManager.summon('ship');
      });

      this._registerCommand('summonCar', () => {
        vehicleManager.summon('boat', 'car');
      });

      this._registerCommand('summonBike', () => {
        vehicleManager.summon('boat', 'bike');
      });

      this._registerCommand('summonBoat', () => {
        vehicleManager.summon('boat', 'boat');
      });

      this._registerCommand('summonAirship', () => {
        vehicleManager.summon('airship');
      });

      this._registerCommand('initializeCamperPosition', function () {
        const eventId = this._eventId;
        const event = $gameMap.event(eventId);
        if (event) {
          const vehicle = vehicleManager.getVehicle('ship');
          if (vehicle) {
            vehicle.setLocation($gameMap.mapId(), event.x, event.y);
            vehicleManager.savePosition(vehicle);
          }
        }
      });

      this._registerCommand('teleportToVehicle', (args) => {
        this._teleportToVehicle(args.vehicleType || 'ship');
      });

      this._registerCommand('showTravelOptions', () => {
        const config = getConfigByInteriorMapId($gameMap.mapId());
        if (!config) {
          showLocalizedMessage(T('VehicleSystem.notInsideVehicle'));
          return;
        }
        $gamePlayer.showVehicleInteriorMenu(config);
      });

      this._registerCommand('openVehicleMenu', (args) => {
        this._openVehicleMenu((args && args.vehicleType) || 'auto');
      });

      this._registerCommand('saveCamperAndTravel', () => {
        this._saveAndTravel(VehicleConfig.CAMPER);
      });

      this._registerCommand('saveCarAndTravel', () => {
        this._saveAndTravel(VehicleConfig.CAR);
      });

      this._registerCommand('saveAirshipAndTravel', () => {
        this._saveAndTravel(VehicleConfig.AIRSHIP);
      });

      this._registerCommand('returnToCamper', () => {
        this._returnToVehicle(VehicleConfig.CAMPER, false);
      });

      this._registerCommand('returnToCar', () => {
        this._returnToVehicle(VehicleConfig.CAR, false);
      });

      this._registerCommand('returnToAirship', () => {
        this._returnToVehicle(VehicleConfig.AIRSHIP, false);
      });

      this._registerCommand('returnAndRideCamper', () => {
        this._returnToVehicle(VehicleConfig.CAMPER, true);
      });

      this._registerCommand('returnAndRideCar', () => {
        this._returnToVehicle(VehicleConfig.CAR, true);
      });

      this._registerCommand('returnAndRideAirship', () => {
        this._returnToVehicle(VehicleConfig.AIRSHIP, true);
      });
    }

    static _registerCommand(name, callback) {
      PluginManager.registerCommand(PLUGIN_NAME, name, callback);
    }

    /**
     * Opens the same menu the action button gives on a vehicle.
     *   'auto' -> the vehicle being ridden, else the interior the player stands
     *             in, else a vehicle on the player / facing tile.
     *   a type -> that vehicle, as long as it is parked on the current map.
     */
    static _openVehicleMenu(type) {
      if ($gameMessage.isBusy()) return;

      if (isPlayerRidingCustomVehicle()) {
        const ridden = $gamePlayer.vehicle();
        if (type === 'auto' || ridden === vehicleManager.getVehicle(type)) {
          $gamePlayer.showVehicleActionMenu(ridden, true);
          return;
        }
      }

      if (type === 'auto') {
        const interiorConfig = getConfigByInteriorMapId($gameMap.mapId());
        if (interiorConfig) {
          $gamePlayer.showVehicleInteriorMenu(interiorConfig);
          return;
        }
        if ($gamePlayer.openParkedVehicleMenu()) return;
        showLocalizedMessage(T('VehicleSystem.noVehicleHere'));
        return;
      }

      const vehicle = vehicleManager.getVehicle(type);
      const config = vehicleManager.getConfig(vehicle);
      if (!vehicle || !config) {
        showLocalizedMessage(T('VehicleSystem.cannotFindVehicle'));
        return;
      }
      // Ask the store, not the map: the named vehicle may be parked right here
      // and still not materialized (parked under another one, or waiting for the
      // shared Car / Bike / Boat slot).
      const parked = materializeVehicle(VehiclePosition.keyForConfig(config));
      if (!parked) {
        showLocalizedMessage(T('VehicleSystem.vehicleNotHere', { vehicle: vehicleNounName(config) }));
        return;
      }
      $gamePlayer.showVehicleActionMenu(parked, false);
    }

    static _teleportToVehicle(type) {
      const vehicle = vehicleManager.getVehicle(type);
      const config = vehicleManager.getConfig(vehicle);

      if (!vehicle || !config) {
        showLocalizedMessage(T('VehicleSystem.cannotFindLocation', { vehicle: config ? vehicleNounName(config) : T('VehicleSystem.genericVehicle') }));
        return;
      }

      const key = VehiclePosition.keyForConfig(config);
      const dest = resolveReturnDestination(key);
      const mapId = dest.mapId;
      const x = dest.x;
      const y = dest.y;

      if (!mapId || !x || !y) return;

      if (mapId === $gameMap.mapId()) {
        const pos = PositionFinder.findValidPosition(x, y, $gamePlayer);
        if (pos) {
          $gamePlayer.reserveTransfer($gameMap.mapId(), pos.x, pos.y,
            $gamePlayer.direction(), 0);
        }
      } else {
        vehicle.setLocation(mapId, x, y);
        const pos = PositionFinder.findValidPosition(x, y, $gamePlayer);
        if (pos) {
          $gamePlayer.reserveTransfer(mapId, pos.x, pos.y, 2, 0);
        }
      }

      AudioManager.playSe({ name: 'Teleport', pan: 0, pitch: 100, volume: 90 });
      // Animation removed from summoning as per request
      // $gameTemp.requestAnimation([$gamePlayer], 52);
    }

    static _saveAndTravel(config, opts) {
      // Use disembarkLeavingParked (not the default getOffVehicle) so the player
      // is reliably removed from the airship even when it is parked over water or
      // another non-land tile. The default getOffVehicle silently fails there,
      // leaving the player flagged isInAirship() (transparent player + hidden
      // followers), which makes all sprites vanish after exiting the interior (#158).
      if ($gamePlayer.isInVehicle()) {
        disembarkLeavingParked($gamePlayer.vehicle());
      }

      $gamePlayer.reserveTransfer(config.interior.mapId,
        config.interior.x,
        config.interior.y, 0, 0);

      // `silent` lets a caller (e.g. the menu's Return to Ship) play its own SE
      // without doubling this one.
      if (!opts || !opts.silent) {
        AudioManager.playSe({ name: 'Teleport', pan: 0, pitch: 100, volume: 90 });
      }
    }

    static _returnToVehicle(config, autoRide) {
      const key = VehiclePosition.keyForConfig(config);
      const dest = resolveReturnDestination(key);
      const mapId = dest.mapId;
      const x = dest.x;
      const y = dest.y;

      const vehicle = vehicleManager.getVehicle(config.type);
      if (vehicle) {
        vehicle.setLocation(mapId, x, y);
      }

      $gamePlayer.reserveTransfer(mapId, x, y, 2, 0);

      // Use a generic flag system that works for any vehicle type
      const flagName = vehicleManager.getReturnFlagName(config) || 'Generic';  // i18n-ignore  return-flag id
      $gameTemp[`_spawn${flagName}AfterTransfer`] = { x, y };  // i18n-ignore  temp flag key

      if (autoRide) {
        $gameTemp[`_autoRide${flagName}AfterSpawn`] = true;  // i18n-ignore  temp flag key
      }

      AudioManager.playSe({ name: 'Door1', pan: 0, pitch: 100, volume: 90 });
    }
  }

  // ============================================================================
  // Memory Management
  // ============================================================================

  const _Scene_Map_terminate = Scene_Map.prototype.terminate;
  Scene_Map.prototype.terminate = function () {
    _Scene_Map_terminate.call(this);

    if ($gameMap.mapId() % 10 === 0) {
      mapCache.clear();
    }
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  const _DataManager_setupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function () {
    _DataManager_setupNewGame.call(this);
    ConfigManager.alwaysDash = true;
  };

  PluginCommands.register();

  // ============================================================================
  // Vehicle ownership (party carries the summoning item) + menu API
  // ============================================================================
  //
  // A vehicle is "owned" when the party holds its summoning item (Items.json,
  // <category:Vehicles>). Ownership is what lists a vehicle in the Vehicles menu
  // and lets it be spawned / repaired / refueled. Order below is the display order.

  const VEHICLE_MENU_CONFIGS = [
    VehicleConfig.CAMPER,
    VehicleConfig.CAR,
    VehicleConfig.BOAT,
    VehicleConfig.BIKE,
    VehicleConfig.AIRSHIP
  ];

  // True when the party should be handed every Vehicles-category item for free:
  // the debug "Test" player, or an active sandbox session.
  function isVehicleGrantContext() {
    const isTester = typeof $gameActors !== 'undefined' && $gameActors &&
      $gameActors.actor(1) && $gameActors.actor(1).name() === 'Test';  // i18n-ignore  debug account name
    const isSandbox = !!(typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._isSandboxMode);
    return isTester || isSandbox;
  }

  // Give the party one of every item tagged <category:Vehicles> in Items.json that
  // it does not already own, so Test / sandbox sessions can access all vehicles.
  // Runs once (tracked by $gameSystem._vehiclesGranted); re-evaluated each map load
  // so it also fires if sandbox mode is enabled mid-game.
  function grantAllVehicleItemsIfDebug() {
    if (typeof $gameParty === 'undefined' || !$gameParty || typeof $dataItems === 'undefined') return;
    if (!isVehicleGrantContext()) return;
    if ($gameSystem._vehiclesGranted) return;
    $gameSystem._vehiclesGranted = true;

    for (let i = 1; i < $dataItems.length; i++) {
      const item = $dataItems[i];
      if (!item) continue;
      const category = item.meta ? (item.meta.category || item.meta.Category) : null;
      if (!category || String(category).trim().toLowerCase() !== 'vehicles') continue;
      if (!$gameParty.hasItem(item)) $gameParty.gainItem(item, 1);
    }
  }

  function ownsVehicleConfig(config) {
    if (!config || !config.summonItemId) return false;
    if (typeof $gameParty === 'undefined' || !$gameParty) return false;
    if (typeof $dataItems === 'undefined') return false;
    const item = $dataItems[config.summonItemId];
    return !!(item && $gameParty.hasItem(item));
  }

  function configByVehicleKey(key) {
    return VEHICLE_MENU_CONFIGS.find(c => upgradeTypeForConfig(c) === key) || null;
  }

  // The camper interior carries no map name of its own (a single blank space in
  // the map data). For the crew that named it, standing inside it is standing
  // inside The Beast, so the map banner says so.
  const _Game_Map_displayName_Beast = Game_Map.prototype.displayName;
  Game_Map.prototype.displayName = function () {
    const interiorId = VehicleConfig.CAMPER.interior && VehicleConfig.CAMPER.interior.mapId;
    if (this.mapId() === interiorId) {
      const named = vehicleDisplayName(VehicleConfig.CAMPER);
      if (named !== VehicleConfig.CAMPER.name) return named;
    }
    return _Game_Map_displayName_Beast.call(this);
  };

  // Serializable snapshot of a vehicle for the menu / refuel UIs.
  // A vehicle can be repaired when a maintenance/upgrade scene exists for it
  // (Camper, Car, Bike, Boat, Airship). Falls back to the legacy repairEvent flag
  // if VehicleSystemRepair hasn't loaded yet.
  function configHasRepair(config, key) {
    if (window.VehicleMaintenance && window.VehicleMaintenance.has) {
      return window.VehicleMaintenance.has(key);
    }
    return !!config.repairEvent;
  }

  function vehicleMenuInfo(config) {
    const key = upgradeTypeForConfig(config);
    const usesFuel = !!config.usesFuel;
    const item = (typeof $dataItems !== 'undefined') ? $dataItems[config.summonItemId] : null;
    const sprite = (config.sprites && config.sprites.normal) ? config.sprites.normal : null;
    return {
      key,
      name: vehicleDisplayName(config),
      type: config.type,
      usesFuel,
      canRefuelAtPump: !!config.canRefuelAtPump,
      hasRepair: configHasRepair(config, key),
      fuel: usesFuel ? VehicleFuel.get(key) : 0,
      max: usesFuel ? VehicleFuel.max(key) : 0,
      iconIndex: item ? (item.iconIndex || 0) : 0,
      // Overworld character sprite used to draw a left-facing portrait in the menu.
      spriteName: sprite ? sprite.name : '',
      spriteIndex: sprite ? (sprite.index || 0) : 0
    };
  }

  window.MergedVehicleSystem = {
    version: '3.3.0',
    cache: mapCache,
    manager: vehicleManager,

    // Teleport the player into the Starship interior (map 721). Reuses the same
    // path as the "saveAirshipAndTravel" plugin command, so it works from foot
    // (e.g. the "Return to Ship" menu action on an alien planet surface) as well
    // as from the airship itself.
    enterAirshipInterior(opts) {
      PluginCommands._saveAndTravel(VehicleConfig.AIRSHIP, opts);
    },

    // Live fuel of the vehicle the player is currently riding, or null when on
    // foot / in a fuel-free vehicle. Consumed by the travel HUD (TimeDateSystem.js)
    // to render the fuel as an HTML bar instead of the old top-left gauge.
    getActiveFuelStatus() {
      if (!isPlayerRidingCustomVehicle()) return null;
      const vehicle = $gamePlayer.vehicle();
      const config = vehicleManager.getConfig(vehicle);
      if (!config || !config.usesFuel) return null;
      const max = configMaxFuel(config) || 1;
      const fuel = FuelSystem.getFuel(vehicle);
      return { name: vehicleDisplayName(config), fuel, max, pct: Math.round(Math.max(0, Math.min(1, fuel / max)) * 100) };
    },

    // Every vehicle the party owns (holds the summoning item for), in menu order.
    getOwnedVehicles() {
      return VEHICLE_MENU_CONFIGS.filter(ownsVehicleConfig).map(vehicleMenuInfo);
    },

    // Owned vehicles that both use fuel and can be filled at a roadside pump
    // (Camper, Car). Consumed by VehicleSystemRefuel to build the station menu.
    getRefuelableVehicles() {
      return VEHICLE_MENU_CONFIGS
        .filter(c => ownsVehicleConfig(c) && c.usesFuel && c.canRefuelAtPump)
        .map(vehicleMenuInfo);
    },

    // True when the party owns the vehicle identified by key ('camper','car',
    // 'boat','bike','airship').
    ownsVehicle(key) {
      return ownsVehicleConfig(configByVehicleKey(key));
    },

    // Summon an owned vehicle to a nearby valid tile. Returns false if unowned.
    spawnVehicleByKey(key) {
      const c = configByVehicleKey(key);
      if (!c || !ownsVehicleConfig(c)) return false;
      vehicleManager.summon(c.type, c.boatSubType);
      return true;
    },

    // True when the Boat could be dropped on the given tile (open water).
    canDeployBoatAt(x, y) {
      return isBoatPassableTile(x, y);
    },

    // Drops the Boat onto the given water tile and (by default) mounts the player.
    // Used by the water interaction menu ("Use boat") so the dinghy is deployed
    // right where the player is looking instead of on some nearby tile.
    // Returns false when the party doesn't own the boat or the tile isn't navigable.
    deployBoatAt(x, y, mount = true) {
      if (!ownsVehicleConfig(VehicleConfig.BOAT)) return false;
      if (!isBoatPassableTile(x, y)) return false;

      $gameSystem._boatType = 'boat';
      const vehicle = vehicleManager.getVehicle('boat');
      if (!vehicle) return false;

      if (vehicle.refresh) vehicle.refresh();
      vehicle.setLocation($gameMap.mapId(), x, y);
      vehicleManager.savePosition(vehicle);
      AudioManager.playSe({ name: "Teleport", pan: 0, pitch: 100, volume: 90 });

      // Board it directly: the engine boarding flow needs the boat on the tile the
      // player faces, which is exactly the tile the water menu was opened on.
      const d = $gamePlayer.direction();
      const frontX = $gameMap.roundXWithDirection($gamePlayer.x, d);
      const frontY = $gameMap.roundYWithDirection($gamePlayer.y, d);
      if (mount && !$gamePlayer.isInVehicle() && frontX === x && frontY === y) {
        startDrivingVehicle(vehicle);
      }
      return true;
    },

    // Open the repair / upgrade workshop for a vehicle that has one.
    openRepairByKey(key) {
      const c = configByVehicleKey(key);
      if (!c || !configHasRepair(c, key)) return false;
      openVehicleMaintenance(c);
      return true;
    },

    // Per-tile game-time multiplier for the vehicle the player is currently riding
    // on the world map: reduced while a ground vehicle drives over a road biome,
    // 1 otherwise (on foot, off-road, or in the Airship/Boat). Consumed by the
    // world-map time advance in TimeDateSystem.js.
    getWorldRoadTimeFactor() {
      return isRidingOnWorldRoad() ? ROAD_TIME_FACTOR : 1;
    }
  };

  // ============================================================================
  // Game_Vehicle Hooks for graphics and riding sprites
  // ============================================================================

  const _Game_Vehicle_refresh = Game_Vehicle.prototype.refresh;
  Game_Vehicle.prototype.refresh = function () {
    if (this.isShip() || this.isBoat() || this.isAirship()) {
      const config = vehicleManager.getConfig(this);
      if (config) {
        if (this._driving) {
          this._characterName = "";
          this._characterIndex = 0;
          this._isObjectCharacter = false;
        } else if (this._mapId === $gameMap.mapId() && !this._vsStacked) {
          const spriteInfo = selectVehicleSprite(config);
          if (spriteInfo) {
            this._characterName = spriteInfo.name;
            this._characterIndex = spriteInfo.index;
            this._isObjectCharacter = true;
          }
        } else {
          // Either parked on another map, or parked underneath another vehicle:
          // a blank graphic is how this plugin hides a vehicle that should not be
          // seen here (it also keeps it out of the sprite-footprint collision).
          this._characterName = "";
          this._characterIndex = 0;
          this._isObjectCharacter = true;
        }
        return;
      }
    }
    _Game_Vehicle_refresh.call(this);
  };

  const _Game_Vehicle_characterName = Game_Vehicle.prototype.characterName;
  Game_Vehicle.prototype.characterName = function () {
    const config = vehicleManager.getConfig(this);
    if (config) {
      if (this._driving) {
        if (config.name === 'Bike') {  // i18n-ignore  vehicle id
          return config.sprites.riding.name;
        }
        const spriteInfo = selectVehicleSprite(config);
        if (spriteInfo) {
          return spriteInfo.name;
        }
      }
    }
    return _Game_Vehicle_characterName.call(this);
  };

  const _Game_Vehicle_characterIndex = Game_Vehicle.prototype.characterIndex;
  Game_Vehicle.prototype.characterIndex = function () {
    const config = vehicleManager.getConfig(this);
    if (config) {
      if (this._driving) {
        if (config.name === 'Bike') {  // i18n-ignore  vehicle id
          return config.sprites.riding.index || 0;
        }
        const spriteInfo = selectVehicleSprite(config);
        if (spriteInfo) {
          return spriteInfo.index;
        }
      }
    }
    return _Game_Vehicle_characterIndex.call(this);
  };

  // ============================================================================
  // Followers ride bikes too
  // ============================================================================

  /**
   * True when the player is currently riding the Bike. The Bike is the shared
   * 'boat' vehicle distinguished by $gameSystem._boatType. While riding, party
   * followers should show the bike-riding sprite so they appear to follow along
   * on their own bikes.
   */
  function isPlayerRidingBike() {
    return $gamePlayer.isInBoat() && $gameSystem._boatType === 'bike';
  }

  const _Game_Follower_characterName = Game_Follower.prototype.characterName;
  Game_Follower.prototype.characterName = function () {
    if (this.isVisible() && isPlayerRidingBike()) {
      return VehicleConfig.BIKE.sprites.riding.name;
    }
    return _Game_Follower_characterName.call(this);
  };

  const _Game_Follower_characterIndex = Game_Follower.prototype.characterIndex;
  Game_Follower.prototype.characterIndex = function () {
    if (this.isVisible() && isPlayerRidingBike()) {
      return VehicleConfig.BIKE.sprites.riding.index || 0;
    }
    return _Game_Follower_characterIndex.call(this);
  };

})();