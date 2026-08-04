/*:
 * @target MZ
 * @plugindesc GalaxySim Core - Main plugin entry point for modular galaxy simulation
 * @author Omni-Lex + Nocoldiz
 * @url
 * @help
 * ============================================================================
 * GalaxySim Core Module
 * ============================================================================
 * This is the main entry point for the modular GalaxySim system.
 *
 * REQUIRED MODULE LOAD ORDER:
 * 1. DataService.js (external database)
 * 2. GalaxySim_Math.js
 * 3. GalaxySim_DataManager.js
 * 4. GalaxySim_Renderer_Planets.js
 * 5. GalaxySim_Renderer_Stars.js
 * 6. GalaxySim_Renderer_Cosmology.js
 * 7. GalaxySim_Renderer_Effects.js
 * 8. GalaxySim_Scene.js
 * 9. GalaxySim_Core.js (this file - load last)
 *
 * ============================================================================
 * Plugin Commands
 * ============================================================================
 * OpenStarMap - Opens the star map scene
 * SetCurrentSystem <systemName> - Sets the current system
 * LandToSpaceport - Choice list of the orbited planet's landing sites, then teleports there
 * Refuel - Engages refuelling, or auto-plots a course to the nearest refuelling star
 *
 * ============================================================================
 * Refuelling
 * ============================================================================
 * Only an ordinary fusing star (Morgan-Keenan O, B, A, F, G, K, M) can power a
 * Hyperflux refuel; remnants, brown dwarfs and black holes cannot. The Refuel
 * command (and the star map's Refuel button) resolves that automatically:
 *   - parked at a fusing star already: it just starts the pumps
 *   - a fusing star in this very system: it plots the short hop to it
 *   - otherwise: it plots the course to the nearest system that has one
 * Either way the pumps engage by themselves the moment the ship arrives.
 *
 * ============================================================================
 * Variables Used
 * ============================================================================
 * Variable 94: Ship speed multiplier
 * Variable 95: Fuel level
 * Variable 96: Current star system
 * Variable 97: Target star system
 *
 * ============================================================================
 * Infinite fuel
 * ============================================================================
 * If the party leader is named "Test" (or Sandbox mode is active), the
 * starship fuel (variable 95) never depletes.
 *
 * @command OpenStarMap
 * @text Open Star Map
 * @desc Opens the advanced star map interface
 *
 * @command SetCurrentSystem
 * @text Set Current System
 * @desc Sets the player's current star system
 *
 * @arg systemName
 * @text System Name
 * @desc Name of the star system (e.g., "Sol", "Alpha Centauri")
 * @type string
 * @default Sol
 *
 * @command LandToSpaceport
 * @text Land to Spaceport
 * @desc Shows the hardcoded landing sites of the planet the ship is currently orbiting and teleports there
 *
 * @command Refuel
 * @text Refuel
 * @desc Starts refuelling, or auto-plots a course to the nearest star that can refuel the ship
 *
 * @arg openStarMap
 * @text Open Star Map
 * @desc Show the star map after plotting, so the flight to the fuel star actually runs
 * @type boolean
 * @default true
 */

(() => {
  "use strict";

  const pluginName = "GalaxySim_Core";

  // ============================================================================
  // Check Dependencies
  // ============================================================================

  if (!window.GalaxySim) {
    throw new Error("GalaxySim_Core: GalaxySim namespace not found. Ensure all modules are loaded.");
  }

  const requiredModules = ['Math', 'DataManager'];   // i18n-ignore: module ids
  requiredModules.forEach((module) => {
    if (!window.GalaxySim[module]) {
      throw new Error(`GalaxySim_Core: Missing required module: ${module}`);
    }
  });

  if (!window.Scene_AdvancedStarMap3D) {
    throw new Error("GalaxySim_Core: Scene_AdvancedStarMap3D not found. Ensure GalaxySim_Scene3D.js is loaded.");
  }

  console.log("GalaxySim: All modules loaded successfully");

  // ============================================================================
  // Infinite Fuel (Test / Sandbox mode)
  // ============================================================================
  // Variable that stores the starship fuel level.
  const FUEL_VAR = 95;
  const INFINITE_FUEL_VALUE = 999999;

  // Mirrors the convention used across the project.
  function isInfiniteFuel() {
    try {
      if ($gameSystem && $gameSystem._isSandboxMode) return true;
      const leader = $gameParty && $gameParty.leader();
      // i18n-ignore-start: the debug party name, compared not shown
      if (leader && leader.name() === "Test") return true;
      if ($gameVariables && $gameVariables.value(105) === "Test") return true;
      // i18n-ignore-end
    } catch (e) {
      /* state not ready */
    }
    return false;
  }
  // Exposed so other GalaxySim modules (e.g. the ship background) can reuse it.
  window.GalaxySim.isInfiniteFuel = isInfiniteFuel;

  // Keep every fuel topped up around each consumption tick. Galaxy-scale travel
  // now burns Hyperflux (playerShip.hyperflux); the classic var-95 tank is only
  // spent by map movement, but we still pin it here so nothing runs the ship dry
  // in sandbox. Schrodingerite (SB-Bridge charges) is refilled too.
  function topUpExoticFuels(dm) {
    if (!dm) return;
    const D = window.GalaxySim.DataManager;
    if (dm.setHyperflux) dm.setHyperflux((D && D.HYPERFLUX_MAX) || 92000);
    if (dm.setSchrodingerite) dm.setSchrodingerite((D && D.SCHRODINGERITE_MAX) || 92);
  }
  window.GalaxySim.topUpExoticFuels = topUpExoticFuels;

  if (window.GalaxySim.DataManager &&
      window.GalaxySim.DataManager.prototype.updateShipPosition) {
    const _updateShipPosition = window.GalaxySim.DataManager.prototype.updateShipPosition;
    window.GalaxySim.DataManager.prototype.updateShipPosition = function () {
      const cheat = isInfiniteFuel();
      if (cheat) { $gameVariables.setValue(FUEL_VAR, INFINITE_FUEL_VALUE); topUpExoticFuels(this); }
      _updateShipPosition.call(this);
      if (cheat) { $gameVariables.setValue(FUEL_VAR, INFINITE_FUEL_VALUE); topUpExoticFuels(this); }
    };
  }

  // ============================================================================
  // Star map launcher: the real-time 3D scene is the only star map now (the
  // legacy 2D-canvas scene and its renderers have been retired). The 3D scene
  // itself guards against a missing WebGL context and bounces back cleanly.
  // ============================================================================
  function pushStarMapScene() {
    if (!window.Scene_AdvancedStarMap3D) {
      console.error("[GalaxySim] 3D star map scene unavailable.");
      return;
    }
    SceneManager.push(Scene_AdvancedStarMap3D);
  }
  window.GalaxySim.pushStarMapScene = pushStarMapScene;

  // ============================================================================
  // Plugin Commands
  // ============================================================================

  PluginManager.registerCommand(pluginName, "OpenStarMap", (args) => {
    pushStarMapScene();
  });

  PluginManager.registerCommand(pluginName, "SetCurrentSystem", (args) => {
    const systemName = args.systemName || "Sol";   // i18n-ignore: system id

    if (!$gameSystem.starMapData) {
      $gameSystem.starMapData = new window.GalaxySim.DataManager();
    }

    $gameSystem.starMapData.setCurrentSystem(systemName);
    $gameVariables.setValue(96, systemName);
    console.log(`Current system set to: ${systemName}`);
  });

  // Shows a choice list of the hardcoded landing sites for the planet the ship
  // currently orbits (ship.currentPlanet), then teleports to whichever is picked
  // via GS.teleportToLandingSite. Meant to be called from an event (e.g. a
  // landing console inside the Starship), not from the 3D star map scene.
  PluginManager.registerCommand(pluginName, "LandToSpaceport", () => {
    const dm = $gameSystem.starMapData;
    const ship = dm && dm.playerShip;
    let planet = null;
    if (ship && ship.currentPlanet) {
      const sys = dm.getSystem(ship.currentSystem);
      planet = sys && sys.planets && sys.planets.find((p) => p.name === ship.currentPlanet);
    }
    const locs = (planet && planet.landingLocations) || [];
    if (!locs.length) {
      $gameMessage.add(T('Galaxy.core.noSpaceports'));
      return;
    }
    $gameMessage.setChoices(locs.map((l) => l.name).concat(T('Galaxy.core.cancel')), 0, locs.length);
    $gameMessage.setChoiceCallback((n) => {
      if (n >= 0 && n < locs.length && window.GalaxySim.teleportToLandingSite) {
        window.GalaxySim.teleportToLandingSite(locs[n]);
      }
    });
  });

  // ============================================================================
  // Refuel: engage the pumps where the ship is, or auto-plot the course to the
  // nearest star that can actually refuel it (see DataManager.planRefuel /
  // beginAutoRefuel). Shared by the "Refuel" plugin command and anything else
  // that wants the one-press behaviour.
  // ============================================================================
  function notify(text, severity) {
    if (window.ParchmentToast && window.ParchmentToast.show) {
      window.ParchmentToast.show(text, { severity: severity || "info", duration: 180 });
    } else if (typeof $gameMessage !== "undefined" && $gameMessage) {
      $gameMessage.add(text);
    }
  }

  // Returns the executed plan (see DataManager.beginAutoRefuel), or null when
  // the star map data isn't available at all.
  function autoRefuel(opts) {
    opts = opts || {};
    const dm = window.GalaxySim.getDataManager();
    if (!dm || !dm.beginAutoRefuel) return null;
    const plan = dm.beginAutoRefuel();
    const star = plan.starName || plan.systemName || T('Galaxy.core.theStar');
    if (opts.silent) return plan;

    if (plan.started) {
      notify(T('Galaxy.core.refuellingFrom', { star: star }));
    } else if (plan.plotted) {
      const dist = plan.distance ? T('Galaxy.core.distanceLy', { ly: plan.distance.toFixed(1) }) : "";
      notify(T('Galaxy.core.coursePlotted', { star: star, distance: dist }));
      if (plan.shortFuel) {
        notify(T('Galaxy.core.mayRunOut'), "warning");
      }
    } else if (plan.status === "refuelling") {
      notify(T('Galaxy.core.alreadyRefuelling', { star: star }));
    } else if (plan.status === "full") {
      notify(T('Galaxy.core.tankFull'));
    } else {
      notify(T('Galaxy.core.noStarInRange'), "warning");
    }
    return plan;
  }
  window.GalaxySim.autoRefuel = autoRefuel;

  PluginManager.registerCommand(pluginName, "Refuel", (args) => {
    const plan = autoRefuel();
    if (!plan) return;
    // Travel only advances while the star map is running (see
    // Scene_AdvancedStarMap3D._updateShipAndTravel), so a plotted course opens
    // it unless the event explicitly asked not to.
    const open = String(args && args.openStarMap) !== "false";
    const inStarMap = window.Scene_AdvancedStarMap3D &&
      SceneManager._scene instanceof window.Scene_AdvancedStarMap3D;
    if (plan.plotted && open && !inStarMap) pushStarMapScene();
  });

  // ============================================================================
  // Game_System Integration
  // ============================================================================

  const _Game_System_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function () {
    _Game_System_initialize.call(this);
    this.starMapData = new window.GalaxySim.DataManager();
  };

  // ============================================================================
  // DataManager Save/Load Integration
  // ============================================================================

  const _DataManager_makeSaveContents = DataManager.makeSaveContents;
  DataManager.makeSaveContents = function () {
    const contents = _DataManager_makeSaveContents.call(this);

    if ($gameSystem.starMapData) {
      contents.starMapData = $gameSystem.starMapData.toJSON();
    }

    return contents;
  };

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);

    if (contents.starMapData) {
      $gameSystem.starMapData = new window.GalaxySim.DataManager();
      $gameSystem.starMapData.fromJSON(contents.starMapData);
    }
  };

  // ============================================================================
  // Helper Functions (exposed globally)
  // ============================================================================

  window.GalaxySim.openStarMap = function () {
    pushStarMapScene();
  };

  window.GalaxySim.getDataManager = function () {
    if (!$gameSystem.starMapData) {
      $gameSystem.starMapData = new window.GalaxySim.DataManager();
    }
    return $gameSystem.starMapData;
  };

  window.GalaxySim.getCurrentSystem = function () {
    const dataManager = window.GalaxySim.getDataManager();
    return dataManager.getSystem(dataManager.currentSystem);
  };

  window.GalaxySim.setCurrentSystem = function (systemName) {
    const dataManager = window.GalaxySim.getDataManager();
    dataManager.setCurrentSystem(systemName);
    $gameVariables.setValue(96, systemName);
  };

  // ============================================================================
  // Planet definition helpers (breathable atmosphere / life)
  // ============================================================================
  function planetTypeInfo(planet) {
    const type = planet && (planet.type || (typeof planet === "string" ? planet : null));
    const PT = window.GalaxySim.PlanetTypes || {};
    return (type && PT[type]) || null;
  }
  function planetBreathable(planet) {
    const info = planetTypeInfo(planet);
    return !!(info && info.breathable);
  }
  function fnv1a(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  // Deterministic per-planet life: only supportLife types can host life, and
  // then only ~10% do. Seeded from the planet name + world seed so a given
  // planet always yields the same answer for the info box and for landing.
  function planetHasLife(planet) {
    // Authored life beats the roll: a body whose record states `life: true`
    // (the patron worlds, PatreonRewards) is inhabited by definition.
    if (planet && planet.life === true) return true;
    const info = planetTypeInfo(planet);
    if (!info || !info.supportLife) return false;
    let seed = 19002001;
    try {
      if (window.HistoryManager && window.HistoryManager.getSeed) {
        seed = window.HistoryManager.getSeed();
      }
    } catch (e) { /* default */ }
    const name = (planet && planet.name) || "";
    const roll = (fnv1a(name + "|life|" + seed) % 10000) / 10000;
    return roll < 0.10;
  }
  window.GalaxySim.planetTypeInfo = planetTypeInfo;
  window.GalaxySim.planetBreathable = planetBreathable;
  window.GalaxySim.planetHasLife = planetHasLife;

  // Alien surface = the procedural map (636) generated from an alien biome
  // (biome names produced by AlienBiomes.json all start with "Alien").
  function isAlienSurface() {
    if (typeof $gameMap === "undefined" || !$gameMap || $gameMap.mapId() !== 636) return false;
    const pg = (typeof $gameSystem !== "undefined" && $gameSystem) ? $gameSystem._procGenData : null;
    return !!(pg && /^Alien/.test(String(pg.currentBiome || "")));
  }
  function currentAlienHasLife() {
    return !!(typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._alienPlanetHasLife);
  }
  window.GalaxySim.isAlienSurface = isAlienSurface;
  window.GalaxySim.currentAlienHasLife = currentAlienHasLife;

  // ============================================================================
  // EVA suits: on a planet with a non-breathable atmosphere the whole party
  // wears the vac-suit sprite; the originals are restored when they leave the
  // surface (any transfer off map 636).
  // ============================================================================
  const EVA_SPRITE = "Skab/Originals/!$MargheritaHackEVA";
  function applyEVASuits() {
    if (typeof $gameParty === "undefined" || !$gameParty || !$gameSystem) return;
    if ($gameSystem._evaSuitActive) return;
    const backup = [];
    $gameParty.members().forEach((a) => {
      backup.push({ id: a.actorId(), name: a.characterName(), index: a.characterIndex() });
      a.setCharacterImage(EVA_SPRITE, 0);
    });
    $gameSystem._evaSuitBackup = backup;
    $gameSystem._evaSuitActive = true;
    if (typeof $gamePlayer !== "undefined" && $gamePlayer) $gamePlayer.refresh();
  }
  function removeEVASuits() {
    if (typeof $gameSystem === "undefined" || !$gameSystem || !$gameSystem._evaSuitActive) return;
    ($gameSystem._evaSuitBackup || []).forEach((b) => {
      const a = $gameActors.actor(b.id);
      if (a) a.setCharacterImage(b.name, b.index);
    });
    $gameSystem._evaSuitBackup = null;
    $gameSystem._evaSuitActive = false;
    if (typeof $gamePlayer !== "undefined" && $gamePlayer) $gamePlayer.refresh();
  }
  window.GalaxySim.applyEVASuits = applyEVASuits;
  window.GalaxySim.removeEVASuits = removeEVASuits;

  // ============================================================================
  // Landing on a planet surface (proc map 636). Shared by the star map's Land
  // action and the Sandbox "Teleport to Planet" tool. Builds a "landed planet"
  // descriptor (satellites + colour palette) so the battle sky and the weather
  // day-tint can reflect the specific world.
  // ============================================================================
  function hexToRgbArr(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function intToRgbArr(n) {
    if (typeof n !== "number" || !isFinite(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function makeLandedDescriptor(planet) {
    const PT = window.GalaxySim.PlanetTypes || {};
    const info = PT[planet.type] || {};
    const rgb = intToRgbArr(info.color) || [140, 150, 170];
    const moons = (planet.moons || []).map((m) => ({
      radius: (typeof m.radius === "number" && isFinite(m.radius)) ? m.radius : 0.3,
      color: m.color || "#cfd8e6",
      type: m.type || "rocky",
    }));
    // Screen-tint offset that biases the world's daylight toward its palette
    // (kept gentle so day never goes fully monochrome).
    const tintOffset = rgb.map((c) => Math.max(-90, Math.min(70, (c - 165) * 0.45)));
    return {
      name: planet.name || "",
      type: planet.type || "",
      radius: (typeof planet.radius === "number" && isFinite(planet.radius)) ? planet.radius : 1.0,
      rgb,
      skyBlend: rgb,     // sky gradient blends toward this
      tintOffset,        // [dr, dg, db] added to the weather day-tint
      moons,
    };
  }
  window.GalaxySim.hexToRgbArr = hexToRgbArr;

  // Landing-grid size for a planet: bigger radius -> more squares. Grid is a
  // bounded w x h coordinate space (toroidal wrap both axes, see
  // WorldMapReturn.js's alien branch of _resolveAdjacentBiomeAndTransfer),
  // sliced from the planet's 256x128 equirectangular texture, so h stays at
  // roughly half of w to match that 2:1 aspect ratio.
  function planetGridSize(planet) {
    const r = (planet && typeof planet.radius === "number" && isFinite(planet.radius)) ? planet.radius : 1.0;
    const w = Math.max(6, Math.min(24, Math.round(6 + r * 5)));
    const h = Math.max(4, Math.round(w / 2));
    return { w, h };
  }
  window.GalaxySim.planetGridSize = planetGridSize;

  // Descriptor of the planet the party is currently standing on, or null when
  // not on an alien surface. Map 636 is ALSO reused for ordinary Earth biomes
  // reached from the world map, so this is gated on isAlienSurface() (map 636 +
  // an "Alien*" biome) as well as a galaxy-landing descriptor being present -
  // the planet sky / tint must never bleed onto a normal Earth proc map.
  function getSurfacePlanet() {
    if (!isAlienSurface()) return null;
    return (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._landedPlanet) || null;
  }
  window.GalaxySim.getSurfacePlanet = getSurfacePlanet;

  // Set up and enter the procedural surface for a planet ({ name, type, moons? }).
  // Reserves the transfer to map 636; the caller closes whatever scene it is in.
  // opts.gridCell = {gx, gy} picks which square of the planet's landing grid
  // (see planetGridSize) to touch down on; omitted/out-of-range defaults to
  // the grid's center square, matching the previous fixed-landing behavior
  // for callers that don't offer a picker (Sandbox teleport, etc.).
  function enterPlanetSurface(planet, opts) {
    if (!planet || !planet.type) return false;
    opts = opts || {};
    const PT = window.GalaxySim.PlanetTypes || {};
    const biomeName = (PT[planet.type] && PT[planet.type].biome) || "Ice";   // i18n-ignore: biome id

    const breathable = planetBreathable(planet);
    // forceLife overrides the deterministic 10% roll (Sandbox "with Life" variant),
    // guaranteeing the surface generates random procedural species.
    $gameSystem._alienPlanetHasLife = opts.forceLife ? true : planetHasLife(planet);
    $gameSystem._awayFromShip = true;
    $gameSystem._landedPlanet = makeLandedDescriptor(planet);
    if (breathable) { removeEVASuits(); } else { applyEVASuits(); }

    // Fresh, totally-random enemy roster per planet (all landings share the
    // same proc coordinate, so the per-event caches must be cleared).
    $gameSystem._procGenEnemyTroops = {};
    $gameSystem._procGenEnemyPositions = {};
    $gameSystem._procGenDefeatedEnemies = [];

    $gameVariables.setValue(141, -1); // galaxy-sim landing marker
    $gameVariables.setValue(142, 0);
    $gameVariables.setValue(143, 0);

    const { w, h } = planetGridSize(planet);
    const cell = opts.gridCell || {};
    const gx = (typeof cell.gx === "number" && isFinite(cell.gx)) ? ((Math.floor(cell.gx) % w) + w) % w : Math.floor(w / 2);
    const gy = (typeof cell.gy === "number" && isFinite(cell.gy)) ? ((Math.floor(cell.gy) % h) + h) % h : Math.floor(h / 2);
    $gameSystem._procGenData.alienGrid = { w, h, gx, gy, biome: biomeName };
    $gameVariables.setValue(43, gx);
    $gameVariables.setValue(44, gy);

    const ok = $gameSystem.generateProceduralMap && $gameSystem.generateProceduralMap();
    if (!ok) return false;

    const PROC_MAP_ID = 636, W = 64, H = 64;
    $gamePlayer.reserveTransfer(PROC_MAP_ID, Math.floor(W / 2), Math.floor(H / 2), 2, 0);
    return true;
  }
  window.GalaxySim.enterPlanetSurface = enterPlanetSurface;

  // Current planet-grid position/size while standing on an alien surface, or
  // null. Used by WorldMap.js to render the on-foot minimap/M-key overview.
  function getAlienGridInfo() {
    if (!isAlienSurface()) return null;
    const grid = (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._procGenData)
      ? $gameSystem._procGenData.alienGrid : null;
    return grid || null;
  }
  window.GalaxySim.getAlienGridInfo = getAlienGridInfo;

  // Lazily-built, session-cached equirectangular texture canvas for the
  // currently-landed planet (keyed by planet name -- cheap to regenerate, not
  // persisted to save data). Returns null off an alien surface.
  let _alienGridTextureCache = null; // { key, canvas }
  function getAlienGridTextureCanvas() {
    const landed = getSurfacePlanet();
    const R3D = window.GalaxySim.Renderer3D;
    if (!landed || !R3D || !R3D.getPlanetTextureCanvas) return null;
    const key = landed.name || "";
    if (_alienGridTextureCache && _alienGridTextureCache.key === key) {
      return _alienGridTextureCache.canvas;
    }
    const seed = R3D._seedFor(landed);
    const canvas = R3D.getPlanetTextureCanvas(landed, seed);
    if (!canvas) return null;
    _alienGridTextureCache = { key, canvas };
    return canvas;
  }
  window.GalaxySim.getAlienGridTextureCanvas = getAlienGridTextureCanvas;

  // Teleport the party to a hand-authored landing site ({ name, mapId, x, y }),
  // e.g. one of Earth's spaceports. Deliberately does not touch the scene stack
  // (callers close/pop their own UI). When the site sits on the world map (315),
  // the Starship is parked one tile below the arrival point and the position is
  // persisted to VehiclePosition, mirroring FastTravelSystem's completeTravelAirship
  // so the ship is physically there and the player steps off it on foot.
  function teleportToLandingSite(loc) {
    if (!loc || loc.mapId == null) return false;
    if (typeof $gameSystem !== "undefined" && $gameSystem) $gameSystem._awayFromShip = true;
    const x = loc.x || 1, y = loc.y || 1;
    if (loc.mapId === 315 && window.VehiclePosition) {
      const shipVehicle = $gameMap.vehicle && $gameMap.vehicle("airship");
      if (shipVehicle) shipVehicle.setLocation(315, x, y + 1);
      window.VehiclePosition.set("airship", 315, x, y + 1, x, y + 1);
    }
    $gamePlayer.reserveTransfer(loc.mapId, x, y, 2, 0);
    return true;
  }
  window.GalaxySim.teleportToLandingSite = teleportToLandingSite;

  // Leaving the alien surface (any map that isn't the proc map) drops the suits
  // and the landed-planet descriptor. Arriving in the Starship interior (map 721)
  // clears the "away from ship" flag that keeps Return to Ship visible planetside.
  const SHIP_INTERIOR_MAP = 721;
  const _GS_Game_Map_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    _GS_Game_Map_setup.call(this, mapId);
    if (typeof $gameSystem === "undefined" || !$gameSystem) return;
    if (mapId !== 636) {
      if ($gameSystem._evaSuitActive) removeEVASuits();
      $gameSystem._landedPlanet = null;
    }
    if (mapId === SHIP_INTERIOR_MAP) {
      $gameSystem._awayFromShip = false;
      // First time aboard, the telescope's refit is pinned to the quest log.
      hubbleQuestOpen();
    }
  };

  // ============================================================================
  // Procedural alien species. A living world (see currentAlienHasLife) hosts a
  // roster of 1-6 species, deterministic from the world seed. Each species maps
  // to a base enemy id (its 3D look, which the battler system already re-rolls
  // per world seed) and a procedurally generated name. Encountering one records
  // it for the Aliens tab of the bestiary.
  // ============================================================================
  function worldSeedInt() {
    try {
      if (window.HistoryManager && window.HistoryManager.getSeed) {
        return (window.HistoryManager.getSeed() >>> 0);
      }
    } catch (e) { /* default */ }
    return 19002001;
  }
  function mulberry(seedInt) {
    let s = seedInt >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function alienSpeciesName(seedInt) {
    const syll = ["xa", "zor", "qui", "nu", "thi", "ka", "vel", "om", "ir", "ssu",
      "gla", "uut", "ny", "za", "rho", "kel", "vor", "ith", "ax", "un", "dra", "eph"];
    const rnd = mulberry(seedInt);
    const parts = 2 + Math.floor(rnd() * 2);
    let n = "";
    for (let i = 0; i < parts; i++) n += syll[Math.floor(rnd() * syll.length)];
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  // Base enemy ids usable as a procedural species look (has a battler, not a boss).
  function alienSpeciesPool() {
    const pool = [];
    if (typeof $dataEnemies === "undefined" || !$dataEnemies) return pool;
    for (let i = 1; i < $dataEnemies.length; i++) {
      const e = $dataEnemies[i];
      if (e && e.name && e.battlerName && !/<Boss>/i.test(e.note || "")) pool.push(i);
    }
    return pool;
  }
  // The current world's species roster (cached per world seed on $gameSystem).
  function alienSpeciesRoster() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return [];
    const seed = worldSeedInt();
    const cacheKey = String(seed);
    if (!$gameSystem._alienSpeciesRoster) $gameSystem._alienSpeciesRoster = {};
    if ($gameSystem._alienSpeciesRoster[cacheKey]) return $gameSystem._alienSpeciesRoster[cacheKey];
    const pool = alienSpeciesPool();
    const rnd = mulberry(seed ^ 0x5bd1e995);
    const count = pool.length ? (1 + Math.floor(rnd() * 6)) : 0; // 1..6
    const chosen = [];
    const used = new Set();
    for (let i = 0; i < count && pool.length; i++) {
      let eid, tries = 0;
      do { eid = pool[Math.floor(rnd() * pool.length)]; tries++; } while (used.has(eid) && tries < 24);
      used.add(eid);
      chosen.push({
        key: "sp" + seed + "_" + i,
        name: alienSpeciesName(Math.imul(seed, 131) + i * 977 + 7),
        enemyId: eid,
        worldSeed: seed,
      });
    }
    $gameSystem._alienSpeciesRoster[cacheKey] = chosen;
    return chosen;
  }
  function findAlienSpecies(key) {
    return alienSpeciesRoster().find((s) => s.key === key) || null;
  }
  function discoverAlienSpecies(sp) {
    if (!sp || typeof $gameSystem === "undefined" || !$gameSystem) return;
    if (!$gameSystem._discoveredAlienSpecies) $gameSystem._discoveredAlienSpecies = {};
    if (!$gameSystem._discoveredAlienSpecies[sp.key]) {
      $gameSystem._discoveredAlienSpecies[sp.key] = {
        key: sp.key, name: sp.name, enemyId: sp.enemyId, worldSeed: sp.worldSeed,
      };
    }
  }
  function getDiscoveredAlienSpecies() {
    const d = (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._discoveredAlienSpecies) || {};
    return Object.keys(d).map((k) => d[k]);
  }
  // The set of base enemy ids that are ONLY seen as procedural aliens (so the
  // bestiary's Earth tab can exclude them). An id also seen on Earth stays Earth.
  function isAlienSpeciesEnemyId(eid) {
    const disc = getDiscoveredAlienSpecies();
    return disc.some((s) => s.enemyId === eid);
  }
  window.GalaxySim.alienSpeciesRoster = alienSpeciesRoster;
  window.GalaxySim.findAlienSpecies = findAlienSpecies;
  window.GalaxySim.discoverAlienSpecies = discoverAlienSpecies;
  window.GalaxySim.getDiscoveredAlienSpecies = getDiscoveredAlienSpecies;
  window.GalaxySim.isAlienSpeciesEnemyId = isAlienSpeciesEnemyId;

  // ==========================================================================
  // Crafting materials (see VehicleSystemRepair / ThinkerMenu, items 849-871)
  // ==========================================================================
  const MAT = {
    arcane: 849, ethereal: 850, quantum: 851, circuit: 852, microchip: 853,
    battery: 854, plastic: 855, resin: 856, nanotube: 857, plant: 858,
    wood: 859, bone: 860, cloth: 861, meat: 862, steel: 863, titanium: 864,
    varlenia: 865, crystal: 866, glass: 867, leather: 868, herb: 869,
    oil: 870, acid: 871, lead: 926,
  };

  function matItem(id) { return $dataItems ? $dataItems[id] : null; }
  function matName(id) {
    const it = matItem(id);
    return it ? String(it.name).trim() : "#" + id;
  }
  function matOwned(id) {
    const it = matItem(id);
    return (it && $gameParty) ? $gameParty.numItems(it) : 0;
  }
  function matGive(id, qty) {
    const it = matItem(id);
    if (it && $gameParty && qty > 0) $gameParty.gainItem(it, qty);
  }
  function matTake(cost) {
    Object.keys(cost || {}).forEach((id) => {
      const it = matItem(Number(id));
      if (it && $gameParty) $gameParty.loseItem(it, cost[id]);
    });
  }
  function matAfford(cost) {
    if ($gameSystem && $gameSystem._isSandboxMode) return true;
    return Object.keys(cost || {}).every((id) => matOwned(Number(id)) >= cost[id]);
  }
  window.GalaxySim.MAT = MAT;
  window.GalaxySim.matName = matName;
  window.GalaxySim.matOwned = matOwned;

  // Deterministic 32-bit hash of a string, mixed with the world seed, so any
  // per-body roll (a Hubble fault, an asteroid's ore body) is the same in every
  // savegame of the same world.
  function worldSeed() {
    try {
      if (window.HistoryManager && window.HistoryManager.getSeed) {
        return window.HistoryManager.getSeed() >>> 0;
      }
    } catch (e) { /* history not loaded yet */ }
    return 19002001;
  }
  function seededHash(key, salt) {
    let h = (2166136261 ^ worldSeed() ^ (salt || 0)) >>> 0;
    const s = String(key || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15;
    return h >>> 0;
  }
  function seededFloat(key, salt) { return seededHash(key, salt) / 4294967296; }

  // ==========================================================================
  // The Hubble Space Telescope: a wreck in a 1 AU orbit that can be serviced
  // --------------------------------------------------------------------------
  // The telescope in the Sol system (Systems.json, `hubble: true`) starts every
  // world with real faults: a handful of assemblies are critically damaged and
  // the rest are worn. Servicing spends crafting materials, part by part, and a
  // fully restored telescope doubles the range of the biosignature sweep.
  // ==========================================================================
  // i18n-ignore-start: `name` is the state key (hubbleState()[name]) and the
  // service button's data-part; the label and note live in Galaxy.hubblePart.
  const HUBBLE_PARTS = [
    {
      name: "Primary Mirror", critical: true,
      cost: { [MAT.glass]: 24, [MAT.crystal]: 12, [MAT.titanium]: 8 },
    },
    {
      name: "Secondary Mirror", critical: false,
      cost: { [MAT.glass]: 14, [MAT.crystal]: 6 },
    },
    {
      name: "Corrective Optics (COSTAR)", critical: true,
      cost: { [MAT.glass]: 18, [MAT.crystal]: 10, [MAT.circuit]: 6 },
    },
    {
      name: "WFPC2 Camera", critical: false,
      cost: { [MAT.circuit]: 10, [MAT.microchip]: 6, [MAT.glass]: 8 },
    },
    {
      name: "STIS Spectrograph", critical: false,
      cost: { [MAT.circuit]: 12, [MAT.microchip]: 8, [MAT.battery]: 4 },
    },
    {
      name: "NICMOS Cooler", critical: false,
      cost: { [MAT.nanotube]: 6, [MAT.steel]: 10, [MAT.battery]: 6 },
    },
    {
      name: "Fine Guidance Sensor", critical: true,
      cost: { [MAT.microchip]: 10, [MAT.circuit]: 10, [MAT.glass]: 6 },
    },
    {
      name: "Gyroscope Assembly", critical: true,
      cost: { [MAT.steel]: 16, [MAT.titanium]: 10, [MAT.circuit]: 8 },
    },
    {
      name: "Reaction Wheels", critical: false,
      cost: { [MAT.steel]: 14, [MAT.titanium]: 8 },
    },
    {
      name: "Solar Array (Port)", critical: true,
      cost: { [MAT.circuit]: 12, [MAT.glass]: 10, [MAT.plastic]: 8 },
    },
    {
      name: "Solar Array (Starboard)", critical: true,
      cost: { [MAT.circuit]: 12, [MAT.glass]: 10, [MAT.plastic]: 8 },
    },
    {
      name: "Battery Bank", critical: false,
      cost: { [MAT.battery]: 14, [MAT.acid]: 8, [MAT.steel]: 6 },
    },
    {
      name: "High-Gain Antenna", critical: false,
      cost: { [MAT.circuit]: 8, [MAT.steel]: 10, [MAT.titanium]: 4 },
    },
    {
      name: "Aperture Door", critical: false,
      cost: { [MAT.steel]: 12, [MAT.plastic]: 6 },
    },
    {
      name: "Thermal Blanket", critical: false,
      cost: { [MAT.cloth]: 16, [MAT.plastic]: 10, [MAT.resin]: 6 },
    },
    {
      name: "DF-224 Computer", critical: true,
      cost: { [MAT.microchip]: 12, [MAT.circuit]: 14, [MAT.quantum]: 1 },
    },
  ];

  function hubbleState() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return null;
    if (!$gameSystem._hubbleParts) {
      // First look at the telescope in this world decides how badly it has
      // aged: four assemblies are critical, three more are worn, the rest hold.
      const state = {};
      const order = HUBBLE_PARTS
        .map((p, i) => ({ p, k: seededFloat(p.name, 1013 + i) }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.p);
      order.forEach((part, i) => {
        const roll = seededFloat(part.name, 2027 + i);
        if (i < 4) state[part.name] = Math.round(2 + roll * 22);
        else if (i < 7) state[part.name] = Math.round(35 + roll * 30);
        else state[part.name] = Math.round(72 + roll * 28);
      });
      $gameSystem._hubbleParts = state;
    }
    return $gameSystem._hubbleParts;
  }

  // i18n-ignore-end

  // Label and note for a part id, falling back to the id itself.
  function hubblePartText(name, field) {
    const key = 'Galaxy.hubblePart.' + name + '.' + field;
    return T.has(key) ? T(key) : (field === 'label' ? name : '');
  }

  const Hubble = {
    PARTS: HUBBLE_PARTS,
    partDef(name) { return HUBBLE_PARTS.find((p) => p.name === name) || null; },
    partHealth(name) {
      const s = hubbleState();
      if (!s) return 100;
      const v = s[name];
      return typeof v === "number" ? v : 100;
    },
    // Every part with its live condition and what putting it right would cost.
    parts() {
      return HUBBLE_PARTS.map((p) => {
        const health = Hubble.partHealth(p.name);
        return {
          name: p.name,
          label: hubblePartText(p.name, 'label'),
          critical: p.critical,
          note: hubblePartText(p.name, 'note'),
          health,
          cost: Hubble.repairCost(p.name),
          canAfford: matAfford(Hubble.repairCost(p.name)),
        };
      });
    },
    // Material cost scales with how much of the part is actually missing, so a
    // scratch is cheap and a write-off costs the full bill.
    repairCost(name) {
      const def = Hubble.partDef(name);
      if (!def) return {};
      const missing = Math.max(0, 100 - Hubble.partHealth(name)) / 100;
      if (missing <= 0) return {};
      const out = {};
      Object.keys(def.cost).forEach((id) => {
        out[id] = Math.max(1, Math.ceil(def.cost[id] * missing));
      });
      return out;
    },
    condition() {
      const list = HUBBLE_PARTS.map((p) => Hubble.partHealth(p.name));
      return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
    },
    // Operational once nothing critical is broken and the optics are whole.
    isOperational() {
      return HUBBLE_PARTS.every((p) => Hubble.partHealth(p.name) >= (p.critical ? 100 : 60));
    },
    brokenCount() {
      return HUBBLE_PARTS.filter((p) => Hubble.partHealth(p.name) < 35).length;
    },
    repair(name) {
      const s = hubbleState();
      if (!s || Hubble.partHealth(name) >= 100) return false;
      const cost = Hubble.repairCost(name);
      if (!matAfford(cost)) return false;
      matTake(cost);
      s[name] = 100;
      hubbleQuestSync();
      return true;
    },
    // Service everything affordable, cheapest job first, and report what was done.
    // The journal is synced once at the end so a whole afternoon's work reads as
    // one entry rather than sixteen.
    repairAll() {
      const done = [];
      hubbleQuestDeferred = true;
      try {
        HUBBLE_PARTS.slice()
          .sort((a, b) => Hubble.partHealth(b.name) - Hubble.partHealth(a.name))
          .forEach((p) => { if (Hubble.repair(p.name)) done.push(p.name); });
      } finally {
        hubbleQuestDeferred = false;
      }
      hubbleQuestSync();
      return done;
    },
    questId() { return HUBBLE_QUEST_ID; },
    openQuest() { return hubbleQuestOpen(); },
    syncQuest() { return hubbleQuestSync(); },
  };
  window.GalaxySim.Hubble = Hubble;

  // ==========================================================================
  // The refit contract: the telescope's restoration as a journal quest
  // --------------------------------------------------------------------------
  // The first time the party boards the Starship (map 721) the refit is pinned
  // to the Kanban quest log with one objective per assembly. Every job done in
  // the servicing bay syncs the checklist, and the note closes itself once the
  // telescope is operational again (see Hubble.isOperational).
  // ==========================================================================
  const HUBBLE_QUEST_ID = "galaxysim_hubble_refit";   // i18n-ignore: journal id
  let hubbleQuestDeferred = false;   // set while repairAll batches its jobs

  function hubbleQuestText(key, params) {
    return T('Galaxy.hubbleQuest.' + key, params);
  }

  // One objective per assembly, counted done at the condition the servicing bay
  // calls serviceable: a critical assembly has to be whole, the rest sound.
  function hubbleQuestSteps() {
    return HUBBLE_PARTS.map((p) => {
      const health = Hubble.partHealth(p.name);
      return {
        name: p.name,
        text: hubblePartText(p.name, 'label') || p.name,
        detail: health + "%",
        done: health >= (p.critical ? 100 : 60),
      };
    });
  }

  function hubbleQuestMeta() {
    return {
      giver: hubbleQuestText('giver'),
      body: hubbleQuestText('body'),
      objectives: hubbleQuestText('objectives'),
      terms: T.list('Galaxy.hubbleQuest.terms'),
      reward: hubbleQuestText('reward'),
      diff: 3,
    };
  }

  // Pin the refit to the journal. Does nothing if the note is already there, or
  // if this world's telescope somehow needs no work at all.
  function hubbleQuestOpen() {
    if (!window.KanbanQuest || typeof $gameSystem === "undefined" || !$gameSystem) return false;
    if ($gameSystem._hubbleQuestAdded) return false;
    if (Hubble.isOperational()) return false;
    $gameSystem._hubbleQuestAdded = true;
    window.KanbanQuest.addQuest(HUBBLE_QUEST_ID, hubbleQuestText('title'),
      hubbleQuestText('log.opened'), hubbleQuestMeta());
    hubbleQuestSync(true);
    return true;
  }

  // Write the live checklist onto the note, log whatever has been serviced since
  // the last sync, and close the quest once nothing sits below its limit.
  function hubbleQuestSync(silent) {
    if (hubbleQuestDeferred) return;
    if (!window.KanbanQuest || typeof $gameSystem === "undefined" || !$gameSystem) return;
    if (!$gameSystem._hubbleQuestAdded) return;
    const quest = typeof window.KanbanQuest.getQuest === "function"
      ? window.KanbanQuest.getQuest(HUBBLE_QUEST_ID) : null;
    if (!quest) return;

    const steps = hubbleQuestSteps();
    const done = steps.filter((s) => s.done);
    const seen = $gameSystem._hubbleQuestServiced || [];
    const fresh = done.filter((s) => seen.indexOf(s.name) < 0);
    $gameSystem._hubbleQuestServiced = done.map((s) => s.name);

    const firstUndone = steps.findIndex((s) => !s.done);
    if (typeof window.KanbanQuest.setProgress === "function") {
      window.KanbanQuest.setProgress(HUBBLE_QUEST_ID, {
        done: done.length,
        total: steps.length,
        mode: "par",       // i18n-ignore: the journal's any-order marker
        status: "active",  // i18n-ignore: journal status id
        steps: steps.map((s, i) => ({
          text: s.text,
          done: s.done,
          current: !s.done && i === firstUndone,
          detail: s.detail,
        })),
      });
    }

    if (!silent && fresh.length) {
      window.KanbanQuest.updateQuest(HUBBLE_QUEST_ID, fresh.length === 1
        ? hubbleQuestText('log.serviced',
          { name: fresh[0].text, done: done.length, total: steps.length })
        : hubbleQuestText('log.servicedMany',
          { count: fresh.length, done: done.length, total: steps.length }));
    }

    if (quest.column !== "done" && Hubble.isOperational()) {
      window.KanbanQuest.updateQuest(HUBBLE_QUEST_ID, hubbleQuestText('log.complete'));
      window.KanbanQuest.completeQuest(HUBBLE_QUEST_ID);
    }
  }

  // ==========================================================================
  // Strip mining: taking an asteroid apart with the ship's lasers
  // --------------------------------------------------------------------------
  // Any real asteroid (not one of the Solar System's artificial objects) holds
  // an ore body of 30-200 units rolled from the world seed. Mining runs a second
  // at a time: each tick burns Hyperflux and returns a few units of ore, until
  // the body is stripped. Progress is stored per system+body, so a half-mined
  // asteroid is still half-mined on the next visit.
  // ==========================================================================
  const MINEABLE_TYPES = new Set([
    "c_type_asteroid", "s_type_asteroid", "m_type_asteroid", "trojan_asteroid",
    "planetesimal", "centaur", "comet", "short_period_comet", "long_period_comet",
  ]);
  // Ore tables per asteroid class: [itemId, weight]. Varlenia is deliberately
  // absent here -- it is rolled separately, and almost never.
  const ORE_TABLES = {
    m_type_asteroid: [[MAT.steel, 38], [MAT.titanium, 26], [MAT.lead, 18], [MAT.circuit, 8], [MAT.crystal, 6]],
    s_type_asteroid: [[MAT.steel, 30], [MAT.glass, 26], [MAT.crystal, 16], [MAT.titanium, 12], [MAT.lead, 8]],
    c_type_asteroid: [[MAT.oil, 30], [MAT.acid, 22], [MAT.resin, 18], [MAT.glass, 14], [MAT.bone, 6]],
    trojan_asteroid: [[MAT.glass, 28], [MAT.crystal, 22], [MAT.steel, 20], [MAT.acid, 14]],
    planetesimal: [[MAT.steel, 28], [MAT.glass, 24], [MAT.lead, 18], [MAT.crystal, 14], [MAT.titanium, 10]],
    centaur: [[MAT.glass, 30], [MAT.acid, 22], [MAT.crystal, 20], [MAT.resin, 14]],
    comet: [[MAT.glass, 34], [MAT.acid, 26], [MAT.resin, 18], [MAT.crystal, 12]],
  };
  const MINING_FUEL_PER_SEC = 220;   // Hyperflux, out of a 92 000 tank
  const VARLENIA_CHANCE = 0.012;     // per tick; the reason anyone mines at all
  const QUANTUM_CHANCE = 0.006;

  function oreTableFor(body) {
    return ORE_TABLES[body && body.type] ||
      ORE_TABLES[String(body && body.type).indexOf("comet") >= 0 ? "comet" : "planetesimal"];
  }

  const Mining = {
    FUEL_PER_SEC: MINING_FUEL_PER_SEC,
    isMineable(body) {
      if (!body || body.artificial) return false;
      return MINEABLE_TYPES.has(body.type);
    },
    key(system, body) {
      return String((system && system.name) || "?") + "|" + String((body && body.name) || "?");
    },
    // Total ore the body holds: 30-200 units, seeded so the same rock is always
    // the same rock.
    capacity(system, body) {
      const k = Mining.key(system, body);
      const base = 30 + Math.floor(seededFloat(k, 4099) * 171);
      // Metal-rich bodies are worth the fuel; icy ones much less so.
      const mult = body && body.type === "m_type_asteroid" ? 1.15
        : (body && String(body.type).indexOf("comet") >= 0 ? 0.75 : 1);
      return Math.max(30, Math.min(200, Math.round(base * mult)));
    },
    mined(system, body) {
      const log = (typeof $gameSystem !== "undefined" && $gameSystem &&
        $gameSystem._gxMinedBodies) || {};
      return log[Mining.key(system, body)] || 0;
    },
    remaining(system, body) {
      return Math.max(0, Mining.capacity(system, body) - Mining.mined(system, body));
    },
    isDepleted(system, body) {
      return Mining.remaining(system, body) <= 0;
    },
    progress(system, body) {
      const cap = Mining.capacity(system, body);
      return cap > 0 ? Math.min(1, Mining.mined(system, body) / cap) : 1;
    },
    // Seconds of laser time the rest of this body will take, at the mean rate.
    etaSeconds(system, body) {
      return Math.ceil(Mining.remaining(system, body) / 4);
    },
    // One second of mining. Burns fuel, cuts ore, hands it to the party.
    // Returns { ok, reason, gained: {itemId: qty}, amount, depleted }.
    tick(system, body, dm) {
      const out = { ok: false, reason: "", gained: {}, amount: 0, depleted: false };
      if (!Mining.isMineable(body)) { out.reason = "not-mineable"; return out; }
      const left = Mining.remaining(system, body);
      if (left <= 0) { out.reason = "depleted"; out.depleted = true; return out; }
      if (dm && dm.getHyperflux) {
        const fuel = dm.getHyperflux();
        if (fuel < MINING_FUEL_PER_SEC) { out.reason = "fuel"; return out; }
        dm.setHyperflux(fuel - MINING_FUEL_PER_SEC);
      }
      const k = Mining.key(system, body);
      const roll = Math.random();
      // A trained miner aboard cuts cleaner: the party's best Mining level (see
      // SpecializationXP.multiplier) raises what each pass brings up.
      const skill = window.SpecializationXP
        ? window.SpecializationXP.multiplier("Mining", 0.12) : 1;
      const amount = Math.min(left,
        Math.max(1, Math.round((2 + Math.floor(Math.random() * 5)) * skill))); // 2-6 units
      const table = oreTableFor(body);
      const total = table.reduce((a, e) => a + e[1], 0);
      let pick = Math.random() * total;
      let itemId = table[0][0];
      for (const [id, w] of table) {
        pick -= w;
        if (pick <= 0) { itemId = id; break; }
      }
      out.gained[itemId] = amount;
      matGive(itemId, amount);
      // The rare seams. Varlenia is the whole reason a crew burns 220 units of
      // Hyperflux a second to chew on a rock.
      if (roll < VARLENIA_CHANCE) {
        out.gained[MAT.varlenia] = 1;
        matGive(MAT.varlenia, 1);
      } else if (roll < VARLENIA_CHANCE + QUANTUM_CHANCE) {
        out.gained[MAT.quantum] = 1;
        matGive(MAT.quantum, 1);
      }
      if (!$gameSystem._gxMinedBodies) $gameSystem._gxMinedBodies = {};
      $gameSystem._gxMinedBodies[k] = Mining.mined(system, body) + amount;
      out.amount = amount;
      out.ok = true;
      out.depleted = Mining.remaining(system, body) <= 0;
      return out;
    },
  };
  window.GalaxySim.Mining = Mining;

  // ==========================================================================
  // Anomalies: the one world in a system that is signalling, and what answers
  // --------------------------------------------------------------------------
  // Every system that holds planets carries at least one anomalous world, rolled
  // from the world seed, marked with a "?" in the system view. Holding orbit over
  // it offers Investigate, once and once only: a branching encounter written out
  // of that world's own alien biome (js/i18n/<lang>/plugins/Anomaly.json), where
  // every choice leads somewhere and the last node pays out - a relic for the
  // world's artifact list, a fight with something native, salvage, or the walk
  // back with nothing. The party leader is the one who goes down there.
  //
  // Content shape (one merged namespace, so a translation overrides the prose
  // and inherits every structural field):
  //   Anomaly.tokens.<bank>          shared word banks
  //   Anomaly.biomes.<Biome>         { label, scenarios: [id], tokens: {bank} }
  //   Anomaly.scenarios.<id>         { title, start, nodes: { <id>: node } }
  //   node                           { text, choices: [{ text, to }] }
  //   terminal node                  { text, outcome: { kind, mag } }
  // ==========================================================================
  const ANOM_FALLBACK_BIOME = "AlienIce";   // i18n-ignore: biome id

  let _anomDB = null, _anomDBLang = null;
  function anomalyDB() {
    const lang = (window.T && T.language) ? T.language() : "en";
    if (_anomDB && _anomDBLang === lang) return _anomDB;
    _anomDB = (window.T && T.obj) ? (T.obj("Anomaly") || {}) : {};
    _anomDBLang = lang;
    return _anomDB;
  }

  function anomalyBiomeKey(planet) {
    const PT = window.GalaxySim.PlanetTypes || {};
    const b = PT[planet && planet.type] && PT[planet.type].biome;
    const db = anomalyDB().biomes || {};
    return (b && db[b]) ? b : ANOM_FALLBACK_BIOME;
  }

  // Which worlds in a system are signalling. Deterministic from the world seed:
  // every system with a landable planet has one, a crowded one can have two.
  const _anomBySystem = {};   // session cache, keyed by system name
  function anomalyPlanetNames(system) {
    const sysKey = String((system && system.name) || "?");
    if (_anomBySystem[sysKey]) return _anomBySystem[sysKey];
    const all = ((system && system.planets) || [])
      .filter((p) => p && p.name && p.type && !p.artificial && !p.noLanding);
    // A world with hand-authored landing sites is a known, documented place
    // (Earth and its spaceports): it only carries the signal if the system has
    // nothing else to hang it on.
    const unknown = all.filter((p) => !(p.landingLocations && p.landingLocations.length));
    const usable = unknown.length ? unknown : all;
    const names = [];
    if (usable.length) {
      const first = Math.floor(seededFloat(sysKey, 6151) * usable.length) % usable.length;
      names.push(usable[first].name);
      if (usable.length >= 5 && seededFloat(sysKey, 6173) < 0.34) {
        const step = 1 + Math.floor(seededFloat(sysKey, 6197) * (usable.length - 1));
        const second = (first + step) % usable.length;
        if (usable[second].name !== names[0]) names.push(usable[second].name);
      }
    }
    _anomBySystem[sysKey] = names;
    return names;
  }

  function anomalyKey(system, body) {
    return String((system && system.name) || "?") + "|" + String((body && body.name) || "?");
  }

  function anomalyStore() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return {};
    if (!$gameSystem._gsAnomalies) $gameSystem._gsAnomalies = {};
    return $gameSystem._gsAnomalies;
  }

  // ---- Text ---------------------------------------------------------------
  // The same passes the TV transmissions use: inline {a|b|c} alternation first,
  // then {token} substitution out of the biome's banks. A token resolved once is
  // pinned for the rest of the encounter, so the place the party walked into in
  // the first paragraph is the place they are standing in at the last.
  function anomAlt(rng, text) {
    let s = String(text || "");
    for (let depth = 0; depth < 12; depth++) {
      if (s.indexOf("|") < 0) break;
      const next = s.replace(/\{([^{}]*\|[^{}]*)\}/g, (m, body) => {
        const opts = body.split("|");
        return opts[Math.floor(rng() * opts.length)];
      });
      if (next === s) break;
      s = next;
    }
    return s;
  }

  const ANOM_SOUNDS_VOWEL = /^(hour|honest|honou?r|heir)/i;
  const ANOM_SOUNDS_CONSONANT = /^(uni|use|user|euro|one|once|ubiquit)/i;
  function anomFixIndefinite(text) {
    return String(text).replace(/\b([Aa]n?)(\s+)([A-Za-z][\w'-]*)/g, (m, art, gap, word) => {
      if (word.length > 1 && word === word.toUpperCase()) return m;
      const needsAn = (/^[aeiou]/i.test(word) && !ANOM_SOUNDS_CONSONANT.test(word))
        || ANOM_SOUNDS_VOWEL.test(word);
      if (needsAn === (art.length === 2)) return m;
      const upper = art[0] === "A";
      return (needsAn ? (upper ? "An" : "an") : (upper ? "A" : "a")) + gap + word;
    });
  }

  // Italian fuses a preposition with the article that follows it, and a bank
  // entry carries its own article, so "in la fossa" has to come back as "nella
  // fossa". Obligatory and exceptionless, which is why it is done here instead
  // of asking every written line to guess which token it is about to take.
  const ANOM_IT_PREPS = {
    di: { il: "del", lo: "dello", la: "della", i: "dei", gli: "degli", le: "delle", "l'": "dell'" },
    a: { il: "al", lo: "allo", la: "alla", i: "ai", gli: "agli", le: "alle", "l'": "all'" },
    da: { il: "dal", lo: "dallo", la: "dalla", i: "dai", gli: "dagli", le: "dalle", "l'": "dall'" },
    "in": { il: "nel", lo: "nello", la: "nella", i: "nei", gli: "negli", le: "nelle", "l'": "nell'" },
    su: { il: "sul", lo: "sullo", la: "sulla", i: "sui", gli: "sugli", le: "sulle", "l'": "sull'" },
  };
  function anomFixItalian(text) {
    return String(text).replace(/\b(di|a|da|in|su)\s+(il|lo|la|i|gli|le|l')(?=\s|$|[a-zàèéìòù])/gi, (m, prep, art) => {
      const joined = ANOM_IT_PREPS[prep.toLowerCase()] && ANOM_IT_PREPS[prep.toLowerCase()][art.toLowerCase()];
      if (!joined) return m;
      return prep[0] === prep[0].toUpperCase() ? joined[0].toUpperCase() + joined.slice(1) : joined;
    });
  }

  // A bank entry lands at the head of a sentence as often as not, and a place
  // name written to sit mid-line would otherwise be read out lowercase there.
  function anomCapitalize(text) {
    return String(text).replace(/(^|[^.][.!?]["')\]]?\s+)([a-z])/g, (m, pre, c) => pre + c.toUpperCase());
  }

  function anomTidy(text) {
    return String(text)
      .replace(/\s{2,}/g, " ")
      .replace(/ +([,.;:!?])/g, "$1")
      .replace(/([?!])\.(?!\.)/g, "$1")
      .trim();
  }

  function anomBanks(session) {
    const db = anomalyDB();
    const biome = (db.biomes && db.biomes[session.biome]) || {};
    return [biome.tokens || {}, db.tokens || {}];
  }

  function anomResolve(session, tpl) {
    const rng = anomRng(session);
    let s = anomAlt(rng, String(tpl || ""));
    const banks = anomBanks(session);
    for (let pass = 0; pass < 6; pass++) {
      let hit = false;
      s = s.replace(/\{(\w+)\}/g, (m, key) => {
        if (session.ctx[key] !== undefined) { hit = true; return session.ctx[key]; }
        // A numbered token ({place2}) draws from the same bank as its base but
        // pins separately, so two different places can stand in one sentence.
        const base = /^([a-z_]+?)\d+$/i.exec(key);
        const bankName = base ? base[1] : key;
        for (const bank of banks) {
          const list = bank[bankName];
          if (Array.isArray(list) && list.length) {
            const v = list[Math.floor(rng() * list.length)];
            session.ctx[key] = v;
            hit = true;
            return v;
          }
        }
        return m;
      });
      if (!hit) break;
      s = anomAlt(rng, s);
    }
    // Anything still unresolved would be read out verbatim.
    s = anomTidy(s.replace(/\{(\w+)\}/g, (m, k) => k.replace(/_/g, " ")));
    const italian = (window.T && T.language && T.language() === "it");
    return anomCapitalize(italian ? anomFixItalian(s) : anomFixIndefinite(s));
  }

  // The encounter's own random stream. Seeded from the world seed and the body,
  // so the same anomaly always tells the same story, and advanced across the
  // whole encounter (the cursor is saved with the session).
  function anomRng(session) {
    return function () {
      session.roll = (Math.imul(session.roll || 1, 1664525) + 1013904223) >>> 0;
      return session.roll / 4294967296;
    };
  }

  // ---- Rewards ------------------------------------------------------------
  function anomPartyLevel() {
    const m = ($gameParty && $gameParty.members) ? $gameParty.members() : [];
    if (!m.length) return 1;
    const lv = m.map((a) => a.level).sort((a, b) => a - b);
    return lv[Math.floor(lv.length / 2)] || 1;
  }

  const ANOM_MAG = { small: 1, medium: 2.4, large: 5 };
  function anomMag(out) { return ANOM_MAG[out && out.mag] || ANOM_MAG.medium; }

  function anomText(key, params) { return T("Anomaly." + key, params); }

  // The free row in the artifact band (items 1501-1600). "Empty ..." is the
  // sentinel ArctifactGenerator writes into an unused slot; a row the history
  // simulator or the generator has already claimed is never overwritten.
  function anomFreeArtifactId() {
    if (typeof $dataItems === "undefined") return 0;
    for (let id = 1501; id <= 1600; id++) {
      const it = $dataItems[id];
      if (!it || (typeof it.name === "string" && it.name.indexOf("Empty ") === 0)) return id;
    }
    return 0;
  }

  // Mint a relic and file it with the world's own artifacts, so it survives in
  // the world folder (artifacts.json) exactly like a historical one.
  function anomMakeArtifact(session) {
    const id = anomFreeArtifactId();
    if (!id) return null;
    const rng = anomRng(session);
    const pick = (bank) => {
      const list = (anomalyDB().relic && anomalyDB().relic[bank]) || [];
      return list.length ? list[Math.floor(rng() * list.length)] : "";
    };
    const name = anomText("relic.nameTemplate", {
      prefix: pick("prefix"), noun: pick("noun"), of: session.planetName,
    });
    const item = {
      id,
      name,
      description: anomText("relic.description", { planet: session.planetName }),
      note: "<Category: Artifact>\n<Procedural: true>",   // i18n-ignore: note tags
      iconIndex: 245,
      price: 250000 + Math.floor(rng() * 2000000),
      itypeId: 1,
      consumable: false,
      occasion: 3,
      scope: 0,
      effects: [],
      params: [0, 0, 0, 0, 0, 0, 0, 0],
      isGenerated: true,
    };
    $dataItems[id] = item;
    // File it with the world's artifacts (HistorySimulator re-injects this list
    // on every load, and WorldManager persists it into the world folder).
    const gen = ($gameSystem._generatedArtifacts =
      $gameSystem._generatedArtifacts || { items: [], weapons: [], armors: [] });
    if (!Array.isArray(gen.items)) gen.items = [];
    gen.items.push(item);
    if (window.WorldManager && window.WorldManager.setField) {
      window.WorldManager.setField("artifacts", "generated", gen);
    }
    if ($gameParty) $gameParty.gainItem(item, 1);
    return item;
  }

  // A piece of kit off the shelf, priced into the party's league.
  function anomRandomGear(session, kind) {
    const db = kind === "armor" ? $dataArmors : $dataWeapons;
    if (!db) return null;
    const level = anomPartyLevel();
    const lo = 200 + level * 120, hi = 4000 + level * 2600;
    const pool = [];
    for (let i = 1; i < db.length && i < 1501; i++) {
      const e = db[i];
      if (e && e.name && e.price >= lo && e.price <= hi) pool.push(e);
    }
    if (!pool.length) return null;
    const rng = anomRng(session);
    const gear = pool[Math.floor(rng() * pool.length)];
    if ($gameParty) $gameParty.gainItem(gear, 1);
    return gear;
  }

  function anomGiveMaterials(session, kinds, qty) {
    const rng = anomRng(session);
    const ids = Object.keys(MAT).map((k) => MAT[k]);
    const out = [];
    const used = {};
    for (let i = 0; i < kinds; i++) {
      let id = ids[Math.floor(rng() * ids.length)];
      if (used[id]) continue;
      used[id] = true;
      const n = Math.max(1, qty + Math.floor(rng() * qty));
      matGive(id, n);
      out.push(matName(id) + " x" + n);
    }
    return out;
  }

  // Everything a terminal node can hand over. Returns the lines the panel and
  // the toasts read out; a battle instead arms the handover (see startBattle).
  function anomApplyOutcome(session, out) {
    const lines = [];
    const kind = (out && out.kind) || "none";
    const mag = anomMag(out);
    const level = anomPartyLevel();
    const spec = (name, pts) => {
      if (window.SpecializationXP) window.SpecializationXP.award(name, pts);
    };

    if (kind === "artifact") {
      const item = anomMakeArtifact(session);
      if (item) {
        lines.push(anomText("reward.artifact", { name: item.name }));
      } else {
        // The artifact band (items 1501-1600) is full: pay the ending out in
        // kit and coin rather than leaving the party with a story and nothing.
        const gear = anomRandomGear(session, "weapon");
        if (gear) lines.push(anomText("reward.gear", { name: gear.name }));
        const gold = Math.round(1800 * mag * (1 + level / 24));
        if ($gameParty) $gameParty.gainGold(gold);
        lines.push(anomText("reward.gold", { amount: (gold / 100).toFixed(2) }));
      }
      spec("UFOlogy", 3);            // i18n-ignore: specialization id
      spec("Anthropology", 2);       // i18n-ignore: specialization id
    } else if (kind === "gear") {
      const gear = anomRandomGear(session, out.slot === "armor" ? "armor" : "weapon");
      if (gear) lines.push(anomText("reward.gear", { name: gear.name }));
      spec("Survival", 2);           // i18n-ignore: specialization id
    } else if (kind === "schrodingerite") {
      const dm = $gameSystem && $gameSystem.starMapData;
      const units = Math.max(1, Math.round(mag / 2));
      if (dm && dm.getSchrodingerite) dm.setSchrodingerite(dm.getSchrodingerite() + units);
      lines.push(anomText("reward.schrodingerite", { units: units }));
      spec("Quantum Cryptography", 2);   // i18n-ignore: specialization id
    } else if (kind === "loot") {
      const mats = anomGiveMaterials(session, Math.max(1, Math.round(mag / 1.6)), Math.round(2 * mag));
      if (mats.length) lines.push(anomText("reward.materials", { list: mats.join(", ") }));
      spec("Survival", 2);           // i18n-ignore: specialization id
    } else if (kind === "gold") {
      const gold = Math.round(900 * mag * (1 + level / 24));
      if ($gameParty) $gameParty.gainGold(gold);
      lines.push(anomText("reward.gold", { amount: (gold / 100).toFixed(2) }));
    } else if (kind === "harm") {
      const pct = Math.min(0.6, 0.08 * mag);
      ($gameParty ? $gameParty.members() : []).forEach((a) => {
        a.setHp(Math.max(1, Math.floor(a.hp - a.mhp * pct)));
      });
      lines.push(anomText("reward.harm", { pct: Math.round(pct * 100) }));
    } else if (kind === "heal") {
      ($gameParty ? $gameParty.members() : []).forEach((a) => {
        a.setHp(a.mhp); a.setMp(a.mmp); a.clearStates();
      });
      lines.push(anomText("reward.heal"));
    }

    // Every ending teaches the away team something, even the empty ones.
    const exp = Math.round((out && out.exp != null ? out.exp : 10) * mag * level);
    if (exp > 0 && $gameParty) {
      $gameParty.allMembers().forEach((a) => a.gainExp(exp));
      lines.push(anomText("reward.exp", { exp: exp }));
    }
    if (kind === "none") spec("Astrobiology", 1);   // i18n-ignore: specialization id
    return lines;
  }

  // ---- Battle handover ----------------------------------------------------
  // A fight cannot start inside the star map, so a battle ending arms this and
  // the scene pops back to the map before calling startBattle().
  let _anomPendingBattle = null;

  // A synthetic troop of 1-3 of whatever lives out here, picked from the enemies
  // whose <Level:> sits nearest the party's own. Session-local: $dataTroops is
  // rebuilt from the database on every load, so nothing is persisted.
  function anomBuildTroop(session, count) {
    if (typeof $dataEnemies === "undefined" || typeof $dataTroops === "undefined") return 0;
    const level = anomPartyLevel();
    const lvOf = (e) => (window.BSE && window.BSE.Helpers)
      ? (window.BSE.Helpers.getEnemyLevel(e.note) || 0) : 0;
    const pool = [];
    for (let i = 1; i < $dataEnemies.length; i++) {
      const e = $dataEnemies[i];
      if (!e || !e.name || !e.battlerName) continue;
      const lv = lvOf(e);
      if (lv > 0 && Math.abs(lv - level) <= Math.max(6, level * 0.25)) pool.push(i);
    }
    if (!pool.length) {
      for (let i = 1; i < $dataEnemies.length; i++) {
        if ($dataEnemies[i] && $dataEnemies[i].battlerName) pool.push(i);
      }
    }
    if (!pool.length) return 0;
    const rng = anomRng(session);
    const enemyId = pool[Math.floor(rng() * pool.length)];
    const n = Math.max(1, Math.min(3, count || 1));
    const members = [];
    for (let m = 0; m < n; m++) {
      members.push({ enemyId, x: 320 + m * 180, y: 300, hidden: false });
    }
    const troopId = $dataTroops.length;
    $dataTroops.push({ id: troopId, members, name: $dataEnemies[enemyId].name, pages: [] });
    return troopId;
  }

  // ---- The encounter itself ----------------------------------------------
  function anomScenarioFor(session) {
    const db = anomalyDB();
    const biome = (db.biomes && db.biomes[session.biome]) || {};
    const list = (biome.scenarios && biome.scenarios.length)
      ? biome.scenarios : (db.fallbackScenarios || []);
    const usable = list.filter((id) => db.scenarios && db.scenarios[id]);
    if (!usable.length) return null;
    const idx = Math.floor(seededFloat(session.key, 7717) * usable.length) % usable.length;
    return usable[idx];
  }

  // Resolve the node the session is sitting on into the panel's view. Resolved
  // once and cached on the session, so a re-render never re-rolls the prose.
  function anomBuildView(session) {
    const db = anomalyDB();
    const sc = db.scenarios && db.scenarios[session.scenario];
    const node = sc && sc.nodes && sc.nodes[session.node];
    if (!node) {
      session.view = { title: session.planetName, text: anomText("ui.signalLost"), choices: [], done: true };
      return session.view;
    }
    const view = {
      title: session.title || anomResolve(session, sc.title || ""),
      text: anomResolve(session, node.text),
      choices: [],
      done: !!node.outcome,
      rewards: [],
    };
    session.title = view.title;
    if (node.outcome) {
      view.rewards = session.rewards || [];
    } else {
      view.choices = (node.choices || []).map((c) => ({
        text: anomResolve(session, c.text), to: c.to,
      }));
    }
    session.view = view;
    return view;
  }

  const Anomaly = {
    // Is this body the one signalling in its system?
    isAnomalous(system, body) {
      if (!system || !body || !body.name) return false;
      return anomalyPlanetNames(system).indexOf(body.name) >= 0;
    },
    key: anomalyKey,
    // Answered, whichever way it went.
    isResolved(system, body) {
      const rec = anomalyStore()[anomalyKey(system, body)];
      return !!(rec && rec.done);
    },
    // The "?" and the Investigate button both follow this: a world that has
    // never been touched, or the one the party is halfway through. An encounter
    // walked away from mid-branch is spent, like any other answer.
    isPending(system, body) {
      if (!Anomaly.isAnomalous(system, body)) return false;
      const rec = anomalyStore()[anomalyKey(system, body)];
      if (!rec) return true;
      if (rec.done) return false;
      return Anomaly.hasSessionOn(system, body);
    },
    session() {
      return (typeof $gameSystem !== "undefined" && $gameSystem)
        ? ($gameSystem._gsAnomalySession || null) : null;
    },
    // Is there a half-finished encounter on this exact body?
    hasSessionOn(system, body) {
      const s = Anomaly.session();
      return !!(s && s.key === anomalyKey(system, body));
    },
    // Open (or resume) the encounter. The body is marked the moment it is
    // opened, not when it ends, which is what makes the answer final: walking
    // out of the panel is one of the ways to answer a signal.
    begin(system, planet) {
      if (typeof $gameSystem === "undefined" || !$gameSystem) return null;
      const key = anomalyKey(system, planet);
      const live = Anomaly.session();
      // Resuming: hand back the view as it was written, rather than resolving
      // the same node again and re-rolling every {a|b} in it.
      if (live && live.key === key) {
        if (!live.view) anomBuildView(live);
        return live;
      }
      if (anomalyStore()[key]) return null;   // answered, or walked away from
      const session = {
        key,
        biome: anomalyBiomeKey(planet),
        planetName: planet.name,
        systemName: (system && (system.label || system.name)) || "",
        roll: seededHash(key, 8191) || 1,
        ctx: {},
        rewards: [],
        node: null,
        scenario: null,
      };
      session.ctx.planet = session.planetName;
      session.ctx.system = session.systemName;
      session.ctx.leader = ($gameParty && $gameParty.leader()) ? $gameParty.leader().name() : "";
      const db = anomalyDB();
      const biome = (db.biomes && db.biomes[session.biome]) || {};
      session.ctx.biome = biome.label || session.biome;
      session.scenario = anomScenarioFor(session);
      if (!session.scenario) return null;
      const sc = db.scenarios[session.scenario];
      session.node = sc.start || Object.keys(sc.nodes || {})[0];
      anomalyStore()[key] = { started: true };
      $gameSystem._gsAnomalySession = session;
      anomBuildView(session);
      return session;
    },
    view() {
      const s = Anomaly.session();
      return s ? (s.view || anomBuildView(s)) : null;
    },
    // Take a branch. Returns the new view; a terminal node applies its outcome
    // first, so the view already carries the reward lines.
    choose(index) {
      const s = Anomaly.session();
      if (!s || !s.view || s.view.done) return null;
      const choice = s.view.choices[index];
      if (!choice) return null;
      s.node = choice.to;
      const db = anomalyDB();
      const sc = db.scenarios && db.scenarios[s.scenario];
      const node = sc && sc.nodes && sc.nodes[s.node];
      if (node && node.outcome) {
        if (node.outcome.kind === "battle") {
          const troopId = anomBuildTroop(s, node.outcome.count);
          if (troopId) {
            _anomPendingBattle = { troopId, outcome: node.outcome, key: s.key };
            s.rewards = [anomText("reward.battle")];
          } else {
            // No enemy could be built (a database this thin should not happen,
            // but an ending has to pay out something).
            s.rewards = anomApplyOutcome(s, Object.assign({}, node.outcome,
              { kind: node.outcome.reward || "loot" }));
          }
        } else {
          s.rewards = anomApplyOutcome(s, node.outcome);
        }
      }
      return anomBuildView(s);
    },
    // Close the panel for good and record how it ended.
    end() {
      if (typeof $gameSystem === "undefined" || !$gameSystem) return;
      const s = Anomaly.session();
      if (s) anomalyStore()[s.key] = { started: true, done: true, scenario: s.scenario };
      $gameSystem._gsAnomalySession = null;
    },
    // A fight was the answer. The scene pops back to the map, then calls this.
    hasPendingBattle() { return !!(_anomPendingBattle && _anomPendingBattle.troopId); },
    startBattle() {
      const pend = _anomPendingBattle;
      _anomPendingBattle = null;
      if (!pend || !pend.troopId) return false;
      const session = Anomaly.session();
      // No map to fight on (a load that never streamed one in): close the
      // encounter rather than leaving it half-open forever.
      if (!$dataMap || typeof $dataMap.width !== "number") { Anomaly.end(); return false; }
      BattleManager.setup(pend.troopId, true, false);
      BattleManager.setEventCallback((result) => {
        // Victory pays what the ending promised; anything else is the walk back.
        if (result === 0 && session) {
          const lines = anomApplyOutcome(session, Object.assign({}, pend.outcome, { kind: pend.outcome.reward || "loot" }));
          if (window.ParchmentToast) {
            window.ParchmentToast.group(lines.map((l) => ({ text: l, severity: "good" })));
          }
        }
        Anomaly.end();
      });
      SceneManager.push(Scene_Battle);
      return true;
    },
  };
  window.GalaxySim.Anomaly = Anomaly;

  // A branch that ended in a fight leaves the star map and lands here: the map
  // scene is the only place a battle can be pushed from safely.
  const _GS_Scene_Map_start = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function () {
    _GS_Scene_Map_start.call(this);
    if (Anomaly.hasPendingBattle() && !this._transfer) {
      try { Anomaly.startBattle(); } catch (e) { console.error(e); Anomaly.end(); }
    }
  };

  console.log("GalaxySim_Core: Plugin initialized successfully");

})();
