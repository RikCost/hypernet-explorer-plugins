//=============================================================================
// Weapon 3D Models - Spears and polearms
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Procedural 3D models for spears and polearms. Loaded
 * automatically by WeaponSystemProcedural.js.
 * @author AntiGravity
 *
 * @help
 * ============================================================================
 * Weapon 3D Models - Spears and polearms
 * ============================================================================
 *
 * One family per weapon type. This one owns every Spear weapon (wtypeId 12):
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
    console.error('[Weapon3D_Spears] WeaponSystemProcedural not loaded');
    return;
  }

  window.WeaponSystemProcedural.registerFamily({
    name: 'Weapon3D_Spears',
    unique: {
      620: 'createLooseHeadedSpearModel',            // Loose-headed Spear
      621: 'createCrudeSpearModel',                  // Crude Spear
      622: 'createDeadlyPlungerModel',               // Deadly Plunger
      623: 'createSharpenedPoolCueModel',            // Sharpened Pool Cue
      624: 'createBroomSpearModel',                  // Broom Spear
      625: 'createAntennaRapierModel',               // Antenna Rapier
      626: 'createSignPostModel',                    // Sign Post
      627: 'createJavelinModel',                     // Javelin
      628: 'createSeedSpearModel',                   // Seed Spear
      629: 'createShortSpearModel',                  // Short Spear
      630: 'createSumerianSpearModel',               // Sumerian Spear
      631: 'createPilumModel',                       // Pilum
      632: 'createDorySpearModel',                   // Dory Spear
      633: 'createBoardingPikeModel',                // Boarding Pike
      634: 'createLongSpearModel',                   // Long Spear
      635: 'createIklwaModel',                       // Iklwa
      636: 'createRifleBayonetModel',                // Rifle Bayonet
      637: 'createNaginataModel',                    // Naginata
      638: 'createHalberdModel',                     // Halberd
      639: 'createPoleaxeModel',                     // Poleaxe
      640: 'createGlaiveModel',                      // Glaive
      641: 'createHeavyHalberdModel',                // Halberd (heavy)
      642: 'createFireLanceModel',                   // Fire Lance
      643: 'createMithrilSpearModel',                // Mithril Spear
      644: 'createTempestTridentModel',              // Tempest Trident
      645: 'createDragonSpearModel',                 // Dragon Spear
      646: 'createWardingSpearModel',                // Warding Spear
      647: 'createLeviathanFangSpearModel',          // Leviathan Fang Spear
      648: 'createSerpentCallerModel',               // Serpent Caller
      649: 'createCombustionLanceModel',             // EHI Combustion Lance
      650: 'createGravitySpearModel',                // Gravity Spear
      651: 'createVarleniaReturningSpearModel'       // Varlenia Returning Spear
    },
    models: {
      /**
       * The shaft every polearm here hangs off. Runs up +Y with the grip
       * below the origin, so `top` is where the head goes.
       * @param opts { len, r, rTop, top, wrapMat, wraps, buttMat, butt }
       * @returns the y of the top of the shaft.
       */
      _polearmShaft(group, mat, opts) {
        const o = opts || {};
        const len = o.len || 0.95;
        const top = o.top === undefined ? 0.2 : o.top;
        const r = o.r || 0.016;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(o.rTop || r * 0.9, r, len, this.seg(10, 6)), mat);
        shaft.position.y = top - len / 2;
        group.add(shaft);
        if (o.wrapMat) {
          const n = this.isLowDetail() ? (o.wraps ? 2 : 2) : (o.wraps || 4);
          for (let i = 0; i < n; i++) {
            const wrap = new THREE.Mesh(new THREE.TorusGeometry(r * 1.15, 0.004, this.seg(4, 3), this.seg(10, 6)), o.wrapMat);
            wrap.rotation.x = Math.PI / 2;
            wrap.position.y = top - len * 0.45 + i * 0.03;
            group.add(wrap);
          }
        }
        if (o.buttMat) {
          // A ferrule or a butt-spike: every real polearm has something at the
          // bottom, if only to stop the wood splitting.
          const y = top - len;
          if (o.butt === 'spike') {
            const sp = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, 0.07, this.seg(7, 5)), o.buttMat);
            sp.rotation.x = Math.PI;
            sp.position.y = y - 0.035;
            group.add(sp);
          } else if (o.butt === 'cap') {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.03, this.seg(10, 6)), o.buttMat);
            cap.position.y = y - 0.015;
            group.add(cap);
          } else {
            const fer = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 0.95, 0.05, this.seg(10, 6)), o.buttMat);
            fer.position.y = y + 0.02;
            group.add(fer);
          }
        }
        return top;
      },

      /** The socket a head sits in, and the rivets or langets holding it. */
      _polearmSocket(group, mat, y, opts) {
        const o = opts || {};
        const sock = new THREE.Mesh(new THREE.CylinderGeometry(o.rTop || 0.018, o.rBot || 0.021, o.h || 0.07, this.seg(10, 6)), mat);
        sock.position.y = y;
        group.add(sock);
        if (o.langets) {
          for (const s of [-1, 1]) {
            const lang = new THREE.Mesh(new THREE.BoxGeometry(0.005, o.langetLen || 0.12, 0.022), mat);
            lang.position.set(s * 0.016, y - (o.langetLen || 0.12) * 0.5, 0);
            group.add(lang);
          }
        }
        if (o.rivets) {
          for (let i = 0; i < 2; i++) {
            const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04, this.seg(7, 5)), mat);
            rv.rotation.z = Math.PI / 2;
            rv.position.y = y - 0.02 - i * 0.05;
            group.add(rv);
          }
        }
        return group;
      },

      // ---- 620: Loose-headed Spear --------------------------------------------
      createLooseHeadedSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x8B6A3B);
        const iron = this._mat(0x6E7378, { roughness: 0.75, metalness: 0.55 });
        const twine = this._mat(0xB8A87A, { roughness: 0.95, metalness: 0.02 });
        const top = this._polearmShaft(group, wood, { len: 0.95, wrapMat: twine, buttMat: wood, butt: 'cap' });
        // The head is on it, but not attached to it, and it shows: the socket
        // sits crooked and the binding has already slipped.
        const head = new THREE.Group();
        head.position.y = top + 0.03;
        head.rotation.z = 0.16;
        head.userData.sway = { axis: 'z', amp: 0.09, freq: 2.4 };
        group.add(head);
        const blade = this._plate(this._bladeOutline(0.2, 0.055, 0, 6, 1), 0.008, iron);
        head.add(blade);
        const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.06, this.seg(9, 6)), iron);
        socket.position.y = -0.03;
        head.add(socket);
        for (let i = 0; i < 3; i++) {
          const bind = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.004, this.seg(4, 3), this.seg(10, 6)), twine);
          bind.rotation.x = Math.PI / 2;
          bind.position.y = top - 0.01 - i * 0.02;
          bind.rotation.z = (rand() - 0.5) * 0.3;
          group.add(bind);
        }
        const loose = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.06, this.seg(5, 3)), twine);
        loose.position.set(0.02, top - 0.05, 0);
        loose.rotation.z = 0.4;
        loose.userData.sway = { axis: 'z', amp: 0.25, freq: 1.6 };
        group.add(loose);
        return group;
      },

      // ---- 621: Crude Spear ---------------------------------------------------
      createCrudeSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const branch = this._wood(0x6E5230);
        const bark = this._wood(0x4A3A22);
        const flint = this._mat(0x50555C, { roughness: 0.55, metalness: 0.12 });
        const sinew = this._mat(0xC8B48A, { roughness: 0.95, metalness: 0.02 });
        // A branch and a knapped stone. Nothing about it is straight and the
        // bark is still on the bottom half.
        const top = this._polearmShaft(group, branch, { len: 0.9, r: 0.019, rTop: 0.014 });
        const knots = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < knots; i++) {
          const k = new THREE.Mesh(new THREE.SphereGeometry(0.014, this.seg(7, 5), this.seg(5, 4)), bark);
          k.position.set((rand() - 0.5) * 0.008, top - 0.15 - i * 0.18, (rand() - 0.5) * 0.008);
          k.scale.set(1.3, 0.7, 1.1);
          group.add(k);
        }
        const barkStrip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.021, 0.3, this.seg(9, 6)), bark);
        barkStrip.position.y = top - 0.72;
        group.add(barkStrip);
        // A flake, not a blade: uneven and chipped down one side.
        const point = this._plate([[-0.024, 0], [0.02, 0.01], [0.03, 0.06], [0.006, 0.15], [-0.014, 0.07]], 0.01, flint);
        point.position.y = top + 0.01;
        group.add(point);
        for (let i = 0; i < 4; i++) {
          const lash = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0035, this.seg(4, 3), this.seg(9, 6)), sinew);
          lash.rotation.x = Math.PI / 2;
          lash.rotation.z = (rand() - 0.5) * 0.4;
          lash.position.y = top + 0.005 - i * 0.016;
          group.add(lash);
        }
        return group;
      },

      // ---- 622: Deadly Plunger ------------------------------------------------
      createDeadlyPlungerModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0xC8A870);
        const rubber = this._mat(0x8B2B22, { roughness: 0.95, metalness: 0.0 });
        const steel = this._mat(0x8A9096, { roughness: 0.5, metalness: 0.78 });
        const tape = this._wood(0x33332E);
        // The plunger is intact. Somebody has driven a knife through the cup
        // and taped it in place, which is somehow worse.
        const top = this._polearmShaft(group, wood, { len: 0.85, r: 0.014, buttMat: wood, butt: 'cap' });
        const cup = new THREE.Mesh(new THREE.SphereGeometry(0.055, this.seg(14, 8), this.seg(9, 6), 0, Math.PI * 2, 0, Math.PI / 2), rubber);
        cup.rotation.x = Math.PI;
        cup.position.y = top + 0.02;
        group.add(cup);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, this.seg(5, 4), this.seg(14, 8)), rubber);
        lip.rotation.x = Math.PI / 2;
        lip.position.y = top + 0.02;
        group.add(lip);
        const knife = this._plate(this._bladeOutline(0.18, 0.04, 0, 5, 0.5), 0.005, steel);
        knife.position.y = top + 0.05;
        group.add(knife);
        for (let i = 0; i < 3; i++) {
          const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), tape);
          t.position.y = top + 0.03 + i * 0.02;
          t.rotation.y = i * 0.5;
          group.add(t);
        }
        const dribble = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(7, 5), this.seg(5, 4)), rubber);
        dribble.position.set(0.03, top - 0.03, 0.02);
        dribble.userData.bob = { amp: 0.004, freq: 0.8 };
        group.add(dribble);
        return group;
      },

      // ---- 623: Sharpened Pool Cue --------------------------------------------
      createSharpenedPoolCueModel(weapon, rand) {
        const group = new THREE.Group();
        const maple = this._wood(0xD8B478);
        const butt = this._wood(0x2A1A12);
        const brass = this._mat(0xC8A23A, { roughness: 0.35, metalness: 0.85 });
        const chalk = this._mat(0x2A6B8B, { roughness: 0.95, metalness: 0.0 });
        // Taken off a wall bracket and put through a pencil sharpener. The
        // joint ring and the wrap are untouched.
        const top = this._polearmShaft(group, maple, { len: 1.0, r: 0.017, rTop: 0.008, buttMat: butt, butt: 'cap' });
        const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, this.seg(11, 7)), brass);
        joint.position.y = top - 0.46;
        group.add(joint);
        const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.019, 0.2, this.seg(11, 7)), butt);
        wrap.position.y = top - 0.62;
        group.add(wrap);
        const inlays = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < inlays; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / inlays) * Math.PI * 2;
          const inl = this._plate([[-0.005, 0], [0.005, 0], [0, 0.04]], 0.002, maple);
          inl.position.set(0, top - 0.52, 0.019);
          holder.add(inl);
          group.add(holder);
        }
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.09, this.seg(9, 6)), maple);
        point.position.y = top + 0.045;
        group.add(point);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.008, this.seg(9, 6)), chalk);
        tip.position.y = top + 0.088;
        group.add(tip);
        // The shavings that never got swept up, still clinging.
        for (let i = 0; i < 2; i++) {
          const sh = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0015, this.seg(4, 3), this.seg(8, 5)), maple);
          sh.position.y = top + 0.01 + i * 0.02;
          sh.rotation.set(0.4, i, 0);
          sh.userData.sway = { axis: 'x', amp: 0.2, freq: 1.4, phase: i };
          group.add(sh);
        }
        return group;
      },

      // ---- 624: Broom Spear ---------------------------------------------------
      createBroomSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const handleColor = this.getRandomColor(rand, [0x3A6BC0, 0xC03A3A, 0xE8B02A]);
        const painted = this._mat(handleColor, { roughness: 0.6, metalness: 0.08 });
        const straw = this._mat(0xC8A85A, { roughness: 0.95, metalness: 0.02 });
        const steel = this._mat(0x8A9096, { roughness: 0.5, metalness: 0.78 });
        const tape = this._wood(0x33332E);
        // Still a broom. The head is on the wrong end and there is a kitchen
        // knife taped to the handle.
        const top = this._polearmShaft(group, painted, { len: 1.05, r: 0.014, buttMat: painted, butt: 'cap' });
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.03), painted);
        block.position.y = top - 0.92;
        group.add(block);
        const bristles = this.isLowDetail() ? 5 : 11;
        for (let i = 0; i < bristles; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.09, 0.02), straw);
          b.position.set(-0.05 + (i / (bristles - 1)) * 0.1, top - 0.98, 0);
          b.rotation.z = (rand() - 0.5) * 0.2;
          b.userData.sway = { axis: 'z', amp: 0.06, freq: 1.2 + i * 0.1, phase: i };
          group.add(b);
        }
        const knife = this._plate(this._bladeOutline(0.16, 0.04, 0.06, 5, 0.35), 0.005, steel);
        knife.position.set(0.01, top - 0.02, 0);
        group.add(knife);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.07, 0.014), tape);
        grip.position.set(0.01, top - 0.05, 0);
        group.add(grip);
        for (let i = 0; i < 4; i++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.005, this.seg(4, 3), this.seg(10, 6)), tape);
          t.rotation.x = Math.PI / 2;
          t.position.y = top - 0.03 - i * 0.024;
          group.add(t);
        }
        return group;
      },

      // ---- 625: Antenna Rapier ------------------------------------------------
      createAntennaRapierModel(weapon, rand) {
        const group = new THREE.Group();
        const chrome = this._mat(0xC8CED4, { roughness: 0.25, metalness: 0.92 });
        const black = this._mat(0x1A1C20, { roughness: 0.8, metalness: 0.1 });
        const copper = this._mat(0xB87333, { roughness: 0.4, metalness: 0.8 });
        // Snapped off a car roof: a telescoping whip that is far too thin,
        // with the mount still on the end of it.
        const sections = this.isLowDetail() ? 3 : 5;
        let y = -0.6;
        for (let i = 0; i < sections; i++) {
          const len = 0.34 - i * 0.03;
          const r = 0.007 - i * 0.001;
          const sec = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.001, len, this.seg(8, 5)), chrome);
          sec.position.y = y + len / 2;
          group.add(sec);
          const collar = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.008, this.seg(8, 5)), chrome);
          collar.position.y = y;
          group.add(collar);
          y += len * 0.72;
        }
        const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.04, this.seg(11, 7)), black);
        mount.position.y = -0.62;
        group.add(mount);
        const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 6), chrome);
        nut.position.y = -0.645;
        group.add(nut);
        const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, this.seg(7, 5)), black);
        lead.position.set(0.014, -0.68, 0);
        lead.rotation.z = 0.35;
        lead.userData.sway = { axis: 'z', amp: 0.2, freq: 1.5 };
        group.add(lead);
        const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, this.seg(8, 5)), copper);
        plug.position.set(0.045, -0.72, 0);
        plug.rotation.z = 0.35;
        group.add(plug);
        // The tip, which bends because it cannot help it.
        const tipWhip = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.004, 0.12, this.seg(6, 4)), chrome);
        tipWhip.position.y = y + 0.06;
        tipWhip.rotation.z = 0.06;
        tipWhip.userData.sway = { axis: 'z', amp: 0.12, freq: 3.0 };
        group.add(tipWhip);
        return group;
      },

      // ---- 626: Sign Post -----------------------------------------------------
      createSignPostModel(weapon, rand) {
        const group = new THREE.Group();
        const galv = this._mat(0x9AA0A6, { roughness: 0.6, metalness: 0.7 });
        const faceColor = this.getRandomColor(rand, [0xC03A2E, 0x2A6BC0, 0x2A8B4A]);
        const face = this._mat(faceColor, { roughness: 0.5, metalness: 0.2 });
        const white = this._mat(0xE8E8E4, { roughness: 0.5, metalness: 0.15 });
        const dirt = this._wood(0x5B4A32);
        // Pulled out of the ground, concrete and all, and swung with the sign
        // still bolted on. The bottom is a mace.
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.05, 0.03), galv);
        post.position.y = 0.2 - 0.525;
        group.add(post);
        const holes = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < holes; i++) {
          const h = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.034, this.seg(8, 5)), dirt);
          h.rotation.x = Math.PI / 2;
          h.position.y = 0.1 - i * 0.11;
          group.add(h);
        }
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.008), face);
        plate.position.y = 0.16;
        group.add(plate);
        const border = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.004), white);
        border.position.set(0, 0.16, 0.006);
        group.add(border);
        const legend = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.003), face);
        legend.position.set(0, 0.16, 0.009);
        group.add(legend);
        for (const s of [-1, 1]) {
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 6), galv);
          bolt.rotation.x = Math.PI / 2;
          bolt.position.set(0, 0.16 + s * 0.05, 0.008);
          group.add(bolt);
        }
        // The footing it came up with.
        const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05, 0), dirt);
        lump.position.y = -0.83;
        lump.scale.set(1.1, 0.8, 1);
        group.add(lump);
        return group;
      },

      // ---- 627: Javelin -------------------------------------------------------
      createJavelinModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0xC8A870);
        const iron = this._mat(0x7A7F86, { roughness: 0.5, metalness: 0.72 });
        const cord = this._mat(0xC8B48A, { roughness: 0.9, metalness: 0.03 });
        // Made to be thrown, so everything about it is light: a thin shaft, a
        // small head, and a throwing loop at the balance point.
        const top = this._polearmShaft(group, ash, { len: 1.0, r: 0.012, rTop: 0.009, buttMat: iron, butt: 'spike' });
        this._polearmSocket(group, iron, top + 0.01, { rTop: 0.013, rBot: 0.015, h: 0.05 });
        const head = this._plate(this._bladeOutline(0.13, 0.036, 0, 5, 1), 0.006, iron);
        head.position.y = top + 0.03;
        group.add(head);
        // The amentum, the leather loop it is thrown from.
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, this.seg(5, 4), this.seg(12, 7)), cord);
        loop.position.set(0.012, top - 0.4, 0);
        loop.rotation.set(0, 0.3, 0.4);
        loop.userData.sway = { axis: 'z', amp: 0.15, freq: 1.3 };
        group.add(loop);
        for (let i = 0; i < 3; i++) {
          const b = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.003, this.seg(4, 3), this.seg(9, 6)), cord);
          b.rotation.x = Math.PI / 2;
          b.position.y = top - 0.38 - i * 0.012;
          group.add(b);
        }
        return group;
      },

      // ---- 628: Seed Spear ----------------------------------------------------
      createSeedSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const living = this._wood(0x6E8B3A);
        const bark = this._wood(0x4A5B28);
        const leafColor = this.getRandomColor(rand, [0x4E9A3A, 0x6BBF48]);
        const leaf = this._mat(leafColor, { roughness: 0.6, metalness: 0.05 });
        const thorn = this._mat(0xC8B060, { roughness: 0.5, metalness: 0.1 });
        const sap = this._glow(0xB8FF5A, 0.9);
        // It grew into this shape and is still growing: a thorn for a head,
        // leaves down the shaft, and a seed at the base waiting its turn.
        const top = this._polearmShaft(group, living, { len: 0.92, r: 0.017 });
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.18, this.seg(7, 5)), thorn);
        point.position.y = top + 0.09;
        group.add(point);
        const ridges = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < ridges; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.018 - i * 0.003, 0.003, this.seg(4, 3), this.seg(10, 6)), bark);
          r.rotation.x = Math.PI / 2;
          r.position.y = top + 0.02 + i * 0.03;
          group.add(r);
        }
        const leaves = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < leaves; i++) {
          const l = this._plate([[0, 0], [0.022, 0.016], [0.034, 0.05], [0.006, 0.038]], 0.003, leaf);
          l.position.set(0.012, top - 0.1 - i * 0.11, 0);
          const holder = new THREE.Group();
          holder.rotation.y = i * 1.4;
          holder.add(l);
          l.rotation.z = -0.4;
          l.userData.sway = { axis: 'z', amp: 0.14, freq: 1.0 + i * 0.12, phase: i };
          group.add(holder);
        }
        const pod = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(11, 7), this.seg(8, 5)), bark);
        pod.scale.y = 1.4;
        pod.position.y = top - 0.9;
        group.add(pod);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.012, this.seg(9, 6), this.seg(6, 4)), sap);
        glow.position.y = top - 0.9;
        glow.userData.pulse = { min: 0.25, max: 1.0, freq: 0.8 };
        group.add(glow);
        return group;
      },

      // ---- 629: Short Spear ---------------------------------------------------
      createShortSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0xB08048);
        const iron = this._mat(0x7A7F86, { roughness: 0.45, metalness: 0.75 });
        const leather = this._wood(0x5B3A1E);
        // Short enough to use one-handed with a shield. Plain leaf head,
        // riveted socket, leather at the grip.
        const top = this._polearmShaft(group, ash, { len: 0.72, r: 0.016, buttMat: iron, butt: 'cap' });
        this._polearmSocket(group, iron, top + 0.005, { rTop: 0.017, rBot: 0.02, h: 0.07, rivets: true });
        const blade = this._plate(this._bladeOutline(0.19, 0.06, 0, 6, 1, { belly: 0.25 }), 0.008, iron);
        blade.position.y = top + 0.035;
        group.add(blade);
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.17, 0.014), iron);
        rib.position.y = top + 0.11;
        group.add(rib);
        const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.18, this.seg(10, 6)), leather);
        gripWrap.position.y = top - 0.34;
        group.add(gripWrap);
        const n = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < n; i++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.003, this.seg(4, 3), this.seg(10, 6)), leather);
          t.rotation.x = Math.PI / 2;
          t.position.y = top - 0.26 - i * 0.03;
          group.add(t);
        }
        return group;
      },

      // ---- 630: Sumerian Spear ------------------------------------------------
      createSumerianSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x8B5A2B);
        const bronze = this._mat(0xB08A3A, { roughness: 0.4, metalness: 0.8 });
        const lapis = this._mat(0x2A4A9B, { roughness: 0.35, metalness: 0.25 });
        const cord = this._mat(0xC8B48A, { roughness: 0.9, metalness: 0.03 });
        // Bronze age, and it looks it: a cast head with a long tang, lapis
        // inlay at the socket and a wound cord grip.
        const top = this._polearmShaft(group, wood, { len: 0.95, r: 0.017, buttMat: bronze, butt: 'spike' });
        this._polearmSocket(group, bronze, top, { rTop: 0.019, rBot: 0.022, h: 0.09, rivets: true });
        const blade = this._plate(this._bladeOutline(0.22, 0.05, 0, 6, 1), 0.009, bronze);
        blade.position.y = top + 0.045;
        group.add(blade);
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.2, 0.016), bronze);
        spine.position.y = top + 0.13;
        group.add(spine);
        const inlays = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < inlays; i++) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, this.seg(4, 3), this.seg(12, 7)), lapis);
          band.rotation.x = Math.PI / 2;
          band.position.y = top - 0.02 - i * 0.026;
          group.add(band);
        }
        const grip = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < grip; i++) {
          const c = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0035, this.seg(4, 3), this.seg(10, 6)), cord);
          c.rotation.x = Math.PI / 2;
          c.position.y = top - 0.3 - i * 0.026;
          group.add(c);
        }
        return group;
      },

      // ---- 631: Pilum ---------------------------------------------------------
      createPilumModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0xA0703C);
        const softIron = this._mat(0x6E7378, { roughness: 0.65, metalness: 0.6 });
        const hard = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.82 });
        // The Roman throwing spear: a long soft iron shank that bends on
        // impact so it cannot be thrown back, and a tiny pyramidal head.
        const top = this._polearmShaft(group, wood, { len: 0.62, r: 0.019, rTop: 0.017, buttMat: hard, butt: 'cap' });
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.023, 0.06, this.seg(10, 6)), hard);
        collar.position.y = top + 0.02;
        group.add(collar);
        for (let i = 0; i < 2; i++) {
          const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, this.seg(7, 5)), hard);
          rv.rotation.z = Math.PI / 2;
          rv.position.y = top + 0.006 + i * 0.03;
          group.add(rv);
        }
        // The shank: thin, long, and the whole point of the weapon.
        const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.36, this.seg(8, 5)), softIron);
        shank.position.y = top + 0.23;
        group.add(shank);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 4), hard);
        head.position.y = top + 0.43;
        group.add(head);
        const barb = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.03, 4), hard);
        barb.rotation.x = Math.PI;
        barb.position.y = top + 0.405;
        group.add(barb);
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.046, this.seg(6, 4)), softIron);
        pin.rotation.z = Math.PI / 2;
        pin.position.y = top + 0.036;
        group.add(pin);
        return group;
      },

      // ---- 632: Dory Spear ----------------------------------------------------
      createDorySpearModel(weapon, rand) {
        const group = new THREE.Group();
        const cornel = this._wood(0x8B6A3B);
        const iron = this._mat(0x7A7F86, { roughness: 0.45, metalness: 0.75 });
        const bronze = this._mat(0xB08A3A, { roughness: 0.4, metalness: 0.8 });
        const leather = this._wood(0x5B3A1E);
        // The hoplite spear. Leaf head at the top, and the sauroter (the
        // "lizard-killer") at the bottom, which is a real weapon in itself.
        const top = this._polearmShaft(group, cornel, { len: 1.15, r: 0.017 });
        this._polearmSocket(group, iron, top + 0.01, { rTop: 0.018, rBot: 0.021, h: 0.07 });
        const blade = this._plate(this._bladeOutline(0.22, 0.062, 0, 6, 1, { belly: 0.2 }), 0.008, iron);
        blade.position.y = top + 0.04;
        group.add(blade);
        const midrib = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.2, 0.016), iron);
        midrib.position.y = top + 0.12;
        group.add(midrib);
        // The butt-spike, in bronze, square in section.
        const sauroter = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.14, 4), bronze);
        sauroter.rotation.x = Math.PI;
        sauroter.position.y = top - 1.22;
        group.add(sauroter);
        const sockButt = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.019, 0.06, this.seg(10, 6)), bronze);
        sockButt.position.y = top - 1.12;
        group.add(sockButt);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.16, this.seg(10, 6)), leather);
        grip.position.y = top - 0.6;
        group.add(grip);
        return group;
      },

      // ---- 633: Boarding Pike -------------------------------------------------
      createBoardingPikeModel(weapon, rand) {
        const group = new THREE.Group();
        const oak = this._wood(0x6B4423);
        const iron = this._mat(0x5A5F66, { roughness: 0.6, metalness: 0.68 });
        const tar = this._mat(0x1A1A1E, { roughness: 0.9, metalness: 0.05 });
        const brass = this._mat(0xB08A3A, { roughness: 0.45, metalness: 0.8 });
        // Ship's issue: tarred against the salt, with long langets down the
        // shaft so it cannot be cut off, and a plain spike.
        const top = this._polearmShaft(group, oak, { len: 1.2, r: 0.018, buttMat: brass, butt: 'cap' });
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.16, this.seg(8, 5)), iron);
        spike.position.y = top + 0.08;
        group.add(spike);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.05, this.seg(10, 6)), iron);
        collar.position.y = top - 0.01;
        group.add(collar);
        for (const s of [-1, 1]) {
          const lang = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.26, 0.026), iron);
          lang.position.set(s * 0.017, top - 0.15, 0);
          group.add(lang);
          for (let i = 0; i < 3; i++) {
            const nail = new THREE.Mesh(new THREE.SphereGeometry(0.005, this.seg(6, 4), this.seg(5, 3)), iron);
            nail.position.set(s * 0.021, top - 0.08 - i * 0.09, 0);
            group.add(nail);
          }
        }
        const tarred = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.02, 0.5, this.seg(10, 6)), tar);
        tarred.position.y = top - 0.72;
        group.add(tarred);
        const rope = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < rope; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.004, this.seg(4, 3), this.seg(10, 6)), oak);
          r.rotation.x = Math.PI / 2;
          r.position.y = top - 0.5 - i * 0.04;
          group.add(r);
        }
        return group;
      },

      // ---- 634: Long Spear ----------------------------------------------------
      createLongSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0xC8A870);
        const iron = this._mat(0x7A7F86, { roughness: 0.45, metalness: 0.76 });
        const cord = this._mat(0xB8A87A, { roughness: 0.9, metalness: 0.03 });
        // A pike, in effect: nothing on it but length, a small head to keep
        // the weight down, and a splice halfway because no tree is that tall.
        const top = this._polearmShaft(group, ash, { len: 1.6, r: 0.018, rTop: 0.013, buttMat: iron, butt: 'spike' });
        this._polearmSocket(group, iron, top + 0.005, { rTop: 0.015, rBot: 0.017, h: 0.06, langets: true, langetLen: 0.16 });
        const blade = this._plate(this._bladeOutline(0.16, 0.042, 0, 5, 1), 0.007, iron);
        blade.position.y = top + 0.035;
        group.add(blade);
        // The splice, wound tight.
        const splice = this.isLowDetail() ? 4 : 8;
        for (let i = 0; i < splice; i++) {
          const c = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0035, this.seg(4, 3), this.seg(10, 6)), cord);
          c.rotation.x = Math.PI / 2;
          c.position.y = top - 0.72 - i * 0.018;
          group.add(c);
        }
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.1, this.seg(10, 6)), ash);
        sleeve.position.y = top - 0.79;
        group.add(sleeve);
        return group;
      },

      // ---- 635: Iklwa --------------------------------------------------------
      createIklwaModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6E4A2A);
        const iron = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.8 });
        const hide = this._wood(0x8B7355);
        const white = this._mat(0xE8E4D8, { roughness: 0.85, metalness: 0.02 });
        // The Zulu stabbing spear: a short heavy shaft and a broad blade,
        // with the hide tube that binds the tang still on it.
        const top = this._polearmShaft(group, wood, { len: 0.6, r: 0.019, rTop: 0.018 });
        const blade = this._plate(this._bladeOutline(0.26, 0.085, 0, 7, 1, { belly: 0.3, taperPow: 3.2 }), 0.009, iron);
        blade.position.y = top + 0.03;
        group.add(blade);
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.22, 0.018), iron);
        rib.position.y = top + 0.12;
        group.add(rib);
        // The hide sleeve, which is what actually holds the blade on.
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.026, 0.16, this.seg(11, 7)), hide);
        sleeve.position.y = top - 0.05;
        group.add(sleeve);
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.15, 0.03), wood);
        seam.position.set(0.024, top - 0.05, 0);
        group.add(seam);
        const rings = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < rings; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, this.seg(4, 3), this.seg(11, 7)), white);
          r.rotation.x = Math.PI / 2;
          r.position.y = top - 0.01 - i * 0.04;
          group.add(r);
        }
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.002, 0.09, this.seg(6, 4)), hide);
        tail.position.set(0.02, top - 0.16, 0);
        tail.rotation.z = 0.3;
        tail.userData.sway = { axis: 'z', amp: 0.18, freq: 1.4 };
        group.add(tail);
        return group;
      },

      // ---- 636: Rifle Bayonet -------------------------------------------------
      createRifleBayonetModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x6B4423);
        const blued = this._mat(0x2A2E34, { roughness: 0.45, metalness: 0.8 });
        const steel = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.85 });
        const brass = this._mat(0xB08A3A, { roughness: 0.45, metalness: 0.8 });
        // Not a spear: a rifle with a blade on the end, used as one. It is
        // heavy at the wrong end and still has its sights and sling swivels.
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.34, 0.05), wood);
        stock.position.y = -0.36;
        group.add(stock);
        const comb = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.14, 0.036), wood);
        comb.position.set(0, -0.2, -0.016);
        group.add(comb);
        const butt = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.06), blued);
        butt.position.y = -0.54;
        group.add(butt);
        const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.16, 0.04), blued);
        receiver.position.y = -0.08;
        group.add(receiver);
        const boltHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, this.seg(8, 5)), steel);
        boltHandle.rotation.z = Math.PI / 2;
        boltHandle.position.set(0.028, -0.09, 0);
        boltHandle.userData.gun = 'bolt';
        group.add(boltHandle);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.009, this.seg(8, 5), this.seg(6, 4)), steel);
        knob.position.set(0.052, -0.09, 0);
        group.add(knob);
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.03), blued);
        mag.position.set(0, -0.15, 0.014);
        group.add(mag);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.42, this.seg(11, 7)), blued);
        barrel.position.y = 0.21;
        group.add(barrel);
        const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.2, this.seg(10, 6)), wood);
        handguard.position.y = 0.1;
        group.add(handguard);
        for (const y of [0.02, 0.3]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, this.seg(4, 3), this.seg(12, 7)), steel);
          band.rotation.x = Math.PI / 2;
          band.position.y = y;
          group.add(band);
        }
        const swivel = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.002, this.seg(4, 3), this.seg(9, 6)), steel);
        swivel.position.set(0, 0.3, 0.022);
        swivel.userData.sway = { axis: 'x', amp: 0.2, freq: 1.5 };
        group.add(swivel);
        const front = this._plate([[-0.004, 0], [0.004, 0], [0.002, 0.016], [-0.002, 0.016]], 0.006, steel);
        front.position.y = 0.4;
        group.add(front);
        const lug = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.04, 0.016), steel);
        lug.position.y = 0.43;
        group.add(lug);
        // The bayonet itself, socketed off-centre as they always are.
        const blade = this._plate(this._bladeOutline(0.3, 0.03, 0, 6, 0.4), 0.006, steel);
        blade.position.set(0, 0.45, 0.012);
        group.add(blade);
        const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.24, 0.008), blued);
        fuller.position.set(0, 0.56, 0.012);
        group.add(fuller);
        const guardRing = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, this.seg(4, 3), this.seg(11, 7)), brass);
        guardRing.rotation.x = Math.PI / 2;
        guardRing.position.set(0, 0.45, 0);
        group.add(guardRing);
        return group;
      },

      // ---- 637: Naginata ------------------------------------------------------
      createNaginataModel(weapon, rand) {
        const group = new THREE.Group();
        const lacquerColor = this.getRandomColor(rand, [0x1A1A1E, 0x8B2B22, 0x2A3A5B]);
        const lacquer = this._mat(lacquerColor, { roughness: 0.2, metalness: 0.2 });
        const steel = this._mat(0xC0C6CC, { roughness: 0.18, metalness: 0.95 });
        const brass = this._mat(0xB08A3A, { roughness: 0.4, metalness: 0.82 });
        const cord = this._mat(0x2A2A2E, { roughness: 0.9, metalness: 0.03 });
        // A curved single-edged blade on a long oval shaft, with the habaki
        // and the tsuba it inherited from the sword it used to be.
        const top = this._polearmShaft(group, lacquer, { len: 1.25, r: 0.017, buttMat: brass, butt: 'cap' });
        const shaftFlat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 0.02), lacquer);
        shaftFlat.position.y = top - 0.6;
        group.add(shaftFlat);
        const blade = this._plate(this._bladeOutline(0.36, 0.055, 0.28, 8, 0.2, { taperPow: 3.4 }), 0.007, steel);
        blade.position.y = top + 0.05;
        group.add(blade);
        // The hamon, the temper line down the edge.
        const hamon = this._plate(this._bladeOutline(0.33, 0.022, 0.3, 7, 0.2), 0.008, brass);
        hamon.position.set(0.008, top + 0.06, 0);
        group.add(hamon);
        const habaki = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.04, 0.016), brass);
        habaki.position.y = top + 0.03;
        group.add(habaki);
        const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.005, this.seg(14, 8)), brass);
        tsuba.rotation.x = Math.PI / 2;
        tsuba.position.y = top;
        group.add(tsuba);
        const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.07, this.seg(11, 7)), brass);
        ferrule.position.y = top - 0.04;
        group.add(ferrule);
        const wraps = this.isLowDetail() ? 4 : 9;
        for (let i = 0; i < wraps; i++) {
          const w = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0035, this.seg(4, 3), this.seg(10, 6)), cord);
          w.rotation.x = Math.PI / 2;
          w.rotation.z = 0.2;
          w.position.y = top - 0.1 - i * 0.03;
          group.add(w);
        }
        return group;
      },

      // ---- 638: Halberd -------------------------------------------------------
      createHalberdModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0x8B6A3B);
        const steel = this._mat(0x8A9096, { roughness: 0.4, metalness: 0.82 });
        const dark = this._mat(0x4A4F55, { roughness: 0.6, metalness: 0.7 });
        // Axe on one side, hook on the other, spike on top: the three things
        // a foot soldier needs against a horse.
        const top = this._polearmShaft(group, ash, { len: 1.3, r: 0.019, buttMat: dark, butt: 'cap' });
        this._polearmSocket(group, dark, top, { rTop: 0.02, rBot: 0.023, h: 0.08, langets: true, langetLen: 0.3 });
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.28, 4), steel);
        spike.position.y = top + 0.19;
        group.add(spike);
        // The axe head, crescent, on one side.
        const axe = this._plate([[0, 0], [0.15, 0.03], [0.19, 0.1], [0.15, 0.17], [0, 0.2], [0.03, 0.1]], 0.007, steel);
        axe.position.set(0.01, top + 0.03, 0);
        group.add(axe);
        const axeEdge = this._plate([[0.15, 0.03], [0.19, 0.1], [0.15, 0.17], [0.16, 0.1]], 0.009, dark);
        axeEdge.position.set(0.01, top + 0.03, 0);
        group.add(axeEdge);
        // The fluke, a back-hook for pulling riders down.
        const hook = this._plate([[0, 0.04], [-0.1, 0.06], [-0.14, 0.14], [-0.1, 0.11], [-0.03, 0.09]], 0.007, steel);
        hook.position.set(-0.01, top + 0.03, 0);
        group.add(hook);
        const rondel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, this.seg(13, 8)), dark);
        rondel.rotation.x = Math.PI / 2;
        rondel.position.y = top - 0.05;
        group.add(rondel);
        for (let i = 0; i < 3; i++) {
          const rv = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(7, 5), this.seg(5, 4)), dark);
          rv.position.set(0.04, top + 0.05 + i * 0.05, 0.005);
          group.add(rv);
        }
        return group;
      },

      // ---- 639: Poleaxe -------------------------------------------------------
      createPoleaxeModel(weapon, rand) {
        const group = new THREE.Group();
        const oak = this._wood(0x6B4423);
        const steel = this._mat(0x9AA0A6, { roughness: 0.35, metalness: 0.86 });
        const dark = this._mat(0x3A3F45, { roughness: 0.6, metalness: 0.72 });
        // A knight's weapon, not a levy's: a short heavy head with an axe one
        // side and a hammer the other, all steel, langets the full length.
        const top = this._polearmShaft(group, oak, { len: 1.15, r: 0.02, buttMat: steel, butt: 'spike' });
        for (const s of [-1, 1]) {
          const lang = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.4, 0.03), dark);
          lang.position.set(s * 0.019, top - 0.22, 0);
          group.add(lang);
        }
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.22, 4), steel);
        spike.position.y = top + 0.16;
        group.add(spike);
        // The axe: narrow and deep, meant for armour.
        const axe = this._plate([[0, 0], [0.1, 0.02], [0.13, 0.08], [0.1, 0.14], [0, 0.16]], 0.009, steel);
        axe.position.set(0.012, top + 0.01, 0);
        group.add(axe);
        // The hammer: four teeth, which is what actually kills through plate.
        const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), steel);
        hammer.position.set(-0.05, top + 0.08, 0);
        group.add(hammer);
        for (let i = 0; i < 4; i++) {
          const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.018, 4), dark);
          tooth.rotation.z = Math.PI / 2;
          tooth.position.set(-0.088, top + 0.065 + (i % 2) * 0.03, -0.012 + Math.floor(i / 2) * 0.024);
          group.add(tooth);
        }
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.09, this.seg(11, 7)), dark);
        collar.position.y = top + 0.02;
        group.add(collar);
        const rondel = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.03, this.seg(14, 8)), steel);
        rondel.position.y = top - 0.16;
        group.add(rondel);
        return group;
      },

      // ---- 640: Glaive --------------------------------------------------------
      createGlaiveModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x5C3317);
        const steel = this._mat(0xB0B6BC, { roughness: 0.25, metalness: 0.9 });
        const brass = this._mat(0xB08A3A, { roughness: 0.42, metalness: 0.8 });
        const cord = this._mat(0x8B2B22, { roughness: 0.9, metalness: 0.03 });
        // A single broad blade on a pole, with a back-spur, and enough of it
        // that the weight is all at the top.
        const top = this._polearmShaft(group, wood, { len: 1.2, r: 0.019, buttMat: brass, butt: 'cap' });
        this._polearmSocket(group, brass, top, { rTop: 0.021, rBot: 0.024, h: 0.09, langets: true, langetLen: 0.24 });
        const blade = this._plate(this._bladeOutline(0.42, 0.09, 0.16, 8, 0.25, { belly: 0.2, taperPow: 3.0 }), 0.008, steel);
        blade.position.y = top + 0.06;
        group.add(blade);
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.3, 0.014), brass);
        spine.position.set(-0.02, top + 0.2, 0);
        spine.rotation.z = -0.05;
        group.add(spine);
        // The spur on the back of the blade.
        const spur = this._plate([[0, 0], [-0.07, 0.02], [-0.09, 0.07], [-0.05, 0.05], [-0.01, 0.04]], 0.006, steel);
        spur.position.set(-0.02, top + 0.13, 0);
        group.add(spur);
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.006, this.seg(5, 4), this.seg(13, 8)), brass);
        collar.rotation.x = Math.PI / 2;
        collar.position.y = top + 0.05;
        group.add(collar);
        const tassel = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < tassel; i++) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.07, this.seg(5, 3)), cord);
          const a = (i / tassel) * Math.PI * 2;
          t.position.set(Math.cos(a) * 0.012, top - 0.02, Math.sin(a) * 0.012);
          t.userData.sway = { axis: 'z', amp: 0.2, freq: 1.2 + i * 0.15, phase: i };
          group.add(t);
        }
        return group;
      },

      // ---- 641: Halberd (heavy) -----------------------------------------------
      createHeavyHalberdModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0x4A3524);
        const steel = this._mat(0x7A8086, { roughness: 0.45, metalness: 0.8 });
        const dark = this._mat(0x33383E, { roughness: 0.65, metalness: 0.68 });
        const brass = this._mat(0xB08A3A, { roughness: 0.45, metalness: 0.78 });
        // The Swiss article: everything on 638 but bigger, with an etched
        // panel on the axe and a longer spike, and it weighs accordingly.
        const top = this._polearmShaft(group, ash, { len: 1.45, r: 0.022, buttMat: dark, butt: 'cap' });
        this._polearmSocket(group, dark, top, { rTop: 0.024, rBot: 0.027, h: 0.1, langets: true, langetLen: 0.42 });
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.36, 4), steel);
        spike.position.y = top + 0.24;
        group.add(spike);
        const spikeBase = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), steel);
        spikeBase.position.y = top + 0.07;
        group.add(spikeBase);
        const axe = this._plate([[0, 0], [0.18, 0.04], [0.23, 0.12], [0.18, 0.21], [0, 0.24], [0.035, 0.12]], 0.008, steel);
        axe.position.set(0.012, top + 0.02, 0);
        group.add(axe);
        // The etched panel, which is the only decoration on it.
        const etch = this._plate([[0.05, 0.07], [0.13, 0.08], [0.13, 0.15], [0.05, 0.16]], 0.01, dark);
        etch.position.set(0.012, top + 0.02, 0);
        group.add(etch);
        const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, this.seg(4, 3), this.seg(12, 7), Math.PI), brass);
        crescent.position.set(0.09, top + 0.14, 0.006);
        group.add(crescent);
        const hook = this._plate([[0, 0.05], [-0.13, 0.07], [-0.19, 0.17], [-0.14, 0.13], [-0.04, 0.1]], 0.008, steel);
        hook.position.set(-0.012, top + 0.02, 0);
        group.add(hook);
        const rondel = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.007, this.seg(14, 8)), dark);
        rondel.rotation.x = Math.PI / 2;
        rondel.position.y = top - 0.06;
        group.add(rondel);
        for (let i = 0; i < 4; i++) {
          const rv = new THREE.Mesh(new THREE.SphereGeometry(0.007, this.seg(7, 5), this.seg(5, 4)), brass);
          rv.position.set(0.05, top + 0.06 + i * 0.05, 0.006);
          group.add(rv);
        }
        return group;
      },

      // ---- 642: Fire Lance ----------------------------------------------------
      createFireLanceModel(weapon, rand) {
        const group = new THREE.Group();
        const bamboo = this._wood(0xC8B060);
        const node = this._wood(0x8B7A3A);
        const iron = this._mat(0x6E7378, { roughness: 0.6, metalness: 0.65 });
        const soot = this._mat(0x2A2622, { roughness: 0.95, metalness: 0.05 });
        const flame = this._glow(0xFF7A2A, 1.2);
        const cord = this._mat(0xB8A87A, { roughness: 0.92, metalness: 0.02 });
        // The first gun, and it is a spear: a bamboo tube of powder lashed
        // below the head, fired once, then used as a spear anyway.
        const top = this._polearmShaft(group, bamboo, { len: 1.15, r: 0.018 });
        const nodes = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < nodes; i++) {
          const n = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.005, this.seg(4, 3), this.seg(11, 7)), node);
          n.rotation.x = Math.PI / 2;
          n.position.y = top - 0.12 - i * 0.18;
          group.add(n);
        }
        const point = this._plate(this._bladeOutline(0.16, 0.045, 0, 5, 1), 0.007, iron);
        point.position.y = top + 0.08;
        group.add(point);
        // The tube, and the soot that says it has been fired.
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.18, this.seg(12, 7)), bamboo);
        tube.position.set(0.03, top - 0.02, 0);
        group.add(tube);
        const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.03, this.seg(12, 7)), soot);
        mouth.position.set(0.03, top + 0.08, 0);
        group.add(mouth);
        const spit = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, this.seg(8, 5)), flame);
        spit.position.set(0.03, top + 0.13, 0);
        spit.userData.pulse = { min: 0.3, max: 1.3, freq: 2.2 };
        group.add(spit);
        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.07, this.seg(6, 4)), cord);
        fuse.position.set(0.048, top - 0.1, 0);
        fuse.rotation.z = 0.5;
        fuse.userData.sway = { axis: 'z', amp: 0.18, freq: 1.4 };
        group.add(fuse);
        for (let i = 0; i < 3; i++) {
          const lash = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, this.seg(4, 3), this.seg(12, 7)), cord);
          lash.rotation.set(Math.PI / 2, 0, 0.1);
          lash.position.set(0.015, top - 0.04 + i * 0.06, 0);
          group.add(lash);
        }
        return group;
      },

      // ---- 643: Mithril Spear -------------------------------------------------
      createMithrilSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const mithril = this._mat(0xD8E4F0, { roughness: 0.12, metalness: 0.98 });
        const pale = this._mat(0xA8BCD0, { roughness: 0.2, metalness: 0.9 });
        const shine = this._glow(0xE8F4FF, 0.7);
        // Drawn out of one piece, so light it has no counterweight, with the
        // fluting that is the only way to tell it apart from silver.
        const top = this._polearmShaft(group, mithril, { len: 1.2, r: 0.014, rTop: 0.012 });
        const flutes = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < flutes; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / flutes) * Math.PI * 2;
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.9, 0.006), pale);
          f.position.set(0, top - 0.5, 0.014);
          holder.add(f);
          group.add(holder);
        }
        const blade = this._plate(this._bladeOutline(0.28, 0.05, 0, 7, 1, { taperPow: 2.0 }), 0.007, mithril);
        blade.position.y = top + 0.03;
        group.add(blade);
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.25, 0.012), pale);
        rib.position.y = top + 0.14;
        group.add(rib);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.05, this.seg(12, 7)), pale);
        collar.position.y = top + 0.01;
        group.add(collar);
        const leaves = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < leaves; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / leaves) * Math.PI * 2;
          const l = this._plate([[0, 0], [0.024, 0.02], [0.03, 0.06], [0.006, 0.045]], 0.003, mithril);
          l.position.set(0, top - 0.01, 0.012);
          holder.add(l);
          group.add(holder);
        }
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.002, this.seg(4, 3), this.seg(16, 9)), shine);
        halo.rotation.x = Math.PI / 2;
        halo.position.y = top + 0.02;
        halo.userData.spin = { axis: 'y', speed: 0.5 };
        group.add(halo);
        return group;
      },

      // ---- 644: Tempest Trident -----------------------------------------------
      createTempestTridentModel(weapon, rand) {
        const group = new THREE.Group();
        const bronze = this._mat(0x2A8B8B, { roughness: 0.3, metalness: 0.85 });
        const deep = this._mat(0x1A4A5B, { roughness: 0.45, metalness: 0.6 });
        const arc = this._glow(0x7AE8FF, 1.2);
        const coral = this._mat(0xC85A6B, { roughness: 0.7, metalness: 0.1 });
        // Three prongs and the storm between them: the arc jumps from tine to
        // tine and never stops.
        const top = this._polearmShaft(group, deep, { len: 1.15, r: 0.019, buttMat: bronze, butt: 'spike' });
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), bronze);
        head.position.y = top + 0.02;
        group.add(head);
        for (let i = -1; i <= 1; i++) {
          const prong = new THREE.Mesh(new THREE.ConeGeometry(0.013, i === 0 ? 0.26 : 0.2, this.seg(7, 5)), bronze);
          prong.position.set(i * 0.045, top + (i === 0 ? 0.15 : 0.12), 0);
          if (i !== 0) prong.rotation.z = -i * 0.12;
          group.add(prong);
          const barb = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, this.seg(6, 4)), bronze);
          barb.rotation.x = Math.PI;
          barb.position.set(i * 0.045, top + (i === 0 ? 0.06 : 0.05), 0);
          group.add(barb);
        }
        // The arc, drawn as a chain of small bolts between the tines.
        const bolts = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < bolts; i++) {
          const t = i / (bolts - 1);
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), arc);
          b.position.set(-0.045 + t * 0.09, top + 0.13 + Math.sin(t * 6) * 0.02, 0);
          b.rotation.z = Math.sin(t * 9) * 0.7;
          b.userData.pulse = { min: 0.2, max: 1.3, freq: 3.0 + i, phase: i };
          group.add(b);
        }
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.018, this.seg(11, 7), this.seg(8, 5)), arc);
        bulb.position.y = top + 0.02;
        bulb.userData.pulse = { min: 0.4, max: 1.2, freq: 1.6 };
        group.add(bulb);
        const growths = this.isLowDetail() ? 2 : 5;
        for (let i = 0; i < growths; i++) {
          const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.012, 0), coral);
          c.position.set(0.014, top - 0.15 - i * 0.16, 0);
          c.scale.set(1, 1.3, 0.8);
          group.add(c);
        }
        return group;
      },

      // ---- 645: Dragon Spear --------------------------------------------------
      createDragonSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const scaleColor = this.getRandomColor(rand, [0xB03A22, 0x2A6B3A, 0x8B2B5B]);
        const scale = this._mat(scaleColor, { roughness: 0.4, metalness: 0.45 });
        const gold = this._mat(0xD4A62A, { roughness: 0.28, metalness: 0.92 });
        const steel = this._mat(0xC0C6CC, { roughness: 0.2, metalness: 0.94 });
        const ember = this._glow(0xFF7A2A, 1.15);
        // The shaft is the animal: it coils up the wood and the head comes
        // out of its mouth.
        const top = this._polearmShaft(group, scale, { len: 1.2, r: 0.019, buttMat: gold, butt: 'spike' });
        const coils = this.isLowDetail() ? 5 : 11;
        for (let i = 0; i < coils; i++) {
          const t = i / (coils - 1);
          const c = new THREE.Mesh(new THREE.TorusGeometry(0.024 - t * 0.006, 0.006, this.seg(5, 4), this.seg(12, 7)), gold);
          c.rotation.set(Math.PI / 2 + 0.2, t * 5.5, 0);
          c.position.y = top - 0.12 - t * 0.85;
          group.add(c);
        }
        const skull = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.08, this.seg(8, 5)), scale);
        skull.position.y = top + 0.02;
        group.add(skull);
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.036), gold);
        jaw.position.set(0, top - 0.005, 0.016);
        jaw.rotation.x = -0.3;
        group.add(jaw);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(7, 5), this.seg(5, 4)), ember);
          eye.position.set(s * 0.014, top + 0.03, 0.014);
          eye.userData.pulse = { min: 0.5, max: 1.2, freq: 0.7 };
          group.add(eye);
          const horn = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.06, this.seg(6, 4)), gold);
          horn.position.set(s * 0.02, top + 0.07, -0.014);
          horn.rotation.set(-0.5, 0, s * 0.4);
          group.add(horn);
        }
        // The blade coming out of the throat.
        const blade = this._plate(this._bladeOutline(0.3, 0.055, 0.08, 7, 0.6), 0.008, steel);
        blade.position.y = top + 0.06;
        group.add(blade);
        const heat = this._plate(this._bladeOutline(0.24, 0.02, 0.09, 6, 0.6), 0.009, ember);
        heat.position.y = top + 0.07;
        heat.userData.pulse = { min: 0.25, max: 1.0, freq: 1.1 };
        group.add(heat);
        return group;
      },

      // ---- 646: Warding Spear -------------------------------------------------
      createWardingSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const ash = this._wood(0xC8B090);
        const silver = this._mat(0xC8CED4, { roughness: 0.28, metalness: 0.9 });
        const sigil = this._glow(0x8ABFFF, 0.9);
        const cord = this._mat(0xE8E4D8, { roughness: 0.9, metalness: 0.03 });
        // Made to keep things out rather than to kill them: the shaft is
        // written on end to end, and the ring at the head closes the circle.
        const top = this._polearmShaft(group, ash, { len: 1.15, r: 0.018, buttMat: silver, butt: 'cap' });
        const runes = this.isLowDetail() ? 5 : 11;
        for (let i = 0; i < runes; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = i * 1.1;
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.02, 0.006), sigil);
          r.position.set(0, top - 0.1 - i * 0.09, 0.017);
          r.userData.pulse = { min: 0.2, max: 0.9, freq: 0.6 + i * 0.1, phase: i };
          holder.add(r);
          group.add(holder);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, this.seg(5, 4), this.seg(18, 10)), silver);
        ring.position.y = top + 0.09;
        group.add(ring);
        const inner = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.002, this.seg(4, 3), this.seg(16, 9)), sigil);
        inner.position.y = top + 0.09;
        inner.userData.spin = { axis: 'y', speed: 0.6 };
        group.add(inner);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.004), silver);
          spoke.position.set(Math.cos(a) * 0.026, top + 0.09 + Math.sin(a) * 0.026, 0);
          spoke.rotation.z = a + Math.PI / 2;
          group.add(spoke);
        }
        const point = this._plate(this._bladeOutline(0.13, 0.036, 0, 5, 1), 0.006, silver);
        point.position.y = top + 0.005;
        group.add(point);
        const charms = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < charms; i++) {
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.06, this.seg(5, 3)), cord);
          c.position.set(0.02, top + 0.02 - i * 0.01, 0);
          c.rotation.z = 0.3 + i * 0.1;
          c.userData.sway = { axis: 'z', amp: 0.2, freq: 1.1 + i * 0.2, phase: i };
          group.add(c);
        }
        return group;
      },

      // ---- 647: Leviathan Fang Spear ------------------------------------------
      createLeviathanFangSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const bone = this._mat(0xD8CFB8, { roughness: 0.6, metalness: 0.06 });
        const grey = this._mat(0x5B6B78, { roughness: 0.55, metalness: 0.3 });
        const hide = this._wood(0x3A4A52);
        const brine = this._glow(0x4AE8C8, 0.8);
        // One tooth off something that lives too deep to name, still wet, on
        // a shaft of its own jawbone.
        const top = this._polearmShaft(group, grey, { len: 1.15, r: 0.02, rTop: 0.017 });
        // The fang: curved, ridged and far too big.
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.34, this.seg(9, 6)), bone);
        fang.position.y = top + 0.17;
        fang.rotation.z = 0.06;
        group.add(fang);
        const ridges = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < ridges; i++) {
          const t = i / ridges;
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.035 - t * 0.026, 0.004, this.seg(4, 3), this.seg(11, 7)), bone);
          r.rotation.x = Math.PI / 2;
          r.position.y = top + 0.03 + t * 0.28;
          group.add(r);
        }
        const root = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.028, 0.08, this.seg(11, 7)), bone);
        root.position.y = top;
        group.add(root);
        const gum = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.009, this.seg(5, 4), this.seg(13, 8)), hide);
        gum.rotation.x = Math.PI / 2;
        gum.position.y = top - 0.03;
        group.add(gum);
        const barnacles = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < barnacles; i++) {
          const b = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.014, this.seg(6, 4)), bone);
          const a = rand() * Math.PI * 2;
          b.position.set(Math.cos(a) * 0.021, top - 0.1 - i * 0.13, Math.sin(a) * 0.021);
          b.rotation.set(Math.PI / 2, 0, -a);
          group.add(b);
        }
        const drip = new THREE.Mesh(new THREE.SphereGeometry(0.008, this.seg(8, 5), this.seg(6, 4)), brine);
        drip.position.y = top + 0.35;
        drip.userData.pulse = { min: 0.2, max: 0.9, freq: 0.9 };
        group.add(drip);
        const weeds = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < weeds; i++) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.07, 0.012), hide);
          w.position.set(0.02, top - 0.06 - i * 0.2, 0);
          w.rotation.z = 0.25;
          w.userData.sway = { axis: 'z', amp: 0.2, freq: 0.9 + i * 0.2, phase: i };
          group.add(w);
        }
        return group;
      },

      // ---- 648: Serpent Caller ------------------------------------------------
      createSerpentCallerModel(weapon, rand) {
        const group = new THREE.Group();
        const wood = this._wood(0x4A3A28);
        const green = this._mat(0x3A8B4A, { roughness: 0.45, metalness: 0.35 });
        const gold = this._mat(0xC8A23A, { roughness: 0.32, metalness: 0.88 });
        const venom = this._glow(0x9BFF3A, 1.0);
        const scaleMat = this._mat(0x2A5B3A, { roughness: 0.5, metalness: 0.3 });
        // It does not stab so much as summon: a hooded head at the top, fangs
        // for a point, and the shaft carved as a body all the way down.
        const top = this._polearmShaft(group, wood, { len: 1.15, r: 0.019 });
        const scales = this.isLowDetail() ? 6 : 14;
        for (let i = 0; i < scales; i++) {
          const t = i / scales;
          const s = this._plate([[-0.012, 0], [0.012, 0], [0, 0.024]], 0.003, scaleMat);
          const holder = new THREE.Group();
          holder.rotation.y = i * 1.3;
          s.position.set(0, top - 0.12 - t * 0.9, 0.018);
          holder.add(s);
          group.add(holder);
        }
        const hood = this._plate([[-0.06, 0], [-0.05, 0.07], [0, 0.1], [0.05, 0.07], [0.06, 0]], 0.006, green);
        hood.position.set(0, top + 0.02, -0.01);
        group.add(hood);
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.024, this.seg(11, 7), this.seg(8, 5)), green);
        skull.scale.set(0.9, 0.8, 1.3);
        skull.position.set(0, top + 0.05, 0.014);
        group.add(skull);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(7, 5), this.seg(5, 4)), venom);
          eye.position.set(s * 0.013, top + 0.062, 0.03);
          eye.userData.pulse = { min: 0.4, max: 1.2, freq: 0.8 };
          group.add(eye);
          // The fangs, which are the actual point of the weapon.
          const fang = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.13, this.seg(6, 4)), gold);
          fang.position.set(s * 0.012, top + 0.11, 0.02);
          fang.rotation.z = -s * 0.06;
          group.add(fang);
        }
        const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.003, 0.06, this.seg(5, 3)), venom);
        tongue.position.set(0, top + 0.05, 0.05);
        tongue.rotation.x = Math.PI / 2;
        tongue.userData.sway = { axis: 'z', amp: 0.4, freq: 3.2 };
        group.add(tongue);
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.006, this.seg(7, 5), this.seg(5, 4)), venom);
        drop.position.set(0.012, top + 0.045, 0.02);
        drop.userData.bob = { amp: 0.01, freq: 0.7 };
        group.add(drop);
        const rattle = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, this.seg(8, 5)), gold);
        rattle.rotation.x = Math.PI;
        rattle.position.y = top - 1.18;
        rattle.userData.sway = { axis: 'z', amp: 0.12, freq: 4.0 };
        group.add(rattle);
        return group;
      },

      // ---- 649: EHI Combustion Lance ------------------------------------------
      createCombustionLanceModel(weapon, rand) {
        const group = new THREE.Group();
        const corporate = this._mat(0xE8E4DC, { roughness: 0.4, metalness: 0.25 });
        const accent = this._mat(0x1E4A8B, { roughness: 0.5, metalness: 0.4 });
        const grey = this._mat(0x6E7378, { roughness: 0.5, metalness: 0.75 });
        const hazard = this._mat(0xD8B02A, { roughness: 0.55, metalness: 0.3 });
        const burn = this._glow(0xFF6A2A, 1.3);
        // EHI's thermic lance, sold as a demolition tool. The tank is on the
        // shaft, the compliance plate is where the safety should be.
        const top = this._polearmShaft(group, corporate, { len: 1.15, r: 0.021, buttMat: grey, butt: 'cap' });
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.26, this.seg(13, 8)), corporate);
        tank.position.set(0.045, top - 0.4, 0);
        group.add(tank);
        for (const y of [-0.28, -0.52]) {
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.034, this.seg(13, 8), this.seg(8, 5), 0, Math.PI * 2, 0, Math.PI / 2), corporate);
          cap.rotation.x = y > -0.4 ? 0 : Math.PI;
          cap.position.set(0.045, top + y, 0);
          group.add(cap);
        }
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.0345, 0.008, this.seg(4, 3), this.seg(15, 9)), accent);
        stripe.rotation.x = Math.PI / 2;
        stripe.position.set(0.045, top - 0.36, 0);
        group.add(stripe);
        const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.28, this.seg(8, 5)), grey);
        feed.position.set(0.03, top - 0.16, 0);
        feed.rotation.z = 0.12;
        group.add(feed);
        const regulator = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), grey);
        regulator.position.set(0.045, top - 0.25, 0);
        group.add(regulator);
        const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.008, this.seg(12, 7)), accent);
        gauge.rotation.x = Math.PI / 2;
        gauge.position.set(0.045, top - 0.25, 0.022);
        group.add(gauge);
        const plate = this._plate([[-0.016, 0], [0.016, 0], [0, 0.028]], 0.003, hazard);
        plate.position.set(0, top - 0.55, 0.022);
        group.add(plate);
        // The business end: a nozzle stack, not a blade.
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.13, this.seg(12, 7)), grey);
        nozzle.position.y = top + 0.07;
        group.add(nozzle);
        const rings = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < rings; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.022 - i * 0.002, 0.004, this.seg(4, 3), this.seg(12, 7)), accent);
          r.rotation.x = Math.PI / 2;
          r.position.y = top + 0.04 + i * 0.03;
          group.add(r);
        }
        const jet = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.2, this.seg(9, 6)), burn);
        jet.position.y = top + 0.24;
        jet.userData.pulse = { min: 0.35, max: 1.35, freq: 2.6 };
        group.add(jet);
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.12, this.seg(7, 5)), burn);
        core.position.y = top + 0.19;
        core.userData.pulse = { min: 0.6, max: 1.4, freq: 4.0 };
        group.add(core);
        this._gunTrigger(group, grey, 0, top - 0.62, 0.024, { guardR: 0.02 });
        return group;
      },

      // ---- 650: Gravity Spear -------------------------------------------------
      createGravitySpearModel(weapon, rand) {
        const group = new THREE.Group();
        const dark = this._mat(0x1E2126, { roughness: 0.35, metalness: 0.85 });
        const ring = this._mat(0x8A9096, { roughness: 0.25, metalness: 0.95 });
        const well = this._glow(0x6A4AFF, 1.2);
        const halo = this._glow(0xE8DCFF, 0.8);
        // The head is a hole, held open by three rings, and everything near
        // it falls toward the point whether it wants to or not.
        const top = this._polearmShaft(group, dark, { len: 1.15, r: 0.018, buttMat: ring, butt: 'cap' });
        const gimbal = new THREE.Group();
        gimbal.position.y = top + 0.1;
        group.add(gimbal);
        for (let i = 0; i < 3; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.05 - i * 0.012, 0.004, this.seg(4, 3), this.seg(18, 10)), ring);
          r.rotation.set(i === 0 ? Math.PI / 2 : 0, 0, i === 2 ? Math.PI / 2 : 0);
          r.userData.spin = { axis: ['y', 'x', 'z'][i], speed: 0.7 + i * 0.5 };
          gimbal.add(r);
        }
        const singularity = new THREE.Mesh(new THREE.SphereGeometry(0.016, this.seg(12, 7), this.seg(9, 6)), well);
        singularity.userData.pulse = { min: 0.4, max: 1.3, freq: 1.1 };
        gimbal.add(singularity);
        const shadowCore = new THREE.Mesh(new THREE.SphereGeometry(0.01, this.seg(10, 6), this.seg(7, 5)), dark);
        gimbal.add(shadowCore);
        // Debris caught in the well, going round it.
        const debris = this.isLowDetail() ? 3 : 7;
        for (let i = 0; i < debris; i++) {
          const d = new THREE.Mesh(new THREE.TetrahedronGeometry(0.006 + rand() * 0.004, 0), ring);
          d.position.set(0.03, 0, 0);
          d.userData.orbit = { radius: 0.035 + rand() * 0.02, speed: 1.0 + rand(), phase: i, plane: 'xz' };
          d.userData.spin = { axis: 'y', speed: 2.0 };
          gimbal.add(d);
        }
        const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.12, this.seg(9, 6)), ring);
        spine.position.y = top + 0.02;
        group.add(spine);
        const emitters = this.isLowDetail() ? 2 : 4;
        for (let i = 0; i < emitters; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / emitters) * Math.PI * 2;
          const e = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.008), halo);
          e.position.set(0, top - 0.14, 0.016);
          e.userData.pulse = { min: 0.2, max: 0.9, freq: 1.2, phase: i };
          holder.add(e);
          group.add(holder);
        }
        return group;
      },

      // ---- 651: Varlenia Returning Spear --------------------------------------
      createVarleniaReturningSpearModel(weapon, rand) {
        const group = new THREE.Group();
        const shell = this._mat(0xD8C070, { roughness: 0.3, metalness: 0.85 });
        const trim = this._mat(0xF0DFA0, { roughness: 0.2, metalness: 0.95 });
        const core = this._glow(0xFFE07A, 1.15);
        // Varlenia issue, gilded throughout: it is thrown and comes back, so
        // the fins are for its own flight and the tether is a line of light.
        const top = this._polearmShaft(group, shell, { len: 1.1, r: 0.018, buttMat: trim, butt: 'cap' });
        const flutes = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < flutes; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / flutes) * Math.PI * 2;
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.85, 0.007), trim);
          f.position.set(0, top - 0.5, 0.018);
          holder.add(f);
          group.add(holder);
        }
        const blade = this._plate(this._bladeOutline(0.3, 0.06, 0, 7, 1, { taperPow: 2.2 }), 0.008, trim);
        blade.position.y = top + 0.04;
        group.add(blade);
        const channel = this._plate(this._bladeOutline(0.24, 0.018, 0, 6, 1), 0.01, core);
        channel.position.y = top + 0.06;
        channel.userData.pulse = { min: 0.4, max: 1.2, freq: 1.2 };
        group.add(channel);
        // The fins, which fold out when it is thrown.
        const fins = this.isLowDetail() ? 3 : 4;
        for (let i = 0; i < fins; i++) {
          const holder = new THREE.Group();
          holder.rotation.y = (i / fins) * Math.PI * 2;
          const fin = this._plate([[0, 0], [0.04, 0.02], [0.045, 0.06], [0, 0.05]], 0.004, trim);
          fin.position.set(0, top - 0.03, 0.014);
          holder.add(fin);
          holder.userData.sway = { axis: 'y', amp: 0.12, freq: 0.9, phase: i };
          group.add(holder);
        }
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.07, this.seg(12, 7)), shell);
        collar.position.y = top;
        group.add(collar);
        // The tether it comes home along, coiled at the grip.
        const coils = this.isLowDetail() ? 3 : 6;
        for (let i = 0; i < coils; i++) {
          const c = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0025, this.seg(4, 3), this.seg(13, 8)), core);
          c.rotation.x = Math.PI / 2;
          c.position.y = top - 0.62 - i * 0.02;
          c.userData.pulse = { min: 0.3, max: 1.0, freq: 1.4, phase: i };
          group.add(c);
        }
        const crest = this._plate([[-0.016, 0], [0.016, 0], [0, 0.034]], 0.005, trim);
        crest.position.set(0, top - 0.1, 0.018);
        group.add(crest);
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
      }
    }
  });
})();
