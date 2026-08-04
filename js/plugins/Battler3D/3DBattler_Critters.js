//=============================================================================
// 3D Battler System - Critter Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke small-quadruped one-off models (baby bunny, cautious
 * opossum, skunk, taxidoggo) + name-based assignment. Requires 3DBattlerSystem
 * + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Critter Uniques
 * ============================================================================
 *
 * Distinct procedural small mammals shaped from each enemy's flavour text,
 * assigned by exact name (override with <Battler3D: key>). They map the Beast
 * (quadruped) archetype keys (BODY/HEAD + the four leg keys) so dismemberment
 * works, and reuse the base per-id variation + gestures.
 *
 * Registered: babybunny, opossum, skunk, taxidoggo
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Critters] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const C_PROFILES = {
        babybunny: { variant: 'babybunny', scale: 1.6, texturePool: 'fur', bodyColor: 0xe8e0d8, accent: 0xff8a9a, hue: [0.07, 0.04], sat: [0.12, 0.06], lit: [0.78, 0.08] },
        opossum:   { variant: 'opossum',   scale: 1.7, texturePool: 'fur', bodyColor: 0x9a9088, accent: 0xddaaaa, hue: [0.08, 0.04], sat: [0.10, 0.05], lit: [0.55, 0.08] },
        skunk:     { variant: 'skunk',     scale: 1.7, texturePool: 'fur', bodyColor: 0x1a1a1a, accent: 0xeeeeee, hue: [0.0, 0.0], sat: [0.0, 0.04], lit: [0.12, 0.05] },
        taxidoggo: { variant: 'taxidoggo', scale: 1.8, texturePool: 'fur', bodyColor: 0x8a6a44, accent: 0x88e0cc, hue: [0.08, 0.04], sat: [0.40, 0.10], lit: [0.42, 0.08] },
        curiousrabbit: { variant: 'curiousrabbit', scale: 1.5, texturePool: 'fur', bodyColor: 0xc9b89a, accent: 0xff9999, hue: [0.09, 0.04], sat: [0.20, 0.08], lit: [0.62, 0.08] },
        direrabbit:    { variant: 'direrabbit',    scale: 2.1, texturePool: 'fur', bodyColor: 0x6a5a48, accent: 0xcc3333, hue: [0.07, 0.04], sat: [0.30, 0.10], lit: [0.38, 0.08] }
    };

    class CritterBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = C_PROFILES[creatureType] || C_PROFILES.babybunny;
            super(scale, offsetY, battler, profile, 0, creatureType || 'babybunny');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            this.legs = [];
        }

        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.8 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.5 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity)
            });
            this._materials.push(m);
            return m;
        }
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.8 : rough)); }
        _eye(parent, x, y, z, r, accent) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), this._mat(0x0a0a0a, 1.0, 0.2));
            eye.position.set(x, y, z);
            const shine = new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 6, 6), this._mat(accent || 0xffffff, 1.0, 0.2, accent));
            shine.position.set(0, r * 0.25, r * 0.7); eye.add(shine);
            parent.add(eye); return eye;
        }
        _critLeg(x, z, bodyY, mat) {
            const g = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.45, 6), mat);
            g.position.set(x, bodyY - 0.33, z); g._x = x; g._z = z; this.legs.push(g); this.bodyGroup.add(g); return g;
        }
        _quadBase(o) {
            o = o || {};
            const p = this.profile;
            const mat = o.mat || this._skinMat(p.bodyColor, 0.85);
            this._critMat = mat;
            this.body = new THREE.Mesh(new THREE.SphereGeometry(o.bodyR || 0.42, 14, 12), mat);
            this.body.position.set(0, o.bodyY || 0.7, 0); this.body.scale.copy(o.bodyScale || new THREE.Vector3(1, 0.9, 1.5)); this.bodyGroup.add(this.body);
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(o.headR || 0.28, 14, 12), mat); if (o.headScale) h.scale.copy(o.headScale); this.head.add(h);
            this.head.position.set(0, (o.bodyY || 0.7) + (o.headDY || 0.12), (o.headZ || 0.55)); this.bodyGroup.add(this.head);
            const by = o.bodyY || 0.7, zf = o.legZF || 0.35, zr = o.legZR || 0.35;
            this.frontLeft = this._critLeg(-0.2, zf, by, mat); this.frontRight = this._critLeg(0.2, zf, by, mat);
            this.rearLeft = this._critLeg(-0.2, -zr, by, mat); this.rearRight = this._critLeg(0.2, -zr, by, mat);
            const extra = (o.extra || []).filter(Boolean);
            this._partMeshMap = {
                BODY: this.body, TORSO: this.body, SPINE: this.body, RIBCAGE: this.body, HEAD: this.head, SKULL: this.head, BRAIN: this.head,
                LEFT_LEG: this.frontLeft, FRONT_LEFT_PAW: this.frontLeft, RIGHT_LEG: this.frontRight, FRONT_RIGHT_PAW: this.frontRight,
                REAR_LEFT_LEG: this.rearLeft, HIND_LEFT_LEG: this.rearLeft, REAR_RIGHT_LEG: this.rearRight, HIND_RIGHT_LEG: this.rearRight
            };
            this._cascadeRules = [
                { gone: ['BODY', 'TORSO', 'SPINE', 'RIBCAGE'], hide: [this.body, this.head, this.frontLeft, this.frontRight, this.rearLeft, this.rearRight, ...extra] },
                { gone: ['HEAD', 'SKULL', 'BRAIN'], hide: [this.head] },
                { gone: ['LEFT_LEG', 'FRONT_LEFT_PAW'], hide: [this.frontLeft] },
                { gone: ['RIGHT_LEG', 'FRONT_RIGHT_PAW'], hide: [this.frontRight] },
                { gone: ['REAR_LEFT_LEG', 'HIND_LEFT_LEG'], hide: [this.rearLeft] },
                { gone: ['REAR_RIGHT_LEG', 'HIND_RIGHT_LEG'], hide: [this.rearRight] },
            ];
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'opossum':   this._buildOpossum(); break;
                case 'skunk':     this._buildSkunk(); break;
                case 'taxidoggo': this._buildTaxidoggo(); break;
                case 'curiousrabbit': this._buildRabbit(false); break;
                case 'direrabbit':    this._buildRabbit(true); break;
                default:          this._buildBunny(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Baby Bunny: cute leveret with razor buck-teeth ──────────────────
        _buildBunny() {
            const p = this.profile;
            this._quadBase({ bodyR: 0.4, bodyScale: new THREE.Vector3(1, 1.0, 1.3), headR: 0.3, headDY: 0.18, headZ: 0.42, legZF: 0.28, legZR: 0.3 });
            this._eye(this.head, -0.15, 0.05, 0.22, 0.08, p.accent); this._eye(this.head, 0.15, 0.05, 0.22, 0.08, p.accent);
            // Long ears.
            this.ears = new THREE.Group();
            const earGeo = THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.06, 0.4, 4, 8) : new THREE.CylinderGeometry(0.07, 0.04, 0.5, 6);
            for (const ex of [-0.12, 0.12]) { const ear = new THREE.Mesh(earGeo, this._critMat); ear.position.set(ex, 0.4, -0.02); ear.rotation.z = ex * 0.3; this.ears.add(ear); }
            this.head.add(this.ears);
            // Razor buck-teeth.
            for (const tx of [-0.05, 0.05]) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.04), this._mat(0xfafafa, 1.0, 0.3)); tooth.position.set(tx, -0.16, 0.26); this.head.add(tooth); }
            // Fluffy tail.
            this.tail = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), this._mat(0xffffff, 1.0, 0.95)); this.tail.position.set(0, 0.72, -0.5); this.bodyGroup.add(this.tail);
        }

        // ── Cautious Opossum: pointed snout, hairless pink tail ─────────────
        _buildOpossum() {
            const p = this.profile;
            this._quadBase({ bodyR: 0.4, bodyScale: new THREE.Vector3(1, 0.85, 1.6), headR: 0.24, headDY: 0.08, headZ: 0.6 });
            // Long pointed snout.
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 8), this._critMat); snout.position.set(0, -0.02, 0.22); snout.rotation.x = Math.PI / 2; this.head.add(snout);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), this._mat(p.accent, 1.0, 0.4)); nose.position.set(0, -0.02, 0.42); this.head.add(nose);
            this._eye(this.head, -0.12, 0.06, 0.1, 0.06, 0x111111); this._eye(this.head, 0.12, 0.06, 0.1, 0.06, 0x111111);
            // Small round ears.
            for (const ex of [-0.16, 0.16]) { const ear = new THREE.Mesh(new THREE.CircleGeometry(0.1, 10), this._mat(0x2a2420, 1.0, 0.7)); ear.position.set(ex, 0.2, 0); this.head.add(ear); }
            // Hairless pink curling tail.
            this.tail = new THREE.Group();
            let px = 0, pz = -0.6, py = 0.7;
            for (let i = 0; i < 6; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(0.07 - i * 0.008, 8, 8), this._mat(p.accent, 1.0, 0.6)); seg.position.set(px, py, pz); this.tail.add(seg); pz -= 0.12; py += i > 2 ? 0.05 : 0; px += 0.04 * i; }
            this.bodyGroup.add(this.tail);
        }

        // ── Skunk: black body, white back stripe, big raised tail ───────────
        _buildSkunk() {
            const p = this.profile;
            this._quadBase({ bodyR: 0.4, bodyScale: new THREE.Vector3(1, 0.9, 1.5), headR: 0.24, headDY: 0.06, headZ: 0.55 });
            const white = this._mat(p.accent, 1.0, 0.9);
            // White stripe along the back.
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 1.1), white); stripe.position.set(0, 1.04, -0.05); this.bodyGroup.add(stripe);
            const headStripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.3), white); headStripe.position.set(0, 0.2, 0.0); this.head.add(headStripe);
            this._eye(this.head, -0.12, 0.04, 0.18, 0.055, 0xffffff); this._eye(this.head, 0.12, 0.04, 0.18, 0.055, 0xffffff);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(0x222222, 1.0, 0.4)); nose.position.set(0, -0.02, 0.24); this.head.add(nose);
            // Big bushy raised tail (black with a white plume).
            this.tail = new THREE.Group();
            const t1 = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), this._critMat); t1.position.set(0, 0.3, 0); t1.scale.set(0.8, 1.3, 0.8); this.tail.add(t1);
            const plume = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), white); plume.position.set(0, 0.55, 0); plume.scale.set(0.8, 1.1, 0.8); this.tail.add(plume);
            this.tail.position.set(0, 0.8, -0.6); this.tail.rotation.x = -0.5; this.bodyGroup.add(this.tail);
        }

        // ── Taxidoggo: a stiff, glassy-eyed taxidermied dog ─────────────────
        _buildTaxidoggo() {
            const p = this.profile;
            this._quadBase({ bodyR: 0.42, bodyScale: new THREE.Vector3(1, 0.95, 1.6), headR: 0.27, headDY: 0.2, headZ: 0.6 });
            // Snout.
            const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.26), this._critMat); snout.position.set(0, -0.04, 0.22); this.head.add(snout);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), this._mat(0x161616, 1.0, 0.3)); nose.position.set(0, -0.02, 0.36); this.head.add(nose);
            // Over-bright glassy taxidermy eyes.
            this._eye(this.head, -0.13, 0.07, 0.2, 0.075, p.accent); this._eye(this.head, 0.13, 0.07, 0.2, 0.075, p.accent);
            // Floppy ears.
            for (const ex of [-0.22, 0.22]) { const ear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.04), this._critMat); ear.position.set(ex, 0.08, 0); ear.rotation.z = ex * 0.5; this.head.add(ear); }
            // Visible stitch seam down the body + a mounting plaque.
            const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1.0), this._mat(0x3a2a1a, 1.0, 0.6)); seam.position.set(0, 1.02, 0); this.bodyGroup.add(seam);
            const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.7), this._mat(0x4a3220, 1.0, 0.5)); plaque.position.set(0, 0.12, 0); this.bodyGroup.add(plaque);
            // Stiff straight tail sticking out.
            this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.4, 6), this._critMat); this.tail.position.set(0, 0.78, -0.6); this.tail.rotation.x = -1.2; this.bodyGroup.add(this.tail);
        }

        // ── Rabbit: timid leveret (curious) or hulking matted brute (dire) ──
        _buildRabbit(dire) {
            const p = this.profile;
            this._quadBase({ bodyR: dire ? 0.46 : 0.36, bodyScale: new THREE.Vector3(1, 1.0, 1.25), headR: dire ? 0.32 : 0.26, headDY: 0.18, headZ: 0.45, legZF: 0.28, legZR: 0.3 });
            this._eye(this.head, -0.14, 0.05, 0.2, 0.08, p.accent); this._eye(this.head, 0.14, 0.05, 0.2, 0.08, p.accent);
            this.ears = new THREE.Group();
            const earGeo = THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.06, dire ? 0.5 : 0.42, 4, 8) : new THREE.CylinderGeometry(0.07, 0.04, dire ? 0.6 : 0.5, 6);
            for (const ex of [-0.12, 0.12]) { const ear = new THREE.Mesh(earGeo, this._critMat); ear.position.set(ex, dire ? 0.5 : 0.42, -0.02); ear.rotation.z = ex * (dire ? 0.5 : 0.2); this.ears.add(ear); }
            this.head.add(this.ears);
            for (const tx of [-0.05, 0.05]) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, dire ? 0.16 : 0.1, 0.04), this._mat(0xfafafa, 1.0, 0.3)); tooth.position.set(tx, -0.16, 0.22); this.head.add(tooth); }
            this.tail = new THREE.Mesh(new THREE.SphereGeometry(dire ? 0.16 : 0.13, 10, 10), this._mat(0xffffff, 1.0, 0.95)); this.tail.position.set(0, 0.72, -0.5); this.bodyGroup.add(this.tail);
            if (dire) for (let i = 0; i < 6; i++) { const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), this._critMat); tuft.position.set((this.idRand() - 0.5) * 0.6, 0.95, (this.idRand() - 0.5) * 0.8); tuft.rotation.x = this.idRand(); this.bodyGroup.add(tuft); }
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.8);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            this.model.position.y = this._baseY + Math.sin(t * 1.4) * 0.02 * this.scale;
            // Default gentle leg shuffle.
            if (this.variant !== 'taxidoggo') this.legs.forEach((lg, i) => { if (lg.visible) lg.rotation.x = Math.sin(t * (fast ? 7 : 3) + i * 1.4) * 0.16; });

            switch (this.variant) {
                case 'babybunny': {
                    // Frantic little hops.
                    const hop = Math.abs(Math.sin(t * (fast ? 9 : 5)));
                    this.model.position.y = this._baseY + hop * (fast ? 0.22 : 0.1) * this.scale;
                    if (this.ears) this.ears.rotation.x = Math.sin(t * 6) * 0.12;
                    if (this.head) this.head.rotation.x = -hop * 0.2;
                    break;
                }
                case 'opossum': {
                    if (this.tail) this.tail.rotation.y = Math.sin(t * 1.5) * 0.2;
                    if (this.head) this.head.rotation.z = Math.sin(t * 2.2) * 0.1; // nervous sniff
                    break;
                }
                case 'skunk': {
                    const raise = fast ? -1.4 : -0.5 + Math.sin(t * 2) * 0.1;
                    if (this.tail) this.tail.rotation.x = raise; // tail up = warning
                    break;
                }
                case 'taxidoggo': {
                    // Barely moves: a stiff, unnatural wobble.
                    this.model.rotation.z = Math.sin(t * 3) * 0.02;
                    this.model.position.y = this._baseY + Math.abs(Math.sin(t * 1.2)) * 0.01 * this.scale;
                    break;
                }
                case 'curiousrabbit':
                case 'direrabbit': {
                    const heavy = this.variant === 'direrabbit';
                    const hop = Math.abs(Math.sin(t * (fast ? 9 : (heavy ? 4 : 6))));
                    this.model.position.y = this._baseY + hop * (fast ? 0.22 : (heavy ? 0.16 : 0.12)) * this.scale;
                    if (this.ears) this.ears.rotation.x = Math.sin(t * (heavy ? 3 : 6)) * 0.12;
                    if (this.head) this.head.rotation.x = -hop * 0.15;
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.1);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY - prog * 0.1 * this.scale;
            this.model.rotation.z = prog * 1.3; // keel over
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new CritterBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = C_PROFILES;
    reg('babybunny', { aliases: ['babybunny'], scale: S.babybunny.scale, weapon: 0, create: make });
    reg('opossum',   { aliases: ['opossum'],   scale: S.opossum.scale,   weapon: 0, create: make });
    reg('skunk',     { aliases: ['skunk'],     scale: S.skunk.scale,     weapon: 0, create: make });
    reg('taxidoggo', { aliases: ['taxidoggo'], scale: S.taxidoggo.scale, weapon: 0, create: make });
    reg('curiousrabbit', { aliases: ['curiousrabbit'], scale: S.curiousrabbit.scale, weapon: 0, create: make });
    reg('direrabbit',    { aliases: ['direrabbit'],    scale: S.direrabbit.scale,    weapon: 0, create: make });

    const NAMED = {
        babybunny: ["Baby Bunny"],
        opossum:   ["Cautious Opossum"],
        skunk:     ["Skunk"],
        taxidoggo: ["Taxidoggo"],
        curiousrabbit: ["Curious Rabbit"],
        direrabbit:    ["Dire Rabbit"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Critter uniques registered');
})();
