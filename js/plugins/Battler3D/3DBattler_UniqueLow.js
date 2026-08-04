//=============================================================================
// 3D Battler System - Unique Low-Tier (level 10-20 one-offs)
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke one-off models for distinctive level 10-20 enemies that
 * previously rode a shared rig. First batch toward the "unique model per monster"
 * goal. Each maps its enemy's <Archetype:> part keys so dismemberment works.
 * Requires 3DBattlerSystem; loads LAST so its name pins win.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Unique Low-Tier
 * ============================================================================
 *
 * One-off showpiece models assigned by exact name (registerNamed outranks the
 * Archetype meta). Parts follow each enemy's ARCHETYPE keys:
 *
 *   Haunting Scarecrow  (Humanoid)    HEAD, TORSO, LEFT/RIGHT_UPPER_ARM,
 *                                     LEFT/RIGHT_THIGH
 *   Pocket Watch Scarab (Insectoid)   HEAD, THORAX, ABDOMEN, MANDIBLES,
 *                                     LEFT_LEG, RIGHT_LEG
 *   Permafrost Beetle   (Insectoid)   (same insect keys)
 *   Wooden Flower       (Tree)        CROWN, TRUNK, ROOTS, BRANCH_1, BRANCH_2
 *   Bog Leech           (SegmentWorm) HEAD, HEART_SEGMENT, BODY_SEGMENT, TAIL
 *
 * See docs/3d_unique_models_plan.md for the roadmap. MUST load AFTER
 * BattleSystem/3DBattlerSystem.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler UniqueLow] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const UL_PROFILES = {
        scarecrow:    { variant: 'scarecrow',    scale: 2.6, texturePool: 'fur',  bodyColor: 0xb89a5a, accent: 0x8ad0ff, hue: [0.11, 0.04], sat: [0.30, 0.10], lit: [0.55, 0.10] },
        clockscarab:  { variant: 'clockscarab',  scale: 2.0, texturePool: 'metal', bodyColor: 0xb8923a, accent: 0xff5a1a, hue: [0.10, 0.04], sat: [0.45, 0.10], lit: [0.45, 0.10] },
        frostbeetle:  { variant: 'frostbeetle',  scale: 2.0, texturePool: 'crystal', bodyColor: 0x5a8ab0, accent: 0xbfeaff, hue: [0.55, 0.06], sat: [0.35, 0.12], lit: [0.50, 0.12] },
        woodenflower: { variant: 'woodenflower', scale: 2.0, texturePool: 'wood', bodyColor: 0x6a5236, accent: 0xe85a8a, hue: [0.09, 0.04], sat: [0.40, 0.12], lit: [0.40, 0.10] },
        bogleech:     { variant: 'bogleech',     scale: 2.3, texturePool: 'flesh', bodyColor: 0x3a7a74, accent: 0x1a979a, hue: [0.96, 0.05], sat: [0.45, 0.12], lit: [0.42, 0.10] },
        u_porphyrinleech: { variant: 'bogleech', scale: 2.3, texturePool: 'flesh', bodyColor: 0x5a1a3a, accent: 0xc21a4a, hue: [0.92, 0.05], sat: [0.55, 0.12], lit: [0.34, 0.10] },
    };

    class UniqueLowBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = UL_PROFILES[creatureType] || UL_PROFILES.scarecrow;
            super(scale, offsetY, battler, profile, 0, creatureType || 'scarecrow');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            if (this.variant === 'scarecrow') this.facingYaw = 0;
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
        _eye(parent, x, y, z, r, accent, glow) {
            const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), this._mat(accent || 0x111111, 1.0, 0.2, glow ? accent : 0));
            e.position.set(x, y, z); parent.add(e); return e;
        }

        async load(physicsWorld) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'clockscarab':  this._buildBeetle('clock'); break;
                case 'frostbeetle':  this._buildBeetle('frost'); break;
                case 'woodenflower': this._buildWoodenFlower(); break;
                case 'bogleech':     this._buildBogLeech(); break;
                default:             this._buildScarecrow(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Haunting Scarecrow (Humanoid keys) ───────────────────────────────
        _buildScarecrow() {
            const burlap = this._skinMat(0xb89a5a, 0.85);
            const wood = this._mat(0x5a4028, 1.0, 0.85);
            const straw = this._mat(0xd8b85a, 1.0, 0.9);
            const cloth = this._mat(0x3a2a18, 1.0, 0.85);
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 7), wood); post.position.set(0, 1.25, -0.16); this.bodyGroup.add(post);
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 7), wood); bar.rotation.z = Math.PI / 2; bar.position.set(0, 1.95, -0.16); this.bodyGroup.add(bar);

            this.torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.95, 9), burlap); this.torso.position.set(0, 1.5, 0); this.bodyGroup.add(this.torso);
            for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; const s = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 4), straw); s.position.set(Math.cos(a) * 0.28, 1.08, Math.sin(a) * 0.2); s.rotation.x = Math.PI; this.torso.add(s); }

            this.head = new THREE.Group();
            const sack = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), burlap); sack.scale.set(1, 1.12, 1); this.head.add(sack);
            const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 12), cloth); brim.position.y = 0.2; this.head.add(brim);
            const hat = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 8), cloth); hat.position.y = 0.4; this.head.add(hat);
            const xEye = (x) => { const a = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.02), this._mat(0x140d08, 1.0, 0.6)); a.position.set(x, 0.05, 0.26); a.rotation.z = 0.7; this.head.add(a); const b = a.clone(); b.rotation.z = -0.7; this.head.add(b); };
            xEye(-0.11); xEye(0.11);
            const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.02), this._mat(0x140d08, 1.0, 0.6)); mouth.position.set(0, -0.11, 0.26); this.head.add(mouth);
            this.head.position.set(0, 2.32, 0); this.bodyGroup.add(this.head);

            this.larm = this._ragLimb(burlap, straw, -0.62, 1.92, 0.5, true);
            this.rarm = this._ragLimb(burlap, straw, 0.62, 1.92, 0.5, true);
            this.lleg = this._ragLimb(burlap, straw, -0.13, 1.0, 0.85, false);
            this.rleg = this._ragLimb(burlap, straw, 0.13, 1.0, 0.85, false);

            const m = {}, set = (ks, me) => { if (me) ks.forEach(k => m[k] = me); };
            set(['HEAD', 'SKULL', 'FACE', 'BRAIN'], this.head);
            set(['TORSO', 'BODY', 'CORE', 'SPINE', 'RIBCAGE'], this.torso);
            set(['LEFT_UPPER_ARM', 'LEFT_ARM', 'LEFT_HAND'], this.larm);
            set(['RIGHT_UPPER_ARM', 'RIGHT_ARM', 'RIGHT_HAND'], this.rarm);
            set(['LEFT_THIGH', 'LEFT_LEG'], this.lleg);
            set(['RIGHT_THIGH', 'RIGHT_LEG'], this.rleg);
            this._partMeshMap = m;
            this._cascadeRules = [
                { gone: ['TORSO', 'BODY', 'CORE', 'SPINE', 'RIBCAGE'], hide: [this.torso, this.head, this.larm, this.rarm, this.lleg, this.rleg] },
                { gone: ['HEAD', 'SKULL', 'FACE'], hide: [this.head] },
                { gone: ['LEFT_UPPER_ARM', 'LEFT_ARM'], hide: [this.larm] },
                { gone: ['RIGHT_UPPER_ARM', 'RIGHT_ARM'], hide: [this.rarm] },
                { gone: ['LEFT_THIGH', 'LEFT_LEG'], hide: [this.lleg] },
                { gone: ['RIGHT_THIGH', 'RIGHT_LEG'], hide: [this.rleg] },
            ];
        }
        _ragLimb(cloth, straw, x, y, len, isArm) {
            const g = new THREE.Group();
            const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, len, 7), cloth); limb.position.y = -len / 2; g.add(limb);
            const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 5), straw); tuft.position.y = -len - 0.04; tuft.rotation.x = Math.PI; g.add(tuft);
            g.position.set(x, y, isArm ? -0.05 : 0); if (isArm) g.rotation.z = x < 0 ? 0.25 : -0.25;
            this.bodyGroup.add(g); return g;
        }

        // ── Beetles (Insectoid keys): clockwork scarab / frost beetle ────────
        _buildBeetle(kind) {
            const p = this.profile;
            const isFrost = kind === 'frost';
            const shellMat = this._skinMat(p.bodyColor, isFrost ? 0.25 : 0.4);
            const dark = this._mat(isFrost ? 0x2a4a6a : 0x3a2e1a, 1.0, 0.5);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 12), shellMat); this.thorax.position.set(0, 0.92, 0.22); this.bodyGroup.add(this.thorax);

            this.abdomen = new THREE.Group();
            const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), shellMat); dome.scale.set(1, 0.85, 1.2); this.abdomen.add(dome);
            if (isFrost) {
                this._iceMat = this._mat(p.accent, 0.75, 0.15, p.accent); this._iceMat.emissiveIntensity = 0.35;
                for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 5), this._iceMat); const a = this.idRand() * 6.28, r = this.idRand() * 0.3; c.position.set(Math.cos(a) * r, 0.18 + this.idRand() * 0.2, Math.sin(a) * r - 0.1); c.rotation.set(this.idRand() * 0.6 - 0.3, 0, this.idRand() * 0.6 - 0.3); this.abdomen.add(c); }
            } else {
                const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), this._mat(0xf0e8d0, 1.0, 0.4)); face.position.y = 0.33; this.abdomen.add(face);
                for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; const tick = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.06), dark); tick.position.set(Math.cos(a) * 0.28, 0.355, Math.sin(a) * 0.28); this.abdomen.add(tick); }
                this.hourHand = new THREE.Group(); const hh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.18), dark); hh.position.z = 0.09; this.hourHand.add(hh); this.hourHand.position.y = 0.37; this.abdomen.add(this.hourHand);
                this.minHand = new THREE.Group(); const mh = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.26), dark); mh.position.z = 0.13; this.minHand.add(mh); this.minHand.position.y = 0.38; this.abdomen.add(this.minHand);
            }
            this.abdomen.position.set(0, 0.92, -0.38); this.bodyGroup.add(this.abdomen);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), shellMat));
            this._eye(this.head, -0.09, 0.05, 0.15, 0.05, p.accent, true);
            this._eye(this.head, 0.09, 0.05, 0.15, 0.05, p.accent, true);
            this.mandibles = new THREE.Group();
            for (const mx of [-0.08, 0.08]) { const md = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 5), dark); md.position.set(mx, -0.06, 0.2); md.rotation.x = 1.4; md.rotation.z = mx > 0 ? -0.3 : 0.3; this.mandibles.add(md); }
            this.head.add(this.mandibles);
            this.head.position.set(0, 0.9, 0.52); this.bodyGroup.add(this.head);

            this.legsL = new THREE.Group(); this.legsR = new THREE.Group();
            for (let i = 0; i < 3; i++) { this.legsL.add(this._beetleLeg(dark, -1, i)); this.legsR.add(this._beetleLeg(dark, 1, i)); }
            this.bodyGroup.add(this.legsL, this.legsR);

            const m = {}, set = (ks, me) => { if (me) ks.forEach(k => m[k] = me); };
            set(['HEAD', 'SKULL', 'FACE'], this.head);
            set(['THORAX', 'BODY', 'CORE', 'CEPHALOTHORAX'], this.thorax);
            set(['ABDOMEN', 'TAIL'], this.abdomen);
            set(['MANDIBLES', 'PINCER_LEFT', 'PINCER_RIGHT'], this.mandibles);
            set(['LEFT_LEG'], this.legsL);
            set(['RIGHT_LEG'], this.legsR);
            this._partMeshMap = m;
            this._cascadeRules = [
                { gone: ['THORAX', 'BODY', 'CORE', 'CEPHALOTHORAX'], hide: [this.thorax, this.abdomen, this.head, this.mandibles, this.legsL, this.legsR] },
                { gone: ['ABDOMEN'], hide: [this.abdomen] },
                { gone: ['HEAD', 'SKULL'], hide: [this.head] },
                { gone: ['MANDIBLES'], hide: [this.mandibles] },
                { gone: ['LEFT_LEG'], hide: [this.legsL] },
                { gone: ['RIGHT_LEG'], hide: [this.legsR] },
            ];
        }
        _beetleLeg(mat, side, i) {
            const g = new THREE.Group();
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.4, 5), mat); seg.rotation.z = side * 1.1; seg.position.set(side * 0.18, -0.05, 0); g.add(seg);
            const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.3, 5), mat); foot.rotation.z = side * 0.4; foot.position.set(side * 0.34, -0.28, 0); g.add(foot);
            g.position.set(side * 0.22, 0.9, 0.3 - i * 0.3); g._side = side; return g;
        }

        // ── Wooden Flower (Tree keys) ────────────────────────────────────────
        _buildWoodenFlower() {
            const bark = this._skinMat(0x6a5236, 0.85);
            const leaf = this._mat(0x4f9d3a, 1.0, 0.7);
            const petalMat = this._mat(this.profile.accent, 1.0, 0.6);
            this.stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 1.05, 8), bark); this.stem.position.set(0, 0.9, 0); this.bodyGroup.add(this.stem);
            for (const ly of [0.75, 1.05]) for (const lx of [-1, 1]) { const lf = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), leaf); lf.scale.set(1.5, 0.3, 0.7); lf.position.set(lx * 0.2, ly, 0); lf.rotation.z = lx * 0.5; this.stem.add(lf); }

            this.crown = new THREE.Group();
            this.crown.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), this._mat(0xf0d040, 1.0, 0.5)));
            for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; const petal = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), petalMat); petal.scale.set(0.55, 0.22, 1.0); petal.position.set(Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27); petal.lookAt(0, 0, 0); this.crown.add(petal); }
            this._eye(this.crown, -0.07, 0.04, 0.17, 0.04, 0x111111, false);
            this._eye(this.crown, 0.07, 0.04, 0.17, 0.04, 0x111111, false);
            this.crown.position.set(0, 1.6, 0); this.crown.rotation.x = -0.35; this.bodyGroup.add(this.crown);

            this.branch1 = this._tendril(bark, -1); this.branch2 = this._tendril(bark, 1);
            this.roots = new THREE.Group();
            for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; const r = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 5), bark); r.position.set(Math.cos(a) * 0.18, 0.26, Math.sin(a) * 0.18); r.rotation.set(Math.PI - 0.35, 0, a); this.roots.add(r); }
            this.bodyGroup.add(this.roots);

            const m = {}, set = (ks, me) => { if (me) ks.forEach(k => m[k] = me); };
            set(['CROWN', 'CANOPY', 'FLOWER', 'HEAD', 'CAP'], this.crown);
            set(['TRUNK', 'STEM', 'BODY', 'CORE'], this.stem);
            set(['ROOTS', 'FOOT', 'FEET'], this.roots);
            set(['BRANCH_1', 'VINE_1', 'LEFT_ARM'], this.branch1);
            set(['BRANCH_2', 'VINE_2', 'RIGHT_ARM'], this.branch2);
            this._partMeshMap = m;
            this._cascadeRules = [
                { gone: ['TRUNK', 'STEM', 'BODY', 'CORE'], hide: [this.stem, this.crown, this.branch1, this.branch2] },
                { gone: ['CROWN', 'CANOPY', 'FLOWER', 'HEAD'], hide: [this.crown] },
                { gone: ['BRANCH_1', 'VINE_1'], hide: [this.branch1] },
                { gone: ['BRANCH_2', 'VINE_2'], hide: [this.branch2] },
                { gone: ['ROOTS'], hide: [this.roots] },
            ];
        }
        _tendril(mat, side) {
            const g = new THREE.Group();
            let y = 0, z = 0, r = 0.05;
            for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, 0.24, 6), mat); s.position.set(0, y, z); s.rotation.x = 0.3; g.add(s); const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), mat); thorn.position.set(0, y, z + r + 0.04); thorn.rotation.x = Math.PI / 2; g.add(thorn); y -= 0.2; z += 0.08; r *= 0.85; }
            g.position.set(side * 0.18, 1.25, 0); g.rotation.z = side * 0.7; g._side = side; this.bodyGroup.add(g); return g;
        }

        // ── Bog Leech (SegmentWorm keys) ─────────────────────────────────────
        _buildBogLeech() {
            const flesh = this._skinMat(this.profile.bodyColor, 0.5);
            const blood = this._mat(this.profile.accent, 1.0, 0.4, 0x5a0a14); blood.emissiveIntensity = 0.35;
            this.head = new THREE.Group();
            const sucker = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.2, 12), flesh); sucker.rotation.x = Math.PI / 2; this.head.add(sucker);
            const maw = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12), this._mat(0x2a0a10, 1.0, 0.6)); maw.rotation.x = Math.PI / 2; maw.position.z = 0.1; this.head.add(maw);
            for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 4), this._mat(0xf0e0d0, 1.0, 0.4)); tooth.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.12); tooth.rotation.x = -Math.PI / 2; this.head.add(tooth); }
            this.head.position.set(0, 1.05, 0.72); this.bodyGroup.add(this.head);

            this.bodySeg = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), flesh); this.bodySeg.position.set(0, 1.0, 0.35); this.bodySeg.scale.set(1, 1, 1.2); this.bodyGroup.add(this.bodySeg);
            this.heartSeg = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 12), blood); this.heartSeg.position.set(0, 0.98, -0.05); this.bodyGroup.add(this.heartSeg);
            this.seg3 = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), flesh); this.seg3.position.set(0, 1.0, -0.46); this.bodyGroup.add(this.seg3);
            this.tail = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), flesh); this.tail.position.set(0, 1.0, -0.78); this.bodyGroup.add(this.tail);

            this._partMeshMap = { HEAD: this.head, HEART_SEGMENT: this.heartSeg, BODY_SEGMENT: this.bodySeg, TAIL: this.tail, CORE: this.heartSeg };
            this._cascadeRules = [
                { gone: ['HEART_SEGMENT', 'CORE', 'BODY'], hide: [this.heartSeg, this.head, this.bodySeg, this.seg3, this.tail] },
                { gone: ['HEAD', 'SKULL'], hide: [this.head] },
                { gone: ['BODY_SEGMENT'], hide: [this.bodySeg] },
                { gone: ['TAIL'], hide: [this.tail] },
            ];
            this._leechSegs = [this.head, this.bodySeg, this.heartSeg, this.seg3, this.tail];
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.7);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');

            switch (this.variant) {
                case 'scarecrow': {
                    const sway = Math.sin(t * 1.3) * 0.05;
                    this.model.rotation.z = sway;
                    this.model.position.y = this._baseY + Math.sin(t * 1.1) * 0.02 * this.scale;
                    const flail = fast ? Math.sin(t * 9) * 0.6 : Math.sin(t * 1.6) * 0.18;
                    if (this.larm) this.larm.rotation.x = flail;
                    if (this.rarm) this.rarm.rotation.x = -flail;
                    if (this.head) this.head.rotation.z = Math.sin(t * 1.7) * 0.08;
                    break;
                }
                case 'clockscarab':
                case 'frostbeetle': {
                    const scut = fast ? 9 : 3;
                    if (this.legsL) this.legsL.rotation.z = Math.sin(t * scut) * 0.18;
                    if (this.legsR) this.legsR.rotation.z = -Math.sin(t * scut) * 0.18;
                    this.model.position.y = this._baseY + Math.abs(Math.sin(t * scut)) * 0.02 * this.scale;
                    if (this.mandibles) this.mandibles.rotation.x = fast ? Math.abs(Math.sin(t * 10)) * 0.4 : 0;
                    if (this.hourHand) this.hourHand.rotation.y = -t * 0.25;
                    if (this.minHand) this.minHand.rotation.y = -t * (fast ? 6 : 2.5); // steals seconds
                    if (this._iceMat) this._iceMat.emissiveIntensity = 0.3 + Math.sin(t * 4) * 0.25;
                    break;
                }
                case 'woodenflower': {
                    this.model.rotation.z = Math.sin(t * 1.2) * 0.05;
                    this.model.position.y = this._baseY + Math.sin(t * 1.4) * 0.03 * this.scale;
                    if (this.crown) this.crown.rotation.y = Math.sin(t * 0.8) * 0.3;
                    const whip = fast ? Math.sin(t * 10) * 0.5 : Math.sin(t * 1.8) * 0.15;
                    if (this.branch1) this.branch1.rotation.x = whip;
                    if (this.branch2) this.branch2.rotation.x = -whip;
                    break;
                }
                case 'bogleech': {
                    const speed = fast ? 6 : 3;
                    if (this._leechSegs) this._leechSegs.forEach((s, i) => { if (s && s.visible) s.position.y = (this._segBaseY(s, i)) + Math.sin(t * speed - i * 0.8) * 0.06; });
                    if (this.heartSeg) { const pl = 1.0 + Math.sin(t * (fast ? 7 : 3)) * 0.12; this.heartSeg.scale.setScalar(pl); if (this.heartSeg.material) this.heartSeg.material.emissiveIntensity = 0.35 + Math.sin(t * 5) * 0.25; }
                    if (this.head) this.head.rotation.z = Math.sin(t * 2) * 0.12;
                    this.model.position.y = this._baseY + Math.sin(t * 1.4) * 0.03 * this.scale;
                    break;
                }
            }
        }
        _segBaseY() { return 1.0; }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.1);
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY - prog * 0.4 * this.scale;
            this.model.rotation.z = prog * (this.variant === 'scarecrow' ? 0.8 : 1.3);
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new UniqueLowBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = UL_PROFILES;
    // scarecrow is canonically registered by 3DBattler_Humanoid.js (with aliases scarecrows/strawman);
    // omitted here so those aliases keep routing to that family instead of being shadowed.
    reg('clockscarab',  { aliases: ['clockscarab'], scale: S.clockscarab.scale, weapon: 0, create: make });
    reg('frostbeetle',  { aliases: ['frostbeetle'], scale: S.frostbeetle.scale, weapon: 0, create: make });
    reg('woodenflower', { aliases: ['woodenflower'], scale: S.woodenflower.scale, weapon: 0, create: make });
    reg('bogleech',     { aliases: ['bogleech'], scale: S.bogleech.scale, weapon: 0, create: make });

    const NAMED = {
        scarecrow: ["Haunting Scarecrow"],
        clockscarab: ["Pocket Watch Scarab"],
        frostbeetle: ["Permafrost Beetle"],
        woodenflower: ["Wooden Flower"],
        bogleech: ["Bog Leech"],
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Unique low-tier models registered');

    ;[['u_porphyrinleech',2.3]].forEach(([k,sc]) => reg(k, { aliases: [k], scale: sc, weapon: 0, create: make }));
})();
