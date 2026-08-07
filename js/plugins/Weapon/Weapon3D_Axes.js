//=============================================================================
// Weapon 3D Models - Axes
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Procedural 3D models for axes. Loaded
 * automatically by WeaponSystemProcedural.js.
 * @author AntiGravity
 *
 * @help
 * ============================================================================
 * Weapon 3D Models - Axes
 * ============================================================================
 *
 * One family per weapon type. This one owns every Axe weapon (wtypeId 4):
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
    console.error('[Weapon3D_Axes] WeaponSystemProcedural not loaded');
    return;
  }

  window.WeaponSystemProcedural.registerFamily({
    name: 'Weapon3D_Axes',
    unique: {
      197: 'createFoamToyAxeModel',                  // Foam Toy Axe
      198: 'createRustySickleModel',                 // Rusty Sickle
      199: 'createPracticeAxeModel',                 // Practice Axe
      200: 'createBudgetAxeModel',                   // Budget Axe
      201: 'createStoneAxeModel',                    // Stone Axe
      202: 'createSharpenedShovelModel',             // Sharpened Shovel
      203: 'createMowerBladeAxeModel',               // Mower Blade Axe
      204: 'createHubcapAxeModel',                   // Hubcap Axe
      205: 'createRazorFireAxeModel',                // Razor Fire Axe
      206: 'createSeedAxeModel',                     // Seed Axe
      207: 'createHandAxeModel',                     // Hand Axe
      208: 'createEgyptianAxeModel',                 // Egyptian Axe
      209: 'createFranciscaModel',                   // Francisca
      210: 'createBattleAxeModel',                   // Battle Axe
      212: 'createTrashCanLidModel',                 // Trash Can Lid
      213: 'createBardicheModel',                    // Bardiche
      214: 'createBreakawayTableModel',              // Breakaway Table
      215: 'createRingBellModel',                    // Ring Bell
      216: 'createSteelLadderModel',                 // Steel Ladder
      217: 'createMithrilAxeModel',                  // Mithril Axe
      218: 'createBoundElementalAxeModel',           // Bound Elemental Axe
      219: 'createVolcanicGreataxeModel',            // Volcanic Greataxe
      220: 'createGravityCrusherModel',              // Gravity Crusher
      221: 'createSoulCleaverModel',                 // Soul Cleaver
      222: 'createDragonAxeModel',                   // Dragon Axe
      223: 'createPlanarDividerModel',               // Planar Divider
      224: 'createPetrocorruptorModel',              // EHI Petrocorruptor
      225: 'createVarleniaCleaverModel',             // Varlenia Cleaver
      226: 'createDimensionalCleaverModel'           // Dimensional Cleaver
    },
    models: {
      /**
       * A haft, running up +Y with the grip below the origin. Everything in
       * this family hangs a head off the top of one.
       * @param opts { len, r, rTop, top, wrapMat, buttMat, butt, curve }
       * @returns the y of the top of the haft.
       */
      _axeHaft(group, mat, opts) {
        const o = opts || {};
        const len = o.len || 0.55;
        const top = o.top === undefined ? 0.2 : o.top;
        const r = o.r || 0.017;
        if (o.curve) {
          // A curved haft is the mark of a felling axe: it is built out of
          // short segments leaning progressively back.
          const n = this.seg(6, 4);
          const up = new THREE.Vector3(0, 1, 0);
          for (let i = 0; i < n; i++) {
            const t = i / n, t2 = (i + 1) / n;
            const p1 = new THREE.Vector3(-Math.sin(t * 2.4) * o.curve, top - len + t * len, 0);
            const p2 = new THREE.Vector3(-Math.sin(t2 * 2.4) * o.curve, top - len + t2 * len, 0);
            const d = p2.clone().sub(p1);
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(
              r * (0.85 + t * 0.2), r * (0.85 + t * 0.2), d.length() * 1.08, this.seg(9, 6)), mat);
            seg.position.copy(p1).add(p2).multiplyScalar(0.5);
            seg.quaternion.setFromUnitVectors(up, d.clone().normalize());
            group.add(seg);
          }
        } else {
          const haft = new THREE.Mesh(new THREE.CylinderGeometry(o.rTop || r, r, len, this.seg(10, 6)), mat);
          haft.position.y = top - len / 2;
          group.add(haft);
        }
        if (o.wrapMat) {
          const n = this.isLowDetail() ? 3 : 6;
          for (let i = 0; i < n; i++) {
            const w = new THREE.Mesh(new THREE.TorusGeometry(r * 1.15, 0.004, this.seg(4, 3), this.seg(10, 6)), o.wrapMat);
            w.rotation.x = Math.PI / 2;
            w.position.y = top - len * 0.55 + i * 0.028;
            group.add(w);
          }
        }
        if (o.buttMat) {
          const y = top - len;
          if (o.butt === 'spike') {
            const sp = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, 0.06, this.seg(7, 5)), o.buttMat);
            sp.rotation.x = Math.PI;
            sp.position.y = y - 0.03;
            group.add(sp);
          } else {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.1, 0.026, this.seg(10, 6)), o.buttMat);
            cap.position.y = y - 0.012;
            group.add(cap);
          }
        }
        return top;
      },

      /**
       * A bearded axe head with an eye around the haft. Points are given in
       * the X-Y plane with the edge toward +X.
       * @param opts { width, depth, beard, thickness, eyeMat, edgeMat }
       */
      _axeHead(group, mat, y, opts) {
        const o = opts || {};
        const w = o.width || 0.14;
        const h = o.depth || 0.16;
        const beard = o.beard === undefined ? 0.35 : o.beard;
        const pts = [
          [0, -h * 0.3], [w * 0.55, -h * 0.28 - h * beard * 0.4],
          [w, -h * beard], [w * 1.05, 0], [w, h * 0.55],
          [w * 0.5, h * 0.62], [0, h * 0.5]
        ];
        const head = this._plate(pts, o.thickness || 0.012, mat);
        head.position.y = y;
        group.add(head);
        if (o.edgeMat) {
          const edge = this._plate([[w * 0.92, -h * beard], [w * 1.05, 0], [w * 0.92, h * 0.55], [w * 0.86, 0]],
            (o.thickness || 0.012) * 1.25, o.edgeMat);
          edge.position.y = y;
          group.add(edge);
        }
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(o.eyeR || 0.024, o.eyeR || 0.024, o.eyeH || 0.075, this.seg(11, 7)),
          o.eyeMat || mat);
        eye.position.y = y + h * 0.1;
        group.add(eye);
        return head;
      },

      // ---- 197: Foam Toy Axe --------------------------------------------------
      createFoamToyAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const foamColor = this.getRandomColor(rand, [0x8A5AD8, 0x3A9BD8, 0xD8543A]);
        const foam = this._mat(foamColor, { roughness: 0.95, metalness: 0.0 });
        const grey = this._mat(0xB8BCC0, { roughness: 0.85, metalness: 0.05 });
        const yellow = this._mat(0xF5C518, { roughness: 0.8, metalness: 0.03 });
        // Party-shop foam. It has a moulded rivet line because somebody
        // thought that would make it convincing.
        const top = this._axeHaft(group, foam, { len: 0.42, r: 0.021, buttMat: yellow });
        this._axeHead(group, grey, top - 0.02, { width: 0.13, depth: 0.15, thickness: 0.03, eyeMat: foam, eyeR: 0.026 });
        const dents = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < dents; i++) {
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.014, this.seg(8, 5), this.seg(6, 4)), grey);
          d.position.set(0.05 + rand() * 0.06, top - 0.05 + rand() * 0.08, 0.017);
          d.scale.set(1, 1, 0.3);
          group.add(d);
        }
        for (let i = 0; i < 3; i++) {
          const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.034, this.seg(7, 5)), yellow);
          rv.rotation.x = Math.PI / 2;
          rv.position.set(0.03, top - 0.06 + i * 0.05, 0);
          group.add(rv);
        }
        // A crease where it has been folded in a toy box for years.
        const crease = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.032), grey);
        crease.position.set(0.06, top - 0.01, 0);
        crease.rotation.z = 0.2;
        group.add(crease);
        return group;
      },

      // ---- 198: Rusty Sickle --------------------------------------------------
      createRustySickleModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6E5230);
        const rust = this._mat(0x8A4B22, { roughness: 0.92, metalness: 0.28 });
        const steel = this._mat(0x7A7F86, { roughness: 0.7, metalness: 0.5 });
        // A harvest tool that has been in a hedge for a winter: the curve is
        // still good, the surface is not.
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, 0.16, this.seg(10, 6)), wood);
        handle.position.y = 0.11;
        group.add(handle);
        const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.024, this.seg(10, 6)), rust);
        ferrule.position.y = 0.19;
        group.add(ferrule);
        // The hook, built out of tapering segments around an arc.
        const n = this.seg(9, 5);
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < n; i++) {
          const a1 = -0.4 + (i / n) * 3.1, a2 = -0.4 + ((i + 1) / n) * 3.1;
          const R = 0.13;
          const p1 = new THREE.Vector3(Math.sin(a1) * R, 0.23 + (1 - Math.cos(a1)) * R * 0.75, 0);
          const p2 = new THREE.Vector3(Math.sin(a2) * R, 0.23 + (1 - Math.cos(a2)) * R * 0.75, 0);
          const d = p2.clone().sub(p1);
          const t = i / n;
          const seg = new THREE.Mesh(new THREE.BoxGeometry(0.005, d.length() * 1.1, 0.03 * (1 - t * 0.7)), i % 3 ? rust : steel);
          seg.position.copy(p1).add(p2).multiplyScalar(0.5);
          seg.quaternion.setFromUnitVectors(up, d.clone().normalize());
          group.add(seg);
        }
        const pits = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < pits; i++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.006 + rand() * 0.004, this.seg(6, 4), this.seg(5, 3)), rust);
          p.position.set(0.02 + rand() * 0.1, 0.24 + rand() * 0.1, 0.004);
          group.add(p);
        }
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.03), wood);
        chip.position.set(0, 0.06, 0.016);
        group.add(chip);
        return group;
      },

      // ---- 199: Practice Axe --------------------------------------------------
      createPracticeAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const pine = this._wood(0xD8B478);
        const dark = this._wood(0x8B6A3B);
        const tape = this._wood(0x33332E);
        const chalk = this._mat(0xE8E4D8, { roughness: 0.9, metalness: 0.02 });
        // All wood, edge deliberately blunt, and the pell has left its marks
        // all over the head.
        const top = this._axeHaft(group, pine, { len: 0.5, r: 0.019, buttMat: dark });
        const head = this._plate([[0, -0.05], [0.11, -0.05], [0.13, 0], [0.11, 0.08], [0, 0.08]], 0.022, pine);
        head.position.y = top - 0.02;
        group.add(head);
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.07, this.seg(11, 7)), dark);
        eye.position.y = top - 0.005;
        group.add(eye);
        const marks = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < marks; i++) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.024), dark);
          m.position.set(0.06 + rand() * 0.06, top - 0.05 + rand() * 0.11, 0.011);
          m.rotation.z = (rand() - 0.5) * 1.2;
          group.add(m);
        }
        const chalkMark = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.008, 0.024), chalk);
        chalkMark.position.set(0.08, top - 0.01, 0.012);
        group.add(chalkMark);
        for (let i = 0; i < 3; i++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.005, this.seg(4, 3), this.seg(10, 6)), tape);
          t.rotation.x = Math.PI / 2;
          t.position.y = top - 0.12 - i * 0.03;
          group.add(t);
        }
        return group;
      },

      // ---- 200: Budget Axe ----------------------------------------------------
      createBudgetAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const glass = this._mat(0xE85A2A, { roughness: 0.55, metalness: 0.08 });
        const rubber = this._mat(0x2A2A2E, { roughness: 0.9, metalness: 0.03 });
        const steel = this._mat(0x7A7F86, { roughness: 0.6, metalness: 0.6 });
        const paint = this._mat(0x3A3F45, { roughness: 0.75, metalness: 0.35 });
        // Hardware-shop own brand: fibreglass handle, painted head, and the
        // paint is already coming off the edge.
        const top = this._axeHaft(group, glass, { len: 0.46, r: 0.017 });
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.023, 0.16, this.seg(10, 6)), rubber);
        grip.position.y = top - 0.38;
        group.add(grip);
        const ridges = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < ridges; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.003, this.seg(4, 3), this.seg(10, 6)), rubber);
          r.rotation.x = Math.PI / 2;
          r.position.y = top - 0.33 - i * 0.026;
          group.add(r);
        }
        this._axeHead(group, paint, top - 0.02, { width: 0.115, depth: 0.14, beard: 0.2, edgeMat: steel, eyeMat: paint });
        // The sticker nobody peeled off.
        const sticker = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.002), this._mat(0xE8E400, { roughness: 0.6, metalness: 0.05 }));
        sticker.position.set(0.045, top - 0.05, 0.007);
        group.add(sticker);
        const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.01, 0.03), steel);
        wedge.position.y = top + 0.03;
        group.add(wedge);
        return group;
      },

      // ---- 201: Stone Axe -----------------------------------------------------
      createStoneAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const branch = this._wood(0x6E5230);
        const stone = this._mat(0x6A6A70, { roughness: 0.85, metalness: 0.08 });
        const pale = this._mat(0x8A8A90, { roughness: 0.7, metalness: 0.1 });
        const sinew = this._mat(0xC8B48A, { roughness: 0.95, metalness: 0.02 });
        // Ground stone in a split branch, lashed with sinew. The flaking is
        // the only shaping it has had.
        const top = this._axeHaft(group, branch, { len: 0.44, r: 0.021, rTop: 0.019 });
        const head = this._plate([[-0.03, -0.03], [0.09, -0.05], [0.115, 0.01], [0.085, 0.07], [-0.03, 0.05]], 0.03, stone);
        head.position.y = top - 0.01;
        head.rotation.z = 0.08;
        group.add(head);
        const flakes = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < flakes; i++) {
          const f = new THREE.Mesh(new THREE.TetrahedronGeometry(0.012 + rand() * 0.008, 0), pale);
          f.position.set(0.02 + rand() * 0.08, top - 0.04 + rand() * 0.1, 0.014);
          f.rotation.set(rand() * 3, rand() * 3, rand() * 3);
          group.add(f);
        }
        // The split in the haft that holds the head, and the lashings.
        const split = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.09, 0.04), branch);
        split.position.set(-0.024, top - 0.01, 0);
        group.add(split);
        for (let i = 0; i < 5; i++) {
          const l = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.004, this.seg(4, 3), this.seg(11, 7)), sinew);
          l.rotation.set(Math.PI / 2, 0, (rand() - 0.5) * 0.3);
          l.position.y = top - 0.05 + i * 0.024;
          group.add(l);
        }
        return group;
      },

      // ---- 202: Sharpened Shovel ----------------------------------------------
      createSharpenedShovelModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0xC8A870);
        const steel = this._mat(0x7A7F86, { roughness: 0.55, metalness: 0.68 });
        const bright = this._mat(0xC0C6CC, { roughness: 0.25, metalness: 0.92 });
        const dirt = this._wood(0x5B4A32);
        // A spade taken to a grinder along both edges. The D-grip and the
        // tread are untouched, and there is still soil in the socket.
        const top = this._axeHaft(group, ash, { len: 0.62, r: 0.018 });
        // The D-handle at the bottom.
        const dArm = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, this.seg(5, 4), this.seg(13, 8), Math.PI), ash);
        dArm.position.y = top - 0.63;
        dArm.rotation.set(0, Math.PI / 2, Math.PI);
        group.add(dArm);
        const dBar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, this.seg(8, 5)), ash);
        dBar.rotation.z = Math.PI / 2;
        dBar.position.y = top - 0.66;
        group.add(dBar);
        const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.09, this.seg(11, 7)), steel);
        socket.position.y = top - 0.02;
        group.add(socket);
        const blade = this._plate([[-0.07, 0], [0.07, 0], [0.075, 0.11], [0.05, 0.17], [-0.05, 0.17], [-0.075, 0.11]], 0.006, steel);
        blade.position.y = top + 0.01;
        group.add(blade);
        // The ground edges, which is what makes it a weapon.
        for (const s of [-1, 1]) {
          const e = this._plate([[s * 0.062, 0.0], [s * 0.075, 0.11], [s * 0.05, 0.17], [s * 0.05, 0.02]], 0.008, bright);
          e.position.y = top + 0.01;
          group.add(e);
        }
        const tread = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.014), steel);
        tread.position.set(0, top + 0.02, -0.005);
        group.add(tread);
        const clods = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < clods; i++) {
          const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.009, 0), dirt);
          c.position.set((rand() - 0.5) * 0.09, top + 0.06 + rand() * 0.08, -0.006);
          group.add(c);
        }
        return group;
      },

      // ---- 203: Mower Blade Axe -----------------------------------------------
      createMowerBladeAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const pipe = this._mat(0x8A9096, { roughness: 0.6, metalness: 0.72 });
        const blade = this._mat(0x6E7378, { roughness: 0.5, metalness: 0.78 });
        const bright = this._mat(0xC0C6CC, { roughness: 0.25, metalness: 0.92 });
        const green = this._mat(0x4A7A2A, { roughness: 0.9, metalness: 0.03 });
        const tape = this._wood(0x33332E);
        // The blade out of a rotary mower, still with its centre boss and the
        // dried cuttings on it, bolted to a length of pipe.
        const top = this._axeHaft(group, pipe, { len: 0.5, r: 0.016, buttMat: pipe });
        const bar = this._plate([[-0.13, -0.014], [0.13, -0.014], [0.13, 0.014], [-0.13, 0.014]], 0.005, blade);
        bar.position.y = top;
        group.add(bar);
        for (const s of [-1, 1]) {
          const lift = this._plate([[s * 0.08, -0.014], [s * 0.13, -0.014], [s * 0.13, 0.03], [s * 0.09, 0.02]], 0.005, blade);
          lift.position.y = top;
          lift.rotation.x = s * 0.35;
          group.add(lift);
          const edge = this._plate([[s * 0.06, -0.014], [s * 0.13, -0.02], [s * 0.13, -0.008], [s * 0.06, -0.004]], 0.007, bright);
          edge.position.y = top;
          group.add(edge);
        }
        const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, this.seg(12, 7)), blade);
        boss.rotation.x = Math.PI / 2;
        boss.position.y = top;
        group.add(boss);
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6), pipe);
        bolt.rotation.x = Math.PI / 2;
        bolt.position.y = top;
        group.add(bolt);
        const clippings = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < clippings; i++) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.003, 0.004), green);
          c.position.set((rand() - 0.5) * 0.2, top + (rand() - 0.5) * 0.02, 0.005);
          c.rotation.z = (rand() - 0.5) * 1.5;
          group.add(c);
        }
        for (let i = 0; i < 4; i++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, this.seg(4, 3), this.seg(10, 6)), tape);
          t.rotation.x = Math.PI / 2;
          t.position.y = top - 0.04 - i * 0.024;
          group.add(t);
        }
        return group;
      },

      // ---- 204: Hubcap Axe ----------------------------------------------------
      createHubcapAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const chrome = this._mat(0xC8CED4, { roughness: 0.25, metalness: 0.93 });
        const pipe = this._mat(0x6E7378, { roughness: 0.65, metalness: 0.65 });
        const grime = this._mat(0x4A4238, { roughness: 0.95, metalness: 0.1 });
        const tape = this._wood(0x33332E);
        // A wheel trim off a parked car, edge ground to a bevel, jammed onto
        // a pipe. It still has the maker's badge in the middle.
        const top = this._axeHaft(group, pipe, { len: 0.48, r: 0.016, buttMat: pipe });
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.02, this.seg(18, 10)), chrome);
        dish.rotation.x = Math.PI / 2;
        dish.position.y = top + 0.05;
        group.add(dish);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.006, this.seg(5, 4), this.seg(20, 11)), chrome);
        rim.position.y = top + 0.05;
        group.add(rim);
        const spokes = this.isLowDetail() ? 5 : 9;
        for (let i = 0; i < spokes; i++) {
          const a = (i / spokes) * Math.PI * 2;
          const sp = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.07, 0.012), chrome);
          sp.position.set(Math.cos(a) * 0.06, top + 0.05 + Math.sin(a) * 0.06, 0);
          sp.rotation.z = a + Math.PI / 2;
          group.add(sp);
        }
        const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.024, this.seg(13, 8)), grime);
        badge.rotation.x = Math.PI / 2;
        badge.position.y = top + 0.05;
        group.add(badge);
        // The bevel somebody put on the outside.
        const bevel = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.004, this.seg(4, 3), this.seg(20, 11), Math.PI), chrome);
        bevel.position.y = top + 0.05;
        bevel.rotation.z = -Math.PI / 2;
        group.add(bevel);
        const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.06, 0.03), pipe);
        clamp.position.y = top - 0.01;
        group.add(clamp);
        for (let i = 0; i < 3; i++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, this.seg(4, 3), this.seg(10, 6)), tape);
          t.rotation.x = Math.PI / 2;
          t.position.y = top - 0.05 - i * 0.026;
          group.add(t);
        }
        return group;
      },

      // ---- 205: Razor Fire Axe ------------------------------------------------
      createRazorFireAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const red = this._mat(0xC0392B, { roughness: 0.5, metalness: 0.3 });
        const black = this._mat(0x1A1C20, { roughness: 0.85, metalness: 0.1 });
        const steel = this._mat(0x8A9096, { roughness: 0.45, metalness: 0.8 });
        const bright = this._mat(0xD0D6DC, { roughness: 0.15, metalness: 0.96 });
        const strip = this._mat(0xE8E8E4, { roughness: 0.4, metalness: 0.2 });
        // Station issue, taken off the wall and given an edge it was never
        // meant to have. The reflective banding is still on the haft.
        const top = this._axeHaft(group, black, { len: 0.52, r: 0.018, buttMat: red });
        const bands = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < bands; i++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.03, this.seg(10, 6)), strip);
          b.position.y = top - 0.14 - i * 0.1;
          group.add(b);
        }
        this._axeHead(group, red, top - 0.02, { width: 0.13, depth: 0.16, beard: 0.3, edgeMat: bright, eyeMat: red });
        // The pick on the back, which is what a fire axe is really for.
        const pick = this._plate([[0, -0.02], [-0.1, -0.04], [-0.14, 0.0], [-0.09, 0.005], [0, 0.03]], 0.012, red);
        pick.position.y = top - 0.02;
        group.add(pick);
        const pickTip = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, this.seg(6, 4)), steel);
        pickTip.rotation.z = Math.PI / 2;
        pickTip.position.set(-0.15, top - 0.04, 0);
        group.add(pickTip);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, this.seg(10, 6)), black);
        grip.position.y = top - 0.42;
        group.add(grip);
        const scores = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < scores; i++) {
          const s = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.002, this.seg(4, 3), this.seg(10, 6)), steel);
          s.rotation.x = Math.PI / 2;
          s.position.y = top - 0.37 - i * 0.022;
          group.add(s);
        }
        return group;
      },

      // ---- 206: Seed Axe ------------------------------------------------------
      createSeedAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const living = this._wood(0x6E8B3A);
        const bark = this._wood(0x4A5B28);
        const shell = this._mat(0xC8A02A, { roughness: 0.5, metalness: 0.12 });
        const leafColor = this.getRandomColor(rand, [0x4E9A3A, 0x6BBF48]);
        const leaf = this._mat(leafColor, { roughness: 0.6, metalness: 0.05 });
        const sap = this._glow(0xB8FF5A, 0.9);
        // The head is a seed case that hardened into an edge, and the haft it
        // grew on has not stopped growing.
        const top = this._axeHaft(group, living, { len: 0.5, r: 0.019, curve: 0.02 });
        const head = this._plate([[0, -0.05], [0.06, -0.07], [0.115, -0.02], [0.12, 0.04], [0.07, 0.08], [0, 0.07]], 0.026, shell);
        head.position.y = top - 0.01;
        group.add(head);
        const seam = this._plate([[0.02, -0.04], [0.1, -0.01], [0.1, 0.01], [0.02, 0.03]], 0.03, bark);
        seam.position.y = top - 0.01;
        group.add(seam);
        const veins = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < veins; i++) {
          const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.003, 0.028), sap);
          v.position.set(0.06, top - 0.04 + i * 0.035, 0);
          v.rotation.z = -0.2 + i * 0.12;
          v.userData.pulse = { min: 0.2, max: 0.9, freq: 0.7 + i * 0.2, phase: i };
          group.add(v);
        }
        const leaves = this.isLowDetail() ? 2 : 5;
        for (let i = 0; i < leaves; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = i * 1.3;
          const l = this._plate([[0, 0], [0.02, 0.014], [0.03, 0.04], [0.005, 0.03]], 0.003, leaf);
          l.position.set(0, top - 0.14 - i * 0.08, 0.014);
          l.rotation.z = -0.4;
          l.userData.sway = { axis: 'z', amp: 0.14, freq: 1.0 + i * 0.15, phase: i };
          holder.add(l);
          group.add(holder);
        }
        const root = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(11, 7), this.seg(8, 5)), bark);
        root.scale.y = 1.3;
        root.position.y = top - 0.52;
        group.add(root);
        return group;
      },

      // ---- 207: Hand Axe ------------------------------------------------------
      createHandAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const hickory = this._wood(0xC8A870);
        const steel = this._mat(0x7A7F86, { roughness: 0.45, metalness: 0.78 });
        const bright = this._mat(0xC0C6CC, { roughness: 0.2, metalness: 0.94 });
        const leather = this._wood(0x5B3A1E);
        // A plain working hatchet, well kept: curved hickory haft, wedged
        // eye, and a polished bit.
        const top = this._axeHaft(group, hickory, { len: 0.4, r: 0.018, curve: 0.03 });
        this._axeHead(group, steel, top - 0.015, { width: 0.1, depth: 0.13, beard: 0.3, edgeMat: bright, eyeMat: steel, eyeR: 0.023 });
        const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.04), hickory);
        wedge.position.y = top + 0.028;
        group.add(wedge);
        const steelWedge = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.01, 0.036), steel);
        steelWedge.position.y = top + 0.03;
        group.add(steelWedge);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.021, 0.02, this.seg(10, 6)), leather);
        collar.position.y = top - 0.07;
        group.add(collar);
        const swell = new THREE.Mesh(new THREE.SphereGeometry(0.022, this.seg(10, 6), this.seg(7, 5)), hickory);
        swell.scale.set(1, 1.4, 0.9);
        swell.position.set(-0.017, top - 0.4, 0);
        group.add(swell);
        return group;
      },

      // ---- 208: Egyptian Axe --------------------------------------------------
      createEgyptianAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x8B5A2B);
        const bronze = this._mat(0xB08A3A, { roughness: 0.4, metalness: 0.82 });
        const lapis = this._mat(0x2A4A9B, { roughness: 0.35, metalness: 0.25 });
        const cord = this._mat(0xC8B48A, { roughness: 0.9, metalness: 0.03 });
        // The epsilon head: three tangs through the haft rather than an eye,
        // which is how they were made before anyone could cast a socket.
        const top = this._axeHaft(group, wood, { len: 0.46, r: 0.017 });
        const crescent = this._plate([
          [0.02, -0.075], [0.09, -0.06], [0.115, 0], [0.09, 0.06], [0.02, 0.075],
          [0.05, 0.03], [0.055, 0], [0.05, -0.03]
        ], 0.009, bronze);
        crescent.position.y = top - 0.01;
        group.add(crescent);
        // The three tangs, bound through the haft.
        for (let i = -1; i <= 1; i++) {
          const tang = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.012), bronze);
          tang.position.set(0.015, top - 0.01 + i * 0.05, 0);
          group.add(tang);
          for (let j = 0; j < 2; j++) {
            const l = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0035, this.seg(4, 3), this.seg(10, 6)), cord);
            l.rotation.x = Math.PI / 2;
            l.position.y = top - 0.02 + i * 0.05 + j * 0.012;
            group.add(l);
          }
        }
        const inlays = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < inlays; i++) {
          const inl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), lapis);
          inl.position.set(0.07, top - 0.04 + i * 0.03, 0.005);
          group.add(inl);
        }
        const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.03, this.seg(10, 6)), bronze);
        ferrule.position.y = top - 0.44;
        group.add(ferrule);
        return group;
      },

      // ---- 209: Francisca -----------------------------------------------------
      createFranciscaModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0xA0703C);
        const iron = this._mat(0x6E7378, { roughness: 0.55, metalness: 0.7 });
        const bright = this._mat(0xA8AEB4, { roughness: 0.3, metalness: 0.88 });
        // The Frankish throwing axe: a short haft and a head with a violent
        // S-curve to it, which is what makes it fly the way it does.
        const top = this._axeHaft(group, ash, { len: 0.34, r: 0.016, rTop: 0.014 });
        const head = this._plate([
          [0, -0.03], [0.04, -0.06], [0.1, -0.05], [0.125, 0.01],
          [0.09, 0.08], [0.03, 0.09], [0.01, 0.05]
        ], 0.011, iron);
        head.position.y = top - 0.005;
        group.add(head);
        const edge = this._plate([[0.1, -0.05], [0.125, 0.01], [0.09, 0.08], [0.095, 0.01]], 0.014, bright);
        edge.position.y = top - 0.005;
        group.add(edge);
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.06, this.seg(10, 6)), iron);
        eye.position.y = top;
        group.add(eye);
        // The forge marks: this one was hammered, not ground.
        const marks = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < marks; i++) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(6, 4), this.seg(5, 3)), iron);
          m.position.set(0.04 + rand() * 0.06, top - 0.04 + rand() * 0.1, 0.006);
          m.scale.z = 0.3;
          group.add(m);
        }
        const buttCap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.02, this.seg(9, 6)), iron);
        buttCap.position.y = top - 0.345;
        group.add(buttCap);
        return group;
      },

      // ---- 210: Battle Axe ----------------------------------------------------
      createBattleAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0x8B6A3B);
        const steel = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.84 });
        const bright = this._mat(0xC0C6CC, { roughness: 0.18, metalness: 0.95 });
        const leather = this._wood(0x5B3A1E);
        // The Dane axe: thin, wide, and much lighter than it looks, because
        // the bit is only a few millimetres thick away from the edge.
        const top = this._axeHaft(group, ash, { len: 0.72, r: 0.017, wrapMat: leather, buttMat: steel });
        const head = this._plate([
          [0, -0.06], [0.06, -0.1], [0.15, -0.13], [0.165, 0], [0.15, 0.13],
          [0.06, 0.1], [0, 0.06]
        ], 0.007, steel);
        head.position.y = top - 0.01;
        group.add(head);
        const edge = this._plate([[0.15, -0.13], [0.165, 0], [0.15, 0.13], [0.135, 0]], 0.011, bright);
        edge.position.y = top - 0.01;
        group.add(edge);
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.075, this.seg(11, 7)), steel);
        eye.position.y = top - 0.01;
        group.add(eye);
        for (const s of [-1, 1]) {
          const lug = this._plate([[0, s * 0.05], [0.03, s * 0.075], [0.01, s * 0.085]], 0.012, steel);
          lug.position.y = top - 0.01;
          group.add(lug);
        }
        // The fuller ground into each face to take the weight out.
        for (const z of [0.005, -0.005]) {
          const fuller = this._plate([[0.06, -0.07], [0.13, -0.09], [0.13, 0.09], [0.06, 0.07]], 0.002, ash);
          fuller.position.set(0, top - 0.01, z * 1.6);
          group.add(fuller);
        }
        return group;
      },

      // ---- 212: Trash Can Lid -------------------------------------------------
      createTrashCanLidModel(weapon, rand) {
        const group = new THREE.Group();
        const galv = this._mat(0x9AA0A6, { roughness: 0.62, metalness: 0.7 });
        const dent = this._mat(0x7A8086, { roughness: 0.72, metalness: 0.6 });
        const grime = this._mat(0x4A4238, { roughness: 0.95, metalness: 0.08 });
        // Hardcore division: a galvanised bin lid, held by the handle, and
        // every dent in it is from a previous match.
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.03, this.seg(20, 11)), galv);
        dish.rotation.x = Math.PI / 2;
        dish.position.y = 0.12;
        group.add(dish);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.01, this.seg(5, 4), this.seg(22, 12)), galv);
        rim.position.y = 0.12;
        group.add(rim);
        const rings = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < rings; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.12 - i * 0.03, 0.005, this.seg(4, 3), this.seg(20, 11)), dent);
          r.position.set(0, 0.12, 0.008);
          group.add(r);
        }
        // The handle, which is the only part that is a grip.
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, this.seg(5, 4), this.seg(14, 8), Math.PI), galv);
        handle.position.set(0, 0.12, 0.03);
        handle.rotation.set(Math.PI / 2, 0, 0);
        group.add(handle);
        const dents = this.isLowDetail() ? 4 : 9;
        for (let i = 0; i < dents; i++) {
          const a = rand() * Math.PI * 2, r = rand() * 0.13;
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.018 + rand() * 0.012, this.seg(8, 5), this.seg(6, 4)), dent);
          d.position.set(Math.cos(a) * r, 0.12 + Math.sin(a) * r, -0.012);
          d.scale.set(1, 1, 0.25);
          group.add(d);
        }
        const stain = new THREE.Mesh(new THREE.CircleGeometry(0.05, this.seg(14, 8)), grime);
        stain.position.set(0.04, 0.09, -0.017);
        group.add(stain);
        return group;
      },

      // ---- 213: Bardiche ------------------------------------------------------
      createBardicheModel(weapon, rand) {
        const group = new THREE.Group();
        const oak = this._wood(0x5C3317);
        const steel = this._mat(0x8A9096, { roughness: 0.42, metalness: 0.82 });
        const dark = this._mat(0x4A4F55, { roughness: 0.62, metalness: 0.7 });
        const bright = this._mat(0xC0C6CC, { roughness: 0.2, metalness: 0.94 });
        // A very long crescent bolted to the shaft in two places rather than
        // socketed, so the bottom of the blade braces against the wood.
        const top = this._axeHaft(group, oak, { len: 1.15, r: 0.02, buttMat: dark });
        const blade = this._plate([
          [0, -0.28], [0.05, -0.26], [0.11, -0.16], [0.135, 0], [0.115, 0.16],
          [0.05, 0.25], [0, 0.27], [0.02, 0.1], [0.025, 0], [0.02, -0.12]
        ], 0.008, steel);
        blade.position.y = top - 0.02;
        group.add(blade);
        const edge = this._plate([[0.11, -0.16], [0.135, 0], [0.115, 0.16], [0.105, 0]], 0.012, bright);
        edge.position.y = top - 0.02;
        group.add(edge);
        // The two collars that hold it on.
        for (const y of [-0.28, 0.24]) {
          const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.05, this.seg(11, 7)), dark);
          collar.position.y = top - 0.02 + y;
          group.add(collar);
          const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, this.seg(7, 5)), dark);
          rv.rotation.z = Math.PI / 2;
          rv.position.y = top - 0.02 + y;
          group.add(rv);
        }
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.09, 4), steel);
        spike.position.y = top + 0.29;
        group.add(spike);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, this.seg(10, 6)), dark);
        grip.position.y = top - 0.72;
        group.add(grip);
        return group;
      },

      // ---- 214: Breakaway Table -----------------------------------------------
      createBreakawayTableModel(weapon, rand) {
        const group = new THREE.Group();
        const board = this._mat(0xD8C8A8, { roughness: 0.85, metalness: 0.03 });
        const scored = this._mat(0xB8A888, { roughness: 0.9, metalness: 0.02 });
        const chrome = this._mat(0xC8CED4, { roughness: 0.3, metalness: 0.9 });
        const gaffer = this._wood(0x33332E);
        // Gimmicked: the top is scored on the underside so it goes through
        // cleanly, and one leg is already folded.
        const topBoard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.26), board);
        topBoard.position.y = 0.14;
        topBoard.rotation.z = 0.12;
        group.add(topBoard);
        const scores = this.isLowDetail() ? 2 : 5;
        for (let i = 0; i < scores; i++) {
          const sc = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.26), scored);
          sc.position.set(-0.16 + i * 0.08, 0.128, 0);
          sc.rotation.z = 0.12;
          group.add(sc);
        }
        const lip = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.014, 0.014), chrome);
        lip.position.set(0, 0.148, 0.13);
        lip.rotation.z = 0.12;
        group.add(lip);
        // Legs: three braced, one hanging.
        for (let i = 0; i < 4; i++) {
          const sx = i % 2 ? 1 : -1, sz = i < 2 ? 1 : -1;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.22, this.seg(9, 6)), chrome);
          leg.position.set(sx * 0.17 + 0.02, 0.02, sz * 0.09);
          if (i === 3) {
            leg.rotation.z = 1.1;
            leg.position.set(sx * 0.17 + 0.1, 0.08, sz * 0.09);
            leg.userData.sway = { axis: 'z', amp: 0.12, freq: 1.2 };
          }
          group.add(leg);
        }
        const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.19, this.seg(8, 5)), chrome);
        brace.rotation.x = Math.PI / 2;
        brace.position.set(-0.15, 0.02, 0);
        group.add(brace);
        const tape = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < tape; i++) {
          const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.024, 0.028), gaffer);
          t.position.set(-0.18 + i * 0.12, 0.14, 0.132);
          t.rotation.z = 0.12;
          group.add(t);
        }
        return group;
      },

      // ---- 215: Ring Bell -----------------------------------------------------
      createRingBellModel(weapon, rand) {
        const group = new THREE.Group();
        const brass = this._mat(0xC8A23A, { roughness: 0.3, metalness: 0.9 });
        const dull = this._mat(0x9A7A2A, { roughness: 0.55, metalness: 0.75 });
        const wood = this._wood(0x6B4423);
        const felt = this._mat(0x8B2B22, { roughness: 0.95, metalness: 0.02 });
        // Taken off the timekeeper's table mid-match, hammer and all. It
        // still rings, which is the worst part.
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, this.seg(10, 6)), wood);
        stand.position.y = -0.05;
        group.add(stand);
        const bell = new THREE.Mesh(new THREE.SphereGeometry(0.08, this.seg(16, 9), this.seg(10, 6), 0, Math.PI * 2, 0, Math.PI / 2), brass);
        bell.position.y = 0.17;
        group.add(bell);
        const lipBell = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.009, this.seg(5, 4), this.seg(18, 10)), brass);
        lipBell.rotation.x = Math.PI / 2;
        lipBell.position.y = 0.17;
        group.add(lipBell);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.03, this.seg(11, 7)), dull);
        crown.position.y = 0.26;
        group.add(crown);
        const ringsB = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < ringsB; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.075 - i * 0.012, 0.004, this.seg(4, 3), this.seg(16, 9)), dull);
          r.rotation.x = Math.PI / 2;
          r.position.y = 0.19 + i * 0.014;
          group.add(r);
        }
        const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(9, 6), this.seg(7, 5)), dull);
        clapper.position.y = 0.15;
        clapper.userData.sway = { axis: 'z', amp: 0.35, freq: 2.6 };
        group.add(clapper);
        // The hammer, still hanging off its lanyard.
        const hammerHead = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.035, this.seg(10, 6)), felt);
        hammerHead.rotation.z = Math.PI / 2;
        hammerHead.position.set(0.06, 0.02, 0.03);
        hammerHead.userData.sway = { axis: 'z', amp: 0.2, freq: 1.4 };
        group.add(hammerHead);
        const hammerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.11, this.seg(8, 5)), wood);
        hammerShaft.position.set(0.045, -0.03, 0.03);
        hammerShaft.rotation.z = 0.35;
        hammerShaft.userData.sway = { axis: 'z', amp: 0.18, freq: 1.4 };
        group.add(hammerShaft);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.02, this.seg(13, 8)), wood);
        base.position.y = -0.22;
        group.add(base);
        return group;
      },

      // ---- 216: Steel Ladder --------------------------------------------------
      createSteelLadderModel(weapon, rand) {
        const group = new THREE.Group();
        const alu = this._mat(0xB0B6BC, { roughness: 0.45, metalness: 0.85 });
        const scuff = this._mat(0x8A9096, { roughness: 0.65, metalness: 0.7 });
        const rubber = this._mat(0x2A2A2E, { roughness: 0.92, metalness: 0.03 });
        const paint = this._mat(0xD8B02A, { roughness: 0.6, metalness: 0.2 });
        // Ladder match property. Bent in the middle, one rung missing, and
        // the warning label is still legible.
        for (const s of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.9, 0.03), alu);
          rail.position.set(s * 0.085, -0.05, 0);
          rail.rotation.z = s * 0.02;
          group.add(rail);
        }
        const rungs = this.isLowDetail() ? 4 : 7;
        for (let i = 0; i < rungs; i++) {
          if (i === 3) continue; // the one that came out
          const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.17, this.seg(9, 6)), i === 2 ? scuff : alu);
          rung.rotation.z = Math.PI / 2;
          rung.position.y = 0.32 - i * 0.13;
          group.add(rung);
          const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.014), scuff);
          grip.position.set(0, 0.32 - i * 0.13 + 0.009, 0);
          group.add(grip);
        }
        // The bend, which every one of these acquires.
        const bendTop = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.02, 0.03), scuff);
        bendTop.position.y = -0.02;
        bendTop.rotation.z = 0.12;
        group.add(bendTop);
        for (const s of [-1, 1]) {
          const foot = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.03, 0.036), rubber);
          foot.position.set(s * 0.085, -0.52, 0);
          group.add(foot);
        }
        const label = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.002), paint);
        label.position.set(-0.085, 0.15, 0.016);
        group.add(label);
        const scuffs = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < scuffs; i++) {
          const sc = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.032), scuff);
          sc.position.set((rand() - 0.5) * 0.17, (rand() - 0.5) * 0.8, 0);
          sc.rotation.z = (rand() - 0.5) * 1.2;
          group.add(sc);
        }
        return group;
      },

      // ---- 217: Mithril Axe ---------------------------------------------------
      createMithrilAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const mithril = this._mat(0xD8E4F0, { roughness: 0.12, metalness: 0.98 });
        const pale = this._mat(0xA8BCD0, { roughness: 0.2, metalness: 0.9 });
        const shine = this._glow(0xE8F4FF, 0.7);
        // One piece from butt to edge, and so light that the head is bigger
        // than the weight would ever allow in steel.
        const top = this._axeHaft(group, mithril, { len: 0.66, r: 0.015, rTop: 0.014 });
        const flutes = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < flutes; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / flutes) * Math.PI * 2;
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.5, 0.006), pale);
          f.position.set(0, top - 0.32, 0.015);
          holder.add(f);
          group.add(holder);
        }
        const head = this._plate([
          [0, -0.08], [0.07, -0.13], [0.16, -0.14], [0.175, 0], [0.16, 0.14],
          [0.07, 0.13], [0, 0.08]
        ], 0.007, mithril);
        head.position.y = top - 0.01;
        group.add(head);
        const edge = this._plate([[0.155, -0.14], [0.175, 0], [0.155, 0.14], [0.145, 0]], 0.011, pale);
        edge.position.y = top - 0.01;
        group.add(edge);
        // Leaf tracery through the bit, which is the only ornament on it.
        const leaves = this.isLowDetail() ? 2 : 5;
        for (let i = 0; i < leaves; i++) {
          const t = (i / (leaves - 1) - 0.5) * 2;
          const l = this._plate([[0, 0], [0.03, 0.018], [0.04, 0.05], [0.006, 0.04]], 0.009, pale);
          l.position.set(0.06, top - 0.01 + t * 0.07, 0);
          l.rotation.z = t * 0.5;
          group.add(l);
        }
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.09, this.seg(12, 7)), mithril);
        eye.position.y = top - 0.01;
        group.add(eye);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.002, this.seg(4, 3), this.seg(16, 9)), shine);
        halo.rotation.x = Math.PI / 2;
        halo.position.y = top + 0.04;
        halo.userData.spin = { axis: 'y', speed: 0.5 };
        group.add(halo);
        return group;
      },

      // ---- 218: Bound Elemental Axe -------------------------------------------
      createBoundElementalAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const iron = this._mat(0x3A3F45, { roughness: 0.62, metalness: 0.72 });
        const chain = this._mat(0x8A9096, { roughness: 0.5, metalness: 0.85 });
        const elemColor = this.getRandomColor(rand, [0xFF6A2A, 0x4ABFFF, 0x9BFF3A, 0xC86AFF]);
        const elemental = this._glow(elemColor, 1.2);
        // There is something inside the head, and the chains and the cold
        // iron cage are what keep it there. The edge is where it leaks out.
        const top = this._axeHaft(group, iron, { len: 0.6, r: 0.019, buttMat: chain });
        const cage = this._plate([
          [0, -0.07], [0.06, -0.11], [0.145, -0.1], [0.155, 0], [0.145, 0.1],
          [0.06, 0.11], [0, 0.07]
        ], 0.012, iron);
        cage.position.y = top - 0.01;
        group.add(cage);
        // The thing inside, seen through the bars.
        const coreShape = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), elemental);
        coreShape.position.set(0.07, top - 0.01, 0);
        coreShape.userData.spin = { axis: 'z', speed: 0.6 };
        coreShape.userData.pulse = { min: 0.4, max: 1.3, freq: 1.2 };
        group.add(coreShape);
        const bars = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < bars; i++) {
          const t = (i / (bars - 1) - 0.5) * 2;
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.006, 0.03), iron);
          b.position.set(0.075, top - 0.01 + t * 0.07, 0);
          b.rotation.z = t * 0.25;
          group.add(b);
        }
        const edge = this._plate([[0.145, -0.1], [0.155, 0], [0.145, 0.1], [0.14, 0]], 0.016, elemental);
        edge.position.y = top - 0.01;
        edge.userData.pulse = { min: 0.3, max: 1.1, freq: 1.6 };
        group.add(edge);
        // The chains, wound down the haft and still moving.
        const links = this.isLowDetail() ? 4 : 9;
        for (let i = 0; i < links; i++) {
          const l = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.003, this.seg(4, 3), this.seg(9, 6)), chain);
          l.rotation.set(i % 2 ? Math.PI / 2 : 0, 0, 0.2);
          l.position.set(0.016, top - 0.1 - i * 0.05, 0);
          l.userData.sway = { axis: 'z', amp: 0.12, freq: 1.1 + i * 0.1, phase: i };
          group.add(l);
        }
        return group;
      },

      // ---- 219: Volcanic Greataxe ---------------------------------------------
      createVolcanicGreataxeModel(weapon, rand) {
        const group = new THREE.Group();
        const basalt = this._mat(0x2A2622, { roughness: 0.88, metalness: 0.08 });
        const cooled = this._mat(0x4A423A, { roughness: 0.8, metalness: 0.1 });
        const magma = this._glow(0xFF5A1A, 1.3);
        const ash = this._mat(0x6A6058, { roughness: 0.95, metalness: 0.03 });
        // Poured rather than forged, and never fully set: the crust has
        // cracked all over and what is underneath is still moving.
        const top = this._axeHaft(group, basalt, { len: 0.68, r: 0.023, buttMat: cooled });
        const head = this._plate([
          [0, -0.1], [0.07, -0.16], [0.18, -0.15], [0.2, 0], [0.18, 0.15],
          [0.07, 0.16], [0, 0.1]
        ], 0.028, basalt);
        head.position.y = top - 0.01;
        group.add(head);
        // The cracks, which are where the heat shows.
        const cracks = this.isLowDetail() ? 4 : 9;
        for (let i = 0; i < cracks; i++) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(0.04 + rand() * 0.05, 0.006, 0.032), magma);
          c.position.set(0.05 + rand() * 0.1, top - 0.13 + rand() * 0.26, 0);
          c.rotation.z = (rand() - 0.5) * 2.2;
          c.userData.pulse = { min: 0.25, max: 1.2, freq: 0.6 + rand(), phase: i };
          group.add(c);
        }
        const edge = this._plate([[0.18, -0.15], [0.2, 0], [0.18, 0.15], [0.17, 0]], 0.034, magma);
        edge.position.y = top - 0.01;
        edge.userData.pulse = { min: 0.4, max: 1.3, freq: 0.9 };
        group.add(edge);
        const crust = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < crust; i++) {
          const k = new THREE.Mesh(new THREE.DodecahedronGeometry(0.018 + rand() * 0.012, 0), cooled);
          k.position.set(0.04 + rand() * 0.12, top - 0.12 + rand() * 0.24, 0.016);
          k.rotation.set(rand() * 3, rand() * 3, rand() * 3);
          group.add(k);
        }
        const smoke = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < smoke; i++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.02 + rand() * 0.014, this.seg(8, 5), this.seg(6, 4)), ash);
          s.position.set(0.08 + rand() * 0.06, top + 0.17 + i * 0.05, 0);
          s.userData.bob = { amp: 0.02, freq: 0.5 + i * 0.2, phase: i };
          group.add(s);
        }
        return group;
      },

      // ---- 220: Gravity Crusher -----------------------------------------------
      createGravityCrusherModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._mat(0x1E2126, { roughness: 0.35, metalness: 0.88 });
        const ringMat = this._mat(0x8A9096, { roughness: 0.25, metalness: 0.95 });
        const well = this._glow(0x6A4AFF, 1.2);
        // The head has no mass of its own: two arcs holding a well between
        // them, and everything the swing passes falls into it.
        const top = this._axeHaft(group, dark, { len: 0.66, r: 0.02, buttMat: ringMat });
        for (const s of [-1, 1]) {
          const arc = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, this.seg(6, 4), this.seg(16, 9), Math.PI * 0.75), ringMat);
          arc.position.set(0.03, top - 0.01, 0);
          arc.rotation.set(0, 0, -Math.PI * 0.37 + (s > 0 ? 0 : 0));
          arc.scale.z = s;
          group.add(arc);
        }
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), dark);
        spine.position.set(0.045, top - 0.01, 0);
        group.add(spine);
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.026, this.seg(13, 8), this.seg(9, 6)), well);
        core.position.set(0.1, top - 0.01, 0);
        core.userData.pulse = { min: 0.4, max: 1.3, freq: 1.0 };
        group.add(core);
        const shadowCore = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(11, 7), this.seg(8, 5)), dark);
        shadowCore.position.set(0.1, top - 0.01, 0);
        group.add(shadowCore);
        const caught = this.isLowDetail() ? 3 : 8;
        for (let i = 0; i < caught; i++) {
          const d = new THREE.Mesh(new THREE.TetrahedronGeometry(0.007 + rand() * 0.005, 0), ringMat);
          d.position.set(0.1, top - 0.01, 0);
          d.userData.orbit = { radius: 0.045 + rand() * 0.03, speed: 1.2 + rand(), phase: i, plane: 'xy' };
          d.userData.spin = { axis: 'z', speed: 2.2 };
          group.add(d);
        }
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.07, this.seg(12, 7)), ringMat);
        collar.position.y = top - 0.01;
        group.add(collar);
        const emitters = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < emitters; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / emitters) * Math.PI * 2;
          const e = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.04, 0.007), well);
          e.position.set(0, top - 0.14, 0.018);
          e.userData.pulse = { min: 0.2, max: 0.9, freq: 1.3, phase: i };
          holder.add(e);
          group.add(holder);
        }
        return group;
      },

      // ---- 221: Soul Cleaver --------------------------------------------------
      createSoulCleaverModel(weapon, rand) {
        const group = new THREE.Group();
        const bone = this._mat(0xC8C0A8, { roughness: 0.68, metalness: 0.05 });
        const iron = this._mat(0x3A3F45, { roughness: 0.65, metalness: 0.7 });
        const soul = this._glow(0x8AE8C8, 1.1);
        const shroud = this._mat(0x4A4458, { roughness: 0.82, metalness: 0.06 });
        // It does not cut flesh so much as what is behind it, and what it has
        // already taken is still in the head, looking out.
        const top = this._axeHaft(group, bone, { len: 0.62, r: 0.02, buttMat: iron });
        const vertebrae = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < vertebrae; i++) {
          const v = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.007, this.seg(5, 4), this.seg(11, 7)), bone);
          v.rotation.x = Math.PI / 2;
          v.position.y = top - 0.1 - i * 0.07;
          group.add(v);
        }
        const head = this._plate([
          [0, -0.08], [0.06, -0.13], [0.155, -0.11], [0.165, 0], [0.15, 0.12],
          [0.06, 0.13], [0, 0.08]
        ], 0.011, iron);
        head.position.y = top - 0.01;
        group.add(head);
        const edge = this._plate([[0.15, -0.11], [0.165, 0], [0.15, 0.12], [0.142, 0]], 0.015, soul);
        edge.position.y = top - 0.01;
        edge.userData.pulse = { min: 0.35, max: 1.2, freq: 1.3 };
        group.add(edge);
        // The faces caught in the bit.
        const faces = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < faces; i++) {
          const t = (i / Math.max(1, faces - 1) - 0.5) * 1.5;
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.02, this.seg(9, 6), this.seg(7, 5)), shroud);
          f.scale.set(0.8, 1, 0.4);
          f.position.set(0.075, top - 0.01 + t * 0.08, 0.007);
          group.add(f);
          for (const s of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.004, this.seg(6, 4), this.seg(4, 3)), soul);
            eye.position.set(0.075 + s * 0.007, top + 0.004 + t * 0.08, 0.013);
            eye.userData.pulse = { min: 0.2, max: 1.1, freq: 0.6 + i * 0.3, phase: i };
            group.add(eye);
          }
        }
        const wisps = this.isLowDetail() ? 2 : 5;
        for (let i = 0; i < wisps; i++) {
          const w = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(6, 4), this.seg(4, 3)), soul);
          w.position.set(0.13 + rand() * 0.05, top - 0.1 + rand() * 0.2, 0);
          w.userData.bob = { amp: 0.02, freq: 0.6 + rand() * 0.5, phase: i };
          group.add(w);
        }
        return group;
      },

      // ---- 222: Dragon Axe ----------------------------------------------------
      createDragonAxeModel(weapon, rand) {
        const group = new THREE.Group();
        const scaleColor = this.getRandomColor(rand, [0xB03A22, 0x2A6B3A, 0x3A3A5B]);
        const scale = this._mat(scaleColor, { roughness: 0.42, metalness: 0.45 });
        const gold = this._mat(0xD4A62A, { roughness: 0.28, metalness: 0.92 });
        const steel = this._mat(0xC0C6CC, { roughness: 0.2, metalness: 0.94 });
        const ember = this._glow(0xFF7A2A, 1.15);
        // The bit is a wing and the eye is a skull: the whole head is one
        // animal folded into the shape of an axe.
        const top = this._axeHaft(group, scale, { len: 0.66, r: 0.021, buttMat: gold, butt: 'spike' });
        const coils = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < coils; i++) {
          const t = i / (coils - 1);
          const c = new THREE.Mesh(new THREE.TorusGeometry(0.026 - t * 0.006, 0.006, this.seg(5, 4), this.seg(12, 7)), gold);
          c.rotation.set(Math.PI / 2 + 0.2, t * 4.5, 0);
          c.position.y = top - 0.12 - t * 0.44;
          group.add(c);
        }
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.03, this.seg(12, 7), this.seg(9, 6)), scale);
        skull.scale.set(0.9, 0.9, 1.2);
        skull.position.y = top;
        group.add(skull);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.007, this.seg(7, 5), this.seg(5, 4)), ember);
          eye.position.set(-0.014, top + 0.012, s * 0.02);
          eye.userData.pulse = { min: 0.5, max: 1.2, freq: 0.7 };
          group.add(eye);
          const horn = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.07, this.seg(6, 4)), gold);
          horn.position.set(-0.03, top + 0.05, s * 0.018);
          horn.rotation.set(s * 0.3, 0, 0.5);
          group.add(horn);
        }
        // The wing, which is the bit.
        const wing = this._plate([
          [0.02, -0.06], [0.08, -0.14], [0.17, -0.13], [0.19, 0], [0.17, 0.13],
          [0.09, 0.15], [0.03, 0.07]
        ], 0.009, scale);
        wing.position.y = top - 0.01;
        group.add(wing);
        const ribs = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < ribs; i++) {
          const t = (i / (ribs - 1) - 0.5) * 2;
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.006, 0.014), gold);
          r.position.set(0.09, top - 0.01 + t * 0.06, 0);
          r.rotation.z = t * 0.5;
          group.add(r);
        }
        const edge = this._plate([[0.17, -0.13], [0.19, 0], [0.17, 0.13], [0.16, 0]], 0.013, steel);
        edge.position.y = top - 0.01;
        group.add(edge);
        const breath = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.07, this.seg(7, 5)), ember);
        breath.rotation.z = Math.PI / 2;
        breath.position.set(-0.06, top, 0);
        breath.userData.pulse = { min: 0.3, max: 1.3, freq: 1.5 };
        group.add(breath);
        return group;
      },

      // ---- 223: Planar Divider ------------------------------------------------
      createPlanarDividerModel(weapon, rand) {
        const group = new THREE.Group();
        const pale = this._mat(0xC8CED8, { roughness: 0.28, metalness: 0.9 });
        const dark = this._mat(0x22242A, { roughness: 0.5, metalness: 0.6 });
        const rift = this._glow(0xD8E8FF, 1.1);
        // The head is a plane, not a wedge: seen edge-on it disappears, and
        // what it cuts is the space rather than the thing standing in it.
        const top = this._axeHaft(group, dark, { len: 0.64, r: 0.019, buttMat: pale });
        const sheet = this._plate([
          [0, -0.1], [0.19, -0.16], [0.21, 0], [0.19, 0.16], [0, 0.1]
        ], 0.002, pale);
        sheet.position.y = top - 0.01;
        group.add(sheet);
        const cutLine = this._plate([[0.185, -0.16], [0.21, 0], [0.185, 0.16], [0.18, 0]], 0.004, rift);
        cutLine.position.y = top - 0.01;
        cutLine.userData.pulse = { min: 0.4, max: 1.2, freq: 1.0 };
        group.add(cutLine);
        // The frame that gives it something to be held by.
        for (const s of [-1, 1]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.008), dark);
          bar.position.set(0.1, top - 0.01 + s * 0.11, 0);
          bar.rotation.z = s * 0.28;
          group.add(bar);
        }
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.24, 0.014), dark);
        spine.position.y = top - 0.01;
        group.add(spine);
        // The place behind the sheet, showing through where it is thinnest.
        const window2 = this._plate([[0.05, -0.06], [0.14, -0.09], [0.15, 0.09], [0.05, 0.06]], 0.001, rift);
        window2.position.set(0, top - 0.01, 0.003);
        window2.userData.pulse = { min: 0.1, max: 0.5, freq: 0.5 };
        group.add(window2);
        const seams = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < seams; i++) {
          const sm = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.05, 0.006), rift);
          sm.position.set(0.016, top - 0.14 - i * 0.08, 0);
          sm.userData.pulse = { min: 0.15, max: 0.8, freq: 0.9, phase: i };
          group.add(sm);
        }
        return group;
      },

      // ---- 224: EHI Petrocorruptor --------------------------------------------
      createPetrocorruptorModel(weapon, rand) {
        const group = new THREE.Group();
        const corporate = this._mat(0xE8E4DC, { roughness: 0.4, metalness: 0.25 });
        const accent = this._mat(0x1E4A8B, { roughness: 0.5, metalness: 0.4 });
        const grey = this._mat(0x6E7378, { roughness: 0.5, metalness: 0.75 });
        const crude = this._mat(0x14100C, { roughness: 0.3, metalness: 0.35 });
        const sheen = this._glow(0x6A4A2A, 0.8);
        // EHI sells it as a site tool. The head is a hollow bit that injects
        // rather than cuts, and it is already weeping what it injects.
        const top = this._axeHaft(group, corporate, { len: 0.62, r: 0.021, buttMat: grey });
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, this.seg(11, 7)), accent);
        stripe.position.y = top - 0.16;
        group.add(stripe);
        const reservoir = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, this.seg(13, 8)), corporate);
        reservoir.position.set(-0.04, top - 0.22, 0);
        group.add(reservoir);
        const window3 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.09, 0.03), crude);
        window3.position.set(-0.066, top - 0.22, 0);
        group.add(window3);
        const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, this.seg(8, 5)), grey);
        feed.position.set(-0.03, top - 0.1, 0);
        feed.rotation.z = -0.18;
        group.add(feed);
        const head = this._plate([
          [0, -0.07], [0.06, -0.11], [0.15, -0.1], [0.16, 0], [0.15, 0.1],
          [0.06, 0.11], [0, 0.07]
        ], 0.016, corporate);
        head.position.y = top - 0.01;
        group.add(head);
        // The injector ports along the edge.
        const ports = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < ports; i++) {
          const t = (i / (ports - 1) - 0.5) * 2;
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, this.seg(7, 5)), grey);
          p.rotation.z = Math.PI / 2;
          p.position.set(0.155, top - 0.01 + t * 0.085, 0);
          group.add(p);
          const bead = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(7, 5), this.seg(5, 4)), crude);
          bead.position.set(0.17, top - 0.01 + t * 0.085, 0);
          bead.userData.bob = { amp: 0.006, freq: 0.7 + i * 0.15, phase: i };
          group.add(bead);
        }
        const slick = this._plate([[0.02, -0.05], [0.12, -0.07], [0.13, 0.07], [0.02, 0.05]], 0.019, crude);
        slick.position.y = top - 0.01;
        group.add(slick);
        const gloss = this._plate([[0.05, -0.03], [0.1, -0.04], [0.1, 0.04], [0.05, 0.03]], 0.021, sheen);
        gloss.position.y = top - 0.01;
        gloss.userData.pulse = { min: 0.15, max: 0.6, freq: 0.6 };
        group.add(gloss);
        const label = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.026, 0.002), accent);
        label.position.set(0.02, top - 0.06, 0.018);
        group.add(label);
        return group;
      },

      // ---- 225: Varlenia Cleaver ----------------------------------------------
      createVarleniaCleaverModel(weapon, rand) {
        const group = new THREE.Group();
        const shell = this._mat(0xD8C070, { roughness: 0.3, metalness: 0.85 });
        const trim = this._mat(0xF0DFA0, { roughness: 0.2, metalness: 0.95 });
        const core = this._glow(0xFFE07A, 1.15);
        // Varlenia issue, gilded to the last fitting: a broad ceremonial bit
        // with the state crest cut through it and a lit edge.
        const top = this._axeHaft(group, shell, { len: 0.66, r: 0.02, buttMat: trim });
        const flutes = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < flutes; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / flutes) * Math.PI * 2;
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.5, 0.007), trim);
          f.position.set(0, top - 0.32, 0.02);
          holder.add(f);
          group.add(holder);
        }
        const head = this._plate([
          [0, -0.09], [0.07, -0.15], [0.17, -0.14], [0.185, 0], [0.17, 0.14],
          [0.07, 0.15], [0, 0.09]
        ], 0.01, shell);
        head.position.y = top - 0.01;
        group.add(head);
        const edge = this._plate([[0.168, -0.14], [0.185, 0], [0.168, 0.14], [0.158, 0]], 0.015, core);
        edge.position.y = top - 0.01;
        edge.userData.pulse = { min: 0.4, max: 1.2, freq: 1.1 };
        group.add(edge);
        // The crest, pierced through the bit.
        const crest = this._plate([[-0.02, 0], [0.02, 0], [0, 0.05]], 0.014, trim);
        crest.position.set(0.075, top - 0.035, 0);
        group.add(crest);
        const rays = this.isLowDetail() ? 4 : 7;
        for (let i = 0; i < rays; i++) {
          const a = -0.9 + (i / (rays - 1)) * 1.8;
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.012), trim);
          r.position.set(0.09 + Math.cos(a) * 0.02, top - 0.01 + Math.sin(a) * 0.07, 0);
          r.rotation.z = a;
          group.add(r);
        }
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.085, this.seg(12, 7)), trim);
        eye.position.y = top - 0.01;
        group.add(eye);
        const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, this.seg(5, 4), this.seg(13, 8)), core);
        collarRing.rotation.x = Math.PI / 2;
        collarRing.position.y = top - 0.06;
        collarRing.userData.pulse = { min: 0.3, max: 1.0, freq: 0.9 };
        group.add(collarRing);
        return group;
      },

      // ---- 226: Dimensional Cleaver -------------------------------------------
      createDimensionalCleaverModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._mat(0x1A1C24, { roughness: 0.4, metalness: 0.7 });
        const chrome = this._mat(0xB8BEC6, { roughness: 0.2, metalness: 0.95 });
        const elsewhere = this._glow(0xC86AFF, 1.15);
        // There is more than one head, and only one of them is here: the
        // others are the same axe seen from adjacent places.
        const top = this._axeHaft(group, dark, { len: 0.64, r: 0.019, buttMat: chrome });
        const profile = [
          [0, -0.08], [0.06, -0.13], [0.15, -0.12], [0.165, 0], [0.15, 0.12],
          [0.06, 0.13], [0, 0.08]
        ];
        const head = this._plate(profile, 0.012, chrome);
        head.position.y = top - 0.01;
        group.add(head);
        // The other copies, offset and thinner, which never quite line up.
        const copies = this.isLowDetail() ? 2 : 4;
        for (let i = 1; i <= copies; i++) {
          const ghost = this._plate(profile, 0.003, elsewhere);
          ghost.position.set(-i * 0.012, top - 0.01 + i * 0.014, i * 0.016);
          ghost.rotation.z = i * 0.06;
          ghost.userData.pulse = { min: 0.08, max: 0.45, freq: 0.6 + i * 0.25, phase: i };
          ghost.userData.bob = { amp: 0.008, freq: 0.5 + i * 0.2, phase: i, axis: 'z' };
          group.add(ghost);
        }
        const edge = this._plate([[0.15, -0.12], [0.165, 0], [0.15, 0.12], [0.143, 0]], 0.016, elsewhere);
        edge.position.y = top - 0.01;
        edge.userData.pulse = { min: 0.4, max: 1.25, freq: 1.4 };
        group.add(edge);
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.24, 0.02), elsewhere);
        seam.position.set(0.03, top - 0.01, 0);
        seam.userData.pulse = { min: 0.2, max: 0.9, freq: 0.8 };
        group.add(seam);
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.08, this.seg(12, 7)), chrome);
        eye.position.y = top - 0.01;
        group.add(eye);
        const marks = this.isLowDetail() ? 2 : 5;
        for (let i = 0; i < marks; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = i * 1.25;
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.016, 0.006), elsewhere);
          m.position.set(0, top - 0.12 - i * 0.08, 0.018);
          m.userData.pulse = { min: 0.15, max: 0.8, freq: 0.7 + i * 0.15, phase: i };
          holder.add(m);
          group.add(holder);
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
      }
    }
  });
})();
