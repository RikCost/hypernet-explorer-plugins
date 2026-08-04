//=============================================================================
// 3D Battler System - Sprout Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke plant one-off models (squeaky turnip fiend, totemic
 * sprout, barkhide bruiser) + name-based assignment. Requires 3DBattlerSystem
 * + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Sprout Uniques
 * ============================================================================
 *
 * Distinct procedural plant-folk shaped from each enemy's flavour text, pinned
 * by exact name. They map the Plant archetype keys (FLOWER/STEM/ROOTS/VINE_1/
 * VINE_2) so dismemberment works.
 *
 * Registered: squeakyturnip, totemicsprout, barkhidebruiser
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Sprouts] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const P_PROFILES = {
        squeakyturnip:   { variant: 'squeakyturnip',   scale: 1.7, texturePool: 'pale', bodyColor: 0xf0e8d8, accent: 0xaa66cc, hue: [0.12, 0.05], sat: [0.12, 0.06], lit: [0.80, 0.06] },
        totemicsprout:   { variant: 'totemicsprout',   scale: 1.9, texturePool: 'wood', bodyColor: 0x8a6a40, accent: 0x66cc66, hue: [0.10, 0.04], sat: [0.40, 0.10], lit: [0.42, 0.08] },
        barkhidebruiser: { variant: 'barkhidebruiser', scale: 2.3, texturePool: 'wood', bodyColor: 0x6a5236, accent: 0x4a7a3a, hue: [0.09, 0.04], sat: [0.40, 0.10], lit: [0.36, 0.08] }
    };

    class SproutBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = P_PROFILES[creatureType] || P_PROFILES.squeakyturnip;
            super(scale, offsetY, battler, profile, 0, creatureType || 'squeakyturnip');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            this.facingYaw = 0;
        }

        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.7 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.6 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity)
            });
            this._materials.push(m);
            return m;
        }
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.7 : rough)); }
        _eye(parent, x, y, z, r, accent) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), this._mat(0xffffff, 1.0, 0.2));
            eye.position.set(x, y, z);
            const pup = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 6, 6), this._mat(accent || 0x111111, 1.0, 0.2, accent === 0x111111 ? null : accent)); pup.position.set(0, 0, r * 0.6); eye.add(pup);
            parent.add(eye); return eye;
        }
        _vine(side, mat, yTop) {
            const g = new THREE.Group(); let py = 0;
            for (let i = 0; i < 4; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(0.08 - i * 0.01, 8, 8), mat); seg.position.set(side * 0.05 * i, py, 0); py -= 0.16; g.add(seg); }
            g.position.set(side * 0.28, yTop || 1.0, 0); g._side = side; this.bodyGroup.add(g); return g;
        }
        _rootCluster(mat) {
            const g = new THREE.Group();
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const root = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 5), mat); root.position.set(Math.cos(a) * 0.18, 0.12, Math.sin(a) * 0.18); root.rotation.x = Math.PI; root.rotation.z = Math.cos(a) * 0.4; g.add(root); }
            this.bodyGroup.add(g); return g;
        }
        _wirePlant(extra) {
            extra = (extra || []).filter(Boolean);
            this._partMeshMap = { FLOWER: this.flower, STEM: this.stem, ROOTS: this.roots, VINE_1: this.vine1, VINE_2: this.vine2 };
            this._cascadeRules = [
                { gone: ['STEM', 'CORE', 'BODY', 'TRUNK'], hide: [this.stem, this.flower, this.roots, this.vine1, this.vine2, ...extra] },
                { gone: ['FLOWER', 'CROWN', 'HEAD'], hide: [this.flower] },
                { gone: ['ROOTS'], hide: [this.roots] },
                { gone: ['VINE_1'], hide: [this.vine1] },
                { gone: ['VINE_2'], hide: [this.vine2] },
            ];
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'totemicsprout':   this._buildTotemicSprout(); break;
                case 'barkhidebruiser': this._buildBarkhide(); break;
                default:                this._buildTurnip(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Squeaky Turnip Fiend: a goofy turnip on tiny legs ──────────────
        _buildTurnip() {
            const p = this.profile;
            const flesh = this._skinMat(p.bodyColor, 0.6);
            // Bulb body (STEM slot).
            this.stem = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), flesh); this.stem.position.set(0, 0.75, 0); this.stem.scale.set(1, 1.1, 1); this.bodyGroup.add(this.stem);
            // Purple ridges.
            for (let i = 0; i < 4; i++) { const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.4 - i * 0.02, 0.02, 6, 14, Math.PI), this._mat(p.accent, 1, 0.5)); ridge.position.set(0, 0.9 - i * 0.08, 0); ridge.rotation.x = Math.PI / 2; ridge.rotation.z = (i / 4) * 0.6; this.bodyGroup.add(ridge); }
            // Goofy face.
            this._eye(this.stem, -0.14, 0.85, 0.34, 0.09, 0x111111); this._eye(this.stem, 0.14, 0.85, 0.34, 0.09, 0x111111);
            const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), this._mat(0x2a1010, 1, 0.5)); mouth.position.set(0, 0.62, 0.36); mouth.scale.set(1.2, 0.8, 0.5); this.bodyGroup.add(mouth); this._mouth = mouth;
            // Leafy top (FLOWER slot).
            this.flower = new THREE.Group();
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 4), this._mat(0x4a9a3a, 1, 0.6)); leaf.position.set(Math.cos(a) * 0.1, 1.15 + 0.1, Math.sin(a) * 0.1); leaf.rotation.z = Math.cos(a) * 0.5; leaf.rotation.x = Math.sin(a) * 0.5; this.flower.add(leaf); }
            this.bodyGroup.add(this.flower);
            // Tiny stubby legs (ROOTS slot) + arms (vines).
            this.roots = new THREE.Group();
            for (const lx of [-0.16, 0.16]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.2, 6), flesh); leg.position.set(lx, 0.28, 0.05); this.roots.add(leg); }
            this.bodyGroup.add(this.roots);
            this.vine1 = this._vine(-1, flesh, 0.78); this.vine2 = this._vine(1, flesh, 0.78);
            this._wirePlant([mouth]);
        }

        // ── Totemic Sprout: a little carved totem with a leafy crown ──────
        _buildTotemicSprout() {
            const p = this.profile;
            const wood = this._skinMat(p.bodyColor, 0.7);
            // Stacked carved segments (STEM).
            this.stem = new THREE.Group();
            for (let i = 0; i < 3; i++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(0.4 - i * 0.03, 0.36, 0.36 - i * 0.02), wood); seg.position.set(0, 0.45 + i * 0.36, 0); this.stem.add(seg); }
            this.bodyGroup.add(this.stem);
            // Carved face with glowing ritual eyes on the top segment.
            this._eye(this.bodyGroup, -0.1, 1.12, 0.2, 0.06, p.accent); this._eye(this.bodyGroup, 0.1, 1.12, 0.2, 0.06, p.accent);
            const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.04), this._mat(0x2a1a10, 1, 0.6)); mouth.position.set(0, 0.98, 0.19); this.bodyGroup.add(mouth);
            // Ritual glyphs.
            for (let i = 0; i < 3; i++) { const glyph = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10), this._mat(p.accent, 0.9, 0.3, p.accent)); glyph.position.set((i - 1) * 0.12, 0.5, 0.18); this.bodyGroup.add(glyph); }
            // Leafy crown (FLOWER).
            this.flower = new THREE.Group();
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 4), this._mat(p.accent, 1, 0.6)); leaf.position.set(Math.cos(a) * 0.12, 1.35, Math.sin(a) * 0.12); leaf.rotation.z = Math.cos(a) * 0.7; leaf.rotation.x = Math.sin(a) * 0.7; this.flower.add(leaf); }
            this.bodyGroup.add(this.flower);
            this.roots = this._rootCluster(wood);
            this.vine1 = this._vine(-1, wood, 0.8); this.vine2 = this._vine(1, wood, 0.8);
            this._wirePlant([mouth]);
        }

        // ── Barkhide Bruiser: a stocky bark-armoured plant brawler ────────
        _buildBarkhide() {
            const p = this.profile;
            const bark = this._skinMat(p.bodyColor, 0.85);
            // Thick trunk (STEM).
            this.stem = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.0, 10), bark); this.stem.position.set(0, 0.85, 0); this.bodyGroup.add(this.stem);
            // Bark plates.
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, 0.08), bark); plate.position.set(Math.cos(a) * 0.36, 0.85, Math.sin(a) * 0.36); plate.lookAt(Math.cos(a) * 1, 0.85, Math.sin(a) * 1); this.bodyGroup.add(plate); }
            // Head/crown (FLOWER) with a scowling face.
            this.flower = new THREE.Group();
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), bark); this.flower.add(head);
            this._eye(this.flower, -0.12, 0.04, 0.24, 0.06, 0x335511); this._eye(this.flower, 0.12, 0.04, 0.24, 0.06, 0x335511);
            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.05), bark); brow.position.set(0, 0.14, 0.24); brow.rotation.z = 0.1; this.flower.add(brow);
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 4), this._mat(p.accent, 1, 0.6)); leaf.position.set(Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12); leaf.rotation.z = Math.cos(a) * 0.6; leaf.rotation.x = Math.sin(a) * 0.6; this.flower.add(leaf); }
            this.flower.position.set(0, 1.5, 0); this.bodyGroup.add(this.flower);
            // Muscular vine arms with fists.
            this.vine1 = this._barkArm(-1, bark); this.vine2 = this._barkArm(1, bark);
            this.roots = this._rootCluster(bark);
            this._wirePlant();
        }
        _barkArm(side, mat) {
            const g = new THREE.Group();
            const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.5, 8), mat); upper.position.set(side * 0.1, -0.1, 0); upper.rotation.z = side * 0.5; g.add(upper);
            const fist = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat); fist.position.set(side * 0.34, -0.38, 0); g.add(fist); g._fist = fist;
            g.position.set(side * 0.36, 1.1, 0); g._side = side; this.bodyGroup.add(g); return g;
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.8);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            this.model.position.y = this._baseY + Math.sin(t * 1.5) * 0.02 * this.scale;
            // Gentle plant sway + vine idle.
            if (this.stem && this.stem.rotation) this.stem.rotation.z = Math.sin(t * 1.2) * 0.04;
            if (this.vine1) this.vine1.rotation.z = 0.2 + Math.sin(t * 2) * 0.25;
            if (this.vine2) this.vine2.rotation.z = -0.2 - Math.sin(t * 2 + 0.5) * 0.25;

            switch (this.variant) {
                case 'squeakyturnip': {
                    // Squeaky bounce + chattering mouth.
                    const sq = Math.abs(Math.sin(t * (fast ? 9 : 4)));
                    this.model.position.y = this._baseY + sq * (fast ? 0.18 : 0.08) * this.scale;
                    if (this.stem) this.stem.scale.set(1 + sq * 0.06, 1.1 - sq * 0.08, 1 + sq * 0.06);
                    if (this._mouth) this._mouth.scale.y = 0.8 + sq * 0.6;
                    break;
                }
                case 'totemicsprout': {
                    if (this.flower) this.flower.rotation.y = t * 0.5;
                    break;
                }
                case 'barkhidebruiser': {
                    [this.vine1, this.vine2].forEach((v, i) => { if (v) v.rotation.x = fast ? Math.sin(t * 9 + i * Math.PI) * 0.7 : Math.sin(t * 1.5 + i) * 0.1; });
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.2);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY - prog * 0.2 * this.scale;
            this.model.rotation.z = prog * 1.1; // topples like a felled plant
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new SproutBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = P_PROFILES;
    reg('squeakyturnip',   { aliases: ['squeakyturnip'],   scale: S.squeakyturnip.scale,   weapon: 0, create: make });
    reg('totemicsprout',   { aliases: ['totemicsprout'],   scale: S.totemicsprout.scale,   weapon: 0, create: make });
    reg('barkhidebruiser', { aliases: ['barkhidebruiser'], scale: S.barkhidebruiser.scale, weapon: 0, create: make });

    const NAMED = {
        squeakyturnip:   ["Squeaky Turnip Fiend"],
        totemicsprout:   ["Totemic Sprout"],
        barkhidebruiser: ["Barkhide Bruiser"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Sprout uniques registered');
})();
