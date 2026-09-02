//=============================================================================
// 3D Battler System - Bug Uniques
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Bespoke insectoid one-off models (disco beetle, ladybug,
 * grasshopper, acid ant, draconic dragonfly, buzzing bumblebee, blood mosquito)
 * + name-based assignment. Requires 3DBattlerSystem + families first.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Bug Uniques
 * ============================================================================
 *
 * Distinct procedural insects shaped from each enemy's flavour text, assigned by
 * exact name (override with <Battler3D: key>). They map the Insectoid archetype
 * body-part keys (HEAD/THORAX/ABDOMEN/MANDIBLES + the six leg keys) so
 * dismemberment + hit-flash work, and reuse the base per-id variation + gestures.
 *
 * Registered: discobeetle, ladybug, grasshopper, acidant, dragonfly,
 *             bumblebee, bloodmosquito
 *
 * MUST load AFTER the other Battler3D family plugins.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Bugs] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    const B_PROFILES = {
        discobeetle:   { variant: 'discobeetle',   scale: 1.8, texturePool: 'metal',   bodyColor: 0x24242c, accent: 0xff44cc, hue: [0.80, 0.20], sat: [0.20, 0.10], lit: [0.30, 0.10] },
        ladybug:       { variant: 'ladybug',       scale: 1.6, texturePool: 'fire',    bodyColor: 0xcc2222, accent: 0x111111, hue: [0.01, 0.03], sat: [0.70, 0.10], lit: [0.45, 0.08] },
        grasshopper:   { variant: 'grasshopper',   scale: 1.9, texturePool: 'foliage', bodyColor: 0x6aaa3a, accent: 0x223311, hue: [0.28, 0.06], sat: [0.50, 0.12], lit: [0.45, 0.10] },
        acidant:       { variant: 'acidant',       scale: 1.8, texturePool: 'wood',    bodyColor: 0x3a2a1a, accent: 0x9bff44, hue: [0.08, 0.04], sat: [0.45, 0.12], lit: [0.30, 0.08] },
        dragonfly:     { variant: 'dragonfly',     scale: 1.9, texturePool: 'crystal', bodyColor: 0x2a8a7a, accent: 0x66ddff, hue: [0.48, 0.10], sat: [0.45, 0.15], lit: [0.45, 0.10] },
        bumblebee:     { variant: 'bumblebee',     scale: 1.7, texturePool: 'fur',     bodyColor: 0xf0c020, accent: 0x111111, hue: [0.13, 0.03], sat: [0.75, 0.10], lit: [0.52, 0.08] },
        bloodmosquito: { variant: 'bloodmosquito', scale: 1.7, texturePool: 'flesh',   bodyColor: 0x5a1a1a, accent: 0xcc2233, hue: [0.99, 0.04], sat: [0.55, 0.12], lit: [0.32, 0.08] },
        crawlinghand:    { variant: 'crawlinghand',    scale: 1.7, texturePool: 'flesh',   bodyColor: 0xdee6ad, accent: 0x885a33, hue: [0.05, 0.03], sat: [0.30, 0.10], lit: [0.62, 0.08], front: true },
        engorgedtick:    { variant: 'engorgedtick',    scale: 1.8, texturePool: 'flesh',   bodyColor: 0x7a1414, accent: 0xaa2a2a, hue: [0.99, 0.03], sat: [0.70, 0.12], lit: [0.30, 0.08] },
        firecentipede:   { variant: 'firecentipede',   scale: 2.0, texturePool: 'fire',    bodyColor: 0x301008, accent: 0xff6a18, hue: [0.05, 0.04], sat: [0.85, 0.10], lit: [0.30, 0.10] },
        frostscarab:     { variant: 'frostscarab',     scale: 1.8, texturePool: 'crystal', bodyColor: 0x9fc8e6, accent: 0xddf4ff, hue: [0.56, 0.06], sat: [0.35, 0.12], lit: [0.62, 0.08] },
        gloomwurm:       { variant: 'gloomwurm',       scale: 2.2, texturePool: 'flesh',   bodyColor: 0x2a2230, accent: 0x6a3a8a, hue: [0.78, 0.06], sat: [0.30, 0.12], lit: [0.22, 0.08] },
        gutturalmaggotus:{ variant: 'gutturalmaggotus',scale: 2.0, texturePool: 'flesh',   bodyColor: 0xe9dcc0, accent: 0xbcd84a, hue: [0.14, 0.05], sat: [0.30, 0.12], lit: [0.60, 0.08] },
        hivemindtermite:   { variant: 'hivemindtermite',   scale: 1.8, texturePool: 'wood',    bodyColor: 0xe7dcc2, accent: 0xc8a85a, hue: [0.10, 0.04], sat: [0.25, 0.10], lit: [0.62, 0.08] },
        junglestalker:     { variant: 'junglestalker',     scale: 2.0, texturePool: 'foliage', bodyColor: 0x3c7a22, accent: 0xb6ff3a, hue: [0.27, 0.06], sat: [0.60, 0.12], lit: [0.34, 0.10] },
        luminouslocustking:{ variant: 'luminouslocustking',scale: 2.0, texturePool: 'crystal', bodyColor: 0x4a9a3a, accent: 0xfff070, hue: [0.20, 0.08], sat: [0.55, 0.12], lit: [0.45, 0.10] },
        magmacentipede:    { variant: 'magmacentipede',    scale: 2.1, texturePool: 'fire',    bodyColor: 0x18120f, accent: 0xff5a12, hue: [0.05, 0.04], sat: [0.85, 0.10], lit: [0.20, 0.10] },
        mothshadestalker:  { variant: 'mothshadestalker',  scale: 1.9, texturePool: 'fur',     bodyColor: 0x554a55, accent: 0xc8a0e0, hue: [0.78, 0.06], sat: [0.25, 0.10], lit: [0.40, 0.08] },
        swampscorpion:     { variant: 'swampscorpion',     scale: 1.9, texturePool: 'foliage', bodyColor: 0x4a5a2a, accent: 0x9bd84a, hue: [0.22, 0.05], sat: [0.45, 0.12], lit: [0.30, 0.08] },
        toxicghost:        { variant: 'toxicghost',        scale: 1.9, texturePool: 'flesh',   bodyColor: 0x6aa83a, accent: 0xcaff44, hue: [0.26, 0.05], sat: [0.55, 0.12], lit: [0.42, 0.08] },
        venomousdragonfly: { variant: 'venomousdragonfly', scale: 2.0, texturePool: 'crystal', bodyColor: 0x4a8a3a, accent: 0xb4ff3a, hue: [0.30, 0.10], sat: [0.55, 0.15], lit: [0.45, 0.10] },
        chromatictick:     { variant: 'chromatictick',     scale: 1.7, texturePool: 'metal',   bodyColor: 0x222230, accent: 0x40ffd0, hue: [0.50, 0.40], sat: [0.70, 0.20], lit: [0.40, 0.12] },
        mindflayermoth:    { variant: 'mindflayermoth',    scale: 2.1, texturePool: 'fur',     bodyColor: 0x5a3a8a, accent: 0xff44dd, hue: [0.76, 0.20], sat: [0.55, 0.20], lit: [0.45, 0.12], front: true },
        emotionalleech:    { variant: 'emotionalleech',    scale: 1.8, texturePool: 'flesh',   bodyColor: 0xe87aa0, accent: 0xff4d88, hue: [0.94, 0.05], sat: [0.50, 0.12], lit: [0.58, 0.10] },
        memoryleech:       { variant: 'memoryleech',       scale: 1.8, texturePool: 'flesh',   bodyColor: 0x6a7a92, accent: 0xaecade, hue: [0.58, 0.05], sat: [0.25, 0.10], lit: [0.50, 0.10] },
        thoughtparasite:        { variant: 'thoughtparasite',        scale: 1.7, texturePool: 'crystal', bodyColor: 0xb8c8e0, accent: 0xa0d8ff, hue: [0.58, 0.06], sat: [0.20, 0.10], lit: [0.62, 0.10] },
        emberbackhellscorpion:  { variant: 'emberbackhellscorpion',  scale: 2.0, texturePool: 'fire',    bodyColor: 0x141014, accent: 0xff5a14, hue: [0.04, 0.04], sat: [0.85, 0.10], lit: [0.16, 0.08] },
        gravityworm:            { variant: 'gravityworm',            scale: 2.2, texturePool: 'crystal', bodyColor: 0x14121c, accent: 0x6a3aff, hue: [0.72, 0.06], sat: [0.40, 0.12], lit: [0.16, 0.08] },
        temporalhornet:         { variant: 'temporalhornet',         scale: 1.8, texturePool: 'metal',   bodyColor: 0xf0c020, accent: 0x88e0ff, hue: [0.13, 0.04], sat: [0.75, 0.10], lit: [0.52, 0.08] }
    };

    class BugBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = B_PROFILES[creatureType] || B_PROFILES.ladybug;
            super(scale, offsetY, battler, profile, 0, creatureType || 'ladybug');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            this._legs = []; this.legL = []; this.legR = [];
        }

        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.7 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.5 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity), side: THREE.DoubleSide
            });
            this._materials.push(m);
            return m;
        }
        _skinMat(color, rough) { return this.applySkin(this._mat(color, 1.0, rough === undefined ? 0.7 : rough)); }
        _eye(parent, x, y, z, r, accent) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), this._mat(0x111111, 1.0, 0.2));
            eye.position.set(x, y, z);
            const shine = new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 8, 8), this._mat(accent || 0xffffff, 1.0, 0.2, accent));
            shine.position.set(0, r * 0.2, r * 0.7); eye.add(shine);
            parent.add(eye); return eye;
        }

        // Standard 2-segment insect leg.
        _bugLeg(side, z, y, mat) {
            const g = new THREE.Group();
            const u = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.34, 4), mat); u.position.set(side * 0.16, -0.04, 0); u.rotation.z = side * 1.0; g.add(u);
            const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.32, 4), mat); l.position.set(side * 0.34, -0.26, 0); l.rotation.z = side * 0.2; g.add(l);
            g.position.set(0, y, z); g._side = side; this.bodyGroup.add(g); this._legs.push(g); return g;
        }
        // Build the 6 legs + wire the archetype part-keys/cascade.
        _wireBug(o) {
            const mat = o.mat, ys = o.legY;
            (o.legZs || [0.25, 0.0, -0.25]).forEach(z => { this.legL.push(this._bugLeg(-1, z, ys, mat)); this.legR.push(this._bugLeg(1, z, ys, mat)); });
            const mand = o.mandibles || null;
            this._partMeshMap = { HEAD: o.head, THORAX: o.thorax, ABDOMEN: o.abdomen };
            if (mand) this._partMeshMap.MANDIBLES = mand;
            const lk = ['LEFT_LEG', 'MIDDLE_LEFT_LEG', 'REAR_LEFT_LEG'], rk = ['RIGHT_LEG', 'MIDDLE_RIGHT_LEG', 'REAR_RIGHT_LEG'];
            this.legL.forEach((l, i) => { this._partMeshMap[lk[i]] = l; });
            this.legR.forEach((l, i) => { this._partMeshMap[rk[i]] = l; });
            const extra = (o.extra || []).filter(Boolean);
            this._cascadeRules = [
                { gone: ['THORAX'], hide: [o.thorax, o.head, mand, ...extra, ...this._legs].filter(Boolean) },
                { gone: ['ABDOMEN'], hide: [o.abdomen, ...extra].filter(Boolean) },
                { gone: ['HEAD'], hide: [o.head] },
                mand ? { gone: ['MANDIBLES'], hide: [mand] } : null,
                ...lk.concat(rk).map(k => ({ gone: [k], hide: [this._partMeshMap[k]] }))
            ].filter(Boolean);
        }
        _antennae(head, mat, accent) {
            for (const ax of [-0.07, 0.07]) {
                const a = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.34, 4), mat); a.position.set(ax, 0.22, 0.05); a.rotation.x = -0.5; head.add(a);
                const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), this._mat(accent, 1.0, 0.3, accent)); tip.position.set(ax * 1.5, 0.38, 0.13); head.add(tip);
            }
        }

        async load(physicsWorld /*, sx, sy, sz */) {
            this.physicsWorld = physicsWorld;
            switch (this.variant) {
                case 'discobeetle':   this._buildDiscoBeetle(); break;
                case 'grasshopper':   this._buildGrasshopper(); break;
                case 'acidant':       this._buildAcidAnt(); break;
                case 'dragonfly':     this._buildDragonfly(); break;
                case 'bumblebee':     this._buildBumblebee(); break;
                case 'bloodmosquito': this._buildMosquito(); break;
                case 'crawlinghand':  this._buildCrawlingHand(); break;
                case 'engorgedtick':  this._buildEngorgedTick(); break;
                case 'firecentipede': this._buildFireCentipede(); break;
                case 'frostscarab':   this._buildFrostScarab(); break;
                case 'gloomwurm':     this._buildGloomwurm(); break;
                case 'gutturalmaggotus': this._buildGutturalMaggotus(); break;
                case 'hivemindtermite':  this._buildHivemindTermite(); break;
                case 'junglestalker':    this._buildJungleStalker(); break;
                case 'luminouslocustking': this._buildLocustKing(); break;
                case 'magmacentipede':   this._buildMagmaCentipede(); break;
                case 'mothshadestalker': this._buildMothshadeStalker(); break;
                case 'swampscorpion':    this._buildSwampScorpion(); break;
                case 'toxicghost':       this._buildToxicGhost(); break;
                case 'venomousdragonfly':this._buildVenomousDragonfly(); break;
                case 'chromatictick':    this._buildChromaticTick(); break;
                case 'mindflayermoth':   this._buildMindFlayerMoth(); break;
                case 'emotionalleech':   this._buildEmotionalLeech(); break;
                case 'memoryleech':      this._buildMemoryLeech(); break;
                case 'thoughtparasite':       this._buildThoughtParasite(); break;
                case 'emberbackhellscorpion': this._buildEmberbackHellscorpion(); break;
                case 'gravityworm':           this._buildGravityWorm(); break;
                case 'temporalhornet':        this._buildTemporalHornet(); break;
                default:              this._buildLadybug(); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Disco Beetle: a mirrored disco-ball carapace, ALL funk ───────────
        _buildDiscoBeetle() {
            const p = this.profile;
            const bodyMat = this._mat(0x1c1c22, 1.0, 0.4);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), bodyMat); this.thorax.position.set(0, 0.95, 0.0); this.thorax.scale.set(1, 0.9, 1.1); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 14), bodyMat); this.abdomen.position.set(0, 1.0, -0.45); this.abdomen.scale.set(1.1, 1.0, 1.3); this.bodyGroup.add(this.abdomen);
            // Mirror-tile disco ball over the abdomen dome.
            this._discoMats = [];
            this.carapace = new THREE.Group();
            const tileGeo = new THREE.BoxGeometry(0.12, 0.12, 0.025);
            const cx0 = 0, cy0 = 1.0, cz0 = -0.45;
            for (let i = 0; i < 24; i++) {
                const theta = this.idRand() * Math.PI * 2, phi = Math.acos(this.idRand()) * 0.95;
                const x = Math.sin(phi) * Math.cos(theta) * 0.55, y = Math.cos(phi) * 0.5, z = Math.sin(phi) * Math.sin(theta) * 0.65;
                const m = this._mat(0xffffff, 1.0, 0.12, 0x222222); this._discoMats.push(m);
                const tile = new THREE.Mesh(tileGeo, m);
                tile.position.set(cx0 + x, cy0 + y, cz0 + z);
                tile.lookAt(cx0 + x * 2, cy0 + y * 2, cz0 + z * 2);
                this.carapace.add(tile);
            }
            this.bodyGroup.add(this.carapace);
            // Head + glowing antennae.
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), bodyMat); this.head.add(h);
            this._eye(this.head, -0.11, 0.04, 0.14, 0.07, p.accent); this._eye(this.head, 0.11, 0.04, 0.14, 0.07, p.accent);
            this._antennae(this.head, bodyMat, p.accent);
            this.head.position.set(0, 1.0, 0.35); this.bodyGroup.add(this.head);
            // Funky light rays beaming out of the ball.
            this.rays = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * Math.PI * 2;
                const ray = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.8, 4), this._mat(0xffffff, 0.32, 0.3, 0xffffff));
                ray.position.set(Math.cos(a) * 0.55, 1.5, Math.sin(a) * 0.35 - 0.45);
                ray.rotation.z = Math.PI / 2 - a; ray.rotation.x = Math.sin(a) * 0.6; ray._a = a;
                this.rays.add(ray);
            }
            this.bodyGroup.add(this.rays);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, extra: [this.carapace, this.rays], legY: 0.92, mat: bodyMat });
        }

        // ── Ladybug: red domed elytra with black spots, opens to fly ─────────
        _buildLadybug() {
            const p = this.profile;
            const red = this._skinMat(p.bodyColor, 0.4);
            const black = this._mat(0x141414, 1.0, 0.5);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), black); this.thorax.position.set(0, 0.85, 0.32); this.thorax.scale.set(1.2, 0.7, 0.9); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), black); this.abdomen.position.set(0, 0.78, -0.15); this.abdomen.scale.set(1.05, 1.0, 1.25); this.bodyGroup.add(this.abdomen);
            // Elytra halves (the two red wing-cases) split down the middle.
            this.leftWing = this._elytron(-1, red, black); this.rightWing = this._elytron(1, red, black);
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), black); h.scale.set(1.2, 0.8, 0.9); this.head.add(h);
            this._eye(this.head, -0.1, 0.03, 0.13, 0.06, p.accent); this._eye(this.head, 0.1, 0.03, 0.13, 0.06, p.accent);
            this._antennae(this.head, black, 0x884400);
            this.head.position.set(0, 0.86, 0.56); this.bodyGroup.add(this.head);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, extra: [this.leftWing, this.rightWing], legY: 0.72, mat: black });
        }
        _elytron(side, red, black) {
            const g = new THREE.Group();
            const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI, 0, Math.PI / 2), red);
            shell.scale.set(0.55, 1.0, 1.25); shell.rotation.y = side > 0 ? 0 : Math.PI; g.add(shell);
            for (let i = 0; i < 3; i++) { const spot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), black); const a = 0.4 + i * 0.5; spot.position.set(side * 0.18, 0.78 + Math.cos(a) * 0.0, -0.1 - i * 0.18); spot.position.y = 1.0; spot.rotation.x = -1.0; g.add(spot); }
            g.position.set(side * 0.02, 0.78, -0.15); g._side = side; this.bodyGroup.add(g); return g;
        }

        // ── Grasshopper: long green body with huge sprung hind legs ──────────
        _buildGrasshopper() {
            const p = this.profile;
            const green = this._skinMat(p.bodyColor, 0.5);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), green); this.thorax.position.set(0, 0.8, 0.2); this.thorax.scale.set(1, 1.1, 1.3); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.95, 10), green); this.abdomen.position.set(0, 0.8, -0.55); this.abdomen.rotation.x = Math.PI / 2; this.bodyGroup.add(this.abdomen);
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), green); h.scale.set(0.9, 1.2, 1.0); this.head.add(h);
            this._eye(this.head, -0.12, 0.06, 0.1, 0.08, p.accent); this._eye(this.head, 0.12, 0.06, 0.1, 0.08, p.accent);
            this._antennae(this.head, green, 0x335511);
            this.head.position.set(0, 0.86, 0.5); this.bodyGroup.add(this.head);
            // Big sprung hind legs (the iconic part).
            this.hindLeft = this._hopperLeg(-1, green); this.hindRight = this._hopperLeg(1, green);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, extra: [this.hindLeft, this.hindRight], legY: 0.72, legZs: [0.4, 0.2], mat: green });
        }
        _hopperLeg(side, mat) {
            const g = new THREE.Group();
            const thighGeo = THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.07, 0.32, 4, 8) : new THREE.CylinderGeometry(0.13, 0.05, 0.42, 6);
            const thigh = new THREE.Mesh(thighGeo, mat);
            thigh.position.set(side * 0.18, 0.05, 0); thigh.rotation.z = side * 0.5; g.add(thigh);
            const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.5, 5), mat); shin.position.set(side * 0.34, -0.2, -0.05); shin.rotation.z = -side * 0.4; g.add(shin);
            g.position.set(0, 0.72, -0.4); g._side = side; this.bodyGroup.add(g); return g;
        }

        // ── Acid Ant: three-segment ant with acid-dripping mandibles ─────────
        _buildAcidAnt() {
            const p = this.profile;
            const chitin = this._skinMat(p.bodyColor, 0.45);
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), chitin); h.scale.set(1.1, 1, 0.9); this.head.add(h);
            this._eye(this.head, -0.13, 0.05, 0.14, 0.07, p.accent); this._eye(this.head, 0.13, 0.05, 0.14, 0.07, p.accent);
            this._antennae(this.head, chitin, p.accent);
            this.head.position.set(0, 0.92, 0.55); this.bodyGroup.add(this.head);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), chitin); this.thorax.position.set(0, 0.92, 0.05); this.thorax.scale.set(1, 0.95, 1.2); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), chitin); this.abdomen.position.set(0, 0.95, -0.55); this.abdomen.scale.set(1, 1.05, 1.35); this.bodyGroup.add(this.abdomen);
            // Acid mandibles + drip.
            this.mandibles = new THREE.Group();
            const acid = this._mat(p.accent, 0.95, 0.3, p.accent);
            for (const mx of [-0.1, 0.1]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 4), chitin); m.position.set(mx, 0.86, 0.78); m.rotation.x = 1.5; m.rotation.z = -mx * 2; this.mandibles.add(m); }
            this.acidDrop = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), acid); this.acidDrop.position.set(0, 0.8, 0.82); this.acidDrop.scale.y = 1.4; this.mandibles.add(this.acidDrop);
            this.bodyGroup.add(this.mandibles);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, legY: 0.86, mat: chitin });
        }

        // ── Draconic Dragonfly: long body, four iridescent wings ─────────────
        _buildDragonfly() {
            const p = this.profile;
            const body = this._skinMat(p.bodyColor, 0.4);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), body); this.thorax.position.set(0, 1.05, 0.1); this.thorax.scale.set(1, 1, 1.2); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.04, 1.3, 10), body); this.abdomen.position.set(0, 1.05, -0.75); this.abdomen.rotation.x = Math.PI / 2; this.bodyGroup.add(this.abdomen);
            this.head = new THREE.Group();
            const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(0x223344, 1.0, 0.2, p.accent)); eyeL.position.set(-0.12, 0, 0.05); this.head.add(eyeL);
            const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(0x223344, 1.0, 0.2, p.accent)); eyeR.position.set(0.12, 0, 0.05); this.head.add(eyeR);
            this.head.position.set(0, 1.05, 0.55); this.bodyGroup.add(this.head);
            // Four veined, iridescent wings.
            this.wings = new THREE.Group();
            const wingMat = this._mat(p.accent, 0.35, 0.2, p.accent);
            for (const [sx, sz] of [[-1, 0.18], [1, 0.18], [-1, -0.05], [1, -0.05]]) {
                const w = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12), wingMat); w.scale.set(1.1, 0.34, 1);
                w.position.set(sx * 0.42, 1.12, sz); w.rotation.x = -Math.PI / 2; w.rotation.z = sx * 0.1; w._sx = sx; this.wings.add(w);
            }
            this.bodyGroup.add(this.wings);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, extra: [this.wings], legY: 0.98, legZs: [0.25, 0.05], mat: body });
        }

        // ── Buzzing Bumblebee: round fuzzy striped body, little wings ────────
        _buildBumblebee() {
            const p = this.profile;
            const fuzz = this._skinMat(p.bodyColor, 0.95);
            const black = this._mat(0x141210, 1.0, 0.8);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), fuzz); this.thorax.position.set(0, 0.95, 0.25); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 14), fuzz); this.abdomen.position.set(0, 0.95, -0.35); this.abdomen.scale.set(1, 1, 1.25); this.bodyGroup.add(this.abdomen);
            for (let i = 0; i < 2; i++) { const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.06, 8, 16), black); stripe.position.set(0, 0.95, -0.2 - i * 0.3); stripe.rotation.x = Math.PI / 2; stripe.scale.set(1, 1.05, 1); this.bodyGroup.add(stripe); }
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), black); this.head.add(h);
            this._eye(this.head, -0.1, 0.03, 0.14, 0.06, p.accent); this._eye(this.head, 0.1, 0.03, 0.14, 0.06, p.accent);
            this._antennae(this.head, black, 0x664400);
            this.head.position.set(0, 0.98, 0.58); this.bodyGroup.add(this.head);
            this.wings = new THREE.Group();
            const wingMat = this._mat(0xeef4ff, 0.4, 0.2);
            for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), wingMat); w.scale.set(1, 0.5, 1); w.position.set(sx * 0.28, 1.25, 0.0); w.rotation.x = -Math.PI / 2; w.rotation.z = sx * 0.3; w._sx = sx; this.wings.add(w); }
            this.bodyGroup.add(this.wings);
            // Stinger on the abdomen tip.
            this.stinger = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), black); this.stinger.position.set(0, 0.95, -0.92); this.stinger.rotation.x = -Math.PI / 2; this.bodyGroup.add(this.stinger);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, extra: [this.wings, this.stinger], legY: 0.78, mat: black });
        }

        // ── Blood Mosquito: thin body, long proboscis, blood-filled abdomen ──
        _buildMosquito() {
            const p = this.profile;
            const body = this._skinMat(p.bodyColor, 0.5);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), body); this.thorax.position.set(0, 1.0, 0.1); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), this._mat(p.accent, 0.9, 0.35, 0x440a0a)); this.abdomen.position.set(0, 1.0, -0.6); this.abdomen.scale.set(1, 1, 2.1); this.bodyGroup.add(this.abdomen);
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), body); this.head.add(h);
            this._eye(this.head, -0.08, 0.03, 0.1, 0.06, p.accent); this._eye(this.head, 0.08, 0.03, 0.1, 0.06, p.accent);
            // Long needle proboscis.
            this.proboscis = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.004, 0.55, 5), this._mat(0x221015, 1.0, 0.4)); this.proboscis.position.set(0, -0.02, 0.32); this.proboscis.rotation.x = Math.PI / 2; this.head.add(this.proboscis);
            this.head.position.set(0, 1.0, 0.42); this.bodyGroup.add(this.head);
            this.wings = new THREE.Group();
            const wingMat = this._mat(0xdfe6ee, 0.35, 0.2);
            for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.32, 10), wingMat); w.scale.set(1.3, 0.28, 1); w.position.set(sx * 0.18, 1.15, -0.15); w.rotation.x = -Math.PI / 2; w.rotation.z = sx * 0.15; w._sx = sx; this.wings.add(w); }
            this.bodyGroup.add(this.wings);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, extra: [this.wings, this.proboscis], legY: 0.92, mat: body });
        }

        // ── Crawling Hand: severed pale hand walking on its 5 fingers ────────
        _buildCrawlingHand() {
            const p = this.profile;
            const flesh = this._skinMat(p.bodyColor, 0.6);
            // Palm (the core / body).
            this.core = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.6), flesh);
            this.core.position.set(0, 0.55, 0); this.bodyGroup.add(this.core);
            // Cut wrist stump at the back with raw bone.
            const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.18, 8), this._mat(0x9a2a2a, 1.0, 0.5));
            stump.position.set(0, 0.55, -0.36); stump.rotation.x = Math.PI / 2; this.bodyGroup.add(stump);
            const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 6), this._mat(0xf0eede, 1.0, 0.5));
            bone.position.set(0, 0.55, -0.44); bone.rotation.x = Math.PI / 2; this.bodyGroup.add(bone);
            // Five fingers acting as legs (4 forward + thumb to the side).
            this._fingers = [];
            const fingerDefs = [[-0.2, 0.34, 0], [-0.07, 0.36, 0], [0.07, 0.36, 0], [0.2, 0.32, 0], [-0.3, 0.05, 1]];
            for (const [fx, fz, thumb] of fingerDefs) {
                const g = new THREE.Group();
                const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), flesh); g.add(knuckle);
                const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.28, 6), flesh); seg.position.set(0, -0.16, 0.02); seg.rotation.x = thumb ? 0.5 : 0.9; g.add(seg);
                const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.22, 6), flesh); tip.position.set(0, -0.36, 0.16); tip.rotation.x = thumb ? -0.4 : -0.3; g.add(tip);
                const nail = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), this._mat(0xd8cbb0, 1.0, 0.4)); nail.position.set(0, -0.45, 0.27); g.add(nail);
                g.position.set(fx, 0.5, fz); g._thumb = thumb; this.bodyGroup.add(g); this._fingers.push(g); this._legs.push(g);
            }
            // Face on the BACK of the hand.
            this.head = new THREE.Group();
            this._eye(this.head, -0.12, 0.0, 0.0, 0.06, p.accent); this._eye(this.head, 0.12, 0.0, 0.0, 0.06, p.accent);
            const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI), this._mat(0x6a1a26, 1.0, 0.5));
            mouth.position.set(0, -0.14, 0.0); mouth.rotation.z = Math.PI; this.head.add(mouth);
            this.head.position.set(0, 0.66, 0.05); this.bodyGroup.add(this.head);
            // Two wisp-tendrils trailing up from the wrist.
            this._wisps = [];
            for (const wx of [-1, 1]) {
                const w = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.55, 5), this._mat(p.accent, 0.45, 0.3, p.accent));
                w.position.set(wx * 0.18, 0.85, -0.28); w.rotation.x = -0.5; w._sx = wx; this.bodyGroup.add(w); this._wisps.push(w);
            }
            this._partMeshMap = { FACE: this.head, CORE: this.core, LEFT_WISP: this._wisps[0], RIGHT_WISP: this._wisps[1] };
            this._cascadeRules = [
                { gone: ['CORE'], hide: [this.core, this.head, stump, bone, ...this._fingers, ...this._wisps] },
                { gone: ['FACE'], hide: [this.head] },
                { gone: ['LEFT_WISP'], hide: [this._wisps[0]] },
                { gone: ['RIGHT_WISP'], hide: [this._wisps[1]] }
            ];
        }

        // ── Engorged Tick: tiny head, swollen blood-red abdomen, many legs ───
        _buildEngorgedTick() {
            const p = this.profile;
            const chitin = this._mat(0x3a0c0c, 1.0, 0.5);
            const blood = this._skinMat(p.bodyColor, 0.35);
            // Massive bloated abdomen dominates.
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.6, 18, 16), blood); this.abdomen.position.set(0, 0.85, -0.3); this.abdomen.scale.set(1.05, 1.15, 1.1); this.bodyGroup.add(this.abdomen);
            // Engorgement seams.
            for (let i = 0; i < 3; i++) { const seam = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.03, 6, 18), this._mat(0x4a1010, 1.0, 0.5)); seam.position.set(0, 0.85 + (i - 1) * 0.22, -0.3); seam.rotation.x = Math.PI / 2; this.bodyGroup.add(seam); }
            // Small thorax + tiny head jutting forward.
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), chitin); this.thorax.position.set(0, 0.62, 0.3); this.thorax.scale.set(1.2, 0.7, 1); this.bodyGroup.add(this.thorax);
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), chitin); h.scale.set(1, 0.7, 1.2); this.head.add(h);
            this._eye(this.head, -0.05, 0.02, 0.06, 0.025, p.accent); this._eye(this.head, 0.05, 0.02, 0.06, 0.025, p.accent);
            this.head.position.set(0, 0.6, 0.46); this.bodyGroup.add(this.head);
            // Mandible piercing mouthparts.
            this.mandibles = new THREE.Group();
            for (const mx of [-0.04, 0.04]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 4), chitin); m.position.set(mx, 0.58, 0.58); m.rotation.x = 1.5; this.mandibles.add(m); }
            this.bodyGroup.add(this.mandibles);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, legY: 0.5, legZs: [0.34, 0.18, 0.02], mat: chitin });
        }

        // ── Fire Centipede: long glowing segmented body, dozens of legs ──────
        _buildFireCentipede() {
            const p = this.profile;
            const shellMat = this._mat(p.bodyColor, 1.0, 0.4, 0x661500);
            const glowMat = this._mat(p.accent, 1.0, 0.3, p.accent);
            this._segGlow = [glowMat];
            // Head with mandibles.
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), shellMat); h.scale.set(1.1, 0.9, 1); this.head.add(h);
            this._eye(this.head, -0.1, 0.05, 0.14, 0.05, p.accent); this._eye(this.head, 0.1, 0.05, 0.14, 0.05, p.accent);
            this.head.position.set(0, 0.85, 0.7); this.bodyGroup.add(this.head);
            this.mandibles = new THREE.Group();
            for (const mx of [-0.09, 0.09]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.24, 4), glowMat); m.position.set(mx, 0.82, 0.92); m.rotation.x = 1.4; m.rotation.z = -mx * 3; this.mandibles.add(m); }
            this.bodyGroup.add(this.mandibles);
            // Long chain of segments curving back; glowing gaps between plates.
            this._segments = [];
            const N = 8;
            for (let i = 0; i < N; i++) {
                const z = 0.45 - i * 0.26;
                const seg = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), shellMat); seg.scale.set(1.1, 0.85, 1); seg.position.set(0, 0.85, z); this.bodyGroup.add(seg); this._segments.push(seg);
                const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 14), this._mat(p.accent, 1.0, 0.3, p.accent)); ring.position.set(0, 0.85, z + 0.13); ring.rotation.x = Math.PI / 2; this.bodyGroup.add(ring); this._segGlow.push(ring.material);
            }
            // Thorax = first body segment, abdomen = last (for the rig).
            this.thorax = this._segments[0]; this.abdomen = this._segments[N - 1];
            // Wire base 6 legs, then add MANY more burning legs along the body.
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, legY: 0.78, legZs: [0.3, 0.1, -0.1], mat: shellMat });
            for (let i = 0; i < N; i++) { const z = 0.45 - i * 0.26; for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.3, 4), glowMat); leg.position.set(s * 0.22, 0.72, z); leg.rotation.z = s * 1.0; this.bodyGroup.add(leg); } }
        }

        // ── Frost Scarab: round beetle, crystalline frost-rimed carapace ─────
        _buildFrostScarab() {
            const p = this.profile;
            const carapaceMat = this._mat(0x6f9fc0, 1.0, 0.25);
            const ice = this._mat(p.accent, 0.7, 0.1, 0x224455);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), carapaceMat); this.thorax.position.set(0, 0.82, 0.28); this.thorax.scale.set(1.2, 0.7, 0.9); this.bodyGroup.add(this.thorax);
            // Big round domed abdomen carapace.
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2), carapaceMat); this.abdomen.position.set(0, 0.72, -0.15); this.abdomen.scale.set(1.1, 1.1, 1.3); this.bodyGroup.add(this.abdomen);
            // Frost crystal shards rimed over the dome.
            this._frost = [];
            for (let i = 0; i < 14; i++) {
                const a = this.idRand() * Math.PI * 2, r = 0.2 + this.idRand() * 0.32;
                const shard = new THREE.Mesh(new THREE.ConeGeometry(0.04 + this.idRand() * 0.03, 0.16 + this.idRand() * 0.12, 4), ice);
                shard.position.set(Math.cos(a) * r, 0.95 + this.idRand() * 0.18, -0.15 + Math.sin(a) * r * 1.1);
                shard.rotation.set(this.idRand() * 0.6 - 0.3, a, this.idRand() * 0.6 - 0.3); this.bodyGroup.add(shard); this._frost.push(shard);
            }
            this.head = new THREE.Group();
            const hh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), carapaceMat); hh.scale.set(1.2, 0.7, 0.9); this.head.add(hh);
            // Clypeus shovel-plate of a scarab.
            const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.04, 8), carapaceMat); plate.position.set(0, 0.0, 0.16); plate.rotation.x = 1.2; this.head.add(plate);
            this._eye(this.head, -0.13, 0.03, 0.1, 0.05, p.accent); this._eye(this.head, 0.13, 0.03, 0.1, 0.05, p.accent);
            this.head.position.set(0, 0.84, 0.56); this.bodyGroup.add(this.head);
            this.mandibles = new THREE.Group();
            for (const mx of [-0.08, 0.08]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), ice); m.position.set(mx, 0.8, 0.74); m.rotation.x = 1.5; this.mandibles.add(m); }
            this.bodyGroup.add(this.mandibles);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, extra: this._frost, legY: 0.66, mat: carapaceMat });
        }

        // Shared worm builder: chain of HEAD/HEART_SEGMENT/BODY_SEGMENT/TAIL.
        _buildWorm(opt) {
            const segMat = opt.segMat, N = opt.count || 7;
            this._wormSegs = [];
            const headR = opt.headR || 0.34;
            // Head.
            this.head = new THREE.Group();
            const hh = new THREE.Mesh(new THREE.SphereGeometry(headR, 14, 12), segMat); hh.scale.set(1, 0.95, 1.15); this.head.add(hh);
            this.head.position.set(0, opt.y, 0.6); this.bodyGroup.add(this.head);
            if (opt.onHead) opt.onHead(this.head);
            // Body chain receding back. Segment index 0 = closest behind head.
            const segGeos = [];
            for (let i = 0; i < N; i++) {
                const z = 0.35 - i * (opt.spacing || 0.34);
                const taper = 1 - (i / N) * (opt.taper || 0.55);
                const r = (opt.bodyR || 0.36) * taper;
                const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), segMat); seg.scale.set(1.05, 0.95, 1.1); seg.position.set(0, opt.y, z); this.bodyGroup.add(seg);
                this._wormSegs.push(seg); segGeos.push(seg);
                if (opt.onSeg) opt.onSeg(seg, i, r, z);
            }
            // Tail = a tapered cone past the last segment.
            const lastZ = 0.35 - (N - 1) * (opt.spacing || 0.34);
            this.tail = new THREE.Mesh(new THREE.ConeGeometry((opt.bodyR || 0.36) * 0.35, 0.5, 8), segMat); this.tail.position.set(0, opt.y, lastZ - 0.34); this.tail.rotation.x = -Math.PI / 2; this.bodyGroup.add(this.tail);
            // Map: HEART_SEGMENT = the front (vital) body chunk, BODY_SEGMENT = the rest.
            const heart = segGeos[0];
            this._partMeshMap = { HEAD: this.head, HEART_SEGMENT: heart, BODY_SEGMENT: segGeos[Math.floor(N / 2)], TAIL: this.tail };
            this._cascadeRules = [
                { gone: ['HEART_SEGMENT'], hide: [this.head, this.tail, ...segGeos] },
                { gone: ['HEAD'], hide: [this.head] },
                { gone: ['BODY_SEGMENT'], hide: segGeos.slice(1).concat(this.tail) },
                { gone: ['TAIL'], hide: [this.tail] }
            ];
        }

        // ── Gloomwurm: titanic sightless segmented worm, shadow miasma ───────
        _buildGloomwurm() {
            const p = this.profile;
            const skin = this._skinMat(p.bodyColor, 0.7);
            this._buildWorm({
                segMat: skin, count: 8, y: 0.7, headR: 0.4, bodyR: 0.42, spacing: 0.36, taper: 0.45,
                onHead: (head) => {
                    // No eyes: a radial maw of inward fangs instead.
                    const maw = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.1, 0.2, 12), this._mat(0x140a18, 1.0, 0.6)); maw.position.set(0, 0, 0.32); maw.rotation.x = Math.PI / 2; head.add(maw);
                    this._fangs = [];
                    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; const f = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 4), this._mat(0xcabfd0, 1.0, 0.4)); f.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.18, 0.34); f.rotation.x = 1.0; f.rotation.z = -a; head.add(f); }
                },
                onSeg: (seg, i) => {
                    // Shadow miasma haze sphere around every other segment.
                    if (i % 2 === 0) { const haze = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), this._mat(p.accent, 0.16, 0.9, p.accent)); haze.position.copy(seg.position); this.bodyGroup.add(haze); (this._miasma = this._miasma || []).push(haze); }
                }
            });
            if (this._miasma) this._cascadeRules[0].hide.push(...this._miasma);
        }

        // ── Guttural Maggotus: bloated pale maggot bursting with spore pustules
        _buildGutturalMaggotus() {
            const p = this.profile;
            const flesh = this._skinMat(p.bodyColor, 0.55);
            this._buildWorm({
                segMat: flesh, count: 7, y: 0.6, headR: 0.3, bodyR: 0.44, spacing: 0.3, taper: 0.3,
                onHead: (head) => {
                    // Blunt sucking mouth, tiny vestigial dark spots.
                    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.04, 6, 12), this._mat(0x8a6a55, 1.0, 0.5)); mouth.position.set(0, -0.02, 0.28); mouth.rotation.x = 0.2; head.add(mouth);
                    this._eye(head, -0.08, 0.06, 0.22, 0.03, 0x442222); this._eye(head, 0.08, 0.06, 0.22, 0.03, 0x442222);
                },
                onSeg: (seg, i, r, z) => {
                    // Spore pustules erupting along segment.
                    for (let k = 0; k < 4; k++) {
                        const a = this.idRand() * Math.PI * 2;
                        const pus = new THREE.Mesh(new THREE.SphereGeometry(0.06 + this.idRand() * 0.04, 8, 6), this._mat(p.accent, 1.0, 0.4, 0x3a4a10));
                        pus.position.set(Math.cos(a) * r * 0.95, 0.6 + Math.sin(a) * r * 0.6, z + (this.idRand() - 0.5) * 0.18);
                        this.bodyGroup.add(pus); (this._pustules = this._pustules || []).push(pus);
                    }
                }
            });
            if (this._pustules) this._cascadeRules[0].hide.push(...this._pustules);
        }

        // ── Hivemind Termite: pale soldier termite, swollen abdomen, big jaws ─
        _buildHivemindTermite() {
            const p = this.profile;
            const pale = this._skinMat(p.bodyColor, 0.55);
            const amber = this._mat(p.accent, 1.0, 0.4);
            // Hardened darker head capsule.
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), amber); h.scale.set(1.1, 0.85, 1.15); this.head.add(h);
            this._eye(this.head, -0.11, 0.04, 0.16, 0.04, 0x221100); this._eye(this.head, 0.11, 0.04, 0.16, 0.04, 0x221100);
            this._antennae(this.head, amber, p.accent);
            this.head.position.set(0, 0.84, 0.6); this.bodyGroup.add(this.head);
            // Oversized curved soldier mandibles.
            this.mandibles = new THREE.Group();
            for (const mx of [-1, 1]) {
                const m = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12, Math.PI * 0.8), amber);
                m.position.set(mx * 0.08, 0.84, 0.86); m.rotation.set(Math.PI / 2, 0, mx > 0 ? -0.5 : Math.PI + 0.5); this.mandibles.add(m);
            }
            this.bodyGroup.add(this.mandibles);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), pale); this.thorax.position.set(0, 0.82, 0.12); this.thorax.scale.set(1, 0.9, 1.1); this.bodyGroup.add(this.thorax);
            // Swollen pale physogastric abdomen (segmented bulge).
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 14), pale); this.abdomen.position.set(0, 0.82, -0.6); this.abdomen.scale.set(1.05, 1.05, 1.5); this.bodyGroup.add(this.abdomen);
            this._segRings = [];
            for (let i = 0; i < 4; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 6, 16), this._mat(0xcabf9a, 1.0, 0.6)); ring.position.set(0, 0.82, -0.3 - i * 0.24); ring.rotation.x = Math.PI / 2; const sc = 1 - i * 0.12; ring.scale.set(sc, sc, 1); this.bodyGroup.add(ring); this._segRings.push(ring); }
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, extra: this._segRings, legY: 0.7, mat: amber });
        }

        // ── Jungle Stalker: venomous green segmented worm-centipede predator ──
        _buildJungleStalker() {
            const p = this.profile;
            const green = this._skinMat(p.bodyColor, 0.55);
            const venom = this._mat(p.accent, 1.0, 0.3, p.accent);
            this._jsVenom = [venom];
            this._buildWorm({
                segMat: green, count: 8, y: 0.75, headR: 0.3, bodyR: 0.3, spacing: 0.3, taper: 0.5,
                onHead: (head) => {
                    this._eye(head, -0.12, 0.07, 0.16, 0.06, p.accent); this._eye(head, 0.12, 0.07, 0.16, 0.06, p.accent);
                    // Venom fangs jutting forward.
                    this.mandibles = new THREE.Group();
                    for (const mx of [-0.08, 0.08]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.26, 4), venom); f.position.set(mx, -0.04, 0.34); f.rotation.x = 1.5; f.rotation.z = -mx * 3; head.add(f); }
                    const drip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), venom); drip.position.set(0, -0.12, 0.42); drip.scale.y = 1.5; head.add(drip); this._jsDrip = drip;
                },
                onSeg: (seg, i, r, z) => {
                    // Bristly legs + a venom stripe down each segment.
                    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.3, 4), green); leg.position.set(s * (r + 0.06), 0.62, z); leg.rotation.z = s * 1.1; this.bodyGroup.add(leg); (this._jsLegs = this._jsLegs || []).push(leg); }
                    const stripe = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 8, 6), venom); stripe.position.set(0, 0.75 + r * 0.7, z); stripe.scale.set(0.6, 0.4, 1); this.bodyGroup.add(stripe); this._jsVenom.push(stripe.material);
                }
            });
            const extra = (this._jsLegs || []).concat(this.mandibles ? [this.mandibles] : []);
            if (extra.length) this._cascadeRules[0].hide.push(...extra);
        }

        // ── Luminous Locust King: regal glowing locust, crown, long wings ────
        _buildLocustKing() {
            const p = this.profile;
            const body = this._skinMat(p.bodyColor, 0.5);
            const glow = this._mat(p.accent, 1.0, 0.3, p.accent);
            this._lkGlow = [glow];
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), body); this.thorax.position.set(0, 0.95, 0.18); this.thorax.scale.set(1, 1.1, 1.3); this.bodyGroup.add(this.thorax);
            // Long ridged abdomen.
            this.abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.07, 1.0, 10), body); this.abdomen.position.set(0, 0.95, -0.6); this.abdomen.rotation.x = Math.PI / 2; this.bodyGroup.add(this.abdomen);
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), body); h.scale.set(0.9, 1.2, 1.0); this.head.add(h);
            this._eye(this.head, -0.12, 0.06, 0.1, 0.08, p.accent); this._eye(this.head, 0.12, 0.06, 0.1, 0.08, p.accent);
            // Glowing crown-crest of spikes.
            this._crown = [];
            for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.32; const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22 + (2 - Math.abs(i - 2)) * 0.1, 4), glow); spike.position.set(Math.sin(a) * 0.16, 0.22, -0.02); spike.rotation.z = -a; this.head.add(spike); this._crown.push(spike); this._lkGlow.push(spike.material); }
            this._antennae(this.head, body, p.accent);
            this.head.position.set(0, 0.98, 0.52); this.bodyGroup.add(this.head);
            this.mandibles = new THREE.Group();
            for (const mx of [-0.07, 0.07]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 4), body); m.position.set(mx, 0.9, 0.72); m.rotation.x = 1.5; this.mandibles.add(m); }
            this.bodyGroup.add(this.mandibles);
            // Long folded membranous wings.
            this.wings = new THREE.Group();
            const wingMat = this._mat(p.accent, 0.32, 0.2, p.accent); this._lkGlow.push(wingMat);
            for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), wingMat); w.scale.set(0.45, 1, 1); w.position.set(sx * 0.16, 1.05, -0.5); w.rotation.x = -Math.PI / 2 + 0.2; w.rotation.z = sx * 0.15; w._sx = sx; this.wings.add(w); }
            this.bodyGroup.add(this.wings);
            // Big sprung jumping hind legs.
            this._lkHind = [];
            for (const side of [-1, 1]) {
                const g = new THREE.Group();
                const thighGeo = THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.06, 0.3, 4, 8) : new THREE.CylinderGeometry(0.12, 0.05, 0.4, 6);
                const thigh = new THREE.Mesh(thighGeo, body); thigh.position.set(side * 0.16, 0.05, 0); thigh.rotation.z = side * 0.5; g.add(thigh);
                const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.015, 0.5, 5), body); shin.position.set(side * 0.32, -0.22, -0.05); shin.rotation.z = -side * 0.4; g.add(shin);
                g.position.set(0, 0.82, -0.35); g._side = side; this.bodyGroup.add(g); this._lkHind.push(g);
            }
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, extra: [this.wings].concat(this._crown).concat(this._lkHind), legY: 0.78, legZs: [0.36, 0.16], mat: body });
        }

        // ── Magma Centipede: black rock segments, glowing molten cracks ──────
        _buildMagmaCentipede() {
            const p = this.profile;
            const rock = this._mat(p.bodyColor, 1.0, 0.85);
            const molten = this._mat(p.accent, 1.0, 0.3, p.accent);
            this._mcGlow = [molten];
            this._buildWorm({
                segMat: rock, count: 9, y: 0.78, headR: 0.28, bodyR: 0.32, spacing: 0.28, taper: 0.45,
                onHead: (head) => {
                    this._eye(head, -0.1, 0.05, 0.16, 0.05, p.accent); this._eye(head, 0.1, 0.05, 0.16, 0.05, p.accent);
                    this.mandibles = new THREE.Group();
                    for (const mx of [-0.08, 0.08]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 4), molten); m.position.set(mx, 0, 0.32); m.rotation.x = 1.5; m.rotation.z = -mx * 3; head.add(m); }
                },
                onSeg: (seg, i, r, z) => {
                    // Molten crack ring glowing in the gap between plates.
                    const crack = new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, 0.035, 6, 14), this._mat(p.accent, 1.0, 0.3, p.accent)); crack.position.set(0, 0.78, z + 0.14); crack.rotation.x = Math.PI / 2; this.bodyGroup.add(crack); this._mcGlow.push(crack.material); (this._mcCracks = this._mcCracks || []).push(crack);
                    // Stubby rock legs.
                    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.01, 0.26, 4), rock); leg.position.set(s * (r + 0.04), 0.64, z); leg.rotation.z = s * 1.1; this.bodyGroup.add(leg); (this._mcLegs = this._mcLegs || []).push(leg); }
                }
            });
            const extra = (this._mcLegs || []).concat(this._mcCracks || []).concat(this.mandibles ? [this.mandibles] : []);
            if (extra.length) this._cascadeRules[0].hide.push(...extra);
        }

        // ── Mothshade Stalker: furred dusky moth, big eye-pattern wings ──────
        _buildMothshadeStalker() {
            const p = this.profile;
            const fuzz = this._skinMat(p.bodyColor, 0.95);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), fuzz); this.thorax.position.set(0, 0.95, 0.2); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.08, 0.7, 10), fuzz); this.abdomen.position.set(0, 0.95, -0.5); this.abdomen.rotation.x = Math.PI / 2; this.bodyGroup.add(this.abdomen);
            // Fur tufts on the abdomen.
            for (let i = 0; i < 3; i++) { const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.13 - i * 0.02, 8, 6), fuzz); tuft.position.set(0, 0.95, -0.3 - i * 0.22); this.bodyGroup.add(tuft); }
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), fuzz); this.head.add(h);
            this._eye(this.head, -0.1, 0.02, 0.12, 0.07, p.accent); this._eye(this.head, 0.1, 0.02, 0.12, 0.07, p.accent);
            // Big feathery plumose antennae.
            for (const ax of [-1, 1]) {
                const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.4, 4), fuzz); stem.position.set(ax * 0.1, 0.22, 0.05); stem.rotation.z = ax * 0.5; stem.rotation.x = -0.4; this.head.add(stem);
                for (let k = 0; k < 5; k++) { const barb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.02), fuzz); barb.position.set(ax * (0.12 + k * 0.05), 0.18 + k * 0.07, 0.07); barb.rotation.z = ax * 0.5; this.head.add(barb); }
            }
            this.head.position.set(0, 0.98, 0.5); this.bodyGroup.add(this.head);
            // Large eye-pattern wings (mandibles slot stays a small proboscis coil).
            this.mandibles = new THREE.Group();
            const coil = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), this._mat(0x2a2030, 1.0, 0.5)); coil.position.set(0, 0.88, 0.66); this.mandibles.add(coil); this.bodyGroup.add(this.mandibles);
            this.wings = new THREE.Group();
            const wingMat = this._mat(p.bodyColor, 0.85, 0.7); const eyeMat = this._mat(p.accent, 1.0, 0.4, p.accent);
            this._mothEyes = [];
            for (const sx of [-1, 1]) {
                const fore = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), wingMat); fore.scale.set(1, 1, 0.8); fore.position.set(sx * 0.5, 1.0, 0.15); fore.rotation.x = -Math.PI / 2; fore.rotation.z = sx * 0.2; fore._sx = sx; this.wings.add(fore);
                const hind = new THREE.Mesh(new THREE.CircleGeometry(0.4, 14), wingMat); hind.position.set(sx * 0.45, 1.0, -0.35); hind.rotation.x = -Math.PI / 2; hind.rotation.z = sx * 0.15; hind._sx = sx; this.wings.add(hind);
                // Hypnotic eye spots.
                const spot = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), eyeMat); spot.position.set(sx * 0.52, 1.01, 0.1); spot.rotation.x = -Math.PI / 2; this.wings.add(spot); this._mothEyes.push(spot.material);
                const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), this._mat(0x100810, 1.0, 0.4)); pupil.position.set(sx * 0.52, 1.02, 0.1); pupil.rotation.x = -Math.PI / 2; this.wings.add(pupil);
            }
            this.bodyGroup.add(this.wings);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, extra: [this.wings], legY: 0.78, legZs: [0.3, 0.1], mat: fuzz });
        }

        // ── Swamp Scorpion: muddy green, two pincers, 8 legs, arched stinger ─
        _buildSwampScorpion() {
            const p = this.profile;
            const shell = this._skinMat(p.bodyColor, 0.55);
            const venom = this._mat(p.accent, 1.0, 0.3, p.accent);
            // Cephalothorax (front body plate).
            this.cephalo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), shell); this.cephalo.position.set(0, 0.55, 0.35); this.cephalo.scale.set(1.2, 0.6, 1.2); this.bodyGroup.add(this.cephalo);
            // Head with eyes set on top of the cephalothorax.
            this.head = new THREE.Group();
            this._eye(this.head, -0.08, 0, 0.0, 0.05, p.accent); this._eye(this.head, 0.08, 0, 0.0, 0.05, p.accent);
            this._eye(this.head, 0, 0.04, 0.1, 0.035, p.accent);
            this.head.position.set(0, 0.66, 0.45); this.bodyGroup.add(this.head);
            // Segmented mesosoma abdomen.
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), shell); this.abdomen.position.set(0, 0.55, -0.25); this.abdomen.scale.set(1.1, 0.7, 1.3); this.bodyGroup.add(this.abdomen);
            this._scorpRings = [];
            for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.28 - i * 0.03, 0.03, 6, 14), this._mat(0x3a4a1f, 1.0, 0.6)); r.position.set(0, 0.55, -0.1 - i * 0.16); r.rotation.x = Math.PI / 2; this.bodyGroup.add(r); this._scorpRings.push(r); }
            // Arched tail (metasoma) curling up and over, with bulb + stinger.
            this.tail = new THREE.Group();
            const segCount = 5; let px = 0, py = 0, pz = -0.55; const tailMeshes = [];
            for (let i = 0; i < segCount; i++) {
                const seg = new THREE.Mesh(new THREE.SphereGeometry(0.1 - i * 0.008, 10, 8), shell);
                const ang = 0.4 + i * 0.45; px = 0; py = 0.55 + i * 0.18; pz = -0.55 + i * 0.04 - Math.sin(ang) * 0.02;
                seg.position.set(px, py, pz + i * 0.02); this.tail.add(seg); tailMeshes.push(seg);
            }
            // Venom bulb + stinger at the tip.
            this.stinger = new THREE.Group();
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), venom); bulb.position.set(0, 1.4, -0.32); bulb.scale.set(1, 1.2, 1); this.stinger.add(bulb);
            const barb = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 5), venom); barb.position.set(0, 1.32, -0.18); barb.rotation.x = -1.0; this.stinger.add(barb);
            this.tail.add(this.stinger); this.bodyGroup.add(this.tail);
            // Two big pincer arms (pedipalps).
            const makePincer = (side) => {
                const g = new THREE.Group();
                const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 6), shell); upper.position.set(side * 0.1, 0, 0.12); upper.rotation.z = side * 0.6; upper.rotation.x = -0.6; g.add(upper);
                const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.28, 6), shell); fore.position.set(side * 0.26, 0.05, 0.34); fore.rotation.x = -1.0; g.add(fore);
                const claw = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), shell); claw.position.set(side * 0.3, 0.1, 0.5); claw.scale.set(1, 0.7, 1.3); g.add(claw);
                for (const f of [-1, 1]) { const finger = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.24, 5), shell); finger.position.set(side * 0.3 + f * 0.05, 0.1, 0.66); finger.rotation.x = -1.6; g.add(finger); }
                g.position.set(side * 0.28, 0.6, 0.55); g._side = side; this.bodyGroup.add(g); return g;
            };
            this.pincerL = makePincer(-1); this.pincerR = makePincer(1);
            // Eight walking legs.
            this._scorpLegs = [];
            const legKeysL = ['LEFT_LEG', 'MID_LEFT_LEG', 'MID_REAR_LEFT_LEG', 'REAR_LEFT_LEG'];
            const legKeysR = ['RIGHT_LEG', 'MID_RIGHT_LEG', 'MID_REAR_RIGHT_LEG', 'REAR_RIGHT_LEG'];
            const legZs = [0.4, 0.18, -0.02, -0.22];
            const scorpLeg = (side, z) => {
                const g = new THREE.Group();
                const u = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.36, 4), shell); u.position.set(side * 0.18, -0.04, 0); u.rotation.z = side * 1.1; g.add(u);
                const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.008, 0.34, 4), shell); l.position.set(side * 0.38, -0.28, 0); l.rotation.z = side * 0.25; g.add(l);
                g.position.set(0, 0.5, z); g._side = side; this.bodyGroup.add(g); this._legs.push(g); this._scorpLegs.push(g); return g;
            };
            const legMeshesL = legZs.map(z => scorpLeg(-1, z));
            const legMeshesR = legZs.map(z => scorpLeg(1, z));
            // Rig mapping.
            this._partMeshMap = {
                HEAD: this.head, CEPHALOTHORAX: this.cephalo, ABDOMEN: this.abdomen,
                TAIL: this.tail, STINGER: this.stinger, PINCER_LEFT: this.pincerL, PINCER_RIGHT: this.pincerR
            };
            legKeysL.forEach((k, i) => { this._partMeshMap[k] = legMeshesL[i]; });
            legKeysR.forEach((k, i) => { this._partMeshMap[k] = legMeshesR[i]; });
            const allMeshes = [this.head, this.cephalo, this.abdomen, this.tail, this.stinger, this.pincerL, this.pincerR]
                .concat(this._scorpRings).concat(legMeshesL).concat(legMeshesR);
            this._cascadeRules = [
                { gone: ['CEPHALOTHORAX'], hide: allMeshes },
                { gone: ['ABDOMEN'], hide: [this.abdomen, this.tail, this.stinger].concat(this._scorpRings) },
                { gone: ['HEAD'], hide: [this.head] },
                { gone: ['TAIL'], hide: [this.tail, this.stinger] },
                { gone: ['STINGER'], hide: [this.stinger] },
                { gone: ['PINCER_LEFT'], hide: [this.pincerL] },
                { gone: ['PINCER_RIGHT'], hide: [this.pincerR] },
                ...legKeysL.map((k, i) => ({ gone: [k], hide: [legMeshesL[i]] })),
                ...legKeysR.map((k, i) => ({ gone: [k], hide: [legMeshesR[i]] }))
            ];
        }

        // ── Toxic Ghost: sickly green segmented parasite worm, egg-sacs, venom drip
        _buildToxicGhost() {
            const p = this.profile;
            const slime = this._skinMat(p.bodyColor, 0.35);
            const venom = this._mat(p.accent, 1.0, 0.25, p.accent);
            this._tgVenom = [venom];
            this._buildWorm({
                segMat: slime, count: 7, y: 0.7, headR: 0.3, bodyR: 0.34, spacing: 0.3, taper: 0.4,
                onHead: (head) => {
                    // Lamprey rasp-maw + tiny vestigial eyes.
                    const maw = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.08, 0.16, 12), this._mat(0x2a4a14, 1.0, 0.5)); maw.position.set(0, -0.02, 0.28); maw.rotation.x = Math.PI / 2; head.add(maw);
                    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 4), this._mat(0xe8ffb0, 1.0, 0.4)); tooth.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.13, 0.32); tooth.rotation.x = 1.0; tooth.rotation.z = -a; head.add(tooth); }
                    this._eye(head, -0.1, 0.1, 0.18, 0.03, p.accent); this._eye(head, 0.1, 0.1, 0.18, 0.03, p.accent);
                    // Venom drip from the maw.
                    const drip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), venom); drip.position.set(0, -0.14, 0.34); drip.scale.y = 1.5; head.add(drip); this._tgDrip = drip;
                },
                onSeg: (seg, i, r, z) => {
                    // Translucent egg-sacs bulging from alternate segments.
                    if (i % 2 === 1) {
                        for (const s of [-1, 1]) { const sac = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 10, 8), this._mat(0xd8ff8a, 0.6, 0.2, 0x3a5a10)); sac.position.set(s * r * 0.9, 0.7, z); this.bodyGroup.add(sac); (this._tgEggs = this._tgEggs || []).push(sac); }
                    }
                    // Venom sheen blister on top.
                    const blob = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 8, 6), venom); blob.position.set(0, 0.7 + r * 0.7, z); this.bodyGroup.add(blob); this._tgVenom.push(blob.material);
                }
            });
            const extra = (this._tgEggs || []);
            if (extra.length) this._cascadeRules[0].hide.push(...extra);
        }

        // ── Venomous Dragonfly: long thin abdomen, four iridescent wings, fangs
        _buildVenomousDragonfly() {
            const p = this.profile;
            const body = this._skinMat(p.bodyColor, 0.4);
            const venom = this._mat(p.accent, 1.0, 0.3, p.accent);
            this._vdVenom = [venom];
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), body); this.thorax.position.set(0, 1.05, 0.12); this.thorax.scale.set(1, 1, 1.2); this.bodyGroup.add(this.thorax);
            // Very long thin segmented abdomen.
            this.abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.03, 1.6, 10), body); this.abdomen.position.set(0, 1.05, -0.9); this.abdomen.rotation.x = Math.PI / 2; this.bodyGroup.add(this.abdomen);
            for (let i = 0; i < 5; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09 - i * 0.012, 0.018, 6, 12), venom); ring.position.set(0, 1.05, -0.35 - i * 0.3); ring.rotation.x = Math.PI / 2; this.bodyGroup.add(ring); this._vdVenom.push(ring.material); }
            // Venom barb at the tail tip.
            this.tailBarb = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 5), venom); this.tailBarb.position.set(0, 1.05, -1.78); this.tailBarb.rotation.x = -Math.PI / 2; this.bodyGroup.add(this.tailBarb); this._vdVenom.push(this.tailBarb.material);
            // Big compound eyes head.
            this.head = new THREE.Group();
            const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(0x2a3a14, 1.0, 0.2, p.accent)); eyeL.position.set(-0.12, 0, 0.05); this.head.add(eyeL); this._vdVenom.push(eyeL.material);
            const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(0x2a3a14, 1.0, 0.2, p.accent)); eyeR.position.set(0.12, 0, 0.05); this.head.add(eyeR); this._vdVenom.push(eyeR.material);
            this.head.position.set(0, 1.05, 0.58); this.bodyGroup.add(this.head);
            // Venom fangs / mandibles.
            this.mandibles = new THREE.Group();
            for (const mx of [-0.07, 0.07]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 4), venom); m.position.set(mx, 0.98, 0.78); m.rotation.x = 1.5; m.rotation.z = -mx * 3; this.mandibles.add(m); }
            this.bodyGroup.add(this.mandibles);
            // Four long iridescent wings.
            this.wings = new THREE.Group();
            const wingMat = this._mat(p.accent, 0.32, 0.15, p.accent); this._vdVenom.push(wingMat);
            for (const [sx, sz] of [[-1, 0.22], [1, 0.22], [-1, -0.08], [1, -0.08]]) {
                const w = new THREE.Mesh(new THREE.CircleGeometry(0.55, 14), wingMat); w.scale.set(1.4, 0.28, 1);
                w.position.set(sx * 0.5, 1.14, sz); w.rotation.x = -Math.PI / 2; w.rotation.z = sx * 0.08; w._sx = sx; this.wings.add(w);
                // Wing vein ribs.
                for (let v = -1; v <= 1; v++) { const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.78, 4), this._mat(0x244411, 0.6, 0.4)); vein.position.set(sx * 0.5, 1.142, sz + v * 0.07); vein.rotation.z = Math.PI / 2; this.wings.add(vein); }
            }
            this.bodyGroup.add(this.wings);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, extra: [this.wings, this.tailBarb], legY: 0.98, legZs: [0.25, 0.08], mat: body });
        }

        // ── Chromatic Tick: round neon iridescent shell, contagion-ooze segments
        _buildChromaticTick() {
            const p = this.profile;
            const shell = this._mat(0x1c1c26, 1.0, 0.2);
            const ooze = this._mat(p.accent, 0.9, 0.2, p.accent);
            this._ctShell = []; this._ctOoze = [ooze];
            this._buildWorm({
                segMat: shell, count: 5, y: 0.7, headR: 0.22, bodyR: 0.34, spacing: 0.26, taper: 0.15,
                onHead: (head) => {
                    this._eye(head, -0.08, 0.04, 0.12, 0.04, p.accent); this._eye(head, 0.08, 0.04, 0.12, 0.04, p.accent);
                    // Tiny piercing rostrum.
                    const rost = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 5), ooze); rost.position.set(0, -0.04, 0.24); rost.rotation.x = Math.PI / 2; head.add(rost); this._ctOoze.push(rost.material);
                },
                onSeg: (seg, i, r, z) => {
                    // Iridescent neon hex-plates over the round shell.
                    for (let k = 0; k < 5; k++) {
                        const a = (k / 5) * Math.PI * 2 + i * 0.4;
                        const plate = new THREE.Mesh(new THREE.CircleGeometry(r * 0.42, 6), this._mat(0xffffff, 1.0, 0.1, 0x222222));
                        const px = Math.cos(a) * r * 0.85, py = 0.7 + Math.sin(a) * r * 0.6;
                        plate.position.set(px, py, z); plate.lookAt(px * 2, py * 2 - 0.7, z); this.bodyGroup.add(plate); this._ctShell.push(plate.material);
                    }
                    // Contagion ooze dripping below.
                    const drop = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 8, 6), ooze); drop.position.set(0, 0.7 - r * 0.8, z); drop.scale.y = 1.4; this.bodyGroup.add(drop); this._ctOoze.push(drop.material); (this._ctDrops = this._ctDrops || []).push(drop);
                }
            });
            const extra = (this._ctDrops || []);
            if (extra.length) this._cascadeRules[0].hide.push(...extra);
        }

        // ── Mind Flayer Moth: psychedelic eye-pattern wings, tentacle face ──────
        _buildMindFlayerMoth() {
            const p = this.profile;
            const fuzz = this._skinMat(p.bodyColor, 0.95);
            const psy = this._mat(p.accent, 1.0, 0.3, p.accent);
            this._mfPsy = [psy];
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), fuzz); this.thorax.position.set(0, 0.95, 0.2); this.bodyGroup.add(this.thorax);
            this.abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.09, 0.75, 10), fuzz); this.abdomen.position.set(0, 0.95, -0.55); this.abdomen.rotation.x = Math.PI / 2; this.bodyGroup.add(this.abdomen);
            for (let i = 0; i < 3; i++) { const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.15 - i * 0.025, 8, 6), fuzz); tuft.position.set(0, 0.95, -0.34 - i * 0.24); this.bodyGroup.add(tuft); }
            // Illithid head: pale dome with a writhing tentacle-mouth (no real eyes).
            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), this._mat(0x7a5aa0, 1.0, 0.6)); skull.scale.set(1, 1.1, 0.95); this.head.add(skull);
            this._eye(this.head, -0.1, 0.06, 0.13, 0.04, p.accent); this._eye(this.head, 0.1, 0.06, 0.13, 0.04, p.accent);
            this._mfTents = [];
            for (let i = 0; i < 4; i++) {
                const a = (i - 1.5) * 0.18;
                const t1 = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.3, 5), this._mat(0x6a4a90, 1.0, 0.55)); t1.position.set(Math.sin(a) * 0.1, -0.12, 0.16); t1.rotation.x = 1.4; t1.rotation.z = a * 2; this.head.add(t1); this._mfTents.push(t1);
            }
            this.head.position.set(0, 0.98, 0.5); this.bodyGroup.add(this.head);
            // Mandibles slot = coiled proboscis under the tentacles.
            this.mandibles = new THREE.Group();
            const coil = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 6, 12), this._mat(0x3a2050, 1.0, 0.5)); coil.position.set(0, 0.86, 0.66); this.mandibles.add(coil); this.bodyGroup.add(this.mandibles);
            // Huge psychedelic eye-pattern wings.
            this.wings = new THREE.Group();
            const wingMat = this._mat(p.bodyColor, 0.9, 0.7);
            for (const sx of [-1, 1]) {
                const fore = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16), wingMat); fore.scale.set(1, 1, 0.85); fore.position.set(sx * 0.6, 1.0, 0.18); fore.rotation.x = -Math.PI / 2; fore.rotation.z = sx * 0.2; fore._sx = sx; this.wings.add(fore);
                const hind = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), wingMat); hind.position.set(sx * 0.55, 1.0, -0.42); hind.rotation.x = -Math.PI / 2; hind.rotation.z = sx * 0.12; hind._sx = sx; this.wings.add(hind);
                // Concentric psychic-eye rings.
                for (let r = 0; r < 3; r++) {
                    const ring = new THREE.Mesh(new THREE.RingGeometry(0.06 + r * 0.07, 0.1 + r * 0.07, 16), psy);
                    ring.position.set(sx * 0.62, 1.01 + r * 0.001, 0.12); ring.rotation.x = -Math.PI / 2; this.wings.add(ring); this._mfPsy.push(ring.material);
                }
                const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), this._mat(0x100018, 1.0, 0.3)); pupil.position.set(sx * 0.62, 1.014, 0.12); pupil.rotation.x = -Math.PI / 2; this.wings.add(pupil);
            }
            this.bodyGroup.add(this.wings);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, extra: [this.wings].concat(this._mfTents), legY: 0.78, legZs: [0.3, 0.1], mat: fuzz });
        }

        // Shared glistening leech builder (sucker-mouth segmented slug).
        _buildLeech(opt) {
            const slime = this._skinMat(opt.bodyColor, 0.2);
            const ringMat = this._mat(opt.ringColor, 1.0, 0.4);
            this._leechRings = [];
            this._buildWorm({
                segMat: slime, count: 8, y: 0.55, headR: 0.26, bodyR: 0.3, spacing: 0.28, taper: 0.25,
                onHead: (head) => {
                    // Concentric ringed sucker mouth at the front.
                    this._suckerMouth = new THREE.Group();
                    for (let r = 0; r < (opt.ringed ? 3 : 1); r++) {
                        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08 + r * 0.06, 0.025, 8, 16), this._mat(opt.maw, 1.0, 0.35));
                        ring.position.set(0, -0.02, 0.24); this._suckerMouth.add(ring); this._leechRings.push(ring.material);
                    }
                    const pit = new THREE.Mesh(new THREE.CircleGeometry(0.09, 14), this._mat(opt.maw, 1.0, 0.5)); pit.position.set(0, -0.02, 0.25); this._suckerMouth.add(pit);
                    head.add(this._suckerMouth);
                    this._eye(head, -0.09, 0.08, 0.14, 0.025, opt.accent); this._eye(head, 0.09, 0.08, 0.14, 0.025, opt.accent);
                },
                onSeg: (seg, i, r, z) => {
                    // Annular body ring between each segment (leech annulations).
                    const ann = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.022, 6, 14), ringMat); ann.position.set(0, 0.55, z + (opt.spacing || 0.28) * 0.5); ann.rotation.x = Math.PI / 2; this.bodyGroup.add(ann); (this._leechAnn = this._leechAnn || []).push(ann);
                    // Glistening highlight blob.
                    const sheen = new THREE.Mesh(new THREE.SphereGeometry(r * 0.18, 6, 5), this._mat(0xffffff, 0.4, 0.05, 0x444444)); sheen.position.set(r * 0.4, 0.55 + r * 0.6, z); this.bodyGroup.add(sheen);
                }
            });
            const extra = (this._leechAnn || []).concat(this._suckerMouth ? [this._suckerMouth] : []);
            if (extra.length) this._cascadeRules[0].hide.push(...extra);
        }

        // ── Emotional Leech: glistening pink slug, big sucker mouth ──────────────
        _buildEmotionalLeech() {
            const p = this.profile;
            this._buildLeech({ bodyColor: p.bodyColor, ringColor: 0xc24a70, maw: 0x8a2a48, accent: p.accent, ringed: false });
        }

        // ── Memory Leech: grey-blue slug, ringed sucker mouth ───────────────────
        _buildMemoryLeech() {
            const p = this.profile;
            this._buildLeech({ bodyColor: p.bodyColor, ringColor: 0x47596e, maw: 0x2a3a4a, accent: p.accent, ringed: true });
        }

        // ── Thought Parasite: translucent flickering tick-worm, phasing in/out ──
        _buildThoughtParasite() {
            const p = this.profile;
            // Ghostly translucent worm body.
            const ghost = this._mat(p.bodyColor, 0.5, 0.15, p.accent);
            this._tpGhost = [ghost];
            this._buildWorm({
                segMat: ghost, count: 6, y: 0.7, headR: 0.26, bodyR: 0.3, spacing: 0.28, taper: 0.35,
                onHead: (head) => {
                    // Bulging psychic eyes + a barbed proboscis.
                    this._eye(head, -0.11, 0.06, 0.12, 0.07, p.accent); this._eye(head, 0.11, 0.06, 0.12, 0.07, p.accent);
                    const ros = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.3, 5), this._mat(p.accent, 0.7, 0.1, p.accent)); ros.position.set(0, -0.06, 0.3); ros.rotation.x = Math.PI / 2; head.add(ros); this._tpGhost.push(ros.material);
                    // Wiggling sensory cilia probing forward.
                    for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.4; const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.002, 0.24, 4), ghost); c.position.set(Math.sin(a) * 0.1, 0.04, 0.2); c.rotation.x = 1.2; c.rotation.z = a; head.add(c); }
                },
                onSeg: (seg, i, r, z) => {
                    // Faint phasing aura sphere over each segment.
                    const aura = new THREE.Mesh(new THREE.SphereGeometry(r * 1.4, 10, 8), this._mat(p.accent, 0.12, 0.05, p.accent));
                    aura.position.set(0, 0.7, z); this.bodyGroup.add(aura); this._tpGhost.push(aura.material); (this._tpAura = this._tpAura || []).push(aura);
                    // Tick-worm bristle barbs.
                    for (const s of [-1, 1]) { const barb = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.14, 4), ghost); barb.position.set(s * r * 0.9, 0.7, z); barb.rotation.z = s * 1.2; this.bodyGroup.add(barb); }
                }
            });
            if (this._tpAura) this._cascadeRules[0].hide.push(...this._tpAura);
        }

        // ── Emberback Hellscorpion: black carapace, magma cracks, fiery stinger ─
        _buildEmberbackHellscorpion() {
            const p = this.profile;
            const obsidian = this._mat(p.bodyColor, 1.0, 0.85);
            const magma = this._mat(p.accent, 1.0, 0.3, p.accent);
            this._ehGlow = [magma];
            const crackOn = (mesh, n, rad) => {
                for (let i = 0; i < n; i++) {
                    const a = this.idRand() * Math.PI * 2;
                    const cr = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.18 + this.idRand() * 0.12), this._mat(p.accent, 1.0, 0.3, p.accent));
                    cr.position.set(Math.cos(a) * rad * 0.7, rad * 0.6, Math.sin(a) * rad * 0.7);
                    cr.rotation.set(this.idRand(), a, this.idRand()); mesh.add(cr); this._ehGlow.push(cr.material);
                }
            };
            // Cephalothorax front plate with glowing cracks.
            this.cephalo = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), obsidian); this.cephalo.position.set(0, 0.6, 0.35); this.cephalo.scale.set(1.25, 0.6, 1.2); this.bodyGroup.add(this.cephalo); crackOn(this.cephalo, 5, 0.36);
            // Head with menacing red eyes.
            this.head = new THREE.Group();
            this._eye(this.head, -0.09, 0, 0.02, 0.05, p.accent); this._eye(this.head, 0.09, 0, 0.02, 0.05, p.accent);
            this._eye(this.head, 0, 0.05, 0.1, 0.04, p.accent);
            this.head.position.set(0, 0.7, 0.5); this.bodyGroup.add(this.head);
            // Segmented abdomen with molten seams.
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), obsidian); this.abdomen.position.set(0, 0.6, -0.28); this.abdomen.scale.set(1.1, 0.7, 1.35); this.bodyGroup.add(this.abdomen); crackOn(this.abdomen, 4, 0.32);
            this._ehSeams = [];
            for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.3 - i * 0.03, 0.028, 6, 16), magma); s.position.set(0, 0.6, -0.12 - i * 0.16); s.rotation.x = Math.PI / 2; this.bodyGroup.add(s); this._ehSeams.push(s); this._ehGlow.push(s.material); }
            // Arched metasoma tail curling up to a fiery stinger.
            this.tail = new THREE.Group();
            for (let i = 0; i < 5; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(0.1 - i * 0.008, 10, 8), obsidian); seg.position.set(0, 0.6 + i * 0.2, -0.55 + i * 0.05); this.tail.add(seg); }
            this.stinger = new THREE.Group();
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), magma); bulb.position.set(0, 1.55, -0.3); bulb.scale.set(1, 1.3, 1); this.stinger.add(bulb); this._ehGlow.push(bulb.material);
            const barb = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 5), this._mat(p.accent, 1.0, 0.2, 0xffaa33)); barb.position.set(0, 1.46, -0.14); barb.rotation.x = -1.0; this.stinger.add(barb); this._ehGlow.push(barb.material);
            // Ember sparks rising from the stinger.
            for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), this._mat(0xffcc44, 0.8, 0.2, 0xffcc44)); sp.position.set((this.idRand() - 0.5) * 0.1, 1.6 + i * 0.06, -0.3); this.stinger.add(sp); this._ehGlow.push(sp.material); }
            this.tail.add(this.stinger); this.bodyGroup.add(this.tail);
            // Two big pincer claws with magma seams.
            const makePincer = (side) => {
                const g = new THREE.Group();
                const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 6), obsidian); upper.position.set(side * 0.1, 0, 0.12); upper.rotation.z = side * 0.6; upper.rotation.x = -0.6; g.add(upper);
                const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.3, 6), obsidian); fore.position.set(side * 0.28, 0.05, 0.36); fore.rotation.x = -1.0; g.add(fore);
                const claw = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), obsidian); claw.position.set(side * 0.32, 0.1, 0.54); claw.scale.set(1, 0.7, 1.4); g.add(claw); crackOn(claw, 2, 0.13);
                for (const f of [-1, 1]) { const finger = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.28, 5), obsidian); finger.position.set(side * 0.32 + f * 0.06, 0.1, 0.72); finger.rotation.x = -1.6; g.add(finger); }
                g.position.set(side * 0.3, 0.65, 0.58); g._side = side; this.bodyGroup.add(g); return g;
            };
            this.pincerL = makePincer(-1); this.pincerR = makePincer(1);
            // Eight legs glowing faintly at the joints.
            const legKeysL = ['LEFT_LEG', 'MID_LEFT_LEG', 'MID_REAR_LEFT_LEG', 'REAR_LEFT_LEG'];
            const legKeysR = ['RIGHT_LEG', 'MID_RIGHT_LEG', 'MID_REAR_RIGHT_LEG', 'REAR_RIGHT_LEG'];
            const legZs = [0.42, 0.2, -0.02, -0.24];
            const ehLeg = (side, z) => {
                const g = new THREE.Group();
                const u = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.016, 0.38, 4), obsidian); u.position.set(side * 0.18, -0.04, 0); u.rotation.z = side * 1.1; g.add(u);
                const joint = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), magma); joint.position.set(side * 0.36, -0.24, 0); g.add(joint); this._ehGlow.push(joint.material);
                const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.008, 0.34, 4), obsidian); l.position.set(side * 0.4, -0.42, 0); l.rotation.z = side * 0.25; g.add(l);
                g.position.set(0, 0.54, z); g._side = side; this.bodyGroup.add(g); this._legs.push(g); return g;
            };
            const legMeshesL = legZs.map(z => ehLeg(-1, z));
            const legMeshesR = legZs.map(z => ehLeg(1, z));
            this._partMeshMap = {
                HEAD: this.head, CEPHALOTHORAX: this.cephalo, ABDOMEN: this.abdomen,
                TAIL: this.tail, STINGER: this.stinger, PINCER_LEFT: this.pincerL, PINCER_RIGHT: this.pincerR
            };
            legKeysL.forEach((k, i) => { this._partMeshMap[k] = legMeshesL[i]; });
            legKeysR.forEach((k, i) => { this._partMeshMap[k] = legMeshesR[i]; });
            const allMeshes = [this.head, this.cephalo, this.abdomen, this.tail, this.stinger, this.pincerL, this.pincerR]
                .concat(this._ehSeams).concat(legMeshesL).concat(legMeshesR);
            this._cascadeRules = [
                { gone: ['CEPHALOTHORAX'], hide: allMeshes },
                { gone: ['ABDOMEN'], hide: [this.abdomen, this.tail, this.stinger].concat(this._ehSeams) },
                { gone: ['HEAD'], hide: [this.head] },
                { gone: ['TAIL'], hide: [this.tail, this.stinger] },
                { gone: ['STINGER'], hide: [this.stinger] },
                { gone: ['PINCER_LEFT'], hide: [this.pincerL] },
                { gone: ['PINCER_RIGHT'], hide: [this.pincerR] },
                ...legKeysL.map((k, i) => ({ gone: [k], hide: [legMeshesL[i]] })),
                ...legKeysR.map((k, i) => ({ gone: [k], hide: [legMeshesR[i]] }))
            ];
        }

        // ── Gravity Worm: dark segmented serpent warping space, event-horizon glow
        _buildGravityWorm() {
            const p = this.profile;
            const voidMat = this._mat(p.bodyColor, 1.0, 0.3, 0x100820);
            this._gwRings = [];
            this._buildWorm({
                segMat: voidMat, count: 9, y: 0.75, headR: 0.32, bodyR: 0.36, spacing: 0.34, taper: 0.5,
                onHead: (head) => {
                    // Eyeless head: a collapsing dark maw ringed by an accretion disc.
                    const maw = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.04, 0.22, 14), this._mat(0x000000, 1.0, 0.4)); maw.position.set(0, 0, 0.3); maw.rotation.x = Math.PI / 2; head.add(maw);
                    const disc = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.4, 24), this._mat(p.accent, 0.55, 0.1, p.accent)); disc.position.set(0, 0, 0.3); disc.rotation.z = 0.3; head.add(disc); this._gwRings.push(disc.material); this._gwDisc = disc;
                    // A pair of faint singularity glints.
                    this._eye(head, -0.1, 0.08, 0.14, 0.03, p.accent); this._eye(head, 0.1, 0.08, 0.14, 0.03, p.accent);
                },
                onSeg: (seg, i, r, z) => {
                    // Concentric event-horizon halo warping around each segment.
                    const halo = new THREE.Mesh(new THREE.TorusGeometry(r * 1.5, 0.02, 8, 20), this._mat(p.accent, 0.4, 0.1, p.accent));
                    halo.position.set(0, 0.75, z); halo.rotation.x = Math.PI / 2 + Math.sin(i) * 0.3; this.bodyGroup.add(halo); this._gwRings.push(halo.material); (this._gwHalos = this._gwHalos || []).push(halo);
                    // Lensing shimmer shell pulled toward the body.
                    const lens = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 12, 10), this._mat(0x3a2a6a, 0.16, 0.05, p.accent)); lens.position.set(0, 0.75, z); this.bodyGroup.add(lens); this._gwRings.push(lens.material); (this._gwLens = this._gwLens || []).push(lens);
                }
            });
            const extra = (this._gwHalos || []).concat(this._gwLens || []);
            if (extra.length) this._cascadeRules[0].hide.push(...extra);
        }

        // ── Temporal Hornet: golden striped hornet, big stinger, time-warp wings ─
        _buildTemporalHornet() {
            const p = this.profile;
            const gold = this._skinMat(p.bodyColor, 0.4);
            const black = this._mat(0x141008, 1.0, 0.7);
            this.thorax = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), gold); this.thorax.position.set(0, 0.98, 0.2); this.thorax.scale.set(1, 0.95, 1.1); this.bodyGroup.add(this.thorax);
            // Striped tapering abdomen.
            this.abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 14), gold); this.abdomen.position.set(0, 0.98, -0.4); this.abdomen.scale.set(1, 1, 1.7); this.bodyGroup.add(this.abdomen);
            for (let i = 0; i < 3; i++) { const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.33 - i * 0.04, 0.05, 8, 16), black); stripe.position.set(0, 0.98, -0.3 - i * 0.28); stripe.rotation.x = Math.PI / 2; const sc = 1 - i * 0.1; stripe.scale.set(sc, sc, 1); this.bodyGroup.add(stripe); }
            // Big stinger at the tail.
            this.stinger = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 6), black); this.stinger.position.set(0, 0.98, -1.0); this.stinger.rotation.x = -Math.PI / 2; this.bodyGroup.add(this.stinger);
            // Head with mandibles + antennae.
            this.head = new THREE.Group();
            const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), gold); h.scale.set(1.1, 0.9, 0.95); this.head.add(h);
            this._eye(this.head, -0.12, 0.03, 0.1, 0.07, p.accent); this._eye(this.head, 0.12, 0.03, 0.1, 0.07, p.accent);
            this._antennae(this.head, black, p.accent);
            this.head.position.set(0, 1.0, 0.56); this.bodyGroup.add(this.head);
            this.mandibles = new THREE.Group();
            for (const mx of [-0.08, 0.08]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), black); m.position.set(mx, 0.92, 0.72); m.rotation.x = 1.5; m.rotation.z = -mx * 3; this.mandibles.add(m); }
            this.bodyGroup.add(this.mandibles);
            // Shimmering time-warped wings with afterimage echo planes.
            this.wings = new THREE.Group();
            const wingMat = this._mat(p.accent, 0.42, 0.15, p.accent); this._thWings = [wingMat];
            this._thEcho = [];
            for (const sx of [-1, 1]) {
                const w = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), wingMat); w.scale.set(1.4, 0.4, 1); w.position.set(sx * 0.32, 1.18, 0.05); w.rotation.x = -Math.PI / 2; w.rotation.z = sx * 0.2; w._sx = sx; this.wings.add(w);
                // Faint trailing time-echo of the wing.
                const echo = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), this._mat(p.accent, 0.18, 0.1, p.accent)); echo.scale.set(1.4, 0.4, 1); echo.position.set(sx * 0.32, 1.18, -0.12); echo.rotation.x = -Math.PI / 2; echo.rotation.z = sx * 0.3; echo._sx = sx; this.wings.add(echo); this._thEcho.push(echo); this._thWings.push(echo.material);
            }
            this.bodyGroup.add(this.wings);
            this._wireBug({ thorax: this.thorax, abdomen: this.abdomen, head: this.head, mandibles: this.mandibles, extra: [this.wings, this.stinger], legY: 0.82, mat: black });
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            if (this._baseX === null) this._baseX = this.model.position.x;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.8);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');
            const flyer = (this.variant === 'dragonfly' || this.variant === 'bumblebee' || this.variant === 'bloodmosquito' || this.variant === 'temporalhornet');
            this.model.position.y = this._baseY + Math.sin(t * 1.3) * (flyer ? 0.07 : 0.02) * this.scale;
            // Default leg scuttle for the walkers.
            if (!flyer) this._legs.forEach((lg, i) => { if (lg.visible) lg.rotation.x = Math.sin(t * (fast ? 9 : 4) + i * 1.1) * 0.18; });

            const baseX = this._baseX !== null ? this._baseX : this.model.position.x;
            switch (this.variant) {
                case 'discobeetle': {
                    this._discoMats.forEach((m, i) => { const hue = (t * 0.4 + i * 0.07) % 1; m.color.setHSL(hue, 1.0, 0.6); m.emissive.setHSL(hue, 1.0, 0.4); m.emissiveIntensity = 0.6 + Math.sin(t * 6 + i) * 0.4; });
                    if (this.carapace) this.carapace.rotation.y = t * 1.3;
                    if (this.rays) { this.rays.rotation.y = -t * 1.6; this.rays.children.forEach((r, i) => { const hue = (t * 0.5 + i * 0.16) % 1; r.material.color.setHSL(hue, 1, 0.6); r.material.emissive.setHSL(hue, 1, 0.5); }); }
                    this.model.rotation.z = Math.sin(t * 4) * 0.12;       // boogie
                    this.model.position.x = baseX + Math.sin(t * 2) * 0.06 * this.scale;
                    this._legs.forEach((lg, i) => { if (lg.visible) lg.rotation.x = Math.sin(t * 8 + i) * 0.32; });
                    if (this.head) this.head.rotation.z = Math.sin(t * 4 + 1) * 0.16;
                    break;
                }
                case 'ladybug': {
                    const open = fast ? 1.0 : (0.15 + Math.max(0, Math.sin(t * 0.5)) * 0.2);
                    if (this.leftWing) this.leftWing.rotation.z = open * 0.9;
                    if (this.rightWing) this.rightWing.rotation.z = -open * 0.9;
                    break;
                }
                case 'grasshopper': {
                    const crouch = fast ? Math.abs(Math.sin(t * 6)) : 0;
                    [this.hindLeft, this.hindRight].forEach(lg => { if (lg) lg.rotation.x = crouch * 0.5; });
                    if (fast) this.model.position.y = this._baseY + Math.abs(Math.sin(t * 6)) * 0.25 * this.scale; // hops
                    break;
                }
                case 'acidant': {
                    if (this.mandibles) this.mandibles.children.forEach((m, i) => { if (m.geometry.type === 'ConeGeometry') m.rotation.z = (i ? -1 : 1) * (0.2 + Math.abs(Math.sin(t * (fast ? 8 : 3))) * 0.3); });
                    if (this.acidDrop) { this.acidDrop.position.y = 0.8 - ((t * 0.5) % 1) * 0.2; this.acidDrop.material.emissiveIntensity = 0.5 + Math.sin(t * 5) * 0.3; }
                    break;
                }
                case 'dragonfly':
                case 'bumblebee':
                case 'bloodmosquito': {
                    if (this.wings) this.wings.children.forEach(w => { w.rotation.x = -Math.PI / 2 + Math.sin(t * (fast ? 40 : 28) + (w._sx || 0)) * 0.5; });
                    this.model.position.y = this._baseY + Math.sin(t * 2.2) * 0.06 * this.scale + 0.04 * this.scale;
                    if (this.variant === 'bloodmosquito' && this.proboscis) this.head.rotation.x = fast ? Math.abs(Math.sin(t * 7)) * 0.4 : 0;
                    break;
                }
                case 'crawlinghand': {
                    if (this._fingers) this._fingers.forEach((f, i) => { if (f.visible && !f._thumb) f.rotation.x = Math.sin(t * (fast ? 9 : 4) + i * 1.3) * 0.3; });
                    if (this._wisps) this._wisps.forEach(w => { if (w.visible) { w.rotation.z = Math.sin(t * 2 + w._sx) * 0.3; w.material.emissiveIntensity = 0.4 + Math.sin(t * 3 + w._sx) * 0.3; } });
                    if (this.head) this.head.rotation.z = Math.sin(t * 1.5) * 0.08;
                    break;
                }
                case 'engorgedtick': {
                    if (this.abdomen && this.abdomen.visible) { const pulse = 1 + Math.sin(t * (fast ? 7 : 3)) * 0.04; this.abdomen.scale.set(1.05 * pulse, 1.15 * pulse, 1.1 * pulse); }
                    break;
                }
                case 'firecentipede': {
                    if (this._segGlow) this._segGlow.forEach((m, i) => { m.emissiveIntensity = 0.6 + Math.sin(t * 5 + i * 0.6) * 0.45; });
                    if (this._segments) this._segments.forEach((s, i) => { if (s.visible) s.position.x = Math.sin(t * (fast ? 6 : 3) - i * 0.7) * 0.12 * this.scale; });
                    if (this.mandibles && this.mandibles.visible) this.mandibles.children.forEach((m, i) => { m.rotation.z = (i ? -1 : 1) * (0.2 + Math.abs(Math.sin(t * 4)) * 0.3); });
                    break;
                }
                case 'frostscarab': {
                    if (this._frost) this._frost.forEach((s, i) => { if (s.visible) s.material.opacity = 0.5 + Math.abs(Math.sin(t * 1.5 + i)) * 0.4; });
                    this.model.rotation.y = Math.sin(t * 0.8) * 0.06;
                    break;
                }
                case 'gloomwurm': {
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) s.position.x = Math.sin(t * (fast ? 4 : 1.8) - i * 0.6) * 0.14 * this.scale; });
                    if (this.tail && this.tail.visible) this.tail.position.x = Math.sin(t * 1.8 - 8) * 0.16 * this.scale;
                    if (this._miasma) this._miasma.forEach((h, i) => { h.material.opacity = 0.1 + Math.abs(Math.sin(t * 1.2 + i)) * 0.12; h.rotation.y = t * 0.4 + i; });
                    if (this._fangs && this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 1.2) * 0.1;
                    break;
                }
                case 'gutturalmaggotus': {
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) { const w = 1 + Math.sin(t * (fast ? 6 : 2.5) - i * 0.8) * 0.05; s.scale.set(1.05 * w, 0.95 * w, 1.1); } });
                    if (this._pustules) this._pustules.forEach((pu, i) => { pu.material.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * 3 + i)) * 0.4; });
                    break;
                }
                case 'hivemindtermite': {
                    if (this.mandibles && this.mandibles.visible) this.mandibles.children.forEach((m, i) => { m.rotation.z = (i ? Math.PI + 0.5 : -0.5) + (i ? 1 : -1) * Math.abs(Math.sin(t * (fast ? 8 : 2.5))) * 0.25; });
                    if (this.abdomen && this.abdomen.visible) { const pulse = 1 + Math.sin(t * 2) * 0.02; this.abdomen.scale.set(1.05 * pulse, 1.05 * pulse, 1.5); }
                    break;
                }
                case 'junglestalker': {
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) s.position.x = Math.sin(t * (fast ? 5 : 2.2) - i * 0.7) * 0.13 * this.scale; });
                    if (this.tail && this.tail.visible) this.tail.position.x = Math.sin(t * 2.2 - 7) * 0.15 * this.scale;
                    if (this._jsVenom) this._jsVenom.forEach((m, i) => { m.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3 + i)) * 0.4; });
                    if (this._jsDrip) { this._jsDrip.position.y = -0.12 - ((t * 0.5) % 1) * 0.12; }
                    break;
                }
                case 'luminouslocustking': {
                    if (this._lkGlow) this._lkGlow.forEach((m, i) => { m.emissiveIntensity = 0.5 + Math.sin(t * 4 + i * 0.5) * 0.4; });
                    if (this.wings) this.wings.children.forEach(w => { w.rotation.x = -Math.PI / 2 + 0.2 + Math.sin(t * (fast ? 24 : 10) + (w._sx || 0)) * 0.25; });
                    if (this._lkHind && fast) this._lkHind.forEach(lg => { if (lg.visible) lg.rotation.x = Math.abs(Math.sin(t * 6)) * 0.4; });
                    this.model.position.y = this._baseY + Math.sin(t * 2) * 0.04 * this.scale;
                    break;
                }
                case 'magmacentipede': {
                    if (this._mcGlow) this._mcGlow.forEach((m, i) => { m.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 4 + i * 0.5)) * 0.5; });
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) s.position.x = Math.sin(t * (fast ? 5 : 2.4) - i * 0.6) * 0.12 * this.scale; });
                    if (this.tail && this.tail.visible) this.tail.position.x = Math.sin(t * 2.4 - 8) * 0.14 * this.scale;
                    break;
                }
                case 'mothshadestalker': {
                    if (this.wings) this.wings.children.forEach(w => { if (w._sx) w.rotation.z = (w._sx) * (0.2 + Math.sin(t * (fast ? 14 : 4)) * 0.18); });
                    if (this._mothEyes) this._mothEyes.forEach((m, i) => { m.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * 2 + i * 1.5)) * 0.5; });
                    this.model.position.y = this._baseY + Math.sin(t * 1.8) * 0.05 * this.scale;
                    break;
                }
                case 'swampscorpion': {
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * (fast ? 7 : 1.5)) * (fast ? 0.25 : 0.08);
                    [this.pincerL, this.pincerR].forEach((pc, i) => { if (pc && pc.visible) pc.rotation.y = (i ? -1 : 1) * (0.1 + Math.abs(Math.sin(t * (fast ? 6 : 2))) * 0.25); });
                    break;
                }
                case 'toxicghost': {
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) s.position.x = Math.sin(t * (fast ? 5 : 2.2) - i * 0.7) * 0.12 * this.scale; });
                    if (this.tail && this.tail.visible) this.tail.position.x = Math.sin(t * 2.2 - 7) * 0.14 * this.scale;
                    if (this._tgVenom) this._tgVenom.forEach((m, i) => { m.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3 + i)) * 0.4; });
                    if (this._tgEggs) this._tgEggs.forEach((e, i) => { if (e.visible) { const w = 1 + Math.sin(t * 2 + i) * 0.1; e.scale.set(w, w, w); } });
                    if (this._tgDrip) this._tgDrip.position.y = -0.14 - ((t * 0.5) % 1) * 0.12;
                    break;
                }
                case 'venomousdragonfly': {
                    if (this.wings) this.wings.children.forEach(w => { if (w._sx) w.rotation.x = -Math.PI / 2 + Math.sin(t * (fast ? 42 : 30) + w._sx) * 0.5; });
                    if (this._vdVenom) this._vdVenom.forEach((m, i) => { m.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3 + i * 0.4)) * 0.4; });
                    this.model.position.y = this._baseY + Math.sin(t * 2.2) * 0.06 * this.scale + 0.04 * this.scale;
                    if (this.abdomen && this.abdomen.visible) this.abdomen.rotation.z = Math.sin(t * 1.4) * 0.04;
                    break;
                }
                case 'chromatictick': {
                    if (this._ctShell) this._ctShell.forEach((m, i) => { const hue = (t * 0.35 + i * 0.05) % 1; m.color.setHSL(hue, 1.0, 0.6); m.emissive.setHSL(hue, 1.0, 0.35); m.emissiveIntensity = 0.5 + Math.sin(t * 5 + i) * 0.4; });
                    if (this._ctOoze) this._ctOoze.forEach((m, i) => { m.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3 + i)) * 0.4; });
                    if (this._ctDrops) this._ctDrops.forEach((d, i) => { if (d.visible) d.position.y = (0.7 - 0.25) - ((t * 0.4 + i * 0.2) % 1) * 0.12; });
                    this.model.rotation.y = Math.sin(t * 0.7) * 0.06;
                    break;
                }
                case 'mindflayermoth': {
                    if (this.wings) this.wings.children.forEach(w => { if (w._sx) w.rotation.z = w._sx * (0.2 + Math.sin(t * (fast ? 14 : 4)) * 0.18); });
                    if (this._mfPsy) this._mfPsy.forEach((m, i) => { const hue = (t * 0.25 + i * 0.08) % 1; m.color.setHSL(hue, 0.9, 0.6); m.emissive.setHSL(hue, 0.9, 0.45); m.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 2.5 + i)) * 0.5; });
                    if (this._mfTents) this._mfTents.forEach((tn, i) => { if (tn.visible) tn.rotation.z = Math.sin(t * (fast ? 6 : 2.5) + i * 1.2) * 0.4; });
                    this.model.position.y = this._baseY + Math.sin(t * 1.8) * 0.05 * this.scale;
                    break;
                }
                case 'emotionalleech':
                case 'memoryleech': {
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) { const w = 1 + Math.sin(t * (fast ? 6 : 2.6) - i * 0.9) * 0.12; s.scale.set(1.05 * w, 0.95 / w, 1.1 * w); } });
                    if (this.head && this.head.visible) this.head.position.z = 0.6 + Math.sin(t * (fast ? 6 : 2.6)) * 0.06 * this.scale;
                    if (this._leechRings) this._leechRings.forEach((m, i) => { m.opacity = 0.7 + Math.abs(Math.sin(t * 3 + i)) * 0.3; });
                    break;
                }
                case 'thoughtparasite': {
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) s.position.x = Math.sin(t * (fast ? 5 : 2.2) - i * 0.8) * 0.12 * this.scale; });
                    if (this.tail && this.tail.visible) this.tail.position.x = Math.sin(t * 2.2 - 6) * 0.13 * this.scale;
                    // Flicker between visible and near-invisible (phasing).
                    const phase = 0.25 + Math.abs(Math.sin(t * 1.6)) * 0.6 + (Math.sin(t * 11) > 0.7 ? -0.4 : 0);
                    if (this._tpGhost) this._tpGhost.forEach((m, i) => { m.opacity = Math.max(0.05, phase * (m.userData && m.userData.aura ? 0.4 : 1)); m.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * 4 + i)) * 0.4; });
                    if (this._tpAura) this._tpAura.forEach((a, i) => { if (a.visible) a.rotation.y = t * 0.6 + i; });
                    break;
                }
                case 'emberbackhellscorpion': {
                    if (this._ehGlow) this._ehGlow.forEach((m, i) => { m.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 4 + i * 0.4)) * 0.5; });
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * (fast ? 7 : 1.5)) * (fast ? 0.28 : 0.1);
                    [this.pincerL, this.pincerR].forEach((pc, i) => { if (pc && pc.visible) pc.rotation.y = (i ? -1 : 1) * (0.1 + Math.abs(Math.sin(t * (fast ? 6 : 2))) * 0.25); });
                    break;
                }
                case 'gravityworm': {
                    if (this._wormSegs) this._wormSegs.forEach((s, i) => { if (s.visible) s.position.x = Math.sin(t * (fast ? 4 : 1.7) - i * 0.6) * 0.14 * this.scale; });
                    if (this.tail && this.tail.visible) this.tail.position.x = Math.sin(t * 1.7 - 8) * 0.16 * this.scale;
                    if (this._gwRings) this._gwRings.forEach((m, i) => { m.opacity = (m.opacity > 0.45 ? 0.4 : (0.15 + Math.abs(Math.sin(t * 2 + i)) * 0.3)); m.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3 + i)) * 0.4; });
                    if (this._gwDisc && this._gwDisc.visible) this._gwDisc.rotation.z = t * 1.2;
                    if (this._gwHalos) this._gwHalos.forEach((h, i) => { if (h.visible) h.rotation.z = t * (0.6 + i * 0.05) * (i % 2 ? 1 : -1); });
                    this.model.rotation.z = Math.sin(t * 0.9) * 0.04;
                    break;
                }
                case 'temporalhornet': {
                    if (this.wings) this.wings.children.forEach(w => { if (w._sx) w.rotation.x = -Math.PI / 2 + Math.sin(t * (fast ? 42 : 30) + w._sx) * 0.5; });
                    if (this._thWings) this._thWings.forEach((m, i) => { m.opacity = (i === 0 ? 0.42 : 0.18) * (0.6 + Math.abs(Math.sin(t * 5 + i)) * 0.6); m.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * 4 + i)) * 0.4; });
                    if (this._thEcho) this._thEcho.forEach((e, i) => { if (e.visible) e.position.z = -0.12 - Math.abs(Math.sin(t * 6)) * 0.08; });
                    this.model.position.y = this._baseY + Math.sin(t * 2.2) * 0.06 * this.scale + 0.04 * this.scale;
                    if (this.abdomen && this.abdomen.visible) this.abdomen.rotation.z = Math.sin(t * 1.5) * 0.03;
                    break;
                }
            }
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.2);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY - prog * 0.2 * this.scale;
            this.model.rotation.z = prog * 0.6;               // tip onto its back
            this._legs.forEach((lg, i) => { if (lg) lg.rotation.x = prog * 1.2 * (i % 2 ? 1 : -1); });
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new BugBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = B_PROFILES;
    // Narrow aliases (key only) so generic tokens can't hijack other enemies;
    // the real enemies are pinned by exact name below.
    reg('discobeetle',   { aliases: ['discobeetle'],   scale: S.discobeetle.scale,   weapon: 0, create: make });
    reg('ladybug',       { aliases: ['ladybug'],       scale: S.ladybug.scale,       weapon: 0, create: make });
    reg('grasshopper',   { aliases: ['grasshopper'],   scale: S.grasshopper.scale,   weapon: 0, create: make });
    reg('acidant',       { aliases: ['acidant'],       scale: S.acidant.scale,       weapon: 0, create: make });
    reg('dragonfly',     { aliases: ['dragonfly'],     scale: S.dragonfly.scale,     weapon: 0, create: make });
    reg('bumblebee',     { aliases: ['bumblebee'],     scale: S.bumblebee.scale,     weapon: 0, create: make });
    reg('bloodmosquito', { aliases: ['bloodmosquito'], scale: S.bloodmosquito.scale, weapon: 0, create: make });
    reg('crawlinghand',     { aliases: ['crawlinghand'],     scale: S.crawlinghand.scale,     weapon: 0, create: make });
    reg('engorgedtick',     { aliases: ['engorgedtick'],     scale: S.engorgedtick.scale,     weapon: 0, create: make });
    reg('firecentipede',    { aliases: ['firecentipede'],    scale: S.firecentipede.scale,    weapon: 0, create: make });
    reg('frostscarab',      { aliases: ['frostscarab'],      scale: S.frostscarab.scale,      weapon: 0, create: make });
    reg('gloomwurm',        { aliases: ['gloomwurm'],        scale: S.gloomwurm.scale,        weapon: 0, create: make });
    reg('gutturalmaggotus', { aliases: ['gutturalmaggotus'], scale: S.gutturalmaggotus.scale, weapon: 0, create: make });
    reg('hivemindtermite',   { aliases: ['hivemindtermite'],   scale: S.hivemindtermite.scale,   weapon: 0, create: make });
    reg('junglestalker',     { aliases: ['junglestalker'],     scale: S.junglestalker.scale,     weapon: 0, create: make });
    reg('luminouslocustking',{ aliases: ['luminouslocustking'],scale: S.luminouslocustking.scale,weapon: 0, create: make });
    reg('magmacentipede',    { aliases: ['magmacentipede'],    scale: S.magmacentipede.scale,    weapon: 0, create: make });
    reg('mothshadestalker',  { aliases: ['mothshadestalker'],  scale: S.mothshadestalker.scale,  weapon: 0, create: make });
    reg('swampscorpion',     { aliases: ['swampscorpion'],     scale: S.swampscorpion.scale,     weapon: 0, create: make });
    reg('toxicghost',        { aliases: ['toxicghost'],        scale: S.toxicghost.scale,        weapon: 0, create: make });
    reg('venomousdragonfly', { aliases: ['venomousdragonfly'], scale: S.venomousdragonfly.scale, weapon: 0, create: make });
    reg('chromatictick',     { aliases: ['chromatictick'],     scale: S.chromatictick.scale,     weapon: 0, create: make });
    reg('mindflayermoth',    { aliases: ['mindflayermoth'],    scale: S.mindflayermoth.scale,    weapon: 0, create: make });
    reg('emotionalleech',    { aliases: ['emotionalleech'],    scale: S.emotionalleech.scale,    weapon: 0, create: make });
    reg('memoryleech',       { aliases: ['memoryleech'],       scale: S.memoryleech.scale,       weapon: 0, create: make });
    reg('thoughtparasite',        { aliases: ['thoughtparasite'],        scale: S.thoughtparasite.scale,        weapon: 0, create: make });
    reg('emberbackhellscorpion',  { aliases: ['emberbackhellscorpion'],  scale: S.emberbackhellscorpion.scale,  weapon: 0, create: make });
    reg('gravityworm',            { aliases: ['gravityworm'],            scale: S.gravityworm.scale,            weapon: 0, create: make });
    reg('temporalhornet',         { aliases: ['temporalhornet'],         scale: S.temporalhornet.scale,         weapon: 0, create: make });

    const NAMED = {
        discobeetle:   ["Disco Beetle"],
        ladybug:       ["Ladybug"],
        grasshopper:   ["Grasshopper"],
        acidant:       ["Acid Ant"],
        dragonfly:     ["Draconic Dragonfly"],
        bumblebee:     ["Buzzing Bumblebee"],
        bloodmosquito: ["Blood Mosquito"],
        crawlinghand:     ["Crawling Hand", "Hand Crawler", "Finger Worm", "Tongue Leech"],
        engorgedtick:     ["Engorged Tick Swarm"],
        firecentipede:    ["Fire Centipede"],
        frostscarab:      ["Frost Scarab"],
        gloomwurm:        ["Gloomwurm"],
        gutturalmaggotus: ["Guttural Maggotus"],
        hivemindtermite:   ["Hivemind Termite"],
        junglestalker:     ["Jungle Stalker"],
        luminouslocustking:["Luminous Locust King"],
        magmacentipede:    ["Magma Centipede"],
        mothshadestalker:  ["Mothshade Stalker"],
        swampscorpion:     ["Swamp Scorpion"],
        toxicghost:        ["Toxic Ghost"],
        venomousdragonfly: ["Venomous Dragonfly"],
        chromatictick:     ["Chromatic Tick"],
        mindflayermoth:    ["Mind Flayer Moth"],
        emotionalleech:    ["Emotional Leech"],
        memoryleech:       ["Memory Leech"],
        thoughtparasite:        ["Thought Parasite"],
        emberbackhellscorpion:  ["Emberback Hellscorpion"],
        gravityworm:            ["Gravity Worm"],
        temporalhornet:         ["Temporal Hornet"]
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Bug uniques registered');

    ;[['u_fingerworm',1.7],['u_tongueleech',1.7],['u_handcrawler',1.7],['u_maatsseveredhand',1.7]].forEach(([k,sc]) => reg(k, { aliases: [k], scale: sc, weapon: 0, create: make }));
})();
