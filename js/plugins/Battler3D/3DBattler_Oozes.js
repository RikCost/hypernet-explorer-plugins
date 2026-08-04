//=============================================================================
// 3D Battler System - Ooze Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke slime one-off models (expired ooze, rubber reality blob,
 * azure slime, crimson jelly) + name-based assignment. Requires 3DBattlerSystem
 * + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Ooze Uniques
 * ============================================================================
 *
 * Distinct procedural slimes shaped from each enemy's flavour text, assigned by
 * exact name (override with <Battler3D: key>). They map the Slime archetype keys
 * (CORE/UPPER_BODY/LOWER_BODY/PSEUDOPOD_1/PSEUDOPOD_2) so dismemberment works.
 *
 * Registered: expiredooze, rubberblob, azureslime, crimsonjelly
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Oozes] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const O_PROFILES = {
        expiredooze:  { variant: 'expiredooze',  scale: 2.0, texturePool: 'pale',    bodyColor: 0xd8d0a0, accent: 0x8aaa44, hue: [0.16, 0.05], sat: [0.35, 0.10], lit: [0.62, 0.08] },
        rubberblob:   { variant: 'rubberblob',   scale: 2.0, texturePool: 'crystal', bodyColor: 0x88ccee, accent: 0xff66cc, hue: [0.55, 0.20], sat: [0.40, 0.15], lit: [0.60, 0.10] },
        azureslime:   { variant: 'azureslime',   scale: 2.0, texturePool: 'water',   bodyColor: 0x3a8ad8, accent: 0xaee0ff, hue: [0.58, 0.06], sat: [0.55, 0.12], lit: [0.55, 0.10] },
        crimsonjelly: { variant: 'crimsonjelly', scale: 2.2, texturePool: 'fire',    bodyColor: 0xaa1828, accent: 0xff5566, hue: [0.99, 0.03], sat: [0.65, 0.12], lit: [0.40, 0.10] },
        // Enemies 201-400 slimes (feature-driven generic build).
        emeraldooze:  { variant: 'emeraldooze',  scale: 2.0, texturePool: 'green', bodyColor: 0x3a9a4a, accent: 0x66cc44, hue: [0.32, 0.05], sat: [0.55, 0.10], lit: [0.42, 0.08], feature: 'fumes', slimeOpacity: 0.85 },
        goldenpudding:{ variant: 'goldenpudding', scale: 2.0, texturePool: 'metal', bodyColor: 0xd4af37, accent: 0xffe080, hue: [0.13, 0.04], sat: [0.60, 0.10], lit: [0.55, 0.08], feature: 'metallic', slimeOpacity: 1.0 },
        grassslime:   { variant: 'grassslime',   scale: 2.0, texturePool: 'foliage', bodyColor: 0x6aaa4a, accent: 0x4a8a2a, hue: [0.28, 0.05], sat: [0.50, 0.10], lit: [0.45, 0.08], feature: 'grass', slimeOpacity: 0.9 },
        greenslime:   { variant: 'greenslime',   scale: 2.0, texturePool: 'green', bodyColor: 0x4a9a3a, accent: 0x88cc55, hue: [0.30, 0.05], sat: [0.55, 0.10], lit: [0.45, 0.08], slimeOpacity: 0.85 },
        inkblotchild: { variant: 'inkblotchild', scale: 2.1, texturePool: 'void', bodyColor: 0x1a1a22, accent: 0x4a4a55, hue: [0.66, 0.06], sat: [0.20, 0.08], lit: [0.16, 0.06], feature: 'child', slimeOpacity: 0.9 },
        mudslime:     { variant: 'mudslime',     scale: 2.0, texturePool: 'wood', bodyColor: 0x6a5238, accent: 0x8a6a48, hue: [0.09, 0.04], sat: [0.40, 0.10], lit: [0.34, 0.08], slimeOpacity: 0.95 },
        pinkslime:    { variant: 'pinkslime',    scale: 2.0, texturePool: 'pale', bodyColor: 0xee99bb, accent: 0xffbbdd, hue: [0.92, 0.05], sat: [0.40, 0.10], lit: [0.66, 0.08], slimeOpacity: 0.8 },
        sandslime:    { variant: 'sandslime',    scale: 2.0, texturePool: 'bone', bodyColor: 0xc8b088, accent: 0xddc8a0, hue: [0.11, 0.04], sat: [0.30, 0.08], lit: [0.62, 0.08], slimeOpacity: 0.9 },
        shockslime:   { variant: 'shockslime',   scale: 2.0, texturePool: 'metal', bodyColor: 0xeedd44, accent: 0xffff66, hue: [0.14, 0.04], sat: [0.70, 0.10], lit: [0.55, 0.08], feature: 'arcs', slimeOpacity: 0.8 },
        slimeknight:  { variant: 'slimeknight',  scale: 2.1, texturePool: 'water', bodyColor: 0x4a8ad8, accent: 0x88bbee, hue: [0.58, 0.05], sat: [0.55, 0.10], lit: [0.50, 0.08], feature: 'knight', slimeOpacity: 0.8 },
        toxicsludge:  { variant: 'toxicsludge',  scale: 2.1, texturePool: 'green', bodyColor: 0x6a8a3a, accent: 0x9aff44, hue: [0.25, 0.05], sat: [0.55, 0.10], lit: [0.40, 0.08], feature: 'fumes', slimeOpacity: 0.85 },
        voidgel:      { variant: 'voidgel',      scale: 2.1, texturePool: 'void', bodyColor: 0x1a1028, accent: 0x9933cc, hue: [0.78, 0.06], sat: [0.45, 0.12], lit: [0.18, 0.06], feature: 'void', slimeOpacity: 0.9 },
        // Bespoke batch.
        fleshhorror:    { variant: 'fleshhorror',    scale: 2.2, texturePool: 'pale',    bodyColor: 0xd8a890, accent: 0xc06860, hue: [0.04, 0.03], sat: [0.30, 0.08], lit: [0.66, 0.08] },
        // ── 15 horrors split out of the shared `fleshhorror` rig ──────────────
        fh_skinballoon:      { variant: 'fh_skinballoon',      scale: 2.2, texturePool: 'pale',  bodyColor: 0xd8a890, accent: 0xc06860, hue: [0.04, 0.03], sat: [0.30, 0.08], lit: [0.66, 0.08] },
        fh_brainswarmer:     { variant: 'fh_brainswarmer',     scale: 2.2, texturePool: 'flesh', bodyColor: 0xd89aa8, accent: 0xff6688, hue: [0.95, 0.05], sat: [0.40, 0.10], lit: [0.62, 0.08] },
        fh_echomaw:          { variant: 'fh_echomaw',          scale: 2.4, texturePool: 'flesh', bodyColor: 0x6a3a3a, accent: 0xff6644, hue: [0.02, 0.04], sat: [0.45, 0.12], lit: [0.34, 0.10] },
        fh_soulharvester:    { variant: 'fh_soulharvester',    scale: 2.4, texturePool: 'void',  bodyColor: 0x2a2a3a, accent: 0x66ffcc, hue: [0.46, 0.08], sat: [0.35, 0.12], lit: [0.24, 0.08] },
        fh_bonechewer:       { variant: 'fh_bonechewer',       scale: 2.3, texturePool: 'bone',  bodyColor: 0xcabd92, accent: 0xff8866, hue: [0.11, 0.04], sat: [0.30, 0.10], lit: [0.56, 0.10] },
        fh_crimsonharvester: { variant: 'fh_crimsonharvester', scale: 2.3, texturePool: 'fire',  bodyColor: 0x6a1018, accent: 0xff3344, hue: [0.99, 0.03], sat: [0.65, 0.12], lit: [0.30, 0.10] },
        fh_etherealdevourer: { variant: 'fh_etherealdevourer', scale: 2.3, texturePool: 'crystal',bodyColor: 0x8899cc, accent: 0xaaccff, hue: [0.60, 0.06], sat: [0.30, 0.10], lit: [0.62, 0.10] },
        fh_migo:             { variant: 'fh_migo',             scale: 2.2, texturePool: 'flesh', bodyColor: 0x9a6a4a, accent: 0xff99cc, hue: [0.06, 0.04], sat: [0.40, 0.10], lit: [0.40, 0.10] },
        fh_abyssaldevourer:  { variant: 'fh_abyssaldevourer',  scale: 2.6, texturePool: 'void',  bodyColor: 0x1a2a3a, accent: 0x4488aa, hue: [0.56, 0.06], sat: [0.45, 0.12], lit: [0.20, 0.08] },
        fh_carrionstalker:   { variant: 'fh_carrionstalker',   scale: 2.2, texturePool: 'flesh', bodyColor: 0x4a3a2a, accent: 0xaa4422, hue: [0.07, 0.04], sat: [0.40, 0.10], lit: [0.30, 0.08] },
        fh_bleedingstatue:   { variant: 'fh_bleedingstatue',   scale: 2.3, texturePool: 'pale',  bodyColor: 0x9a958c, accent: 0xcc1818, hue: [0.0, 0.04], sat: [0.10, 0.06], lit: [0.58, 0.08] },
        fh_geometrydevourer: { variant: 'fh_geometrydevourer', scale: 2.3, texturePool: 'crystal',bodyColor: 0x3a2a5a, accent: 0x66ffee, hue: [0.50, 0.20], sat: [0.50, 0.15], lit: [0.40, 0.10] },
        fh_womb:             { variant: 'fh_womb',             scale: 2.4, texturePool: 'flesh', bodyColor: 0xc88a8a, accent: 0xff7799, hue: [0.97, 0.04], sat: [0.40, 0.10], lit: [0.55, 0.10] },
        fh_fleshcalculator:  { variant: 'fh_fleshcalculator',  scale: 2.3, texturePool: 'flesh', bodyColor: 0xb86a6a, accent: 0x66ff88, hue: [0.0, 0.04], sat: [0.40, 0.10], lit: [0.44, 0.10] },
        fh_breathingbuilding:{ variant: 'fh_breathingbuilding',scale: 2.6, texturePool: 'wood',  bodyColor: 0x8a7a6a, accent: 0xcc8844, hue: [0.08, 0.04], sat: [0.30, 0.10], lit: [0.46, 0.10] },
        grotesqueslime: { variant: 'grotesqueslime', scale: 2.1, texturePool: 'wood',    bodyColor: 0x6a4a2a, accent: 0x8a6a3a, hue: [0.08, 0.03], sat: [0.45, 0.10], lit: [0.32, 0.08] },
        moltenslag:     { variant: 'moltenslag',     scale: 2.1, texturePool: 'fire',    bodyColor: 0x401008, accent: 0xff7722, hue: [0.04, 0.03], sat: [0.70, 0.12], lit: [0.30, 0.10] },
        pumpkinslime:   { variant: 'pumpkinslime',   scale: 2.1, texturePool: 'fire',    bodyColor: 0xdd6a18, accent: 0xffcc33, hue: [0.07, 0.03], sat: [0.70, 0.10], lit: [0.50, 0.08] },
        rainbowslime:   { variant: 'rainbowslime',   scale: 2.0, texturePool: 'crystal', bodyColor: 0xcccccc, accent: 0xffffff, hue: [0.50, 0.50], sat: [0.60, 0.20], lit: [0.60, 0.10] },
        seeingslime:    { variant: 'seeingslime',    scale: 2.1, texturePool: 'pale',    bodyColor: 0xd0cabc, accent: 0xfff8e0, hue: [0.12, 0.04], sat: [0.18, 0.06], lit: [0.66, 0.08] },
        // Bespoke batch 2.
        skulmireslime:      { variant: 'skulmireslime',      scale: 2.1, texturePool: 'void',  bodyColor: 0x223028, accent: 0x4a2a55, hue: [0.42, 0.06], sat: [0.30, 0.10], lit: [0.18, 0.06] },
        thunderblob:        { variant: 'thunderblob',        scale: 2.0, texturePool: 'water', bodyColor: 0x2a5ad8, accent: 0xaaddff, hue: [0.60, 0.05], sat: [0.65, 0.10], lit: [0.50, 0.10] },
        toxicamalgam:       { variant: 'toxicamalgam',       scale: 2.2, texturePool: 'green', bodyColor: 0x6a8a3a, accent: 0xbb44cc, hue: [0.28, 0.10], sat: [0.55, 0.15], lit: [0.42, 0.10] },
        causticslime:       { variant: 'causticslime',       scale: 2.0, texturePool: 'green', bodyColor: 0xaacc22, accent: 0xddff44, hue: [0.20, 0.04], sat: [0.70, 0.10], lit: [0.50, 0.08] },
        toxicooze:          { variant: 'toxicooze',          scale: 2.0, texturePool: 'green', bodyColor: 0x2a8a3a, accent: 0x115522, hue: [0.34, 0.04], sat: [0.65, 0.10], lit: [0.40, 0.08] },
        virulentslimefiend: { variant: 'virulentslimefiend', scale: 2.1, texturePool: 'pale',  bodyColor: 0xc8d0b0, accent: 0x9aaa66, hue: [0.22, 0.05], sat: [0.25, 0.08], lit: [0.62, 0.08] },
        // Bespoke batch 3.
        sewersslime:      { variant: 'sewersslime',      scale: 2.1, texturePool: 'wood',  bodyColor: 0x6a6048, accent: 0x4a5530, hue: [0.12, 0.05], sat: [0.25, 0.08], lit: [0.34, 0.08] },
        moltenpudding:    { variant: 'moltenpudding',    scale: 2.1, texturePool: 'fire',  bodyColor: 0xcc2a18, accent: 0xffbb33, hue: [0.02, 0.03], sat: [0.75, 0.10], lit: [0.45, 0.10] },
        swarminghivemind: { variant: 'swarminghivemind', scale: 2.1, texturePool: 'crystal', bodyColor: 0x6688cc, accent: 0xddaaff, hue: [0.62, 0.18], sat: [0.50, 0.15], lit: [0.55, 0.10] },
        og_gelatinouspudding: { variant: 'og_gelatinouspudding', scale: 2.1, texturePool: 'green', bodyColor: 0x88aacc, accent: 0xaaddff, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.7 },
        og_gelatinousooze: { variant: 'og_gelatinousooze', scale: 2.1, texturePool: 'green', bodyColor: 0x6aaa8a, accent: 0x88ddbb, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.7 },
        og_moltenmirespawn: { variant: 'og_moltenmirespawn', scale: 2.1, texturePool: 'green', bodyColor: 0x8a3a1a, accent: 0xff7722, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.9 },
        og_glitteringlarva: { variant: 'og_glitteringlarva', scale: 2.1, texturePool: 'green', bodyColor: 0xd4af37, accent: 0xffe080, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.85 },
        og_ochrejellyswarm: { variant: 'og_ochrejellyswarm', scale: 2.1, texturePool: 'green', bodyColor: 0xcc9a3a, accent: 0xffcc55, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.8 },
        og_swarmingmirespawn: { variant: 'og_swarmingmirespawn', scale: 2.1, texturePool: 'green', bodyColor: 0x5a7a3a, accent: 0x88cc44, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.85 },
        og_gelatinoushuskbeetle: { variant: 'og_gelatinoushuskbeetle', scale: 2.1, texturePool: 'green', bodyColor: 0x6a6a4a, accent: 0xaacc66, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.8 },
        og_discordlarva: { variant: 'og_discordlarva', scale: 2.1, texturePool: 'green', bodyColor: 0xcc4488, accent: 0xff88cc, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.8 },
        og_skitteringdronebug: { variant: 'og_skitteringdronebug', scale: 2.1, texturePool: 'green', bodyColor: 0x5a4a7a, accent: 0xaa88ff, hue:[0.3,0.2], sat:[0.45,0.15], lit:[0.45,0.12], slimeOpacity: 0.85 },
    };

    class OozeBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = O_PROFILES[creatureType] || O_PROFILES.azureslime;
            super(scale, offsetY, battler, profile, 0, creatureType || 'azureslime');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
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
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.85 : rough)); }

        // Shared squishy slime body: stacked blobs + suspended core + 2 pseudopods.
        _oozeBase(o) {
            o = o || {};
            const p = this.profile;
            const bodyMat = o.bodyMat || this._skinMat(p.bodyColor, 0.6);
            if (o.opacity != null) bodyMat.opacity = o.opacity;
            this._oozeMat = bodyMat;
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 14), bodyMat); this.lowerBody.position.y = 0.45; this.lowerBody.scale.set(1.1, 0.8, 1.1); this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 14), bodyMat); this.upperBody.position.y = 0.95; this.upperBody.scale.set(1.0, 0.95, 1.0); this.bodyGroup.add(this.upperBody);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), this._mat(o.coreColor || p.accent, 1.0, 0.4, o.coreColor || p.accent)); this.core.position.y = 0.6; this.bodyGroup.add(this.core);
            // Eyes are children of upperBody, so their positions are LOCAL to its
            // centre (already at y=0.95, radius 0.42). Sit them just above centre on
            // the front of the blob - using world-space y here floated them off the
            // top of the model.
            const eyeMat = this._mat(0x111111, 1.0, 0.3);
            const le = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeMat); le.position.set(-0.16, 0.06, 0.36);
            const re = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeMat); re.position.set(0.16, 0.06, 0.36);
            this.upperBody.add(le, re);
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), bodyMat); this.pseudopod1.position.set(-0.6, 0.35, 0.1); this.pseudopod1.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), bodyMat); this.pseudopod2.position.set(0.6, 0.35, -0.1); this.pseudopod2.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod2);
            this._partMeshMap = { CORE: this.core, UPPER_BODY: this.upperBody, LOWER_BODY: this.lowerBody, PSEUDOPOD_1: this.pseudopod1, PSEUDOPOD_2: this.pseudopod2 };
            this._cascadeRules = [
                { gone: ['CORE'], hide: [this.core, this.upperBody, this.lowerBody, this.pseudopod1, this.pseudopod2] },
                { gone: ['UPPER_BODY'], hide: [this.upperBody] },
                { gone: ['LOWER_BODY'], hide: [this.lowerBody] },
                { gone: ['PSEUDOPOD_1'], hide: [this.pseudopod1] },
                { gone: ['PSEUDOPOD_2'], hide: [this.pseudopod2] },
            ];
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'rubberblob':   this._buildRubberBlob(); break;
                case 'crimsonjelly': this._buildCrimsonJelly(); break;
                case 'expiredooze':  this._buildExpiredOoze(); break;
                case 'azureslime':   this._buildAzureSlime(); break;
                case 'fleshhorror':       this._buildFhSkinballoon(); break;
                case 'fh_skinballoon':    this._buildFhSkinballoon(); break;
                case 'fh_brainswarmer':   this._buildFhBrainswarmer(); break;
                case 'fh_echomaw':        this._buildFhEchomaw(); break;
                case 'fh_soulharvester':  this._buildFhSoulharvester(); break;
                case 'fh_bonechewer':     this._buildFhBonechewer(); break;
                case 'fh_crimsonharvester': this._buildFhCrimsonharvester(); break;
                case 'fh_etherealdevourer': this._buildFhEtherealdevourer(); break;
                case 'fh_migo':           this._buildFhMigo(); break;
                case 'fh_abyssaldevourer':this._buildFhAbyssaldevourer(); break;
                case 'fh_carrionstalker': this._buildFhCarrionstalker(); break;
                case 'fh_bleedingstatue': this._buildFhBleedingstatue(); break;
                case 'fh_geometrydevourer': this._buildFhGeometrydevourer(); break;
                case 'fh_womb':           this._buildFhWomb(); break;
                case 'fh_fleshcalculator':this._buildFhFleshcalculator(); break;
                case 'fh_breathingbuilding': this._buildFhBreathingbuilding(); break;
                case 'grotesqueslime': this._buildGrotesqueSlime(); break;
                case 'moltenslag':     this._buildMoltenSlag(); break;
                case 'pumpkinslime':   this._buildPumpkinSlime(); break;
                case 'rainbowslime':   this._buildRainbowSlime(); break;
                case 'seeingslime':    this._buildSeeingSlime(); break;
                case 'skulmireslime':      this._buildSkulmireSlime(); break;
                case 'thunderblob':        this._buildThunderBlob(); break;
                case 'toxicamalgam':       this._buildToxicAmalgam(); break;
                case 'causticslime':       this._buildCausticSlime(); break;
                case 'toxicooze':          this._buildToxicOoze(); break;
                case 'virulentslimefiend': this._buildVirulentSlimefiend(); break;
                case 'sewersslime':        this._buildSewersSlime(); break;
                case 'moltenpudding':      this._buildMoltenPudding(); break;
                case 'swarminghivemind':   this._buildSwarmingHivemind(); break;
                default:             this._buildGeneric(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Expired Ooze: curdled dairy gone bad, green mold + drips ─────────
        _buildExpiredOoze() {
            const p = this.profile;
            this._oozeBase({ coreColor: 0x6a8a30 });
            // Mold spots clinging to the surface.
            this.spots = new THREE.Group();
            for (let i = 0; i < 9; i++) {
                const a = this.idRand() * Math.PI * 2, e = this.idRand() * Math.PI * 0.5;
                const spot = new THREE.Mesh(new THREE.SphereGeometry(0.07 + this.idRand() * 0.05, 8, 8), this._mat(p.accent, 1.0, 0.9));
                spot.position.set(Math.cos(a) * 0.6, 0.55 + Math.cos(e) * 0.5, Math.sin(a) * 0.55); spot.scale.y = 0.4;
                this.spots.add(spot);
            }
            this.bodyGroup.add(this.spots);
            // Sour drips hanging off the rim.
            this.drips = new THREE.Group();
            for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const dr = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), this._oozeMat); dr.position.set(Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.5); dr.scale.y = 1.6; dr._base = 0.15; dr._t = this.idRand(); this.drips.add(dr); }
            this.bodyGroup.add(this.drips);
        }

        // ── Rubber Reality Blob: translucent protoplasm warping colour ───────
        _buildRubberBlob() {
            this._oozeBase({ opacity: 0.55 });
            // Reality-warp rings rippling outward.
            this.rings = new THREE.Group();
            for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.5 + i * 0.12, 0.02, 6, 24), this._mat(this.profile.accent, 0.6, 0.3, this.profile.accent)); r.position.y = 0.6; r.rotation.x = Math.PI / 2; r._i = i; this.rings.add(r); }
            this.bodyGroup.add(this.rings);
        }

        // ── Azure Slime: clear watery blob shedding droplets ────────────────
        _buildAzureSlime() {
            this._oozeBase({ opacity: 0.7 });
            this.droplets = new THREE.Group();
            for (let i = 0; i < 6; i++) { const a = this.idRand() * Math.PI * 2; const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this._mat(this.profile.accent, 0.8, 0.2, this.profile.accent)); d.position.set(Math.cos(a) * 0.4, 0.4 + this.idRand() * 0.9, Math.sin(a) * 0.4); d.scale.y = 1.4; d._t = this.idRand(); this.droplets.add(d); }
            this.bodyGroup.add(this.droplets);
        }

        // ── Crimson Jelly: deep-red life-draining ooze with inclusions ──────
        _buildCrimsonJelly() {
            this._oozeBase({ opacity: 0.8 });
            // Drained remains suspended inside (small dark inclusions).
            this.inclusions = new THREE.Group();
            for (let i = 0; i < 7; i++) { const inc = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + this.idRand() * 0.04, 0), this._mat(0x3a0a10, 1.0, 0.6)); inc.position.set((this.idRand() - 0.5) * 0.7, 0.4 + this.idRand() * 0.8, (this.idRand() - 0.5) * 0.6); this.inclusions.add(inc); }
            this.bodyGroup.add(this.inclusions);
        }

        // ── Skin Balloon: inflated translucent sac of stretched human skin ──
        // Wire whichever of core/upper/lower/pseudopods are set into the cascade,
        // and opt out of the generic ooze squish (these are not blobby).
        _fhWire() {
            const c = this.core, u = this.upperBody, l = this.lowerBody, p1 = this.pseudopod1, p2 = this.pseudopod2;
            const set = {}, add = (k, m) => { if (m) set[k] = m; };
            add('CORE', c); add('UPPER_BODY', u); add('LOWER_BODY', l); add('PSEUDOPOD_1', p1); add('PSEUDOPOD_2', p2);
            this._partMeshMap = set;
            this._cascadeRules = [
                { gone: ['CORE'], hide: [c, u, l, p1, p2].filter(Boolean) },
                { gone: ['UPPER_BODY'], hide: [u].filter(Boolean) },
                { gone: ['LOWER_BODY'], hide: [l].filter(Boolean) },
                { gone: ['PSEUDOPOD_1'], hide: [p1].filter(Boolean) },
                { gone: ['PSEUDOPOD_2'], hide: [p2].filter(Boolean) },
            ];
            this._noSquish = true;
        }
        _fhEyesPair(parent, z, y, r) { r = r || 0.08; z = z != null ? z : 0.5; y = y || 0.05; for (const x of [-0.16, 0.16]) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), this._mat(0xece4dc, 1, 0.3)); e.position.set(x, y, z); const pup = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 8, 8), this._mat(0x111111, 1, 0.2)); pup.position.z = r * 0.7; e.add(pup); parent.add(e); } }
        _fhEyesScatter(parent, n, r, spread, y, z) { r = r || 0.06; spread = spread || 0.4; y = y || 0.7; z = z != null ? z : 0.0; for (let i = 0; i < n; i++) { const a = i * 2.39996; const e = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 9), this._mat(0xffe6c0, 1, 0.3)); e.position.set(Math.cos(a) * spread, y + Math.sin(i * 1.7) * spread * 0.7, z + Math.sin(a) * spread * 0.6); const pup = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 6, 6), this._mat(0x111111, 1, 0.2)); pup.position.y = -r * 0.4; e.add(pup); parent.add(e); } }

        // ── Skin Balloon: inflated taut sac of stretched skin tied at a knot ─
        _buildFhSkinballoon() {
            const p = this.profile; const skinMat = this._skinMat(p.bodyColor, 0.45); skinMat.opacity = 0.62; this._oozeMat = skinMat;
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 16), skinMat); this.lowerBody.position.y = 0.7; this.lowerBody.scale.set(1, 1.25, 1); this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), skinMat); this.upperBody.position.y = 1.55; this.upperBody.scale.set(1, 0.7, 1); this.bodyGroup.add(this.upperBody);
            const knot = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.05, 8, 14), this._mat(p.accent, 1, 0.6)); knot.position.y = 1.62; knot.rotation.x = Math.PI / 2; this.upperBody.add(knot);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(0xc07868, 1, 0.7)); this.core.position.y = 0.8; this.core.scale.set(1.3, 0.8, 0.6); this.bodyGroup.add(this.core);
            this._fhEyesPair(this.lowerBody, 0.62, 0.1);
            const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), this._mat(0x5a2020, 1, 0.7)); mouth.position.set(0, -0.18, 0.6); mouth.rotation.x = Math.PI; this.lowerBody.add(mouth);
            this.pseudopod1 = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), skinMat); this.pseudopod1.position.set(-0.55, 0.3, 0); this.pseudopod1.rotation.z = 0.5; this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), skinMat); this.pseudopod2.position.set(0.55, 0.3, 0); this.pseudopod2.rotation.z = -0.5; this.bodyGroup.add(this.pseudopod2);
            this._fhWire();
        }
        // ── Brain Swarmer: a heaving mass of cerebral folds + budding brains ─
        _buildFhBrainswarmer() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.6);
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 14), m); this.lowerBody.position.y = 0.7; this.bodyGroup.add(this.lowerBody);
            for (let i = 0; i < 14; i++) { const a = i * 2.39996; const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), m); lobe.position.set(Math.cos(a) * 0.45, 0.7 + Math.sin(i * 1.3) * 0.4, Math.sin(a) * 0.4); this.bodyGroup.add(lobe); }
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(p.accent, 1, 0.4, p.accent)); this.core.position.y = 0.7; this.bodyGroup.add(this.core);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), m); this.upperBody.position.y = 1.2; this.bodyGroup.add(this.upperBody);
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), m); this.pseudopod1.position.set(-0.6, 1.0, 0.2); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), m); this.pseudopod2.position.set(0.6, 1.1, -0.1); this.bodyGroup.add(this.pseudopod2);
            this._fhEyesPair(this.lowerBody, 0.46, 0.05);
            this._fhWire();
        }
        // ── Echo Maw: a cavernous gaping throat ringed with teeth ────────────
        _buildFhEchomaw() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.7);
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 14), m); this.lowerBody.position.y = 0.8; this.lowerBody.scale.set(1.1, 1.0, 1.0); this.bodyGroup.add(this.lowerBody);
            const gullet = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), this._mat(0x200808, 1, 0.8)); gullet.position.set(0, 0.85, 0.25); gullet.rotation.x = -1.3; this.bodyGroup.add(gullet);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), this._mat(p.accent, 1, 0.4, p.accent)); this.core.position.set(0, 0.85, 0.05); this.bodyGroup.add(this.core);
            for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), this._mat(0xe8dcc0, 1, 0.4)); tooth.position.set(Math.cos(a) * 0.42, 0.85 + Math.sin(a) * 0.36, 0.5); tooth.lookAt(Math.cos(a) * 0.42, 0.85 + Math.sin(a) * 0.36, 2); this.bodyGroup.add(tooth); }
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), m); this.upperBody.position.y = 1.5; this.bodyGroup.add(this.upperBody);
            this._fhWire();
        }
        // ── Soul Harvester: a ghostly shroud clutching a soul-reaping scythe ─
        _buildFhSoulharvester() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.5); m.opacity = 0.6;
            this.lowerBody = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 12, 1, true), m); this.lowerBody.position.y = 0.9; this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 14, 0, Math.PI * 2, 0, Math.PI * 0.7), m); this.upperBody.position.y = 1.7; this.bodyGroup.add(this.upperBody);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), this._mat(p.accent, 1, 0.3, p.accent)); this.core.position.y = 1.6; this.bodyGroup.add(this.core);
            this._fhEyesPair(this.upperBody, 0.22, -0.05, 0.06);
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), this._mat(0x2a1a10, 1, 0.8)); pole.position.set(0.55, 1.0, 0.1); this.bodyGroup.add(pole);
            const blade = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 6, 12, Math.PI * 0.7), this._mat(0xcfd8e0, 1, 0.3, p.accent)); blade.position.set(0.55, 1.9, 0.1); blade.rotation.set(0, 0, -0.6); this.bodyGroup.add(blade);
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), this._mat(p.accent, 0.7, 0.3, p.accent)); this.pseudopod1.position.set(-0.5, 1.2, 0.2); this.bodyGroup.add(this.pseudopod1);
            this._fhWire();
        }
        // ── Bonechewer Devourer: a skeletal jaw-mass spitting marrow shards ──
        _buildFhBonechewer() {
            const p = this.profile; const bone = this._skinMat(p.bodyColor, 0.55);
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 12), bone); this.lowerBody.position.y = 0.7; this.lowerBody.scale.set(1.1, 0.9, 1.0); this.bodyGroup.add(this.lowerBody);
            const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.5), bone); jaw.position.set(0, 0.5, 0.3); this.bodyGroup.add(jaw);
            for (let i = 0; i < 7; i++) { const x = -0.3 + i * 0.1; const top = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 4), this._mat(0xf0e8d0, 1, 0.4)); top.position.set(x, 0.78, 0.5); top.rotation.x = Math.PI; this.bodyGroup.add(top); const bot = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 4), this._mat(0xf0e8d0, 1, 0.4)); bot.position.set(x, 0.6, 0.5); this.bodyGroup.add(bot); }
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), this._mat(p.accent, 1, 0.4, p.accent)); this.core.position.y = 0.85; this.bodyGroup.add(this.core);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), bone); this.upperBody.position.y = 1.05; this.bodyGroup.add(this.upperBody);
            this._fhEyesPair(this.upperBody, 0.26, 0.04, 0.06);
            this._fhWire();
        }
        // ── Crimson Harvester: a blood-slick reaver swelling with each kill ──
        _buildFhCrimsonharvester() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.4);
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 14), m); this.lowerBody.position.y = 0.8; this.lowerBody.scale.set(0.9, 1.3, 0.9); this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), m); this.upperBody.position.y = 1.55; this.bodyGroup.add(this.upperBody);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(p.accent, 1, 0.3, p.accent)); this.core.position.y = 1.0; this.bodyGroup.add(this.core);
            this._fhEyesPair(this.upperBody, 0.26, 0.02, 0.05);
            const sword = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.04), this._mat(0x9a1018, 1, 0.3, 0x440408)); sword.position.set(0.55, 1.2, 0.1); this.bodyGroup.add(sword);
            this.pseudopod1 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 6), m); this.pseudopod1.position.set(-0.5, 0.9, 0.1); this.pseudopod1.rotation.z = 0.6; this.bodyGroup.add(this.pseudopod1);
            for (let i = 0; i < 5; i++) { const a = i * 2.39996; const dr = new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 7), this._mat(0x8a1018, 1, 0.3)); dr.scale.y = 1.6; dr.position.set(Math.cos(a) * 0.45, 0.5 + (i % 2) * 0.2, Math.sin(a) * 0.4); this.bodyGroup.add(dr); }
            this._fhWire();
        }
        // ── Ethereal Devourer: a near-invisible wraith that eats memory ──────
        _buildFhEtherealdevourer() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.2); m.opacity = 0.32;
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.65, 16, 14), m); this.lowerBody.position.y = 0.8; this.lowerBody.scale.set(1, 1.3, 1); this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), m); this.upperBody.position.y = 1.5; this.bodyGroup.add(this.upperBody);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), this._mat(p.accent, 0.9, 0.2, p.accent)); this.core.position.y = 0.9; this.bodyGroup.add(this.core);
            this._fhEyesScatter(this.bodyGroup, 5, 0.07, 0.4, 0.9, 0.4);
            this.pseudopod1 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 8), m); this.pseudopod1.position.set(-0.45, 0.4, 0); this.pseudopod1.rotation.z = 0.4; this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 8), m); this.pseudopod2.position.set(0.45, 0.4, 0); this.pseudopod2.rotation.z = -0.4; this.bodyGroup.add(this.pseudopod2);
            this._fhWire();
        }
        // ── Mi-go Brain Harvester: fungoid alien, wings + a brain canister ───
        _buildFhMigo() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.6);
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 12), m); this.lowerBody.position.y = 0.8; this.lowerBody.scale.set(1, 1.3, 1); this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), m); this.upperBody.position.y = 1.5; this.upperBody.scale.set(1, 0.8, 1.2); this.bodyGroup.add(this.upperBody);
            for (const x of [-1, 1]) { const wing = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 3), this._mat(p.accent, 0.6, 0.5, p.accent)); wing.position.set(x * 0.5, 1.0, -0.2); wing.rotation.z = x * 1.1; wing.scale.set(0.3, 1, 1); this.bodyGroup.add(wing); }
            const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 12), this._mat(0xaaccdd, 0.5, 0.2)); canister.position.y = 1.95; this.bodyGroup.add(canister);
            const brain = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), this._mat(0xd89aa8, 1, 0.6)); brain.position.y = 1.95; this.bodyGroup.add(brain);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), this._mat(p.accent, 1, 0.4, p.accent)); this.core.position.y = 0.85; this.bodyGroup.add(this.core);
            this.pseudopod1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 6), m); this.pseudopod1.position.set(-0.4, 0.7, 0.25); this.pseudopod1.rotation.z = 0.5; this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 6), m); this.pseudopod2.position.set(0.4, 0.7, 0.25); this.pseudopod2.rotation.z = -0.5; this.bodyGroup.add(this.pseudopod2);
            this._fhWire();
        }
        // ── Abyssal Devourer: a vast dark amorphous maw studded with eyes ────
        _buildFhAbyssaldevourer() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.6); m.opacity = 0.92;
            this.lowerBody = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), m); this.lowerBody.position.y = 0.85; this.lowerBody.scale.set(1.1, 1.0, 1.0); this.bodyGroup.add(this.lowerBody);
            const maw = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), this._mat(0x050810, 1, 0.7)); maw.position.set(0, 0.85, 0.35); maw.rotation.x = -1.3; this.bodyGroup.add(maw);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(p.accent, 1, 0.3, p.accent)); this.core.position.set(0, 0.85, 0.1); this.bodyGroup.add(this.core);
            this._fhEyesScatter(this.bodyGroup, 8, 0.06, 0.55, 0.95, 0.3);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), m); this.upperBody.position.y = 1.5; this.bodyGroup.add(this.upperBody);
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), m); this.pseudopod1.position.set(-0.65, 0.55, 0.1); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), m); this.pseudopod2.position.set(0.65, 0.55, -0.1); this.bodyGroup.add(this.pseudopod2);
            this._fhWire();
        }
        // ── Carrion Stalker: a low scavenger crouched over its kill ──────────
        _buildFhCarrionstalker() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.7);
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), m); this.lowerBody.position.set(0, 0.55, -0.1); this.lowerBody.scale.set(1.0, 0.8, 1.5); this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), m); this.upperBody.position.set(0, 0.7, 0.55); this.upperBody.scale.set(1, 0.9, 1.2); this.bodyGroup.add(this.upperBody);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), m); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.65, 0.85); this.bodyGroup.add(snout);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), this._mat(p.accent, 1, 0.4, p.accent)); this.core.position.set(0, 0.55, 0); this.bodyGroup.add(this.core);
            this._fhEyesPair(this.upperBody, 0.22, 0.06, 0.05);
            for (const x of [-1, 1]) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 5), this._mat(0xe0d8c0, 1, 0.4)); claw.position.set(x * 0.3, 0.18, 0.6); claw.rotation.x = -0.4; this.bodyGroup.add(claw); }
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), m); this.pseudopod1.position.set(-0.35, 0.3, -0.5); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), m); this.pseudopod2.position.set(0.35, 0.3, -0.5); this.bodyGroup.add(this.pseudopod2);
            this._fhWire();
        }
        // ── Bleeding Statue: a weathered stone effigy weeping acidic blood ───
        _buildFhBleedingstatue() {
            const p = this.profile; const stone = this._skinMat(p.bodyColor, 0.9);
            this.lowerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.4, 10), stone); this.lowerBody.position.y = 0.9; this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), stone); this.upperBody.position.y = 1.7; this.bodyGroup.add(this.upperBody);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), this._mat(p.accent, 1, 0.3, p.accent)); this.core.position.y = 1.0; this.bodyGroup.add(this.core);
            const em = this._mat(p.accent, 1, 0.3);
            const le = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), em); le.position.set(-0.1, 1.72, 0.26); const re = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), em); re.position.set(0.1, 1.72, 0.26); this.bodyGroup.add(le, re);
            for (const ex of [-0.1, 0.1]) { const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.9, 5), this._mat(p.accent, 0.9, 0.3, p.accent)); streak.position.set(ex, 1.25, 0.28); this.bodyGroup.add(streak); }
            this.pseudopod1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.7, 8), stone); this.pseudopod1.position.set(-0.4, 1.0, 0.05); this.pseudopod1.rotation.z = 0.3; this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.7, 8), stone); this.pseudopod2.position.set(0.4, 1.0, 0.05); this.pseudopod2.rotation.z = -0.3; this.bodyGroup.add(this.pseudopod2);
            this._fhWire();
        }
        // ── Geometry Devourer: a knot of impossible angles in many dimensions ─
        _buildFhGeometrydevourer() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.3); m.opacity = 0.7;
            this.lowerBody = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), m); this.lowerBody.position.y = 0.9; this.bodyGroup.add(this.lowerBody);
            const shapes = ['tetra', 'box', 'octa'];
            for (let i = 0; i < 9; i++) { const a = i * 2.39996; const kind = shapes[i % 3]; const g = kind === 'tetra' ? new THREE.TetrahedronGeometry(0.2, 0) : kind === 'box' ? new THREE.BoxGeometry(0.28, 0.28, 0.28) : new THREE.OctahedronGeometry(0.2, 0); const sh = new THREE.Mesh(g, this._mat(p.accent, 0.65, 0.2, p.accent)); sh.position.set(Math.cos(a) * 0.55, 0.9 + Math.sin(i * 1.7) * 0.5, Math.sin(a) * 0.5); sh.rotation.set(a, i, a * 0.5); this.bodyGroup.add(sh); }
            this.core = new THREE.Mesh(new THREE.TetrahedronGeometry(0.18, 0), this._mat(p.accent, 1, 0.2, p.accent)); this.core.position.y = 0.9; this.bodyGroup.add(this.core);
            this.upperBody = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), m); this.upperBody.position.y = 1.6; this.bodyGroup.add(this.upperBody);
            this._fhWire();
        }
        // ── Womb of Nightmares: a bloated birthing sac leaking small horrors ─
        _buildFhWomb() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.5); m.opacity = 0.85;
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 16), m); this.lowerBody.position.y = 0.85; this.bodyGroup.add(this.lowerBody);
            for (let i = 0; i < 5; i++) { const a = i * 2.39996; const orif = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), this._mat(0x4a1018, 1, 0.7)); orif.position.set(Math.cos(a) * 0.62, 0.85 + Math.sin(i * 1.7) * 0.45, Math.sin(a) * 0.55); orif.lookAt(Math.cos(a) * 2, 0.85, Math.sin(a) * 2); this.bodyGroup.add(orif); const spawn = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), this._mat(p.accent, 1, 0.5)); spawn.position.set(Math.cos(a) * 0.72, 0.85 + Math.sin(i * 1.7) * 0.45, Math.sin(a) * 0.64); this.bodyGroup.add(spawn); }
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), this._mat(p.accent, 0.9, 0.4, p.accent)); this.core.position.y = 0.85; this.bodyGroup.add(this.core);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), m); this.upperBody.position.y = 1.6; this.bodyGroup.add(this.upperBody);
            this._fhWire();
        }
        // ── Flesh Calculator: a lattice of muscle strands wired to data panels ─
        _buildFhFleshcalculator() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.5);
            this.lowerBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.6), m); this.lowerBody.position.y = 0.8; this.bodyGroup.add(this.lowerBody);
            for (let i = 0; i < 8; i++) { const a = i * 2.39996; const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), this._mat(0xb84a4a, 1, 0.5)); strand.position.set(Math.cos(a) * 0.4, 0.8, Math.sin(a) * 0.3); strand.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5); this.bodyGroup.add(strand); }
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const panel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.03), this._mat(p.accent, 0.9, 0.2, p.accent)); panel.position.set(Math.cos(a) * 0.5, 0.8 + Math.sin(i) * 0.3, 0.34); panel.lookAt(Math.cos(a) * 2, 0.8, 2); this.bodyGroup.add(panel); }
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), this._mat(p.accent, 1, 0.3, p.accent)); this.core.position.y = 0.8; this.bodyGroup.add(this.core);
            this.upperBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), m); this.upperBody.position.y = 1.5; this.bodyGroup.add(this.upperBody);
            this._fhEyesPair(this.upperBody, 0.22, 0.0, 0.05);
            this._fhWire();
        }
        // ── Breathing Building: a fleshy edifice whose doors inhale victims ──
        _buildFhBreathingbuilding() {
            const p = this.profile; const m = this._skinMat(p.bodyColor, 0.8);
            this.lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.6, 0.9), m); this.lowerBody.position.y = 0.9; this.bodyGroup.add(this.lowerBody);
            const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.5, 4), m); roof.position.y = 1.95; roof.rotation.y = Math.PI / 4; this.bodyGroup.add(roof);
            this.upperBody = roof;
            const door = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), this._mat(0x300808, 1, 0.7)); door.position.set(0, 0.55, 0.46); door.rotation.x = -1.4; this.bodyGroup.add(door); this.core = door;
            for (let r = 0; r < 3; r++) for (const x of [-0.28, 0.28]) { const win = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.04), this._mat(p.accent, 0.9, 0.2, p.accent)); win.position.set(x, 0.9 + r * 0.35, 0.46); this.bodyGroup.add(win); }
            for (const x of [-0.32, 0.32]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(0xece4dc, 1, 0.3)); e.position.set(x, 1.7, 0.4); this.bodyGroup.add(e); }
            this.pseudopod1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), m); this.pseudopod1.position.set(-0.45, 0.25, 0.2); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), m); this.pseudopod2.position.set(0.45, 0.25, 0.2); this.bodyGroup.add(this.pseudopod2);
            this._fhWire();
        }

        // ── Grotesque Slime: brown lumpy ooze with bones half-digested inside ─
        _buildGrotesqueSlime() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.78, coreColor: 0x4a3018 });
            // Lumpy bulges deforming the smooth body.
            this.lumps = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const a = this.idRand() * Math.PI * 2, e = this.idRand() * 0.7;
                const l = new THREE.Mesh(new THREE.SphereGeometry(0.16 + this.idRand() * 0.1, 8, 8), this._oozeMat);
                l.position.set(Math.cos(a) * 0.55, 0.35 + Math.sin(e) * 0.6, Math.sin(a) * 0.5); this.lumps.add(l);
            }
            this.bodyGroup.add(this.lumps);
            // Suspended bones and remains.
            this.bones = new THREE.Group();
            const boneMat = this._mat(0xe8e0cc, 1.0, 0.7);
            for (let i = 0; i < 4; i++) {
                const bn = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3 + this.idRand() * 0.2, 6), boneMat);
                bn.position.set((this.idRand() - 0.5) * 0.6, 0.4 + this.idRand() * 0.6, (this.idRand() - 0.5) * 0.5);
                bn.rotation.set(this.idRand() * 3, this.idRand() * 3, this.idRand() * 3); this.bones.add(bn);
            }
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), boneMat); skull.position.set(0.1, 0.5, 0.1); skull.scale.set(1, 1.1, 0.95); this.bones.add(skull);
            this.bodyGroup.add(this.bones);
            this._cascadeRules[0].hide.push(this.lumps, this.bones);
        }

        // ── Molten Slag: superheated magma blob, glowing core, lava drips ────
        _buildMoltenSlag() {
            const p = this.profile;
            this._oozeBase({ opacity: 1.0, coreColor: 0xffaa33 });
            // Dark crusted shell with cracks glowing through.
            this._oozeMat.roughness = 0.85;
            this._oozeMat.emissive = new THREE.Color(0xaa2200); this._oozeMat.emissiveIntensity = 0.25;
            this.core.material.emissiveIntensity = 1.4;
            this.core.scale.setScalar(1.4);
            // Glowing crack-seams across the crust.
            this.cracks = new THREE.Group();
            for (let i = 0; i < 8; i++) {
                const a = this.idRand() * Math.PI * 2, e = (this.idRand() - 0.5) * 0.8;
                const cr = new THREE.Mesh(new THREE.BoxGeometry(0.25 + this.idRand() * 0.2, 0.03, 0.03), this._mat(0xff6611, 1.0, 0.3, 0xff7722));
                cr.position.set(Math.cos(a) * 0.6, 0.5 + e * 0.6, Math.sin(a) * 0.55); cr.rotation.set(0, -a, this.idRand() * 1.5); this.cracks.add(cr);
            }
            this.bodyGroup.add(this.cracks);
            // Hanging lava drips.
            this.drips = new THREE.Group();
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const dr = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(0xff8822, 1.0, 0.3, 0xff7722)); dr.position.set(Math.cos(a) * 0.5, 0.12, Math.sin(a) * 0.46); dr.scale.y = 1.8; dr._base = 0.12; dr._t = this.idRand(); this.drips.add(dr); }
            this.bodyGroup.add(this.drips);
            this._cascadeRules[0].hide.push(this.cracks, this.drips);
        }

        // ── Pumpkin Slime: gourd-shaped ooze with jack-o-lantern grin inside ─
        _buildPumpkinSlime() {
            const p = this.profile;
            const skinMat = this._skinMat(p.bodyColor, 0.55); skinMat.opacity = 0.85;
            this._oozeMat = skinMat;
            // Ribbed squat pumpkin body (scaled flat sphere) as lower body.
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 14), skinMat); this.lowerBody.position.y = 0.55; this.lowerBody.scale.set(1.15, 0.85, 1.15); this.bodyGroup.add(this.lowerBody);
            // Ridges.
            this.ridges = new THREE.Group();
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const rg = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 12, Math.PI), this._mat(0xbb5510, 0.85, 0.6)); rg.position.y = 0.55; rg.rotation.set(Math.PI / 2, 0, a); this.ridges.add(rg); }
            this.bodyGroup.add(this.ridges);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), skinMat); this.upperBody.position.y = 0.95; this.upperBody.scale.set(1.0, 0.9, 1.0); this.bodyGroup.add(this.upperBody);
            // Green stem on top.
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.22, 7), this._mat(0x4a7a2a, 1.0, 0.7)); stem.position.y = 1.25; stem.rotation.z = 0.2; this.bodyGroup.add(this.stem = stem);
            // Glowing jack-o-lantern face suspended inside (the core).
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), this._mat(0xffcc33, 1.0, 0.3, 0xffaa22)); this.core.position.set(0, 0.55, 0.0); this.bodyGroup.add(this.core);
            const faceMat = this._mat(0xffdd44, 1.0, 0.3, 0xffbb22);
            const lEye = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 3), faceMat); lEye.position.set(-0.18, 0.62, 0.5); lEye.rotation.x = Math.PI / 2; this.bodyGroup.add(lEye);
            const rEye = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 3), faceMat); rEye.position.set(0.18, 0.62, 0.5); rEye.rotation.x = Math.PI / 2; this.bodyGroup.add(rEye);
            this.grinFace = new THREE.Group(); this.grinFace.add(lEye, rEye);
            for (let i = 0; i < 4; i++) { const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 3), faceMat); tooth.position.set(-0.18 + i * 0.12, 0.42, 0.52); tooth.rotation.x = Math.PI / 2; tooth.rotation.z = (i % 2) * Math.PI; this.grinFace.add(tooth); }
            this.bodyGroup.add(this.grinFace);
            // Vine pseudopods.
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), skinMat); this.pseudopod1.position.set(-0.62, 0.3, 0.1); this.pseudopod1.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), skinMat); this.pseudopod2.position.set(0.62, 0.3, -0.1); this.pseudopod2.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod2);
            this._partMeshMap = { CORE: this.core, UPPER_BODY: this.upperBody, LOWER_BODY: this.lowerBody, PSEUDOPOD_1: this.pseudopod1, PSEUDOPOD_2: this.pseudopod2 };
            this._cascadeRules = [
                { gone: ['CORE'], hide: [this.core, this.grinFace, this.upperBody, this.lowerBody, this.ridges, this.stem, this.pseudopod1, this.pseudopod2] },
                { gone: ['UPPER_BODY'], hide: [this.upperBody, this.stem] },
                { gone: ['LOWER_BODY'], hide: [this.lowerBody, this.ridges, this.grinFace] },
                { gone: ['PSEUDOPOD_1'], hide: [this.pseudopod1] },
                { gone: ['PSEUDOPOD_2'], hide: [this.pseudopod2] },
            ];
        }

        // ── Rainbow Slime: prismatic iridescent ooze shimmering all colours ──
        _buildRainbowSlime() {
            this._oozeBase({ opacity: 0.7, coreColor: 0xffffff });
            this._oozeMat.roughness = 0.1;
            this._oozeMat.emissive = new THREE.Color(0x222244); this._oozeMat.emissiveIntensity = 0.4;
            this.core.material.emissiveIntensity = 1.2;
            // Floating prism shards catching light, each tinted a hue band.
            this.shards = new THREE.Group();
            for (let i = 0; i < 9; i++) {
                const hue = i / 9;
                const c = new THREE.Color().setHSL(hue, 0.9, 0.55);
                const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.08 + this.idRand() * 0.04, 0), this._mat(c.getHex(), 0.75, 0.1, c.getHex()));
                const a = (i / 9) * Math.PI * 2;
                sh.position.set(Math.cos(a) * 0.55, 0.45 + this.idRand() * 0.7, Math.sin(a) * 0.5); sh._hue = hue; sh._t = this.idRand(); this.shards.add(sh);
            }
            this.bodyGroup.add(this.shards);
            this._cascadeRules[0].hide.push(this.shards);
        }

        // ── Seeing Slime: pale ooze studded with dozens of blinking eyes ────
        _buildSeeingSlime() {
            this._oozeBase({ opacity: 0.8, coreColor: 0xffeecc });
            // Remove the default two eyes' look by adding many across the surface.
            this.eyeStuds = new THREE.Group();
            this._studPupils = [];
            for (let i = 0; i < 18; i++) {
                const a = this.idRand() * Math.PI * 2, e = (this.idRand() - 0.2) * Math.PI * 0.55;
                const r = 0.55 + this.idRand() * 0.1;
                const px = Math.cos(a) * Math.cos(e) * r, py = 0.55 + Math.sin(e) * 0.55, pz = Math.sin(a) * Math.cos(e) * r;
                const sz = 0.07 + this.idRand() * 0.05;
                const ball = new THREE.Mesh(new THREE.SphereGeometry(sz, 10, 10), this._mat(0xfbf6ee, 1.0, 0.3));
                ball.position.set(px, py, pz);
                const dir = new THREE.Vector3(px, py - 0.55, pz).normalize();
                const pupil = new THREE.Mesh(new THREE.SphereGeometry(sz * 0.5, 8, 8), this._mat(0x101018, 1.0, 0.2));
                pupil.position.copy(dir.clone().multiplyScalar(sz * 0.7));
                ball.add(pupil); ball._t = this.idRand(); this.eyeStuds.add(ball);
            }
            this.bodyGroup.add(this.eyeStuds);
            this._cascadeRules[0].hide.push(this.eyeStuds);
        }

        // ── Skulmire Slime: dark swamp ooze trailing wisps of shadow webbing ─
        _buildSkulmireSlime() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.9, coreColor: 0x6a2a8a });
            this._oozeMat.roughness = 0.95;
            this._oozeMat.emissive = new THREE.Color(0x140a1a); this._oozeMat.emissiveIntensity = 0.35;
            this.core.material.emissiveIntensity = 1.1;
            // Tendrils of shadow webbing dragging out from the base.
            this.webs = new THREE.Group();
            const webMat = this._mat(0x2a1a38, 0.4, 0.9, 0x180a22);
            for (let i = 0; i < 7; i++) {
                const a = this.idRand() * Math.PI * 2;
                const len = 0.5 + this.idRand() * 0.5;
                const w = new THREE.Mesh(new THREE.ConeGeometry(0.04, len, 5), webMat);
                w.position.set(Math.cos(a) * 0.55, 0.18, Math.sin(a) * 0.5);
                w.rotation.set(Math.PI, 0, Math.cos(a) * 0.5);
                w._t = this.idRand(); this.webs.add(w);
            }
            this.bodyGroup.add(this.webs);
            // Sunk swamp-gas bubbles trapped at the surface.
            this.gasBubbles = new THREE.Group();
            for (let i = 0; i < 6; i++) {
                const a = this.idRand() * Math.PI * 2;
                const b = new THREE.Mesh(new THREE.SphereGeometry(0.06 + this.idRand() * 0.04, 8, 8), this._mat(0x3a5a3a, 0.5, 0.4, 0x2a4a2a));
                b.position.set(Math.cos(a) * 0.4, 0.5 + this.idRand() * 0.5, Math.sin(a) * 0.38); b._t = this.idRand();
                this.gasBubbles.add(b);
            }
            this.bodyGroup.add(this.gasBubbles);
            this._cascadeRules[0].hide.push(this.webs, this.gasBubbles);
        }

        // ── Thunder Blob: electric-blue ooze with internal lightning arcs ────
        _buildThunderBlob() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.6, coreColor: 0xeeffff });
            this._oozeMat.roughness = 0.2;
            this._oozeMat.emissive = new THREE.Color(0x1133aa); this._oozeMat.emissiveIntensity = 0.4;
            this.core.material.emissiveIntensity = 1.6; this.core.scale.setScalar(1.2);
            // Jagged internal lightning bolts (thin zig-zag boxes through the body).
            this.bolts = new THREE.Group();
            const boltMat = this._mat(0xcceeff, 1.0, 0.1, 0xaaddff);
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const seg = new THREE.Group();
                let py = 0.3;
                for (let s = 0; s < 4; s++) {
                    const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), boltMat);
                    b.position.set((this.idRand() - 0.5) * 0.18, py, (this.idRand() - 0.5) * 0.18);
                    b.rotation.z = (this.idRand() - 0.5) * 1.4; seg.add(b); py += 0.16;
                }
                seg.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22); seg._t = this.idRand();
                this.bolts.add(seg);
            }
            this.bodyGroup.add(this.bolts);
            // Spark nodes popping at the surface.
            this.sparks = new THREE.Group();
            for (let i = 0; i < 8; i++) {
                const a = this.idRand() * Math.PI * 2, e = this.idRand() * 0.7;
                const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), this._mat(0xffffff, 0.9, 0.1, 0xbbeeff));
                sp.position.set(Math.cos(a) * 0.6, 0.5 + Math.sin(e) * 0.5, Math.sin(a) * 0.55); sp._t = this.idRand();
                this.sparks.add(sp);
            }
            this.bodyGroup.add(this.sparks);
            this._cascadeRules[0].hide.push(this.bolts, this.sparks);
        }

        // ── Toxic Amalgam: lumpy multi-nuclei slime of fused toxic blobs ─────
        _buildToxicAmalgam() {
            const p = this.profile;
            // Override the smooth base with several fused blobs of differing hues.
            const baseMat = this._skinMat(p.bodyColor, 0.55); baseMat.opacity = 0.85;
            this._oozeMat = baseMat;
            this.lowerBody = new THREE.Mesh(new THREE.SphereGeometry(0.58, 16, 14), baseMat); this.lowerBody.position.y = 0.45; this.lowerBody.scale.set(1.15, 0.8, 1.15); this.bodyGroup.add(this.lowerBody);
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 14), baseMat); this.upperBody.position.set(-0.18, 0.92, 0.05); this.bodyGroup.add(this.upperBody);
            // Fused sickly-hued sub-blobs glommed onto the mass.
            this.blobs = new THREE.Group();
            this.nuclei = new THREE.Group();
            const hues = [0x9aff44, 0xbb44cc, 0xddaa22, 0x44ccaa, 0x88aa33];
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const bm = this._mat(hues[i], 0.8, 0.5);
                const bl = new THREE.Mesh(new THREE.SphereGeometry(0.24 + this.idRand() * 0.08, 12, 12), bm);
                bl.position.set(Math.cos(a) * 0.42, 0.55 + Math.sin(a * 1.7) * 0.25, Math.sin(a) * 0.4);
                this.blobs.add(bl);
                // A glowing nucleus inside each.
                const nuc = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), this._mat(hues[i], 1.0, 0.3, hues[i]));
                nuc.position.copy(bl.position); nuc._t = this.idRand(); this.nuclei.add(nuc);
            }
            this.bodyGroup.add(this.blobs, this.nuclei);
            // Eyes scattered on different blobs.
            const eyeMat = this._mat(0x111111, 1.0, 0.3);
            const le = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), eyeMat); le.position.set(-0.2, 0.9, 0.4);
            const re = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), eyeMat); re.position.set(0.25, 0.7, 0.38);
            this.bodyGroup.add(le, re);
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(p.accent, 1.0, 0.3, p.accent)); this.core.position.y = 0.55; this.bodyGroup.add(this.core);
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), baseMat); this.pseudopod1.position.set(-0.62, 0.3, 0.1); this.pseudopod1.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), baseMat); this.pseudopod2.position.set(0.62, 0.3, -0.1); this.pseudopod2.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod2);
            this._partMeshMap = { CORE: this.core, UPPER_BODY: this.upperBody, LOWER_BODY: this.lowerBody, PSEUDOPOD_1: this.pseudopod1, PSEUDOPOD_2: this.pseudopod2 };
            this._cascadeRules = [
                { gone: ['CORE'], hide: [this.core, this.upperBody, this.lowerBody, this.blobs, this.nuclei, le, re, this.pseudopod1, this.pseudopod2] },
                { gone: ['UPPER_BODY'], hide: [this.upperBody] },
                { gone: ['LOWER_BODY'], hide: [this.lowerBody, this.blobs] },
                { gone: ['PSEUDOPOD_1'], hide: [this.pseudopod1] },
                { gone: ['PSEUDOPOD_2'], hide: [this.pseudopod2] },
            ];
        }

        // ── Caustic Slime: bubbling acid ooze that fizzes, pocked with holes ─
        _buildCausticSlime() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.78, coreColor: 0xddff44 });
            this._oozeMat.roughness = 0.3;
            this._oozeMat.emissive = new THREE.Color(0x445500); this._oozeMat.emissiveIntensity = 0.3;
            // Etched holes/pits (dark recessed dimples) across the surface.
            this.pits = new THREE.Group();
            for (let i = 0; i < 10; i++) {
                const a = this.idRand() * Math.PI * 2, e = (this.idRand() - 0.2) * Math.PI * 0.5;
                const r = 0.55;
                const pit = new THREE.Mesh(new THREE.SphereGeometry(0.08 + this.idRand() * 0.05, 8, 8), this._mat(0x5a6a10, 1.0, 0.6));
                pit.position.set(Math.cos(a) * Math.cos(e) * r, 0.5 + Math.sin(e) * 0.5, Math.sin(a) * Math.cos(e) * r);
                pit.scale.setScalar(1); this.pits.add(pit);
            }
            this.bodyGroup.add(this.pits);
            // Fizzing acid bubbles rising and popping.
            this.fizz = new THREE.Group();
            for (let i = 0; i < 10; i++) {
                const a = this.idRand() * Math.PI * 2;
                const f = new THREE.Mesh(new THREE.SphereGeometry(0.04 + this.idRand() * 0.03, 7, 7), this._mat(0xeeff88, 0.7, 0.1, 0xccff44));
                f.position.set(Math.cos(a) * 0.4, 0.4 + this.idRand() * 0.7, Math.sin(a) * 0.38);
                f._t = this.idRand(); f._spd = 0.4 + this.idRand() * 0.4; this.fizz.add(f);
            }
            this.bodyGroup.add(this.fizz);
            // Acid drips off the bottom.
            this.drips = new THREE.Group();
            for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const dr = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), this._mat(0xccff33, 0.85, 0.2, 0xaaff22)); dr.position.set(Math.cos(a) * 0.5, 0.12, Math.sin(a) * 0.46); dr.scale.y = 1.7; dr._base = 0.12; dr._t = this.idRand(); this.drips.add(dr); }
            this.bodyGroup.add(this.drips);
            this._cascadeRules[0].hide.push(this.pits, this.fizz, this.drips);
        }

        // ── Toxic Ooze: glossy green acid ooze with a darker paralytic core ──
        _buildToxicOoze() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.72, coreColor: 0x115522 });
            this._oozeMat.roughness = 0.12; // glossy
            // Dark paralytic core, oversized and pulsing.
            this.core.scale.setScalar(1.6);
            this.core.material.emissive = new THREE.Color(0x0a3318); this.core.material.emissiveIntensity = 0.7;
            // Veins of toxin radiating from the dark core to the skin.
            this.veins = new THREE.Group();
            const veinMat = this._mat(0x0a4a1a, 0.7, 0.4, 0x0a3318);
            for (let i = 0; i < 8; i++) {
                const a = this.idRand() * Math.PI * 2, e = (this.idRand() - 0.5) * 1.0;
                const v = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.42, 5), veinMat);
                v.position.set(Math.cos(a) * 0.28, 0.6 + e * 0.2, Math.sin(a) * 0.26);
                v.lookAt(Math.cos(a) * 0.6, 0.6 + e * 0.5, Math.sin(a) * 0.55);
                v.rotateX(Math.PI / 2); this.veins.add(v);
            }
            this.bodyGroup.add(this.veins);
            // Slow venom droplets oozing off.
            this.droplets = new THREE.Group();
            for (let i = 0; i < 5; i++) { const a = this.idRand() * Math.PI * 2; const d = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), this._mat(0x1a6a2a, 0.8, 0.15, 0x115522)); d.position.set(Math.cos(a) * 0.45, 0.15, Math.sin(a) * 0.42); d.scale.y = 1.7; d._base = 0.15; d._t = this.idRand(); this.droplets.add(d); }
            this.bodyGroup.add(this.droplets);
            this._cascadeRules[0].hide.push(this.veins, this.droplets);
        }

        // ── Virulent Slimefiend: pale plague ooze, dividing nuclei + buds ────
        _buildVirulentSlimefiend() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.82, coreColor: 0x9aaa66 });
            this._oozeMat.roughness = 0.7;
            // Dividing nuclei: paired dumbbell shapes mid-mitosis suspended within.
            this.dividing = new THREE.Group();
            const nucMat = this._mat(0x7a9a44, 1.0, 0.4, 0x5a7a22);
            for (let i = 0; i < 5; i++) {
                const grp = new THREE.Group();
                const na = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), nucMat); na.position.x = -0.06;
                const nb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), nucMat); nb.position.x = 0.06;
                const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6), nucMat); bridge.rotation.z = Math.PI / 2;
                grp.add(na, nb, bridge);
                grp.position.set((this.idRand() - 0.5) * 0.6, 0.4 + this.idRand() * 0.6, (this.idRand() - 0.5) * 0.5);
                grp.rotation.y = this.idRand() * Math.PI; grp._t = this.idRand(); grp._na = na; grp._nb = nb;
                this.dividing.add(grp);
            }
            this.bodyGroup.add(this.dividing);
            // Budding offshoots: small slimelets sprouting from the parent body.
            this.buds = new THREE.Group();
            for (let i = 0; i < 6; i++) {
                const a = this.idRand() * Math.PI * 2, e = this.idRand() * 0.6;
                const bud = new THREE.Mesh(new THREE.SphereGeometry(0.13 + this.idRand() * 0.06, 12, 12), this._oozeMat);
                bud.position.set(Math.cos(a) * 0.6, 0.35 + Math.sin(e) * 0.6, Math.sin(a) * 0.55);
                bud.scale.set(1, 0.85, 1); bud._t = this.idRand(); bud._base = bud.scale.x; this.buds.add(bud);
            }
            this.bodyGroup.add(this.buds);
            this._cascadeRules[0].hide.push(this.dividing, this.buds);
        }

        // ── Sewers Slime: filthy grey-brown sludge dripping grime + debris ──
        _buildSewersSlime() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.92, coreColor: 0x3a4524 });
            this._oozeMat.roughness = 0.98; // dull, slimy-matte filth
            // Scummy film: dark mottled grime patches smeared over the body.
            this.grime = new THREE.Group();
            for (let i = 0; i < 11; i++) {
                const a = this.idRand() * Math.PI * 2, e = (this.idRand() - 0.15) * Math.PI * 0.55;
                const r = 0.55 + this.idRand() * 0.08;
                const g = new THREE.Mesh(new THREE.SphereGeometry(0.1 + this.idRand() * 0.07, 7, 7), this._mat(0x3a3424, 1.0, 1.0));
                g.position.set(Math.cos(a) * Math.cos(e) * r, 0.5 + Math.sin(e) * 0.55, Math.sin(a) * Math.cos(e) * r);
                g.scale.set(1.2, 0.35, 1.2); this.grime.add(g);
            }
            this.bodyGroup.add(this.grime);
            // Trapped trash debris: bottle cap, rusty nail, scrap fragments.
            this.debris = new THREE.Group();
            const metalMat = this._mat(0x5a5048, 1.0, 0.6);
            for (let i = 0; i < 5; i++) {
                let m;
                const pick = Math.floor(this.idRand() * 3);
                if (pick === 0) m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), metalMat);          // cap
                else if (pick === 1) m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 5), metalMat);     // nail
                else m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.12), this._mat(0x6a5a40, 1.0, 0.8));            // scrap
                m.position.set((this.idRand() - 0.5) * 0.7, 0.4 + this.idRand() * 0.6, (this.idRand() - 0.5) * 0.55);
                m.rotation.set(this.idRand() * 3, this.idRand() * 3, this.idRand() * 3); this.debris.add(m);
            }
            this.bodyGroup.add(this.debris);
            // Thick grimy drips sliding off the rim.
            this.drips = new THREE.Group();
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const dr = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._oozeMat); dr.position.set(Math.cos(a) * 0.55, 0.14, Math.sin(a) * 0.5); dr.scale.y = 1.9; dr._base = 0.14; dr._t = this.idRand(); this.drips.add(dr); }
            this.bodyGroup.add(this.drips);
            this._cascadeRules[0].hide.push(this.grime, this.debris, this.drips);
        }

        // ── Molten Pudding: quivering red-hot pudding with wobbling dome ─────
        _buildMoltenPudding() {
            const p = this.profile;
            // Override base: a tall glassy pudding dome that wobbles, glowing within.
            const puddMat = this._skinMat(p.bodyColor, 0.25); puddMat.opacity = 0.78;
            puddMat.emissive = new THREE.Color(0x661004); puddMat.emissiveIntensity = 0.5;
            this._oozeMat = puddMat;
            // Wide base ring (set pudding).
            this.lowerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 0.4, 20), puddMat); this.lowerBody.position.y = 0.3; this.bodyGroup.add(this.lowerBody);
            // Quivering molten dome (the iconic blancmange top).
            this.upperBody = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), puddMat); this.upperBody.position.y = 0.5; this.upperBody.scale.set(1.0, 1.15, 1.0); this.bodyGroup.add(this.upperBody);
            // Eyes on the dome.
            const eyeMat = this._mat(0x1a0000, 1.0, 0.3);
            const le = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeMat); le.position.set(-0.18, 0.78, 0.5);
            const re = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeMat); re.position.set(0.18, 0.78, 0.5);
            this.bodyGroup.add(le, re);
            // White-hot molten core glowing through the translucent jelly.
            this.core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), this._mat(0xffdd88, 1.0, 0.2, 0xffaa33)); this.core.position.y = 0.5; this.core.material.emissiveIntensity = 1.6; this.bodyGroup.add(this.core);
            // Caramel-like molten glaze dribbles running down the sides.
            this.glaze = new THREE.Group();
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const gz = new THREE.Mesh(THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.05, 0.5, 4, 6) : new THREE.CylinderGeometry(0.05, 0.04, 0.5, 6), this._mat(0xff7722, 1.0, 0.2, 0xff5511));
                gz.position.set(Math.cos(a) * 0.66, 0.42 - this.idRand() * 0.1, Math.sin(a) * 0.66); gz._base = gz.position.y; gz._t = this.idRand(); this.glaze.add(gz);
            }
            this.bodyGroup.add(this.glaze);
            // Steam-blob pseudopods bulging off the molten base.
            this.pseudopod1 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), puddMat); this.pseudopod1.position.set(-0.65, 0.28, 0.1); this.pseudopod1.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod1);
            this.pseudopod2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), puddMat); this.pseudopod2.position.set(0.65, 0.28, -0.1); this.pseudopod2.scale.set(1, 0.7, 1); this.bodyGroup.add(this.pseudopod2);
            this._partMeshMap = { CORE: this.core, UPPER_BODY: this.upperBody, LOWER_BODY: this.lowerBody, PSEUDOPOD_1: this.pseudopod1, PSEUDOPOD_2: this.pseudopod2 };
            this._cascadeRules = [
                { gone: ['CORE'], hide: [this.core, this.upperBody, this.lowerBody, this.glaze, this.pseudopod1, this.pseudopod2] },
                { gone: ['UPPER_BODY'], hide: [this.upperBody] },
                { gone: ['LOWER_BODY'], hide: [this.lowerBody, this.glaze] },
                { gone: ['PSEUDOPOD_1'], hide: [this.pseudopod1] },
                { gone: ['PSEUDOPOD_2'], hide: [this.pseudopod2] },
            ];
        }

        // ── Swarming Hivemind: iridescent ooze seething with tiny sub-blobs ──
        _buildSwarmingHivemind() {
            const p = this.profile;
            this._oozeBase({ opacity: 0.45, coreColor: 0xddaaff });
            this._oozeMat.roughness = 0.15; // iridescent sheen
            this._oozeMat.emissive = new THREE.Color(0x223355); this._oozeMat.emissiveIntensity = 0.4;
            // Dense cloud of tiny swarming sub-blobs seething through the mass.
            this.swarm = new THREE.Group();
            for (let i = 0; i < 36; i++) {
                const hue = 0.5 + this.idRand() * 0.45;
                const c = new THREE.Color().setHSL(hue, 0.7, 0.6);
                const sb = new THREE.Mesh(new THREE.SphereGeometry(0.045 + this.idRand() * 0.035, 7, 7), this._mat(c.getHex(), 0.85, 0.2, c.getHex()));
                const a = this.idRand() * Math.PI * 2, e = this.idRand() * Math.PI;
                const rad = 0.2 + this.idRand() * 0.42;
                sb.position.set(Math.cos(a) * Math.sin(e) * rad, 0.6 + Math.cos(e) * 0.45, Math.sin(a) * Math.sin(e) * rad);
                sb._a = a; sb._e = e; sb._rad = rad; sb._spd = 0.6 + this.idRand() * 1.4; sb._t = this.idRand() * Math.PI * 2;
                this.swarm.add(sb);
            }
            this.bodyGroup.add(this.swarm);
            // Many tiny eyes (compound hivemind awareness) on the surface.
            this.hiveEyes = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const a = this.idRand() * Math.PI * 2, e = this.idRand() * 0.6;
                const ey = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), this._mat(0xf0f0ff, 1.0, 0.2));
                ey.position.set(Math.cos(a) * 0.55, 0.55 + Math.sin(e) * 0.5, Math.sin(a) * 0.5);
                const pup = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), this._mat(0x101020, 1.0, 0.2)); pup.position.z = 0.035; ey.add(pup);
                ey._t = this.idRand(); this.hiveEyes.add(ey);
            }
            this.bodyGroup.add(this.hiveEyes);
            this._cascadeRules[0].hide.push(this.swarm, this.hiveEyes);
        }

        // ── Generic feature-driven slime (enemies 201-400) ────────────────
        _buildGeneric() {
            const p = this.profile;
            this._oozeBase({ opacity: p.slimeOpacity != null ? p.slimeOpacity : 0.85, coreColor: p.accent });
            this.feat = new THREE.Group();
            switch (p.feature) {
                case 'metallic': this._oozeMat.roughness = 0.15; this._oozeMat.opacity = 1.0; break;
                case 'void': this._oozeMat.emissive = new THREE.Color(0x110022); this._oozeMat.emissiveIntensity = 0.3; break;
                case 'grass': for (let i = 0; i < 8; i++) { const a = this.idRand() * Math.PI * 2; const bl = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.32, 4), this._mat(0x4a8a2a, 1, 0.6)); bl.position.set(Math.cos(a) * 0.5, 0.7 + this.idRand() * 0.4, Math.sin(a) * 0.5); bl.rotation.z = Math.cos(a) * 0.3; this.feat.add(bl); } break;
                case 'arcs': for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const arc = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.4, 4), this._mat(p.accent, 0.9, 0.2, p.accent)); arc.position.set(Math.cos(a) * 0.55, 0.7, Math.sin(a) * 0.55); arc.rotation.z = Math.PI / 2; this.feat.add(arc); } break;
                case 'fumes': for (let i = 0; i < 6; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), this._mat(p.accent, 0.4, 0.3, p.accent)); f.position.set((this.idRand() - 0.5) * 0.8, 0.8 + this.idRand() * 0.4, (this.idRand() - 0.5) * 0.6); this.feat.add(f); } break;
                case 'knight': {
                    const armor = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), this._mat(0x8a9098, 1, 0.4)); armor.position.y = 0.95; this.feat.add(armor);
                    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.02), this._mat(0x9aa0aa, 1, 0.4)); blade.position.set(0.52, 0.75, 0.1); this.feat.add(blade);
                    break;
                }
                case 'child': this.upperBody.scale.set(0.8, 1.5, 0.8); this.lowerBody.scale.set(0.9, 1.0, 0.9); break;
            }
            this.bodyGroup.add(this.feat);
            this._cascadeRules[0].hide.push(this.feat);
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.7);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            // Squish + gentle bob shared by all blobby oozes (skip bespoke fh_ shapes).
            const sq = 1.0 + Math.sin(t * (fast ? 6 : 2.4)) * 0.08;
            if (!this._noSquish) {
                if (this.lowerBody) this.lowerBody.scale.set(1.1 * sq, 0.8 / sq, 1.1 * sq);
                if (this.upperBody) this.upperBody.scale.set(1.0 / sq, 0.95 * sq, 1.0 / sq);
                if (this.core) this.core.position.y = 0.6 + Math.sin(t * 2) * 0.06;
                if (this.pseudopod1) this.pseudopod1.position.x = -0.6 - Math.sin(t * 2.5) * 0.06;
                if (this.pseudopod2) this.pseudopod2.position.x = 0.6 + Math.sin(t * 2.5 + 1) * 0.06;
            }
            this.model.position.y = this._baseY + Math.sin(t * 1.6) * 0.02 * this.scale;
            if (this._noSquish) this.model.position.y = this._baseY + Math.sin(t * 1.3) * 0.03 * this.scale;
            if (this.feat && this.profile.feature === 'arcs') this.feat.children.forEach((a, i) => { a.material.emissiveIntensity = Math.abs(Math.sin(t * 9 + i)) * 1.3; });
            if (this.feat && this.profile.feature === 'fumes') this.feat.children.forEach(f => { f.position.y += 0.006; if (f.position.y > 1.3) f.position.y = 0.7; });

            switch (this.variant) {
                case 'expiredooze': {
                    this.model.rotation.z = Math.sin(t * 1.2) * 0.05; // queasy lean
                    if (this.drips) this.drips.children.forEach(dr => { dr.position.y = dr._base - ((t * 0.3 + dr._t) % 1) * 0.18; });
                    break;
                }
                case 'rubberblob': {
                    const hue = (t * 0.25) % 1;
                    if (this._oozeMat) { this._oozeMat.emissive.setHSL(hue, 0.8, 0.4); this._oozeMat.emissiveIntensity = 0.4 + Math.sin(t * 3) * 0.2; }
                    if (this.rings) this.rings.children.forEach(r => { const s = 1.0 + ((t * 0.5 + r._i * 0.33) % 1) * 0.6; r.scale.set(s, s, 1); r.material.opacity = 0.6 * (1 - ((t * 0.5 + r._i * 0.33) % 1)); });
                    break;
                }
                case 'azureslime': {
                    if (this.droplets) this.droplets.children.forEach(d => { d.position.y -= 0.012; if (d.position.y < 0.3) d.position.y = 1.3; });
                    break;
                }
                case 'crimsonjelly': {
                    const pulse = 1.0 + Math.sin(t * (fast ? 7 : 3)) * 0.05;
                    this.model.scale.multiplyScalar(1); // (scale handled by applyModelScale; pulse via core)
                    if (this.core) this.core.scale.setScalar(pulse * 1.3);
                    if (this.inclusions) this.inclusions.children.forEach((inc, i) => { inc.position.y += Math.sin(t * 1.5 + i) * 0.002; inc.rotation.y = t * 0.5 + i; });
                    break;
                }
                case 'fleshhorror': {
                    // Slow inflate/deflate breathing of the sac, and float higher.
                    const infl = 1.0 + Math.sin(t * 1.1) * 0.12;
                    if (this.lowerBody) this.lowerBody.scale.set(1.0 * infl, 1.25 / infl, 1.0 * infl);
                    this.model.position.y = this._baseY + (0.05 + Math.sin(t * 0.9) * 0.05) * this.scale;
                    break;
                }
                case 'grotesqueslime': {
                    if (this.bones) this.bones.children.forEach((bn, i) => { bn.position.y += Math.sin(t * 1.2 + i) * 0.0015; bn.rotation.x += 0.004; });
                    if (this.lumps) this.lumps.children.forEach((l, i) => { l.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.06); });
                    break;
                }
                case 'moltenslag': {
                    if (this._oozeMat) this._oozeMat.emissiveIntensity = 0.2 + Math.abs(Math.sin(t * 1.5)) * 0.25;
                    if (this.core) this.core.material.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.5;
                    if (this.cracks) this.cracks.children.forEach((c, i) => { c.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 3 + i)) * 1.0; });
                    if (this.drips) this.drips.children.forEach(dr => { dr.position.y = dr._base - ((t * 0.4 + dr._t) % 1) * 0.22; });
                    break;
                }
                case 'pumpkinslime': {
                    if (this.core) this.core.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 2.2)) * 0.6;
                    if (this.grinFace) this.grinFace.children.forEach(m => { m.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 2.2 + 0.5)) * 0.8; });
                    break;
                }
                case 'rainbowslime': {
                    const hue = (t * 0.3) % 1;
                    if (this._oozeMat) { this._oozeMat.color.setHSL(hue, 0.7, 0.6); this._oozeMat.emissive.setHSL(hue, 0.9, 0.35); }
                    if (this.core) this.core.material.emissive.setHSL((hue + 0.5) % 1, 0.9, 0.5);
                    if (this.shards) this.shards.children.forEach((sh, i) => { sh.rotation.x = t + i; sh.rotation.y = t * 0.7 + i; sh.position.y += Math.sin(t * 1.5 + sh._t * 6) * 0.002; });
                    break;
                }
                case 'seeingslime': {
                    if (this.eyeStuds) this.eyeStuds.children.forEach((eb, i) => {
                        const blink = Math.sin(t * 2.5 + eb._t * 9);
                        eb.scale.y = blink > 0.92 ? 0.15 : 1.0; // sporadic blink
                        if (eb.children[0]) { eb.children[0].position.x = Math.sin(t * 1.3 + i) * 0.02; }
                    });
                    break;
                }
                case 'skulmireslime': {
                    if (this.webs) this.webs.children.forEach(w => { w.rotation.z = Math.cos(t * 1.1 + w._t * 6) * 0.4; });
                    if (this.gasBubbles) this.gasBubbles.children.forEach(b => { b.position.y += 0.004; b.material.opacity = 0.5 - ((t * 0.3 + b._t) % 1) * 0.4; if (b.position.y > 1.05) b.position.y = 0.5; });
                    if (this.core) this.core.material.emissiveIntensity = 0.8 + Math.abs(Math.sin(t * 1.4)) * 0.6;
                    break;
                }
                case 'thunderblob': {
                    if (this.bolts) this.bolts.children.forEach((seg, i) => { const on = Math.sin(t * 12 + seg._t * 9) > 0.3; seg.visible = on; });
                    if (this.sparks) this.sparks.children.forEach((sp, i) => { const f = Math.abs(Math.sin(t * 8 + sp._t * 10)); sp.material.emissiveIntensity = 0.3 + f * 1.5; sp.scale.setScalar(0.6 + f * 0.8); });
                    if (this.core) this.core.material.emissiveIntensity = 1.2 + Math.abs(Math.sin(t * 10)) * 0.8;
                    break;
                }
                case 'toxicamalgam': {
                    if (this.blobs) this.blobs.children.forEach((bl, i) => { bl.scale.setScalar(1 + Math.sin(t * 2.2 + i * 1.3) * 0.08); });
                    if (this.nuclei) this.nuclei.children.forEach((n, i) => { n.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 1.8 + n._t * 6)) * 0.7; n.rotation.y = t + i; });
                    break;
                }
                case 'causticslime': {
                    if (this.fizz) this.fizz.children.forEach(f => { f.position.y += 0.008 * f._spd * 2; if (f.position.y > 1.15) { f.position.y = 0.4; } f.material.opacity = 0.7 - (f.position.y - 0.4) * 0.5; });
                    if (this.drips) this.drips.children.forEach(dr => { dr.position.y = dr._base - ((t * 0.35 + dr._t) % 1) * 0.2; });
                    if (this._oozeMat) this._oozeMat.emissiveIntensity = 0.2 + Math.abs(Math.sin(t * 3)) * 0.2;
                    break;
                }
                case 'toxicooze': {
                    const pulse = 1.6 + Math.sin(t * (fast ? 6 : 2.5)) * 0.25;
                    if (this.core) { this.core.scale.setScalar(pulse); this.core.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 2.5)) * 0.5; }
                    if (this.veins) this.veins.children.forEach((v, i) => { v.material.emissiveIntensity = 0.2 + Math.abs(Math.sin(t * 2.5 + i * 0.7)) * 0.5; });
                    if (this.droplets) this.droplets.children.forEach(d => { d.position.y = d._base - ((t * 0.25 + d._t) % 1) * 0.18; });
                    break;
                }
                case 'virulentslimefiend': {
                    if (this.dividing) this.dividing.children.forEach((g, i) => { const sp = (Math.sin(t * 1.3 + g._t * 6) * 0.5 + 0.5) * 0.1 + 0.04; if (g._na) g._na.position.x = -sp; if (g._nb) g._nb.position.x = sp; g.rotation.y += 0.01; });
                    if (this.buds) this.buds.children.forEach((bd, i) => { const s = bd._base * (1 + Math.sin(t * 1.6 + bd._t * 7) * 0.18); bd.scale.set(s, s * 0.85, s); });
                    break;
                }
                case 'sewersslime': {
                    this.model.rotation.z = Math.sin(t * 0.9) * 0.04; // sluggish slosh
                    if (this.debris) this.debris.children.forEach((m, i) => { m.position.y += Math.sin(t * 1.1 + i) * 0.001; m.rotation.y += 0.003; });
                    if (this.drips) this.drips.children.forEach(dr => { dr.position.y = dr._base - ((t * 0.25 + dr._t) % 1) * 0.2; });
                    break;
                }
                case 'moltenpudding': {
                    // Heavy jiggle of the molten dome.
                    const wob = Math.sin(t * (fast ? 9 : 4.5));
                    if (this.upperBody) this.upperBody.scale.set(1.0 + wob * 0.12, 1.15 - wob * 0.14, 1.0 + wob * 0.12);
                    if (this.lowerBody) this.lowerBody.scale.set(1.0 - wob * 0.06, 1.0 + wob * 0.05, 1.0 - wob * 0.06);
                    this.model.rotation.z = Math.sin(t * 5.5) * 0.025;
                    if (this.core) this.core.material.emissiveIntensity = 1.2 + Math.abs(Math.sin(t * 3)) * 0.7;
                    if (this._oozeMat) this._oozeMat.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 2)) * 0.3;
                    if (this.glaze) this.glaze.children.forEach(gz => { gz.position.y = gz._base - ((t * 0.2 + gz._t) % 1) * 0.12; });
                    break;
                }
                case 'swarminghivemind': {
                    const hue = (t * 0.15) % 1;
                    if (this._oozeMat) this._oozeMat.emissive.setHSL(0.55 + hue * 0.2, 0.7, 0.3);
                    if (this.swarm) this.swarm.children.forEach(sb => {
                        const e = sb._e + Math.sin(t * sb._spd + sb._t) * 0.5;
                        const a = sb._a + t * sb._spd * 0.4;
                        const rad = sb._rad * (0.8 + Math.sin(t * sb._spd * 1.3 + sb._t) * 0.25);
                        sb.position.set(Math.cos(a) * Math.sin(e) * rad, 0.6 + Math.cos(e) * 0.45, Math.sin(a) * Math.sin(e) * rad);
                    });
                    if (this.hiveEyes) this.hiveEyes.children.forEach((ey, i) => { ey.scale.y = (Math.sin(t * 3 + ey._t * 9) > 0.9) ? 0.15 : 1.0; });
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.2);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            // Melt: flatten and spread as it fades.
            const flat = 1 - prog * 0.8;
            if (this.lowerBody) this.lowerBody.scale.set(1.1 + prog, 0.8 * flat, 1.1 + prog);
            if (this.upperBody) this.upperBody.scale.set(1.0 * flat, 0.95 * flat, 1.0 * flat);
            this.model.position.y = this._baseY - prog * 0.15 * this.scale;
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new OozeBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = O_PROFILES;
    Object.keys(S).forEach(k => reg(k, { aliases: [k], scale: S[k].scale, weapon: 0, create: make }));
    ["og_gelatinouspudding","og_gelatinousooze","og_moltenmirespawn","og_glitteringlarva","og_ochrejellyswarm","og_swarmingmirespawn","og_gelatinoushuskbeetle","og_discordlarva","og_skitteringdronebug"].forEach(k => reg(k, { aliases: [k], scale: S[k].scale, weapon: 0, create: make }));

    const NAMED = {
        expiredooze:  ["Expired Ooze"],
        rubberblob:   ["Rubber Reality Blob"],
        azureslime:   ["Azure Slime"],
        crimsonjelly: ["Crimson Jelly"],
        emeraldooze:  ["Emerald Ooze"], goldenpudding: ["Golden Pudding"], grassslime: ["Grass Slime"], greenslime: ["Green Slime"],
        inkblotchild: ["Ink Blot Child"], mudslime: ["Mud Slime"], pinkslime: ["Pink Slime"], sandslime: ["Sand Slime"],
        shockslime: ["Shock Slime"], slimeknight: ["Slime Knight"], toxicsludge: ["Toxic Sludge"], voidgel: ["Void Gel"],
        fh_skinballoon: ["Skin Balloon"], fh_brainswarmer: ["Brain Swarmer"], fh_echomaw: ["Echo Maw"],
        fh_soulharvester: ["Soul Harvester"], fh_bonechewer: ["Bonechewer Devourer"], fh_crimsonharvester: ["Crimson Harvester"],
        fh_etherealdevourer: ["Ethereal Devourer"], fh_migo: ["Mi-go Brain Harvester"], fh_abyssaldevourer: ["Abyssal Devourer"],
        fh_carrionstalker: ["Carrion Stalker"], fh_bleedingstatue: ["Bleeding Statue"], fh_geometrydevourer: ["Geometry Devourer"],
        fh_womb: ["Womb of Nightmares"], fh_fleshcalculator: ["Flesh Calculator"], fh_breathingbuilding: ["Breathing Building"],
        grotesqueslime: ["Grotesque Slime"], moltenslag: ["Molten Slag"],
        pumpkinslime: ["Pumpkin Slime"], rainbowslime: ["Rainbow Slime"], seeingslime: ["Seeing Slime"],
        skulmireslime: ["Skulmire Slime"], thunderblob: ["Thunder Blob"], toxicamalgam: ["Toxic Amalgam"],
        causticslime: ["Caustic Slime"], toxicooze: ["Toxic Ooze"], virulentslimefiend: ["Virulent Slimefiend"],
        sewersslime: ["Sewers slime"], moltenpudding: ["Molten Pudding"], swarminghivemind: ["Swarming Hivemind"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Ooze uniques registered');
})();
