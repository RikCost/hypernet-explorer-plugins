/*:
 * @target MZ
 * @plugindesc GalaxySim Ship Model - Procedural, textured starship generator seeded from the world seed, plus the appearance editor modal.
 * @author Omni-Lex + Nocoldiz
 * @url
 * @help
 * ============================================================================
 * GalaxySim Procedural Ship Model
 * ============================================================================
 * Replaces the old placeholder cone with a fully procedural, heavily detailed
 * starship built from real three.js geometry and procedurally painted canvas
 * textures (hull plating, panel lines, livery, decals, lit windows, wear).
 *
 * The default appearance is DERIVED FROM THE WORLD SEED, so a given world
 * always starts with the same ship. The player can then re-roll it from the
 * vehicle menu ("Change Appearance"), which stores an explicit configuration
 * in $gameSystem._starshipAppearance.
 *
 * A configuration is:
 *   { seed: <int>, traits: { <traitKey>: <optionId>, ... } }
 * where `seed` drives every unspecified detail and `traits` holds the explicit
 * player overrides. resolve() merges the two into a full spec.
 *
 * ---------------------------------------------------------------------------
 * API - window.GalaxySim.ShipModel
 * ---------------------------------------------------------------------------
 *   TRAITS                 trait table (key, label, options[]) used by the UI
 *   worldSeed()            canonical world RNG root (HistorySimulator seed)
 *   defaultConfig()        world-seed derived configuration
 *   getConfig()            current saved configuration (or the default)
 *   setConfig(cfg)         persist a configuration and bump `revision`
 *   randomConfig()         a brand new random-seed configuration
 *   cycleTrait(cfg,k,dir)  returns a copy with trait k stepped by dir
 *   resolve(cfg)           full spec { hull, palette, finish, ..., name }
 *   describe(cfg)          [{ key, label, value }] rows for the UI
 *   build(cfg)             { group, update(t), dispose() } - live scene model
 *   createPreview(cv,cfg)  live rotating WebGL preview bound to a canvas
 *   renderPortrait(cfg,px) one-off render, returns a data URL (cached)
 *   revision               increments whenever the appearance changes
 *
 * window.GalaxySim.ShipAppearance.open({ onClose })  - the editor modal
 * Scene_ShipAppearance                              - scene wrapper for maps
 *
 * LOAD ORDER: after GalaxySim_Math.js / GalaxySim_Renderer3D.js and BEFORE
 * GalaxySim_Scene3D_Bodies.js (which asks this module for the ship mesh).
 * Requires THREE.js.
 * ============================================================================
 */

(() => {
  "use strict";

  if (!window.GalaxySim) window.GalaxySim = {};
  const GS = window.GalaxySim;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ==========================================================================
  // Seeded RNG (mulberry32) + string hashing
  // ==========================================================================

  function hashString(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const range = (rng, lo, hi) => lo + rng() * (hi - lo);
  const irange = (rng, lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));

  // ==========================================================================
  // Trait tables
  // ==========================================================================

  const HULLS = [
    { id: "needle", get label() { return T('ShipModel.hulls.needle'); } },
    { id: "wedge", get label() { return T('ShipModel.hulls.wedge'); } },
    { id: "hauler", get label() { return T('ShipModel.hulls.hauler'); } },
    { id: "saucer", get label() { return T('ShipModel.hulls.saucer'); } },
    { id: "ring", get label() { return T('ShipModel.hulls.ring'); } },
    { id: "cathedral", get label() { return T('ShipModel.hulls.cathedral'); } },
    { id: "organic", get label() { return T('ShipModel.hulls.organic'); } },
    { id: "lancer", get label() { return T('ShipModel.hulls.lancer'); } },
    { id: "modular", get label() { return T('ShipModel.hulls.modular'); } },
    { id: "shuttle", get label() { return T('ShipModel.hulls.shuttle'); } },
  ];

  // primary = plating, secondary = livery bands, accent = trim/decals,
  // trim = structural metal, glow = drive & window light.
  const PALETTES = [
    { id: "bone", get label() { return T('ShipModel.palettes.bone'); }, primary: "#d8d3c6", secondary: "#26406e", accent: "#e2a13b", trim: "#5c5f68", glow: "#78c8ff" },
    { id: "gunmetal", get label() { return T('ShipModel.palettes.gunmetal'); }, primary: "#6b7078", secondary: "#3a3e46", accent: "#c8582f", trim: "#41454c", glow: "#ff9a4d" },
    { id: "ivoryred", get label() { return T('ShipModel.palettes.ivoryred'); }, primary: "#e7e2d6", secondary: "#93251f", accent: "#2b2b2b", trim: "#7d7a71", glow: "#ffd08a" },
    { id: "verdigris", get label() { return T('ShipModel.palettes.verdigris'); }, primary: "#7f9a86", secondary: "#3f5a4b", accent: "#c8a25a", trim: "#4a5b50", glow: "#9fffd4" },
    { id: "obsidian", get label() { return T('ShipModel.palettes.obsidian'); }, primary: "#23252b", secondary: "#12141a", accent: "#8e2bd6", trim: "#33363f", glow: "#c07bff" },
    { id: "rust", get label() { return T('ShipModel.palettes.rust'); }, primary: "#8c6247", secondary: "#5a3c2c", accent: "#d9a441", trim: "#4b3a30", glow: "#ffb057" },
    { id: "arctic", get label() { return T('ShipModel.palettes.arctic'); }, primary: "#eef2f5", secondary: "#8fb8d4", accent: "#1f5a7a", trim: "#9aa5ad", glow: "#bfe9ff" },
    { id: "imperial", get label() { return T('ShipModel.palettes.imperial'); }, primary: "#3b3324", secondary: "#8d7327", accent: "#e9c766", trim: "#5b4f34", glow: "#ffe8a8" },
    { id: "cardinal", get label() { return T('ShipModel.palettes.cardinal'); }, primary: "#5d1420", secondary: "#2a0a10", accent: "#e6c98a", trim: "#3e2129", glow: "#ff7b6b" },
    { id: "chartreuse", get label() { return T('ShipModel.palettes.chartreuse'); }, primary: "#c8d341", secondary: "#2c2f18", accent: "#1a1c12", trim: "#575c33", glow: "#e8ff5a" },
    { id: "abyss", get label() { return T('ShipModel.palettes.abyss'); }, primary: "#1c3b3f", secondary: "#0d1f22", accent: "#43c9c1", trim: "#274a4e", glow: "#54ffe8" },
    { id: "rose", get label() { return T('ShipModel.palettes.rose'); }, primary: "#e6c2c8", secondary: "#8c5a70", accent: "#43314a", trim: "#a58790", glow: "#ffb8dd" },
    { id: "sable", get label() { return T('ShipModel.palettes.sable'); }, primary: "#3a3a3c", secondary: "#1c1c1e", accent: "#cfd4da", trim: "#5a5d63", glow: "#dfe9ff" },
    { id: "sandstorm", get label() { return T('ShipModel.palettes.sandstorm'); }, primary: "#cbb188", secondary: "#8a7350", accent: "#3d3428", trim: "#7a6a4d", glow: "#ffd98a" },
    { id: "voidviolet", get label() { return T('ShipModel.palettes.voidviolet'); }, primary: "#3b2b57", secondary: "#1d1430", accent: "#c0a2ff", trim: "#4c3a6b", glow: "#b58bff" },
    { id: "medic", get label() { return T('ShipModel.palettes.medic'); }, primary: "#f0f0ea", secondary: "#2f7d5b", accent: "#c0392b", trim: "#9fa39c", glow: "#a8ffd0" },
  ];

  const FINISHES = [
    { id: "matte", get label() { return T('ShipModel.finishes.matte'); }, shininess: 6, specular: 0x191b1f, envish: 0 },
    { id: "satin", get label() { return T('ShipModel.finishes.satin'); }, shininess: 26, specular: 0x2f333a, envish: 0.15 },
    { id: "gloss", get label() { return T('ShipModel.finishes.gloss'); }, shininess: 70, specular: 0x6d7480, envish: 0.35 },
    { id: "metallic", get label() { return T('ShipModel.finishes.metallic'); }, shininess: 44, specular: 0x8a919c, envish: 0.5 },
    { id: "ceramic", get label() { return T('ShipModel.finishes.ceramic'); }, shininess: 14, specular: 0x3a3630, envish: 0.05 },
    { id: "chrome", get label() { return T('ShipModel.finishes.chrome'); }, shininess: 120, specular: 0xcdd6e2, envish: 0.85 },
    { id: "anodized", get label() { return T('ShipModel.finishes.anodized'); }, shininess: 90, specular: 0x5a6cff, envish: 0.4 },
  ];

  const PLATINGS = [
    { id: "rect", get label() { return T('ShipModel.platings.rect'); } },
    { id: "hex", get label() { return T('ShipModel.platings.hex'); } },
    { id: "strake", get label() { return T('ShipModel.platings.strake'); } },
    { id: "diamond", get label() { return T('ShipModel.platings.diamond'); } },
    { id: "ribbed", get label() { return T('ShipModel.platings.ribbed'); } },
    { id: "scale", get label() { return T('ShipModel.platings.scale'); } },
  ];

  const LIVERIES = [
    { id: "none", get label() { return T('ShipModel.liveries.none'); } },
    { id: "stripe", get label() { return T('ShipModel.liveries.stripe'); } },
    { id: "twin", get label() { return T('ShipModel.liveries.twin'); } },
    { id: "chevron", get label() { return T('ShipModel.liveries.chevron'); } },
    { id: "blocks", get label() { return T('ShipModel.liveries.blocks'); } },
    { id: "checker", get label() { return T('ShipModel.liveries.checker'); } },
    { id: "hazard", get label() { return T('ShipModel.liveries.hazard'); } },
    { id: "tiger", get label() { return T('ShipModel.liveries.tiger'); } },
    { id: "heraldry", get label() { return T('ShipModel.liveries.heraldry'); } },
  ];

  const ENGINES = [
    { id: "ion", get label() { return T('ShipModel.engines.ion'); }, nozzle: "cone", flare: 0.9, hue: null },
    { id: "fusion", get label() { return T('ShipModel.engines.fusion'); }, nozzle: "bell", flare: 1.35, hue: "#ffb35c" },
    { id: "pulse", get label() { return T('ShipModel.engines.pulse'); }, nozzle: "ring", flare: 1.0, hue: "#7fd0ff" },
    { id: "warp", get label() { return T('ShipModel.engines.warp'); }, nozzle: "nacelle", flare: 1.15, hue: "#8fb2ff" },
    { id: "antimatter", get label() { return T('ShipModel.engines.antimatter'); }, nozzle: "spike", flare: 1.5, hue: "#d18bff" },
    { id: "solar", get label() { return T('ShipModel.engines.solar'); }, nozzle: "sail", flare: 0.35, hue: "#ffe6a8" },
    { id: "quantum", get label() { return T('ShipModel.engines.quantum'); }, nozzle: "bubble", flare: 1.2, hue: "#66ffd8" },
  ];

  const ENGINE_COUNTS = [
    { id: "1", get label() { return T('ShipModel.engine_counts.1'); } }, { id: "2", get label() { return T('ShipModel.engine_counts.2'); } },
    { id: "3", get label() { return T('ShipModel.engine_counts.3'); } }, { id: "4", get label() { return T('ShipModel.engine_counts.4'); } },
    { id: "6", get label() { return T('ShipModel.engine_counts.6'); } }, { id: "8", get label() { return T('ShipModel.engine_counts.8'); } },
  ];

  const WINGS = [
    { id: "none", get label() { return T('ShipModel.wings.none'); } },
    { id: "delta", get label() { return T('ShipModel.wings.delta'); } },
    { id: "swept", get label() { return T('ShipModel.wings.swept'); } },
    { id: "forward", get label() { return T('ShipModel.wings.forward'); } },
    { id: "xwing", get label() { return T('ShipModel.wings.xwing'); } },
    { id: "gull", get label() { return T('ShipModel.wings.gull'); } },
    { id: "ringwing", get label() { return T('ShipModel.wings.ringwing'); } },
    { id: "solar", get label() { return T('ShipModel.wings.solar'); } },
    { id: "canard", get label() { return T('ShipModel.wings.canard'); } },
    { id: "stub", get label() { return T('ShipModel.wings.stub'); } },
  ];

  const COCKPITS = [
    { id: "canopy", get label() { return T('ShipModel.cockpits.canopy'); } },
    { id: "bubble", get label() { return T('ShipModel.cockpits.bubble'); } },
    { id: "bridge", get label() { return T('ShipModel.cockpits.bridge'); } },
    { id: "blind", get label() { return T('ShipModel.cockpits.blind'); } },
    { id: "spine", get label() { return T('ShipModel.cockpits.spine'); } },
    { id: "pod", get label() { return T('ShipModel.cockpits.pod'); } },
  ];

  const TAILS = [
    { id: "none", get label() { return T('ShipModel.tails.none'); } },
    { id: "fin", get label() { return T('ShipModel.tails.fin'); } },
    { id: "twin", get label() { return T('ShipModel.tails.twin'); } },
    { id: "tri", get label() { return T('ShipModel.tails.tri'); } },
    { id: "vtail", get label() { return T('ShipModel.tails.vtail'); } },
    { id: "shroud", get label() { return T('ShipModel.tails.shroud'); } },
    { id: "radiator", get label() { return T('ShipModel.tails.radiator'); } },
  ];

  const PODS = [
    { id: "none", get label() { return T('ShipModel.pods.none'); } },
    { id: "tanks", get label() { return T('ShipModel.pods.tanks'); } },
    { id: "cargo", get label() { return T('ShipModel.pods.cargo'); } },
    { id: "missiles", get label() { return T('ShipModel.pods.missiles'); } },
    { id: "drones", get label() { return T('ShipModel.pods.drones'); } },
    { id: "mining", get label() { return T('ShipModel.pods.mining'); } },
    { id: "lifeboats", get label() { return T('ShipModel.pods.lifeboats'); } },
  ];

  const DISHES = [
    { id: "none", get label() { return T('ShipModel.dishes.none'); } },
    { id: "dish", get label() { return T('ShipModel.dishes.dish'); } },
    { id: "phased", get label() { return T('ShipModel.dishes.phased'); } },
    { id: "mast", get label() { return T('ShipModel.dishes.mast'); } },
    { id: "dome", get label() { return T('ShipModel.dishes.dome'); } },
    { id: "spine", get label() { return T('ShipModel.dishes.spine'); } },
  ];

  const RINGS = [
    { id: "none", get label() { return T('ShipModel.rings.none'); } },
    { id: "hab", get label() { return T('ShipModel.rings.hab'); } },
    { id: "drive", get label() { return T('ShipModel.rings.drive'); } },
    { id: "dual", get label() { return T('ShipModel.rings.dual'); } },
    { id: "collar", get label() { return T('ShipModel.rings.collar'); } },
  ];

  const GREEBLES = [
    { id: "clean", get label() { return T('ShipModel.greebles.clean'); }, density: 0 },
    { id: "light", get label() { return T('ShipModel.greebles.light'); }, density: 22 },
    { id: "heavy", get label() { return T('ShipModel.greebles.heavy'); }, density: 48 },
    { id: "baroque", get label() { return T('ShipModel.greebles.baroque'); }, density: 84 },
  ];

  const WEARS = [
    { id: "pristine", get label() { return T('ShipModel.wears.pristine'); }, amount: 0.0 },
    { id: "scuffed", get label() { return T('ShipModel.wears.scuffed'); }, amount: 0.25 },
    { id: "weathered", get label() { return T('ShipModel.wears.weathered'); }, amount: 0.5 },
    { id: "battered", get label() { return T('ShipModel.wears.battered'); }, amount: 0.75 },
    { id: "derelict", get label() { return T('ShipModel.wears.derelict'); }, amount: 1.0 },
  ];

  const LIGHTS = [
    { id: "standard", get label() { return T('ShipModel.lights.standard'); } },
    { id: "strobe", get label() { return T('ShipModel.lights.strobe'); } },
    { id: "halo", get label() { return T('ShipModel.lights.halo'); } },
    { id: "runway", get label() { return T('ShipModel.lights.runway'); } },
    { id: "dark", get label() { return T('ShipModel.lights.dark'); } },
  ];

  // Grunge overlays sampled from the shared texture library (img/textures).
  const GRUNGES = [
    { id: "none", get label() { return T('ShipModel.grunges.none'); }, file: null },
    { id: "concrete", get label() { return T('ShipModel.grunges.concrete'); }, file: "weathered_concrete.jpg" },
    { id: "smoke", get label() { return T('ShipModel.grunges.smoke'); }, file: "dark_grey_smoke.jpg" },
    { id: "slate", get label() { return T('ShipModel.grunges.slate'); }, file: "blue_slate.jpg" },
    { id: "patina", get label() { return T('ShipModel.grunges.patina'); }, file: "copper_patina.jpg" },
    { id: "rust", get label() { return T('ShipModel.grunges.rust'); }, file: "rust_copper_marble.jpg" },
    { id: "oil", get label() { return T('ShipModel.grunges.oil'); }, file: "iridescent_oil.jpg" },
    { id: "verdigris", get label() { return T('ShipModel.grunges.verdigris'); }, file: "turquoise_verdigris.jpg" },
    { id: "cracked", get label() { return T('ShipModel.grunges.cracked'); }, file: "cracked_earth.jpg" },
    { id: "marble", get label() { return T('ShipModel.grunges.marble'); }, file: "grey_smoke_marble.jpg" },
    { id: "gold", get label() { return T('ShipModel.grunges.gold'); }, file: "molten_gold.jpg" },
    { id: "malachite", get label() { return T('ShipModel.grunges.malachite'); }, file: "malachite.jpg" },
  ];

  const TRAITS = [
    { key: "hull", get label() { return T('ShipModel.axis.hull'); }, options: HULLS },
    { key: "palette", get label() { return T('ShipModel.axis.palette'); }, options: PALETTES },
    { key: "finish", get label() { return T('ShipModel.axis.finish'); }, options: FINISHES },
    { key: "plating", get label() { return T('ShipModel.axis.plating'); }, options: PLATINGS },
    { key: "livery", get label() { return T('ShipModel.axis.livery'); }, options: LIVERIES },
    { key: "grunge", get label() { return T('ShipModel.axis.grunge'); }, options: GRUNGES },
    { key: "wear", get label() { return T('ShipModel.axis.wear'); }, options: WEARS },
    { key: "engine", get label() { return T('ShipModel.axis.engine'); }, options: ENGINES },
    { key: "engineCount", get label() { return T('ShipModel.axis.engineCount'); }, options: ENGINE_COUNTS },
    { key: "wings", get label() { return T('ShipModel.axis.wings'); }, options: WINGS },
    { key: "cockpit", get label() { return T('ShipModel.axis.cockpit'); }, options: COCKPITS },
    { key: "tail", get label() { return T('ShipModel.axis.tail'); }, options: TAILS },
    { key: "pods", get label() { return T('ShipModel.axis.pods'); }, options: PODS },
    { key: "dish", get label() { return T('ShipModel.axis.dish'); }, options: DISHES },
    { key: "ring", get label() { return T('ShipModel.axis.ring'); }, options: RINGS },
    { key: "greebles", get label() { return T('ShipModel.axis.greebles'); }, options: GREEBLES },
    { key: "lights", get label() { return T('ShipModel.axis.lights'); }, options: LIGHTS },
  ];

  const TRAIT_BY_KEY = {};
  TRAITS.forEach((t) => { TRAIT_BY_KEY[t.key] = t; });

  const optionOf = (traitKey, id) => {
    const t = TRAIT_BY_KEY[traitKey];
    if (!t) return null;
    return t.options.find((o) => o.id === id) || t.options[0];
  };

  // ==========================================================================
  // Ship naming (flavour shown in the editor and the maintenance pockets)
  // ==========================================================================

  // Registry prefixes are hull codes, the same in every language; the two
  // adjective/noun banks are prose and are translated.
  const NAME_PREFIX = ["ISV", "SSV", "MV", "HSS", "CV", "RSV", "TSN", "LSV", "NSS", "GV"];

  function shipName(rng) {
    return pick(rng, NAME_PREFIX) + " " +
      pick(rng, T.pool('ShipModel.nameA')) + " " +
      pick(rng, T.pool('ShipModel.nameB'));
  }

  function registryCode(rng) {
    const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
    let s = "";
    for (let i = 0; i < 2; i++) s += letters[Math.floor(rng() * letters.length)];
    return s + "-" + String(irange(rng, 100, 9999));
  }

  // ==========================================================================
  // Configuration: world seed -> default, plus persistence
  // ==========================================================================

  function worldSeed() {
    try {
      if (window.HistoryManager && typeof window.HistoryManager.getSeed === "function") {
        return window.HistoryManager.getSeed() | 0;
      }
      if (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._historySeed !== undefined) {
        return $gameSystem._historySeed | 0;
      }
    } catch (e) { /* game state not ready */ }
    return 19002001;
  }

  // The ship gets its own branch of the world RNG so re-rolling it never
  // disturbs anything else derived from the same root seed.
  function defaultSeed() {
    return hashString("starship:" + worldSeed()) >>> 0;
  }

  function defaultConfig() {
    return { seed: defaultSeed(), traits: {} };
  }

  function getConfig() {
    try {
      if (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._starshipAppearance) {
        const c = $gameSystem._starshipAppearance;
        return { seed: c.seed >>> 0, traits: Object.assign({}, c.traits) };
      }
    } catch (e) { /* not ready */ }
    return defaultConfig();
  }

  function setConfig(cfg) {
    const clean = { seed: (cfg && cfg.seed) >>> 0 || defaultSeed(), traits: Object.assign({}, cfg && cfg.traits) };
    try {
      if (typeof $gameSystem !== "undefined" && $gameSystem) $gameSystem._starshipAppearance = clean;
    } catch (e) { /* not ready */ }
    ShipModel.revision++;
    return clean;
  }

  function randomConfig() {
    return { seed: (Math.floor(Math.random() * 0xffffffff)) >>> 0, traits: {} };
  }

  function cycleTrait(cfg, key, dir) {
    const trait = TRAIT_BY_KEY[key];
    if (!trait) return cfg;
    const spec = resolve(cfg);
    const curId = spec.traitIds[key];
    let idx = trait.options.findIndex((o) => o.id === curId);
    if (idx < 0) idx = 0;
    idx = (idx + (dir >= 0 ? 1 : -1) + trait.options.length) % trait.options.length;
    const next = { seed: cfg.seed >>> 0, traits: Object.assign({}, cfg.traits) };
    next.traits[key] = trait.options[idx].id;
    return next;
  }

  // ==========================================================================
  // resolve(): seed + overrides -> the full build spec
  // ==========================================================================

  // Some combinations read as nonsense; nudge the seeded roll so hulls keep a
  // coherent silhouette (an explicit player override always wins afterwards).
  function seedTraits(rng) {
    const hull = pick(rng, HULLS).id;

    let wings = pick(rng, WINGS).id;
    if (hull === "saucer" || hull === "ring") wings = pick(rng, [{ id: "none" }, { id: "ringwing" }, { id: "solar" }, { id: "stub" }]).id;
    if (hull === "shuttle") wings = pick(rng, [{ id: "delta" }, { id: "swept" }, { id: "gull" }, { id: "canard" }]).id;

    let engineCount = pick(rng, ENGINE_COUNTS).id;
    if (hull === "needle" || hull === "lancer") engineCount = pick(rng, [{ id: "1" }, { id: "2" }, { id: "3" }]).id;
    if (hull === "hauler" || hull === "modular") engineCount = pick(rng, [{ id: "2" }, { id: "4" }, { id: "6" }, { id: "8" }]).id;

    let ring = pick(rng, RINGS).id;
    if (hull === "ring") ring = pick(rng, [{ id: "hab" }, { id: "drive" }, { id: "dual" }]).id;

    let cockpit = pick(rng, COCKPITS).id;
    if (hull === "cathedral") cockpit = pick(rng, [{ id: "bridge" }, { id: "spine" }, { id: "blind" }]).id;

    return {
      hull,
      palette: pick(rng, PALETTES).id,
      finish: pick(rng, FINISHES).id,
      plating: pick(rng, PLATINGS).id,
      livery: pick(rng, LIVERIES).id,
      grunge: pick(rng, GRUNGES).id,
      wear: pick(rng, WEARS).id,
      engine: pick(rng, ENGINES).id,
      engineCount,
      wings,
      cockpit,
      tail: pick(rng, TAILS).id,
      pods: pick(rng, PODS).id,
      dish: pick(rng, DISHES).id,
      ring,
      greebles: pick(rng, GREEBLES).id,
      lights: pick(rng, LIGHTS).id,
    };
  }

  function resolve(cfg) {
    cfg = cfg || getConfig();
    const seed = (cfg.seed >>> 0) || defaultSeed();
    const rng = makeRng(seed);

    const traitIds = seedTraits(rng);
    Object.keys(cfg.traits || {}).forEach((k) => {
      if (TRAIT_BY_KEY[k] && optionOf(k, cfg.traits[k]).id === cfg.traits[k]) traitIds[k] = cfg.traits[k];
    });

    // Detail rolls: continuous values that have no UI row of their own but keep
    // two ships of the same class from looking identical.
    const dRng = makeRng(hashString(seed + "|detail"));
    const detail = {
      lengthMul: range(dRng, 0.88, 1.16),
      girthMul: range(dRng, 0.85, 1.2),
      noseSharp: range(dRng, 0.2, 1.0),
      bulge: range(dRng, 0.0, 0.35),
      segments: irange(dRng, 3, 7),
      wingSpan: range(dRng, 0.75, 1.35),
      wingSweep: range(dRng, 0.15, 0.75),
      dihedral: range(dRng, -0.3, 0.42),
      finHeight: range(dRng, 0.7, 1.5),
      podCount: irange(dRng, 2, 6),
      antennaCount: irange(dRng, 1, 5),
      windowRows: irange(dRng, 1, 3),
      plateScale: range(dRng, 0.7, 1.6),
      stripeWidth: range(dRng, 0.05, 0.2),
      blinkRate: range(dRng, 0.6, 2.4),
      spin: range(dRng, 0.12, 0.5),
      textureSeed: Math.floor(dRng() * 1e9),
      hueShift: range(dRng, -0.05, 0.05),
    };

    const nRng = makeRng(hashString(seed + "|name"));
    const name = shipName(nRng);
    const registry = registryCode(nRng);

    return {
      seed,
      traitIds,
      detail,
      name,
      registry,
      hull: optionOf("hull", traitIds.hull),
      palette: optionOf("palette", traitIds.palette),
      finish: optionOf("finish", traitIds.finish),
      plating: optionOf("plating", traitIds.plating),
      livery: optionOf("livery", traitIds.livery),
      grunge: optionOf("grunge", traitIds.grunge),
      wear: optionOf("wear", traitIds.wear),
      engine: optionOf("engine", traitIds.engine),
      engineCount: parseInt(optionOf("engineCount", traitIds.engineCount).id, 10) || 2,
      wings: optionOf("wings", traitIds.wings),
      cockpit: optionOf("cockpit", traitIds.cockpit),
      tail: optionOf("tail", traitIds.tail),
      pods: optionOf("pods", traitIds.pods),
      dish: optionOf("dish", traitIds.dish),
      ring: optionOf("ring", traitIds.ring),
      greebles: optionOf("greebles", traitIds.greebles),
      lights: optionOf("lights", traitIds.lights),
      key: seed + "|" + TRAITS.map((t) => t.key + ":" + traitIds[t.key]).join(","),
    };
  }

  function describe(cfg) {
    const spec = resolve(cfg);
    return TRAITS.map((t) => ({
      key: t.key,
      label: t.label,
      value: optionOf(t.key, spec.traitIds[t.key]).label,
    }));
  }

  // ==========================================================================
  // Procedural hull texturing
  // ==========================================================================

  // UV convention for the lathed hull: canvas X wraps around the circumference,
  // canvas Y runs from the tail (top) to the nose (bottom). So a fore/aft
  // racing stripe is a VERTICAL band and a hull collar is a HORIZONTAL band.
  const TEX_W = 1024;
  const TEX_H = 512;

  function newCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function shade(cssColor, amount) {
    const col = new THREE.Color(cssColor);
    if (amount >= 0) col.lerp(new THREE.Color(0xffffff), amount);
    else col.lerp(new THREE.Color(0x000000), -amount);
    return "#" + col.getHexString();
  }

  function drawPlating(ctx, spec, rng) {
    const p = spec.palette;
    const s = spec.detail.plateScale;
    ctx.save();
    switch (spec.plating.id) {
      case "hex": {
        const r = 26 * s;
        const hStep = r * 1.5, vStep = r * Math.sqrt(3);
        for (let y = -vStep; y < TEX_H + vStep; y += vStep) {
          for (let x = -hStep, col = 0; x < TEX_W + hStep; x += hStep, col++) {
            const cy = y + (col % 2 ? vStep / 2 : 0);
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (Math.PI / 3) * i;
              const px = x + Math.cos(a) * r, py = cy + Math.sin(a) * r;
              i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = shade(p.primary, (rng() - 0.5) * 0.14);
            ctx.fill();
            ctx.strokeStyle = shade(p.primary, -0.42);
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
        break;
      }
      case "strake": {
        const bands = Math.max(6, Math.round(18 / s));
        const bw = TEX_W / bands;
        for (let i = 0; i < bands; i++) {
          ctx.fillStyle = shade(p.primary, (rng() - 0.5) * 0.13);
          ctx.fillRect(i * bw, 0, bw, TEX_H);
          ctx.fillStyle = shade(p.primary, -0.4);
          ctx.fillRect(i * bw, 0, 2, TEX_H);
        }
        // Cross frames every so often so it does not read as pure stripes.
        for (let y = 0; y < TEX_H; y += 74 * s) {
          ctx.fillStyle = shade(p.primary, -0.3);
          ctx.fillRect(0, y, TEX_W, 2);
        }
        break;
      }
      case "diamond": {
        const d = 44 * s;
        for (let y = -d; y < TEX_H + d; y += d) {
          for (let x = -d; x < TEX_W + d; x += d) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = shade(p.primary, (rng() - 0.5) * 0.16);
            ctx.fillRect(-d * 0.35, -d * 0.35, d * 0.7, d * 0.7);
            ctx.strokeStyle = shade(p.primary, -0.38);
            ctx.lineWidth = 1.4;
            ctx.strokeRect(-d * 0.35, -d * 0.35, d * 0.7, d * 0.7);
            ctx.restore();
          }
        }
        break;
      }
      case "ribbed": {
        for (let y = 0; y < TEX_H; y += 22 * s) {
          ctx.fillStyle = shade(p.primary, 0.08);
          ctx.fillRect(0, y, TEX_W, 14 * s);
          ctx.fillStyle = shade(p.primary, -0.34);
          ctx.fillRect(0, y + 14 * s, TEX_W, 5 * s);
        }
        break;
      }
      case "scale": {
        const w = 48 * s, h = 30 * s;
        for (let y = -h, row = 0; y < TEX_H + h; y += h * 0.62, row++) {
          for (let x = -w; x < TEX_W + w; x += w) {
            const cx = x + (row % 2 ? w / 2 : 0);
            ctx.beginPath();
            ctx.ellipse(cx, y, w * 0.55, h * 0.7, 0, 0, Math.PI * 2);
            ctx.fillStyle = shade(p.primary, (rng() - 0.5) * 0.18);
            ctx.fill();
            ctx.strokeStyle = shade(p.primary, -0.4);
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
        break;
      }
      default: { // rect
        const cols = Math.max(6, Math.round(14 / s));
        const cw = TEX_W / cols;
        let y = 0;
        while (y < TEX_H) {
          const rh = (30 + rng() * 46) * s;
          let x = 0;
          while (x < TEX_W) {
            const span = cw * (rng() < 0.25 ? 2 : 1);
            ctx.fillStyle = shade(p.primary, (rng() - 0.5) * 0.15);
            ctx.fillRect(x, y, span, rh);
            ctx.strokeStyle = shade(p.primary, -0.45);
            ctx.lineWidth = 1.6;
            ctx.strokeRect(x + 0.5, y + 0.5, span, rh);
            x += span;
          }
          y += rh;
        }
      }
    }
    ctx.restore();
  }

  function drawLivery(ctx, spec, rng) {
    const p = spec.palette;
    const sw = spec.detail.stripeWidth * TEX_W;
    ctx.save();
    switch (spec.livery.id) {
      case "stripe":
        ctx.fillStyle = p.secondary;
        ctx.fillRect(TEX_W * 0.5 - sw / 2, 0, sw, TEX_H);
        ctx.fillStyle = p.accent;
        ctx.fillRect(TEX_W * 0.5 - sw / 2 - 5, 0, 4, TEX_H);
        ctx.fillRect(TEX_W * 0.5 + sw / 2 + 1, 0, 4, TEX_H);
        break;
      case "twin":
        [0.34, 0.66].forEach((u) => {
          ctx.fillStyle = p.secondary;
          ctx.fillRect(TEX_W * u - sw * 0.35, 0, sw * 0.7, TEX_H);
          ctx.fillStyle = p.accent;
          ctx.fillRect(TEX_W * u - sw * 0.35 - 3, 0, 3, TEX_H);
        });
        break;
      case "chevron":
        ctx.fillStyle = p.secondary;
        for (let y = 0; y < TEX_H; y += 96) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(TEX_W, y + 40);
          ctx.lineTo(TEX_W, y + 40 + 26);
          ctx.lineTo(0, y + 26);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case "blocks":
        for (let i = 0; i < 60; i++) {
          ctx.fillStyle = rng() < 0.5 ? p.secondary : shade(p.primary, -0.22);
          const bw = 40 + rng() * 150, bh = 30 + rng() * 90;
          ctx.globalAlpha = 0.75;
          ctx.fillRect(rng() * TEX_W, rng() * TEX_H, bw, bh);
        }
        ctx.globalAlpha = 1;
        break;
      case "checker":
        for (let y = 0; y < TEX_H; y += 44) {
          for (let x = 0; x < TEX_W; x += 44) {
            if (((x / 44) + (y / 44)) % 2 === 0) {
              ctx.fillStyle = p.secondary;
              ctx.fillRect(x, y, 44, 44);
            }
          }
        }
        break;
      case "hazard":
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, TEX_H * 0.02, TEX_W, TEX_H * 0.11);
        ctx.rect(0, TEX_H * 0.87, TEX_W, TEX_H * 0.11);
        ctx.clip();
        for (let x = -TEX_H; x < TEX_W + TEX_H; x += 56) {
          ctx.fillStyle = p.accent;
          ctx.beginPath();
          ctx.moveTo(x, 0); ctx.lineTo(x + 28, 0);
          ctx.lineTo(x + 28 + TEX_H, TEX_H); ctx.lineTo(x + TEX_H, TEX_H);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        break;
      case "tiger":
        ctx.fillStyle = p.secondary;
        for (let i = 0; i < 26; i++) {
          const y = rng() * TEX_H;
          const h = 14 + rng() * 26;
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (let x = 0; x <= TEX_W; x += 64) {
            ctx.lineTo(x, y + Math.sin((x / TEX_W) * Math.PI * 2 + i) * 18);
          }
          for (let x = TEX_W; x >= 0; x -= 64) {
            ctx.lineTo(x, y + h + Math.sin((x / TEX_W) * Math.PI * 2 + i) * 18);
          }
          ctx.closePath();
          ctx.fill();
        }
        break;
      case "heraldry": {
        // A large crest on each flank (two u positions, half a wrap apart).
        [0.25, 0.75].forEach((u) => {
          const cx = TEX_W * u, cy = TEX_H * 0.42, r = 86;
          ctx.fillStyle = p.secondary;
          ctx.beginPath();
          ctx.moveTo(cx - r, cy - r);
          ctx.lineTo(cx + r, cy - r);
          ctx.lineTo(cx + r, cy + r * 0.3);
          ctx.quadraticCurveTo(cx, cy + r * 1.5, cx - r, cy + r * 0.3);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = p.accent;
          ctx.lineWidth = 7;
          ctx.stroke();
          ctx.fillStyle = p.accent;
          for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, 12, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  // Windows + light strips, painted on both the albedo and the emissive canvas.
  function drawWindows(ctx, ectx, spec, rng) {
    const rows = spec.detail.windowRows;
    const glow = spec.palette.glow;
    for (let r = 0; r < rows; r++) {
      const y = TEX_H * (0.3 + r * 0.16) + rng() * 18;
      const count = irange(rng, 14, 34);
      for (let i = 0; i < count; i++) {
        const x = (i / count) * TEX_W + rng() * 8;
        const w = 7 + rng() * 12, h = 5 + rng() * 6;
        const lit = rng() < 0.72;
        ctx.fillStyle = lit ? glow : "#0b0d12";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "#0b0d12";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
        if (lit) {
          ectx.fillStyle = glow;
          ectx.fillRect(x, y, w, h);
        }
      }
    }
    // Continuous light strip along the length on both flanks.
    if (spec.lights.id === "runway" || spec.lights.id === "halo") {
      [0.18, 0.82].forEach((u) => {
        ctx.fillStyle = glow;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(TEX_W * u, TEX_H * 0.15, 4, TEX_H * 0.7);
        ctx.globalAlpha = 1;
        ectx.fillStyle = glow;
        ectx.fillRect(TEX_W * u, TEX_H * 0.15, 4, TEX_H * 0.7);
      });
    }
  }

  function drawDecals(ctx, spec, rng) {
    const p = spec.palette;
    // Registry code, drawn along the hull (so rotated 90 degrees in UV space).
    ctx.save();
    ctx.translate(TEX_W * 0.12, TEX_H * 0.62);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = shade(p.accent, 0.1);
    ctx.font = "bold 46px monospace";
    ctx.fillText(spec.registry, 0, 0);
    ctx.font = "bold 22px monospace";
    ctx.fillStyle = shade(p.accent, -0.15);
    ctx.fillText(spec.name.toUpperCase(), 0, 30);
    ctx.restore();

    // Access hatches, warning triangles, tie-down rings.
    for (let i = 0; i < 14; i++) {
      const x = rng() * TEX_W, y = TEX_H * (0.1 + rng() * 0.8);
      const kind = Math.floor(rng() * 3);
      ctx.save();
      ctx.translate(x, y);
      if (kind === 0) {
        ctx.strokeStyle = shade(p.primary, -0.5);
        ctx.lineWidth = 2;
        ctx.strokeRect(-18, -12, 36, 24);
        ctx.fillStyle = shade(p.primary, -0.12);
        ctx.fillRect(-16, -10, 32, 20);
      } else if (kind === 1) {
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(0, -13); ctx.lineTo(13, 10); ctx.lineTo(-13, 10);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#141414";
        ctx.font = "bold 15px monospace";
        ctx.fillText("!", -3, 8);
      } else {
        ctx.strokeStyle = shade(p.primary, -0.55);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawWear(ctx, spec, rng) {
    const w = spec.wear.amount;
    if (w <= 0) return;
    ctx.save();
    // Vertical grime streaks running aft from panel gaps.
    ctx.globalAlpha = 0.13 * w;
    for (let i = 0; i < 90 * w; i++) {
      const x = rng() * TEX_W;
      const y = rng() * TEX_H * 0.8;
      const h = 40 + rng() * 220 * w;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "rgba(20,16,12,0.9)");
      g.addColorStop(1, "rgba(20,16,12,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 2 + rng() * 7, h);
    }
    // Scorch blotches and micrometeor pits.
    ctx.globalAlpha = 0.2 * w;
    for (let i = 0; i < 40 * w; i++) {
      const x = rng() * TEX_W, y = rng() * TEX_H, r = 6 + rng() * 40 * w;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(28,22,18,0.95)");
      g.addColorStop(1, "rgba(28,22,18,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bare-metal scrapes.
    ctx.globalAlpha = 0.35 * w;
    ctx.strokeStyle = shade(spec.palette.trim, 0.35);
    for (let i = 0; i < 30 * w; i++) {
      ctx.lineWidth = 1 + rng() * 2;
      const x = rng() * TEX_W, y = rng() * TEX_H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 60, y + (rng() - 0.5) * 90);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBump(bctx, spec, rng) {
    bctx.fillStyle = "#808080";
    bctx.fillRect(0, 0, TEX_W / 2, TEX_H / 2);
    const sx = 0.5, sy = 0.5; // bump map is half resolution
    // Panel grooves matching the plating grid.
    bctx.strokeStyle = "#2a2a2a";
    bctx.lineWidth = 2;
    const step = 40 * spec.detail.plateScale * sx;
    for (let y = 0; y < TEX_H * sy; y += step) {
      bctx.beginPath(); bctx.moveTo(0, y); bctx.lineTo(TEX_W * sx, y); bctx.stroke();
    }
    for (let x = 0; x < TEX_W * sx; x += step * 1.6) {
      bctx.beginPath(); bctx.moveTo(x, 0); bctx.lineTo(x, TEX_H * sy); bctx.stroke();
    }
    // Rivets and raised fittings.
    for (let i = 0; i < 900; i++) {
      const x = rng() * TEX_W * sx, y = rng() * TEX_H * sy;
      bctx.fillStyle = rng() < 0.5 ? "#c8c8c8" : "#4a4a4a";
      bctx.beginPath();
      bctx.arc(x, y, 1 + rng() * 2, 0, Math.PI * 2);
      bctx.fill();
    }
  }

  // Builds { map, emissiveMap, bumpMap, dispose() } for one resolved spec.
  const texCache = new Map();
  const TEX_CACHE_MAX = 5;

  function buildHullTextures(spec) {
    const cached = texCache.get(spec.key);
    if (cached) { cached.refs++; return cached; }

    const rng = makeRng(spec.detail.textureSeed);
    const albedo = newCanvas(TEX_W, TEX_H);
    const emissive = newCanvas(TEX_W, TEX_H);
    const bump = newCanvas(TEX_W / 2, TEX_H / 2);
    const ctx = albedo.getContext("2d");
    const ectx = emissive.getContext("2d");
    const bctx = bump.getContext("2d");

    ctx.fillStyle = spec.palette.primary;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ectx.fillStyle = "#000000";
    ectx.fillRect(0, 0, TEX_W, TEX_H);

    drawPlating(ctx, spec, rng);
    drawLivery(ctx, spec, rng);
    drawWindows(ctx, ectx, spec, rng);
    drawDecals(ctx, spec, rng);
    drawWear(ctx, spec, rng);
    drawBump(bctx, spec, rng);

    const mk = (canvas, srgb) => {
      const t = new THREE.CanvasTexture(canvas);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      if (srgb) {
        if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
      }
      return t;
    };

    const set = {
      key: spec.key,
      refs: 1,
      map: mk(albedo, true),
      emissiveMap: mk(emissive, true),
      bumpMap: mk(bump, false),
      // Releasing the last user does NOT free the GPU textures: the ship is
      // rebuilt every time the star map changes scale, and repainting the
      // 1024x512 hull canvases each time would stutter. The set stays cached
      // until it is evicted below.
      dispose() { this.refs = Math.max(0, this.refs - 1); },
      destroy() {
        this.map.dispose();
        this.emissiveMap.dispose();
        this.bumpMap.dispose();
      },
    };

    // Composite the shared library grunge over the albedo once it loads, then
    // flag the texture for re-upload. Purely cosmetic, so failure is silent.
    if (spec.grunge.file) {
      const img = new Image();
      img.onload = () => {
        try {
          ctx.save();
          ctx.globalAlpha = 0.16 + spec.wear.amount * 0.26;
          ctx.globalCompositeOperation = "overlay";
          for (let x = 0; x < TEX_W; x += TEX_W / 2) {
            for (let y = 0; y < TEX_H; y += TEX_H / 2) {
              ctx.drawImage(img, x, y, TEX_W / 2, TEX_H / 2);
            }
          }
          ctx.restore();
          set.map.needsUpdate = true;
        } catch (e) { /* ignore */ }
      };
      img.onerror = () => { };
      img.src = "img/textures/" + spec.grunge.file;
    }

    texCache.set(spec.key, set);
    // Evict the oldest unused sets once the cache grows past its cap (the
    // appearance editor can churn through dozens of looks in one sitting).
    while (texCache.size > TEX_CACHE_MAX) {
      let evicted = false;
      for (const [k, v] of texCache) {
        if (v.refs <= 0) {
          texCache.delete(k);
          v.destroy();
          evicted = true;
          break;
        }
      }
      if (!evicted) break; // everything still in use
    }
    return set;
  }

  // Small additive glow sprite for drives and beacons.
  function glowSprite(cssColor, size) {
    const s = 64;
    const cv = newCanvas(s, s);
    const c = cv.getContext("2d");
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, cssColor);
    g.addColorStop(0.28, cssColor);
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(size, size, 1);
    return { sprite: sp, tex, mat };
  }

  // Solar-array / radiator cell texture.
  function panelTexture(spec) {
    const cv = newCanvas(256, 256);
    const c = cv.getContext("2d");
    c.fillStyle = "#131a2c";
    c.fillRect(0, 0, 256, 256);
    const rng = makeRng(spec.detail.textureSeed ^ 0x51ed);
    for (let y = 0; y < 256; y += 32) {
      for (let x = 0; x < 256; x += 32) {
        c.fillStyle = shade("#1d2a4d", (rng() - 0.5) * 0.3);
        c.fillRect(x + 2, y + 2, 28, 28);
        c.strokeStyle = "#39456b";
        c.lineWidth = 1;
        c.strokeRect(x + 2.5, y + 2.5, 27, 27);
      }
    }
    c.strokeStyle = spec.palette.glow;
    c.globalAlpha = 0.25;
    c.lineWidth = 2;
    for (let x = 0; x < 256; x += 64) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // ==========================================================================
  // Hull geometry
  // ==========================================================================

  // Per-class lathe profile: [t, radiusFraction] from tail (t=0) to nose (t=1).
  // `orient: "axial"` lathes around the fore/aft axis; `"radial"` keeps the
  // lathe axis vertical, producing a saucer.
  const HULL_DEFS = {
    needle: {
      orient: "axial", L: 1.05, R: 0.085, flatX: 1.0, flatY: 1.0, seg: 18,
      prof: [[0, 0.55], [0.05, 0.9], [0.2, 1.0], [0.5, 0.86], [0.75, 0.6], [0.9, 0.32], [1, 0.02]],
    },
    wedge: {
      orient: "axial", L: 0.82, R: 0.2, flatX: 1.5, flatY: 0.5, seg: 14,
      prof: [[0, 0.85], [0.08, 1.0], [0.45, 0.94], [0.75, 0.62], [0.92, 0.3], [1, 0.03]],
    },
    hauler: {
      orient: "axial", L: 1.0, R: 0.21, flatX: 1.1, flatY: 0.92, seg: 14,
      prof: [[0, 0.8], [0.06, 1.0], [0.68, 0.98], [0.8, 0.72], [0.93, 0.5], [1, 0.28]],
    },
    saucer: {
      orient: "radial", L: 0.9, R: 0.45, flatX: 1.0, flatY: 1.0, seg: 30,
      prof: [[0, 0.06], [0.12, 0.5], [0.3, 0.86], [0.5, 1.0], [0.72, 0.8], [0.9, 0.42], [1, 0.05]],
      thick: 0.2,
    },
    ring: {
      orient: "axial", L: 0.95, R: 0.075, flatX: 1.0, flatY: 1.0, seg: 16,
      prof: [[0, 0.7], [0.08, 1.0], [0.55, 0.95], [0.8, 0.7], [0.95, 0.4], [1, 0.05]],
    },
    cathedral: {
      orient: "axial", L: 1.12, R: 0.15, flatX: 0.86, flatY: 1.25, seg: 12,
      prof: [[0, 0.75], [0.07, 1.0], [0.22, 0.82], [0.34, 0.95], [0.5, 0.78], [0.62, 0.9],
      [0.78, 0.62], [0.9, 0.38], [1, 0.04]],
    },
    organic: {
      orient: "axial", L: 0.98, R: 0.17, flatX: 1.05, flatY: 0.95, seg: 22,
      prof: [[0, 0.28], [0.12, 0.72], [0.3, 1.0], [0.5, 0.88], [0.66, 0.96], [0.84, 0.55], [1, 0.06]],
    },
    lancer: {
      orient: "axial", L: 1.06, R: 0.125, flatX: 1.15, flatY: 0.8, seg: 10,
      prof: [[0, 0.9], [0.1, 1.0], [0.42, 0.85], [0.6, 0.7], [0.78, 0.42], [0.9, 0.2], [1, 0.02]],
    },
    modular: {
      orient: "axial", L: 1.04, R: 0.18, flatX: 1.0, flatY: 1.0, seg: 8,
      prof: [[0, 0.7], [0.05, 0.95], [0.18, 0.95], [0.2, 0.7], [0.34, 0.7], [0.36, 1.0],
      [0.58, 1.0], [0.6, 0.72], [0.78, 0.72], [0.82, 0.55], [1, 0.18]],
    },
    shuttle: {
      orient: "axial", L: 0.72, R: 0.16, flatX: 1.2, flatY: 0.78, seg: 14,
      prof: [[0, 0.82], [0.1, 1.0], [0.5, 0.95], [0.72, 0.75], [0.9, 0.42], [1, 0.08]],
    },
  };

  function hullProfileFn(def, spec) {
    const pts = def.prof;
    return function (t) {
      t = clamp(t, 0, 1);
      for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i][0]) {
          const a = pts[i - 1], b = pts[i];
          const f = (t - a[0]) / Math.max(1e-5, b[0] - a[0]);
          return lerp(a[1], b[1], f) * def.R * spec.detail.girthMul;
        }
      }
      return pts[pts.length - 1][1] * def.R * spec.detail.girthMul;
    };
  }

  // ==========================================================================
  // build(): the full ship
  // ==========================================================================

  function build(cfg) {
    const spec = resolve(cfg);
    if (typeof THREE === "undefined") {
      return { group: null, spec, update() { }, dispose() { } };
    }
    const group = new THREE.Group();
    group.name = "gx-ship";

    const geos = [];
    const mats = [];
    const sprites = [];
    const anim = { engines: [], blinkers: [], spinners: [], sails: [] };

    const track = (g) => { geos.push(g); return g; };
    const trackM = (m) => { mats.push(m); return m; };

    const P = spec.palette;
    const tex = buildHullTextures(spec);
    const finish = spec.finish;

    const hullMat = trackM(new THREE.MeshPhongMaterial({
      map: tex.map,
      bumpMap: tex.bumpMap,
      bumpScale: 0.012,
      emissiveMap: tex.emissiveMap,
      emissive: new THREE.Color(P.glow).multiplyScalar(0.85),
      specular: new THREE.Color(finish.specular),
      shininess: finish.shininess,
      side: THREE.DoubleSide,
    }));

    const trimMat = trackM(new THREE.MeshPhongMaterial({
      color: new THREE.Color(P.trim),
      specular: 0x4a4f57,
      shininess: 30,
    }));

    const darkMat = trackM(new THREE.MeshPhongMaterial({
      color: new THREE.Color(P.trim).multiplyScalar(0.45),
      specular: 0x22262c,
      shininess: 12,
    }));

    const accentMat = trackM(new THREE.MeshPhongMaterial({
      color: new THREE.Color(P.accent),
      specular: 0x8a919c,
      shininess: 60,
    }));

    const glassMat = trackM(new THREE.MeshPhongMaterial({
      color: 0x0a1626,
      emissive: new THREE.Color(P.glow).multiplyScalar(0.35),
      specular: 0xffffff,
      shininess: 140,
      transparent: true,
      opacity: 0.72,
    }));

    const driveColor = new THREE.Color(spec.engine.hue || P.glow);
    const driveMat = trackM(new THREE.MeshPhongMaterial({
      color: 0x05070c,
      emissive: driveColor,
      emissiveIntensity: 1,
      shininess: 90,
    }));

    const def = HULL_DEFS[spec.hull.id] || HULL_DEFS.needle;
    const L = def.L * spec.detail.lengthMul;
    const radiusAt = hullProfileFn(def, spec);
    const Rmax = def.R * spec.detail.girthMul;

    // --- Primary hull -------------------------------------------------------
    {
      let geo;
      if (def.orient === "radial") {
        // Saucer: a lens of revolution around the vertical axis, so the disc
        // lies flat and the class profile becomes its thickness curve.
        const lens = [];
        const steps = 26;
        const thick = def.thick || 0.2;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;                  // 0 = rim, 1 = centre
          lens.push(new THREE.Vector2(Rmax * (1 - u), thick * 0.5 * Math.pow(u, 0.55)));
        }
        for (let i = steps; i >= 0; i--) {
          const u = i / steps;
          lens.push(new THREE.Vector2(Rmax * (1 - u), -thick * 0.36 * Math.pow(u, 0.7)));
        }
        geo = track(new THREE.LatheGeometry(lens, def.seg));
      } else {
        const pts = [];
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          pts.push(new THREE.Vector2(Math.max(0.0015, radiusAt(t)), (t - 0.5) * L));
        }
        geo = track(new THREE.LatheGeometry(pts, def.seg));
        geo.rotateX(Math.PI / 2); // profile axis +Y -> ship forward +Z
      }
      geo.scale(def.flatX, def.flatY, 1);
      const hull = new THREE.Mesh(geo, hullMat);
      group.add(hull);
    }

    // Hull cross-section at a fore/aft position, used to seat every attached
    // detail on the actual skin. Flattened hulls (and the saucer, whose
    // section is a wide thin lens) are not circular, so lateral and vertical
    // half-extents are tracked separately.
    const halfL = def.orient === "radial" ? def.R * spec.detail.girthMul : L / 2;
    function crossSection(z) {
      if (def.orient === "radial") {
        const u = clamp(Math.abs(z) / Math.max(1e-4, halfL), 0, 1);
        return {
          w: Math.sqrt(Math.max(0, 1 - u * u)) * halfL * def.flatX,
          h: (def.thick || 0.2) * 0.5 * (1 - u * 0.85) * def.flatY,
        };
      }
      const r = radiusAt(clamp((z + L / 2) / L, 0, 1));
      return { w: r * def.flatX, h: r * def.flatY };
    }
    const skinAt = (z) => crossSection(z).w;          // lateral half-width
    const topAt = (z) => crossSection(z).h;           // dorsal/ventral half-height
    function surfaceAt(z, a) {                        // point on the skin ring
      const c = crossSection(z);
      return { x: Math.cos(a) * c.w, y: Math.sin(a) * c.h };
    }

    // --- Cockpit ------------------------------------------------------------
    {
      const noseZ = halfL * 0.72;
      switch (spec.cockpit.id) {
        case "canopy": {
          const g = track(new THREE.SphereGeometry(Math.max(0.035, Rmax * 0.5), 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55));
          g.scale(1, 0.75, 1.6);
          const m = new THREE.Mesh(g, glassMat);
          m.position.set(0, topAt(noseZ) * 0.55, noseZ);
          group.add(m);
          break;
        }
        case "bubble": {
          const g = track(new THREE.SphereGeometry(Math.max(0.04, Rmax * 0.62), 18, 14));
          const m = new THREE.Mesh(g, glassMat);
          m.position.set(0, topAt(noseZ) * 0.4, noseZ * 0.92);
          group.add(m);
          const ringG = track(new THREE.TorusGeometry(Math.max(0.04, Rmax * 0.62), 0.008, 8, 20));
          const ring = new THREE.Mesh(ringG, trimMat);
          ring.position.copy(m.position);
          ring.rotation.x = Math.PI / 2;
          group.add(ring);
          break;
        }
        case "bridge": {
          const w = Rmax * 1.1, h = Rmax * 0.7, d = L * 0.16;
          const g = track(new THREE.BoxGeometry(w, h, d));
          const m = new THREE.Mesh(g, hullMat);
          m.position.set(0, topAt(noseZ * 0.5) + h * 0.35, noseZ * 0.5);
          group.add(m);
          const wg = track(new THREE.BoxGeometry(w * 0.92, h * 0.34, d * 0.5));
          const win = new THREE.Mesh(wg, glassMat);
          win.position.set(0, m.position.y + h * 0.12, m.position.z + d * 0.3);
          group.add(win);
          break;
        }
        case "spine": {
          const g = track(new THREE.CylinderGeometry(Rmax * 0.3, Rmax * 0.38, L * 0.22, 10));
          g.rotateX(Math.PI / 2);
          const m = new THREE.Mesh(g, hullMat);
          m.position.set(0, topAt(0) + Rmax * 0.55, halfL * 0.25);
          group.add(m);
          const strutG = track(new THREE.CylinderGeometry(0.008, 0.008, Rmax * 0.6, 6));
          const strut = new THREE.Mesh(strutG, trimMat);
          strut.position.set(0, topAt(0) + Rmax * 0.28, halfL * 0.25);
          group.add(strut);
          const dg = track(new THREE.SphereGeometry(Rmax * 0.22, 12, 10));
          const dome = new THREE.Mesh(dg, glassMat);
          dome.position.set(0, m.position.y, m.position.z + L * 0.11);
          group.add(dome);
          break;
        }
        case "pod": {
          const g = track(new THREE.SphereGeometry(Rmax * 0.5, 14, 12));
          g.scale(1, 0.8, 1.4);
          const m = new THREE.Mesh(g, hullMat);
          m.position.set(0, -topAt(noseZ * 0.6) - Rmax * 0.25, noseZ * 0.6);
          group.add(m);
          const wg = track(new THREE.SphereGeometry(Rmax * 0.3, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5));
          const win = new THREE.Mesh(wg, glassMat);
          win.rotation.x = Math.PI;
          win.position.set(0, m.position.y - Rmax * 0.18, m.position.z + Rmax * 0.35);
          group.add(win);
          break;
        }
        default: { // blind prow: armoured cap with sensor slits
          const g = track(new THREE.ConeGeometry(Rmax * 0.55, L * 0.14, 10));
          g.rotateX(Math.PI / 2);
          const m = new THREE.Mesh(g, accentMat);
          m.position.set(0, 0, halfL * 0.86);
          group.add(m);
          break;
        }
      }
    }

    // --- Drives -------------------------------------------------------------
    {
      const count = spec.engineCount;
      const tailZ = -halfL * (def.orient === "radial" ? 0.55 : 0.98);
      const sect = crossSection(tailZ * 0.8);
      // Drives sit on the tail section ring, so a flat hull gets a wide bank
      // of engines rather than a circle floating off the top and bottom.
      const spreadX = Math.max(Rmax * 0.75, sect.w * 0.95);
      const spreadY = Math.max(Rmax * 0.4, sect.h * 0.95);
      const eR = clamp(Rmax * (count > 4 ? 0.3 : 0.44), 0.018, 0.09);
      const eng = spec.engine;

      for (let i = 0; i < count; i++) {
        const a = count === 1 ? 0 : (i / count) * Math.PI * 2 + Math.PI / 2;
        const ex = count === 1 ? 0 : Math.cos(a) * spreadX * (count === 2 ? 1.0 : 0.8);
        const ey = count === 1 ? 0 : Math.sin(a) * spreadY * (count === 2 ? 0 : 0.9);
        const holder = new THREE.Group();
        holder.position.set(ex, ey, tailZ);
        group.add(holder);

        // Nacelle body (skipped for the sail drive, which has no bell).
        if (eng.nozzle !== "sail" && eng.nozzle !== "bubble") {
          const bodyG = track(new THREE.CylinderGeometry(eR, eR * 0.9, L * 0.2, 12));
          bodyG.rotateX(Math.PI / 2);
          const body = new THREE.Mesh(bodyG, hullMat);
          body.position.z = L * 0.06;
          holder.add(body);

          const collarG = track(new THREE.TorusGeometry(eR * 1.06, eR * 0.14, 8, 16));
          const collar = new THREE.Mesh(collarG, trimMat);
          collar.position.z = L * 0.13;
          holder.add(collar);
        }

        // Nozzle / emitter, per drive type.
        let nozzle = null;
        if (eng.nozzle === "bell") {
          const g = track(new THREE.CylinderGeometry(eR * 1.5, eR * 0.7, L * 0.1, 14, 1, true));
          g.rotateX(Math.PI / 2);
          nozzle = new THREE.Mesh(g, driveMat);
          nozzle.position.z = -L * 0.06;
        } else if (eng.nozzle === "ring") {
          const g = track(new THREE.TorusGeometry(eR * 1.2, eR * 0.28, 10, 20));
          nozzle = new THREE.Mesh(g, driveMat);
          nozzle.position.z = -L * 0.04;
        } else if (eng.nozzle === "spike") {
          const g = track(new THREE.ConeGeometry(eR * 0.9, L * 0.18, 10));
          g.rotateX(-Math.PI / 2);
          nozzle = new THREE.Mesh(g, driveMat);
          nozzle.position.z = -L * 0.12;
        } else if (eng.nozzle === "nacelle") {
          const g = track(new THREE.CylinderGeometry(eR * 0.85, eR * 0.85, L * 0.34, 12));
          g.rotateX(Math.PI / 2);
          nozzle = new THREE.Mesh(g, driveMat);
          nozzle.position.z = L * 0.02;
        } else if (eng.nozzle === "bubble") {
          const g = track(new THREE.SphereGeometry(eR * 1.5, 14, 12));
          nozzle = new THREE.Mesh(g, driveMat);
        } else if (eng.nozzle === "sail") {
          const g = track(new THREE.CircleGeometry(eR * 5.5, 16));
          const sailMat = trackM(new THREE.MeshPhongMaterial({
            color: new THREE.Color(P.accent), emissive: driveColor.clone().multiplyScalar(0.25),
            shininess: 100, side: THREE.DoubleSide, transparent: true, opacity: 0.75,
          }));
          nozzle = new THREE.Mesh(g, sailMat);
          nozzle.position.z = -L * 0.16;
          anim.sails.push(nozzle);
        } else { // cone (ion)
          const g = track(new THREE.CylinderGeometry(eR * 1.15, eR * 0.55, L * 0.07, 12, 1, true));
          g.rotateX(Math.PI / 2);
          nozzle = new THREE.Mesh(g, driveMat);
          nozzle.position.z = -L * 0.05;
        }
        if (nozzle) holder.add(nozzle);

        const flare = glowSprite(
          "rgba(" + Math.round(driveColor.r * 255) + "," + Math.round(driveColor.g * 255) + "," + Math.round(driveColor.b * 255) + ",0.92)",
          Math.max(0.1, eR * 7 * eng.flare)
        );
        flare.sprite.position.z = -L * 0.13;
        holder.add(flare.sprite);
        sprites.push(flare);
        anim.engines.push({ sprite: flare.sprite, base: flare.sprite.scale.x, phase: i * 1.7 });

        // Pylon linking an outboard drive back to the hull.
        if (count > 1 && (Math.abs(ex) > 1e-3 || Math.abs(ey) > 1e-3)) {
          const len = Math.hypot(ex, ey);
          const pg = track(new THREE.BoxGeometry(len, Rmax * 0.16, L * 0.1));
          const pylon = new THREE.Mesh(pg, trimMat);
          pylon.position.set(ex / 2, ey / 2, tailZ + L * 0.03);
          pylon.rotation.z = Math.atan2(ey, ex);
          group.add(pylon);
        }
      }
    }

    // --- Wings --------------------------------------------------------------
    function makeWing(chord, span, sweep, thickness, mat) {
      const s = new THREE.Shape();
      s.moveTo(0, chord * 0.5);
      s.lineTo(span, chord * (0.5 - sweep));
      s.lineTo(span, chord * (0.05 - sweep));
      s.lineTo(0, -chord * 0.5);
      s.closePath();
      const g = track(new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 2 }));
      g.rotateX(Math.PI / 2);   // shape Y (chord) -> +Z forward, extrude -> -Y
      g.translate(0, thickness / 2, 0);
      return new THREE.Mesh(g, mat || hullMat);
    }

    if (spec.wings.id !== "none") {
      const span = clamp(Rmax * 4.2 * spec.detail.wingSpan, 0.1, 0.6);
      const chord = L * 0.3;
      const th = Math.max(0.008, Rmax * 0.16);
      const mountZ = -L * 0.08;
      const wingCfgs = [];

      switch (spec.wings.id) {
        case "delta": wingCfgs.push({ z: mountZ, span, chord: chord * 1.3, sweep: 0.75, dih: 0 }); break;
        case "swept": wingCfgs.push({ z: mountZ, span, chord, sweep: spec.detail.wingSweep, dih: spec.detail.dihedral }); break;
        case "forward": wingCfgs.push({ z: mountZ, span, chord, sweep: -spec.detail.wingSweep, dih: spec.detail.dihedral * 0.5 }); break;
        case "xwing":
          wingCfgs.push({ z: mountZ, span: span * 0.85, chord: chord * 0.8, sweep: 0.35, dih: 0.55 });
          wingCfgs.push({ z: mountZ, span: span * 0.85, chord: chord * 0.8, sweep: 0.35, dih: -0.55 });
          break;
        case "gull":
          wingCfgs.push({ z: mountZ, span: span * 0.55, chord, sweep: 0.2, dih: 0.6 });
          wingCfgs.push({ z: mountZ, span: span * 0.55, chord: chord * 0.9, sweep: 0.35, dih: -0.35, x: span * 0.5, y: span * 0.3 });
          break;
        case "canard":
          wingCfgs.push({ z: mountZ, span, chord, sweep: 0.5, dih: 0.1 });
          wingCfgs.push({ z: L * 0.3, span: span * 0.45, chord: chord * 0.5, sweep: 0.4, dih: 0.05 });
          break;
        case "stub":
          wingCfgs.push({ z: mountZ, span: span * 0.4, chord: chord * 0.8, sweep: 0.25, dih: 0 });
          break;
        case "solar": {
          const armG = track(new THREE.CylinderGeometry(0.008, 0.008, span, 6));
          armG.rotateZ(Math.PI / 2);
          const pTex = panelTexture(spec);
          const panelMat = trackM(new THREE.MeshPhongMaterial({
            map: pTex, specular: 0x9fb4ff, shininess: 80, side: THREE.DoubleSide,
          }));
          panelMat.map.repeat.set(3, 1);
          mats.push({ dispose: () => pTex.dispose() });
          [1, -1].forEach((sx) => {
            const arm = new THREE.Mesh(armG, trimMat);
            arm.position.set((span / 2) * sx, 0, mountZ);
            group.add(arm);
            const pg = track(new THREE.BoxGeometry(span * 0.95, 0.006, chord * 1.1));
            const panel = new THREE.Mesh(pg, panelMat);
            panel.position.set(span * sx, 0, mountZ);
            group.add(panel);
            anim.spinners.push({ obj: panel, axis: "x", speed: 0.05 });
          });
          break;
        }
        case "ringwing": {
          const rr = span * 0.8;
          const rg = track(new THREE.TorusGeometry(rr, Math.max(0.01, Rmax * 0.18), 10, 26));
          const ringMesh = new THREE.Mesh(rg, hullMat);
          ringMesh.position.z = mountZ;
          group.add(ringMesh);
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const sg = track(new THREE.BoxGeometry(rr, Rmax * 0.14, L * 0.08));
            const strut = new THREE.Mesh(sg, trimMat);
            strut.position.set(Math.cos(a) * rr / 2, Math.sin(a) * rr / 2, mountZ);
            strut.rotation.z = a;
            group.add(strut);
          }
          break;
        }
        default: break;
      }

      wingCfgs.forEach((w) => {
        const rootX = w.x != null ? w.x : skinAt(w.z) * 0.8;
        const rootY = w.y || 0;
        [1, -1].forEach((sx) => {
          const dih = (w.dih || 0) * sx;
          const wing = makeWing(w.chord, w.span, w.sweep, th);
          wing.position.set(rootX * sx, rootY, w.z);
          wing.scale.x = sx;
          wing.rotation.z = dih;
          group.add(wing);

          // Wingtip nav light, swung out along the (dihedral-rotated) span.
          const tipG = track(new THREE.SphereGeometry(Math.max(0.006, Rmax * 0.12), 8, 6));
          const tipMat = trackM(new THREE.MeshPhongMaterial({
            color: 0x111111,
            emissive: new THREE.Color(sx > 0 ? 0x22ff55 : 0xff2233),
          }));
          const tip = new THREE.Mesh(tipG, tipMat);
          // The dihedral lifts both tips the same way, so the vertical offset
          // uses the unmirrored angle while the span itself follows the side.
          tip.position.set(
            rootX * sx + Math.cos(dih) * w.span * sx,
            rootY + Math.sin(w.dih || 0) * w.span,
            w.z
          );
          group.add(tip);
          // Port/starboard tips burn steady like real nav lights; only the
          // strobe fit-out flashes them.
          if (spec.lights.id === "strobe") {
            anim.blinkers.push({ mat: tipMat, phase: sx > 0 ? 0 : Math.PI, base: 1 });
          }
        });
      });
    }

    // --- Tail assembly ------------------------------------------------------
    {
      const finH = Rmax * 2.4 * spec.detail.finHeight;
      const finZ = -L * 0.3;
      const mkFin = (rotZ, scaleY) => {
        const fin = makeWing(L * 0.26, finH, 0.62, Math.max(0.008, Rmax * 0.13));
        fin.rotation.z = rotZ;
        fin.position.z = finZ;
        if (scaleY) fin.scale.y = scaleY;
        group.add(fin);
        return fin;
      };
      switch (spec.tail.id) {
        case "fin": mkFin(Math.PI / 2); break;
        case "twin": mkFin(Math.PI / 2 - 0.35); mkFin(Math.PI / 2 + 0.35); break;
        case "tri": mkFin(Math.PI / 2); mkFin(Math.PI / 2 + 2.094); mkFin(Math.PI / 2 - 2.094); break;
        case "vtail": mkFin(Math.PI / 2 - 0.7); mkFin(Math.PI / 2 + 0.7); break;
        case "shroud": {
          const g = track(new THREE.CylinderGeometry(Rmax * 1.6, Rmax * 1.4, L * 0.2, 14, 1, true));
          g.rotateX(Math.PI / 2);
          const shroud = new THREE.Mesh(g, hullMat);
          shroud.position.z = -halfL * 0.85;
          group.add(shroud);
          break;
        }
        case "radiator": {
          const radMat = trackM(new THREE.MeshPhongMaterial({
            color: 0x1a1d22,
            emissive: new THREE.Color(P.glow).multiplyScalar(0.4),
            shininess: 20, side: THREE.DoubleSide,
          }));
          [1, -1].forEach((sx) => {
            const g = track(new THREE.BoxGeometry(Rmax * 3.2, 0.006, L * 0.3));
            const vane = new THREE.Mesh(g, radMat);
            vane.position.set(Rmax * 2 * sx, Rmax * 0.6, finZ);
            vane.rotation.z = 0.35 * sx;
            group.add(vane);
          });
          break;
        }
        default: break;
      }
    }

    // --- Hull ring ----------------------------------------------------------
    if (spec.ring.id !== "none") {
      const mkRing = (z, rr, tube, spin) => {
        const g = track(new THREE.TorusGeometry(rr, tube, 12, 30));
        const m = new THREE.Mesh(g, hullMat);
        m.position.z = z;
        group.add(m);
        if (spin) anim.spinners.push({ obj: m, axis: "z", speed: spin });
        // Spokes.
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const sg = track(new THREE.CylinderGeometry(tube * 0.35, tube * 0.35, rr, 6));
          sg.rotateZ(Math.PI / 2);
          const spoke = new THREE.Mesh(sg, trimMat);
          spoke.position.set(Math.cos(a) * rr / 2, Math.sin(a) * rr / 2, z);
          spoke.rotation.z = a;
          group.add(spoke);
        }
        return m;
      };
      const baseR = Math.max(Rmax * 2.6, 0.16);
      switch (spec.ring.id) {
        case "hab": mkRing(-L * 0.02, baseR, Rmax * 0.32, spec.detail.spin); break;
        case "drive": mkRing(-L * 0.3, baseR * 1.1, Rmax * 0.22, spec.detail.spin * 0.5); break;
        case "dual":
          mkRing(L * 0.1, baseR * 0.85, Rmax * 0.24, spec.detail.spin);
          mkRing(-L * 0.22, baseR * 0.85, Rmax * 0.24, -spec.detail.spin);
          break;
        case "collar": mkRing(L * 0.2, Rmax * 1.5, Rmax * 0.22, 0); break;
        default: break;
      }
    }

    // --- External pods ------------------------------------------------------
    if (spec.pods.id !== "none") {
      const n = spec.detail.podCount;
      for (let i = 0; i < n; i++) {
        const t = 0.25 + (i / Math.max(1, n - 1)) * 0.45;
        const z = -halfL + t * 2 * halfL;
        const r = skinAt(z);
        [1, -1].forEach((sx) => {
          let mesh = null;
          const pr = Rmax * 0.3;
          if (spec.pods.id === "tanks") {
            const g = track(new THREE.CylinderGeometry(pr, pr, L * 0.24, 10));
            g.rotateX(Math.PI / 2);
            mesh = new THREE.Mesh(g, accentMat);
          } else if (spec.pods.id === "cargo") {
            const g = track(new THREE.BoxGeometry(pr * 2, pr * 2, L * 0.2));
            mesh = new THREE.Mesh(g, hullMat);
          } else if (spec.pods.id === "missiles") {
            const g = track(new THREE.BoxGeometry(pr * 1.8, pr * 1.4, L * 0.12));
            mesh = new THREE.Mesh(g, darkMat);
          } else if (spec.pods.id === "drones") {
            const g = track(new THREE.SphereGeometry(pr, 10, 8));
            mesh = new THREE.Mesh(g, trimMat);
          } else if (spec.pods.id === "mining") {
            const g = track(new THREE.ConeGeometry(pr * 1.2, L * 0.16, 8));
            g.rotateX(Math.PI / 2);
            mesh = new THREE.Mesh(g, accentMat);
          } else { // lifeboats
            const g = track(new THREE.SphereGeometry(pr * 0.9, 10, 8));
            g.scale(1, 1, 1.7);
            mesh = new THREE.Mesh(g, accentMat);
          }
          const podY = -topAt(z) * 0.25;
          mesh.position.set((r + pr * 0.85) * sx, podY, z);
          group.add(mesh);
          const sg = track(new THREE.BoxGeometry(pr * 0.9, pr * 0.3, pr * 0.5));
          const strut = new THREE.Mesh(sg, trimMat);
          strut.position.set((r + pr * 0.3) * sx, podY, z);
          group.add(strut);
        });
      }
    }

    // --- Sensors ------------------------------------------------------------
    if (spec.dish.id !== "none") {
      const topZ = L * 0.12;
      const topY = topAt(topZ) + Rmax * 0.1;
      if (spec.dish.id === "dish") {
        const prof = [];
        const dr = Math.max(0.03, Rmax * 0.9);
        for (let i = 0; i <= 10; i++) {
          const u = i / 10;
          prof.push(new THREE.Vector2(dr * u, dr * 0.45 * u * u));
        }
        const g = track(new THREE.LatheGeometry(prof, 16));
        const dish = new THREE.Mesh(g, trimMat);
        dish.material.side = THREE.DoubleSide;
        dish.position.set(0, topY + dr * 0.5, topZ);
        dish.rotation.x = -0.5;
        group.add(dish);
        anim.spinners.push({ obj: dish, axis: "y", speed: 0.3 });
        const mg = track(new THREE.CylinderGeometry(0.006, 0.006, dr * 0.6, 6));
        const mast = new THREE.Mesh(mg, trimMat);
        mast.position.set(0, topY + dr * 0.25, topZ);
        group.add(mast);
      } else if (spec.dish.id === "phased") {
        const g = track(new THREE.BoxGeometry(Rmax * 2.2, 0.01, L * 0.16));
        const arr = new THREE.Mesh(g, darkMat);
        arr.position.set(0, topY + 0.01, topZ);
        group.add(arr);
        for (let i = 0; i < 6; i++) {
          const eg = track(new THREE.BoxGeometry(Rmax * 0.28, 0.014, L * 0.02));
          const el = new THREE.Mesh(eg, accentMat);
          el.position.set((i - 2.5) * Rmax * 0.33, topY + 0.02, topZ);
          group.add(el);
        }
      } else if (spec.dish.id === "mast") {
        const mg = track(new THREE.CylinderGeometry(0.005, 0.009, Rmax * 3.2, 6));
        const mast = new THREE.Mesh(mg, trimMat);
        mast.position.set(0, topY + Rmax * 1.6, topZ);
        group.add(mast);
        for (let i = 0; i < 3; i++) {
          const cg = track(new THREE.CylinderGeometry(0.003, 0.003, Rmax * 0.9, 5));
          cg.rotateZ(Math.PI / 2);
          const cross = new THREE.Mesh(cg, trimMat);
          cross.position.set(0, topY + Rmax * (1 + i * 0.8), topZ);
          group.add(cross);
        }
      } else if (spec.dish.id === "dome") {
        const g = track(new THREE.SphereGeometry(Rmax * 0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5));
        const dome = new THREE.Mesh(g, glassMat);
        dome.position.set(0, topY, topZ);
        group.add(dome);
      } else { // spine
        for (let i = 0; i < 5; i++) {
          const ag = track(new THREE.CylinderGeometry(0.004, 0.004, Rmax * (0.8 + i * 0.25), 5));
          const ant = new THREE.Mesh(ag, trimMat);
          const z = -L * 0.2 + i * L * 0.1;
          ant.position.set(0, topAt(z) + Rmax * (0.4 + i * 0.12), z);
          group.add(ant);
        }
      }
    }

    // --- Antennae & whip aerials (always a few, count varies) ---------------
    {
      const aRng = makeRng(spec.detail.textureSeed ^ 0x7f31);
      for (let i = 0; i < spec.detail.antennaCount; i++) {
        const z = range(aRng, -halfL * 0.6, halfL * 0.6);
        const a = range(aRng, 0, Math.PI * 2);
        const p0 = surfaceAt(z, a);
        const len = range(aRng, Rmax * 0.5, Rmax * 1.8);
        const out = Math.atan2(p0.y, p0.x);
        const g = track(new THREE.CylinderGeometry(0.0025, 0.0035, len, 4));
        const ant = new THREE.Mesh(g, trimMat);
        ant.position.set(p0.x + Math.cos(out) * len / 2, p0.y + Math.sin(out) * len / 2, z);
        ant.rotation.z = out - Math.PI / 2;
        group.add(ant);
      }
    }

    // --- Greebles (small surface hardware) ---------------------------------
    if (spec.greebles.density > 0) {
      const gRng = makeRng(spec.detail.textureSeed ^ 0x1234);
      const shapes = [
        () => track(new THREE.BoxGeometry(Rmax * 0.3, Rmax * 0.5, Rmax * 0.12)),
        () => track(new THREE.BoxGeometry(Rmax * 0.16, Rmax * 0.16, Rmax * 0.16)),
        () => track(new THREE.CylinderGeometry(Rmax * 0.1, Rmax * 0.1, Rmax * 0.3, 6)),
        () => track(new THREE.TorusGeometry(Rmax * 0.18, Rmax * 0.05, 6, 10)),
      ];
      const cache = shapes.map((f) => f());
      for (let i = 0; i < spec.greebles.density; i++) {
        const z = range(gRng, -halfL * 0.92, halfL * 0.8);
        const a = range(gRng, 0, Math.PI * 2);
        const p0 = surfaceAt(z, a);
        if (Math.hypot(p0.x, p0.y) < 1e-3) continue;
        const geo = cache[Math.floor(gRng() * cache.length)];
        const mesh = new THREE.Mesh(geo, gRng() < 0.3 ? accentMat : (gRng() < 0.5 ? trimMat : darkMat));
        mesh.position.set(p0.x * 1.01, p0.y * 1.01, z);
        // +Z of each greeble points straight out of the hull, so the flat
        // fittings sit against the skin instead of spiking off it.
        mesh.lookAt(mesh.position.clone().multiplyScalar(2));
        mesh.rotateZ(range(gRng, 0, Math.PI));
        mesh.scale.setScalar(range(gRng, 0.6, 1.5));
        group.add(mesh);
      }
    }

    // --- Running lights -----------------------------------------------------
    if (spec.lights.id !== "dark") {
      const lRng = makeRng(spec.detail.textureSeed ^ 0x99aa);
      const mkLight = (pos, colorHex, blink) => {
        const g = track(new THREE.SphereGeometry(Math.max(0.004, Rmax * 0.1), 6, 5));
        const m = trackM(new THREE.MeshPhongMaterial({ color: 0x0a0a0a, emissive: new THREE.Color(colorHex) }));
        const mesh = new THREE.Mesh(g, m);
        mesh.position.copy(pos);
        group.add(mesh);
        if (blink) anim.blinkers.push({ mat: m, phase: lRng() * Math.PI * 2, base: 1 });
      };
      const strobe = spec.lights.id === "strobe";
      mkLight(new THREE.Vector3(skinAt(0) * 1.02, 0, 0), 0x22ff55, strobe);
      mkLight(new THREE.Vector3(-skinAt(0) * 1.02, 0, 0), 0xff2233, strobe);
      mkLight(new THREE.Vector3(0, topAt(-L * 0.2) * 1.02, -L * 0.2), 0xffffff, true);
      mkLight(new THREE.Vector3(0, 0, halfL * 0.97), 0xffffff, strobe);
      if (spec.lights.id === "halo") {
        const hg = track(new THREE.TorusGeometry(Rmax * 1.35, Rmax * 0.05, 6, 24));
        const hm = trackM(new THREE.MeshBasicMaterial({
          color: new THREE.Color(P.glow), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        const halo = new THREE.Mesh(hg, hm);
        halo.position.set(0, -Rmax * 0.4, 0);
        halo.rotation.x = Math.PI / 2;
        group.add(halo);
      }
    }

    // --- Hull-class signature extras ---------------------------------------
    if (spec.hull.id === "cathedral") {
      // Flying buttresses + spires: the gothic silhouette that names the class.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const z = -L * 0.1;
        const p0 = surfaceAt(z, a);
        const out = Math.atan2(p0.y, p0.x);
        const g = track(new THREE.BoxGeometry(Rmax * 0.12, Rmax * 1.6, L * 0.5));
        const b = new THREE.Mesh(g, hullMat);
        b.position.set(p0.x + Math.cos(out) * Rmax * 0.5, p0.y + Math.sin(out) * Rmax * 0.5, z);
        b.rotation.z = out;
        group.add(b);
        const sg = track(new THREE.ConeGeometry(Rmax * 0.14, L * 0.3, 6));
        sg.rotateX(Math.PI / 2);
        const spire = new THREE.Mesh(sg, accentMat);
        spire.position.set(b.position.x, b.position.y, z + L * 0.4);
        group.add(spire);
      }
    } else if (spec.hull.id === "modular") {
      // Stacked container blocks along the spine.
      const cRng = makeRng(spec.detail.textureSeed ^ 0x5150);
      for (let i = 0; i < spec.detail.segments; i++) {
        const z = -L * 0.3 + i * (L * 0.5 / Math.max(1, spec.detail.segments - 1));
        const g = track(new THREE.BoxGeometry(Rmax * 1.5, Rmax * 0.9, L * 0.1));
        const box = new THREE.Mesh(g, cRng() < 0.5 ? hullMat : accentMat);
        box.position.set(0, topAt(z) * 0.6 + Rmax * 0.4, z);
        group.add(box);
      }
    } else if (spec.hull.id === "lancer") {
      // Prow ram.
      const g = track(new THREE.ConeGeometry(Rmax * 0.35, L * 0.3, 6));
      g.rotateX(Math.PI / 2);
      const ram = new THREE.Mesh(g, accentMat);
      ram.position.z = halfL * 1.05;
      group.add(ram);
    } else if (spec.hull.id === "organic") {
      // Chitin ribs wrapping the bulges.
      for (let i = 0; i < 5; i++) {
        const z = -halfL * 0.5 + i * (halfL / 4);
        const r = skinAt(z);
        const g = track(new THREE.TorusGeometry(r * 1.03, Rmax * 0.07, 6, 18));
        const rib = new THREE.Mesh(g, accentMat);
        rib.position.z = z;
        group.add(rib);
      }
    } else if (spec.hull.id === "saucer") {
      // Rim lighting band + a small command blister on top.
      const g = track(new THREE.TorusGeometry(halfL * 0.99, Rmax * 0.05, 6, 40));
      const m = trackM(new THREE.MeshBasicMaterial({
        color: new THREE.Color(P.glow), transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const band = new THREE.Mesh(g, m);
      band.rotation.x = Math.PI / 2;
      group.add(band);
      const bg = track(new THREE.SphereGeometry(halfL * 0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5));
      const blister = new THREE.Mesh(bg, glassMat);
      blister.position.y = (def.thick || 0.2) * 0.45;
      group.add(blister);
    }

    // Normalise: the callers expect roughly the old cone's footprint, so scale
    // the finished ship to a known overall length.
    group.scale.setScalar(1);

    let lastRev = ShipModel.revision;
    let currentCfg = cfg;

    function update(t) {
      // Drive flicker.
      for (const e of anim.engines) {
        const s = e.base * (0.82 + 0.22 * Math.sin(t * 6 + e.phase) + 0.06 * Math.sin(t * 17.3 + e.phase));
        e.sprite.scale.set(s, s, 1);
      }
      // Nav-light blink.
      for (const b of anim.blinkers) {
        const on = (Math.sin(t * spec.detail.blinkRate * 3 + b.phase) > 0.4) ? 1 : 0.08;
        b.mat.emissiveIntensity = on;
      }
      // Rotating habitats, dishes and arrays.
      for (const s of anim.spinners) {
        s.obj.rotation[s.axis] += s.speed * 0.016;
      }
      // Solar sails always face the light.
      for (const s of anim.sails) {
        s.rotation.z = t * 0.15;
      }
    }

    function dispose() {
      geos.forEach((g) => g && g.dispose && g.dispose());
      mats.forEach((m) => m && m.dispose && m.dispose());
      sprites.forEach((s) => { s.tex.dispose(); s.mat.dispose(); });
      tex.dispose();
      if (group.parent) group.parent.remove(group);
      group.clear ? group.clear() : (group.children.length = 0);
    }

    return {
      group, spec, update, dispose,
      get config() { return currentCfg; },
      get revision() { return lastRev; },
    };
  }

  // A self-refreshing wrapper: rebuilds itself whenever the player changes the
  // ship appearance, so live scenes pick the new look up without extra wiring.
  function buildLive(scaleTo) {
    const holder = new THREE.Group();
    holder.name = "gx-ship";
    let inner = null;
    let rev = -1;

    function rebuild() {
      if (inner) { inner.dispose(); inner = null; }
      inner = build(getConfig());
      if (scaleTo) inner.group.scale.setScalar(scaleTo);
      holder.add(inner.group);
      rev = ShipModel.revision;
    }
    rebuild();

    return {
      group: holder,
      get spec() { return inner ? inner.spec : null; },
      update(t) {
        if (rev !== ShipModel.revision) rebuild();
        if (inner) inner.update(t);
      },
      dispose() {
        if (inner) inner.dispose();
        inner = null;
        if (holder.parent) holder.parent.remove(holder);
      },
    };
  }

  // ==========================================================================
  // Preview rendering (editor modal + pockets portrait)
  // ==========================================================================

  function makePreviewScene(spec) {
    const scene = new THREE.Scene();
    scene.background = null;

    const key = new THREE.DirectionalLight(0xfff1dd, 1.5);
    key.position.set(2.5, 3, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(new THREE.Color(spec.palette.glow), 0.55);
    fill.position.set(-3, -1, -1.5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.7);
    rim.position.set(-1, 1.5, -3);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x404a5a, 0.9));
    return scene;
  }

  function createPreview(canvas, cfg) {
    if (!canvas || typeof THREE === "undefined") return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) {
      return null;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height, false);
    if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    let scene = null;
    let model = null;
    let yaw = 0.6, pitch = 0.32, dist = 2.6;
    let dragging = false, lastX = 0, lastY = 0;
    let t = 0;

    function setConfig(c) {
      if (model) { model.dispose(); model = null; }
      const spec = resolve(c);
      scene = makePreviewScene(spec);
      model = build(c);
      scene.add(model.group);
      // Frame the ship regardless of hull class.
      const box = new THREE.Box3().setFromObject(model.group);
      const size = box.getSize(new THREE.Vector3());
      dist = Math.max(size.x, size.y, size.z) * 2.35 + 0.3;
    }

    function resize() {
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function tick(dt) {
      if (!scene || !model) return;
      t += (dt || 0.016);
      // Right stick turns the ship over, the pad's stand-in for dragging it.
      let stick = false;
      if (window.AnalogStickInput && AnalogStickInput.hasPad && AnalogStickInput.hasPad()) {
        const rx = AnalogStickInput.rightX();
        const ry = AnalogStickInput.rightY();
        if (rx || ry) {
          stick = true;
          yaw -= rx * 2.4 * (dt || 0.016);
          pitch = clamp(pitch - ry * 1.6 * (dt || 0.016), -1.2, 1.2);
        }
      }
      if (!dragging && !stick) yaw += 0.0045;
      model.update(t);
      resize();
      const cy = Math.cos(pitch) * dist;
      camera.position.set(Math.sin(yaw) * cy, Math.sin(pitch) * dist, Math.cos(yaw) * cy);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }

    const onDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onMove = (e) => {
      if (!dragging) return;
      yaw -= (e.clientX - lastX) * 0.01;
      pitch = clamp(pitch + (e.clientY - lastY) * 0.008, -1.2, 1.2);
      lastX = e.clientX; lastY = e.clientY;
    };
    const onUp = () => { dragging = false; };
    const onWheel = (e) => { e.preventDefault(); dist = clamp(dist * (1 + Math.sign(e.deltaY) * 0.1), 0.4, 12); };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    setConfig(cfg || getConfig());

    return {
      setConfig, tick,
      dispose() {
        canvas.removeEventListener("mousedown", onDown);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        canvas.removeEventListener("wheel", onWheel);
        if (model) model.dispose();
        renderer.dispose();
        const ctx = renderer.getContext && renderer.getContext();
        if (ctx && renderer.forceContextLoss) {
          try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
        }
      },
    };
  }

  // One-off render used for the static pockets portrait. Cached by config key.
  const portraitCache = new Map();

  function renderPortrait(cfg, px) {
    cfg = cfg || getConfig();
    const spec = resolve(cfg);
    const size = px || 256;
    const cacheKey = spec.key + "@" + size;
    if (portraitCache.has(cacheKey)) return portraitCache.get(cacheKey);
    if (typeof THREE === "undefined") return null;

    let renderer = null;
    let model = null;
    let url = null;
    try {
      const canvas = newCanvas(size, size);
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(size, size, false);
      if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
      const scene = makePreviewScene(spec);
      model = build(cfg);
      scene.add(model.group);
      model.update(1.2);

      const box = new THREE.Box3().setFromObject(model.group);
      const s = box.getSize(new THREE.Vector3());
      const dist = Math.max(s.x, s.y, s.z) * 2.2 + 0.25;
      const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
      camera.position.set(dist * 0.62, dist * 0.42, dist * 0.66);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      url = canvas.toDataURL("image/png");
    } catch (e) {
      url = null;
    } finally {
      if (model) model.dispose();
      if (renderer) {
        renderer.dispose();
        try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      }
    }
    if (url) {
      portraitCache.set(cacheKey, url);
      if (portraitCache.size > 8) portraitCache.delete(portraitCache.keys().next().value);
    }
    return url;
  }

  // ==========================================================================
  // Public module
  // ==========================================================================

  const ShipModel = {
    TRAITS,
    revision: 0,
    hashString,
    makeRng,
    worldSeed,
    defaultSeed,
    defaultConfig,
    getConfig,
    setConfig,
    randomConfig,
    cycleTrait,
    resolve,
    describe,
    build,
    buildLive,
    createPreview,
    renderPortrait,
    optionOf,
  };
  GS.ShipModel = ShipModel;

  // Loading a save swaps in a different (or absent) appearance, so any live
  // model has to be told to rebuild itself.
  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    ShipModel.revision++;
  };

  // ==========================================================================
  // Appearance editor modal
  // ==========================================================================

  const IT = () => ConfigManager && ConfigManager.language === "it";

  // Action buttons, in DOM order. They extend the trait rows into a single focus
  // cycle so a gamepad can reach every action in the modal.
  const BUTTON_IDS = ["gx-btn-random", "gx-btn-reset", "gx-btn-apply", "gx-btn-cancel"];

  const ShipAppearance = {
    _root: null,
    _preview: null,
    _cfg: null,
    _sel: 0,
    _onClose: null,

    isOpen() { return !!this._root; },

    open(opts) {
      if (this._root) return;
      opts = opts || {};
      this._onClose = opts.onClose || null;
      this._cfg = getConfig();
      this._sel = 0;

      const root = document.createElement("div");
      root.id = "gx-ship-appearance";
      document.body.appendChild(root);
      this._root = root;

      root.innerHTML = `
        <div class="gx-panel">
          <div class="gx-left">
            <h2 id="gx-ship-name"></h2>
            <div class="gx-sub" id="gx-ship-class"></div>
            <canvas class="gx-view" id="gx-ship-view"></canvas>
            <div class="gx-hint" id="gx-ship-drag-hint"></div>
          </div>
          <div class="gx-right">
            <h2>${T('ShipModel.appearance')}</h2>
            <div class="gx-sub">${T('ShipModel.hullConfiguration')}</div>
            <div class="gx-rows" id="gx-ship-rows"></div>
            <div class="gx-btns">
              <div class="gx-btn" id="gx-btn-random">${T('ShipModel.randomize')}</div>
              <div class="gx-btn" id="gx-btn-reset">${T('ShipModel.worldSeed')}</div>
            </div>
            <div class="gx-btns">
              <div class="gx-btn" id="gx-btn-apply">${T('ShipModel.apply')}</div>
              <div class="gx-btn" id="gx-btn-cancel">${T('ShipModel.cancel')}</div>
            </div>
            <div class="gx-hint" id="gx-ship-editor-hint"></div>
          </div>
        </div>`;

      const canvas = root.querySelector("#gx-ship-view");
      this._preview = createPreview(canvas, this._cfg);

      root.querySelector("#gx-btn-random").onclick = () => this.randomize();
      root.querySelector("#gx-btn-reset").onclick = () => this.applyCfg(defaultConfig());
      root.querySelector("#gx-btn-apply").onclick = () => this.close(true);
      root.querySelector("#gx-btn-cancel").onclick = () => this.close(false);

      this._keyHandler = (e) => this.onKey(e);
      window.addEventListener("keydown", this._keyHandler, true);

      this._refreshHints();
      this.refresh();
    },

    // The editor already answers to a pad (d-pad/stick, A, B, X); the two hint
    // lines name its buttons whenever one is plugged in, and the keys otherwise.
    _refreshHints() {
      if (!this._root) return;
      const pad = !!(window.AnalogStickInput && AnalogStickInput.hasPad &&
        AnalogStickInput.hasPad());
      if (pad === this._hintPad) return;
      this._hintPad = pad;
      const drag = this._root.querySelector("#gx-ship-drag-hint");
      const editor = this._root.querySelector("#gx-ship-editor-hint");
      if (drag) drag.textContent = T(pad ? 'ShipModel.rotateHintPad' : 'ShipModel.dragToRotate');
      if (editor) editor.textContent = T(pad ? 'ShipModel.editorHintPad' : 'ShipModel.editorHint');
    },

    refresh() {
      if (!this._root) return;
      const spec = resolve(this._cfg);
      this._root.querySelector("#gx-ship-name").textContent = spec.name;
      this._root.querySelector("#gx-ship-class").textContent =
        spec.registry + " - " + spec.hull.label + " - " + spec.engine.label;

      const rows = describe(this._cfg);
      const html = rows.map((r, i) => `
        <div class="gx-row ${i === this._sel ? "sel" : ""}" data-i="${i}">
          <span class="gx-lbl">${r.label}</span>
          <span class="gx-arrow" data-k="${r.key}" data-d="-1">&#9664;</span>
          <span class="gx-val">${r.value}</span>
          <span class="gx-arrow" data-k="${r.key}" data-d="1">&#9654;</span>
        </div>`).join("");
      const box = this._root.querySelector("#gx-ship-rows");
      box.innerHTML = html;
      box.querySelectorAll(".gx-arrow").forEach((el) => {
        el.onclick = (ev) => {
          ev.stopPropagation();
          this.cycle(el.dataset.k, parseInt(el.dataset.d, 10));
        };
      });
      box.querySelectorAll(".gx-row").forEach((el) => {
        el.onclick = () => { this._sel = parseInt(el.dataset.i, 10); this.refresh(); };
      });
      const sel = box.querySelector(".gx-row.sel");
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });

      // The four action buttons sit after the trait rows in one focus cycle, so
      // a pad can reach Randomize/World Seed/Apply/Cancel without a mouse.
      const btnSel = this._sel - rows.length;
      BUTTON_IDS.forEach((id, i) => {
        const el = this._root.querySelector("#" + id);
        if (el) el.classList.toggle("sel", i === btnSel);
      });
    },

    applyCfg(cfg) {
      this._cfg = cfg;
      if (this._preview) this._preview.setConfig(cfg);
      if (window.SoundManager) SoundManager.playCursor();
      this.refresh();
    },

    cycle(key, dir) {
      this.applyCfg(cycleTrait(this._cfg, key, dir));
    },

    randomize() {
      this.applyCfg(randomConfig());
    },

    // Total focus slots: one per trait row, then one per action button.
    slotCount() { return TRAITS.length + BUTTON_IDS.length; },

    moveSel(delta) {
      const n = this.slotCount();
      this._sel = (this._sel + delta + n) % n;
      if (window.SoundManager) SoundManager.playCursor();
      this.refresh();
    },

    // Left/Right cycles the variant on a trait row; on a button row it walks
    // between the buttons instead, so the pad never reaches a dead direction.
    stepSel(dir) {
      if (this._sel < TRAITS.length) {
        this.cycle(TRAITS[this._sel].key, dir);
      } else {
        const i = this._sel - TRAITS.length;
        const next = Math.min(BUTTON_IDS.length - 1, Math.max(0, i + dir));
        if (next !== i) { this._sel = TRAITS.length + next; this.refresh(); }
      }
    },

    // Confirm on a trait row means "done"; on a button row it runs that button.
    activateSel() {
      const i = this._sel - TRAITS.length;
      if (i < 0) { this.close(true); return; }
      switch (BUTTON_IDS[i]) {
        case "gx-btn-random": this.randomize(); break;
        case "gx-btn-reset": this.applyCfg(defaultConfig()); break;
        case "gx-btn-apply": this.close(true); break;
        case "gx-btn-cancel": this.close(false); break;
      }
    },

    onKey(e) {
      if (!this._root) return;
      let handled = true;
      switch (e.key) {
        case "ArrowUp": case "w": case "W": this.moveSel(-1); break;
        case "ArrowDown": case "s": case "S": this.moveSel(1); break;
        case "ArrowLeft": case "a": case "A": this.stepSel(-1); break;
        case "ArrowRight": case "d": case "D": this.stepSel(1); break;
        case "r": case "R":
          this.randomize(); break;
        case "Enter": case " ":
          this.activateSel(); break;
        case "Escape":
          this.close(false); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    },

    // A gamepad emits no DOM keydown, so onKey alone left this modal unusable on
    // a pad. Poll the engine Input each frame for the same actions: d-pad/stick
    // navigates, A confirms, B backs out, X randomizes.
    updateInput() {
      if (!this._root) return;
      if (Input.isRepeated("down")) { this.moveSel(1); return; }
      if (Input.isRepeated("up")) { this.moveSel(-1); return; }
      if (Input.isRepeated("right")) { this.stepSel(1); return; }
      if (Input.isRepeated("left")) { this.stepSel(-1); return; }
      if (Input.isTriggered("shift")) { this.randomize(); return; }
      if (Input.isTriggered("ok")) { this.activateSel(); return; }
      if (Input.isTriggered("cancel") || Input.isTriggered("escape")) { this.close(false); return; }
    },

    tick(dt) {
      this.updateInput();
      this._refreshHints();
      if (this._preview) this._preview.tick(dt);
    },

    close(apply) {
      if (!this._root) return;
      if (apply) {
        setConfig(this._cfg);
        if (window.SoundManager) SoundManager.playSave();
      } else if (window.SoundManager) {
        SoundManager.playCancel();
      }
      window.removeEventListener("keydown", this._keyHandler, true);
      this._keyHandler = null;
      if (this._preview) { this._preview.dispose(); this._preview = null; }
      if (this._root.parentNode) this._root.parentNode.removeChild(this._root);
      this._root = null;
      const cb = this._onClose;
      this._onClose = null;
      if (cb) cb(!!apply);
    },
  };
  GS.ShipAppearance = ShipAppearance;

  // ==========================================================================
  // Scene wrapper, used when the modal is opened straight from the map menu
  // ==========================================================================

  class Scene_ShipAppearance extends Scene_MenuBase {
    create() {
      super.create();
      this._closing = false;
      ShipAppearance.open({ onClose: () => { this._closing = true; } });
      this._last = performance.now();
    }

    update() {
      super.update();
      if (this._closing) {
        if (!this._popped) { this._popped = true; SceneManager.pop(); }
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      ShipAppearance.tick(dt);
    }

    terminate() {
      super.terminate();
      if (ShipAppearance.isOpen()) ShipAppearance.close(false);
    }
  }
  window.Scene_ShipAppearance = Scene_ShipAppearance;

  GS.openShipAppearance = function () {
    SceneManager.push(Scene_ShipAppearance);
  };
})();
