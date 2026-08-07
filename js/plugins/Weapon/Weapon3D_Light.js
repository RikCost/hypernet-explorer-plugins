//=============================================================================
// Weapon 3D Models - Light (knives, daggers, punch weapons)
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Procedural 3D models for light (knives, daggers, punch weapons). Loaded
 * automatically by WeaponSystemProcedural.js.
 * @author AntiGravity
 *
 * @help
 * ============================================================================
 * Weapon 3D Models - Light (knives, daggers, punch weapons)
 * ============================================================================
 *
 * One family per weapon type. This one owns every Light weapon (wtypeId 1):
 * the generic silhouette the type falls back to, the note-tagged one-offs of
 * that type, and every bespoke per-weapon model in it (30 so far).
 *
 * NOT listed in plugins.js. WeaponSystemProcedural.js injects this file at
 * runtime from its WEAPON3D_FAMILIES list, the same way 3DBattlerSystem.js
 * loads its 3DBattler_* families. Adding a model means adding a builder here
 * and, for a bespoke one, its database id to the unique map below.
 *
 * Every builder takes (weapon, rand) where rand is a seeded RNG derived from
 * the world's history seed, and returns a THREE.Group whose grip sits below
 * the origin with the weapon running along +Y. Shared construction helpers
 * (_plate, _bladeOutline, _hilt, _crossguard, _rivets, seg, wantsTrim, the
 * colour palettes and the material shorthands) live on WeaponSystemProcedural
 * itself, so they are available as `this` inside a builder.
 * ============================================================================
 */

(() => {
  'use strict';
  if (!window.WeaponSystemProcedural) {
    console.error('[Weapon3D_Light] WeaponSystemProcedural not loaded');
    return;
  }

  window.WeaponSystemProcedural.registerFamily({
    name: 'Weapon3D_Light',
    unique: {
      2: 'createUnbalancedThrowingKnifeModel',    // Unbalanced Throwing Knife
      3: 'createBargainKnifeModel',               // Bargain Knife
      4: 'createBrokenBottleModel',               // Broken Bottle
      5: 'createRulerShivModel',                  // Ruler Shiv
      6: 'createKitchenKnifeModel',               // Kitchen Knife
      7: 'createCombatScissorsModel',             // Combat Scissors
      8: 'createKitchenCleaverModel',             // Kitchen Cleaver
      9: 'createBoneDaggerModel',                 // Bone Dagger
      10: 'createWoodenStakeModel',                // Wooden Stake
      11: 'createPlainKnifeModel',                 // Knife
      12: 'createSeedDaggerModel',                 // Seed Dagger
      13: 'createWoodenNunchakuModel',             // Wooden Nunchaku
      14: 'createNavalDirkModel',                  // Naval Dirk
      15: 'createCrookedDaggarModel',              // Daggar
      16: 'createKatarModel',                      // Katar
      17: 'createCombatKnifeModel',                // Combat Knife
      18: 'createKukriModel',                      // Kukri
      19: 'createMacheteModel',                    // Machete
      20: 'createTwinSaiModel',                    // Twin Sai
      21: 'createMithrilDaggarModel',              // Mithril Daggar
      22: 'createKnifeHandModel',                  // Knife Hand
      23: 'createSplittingShurikenModel',          // Splitting Shuriken
      24: 'createLuminousKukrisModel',             // Luminous Kukris
      25: 'createDragonDaggarModel',               // Dragon Daggar
      26: 'createMemoryThiefModel',                // Memory Thief
      27: 'createKnowledgeSeekerModel',            // Knowledge Seeker
      28: 'createPsychicCrownModel',               // Psychic Crown
      29: 'createFleshDissolverModel',             // EHI Flesh Dissolver
      30: 'createVarleniaTwinbladesModel',         // Varlenia Twinblades
      31: 'createTimeflowManipulatorModel',        // Timeflow Manipulator
    },
    models: {
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

      // ---- 2: Unbalanced Throwing Knife -------------------------------------
      // Everything about it is lopsided: the blade sits off the tang's axis and a
      // lump of lead near the point is what makes it throw badly.
      createUnbalancedThrowingKnifeModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(this.getRandomColor(rand, [0x9AA0A6, 0x8C8378, 0xA8ADB3]), 0.34);
        const cord = this._wood(this.getRandomColor(rand, [0x3A2A1C, 0x232323, 0x4A3524]));
        const lead = this._cast(0x5B5B66);

        this._hilt(group, rand, { height: 0.10, rTop: 0.012, rBot: 0.010, mat: cord, wrapMat: cord, sides: 6 });

        const blade = this._plate(this._bladeOutline(0.26, 0.048, 0.06, 5, 0.55), 0.008, steel);
        blade.position.x = 0.008;          // off the tang's centreline
        blade.rotation.z = -0.05;
        group.add(blade);

        const lump = new THREE.Mesh(new THREE.SphereGeometry(0.018, this.seg(7, 5), this.seg(5, 4)), lead);
        lump.scale.set(1, 1.5, 0.5);
        lump.position.set(0.026, 0.18, 0);
        group.add(lump);

        const collar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.014), lead);
        group.add(collar);
        return group;
      },

      // ---- 3: Bargain Knife --------------------------------------------------
      createBargainKnifeModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xB6BBC0, 0.45);
        const plastic = this._mat(this.getRandomColor(rand, [0xC81E1E, 0x1E5AC8, 0x1F1F22, 0xE0B400]), { roughness: 0.55, metalness: 0.05 });
        const sticker = this._mat(0xF5E14A, { roughness: 0.8, metalness: 0 });

        const blade = this._plate(this._bladeOutline(0.2, 0.04, 0, 4, 0.35), 0.005, steel);
        group.add(blade);

        for (const s of [-1, 1]) {
          const scale = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.11, 0.008), plastic);
          scale.position.set(0, -0.058, s * 0.008);
          group.add(scale);
        }
        this._rivets(group, steel, 2, -0.03, -0.05, 0.004, 0.013);

        // The price sticker nobody ever peeled off.
        const tag = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.001), sticker);
        tag.position.set(0.002, 0.07, 0.004);
        group.add(tag);
        return group;
      },

      // ---- 4: Broken Bottle --------------------------------------------------
      createBrokenBottleModel(weapon, rand) {
        const group = new THREE.Group();
        const glassColor = this.getRandomColor(rand, [0x2E6B3A, 0x6B4A22, 0x2A4C6B, 0x1E1E22]);
        const glass = this._mat(glassColor, { roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.78 });
        const label = this._mat(0xE8DFC0, { roughness: 0.85, metalness: 0 });

        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.026, 0.09, this.seg(9, 6)), glass);
        neck.position.y = -0.055;
        group.add(neck);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.005, this.seg(5, 4), this.seg(9, 6)), glass);
        lip.rotation.x = Math.PI / 2;
        lip.position.y = -0.102;
        group.add(lip);

        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.03, 0.1, this.seg(9, 6)), glass);
        body.position.y = 0.04;
        group.add(body);

        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.038, this.seg(9, 6)), label);
        band.position.y = 0.03;
        group.add(band);

        // Jagged break around the rim.
        const shards = this.seg(7, 5);
        for (let i = 0; i < shards; i++) {
          const a = (i / shards) * Math.PI * 2;
          const len = 0.02 + rand() * 0.038;
          const shard = new THREE.Mesh(new THREE.ConeGeometry(0.012, len, 3), glass);
          shard.position.set(Math.cos(a) * 0.031, 0.09 + len / 2, Math.sin(a) * 0.031);
          shard.rotation.set((rand() - 0.5) * 0.5, a, (rand() - 0.5) * 0.5);
          group.add(shard);
        }
        return group;
      },

      // ---- 5: Ruler Shiv -----------------------------------------------------
      createRulerShivModel(weapon, rand) {
        const group = new THREE.Group();
        const styrene = this._mat(this.getRandomColor(rand, [0xE3C64A, 0xD8D8D8, 0x7FC4E8]), { roughness: 0.45, metalness: 0.05 });
        const ink = this._mat(0x1A1A1A, { roughness: 0.9, metalness: 0 });
        const tape = this._wood(0x3A3A3A);

        // Ground to a point at one end, still a ruler everywhere else.
        const body = this._plate([
          [-0.017, -0.06], [0.017, -0.06], [0.017, 0.2], [0.0, 0.27], [-0.017, 0.2]
        ], 0.005, styrene);
        group.add(body);

        // Graduation marks.
        if (this.wantsTrim()) {
          for (let i = 0; i < 8; i++) {
            const tick = new THREE.Mesh(new THREE.BoxGeometry(i % 2 ? 0.006 : 0.011, 0.0015, 0.001), ink);
            tick.position.set(0.011 - (i % 2 ? 0 : 0.0025), -0.03 + i * 0.028, 0.003);
            group.add(tick);
          }
        }

        for (let i = 0; i < 3; i++) {
          const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.014), tape);
          wrap.position.y = -0.05 + i * 0.019;
          wrap.rotation.z = (rand() - 0.5) * 0.12;
          group.add(wrap);
        }
        return group;
      },

      // ---- 6: Kitchen Knife --------------------------------------------------
      createKitchenKnifeModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xD3D8DC, 0.18);
        const scale = this._wood(this.getRandomColor(rand, [0x2B2B2E, 0x5C3A22, 0x7A5230]));
        const brass = this._cast(0xC9A227);

        // Straight spine, bellied edge: a chef's profile.
        const blade = this._plate([
          [-0.026, 0.0], [-0.026, 0.30], [0.004, 0.33],
          [0.020, 0.26], [0.026, 0.14], [0.024, 0.0]
        ], 0.004, steel);
        group.add(blade);

        const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.03, 0.020), steel);
        bolster.position.y = -0.012;
        group.add(bolster);

        for (const s of [-1, 1]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.115, 0.008), scale);
          cheek.position.set(0, -0.085, s * 0.007);
          group.add(cheek);
        }
        this._rivets(group, brass, 3, -0.045, -0.03, 0.0045, 0.012);
        return group;
      },

      // ---- 7: Combat Scissors ------------------------------------------------
      // Two blades on a pivot: the upper one is left out of the static merge so it
      // can snip open and shut.
      createCombatScissorsModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xC2C7CC, 0.2);
        const grip = this._mat(this.getRandomColor(rand, [0x1B1B1F, 0xB4231F, 0x1F4FA0]), { roughness: 0.6, metalness: 0.05 });

        const bladeShape = [[-0.011, 0.0], [0.011, 0.0], [0.006, 0.22], [-0.006, 0.2]];

        const lower = this._plate(bladeShape, 0.004, steel);
        lower.rotation.z = 0.07;
        group.add(lower);

        const upperPivot = new THREE.Group();
        upperPivot.userData.sway = { axis: 'z', amp: 0.06, freq: 2.2 };
        const upper = this._plate(bladeShape, 0.004, steel);
        upper.position.z = 0.006;
        upper.rotation.z = -0.07;
        upperPivot.add(upper);
        group.add(upperPivot);

        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.016, this.seg(8, 5)), steel);
        screw.rotation.x = Math.PI / 2;
        group.add(screw);

        for (const s of [-1, 1]) {
          const loop = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, this.seg(5, 4), this.seg(10, 6)), grip);
          loop.position.set(s * 0.022, -0.078, s * 0.004);
          loop.rotation.set(0, 0.25 * s, s * 0.3);
          group.add(loop);
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, this.seg(6, 4)), steel);
          arm.position.set(s * 0.011, -0.03, s * 0.004);
          arm.rotation.z = s * 0.32;
          group.add(arm);
        }
        return group;
      },

      // ---- 8: Kitchen Cleaver ------------------------------------------------
      createKitchenCleaverModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xBFC4C9, 0.3);
        const handle = this._wood(this.getRandomColor(rand, [0x6B4423, 0x2E2E30, 0x8B5A2B]));
        const brass = this._cast(0xC9A227);

        const blade = this._plate([
          [-0.055, 0.02], [-0.055, 0.19], [0.052, 0.185], [0.058, 0.03], [0.05, 0.01], [-0.05, 0.005]
        ], 0.006, steel);
        group.add(blade);

        // Hanging hole, punched near the spine.
        const hole = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.003, this.seg(5, 4), this.seg(10, 6)), steel);
        hole.position.set(-0.036, 0.163, 0);
        group.add(hole);

        const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.024), brass);
        bolster.position.y = -0.006;
        group.add(bolster);

        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.12, this.seg(8, 5)), handle);
        grip.position.y = -0.078;
        grip.scale.z = 0.75;
        group.add(grip);
        this._rivets(group, brass, 2, -0.05, -0.05, 0.005, 0.013);
        return group;
      },

      // ---- 9: Bone Dagger ----------------------------------------------------
      createBoneDaggerModel(weapon, rand) {
        const group = new THREE.Group();
        const bone = this._mat(this.getRandomColor(rand, [0xE3DAC2, 0xD2C6A5, 0xC4BBA6]), { roughness: 0.75, metalness: 0.02 });
        const sinew = this._wood(0x8A6A46);

        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.13, this.seg(7, 5)), bone);
        shaft.position.y = -0.065;
        group.add(shaft);

        // Knuckle ends, the giveaway that this used to be a limb.
        for (const y of [-0.132, -0.118]) {
          const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.019, this.seg(7, 5), this.seg(5, 4)), bone);
          knuckle.position.set((rand() - 0.5) * 0.012, y, (rand() - 0.5) * 0.01);
          group.add(knuckle);
        }

        const blade = this._plate(this._bladeOutline(0.24, 0.05, -0.05, 5, 0.7, { belly: 0.18 }), 0.009, bone);
        group.add(blade);

        // Serrations filed into the back edge.
        if (this.wantsTrim()) {
          for (let i = 0; i < 5; i++) {
            const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.014, 3), bone);
            tooth.position.set(-0.022 + i * 0.002, 0.05 + i * 0.032, 0);
            tooth.rotation.z = Math.PI / 2 + 0.4;
            group.add(tooth);
          }
        }

        for (let i = 0; i < 3; i++) {
          const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, this.seg(4, 3), this.seg(8, 5)), sinew);
          wrap.rotation.x = Math.PI / 2 + (rand() - 0.5) * 0.2;
          wrap.position.y = -0.03 - i * 0.03;
          group.add(wrap);
        }
        return group;
      },

      // ---- 10: Wooden Stake --------------------------------------------------
      createWoodenStakeModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(this.getRandomColor(rand, [0x8B5A2B, 0x6E4A2A, 0xA0703C]));
        const bark = this._wood(0x4A3520);

        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.22, 5), wood);
        shaft.position.y = -0.02;
        group.add(shaft);

        const point = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.14, 5), wood);
        point.position.y = 0.16;
        group.add(point);

        // Whittling facets: shaved flats down the point.
        if (this.wantsTrim()) {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.3;
            const facet = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.004), wood);
            facet.position.set(Math.cos(a) * 0.013, 0.14 + (i % 2) * 0.02, Math.sin(a) * 0.013);
            facet.rotation.set(0, -a, (rand() - 0.5) * 0.25);
            group.add(facet);
          }
        }

        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.016, 5), bark);
        ring.position.y = -0.1;
        group.add(ring);
        return group;
      },

      // ---- 11: Knife ---------------------------------------------------------
      createPlainKnifeModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xC8CDD2, 0.22);
        const grip = this._wood(this.getRandomColor(rand, [0x4A3524, 0x2B2B2E, 0x6B4A2A]));

        const blade = this._plate(this._bladeOutline(0.21, 0.038, 0, 5, 0.45), 0.005, steel);
        group.add(blade);
        // Ground false edge along the spine.
        const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.16, 0.006), steel);
        bevel.position.set(-0.011, 0.09, 0);
        group.add(bevel);

        this._crossguard(group, steel, 0.048, 0.009, 0.014, 0);
        this._hilt(group, rand, {
          height: 0.115, rTop: 0.016, rBot: 0.013, mat: grip, wrapMat: grip,
          pommelMat: steel, pommel: 'nut', offset: -0.006
        });
        return group;
      },

      // ---- 12: Seed Dagger ---------------------------------------------------
      createSeedDaggerModel(weapon, rand) {
        const group = new THREE.Group();
        const leafColor = this.getRandomColor(rand, [0x4E9A3A, 0x6BBF48, 0x3D7D33]);
        const leaf = this._mat(leafColor, { roughness: 0.55, metalness: 0.05 });
        const bark = this._wood(0x5B4227);
        const pod = this._mat(0xC8A02A, { roughness: 0.5, metalness: 0.1 });
        const sap = this._glow(0xB8FF5A, 0.6);

        const blade = this._plate(this._bladeOutline(0.25, 0.055, 0, 6, 1, { belly: 0.3, taperPow: 3.0 }), 0.007, leaf);
        group.add(blade);
        const midrib = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.2, 0.011), sap);
        midrib.position.y = 0.1;
        midrib.userData.pulse = { min: 0.25, max: 0.9, freq: 1.1 };
        group.add(midrib);

        this._hilt(group, rand, { height: 0.13, rTop: 0.015, rBot: 0.013, mat: bark, sides: 6 });

        // Vine spiralling the grip.
        for (let i = 0; i < 4; i++) {
          const coil = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.003, this.seg(4, 3), this.seg(8, 5)), leaf);
          coil.position.y = -0.02 - i * 0.028;
          coil.rotation.set(Math.PI / 2 + 0.22, 0, i * 0.5);
          group.add(coil);
        }

        const seed = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(8, 5), this.seg(6, 4)), pod);
        seed.scale.y = 1.3;
        seed.position.y = -0.145;
        group.add(seed);

        // A shoot that has not worked out where it is yet.
        const shoot = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, this.seg(5, 4)), leaf);
        shoot.position.set(0.024, 0.01, 0);
        shoot.rotation.z = -0.8;
        shoot.userData.sway = { axis: 'z', amp: 0.18, freq: 1.4 };
        group.add(shoot);
        return group;
      },

      // ---- 13: Wooden Nunchaku ----------------------------------------------
      // Keeps the physics chain of the generic nunchaku and dresses it as the
      // battered training pair it is: rope instead of steel, tape, burn rings.
      createWoodenNunchakuModel(weapon, rand) {
        const group = this.createNunchakuModel(weapon, rand);
        const rope = this._wood(0x9A7B4F);
        const tape = this._wood(0x2A2A2A);
        const wood = this._wood(this.getRandomColor(rand, [0x7A5230, 0x5C3317, 0x8B5A2B]));

        // Re-skin the chain links as knotted cord.
        const chain = group.userData._verletRope;
        if (chain) for (const link of chain.segmentMeshes) link.material = rope;

        for (const x of [-0.024, 0.024]) {
          for (let i = 0; i < 2; i++) {
            const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.0135, 0.003, this.seg(4, 3), this.seg(8, 5)), tape);
            wrap.rotation.x = Math.PI / 2;
            wrap.position.set(x, -0.055 - i * 0.05, 0);
            if (x > 0) { wrap.position.y += 0.07; }
            group.add(wrap);
          }
          const burn = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, this.seg(8, 5)), wood);
          burn.position.set(x, x > 0 ? -0.04 : -0.11, 0);
          group.add(burn);
        }
        return group;
      },

      // ---- 14: Naval Dirk ----------------------------------------------------
      createNavalDirkModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xD6DBE0, 0.16);
        const brass = this._cast(0xC9A227);
        const grip = this._wood(0x1E1E22);

        const blade = this._plate(this._bladeOutline(0.28, 0.036, 0, 5, 1, { taperPow: 1.6 }), 0.008, steel);
        group.add(blade);
        // Fullers either side of the central ridge.
        for (const s of [-1, 1]) {
          const flute = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.2, 0.011), steel);
          flute.position.set(s * 0.009, 0.1, 0);
          group.add(flute);
        }

        const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.016, this.seg(9, 6)), brass);
        group.add(ferrule);
        this._hilt(group, rand, { height: 0.12, rTop: 0.017, rBot: 0.015, mat: grip, wrapMat: brass, offset: -0.008 });

        // Anchor pommel.
        const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, this.seg(6, 4)), brass);
        shank.position.y = -0.142;
        group.add(shank);
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.005, 0.005), brass);
        stock.position.y = -0.134;
        group.add(stock);
        const fluke = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, this.seg(4, 3), this.seg(9, 6), Math.PI), brass);
        fluke.position.y = -0.157;
        fluke.rotation.z = Math.PI;
        group.add(fluke);
        return group;
      },

      // ---- 15: Daggar -------------------------------------------------------
      // Spelled wrong and built wrong: nothing on it lines up with anything else.
      createCrookedDaggarModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0x9C9C96, 0.55);
        const rust = this._mat(0x8A4B22, { roughness: 0.95, metalness: 0.25 });
        const grip = this._wood(0x584434);

        const blade = this._plate(this._bladeOutline(0.23, 0.042, 0.1, 5, 0.7), 0.006, steel);
        blade.rotation.z = 0.09;
        blade.position.x = -0.006;
        group.add(blade);

        if (this.wantsTrim()) {
          for (let i = 0; i < 3; i++) {
            const patch = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.02, 0.008), rust);
            patch.position.set((rand() - 0.5) * 0.03, 0.05 + rand() * 0.14, 0);
            patch.rotation.z = rand() * 1.2;
            group.add(patch);
          }
        }

        const guard = this._crossguard(group, steel, 0.07, 0.011, 0.016, 0);
        guard.rotation.z = 0.16;
        this._hilt(group, rand, {
          height: 0.13, rTop: 0.018, rBot: 0.016, mat: grip, wrapMat: grip,
          pommelMat: rust, pommel: 'nut', offset: -0.008
        });
        return group;
      },

      // ---- 16: Katar --------------------------------------------------------
      createKatarModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xC0C5CA, 0.22);
        const bind = this._wood(0x3A2A1C);

        // Triangular thrusting blade with a thickened spine.
        const blade = this._plate([[-0.03, 0.02], [0.03, 0.02], [0.0, 0.27]], 0.007, steel);
        group.add(blade);
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.2, 0.014), steel);
        spine.position.y = 0.1;
        group.add(spine);

        // H-frame: two side bars and the transverse grip between them.
        for (const s of [-1, 1]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.15, 0.012), steel);
          bar.position.set(s * 0.032, -0.06, 0);
          group.add(bar);
          const flare = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.026), steel);
          flare.position.set(s * 0.032, 0.008, 0);
          group.add(flare);
        }
        for (const y of [-0.05, -0.085]) {
          const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.064, this.seg(8, 5)), bind);
          rung.rotation.z = Math.PI / 2;
          rung.position.y = y;
          group.add(rung);
        }
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.01, 0.016), steel);
        cross.position.y = 0.012;
        group.add(cross);
        return group;
      },

      // ---- 17: Combat Knife --------------------------------------------------
      createCombatKnifeModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._mat(0x2B2F33, { roughness: 0.62, metalness: 0.8 }); // parkerised, non-reflective
        const edge = this._steel(0xC9CED3, 0.2);
        const grip = this._mat(0x22241F, { roughness: 0.85, metalness: 0.05 });

        // Tanto point: a straight main edge that breaks to a flat angled tip.
        const blade = this._plate([
          [-0.023, 0.0], [-0.023, 0.24], [0.006, 0.28], [0.023, 0.21], [0.023, 0.0]
        ], 0.007, steel);
        group.add(blade);
        const bevel = this._plate([[0.010, 0.0], [0.023, 0.0], [0.023, 0.2]], 0.008, edge);
        group.add(bevel);

        // Sawback teeth.
        if (this.wantsTrim()) {
          for (let i = 0; i < 6; i++) {
            const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.012, 3), steel);
            tooth.position.set(-0.028, 0.08 + i * 0.024, 0);
            tooth.rotation.z = Math.PI / 2;
            group.add(tooth);
          }
        }

        this._crossguard(group, steel, 0.055, 0.012, 0.018, 0);
        this._hilt(group, rand, { height: 0.12, rTop: 0.018, rBot: 0.017, mat: grip, wrapMat: grip, sides: 6, offset: -0.008 });

        // Skull-crusher butt with a lanyard ring.
        const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.024, this.seg(8, 5)), steel);
        butt.position.y = -0.14;
        group.add(butt);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0025, this.seg(4, 3), this.seg(9, 6)), steel);
        ring.position.y = -0.158;
        group.add(ring);
        return group;
      },

      // ---- 18: Kukri ---------------------------------------------------------
      createKukriModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xCBD0D5, 0.24);
        const horn = this._mat(this.getRandomColor(rand, [0x2A2119, 0x3E2C1C, 0x1C1C1C]), { roughness: 0.5, metalness: 0.05 });
        const brass = this._cast(0xC9A227);

        // The recurve: it drops back before it sweeps forward and broadens.
        const blade = this._plate([
          [-0.020, 0.0], [-0.026, 0.09], [-0.020, 0.19], [0.006, 0.28], [0.038, 0.30],
          [0.052, 0.245], [0.040, 0.155], [0.014, 0.07], [0.014, 0.0]
        ], 0.008, steel);
        group.add(blade);

        // Cho notch at the throat, the mark that makes it a kukri.
        const cho = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.012, 3), horn);
        cho.position.set(0.012, 0.018, 0);
        cho.rotation.z = -Math.PI / 2;
        group.add(cho);

        this._hilt(group, rand, { height: 0.13, rTop: 0.019, rBot: 0.016, mat: horn, sides: this.seg(9, 6) });
        for (let i = 0; i < 2; i++) {
          const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.009, this.seg(9, 6)), brass);
          ring.position.y = -0.045 - i * 0.05;
          group.add(ring);
        }
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.012, this.seg(9, 6)), brass);
        cap.position.y = -0.135;
        group.add(cap);
        return group;
      },

      // ---- 19: Machete -------------------------------------------------------
      createMacheteModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xA9AEB3, 0.42);
        const grip = this._mat(this.getRandomColor(rand, [0x1B1B1F, 0x1F4FA0, 0x8B1A1A]), { roughness: 0.6, metalness: 0.05 });

        // Long flat blade that broadens to a clipped, weight-forward tip.
        const blade = this._plate([
          [-0.024, 0.0], [-0.030, 0.34], [-0.012, 0.40], [0.030, 0.38], [0.026, 0.20], [0.020, 0.0]
        ], 0.005, steel);
        group.add(blade);

        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.01, 0.02), grip);
        guard.position.y = -0.004;
        group.add(guard);

        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.13, this.seg(8, 5)), grip);
        handle.position.y = -0.072;
        handle.scale.z = 0.72;
        group.add(handle);

        // Finger ridges.
        if (this.wantsTrim()) {
          for (let i = 0; i < 3; i++) {
            const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0035, this.seg(4, 3), this.seg(8, 5)), grip);
            ridge.rotation.x = Math.PI / 2;
            ridge.scale.y = 0.72;
            ridge.position.y = -0.04 - i * 0.033;
            group.add(ridge);
          }
        }

        const lanyard = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.002, this.seg(4, 3), this.seg(8, 5)), steel);
        lanyard.position.y = -0.145;
        group.add(lanyard);
        return group;
      },

      // ---- 20: Twin Sai ------------------------------------------------------
      createTwinSaiModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0x8E939A, 0.3);
        const cord = this._wood(0x1E1E22);

        const build = (xOff, tilt) => {
          const sai = new THREE.Group();
          const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.010, 0.27, this.seg(8, 5)), steel);
          prong.position.y = 0.145;
          sai.add(prong);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.04, this.seg(8, 5)), steel);
          tip.position.y = 0.30;
          sai.add(tip);
          // The two side tines that catch a blade.
          for (const s of [-1, 1]) {
            const curve = new THREE.QuadraticBezierCurve3(
              new THREE.Vector3(0, 0.01, 0),
              new THREE.Vector3(s * 0.032, 0.03, 0),
              new THREE.Vector3(s * 0.026, 0.085, 0)
            );
            const tine = new THREE.Mesh(new THREE.TubeGeometry(curve, this.seg(5, 3), 0.005, this.seg(5, 4), false), steel);
            sai.add(tine);
          }
          const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.11, this.seg(8, 5)), cord);
          grip.position.y = -0.058;
          sai.add(grip);
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.013, this.seg(7, 5), this.seg(5, 4)), steel);
          knob.position.y = -0.118;
          sai.add(knob);
          sai.position.x = xOff;
          sai.rotation.z = tilt;
          return sai;
        };

        group.add(build(-0.03, 0.13));
        const second = build(0.032, -0.16);
        second.position.z = -0.03;
        second.scale.setScalar(0.94);
        group.add(second);
        return group;
      },

      // ---- 21: Mithril Daggar ------------------------------------------------
      createMithrilDaggarModel(weapon, rand) {
        const group = new THREE.Group();
        const mithril = this._mat(0xE8F0F5, { roughness: 0.08, metalness: 0.95 });
        const vein = this._glow(this.getRandomColor(rand, [0x9FE8FF, 0xC9B6FF, 0xB6FFE0]), 0.9);
        const grip = this._mat(0xDCE4EA, { roughness: 0.3, metalness: 0.6 });

        const blade = this._plate(this._bladeOutline(0.26, 0.046, 0, 7, 1, { belly: 0.12, taperPow: 2.0 }), 0.006, mithril);
        group.add(blade);

        // Filigree veins running the length of the blade.
        for (const s of [-1, 1]) {
          const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(s * 0.008, 0.01, 0.004),
            new THREE.Vector3(s * 0.02, 0.12, 0.004),
            new THREE.Vector3(0, 0.24, 0.004)
          );
          const line = new THREE.Mesh(new THREE.TubeGeometry(curve, this.seg(6, 4), 0.0022, this.seg(4, 3), false), vein);
          line.userData.pulse = { min: 0.35, max: 1.1, freq: 0.8, phase: s };
          group.add(line);
        }

        // Swept elvish guard.
        for (const s of [-1, 1]) {
          const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(s * 0.03, 0.012, 0),
            new THREE.Vector3(s * 0.046, 0.042, 0)
          );
          const wing = new THREE.Mesh(new THREE.TubeGeometry(curve, this.seg(6, 4), 0.005, this.seg(5, 4), false), mithril);
          group.add(wing);
        }

        this._hilt(group, rand, { height: 0.12, rTop: 0.015, rBot: 0.013, mat: grip, sides: this.seg(9, 6), offset: -0.004 });

        const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.016, 0), vein);
        stone.position.y = -0.13;
        stone.userData.spin = { axis: 'y', speed: 0.9 };
        group.add(stone);
        return group;
      },

      // ---- 22: Knife Hand ----------------------------------------------------
      createKnifeHandModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xB4B9BE, 0.28);
        const leather = this._wood(this.getRandomColor(rand, [0x4A3524, 0x1F1F22]));

        // Back-of-the-hand plate.
        const plate = this._plate([
          [-0.045, -0.05], [0.045, -0.05], [0.05, 0.03], [0.0, 0.06], [-0.05, 0.03]
        ], 0.01, steel);
        group.add(plate);

        // The blade continues the line of the knuckles.
        const blade = this._plate(this._bladeOutline(0.22, 0.04, 0, 5, 0.4), 0.006, steel);
        blade.position.y = 0.045;
        group.add(blade);

        // Knuckle ridge.
        for (let i = 0; i < 4; i++) {
          const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.011, this.seg(6, 4), this.seg(5, 4)), steel);
          knuckle.position.set(-0.033 + i * 0.022, 0.042, 0.008);
          group.add(knuckle);
        }

        for (const y of [-0.012, -0.046]) {
          const strap = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.006, this.seg(4, 3), this.seg(10, 6)), leather);
          strap.rotation.x = Math.PI / 2;
          strap.scale.y = 0.6;
          strap.position.y = y;
          group.add(strap);
        }
        return group;
      },

      // ---- 23: Splitting Shuriken --------------------------------------------
      // One star with a second, counter-rotating star nested behind it: the split
      // is already loaded before it is thrown.
      createSplittingShurikenModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0x9EA3A8, 0.3);
        const dark = this._mat(0x30343A, { roughness: 0.7, metalness: 0.6 });

        const star = (points, radius, inner, mat, thickness) => {
          const pts = [];
          for (let i = 0; i < points * 2; i++) {
            const a = (i / (points * 2)) * Math.PI * 2;
            const r = i % 2 === 0 ? radius : inner;
            pts.push([Math.cos(a) * r, Math.sin(a) * r]);
          }
          return this._plate(pts, thickness, mat);
        };

        const front = star(4, 0.1, 0.026, steel, 0.004);
        group.add(front);

        const back = star(4, 0.082, 0.022, dark, 0.004);
        back.position.z = -0.006;
        back.rotation.z = Math.PI / 4;
        back.userData.spin = { axis: 'z', speed: 0.7 };
        group.add(back);

        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.016, this.seg(10, 6)), dark);
        hub.rotation.x = Math.PI / 2;
        group.add(hub);
        const eye = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.003, this.seg(4, 3), this.seg(10, 6)), steel);
        group.add(eye);
        return group;
      },

      // ---- 24: Luminous Kukris -----------------------------------------------
      createLuminousKukrisModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._mat(0x1B1E24, { roughness: 0.35, metalness: 0.8 });
        const glowColor = this.getRandomColor(rand, [0x39FFC2, 0xFF3D9A, 0x53B8FF, 0xFFC93D]);
        const glow = this._glow(glowColor, 1.0);
        const wrap = this._wood(0x141414);

        const outline = [
          [-0.018, 0.0], [-0.024, 0.08], [-0.018, 0.17], [0.005, 0.25], [0.034, 0.27],
          [0.046, 0.22], [0.035, 0.14], [0.012, 0.06], [0.012, 0.0]
        ];

        const build = (x, z, tilt, scale, phase) => {
          const k = new THREE.Group();
          const blade = this._plate(outline, 0.007, dark);
          k.add(blade);
          const edge = this._plate([
            [0.012, 0.0], [0.035, 0.14], [0.046, 0.22], [0.034, 0.27], [0.026, 0.25], [0.006, 0.07]
          ], 0.009, glow);
          edge.userData.pulse = { min: 0.5, max: 1.4, freq: 1.3, phase: phase };
          k.add(edge);
          const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.11, this.seg(8, 5)), wrap);
          grip.position.y = -0.056;
          k.add(grip);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.016, 0.012, this.seg(8, 5)), glow);
          cap.position.y = -0.116;
          k.add(cap);
          k.position.set(x, 0, z);
          k.rotation.z = tilt;
          k.scale.setScalar(scale);
          return k;
        };

        group.add(build(-0.022, 0.0, 0.16, 1.0, 0));
        group.add(build(0.03, -0.03, -0.22, 0.9, 1.6));
        return group;
      },

      // ---- 25: Dragon Daggar -------------------------------------------------
      createDragonDaggarModel(weapon, rand) {
        const group = new THREE.Group();
        const scaleColor = this.getRandomColor(rand, [0x2E7D4F, 0x8B1A1A, 0x2B3D8B, 0x4A2B6B]);
        const hide = this._mat(scaleColor, { roughness: 0.4, metalness: 0.5 });
        const steel = this._steel(0xD8C07A, 0.2);
        const ember = this._glow(0xFF6A1A, 0.9);

        const blade = this._plate(this._bladeOutline(0.26, 0.05, 0.04, 6, 0.6, { belly: 0.15 }), 0.007, steel);
        group.add(blade);

        // Scale plates running up the spine.
        for (let i = 0; i < 5; i++) {
          const scale = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.02, 3), hide);
          scale.position.set(-0.014 + i * 0.004, 0.04 + i * 0.038, 0.006);
          scale.rotation.x = -Math.PI / 2;
          scale.rotation.z = 0.2;
          group.add(scale);
        }

        // Dragon-head guard: the blade comes out of its mouth.
        const skull = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 0.03), hide);
        skull.position.y = -0.006;
        group.add(skull);
        const snout = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.036, this.seg(6, 4)), hide);
        snout.position.set(0.03, -0.004, 0);
        snout.rotation.z = -Math.PI / 2;
        group.add(snout);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(6, 4), this.seg(4, 3)), ember);
          eye.position.set(0.012, 0.005, s * 0.016);
          eye.userData.pulse = { min: 0.4, max: 1.3, freq: 2.4, phase: s };
          group.add(eye);
          const horn = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.03, this.seg(5, 4)), steel);
          horn.position.set(-0.016, 0.012, s * 0.012);
          horn.rotation.z = 0.9 * s * 0 + 0.5;
          group.add(horn);
        }

        this._hilt(group, rand, { height: 0.12, rTop: 0.016, rBot: 0.014, mat: hide, wrapMat: steel, offset: -0.018 });

        // Coiled tail pommel.
        const tail = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.006, this.seg(5, 4), this.seg(12, 7), Math.PI * 1.6), hide);
        tail.position.y = -0.15;
        tail.rotation.y = Math.PI / 2;
        group.add(tail);
        return group;
      },

      // ---- 26: Memory Thief --------------------------------------------------
      // A hilt with no blade in it: the edge is a column of stolen memories, still
      // drifting, that only line up when it is swung.
      createMemoryThiefModel(weapon, rand) {
        const group = new THREE.Group();
        const voidMat = this._mat(0x14121C, { roughness: 0.3, metalness: 0.7 });
        const shardColor = this.getRandomColor(rand, [0x8FA8FF, 0xC79BFF, 0x9BFFE4]);
        const shard = this._glow(shardColor, 0.85);
        const core = this._glow(0xFFFFFF, 1.2);

        this._hilt(group, rand, { height: 0.14, rTop: 0.017, rBot: 0.014, mat: voidMat, sides: this.seg(9, 6) });

        const socket = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, this.seg(5, 4), this.seg(12, 7)), voidMat);
        socket.rotation.x = Math.PI / 2;
        group.add(socket);

        const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.014, 0), core);
        heart.position.y = 0.012;
        heart.userData.spin = { axis: 'y', speed: 1.6 };
        heart.userData.pulse = { min: 0.5, max: 1.6, freq: 1.8 };
        group.add(heart);

        // The shards stack where a blade would be, each one turning at its own rate.
        const count = this.isLowDetail() ? 5 : 8;
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const s = 0.017 * (1 - 0.55 * t);
          const piece = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), shard);
          piece.position.set(0, 0.05 + t * 0.21, 0);
          piece.scale.set(1, 1.7, 0.35);
          piece.userData.spin = { axis: 'y', speed: 0.5 + t * 1.1 };
          piece.userData.orbit = { radius: 0.006 + t * 0.008, speed: 0.9 + t, phase: i * 1.1, plane: 'xz' };
          piece.userData.pulse = { min: 0.3, max: 1.0, freq: 1.2, phase: i };
          group.add(piece);
        }
        return group;
      },

      // ---- 27: Knowledge Seeker ----------------------------------------------
      createKnowledgeSeekerModel(weapon, rand) {
        const group = new THREE.Group();
        const brass = this._cast(0xC9A227);
        const stone = this._mat(0x6C6F76, { roughness: 0.8, metalness: 0.1 });
        const scriptColor = this.getRandomColor(rand, [0x66E0FF, 0xFFD766, 0xB988FF]);
        const script = this._glow(scriptColor, 0.8);
        const leather = this._wood(0x54301C);

        this._hilt(group, rand, { height: 0.13, rTop: 0.016, rBot: 0.014, mat: leather, wrapMat: brass });

        // Open-book guard.
        for (const s of [-1, 1]) {
          const page = this._plate([[0, 0], [s * 0.042, 0.016], [s * 0.042, 0.03], [0, 0.014]], 0.018, stone);
          group.add(page);
        }

        // The blade is a stack of rune tablets, narrowing as it climbs.
        const tablets = this.isLowDetail() ? 4 : 6;
        for (let i = 0; i < tablets; i++) {
          const t = i / (tablets - 1);
          const w = 0.05 * (1 - 0.6 * t);
          const tablet = new THREE.Mesh(new THREE.BoxGeometry(w, 0.036, 0.009), stone);
          // 0.034 apart, not 0.042: a stack whose stones are further apart than
          // they are thick is not a stack, it is six tablets hanging in a line.
          tablet.position.y = 0.05 + i * 0.034;
          tablet.rotation.y = (rand() - 0.5) * 0.25;
          group.add(tablet);
          const rune = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.004, 0.012), script);
          rune.position.y = 0.05 + i * 0.034;
          rune.rotation.y = tablet.rotation.y;
          rune.userData.pulse = { min: 0.2, max: 1.1, freq: 0.9, phase: i * 0.8 };
          group.add(rune);
        }
        const capstone = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 4), brass);
        capstone.position.y = 0.05 + tablets * 0.042;
        group.add(capstone);
        return group;
      },

      // ---- 28: Psychic Crown -------------------------------------------------
      // The crown of the generic <Crown> weapons, with the thing it is actually
      // for: a wearer's thoughts, circling outside their skull.
      createPsychicCrownModel(weapon, rand) {
        const group = this.createCrownModel(weapon, rand);
        const psiColor = this.getRandomColor(rand, [0xB86BFF, 0x6BD9FF, 0xFF6BB8]);
        const psi = this._glow(psiColor, 1.0);
        const bone = this._mat(0xE0D6C2, { roughness: 0.7, metalness: 0.05 });

        const brain = new THREE.Mesh(new THREE.SphereGeometry(0.03, this.seg(9, 6), this.seg(7, 5)), bone);
        brain.position.y = 0.12;
        brain.scale.set(1, 0.82, 1.1);
        brain.userData.bob = { axis: 'y', amp: 0.008, freq: 1.1 };
        brain.userData.spin = { axis: 'y', speed: 0.35 };
        group.add(brain);

        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, this.seg(4, 3), this.seg(14, 8)), psi);
        halo.position.y = 0.12;
        halo.rotation.x = Math.PI / 2.4;
        halo.userData.spin = { axis: 'y', speed: -0.8 };
        halo.userData.pulse = { min: 0.4, max: 1.2, freq: 1.5 };
        group.add(halo);

        for (let i = 0; i < 3; i++) {
          const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.009, 0), psi);
          mote.position.y = 0.09 + i * 0.02;
          mote.userData.orbit = { radius: 0.062 - i * 0.008, speed: 1.1 + i * 0.4, phase: i * 2.1, plane: 'xz' };
          mote.userData.pulse = { min: 0.3, max: 1.3, freq: 2.0, phase: i };
          group.add(mote);
        }
        return group;
      },

      // ---- 29: EHI Flesh Dissolver -------------------------------------------
      createFleshDissolverModel(weapon, rand) {
        const group = new THREE.Group();
        const chassis = this._mat(0x3A3F45, { roughness: 0.45, metalness: 0.8 });
        const needleMat = this._steel(0xDDE2E7, 0.1);
        const acidColor = this.getRandomColor(rand, [0x7CFF3D, 0xC8FF1A, 0x3DFFB0]);
        const acid = this._glow(acidColor, 0.9);
        const glass = this._mat(0xBFD8E0, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55 });
        const hose = this._mat(0x1A1A1D, { roughness: 0.85, metalness: 0.05 });

        // Hollow injector "blade".
        const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.24, this.seg(8, 5)), needleMat);
        needle.position.y = 0.13;
        group.add(needle);
        const bevelTip = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.035, this.seg(7, 5)), needleMat);
        bevelTip.position.y = 0.263;
        bevelTip.rotation.z = 0.2;
        group.add(bevelTip);
        // Delivery ports along the shaft.
        for (let i = 0; i < 3; i++) {
          const port = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.016, this.seg(6, 4)), acid);
          port.rotation.z = Math.PI / 2;
          port.position.y = 0.08 + i * 0.055;
          port.userData.pulse = { min: 0.3, max: 1.2, freq: 2.6, phase: i * 0.9 };
          group.add(port);
        }

        const block = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.032), chassis);
        group.add(block);

        // Reservoir with its dose still in it.
        const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, this.seg(9, 6)), glass);
        vial.position.set(-0.032, -0.03, 0);
        vial.rotation.z = 0.16;
        group.add(vial);
        const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, this.seg(9, 6)), acid);
        fluid.position.set(-0.034, -0.042, 0);
        fluid.rotation.z = 0.16;
        fluid.userData.pulse = { min: 0.5, max: 1.0, freq: 0.7 };
        group.add(fluid);

        const feed = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, this.seg(4, 3), this.seg(10, 6), Math.PI), hose);
        feed.position.set(-0.018, -0.006, 0.012);
        feed.rotation.set(0, 0, -0.6);
        group.add(feed);

        this._hilt(group, rand, { height: 0.12, rTop: 0.016, rBot: 0.015, mat: hose, wrapMat: hose, offset: -0.016 });
        const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.026, 0.01), chassis);
        trigger.position.set(0.018, -0.04, 0);
        trigger.rotation.z = -0.3;
        group.add(trigger);
        return group;
      },

      // ---- 30: Varlenia Twinblades -------------------------------------------
      createVarleniaTwinbladesModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(0xCED3D8, 0.18);
        const inlayColor = this.getRandomColor(rand, [0x4FC3F7, 0xE57373, 0xBA68C8]);
        const inlay = this._glow(inlayColor, 0.75);
        const grip = this._wood(0x2A2118);

        // Two blades splayed from one grip, like open shears held point-up.
        for (const s of [-1, 1]) {
          const blade = this._plate(this._bladeOutline(0.24, 0.036, 0, 5, 0.5), 0.006, steel);
          blade.position.set(s * 0.014, 0.02, s * 0.006);
          blade.rotation.z = -s * 0.17;
          group.add(blade);
        }

        // The bar that holds the pair apart, and glows between them.
        const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.012, 0.024), steel);
        group.add(yoke);
        const spark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.006), inlay);
        spark.position.y = 0.008;
        spark.userData.pulse = { min: 0.3, max: 1.2, freq: 1.6 };
        group.add(spark);

        this._hilt(group, rand, {
          height: 0.13, rTop: 0.017, rBot: 0.015, mat: grip, wrapMat: grip,
          pommelMat: inlay, pommel: 'disc', offset: -0.008
        });
        return group;
      },

      // ---- 31: Timeflow Manipulator ------------------------------------------
      // The arm cannon chassis with a clock movement bolted where the magazine
      // should be. The gears actually turn, at odds with each other.
      createTimeflowManipulatorModel(weapon, rand) {
        const group = this.createArmCannonModel(weapon, rand);
        const brass = this._cast(0xC9A227);
        const face = this._mat(0xEFE6D0, { roughness: 0.6, metalness: 0.1 });
        const glowColor = this.getRandomColor(rand, [0x7FE0FF, 0xFFD37F, 0xC69BFF]);
        const glow = this._glow(glowColor, 0.9);

        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.008, this.seg(14, 8)), face);
        dial.rotation.x = Math.PI / 2;
        dial.position.set(0, 0.05, 0.05);
        group.add(dial);
        const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.005, this.seg(5, 4), this.seg(14, 8)), brass);
        bezel.position.set(0, 0.05, 0.05);
        group.add(bezel);

        const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.018, 0.002), brass);
        hourHand.position.set(0, 0.059, 0.056);
        hourHand.userData.spin = { axis: 'z', speed: -0.25 };
        group.add(hourHand);
        const minuteHand = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.026, 0.002), glow);
        minuteHand.position.set(0, 0.063, 0.058);
        minuteHand.userData.spin = { axis: 'z', speed: 1.4 };
        minuteHand.userData.pulse = { min: 0.4, max: 1.2, freq: 2.0 };
        group.add(minuteHand);

        // Escapement gears on the flank, counter-rotating.
        const teeth = this.isLowDetail() ? 8 : 12;
        for (let g = 0; g < 2; g++) {
          const gear = new THREE.Group();
          const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.006, this.seg(10, 6)), brass);
          hub.rotation.x = Math.PI / 2;
          gear.add(hub);
          for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * Math.PI * 2;
            const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.007, 0.006), brass);
            tooth.position.set(Math.cos(a) * 0.021, Math.sin(a) * 0.021, 0);
            tooth.rotation.z = a;
            gear.add(tooth);
          }
          gear.position.set(0.045, -0.005 + g * 0.045, 0.02 - g * 0.05);
          gear.userData.spin = { axis: 'z', speed: g === 0 ? 1.1 : -1.7 };
          group.add(gear);
        }

        // Pendulum swinging under the barrel.
        const pendulum = new THREE.Group();
        pendulum.position.set(0, -0.02, 0.08);
        pendulum.userData.sway = { axis: 'z', amp: 0.45, freq: 1.6 };
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, this.seg(6, 4)), brass);
        rod.position.y = -0.035;
        pendulum.add(rod);
        const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.005, this.seg(10, 6)), glow);
        bob.rotation.x = Math.PI / 2;
        bob.position.y = -0.072;
        pendulum.add(bob);
        group.add(pendulum);
        return group;
      }
    }
  });
})();
