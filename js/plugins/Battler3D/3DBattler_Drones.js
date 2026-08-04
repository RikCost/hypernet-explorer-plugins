//=============================================================================
// 3D Battler System - Drone Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke drone one-off models (surveillance drone, cryo drone, data
 * drone) + name-based assignment. Requires 3DBattlerSystem + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Drone Uniques
 * ============================================================================
 *
 * Distinct procedural quadcopters shaped from each enemy's flavour text, pinned
 * by exact name. They map the Drone archetype keys (CHASSIS/SENSOR_ARRAY/
 * LEFT_PROP/RIGHT_PROP) so dismemberment + hit-flash work.
 *
 * Registered: surveillancedrone, cryodrone, datadrone
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Drones] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const D_PROFILES = {
        surveillancedrone: { variant: 'surveillancedrone', scale: 1.9, texturePool: 'metal', bodyColor: 0x6a7079, accent: 0xff2222, hue: [0.58, 0.05], sat: [0.10, 0.06], lit: [0.5, 0.1] },
        cryodrone:         { variant: 'cryodrone',         scale: 2.0, texturePool: 'water', bodyColor: 0x9ac0d8, accent: 0x66ddff, hue: [0.55, 0.06], sat: [0.30, 0.10], lit: [0.6, 0.08] },
        datadrone:         { variant: 'datadrone',         scale: 1.9, texturePool: 'metal', bodyColor: 0x3a4a5a, accent: 0x33ff88, hue: [0.45, 0.08], sat: [0.30, 0.10], lit: [0.4, 0.08] },
        aethersplicer:     { variant: 'aethersplicer',     scale: 2.0, texturePool: 'metal', bodyColor: 0x4a4254, accent: 0xbb66ff, hue: [0.74, 0.07], sat: [0.28, 0.10], lit: [0.45, 0.10], front: true }
    };

    class DroneBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = D_PROFILES[creatureType] || D_PROFILES.surveillancedrone;
            super(scale, offsetY, battler, profile, 0, creatureType || 'surveillancedrone');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            this._blades = [];
            this.facingYaw = 0;
        }

        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.5 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.6 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity)
            });
            this._materials.push(m);
            return m;
        }
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.5 : rough)); }
        _rotor(sx, sz, metal) {
            const g = new THREE.Group();
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 5), metal); arm.rotation.z = Math.PI / 2; arm.position.set(sx * 0.18, 0, 0); g.add(arm);
            const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), metal); motor.position.set(sx * 0.36, 0.03, 0); g.add(motor);
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.05), this._mat(0x222222, 0.7, 0.4)); blade.position.set(sx * 0.36, 0.08, 0); g.add(blade); this._blades.push(blade);
            g.position.set(0, 1.05, sz * 0.36); return g;
        }
        _droneBase(o) {
            o = o || {};
            const p = this.profile;
            const metal = o.mat || this._skinMat(p.bodyColor, 0.4);
            this._droneMat = metal;
            this.chassis = new THREE.Group();
            const core = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), metal); this.chassis.add(core);
            const dome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal); dome.position.y = 0.1; this.chassis.add(dome);
            this.chassis.position.set(0, 1.0, 0); this.bodyGroup.add(this.chassis);
            // Gimballed camera sensor.
            this.sensorArray = new THREE.Group();
            const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), this._mat(0x111111, 1, 0.2)); this.sensorArray.add(gimbal);
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 12), this._mat(p.accent, 1, 0.2, p.accent)); lens.rotation.x = Math.PI / 2; lens.position.z = 0.1; this.sensorArray.add(lens); this.sensorArray._lens = lens;
            this.sensorArray.position.set(0, 0.86, 0.18); this.bodyGroup.add(this.sensorArray);
            // Two prop groups (left/right pairs).
            this.leftProp = new THREE.Group(); this.rightProp = new THREE.Group();
            this.leftProp.add(this._rotor(-1, 1, metal)); this.leftProp.add(this._rotor(-1, -1, metal));
            this.rightProp.add(this._rotor(1, 1, metal)); this.rightProp.add(this._rotor(1, -1, metal));
            this.bodyGroup.add(this.leftProp, this.rightProp);
            this._partMeshMap = { CHASSIS: this.chassis, SENSOR_ARRAY: this.sensorArray, LEFT_PROP: this.leftProp, RIGHT_PROP: this.rightProp };
            this._cascadeRules = [
                { gone: ['CHASSIS'], hide: [this.chassis, this.sensorArray, this.leftProp, this.rightProp, ...(o.extra || []).filter(Boolean)] },
                { gone: ['SENSOR_ARRAY'], hide: [this.sensorArray] },
                { gone: ['LEFT_PROP'], hide: [this.leftProp] },
                { gone: ['RIGHT_PROP'], hide: [this.rightProp] },
            ];
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'cryodrone': this._buildCryoDrone(); break;
                case 'datadrone': this._buildDataDrone(); break;
                case 'aethersplicer': this._buildAetherSplicer(); break;
                default:          this._buildSurveillanceDrone(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Surveillance Drone: antenna + blinking warning light ───────────
        _buildSurveillanceDrone() {
            const p = this.profile;
            this._droneBase({});
            this.antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), this._mat(0x141414, 1, 0.4)); this.antenna.position.set(-0.18, 1.28, -0.15); this.chassis.add(this.antenna);
            this.blip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), this._mat(p.accent, 1, 0.3, p.accent)); this.blip.position.set(0, 1.22, -0.2); this.bodyGroup.add(this.blip);
            this._cascadeRules[0].hide.push(this.blip);
        }

        // ── Cryo Drone: frost emitters and icicle spikes ───────────────────
        _buildCryoDrone() {
            const p = this.profile;
            this._droneBase({});
            this.frost = new THREE.Group();
            for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const ice = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 5), this._mat(p.accent, 0.85, 0.2, p.accent)); ice.position.set(Math.cos(a) * 0.28, 0.82, Math.sin(a) * 0.28); ice.rotation.x = Math.PI; this.frost.add(ice); }
            this.bodyGroup.add(this.frost);
            this.mist = new THREE.Group();
            for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), this._mat(0xddf4ff, 0.4, 0.2)); m.position.set((this.idRand() - 0.5) * 0.7, 0.7 - this.idRand() * 0.3, (this.idRand() - 0.5) * 0.7); m._t = this.idRand(); this.mist.add(m); }
            this.bodyGroup.add(this.mist);
            this._cascadeRules[0].hide.push(this.frost, this.mist);
        }

        // ── Data Drone: a glitchy holographic screen-face ──────────────────
        _buildDataDrone() {
            const p = this.profile;
            this._droneBase({});
            this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.28), this._mat(0x081810, 0.9, 0.3, p.accent)); this.screen.position.set(0, 1.04, 0.27); this.chassis.add(this.screen);
            this.dataBits = new THREE.Group();
            for (let i = 0; i < 10; i++) { const bit = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), this._mat(p.accent, 0.9, 0.2, p.accent)); bit.position.set(-0.16 + (i % 5) * 0.08, 1.12 - Math.floor(i / 5) * 0.08, 0.29); bit._t = this.idRand(); this.dataBits.add(bit); }
            this.chassis.add(this.dataBits);
            this._cascadeRules[0].hide.push(this.screen, this.dataBits);
        }

        // ── Aether Splicer: fractured floating frame + arcing splicer arms ──
        _buildAetherSplicer() {
            const p = this.profile;
            const metal = this._skinMat(p.bodyColor, 0.35);
            // Fractured chassis: a ring of cracked-apart tetra shards floating around a core gap.
            this.chassis = new THREE.Group();
            const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), this._mat(0x1a1622, 1, 0.3, p.accent)); this.chassis.add(core); this.chassis._core = core;
            this._shards = [];
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16 + this.idRand() * 0.06, 0), metal);
                const r = 0.34 + this.idRand() * 0.05;
                sh.position.set(Math.cos(a) * r, 0.02 * (i % 2 ? 1 : -1), Math.sin(a) * r);
                sh.rotation.set(this.idRand() * 3, this.idRand() * 3, this.idRand() * 3);
                sh._a = a; sh._r = r; this._shards.push(sh); this.chassis.add(sh);
            }
            this.chassis.position.set(0, 1.0, 0); this.bodyGroup.add(this.chassis);
            // Sensor array: a faceted scanner crystal on a forward stalk facing the camera.
            this.sensorArray = new THREE.Group();
            const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.18, 6), metal); stalk.rotation.x = Math.PI / 2; stalk.position.z = 0.09; this.sensorArray.add(stalk);
            const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), this._mat(p.accent, 0.85, 0.15, p.accent)); crystal.position.z = 0.22; this.sensorArray.add(crystal); this.sensorArray._crystal = crystal;
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(0xffffff, 1, 0.1, 0xffffff)); pupil.position.z = 0.31; this.sensorArray.add(pupil);
            this.sensorArray.position.set(0, 1.0, 0.2); this.bodyGroup.add(this.sensorArray);
            // Two spinning rotor props on outrigger arms.
            this.leftProp = new THREE.Group(); this.rightProp = new THREE.Group();
            this.leftProp.add(this._rotor(-1, 0, metal)); this.rightProp.add(this._rotor(1, 0, metal));
            this.leftProp.children[0].position.set(-0.2, 0.0, 0); this.rightProp.children[0].position.set(0.2, 0.0, 0);
            this.leftProp.position.set(0, 1.0, 0); this.rightProp.position.set(0, 1.0, 0);
            this.bodyGroup.add(this.leftProp, this.rightProp);
            // Arcing electric splicer arms: jointed segmented limbs reaching down/out.
            this.splicers = new THREE.Group(); this._arcs = [];
            for (let s = -1; s <= 1; s += 2) {
                const arm = new THREE.Group();
                let px = s * 0.18, py = 0.9, pz = 0.0;
                for (let j = 0; j < 4; j++) {
                    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03 - j * 0.005, 0.04 - j * 0.005, 0.16, 5), metal);
                    px += s * 0.07; py -= 0.13; pz += 0.04;
                    seg.position.set(px, py, pz); seg.rotation.z = s * (0.4 + j * 0.18); arm.add(seg);
                }
                const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), this._mat(p.accent, 1, 0.2, p.accent)); tip.position.set(px + s * 0.05, py - 0.08, pz); tip.rotation.z = s * 1.2; arm.add(tip); arm._tip = tip;
                this._arcs.push(arm); this.splicers.add(arm);
            }
            this.bodyGroup.add(this.splicers);
            this._partMeshMap = { CHASSIS: this.chassis, SENSOR_ARRAY: this.sensorArray, LEFT_PROP: this.leftProp, RIGHT_PROP: this.rightProp };
            this._cascadeRules = [
                { gone: ['CHASSIS'], hide: [this.chassis, this.sensorArray, this.leftProp, this.rightProp, this.splicers] },
                { gone: ['SENSOR_ARRAY'], hide: [this.sensorArray] },
                { gone: ['LEFT_PROP'], hide: [this.leftProp, this._arcs[0]] },
                { gone: ['RIGHT_PROP'], hide: [this.rightProp, this._arcs[1]] },
            ];
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.8);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            this.model.position.y = this._baseY + Math.sin(t * 2.5) * 0.06 * this.scale;
            this.model.rotation.z = Math.sin(t * 1.8) * 0.04; // hover wobble
            // Spinning rotors.
            this._blades.forEach((b, i) => { b.rotation.y += (fast ? 50 : 36) * deltaTime; });
            if (this.sensorArray) this.sensorArray.rotation.y = Math.sin(t * (fast ? 4 : 1.5)) * 0.5; // scanning

            switch (this.variant) {
                case 'surveillancedrone': {
                    if (this.blip && this.blip.material) this.blip.material.emissiveIntensity = Math.abs(Math.sin(t * (fast ? 9 : 4))) * 1.2;
                    if (this.sensorArray && this.sensorArray._lens) this.sensorArray._lens.material.emissiveIntensity = 0.4 + Math.sin(t * 3) * 0.3;
                    break;
                }
                case 'cryodrone': {
                    if (this.mist) this.mist.children.forEach(m => { m.position.y -= 0.008; if (m.position.y < 0.3) m.position.y = 0.8; });
                    if (this.frost) this.frost.rotation.y = t * 0.6;
                    break;
                }
                case 'datadrone': {
                    if (this.dataBits) this.dataBits.children.forEach((b, i) => { b.position.y -= 0.02; if (b.position.y < 0.92) b.position.y = 1.16; b.material.emissiveIntensity = 0.5 + Math.sin(t * 8 + i) * 0.5; });
                    if (this.screen) this.screen.material.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * (fast ? 12 : 5))) * 0.5; // flicker
                    break;
                }
                case 'aethersplicer': {
                    // Fractured shards drift in/out around the core gap.
                    if (this._shards) this._shards.forEach((sh, i) => { const r = sh._r + Math.sin(t * 1.6 + i) * 0.05; sh.position.x = Math.cos(sh._a) * r; sh.position.z = Math.sin(sh._a) * r; sh.rotation.y += deltaTime * (0.4 + i * 0.05); });
                    if (this.chassis && this.chassis._core) this.chassis._core.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3)) * 0.6;
                    if (this.sensorArray && this.sensorArray._crystal) this.sensorArray._crystal.rotation.y += deltaTime * 2.2;
                    // Splicer arm tips crackle with electric arcs (random flicker).
                    if (this._arcs) this._arcs.forEach((arm, i) => { arm.rotation.z = Math.sin(t * (fast ? 6 : 2) + i * Math.PI) * 0.12; if (arm._tip) arm._tip.material.emissiveIntensity = (this.idRand() + Math.sin(t * 14 + i)) > (fast ? 0.2 : 0.9) ? 1.6 : 0.2; });
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.0);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            // Loses lift and tumbles.
            this.model.position.y = this._baseY - prog * prog * 1.4 * this.scale;
            this.model.rotation.z = prog * 1.6;
            this.model.rotation.x = prog * 0.8;
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new DroneBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = D_PROFILES;
    reg('surveillancedrone', { aliases: ['surveillancedrone'], scale: S.surveillancedrone.scale, weapon: 0, create: make });
    reg('cryodrone',         { aliases: ['cryodrone'],         scale: S.cryodrone.scale,         weapon: 0, create: make });
    reg('datadrone',         { aliases: ['datadrone'],         scale: S.datadrone.scale,         weapon: 0, create: make });
    reg('aethersplicer',     { aliases: ['aethersplicer'],     scale: S.aethersplicer.scale,     weapon: 0, create: make });

    const NAMED = {
        surveillancedrone: ["Surveillance Drone"],
        cryodrone:         ["Cryo Drone"],
        datadrone:         ["Data Drone"],
        aethersplicer:     ["Aether Splicer"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Drone uniques registered');
})();
