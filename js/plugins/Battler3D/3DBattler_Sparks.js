//=============================================================================
// 3D Battler System - Spark Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke oddball "elemental"-archetype one-off models
 * (electromagnetic ghoul, fidget sprite, lizard sniper) + name-based assignment.
 * Requires 3DBattlerSystem + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Spark Uniques
 * ============================================================================
 *
 * Three enemies tagged <Archetype: Elemental> whose flavour text is anything
 * but a generic elemental. Pinned by exact name, they map the generic Elemental
 * keys (CORE/UPPER_FORM/LOWER_FORM/LEFT_APPENDAGE/RIGHT_APPENDAGE) so
 * dismemberment + hit-flash work.
 *
 * Registered: electromagneticghoul, fidgetsprite, lizardsniper
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Sparks] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const E_PROFILES = {
        electromagneticghoul: { variant: 'electromagneticghoul', scale: 2.2, texturePool: 'void',    bodyColor: 0x4a5a6a, accent: 0x66ddff, hue: [0.55, 0.08], sat: [0.40, 0.12], lit: [0.40, 0.10] },
        fidgetsprite:         { variant: 'fidgetsprite',         scale: 1.8, texturePool: 'crystal', bodyColor: 0xaaccdd, accent: 0xffaa44, hue: [0.55, 0.10], sat: [0.35, 0.12], lit: [0.62, 0.10] },
        lizardsniper:         { variant: 'lizardsniper',         scale: 2.0, texturePool: 'foliage', bodyColor: 0x5a7a3a, accent: 0xcc4422, hue: [0.28, 0.06], sat: [0.45, 0.12], lit: [0.42, 0.10] }
    };

    class SparkBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = E_PROFILES[creatureType] || E_PROFILES.fidgetsprite;
            super(scale, offsetY, battler, profile, 0, creatureType || 'fidgetsprite');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
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
        _eye(parent, x, y, z, r, accent) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), this._mat(accent || 0xffcc33, 1.0, 0.2, accent));
            eye.position.set(x, y, z);
            const pup = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 1.2, r * 0.3), this._mat(0x000000, 1.0, 0.1)); pup.position.set(0, 0, r * 0.7); eye.add(pup);
            parent.add(eye); return eye;
        }
        _wireElemental(o) {
            this._partMeshMap = {};
            this._partMeshMap.CORE = o.core;
            ['UPPER_FORM', 'BODY', 'TORSO', 'CHASSIS'].forEach(k => this._partMeshMap[k] = o.body);
            ['LOWER_FORM', 'LEGS', 'PELVIS'].forEach(k => this._partMeshMap[k] = o.legs);
            ['LEFT_APPENDAGE', 'LEFT_ARM', 'LEFT_UPPER_ARM'].forEach(k => this._partMeshMap[k] = o.larm);
            ['RIGHT_APPENDAGE', 'RIGHT_ARM', 'RIGHT_UPPER_ARM', 'ARM_CANNON'].forEach(k => this._partMeshMap[k] = o.rarm);
            const extra = (o.extra || []).filter(Boolean);
            const all = [o.core, o.body, o.legs, o.larm, o.rarm, ...extra].filter(Boolean);
            this._cascadeRules = [
                { gone: ['CORE'], hide: all },
                { gone: ['UPPER_FORM', 'BODY'], hide: [o.body, o.larm, o.rarm, ...extra].filter(Boolean) },
                { gone: ['LOWER_FORM', 'LEGS'], hide: [o.legs].filter(Boolean) },
                { gone: ['LEFT_APPENDAGE', 'LEFT_ARM'], hide: [o.larm].filter(Boolean) },
                { gone: ['RIGHT_APPENDAGE', 'RIGHT_ARM'], hide: [o.rarm].filter(Boolean) },
            ];
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'electromagneticghoul': this._buildEMGhoul(); break;
                case 'lizardsniper':         this._buildLizardSniper(); break;
                default:                     this._buildFidget(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Electromagnetic Ghoul: a glitchy EM wraith with signal bars ────
        _buildEMGhoul() {
            const p = this.profile;
            const staticMat = this._skinMat(p.bodyColor, 0.4); staticMat.opacity = 0.7;
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), this._mat(p.accent, 1, 0.2, p.accent)); this.core.position.y = 1.0; this.bodyGroup.add(this.core);
            this.body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 14), staticMat); this.body.position.y = 1.0; this.body.scale.set(1, 1.3, 1); this.bodyGroup.add(this.body);
            // Distorted ghoul face.
            this._eye(this.bodyGroup, -0.13, 1.08, 0.34, 0.06, p.accent); this._eye(this.bodyGroup, 0.13, 1.08, 0.34, 0.06, p.accent);
            // Lightning-arc arms.
            this.larm = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 5), this._mat(p.accent, 0.85, 0.2, p.accent)); this.larm.position.set(-0.4, 1.05, 0); this.larm.rotation.z = 0.8; this.bodyGroup.add(this.larm);
            this.rarm = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 5), this._mat(p.accent, 0.85, 0.2, p.accent)); this.rarm.position.set(0.4, 1.05, 0); this.rarm.rotation.z = -0.8; this.bodyGroup.add(this.rarm);
            // Static tail (lower form).
            this.legs = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 10), staticMat); this.legs.position.y = 0.45; this.legs.rotation.x = Math.PI; this.bodyGroup.add(this.legs);
            // Floating signal bars.
            this.bars = new THREE.Group();
            for (let i = 0; i < 4; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08 + i * 0.06, 0.05), this._mat(p.accent, 0.9, 0.2, p.accent)); bar.position.set(0.5 + i * 0.08, 1.3 + i * 0.03, 0); bar._i = i; this.bars.add(bar); }
            this.bodyGroup.add(this.bars);
            this._wireElemental({ core: this.core, body: this.body, legs: this.legs, larm: this.larm, rarm: this.rarm, extra: [this.bars] });
        }

        // ── Fidget Sprite: a hyperactive spinning whirlwind ───────────────
        _buildFidget() {
            const p = this.profile;
            const wind = this._skinMat(p.bodyColor, 0.3); wind.opacity = 0.6;
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), this._mat(p.accent, 1, 0.2, p.accent)); this.core.position.y = 1.0; this.bodyGroup.add(this.core);
            // Swirling vortex body.
            this.body = new THREE.Group();
            for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18 + i * 0.12, 0.05, 8, 18), wind); ring.position.y = 0.7 + i * 0.25; ring.rotation.x = Math.PI / 2; ring.scale.set(1, 1, 0.6 + i * 0.2); this.body.add(ring); }
            this.bodyGroup.add(this.body);
            // Three spinning arm-blades.
            this.spin = new THREE.Group();
            for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 4), this._mat(p.accent, 0.8, 0.2, p.accent)); blade.position.set(Math.cos(a) * 0.4, 1.0, Math.sin(a) * 0.4); blade.rotation.z = Math.PI / 2; blade.rotation.y = a; this.spin.add(blade); }
            this.bodyGroup.add(this.spin);
            this.larm = this.spin; this.rarm = this.spin;
            this.legs = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 8), wind); this.legs.position.y = 0.4; this.legs.rotation.x = Math.PI; this.bodyGroup.add(this.legs);
            this._wireElemental({ core: this.core, body: this.body, legs: this.legs, larm: this.spin, rarm: this.spin });
        }

        // ── Lizard Sniper: a small reptile biped shouldering a long rifle ─
        _buildLizardSniper() {
            const p = this.profile;
            const scale = this._skinMat(p.bodyColor, 0.5);
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.6, 8), scale); this.body.add(torso);
            // Reptile head with snout.
            const head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), scale); skull.scale.set(1, 0.9, 1.3); head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 6), scale); snout.position.set(0, -0.02, 0.24); snout.rotation.x = Math.PI / 2; head.add(snout);
            this._eye(head, -0.1, 0.06, 0.16, 0.05, 0xffcc33); this._eye(head, 0.1, 0.06, 0.16, 0.05, 0xffcc33);
            head.position.set(0, 0.45, 0); this.body.add(head);
            this.body.position.set(0, 1.0, 0); this.bodyGroup.add(this.body);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), this._mat(p.accent, 1, 0.3, p.accent)); this.core.position.set(0, 1.0, 0.05); this.bodyGroup.add(this.core);
            // Arms; right shoulders the rifle.
            this.larm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.45, 6), scale); this.larm.position.set(-0.26, 1.05, 0.12); this.larm.rotation.set(-0.6, 0, 0.4); this.bodyGroup.add(this.larm);
            this.rarm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.45, 6), scale); this.rarm.position.set(0.26, 1.05, 0.12); this.rarm.rotation.set(-0.8, 0, -0.3); this.bodyGroup.add(this.rarm);
            // Sniper rifle.
            this.rifle = new THREE.Group();
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 8), this._mat(0x2a2a2a, 1, 0.4)); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.3; this.rifle.add(barrel);
            const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.3), this._mat(0x4a3320, 1, 0.6)); stock.position.z = -0.3; this.rifle.add(stock);
            const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), this._mat(p.accent, 1, 0.3, p.accent)); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.08, 0.1); this.rifle.add(scope);
            this.rifle.position.set(0.1, 1.05, 0.2); this.rifle.rotation.y = 0.1; this.bodyGroup.add(this.rifle);
            // Legs + tail (lower form).
            this.legs = new THREE.Group();
            for (const lx of [-0.12, 0.12]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 6), scale); leg.position.set(lx, 0.45, 0); this.legs.add(leg); }
            const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.7, 6), scale); tail.position.set(0, 0.7, -0.4); tail.rotation.x = -1.0; this.legs.add(tail);
            this.bodyGroup.add(this.legs);
            this._wireElemental({ core: this.core, body: this.body, legs: this.legs, larm: this.larm, rarm: this.rarm, extra: [this.rifle] });
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.8);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            if (this.core && this.core.material) this.core.material.emissiveIntensity = 1.0 + Math.sin(t * 5) * 0.5;

            switch (this.variant) {
                case 'electromagneticghoul': {
                    this.model.position.y = this._baseY + Math.sin(t * 2) * 0.06 * this.scale;
                    // Glitchy jitter.
                    this.model.position.x = (Math.sin(t * 37) > 0.7 ? 1 : 0) * 0.04 * this.scale;
                    if (this.larm) this.larm.material.emissiveIntensity = (fast ? 1.5 : 0.8) + Math.sin(t * 20) * 0.6;
                    if (this.rarm) this.rarm.material.emissiveIntensity = (fast ? 1.5 : 0.8) + Math.cos(t * 23) * 0.6;
                    if (this.bars) this.bars.children.forEach(b => { b.material.emissiveIntensity = Math.abs(Math.sin(t * 4 + b._i)) * 1.2; });
                    break;
                }
                case 'fidgetsprite': {
                    this.model.position.y = this._baseY + Math.sin(t * 3) * 0.05 * this.scale;
                    if (this.spin) this.spin.rotation.y += (fast ? 30 : 18) * deltaTime; // constant spin
                    if (this.body) this.body.rotation.y -= (fast ? 12 : 7) * deltaTime;
                    this.model.rotation.z = Math.sin(t * 6) * 0.04;
                    break;
                }
                case 'lizardsniper': {
                    this.model.position.y = this._baseY + Math.sin(t * 1.4) * 0.02 * this.scale;
                    if (this.legs) this.legs.children.forEach((c, i) => { if (i === 2) c.rotation.z = Math.sin(t * 2) * 0.15; }); // tail sway
                    if (this.rifle && fast) this.rifle.position.z = 0.2 - Math.abs(Math.sin(t * 10)) * 0.12; // recoil
                    if (this.body) this.body.rotation.y = Math.sin(t * 1.0) * 0.06;
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.1);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            if (this.variant === 'lizardsniper') { this.model.position.y = this._baseY - prog * 0.3 * this.scale; this.model.rotation.z = prog * 1.0; }
            else { const sc = (1.0 - prog * 0.6); this.model.scale.multiplyScalar(1); this.bodyGroup.scale.setScalar(this.scale * sc); }
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new SparkBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = E_PROFILES;
    reg('electromagneticghoul', { aliases: ['electromagneticghoul'], scale: S.electromagneticghoul.scale, weapon: 0, create: make });
    reg('fidgetsprite',         { aliases: ['fidgetsprite'],         scale: S.fidgetsprite.scale,         weapon: 0, create: make });
    reg('lizardsniper',         { aliases: ['lizardsniper'],         scale: S.lizardsniper.scale,         weapon: 0, create: make });

    const NAMED = {
        electromagneticghoul: ["Electromagnetic Ghoul"],
        fidgetsprite:         ["Fidget Sprite"],
        lizardsniper:         ["Lizard Sniper"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Spark uniques registered');
})();
