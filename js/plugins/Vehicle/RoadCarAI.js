//=============================================================================
// RoadCarAI.js
// Version: 3.1.0 - Road-Tile Following AI (border-to-border, no circling)
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Road Car AI - Cars follow procedural road tiles, avoid actors, park in villages
 * @author Omni-Lex
 * @version 3.0.0
 *
 * @command StealParkedCar
 * @text Steal parked car
 * @desc Offers to break into the parked Car event that called this command.
 *
 * @help
 * Road Car AI System v3.0.0
 * =========================
 * Complete rework. Cars are no longer locked to hardcoded lanes.
 *
 * FEATURES:
 * - Reads the procedurally generated map and detects ROAD tiles at runtime
 *   (via the tileset "road"/"dashed" features used by the road generator).
 * - Driving cars FOLLOW the road tiles: they drive in a heading, continue
 *   straight, and turn only where the road bends (corners) or forks
 *   (intersections). They NEVER reverse, so they no longer drive in circles.
 * - Cars drive BORDER TO BORDER: when a car reaches a map edge that carries the
 *   road it "exits" and respawns at another border road/dashed-line tile.
 * - In CITY / VILLAGE biomes cars wander (they take turns at intersections more
 *   often); in ROAD biomes they go straight from one end of the map to the other.
 * - Dead ends recycle the car to a fresh border spawn instead of U-turning.
 * - Cars AVOID the player, enemies, NPCs and each other (they wait or reroute
 *   instead of driving onto them). If the player walks into a moving car an
 *   accident common event still triggers.
 * - VILLAGES have very few cars and they are mostly PARKED. Cars park on any
 *   open ground tile that is NOT a road tile.
 * - Far fewer vehicles overall, scaled by time of day.
 *
 * COLLISION COMMON EVENTS (moving cars only, parked cars never run their page):
 * - Riding Ship (Camper): CE 168
 * - Riding Boat (Car):    CE 167
 * - On Foot:              CE 163
 *
 * PARKED CARS ARE REAL EVENT PAGES:
 * - Every Car event on map 636 has two pages. Page 1 is the moving car (player
 *   touch -> accident common event). Page 2 is conditioned on self switch A and
 *   is the PARKED car: action-button trigger, solid, running the StealParkedCar
 *   plugin command. This plugin turns self switch A ON for the cars it parks and
 *   OFF for the ones it drives or hides, so only a parked car is interactable.
 *
 * CAR THEFT:
 * - Pressing the action button while facing a PARKED car offers "Steal car" /
 *   "Cancel". Stealing runs the LockpickTetris minigame (a lockpick, item 374,
 *   is required; a skeleton key, item 740, opens it outright).
 * - Success: the party gains the "Utilitarian car" keys (item 164) and the car
 *   is removed from the world (that world cell keeps one parked car fewer).
 * - Failure: a Vehicle Theft crime is logged (the minigame eats the lockpick).
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "RoadCarAI";
  const PROC_MAP_ID = 636;
  const GAME_TIME_VARIABLE = 114;
  const PARKED_SELF_SWITCH = "A"; // page 2 of every Car event = the parked car
  const VAR_WORLD_X = 43;             // player world-map X (FastTravelSystem)
  const VAR_WORLD_Y = 44;             // player world-map Y
  const CAR_KEYS_ITEM_ID = 164;       // "Utilitarian car" summoning keys
  const LOCKPICK_ITEM_ID = 374;
  const SKELETON_KEY_ITEM_ID = 740;
  // Road/highway cars are fast and lane-disciplined; town cars are slower and
  // yield to actors. MZ move speeds: 4 = normal, higher = faster.
  const CAR_SPEED_ROAD = 5;       // highways: fast, follow lane end-to-end
  const CAR_SPEED_CITY = 3;       // cities/villages: slower, cautious traffic
  const STUCK_LIMIT = 100;        // frames a driving car waits before respawning
  const TOTAL_CAR_CAP = 10;       // hard cap on active cars regardless of plan
  const HIT_GRACE_FRAMES = 90;    // frames of immunity after being run over

  let lastHitFrame = -HIT_GRACE_FRAMES - 1;

  // Debug logging: silent by default. Flip $gameSystem._roadCarAIDebug (or the
  // global window.ROADCARAI_DEBUG) to true to surface traffic diagnostics.
  const isDebug = () =>
    (typeof window !== "undefined" && window.ROADCARAI_DEBUG) ||
    (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._roadCarAIDebug);
  const dlog = (...args) => { if (isDebug()) console.log(...args); };
  const dwarn = (...args) => { if (isDebug()) console.warn(...args); };

  // Directions (MZ): 2=Down, 4=Left, 6=Right, 8=Up
  const dxOf = (d) => (d === 4 ? -1 : d === 6 ? 1 : 0);
  const dyOf = (d) => (d === 8 ? -1 : d === 2 ? 1 : 0);
  const perpDirs = (d) => (d === 2 || d === 8 ? [4, 6] : [2, 8]);

  // Per-map runtime road data (rebuilt on every proc map load)
  let roadGrid = null;            // Uint8Array, 1 = road tile
  let gridW = 0;
  let gridH = 0;
  let roadTiles = [];            // [{x,y}] every road tile
  let roadEdgeTiles = [];        // road tiles near the map border (spawn points)
  let biomeCategory = "none";    // 'road' | 'city' | 'village' | 'none'
  let laneDefs = [];             // road biome: fixed lane paths (see LANE GEOMETRY)
  let laneCursor = 0;            // round-robin lane assignment counter

  // Traffic handedness. true = drive on the right (a car keeps the dashed centre
  // line on its LEFT). Flip to false for left-hand traffic; every lane in the
  // table below is derived from this, so nothing else needs changing.
  const DRIVE_ON_RIGHT = true;

  // ==========================================================================
  //  TIME / DENSITY
  // ==========================================================================

  function getGameTimeMinutes() {
    return $gameVariables.value(GAME_TIME_VARIABLE) || 0;
  }

  function getHourFromMinutes(minutes) {
    const date = new Date(2001, 0, 1, 12, 0, 0);
    date.setMinutes(date.getMinutes() + minutes);
    return date.getHours();
  }

  function getTrafficDensityMultiplier() {
    const hour = getHourFromMinutes(getGameTimeMinutes());
    if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19)) return 1.0; // rush hour
    if (hour >= 22 || hour < 6) return 0.25;                              // night
    return 0.6;                                                            // day
  }

  function classifyBiome(name) {
    if (!name) return "none";
    const l = name.toLowerCase();
    if (l.includes("village")) return "village";
    if (l.includes("city") || l.includes("burg")) return "city";
    if (l.includes("road") || l.includes("highway") || l.includes("bridge") || l.includes("tunnel")) return "road";
    return "none";
  }

  // Returns how many driving / parked cars this biome should have right now
  function getCarPlan() {
    const mult = getTrafficDensityMultiplier();
    let driving = 0;
    let parked = 0;
    if (biomeCategory === "village") {
      driving = Math.max(0, Math.round(1 * mult)); // 0-1 moving cars
      parked = 3;                                  // mostly parked
    } else if (biomeCategory === "city") {
      driving = Math.max(1, Math.round(7 * mult));
      parked = 2;
    } else if (biomeCategory === "road") {
      driving = Math.max(1, Math.round(6 * mult));
      parked = 0;
    }
    // Cars stolen here are gone for good: this world cell parks that many fewer.
    parked = Math.max(0, parked - stolenCarCount());
    // Respect the global cap
    if (driving + parked > TOTAL_CAR_CAP) {
      parked = Math.min(parked, TOTAL_CAR_CAP);
      driving = Math.max(0, TOTAL_CAR_CAP - parked);
    }
    return { driving, parked };
  }

  // ==========================================================================
  //  ROAD DETECTION (runtime)
  // ==========================================================================

  function getRoadTileIdSet(tilesetId) {
    const set = new Set();
    try {
      const Cache = window.ProcGenUtils && window.ProcGenUtils.Cache;
      if (!Cache) return set;
      const features = Cache.getTilesetFeatures(tilesetId);
      if (!features) return set;
      for (const [name, list] of Object.entries(features)) {
        const ln = name.toLowerCase();
        if (ln.includes("road") || ln.includes("dashed")) {
          if (Array.isArray(list)) {
            list.forEach((v) => {
              if (v.type === "single") {
                set.add(v.tileId);
              } else if (v.type === "multi" && v.tiles) {
                v.tiles.forEach((row) => row.forEach((id) => set.add(id)));
              }
            });
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    return set;
  }

  function buildRoadGrid() {
    roadGrid = null;
    roadTiles = [];
    roadEdgeTiles = [];
    gridW = $dataMap.width;
    gridH = $dataMap.height;

    const roadIds = getRoadTileIdSet($gameMap.tilesetId());
    if (!roadIds || roadIds.size === 0) return; // no road data -> isRoad() falls back

    const data = $dataMap.data;
    const layerSize = gridW * gridH;
    const grid = new Uint8Array(layerSize);

    for (let i = 0; i < layerSize; i++) {
      if (
        roadIds.has(data[i]) ||
        roadIds.has(data[i + layerSize]) ||
        roadIds.has(data[i + layerSize * 2]) ||
        roadIds.has(data[i + layerSize * 3])
      ) {
        grid[i] = 1;
        const x = i % gridW;
        const y = Math.floor(i / gridW);
        roadTiles.push({ x, y });
        // True map-border road tiles = where cars enter/leave the map.
        if (x === 0 || y === 0 || x === gridW - 1 || y === gridH - 1) {
          roadEdgeTiles.push({ x, y });
        }
      }
    }
    // Fallback: if the road never touches the exact edge, widen the margin
    // so respawns still happen near a border rather than mid-map.
    if (roadEdgeTiles.length === 0) {
      for (const t of roadTiles) {
        if (t.x < 3 || t.y < 3 || t.x > gridW - 4 || t.y > gridH - 4) {
          roadEdgeTiles.push(t);
        }
      }
    }
    roadGrid = grid;
  }

  function isRoad(x, y) {
    if (x < 0 || y < 0 || x >= gridW || y >= gridH) return false;
    if (!roadGrid) return true; // no road data: treat everything as drivable
    return roadGrid[y * gridW + x] === 1;
  }

  // ==========================================================================
  //  LANE GEOMETRY (road biomes only)
  //
  //  ProceduralMapRoadGenerator draws every road biome as a DUAL highway with
  //  fixed constants: roadWidth = 7, separation = 3. That gives two carriageways
  //  per axis, each 7 tiles wide with a dashed centre line down its middle:
  //
  //      carriageway base b -> tiles b..b+6, dashed centre line at b+3
  //      lane A = b+1  (the three tiles b..b+2, left/above the centre line)
  //      lane B = b+5  (the three tiles b+4..b+6, right/below the centre line)
  //
  //  Under right-hand traffic a car keeps the centre line on its left, so:
  //      horizontal carriageway: westbound = b+1, eastbound = b+5
  //      vertical   carriageway: southbound = b+1, northbound = b+5
  //
  //  A "lane" here is a hardcoded polyline from one map border to another,
  //  including the turns a corner / T junction forces. Cars in road biomes are
  //  pinned to one of these lanes and never deviate.
  // ==========================================================================

  // Geometry of the dual highway, mirroring the generator's own arithmetic.
  function roadGeometry() {
    const roadWidth = 7;
    const separation = 3;
    const halfRoad = 3;
    const cx = Math.floor(gridW / 2);
    const cy = Math.floor(gridH / 2);
    return {
      TY: cy - halfRoad - roadWidth - separation, // top carriageway base
      BY: cy + halfRoad + separation,             // bottom carriageway base
      LX: cx - halfRoad - roadWidth - separation, // left carriageway base
      RX: cx + halfRoad + separation,             // right carriageway base
      MX: gridW - 1,
      MY: gridH - 1,
    };
  }

  // Normalize the generated shape name to the set used by the lane table.
  function currentRoadShape() {
    const raw = ($gameSystem._procGenData && $gameSystem._procGenData.roadIntersectionType) || "";
    let s = String(raw).toLowerCase();
    if (!s) return "horizontal";
    s = s.replace("north", "up").replace("south", "down");
    s = s.replace("east", "right").replace("west", "left");
    // t-junctions keep compass-free names: t-up / t-down / t-left / t-right
    return s;
  }

  // Build the fixed lane paths for the current road shape.
  function buildRoadLanes() {
    laneDefs = [];
    laneCursor = 0;

    const g = roadGeometry();
    const { TY, BY, LX, RX, MX, MY } = g;

    // Lane offsets inside a carriageway, flipped for left-hand traffic.
    const near = DRIVE_ON_RIGHT ? 1 : 5; // westbound / southbound
    const far = DRIVE_ON_RIGHT ? 5 : 1;  // eastbound / northbound

    const TOP_W = TY + near, TOP_E = TY + far;   // top carriageway lanes
    const BOT_W = BY + near, BOT_E = BY + far;   // bottom carriageway lanes
    const LEFT_S = LX + near, LEFT_N = LX + far; // left carriageway lanes
    const RIGHT_S = RX + near, RIGHT_N = RX + far; // right carriageway lanes

    const p = (...pts) => pts.map(([x, y]) => ({ x, y }));

    // Straight-through lanes, border to border
    const H_THROUGH = [
      p([MX, TOP_W], [0, TOP_W]),
      p([0, TOP_E], [MX, TOP_E]),
      p([MX, BOT_W], [0, BOT_W]),
      p([0, BOT_E], [MX, BOT_E]),
    ];
    const V_THROUGH = [
      p([LEFT_S, 0], [LEFT_S, MY]),
      p([LEFT_N, MY], [LEFT_N, 0]),
      p([RIGHT_S, 0], [RIGHT_S, MY]),
      p([RIGHT_N, MY], [RIGHT_N, 0]),
    ];

    const shape = currentRoadShape();
    let lanes;

    if (shape.includes("vertical")) {
      lanes = V_THROUGH;
    } else if (shape.includes("cross")) {
      lanes = [...H_THROUGH, ...V_THROUGH];
    } else if (shape === "t-up") {
      // Horizontals run full width; vertical stems reach the NORTH border only.
      lanes = [
        ...H_THROUGH,
        p([LEFT_S, 0], [LEFT_S, TOP_W], [0, TOP_W]),
        p([RIGHT_S, 0], [RIGHT_S, TOP_E], [MX, TOP_E]),
        p([0, TOP_E], [LEFT_N, TOP_E], [LEFT_N, 0]),
        p([MX, TOP_W], [RIGHT_N, TOP_W], [RIGHT_N, 0]),
      ];
    } else if (shape === "t-down") {
      // Horizontals run full width; vertical stems reach the SOUTH border only.
      lanes = [
        ...H_THROUGH,
        p([MX, BOT_W], [LEFT_S, BOT_W], [LEFT_S, MY]),
        p([0, BOT_E], [RIGHT_S, BOT_E], [RIGHT_S, MY]),
        p([LEFT_N, MY], [LEFT_N, BOT_E], [MX, BOT_E]),
        p([RIGHT_N, MY], [RIGHT_N, BOT_W], [0, BOT_W]),
      ];
    } else if (shape === "t-right") {
      // Verticals run full height; horizontal stems reach the EAST border only.
      lanes = [
        ...V_THROUGH,
        p([RIGHT_S, 0], [RIGHT_S, TOP_E], [MX, TOP_E]),
        p([RIGHT_N, MY], [RIGHT_N, BOT_E], [MX, BOT_E]),
        p([MX, TOP_W], [RIGHT_N, TOP_W], [RIGHT_N, 0]),
        p([MX, BOT_W], [RIGHT_S, BOT_W], [RIGHT_S, MY]),
      ];
    } else if (shape === "t-left") {
      // Verticals run full height; horizontal stems reach the WEST border only.
      lanes = [
        ...V_THROUGH,
        p([LEFT_S, 0], [LEFT_S, TOP_W], [0, TOP_W]),
        p([LEFT_N, MY], [LEFT_N, BOT_W], [0, BOT_W]),
        p([0, TOP_E], [LEFT_N, TOP_E], [LEFT_N, 0]),
        p([0, BOT_E], [LEFT_S, BOT_E], [LEFT_S, MY]),
      ];
    } else if (shape.includes("corner-up-right") || shape.includes("corner-right-up")) {
      // Connects NORTH and EAST. Outer = left vertical + bottom horizontal.
      lanes = [
        p([LEFT_S, 0], [LEFT_S, BOT_E], [MX, BOT_E]),
        p([MX, BOT_W], [LEFT_N, BOT_W], [LEFT_N, 0]),
        p([RIGHT_S, 0], [RIGHT_S, TOP_E], [MX, TOP_E]),
        p([MX, TOP_W], [RIGHT_N, TOP_W], [RIGHT_N, 0]),
      ];
    } else if (shape.includes("corner-up-left") || shape.includes("corner-left-up")) {
      // Connects NORTH and WEST. Outer = right vertical + bottom horizontal.
      lanes = [
        p([LEFT_S, 0], [LEFT_S, TOP_W], [0, TOP_W]),
        p([0, TOP_E], [LEFT_N, TOP_E], [LEFT_N, 0]),
        p([RIGHT_S, 0], [RIGHT_S, BOT_W], [0, BOT_W]),
        p([0, BOT_E], [RIGHT_N, BOT_E], [RIGHT_N, 0]),
      ];
    } else if (shape.includes("corner-down-right") || shape.includes("corner-right-down")) {
      // Connects SOUTH and EAST. Outer = left vertical + top horizontal.
      lanes = [
        p([LEFT_N, MY], [LEFT_N, TOP_E], [MX, TOP_E]),
        p([MX, TOP_W], [LEFT_S, TOP_W], [LEFT_S, MY]),
        p([RIGHT_N, MY], [RIGHT_N, BOT_E], [MX, BOT_E]),
        p([MX, BOT_W], [RIGHT_S, BOT_W], [RIGHT_S, MY]),
      ];
    } else if (shape.includes("corner-down-left") || shape.includes("corner-left-down")) {
      // Connects SOUTH and WEST. Outer = right vertical + top horizontal.
      lanes = [
        p([LEFT_N, MY], [LEFT_N, BOT_W], [0, BOT_W]),
        p([0, BOT_E], [LEFT_S, BOT_E], [LEFT_S, MY]),
        p([RIGHT_N, MY], [RIGHT_N, TOP_W], [0, TOP_W]),
        p([0, TOP_E], [RIGHT_S, TOP_E], [RIGHT_S, MY]),
      ];
    } else {
      lanes = H_THROUGH; // "horizontal" and any unknown shape
    }

    // Drop any lane the actual generated map doesn't back with road tiles
    // (blended biome borders, unexpected shapes, water cutouts...).
    laneDefs = lanes.filter(laneIsOnRoad);
    dlog(`[RoadCarAI] shape "${shape}": ${laneDefs.length}/${lanes.length} lanes valid.`);
  }

  // ---- path helpers --------------------------------------------------------

  function pathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      len += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
    }
    return len;
  }

  // A lane is usable if nearly every tile it runs over is actually road.
  function laneIsOnRoad(path) {
    let total = 0;
    let onRoad = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const sx = Math.sign(b.x - a.x);
      const sy = Math.sign(b.y - a.y);
      const steps = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      for (let s = 0; s <= steps; s++) {
        total++;
        if (isRoad(a.x + sx * s, a.y + sy * s)) onRoad++;
      }
    }
    return total > 0 && onRoad / total >= 0.85;
  }

  // Point `dist` tiles along the lane, plus the waypoint index it is heading to.
  function pointAlongPath(path, dist) {
    let remaining = Math.max(0, dist);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (remaining <= seg) {
        return {
          x: a.x + Math.sign(b.x - a.x) * remaining,
          y: a.y + Math.sign(b.y - a.y) * remaining,
          wp: i,
        };
      }
      remaining -= seg;
    }
    const last = path[path.length - 1];
    return { x: last.x, y: last.y, wp: path.length - 1 };
  }

  const dirToward = (fx, fy, tx, ty) =>
    tx > fx ? 6 : tx < fx ? 4 : ty > fy ? 2 : 8;

  // Place a car on lane `li`, `dist` tiles in from that lane's entry border.
  function placeOnLane(ev, li, dist) {
    const path = laneDefs[li];
    const pt = pointAlongPath(path, dist);
    const tgt = path[pt.wp];
    ev._carLane = li;
    ev._carWaypoint = pt.wp;
    ev._carStuck = 0;
    ev.setPosition(pt.x, pt.y);
    ev._carDir = dirToward(pt.x, pt.y, tgt.x, tgt.y);
    ev.setDirection(ev._carDir);
  }

  // Car reached its exit border (or got wedged): re-enter on a random lane.
  function respawnLaneCar(ev) {
    if (laneDefs.length === 0) return;
    for (let tries = 0; tries < 20; tries++) {
      const li = Math.floor(Math.random() * laneDefs.length);
      const start = laneDefs[li][0];
      if (actorAt(start.x, start.y, ev)) continue;
      placeOnLane(ev, li, 0);
      return;
    }
  }

  // Drive one step along the assigned lane. Cars never leave their lane; if the
  // tile ahead is occupied they queue behind it.
  function updateLaneCar(ev) {
    const path = laneDefs[ev._carLane];
    if (!path) {
      ev._carLane = null;
      return;
    }

    // Consume any waypoints we are already standing on (i.e. finished a turn).
    let wi = ev._carWaypoint || 0;
    while (wi < path.length && path[wi].x === ev.x && path[wi].y === ev.y) wi++;
    ev._carWaypoint = wi;

    // Past the final waypoint = drove off the map border -> re-enter elsewhere.
    if (wi >= path.length) {
      respawnLaneCar(ev);
      return;
    }

    const tgt = path[wi];
    const dir = dirToward(ev.x, ev.y, tgt.x, tgt.y);
    ev._carDir = dir;
    ev.setDirection(dir);

    const nx = ev.x + dxOf(dir);
    const ny = ev.y + dyOf(dir);
    if (actorAt(nx, ny, ev)) {
      // Queue in lane rather than swerving; bail out if gridlocked.
      ev._carStuck = (ev._carStuck || 0) + 1;
      if (ev._carStuck > STUCK_LIMIT) respawnLaneCar(ev);
      return;
    }

    ev._carStuck = 0;
    ev.moveStraight(dir);
  }

  // Open ground for parking: not a road, walkable from every side
  function isOpenGround(x, y) {
    if (x < 0 || y < 0 || x >= gridW || y >= gridH) return false;
    if (isRoad(x, y)) return false;
    return (
      $gameMap.isPassable(x, y, 2) &&
      $gameMap.isPassable(x, y, 8) &&
      $gameMap.isPassable(x, y, 4) &&
      $gameMap.isPassable(x, y, 6)
    );
  }

  // ==========================================================================
  //  SPRITE-SIZED COLLISION
  // ==========================================================================
  //
  // A car sprite is several tiles long but the event stands on one tile, so the
  // player and every NPC used to walk straight through the bodywork. VehicleSystem's
  // window.VehicleFootprint measures the sprite and holds the player and events to
  // the tiles it actually covers; the cars themselves keep steering tile by tile on
  // their single road tile, and their own avoidance below is unchanged.

  let carEvents = []; // the Car events of the map currently loaded

  // Rebuilt on every load of the procedural map; the fallback covers a collision
  // check that lands before initializeRoadCars has run.
  function roadCarEvents() {
    if (carEvents.length === 0) {
      carEvents = $gameMap.events().filter((e) => e && e._isRoadCar);
    }
    return carEvents;
  }

  function collectCarFootprints(list) {
    if ($gameMap.mapId() !== PROC_MAP_ID) return;
    for (const ev of roadCarEvents()) {
      if (!ev || ev._erased) continue;
      if (ev._carMode !== "driving" && ev._carMode !== "parked") continue;
      list.push(ev);
    }
  }

  function registerCarFootprints() {
    if (window.VehicleFootprint) window.VehicleFootprint.addSource(collectCarFootprints);
  }

  // True when the car's bodywork lies over that tile (the single tile it stands
  // on, if the sprite has not been measured yet).
  function carCovers(ev, x, y) {
    if (window.VehicleFootprint) return window.VehicleFootprint.covers(ev, x, y);
    return ev.x === x && ev.y === y;
  }

  // The parked car whose bodywork the player is facing, so a car is stolen by
  // walking up to its flank instead of hunting for the one tile it is pinned to.
  function parkedCarFacing() {
    if ($gameMap.mapId() !== PROC_MAP_ID) return null;
    const d = $gamePlayer.direction();
    const x = $gameMap.roundXWithDirection($gamePlayer.x, d);
    const y = $gameMap.roundYWithDirection($gamePlayer.y, d);
    for (const ev of roadCarEvents()) {
      if (!ev || ev._erased || ev._carMode !== "parked") continue;
      if (carCovers(ev, x, y)) return ev;
    }
    return null;
  }

  const _Game_Player_checkEventTriggerThere = Game_Player.prototype.checkEventTriggerThere;
  Game_Player.prototype.checkEventTriggerThere = function (triggers) {
    _Game_Player_checkEventTriggerThere.call(this, triggers);
    if ($gameMap.mapId() !== PROC_MAP_ID) return;
    if (!this.canStartLocalEvents()) return;
    if ($gameMap.isEventRunning() || $gameMap.isAnyEventStarting()) return;
    const car = parkedCarFacing();
    if (car && car.isTriggerIn(triggers) && car.isNormalPriority()) car.start();
  };

  // ==========================================================================
  //  ACTOR AVOIDANCE
  // ==========================================================================

  function actorAt(nx, ny, self) {
    if ($gamePlayer.x === nx && $gamePlayer.y === ny) return true;
    const events = $gameMap.eventsXy(nx, ny);
    for (const ev of events) {
      if (ev === self || ev._erased) continue;
      if (ev._carActive === false) continue; // hidden cars don't block
      const data = ev.event();
      if (!data) continue;
      const nm = data.name;
      if (nm === "NPC" || nm === "Enemy" || nm === "Car") return true;  // i18n-ignore  event names
    }
    return false;
  }

  // ==========================================================================
  //  DRIVING LOGIC
  // ==========================================================================

  // Chance a driving car takes an available turn at an intersection instead of
  // going straight. Roads: almost never (drive across). Cities: wander more.
  function turnChanceForBiome() {
    if (biomeCategory === "city") return 0.35;
    if (biomeCategory === "village") return 0.4;
    return 0.05; // road/highway: basically go straight end-to-end
  }

  // Road/highway cars follow their lane and never swerve for actors (they plow
  // straight and cause accidents). Town cars yield: they swerve to avoid the
  // player and other events.
  function carsAvoidActors() {
    return biomeCategory !== "road";
  }

  // Driving move speed by biome: fast highways, slower town traffic.
  function drivingSpeedForBiome() {
    return biomeCategory === "road" ? CAR_SPEED_ROAD : CAR_SPEED_CITY;
  }

  // Special sentinel: the car has reached a dead end / no valid road ahead and
  // should be recycled to a fresh border spawn instead of reversing (reversing
  // is what made cars drive in circles).
  const RESPAWN = "RESPAWN";

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < gridW && y < gridH;

  // Decide the next direction for a driving car.
  // Returns a direction (2/4/6/8), null (wait this frame), or RESPAWN.
  function chooseCarDirection(ev) {
    const cur = ev._carDir || ev.direction();
    // Road/highway cars ignore actors (stay in lane, plow straight); town cars
    // treat occupied tiles as blocked so they swerve/wait to avoid a collision.
    const avoidActors = carsAvoidActors();

    const nx = (d) => ev.x + dxOf(d);
    const ny = (d) => ev.y + dyOf(d);
    // A road tile ahead, OR stepping off the map edge (= driving out -> exit).
    const roadDir = (d) => !inBounds(nx(d), ny(d)) || isRoad(nx(d), ny(d));
    const free = (d) =>
      !avoidActors || !inBounds(nx(d), ny(d)) || !actorAt(nx(d), ny(d), ev);

    const straightRoad = roadDir(cur);
    // Turn options never include reversing — cars only ever go forward or bend.
    const turns = perpDirs(cur).filter(roadDir);
    const freeTurns = turns.filter(free);

    if (straightRoad) {
      // At an intersection, occasionally pick a turn (cities wander, roads don't)
      if (freeTurns.length && Math.random() < turnChanceForBiome()) {
        return freeTurns[Math.floor(Math.random() * freeTurns.length)];
      }
      if (free(cur)) return cur;                 // keep going straight
      // Straight blocked by another actor: slip onto a free turn if one exists,
      // otherwise just wait for the tile ahead to clear (no reversing).
      if (freeTurns.length) return freeTurns[Math.floor(Math.random() * freeTurns.length)];
      return null;
    }

    // Straight is no longer road: the road bends (corner) or forks here.
    if (freeTurns.length) return freeTurns[Math.floor(Math.random() * freeTurns.length)];
    if (turns.length) return null;               // a turn exists but is blocked -> wait

    // Nothing ahead and no turn — genuine dead end. Recycle to a border spawn
    // rather than reversing back the way we came.
    return RESPAWN;
  }

  // Face a spawned car inward from whichever border it landed on, preferring a
  // direction that actually has road ahead.
  function pickStartDirection(x, y) {
    const inward = [];
    if (x <= 1) inward.push(6);
    if (x >= gridW - 2) inward.push(4);
    if (y <= 1) inward.push(2);
    if (y >= gridH - 2) inward.push(8);

    const roadInward = inward.filter((d) => isRoad(x + dxOf(d), y + dyOf(d)));
    if (roadInward.length) return roadInward[Math.floor(Math.random() * roadInward.length)];
    if (inward.length) return inward[0];

    // Interior spawn: head down any adjacent road.
    const roadNeighbours = [2, 4, 6, 8].filter((d) => isRoad(x + dxOf(d), y + dyOf(d)));
    if (roadNeighbours.length) return roadNeighbours[Math.floor(Math.random() * roadNeighbours.length)];
    return 2;
  }

  function respawnDrivingCar(ev) {
    const pool = roadEdgeTiles.length > 0 ? roadEdgeTiles : roadTiles;
    if (pool.length === 0) return;
    for (let tries = 0; tries < 30; tries++) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      if (actorAt(t.x, t.y, ev)) continue;
      ev.setPosition(t.x, t.y);
      ev._carDir = pickStartDirection(t.x, t.y);
      ev.setDirection(ev._carDir);
      ev._carStuck = 0;
      return;
    }
  }

  // ==========================================================================
  //  CAR SETUP
  // ==========================================================================

  // Self switch A selects the event's parked page (action button + solid). It is
  // set explicitly for every car on every load, because map 636 is reused for
  // every world cell and self switches persist across those visits.
  function setParkedSelfSwitch(ev, on) {
    const key = [$gameMap.mapId(), ev.eventId(), PARKED_SELF_SWITCH];
    if (!!$gameSelfSwitches.value(key) === !!on) return;
    $gameSelfSwitches.setValue(key, !!on);
  }

  // The page refresh that follows a self-switch change resets through / speed /
  // animation from the page data, so re-apply whatever the car's mode needs.
  function applyCarModeSettings(ev) {
    if (ev._carMode === "driving") {
      ev.setThrough(true);        // needed for player-overlap accidents
      ev.setPriorityType(1);
      ev.setMoveSpeed(drivingSpeedForBiome());
      ev.setMoveFrequency(5);
      ev.setStepAnime(true);
      ev.setOpacity(255);
    } else if (ev._carMode === "parked") {
      ev.setThrough(false);       // parked cars are solid obstacles
      ev.setPriorityType(1);
      ev.setStepAnime(false);
      ev.setOpacity(255);
    } else if (ev._carMode === "hidden") {
      ev.setThrough(true);
      ev.setStepAnime(false);
      ev.setOpacity(0);
    }
  }

  function makeDrivingCar(ev, occupied) {
    ev._carActive = true;
    ev._carMode = "driving";
    ev._carStuck = 0;
    setParkedSelfSwitch(ev, false);
    applyCarModeSettings(ev);
    ev._carLane = null;

    // ROAD BIOME: pin the car to a fixed lane and drop it somewhere along it,
    // so traffic is spread out instead of all entering at the same border.
    if (laneDefs.length > 0) {
      for (let tries = 0; tries < 40; tries++) {
        const li = laneCursor++ % laneDefs.length;
        const len = pathLength(laneDefs[li]);
        const dist = Math.floor(Math.random() * len * 0.9);
        const pt = pointAlongPath(laneDefs[li], dist);
        const key = pt.x + "," + pt.y;
        if (occupied.has(key) || actorAt(pt.x, pt.y, ev)) continue;
        occupied.add(key);
        placeOnLane(ev, li, dist);
        return true;
      }
      return false;
    }

    const pool = roadEdgeTiles.length > 0 ? roadEdgeTiles : roadTiles;
    for (let tries = 0; tries < 60; tries++) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      const key = t.x + "," + t.y;
      if (occupied.has(key) || actorAt(t.x, t.y, ev)) continue;
      occupied.add(key);
      ev.setPosition(t.x, t.y);
      ev._carDir = pickStartDirection(t.x, t.y);
      ev.setDirection(ev._carDir);
      return true;
    }
    return false;
  }

  function makeParkedCar(ev, occupied) {
    // Park on open ground (never on a road tile)
    for (let tries = 0; tries < 200; tries++) {
      const x = Math.floor(Math.random() * gridW);
      const y = Math.floor(Math.random() * gridH);
      const key = x + "," + y;
      if (occupied.has(key)) continue;
      if (!isOpenGround(x, y)) continue;
      if (actorAt(x, y, ev)) continue;
      occupied.add(key);
      ev._carActive = true;
      ev._carMode = "parked";
      ev._carLane = null;
      setParkedSelfSwitch(ev, true);
      applyCarModeSettings(ev);
      ev.setPosition(x, y);
      ev.setDirection([2, 4, 6, 8][Math.floor(Math.random() * 4)]);
      return true;
    }
    return false;
  }

  function hideCar(ev) {
    ev._carActive = false;
    ev._carMode = "hidden";
    ev._carLane = null;
    setParkedSelfSwitch(ev, false);
    applyCarModeSettings(ev);
  }

  // Keep the mode's settings after the page swap a self-switch change triggers.
  const _Game_Event_refresh = Game_Event.prototype.refresh;
  Game_Event.prototype.refresh = function () {
    _Game_Event_refresh.call(this);
    if (this._isRoadCar && this._carMode && $gameMap.mapId() === PROC_MAP_ID) {
      applyCarModeSettings(this);
    }
  };

  // ==========================================================================
  //  PLAYER COLLISION (moving cars only)
  // ==========================================================================

  // Being run over by a stationary vehicle makes no sense: only a MOVING car
  // causes an accident, and only the moving page carries the Player-Touch
  // trigger. A parked car runs its own action-button page (the theft prompt);
  // a hidden car is not there at all and must never run anything.
  const _Game_Event_start = Game_Event.prototype.start;
  Game_Event.prototype.start = function () {
    if (
      this._isRoadCar &&
      $gameMap.mapId() === PROC_MAP_ID &&
      this._carMode !== "driving" &&
      this._carMode !== "parked"
    ) {
      return;
    }
    _Game_Event_start.call(this);
  };

  Game_Event.prototype.performPlayerHit = function () {
    const carDir = this.direction();
    const jumpPower = 3;
    const sway = Math.random() < 0.5 ? 1 : -1;
    let jx = 0;
    let jy = 0;
    switch (carDir) {
      case 2: jy = -jumpPower; jx = sway; break; // car going down -> bounce up
      case 4: jx = jumpPower; jy = sway; break;  // car going left -> bounce right
      case 6: jx = -jumpPower; jy = sway; break; // car going right -> bounce left
      case 8: jy = jumpPower; jx = sway; break;  // car going up -> bounce down
    }
    $gamePlayer.jump(jx, jy);

    if ($gamePlayer.isInShip()) {
      $gameTemp.reserveCommonEvent(168);
    } else if ($gamePlayer.isInBoat()) {
      $gameTemp.reserveCommonEvent(167);
    } else {
      $gameTemp.reserveCommonEvent(163);
    }
  };

  // ==========================================================================
  //  CAR THEFT (parked cars only)
  // ==========================================================================

  // Stolen cars are tracked per world-map cell so a car boosted here does not
  // come back the next time the player walks into the same procedural map.
  function worldCellKey() {
    return $gameVariables.value(VAR_WORLD_X) + "," + $gameVariables.value(VAR_WORLD_Y);
  }

  function stolenCarCount() {
    const record = $gameSystem._roadCarStolen;
    return (record && record[worldCellKey()]) || 0;
  }

  function recordStolenCar() {
    if (!$gameSystem._roadCarStolen) $gameSystem._roadCarStolen = {};
    const key = worldCellKey();
    $gameSystem._roadCarStolen[key] = ($gameSystem._roadCarStolen[key] || 0) + 1;
  }

  function say(text) {
    window.skipLocalization = true;
    $gameMessage.add(text);
    window.skipLocalization = false;
  }

  // Pending theft while the lockpick minigame runs.
  let _pendingCarTheft = null;
  // Car chosen from the "Steal car" prompt, run one frame later (see below).
  let _pendingTheftTarget = null;

  function showCarTheftChoices(car) {
    window.skipLocalization = true;
    $gameMessage.add(T('RoadCar.unattendedCar'));
    $gameMessage.setChoices([T('RoadCar.stealCar'), T('RoadCar.cancel')], 0, 1);
    $gameMessage.setChoiceBackground(0);
    $gameMessage.setChoicePositionType(2);
    window.skipLocalization = false;
    // The choice callback runs immediately before terminateMessage() clears
    // $gameMessage, so anything the theft wants to say would be swallowed.
    // Remember the car instead and act once the prompt has closed.
    $gameMessage.setChoiceCallback((index) => {
      if (index === 0) _pendingTheftTarget = car;
    });
  }

  const _Scene_Map_update_carTheft = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update_carTheft.call(this);
    if (_pendingTheftTarget && !$gameMessage.isBusy()) {
      const car = _pendingTheftTarget;
      _pendingTheftTarget = null;
      attemptCarTheft(car);
    }
  };

  function attemptCarTheft(car) {
    // A skeleton key opens any lock without the minigame (same rule as doors).
    const skeleton = $dataItems[SKELETON_KEY_ITEM_ID];
    if (skeleton && $gameParty.hasItem(skeleton)) {
      $gameParty.loseItem(skeleton, 1);
      say(T('RoadCar.usedSkeletonKey'));
      completeCarTheft({ mapId: $gameMap.mapId(), eventId: car.eventId() });
      return;
    }

    const lockpick = $dataItems[LOCKPICK_ITEM_ID];
    if (!lockpick || !$gameParty.hasItem(lockpick)) {
      say(T('RoadCar.needLockpick'));
      return;
    }

    if (typeof LockpickTetris === "undefined" || typeof Scene_LockpickTetris === "undefined") {
      say(T('RoadCar.lockStuck'));
      return;
    }

    _pendingCarTheft = { mapId: $gameMap.mapId(), eventId: car.eventId() };
    hookLockpickForCarTheft();
    // Car locks are a touch harder than house doors.
    const difficulty = 4 + Math.floor(Math.random() * 5); // 4..8
    LockpickTetris.start(difficulty, 0, 0, "", "", "none");
  }

  // Mirrors ProceduralHouseSystem: wrap popScene once to resolve the pending
  // theft when the minigame ends. The minigame already eats the lockpick on a
  // failure; the crime is deferred to Scene_Map.start (LockpickTetris consumes
  // pendingCrimeKey there) so the notification lands on the map, not the scene
  // being popped.
  function hookLockpickForCarTheft() {
    if (Scene_LockpickTetris._carTheftHooked) return;
    Scene_LockpickTetris._carTheftHooked = true;
    const _popScene = Scene_LockpickTetris.prototype.popScene;
    Scene_LockpickTetris.prototype.popScene = function () {
      if (_pendingCarTheft) {
        const pending = _pendingCarTheft;
        _pendingCarTheft = null;
        if (this.success) {
          completeCarTheft(pending);
        } else if (typeof LockpickTetris !== "undefined") {
          LockpickTetris.pendingCrimeKey = "vehicleTheft";
        }
      }
      _popScene.call(this);
    };
  }

  // Success: the keys go to the party and the car leaves the world for good.
  function completeCarTheft(pending) {
    const car = $gameMap.mapId() === pending.mapId ? $gameMap.event(pending.eventId) : null;
    if (car) {
      car._carActive = false;
      car._carMode = "hidden";
      setParkedSelfSwitch(car, false);
      car.setThrough(true);
      car.erase();
    }
    recordStolenCar();

    const keys = $dataItems[CAR_KEYS_ITEM_ID];
    if (keys) {
      $gameParty.gainItem(keys, 1);
      AudioManager.playSe({ name: "lock_01", volume: 100, pitch: 100, pan: 0 });
      say(T('RoadCar.hotwired', { icon: keys.iconIndex, item: keys.name }));
    }
  }

  // The parked page of a Car event calls this; the moving and hidden pages never
  // run, so the prompt only ever appears for a car that is actually parked.
  const stealParkedCar = function () {
    if (_pendingTheftTarget || _pendingCarTheft) return;
    const self = this && this.character ? this.character(0) : null;
    const car =
      self && self._isRoadCar && self._carMode === "parked" ? self : parkedCarFacing();
    if (car) showCarTheftChoices(car);
  };
  PluginManager.registerCommand(PLUGIN_NAME, "StealParkedCar", stealParkedCar);
  PluginManager.registerCommand("Vehicle/" + PLUGIN_NAME, "StealParkedCar", stealParkedCar);

  // ==========================================================================
  //  CORE UPDATE OVERRIDE
  // ==========================================================================

  const _Game_Event_initialize = Game_Event.prototype.initialize;
  Game_Event.prototype.initialize = function (mapId, eventId) {
    _Game_Event_initialize.call(this, mapId, eventId);
    this._isRoadCar = this.event() && this.event().name === "Car";  // i18n-ignore  event name
  };

  const _Game_Event_update = Game_Event.prototype.update;
  Game_Event.prototype.update = function () {
    _Game_Event_update.call(this);

    if (!this._isRoadCar || $gameMap.mapId() !== PROC_MAP_ID) return;
    if (this._carActive === false) return;
    if (this._carMode === "parked") return;
    if (this._carMode !== "driving") return;

    // Accident: the moving car's bodywork is over the player. The player cannot
    // walk into it (the footprint blocks them), so this only fires when a car has
    // driven over someone standing still. The bodywork is several tiles wide and
    // the bounce can land inside it again, so a hit is followed by a short grace
    // period rather than a pile-up of accidents.
    if (
      !$gamePlayer.isJumping() &&
      Graphics.frameCount - lastHitFrame > HIT_GRACE_FRAMES &&
      carCovers(this, $gamePlayer.x, $gamePlayer.y)
    ) {
      lastHitFrame = Graphics.frameCount;
      this.performPlayerHit();
      return;
    }

    if (this.isMoving()) return; // wait for the current tile step to finish

    // ROAD BIOME: strictly follow the assigned hardcoded lane.
    if (this._carLane != null) {
      updateLaneCar(this);
      return;
    }

    // CITY / VILLAGE: free-roaming road-follower.
    const dir = chooseCarDirection(this);

    // Dead end -> recycle to a fresh border spawn instead of reversing/circling
    if (dir === RESPAWN) {
      respawnDrivingCar(this);
      return;
    }

    if (dir === null) {
      // Boxed in by actors / obstacles -> wait, and respawn if stuck too long
      this._carStuck = (this._carStuck || 0) + 1;
      if (this._carStuck > STUCK_LIMIT) respawnDrivingCar(this);
      return;
    }

    // Reached the map border and driving out of it -> the car has left the map,
    // respawn it at another border road tile (it "arrived" at its destination).
    const tx = this.x + dxOf(dir);
    const ty = this.y + dyOf(dir);
    if (!inBounds(tx, ty)) {
      respawnDrivingCar(this);
      return;
    }

    this._carStuck = 0;
    this._carDir = dir;
    this.setDirection(dir);
    this.moveStraight(dir);
  };

  // ==========================================================================
  //  INITIALIZATION
  // ==========================================================================

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function () {
    _Scene_Map_onMapLoaded.call(this);
    if ($gameMap.mapId() === PROC_MAP_ID) {
      this.initializeRoadCars();
    }
  };

  Scene_Map.prototype.initializeRoadCars = function () {
    const biomeName = $gameSystem._procGenData?.currentBiome || "";
    biomeCategory = classifyBiome(biomeName);

    const cars = $gameMap.events().filter((e) => e && e.event() && e.event().name === "Car");  // i18n-ignore  event name
    carEvents = cars;
    registerCarFootprints();
    if (cars.length === 0) return;

    // Biomes without traffic: remove all cars
    if (biomeCategory === "none") {
      cars.forEach((e) => {
        e._carActive = false;
        e._carMode = "hidden";
        setParkedSelfSwitch(e, false);
        e.erase();
      });
      dlog("[RoadCarAI] No traffic for biome:", biomeName);
      return;
    }

    buildRoadGrid();

    // If a road biome somehow produced no road tiles, bail out gracefully
    if (biomeCategory !== "village" && roadTiles.length === 0) {
      cars.forEach((e) => hideCar(e));
      dwarn("[RoadCarAI] No road tiles detected for:", biomeName);
      return;
    }

    // Road biomes drive on hardcoded lanes; cities/villages roam freely.
    laneDefs = [];
    laneCursor = 0;
    if (biomeCategory === "road") {
      buildRoadLanes();
      if (laneDefs.length === 0) {
        dwarn("[RoadCarAI] No valid lanes; falling back to free road-following.");
      }
    }

    const plan = getCarPlan();
    const occupied = new Set();
    let parkedDone = 0;
    let drivingDone = 0;

    cars.forEach((ev) => {
      // A car erased on a previous visit to this cell has no page: bring it back
      // before deciding what it does here.
      if (ev._erased) {
        ev._erased = false;
        ev.refresh();
      }
      if (parkedDone < plan.parked && makeParkedCar(ev, occupied)) {
        parkedDone++;
      } else if (drivingDone < plan.driving && roadTiles.length > 0 && makeDrivingCar(ev, occupied)) {
        drivingDone++;
      } else {
        hideCar(ev);
      }
    });

    dlog(
      `[RoadCarAI] ${biomeCategory}: ${drivingDone} driving, ${parkedDone} parked (${roadTiles.length} road tiles).`
    );
  };
})();
