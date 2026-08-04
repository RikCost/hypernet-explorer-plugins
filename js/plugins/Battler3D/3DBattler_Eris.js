//=============================================================================
// 3D Battler System - Eris, Judgment of Discord (bespoke)
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Dedicated, ultra-detailed bespoke model for enemy 1343
 * "Eris, Judgment of Discord" - a towering radiant goddess of strife with a
 * vast mane of living golden hair, a white-and-gold gown, an encircling halo
 * ring, orbiting motes of light and crimson shards of consumed order. Replaces
 * the witch-rig stand-in. Requires 3DBattlerSystem (core) + 3DBattler_Bosses.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Eris, Judgment of Discord
 * ============================================================================
 *
 * The ultimate boss Eris (Enemies.json id 1343) carries a forced
 * <Battler3D: eris> note tag. This family registers the `eris` archetype key
 * with its own dedicated, hand-built mesh and overrides the earlier
 * witch-variant stand-in in 3DBattler_Bosses.js (this file loads AFTER it, so
 * the last registration of the key wins).
 *
 * Design goals - the most detailed model in the game:
 *   - ~70 individually animated strands of flowing golden hair, grouped so the
 *     two great side-sweeps map to the Demon LEFT_WING / RIGHT_WING parts and
 *     the long central train maps to TAIL (dismemberment-aware).
 *   - LatheGeometry gown with a gold waist band and collar, gloved arms.
 *   - A serene porcelain face with a jewelled diadem (mapped to HORNS) and
 *     glowing eyes that flare during attacks.
 *   - A large encircling halo ring, a subtle crown halo, orbiting golden motes
 *     and counter-orbiting crimson shards (the consumed goddess of order).
 *   - Distinct poses for idle / attack (judgment gesture) / specialattack
 *     (both arms raised, radiance bloom, hair billows up) / hit / spawn / death.
 *
 * MUST load AFTER 3DBattlerSystem and 3DBattler_Bosses (it is appended last in
 * the core BATTLER3D_FAMILIES auto-loader list).
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Eris] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    // Palette: chaos-purple under-robe glow, Maat-gold hair + trim, crimson
    // discord shards. Hair colour drifts a little per enemy id via the HSL band.
    const E_PROFILE = {
        eris: {
            variant: 'eris', scale: 4.8, texturePool: 'metal',
            bodyColor: 0xfdf6e3,          // ivory gown
            accent: 0xffd24a,             // Maat gold
            hairColor: 0xf2c84b,          // radiant gold hair
            hairTip: 0xfff3c0,            // pale luminous tips
            discord: 0xc0233a,            // crimson shards of consumed order
            skin: 0xf3ddc6,              // porcelain
            hue: [0.12, 0.04], sat: [0.55, 0.12], lit: [0.55, 0.10]
        }
    };

    class ErisBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = E_PROFILE.eris;
            super(scale, offsetY, battler, profile, 0, 'eris');
            this.variant = 'eris';
            this._materials = [];
            this._hair = [];        // [{ group, segs, phase, sway, lift, baseRX }]
            this._floaters = [];    // generic spinners (halo, motes, shards)
            this._baseY = null;
            this._baseX = null;
            this.facingYaw = 0;     // front-on, like the bipedal bosses
            // She is the ultimate boss: float her up off the feet line and let her
            // tower past the normal envelope so she dominates the battle view.
            this._rise = 0.45;
            // As the battle drags on, her chaos unravels her own form: the model
            // grows abstract and unstable, clearly noticeable from ~turn 10.
            this._instab = 0;
            this._jitterBases = null;
        }

        // Discord destabilisation factor from the current battle turn. ~0 early,
        // clearly noticeable from turn 10, escalating (capped so she stays on screen).
        _turnInstability() {
            let turn = 0;
            if (typeof $gameTroop !== 'undefined' && $gameTroop && typeof $gameTroop.turnCount === 'function') {
                turn = $gameTroop.turnCount() || 0;
            }
            return Math.min(1.6, Math.max(0, (turn - 6)) * 0.09); // t10->0.36, t15->0.81, t20->1.26
        }

        // Bigger custom fit-envelope (the base caps models at 5.0 tall / 8.5 wide;
        // Eris, a giant goddess, is allowed to fill far more of the frame).
        _computeFitClamp() {
            this._fitClamp = 1;
            if (!this.model || typeof THREE.Box3 === 'undefined') return;
            const sh = this.shapeXYZ, s = this.scale;
            this.model.scale.set(s * sh.x, s * sh.y, s * sh.z);
            this.model.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(this.model);
            if (box.isEmpty()) return;
            const size = new THREE.Vector3();
            box.getSize(size);
            const MAX_H = 6.6, MAX_W = 9.5; // imposing boss envelope
            this._fitClamp = Math.min(1, MAX_H / Math.max(size.y, 1e-3), MAX_W / Math.max(size.x, 1e-3));
        }

        async load(physicsWorld) {
            this.physicsWorld = physicsWorld;
            this._build();
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        //---------------------------------------------------------------------
        // Material helpers
        //---------------------------------------------------------------------
        _mat(color, opts) {
            opts = opts || {};
            const m = new THREE.MeshStandardMaterial({
                color,
                roughness: opts.rough === undefined ? 0.65 : opts.rough,
                metalness: opts.metal === undefined ? 0.0 : opts.metal,
                emissive: new THREE.Color(opts.emissive || 0x000000),
                emissiveIntensity: opts.emissive ? (opts.glow === undefined ? 0.6 : opts.glow) : 0,
                transparent: true,
                opacity: opts.opacity === undefined ? 1.0 : opts.opacity,
                side: opts.side || THREE.FrontSide
            });
            if (opts.skin) this.applySkin(m);
            this._materials.push(m);
            return m;
        }

        //---------------------------------------------------------------------
        // Build the whole goddess
        //---------------------------------------------------------------------
        _build() {
            const p = this.profile;

            // Shared materials.
            this.matGown  = this._mat(p.bodyColor, { rough: 0.85, emissive: 0xfff4d8, glow: 0.12 });
            this.matGlove = this._mat(0xfbf3e0, { rough: 0.8 });
            this.matTrim  = this._mat(p.accent, { rough: 0.25, metal: 0.9, emissive: p.accent, glow: 0.55, skin: true });
            this.matSkin  = this._mat(p.skin, { rough: 0.45 });
            this.matHalo  = this._mat(p.accent, { rough: 0.2, metal: 0.85, emissive: p.accent, glow: 1.1, skin: true });
            // Per-id hair colour drift makes each summoned Eris subtly unique.
            const hairCol = new THREE.Color(p.hairColor).lerp(this.color, 0.35);
            this.matHair  = this._mat(hairCol.getHex(), { rough: 0.35, metal: 0.55, emissive: p.hairColor, glow: 0.35, skin: true });
            this.matHairTip = this._mat(p.hairTip, { rough: 0.3, metal: 0.4, emissive: p.hairTip, glow: 0.7 });
            this.matDiscord = this._mat(p.discord, { rough: 0.4, emissive: p.discord, glow: 0.8 });

            // ── Gown (LatheGeometry silhouette) ───────────────────────────────
            const gownPts = [
                [0.02, 0.0], [0.98, 0.02], [0.86, 0.30], [0.66, 0.72], [0.52, 1.12],
                [0.44, 1.50], [0.47, 1.86], [0.50, 2.16], [0.40, 2.42], [0.20, 2.60],
                [0.13, 2.74]
            ].map(([x, y]) => new THREE.Vector2(x, y));
            const gownGeo = new THREE.LatheGeometry(gownPts, 28);
            this.body = new THREE.Mesh(gownGeo, this.matGown);
            this.bodyGroup.add(this.body);

            // Gold waist band + hem trim + collar.
            const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.45, 0.12, 28), this.matTrim);
            band.position.y = 1.48; this.bodyGroup.add(band);
            const hemTrim = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.99, 0.07, 30, 1, true), this.matTrim);
            hemTrim.position.y = 0.04; this.bodyGroup.add(hemTrim);
            const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 20), this.matTrim);
            collar.position.set(0, 2.56, 0); collar.rotation.x = Math.PI / 2; this.bodyGroup.add(collar);

            // ── Head + face ──────────────────────────────────────────────────
            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 24), this.matSkin);
            skull.scale.set(0.92, 1.05, 0.95);
            this.head.add(skull);
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 14), this.matSkin);
            neck.position.y = -0.28; this.head.add(neck);
            // Serene glowing eyes (thin lens shapes), brightened during attacks.
            this.eyes = [];
            for (const sx of [-1, 1]) {
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), this._mat(p.accent, { rough: 0.2, emissive: p.accent, glow: 0.9 }));
                eye.scale.set(1.0, 0.5, 0.6);
                eye.position.set(sx * 0.105, 0.02, 0.235);
                this.head.add(eye); this.eyes.push(eye);
            }
            // Soft lips + brow hint for a little more facial detail.
            const lips = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), this._mat(0xd98a7a, { rough: 0.5 }));
            lips.scale.set(1.1, 0.4, 0.5); lips.position.set(0, -0.12, 0.25); this.head.add(lips);

            // Jewelled diadem (mapped to HORNS) - a delicate gold circlet + crest.
            this.diadem = new THREE.Group();
            const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.022, 8, 24), this.matHalo);
            circlet.rotation.x = Math.PI / 2; circlet.position.y = 0.16; this.diadem.add(circlet);
            for (let i = 0; i < 5; i++) {
                const a = (i - 2) * 0.34;
                const spire = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13 + (2 - Math.abs(i - 2)) * 0.06, 6), this.matHalo);
                spire.position.set(Math.sin(a) * 0.255, 0.24 + (2 - Math.abs(i - 2)) * 0.03, Math.cos(a) * 0.255);
                spire.rotation.x = -a * 0.2; this.diadem.add(spire);
            }
            const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), this.matDiscord);
            gem.position.set(0, 0.2, 0.255); this.diadem.add(gem);
            this.head.add(this.diadem);

            this.head.position.set(0, 3.0, 0);
            this.bodyGroup.add(this.head);

            // ── Arms (outstretched, gloved, gold cuffs) ───────────────────────
            this.leftArm = this._buildArm(-1);
            this.rightArm = this._buildArm(1);

            // ── Encircling halo ring (the great golden U from the art) ────────
            this.halo = new THREE.Group();
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 12, 48), this.matHalo);
            // dotted studs around the ring for detail.
            for (let i = 0; i < 24; i++) {
                const a = (i / 24) * Math.PI * 2;
                const stud = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), this.matHalo);
                stud.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0);
                this.halo.add(stud);
            }
            this.halo.add(ring);
            this.halo.position.set(0, 1.7, 0.15);
            this.halo.rotation.x = 0.18;
            this.bodyGroup.add(this.halo);
            this._floaters.push({ obj: this.halo, axis: 'z', speed: 0.25 });

            // Soft horizontal crown-halo above the head.
            this.crownHalo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 8, 32), this.matHalo);
            this.crownHalo.position.set(0, 3.42, 0); this.crownHalo.rotation.x = Math.PI / 2;
            this.bodyGroup.add(this.crownHalo);

            // ── Radiance core (additive bloom behind her chest) ───────────────
            this.aura = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16),
                new THREE.MeshBasicMaterial({ color: p.accent, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
            this.aura.position.set(0, 1.9, 0); this.bodyGroup.add(this.aura);

            // ── Orbiting motes (gold) + counter-orbiting discord shards (red) ──
            this.motes = new THREE.Group();
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                const r = 0.9 + (i % 3) * 0.18;
                const mo = new THREE.Mesh(new THREE.SphereGeometry(0.045 + (i % 2) * 0.02, 8, 8), this.matHairTip);
                mo.position.set(Math.cos(a) * r, 1.5 + Math.sin(a * 2) * 0.5, Math.sin(a) * r);
                this.motes.add(mo);
            }
            this.bodyGroup.add(this.motes);
            this._floaters.push({ obj: this.motes, axis: 'y', speed: 0.5 });

            this.shards = new THREE.Group();
            for (let i = 0; i < 9; i++) {
                const a = (i / 9) * Math.PI * 2;
                const r = 1.15 + (i % 2) * 0.25;
                const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.07 + (i % 3) * 0.025, 0), this.matDiscord);
                sh.position.set(Math.cos(a) * r, 1.9 + Math.cos(a * 3) * 0.45, Math.sin(a) * r);
                sh.rotation.set(a, a * 1.3, 0);
                sh._spin = 0.6 + (i % 4) * 0.3;
                this.shards.add(sh);
            }
            this.bodyGroup.add(this.shards);
            this._floaters.push({ obj: this.shards, axis: 'y', speed: -0.32 });

            // ── The great mane of living hair (the showpiece) ─────────────────
            // Three reservoirs so dismemberment maps cleanly onto Demon parts:
            //   leftSweep  -> LEFT_WING   rightSweep -> RIGHT_WING   train -> TAIL
            this.hairLeft = new THREE.Group();
            this.hairRight = new THREE.Group();
            this.hairTrain = new THREE.Group();
            this.hairCrown = new THREE.Group(); // face-framing locks, ride with HEAD
            this.head.add(this.hairCrown);
            this.bodyGroup.add(this.hairLeft, this.hairRight, this.hairTrain);
            this._growHair();

            // Body-part -> mesh map + dismemberment cascade (Demon archetype).
            this._partMeshMap = {
                HEAD: this.head, SKULL: this.head, FACE: this.head, EYES: this.head,
                HORNS: this.diadem,
                TORSO: this.body, BODY: this.body, CORE: this.body,
                LEFT_WING: this.hairLeft, RIGHT_WING: this.hairRight, TAIL: this.hairTrain,
                LEFT_ARM: this.leftArm, RIGHT_ARM: this.rightArm
            };
            this._cascadeRules = [
                { gone: ['TORSO', 'BODY', 'CORE'], hide: [this.body, this.head, this.leftArm, this.rightArm, this.halo, this.hairLeft, this.hairRight, this.hairTrain] },
                { gone: ['HEAD', 'SKULL'], hide: [this.head, this.diadem, this.crownHalo] },
                { gone: ['HORNS'], hide: [this.diadem] },
                { gone: ['LEFT_WING'], hide: [this.hairLeft] },
                { gone: ['RIGHT_WING'], hide: [this.hairRight] },
                { gone: ['TAIL'], hide: [this.hairTrain] }
            ];
        }

        _buildArm(side) {
            const g = new THREE.Group();
            const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.62, 12), this.matGlove);
            upper.position.y = -0.31; g.add(upper);
            const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.05, 0.58, 12), this.matGlove);
            fore.position.y = -0.9; g.add(fore);
            // Gold cuffs (the banded gloves in the art).
            for (const cy of [-0.02, -0.62, -1.18]) {
                const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 14), this.matTrim);
                cuff.position.y = cy; cuff.rotation.x = Math.PI / 2; g.add(cuff);
            }
            // Open hand (palm + splayed fingers, echoing the reaching pose).
            const hand = new THREE.Group();
            const palm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), this.matSkin);
            palm.scale.set(1.0, 1.1, 0.5); hand.add(palm);
            for (let f = 0; f < 4; f++) {
                const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.14, 6), this.matSkin);
                fin.position.set((f - 1.5) * 0.035, -0.1, 0.02); fin.rotation.x = 0.2; hand.add(fin);
            }
            const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.1, 6), this.matSkin);
            thumb.position.set(side * 0.07, -0.04, 0.02); thumb.rotation.z = side * 0.8; hand.add(thumb);
            hand.position.y = -1.2; g.add(hand);
            g._hand = hand;

            // Shoulder anchor, arms spread wide and slightly down (welcoming/judging).
            g.position.set(side * 0.34, 2.34, 0.04);
            g.rotation.z = side * 1.12;
            g.rotation.x = -0.12;
            g._side = side;
            g._restZ = g.rotation.z;
            g._restX = g.rotation.x;
            this.bodyGroup.add(g);
            return g;
        }

        // One segmented hair strand: a chain of tapering joints that we bend with
        // a travelling sine wave each frame, so the whole mane flows.
        _strand(reservoir, root, dir, len, segs, thick, tipFade) {
            const strand = new THREE.Group();
            let joint = strand;
            const segLen = len / segs;
            const mats = [this.matHair, this.matHair, this.matHairTip];
            for (let s = 0; s < segs; s++) {
                const f = s / segs;
                const r0 = thick * (1 - f * 0.7);
                const r1 = thick * (1 - (f + 1 / segs) * 0.7);
                const mat = (tipFade && f > 0.65) ? this.matHairTip : this.matHair;
                const seg = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(r1, 0.006), Math.max(r0, 0.008), segLen, 6), mat);
                seg.position.y = -segLen / 2;
                const pivot = new THREE.Group();
                pivot.position.y = (s === 0) ? 0 : -segLen;
                pivot.add(seg);
                pivot._rest = 0;
                joint.add(pivot);
                joint = pivot;
            }
            strand.position.copy(root);
            // Aim the strand outward/down.
            strand.rotation.z = dir.z;
            strand.rotation.x = dir.x;
            reservoir.add(strand);
            return strand;
        }

        _growHair() {
            const rnd = () => this.idRand();
            // Crown locks frame the face (ride with the head group).
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const root = new THREE.Vector3(Math.cos(a) * 0.24, 0.18, Math.sin(a) * 0.18);
                const dir = { z: -Math.cos(a) * 0.5, x: 0.2 + rnd() * 0.2 };
                const st = this._strand(this.hairCrown, root, dir, 0.5 + rnd() * 0.3, 5, 0.05, true);
                this._registerStrand(st, 0.9 + rnd(), 0.18);
            }
            // Two great side-sweeps (the wing-like fans) -> LEFT/RIGHT_WING.
            const makeSweep = (reservoir, side) => {
                for (let i = 0; i < 22; i++) {
                    const t = i / 21;
                    // roots run from the crown down past the shoulder.
                    const ry = 3.05 - t * 0.5;
                    const root = new THREE.Vector3(side * (0.16 + t * 0.12), ry, -0.05 - rnd() * 0.1);
                    // Mostly cascades DOWN with only a gentle outward fan, so the
                    // mane reads as a tall flowing veil (not a horizontal star) and
                    // the model's bounding box stays narrow -> the fit-clamp lets
                    // her render at full towering height.
                    const spread = 0.18 + t * 0.45;
                    const dir = { z: side * spread, x: 0.12 + rnd() * 0.28 };
                    const len = 2.6 + t * 1.7 + rnd() * 0.5; // long, reaching toward the floor
                    const st = this._strand(reservoir, root, dir, len, 9, 0.07, true);
                    this._registerStrand(st, 0.6 + rnd() * 0.9, 0.20 + t * 0.10, side);
                }
            };
            makeSweep(this.hairLeft, -1);
            makeSweep(this.hairRight, 1);
            // Central trailing train -> TAIL (longest, falls straight behind).
            for (let i = 0; i < 16; i++) {
                const root = new THREE.Vector3((rnd() - 0.5) * 0.5, 2.95 - rnd() * 0.3, -0.18 - rnd() * 0.12);
                const dir = { z: (rnd() - 0.5) * 0.2, x: 0.05 + rnd() * 0.15 };
                const len = 2.8 + rnd() * 1.2;
                const st = this._strand(this.hairTrain, root, dir, len, 11, 0.075, true);
                this._registerStrand(st, 0.5 + rnd() * 0.7, 0.16);
            }
        }

        _registerStrand(strand, phase, sway, side) {
            const pivots = [];
            strand.traverse(o => { if (o._rest !== undefined) pivots.push(o); });
            this._hair.push({ strand, pivots, phase: phase * 6.28, sway, side: side || 0 });
        }

        //---------------------------------------------------------------------
        // Animation
        //---------------------------------------------------------------------
        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime;
            const anim = this.currentAnimation;
            const fast = (anim === 'attack' || anim === 'specialattack');

            // Discord instability ramps with the battle turn count.
            const ins = this._instab = this._turnInstability();

            // Spawn: rise + radiance bloom.
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.95);
            this.applyModelScale(growth);

            // Gentle divine hover + hit jolt, plus a turn-driven shudder/drift.
            const hitJolt = anim === 'hit' ? Math.sin(t * 22) * Math.exp(-t * 6) * 0.09 : 0;
            const jz = ins > 0 ? (Math.sin(t * 31) + Math.sin(t * 19.3 + 1.7)) * 0.5 * 0.06 * ins : 0;
            this.model.rotation.z = hitJolt + jz;
            this.model.rotation.y = ins > 0 ? Math.sin(t * 23 + 0.5) * 0.05 * ins : 0;
            if (this._baseX === null) this._baseX = this.model.position.x;
            this.model.position.x = this._baseX + (ins > 0 ? Math.sin(t * 27) * 0.13 * ins : 0);
            this.model.position.y = this._baseY + this._rise + Math.sin(t * 1.1) * 0.07 * this.scale
                + (ins > 0 ? Math.sin(t * 21 + 2) * 0.10 * ins : 0);

            // Head: serene drift, tilts down when passing judgment (attack).
            if (this.head && this.head.visible) {
                this.head.rotation.y = Math.sin(t * 0.9) * 0.1;
                this.head.rotation.x = (anim === 'attack') ? -0.18 * Math.max(0, Math.sin(Math.min(t * 6, Math.PI))) : Math.sin(t * 0.7) * 0.04;
            }

            // Eyes flare during attacks.
            const eyeGlow = fast ? 2.2 : (0.8 + Math.sin(t * 1.6) * 0.2);
            this.eyes.forEach(e => { if (e.material) e.material.emissiveIntensity = eyeGlow; });

            // Halo / motes / shards spinners.
            this._floaters.forEach(f => {
                if (!f.obj.visible) return;
                f.obj.rotation[f.axis] += f.speed * deltaTime * (fast ? 2.2 : 1.0);
            });
            if (this.shards && this.shards.visible) {
                const surge = anim === 'specialattack' ? 1 + Math.sin(Math.min(t * 4, Math.PI)) * 0.45 : 1;
                this.shards.children.forEach((s, i) => {
                    s.rotation.x += (s._spin || 0.6) * deltaTime;
                    s.rotation.y += (s._spin || 0.6) * 0.7 * deltaTime;
                    s.scale.setScalar(surge);
                });
            }
            // Halo + aura brighten with channelled power.
            const haloGlow = (anim === 'specialattack' ? 2.4 : 1.1) + Math.sin(t * 4) * 0.4;
            if (this.matHalo) this.matHalo.emissiveIntensity = haloGlow;
            if (this.aura) {
                this.aura.material.opacity = (anim === 'specialattack' ? 0.42 : 0.18) + Math.sin(t * 3) * 0.06;
                const ap = 1 + (anim === 'specialattack' ? Math.sin(Math.min(t * 3, Math.PI)) * 0.6 : 0) + Math.sin(t * 2) * 0.05;
                this.aura.scale.setScalar(ap);
            }
            if (this.crownHalo) this.crownHalo.rotation.z += deltaTime * 0.4;

            // Arms.
            this._animateArms(t, anim);

            // The living mane.
            this._animateHair(t, anim, ins);

            // Discord destabilisation: drift parts, warp the form, flicker light.
            this._applyInstability(t, ins);
        }

        // The longer she fights, the less her form holds together: limbs and hair
        // drift off their anchors, the gown warps, and her light flickers between
        // gold order and crimson chaos. Everything is keyed off `ins` so at ins=0
        // the model snaps perfectly back to rest.
        _applyInstability(t, ins) {
            if (!this._jitterBases) {
                this._jitterBases = [];
                const add = (obj, seed) => { if (obj) this._jitterBases.push({ obj, base: obj.position.clone(), seed }); };
                add(this.head, 0.0); add(this.diadem, 1.1);
                add(this.leftArm, 2.0); add(this.rightArm, 3.3);
                add(this.halo, 4.2); add(this.crownHalo, 5.1);
                add(this.hairLeft, 6.0); add(this.hairRight, 7.4); add(this.hairTrain, 8.8);
            }
            // Restore -> offset every jitter target (works as a no-op when ins==0).
            for (const j of this._jitterBases) {
                const s = j.seed, a = ins * 0.09;
                j.obj.position.set(
                    j.base.x + Math.sin(t * 17 + s) * a,
                    j.base.y + Math.sin(t * 13 + s * 1.7) * a,
                    j.base.z + Math.sin(t * 23 + s * 0.6) * a
                );
            }
            // Form warps abstractly (non-uniform pulsing of gown + head).
            if (this.body) {
                const w = ins * 0.16;
                this.body.scale.set(1 + Math.sin(t * 11) * w, 1 + Math.sin(t * 7 + 1) * w, 1 + Math.sin(t * 9 + 2) * w);
            }
            if (this.head) {
                const w = ins * 0.13;
                this.head.scale.set(1 + Math.sin(t * 15 + 1) * w, 1 + Math.sin(t * 12) * w, 1 + Math.sin(t * 18 + 2) * w);
            }
            if (ins <= 0) return;
            // Light flickers chaotically; the discord palette bleeds into the gold.
            const flick = 1 + Math.sin(t * 29) * 0.6 * ins;
            if (this.matHair) this.matHair.emissiveIntensity = 0.35 * flick;
            if (this.matHairTip) this.matHairTip.emissiveIntensity = 0.7 * flick;
            if (this.matDiscord) {
                this.matDiscord.emissiveIntensity = (0.8 + Math.sin(t * 33 + 1) * 0.7 * ins);
                // bleed crimson <-> gold.
                const mix = 0.5 + 0.5 * Math.sin(t * 5);
                if (!this._instColA) { this._instColA = new THREE.Color(); this._instColB = new THREE.Color(); }
                this._instColA.set(this.profile.discord);
                this._instColB.set(this.profile.accent);
                this.matDiscord.emissive.copy(this._instColA.lerp(this._instColB, mix * ins * 0.6));
            }
            // Shards swell and scatter as her order disintegrates.
            if (this.shards && this.shards.visible) {
                this.shards.children.forEach((sh, i) => {
                    sh.scale.setScalar(1 + ins * (0.4 + Math.sin(t * 6 + i) * 0.3));
                });
            }
        }

        _animateArms(t, anim) {
            const L = this.leftArm, R = this.rightArm;
            if (anim === 'attack') {
                // Right arm sweeps down in a verdict; left holds.
                const e = Math.max(0, Math.sin(Math.min(t * 6, Math.PI)));
                if (R && R.visible) { R.rotation.z = R._restZ + e * 0.6; R.rotation.x = R._restX - e * 0.9; }
                if (L && L.visible) { L.rotation.z = L._restZ - Math.sin(t * 2) * 0.05; L.rotation.x = L._restX; }
            } else if (anim === 'specialattack') {
                // Both arms rise to call down judgment.
                const e = Math.max(0, Math.sin(Math.min(t * 3, Math.PI)));
                [L, R].forEach(a => { if (a && a.visible) { a.rotation.z = a._restZ * (1 - e * 0.6); a.rotation.x = a._restX - e * 1.3; } });
            } else {
                // Idle: slow welcoming breath.
                const b = Math.sin(t * 1.0) * 0.06;
                if (L && L.visible) { L.rotation.z = L._restZ + b; L.rotation.x = L._restX + Math.sin(t * 0.8) * 0.04; }
                if (R && R.visible) { R.rotation.z = R._restZ - b; R.rotation.x = R._restX + Math.sin(t * 0.8 + 1) * 0.04; }
            }
        }

        _animateHair(t, anim, ins) {
            // A travelling wave runs down each strand's joint chain. During special
            // attacks the mane billows upward and outward (lift); on idle it sways.
            // Turn-driven instability adds a faster, larger, more chaotic writhe.
            ins = ins || 0;
            const fast = (anim === 'attack' || anim === 'specialattack');
            const lift = anim === 'specialattack' ? Math.max(0, Math.sin(Math.min(t * 3, Math.PI))) : 0;
            const speed = (fast ? 5.5 : 2.0) + ins * 3.5;
            for (const h of this._hair) {
                if (!h.strand.visible) continue;
                const amp = h.sway * (fast ? 1.6 : 1.0) * (1 + ins * 1.1);
                for (let i = 0; i < h.pivots.length; i++) {
                    const piv = h.pivots[i];
                    const phase = h.phase + i * 0.6;
                    // Chaotic high-frequency tremor layered on past ~turn 10.
                    const chaos = ins > 0 ? Math.sin(t * 14 + phase * 2.3 + i) * 0.18 * ins : 0;
                    // Sway about Z (sideways flow) and X (front/back undulation).
                    piv.rotation.z = Math.sin(t * speed + phase) * amp * (0.4 + i * 0.05) + chaos;
                    piv.rotation.x = piv._rest + Math.cos(t * (speed * 0.8) + phase) * amp * 0.35
                        - lift * (0.10 + i * 0.02) * (h.side === 0 ? 0.6 : 1)
                        + chaos * 0.6;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime;
            const prog = Math.min(1.0, t / 1.5);
            // Light goes out: dim every emissive, sink, bow the head, let the mane fall.
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY + this._rise - prog * (this._rise + 0.7 * this.scale);
            this.model.rotation.z = prog * 0.5;
            if (this.head) this.head.rotation.x = prog * 0.8;
            for (const m of this._materials) {
                if (m.emissiveIntensity !== undefined) m.emissiveIntensity *= (1 - prog * 0.06);
            }
            if (this.aura) this.aura.material.opacity = 0.18 * (1 - prog);
            // Mane goes limp, hanging straight down.
            for (const h of this._hair) {
                for (let i = 0; i < h.pivots.length; i++) {
                    const piv = h.pivots[i];
                    piv.rotation.z *= (1 - prog);
                    piv.rotation.x = piv._rest * (1 - prog) + prog * 0.05;
                }
            }
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new ErisBattler3D(scale, offsetY, enemy, weaponType, key);

    // Override the witch-variant stand-in registered in 3DBattler_Bosses.js.
    window.Battler3D.registerArchetype('eris', {
        aliases: ['eris', 'discordgoddess', 'judgmentofdiscord'],
        scale: E_PROFILE.eris.scale, weapon: 0, create: make
    });
    // Pin the exact enemy name too (belt and suspenders alongside <Battler3D: eris>).
    if (window.Battler3D.registerNamed) {
        window.Battler3D.registerNamed('Eris, Judgment of Discord', 'eris');
    }

    debugLog('Eris (bespoke discord-goddess model) registered');
})();
