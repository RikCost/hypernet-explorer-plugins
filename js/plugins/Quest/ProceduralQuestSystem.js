/*:
 * @target MZ
 * @plugindesc v1.1.0 Daggerfall-style procedural quest engine (multi-step, factions, deadlines). Exposes window.ProceduralQuests. [Claude]
 * @author Hypernet
 *
 * @help ProceduralQuestSystem.js
 *
 * Generates, tracks, completes and fails procedural quests automatically,
 * reusing existing game systems. No event scripting is needed: put a quest
 * board somewhere (QuestBoardUI's openQuestBoard command) and everything
 * else, offers, deadlines, site spawning, rewards, reputation, journal and
 * toasts, is handled by this engine.
 *
 * Architecture: every quest is a list of STEPS. Single-objective quests have
 * one step; chain archetypes have 2-3 steps completed sequentially ("seq")
 * or in any order ("par"). Step kinds are detection primitives wired into
 * the rest of the game:
 *
 *   goto_site      arrive at world coordinates (proc map 636, vars 43/44)
 *   goto_dest      arrive in a destination's map group (MapGroups.json)
 *   cache / dig    open an auto-spawned chest / dig site (dig needs Shovel)
 *   planet_cache   land on a GalaxySim planet and open the sample cache
 *   bounty         kill a specific high-level enemy force-spawned at a tile
 *                  (persists until killed even if the quest fails)
 *   statues/signs  scan N Statue / SignPost features at a site
 *   clearing       actually dismantle N Tree/Rock/Rubble features at a site
 *   deliver_board  open the quest board of a destination
 *   interview      Empathize with any citizen of a destination
 *   supply_items   hand over N items at claim time
 *   wait_delivery  goods arrive after a timer (procurement, scam bait)
 *   arena_wins     raise the arena win counter (Variable 22)
 *   cull_kills     defeat N enemies in any battles
 *   market_shares  hold N oil shares (Variable 51)
 *
 * All reward and difficulty scaling uses the PARTY MEDIAN LEVEL.
 * Every contract's terms (advance, deadline, penalty, breach bounty,
 * faction effects) are generated with the offer and disclosed before
 * acceptance. Scams lie.
 *
 * @command openQuestBoard
 * @text Open Quest Board
 * @desc Opens the quest board for the current location (QuestBoardUI's scene).
 *
 * @arg boardKey
 * @text Board Key (optional)
 * @desc Override the auto-detected location key (e.g. a Destinations.json name).
 * @type string
 * @default
 *
 * @command debugGenerateQuest
 * @text Generate Procedural Quest (debug)
 * @desc Instantly generates and accepts a random procedural quest.
 */

(() => {
  "use strict";

  const PLUGIN = "ProceduralQuestSystem";
  const PROC_MAP_ID = 636;
  const PLANET_COORD = 100000;
  const SHOVEL_ITEM_ID = 138;
  const MATERIAL_IDS_START = 849;
  const MATERIAL_IDS_END = 871;
  const ARENA_WINS_VAR = 22;
  const OIL_SHARES_VAR = 51;
  const WORLD_MAP_ID = 315;
  const WORLD_SIZE = 256;  // map 315 is 256x256 world tiles
  const NEAR_TILES = 5;    // a site this close to a destination is "near" it

  // ==========================================================================
  // Seeded RNG + tiny helpers
  // ==========================================================================
  function hashStr(s) {
    let h = 0x811c9dc5;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function worldSeed() {
    const s = window.ProcGenUtils?.getWorldSeed?.()
      ?? window.HistoryManager?.getSeed?.() ?? 19002001;
    return (typeof s === "number") ? (s >>> 0) : hashStr(s);
  }

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function irange(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function chance(rng, p) { return rng() < p; }

  // "GreenWitch Space Center" and "GreenWitchSpaceCenter" must compare equal.
  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function euros(gold) { return (gold / 100).toFixed(2) + "€"; }

  // ==========================================================================
  // Time helpers (TimeDateSystem, Variable 114 game-minute clock)
  // ==========================================================================
  function nowMinutes() {
    return window.TimeDateSystem?.getGameTimeMinutes?.()
      ?? ($gameVariables ? $gameVariables.value(114) : 0);
  }

  // ---------------------------------------------------------------------------
  // Empty world (WorldManager.populationMode). The notices on a board were
  // pinned up by people, and those people are dead. They are still there, still
  // readable, and can still be taken on , the target really does spawn , but
  // nobody is waiting to be told it is done, so a quest taken in an empty world
  // can never be handed in. See emptyWorldNote / blockedByEmptyWorld below.
  function isEmptyWorld() {
    const WM = window.WorldManager;
    return !!(WM && typeof WM.isEmptyWorld === "function" && WM.isEmptyWorld());
  }

  // Boards do not rotate in an empty world: nobody takes the old notices down
  // and nobody pins new ones up, so every board shows the same weathered set
  // for ever. A constant day is what freezes it, since the day is the board's
  // whole seed.
  const EMPTY_WORLD_BOARD_DAY = 0;
  function dayIndex() {
    if (isEmptyWorld()) return EMPTY_WORLD_BOARD_DAY;
    return Math.floor(nowMinutes() / 1440);
  }

  function hoursLeftText(deadlineAt) {
    const mins = deadlineAt - nowMinutes();
    if (mins <= 0) return T('Quests.expired');
    const h = Math.floor(mins / 60);
    if (h >= 48) return Math.floor(h / 24) + T('Quests.days');
    return h + "h";
  }

  function deadlineStamp(deadlineAt) {
    const dt = window.TimeDateSystem?.getDateTimeFromMinutes?.(deadlineAt);
    return dt?.fullDate || (hoursLeftText(deadlineAt) + " " + T('Quests.fromNow'));
  }

  // ==========================================================================
  // Party median level (ALWAYS used for reward / difficulty scaling)
  // ==========================================================================
  function medianLevel() {
    const lv = $gameParty.members().map(a => a.level).sort((a, b) => a - b);
    if (!lv.length) return 1;
    const mid = Math.floor(lv.length / 2);
    return (lv.length % 2) ? lv[mid] : Math.floor((lv[mid - 1] + lv[mid]) / 2);
  }

  // ==========================================================================
  // World data access
  // ==========================================================================
  function destinations() {
    const d = window.WorkSystem?.Destinations;
    return (d && typeof d === "object") ? d : null;
  }

  // Places are named to the player by the "name" field of their Destinations.json
  // entry ("GreenWitch" -> "Green Witch"); every comparison in this plugin is
  // normalized (norm()), so a notice, a step and a board key still recognise one
  // another whichever spelling of a place they were written with.
  function destinationNames() {
    const d = destinations();
    if (!d) return [];
    return window.WorkSystem?.destinationNames
      ? window.WorkSystem.destinationNames() : Object.keys(d);
  }

  // A destination entry by any spelling of its name: the file key, the readable
  // name, or that name as the current language says it (which is what a quest
  // written in that language stored).
  function destEntry(name) {
    const d = destinations();
    if (!d || !name) return null;
    if (d[name]) return d[name];
    const n = norm(name);
    const spoken = window.WorkSystem?.destinationName;
    for (const [key, entry] of Object.entries(d)) {
      if (norm(key) === n || norm(entry?.name || key) === n) return entry;
      if (spoken && norm(spoken(key)) === n) return entry;
    }
    return null;
  }

  function groupOfMap(mapId) {
    const groups = window.WorldGen?.MapGroups;
    if (!groups) return null;
    for (const [name, g] of Object.entries(groups)) {
      if (g && Array.isArray(g.maps) && g.maps.includes(mapId)) return name;
    }
    return null;
  }

  // Where a quest board opened right now "is". Used as the offer seed key and
  // for courier arrival matching.
  //
  // Every notice board on a map is THE board of that place: the key is derived
  // from the map (its MapGroups group, or the world coordinate on the procedural
  // map), never from the event that opened it, so two boards nailed up in the
  // same town always show the same seeded set of offers. The cache also keeps
  // the string byte-identical for the whole visit, since it is a seed input.
  let _boardKeyCacheMapId = -1;
  let _boardKeyCache = null;

  function currentBoardKey() {
    if (!$gameMap) return "Nowhere"; // i18n-ignore: board record key
    const mapId = $gameMap.mapId();
    if (mapId === PROC_MAP_ID) {
      // World coordinates change without a map reload out here, so no cache.
      return "Proc:" + $gameVariables.value(43) + "," + $gameVariables.value(44);
    }
    if (_boardKeyCacheMapId === mapId && _boardKeyCache) return _boardKeyCache;
    const g = groupOfMap(mapId);
    const info = window.$dataMapInfos?.[mapId];
    _boardKeyCache = g || ((info && info.name) ? info.name : ("Map" + mapId)); // i18n-ignore: board record key
    _boardKeyCacheMapId = mapId;
    return _boardKeyCache;
  }

  // Is `name` a real place (a map group or a travel destination) rather than an
  // event author's private label for one signboard?
  function isKnownPlace(name) {
    const n = norm(name);
    if (!n) return false;
    const groups = window.WorldGen?.MapGroups;
    if (groups) {
      for (const g of Object.keys(groups)) if (norm(g) === n) return true;
    }
    for (const d of destinationNames()) if (norm(d) === n) return true;
    return false;
  }

  // Collapse spelling variants onto the canonical spelling ("GreenWitch Space
  // Center" and "GreenWitchSpaceCenter" are one place, and one seed).
  function canonicalPlaceName(name) {
    const n = norm(name);
    if (!n) return null;
    const groups = window.WorldGen?.MapGroups;
    if (groups) {
      for (const g of Object.keys(groups)) if (norm(g) === n) return g;
    }
    for (const d of destinationNames()) if (norm(d) === n) return d;
    return String(name).trim();
  }

  // ==========================================================================
  // Reachability
  //
  // A contract is only worth posting if the party can finish it. Two things are
  // easy to get wrong: a delivery to a board that does not exist, and travelling
  // to a place the engine cannot recognise you have reached.
  // ==========================================================================

  // Boards the party has actually opened, so a courier job can only ever be sent
  // somewhere they have already been. World-shared through $gameSystem.
  function knownBoards() {
    if (!$gameSystem._pqKnownBoards) $gameSystem._pqKnownBoards = {};
    return $gameSystem._pqKnownBoards;
  }

  function rememberBoard(key) {
    if (!key) return;
    const store = knownBoards();
    if (!store[key]) store[key] = nowMinutes();
  }

  // Only real places make sensible delivery targets: "the board of Ghent" reads,
  // "the board of 1390 - Inn" does not.
  function pickKnownBoard(rng, hereKey) {
    const here = norm(hereKey);
    const options = Object.keys(knownBoards())
      .filter(k => norm(k) !== here && isKnownPlace(k));
    return options.length ? pick(rng, canonicalSort(options)) : null;
  }

  // Stable order so the pick is reproducible from the seed regardless of the
  // insertion order of the party's travels.
  function canonicalSort(list) {
    return list.slice().sort();
  }

  // Is the party at `place` right now? Arrival is recognised through every
  // identity a map can have: its MapGroups group, its own name, a transport
  // arrival map from Destinations.json, or (for the many destinations that are
  // only a world coordinate) standing on that coordinate.
  const ARRIVAL_TILES = 1;

  function destTransportMapIds(name) {
    const entry = destEntry(name);
    if (!entry) return [];
    const out = [];
    for (const key of ["train", "bus", "helicopter"]) {
      const t = entry[key];
      if (t && t.mapId) out.push(t.mapId);
    }
    return out;
  }

  function placeMatchesHere(place) {
    if (!place || !$gameMap) return false;
    const target = norm(place);
    if (!target) return false;
    const mapId = $gameMap.mapId();

    const g = groupOfMap(mapId);
    if (g && norm(g) === target) return true;

    const info = window.$dataMapInfos?.[mapId];
    if (info && info.name && norm(info.name) === target) return true;

    if (destTransportMapIds(place).includes(mapId)) return true;

    // Coordinate-only destinations: arriving means standing on their world tile.
    const c = destCoords(place);
    if (c) {
      let wx = null, wy = null;
      if (mapId === WORLD_MAP_ID) { wx = $gamePlayer.x; wy = $gamePlayer.y; }
      else if (mapId === PROC_MAP_ID) { wx = $gameVariables.value(43); wy = $gameVariables.value(44); }
      if (wx != null && Math.abs(wx - c.wx) <= ARRIVAL_TILES && Math.abs(wy - c.wy) <= ARRIVAL_TILES) {
        return true;
      }
    }
    return false;
  }

  // The key a board being opened should actually use. An override is honoured
  // only when it names another real place (a station kiosk showing the board of
  // the town down the line); anything else, including a per-event label or a
  // differently spelled version of where we already are, resolves back to this
  // map's single board.
  function resolveBoardKey(requested) {
    const here = currentBoardKey();
    if (!requested) return here;
    const canon = canonicalPlaceName(requested);
    if (!canon || norm(canon) === norm(here)) return here;
    return isKnownPlace(canon) ? canon : here;
  }

  function factionName(id) {
    if (id == null) return null;
    try {
      const f = $gameFactions?.getFaction?.(id);
      const inst = window.FactionDataManager?.instance;
      if (f && inst && typeof inst.t === "function") return inst.t(f.name);
      return f ? String(f.name) : null;
    } catch (e) { return null; }
  }

  // A rival of `giver` (relationship < 0), or null.
  function pickRivalFaction(rng, giver) {
    try {
      const all = $gameFactions?.getAllFactions?.() || [];
      const rivals = [];
      for (let i = 0; i < all.length; i++) {
        if (i === giver) continue;
        if ($gameFactions.getRelationship(giver, i) < 0) rivals.push(i);
      }
      return rivals.length ? pick(rng, rivals) : null;
    } catch (e) { return null; }
  }

  // Single-enemy troop convention: $dataTroops[id].members[0].enemyId === id.
  let _enemyRoster = null;
  function enemyRoster() {
    if (_enemyRoster) return _enemyRoster;
    _enemyRoster = [];
    if (!window.$dataEnemies || !window.$dataTroops) return _enemyRoster;
    for (let id = 1; id < $dataEnemies.length; id++) {
      const e = $dataEnemies[id];
      if (!e || !e.name) continue;
      const t = $dataTroops[id];
      if (!t || t.members.length !== 1 || t.members[0].enemyId !== id) continue;
      const m = e.note && e.note.match(/<Level:\s*(\d+)>/i);
      const level = m ? Number(m[1]) : 0;
      if (level <= 0) continue;
      if (e.note && e.note.includes("<Boss>")) continue;
      _enemyRoster.push({
        id, name: e.name, level,
        canTalk: !!(e.note && e.note.includes("<Talk>")),
      });
    }
    return _enemyRoster;
  }

  // High-level target relative to the party median: L+2 .. L+8+diff*3.
  // Criminal hunts want <Talk> (CanTalk) enemies, monster hunts want the rest.
  function pickBountyEnemy(rng, L, diff, wantCriminal) {
    const roster = enemyRoster().filter(e => e.canTalk === wantCriminal);
    if (!roster.length) return null;
    const lo = L + 2, hi = L + 8 + diff * 3;
    let band = roster.filter(e => e.level >= lo && e.level <= hi);
    if (!band.length) {
      band = roster.filter(e => e.level > L);
      if (!band.length) band = roster.slice();
      band.sort((a, b) => Math.abs(a.level - hi) - Math.abs(b.level - hi));
      band = band.slice(0, 12);
    }
    return pick(rng, band);
  }

  // ==========================================================================
  // Reward ladder
  //
  // The star count on a notice IS its pay grade, in euros:
  //   1 star  1-99      3 stars   400-1200     5 stars  4000-12000
  //   2 stars 100-400   4 stars  1200-4000
  // Within a band the party's level slides the figure up and the archetype's own
  // multiplier survives as a lean, so a smuggling run still pays better than a
  // survey at the same star rating.
  // ==========================================================================
  const REWARD_BANDS = {
    1: [1, 99],
    2: [100, 400],
    3: [400, 1200],
    4: [1200, 4000],
    5: [4000, 12000],
  };

  function fitRewardToBand(rawGold, diff, L, rng) {
    const band = REWARD_BANDS[diff] || REWARD_BANDS[1];
    const loG = band[0] * 100, hiG = band[1] * 100;
    const baseline = 1500 * (1 + 0.30 * L);
    const lean = Math.max(0.55, Math.min(1.5, (rawGold || baseline) / baseline));
    const t = Math.max(0, Math.min(1, (L - 1) / 60));
    const center = loG + (hiG - loG) * (0.2 + 0.55 * t);
    const jitter = (rng() * 2 - 1) * (hiG - loG) * 0.08;
    const v = center * lean + jitter;
    return Math.round(Math.max(loG, Math.min(hiG, v)) / 10) * 10;
  }

  // Elite hunts fight things far above the party. Unlike the ordinary bounty
  // roster this one keeps bosses and ignores <Talk>, because nothing at level 200
  // is going to be talked to.
  let _eliteRoster = null;
  function eliteRoster() {
    if (_eliteRoster) return _eliteRoster;
    _eliteRoster = [];
    if (!window.$dataEnemies || !window.$dataTroops) return _eliteRoster;
    for (let id = 1; id < $dataEnemies.length; id++) {
      const e = $dataEnemies[id];
      if (!e || !e.name) continue;
      const t = $dataTroops[id];
      if (!t || t.members.length !== 1 || t.members[0].enemyId !== id) continue;
      const m = e.note && e.note.match(/<Level:\s*(\d+)>/i);
      const level = m ? Number(m[1]) : 0;
      if (level < 60) continue;
      _eliteRoster.push({
        id, name: e.name, level,
        boss: !!(e.note && e.note.includes("<Boss>")),
      });
    }
    return _eliteRoster;
  }

  function pickEliteEnemy(rng, loLv, hiLv) {
    const roster = eliteRoster();
    if (!roster.length) return null;
    let band = roster.filter(e => e.level >= loLv && e.level <= hiLv);
    if (!band.length) {
      // Nearest available to the middle of the requested band.
      const mid = (loLv + hiLv) / 2;
      band = roster.slice().sort((a, b) => Math.abs(a.level - mid) - Math.abs(b.level - mid)).slice(0, 10);
    }
    return pick(rng, band);
  }

  // Only <Talk> enemies can be recruited at all (EnemyTalkSystem), and taming is
  // easier the closer the target is to the party, so a pet contract asks for
  // something around or just below the party's level.
  function pickPetTarget(rng, L, diff) {
    const roster = enemyRoster().filter(e => e.canTalk);
    if (!roster.length) return null;
    const lo = Math.max(1, L - 6), hi = L + 2 + diff;
    let band = roster.filter(e => e.level >= lo && e.level <= hi);
    if (!band.length) {
      band = roster.slice().sort((a, b) => Math.abs(a.level - L) - Math.abs(b.level - L)).slice(0, 12);
    }
    return pick(rng, band);
  }

  function materialItems() {
    const out = [];
    for (let id = MATERIAL_IDS_START; id <= MATERIAL_IDS_END; id++) {
      const it = window.$dataItems?.[id];
      if (it && it.name) out.push(it);
    }
    return out;
  }

  let _foodItems = null;
  function foodItems() {
    if (_foodItems) return _foodItems;
    _foodItems = [];
    if (window.$dataItems) {
      for (const it of $dataItems) {
        if (!it || !it.name || !it.meta) continue;
        if (String(it.meta.Category || "").toLowerCase() === "food") _foodItems.push(it);
      }
    }
    return _foodItems;
  }

  // A weapon or armor whose price roughly matches the party median level.
  function pickGearReward(rng, L, rare) {
    const mult = rare ? 3 : 1;
    const lo = L * 60 * mult, hi = (L * 200 + 800) * mult;
    const pool = [];
    const scan = (arr, kind) => {
      if (!arr) return;
      for (const o of arr) {
        if (!o || !o.name || o.price == null) continue;
        if (o.name.startsWith("Empty ")) continue; // i18n-ignore: procedural template sentinel
        if (o.price >= lo && o.price <= hi) pool.push({ kind, id: o.id });
      }
    };
    scan(window.$dataWeapons, "w");
    scan(window.$dataArmors, "a");
    return pool.length ? pick(rng, pool) : null;
  }

  function gearObject(ref) {
    if (!ref) return null;
    return ref.kind === "w" ? $dataWeapons[ref.id]
      : ref.kind === "a" ? $dataArmors[ref.id] : $dataItems[ref.id];
  }

  // Anchor coordinate sites near known destinations so "go to (x,y)" is always
  // a reachable spot on the world map (map 315 coordinate space, vars 43/44).
  // A destination's `base` is its world-map tile; `mapOffset` is a pixel
  // position on the 1232x1039 travel picture (roughly 4.8px per tile) and would
  // land every site far outside the 256x256 world map.
  // Open water cannot be walked to, so a site that rolls onto it is rerolled.
  const WATER_BIOMES = ["Ocean", "SeaBed", "Lake"]; // i18n-ignore: Biomes.json ids

  function isWaterSite(wx, wy) {
    try {
      const U = window.ProcGenUtils;
      const cache = $gameSystem && $gameSystem._procGenData
        ? $gameSystem._procGenData.biomeCoordinateCache : null;
      if (!U || !cache || typeof U.getBiomeFromCacheWithFallback !== "function") return false;
      const b = U.getBiomeFromCacheWithFallback(cache, wx, wy, $gameMap, WORLD_MAP_ID);
      return !!b && WATER_BIOMES.includes(b);
    } catch (e) { return false; }
  }

  function pickSiteCoords(rng) {
    const d = destinations();
    const bases = d ? Object.values(d).filter(v => v && v.base && (v.base.x || v.base.y)) : [];
    const clamp = (v) => Math.max(4, Math.min(WORLD_SIZE - 5, v));
    const off = () => (chance(rng, 0.5) ? 1 : -1) * irange(rng, 2, 6);
    let fallback = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      // Bologna is the fallback anchor: inland, mid-map, always valid.
      const a = bases.length ? pick(rng, bases).base : { x: 124, y: 168 };
      const site = { wx: clamp(a.x + off()), wy: clamp(a.y + off()) };
      if (!fallback) fallback = site;
      if (!isWaterSite(site.wx, site.wy)) return site;
    }
    return fallback;
  }

  // The world-map tile of a named destination (Destinations.json `base`), used to
  // pin destination-shaped objectives on the map alongside coordinate sites.
  function destCoords(name) {
    const entry = destEntry(name);
    const b = entry && entry.base;
    if (!b || (!b.x && !b.y)) return null;
    if (b.x < 0 || b.y < 0 || b.x >= WORLD_SIZE || b.y >= WORLD_SIZE) return null;
    return { wx: b.x, wy: b.y };
  }

  // ==========================================================================
  // Place names for world coordinates
  //
  // The world map paints one region id per country (Countries.json), so any
  // coordinate can name the country that owns it. When a known destination sits
  // within NEAR_TILES of the coordinate the text names it too, so a contract
  // reads "(124, 168), in Italy near Bologna" instead of bare numbers.
  // ==========================================================================
  function countryNameAt(wx, wy) {
    const c = $gameSystem?.getCountryFromWorldCoordinates?.(wx, wy);
    return (c && c.country) ? c.country : null;
  }

  function nearestDestination(wx, wy) {
    const d = destinations();
    if (!d) return null;
    let best = null;
    let bestDist = Infinity;
    for (const [name, v] of Object.entries(d)) {
      if (!v || !v.base) continue;
      const dx = v.base.x - wx;
      const dy = v.base.y - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= NEAR_TILES && dist < bestDist) {
        // "near Green Witch", not "near GreenWitch".
        best = v.name || name;
        bestDist = dist;
      }
    }
    return best;
  }

  // ", in Italy near Bologna" - either half may be missing (open sea, unpainted
  // region, nothing settled within reach), and the whole suffix may be empty.
  function sitePlace(wx, wy) {
    const parts = [];
    const country = countryNameAt(wx, wy);
    const near = nearestDestination(wx, wy);
    if (country) parts.push(T('Quests.in') + country);
    if (near) parts.push(T('Quests.near') + near);
    return parts.length ? ", " + parts.join(" ") : "";
  }

  // "(124, 168), in Italy near Bologna" - how every quest text prints a site.
  function siteText(site) {
    if (!site) return "";
    return "(" + site.wx + ", " + site.wy + ")" + sitePlace(site.wx, site.wy);
  }

  // Annotate the coordinate pair a quest body prints, without every archetype
  // template needing its own slot: after expansion the pair is the literal
  // "(x, y)", so the place suffix is spliced in after the first occurrence.
  function annotateSite(text, ctx) {
    if (!text || !ctx || ctx.X == null || ctx.Y == null) return text;
    const place = sitePlace(ctx.X, ctx.Y);
    if (!place) return text;
    const pair = "(" + ctx.X + ", " + ctx.Y + ")";
    const at = text.indexOf(pair);
    if (at < 0) return text;
    const head = text.slice(0, at + pair.length);
    const rest = text.slice(at + pair.length);
    // Close the appositive when the sentence carries on ("the ground at (124,
    // 168), in Italy near Bologna, is softer than it should be"), but never
    // double a comma or push one in front of a full stop.
    const suffix = /^\s*[.,;:!?)]/.test(rest) ? place : place + ",";
    return head + suffix + rest;
  }

  function pickPlanetTarget(rng) {
    const dm = $gameSystem?.starMapData;
    if (!dm || typeof dm.getAllSystems !== "function") return null;
    try {
      const current = dm.playerShip?.currentSystem;
      let systems = [];
      if (current && chance(rng, 0.6)) {
        const s = dm.getSystem(current);
        if (s && s.planets && s.planets.length) systems = [s];
      }
      if (!systems.length) {
        systems = dm.getAllSystems().filter(s => s && s.planets && s.planets.length).slice(0, 60);
      }
      if (!systems.length) return null;
      const sys = pick(rng, systems);
      const planet = pick(rng, sys.planets);
      if (!planet || !planet.name) return null;
      return { system: sys.name, planet: planet.name };
    } catch (e) { return null; }
  }

  // ==========================================================================
  // Lore grammar (docs/Lore.odt). {a|b|c} alternation + [SLOT] substitution.
  // ==========================================================================
  // Bodies are composed out of several banks before expansion (opener +
  // archetype template + caveat + lore colour + signoff), each of which carries
  // its own nested alternations, so the guard has to be generous.
  function expand(rng, template, ctx) {
    let s = template;
    for (let guard = 0; guard < 160; guard++) {
      const m = s.match(/\{([^{}]*)\}/);
      if (!m) break;
      const opts = m[1].split("|");
      s = s.slice(0, m.index) + pick(rng, opts) + s.slice(m.index + m[0].length);
    }
    s = s.replace(/\[(\w+)\]/g, (_, k) => (ctx && ctx[k] != null) ? String(ctx[k]) : "");
    return s.replace(/\s+/g, " ").trim();
  }

  // The prose below lives in js/i18n/<lang>/conversations/. The banks are lazy
  // views onto those files, re-resolved when the language changes, so nothing
  // is frozen at load time and this file holds keys rather than words.
  let _questBankLang = null;
  const _questBankCache = new Map();
  function questBank(key) {
      const lang = T.language();
      if (lang !== _questBankLang) { _questBankLang = lang; _questBankCache.clear(); }
      if (!_questBankCache.has(key)) _questBankCache.set(key, T.obj(key));
      return _questBankCache.get(key);
  }

  const NEUTRAL_GIVERS = () => questBank('QuestNotices.neutralGivers');

  const SCAM_GIVERS = () => questBank('QuestNotices.scamGivers');

  const LORE_COLOR = () => questBank('QuestNotices.loreColor');

  // Composable sentence banks. A body is assembled as
  //   [opener] + archetype template + [caveat] + [lore colour] + [signoff]
  // with each optional part rolled per offer, then expanded as one template, so
  // even a single archetype reads differently every time it is posted.
  //
  // These are the NEUTRAL banks, used for anonymous posters. A faction or a named
  // NPC replaces them with its own voice (see VOICE_FAMILIES / FACTION_VOICES /
  // PERSONALITY_VOICES below), so who is hiring changes how the notice sounds.
  const OPENERS = () => questBank('QuestNotices.openers');

  const CAVEATS = () => questBank('QuestNotices.caveats');

  const SIGNOFFS = () => questBank('QuestNotices.signoffs');

  // How a faction phrases its own name on a poster. [FACTION] is the plain name.
  const GIVER_ROLES = () => questBank('QuestNotices.giverRoles');

  // ==========================================================================
  // VOICES: who is hiring decides how the notice sounds
  //
  // Three layers, most specific first:
  //   PERSONALITY_VOICES  a named NPC posted it, and speaks in character
  //   FACTION_VOICES      a faction posted it (per-faction lines + a family)
  //   VOICE_FAMILIES      the register that faction belongs to
  //   OPENERS/CAVEATS/SIGNOFFS  anonymous poster, the neutral banks above
  //
  // A voice supplies opener / caveat / signoff banks and optionally a `transform`
  // that rewrites the finished text (goblinese, redaction, divine shouting), plus
  // `titlePrefix` stamps that mark the notice at a glance.
  // ==========================================================================
  const VOICE_FAMILIES = () => questBank('QuestNotices.voiceFamilies');

  // Per faction: which register it speaks in, plus lines only it would write.
  // Every id in Factions.json is covered, so no faction ever falls back to the
  // anonymous banks. Keys are Factions.json ids.
  const FACTION_VOICES = () => questBank('QuestNotices.factionVoices');

  // ==========================================================================
  // Elite contracts (four and five stars)
  //
  // These are the notices a faction only writes when it has run out of its own
  // people. Every faction gets its own line so the standing five-star contract on
  // a board reads unmistakably as theirs; the register supplies the rest.
  // ==========================================================================
  const ELITE_FAMILY = () => questBank('QuestNotices.eliteFamily');

  // One bespoke line per faction, keyed by Factions.json id.
  const ELITE_BY_FACTION = () => questBank('QuestNotices.eliteByFaction');

  // Named individuals speak in their PersonalityData personality, not in an
  // institutional register. One bank per personality in js/db/Health/
  // PersonalityData.json (25 of them), so a Grumpy butcher and a Nervous
  // librarian posting the same errand read nothing alike.
  const PERSONALITY_VOICES = () => questBank('QuestNotices.personalityVoices');

  // ==========================================================================
  // Named individuals as quest givers
  //
  // Rather than inventing a person, pull a real NPC out of the map pools
  // (js/db/WorldGen/NPCPools.json, the same events NPCSystem spawns) so the
  // poster is somebody the player can actually go and meet, and give them a
  // personality from PersonalityData.json to write in. The personality is derived
  // deterministically from the NPC's name when the society sim has not assigned
  // one, so the same person always sounds the same.
  // ==========================================================================
  function personalityNames() {
    const list = window._NPCSocietyDataLoader?.personalities
      || window.Health?.PersonalityData?.list
      || window.Health?.PersonalityData
      || null;
    const names = Array.isArray(list)
      ? list.map(p => (p && p.name) ? p.name : null).filter(Boolean)
      : [];
    return names.length ? names : Object.keys(PERSONALITY_VOICES());
  }

  // The society sim's own personality for this NPC, when it has met them.
  function assignedPersonality(npcName) {
    try {
      const profile = window.NPCSociety?.getProfile?.(npcName)
        || window.NPCSystem?.getProfile?.(npcName)
        || null;
      if (!profile) return null;
      if (profile.personality && PERSONALITY_VOICES()[profile.personality]) return profile.personality;
      const list = window._NPCSocietyDataLoader?.personalities;
      if (list && profile.personalityIndex != null) {
        const p = list[profile.personalityIndex];
        if (p && p.name && PERSONALITY_VOICES()[p.name]) return p.name;
      }
    } catch (e) { }
    return null;
  }

  // Flatten the pools once: [{ name, group, archetype }].
  let _npcPool = null;
  function npcPool() {
    if (_npcPool) return _npcPool;
    _npcPool = [];
    const pools = window.WorldGen?.NPCPools;
    if (!pools) return _npcPool;
    for (const [group, list] of Object.entries(pools)) {
      if (group.startsWith("__") || !Array.isArray(list)) continue;
      for (const entry of list) {
        const ed = entry && entry.eventData;
        if (!ed || !ed.name) continue;
        // Placeholder event names are not people and must not sign a notice.
        if (/^(npc|event|test|ev\d*|copy)\b/i.test(ed.name.trim())) continue;
        if (ed.name.trim().length < 2) continue;
        // An NPC's archetype is the leading comment on its first page.
        let archetype = null;
        const page = ed.pages && ed.pages[0];
        if (page && Array.isArray(page.list)) {
          for (const cmd of page.list) {
            if (cmd && cmd.code === 108 && cmd.parameters && cmd.parameters[0]) {
              archetype = String(cmd.parameters[0]);
              break;
            }
          }
        }
        _npcPool.push({ name: String(ed.name), group, archetype });
      }
    }
    return _npcPool;
  }

  // Prefer somebody who lives where the board is; fall back to anyone.
  function pickNpcGiver(rng, boardKey) {
    const pool = npcPool();
    if (!pool.length) return null;
    const here = norm(boardKey);
    const local = pool.filter(n => norm(n.group) === here);
    const npc = pick(rng, local.length ? local : pool);
    if (!npc) return null;
    const names = personalityNames();
    const personality = assignedPersonality(npc.name)
      || names[hashStr("pers:" + npc.name) % names.length];
    return {
      name: npc.name,
      group: npc.group,
      archetype: npc.archetype,
      personality: PERSONALITY_VOICES()[personality] ? personality : names[0],
    };
  }

  // How a named person signs a notice.
  const NPC_GIVER_ROLES = () => questBank('QuestNotices.npcGiverRoles');

  // ---- text transforms (a voice can rewrite the finished notice) ----

  // i18n-ignore-start: an English-to-goblin word map. It rewrites a notice
  // that is already English; a translated notice simply does not match, which
  // is the intended behaviour until the voice is authored per language.
  const GOBLIN_WORDS = {
    the: "da", The: "Da", this: "dis", This: "Dis", that: "dat", That: "Dat",
    you: "yoo", You: "Yoo", your: "yer", Your: "Yer", and: "an", are: "is",
    is: "is", "we": "us", "We": "Us", "our": "us", "Our": "Us",
    coordinates: "scratch-marks", coordinate: "scratch-mark",
    payment: "shiny", Payment: "Shiny", paid: "shiny-given", reward: "shiny",
    money: "shiny", contract: "promise-paper", Contract: "Promise-paper",
    quest: "job", statues: "stone-people", statue: "stone-person",
    signposts: "pointy-sticks", signpost: "pointy-stick",
    citizen: "soft-one", citizens: "soft-ones", people: "soft-ones",
    please: "please-ish", cache: "hidey-box", crate: "box", strongbox: "hard-box",
    deliver: "carry-give", recover: "get-back", excavate: "dig-dig",
    shovel: "digger-stick", enemy: "bad-thing", beast: "bad-thing",
    dangerous: "bitey", weather: "sky-mood", arena: "punch-pit",
    interview: "talk-at", scan: "look-hard", obstacle: "in-the-way-thing",
    obstacles: "in-the-way-things", goods: "stuff", cargo: "stuff",
    destination: "far-place", journey: "long-walk", coordinates_: "scratch-marks",
  };
  // i18n-ignore-end

  // Rewrites a notice into goblinese: substitute the goblin lexicon, drop the
  // small connective words goblins consider decorative, and let sentences end
  // with the odd grunt. Deterministic (seeded) so a notice never changes wording.
  function speakGoblinese(text, rng) {
    let out = String(text || "").replace(/\b[\w']+\b/g, w => {
      if (Object.prototype.hasOwnProperty.call(GOBLIN_WORDS, w)) return GOBLIN_WORDS[w];
      const lower = w.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(GOBLIN_WORDS, lower)) {
        const rep = GOBLIN_WORDS[lower];
        return w[0] === w[0].toUpperCase() ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep;
      }
      return w;
    });
    // Goblins have no use for articles they did not invent.
    out = out.replace(/\b(?:a|an|of|to|for|at|in|on|by|with|from|as|it|its)\b/g, "");
    out = out.replace(/\bwill\b|\bshall\b|\bwould\b|\bhas been\b|\bhave been\b/g, "");
    out = out.replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
    // A grunt on roughly every third sentence.
    out = out.split(/(?<=[.!?])\s+/).map(s => {
      if (!s) return s;
      return chance(rng, 0.3) ? s + " " + pick(rng, ["Hnh.", "Yes.", "Good.", "Nnk.", "Is so."]) : s; // i18n-ignore: goblin voice interjections, see GOBLIN_WORDS
    }).join(" ");
    return out.replace(/\s{2,}/g, " ").trim();
  }

  // Black-archive redaction: a few of the longer words go under the marker,
  // enough to feel classified while leaving the job legible.
  function redactText(text, rng) {
    return String(text || "").replace(/\b[A-Za-z]{6,}\b/g, w =>
      chance(rng, 0.14) ? "█".repeat(Math.min(9, w.length)) : w);
  }

  // Transforms chain: "goblinese+shout" mangles the grammar and then shouts it.
  function applyVoiceTransform(text, transform, rng) {
    if (!transform) return text;
    let out = text;
    for (const step of String(transform).split("+")) {
      if (step === "goblinese") out = speakGoblinese(out, rng);
      else if (step === "redacted") out = redactText(out, rng);
      else if (step === "shout") out = String(out).toUpperCase();
    }
    return out;
  }

  // Resolve the voice for an offer: the named individual's personality, else the
  // faction's own lines over its family register, else the neutral banks.
  //
  // The three tiers are kept SEPARATE rather than concatenated, because a merged
  // pool drowns the two or three lines that actually identify the poster in the
  // thirty generic ones. pickVoiceLine weights the specific tier heavily so an
  // Archive notice reliably sounds like the Archive.
  function resolveVoice(o) {
    if (o.giverPersonality && PERSONALITY_VOICES()[o.giverPersonality]) {
      const v = PERSONALITY_VOICES()[o.giverPersonality];
      return { own: v, family: null, titlePrefix: null, transform: null };
    }
    const fv = (o.giverFaction != null) ? FACTION_VOICES()[o.giverFaction] : null;
    if (fv) {
      const fam = VOICE_FAMILIES()[fv.family] || null;
      // A four or five star contract is the notice a faction writes when its own
      // people have already failed, and it has its own bespoke lines.
      const isElite = o.diff >= 4;
      const own = isElite ? (ELITE_BY_FACTION()[o.giverFaction] || fv) : fv;
      const family = isElite ? (ELITE_FAMILY()[fv.family] || fam) : fam;
      return {
        own,
        family,
        titlePrefix: isElite
          ? ELITE_TITLE_PREFIX
          : (fv.titlePrefix || (fam && fam.titlePrefix) || null),
        transform: fv.transform || (fam && fam.transform) || null,
      };
    }
    return { own: null, family: null, titlePrefix: null, transform: null };
  }

  const ELITE_TITLE_PREFIX = () => questBank('QuestNotices.eliteTitlePrefix');

  // Extra briefing sentences, two per elite notice, so no two high-grade
  // contracts read from the same dossier.
  const ELITE_INTEL = () => questBank('QuestNotices.eliteIntel');

  // Built per call, not at load: the banks behind it follow the language.
  const NEUTRAL_BANKS = () => ({ openers: OPENERS(), caveats: CAVEATS(), signoffs: SIGNOFFS() });

  // One line for `slot` ("openers" | "caveats" | "signoffs").
  //
  // A poster with a voice ALWAYS speaks in it: the neutral banks are only for
  // anonymous notices. Mixing generic lines into a faction's notice was the whole
  // problem the tiering exists to solve, so there is deliberately no fallback
  // path from a known voice to the generic pool.
  function pickVoiceLine(rng, voice, slot) {
    const own = (voice.own && voice.own[slot]) || null;
    const fam = (voice.family && voice.family[slot]) || null;
    const hasOwn = !!(own && own.length);
    const hasFam = !!(fam && fam.length);
    if (hasOwn && hasFam) {
      // Its own lines identify it; the register carries the bulk of the writing.
      return chance(rng, 0.45) ? pick(rng, own) : pick(rng, fam);
    }
    if (hasOwn) return pick(rng, own);
    if (hasFam) return pick(rng, fam);
    return pick(rng, NEUTRAL_BANKS()[slot]);
  }

  // ==========================================================================
  // Titles and bodies per archetype
  // ==========================================================================
  const TITLES = () => questBank('QuestNotices.titles');

  // Several per archetype; the composer picks one and wraps it with the shared
  // opener / caveat / lore / signoff banks above.
  const BODIES = () => questBank('QuestNotices.bodies');

  // ==========================================================================
  // Faction weighting per archetype (Factions.json ids)
  // ==========================================================================
  // Which factions plausibly post which errand. Repeated ids are weights. Every
  // faction in Factions.json appears somewhere, so all 51 voices are reachable
  // in play rather than only the handful the tables used to name.
  const FACTIONS_BY_TYPE = {
    courier: [10, 10, 2, 1, 41, 46, 22, 29, 43],
    smuggle: [2, 16, 24, 44, 17, 49, 29, 13],
    supply: [2, 11, 10, 27, 37, 38, 42, 34],
    catering: [10, 27, 2, 30, 33, 26, 45],
    procure: [2, 11, 11, 29, 15, 42],
    donation: [27, 1, 10, 9, 28, 30, 33, 32],
    cache: [1, 0, 10, 16, 49, 13, 19],
    dig: [0, 6, 1, 9, 50, 14, 21],
    statues: [1, 19, 21, 6, 28, 4],
    signs: [10, 1, 20, 22, 42, 9],
    clearing: [10, 11, 27, 37, 38, 15],
    bounty_criminal: [7, 12, 27, 18, 34, 45, 36, 48, 3],
    bounty_monster: [12, 27, 10, 8, 30, 31, 40, 47],
    survey: [1, 20, 10, 9, 46, 50, 39],
    survey_dest: [1, 20, 2, 26, 46, 22],
    pilgrimage: [27, 28, 18, 33, 4, 24],
    interview: [1, 22, 20, 23, 6, 26],
    offworld: [0, 11, 2, 50, 5, 43],
    arena: [16, 2, 12, 35, 36, 45],
    cull: [12, 27, 10, 38, 40, 47, 31],
    market: [2, 15, 29, 24, 42],
    expedition: [1, 0, 10, 39, 43, 46],
    purge: [0, 12, 1, 31, 30, 48, 13],
    grand_tour: [10, 10, 1, 26, 22, 16],
    research: [1, 0, 19, 5, 50, 21, 6],
    pet: [26, 8, 25, 9, 32, 18, 5, 24],
    // Elite hunts are always posted by somebody with a budget and a body count.
    elite_hunt: [
      1, 2, 7, 8, 12, 13, 14, 16, 17, 18, 19, 27, 28, 30, 31, 34,
      35, 36, 37, 40, 41, 43, 44, 45, 46, 47, 48, 49, 50, 0, 5, 11,
    ],
  };

  const TYPE_WEIGHTS = [
    ["courier", 10], ["smuggle", 4], ["supply", 7], ["catering", 4],
    ["procure", 7], ["donation", 3],
    ["cache", 9], ["dig", 7], ["statues", 6], ["signs", 4], ["clearing", 4],
    ["bounty_criminal", 6], ["bounty_monster", 6],
    ["survey", 4], ["survey_dest", 3], ["pilgrimage", 3], ["interview", 4],
    ["offworld", 4], ["arena", 3], ["cull", 4], ["market", 2],
    ["expedition", 5], ["purge", 4], ["grand_tour", 3], ["research", 3],
    ["pet", 4],
  ];

  function pickType(rng, hasGalaxy) {
    const pool = TYPE_WEIGHTS.filter(([t]) => t !== "offworld" || hasGalaxy);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [t, w] of pool) { r -= w; if (r <= 0) return t; }
    return "courier";
  }

  // ==========================================================================
  // Step construction helpers
  // ==========================================================================
  function stepGotoSite(site) { return { kind: "goto_site", site, done: false }; }
  function stepGotoDest(dest) { return { kind: "goto_dest", dest, done: false }; }
  function stepCache(site, loot) { return { kind: "cache", site, loot: !!loot, opened: false, done: false }; }
  function stepDig(site, loot) { return { kind: "dig", site, loot: !!loot, opened: false, done: false }; }
  function stepPlanetCache(planet, loot) { return { kind: "planet_cache", planet, loot: !!loot, opened: false, done: false }; }
  function stepBounty(site, enemy, criminal) {
    return { kind: "bounty", site, enemyId: enemy.id, enemyName: enemy.name, enemyLevel: enemy.level, criminal: !!criminal, done: false };
  }
  function stepScan(kind, site, count) { return { kind, site, count, scanned: {}, done: false }; }
  function stepClearing(site, count) { return { kind: "clearing", site, count, cleared: 0, done: false }; }
  function stepDeliver(dest) { return { kind: "deliver_board", dest, done: false }; }
  function stepInterview(dest) { return { kind: "interview", dest, done: false }; }
  function stepSupply(itemId, qty) { return { kind: "supply_items", itemId, qty, done: false }; }
  function stepWait(hours) { return { kind: "wait_delivery", hours, done: false }; }
  function stepArena(count) { return { kind: "arena_wins", count, baseline: -1, done: false }; }
  function stepCull(count) { return { kind: "cull_kills", count, kills: 0, done: false }; }
  function stepMarket(count) { return { kind: "market_shares", count, done: false }; }
  // Tame-and-hand-over: the party must recruit the named enemy as a pet (see
  // EnemyTalkSystem / PetFollowerSystem) and still have it when they claim. The
  // pet is released to the client on claim, which is why the step records the
  // enemy rather than a pet id.
  function stepAdoptPet(enemy) {
    return {
      kind: "adopt_pet", enemyId: enemy.id, enemyName: enemy.name,
      enemyLevel: enemy.level, done: false,
    };
  }

  function stepText(s) {
    switch (s.kind) {
      case "goto_site": return T('Quests.reachWorldCoordinates') + siteText(s.site);
      case "goto_dest": return T('Quests.travelTo') + s.dest;
      case "cache": return T('Quests.recoverTheCacheAt') + siteText(s.site);
      case "dig": return T('Quests.excavateTheDigSiteAt') + siteText(s.site) + T('Quests.shovelRequired');
      case "planet_cache": return T('Quests.landOn') + s.planet.planet + " (" + s.planet.system + ")" + T('Quests.andRecoverTheSampleCache');
      case "bounty": return (s.criminal ? T('Quests.huntDownTheOutlaw') : T('Quests.slayThe')) + s.enemyName + " (Lv " + s.enemyLevel + ") " + T('Quests.at') + siteText(s.site);
      case "statues": return T('Quests.scan') + s.count + T('Quests.statuesAt') + siteText(s.site);
      case "signs": return T('Quests.verify') + s.count + T('Quests.signpostsAt') + siteText(s.site);
      case "clearing": return T('Quests.clear') + s.count + T('Quests.obstaclesAt') + siteText(s.site);
      case "deliver_board": return T('Quests.deliverToTheQuestBoardOf') + s.dest;
      case "interview": return T('Quests.empathizeWithAnyCitizenOf') + s.dest;
      case "supply_items": {
        const it = $dataItems[s.itemId];
        return T('Quests.handOver') + s.qty + "x " + (it ? it.name : "?") + T('Quests.atAnyQuestBoard');
      }
      case "wait_delivery": return T('Quests.waitForTheGoodsThenCollectAtAnyQuestBoard');
      case "arena_wins": return T('Quests.win') + s.count + T('Quests.arenaBattles');
      case "cull_kills": return T('Quests.defeat') + s.count + T('Quests.enemiesInBattle');
      case "market_shares": return T('Quests.hold') + s.count + T('Quests.oilShares');
      case "adopt_pet": return T('Quests.tameA') + s.enemyName + " (Lv " + s.enemyLevel + ")"
        + T('Quests.andBringItInAsAPet');
    }
    return "?";
  }

  // ==========================================================================
  // Offer generation
  // ==========================================================================
  // `forceDiff` of 4 or 5 produces the board's elite hunt: pure combat against
  // something far above the party (70-100 at four stars, 100-300 at five).
  function buildOffer(boardKey, day, slot, forceDiff) {
    const rng = mulberry32(hashStr(worldSeed() + "|" + boardKey + "|" + day + "|" + slot));
    const L = medianLevel();
    const hasGalaxy = !!($gameSystem?.starMapData?.getAllSystems);
    const elite = forceDiff >= 4;
    let type = elite ? "elite_hunt" : pickType(rng, hasGalaxy);
    const diff = elite ? forceDiff : irange(rng, 1, 3);
    const diffMult = 1 + 0.5 * (diff - 1);

    const o = {
      qid: "pq_" + hashStr(boardKey + "#" + day + "#" + slot).toString(16),
      boardKey, day, slot, type, diff,
      level: L,
      scam: false,
      giverFaction: null, targetFaction: null, giverLabel: null, factionPlain: null,
      giverNpc: null, giverPersonality: null,
      steps: [], stepMode: "seq",
      payGold: 0,
      reward: { gold: 0, materials: [], gear: null, artifactLevel: 0, secret: false },
      advanceGold: 0, penaltyGold: 0, bountyOnFail: 0,
      deadlineHours: 0,
      title: "", body: "",
      ctx: {},
    };

    // ---- scams masquerade as procurement posts ----
    if ((type === "procure" || type === "supply") && chance(rng, 0.16)) {
      o.scam = true;
      type = o.type = "procure";
    }

    // ---- who is hiring: a scam front, a faction, a named local, or nobody ----
    // This choice drives the whole tone of the notice (see resolveVoice).
    if (o.scam) {
      o.giverLabel = pick(rng, SCAM_GIVERS());
    } else if (type === "donation" || elite || chance(rng, 0.5)) {
      // An elite hunt always has an institution behind it: nobody anonymous has
      // the budget, the body count or the standing to leave that notice up.
      const table = FACTIONS_BY_TYPE[type] || [1];
      o.giverFaction = pick(rng, table);
      o.factionPlain = factionName(o.giverFaction) || null;
      // Factions sign posters as offices, clerks and night shifts, not as a
      // bare name; the plain name stays on o.factionPlain for [FACTION].
      o.giverLabel = o.factionPlain
        ? expand(rng, pick(rng, GIVER_ROLES()), { FACTION: o.factionPlain })
        : null;
      const hostileTypes = ["cache", "survey", "interview", "bounty_criminal", "courier", "smuggle", "expedition", "research"];
      if (hostileTypes.includes(type) && chance(rng, 0.3)) {
        o.targetFaction = pickRivalFaction(rng, o.giverFaction);
      }
    } else if (chance(rng, 0.55)) {
      // A real person from the map pools, writing in their own personality.
      const npc = pickNpcGiver(rng, boardKey);
      if (npc) {
        o.giverNpc = { name: npc.name, group: npc.group, archetype: npc.archetype };
        o.giverPersonality = npc.personality;
        o.giverLabel = expand(rng, pick(rng, NPC_GIVER_ROLES()), {
          NAME: npc.name,
          PLACE: npc.group || boardKey,
        });
      }
    }
    if (!o.giverLabel) o.giverLabel = pick(rng, NEUTRAL_GIVERS());

    // ---- base gold reward from party median level ----
    let gold = (500 + rng() * 900) * (1 + 0.30 * L) * diffMult;

    const dests = destinationNames();
    const hereNorm = norm(boardKey);
    const otherDests = dests.filter(d => norm(d) !== hereNorm);
    const anyDest = () => otherDests.length ? pick(rng, otherDests) : (dests[0] || "Ghent"); // i18n-ignore: Destinations.json key
    const ctx = o.ctx;

    const fallbackToSurvey = () => {
      o.type = "survey";
      const site = pickSiteCoords(rng);
      o.steps = [stepGotoSite(site)];
      ctx.X = site.wx; ctx.Y = site.wy;
      gold *= 0.7;
    };

    switch (type) {
      case "courier":
      case "smuggle": {
        // A delivery is only completable at a board the player can actually
        // reach, so it targets a board they have already opened. Before any
        // second board is known, the job becomes a plain journey instead.
        const board = pickKnownBoard(rng, boardKey);
        if (board) {
          o.steps = [stepDeliver(board)];
          ctx.DEST = board;
        } else {
          const dest = anyDest();
          if (!dest) { fallbackToSurvey(); break; }
          o.steps = [stepGotoDest(dest)];
          ctx.DEST = dest;
        }
        gold *= type === "smuggle" ? 1.8 : 1.1;
        break;
      }
      case "pet": {
        const enemy = pickPetTarget(rng, L, diff);
        if (!enemy) { fallbackToSurvey(); break; }
        o.steps = [stepAdoptPet(enemy)];
        gold *= 1.6;
        ctx.ENEMY = enemy.name; ctx.LVL = enemy.level;
        break;
      }
      case "elite_hunt": {
        // Pure combat, and deliberately out of the party's league.
        const lo = diff >= 5 ? 100 : 70;
        const hi = diff >= 5 ? 300 : 100;
        const enemy = pickEliteEnemy(rng, lo, hi);
        if (!enemy) { fallbackToSurvey(); break; }
        const site = pickSiteCoords(rng);
        o.steps = [stepBounty(site, enemy, false)];
        o.elite = true;
        // Elite pay is set by the star band, but the gear is the real draw.
        o.reward.gear = pickGearReward(rng, Math.max(L, enemy.level), true);
        addMaterialPack(o, rng, 2 + diff);
        if (diff >= 5) o.reward.artifactLevel = Math.max(1, Math.min(99, enemy.level));
        ctx.X = site.wx; ctx.Y = site.wy; ctx.ENEMY = enemy.name; ctx.LVL = enemy.level;
        break;
      }
      case "supply":
      case "catering": {
        const pool = type === "catering" ? foodItems() : materialItems();
        const it = pool.length ? pick(rng, pool) : null;
        if (!it) { fallbackToSurvey(); break; }
        const qty = irange(rng, 2, 4 + diff);
        o.steps = [stepSupply(it.id, qty)];
        ctx.ITEM = it.name; ctx.QTY = qty;
        gold *= 1.2;
        break;
      }
      case "procure": {
        o.payGold = Math.round(gold * (o.scam ? 0.9 : 1.3) / 10) * 10;
        if (o.scam) {
          gold *= 3; // the lie on the poster
          o.reward.secret = chance(rng, 0.5);
        } else {
          o.reward.gear = chance(rng, 0.5) ? pickGearReward(rng, L, chance(rng, 0.35)) : null;
          if (!o.reward.gear) addMaterialPack(o, rng, 2 + diff);
          gold = 0; // goods, not money
        }
        o.steps = [stepWait(irange(rng, 4, 20))];
        o.deadlineHours = 48;
        ctx.COST = euros(o.payGold);
        break;
      }
      case "donation": {
        o.payGold = Math.round((300 + rng() * 700) * (1 + 0.2 * L) / 10) * 10;
        o.steps = []; // instantly claimable: the receipt is the quest
        gold = 0;
        addMaterialPack(o, rng, 1);
        ctx.COST = euros(o.payGold);
        ctx.FACTION = o.factionPlain || o.giverLabel;
        break;
      }
      case "cache": {
        const site = pickSiteCoords(rng);
        o.steps = [stepCache(site, true)];
        o.reward.secret = chance(rng, 0.25);
        if (chance(rng, 0.45)) o.reward.gear = pickGearReward(rng, L, chance(rng, 0.25));
        else addMaterialPack(o, rng, 1 + diff);
        ctx.X = site.wx; ctx.Y = site.wy;
        break;
      }
      case "dig": {
        const site = pickSiteCoords(rng);
        o.steps = [stepDig(site, true)];
        o.reward.artifactLevel = Math.max(1, Math.min(99, L + irange(rng, -2, 4)));
        o.reward.secret = chance(rng, 0.2);
        gold *= 1.15;
        ctx.X = site.wx; ctx.Y = site.wy;
        break;
      }
      case "statues":
      case "signs": {
        const site = pickSiteCoords(rng);
        const count = irange(rng, 2, 4);
        o.steps = [stepScan(type, site, count)];
        ctx.X = site.wx; ctx.Y = site.wy; ctx.N = count;
        break;
      }
      case "clearing": {
        const site = pickSiteCoords(rng);
        const count = irange(rng, 3, 5 + diff);
        o.steps = [stepClearing(site, count)];
        ctx.X = site.wx; ctx.Y = site.wy; ctx.N = count;
        break;
      }
      case "bounty_criminal":
      case "bounty_monster": {
        const site = pickSiteCoords(rng);
        const enemy = pickBountyEnemy(rng, L, diff, type === "bounty_criminal");
        if (!enemy) { fallbackToSurvey(); break; }
        o.steps = [stepBounty(site, enemy, type === "bounty_criminal")];
        gold *= 1.5 + 0.05 * Math.max(0, enemy.level - L);
        ctx.X = site.wx; ctx.Y = site.wy; ctx.ENEMY = enemy.name; ctx.LVL = enemy.level;
        break;
      }
      case "survey": {
        const site = pickSiteCoords(rng);
        o.steps = [stepGotoSite(site)];
        gold *= 0.7;
        ctx.X = site.wx; ctx.Y = site.wy;
        break;
      }
      case "survey_dest":
      case "pilgrimage": {
        if (!otherDests.length) { fallbackToSurvey(); break; }
        const dest = pick(rng, otherDests);
        o.steps = [stepGotoDest(dest)];
        gold *= 0.8;
        ctx.DEST = dest;
        break;
      }
      case "interview": {
        const dest = anyDest();
        o.steps = [stepInterview(dest)];
        gold *= 0.9;
        ctx.DEST = dest;
        break;
      }
      case "offworld": {
        const planet = pickPlanetTarget(rng);
        if (!planet) { fallbackToSurvey(); break; }
        o.steps = [stepPlanetCache(planet, true)];
        o.reward.secret = chance(rng, 0.3);
        addMaterialPack(o, rng, 2 + diff);
        gold *= 1.8;
        ctx.PLANET = planet.planet; ctx.SYSTEM = planet.system;
        break;
      }
      case "arena": {
        const count = irange(rng, 1, 2 + diff);
        o.steps = [stepArena(count)];
        gold *= 1.2;
        ctx.N = count;
        break;
      }
      case "cull": {
        const count = irange(rng, 4, 6 + diff * 3);
        o.steps = [stepCull(count)];
        ctx.N = count;
        break;
      }
      case "market": {
        // Shares cannot be bought before the exchange opens (Switch 24), so the
        // contract would be unwinnable.
        if (typeof $gameSwitches === "undefined" || !$gameSwitches || !$gameSwitches.value(24)) {
          fallbackToSurvey();
          break;
        }
        const count = irange(rng, 3, 5 + diff * 2);
        o.steps = [stepMarket(count)];
        gold *= 1.1;
        ctx.N = count;
        break;
      }

      // ---- multi-step chains ----
      case "expedition": {
        const site = pickSiteCoords(rng);
        o.stepMode = "seq";
        // The hand-in leg needs a board the party has seen; without one the
        // contract ends at the cache rather than becoming impossible.
        const board = pickKnownBoard(rng, boardKey);
        if (board) {
          o.steps = [stepGotoSite(site), stepCache(site, true), stepDeliver(board)];
          ctx.DEST = board;
        } else {
          const dest = anyDest();
          o.steps = [stepGotoSite(site), stepCache(site, true)];
          if (dest) { o.steps.push(stepGotoDest(dest)); ctx.DEST = dest; }
          else ctx.DEST = boardKey;
        }
        addMaterialPack(o, rng, 1 + diff);
        gold *= 1.7;
        ctx.X = site.wx; ctx.Y = site.wy;
        break;
      }
      case "purge": {
        const site = pickSiteCoords(rng);
        const enemy = pickBountyEnemy(rng, L, diff, chance(rng, 0.35));
        if (!enemy) { fallbackToSurvey(); break; }
        o.stepMode = "seq";
        o.steps = [stepBounty(site, enemy, enemy.canTalk), stepCache(site, true)];
        if (chance(rng, 0.4)) o.reward.gear = pickGearReward(rng, L, chance(rng, 0.3));
        else addMaterialPack(o, rng, 1 + diff);
        gold *= 1.9;
        ctx.X = site.wx; ctx.Y = site.wy; ctx.ENEMY = enemy.name; ctx.LVL = enemy.level;
        break;
      }
      case "grand_tour": {
        if (otherDests.length < 2) { fallbackToSurvey(); break; }
        const shuffled = otherDests.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const stops = shuffled.slice(0, Math.min(irange(rng, 2, 3), shuffled.length));
        o.stepMode = "par"; // any order
        o.steps = stops.map(d => stepGotoDest(d));
        gold *= 1.2 + 0.4 * stops.length;
        ctx.N = stops.length;
        break;
      }
      case "research": {
        const site = pickSiteCoords(rng);
        const dest = anyDest();
        o.stepMode = "seq";
        o.steps = [stepScan("statues", site, irange(rng, 2, 3)), stepInterview(dest)];
        gold *= 1.6;
        ctx.X = site.wx; ctx.Y = site.wy; ctx.DEST = dest;
        break;
      }
    }

    // The star rating is the pay grade: whatever the archetype multipliers added
    // up to only decides where inside the band the figure lands.
    o.reward.gold = (o.type === "procure" || o.type === "donation") && gold === 0
      ? 0                                    // paid in goods, not money
      : fitRewardToBand(gold, o.diff, L, rng);

    // ---- contract terms (always disclosed on the detail parchment) ----
    // Stakes climb with the stars: a high-grade contract fronts more money and
    // punishes failure harder, so the elite hunts are a real gamble rather than
    // free upside.
    const star = o.diff - 1;                    // 0 at one star, 4 at five
    const advanceChance = Math.min(0.85,
      ((o.type === "courier" || o.type === "smuggle" || o.type.startsWith("bounty")) ? 0.4 : 0.18)
      + 0.12 * star);
    if (!o.scam && o.reward.gold > 0 && chance(rng, advanceChance)) {
      o.advanceGold = Math.round(o.reward.gold * (0.2 + 0.05 * star + rng() * 0.15) / 10) * 10;
    }
    if (chance(rng, 0.3 + 0.12 * star) || o.advanceGold > 0) {
      o.penaltyGold = Math.max(o.advanceGold,
        Math.round((o.reward.gold || o.payGold || 500) * (0.3 + 0.12 * star + rng() * 0.4) / 10) * 10);
    }
    if (!o.scam) {
      const bountyChance = Math.min(0.9,
        (o.giverFaction === 7 ? 0.5 : (o.type === "smuggle" ? 0.35 : 0.12)) + 0.1 * star);
      if (chance(rng, bountyChance)) o.bountyOnFail = irange(rng, 20, 80) * 100 * o.diff;
    }
    // Upfront costs rise with the grade too.
    if (o.payGold > 0 && star > 0) {
      o.payGold = Math.round(o.payGold * (1 + 0.35 * star) / 10) * 10;
      ctx.COST = euros(o.payGold);
    }
    if (!o.deadlineHours) {
      const timedChance = (o.type === "courier" || o.type === "catering") ? 0.7
        : o.type === "smuggle" ? 0.85 : 0.35;
      if (chance(rng, timedChance)) {
        o.deadlineHours = (o.type === "courier" || o.type === "smuggle" || o.type === "catering")
          ? irange(rng, 24, 72)
          : irange(rng, 48, 96) + (o.steps.length - 1) * 24;
      }
    }

    ctx.HERE = boardKey;
    ctx.COLOR = pick(rng, LORE_COLOR());
    ctx.COLOR2 = pick(rng, LORE_COLOR());
    if (ctx.FACTION == null) ctx.FACTION = o.factionPlain || o.giverLabel;
    o.title = composeTitle(rng, o, ctx);
    o.body = annotateSite(composeBody(rng, o, ctx), ctx);
    // The notice reads exactly as its poster wrote it, and then says plainly
    // what the party will find out anyway: nobody is coming to collect it.
    // Appended rather than substituted, so the errand, the target and the
    // promised pay are all still legible on the page.
    if (isEmptyWorld()) o.body += "\n\n" + T('Quests.giverIsDead');
    return o;
  }

  // A body is an opener + one archetype template + a caveat + a lore line + a
  // signoff, each optional part rolled per offer and the whole thing expanded
  // once, so the same archetype never reads the same way twice.
  //
  // The opener / caveat / signoff banks come from the poster's VOICE, so the same
  // errand posted by the Archive Foundation, a goblin, a petrodemon and a nervous
  // librarian are four different notices. The order of the middle sections is
  // shuffled too, and a voice may rewrite the finished text entirely.
  function composeBody(rng, o, ctx) {
    const type = o.type;
    const voice = resolveVoice(o);
    const templates = BODIES()[type] || BODIES().survey;

    // Four and five star notices are full briefings, so nothing is rolled away:
    // the poster's own opener, the long brief, two lines of intelligence, a
    // caveat, colour and a signoff all appear every time.
    if (o.diff >= 4) {
      const intel = ELITE_INTEL().slice();
      const picks = [];
      for (let i = 0; i < 2 && intel.length; i++) {
        picks.push(intel.splice(Math.floor(rng() * intel.length), 1)[0]);
      }
      const parts = [
        pickVoiceLine(rng, voice, "openers"),
        pick(rng, templates),
        picks.join(" "),
        pickVoiceLine(rng, voice, "caveats"),
        "[COLOR]",
        pickVoiceLine(rng, voice, "signoffs"),
      ];
      return applyVoiceTransform(expand(rng, parts.join(" "), ctx), voice.transform, rng);
    }

    const head = chance(rng, 0.8) ? pickVoiceLine(rng, voice, "openers") : null;
    const middle = [pick(rng, templates)];
    if (chance(rng, 0.6)) middle.push(pickVoiceLine(rng, voice, "caveats"));
    if (chance(rng, 0.75)) middle.push("[COLOR]");
    if (chance(rng, 0.22)) middle.push("[COLOR2]");
    // The archetype template always leads; the trailing colour/caveat order is
    // whichever way the coin fell.
    if (middle.length > 2 && chance(rng, 0.5)) {
      const tail = middle.splice(1);
      tail.reverse();
      middle.push(...tail);
    }
    const tailSign = chance(rng, 0.62) ? pickVoiceLine(rng, voice, "signoffs") : null;

    const parts = [];
    if (head) parts.push(head);
    parts.push(...middle);
    if (tailSign) parts.push(tailSign);

    let body = expand(rng, parts.join(" "), ctx);
    body = applyVoiceTransform(body, voice.transform, rng);
    return body;
  }

  // Title stamp from the poster's register ("FILE:", "WANT:", "WRIT:"), so a
  // notice is recognisable as theirs before it is read.
  function composeTitle(rng, o, ctx) {
    const voice = resolveVoice(o);
    let title = expand(rng, pick(rng, TITLES()[o.type] || TITLES().survey), ctx);
    if (voice.titlePrefix && chance(rng, 0.5)) {
      title = pick(rng, voice.titlePrefix) + " / " + title;
    }
    return applyVoiceTransform(title, voice.transform, rng);
  }

  function addMaterialPack(o, rng, kinds) {
    const mats = materialItems();
    for (let i = 0; i < kinds && mats.length; i++) {
      const it = pick(rng, mats);
      const found = o.reward.materials.find(m => m.id === it.id);
      if (found) found.qty += 1;
      else o.reward.materials.push({ id: it.id, qty: irange(rng, 1, 3) });
    }
  }

  // ==========================================================================
  // Text summaries
  // ==========================================================================
  function objectiveText(q) {
    if (!q.steps.length) return T('Quests.collectTheReceiptAtAnyQuestBoard');
    if (q.steps.length === 1) return stepText(q.steps[0]) + ".";
    const seq = q.stepMode === "seq";
    return q.steps.map((s, i) => {
      const mark = s.done ? "✓" : (seq ? (i === firstUndoneIndex(q) ? "➤" : "…") : "•");
      return mark + " " + stepText(s);
    }).join("\n") + "\n" + (seq ? T('Quests.inOrder') : T('Quests.anyOrder'));
  }

  function rewardText(o, revealSecret) {
    if (o.reward.secret && !revealSecret) return "???";
    const parts = [];
    if (o.reward.gold > 0) parts.push(euros(o.reward.gold));
    for (const m of o.reward.materials) {
      const it = $dataItems[m.id];
      if (it) parts.push(m.qty + "x " + it.name);
    }
    const gear = gearObject(o.reward.gear);
    if (gear) parts.push(gear.name);
    if (o.reward.artifactLevel > 0) parts.push(T('Quests.anUnearthedArtifact'));
    if (!parts.length) parts.push(euros(o.reward.gold || 0));
    return parts.join(" + ");
  }

  // Full terms disclosure, shown on the post-it detail BEFORE accepting.
  function termsLines(o) {
    const t = [];
    t.push(T('Quests.reward') + rewardText(o, false));
    // Knowledge is never part of the sealed goods, so a secret contract still
    // discloses it. The figure is live: it moves with the party's own level.
    const kp = questKnowledge(o);
    if (kp > 0) t.push(T('Quests.knowledgeEarned') + kp + " KP");
    if (o.payGold > 0) t.push(T('Quests.upfrontCost') + euros(o.payGold));
    if (o.advanceGold > 0) t.push(T('Quests.advanceOnAcceptance') + euros(o.advanceGold));
    if (o.deadlineHours > 0) t.push(T('Quests.deadline') + o.deadlineHours + T('Quests.inGameHoursFromAcceptance'));
    if (o.penaltyGold > 0) t.push(T('Quests.penaltyOnFailure') + euros(o.penaltyGold));
    if (o.bountyOnFail > 0) t.push(T('Quests.failureIsProsecutedBreachOfContractBountyOf') + euros(o.bountyOnFail));
    if (o.giverFaction != null) {
      t.push(T('Quests.factionCompletingRaisesYourStandingWith') + (factionName(o.giverFaction) || "?") + (o.penaltyGold || o.bountyOnFail ? T('Quests.failingLowersIt') : ""));
    }
    if (o.targetFaction != null) {
      t.push(T('Quests.thisJobWorksAgainst') + (factionName(o.targetFaction) || "?") + T('Quests.theyWillRememberIt'));
    }
    return t;
  }

  // ==========================================================================
  // Persistent state
  // ==========================================================================
  function state() {
    if (!$gameSystem._procQuests) {
      $gameSystem._procQuests = { active: {}, taken: {}, claimedCount: 0 };
    }
    return $gameSystem._procQuests;
  }

  function bounties() {
    if (!$gameSystem._pqBounties) $gameSystem._pqBounties = {};
    return $gameSystem._pqBounties;
  }

  function activeQuests() { return Object.values(state().active); }

  function toast(text, severity, duration) {
    if (window.ParchmentToast) {
      window.ParchmentToast.show(text, { severity: severity || "info", duration: duration || 180 });
    }
  }

  // The journal note carries the whole contract: the objective list is the first
  // log entry, and the poster's lore, giver, reward, terms, difficulty and
  // deadline ride along as metadata so the log's post-it and its full parchment
  // read exactly like the board's.
  function kanbanAdd(q) {
    if (!window.KanbanQuest) return;
    const desc = objectiveText(q);
    const meta = {
      giver: q.giverLabel || null,
      body: q.body || null,
      objectives: objectiveText(q),
      terms: termsLines(q),
      reward: rewardText(q, false),
      diff: q.diff || 0,
      deadlineHours: q.deadlineHours || 0,
      location: questLocation(q),
      procedural: true,
    };
    window.KanbanQuest.addQuest(q.qid, q.title, desc, meta);
    // The note may already have existed (a progress update landed first).
    if (typeof window.KanbanQuest.setMeta === "function") {
      window.KanbanQuest.setMeta(q.qid, meta);
    }
  }

  function kanbanUpdate(qid, text) {
    if (window.KanbanQuest) window.KanbanQuest.updateQuest(qid, text);
  }

  // How far along a counted step is ("2/5"), for the journal's checklist.
  function stepDetail(s) {
    switch (s.kind) {
      case "statues":
      case "signs": return Object.keys(s.scanned || {}).length + "/" + s.count;
      case "clearing": return (s.cleared || 0) + "/" + s.count;
      case "cull_kills": return (s.kills || 0) + "/" + s.count;
      case "arena_wins": {
        const base = s.baseline < 0 ? 0 : s.baseline;
        const wins = Math.max(0, ($gameVariables.value(ARENA_WINS_VAR) || 0) - base);
        return Math.min(wins, s.count) + "/" + s.count;
      }
      case "market_shares":
        return Math.min($gameVariables.value(OIL_SHARES_VAR) || 0, s.count) + "/" + s.count;
      case "supply_items": {
        const it = $dataItems[s.itemId];
        return Math.min(it ? $gameParty.numItems(it) : 0, s.qty) + "/" + s.qty;
      }
      default: return null;
    }
  }

  // Push the live objective state onto the journal note so the Kanban can show a
  // progress bar and a per-objective checklist rather than only the latest line.
  function kanbanProgress(q) {
    if (!window.KanbanQuest || typeof window.KanbanQuest.setProgress !== "function") return;
    const firstUndone = firstUndoneIndex(q);
    const steps = q.steps.map((s, i) => ({
      text: stepText(s),
      done: !!s.done,
      current: !s.done && (q.stepMode === "par" || i === firstUndone),
      detail: stepDetail(s),
    }));
    window.KanbanQuest.setProgress(q.qid, {
      done: q.steps.filter(s => s.done).length,
      total: q.steps.length,
      mode: q.stepMode,
      status: q.status || "active",
      steps,
    });
  }

  function kanbanComplete(qid) {
    if (window.KanbanQuest) window.KanbanQuest.completeQuest(qid);
  }

  function kanbanFail(qid, text) {
    if (!window.KanbanQuest) return;
    if (typeof window.KanbanQuest.failQuest === "function") window.KanbanQuest.failQuest(qid, text);
    else { window.KanbanQuest.updateQuest(qid, text); window.KanbanQuest.moveQuest(qid, "done"); }
  }

  // ==========================================================================
  // Step lifecycle
  // ==========================================================================
  function firstUndoneIndex(q) {
    for (let i = 0; i < q.steps.length; i++) if (!q.steps[i].done) return i;
    return -1;
  }

  function stepIsActive(q, idx) {
    if (q.status !== "active") return false;
    const s = q.steps[idx];
    if (!s || s.done) return false;
    return q.stepMode === "par" || firstUndoneIndex(q) === idx;
  }

  // Every (quest, step) pair currently waiting on the world.
  function activeSteps() {
    const out = [];
    for (const q of activeQuests()) {
      for (let i = 0; i < q.steps.length; i++) {
        if (stepIsActive(q, i)) out.push({ q, s: q.steps[i], i });
      }
    }
    return out;
  }

  // ==========================================================================
  // World-map markers
  //
  // Every objective the party can currently act on, reduced to a world-map tile
  // (map 315 / vars 43/44 space) plus the label to print there. Coordinate steps
  // use their own site; destination steps resolve to the destination's world
  // tile, so "travel to Ghent" is pinned too. Consumed by WorldMapReturn.js (the
  // in-world name plates, same passive-sprite pass as the "???" markers) and by
  // WorldMap.js (the M key map).
  //
  // Only contracts the player has moved to the journal's "In Progress" column are
  // pinned: accepting a job files it under To Do, and dragging it across is how
  // the player says "this is the one I am chasing", so the world is not papered
  // over with every open contract at once.
  // ==========================================================================
  function isTrackedOnBoard(qid) {
    const kb = window.KanbanQuest;
    // No journal (or an older build of it): pin everything, as before.
    if (!kb || typeof kb.isInProgress !== "function") return true;
    if (!kb.getQuest(qid)) return true; // note never made it onto the board
    return kb.isInProgress(qid);
  }

  function markerSiteOf(s) {
    if (s.site && s.site.wx != null) return { wx: s.site.wx, wy: s.site.wy };
    if (s.dest) return destCoords(s.dest);
    return null;
  }

  // A post-it title is long ("RECOVERY JOB: cache at (21, 12)"); the map wants
  // the shout, not the sentence.
  function shortTitle(title) {
    let t = String(title || "").split(":")[0].trim();
    if (t.length > 26) t = t.slice(0, 25).trim() + "…";
    return t || String(title || "?");
  }

  // Where a single quest (an offer, or an accepted contract) points on the world
  // map: the next objective that has a place, falling back to any objective that
  // has one. Used by the "Show on map" button on both quest detail sheets, which
  // is why it works on offers too, before any step is active.
  function questLocation(q) {
    if (!q || !Array.isArray(q.steps)) return null;
    const pending = q.steps.filter(s => !s.done);
    for (const list of [pending, q.steps]) {
      for (const s of list) {
        const site = markerSiteOf(s);
        if (site) return { wx: site.wx, wy: site.wy, label: stepText(s) };
      }
    }
    return null;
  }

  function questMarkers() {
    const out = [];
    try {
      for (const { q, s, i } of activeSteps()) {
        if (!isTrackedOnBoard(q.qid)) continue;
        const site = markerSiteOf(s);
        if (!site) continue;
        out.push({
          qid: q.qid,
          wx: site.wx, wy: site.wy,
          title: q.title,
          label: shortTitle(q.title),
          objective: stepText(s),
          kind: s.kind,
          step: i + 1,
          stepCount: q.steps.length,
          multi: q.steps.length > 1,
        });
      }
    } catch (e) { }
    return out;
  }

  // Register a bounty step's target in the persistent world store. Once in,
  // it force-spawns on its tile until killed, whatever happens to the quest.
  function registerBountyStep(q, s) {
    const key = s.site.wx + "," + s.site.wy;
    if (!bounties()[key]) {
      bounties()[key] = { enemyId: s.enemyId, name: s.enemyName, qid: q.qid, criminal: s.criminal };
    }
  }

  function onStepActivated(q, s) {
    if (s.kind === "bounty") registerBountyStep(q, s);
    if (s.kind === "arena_wins" && s.baseline < 0) s.baseline = $gameVariables.value(ARENA_WINS_VAR) || 0;
  }

  function completeStep(q, idx, note) {
    const s = q.steps[idx];
    if (!s || s.done) return;
    s.done = true;
    const nextIdx = firstUndoneIndex(q);
    if (nextIdx === -1) {
      questBecomesClaimable(q, note);
    } else {
      kanbanUpdate(q.qid, (note || stepText(s) + " ✓") + "\n" + T('Quests.next') + stepText(q.steps[nextIdx]));
      if (q.stepMode === "seq") onStepActivated(q, q.steps[nextIdx]);
      toast(T('Quests.objectiveCompleteNext') + stepText(q.steps[nextIdx]));
    }
    kanbanProgress(q);
  }

  function questBecomesClaimable(q, note) {
    if (q.status !== "active") return;
    q.status = "claimable";
    kanbanUpdate(q.qid, (note || T('Quests.objectivesComplete')) + " " + T('Quests.collectYourPayAtAnyQuestBoard'));
    kanbanProgress(q);
  }

  // ==========================================================================
  // Board offers (deterministic per world seed + board + in-game day)
  // ==========================================================================
  // A board never shows more than MAX_BOARD_OFFERS notices, and the elite
  // contracts are part of that budget rather than extra pins on top of it.
  const MAX_BOARD_OFFERS = 12;

  function offersForBoard(boardKey) {
    const day = dayIndex();
    const countRng = mulberry32(hashStr(worldSeed() + "|" + boardKey + "|" + day + "|count"));
    const n = irange(countRng, 8, MAX_BOARD_OFFERS);
    const st = state();

    // Every board carries a four-star hunt, rotating daily, and ONE five-star
    // contract that is unique to that board and does not rotate: it stands there
    // until somebody is good enough to take it (hence day 0 in its seed, so the
    // same notice is on the same board every morning). These are reserved first,
    // so a full board drops an ordinary offer rather than the elite one.
    const elites = [
      buildOffer(boardKey, day, "elite4", 4),
      buildOffer(boardKey, 0, "elite5", 5),
    ].filter(e => !st.taken[e.qid] && !st.active[e.qid]);

    const room = Math.max(0, MAX_BOARD_OFFERS - elites.length);
    const out = [];
    for (let slot = 0; slot < n && out.length < room; slot++) {
      const o = buildOffer(boardKey, day, slot);
      if (st.taken[o.qid]) continue;
      if (st.active[o.qid]) continue;
      out.push(o);
    }
    out.push(...elites);
    return out;
  }

  // ==========================================================================
  // Accept / claim / fail / abandon
  // ==========================================================================
  function acceptOffer(o) {
    const st = state();
    if (st.taken[o.qid]) return { ok: false, reason: T('Quests.alreadyTaken') };

    if (o.payGold > 0) {
      if ($gameParty.gold() < o.payGold) {
        return { ok: false, reason: T('Quests.notEnoughMoneyForTheUpfrontCost') };
      }
      $gameParty.loseGold(o.payGold);
    }

    const q = JSON.parse(JSON.stringify(o));
    q.status = "active";
    q.acceptedAt = nowMinutes();
    q.deadlineAt = o.deadlineHours > 0 ? q.acceptedAt + o.deadlineHours * 60 : 0;

    st.active[q.qid] = q;
    st.taken[q.qid] = true;

    if (q.advanceGold > 0) {
      $gameParty.gainGold(q.advanceGold);
      toast(T('Quests.advanceReceived') + euros(q.advanceGold));
    }

    // Activate initial steps (all of them in "par" mode, the first in "seq").
    if (q.steps.length) {
      if (q.stepMode === "par") q.steps.forEach(s => onStepActivated(q, s));
      else onStepActivated(q, q.steps[0]);
    }

    kanbanAdd(q);
    kanbanProgress(q);

    if (!q.steps.length) {
      // Donations and other receipt-quests are claimable immediately.
      questBecomesClaimable(q, T('Quests.contributionRegistered'));
    }
    return { ok: true, quest: q };
  }

  function applyFactionOutcome(q, success) {
    try {
      if (!$gameFactions) return;
      if (q.giverFaction != null) {
        const bonus = q.type === "donation" ? 10 : 6 + q.diff * 3;
        $gameFactions.changeReputation(q.giverFaction, success ? bonus : -(3 + q.diff));
      }
      if (success && q.targetFaction != null) {
        $gameFactions.changeReputation(q.targetFaction, -(4 + q.diff * 2));
      }
    } catch (e) { }
  }

  // ==========================================================================
  // Named-giver outcomes
  //
  // Doing a job for a person is a social act: their disposition toward the party
  // moves, and the contract is written into their record so the Empathize screen
  // can show what you have and have not done for them.
  // ==========================================================================
  function npcQuestLog() {
    if (!$gameSystem._pqNpcQuests) $gameSystem._pqNpcQuests = {};
    return $gameSystem._pqNpcQuests;
  }

  // Every contract the party has taken from this person, newest last.
  function npcQuestHistory(npcName) {
    if (!npcName) return [];
    return npcQuestLog()[npcName] || [];
  }

  function recordNpcQuest(q, outcome) {
    const name = q.giverNpc && q.giverNpc.name;
    if (!name) return;
    const log = npcQuestLog();
    const list = (log[name] = log[name] || []);
    list.push({
      qid: q.qid,
      title: q.title,
      outcome,                       // "done" | "failed"
      minute: nowMinutes(),
      type: q.type,
      reward: rewardText(q, true),
    });
    if (list.length > 24) list.splice(0, list.length - 24);
  }

  // Move the giver's opinion of the party. Reuses NPCEmpathize's per-actor
  // reputation when it is available so quests and conversation share one number.
  function applyNpcOutcome(q, success) {
    const name = q.giverNpc && q.giverNpc.name;
    if (!name) return;
    recordNpcQuest(q, success ? "done" : "failed");
    const delta = success ? (8 + q.diff * 4) : -(6 + q.diff * 3);
    try {
      const E = window.NPCEmpathize;
      if (E && typeof E.changeOpinion === "function") {
        E.changeOpinion(name, delta);
      } else if (E && typeof E.getProfile === "function") {
        const profile = E.getProfile(name);
        if (profile) {
          if (!profile.opinions) profile.opinions = {};
          for (const actor of $gameParty.members()) {
            const id = actor.actorId();
            const cur = Number(profile.opinions[id] || 0);
            profile.opinions[id] = Math.max(-100, Math.min(100, cur + delta));
          }
        }
      }
    } catch (e) { }
    if (success) {
      toast(name + T('Quests.thinksBetterOfYou'));
    } else {
      toast(name + T('Quests.willRememberThat'), "warning");
    }
  }

  // A five-star contract can pay in an artifact. An artifact is a thing with a
  // provenance in this world, so it is written into the historical record as
  // having passed into the party's hands rather than just dropped in the bag.
  function registerArtifactToParty(itemId, q) {
    try {
      const item = $dataItems[itemId];
      if (!item) return;
      const leader = $gameParty.leader();
      const holderName = leader ? leader.name() : T('Quests.theParty');
      const when = window.TimeDateSystem?.getDateTimeFromMinutes?.(nowMinutes());
      const dateStr = (when && when.fullDate) ? String(when.fullDate) : "D" + dayIndex();
      const how = q && q.giverLabel
        ? T('Quests.wasPaidForAContractPostedBy') + q.giverLabel
        : T('Quests.wasEarnedUnderContract');

      const hm = window.HistoryManager;
      const records = (hm && typeof hm.getArtifactRecords === "function") ? hm.getArtifactRecords() : null;
      if (records) {
        const key = "item:" + itemId;
        const rec = records[key];
        if (rec) {
          rec.holders = Array.isArray(rec.holders) ? rec.holders : [];
          const last = rec.holders[rec.holders.length - 1];
          if (!last || last.holder !== holderName) {
            rec.holders.push({ holder: holderName, power: null, since: dateStr, how });
          }
        } else {
          records[key] = {
            id: itemId, kind: "item", name: item.name,
            date: dateStr, action: how,
            origin: holderName, originPower: null,
            holders: [{ holder: holderName, power: null, since: dateStr, how }],
          };
        }
      }

      // Party-side ledger, so the artifact can be listed as theirs even without
      // the history simulator running.
      if (!$gameSystem._pqPartyArtifacts) $gameSystem._pqPartyArtifacts = [];
      $gameSystem._pqPartyArtifacts.push({
        id: itemId, name: item.name, holder: holderName,
        minute: nowMinutes(), qid: q ? q.qid : null, diff: q ? q.diff : 0,
      });
    } catch (e) { }
  }

  function partyArtifacts() {
    return ($gameSystem && $gameSystem._pqPartyArtifacts) || [];
  }

  // Knowledge is priced on the curve shared with battle victories
  // (window.KnowledgePoints, defined in SkillMaster): the star rating is the
  // base pay grade, and any quarry named in the steps adds what fighting it
  // would have taught, measured against the party's level RIGHT NOW rather than
  // at posting time. A contract on something far above the party is therefore
  // worth far more Knowledge than one on its own level.
  function questKnowledge(q) {
    if (!window.KnowledgePoints || !q) return 0;
    const levels = [];
    for (const s of (q.steps || [])) {
      if (s && s.enemyLevel > 0) levels.push(s.enemyLevel);
    }
    return window.KnowledgePoints.forQuest(q.diff || 1, levels, medianLevel());
  }

  function knowledgeText(kp) {
    return kp + T('Quests.knowledge');
  }

  function grantRewards(q) {
    const lines = [];
    const kp = questKnowledge(q);
    if (kp > 0 && $gameSystem.addKnowledge) {
      $gameSystem.addKnowledge(kp);
      lines.push(knowledgeText(kp));
    }
    if (q.reward.gold > 0) {
      // A party that argues its own fee is paid better for the same work
      // (Negotiation, specialization 186), and learns by doing it.
      const bargained = window.SpecializationXP
        ? Math.round(q.reward.gold * window.SpecializationXP.multiplier("Negotiation", 0.08))
        : q.reward.gold;
      $gameParty.gainGold(bargained);
      lines.push(euros(bargained));
      if (window.SpecializationXP) {
        window.SpecializationXP.awardForValue("Negotiation", bargained);
      }
    }
    for (const m of q.reward.materials) {
      const it = $dataItems[m.id];
      if (it) { $gameParty.gainItem(it, m.qty); lines.push(m.qty + "x " + it.name); }
    }
    const gear = gearObject(q.reward.gear);
    if (gear) { $gameParty.gainItem(gear, 1); lines.push(gear.name); }
    if (q.reward.artifactLevel > 0 && typeof $gameSystem.generateArtifact === "function") {
      const id = $gameSystem.generateArtifact(q.reward.artifactLevel);
      if (id > 0) {
        $gameParty.gainItem($dataItems[id], 1);
        lines.push($dataItems[id].name);
        registerArtifactToParty(id, q);
      }
    }
    return lines;
  }

  // Claim a claimable quest at a board. Supply steps consume their items here.
  function claimQuest(qid) {
    const st = state();
    const q = st.active[qid];
    if (!q || q.status !== "claimable") return { ok: false };

    // The objectives can all be met , the target really does spawn and really
    // does die , but the hand-in cannot happen: whoever pinned the notice up is
    // dead, and there is nobody at the board to collect from. The quest stays
    // active and claimable for ever rather than failing, so the party keeps
    // whatever they went and fetched.
    if (isEmptyWorld()) {
      return { ok: false, reason: T('Quests.giverIsDead') };
    }

    for (const s of q.steps) {
      if (s.kind === "supply_items") {
        const it = $dataItems[s.itemId];
        if (!it || $gameParty.numItems(it) < s.qty) {
          return { ok: false, reason: T('Quests.youDoNotHaveTheGoods') };
        }
      }
    }
    // A tame creature must still be in the registry at hand-over time.
    for (const s of q.steps) {
      if (s.kind !== "adopt_pet") continue;
      const pets = window.PetSystem?.getPets?.() || [];
      if (!pets.some(p => p && p.enemyId === s.enemyId)) {
        return {
          ok: false,
          reason: T('Quests.theCreatureIsNotWithYouAnyMore'),
        };
      }
    }

    for (const s of q.steps) {
      if (s.kind === "supply_items") $gameParty.loseItem($dataItems[s.itemId], s.qty);
    }

    // Hand the animal over: it leaves the party's registry and goes to the client.
    const handedOver = [];
    for (const s of q.steps) {
      if (s.kind !== "adopt_pet") continue;
      const pets = window.PetSystem?.getPets?.() || [];
      const owned = pets.find(p => p && p.enemyId === s.enemyId);
      if (owned && window.PetSystem?.releasePet) {
        window.PetSystem.releasePet(owned.id);
        handedOver.push(owned.name || s.enemyName);
      }
    }

    const lines = grantRewards(q);
    applyFactionOutcome(q, true);
    applyNpcOutcome(q, true);
    st.claimedCount = (st.claimedCount || 0) + 1;
    delete st.active[qid];

    const secretNote = q.reward.secret ? T('Quests.theSealedRewardTurnsOutToBe') + lines.join(" + ") : "";
    const petNote = handedOver.length
      ? T('Quests.handedOver') + handedOver.join(", ") + "."
      : "";
    kanbanUpdate(qid, T('Quests.contractHonoredReceived') + (lines.join(" + ") || euros(0)) + secretNote + petNote);
    kanbanComplete(qid); // auto-moves the note to Done
    if (handedOver.length) {
      toast(T('Quests.handedOverYourCompanion') + handedOver.join(", "), "warning", 240);
    }
    toast(T('Quests.rewardCollected') + (lines.join(" + ") || euros(0)));
    return { ok: true, lines };
  }

  function failQuest(qid, reason) {
    const st = state();
    const q = st.active[qid];
    if (!q || q.status === "failed") return;
    q.status = "failed";

    let penaltyNote = "";
    if (q.penaltyGold > 0) {
      const paid = Math.min($gameParty.gold(), q.penaltyGold);
      if (paid > 0) $gameParty.loseGold(paid);
      const shortfall = q.penaltyGold - paid;
      penaltyNote = T('Quests.penaltyPaid') + euros(paid) + ".";
      if (shortfall > 0 && window.CrimeSystem) {
        window.CrimeSystem.addCrime(T('Quests.unpaidContractPenalty'), shortfall);
        penaltyNote += T('Quests.theUnpaidRemainderBecameABounty');
      }
    }
    if (q.bountyOnFail > 0 && window.CrimeSystem) {
      window.CrimeSystem.addCrime(T('Quests.breachOfContract'), q.bountyOnFail);
      penaltyNote += T('Quests.aBreachOfContractWarrantWasFiled');
    }
    if (!q.scam) {
      applyFactionOutcome(q, false);
      applyNpcOutcome(q, false);
    }

    kanbanFail(qid, T('Quests.failed') + (reason || T('Quests.theContractExpired')) + penaltyNote);
    toast(T('Quests.questFailed') + q.title, "danger", 240);
    delete st.active[qid];
    // Bounty targets registered in bounties() stay in the world regardless.
  }

  function abandonQuest(qid) {
    const q = state().active[qid];
    if (!q) return;
    failQuest(qid, T('Quests.contractAbandoned'));
  }

  // ==========================================================================
  // Deadline ticking + polled steps (arena, market, procurement timers)
  // ==========================================================================
  function tickDeadlines() {
    const now = nowMinutes();
    // Taming happens on the way back from a battle, which is not a map load, so
    // the pet registry is polled here too.
    checkPetSteps();
    for (const q of activeQuests()) {
      if (q.status === "failed") continue;

      // A deadline is somebody expecting you by a certain hour. In an empty
      // world nobody is expecting anything, so nothing runs out: a quest that
      // cannot be handed in must not also be failed, fined and held against
      // the party for not handing it in.
      if (q.deadlineAt && now >= q.deadlineAt && q.status === "active" && !isEmptyWorld()) {
        failQuest(q.qid, q.scam
          ? T('Quests.theSellerNeverExistedYouHaveBeenScammed')
          : T('Quests.theDeadlinePassed'));
        continue;
      }

      for (let i = 0; i < q.steps.length; i++) {
        if (!stepIsActive(q, i)) continue;
        const s = q.steps[i];
        if (s.kind === "wait_delivery" && !q.scam) {
          if (!s.readyAt) s.readyAt = q.acceptedAt + s.hours * 60;
          if (now >= s.readyAt) {
            completeStep(q, i, T('Quests.theGoodsHaveArrived'));
            toast(T('Quests.yourGoodsAreReadyForPickupAtAnyQuestBoard'));
          }
        } else if (s.kind === "arena_wins") {
          if (s.baseline < 0) s.baseline = $gameVariables.value(ARENA_WINS_VAR) || 0;
          const wins = ($gameVariables.value(ARENA_WINS_VAR) || 0) - s.baseline;
          if (wins >= s.count) completeStep(q, i, T('Quests.arenaRecordFulfilled'));
        } else if (s.kind === "market_shares") {
          if (($gameVariables.value(OIL_SHARES_VAR) || 0) >= s.count) {
            completeStep(q, i, T('Quests.positionAcquiredTheCollectiveIsPleased'));
          }
        }
      }
    }
  }

  // ==========================================================================
  // Arrival detection (goto_dest steps)
  // ==========================================================================
  function onMapEntered(mapId) {
    for (const { q, s, i } of activeSteps()) {
      if (s.kind === "goto_dest" && placeMatchesHere(s.dest)) {
        completeStep(q, i, T('Quests.youReached') + s.dest + ".");
        toast(T('Quests.destinationReached') + s.dest);
      }
    }
    checkPetSteps();
  }

  // A pet contract is satisfied the moment the named creature is in the registry,
  // wherever it was tamed; the animal is handed over on claim.
  function checkPetSteps() {
    const pets = window.PetSystem?.getPets?.();
    if (!pets || !pets.length) return;
    for (const { q, s, i } of activeSteps()) {
      if (s.kind !== "adopt_pet") continue;
      const owned = pets.find(p => p && p.enemyId === s.enemyId);
      if (!owned) continue;
      s.petId = owned.id;
      completeStep(q, i, T('Quests.tamed') + (owned.name || s.enemyName)
        + T('Quests.handItOverAtAnyQuestBoard'));
      toast(T('Quests.tamedForAContract') + (owned.name || s.enemyName));
    }
  }

  // Called by QuestBoardUI whenever a board is opened.
  function onBoardOpened(boardKey) {
    const bn = norm(boardKey);
    // Remembering boards is what makes courier contracts possible: they are only
    // ever addressed to a board the party has stood in front of.
    rememberBoard(boardKey);
    checkPetSteps();
    for (const { q, s, i } of activeSteps()) {
      if (s.kind === "deliver_board" && (norm(s.dest) === bn || placeMatchesHere(s.dest))) {
        completeStep(q, i, T('Quests.deliveredTo') + s.dest + ".");
        toast(T('Quests.deliveryComplete') + s.dest);
      } else if (s.kind === "supply_items") {
        const it = $dataItems[s.itemId];
        if (it && $gameParty.numItems(it) >= s.qty) {
          completeStep(q, i, T('Quests.goodsReadyToHandOver'));
        }
      }
    }
    tickDeadlines();
  }

  // ==========================================================================
  // Procedural map site spawning (map 636)
  // ==========================================================================
  function currentSiteKey() {
    const wx = $gameVariables.value(43), wy = $gameVariables.value(44);
    return { wx, wy, key: wx + "," + wy, isPlanet: wx === PLANET_COORD && wy === PLANET_COORD };
  }

  function currentPlanetKey() {
    const ship = $gameSystem?.starMapData?.playerShip;
    if (!ship || !ship.currentPlanet) return null;
    return { system: ship.currentSystem, planet: ship.currentPlanet };
  }

  function stepMatchesHere(s, here, pk) {
    if (here.isPlanet) {
      return s.kind === "planet_cache" && pk
        && s.planet.planet === pk.planet && s.planet.system === pk.system;
    }
    return !!s.site && s.site.wx === here.wx && s.site.wy === here.wy;
  }

  // Deterministic passable tile near the map centre (never on an event).
  function findSpawnTile(seedKey, minR, maxR) {
    const rng = mulberry32(hashStr(seedKey));
    const w = $dataMap.width, h = $dataMap.height;
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    for (let attempt = 0; attempt < 220; attempt++) {
      const r = minR + rng() * (maxR - minR);
      const a = rng() * Math.PI * 2;
      const x = Math.max(2, Math.min(w - 3, Math.round(cx + Math.cos(a) * r)));
      const y = Math.max(2, Math.min(h - 3, Math.round(cy + Math.sin(a) * r)));
      if (!$gameMap.checkPassage(x, y, 0x0f)) continue;
      if ($gameMap.regionId(x, y) === 99) continue;
      if ($gameMap.eventsXy(x, y).length) continue;
      return { x, y };
    }
    return { x: cx, y: cy + 2 };
  }

  function makeEventData(id, name, x, y, img, trigger, priorityType, moveType) {
    return {
      id, name, note: "", x, y,
      pages: [{
        conditions: {
          actorId: 1, actorValid: false, itemId: 1, itemValid: false,
          selfSwitchCh: "A", selfSwitchValid: false,
          switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
          variableId: 1, variableValid: false, variableValue: 0,
        },
        directionFix: false,
        image: { tileId: 0, characterName: img.name, direction: img.dir || 2, pattern: img.pattern != null ? img.pattern : 1, characterIndex: img.index || 0 },
        list: [{ code: 0, indent: 0, parameters: [] }],
        moveFrequency: 4,
        moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: true, wait: false },
        moveSpeed: 3, moveType: moveType || 0, priorityType, stepAnime: false, through: false,
        trigger, walkAnime: true,
      }],
    };
  }

  function injectEvent(data) {
    const id = $dataMap.events.length;
    data.id = id;
    $dataMap.events[id] = data;
    const ev = new Game_Event($gameMap._mapId, id);
    $gameMap._events[id] = ev;
    return ev;
  }

  // Stamp single-tile Statue/SignPost features around the anchor.
  function stampScanFeatures(q, s, i) {
    const U = window.ProcGenUtils;
    if (!U || !$dataMap) return 0;
    const featureName = s.kind === "signs" ? "SignPost" : "Statue"; // i18n-ignore: Features.json ids
    const tilesetId = $dataMap.tilesetId;
    const feats = U.Cache.getTilesetFeatures(tilesetId);
    const variants = (feats && feats[featureName])
      ? feats[featureName].filter(v => v.type === "single" && v.tileId) : [];
    if (!variants.length) return 0;
    const w = $dataMap.width, h = $dataMap.height;
    const rng = mulberry32(hashStr(q.qid + ":" + i + ":scan"));
    let stamped = 0;
    for (let k = 0; k < s.count; k++) {
      const spot = findSpawnTile(q.qid + ":" + i + ":sc:" + k, 6, 22);
      const tileId = variants[Math.floor(rng() * variants.length)].tileId;
      const idx3 = 3 * w * h + spot.y * w + spot.x;
      if ($dataMap.data[idx3] === 0) {
        $dataMap.data[idx3] = tileId;
        stamped++;
      }
    }
    if ($gameMap) $gameMap.requestRefresh();
    return stamped;
  }

  function spawnSitesOnProcMap() {
    if (!$gameMap || $gameMap.mapId() !== PROC_MAP_ID || !$dataMap) return;
    const here = currentSiteKey();
    const pk = here.isPlanet ? currentPlanetKey() : null;

    // Bounty monsters: independent of quest lifecycle, until killed.
    if (!here.isPlanet) {
      const b = bounties()[here.key];
      if (b && !b.killed) {
        const spot = findSpawnTile("bounty:" + here.key, 8, 24);
        // i18n-ignore-start: sprite sheet names (img/characters/NPCs, one
        // character apiece, so the index is always 0)
        const CRIMINAL_SPRITES = [
          "NPCs/!$OrcWarrior1", "NPCs/!$Lich3", "NPCs/!$VoidAbstracter1",
          "NPCs/!$Evil014", "NPCs/!$Evil015", "NPCs/!$GoblinRaider1",
          "NPCs/!$BotExplorer1", "NPCs/!$Ninja2",
        ];
        const BEAST_SPRITES = [
          "NPCs/!$GoblinJester1", "NPCs/!$GoblinKnight1", "NPCs/!$GoblinCourier1",
          "NPCs/!$GoblinRecruit1", "NPCs/!$GoblinCleric1", "NPCs/!$Lich1",
          "NPCs/!$Lich2", "NPCs/!$OrcBrawler1", "NPCs/!$GoblinArtist1",
          "NPCs/!$VoidSpawn1", "NPCs/!$VoidSpawn2",
        ];
        // i18n-ignore-end
        const pool = b.criminal ? CRIMINAL_SPRITES : BEAST_SPRITES;
        const img = {
          name: pool[irange(mulberry32(hashStr(here.key + "i")), 0, pool.length - 1)],
          index: 0,
        };
        injectEvent(makeEventData(0, "PQBounty:" + here.key, spot.x, spot.y, img, 2, 1, 1));
      }
    }

    for (const { q, s, i } of activeSteps()) {
      if (!stepMatchesHere(s, here, pk)) continue;
      switch (s.kind) {
        case "cache":
        case "planet_cache": {
          if (s.opened) break;
          const spot = findSpawnTile(q.qid + ":" + i + ":cache", 8, 26);
          injectEvent(makeEventData(0, "PQSite:" + q.qid + ":" + i, spot.x, spot.y, { name: "!Chest", index: 0, dir: 2, pattern: 1 }, 0, 1, 0)); // i18n-ignore: event name and sprite sheet
          toast(T('Quests.theCacheIsSomewhereOnThisMap'));
          break;
        }
        case "dig": {
          if (s.opened) break;
          const spot = findSpawnTile(q.qid + ":" + i + ":dig", 8, 26);
          injectEvent(makeEventData(0, "PQSite:" + q.qid + ":" + i, spot.x, spot.y, { name: "!Chest", index: 1, dir: 2, pattern: 1 }, 0, 1, 0)); // i18n-ignore: event name and sprite sheet
          toast(T('Quests.theDigSiteIsMarkedSomewhereOnThisMap'));
          break;
        }
        case "statues":
        case "signs": {
          const stamped = stampScanFeatures(q, s, i);
          const already = Object.keys(s.scanned).length;
          if (!stamped && already === 0) {
            // Tileset without the needed features: degrade to a site survey.
            completeStep(q, i, T('Quests.nothingToScanSurvivedHereTheSurveyItselfWill'));
          } else {
            toast((s.kind === "signs" ? T('Quests.signsVerified') : T('Quests.statuesScanned')) + already + "/" + s.count);
          }
          break;
        }
        case "clearing": {
          // A site whose biome grows nothing clearable would trap the contract
          // forever, so it degrades the same way a scan site without statues does.
          if (!s.cleared && countClearableHere() === 0) {
            completeStep(q, i, T('Quests.nothingLeftToClearHereTheGroundIsAlreadyBare'));
            break;
          }
          toast(T('Quests.obstaclesClearedHere') + s.cleared + "/" + s.count);
          break;
        }
        case "goto_site": {
          completeStep(q, i, T('Quests.coordinatesReachedAndSurveyed'));
          toast(T('Quests.siteSurveyed'));
          break;
        }
        case "bounty": {
          // Spawn is driven by the persistent bounty store above; make sure
          // the entry exists even after a reload mid-quest.
          registerBountyStep(q, s);
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Site interaction (PQSite / PQBounty events)
  // ==========================================================================
  function grantStepLoot(q, s) {
    const found = [];
    for (const m of q.reward.materials) {
      const it = $dataItems[m.id];
      if (it) { $gameParty.gainItem(it, m.qty); found.push(m.qty + "x " + it.name); }
    }
    q.reward.materials = [];
    const gear = gearObject(q.reward.gear);
    if (gear) { $gameParty.gainItem(gear, 1); found.push(gear.name); q.reward.gear = null; }
    if (q.reward.artifactLevel > 0 && typeof $gameSystem.generateArtifact === "function") {
      const id = $gameSystem.generateArtifact(q.reward.artifactLevel);
      if (id > 0) {
        $gameParty.gainItem($dataItems[id], 1);
        found.push($dataItems[id].name);
        registerArtifactToParty(id, q);
      }
      q.reward.artifactLevel = 0;
    }
    return found;
  }

  function onSiteEvent(gameEvent, name) {
    if (name.startsWith("PQBounty:")) {
      const key = name.slice("PQBounty:".length);
      const b = bounties()[key];
      if (!b || b.killed) { $gameMap.eraseEvent(gameEvent.eventId()); return; }
      const troop = $dataTroops[b.enemyId];
      if (!troop) { $gameMap.eraseEvent(gameEvent.eventId()); return; }
      BattleManager.setup(b.enemyId, true, false);
      BattleManager.setEventCallback(result => {
        if (result === 0) onBountyKilled(key, gameEvent.eventId());
      });
      $gamePlayer.makeEncounterCount();
      SceneManager.push(Scene_Battle);
      return;
    }

    // PQSite:<qid>:<stepIndex>
    const parts = name.slice("PQSite:".length).split(":");
    const qid = parts[0];
    const idx = Number(parts[1]) || 0;
    const q = state().active[qid];
    const s = q && q.steps[idx];
    if (!q || !s || s.done) { $gameMap.eraseEvent(gameEvent.eventId()); return; }

    if (s.kind === "dig") {
      if (!$gameParty.hasItem($dataItems[SHOVEL_ITEM_ID])) {
        toast(T('Quests.youNeedAShovelToExcavateThis'), "warning");
        return;
      }
      AudioManager.playSe({ name: "Earth1", volume: 90, pitch: 100, pan: 0 });
    } else {
      AudioManager.playSe({ name: "Chest1", volume: 90, pitch: 100, pan: 0 });
    }

    s.opened = true;
    $gameMap.eraseEvent(gameEvent.eventId());

    let found = [];
    if (s.loot) found = grantStepLoot(q, s);
    if (q.reward.secret && found.length) {
      toast(T('Quests.sealedContentsRecovered') + found.join(" + "), "info", 240);
    } else if (found.length) {
      toast(T('Quests.recovered') + found.join(" + "));
    }
    completeStep(q, idx,
      (s.kind === "dig" ? T('Quests.excavationFinished') : T('Quests.cacheRecovered'))
      + (found.length ? " (" + found.join(", ") + ")" : ""));
  }

  function onBountyKilled(key, eventId) {
    const b = bounties()[key];
    if (!b) return;
    b.killed = true;
    delete bounties()[key];
    if (eventId && $gameMap) $gameMap.eraseEvent(eventId);

    const q = state().active[b.qid];
    if (q) {
      for (let i = 0; i < q.steps.length; i++) {
        const s = q.steps[i];
        if (s.kind === "bounty" && !s.done && s.enemyId === b.enemyId && stepIsActive(q, i)) {
          completeStep(q, i, (s.criminal ? T('Quests.warrantExecutedOn') : T('Quests.beastSlain')) + b.name + ".");
          toast(T('Quests.bountyTargetEliminated') + b.name);
          return;
        }
      }
    }
    toast(T('Quests.youKilled') + b.name + T('Quests.whateverContractWantedItDeadIsLongGone'));
  }

  // ==========================================================================
  // Scan / clearing detection (TerrainInteractions interaction funnel)
  // ==========================================================================
  const CLEARING_FEATURES = ["Tree", "Rock", "Rubble", "Bush", "TreeIce", "RockIce"]; // i18n-ignore: Features.json ids

  // How many clearable features actually stand on this map. Used to detect a site
  // where a clearing contract could never be finished.
  function countClearableHere() {
    const U = window.ProcGenUtils;
    if (!U || !$dataMap || !$gameMap) return 0;
    const tileset = $gameMap.tileset();
    if (!tileset) return 0;
    try {
      const feats = U.Cache.getTilesetFeatures(tileset.id);
      const map = U.createTileToFeatureMap(feats);
      const w = $dataMap.width, h = $dataMap.height;
      let n = 0;
      for (let z of [2, 3]) {
        const base = z * w * h;
        for (let i = 0; i < w * h; i++) {
          const tileId = $dataMap.data[base + i];
          if (!tileId) continue;
          const name = U.getFeatureNameFromTileId(tileId, map);
          if (name && CLEARING_FEATURES.includes(name)) {
            if (++n >= 1) return n;
          }
        }
      }
      return n;
    } catch (e) { return 1; } // unknown: assume clearable rather than auto-pass
  }

  function facedFeatureInfo(character) {
    const U = window.ProcGenUtils;
    const ch = character || $gamePlayer;
    if (!U || !$gameMap || !ch) return null;
    const tileset = $gameMap.tileset();
    if (!tileset) return null;
    const d = ch.direction();
    const x = $gameMap.roundXWithDirection(ch.x, d);
    const y = $gameMap.roundYWithDirection(ch.y, d);
    const feats = U.Cache.getTilesetFeatures(tileset.id);
    const map = U.createTileToFeatureMap(feats);
    for (const z of [3, 2]) {
      const tileId = $gameMap.tileId(x, y, z);
      if (tileId !== 0) return { name: U.getFeatureNameFromTileId(tileId, map), x, y, z };
    }
    return null;
  }

  function scanStepsHere() {
    if (!$gameMap || $gameMap.mapId() !== PROC_MAP_ID) return [];
    const here = currentSiteKey();
    if (here.isPlanet) return [];
    return activeSteps().filter(({ s }) =>
      (s.kind === "statues" || s.kind === "signs" || s.kind === "clearing")
      && stepMatchesHere(s, here, null));
  }

  // Dismantling clears its tiles only after the player confirms an async
  // choice menu, so clearing steps cannot be verified synchronously. Each
  // interaction with a clearable feature becomes a pending watch that is
  // resolved (tile actually gone) or expired on later frames.
  const _pendingClears = [];

  function handleFeatureInteraction(before) {
    const pairs = scanStepsHere();
    if (!pairs.length || !before || !before.name) return;

    for (const { q, s, i } of pairs) {
      if (s.kind === "statues" && before.name === "Statue") { // i18n-ignore: Features.json id
        recordScan(q, s, i, before, T('Quests.statueScanned'), T('Quests.allStatuesScannedAndCatalogued'));
      } else if (s.kind === "signs" && (before.name === "SignPost" || before.name === "SignPostIce")) {
        recordScan(q, s, i, before, T('Quests.signpostVerified'), T('Quests.everySignpostCheckedAgainstTheRegistry'));
      } else if (s.kind === "clearing" && CLEARING_FEATURES.includes(before.name)) {
        const tileKey = before.x + "," + before.y;
        if (s.clearedTiles && s.clearedTiles[tileKey]) continue;
        if (_pendingClears.some(p => p.qid === q.qid && p.i === i && p.x === before.x && p.y === before.y)) continue;
        _pendingClears.push({ qid: q.qid, i, x: before.x, y: before.y, z: before.z, frames: 0 });
      }
    }
  }

  function processPendingClears() {
    if (!_pendingClears.length || !$gameMap || $gameMap.mapId() !== PROC_MAP_ID) {
      _pendingClears.length = 0;
      return;
    }
    for (let k = _pendingClears.length - 1; k >= 0; k--) {
      const p = _pendingClears[k];
      const gone = $gameMap.tileId(p.x, p.y, p.z) === 0;
      if (!gone) {
        // Expire watches the player walked away from (menu cancelled).
        if (++p.frames > 900) _pendingClears.splice(k, 1);
        continue;
      }
      _pendingClears.splice(k, 1);
      const q = state().active[p.qid];
      const s = q && q.steps[p.i];
      if (!q || !s || s.done || !stepIsActive(q, p.i)) continue;
      s.clearedTiles = s.clearedTiles || {};
      const tileKey = p.x + "," + p.y;
      if (s.clearedTiles[tileKey]) continue;
      s.clearedTiles[tileKey] = true;
      s.cleared = (s.cleared || 0) + 1;
      AudioManager.playSe({ name: "Decision2", volume: 80, pitch: 110, pan: 0 });
      if (s.cleared >= s.count) {
        completeStep(q, p.i, T('Quests.groundClearedAsContracted'));
        toast(T('Quests.clearingComplete'));
      } else {
        toast(T('Quests.obstacleCleared') + s.cleared + "/" + s.count + ")");
        kanbanProgress(q);
      }
    }
  }

  function recordScan(q, s, i, before, progressLabel, doneNote) {
    const key = before.x + "," + before.y;
    if (s.scanned[key]) return;
    s.scanned[key] = true;
    const n = Object.keys(s.scanned).length;
    AudioManager.playSe({ name: "Decision2", volume: 80, pitch: 130, pan: 0 });
    if (n >= s.count) {
      completeStep(q, i, doneNote);
      toast(doneNote);
    } else {
      toast(progressLabel + n + "/" + s.count + ")");
      kanbanUpdate(q.qid, progressLabel + n + "/" + s.count + ")");
      kanbanProgress(q);
    }
  }

  function wireTerrainInteractions() {
    const TD = window.TerrainInteractions;
    if (!TD || TD._pqWired || typeof TD.tryInteract !== "function") return;
    TD._pqWired = true;
    const orig = TD.tryInteract;
    TD.tryInteract = function (...args) {
      const watching = scanStepsHere().length > 0;
      const before = watching ? facedFeatureInfo(args[0]) : null;
      const handled = orig.apply(this, args);
      if (handled && watching) {
        try { handleFeatureInteraction(before); } catch (e) { }
      }
      return handled;
    };
  }

  // ==========================================================================
  // Battle kill counting (cull steps)
  // ==========================================================================
  const _BattleManager_processVictory = BattleManager.processVictory;
  BattleManager.processVictory = function () {
    try {
      const slain = $gameTroop ? $gameTroop.deadMembers().length : 0;
      if (slain > 0) {
        for (const { q, s, i } of activeSteps()) {
          if (s.kind !== "cull_kills") continue;
          s.kills = (s.kills || 0) + slain;
          if (s.kills >= s.count) {
            completeStep(q, i, T('Quests.cullQuotaMet'));
          } else {
            toast(T('Quests.cullProgress') + s.kills + "/" + s.count);
            kanbanProgress(q);
          }
        }
      }
    } catch (e) { }
    _BattleManager_processVictory.call(this);
  };

  // ==========================================================================
  // Off-world helpers (GalaxySim markers + landing detection)
  // ==========================================================================
  function questForPlanet(systemName, planetName) {
    for (const { q, s } of activeSteps()) {
      if (s.kind !== "planet_cache") continue;
      if (planetName && s.planet.planet !== planetName) continue;
      if (systemName && s.planet.system !== systemName) continue;
      return q;
    }
    return null;
  }

  function questForSystem(systemName) {
    for (const { q, s } of activeSteps()) {
      if (s.kind === "planet_cache" && s.planet.system === systemName) return q;
    }
    return null;
  }

  const QUEST_BANNER =
    '<div class="gx-title" style="color:var(--accent-gold-pure,#ffd700);font-size:12px;">' +
    "⚑ QUEST TARGET</div>";

  function wireGalaxyMarkers() {
    const O = window.GalaxySim?.Overlay?.GalaxyOverlay;
    if (!O || O.prototype._pqWired) return;
    O.prototype._pqWired = true;

    const _showSystem = O.prototype.showSystem;
    O.prototype.showSystem = function (system, opts) {
      _showSystem.call(this, system, opts);
      try {
        if (system && questForSystem(system.name) && this.els.info) {
          this.els.info.insertAdjacentHTML("afterbegin", QUEST_BANNER);
        }
      } catch (e) { }
    };

    const _showBody = O.prototype.showBody;
    O.prototype.showBody = function (body, system, opts) {
      _showBody.call(this, body, system, opts);
      try {
        if (body && questForPlanet(system ? system.name : null, body.name) && this.els.info) {
          this.els.info.insertAdjacentHTML("afterbegin", QUEST_BANNER);
        }
      } catch (e) { }
    };

    const _showLandingGrid = O.prototype.showLandingGrid;
    O.prototype.showLandingGrid = function (planet, opts) {
      _showLandingGrid.call(this, planet, opts);
      try {
        if (planet && questForPlanet(null, planet.name) && this.els.landingGridTitle) {
          this.els.landingGridTitle.textContent += "  ⚑ " + T('Quests.questTarget');
        }
      } catch (e) { }
    };
  }

  // ==========================================================================
  // Interview detection (NPCEmpathize wrap)
  // ==========================================================================
  function wireEmpathize() {
    const E = window.NPCEmpathize;
    if (!E || E._pqWired) return;
    E._pqWired = true;
    const after = () => {
      try {
        for (const { q, s, i } of activeSteps()) {
          if (s.kind !== "interview") continue;
          if (placeMatchesHere(s.dest)) {
            completeStep(q, i, T('Quests.interviewRecordedIn') + s.dest + ".");
            toast(T('Quests.interviewComplete') + s.dest);
          }
        }
      } catch (e) { }
    };
    for (const fn of ["open", "openByName"]) {
      if (typeof E[fn] === "function") {
        const orig = E[fn];
        E[fn] = function (...args) { const r = orig.apply(this, args); after(); return r; };
      }
    }
  }

  // ==========================================================================
  // Engine hooks
  // ==========================================================================
  const _Scene_Boot_start = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    _Scene_Boot_start.call(this);
    wireGalaxyMarkers();
    wireEmpathize();
    wireTerrainInteractions();
  };

  const _Game_Map_setup_pq = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    _Game_Map_setup_pq.call(this, mapId);
    _boardKeyCacheMapId = -1;
    _boardKeyCache = null;
    try {
      if (!$gameSystem) return;
      if (mapId === PROC_MAP_ID) spawnSitesOnProcMap();
      else onMapEntered(mapId);
    } catch (e) {
      console.error("[ProceduralQuests] site spawn failed", e);
    }
  };

  const _Game_Event_start_pq = Game_Event.prototype.start;
  Game_Event.prototype.start = function () {
    const name = this.event() && this.event().name;
    if (name && (name.startsWith("PQSite:") || name.startsWith("PQBounty:"))) {
      try { onSiteEvent(this, name); }
      catch (e) { console.error("[ProceduralQuests] site event failed", e); }
      return;
    }
    _Game_Event_start_pq.call(this);
  };

  let _pqTick = 0;
  const _Scene_Map_update_pq = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update_pq.call(this);
    if (_pendingClears.length) {
      try { processPendingClears(); } catch (e) { }
    }
    if (++_pqTick >= 240) {
      _pqTick = 0;
      try { if ($gameSystem) tickDeadlines(); } catch (e) { }
    }
  };

  // ==========================================================================
  // Debug: generate + accept a random quest instantly (Sandbox button)
  // ==========================================================================
  function debugGenerateQuest() {
    const boardKey = currentBoardKey();
    const rng = mulberry32(hashStr(String(Date.now())));
    const slot = 1000 + irange(rng, 0, 999999);
    const o = buildOffer(boardKey, dayIndex(), slot);
    const res = acceptOffer(o);
    if (res.ok) toast(T('Quests.debugQuestAccepted') + o.title);
    else toast(res.reason || "?", "warning");
    return res;
  }

  PluginManager.registerCommand(PLUGIN, "debugGenerateQuest", () => {
    debugGenerateQuest();
  });

  // ==========================================================================
  // Board opening
  //
  // The scene itself lives in QuestBoardUI.js (which registers the same command
  // under its own plugin name). Exposing it here too means an event only needs
  // the engine plugin selected to put a working board on a map.
  // ==========================================================================
  function openQuestBoard(boardKey) {
    if (!window.Scene_QuestBoard) {
      console.error("[ProceduralQuests] openQuestBoard needs QuestBoardUI.js");
      toast(T('Quests.theBoardIsBareNobodyIsPostingToday'), "warning");
      return false;
    }
    SceneManager.push(window.Scene_QuestBoard);
    SceneManager.prepareNextScene(boardKey || null);
    return true;
  }

  PluginManager.registerCommand(PLUGIN, "openQuestBoard", args => {
    const boardKey = (args && args.boardKey) ? String(args.boardKey).trim() : "";
    openQuestBoard(boardKey || null);
  });

  // ==========================================================================
  // Public API (used by QuestBoardUI and SandboxMode)
  // ==========================================================================
  window.ProceduralQuests = {
    // board side
    openQuestBoard, resolveBoardKey,
    currentBoardKey, offersForBoard, acceptOffer, claimQuest, abandonQuest,
    onBoardOpened, activeQuests, rewardText, termsLines, objectiveText,
    stepText, hoursLeftText, deadlineStamp, factionName, euros, medianLevel,
    nowMinutes, firstUndoneIndex,
    // world side
    questForPlanet, questForSystem, failQuest, debugGenerateQuest,
    state, bounties,
    // map side
    questMarkers, questLocation, destCoords, sitePlace, siteText,
    // social side
    npcQuestHistory, placeMatchesHere, knownBoards, partyArtifacts,
  };
})();
