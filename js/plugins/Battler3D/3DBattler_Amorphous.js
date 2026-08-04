//=============================================================================
// 3D Battler System - Amorphous Family
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Boneless procedural 3D battlers: floating ghosts and squishy
 * slimes. Requires 3DBattlerSystem (core) to load first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Amorphous Family
 * ============================================================================
 *
 * Skeleton-less body plans that float (ghost) or jiggle on the ground (slime).
 * No ragdoll: they fade/collapse on death. They still reuse the shared
 * part-losing engine from window.Battler3D.Base, so destroying a body part
 * hides the matching mesh and hits flash it.
 *
 * Registered archetypes:
 *   Ghost  (parts: FACE, CORE, LEFT_WISP, RIGHT_WISP)
 *   Slime  (parts: CORE, UPPER_BODY, LOWER_BODY, PSEUDOPOD_1, PSEUDOPOD_2)
 *
 * MUST load AFTER BattleSystem/3DBattlerSystem.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Amorphous] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const AMORPHOUS_PROFILES = {
        ghost: {
            variant: 'ghost', scale: 2.2, texturePool: 'pale',
            bodyColor: 0xbfe9ff, emissive: 0x2a5a78,
            hue: [0.55, 0.06], sat: [0.45, 0.15], lit: [0.78, 0.10]
        },
        slime: {
            variant: 'slime', scale: 2.0, texturePool: 'foliage',
            bodyColor: 0x3fae4a, emissive: 0x103a14,
            hue: [0.32, 0.10], sat: [0.60, 0.20], lit: [0.45, 0.12]
        },
        // ── Bespoke ghosts split from the shared 'ghost' rig ──
        amo_karaokebanshee: {
            variant: 'amo_karaokebanshee', scale: 2.2, texturePool: 'pale',
            bodyColor: 0xff9ad8, emissive: 0x7a2a5a, accent: 0xffee66,
            hue: [0.90, 0.06], sat: [0.55, 0.15], lit: [0.72, 0.10]
        },
        amo_memeghost: {
            variant: 'amo_memeghost', scale: 2.1, texturePool: 'pale',
            bodyColor: 0xd8f0ff, emissive: 0x2a4a6a, accent: 0x55ccff,
            hue: [0.55, 0.06], sat: [0.35, 0.12], lit: [0.82, 0.08]
        },
        amo_thephantom: {
            variant: 'amo_thephantom', scale: 2.2, texturePool: 'void',
            bodyColor: 0x2a2a38, emissive: 0x101018, accent: 0x8866cc,
            hue: [0.72, 0.06], sat: [0.30, 0.10], lit: [0.30, 0.08]
        },
        // ── Bespoke slimes split from the shared 'slime' rig ──
        amo_blick: {
            variant: 'amo_blick', scale: 2.2, texturePool: 'void',
            bodyColor: 0x5a3a7a, emissive: 0x2a103a, accent: 0xbb44ff,
            hue: [0.76, 0.08], sat: [0.55, 0.18], lit: [0.42, 0.12]
        },
        amo_kingslime: {
            variant: 'amo_kingslime', scale: 2.6, texturePool: 'foliage',
            bodyColor: 0x2f9ad8, emissive: 0x103a5a, accent: 0xffe066,
            hue: [0.55, 0.08], sat: [0.60, 0.18], lit: [0.48, 0.12]
        }
    };

    class AmorphousBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = AMORPHOUS_PROFILES[creatureType] || AMORPHOUS_PROFILES.slime;
            super(scale, offsetY, battler, profile, 0, creatureType || 'slime');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
        }

        async load(physicsWorld, startX = 0, startY = 0, startZ = 0) {
            this.physicsWorld = physicsWorld; // unused (no ragdoll) but kept for parity
            switch (this.variant) {
                case 'ghost':              this._buildGhost(); break;
                case 'amo_karaokebanshee': this._buildKaraokeBanshee(); break;
                case 'amo_memeghost':      this._buildMemeGhost(); break;
                case 'amo_thephantom':     this._buildThePhantom(); break;
                case 'amo_blick':          this._buildBlick(); break;
                case 'amo_kingslime':      this._buildKingSlime(); break;
                default:                   this._buildSlime(); break;
            }

            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        _mat(color, emissive, opacity) {
            const m = new THREE.MeshStandardMaterial({
                color, emissive: emissive || 0x000000, roughness: 0.5,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity)
            });
            this._materials.push(m);
            return m;
        }

        _buildGhost() {
            const p = this.profile;
            const bodyMat = this.applySkin(this._mat(p.bodyColor, p.emissive, 0.72));

            // Core: rounded head/body that tapers into a wispy tail.
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), bodyMat);
            this.core.position.y = 0.9;
            this.core.scale.set(1.0, 1.15, 1.0);
            this.bodyGroup.add(this.core);
            const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 14), bodyMat);
            tail.position.y = 0.45; tail.rotation.x = Math.PI; // point down
            this.core.add(tail);
            tail.position.set(0, -0.55, 0);

            // Face: a darker plate with two hollow eyes + a mouth on the front.
            this.face = new THREE.Group();
            const eyeMat = this._mat(0x111122, 0x000000, 0.9);
            const leftEye  = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat); leftEye.position.set(-0.15, 0.05, 0.4);
            const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat); rightEye.position.set(0.15, 0.05, 0.4);
            const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), eyeMat); mouth.position.set(0, -0.18, 0.4); mouth.scale.set(1.4, 1.0, 0.6);
            this.face.add(leftEye, rightEye, mouth);
            this.face.position.y = 0.9;
            this.bodyGroup.add(this.face);

            // Wisps: two trailing arm tendrils.
            this.leftWisp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 10), bodyMat);
            this.leftWisp.position.set(-0.5, 0.8, 0); this.leftWisp.rotation.z = 0.5;
            this.bodyGroup.add(this.leftWisp);
            this.rightWisp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 10), bodyMat);
            this.rightWisp.position.set(0.5, 0.8, 0); this.rightWisp.rotation.z = -0.5;
            this.bodyGroup.add(this.rightWisp);

            this._partMeshMap = {
                FACE: this.face, CORE: this.core,
                LEFT_WISP: this.leftWisp, RIGHT_WISP: this.rightWisp,
            };
            this._cascadeRules = [
                // Core destroyed -> the apparition disperses entirely.
                { gone: ['CORE'], hide: [this.core, this.face, this.leftWisp, this.rightWisp] },
                { gone: ['FACE'], hide: [this.face] },
                { gone: ['LEFT_WISP'],  hide: [this.leftWisp] },
                { gone: ['RIGHT_WISP'], hide: [this.rightWisp] },
            ];
        }

        _buildSlime() {
            const p = this.profile;
            const bodyMat = this.applySkin(this._mat(p.bodyColor, p.emissive, 0.85));

            // Stacked squishy blobs: lower (wide) + upper (smaller) + core nucleus.
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 14), bodyMat);
            this.lowerBody.position.y = 0.45; this.lowerBody.scale.set(1.1, 0.8, 1.1);
            this.bodyGroup.add(this.lowerBody);

            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 14), bodyMat);
            this.upperBody.position.y = 0.95; this.upperBody.scale.set(1.0, 0.95, 1.0);
            this.bodyGroup.add(this.upperBody);

            // Core nucleus (slightly darker, suspended inside).
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), this._mat(p.emissive, p.emissive, 0.95));
            this.core.position.y = 0.6;
            this.bodyGroup.add(this.core);

            // Eyes for character.
            const eyeMat = this._mat(0x111111, 0x000000, 1.0);
            const le = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeMat); le.position.set(-0.16, 1.0, 0.36);
            const re = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeMat); re.position.set(0.16, 1.0, 0.36);
            this.upperBody.add(le, re);

            // Pseudopods: small blobs budding from the sides.
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), bodyMat);
            this.pseudopod1.position.set(-0.6, 0.35, 0.1); this.pseudopod1.scale.set(1.0, 0.7, 1.0);
            this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), bodyMat);
            this.pseudopod2.position.set(0.6, 0.35, -0.1); this.pseudopod2.scale.set(1.0, 0.7, 1.0);
            this.bodyGroup.add(this.pseudopod2);

            this._partMeshMap = {
                CORE: this.core, UPPER_BODY: this.upperBody, LOWER_BODY: this.lowerBody,
                PSEUDOPOD_1: this.pseudopod1, PSEUDOPOD_2: this.pseudopod2,
            };
            this._cascadeRules = [
                // Core destroyed -> the slime collapses.
                { gone: ['CORE'], hide: [this.core, this.upperBody, this.lowerBody, this.pseudopod1, this.pseudopod2] },
                { gone: ['UPPER_BODY'], hide: [this.upperBody] },
                { gone: ['LOWER_BODY'], hide: [this.lowerBody] },
                { gone: ['PSEUDOPOD_1'], hide: [this.pseudopod1] },
                { gone: ['PSEUDOPOD_2'], hide: [this.pseudopod2] },
            ];
        }

        // ── Karaoke Banshee: a pink diva ghost belting into a spectral mic ──
        _buildKaraokeBanshee() {
            const p = this.profile;
            this._buildGhost();
            // Wide-open singing mouth (stretch the mouth mesh tall).
            this.face.children[2].scale.set(1.2, 2.2, 0.6); this.face.children[2].position.y = -0.16;
            // Spectral microphone held in front.
            this.mic = new THREE.Group();
            const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), this._mat(0x222228, 0x000000, 1.0)); this.mic.add(stick);
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), this._mat(0x888890, 0x111111, 1.0)); ball.position.y = 0.26; this.mic.add(ball);
            this.mic.position.set(0.05, 0.9, 0.55); this.mic.rotation.z = -0.35; this.bodyGroup.add(this.mic);
            // Radiating sound-note rings from the mouth (off-key waves).
            this.notes = new THREE.Group();
            for (let i = 0; i < 5; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16 + i * 0.12, 0.02, 6, 20), this._mat(p.accent, p.accent, 0.6 - i * 0.1)); ring.position.set(0, 0.85, 0.5); ring._i = i; this.notes.add(ring); }
            this.bodyGroup.add(this.notes);
            this._cascadeRules[0].hide.push(this.mic, this.notes);
        }

        // ── Meme Ghost: a phone-glow spirit projecting a screen "meme" plate ─
        _buildMemeGhost() {
            const p = this.profile;
            this._buildGhost();
            // A glowing rectangular "screen" it holds up (the outdated meme).
            this.screen = new THREE.Group();
            const panel = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.03), this._mat(0x141820, p.accent, 1.0)); this.screen.add(panel);
            const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.26), this._mat(p.accent, p.accent, 0.85)); glow.position.z = 0.02; this.screen.add(glow);
            this.screen.position.set(0, 0.85, 0.55); this.bodyGroup.add(this.screen);
            // Floating pixel motes (scrolling feed) around it.
            this.pixels = new THREE.Group();
            for (let i = 0; i < 8; i++) { const px = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), this._mat(p.accent, p.accent, 0.8)); px.position.set((this.idRand() - 0.5) * 0.9, 0.5 + this.idRand() * 0.9, 0.4 + this.idRand() * 0.3); px._t = this.idRand(); this.pixels.add(px); }
            this.bodyGroup.add(this.pixels);
            this._cascadeRules[0].hide.push(this.screen, this.pixels);
        }

        // ── The Phantom: a near-invisible silent killer, only a faint mask ──
        _buildThePhantom() {
            const p = this.profile;
            this._buildGhost();
            // Barely-there body.
            if (this.core.material) this.core.material.opacity = 0.28;
            this.leftWisp.visible = false; this.rightWisp.visible = false; // no telltale arms
            // A pale floating mask standing in for the face.
            this.mask = new THREE.Group();
            const plate = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), this._mat(0xe8e4ec, 0x222228, 0.9)); plate.rotation.x = Math.PI / 2; plate.position.z = 0.1; this.mask.add(plate);
            // Cold slit eyes on the mask.
            for (const mx of [-0.09, 0.09]) { const slit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), this._mat(p.accent, p.accent, 1.0)); slit.position.set(mx, 0.02, 0.22); this.mask.add(slit); }
            this.mask.position.set(0, 0.95, 0.28); this.bodyGroup.add(this.mask);
            // Route FACE dismemberment to the mask; hide the base face.
            this.face.visible = false;
            this._partMeshMap.FACE = this.mask;
            this._cascadeRules[1] = { gone: ['FACE'], hide: [this.mask] };
            this._cascadeRules[0].hide.push(this.mask);
        }

        // ── Blick: a cyclopean ooze with one entropy-beam eye ──────────────
        _buildBlick() {
            const p = this.profile;
            this._buildSlime();
            // Remove the pair of small eyes; add one huge central eye.
            this.upperBody.children.forEach(c => { c.visible = false; });
            this.bigEye = new THREE.Group();
            const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16), this._mat(0xf0e8f4, 0x000000, 1.0)); this.bigEye.add(sclera);
            const iris = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), this._mat(p.accent, p.accent, 1.0)); iris.position.z = 0.16; this.bigEye.add(iris);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), this._mat(0x000000, 0x000000, 1.0)); pupil.position.z = 0.25; this.bigEye.add(pupil);
            this.bigEye.position.set(0, 1.0, 0.34); this.upperBody.add(this.bigEye);
            // Entropy beam stub charging in front of the eye.
            this.beam = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 10), this._mat(p.accent, p.accent, 0.5)); this.beam.rotation.x = Math.PI / 2; this.beam.position.set(0, 1.0, 0.7); this.beam.visible = false; this.bodyGroup.add(this.beam);
            this._cascadeRules[0].hide.push(this.beam);
        }

        // ── King Slime: a colossal crowned slime monarch ───────────────────
        _buildKingSlime() {
            const p = this.profile;
            this._buildSlime();
            // Bulk up the body.
            this.lowerBody.scale.set(1.4, 1.0, 1.4);
            this.upperBody.scale.set(1.25, 1.1, 1.25);
            // A golden crown perched on top.
            this.crown = new THREE.Group();
            const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.12, 12), this._mat(p.accent, 0x4a3a00, 1.0)); this.crown.add(band);
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), this._mat(p.accent, 0x4a3a00, 1.0)); spike.position.set(Math.cos(a) * 0.28, 0.14, Math.sin(a) * 0.28); this.crown.add(spike); }
            this.crown.position.set(0, 1.45, 0); this.bodyGroup.add(this.crown);
            // Lesser blobs it commands, budding around the base.
            this.minions = new THREE.Group();
            for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), this.lowerBody.material); b.position.set(Math.cos(a) * 0.75, 0.2, Math.sin(a) * 0.75); b.scale.set(1, 0.7, 1); b._a = a; this.minions.add(b); }
            this.bodyGroup.add(this.minions);
            this._cascadeRules[0].hide.push(this.crown, this.minions);
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime;
            let growth = 1.0;
            if (this.currentAnimation === 'spawn') growth = Math.min(1.0, t / 0.7);
            this.applyModelScale(growth);

            switch (this.variant) {
                case 'ghost':              this._animateGhost(t); break;
                case 'amo_karaokebanshee': this._animateGhost(t); this._animateKaraokeBanshee(t); break;
                case 'amo_memeghost':      this._animateGhost(t); this._animateMemeGhost(t); break;
                case 'amo_thephantom':     this._animateGhost(t); this._animateThePhantom(t); break;
                case 'amo_blick':          this._animateSlime(t); this._animateBlick(t); break;
                case 'amo_kingslime':      this._animateSlime(t); this._animateKingSlime(t); break;
                default:                   this._animateSlime(t); break;
            }
        }

        _animateKaraokeBanshee(t) {
            const fast = (this.currentAnimation === 'attack' || this.currentAnimation === 'specialattack');
            if (this.face && this.face.children[2]) this.face.children[2].scale.y = 2.2 + Math.sin(t * (fast ? 14 : 6)) * 0.8; // belting
            if (this.notes) this.notes.children.forEach(r => { const phase = (t * (fast ? 1.6 : 0.8) + r._i * 0.3) % 1; const s = 0.4 + phase * 1.8; r.scale.setScalar(s); if (r.material) r.material.opacity = (0.6 - r._i * 0.08) * (1 - phase); });
            if (this.mic) this.mic.rotation.z = -0.35 + Math.sin(t * 3) * 0.1;
        }

        _animateMemeGhost(t) {
            if (this.screen) this.screen.rotation.y = Math.sin(t * 1.2) * 0.2;
            if (this.pixels) this.pixels.children.forEach(px => { px.position.y += 0.006; if (px.position.y > 1.5) px.position.y = 0.4; });
        }

        _animateThePhantom(t) {
            // Fades in and out, nearly vanishing.
            const op = 0.15 + Math.abs(Math.sin(t * 1.1)) * 0.25;
            if (this.core && this.core.material) this.core.material.opacity = op * 0.5;
            if (this.mask) this.mask.rotation.y = Math.sin(t * 0.9) * 0.2;
        }

        _animateBlick(t) {
            const fast = (this.currentAnimation === 'attack' || this.currentAnimation === 'specialattack');
            if (this.bigEye) { this.bigEye.rotation.y = Math.sin(t * 1.6) * 0.4; this.bigEye.rotation.x = Math.cos(t * 1.2) * 0.2; }
            if (this.beam) { this.beam.visible = fast && Math.sin(t * 8) > 0.3; this.beam.scale.z = 1 + Math.abs(Math.sin(t * 10)) * 0.6; }
        }

        _animateKingSlime(t) {
            if (this.crown) this.crown.position.y = 1.45 + Math.sin(t * 2) * 0.05;
            if (this.minions) this.minions.children.forEach((b, i) => { b.position.y = 0.2 + Math.abs(Math.sin(t * 3 + i)) * 0.08; });
        }

        _animateGhost(t) {
            // Bob up and down, drift side to side, wave the wisps, pulse glow.
            let bob = Math.sin(t * 1.6) * 0.12;
            let drift = Math.sin(t * 0.9) * 0.06;
            if (this.currentAnimation === 'attack') { bob += Math.sin(t * 8) * 0.12; }
            else if (this.currentAnimation === 'specialattack') { bob += Math.sin(t * 11) * 0.2; }
            else if (this.currentAnimation === 'hit') { drift += Math.sin(t * 26) * Math.exp(-t * 6) * 0.18; }
            this.model.position.y = this._baseY + bob * this.scale;
            this.model.rotation.z = drift;

            if (this.leftWisp && this.leftWisp.visible)  this.leftWisp.rotation.z = 0.5 + Math.sin(t * 3) * 0.25;
            if (this.rightWisp && this.rightWisp.visible) this.rightWisp.rotation.z = -0.5 - Math.sin(t * 3) * 0.25;

            const glow = 0.6 + Math.sin(t * 2.5) * 0.25;
            if (this.core && this.core.material) this.core.material.emissive.setRGB(0.16 * glow, 0.35 * glow, 0.47 * glow);
        }

        _animateSlime(t) {
            // Squash-and-stretch jiggle; periodic hop when attacking.
            let squash = Math.sin(t * 3.0) * 0.08;
            if (this.currentAnimation === 'attack') squash += Math.abs(Math.sin(t * 7)) * 0.22;
            else if (this.currentAnimation === 'specialattack') squash += Math.abs(Math.sin(t * 10)) * 0.3;
            else if (this.currentAnimation === 'hit') squash += Math.sin(t * 24) * Math.exp(-t * 6) * 0.25;

            const sy = 1.0 - squash;
            const sxz = 1.0 + squash * 0.6;
            if (this.lowerBody && this.lowerBody.visible) this.lowerBody.scale.set(1.1 * sxz, 0.8 * sy, 1.1 * sxz);
            if (this.upperBody && this.upperBody.visible) this.upperBody.scale.set(1.0 * sxz, 0.95 * sy, 1.0 * sxz);

            if (this.core && this.core.visible) {
                this.core.position.y = 0.6 + Math.sin(t * 3.0) * 0.05;
            }
            if (this.pseudopod1 && this.pseudopod1.visible) this.pseudopod1.position.x = -0.6 - Math.sin(t * 2.4) * 0.06;
            if (this.pseudopod2 && this.pseudopod2.visible) this.pseudopod2.position.x = 0.6 + Math.sin(t * 2.4) * 0.06;
        }

        deathPose(deltaTime) {
            const t = this.animTime;
            const prog = Math.min(1.0, t / 1.1);
            const op = 1.0 - prog;
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, op);

            if (this.variant === 'ghost') {
                // Drift upward and disperse.
                if (this._baseY === null) this._baseY = this.model.position.y;
                this.model.position.y = this._baseY + prog * 0.6 * this.scale;
            } else {
                // Slime melts into a puddle.
                const flat = 1.0 - prog * 0.9;
                this.model.scale.set(this.scale * (1.0 + prog * 0.4), this.scale * flat, this.scale * (1.0 + prog * 0.4));
            }
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new AmorphousBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    reg('ghost', {
        aliases: ['ghost', 'ghosts', 'spectre', 'specter', 'spirit', 'wraith', 'phantom', 'apparition', 'wisp', 'shade', 'spectral', 'soul', 'poltergeist', 'banshee', 'haunt', 'shadow', 'shades', 'shroud', 'phantasm', 'specters', 'wisps'],
        scale: AMORPHOUS_PROFILES.ghost.scale, weapon: 0, create: make
    });
    reg('slime', {
        aliases: ['slime', 'slimes', 'ooze', 'jelly', 'blob', 'gel'],
        scale: AMORPHOUS_PROFILES.slime.scale, weapon: 0, create: make
    });
    const P = AMORPHOUS_PROFILES;
    reg('amo_karaokebanshee', { aliases: ['amo_karaokebanshee'], scale: P.amo_karaokebanshee.scale, weapon: 0, create: make });
    reg('amo_memeghost',      { aliases: ['amo_memeghost'],      scale: P.amo_memeghost.scale,      weapon: 0, create: make });
    reg('amo_thephantom',     { aliases: ['amo_thephantom'],     scale: P.amo_thephantom.scale,     weapon: 0, create: make });
    reg('amo_blick',          { aliases: ['amo_blick'],          scale: P.amo_blick.scale,          weapon: 0, create: make });
    reg('amo_kingslime',      { aliases: ['amo_kingslime'],      scale: P.amo_kingslime.scale,      weapon: 0, create: make });

    // Repin the bespoke names off the shared ghost/slime rigs. These same names
    // are also assigned to ghost/slime in 3DBattler_Bosses.js, which loads AFTER
    // this file; defer so our per-enemy models win the exact-name lookup.
    const NAMED = {
        amo_karaokebanshee: ["Karaoke Banshee"],
        amo_memeghost:      ["Meme Ghost"],
        amo_thephantom:     ["The Phantom"],
        amo_blick:          ["Blick"],
        amo_kingslime:      ["King Slime"]
    };
    if (window.Battler3D.registerNamed) {
        setTimeout(() => {
            for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
        }, 0);
    }

    debugLog('Amorphous family registered');
})();
