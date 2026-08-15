//=============================================================================
// CharacterCreation3DModel.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v2.2] Deep 3D model editor for character creation: mix any body part from any creature (humanoid + custom creatures), fast text grid pickers.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help CharacterCreation3DModel.js
 *
 * Adds a 3D model customization step to humanoid character creation, shown
 * right after the bust has been selected. The player sculpts a procedural
 * humanoid (3DBattler_Humanoid rig) per party member.
 *
 * v2.0 - Part mixing
 * ------------------
 * Six anatomical slots (Head, Torso, Left/Right Arm, Left/Right Leg) can each
 * be filled with the matching part extracted from ANY of the ~600 registered
 * 3D battler archetypes: a dragon head on a human torso with spider legs, etc.
 * Every picker opens a grid dropdown where each option is a live 3D thumbnail
 * (rendered once by a shared offscreen renderer, cached, and generated lazily
 * as cells scroll into view). A search box filters the roster.
 *
 * Continuous knobs (height, build, head size, ears, nose, skin colour) are
 * drag sliders; extras (fangs / horns / tail / wings / halo) are segmented
 * toggles. No arrow steppers.
 *
 * The chosen configuration is persisted per actor in
 * $gameSystem._cc3DModelByActor and rendered live in the custom status
 * screen (CustomSceneStatus.js) in place of the flat 2D bust.
 *
 * Creature party members instead persist the random generation seed rolled
 * during creature selection in $gameSystem._cc3DSeedByActor.
 *
 * Public API (all guarded, safe when the 3D system is absent):
 *   window.CC3DModel.isAvailable()
 *   window.CC3DModel.getConfig(actorId) / setConfig(actorId, cfg)
 *   window.CC3DModel.getCreatureSeed(actorId) / setCreatureSeed(actorId, s)
 *   window.CC3DModel.buildModel(cfg, actorId) -> Promise<battler|null>
 *   window.CC3DModel.withGenSeed(seed, fn)
 *   window.Scene_CC3DModel.setup(actorId, returnSceneClass)
 *
 * Load AFTER Battler3D/3DBattlerSystem and Battler3D/3DBattler_Humanoid.
 *
 * v2.2 - Slot compatibility filtering
 * ------------------------------------
 * Every per-slot picker (and the creature chimera builder, configFromArchetypes)
 * now only offers archetypes with a REAL matching part for that slot, instead of
 * every registered archetype regardless of anatomy. Compatibility is precomputed
 * in js/db/Battler3D/PartCompatibility.json by
 * tools/battler3d/scripts/gen_part_compatibility.py; re-run that script after
 * editing any 3DBattler_*.js family file's part map/registration, or PART_SLOTS/
 * BODY_KEYS below.
 */

(() => {
  "use strict";


  //===========================================================================
  // Constants
  //===========================================================================

  // Humanoid body presets offered as the base rig (must exist in
  // window.Battler3D.CREATURE_PROFILES; missing ones are filtered out).
  const BODY_KEYS = [
    "humanoid", "humanoid_roguelite", "elven", "gnome", "goblin", "hobgoblin",
    "orc", "ogre", "skeleton", "undead", "vampire", "reptilian", "minotaur",
    "demon", "wingeddemon", "angel", "fairy", "scarecrow", "robot", "golem",
    "armoredknight", "constructedundead", "doubleheadedhumanoid", "roboticdefender"
  ];
  const TEXTURE_POOL_KEYS = ["flesh", "green", "bone", "metal", "stone"];

  // Hair styles / colours come from the shared Battler3D hair library so the
  // creator can never drift from what the rig actually knows how to build. The
  // fallbacks keep the pickers usable if an older core is loaded.
  function hairLib() { return (window.Battler3D && window.Battler3D.Hair) || null; }
  function hairStyleKeys() {
    const H = hairLib();
    return (H && H.STYLES && H.STYLES.length) ? H.STYLES : ["short", "bald"];
  }
  function hairColorKeys() {
    const H = hairLib();
    return (H && H.COLOR_KEYS && H.COLOR_KEYS.length) ? H.COLOR_KEYS : ["brown"];
  }
  function hairColorHex(key) {
    const H = hairLib();
    return H && H.colorHex ? H.colorHex(key) : 0x5c3b22;
  }
  function hairSwatchCss(key) {
    return "#" + ("000000" + hairColorHex(key).toString(16)).slice(-6);
  }
  // Player-facing names for the library's keys. Anything the library adds later
  // falls through to the generic prettifier rather than showing blank.
  function hairLabel(kind, key) {
    const full = kind === "haircolor"
      ? 'CharCreate.hairColor.' + key
      : 'CharCreate.hairStyle.' + key;
    return T.has(full) ? T(full) : prettyArchetypeName(key);
  }
  // Hair is scalp-only: a body made of bone/metal/stone never grows it, matching
  // the rig's own rule, so the picker does not promise something it will ignore.
  function hairApplies(cfg) {
    return ["bone", "metal", "stone"].indexOf(cfg.texturePool) < 0;
  }

  // Anatomical slots on the humanoid rig. Each donor part is grafted onto the
  // slot's ANCHOR mesh (which the rig FK-animates, so the graft moves with the
  // body). `hideMats` meshes have their own visual muted (material.visible)
  // while still anchoring children; `hideMeshes` are fully hidden (they carry
  // no graft). `donorKeys` are tried in order against the donor's part map,
  // then a whole-model fallback. `fit` is the target size in rig units.
  // `seed` offsets the donor RNG so different slots of the SAME archetype vary.
  const PART_SLOTS = {
    head: {
      order: 0, label: () => T('CharCreate.head'),
      anchor: (b) => b.head, hideMats: (b) => [b.head], hideMeshes: () => [],
      donorKeys: ["HEAD", "SKULL", "HEAD_ONE", "HEAD_LEFT", "BEAK", "CEPHALOTHORAX", "CORE", "BRAIN"],
      fit: 0.9, seed: 7919
    },
    torso: {
      order: 1, label: () => T('CharCreate.torso'),
      anchor: (b) => b.torso, hideMats: (b) => [b.torso], hideMeshes: () => [],
      donorKeys: ["TORSO", "BODY", "MASS", "ABDOMEN", "RIBCAGE", "CORE", "CHESTPLATE"],
      fit: 1.0, seed: 104729
    },
    armL: {
      order: 2, label: () => T('CharCreate.leftArm'),
      anchor: (b) => b.leftUpperArm, hideMats: (b) => [b.leftUpperArm],
      hideMeshes: (b) => [b.leftForearm, b.leftHand],
      donorKeys: ["LEFT_ARM", "LEFT_UPPER_ARM", "ARM", "LEFT_WING", "LEFT_LEG"],
      fit: 0.6, seed: 1299709
    },
    armR: {
      order: 3, label: () => T('CharCreate.rightArm'),
      anchor: (b) => b.rightUpperArm, hideMats: (b) => [b.rightUpperArm],
      hideMeshes: (b) => [b.rightForearm, b.rightHand],
      donorKeys: ["RIGHT_ARM", "RIGHT_UPPER_ARM", "ARM", "RIGHT_WING", "RIGHT_LEG"],
      fit: 0.6, seed: 15485863
    },
    legL: {
      order: 4, label: () => T('CharCreate.leftLeg'),
      anchor: (b) => b.leftThigh, hideMats: (b) => [b.leftThigh],
      hideMeshes: (b) => [b.leftShin, b.leftFoot],
      donorKeys: ["LEFT_LEG", "LEFT_THIGH", "LEG", "TALONS", "TAIL"],
      fit: 0.62, seed: 179424673
    },
    legR: {
      order: 5, label: () => T('CharCreate.rightLeg'),
      anchor: (b) => b.rightThigh, hideMats: (b) => [b.rightThigh],
      hideMeshes: (b) => [b.rightShin, b.rightFoot],
      donorKeys: ["RIGHT_LEG", "RIGHT_THIGH", "LEG", "TALONS", "TAIL"],
      fit: 0.62, seed: 32452843
    }
  };
  const SLOT_NAMES = Object.keys(PART_SLOTS).sort((a, b) => PART_SLOTS[a].order - PART_SLOTS[b].order);

  // Curated humanoid head presets, listed at the TOP of the head picker before
  // the ~600 creature archetypes. Each builds a bespoke head (skin-matched to
  // the body) so the roster reads as humanoid variety rather than goblin clones.
  // Ear shapes: 'round' (default, non-goblin), 'pointed' (goblin), 'long' (elf),
  // 'big' (large round), 'none'. The pointed-ear look the base rig used to wear
  // is preserved here as "Goblin Head". Keys are referenced as `hhead:<key>`.
  const HUMANOID_HEADS = [
    { key: "human", name: () => T('CharCreate.human'), ear: "round", nose: 0.9, shape: [1, 1, 1] },
    { key: "goblin", name: () => T('CharCreate.goblinHead'), ear: "pointed", nose: 1.0, shape: [1, 1, 1] },
    { key: "elf", name: () => T('CharCreate.elf'), ear: "long", nose: 0.75, shape: [0.95, 1.06, 0.95] },
    { key: "round", name: () => T('CharCreate.rounded'), ear: "round", nose: 0.8, shape: [1.12, 1.05, 1.12] },
    { key: "narrow", name: () => T('CharCreate.narrow'), ear: "round", nose: 1.0, shape: [0.85, 1.12, 0.95] },
    { key: "square", name: () => T('CharCreate.squareJaw'), ear: "round", nose: 1.0, shape: [1.05, 0.96, 1.0], jaw: 1 },
    { key: "youthful", name: () => T('CharCreate.youthful'), ear: "round", nose: 0.65, shape: [1.05, 0.95, 1.05], eyeBig: 1 },
    { key: "elder", name: () => T('CharCreate.elder'), ear: "big", nose: 1.35, shape: [0.95, 1.0, 0.95], brow: 1 },
    { key: "bigears", name: () => T('CharCreate.bigEars'), ear: "big", nose: 0.85, shape: [1.0, 1.0, 1.0] },
    { key: "orcish", name: () => T('CharCreate.orcish'), ear: "round", nose: 0.6, shape: [1.1, 1.0, 1.05], fangs: 2, brow: 1 },
    { key: "tusked", name: () => T('CharCreate.tusked'), ear: "round", nose: 0.8, shape: [1.05, 1.0, 1.05], fangs: 2 },
    { key: "fanged", name: () => T('CharCreate.fanged'), ear: "pointed", nose: 0.9, shape: [1.0, 1.0, 1.0], fangs: 1 },
    { key: "beastkin", name: () => T('CharCreate.beastkin'), ear: "pointed", nose: 1.1, shape: [1.0, 0.98, 1.06], snout: 1, fangs: 2 },
    { key: "longface", name: () => T('CharCreate.longFace'), ear: "round", nose: 1.1, shape: [0.9, 1.16, 0.95] },
    { key: "flat", name: () => T('CharCreate.flatFace'), ear: "none", nose: 0.4, shape: [1.06, 1.0, 0.9] },
    { key: "horned", name: () => T('CharCreate.horned'), ear: "round", nose: 0.9, shape: [1.0, 1.0, 1.0], horns: 1 },
    { key: "cyclops", name: () => T('CharCreate.cyclops'), ear: "round", nose: 0.9, shape: [1.0, 1.0, 1.0], oneEye: 1 }
  ];
  const HUMANOID_HEAD_MAP = {};
  HUMANOID_HEADS.forEach((h) => { HUMANOID_HEAD_MAP[h.key] = h; });
  const HHEAD_PREFIX = "hhead:";
  const isHeadPreset = (v) => typeof v === "string" && v.indexOf(HHEAD_PREFIX) === 0;

  // Body-preset keyword map: infers the starting body from the bust/sprite name
  // chosen in the previous step (elf portrait -> elven body, etc.).
  const BASE_KEYWORDS = [
    ["hobgoblin", "hobgoblin"], ["goblin", "goblin"], ["orc", "orc"], ["ogre", "ogre"],
    ["elven", "elven"], ["elf", "elven"], ["skeleton", "skeleton"], ["skull", "skeleton"],
    ["undead", "undead"], ["zombie", "undead"], ["ghoul", "undead"], ["vampire", "vampire"],
    ["demon", "demon"], ["fiend", "demon"], ["angel", "angel"], ["fairy", "fairy"], ["pixie", "fairy"],
    ["gnome", "gnome"], ["dwarf", "gnome"], ["robot", "robot"], ["android", "robot"], ["cyborg", "robot"],
    ["golem", "golem"], ["knight", "armoredknight"], ["paladin", "armoredknight"],
    ["reptil", "reptilian"], ["lizard", "reptilian"], ["minotaur", "minotaur"], ["scarecrow", "scarecrow"]
  ];

  //===========================================================================
  // Availability + persistence
  //===========================================================================

  function isAvailable() {
    return typeof THREE !== "undefined" &&
      !!(window.Battler3D && window.Battler3D.create && window.Battler3D.createCustomHumanoid);
  }

  function configStore() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return null;
    if (!$gameSystem._cc3DModelByActor) $gameSystem._cc3DModelByActor = {};
    return $gameSystem._cc3DModelByActor;
  }
  function seedStore() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return null;
    if (!$gameSystem._cc3DSeedByActor) $gameSystem._cc3DSeedByActor = {};
    return $gameSystem._cc3DSeedByActor;
  }

  function getConfig(actorId) {
    const s = configStore();
    return (s && s[actorId]) ? normalizeConfig(s[actorId]) : null;
  }
  function setConfig(actorId, cfg) {
    const s = configStore();
    if (!s) return;
    if (cfg) s[actorId] = JSON.parse(JSON.stringify(normalizeConfig(cfg)));
    else delete s[actorId];
  }
  function getCreatureSeed(actorId) {
    const s = seedStore();
    return (s && s[actorId]) || null;
  }
  function setCreatureSeed(actorId, seed) {
    const s = seedStore();
    if (!s) return;
    if (seed) s[actorId] = seed;
    else delete s[actorId];
  }

  function defaultParts() {
    const p = {};
    SLOT_NAMES.forEach((k) => { p[k] = "default"; });
    return p;
  }

  function defaultConfig() {
    return {
      base: "humanoid",
      parts: defaultParts(),
      seed: 1,
      height: 1.0, bulk: 1.0, headSize: 1.0, ears: 0.8, nose: 0.9,
      hue: 0.07, sat: 0.45, lit: 0.5, texturePool: "flesh",
      hairStyle: "short", hairColor: "darkbrown",
      fangs: 0, horns: 0, tail: 0, wings: 0, halo: 0
    };
  }

  // Fill in any missing keys and migrate the legacy flat `head` field into the
  // parts object, so configs saved by v1.0 keep working.
  function normalizeConfig(cfg) {
    const out = Object.assign(defaultConfig(), cfg || {});
    out.parts = Object.assign(defaultParts(), (cfg && cfg.parts) || {});
    if (cfg && cfg.head && cfg.head !== "default" && (!cfg.parts || !cfg.parts.head)) {
      out.parts.head = cfg.head;
    }
    delete out.head;
    return out;
  }

  //===========================================================================
  // Option lists
  //===========================================================================

  function bodyOptions() {
    const P = (window.Battler3D && window.Battler3D.CREATURE_PROFILES) || {};
    const keys = BODY_KEYS.filter((k) => !!P[k]);
    return keys.length ? keys : ["humanoid"];
  }

  // A humanoid base uses the biped rig (part-swappable). Any other archetype is
  // treated as a whole non-humanoid "skeleton structure" built directly. Only
  // the creature editor offers the non-humanoid structures; humanoid party
  // members are restricted to bodyOptions().
  const _bodySet = new Set(BODY_KEYS);
  function isHumanoidBase(key) {
    return _bodySet.has(key);
  }

  // Structure roster for the creature editor: the editable humanoid presets
  // first, then every non-humanoid archetype skeleton (quadruped, serpent,
  // arachnid, avian, draconic, ooze, ...), each built whole with a seed-driven
  // look. Used only in creature mode.
  function structureOptions() {
    const hum = bodyOptions();
    const humSet = new Set(hum);
    const rest = allArchetypes().filter((k) => !humSet.has(k));
    return hum.concat(rest);
  }

  // Every registered archetype, sorted, cached (the registry is fixed at load).
  let _archCache = null;
  function allArchetypes() {
    if (_archCache) return _archCache;
    let keys = [];
    if (window.Battler3D && window.Battler3D.list) keys = window.Battler3D.list().slice();
    _archCache = keys.sort();
    return _archCache;
  }

  // Precomputed archetype -> slot -> matched donorKey (or null), generated by
  // tools/battler3d/scripts/gen_part_compatibility.py from the real per-archetype
  // _partMeshMap contents; re-run that script after touching any 3DBattler_*.js
  // family file's part map or registration, or PART_SLOTS/BODY_KEYS below.
  function partCompatibility() {
    return (window.Battler3D && window.Battler3D.PartCompatibility) || {};
  }

  // Does this archetype actually have a matching mesh for this slot? Humanoid
  // bases always do (the rig has every part); everything else is looked up in
  // the generated compatibility table (absent/stale data -> not compatible,
  // never silently "everything matches").
  function isSlotCompatible(archetypeKey, slot) {
    if (isHumanoidBase(archetypeKey)) return true;
    const entry = partCompatibility()[archetypeKey];
    return !!(entry && entry[slot]);
  }

  // Every registered archetype that has a real matching part for this slot
  // (excludes donors that would otherwise silently graft their whole model,
  // shrunk down, onto the anchor). Cached per slot like allArchetypes().
  let _compatCache = {};
  function compatibleArchetypesForSlot(slot) {
    if (_compatCache[slot]) return _compatCache[slot];
    const list = allArchetypes().filter((k) => isSlotCompatible(k, slot));
    _compatCache[slot] = list;
    return list;
  }

  // The specific _partMeshMap key an archetype matched for this slot (used both
  // as a donor's part-picker filter above, and -- for a non-humanoid creature
  // STRUCTURE acting as the HOST/base -- to find which of its own meshes a
  // slot should graft onto). Humanoid bases use their own hardcoded rig
  // properties instead (see PART_SLOTS' anchor()), so this only applies to
  // non-humanoid hosts/donors.
  function matchedDonorKeyForSlot(archetypeKey, slot) {
    const entry = partCompatibility()[archetypeKey];
    return (entry && entry[slot]) || null;
  }

  // Which of the 6 slots a creature STRUCTURE (a non-humanoid base) genuinely
  // has a distinct part for. A humanoid base supports all 6 by construction.
  // A non-humanoid base's slots are deduped by matched mesh key: e.g. a spider
  // has no real arms, but armL/armR's donorKeys fall back to LEFT_LEG/RIGHT_LEG
  // (the same mesh legL/legR already claim) -- exposing both would graft two
  // different donors onto the exact same physical leg. Checked in head/torso/
  // legs-before-arms order, so a single-blob creature (e.g. an ooze, where
  // both head and torso map to CORE) shows one "Head" row instead of a
  // duplicate "Torso" row, and shared limbs read as legs rather than arms.
  let _hostSlotsCache = {};
  function hostSupportedSlots(baseKey) {
    if (isHumanoidBase(baseKey)) return SLOT_NAMES.slice();
    if (_hostSlotsCache[baseKey]) return _hostSlotsCache[baseKey];
    const claimed = new Set();
    const supported = new Set();
    ["head", "torso", "legL", "legR", "armL", "armR"].forEach((slot) => {
      const key = matchedDonorKeyForSlot(baseKey, slot);
      if (!key || claimed.has(key)) return;
      claimed.add(key);
      supported.add(slot);
    });
    const ordered = SLOT_NAMES.filter((s) => supported.has(s));
    _hostSlotsCache[baseKey] = ordered;
    return ordered;
  }

  function partOptions(slot) {
    return ["default"].concat(compatibleArchetypesForSlot(slot));
  }

  // The head slot lists the curated humanoid heads first, then every
  // slot-compatible archetype.
  function optionsForSlot(slot) {
    if (slot === "head") {
      return ["default"]
        .concat(HUMANOID_HEADS.map((h) => HHEAD_PREFIX + h.key))
        .concat(compatibleArchetypesForSlot("head"));
    }
    return partOptions(slot);
  }

  // Turn a raw archetype key into a readable label: drop the short family
  // namespace prefix (fk_, flk_, gob_, hmn_, ...), split camelCase / digit
  // boundaries into words, and capitalise. "fk_terragolem" -> "Terragolem",
  // "flk_banditChief" -> "Bandit Chief". A prefix is only stripped when it is a
  // short (2-4 char) token before an underscore, so keys like
  // "humanoid_roguelite" keep their meaningful first word.
  function prettyArchetypeName(key) {
    let s = String(key || "").replace(/^[a-z]{2,4}_/, "");
    s = s.replace(/_/g, " ")
         .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
         .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
         .trim();
    if (!s) s = String(key || "");
    return s.split(/\s+/).map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
  }

  function displayName(key) {
    if (key === "default") return T('CharCreate.default');
    if (isHeadPreset(key)) {
      const h = HUMANOID_HEAD_MAP[key.slice(HHEAD_PREFIX.length)];
      return h ? h.name() : key;
    }
    return prettyArchetypeName(key);
  }

  // Infer a starting body preset from a bust/sprite/category name.
  function suggestBaseFromName(str) {
    if (!str) return null;
    const s = String(str).toLowerCase();
    const bodies = bodyOptions();
    for (const [kw, base] of BASE_KEYWORDS) {
      if (s.indexOf(kw) !== -1 && bodies.indexOf(base) !== -1) return base;
    }
    return null;
  }

  // Build a starting config for a CUSTOM CREATURE from the Battler3D archetype
  // keys the player picked. The primary archetype becomes the base STRUCTURE:
  // a non-humanoid primary opens as that whole creature (spider/dragon/...), a
  // humanoid-family primary opens as the biped rig with the archetype(s) grafted
  // onto the head/torso/arms/legs as a chimera.
  function configFromArchetypes(keys) {
    const cfg = defaultConfig();
    const arch = allArchetypes();
    const valid = (keys || []).filter((k) => arch.indexOf(k) !== -1);
    if (!valid.length) return cfg;
    const primary = valid[0];
    const secondary = valid[1] || null;
    const tertiary = valid[2] || null;
    cfg.base = primary;
    cfg.parts.head = primary;
    cfg.parts.torso = primary;
    // Assign the first candidate (in preference order) that has a REAL matching
    // part for BOTH sides of the pair; a donor with no matching mesh at all
    // would otherwise silently graft its whole model, shrunk down, onto the
    // anchor. If nothing gathered is compatible, leave the pair at "default"
    // rather than grafting a broken-looking donor.
    const assignPair = (slotL, slotR, candidates) => {
      for (const cand of candidates) {
        if (cand && isSlotCompatible(cand, slotL) && isSlotCompatible(cand, slotR)) {
          cfg.parts[slotL] = cand;
          cfg.parts[slotR] = cand;
          return;
        }
      }
    };
    assignPair("armL", "armR", [secondary, tertiary, primary]);
    assignPair("legL", "legR", [tertiary, secondary, primary]);
    // If the primary is a humanoid-family profile, borrow its skin tone so the
    // base body under the grafts matches (ignored for whole non-humanoid bases).
    const P = (window.Battler3D && window.Battler3D.CREATURE_PROFILES) || {};
    const prof = P[primary];
    if (prof) {
      if (prof.hue) cfg.hue = prof.hue[0];
      if (prof.sat) cfg.sat = prof.sat[0];
      if (prof.lit) cfg.lit = Math.min(0.7, prof.lit[0]);
    }
    return cfg;
  }

  //===========================================================================
  // Profile assembly
  //===========================================================================

  function assembleProfile(cfg) {
    const P = (window.Battler3D && window.Battler3D.CREATURE_PROFILES) || {};
    const base = P[cfg.base] || P.humanoid || {};
    const prof = Object.assign({}, base);
    prof.key = "cc_" + (cfg.base || "humanoid");
    prof.scale = (base.scale || 2.6) * (cfg.height || 1);
    prof.bodyBulk = (base.bodyBulk || 1) * (cfg.bulk || 1);
    prof.headScale = (base.headScale || 1) * (cfg.headSize || 1);
    if (cfg.ears != null) prof.earScale = cfg.ears;
    if (cfg.nose != null) prof.noseScale = cfg.nose;
    if (cfg.fangs != null) prof.fangs = cfg.fangs;
    if (cfg.horns != null) prof.horns = cfg.horns;
    if (cfg.tail != null) prof.tail = cfg.tail;
    if (cfg.wings != null) prof.wings = cfg.wings;
    if (cfg.halo != null) prof.halo = cfg.halo;
    if (cfg.texturePool) { prof.texturePool = cfg.texturePool; delete prof.textures; }
    // Explicit hair always wins over the rig's own seeded roll, so what the
    // player picked is what they get. A bare-surface body stays bald.
    prof.hair = hairApplies(cfg)
      ? { style: cfg.hairStyle || "short", color: hairColorHex(cfg.hairColor) }
      : { style: "bald" };
    if (cfg.hue != null) prof.hue = [cfg.hue, 0.02];
    if (cfg.sat != null) prof.sat = [Math.max(0, cfg.sat - 0.03), 0.06];
    if (cfg.lit != null) prof.lit = [Math.max(0, cfg.lit - 0.03), 0.06];
    return prof;
  }

  function fakeIdentity(cfg, offset) {
    const id = (((cfg.seed | 0) >>> 0) || 1) + (offset || 0);
    return { enemyId: () => id, index: () => 0 };
  }

  //===========================================================================
  // Donor part extraction + grafting
  //===========================================================================

  function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m) { if (m.map) m.map.dispose(); m.dispose(); } });
      }
    });
  }

  // Resolve the donor mesh for a slot from its part map, avoiding the
  // whole-body mesh unless the slot genuinely wants it (it is used as the
  // fallback instead). Returns { part, isWhole }.
  function resolveDonorPart(donor, slotDef) {
    const map = donor._partMeshMap || {};
    let mesh = null;
    for (const k of slotDef.donorKeys) {
      if (map[k]) { mesh = map[k]; break; }
    }
    // A part that IS the entire model (some families alias BODY to model) is
    // treated as the whole-model fallback so framing/centering still works.
    if (mesh && mesh === donor.model) mesh = null;
    return { part: mesh || donor.model, isWhole: !mesh };
  }

  // Center an Object3D at the origin and scale it to a target size.
  function wrapAndFit(part, fit) {
    const box = new THREE.Box3().setFromObject(part);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const inner = new THREE.Group();
    inner.position.copy(center).multiplyScalar(-1);
    inner.add(part);
    const wrap = new THREE.Group();
    wrap.scale.setScalar((fit || 0.85) / maxDim);
    wrap.add(inner);
    return wrap;
  }

  // Skin colour from a config's HSL knobs (clamped so grafts never blow white).
  function skinColor(cfg) {
    return new THREE.Color().setHSL(
      cfg.hue != null ? cfg.hue : 0.07,
      cfg.sat != null ? cfg.sat : 0.45,
      Math.min(0.72, cfg.lit != null ? cfg.lit : 0.55)
    );
  }

  // Build a bespoke humanoid head (skin-matched to the body) from a preset.
  function buildHumanoidHead(presetKey, cfg) {
    if (typeof THREE === "undefined") return null;
    const preset = HUMANOID_HEAD_MAP[presetKey] || HUMANOID_HEAD_MAP.human;
    const col = skinColor(cfg);
    const skin = () => new THREE.MeshStandardMaterial({ color: col.clone(), roughness: 0.85 });
    const g = new THREE.Group();
    const sh = preset.shape || [1, 1, 1];
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), skin());
    head.scale.set(sh[0], sh[1], sh[2]); g.add(head);

    if (preset.brow) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.14), skin());
      brow.material.color.multiplyScalar(0.78); brow.position.set(0, 0.15, 0.27); g.add(brow);
    }
    if (preset.snout) {
      const sn = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin());
      sn.scale.set(0.85, 0.7, 1.15); sn.position.set(0, -0.08, 0.28); g.add(sn);
    }
    if (preset.jaw) {
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.42), skin());
      jaw.position.set(0, -0.27, 0.04); g.add(jaw);
    }

    // Ears
    const ear = preset.ear || "round";
    if (ear === "pointed" || ear === "long") {
      const len = ear === "long" ? 0.6 : 0.4, rad = ear === "long" ? 0.07 : 0.1;
      const tilt = ear === "long" ? 0.5 : 0.2, back = ear === "long" ? -0.05 : 0, pitch = ear === "long" ? -0.3 : 0;
      const geo = new THREE.ConeGeometry(rad, len, 4);
      const le = new THREE.Mesh(geo, skin()); le.position.set(-0.34, 0.1, back); le.rotation.z = Math.PI / 2 + tilt; le.rotation.x = pitch; g.add(le);
      const re = new THREE.Mesh(geo, skin()); re.position.set(0.34, 0.1, back); re.rotation.z = -Math.PI / 2 - tilt; re.rotation.x = pitch; g.add(re);
    } else if (ear !== "none") {
      const r = ear === "big" ? 0.16 : 0.12;
      const geo = new THREE.SphereGeometry(r, 8, 8);
      const le = new THREE.Mesh(geo, skin()); le.position.set(-0.33, 0.06, 0.02); le.scale.set(0.5, 1.0, 0.7); g.add(le);
      const re = new THREE.Mesh(geo, skin()); re.position.set(0.33, 0.06, 0.02); re.scale.set(0.5, 1.0, 0.7); g.add(re);
    }

    // Nose
    const noseScale = preset.nose != null ? preset.nose : 0.9;
    if (noseScale > 0) {
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), skin());
      nose.position.set(0, 0, 0.35 * sh[2]); nose.rotation.x = Math.PI / 2; nose.scale.setScalar(noseScale); g.add(nose);
    }

    // Eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffff00, roughness: 0.2 });
    const pupMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const eyeR = preset.eyeBig ? 0.08 : 0.06;
    const mkEye = (x) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 8, 8), eyeMat); e.position.set(x, 0.08, 0.3 * sh[2]);
      const p = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.5, 8, 8), pupMat); p.position.set(0, 0, 0.04); e.add(p);
      g.add(e);
    };
    if (preset.oneEye) mkEye(0); else { mkEye(-0.15); mkEye(0.15); }

    // Mouth
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.025, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    mouth.position.set(0, -0.15, 0.33 * sh[2]); mouth.rotation.x = Math.PI / 2; g.add(mouth);

    // Fangs / tusks
    const fangs = preset.fangs || 0;
    if (fangs > 0) {
      const fMat = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.5 });
      const big = fangs >= 2, fLen = big ? 0.22 : 0.1, fRad = big ? 0.045 : 0.025;
      const fGeo = new THREE.ConeGeometry(fRad, fLen, 5);
      for (const fx of [-0.1, 0.1]) {
        const f = new THREE.Mesh(fGeo, fMat);
        f.position.set(fx, -0.13 + fLen * 0.5, 0.31);
        if (big) { f.rotation.x = Math.PI; f.position.y = -0.06; }
        g.add(f);
      }
    }

    // Horns
    if (preset.horns) {
      const hMat = new THREE.MeshStandardMaterial({ color: 0xe8ddc4, roughness: 0.6 });
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), hMat);
        h.position.set(s * 0.22, 0.28, -0.02); h.rotation.z = s * 0.6; g.add(h);
      }
    }
    return g;
  }

  // Build a self-contained, centered, fitted Object3D for one archetype's part.
  // Resolves to null when the 3D system is unavailable or the donor fails.
  function buildDonorGraft(archetypeKey, slotDef, cfg) {
    const B = window.Battler3D;
    if (!B || !B.create) return Promise.resolve(null);
    let src = null;
    try { src = B.create(archetypeKey, 0, 0, fakeIdentity(cfg, slotDef.seed)); } catch (e) { src = null; }
    if (!src) return Promise.resolve(null);
    return Promise.resolve(src.load(null, 0, 0, 0)).then(() => {
      if (!src.model) return null;
      try { src.update(1 / 60); } catch (e) { /* pose is cosmetic */ }
      const res = resolveDonorPart(src, slotDef);
      const part = res.part;
      if (!part) return null;
      if (part.parent) part.parent.remove(part);
      if (!res.isWhole) { part.position.set(0, 0, 0); part.rotation.set(0, 0, 0); }
      const wrap = wrapAndFit(part, slotDef.fit);
      // The extracted part is now owned by `wrap`; free the donor's leftovers.
      if (src.model) disposeObject3D(src.model);
      return wrap;
    }).catch(() => null);
  }

  // Resolve a graft Object3D for a slot value (head preset or donor archetype).
  function buildSlotGraft(slotName, value, cfg) {
    const def = PART_SLOTS[slotName];
    if (slotName === "head" && isHeadPreset(value)) {
      const head = buildHumanoidHead(value.slice(HHEAD_PREFIX.length), cfg);
      return Promise.resolve(head ? wrapAndFit(head, def.fit) : null);
    }
    return buildDonorGraft(value, def, cfg);
  }

  // Resolve the host mesh a slot should graft onto, plus any extra distal
  // meshes to hide alongside it. Humanoid hosts use PART_SLOTS' hardcoded rig
  // properties (their `hideMeshes` covers segments like forearm/hand that are
  // siblings, not children, of the anchor in that rig). A non-humanoid
  // structure host instead looks up its own matched _partMeshMap key (the same
  // compatibility data used to filter donor options), and derives "what else
  // to hide" from that family's own `_cascadeRules` -- the dismemberment rule
  // whose `gone` list includes our matched key already encodes "what
  // disappears alongside this part" per-family, which is exactly what a graft
  // should visually replace. Returns null when the host has no real part here.
  function resolveHostAnchor(hostBattler, baseKey, slotName) {
    const def = PART_SLOTS[slotName];
    if (isHumanoidBase(baseKey)) {
      const anchor = def.anchor(hostBattler);
      if (!anchor) return null;
      return { anchor: anchor, hideMeshes: def.hideMeshes(hostBattler) };
    }
    const key = matchedDonorKeyForSlot(baseKey, slotName);
    if (!key) return null;
    const map = hostBattler._partMeshMap || {};
    const anchor = map[key];
    if (!anchor) return null;
    const rules = hostBattler._cascadeRules || [];
    const rule = rules.find((r) => r.gone && r.gone.indexOf(key) !== -1);
    const hideMeshes = rule ? (rule.hide || []).filter((m) => m && m !== anchor) : [];
    return { anchor: anchor, hideMeshes: hideMeshes };
  }

  // Graft a donor part onto a slot of a loaded host battler (humanoid rig or
  // non-humanoid creature structure).
  function graftSlot(hostBattler, slotName, archetypeKey, cfg) {
    const def = PART_SLOTS[slotName];
    if (!def) return Promise.resolve();
    const resolved = resolveHostAnchor(hostBattler, cfg.base, slotName);
    if (!resolved) return Promise.resolve();
    const anchor = resolved.anchor;
    return buildSlotGraft(slotName, archetypeKey, cfg).then((wrap) => {
      if (!wrap) return;
      // Mute the anchor's own visual (keeps it as the FK/parent carrier) and
      // hide any pre-existing child meshes (eyes / gear) before the graft is
      // parented.
      if (anchor.material) { anchor.material.visible = false; }
      anchor.children.slice().forEach((c) =>
        c.traverse((o) => { if (o.isMesh) o.visible = false; }));
      resolved.hideMeshes.forEach((m) => { if (m) m.visible = false; });
      anchor.add(wrap);
      hostBattler._ccGrafts = hostBattler._ccGrafts || {};
      hostBattler._ccGrafts[slotName] = wrap;
    });
  }

  // Build a non-humanoid "skeleton structure" whole from its archetype, with a
  // seed-driven look (the Variation seed rerolls proportions/textures/colours
  // exactly like the creature preview reseed).
  function buildCreatureStructure(cfg) {
    const B = window.Battler3D;
    if (!B || !B.create) return Promise.resolve(null);
    const seedStr = "cc" + (((cfg.seed | 0)) || 1);
    const make = () => B.create(cfg.base, undefined, 0, fakeIdentity(cfg, 0));
    let battler = null;
    try { battler = withGenSeed(seedStr, make); } catch (e) { battler = null; }
    if (!battler) return Promise.resolve(null);
    return Promise.resolve(battler.load(null, 0, 0, 0)).then(() => battler).catch(() => null);
  }

  // Graft every non-default slot onto a loaded host battler, in order.
  // Sequential so the shared resources settle; there are at most six.
  function graftAllSlots(battler, cfg) {
    let chain = Promise.resolve();
    SLOT_NAMES.forEach((slot) => {
      const key = cfg.parts[slot];
      if (key && key !== "default") {
        chain = chain.then(() => graftSlot(battler, slot, key, cfg));
      }
    });
    return chain;
  }

  // Build a loaded model for a config. Humanoid bases use the part-swappable
  // biped rig; a non-humanoid base builds its whole structure first and then
  // grafts onto whichever slots that structure itself has a real part for
  // (see hostSupportedSlots/resolveHostAnchor) -- so a creature host can be a
  // chimera too, not just a donor.
  function buildModel(cfg, actorId) {
    if (!isAvailable()) return Promise.resolve(null);
    cfg = normalizeConfig(cfg);
    if (!isHumanoidBase(cfg.base)) {
      return buildCreatureStructure(cfg).then((battler) => {
        if (!battler) return null;
        return graftAllSlots(battler, cfg).then(() => battler);
      });
    }
    const prof = assembleProfile(cfg);
    const battler = window.Battler3D.createCustomHumanoid(prof, prof.scale, 0, fakeIdentity(cfg, 0), 0);
    if (!battler) return Promise.resolve(null);
    return Promise.resolve(battler.load(null, 0, 0, 0)).then(() => graftAllSlots(battler, cfg).then(() => battler));
  }

  function withGenSeed(seed, fn) {
    const B = window.Battler3D;
    if (!seed || !B || !B.setGenSeed || !B.getGenSeed) return fn();
    const prev = B.getGenSeed();
    B.setGenSeed(seed);
    try { return fn(); } finally { B.setGenSeed(prev); }
  }

  window.CC3DModel = {
    isAvailable, defaultConfig, normalizeConfig, getConfig, setConfig,
    getCreatureSeed, setCreatureSeed, bodyOptions, partOptions, optionsForSlot,
    allArchetypes, displayName, buildModel, withGenSeed, suggestBaseFromName,
    configFromArchetypes, isHumanoidBase, structureOptions, SLOT_NAMES,
    isSlotCompatible, compatibleArchetypesForSlot
  };

  //===========================================================================
  // randomConfig
  //===========================================================================

  function randomConfig() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const range = (min, max, step) => {
      const n = Math.floor((max - min) / step) + 1;
      return min + Math.floor(Math.random() * n) * step;
    };
    const r2 = (v) => Math.round(v * 100) / 100;
    const headPresets = HUMANOID_HEADS.map((h) => HHEAD_PREFIX + h.key);
    const rollFromPool = (pool) => (pool.length && Math.random() < 0.28) ? pick(pool) : "default";
    const parts = {};
    // Arms and legs are rolled once per pair (left/right) so a randomized
    // figure never ends up with mismatched limbs. Every roll draws only from
    // slot-compatible archetypes so a random figure never silently grafts a
    // donor's whole shrunken model onto a slot it has no real part for.
    let armPick = null;
    let legPick = null;
    SLOT_NAMES.forEach((slot) => {
      // A minority of slots get a wild donor; the rest stay default so the
      // random figure still reads as a coherent body most of the time. The
      // head favours the curated humanoid presets over raw creature heads.
      if (slot === "head" && Math.random() < 0.55) {
        parts[slot] = pick(headPresets);
      } else if (slot === "armL" || slot === "armR") {
        if (armPick === null) armPick = rollFromPool(compatibleArchetypesForSlot("armL"));
        parts[slot] = armPick;
      } else if (slot === "legL" || slot === "legR") {
        if (legPick === null) legPick = rollFromPool(compatibleArchetypesForSlot("legL"));
        parts[slot] = legPick;
      } else {
        parts[slot] = rollFromPool(compatibleArchetypesForSlot(slot));
      }
    });
    return {
      base: pick(bodyOptions()),
      parts,
      seed: 1 + Math.floor(Math.random() * 99998),
      height: r2(range(0.75, 1.35, 0.05)),
      bulk: r2(range(0.75, 1.35, 0.05)),
      headSize: r2(range(0.8, 1.4, 0.05)),
      ears: r2(range(0, 1.8, 0.1)),
      nose: r2(range(0, 1.8, 0.1)),
      hue: r2(range(0, 0.96, 0.04)),
      sat: r2(range(0.1, 0.9, 0.05)),
      lit: r2(range(0.25, 0.8, 0.05)),
      texturePool: pick(TEXTURE_POOL_KEYS),
      hairStyle: pick(hairStyleKeys().filter((s) => s !== "helmet")),
      // Natural colours most of the time, the exotic tail of the palette rarely.
      hairColor: (() => {
        const keys = hairColorKeys();
        const H = hairLib();
        const nat = (H && H.NATURAL_COLORS) || keys.length;
        return Math.random() < 0.12 ? pick(keys) : pick(keys.slice(0, nat));
      })(),
      fangs: Math.random() < 0.25 ? (Math.random() < 0.5 ? 1 : 2) : 0,
      horns: Math.random() < 0.2 ? (Math.random() < 0.5 ? 1 : 2) : 0,
      tail: Math.random() < 0.15 ? 1 : 0,
      wings: Math.random() < 0.12 ? 1 : 0,
      halo: Math.random() < 0.08 ? 1 : 0
    };
  }

  //===========================================================================
  // Scene_CC3DModel
  //===========================================================================

  function Scene_CC3DModel() {
    this.initialize(...arguments);
  }

  Scene_CC3DModel.prototype = Object.create(Scene_MenuBase.prototype);
  Scene_CC3DModel.prototype.constructor = Scene_CC3DModel;

  // options: { suggestedBase, initArchetypes:[key,...], creature:true,
  //            returnByPop:true }.
  // returnByPop is for callers that PUSHED this scene over their own (the
  // sprite grid does): Back pops once, landing on the caller again, instead of
  // gotoing a fresh instance of a return scene.
  // A bare string is accepted as suggestedBase for backward compatibility.
  Scene_CC3DModel.setup = function (actorId, returnSceneClass, options) {
    Scene_CC3DModel._actorId = actorId || 1;
    Scene_CC3DModel._returnSceneClass = returnSceneClass || null;
    if (typeof options === "string") options = { suggestedBase: options };
    options = options || {};
    Scene_CC3DModel._returnByPop = !!options.returnByPop;
    // How many scenes Confirm pops in humanoid mode. The sprite-grid route
    // needs two (itself plus the grid, landing back on the map so the creation
    // common event resumes); a caller that pushed this editor straight over its
    // own scene, such as the Detailed creation editor, passes 1.
    Scene_CC3DModel._confirmPops = Number(options.confirmPops) > 0 ? Number(options.confirmPops) : 2;
    Scene_CC3DModel._suggestedBase = options.suggestedBase || null;
    Scene_CC3DModel._initArchetypes = options.initArchetypes || null;
    Scene_CC3DModel._creatureMode = !!options.creature;
    Scene_CC3DModel._creatureResult = null;
  };

  Scene_CC3DModel.prototype.initialize = function () {
    Scene_MenuBase.prototype.initialize.call(this);
    this._actorId = Scene_CC3DModel._actorId || 1;
    this._creatureMode = !!Scene_CC3DModel._creatureMode;
    const saved = getConfig(this._actorId);
    this._config = normalizeConfig(saved || {});
    // First visit for this actor: seed the starting config from context. A
    // custom creature initialises from the chosen creature archetype(s); a
    // humanoid from the bust/sprite archetype detected in the previous step.
    if (!saved) {
      if (Scene_CC3DModel._initArchetypes && Scene_CC3DModel._initArchetypes.length) {
        this._config = normalizeConfig(configFromArchetypes(Scene_CC3DModel._initArchetypes));
      } else if (Scene_CC3DModel._suggestedBase && bodyOptions().indexOf(Scene_CC3DModel._suggestedBase) !== -1) {
        this._config.base = Scene_CC3DModel._suggestedBase;
      }
    }
    this._rows = this._buildRows();
    this._focusIndex = 0;
    this._view3D = null;
    this._buildCounter = 0;
    this._rebuildTimer = null;
    this._modal = null;            // open grid picker state
    this._sliderDrag = null;       // active slider drag state
  };

  // Row descriptors.
  //   picker  -> opens a grid dropdown (kind body/part/surface/hairstyle/haircolor)
  //   slider  -> drag control over [min,max] step
  //   segment -> discrete chips (fangs/horns/tail/wings/halo)
  //   seed    -> reroll button + number
  //   button  -> action row
  Scene_CC3DModel.prototype._buildRows = function () {
    const rows = [];
    // Randomize is kept at the very top so it is immediately reachable
    // without scrolling past the body/part pickers and sliders.
    rows.push({ type: "button", action: "randomize", label: T('CharCreate.randomizeAll') });
    // Creature mode offers the full non-humanoid structure roster; humanoid
    // party members are restricted to the biped body presets.
    if (this._creatureMode) {
      rows.push({ type: "picker", kind: "structure", key: "base", label: T('CharCreate.structure') });
    } else {
      rows.push({ type: "picker", kind: "body", key: "base", label: T('CharCreate.body') });
    }
    // A non-humanoid structure is built whole from its archetype: the biped-only
    // sliders/segments (height/build/ears/fangs/...) don't apply to it, but it
    // can still be grafted onto -- show a part-picker row for each slot the
    // CHOSEN STRUCTURE itself has a real matching mesh for (a legless serpent
    // offers no Arm rows at all, a spider's front legs cover both its Arm and
    // Leg donorKeys so only the Leg rows are shown, etc -- hostSupportedSlots
    // dedupes collisions onto the same physical mesh).
    if (this._creatureMode && !isHumanoidBase(this._config.base)) {
      hostSupportedSlots(this._config.base).forEach((slot) => {
        rows.push({ type: "picker", kind: "part", slot: slot, label: PART_SLOTS[slot].label() });
      });
      rows.push({ type: "seed", key: "seed", label: T('CharCreate.variation') });
      rows.push({ type: "button", action: "confirm", label: T('CharCreate.continue') });
      return rows;
    }
    SLOT_NAMES.forEach((slot) => {
      rows.push({ type: "picker", kind: "part", slot: slot, label: PART_SLOTS[slot].label() });
    });
    rows.push({ type: "picker", kind: "surface", key: "texturePool", label: T('CharCreate.surface') });
    rows.push({ type: "slider", key: "height", label: T('CharCreate.height'), min: 0.7, max: 1.4, step: 0.05, unit: "height" });
    rows.push({ type: "slider", key: "bulk", label: T('CharCreate.weight'), min: 0.7, max: 1.4, step: 0.05, unit: "weight" });
    rows.push({ type: "slider", key: "headSize", label: T('CharCreate.headSize'), min: 0.7, max: 1.5, step: 0.05 });
    rows.push({ type: "slider", key: "ears", label: T('CharCreate.ears'), min: 0, max: 2, step: 0.1 });
    rows.push({ type: "slider", key: "nose", label: T('CharCreate.nose'), min: 0, max: 2, step: 0.1 });
    rows.push({ type: "slider", key: "hue", label: T('CharCreate.skinHue'), min: 0, max: 0.96, step: 0.02, swatch: true });
    rows.push({ type: "slider", key: "sat", label: T('CharCreate.saturation'), min: 0, max: 1, step: 0.05 });
    rows.push({ type: "slider", key: "lit", label: T('CharCreate.lightness'), min: 0.15, max: 0.85, step: 0.05 });
    if (hairApplies(this._config)) {
      rows.push({ type: "picker", kind: "hairstyle", key: "hairStyle", label: T('CharCreate.hair') });
      rows.push({ type: "picker", kind: "haircolor", key: "hairColor", label: T('CharCreate.hairColour') });
    }
    rows.push({ type: "segment", key: "fangs", label: T('CharCreate.fangs'), states: [0, 1, 2], stateLabels: [T('CharCreate.none3'), T('CharCreate.small'), T('CharCreate.large')] });
    rows.push({ type: "segment", key: "horns", label: T('CharCreate.horns'), states: [0, 1, 2], stateLabels: [T('CharCreate.none3'), T('CharCreate.small'), T('CharCreate.large')] });
    rows.push({ type: "segment", key: "tail", label: T('CharCreate.tail'), states: [0, 1], stateLabels: [T('CharCreate.no'), T('CharCreate.yes')] });
    rows.push({ type: "segment", key: "wings", label: T('CharCreate.wings'), states: [0, 1], stateLabels: [T('CharCreate.no'), T('CharCreate.yes')] });
    rows.push({ type: "segment", key: "halo", label: T('CharCreate.halo'), states: [0, 1], stateLabels: [T('CharCreate.no'), T('CharCreate.yes')] });
    rows.push({ type: "seed", key: "seed", label: T('CharCreate.variation') });
    rows.push({ type: "button", action: "confirm", label: T('CharCreate.continue') });
    return rows;
  };

  Scene_CC3DModel.prototype.create = function () {
    Scene_MenuBase.prototype.create.call(this);
    this.createUIOverlay();
    this.init3DView();
    this.rebuildModel();
  };

  Scene_CC3DModel.prototype.terminate = function () {
    Scene_MenuBase.prototype.terminate.call(this);
    if (this._rebuildTimer) { clearTimeout(this._rebuildTimer); this._rebuildTimer = null; }
    this._endSliderDrag();
    this.closeModal();
    this.cleanup3DView();
    if (this._dndContainer) this._dndContainer.style.display = "none";
    const st = document.getElementById("cc3d-styles");
    if (st) st.remove();
  };

  //---------------------------------------------------------------------------
  // Value get/set (supports the part slots as first-class values)
  //---------------------------------------------------------------------------

  Scene_CC3DModel.prototype._rowValue = function (row) {
    if (row.type === "picker" && row.kind === "part") return this._config.parts[row.slot];
    return this._config[row.key];
  };
  Scene_CC3DModel.prototype._setRowValue = function (row, val) {
    if (row.type === "picker" && row.kind === "part") this._config.parts[row.slot] = val;
    else this._config[row.key] = val;
  };

  //---------------------------------------------------------------------------
  // DOM overlay
  //---------------------------------------------------------------------------

  Scene_CC3DModel.prototype.createUIOverlay = function () {
    let container = document.getElementById("character-creation-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "character-creation-container";
      document.body.appendChild(container);
    }
    this._dndContainer = container;
    container.style.transition = "none";
    container.style.display = "flex";
    container.style.opacity = "1";
    container.style.pointerEvents = "auto";

    // One-time loading-shimmer style for thumbnails still generating.
    if (!document.getElementById("cc3d-styles")) {
      const st = document.createElement("style");
      st.id = "cc3d-styles";
      st.textContent = `
        @keyframes cc3dPulse { 0%{opacity:0.35} 50%{opacity:0.7} 100%{opacity:0.35} }
        .cc3d-loading { animation: cc3dPulse 1.1s ease-in-out infinite; }
      `;
      document.head.appendChild(st);
    }

    const rowsHtml = this._rows.map((row, i) => this._rowHtml(row, i)).join("");
    container.innerHTML = `
      <div class="cc-pockets-spread">
        <div class="cc-page cc-page-left" style="display:flex">
          <h2 class="cc-header-gothic">${T('CharCreate.3dModel')}</h2>
          <p class="cc-text-desc">${T('CharCreate.mixPartsFromAnyCreatureDragToRotateWheelToZo')}</p>
          <canvas id="cc3d-canvas" style="flex:1; width:100%; min-height:420px; display:block; cursor:grab; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.4))"></canvas>
        </div>
        <div class="cc-page cc-page-right" style="display:flex">
          <h2 class="cc-header-gothic">${T('CharCreate.customize')}</h2>
          <div id="cc3d-rows" class="pockets-scroll" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:8px">
            ${rowsHtml}
          </div>
          ${window.CCButtons.panel({
            back: window.CCButtons.button(window.CCButtons.backLabel(), {
              onclick: "SceneManager._scene.onBack()",
            }),
            // No Random in the middle slot here: the row list already opens with
            // a keyboard-reachable "Randomize all" entry (see _buildRows).
            next: window.CCButtons.button(window.CCButtons.continueLabel(), {
              onclick: "SceneManager._scene.onConfirm()",
              confirm: true,
            }),
            style: "margin-top:12px;",
          })}
        </div>
      </div>
      <div id="cc3d-modal" style="display:none"></div>
    `;
    // Wheel + L2/R2 scrolling for the row list (and the picker modal's grid,
    // which claims its own wheel events). See CCScroll.
    if (window.CCScroll) window.CCScroll.bindWheel(container);

    this._bindSliderPointer();
    this._refreshRowFocus();
  };

  Scene_CC3DModel.prototype._rowHtml = function (row, i) {
    if (row.type === "button") {
      return `<div class="option-row" id="cc3d-row-${i}" onclick="SceneManager._scene.onRowActivate(${i})" style="justify-content:center">
          <span class="option-name">${row.label}</span></div>`;
    }
    if (row.type === "seed") {
      return `<div class="option-row" id="cc3d-row-${i}" onclick="SceneManager._scene.focusRow(${i})">
          <span class="option-name">${row.label}</span>
          <span class="option-select">
            <span class="option-select-val" id="cc3d-val-${i}">#${this._config.seed}</span>
            <span class="cc3d-reroll" onclick="event.stopPropagation(); SceneManager._scene.rerollSeed()" style="cursor:pointer; padding:2px 10px; border:1px solid var(--text-primary-hover); font-weight:bold">&#x21bb;</span>
          </span></div>`;
    }
    if (row.type === "segment") {
      return `<div class="option-row" id="cc3d-row-${i}" onclick="SceneManager._scene.focusRow(${i})">
          <span class="option-name">${row.label}</span>
          <span class="option-select" id="cc3d-seg-${i}">${this._segmentHtml(row, i)}</span></div>`;
    }
    if (row.type === "slider") {
      return `<div class="option-row option-row--slider" id="cc3d-row-${i}" onclick="SceneManager._scene.focusRow(${i})">
          <div class="option-row-head">
            <span class="option-name">${row.label}</span>
            <span class="option-value" id="cc3d-val-${i}">${this._sliderLabel(row)}</span>
          </div>
          <div class="option-slider-bar" data-row="${i}" id="cc3d-slider-${i}">
            <div class="option-slider-fill" id="cc3d-fill-${i}" style="width:${this._sliderPct(row)}%"></div>
          </div></div>`;
    }
    // picker
    return `<div class="option-row" id="cc3d-row-${i}" onclick="SceneManager._scene.openPicker(${i})">
        <span class="option-name">${row.label}</span>
        <span class="option-select">
          <span id="cc3d-thumb-${i}">${this._pickerPreviewHtml(row)}</span>
          <span class="option-select-val" id="cc3d-val-${i}" style="min-width:96px">${this._pickerValueLabel(row)}</span>
        </span></div>`;
  };

  Scene_CC3DModel.prototype._segmentHtml = function (row, i) {
    const cur = this._config[row.key];
    return row.states.map((st, k) => {
      const on = st === cur;
      return `<span onclick="event.stopPropagation(); SceneManager._scene.setSegment(${i}, ${st})" style="cursor:pointer; padding:2px 9px; margin-left:4px; font-size:1.234rem; border:1px solid ${on ?"var(--text-primary-hover)" : "var(--border-primary-hover-translucent-15)"}; color:${on ? "var(--text-primary-hover)" : "var(--text-muted-hover)"}; background:${on ? "var(--border-primary-hover-translucent-15)" : "transparent"};">${row.stateLabels[k]}</span>`;
    }).join("");
  };

  // Real-world baselines the height/weight multipliers are displayed against.
  const HEIGHT_BASE_M = 1.7;
  const WEIGHT_BASE_KG = 70;

  Scene_CC3DModel.prototype._sliderLabel = function (row) {
    const v = this._config[row.key];
    if (row.swatch) {
      const c = `hsl(${Math.round(v * 360)}, ${Math.round((this._config.sat || 0.45) * 100)}%, ${Math.round((this._config.lit || 0.6) * 100)}%)`;
      return `<span style="display:inline-block; width:14px; height:14px; border-radius:3px; vertical-align:middle; margin-right:6px; border:1px solid rgba(0,0,0,0.35); background:${c}"></span>${Math.round(v * 360)}°`;
    }
    if (row.unit === "height") {
      const totalCm = Math.round(HEIGHT_BASE_M * v * 100);
      return T('CharCreate.heightMetres', { m: Math.floor(totalCm / 100), cm: totalCm % 100 });
    }
    if (row.unit === "weight") {
      return Math.round(WEIGHT_BASE_KG * v) + "kg";
    }
    return Math.round(v * 100) + "%";
  };
  Scene_CC3DModel.prototype._sliderPct = function (row) {
    const v = this._config[row.key];
    return Math.max(0, Math.min(100, ((v - row.min) / (row.max - row.min)) * 100));
  };

  Scene_CC3DModel.prototype._pickerValueLabel = function (row) {
    if (row.kind === "surface") return displayName(this._config.texturePool);
    if (row.kind === "hairstyle" || row.kind === "haircolor") return hairLabel(row.kind, this._rowValue(row));
    return displayName(this._rowValue(row));
  };
  Scene_CC3DModel.prototype._pickerPreviewHtml = function (row) {
    if (row.kind === "haircolor") {
      return `<span style="display:inline-block; width:20px; height:20px; border-radius:50%; vertical-align:middle; background:${hairSwatchCss(this._config.hairColor)}; border:1px solid rgba(0,0,0,0.35)"></span>`;
    }
    if (row.kind === "surface") {
      const colors = { flesh: "#c78b6a", green: "#5a7a3a", bone: "#e6e0cf", metal: "#8a8f98", stone: "#7a726a" };
      const c = colors[this._config.texturePool] || "#888";
      return `<span style="display:inline-block; width:20px; height:20px; border-radius:4px; vertical-align:middle; background:${c}; border:1px solid rgba(0,0,0,0.35)"></span>`;
    }
    const val = this._rowValue(row);
    if (val === "default") {
      return `<span style="display:inline-flex; width:20px; height:20px; border-radius:4px; vertical-align:middle; align-items:center; justify-content:center; background:var(--bg-card-translucent-5); border:1px dashed var(--border-primary-hover-translucent-15); font-size:1.081rem">&#9642;</span>`;
    }
    // Text-only picker: the value label carries the selection, no thumbnail.
    return "";
  };

  Scene_CC3DModel.prototype._refreshRow = function (i) {
    const row = this._rows[i];
    if (!row) return;
    if (row.type === "slider") {
      const val = document.getElementById("cc3d-val-" + i);
      const fill = document.getElementById("cc3d-fill-" + i);
      if (val) val.innerHTML = this._sliderLabel(row);
      if (fill) fill.style.width = this._sliderPct(row) + "%";
    } else if (row.type === "segment") {
      const seg = document.getElementById("cc3d-seg-" + i);
      if (seg) seg.innerHTML = this._segmentHtml(row, i);
    } else if (row.type === "seed") {
      const val = document.getElementById("cc3d-val-" + i);
      if (val) val.textContent = "#" + this._config.seed;
    } else if (row.type === "picker") {
      const val = document.getElementById("cc3d-val-" + i);
      const thumb = document.getElementById("cc3d-thumb-" + i);
      if (val) val.textContent = this._pickerValueLabel(row);
      if (thumb) thumb.innerHTML = this._pickerPreviewHtml(row);
    }
  };

  Scene_CC3DModel.prototype._refreshRowFocus = function () {
    this._rows.forEach((_, i) => {
      const el = document.getElementById("cc3d-row-" + i);
      if (el) el.classList.toggle("active", i === this._focusIndex && !this._modal);
    });
    if (!this._modal) {
      const focused = document.getElementById("cc3d-row-" + this._focusIndex);
      if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: "nearest" });
    }
  };

  //---------------------------------------------------------------------------
  // Row interaction
  //---------------------------------------------------------------------------

  Scene_CC3DModel.prototype.focusRow = function (i) {
    if (i === this._focusIndex) return;
    this._focusIndex = i;
    SoundManager.playCursor();
    this._refreshRowFocus();
  };

  Scene_CC3DModel.prototype.onRowActivate = function (i) {
    const row = this._rows[i];
    if (!row) return;
    this._focusIndex = i;
    this._refreshRowFocus();
    if (row.type === "button") {
      if (row.action === "confirm") this.onConfirm();
      else if (row.action === "randomize") this.onRandomize();
    } else if (row.type === "picker") {
      this.openPicker(i);
    } else if (row.type === "seed") {
      this.rerollSeed();
    } else if (row.type === "segment") {
      this.cycleSegment(i, 1);
    }
  };

  Scene_CC3DModel.prototype.cycleSegment = function (i, dir) {
    const row = this._rows[i];
    if (!row || row.type !== "segment") return;
    let idx = row.states.indexOf(this._config[row.key]);
    if (idx < 0) idx = 0;
    idx = (idx + dir + row.states.length) % row.states.length;
    this._config[row.key] = row.states[idx];
    SoundManager.playCursor();
    this._refreshRow(i);
    this.scheduleRebuild();
  };
  Scene_CC3DModel.prototype.setSegment = function (i, state) {
    const row = this._rows[i];
    if (!row || row.type !== "segment") return;
    this._focusIndex = i;
    this._config[row.key] = state;
    SoundManager.playCursor();
    this._refreshRow(i);
    this._refreshRowFocus();
    this.scheduleRebuild();
  };

  Scene_CC3DModel.prototype.rerollSeed = function () {
    this._config.seed = 1 + Math.floor(Math.random() * 99998);
    SoundManager.playOk();
    this._rows.forEach((r, i) => { if (r.type === "seed") this._refreshRow(i); });
    this.scheduleRebuild();
  };

  Scene_CC3DModel.prototype.onRandomize = function () {
    const wasHumanoid = isHumanoidBase(this._config.base);
    const wasHair = hairApplies(this._config);
    // On a non-humanoid creature structure, randomize just rerolls a fresh
    // structure + variation rather than jumping back to a biped body.
    if (this._creatureMode && !wasHumanoid) {
      const opts = structureOptions();
      this._config.base = opts[Math.floor(Math.random() * opts.length)];
      this._config.seed = 1 + Math.floor(Math.random() * 99998);
    } else {
      this._config = normalizeConfig(randomConfig());
    }
    SoundManager.playOk();
    const nowHumanoid = isHumanoidBase(this._config.base);
    // A freshly-rolled non-humanoid structure can support a different set of
    // slots than the previous one (hostSupportedSlots), so always rebuild rows
    // for that case too, not just when humanoid-ness itself toggles.
    if (nowHumanoid !== wasHumanoid || (this._creatureMode && !nowHumanoid)
        || hairApplies(this._config) !== wasHair) {
      this._rebuildRows();
    } else {
      this._rows.forEach((_, i) => this._refreshRow(i));
    }
    this.scheduleRebuild();
  };

  Scene_CC3DModel.prototype.onConfirm = function () {
    setConfig(this._actorId, this._config);
    SoundManager.playOk();
    // Creature mode was PUSHED over the creature scene: pop once back to it and
    // let it resume the flow. Humanoid mode mirrors the bust selector's exit
    // (double pop to the map so the creation common event resumes).
    if (this._creatureMode) { Scene_CC3DModel._creatureResult = "confirm"; SceneManager.pop(); return; }
    const pops = Scene_CC3DModel._confirmPops || 2;
    for (let i = 0; i < pops; i++) SceneManager.pop();
  };

  Scene_CC3DModel.prototype.onBack = function () {
    SoundManager.playCancel();
    if (this._creatureMode) { Scene_CC3DModel._creatureResult = "cancel"; SceneManager.pop(); return; }
    // Pushed over the caller: one pop returns to it with its own state intact.
    if (Scene_CC3DModel._returnByPop) { SceneManager.pop(); return; }
    const ret = Scene_CC3DModel._returnSceneClass;
    if (ret) SceneManager.goto(ret);
    else { SceneManager.pop(); SceneManager.pop(); }
  };

  //---------------------------------------------------------------------------
  // Slider drag
  //---------------------------------------------------------------------------

  Scene_CC3DModel.prototype._bindSliderPointer = function () {
    const container = this._dndContainer;
    if (!container) return;
    this._onSliderDown = (e) => {
      const bar = e.target.closest && e.target.closest(".option-slider-bar");
      if (!bar || !container.contains(bar)) return;
      const i = parseInt(bar.getAttribute("data-row"), 10);
      if (isNaN(i)) return;
      this._sliderDrag = { i: i, bar: bar };
      this._focusIndex = i;
      this._refreshRowFocus();
      this._applySliderFromEvent(e);
      e.preventDefault();
    };
    this._onSliderMove = (e) => { if (this._sliderDrag) this._applySliderFromEvent(e); };
    this._onSliderUp = () => this._endSliderDrag();
    container.addEventListener("mousedown", this._onSliderDown);
    window.addEventListener("mousemove", this._onSliderMove);
    window.addEventListener("mouseup", this._onSliderUp);
  };
  Scene_CC3DModel.prototype._applySliderFromEvent = function (e) {
    const d = this._sliderDrag;
    if (!d) return;
    const row = this._rows[d.i];
    const rect = d.bar.getBoundingClientRect();
    let t = (e.clientX - rect.left) / (rect.width || 1);
    t = Math.max(0, Math.min(1, t));
    let v = row.min + t * (row.max - row.min);
    v = Math.round(v / row.step) * row.step;
    v = Math.round(v * 1000) / 1000;
    if (v !== this._config[row.key]) {
      this._config[row.key] = v;
      this._refreshRow(d.i);
      // Hue/sat/lit share the swatch preview on the hue row.
      if (["sat", "lit"].includes(row.key)) {
        const hueIdx = this._rows.findIndex((r) => r.key === "hue");
        if (hueIdx >= 0) this._refreshRow(hueIdx);
      }
      this.scheduleRebuild();
    }
  };
  Scene_CC3DModel.prototype._endSliderDrag = function () {
    // Listeners stay bound for the scene's lifetime (removed in cleanup3DView);
    // they no-op while no drag is active.
    this._sliderDrag = null;
  };
  Scene_CC3DModel.prototype._stepSlider = function (i, dir) {
    const row = this._rows[i];
    if (!row || row.type !== "slider") return;
    let v = this._config[row.key] + dir * row.step;
    v = Math.max(row.min, Math.min(row.max, v));
    v = Math.round(v * 1000) / 1000;
    this._config[row.key] = v;
    SoundManager.playCursor();
    this._refreshRow(i);
    if (["sat", "lit"].includes(row.key)) {
      const hueIdx = this._rows.findIndex((r) => r.key === "hue");
      if (hueIdx >= 0) this._refreshRow(hueIdx);
    }
    this.scheduleRebuild();
  };

  //---------------------------------------------------------------------------
  // Grid picker modal
  //---------------------------------------------------------------------------

  Scene_CC3DModel.prototype.openPicker = function (i) {
    const row = this._rows[i];
    if (!row || row.type !== "picker") return;
    this._focusIndex = i;
    let options;
    if (row.kind === "body") options = bodyOptions();
    else if (row.kind === "structure") options = structureOptions();
    else if (row.kind === "surface") options = TEXTURE_POOL_KEYS;
    else if (row.kind === "hairstyle") options = hairStyleKeys();
    else if (row.kind === "haircolor") options = hairColorKeys();
    else options = optionsForSlot(row.slot);
    const current = row.kind === "surface" ? this._config.texturePool : this._rowValue(row);
    const cur = Math.max(0, options.indexOf(current));
    this._modal = { rowIndex: i, kind: row.kind, slot: row.slot || null, options, filtered: options, index: cur, filter: "", page: 48, shown: 0 };
    SoundManager.playOk();
    this._renderModal();
    this._refreshRowFocus();
  };

  Scene_CC3DModel.prototype.closeModal = function () {
    if (!this._modal) return;
    this._modal = null;
    const el = document.getElementById("cc3d-modal");
    if (el) { el.style.display = "none"; el.innerHTML = ""; }
    this._refreshRowFocus();
  };

  Scene_CC3DModel.prototype._modalTitle = function () {
    const row = this._rows[this._modal.rowIndex];
    return row ? row.label : "";
  };

  Scene_CC3DModel.prototype._renderModal = function () {
    const el = document.getElementById("cc3d-modal");
    if (!el) return;
    const m = this._modal;
    const searchable = m.kind === "part" || m.kind === "body" || m.kind === "structure";
    // "inset" is not honoured by the runtime (the overlay collapses onto the
    // top-left corner), so the longhands and an explicit size are used.
    el.style.cssText = "position:absolute; left:0; top:0; right:0; bottom:0; width:100%; height:100%; z-index:1200; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.55);";
    el.innerHTML = `
      <div style="width:78%; max-width:900px; height:82%; display:flex; flex-direction:column; background:var(--gradient-1); border:2px solid var(--border-primary-hover-translucent-15); border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,0.5); padding:16px 18px; box-sizing:border-box">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:12px">
          <h2 class="cc-header-gothic" style="margin:0; border:none; padding:0; font-size:2.064rem">${this._modalTitle()}</h2>
          ${searchable ? `<input id="cc3d-modal-search" type="text" placeholder="${T('CharCreate.search')}" value="${m.filter}" style="flex:0 0 220px; padding:6px 10px; border-radius:6px; border:1px solid var(--border-primary-hover-translucent-15); background:var(--bg-primary-hover-translucent-35); color:var(--text-primary-hover); font-family:'Lora',serif" />` : ``}
          <button class="cc-btn-treaty" onclick="SceneManager._scene.closeModal()">${T('CharCreate.close')}</button>
        </div>
        <div id="cc3d-grid" class="pockets-scroll" style="flex:1; overflow-y:auto; display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; padding-right:8px; align-content:start"></div>
      </div>`;
    el.style.display = "flex";
    const search = document.getElementById("cc3d-modal-search");
    if (search) {
      search.addEventListener("input", () => {
        m.filter = search.value.toLowerCase();
        const isHair = (m.kind === "hairstyle" || m.kind === "haircolor");
        m.filtered = m.options.filter((o) =>
          o === "default" ? "default".includes(m.filter)
            : ((isHair ? hairLabel(m.kind, o) : displayName(o)).toLowerCase().includes(m.filter) || o.includes(m.filter)));
        m.index = 0;
        this._renderModalGrid();
      });
      // Keep the search box from stealing arrow keys used for grid nav.
      search.addEventListener("keydown", (e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) search.blur();
      });
    }
    this._renderModalGrid();
  };

  // Grid columns must match the CSS grid-template so keyboard/controller row
  // moves land on the cell directly above/below.
  const MODAL_COLS = 4;

  // Render the grid as a growing WINDOW of cells (dynamic loading): only the
  // first page is built up front, more are appended on scroll or when the
  // selection moves past the rendered edge. This keeps the DOM light even for
  // the ~600-entry part rosters, so opening the picker never stalls the game.
  Scene_CC3DModel.prototype._renderModalGrid = function () {
    const grid = document.getElementById("cc3d-grid");
    if (!grid || !this._modal) return;
    const m = this._modal;
    m.page = m.page || 48;
    m.shown = 0;
    if (!m.filtered.length) {
      grid.innerHTML = `<div class="cc-text-desc" style="grid-column:1/-1">${T('CharCreate.noMatches')}</div>`;
      return;
    }
    grid.innerHTML = "";
    // Bind mousewheel + scroll infinite-load once per grid element. An explicit
    // wheel handler guarantees the list scrolls even though the overlay sits
    // above the 3D canvas.
    if (!grid._ccBound) {
      grid._ccBound = true;
      grid.addEventListener("scroll", () => this._onGridScroll());
      grid.addEventListener("wheel", (e) => {
        grid.scrollTop += e.deltaY;
        e.preventDefault();
        e.stopPropagation();
        this._onGridScroll();
      }, { passive: false });
    }
    this._growModalGrid();          // first page
    this._ensureShown(m.index);     // make sure the current selection is built
    this._highlightModalCell();
  };

  Scene_CC3DModel.prototype._growModalGrid = function () {
    const m = this._modal;
    const grid = document.getElementById("cc3d-grid");
    if (!m || !grid || m.shown >= m.filtered.length) return;
    const end = Math.min(m.filtered.length, m.shown + m.page);
    let html = "";
    for (let i = m.shown; i < end; i++) html += this._modalCellHtml(m.filtered[i], i);
    grid.insertAdjacentHTML("beforeend", html);
    m.shown = end;
  };

  Scene_CC3DModel.prototype._ensureShown = function (index) {
    const m = this._modal;
    if (!m) return;
    while (m.shown <= index && m.shown < m.filtered.length) this._growModalGrid();
  };

  Scene_CC3DModel.prototype._onGridScroll = function () {
    const m = this._modal;
    const grid = document.getElementById("cc3d-grid");
    if (!m || !grid) return;
    if (m.shown < m.filtered.length &&
        grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 260) {
      this._growModalGrid();
    }
  };

  Scene_CC3DModel.prototype._modalCellHtml = function (opt, idx) {
    const m = this._modal;
    const isHair = (m.kind === "hairstyle" || m.kind === "haircolor");
    const label = isHair ? hairLabel(m.kind, opt) : displayName(opt);
    let lead = "";
    if (m.kind === "surface") {
      const colors = { flesh: "#c78b6a", green: "#5a7a3a", bone: "#e6e0cf", metal: "#8a8f98", stone: "#7a726a" };
      lead = `<span style="display:inline-block; width:14px; height:14px; border-radius:3px; vertical-align:middle; margin-right:6px; background:${colors[opt] ||"#888"}; border:1px solid rgba(0,0,0,0.35);"></span>`;
    } else if (m.kind === "haircolor") {
      lead = `<span style="display:inline-block; width:14px; height:14px; border-radius:50%; vertical-align:middle; margin-right:6px; background:${hairSwatchCss(opt)}; border:1px solid rgba(0,0,0,0.35)"></span>`;
    } else if (opt === "default") {
      lead = `<span style="margin-right:6px; color:var(--text-muted-hover)">&#9642;</span>`;
    }
    return `<div class="cc-wanted-card cc3d-cell" data-idx="${idx}" data-val="${opt}"
        onclick="SceneManager._scene.pickModalOption(${idx})"
        style="display:flex; align-items:center; justify-content:center; text-align:center; min-height:42px; padding:8px 6px">
        <span style="font-size:1.17rem; line-height:1.15; word-break:break-word; color:var(--text-muted-hover)">${lead}${label}</span>
      </div>`;
  };

  Scene_CC3DModel.prototype._highlightModalCell = function () {
    const grid = document.getElementById("cc3d-grid");
    if (!grid || !this._modal) return;
    grid.querySelectorAll(".cc3d-cell").forEach((c) => {
      const idx = parseInt(c.getAttribute("data-idx"), 10);
      c.classList.toggle("selected", idx === this._modal.index);
    });
    const sel = grid.querySelector(".cc3d-cell.selected");
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
  };

  Scene_CC3DModel.prototype.pickModalOption = function (idx) {
    const m = this._modal;
    if (!m) return;
    const opt = m.filtered[idx];
    if (opt == null) return;
    const row = this._rows[m.rowIndex];
    if (m.kind === "surface") this._config.texturePool = opt;
    else this._setRowValue(row, opt);
    SoundManager.playOk();
    this.closeModal();
    // Switching the creature structure changes which controls apply (biped vs
    // whole non-humanoid rig) AND, for a non-humanoid structure, which slots it
    // has a real part for (hostSupportedSlots) -- always rebuild the row list.
    // The surface does the same on a smaller scale: a bone/metal/stone body has
    // no scalp, so the hair rows come and go with it.
    if (m.kind === "structure" || m.kind === "surface") {
      this._rebuildRows();
    } else {
      this._refreshRow(m.rowIndex);
    }
    this.scheduleRebuild();
  };

  // Regenerate the row descriptors + their DOM in place (used when the
  // structure toggles the humanoid/creature control set).
  Scene_CC3DModel.prototype._rebuildRows = function () {
    this._rows = this._buildRows();
    if (this._focusIndex >= this._rows.length) this._focusIndex = 0;
    const host = document.getElementById("cc3d-rows");
    if (host) host.innerHTML = this._rows.map((r, i) => this._rowHtml(r, i)).join("");
    this._refreshRowFocus();
  };

  Scene_CC3DModel.prototype._moveModal = function (dCol, dRow) {
    const m = this._modal;
    if (!m) return;
    let idx = m.index;
    if (dCol) idx += dCol;
    if (dRow) idx += dRow * MODAL_COLS;
    idx = Math.max(0, Math.min(m.filtered.length - 1, idx));
    if (idx !== m.index) {
      m.index = idx;
      this._ensureShown(idx);   // grow the window so the target cell exists
      SoundManager.playCursor();
      this._highlightModalCell();
    }
  };

  //---------------------------------------------------------------------------
  // Input (keyboard / gamepad)
  //---------------------------------------------------------------------------

  // CCScroll hook: the row list, or the picker grid while the modal is open.
  Scene_CC3DModel.prototype.ccScrollTarget = function () {
    return document.getElementById(this._modal ? "cc3d-grid" : "cc3d-rows");
  };

  Scene_CC3DModel.prototype.update = function () {
    Scene_MenuBase.prototype.update.call(this);
    if (window.CCScroll) window.CCScroll.update(this._dndContainer);
    if (this._modal) { this._updateModalInput(); return; }
    const n = this._rows.length;
    if (Input.isTriggered("cancel") || TouchInput.isCancelled()) { this.onBack(); return; }
    if (Input.isRepeated("down")) {
      this._focusIndex = (this._focusIndex + 1) % n; SoundManager.playCursor(); this._refreshRowFocus();
    } else if (Input.isRepeated("up")) {
      this._focusIndex = (this._focusIndex - 1 + n) % n; SoundManager.playCursor(); this._refreshRowFocus();
    } else if (Input.isRepeated("right")) {
      this._adjustFocused(1);
    } else if (Input.isRepeated("left")) {
      this._adjustFocused(-1);
    } else if (Input.isTriggered("ok")) {
      this.onRowActivate(this._focusIndex);
    } else if (Input.isTriggered("shift")) {
      this.onRandomize();
    }
  };

  Scene_CC3DModel.prototype._adjustFocused = function (dir) {
    const row = this._rows[this._focusIndex];
    if (!row) return;
    if (row.type === "slider") this._stepSlider(this._focusIndex, dir);
    else if (row.type === "segment") this.cycleSegment(this._focusIndex, dir);
    else if (row.type === "picker") this.openPicker(this._focusIndex);
  };

  Scene_CC3DModel.prototype._updateModalInput = function () {
    if (Input.isTriggered("cancel") || TouchInput.isCancelled()) { SoundManager.playCancel(); this.closeModal(); return; }
    if (Input.isRepeated("down")) this._moveModal(0, 1);
    else if (Input.isRepeated("up")) this._moveModal(0, -1);
    else if (Input.isRepeated("right")) this._moveModal(1, 0);
    else if (Input.isRepeated("left")) this._moveModal(-1, 0);
    else if (Input.isTriggered("ok")) this.pickModalOption(this._modal.index);
  };

  //---------------------------------------------------------------------------
  // 3D preview (main, live)
  //---------------------------------------------------------------------------

  Scene_CC3DModel.prototype.init3DView = function () {
    if (!isAvailable()) return;
    const canvas = document.getElementById("cc3d-canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width) || 420);
    const height = Math.max(1, Math.round(rect.height) || 480);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    // Muted studio lighting: MeshStandardMaterial with a light skin map blows
    // out to white under strong light, so keep the sum well under saturation.
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const keyLight = new THREE.DirectionalLight(0xfff2d0, 0.75); keyLight.position.set(3, 5, 4); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.3); fillLight.position.set(-3, -2, 2); scene.add(fillLight);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 300);
    camera.position.set(0, 0, 8);
    const pivot = new THREE.Group();
    scene.add(pivot);

    const state = {
      renderer, canvas, scene, camera, pivot,
      holder: null, model: null, rafId: 0, disposed: false, attackTimer: 1.2, frameAcc: 0,
      activeButton: -1, prev: { x: 0, y: 0 }, clock: new THREE.Clock(), listeners: {}
    };
    this._view3D = state;

    const L = state.listeners;
    L.onDown = (e) => {
      if (this._modal) return;
      if (e.button === 0 || e.button === 1) {
        state.activeButton = e.button;
        state.prev = { x: e.clientX, y: e.clientY };
        if (e.button === 1) e.preventDefault();
        canvas.style.cursor = "grabbing";
      }
    };
    L.onMove = (e) => {
      if (state.activeButton === -1) return;
      const dx = e.clientX - state.prev.x, dy = e.clientY - state.prev.y;
      if (state.activeButton === 0) { pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012; }
      else if (state.activeButton === 1) { const ps = 0.0035 * camera.position.z; camera.position.x -= dx * ps; camera.position.y += dy * ps; }
      state.prev = { x: e.clientX, y: e.clientY };
    };
    L.onUp = () => { state.activeButton = -1; canvas.style.cursor = "grab"; };
    L.onWheel = (e) => {
      if (this._modal) return;
      e.preventDefault(); e.stopPropagation();
      camera.position.z = Math.max(1.5, Math.min(60, camera.position.z + e.deltaY * 0.012));
    };
    L.onAux = (e) => { if (e.button === 1) e.preventDefault(); };
    L.onCtx = (e) => e.preventDefault();
    L.onTStart = (e) => { if (!this._modal && e.touches.length === 1) { state.activeButton = 0; state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } };
    L.onTMove = (e) => {
      if (state.activeButton !== -1 && e.touches.length === 1) {
        const dx = e.touches[0].clientX - state.prev.x, dy = e.touches[0].clientY - state.prev.y;
        pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012;
        state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    L.onTEnd = () => { state.activeButton = -1; };

    canvas.addEventListener("mousedown", L.onDown);
    canvas.addEventListener("mousemove", L.onMove);
    window.addEventListener("mouseup", L.onUp);
    canvas.addEventListener("wheel", L.onWheel, { passive: false });
    canvas.addEventListener("auxclick", L.onAux);
    canvas.addEventListener("contextmenu", L.onCtx);
    canvas.addEventListener("touchstart", L.onTStart);
    canvas.addEventListener("touchmove", L.onTMove);
    window.addEventListener("touchend", L.onTEnd);

    const FRAME = 1 / 30;
    const animate = () => {
      if (state.disposed) return;
      state.rafId = requestAnimationFrame(animate);
      state.frameAcc += Math.min(state.clock.getDelta(), 0.05);
      if (state.frameAcc < FRAME) return;
      const dt = state.frameAcc; state.frameAcc = 0;
      if (state.model) {
        state.attackTimer -= dt;
        if (state.attackTimer <= 0 && state.model.currentAnimation === "idle") {
          const anim = (state.model.hasAnimation("specialattack") && Math.random() < 0.4) ? "specialattack" : "attack";
          try { state.model.playAnimation(anim, false); } catch (e) { /* preview only */ }
          state.attackTimer = 2.4 + Math.random() * 1.6;
        }
        try { state.model.update(dt); } catch (e) { /* preview only */ }
      }
      if (window.PSXShader) window.PSXShader.render(renderer, scene, camera);
      else renderer.render(scene, camera);
    };
    animate();
  };

  Scene_CC3DModel.prototype.scheduleRebuild = function () {
    if (this._rebuildTimer) clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => { this._rebuildTimer = null; this.rebuildModel(); }, 200);
  };

  Scene_CC3DModel.prototype.rebuildModel = function () {
    const state = this._view3D;
    if (!state) return;
    const buildId = ++this._buildCounter;
    buildModel(this._config, this._actorId).then((battler) => {
      if (!battler || !battler.model) return;
      if (state.disposed || buildId !== this._buildCounter) {
        if (battler.model) disposeObject3D(battler.model);
        return;
      }
      if (state.holder) {
        disposeObject3D(state.holder);
        state.pivot.remove(state.holder);
        state.holder = null; state.model = null;
      }
      try { battler.update(1 / 60); } catch (e) { /* preview only */ }
      const box = new THREE.Box3().setFromObject(battler.model);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const holder = new THREE.Group();
      holder.position.copy(center).multiplyScalar(-1);
      holder.add(battler.model);
      if (window.PSXShader) window.PSXShader.applyToObject(battler.model);
      state.pivot.add(holder);
      state.holder = holder; state.model = battler;
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fitDist = maxDim / (2 * Math.tan((40 * Math.PI / 180) / 2));
      state.camera.position.set(0, 0, fitDist * 1.35);
      state.camera.lookAt(0, 0, 0);
      state.attackTimer = 1.2;
    }).catch(() => {});
  };

  Scene_CC3DModel.prototype.cleanup3DView = function () {
    this._terminated = true;
    const s = this._view3D;
    if (this._onSliderDown && this._dndContainer) this._dndContainer.removeEventListener("mousedown", this._onSliderDown);
    if (this._onSliderMove) window.removeEventListener("mousemove", this._onSliderMove);
    if (this._onSliderUp) window.removeEventListener("mouseup", this._onSliderUp);
    if (!s) return;
    s.disposed = true;
    cancelAnimationFrame(s.rafId);
    const L = s.listeners || {}, c = s.canvas;
    if (c) {
      c.removeEventListener("mousedown", L.onDown);
      c.removeEventListener("mousemove", L.onMove);
      c.removeEventListener("wheel", L.onWheel);
      c.removeEventListener("auxclick", L.onAux);
      c.removeEventListener("contextmenu", L.onCtx);
      c.removeEventListener("touchstart", L.onTStart);
      c.removeEventListener("touchmove", L.onTMove);
    }
    window.removeEventListener("mouseup", L.onUp);
    window.removeEventListener("touchend", L.onTEnd);
    if (s.holder) disposeObject3D(s.holder);
    // dispose() leaves the WebGL context alive. The browser caps live contexts
    // and force-loses the OLDEST past the cap, which is the game's own canvas:
    // PIXI then silently stops rendering and the picture freezes until the game
    // is restarted. Release it, then swap in a clean canvas node, since the
    // element a context was lost on can never host a new one.
    try { s.renderer.dispose(); } catch (e) { /* already lost */ }
    try { if (s.renderer.forceContextLoss) s.renderer.forceContextLoss(); } catch (e) {}
    if (c && c.parentNode) c.parentNode.replaceChild(c.cloneNode(false), c);
    this._view3D = null;
  };

  window.Scene_CC3DModel = Scene_CC3DModel;
})();
