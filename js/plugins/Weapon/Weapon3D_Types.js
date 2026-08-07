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
 * like neither. They dispatch by database id alone, so the family carries no
 * type silhouette to fall back on.
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
