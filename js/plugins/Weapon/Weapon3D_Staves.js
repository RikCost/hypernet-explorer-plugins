//=============================================================================
// Weapon 3D Models - Staves
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Procedural 3D models for staves. Loaded
 * automatically by WeaponSystemProcedural.js.
 * @author AntiGravity
 *
 * @help
 * ============================================================================
 * Weapon 3D Models - Staves
 * ============================================================================
 *
 * One family per weapon type. This one owns every Staff weapon (wtypeId 6):
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
    console.error('[Weapon3D_Staves] WeaponSystemProcedural not loaded');
    return;
  }

  window.WeaponSystemProcedural.registerFamily({
    name: 'Weapon3D_Staves',
    unique: {
      273: 'createCarvedStickModel',                  // Carved Stick
      274: 'createWalkingStickModel',                 // Walking Stick
      275: 'createNoviceWandModel',                   // Novice Wand
      276: 'createApprenticeStaffModel',              // Apprentice Staff
      277: 'createSpikeUmbrellaModel',                // Spike Umbrella
      278: 'createSpikedCrutchModel',                 // Spiked Crutch
      279: 'createNailMopStaffModel',                 // Nail Mop Staff
      280: 'createRazorMopModel',                     // Razor Mop
      281: 'createBarbedHockeyStickModel',            // Barbed Hockey Stick
      282: 'createThrowingStickModel',                // Throwing Stick
      283: 'createWoodenStaffModel',                  // Wooden Staff
      284: 'createSeedStaffModel',                    // Seed Staff
      285: 'createQuarterstaffModel',                 // Quarterstaff
      286: 'createEscrimaSticksModel',                // Escrima Sticks
      287: 'createMagicWandModel',                    // Magic Wand
      288: 'createBubbleBlowerModel',                 // Bounce Bubble Blower
      289: 'createPeppermintScepterModel',            // Peppermint Scepter
      290: 'createForceWandModel',                    // Force Wand
      291: 'createFlexibleStaffModel',                // Flexible Staff
      292: 'createIronTonfaModel',                    // Iron Tonfa
      293: 'createWindStaffModel',                    // Wind Staff
      294: 'createThreeSectionStaffModel',            // Three-Section Staff
      295: 'createPetrifiedStaffModel',               // Petrified Staff
      296: 'createMithrilRodModel',                   // Mithril Rod
      297: 'createFourSectionStaffModel',             // Four-Section Staff
      298: 'createLightningStruckStaffModel',         // Lightning-Struck Staff
      299: 'createYggdrasilBranchModel',              // Yggdrasil Branch
      300: 'createThundercallerStaffModel',           // Thundercaller Staff
      301: 'createEyeOfInsightStaffModel',            // Eye of Insight Staff
      302: 'createSonicStaffModel',                   // Sonic Staff
      303: 'createWorldTreeStaffModel',               // World Tree Staff
      304: 'createWorldTreeBranchModel',              // World Tree Branch
      305: 'createUnicornHornStaffModel',             // Unicorn Horn Staff
      306: 'createSpellAbsorberModel',                // Spell Absorber
      307: 'createDragonStaffModel',                  // Dragon Staff
      308: 'createChronomancerStaffModel',            // Chronomancer's Staff
      309: 'createBarrierStaffModel',                 // Barrier Staff
      310: 'createGravityStaffModel',                 // Gravity Manipulation Staff
      311: 'createMindShieldStaffModel',              // Mind Shield Staff
      312: 'createArcaneSphereModel',                 // Arcane Sphere
      313: 'createMindProjectorStaffModel',           // Mind Projector Staff
      314: 'createMentalFortressStaffModel',          // Mental Fortress Staff
      315: 'createElementalWardenStaffModel',         // Elemental Warden Staff
      316: 'createVultureTotemStaffModel',            // Vulture Totem Staff
      317: 'createPsychicAmplifierCrownModel',        // Psychic Amplifier Crown
      318: 'createCelestialAlignmentRodModel',        // Celestial Alignment Rod
      319: 'createToxicAmplifierModel',               // EHI Toxic Amplifier
      320: 'createVarleniaArcaneStaffModel',          // Varlenia Arcane Staff
      321: 'createForbiddenCodexModel',               // EHI Forbidden Codex
      322: 'createStaffOfEternityModel',              // Staff of Eternity
      323: 'createPetroleumOmniscienceModel',         // EHI Petroleum Omniscience
      324: 'createUniversalForceStaffModel',          // Universal Force Staff
    },
    models: {
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

      /**
       * The pole every staff is mostly made of: shaft, optional ferrules at
       * each end, optional binding, and a butt cap. Returns the group so a
       * builder can go straight on to the head, which is the interesting part.
       */
      _staffShaft(group, mat, opts) {
        const o = opts || {};
        const len = o.length || 0.66;
        const rTop = o.rTop === undefined ? 0.016 : o.rTop;
        const rBot = o.rBot === undefined ? 0.019 : o.rBot;
        const mid = o.mid === undefined ? 0.16 : o.mid;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, this.seg(o.sides || 9, 6)), mat);
        shaft.position.y = mid;
        group.add(shaft);
        if (o.ferruleMat) {
          for (const y of [mid + len / 2 - 0.01, mid - len / 2 + 0.01]) {
            const f = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 1.25, rBot * 1.25, 0.02, this.seg(o.sides || 9, 6)), o.ferruleMat);
            f.position.y = y;
            group.add(f);
          }
        }
        if (o.wrapMat) {
          const n = this.isLowDetail() ? 3 : 5;
          for (let i = 0; i < n; i++) {
            const wrap = new THREE.Mesh(new THREE.TorusGeometry(rBot * 1.12, 0.004, this.seg(4, 3), this.seg(10, 6)), o.wrapMat);
            wrap.rotation.x = Math.PI / 2;
            wrap.position.y = (o.wrapAt === undefined ? -0.02 : o.wrapAt) - i * 0.03;
            group.add(wrap);
          }
        }
        if (o.buttMat) {
          const butt = new THREE.Mesh(new THREE.CylinderGeometry(rBot * 1.2, rBot * 0.9, 0.024, this.seg(o.sides || 9, 6)), o.buttMat);
          butt.position.y = mid - len / 2 - 0.012;
          group.add(butt);
        }
        return group;
      },

      // ---- 273: Carved Stick --------------------------------------------------
      createCarvedStickModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(this.getRandomColor(rand, [0x8B5A2B, 0x6E4A2A, 0xA0703C]));
        const cut = this._wood(0xD8BE90);
        this._staffShaft(group, wood, { length: 0.68, rTop: 0.015, rBot: 0.018, buttMat: wood });
        // Bands of chip carving, each a ring of notches around the shaft.
        const bands = this.isLowDetail() ? 3 : 6;
        for (let b = 0; b < bands; b++) {
          const y = -0.1 + b * 0.09;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + b * 0.4;
            const notch = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.012, 3), cut);
            notch.position.set(Math.cos(a) * 0.016, y, Math.sin(a) * 0.016);
            notch.rotation.set(Math.PI / 2, 0, -a);
            group.add(notch);
          }
        }
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.026, this.seg(10, 6), this.seg(7, 5)), wood);
        knob.position.y = 0.5;
        group.add(knob);
        return group;
      },

      // ---- 274: Walking Stick -------------------------------------------------
      createWalkingStickModel(weapon, rand) {
        const group = new THREE.Group();
        const polished = this._mat(this.getRandomColor(rand, [0x5C3317, 0x3A2A1C, 0x7A5230]), { roughness: 0.35, metalness: 0.08 });
        const brass = this._cast(0xB9902A);
        const rubber = this._mat(0x1A1A1C, { roughness: 0.95, metalness: 0.02 });
        this._staffShaft(group, polished, { length: 0.62, rTop: 0.013, rBot: 0.015, mid: 0.12 });
        // The crook, which is the whole silhouette.
        const crook = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.013, this.seg(6, 4), this.seg(14, 8), Math.PI * 1.15), polished);
        crook.position.set(-0.03, 0.44, 0);
        crook.rotation.set(0, Math.PI / 2, -0.4);
        group.add(crook);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, this.seg(11, 7)), brass);
        collar.position.y = 0.4;
        group.add(collar);
        const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.03, this.seg(10, 6)), rubber);
        ferrule.position.y = -0.2;
        group.add(ferrule);
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, this.seg(4, 3), this.seg(12, 7)), brass);
        band.rotation.x = Math.PI / 2;
        band.position.y = -0.18;
        group.add(band);
        return group;
      },

      // ---- 275: Novice Wand ---------------------------------------------------
      createNoviceWandModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x8B5A2B);
        const tape = this._wood(0x2A2A2A);
        const spark = this._glow(this.getRandomColor(rand, [0x9CD8FF, 0xFFD98A]), 0.6);
        const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.012, 0.3, this.seg(8, 5)), wood);
        wand.position.y = 0.06;
        group.add(wand);
        // A split near the tip, bound with tape: it has been dropped.
        for (let i = 0; i < 2; i++) {
          const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.004, this.seg(4, 3), this.seg(10, 6)), tape);
          wrap.rotation.x = Math.PI / 2;
          wrap.position.y = 0.15 + i * 0.02;
          group.add(wrap);
        }
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.009, this.seg(8, 5), this.seg(6, 4)), spark);
        tip.position.y = 0.215;
        tip.userData.pulse = { min: 0.1, max: 0.9, freq: 0.7 };
        group.add(tip);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.08, this.seg(9, 6)), tape);
        grip.position.y = -0.11;
        group.add(grip);
        return group;
      },

      // ---- 276: Apprentice Staff ----------------------------------------------
      createApprenticeStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x7A5230);
        const wire = this._cast(0x9A8A50);
        const crystalColor = this.getRandomColor(rand, this.crystalColors);
        const crystal = this._glow(crystalColor, 0.8);
        this._staffShaft(group, wood, { length: 0.66, wrapMat: wire, buttMat: wire });
        // A crystal that is not set so much as wired on, by somebody learning.
        const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), crystal);
        stone.position.y = 0.52;
        stone.userData.pulse = { min: 0.3, max: 1.0, freq: 0.9 };
        group.add(stone);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const claw = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.06, this.seg(6, 4)), wire);
          claw.position.set(Math.cos(a) * 0.016, 0.495, Math.sin(a) * 0.016);
          claw.rotation.set(0.4, -a, 0);
          group.add(claw);
        }
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.02, this.seg(10, 6)), wire);
        seat.position.y = 0.475;
        group.add(seat);
        return group;
      },

      // ---- 277: Spike Umbrella ------------------------------------------------
      createSpikeUmbrellaModel(weapon, rand) {
        const group = new THREE.Group();
        const canopyColor = this.getRandomColor(rand, [0x1E2A4A, 0x3A1F2A, 0x1F3A2A]);
        const canopy = this._mat(canopyColor, { roughness: 0.9, metalness: 0.05 });
        const steel = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.88 });
        const wood = this._wood(0x3A2A1C);
        this._staffShaft(group, steel, { length: 0.6, rTop: 0.008, rBot: 0.009, mid: 0.1 });
        // Half open, which is what makes it read as an umbrella at all.
        const ribs = this.isLowDetail() ? 5 : 8;
        for (let i = 0; i < ribs; i++) {
          const a = (i / ribs) * Math.PI * 2;
          const panel = this._plate([[0, 0], [0.05, -0.09], [0.09, -0.16], [0.02, -0.14]], 0.002, canopy);
          panel.position.set(0, 0.38, 0);
          panel.rotation.set(0, -a, 0);
          group.add(panel);
          const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.17, this.seg(6, 4)), steel);
          rib.position.set(Math.cos(a) * 0.05, 0.31, Math.sin(a) * 0.05);
          rib.rotation.set(0, -a, 1.0);
          group.add(rib);
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.03, this.seg(5, 4)), steel);
          spike.position.set(Math.cos(a) * 0.098, 0.235, Math.sin(a) * 0.098);
          spike.rotation.set(0, -a, -1.2);
          group.add(spike);
        }
        const ferruleTip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.06, this.seg(8, 5)), steel);
        ferruleTip.position.y = 0.44;
        group.add(ferruleTip);
        const runner = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.024, this.seg(10, 6)), steel);
        runner.position.y = 0.22;
        group.add(runner);
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.01, this.seg(5, 4), this.seg(12, 7), Math.PI), wood);
        handle.position.set(-0.024, -0.2, 0);
        handle.rotation.set(0, Math.PI / 2, -0.4);
        group.add(handle);
        return group;
      },

      // ---- 278: Spiked Crutch -------------------------------------------------
      createSpikedCrutchModel(weapon, rand) {
        const group = new THREE.Group();
        const alloy = this._mat(0x9BA1A7, { roughness: 0.45, metalness: 0.8 });
        const pad = this._mat(0x2A2A2E, { roughness: 0.95, metalness: 0.02 });
        const steel = this._mat(0x8A9096, { roughness: 0.35, metalness: 0.9 });
        const rust = this._mat(0x8A4B22, { roughness: 0.95, metalness: 0.3 });
        // Underarm crutch: two uprights, a grip bar between them, an armpit
        // pad on top and the business end at the bottom.
        for (const s of [-1, 1]) {
          const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, this.seg(8, 5)), alloy);
          upright.position.set(s * 0.028, 0.24, 0);
          upright.rotation.z = -s * 0.06;
          group.add(upright);
        }
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.3, this.seg(9, 6)), alloy);
        shaft.position.y = -0.08;
        group.add(shaft);
        const armPad = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.09, this.seg(11, 7)), pad);
        armPad.rotation.z = Math.PI / 2;
        armPad.position.y = 0.46;
        group.add(armPad);
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.07, this.seg(10, 6)), pad);
        bar.rotation.z = Math.PI / 2;
        bar.position.y = 0.16;
        group.add(bar);
        const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.011, 0.05, this.seg(10, 6)), alloy);
        yoke.position.y = 0.05;
        group.add(yoke);
        // Screws and spikes driven through the foot.
        const spikes = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < spikes; i++) {
          const a = (i / spikes) * Math.PI * 2;
          const sp = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.05, this.seg(5, 4)), steel);
          sp.position.set(Math.cos(a) * 0.014, -0.22, Math.sin(a) * 0.014);
          sp.rotation.set(Math.PI - 0.4, -a, 0);
          group.add(sp);
        }
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.03, this.seg(10, 6)), rust);
        foot.position.y = -0.22;
        group.add(foot);
        return group;
      },

      // ---- 279: Nail Mop Staff ------------------------------------------------
      createNailMopStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const handleWood = this._wood(0xC8A870);
        const band = this._mat(0x9BA1A7, { roughness: 0.55, metalness: 0.8 });
        const yarn = this._mat(0xD8D2C0, { roughness: 1.0, metalness: 0.0 });
        const nail = this._mat(0x8A9096, { roughness: 0.5, metalness: 0.85 });
        this._staffShaft(group, handleWood, { length: 0.6, rTop: 0.013, rBot: 0.013, mid: 0.06 });
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.018, 0.05, this.seg(11, 7)), band);
        collar.position.y = 0.38;
        group.add(collar);
        // The mop head, with nails pushed out through the strands.
        const strands = this.isLowDetail() ? 8 : 14;
        for (let i = 0; i < strands; i++) {
          const a = (i / strands) * Math.PI * 2;
          const r = 0.014 + rand() * 0.012;
          const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.003, 0.13 + rand() * 0.05, this.seg(5, 3)), yarn);
          strand.position.set(Math.cos(a) * r, 0.47, Math.sin(a) * r);
          strand.rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
          strand.userData.sway = { axis: 'z', amp: 0.1, freq: 1.0 + rand(), phase: i };
          group.add(strand);
        }
        const nails = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < nails; i++) {
          const a = (i / nails) * Math.PI * 2 + 0.3;
          const n = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.05, this.seg(6, 4)), nail);
          n.position.set(Math.cos(a) * 0.026, 0.46 + (i % 2) * 0.05, Math.sin(a) * 0.026);
          n.rotation.set(Math.PI / 2, 0, -a);
          group.add(n);
        }
        return group;
      },

      // ---- 280: Razor Mop -----------------------------------------------------
      createRazorMopModel(weapon, rand) {
        const group = new THREE.Group();
        const handleMat = this._mat(0x1D6FD6, { roughness: 0.6, metalness: 0.1 });
        const grey = this._mat(0x6E7378, { roughness: 0.5, metalness: 0.75 });
        const yarn = this._mat(0xC0392B, { roughness: 1.0, metalness: 0.0 });
        const blade = this._steel(0xC8CDD2, 0.2);
        this._staffShaft(group, handleMat, { length: 0.58, rTop: 0.012, rBot: 0.012, mid: 0.05 });
        const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.04, this.seg(11, 7)), grey);
        clamp.position.y = 0.36;
        group.add(clamp);
        // Blades sewn into the strands, which is why it is not a mop any more.
        const strands = this.isLowDetail() ? 7 : 12;
        for (let i = 0; i < strands; i++) {
          const a = (i / strands) * Math.PI * 2;
          const r = 0.016 + rand() * 0.01;
          const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0025, 0.14, this.seg(5, 3)), yarn);
          strand.position.set(Math.cos(a) * r, 0.44, Math.sin(a) * r);
          strand.rotation.z = (rand() - 0.5) * 0.35;
          strand.userData.sway = { axis: 'x', amp: 0.12, freq: 1.2 + rand(), phase: i };
          group.add(strand);
          if (i % 2 === 0) {
            const razor = this._plate([[-0.008, 0], [0.008, 0], [0.008, 0.02], [-0.008, 0.02]], 0.0015, blade);
            razor.position.set(Math.cos(a) * r * 1.2, 0.4 - (i % 3) * 0.03, Math.sin(a) * r * 1.2);
            razor.rotation.set(0, -a, (rand() - 0.5) * 0.6);
            group.add(razor);
          }
        }
        return group;
      },

      // ---- 281: Barbed Hockey Stick -------------------------------------------
      createBarbedHockeyStickModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0xD8BE90);
        const tape = this._wood(0x1A1A1C);
        const wire = this._mat(0x7A6A5A, { roughness: 0.85, metalness: 0.5 });
        const stripeColor = this.getRandomColor(rand, [0xC0392B, 0x1D6FD6, 0x1E9B4B]);
        const stripe = this._mat(stripeColor, { roughness: 0.7, metalness: 0.05 });
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.6, 0.016), wood);
        shaft.position.y = 0.12;
        group.add(shaft);
        // The blade, kicked out at the bottom.
        const blade = this._plate([[0, 0], [0.13, -0.01], [0.14, -0.05], [0, -0.05]], 0.014, wood);
        blade.position.set(0.008, -0.2, 0);
        group.add(blade);
        const toe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.016), wood);
        toe.position.set(0.14, -0.22, 0);
        group.add(toe);
        for (let i = 0; i < 4; i++) {
          const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.018), tape);
          t.position.set(0.02 + i * 0.03, -0.222, 0);
          group.add(t);
        }
        // Barbed wire wound up the shaft.
        const coils = this.isLowDetail() ? 5 : 9;
        for (let i = 0; i < coils; i++) {
          const y = -0.12 + i * 0.048;
          const coil = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0022, this.seg(4, 3), this.seg(10, 6)), wire);
          coil.rotation.set(Math.PI / 2 + 0.2, 0, i * 0.5);
          coil.position.y = y;
          group.add(coil);
          const barb = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.012, 3), wire);
          barb.position.set(0.017, y, 0);
          barb.rotation.z = -Math.PI / 2;
          group.add(barb);
        }
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.14, 0.018), tape);
        grip.position.y = 0.34;
        group.add(grip);
        const flash = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.03, 0.019), stripe);
        flash.position.y = 0.24;
        group.add(flash);
        return group;
      },

      // ---- 282: Throwing Stick ------------------------------------------------
      createThrowingStickModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(this.getRandomColor(rand, [0x8B5A2B, 0x6E4A2A]));
        const burn = this._wood(0x3A2A1C);
        const cord = this._wood(0xB89A5A);
        // A rabbit stick: one heavy curve, weighted at the far end, meant to
        // be thrown flat.
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.34, this.seg(9, 6)), wood);
        arm.position.set(0.02, 0.16, 0);
        arm.rotation.z = -0.24;
        group.add(arm);
        const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.017, 0.24, this.seg(9, 6)), wood);
        lower.position.set(-0.02, -0.1, 0);
        lower.rotation.z = 0.2;
        group.add(lower);
        const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(10, 6), this.seg(7, 5)), wood);
        elbow.position.set(0.008, 0.02, 0);
        group.add(elbow);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, this.seg(10, 6), this.seg(7, 5)), wood);
        head.scale.set(1, 1.2, 0.8);
        head.position.set(0.06, 0.31, 0);
        group.add(head);
        // Fire-hardened bands and a grip wrap.
        if (this.wantsTrim()) {
          for (let i = 0; i < 4; i++) {
            const band = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, this.seg(4, 3), this.seg(10, 6)), burn);
            band.rotation.x = Math.PI / 2;
            band.position.set(0.03 - i * 0.006, 0.1 + i * 0.05, 0);
            band.rotation.z = -0.24;
            group.add(band);
          }
        }
        for (let i = 0; i < 3; i++) {
          const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.004, this.seg(4, 3), this.seg(10, 6)), cord);
          wrap.rotation.x = Math.PI / 2;
          wrap.position.set(-0.024, -0.14 - i * 0.026, 0);
          group.add(wrap);
        }
        return group;
      },

      // ---- 283: Wooden Staff --------------------------------------------------
      createWoodenStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(this.getRandomColor(rand, [0x8B5A2B, 0xA0703C, 0x6E4A2A]));
        const worn = this._wood(0x5C4033);
        this._staffShaft(group, wood, { length: 0.76, rTop: 0.017, rBot: 0.017, mid: 0.14, buttMat: worn });
        // Nothing on it but the shine where hands have been.
        for (let i = 0; i < 2; i++) {
          const polish = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.09, this.seg(10, 6)), worn);
          polish.position.y = 0.02 + i * 0.16;
          group.add(polish);
        }
        const knotCount = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < knotCount; i++) {
          const a = rand() * Math.PI * 2;
          const y = -0.18 + rand() * 0.66;
          const k = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(6, 4), this.seg(5, 4)), worn);
          k.scale.set(1, 1.4, 0.4);
          k.position.set(Math.cos(a) * 0.017, y, Math.sin(a) * 0.017);
          group.add(k);
        }
        return group;
      },

      // ---- 284: Seed Staff ----------------------------------------------------
      createSeedStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const bark = this._wood(0x5B4227);
        const leafColor = this.getRandomColor(rand, [0x4E9A3A, 0x6BBF48, 0x357A2E]);
        const leaf = this._mat(leafColor, { roughness: 0.6, metalness: 0.05 });
        const husk = this._mat(0xC8A02A, { roughness: 0.55, metalness: 0.1 });
        const sap = this._glow(0xB8FF5A, 0.7);
        this._staffShaft(group, bark, { length: 0.66, sides: 7 });
        // A pod at the head, split, with the seed lit inside it.
        const pod = new THREE.Mesh(new THREE.SphereGeometry(0.042, this.seg(11, 7), this.seg(8, 5)), husk);
        pod.scale.y = 1.4;
        pod.position.y = 0.52;
        group.add(pod);
        const split = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.07, 0.05), sap);
        split.position.set(0, 0.52, 0.02);
        split.userData.pulse = { min: 0.3, max: 1.1, freq: 1.0 };
        group.add(split);
        const seed = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(9, 6), this.seg(7, 5)), sap);
        seed.position.y = 0.52;
        seed.userData.pulse = { min: 0.5, max: 1.3, freq: 1.4 };
        group.add(seed);
        // Vines up the shaft, and a shoot that moves.
        for (let i = 0; i < 5; i++) {
          const coil = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.003, this.seg(4, 3), this.seg(9, 6)), leaf);
          coil.position.y = 0.06 + i * 0.07;
          coil.rotation.set(Math.PI / 2 + 0.22, 0, i * 0.7);
          group.add(coil);
        }
        const shoot = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, this.seg(6, 4)), leaf);
        shoot.position.set(0.03, 0.42, 0);
        shoot.rotation.z = -0.9;
        shoot.userData.sway = { axis: 'z', amp: 0.16, freq: 1.2 };
        group.add(shoot);
        return group;
      },

      // ---- 285: Quarterstaff --------------------------------------------------
      createQuarterstaffModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0xD8BE90);
        const iron = this._mat(0x4A4F55, { roughness: 0.6, metalness: 0.78 });
        const leather = this._wood(0x4A3524);
        this._staffShaft(group, ash, { length: 0.86, rTop: 0.017, rBot: 0.017, mid: 0.16 });
        // Iron shod at both ends, which is what a quarterstaff is.
        for (const y of [0.59, -0.27]) {
          const shoe = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, this.seg(11, 7)), iron);
          shoe.position.y = y;
          group.add(shoe);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.004, this.seg(4, 3), this.seg(12, 7)), iron);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = y + (y > 0 ? -0.03 : 0.03);
          group.add(ring);
        }
        // Two grip wraps, a hand's width apart.
        for (let g = 0; g < 2; g++) {
          for (let i = 0; i < 3; i++) {
            const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, this.seg(4, 3), this.seg(10, 6)), leather);
            wrap.rotation.x = Math.PI / 2;
            wrap.position.y = 0.06 + g * 0.16 + i * 0.024;
            group.add(wrap);
          }
        }
        return group;
      },

      // ---- 286: Escrima Sticks ------------------------------------------------
      createEscrimaSticksModel(weapon, rand) {
        const group = new THREE.Group();
        const rattan = this._wood(0xC8A870);
        const char = this._wood(0x6B4423);
        const cord = this._wood(0x1A1A1C);
        const build = (x, z, tilt, scale) => {
          const s = new THREE.Group();
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.015, 0.42, this.seg(10, 6)), rattan);
          s.add(stick);
          // Scorched nodes, the marks rattan always carries.
          for (let i = 0; i < 3; i++) {
            const node = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.003, this.seg(4, 3), this.seg(10, 6)), char);
            node.rotation.x = Math.PI / 2;
            node.position.y = -0.12 + i * 0.12;
            s.add(node);
          }
          for (let i = 0; i < 3; i++) {
            const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, this.seg(4, 3), this.seg(10, 6)), cord);
            wrap.rotation.x = Math.PI / 2;
            wrap.position.y = -0.17 + i * 0.022;
            s.add(wrap);
          }
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.015, this.seg(9, 6), this.seg(6, 4)), rattan);
          cap.scale.y = 0.6;
          cap.position.y = 0.21;
          s.add(cap);
          s.position.set(x, 0.1, z);
          s.rotation.z = tilt;
          s.scale.setScalar(scale);
          return s;
        };
        group.add(build(-0.03, 0, 0.14, 1.0));
        group.add(build(0.035, -0.035, -0.18, 0.94));
        return group;
      },

      // ---- 287: Magic Wand ----------------------------------------------------
      createMagicWandModel(weapon, rand) {
        const group = new THREE.Group();
        const wand = this._mat(0x1A1A1E, { roughness: 0.3, metalness: 0.3 });
        const tipMat = this._mat(0xF4F0E0, { roughness: 0.4, metalness: 0.1 });
        const starColor = this.getRandomColor(rand, [0xFFD98A, 0x9CD8FF, 0xFF9CD8]);
        const star = this._glow(starColor, 1.2);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.32, this.seg(10, 6)), wand);
        rod.position.y = 0.06;
        group.add(rod);
        const whiteTip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, this.seg(10, 6)), tipMat);
        whiteTip.position.y = 0.2;
        group.add(whiteTip);
        const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, this.seg(10, 6)), tipMat);
        butt.position.y = -0.08;
        group.add(butt);
        // The star: a five-point plate that turns, with motes going round it.
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
          const r = i % 2 === 0 ? 0.036 : 0.015;
          pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        const plate = this._plate(pts, 0.006, star);
        plate.position.y = 0.26;
        plate.userData.spin = { axis: 'y', speed: 0.8 };
        plate.userData.pulse = { min: 0.5, max: 1.4, freq: 1.2 };
        group.add(plate);
        const motes = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < motes; i++) {
          const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.006, 0), star);
          mote.position.y = 0.26;
          mote.userData.orbit = { radius: 0.05 + i * 0.006, speed: 1.0 + i * 0.3, phase: i * 1.6, plane: 'xz' };
          mote.userData.pulse = { min: 0.2, max: 1.3, freq: 2.0, phase: i };
          group.add(mote);
        }
        return group;
      },

      // ---- 288: Bounce Bubble Blower ------------------------------------------
      createBubbleBlowerModel(weapon, rand) {
        const group = new THREE.Group();
        const plastic = this._mat(this.getRandomColor(rand, [0x35C6E8, 0xE8459B, 0x8AE835]), { roughness: 0.45, metalness: 0.06 });
        const yellow = this._mat(0xF5C518, { roughness: 0.5, metalness: 0.06 });
        const soap = this._mat(0xBFE8F0, { roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.35 });
        const film = this._glow(0xBFE8F0, 0.35);
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.2, this.seg(10, 6)), plastic);
        handle.position.y = -0.06;
        group.add(handle);
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.1, this.seg(12, 7)), soap);
        bottle.position.y = 0.09;
        group.add(bottle);
        const level = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.05, this.seg(12, 7)), film);
        level.position.y = 0.07;
        level.userData.pulse = { min: 0.2, max: 0.5, freq: 0.6 };
        group.add(level);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.03, this.seg(11, 7)), yellow);
        cap.position.y = 0.155;
        group.add(cap);
        // The loop, with a film across it that catches the light.
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, this.seg(5, 4), this.seg(16, 9)), yellow);
        loop.position.y = 0.28;
        loop.rotation.x = 0.3;
        group.add(loop);
        const membrane = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.001, this.seg(16, 9)), film);
        membrane.position.y = 0.28;
        membrane.rotation.x = Math.PI / 2 + 0.3;
        membrane.userData.pulse = { min: 0.1, max: 0.6, freq: 1.4 };
        group.add(membrane);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, this.seg(8, 5)), yellow);
        stem.position.y = 0.2;
        group.add(stem);
        // Bubbles already loose, drifting.
        const bubbles = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < bubbles; i++) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.012 + rand() * 0.014, this.seg(10, 6), this.seg(8, 5)), soap);
          b.position.set((rand() - 0.5) * 0.06, 0.34 + i * 0.03, (rand() - 0.5) * 0.06);
          b.userData.orbit = { radius: 0.03 + rand() * 0.03, speed: 0.4 + rand() * 0.5, phase: i * 1.4, plane: 'xz' };
          b.userData.bob = { axis: 'y', amp: 0.02, freq: 0.5 + rand() * 0.4, phase: i };
          group.add(b);
        }
        return group;
      },

      // ---- 289: Peppermint Scepter --------------------------------------------
      createPeppermintScepterModel(weapon, rand) {
        const group = new THREE.Group();
        const white = this._mat(0xF6F2EC, { roughness: 0.3, metalness: 0.08 });
        const red = this._mat(0xD62828, { roughness: 0.3, metalness: 0.08 });
        const gold = this._cast(0xD9A62A);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.56, this.seg(12, 7)), white);
        shaft.position.y = 0.06;
        group.add(shaft);
        // The stripe, wound as real rings rather than painted on.
        const stripes = this.isLowDetail() ? 7 : 13;
        for (let i = 0; i < stripes; i++) {
          const t = i / stripes;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0185 - t * 0.001, 0.005, this.seg(4, 3), this.seg(12, 7)), red);
          ring.rotation.set(Math.PI / 2 + 0.25, 0, 0);
          ring.position.y = -0.2 + i * 0.043;
          group.add(ring);
        }
        // The crook at the top, striped too.
        const crook = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.017, this.seg(6, 4), this.seg(16, 9), Math.PI * 1.1), white);
        crook.position.set(-0.036, 0.36, 0);
        crook.rotation.set(0, Math.PI / 2, -0.35);
        group.add(crook);
        for (let i = 0; i < 4; i++) {
          const a = -0.2 + i * 0.7;
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, this.seg(4, 3), this.seg(10, 6)), red);
          band.position.set(-0.036 + Math.cos(a) * 0.042, 0.36 + Math.sin(a) * 0.042, 0);
          band.rotation.set(0, 0, a);
          group.add(band);
        }
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.014, this.seg(12, 7)), gold);
        collar.position.y = 0.31;
        group.add(collar);
        const finial = new THREE.Mesh(new THREE.SphereGeometry(0.022, this.seg(11, 7), this.seg(8, 5)), red);
        finial.position.y = -0.24;
        group.add(finial);
        return group;
      },

      // ---- 290: Force Wand ----------------------------------------------------
      createForceWandModel(weapon, rand) {
        const group = new THREE.Group();
        const alloy = this._mat(0xB0B6BC, { roughness: 0.25, metalness: 0.93 });
        const dark = this._mat(0x1E2126, { roughness: 0.55, metalness: 0.75 });
        const fieldColor = this.getRandomColor(rand, [0x7DD3FF, 0xC77DFF]);
        const field = this._glow(fieldColor, 1.2);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.3, this.seg(10, 6)), alloy);
        rod.position.y = 0.02;
        group.add(rod);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.1, this.seg(10, 6)), dark);
        grip.position.y = -0.16;
        group.add(grip);
        // Emitter rings held apart on struts, with the field standing between.
        const rings = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < rings; i++) {
          const r = 0.03 - i * 0.004;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, this.seg(4, 3), this.seg(14, 8)), alloy);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.2 + i * 0.035;
          ring.userData.spin = { axis: 'y', speed: (i % 2 ? 1 : -1) * (0.5 + i * 0.2) };
          group.add(ring);
          const glow = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, 0.002, this.seg(4, 3), this.seg(14, 8)), field);
          glow.rotation.x = Math.PI / 2;
          glow.position.y = 0.2 + i * 0.035;
          glow.userData.pulse = { min: 0.1, max: 1.4, freq: 2.0, phase: -i * 0.7 };
          group.add(glow);
        }
        for (const s of [-1, 1]) {
          const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.16, this.seg(6, 4)), alloy);
          strut.position.set(s * 0.028, 0.26, 0);
          group.add(strut);
        }
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.014, this.seg(10, 6), this.seg(8, 5)), field);
        core.position.y = 0.27;
        core.userData.pulse = { min: 0.5, max: 1.5, freq: 1.3 };
        group.add(core);
        return group;
      },

      // ---- 291: Flexible Staff ------------------------------------------------
      createFlexibleStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const cane = this._wood(0xC8A870);
        const wrap = this._wood(0x3A2A1C);
        // Built as a curve rather than a cylinder, so the whip in it reads
        // even standing still.
        const segs = this.isLowDetail() ? 6 : 10;
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < segs; i++) {
          const t = i / segs;
          const t2 = (i + 1) / segs;
          const y1 = -0.28 + t * 0.8, y2 = -0.28 + t2 * 0.8;
          const x1 = Math.sin(t * 2.2) * 0.05, x2 = Math.sin(t2 * 2.2) * 0.05;
          const a = new THREE.Vector3(x1, y1, 0), b = new THREE.Vector3(x2, y2, 0);
          const dir = b.clone().sub(a);
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.016 - t * 0.008, 0.017 - t * 0.008, dir.length() * 1.05, this.seg(8, 5)), cane);
          seg.position.copy(a).add(b).multiplyScalar(0.5);
          seg.quaternion.setFromUnitVectors(up, dir.clone().normalize());
          seg.userData.sway = { axis: 'z', amp: 0.03 * t, freq: 1.6, phase: t * 2 };
          group.add(seg);
        }
        for (let i = 0; i < 4; i++) {
          const w = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, this.seg(4, 3), this.seg(10, 6)), wrap);
          w.rotation.x = Math.PI / 2;
          w.position.y = -0.24 + i * 0.03;
          group.add(w);
        }
        return group;
      },

      // ---- 292: Iron Tonfa ----------------------------------------------------
      createIronTonfaModel(weapon, rand) {
        const group = new THREE.Group();
        const iron = this._mat(0x4A4F55, { roughness: 0.5, metalness: 0.82 });
        const grip = this._mat(0x1A1A1C, { roughness: 0.9, metalness: 0.05 });
        const bright = this._mat(0x8A9096, { roughness: 0.35, metalness: 0.9 });
        // The side handle is the whole idea: the shaft runs along the forearm
        // and pivots about the grip.
        const build = (x, z, tilt, scale) => {
          const t = new THREE.Group();
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.44, this.seg(10, 6)), iron);
          t.add(shaft);
          for (const y of [0.22, -0.22]) {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.02, this.seg(11, 7)), bright);
            cap.position.y = y;
            t.add(cap);
          }
          const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.019, 0.03, this.seg(11, 7)), iron);
          knob.position.y = 0.155;
          t.add(knob);
          const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.015, 0.09, this.seg(10, 6)), grip);
          handle.rotation.z = Math.PI / 2;
          handle.position.set(0.058, 0.1, 0);
          t.add(handle);
          const collarMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.024, this.seg(11, 7)), bright);
          collarMesh.rotation.z = Math.PI / 2;
          collarMesh.position.set(0.024, 0.1, 0);
          t.add(collarMesh);
          const end = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(9, 6), this.seg(7, 5)), grip);
          end.position.set(0.1, 0.1, 0);
          t.add(end);
          t.position.set(x, 0.06, z);
          t.rotation.z = tilt;
          t.scale.setScalar(scale);
          return t;
        };
        group.add(build(-0.03, 0, 0.1, 1.0));
        group.add(build(0.05, -0.05, -0.14, 0.93));
        return group;
      },

      // ---- 293: Wind Staff ----------------------------------------------------
      createWindStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const pale = this._wood(0xD8CFBA);
        const silver = this._cast(0xC0C6CC);
        const ribbonColor = this.getRandomColor(rand, this.ribbonColors);
        const ribbon = this._mat(ribbonColor, { roughness: 0.9, metalness: 0.05 });
        const air = this._glow(0xCFF0FF, 0.5);
        this._staffShaft(group, pale, { length: 0.62, rTop: 0.013, rBot: 0.015, sides: 7 });
        // Open rings at the head: it is hollow, and that is the point.
        const rings = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < rings; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05 - i * 0.008, 0.005, this.seg(5, 4), this.seg(16, 9)), silver);
          ring.position.y = 0.46 + i * 0.03;
          ring.rotation.set(0.5 + i * 0.3, i * 0.7, 0);
          ring.userData.spin = { axis: 'y', speed: (i % 2 ? 1 : -1) * (0.5 + i * 0.25) };
          group.add(ring);
        }
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(10, 6), this.seg(8, 5)), air);
        eye.position.y = 0.5;
        eye.userData.pulse = { min: 0.2, max: 0.8, freq: 0.9 };
        group.add(eye);
        // Streamers that never hang still.
        for (let i = 0; i < 3; i++) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.002), ribbon);
          strip.position.set((i - 1) * 0.014, 0.36, 0.01);
          strip.userData.sway = { axis: 'z', amp: 0.3, freq: 1.1 + i * 0.2, phase: i * 1.3 };
          group.add(strip);
        }
        return group;
      },

      // ---- 294: Three-Section Staff -------------------------------------------
      createThreeSectionStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6B4423);
        const iron = this._mat(0x5A5F66, { roughness: 0.45, metalness: 0.85 });
        // Held section, then two more on chains: the second and third only
        // exist where the physics puts them.
        const held = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.018, 0.26, this.seg(10, 6)), wood);
        held.position.y = -0.13;
        group.add(held);
        for (const y of [-0.005, -0.255]) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.016, this.seg(11, 7)), iron);
          cap.position.y = y;
          group.add(cap);
        }
        let anchorY = 0.01;
        for (let s = 0; s < 2; s++) {
          const head = this.chainRig(group, {
            links: 3, length: 0.05, linkMat: iron, linkRadius: 0.009, linkTube: 0.003,
            y: anchorY, endMass: 3.2, damping: 0.9
          });
          const sec = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.018, 0.26, this.seg(10, 6)), wood);
          sec.position.y = 0.13;
          head.add(sec);
          for (const dy of [0.006, 0.254]) {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.016, this.seg(11, 7)), iron);
            cap.position.y = dy;
            head.add(cap);
          }
          anchorY += 0.31;
        }
        return group;
      },

      // ---- 295: Petrified Staff -----------------------------------------------
      createPetrifiedStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const stone = this._mat(this.getRandomColor(rand, [0x76797E, 0x8A7A6A, 0x6A6259]), { roughness: 0.96, metalness: 0.06 });
        const agate = this._mat(0xB08A5A, { roughness: 0.25, metalness: 0.2 });
        const crack = this._mat(0x3A3530, { roughness: 1.0, metalness: 0.0 });
        // Wood grain turned to stone: the rings are still there, in mineral.
        this._staffShaft(group, stone, { length: 0.7, rTop: 0.019, rBot: 0.022, sides: 7 });
        const rings = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < rings; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.004, this.seg(4, 3), 7), agate);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = -0.16 + i * 0.11;
          group.add(ring);
        }
        const cracks = this.isLowDetail() ? 2 : 5;
        for (let i = 0; i < cracks; i++) {
          const a = rand() * Math.PI * 2;
          const c = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.08 + rand() * 0.08, 0.006), crack);
          c.position.set(Math.cos(a) * 0.02, -0.1 + rand() * 0.5, Math.sin(a) * 0.02);
          c.rotation.set(0, -a, (rand() - 0.5) * 0.5);
          group.add(c);
        }
        // A broken top, where the branch snapped before it fossilised.
        const stump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.03, 0), stone);
        stump.position.y = 0.53;
        stump.rotation.set(rand(), rand(), rand());
        group.add(stump);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 7), agate);
        core.position.y = 0.55;
        group.add(core);
        return group;
      },

      // ---- 296: Mithril Rod ---------------------------------------------------
      createMithrilRodModel(weapon, rand) {
        const group = new THREE.Group();
        const mithril = this._mat(0xEAF1F6, { roughness: 0.08, metalness: 0.96 });
        const veinColor = this.getRandomColor(rand, [0xAEE8FF, 0xD6C4FF, 0xC2FFE4]);
        const vein = this._glow(veinColor, 0.9);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.56, this.seg(12, 7)), mithril);
        rod.position.y = 0.08;
        group.add(rod);
        // A single spiral vein running the whole length, in short segments.
        const turns = this.isLowDetail() ? 8 : 16;
        for (let i = 0; i < turns; i++) {
          const t = i / turns;
          const a = t * Math.PI * 5;
          const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0035, this.seg(6, 4), this.seg(5, 4)), vein);
          bead.position.set(Math.cos(a) * 0.014, -0.2 + t * 0.56, Math.sin(a) * 0.014);
          bead.userData.pulse = { min: 0.1, max: 1.2, freq: 1.6, phase: -t * 6 };
          group.add(bead);
        }
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.005, this.seg(4, 3), this.seg(14, 8)), mithril);
        collar.rotation.x = Math.PI / 2;
        collar.position.y = 0.32;
        group.add(collar);
        const drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.024, 0), vein);
        drop.scale.y = 1.6;
        drop.position.y = 0.4;
        drop.userData.spin = { axis: 'y', speed: 0.7 };
        drop.userData.pulse = { min: 0.4, max: 1.3, freq: 1.1 };
        group.add(drop);
        const butt = new THREE.Mesh(new THREE.SphereGeometry(0.017, this.seg(10, 6), this.seg(7, 5)), mithril);
        butt.position.y = -0.2;
        group.add(butt);
        return group;
      },

      // ---- 297: Four-Section Staff --------------------------------------------
      createFourSectionStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x5C3317);
        const iron = this._mat(0x4A4F55, { roughness: 0.5, metalness: 0.82 });
        const brass = this._cast(0xB9902A);
        // Same idea as the three-section, one link further out of control.
        const held = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.2, this.seg(10, 6)), wood);
        held.position.y = -0.1;
        group.add(held);
        const grip = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, this.seg(4, 3), this.seg(10, 6)), brass);
        grip.rotation.x = Math.PI / 2;
        grip.position.y = -0.14;
        group.add(grip);
        let anchorY = 0.005;
        for (let s = 0; s < 3; s++) {
          const head = this.chainRig(group, {
            links: 3, length: 0.045, linkMat: iron, linkRadius: 0.008, linkTube: 0.0028,
            y: anchorY, endMass: 2.8 - s * 0.4, damping: 0.9
          });
          const sec = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.2, this.seg(10, 6)), wood);
          sec.position.y = 0.1;
          head.add(sec);
          for (const dy of [0.005, 0.195]) {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.014, this.seg(11, 7)), iron);
            cap.position.y = dy;
            head.add(cap);
          }
          anchorY += 0.245;
        }
        return group;
      },

      // ---- 298: Lightning-Struck Staff ----------------------------------------
      createLightningStruckStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const charred = this._wood(0x241C18);
        const raw = this._wood(0x8A6236);
        const fulgurite = this._mat(0x9A8A70, { roughness: 0.4, metalness: 0.25 });
        const arc = this._glow(0x9CE4FF, 1.3);
        this._staffShaft(group, charred, { length: 0.68, rTop: 0.017, rBot: 0.02, sides: 7 });
        // The strike scar: a spiral of exposed wood and glassed sand where the
        // bolt went down it.
        const marks = this.isLowDetail() ? 6 : 11;
        for (let i = 0; i < marks; i++) {
          const t = i / marks;
          const a = t * Math.PI * 3.6;
          const scar = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.008), raw);
          scar.position.set(Math.cos(a) * 0.018, -0.15 + t * 0.62, Math.sin(a) * 0.018);
          scar.rotation.set(0, -a, 0.4);
          group.add(scar);
          if (i % 2 === 0) {
            const glass = new THREE.Mesh(new THREE.OctahedronGeometry(0.008, 0), fulgurite);
            glass.position.set(Math.cos(a) * 0.021, -0.15 + t * 0.62, Math.sin(a) * 0.021);
            group.add(glass);
          }
        }
        // The split top, still carrying a charge.
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const prong = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.09, this.seg(5, 4)), charred);
          prong.position.set(Math.cos(a) * 0.012, 0.55, Math.sin(a) * 0.012);
          prong.rotation.set(0.3, -a, 0.2);
          group.add(prong);
        }
        const rungs = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < rungs; i++) {
          const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.003, 0.003), arc);
          bolt.position.y = 0.55 + i * 0.02;
          bolt.rotation.set(0, i * 1.1, (i % 2 ? 1 : -1) * 0.4);
          bolt.userData.pulse = { min: 0.0, max: 1.7, freq: 6 + i * 2, phase: i * 1.9 };
          group.add(bolt);
        }
        return group;
      }
,

      // ---- 299: Yggdrasil Branch ----------------------------------------------
      createYggdrasilBranchModel(weapon, rand) {
        const group = new THREE.Group();
        const bark = this._wood(0x6B4A2A);
        const leaf = this._mat(0x4E9A3A, { roughness: 0.6, metalness: 0.05 });
        const gold = this._glow(0xFFE08A, 0.8);
        const frost = this._glow(0xCFF0FF, 0.5);
        this._staffShaft(group, bark, { length: 0.6, rTop: 0.014, rBot: 0.019, sides: 7 });
        // Three lesser branches, one per world it still touches.
        const worlds = [[0.06, 0.42, leaf], [-0.05, 0.5, gold], [0.02, 0.56, frost]];
        for (let i = 0; i < worlds.length; i++) {
          const [x, y, mat] = worlds[i];
          const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.008, 0.1, this.seg(7, 5)), bark);
          twig.position.set(x * 0.5, y - 0.04, 0);
          twig.rotation.z = -x * 8;
          group.add(twig);
          const orb = new THREE.Mesh(new THREE.SphereGeometry(0.02, this.seg(11, 7), this.seg(8, 5)), mat);
          orb.position.set(x, y, 0);
          orb.userData.orbit = { radius: 0.012, speed: 0.4 + i * 0.2, phase: i * 2, plane: 'xz' };
          orb.userData.pulse = { min: 0.3, max: 1.1, freq: 0.8, phase: i };
          group.add(orb);
        }
        const foliage = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < foliage; i++) {
          const a = (i / foliage) * Math.PI * 2;
          const l = this._plate([[0, 0], [0.02, 0.014], [0.03, 0.04], [0.006, 0.03]], 0.003, leaf);
          l.position.set(Math.cos(a) * 0.02, 0.36 + (i % 3) * 0.06, Math.sin(a) * 0.02);
          l.rotation.set(0, -a, 0.4);
          l.userData.sway = { axis: 'z', amp: 0.12, freq: 1.0 + (i % 3) * 0.2, phase: i };
          group.add(l);
        }
        const root = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.06, this.seg(7, 5)), bark);
        root.position.y = -0.24;
        root.rotation.x = Math.PI;
        group.add(root);
        return group;
      },

      // ---- 300: Thundercaller Staff -------------------------------------------
      createThundercallerStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._wood(0x2A241C);
        const copper = this._mat(0xB87333, { roughness: 0.3, metalness: 0.9 });
        const arc = this._glow(0x9CE4FF, 1.4);
        const cloud = this._mat(0x4A4F58, { roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0.6 });
        this._staffShaft(group, dark, { length: 0.62, wrapMat: copper });
        // A cloud held at the head, with the storm still in it.
        for (let i = 0; i < 3; i++) {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(0.03 - i * 0.004, this.seg(10, 6), this.seg(7, 5)), cloud);
          puff.position.set((i - 1) * 0.028, 0.5 + (i % 2) * 0.014, (i - 1) * 0.012);
          puff.userData.bob = { axis: 'y', amp: 0.008, freq: 0.6, phase: i };
          group.add(puff);
        }
        // Rods reaching up into it, and the discharge between them.
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.09, this.seg(6, 4)), copper);
          rod.position.set(Math.cos(a) * 0.02, 0.44, Math.sin(a) * 0.02);
          rod.rotation.set(0.25, -a, 0);
          group.add(rod);
        }
        const bolts = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < bolts; i++) {
          const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.003, 0.003), arc);
          bolt.position.set(0, 0.47 + (i % 3) * 0.02, 0);
          bolt.rotation.set(0, i * 1.05, (i % 2 ? 1 : -1) * 0.5);
          bolt.userData.pulse = { min: 0.0, max: 1.8, freq: 7 + i, phase: i * 1.7 };
          group.add(bolt);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, this.seg(4, 3), this.seg(14, 8)), copper);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.4;
        ring.userData.spin = { axis: 'y', speed: 0.8 };
        group.add(ring);
        return group;
      },

      // ---- 301: Eye of Insight Staff ------------------------------------------
      createEyeOfInsightStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const bone = this._mat(0xD8CFBA, { roughness: 0.7, metalness: 0.05 });
        const gold = this._cast(0xD9A62A);
        const sclera = this._mat(0xF0EDE4, { roughness: 0.25, metalness: 0.05 });
        const irisColor = this.getRandomColor(rand, [0x2E86DE, 0x27AE60, 0x8B4513]);
        const iris = this._glow(irisColor, 0.8);
        const pupil = this._mat(0x0A0A0C, { roughness: 0.2, metalness: 0.1 });
        this._staffShaft(group, bone, { length: 0.6, ferruleMat: gold });
        // A real eye in a socket of gold lids, and it does look around.
        const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.042, this.seg(14, 8), this.seg(10, 6)), sclera);
        eyeball.position.y = 0.5;
        group.add(eyeball);
        const irisMesh = new THREE.Mesh(new THREE.SphereGeometry(0.018, this.seg(11, 7), this.seg(8, 5)), iris);
        irisMesh.position.set(0, 0.5, 0.03);
        irisMesh.userData.orbit = { radius: 0.016, speed: 0.5, plane: 'xy' };
        irisMesh.userData.pulse = { min: 0.4, max: 1.0, freq: 0.7 };
        group.add(irisMesh);
        const pupilMesh = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(9, 6), this.seg(7, 5)), pupil);
        pupilMesh.position.set(0, 0.5, 0.045);
        pupilMesh.userData.orbit = { radius: 0.017, speed: 0.5, plane: 'xy' };
        group.add(pupilMesh);
        for (const s of [-1, 1]) {
          const lid = new THREE.Mesh(new THREE.SphereGeometry(0.045, this.seg(12, 7), this.seg(8, 5), 0, Math.PI * 2, 0, Math.PI / 3), gold);
          lid.position.y = 0.5;
          lid.rotation.x = s > 0 ? 0 : Math.PI;
          group.add(lid);
        }
        const lashes = this.isLowDetail() ? 4 : 7;
        for (let i = 0; i < lashes; i++) {
          const a = -0.9 + (i / (lashes - 1)) * 1.8;
          const lash = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.026, this.seg(5, 3)), gold);
          lash.position.set(Math.sin(a) * 0.044, 0.53 + Math.cos(a) * 0.014, 0.012);
          lash.rotation.z = -a;
          group.add(lash);
        }
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.03, this.seg(12, 7)), gold);
        collar.position.y = 0.45;
        group.add(collar);
        return group;
      },

      // ---- 302: Sonic Staff ---------------------------------------------------
      createSonicStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._mat(0xB0B6BC, { roughness: 0.2, metalness: 0.94 });
        const dark = this._mat(0x24262A, { roughness: 0.6, metalness: 0.7 });
        const tone = this._glow(0x9CE4FF, 0.9);
        this._staffShaft(group, dark, { length: 0.56, rTop: 0.014, rBot: 0.016 });
        // Tuning forks of three lengths, each ringing at its own rate.
        const forks = this.isLowDetail() ? 2 : 3;
        for (let i = 0; i < forks; i++) {
          const a = (i / forks) * Math.PI * 2;
          const len = 0.11 - i * 0.02;
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.04, this.seg(8, 5)), steel);
          stem.position.set(Math.cos(a) * 0.022, 0.4, Math.sin(a) * 0.022);
          group.add(stem);
          for (const s of [-1, 1]) {
            const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, this.seg(7, 5)), steel);
            tine.position.set(Math.cos(a) * 0.022 + Math.cos(a + Math.PI / 2) * s * 0.009, 0.42 + len / 2, Math.sin(a) * 0.022 + Math.sin(a + Math.PI / 2) * s * 0.009);
            tine.userData.sway = { axis: 'x', amp: 0.02, freq: 8 + i * 3, phase: s };
            group.add(tine);
          }
        }
        // The rings of sound coming off them.
        const waves = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < waves; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03 + i * 0.014, 0.002, this.seg(4, 3), this.seg(16, 9)), tone);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.46 + i * 0.02;
          ring.userData.pulse = { min: 0.0, max: 1.2, freq: 1.8, phase: -i * 0.8 };
          group.add(ring);
        }
        const resonator = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.06, this.seg(12, 7)), steel);
        resonator.position.y = 0.36;
        group.add(resonator);
        for (let i = 0; i < 3; i++) {
          const slot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 0.006), dark);
          slot.position.y = 0.345 + i * 0.015;
          group.add(slot);
        }
        return group;
      },

      // ---- 303: World Tree Staff ----------------------------------------------
      createWorldTreeStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const bark = this._wood(0x5B4227);
        const leafColor = this.getRandomColor(rand, [0x4E9A3A, 0x6BBF48, 0xC8902A]);
        const leaf = this._mat(leafColor, { roughness: 0.65, metalness: 0.04 });
        const glowMat = this._glow(0xFFE08A, 0.6);
        // A whole tree in miniature: buttressed roots, a trunk and a canopy.
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.56, this.seg(9, 6)), bark);
        trunk.position.y = 0.1;
        group.add(trunk);
        const roots = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < roots; i++) {
          const a = (i / roots) * Math.PI * 2;
          const root = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.13, this.seg(7, 5)), bark);
          root.position.set(Math.cos(a) * 0.026, -0.2, Math.sin(a) * 0.026);
          root.rotation.set(0.5, -a, 0);
          group.add(root);
        }
        // Canopy: leaf clusters at three heights so it reads as a crown.
        const tiers = this.isLowDetail() ? 2 : 3;
        for (let t = 0; t < tiers; t++) {
          const y = 0.4 + t * 0.06;
          const r = 0.07 - t * 0.018;
          const per = 5 - t;
          for (let i = 0; i < per; i++) {
            const a = (i / per) * Math.PI * 2 + t * 0.6;
            const cluster = new THREE.Mesh(new THREE.SphereGeometry(0.03 - t * 0.005, this.seg(9, 6), this.seg(7, 5)), leaf);
            cluster.scale.y = 0.7;
            cluster.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
            cluster.userData.sway = { axis: 'z', amp: 0.05, freq: 0.8, phase: i + t };
            group.add(cluster);
          }
          const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, r * 1.8, this.seg(6, 4)), bark);
          branch.position.set(0, y - 0.01, 0);
          branch.rotation.z = Math.PI / 2;
          branch.rotation.y = t * 0.8;
          group.add(branch);
        }
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(10, 6), this.seg(8, 5)), glowMat);
        heart.position.y = 0.42;
        heart.userData.pulse = { min: 0.3, max: 1.0, freq: 0.6 };
        group.add(heart);
        return group;
      },

      // ---- 304: World Tree Branch ---------------------------------------------
      createWorldTreeBranchModel(weapon, rand) {
        const group = new THREE.Group();
        const bark = this._wood(0x6E4A2A);
        const leaf = this._mat(0x5CB03A, { roughness: 0.62, metalness: 0.04 });
        const sap = this._glow(0xC8FF8A, 0.6);
        // Just one branch off the tree, and it has not stopped growing.
        const up = new THREE.Vector3(0, 1, 0);
        const nodes = [[0, -0.26], [0.02, -0.1], [-0.01, 0.06], [0.03, 0.2], [0.0, 0.34], [0.04, 0.46]];
        for (let i = 0; i < nodes.length - 1; i++) {
          const a = new THREE.Vector3(nodes[i][0], nodes[i][1], 0);
          const b = new THREE.Vector3(nodes[i + 1][0], nodes[i + 1][1], 0);
          const dir = b.clone().sub(a);
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.016 - i * 0.002, 0.018 - i * 0.002, dir.length() * 1.06, this.seg(8, 5)), bark);
          seg.position.copy(a).add(b).multiplyScalar(0.5);
          seg.quaternion.setFromUnitVectors(up, dir.clone().normalize());
          group.add(seg);
        }
        const twigs = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < twigs; i++) {
          const t = i / twigs;
          const y = -0.02 + t * 0.44;
          const a = i * 1.7;
          const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, 0.06, this.seg(6, 4)), bark);
          twig.position.set(Math.cos(a) * 0.02, y, Math.sin(a) * 0.02);
          twig.rotation.set(0.7, -a, 0);
          group.add(twig);
          const l = this._plate([[0, 0], [0.018, 0.012], [0.028, 0.038], [0.005, 0.028]], 0.003, leaf);
          l.position.set(Math.cos(a) * 0.04, y + 0.03, Math.sin(a) * 0.04);
          l.rotation.set(0, -a, 0.3);
          l.userData.sway = { axis: 'z', amp: 0.14, freq: 1.1 + t, phase: i };
          group.add(l);
        }
        const bud = new THREE.Mesh(new THREE.SphereGeometry(0.014, this.seg(9, 6), this.seg(7, 5)), sap);
        bud.scale.y = 1.5;
        bud.position.set(0.045, 0.5, 0);
        bud.userData.pulse = { min: 0.3, max: 1.1, freq: 0.9 };
        group.add(bud);
        return group;
      },

      // ---- 305: Unicorn Horn Staff --------------------------------------------
      createUnicornHornStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const horn = this._mat(0xF2ECE0, { roughness: 0.28, metalness: 0.1 });
        const silver = this._cast(0xC8CED4);
        const shimmer = this._glow(this.getRandomColor(rand, [0xFFD9F0, 0xD9F0FF, 0xF0FFD9]), 0.7);
        this._staffShaft(group, silver, { length: 0.44, rTop: 0.012, rBot: 0.014, mid: -0.02 });
        // The horn itself, a real tapering spiral rather than a smooth cone.
        const turns = this.isLowDetail() ? 8 : 16;
        for (let i = 0; i < turns; i++) {
          const t = i / turns;
          const a = t * Math.PI * 6;
          const r = 0.026 * (1 - t) + 0.003;
          const ridge = new THREE.Mesh(new THREE.SphereGeometry(0.008 * (1 - t * 0.7) + 0.002, this.seg(7, 5), this.seg(5, 4)), horn);
          ridge.position.set(Math.cos(a) * r * 0.5, 0.22 + t * 0.3, Math.sin(a) * r * 0.5);
          group.add(ridge);
        }
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.32, this.seg(10, 6)), horn);
        core.position.y = 0.37;
        group.add(core);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(8, 5), this.seg(6, 4)), shimmer);
        tip.position.y = 0.535;
        tip.userData.pulse = { min: 0.4, max: 1.3, freq: 1.0 };
        group.add(tip);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.03, this.seg(12, 7)), silver);
        collar.position.y = 0.2;
        group.add(collar);
        const motes = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < motes; i++) {
          const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.005, 0), shimmer);
          mote.position.y = 0.4;
          mote.userData.orbit = { radius: 0.04, speed: 0.6 + i * 0.25, phase: i * 1.6, plane: 'xz' };
          mote.userData.bob = { axis: 'y', amp: 0.05, freq: 0.5, phase: i };
          group.add(mote);
        }
        return group;
      },

      // ---- 306: Spell Absorber ------------------------------------------------
      createSpellAbsorberModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._mat(0x1E1A24, { roughness: 0.5, metalness: 0.6 });
        const brass = this._cast(0xB9902A);
        const drain = this._glow(this.getRandomColor(rand, [0x8A4FFF, 0x4FFFD4]), 1.1);
        this._staffShaft(group, dark, { length: 0.6, ferruleMat: brass });
        // A funnel that narrows into nothing: what goes in does not come out.
        const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.012, 0.09, this.seg(14, 8), 1, true), brass);
        funnel.position.y = 0.5;
        group.add(funnel);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.005, this.seg(4, 3), this.seg(16, 9)), brass);
        lip.position.y = 0.545;
        group.add(lip);
        // The vortex inside it, tightening as it goes down.
        const rings = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < rings; i++) {
          const t = i / rings;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05 - t * 0.036, 0.0025, this.seg(4, 3), this.seg(14, 8)), drain);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.535 - t * 0.08;
          ring.userData.spin = { axis: 'y', speed: 1.2 + t * 2.2 };
          ring.userData.pulse = { min: 0.1, max: 1.3, freq: 2.0, phase: -t * 4 };
          group.add(ring);
        }
        const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.02, this.seg(10, 6)), drain);
        throat.position.y = 0.45;
        throat.userData.pulse = { min: 0.4, max: 1.4, freq: 1.6 };
        group.add(throat);
        // Sigils on the shaft, going out one after another as it feeds.
        for (let i = 0; i < 4; i++) {
          const sig = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.02), drain);
          sig.position.y = 0.34 - i * 0.07;
          sig.rotation.y = i * 0.8;
          sig.userData.pulse = { min: 0.05, max: 1.0, freq: 1.2, phase: i * 0.9 };
          group.add(sig);
        }
        return group;
      },

      // ---- 307: Dragon Staff --------------------------------------------------
      createDragonStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const hideColor = this.getRandomColor(rand, [0x2E7D4F, 0x8B1A1A, 0x2B3D8B]);
        const hide = this._mat(hideColor, { roughness: 0.4, metalness: 0.5 });
        const horn = this._mat(0x2A241C, { roughness: 0.6, metalness: 0.15 });
        const gold = this._cast(0xD9A62A);
        const ember = this._glow(0xFF6A1A, 1.0);
        this._staffShaft(group, horn, { length: 0.6, wrapMat: gold });
        // A dragon's head at the top, holding an orb in its jaws.
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.036, this.seg(12, 7), this.seg(9, 6)), hide);
        skull.scale.set(1, 0.9, 1.3);
        skull.position.y = 0.48;
        group.add(skull);
        const snout = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, this.seg(8, 5)), hide);
        snout.position.set(0, 0.47, 0.05);
        snout.rotation.x = Math.PI / 2;
        group.add(snout);
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.05), hide);
        jaw.position.set(0, 0.45, 0.04);
        jaw.rotation.x = 0.3;
        jaw.userData.sway = { axis: 'x', amp: 0.08, freq: 0.7 };
        group.add(jaw);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.02, this.seg(11, 7), this.seg(8, 5)), ember);
        orb.position.set(0, 0.465, 0.07);
        orb.userData.pulse = { min: 0.5, max: 1.4, freq: 1.2 };
        orb.userData.spin = { axis: 'y', speed: 0.6 };
        group.add(orb);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.007, this.seg(7, 5), this.seg(5, 4)), ember);
          eye.position.set(s * 0.02, 0.492, 0.032);
          eye.userData.pulse = { min: 0.4, max: 1.3, freq: 2.2, phase: s };
          group.add(eye);
          const hornMesh = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.06, this.seg(6, 4)), gold);
          hornMesh.position.set(s * 0.022, 0.52, -0.02);
          hornMesh.rotation.set(-0.6, 0, s * 0.4);
          group.add(hornMesh);
        }
        // The body wound down the staff.
        const coils = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < coils; i++) {
          const t = i / coils;
          const coil = new THREE.Mesh(new THREE.TorusGeometry(0.026 - t * 0.006, 0.008, this.seg(5, 4), this.seg(12, 7)), hide);
          coil.position.y = 0.4 - i * 0.075;
          coil.rotation.set(Math.PI / 2 + 0.2, 0, i * 0.8);
          group.add(coil);
        }
        return group;
      },

      // ---- 308: Chronomancer's Staff ------------------------------------------
      createChronomancerStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const brassy = this._cast(0xC9A227);
        const dark = this._mat(0x2A241C, { roughness: 0.55, metalness: 0.5 });
        const face = this._mat(0xEFE6D0, { roughness: 0.6, metalness: 0.1 });
        const glow = this._glow(this.getRandomColor(rand, [0x7FE0FF, 0xFFD37F]), 0.9);
        this._staffShaft(group, dark, { length: 0.6, ferruleMat: brassy });
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, this.seg(16, 9)), face);
        dial.rotation.x = Math.PI / 2;
        dial.position.y = 0.51;
        group.add(dial);
        const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.007, this.seg(5, 4), this.seg(16, 9)), brassy);
        bezel.position.y = 0.51;
        group.add(bezel);
        // Hour marks, then the hands, turning at their proper rates.
        if (this.wantsTrim()) {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const mark = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.008, 0.002), dark);
            mark.position.set(Math.cos(a) * 0.042, 0.51 + Math.sin(a) * 0.042, 0.008);
            mark.rotation.z = a;
            group.add(mark);
          }
        }
        const hour = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.028, 0.003), brassy);
        hour.position.set(0, 0.524, 0.01);
        hour.userData.spin = { axis: 'z', speed: -0.2 };
        group.add(hour);
        const minute = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.003), glow);
        minute.position.set(0, 0.53, 0.012);
        minute.userData.spin = { axis: 'z', speed: 1.3 };
        minute.userData.pulse = { min: 0.4, max: 1.2, freq: 2.0 };
        group.add(minute);
        // Escapement gears behind it, counter-rotating.
        for (let g = 0; g < 2; g++) {
          const gear = new THREE.Group();
          gear.position.set((g ? 0.05 : -0.05), 0.43, -0.01);
          gear.userData.spin = { axis: 'z', speed: g ? -1.6 : 1.0 };
          const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, this.seg(10, 6)), brassy);
          hub.rotation.x = Math.PI / 2;
          gear.add(hub);
          const teeth = this.isLowDetail() ? 7 : 11;
          for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * Math.PI * 2;
            const t = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.006), brassy);
            t.position.set(Math.cos(a) * 0.019, Math.sin(a) * 0.019, 0);
            t.rotation.z = a;
            gear.add(t);
          }
          group.add(gear);
        }
        const pendulum = new THREE.Group();
        pendulum.position.y = 0.44;
        pendulum.userData.sway = { axis: 'z', amp: 0.4, freq: 1.5 };
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.1, this.seg(6, 4)), brassy);
        rod.position.y = -0.05;
        pendulum.add(rod);
        const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.005, this.seg(12, 7)), glow);
        bob.rotation.x = Math.PI / 2;
        bob.position.y = -0.1;
        pendulum.add(bob);
        group.add(pendulum);
        return group;
      },

      // ---- 309: Barrier Staff -------------------------------------------------
      createBarrierStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const steel = this._mat(0x8A9096, { roughness: 0.35, metalness: 0.88 });
        const dark = this._mat(0x24262A, { roughness: 0.6, metalness: 0.6 });
        const wardColor = this.getRandomColor(rand, [0x7DD3FF, 0xFFD37D]);
        const ward = this._glow(wardColor, 1.0);
        this._staffShaft(group, dark, { length: 0.6, ferruleMat: steel });
        // Plates standing in a ring, turning: the barrier, in pieces, waiting.
        const plates = this.isLowDetail() ? 4 : 6;
        for (let i = 0; i < plates; i++) {
          const a = (i / plates) * Math.PI * 2;
          const plate = this._plate([[-0.018, -0.03], [0.018, -0.03], [0.022, 0.01], [0, 0.036], [-0.022, 0.01]], 0.005, steel);
          plate.position.set(Math.cos(a) * 0.055, 0.5, Math.sin(a) * 0.055);
          plate.rotation.set(0, -a + Math.PI / 2, 0);
          plate.userData.orbit = { radius: 0.055, speed: 0.5, phase: a, plane: 'xz' };
          plate.userData.bob = { axis: 'y', amp: 0.012, freq: 0.7, phase: i };
          group.add(plate);
          const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.003, 0.006), ward);
          glyph.position.set(Math.cos(a) * 0.055, 0.5, Math.sin(a) * 0.055);
          glyph.rotation.y = -a + Math.PI / 2;
          glyph.userData.orbit = { radius: 0.056, speed: 0.5, phase: a, plane: 'xz' };
          glyph.userData.pulse = { min: 0.1, max: 1.2, freq: 1.4, phase: i * 0.7 };
          group.add(glyph);
        }
        const hub = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(11, 7), this.seg(8, 5)), ward);
        hub.position.y = 0.5;
        hub.userData.pulse = { min: 0.4, max: 1.2, freq: 0.9 };
        group.add(hub);
        const cage = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, this.seg(4, 3), this.seg(14, 8)), steel);
        cage.rotation.x = Math.PI / 2;
        cage.position.y = 0.5;
        cage.userData.spin = { axis: 'y', speed: -0.7 };
        group.add(cage);
        return group;
      },

      // ---- 310: Gravity Manipulation Staff ------------------------------------
      createGravityStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._mat(0x1A1820, { roughness: 0.4, metalness: 0.7 });
        const alloy = this._mat(0x8A9096, { roughness: 0.3, metalness: 0.92 });
        const wellColor = this.getRandomColor(rand, [0x8A4FFF, 0x4F8AFF]);
        const well = this._glow(wellColor, 1.1);
        this._staffShaft(group, dark, { length: 0.58, ferruleMat: alloy });
        // A heavy dark sphere with lighter ones falling round it and never in.
        const mass = new THREE.Mesh(new THREE.SphereGeometry(0.034, this.seg(14, 8), this.seg(10, 6)), dark);
        mass.position.y = 0.5;
        group.add(mass);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.003, this.seg(4, 3), this.seg(16, 9)), well);
        halo.position.y = 0.5;
        halo.rotation.x = Math.PI / 2;
        halo.userData.spin = { axis: 'y', speed: 1.4 };
        halo.userData.pulse = { min: 0.3, max: 1.3, freq: 1.4 };
        group.add(halo);
        const bodies = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < bodies; i++) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.008 + (i % 2) * 0.004, this.seg(9, 6), this.seg(7, 5)), alloy);
          b.position.y = 0.5;
          b.userData.orbit = { radius: 0.055 + i * 0.008, speed: 1.4 - i * 0.2, phase: i * 1.5, plane: i % 2 ? 'xz' : 'xy' };
          b.userData.bob = { axis: 'y', amp: 0.02, freq: 0.8, phase: i };
          group.add(b);
        }
        // The cage that keeps it from taking the wielder with it.
        for (let i = 0; i < 3; i++) {
          const arc = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, this.seg(4, 3), this.seg(14, 8), Math.PI), alloy);
          arc.position.y = 0.5;
          arc.rotation.set(Math.PI / 2, (i / 3) * Math.PI, 0);
          group.add(arc);
        }
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.018, 0.04, this.seg(12, 7)), alloy);
        collar.position.y = 0.43;
        group.add(collar);
        return group;
      },

      // ---- 311: Mind Shield Staff ---------------------------------------------
      createMindShieldStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const silver = this._cast(0xC0C6CC);
        const dark = this._mat(0x22242A, { roughness: 0.6, metalness: 0.6 });
        const wardColor = this.getRandomColor(rand, [0x7DFFD3, 0xD37DFF]);
        const ward = this._glow(wardColor, 0.9);
        this._staffShaft(group, dark, { length: 0.6, rTop: 0.012, rBot: 0.014, ferruleMat: silver });
        // A cage in the shape of a head, with a stone where the thoughts are.
        const bars = this.isLowDetail() ? 4 : 7;
        for (let i = 0; i < bars; i++) {
          const a = (i / bars) * Math.PI;
          const arc = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.0035, this.seg(4, 3), this.seg(14, 8), Math.PI), silver);
          arc.position.y = 0.5;
          arc.rotation.set(Math.PI / 2, a, 0);
          group.add(arc);
        }
        const equator = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.005, this.seg(4, 3), this.seg(16, 9)), silver);
        equator.rotation.x = Math.PI / 2;
        equator.position.y = 0.5;
        group.add(equator);
        const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.02, 0), ward);
        stone.position.y = 0.5;
        stone.userData.spin = { axis: 'y', speed: 0.6 };
        stone.userData.pulse = { min: 0.4, max: 1.2, freq: 0.9 };
        group.add(stone);
        // Reflections skating over the outside of the cage.
        const glints = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < glints; i++) {
          const g = new THREE.Mesh(new THREE.SphereGeometry(0.005, this.seg(7, 5), this.seg(5, 4)), ward);
          g.position.y = 0.5;
          g.userData.orbit = { radius: 0.045, speed: 0.9 + i * 0.4, phase: i * 1.6, plane: i % 2 ? 'xz' : 'yz' };
          g.userData.pulse = { min: 0.1, max: 1.3, freq: 2.2, phase: i };
          group.add(g);
        }
        return group;
      },

      // ---- 312: Arcane Sphere -------------------------------------------------
      createArcaneSphereModel(weapon, rand) {
        const group = new THREE.Group();
        const glassColor = this.getRandomColor(rand, [0x6C4AB6, 0x2A6FB6, 0xB64A8C]);
        const glass = this._mat(glassColor, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.5 });
        const core = this._glow(0xFFFFFF, 1.4);
        const brassy = this._cast(0xC9A227);
        // No shaft at all: it hangs where the hand is, inside its own gimbal.
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, this.seg(16, 9), this.seg(12, 7)), glass);
        orb.userData.bob = { axis: 'y', amp: 0.012, freq: 0.6 };
        group.add(orb);
        const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), core);
        heart.userData.spin = { axis: 'y', speed: 1.1 };
        heart.userData.pulse = { min: 0.5, max: 1.6, freq: 1.3 };
        group.add(heart);
        // Three gimbal rings, each on its own axis.
        const axes = [['y', 0, 0], ['x', Math.PI / 2, 0], ['z', 0, Math.PI / 2]];
        for (let i = 0; i < axes.length; i++) {
          const [ax, rx, rz] = axes[i];
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085 + i * 0.008, 0.005, this.seg(5, 4), this.seg(18, 10)), brassy);
          ring.rotation.set(rx, 0, rz);
          ring.userData.spin = { axis: ax, speed: (i % 2 ? -1 : 1) * (0.4 + i * 0.3) };
          group.add(ring);
        }
        const motes = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < motes; i++) {
          const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.007, 0), core);
          mote.userData.orbit = { radius: 0.05 + i * 0.004, speed: 0.8 + i * 0.3, phase: i * 1.1, plane: i % 3 === 0 ? 'xz' : (i % 3 === 1 ? 'xy' : 'yz') };
          mote.userData.pulse = { min: 0.2, max: 1.4, freq: 1.6, phase: i };
          group.add(mote);
        }
        return group;
      },

      // ---- 313: Mind Projector Staff ------------------------------------------
      createMindProjectorStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const white = this._mat(0xE8ECF0, { roughness: 0.3, metalness: 0.4 });
        const dark = this._mat(0x1E2126, { roughness: 0.6, metalness: 0.65 });
        const beamColor = this.getRandomColor(rand, [0xC77DFF, 0x7DD3FF]);
        const beam = this._glow(beamColor, 1.2);
        this._staffShaft(group, dark, { length: 0.58, rTop: 0.014, rBot: 0.016 });
        // A lamp head that throws a picture rather than light.
        const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.08, this.seg(14, 8)), white);
        housing.position.y = 0.48;
        group.add(housing);
        const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.034, 0.03, this.seg(14, 8)), dark);
        hood.position.y = 0.53;
        group.add(hood);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, this.seg(14, 8)), beam);
        lens.rotation.x = Math.PI / 2;
        lens.position.y = 0.546;
        lens.userData.pulse = { min: 0.4, max: 1.4, freq: 1.4 };
        group.add(lens);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, this.seg(12, 7), 1, true), beam);
        cone.position.y = 0.6;
        cone.userData.pulse = { min: 0.08, max: 0.55, freq: 1.0 };
        group.add(cone);
        // The image, a rotating glyph plate inside the housing.
        const plates = this.isLowDetail() ? 2 : 3;
        for (let i = 0; i < plates; i++) {
          const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.003, this.seg(12, 7)), beam);
          plate.rotation.x = Math.PI / 2;
          plate.position.y = 0.46 + i * 0.012;
          plate.userData.spin = { axis: 'y', speed: (i % 2 ? -1 : 1) * (0.6 + i * 0.4) };
          plate.userData.pulse = { min: 0.1, max: 0.9, freq: 1.2, phase: i };
          group.add(plate);
        }
        const vents = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < vents; i++) {
          const vent = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.003, this.seg(4, 3), this.seg(14, 8)), dark);
          vent.rotation.x = Math.PI / 2;
          vent.position.y = 0.45 + i * 0.012;
          group.add(vent);
        }
        return group;
      },

      // ---- 314: Mental Fortress Staff -----------------------------------------
      createMentalFortressStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const stone = this._mat(0x8A8F95, { roughness: 0.85, metalness: 0.12 });
        const iron = this._mat(0x4A4F55, { roughness: 0.6, metalness: 0.7 });
        const wardColor = this.getRandomColor(rand, [0xFFD37D, 0x7DD3FF]);
        const ward = this._glow(wardColor, 0.9);
        this._staffShaft(group, iron, { length: 0.6, ferruleMat: stone });
        // A keep in miniature: a drum wall with merlons and a lit keep inside.
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.052, 0.05, this.seg(14, 8)), stone);
        wall.position.y = 0.48;
        group.add(wall);
        const merlons = this.isLowDetail() ? 6 : 10;
        for (let i = 0; i < merlons; i++) {
          const a = (i / merlons) * Math.PI * 2;
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.018, 0.012), stone);
          m.position.set(Math.cos(a) * 0.05, 0.513, Math.sin(a) * 0.05);
          m.rotation.y = -a;
          group.add(m);
        }
        const keep = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.06, this.seg(11, 7)), stone);
        keep.position.y = 0.52;
        group.add(keep);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.04, this.seg(11, 7)), iron);
        roof.position.y = 0.57;
        group.add(roof);
        const light = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.006), ward);
        light.position.set(0, 0.52, 0.024);
        light.userData.pulse = { min: 0.3, max: 1.1, freq: 0.8 };
        group.add(light);
        // Nested wards turning outside the wall.
        for (let i = 0; i < 2; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062 + i * 0.012, 0.003, this.seg(4, 3), this.seg(16, 9)), ward);
          ring.position.y = 0.48;
          ring.rotation.set(Math.PI / 2 + i * 0.4, 0, 0);
          ring.userData.spin = { axis: 'y', speed: (i ? -0.6 : 0.9) };
          ring.userData.pulse = { min: 0.2, max: 1.0, freq: 1.2, phase: i };
          group.add(ring);
        }
        return group;
      },

      // ---- 315: Elemental Warden Staff ----------------------------------------
      createElementalWardenStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x4A3524);
        const iron = this._mat(0x5A5F66, { roughness: 0.5, metalness: 0.8 });
        this._staffShaft(group, wood, { length: 0.6, ferruleMat: iron });
        // Four stones on a ring, one per element, each behaving differently.
        const elements = [
          { mat: this._glow(0xFF6A1A, 1.1), sway: true },
          { mat: this._glow(0x4FC3F7, 1.0), bob: true },
          { mat: this._glow(0x8A6A3A, 0.7), still: true },
          { mat: this._glow(0xCFF0FF, 0.8), spin: true }
        ];
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.006, this.seg(5, 4), this.seg(16, 9)), iron);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.5;
        group.add(ring);
        for (let i = 0; i < elements.length; i++) {
          const a = (i / elements.length) * Math.PI * 2;
          const e = elements[i];
          const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.019, 0), e.mat);
          stone.position.set(Math.cos(a) * 0.055, 0.5, Math.sin(a) * 0.055);
          stone.userData.pulse = { min: 0.3, max: 1.3, freq: 1.0 + i * 0.3, phase: i * 1.4 };
          if (e.spin) stone.userData.spin = { axis: 'y', speed: 1.4 };
          if (e.bob) stone.userData.bob = { axis: 'y', amp: 0.016, freq: 0.9 };
          if (e.sway) stone.userData.sway = { axis: 'z', amp: 0.3, freq: 2.4 };
          group.add(stone);
          const claw = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, this.seg(5, 4)), iron);
          claw.position.set(Math.cos(a) * 0.055, 0.478, Math.sin(a) * 0.055);
          group.add(claw);
        }
        const hub = new THREE.Mesh(new THREE.SphereGeometry(0.018, this.seg(11, 7), this.seg(8, 5)), iron);
        hub.position.y = 0.5;
        group.add(hub);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.04, this.seg(6, 4)), iron);
          spoke.position.set(Math.cos(a) * 0.037, 0.5, Math.sin(a) * 0.037);
          spoke.rotation.set(0, -a, Math.PI / 2);
          group.add(spoke);
        }
        return group;
      },

      // ---- 316: Vulture Totem Staff -------------------------------------------
      createVultureTotemStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6B4423);
        const bone = this._mat(0xE0D6C0, { roughness: 0.72, metalness: 0.04 });
        const featherColor = this.getRandomColor(rand, [0x2A2A2E, 0x4A3A2A]);
        const feather = this._mat(featherColor, { roughness: 0.95, metalness: 0.03 });
        const cord = this._wood(0xB03A2E);
        this._staffShaft(group, wood, { length: 0.6, sides: 6 });
        // The skull: cranium, long hooked beak, empty sockets.
        const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.03, this.seg(11, 7), this.seg(8, 5)), bone);
        cranium.scale.set(0.9, 1, 1.2);
        cranium.position.y = 0.5;
        group.add(cranium);
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.07, this.seg(8, 5)), bone);
        beak.position.set(0, 0.486, 0.05);
        beak.rotation.x = Math.PI / 2 + 0.2;
        group.add(beak);
        const hook = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.024, this.seg(6, 4)), bone);
        hook.position.set(0, 0.472, 0.08);
        hook.rotation.x = Math.PI / 2 + 0.9;
        group.add(hook);
        for (const s of [-1, 1]) {
          const socket = new THREE.Mesh(new THREE.SphereGeometry(0.009, this.seg(8, 5), this.seg(6, 4)), this._mat(0x14120E, { roughness: 0.95 }));
          socket.position.set(s * 0.017, 0.506, 0.022);
          group.add(socket);
        }
        // Feathers and cords hanging under it.
        const feathers = this.isLowDetail() ? 4 : 7;
        for (let i = 0; i < feathers; i++) {
          const a = (i / feathers) * Math.PI * 2;
          const f = this._plate([[0, 0], [0.008, -0.03], [0, -0.075], [-0.008, -0.03]], 0.002, feather);
          f.position.set(Math.cos(a) * 0.024, 0.44, Math.sin(a) * 0.024);
          f.rotation.set(0, -a, (i % 2 ? 1 : -1) * 0.2);
          f.userData.sway = { axis: 'z', amp: 0.16, freq: 0.9 + (i % 3) * 0.2, phase: i };
          group.add(f);
        }
        for (let i = 0; i < 3; i++) {
          const bind = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, this.seg(4, 3), this.seg(10, 6)), cord);
          bind.rotation.x = Math.PI / 2;
          bind.position.y = 0.44 + i * 0.012;
          group.add(bind);
        }
        // Small bones tied on, because a totem always has them.
        for (let i = 0; i < 3; i++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.05, this.seg(6, 4)), bone);
          b.position.set(Math.cos(i * 2.1) * 0.022, 0.36 - i * 0.02, Math.sin(i * 2.1) * 0.022);
          b.userData.sway = { axis: 'x', amp: 0.2, freq: 1.1, phase: i };
          group.add(b);
        }
        return group;
      },

      // ---- 318: Celestial Alignment Rod ---------------------------------------
      createCelestialAlignmentRodModel(weapon, rand) {
        const group = new THREE.Group();
        const brassy = this._cast(0xC9A227);
        const dark = this._mat(0x1E1A28, { roughness: 0.5, metalness: 0.5 });
        const sun = this._glow(0xFFD37F, 1.2);
        const planetColors = [0x9BA1A7, 0xC8A870, 0x4F8AFF, 0xB03A2E];
        this._staffShaft(group, dark, { length: 0.56, ferruleMat: brassy });
        // An orrery: a sun, four worlds on their own periods, in an armillary
        // cage of graduated rings.
        const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(12, 7), this.seg(9, 6)), sun);
        sunMesh.position.y = 0.5;
        sunMesh.userData.pulse = { min: 0.6, max: 1.4, freq: 0.9 };
        group.add(sunMesh);
        const bodies = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < bodies; i++) {
          const orbitR = 0.04 + i * 0.016;
          const track = new THREE.Mesh(new THREE.TorusGeometry(orbitR, 0.0018, this.seg(4, 3), this.seg(16, 9)), brassy);
          track.rotation.set(Math.PI / 2 + (i - 1.5) * 0.15, 0, 0);
          track.position.y = 0.5;
          group.add(track);
          const planet = new THREE.Mesh(new THREE.SphereGeometry(0.008 - i * 0.001, this.seg(9, 6), this.seg(7, 5)),
            this._mat(planetColors[i], { roughness: 0.6, metalness: 0.3 }));
          planet.position.y = 0.5;
          planet.userData.orbit = { radius: orbitR, speed: 1.3 - i * 0.25, phase: i * 1.7, plane: 'xz' };
          group.add(planet);
        }
        // The graduated meridian and equator of the armillary.
        for (let i = 0; i < 2; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.004, this.seg(5, 4), this.seg(18, 10)), brassy);
          ring.position.y = 0.5;
          ring.rotation.set(i ? Math.PI / 2 : 0.4, i ? 0 : 0, i ? 0 : Math.PI / 2);
          ring.userData.spin = { axis: i ? 'y' : 'z', speed: i ? 0.25 : -0.18 };
          group.add(ring);
        }
        if (this.wantsTrim()) {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const tick = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.008, 0.002), brassy);
            tick.position.set(Math.cos(a) * 0.09, 0.5, Math.sin(a) * 0.09);
            tick.rotation.z = a;
            group.add(tick);
          }
        }
        const cradle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.03, this.seg(12, 7)), brassy);
        cradle.position.y = 0.42;
        group.add(cradle);
        return group;
      },

      // ---- 319: EHI Toxic Amplifier -------------------------------------------
      createToxicAmplifierModel(weapon, rand) {
        const group = new THREE.Group();
        const corporate = this._mat(0xE8E4DC, { roughness: 0.42, metalness: 0.28 });
        const hazard = this._mat(0xE0A800, { roughness: 0.6, metalness: 0.2 });
        const glass = this._mat(0xBFD8E0, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.5 });
        const toxin = this._glow(0x7CFF3D, 0.9);
        const grey = this._mat(0x5A5F66, { roughness: 0.55, metalness: 0.75 });
        this._staffShaft(group, corporate, { length: 0.52, rTop: 0.015, rBot: 0.017, mid: -0.02 });
        // A canister of product, a regulator, and the vapour it is making.
        const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.13, this.seg(13, 8)), glass);
        canister.position.y = 0.4;
        group.add(canister);
        const level = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.08, this.seg(13, 8)), toxin);
        level.position.y = 0.375;
        level.userData.pulse = { min: 0.3, max: 0.9, freq: 0.7 };
        group.add(level);
        for (const y of [0.335, 0.465]) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.032, 0.016, this.seg(13, 8)), hazard);
          cap.position.y = y;
          group.add(cap);
        }
        const regulator = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.026, 0.03), grey);
        regulator.position.y = 0.5;
        group.add(regulator);
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, this.seg(4, 3), this.seg(12, 7)), hazard);
        wheel.position.set(0.024, 0.5, 0);
        wheel.rotation.y = Math.PI / 2;
        wheel.userData.spin = { axis: 'x', speed: 0.4 };
        group.add(wheel);
        // Vapour rising out of the vents, which is the amplification.
        const puffs = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < puffs; i++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.012 + rand() * 0.008, this.seg(9, 6), this.seg(7, 5)),
            this._mat(0x7CFF3D, { roughness: 1.0, metalness: 0, transparent: true, opacity: 0.28 }));
          p.position.set((rand() - 0.5) * 0.05, 0.53 + i * 0.02, (rand() - 0.5) * 0.05);
          p.userData.bob = { axis: 'y', amp: 0.03, freq: 0.5 + rand() * 0.3, phase: i };
          p.userData.orbit = { radius: 0.02, speed: 0.4, phase: i * 1.2, plane: 'xz' };
          group.add(p);
        }
        const label = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.03), hazard);
        label.position.set(0, 0.4, 0.033);
        label.rotation.x = Math.PI / 2;
        group.add(label);
        return group;
      },

      // ---- 321: EHI Forbidden Codex -------------------------------------------
      createForbiddenCodexModel(weapon, rand) {
        const group = new THREE.Group();
        const leather = this._wood(0x2A1620);
        const page = this._mat(0xE8DFC8, { roughness: 0.95, metalness: 0.02 });
        const brassy = this._cast(0xB9902A);
        const seal = this._mat(0xC0392B, { roughness: 0.5, metalness: 0.2 });
        const script = this._glow(this.getRandomColor(rand, [0x9CFF6A, 0xFF6A9C]), 1.0);
        // A book that is not being carried so much as restrained: covers, a
        // clasp that has failed, and pages turning by themselves.
        for (const s of [-1, 1]) {
          const cover = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.01), leather);
          cover.position.set(s * 0.052, 0.12, 0);
          cover.rotation.y = -s * 0.35;
          group.add(cover);
          const corner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.014), brassy);
          corner.position.set(s * 0.09, 0.05, 0);
          corner.rotation.y = -s * 0.35;
          group.add(corner);
        }
        const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, this.seg(11, 7), 1, false, 0, Math.PI), leather);
        spine.position.y = 0.12;
        spine.rotation.y = Math.PI / 2;
        group.add(spine);
        const leaves = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < leaves; i++) {
          const t = i / (leaves - 1) - 0.5;
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.001), page);
          leaf.position.set(t * 0.08, 0.12, 0);
          leaf.rotation.y = -t * 0.7;
          leaf.userData.sway = { axis: 'y', amp: 0.18, freq: 0.5 + Math.abs(t), phase: i * 0.9 };
          group.add(leaf);
          if (i % 2 === 0) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.002), script);
            line.position.set(t * 0.08, 0.12, 0.002);
            line.rotation.y = -t * 0.7;
            line.userData.pulse = { min: 0.05, max: 1.1, freq: 1.3, phase: i };
            group.add(line);
          }
        }
        const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.02), brassy);
        clasp.position.set(0, 0.12, 0.03);
        clasp.userData.sway = { axis: 'x', amp: 0.25, freq: 0.8 };
        group.add(clasp);
        const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, this.seg(10, 6)), seal);
        wax.position.set(0, 0.09, 0.036);
        wax.rotation.x = Math.PI / 2;
        group.add(wax);
        // The chain and the ring it hangs from.
        const head = this.chainRig(group, {
          links: 4, length: 0.09, linkMat: brassy, linkRadius: 0.009, linkTube: 0.003,
          y: -0.02, endMass: 3.0, gravity: -0.0006
        });
        head.position.y = -0.02;
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.09, this.seg(10, 6)), leather);
        grip.position.y = -0.11;
        group.add(grip);
        return group;
      },

      // ---- 322: Staff of Eternity ---------------------------------------------
      createStaffOfEternityModel(weapon, rand) {
        const group = new THREE.Group();
        const gold = this._cast(0xD9A62A);
        const dark = this._mat(0x1A1620, { roughness: 0.45, metalness: 0.6 });
        const eternalColor = this.getRandomColor(rand, [0xFFE08A, 0x8AE0FF]);
        const eternal = this._glow(eternalColor, 1.1);
        this._staffShaft(group, dark, { length: 0.56, ferruleMat: gold });
        // An ouroboros: a serpent ring with no beginning, turning forever.
        const bodySegs = this.isLowDetail() ? 10 : 18;
        for (let i = 0; i < bodySegs; i++) {
          const a = (i / bodySegs) * Math.PI * 2;
          const r = 0.058;
          const seg = new THREE.Mesh(new THREE.SphereGeometry(0.011 - Math.abs(0.5 - i / bodySegs) * 0.006, this.seg(8, 5), this.seg(6, 4)), gold);
          seg.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r);
          group.add(seg);
        }
        const headSnake = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.032, this.seg(8, 5)), gold);
        headSnake.position.set(0.058, 0.5, 0);
        headSnake.rotation.set(Math.PI / 2, 0, 0);
        headSnake.rotation.z = -0.4;
        group.add(headSnake);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.005, this.seg(7, 5), this.seg(5, 4)), eternal);
        eye.position.set(0.062, 0.508, 0.008);
        eye.userData.pulse = { min: 0.4, max: 1.3, freq: 1.4 };
        group.add(eye);
        // The figure-eight of light through the ring: the actual eternity.
        for (let i = 0; i < 2; i++) {
          const loop = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.003, this.seg(4, 3), this.seg(14, 8)), eternal);
          loop.position.set((i ? 1 : -1) * 0.03, 0.5, 0);
          loop.rotation.x = Math.PI / 2;
          loop.userData.spin = { axis: 'y', speed: (i ? -1 : 1) * 1.1 };
          loop.userData.pulse = { min: 0.3, max: 1.3, freq: 1.0, phase: i * 1.5 };
          group.add(loop);
        }
        const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.008, 0), eternal);
        mote.position.y = 0.5;
        mote.userData.orbit = { radius: 0.058, speed: 1.6, plane: 'xz' };
        group.add(mote);
        const cradle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.03, this.seg(12, 7)), gold);
        cradle.position.y = 0.43;
        group.add(cradle);
        return group;
      },

      // ---- 323: EHI Petroleum Omniscience -------------------------------------
      createPetroleumOmniscienceModel(weapon, rand) {
        const group = new THREE.Group();
        const slick = this._mat(0x14161A, { roughness: 0.08, metalness: 0.75 });
        const corporate = this._mat(0xE8E4DC, { roughness: 0.42, metalness: 0.28 });
        const pipe = this._mat(0x5A5F66, { roughness: 0.55, metalness: 0.8 });
        const sheen = this._glow(this.getRandomColor(rand, [0x2A6B4A, 0x6B2A5A]), 0.4);
        const eye = this._glow(0xFFB300, 1.1);
        this._staffShaft(group, pipe, { length: 0.5, rTop: 0.014, rBot: 0.016, mid: -0.04 });
        // A derrick in miniature, with an eye where the crown block goes.
        const legs = 4;
        for (let i = 0; i < legs; i++) {
          const a = (i / legs) * Math.PI * 2 + Math.PI / 4;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.2, this.seg(6, 4)), pipe);
          leg.position.set(Math.cos(a) * 0.026, 0.36, Math.sin(a) * 0.026);
          leg.rotation.set(0.12 * Math.sin(a), 0, -0.12 * Math.cos(a));
          group.add(leg);
        }
        const braces = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < braces; i++) {
          const y = 0.29 + i * 0.05;
          const r = 0.032 - i * 0.005;
          const brace = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0025, this.seg(4, 3), 4), pipe);
          brace.rotation.x = Math.PI / 2;
          brace.rotation.z = Math.PI / 4;
          brace.position.y = y;
          group.add(brace);
        }
        const crown = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.014, 0.036), corporate);
        crown.position.y = 0.47;
        group.add(crown);
        const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(12, 7), this.seg(9, 6)), slick);
        eyeball.position.y = 0.51;
        group.add(eyeball);
        const iris = new THREE.Mesh(new THREE.SphereGeometry(0.011, this.seg(9, 6), this.seg(7, 5)), eye);
        iris.position.set(0, 0.51, 0.018);
        iris.userData.orbit = { radius: 0.008, speed: 0.6, plane: 'xy' };
        iris.userData.pulse = { min: 0.4, max: 1.3, freq: 1.2 };
        group.add(iris);
        const film = new THREE.Mesh(new THREE.SphereGeometry(0.026, this.seg(11, 7), this.seg(8, 5)), sheen);
        film.position.y = 0.51;
        film.userData.pulse = { min: 0.15, max: 0.45, freq: 0.5 };
        group.add(film);
        // The drip: it never quite stops.
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.007, this.seg(7, 5), this.seg(5, 4)), slick);
        drop.scale.y = 1.7;
        drop.position.y = 0.47;
        drop.userData.bob = { axis: 'y', amp: 0.03, freq: 0.6 };
        group.add(drop);
        return group;
      },

      // ---- 324: Universal Force Staff -----------------------------------------
      createUniversalForceStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const alloy = this._mat(0xC0C6CC, { roughness: 0.18, metalness: 0.95 });
        const dark = this._mat(0x14121C, { roughness: 0.5, metalness: 0.6 });
        const core = this._glow(0xFFFFFF, 1.6);
        const fields = [0xFF6A1A, 0x4FC3F7, 0x8AFF6A, 0xC77DFF];
        this._staffShaft(group, dark, { length: 0.54, ferruleMat: alloy });
        // Everything at once: a white core with one ring per force, each on a
        // different axis and none of them agreeing.
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.026, this.seg(14, 8), this.seg(10, 6)), core);
        heart.position.y = 0.5;
        heart.userData.pulse = { min: 0.7, max: 1.7, freq: 1.5 };
        group.add(heart);
        const count = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < count; i++) {
          const mat = this._glow(fields[i], 1.1);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05 + i * 0.009, 0.004, this.seg(5, 4), this.seg(18, 10)), mat);
          ring.position.y = 0.5;
          ring.rotation.set((i * Math.PI) / count, (i * Math.PI) / 3, 0);
          ring.userData.spin = { axis: ['y', 'x', 'z', 'y'][i], speed: (i % 2 ? -1 : 1) * (0.6 + i * 0.35) };
          ring.userData.pulse = { min: 0.2, max: 1.3, freq: 1.2 + i * 0.3, phase: i * 1.4 };
          group.add(ring);
          const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.009, 0), mat);
          node.position.y = 0.5;
          node.userData.orbit = { radius: 0.05 + i * 0.009, speed: 0.9 + i * 0.3, phase: i * 1.6, plane: ['xz', 'xy', 'yz', 'xz'][i] };
          node.userData.pulse = { min: 0.3, max: 1.5, freq: 1.8, phase: i };
          group.add(node);
        }
        // The frame holding it, which is plainly not enough.
        for (let i = 0; i < 3; i++) {
          const arc = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.004, this.seg(4, 3), this.seg(16, 9), Math.PI), alloy);
          arc.position.y = 0.5;
          arc.rotation.set(Math.PI / 2, (i / 3) * Math.PI, 0);
          group.add(arc);
        }
        const cradle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.036, this.seg(12, 7)), alloy);
        cradle.position.y = 0.42;
        group.add(cradle);
        return group;
      },

      // ---- 317: Psychic Amplifier Crown ---------------------------------------
      // A circlet rather than a staff: the aerials are the weapon and the
      // wearer is the amplifier. (Compare the Light-class Psychic Crown, 28.)
      createPsychicAmplifierCrownModel(weapon, rand) {
        const group = new THREE.Group();
        const chrome = this._mat(0xC0C6CC, { roughness: 0.18, metalness: 0.95 });
        const copper = this._mat(0xB87333, { roughness: 0.3, metalness: 0.9 });
        const bake = this._mat(0x2A2018, { roughness: 0.72, metalness: 0.1 });
        const psiColor = this.getRandomColor(rand, [0xB86BFF, 0x6BD9FF, 0x6BFFB8]);
        const psi = this._glow(psiColor, 1.2);

        const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.011, this.seg(6, 4), this.seg(20, 11)), chrome);
        band.rotation.x = Math.PI / 2;
        group.add(band);
        const inner = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.004, this.seg(4, 3), this.seg(20, 11)), psi);
        inner.rotation.x = Math.PI / 2;
        inner.position.y = 0.012;
        inner.userData.pulse = { min: 0.2, max: 1.1, freq: 1.0 };
        group.add(inner);
        // Aerials, each with its own coil and bead, firing in sequence.
        const aerials = this.isLowDetail() ? 4 : 6;
        for (let i = 0; i < aerials; i++) {
          const a = (i / aerials) * Math.PI * 2;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, 0.11, this.seg(7, 5)), copper);
          post.position.set(Math.cos(a) * 0.072, 0.055, Math.sin(a) * 0.072);
          post.rotation.set(0.2 * Math.sin(a), 0, -0.2 * Math.cos(a));
          group.add(post);
          for (let c = 0; c < 2; c++) {
            const coil = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0022, this.seg(4, 3), this.seg(9, 6)), copper);
            coil.rotation.x = Math.PI / 2;
            coil.position.set(Math.cos(a) * 0.072, 0.03 + c * 0.016, Math.sin(a) * 0.072);
            group.add(coil);
          }
          const bead = new THREE.Mesh(new THREE.OctahedronGeometry(0.009, 0), psi);
          bead.position.set(Math.cos(a) * 0.078, 0.115, Math.sin(a) * 0.078);
          bead.userData.pulse = { min: 0.05, max: 1.5, freq: 1.6, phase: -i * 0.9 };
          bead.userData.spin = { axis: 'y', speed: 0.8 };
          group.add(bead);
        }
        // The valve at the front, which is where the amplifying happens.
        const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.04, this.seg(11, 7)),
          this._mat(0xE8DCC0, { roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.5 }));
        valve.position.set(0, 0.03, 0.078);
        group.add(valve);
        const filament = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.026, this.seg(6, 4)), psi);
        filament.position.set(0, 0.03, 0.078);
        filament.userData.pulse = { min: 0.4, max: 1.4, freq: 2.4 };
        group.add(filament);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 0.03), bake);
        box.position.set(0, 0.006, -0.078);
        group.add(box);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.003, this.seg(4, 3), this.seg(20, 11)), psi);
        halo.rotation.x = Math.PI / 2.2;
        halo.position.y = 0.09;
        halo.userData.spin = { axis: 'y', speed: -0.7 };
        halo.userData.pulse = { min: 0.2, max: 1.0, freq: 1.3 };
        group.add(halo);
        return group;
      },

      // ---- 320: Varlenia Arcane Staff -----------------------------------------
      // (The gold house finish is applied after the build; see VARLENIA_IDS.)
      createVarleniaArcaneStaffModel(weapon, rand) {
        const group = new THREE.Group();
        const body = this._mat(0xC8CED4, { roughness: 0.2, metalness: 0.94 });
        const inlay = this._mat(0x8A8F95, { roughness: 0.4, metalness: 0.85 });
        const arcane = this._glow(0xFFE9A8, 1.2);
        const velvet = this._mat(0x5A1030, { roughness: 0.95, metalness: 0 });

        this._staffShaft(group, body, { length: 0.6, rTop: 0.015, rBot: 0.018, ferruleMat: inlay });
        // Scrollwork up the shaft, in matched pairs: state pattern, all of it.
        const scrolls = this.isLowDetail() ? 3 : 5;
        for (let i = 0; i < scrolls; i++) {
          for (const s of [-1, 1]) {
            const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, this.seg(4, 3), this.seg(10, 6), Math.PI * 1.4), inlay);
            scroll.position.set(s * 0.018, 0.0 + i * 0.09, 0);
            scroll.rotation.set(Math.PI / 2, 0, s * 0.7);
            group.add(scroll);
          }
        }
        // A cage of four ribs closing over the stone.
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(Math.cos(a) * 0.02, 0.44, Math.sin(a) * 0.02),
            new THREE.Vector3(Math.cos(a) * 0.055, 0.5, Math.sin(a) * 0.055),
            new THREE.Vector3(Math.cos(a) * 0.014, 0.56, Math.sin(a) * 0.014)
          );
          const rib = new THREE.Mesh(new THREE.TubeGeometry(curve, this.seg(7, 4), 0.005, this.seg(5, 4), false), body);
          group.add(rib);
        }
        const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), arcane);
        stone.position.y = 0.5;
        stone.userData.spin = { axis: 'y', speed: 0.7 };
        stone.userData.pulse = { min: 0.5, max: 1.4, freq: 1.1 };
        group.add(stone);
        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.04, this.seg(10, 6)), inlay);
        finial.position.y = 0.585;
        group.add(finial);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.026, this.seg(12, 7)), inlay);
        collar.position.y = 0.425;
        group.add(collar);
        // The cord and tassel a ceremonial staff never goes without.
        for (let i = 0; i < 3; i++) {
          const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.002, 0.05, this.seg(5, 3)), velvet);
          cord.position.set((i - 1) * 0.006, 0.38, 0.02);
          cord.userData.sway = { axis: 'z', amp: 0.2, freq: 1.1, phase: i };
          group.add(cord);
        }
        return group;
      }

    }
  });
})();
