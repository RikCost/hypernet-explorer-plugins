//=============================================================================
// Weapon 3D Models - Bows and crossbows
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Procedural 3D models for bows and crossbows. Loaded
 * automatically by WeaponSystemProcedural.js.
 * @author AntiGravity
 *
 * @help
 * ============================================================================
 * Weapon 3D Models - Bows and crossbows
 * ============================================================================
 *
 * One family per weapon type. This one owns every Bow weapon (wtypeId 7):
 * the generic silhouette the type falls back to, the note-tagged one-offs of
 * that type, and every bespoke per-weapon model in it.
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
    console.error('[Weapon3D_Bows] WeaponSystemProcedural not loaded');
    return;
  }

  window.WeaponSystemProcedural.registerFamily({
    name: 'Weapon3D_Bows',
    unique: {
      336: 'createToyBowModel',                      // Toy Bow
      337: 'createWarpedArrowsModel',                // Warped Arrows
      338: 'createFlimsyBowModel',                   // Flimsy Bow
      339: 'createMisalignedHandCrossbowModel',      // Misaligned Hand Crossbow
      340: 'createUnreliableCrossbowModel',          // Unreliable Crossbow
      341: 'createShowerRodBowModel',                // Shower Rod Bow
      342: 'createPVCBowModel',                      // PVC Bow
      343: 'createJunkCrossbowModel',                // Junk Crossbow
      344: 'createSeedBowModel',                     // Seed Bow
      345: 'createShortBowModel',                    // Short Bow
      346: 'createLongBowModel',                     // Long Bow
      347: 'createCompositeBowModel',                // Composite Bow
      348: 'createChuKoNuModel',                     // Chu-Ko-Nu
      349: 'createNetCrossbowModel',                 // Net Crossbow
      350: 'createCompoundBowModel',                 // Compound Bow
      351: 'createMultiBoltCrossbowModel',           // Multi-Bolt Crossbow
      352: 'createAdvancedCompoundBowModel',         // Advanced Compound Bow
      353: 'createFrostbiteBowModel',                // Frostbite Bow
      354: 'createAetherialBowModel',                // Aetherial Bow
      355: 'createInfiniteQuiverBowModel',           // Infinite Quiver Bow
      356: 'createDragonBowModel',                   // Dragon Bow
      357: 'createInfiniteQuiverModel',              // Infinite Quiver
      358: 'createArcaneCrossbowModel',              // Arcane Crossbow
      359: 'createDragonboneBowModel',               // Dragonbone Bow
      360: 'createMindArrowBowModel',                // Mind Arrow Bow
      361: 'createSpellbreakerCrossbowModel',        // Spellbreaker Crossbow
      362: 'createSoulstringBowModel',               // Soulstring Bow
      363: 'createMoonlightBowModel',                // Moonlight Bow
      364: 'createSpellseekerBowModel',              // Spellseeker Bow
      365: 'createBullTotemBowModel',                // Bull Totem Bow
      366: 'createIdentityEraserModel',              // EHI Identity Eraser
      367: 'createVarleniaEnergyBowModel',           // Varlenia Energy Bow
      368: 'createBrainHemorrhagerModel'             // EHI Brain Hemorrhager
    },
    models: {
      /**
       * A pair of bow limbs and the string between them. Bows are modelled
       * FLAT IN THE Y-Z PLANE (the battle pose turns the belly toward the
       * camera), so the limbs curve on Z and the string runs straight up Y.
       * @param opts { length, depth, recurve, rTop, rBot, segments, stringMat }
       */
      _bowLimbs(group, mat, opts) {
        const o = opts || {};
        const len = o.length || 0.3;
        const depth = o.depth === undefined ? 0.055 : o.depth;
        const recurve = o.recurve || 0;
        const n = this.seg(o.segments || 7, 4);
        const up = new THREE.Vector3(0, 1, 0);
        const tips = [];
        for (const dir of [1, -1]) {
          const pts = [];
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            // A plain bow bends one way; a recurve turns back on itself near
            // the tip, which is the whole shape of it.
            const z = -Math.sin(t * 2.0) * depth + recurve * Math.pow(t, 3) * depth * 2.2;
            pts.push(new THREE.Vector3(0, dir * t * len, z));
          }
          for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const d = b.clone().sub(a);
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(
              (o.rTop || 0.008) - i * 0.0006, (o.rBot || 0.011) - i * 0.0006,
              d.length() * 1.1, this.seg(8, 5)), mat);
            seg.position.copy(a).add(b).multiplyScalar(0.5);
            seg.quaternion.setFromUnitVectors(up, d.clone().normalize());
            group.add(seg);
          }
          const tip = pts[pts.length - 1];
          tips.push(tip);
          if (o.nockMat) {
            const nock = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(8, 5), this.seg(6, 4)), o.nockMat);
            nock.position.copy(tip);
            group.add(nock);
          }
        }
        if (o.stringMat) {
          const a = tips[0], b = tips[1];
          const d = b.clone().sub(a);
          const string = new THREE.Mesh(new THREE.CylinderGeometry(
            o.stringR || 0.0018, o.stringR || 0.0018, d.length(), this.seg(5, 3)), o.stringMat);
          string.position.copy(a).add(b).multiplyScalar(0.5);
          string.quaternion.setFromUnitVectors(up, d.clone().normalize());
          group.add(string);
          if (o.serving) {
            const serving = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, this.seg(7, 5)), o.stringMat);
            serving.position.copy(string.position);
            serving.quaternion.copy(string.quaternion);
            group.add(serving);
          }
        }
        return group;
      },

      /** Grip, arrow shelf and binding at the centre of a bow. */
      _bowGrip(group, mat, wrapMat, opts) {
        const o = opts || {};
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(o.r || 0.015, (o.r || 0.015) * 1.05, o.h || 0.09, this.seg(11, 7)), mat);
        group.add(grip);
        if (o.shelf !== false) {
          const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.02), mat);
          shelf.position.set(0, 0.012, 0.014);
          group.add(shelf);
        }
        if (wrapMat) {
          const n = this.isLowDetail() ? 3 : 5;
          for (let i = 0; i < n; i++) {
            const wrap = new THREE.Mesh(new THREE.TorusGeometry((o.r || 0.015) * 1.12, 0.004, this.seg(4, 3), this.seg(10, 6)), wrapMat);
            wrap.rotation.x = Math.PI / 2;
            wrap.position.y = -0.03 + i * 0.016;
            group.add(wrap);
          }
        }
        return group;
      },

      // ---- 336: Toy Bow -------------------------------------------------------
      createToyBowModel(weapon, rand) {
        const group = new THREE.Group();
        const plasticColor = this.getRandomColor(rand, [0xE8342B, 0x1D6FD6, 0x8AE835]);
        const plastic = this._mat(plasticColor, { roughness: 0.5, metalness: 0.06 });
        const yellow = this._mat(0xF5C518, { roughness: 0.55, metalness: 0.06 });
        const cord = this._mat(0xE8E4D8, { roughness: 0.9, metalness: 0.02 });
        const rubber = this._mat(0xE8A0A0, { roughness: 0.95, metalness: 0.0 });
        this._bowLimbs(group, plastic, { length: 0.22, depth: 0.04, rTop: 0.008, rBot: 0.011, stringMat: cord, nockMat: yellow });
        this._bowGrip(group, yellow, null, { r: 0.014, h: 0.08 });
        // A moulded seam up the middle and a sucker-tipped arrow on the rest.
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.4, 0.03), yellow);
        seam.position.z = -0.02;
        group.add(seam);
        const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, this.seg(8, 5)), yellow);
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, 0.014, 0.05);
        group.add(arrow);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.014, this.seg(10, 6)), rubber);
        cup.rotation.x = -Math.PI / 2;
        cup.position.set(0, 0.014, 0.156);
        group.add(cup);
        const fletch = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.02, this.seg(6, 4)), plastic);
        fletch.rotation.x = -Math.PI / 2;
        fletch.position.set(0, 0.014, -0.04);
        group.add(fletch);
        return group;
      },

      // ---- 337: Warped Arrows -------------------------------------------------
      createWarpedArrowsModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x8B5A2B);
        const bent = this._wood(0x6E4A2A);
        const cord = this._mat(0xC8B48A, { roughness: 0.9, metalness: 0.02 });
        const flint = this._mat(0x4A4A4E, { roughness: 0.5, metalness: 0.15 });
        const featherMat = this._mat(0xD8C8A8, { roughness: 0.95, metalness: 0.02 });
        // The bow is fine. The arrows are the problem, and there are a lot of
        // them, none of them straight.
        this._bowLimbs(group, wood, { length: 0.28, depth: 0.05, stringMat: cord });
        this._bowGrip(group, wood, cord, { r: 0.015 });
        const arrows = this.isLowDetail() ? 3 : 5;
        const up = new THREE.Vector3(0, 1, 0);
        for (let a = 0; a < arrows; a++) {
          const bendAmt = (rand() - 0.5) * 0.06;
          const segs = this.isLowDetail() ? 3 : 5;
          for (let i = 0; i < segs; i++) {
            const t = i / segs, t2 = (i + 1) / segs;
            const p1 = new THREE.Vector3(0.012 * (a - 2), 0.014, -0.06 + t * 0.28 + Math.sin(t * 4) * bendAmt);
            const p2 = new THREE.Vector3(0.012 * (a - 2), 0.014, -0.06 + t2 * 0.28 + Math.sin(t2 * 4) * bendAmt);
            p1.y += Math.sin(t * 3 + a) * bendAmt;
            p2.y += Math.sin(t2 * 3 + a) * bendAmt;
            const d = p2.clone().sub(p1);
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, d.length() * 1.05, this.seg(6, 4)), bent);
            seg.position.copy(p1).add(p2).multiplyScalar(0.5);
            seg.quaternion.setFromUnitVectors(up, d.clone().normalize());
            group.add(seg);
          }
          const head = this._plate([[-0.008, 0], [0.008, 0], [0, 0.03]], 0.004, flint);
          head.position.set(0.012 * (a - 2), 0.014 + Math.sin(3 + a) * bendAmt, 0.235);
          head.rotation.x = Math.PI / 2;
          group.add(head);
          const f = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, this.seg(5, 4)), featherMat);
          f.rotation.x = -Math.PI / 2;
          f.position.set(0.012 * (a - 2), 0.014, -0.05);
          group.add(f);
        }
        return group;
      },

      // ---- 338: Flimsy Bow ----------------------------------------------------
      createFlimsyBowModel(weapon, rand) {
        const group = new THREE.Group();
        const green = this._wood(0xA8B060);
        const bark = this._wood(0x6E7A3A);
        const twine = this._mat(0xC8B48A, { roughness: 0.95, metalness: 0.02 });
        // Cut green that morning: it still has bark on it, it is already
        // splitting, and the string is garden twine.
        this._bowLimbs(group, green, { length: 0.3, depth: 0.07, rTop: 0.006, rBot: 0.009, stringMat: twine, stringR: 0.0026 });
        this._bowGrip(group, green, twine, { r: 0.013, shelf: false });
        const barkPatches = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < barkPatches; i++) {
          const t = (i / barkPatches - 0.5) * 2;
          const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.04, this.seg(8, 5)), bark);
          patch.position.set(0, t * 0.22, -Math.sin(Math.abs(t) * 2.0) * 0.07);
          patch.rotation.x = t * 0.4;
          group.add(patch);
        }
        // The split, which is going to finish opening at the worst moment.
        const split = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.06, 0.014), bark);
        split.position.set(0, 0.14, -0.05);
        split.rotation.x = 0.3;
        group.add(split);
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(8, 5), this.seg(6, 4)), bark);
        knot.position.set(0, -0.18, -0.055);
        group.add(knot);
        return group;
      },

      // ---- 339: Misaligned Hand Crossbow --------------------------------------
      createMisalignedHandCrossbowModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6B4423);
        const steel = this._mat(0x8A9096, { roughness: 0.6, metalness: 0.7 });
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const rust = this._mat(0x8A4B22, { roughness: 0.95, metalness: 0.3 });
        this._crossbowFrame(group, steel, cord, wood, { span: 0.075, stockLen: 0.16, boltMat: wood, tipMat: steel });
        // Everything on it is a few degrees out, and the prod sits crooked in
        // its slot.
        const prod = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.014), steel);
        prod.position.set(0, 0.02, 0.1);
        prod.rotation.z = 0.09;
        group.add(prod);
        const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.02), wood);
        wedge.position.set(0.008, 0.014, 0.1);
        group.add(wedge);
        for (let i = 0; i < 2; i++) {
          const patch = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.014), rust);
          patch.position.set((rand() - 0.5) * 0.04, 0.02, 0.02 + i * 0.05);
          group.add(patch);
        }
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.07, 0.03), wood);
        grip.position.set(0, -0.05, -0.05);
        grip.rotation.set(0.2, 0, 0.06);
        group.add(grip);
        return group;
      },

      // ---- 340: Unreliable Crossbow -------------------------------------------
      createUnreliableCrossbowModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x5C3317);
        const steel = this._mat(0x74797F, { roughness: 0.68, metalness: 0.66 });
        const cord = this._mat(0xC8BFA0, { roughness: 0.9, metalness: 0.05 });
        const tape = this._wood(0x33332E);
        this._crossbowFrame(group, steel, cord, wood, { span: 0.11, stockLen: 0.24, boltMat: wood, tipMat: steel });
        // Repaired more than once: a spliced prod, a frayed string and tape
        // over the lock.
        const splice = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.02), wood);
        splice.position.set(-0.05, 0.02, 0.085);
        splice.rotation.z = -0.3;
        group.add(splice);
        for (let i = 0; i < 3; i++) {
          const bind = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, this.seg(4, 3), this.seg(10, 6)), tape);
          bind.rotation.y = Math.PI / 2;
          bind.position.set(-0.04 - i * 0.014, 0.02, 0.09);
          bind.rotation.z = -0.3;
          group.add(bind);
        }
        const fray = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < fray; i++) {
          const f = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.02, this.seg(5, 3)), cord);
          f.position.set((rand() - 0.5) * 0.06, 0.026, 0.03);
          f.rotation.z = (rand() - 0.5) * 1.4;
          f.userData.sway = { axis: 'z', amp: 0.2, freq: 1.4, phase: i };
          group.add(f);
        }
        const patchTape = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.026, 0.03), tape);
        patchTape.position.set(0, 0.01, -0.02);
        group.add(patchTape);
        return group;
      },

      // ---- 341: Shower Rod Bow ------------------------------------------------
      createShowerRodBowModel(weapon, rand) {
        const group = new THREE.Group();
        const chrome = this._mat(0xC8CED4, { roughness: 0.2, metalness: 0.95 });
        const plastic = this._mat(0x2A2A2E, { roughness: 0.8, metalness: 0.1 });
        const cord = this._mat(0xE8E4D8, { roughness: 0.9, metalness: 0.02 });
        const ringMat = this._mat(0xB0B6BC, { roughness: 0.5, metalness: 0.8 });
        // A telescoping shower rail bent into a bow: the joint is still in it
        // and so are the curtain rings.
        this._bowLimbs(group, chrome, { length: 0.28, depth: 0.06, rTop: 0.009, rBot: 0.012, stringMat: cord });
        this._bowGrip(group, plastic, null, { r: 0.016, shelf: false });
        for (const dir of [1, -1]) {
          const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, this.seg(11, 7)), plastic);
          joint.position.set(0, dir * 0.13, -0.055);
          joint.rotation.x = dir * 0.5;
          group.add(joint);
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.014, this.seg(11, 7)), plastic);
          foot.position.set(0, dir * 0.28, 0.0);
          group.add(foot);
        }
        const rings = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < rings; i++) {
          const t = (i / (rings - 1) - 0.5) * 2;
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, this.seg(4, 3), this.seg(12, 7)), ringMat);
          r.position.set(0, t * 0.18, -Math.sin(Math.abs(t) * 2.0) * 0.055);
          r.rotation.y = Math.PI / 2;
          r.userData.sway = { axis: 'x', amp: 0.2, freq: 1.2 + i * 0.2, phase: i };
          group.add(r);
        }
        return group;
      },

      // ---- 342: PVC Bow -------------------------------------------------------
      createPVCBowModel(weapon, rand) {
        const group = new THREE.Group();
        const pvc = this._mat(0xE8E4DA, { roughness: 0.5, metalness: 0.03 });
        const purple = this._mat(0x6B4A8B, { roughness: 0.7, metalness: 0.05 });
        const cord = this._mat(0x2A2A2E, { roughness: 0.85, metalness: 0.05 });
        const tape = this._wood(0x33332E);
        // Drain pipe, heat-bent, with the printed spec still on it.
        this._bowLimbs(group, pvc, { length: 0.3, depth: 0.065, rTop: 0.011, rBot: 0.013, stringMat: cord, stringR: 0.0022 });
        this._bowGrip(group, pvc, tape, { r: 0.016, shelf: false });
        for (const dir of [1, -1]) {
          const notch = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, this.seg(4, 3), this.seg(10, 6)), purple);
          notch.position.set(0, dir * 0.27, 0.008);
          notch.rotation.y = Math.PI / 2;
          group.add(notch);
        }
        // The printing, which every length of it has.
        if (this.wantsTrim()) {
          for (let i = 0; i < 4; i++) {
            const t = (i / 3 - 0.5) * 1.4;
            const print = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.03, 0.008), purple);
            print.position.set(0.011, t * 0.2, -Math.sin(Math.abs(t) * 2.0) * 0.06);
            print.rotation.x = t * 0.4;
            group.add(print);
          }
        }
        const glue = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.005, this.seg(4, 3), this.seg(12, 7)), purple);
        glue.rotation.x = Math.PI / 2;
        glue.position.y = 0.05;
        group.add(glue);
        return group;
      },

      // ---- 343: Junk Crossbow -------------------------------------------------
      createJunkCrossbowModel(weapon, rand) {
        const group = new THREE.Group();
        const plank = this._wood(0xB08048);
        const scrap = this._mat(0x8A8F95, { roughness: 0.7, metalness: 0.6 });
        const band = this._mat(0x2A2A2E, { roughness: 0.95, metalness: 0.02 });
        const tape = this._wood(0x9A8A50);
        // A plank, a car leaf spring and an inner tube. It fires, mostly.
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.026, 0.28), plank);
        stock.position.set(0, 0.0, 0.02);
        group.add(stock);
        const groove = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.008, 0.24), scrap);
        groove.position.set(0, 0.016, 0.04);
        group.add(groove);
        const prod = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.016), scrap);
        prod.position.set(0, 0.014, 0.12);
        prod.rotation.z = 0.05;
        group.add(prod);
        for (const s of [-1, 1]) {
          const strap = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.11), band);
          strap.position.set(s * 0.06, 0.014, 0.06);
          strap.rotation.y = -s * 0.4;
          group.add(strap);
        }
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.16, this.seg(7, 5)), scrap);
        bolt.rotation.x = Math.PI / 2;
        bolt.position.set(0, 0.022, 0.08);
        group.add(bolt);
        const nail = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, this.seg(6, 4)), scrap);
        nail.rotation.x = Math.PI / 2;
        nail.position.set(0, 0.022, 0.17);
        group.add(nail);
        for (let i = 0; i < 4; i++) {
          const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.018), tape);
          wrap.position.set(0, 0.002, -0.06 + i * 0.05);
          wrap.rotation.z = (rand() - 0.5) * 0.2;
          group.add(wrap);
        }
        this._gunTrigger(group, scrap, 0, -0.024, -0.06, { guard: false });
        return group;
      },

      // ---- 344: Seed Bow ------------------------------------------------------
      createSeedBowModel(weapon, rand) {
        const group = new THREE.Group();
        const bark = this._wood(0x5B4227);
        const leafColor = this.getRandomColor(rand, [0x4E9A3A, 0x6BBF48]);
        const leaf = this._mat(leafColor, { roughness: 0.6, metalness: 0.05 });
        const vine = this._mat(0x3A7A2A, { roughness: 0.75, metalness: 0.04 });
        const sap = this._glow(0xB8FF5A, 0.8);
        const husk = this._mat(0xC8A02A, { roughness: 0.55, metalness: 0.1 });
        // Still growing: the limbs are living wood, the string is a vine, and
        // the arrows are seeds it makes itself.
        this._bowLimbs(group, bark, { length: 0.3, depth: 0.06, stringMat: vine, stringR: 0.0026, nockMat: leaf });
        this._bowGrip(group, bark, vine, { r: 0.016 });
        const leaves = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < leaves; i++) {
          const t = (i / (leaves - 1) - 0.5) * 2;
          const l = this._plate([[0, 0], [0.02, 0.014], [0.03, 0.04], [0.005, 0.03]], 0.003, leaf);
          l.position.set(0.008, t * 0.2, -Math.sin(Math.abs(t) * 2.0) * 0.055);
          l.rotation.set(t * 0.4, 0, 0.4 + i);
          l.userData.sway = { axis: 'z', amp: 0.12, freq: 1.0 + i * 0.15, phase: i };
          group.add(l);
        }
        const pod = new THREE.Mesh(new THREE.SphereGeometry(0.018, this.seg(10, 6), this.seg(7, 5)), husk);
        pod.scale.y = 1.4;
        pod.position.set(0, 0.014, 0.03);
        group.add(pod);
        const seedGlow = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(8, 5), this.seg(6, 4)), sap);
        seedGlow.position.set(0, 0.014, 0.03);
        seedGlow.userData.pulse = { min: 0.3, max: 1.1, freq: 1.0 };
        group.add(seedGlow);
        const shoot = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.05, this.seg(6, 4)), leaf);
        shoot.position.set(0, -0.05, 0.03);
        shoot.rotation.x = 1.2;
        shoot.userData.sway = { axis: 'z', amp: 0.16, freq: 1.2 };
        group.add(shoot);
        return group;
      },

      // ---- 345: Short Bow -----------------------------------------------------
      createShortBowModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(this.getRandomColor(rand, [0x8B5A2B, 0xA0703C, 0x6E4A2A]));
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const leather = this._wood(0x5B3A1E);
        // A self bow cut from one stave: no recurve, no fittings, and short
        // enough to shoot from a horse.
        this._bowLimbs(group, wood, { length: 0.24, depth: 0.06, rTop: 0.008, rBot: 0.012, stringMat: cord, serving: true });
        this._bowGrip(group, wood, leather, { r: 0.015 });
        // The growth rings on the back of the stave.
        if (this.wantsTrim()) {
          for (let i = 0; i < 4; i++) {
            const t = (i / 3 - 0.5) * 1.6;
            const ring = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.05, 0.016), this._wood(0x6E4A2A));
            ring.position.set(0.006, t * 0.17, -Math.sin(Math.abs(t) * 2.0) * 0.055);
            ring.rotation.x = t * 0.4;
            group.add(ring);
          }
        }
        for (const dir of [1, -1]) {
          const nockGroove = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0025, this.seg(4, 3), this.seg(10, 6)), leather);
          nockGroove.position.set(0, dir * 0.225, -0.028);
          nockGroove.rotation.y = Math.PI / 2;
          group.add(nockGroove);
        }
        return group;
      },

      // ---- 346: Long Bow ------------------------------------------------------
      createLongBowModel(weapon, rand) {
        const group = new THREE.Group();
        const yew = this._wood(0xC8A870);
        const heart = this._wood(0x8B5A2B);
        const cord = this._mat(0xE8DFC8, { roughness: 0.85, metalness: 0.05 });
        const horn = this._mat(0xE0D6C0, { roughness: 0.5, metalness: 0.08 });
        // As tall as the archer: one stave with the sapwood on the back and
        // the heartwood on the belly, and horn nocks at both ends.
        this._bowLimbs(group, yew, { length: 0.44, depth: 0.05, rTop: 0.007, rBot: 0.013, segments: 9, stringMat: cord, serving: true });
        this._bowGrip(group, heart, null, { r: 0.016, h: 0.11, shelf: false });
        const belly = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.8, 0.014), heart);
        belly.position.z = 0.008;
        group.add(belly);
        for (const dir of [1, -1]) {
          const nock = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.03, this.seg(9, 6)), horn);
          nock.position.set(0, dir * 0.43, 0.005);
          nock.rotation.x = dir * 0.3;
          group.add(nock);
        }
        const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.34, this.seg(7, 5)), yew);
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, 0.01, 0.06);
        group.add(arrow);
        const bodkin = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.04, 4), this._mat(0x5A5F66, { roughness: 0.6, metalness: 0.75 }));
        bodkin.rotation.x = Math.PI / 2;
        bodkin.position.set(0, 0.01, 0.245);
        group.add(bodkin);
        for (let i = 0; i < 2; i++) {
          const f = this._plate([[0, 0], [0.014, 0.008], [0.014, 0.05], [0, 0.044]], 0.0015, horn);
          f.position.set(0, 0.01, -0.1);
          f.rotation.set(Math.PI / 2, i * Math.PI / 2, 0);
          group.add(f);
        }
        return group;
      },

      // ---- 347: Composite Bow -------------------------------------------------
      createCompositeBowModel(weapon, rand) {
        const group = new THREE.Group();
        const horn = this._mat(0x2A1F14, { roughness: 0.35, metalness: 0.12 });
        const sinew = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.04 });
        const lacquerColor = this.getRandomColor(rand, [0xC0392B, 0x1E4A8B, 0x1A1A1E]);
        const lacquer = this._mat(lacquerColor, { roughness: 0.2, metalness: 0.15 });
        const cord = this._mat(0xE8DFC8, { roughness: 0.85, metalness: 0.05 });
        // Horn on the belly, sinew on the back, and a deep recurve that only
        // that construction allows.
        this._bowLimbs(group, lacquer, { length: 0.26, depth: 0.07, recurve: -1.1, rTop: 0.009, rBot: 0.013, stringMat: cord, serving: true });
        this._bowGrip(group, horn, sinew, { r: 0.016 });
        // The laminate showing at the edges.
        const laminae = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < laminae; i++) {
          const t = (i / (laminae - 1) - 0.5) * 1.7;
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.05, 0.012), sinew);
          back.position.set(0, t * 0.18, -Math.sin(Math.abs(t) * 2.0) * 0.07 - 0.008);
          back.rotation.x = t * 0.5;
          group.add(back);
          const bellyStrip = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.05, 0.01), horn);
          bellyStrip.position.set(0, t * 0.18, -Math.sin(Math.abs(t) * 2.0) * 0.07 + 0.008);
          bellyStrip.rotation.x = t * 0.5;
          group.add(bellyStrip);
        }
        for (const dir of [1, -1]) {
          const siyah = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.016), horn);
          siyah.position.set(0, dir * 0.27, 0.03);
          siyah.rotation.x = dir * -0.7;
          group.add(siyah);
        }
        return group;
      },

      // ---- 348: Chu-Ko-Nu -----------------------------------------------------
      createChuKoNuModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6B4423);
        const dark = this._wood(0x3A2A1C);
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const iron = this._mat(0x5A5F66, { roughness: 0.6, metalness: 0.75 });
        // The repeating crossbow: a magazine box sliding on top, and a lever
        // that spans, loads and looses in one movement.
        this._crossbowFrame(group, iron, cord, wood, { span: 0.11, stockLen: 0.24 });
        const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.036, 0.11), dark);
        magazine.position.set(0, 0.05, 0.03);
        magazine.userData.gun = 'slide';
        group.add(magazine);
        const bolts = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < bolts; i++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.1, this.seg(6, 4)), wood);
          b.rotation.x = Math.PI / 2;
          b.position.set(0, 0.038 + i * 0.006, 0.03);
          group.add(b);
        }
        const loaded = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.12, this.seg(6, 4)), wood);
        loaded.rotation.x = Math.PI / 2;
        loaded.position.set(0, 0.03, 0.06);
        group.add(loaded);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.018, this.seg(6, 4)), iron);
        tip.rotation.x = Math.PI / 2;
        tip.position.set(0, 0.03, 0.128);
        group.add(tip);
        // The lever, which is the whole mechanism.
        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.09, 0.014), wood);
        lever.position.set(0, 0.02, -0.06);
        lever.rotation.x = -0.5;
        lever.userData.gun = 'bolt';
        group.add(lever);
        const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, this.seg(9, 6)), iron);
        pivot.rotation.z = Math.PI / 2;
        pivot.position.set(0, 0.05, -0.05);
        group.add(pivot);
        return group;
      },

      // ---- 349: Net Crossbow --------------------------------------------------
      createNetCrossbowModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x5C3317);
        const steel = this._mat(0x8A9096, { roughness: 0.45, metalness: 0.82 });
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const netMat = this._mat(0x8A7A5A, { roughness: 0.95, metalness: 0.02 });
        const weight = this._mat(0x5B5B66, { roughness: 0.6, metalness: 0.7 });
        this._crossbowFrame(group, steel, cord, wood, { span: 0.12, stockLen: 0.24 });
        // A four-pronged spreader with the net folded between the arms and a
        // weight on each corner.
        const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.06, this.seg(12, 7)), steel);
        canister.rotation.x = Math.PI / 2;
        canister.position.set(0, 0.03, 0.11);
        group.add(canister);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.05, this.seg(7, 5)), steel);
          prong.position.set(Math.cos(a) * 0.024, 0.03 + Math.sin(a) * 0.024, 0.155);
          prong.rotation.set(Math.PI / 2 - 0.3 * Math.sin(a), 0, 0.3 * Math.cos(a));
          group.add(prong);
          const w = new THREE.Mesh(new THREE.SphereGeometry(0.009, this.seg(8, 5), this.seg(6, 4)), weight);
          w.position.set(Math.cos(a) * 0.04, 0.03 + Math.sin(a) * 0.04, 0.175);
          group.add(w);
        }
        // The net itself, bunched in the canister mouth.
        const knots = this.isLowDetail() ? 5 : 10;
        for (let i = 0; i < knots; i++) {
          const a = rand() * Math.PI * 2, r = rand() * 0.02;
          const k = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0015, this.seg(4, 3), this.seg(8, 5)), netMat);
          k.position.set(Math.cos(a) * r, 0.03 + Math.sin(a) * r, 0.138 + rand() * 0.01);
          k.rotation.set(rand(), rand(), rand());
          group.add(k);
        }
        return group;
      },

      // ---- 350: Compound Bow --------------------------------------------------
      createCompoundBowModel(weapon, rand) {
        const group = new THREE.Group();
        const riser = this._mat(this.getRandomColor(rand, [0x2E3238, 0x3A4A32, 0x4A2E32]), { roughness: 0.4, metalness: 0.8 });
        const limb = this._mat(0x1E2126, { roughness: 0.45, metalness: 0.5 });
        const cable = this._mat(0x2A2E34, { roughness: 0.7, metalness: 0.3 });
        const bright = this._mat(0x9BA1A7, { roughness: 0.3, metalness: 0.9 });
        // Short stiff limbs and eccentric cams: the geometry does the work, so
        // the shape is nothing like a bow.
        const riserBar = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.24, 0.03), riser);
        group.add(riserBar);
        // Cut-outs through the riser, which every compound has.
        for (let i = 0; i < 3; i++) {
          const cut = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.04, 0.012), limb);
          cut.position.set(0, -0.06 + i * 0.06, 0);
          group.add(cut);
        }
        for (const dir of [1, -1]) {
          const l = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.1, 0.014), limb);
          l.position.set(0, dir * 0.17, -0.02);
          l.rotation.x = dir * 0.35;
          group.add(l);
          const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.03, 0.028), riser);
          pocket.position.set(0, dir * 0.12, -0.006);
          group.add(pocket);
          const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.008, this.seg(14, 8)), bright);
          cam.rotation.y = Math.PI / 2;
          cam.position.set(0, dir * 0.225, -0.05);
          cam.userData.spin = { axis: 'x', speed: dir * 0.35 };
          group.add(cam);
          const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.02, this.seg(9, 6)), bright);
          axle.rotation.z = Math.PI / 2;
          axle.position.set(0, dir * 0.225, -0.05);
          group.add(axle);
        }
        // String and the two cables that make it a compound.
        const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.45, this.seg(5, 3)), cable);
        string.position.z = -0.075;
        group.add(string);
        for (const s of [-1, 1]) {
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.42, this.seg(5, 3)), cable);
          c.position.set(s * 0.008, 0, -0.055);
          c.rotation.z = s * 0.02;
          group.add(c);
        }
        const rest = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.02), bright);
        rest.position.set(0.012, 0.01, 0.014);
        group.add(rest);
        const sightBar = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.07), bright);
        sightBar.position.set(0, 0.05, 0.04);
        group.add(sightBar);
        const pins = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < pins; i++) {
          const pin = new THREE.Mesh(new THREE.SphereGeometry(0.003, this.seg(6, 4), this.seg(4, 3)),
            this._glow([0xFF3A3A, 0x3AFF6A, 0xFFD93A, 0x3A9CFF][i], 0.9));
          pin.position.set(0, 0.042 - i * 0.006, 0.07);
          group.add(pin);
        }
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.06, 0.03), limb);
        grip.position.set(0, -0.02, 0.008);
        group.add(grip);
        return group;
      },

      // ---- 351: Multi-Bolt Crossbow -------------------------------------------
      createMultiBoltCrossbowModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._mat(0x4A4F55, { roughness: 0.5, metalness: 0.8 });
        const wood = this._wood(0x4A3524);
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const bright = this._mat(0x9BA1A7, { roughness: 0.35, metalness: 0.88 });
        this._crossbowFrame(group, steel, cord, wood, { span: 0.13, stockLen: 0.26 });
        // Three grooves instead of one, and a bolt sitting in each.
        for (let i = 0; i < 3; i++) {
          const x = (i - 1) * 0.02;
          const groove = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.18), steel);
          groove.position.set(x, 0.03, 0.06);
          groove.rotation.z = (i - 1) * 0.06;
          group.add(groove);
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.15, this.seg(6, 4)), bright);
          bolt.rotation.x = Math.PI / 2;
          bolt.position.set(x * 1.3, 0.036, 0.07);
          group.add(bolt);
          const head = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.022, 3), bright);
          head.rotation.x = Math.PI / 2;
          head.position.set(x * 1.6, 0.036, 0.156);
          group.add(head);
        }
        const spreader = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.02), steel);
        spreader.position.set(0, 0.03, 0.14);
        group.add(spreader);
        const bank = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.04), wood);
        bank.position.set(0, 0.03, -0.02);
        group.add(bank);
        const spares = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < spares; i++) {
          const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.1, this.seg(6, 4)), wood);
          sp.rotation.x = Math.PI / 2;
          sp.position.set(-0.024 + (i % 3) * 0.024, -0.026 - Math.floor(i / 3) * 0.01, -0.06);
          group.add(sp);
        }
        return group;
      },

      // ---- 352: Advanced Compound Bow -----------------------------------------
      createAdvancedCompoundBowModel(weapon, rand) {
        const group = new THREE.Group();
        const riser = this._mat(0x1E2126, { roughness: 0.35, metalness: 0.85 });
        const carbon = this._mat(0x14161A, { roughness: 0.3, metalness: 0.4 });
        const bright = this._mat(0xA8AEB4, { roughness: 0.28, metalness: 0.92 });
        const cable = this._mat(0x2A2E34, { roughness: 0.7, metalness: 0.3 });
        const hud = this._glow(0x4FE3FF, 1.1);
        // The competition version of 350: carbon limbs, a stabiliser out the
        // front, and a lit sight.
        const riserBar = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.26, 0.034), riser);
        group.add(riserBar);
        for (let i = 0; i < 4; i++) {
          const cut = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.032, 0.014), carbon);
          cut.position.set(0, -0.08 + i * 0.05, 0);
          group.add(cut);
        }
        for (const dir of [1, -1]) {
          const l = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.012), carbon);
          l.position.set(0, dir * 0.175, -0.024);
          l.rotation.x = dir * 0.4;
          group.add(l);
          const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.009, this.seg(14, 8)), bright);
          cam.rotation.y = Math.PI / 2;
          cam.position.set(0, dir * 0.23, -0.06);
          cam.userData.spin = { axis: 'x', speed: dir * 0.4 };
          group.add(cam);
          const mod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.011, this.seg(12, 7)), riser);
          mod.rotation.y = Math.PI / 2;
          mod.position.set(0, dir * 0.23, -0.06);
          group.add(mod);
        }
        const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.46, this.seg(5, 3)), cable);
        string.position.z = -0.085;
        group.add(string);
        const peep = new THREE.Mesh(new THREE.TorusGeometry(0.005, 0.0015, this.seg(4, 3), this.seg(9, 6)), bright);
        peep.position.set(0, 0.07, -0.085);
        peep.rotation.y = Math.PI / 2;
        group.add(peep);
        // Stabiliser and vibration dampers.
        const stab = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, this.seg(10, 6)), carbon);
        stab.rotation.x = Math.PI / 2;
        stab.position.set(0, -0.02, 0.11);
        group.add(stab);
        const damper = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, this.seg(11, 7)), riser);
        damper.rotation.x = Math.PI / 2;
        damper.position.set(0, -0.02, 0.2);
        group.add(damper);
        const sightHousing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, this.seg(4, 3), this.seg(14, 8)), bright);
        sightHousing.position.set(0, 0.05, 0.09);
        sightHousing.rotation.y = Math.PI / 2;
        group.add(sightHousing);
        const reticle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.002, this.seg(14, 8)), hud);
        reticle.position.set(0, 0.05, 0.09);
        reticle.rotation.z = Math.PI / 2;
        reticle.userData.pulse = { min: 0.3, max: 1.1, freq: 1.4 };
        group.add(reticle);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.062, 0.032), carbon);
        grip.position.set(0, -0.02, 0.012);
        group.add(grip);
        return group;
      },

      // ---- 353: Frostbite Bow -------------------------------------------------
      createFrostbiteBowModel(weapon, rand) {
        const group = new THREE.Group();
        const ice = this._mat(0xA8DCF0, { roughness: 0.15, metalness: 0.25, opacity: 0.85, transparent: true });
        const deep = this._mat(0x3A7AA8, { roughness: 0.2, metalness: 0.3 });
        const frost = this._mat(0xE8F6FF, { roughness: 0.75, metalness: 0.05 });
        const chill = this._glow(0x9BE8FF, 1.0);
        // Grown, not cut: the limbs are clear ice and the string is a line of
        // cold that never touches them.
        this._bowLimbs(group, ice, { length: 0.3, depth: 0.06, recurve: -0.6, rTop: 0.01, rBot: 0.014, stringMat: chill, stringR: 0.0022 });
        this._bowGrip(group, deep, null, { r: 0.016, shelf: false });
        const shards = this.isLowDetail() ? 5 : 10;
        for (let i = 0; i < shards; i++) {
          const t = (i / (shards - 1) - 0.5) * 2;
          const sh = new THREE.Mesh(new THREE.ConeGeometry(0.007 + rand() * 0.004, 0.03 + rand() * 0.03, this.seg(5, 4)), ice);
          sh.position.set(0, t * 0.22, -Math.sin(Math.abs(t) * 2.0) * 0.06);
          sh.rotation.set(t * 0.5, rand() * 3, (rand() - 0.5) * 1.6);
          group.add(sh);
        }
        const rime = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < rime; i++) {
          const t = (i / (rime - 1) - 0.5) * 1.8;
          const r = new THREE.Mesh(new THREE.SphereGeometry(0.008 + rand() * 0.005, this.seg(7, 5), this.seg(5, 4)), frost);
          r.position.set((rand() - 0.5) * 0.02, t * 0.2, -Math.sin(Math.abs(t) * 2.0) * 0.06);
          group.add(r);
        }
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 0), chill);
        core.position.set(0, 0.0, -0.006);
        core.userData.spin = { axis: 'x', speed: 0.5 };
        group.add(core);
        const breath = new THREE.Mesh(new THREE.SphereGeometry(0.03, this.seg(10, 6), this.seg(7, 5)), chill);
        breath.position.set(0, 0, -0.006);
        breath.userData.pulse = { min: 0.05, max: 0.28, freq: 0.7 };
        group.add(breath);
        return group;
      },

      // ---- 354: Aetherial Bow -------------------------------------------------
      createAetherialBowModel(weapon, rand) {
        const group = new THREE.Group();
        const aether = this._glow(0xB8A8FF, 1.0);
        const faint = this._mat(0x8A7AD8, { roughness: 0.3, metalness: 0.2, opacity: 0.45, transparent: true });
        const bright = this._glow(0xE8DCFF, 1.3);
        // Barely there: the limbs are drawn in light and only the grip has
        // enough substance to hold.
        this._bowLimbs(group, faint, { length: 0.3, depth: 0.07, recurve: -0.8, rTop: 0.008, rBot: 0.011, stringMat: bright, stringR: 0.0016 });
        this._bowGrip(group, aether, null, { r: 0.014, h: 0.08, shelf: false });
        const motes = this.isLowDetail() ? 6 : 14;
        for (let i = 0; i < motes; i++) {
          const t = (i / (motes - 1) - 0.5) * 2;
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.005 + rand() * 0.004, this.seg(6, 4), this.seg(5, 3)), bright);
          m.position.set((rand() - 0.5) * 0.03, t * 0.24, -Math.sin(Math.abs(t) * 2.0) * 0.07 + (rand() - 0.5) * 0.02);
          m.userData.orbit = { radius: 0.016, speed: 0.6 + rand() * 0.6, phase: i, plane: 'xz' };
          group.add(m);
        }
        // Rings the limbs pass through rather than sit on.
        for (const dir of [1, -1]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.003, this.seg(4, 3), this.seg(16, 9)), aether);
          ring.position.set(0, dir * 0.16, -0.055);
          ring.rotation.set(dir * 0.5, 0, 0);
          ring.userData.spin = { axis: 'y', speed: dir * 0.8 };
          group.add(ring);
        }
        const nocked = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.006, 0.2, this.seg(6, 4)), bright);
        nocked.rotation.x = Math.PI / 2;
        nocked.position.set(0, 0.0, 0.06);
        nocked.userData.pulse = { min: 0.4, max: 1.2, freq: 1.1 };
        group.add(nocked);
        return group;
      },

      // ---- 355: Infinite Quiver Bow -------------------------------------------
      createInfiniteQuiverBowModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6B4423);
        const brass = this._mat(0xC8A23A, { roughness: 0.35, metalness: 0.85 });
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const port = this._glow(0x5AE8C8, 1.0);
        // The arrows are not carried. They arrive: a small hole above the
        // shelf, and one comes through it whenever the string goes back.
        this._bowLimbs(group, wood, { length: 0.28, depth: 0.06, stringMat: cord, serving: true, nockMat: brass });
        this._bowGrip(group, wood, brass, { r: 0.016 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, this.seg(5, 4), this.seg(16, 9)), brass);
        ring.position.set(0, 0.05, 0.03);
        ring.rotation.y = Math.PI / 2;
        group.add(ring);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.026, this.seg(16, 9)), port);
        hole.position.set(0, 0.05, 0.03);
        hole.rotation.y = Math.PI / 2;
        hole.userData.pulse = { min: 0.35, max: 1.0, freq: 0.8 };
        group.add(hole);
        // Arrows part-way through, at every stage of arriving.
        const arriving = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < arriving; i++) {
          const len = 0.05 + i * 0.05;
          const a = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, this.seg(6, 4)), wood);
          a.rotation.z = Math.PI / 2;
          a.position.set(-len * 0.5 + 0.005, 0.05 - i * 0.012, 0.03);
          group.add(a);
        }
        const nocked = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.24, this.seg(6, 4)), wood);
        nocked.rotation.x = Math.PI / 2;
        nocked.position.set(0, 0.014, 0.04);
        group.add(nocked);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.026, this.seg(7, 5)), brass);
        head.rotation.x = Math.PI / 2;
        head.position.set(0, 0.014, 0.172);
        group.add(head);
        return group;
      },

      // ---- 356: Dragon Bow ----------------------------------------------------
      createDragonBowModel(weapon, rand) {
        const group = new THREE.Group();
        const scaleColor = this.getRandomColor(rand, [0xB03A22, 0x2A6B3A, 0x3A3A5B]);
        const scale = this._mat(scaleColor, { roughness: 0.4, metalness: 0.4 });
        const horn = this._mat(0x3A2A1C, { roughness: 0.45, metalness: 0.15 });
        const gold = this._mat(0xD4A62A, { roughness: 0.3, metalness: 0.9 });
        const ember = this._glow(0xFF7A2A, 1.1);
        const cord = this._mat(0xE8B87A, { roughness: 0.6, metalness: 0.2 });
        // Not decorated with a dragon: made from one. The limbs are its horns
        // and the fire is still in it.
        this._bowLimbs(group, horn, { length: 0.3, depth: 0.075, recurve: -1.0, rTop: 0.009, rBot: 0.016, stringMat: cord, stringR: 0.0024 });
        this._bowGrip(group, scale, gold, { r: 0.018 });
        // A head at the centre and a spine of scales up each limb.
        const skull = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, this.seg(7, 5)), scale);
        skull.rotation.x = Math.PI / 2;
        skull.position.set(0, 0.02, 0.05);
        group.add(skull);
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.012, 0.03), horn);
        jaw.position.set(0, 0.008, 0.06);
        jaw.rotation.x = 0.3;
        group.add(jaw);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.005, this.seg(7, 5), this.seg(5, 4)), ember);
          eye.position.set(s * 0.012, 0.03, 0.04);
          eye.userData.pulse = { min: 0.5, max: 1.2, freq: 0.6 };
          group.add(eye);
        }
        const spines = this.isLowDetail() ? 5 : 10;
        for (let i = 0; i < spines; i++) {
          const t = (i / (spines - 1) - 0.5) * 2;
          const sp = this._plate([[0, 0], [0.012, 0.02], [0, 0.03]], 0.004, scale);
          sp.position.set(0, t * 0.22, -Math.sin(Math.abs(t) * 2.0) * 0.075 - 0.008);
          sp.rotation.set(t * 0.5, Math.PI / 2, t > 0 ? 0 : Math.PI);
          group.add(sp);
        }
        const throat = new THREE.Mesh(new THREE.SphereGeometry(0.012, this.seg(9, 6), this.seg(7, 5)), ember);
        throat.position.set(0, 0.02, 0.072);
        throat.userData.pulse = { min: 0.3, max: 1.3, freq: 0.9 };
        group.add(throat);
        return group;
      },

      // ---- 357: Infinite Quiver (crossbow) ------------------------------------
      createInfiniteQuiverModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._mat(0x5A5F66, { roughness: 0.5, metalness: 0.8 });
        const wood = this._wood(0x4A3524);
        const brass = this._mat(0xC8A23A, { roughness: 0.35, metalness: 0.85 });
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const port = this._glow(0x5AE8C8, 1.0);
        this._crossbowFrame(group, steel, cord, wood, { span: 0.12, stockLen: 0.26, boltMat: brass, tipMat: steel });
        // The magazine is a hole in the air held open by a brass frame, with
        // bolts falling out of it faster than they can be counted.
        const frame = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, this.seg(5, 4), this.seg(16, 9)), brass);
        frame.position.set(0, 0.06, -0.01);
        frame.rotation.x = Math.PI / 2;
        frame.userData.spin = { axis: 'y', speed: 0.7 };
        group.add(frame);
        const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.028, this.seg(16, 9)), port);
        mouth.position.set(0, 0.059, -0.01);
        mouth.rotation.x = -Math.PI / 2;
        mouth.userData.pulse = { min: 0.35, max: 1.05, freq: 0.9 };
        group.add(mouth);
        const falling = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < falling; i++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, this.seg(6, 4)), brass);
          b.position.set((rand() - 0.5) * 0.02, 0.05 - i * 0.008, -0.01 + (rand() - 0.5) * 0.02);
          b.rotation.set((rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6);
          b.userData.bob = { amp: 0.01, freq: 1.2 + i * 0.3, phase: i };
          group.add(b);
        }
        const counter = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.016, 0.004), port);
        counter.position.set(0.014, 0.02, -0.06);
        counter.userData.pulse = { min: 0.4, max: 1.1, freq: 2.2 };
        group.add(counter);
        return group;
      },

      // ---- 358: Arcane Crossbow -----------------------------------------------
      createArcaneCrossbowModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._wood(0x2A2438);
        const silver = this._mat(0xB8BEC6, { roughness: 0.3, metalness: 0.9 });
        const rune = this._glow(0x8A6AFF, 1.1);
        const cord = this._glow(0xC8B8FF, 0.9);
        this._crossbowFrame(group, silver, cord, dark, { span: 0.12, stockLen: 0.26 });
        // No prod strong enough to matter: the sigil ring is what throws the
        // bolt, and the bolt is drawn out of it.
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.005, this.seg(5, 4), this.seg(18, 10)), silver);
        ring.position.set(0, 0.03, 0.1);
        ring.rotation.y = Math.PI / 2;
        ring.userData.spin = { axis: 'z', speed: 0.6 };
        group.add(ring);
        const inner = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, this.seg(4, 3), this.seg(16, 9)), rune);
        inner.position.set(0, 0.03, 0.1);
        inner.rotation.y = Math.PI / 2;
        inner.userData.spin = { axis: 'z', speed: -0.9 };
        group.add(inner);
        const glyphs = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < glyphs; i++) {
          const a = (i / glyphs) * Math.PI * 2;
          const g = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.012, 0.006), rune);
          g.position.set(Math.cos(a) * 0.028, 0.03 + Math.sin(a) * 0.028, 0.1);
          g.rotation.z = a;
          group.add(g);
        }
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.006, 0.13, this.seg(7, 5)), rune);
        bolt.rotation.x = Math.PI / 2;
        bolt.position.set(0, 0.03, 0.05);
        bolt.userData.pulse = { min: 0.5, max: 1.2, freq: 1.3 };
        group.add(bolt);
        const runeRows = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < runeRows; i++) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.008, 0.012), rune);
          r.position.set(0.013, 0.01, -0.1 + i * 0.03);
          group.add(r);
        }
        return group;
      },

      // ---- 359: Dragonbone Bow ------------------------------------------------
      createDragonboneBowModel(weapon, rand) {
        const group = new THREE.Group();
        const bone = this._mat(0xD8CFB8, { roughness: 0.65, metalness: 0.05 });
        const marrow = this._mat(0x8A7A5A, { roughness: 0.8, metalness: 0.05 });
        const sinew = this._mat(0xC8A88A, { roughness: 0.85, metalness: 0.04 });
        const iron = this._mat(0x4A4F55, { roughness: 0.6, metalness: 0.7 });
        // Two ribs, joined at the sternum, still articulated where they were
        // cut. Nothing added that was not part of the animal.
        this._bowLimbs(group, bone, { length: 0.32, depth: 0.065, rTop: 0.009, rBot: 0.016, segments: 8, stringMat: sinew, stringR: 0.0026 });
        this._bowGrip(group, marrow, sinew, { r: 0.018, shelf: false });
        // The joints, which is what tells you it is a rib and not a stave.
        const joints = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < joints; i++) {
          const t = (i / (joints - 1) - 0.5) * 1.9;
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, this.seg(8, 5), this.seg(6, 4)), bone);
          knob.position.set(0, t * 0.22, -Math.sin(Math.abs(t) * 2.0) * 0.065);
          knob.scale.set(1.2, 0.8, 1);
          group.add(knob);
        }
        const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.07, 0.02), bone);
        sternum.position.z = -0.004;
        group.add(sternum);
        for (const dir of [1, -1]) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.006, 0.026, this.seg(9, 6)), iron);
          cap.position.set(0, dir * 0.31, 0.005);
          cap.rotation.x = dir * 0.3;
          group.add(cap);
          const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, this.seg(6, 4)), bone);
          tooth.position.set(0, dir * 0.2, -0.075);
          tooth.rotation.x = dir * 1.2;
          group.add(tooth);
        }
        return group;
      },

      // ---- 360: Mind Arrow Bow ------------------------------------------------
      createMindArrowBowModel(weapon, rand) {
        const group = new THREE.Group();
        const pale = this._mat(0xC8C0D8, { roughness: 0.4, metalness: 0.3 });
        const nerve = this._mat(0xE8A8C0, { roughness: 0.6, metalness: 0.1 });
        const psi = this._glow(0xE86AFF, 1.1);
        // The arrow is a thought, and the bow is the part of the head that
        // holds it: soft tissue over a pale frame.
        this._bowLimbs(group, pale, { length: 0.28, depth: 0.06, recurve: -0.5, rTop: 0.009, rBot: 0.013, stringMat: psi, stringR: 0.002 });
        this._bowGrip(group, nerve, null, { r: 0.017, shelf: false });
        // Folds, like a cortex, over the grip and the inner limbs.
        const folds = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < folds; i++) {
          const t = (i / (folds - 1) - 0.5) * 1.4;
          const f = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.005, this.seg(5, 4), this.seg(11, 7), Math.PI * 1.3), nerve);
          f.position.set(0, t * 0.14, -Math.sin(Math.abs(t) * 2.0) * 0.05);
          f.rotation.set(t * 0.4, i * 0.7, 0);
          group.add(f);
        }
        const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(12, 7), this.seg(9, 6)), pale);
        eyeball.position.set(0, 0.0, 0.03);
        group.add(eyeball);
        const iris = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(9, 6), this.seg(7, 5)), psi);
        iris.position.set(0, 0.0, 0.043);
        iris.userData.pulse = { min: 0.4, max: 1.2, freq: 1.0 };
        group.add(iris);
        // The nocked thought, half-formed.
        const thought = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.16, this.seg(7, 5)), psi);
        thought.rotation.x = Math.PI / 2;
        thought.position.set(0, 0.0, 0.09);
        thought.userData.pulse = { min: 0.3, max: 1.1, freq: 1.6 };
        group.add(thought);
        const halos = this.isLowDetail() ? 2 : 3;
        for (let i = 0; i < halos; i++) {
          const h = new THREE.Mesh(new THREE.TorusGeometry(0.02 + i * 0.008, 0.0015, this.seg(4, 3), this.seg(14, 8)), psi);
          h.position.set(0, 0, 0.05 + i * 0.03);
          h.rotation.y = Math.PI / 2;
          h.userData.spin = { axis: 'z', speed: 0.5 + i * 0.3 };
          group.add(h);
        }
        return group;
      },

      // ---- 361: Spellbreaker Crossbow -----------------------------------------
      createSpellbreakerCrossbowModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.88 });
        const iron = this._mat(0x3A3F45, { roughness: 0.7, metalness: 0.6 });
        const wood = this._wood(0x3A2A1C);
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        const nul = this._glow(0xE8E4FF, 0.7);
        this._crossbowFrame(group, steel, cord, wood, { span: 0.13, stockLen: 0.26, boltMat: steel, tipMat: steel });
        // Built against magic, not with it: cold iron bands, a lead-lined
        // channel, and a bolt head cut to interrupt rather than pierce.
        const bands = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < bands; i++) {
          const b = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.005, this.seg(4, 3), this.seg(12, 7)), iron);
          b.position.set(0, 0.01, -0.1 + i * 0.05);
          group.add(b);
        }
        const lead = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.17), iron);
        lead.position.set(0, 0.034, 0.06);
        group.add(lead);
        // The head: a hollow ring, which is the point of it.
        const cutter = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, this.seg(4, 3), this.seg(12, 7)), steel);
        cutter.position.set(0, 0.033, 0.16);
        cutter.rotation.y = Math.PI / 2;
        group.add(cutter);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const prong = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.018, this.seg(5, 4)), steel);
          prong.position.set(Math.cos(a) * 0.012, 0.033 + Math.sin(a) * 0.012, 0.172);
          prong.rotation.x = Math.PI / 2;
          group.add(prong);
        }
        const wardPlate = this._plate([[-0.02, 0], [0.02, 0], [0.024, 0.03], [0, 0.04], [-0.024, 0.03]], 0.004, iron);
        wardPlate.position.set(0, 0.03, -0.11);
        wardPlate.rotation.x = Math.PI / 2;
        group.add(wardPlate);
        const sigil = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.002, this.seg(4, 3), this.seg(10, 6)), nul);
        sigil.position.set(0, 0.03, -0.113);
        sigil.rotation.y = Math.PI / 2;
        sigil.userData.pulse = { min: 0.15, max: 0.7, freq: 0.5 };
        group.add(sigil);
        return group;
      },

      // ---- 362: Soulstring Bow ------------------------------------------------
      createSoulstringBowModel(weapon, rand) {
        const group = new THREE.Group();
        const bone = this._mat(0xC8C0A8, { roughness: 0.7, metalness: 0.04 });
        const shroud = this._mat(0x4A4458, { roughness: 0.8, metalness: 0.06 });
        const soul = this._glow(0x8AE8C8, 1.1);
        // The string is the last of somebody, and it is still audible: the
        // limbs are bone, wrapped in what they were buried in.
        this._bowLimbs(group, bone, { length: 0.3, depth: 0.065, rTop: 0.009, rBot: 0.014, stringMat: soul, stringR: 0.0024 });
        this._bowGrip(group, shroud, bone, { r: 0.017, shelf: false });
        const faces = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < faces; i++) {
          const t = (i / (faces - 1) - 0.5) * 1.8;
          const skull = new THREE.Mesh(new THREE.SphereGeometry(0.013, this.seg(9, 6), this.seg(7, 5)), bone);
          skull.scale.set(0.8, 1, 1.1);
          skull.position.set(0, t * 0.2, -Math.sin(Math.abs(t) * 2.0) * 0.062);
          group.add(skull);
          for (const s of [-1, 1]) {
            const socket = new THREE.Mesh(new THREE.SphereGeometry(0.004, this.seg(6, 4), this.seg(5, 3)), soul);
            socket.position.set(s * 0.005, t * 0.2 + 0.004, -Math.sin(Math.abs(t) * 2.0) * 0.062 + 0.01);
            socket.userData.pulse = { min: 0.2, max: 1.0, freq: 0.6 + i * 0.2, phase: i };
            group.add(socket);
          }
        }
        const wisps = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < wisps; i++) {
          const w = new THREE.Mesh(new THREE.SphereGeometry(0.005, this.seg(6, 4), this.seg(4, 3)), soul);
          w.position.set((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.5, -0.02 + rand() * 0.04);
          w.userData.bob = { amp: 0.02, freq: 0.5 + rand() * 0.6, phase: i };
          group.add(w);
        }
        const nockedSoul = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.18, this.seg(7, 5)), soul);
        nockedSoul.rotation.x = Math.PI / 2;
        nockedSoul.position.set(0, 0.0, 0.08);
        nockedSoul.userData.pulse = { min: 0.35, max: 1.15, freq: 1.2 };
        group.add(nockedSoul);
        return group;
      },

      // ---- 363: Moonlight Bow -------------------------------------------------
      createMoonlightBowModel(weapon, rand) {
        const group = new THREE.Group();
        const silver = this._mat(0xC8D0DC, { roughness: 0.25, metalness: 0.9 });
        const pale = this._mat(0xE8ECF4, { roughness: 0.35, metalness: 0.5 });
        const moon = this._glow(0xDCE8FF, 1.0);
        const night = this._mat(0x2A2E44, { roughness: 0.5, metalness: 0.3 });
        // A crescent held open: the limbs are one thin arc of silver and the
        // string is the line of light across it.
        this._bowLimbs(group, silver, { length: 0.32, depth: 0.08, rTop: 0.007, rBot: 0.012, segments: 9, stringMat: moon, stringR: 0.0018 });
        this._bowGrip(group, night, null, { r: 0.015, shelf: false });
        // The disc behind the grip, going through its phases.
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.05, this.seg(20, 11)), moon);
        disc.position.set(0, 0, -0.05);
        disc.rotation.y = Math.PI / 2;
        disc.userData.pulse = { min: 0.25, max: 0.75, freq: 0.35 };
        group.add(disc);
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.046, this.seg(20, 11)), night);
        shadow.position.set(0.002, 0.012, -0.05);
        shadow.rotation.y = Math.PI / 2;
        shadow.userData.orbit = { radius: 0.03, speed: 0.25, plane: 'yz' };
        group.add(shadow);
        const stars = this.isLowDetail() ? 4 : 9;
        for (let i = 0; i < stars; i++) {
          const t = (i / (stars - 1) - 0.5) * 2;
          const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.005, 0), pale);
          st.position.set(0, t * 0.24, -Math.sin(Math.abs(t) * 2.0) * 0.08 - 0.012);
          st.userData.spin = { axis: 'x', speed: 0.4 + i * 0.1 };
          group.add(st);
        }
        for (const dir of [1, -1]) {
          const horn = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.05, this.seg(7, 5)), pale);
          horn.position.set(0, dir * 0.335, 0.01);
          horn.rotation.x = dir * -0.4 + (dir > 0 ? 0 : Math.PI);
          group.add(horn);
        }
        return group;
      },

      // ---- 364: Spellseeker Bow -----------------------------------------------
      createSpellseekerBowModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x4A3A5B);
        const brass = this._mat(0xC8A23A, { roughness: 0.35, metalness: 0.85 });
        const lens = this._mat(0x8AD8E8, { roughness: 0.1, metalness: 0.2, opacity: 0.6, transparent: true });
        const seek = this._glow(0xFFD94F, 1.1);
        const cord = this._mat(0xD8CFA8, { roughness: 0.85, metalness: 0.05 });
        // It finds the target itself: an armature of brass rings above the
        // grip that keeps turning until they all agree.
        this._bowLimbs(group, wood, { length: 0.28, depth: 0.06, recurve: -0.5, stringMat: cord, serving: true });
        this._bowGrip(group, wood, brass, { r: 0.016 });
        const gimbal = new THREE.Group();
        gimbal.position.set(0, 0.06, 0.02);
        group.add(gimbal);
        for (let i = 0; i < 3; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.03 - i * 0.007, 0.0025, this.seg(4, 3), this.seg(16, 9)), brass);
          r.rotation.set(i === 0 ? 0 : Math.PI / 2, i === 2 ? Math.PI / 2 : 0, 0);
          r.userData.spin = { axis: ['y', 'x', 'z'][i], speed: 0.5 + i * 0.35 };
          gimbal.add(r);
        }
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, this.seg(11, 7), this.seg(8, 5)), lens);
        gimbal.add(eye);
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(8, 5), this.seg(6, 4)), seek);
        spark.userData.pulse = { min: 0.4, max: 1.2, freq: 1.5 };
        gimbal.add(spark);
        // The beam it puts on whatever it has decided about.
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.004, 0.22, this.seg(6, 4)), seek);
        beam.rotation.x = Math.PI / 2;
        beam.position.set(0, 0.06, 0.14);
        beam.userData.pulse = { min: 0.15, max: 0.6, freq: 2.0 };
        group.add(beam);
        const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, this.seg(6, 4)), wood);
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, 0.014, 0.04);
        group.add(arrow);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.024, this.seg(7, 5)), brass);
        head.rotation.x = Math.PI / 2;
        head.position.set(0, 0.014, 0.162);
        group.add(head);
        return group;
      },

      // ---- 365: Bull Totem Bow ------------------------------------------------
      createBullTotemBowModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6B4423);
        const hide = this._mat(0x3A2A1C, { roughness: 0.9, metalness: 0.03 });
        const bhorn = this._mat(0xE0D6C0, { roughness: 0.5, metalness: 0.08 });
        const ochreColor = this.getRandomColor(rand, [0xC0522A, 0xD8A02A, 0xA83A2A]);
        const ochre = this._mat(ochreColor, { roughness: 0.85, metalness: 0.04 });
        const cord = this._mat(0xC8B48A, { roughness: 0.9, metalness: 0.03 });
        // The limbs are a bull's horns, mounted either side of a carved head,
        // and the whole thing is a shrine that happens to shoot.
        this._bowLimbs(group, bhorn, { length: 0.26, depth: 0.09, recurve: -1.2, rTop: 0.008, rBot: 0.018, stringMat: cord, stringR: 0.003 });
        this._bowGrip(group, wood, hide, { r: 0.019, shelf: false });
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.04), wood);
        head.position.set(0, 0.0, 0.02);
        group.add(head);
        const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.03, 0.03), wood);
        muzzle.position.set(0, -0.03, 0.03);
        group.add(muzzle);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(8, 5), this.seg(6, 4)), ochre);
          eye.position.set(s * 0.016, 0.015, 0.04);
          group.add(eye);
        }
        const nosering = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, this.seg(4, 3), this.seg(12, 7)), bhorn);
        nosering.position.set(0, -0.045, 0.03);
        nosering.rotation.y = Math.PI / 2;
        nosering.userData.sway = { axis: 'x', amp: 0.25, freq: 1.1 };
        group.add(nosering);
        // Fetishes hung off the limbs: teeth, beads, a strip of hide.
        const charms = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < charms; i++) {
          const t = (i / (charms - 1) - 0.5) * 1.6;
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.02, this.seg(5, 4)), i % 2 ? bhorn : ochre);
          c.position.set(0.012, t * 0.18 - 0.02, -Math.sin(Math.abs(t) * 2.0) * 0.085);
          c.rotation.x = Math.PI;
          c.userData.sway = { axis: 'z', amp: 0.22, freq: 1.0 + i * 0.2, phase: i };
          group.add(c);
        }
        const paint = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < paint; i++) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, this.seg(4, 3), this.seg(10, 6)), ochre);
          band.position.set(0, 0.14 * (i % 2 ? 1 : -1) + (i > 1 ? 0.04 : 0), -0.05);
          band.rotation.y = Math.PI / 2;
          group.add(band);
        }
        return group;
      },

      // ---- 366: EHI Identity Eraser -------------------------------------------
      createIdentityEraserModel(weapon, rand) {
        const group = new THREE.Group();
        const corporate = this._mat(0xE8E4DC, { roughness: 0.4, metalness: 0.25 });
        const accent = this._mat(0x1E4A8B, { roughness: 0.5, metalness: 0.4 });
        const grey = this._mat(0x6E7378, { roughness: 0.5, metalness: 0.75 });
        const blank = this._glow(0xF0F4FF, 1.0);
        // EHI never says what the product does, only that it is compliant.
        // Moulded shell, service panel, and an emitter where the arrow goes.
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.26, 0.036), corporate);
        group.add(spine);
        for (const dir of [1, -1]) {
          const limb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.018), corporate);
          limb.position.set(0, dir * 0.18, -0.03);
          limb.rotation.x = dir * 0.4;
          group.add(limb);
          const tipCap = new THREE.Mesh(new THREE.SphereGeometry(0.014, this.seg(11, 7), this.seg(8, 5)), accent);
          tipCap.position.set(0, dir * 0.24, -0.075);
          group.add(tipCap);
          const emit = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.005, this.seg(11, 7)), blank);
          emit.rotation.z = Math.PI / 2;
          emit.position.set(0.012, dir * 0.24, -0.075);
          emit.userData.pulse = { min: 0.3, max: 1.0, freq: 1.1, phase: dir > 0 ? 0 : 1 };
          group.add(emit);
        }
        // The "string" is a field between the caps, so it never wears out and
        // never needs servicing, which is in the brochure.
        const field = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.48, this.seg(6, 4)), blank);
        field.position.z = -0.075;
        field.userData.pulse = { min: 0.4, max: 0.9, freq: 0.8 };
        group.add(field);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.05, 0.006), grey);
        panel.position.set(0, 0.06, 0.019);
        group.add(panel);
        const label = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.024, 0.002), accent);
        label.position.set(0, -0.07, 0.02);
        group.add(label);
        const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.05, this.seg(13, 8)), grey);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position.set(0, 0.0, 0.06);
        group.add(muzzle);
        const nothing = new THREE.Mesh(new THREE.CircleGeometry(0.015, this.seg(14, 8)), blank);
        nothing.position.set(0, 0.0, 0.086);
        nothing.userData.pulse = { min: 0.2, max: 1.1, freq: 0.6 };
        group.add(nothing);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.06, 0.03), grey);
        grip.position.set(0, -0.02, 0.014);
        group.add(grip);
        return group;
      },

      // ---- 367: Varlenia Energy Bow -------------------------------------------
      createVarleniaEnergyBowModel(weapon, rand) {
        const group = new THREE.Group();
        const shell = this._mat(0xD8C070, { roughness: 0.3, metalness: 0.85 });
        const trim = this._mat(0xF0DFA0, { roughness: 0.2, metalness: 0.95 });
        const core = this._glow(0xFFE07A, 1.2);
        // Varlenia issue: everything on it is gilded and the limbs are two
        // arms of contained light, held apart by the frame.
        const riser = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.2, 0.034), shell);
        group.add(riser);
        for (let i = 0; i < 3; i++) {
          const flute = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.03, 0.014), trim);
          flute.position.set(0, -0.05 + i * 0.05, 0);
          group.add(flute);
        }
        for (const dir of [1, -1]) {
          const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.024), trim);
          yoke.position.set(0, dir * 0.13, -0.014);
          yoke.rotation.x = dir * 0.3;
          group.add(yoke);
          const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(12, 7), this.seg(9, 6)), trim);
          emitter.position.set(0, dir * 0.165, -0.032);
          group.add(emitter);
          // The limb itself: an arc of energy, not a stave.
          const n = this.seg(6, 4);
          for (let i = 0; i < n; i++) {
            const t = i / n, t2 = (i + 1) / n;
            const p1 = new THREE.Vector3(0, dir * (0.165 + t * 0.14), -0.032 - Math.sin(t * 1.6) * 0.05);
            const p2 = new THREE.Vector3(0, dir * (0.165 + t2 * 0.14), -0.032 - Math.sin(t2 * 1.6) * 0.05);
            const d = p2.clone().sub(p1);
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, d.length() * 1.1, this.seg(7, 5)), core);
            seg.position.copy(p1).add(p2).multiplyScalar(0.5);
            seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
            seg.userData.pulse = { min: 0.5, max: 1.2, freq: 1.0, phase: i };
            group.add(seg);
          }
        }
        const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.56, this.seg(6, 4)), core);
        string.position.z = -0.11;
        string.userData.pulse = { min: 0.5, max: 1.3, freq: 1.4 };
        group.add(string);
        const nocked = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.2, this.seg(7, 5)), core);
        nocked.rotation.x = Math.PI / 2;
        nocked.position.set(0, 0.0, 0.05);
        nocked.userData.pulse = { min: 0.4, max: 1.2, freq: 1.8 };
        group.add(nocked);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.08, this.seg(12, 7)), shell);
        grip.position.set(0, -0.01, 0.012);
        group.add(grip);
        const crest = this._plate([[-0.014, 0], [0.014, 0], [0, 0.03]], 0.004, trim);
        crest.position.set(0, 0.05, 0.02);
        crest.rotation.x = Math.PI / 2;
        group.add(crest);
        return group;
      },

      // ---- 368: EHI Brain Hemorrhager -----------------------------------------
      createBrainHemorrhagerModel(weapon, rand) {
        const group = new THREE.Group();
        const corporate = this._mat(0xE8E4DC, { roughness: 0.4, metalness: 0.25 });
        const accent = this._mat(0x1E4A8B, { roughness: 0.5, metalness: 0.4 });
        const grey = this._mat(0x6E7378, { roughness: 0.5, metalness: 0.75 });
        const hazard = this._mat(0xD8B02A, { roughness: 0.55, metalness: 0.3 });
        const pressure = this._glow(0xFF4A5A, 1.2);
        // The same product line as 366, one model up: two pressure vessels
        // where the limbs would be, and a gauge that is never in the green.
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.04), corporate);
        group.add(spine);
        for (const dir of [1, -1]) {
          const vessel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, this.seg(12, 7)), corporate);
          vessel.position.set(0, dir * 0.18, -0.02);
          vessel.rotation.x = dir * 0.35;
          group.add(vessel);
          const ribs = this.isLowDetail() ? 2 : 4;
          for (let i = 0; i < ribs; i++) {
            const rib = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.004, this.seg(4, 3), this.seg(12, 7)), grey);
            rib.position.set(0, dir * (0.145 + i * 0.024), -0.02 - i * 0.008 * dir * dir);
            rib.rotation.x = Math.PI / 2 + dir * 0.35;
            group.add(rib);
          }
          const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.016, this.seg(10, 6)), accent);
          valve.position.set(0.02, dir * 0.2, -0.03);
          valve.rotation.z = Math.PI / 2;
          valve.userData.spin = { axis: 'x', speed: dir * 0.9 };
          group.add(valve);
          const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, this.seg(8, 5)), grey);
          hose.position.set(0.014, dir * 0.12, -0.006);
          hose.rotation.z = 0.2 * dir;
          group.add(hose);
        }
        const field = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.46, this.seg(6, 4)), pressure);
        field.position.z = -0.062;
        field.userData.pulse = { min: 0.45, max: 1.2, freq: 2.4 };
        group.add(field);
        // The gauge, whose needle sits past the last mark.
        const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.008, this.seg(14, 8)), grey);
        gauge.rotation.z = Math.PI / 2;
        gauge.position.set(0.018, 0.05, 0.02);
        group.add(gauge);
        const needle = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.016, 0.002), pressure);
        needle.position.set(0.023, 0.056, 0.02);
        needle.rotation.x = 0.4;
        needle.userData.sway = { axis: 'x', amp: 0.3, freq: 3.0 };
        group.add(needle);
        const warn = this._plate([[-0.014, 0], [0.014, 0], [0, 0.024]], 0.003, hazard);
        warn.position.set(0, -0.06, 0.022);
        warn.rotation.x = Math.PI / 2;
        group.add(warn);
        const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.06, this.seg(13, 8)), grey);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position.set(0, 0.0, 0.07);
        group.add(muzzle);
        const bore = new THREE.Mesh(new THREE.CircleGeometry(0.012, this.seg(14, 8)), pressure);
        bore.position.set(0, 0.0, 0.101);
        bore.userData.pulse = { min: 0.3, max: 1.2, freq: 1.7 };
        group.add(bore);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.062, 0.032), grey);
        grip.position.set(0, -0.025, 0.016);
        group.add(grip);
        this._gunTrigger(group, grey, 0, -0.05, 0.03, { guardR: 0.018 });
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
      }
    }
  });
})();
