//=============================================================================
// Weapon 3D Models - Untyped crowd-control devices
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Procedural 3D models for the weapons that declare no weapon
 * type. Loaded automatically by WeaponSystemProcedural.js.
 * @author AntiGravity
 *
 * @help
 * ============================================================================
 * Weapon 3D Models - Untyped crowd-control devices
 * ============================================================================
 *
 * One family per weapon type. This one owns the entries that declare no type
 * at all: the riot devices, which are neither club nor firearm and are held
 * like neither, and the shields, which are off-hand armours rather than
 * weapons and so have no weapon type either. The riot devices dispatch by
 * database id alone; the shields dispatch through createShieldModel, which
 * deals a silhouette from the piece's seed and its weight.
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
 * itself, so they are available as `this` inside a builder. The parts a
 * trigger finger works carry the same `userData.gun` tags a firearm's do.
 * ============================================================================
 */

(() => {
  'use strict';
  if (!window.WeaponSystemProcedural) {
    console.error('[Weapon3D_Types] WeaponSystemProcedural not loaded');
    return;
  }

  window.WeaponSystemProcedural.registerFamily({
    name: 'Weapon3D_Types',
    unique: {
      663: 'createFoamProjectorModel',               // Foam Projector
      664: 'createElectroNetLauncherModel',          // Electro-Net Launcher
      665: 'createActiveDenialSystemModel'           // Active Denial System
    },
    models: {
      // ======================================================================
      // Shields
      // ======================================================================
      //
      // A shield is an off-hand armour, not a weapon, so it declares no weapon
      // type at all and belongs here with the other untyped things. Hands hold
      // weapons and shields the same way now (ItemSystem/ItemSystemEquipment.js),
      // so any hand may show one and two of them at once is a legal loadout.
      // WeaponSystemProcedural.shieldWeaponFor wraps the armour into the shape
      // the rest of the pipeline expects and routes it here.
      //
      // The silhouette is dealt from the piece's own seed and its weight: a
      // 500g buckler is never built as a tower shield, and anything that
      // declares no weight at all is read as a mid-weight round shield. Every
      // one of them is built face-on (the plate lies in X-Y, the boss pointing
      // at +Z, the grip behind it) so the model reads as cover from the front.

      createShieldModel(weapon, rand) {
        // A piece built out of polymer and glass comes off the rack as riot
        // gear whatever it weighs.
        if (/<Riot>|<Ballistic>|<Energy>/i.test(weapon.note || '')) {
          return this.createRiotShieldModel(weapon, rand);
        }
        const grams = this.weightOf(weapon);
        const builders = [];
        if (grams < 1600) builders.push('createBucklerShieldModel', 'createTargeShieldModel');
        if (grams >= 1200 && grams < 5000) {
          builders.push('createHeaterShieldModel', 'createRoundShieldModel', 'createKiteShieldModel');
        }
        if (grams >= 3500) builders.push('createTowerShieldModel', 'createScutumShieldModel');
        if (!builders.length) builders.push('createRoundShieldModel');
        const name = builders[Math.floor(rand() * builders.length)];
        return this[name](weapon, rand);
      },

      // Shared plumbing: the arm behind the plate. Every shield is carried the
      // same way, on a forearm strap and a fist grip, and the grip is what sits
      // at the origin so the hand closes on it.
      _shieldGrip(group, rand, opts) {
        opts = opts || {};
        const leather = this._mat(this.getRandomColor(rand, [0x4A2E1B, 0x2A1B12, 0x5C4033, 0x1A1A1A]), {
          roughness: 0.92, metalness: 0.0
        });
        const iron = this._steel(0x6E747C, 0.45);
        const depth = opts.depth === undefined ? -0.035 : opts.depth;
        const span = opts.span === undefined ? 0.16 : opts.span;

        const grip = new THREE.Mesh(
          new THREE.CylinderGeometry(0.014, 0.014, 0.1, this.seg(10, 6)), leather);
        grip.rotation.z = Math.PI / 2;
        grip.position.set(0, 0, depth);
        group.add(grip);

        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.008, this.seg(6, 4), this.seg(14, 8)), leather);
        strap.rotation.y = Math.PI / 2;
        strap.position.set(0, span * 0.45, depth * 0.7);
        group.add(strap);

        for (const side of [-1, 1]) {
          const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.012), iron);
          anchor.position.set(side * 0.055, 0, depth * 0.45);
          group.add(anchor);
        }
      },

      // Rim, boss and rivets: the trim that separates a shield from a plank.
      _shieldRim(group, rand, radius, mat, opts) {
        opts = opts || {};
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(radius, opts.thickness || 0.012, this.seg(8, 4), this.seg(28, 12)), mat);
        rim.position.z = opts.z || 0;
        group.add(rim);
      },

      _shieldBoss(group, rand, mat, opts) {
        opts = opts || {};
        const boss = new THREE.Mesh(
          new THREE.SphereGeometry(opts.radius || 0.05, this.seg(16, 8), this.seg(10, 6), 0, Math.PI * 2, 0, Math.PI / 2),
          mat);
        boss.rotation.x = Math.PI / 2;
        boss.position.set(0, opts.y || 0, (opts.z || 0) + 0.02);
        group.add(boss);
        if (this.wantsTrim()) {
          const studs = this.isLowDetail() ? 4 : 8;
          for (let i = 0; i < studs; i++) {
            const a = (i / studs) * Math.PI * 2;
            const stud = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(8, 4), this.seg(6, 4)), mat);
            const r = (opts.studRadius || 0.09);
            stud.position.set(Math.cos(a) * r, (opts.y || 0) + Math.sin(a) * r, (opts.z || 0) + 0.012);
            group.add(stud);
          }
        }
      },

      // ---- Round shield: planks, iron rim, a boss in the middle -------------
      createRoundShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const face = this._wood(this.getRandomColor(rand, [0x8B4513, 0x5C4033, 0x7A3B2E, 0x3D2314, 0x2E5B88, 0x8A2C2C]));
        const iron = this._steel(this.getRandomColor(rand, [0x9AA0A6, 0x6E747C, 0xCD7F32]), 0.4);
        const radius = 0.24 + rand() * 0.05;

        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, 0.022, this.seg(26, 12)), face);
        plate.rotation.x = Math.PI / 2;
        group.add(plate);

        // The planks it was glued up from, laid across the face.
        const planks = this.isLowDetail() ? 0 : 5;
        for (let i = 0; i < planks; i++) {
          const seam = new THREE.Mesh(
            new THREE.BoxGeometry(0.004, radius * 1.9, 0.004), this._wood(0x2A1B12));
          seam.position.set(-radius * 0.7 + (i / (planks - 1)) * radius * 1.4, 0, 0.013);
          group.add(seam);
        }
        this._shieldRim(group, rand, radius, iron, { thickness: 0.014 });
        this._shieldBoss(group, rand, iron, { radius: 0.055, studRadius: radius * 0.62 });
        this._shieldGrip(group, rand, {});
        return group;
      },

      // ---- Heater: the pointed knight's shield, quartered -------------------
      createHeaterShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const field = this._mat(this.getRandomColor(rand, [0x8A2C2C, 0x1D3557, 0x2A6041, 0x3A3A44, 0x6E4A8B, 0xD4AF37]), {
          roughness: 0.55, metalness: 0.25
        });
        const trim = this._steel(this.getRandomColor(rand, [0xD4AF37, 0xC0C0C0, 0xCD7F32]), 0.3);
        const w = 0.2 + rand() * 0.03;
        const h = 0.3 + rand() * 0.05;

        const outline = [
          [-w, h * 0.55], [-w, -h * 0.1], [-w * 0.72, -h * 0.55],
          [0, -h * 0.72], [w * 0.72, -h * 0.55], [w, -h * 0.1],
          [w, h * 0.55], [w * 0.86, h * 0.62], [-w * 0.86, h * 0.62]
        ];
        const plate = this._plate(outline, 0.02, field);
        group.add(plate);

        // A charge on the field: a band, a chevron or a cross, whichever the
        // seed deals. It is what makes two heaters look like two houses.
        const charge = Math.floor(rand() * 3);
        if (charge === 0) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(w * 2, h * 0.16, 0.006), trim);
          band.position.set(0, h * 0.05, 0.012);
          band.rotation.z = 0.35;
          group.add(band);
        } else if (charge === 1) {
          for (const side of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(w * 1.1, h * 0.13, 0.006), trim);
            arm.position.set(side * w * 0.42, 0, 0.012);
            arm.rotation.z = side * 0.7;
            group.add(arm);
          }
        } else {
          const up = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 1.25, 0.006), trim);
          up.position.set(0, -h * 0.02, 0.012);
          group.add(up);
          const across = new THREE.Mesh(new THREE.BoxGeometry(w * 1.9, h * 0.18, 0.006), trim);
          across.position.set(0, h * 0.16, 0.012);
          group.add(across);
        }
        if (this.wantsTrim()) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.012, 0.024), trim);
          edge.position.set(0, h * 0.615, 0);
          group.add(edge);
        }
        this._shieldGrip(group, rand, { span: h });
        return group;
      },

      // ---- Kite: the long cavalry shield, curved across ---------------------
      createKiteShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const hide = this._mat(this.getRandomColor(rand, [0x5C4033, 0x2E5B88, 0x8A2C2C, 0x3D8B7A, 0x2A1B12]), {
          roughness: 0.75, metalness: 0.08
        });
        const iron = this._steel(0x8A9096, 0.42);
        const w = 0.17 + rand() * 0.03;
        const h = 0.4 + rand() * 0.06;

        const outline = [
          [-w, h * 0.4], [-w * 0.95, h * 0.52], [0, h * 0.6], [w * 0.95, h * 0.52],
          [w, h * 0.4], [w * 0.55, -h * 0.25], [0, -h * 0.6], [-w * 0.55, -h * 0.25]
        ];
        group.add(this._plate(outline, 0.022, hide));

        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.016, h * 1.1, 0.008), iron);
        spine.position.set(0, 0, 0.014);
        group.add(spine);
        const ribs = this.isLowDetail() ? 1 : 3;
        for (let i = 0; i < ribs; i++) {
          const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 1.7, 0.01, 0.006), iron);
          rib.position.set(0, h * 0.36 - i * h * 0.3, 0.013);
          group.add(rib);
        }
        this._shieldBoss(group, rand, iron, { radius: 0.036, y: h * 0.18, studRadius: w * 0.72 });
        this._shieldGrip(group, rand, { span: h * 0.7 });
        return group;
      },

      // ---- Buckler: a fist-sized dome, all boss ----------------------------
      createBucklerShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._steel(this.getRandomColor(rand, [0xC0C0C0, 0x8A9096, 0xCD7F32, 0x4A4A52]), 0.28);
        const radius = 0.12 + rand() * 0.03;

        const dish = new THREE.Mesh(
          new THREE.SphereGeometry(radius, this.seg(20, 10), this.seg(12, 6), 0, Math.PI * 2, 0, Math.PI * 0.42),
          steel);
        dish.rotation.x = Math.PI / 2;
        group.add(dish);
        const back = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.01, this.seg(20, 10)), steel);
        back.rotation.x = Math.PI / 2;
        back.position.z = -0.005;
        group.add(back);
        this._shieldRim(group, rand, radius, steel, { thickness: 0.009, z: -0.004 });
        // A spike through the boss turns it into something that hits back.
        if (rand() < 0.4) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, this.seg(10, 6)), steel);
          spike.rotation.x = Math.PI / 2;
          spike.position.z = radius * 0.5 + 0.045;
          group.add(spike);
        }
        this._shieldGrip(group, rand, { depth: -0.02, span: radius });
        return group;
      },

      // ---- Targe: small, studded, faced in hide ----------------------------
      createTargeShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const hide = this._mat(this.getRandomColor(rand, [0x3D2314, 0x5C4033, 0x1A1A1A, 0x7A3B2E]), {
          roughness: 0.95, metalness: 0.0
        });
        const brass = this._steel(this.getRandomColor(rand, [0xCD7F32, 0xD4AF37, 0xAA8822]), 0.35);
        const radius = 0.155 + rand() * 0.03;

        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, 0.018, this.seg(24, 12)), hide);
        plate.rotation.x = Math.PI / 2;
        group.add(plate);
        // Concentric rings of brass tacks, which is the whole decoration.
        const rings = this.isLowDetail() ? 1 : 2;
        for (let r = 0; r < rings; r++) {
          const ringRadius = radius * (0.45 + r * 0.35);
          const count = 8 + r * 6;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const tack = new THREE.Mesh(new THREE.SphereGeometry(0.007, this.seg(8, 4), this.seg(6, 4)), brass);
            tack.position.set(Math.cos(a) * ringRadius, Math.sin(a) * ringRadius, 0.011);
            group.add(tack);
          }
        }
        this._shieldRim(group, rand, radius, brass, { thickness: 0.01 });
        this._shieldBoss(group, rand, brass, { radius: 0.032, studRadius: radius * 0.7 });
        this._shieldGrip(group, rand, { depth: -0.03, span: radius });
        return group;
      },

      // ---- Tower: a wall with a hand behind it -----------------------------
      createTowerShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const slab = this._mat(this.getRandomColor(rand, [0x4A4A52, 0x2E3238, 0x6E4A2E, 0x3A5A3A]), {
          roughness: 0.7, metalness: 0.3
        });
        const iron = this._steel(0x7A8088, 0.45);
        const w = 0.26 + rand() * 0.04;
        const h = 0.46 + rand() * 0.08;

        const body = new THREE.Mesh(new THREE.BoxGeometry(w * 2, h, 0.03), slab);
        group.add(body);
        // Bands across it and a foot spike, which is how it is planted.
        for (let i = 0; i < 3; i++) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(w * 2.06, 0.026, 0.036), iron);
          band.position.set(0, h * 0.36 - i * h * 0.36, 0);
          group.add(band);
        }
        for (const side of [-1, 1]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.018, h, 0.038), iron);
          edge.position.set(side * w, 0, 0);
          group.add(edge);
        }
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.11, this.seg(8, 5)), iron);
        spike.rotation.z = Math.PI;
        spike.position.set(0, -h * 0.5 - 0.05, 0);
        group.add(spike);
        // A slit to look through, because nothing else on it can be seen past.
        const slit = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.03, 0.05), this._mat(0x0A0A0C, { roughness: 1 }));
        slit.position.set(0, h * 0.3, 0.002);
        group.add(slit);
        this._shieldGrip(group, rand, { depth: -0.045, span: h * 0.6 });
        return group;
      },

      // ---- Scutum: the curved legion shield --------------------------------
      createScutumShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const field = this._mat(this.getRandomColor(rand, [0x8A2C2C, 0x1D3557, 0x2A6041]), {
          roughness: 0.6, metalness: 0.2
        });
        const brass = this._steel(this.getRandomColor(rand, [0xD4AF37, 0xCD7F32]), 0.32);
        const w = 0.24 + rand() * 0.03;
        const h = 0.44 + rand() * 0.06;

        // Half a cylinder: the curve is the point of it.
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(w, w, h, this.seg(20, 10), 1, true, -Math.PI * 0.42, Math.PI * 0.84), field);
        body.position.z = -w * 0.75;
        group.add(body);
        body.material.side = THREE.DoubleSide;

        for (const y of [h * 0.5, -h * 0.5]) {
          const band = new THREE.Mesh(
            new THREE.CylinderGeometry(w * 1.02, w * 1.02, 0.022, this.seg(20, 10), 1, true, -Math.PI * 0.42, Math.PI * 0.84),
            brass);
          band.position.set(0, y, -w * 0.75);
          band.material.side = THREE.DoubleSide;
          group.add(band);
        }
        const boss = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, this.seg(16, 8), this.seg(10, 6), 0, Math.PI * 2, 0, Math.PI / 2), brass);
        boss.rotation.x = Math.PI / 2;
        boss.position.z = w * 0.28;
        group.add(boss);
        // Wings above and below the boss, the legion's mark.
        if (this.wantsTrim()) {
          for (const side of [-1, 1]) {
            const wing = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.014, 0.006), brass);
            wing.position.set(side * w * 0.4, h * 0.16, w * 0.2);
            wing.rotation.z = side * -0.3;
            group.add(wing);
          }
        }
        this._shieldGrip(group, rand, { depth: -0.02, span: h * 0.5 });
        return group;
      },

      // ---- Riot shield: polycarbonate, a stencilled line of text -----------
      createRiotShieldModel(weapon, rand) {
        const group = new THREE.Group();
        const glass = this._mat(0xBFD8E8, {
          roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.55
        });
        const frame = this._mat(0x1A1C20, { roughness: 0.6, metalness: 0.4 });
        const w = 0.24 + rand() * 0.03;
        const h = 0.46 + rand() * 0.06;

        const pane = new THREE.Mesh(new THREE.BoxGeometry(w * 2, h, 0.016), glass);
        group.add(pane);
        for (const side of [-1, 1]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.016, h, 0.024), frame);
          edge.position.set(side * w, 0, 0);
          group.add(edge);
        }
        for (const y of [h * 0.5, -h * 0.5]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(w * 2.03, 0.016, 0.024), frame);
          edge.position.set(0, y, 0);
          group.add(edge);
        }
        // The stencilled band across the face, unreadable at this size and
        // meant to be: it reads as riot gear, which is the job.
        const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.6, 0.05, 0.004), frame);
        band.position.set(0, h * 0.06, 0.011);
        group.add(band);
        this._shieldGrip(group, rand, { depth: -0.03, span: h * 0.6 });
        return group;
      },

      // ---- 663: Foam Projector ------------------------------------------------
      createFoamProjectorModel(weapon, rand) {
        const group = new THREE.Group();
        const tankColor = this.getRandomColor(rand, [0xE0C24A, 0xD8D4CC, 0x4A8BC0]);
        const tank = this._mat(tankColor, { roughness: 0.55, metalness: 0.35 });
        const steel = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.85 });
        const hose = this._mat(0x22242A, { roughness: 0.9, metalness: 0.08 });
        const foam = this._mat(0xF2F0E6, { roughness: 1.0, metalness: 0.0 });
        const hazard = this._mat(0xE8B02A, { roughness: 0.65, metalness: 0.15 });

        // A pressure vessel with a lance on it. Nothing about it was built to
        // hurt anybody: it lays down a wall of foam that sets in seconds, and
        // the wall is the weapon.
        const vessel = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.26, this.seg(14, 8)), tank);
        vessel.position.y = -0.02;
        group.add(vessel);
        for (const s of [-1, 1]) {
          const dome = new THREE.Mesh(
            new THREE.SphereGeometry(0.062, this.seg(14, 8), this.seg(9, 6), 0, Math.PI * 2, 0, Math.PI / 2), tank);
          dome.position.y = -0.02 + s * 0.13;
          if (s < 0) dome.rotation.x = Math.PI;
          group.add(dome);
        }
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.063, 0.063, 0.03, this.seg(14, 8)), hazard);
        stripe.position.y = 0.04;
        group.add(stripe);
        // Regulator, gauge, and the pump handle that still has to be worked by
        // hand between bursts.
        const reg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.05), steel);
        reg.position.y = 0.14;
        group.add(reg);
        const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, this.seg(11, 7)), steel);
        gauge.rotation.x = Math.PI / 2;
        gauge.position.set(0, 0.15, 0.038);
        group.add(gauge);
        const needle = new THREE.Group();
        needle.position.set(0, 0.15, 0.046);
        needle.rotation.z = -0.7;
        needle.userData.sway = { axis: 'z', amp: 0.35, freq: 1.8 };
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.02, 0.002), hazard);
        pin.position.y = 0.008;
        needle.add(pin);
        group.add(needle);
        const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09, this.seg(8, 5)), steel);
        pump.position.set(-0.05, 0.13, 0);
        pump.rotation.z = 0.5;
        pump.userData.bob = { amp: 0.01, freq: 1.4 };
        group.add(pump);
        // The delivery line, coiled up the side of the tank to the lance.
        const runs = this.seg(7, 4);
        for (let i = 0; i < runs; i++) {
          const t = i / runs;
          const link = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.06, this.seg(7, 5)), hose);
          link.position.set(0.055 + Math.sin(t * 3.0) * 0.012, -0.06 + t * 0.26, 0.03);
          link.rotation.z = -0.25 + Math.sin(t * 3.0) * 0.2;
          group.add(link);
        }
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.24, this.seg(12, 7)), steel);
        barrel.position.set(0.045, 0.34, 0.01);
        barrel.rotation.z = -0.1;
        group.add(barrel);
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.016, 0.06, this.seg(12, 7)), steel);
        nozzle.position.set(0.07, 0.47, 0.01);
        nozzle.rotation.z = -0.1;
        nozzle.userData.gun = 'muzzle';
        group.add(nozzle);
        // Foam that set on the way out and was never chipped off.
        const blobs = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < blobs; i++) {
          const b = new THREE.Mesh(
            new THREE.SphereGeometry(0.012 + rand() * 0.01, this.seg(8, 5), this.seg(6, 4)), foam);
          b.position.set(0.06 + (rand() - 0.5) * 0.05, 0.44 + rand() * 0.07, (rand() - 0.5) * 0.05);
          b.scale.set(1, 0.8 + rand() * 0.4, 1);
          group.add(b);
        }
        // Grip and trigger: the one place on it that was drawn around a hand.
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.09, 0.036), hose);
        grip.position.set(0.02, -0.18, 0.02);
        grip.rotation.x = -0.15;
        group.add(grip);
        const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.022, 0.006), steel);
        trigger.position.set(0.02, -0.14, 0.045);
        trigger.userData.gun = 'trigger';
        group.add(trigger);
        const guard = new THREE.Mesh(
          new THREE.TorusGeometry(0.019, 0.0035, this.seg(5, 4), this.seg(12, 7), Math.PI * 1.1), steel);
        guard.position.set(0.02, -0.145, 0.04);
        guard.rotation.set(0, Math.PI / 2, -0.35);
        group.add(guard);
        return group;
      },

      // ---- 664: Electro-Net Launcher ------------------------------------------
      createElectroNetLauncherModel(weapon, rand) {
        const group = new THREE.Group();
        const alloy = this._mat(0x767C84, { roughness: 0.45, metalness: 0.8 });
        const shell = this._mat(0x2E3238, { roughness: 0.6, metalness: 0.35 });
        const copper = this._mat(0xB87333, { roughness: 0.35, metalness: 0.9 });
        const arcColor = this.getRandomColor(rand, [0x8AD0FF, 0xC8E8FF, 0xB58AFF]);
        const arc = this._glow(arcColor, 1.2);
        const cord = this._mat(0x8E8778, { roughness: 0.95, metalness: 0.02 });

        // A wide-mouthed tube that throws a weighted net and then runs a
        // current through it. The weights sit in the corners of the mouth and
        // the net is folded behind them, which is most of what it is.
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.06, 0.3, this.seg(14, 8), 1, true), shell);
        tube.position.y = 0.22;
        group.add(tube);
        const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, this.seg(5, 4), this.seg(16, 9)), alloy);
        mouth.rotation.x = Math.PI / 2;
        mouth.position.y = 0.37;
        mouth.userData.gun = 'muzzle';
        group.add(mouth);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const weight = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(9, 6), this.seg(7, 5)), alloy);
          weight.position.set(Math.cos(a) * 0.052, 0.35, Math.sin(a) * 0.052);
          group.add(weight);
          const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.13, this.seg(5, 3)), cord);
          strand.position.set(Math.cos(a) * 0.04, 0.29, Math.sin(a) * 0.04);
          group.add(strand);
        }
        const folds = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < folds; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.045 - i * 0.004, 0.0025, this.seg(4, 3), this.seg(12, 7)), cord);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.3 - i * 0.03;
          group.add(ring);
        }
        // The capacitor bank, which is what makes it worth carrying over a net
        // and a good arm.
        const bank = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.06), shell);
        group.add(bank);
        const cans = this.isLowDetail() ? 2 : 3;
        for (let i = 0; i < cans; i++) {
          const can = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.09, this.seg(10, 6)), copper);
          can.position.set(-0.026 + i * 0.026, 0, 0.036);
          group.add(can);
          const terminal = new THREE.Mesh(new THREE.SphereGeometry(0.011, this.seg(8, 5), this.seg(6, 4)), arc);
          terminal.position.set(-0.026 + i * 0.026, 0.05, 0.036);
          terminal.userData.pulse = { min: 0.2, max: 1.3, freq: 2.2 + i * 0.4, phase: i };
          group.add(terminal);
        }
        // The rails on the mouth, and what jumps between them while it is
        // charged, which is always.
        for (const s of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.14, this.seg(7, 5)), copper);
          rail.position.set(s * 0.06, 0.3, 0);
          group.add(rail);
        }
        const spark = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.004, 0.004), arc);
        spark.position.y = 0.36;
        spark.rotation.z = 0.12;
        spark.userData.pulse = { min: 0.0, max: 1.5, freq: 5.0 };
        spark.userData.sway = { axis: 'z', amp: 0.2, freq: 4.0 };
        group.add(spark);
        // Grip, trigger, and the handle that charges the bank by hand when the
        // cells are flat.
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.04), shell);
        grip.position.set(0, -0.13, 0.02);
        grip.rotation.x = -0.18;
        group.add(grip);
        const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.022, 0.006), alloy);
        trigger.position.set(0, -0.09, 0.046);
        trigger.userData.gun = 'trigger';
        group.add(trigger);
        const guard = new THREE.Mesh(
          new THREE.TorusGeometry(0.019, 0.0035, this.seg(5, 4), this.seg(12, 7), Math.PI * 1.1), alloy);
        guard.position.set(0, -0.095, 0.04);
        guard.rotation.set(0, Math.PI / 2, -0.35);
        group.add(guard);
        const charging = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, this.seg(8, 5)), alloy);
        charging.rotation.z = Math.PI / 2;
        charging.position.set(0.05, -0.02, 0);
        charging.userData.gun = 'charging';
        group.add(charging);
        return group;
      },

      // ---- 665: Active Denial System ------------------------------------------
      createActiveDenialSystemModel(weapon, rand) {
        const group = new THREE.Group();
        const shell = this._mat(0xD8D4CA, { roughness: 0.5, metalness: 0.3 });
        const alloy = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.85 });
        const dark = this._mat(0x2A2C32, { roughness: 0.7, metalness: 0.3 });
        const beamColor = this.getRandomColor(rand, [0xFF8A3A, 0xFFC24A, 0xFF5A5A]);
        const beam = this._glow(beamColor, 1.0);
        const hazard = this._mat(0xE8B02A, { roughness: 0.65, metalness: 0.15 });

        // A millimetre-wave dish on a yoke. It leaves no mark and empties a
        // street anyway, which is the whole argument for it and the whole
        // argument against it.
        const dish = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, this.seg(20, 10), 1, true), shell);
        dish.rotation.x = Math.PI;
        dish.position.y = 0.3;
        group.add(dish);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.008, this.seg(5, 4), this.seg(20, 11)), alloy);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.36;
        group.add(rim);
        // Radial ribs behind it, the only things keeping the dish true.
        const ribs = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < ribs; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / ribs) * Math.PI * 2;
          const rib = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.11, 0.14), alloy);
          rib.position.set(0, 0.29, 0.085);
          rib.rotation.x = -0.5;
          holder.add(rib);
          group.add(holder);
        }
        // The feed horn at the focus, on the struts that hold it there.
        const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.014, 0.06, this.seg(12, 7)), alloy);
        horn.position.y = 0.44;
        horn.userData.gun = 'muzzle';
        group.add(horn);
        const aperture = new THREE.Mesh(new THREE.CircleGeometry(0.024, this.seg(14, 8)), beam);
        aperture.rotation.x = -Math.PI / 2;
        aperture.position.y = 0.471;
        aperture.userData.pulse = { min: 0.2, max: 1.3, freq: 1.6 };
        group.add(aperture);
        for (let i = 0; i < 3; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / 3) * Math.PI * 2;
          const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.15, this.seg(6, 4)), alloy);
          strut.position.set(0, 0.4, 0.07);
          strut.rotation.x = 0.55;
          holder.add(strut);
          group.add(holder);
        }
        // The air standing off the dish while it is running, which is the only
        // warning anybody gets.
        const shimmer = this.isLowDetail() ? 2 : 3;
        for (let i = 0; i < shimmer; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.08 + i * 0.03, 0.002, this.seg(4, 3), this.seg(16, 9)), beam);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.4 + i * 0.03;
          ring.userData.pulse = { min: 0.0, max: 0.9, freq: 1.1, phase: i * 1.4 };
          ring.userData.bob = { amp: 0.02, freq: 0.7, phase: i };
          group.add(ring);
        }
        // Yoke, body, and the cooling stack that runs the whole time.
        for (const s of [-1, 1]) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.16, 0.03), alloy);
          arm.position.set(s * 0.13, 0.2, 0);
          arm.rotation.z = -s * 0.25;
          group.add(arm);
          const trunnion = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, this.seg(10, 6)), dark);
          trunnion.rotation.z = Math.PI / 2;
          trunnion.position.set(s * 0.155, 0.28, 0);
          group.add(trunnion);
        }
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.09), shell);
        body.position.y = 0.06;
        group.add(body);
        const fins = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < fins; i++) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 0.1), alloy);
          fin.position.set(0, 0.01 + i * 0.02, -0.02);
          group.add(fin);
        }
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.004), hazard);
        plate.position.set(0, 0.1, 0.048);
        group.add(plate);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.04), dark);
        grip.position.set(0, -0.09, 0.02);
        grip.rotation.x = -0.15;
        group.add(grip);
        const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.022, 0.006), alloy);
        trigger.position.set(0, -0.05, 0.046);
        trigger.userData.gun = 'trigger';
        group.add(trigger);
        const guard = new THREE.Mesh(
          new THREE.TorusGeometry(0.019, 0.0035, this.seg(5, 4), this.seg(12, 7), Math.PI * 1.1), alloy);
        guard.position.set(0, -0.055, 0.04);
        guard.rotation.set(0, Math.PI / 2, -0.35);
        group.add(guard);
        return group;
      },
    }
  });
})();
