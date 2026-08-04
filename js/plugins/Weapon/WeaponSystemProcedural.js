/*:
 * @target MZ
 * @plugindesc Procedural 3D models for Weapon System
 * @author AntiGravity
 * @help
 * Generates procedural 3D models for weapons that do not have custom <3DModel> tags.
 */

var WeaponSystemProcedural = {
  createSeededRandom(seed) {
    let h = Math.abs(Math.sin(seed || 1) * 10000);
    return () => {
      h = Math.abs(Math.sin(h * 10000));
      return h;
    };
  },

  _textureCache: {},

  // Source art is 750x750 (and the effect PNGs are larger still), while a
  // weapon covers a few hundred screen pixels through a nearest-neighbour PSX
  // filter. Uploading the originals cost ~2.25 MB of VRAM each and a full-size
  // decode on the frame the weapon appeared, so every texture is downsampled
  // into a small power-of-two canvas instead (POT also makes RepeatWrapping
  // legal, which it never was at 750px).
  TEXTURE_SIZE: 128,

  getTexture(filename) {
    if (!filename) return null;
    if (typeof THREE === 'undefined') return null;
    const isImgTexture = filename.endsWith('.jpg');
    const path = isImgTexture ? `img/textures/${filename}` : `effects/MAGICALxSPIRAL/Texture/${filename}`;
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

  createModel(weapon) {
    if (!window.THREE) return null;

    const rand = this.createSeededRandom(weapon.id);
    const wtypeId = weapon.wtypeId || 1;
    const note = weapon.note || '';

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
      
      const tex = WeaponSystemProcedural.getRandomTexture(rand, type, texMemo);
      if (tex) {
        params.map = tex;
      }
      return new OriginalMeshStandardMaterial(params);
    };
    THREE.MeshStandardMaterial.prototype = OriginalMeshStandardMaterial.prototype;

    try {
      // Unique named model overrides (checked before generic type routing)
      if (note.match(/<Mjolnir>/i))         return this.createMjolnirModel(weapon, rand);
      if (note.match(/<FlySwatter>/i))      return this.createFlySwatterModel(weapon, rand);
      if (note.match(/<WarFan>/i))          return this.createWarFanModel(weapon, rand);
      if (note.match(/<Excalibur>/i))       return this.createExcaliburModel(weapon, rand);
      if (note.match(/<DragonBlade>/i))     return this.createDragonBladeModel(weapon, rand);
      if (note.match(/<MagicOrb>/i))        return this.createMagicOrbModel(weapon, rand);
      if (note.match(/<FoamFinger>/i))      return this.createFoamFingerModel(weapon, rand);
      if (note.match(/<Spatula>/i))         return this.createSpatulaModel(weapon, rand);
      if (note.match(/<CelestialHammer>/i)) return this.createCelestialHammerModel(weapon, rand);
      if (note.match(/<ChronosHammer>/i))   return this.createChronosHammerModel(weapon, rand);
      // Gun subtype overrides
      if (note.match(/<RocketLauncher>/i))  return this.createRocketLauncherModel(weapon, rand);
      if (note.match(/<Minigun>/i))         return this.createMinigunModel(weapon, rand);
      if (note.match(/<Flamethrower>/i))    return this.createFlamethrowerModel(weapon, rand);
      if (note.match(/<Shotgun>/i))         return this.createShotgunModel(weapon, rand);
      if (note.match(/<SniperRifle>/i))     return this.createSniperRifleModel(weapon, rand);
      if (note.match(/<SMG>/i))             return this.createSMGModel(weapon, rand);
      // Polearm / melee subtypes
      if (note.match(/<Halberd>/i))         return this.createHalberdModel(weapon, rand);
      if (note.match(/<Trident>/i))         return this.createTridentModel(weapon, rand);
      if (note.match(/<Nunchaku>/i))        return this.createNunchakuModel(weapon, rand);
      // Ranged / thrown subtypes
      if (note.match(/<Railgun>/i))         return this.createRailgunModel(weapon, rand);
      if (note.match(/<ArmCannon>/i))       return this.createArmCannonModel(weapon, rand);
      if (note.match(/<Crossbow>/i))        return this.createCrossbowModel(weapon, rand);
      if (note.match(/<Boomerang>/i))       return this.createBoomerangModel(weapon, rand);
      if (note.match(/<Chakram>/i))         return this.createChakramModel(weapon, rand);
      if (note.match(/<DroneLauncher>/i))   return this.createDroneLauncherModel(weapon, rand);
      // Unique named overrides
      if (note.match(/<Crown>/i))           return this.createCrownModel(weapon, rand);

      if (weapon.isWhip) return this.createWhipModel(weapon, rand);
      if (weapon.isFlail) return this.createFlailModel(weapon, rand);

      switch (wtypeId) {
        case 1: return this.createLightModel(weapon, rand);
        case 2: return this.createSwordModel(weapon, rand);
        case 3: return this.createHeavyModel(weapon, rand);
        case 4: return this.createAxeModel(weapon, rand);
        case 5: return this.createWhipModel(weapon, rand);
        case 6: return this.createStaffModel(weapon, rand);
        case 7: return this.createBowModel(weapon, rand);
        case 8: return this.createProjectileModel(weapon, rand);
        case 9: return this.createGunModel(weapon, rand);
        case 10: return this.createClawModel(weapon, rand);
        case 11: return this.createGloveModel(weapon, rand);
        case 12: return this.createSpearModel(weapon, rand);
        default: return this.createLightModel(weapon, rand);
      }
    } finally {
      THREE.MeshStandardMaterial = OriginalMeshStandardMaterial;
    }
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
    switch (weapon.wtypeId) {
      case 1:  return 0.46; // Light (dagger)
      case 2:  return 0.66; // Sword
      case 3:  return 0.72; // Heavy
      case 4:  return 0.70; // Axe
      case 5:  return 0.74; // Whip
      case 6:  return 0.84; // Staff
      case 7:  return 0.72; // Bow
      case 8:  return 0.34; // Projectile
      case 9:  return 0.58; // Gun (first-person)
      case 10: return 0.42; // Claw
      case 11: return 0.40; // Glove
      case 12: return 0.84; // Spear
      default: return 0.60;
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

  // Type 1: Light (Dagger)
  createLightModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const bladeColor = this.getRandomColor(rand, this.bladeColors);
    const guardColor = this.getRandomColor(rand, this.guardColors);
    const wrapColor = this.getRandomColor(rand, this.handleColors.filter(c => c !== handleColor));
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.85 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.9, metalness: 0.1 });
    const metalMat = new THREE.MeshStandardMaterial({ color: bladeColor, roughness: 0.25, metalness: 0.85 });
    const guardMat = new THREE.MeshStandardMaterial({ color: guardColor, roughness: 0.35, metalness: 0.8 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, metalness: 0.1, emissive: gemColor, emissiveIntensity: 0.6 });

    const hHeight = 0.14 + rand() * 0.06;
    const hRadiusTop = 0.018 + rand() * 0.005;
    const hRadiusBottom = 0.014 + rand() * 0.005;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(hRadiusTop, hRadiusBottom, hHeight, 6), woodMat);
    h.position.y = -hHeight / 2;
    group.add(h);

    // Grip wraps
    this.addGripWrap(h, rand, hHeight, hRadiusTop, hRadiusBottom, wrapMat);

    // Pommel
    const pommel = this.createProceduralPommel(rand, hHeight, guardMat, gemMat);
    group.add(pommel);

    // Guard
    const guard = this.createProceduralGuard(rand, guardMat, gemMat, 0.6);
    guard.position.y = 0;
    group.add(guard);

    // Procedural blade shapes (e.g. standard cone, wavy kris, or leaf-shape)
    const bladeStyle = Math.floor(rand() * 3);
    const bHeight = 0.2 + rand() * 0.12;
    
    if (bladeStyle === 0) {
      // Wavy Kris dagger blade
      const points = [];
      const segments = 12;
      const krisWidth = 0.02 + rand() * 0.01;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const wave = Math.sin(t * Math.PI * 4) * 0.015 * (1.0 - t);
        points.push(new THREE.Vector3(wave, t * bHeight, 0));
      }
      const krisCurve = new THREE.CatmullRomCurve3(points);
      const krisMesh = new THREE.Mesh(new THREE.TubeGeometry(krisCurve, segments, krisWidth, 4, false), metalMat);
      krisMesh.scale.z = 0.25;
      group.add(krisMesh);
    } else if (bladeStyle === 1) {
      // Leaf-shaped blade
      const leafGeo = new THREE.SphereGeometry(bHeight * 0.55, 8, 8);
      const leafMesh = new THREE.Mesh(leafGeo, metalMat);
      leafMesh.scale.set(0.12 + rand() * 0.04, 2.0, 0.02);
      leafMesh.position.y = bHeight / 2;
      group.add(leafMesh);
    } else {
      // Standard tapering double-edged blade
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.025 + rand() * 0.01, bHeight, 4), metalMat);
      b.scale.z = 0.15 + rand() * 0.1;
      b.position.y = bHeight / 2;
      group.add(b);
    }

    return group;
  },

  // Type 2: Sword
  createSwordModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const bladeColor = this.getRandomColor(rand, this.bladeColors);
    const guardColor = this.getRandomColor(rand, this.guardColors);
    const wrapColor = this.getRandomColor(rand, this.handleColors.filter(c => c !== handleColor));
    const gemColor = this.getRandomColor(rand, this.crystalColors);
    const emissionColor = this.getRandomColor(rand, this.emissionColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.85 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: bladeColor, roughness: 0.25, metalness: 0.85 });
    const guardMat = new THREE.MeshStandardMaterial({ color: guardColor, roughness: 0.35, metalness: 0.8 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, metalness: 0.1, emissive: gemColor, emissiveIntensity: 0.6 });
    const runicMat = new THREE.MeshStandardMaterial({ color: emissionColor, emissive: emissionColor, emissiveIntensity: 0.8 });

    const hHeight = 0.16 + rand() * 0.08;
    const hRadiusTop = 0.02 + rand() * 0.005;
    const hRadiusBottom = 0.016 + rand() * 0.005;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(hRadiusTop, hRadiusBottom, hHeight, 6), woodMat);
    h.position.y = -hHeight / 2;
    group.add(h);

    // Grip wraps
    this.addGripWrap(h, rand, hHeight, hRadiusTop, hRadiusBottom, wrapMat);

    // Pommel
    const pommel = this.createProceduralPommel(rand, hHeight, guardMat, gemMat);
    group.add(pommel);

    // Guard
    const guard = this.createProceduralGuard(rand, guardMat, gemMat, 1.0);
    guard.position.y = 0;
    group.add(guard);

    // Blade
    const bHeight = 0.45 + rand() * 0.25;
    const bWidth = 0.035 + rand() * 0.015;
    const bThickness = 0.008 + rand() * 0.005;
    const mainBlade = new THREE.Mesh(new THREE.BoxGeometry(bWidth, bHeight, bThickness), metalMat);
    mainBlade.position.y = bHeight / 2;
    group.add(mainBlade);

    // Recessed glowing fuller (runic groove)
    if (rand() > 0.3) {
      const fullerHeight = bHeight * 0.75;
      const fuller = new THREE.Mesh(new THREE.BoxGeometry(bWidth * 0.2, fullerHeight, bThickness * 1.2), runicMat);
      fuller.position.y = bHeight / 2;
      group.add(fuller);
    }

    // Blade tip (cone)
    const tipHeight = bWidth * 1.5;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(bWidth * 0.7, tipHeight, 4), metalMat);
    tip.scale.z = bThickness / bWidth;
    tip.rotation.y = Math.PI / 4; // Align flat face with box
    tip.position.y = bHeight + tipHeight / 2;
    group.add(tip);

    return group;
  },

  // Type 3: Heavy (Hammer)
  createHeavyModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const metalColor = this.getRandomColor(rand, this.guardColors);
    const wrapColor = this.getRandomColor(rand, this.handleColors.filter(c => c !== handleColor));
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.9 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.95 });
    const metalMat = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.35, metalness: 0.75 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, metalness: 0.1, emissive: gemColor, emissiveIntensity: 0.6 });

    const hHeight = 0.6 + rand() * 0.3;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, hHeight, 8), woodMat);
    h.position.y = -hHeight / 2 + 0.1; 
    group.add(h);

    // Handle wrapping near the grip area
    const wrapGroup = new THREE.Group();
    this.addGripWrap(wrapGroup, rand, hHeight * 0.4, 0.02, 0.018, wrapMat);
    wrapGroup.position.y = -hHeight * 0.1;
    group.add(wrapGroup);

    // Decorative metal ring bands along shaft
    const numBands = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < numBands; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 4, 8), metalMat);
      band.position.y = -hHeight / 2 + 0.1 + (hHeight * 0.8 * (i / (numBands - 1)));
      band.rotation.x = Math.PI / 2;
      group.add(band);
    }

    // Heavy Spiked Pommel counter-weight
    const bottomSpike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 4), metalMat);
    bottomSpike.rotation.x = Math.PI;
    bottomSpike.position.y = -hHeight / 2 + 0.1 - hHeight / 2;
    group.add(bottomSpike);

    // Random Head type: Warhammer, Spiked Mace, or Flanged Mace
    const headType = Math.floor(rand() * 3);
    const headPos = hHeight / 2 + 0.1;

    if (headType === 0) {
      // Warhammer: Central hub with hammer block and rear curved pick
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), metalMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.y = headPos;
      group.add(hub);

      // Hammer block
      const ham = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), metalMat);
      ham.position.set(0.04, headPos, 0);
      group.add(ham);

      // Gem embedded in side of hammer
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.015, 0), gemMat);
      gem.position.set(0.081, headPos, 0);
      group.add(gem);

      // Rear pick spike
      const pickGeo = new THREE.ConeGeometry(0.02, 0.08, 4);
      const pick = new THREE.Mesh(pickGeo, metalMat);
      pick.rotation.z = Math.PI / 2;
      pick.position.set(-0.06, headPos, 0);
      group.add(pick);
    } else if (headType === 1) {
      // Flanged Mace
      const flangedCore = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), metalMat);
      flangedCore.position.y = headPos;
      group.add(flangedCore);

      const numFlanges = 6;
      for (let i = 0; i < numFlanges; i++) {
        const angle = (i / numFlanges) * Math.PI * 2;
        const flange = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.008), metalMat);
        flange.position.set(Math.cos(angle) * 0.025, headPos, Math.sin(angle) * 0.025);
        flange.rotation.y = -angle;
        group.add(flange);
      }

      // Top spike gem
      const topSpike = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 4), metalMat);
      topSpike.position.y = headPos + 0.09;
      group.add(topSpike);
    } else {
      // Spiked Morningstar
      const ballRadius = 0.06 + rand() * 0.02;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(ballRadius, 16, 16), metalMat);
      ball.position.y = headPos;
      group.add(ball);

      // Spikes
      const spikeRadius = 0.01 + rand() * 0.005;
      const spikeHeight = 0.03 + rand() * 0.02;
      const spikeGeo = new THREE.ConeGeometry(spikeRadius, spikeHeight, 4);
      const numSpikes = 12 + Math.floor(rand() * 10);
      
      for (let i = 0; i < numSpikes; i++) {
        const spike = new THREE.Mesh(spikeGeo, metalMat);
        const phi = Math.acos(-1 + (2 * i) / numSpikes);
        const theta = Math.sqrt(numSpikes * Math.PI) * phi;
        
        spike.position.set(
          ballRadius * Math.sin(phi) * Math.cos(theta),
          ballRadius * Math.sin(phi) * Math.sin(theta),
          ballRadius * Math.cos(phi)
        );
        
        const normal = spike.position.clone().normalize();
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        ball.add(spike);
      }

      // Floating crystal on top
      const floatingGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.02, 0), gemMat);
      floatingGem.position.y = headPos + ballRadius + 0.035;
      group.add(floatingGem);
    }

    return group;
  },

  // Type 4: Axe
  createAxeModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const bladeColor = this.getRandomColor(rand, this.bladeColors);
    const accentColor = this.getRandomColor(rand, this.guardColors);
    const wrapColor = this.getRandomColor(rand, this.handleColors.filter(c => c !== handleColor));
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.9 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.95 });
    const metalMat = new THREE.MeshStandardMaterial({ color: bladeColor, roughness: 0.3, metalness: 0.8 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.3, metalness: 0.85 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, metalness: 0.1, emissive: gemColor, emissiveIntensity: 0.7 });

    const hHeight = 0.55 + rand() * 0.25;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, hHeight, 8), woodMat);
    h.position.y = 0.05;
    group.add(h);

    // Grip wraps
    const wrapGroup = new THREE.Group();
    this.addGripWrap(wrapGroup, rand, hHeight * 0.35, 0.019, 0.017, wrapMat);
    wrapGroup.position.y = 0.05 - hHeight * 0.5;
    group.add(wrapGroup);

    // Metal caps/bands at top under the axe head
    const topPos = hHeight / 2 + 0.05;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.08, 8), accentMat);
    collar.position.y = topPos;
    group.add(collar);

    // Spike at the bottom
    const bottomSpike = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 4), accentMat);
    bottomSpike.rotation.x = Math.PI;
    bottomSpike.position.y = 0.05 - hHeight / 2;
    group.add(bottomSpike);

    // Halberd / Axe variants
    const isDouble = rand() > 0.5;
    const isBearded = rand() > 0.5;

    // Elegant crescent / bearded blade geometry
    let bladeGeo;
    if (isBearded) {
      // Bearded blade: Box angled downwards with a beveled metal trim
      bladeGeo = new THREE.BoxGeometry(0.12, 0.16, 0.01);
    } else {
      // Large crescent curve
      bladeGeo = new THREE.CylinderGeometry(0, 0.14 + rand() * 0.06, 0.015, 3);
    }

    const bMesh1 = new THREE.Mesh(bladeGeo, metalMat);
    if (isBearded) {
      bMesh1.position.set(0.07, topPos - 0.04, 0);
      bMesh1.rotation.y = 0.05; // slight angle
    } else {
      bMesh1.rotation.x = Math.PI / 2;
      bMesh1.position.set(0.08, topPos, 0);
    }
    group.add(bMesh1);

    // Accent line/socket on blade
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), accentMat);
    socket.position.set(0.015, topPos, 0);
    group.add(socket);

    // Gem in the socket
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.012, 0), gemMat);
    gem.position.set(0.015, topPos, 0.016);
    group.add(gem);

    if (isDouble) {
      const bMesh2 = bMesh1.clone();
      if (isBearded) {
        bMesh2.position.set(-0.07, topPos - 0.04, 0);
        bMesh2.rotation.y = -0.05;
      } else {
        bMesh2.rotation.z = Math.PI;
        bMesh2.position.set(-0.08, topPos, 0);
      }
      group.add(bMesh2);
    } else {
      // Small spike hook on the back if single-headed
      const backHook = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.06, 4), accentMat);
      backHook.rotation.z = Math.PI / 2;
      backHook.position.set(-0.045, topPos, 0);
      group.add(backHook);
    }

    // Spear/spike tip at the very top (makes it look halberd-like)
    const spearTip = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.12, 4), metalMat);
    spearTip.scale.z = 0.25;
    spearTip.position.y = topPos + 0.08;
    group.add(spearTip);

    return group;
  },

  // Type 5: Whip (linked segments with physics)
  createWhipModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const whipColor = this.getRandomColor(rand, this.whipColors);
    const guardColor = this.getRandomColor(rand, this.guardColors);
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.95 });
    const metalMat = new THREE.MeshStandardMaterial({ color: guardColor, roughness: 0.3, metalness: 0.85 });
    const darkMat = new THREE.MeshStandardMaterial({ color: whipColor, roughness: 0.75, metalness: 0.1 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, emissive: gemColor, emissiveIntensity: 0.8 });

    const hHeight = 0.14 + rand() * 0.06;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, hHeight, 6), woodMat);
    h.position.y = -hHeight / 2;
    group.add(h);

    // Decorative handle wrapping
    this.addGripWrap(h, rand, hHeight, 0.018, 0.016, metalMat);

    // Lanyard ring pommel
    const ringPommel = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.004, 4, 8), metalMat);
    ringPommel.position.y = -hHeight;
    ringPommel.rotation.x = Math.PI / 2;
    group.add(ringPommel);

    // Knuckle guard on handle
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.005, 4, 12, Math.PI), metalMat);
    guard.position.set(0.02, -hHeight / 2, 0);
    guard.rotation.z = Math.PI / 2;
    group.add(guard);

    // ---- Linked-segment whip with Verlet physics ----
    const whipType = Math.floor(rand() * 3);
    const numSegments = 14 + Math.floor(rand() * 6); // 14-19 linked segments
    const totalLength = 0.35 + rand() * 0.25;
    const segLen = totalLength / numSegments;

    // Whip tapers from thick base to thin tip
    const baseRadius = whipType === 1 ? 0.012 : (whipType === 2 ? 0.008 : 0.010);
    const tipRadius = whipType === 1 ? 0.005 : (whipType === 2 ? 0.003 : 0.004);

    // Choose segment material based on whip type
    const segMat = whipType === 0 ? darkMat : (whipType === 1 ? gemMat : metalMat);

    // Create Verlet rope anchored at handle tip (y=0)
    const anchorPos = new THREE.Vector3(0, 0, 0);
    const rope = this.createVerletRope(numSegments + 1, segLen, anchorPos, {
      gravity: -0.0006,
      damping: 0.94,
      iterations: 8,
      stiffness: 0.85,
      endMass: 0.6
    });

    // Create per-segment cylinder meshes
    for (let i = 0; i < numSegments; i++) {
      const t = i / numSegments;
      const radius = baseRadius + (tipRadius - baseRadius) * t;
      const nextRadius = baseRadius + (tipRadius - baseRadius) * ((i + 1) / numSegments);

      const segGeo = new THREE.CylinderGeometry(nextRadius, radius, segLen, 6);
      const segMesh = new THREE.Mesh(segGeo, segMat);

      // Initial position along Y axis
      segMesh.position.set(0, i * segLen + segLen / 2, 0);
      group.add(segMesh);
      rope.segmentMeshes.push(segMesh);

      // Type 2 (blade whip): add barb spikes to every 2nd-3rd segment
      if (whipType === 2 && i > 2 && i % 2 === 0) {
        const barbSize = 0.008 + rand() * 0.006;
        const barb = new THREE.Mesh(new THREE.ConeGeometry(barbSize, barbSize * 2.5, 4), metalMat);
        barb.position.set(radius * 1.5, 0, 0);
        barb.rotation.z = -Math.PI / 2;
        segMesh.add(barb);

        // Opposing barb
        if (rand() > 0.4) {
          const barb2 = new THREE.Mesh(new THREE.ConeGeometry(barbSize * 0.8, barbSize * 2, 4), metalMat);
          barb2.position.set(-radius * 1.5, 0, 0);
          barb2.rotation.z = Math.PI / 2;
          segMesh.add(barb2);
        }
      }

      // Type 1 (energy whip): add tiny glow nodes at joints
      if (whipType === 1 && i > 0 && i % 3 === 0) {
        const node = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.8, 4, 4), gemMat);
        node.position.set(0, -segLen / 2, 0);
        segMesh.add(node);
      }

      // Type 0 (leather): add occasional braided knots
      if (whipType === 0 && i > 3 && i % 4 === 0) {
        const knot = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.5, radius * 0.6, 4, 6), darkMat);
        knot.rotation.x = Math.PI / 2;
        knot.position.set(0, -segLen / 2, 0);
        segMesh.add(knot);
      }
    }

    // Whip tip (cracker / spike / energy orb)
    const tipGroup = new THREE.Group();
    if (whipType === 0) {
      // Leather cracker, thin tapered cone
      const cracker = new THREE.Mesh(new THREE.ConeGeometry(tipRadius * 0.6, segLen * 1.5, 4), darkMat);
      cracker.position.y = segLen * 0.75;
      tipGroup.add(cracker);
    } else if (whipType === 1) {
      // Energy orb at the tip
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.015, 0), gemMat);
      tipGroup.add(orb);
    } else {
      // Blade spike tip
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 4), metalMat);
      spike.position.y = 0.017;
      tipGroup.add(spike);
      // Small gem embedded
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.006, 0), gemMat);
      gem.position.y = -0.005;
      tipGroup.add(gem);
    }
    tipGroup.position.set(0, totalLength, 0);
    group.add(tipGroup);
    rope.headMeshGroup = tipGroup;

    // Store rope on the group for physics ticking
    group.userData._verletRope = rope;

    return group;
  },

  // Type 6: Staff
  createStaffModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const accentColor = this.getRandomColor(rand, this.guardColors);
    const orbColor = this.getRandomColor(rand, this.crystalColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.85 });
    const crystalMat = new THREE.MeshStandardMaterial({ 
      color: orbColor, 
      roughness: 0.1, 
      metalness: 0.1, 
      emissive: orbColor, 
      emissiveIntensity: 0.7 
    });

    const hHeight = 0.85 + rand() * 0.35;
    // Sleek segmented/spiraled staff shaft
    const shaftSegments = 4;
    const h = new THREE.Group();
    const segHeight = hHeight / shaftSegments;
    for (let i = 0; i < shaftSegments; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.016 - i * 0.001, 0.015 - i * 0.001, segHeight, 8), woodMat);
      seg.position.y = -hHeight / 2 + 0.3 + (i * segHeight) + segHeight / 2;
      seg.rotation.y = (i * Math.PI) / 8; // slight twist
      h.add(seg);

      // Gold bands at segment junctions
      if (i > 0) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.018 - i * 0.001, 0.004, 4, 8), metalMat);
        band.position.y = -hHeight / 2 + 0.3 + (i * segHeight);
        band.rotation.x = Math.PI / 2;
        h.add(band);
      }
    }
    group.add(h);

    const topPos = hHeight / 2 + 0.3;

    // Ornate gold metal claw / crown socket holding the gem
    const socket = new THREE.Group();
    socket.position.y = topPos;
    const baseCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.018, 0.05, 8), metalMat);
    socket.add(baseCylinder);

    const numProngs = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < numProngs; i++) {
      const angle = (i / numProngs) * Math.PI * 2;
      const clawCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(Math.cos(angle) * 0.018, 0.025, Math.sin(angle) * 0.018),
        new THREE.Vector3(Math.cos(angle) * 0.05, 0.06, Math.sin(angle) * 0.05),
        new THREE.Vector3(Math.cos(angle) * 0.025, 0.10, Math.sin(angle) * 0.025)
      );
      const prong = new THREE.Mesh(new THREE.TubeGeometry(clawCurve, 6, 0.008, 4, false), metalMat);
      socket.add(prong);
    }
    group.add(socket);

    // Large faceted crystal (Faceted Gem using Octahedron or Icosahedron)
    const gemType = rand() > 0.5;
    const orbR = 0.045 + rand() * 0.025;
    const crystalGeo = gemType ? new THREE.OctahedronGeometry(orbR, 0) : new THREE.IcosahedronGeometry(orbR, 0);
    const orb = new THREE.Mesh(crystalGeo, crystalMat);
    orb.position.y = topPos + 0.06;
    group.add(orb);

    // Ultimate Wow Factor: Floating orbital structures!
    // A horizontal golden ring floating around the crystal, and tiny floating gem shards
    if (rand() > 0.4) {
      const floatRing = new THREE.Mesh(new THREE.TorusGeometry(orbR * 1.5, 0.004, 4, 16), metalMat);
      floatRing.position.y = topPos + 0.06;
      floatRing.rotation.x = Math.PI / 2 + (rand() * 0.2 - 0.1);
      group.add(floatRing);

      // 3 tiny floating shard gems orbiting
      for (let i = 0; i < 3; i++) {
        const fAngle = (i / 3) * Math.PI * 2;
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.008, 0), crystalMat);
        shard.position.set(
          Math.cos(fAngle) * orbR * 1.6,
          topPos + 0.06 + (rand() * 0.02 - 0.01),
          Math.sin(fAngle) * orbR * 1.6
        );
        group.add(shard);
      }
    }

    return group;
  },

  // Type 7: Bow
  createBowModel(weapon, rand) {
    const group = new THREE.Group();
    const bowColor = this.getRandomColor(rand, this.handleColors);
    const accentColor = this.getRandomColor(rand, this.guardColors);
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: bowColor, roughness: 0.9 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.85 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, emissive: gemColor, emissiveIntensity: 0.6 });
    const stringMat = new THREE.LineBasicMaterial({ color: 0xFFFFFF });

    // Bow variations: Longbow, Recurve Bow, Compound Bow!
    const bowStyle = Math.floor(rand() * 3);
    const height = 0.32 + rand() * 0.08;

    if (bowStyle === 0) {
      // 1. Classic Longbow - simple elegant D-curve
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, height, -0.1),
        new THREE.Vector3(0, 0, 0.12),
        new THREE.Vector3(0, -height, -0.1)
      );
      const bow = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.016, 6, false), woodMat);
      group.add(bow);

      // Leather grip wrap in center
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), accentMat);
      group.add(grip);

      // Single bowstring
      const stringPoints = [new THREE.Vector3(0, height, -0.1), new THREE.Vector3(0, -height, -0.1)];
      const stringGeo = new THREE.BufferGeometry().setFromPoints(stringPoints);
      const stringLine = new THREE.Line(stringGeo, stringMat);
      group.add(stringLine);

    } else if (bowStyle === 1) {
      // 2. Elegant Recurve Bow - double curved limb tips (S-like sweep at ends)
      const curvePointsUpper = [
        new THREE.Vector3(0, 0, 0.08),
        new THREE.Vector3(0, height * 0.5, 0.05),
        new THREE.Vector3(0, height * 0.85, -0.05),
        new THREE.Vector3(0, height, -0.12)
      ];
      const curvePointsLower = [
        new THREE.Vector3(0, 0, 0.08),
        new THREE.Vector3(0, -height * 0.5, 0.05),
        new THREE.Vector3(0, -height * 0.85, -0.05),
        new THREE.Vector3(0, -height, -0.12)
      ];

      const upperCurve = new THREE.CatmullRomCurve3(curvePointsUpper);
      const lowerCurve = new THREE.CatmullRomCurve3(curvePointsLower);

      const upperLimb = new THREE.Mesh(new THREE.TubeGeometry(upperCurve, 12, 0.015, 6, false), woodMat);
      const lowerLimb = new THREE.Mesh(new THREE.TubeGeometry(lowerCurve, 12, 0.015, 6, false), woodMat);
      group.add(upperLimb);
      group.add(lowerLimb);

      // Ornate central riser block with a gem sight
      const riser = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.09, 0.035), accentMat);
      riser.position.set(0, 0, 0.05);
      group.add(riser);

      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.009, 0), gemMat);
      gem.position.set(0, 0.02, 0.07);
      group.add(gem);

      // String
      const stringPoints = [new THREE.Vector3(0, height, -0.12), new THREE.Vector3(0, -height, -0.12)];
      const stringGeo = new THREE.BufferGeometry().setFromPoints(stringPoints);
      const stringLine = new THREE.Line(stringGeo, stringMat);
      group.add(stringLine);

    } else {
      // 3. Futuristic Compound Bow - angled carbon limbs, round pulleys/cams at tips, multi-string
      const limbUpper = new THREE.Mesh(new THREE.BoxGeometry(0.014, height * 0.9, 0.03), woodMat);
      limbUpper.position.set(0, height * 0.45, 0.05);
      limbUpper.rotation.x = -Math.PI / 10;
      group.add(limbUpper);

      const limbLower = new THREE.Mesh(new THREE.BoxGeometry(0.014, height * 0.9, 0.03), woodMat);
      limbLower.position.set(0, -height * 0.45, 0.05);
      limbLower.rotation.x = Math.PI / 10;
      group.add(limbLower);

      // Pulleys (Cams) at the limb tips
      const camGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8);
      const camU = new THREE.Mesh(camGeo, accentMat);
      camU.rotation.z = Math.PI / 2;
      const camYPos = height * 0.88;
      const camZPos = -0.05;
      camU.position.set(0, camYPos, camZPos);
      group.add(camU);

      const camL = camU.clone();
      camL.position.set(0, -camYPos, camZPos);
      group.add(camL);

      // Compound multi-string (double strings intersecting)
      const sPoints1 = [new THREE.Vector3(0, camYPos, camZPos), new THREE.Vector3(0, -camYPos, camZPos)];
      const sPoints2 = [new THREE.Vector3(0, camYPos, camZPos - 0.01), new THREE.Vector3(0, 0, camZPos + 0.06)];
      const sPoints3 = [new THREE.Vector3(0, -camYPos, camZPos - 0.01), new THREE.Vector3(0, 0, camZPos + 0.06)];

      const string1 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sPoints1), stringMat);
      const string2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sPoints2), stringMat);
      const string3 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sPoints3), stringMat);
      group.add(string1);
      group.add(string2);
      group.add(string3);

      // Tech grip riser
      const riser = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.04), accentMat);
      riser.position.set(0, 0, 0.07);
      group.add(riser);
    }

    return group;
  },

  // Type 8: Projectile (Kunai/Dart)
  createProjectileModel(weapon, rand) {
    const group = new THREE.Group();
    const bladeColor = this.getRandomColor(rand, this.bladeColors);
    const wrapColor = this.getRandomColor(rand, this.handleColors);
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const metalMat = new THREE.MeshStandardMaterial({ color: bladeColor, roughness: 0.25, metalness: 0.85 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.9 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, emissive: gemColor, emissiveIntensity: 0.6 });

    // Projectile sub-types: Kunai, Spiked Shuriken (Star), or Throwing Dart
    const projType = Math.floor(rand() * 3);

    if (projType === 0) {
      // 1. Kunai: Leaf flat blade, wrapped hilt, ring pommel
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 4), metalMat);
      blade.scale.z = 0.2;
      blade.rotation.x = Math.PI / 2; // Point forward
      blade.position.z = 0.07;
      group.add(blade);

      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 6), wrapMat);
      hilt.rotation.x = Math.PI / 2;
      hilt.position.z = -0.04;
      group.add(hilt);

      // Grip wrap
      this.addGripWrap(hilt, rand, 0.08, 0.009, 0.009, wrapMat);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 4, 8), metalMat);
      ring.position.z = -0.09;
      group.add(ring);

    } else if (projType === 1) {
      // 2. Shuriken: Spiked throwing star (radial symmetry)
      const centerRing = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 4, 12), metalMat);
      group.add(centerRing);

      const numPoints = 4 + Math.floor(rand() * 2); // 4 or 5 point star
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.08, 4), metalMat);
        blade.scale.z = 0.2;
        blade.position.set(Math.cos(angle) * 0.04, Math.sin(angle) * 0.04, 0);
        blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
        group.add(blade);
      }

      // Small center glowing gem
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.01, 0), gemMat);
      group.add(gem);

    } else {
      // 3. Throwing Dart: Ribbed grip, heavy iron tip, and feather fletching fins
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.12, 6), metalMat);
      body.rotation.x = Math.PI / 2;
      group.add(body);

      // Grip wraps
      this.addGripWrap(body, rand, 0.12, 0.012, 0.006, wrapMat);

      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.06, 4), metalMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.09;
      group.add(tip);

      // 3 flat feather fins at the back
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.03, 0.03), gemMat);
        fin.position.set(Math.cos(angle) * 0.012, Math.sin(angle) * 0.012, -0.06);
        fin.rotation.z = angle;
        fin.rotation.y = Math.PI / 12; // angled fin for spin
        group.add(fin);
      }
    }

    return group;
  },

  // Type 9: Gun
  createGunModel(weapon, rand) {
    const group = new THREE.Group();
    const gunColor = this.getRandomColor(rand, [0x222222, 0x444444, 0xAAAAAA, 0x334455]);
    const gripColor = this.getRandomColor(rand, this.handleColors);
    const energColor = this.getRandomColor(rand, this.crystalColors);

    const metalMat = new THREE.MeshStandardMaterial({ color: gunColor, roughness: 0.45, metalness: 0.85 });
    const gripMat = new THREE.MeshStandardMaterial({ color: gripColor, roughness: 0.9 });
    const energMat = new THREE.MeshStandardMaterial({ color: energColor, roughness: 0.1, emissive: energColor, emissiveIntensity: 0.75 });

    // Gun sub-types: Revolver, Shotgun, Plasma Rifle, Tactical Rifle, Heavy Drum SMG, Retro Ray-gun
    const gunStyle = Math.floor(rand() * 6);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.09, 0.035), gripMat);
    grip.position.set(0, -0.045, -0.025);
    grip.rotation.x = Math.PI / 7;
    group.add(grip);

    // Trigger guard
    const trig = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 8, Math.PI), metalMat);
    trig.position.set(0, -0.015, 0.01);
    trig.rotation.y = Math.PI / 2;
    group.add(trig);

    if (gunStyle === 0) {
      // 1. Classic Six-Shooter Revolver
      // Revolving drum (cylinder)
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 6), metalMat);
      drum.rotation.x = Math.PI / 2;
      drum.position.set(0, 0.01, 0.01);
      group.add(drum);

      // Indented grooves along cylinder drum
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const groove = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.052, 4), gripMat);
        groove.rotation.x = Math.PI / 2;
        groove.position.set(Math.cos(angle) * 0.018, 0.01 + Math.sin(angle) * 0.018, 0.01);
        group.add(groove);
      }

      // Gun frame and long barrel
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.04, 0.06), metalMat);
      frame.position.set(0, 0.01, -0.035);
      group.add(frame);

      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.16, 8), metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.018, 0.11);
      group.add(barrel);

      // Front sight post
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.012, 0.012), metalMat);
      sight.position.set(0, 0.028, 0.17);
      group.add(sight);

    } else if (gunStyle === 1) {
      // 2. Double-Barrel Rifle/Shotgun
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.05, 0.12), gripMat);
      stock.position.set(0, -0.02, -0.09);
      stock.rotation.x = Math.PI / 18;
      group.add(stock);

      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.038, 0.07), metalMat);
      frame.position.set(0, 0.015, -0.015);
      group.add(frame);

      // Twin parallel barrels
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 6), metalMat);
      b1.rotation.x = Math.PI / 2;
      b1.position.set(0.01, 0.022, 0.12);
      group.add(b1);

      const b2 = b1.clone();
      b2.position.x = -0.01;
      group.add(b2);

    } else if (gunStyle === 2) {
      // 3. Futuristic Plasma / Sci-fi Laser Rifle
      // Tech frame block
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), metalMat);
      frame.position.set(0, 0.015, -0.01);
      group.add(frame);

      // Glowing plasma battery cell
      const battery = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 6), energMat);
      battery.rotation.x = Math.PI / 2;
      battery.position.set(0, 0.015, -0.01);
      group.add(battery);

      // Glowing plasma barrel coils
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8), metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, 0.13);
      group.add(barrel);

      const numCoils = 4;
      for (let i = 0; i < numCoils; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 4, 8), energMat);
        coil.position.set(0, 0.02, 0.07 + i * 0.035);
        coil.rotation.x = Math.PI / 2;
        group.add(coil);
      }

    } else if (gunStyle === 3) {
      // 4. Tactical Assault Rifle
      // Stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.035, 0.14), gripMat);
      stock.position.set(0, -0.01, -0.095);
      stock.rotation.x = -Math.PI / 30;
      group.add(stock);

      // Receiver
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.045, 0.12), metalMat);
      frame.position.set(0, 0.015, -0.01);
      group.add(frame);

      // Barrel + Silencer
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.022, 0.13);
      group.add(barrel);

      const silencer = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8), metalMat);
      silencer.rotation.x = Math.PI / 2;
      silencer.position.set(0, 0.022, 0.23);
      group.add(silencer);

      // Curved Extended Magazine
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.08, 0.028), metalMat);
      mag.position.set(0, -0.04, 0.035);
      mag.rotation.x = -Math.PI / 10;
      group.add(mag);

      // Under-barrel Foregrip
      const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.018), gripMat);
      foregrip.position.set(0, -0.03, 0.095);
      foregrip.rotation.x = -Math.PI / 15;
      group.add(foregrip);

      // Holographic Red-Dot Scope
      const scopeRail = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.06), metalMat);
      scopeRail.position.set(0, 0.04, -0.01);
      group.add(scopeRail);

      const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.045, 8), metalMat);
      scopeBody.rotation.x = Math.PI / 2;
      scopeBody.position.set(0, 0.052, -0.01);
      group.add(scopeBody);

      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.009, 8), energMat);
      lens.position.set(0, 0.052, 0.023);
      group.add(lens);

    } else if (gunStyle === 4) {
      // 5. Heavy Drum-Mag SMG
      // Frame / Receiver
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.05, 0.11), metalMat);
      frame.position.set(0, 0.012, -0.01);
      group.add(frame);

      // Large Circular Drum Magazine
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.026, 12), metalMat);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, -0.035, 0.02);
      group.add(drum);

      // Shrouded Cooling Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8), metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.018, 0.09);
      group.add(barrel);

      // Carry Handle / Top Rail
      const carryHandle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.09), metalMat);
      carryHandle.position.set(0, 0.045, -0.015);
      group.add(carryHandle);

      // Short Stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.04, 0.08), gripMat);
      stock.position.set(0, -0.01, -0.08);
      group.add(stock);

    } else {
      // 6. Retro Emitter Ray-Gun
      // Rounded receiver
      const rec = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), metalMat);
      rec.scale.set(0.9, 1.1, 1.4);
      rec.position.set(0, 0.015, -0.01);
      group.add(rec);

      // Concentric copper cooling rings along the barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.16, 8), energMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.018, 0.09);
      group.add(barrel);

      const numRings = 4;
      for (let i = 0; i < numRings; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 4, 10), metalMat);
        ring.position.set(0, 0.018, 0.05 + i * 0.03);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      }

      // Flared Funnel-shaped Muzzle
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.011, 0.03, 8), metalMat);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(0, 0.018, 0.18);
      group.add(muzzle);

      // Small glowing vacuum tubes on top
      for (let i = -1; i <= 1; i += 2) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6), energMat);
        tube.position.set(i * 0.014, 0.045, -0.01);
        group.add(tube);
      }
    }

    return group;
  },

  // Type 10: Claw
  createClawModel(weapon, rand) {
    const group = new THREE.Group();
    const bladeColor = this.getRandomColor(rand, this.bladeColors);
    const plateColor = this.getRandomColor(rand, this.guardColors);
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const metalMat = new THREE.MeshStandardMaterial({ color: bladeColor, roughness: 0.25, metalness: 0.85 });
    const plateMat = new THREE.MeshStandardMaterial({ color: plateColor, roughness: 0.35, metalness: 0.8 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, emissive: gemColor, emissiveIntensity: 0.6 });

    // Armored gauntlet wrist plate base
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.08), plateMat);
    base.position.y = -0.02;
    group.add(base);

    // Ornate gold trim / knuckles
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.01, 0.02), plateMat);
    trim.position.set(0, 0, 0.03);
    group.add(trim);

    // Three long, curved crescent-shaped wolverine claws
    for (let i = -1; i <= 1; i++) {
      const xOffset = i * 0.04;
      
      const clawCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(xOffset, 0, 0.03),
        new THREE.Vector3(xOffset, 0.06, 0.10),
        new THREE.Vector3(xOffset, 0.15, 0.22)
      );
      
      const claw = new THREE.Mesh(new THREE.TubeGeometry(clawCurve, 8, 0.009, 4, false), metalMat);
      claw.scale.x = 0.4; // flatten sideways
      group.add(claw);

      // Embedded glowing gems on the knuckles
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.009, 0), gemMat);
      gem.position.set(xOffset, 0.01, 0.03);
      group.add(gem);
    }

    return group;
  },

  // Type 11: Glove
  createGloveModel(weapon, rand) {
    const group = new THREE.Group();
    const gloveColor = this.getRandomColor(rand, this.handleColors);
    const plateColor = this.getRandomColor(rand, this.guardColors);
    const gemColors = this.crystalColors; // use all gem colors for ultimate gauntlet!

    const mat = new THREE.MeshStandardMaterial({ color: gloveColor, roughness: 0.85 });
    const plateMat = new THREE.MeshStandardMaterial({ color: plateColor, roughness: 0.35, metalness: 0.8 });

    // Detailed Armored Gauntlet
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 12), mat);
    group.add(glove);

    // Wrist cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.07, 12), plateMat);
    cuff.position.y = -0.06;
    group.add(cuff);

    // Armored plate on back of the hand
    const handPlate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.08), plateMat);
    handPlate.position.set(0, 0.02, 0.01);
    group.add(handPlate);

    // Knuckle studs / Infinity stone sockets on the knuckles!
    // Places 5 distinct glowing colored gems
    const xOffsets = [-0.03, -0.015, 0, 0.015, 0.03];
    for (let i = 0; i < 5; i++) {
      const gColor = gemColors[i % gemColors.length];
      const gemMat = new THREE.MeshStandardMaterial({ color: gColor, roughness: 0.1, emissive: gColor, emissiveIntensity: 0.8 });
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), gemMat);
      gem.position.set(xOffsets[i], 0.03, 0.045);
      group.add(gem);

      // Socket bezel
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.002, 4, 8), plateMat);
      bezel.position.set(xOffsets[i], 0.03, 0.045);
      bezel.rotation.x = Math.PI / 2;
      group.add(bezel);
    }

    return group;
  },

  // Type 12: Spear
  createSpearModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const bladeColor = this.getRandomColor(rand, this.bladeColors);
    const accentColor = this.getRandomColor(rand, this.guardColors);
    const wrapColor = this.getRandomColor(rand, this.handleColors.filter(c => c !== handleColor));
    const ribbonColor = this.getRandomColor(rand, this.ribbonColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.9 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.95 });
    const metalMat = new THREE.MeshStandardMaterial({ color: bladeColor, roughness: 0.25, metalness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.85 });
    const ribbonMat = new THREE.MeshStandardMaterial({ color: ribbonColor, roughness: 0.9, metalness: 0.05 });

    const hHeight = 0.85 + rand() * 0.35;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, hHeight, 8), woodMat);
    h.position.y = -hHeight / 2 + 0.2;
    group.add(h);

    // Grip wrapping
    const wrapGroup = new THREE.Group();
    this.addGripWrap(wrapGroup, rand, hHeight * 0.3, 0.017, 0.017, wrapMat);
    wrapGroup.position.y = -hHeight * 0.2;
    group.add(wrapGroup);

    // Spear head socket connector
    const topPos = 0.2;
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.08, 8), accentMat);
    socket.position.y = topPos;
    group.add(socket);

    // Hanging battle tassels / ribbons under the spear tip
    const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.04, 8), ribbonMat);
    tassel.position.y = topPos - 0.02;
    group.add(tassel);

    // Spear point bottom counter-weight spike
    const bottomSpike = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.06, 4), accentMat);
    bottomSpike.rotation.x = Math.PI;
    bottomSpike.position.y = -hHeight / 2 + 0.2 - hHeight / 2;
    group.add(bottomSpike);

    // Spear head variants: Trident (3-pronged), Partisan (winged leaf), or elegant Glaive/Naginata
    const spearStyle = Math.floor(rand() * 3);
    const bHeight = 0.22 + rand() * 0.12;

    if (spearStyle === 0) {
      // 1. Trident (3 prongs)
      const centerProng = new THREE.Mesh(new THREE.ConeGeometry(0.012, bHeight, 4), metalMat);
      centerProng.scale.z = 0.25;
      centerProng.position.y = topPos + bHeight / 2 + 0.04;
      group.add(centerProng);

      const prongGeo = new THREE.ConeGeometry(0.009, bHeight * 0.85, 4);
      
      const leftProng = new THREE.Mesh(prongGeo, metalMat);
      leftProng.scale.z = 0.25;
      leftProng.rotation.z = Math.PI / 16;
      leftProng.position.set(-0.04, topPos + bHeight * 0.45, 0);
      group.add(leftProng);

      const rightProng = new THREE.Mesh(prongGeo, metalMat);
      rightProng.scale.z = 0.25;
      rightProng.rotation.z = -Math.PI / 16;
      rightProng.position.set(0.04, topPos + bHeight * 0.45, 0);
      group.add(rightProng);

      // Cross connecting bracket
      const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.012), accentMat);
      crossbar.position.y = topPos + 0.04;
      group.add(crossbar);

    } else if (spearStyle === 1) {
      // 2. Partisan (winged leaf-shape spearhead)
      const bladeGeo = new THREE.SphereGeometry(bHeight * 0.55, 8, 8);
      const mainBlade = new THREE.Mesh(bladeGeo, metalMat);
      mainBlade.scale.set(0.09 + rand() * 0.03, 1.8, 0.015);
      mainBlade.position.y = topPos + bHeight / 2 + 0.03;
      group.add(mainBlade);

      // Two side winged lugs/axes
      const wingGeo = new THREE.BoxGeometry(0.03, 0.03, 0.008);
      const wingL = new THREE.Mesh(wingGeo, accentMat);
      wingL.position.set(-0.035, topPos + 0.06, 0);
      wingL.rotation.z = Math.PI / 4;
      group.add(wingL);

      const wingR = wingL.clone();
      wingR.position.x = 0.035;
      wingR.rotation.z = -Math.PI / 4;
      group.add(wingR);

    } else {
      // 3. Naginata / Glaive curved blade
      const naginataCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, topPos + 0.04, 0),
        new THREE.Vector3(0.02, topPos + bHeight * 0.5, 0),
        new THREE.Vector3(0.05, topPos + bHeight + 0.04, 0)
      );
      const blade = new THREE.Mesh(new THREE.TubeGeometry(naginataCurve, 10, 0.014, 4, false), metalMat);
      blade.scale.x = 0.35; // flatten blade
      group.add(blade);
    }

    return group;
  },

  // Special <Flail> support (linked chain segments with physics)
  createFlailModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColor = this.getRandomColor(rand, this.handleColors);
    const metalColor = this.getRandomColor(rand, this.guardColors);
    const wrapColor = this.getRandomColor(rand, this.handleColors.filter(c => c !== handleColor));
    const gemColor = this.getRandomColor(rand, this.crystalColors);

    const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.9 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.95 });
    const metalMat = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.35, metalness: 0.75 });
    const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, emissive: gemColor, emissiveIntensity: 0.7 });

    // Handle
    const hHeight = 0.2 + rand() * 0.1;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, hHeight, 8), woodMat);
    h.position.y = -hHeight / 2;
    group.add(h);

    // Grip wraps
    this.addGripWrap(h, rand, hHeight, 0.02, 0.016, wrapMat);

    // Lanyard ring pommel
    const lanyard = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.004, 4, 8), metalMat);
    lanyard.position.y = -hHeight;
    lanyard.rotation.x = Math.PI / 2;
    group.add(lanyard);

    // ---- Linked-chain physics for all flail variants ----
    const flailStyle = Math.floor(rand() * 3);
    const numSegments = weapon.segments || 8;
    const chainLength = 0.2 + rand() * 0.15;
    const linkSpacing = chainLength / numSegments;

    // Helper: build a physics-driven chain and return its rope
    const buildPhysicsChain = (parentGroup, segCount, anchorOffset, scaleFactor = 1.0, endMassVal = 3.0) => {
      const anchor = new THREE.Vector3(anchorOffset.x, anchorOffset.y, anchorOffset.z);
      const sLen = linkSpacing * scaleFactor;

      const rope = this.createVerletRope(segCount + 1, sLen, anchor, {
        gravity: -0.0008,
        damping: 0.93,
        iterations: 8,
        stiffness: 1.0,
        endMass: endMassVal
      });

      const linkRadius = 0.015 * scaleFactor;
      const linkTube = 0.004 * scaleFactor;

      for (let i = 0; i < segCount; i++) {
        const linkGeo = new THREE.TorusGeometry(linkRadius, linkTube, 4, 8);
        const link = new THREE.Mesh(linkGeo, metalMat);
        // Alternate link rotation for interlocking chain look
        link.userData._chainAlternate = (i % 2 === 0);
        link.position.set(anchor.x, anchor.y + sLen * i + sLen / 2, anchor.z);
        parentGroup.add(link);
        rope.segmentMeshes.push(link);
      }

      return rope;
    };

    // Helper: create spiky ball head group
    const buildSpikyBallGroup = (radius, spikeSize = 1.0) => {
      const headGroup = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 12), metalMat);
      headGroup.add(ball);

      const spikeRadius = 0.008 * spikeSize;
      const spikeHeight = 0.018 * spikeSize;
      const spikeGeo = new THREE.ConeGeometry(spikeRadius, spikeHeight, 4);
      const numSpikes = 8 + Math.floor(rand() * 6);

      for (let i = 0; i < numSpikes; i++) {
        const spike = new THREE.Mesh(spikeGeo, metalMat);
        const phi = Math.acos(-1 + (2 * i) / numSpikes);
        const theta = Math.sqrt(numSpikes * Math.PI) * phi;

        spike.position.set(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.sin(phi) * Math.sin(theta),
          radius * Math.cos(phi)
        );

        const normal = spike.position.clone().normalize();
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        ball.add(spike);
      }
      return headGroup;
    };

    // Store all ropes for this flail (multi-headed has 3)
    const ropes = [];

    if (flailStyle === 0) {
      // 1. Classic Spiky morningstar flail, single heavy chain
      const rope = buildPhysicsChain(group, numSegments, new THREE.Vector3(0, 0, 0), 1.0, 4.0);
      const ballRadius = 0.045 + rand() * 0.015;
      const headGroup = buildSpikyBallGroup(ballRadius, 1.0);
      headGroup.position.set(0, linkSpacing * numSegments, 0);
      group.add(headGroup);
      rope.headMeshGroup = headGroup;
      ropes.push(rope);

    } else if (flailStyle === 1) {
      // 2. Multi-headed flail (3 independent physics chains branching off hilt)
      const angles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
      for (let i = 0; i < 3; i++) {
        const spreadX = Math.cos(angles[i]) * 0.015;
        const spreadZ = Math.sin(angles[i]) * 0.015;
        const anchorOff = new THREE.Vector3(spreadX, 0, spreadZ);

        const rope = buildPhysicsChain(group, 5, anchorOff, 0.7, 2.5);
        const headGroup = buildSpikyBallGroup(0.025, 0.6);
        headGroup.position.set(spreadX, linkSpacing * 5 * 0.7, spreadZ);
        group.add(headGroup);
        rope.headMeshGroup = headGroup;
        ropes.push(rope);
      }

    } else {
      // 3. Meteor Hammer, heavy glowing runic urn weight
      const rope = buildPhysicsChain(group, numSegments, new THREE.Vector3(0, 0, 0), 1.0, 5.0);

      const headGroup = new THREE.Group();
      // Polyhedron urn block
      const urnGeo = new THREE.IcosahedronGeometry(0.042, 0);
      const urn = new THREE.Mesh(urnGeo, metalMat);
      headGroup.add(urn);

      // Embedded core magical gem glowing
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.024, 0), gemMat);
      headGroup.add(gem);

      headGroup.position.set(0, linkSpacing * numSegments, 0);
      group.add(headGroup);
      rope.headMeshGroup = headGroup;
      ropes.push(rope);
    }

    // Store ropes on the group for physics ticking
    group.userData._verletRopes = ropes;

    return group;
  },

  // ============================================================
  // DEDICATED CUSTOM MODEL METHODS
  // ============================================================

  // <Mjolnir>, Thor's iconic short-handled square-head hammer
  createMjolnirModel(weapon, rand) {
    const group = new THREE.Group();
    const metalMat  = new THREE.MeshStandardMaterial({ color: 0xBBBBCC, roughness: 0.3,  metalness: 0.9  });
    const goldMat   = new THREE.MeshStandardMaterial({ color: 0xDDAA00, roughness: 0.2,  metalness: 0.95 });
    const wrapMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9  });
    const lightMat  = new THREE.MeshStandardMaterial({ color: 0x4488FF, emissive: 0x4488FF, emissiveIntensity: 0.85 });

    const hH = 0.20;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, hH, 8), goldMat);
    handle.position.y = -hH / 2;
    group.add(handle);
    this.addGripWrap(handle, rand, hH, 0.022, 0.02, wrapMat);

    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.005, 4, 8), goldMat);
    strap.position.y = -hH;
    strap.rotation.x = Math.PI / 2;
    group.add(strap);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.04, 8), metalMat);
    neck.position.y = 0.02;
    group.add(neck);

    const headW = 0.14, headH = 0.10, headD = 0.09;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headW, headH, headD), metalMat);
    head.position.y = 0.09;
    group.add(head);

    // Gold band at neck
    const band = new THREE.Mesh(new THREE.BoxGeometry(headW + 0.01, 0.015, headD + 0.01), goldMat);
    band.position.y = 0.044;
    group.add(band);

    // Top cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(headW - 0.01, 0.01, headD - 0.01), goldMat);
    cap.position.y = 0.09 + headH / 2;
    group.add(cap);

    // Engraved rune lines on front face
    for (let i = 0; i < 3; i++) {
      const rune = new THREE.Mesh(new THREE.BoxGeometry(headW * 0.55, 0.005, 0.002), lightMat);
      rune.position.set(0, 0.045 + i * 0.028, headD / 2 + 0.001);
      group.add(rune);
    }

    // Floating lightning bolt fragments around head
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.025), lightMat);
      bolt.position.set(Math.cos(angle) * 0.11, 0.09, Math.sin(angle) * 0.06);
      bolt.rotation.y = angle;
      group.add(bolt);
    }

    return group;
  },

  // <FlySwatter>, Lightweight plastic swatter paddle
  createFlySwatterModel(weapon, rand) {
    const group = new THREE.Group();
    const colors = [0xFF3333, 0x3366FF, 0x33CC33, 0xFF9900];
    const plasticColor = colors[Math.floor(rand() * colors.length)];
    const plasticMat = new THREE.MeshStandardMaterial({ color: plasticColor, roughness: 0.7 });
    const wireMat    = new THREE.MeshStandardMaterial({ color: 0x222222,    roughness: 0.8 });

    const hH = 0.35;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.007, hH, 6), plasticMat);
    handle.position.y = -hH / 2;
    group.add(handle);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.015), plasticMat);
    neck.position.y = 0;
    group.add(neck);

    // Frame border of the paddle
    const pW = 0.12, pH = 0.09;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(pW, pH, 0.006), plasticMat);
    frame.position.y = pH / 2 + 0.01;
    group.add(frame);

    // Interior wire mesh (horizontal + vertical bars)
    const gridN = 5;
    for (let r = 0; r < gridN; r++) {
      const ty = -pH * 0.35 + (r / (gridN - 1)) * pH * 0.7;
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(pW * 0.8, 0.003, 0.005), wireMat);
      hBar.position.set(0, pH / 2 + 0.01 + ty, 0);
      group.add(hBar);
    }
    for (let c = 0; c < gridN; c++) {
      const tx = -pW * 0.35 + (c / (gridN - 1)) * pW * 0.7;
      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.003, pH * 0.8, 0.005), wireMat);
      vBar.position.set(tx, pH / 2 + 0.01, 0);
      group.add(vBar);
    }

    return group;
  },

  // <WarFan>, Folding metal war fan (open position)
  createWarFanModel(weapon, rand) {
    const group = new THREE.Group();
    const bladeColor  = this.getRandomColor(rand, this.bladeColors);
    const handleColor = this.getRandomColor(rand, this.guardColors);
    const gemColor    = this.getRandomColor(rand, this.crystalColors);
    const bladeMat  = new THREE.MeshStandardMaterial({ color: bladeColor,  roughness: 0.2, metalness: 0.9 });
    const handleMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.3, metalness: 0.85 });
    const panelMat  = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0.75 });
    const gemMat    = new THREE.MeshStandardMaterial({ color: gemColor, emissive: gemColor, emissiveIntensity: 0.6 });

    // Pivot pin + gem
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.04, 8), handleMat);
    pivot.rotation.x = Math.PI / 2;
    group.add(pivot);
    const pivotGem = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), gemMat);
    group.add(pivotGem);

    // Fan ribs radiating outward
    const numRibs  = 7;
    const fanSpread = Math.PI * 0.65;
    const ribLen   = 0.18;

    for (let i = 0; i < numRibs; i++) {
      const angle = -fanSpread / 2 + (i / (numRibs - 1)) * fanSpread;
      const dir   = new THREE.Vector3(Math.sin(angle) * ribLen, Math.cos(angle) * ribLen, 0);
      const rib   = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), dir), 4, 0.006, 4, false),
        bladeMat
      );
      group.add(rib);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), bladeMat);
      tip.position.copy(dir);
      group.add(tip);

      if (i < numRibs - 1) {
        const midAngle = angle + fanSpread / (numRibs - 1) / 2;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, ribLen * 0.85, 0.002), panelMat);
        panel.position.set(Math.sin(midAngle) * ribLen * 0.5, Math.cos(midAngle) * ribLen * 0.5, 0);
        panel.rotation.z = -midAngle;
        group.add(panel);
      }
    }
    return group;
  },

  // <Excalibur>, Holy sword with cruciform guard and divine glow
  createExcaliburModel(weapon, rand) {
    const group = new THREE.Group();
    const goldMat  = new THREE.MeshStandardMaterial({ color: 0xDDAA00, roughness: 0.15, metalness: 0.95 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xEEEEFF, roughness: 0.08, metalness: 0.98, emissive: 0xFFFFAA, emissiveIntensity: 0.25 });
    const holyMat  = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 1.0, transparent: true, opacity: 0.75 });
    const gemMat   = new THREE.MeshStandardMaterial({ color: 0x00AAFF, emissive: 0x00AAFF, emissiveIntensity: 1.0 });
    const wrapMat  = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.9 });

    const hH = 0.22;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, hH, 8), goldMat);
    h.position.y = -hH / 2;
    group.add(h);
    this.addGripWrap(h, rand, hH, 0.018, 0.015, wrapMat);

    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), goldMat);
    pommel.position.y = -hH;
    group.add(pommel);

    // Cross guard (wide horizontal + short vertical)
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.022), goldMat);
    group.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.055, 0.022), goldMat);
    group.add(crossV);
    const crossGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.014, 0), gemMat);
    crossGem.position.set(0, 0, 0.012);
    group.add(crossGem);

    const bH = 0.72, bW = 0.032, bT = 0.007;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bW, bH, bT), bladeMat);
    blade.position.y = bH / 2;
    group.add(blade);

    // Glowing fuller
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(bW * 0.15, bH * 0.78, bT * 1.4), holyMat);
    fuller.position.y = bH / 2;
    group.add(fuller);

    const tipH = bW * 1.2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(bW * 0.65, tipH, 4), bladeMat);
    tip.scale.z = bT / bW;
    tip.rotation.y = Math.PI / 4;
    tip.position.y = bH + tipH / 2;
    group.add(tip);

    // Floating divine sigils (cross shapes along blade)
    for (let i = 0; i < 3; i++) {
      const sx = bW * 0.9, sy = bH * (0.28 + i * 0.24);
      const sigH = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.005, 0.002), holyMat);
      sigH.position.set(sx, sy, 0);
      group.add(sigH);
      const sigV = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.025, 0.002), holyMat);
      sigV.position.set(sx, sy, 0);
      group.add(sigV);
    }
    return group;
  },

  // <DragonBlade>, Draconic serrated sword with fire glow
  createDragonBladeModel(weapon, rand) {
    const group = new THREE.Group();
    const darkRedMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.3,  metalness: 0.8  });
    const fireMat    = new THREE.MeshStandardMaterial({ color: 0xFF4400, emissive: 0xFF2200, emissiveIntensity: 0.95 });
    const blackMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7   });
    const wrapMat    = new THREE.MeshStandardMaterial({ color: 0x3A0000, roughness: 0.9   });

    const hH = 0.18;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, hH, 6), blackMat);
    h.position.y = -hH / 2;
    group.add(h);
    this.addGripWrap(h, rand, hH, 0.02, 0.015, wrapMat);

    // Dragon claw guard
    for (let i = -1; i <= 1; i++) {
      const clawCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(i * 0.05, 0.04, 0),
        new THREE.Vector3(i * 0.09, -0.01, 0)
      );
      const claw = new THREE.Mesh(new THREE.TubeGeometry(clawCurve, 5, 0.008, 4, false), darkRedMat);
      group.add(claw);
    }

    // Dragon head pommel
    const pGroup = new THREE.Group();
    pGroup.position.y = -hH;
    pGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), darkRedMat));
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.024, 4), darkRedMat);
    horn.position.y = 0.022;
    pGroup.add(horn);
    group.add(pGroup);

    const bH = 0.56, bW = 0.038, bT = 0.009;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bW, bH, bT), darkRedMat);
    blade.position.y = bH / 2;
    group.add(blade);

    // Fire fuller
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(bW * 0.18, bH * 0.7, bT * 1.3), fireMat);
    fuller.position.y = bH / 2;
    group.add(fuller);

    // Serrated fang edge
    for (let i = 0; i < 5; i++) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.025, 3), darkRedMat);
      fang.rotation.z = Math.PI / 2;
      fang.position.set(bW / 2 + 0.01, 0.07 + i * 0.09, 0);
      group.add(fang);
    }

    const tipH = 0.06;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(bW * 0.6, tipH, 4), darkRedMat);
    tip.scale.z = bT / bW;
    tip.rotation.y = Math.PI / 4;
    tip.position.y = bH + tipH / 2;
    group.add(tip);

    // Floating embers
    for (let i = 0; i < 5; i++) {
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.005 + rand() * 0.004, 4, 4), fireMat);
      ember.position.set((rand() - 0.5) * 0.06, 0.1 + rand() * bH, (rand() - 0.5) * 0.04);
      group.add(ember);
    }
    return group;
  },

  // <MagicOrb>, Floating faceted orb with orbiting rings
  createMagicOrbModel(weapon, rand) {
    const group = new THREE.Group();
    const orbColor    = this.getRandomColor(rand, this.crystalColors);
    const accentColor = this.getRandomColor(rand, this.crystalColors.filter(c => c !== orbColor));
    const metalColor  = this.getRandomColor(rand, this.guardColors);
    const orbMat    = new THREE.MeshStandardMaterial({ color: orbColor, emissive: orbColor, emissiveIntensity: 0.65, roughness: 0.05, transparent: true, opacity: 0.9 });
    const innerMat  = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 1.0, transparent: true, opacity: 0.45 });
    const ringMat   = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.3, metalness: 0.9 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 0.5 });

    const orbR = 0.07;
    group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(orbR, 1), orbMat));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(orbR * 0.4, 8, 8), innerMat));

    [[Math.PI / 2, 0, 0], [0, 0, Math.PI / 3], [Math.PI / 4, Math.PI / 4, 0]].forEach((angles, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(orbR * (1.38 + i * 0.01), 0.005, 4, 20), ringMat);
      ring.rotation.set(...angles);
      group.add(ring);
    });

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.015, 0), accentMat);
      shard.position.set(Math.cos(angle) * orbR * 1.8, Math.sin(angle * 1.3) * orbR * 0.5, Math.sin(angle) * orbR * 1.8);
      group.add(shard);
    }

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.01, 0.06, 6), ringMat);
    handle.position.y = -orbR - 0.03;
    group.add(handle);
    return group;
  },

  // <FoamFinger>, Giant foam "#1" fan finger
  createFoamFingerModel(weapon, rand) {
    const group = new THREE.Group();
    const teamColors = [0xFF6600, 0xFF0000, 0x0000DD, 0xFFCC00, 0x00BB00];
    const teamColor = teamColors[Math.floor(rand() * teamColors.length)];
    const foamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.9 });
    const textMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.9 });

    // Base glove body
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.06), foamMat);
    base.position.y = -0.05;
    group.add(base);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.04, 10), foamMat);
    wrist.position.y = -0.09;
    group.add(wrist);

    // Index finger pointing up
    const fBot = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.12, 8), foamMat);
    fBot.position.set(0.015, 0.08, 0);
    fBot.rotation.z = -0.05;
    group.add(fBot);
    const fMid = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, 0.10, 8), foamMat);
    fMid.position.set(0.012, 0.19, 0);
    fMid.rotation.z = -0.03;
    group.add(fMid);
    const fTip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), foamMat);
    fTip.position.set(0.009, 0.26, 0);
    group.add(fTip);

    // Curled other fingers
    for (let i = 0; i < 3; i++) {
      const stub = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), foamMat);
      stub.scale.y = 0.6;
      stub.position.set(-0.02 + i * 0.028, 0.01, 0.028);
      group.add(stub);
    }

    // "#1" band
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.014, 0.005), textMat);
    band.position.set(0, -0.035, 0.032);
    group.add(band);
    return group;
  },

  // <Spatula>, Cooking spatula (flipping weapon)
  createSpatulaModel(weapon, rand) {
    const group = new THREE.Group();
    const handleColors = [0xAA3311, 0x333333, 0x111111, 0x2255AA, 0x228833];
    const handleColor = handleColors[Math.floor(rand() * handleColors.length)];
    const metalMat  = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, roughness: 0.22, metalness: 0.9 });
    const handleMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.7 });
    const bandMat   = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.5 });
    const holeMat   = new THREE.MeshStandardMaterial({ color: 0x000000 });

    const hH = 0.28;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.01, hH, 6), handleMat);
    handle.position.y = -hH / 2;
    group.add(handle);
    this.addGripWrap(handle, rand, hH, 0.012, 0.01, bandMat);

    // Neck (slight tilt)
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.04, 6), metalMat);
    neck.position.y = 0.02;
    neck.rotation.z = 0.15;
    group.add(neck);

    // Wide flat blade
    const bladeW = 0.09, bladeH = 0.07;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bladeW, bladeH, 0.003), metalMat);
    blade.position.set(0.01, 0.08, 0);
    blade.rotation.z = 0.1;
    group.add(blade);

    // Drainage holes
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const hole = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.006), holeMat);
        hole.position.set(0.01 + (c - 1) * 0.025, 0.07 + (r - 0.5) * 0.025, 0);
        hole.rotation.z = 0.1;
        group.add(hole);
      }
    }

    // Edge rim
    const rim = new THREE.Mesh(new THREE.BoxGeometry(bladeW + 0.004, 0.005, 0.005), metalMat);
    rim.position.set(0.01, 0.116, 0);
    rim.rotation.z = 0.1;
    group.add(rim);
    return group;
  },

  // <CelestialHammer>, Meteoric hammer with star fragments orbiting
  createCelestialHammerModel(weapon, rand) {
    const group = new THREE.Group();
    const rockMat   = new THREE.MeshStandardMaterial({ color: 0x3A3A5A, roughness: 0.85, metalness: 0.1  });
    const glowMat   = new THREE.MeshStandardMaterial({ color: 0x8888FF, emissive: 0x8888FF, emissiveIntensity: 0.8 });
    const starMat   = new THREE.MeshStandardMaterial({ color: 0xFFFFDD, emissive: 0xFFFFDD, emissiveIntensity: 1.0 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x1A1A2A, roughness: 0.7 });

    const hH = 0.55;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, hH, 8), handleMat);
    h.position.y = -hH / 2 + 0.08;
    group.add(h);

    // Constellation dots on handle
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 4, 4), starMat);
      dot.position.set(Math.cos(angle) * 0.016, -hH * 0.28 + (i / 6) * hH * 0.5, Math.sin(angle) * 0.016);
      group.add(dot);
    }

    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 4), rockMat);
    spike.rotation.x = Math.PI;
    spike.position.y = -hH / 2 + 0.08 - hH / 2;
    group.add(spike);

    // Irregular meteoric head
    const headPos = 0.08;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.065, 0), rockMat);
    head.position.y = headPos;
    group.add(head);

    // Glowing cracks
    const c1 = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.04, headPos, 0.04),
      new THREE.Vector3(0, headPos + 0.02, 0),
      new THREE.Vector3(0.04, headPos, -0.04)
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(c1, 6, 0.003, 4, false), glowMat));
    const c2 = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, headPos + 0.065, 0),
      new THREE.Vector3(0.03, headPos + 0.03, 0),
      new THREE.Vector3(0.04, headPos - 0.04, 0.03)
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(c2, 6, 0.003, 4, false), glowMat));

    // Orbiting star shards
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.01, 0), starMat);
      shard.position.set(Math.cos(angle) * 0.1, headPos + (rand() * 0.04 - 0.02), Math.sin(angle) * 0.1);
      group.add(shard);
    }
    return group;
  },

  // <ChronosHammer>, Hourglass-shaped hammer with clock markings
  createChronosHammerModel(weapon, rand) {
    const group = new THREE.Group();
    const bronzeMat    = new THREE.MeshStandardMaterial({ color: 0xCD7F32, roughness: 0.4,  metalness: 0.8  });
    const goldMat      = new THREE.MeshStandardMaterial({ color: 0xDDAA00, roughness: 0.25, metalness: 0.95 });
    const glassMat     = new THREE.MeshStandardMaterial({ color: 0xAA8833, roughness: 0.1,  metalness: 0.0, transparent: true, opacity: 0.82 });
    const glowMat      = new THREE.MeshStandardMaterial({ color: 0xFFCC00, emissive: 0xCC9900, emissiveIntensity: 0.7 });
    const sandMat      = new THREE.MeshStandardMaterial({ color: 0xEECC88, emissive: 0xAAAA44, emissiveIntensity: 0.2 });

    const hH = 0.50;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, hH, 8), bronzeMat);
    h.position.y = -hH / 2 + 0.08;
    group.add(h);

    // Gear rings along handle
    for (let i = 0; i < 4; i++) {
      const y = -hH * 0.38 + (i / 3) * hH * 0.65;
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 4, 8), goldMat);
      gear.position.y = y;
      gear.rotation.x = Math.PI / 2;
      group.add(gear);
    }

    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), goldMat);
    pommel.position.y = -hH / 2 + 0.08 - hH / 2;
    group.add(pommel);

    // Hourglass head (two cones meeting at waist)
    const headPos = 0.08, coneH = 0.07, coneR = 0.065;
    const upperCone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 8), bronzeMat);
    upperCone.position.y = headPos + coneH / 2;
    group.add(upperCone);
    const lowerCone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 8), bronzeMat);
    lowerCone.rotation.x = Math.PI;
    lowerCone.position.y = headPos - coneH / 2;
    group.add(lowerCone);

    // Glass waist + sand
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.025, 8), glassMat);
    waist.position.y = headPos;
    group.add(waist);
    const sand = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), sandMat);
    sand.position.y = headPos - 0.015;
    sand.scale.y = 0.4;
    group.add(sand);

    // Clock tick marks on one face
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.003), glowMat);
      mark.position.set(Math.sin(angle) * 0.055, headPos, Math.cos(angle) * 0.055 + 0.062);
      mark.rotation.y = angle;
      group.add(mark);
    }

    // Orbiting distortion rings
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.004, 4, 16), glowMat);
    ring1.position.y = headPos;
    ring1.rotation.x = Math.PI / 4;
    group.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.003, 4, 16), glowMat);
    ring2.position.y = headPos;
    ring2.rotation.set(-Math.PI / 4, 0, Math.PI / 4);
    group.add(ring2);
    return group;
  },

  // <RocketLauncher>, Shoulder-mounted tube launcher with exhaust
  createRocketLauncherModel(weapon, rand) {
    const group = new THREE.Group();
    const tubeMat    = new THREE.MeshStandardMaterial({ color: 0x2A3A2A, roughness: 0.6, metalness: 0.5 });
    const metalMat   = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.75 });
    const gripMat    = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.9 });
    const warheadMat = new THREE.MeshStandardMaterial({ color: 0x886633, roughness: 0.5, metalness: 0.3 });

    const tubeR = 0.025, tubeL = 0.28;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, tubeL, 10), tubeMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.02, 0);
    group.add(tube);

    // Muzzle rim
    const muzzleRim = new THREE.Mesh(new THREE.TorusGeometry(tubeR * 1.05, 0.005, 6, 12), metalMat);
    muzzleRim.rotation.x = Math.PI / 2;
    muzzleRim.position.set(0, 0.02, tubeL / 2);
    group.add(muzzleRim);

    // Back exhaust cone
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(tubeR * 1.4, tubeR, 0.05, 10), tubeMat);
    exhaust.rotation.x = -Math.PI / 2;
    exhaust.position.set(0, 0.02, -tubeL / 2 - 0.025);
    group.add(exhaust);

    // Pistol grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.08, 0.03), gripMat);
    grip.position.set(0, -0.055, 0.02);
    grip.rotation.x = Math.PI / 10;
    group.add(grip);

    const trig = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 8, Math.PI), metalMat);
    trig.position.set(0, -0.01, 0.02);
    trig.rotation.y = Math.PI / 2;
    group.add(trig);

    // Shoulder rest
    const shoulderPad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.012), gripMat);
    shoulderPad.position.set(0, 0.015, -tubeL / 2 - 0.045);
    group.add(shoulderPad);

    // Top carry handle
    const topHandle = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.025, 0.055), tubeMat);
    topHandle.position.set(0, 0.06, 0.04);
    group.add(topHandle);

    // Rocket tip visible at muzzle
    const rocketTip = new THREE.Mesh(new THREE.ConeGeometry(tubeR * 0.8, 0.04, 8), warheadMat);
    rocketTip.rotation.x = Math.PI / 2;
    rocketTip.position.set(0, 0.02, tubeL / 2 + 0.02);
    group.add(rocketTip);

    // Sight rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.12), metalMat);
    rail.position.set(0, 0.055, 0.04);
    group.add(rail);
    return group;
  },

  // <Minigun>, Six-barrel rotating gatling cannon
  createMinigunModel(weapon, rand) {
    const group = new THREE.Group();
    const metalMat  = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.80 });
    const darkMat   = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.5, metalness: 0.60 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.3, metalness: 0.90 });
    const gripMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9  });

    // Central housing
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15, 12), darkMat);
    housing.rotation.x = Math.PI / 2;
    housing.position.set(0, 0.02, 0);
    group.add(housing);

    // Six barrels
    const numBarrels = 6, barrelOffset = 0.03, barrelL = 0.22;
    for (let i = 0; i < numBarrels; i++) {
      const angle = (i / numBarrels) * Math.PI * 2;
      const bx = Math.cos(angle) * barrelOffset;
      const by = Math.sin(angle) * barrelOffset;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, barrelL, 6), accentMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(bx, 0.02 + by, barrelL / 2 + 0.075);
      group.add(barrel);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.014, 6), metalMat);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(bx, 0.02 + by, barrelL + 0.075 + 0.007);
      group.add(muzzle);
    }

    // Front barrel cage
    const frontRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 12), metalMat);
    frontRing.rotation.x = Math.PI / 2;
    frontRing.position.set(0, 0.02, 0.075);
    group.add(frontRing);

    // Rear motor housing
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), darkMat);
    motor.rotation.x = Math.PI / 2;
    motor.position.set(0, 0.02, -0.12);
    group.add(motor);

    // Dual grips
    const handleL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.025), gripMat);
    handleL.position.set(-0.05, -0.035, 0);
    handleL.rotation.x = Math.PI / 12;
    group.add(handleL);
    const handleR = handleL.clone();
    handleR.position.x = 0.05;
    group.add(handleR);

    // Ammo feed
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.09, 6), darkMat);
    feed.rotation.z = Math.PI / 4;
    feed.position.set(0.07, -0.02, -0.05);
    group.add(feed);
    return group;
  },

  // <Flamethrower>, Tank body + hose + barrel + flame cone
  createFlamethrowerModel(weapon, rand) {
    const group = new THREE.Group();
    const tankMat   = new THREE.MeshStandardMaterial({ color: 0x556655, roughness: 0.5, metalness: 0.60 });
    const hoseMat   = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.10 });
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.35, metalness: 0.85 });
    const gripMat   = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.9  });
    const fireMat   = new THREE.MeshStandardMaterial({ color: 0xFF4400, emissive: 0xFF2200, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });
    const outerFire = new THREE.MeshStandardMaterial({ color: 0xFF8800, emissive: 0xFF4400, emissiveIntensity: 0.6, transparent: true, opacity: 0.5  });

    // Fuel tank
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 10), tankMat);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, 0.01, -0.10);
    group.add(tank);
    // Pressure gauge
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6), nozzleMat);
    gauge.position.set(0.04, 0.03, -0.10);
    group.add(gauge);

    // Hose (curved)
    const hoseCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0.01, -0.02),
      new THREE.Vector3(0, -0.04, 0.03),
      new THREE.Vector3(0, 0.01, 0.07)
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 8, 0.008, 6, false), hoseMat));

    // Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.15, 8), nozzleMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, 0.16);
    group.add(barrel);

    // Nozzle
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 8), nozzleMat);
    nozzle.rotation.x = -Math.PI / 2;
    nozzle.position.set(0, 0.01, 0.265);
    group.add(nozzle);

    // Grip + trigger guard
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.075, 0.03), gripMat);
    grip.position.set(0, -0.048, 0.06);
    grip.rotation.x = Math.PI / 10;
    group.add(grip);
    const trig = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.004, 4, 8, Math.PI), nozzleMat);
    trig.position.set(0, -0.006, 0.06);
    trig.rotation.y = Math.PI / 2;
    group.add(trig);

    // Flame cones
    const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.065, 8), fireMat);
    flameCore.rotation.x = -Math.PI / 2;
    flameCore.position.set(0, 0.01, 0.325);
    group.add(flameCore);
    const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.10, 8), outerFire);
    flameOuter.rotation.x = -Math.PI / 2;
    flameOuter.position.set(0, 0.01, 0.345);
    group.add(flameOuter);
    return group;
  },

  // <Shotgun>, Pump-action or double-barrel shotgun
  createShotgunModel(weapon, rand) {
    const group = new THREE.Group();
    const metalColor = this.getRandomColor(rand, [0x222222, 0x444444, 0x666666]);
    const woodColor  = this.getRandomColor(rand, this.handleColors);
    const metalMat = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.4, metalness: 0.8 });
    const woodMat  = new THREE.MeshStandardMaterial({ color: woodColor,  roughness: 0.85 });
    const gripMat  = new THREE.MeshStandardMaterial({ color: 0x1A1A1A,   roughness: 0.9  });

    const isDouble = rand() > 0.45;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.045, 0.09), metalMat);
    receiver.position.set(0, 0.012, -0.02);
    group.add(receiver);

    if (isDouble) {
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.009, 0.22, 8), metalMat);
      b1.rotation.x = Math.PI / 2;
      b1.position.set(0.009, 0.012, 0.135);
      group.add(b1);
      const b2 = b1.clone();
      b2.position.x = -0.009;
      group.add(b2);
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.22), metalMat);
      rib.position.set(0, 0.017, 0.135);
      group.add(rib);
    } else {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.24, 8), metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.012, 0.155);
      group.add(barrel);
      // Pump slide
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.018, 0.06), woodMat);
      slide.position.set(0, 0.004, 0.12);
      group.add(slide);
    }

    // Wood stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.042, 0.16), woodMat);
    stock.position.set(0, 0.01, -0.16);
    stock.rotation.x = -Math.PI / 28;
    group.add(stock);
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.06), woodMat);
    cheek.position.set(0, 0.035, -0.17);
    group.add(cheek);

    // Pistol grip + trigger guard
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.07, 0.03), woodMat);
    grip.position.set(0, -0.04, -0.04);
    grip.rotation.x = Math.PI / 8;
    group.add(grip);
    const trig = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 8, Math.PI), metalMat);
    trig.position.set(0, -0.008, 0);
    trig.rotation.y = Math.PI / 2;
    group.add(trig);

    // Front bead sight
    const sight = new THREE.Mesh(new THREE.SphereGeometry(0.004, 4, 4), metalMat);
    sight.position.set(0, 0.024, isDouble ? 0.24 : 0.27);
    group.add(sight);
    return group;
  },

  // <SniperRifle>, Long-barrel precision rifle with scope + bipod
  createSniperRifleModel(weapon, rand) {
    const group = new THREE.Group();
    const metalMat  = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.80 });
    const darkMat   = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.5, metalness: 0.60 });
    const gripMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9  });
    const scopeMat  = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.85 });
    const lensMat   = new THREE.MeshStandardMaterial({ color: 0x113355, roughness: 0.05, emissive: 0x001133, emissiveIntensity: 0.3 });

    // Very long barrel
    const barrelL = 0.35;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, barrelL, 8), metalMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, barrelL / 2 + 0.04);
    group.add(barrel);

    // Muzzle brake with slots
    const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.012, 0.025, 8), metalMat);
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, 0.015, barrelL + 0.055);
    group.add(muzzleBrake);
    for (let i = 0; i < 3; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 0.006), darkMat);
      slot.position.set(0, 0.029, barrelL + 0.04 + i * 0.007);
      group.add(slot);
    }

    // Receiver
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.10), metalMat);
    receiver.position.set(0, 0.012, 0.01);
    group.add(receiver);

    // Bolt handle
    const boltBody = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.035, 6), metalMat);
    boltBody.rotation.z = Math.PI / 2;
    boltBody.position.set(0.035, 0.015, 0.025);
    group.add(boltBody);
    const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 6), metalMat);
    boltKnob.position.set(0.05, 0.015, 0.025);
    group.add(boltKnob);

    // Long stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.035, 0.20), gripMat);
    stock.position.set(0, 0.01, -0.155);
    stock.rotation.x = -Math.PI / 30;
    group.add(stock);
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, 0.07), gripMat);
    cheek.position.set(0, 0.036, -0.14);
    group.add(cheek);

    // Pistol grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.065, 0.028), gripMat);
    grip.position.set(0, -0.038, -0.04);
    grip.rotation.x = Math.PI / 9;
    group.add(grip);

    // Scope tube
    const scopeL = 0.14;
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, scopeL, 10), scopeMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.054, 0);
    group.add(scope);
    // Lenses
    const frontLens = new THREE.Mesh(new THREE.CircleGeometry(0.014, 12), lensMat);
    frontLens.position.set(0, 0.054, scopeL / 2);
    group.add(frontLens);
    const rearLens = frontLens.clone();
    rearLens.rotation.y = Math.PI;
    rearLens.position.set(0, 0.054, -scopeL / 2);
    group.add(rearLens);
    // Turret dials
    const turretT = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 6), scopeMat);
    turretT.position.set(0, 0.072, 0.005);
    group.add(turretT);
    const turretS = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 6), scopeMat);
    turretS.rotation.z = Math.PI / 2;
    turretS.position.set(0.03, 0.054, 0.005);
    group.add(turretS);

    // Bipod legs
    for (let side = -1; side <= 1; side += 2) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.04, 0.004), metalMat);
      leg.position.set(side * 0.012, -0.01, 0.22);
      leg.rotation.z = side * Math.PI / 12;
      group.add(leg);
    }

    // Magazine
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.055, 0.018), darkMat);
    mag.position.set(0, -0.04, 0.01);
    group.add(mag);
    return group;
  },

  // <SMG>, Compact submachine gun with foregrip and folded stock
  createSMGModel(weapon, rand) {
    const group = new THREE.Group();
    const bodyColor   = this.getRandomColor(rand, [0x222222, 0x333333, 0x1A1A2A, 0x2D3A2A]);
    const accentColor = this.getRandomColor(rand, [0x444444, 0x555555, 0xAAAAAA]);
    const bodyMat   = new THREE.MeshStandardMaterial({ color: bodyColor,   roughness: 0.5, metalness: 0.75 });
    const metalMat  = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.85 });
    const gripMat   = new THREE.MeshStandardMaterial({ color: 0x1A1A1A,    roughness: 0.9  });

    // Compact receiver
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.055, 0.12), bodyMat);
    body.position.set(0, 0.01, -0.01);
    group.add(body);

    // Short barrel + muzzle
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.008, 0.08, 8), metalMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, 0.10);
    group.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.012, 8), metalMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.015, 0.15);
    group.add(muzzle);

    // Angled pistol grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.075, 0.032), gripMat);
    grip.position.set(0, -0.047, -0.01);
    grip.rotation.x = Math.PI / 10;
    group.add(grip);

    // Trigger guard
    const trig = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.004, 4, 8, Math.PI), metalMat);
    trig.position.set(0, -0.008, 0.02);
    trig.rotation.y = Math.PI / 2;
    group.add(trig);

    // Vertical foregrip
    const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, 0.018), gripMat);
    foregrip.position.set(0, -0.038, 0.07);
    foregrip.rotation.x = -Math.PI / 14;
    group.add(foregrip);

    // Tall box magazine
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.085, 0.02), bodyMat);
    mag.position.set(0, -0.05, -0.025);
    group.add(mag);

    // Folded wire stock
    const stockH = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.065), metalMat);
    stockH.position.set(0, 0.01, -0.10);
    group.add(stockH);
    const stockV = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.008), metalMat);
    stockV.position.set(0, -0.008, -0.13);
    group.add(stockV);

    // Iron sight post
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.01, 0.006), metalMat);
    frontSight.position.set(0, 0.04, 0.14);
    group.add(frontSight);
    return group;
  },

  // <Crown>, Wearable crown used as a weapon
  createCrownModel(weapon, rand) {
    const group = new THREE.Group();
    const goldMat  = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.2, metalness: 0.95 });
    const gemColors = [0xFF2244, 0x2255FF, 0x22CC44, 0xAA22FF, 0xFF8800];
    const gemColor  = gemColors[Math.floor(rand() * gemColors.length)];
    const gemMat   = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.0, metalness: 0.1, emissive: gemColor, emissiveIntensity: 0.3 });

    // Ring base
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 8, 32), goldMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Decorative lower band
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.007, 5, 32), goldMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.01;
    group.add(band);

    // 5 prongs, alternating tall and short
    const numProngs = 5;
    for (let i = 0; i < numProngs; i++) {
      const angle = (i / numProngs) * Math.PI * 2;
      const px = Math.cos(angle) * 0.078;
      const pz = Math.sin(angle) * 0.078;
      const isTall = i % 2 === 0;
      const height = isTall ? 0.085 : 0.055;

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.04, 6), goldMat);
      base.position.set(px, 0.028, pz);
      group.add(base);

      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.009, height, 6), goldMat);
      spike.position.set(px, 0.048 + height / 2, pz);
      group.add(spike);

      if (isTall) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.012, 0), gemMat);
        gem.position.set(px, 0.046, pz);
        group.add(gem);
      }
    }

    group.scale.setScalar(1.1);
    return group;
  },

  // <Nunchaku>, Two handles connected by physics chain
  createNunchakuModel(weapon, rand) {
    const group = new THREE.Group();
    const woodColors = [0x8B4513, 0x5C3317, 0x7A5230, 0x2E2E2E];
    const stickColor = woodColors[Math.floor(rand() * woodColors.length)];
    const isSteel = stickColor === 0x2E2E2E;
    const stickMat = new THREE.MeshStandardMaterial({ color: stickColor, roughness: isSteel ? 0.35 : 0.7, metalness: isSteel ? 0.85 : 0 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.3, metalness: 0.9 });
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.25, metalness: 0.95 });

    const sH  = 0.18;
    const gap = 0.07;

    // Stick A: held in hand, fixed position
    const stickA = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.011, sH, 8), stickMat);
    stickA.position.set(-0.024, -sH / 2, 0);
    stickA.rotation.z = 0.14;
    group.add(stickA);

    const capA = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 8), metalMat);
    capA.position.set(-0.024, -sH - 0.004, 0);
    group.add(capA);

    const collarA = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 8), metalMat);
    collarA.position.set(-0.024, 0, 0);
    group.add(collarA);

    // Stick B: free end that follows the chain tip
    const stickBGroup = new THREE.Group();
    stickBGroup.position.set(0.024, -gap, 0);

    const stickB = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.011, sH, 8), stickMat);
    stickB.position.y = -sH / 2;
    stickB.rotation.z = -0.14;
    stickBGroup.add(stickB);

    const capB = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 8), metalMat);
    capB.position.y = -sH - 0.004;
    stickBGroup.add(capB);

    const collarB = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 8), metalMat);
    collarB.position.y = 0;
    stickBGroup.add(collarB);

    group.add(stickBGroup);

    // Verlet rope physics for the chain
    const numLinks = 6;
    const anchorPos = new THREE.Vector3(-0.024, 0, 0);
    const segLen = gap / numLinks;

    const rope = this.createVerletRope(numLinks + 1, segLen, anchorPos, {
      gravity: -0.0008,
      damping: 0.88,
      iterations: 10,
      stiffness: 0.92,
      endMass: 1.8
    });

    // Torus chain link meshes with alternating orientation
    for (let i = 0; i < numLinks; i++) {
      const t = (i + 0.5) / numLinks;
      const lx = -0.024 + t * 0.048;
      const ly = -Math.sin(t * Math.PI) * 0.02 - t * gap;
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.002, 4, 8), chainMat);
      link.position.set(lx, ly, 0);
      link.userData._chainAlternate = (i % 2 === 0);
      group.add(link);
      rope.segmentMeshes.push(link);
    }

    rope.headMeshGroup = stickBGroup;
    group.userData._verletRope = rope;

    return group;
  },

  // <Railgun>, Electromagnetic accelerator with coil rings
  createRailgunModel(weapon, rand) {
    const group = new THREE.Group();
    const bodyMat  = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.45, metalness: 0.85 });
    const railMat  = new THREE.MeshStandardMaterial({ color: 0xAAAAAA, roughness: 0.2,  metalness: 0.95 });
    const coilMat  = new THREE.MeshStandardMaterial({ color: 0x00AAFF, roughness: 0.3,  metalness: 0.6, emissive: 0x0033FF, emissiveIntensity: 0.4 });
    const capMat   = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.4,  metalness: 0.8 });
    const gripMat  = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

    // Barrel housing
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.38, 8), bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.06);
    group.add(barrel);

    // Parallel rail bars
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.38), railMat);
      rail.position.set(side * 0.018, 0.02 + side * 0.012, 0.06);
      group.add(rail);
    }

    // Electromagnetic coil rings (6 spaced along barrel)
    for (let i = 0; i < 6; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 16), coilMat);
      coil.rotation.y = Math.PI / 2;
      coil.position.set(0, 0.02, -0.12 + i * 0.065);
      group.add(coil);
    }

    // Power capacitor bank on top
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.09), capMat);
    cap.position.set(0, 0.044, 0.02);
    group.add(cap);

    // Receiver body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.1), bodyMat);
    body.position.set(0, 0.02, -0.07);
    group.add(body);

    // Pistol grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.07, 0.03), gripMat);
    grip.position.set(0, -0.028, -0.06);
    grip.rotation.x = Math.PI / 12;
    group.add(grip);

    // Trigger guard
    const trig = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 4, 8, Math.PI), railMat);
    trig.position.set(0, -0.006, -0.04);
    trig.rotation.y = Math.PI / 2;
    group.add(trig);

    // Bipod legs at front
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.003, 0.06, 5), railMat);
      leg.position.set(side * 0.022, -0.012, 0.16);
      leg.rotation.z = side * 0.55;
      group.add(leg);
    }

    // Muzzle brake
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.022, 8), railMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.02, 0.26);
    group.add(muzzle);

    // Scope
    const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.07, 8), bodyMat);
    scopeBody.rotation.x = Math.PI / 2;
    scopeBody.position.set(0, 0.057, 0.01);
    group.add(scopeBody);
    const scopeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.005, 8), coilMat);
    scopeLens.rotation.x = Math.PI / 2;
    scopeLens.position.set(0, 0.057, 0.048);
    group.add(scopeLens);

    return group;
  },

  // <ArmCannon>, Cybernetic forearm-mounted weapon platform
  createArmCannonModel(weapon, rand) {
    const group = new THREE.Group();
    const bodyColor = this.getRandomColor(rand, [0x223344, 0x332233, 0x223322, 0x443322]);
    const bodyMat   = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4,  metalness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x8899AA,  roughness: 0.2,  metalness: 0.95 });
    const energyMat = new THREE.MeshStandardMaterial({ color: 0x00EEFF,  roughness: 0.1,  metalness: 0.3, emissive: 0x00AACC, emissiveIntensity: 0.6 });
    const darkMat   = new THREE.MeshStandardMaterial({ color: 0x111111,  roughness: 0.9 });

    // Forearm cuff (wide flat body)
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.065, 0.22), bodyMat);
    group.add(cuff);

    // Rounded edge cylinders
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.0325, 0.0325, 0.22, 8), bodyMat);
      edge.rotation.x = Math.PI / 2;
      edge.position.set(side * 0.055, 0, 0);
      group.add(edge);
    }

    // Main barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 10), accentMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, 0.155);
    group.add(barrel);

    // Barrel energy ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 16), energyMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0, 0.01, 0.195);
    group.add(ring);

    // Energy cell on back
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.06, 8), energyMat);
    cell.rotation.x = Math.PI / 2;
    cell.position.set(0, 0.01, -0.13);
    group.add(cell);

    // Vent slats on top
    for (let i = 0; i < 4; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.005, 0.012), darkMat);
      vent.position.set(0, 0.035, -0.04 + i * 0.022);
      group.add(vent);
    }

    // Side panel accents
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.045, 0.14), accentMat);
      panel.position.set(side * 0.052, 0.005, 0.02);
      group.add(panel);
    }

    return group;
  },

  // <Boomerang>, Curved aerodynamic returning weapon
  createBoomerangModel(weapon, rand) {
    const group = new THREE.Group();
    const woodColors = [0x8B6914, 0x6B4B0A, 0xA07030, 0x4A3010];
    const woodColor  = woodColors[Math.floor(rand() * woodColors.length)];
    const woodMat = new THREE.MeshStandardMaterial({ color: woodColor, roughness: 0.75 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xCC2211,  roughness: 0.6  });

    // Arm A
    const armA = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.008, 0.18), woodMat);
    armA.position.set(0.06, 0, -0.04);
    armA.rotation.y = -0.45;
    group.add(armA);

    // Arm B
    const armB = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.008, 0.18), woodMat);
    armB.position.set(-0.06, 0, -0.04);
    armB.rotation.y = 0.45;
    group.add(armB);

    // Center join
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.012, 0.055), woodMat);
    group.add(center);

    // Decorative painted bands
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.010, 0.014), bandMat);
      band.position.set(side * 0.09, 0, -0.06);
      band.rotation.y = -side * 0.45;
      group.add(band);
    }

    group.rotation.x = -Math.PI / 2.5;
    return group;
  },

  // <Chakram>, Circular throwing ring with spokes and gem center
  createChakramModel(weapon, rand) {
    const group = new THREE.Group();
    const metalColors = [0xCCCCCC, 0xE8C850, 0x88AACC, 0xCC8844];
    const metalColor  = metalColors[Math.floor(rand() * metalColors.length)];
    const metalMat = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.15, metalness: 0.95 });
    const edgeMat  = new THREE.MeshStandardMaterial({ color: 0xEEEEEE,  roughness: 0.05, metalness: 1.0  });
    const gemMat   = new THREE.MeshStandardMaterial({ color: 0xFF2244,  roughness: 0.0,  metalness: 0.1, emissive: 0x880011, emissiveIntensity: 0.3 });

    // Main ring body
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 40), metalMat);
    group.add(ring);

    // Sharp outer edge
    const edge = new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.004, 5, 40), edgeMat);
    group.add(edge);

    // Inner hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.008, 12), metalMat);
    hub.rotation.x = Math.PI / 2;
    group.add(hub);

    // 4 spokes
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.13), metalMat);
      spoke.rotation.z = (i / 4) * Math.PI;
      group.add(spoke);
    }

    // Center gem
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.013, 0), gemMat);
    gem.position.z = 0.006;
    group.add(gem);

    group.rotation.x = Math.PI / 2;
    return group;
  },

  // <Trident>, Three-pronged weapon with cross guard
  createTridentModel(weapon, rand) {
    const group = new THREE.Group();
    const metalColors = [0x8899AA, 0x778888, 0xAABBCC, 0x558899];
    const metalColor  = metalColors[Math.floor(rand() * metalColors.length)];
    const metalMat = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.3, metalness: 0.9 });
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6B4B0A,  roughness: 0.7 });
    const bandMat  = new THREE.MeshStandardMaterial({ color: 0x888888,  roughness: 0.4, metalness: 0.85 });

    // Shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.42, 8), shaftMat);
    shaft.position.y = -0.08;
    group.add(shaft);
    this.addGripWrap(shaft, rand, 0.42, 0.011, 0.009, bandMat);

    // Cross guard
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6), metalMat);
    guard.rotation.z = Math.PI / 2;
    guard.position.y = 0.1;
    group.add(guard);
    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.016, 6), metalMat);
      tip.rotation.z = -side * Math.PI / 2;
      tip.position.set(side * 0.056, 0.1, 0);
      group.add(tip);
    }

    // Center prong
    const centerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 7), metalMat);
    centerShaft.position.y = 0.175;
    group.add(centerShaft);
    const centerTip = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.07, 7), metalMat);
    centerTip.position.y = 0.255;
    group.add(centerTip);

    // Side prongs (angled outward)
    for (const side of [-1, 1]) {
      const prongShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6), metalMat);
      prongShaft.position.set(side * 0.024, 0.17, 0);
      prongShaft.rotation.z = side * 0.22;
      group.add(prongShaft);
      const prongTip = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.052, 6), metalMat);
      prongTip.position.set(side * 0.034, 0.222, 0);
      prongTip.rotation.z = side * 0.22;
      group.add(prongTip);
    }

    // Butt spike
    const butt = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.038, 6), metalMat);
    butt.rotation.x = Math.PI;
    butt.position.y = -0.31;
    group.add(butt);

    return group;
  },

  // <Crossbow>, Mechanical crossbow with prod, rail, stock, and string
  createCrossbowModel(weapon, rand) {
    const group = new THREE.Group();
    const woodColors = [0x7A4020, 0x5C3010, 0x8B5020, 0x333333];
    const woodColor  = woodColors[Math.floor(rand() * woodColors.length)];
    const woodMat  = new THREE.MeshStandardMaterial({ color: woodColor, roughness: 0.75 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xAAAAAA,  roughness: 0.25, metalness: 0.9 });
    const strMat   = new THREE.MeshStandardMaterial({ color: 0xCCBB88,  roughness: 0.9  });

    // Stock (tiller)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.038, 0.22), woodMat);
    stock.position.set(0, 0, -0.06);
    group.add(stock);

    // Pistol grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.072, 0.026), woodMat);
    grip.position.set(0, -0.048, -0.04);
    grip.rotation.x = Math.PI / 10;
    group.add(grip);

    // Rail on top
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.18), metalMat);
    rail.position.set(0, 0.026, 0.025);
    group.add(rail);

    // Prod center mount
    const prodCenter = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.02), metalMat);
    prodCenter.position.set(0, 0, 0.122);
    group.add(prodCenter);

    // Limbs
    for (const side of [-1, 1]) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.014, 0.11), metalMat);
      limb.position.set(side * 0.065, 0.001, 0.115);
      limb.rotation.z = side * 0.18;
      group.add(limb);
      const limbTip = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.013, 0.02), metalMat);
      limbTip.position.set(side * 0.114, 0.002, 0.118);
      limbTip.rotation.z = side * 0.18;
      group.add(limbTip);
    }

    // Bowstring
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.24, 4), strMat);
    str.rotation.z = Math.PI / 2;
    str.position.set(0, 0.002, 0.118);
    group.add(str);

    // Trigger
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.024, 0.014), metalMat);
    trigger.position.set(0, -0.016, -0.008);
    group.add(trigger);

    // Stirrup at front
    const stirrup = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 5, 10, Math.PI), metalMat);
    stirrup.position.set(0, -0.006, 0.14);
    stirrup.rotation.x = -Math.PI / 2;
    group.add(stirrup);

    return group;
  },

  // <Halberd>, Poleaxe with spike, broad axe blade, and back hook
  createHalberdModel(weapon, rand) {
    const group = new THREE.Group();
    const metalColors = [0x999999, 0xAAAAAA, 0x778899, 0x886644];
    const metalColor  = metalColors[Math.floor(rand() * metalColors.length)];
    const metalMat = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.35, metalness: 0.88 });
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6B3A0A,  roughness: 0.72 });
    const bandMat  = new THREE.MeshStandardMaterial({ color: 0x777777,  roughness: 0.45, metalness: 0.8 });

    // Pole
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.010, 0.50, 7), shaftMat);
    shaft.position.y = -0.10;
    group.add(shaft);
    this.addGripWrap(shaft, rand, 0.50, 0.011, 0.010, bandMat);

    // Butt spike
    const butt = new THREE.Mesh(new THREE.ConeGeometry(0.010, 0.038, 6), metalMat);
    butt.rotation.x = Math.PI;
    butt.position.y = -0.365;
    group.add(butt);

    // Socket
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.065, 7), metalMat);
    socket.position.y = 0.14;
    group.add(socket);

    // Axe blade (flat wide wedge)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.12, 0.105), metalMat);
    blade.position.set(0.04, 0.16, 0);
    group.add(blade);
    const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.12, 0.004), metalMat);
    bevel.position.set(0.092, 0.16, 0);
    group.add(bevel);

    // Top spike
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.1, 7), metalMat);
    spike.position.y = 0.222;
    group.add(spike);

    // Back hook
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.005, 5, 8, Math.PI * 0.7), metalMat);
    hook.position.set(-0.028, 0.16, 0);
    hook.rotation.z = Math.PI / 2.5;
    group.add(hook);

    return group;
  },

  // <DroneLauncher>, Multi-tube launcher with hexagonal drone bays
  createDroneLauncherModel(weapon, rand) {
    const group = new THREE.Group();
    const bodyMat   = new THREE.MeshStandardMaterial({ color: 0x2A2A3A, roughness: 0.5,  metalness: 0.8  });
    const tubeMat   = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.4,  metalness: 0.9  });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.35, metalness: 0.85 });
    const sensorMat = new THREE.MeshStandardMaterial({ color: 0x00EEBB, roughness: 0.1,  metalness: 0.4, emissive: 0x009966, emissiveIntensity: 0.5 });
    const gripMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.22), bodyMat);
    body.position.set(0, 0.01, -0.01);
    group.add(body);

    // Hex tube cluster at front (7 tubes: center + 6 around)
    const hexOffsets = [
      [0, 0], [0.028, 0], [-0.028, 0],
      [0.014, 0.024], [-0.014, 0.024],
      [0.014, -0.024], [-0.014, -0.024]
    ];
    for (const [tx, ty] of hexOffsets) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.08, 6), tubeMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(tx, ty + 0.01, 0.14);
      group.add(tube);
    }

    // Front face plate
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.078, 0.008), accentMat);
    face.position.set(0, 0.01, 0.102);
    group.add(face);

    // Targeting sensor on top
    const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.06), sensorMat);
    sensor.position.set(0, 0.055, 0.03);
    group.add(sensor);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), sensorMat);
    lens.position.set(0, 0.055, 0.06);
    group.add(lens);

    // Pistol grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.075, 0.032), gripMat);
    grip.position.set(0, -0.052, -0.04);
    grip.rotation.x = Math.PI / 10;
    group.add(grip);

    // Trigger guard
    const trig = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 8, Math.PI), accentMat);
    trig.position.set(0, -0.01, -0.01);
    trig.rotation.y = Math.PI / 2;
    group.add(trig);

    // Side handles
    for (const side of [-1, 1]) {
      const sideH = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.035, 0.055), accentMat);
      sideH.position.set(side * 0.05, -0.02, 0.02);
      group.add(sideH);
    }

    // Status LEDs
    for (let i = 0; i < 3; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.006, 0.006), sensorMat);
      led.position.set(0, 0.046, -0.05 + i * 0.04);
      group.add(led);
    }

    return group;
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

    // Screen-space nudge from the shared weapon anchor, in game pixels.
    // Guns sit low and to the right like a first-person viewmodel; melee
    // weapons hang off the anchor by their grip.
    Sprite_3DWeapon.prototype._anchorOffsetX = function() {
      return this._weapon.wtypeId === 9 ? 40 : (this._weapon.model3d ? 0 : 20);
    };
    // A procedural model grows around its own centre, so the taller the weapon
    // is drawn the further its grip end reaches below the anchor: lift it by a
    // share of its drawn height to keep the pommel inside the battle view.
    Sprite_3DWeapon.prototype._anchorOffsetY = function() {
      const w = this._weapon;
      if (w.wtypeId === 9) return -70;
      if (w.model3d) return 0;
      const screenH = (typeof Graphics !== 'undefined' && Graphics.height) ? Graphics.height : 624;
      return screenH * WeaponSystemProcedural.screenFractionFor(w) * 0.16 - 20;
    };

    // Reset 3D weapon back to idle first-person pose
    Sprite_3DWeapon.prototype._resetToIdle = function() {
      if (!this._model) return;
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
      // Set base rotation for weapons if not defined
      if (!this._weapon.model3dRotation) {
        const wtypeId = this._weapon.wtypeId || 1;
        if (this._weapon.isWhip) {
          this._baseRotation = { x: 0, y: 0, z: -15 };
        } else if (this._weapon.isFlail) {
          this._baseRotation = { x: 0, y: 0, z: -10 };
        } else {
          switch (wtypeId) {
            case 1: this._baseRotation = { x: 0, y: 0, z: -20 }; break; // Light (Dagger)
            case 2: this._baseRotation = { x: 0, y: 0, z: -15 }; break; // Sword
            case 3: this._baseRotation = { x: 0, y: 0, z: -25 }; break; // Heavy
            case 4: this._baseRotation = { x: 0, y: 0, z: -20 }; break; // Axe
            case 5: this._baseRotation = { x: 0, y: 0, z: -15 }; break; // Whip
            case 6: this._baseRotation = { x: 0, y: 0, z: -10 }; break; // Staff
            // Bows are modelled flat in the Y-Z plane, so the default pose
            // showed them edge-on as a vertical sliver: turn the belly of the
            // bow toward the camera.
            case 7: this._baseRotation = { x: 0, y: 90, z: -8 }; break;  // Bow
            // Thrown weapons point along +Z (kunai, dart) or lie in the X-Y
            // plane (shuriken); a partial tilt reads for both.
            case 8: this._baseRotation = { x: 55, y: 0, z: -20 }; break; // Projectile
            case 9: this._baseRotation = { x: -10, y: 195, z: -10 }; break;   // Gun FPS rotation
            case 10: this._baseRotation = { x: 0, y: 0, z: -15 }; break; // Claw
            case 11: this._baseRotation = { x: 0, y: 0, z: 0 }; break;  // Glove
            case 12: this._baseRotation = { x: 0, y: 0, z: -15 }; break; // Spear
            default: this._baseRotation = { x: 0, y: 0, z: -15 }; break;
          }
        }
      } else {
        this._baseRotation = this._weapon.model3dRotation;
      }

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

          if (this._pendingAnimation) {
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

          if (this._pendingAnimation) {
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
      const lt = span > 0 ? (t - prev.t) / span : 0;
      const lerp = (a, b, f) => a + (b - a) * f;

      const px = lerp(prev.x || 0, next.x || 0, lt);
      const py = lerp(prev.y || 0, next.y || 0, lt);
      const pz = lerp(prev.z || 0, next.z || 0, lt);
      const rx = lerp(prev.rx || 0, next.rx || 0, lt);
      const ry = lerp(prev.ry || 0, next.ry || 0, lt);
      const rz = lerp(prev.rz || 0, next.rz || 0, lt);
      const sc = lerp(
        prev.scale !== undefined ? prev.scale : 1,
        next.scale !== undefined ? next.scale : 1,
        lt
      );

      this._model.position.set(
        this._worldX(this._screenX) + this._anchorOffsetX() + px,
        this._worldY(this._screenY) + this._anchorOffsetY() + py,
        pz
      );
      const r = this._baseRotation;
      this._model.rotation.set(
        THREE.MathUtils.degToRad(r.x + rx),
        THREE.MathUtils.degToRad(r.y + ry),
        THREE.MathUtils.degToRad(r.z + rz)
      );

      const s = this._baseScale() * sc;
      this._model.scale.set(s, s, s);

      if (t >= 1.0) {
        this._animData = null;
        this._resetToIdle();
      }
    };

    // Override playAnimation to correctly display/hide procedural/GLB models and trigger custom animations
    Sprite_3DWeapon.prototype.playAnimation = function(name) {
      this._animElapsed = 0;
      this._animData = null;
      this._clipPlaying = false; // Reset clip status when starting any animation

      if (!this._model) {
        this._pendingAnimation = name;
        return;
      }

      this._model.visible = true;
      this._visible = true;

      // Fallback check for GLTF clips
      if (this._clips && this._clips[name]) {
        this.playClip(name);
        return;
      }
      if (name === 'Shoot' && this._clips && this._clips['Shoot']) {
        this.playClip('Shoot');
        return;
      }

      const kf = window._weaponKeyframes3d;
      if (kf && kf[name]) {
        this._animData = kf[name];
        return;
      }

      // Per-type procedural attack animations for all 12 weapon types plus physics weapons
      if (!this._weapon.model3d) {
        if (this._weapon.isWhip) {
          this._animData = {
            duration: 500,
            frames: [
              { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
              { t: 0.3, x: 22, y: -22, z: -22, rx: -22, ry: 0, rz: 16, scale: 1.0 },
              { t: 0.55, x: -32, y: 12, z: 58, rx: 12, ry: 0, rz: -24, scale: 1.0 },
              { t: 0.72, x: -16, y: 6, z: 24, rx: 6, ry: 0, rz: -11, scale: 1.0 },
              { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
            ]
          };
          return;
        }
        if (this._weapon.isFlail) {
          this._animData = {
            duration: 700,
            frames: [
              { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
              { t: 0.35, x: 42, y: -32, z: -22, rx: -16, ry: 16, rz: 27, scale: 1.0 },
              { t: 0.65, x: -55, y: 28, z: 38, rx: 16, ry: -11, rz: -38, scale: 1.06 },
              { t: 0.85, x: -22, y: 11, z: 16, rx: 6, ry: -5, rz: -16, scale: 1.0 },
              { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
            ]
          };
          return;
        }
        switch (this._weapon.wtypeId) {
          case 1: // Dagger - fast stab
            this._animData = {
              duration: 340,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.18, x: 16, y: -28, z: -16, rx: -16, ry: 0, rz: 13, scale: 1.0 },
                { t: 0.5, x: -11, y: 11, z: 75, rx: 20, ry: 0, rz: -7, scale: 1.0 },
                { t: 0.7, x: -5, y: 5, z: 38, rx: 9, ry: 0, rz: -3, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 2: // Sword - diagonal slash
            this._animData = {
              duration: 540,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.25, x: 68, y: -58, z: -16, rx: -19, ry: 23, rz: 34, scale: 1.0 },
                { t: 0.58, x: -88, y: 68, z: 27, rx: 24, ry: -13, rz: -62, scale: 1.06 },
                { t: 0.78, x: -52, y: 42, z: 13, rx: 13, ry: -7, rz: -41, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 3: // Heavy - overhead slam
            this._animData = {
              duration: 760,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.3, x: 0, y: -95, z: -38, rx: -48, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.57, x: 0, y: 95, z: 75, rx: 58, ry: 0, rz: 0, scale: 1.09 },
                { t: 0.75, x: 0, y: 48, z: 27, rx: 24, ry: 0, rz: 0, scale: 1.02 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 4: // Axe - side chop
            this._animData = {
              duration: 600,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.25, x: 58, y: -38, z: -24, rx: -13, ry: 32, rz: 29, scale: 1.0 },
                { t: 0.57, x: -68, y: 24, z: 38, rx: 13, ry: -19, rz: -52, scale: 1.07 },
                { t: 0.77, x: -40, y: 13, z: 16, rx: 7, ry: -11, rz: -33, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 5: // Whip (generic type 5) - crack forward
            this._animData = {
              duration: 500,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.3, x: 22, y: -22, z: -22, rx: -22, ry: 0, rz: 16, scale: 1.0 },
                { t: 0.55, x: -32, y: 12, z: 58, rx: 12, ry: 0, rz: -24, scale: 1.0 },
                { t: 0.72, x: -16, y: 6, z: 24, rx: 6, ry: 0, rz: -11, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 6: // Staff - thrust and spin
            this._animData = {
              duration: 500,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.2, x: -20, y: -11, z: -38, rx: -13, ry: -11, rz: -11, scale: 1.0 },
                { t: 0.5, x: 11, y: 22, z: 85, rx: 20, ry: 11, rz: 11, scale: 1.0 },
                { t: 0.7, x: 5, y: 11, z: 38, rx: 9, ry: 5, rz: 5, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 7: // Bow - draw and release
            this._animData = {
              duration: 600,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.6, x: -30, y: 0, z: -80, rx: 0, ry: -15, rz: 0, scale: 1.0 },
                { t: 0.7, x: 20, y: 0, z: 10, rx: 0, ry: 5, rz: 0, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 8: // Projectile - throw/fling
            this._animData = {
              duration: 400,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.2, x: 37, y: -48, z: -27, rx: -24, ry: 16, rz: 19, scale: 1.0 },
                { t: 0.5, x: -68, y: 27, z: 38, rx: 13, ry: -22, rz: -34, scale: 0.62 },
                { t: 0.72, x: -95, y: 19, z: 65, rx: 7, ry: -30, rz: -47, scale: 0.32 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 9: // Gun - recoil
            this._animData = {
              duration: 300,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.1, x: 0, y: 16, z: -38, rx: -22, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.3, x: 0, y: 9, z: -16, rx: -11, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.6, x: 0, y: 2, z: -4, rx: -3, ry: 0, rz: 0, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 10: // Claw - fast slash
            this._animData = {
              duration: 390,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.15, x: 34, y: -24, z: 0, rx: -13, ry: 24, rz: 24, scale: 1.0 },
                { t: 0.44, x: -78, y: 34, z: 30, rx: 19, ry: -19, rz: -47, scale: 1.06 },
                { t: 0.68, x: -44, y: 17, z: 13, rx: 7, ry: -7, rz: -24, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 11: // Glove - straight punch
            this._animData = {
              duration: 340,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.15, x: 19, y: -13, z: -24, rx: -13, ry: 13, rz: 7, scale: 1.0 },
                { t: 0.42, x: -24, y: 0, z: 95, rx: 13, ry: -7, rz: -13, scale: 1.0 },
                { t: 0.62, x: -13, y: 0, z: 48, rx: 7, ry: -4, rz: -7, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
          case 12: // Spear - long thrust
            this._animData = {
              duration: 500,
              frames: [
                { t: 0.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 },
                { t: 0.2, x: 13, y: 0, z: -48, rx: -7, ry: 0, rz: -7, scale: 1.0 },
                { t: 0.5, x: -13, y: 13, z: 105, rx: 13, ry: 0, rz: 7, scale: 1.0 },
                { t: 0.65, x: -7, y: 7, z: 68, rx: 7, ry: 0, rz: 3, scale: 1.0 },
                { t: 1.0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1.0 }
              ]
            };
            return;
        }
      }

      if (kf) {
        this._animData = kf[name] || kf['Swing'] || null;
      } else {
        this._pendingAnimation = name;
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

      if (this._mixer) this._mixer.update(deltaMs / 1000);

      if (this._animData) {
        this._idleTime = 0;
        this._applyKeyframe(deltaMs);
      } else if (!this._clipPlaying) {
        // First-person idle animation, tuned per weapon type
        this._idleTime = (this._idleTime || 0) + deltaMs;
        const freq = this._idleTime * 0.0025;
        const _wtId = this._weapon ? (this._weapon.wtypeId || 1) : 1;
        const _isGun = _wtId === 9;
        const _isHeavy = _wtId === 3 || _wtId === 4;
        const _isMagic = _wtId === 6;
        const _isSpear = _wtId === 12;

        let dx, dy, drz, drx;
        if (_isGun) {
          // FPS breathing: tight, minimal sway
          dx = Math.cos(freq * 0.4) * 2.2;
          dy = Math.sin(freq * 0.8) * 3.0;
          drz = Math.sin(freq * 0.4) * 0.009;
          drx = Math.cos(freq * 0.8) * 0.007;
        } else if (_isHeavy) {
          // Heavy weapons hang and sway more
          dx = Math.cos(freq * 0.35) * 5.5;
          dy = Math.sin(freq * 0.7) * 6.5 + Math.sin(freq * 0.3) * 1.5;
          drz = Math.sin(freq * 0.35) * 0.024;
          drx = Math.cos(freq * 0.7) * 0.016;
        } else if (_isMagic) {
          // Staff/magic: floating, double-oscillation drift
          dx = Math.cos(freq * 0.55) * 5.0 + Math.sin(freq * 1.1) * 1.8;
          dy = Math.sin(freq * 0.45) * 7.5 + Math.cos(freq * 1.3) * 2.2;
          drz = Math.sin(freq * 0.55) * 0.022;
          drx = Math.cos(freq * 0.45) * 0.016;
        } else if (_isSpear) {
          // Spear: long weapon, slight vertical drift
          dx = Math.cos(freq * 0.5) * 3.0;
          dy = Math.sin(freq * 0.9) * 5.0;
          drz = Math.sin(freq * 0.5) * 0.014;
          drx = Math.cos(freq * 0.9) * 0.010;
        } else {
          // Default melee: natural breathing figure-eight
          dx = Math.cos(freq * 0.5) * 4.2;
          dy = Math.sin(freq) * 5.8;
          drz = Math.sin(freq * 0.5) * 0.019;
          drx = Math.cos(freq) * 0.013;
        }

        this._model.position.set(
          this._worldX(this._screenX) + this._anchorOffsetX() + dx,
          this._worldY(this._screenY) + this._anchorOffsetY() + dy,
          0
        );

        const r = this._baseRotation;
        this._model.rotation.set(
          THREE.MathUtils.degToRad(r.x) + drx,
          THREE.MathUtils.degToRad(r.y),
          THREE.MathUtils.degToRad(r.z) + drz
        );

        const baseScale = this._baseScale();
        this._model.scale.set(baseScale, baseScale, baseScale);
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
