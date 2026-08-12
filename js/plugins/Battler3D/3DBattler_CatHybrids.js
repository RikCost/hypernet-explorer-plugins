//=============================================================================
// 3D Battler System - Cat Hybrids
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke "cat-X" hybrid models: each has the body of its animal and
 * the face of a cat. Catfish (fish body), Catican (bird body), Catizard (lizard
 * body). Requires 3DBattlerSystem; loads LAST so its name pins win.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Cat Hybrids
 * ============================================================================
 *
 * One-off models assigned by exact name (registerNamed outranks the Archetype
 * meta). A shared _catHead() (ears, slit eyes, pink nose, whiskered muzzle) is
 * mounted on the front of each animal body:
 *
 *   Catfish  (<Archetype: AquaticFish>) - whiskered fish body + cat face
 *   Catican  (<Archetype: Bird>)        - feathered bird body + cat face
 *   Catizard (<Archetype: Reptilian>)   - four-legged lizard body, barbed tail,
 *                                          + cat face
 *
 * Front-facing so the cat face reads. Reuses the shared base: part-losing
 * dismemberment, hit-flash, base action gestures and the death fade.
 *
 * MUST load AFTER BattleSystem/3DBattlerSystem.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler CatHybrids] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const CAT_PROFILES = {
        catfish:  { variant: 'catfish',  scale: 2.3, texturePool: 'water',  bodyColor: 0x6a6f55, accent: 0x9be000, hue: [0.20, 0.10], sat: [0.30, 0.15], lit: [0.42, 0.12] },
        catican:  { variant: 'catican',  scale: 2.1, texturePool: 'fur',    bodyColor: 0x8a8f96, wingColor: 0x6a6f76, accent: 0x9be000, hue: [0.60, 0.10], sat: [0.12, 0.10], lit: [0.50, 0.12] },
        catizard: { variant: 'catizard', scale: 2.2, texturePool: 'green',  bodyColor: 0x5a8a4a, accent: 0x9be000, hue: [0.30, 0.10], sat: [0.52, 0.15], lit: [0.42, 0.10] }
    };

    class CatHybridBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = CAT_PROFILES[creatureType] || CAT_PROFILES.catfish;
            super(scale, offsetY, battler, profile, 0, creatureType || 'catfish');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            this.facingYaw = 0; // face the camera so the cat face is the star
        }

        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.7 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.6 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity), side: THREE.DoubleSide
            });
            this._materials.push(m); return m;
        }
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.7 : rough)); }

        // Shared cat face mounted facing +z. Returns a head Group.
        _catHead(R) {
            const fur = this._skinMat(this.profile.bodyColor, 0.75);
            const g = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 14, 14), fur); skull.scale.set(1, 0.95, 0.95); g.add(skull);
            for (const ex of [-R * 0.55, R * 0.55]) {
                const ear = new THREE.Mesh(new THREE.ConeGeometry(R * 0.42, R * 0.75, 4), fur); ear.position.set(ex, R * 0.85, -R * 0.05); ear.rotation.x = -0.15; g.add(ear);
                const inner = new THREE.Mesh(new THREE.ConeGeometry(R * 0.22, R * 0.5, 4), this._mat(0xe89aa8, 1.0, 0.6)); inner.position.set(ex, R * 0.82, 0); inner.rotation.x = -0.15; g.add(inner);
            }
            const muzzle = new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 12, 10), fur); muzzle.scale.set(1, 0.7, 0.7); muzzle.position.set(0, -R * 0.28, R * 0.62); g.add(muzzle);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(R * 0.13, 8, 8), this._mat(0xe0607a, 1.0, 0.4)); nose.position.set(0, -R * 0.16, R * 0.95); g.add(nose);
            const catEye = (x) => {
                const e = new THREE.Mesh(new THREE.SphereGeometry(R * 0.3, 12, 12), this._mat(this.profile.accent, 1.0, 0.2, this.profile.accent)); e.position.set(x, R * 0.12, R * 0.68);
                const pup = new THREE.Mesh(new THREE.SphereGeometry(R * 0.17, 10, 10), this._mat(0x141018, 1.0, 0.2)); pup.scale.set(0.6, 1.0, 0.6); pup.position.z = R * 0.2; e.add(pup);
                // The catchlight is what turns a bead into an eye.
                const glint = new THREE.Mesh(new THREE.SphereGeometry(R * 0.07, 8, 8), this._mat(0xffffff, 0.95, 0.05, 0xffffff)); glint.position.set(-R * 0.1, R * 0.11, R * 0.24); e.add(glint);
                g.add(e); return e;
            };
            this.catEyeL = catEye(-R * 0.4); this.catEyeR = catEye(R * 0.4);
            const wMat = this._mat(0xf2f2f2, 0.85, 0.3);
            for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
                const w = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, R * 1.4, 4), wMat);
                w.position.set(side * R * 0.85, -R * 0.18 + k * R * 0.14, R * 0.7); w.rotation.z = Math.PI / 2; w.rotation.y = side * (0.3 - k * 0.1); g.add(w);
            }
            return g;
        }

        async load(physicsWorld) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'catican':  this._buildCatican(); break;
                case 'catizard': this._buildCatizard(); break;
                default:         this._buildCatfish(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Catfish: whiskered fish body (long axis +z) + cat face ───────────
        _buildCatfish() {
            const p = this.profile;
            const fur = this._skinMat(p.bodyColor, 0.6);
            const finMat = this._mat(p.bodyColor, 0.9, 0.6);
            this.body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), fur); this.body.scale.set(1.0, 0.78, 2.0); this.body.position.set(0, 1.0, -0.15); this.bodyGroup.add(this.body);
            this.head = this._catHead(0.28); this.head.position.set(0, 1.04, 0.78); this.bodyGroup.add(this.head);
            this.dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 3), finMat); this.dorsalFin.position.set(0, 1.42, -0.25); this.dorsalFin.scale.set(0.3, 1, 1.4); this.bodyGroup.add(this.dorsalFin);
            this.tailFin = new THREE.Group(); const tf = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.55, 3), finMat); tf.scale.set(1, 1, 0.12); this.tailFin.add(tf); this.tailFin.position.set(0, 1.0, -1.05); this.bodyGroup.add(this.tailFin);
            this.lPec = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 3), finMat); this.lPec.scale.set(1, 1, 0.1); this.lPec.position.set(-0.34, 0.86, 0.2); this.lPec.rotation.z = 1.4; this.bodyGroup.add(this.lPec);
            this.rPec = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 3), finMat); this.rPec.scale.set(1, 1, 0.1); this.rPec.position.set(0.34, 0.86, 0.2); this.rPec.rotation.z = -1.4; this.bodyGroup.add(this.rPec);
            this._partMeshMap = { BODY: this.body, TORSO: this.body, CORE: this.body, HEAD: this.head, TAIL_FIN: this.tailFin, TAIL: this.tailFin, DORSAL_FIN: this.dorsalFin, LEFT_PECTORAL_FIN: this.lPec, RIGHT_PECTORAL_FIN: this.rPec };
            this._cascadeRules = [
                { gone: ['BODY', 'TORSO', 'CORE'], hide: [this.body, this.head, this.tailFin, this.dorsalFin, this.lPec, this.rPec] },
                { gone: ['HEAD'], hide: [this.head] },
                { gone: ['TAIL_FIN', 'TAIL'], hide: [this.tailFin] },
                { gone: ['DORSAL_FIN'], hide: [this.dorsalFin] },
                { gone: ['LEFT_PECTORAL_FIN'], hide: [this.lPec] },
                { gone: ['RIGHT_PECTORAL_FIN'], hide: [this.rPec] },
            ];
        }

        // ── Catican: feathered bird body + cat face ──────────────────────────
        _buildCatican() {
            const p = this.profile;
            const fur = this._skinMat(p.bodyColor, 0.85);
            const wingMat = this._mat(p.wingColor, 0.92, 0.85);
            this.body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 14), fur); this.body.scale.set(1, 1.2, 1); this.body.position.set(0, 1.05, 0); this.bodyGroup.add(this.body);
            this.head = this._catHead(0.22); this.head.position.set(0, 1.6, 0.06); this.bodyGroup.add(this.head);
            this.lwing = this._wing(wingMat, -1); this.rwing = this._wing(wingMat, 1);
            this.legs = this._birdLegs(this._mat(0xc8902a, 1.0, 0.6));
            this.tail = new THREE.Group();
            for (let i = -1; i <= 1; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 4), wingMat); f.scale.set(1, 1, 0.25); f.rotation.x = -Math.PI / 2; f.rotation.y = i * 0.3; f.position.set(i * 0.06, 0.95, -0.4); this.bodyGroup.add(f); this.tail.add(f); }
            this.bodyGroup.add(this.tail);
            const m = {}, set = (ks, mesh) => { if (mesh) ks.forEach(k => m[k] = mesh); };
            set(['BODY', 'TORSO', 'CORE', 'MASS'], this.body);
            set(['HEAD', 'SKULL', 'FACE', 'BEAK', 'EYES'], this.head);
            set(['LEFT_WING', 'LEFT_ARM'], this.lwing);
            set(['RIGHT_WING', 'RIGHT_ARM'], this.rwing);
            set(['TALONS', 'LEFT_LEG', 'RIGHT_LEG', 'FEET'], this.legs);
            set(['TAIL'], this.tail);
            this._partMeshMap = m;
            this._cascadeRules = [
                { gone: ['BODY', 'TORSO', 'CORE', 'MASS'], hide: [this.body, this.head, this.lwing, this.rwing, this.legs, this.tail] },
                { gone: ['HEAD', 'SKULL', 'FACE', 'BEAK'], hide: [this.head] },
                { gone: ['LEFT_WING', 'LEFT_ARM'], hide: [this.lwing] },
                { gone: ['RIGHT_WING', 'RIGHT_ARM'], hide: [this.rwing] },
                { gone: ['TALONS', 'LEFT_LEG', 'RIGHT_LEG'], hide: [this.legs] },
                { gone: ['TAIL'], hide: [this.tail] },
            ];
        }
        _wing(mat, side) {
            const g = new THREE.Group();
            const main = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.85, 4), mat); main.rotation.z = side * Math.PI / 2; main.position.x = side * 0.42; main.scale.set(1, 1, 0.14); g.add(main);
            g.position.set(side * 0.18, 1.1, -0.05); g._side = side; this.bodyGroup.add(g); return g;
        }
        _birdLegs(mat) {
            const g = new THREE.Group();
            for (const x of [-0.14, 0.14]) {
                const leg = new THREE.Group();
                const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.32, 6), mat); shank.position.y = -0.16; leg.add(shank);
                for (let i = -1; i <= 1; i++) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 4), mat); claw.position.set(i * 0.06, -0.36, 0.05); claw.rotation.x = Math.PI; leg.add(claw); }
                leg.position.set(x, 0.72, 0.05); g.add(leg);
            }
            this.bodyGroup.add(g); return g;
        }

        // ── Catizard: four-legged lizard body (long axis +z), barbed tail ────
        _buildCatizard() {
            const p = this.profile;
            const skin = this._skinMat(p.bodyColor, 0.6);
            this.body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), skin); this.body.scale.set(1.0, 0.72, 1.7); this.body.position.set(0, 0.86, 0); this.bodyGroup.add(this.body);
            for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), skin); s.position.set(0, 1.06, 0.4 - i * 0.2); this.bodyGroup.add(s); }
            this.head = this._catHead(0.24); this.head.position.set(0, 0.94, 0.62); this.bodyGroup.add(this.head);
            this.fl = this._lizLeg(skin, -0.34, 0.42); this.fr = this._lizLeg(skin, 0.34, 0.42);
            this.rl = this._lizLeg(skin, -0.34, -0.42); this.rr = this._lizLeg(skin, 0.34, -0.42);
            // Long tail with a poison barb tip.
            this.tail = new THREE.Group();
            let z = -0.55, r = 0.16;
            for (let i = 0; i < 5; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), skin); seg.position.set(0, 0.82, z); this.tail.add(seg); z -= 0.22; r *= 0.82; }
            const barb = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), this._mat(p.accent, 1.0, 0.4, p.accent)); barb.position.set(0, 0.82, z + 0.05); barb.rotation.x = -Math.PI / 2; this.tail.add(barb);
            this.bodyGroup.add(this.tail);
            const m = {}, set = (ks, mesh) => { if (mesh) ks.forEach(k => m[k] = mesh); };
            set(['BODY', 'TORSO', 'CORE', 'SPINE'], this.body);
            set(['HEAD', 'SKULL', 'FACE', 'EYES'], this.head);
            set(['LEFT_LEG', 'FRONT_LEFT_PAW'], this.fl);
            set(['RIGHT_LEG', 'FRONT_RIGHT_PAW'], this.fr);
            set(['REAR_LEFT_LEG', 'HIND_LEFT_LEG'], this.rl);
            set(['REAR_RIGHT_LEG', 'HIND_RIGHT_LEG'], this.rr);
            set(['TAIL'], this.tail);
            this._partMeshMap = m;
            this._cascadeRules = [
                { gone: ['BODY', 'TORSO', 'CORE', 'SPINE'], hide: [this.body, this.head, this.fl, this.fr, this.rl, this.rr, this.tail] },
                { gone: ['HEAD', 'SKULL', 'FACE'], hide: [this.head] },
                { gone: ['LEFT_LEG', 'FRONT_LEFT_PAW'], hide: [this.fl] },
                { gone: ['RIGHT_LEG', 'FRONT_RIGHT_PAW'], hide: [this.fr] },
                { gone: ['REAR_LEFT_LEG', 'HIND_LEFT_LEG'], hide: [this.rl] },
                { gone: ['REAR_RIGHT_LEG', 'HIND_RIGHT_LEG'], hide: [this.rr] },
                { gone: ['TAIL'], hide: [this.tail] },
            ];
        }
        _lizLeg(mat, x, z) {
            const g = new THREE.Group();
            const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.34, 7), mat); upper.rotation.z = x > 0 ? -0.8 : 0.8; upper.position.set(x > 0 ? 0.1 : -0.1, -0.1, 0); g.add(upper);
            const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.2), mat); foot.position.set(x > 0 ? 0.22 : -0.22, -0.32, 0.04); g.add(foot);
            g.position.set(x, 0.78, z); this.bodyGroup.add(g); return g;
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.7);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            // Blink/dilate the cat eyes occasionally for life.
            const dilate = 1.0 + Math.sin(t * 0.7) * 0.15;
            if (this.catEyeL) this.catEyeL.scale.y = dilate;
            if (this.catEyeR) this.catEyeR.scale.y = dilate;

            switch (this.variant) {
                case 'catfish': {
                    this.model.position.y = this._baseY + Math.sin(t * 1.6) * 0.06 * this.scale;
                    this.model.rotation.y = Math.sin(t * (fast ? 7 : 2.5)) * 0.12;
                    if (this.tailFin && this.tailFin.visible) this.tailFin.rotation.y = Math.sin(t * (fast ? 12 : 5)) * 0.5;
                    break;
                }
                case 'catican': {
                    let flapRate = fast ? 16 : 9;
                    const flap = Math.sin(t * flapRate) * 0.7;
                    if (this.lwing && this.lwing.visible) this.lwing.rotation.z = 0.2 + flap;
                    if (this.rwing && this.rwing.visible) this.rwing.rotation.z = -0.2 - flap;
                    this.model.position.y = this._baseY + (Math.sin(t * flapRate) * 0.04 + Math.sin(t * 1.4) * 0.06) * this.scale;
                    if (this.head && this.head.visible) this.head.rotation.x = Math.sin(t * 2) * 0.1;
                    break;
                }
                case 'catizard': {
                    const gait = fast ? 8 : 2.4, amp = fast ? 0.4 : 0.2;
                    const sw = (leg, ph) => { if (leg && leg.visible) leg.rotation.x = Math.sin(t * gait + ph) * amp; };
                    sw(this.fl, 0); sw(this.rr, 0); sw(this.fr, Math.PI); sw(this.rl, Math.PI);
                    this.model.position.y = this._baseY + Math.abs(Math.sin(t * gait)) * 0.02 * this.scale;
                    if (this.tail && this.tail.visible) this.tail.rotation.y = Math.sin(t * (fast ? 6 : 2)) * (fast ? 0.5 : 0.25);
                    if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 1.6) * 0.05;
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.1);
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY - prog * 0.4 * this.scale;
            this.model.rotation.z = prog * 1.2;
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new CatHybridBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = CAT_PROFILES;
    reg('catfish',  { aliases: ['catfish'], scale: S.catfish.scale, weapon: 0, create: make });
    reg('catican',  { aliases: ['catican'], scale: S.catican.scale, weapon: 0, create: make });
    reg('catizard', { aliases: ['catizard'], scale: S.catizard.scale, weapon: 0, create: make });

    const NAMED = {
        catfish: ["Catfish"],
        catican: ["Catican"],
        catizard: ["Catizard"],
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Cat hybrids registered');
})();
