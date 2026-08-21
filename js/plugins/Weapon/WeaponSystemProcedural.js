/*:
 * @target MZ
 * @plugindesc Procedural 3D models for Weapon System
 * @author AntiGravity
 * @help
 * Generates procedural 3D models for weapons that do not have custom <3DModel>
 * tags.
 *
 * ============================================================================
 * Where the models live
 * ============================================================================
 * This file is the engine only: seeding, caching, mesh merging, the animation
 * tick and the Sprite_3DWeapon patches. The model builders live in the
 * Weapon3D_* files beside it and are injected at runtime from the
 * WEAPON3D_FAMILIES list at the bottom, the same arrangement 3DBattlerSystem
 * uses for its 3DBattler_* families. None of them belongs in plugins.js.
 *
 * A family registers itself with:
 *
 *   WeaponSystemProcedural.registerFamily({
 *     name:   'Weapon3D_Swords',
 *     unique: { 57: 'createLongSwordModel' },   // per database id, optional
 *     models: { createLongSwordModel(weapon, rand) { ... } }
 *   });
 *
 * Dispatch order for a weapon with no <3DModel>: its bespoke model (by
 * database id) -> a note tag in NOTE_MODELS -> whip/flail -> its weapon type.
 * A family that fails to load costs only the models it carried.
 *
 * ============================================================================
 * Seeding
 * ============================================================================
 * A weapon's appearance is world-persistent procedural content, so every
 * colour, proportion and trinket is drawn from HistorySimulator's world seed
 * mixed with the weapon id (seedFor / worldSeed). The same sword looks the
 * same in every savegame of a world and different in the next one.
 *
 * ============================================================================
 * Cost
 * ============================================================================
 * The overlay can be drawing at the same time as the 3D battler scene, so:
 *   - a built weapon is cached and handed out as a clone (shared geometry and
 *     textures, per-instance materials), which is ~30x cheaper than rebuilding
 *   - meshes that never move relative to the model are merged into one buffer
 *     per material, taking a decorated weapon from ~60 draw calls to a handful
 *   - while 3D battlers are on (switch 70), every radial geometry drops a tier
 *     and decorative trim is skipped: about 40% fewer triangles, same
 *     silhouettes
 *
 * ============================================================================
 * Moving parts
 * ============================================================================
 * Attack animations are whole-model keyframes from
 * js/db/Sprites/MovementKeyFrame3d.json. A model can additionally declare
 * moving parts of its own, as plain data on userData so a cached model can
 * still be cloned: spin, sway, bob, orbit and pulse. See tickModelParts.
 */

var WeaponSystemProcedural = {
  // mulberry32: cheap, well distributed, and (unlike the old abs(sin) chain)
  // it does not fall into short cycles for neighbouring seeds, which is what
  // made whole runs of consecutive weapon ids come out looking alike.
  createSeededRandom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // ============================================================
  // World seeding
  // ============================================================
  // A weapon's appearance is world-persistent procedural content, so it hangs
  // off the canonical world-RNG root (HistorySimulator's seed) rather than the
  // database id alone: the same Kukri looks the same in every savegame of a
  // world and different in the next world.
  WEAPON_SEED_SALT: 0x5745_4150, // "WEAP"

  worldSeed() {
    try {
      if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
        const s = Number(window.HistoryManager.getSeed());
        if (Number.isFinite(s)) return s >>> 0;
      }
    } catch (e) { /* history not booted yet (title screen previews) */ }
    return 19002001;
  },

  /**
   * A forged piece (Crafting/BlacksmithingMenu.js) is materialized as a brand
   * new database entry, with its own id past FORGE_ID_BASE, so anything keyed
   * on database id (the bespoke model table, a house finish) would otherwise
   * lose track of what the piece actually is the moment it leaves the anvil.
   * The anvil writes the id it was forged from onto the piece as
   * `<ForgeBaseId:>`; every id-keyed lookup goes through here instead of
   * reading weapon.id directly, so a forged claw still finds its bespoke claw
   * model and a forged Varlenia piece still wears its house gold.
   */
  dispatchIdFor(weapon) {
    const raw = weapon && weapon.meta && weapon.meta.ForgeBaseId;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : ((weapon && weapon.id) || 0);
  },

  /** Deterministic per-weapon seed derived from the world seed. */
  seedFor(weapon) {
    // A piece beaten out at the anvil carries the seed it was previewed under,
    // so what the smith looked at is what came off the fire.
    const forged = weapon && weapon.meta && weapon.meta.ForgeSeed;
    if (forged) {
      const n = Number(forged);
      if (Number.isFinite(n)) return n >>> 0;
    }
    const id = (weapon && weapon.id) || 0;
    let h = (this.worldSeed() ^ this.WEAPON_SEED_SALT) >>> 0;
    h = Math.imul(h ^ (id + 0x9E3779B9), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  },

  _textureCache: {},

  // Source art is 750x750 (and the effect PNGs are larger still), while a
  // weapon covers a few hundred screen pixels through a nearest-neighbour PSX
  // filter. Uploading the originals cost ~2.25 MB of VRAM each and a full-size
  // decode on the frame the weapon appeared, so every texture is downsampled
  // into a small power-of-two canvas instead (POT also makes RepeatWrapping
  // legal, which it never was at 750px).
  TEXTURE_SIZE: 128,

  /**
   * Where a finish name lives on disk. Three banks answer to one list of
   * names: the seamless stone and marble sheets in `img/textures/`, the effect
   * plates under `effects/`, and the strange bank the dream keeps, whose names
   * carry a `dream/` prefix so nothing else can collide with them.
   */
  DREAM_PREFIX: 'dream/',

  texturePath(filename) {
    const name = String(filename || '');
    if (name.startsWith(this.DREAM_PREFIX)) return `img/dreamtextures/${name.slice(this.DREAM_PREFIX.length)}`;
    return name.endsWith('.jpg')
      ? `img/textures/${name}`
      : `effects/MAGICALxSPIRAL/Texture/${name}`;
  },

  getTexture(filename) {
    if (!filename) return null;
    if (typeof THREE === 'undefined') return null;
    const path = this.texturePath(filename);
    if (this._textureCache[path]) {
      return this._textureCache[path];
    }

    const size = this.TEXTURE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // Neutral grey stand-in until the bitmap arrives, so the material shows its
    // own colour instead of flashing black.
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Mark as a shared/cached singleton so per-model disposal never frees it
    // (this texture is reused by every weapon model that draws the same type).
    texture._weaponSharedCache = true;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      texture.needsUpdate = true;
    };
    img.onerror = () => { /* keep the neutral placeholder */ };
    img.src = path;

    this._textureCache[path] = texture;
    return texture;
  },

  /**
   * Picks a texture for a material class.
   * @param {function} rand - seeded RNG
   * @param {string} type - material class (blade/heavy/wood/magic/gun/default)
   * @param {object} [memo] - per-model cache; parts of the same class share one
   *   texture instead of pulling a separate bitmap each. The RNG is still
   *   consumed on every call so a weapon's seeded appearance is unchanged.
   */
  getRandomTexture(rand, type, memo) {
    const list = this.getTexturesForType(type);
    if (!list || list.length === 0) return null;
    const filename = list[Math.floor(rand() * list.length)];
    if (memo) {
      if (memo[type] === undefined) memo[type] = this.getTexture(filename);
      return memo[type];
    }
    return this.getTexture(filename);
  },

  /**
   * The finish a forged piece was given at the anvil, if any.
   * `<ForgeTexture: teal_marble.jpg>` names one of getTexturesForType()'s files.
   */
  forcedTextureFor(weapon) {
    const raw = weapon && weapon.meta && weapon.meta.ForgeTexture;
    const name = raw ? String(raw).trim() : '';
    return name ? this.getTexture(name) : null;
  },

  /**
   * The strange bank (img/dreamtextures/): public-domain faces and unearthly
   * surfaces. It is deliberately kept OUT of the class lists below, because
   * those are what a weapon's seeded appearance is drawn from and lengthening
   * one would re-roll every weapon in every world. It is offered as a choice
   * instead: the finishes the anvil lays out beside the marbles, and the sheets
   * a dream re-dresses what you are holding with.
   */
  DREAM_TEXTURES: [
      'dream/face_anatomical_wax_1.jpg', 'dream/face_anatomical_wax_2.jpg', 'dream/face_arcimboldo_1.jpg', 'dream/face_arcimboldo_2.jpg',
      'dream/face_bosch_detail_1.jpg', 'dream/face_bosch_detail_2.jpg', 'dream/face_character_head_1.jpg', 'dream/face_character_head_2.jpg',
      'dream/face_death_mask_1.jpg', 'dream/face_death_mask_2.jpg', 'dream/face_demon_1.jpg', 'dream/face_demon_2.jpg',
      'dream/face_ensor_mask_2.jpg', 'dream/face_gargoyle_1.jpg', 'dream/face_gargoyle_2.jpg', 'dream/face_goya_grotesque_1.jpg',
      'dream/face_goya_grotesque_2.jpg', 'dream/face_grotesque_1.jpg', 'dream/face_grotesque_2.jpg', 'dream/face_mask_noh_1.jpg',
      'dream/face_mask_noh_2.jpg', 'dream/face_mask_ritual_1.jpg', 'dream/face_mask_ritual_2.jpg', 'dream/face_mummy_portrait_1.jpg',
      'dream/face_mummy_portrait_2.jpg', 'dream/face_phrenology_1.jpg', 'dream/face_phrenology_2.jpg', 'dream/face_skull_engraving_1.jpg',
      'dream/face_skull_engraving_2.jpg', 'dream/marbled_paper_1.jpg', 'dream/marbled_paper_2.jpg'
  ],

  getTexturesForType(type) {
    const generalTextures = [
      'amber_onyx_marble.jpg', 'amber_paper.jpg', 'beige_sandstone.jpg', 'blue_slate.jpg', 'bright_gold.jpg',
      'brown_green_marble.jpg', 'brown_grey_slate.jpg', 'brown_leather_stone.jpg', 'brown_stone.jpg', 'burnt_orange_rock.jpg',
      'charcoal_brown_stone.jpg', 'copper_brown_stone.jpg', 'copper_patina.jpg', 'cracked_earth.jpg', 'cream_pastel_marble.jpg',
      'crimson_psychedelic.jpg', 'dark_brown_marble.jpg', 'dark_gold_foil.jpg', 'dark_gold_swirl.jpg', 'dark_green_smoke_marble.jpg',
      'dark_grey_smoke.jpg', 'dark_moss_marble.jpg', 'dark_mossy_slate.jpg', 'dusty_pink_stone.jpg', 'emerald_marble.jpg',
      'fire.jpg', 'gold_parchment.jpg', 'golden_brown_leather.jpg', 'golden_olive_marble.jpg', 'golden_sandstone.jpg',
      'green_gold_marble.jpg', 'green_marble.jpg', 'green_patina_marble.jpg', 'grey_brown_watercolor.jpg', 'grey_cloud_concrete.jpg',
      'grey_concrete.jpg', 'grey_green_marble.jpg', 'grey_green_slate.jpg', 'grey_marble.jpg', 'grey_pink_stone.jpg',
      'grey_smoke_marble.jpg', 'grey_smoky_marble.jpg', 'grey_teal_stone.jpg', 'iridescent_oil.jpg', 'khaki_stone.jpg',
      'lavender_stucco.jpg', 'magenta_psychedelic.jpg', 'malachite.jpg', 'mauve_brown_rock.jpg', 'mauve_rock.jpg',
      'mauve_stucco.jpg', 'molten_gold.jpg', 'mossy_green_rock.jpg', 'mottled_tan_stone.jpg', 'mustard_marble.jpg',
      'ochre_watercolor_stone.jpg', 'olive_cloudy_marble.jpg', 'olive_cracked_marble.jpg', 'olive_cracked_rock.jpg', 'olive_gold_concrete.jpg',
      'olive_grey_stone.jpg', 'olive_leather_stone.jpg', 'olive_mottled_stone.jpg', 'olive_parchment.jpg', 'olive_peach_stone.jpg',
      'olive_striated_rock.jpg', 'olive_swirl_stone.jpg', 'pale_gold_stone.jpg', 'pale_sage_stone.jpg', 'peach_stone.jpg',
      'pink_rainbow_swirl.jpg', 'psychedelic_marble.jpg', 'red_marble.jpg', 'red_teal_marble.jpg', 'rust_copper_marble.jpg',
      'sage_cloud_marble.jpg', 'sage_green_stone.jpg', 'sage_grey_stone.jpg', 'sage_plaster.jpg', 'sage_rippled_stone.jpg',
      'sage_weathered_stone.jpg', 'sandstone.jpg', 'tan_cloud_stone.jpg', 'tan_cloudy_stone.jpg', 'tan_pink_marble.jpg',
      'tan_stone.jpg', 'taupe_cloud_marble.jpg', 'taupe_grey_cloud_stone.jpg', 'taupe_marble.jpg', 'taupe_stone.jpg',
      'taupe_watercolor_marble.jpg', 'teal_marble.jpg', 'teal_patina_stone.jpg', 'turquoise_verdigris.jpg', 'violet_psychedelic.jpg',
      'warm_brown_cloud_stone.jpg', 'warm_grey_stone.jpg', 'weathered_concrete.jpg', 'yellow_green_marble.jpg', 'yellow_green_moss_marble.jpg'
    ];

    switch(type) {
      case 'dream':
        return this.DREAM_TEXTURES;
      case 'gun':
        return ['ExperimentalNoise.png', 'ExperimentalBlur.png', 'PolkaDot.png', 'Thunder10.png', 'blue_fire.png', 'magma.png', 'cell_trans2048.png', 'Glass.png', ...generalTextures.slice(0, 20)];
      case 'blade':
        return ['Sword001.png', 'Sword002.png', 'StanBlade.png', 'Line02.png', 'Thunder_Bold.png', 'Direction.png', ...generalTextures.slice(20, 40)];
      case 'heavy':
        return ['Hammer1.png', 'magma.png', 'Thunder_Bold.png', 'ExperimentalNoise.png', 'cell_trans2048.png', ...generalTextures.slice(40, 60)];
      case 'wood':
        return ['Line02.png', 't0007.png', 't0003.png', ...generalTextures.slice(60, 80)];
      case 'magic':
        return ['MagicCircle1.png', 'MagicCircle3.png', 'MagicCircle5.png', 'Aurora.png', 'Crystal001.png', 'Crystal002.png', ...generalTextures.slice(80, 100)];
      default:
        return ['Line02.png', 't0003.png', 'Spark001.png', 'Particle01.png', ...generalTextures];
    }
  },

  // ============================================================
  // Render budget
  // ============================================================
  // The weapon overlay can be on screen at the same time as the 3D battler
  // scene, which is by far the heavier of the two: when it is, every radial
  // geometry drops a tier and the optional trinkets (extra rivets, spare
  // gems, grip rings) are skipped. Nothing about the silhouette changes, so a
  // weapon is still recognisably itself at either budget.
  _lowDetail: false,
  _lowDetailCheckedAt: 0,

  isLowDetail() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // Re-asking every build would be free, but this is also read from inside
    // geometry loops; a second of staleness costs nothing.
    if (now - this._lowDetailCheckedAt < 1000) return this._lowDetail;
    this._lowDetailCheckedAt = now;
    let low = false;
    try {
      if (window.$gameSwitches && window.$gameSwitches.value(70)) low = true;
      if (window.ConfigManager && ConfigManager.battler3D) low = true;
    } catch (e) { /* outside a running game */ }
    this._lowDetail = low;
    return low;
  },

  /** Radial/height segment count for the current budget, floored at `min`. */
  seg(n, min) {
    const floor = min || 3;
    if (!this.isLowDetail()) return Math.max(floor, n);
    return Math.max(floor, Math.round(n * 0.6));
  },

  /** True when a purely decorative part is worth building. */
  wantsTrim() {
    return !this.isLowDetail();
  },

  // Which constructor arguments of a THREE primitive are segment counts, and
  // how far each may be cut. Used to put the whole back catalogue of models on
  // the same budget as the ones that call seg() by hand.
  GEOMETRY_SEGMENT_ARGS: {
    CylinderGeometry: [[3, 5], [4, 1]],
    ConeGeometry: [[2, 4], [3, 1]],
    SphereGeometry: [[1, 5], [2, 4]],
    TorusGeometry: [[2, 3], [3, 6]],
    TorusKnotGeometry: [[2, 8], [3, 4]],
    RingGeometry: [[1, 6], [2, 1]],
    CircleGeometry: [[1, 6]],
    LatheGeometry: [[1, 5]],
    TubeGeometry: [[1, 3], [3, 3]],
    PlaneGeometry: [[2, 1], [3, 1]],
    BoxGeometry: [[3, 1], [4, 1], [5, 1]],
    DodecahedronGeometry: [[1, 0]],
    IcosahedronGeometry: [[1, 0]],
    OctahedronGeometry: [[1, 0]],
    TetrahedronGeometry: [[1, 0]],
    SphereBufferGeometry: [[1, 5], [2, 4]]
  },

  /**
   * Temporarily thins every radial geometry THREE hands out. Returns the undo
   * function. This is what makes the low-detail budget apply to the models
   * that were written before it existed, not only to the ones calling seg().
   */
  _patchGeometryBudget() {
    if (!this.isLowDetail() || typeof THREE === 'undefined') return function () {};
    const saved = [];
    for (const name of Object.keys(this.GEOMETRY_SEGMENT_ARGS)) {
      const Original = THREE[name];
      if (typeof Original !== 'function') continue;
      const spec = this.GEOMETRY_SEGMENT_ARGS[name];
      saved.push([name, Original]);
      const Budgeted = function (...args) {
        for (const [index, floor] of spec) {
          const v = args[index];
          if (typeof v === 'number' && v > floor) args[index] = Math.max(floor, Math.round(v * 0.6));
        }
        return new Original(...args);
      };
      Budgeted.prototype = Original.prototype;
      THREE[name] = Budgeted;
    }
    return function () {
      for (const [name, Original] of saved) THREE[name] = Original;
    };
  },

  // ============================================================
  // Built-model cache
  // ============================================================
  // Building a weapon costs 2-5ms of geometry generation plus a fresh GPU
  // upload for every one of its (up to 60) meshes, and the equip screen, the
  // forge preview and a battle re-equip all rebuild the same handful of
  // weapons over and over. A built weapon is therefore kept as a prototype and
  // handed out as a clone: THREE's clone shares geometry and material by
  // reference, so a repeat costs one small object tree and zero uploads.
  //
  // Clone copies userData through JSON, which is exactly why every per-part
  // animation below is stored as plain data rather than a closure.
  _modelCache: new Map(),
  MODEL_CACHE_MAX: 24,

  /** Neutralises dispose() on a prototype's shared resources. */
  _protectResources(root) {
    const seen = new Set();
    const protect = (res) => {
      if (!res || seen.has(res)) return;
      seen.add(res);
      if (res._weaponProtected) return;
      res._weaponProtected = true;
      if (typeof res.dispose === 'function') {
        res._realDispose = res.dispose;
        res.dispose = function () { /* owned by the weapon model cache */ };
      }
    };
    root.traverse((obj) => {
      if (obj.geometry) protect(obj.geometry);
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(protect);
        else protect(obj.material);
      }
    });
  },

  /** Gives a prototype's resources their dispose() back, without freeing. */
  _freePrototypeProtection(root) {
    if (!root) return;
    const restore = (res) => {
      if (!res || !res._realDispose) return;
      res.dispose = res._realDispose;
      res._realDispose = null;
      res._weaponProtected = false;
    };
    root.traverse((obj) => {
      if (obj.geometry) restore(obj.geometry);
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(restore);
        else restore(obj.material);
      }
    });
  },

  _freePrototype(root) {
    if (!root) return;
    const seen = new Set();
    const free = (res) => {
      if (!res || seen.has(res)) return;
      seen.add(res);
      if (res._realDispose) {
        res.dispose = res._realDispose;
        res._realDispose = null;
        res._weaponProtected = false;
      }
      // Textures from getTexture() are shared by every model and never freed.
      if (typeof res.dispose === 'function' && !res._weaponSharedCache) res.dispose();
    };
    root.traverse((obj) => {
      if (obj.geometry) free(obj.geometry);
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(free);
        else free(obj.material);
      }
    });
  },

  clearModelCache() {
    for (const entry of this._modelCache.values()) this._freePrototype(entry);
    this._modelCache.clear();
  },

  /**
   * Hands out a usable copy of a cached prototype.
   *
   * Geometry (the expensive half: it owns the GPU buffers) is shared with the
   * prototype. Materials are NOT: callers legitimately reshade what they were
   * given, and the title screen in particular brightens every material of the
   * artifact it is showing, which would otherwise repaint the same weapon
   * everywhere else in the game. Cloning them costs a few uniform objects and
   * no upload, since the texture reference goes across untouched.
   */
  _instance(prototype) {
    const copy = prototype.clone(true);
    const seen = new Map();
    copy.traverse((obj) => {
      if (!obj.isMesh || !obj.material || Array.isArray(obj.material)) return;
      let mat = seen.get(obj.material);
      if (!mat) {
        mat = obj.material.clone();
        seen.set(obj.material, mat);
      }
      obj.material = mat;
    });
    return copy;
  },

  createModel(weapon) {
    if (!window.THREE || !weapon) return null;

    // The finish and the seed are part of the key: the forge previews the same
    // database entry under a dozen different skins before anything is made.
    const meta = weapon.meta || {};
    const key = this.worldSeed() + ':' + (weapon.id || 0) +
      ':' + (meta.ForgeSeed || '') + ':' + (meta.ForgeTexture || '') +
      ':' + (this.isLowDetail() ? 'lo' : 'hi');
    const cached = this._modelCache.get(key);
    if (cached) {
      // Map preserves insertion order, so re-inserting is the whole LRU touch.
      this._modelCache.delete(key);
      this._modelCache.set(key, cached);
      return this._instance(cached);
    }

    const root = this._buildModel(weapon);
    if (!root) return null;

    // A rope weapon carries live simulation state (point masses holding mesh
    // references) in userData, which clone() would flatten into dead JSON.
    if (root.userData._verletRope || root.userData._verletRopes) return root;

    try {
      this.mergeStaticParts(root);
      this._protectResources(root);
      this._modelCache.set(key, root);
      while (this._modelCache.size > this.MODEL_CACHE_MAX) {
        const oldest = this._modelCache.keys().next().value;
        const victim = this._modelCache.get(oldest);
        this._modelCache.delete(oldest);
        // Instances handed out earlier still point at this geometry. Freeing
        // it releases the GPU copy only; THREE re-uploads from the attribute
        // arrays the next time one of them is drawn, so the worst an evicted
        // weapon still on screen can cost is a single re-upload. The cache is
        // small enough that the two weapons in a battle are never the victims.
        this._freePrototype(victim);
      }
      return this._instance(root);
    } catch (e) {
      console.warn('[WeaponSystemProcedural] model caching failed, using one-off model', e);
      this._modelCache.delete(key);
      this._freePrototypeProtection(root);
      return root;
    }
  },

  // ============================================================
  // Static mesh merging
  // ============================================================
  // A procedural weapon is built out of dozens of small primitives, and every
  // one of them was a draw call with its own uniform upload. Meshes that never
  // move relative to the model are baked into one buffer per material, which
  // takes a heavily decorated weapon from ~60 draw calls to a handful. Parts
  // that DO move (rope links, anything carrying an animation descriptor, and
  // everything under a group marked dynamic) are left alone.
  mergeStaticParts(root) {
    if (!root || typeof THREE === 'undefined' || !THREE.BufferGeometry) return root;

    const isMoving = (obj) => {
      const ud = obj.userData;
      return !!(ud && (ud.dynamic || ud.spin || ud.bob || ud.pulse || ud.orbit || ud.sway || ud._chainAlternate !== undefined));
    };

    root.updateMatrixWorld(true);

    // A moving part is its own merge root: the gears of a clockwork weapon
    // still collapse to one buffer each, they just do not collapse into the
    // weapon around them.
    const anchors = [root];
    root.traverse((obj) => { if (obj !== root && isMoving(obj)) anchors.push(obj); });

    // Nearest moving ancestor decides which anchor a mesh belongs to.
    const anchorOf = (obj) => {
      let node = obj;
      while (node) {
        if (node === root || isMoving(node)) return node;
        node = node.parent;
      }
      return root;
    };

    const removals = [];
    const inverse = new THREE.Matrix4();
    const local = new THREE.Matrix4();

    for (const anchor of anchors) {
      const buckets = new Map();
      anchor.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry || !obj.material) return;
        if (Array.isArray(obj.material)) return;   // multi-material, left as-is
        if (obj.geometry.morphAttributes && Object.keys(obj.geometry.morphAttributes).length) return;
        if (isMoving(obj)) return;                 // an anchor never merges itself away
        if (anchorOf(obj.parent) !== anchor) return;
        const key = obj.material.uuid;
        if (!buckets.has(key)) buckets.set(key, { material: obj.material, meshes: [] });
        buckets.get(key).meshes.push(obj);
      });

      inverse.copy(anchor.matrixWorld).invert();
      for (const bucket of buckets.values()) {
        if (bucket.meshes.length < 2) continue;
        const parts = [];
        for (const mesh of bucket.meshes) {
          const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          local.multiplyMatrices(inverse, mesh.matrixWorld);
          geo.applyMatrix4(local);
          parts.push(geo);
          removals.push(mesh);
        }
        const merged = this._concatGeometries(parts);
        for (const g of parts) g.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, bucket.material);
        mesh.userData._merged = true;
        anchor.add(mesh);
      }
    }

    for (const mesh of removals) {
      if (mesh.parent) mesh.parent.remove(mesh);
      if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
    }

    return root;
  },

  /**
   * Concatenates non-indexed geometries that all carry position (and, where
   * present in every part, normal/uv). Written out here because the three
   * build the game ships does not include BufferGeometryUtils.
   */
  _concatGeometries(geometries) {
    if (!geometries.length) return null;
    const wantNormal = geometries.every(g => g.attributes.normal);
    const wantUv = geometries.every(g => g.attributes.uv);

    let total = 0;
    for (const g of geometries) {
      if (!g.attributes.position) return null;
      total += g.attributes.position.count;
    }

    const position = new Float32Array(total * 3);
    const normal = wantNormal ? new Float32Array(total * 3) : null;
    const uv = wantUv ? new Float32Array(total * 2) : null;

    let v = 0;
    for (const g of geometries) {
      const p = g.attributes.position;
      position.set(p.array.subarray(0, p.count * 3), v * 3);
      if (normal) normal.set(g.attributes.normal.array.subarray(0, p.count * 3), v * 3);
      if (uv) uv.set(g.attributes.uv.array.subarray(0, p.count * 2), v * 2);
      v += p.count;
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(position, 3));
    if (normal) out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  },

  // ============================================================
  // Per-part animation
  // ============================================================
  // Unique weapons carry moving parts (spinning gears, drifting memory shards,
  // pulsing runes). They are declared as plain data on the part's userData so
  // that a cached model can still be cloned, and driven from one traversal:
  //
  //   spin  { axis:'x'|'y'|'z', speed }            radians per second
  //   bob   { axis, amp, freq, phase }             offset from its rest position
  //   sway  { axis, amp, freq, phase }             rotation wobble, radians
  //   orbit { radius, speed, phase, plane:'xz' }   circles its rest position
  //   pulse { min, max, freq, phase }              material emissive intensity
  tickModelParts(model, deltaMs) {
    if (!model) return;
    let parts = model._weaponAnimParts;
    if (!parts) {
      parts = [];
      model.traverse((obj) => {
        const ud = obj.userData;
        if (!ud) return;
        if (ud.spin || ud.bob || ud.sway || ud.orbit || ud.pulse) {
          ud._rest = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
          ud._restRot = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
          parts.push(obj);
        }
      });
      model._weaponAnimParts = parts;
    }
    if (parts.length === 0) return;

    model._weaponAnimTime = (model._weaponAnimTime || 0) + deltaMs / 1000;
    const t = model._weaponAnimTime;

    for (let i = 0; i < parts.length; i++) {
      const obj = parts[i];
      const ud = obj.userData;
      if (ud.spin) {
        const ax = ud.spin.axis || 'y';
        obj.rotation[ax] = ud._restRot[ax] + t * (ud.spin.speed || 1);
      }
      if (ud.sway) {
        const ax = ud.sway.axis || 'z';
        obj.rotation[ax] = ud._restRot[ax] + Math.sin(t * (ud.sway.freq || 1) + (ud.sway.phase || 0)) * (ud.sway.amp || 0.1);
      }
      if (ud.bob) {
        const ax = ud.bob.axis || 'y';
        obj.position[ax] = ud._rest[ax] + Math.sin(t * (ud.bob.freq || 1) + (ud.bob.phase || 0)) * (ud.bob.amp || 0.01);
      }
      if (ud.orbit) {
        const a = t * (ud.orbit.speed || 1) + (ud.orbit.phase || 0);
        const r = ud.orbit.radius || 0.02;
        if (ud.orbit.plane === 'xy') {
          obj.position.x = ud._rest.x + Math.cos(a) * r;
          obj.position.y = ud._rest.y + Math.sin(a) * r;
        } else if (ud.orbit.plane === 'yz') {
          obj.position.y = ud._rest.y + Math.cos(a) * r;
          obj.position.z = ud._rest.z + Math.sin(a) * r;
        } else {
          obj.position.x = ud._rest.x + Math.cos(a) * r;
          obj.position.z = ud._rest.z + Math.sin(a) * r;
        }
      }
      if (ud.pulse && obj.material && obj.material.emissive) {
        const p = ud.pulse;
        const k = (Math.sin(t * (p.freq || 1) + (p.phase || 0)) + 1) / 2;
        obj.material.emissiveIntensity = (p.min || 0) + ((p.max !== undefined ? p.max : 1) - (p.min || 0)) * k;
      }
    }
  },

  _buildModel(weapon) {
    if (!window.THREE) return null;

    const rand = this.createSeededRandom(this.seedFor(weapon));
    const wtypeId = weapon.wtypeId || 1;
    const note = weapon.note || '';

    // A piece that came off the forge with a finish chosen at the anvil wears
    // that finish instead of the one its seed would have dealt it
    // (Crafting/BlacksmithingMenu.js writes the tag when the piece is made).
    const forcedTex = this.forcedTextureFor(weapon);

    const OriginalMeshStandardMaterial = THREE.MeshStandardMaterial;
    // One texture per material class per weapon instead of one per material.
    const texMemo = {};

    // Dynamically override THREE.MeshStandardMaterial during synchronous procedural generation
    THREE.MeshStandardMaterial = function(parameters) {
      const params = { ...parameters };
      let type = 'default';
      if (params.metalness > 0.6) {
        if (params.roughness < 0.3) {
          type = 'blade';
        } else {
          type = 'heavy';
        }
      } else if (params.roughness > 0.8) {
        type = 'wood';
      } else if (params.emissive) {
        type = 'magic';
      } else if (wtypeId === 9 || note.match(/<RocketLauncher>|<Minigun>|<Flamethrower>|<Shotgun>|<SniperRifle>|<SMG>/i)) {
        type = 'gun';
      }
      
      // The RNG is consumed either way, so a chosen finish never shifts the
      // rest of the model's seeded appearance.
      const rolled = WeaponSystemProcedural.getRandomTexture(rand, type, texMemo);
      const tex = forcedTex || rolled;
      if (tex) {
        params.map = tex;
      }
      return new OriginalMeshStandardMaterial(params);
    };
    THREE.MeshStandardMaterial.prototype = OriginalMeshStandardMaterial.prototype;
    const restoreGeometry = this._patchGeometryBudget();

    try {
      // An empty hand: the fist is chosen by the character's archetype, not
      // by any database entry.
      if (weapon.unarmedArchetype) return this.finish(this.buildUnarmed(weapon, rand), weapon);

      // A shield has no weapon type to fall back on, so it never reaches the
      // TYPE_MODELS table below.
      if (weapon.shieldArmorId) return this.finish(this.build('createShieldModel', weapon, rand), weapon);

      // Bespoke per-weapon models, keyed by database id exactly like the i18n
      // name/description tables are. A weapon that has one never falls back to
      // the generic silhouette for its type.
      const bespoke = this.UNIQUE_MODELS[this.dispatchIdFor(weapon)];
      if (bespoke && typeof this[bespoke] === 'function') return this.finish(this[bespoke](weapon, rand), weapon);

      for (const [tag, builder] of this.NOTE_MODELS) {
        if (tag.test(note)) return this.finish(this.build(builder, weapon, rand), weapon);
      }

      if (weapon.isWhip) return this.finish(this.build('createWhipModel', weapon, rand), weapon);
      if (weapon.isFlail) return this.finish(this.build('createFlailModel', weapon, rand), weapon);

      return this.finish(this.build(this.TYPE_MODELS[wtypeId] || 'createLightModel', weapon, rand), weapon);
    } finally {
      THREE.MeshStandardMaterial = OriginalMeshStandardMaterial;
      restoreGeometry();
    }
  },

  // ============================================================
  // House finishes
  // ============================================================
  // Some makers are recognisable across every weapon they ever made, whatever
  // shape it is. A finish is applied after the builder returns, so it covers
  // bespoke models and generic ones alike and no builder has to know about it.
  //
  // Varlenia works only in gold: all ten of its weapons, from the twinblades
  // to the beam rifle, come out of the same workshop looking like it.
  VARLENIA_IDS: [30, 109, 183, 225, 260, 320, 367, 526, 605, 651],

  // ============================================================
  // Welding
  // ============================================================
  // A model is a few dozen primitives placed by hand, and a part written at a
  // height or a depth that does not match what it is fixed to hangs in the air:
  // a slingshot fork floating over its handle, a staff's head over its shaft, a
  // grip under a barrel it never reaches. Rather than chase every one of them
  // through 532 builders, the last step of every build pulls parts that are not
  // attached back onto the weapon by the least amount that makes them touch.
  //
  // What is deliberately off on its own is left alone: anything a builder
  // declared as a moving part (spin / orbit / bob / sway / pulse / dynamic, the
  // tags tickModelParts animates), a pair's other half, and anything so far out
  // that it must be there on purpose.

  // A part within this share of the model's diagonal counts as attached: the
  // primitives abut rather than interpenetrate.
  WELD_TOUCH: 0.012,
  // The furthest a part is ever pulled in one pass. Beyond it, it is a design.
  WELD_MAX: 0.16,
  // Passes, so a part welded to a part welded to the body still comes home.
  WELD_PASSES: 4,
  WELD_SAMPLES: 24,
  MOVING_PART_KEYS: ['spin', 'orbit', 'bob', 'sway', 'pulse', 'dynamic'],

  /** What welding needs of one mesh: its oriented box and a few of its points. */
  _weldPart(mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const pos = mesh.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / this.WELD_SAMPLES));
    const pts = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += step) {
      pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).clone());
    }
    const world = new THREE.Box3().setFromObject(mesh);
    const size = world.getSize(new THREE.Vector3());
    let moving = false;
    for (let p = mesh; p; p = p.parent) {
      const ud = p.userData;
      if (ud && this.MOVING_PART_KEYS.some(k => ud[k] !== undefined)) { moving = true; break; }
    }
    return {
      mesh, world, pts, moving,
      local: mesh.geometry.boundingBox,
      inv: new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
      volume: Math.max(size.x, 1e-4) * Math.max(size.y, 1e-4) * Math.max(size.z, 1e-4)
    };
  },

  /** Distance from a world point to a part's oriented box (0 inside it). */
  _weldPointGap(part, p) {
    const q = p.clone().applyMatrix4(part.inv);
    const b = part.local;
    return Math.hypot(
      Math.max(b.min.x - q.x, 0, q.x - b.max.x),
      Math.max(b.min.y - q.y, 0, q.y - b.max.y),
      Math.max(b.min.z - q.z, 0, q.z - b.max.z));
  },

  /** Per-axis separation of two world boxes (0 where they already overlap). */
  _weldAxisGaps(a, b) {
    return [
      Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
      Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
      Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z)
    ];
  },

  /**
   * How far apart two parts really are. Axis-aligned boxes alone call a rotated
   * grip "touching" a barrel it is nowhere near, so the boxes only decide
   * whether it is worth measuring surface to surface.
   */
  _weldGap(a, b) {
    const axis = this._weldAxisGaps(a.world, b.world);
    const rough = Math.hypot(axis[0], axis[1], axis[2]);
    let best = Infinity;
    for (const p of a.pts) { const d = this._weldPointGap(b, p); if (d < best) best = d; }
    for (const p of b.pts) { const d = this._weldPointGap(a, p); if (d < best) best = d; }
    return Math.max(best, rough);
  },

  weldLooseParts(model) {
    if (!model || typeof THREE === 'undefined') return model;
    for (let pass = 0; pass < this.WELD_PASSES; pass++) {
      if (!this._weldPass(model)) break;
    }
    return model;
  },

  /** One welding pass. Returns true when something moved. */
  _weldPass(model) {
    model.updateMatrixWorld(true);
    const parts = [];
    model.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        parts.push(this._weldPart(o));
      }
    });
    if (parts.length < 3) return false;

    const whole = new THREE.Box3();
    for (const p of parts) whole.union(p.world);
    const diag = whole.getSize(new THREE.Vector3()).length();
    if (!(diag > 0)) return false;
    const eps = diag * this.WELD_TOUCH;

    // Group the parts that touch.
    const owner = parts.map((_, i) => i);
    const find = (i) => { while (owner[i] !== i) { owner[i] = owner[owner[i]]; i = owner[i]; } return i; };
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (find(i) === find(j)) continue;
        const axis = this._weldAxisGaps(parts[i].world, parts[j].world);
        if (Math.hypot(axis[0], axis[1], axis[2]) > eps) continue;   // certainly apart
        if (this._weldGap(parts[i], parts[j]) <= eps) owner[find(i)] = find(j);
      }
    }
    const groups = new Map();
    parts.forEach((p, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(p);
    });
    if (groups.size < 2) return false;

    // The weapon is the component carrying the most substance.
    const comps = [...groups.values()]
      .map(members => ({ members, volume: members.reduce((s, m) => s + m.volume, 0) }))
      .sort((a, b) => b.volume - a.volume);
    const body = comps[0];
    const boxOf = (members) => {
      const b = new THREE.Box3();
      for (const m of members) b.union(m.world);
      return b;
    };
    const bodyCentre = boxOf(body.members).getCenter(new THREE.Vector3());

    let moved = false;
    for (const comp of comps.slice(1)) {
      if (comp.members.every(m => m.moving)) continue;
      // A pair of fists, claws or bracers is two halves, not a loose part.
      const centre = boxOf(comp.members).getCenter(new THREE.Vector3());
      if (Math.abs(centre.x) > diag * 0.02 &&
          Math.abs(centre.x + bodyCentre.x) < diag * 0.06 &&
          Math.abs(centre.y - bodyCentre.y) < diag * 0.06 &&
          Math.abs(centre.z - bodyCentre.z) < diag * 0.06) continue;

      const move = this._weldOffset(comp.members, body.members, diag);
      if (!move) continue;
      for (const m of comp.members) this._translateWorld(m.mesh, move);
      moved = true;
    }
    if (moved) model.updateMatrixWorld(true);
    return moved;
  },

  /**
   * The smallest translation that puts a component back in contact with the
   * body. A part that already lines up with something on two axes only has to
   * close the third, which is what nearly every one of these is: a head at the
   * wrong height, a grip at the wrong depth. Anything else is carried straight
   * to its nearest neighbour.
   */
  _weldOffset(members, body, diag) {
    // How far this piece may be carried. Never more than WELD_MAX of the
    // weapon, and never much further than the piece is big: a whole head that
    // sits an inch too high is an error, a bead carried across the model to the
    // far end is a design being demolished.
    const own = new THREE.Box3();
    for (const m of members) own.union(m.world);
    const limit = Math.min(
      diag * this.WELD_MAX,
      Math.max(diag * 0.04, own.getSize(new THREE.Vector3()).length() * 1.2));
    let best = null;
    let bestCost = Infinity;
    let nearest = null;
    let nearestCost = Infinity;

    for (const m of members) {
      for (const b of body) {
        const a = m.world, o = b.world;
        const gaps = this._weldAxisGaps(a, o);
        const dir = [
          a.min.x > o.max.x ? -1 : 1,
          a.min.y > o.max.y ? -1 : 1,
          a.min.z > o.max.z ? -1 : 1
        ];
        // Straight move: close the one axis that keeps them apart.
        for (let k = 0; k < 3; k++) {
          if (gaps[k] <= 0) continue;
          if (gaps[(k + 1) % 3] > 0 || gaps[(k + 2) % 3] > 0) continue;
          if (gaps[k] < bestCost) {
            bestCost = gaps[k];
            best = new THREE.Vector3(
              k === 0 ? dir[0] * gaps[0] : 0,
              k === 1 ? dir[1] * gaps[1] : 0,
              k === 2 ? dir[2] * gaps[2] : 0);
          }
        }
        const diagCost = Math.hypot(gaps[0], gaps[1], gaps[2]);
        if (diagCost > 0 && diagCost < nearestCost) {
          nearestCost = diagCost;
          nearest = new THREE.Vector3(dir[0] * gaps[0], dir[1] * gaps[1], dir[2] * gaps[2]);
        }
      }
    }
    let move = best && bestCost <= limit ? best
      : (nearest && nearestCost <= limit ? nearest : null);

    // Boxes that overlap are not surfaces that touch: a rotated part's box
    // swallows the space around it, so a fork can sit inside the box of the
    // handle it is nowhere near. When that is what happened, carry the part
    // along the line between the two nearest points instead.
    if (!move) {
      let gap = Infinity;
      let from = null;
      let to = null;
      for (const m of members) {
        for (const b of body) {
          for (const p of m.pts) {
            const d = this._weldPointGap(b, p);
            if (d < gap) { gap = d; from = p; to = b; }
          }
        }
      }
      if (!from || gap > limit || gap <= diag * this.WELD_TOUCH) return null;
      // The nearest point of the body's box, back in world space.
      const q = from.clone().applyMatrix4(to.inv).clamp(to.local.min, to.local.max)
        .applyMatrix4(to.mesh.matrixWorld);
      move = q.sub(from);
      if (move.lengthSq() === 0) return null;
    }
    if (!move) return null;
    // Overlap very slightly so the join reads as one solid thing.
    return move.multiplyScalar(1 + diag * 0.004 / (move.length() || 1));
  },

  /** Moves a mesh by a world-space offset, whatever it is parented to. */
  _translateWorld(mesh, offset) {
    const parent = mesh.parent;
    if (!parent) { mesh.position.add(offset); return; }
    const local = offset.clone().applyMatrix4(
      new THREE.Matrix4().extractRotation(parent.matrixWorld).transpose());
    mesh.position.add(local);
    mesh.updateMatrixWorld(true);
  },

  finish(model, weapon) {
    if (!model || !weapon) return model;
    // A sheathed blade is deliberately buried inside the shaft it hides in, so
    // it has to be declared before the welder decides it is a part that came
    // out in the wrong place.
    this.prepareCane(model);
    // Same reason one rack over: a string is drawn to hang clear of its own
    // limbs and an arrow lies off the riser, so both read as parts that came
    // out in the wrong place. Declaring them first keeps the welder off them,
    // and tickBow poses them from where the builder put them.
    if (weapon.wtypeId === 7 || this.isCrossbow(weapon, model)) this.prepareBow(model, weapon);
    // Pull anything that came out floating back onto the weapon, before the
    // gun parts are tagged (prepareGun measures the muzzle off the geometry).
    this.weldLooseParts(model);
    // Weapon type 9 is the firearm rack, but a thing that fires is not always
    // filed as one: the crowd-control devices (663-665) declare no weapon type
    // at all. A model that tagged its own trigger and muzzle is asking to be
    // treated as a gun, so take it at its word. Note the asymmetry: an
    // untagged type-9 weapon still gets a synthesised muzzle from its
    // geometry, while an untagged non-gun is left alone.
    if (weapon.wtypeId === 9 || this.declaresGunParts(model)) this.prepareGun(model, weapon);
    if (this.VARLENIA_IDS.indexOf(this.dispatchIdFor(weapon)) !== -1) this.applyGoldFinish(model);
    return model;
  },

  /** Whether any part of the model carries a userData.gun tag. */
  declaresGunParts(model) {
    if (!model) return false;
    let found = false;
    model.traverse((obj) => {
      if (!found && obj.userData && obj.userData.gun) found = true;
    });
    return found;
  },

  // ============================================================
  // Firearms
  // ============================================================
  // A gun is the one weapon whose model has to DO something when it is used:
  // the trigger goes back, the action cycles, a case comes out and the muzzle
  // lights up. Builders declare which part is which by tagging it:
  //
  //   userData.gun = 'trigger' | 'hammer' | 'slide' | 'bolt' | 'cylinder'
  //                | 'charging' | 'magazine' | 'muzzle' | 'shell'
  //
  // Anything tagged is automatically kept out of the static mesh merge and
  // resolved per instance, so a cached model still animates. The muzzle is
  // found from the geometry when no part claims it, which is what gives every
  // gun in the database a flash without touching its builder.

  // Recoil and cycling profile per class of firearm. `rise` is muzzle climb in
  // degrees, `push` how far back it travels as a share of screen height,
  // `shots` how many rounds one attack puts out, `cycle` how the action moves.
  GUN_CLASSES: {
    pistol: { rise: 1.0, push: 1.0, shots: 1, rate: 0, cycle: 'slide', flash: 0.9, dur: 1.0 },
    revolver: { rise: 1.25, push: 1.1, shots: 1, rate: 0, cycle: 'cylinder', flash: 1.15, dur: 1.05 },
    smg: { rise: 0.7, push: 0.65, shots: 4, rate: 70, cycle: 'bolt', flash: 0.75, dur: 1.2 },
    rifle: { rise: 1.15, push: 1.25, shots: 1, rate: 0, cycle: 'bolt', flash: 1.1, dur: 1.1 },
    sniper: { rise: 1.5, push: 1.7, shots: 1, rate: 0, cycle: 'bolt', flash: 1.35, dur: 1.5 },
    shotgun: { rise: 1.9, push: 1.6, shots: 1, rate: 0, cycle: 'pump', flash: 1.6, dur: 1.35 },
    minigun: { rise: 0.5, push: 0.5, shots: 8, rate: 45, cycle: 'rotary', flash: 0.8, dur: 1.4 },
    launcher: { rise: 2.1, push: 1.9, shots: 1, rate: 0, cycle: 'none', flash: 2.0, dur: 1.6 },
    flamer: { rise: 0.35, push: 0.3, shots: 1, rate: 0, cycle: 'none', flash: 1.4, dur: 1.8 },
    energy: { rise: 0.55, push: 0.6, shots: 1, rate: 0, cycle: 'none', flash: 1.2, dur: 1.1 }
  },

  /** Which class of firearm a weapon is, from its subtype tag then its heft. */
  gunClassOf(weapon) {
    const note = weapon.note || '';
    if (/<RocketLauncher>/i.test(note)) return 'launcher';
    if (/<Minigun>/i.test(note)) return 'minigun';
    if (/<Flamethrower>/i.test(note)) return 'flamer';
    if (/<Shotgun>/i.test(note)) return 'shotgun';
    if (/<SniperRifle>/i.test(note)) return 'sniper';
    if (/<SMG>/i.test(note)) return 'smg';
    if (/<Railgun>|<ArmCannon>/i.test(note)) return 'energy';
    // Untagged: the weight tag separates a sidearm from a shoulder weapon.
    const g = this.weightOf(weapon);
    if (g <= 1800) return 'pistol';
    if (g <= 2600) return 'revolver';
    if (g >= 4800) return 'rifle';
    return 'pistol';
  },

  gunProfileFor(weapon) {
    return this.GUN_CLASSES[this.gunClassOf(weapon)] || this.GUN_CLASSES.pistol;
  },

  /**
   * Fits a gun model out for firing: finds the muzzle, hangs a flash rig off
   * it, and marks every declared moving part so the mesh merge leaves it
   * alone. Runs once per build, before the merge.
   */
  prepareGun(model, weapon) {
    if (!model || typeof THREE === 'undefined') return model;

    // Declared parts must survive the static merge.
    let muzzleAnchor = null;
    model.traverse((obj) => {
      const tag = obj.userData && obj.userData.gun;
      if (!tag) return;
      obj.userData.dynamic = true;
      if (tag === 'muzzle') muzzleAnchor = obj;
    });

    // No part claimed the muzzle: take it off the geometry, but only for a
    // real firearm. A crossbow declares a trigger and a nut because those turn
    // when it looses, not because it has a barrel, and inventing one would
    // light a muzzle flash on a weapon that has no powder in it. Anything else
    // that genuinely fires says so by tagging its own muzzle.
    if (!muzzleAnchor && weapon && weapon.wtypeId !== 9) return model;

    // A gun is modelled barrel-forward along +Z, so the muzzle is the front
    // face of whichever mesh reaches furthest that way.
    if (!muzzleAnchor) {
      model.updateMatrixWorld(true);
      let best = null, bestZ = -Infinity;
      const box = new THREE.Box3();
      model.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;
        box.setFromObject(obj);
        if (box.max.z > bestZ) { bestZ = box.max.z; best = box.clone(); }
      });
      if (!best) return model;
      const c = best.getCenter(new THREE.Vector3());
      muzzleAnchor = new THREE.Group();
      muzzleAnchor.position.set(c.x, c.y, best.max.z);
      muzzleAnchor.userData.gun = 'muzzle';
      muzzleAnchor.userData.dynamic = true;
      model.add(muzzleAnchor);
    }

    muzzleAnchor.add(this.buildMuzzleFlash(this.gunClassOf(weapon)));
    this.synthesiseTrigger(model);
    return model;
  },

  /**
   * Gives a gun whose builder declared no trigger one anyway, so every firearm
   * in the database has a finger-operated part. The grip is the lowest thing
   * hanging off the receiver (the barrel and stock run fore and aft of it), so
   * the trigger goes just above and ahead of whatever that is.
   */
  synthesiseTrigger(model) {
    let hasTrigger = false;
    model.traverse(o => { if (o.userData && o.userData.gun === 'trigger') hasTrigger = true; });
    if (hasTrigger) return;

    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    let grip = null, gripY = Infinity, gripBox = null;
    model.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      box.setFromObject(obj);
      box.getCenter(centre);
      if (Math.abs(centre.z) > 0.12) return;        // out at the muzzle or the butt
      if (centre.y < gripY) { gripY = centre.y; grip = obj; gripBox = box.clone(); }
    });
    if (!grip) return;

    const mat = Array.isArray(grip.material) ? grip.material[0] : grip.material;
    const metal = mat ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0x8A8F95, roughness: 0.35, metalness: 0.9 });
    const c = gripBox.getCenter(new THREE.Vector3());

    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.006), metal);
    trigger.position.set(c.x, gripBox.max.y - 0.014, gripBox.max.z + 0.012);
    trigger.userData.gun = 'trigger';
    trigger.userData.dynamic = true;
    model.add(trigger);

    const guard = new THREE.Mesh(
      new THREE.TorusGeometry(0.019, 0.004, this.seg(5, 4), this.seg(12, 7), Math.PI * 1.1), metal);
    guard.position.set(c.x, gripBox.max.y - 0.018, gripBox.max.z + 0.01);
    guard.rotation.set(0, Math.PI / 2, -0.35);
    model.add(guard);
    return model;
  },

  /**
   * The flash itself: a hot core, a four-point star and a cone of burning gas,
   * all emissive and all hidden until a shot is fired.
   */
  buildMuzzleFlash(gunClass) {
    const flash = new THREE.Group();
    flash.userData.gun = 'flash';
    flash.userData.dynamic = true;
    flash.visible = false;

    const hot = new THREE.Color(gunClass === 'energy' ? 0x9CE4FF : (gunClass === 'flamer' ? 0xFF8A1A : 0xFFF2C0));
    const rim = new THREE.Color(gunClass === 'energy' ? 0x3BA7FF : (gunClass === 'flamer' ? 0xFF3D00 : 0xFFA327));
    const hotMat = new THREE.MeshBasicMaterial({ color: hot, transparent: true, opacity: 0.95, depthWrite: false });
    const rimMat = new THREE.MeshBasicMaterial({ color: rim, transparent: true, opacity: 0.75, depthWrite: false });

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(8, 5), this.seg(6, 4)), hotMat);
    core.userData.flashPart = 'core';
    flash.add(core);

    // The star: two crossed quads, so it reads from any angle without a
    // billboard and without a texture.
    for (let i = 0; i < 2; i++) {
      const petal = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.012), rimMat);
      petal.rotation.z = i * Math.PI / 2;
      petal.userData.flashPart = 'star';
      flash.add(petal);
    }
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, this.seg(7, 5), 1, true), rimMat);
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 0.035;
    cone.userData.flashPart = 'cone';
    flash.add(cone);

    return flash;
  },

  /** Resolves the tagged parts of this instance (clone-safe: not in userData). */
  gunPartsOf(model) {
    if (model._gunParts) return model._gunParts;
    const parts = { flash: null, flashBits: [] };
    model.traverse((obj) => {
      const tag = obj.userData && obj.userData.gun;
      if (!tag) return;
      if (tag === 'flash') {
        parts.flash = obj;
        obj.traverse(b => { if (b.userData && b.userData.flashPart) parts.flashBits.push(b); });
      } else if (!parts[tag]) {
        parts[tag] = obj;
        obj.userData._gunRest = {
          x: obj.position.x, y: obj.position.y, z: obj.position.z,
          rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z
        };
      }
    });
    model._gunParts = parts;
    return parts;
  },

  /** Starts a firing sequence. Called when a firing animation is played. */
  beginGunFire(model, weapon) {
    if (!model) return;
    const profile = this.gunProfileFor(weapon);
    const m = this.weaponMetrics(weapon, model);
    const shots = [];
    for (let i = 0; i < profile.shots; i++) shots.push(i * (profile.rate || 0));
    model._gunFire = {
      elapsed: 0,
      shots: shots,
      next: 0,
      profile: profile,
      // A heavy action takes longer to cycle than a light one.
      cycleMs: 90 + m.heft * 130,
      flashUntil: -1,
      seed: Math.random() * 6.28
    };
  },

  /**
   * Drives the moving parts of a firing gun. Cheap when nothing is firing: a
   * single property check.
   */
  tickGun(model, dtMs) {
    const fire = model && model._gunFire;
    if (!fire) return;
    const parts = this.gunPartsOf(model);
    fire.elapsed += dtMs;

    // Fire each round of the burst as its moment comes round.
    while (fire.next < fire.shots.length && fire.elapsed >= fire.shots[fire.next]) {
      fire.next++;
      fire.flashUntil = fire.elapsed + 55;
      fire.cycleFrom = fire.elapsed;
      if (parts.cylinder) fire.cylinderTo = (fire.cylinderTo || 0) + Math.PI / 3;
    }

    // ── Muzzle flash ────────────────────────────────────────────────────────
    if (parts.flash) {
      const lit = fire.elapsed < fire.flashUntil;
      parts.flash.visible = lit;
      if (lit) {
        const k = Math.max(0, (fire.flashUntil - fire.elapsed) / 55);
        const s = (0.55 + k * 0.75) * fire.profile.flash;
        parts.flash.scale.set(s, s, s);
        parts.flash.rotation.z = fire.seed + fire.next * 1.7;
        for (const bit of parts.flashBits) {
          if (bit.material) bit.material.opacity = Math.min(1, k * 1.2);
          if (bit.userData.flashPart === 'star') bit.scale.set(0.6 + k * 0.9, 1, 1);
        }
      }
    }

    // ── Trigger, hammer, action ─────────────────────────────────────────────
    const sinceShot = fire.cycleFrom === undefined ? Infinity : fire.elapsed - fire.cycleFrom;
    const cyc = Math.max(0, Math.min(1, sinceShot / fire.cycleMs));   // 0 at the shot, 1 when back in battery
    const back = cyc < 0.45 ? cyc / 0.45 : 1 - (cyc - 0.45) / 0.55;   // out and back

    if (parts.trigger) {
      const r = parts.trigger.userData._gunRest;
      // Squeezed just before the shot, released as the action cycles.
      const squeeze = sinceShot === Infinity ? Math.min(1, fire.elapsed / 60) : 1 - cyc;
      parts.trigger.rotation.x = r.rx + squeeze * 0.5;
      parts.trigger.position.z = r.z + squeeze * 0.006;
    }
    if (parts.hammer) {
      // Cocked back with the action, dropped on the round.
      const r = parts.hammer.userData._gunRest;
      parts.hammer.rotation.x = r.rx - back * 1.1;
    }
    const slider = parts.slide || parts.bolt || parts.charging;
    if (slider) {
      const r = slider.userData._gunRest;
      slider.position.z = r.z - back * (parts.slide ? 0.055 : 0.045);
    }
    if (parts.cylinder && fire.cylinderTo !== undefined) {
      const r = parts.cylinder.userData._gunRest;
      const from = fire.cylinderTo - Math.PI / 3;
      parts.cylinder.rotation.z = r.rz + from + (Math.PI / 3) * Math.min(1, cyc * 1.4);
    }
    if (parts.shell) {
      // The case leaves as the action opens and is gone by the time it shuts.
      const out = Math.max(0, Math.min(1, sinceShot / (fire.cycleMs * 1.6)));
      parts.shell.visible = out > 0.02 && out < 0.98;
      const r = parts.shell.userData._gunRest;
      parts.shell.position.set(r.x + out * 0.14, r.y + Math.sin(out * Math.PI) * 0.09 - out * out * 0.12, r.z - out * 0.05);
      parts.shell.rotation.z = out * 9;
    }

    // Done: put everything back and stop.
    const last = fire.shots[fire.shots.length - 1] || 0;
    if (fire.elapsed > last + fire.cycleMs * 1.8) {
      if (parts.flash) parts.flash.visible = false;
      if (parts.shell) parts.shell.visible = false;
      for (const key of ['trigger', 'hammer', 'slide', 'bolt', 'charging']) {
        const p = parts[key];
        if (!p) continue;
        const r = p.userData._gunRest;
        p.position.set(r.x, r.y, r.z);
        p.rotation.x = r.rx;
      }
      model._gunFire = null;
    }
  },

  // ============================================================
  // Sword canes
  // ============================================================
  // A cane that hides a blade has one moving part and the whole weapon reads
  // on it, so it is driven the way a gun's action is rather than left to the
  // ambient tickModelParts loop: the blade only ever moves while the weapon is
  // being swung, and it has to be back in the shaft by the time the clip ends.
  //
  //   userData.cane = 'blade'   slides along +Y by userData.caneTravel
  //   userData.cane = 'flash'   shown only while the blade is travelling
  //
  // The windows are fractions of the attack clip's own duration, and they are
  // the same timeline MOTIONS.swordcane is written against.
  CANE_DRAW: { out: 0.16, outEnd: 0.30, in: 0.80, inEnd: 0.96 },
  CANE_TRAVEL: 0.4,

  /**
   * Marks the tagged parts so they survive welding and the static merge, the
   * way prepareGun does for a firearm's action. Runs once per build.
   */
  prepareCane(model) {
    if (!model) return model;
    model.traverse((obj) => {
      if (obj.userData && obj.userData.cane) obj.userData.dynamic = true;
    });
    return model;
  },

  /** Resolves the tagged parts of this instance. */
  canePartsOf(model) {
    if (model._caneParts) return model._caneParts;
    const parts = {};
    model.traverse((obj) => {
      const tag = obj.userData && obj.userData.cane;
      if (!tag || parts[tag]) return;
      parts[tag] = obj;
      obj.userData._caneRest = obj.position.y;
    });
    model._caneParts = parts;
    return parts;
  },

  /** Starts a draw. Called when a sword-cane animation is played. */
  beginCaneDraw(model, durationMs) {
    if (!model) return;
    if (!this.canePartsOf(model).blade) return;
    model._caneDraw = { elapsed: 0, duration: Math.max(1, durationMs || 700) };
  },

  /**
   * Drives the blade out of the shaft and back into it. Cheap when nothing is
   * being drawn: a single property check.
   */
  tickCane(model, dtMs) {
    const draw = model && model._caneDraw;
    if (!draw) return;
    const parts = this.canePartsOf(model);
    const blade = parts.blade;
    if (!blade) { model._caneDraw = null; return; }

    draw.elapsed += dtMs;
    const t = draw.elapsed / draw.duration;
    const w = this.CANE_DRAW;
    // Out fast and hard, back in unhurried: a spring, not a screw.
    let k;
    if (t <= w.out) k = 0;
    else if (t < w.outEnd) k = 1 - Math.pow(1 - (t - w.out) / (w.outEnd - w.out), 3);
    else if (t <= w.in) k = 1;
    else if (t < w.inEnd) { const u = (t - w.in) / (w.inEnd - w.in); k = 1 - u * u; }
    else k = 0;

    blade.position.y = blade.userData._caneRest + k * (blade.userData.caneTravel || this.CANE_TRAVEL);

    if (parts.flash) {
      const lit = t > w.out && t < w.outEnd;
      parts.flash.visible = lit;
      if (lit) {
        const glow = Math.sin(k * Math.PI);
        const s = 0.5 + glow;
        parts.flash.scale.set(s, s, s);
        if (parts.flash.material) parts.flash.material.opacity = glow;
      }
    }

    if (t >= 1) {
      blade.position.y = blade.userData._caneRest;
      if (parts.flash) parts.flash.visible = false;
      model._caneDraw = null;
    }
  },

  // ============================================================
  // Bows and crossbows
  // ============================================================
  // A bow reads entirely on a part that moves. Nothing about a bow sliding
  // across the screen says "loosed" the way a string coming back to the cheek,
  // limbs bending with it and the whole thing snapping flat does, so the shot
  // is driven the way a gun's action is rather than being left to the whole
  // model's keyframes.
  //
  // The overlay camera is orthographic, so an arrow travelling down +Z moves no
  // pixels by itself. What sells the flight is that a bow is AIMED: the resting
  // rotation keeps AIM_SCREEN_SHARE of its length across the screen, so most of
  // that travel does land on screen, and shrinking the arrow spends the rest of
  // it going away from the camera.
  //
  // Builders declare the moving parts by tagging them:
  //
  //   userData.bow = 'stringTop' | 'stringBot'  half of the string, running from
  //        a limb tip to the nocking point. Carries bowTip, bowNock and bowLen,
  //        plus bowRelease on a crossbow (where the string rests forward of the
  //        nut it is spanned back onto). _bowString builds and tags them.
  //   userData.bow = 'limbTop' | 'limbBot'      a limb group flexed by the draw
  //   userData.bow = 'limbLeft' | 'limbRight'   a crossbow prod arm, same job
  //   userData.bow = 'arrow'                    the arrow or bolt on the string
  //   userData.bow = 'nock'                     serving or glow riding the nock
  //   model.userData.crossbow = true            shot with a trigger, not drawn
  //
  // Everything tagged is kept out of the static mesh merge. A model that tags
  // nothing still gets a shot: prepareBow finds the nocked arrow off the
  // geometry, or builds one, the way prepareGun synthesises a muzzle.

  // Windows of the attack clip, as fractions of its own duration. MOTIONS.draw
  // and MOTIONS.crossbow are written against these same numbers, so the hand
  // kicks on the frame the string goes.
  BOW_SHOT: { rise: 0.06, full: 0.34, loose: 0.54, again: 0.84 },
  BOLT_SHOT: { loose: 0.36, again: 0.7 },
  // How far the string comes back, as a share of the bow's tip-to-tip span,
  // and how far the arrow travels before it is out of the frame.
  BOW_PULL: 0.3,
  BOW_FLIGHT: 3.6,

  /**
   * The string, as the two halves it bends into: a straight line from tip to
   * tip is only what a string looks like when nothing is pulling on it.
   * @param top,bot {THREE.Vector3} limb tips
   * @param opts { r, nock, release, pulse }
   * @returns {THREE.Vector3} the nocking point the halves meet at
   */
  _bowString(group, mat, top, bot, opts) {
    const o = opts || {};
    const r = o.r || 0.0018;
    const nock = o.nock ? o.nock.clone() : top.clone().add(bot).multiplyScalar(0.5);
    const up = new THREE.Vector3(0, 1, 0);
    const pairs = [[top, 'stringTop'], [bot, 'stringBot']];
    for (const pair of pairs) {
      const tip = pair[0];
      const d = nock.clone().sub(tip);
      const len = Math.max(1e-4, d.length());
      const half = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, len, this.seg(5, 3)), mat);
      half.position.copy(tip).add(nock).multiplyScalar(0.5);
      half.quaternion.setFromUnitVectors(up, d.normalize());
      half.userData.bow = pair[1];
      half.userData.bowTip = { x: tip.x, y: tip.y, z: tip.z };
      half.userData.bowNock = { x: nock.x, y: nock.y, z: nock.z };
      half.userData.bowLen = len;
      if (o.release) half.userData.bowRelease = { x: o.release.x, y: o.release.y, z: o.release.z };
      if (o.pulse) half.userData.pulse = o.pulse;
      group.add(half);
    }
    return nock;
  },

  /**
   * Fits a bow out for shooting: keeps every declared part out of the mesh
   * merge, and makes sure there is an arrow on the string to loose. Runs once
   * per build, before the merge.
   */
  prepareBow(model, weapon) {
    if (!model || typeof THREE === 'undefined') return model;
    let arrow = null;
    model.traverse((obj) => {
      const tag = obj.userData && obj.userData.bow;
      if (!tag) return;
      obj.userData.dynamic = true;
      if (tag === 'arrow') arrow = obj;
    });
    if (!arrow) arrow = this._gatherNockedArrow(model);
    if (!arrow) arrow = this._buildNockedArrow(model, weapon);
    if (arrow) {
      arrow.userData.bow = 'arrow';
      arrow.userData.dynamic = true;
    }
    this._adoptLimbFurniture(model);
    // Remembered on the weapon itself, the way its whip and flail flags are:
    // how a bow is posed and how big it is drawn are asked long before and
    // long after the model that knew it was a crossbow is to hand.
    if (weapon && this.isCrossbow(weapon, model)) weapon.isCrossbow = true;
    return model;
  },

  /**
   * Hands everything sitting out at the limb tips over to the limb it belongs
   * to: nocks, bindings, leaves, siyahs, the ice growing off a frozen bow.
   * Builders hang those on the model rather than on the limb, and a limb that
   * bends away from its own tip cap is worse than one that does not bend.
   * The share of the limb below which a part is riser furniture, not limb
   * furniture, is deliberately generous: the riser sits at the middle.
   */
  _adoptLimbFurniture(model) {
    const parts = this.bowPartsOf(model);
    const top = parts.limbTop, bot = parts.limbBot;
    if (!top || !bot) return;
    const tip = parts.stringTop && parts.stringTop.userData.bowTip;
    const reach = tip ? Math.abs(tip.y) : 0;
    if (!(reach > 0)) return;
    const edge = reach * 0.55;
    for (const child of model.children.slice()) {
      if (!child.isMesh || (child.userData && child.userData.bow)) continue;
      if (Math.abs(child.position.y) < edge) continue;
      const limb = child.position.y > 0 ? top : bot;
      if (limb.attach) limb.attach(child); else limb.add(child);
    }
    model._bowParts = null;
  },

  /**
   * The arrow already on the string, taken off the geometry: every builder
   * draws it the same way, as a shaft lying along the bow's line of fire with
   * its head and fletching threaded on the same axis. They are collected into
   * one group so the head does not stay behind when the shaft leaves.
   */
  _gatherNockedArrow(model) {
    const shafts = [];
    // An arrow starts ON the string. Without that test the longest thing
    // pointing down range wins, and a target bow shoots its own stabiliser.
    const parts = this.bowPartsOf(model);
    const nockZ = (parts.stringTop || parts.stringBot) ? this._bowNockRest(parts).z : null;
    model.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || !obj.geometry.parameters) return;
      const type = obj.geometry.type || '';
      if (type.indexOf('Cylinder') === -1 && type.indexOf('Cone') === -1) return;
      const p = obj.geometry.parameters;
      const radius = Math.max(p.radiusTop || 0, p.radiusBottom || 0, p.radius || 0);
      if (radius > 0.02) return;
      // Lying along the line of fire rather than across the bow: this is what
      // separates an arrow from the grip, the wraps and the limbs.
      if (Math.abs(Math.cos(obj.rotation.x)) > 0.25) return;
      if (Math.abs(obj.position.x) > 0.03 || obj.position.z < -0.06) return;
      const len = p.height || 0;
      if (nockZ !== null && Math.abs(obj.position.z - len * 0.5 - nockZ) > 0.12) return;
      shafts.push({ obj: obj, len: len });
    });
    if (!shafts.length) return null;
    let main = shafts[0];
    for (const s of shafts) if (s.len > main.len) main = s;
    if (main.len < 0.08) return null;

    const group = new THREE.Group();
    group.userData.bow = 'arrow';
    group.userData.dynamic = true;
    model.add(group);
    const zMin = main.obj.position.z - main.len * 0.5 - 0.06;
    const zMax = main.obj.position.z + main.len * 0.5 + 0.06;
    for (const s of shafts) {
      if (s !== main) {
        if (s.obj.position.z < zMin || s.obj.position.z > zMax) continue;
        if (Math.abs(s.obj.position.y - main.obj.position.y) > 0.03) continue;
        if (Math.abs(s.obj.position.x - main.obj.position.x) > 0.02) continue;
      }
      if (group.attach) group.attach(s.obj); else group.add(s.obj);
    }
    return group;
  },

  /** An arrow for a bow that was drawn without one. */
  _buildNockedArrow(model, weapon) {
    // A crossbow with nothing in the groove is empty on purpose as often as by
    // omission, and its own frame draws a bolt when it wants one.
    if (this.isCrossbow(weapon, model)) return null;
    const parts = this.bowPartsOf(model);
    const span = this._bowSpan(model, parts);
    const nock = this._bowNockRest(parts);
    const len = span * 0.72;
    const shaftMat = this._mat(0x9A7B4F, { roughness: 0.85, metalness: 0.04 });
    const headMat = this._mat(0x9AA0A6, { roughness: 0.4, metalness: 0.8 });
    const group = new THREE.Group();
    group.userData.bow = 'arrow';
    group.userData.dynamic = true;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, len, this.seg(7, 5)), shaftMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(nock.x, nock.y, nock.z + len * 0.5);
    group.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, this.seg(7, 5)), headMat);
    head.rotation.x = Math.PI / 2;
    head.position.set(nock.x, nock.y, nock.z + len + 0.012);
    group.add(head);
    for (let i = 0; i < (this.isLowDetail() ? 2 : 3); i++) {
      const vane = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.026, this.seg(5, 3)), shaftMat);
      vane.rotation.x = -Math.PI / 2;
      vane.rotation.z = (i / 3) * Math.PI * 2;
      vane.position.set(nock.x, nock.y, nock.z + 0.026);
      group.add(vane);
    }
    model.add(group);
    // The parts were resolved before the arrow existed, so the cache has to go.
    model._bowParts = null;
    return group;
  },

  /** Whether this weapon is spanned and shot rather than drawn and loosed. */
  isCrossbow(weapon, model) {
    if (weapon && weapon.isCrossbow) return true;
    if (model && model.userData && model.userData.crossbow) return true;
    return /<Crossbow>/i.test((weapon && weapon.note) || '');
  },

  /** Resolves the tagged parts of this instance (clone-safe: not in userData). */
  bowPartsOf(model) {
    if (model._bowParts) return model._bowParts;
    const parts = {};
    model.traverse((obj) => {
      const tag = obj.userData && obj.userData.bow;
      if (!tag || parts[tag]) return;
      parts[tag] = obj;
      obj.userData._bowRest = {
        x: obj.position.x, y: obj.position.y, z: obj.position.z,
        rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z
      };
    });
    model._bowParts = parts;
    return parts;
  },

  /** Tip to tip, in model units: everything the shot is measured against. */
  _bowSpan(model, parts) {
    const a = parts.stringTop && parts.stringTop.userData.bowTip;
    const b = parts.stringBot && parts.stringBot.userData.bowTip;
    if (a && b) return Math.max(0.05, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    return model.userData._fitExtent || 0.55;
  },

  /** Where the nocking point sits with nothing pulling on the string. */
  _bowNockRest(parts) {
    const half = parts.stringTop || parts.stringBot;
    const n = half && (half.userData.bowRelease || half.userData.bowNock);
    return n ? { x: n.x, y: n.y, z: n.z } : { x: 0, y: 0.01, z: 0 };
  },

  /**
   * Starts a shot. Called with the attack clip's own duration so the string
   * goes on the frame the hand kicks.
   */
  beginBowShot(model, weapon, durationMs) {
    if (!model) return;
    const parts = this.bowPartsOf(model);
    const crossbow = this.isCrossbow(weapon, model);
    const span = this._bowSpan(model, parts);
    model._bowShot = {
      elapsed: 0,
      duration: Math.max(1, durationMs || 600),
      crossbow: crossbow,
      // A crossbow is carried already spanned, so nothing draws back: its
      // string and its bolt only ever travel forward, on the loose.
      pull: crossbow ? 0 : span * this.BOW_PULL,
      flight: span * this.BOW_FLIGHT,
      flex: crossbow ? 0.09 : 0.17
    };
  },

  /**
   * Drives the string, the limbs and the arrow of a bow being shot. Cheap when
   * nothing is being shot: a single property check.
   */
  tickBow(model, dtMs) {
    const shot = model && model._bowShot;
    if (!shot) return;
    const parts = this.bowPartsOf(model);
    shot.elapsed += dtMs;
    const t = Math.min(1, shot.elapsed / shot.duration);
    const loose = shot.crossbow ? this.BOLT_SHOT.loose : this.BOW_SHOT.loose;

    // How far back the string is held, 1 at full draw. A crossbow starts there
    // and stays there: being spanned is its resting state.
    let k;
    if (shot.crossbow) k = 1;
    else if (t <= this.BOW_SHOT.rise) k = 0;
    else if (t < this.BOW_SHOT.full) {
      const u = (t - this.BOW_SHOT.rise) / (this.BOW_SHOT.full - this.BOW_SHOT.rise);
      k = u * u * (3 - 2 * u);
    } else k = 1;

    let flown = 0;
    if (t > loose) {
      const u = (t - loose) / Math.max(1e-4, 1 - loose);
      // The string does not stop where it rests: it runs past it and rings
      // down, which is the whole sound of the shot made visible.
      k *= Math.cos(u * 17) * Math.exp(-u * 6.5);
      flown = 1 - Math.pow(1 - Math.min(1, u / 0.3), 2);
    }

    // Nothing is left standing empty. Over the tail of the clip another arrow
    // comes onto the string, and a crossbow is spanned back onto its nut,
    // rather than the whole weapon snapping back into shape on the last frame.
    const again = shot.crossbow ? this.BOLT_SHOT.again : this.BOW_SHOT.again;
    if (t > again) {
      let r = Math.min(1, (t - again) / Math.max(1e-4, 0.97 - again));
      r = r * r * (3 - 2 * r);
      if (shot.crossbow) k = k * (1 - r) + r;
      if (r >= 0.5) flown = 0;
    }

    this._poseBowString(parts.stringTop, k, shot);
    this._poseBowString(parts.stringBot, k, shot);

    // Everything except the string is posed relative to how the weapon was
    // BUILT, and a crossbow is built spanned: at rest its k is already 1, so
    // its limbs and its bolt only move once the string starts forward.
    const kk = shot.crossbow ? k - 1 : k;
    const flex = shot.flex * kk;
    this._flexLimb(parts.limbTop, 'x', -flex);
    this._flexLimb(parts.limbBot, 'x', flex);
    this._flexLimb(parts.limbLeft, 'y', flex);
    this._flexLimb(parts.limbRight, 'y', -flex);

    if (parts.nock) {
      const r = parts.nock.userData._bowRest;
      parts.nock.position.z = r.z - shot.pull * kk;
    }

    if (parts.arrow) {
      const r = parts.arrow.userData._bowRest;
      // On a bow the arrow comes back with the string; on a crossbow it is
      // already lying in the groove and waits there for the nut to turn.
      parts.arrow.position.z = r.z - shot.pull * kk + shot.flight * flown;
      const s = 1 - flown * 0.4;
      parts.arrow.scale.set(s, s, s);
      parts.arrow.visible = flown < 0.82;
    }

    // A crossbow has an action as well as a string: the finger comes back and
    // the nut turns the bolt loose. Both are already tagged as gun parts by
    // whatever drew them, so they are read from there rather than tagged twice.
    if (shot.crossbow) {
      const gun = this.gunPartsOf(model);
      if (gun.trigger) {
        const r = gun.trigger.userData._gunRest;
        gun.trigger.rotation.x = r.rx + Math.min(1, t / loose) * 0.5;
      }
      if (gun.cylinder) {
        const r = gun.cylinder.userData._gunRest;
        gun.cylinder.rotation.z = r.rz + (t > loose ? Math.min(1, (t - loose) * 9) * 1.1 : 0);
      }
    }

    if (t >= 1) {
      this._restBowParts(model, parts, shot);
      model._bowShot = null;
    }
  },

  /** Bends one half of a string to a nocking point k of the way back. */
  _poseBowString(half, k, shot) {
    if (!half) return;
    const ud = half.userData;
    const tip = ud.bowTip;
    const rest = ud.bowRelease || ud.bowNock;
    if (!tip || !rest) return;
    // Where the string is held: a bow is pulled back off its rest, a crossbow
    // is spanned back onto its nut and rests forward of it.
    const back = ud.bowRelease ? ud.bowNock : { x: rest.x, y: rest.y, z: rest.z - shot.pull };
    const nx = rest.x + (back.x - rest.x) * k;
    const ny = rest.y + (back.y - rest.y) * k;
    const nz = rest.z + (back.z - rest.z) * k;
    const dx = nx - tip.x, dy = ny - tip.y, dz = nz - tip.z;
    const len = Math.max(1e-4, Math.hypot(dx, dy, dz));
    half.position.set((tip.x + nx) / 2, (tip.y + ny) / 2, (tip.z + nz) / 2);
    if (!this._bowUp) this._bowUp = new THREE.Vector3(0, 1, 0);
    if (!this._bowDir) this._bowDir = new THREE.Vector3();
    half.quaternion.setFromUnitVectors(this._bowUp, this._bowDir.set(dx / len, dy / len, dz / len));
    half.scale.y = len / (ud.bowLen || len);
  },

  /** Bends one limb about the grip, which is what moves its tip. */
  _flexLimb(limb, axis, amount) {
    if (!limb) return;
    limb.rotation[axis] = limb.userData._bowRest[axis === 'x' ? 'rx' : 'ry'] + amount;
  },

  /** Puts a bow back the way it was built. */
  _restBowParts(model, parts, shot) {
    for (const key of Object.keys(parts)) {
      const p = parts[key];
      const r = p.userData._bowRest;
      p.position.set(r.x, r.y, r.z);
      p.rotation.set(r.rx, r.ry, r.rz);
      p.scale.set(1, 1, 1);
      p.visible = true;
    }
    // The halves are posed rather than placed, so they are rebuilt at rest
    // instead of being trusted to the transform they were built with. A
    // crossbow rests spanned, which is the far end of the same travel.
    const rest = { pull: 0 };
    const k = shot && shot.crossbow ? 1 : 0;
    this._poseBowString(parts.stringTop, k, rest);
    this._poseBowString(parts.stringBot, k, rest);
    const gun = model._gunParts;
    if (gun) {
      for (const key of ['trigger', 'cylinder']) {
        const p = gun[key];
        if (!p) continue;
        const r = p.userData._gunRest;
        p.rotation.set(r.rx, r.ry, r.rz);
      }
    }
  },

  /**
   * Re-tints every material into gold while keeping the model's own light and
   * shade: the hue and saturation are replaced, the lightness the builder chose
   * is kept, so engraving, grooves and shadowed parts all still read. Emissive
   * parts keep their own colour, pulled halfway toward warm gold so a glow
   * still looks like a glow rather than a hole in the gilding.
   */
  applyGoldFinish(model) {
    if (typeof THREE === 'undefined') return model;
    const hsl = { h: 0, s: 0, l: 0 };
    const seen = new Set();
    model.traverse((obj) => {
      if (!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat || seen.has(mat) || !mat.color) continue;
        seen.add(mat);
        mat.color.getHSL(hsl);
        mat.color.setHSL(0.118, 0.62, Math.min(0.86, Math.max(0.2, hsl.l * 0.9 + 0.14)));
        if (mat.metalness !== undefined) mat.metalness = Math.max(mat.metalness, 0.85);
        if (mat.roughness !== undefined) mat.roughness = Math.min(mat.roughness, 0.34);
        if (mat.emissive && mat.emissiveIntensity > 0) {
          mat.emissive.lerp(new THREE.Color(0xFFD166), 0.5);
        }
      }
    });
    return model;
  },

  /**
   * Calls a builder by name. A family that failed to load costs only the
   * models it carried: the weapon falls back to its type's silhouette, and to
   * nothing at all if that is missing too, rather than throwing into the
   * battle scene.
   */
  build(name, weapon, rand) {
    if (typeof this[name] === 'function') return this[name](weapon, rand);
    if (!this._missingBuilders) this._missingBuilders = {};
    if (!this._missingBuilders[name]) {
      this._missingBuilders[name] = true;
      console.warn('[WeaponSystemProcedural] builder not loaded: ' + name);
    }
    const fallback = this.TYPE_MODELS[weapon.wtypeId || 1];
    if (fallback && fallback !== name && typeof this[fallback] === 'function') {
      return this[fallback](weapon, rand);
    }
    return null;
  },

  // Note tag -> builder, in priority order (a weapon carrying two tags gets
  // the first one listed). Kept as an array so the order is explicit.
  NOTE_MODELS: [
    [/<Mjolnir>/i, 'createMjolnirModel'],
    [/<FlySwatter>/i, 'createFlySwatterModel'],
    [/<WarFan>/i, 'createWarFanModel'],
    [/<Excalibur>/i, 'createExcaliburModel'],
    [/<DragonBlade>/i, 'createDragonBladeModel'],
    [/<MagicOrb>/i, 'createMagicOrbModel'],
    [/<FoamFinger>/i, 'createFoamFingerModel'],
    [/<Spatula>/i, 'createSpatulaModel'],
    [/<CelestialHammer>/i, 'createCelestialHammerModel'],
    [/<ChronosHammer>/i, 'createChronosHammerModel'],
    // Gun subtypes
    [/<RocketLauncher>/i, 'createRocketLauncherModel'],
    [/<Minigun>/i, 'createMinigunModel'],
    [/<Flamethrower>/i, 'createFlamethrowerModel'],
    [/<Shotgun>/i, 'createShotgunModel'],
    [/<SniperRifle>/i, 'createSniperRifleModel'],
    [/<SMG>/i, 'createSMGModel'],
    // Polearm / melee subtypes
    [/<Halberd>/i, 'createHalberdModel'],
    [/<Trident>/i, 'createTridentModel'],
    [/<Nunchaku>/i, 'createNunchakuModel'],
    // A stick that is a scabbard. The blade is a `cane`-tagged part, run out
    // of the shaft by tickCane on the HiddenBlade animation.
    [/<HiddenBlade>/i, 'createBastoneInfernaleModel'],
    // Ranged / thrown subtypes
    [/<Railgun>/i, 'createRailgunModel'],
    [/<ArmCannon>/i, 'createArmCannonModel'],
    [/<Crossbow>/i, 'createCrossbowModel'],
    [/<Boomerang>/i, 'createBoomerangModel'],
    [/<Chakram>/i, 'createChakramModel'],
    [/<DroneLauncher>/i, 'createDroneLauncherModel'],
    [/<Crown>/i, 'createCrownModel']
  ],

  // $dataSystem.weaponTypes id -> builder.
  TYPE_MODELS: {
    1: 'createLightModel',      2: 'createSwordModel',
    3: 'createHeavyModel',      4: 'createAxeModel',
    5: 'createWhipModel',       6: 'createStaffModel',
    7: 'createBowModel',        8: 'createProjectileModel',
    9: 'createGunModel',        10: 'createClawModel',
    11: 'createGloveModel',     12: 'createSpearModel'
  },

  getRandomColor(rand, palette) {
    return palette[Math.floor(rand() * palette.length)];
  },

  get bladeColors() { return [0xAAAAAA, 0xDDCC55, 0x111122, 0x444444, 0xCD7F32, 0x8B0000, 0x2E5B88, 0x3D8B7A, 0x6E4A8B, 0x228B22, 0xE5E5E5]; },
  get handleColors() { return [0x5C4033, 0x3D2314, 0x8B4513, 0x222222, 0x777777, 0x111111, 0x8F5C38, 0x4A2E1B, 0x2E1F11]; },
  get guardColors() { return [0xDDCC55, 0xCCCCCC, 0xCD7F32, 0x333333, 0xAA8822, 0x888899, 0x222233, 0xD4AF37, 0xC0C0C0, 0x8A9A86]; },
  get whipColors() { return [0x3A221D, 0x222222, 0x5C4033, 0x1A1A1A, 0x8B0000, 0xAA00FF, 0x00FFFF]; },
  get crystalColors() { return [0x00FFCC, 0xFF00FF, 0x00FFFF, 0xFFCC00, 0xFF3300, 0x33FF33, 0x9900FF, 0xFFFFFF, 0x0000FF, 0xFF0000]; },
  get emissionColors() { return [0x00FF99, 0xFF00AA, 0x00FFFF, 0xFFDD00, 0xFF1100, 0x55FF55, 0xAA00FF, 0xFFFFFF]; },
  get ribbonColors() { return [0xD90429, 0x2A9D8F, 0xE9C46A, 0xF4A261, 0xE76F51, 0x1D3557, 0x457B9D]; },

  // ============================================================
  // On-screen sizing
  // ============================================================
  // Procedural models are authored in "real" metres (a sword is ~0.9 units
  // long, a pistol ~0.3), so their on-screen size has to be derived rather
  // than guessed: the old fixed multipliers drew every weapon several times
  // taller than the screen. Each weapon type declares the share of the screen
  // height its widest visible dimension should cover.
  screenFractionFor(weapon) {
    if (!weapon) return 0.60;
    if (weapon.isWhip) return 0.74;
    if (weapon.isFlail) return 0.70;
    // An unarmed fist is measured with its forearm attached (Weapon3D_Unarmed
    // _uArm), so its widest extent is roughly 3-4x a bare hand's: fitted this
    // large, the fist itself lands at about the size a held Glove weapon
    // reads at while the forearm runs on past the bottom edge of the screen,
    // rather than a held weapon's grip simply floating at the anchor.
    if (weapon.unarmedArchetype) return 1.55;
    switch (weapon.wtypeId) {
      case 1:  return 0.46; // Light (dagger)
      case 2:  return 0.66; // Sword
      case 3:  return 0.72; // Heavy
      case 4:  return 0.70; // Axe
      case 5:  return 0.74; // Whip
      case 6:  return 0.84; // Staff
      // A bow is the tallest thing anyone carries, and it is held out at
      // arm's length rather than tucked in like a gun: drawn any smaller it
      // reads as a twig at the edge of the frame. A crossbow is a shoulder
      // weapon of ordinary size and keeps the old figure.
      case 7:  return weapon.isCrossbow ? 0.62 : 0.86;
      // Thrown weapons are small in the hand; a crossbow filed in the same
      // rack is not one of them.
      case 8:  return weapon.isCrossbow ? 0.62 : 0.34;
      case 9:  return 0.58; // Gun (first-person)
      case 10: return 0.42; // Claw
      case 11: return 0.40; // Glove
      case 12: return 0.84; // Spear
      default: return 0.60;
    }
  },

  // ============================================================
  // First-person pose
  // ============================================================
  // How a weapon sits in the battle view: its resting rotation, its nudge from
  // the shared weapon anchor, and the idle breathing sway. Sprite_3DWeapon
  // delegates to these rather than owning them, so anything that needs to
  // reproduce the battle pose outside a battle (the 3D Weapon Viewer in
  // tools/) gets the same numbers instead of a drifting copy.

  /** Resting rotation in degrees, or the authored <3DRotation> if there is one. */
  baseRotationFor(weapon) {
    if (weapon.model3dRotation) return weapon.model3dRotation;
    if (weapon.isWhip) return { x: 0, y: 0, z: -15 };
    if (weapon.isFlail) return { x: 0, y: 0, z: -10 };
    // An unarmed fist carries its own forearm (Weapon3D_Unarmed's _uArm) and
    // is meant to read as a raised guard rather than a grip held level, which
    // is what separates it from a held Glove weapon (boxing gloves, knuckle
    // dusters, ...) sharing the same wtypeId.
    if (weapon.unarmedArchetype) return { x: 12, y: -10, z: -8 };
    // A shield rests across the body with its face turned out, angled just
    // enough to read as a plate rather than an edge.
    if (weapon.shieldArmorId) return { x: -6, y: -22, z: 4 };
    switch (weapon.wtypeId || 1) {
      case 1: return { x: 0, y: 0, z: -20 };   // Light (dagger)
      case 2: return { x: 0, y: 0, z: -15 };   // Sword
      case 3: return { x: 0, y: 0, z: -25 };   // Heavy
      case 4: return { x: 0, y: 0, z: -20 };   // Axe
      case 5: return { x: 0, y: 0, z: -15 };   // Whip
      case 6: return { x: 0, y: 0, z: -10 };   // Staff
      // Thrown weapons point along +Z (kunai, dart) or lie in the X-Y plane
      // (shuriken); a partial tilt reads for both. A launcher in the same slot
      // (sling, blowgun, crossbow) is aimed instead, like every other weapon
      // that shoots something rather than being thrown itself.
      case 8: return this.isLauncher(weapon)
        ? this.aimRotationFor(-0.86, -0.5)
        : { x: 55, y: 0, z: -20 };
      // Bows and firearms alike are modelled shooting down +Z, so both rest
      // already levelled across the battlefield, up and to the left, and swing
      // from there onto whatever they are actually shooting at. A bow turned
      // any other way looses its arrow across the screen instead of into it.
      case 7:                                  // Bow
      case 9: return this.aimRotationFor(-0.86, -0.5);
      case 10: return { x: 0, y: 0, z: -15 };  // Claw
      case 11: return { x: 0, y: 0, z: 0 };    // Glove
      case 12: return { x: 0, y: 0, z: -15 };  // Spear
      default: return { x: 0, y: 0, z: -15 };
    }
  },

  // ============================================================
  // Aiming
  // ============================================================
  // How much of a gun's length stays on the screen when it is aimed. The
  // overlay camera is orthographic, so a barrel pointed dead at the enemy would
  // spend its whole length in depth and read as a black lump: keeping this
  // share of it across the screen is what makes the weapon legible as a gun
  // pointing away from the player.
  AIM_SCREEN_SHARE: 0.62,
  // Kept off the vertical so the weapon does not read as a flat cutout. Roll
  // turns the gun about its own barrel, so it never moves the muzzle.
  AIM_ROLL: -8,

  /**
   * The rotation that puts a weapon's muzzle on a point of the screen. dx/dy
   * are the offset from the weapon to that point in game pixels (y grows
   * downward, as everywhere else on screen); only their direction is used.
   *
   * Every gun is modelled with its barrel along +Z, and THREE's default XYZ
   * Euler order sends that axis to (sin y, -sin x cos y, cos x cos y). The two
   * angles below are that mapping inverted for a barrel whose screen-space
   * direction is fixed and whose remaining length is spent going away from the
   * camera, which is the half of the direction the enemy is standing in.
   */
  aimRotationFor(dx, dy) {
    const len = Math.hypot(dx, dy);
    const share = this.AIM_SCREEN_SHARE;
    const sx = len ? (dx / len) * share : -share;
    const sy = len ? (-dy / len) * share : 0;   // world Y grows upward
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    // Math.PI - asin() rather than asin(): both give the wanted sin, but this
    // branch is the one whose cosine is negative, i.e. the barrel pointing into
    // the screen rather than back at the player.
    const yRad = Math.PI - Math.asin(clamp(sx));
    const cosY = Math.cos(yRad);
    const xRad = Math.asin(clamp(-sy / cosY));
    const deg = 180 / Math.PI;
    return { x: xRad * deg, y: yRad * deg, z: this.AIM_ROLL };
  },

  /**
   * True when the weapon shoots ammunition rather than being the thing thrown.
   * The projectile slot holds both: a sling or a blowgun stays in the hand and
   * is reloaded (`<Bullets:>`), a chakram or a grenade leaves it.
   */
  isLauncher(weapon) {
    if (!weapon) return false;
    if (weapon.maxBullets) return true;
    return /<Bullets:\s*\d+>/i.test(weapon.note || '');
  },

  /** Weapons that turn to follow what they are being fired at. */
  aimsAtTarget(weapon) {
    // An authored GLB is posed by its own <3DRotation> and need not shoot down
    // +Z, so only the procedural models are turned. Every procedural gun, bow,
    // crossbow and sling does: barrel/arrow/pouch all point +Z.
    if (!weapon || weapon.model3d) return false;
    if (weapon.wtypeId === 9 || weapon.wtypeId === 7) return true;
    return weapon.wtypeId === 8 && this.isLauncher(weapon);
  },

  /**
   * Screen-space nudge from the shared weapon anchor, in game pixels. Guns sit
   * low and to the right like a first-person viewmodel; melee weapons hang off
   * the anchor by their grip. A procedural model grows around its own centre,
   * so the taller it is drawn the further its grip reaches below the anchor:
   * lift it by a share of its drawn height to keep the pommel in view.
   */
  anchorOffsetFor(weapon, screenHeight) {
    const screenH = screenHeight || ((typeof Graphics !== 'undefined' && Graphics.height) ? Graphics.height : 624);
    // A weapon that is aimed is carried up toward the line of sight rather than
    // resting low like a blade, but it still hangs off the bottom right corner
    // by a share of the height it is drawn at, so a long bow does not float in
    // the middle of the frame the way a pistol would.
    if (this.aimsAtTarget(weapon)) {
      return { x: 40, y: 20 - screenH * this.screenFractionFor(weapon) * 0.16 };
    }
    if (weapon.model3d) return { x: 0, y: 0 };
    // An unarmed fist is built around its wrist, not its own centre (the
    // forearm hangs below it rather than the model growing symmetrically
    // both ways), so it does not need the grip-lift the generic melee
    // formula below applies - that formula would push a whole extra
    // forearm-length off the top of the frame instead of keeping the fist in
    // place. A small fixed nudge is enough to seat it where a held weapon's
    // working end would be.
    if (weapon.unarmedArchetype) return { x: 30, y: -30 };
    // A melee weapon is carried, not floated: its grip runs off the bottom edge
    // and only the working end rises into the lower frame. A procedural model
    // grows about its own centre, so how far down it is pushed is a share of
    // the height it is actually drawn at.
    return { x: 20, y: 30 - screenH * this.screenFractionFor(weapon) * 0.26 };
  },

  /**
   * Idle breathing, tuned per weapon type: a tight FPS sway for guns, a heavy
   * hanging swing for mauls and axes, a floating drift for staves, a natural
   * figure-eight for everything else.
   * @returns {{dx:number, dy:number, drx:number, drz:number}} pixel offsets and
   *   radian offsets to add to the resting pose.
   */
  idleSway(weapon, idleMs) {
    const freq = idleMs * 0.0025;
    const t = weapon ? (weapon.wtypeId || 1) : 1;
    if (t === 9) {
      return {
        dx: Math.cos(freq * 0.4) * 2.2, dy: Math.sin(freq * 0.8) * 3.0,
        drz: Math.sin(freq * 0.4) * 0.009, drx: Math.cos(freq * 0.8) * 0.007
      };
    }
    if (t === 3 || t === 4) {
      return {
        dx: Math.cos(freq * 0.35) * 5.5,
        dy: Math.sin(freq * 0.7) * 6.5 + Math.sin(freq * 0.3) * 1.5,
        drz: Math.sin(freq * 0.35) * 0.024, drx: Math.cos(freq * 0.7) * 0.016
      };
    }
    if (t === 6) {
      return {
        dx: Math.cos(freq * 0.55) * 5.0 + Math.sin(freq * 1.1) * 1.8,
        dy: Math.sin(freq * 0.45) * 7.5 + Math.cos(freq * 1.3) * 2.2,
        drz: Math.sin(freq * 0.55) * 0.022, drx: Math.cos(freq * 0.45) * 0.016
      };
    }
    if (t === 12) {
      return {
        dx: Math.cos(freq * 0.5) * 3.0, dy: Math.sin(freq * 0.9) * 5.0,
        drz: Math.sin(freq * 0.5) * 0.014, drx: Math.cos(freq * 0.9) * 0.010
      };
    }
    return {
      dx: Math.cos(freq * 0.5) * 4.2, dy: Math.sin(freq) * 5.8,
      drz: Math.sin(freq * 0.5) * 0.019, drx: Math.cos(freq) * 0.013
    };
  },

  // Segment easings. A keyframe's `ease` governs the segment that STARTS at
  // it. Linear interpolation between poses is most of why the old fixed clips
  // read as weak: a swing that covers its distance at a constant rate has no
  // acceleration in it, and acceleration is the whole sensation of a blow.
  EASINGS: {
    linear: t => t,
    in: t => t * t,
    out: t => 1 - (1 - t) * (1 - t),
    inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    expoIn: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    expoOut: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    snap: t => 1 - Math.pow(1 - t, 5),
    backOut: t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.6 * Math.pow(t - 1, 2)
  },

  // ============================================================
  // Striking what is actually there
  // ============================================================
  // A clip is authored as a blow across the view, which is where every one of
  // them used to end up: sailing off the left edge with the enemy standing
  // somewhere else entirely. The whole choreography is instead turned so its
  // furthest reach lands on the target, and shortened so it stops there rather
  // than carrying on past. A blow at something close by therefore becomes a
  // short movement in place, and one at something across the field opens out.

  // How far a strike may be stretched or squeezed to land where it is aimed.
  // It never travels further than it was authored to, and never shrinks below
  // the point where it stops reading as a blow at all.
  STRIKE_MIN: 0.45,
  STRIKE_MAX: 1.0,

  /**
   * The clip's furthest reach from the resting pose in the plane of the screen,
   * i.e. the frame where the blow lands. Cached on the clip.
   */
  clipPeak(clip) {
    if (clip._peak !== undefined) return clip._peak;
    let peak = null;
    let len = 0;
    for (const f of clip.frames || []) {
      const d = Math.hypot(f.x || 0, f.y || 0);
      if (d > len) { len = d; peak = f; }
    }
    return (clip._peak = (peak && len > 1) ? { x: peak.x || 0, y: peak.y || 0, len: len } : null);
  },

  /**
   * The rotation and scale that carry `clip` onto `aimPoint` (game pixels).
   * Null when there is nothing to aim at or the clip does not travel, in which
   * case it plays exactly as it was authored.
   */
  strikeTransformFor(clip, weapon, screenX, screenY, aimPoint) {
    // A weapon that already turns to face its target does not also swing at it.
    if (!clip || !aimPoint || this.aimsAtTarget(weapon)) return null;
    const peak = this.clipPeak(clip);
    if (!peak) return null;
    const off = this.anchorOffsetFor(weapon);
    const dx = aimPoint.x - (screenX + off.x);
    const dy = -(aimPoint.y - (screenY - off.y));   // world Y grows upward
    const reach = Math.hypot(dx, dy);
    if (reach < 1) return null;
    const angle = Math.atan2(dy, dx) - Math.atan2(peak.y, peak.x);
    return {
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      scale: Math.max(this.STRIKE_MIN, Math.min(this.STRIKE_MAX, reach / peak.len)),
      roll: angle * 180 / Math.PI,
      peak: peak.len
    };
  },

  /**
   * Carries one sampled keyframe through a strike transform, in place. The
   * weapon's roll follows the direction of travel so the edge leads the blow,
   * scaled by how far into the swing the frame is: at rest it adds nothing, so
   * the clip still starts and ends exactly on the idle pose.
   */
  applyStrikeTransform(k, xf) {
    if (!xf) return k;
    const lead = Math.min(1, Math.hypot(k.x, k.y) / xf.peak);
    const x = k.x * xf.scale;
    const y = k.y * xf.scale;
    k.x = x * xf.cos - y * xf.sin;
    k.y = x * xf.sin + y * xf.cos;
    k.rz += xf.roll * lead;
    return k;
  },

  /**
   * Interpolates a keyframe clip at normalised time `t` (0..1).
   * @returns {{x,y,z,rx,ry,rz,scale}} offsets from the resting pose.
   */
  sampleKeyframes(frames, t) {
    const rest = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 };
    if (!frames || frames.length === 0) return rest;
    let prev = frames[0];
    let next = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (t >= frames[i].t && t <= frames[i + 1].t) {
        prev = frames[i];
        next = frames[i + 1];
        break;
      }
    }
    const span = next.t - prev.t;
    let lt = span > 0 ? (t - prev.t) / span : 0;
    const ease = prev.ease && this.EASINGS[prev.ease];
    if (ease) lt = ease(lt);
    const lerp = (a, b, f) => a + (b - a) * f;
    return {
      x: lerp(prev.x || 0, next.x || 0, lt),
      y: lerp(prev.y || 0, next.y || 0, lt),
      z: lerp(prev.z || 0, next.z || 0, lt),
      rx: lerp(prev.rx || 0, next.rx || 0, lt),
      ry: lerp(prev.ry || 0, next.ry || 0, lt),
      rz: lerp(prev.rz || 0, next.rz || 0, lt),
      scale: lerp(prev.scale !== undefined ? prev.scale : 1, next.scale !== undefined ? next.scale : 1, lt)
    };
  },

  // ============================================================
  // Procedural attack motion
  // ============================================================
  // Attacks are generated per weapon rather than read from a fixed table. Two
  // measured properties drive everything:
  //
  //   reach  how long the weapon actually is, measured off the built model
  //          (the same extent the screen fit uses), 0 for a knife, 1 for a
  //          two-handed polearm. Governs how far the strike travels and how
  //          far it rotates.
  //   heft   how heavy it is, from its <Weight:> tag on a log scale between
  //          40g and 8kg. Governs how long the wind-up takes, how hard the
  //          impact lands, and how slowly it recovers.
  //
  // So a kitchen knife flicks out in a quarter of a second and a Zweihander
  // takes most of a second to come round, and neither is a scaled copy of a
  // single authored clip.

  // Authored lengths in model units, per weapon type, for the case where the
  // model has not been measured yet.
  DEFAULT_EXTENT: {
    1: 0.32, 2: 0.7, 3: 0.95, 4: 0.85, 5: 0.6, 6: 1.1,
    7: 0.8, 8: 0.2, 9: 0.45, 10: 0.3, 11: 0.25, 12: 1.2
  },
  DEFAULT_WEIGHT: {
    1: 300, 2: 1300, 3: 4000, 4: 1800, 5: 600, 6: 1500,
    7: 900, 8: 400, 9: 3500, 10: 100, 11: 250, 12: 2200
  },

  /** Grams, from the weapon's <Weight:> tag. */
  weightOf(weapon) {
    const m = (weapon.note || '').match(/<Weight:\s*([\d.]+)>/i);
    if (m) {
      const g = parseFloat(m[1]);
      if (Number.isFinite(g) && g > 0) return g;
    }
    return this.DEFAULT_WEIGHT[weapon.wtypeId] || 1000;
  },

  /**
   * Measured physique of a weapon, cached on the model.
   * @returns {{extent:number, grams:number, reach:number, heft:number}}
   */
  weaponMetrics(weapon, model) {
    if (model && model.userData._metrics) return model.userData._metrics;

    let extent = model && model.userData._fitExtent;
    if (!extent && model && typeof THREE !== 'undefined') {
      const prev = model.scale.clone();
      model.scale.set(1, 1, 1);
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      extent = Math.max(size.x, size.y) || 0;
      model.scale.copy(prev);
      model.updateMatrixWorld(true);
      model.userData._fitExtent = extent;
    }
    if (!extent) extent = this.DEFAULT_EXTENT[weapon.wtypeId] || 0.6;

    const grams = this.weightOf(weapon);
    const metrics = {
      extent: extent,
      grams: grams,
      // 0.18m (a shiv) to 1.25m (a pike) covers everything in the database.
      reach: Math.max(0, Math.min(1, (extent - 0.18) / (1.25 - 0.18))),
      // Log scale: the difference between 40g and 300g matters as much as the
      // difference between 1kg and 8kg.
      heft: Math.max(0, Math.min(1, (Math.log(grams) - Math.log(40)) / (Math.log(8000) - Math.log(40))))
    };
    if (model) model.userData._metrics = metrics;
    return metrics;
  },

  // Animation name -> motion archetype and its direction. `dir` +1 sweeps
  // right-to-left across the view, -1 the other way; `tilt` +1 travels upward
  // through the arc, -1 downward.
  ATTACK_MOTIONS: {
    Swing: { kind: 'arc', dir: 1 },
    SwingLeft: { kind: 'arc', dir: -1 },
    Slash: { kind: 'arc', dir: 1, tilt: 0.4 },
    Cleave: { kind: 'arc', dir: 1, tilt: -0.6, power: 1.2 },
    CrossSlash: { kind: 'arc', dir: -1, tilt: 0.5, repeat: 2 },
    SwingDiagonalDown: { kind: 'arc', dir: 1, tilt: -0.8 },
    SwingDiagonalUp: { kind: 'arc', dir: -1, tilt: 0.8 },
    SwingDown: { kind: 'overhead' },
    Overhead: { kind: 'overhead', power: 1.15 },
    Execute: { kind: 'overhead', power: 1.4 },
    SwingUp: { kind: 'rising' },
    Uppercut: { kind: 'rising', power: 1.15 },
    Thrust: { kind: 'thrust' },
    Impale: { kind: 'thrust', power: 1.3 },
    Backstab: { kind: 'thrust', dir: -1, power: 1.1 },
    Spin: { kind: 'spin' },
    Whirlwind: { kind: 'spin', turns: 2 },
    Cyclone: { kind: 'spin', turns: 2, tilt: 0.5 },
    Flourish: { kind: 'spin', dir: -1 },
    Block: { kind: 'guard' },
    Parry: { kind: 'guard', dir: -1 },
    Riposte: { kind: 'guard', riposte: true },
    HiddenBlade: { kind: 'swordcane' },
    Recoil: { kind: 'recoil' },
    RevolverRecoil: { kind: 'recoil', power: 1.25 },
    RifleRecoil: { kind: 'recoil', power: 1.5 },
    Shoot: { kind: 'recoil' },
    Reload: { kind: 'reload' },
    BowDrawAndRelease: { kind: 'draw' },
    CrossbowShot: { kind: 'crossbow' }
  },

  // The motion a weapon falls back to when the caller asks for a name nothing
  // knows (a skill's own animation tag, most often).
  TYPE_MOTIONS: {
    1: 'thrust', 2: 'arc', 3: 'overhead', 4: 'arc', 5: 'lash', 6: 'cast',
    7: 'draw', 8: 'hurl', 9: 'recoil', 10: 'arc', 11: 'thrust', 12: 'thrust'
  },

  motionForWeapon(weapon, model) {
    if (weapon.isWhip) return 'lash';
    if (weapon.isFlail) return 'arc';
    const ranged = this.rangedMotionFor(weapon, model);
    if (ranged) return ranged;
    return this.TYPE_MOTIONS[weapon.wtypeId] || 'arc';
  },

  /**
   * The motion a weapon that shoots is REQUIRED to use, or null for one that is
   * swung. A gun fires, a bow and a sling loose, a thrown weapon leaves the
   * hand; none of them is ever a club, whatever a skill or a <Movement:> tag
   * asks for.
   */
  rangedMotionFor(weapon, model) {
    if (!weapon) return null;
    if (weapon.wtypeId === 9) return 'recoil';
    // A crossbow is not drawn: it is carried spanned and let off with a
    // finger, so it takes the trigger motion rather than the archer's one.
    if (this.isCrossbow(weapon, model)) return 'crossbow';
    if (weapon.wtypeId === 7) return 'draw';
    if (weapon.wtypeId === 8) return this.isLauncher(weapon) ? 'draw' : 'hurl';
    return null;
  },

  // Motions a ranged weapon is still allowed to play: reloading it, and
  // bracing behind it. Anything else is replaced by its own firing motion.
  RANGED_KEEP: { reload: true, guard: true },

  /**
   * The motion an empty hand is REQUIRED to use, or null for a hand holding
   * something. A bare fist has no blade to sweep and no shaft to bring over,
   * so whatever a skill name or a <Movement:> tag asked for, an unarmed
   * strike is thrown as a punch (MOTIONS.punch still shapes itself around
   * what was asked, so an uppercut comes up from under and a swing turns
   * into a hook). Only the Humanoid fist is thrown this way: every other
   * archetype swings a claw, a hoof or a pseudopod, none of which punches.
   */
  fistMotionFor(weapon) {
    if (!weapon || weapon.unarmedArchetype !== 'Humanoid') return null;
    return 'punch';
  },

  // What a fist is still allowed to do instead of punching: put itself in the
  // way. Everything else it does, it does by hitting something.
  FIST_KEEP: { guard: true },

  /**
   * Generates the attack clip for a weapon and an animation name.
   * @returns {{duration:number, frames:Array}} in the same shape the fixed
   *   MovementKeyFrame3d clips use, so nothing downstream changes.
   */
  buildAttack(weapon, name, model) {
    let motion = this.ATTACK_MOTIONS[name] || { kind: this.motionForWeapon(weapon, model) };
    // What a weapon that shoots does is decided by the weapon, never by the
    // name the skill asked for: most firearms and every sling in the database
    // carry a <Movement:> tag written for a blade, or none at all (which used
    // to mean 'Swing'), and were bashing the enemy with the stock.
    const ranged = this.rangedMotionFor(weapon, model);
    if (ranged && motion.kind !== ranged && !this.RANGED_KEEP[motion.kind]) {
      motion = Object.assign({}, motion, { kind: ranged });
    }
    // Same reasoning one step further along: a character with nothing in
    // their hand punches. The motion that was asked for is kept as `from`,
    // so the punch that replaces it can still be the right SHAPE of punch.
    const fist = this.fistMotionFor(weapon);
    if (fist && motion.kind !== fist && !this.FIST_KEEP[motion.kind]) {
      motion = Object.assign({}, motion, { kind: fist, from: motion.kind });
    }
    const build = this.MOTIONS[motion.kind] || this.MOTIONS.arc;
    const m = this.weaponMetrics(weapon, model);
    const H = (typeof Graphics !== 'undefined' && Graphics.height) ? Graphics.height : 624;
    if (motion.kind === 'recoil') {
      // The class profile decides the shape of the kick and how many rounds
      // go out; the model's own parts are told to cycle in step with it.
      motion = Object.assign({}, motion, { profile: this.gunProfileFor(weapon) });
      if (model) this.beginGunFire(model, weapon);
    }
    const clip = build.call(this, m, motion, H);
    // The blade has to leave the shaft on the same clock the shaft is moving
    // on, so the draw is started from the finished clip's own duration.
    if (motion.kind === 'swordcane' && model) this.beginCaneDraw(model, clip.duration);
    // The hand tightening into the blow it is throwing, on the same clock the
    // arm is travelling on.
    if (motion.kind === 'punch' && model) this.beginPunch(model, clip.duration);
    // Same clock for the string, the limbs and the arrow: the hand kicks on
    // the frame they let go.
    if ((motion.kind === 'draw' || motion.kind === 'crossbow') && model) {
      this.beginBowShot(model, weapon, clip.duration);
    }
    return clip;
  },

  MOTIONS: {
    // A blow travelling across the view. Wind up against the direction of
    // travel, cross the whole frame, overshoot the contact point by a little,
    // stop dead, then drift back.
    arc(m, o, H) {
      const dir = o.dir === undefined ? 1 : o.dir;
      const tilt = o.tilt || 0;
      const power = o.power || 1;
      const wind = (0.15 + m.heft * 0.13) * H;
      const travel = (0.40 + m.reach * 0.46) * H * power;
      const lift = (0.10 + m.reach * 0.16) * H;
      const turn = (95 + m.reach * 75 + m.heft * 34) * power;
      const punch = 1.13 + m.heft * 0.30 * power;
      // Heavy weapons spend the time in the wind-up, light ones in the strike.
      const windEnd = 0.22 + m.heft * 0.14;
      const hit = windEnd + 0.20;
      return {
        duration: 290 + m.heft * 440 + m.reach * 180,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          {
            t: windEnd, x: dir * wind, y: -wind * (0.62 - tilt * 0.5), z: -0.06 * H,
            rx: -8 - m.heft * 16, ry: dir * 24, rz: dir * (32 + m.heft * 20),
            scale: 0.90, ease: 'expoOut'
          },
          {
            t: hit, x: -dir * travel, y: lift * (tilt >= 0 ? 1 : -1) + tilt * lift * 0.6, z: 0.16 * H,
            rx: 10 + tilt * 18, ry: -dir * 30, rz: -dir * turn,
            scale: punch, ease: 'out'
          },
          {
            t: hit + 0.07, x: -dir * travel * 1.1, y: lift * (tilt >= 0 ? 1.15 : -1.15), z: 0.1 * H,
            rx: 6, ry: -dir * 24, rz: -dir * turn * 1.08,
            scale: punch * 0.94, ease: 'inOut'
          },
          {
            t: 0.82, x: -dir * travel * 0.55, y: lift * 0.5 * (tilt >= 0 ? 1 : -1), z: 0.03 * H,
            rx: 2, ry: -dir * 10, rz: -dir * turn * 0.5,
            scale: 1.02, ease: 'out'
          },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // Raised over the head and brought straight down through the middle. The
    // heaviest-feeling motion in the set: the wind-up leaves the frame.
    overhead(m, o, H) {
      const power = o.power || 1;
      const raise = (0.26 + m.heft * 0.22) * H;
      const drop = (0.34 + m.reach * 0.30) * H * power;
      const punch = 1.20 + m.heft * 0.38 * power;
      const windEnd = 0.26 + m.heft * 0.14;
      const hit = windEnd + 0.19;
      return {
        duration: 380 + m.heft * 520 + m.reach * 150,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          {
            t: windEnd, x: 0, y: -raise, z: -0.14 * H,
            rx: -(48 + m.heft * 34), ry: 0, rz: 0, scale: 0.86, ease: 'expoOut'
          },
          {
            t: hit, x: 0, y: drop, z: 0.24 * H,
            rx: 62 + m.reach * 26, ry: 0, rz: 0, scale: punch, ease: 'out'
          },
          {
            t: hit + 0.06, x: 0, y: drop * 1.08, z: 0.16 * H,
            rx: 70 + m.reach * 26, ry: 0, rz: 0, scale: punch * 0.9, ease: 'inOut'
          },
          {
            t: 0.84, x: 0, y: drop * 0.42, z: 0.05 * H,
            rx: 26, ry: 0, rz: 0, scale: 1.03, ease: 'out'
          },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // The mirror of overhead: dropped low, then torn upward.
    rising(m, o, H) {
      const power = o.power || 1;
      const dip = (0.20 + m.heft * 0.16) * H;
      const rise = (0.36 + m.reach * 0.32) * H * power;
      const punch = 1.16 + m.heft * 0.32 * power;
      const windEnd = 0.22 + m.heft * 0.12;
      const hit = windEnd + 0.20;
      return {
        duration: 340 + m.heft * 460 + m.reach * 140,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          { t: windEnd, x: 0.04 * H, y: dip, z: -0.1 * H, rx: 40 + m.heft * 22, ry: 10, rz: 12, scale: 0.88, ease: 'expoOut' },
          { t: hit, x: -0.05 * H, y: -rise, z: 0.22 * H, rx: -(52 + m.reach * 24), ry: -14, rz: -18, scale: punch, ease: 'out' },
          { t: hit + 0.07, x: -0.06 * H, y: -rise * 1.1, z: 0.14 * H, rx: -(60 + m.reach * 24), ry: -10, rz: -14, scale: punch * 0.92, ease: 'inOut' },
          { t: 0.84, x: -0.02 * H, y: -rise * 0.4, z: 0.04 * H, rx: -22, ry: -4, rz: -6, scale: 1.02, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // Straight down the barrel of the view.
    //
    // The overlay camera is ORTHOGRAPHIC, so travelling on Z changes nothing
    // on screen: depth has to be spoken as scale. The lunge is therefore a
    // zoom, with reach deciding how far the point gets and heft deciding how
    // long it takes to get there. (Z still moves, only for draw order.)
    thrust(m, o, H) {
      const dir = o.dir === undefined ? 1 : o.dir;
      const power = o.power || 1;
      const pull = (0.10 + m.heft * 0.10) * H;
      const zoom = 1 + (0.34 + m.reach * 0.38) * power;
      const drift = (0.05 + m.reach * 0.06) * H;
      const windEnd = 0.20 + m.heft * 0.14;
      const hit = windEnd + 0.16;
      return {
        duration: 250 + m.heft * 380 + m.reach * 130,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          { t: windEnd, x: dir * pull, y: -pull * 0.4, z: -60, rx: -10, ry: dir * 16, rz: dir * 10, scale: 0.86, ease: 'expoOut' },
          { t: hit, x: -dir * drift, y: drift * 0.5, z: 220, rx: 14, ry: -dir * 6, rz: -dir * 4, scale: zoom, ease: 'snap' },
          { t: hit + 0.06, x: -dir * drift * 1.2, y: drift * 0.7, z: 240, rx: 16, ry: -dir * 4, rz: -dir * 2, scale: zoom * 1.03, ease: 'inOut' },
          { t: 0.8, x: -dir * drift * 0.4, y: drift * 0.2, z: 90, rx: 6, ry: 0, rz: 0, scale: 1 + (zoom - 1) * 0.3, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // A bare fist.
    //
    // None of the swinging motions fit an empty hand: there is no blade to
    // sweep, no shaft to bring over and no mass to let carry the arm through
    // the blow. A punch is the opposite shape of movement, and it is written
    // here as one: a short chamber back toward the shoulder, a straight line
    // out at everything the arm has, and a hand snatched back to the guard
    // faster than it went out, because a fist left hanging out there is how
    // people get hit back.
    //
    // The overlay camera is ORTHOGRAPHIC, so distance covered has to be
    // spoken as scale (as with `thrust`). That is doing most of the work
    // here: the fist grows to half again its size at full extension, which is
    // what sells an arm reaching the length a held weapon never has to.
    //
    // `from` is the motion the skill originally asked for before the fist
    // took it over, so a swing becomes a hook, an uppercut comes up from
    // under and an overhead drops as a hammer fist. All three run on the same
    // clock and all three still read as a punch rather than as a sword swing
    // performed by a hand.
    punch(m, o, H) {
      const from = o.from;
      const dir = o.dir === undefined ? 1 : o.dir;
      const power = o.power || 1;
      const hook = from === 'arc' || from === 'spin' || from === 'lash';
      const rise = from === 'rising';
      const drop = from === 'overhead';
      // The chamber is small: it is the furthest from the camera the hand
      // ever gets, and a fist pulled back too far reads as a wind-up rather
      // than as a guard being left.
      const pull = (0.07 + m.heft * 0.05) * H;
      // A hook travels across the frame and lands short; a straight punch
      // spends everything it has going away from the camera instead.
      const zoom = 1 + (hook ? 0.32 : 0.54) * power;
      const cross = hook ? (0.28 + m.reach * 0.16) * H * power : (0.05 + m.reach * 0.04) * H;
      const lift = rise ? -(0.24 + m.reach * 0.12) * H
        : (drop ? (0.28 + m.reach * 0.12) * H : 0.025 * H);
      // Fast: the wind-up is a snap of the elbow, not a haul of the shoulder.
      const windEnd = 0.20 + m.heft * 0.09;
      const hit = windEnd + 0.14;
      return {
        duration: 250 + m.heft * 180,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          // Chambered: back, turned over, and at its smallest.
          {
            t: windEnd,
            x: dir * pull * (hook ? 1.5 : 1),
            y: rise ? pull * 0.9 : (drop ? -pull * 1.5 : -pull * 0.25),
            z: -0.11 * H,
            rx: rise ? 24 : (drop ? -38 : -14),
            ry: dir * 20, rz: dir * (hook ? 26 : 12),
            scale: 0.80, ease: 'expoOut'
          },
          // Landed. Everything arrives on this frame at once: the reach, the
          // turn of the fist and the size of it.
          {
            t: hit,
            x: -dir * cross, y: lift, z: 0.26 * H,
            rx: rise ? -32 : (drop ? 44 : 12),
            ry: -dir * (hook ? 26 : 8), rz: -dir * (hook ? 34 : 10),
            scale: zoom, ease: 'snap'
          },
          // The give of the thing that was hit.
          {
            t: hit + 0.05,
            x: -dir * cross * 1.08, y: lift * 1.08, z: 0.22 * H,
            rx: rise ? -36 : (drop ? 48 : 14),
            ry: -dir * (hook ? 22 : 6), rz: -dir * (hook ? 30 : 8),
            scale: zoom * 1.03, ease: 'inOut'
          },
          // Snatched back to the guard.
          {
            t: 0.72,
            x: -dir * cross * 0.3, y: lift * 0.25, z: 0.05 * H,
            rx: rise ? -10 : (drop ? 14 : 4), ry: -dir * 4, rz: -dir * 6,
            scale: 1 + (zoom - 1) * 0.22, ease: 'out'
          },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // A sword cane. The weapon starts the beat as a stick and finishes it as a
    // stick; the only reason it hits at all happens in the middle, when the
    // blade leaves the shaft. The clip is written around that: a long settle
    // while nothing is showing, the kick of the release, the thrust down the
    // line, and a withdrawal that ends on the ferrule tapping the floor.
    // Depth is scale under the orthographic overlay camera, as with `thrust`.
    // tickCane drives the blade itself over the same duration, so the windows
    // in CANE_DRAW and the keyframe times below are one timeline.
    swordcane(m, o, H) {
      const power = o.power || 1;
      const pull = (0.09 + m.heft * 0.08) * H;
      const zoom = 1 + (0.30 + m.reach * 0.34) * power;
      const drift = (0.04 + m.reach * 0.05) * H;
      return {
        duration: 620 + m.heft * 300 + m.reach * 150,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          // Turned point-forward while the shaft is still shut.
          { t: 0.16, x: pull, y: -pull * 0.5, z: -50, rx: -14, ry: 18, rz: 12, scale: 0.88, ease: 'out' },
          // The blade clears the mouth and the cane kicks in the hand.
          { t: 0.30, x: pull * 0.66, y: -pull * 0.78, z: -30, rx: -22, ry: 10, rz: 5, scale: 0.93, ease: 'expoOut' },
          { t: 0.46, x: -drift, y: drift * 0.5, z: 230, rx: 12, ry: -6, rz: -3, scale: zoom, ease: 'snap' },
          { t: 0.54, x: -drift * 1.2, y: drift * 0.7, z: 250, rx: 14, ry: -4, rz: -2, scale: zoom * 1.03, ease: 'inOut' },
          { t: 0.80, x: -drift * 0.3, y: drift * 0.15, z: 70, rx: 5, ry: 0, rz: 0, scale: 1 + (zoom - 1) * 0.22, ease: 'out' },
          // Seated again, and set down.
          { t: 0.94, x: 0, y: pull * 0.18, z: 0, rx: -3, ry: 0, rz: 0, scale: 1.01, ease: 'inOut' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // Full revolutions. A light weapon gets round more times than a heavy one
    // in the same beat, so the turn count is cut by heft rather than fixed.
    spin(m, o, H) {
      const dir = o.dir === undefined ? 1 : o.dir;
      const turns = Math.max(1, Math.round((o.turns || 1) + (1 - m.heft) * 0.9));
      const sweep = (0.20 + m.reach * 0.26) * H;
      const tilt = o.tilt || 0;
      const total = 360 * turns * dir;
      const punch = 1.14 + m.heft * 0.26;
      return {
        duration: 420 + m.heft * 520 + turns * 140,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          { t: 0.18, x: dir * sweep * 0.5, y: -sweep * 0.35, z: -0.05 * H, rx: -12, ry: dir * 40, rz: dir * 40, scale: 0.92, ease: 'out' },
          { t: 0.44, x: -dir * sweep, y: sweep * 0.4 * (1 + tilt), z: 0.18 * H, rx: 12 + tilt * 24, ry: total * 0.45, rz: total * 0.45, scale: punch, ease: 'linear' },
          { t: 0.66, x: dir * sweep * 0.8, y: -sweep * 0.3, z: 0.1 * H, rx: -6, ry: total * 0.7, rz: total * 0.7, scale: punch * 0.96, ease: 'linear' },
          { t: 0.86, x: -dir * sweep * 0.4, y: sweep * 0.2, z: 0.04 * H, rx: 4, ry: total * 0.92, rz: total * 0.92, scale: 1.04, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: total, rz: total, scale: 1 }
        ]
      };
    },

    // Braced, not swung. Snap into the guard, absorb (a heavy weapon barely
    // moves, a light one is driven back), hold, recover.
    guard(m, o, H) {
      const dir = o.dir === undefined ? 1 : o.dir;
      const set = (0.10 + m.reach * 0.10) * H;
      const shove = (0.10 - m.heft * 0.07) * H;
      const frames = [
        { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'snap' },
        { t: 0.2, x: -dir * set, y: -set * 0.4, z: 0.1 * H, rx: -6, ry: -dir * 40, rz: -dir * (30 + m.reach * 20), scale: 1.08, ease: 'out' },
        { t: 0.34, x: -dir * set - shove, y: -set * 0.35, z: 0.06 * H, rx: -2, ry: -dir * 34, rz: -dir * (26 + m.reach * 18), scale: 1.05, ease: 'inOut' },
        { t: 0.62, x: -dir * set, y: -set * 0.4, z: 0.09 * H, rx: -5, ry: -dir * 38, rz: -dir * (29 + m.reach * 20), scale: 1.06, ease: 'out' }
      ];
      if (o.riposte) {
        // The counter that a parry buys: straight back down the line. Depth is
        // scale, not Z, under the orthographic overlay camera.
        const zoom = 1 + 0.3 + m.reach * 0.3;
        frames.push({ t: 0.76, x: 0, y: 0, z: 200, rx: 12, ry: 0, rz: 0, scale: zoom, ease: 'snap' });
        frames.push({ t: 0.88, x: 0, y: 0.01 * H, z: 80, rx: 6, ry: 0, rz: 0, scale: 1 + (zoom - 1) * 0.3, ease: 'out' });
      }
      frames.push({ t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 });
      return { duration: (o.riposte ? 620 : 420) + m.heft * 220, frames: frames };
    },

    // Muzzle rise and a shove back into the shoulder.
    //
    // Recoil is the one motion where the weapon's CLASS matters as much as its
    // weight: a snub revolver and a submachine gun of the same mass do not
    // behave alike. The class profile sets how hard it climbs, how far it is
    // driven back and how many times, and heft scales all of it. An automatic
    // therefore stutters through several small kicks where a shotgun makes one
    // enormous one.
    recoil(m, o, H) {
      const power = o.power || 1;
      const p = o.profile || { rise: 1, push: 1, shots: 1, rate: 0, dur: 1 };
      const kick = (0.045 + m.heft * 0.105) * H * power * p.push;
      const rise = (20 + m.heft * 28) * power * p.rise;
      const shots = Math.max(1, p.shots);
      const dur = (230 + m.heft * 240 * power) * p.dur * (shots > 1 ? 1 + shots * 0.18 : 1);

      const frames = [{ t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'snap' }];
      // Recoil is the one motion built for guns alone, and a gun is aimed away
      // from the camera: its barrel is turned through a negative cosine, so it
      // is POSITIVE rx that throws the muzzle up. Every other motion is played
      // by weapons held across the view, where the sign is the other way round.
      // Each round in the burst gets its own kick, and the muzzle climbs a
      // little further with every one instead of returning to where it began.
      for (let i = 0; i < shots; i++) {
        const base = (i + 0.55) / shots;
        const climb = 1 + i * 0.35;
        const jitter = (i % 2 ? 1 : -1) * 0.004 * H;
        frames.push({
          t: Math.min(0.93, base - 0.4 / shots), x: jitter + 0.008 * H * power, y: kick * climb,
          z: -kick * 1.7, rx: rise * climb, ry: 2 * power, rz: 3 * power * (i % 2 ? -1 : 1),
          scale: 1 + 0.035 * p.flash, ease: 'out'
        });
        frames.push({
          t: Math.min(0.96, base), x: jitter * 0.4, y: kick * climb * 0.45,
          z: -kick * 0.7, rx: rise * climb * 0.5, ry: -1, rz: 1.5 * (i % 2 ? -1 : 1),
          scale: 1.01, ease: shots > 1 ? 'linear' : 'inOut'
        });
      }
      frames.push({ t: 0.98, x: 0, y: kick * 0.14, z: -kick * 0.2, rx: rise * 0.16, ry: 0, rz: 0.3, scale: 1, ease: 'out' });
      frames.push({ t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 });
      return { duration: dur, frames: frames };
    },

    // Out of the frame, work, back up. Heft decides how long the work takes.
    reload(m, o, H) {
      const drop = (0.16 + m.heft * 0.10) * H;
      return {
        duration: 900 + m.heft * 700,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'out' },
          { t: 0.22, x: -0.03 * H, y: -drop, z: -0.05 * H, rx: 18, ry: -14, rz: -26, scale: 0.94, ease: 'inOut' },
          { t: 0.48, x: -0.04 * H, y: -drop * 1.5, z: -0.07 * H, rx: 26, ry: -20, rz: -32, scale: 0.9, ease: 'inOut' },
          { t: 0.7, x: -0.02 * H, y: -drop * 0.7, z: -0.03 * H, rx: 12, ry: -8, rz: -16, scale: 0.97, ease: 'out' },
          { t: 0.88, x: 0.01 * H, y: 0.02 * H, z: 0.01 * H, rx: -6, ry: 4, rz: 5, scale: 1.02, ease: 'inOut' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // Bring it up, draw, hold, loose, and let the bow turn over in the hand.
    //
    // The string, the limbs and the arrow are NOT in here: tickBow drives them
    // off this clip's own duration (BOW_SHOT), and what is left for the hand is
    // small on purpose. An archer at full draw is the stillest thing in a
    // fight, so the shot reads on the string coming back and on the two frames
    // where the bow jumps, not on the whole weapon being flung across the view.
    //
    // The overlay camera is orthographic, so depth is spent in `scale` rather
    // than in z: pushing the bow out to arm's length grows it a little, and the
    // hand dropping back on the loose shrinks it.
    draw(m, o, H) {
      const w = this.BOW_SHOT;
      const reach = (0.012 + m.reach * 0.02) * H;
      const kick = (0.008 + m.heft * 0.016) * H;
      // A heavy bow fights the hand harder when it goes.
      const turn = 6 + m.heft * 14;
      return {
        // Fast: an archer under fire does not hold at full draw, and a shot
        // that outlasts the turn it belongs to reads as a stall.
        duration: 340 + m.heft * 220 + m.reach * 80,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'out' },
          // Up onto the line of sight, bow arm going out.
          { t: w.rise, x: -reach * 0.5, y: reach * 0.35, z: 0, rx: 1.5, ry: 1, rz: -2, scale: 1.015, ease: 'inOut' },
          // Full draw: braced, and holding still.
          { t: w.full, x: -reach, y: reach * 0.5, z: 0, rx: 2.5, ry: 2, rz: -3.5, scale: 1.03, ease: 'linear' },
          { t: (w.full + w.loose) / 2, x: -reach * 1.02, y: reach * 0.52, z: 0, rx: 2.6, ry: 2.1, rz: -3.6, scale: 1.03, ease: 'linear' },
          { t: w.loose, x: -reach, y: reach * 0.5, z: 0, rx: 2.5, ry: 2, rz: -3.5, scale: 1.03, ease: 'expoOut' },
          // Loosed: the hand is thrown back off the tension it was holding.
          { t: w.loose + 0.05, x: reach * 0.35 + kick, y: reach * 0.1 - kick, z: 0, rx: -4, ry: -3, rz: turn, scale: 0.965, ease: 'out' },
          // And the bow rolls forward in the loose grip before it is caught.
          { t: w.loose + 0.18, x: kick * 0.5, y: -kick * 0.7, z: 0, rx: -1.5, ry: -1, rz: turn * 1.5, scale: 0.99, ease: 'inOut' },
          { t: 0.86, x: 0, y: -kick * 0.2, z: 0, rx: 0, ry: 0, rz: turn * 0.5, scale: 1.005, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // A crossbow is already spanned when it comes up: there is no draw, only a
    // brace, a trigger and the jolt of a prod letting go. tickBow throws the
    // string and the bolt forward on the same frame the jolt lands (BOLT_SHOT).
    crossbow(m, o, H) {
      const w = this.BOLT_SHOT;
      const jolt = (0.014 + m.heft * 0.03) * H;
      const rise = 5 + m.heft * 9;
      return {
        duration: 280 + m.heft * 170,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'inOut' },
          // Into the shoulder and levelled.
          { t: 0.2, x: -jolt * 0.3, y: jolt * 0.25, z: 0, rx: 1.5, ry: 1, rz: -1.5, scale: 1.03, ease: 'linear' },
          { t: w.loose, x: -jolt * 0.32, y: jolt * 0.26, z: 0, rx: 1.6, ry: 1, rz: -1.5, scale: 1.03, ease: 'snap' },
          // The prod lets go: everything the limbs were holding comes back
          // through the stock at once.
          { t: w.loose + 0.04, x: jolt * 0.55, y: jolt * 0.5, z: 0, rx: rise, ry: -2, rz: 4, scale: 0.955, ease: 'out' },
          { t: w.loose + 0.12, x: jolt * 0.2, y: jolt * 0.16, z: 0, rx: rise * 0.4, ry: -1, rz: 1.5, scale: 0.99, ease: 'inOut' },
          // Held on the target a moment before it comes down.
          { t: 0.78, x: 0, y: jolt * 0.05, z: 0, rx: rise * 0.12, ry: 0, rz: 0.4, scale: 1.005, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // A whip has no mass at the far end to speak of: the hand movement is
    // small and sharp, and the rope simulation does the rest.
    lash(m, o, H) {
      const crack = (0.14 + m.reach * 0.12) * H;
      return {
        duration: 380 + m.heft * 180,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          { t: 0.26, x: crack, y: -crack * 1.2, z: -50, rx: -30, ry: 12, rz: 26, scale: 0.92, ease: 'expoOut' },
          { t: 0.42, x: -crack * 1.6, y: crack * 0.5, z: 210, rx: 22, ry: -14, rz: -34, scale: 1.3, ease: 'out' },
          { t: 0.6, x: -crack * 0.6, y: crack * 0.2, z: 80, rx: 8, ry: -6, rz: -14, scale: 1.08, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // Raise, gather, punch the working end forward. Reach matters (a long
    // staff sweeps), heft barely does.
    cast(m, o, H) {
      const lift = (0.14 + m.reach * 0.16) * H;
      const zoom = 1 + 0.28 + m.reach * 0.26;
      return {
        duration: 480 + m.heft * 260 + m.reach * 160,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'inOut' },
          { t: 0.3, x: -lift * 0.6, y: -lift, z: -50, rx: -16, ry: -22, rz: -18, scale: 0.9, ease: 'expoOut' },
          { t: 0.48, x: lift * 0.3, y: lift * 0.5, z: 200, rx: 20, ry: 14, rz: 12, scale: zoom, ease: 'out' },
          { t: 0.58, x: lift * 0.35, y: lift * 0.55, z: 210, rx: 22, ry: 16, rz: 14, scale: zoom * 1.04, ease: 'inOut' },
          { t: 0.82, x: lift * 0.12, y: lift * 0.2, z: 70, rx: 8, ry: 6, rz: 5, scale: 1 + (zoom - 1) * 0.25, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    },

    // Thrown: it leaves the hand, so it shrinks away into the distance rather
    // than coming back.
    hurl(m, o, H) {
      const wind = (0.12 + m.heft * 0.12) * H;
      return {
        duration: 340 + m.heft * 200,
        frames: [
          { t: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, ease: 'expoIn' },
          { t: 0.2, x: wind * 1.4, y: -wind * 1.8, z: -wind * 1.2, rx: -28, ry: 20, rz: 24, scale: 0.95, ease: 'expoOut' },
          { t: 0.44, x: -wind * 2.2, y: wind, z: 0.5 * H, rx: 16, ry: -26, rz: -40, scale: 0.6, ease: 'linear' },
          { t: 0.68, x: -wind * 3.0, y: wind * 0.6, z: 1.1 * H, rx: 8, ry: -34, rz: -56, scale: 0.22, ease: 'linear' },
          { t: 0.8, x: -wind * 3.2, y: wind * 0.4, z: 1.4 * H, rx: 4, ry: -38, rz: -62, scale: 0.05, ease: 'out' },
          { t: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
        ]
      };
    }
  },

  /**
   * Uniform scale that makes `model` cover its intended share of the screen.
   *
   * The overlay camera is orthographic and looks straight down -Z with one
   * world unit per game pixel, so only the model's X/Y extents are visible.
   * Measuring those *after* the idle rotation is what keeps a barrel-forward
   * FPS gun (nearly all of whose length runs along Z) from being fitted to a
   * sliver. The measurement is cached on the model since it never changes.
   */
  fitScaleFor(model, weapon) {
    if (!model || typeof THREE === 'undefined') return 1;
    let extent = model.userData._fitExtent;
    if (!extent) {
      const prevScale = model.scale.clone();
      model.scale.set(1, 1, 1);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      extent = Math.max(size.x, size.y) || 1;
      model.scale.copy(prevScale);
      model.updateMatrixWorld(true);
      model.userData._fitExtent = extent;
    }
    const screenH = (typeof Graphics !== 'undefined' && Graphics.height) ? Graphics.height : 624;
    return (screenH * this.screenFractionFor(weapon)) / extent;
  },

  // ============================================================
  // Verlet Rope Physics for linked-segment weapons (whips/flails)
  // ============================================================

  /**
   * Creates a Verlet rope: a chain of point masses with distance constraints.
   * @param {number} numPoints - Number of points (segments + 1)
   * @param {number} segmentLength - Rest length between consecutive points
   * @param {THREE.Vector3} anchorPos - World-space anchor (handle tip)
   * @param {object} opts - { gravity, damping, iterations, stiffness }
   * @returns {object} rope instance
   */
  createVerletRope(numPoints, segmentLength, anchorPos, opts = {}) {
    const gravity = opts.gravity !== undefined ? opts.gravity : -0.0004;
    const damping = opts.damping !== undefined ? opts.damping : 0.97;
    const iterations = opts.iterations || 6;
    const stiffness = opts.stiffness !== undefined ? opts.stiffness : 1.0;

    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const pos = new THREE.Vector3(
        anchorPos.x,
        anchorPos.y + i * segmentLength,
        anchorPos.z
      );
      points.push({
        pos: pos.clone(),
        prev: pos.clone(),
        pinned: i === 0  // first point is pinned to the anchor
      });
    }

    const constraints = [];
    for (let i = 0; i < numPoints - 1; i++) {
      constraints.push({ a: i, b: i + 1, length: segmentLength });
    }

    return {
      points,
      constraints,
      gravity,
      damping,
      iterations,
      stiffness,
      anchorPos: anchorPos.clone(),
      // Meshes array, filled by createWhipModel / createFlailModel
      segmentMeshes: [],
      // Optional end-mass (heavier tail for flails)
      endMass: opts.endMass || 1.0,
      headMeshGroup: null
    };
  },

  /**
   * Hangs a physics chain off a point on a model and returns the empty group
   * at its far end, for the caller to fill with whatever the chain carries.
   * Every flail, meteor hammer and swinging head in the game is this call plus
   * a head, so the rope wiring lives here rather than in each builder.
   * @param {THREE.Group} group - the weapon; the rope is registered on it
   * @param {object} opts - { links, length, x, y, z, linkMat, linkRadius,
   *   linkTube, gravity, endMass }
   * @returns {THREE.Group} the head mount, already positioned at the tip
   */
  chainRig(group, opts) {
    const o = opts || {};
    const links = o.links || 7;
    const length = o.length || 0.26;
    const segLen = length / links;
    const anchor = new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0);

    const rope = this.createVerletRope(links + 1, segLen, anchor, {
      gravity: o.gravity === undefined ? -0.0008 : o.gravity,
      damping: o.damping === undefined ? 0.93 : o.damping,
      iterations: 8,
      stiffness: 1.0,
      endMass: o.endMass === undefined ? 4.0 : o.endMass
    });

    const r = o.linkRadius === undefined ? 0.014 : o.linkRadius;
    const tube = o.linkTube === undefined ? 0.004 : o.linkTube;
    for (let i = 0; i < links; i++) {
      const link = o.rope
        ? new THREE.Mesh(new THREE.CylinderGeometry(tube * 1.6, tube * 1.6, segLen * 1.05, this.seg(6, 4)), o.linkMat)
        : new THREE.Mesh(new THREE.TorusGeometry(r, tube, this.seg(4, 3), this.seg(8, 5)), o.linkMat);
      if (!o.rope) link.userData._chainAlternate = (i % 2 === 0);
      link.position.set(anchor.x, anchor.y + segLen * i + segLen / 2, anchor.z);
      group.add(link);
      rope.segmentMeshes.push(link);
    }

    const head = new THREE.Group();
    head.position.set(anchor.x, anchor.y + length, anchor.z);
    group.add(head);
    rope.headMeshGroup = head;

    if (!group.userData._verletRopes) group.userData._verletRopes = [];
    group.userData._verletRopes.push(rope);
    return head;
  },

  /**
   * A ball bristling with spikes, distributed evenly over the sphere rather
   * than in rings (the Fibonacci placement is what stops them lining up into
   * visible bands).
   */
  spikeBall(radius, mat, opts) {
    const o = opts || {};
    const g = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(radius, this.seg(o.detail || 12, 7), this.seg(o.detail || 10, 6)), mat);
    g.add(ball);
    const count = this.isLowDetail() ? Math.round((o.spikes || 10) * 0.6) : (o.spikes || 10);
    const len = o.spikeLength === undefined ? radius * 0.55 : o.spikeLength;
    const geo = new THREE.ConeGeometry(radius * 0.19, len, o.spikeSides || 4);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const spike = new THREE.Mesh(geo, o.spikeMat || mat);
      const phi = Math.acos(1 - 2 * (i + 0.5) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const n = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      spike.position.copy(n).multiplyScalar(radius + len * 0.4);
      spike.quaternion.setFromUnitVectors(up, n);
      g.add(spike);
    }
    return g;
  },

  /**
   * Steps the Verlet simulation for a single rope.
   * @param {object} rope - rope instance from createVerletRope
   * @param {number} dt - delta time in seconds (capped internally)
   * @param {THREE.Vector3} anchorWorld - current world-space anchor position
   * @param {number} [worldScale=1] - uniform scale of the model the rope hangs
   *   off. The simulation runs in world space (so a swing actually flings the
   *   chain) while rest lengths and gravity are authored in model units, so
   *   both have to be converted or the rope collapses into its anchor.
   */
  // Lazily allocated module-scope scratch objects reused across rope updates
  // to avoid per-point/per-constraint THREE allocations every frame.
  _ensureRopeScratch() {
    if (this._ropeScratch) return this._ropeScratch;
    this._ropeScratch = {
      vel: new THREE.Vector3(),
      diff: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      quat: new THREE.Quaternion()
    };
    return this._ropeScratch;
  },

  tickRope(rope, dt, anchorWorld, worldScale) {
    dt = Math.min(dt, 0.033); // cap at ~30fps equivalent to prevent explosion
    const pts = rope.points;
    const scale = (worldScale && worldScale > 0) ? worldScale : 1;
    const g = rope.gravity * scale;
    const damp = rope.damping;
    const s = this._ensureRopeScratch();

    // Update anchor
    if (anchorWorld) {
      // A changed scale invalidates every cached point position (they are in
      // world space), so re-hang the rope from the anchor at the new spacing
      // instead of letting the constraint solver drag it there over frames.
      if (rope._lastScale !== scale) {
        rope._lastScale = scale;
        for (let i = 0; i < pts.length; i++) {
          const rest = (rope.constraints[Math.max(0, i - 1)] || { length: 0 }).length * scale;
          pts[i].pos.set(anchorWorld.x, anchorWorld.y - i * rest, anchorWorld.z);
          pts[i].prev.copy(pts[i].pos);
        }
      }
      pts[0].pos.copy(anchorWorld);
      pts[0].prev.copy(anchorWorld);
    }

    // Verlet integration for each non-pinned point
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].pinned) continue;
      const p = pts[i];
      const vel = s.vel.subVectors(p.pos, p.prev);
      vel.multiplyScalar(damp);

      // Heavier end mass pulls down harder
      const massFactor = (i === pts.length - 1) ? rope.endMass : 1.0;

      p.prev.copy(p.pos);
      p.pos.add(vel);
      p.pos.y += g * massFactor * dt * 60; // gravity scaled by dt
    }

    // Constraint solving iterations
    for (let iter = 0; iter < rope.iterations; iter++) {
      for (let c = 0; c < rope.constraints.length; c++) {
        const con = rope.constraints[c];
        const a = pts[con.a];
        const b = pts[con.b];
        const diff = s.diff.subVectors(b.pos, a.pos);
        const dist = diff.length();
        if (dist < 0.0001) continue;
        const error = (dist - con.length * scale) / dist;
        const correction = diff.multiplyScalar(error * 0.5 * rope.stiffness);

        if (!a.pinned) a.pos.add(correction);
        if (!b.pinned) b.pos.sub(correction);
      }
    }
  },

  /**
   * Updates the visual meshes of a rope to match the physics state.
   * @param {object} rope - rope instance
   * @param {THREE.Matrix4} [invWorldMatrix] - inverse of model's world matrix for local-space conversion
   */
  updateRopeMeshes(rope, invWorldMatrix) {
    const pts = rope.points;
    const s = this._ensureRopeScratch();

    for (let i = 0; i < rope.segmentMeshes.length; i++) {
      const mesh = rope.segmentMeshes[i];
      if (!mesh || i + 1 >= pts.length) continue;

      const a = s.a.copy(pts[i].pos);
      const b = s.b.copy(pts[i + 1].pos);

      // Transform from world space back to model local space
      if (invWorldMatrix) {
        a.applyMatrix4(invWorldMatrix);
        b.applyMatrix4(invWorldMatrix);
      }

      const mid = s.mid.copy(a).add(b).multiplyScalar(0.5);
      mesh.position.copy(mid);

      // Orient mesh along the segment direction
      const dir = s.dir.subVectors(b, a);
      const len = dir.length();
      if (len > 0.0001) {
        dir.normalize();
        const quat = s.quat.setFromUnitVectors(s.up, dir);
        mesh.quaternion.copy(quat);
      }
    }

    // Update head mesh group position (for flail ball, whip tip, etc.)
    if (rope.headMeshGroup && pts.length > 1) {
      const lastPt = s.a.copy(pts[pts.length - 1].pos);
      if (invWorldMatrix) {
        lastPt.applyMatrix4(invWorldMatrix);
      }
      rope.headMeshGroup.position.copy(lastPt);
    }
  },

  // Helper to add grip wrap rings to a hilt
  addGripWrap(group, rand, hHeight, hRadiusTop, hRadiusBottom, wrapMat) {
    const wrapSegments = 3 + Math.floor(rand() * 3);
    const wrapThickness = 0.003;
    const torusR = (hRadiusTop + hRadiusBottom) / 2;
    for (let i = 0; i < wrapSegments; i++) {
      const t = i / (wrapSegments - 1);
      const ringY = hHeight / 2 - hHeight * t;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(torusR * 1.1, wrapThickness, 4, 8), wrapMat);
      ring.position.y = ringY;
      ring.rotation.x = Math.PI / 2 + (rand() * 0.1 - 0.05);
      group.add(ring);
    }
  },

  // Helper to create a procedural pommel at the bottom of the hilt
  createProceduralPommel(rand, hHeight, metalMat, gemMat) {
    const pommelGroup = new THREE.Group();
    const type = Math.floor(rand() * 5);
    const size = 0.02 + rand() * 0.015;
    let geom;

    switch (type) {
      case 0: // Sphere
        geom = new THREE.SphereGeometry(size, 8, 8);
        break;
      case 1: // Faceted Gem (Octahedron)
        geom = new THREE.OctahedronGeometry(size, 0);
        break;
      case 2: // Torus (Ring)
        geom = new THREE.TorusGeometry(size, size * 0.3, 4, 8);
        break;
      case 3: // Crescent/Winged Cap
        geom = new THREE.BoxGeometry(size * 2, size * 0.5, size * 0.6);
        break;
      case 4: // Flat Cylinder Nut
      default:
        geom = new THREE.CylinderGeometry(size, size, size * 0.6, 6);
        break;
    }

    const pommelMesh = new THREE.Mesh(geom, metalMat);
    pommelMesh.position.y = -hHeight;
    pommelGroup.add(pommelMesh);

    // Occasional pommel gem
    if (rand() > 0.4 && type !== 2) {
      const gemGeo = new THREE.SphereGeometry(size * 0.4, 4, 4);
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.y = -hHeight;
      if (type === 3) gem.position.y += size * 0.25;
      pommelGroup.add(gem);
    }

    return pommelGroup;
  },

  // Helper to create a procedural guard
  createProceduralGuard(rand, metalMat, gemMat, scaleFactor = 1.0) {
    const guardGroup = new THREE.Group();
    const type = Math.floor(rand() * 4);
    const width = (0.1 + rand() * 0.08) * scaleFactor;
    const height = (0.02 + rand() * 0.015) * scaleFactor;
    const depth = (0.03 + rand() * 0.02) * scaleFactor;

    switch (type) {
      case 0: { // Straight Crossguard
        const main = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), metalMat);
        guardGroup.add(main);
        // Small decorative tips
        const tipGeo = new THREE.SphereGeometry(height * 0.8, 6, 6);
        const leftTip = new THREE.Mesh(tipGeo, metalMat);
        leftTip.position.x = -width / 2;
        const rightTip = leftTip.clone();
        rightTip.position.x = width / 2;
        guardGroup.add(leftTip);
        guardGroup.add(rightTip);
        break;
      }
      case 1: { // Curved/Winged Guard
        // Left wing
        const curveL = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(-width * 0.25, height * 1.5, 0),
          new THREE.Vector3(-width * 0.5, height * 2.0, 0)
        );
        const wingL = new THREE.Mesh(new THREE.TubeGeometry(curveL, 6, height * 0.4, 4, false), metalMat);
        // Right wing
        const curveR = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(width * 0.25, height * 1.5, 0),
          new THREE.Vector3(width * 0.5, height * 2.0, 0)
        );
        const wingR = new THREE.Mesh(new THREE.TubeGeometry(curveR, 6, height * 0.4, 4, false), metalMat);
        guardGroup.add(wingL);
        guardGroup.add(wingR);
        break;
      }
      case 2: { // Disc / Ring Guard
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.35, width * 0.35, height, 8), metalMat);
        disc.rotation.x = Math.PI / 2;
        guardGroup.add(disc);
        break;
      }
      case 3: { // Heavy Swept Basket/Torus guard
        const torus = new THREE.Mesh(new THREE.TorusGeometry(width * 0.25, height * 0.5, 4, 8), metalMat);
        torus.rotation.x = Math.PI / 2;
        guardGroup.add(torus);
        break;
      }
    }

    // Embed glowing gem in the center
    if (rand() > 0.3) {
      const gemGeo = new THREE.OctahedronGeometry(height * 0.7, 0);
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(0, 0, depth * 0.4);
      guardGroup.add(gem);
      const gemBack = gem.clone();
      gemBack.position.z = -depth * 0.4;
      guardGroup.add(gemBack);
    }

    return guardGroup;
  },

  // ============================================================
  // DEDICATED CUSTOM MODEL METHODS
  // ============================================================

  // ============================================================
  // Bespoke weapon models
  // ============================================================
  // Shared construction helpers. Every model in this file follows the same
  // convention: the weapon runs along +Y with the grip below the origin, the
  // width runs along X and the thickness along Z.

  _mat(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.5, metalness: 0.2 }, opts || {}));
  },
  _steel(color, rough) {
    return this._mat(color, { roughness: rough === undefined ? 0.25 : rough, metalness: 0.9 });
  },
  _cast(color) {
    return this._mat(color, { roughness: 0.5, metalness: 0.75 });
  },
  _wood(color) {
    return this._mat(color, { roughness: 0.9, metalness: 0.0 });
  },
  _glow(color, intensity) {
    return this._mat(color, {
      roughness: 0.15, metalness: 0.1,
      emissive: color, emissiveIntensity: intensity === undefined ? 0.7 : intensity
    });
  },

  /**
   * Flat plate cut to a 2D outline and extruded along Z. This is what gives
   * each bespoke blade its own silhouette for the price of a couple of dozen
   * triangles: a kukri, a cleaver and a khopesh are the same call with
   * different points.
   * @param {Array<[number,number]>} points - outline in the X/Y plane
   */
  _plate(points, thickness, material) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 1
    });
    geo.translate(0, 0, -thickness / 2);
    return new THREE.Mesh(geo, material);
  },

  /**
   * Outline of a blade whose spine bends by `curve` (positive bends toward +X,
   * i.e. forward) and narrows toward the tip.
   * @param {number} backBias - how much narrower the back edge is than the
   *   cutting edge; 1 is symmetric, 0.2 is a single-edged blade.
   */
  _bladeOutline(length, width, curve, segments, backBias, opts) {
    const o = opts || {};
    const seg = this.seg(segments || 6, 4);
    const bias = backBias === undefined ? 1 : backBias;
    const belly = o.belly === undefined ? 0 : o.belly;
    const front = [], back = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const cx = curve * length * t * t;
      const y = t * length;
      // Sharpen toward the tip, with an optional belly that widens the middle.
      const taper = 1 - Math.pow(t, o.taperPow === undefined ? 2.4 : o.taperPow);
      const half = Math.max(width * 0.03, (width / 2) * (taper + belly * Math.sin(t * Math.PI)));
      front.push([cx + half, y]);
      back.push([cx - half * bias, y]);
    }
    back.reverse();
    return front.concat(back);
  },

  /** Handle, optional wrap and optional pommel. Returns the handle length. */
  _hilt(group, rand, opts) {
    const o = opts || {};
    const h = o.height || 0.16;
    const rTop = o.rTop || 0.018;
    const rBot = o.rBot === undefined ? rTop * 0.85 : o.rBot;
    const y0 = o.offset || 0;
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, this.seg(o.sides || 8, 5)),
      o.mat
    );
    handle.position.y = y0 - h / 2;
    if (o.flat) handle.scale.z = o.flat;
    group.add(handle);
    if (o.wrapMat && this.wantsTrim()) {
      this.addGripWrap(handle, rand, h, rTop, rBot, o.wrapMat);
    }
    if (o.pommelMat) {
      let geo;
      if (o.pommel === 'disc') geo = new THREE.CylinderGeometry(rTop * 1.6, rTop * 1.6, rTop * 0.7, this.seg(10, 6));
      else if (o.pommel === 'wheel') geo = new THREE.CylinderGeometry(rTop * 2.0, rTop * 2.0, rTop * 0.8, this.seg(12, 6));
      else if (o.pommel === 'nut') geo = new THREE.CylinderGeometry(rTop * 1.2, rTop * 1.4, rTop * 1.1, 6);
      else geo = new THREE.SphereGeometry(rTop * 1.4, this.seg(8, 5), this.seg(6, 4));
      const p = new THREE.Mesh(geo, o.pommelMat);
      p.position.y = y0 - h;
      if (o.pommel === 'disc' || o.pommel === 'wheel') p.rotation.x = Math.PI / 2;
      group.add(p);
    }
    return h;
  },

  /** Straight bar crossguard with optional swept tips. */
  _crossguard(group, mat, width, thickness, depth, sweep) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), mat);
    group.add(bar);
    if (sweep && this.wantsTrim()) {
      for (const s of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.ConeGeometry(thickness * 0.75, thickness * 2.2, this.seg(6, 4)), mat);
        tip.position.set(s * width / 2, thickness * 0.9, 0);
        tip.rotation.z = -s * sweep;
        group.add(tip);
      }
    }
    return bar;
  },

  /** A row of rivet heads down a handle scale. */
  _rivets(group, mat, count, yStart, yStep, radius, z) {
    if (!this.wantsTrim()) return;
    for (let i = 0; i < count; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, radius * 0.8, this.seg(6, 4)), mat);
      r.rotation.x = Math.PI / 2;
      r.position.set(0, yStart + i * yStep, z);
      group.add(r);
      const back = r.clone();
      back.position.z = -z;
      group.add(back);
    }
  },

  // ============================================================
  // Model families
  // ============================================================
  // The models themselves live in the Weapon3D_* files beside this one and are
  // injected at runtime (see the loader at the bottom), exactly as the 3D
  // enemy battlers load their 3DBattler_* families. None of them is listed in
  // plugins.js; adding a family means adding its name to WEAPON3D_FAMILIES.
  //
  // A family calls registerFamily() with:
  //   models  { methodName: fn }   builders, bound onto this object
  //   unique  { weaponId: name }   bespoke model per database id (optional)
  UNIQUE_MODELS: {},

  _familyOwners: {},

  // ============================================================
  // Unarmed
  // ============================================================
  // A character with nothing in their hand still has a hand, and what it
  // looks like depends on what they are: a Humanoid's fist, a Dragon's claw
  // and a Slime's pseudopod are not the same weapon. Builders are registered
  // per Archetypes.json key rather than per weapon id, since there is no
  // database weapon to key on.
  UNARMED_MODELS: {},
  DEFAULT_ARCHETYPE: 'Humanoid',

  /**
   * The archetype whose fist a character shows. A hybrid ("Dragon / Elven")
   * uses the FIRST of its archetypes, so a mixed character always reads as
   * one thing rather than something in between.
   */
  archetypeOf(actor) {
    try {
      if (actor && window.HealthCore && typeof window.HealthCore.getActorArchetypeKeys === 'function') {
        const keys = window.HealthCore.getActorArchetypeKeys(actor);
        if (keys && keys.length && this.UNARMED_MODELS[keys[0]]) return keys[0];
        if (keys && keys.length) return keys[0];
      }
      const raw = actor && actor._currentArchetype;
      if (raw) return String(raw).split('/')[0].trim();
    } catch (e) { /* no health system loaded */ }
    return this.DEFAULT_ARCHETYPE;
  },

  /**
   * A stand-in weapon for an empty hand, so the whole rest of the pipeline
   * (cache, merge, pose, procedural attack) works unchanged. It is typed as a
   * Glove, which is what an unarmed strike is: id is derived from the
   * archetype name so the model cache keys on it.
   */
  unarmedWeaponFor(actor) {
    const archetype = this.archetypeOf(actor);
    if (!this._unarmedWeapons) this._unarmedWeapons = {};
    if (this._unarmedWeapons[archetype]) return this._unarmedWeapons[archetype];

    // Negative ids can never collide with a real database weapon.
    let h = 0;
    for (let i = 0; i < archetype.length; i++) h = (Math.imul(h, 31) + archetype.charCodeAt(i)) | 0;
    const weapon = {
      id: -1000 - (Math.abs(h) % 100000),
      name: archetype,
      wtypeId: 11,                       // Glove: the punch pose and motion
      note: '<Weight: 900>',
      unarmedArchetype: archetype,
      weaponAnimations: []
    };
    this._unarmedWeapons[archetype] = weapon;
    return weapon;
  },

  /**
   * A shield is an off-hand armour, and hands hold weapons and shields alike
   * (ItemSystem/ItemSystemEquipment.js), so one has to be able to appear in
   * frame beside a sword. Wrapping it as a weapon is all it takes: the cache,
   * the fit, the pose and the procedural attack clip all work off the same
   * fields. It is typed as Heavy, which is how a shield is swung when it is
   * swung at all, and keeps the armour's own <Weight:> so a buckler and a
   * tower shield are not built to the same silhouette.
   */
  shieldWeaponFor(armor) {
    if (!armor) return null;
    if (!this._shieldWeapons) this._shieldWeapons = {};
    if (this._shieldWeapons[armor.id]) return this._shieldWeapons[armor.id];
    const weapon = {
      // Negative, and a different band from the unarmed fists, so neither can
      // collide with a database weapon or with each other in the model cache.
      id: -200000 - armor.id,
      name: armor.name,
      wtypeId: 3,
      note: armor.note || '',
      meta: armor.meta || {},
      iconIndex: armor.iconIndex,
      shieldArmorId: armor.id,
      weaponAnimations: []
    };
    this._shieldWeapons[armor.id] = weapon;
    return weapon;
  },

  /** Builds the fist for an archetype, falling back to the default one. */
  buildUnarmed(weapon, rand) {
    const key = weapon.unarmedArchetype;
    const name = this.UNARMED_MODELS[key] || this.UNARMED_MODELS[this.DEFAULT_ARCHETYPE];
    if (name && typeof this[name] === 'function') return this[name](weapon, rand);
    if (!this._missingBuilders) this._missingBuilders = {};
    if (!this._missingBuilders['unarmed:' + key]) {
      this._missingBuilders['unarmed:' + key] = true;
      console.warn('[WeaponSystemProcedural] no unarmed model for archetype ' + key);
    }
    return null;
  },

  // ============================================================
  // The hand on the end of the punch
  // ============================================================
  // MOTIONS.punch moves the whole arm; this moves the hand it ends in. Two
  // things separate a punch that was thrown from a fist being carried across
  // the screen, and neither of them is travel: the hand turns over against
  // the forearm on its way out, because a fist lands on its knuckles rather
  // than on its thumb, and the fingers, carried loose the rest of the time,
  // clench on the one frame the blow arrives. Both are declared by the model
  // as plain data (Weapon3D_Unarmed tags its hand node and every digit with
  // `punch`) so that a cached model can still be cloned, exactly as the
  // ambient moving parts are.

  // Windows of the punch's own duration: the fist loosens in the chamber,
  // shuts on the way out, holds through the impact and opens on the way back.
  PUNCH_WINDOWS: { open: 0.20, shut: 0.36, hold: 0.56, back: 0.82 },
  // How far it loosens first, as a share of how hard it then shuts: a hand
  // cannot tighten from nothing, and that slack is what makes the clench read
  // as a clench rather than as a fist that was always closed.
  PUNCH_SLACK: 0.42,

  /** The hand node and digits a punch drives, cached on the model. */
  punchPartsOf(model) {
    if (model._punchParts) return model._punchParts;
    const parts = [];
    model.traverse((obj) => {
      const ud = obj.userData;
      if (!ud || !ud.punch) return;
      ud._punchRest = { x: obj.rotation.x, z: obj.rotation.z };
      parts.push(obj);
    });
    model._punchParts = parts;
    return parts;
  },

  beginPunch(model, durationMs) {
    if (!model) return;
    if (!this.punchPartsOf(model).length) return;
    model._punch = { elapsed: 0, duration: Math.max(1, durationMs || 320) };
  },

  /**
   * Drives the clench and the turn of the wrist over the clip. Cheap when
   * nothing is being thrown: a single property check.
   */
  tickPunch(model, dtMs) {
    const punch = model && model._punch;
    if (!punch) return;
    const parts = this.punchPartsOf(model);
    if (!parts.length) { model._punch = null; return; }

    punch.elapsed += dtMs;
    const t = punch.elapsed / punch.duration;
    const w = this.PUNCH_WINDOWS;
    const slack = this.PUNCH_SLACK;
    // Negative while the hand is chambered and loose, 1 on the frames it is
    // shut, and unwound rather than snapped back on the recovery.
    let k;
    if (t <= w.open) {
      k = -slack * (t / w.open);
    } else if (t < w.shut) {
      const u = (t - w.open) / (w.shut - w.open);
      k = -slack + (1 + slack) * (1 - Math.pow(1 - u, 4));
    } else if (t <= w.hold) {
      k = 1;
    } else if (t < w.back) {
      const u = (t - w.hold) / (w.back - w.hold);
      k = 1 - u * u;
    } else {
      k = 0;
    }

    const done = t >= 1;
    for (let i = 0; i < parts.length; i++) {
      const obj = parts[i];
      const ud = obj.userData;
      const rest = ud._punchRest;
      const p = ud.punch;
      const bend = p.curl !== undefined ? p.curl : (p.pitch || 0);
      obj.rotation.x = rest.x + (done ? 0 : bend * k);
      if (p.roll) obj.rotation.z = rest.z + (done ? 0 : p.roll * k);
    }
    if (done) model._punch = null;
  },

  registerFamily(family) {
    if (!family) return;
    const owner = family.name || 'anonymous';
    if (family.models) {
      for (const key of Object.keys(family.models)) {
        const previous = this._familyOwners[key];
        if (previous && previous !== owner) {
          console.warn('[WeaponSystemProcedural] ' + owner + ' overrides ' + key + ' from ' + previous);
        }
        this._familyOwners[key] = owner;
        this[key] = family.models[key];
      }
    }
    if (family.unarmed) {
      for (const key of Object.keys(family.unarmed)) {
        this.UNARMED_MODELS[key] = family.unarmed[key];
      }
    }
    if (family.unique) {
      for (const id of Object.keys(family.unique)) {
        this.UNIQUE_MODELS[id] = family.unique[id];
      }
    }
    // A family arriving after something was already drawn (a hot reload, a
    // late-injected script) must not leave stale prototypes behind.
    if (this._modelCache.size) this.clearModelCache();
  },

  // Patching Sprite_3DWeapon dynamically
  patchSprite3DWeapon() {
    if (!window.Sprite_3DWeapon || Sprite_3DWeapon.prototype._proceduralPatched) return;
    Sprite_3DWeapon.prototype._proceduralPatched = true;

    // Reused across frames by the update override below (THREE is available
    // here since patching happens at runtime). Avoids per-frame allocations.
    const _CHAIN_TWIST = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const _anchorScratch = new THREE.Vector3();

    // Uniform scale for the model in its idle pose.
    //
    // GLB models keep their authored <3DScale>. Procedural models are measured
    // against the screen instead (see fitScaleFor): they used to be drawn at a
    // flat 7000x / 22000x, which put a sword roughly ten screen-heights tall.
    // The result is cached and only recomputed if the game resolution changes.
    Sprite_3DWeapon.prototype._baseScale = function() {
      const w = this._weapon;
      if (w.model3d) return w.model3dScale || 1.0;
      const screenH = (typeof Graphics !== 'undefined' && Graphics.height) ? Graphics.height : 624;
      if (this._fitScale && this._fitScaleFor === screenH) return this._fitScale;
      const tweak = w.model3dScaleAuthored ? (w.model3dScale || 1) : 1;
      this._fitScale = WeaponSystemProcedural.fitScaleFor(this._model, w) * tweak;
      this._fitScaleFor = screenH;
      return this._fitScale;
    };

    // Screen-space nudge from the shared weapon anchor, in game pixels. Both
    // come from WeaponSystemProcedural.anchorOffsetFor so the tools viewer can
    // reproduce the exact battle pose.
    Sprite_3DWeapon.prototype._anchorOffsetX = function() {
      return WeaponSystemProcedural.anchorOffsetFor(this._weapon).x;
    };
    Sprite_3DWeapon.prototype._anchorOffsetY = function() {
      return WeaponSystemProcedural.anchorOffsetFor(this._weapon).y;
    };

    // How quickly a gun swings onto a new target, as the time constant of an
    // exponential ease in milliseconds. Short enough to have arrived before the
    // shot goes off, long enough to read as the character turning the muzzle.
    const AIM_EASE_MS = 110;

    /**
     * Turns a gun to face what it is shooting at. The aim point in game pixels
     * is handed to the sprite once a frame by Spriteset_Battle
     * (weaponAimPoint); with none, the weapon settles back to its resting pose
     * across the battlefield. Writes _baseRotation, which every pose below
     * (idle sway, recoil keyframes) is built on top of, so the kick of a shot
     * still reads as a kick from wherever the gun is pointing.
     */
    Sprite_3DWeapon.prototype._updateAim = function(deltaMs) {
      if (!WeaponSystemProcedural.aimsAtTarget(this._weapon)) return;

      const rest = WeaponSystemProcedural.baseRotationFor(this._weapon);
      let want = rest;
      if (this._aimPoint) {
        const off = WeaponSystemProcedural.anchorOffsetFor(this._weapon);
        // Where the weapon itself sits on screen: world Y grows upward, so the
        // anchor's Y nudge counts backwards against screen coordinates.
        want = WeaponSystemProcedural.aimRotationFor(
          this._aimPoint.x - (this._screenX + off.x),
          this._aimPoint.y - (this._screenY - off.y)
        );
      }

      if (!this._aimRot) this._aimRot = { x: rest.x, y: rest.y, z: rest.z };
      const cur = this._aimRot;
      const k = 1 - Math.exp(-deltaMs / AIM_EASE_MS);
      cur.x += (want.x - cur.x) * k;
      cur.y += (want.y - cur.y) * k;
      cur.z += (want.z - cur.z) * k;
      this._baseRotation = cur;
    };

    // Reset 3D weapon back to idle first-person pose
    Sprite_3DWeapon.prototype._resetToIdle = function() {
      if (!this._model) return;
      // A weapon fading out at the end of a battle is never raised again.
      if (this._exiting) return;
      this._model.visible = true;
      this._visible = true;

      this._model.position.set(
        this._worldX(this._screenX) + this._anchorOffsetX(),
        this._worldY(this._screenY) + this._anchorOffsetY(),
        0
      );

      const r = this._baseRotation;
      this._model.rotation.set(
        THREE.MathUtils.degToRad(r.x),
        THREE.MathUtils.degToRad(r.y),
        THREE.MathUtils.degToRad(r.z)
      );

      const s = this._baseScale();
      this._model.scale.set(s, s, s);
    };

    // Override _loadModel to support both procedural and GLB models with always-visible behavior
    Sprite_3DWeapon.prototype._loadModel = function() {
      this._baseRotation = WeaponSystemProcedural.baseRotationFor(this._weapon);

      if (!this._weapon.model3d) {
        if (!window.THREE) return;
        this._model = WeaponSystemProcedural.createModel(this._weapon);
        if (this._model) {
          if (window.PSXShader) window.PSXShader.applyToObject(this._model);

          // Rotate first: the fit measures the model's on-screen footprint,
          // which depends on the idle pose.
          const r = this._baseRotation;
          this._model.rotation.set(
            THREE.MathUtils.degToRad(r.x),
            THREE.MathUtils.degToRad(r.y),
            THREE.MathUtils.degToRad(r.z)
          );
          const s = this._baseScale();
          this._model.scale.set(s, s, s);

          this._model.position.set(
            this._worldX(this._screenX) + this._anchorOffsetX(),
            this._worldY(this._screenY) + this._anchorOffsetY(),
            0
          );
          this._model.visible = true; // ALWAYS VISIBLE!
          this._visible = true;       // ALWAYS VISIBLE!
          window.WeaponThreeScene.scene.add(this._model);

          if (this._pendingAnimation != null) {
            const pending = this._pendingAnimation;
            this._pendingAnimation = null;
            this.playAnimation(pending);
          }
        }
        return;
      }

      // GLB model loading
      if (!window.THREE || !THREE.GLTFLoader) return;
      const loader = new THREE.GLTFLoader();
      loader.load(
        `models/${this._weapon.model3d}`,
        (gltf) => {
          this._model = gltf.scene;
          if (window.PSXShader) window.PSXShader.applyToObject(this._model);
          const s = this._weapon.model3dScale || 1.0;
          this._model.scale.set(s, s, s);
          const r = this._baseRotation;
          this._model.rotation.set(
            THREE.MathUtils.degToRad(r.x),
            THREE.MathUtils.degToRad(r.y),
            THREE.MathUtils.degToRad(r.z)
          );
          this._model.position.set(this._worldX(this._screenX), this._worldY(this._screenY), 0);
          this._model.visible = true; // ALWAYS VISIBLE!
          this._visible = true;       // ALWAYS VISIBLE!
          window.WeaponThreeScene.scene.add(this._model);

          if (gltf.animations && gltf.animations.length > 0) {
            this._mixer = new THREE.AnimationMixer(this._model);
            this._mixer.addEventListener('finished', () => {
              this._clipPlaying = false;
              this._resetToIdle();
            });
            this._clips = {};
            gltf.animations.forEach(clip => {
              this._clips[clip.name] = this._mixer.clipAction(clip);
            });
          }

          if (this._pendingAnimation != null) {
            const pending = this._pendingAnimation;
            this._pendingAnimation = null;
            this.playAnimation(pending);
          }
        },
        undefined,
        (err) => console.error('[Sprite_3DWeapon] Failed to load model:', this._weapon.model3d, err)
      );
    };

    // Override _applyKeyframe to reset back to idle instead of hiding the weapon at the end of keyframes
    Sprite_3DWeapon.prototype._applyKeyframe = function(deltaMs) {
      this._animElapsed += deltaMs;
      const dur = this._animData.duration || 500;
      const t = Math.min(this._animElapsed / dur, 1.0);
      const frames = this._animData.frames;
      if (!frames || frames.length === 0) return;

      const k = WeaponSystemProcedural.sampleKeyframes(frames, t);
      // Turned and shortened so the blow lands on what is being hit.
      WeaponSystemProcedural.applyStrikeTransform(k, this._strikeXf);
      const off = WeaponSystemProcedural.anchorOffsetFor(this._weapon);

      this._model.position.set(
        this._worldX(this._screenX) + off.x + k.x,
        this._worldY(this._screenY) + off.y + k.y,
        k.z
      );
      const r = this._baseRotation;
      this._model.rotation.set(
        THREE.MathUtils.degToRad(r.x + k.rx),
        THREE.MathUtils.degToRad(r.y + k.ry),
        THREE.MathUtils.degToRad(r.z + k.rz)
      );

      const s = this._baseScale() * k.scale;
      this._model.scale.set(s, s, s);

      if (t >= 1.0) {
        this._animData = null;
        this._resetToIdle();
      }
    };

    // Override playAnimation to correctly display/hide procedural/GLB models and trigger custom animations
    // Attack motion is GENERATED for this weapon, not looked up. See
    // WeaponSystemProcedural.buildAttack: the clip's amplitude, timing and
    // impact come from the model's measured length and the weapon's <Weight:>,
    // so a paring knife and a Zweihander swinging the same skill do not play
    // the same animation scaled up.
    /**
     * Locks the swing onto wherever the target was standing when the blow
     * started, so a blow does not wander after an enemy that moves or dies
     * halfway through it.
     */
    Sprite_3DWeapon.prototype._prepareStrike = function() {
      this._strikeXf = WeaponSystemProcedural.strikeTransformFor(
        this._animData, this._weapon, this._screenX, this._screenY, this._aimPoint);
    };

    Sprite_3DWeapon.prototype.playAnimation = function(name) {
      this._animElapsed = 0;
      this._animData = null;
      this._strikeXf = null;
      this._clipPlaying = false; // Reset clip status when starting any animation

      if (!this._model) {
        // '' rather than null: no name means "this weapon's own motion",
        // which is a real request and must survive the wait for the model.
        this._pendingAnimation = name || '';
        return;
      }

      this._model.visible = true;
      this._visible = true;

      // An authored GLB clip always wins: it was made for that model.
      if (this._clips && this._clips[name]) {
        this.playClip(name);
        return;
      }
      if (name === 'Shoot' && this._clips && this._clips['Shoot']) {
        this.playClip('Shoot');
        return;
      }

      // Procedural motion for procedural models.
      if (!this._weapon.model3d) {
        this._animData = WeaponSystemProcedural.buildAttack(this._weapon, name, this._model);
        if (this._animData) { this._prepareStrike(); return; }
      }

      // GLB models with no clip of their own fall back to the shared table.
      const kf = window._weaponKeyframes3d;
      if (kf) {
        this._animData = kf[name] || kf['Swing'] || null;
        this._prepareStrike();
      } else {
        // '' rather than null: no name means "this weapon's own motion",
        // which is a real request and must survive the wait for the model.
        this._pendingAnimation = name || '';
      }
    };

    // Override playClip to track standard animation clip status
    const _Sprite_3DWeapon_playClip = Sprite_3DWeapon.prototype.playClip;
    Sprite_3DWeapon.prototype.playClip = function(clipName) {
      this._clipPlaying = true;
      if (_Sprite_3DWeapon_playClip) {
        _Sprite_3DWeapon_playClip.call(this, clipName);
      }
    };

    // Override update to execute subtle breathing, bobbing, and swaying animations when idle
    Sprite_3DWeapon.prototype.update = function() {
      const now = performance.now();
      const deltaMs = Math.min(this._lastTime ? now - this._lastTime : 16, 50);
      this._lastTime = now;

      if (!this._model) return;

      // Entry slide / exit fade first: it only moves the shared anchor
      // (_worldX), so every pose below is placed with it already folded in.
      if (this._updateTransition) this._updateTransition(deltaMs);
      // Same for the aim: it only writes _baseRotation.
      this._updateAim(deltaMs);

      if (this._mixer) this._mixer.update(deltaMs / 1000);

      if (this._animData) {
        this._idleTime = 0;
        this._applyKeyframe(deltaMs);
      } else if (!this._clipPlaying) {
        // First-person idle breathing, tuned per weapon type.
        this._idleTime = (this._idleTime || 0) + deltaMs;
        const sway = WeaponSystemProcedural.idleSway(this._weapon, this._idleTime);
        const off = WeaponSystemProcedural.anchorOffsetFor(this._weapon);

        this._model.position.set(
          this._worldX(this._screenX) + off.x + sway.dx,
          this._worldY(this._screenY) + off.y + sway.dy,
          0
        );

        const r = this._baseRotation;
        this._model.rotation.set(
          THREE.MathUtils.degToRad(r.x) + sway.drx,
          THREE.MathUtils.degToRad(r.y),
          THREE.MathUtils.degToRad(r.z) + sway.drz
        );

        const baseScale = this._baseScale();
        this._model.scale.set(baseScale, baseScale, baseScale);
      }

      // ---- Moving parts declared by the model itself ----
      // Gears, drifting shards, pulsing runes. Costs one traversal the first
      // frame and a short loop afterwards; a model with no moving parts is a
      // single array-length check.
      if (!this._weapon.model3d) {
        WeaponSystemProcedural.tickModelParts(this._model, deltaMs);
        // Trigger, action, ejected case and muzzle flash, while a shot is
        // still working through the gun.
        WeaponSystemProcedural.tickGun(this._model, deltaMs);
        // The blade leaving a sword cane's shaft and going back into it.
        WeaponSystemProcedural.tickCane(this._model, deltaMs);
        // The string coming back to the cheek, the limbs bending with it and
        // the arrow leaving. Last, so it owns the parts it drives.
        WeaponSystemProcedural.tickBow(this._model, deltaMs);
        // A bare hand clenching into the punch it is throwing, and turning
        // over on the wrist as it goes. Same reason it comes after the
        // ambient parts: it owns the rotations it writes.
        WeaponSystemProcedural.tickPunch(this._model, deltaMs);
      }

      // ---- Tick Verlet rope physics for whips and flails ----
      if (this._model && !this._weapon.model3d) {
        const dtSec = deltaMs / 1000;

        // Collect all ropes attached to this model. Cache the list on the model
        // so it isn't rebuilt every frame; a new model has no cache, which
        // naturally invalidates it when the weapon model changes.
        let ropes = this._model.userData._ropesCache;
        if (!ropes) {
          ropes = [];
          if (this._model.userData._verletRope) {
            ropes.push(this._model.userData._verletRope);
          }
          if (this._model.userData._verletRopes) {
            for (const r of this._model.userData._verletRopes) ropes.push(r);
          }
          this._model.userData._ropesCache = ropes;
        }

        if (ropes.length > 0) {
          // Compute world-space anchor: the model's handle tip (local y=0)
          // We need the model's world matrix to transform the local anchor
          this._model.updateMatrixWorld(true);
          if (!this._invWorldScratch) this._invWorldScratch = new THREE.Matrix4();
          const invWorld = this._invWorldScratch.copy(this._model.matrixWorld).invert();

          const worldScale = this._model.scale.x || 1;

          for (const rope of ropes) {
            // Transform rope's local anchor through model's world matrix
            const worldAnchor = _anchorScratch.copy(rope.anchorPos).applyMatrix4(this._model.matrixWorld);

            WeaponSystemProcedural.tickRope(rope, dtSec, worldAnchor, worldScale);
            WeaponSystemProcedural.updateRopeMeshes(rope, invWorld);

            // Apply alternating 90deg twist to chain link tori for interlocking look
            for (let si = 0; si < rope.segmentMeshes.length; si++) {
              const mesh = rope.segmentMeshes[si];
              if (mesh && mesh.userData._chainAlternate === false) {
                mesh.quaternion.multiply(_CHAIN_TWIST);
              }
            }
          }
        }
      }

      // Scene render is batched once per frame by the Spriteset_Battle
      // iterator (WeaponSystem.js) rather than once per weapon instance.
    };
  }
};

window.WeaponSystemProcedural = WeaponSystemProcedural;

//=============================================================================
// Model family auto-loader
//=============================================================================
// The builders are kept out of this file and out of plugins.js: they are
// injected here at load time, the same arrangement 3DBattlerSystem.js uses for
// its 3DBattler_* families. Scripts are appended with async=false so they run
// in list order, and a family that fails to arrive costs only the models it
// carried, never the rest of the system.
// One family per weapon type. Each owns the generic silhouette its type falls
// back to, the note-tagged one-offs of that type, and every bespoke per-weapon
// model in it.
const WEAPON3D_FAMILIES = [
  'Weapon3D_Light',       // wtypeId 1  knives, daggers, punch weapons
  'Weapon3D_Swords',      // wtypeId 2
  'Weapon3D_Heavy',       // wtypeId 3  hammers, maces, clubs
  'Weapon3D_Axes',        // wtypeId 4
  'Weapon3D_Whips',       // wtypeId 5
  'Weapon3D_Flails',      // the <Flail> rope subtype
  'Weapon3D_Staves',      // wtypeId 6
  'Weapon3D_Bows',        // wtypeId 7  bows and crossbows
  'Weapon3D_Projectiles', // wtypeId 8  thrown
  'Weapon3D_Guns',        // wtypeId 9
  'Weapon3D_Claws',       // wtypeId 10
  'Weapon3D_Gloves',      // wtypeId 11
  'Weapon3D_Spears',      // wtypeId 12 spears and polearms
  'Weapon3D_Types',       // the entries that declare no weapon type
  'Weapon3D_Unarmed'      // one fist per Archetypes.json archetype
];

(function loadWeapon3DFamilies() {
  const host = document.body || document.head || document.documentElement;
  if (!host) return;
  const dir = 'js/plugins/Weapon/';
  for (const name of WEAPON3D_FAMILIES) {
    const src = dir + name + '.js';
    if (document.querySelector('script[src="' + src + '"]')) continue; // already loaded
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.src = src;
    s.async = false; // preserve insertion order so dependencies load first
    s.defer = false;
    s.onerror = () => console.error('[WeaponSystemProcedural] Failed to load family: ' + src);
    host.appendChild(s);
  }
})();
