//=============================================================================
// 3D Battler System - Small Fauna Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke small-creature one-off models (frogs, axolotl, slug-snail,
 * lobster, crab, scorpion, worms) + name-based assignment. Requires
 * 3DBattlerSystem + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Small Fauna Uniques
 * ============================================================================
 *
 * Distinct procedural small creatures shaped from each enemy's flavour text,
 * assigned by exact name. Each maps its SOURCE archetype's body-part keys:
 *   frog/amphibian -> HEAD/TONGUE/LEFT_LEG/RIGHT_LEG
 *   snail          -> SHELL/BODY/FOOT/TENTACLE_1/TENTACLE_2/EYE
 *   crustacean     -> CARAPACE/ABDOMEN/CLAW_LEFT/CLAW_RIGHT/FRONT_LEG/REAR_LEG/ANTENNAE
 *   scorpion       -> CEPHALOTHORAX/ABDOMEN/HEAD/TAIL/STINGER/PINCER_LEFT/PINCER_RIGHT
 *   worm           -> HEAD/HEART_SEGMENT/BODY_SEGMENT/TAIL
 *
 * Registered: boghatchling, gardenfrog, deathaxolotl, maggotslail, freelobster,
 *             tidecrab, desertscorpion, caveworm, earthworm
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler SmallFauna] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const F_PROFILES = {
        boghatchling:   { variant: 'boghatchling',   scale: 1.4, texturePool: 'foliage', bodyColor: 0x5a6a3a, accent: 0xffcc33, hue: [0.25, 0.06], sat: [0.40, 0.10], lit: [0.40, 0.08] },
        gardenfrog:     { variant: 'gardenfrog',     scale: 1.5, texturePool: 'foliage', bodyColor: 0x4a9a3a, accent: 0xccdd44, hue: [0.30, 0.06], sat: [0.50, 0.10], lit: [0.45, 0.08] },
        deathaxolotl:   { variant: 'deathaxolotl',   scale: 1.7, texturePool: 'pale',    bodyColor: 0xe0a8c0, accent: 0x88ff66, hue: [0.92, 0.05], sat: [0.30, 0.10], lit: [0.70, 0.08] },
        maggotslail:    { variant: 'maggotslail',    scale: 1.6, texturePool: 'pale',    bodyColor: 0xe8e0c8, accent: 0xaa8866, hue: [0.10, 0.04], sat: [0.20, 0.08], lit: [0.72, 0.08] },
        freelobster:    { variant: 'freelobster',    scale: 1.8, texturePool: 'fire',    bodyColor: 0xcc4422, accent: 0xee6644, hue: [0.03, 0.03], sat: [0.55, 0.10], lit: [0.42, 0.08] },
        tidecrab:       { variant: 'tidecrab',       scale: 1.7, texturePool: 'water',   bodyColor: 0xcc8844, accent: 0x66bbdd, hue: [0.07, 0.04], sat: [0.45, 0.10], lit: [0.48, 0.08] },
        desertscorpion: { variant: 'desertscorpion', scale: 2.0, texturePool: 'crystal', bodyColor: 0x6a4a2a, accent: 0x88ddee, hue: [0.10, 0.04], sat: [0.40, 0.10], lit: [0.40, 0.08] },
        caveworm:       { variant: 'caveworm',       scale: 1.9, texturePool: 'crystal', bodyColor: 0xc8a0b0, accent: 0x66ffcc, hue: [0.92, 0.06], sat: [0.30, 0.10], lit: [0.60, 0.08] },
        earthworm:      { variant: 'earthworm',      scale: 1.5, texturePool: 'flesh',   bodyColor: 0xc88a8a, accent: 0xaa6a6a, hue: [0.99, 0.04], sat: [0.35, 0.10], lit: [0.58, 0.08] }
    };

    class SmallFaunaBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = F_PROFILES[creatureType] || F_PROFILES.gardenfrog;
            super(scale, offsetY, battler, profile, 0, creatureType || 'gardenfrog');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
        }

        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.6 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.5 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity), side: THREE.DoubleSide
            });
            this._materials.push(m);
            return m;
        }
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.6 : rough)); }
        _eye(parent, x, y, z, r, accent) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), this._mat(accent || 0xffcc33, 1.0, 0.2, accent === 0x111111 ? null : accent));
            eye.position.set(x, y, z);
            const pup = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 6, 6), this._mat(0x000000, 1.0, 0.1)); pup.position.set(0, 0, r * 0.6); eye.add(pup);
            parent.add(eye); return eye;
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'boghatchling':   this._buildFrog({}); break;
                case 'gardenfrog':     this._buildFrog({ spots: true }); break;
                case 'deathaxolotl':   this._buildAxolotl(); break;
                case 'maggotslail':    this._buildSnail(); break;
                case 'freelobster':    this._buildCrustacean(false); break;
                case 'tidecrab':       this._buildCrustacean(true); break;
                case 'desertscorpion': this._buildScorpion(); break;
                case 'caveworm':       this._buildWorm(true); break;
                case 'earthworm':      this._buildWorm(false); break;
                default:               this._buildFrog({}); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Frog: squat amphibian, bulging eyes, folded legs, flick tongue ──
        _buildFrog(o) {
            const p = this.profile;
            const skin = this._skinMat(p.bodyColor, 0.5);
            this.head = new THREE.Group();
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 12), skin); body.scale.set(1.2, 0.85, 1.1); this.head.add(body);
            for (const ex of [-0.2, 0.2]) {
                const bulge = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), skin); bulge.position.set(ex, 0.28, 0.18); this.head.add(bulge);
                this._eye(this.head, ex, 0.32, 0.26, 0.09, p.accent);
            }
            const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 6, 16, Math.PI), this._mat(0x2a1a1a, 1, 0.5)); mouth.position.set(0, -0.1, 0.36); mouth.rotation.z = Math.PI; this.head.add(mouth);
            if (o.spots) for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), this._mat(p.accent, 1, 0.6)); s.position.set((this.idRand() - 0.5) * 0.6, 0.2 + this.idRand() * 0.2, 0.34); s.rotation.x = -0.6; this.head.add(s); }
            this.head.position.set(0, 0.55, 0); this.bodyGroup.add(this.head);
            this.tongue = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.3), this._mat(0xcc5566, 1, 0.4)); this.tongue.position.set(0, 0.45, 0.4); this.tongue.rotation.x = 0.3; this.tongue.visible = false; this.bodyGroup.add(this.tongue);
            this.leftLeg = this._frogLeg(-1, skin); this.rightLeg = this._frogLeg(1, skin);
            this._partMeshMap = { HEAD: this.head, TONGUE: this.tongue, LEFT_LEG: this.leftLeg, RIGHT_LEG: this.rightLeg };
            this._cascadeRules = [
                { gone: ['HEAD', 'BODY', 'CORE'], hide: [this.head, this.tongue, this.leftLeg, this.rightLeg] },
                { gone: ['TONGUE'], hide: [this.tongue] },
                { gone: ['LEFT_LEG'], hide: [this.leftLeg] },
                { gone: ['RIGHT_LEG'], hide: [this.rightLeg] },
            ];
        }
        _frogLeg(side, mat) {
            const g = new THREE.Group();
            const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.3, 6), mat); thigh.position.set(side * 0.18, 0, 0); thigh.rotation.z = side * 1.0; g.add(thigh);
            const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18), mat); foot.position.set(side * 0.4, -0.18, 0.12); g.add(foot);
            g.position.set(side * 0.22, 0.3, -0.08); g._side = side; this.bodyGroup.add(g); return g;
        }

        // ── Death Axolotl: pink salamander with corrosive external gills ────
        _buildAxolotl() {
            const p = this.profile;
            const skin = this._skinMat(p.bodyColor, 0.4);
            this.head = new THREE.Group();
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), skin); head.scale.set(1.3, 0.85, 1.0); this.head.add(head);
            const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 14, Math.PI), this._mat(0x884455, 1, 0.4)); mouth.position.set(0, -0.06, 0.3); mouth.rotation.z = Math.PI; this.head.add(mouth);
            for (const ex of [-0.16, 0.16]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), this._mat(0x111111, 1, 0.2)); e.position.set(ex, 0.08, 0.3); this.head.add(e); }
            this.gills = new THREE.Group();
            for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { const gill = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.32, 5), this._mat(p.accent, 0.9, 0.3, p.accent)); gill.position.set(side * 0.34, 0.1 + i * 0.12, -0.05); gill.rotation.z = side * (1.2 - i * 0.2); this.gills.add(gill); }
            this.head.add(this.gills);
            this.head.position.set(0, 0.5, 0.15); this.bodyGroup.add(this.head);
            this.bodySeg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.08, 0.8, 8), skin); this.bodySeg.position.set(0, 0.45, -0.45); this.bodySeg.rotation.x = Math.PI / 2; this.bodyGroup.add(this.bodySeg);
            this.tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 6), this._mat(p.bodyColor, 0.8, 0.4)); this.tailFin.position.set(0, 0.45, -0.9); this.tailFin.rotation.x = -Math.PI / 2; this.tailFin.scale.set(0.3, 1, 1); this.bodyGroup.add(this.tailFin);
            this.leftLeg = this._stubLeg(-1, skin); this.rightLeg = this._stubLeg(1, skin);
            this._partMeshMap = { HEAD: this.head, TONGUE: this.bodySeg, LEFT_LEG: this.leftLeg, RIGHT_LEG: this.rightLeg };
            this._cascadeRules = [
                { gone: ['HEAD', 'CORE', 'BODY'], hide: [this.head, this.bodySeg, this.tailFin, this.leftLeg, this.rightLeg] },
                { gone: ['LEFT_LEG'], hide: [this.leftLeg] },
                { gone: ['RIGHT_LEG'], hide: [this.rightLeg] },
            ];
        }
        _stubLeg(side, mat) {
            const g = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.26, 6), mat);
            g.position.set(side * 0.22, 0.32, 0.15); g.rotation.z = side * 0.5; this.bodyGroup.add(g); return g;
        }

        // ── Maggot Slail: a bloated carrion grub with a crusty shell ───────
        _buildSnail() {
            const p = this.profile;
            const flesh = this._skinMat(p.bodyColor, 0.4);
            this.foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 1.1), flesh); this.foot.position.set(0, 0.18, 0.05); this.bodyGroup.add(this.foot);
            this.body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), flesh); this.body.position.set(0, 0.42, 0.25); this.body.scale.set(1, 1, 2.0); this.bodyGroup.add(this.body);
            this.segRidges = new THREE.Group();
            for (let i = 0; i < 5; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28 - i * 0.01, 0.03, 6, 12), this._mat(p.bodyColor, 1, 0.5)); ring.position.set(0, 0.42, 0.5 - i * 0.18); ring.rotation.y = Math.PI / 2; this.segRidges.add(ring); }
            this.bodyGroup.add(this.segRidges);
            this.shell = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), this._mat(p.accent, 1, 0.85)); this.shell.position.set(0, 0.55, -0.1); this.shell.scale.set(1.1, 1, 1.2); this.bodyGroup.add(this.shell);
            this.t1 = this._snailStalk(-0.1); this.t2 = this._snailStalk(0.1);
            this._partMeshMap = { SHELL: this.shell, BODY: this.body, FOOT: this.foot, TENTACLE_1: this.t1, TENTACLE_2: this.t2, EYE: this.t1 };
            this._cascadeRules = [
                { gone: ['BODY', 'FOOT'], hide: [this.body, this.foot, this.shell, this.segRidges, this.t1, this.t2] },
                { gone: ['SHELL'], hide: [this.shell] },
                { gone: ['TENTACLE_1', 'EYE'], hide: [this.t1] },
                { gone: ['TENTACLE_2'], hide: [this.t2] },
            ];
        }
        _snailStalk(x) {
            const g = new THREE.Group();
            const st = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 5), this._skinMat(this.profile.bodyColor, 0.4)); st.position.y = 0.17; g.add(st);
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(0x111111, 1, 0.2)); eye.position.y = 0.36; g.add(eye);
            g.position.set(x, 0.55, 0.62); g._x = x; this.bodyGroup.add(g); return g;
        }

        // ── Crustacean: lobster (elongated tail) or crab (wide carapace) ───
        _buildCrustacean(wide) {
            const p = this.profile;
            const shell = this._skinMat(p.bodyColor, 0.4);
            this.carapace = new THREE.Mesh(new THREE.SphereGeometry(wide ? 0.5 : 0.34, 14, 12), shell); this.carapace.position.set(0, 0.6, wide ? 0 : 0.1); this.carapace.scale.set(wide ? 1.5 : 1.0, wide ? 0.5 : 0.7, wide ? 1.1 : 1.3); this.bodyGroup.add(this.carapace);
            this.antennae = new THREE.Group();
            for (const ex of [-0.12, 0.12]) {
                const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5), shell); stalk.position.set(ex, 0.78, 0.4); this.antennae.add(stalk);
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(0x111111, 1, 0.2)); eye.position.set(ex, 0.86, 0.4); this.antennae.add(eye);
            }
            if (!wide) for (const ex of [-0.08, 0.08]) { const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.6, 4), shell); ant.position.set(ex, 0.62, 0.5); ant.rotation.x = 1.2; this.antennae.add(ant); }
            this.bodyGroup.add(this.antennae);
            this.abdomen = new THREE.Group();
            if (wide) { const ab = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), shell); ab.position.set(0, 0.55, -0.35); this.abdomen.add(ab); }
            else {
                let z = -0.2, r = 0.2;
                for (let i = 0; i < 4; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r - 0.03, 0.18, 8), shell); seg.position.set(0, 0.6, z); seg.rotation.x = Math.PI / 2; this.abdomen.add(seg); z -= 0.2; r -= 0.03; }
                const fan = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.2, 6), shell); fan.position.set(0, 0.6, z); fan.rotation.x = -Math.PI / 2; fan.scale.set(1, 1, 0.4); this.abdomen.add(fan);
            }
            this.bodyGroup.add(this.abdomen);
            this.clawL = this._claw(-1, shell, wide); this.clawR = this._claw(1, shell, wide);
            this.frontLeg = this._crustLeg(-1, 0.2, shell); this.rearLeg = this._crustLeg(1, 0.2, shell);
            this._legsExtra = [];
            for (const side of [-1, 1]) for (const lz of [0.0, -0.2]) this._legsExtra.push(this._crustLeg(side, lz, shell));
            this._partMeshMap = { CARAPACE: this.carapace, ABDOMEN: this.abdomen, CLAW_LEFT: this.clawL, CLAW_RIGHT: this.clawR, FRONT_LEG: this.frontLeg, REAR_LEG: this.rearLeg, ANTENNAE: this.antennae };
            this._cascadeRules = [
                { gone: ['CARAPACE'], hide: [this.carapace, this.abdomen, this.clawL, this.clawR, this.frontLeg, this.rearLeg, this.antennae, ...this._legsExtra] },
                { gone: ['CLAW_LEFT'], hide: [this.clawL] },
                { gone: ['CLAW_RIGHT'], hide: [this.clawR] },
                { gone: ['ABDOMEN'], hide: [this.abdomen] },
                { gone: ['ANTENNAE'], hide: [this.antennae] },
                { gone: ['FRONT_LEG'], hide: [this.frontLeg] },
                { gone: ['REAR_LEG'], hide: [this.rearLeg] },
            ];
        }
        _claw(side, mat, wide) {
            const g = new THREE.Group();
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 6), mat); arm.position.set(side * 0.1, 0, 0); arm.rotation.z = side * 1.0; g.add(arm);
            const base = new THREE.Mesh(new THREE.SphereGeometry(wide ? 0.16 : 0.13, 10, 8), mat); base.position.set(side * 0.36, 0.1, 0.12); g.add(base);
            const upper = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), mat); upper.position.set(side * 0.42, 0.22, 0.2); upper.rotation.x = -1.2; g.add(upper); g._upper = upper;
            const lower = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 5), mat); lower.position.set(side * 0.34, 0.16, 0.2); lower.rotation.x = -1.5; g.add(lower);
            g.position.set(side * 0.3, 0.6, wide ? 0.35 : 0.45); g._side = side; this.bodyGroup.add(g); return g;
        }
        _crustLeg(side, z, mat) {
            const g = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.018, 0.4, 5), mat);
            g.position.set(side * 0.45, 0.4, z); g.rotation.z = side * 1.1; g._side = side; this.bodyGroup.add(g); return g;
        }

        // ── Desert Scorpion: sand chitin, crystalline pincers + stinger ───
        _buildScorpion() {
            const p = this.profile;
            const chitin = this._skinMat(p.bodyColor, 0.45);
            const crys = this._mat(p.accent, 0.92, 0.2, p.accent);
            this.cephalothorax = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), chitin); this.cephalothorax.position.set(0, 0.6, 0.1); this.cephalothorax.scale.set(1.1, 0.7, 1.3); this.bodyGroup.add(this.cephalothorax);
            this.head = new THREE.Group();
            const hh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), chitin); this.head.add(hh);
            this._eye(this.head, -0.06, 0.05, 0.12, 0.04, 0x111111); this._eye(this.head, 0.06, 0.05, 0.12, 0.04, 0x111111);
            this.head.position.set(0, 0.62, 0.42); this.bodyGroup.add(this.head);
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), chitin); this.abdomen.position.set(0, 0.6, -0.4); this.abdomen.scale.set(1, 0.7, 1.3); this.bodyGroup.add(this.abdomen);
            this.tail = new THREE.Group();
            let z = -0.7, y = 0.6, r = 0.1;
            for (let i = 0; i < 5; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), chitin); seg.position.set(0, y, z); this.tail.add(seg); z -= 0.05; y += 0.18; r -= 0.008; }
            this.stinger = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 6), crys); this.stinger.position.set(0, y + 0.1, z + 0.12); this.stinger.rotation.x = 0.8; this.tail.add(this.stinger);
            this.bodyGroup.add(this.tail);
            this.pincerL = this._pincer(-1, chitin, crys); this.pincerR = this._pincer(1, chitin, crys);
            this._legs = [];
            for (const side of [-1, 1]) for (const lz of [0.3, 0.1, -0.1, -0.3]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.42, 5), chitin); lg.position.set(side * 0.4, 0.4, lz); lg.rotation.z = side * 1.1; lg._side = side; this.bodyGroup.add(lg); this._legs.push(lg); }
            this._partMeshMap = { CEPHALOTHORAX: this.cephalothorax, ABDOMEN: this.abdomen, HEAD: this.head, TAIL: this.tail, STINGER: this.stinger, PINCER_LEFT: this.pincerL, PINCER_RIGHT: this.pincerR };
            this._cascadeRules = [
                { gone: ['CEPHALOTHORAX'], hide: [this.cephalothorax, this.head, this.abdomen, this.tail, this.pincerL, this.pincerR, ...this._legs] },
                { gone: ['ABDOMEN'], hide: [this.abdomen, this.tail] },
                { gone: ['HEAD'], hide: [this.head] },
                { gone: ['TAIL'], hide: [this.tail] },
                { gone: ['STINGER'], hide: [this.stinger] },
                { gone: ['PINCER_LEFT'], hide: [this.pincerL] },
                { gone: ['PINCER_RIGHT'], hide: [this.pincerR] },
            ];
        }
        _pincer(side, mat, crys) {
            const g = new THREE.Group();
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), mat); arm.position.set(side * 0.15, 0, 0.1); arm.rotation.z = side * 0.8; g.add(arm);
            const base = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), crys); base.position.set(side * 0.34, 0.05, 0.32); g.add(base);
            const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 5), crys); f1.position.set(side * 0.4, 0.12, 0.44); f1.rotation.x = -1.3; g.add(f1); g._f1 = f1;
            const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.18, 5), crys); f2.position.set(side * 0.3, 0.08, 0.44); f2.rotation.x = -1.5; g.add(f2);
            g.position.set(side * 0.28, 0.6, 0.4); g._side = side; this.bodyGroup.add(g); return g;
        }

        // ── Worm: segmented annelid, optionally bioluminescent ─────────────
        _buildWorm(glow) {
            const p = this.profile;
            const skin = this._skinMat(p.bodyColor, 0.55);
            this.head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin); this.head.position.set(0, 0.6, 0.7); this.head.scale.set(1, 0.9, 1.1); this.bodyGroup.add(this.head);
            const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 12), this._mat(0x3a1a1a, 1, 0.5)); mouth.position.set(0, 0.6, 0.92); mouth.rotation.x = Math.PI / 2; this.bodyGroup.add(mouth); this.head._mouth = mouth;
            this.segs = [];
            let z = 0.4, r = 0.28;
            this.heartSeg = null; this.bodySeg = null;
            for (let i = 0; i < 6; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), (i === 1 && glow) ? this._mat(p.accent, 1, 0.4, p.accent) : skin); seg.position.set(0, 0.6, z); seg.scale.set(1, 0.9, 1.05); this.bodyGroup.add(seg); this.segs.push(seg); if (i === 1) this.heartSeg = seg; if (i === 3) this.bodySeg = seg; z -= 0.32; r -= 0.015; }
            this.tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 8), skin); this.tail.position.set(0, 0.6, z); this.tail.rotation.x = Math.PI / 2; this.bodyGroup.add(this.tail);
            this.glowRings = null;
            if (glow) {
                this.glowRings = new THREE.Group();
                this.segs.forEach(s => { const ring = new THREE.Mesh(new THREE.TorusGeometry(s.geometry.parameters.radius * 1.05, 0.02, 6, 14), this._mat(p.accent, 0.8, 0.3, p.accent)); ring.position.copy(s.position); ring.rotation.x = Math.PI / 2; this.glowRings.add(ring); });
                this.bodyGroup.add(this.glowRings);
            }
            this._partMeshMap = { HEAD: this.head, HEART_SEGMENT: this.heartSeg, BODY_SEGMENT: this.bodySeg, TAIL: this.tail };
            const allSegs = [this.head, ...this.segs, this.tail, this.glowRings].filter(Boolean);
            this._cascadeRules = [
                { gone: ['HEART_SEGMENT', 'BODY_SEGMENT'], hide: allSegs },
                { gone: ['HEAD'], hide: [this.head] },
                { gone: ['TAIL'], hide: [this.tail] },
            ];
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.8);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            this.model.position.y = this._baseY + Math.sin(t * 1.5) * 0.02 * this.scale;

            switch (this.variant) {
                case 'boghatchling':
                case 'gardenfrog': {
                    if (fast) this.model.position.y = this._baseY + Math.abs(Math.sin(t * 7)) * 0.2 * this.scale; // hop
                    if (this.head) this.head.scale.y = 0.85 + Math.sin(t * 3) * 0.04; // throat
                    if (this.tongue) { this.tongue.visible = fast; if (fast) this.tongue.scale.z = 1 + Math.abs(Math.sin(t * 9)) * 2; }
                    break;
                }
                case 'deathaxolotl': {
                    if (this.gills) this.gills.children.forEach((g, i) => { g.rotation.z = g.rotation.z * 0 + (g.position.x < 0 ? 1 : -1) * (0.9 + Math.sin(t * 4 + i) * 0.3); });
                    if (this.tailFin) this.tailFin.rotation.z = Math.sin(t * 3) * 0.3;
                    this.model.position.y = this._baseY + Math.sin(t * 2) * 0.05 * this.scale;
                    break;
                }
                case 'maggotslail': {
                    if (this.body) this.body.scale.z = 2.0 + Math.sin(t * (fast ? 5 : 2)) * 0.2; // peristalsis
                    [this.t1, this.t2].forEach((s, i) => { if (s) s.rotation.z = Math.sin(t * 1.5 + i) * 0.25; });
                    break;
                }
                case 'freelobster':
                case 'tidecrab': {
                    [this.clawL, this.clawR].forEach((c, i) => { if (c && c._upper) c._upper.rotation.x = -1.2 - (fast ? Math.abs(Math.sin(t * 9 + i)) : Math.abs(Math.sin(t * 2 + i))) * 0.5; });
                    if (this.antennae) this.antennae.rotation.z = Math.sin(t * 2) * 0.06;
                    [this.frontLeg, this.rearLeg, ...(this._legsExtra || [])].forEach((lg, i) => { if (lg) lg.rotation.z = (lg._side || 1) * 1.1 + Math.sin(t * (fast ? 8 : 4) + i) * 0.18; });
                    if (this.variant === 'tidecrab') this.model.position.x = Math.sin(t * 1.5) * 0.04 * this.scale; // sidle
                    break;
                }
                case 'desertscorpion': {
                    if (this.tail) this.tail.rotation.x = fast ? -0.6 + Math.sin(t * 9) * 0.3 : Math.sin(t * 1.5) * 0.12; // strike arc
                    if (this.stinger) this.stinger.material.emissiveIntensity = 0.5 + Math.sin(t * 5) * 0.3;
                    [this.pincerL, this.pincerR].forEach((pc, i) => { if (pc && pc._f1) pc._f1.rotation.x = -1.3 - (fast ? Math.abs(Math.sin(t * 8 + i)) : Math.abs(Math.sin(t * 2 + i))) * 0.4; });
                    if (this._legs) this._legs.forEach((lg, i) => { lg.rotation.z = lg._side * 1.1 + Math.sin(t * (fast ? 8 : 4) + i) * 0.15; });
                    break;
                }
                case 'caveworm':
                case 'earthworm': {
                    // Undulating segments.
                    if (this.segs) this.segs.forEach((s, i) => { s.position.y = 0.6 + Math.sin(t * (fast ? 6 : 3) - i * 0.7) * 0.08; });
                    if (this.head) this.head.position.y = 0.6 + Math.sin(t * (fast ? 6 : 3) + 0.7) * 0.08;
                    if (this.glowRings) { this.glowRings.children.forEach((rg, i) => { rg.position.y = this.segs[i] ? this.segs[i].position.y : rg.position.y; rg.material.emissiveIntensity = 0.4 + Math.sin(t * 3 + i) * 0.4; }); }
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.1);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY - prog * 0.12 * this.scale;
            this.model.rotation.z = prog * 0.7;
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new SmallFaunaBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = F_PROFILES;
    Object.keys(S).forEach(k => reg(k, { aliases: [k], scale: S[k].scale, weapon: 0, create: make }));

    const NAMED = {
        boghatchling:   ["Bog Hatchling"],
        gardenfrog:     ["Garden Frog"],
        deathaxolotl:   ["Death Axolotl"],
        maggotslail:    ["Maggot Slail"],
        freelobster:    ["Free Lobster"],
        tidecrab:       ["Tide Crab"],
        desertscorpion: ["Desert Scorpion"],
        caveworm:       ["Bioluminescent Caveworm"],
        earthworm:      ["Earthworm"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Small fauna uniques registered');
})();
