//=============================================================================
// 3D Battler System - Spirit Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke ghost one-off models (anxiety elemental, fear siphon,
 * ghost wisp, graveyard haunt, lingering spirit, lost memory, minor shade) +
 * name-based assignment. Requires 3DBattlerSystem + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Spirit Uniques
 * ============================================================================
 *
 * Distinct procedural apparitions shaped from each enemy's flavour text,
 * assigned by exact name (override with <Battler3D: key>). They map the Ghost
 * archetype keys (FACE/CORE/LEFT_WISP/RIGHT_WISP) so dismemberment works.
 *
 * Registered: anxietyelem, fearsiphon, ghostwisp, graveyardhaunt,
 *             lingeringspirit, lostmemory, minorshade
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Spirits] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const S_PROFILES = {
        anxietyelem:     { variant: 'anxietyelem',     scale: 2.2, texturePool: 'pale', bodyColor: 0xaaccdd, accent: 0xffee66, hue: [0.55, 0.06], sat: [0.30, 0.10], lit: [0.70, 0.08] },
        fearsiphon:      { variant: 'fearsiphon',      scale: 2.4, texturePool: 'void', bodyColor: 0x2a2030, accent: 0xaa33ff, hue: [0.78, 0.10], sat: [0.40, 0.12], lit: [0.25, 0.08] },
        ghostwisp:       { variant: 'ghostwisp',       scale: 1.7, texturePool: 'pale', bodyColor: 0xd8e8f0, accent: 0x88ccff, hue: [0.55, 0.06], sat: [0.20, 0.08], lit: [0.82, 0.06] },
        graveyardhaunt:  { variant: 'graveyardhaunt',  scale: 2.3, texturePool: 'pale', bodyColor: 0xbfcad0, accent: 0x99ffcc, hue: [0.45, 0.08], sat: [0.15, 0.08], lit: [0.72, 0.08] },
        lingeringspirit: { variant: 'lingeringspirit', scale: 2.3, texturePool: 'pale', bodyColor: 0xc8d8e0, accent: 0xffd070, hue: [0.12, 0.05], sat: [0.20, 0.10], lit: [0.74, 0.08] },
        lostmemory:      { variant: 'lostmemory',      scale: 2.1, texturePool: 'pale', bodyColor: 0xc8e0dc, accent: 0x88ffe2, hue: [0.10, 0.04], sat: [0.25, 0.10], lit: [0.72, 0.08] },
        minorshade:      { variant: 'minorshade',      scale: 2.0, texturePool: 'void', bodyColor: 0x2a2a33, accent: 0x6655bb, hue: [0.72, 0.08], sat: [0.25, 0.10], lit: [0.26, 0.08] },
        graspingshadow:  { variant: 'graspingshadow',  scale: 2.3, texturePool: 'void', bodyColor: 0x141018, accent: 0x6622aa, hue: [0.76, 0.06], sat: [0.50, 0.12], lit: [0.10, 0.05], front: true },
        miasmalantern:   { variant: 'miasmalantern',   scale: 2.1, texturePool: 'void', bodyColor: 0x3a3528, accent: 0x66ff44, hue: [0.30, 0.06], sat: [0.45, 0.12], lit: [0.30, 0.08], front: true },
        midnighthunter:  { variant: 'midnighthunter',  scale: 2.5, texturePool: 'void', bodyColor: 0x16161f, accent: 0x88aaff, hue: [0.62, 0.06], sat: [0.30, 0.10], lit: [0.12, 0.06], front: true },
        phantomarcher:   { variant: 'phantomarcher',   scale: 2.4, texturePool: 'pale', bodyColor: 0xc8e0e8, accent: 0x99ddff, hue: [0.54, 0.06], sat: [0.22, 0.08], lit: [0.80, 0.06], front: true },
        sorrowspecter:   { variant: 'sorrowspecter',   scale: 2.2, texturePool: 'pale', bodyColor: 0xbcc8e0, accent: 0x6699ff, hue: [0.60, 0.06], sat: [0.25, 0.08], lit: [0.74, 0.08], front: true },
        spectralwisp:    { variant: 'spectralwisp',    scale: 1.6, texturePool: 'pale', bodyColor: 0xe8f4ff, accent: 0xaaeeff, hue: [0.54, 0.05], sat: [0.18, 0.06], lit: [0.86, 0.05], front: true },
        veiledphantasm:  { variant: 'veiledphantasm',  scale: 2.3, texturePool: 'pale', bodyColor: 0xc4ccd8, accent: 0x99aaff, hue: [0.62, 0.05], sat: [0.18, 0.08], lit: [0.74, 0.08], front: true },
        whisperingwraith:{ variant: 'whisperingwraith',scale: 2.4, texturePool: 'void', bodyColor: 0x6a7080, accent: 0xccddff, hue: [0.60, 0.06], sat: [0.20, 0.10], lit: [0.45, 0.10], front: true },
        ghosttiger:      { variant: 'ghosttiger',      scale: 2.5, texturePool: 'pale', bodyColor: 0xc8e4f0, accent: 0x66ffdd, hue: [0.48, 0.06], sat: [0.22, 0.08], lit: [0.78, 0.06], front: true },
        shadowexecutioner:{variant: 'shadowexecutioner',scale: 2.6, texturePool: 'void', bodyColor: 0x12111a, accent: 0xff3344, hue: [0.00, 0.04], sat: [0.50, 0.12], lit: [0.12, 0.06], front: true },
        echowisp:        { variant: 'echowisp',        scale: 2.0, texturePool: 'pale', bodyColor: 0xb0e8e0, accent: 0x55ffee, hue: [0.50, 0.05], sat: [0.30, 0.10], lit: [0.80, 0.06], front: true },
        obsidianwraith:  { variant: 'obsidianwraith',  scale: 2.4, texturePool: 'void', bodyColor: 0x0d0a14, accent: 0x66ccff, hue: [0.58, 0.06], sat: [0.40, 0.12], lit: [0.08, 0.05], front: true },
        sentientwound:   { variant: 'sentientwound',   scale: 2.2, texturePool: 'void', bodyColor: 0x5a0c10, accent: 0xff3a44, hue: [0.00, 0.03], sat: [0.65, 0.12], lit: [0.30, 0.08], front: true },
        // ── Split off the shared graveyardhaunt rig into bespoke apparitions ──
        spr_graveyardhaunt:   { variant: 'spr_graveyardhaunt',   scale: 2.3, texturePool: 'pale', bodyColor: 0xbfcad0, accent: 0x99ffcc, hue: [0.45, 0.08], sat: [0.15, 0.08], lit: [0.72, 0.08], front: true },
        spr_sunkencharnelhound:{ variant: 'spr_sunkencharnelhound', scale: 2.4, texturePool: 'void', bodyColor: 0x4a5a48, accent: 0x88cc55, hue: [0.30, 0.08], sat: [0.40, 0.12], lit: [0.30, 0.08], front: true },
        spr_mummifiedmourner: { variant: 'spr_mummifiedmourner', scale: 2.2, texturePool: 'pale', bodyColor: 0xd8c9a0, accent: 0xe0b060, hue: [0.11, 0.05], sat: [0.30, 0.10], lit: [0.66, 0.08], front: true },
        spr_forgottenthrall:  { variant: 'spr_forgottenthrall',  scale: 2.2, texturePool: 'pale', bodyColor: 0x9aa8b0, accent: 0x6699bb, hue: [0.58, 0.06], sat: [0.18, 0.08], lit: [0.58, 0.08], front: true },
        spr_plaguepallbearer: { variant: 'spr_plaguepallbearer', scale: 2.4, texturePool: 'void', bodyColor: 0x5a4a3a, accent: 0x9acc4a, hue: [0.28, 0.06], sat: [0.45, 0.12], lit: [0.34, 0.08], front: true }
    };

    class SpiritBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = S_PROFILES[creatureType] || S_PROFILES.ghostwisp;
            super(scale, offsetY, battler, profile, 0, creatureType || 'ghostwisp');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            this.facingYaw = 0; // apparitions face the viewer
        }

        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.7 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.5 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity)
            });
            this._materials.push(m);
            return m;
        }
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.72 : rough)); }
        // Per-enemy variation: clone profile, jitter + name-tint so a shared spirit group reads as individuals.
        _jit(hex, amt) { let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255; const f = () => 1 + (this.idRand() - 0.5) * 2 * amt; r = Math.max(0, Math.min(255, Math.round(r * f()))); g = Math.max(0, Math.min(255, Math.round(g * f()))); b = Math.max(0, Math.min(255, Math.round(b * f()))); return (r << 16) | (g << 8) | b; }
        _enemyName() { try { const id = this.battler && this.battler.enemyId && this.battler.enemyId(); if (id && typeof $dataEnemies !== 'undefined' && $dataEnemies[id]) return String($dataEnemies[id].name || ''); } catch (e) {} return ''; }
        _varyProfile() {
            const p = Object.assign({}, this.profile);
            p.bodyColor = this._jit(p.bodyColor, 0.12); p.accent = this._jit(p.accent, 0.14);
            const nm = this._enemyName().toLowerCase(), has = w => nm.indexOf(w) >= 0;
            if (has('cinder') || has('ember') || has('charred') || has('ashen')) { p.accent = 0xff6622; }
            else if (has('salt') || has('frost') || has('frozen') || has('rime') || has('winter')) { p.accent = 0x88e0ff; p.bodyColor = this._jit(0xaac8e0, 0.08); }
            else if (has('gilded') || has('golden') || has('radiant')) { p.accent = 0xffe066; }
            else if (has('crypt') || has('grave') || has('sunken') || has('murk') || has('bog') || has('mire')) { p.accent = 0x88cc66; p.bodyColor = this._jit(0x7a9a78, 0.1); }
            else if (has('plague') || has('festering') || has('rotting')) { p.accent = 0x9acc4a; }
            else if (has('blood') || has('crimson') || has('scarlet')) { p.accent = 0xcc2233; }
            else if (has('shadow') || has('void') || has('night') || has('umbral') || has('dusk')) { p.accent = 0x9933cc; p.bodyColor = this._jit(0x3a2a4a, 0.12); }
            this.profile = p;
        }

        _ghostBase(o) {
            o = o || {};
            const p = this.profile;
            const bodyMat = o.bodyMat || this._skinMat(p.bodyColor, 0.72);
            bodyMat.opacity = (o.opacity != null ? o.opacity : 0.7);
            this._ghostMat = bodyMat;
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), bodyMat); this.core.position.y = 0.9; this.core.scale.set(1, 1.15, 1); this.bodyGroup.add(this.core);
            const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 14), bodyMat); tail.rotation.x = Math.PI; tail.position.set(0, -0.55, 0); this.core.add(tail);
            this.face = new THREE.Group();
            const eyeMat = this._mat(o.eyeColor || 0x111122, 1.0, 0.6, o.eyeGlow || null);
            const le = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat); le.position.set(-0.15, 0.05, 0.4);
            const re = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat); re.position.set(0.15, 0.05, 0.4);
            const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), eyeMat); mouth.position.set(0, -0.18, 0.4); mouth.scale.set(1.4, 1.0, 0.6);
            this.face.add(le, re, mouth); this.face.position.y = 0.9; this.bodyGroup.add(this.face);
            this.leftWisp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 10), bodyMat); this.leftWisp.position.set(-0.5, 0.8, 0); this.leftWisp.rotation.z = 0.5; this.bodyGroup.add(this.leftWisp);
            this.rightWisp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 10), bodyMat); this.rightWisp.position.set(0.5, 0.8, 0); this.rightWisp.rotation.z = -0.5; this.bodyGroup.add(this.rightWisp);
            this._partMeshMap = { FACE: this.face, CORE: this.core, LEFT_WISP: this.leftWisp, RIGHT_WISP: this.rightWisp };
            this._cascadeRules = [
                { gone: ['CORE'], hide: [this.core, this.face, this.leftWisp, this.rightWisp, ...(o.extra || [])].filter(Boolean) },
                { gone: ['FACE'], hide: [this.face] },
                { gone: ['LEFT_WISP'], hide: [this.leftWisp] },
                { gone: ['RIGHT_WISP'], hide: [this.rightWisp] },
            ];
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            this._varyProfile();
            switch (this.variant) {
                case 'fearsiphon':      this._buildFearSiphon(); break;
                case 'ghostwisp':       this._buildGhostWisp(); break;
                case 'graveyardhaunt':  this._buildGraveyardHaunt(); break;
                case 'lingeringspirit': this._buildLingeringSpirit(); break;
                case 'lostmemory':      this._buildLostMemory(); break;
                case 'minorshade':      this._buildMinorShade(); break;
                case 'graspingshadow':  this._buildGraspingShadow(); break;
                case 'miasmalantern':   this._buildMiasmaLantern(); break;
                case 'midnighthunter':  this._buildMidnightHunter(); break;
                case 'phantomarcher':   this._buildPhantomArcher(); break;
                case 'sorrowspecter':   this._buildSorrowSpecter(); break;
                case 'spectralwisp':    this._buildSpectralWisp(); break;
                case 'veiledphantasm':  this._buildVeiledPhantasm(); break;
                case 'whisperingwraith':this._buildWhisperingWraith(); break;
                case 'ghosttiger':      this._buildGhostTiger(); break;
                case 'shadowexecutioner':this._buildShadowExecutioner(); break;
                case 'echowisp':        this._buildEchoWisp(); break;
                case 'obsidianwraith':  this._buildObsidianWraith(); break;
                case 'sentientwound':   this._buildSentientWound(); break;
                case 'spr_graveyardhaunt':    this._buildSprGraveyardHaunt(); break;
                case 'spr_sunkencharnelhound':this._buildSprSunkenCharnelhound(); break;
                case 'spr_mummifiedmourner':  this._buildSprMummifiedMourner(); break;
                case 'spr_forgottenthrall':   this._buildSprForgottenThrall(); break;
                case 'spr_plaguepallbearer':  this._buildSprPlaguePallbearer(); break;
                default:                this._buildAnxiety(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Anxiety Elemental: a jittery wraith ringed with darting eyes ────
        _buildAnxiety() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.62, eyeGlow: p.accent, eyeColor: p.accent });
            this.darts = new THREE.Group();
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), this._mat(0xffffff, 0.9, 0.2));
                const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), this._mat(0x111111, 1.0, 0.2)); pupil.position.z = 0.05; eye.add(pupil);
                eye.position.set(Math.cos(a) * 0.6, 0.9 + Math.sin(a) * 0.5, 0.3); eye._a = a; this.darts.add(eye);
            }
            this.bodyGroup.add(this.darts);
            // Sweat beads.
            this.sweat = new THREE.Group();
            for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(p.accent, 0.85, 0.2, p.accent)); s.position.set((this.idRand() - 0.5) * 0.7, 1.1, 0.4); s.scale.y = 1.4; s._t = this.idRand(); this.sweat.add(s); }
            this.bodyGroup.add(this.sweat);
        }

        // ── Fear Siphon: a draining shadow funnel with one wide eye ─────────
        _buildFearSiphon() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.72 });
            // Replace the friendly face with a single huge staring eye.
            this.face.visible = false;
            this.bigEye = new THREE.Group();
            const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), this._mat(0xeee8f0, 1.0, 0.2)); this.bigEye.add(sclera);
            const iris = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), this._mat(p.accent, 1.0, 0.2, p.accent)); iris.position.z = 0.16; this.bigEye.add(iris);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), this._mat(0x000000, 1.0, 0.1)); pupil.position.z = 0.24; this.bigEye.add(pupil);
            this.bigEye.position.set(0, 0.95, 0.32); this.bodyGroup.add(this.bigEye);
            // Intake swirl ring drawing fear inward.
            this.swirl = new THREE.Group();
            for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const w = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 5), this._mat(p.accent, 0.6, 0.3, p.accent)); w.position.set(Math.cos(a) * 0.7, 0.5, Math.sin(a) * 0.7); w.rotation.z = a; w._a = a; this.swirl.add(w); }
            this.bodyGroup.add(this.swirl);
            this._partMeshMap.FACE = this.bigEye;
            this._cascadeRules[1] = { gone: ['FACE'], hide: [this.bigEye] };
            this._cascadeRules[0].hide.push(this.bigEye, this.swirl);
        }

        // ── Ghost Wisp: a barely-there faint little spirit ──────────────────
        _buildGhostWisp() {
            this._ghostBase({ opacity: 0.4 });
            this.core.scale.set(0.8, 0.95, 0.8);
            this.leftWisp.visible = false; this.rightWisp.visible = false; // too weak for arms
        }

        // ── Graveyard Haunt: a mournful ghost rising from a tombstone ───────
        _buildGraveyardHaunt() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.6 });
            // Tombstone it haunts.
            this.tomb = new THREE.Group();
            const stone = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.14), this._mat(0x6a6a72, 1.0, 0.8)); stone.position.y = 0.3; this.tomb.add(stone);
            const top = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.14, 12, 1, false, 0, Math.PI), this._mat(0x6a6a72, 1.0, 0.8)); top.rotation.z = -Math.PI / 2; top.position.set(0, 0.6, 0); this.tomb.add(top);
            this.tomb.position.set(0, -0.05, -0.1); this.bodyGroup.add(this.tomb);
            // Rattling chains.
            this.chains = new THREE.Group();
            for (const cx of [-0.4, 0.4]) for (let i = 0; i < 3; i++) { const link = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.015, 6, 10), this._mat(0x888888, 1.0, 0.5)); link.position.set(cx, 0.6 - i * 0.12, 0.2); this.chains.add(link); }
            this.bodyGroup.add(this.chains);
        }

        // ── Lingering Spirit: clutches a glowing keepsake (unfinished business) ─
        _buildLingeringSpirit() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.65 });
            // Held glowing locket on a chain.
            this.keepsake = new THREE.Group();
            const locket = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), this._mat(p.accent, 1.0, 0.3, p.accent)); locket.scale.set(1, 1.2, 0.5); this.keepsake.add(locket);
            const chain = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 6, 18, Math.PI), this._mat(0xd4b042, 1.0, 0.3)); chain.position.y = 0.15; this.keepsake.add(chain);
            this.keepsake.position.set(0, 0.62, 0.42); this.bodyGroup.add(this.keepsake);
            // Reaching hand tendril.
            this.reach = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 8), this._ghostMat); this.reach.position.set(0, 0.55, 0.55); this.reach.rotation.x = -Math.PI / 2; this.bodyGroup.add(this.reach);
            this._cascadeRules[0].hide.push(this.keepsake, this.reach);
        }

        // ── Lost Memory: a sepia wisp made of drifting photo-fragments ──────
        _buildLostMemory() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.5 });
            this.photos = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * Math.PI * 2;
                const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.14), this._mat(0xefe6d4, 0.8, 0.6));
                const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.16), this._mat(0xcdbfa0, 0.8, 0.6)); frame.position.z = -0.002; ph.add(frame);
                ph.position.set(Math.cos(a) * 0.7, 0.9 + Math.sin(a * 2) * 0.4, Math.sin(a) * 0.5); ph.rotation.set(this.idRand() * 2, this.idRand() * 6, this.idRand() * 2); ph._a = a; this.photos.add(ph);
            }
            this.bodyGroup.add(this.photos);
            // Glowing memory motes.
            this.motes = new THREE.Group();
            for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), this._mat(p.accent, 0.9, 0.2, p.accent)); m.position.set((this.idRand() - 0.5) * 1.2, 0.4 + this.idRand() * 1.0, (this.idRand() - 0.5) * 0.8); m._t = this.idRand(); this.motes.add(m); }
            this.bodyGroup.add(this.motes);
            this._cascadeRules[0].hide.push(this.photos, this.motes);
        }

        // ── Minor Shade: a small dark echo with hollow glowing eyes ─────────
        _buildMinorShade() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.68, eyeColor: p.accent, eyeGlow: p.accent });
            this.core.scale.set(0.9, 1.1, 0.9);
            this.leftWisp.scale.setScalar(0.8); this.rightWisp.scale.setScalar(0.8);
        }

        // ── Grasping Shadow: a clawed hand of darkness rising from a pool ───
        _buildGraspingShadow() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.85, eyeColor: p.accent, eyeGlow: p.accent });
            // Repurpose CORE as the palm; hide the friendly tail look by reshaping.
            this.core.geometry.dispose();
            this.core.geometry = new THREE.BoxGeometry(0.5, 0.55, 0.28);
            this.core.scale.set(1, 1, 1); this.core.position.y = 1.0;
            this.core.children.forEach(c => { c.visible = false; }); // drop the cone tail
            // Five clawed fingers splaying upward from the palm.
            this.fingers = new THREE.Group();
            for (let i = 0; i < 5; i++) {
                const fx = (-0.22 + i * 0.11), len = (i === 0 ? 0.32 : 0.5 - Math.abs(i - 2.5) * 0.04);
                const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, len, 8), this._ghostMat);
                finger.position.set(fx, len / 2 + 0.2, 0); finger.rotation.z = (i - 2) * 0.16;
                const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 7), this._mat(p.accent, 0.9, 0.3, p.accent));
                claw.position.y = len / 2 + 0.06; claw.rotation.x = -0.3; finger.add(claw);
                this.fingers.add(finger);
            }
            this.core.add(this.fingers);
            // Shadow pool it rises from.
            this.pool = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), this._mat(0x050308, 0.85, 1.0));
            this.pool.rotation.x = -Math.PI / 2; this.pool.position.y = 0.02; this.bodyGroup.add(this.pool);
            // Face floats on the wrist as glowing eyes.
            this.face.position.set(0, 0.78, 0.16);
            this._cascadeRules[0].hide.push(this.pool);
        }

        // ── Miasma Lantern: tarnished lantern with a sickly green flame face ─
        _buildMiasmaLantern() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.55, eyeColor: 0x000000 });
            // Reshape CORE into the lantern cage body.
            this.core.geometry.dispose();
            this.core.geometry = new THREE.BoxGeometry(0.46, 0.6, 0.46);
            this.core.scale.set(1, 1, 1); this.core.position.y = 0.95;
            this.core.children.forEach(c => { c.visible = false; });
            this.core.material = this._mat(p.bodyColor, 0.45, 0.7); // tarnished, see-through glass
            // Metal frame: top cap, base, corner posts, ring handle.
            const metal = this._mat(0x4a4438, 1.0, 0.6);
            const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.22, 4), metal); cap.position.y = 0.4; cap.rotation.y = Math.PI / 4; this.core.add(cap);
            const baseP = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), metal); baseP.position.y = -0.32; this.core.add(baseP);
            for (const sx of [-0.22, 0.22]) for (const sz of [-0.22, 0.22]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), metal); post.position.set(sx, 0, sz); this.core.add(post); }
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12), metal); ring.position.y = 0.56; ring.rotation.x = Math.PI / 2; this.core.add(ring);
            // Green flame inside, doubling as the face.
            this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 10), this._mat(p.accent, 0.85, 0.2, p.accent));
            this.flame.position.set(0, -0.02, 0); this.core.add(this.flame);
            this.face.position.set(0, 0.95, 0.12); this.face.scale.setScalar(0.7);
            this._partMeshMap.FACE = this.face;
            this._cascadeRules[0].hide.push(this.flame);
        }

        // ── Midnight Hunter: hooded specter assassin with cloak wisps ───────
        _buildMidnightHunter() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.85, eyeColor: p.accent, eyeGlow: p.accent });
            // CORE becomes a tall hooded cowl (cone).
            this.core.geometry.dispose();
            this.core.geometry = new THREE.ConeGeometry(0.4, 1.0, 12);
            this.core.scale.set(1, 1, 1); this.core.position.y = 1.05;
            this.core.children.forEach(c => { c.visible = false; });
            // Dark hood overhang shadowing the face.
            const hoodMat = this._mat(0x0a0a12, 0.95, 0.85);
            this.hood = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hoodMat);
            this.hood.position.set(0, 0.32, 0); this.core.add(this.hood);
            const brim = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 12, 1, true), hoodMat); brim.position.set(0, 0.18, 0.02); this.core.add(brim);
            // Glowing slit eyes deep in the hood (only the face's eyes; hide the mouth).
            this.face.children[2].visible = false;
            this.face.position.set(0, 1.22, 0.18); this.face.scale.set(0.8, 0.45, 0.8);
            // Wisps form a ragged trailing cloak.
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.18, 0.9, 8); this.leftWisp.position.set(-0.32, 0.55, 0); this.leftWisp.rotation.z = 0.35;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.18, 0.9, 8); this.rightWisp.position.set(0.32, 0.55, 0); this.rightWisp.rotation.z = -0.35;
        }

        // ── Phantom Archer: translucent ghost archer with a spectral bow ────
        _buildPhantomArcher() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.45, eyeColor: p.accent, eyeGlow: p.accent });
            this.core.position.y = 1.15;
            // Spectral bow held to one side.
            this.bow = new THREE.Group();
            const limb = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 8, 18, Math.PI * 1.05), this._mat(p.accent, 0.7, 0.3, p.accent));
            this.bow.add(limb);
            const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.82, 4), this._mat(0xffffff, 0.5, 0.2)); string.position.x = 0.22; this.bow.add(string);
            const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), this._mat(p.accent, 0.8, 0.3, p.accent)); arrow.rotation.z = Math.PI / 2; arrow.position.set(-0.15, 0, 0); this.bow.add(arrow);
            this.bow.position.set(-0.6, 1.0, 0.2); this.bow.rotation.y = -0.3; this.bodyGroup.add(this.bow);
            // Ghostly arm reaching to the bow.
            this.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 7), this._ghostMat); this.arm.position.set(-0.35, 1.0, 0.15); this.arm.rotation.z = 0.9; this.bodyGroup.add(this.arm);
            // Lower body trails into wisps — widen them into a tattered skirt.
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.22, 0.85, 8); this.leftWisp.position.set(-0.22, 0.45, 0); this.leftWisp.rotation.z = 0.25;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.22, 0.85, 8); this.rightWisp.position.set(0.22, 0.45, 0); this.rightWisp.rotation.z = -0.25;
            this.face.position.y = 1.15;
            this._cascadeRules[0].hide.push(this.bow, this.arm);
        }

        // ── Sorrow Specter: a weeping ghost with downturned trailing arms ───
        _buildSorrowSpecter() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.6, eyeColor: 0x223355 });
            // Sorrowful face: replace cheerful mouth with a downturned arc + tears.
            this.face.children[2].geometry.dispose();
            this.face.children[2].geometry = new THREE.TorusGeometry(0.1, 0.025, 6, 12, Math.PI);
            this.face.children[2].position.set(0, -0.24, 0.4); this.face.children[2].rotation.z = Math.PI; // frown
            this.tears = new THREE.Group();
            for (const tx of [-0.15, 0.15]) for (let i = 0; i < 3; i++) { const tear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), this._mat(p.accent, 0.8, 0.2, p.accent)); tear.scale.y = 1.6; tear.position.set(tx, -0.1 - i * 0.18, 0.42); tear._t = i * 0.3 + (tx > 0 ? 0.15 : 0); this.tears.add(tear); }
            this.face.add(this.tears);
            // Downturned mournful arm wisps.
            this.leftWisp.position.set(-0.45, 0.55, 0); this.leftWisp.rotation.z = -0.4; this.leftWisp.scale.set(1, 1.5, 1);
            this.rightWisp.position.set(0.45, 0.55, 0); this.rightWisp.rotation.z = 0.4; this.rightWisp.scale.set(1, 1.5, 1);
            // tears are parented to this.face, so they hide automatically with FACE/CORE rules
        }

        // ── Spectral Wisp: a simple glowing ball of ghost-light ─────────────
        _buildSpectralWisp() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.55, eyeColor: 0x335577, eyeGlow: p.accent });
            // Pure glowing orb — drop the tail, shrink the body, add a soft halo.
            this.core.children.forEach(c => { c.visible = false; });
            this.core.material = this._mat(p.bodyColor, 0.5, 0.2, p.accent);
            this.core.scale.set(0.85, 0.85, 0.85); this.core.position.y = 0.95;
            this.halo = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), this._mat(p.accent, 0.18, 0.2, p.accent));
            this.halo.position.y = 0.95; this.bodyGroup.add(this.halo);
            this.face.position.y = 0.95; this.face.scale.setScalar(0.8);
            // Two tiny flame wisps.
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.08, 0.35, 8); this.leftWisp.position.set(-0.4, 0.85, 0); this.leftWisp.scale.setScalar(0.8);
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.08, 0.35, 8); this.rightWisp.position.set(0.4, 0.85, 0); this.rightWisp.scale.setScalar(0.8);
            this._cascadeRules[0].hide.push(this.halo);
        }

        // ── Veiled Phantasm: a faint face under a hanging spectral cloak ─────
        _buildVeiledPhantasm() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.35, eyeColor: 0x445577, eyeGlow: p.accent });
            // Hide the cheerful tail/mouth; the body is hidden under the shroud.
            this.core.children.forEach(c => { c.visible = false; });
            this.core.material.opacity = 0.25;
            this.face.children[2].visible = false; // no mouth — barely visible face
            this.face.position.set(0, 1.0, 0.18); this.face.scale.set(0.85, 0.85, 0.6);
            // The hanging cloak: a tall draped open cone over everything.
            const cloakMat = this._mat(p.bodyColor, 0.55, 0.85);
            this.cloak = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 16, 1, true), cloakMat);
            this.cloak.position.y = 0.85; this.bodyGroup.add(this.cloak);
            // A rounded hood crown capping the top of the drape.
            const crown = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), cloakMat);
            crown.position.y = 1.6; this.bodyGroup.add(crown);
            this._veil = crown;
            // Ragged drape folds dangling at the hem.
            this.folds = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * Math.PI * 2;
                const fold = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5 + this.idRand() * 0.3, 6), cloakMat);
                fold.position.set(Math.cos(a) * 0.5, 0.12, Math.sin(a) * 0.5); fold.rotation.x = Math.PI; this.folds.add(fold);
            }
            this.bodyGroup.add(this.folds);
            // Wisps become the cloak's two outer corners.
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.14, 0.9, 7); this.leftWisp.material = cloakMat; this.leftWisp.position.set(-0.5, 0.7, 0.05); this.leftWisp.rotation.z = 0.2;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.14, 0.9, 7); this.rightWisp.material = cloakMat; this.rightWisp.position.set(0.5, 0.7, 0.05); this.rightWisp.rotation.z = -0.2;
            this._cascadeRules[0].hide.push(this.cloak, crown, this.folds);
        }

        // ── Whispering Wraith: a hollow-faced tatter with fraying edges ─────
        _buildWhisperingWraith() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.55, eyeColor: 0x000000 });
            // Hollow sunken face: black void eyes + a gaping whispering mouth.
            this.face.children.forEach(c => { c.material = this._mat(0x000000, 0.95, 0.2); });
            this.face.children[0].scale.setScalar(1.4); this.face.children[1].scale.setScalar(1.4);
            this.face.children[2].geometry.dispose();
            this.face.children[2].geometry = new THREE.SphereGeometry(0.12, 10, 10); this.face.children[2].scale.set(1.0, 1.6, 0.6); this.face.children[2].position.set(0, -0.2, 0.4);
            this.face.position.y = 0.95;
            // Tattered ragged hem: jagged downward shreds around the body.
            const ragMat = this._ghostMat;
            this.rags = new THREE.Group();
            for (let i = 0; i < 9; i++) {
                const a = (i / 9) * Math.PI * 2, len = 0.4 + this.idRand() * 0.6;
                const rag = new THREE.Mesh(new THREE.ConeGeometry(0.07, len, 5), ragMat);
                rag.position.set(Math.cos(a) * 0.4, 0.45 - len * 0.4, Math.sin(a) * 0.3); rag.rotation.x = Math.PI; rag.rotation.z = (this.idRand() - 0.5) * 0.4; this.rags.add(rag);
            }
            this.bodyGroup.add(this.rags);
            // Reality-fraying shards orbiting the edges (thin warped planes).
            this.fray = new THREE.Group();
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.3), this._mat(p.accent, 0.45, 0.3, p.accent));
                sh.position.set(Math.cos(a) * 0.75, 0.9 + Math.sin(a * 2) * 0.3, Math.sin(a) * 0.5); sh.rotation.set(this.idRand() * 3, a, this.idRand() * 3); sh._a = a; this.fray.add(sh);
            }
            this.bodyGroup.add(this.fray);
            this._cascadeRules[0].hide.push(this.rags, this.fray);
        }

        // ── Ghost Tiger: translucent tiger head with glowing fangs ─────────
        _buildGhostTiger() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.4, eyeColor: p.accent, eyeGlow: p.accent });
            // CORE becomes a broad tiger skull/head.
            this.core.geometry.dispose();
            this.core.geometry = new THREE.SphereGeometry(0.45, 16, 14);
            this.core.scale.set(1.15, 0.95, 1.1); this.core.position.y = 1.0;
            this.core.children.forEach(c => { c.visible = false; });
            const headMat = this.core.material;
            // Short rounded muzzle: a cat's face is flat, not a dog's snout.
            const snout = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), headMat); snout.scale.set(1.1, 0.75, 0.85); snout.position.set(0, -0.14, 0.4); this.core.add(snout);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(p.accent, 0.9, 0.3, p.accent)); nose.scale.set(1.3, 0.85, 0.9); nose.position.set(0, -0.1, 0.6); this.core.add(nose);
            // Two pointed ears with a glowing inner shell.
            for (const ex of [-0.28, 0.28]) {
                const ear = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 6), headMat); ear.position.set(ex, 0.42, -0.05); ear.rotation.set(-0.2, 0, -Math.sign(ex) * 0.16); this.core.add(ear);
                const inner = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 6), this._mat(p.accent, 0.5, 0.3, p.accent)); inner.position.set(ex, 0.41, 0.02); inner.rotation.copy(ear.rotation); this.core.add(inner);
            }
            // Whiskers trailing off into vapour.
            const wMat = this._mat(p.accent, 0.45, 0.3, p.accent);
            for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
                const w = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), wMat);
                w.position.set(side * 0.3, -0.16 + k * 0.09, 0.44); w.rotation.z = Math.PI / 2; w.rotation.y = side * (0.3 - k * 0.15); this.core.add(w);
            }
            // Glowing fangs jutting from the muzzle.
            this.fangs = new THREE.Group();
            for (const fx of [-0.1, 0.1]) { const fang = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 6), this._mat(p.accent, 0.95, 0.2, p.accent)); fang.position.set(fx, -0.22, 0.55); fang.rotation.x = Math.PI; this.fangs.add(fang); }
            this.core.add(this.fangs);
            // Stripe marks (thin glowing arcs over the brow).
            for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.02), this._mat(p.accent, 0.5, 0.3, p.accent)); st.position.set((i - 1) * 0.16, 0.18, 0.4); this.core.add(st); }
            // Place the eyes on the tiger face: big, round and catchlit.
            this.face.position.set(0, 1.05, 0.32); this.face.scale.set(1.1, 1.0, 1.0); this.face.children[2].visible = false;
            this.face.children[0].position.set(-0.19, 0.06, 0.16); this.face.children[1].position.set(0.19, 0.06, 0.16);
            const glintMat = this._mat(0xffffff, 0.9, 0.05, 0xffffff);
            for (const e of [this.face.children[0], this.face.children[1]]) {
                e.scale.set(1.5, 1.5, 1.3);
                const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(0x141826, 1.0, 0.2)); pupil.scale.set(0.6, 1.0, 0.6); pupil.position.z = 0.055; e.add(pupil);
                const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), glintMat); glint.position.set(-0.03, 0.035, 0.07); e.add(glint);
            }
            // Body dissolving into spectral wisps (forelegs trailing off).
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.16, 0.85, 8); this.leftWisp.position.set(-0.28, 0.45, 0.1); this.leftWisp.rotation.z = 0.2;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.16, 0.85, 8); this.rightWisp.position.set(0.28, 0.45, 0.1); this.rightWisp.rotation.z = -0.2;
            this._cascadeRules[0].hide.push(this.fangs);
        }

        // ── Shadow Executioner: hooded specter with a spectral axe ─────────
        _buildShadowExecutioner() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.9, eyeColor: p.accent, eyeGlow: p.accent });
            // CORE becomes a broad hooded torso (tapered box).
            this.core.geometry.dispose();
            this.core.geometry = new THREE.CylinderGeometry(0.34, 0.5, 1.0, 10);
            this.core.scale.set(1, 1, 1); this.core.position.y = 1.05;
            this.core.children.forEach(c => { c.visible = false; });
            this.core.material = this._mat(p.bodyColor, 0.92, 0.85);
            // Heavy executioner's hood with a deep dark cowl.
            const hoodMat = this._mat(0x060509, 0.97, 0.9);
            this.hood = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), hoodMat); this.hood.scale.set(1, 1.1, 1); this.hood.position.set(0, 0.62, 0); this.core.add(this.hood);
            const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.4, 12, 1, true), hoodMat); cowl.position.set(0, 0.5, 0.04); this.core.add(cowl);
            // Two cold glowing slit eyes set deep in the hood.
            this.face.children[2].visible = false;
            this.face.position.set(0, 1.55, 0.22); this.face.scale.set(0.85, 0.4, 0.7);
            // Spectral broad axe clutched to one side.
            this.axe = new THREE.Group();
            const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 7), this._mat(0x1a1620, 0.95, 0.6)); this.axe.add(haft);
            const headG = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12, 1, false, -Math.PI * 0.4, Math.PI * 0.8), this._mat(p.accent, 0.8, 0.3, p.accent));
            headG.rotation.z = Math.PI / 2; headG.position.set(0.18, 0.5, 0); this.axe.add(headG);
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), this._mat(0x1a1620, 0.95, 0.5)); spike.position.set(0, 0.72, 0); this.axe.add(spike);
            this.axe.position.set(0.55, 0.95, 0.1); this.axe.rotation.z = 0.25; this.bodyGroup.add(this.axe);
            // Gripping arm reaching for the haft.
            this.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 7), this.core.material); this.arm.position.set(0.4, 1.0, 0.12); this.arm.rotation.z = -0.7; this.bodyGroup.add(this.arm);
            // Lower body trails into shadow wisps.
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.2, 0.95, 8); this.leftWisp.material = this.core.material; this.leftWisp.position.set(-0.22, 0.4, 0); this.leftWisp.rotation.z = 0.2;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.2, 0.95, 8); this.rightWisp.material = this.core.material; this.rightWisp.position.set(0.22, 0.4, 0); this.rightWisp.rotation.z = -0.2;
            this._cascadeRules[0].hide.push(this.axe, this.arm);
        }

        // ── Echo Wisp: concentric ripple-rings around a faint face ─────────
        _buildEchoWisp() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.35, eyeColor: p.accent, eyeGlow: p.accent });
            // Shrink the core to a faint nucleus; drop the tail.
            this.core.children.forEach(c => { c.visible = false; });
            this.core.scale.set(0.55, 0.55, 0.55); this.core.position.y = 0.95;
            this.core.material = this._mat(p.bodyColor, 0.4, 0.2, p.accent);
            this.face.position.y = 0.95; this.face.scale.setScalar(0.7); this.face.children[2].visible = false;
            // Concentric echo-rings expanding outward (vertical, facing viewer).
            this.rings = new THREE.Group();
            for (let i = 0; i < 5; i++) {
                const r = 0.3 + i * 0.22;
                const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.02, 6, 28), this._mat(p.accent, 0.6 - i * 0.1, 0.3, p.accent));
                ring.position.y = 0.95; ring._r = r; ring._i = i; this.rings.add(ring);
            }
            this.bodyGroup.add(this.rings);
            // Two resonant wisps as tuning-fork prongs.
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.CylinderGeometry(0.04, 0.06, 0.7, 7); this.leftWisp.material = this.core.material; this.leftWisp.position.set(-0.32, 0.5, 0); this.leftWisp.rotation.z = 0.12;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.CylinderGeometry(0.04, 0.06, 0.7, 7); this.rightWisp.material = this.core.material; this.rightWisp.position.set(0.32, 0.5, 0); this.rightWisp.rotation.z = -0.12;
            this._cascadeRules[0].hide.push(this.rings);
        }

        // ── Obsidian Wraith: a specter clad in jagged volcanic-glass shards ─
        _buildObsidianWraith() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.85, eyeColor: p.accent, eyeGlow: p.accent });
            this.core.material = this._mat(p.bodyColor, 0.9, 0.3);
            this.core.children.forEach(c => { c.visible = false; });
            this.core.position.y = 0.95;
            // Jagged obsidian shards encrusting the body — dark, sharp facets.
            const glassMat = this._mat(0x14101e, 0.95, 0.15);
            this.shards = new THREE.Group();
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2, h = 0.95 - Math.floor(i / 6) * 0.4;
                const len = 0.3 + this.idRand() * 0.4;
                const shard = new THREE.Mesh(new THREE.ConeGeometry(0.09, len, 4), glassMat);
                shard.position.set(Math.cos(a) * 0.4, h, Math.sin(a) * 0.4);
                shard.rotation.set(Math.cos(a) * 0.8, a, Math.sin(a) * 0.8); this.shards.add(shard);
            }
            this.bodyGroup.add(this.shards);
            // A few glinting edge-highlight slivers (glowing volcanic veins).
            for (let i = 0; i < 5; i++) { const v = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.3, 4), this._mat(p.accent, 0.7, 0.3, p.accent)); const a = this.idRand() * Math.PI * 2; v.position.set(Math.cos(a) * 0.42, 0.7 + this.idRand() * 0.4, Math.sin(a) * 0.42); v.rotation.z = this.idRand(); this.shards.add(v); }
            // Cold glowing face peering between the shards.
            this.face.position.set(0, 1.0, 0.36); this.face.children[2].visible = false;
            // Obsidian wisps: sharp angular cones instead of soft tails.
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.13, 0.85, 4); this.leftWisp.material = glassMat; this.leftWisp.position.set(-0.42, 0.55, 0); this.leftWisp.rotation.z = 0.3;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.13, 0.85, 4); this.rightWisp.material = glassMat; this.rightWisp.position.set(0.42, 0.55, 0); this.rightWisp.rotation.z = -0.3;
            this._cascadeRules[0].hide.push(this.shards);
        }

        // ── Sentient Wound: a floating vertical bloody gash with an eye inside ─
        _buildSentientWound() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.0, eyeColor: 0x000000 });
            // Hide the friendly base body — this creature is a slit in the air.
            this.core.visible = false; this.core.children.forEach(c => { c.visible = false; });
            this.leftWisp.visible = true; this.rightWisp.visible = true;
            // CORE = the gash itself: two raw flesh lips meeting in a vertical seam.
            this.core.visible = true;
            this.core.geometry.dispose();
            this.core.geometry = new THREE.SphereGeometry(0.001, 4, 4); // collapse the old sphere to nothing
            this.core.position.y = 0.95; this.core.scale.set(1, 1, 1);
            const fleshMat = this._mat(p.bodyColor, 1.0, 0.55);            // raw red flesh
            const bloodMat = this._mat(0x2a0306, 1.0, 0.4, p.accent);      // dark wet interior
            // Two bowed lips (half-cylinders) forming the lens-shaped opening.
            const lipGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.3, 10, 1, false, 0, Math.PI);
            const leftLip = new THREE.Mesh(lipGeo, fleshMat); leftLip.position.set(0.12, 0, 0); leftLip.rotation.y = Math.PI;
            const rightLip = new THREE.Mesh(lipGeo, fleshMat); rightLip.position.set(-0.12, 0, 0);
            this.core.add(leftLip, rightLip);
            // Dark bleeding interior cavity behind the lips.
            const cavity = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 14), bloodMat);
            cavity.scale.set(0.6, 2.6, 0.5); cavity.position.z = -0.05; this.core.add(cavity);
            // Stitched torn edges: little flesh nubs running up the seam.
            for (let i = 0; i < 6; i++) {
                const sy = -0.55 + i * 0.22;
                for (const sx of [-0.17, 0.17]) {
                    const nub = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), fleshMat);
                    nub.position.set(sx, sy, 0.06); nub.rotation.z = (sx < 0 ? -1 : 1) * 0.9; this.core.add(nub);
                }
            }
            // FACE = a single bloodshot eye floating inside the cavity.
            this.face.children.forEach(c => { c.visible = false; });
            this.eyeBall = new THREE.Group();
            const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), this._mat(0xf4e6dc, 1.0, 0.2)); this.eyeBall.add(sclera);
            const iris = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), this._mat(p.accent, 1.0, 0.2, p.accent)); iris.position.z = 0.11; this.eyeBall.add(iris);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), this._mat(0x000000, 1.0, 0.1)); pupil.position.z = 0.165; this.eyeBall.add(pupil);
            // Bloodshot veins on the eye.
            for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const v = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), this._mat(0xaa1118, 0.85, 0.3)); v.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.12); v.rotation.z = a; this.eyeBall.add(v); }
            this.eyeBall.position.set(0, 0.95, 0.1); this.bodyGroup.add(this.eyeBall);
            this.face.position.copy(this.eyeBall.position); this.face.visible = false; // FACE part stands in for the eye via map below
            // Trailing sinew wisps: stringy tendons hanging from the gash.
            const sinewMat = this._mat(0x8a1c22, 0.9, 0.4);
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.CylinderGeometry(0.015, 0.06, 1.1, 6);
            this.leftWisp.material = sinewMat; this.leftWisp.position.set(-0.22, 0.35, 0); this.leftWisp.rotation.z = 0.4;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.CylinderGeometry(0.015, 0.06, 1.1, 6);
            this.rightWisp.material = sinewMat; this.rightWisp.position.set(0.22, 0.35, 0); this.rightWisp.rotation.z = -0.4;
            // little dripping blood beads off the sinew tips.
            this.drips = new THREE.Group();
            for (const dx of [-0.4, 0.4]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(0x5a0c10, 1.0, 0.3, p.accent)); d.scale.y = 1.5; d.position.set(dx, -0.2, 0); d._t = this.idRand(); this.drips.add(d); }
            this.bodyGroup.add(this.drips);
            // Wire dismemberment: FACE -> eye, CORE -> gash. Root CORE hides all.
            this._partMeshMap = { FACE: this.eyeBall, CORE: this.core, LEFT_WISP: this.leftWisp, RIGHT_WISP: this.rightWisp };
            this._cascadeRules = [
                { gone: ['CORE'], hide: [this.core, this.eyeBall, this.leftWisp, this.rightWisp, this.drips] },
                { gone: ['FACE'], hide: [this.eyeBall] },
                { gone: ['LEFT_WISP'], hide: [this.leftWisp] },
                { gone: ['RIGHT_WISP'], hide: [this.rightWisp] },
            ];
        }

        // ── Graveyard Haunt: mournful cemetery ghost draining vitality ──────
        _buildSprGraveyardHaunt() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.55, eyeColor: p.accent, eyeGlow: p.accent });
            // Weathered tombstone it is bound to.
            this.tomb = new THREE.Group();
            const stone = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.14), this._mat(0x5f6068, 1.0, 0.85)); stone.position.y = 0.3; this.tomb.add(stone);
            const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.14, 12, 1, false, 0, Math.PI), this._mat(0x5f6068, 1.0, 0.85)); arch.rotation.z = -Math.PI / 2; arch.position.set(0, 0.6, 0); this.tomb.add(arch);
            this.tomb.position.set(0, -0.05, -0.12); this.bodyGroup.add(this.tomb);
            // Draining vitality motes spiralling into the haunt.
            this.motes = new THREE.Group();
            for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), this._mat(p.accent, 0.85, 0.2, p.accent)); const a = (i / 8) * Math.PI * 2; m.position.set(Math.cos(a) * 0.75, 0.9, Math.sin(a) * 0.75); m._a = a; this.motes.add(m); }
            this.bodyGroup.add(this.motes);
            this._cascadeRules[0].hide.push(this.motes);
        }

        // ── Sunken Charnelhound: a low, four-legged houndlike apparition ────
        _buildSprSunkenCharnelhound() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.6, eyeColor: p.accent, eyeGlow: p.accent });
            // CORE reshaped into a lean elongated hound skull/head, slung low.
            this.core.geometry.dispose();
            this.core.geometry = new THREE.SphereGeometry(0.4, 14, 12);
            this.core.scale.set(1.3, 0.8, 1.05); this.core.position.y = 0.75;
            this.core.children.forEach(c => { c.visible = false; });
            const headMat = this.core.material;
            // Bony snout jutting forward.
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.4, 10), headMat); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.05, 0.42); this.core.add(snout);
            // Two ragged ears.
            for (const ex of [-0.24, 0.24]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 5), headMat); ear.position.set(ex, 0.34, -0.08); ear.rotation.x = -0.3; this.core.add(ear); }
            // Ghostly forelegs trailing off (the wisps become legs).
            this.leftWisp.geometry.dispose(); this.leftWisp.geometry = new THREE.ConeGeometry(0.14, 0.7, 8); this.leftWisp.position.set(-0.3, 0.4, 0.2); this.leftWisp.rotation.z = 0.15;
            this.rightWisp.geometry.dispose(); this.rightWisp.geometry = new THREE.ConeGeometry(0.14, 0.7, 8); this.rightWisp.position.set(0.3, 0.4, 0.2); this.rightWisp.rotation.z = -0.15;
            // Face placed on the hound snout, mouth hidden.
            this.face.position.set(0, 0.82, 0.32); this.face.children[2].visible = false;
            this.face.children[0].position.set(-0.16, 0.02, 0.14); this.face.children[1].position.set(0.16, 0.02, 0.14);
            // Sickly leaking mist pooling beneath it.
            this.mist = new THREE.Mesh(new THREE.CircleGeometry(0.7, 18), this._mat(p.accent, 0.2, 1.0, p.accent)); this.mist.rotation.x = -Math.PI / 2; this.mist.position.y = 0.03; this.bodyGroup.add(this.mist);
            this._cascadeRules[0].hide.push(this.mist);
        }

        // ── Mummified Mourner: bandage-wrapped grief spirit dragging wraps ─
        _buildSprMummifiedMourner() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.75, eyeColor: 0x000000 });
            // Sunken hollow eyes, no cheerful mouth.
            this.face.children[2].visible = false;
            this.face.children[0].material = this._mat(0x000000, 0.95, 0.2); this.face.children[1].material = this._mat(0x000000, 0.95, 0.2);
            // Wrapping bandage bands spiralling around the body.
            const wrapMat = this._mat(0xcabb90, 0.9, 0.8);
            this.wraps = new THREE.Group();
            for (let i = 0; i < 5; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.42 - i * 0.03, 0.05, 6, 18), wrapMat); band.position.y = 0.6 + i * 0.18; band.rotation.x = Math.PI / 2 + (this.idRand() - 0.5) * 0.3; this.wraps.add(band); }
            this.bodyGroup.add(this.wraps);
            // Trailing loose bandage ends dangling from the hem.
            this.tatters = new THREE.Group();
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.5 + this.idRand() * 0.3), wrapMat); strip.position.set(Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.3); strip.rotation.y = a; this.tatters.add(strip); }
            this.bodyGroup.add(this.tatters);
            this._cascadeRules[0].hide.push(this.wraps, this.tatters);
        }

        // ── Forgotten Thrall: a faint, half-erased spirit reenacting its end ─
        _buildSprForgottenThrall() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.4, eyeColor: p.accent, eyeGlow: p.accent });
            this.core.scale.set(0.95, 1.05, 0.95);
            // Fading fragments flickering off the body (barely-remembered self).
            this.fragments = new THREE.Group();
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const fr = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), this._mat(p.bodyColor, 0.3, 0.6)); fr.position.set(Math.cos(a) * 0.55, 0.9 + Math.sin(a * 2) * 0.35, Math.sin(a) * 0.4); fr.rotation.set(this.idRand() * 2, a, this.idRand() * 2); fr._a = a; this.fragments.add(fr); }
            this.bodyGroup.add(this.fragments);
            this._cascadeRules[0].hide.push(this.fragments);
        }

        // ── Plague Pallbearer: a shrouded bearer trailing sickly green rot ──
        _buildSprPlaguePallbearer() {
            const p = this.profile;
            this._ghostBase({ opacity: 0.8, eyeColor: p.accent, eyeGlow: p.accent });
            // A small coffin slab borne before it.
            this.coffin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.32), this._mat(0x4a3a2a, 1.0, 0.8)); this.coffin.position.set(0, 0.5, 0.4); this.bodyGroup.add(this.coffin);
            // Hooded shroud crown over the head.
            const shroudMat = this._mat(p.bodyColor, 0.85, 0.85);
            this.hood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), shroudMat); this.hood.position.set(0, 1.05, 0); this.bodyGroup.add(this.hood);
            this.face.children[2].visible = false; this.face.position.y = 0.92;
            // Rising rot spores.
            this.spores = new THREE.Group();
            for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), this._mat(p.accent, 0.7, 0.3, p.accent)); s.position.set((this.idRand() - 0.5) * 1.0, 0.4 + this.idRand() * 0.9, (this.idRand() - 0.5) * 0.6); s._t = this.idRand(); this.spores.add(s); }
            this.bodyGroup.add(this.spores);
            this._cascadeRules[0].hide.push(this.coffin, this.hood, this.spores);
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.8);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            // Shared hover + wisp sway.
            this.model.position.y = this._baseY + Math.sin(t * 1.5) * 0.09 * this.scale;
            if (this.leftWisp && this.leftWisp.visible) this.leftWisp.rotation.z = 0.5 + Math.sin(t * 2) * 0.2;
            if (this.rightWisp && this.rightWisp.visible) this.rightWisp.rotation.z = -0.5 - Math.sin(t * 2 + 0.5) * 0.2;

            switch (this.variant) {
                case 'anxietyelem': {
                    // Constant nervous tremble + darting eyes + dripping sweat.
                    this.model.position.x = Math.sin(t * (fast ? 30 : 18)) * 0.02 * this.scale;
                    if (this.core) this.core.rotation.z = Math.sin(t * 22) * 0.03;
                    if (this.darts) this.darts.children.forEach((e, i) => { e.position.x = Math.cos(e._a) * 0.6 + Math.sin(t * 9 + i) * 0.08; e.position.y = 0.9 + Math.sin(e._a) * 0.5 + Math.cos(t * 11 + i) * 0.06; });
                    if (this.sweat) this.sweat.children.forEach(s => { s.position.y -= 0.02; if (s.position.y < 0.3) s.position.y = 1.1; });
                    break;
                }
                case 'fearsiphon': {
                    if (this.swirl) { this.swirl.rotation.y = t * (fast ? 4 : 2); this.swirl.children.forEach(w => { const r = 0.7 - (Math.sin(t * 2 + w._a) * 0.5 + 0.5) * 0.3; w.position.x = Math.cos(w._a) * r; w.position.z = Math.sin(w._a) * r; }); }
                    if (this.bigEye) this.bigEye.rotation.y = Math.sin(t * 1.5) * 0.3;
                    break;
                }
                case 'ghostwisp': {
                    if (this._ghostMat) this._ghostMat.opacity = 0.3 + Math.abs(Math.sin(t * 1.8)) * 0.25; // flickers
                    break;
                }
                case 'graveyardhaunt': {
                    if (this.chains) this.chains.rotation.z = Math.sin(t * 3) * 0.05;
                    if (this.core) this.core.position.y = 0.9 + Math.sin(t * 1.2) * 0.06; // rises from the stone
                    break;
                }
                case 'lingeringspirit': {
                    if (this.keepsake) { this.keepsake.position.y = 0.62 + Math.sin(t * 2) * 0.04; this.keepsake.rotation.y = t * 1.0; }
                    if (this.reach && fast) this.reach.position.z = 0.55 + Math.abs(Math.sin(t * 6)) * 0.25;
                    break;
                }
                case 'lostmemory': {
                    if (this.photos) this.photos.rotation.y = t * 0.5;
                    if (this.motes) this.motes.children.forEach((m, i) => { m.position.y += Math.sin(t * 2 + i) * 0.003; });
                    break;
                }
                case 'minorshade': {
                    if (this._ghostMat) this._ghostMat.opacity = 0.5 + Math.sin(t * 2) * 0.18;
                    break;
                }
                case 'graspingshadow': {
                    if (this.fingers) this.fingers.children.forEach((f, i) => { f.rotation.x = Math.sin(t * (fast ? 6 : 2.5) + i) * 0.18; }); // clutching
                    if (this.core) this.core.position.y = 1.0 + Math.sin(t * 1.4) * 0.08; // rising
                    if (this.pool) this.pool.scale.setScalar(1 + Math.sin(t * 2) * 0.05);
                    break;
                }
                case 'miasmalantern': {
                    if (this.flame) { this.flame.scale.y = 1 + Math.sin(t * (fast ? 14 : 7)) * 0.25; this.flame.scale.x = 1 + Math.cos(t * 6) * 0.1; }
                    if (this.core) this.core.rotation.y = Math.sin(t * 0.8) * 0.25; // swinging on its handle
                    break;
                }
                case 'midnighthunter': {
                    if (this._ghostMat) this._ghostMat.opacity = 0.6 + Math.sin(t * 2.2) * 0.25; // fades in and out
                    if (this.hood) this.hood.rotation.y = Math.sin(t * 1.1) * 0.15;
                    break;
                }
                case 'phantomarcher': {
                    if (this.bow) this.bow.rotation.z = Math.sin(t * 1.2) * 0.1;
                    if (this.arm && fast) this.arm.position.x = -0.35 + Math.abs(Math.sin(t * 7)) * 0.18; // drawing
                    break;
                }
                case 'sorrowspecter': {
                    if (this.tears) this.tears.children.forEach(tr => { tr.position.y -= 0.012; tr.material.opacity = 0.8 * Math.max(0, (tr.position.y + 0.6)); if (tr.position.y < -0.6) { tr.position.y = -0.1; tr.material.opacity = 0.8; } });
                    if (this.core) this.core.rotation.z = Math.sin(t * 0.9) * 0.06; // mournful sway
                    break;
                }
                case 'spectralwisp': {
                    const pulse = 0.4 + Math.abs(Math.sin(t * 2.4)) * 0.35;
                    if (this._ghostMat) this._ghostMat.opacity = pulse;
                    if (this.halo) this.halo.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
                    break;
                }
                case 'veiledphantasm': {
                    if (this.cloak) this.cloak.rotation.y = Math.sin(t * 0.7) * 0.12; // billowing drape
                    if (this.folds) this.folds.children.forEach((f, i) => { f.rotation.z = Math.sin(t * 2 + i) * 0.12; });
                    if (this._ghostMat) this._ghostMat.opacity = 0.2 + Math.abs(Math.sin(t * 1.4)) * 0.2;
                    break;
                }
                case 'whisperingwraith': {
                    if (this.fray) this.fray.children.forEach((s, i) => { s.rotation.z = t * (fast ? 4 : 1.5) + i; s.position.y = 0.9 + Math.sin(t * 2 + s._a) * 0.3; });
                    if (this.rags) this.rags.children.forEach((r, i) => { r.rotation.z = Math.sin(t * 2.5 + i) * 0.25; });
                    if (this.face) this.face.children[2].scale.y = 1.6 + Math.sin(t * (fast ? 12 : 5)) * 0.5; // whispering jaw
                    break;
                }
                case 'ghosttiger': {
                    if (this.core) this.core.rotation.y = Math.sin(t * 1.2) * 0.18; // prowling head turn
                    if (this.fangs && fast) this.fangs.position.z = Math.abs(Math.sin(t * 8)) * 0.06;
                    if (this._ghostMat) this._ghostMat.opacity = 0.3 + Math.abs(Math.sin(t * 1.6)) * 0.2;
                    break;
                }
                case 'shadowexecutioner': {
                    if (this.axe) this.axe.rotation.z = 0.25 + Math.sin(t * (fast ? 7 : 1.5)) * (fast ? 0.6 : 0.08); // hefting / chopping
                    if (this.hood) this.hood.rotation.y = Math.sin(t * 0.9) * 0.12;
                    break;
                }
                case 'echowisp': {
                    if (this.rings) this.rings.children.forEach(r => {
                        const phase = (t * (fast ? 1.8 : 0.9) + r._i * 0.4) % 1;
                        const s = 0.4 + phase * 1.6; r.scale.setScalar(s); r.material.opacity = (0.6 - r._i * 0.08) * (1 - phase);
                    });
                    if (this.leftWisp) this.leftWisp.position.x = -0.32 + Math.sin(t * 24) * 0.015; // resonating prongs
                    if (this.rightWisp) this.rightWisp.position.x = 0.32 - Math.sin(t * 24) * 0.015;
                    break;
                }
                case 'obsidianwraith': {
                    if (this.shards) this.shards.rotation.y = t * (fast ? 1.6 : 0.5);
                    if (this.core) this.core.rotation.y = -t * 0.4;
                    break;
                }
                case 'sentientwound': {
                    // The gash gapes wider and narrower like a breathing slit.
                    if (this.core) this.core.scale.x = 1 + Math.sin(t * (fast ? 8 : 3)) * 0.3;
                    // Eye darts and shudders, searching.
                    if (this.eyeBall) { this.eyeBall.rotation.y = Math.sin(t * 2.2) * 0.5; this.eyeBall.rotation.x = Math.cos(t * 1.7) * 0.25; }
                    // Sinew wisps writhe; blood beads drip and reset.
                    if (this.leftWisp) this.leftWisp.rotation.z = 0.4 + Math.sin(t * 2.5) * 0.25;
                    if (this.rightWisp) this.rightWisp.rotation.z = -0.4 - Math.sin(t * 2.5 + 0.6) * 0.25;
                    if (this.drips) this.drips.children.forEach(d => { d.position.y -= 0.015; if (d.position.y < -0.7) d.position.y = -0.2; });
                    break;
                }
                case 'spr_graveyardhaunt': {
                    if (this.core) this.core.position.y = 0.9 + Math.sin(t * 1.2) * 0.06; // rising from the stone
                    if (this.motes) this.motes.children.forEach((m, i) => { const a = m._a + t * (fast ? 3 : 1.2); const r = 0.75 - (Math.sin(t * 1.5 + m._a) * 0.5 + 0.5) * 0.5; m.position.set(Math.cos(a) * r, 0.9 + Math.sin(t * 2 + i) * 0.1, Math.sin(a) * r); });
                    break;
                }
                case 'spr_sunkencharnelhound': {
                    if (this.core) this.core.rotation.y = Math.sin(t * 1.4) * 0.15; // sniffing head sway
                    if (this._ghostMat) this._ghostMat.opacity = 0.45 + Math.abs(Math.sin(t * 1.6)) * 0.2;
                    if (this.mist) this.mist.scale.setScalar(1 + Math.sin(t * 1.8) * 0.06);
                    break;
                }
                case 'spr_mummifiedmourner': {
                    if (this.wraps) this.wraps.rotation.y = Math.sin(t * 0.8) * 0.15;
                    if (this.tatters) this.tatters.children.forEach((s, i) => { s.rotation.z = Math.sin(t * 2 + i) * 0.15; });
                    if (this.core) this.core.rotation.z = Math.sin(t * 0.9) * 0.05; // mournful sway
                    break;
                }
                case 'spr_forgottenthrall': {
                    if (this._ghostMat) this._ghostMat.opacity = 0.25 + Math.abs(Math.sin(t * 1.3)) * 0.25; // flickering out of memory
                    if (this.fragments) this.fragments.children.forEach((fr, i) => { fr.rotation.z = t * (fast ? 3 : 1) + i; fr.position.y = 0.9 + Math.sin(t * 2 + fr._a) * 0.35; });
                    break;
                }
                case 'spr_plaguepallbearer': {
                    if (this.coffin) this.coffin.position.y = 0.5 + Math.sin(t * 1.4) * 0.03;
                    if (this.spores) this.spores.children.forEach(s => { s.position.y += 0.008; if (s.position.y > 1.5) s.position.y = 0.4; });
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.2);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, (this._ghostMat ? 0.7 : 1.0) * (1.0 - prog));
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY + prog * 0.5 * this.scale; // dissipates upward
            this.model.scale.multiplyScalar(1 + deltaTime * 0.3);
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new SpiritBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = S_PROFILES;
    reg('anxietyelem',     { aliases: ['anxietyelem'],     scale: S.anxietyelem.scale,     weapon: 0, create: make });
    reg('fearsiphon',      { aliases: ['fearsiphon'],      scale: S.fearsiphon.scale,      weapon: 0, create: make });
    reg('ghostwisp',       { aliases: ['ghostwisp'],       scale: S.ghostwisp.scale,       weapon: 0, create: make });
    reg('graveyardhaunt',  { aliases: ['graveyardhaunt'],  scale: S.graveyardhaunt.scale,  weapon: 0, create: make });
    reg('lingeringspirit', { aliases: ['lingeringspirit'], scale: S.lingeringspirit.scale, weapon: 0, create: make });
    reg('lostmemory',      { aliases: ['lostmemory'],      scale: S.lostmemory.scale,      weapon: 0, create: make });
    reg('minorshade',      { aliases: ['minorshade'],      scale: S.minorshade.scale,      weapon: 0, create: make });
    reg('graspingshadow',  { aliases: ['graspingshadow'],  scale: S.graspingshadow.scale,  weapon: 0, create: make });
    reg('miasmalantern',   { aliases: ['miasmalantern'],   scale: S.miasmalantern.scale,   weapon: 0, create: make });
    reg('midnighthunter',  { aliases: ['midnighthunter'],  scale: S.midnighthunter.scale,  weapon: 0, create: make });
    reg('phantomarcher',   { aliases: ['phantomarcher'],   scale: S.phantomarcher.scale,   weapon: 0, create: make });
    reg('sorrowspecter',   { aliases: ['sorrowspecter'],   scale: S.sorrowspecter.scale,   weapon: 0, create: make });
    reg('spectralwisp',    { aliases: ['spectralwisp'],    scale: S.spectralwisp.scale,    weapon: 0, create: make });
    reg('veiledphantasm',  { aliases: ['veiledphantasm'],  scale: S.veiledphantasm.scale,  weapon: 0, create: make });
    reg('whisperingwraith',{ aliases: ['whisperingwraith'],scale: S.whisperingwraith.scale,weapon: 0, create: make });
    reg('ghosttiger',      { aliases: ['ghosttiger'],      scale: S.ghosttiger.scale,      weapon: 0, create: make });
    reg('shadowexecutioner',{aliases: ['shadowexecutioner'],scale: S.shadowexecutioner.scale,weapon: 0, create: make });
    reg('echowisp',        { aliases: ['echowisp'],        scale: S.echowisp.scale,        weapon: 0, create: make });
    reg('obsidianwraith',  { aliases: ['obsidianwraith'],  scale: S.obsidianwraith.scale,  weapon: 0, create: make });
    reg('sentientwound',   { aliases: ['sentientwound'],   scale: S.sentientwound.scale,   weapon: 0, create: make });
    reg('spr_graveyardhaunt',     { aliases: ['spr_graveyardhaunt'],     scale: S.spr_graveyardhaunt.scale,     weapon: 0, create: make });
    reg('spr_sunkencharnelhound', { aliases: ['spr_sunkencharnelhound'], scale: S.spr_sunkencharnelhound.scale, weapon: 0, create: make });
    reg('spr_mummifiedmourner',   { aliases: ['spr_mummifiedmourner'],   scale: S.spr_mummifiedmourner.scale,   weapon: 0, create: make });
    reg('spr_forgottenthrall',    { aliases: ['spr_forgottenthrall'],    scale: S.spr_forgottenthrall.scale,    weapon: 0, create: make });
    reg('spr_plaguepallbearer',   { aliases: ['spr_plaguepallbearer'],   scale: S.spr_plaguepallbearer.scale,   weapon: 0, create: make });

    const NAMED = {
        anxietyelem:     ["Anxiety Elemental"],
        fearsiphon:      ["Fear Siphon"],
        ghostwisp:       ["Ghost Wisp"],
        graveyardhaunt:  [],
        lingeringspirit: ["Lingering Spirit"],
        lostmemory:      ["Lost Memory"],
        minorshade:      ["Minor Shade"],
        graspingshadow:  ["Grasping Shadow"],
        miasmalantern:   ["Miasma Lantern"],
        midnighthunter:  ["Midnight Hunter"],
        phantomarcher:   ["Phantom Archer"],
        sorrowspecter:   ["Sorrow Specter"],
        spectralwisp:    ["Spectral Wisp"],
        veiledphantasm:  ["Veiled Phantasm"],
        whisperingwraith:["Whispering Wraith"],
        ghosttiger:      ["Ghost Tiger"],
        shadowexecutioner:["Shadow Executioner"],
        echowisp:        ["Echo Wisp"],
        obsidianwraith:  ["Obsidian Wraith"],
        sentientwound:   ["Sentient Wound"],
        spr_graveyardhaunt:     ["Graveyard Haunt"],
        spr_sunkencharnelhound: ["Sunken Charnelhound"],
        spr_mummifiedmourner:   ["Mummified Mourner"],
        spr_forgottenthrall:    ["Forgotten Thrall"],
        spr_plaguepallbearer:   ["Plague Pallbearer"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Spirit uniques registered');

    ;[['u_squishingecho',2.1]].forEach(([k,sc]) => reg(k, { aliases: [k], scale: sc, weapon: 0, create: make }));
})();
