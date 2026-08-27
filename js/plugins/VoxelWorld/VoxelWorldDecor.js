//=============================================================================
// VoxelWorldDecor.js
// VoxelWorld: 2D billboard vegetation, rocks, props and the settlement batcher
//
// Part of the VoxelWorld suite. The ground of that world is a field of small
// destructible voxels; this module is one slice of the machinery laid over it.
// Load order is fixed in plugins.js and every module reads the shared state it
// needs off window.VoxelWorld.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc VoxelWorld - 2D billboard vegetation, rocks, props and the settlement batcher
 * @author Omni-Lex
 *
 * @help
 * 2D billboard vegetation, rocks, props and the settlement batcher.
 *
 * One module of the VoxelWorld suite (VoxelWorldCore.js loads first). It
 * declares no plugin commands of its own; those live in VoxelWorldSystem.js.
 */

(() => {
    'use strict';

    const VW = window.VoxelWorld;
    if (!VW) { console.error('[VoxelWorld] core not loaded before VoxelWorldDecor.js'); return; }

    const {
        DOOR_H, PLANT_CROPS, PLANT_POOL, ROCK_ASH, ROCK_POOL, SETTLE,
        SettlementBatch, TREE_POOLS, WALL_T, _doorSpan, getRenderType, loadTex, loadVoxelTex,
        planAbandoned, planBaseY, planForTile, planSettlement, sampleBiomeAt,
        PROP_RADIUS, PROP_MIN_R, VoxelWorldState, WORLD_TILE_SIZE
    } = VW;

    // =========================================================================
    // ProceduralDecorator
    // High-performance instanced chunk decorations (Cities, Forests, Deserts)
    // =========================================================================
    // Drawn from their own hand-picked lists just above, so the biome map must
    // not scatter them a second time.
    const SKIP_CURATED = new Set(['Trees', 'Plants', 'Rocks', 'Grass']);

    // How far into the ground a scatter billboard is planted, as a fraction of
    // its own height. Small: enough that no card's bottom edge can be caught
    // floating over the voxel it stands on, not so much that a short plant is
    // swallowed by it.
    const SPRITE_SINK = 0.035;


    // The furniture art now lives at img/furniture/<Category>/<Subcategory>/, so
    // the folder a sprite pool names ("Trees") is only half the path, and stage 6b
    // moved some pieces to another category outright (speckled_stone_arch is filed
    // under Buildings/Arches now). window.Items.FurnitureImageFolders maps a sprite
    // id to its real relative folder, which survives both changes; the pool's own
    // folder stays the fallback for art the index has not been rebuilt for.
    function furnitureSpritePath(folder, name) {
        const id = String(name).replace(/\.png$/i, ''); // i18n-ignore: asset path
        const index = (window.Items && window.Items.FurnitureImageFolders) || null;
        const real = (index && index[id]) || folder;
        return 'img/furniture/' + real + '/' + id + '.png'; // i18n-ignore: asset path
    }

    class ProceduralDecorator {
        constructor(matCache) {
            this.matCache = matCache;
            this.geos = {
                trunk: new THREE.CylinderGeometry(1.5, 2, 12, 5),
                leafBase: new THREE.DodecahedronGeometry(9),
                pineBase: new THREE.ConeGeometry(7, 20, 5),
                cactus: new THREE.CylinderGeometry(1.2, 1.2, 14, 5),
                rock: new THREE.DodecahedronGeometry(4),
                skyscraper: new THREE.BoxGeometry(20, 70, 20),
                houseBase: new THREE.BoxGeometry(14, 12, 14),
                houseRoof: new THREE.ConeGeometry(12, 9, 4).rotateY(Math.PI / 4),
                palmTrunk: new THREE.CylinderGeometry(0.8, 1.4, 20, 5),
                palmCrown: new THREE.ConeGeometry(9, 5, 6),
                bamboo:    new THREE.CylinderGeometry(0.5, 0.6, 26, 5),
                crystal:   new THREE.ConeGeometry(2.5, 12, 5),
                mushStem:  new THREE.CylinderGeometry(1.5, 2.2, 8, 6),
                mushCap:   new THREE.ConeGeometry(7, 4.5, 8),
                deadTrunk: new THREE.CylinderGeometry(1, 1.6, 16, 5),
                acaciaTop: new THREE.ConeGeometry(11, 3.5, 6),
                tomb:      new THREE.BoxGeometry(3, 5, 1),
                column:    new THREE.CylinderGeometry(2, 2.4, 13, 6),
                spire:     new THREE.ConeGeometry(4, 18, 5),
                // --- Docks structure pieces (positioned explicitly at build time) ---
                dockDeck:    new THREE.BoxGeometry(16, 2, 150),
                dockPiling:  new THREE.CylinderGeometry(1.2, 1.2, 26, 6),
                dockBollard: new THREE.CylinderGeometry(1.3, 1.6, 4, 8),
                crate:       new THREE.BoxGeometry(6, 6, 6),
                barrel:      new THREE.CylinderGeometry(2.2, 2.2, 5.5, 10),
                craneBase:   new THREE.BoxGeometry(7, 4, 7),
                craneMast:   new THREE.BoxGeometry(2.4, 32, 2.4),
                craneArm:    new THREE.BoxGeometry(2.2, 2.2, 28),
                craneCable:  new THREE.CylinderGeometry(0.25, 0.25, 14, 4),
                boatHull:    new THREE.BoxGeometry(7, 5, 22),
                boatCabin:   new THREE.BoxGeometry(5, 4, 7),
                lhBase:      new THREE.CylinderGeometry(4, 5.5, 24, 12),
                lhRoom:      new THREE.CylinderGeometry(3.2, 3.2, 5, 12),
                lhRoof:      new THREE.ConeGeometry(4.2, 5, 12),
                dockShed:    new THREE.BoxGeometry(22, 13, 16),
                // --- Gas station pieces (positioned explicitly at build time) ---
                gasCanopy:   new THREE.BoxGeometry(46, 3, 24),
                gasPillar:   new THREE.CylinderGeometry(1.2, 1.2, 16, 6),
                gasPump:     new THREE.BoxGeometry(4, 8, 5),
                gasSign:     new THREE.BoxGeometry(9, 6, 1),
                // --- unit shapes, scaled per instance (the whole of a town) ---
                // Each is one unit across and pivoted on its base, so a single
                // geometry serves a tower, a kerb, a bench and a bin alike.
                uBox: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
                uPyr: new THREE.CylinderGeometry(0, 0.707, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
                uCyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0),
                uSph: new THREE.SphereGeometry(0.5, 8, 6).translate(0, 0.5, 0),
                // A pitched roof. One unit across, one deep, one tall, pivoted
                // on its base with the ridge running along Z, so scaling it by
                // (width, rise, depth) and turning it on Y gives a real gable
                // instead of the four-sided pyramid every house used to wear.
                uWedge: ProceduralDecorator._wedgeGeometry()
            };

            // Adjust origins so they sit flat on the ground
            this.geos.trunk.translate(0, 6, 0);
            this.geos.leafBase.translate(0, 14, 0);
            this.geos.pineBase.translate(0, 10, 0);
            this.geos.cactus.translate(0, 7, 0);
            this.geos.rock.translate(0, 1.5, 0);
            this.geos.skyscraper.translate(0, 35, 0);
            this.geos.houseBase.translate(0, 6, 0);
            this.geos.houseRoof.translate(0, 16.5, 0);
            this.geos.palmTrunk.translate(0, 10, 0);
            this.geos.palmCrown.translate(0, 20, 0);
            this.geos.bamboo.translate(0, 13, 0);
            this.geos.crystal.translate(0, 6, 0);
            this.geos.mushStem.translate(0, 4, 0);
            this.geos.mushCap.translate(0, 9.5, 0);
            this.geos.deadTrunk.translate(0, 8, 0);
            this.geos.acaciaTop.translate(0, 13, 0);
            this.geos.tomb.translate(0, 2.5, 0);
            this.geos.column.translate(0, 6.5, 0);
            this.geos.spire.translate(0, 9, 0);

            // Billboard sprite quads (unit-sized, bottom-pivoted so they stand on
            // the ground). Aspect is baked per kind since the billboard shader only
            // applies one uniform scale. Trees are tall, rocks squat, plants square.
            //
            // The pivot sits a little BELOW the bottom edge (SPRITE_SINK), so the
            // foot of every card is buried rather than resting exactly on the
            // surface: the ground is voxels, a card is flat, and a trunk whose
            // last row of pixels lands on the seam reads as hovering over it from
            // anything but dead level. Sinking it plants the thing in the ground.
            const mkQuad = (w, h) =>
                new THREE.PlaneGeometry(w, h).translate(0, h * (0.5 - SPRITE_SINK), 0);
            this.spriteQuads = {
                tree:  mkQuad(0.85, 1.35),
                rock:  mkQuad(1.20, 0.85),
                plant: mkQuad(0.95, 0.95)
            };
            this._spriteTex = new Map();   // 'Folder/name.png' -> THREE.Texture

            // Windowed facades. A canvas grid of lit/unlit panes is mapped onto the
            // box faces; the matching emissive map makes the lit panes glow at night.
            const sky   = ProceduralDecorator._makeFacade(4, 11, '#6b7686', '#243240', '#ffe9a8');
            const house = ProceduralDecorator._makeFacade(3, 2,  '#8a8f99', '#33414f', '#ffe6a0');
            this.skyscraperMat = new THREE.MeshLambertMaterial({
                map: sky.map, emissiveMap: sky.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.85
            });
            this.houseMat = new THREE.MeshLambertMaterial({
                map: house.map, emissiveMap: house.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.6
            });
        }

        // The unit pitched-roof prism: a square base with a ridge along Z over
        // the middle of it. Wound so the two slopes and the two gable ends all
        // face outwards; there is no underside, because there is always a
        // ceiling under it (see planInterior's own top slab).
        static _wedgeGeometry() {
            const A = [-0.5, 0, -0.5], B = [-0.5, 0, 0.5], C = [0, 1, 0.5], D = [0, 1, -0.5];
            const E = [0.5, 0, 0.5],  F = [0.5, 0, -0.5];
            const tris = [
                A, B, C,  A, C, D,          // the slope that faces -X
                E, F, D,  E, D, C,          // the slope that faces +X
                A, D, F,                    // the gable end at -Z
                B, E, C                     // the gable end at +Z
            ];
            const pos = new Float32Array(tris.length * 3);
            const uv  = new Float32Array(tris.length * 2);
            for (let i = 0; i < tris.length; i++) {
                pos[i * 3] = tris[i][0]; pos[i * 3 + 1] = tris[i][1]; pos[i * 3 + 2] = tris[i][2];
                uv[i * 2] = tris[i][0] + 0.5; uv[i * 2 + 1] = tris[i][2] + 0.5;
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
            g.computeVertexNormals();
            return g;
        }

        // -------------------------------------------------------------------
        // Roofs
        // -------------------------------------------------------------------
        // Every roof in the world, built in one place, because there used to be
        // four of them and they disagreed: a town house wore a pyramid, a
        // village house wore the same pyramid, a steading wore a different one
        // and none of them had eaves, a ridge or anything over the inside of
        // the top floor.
        //
        //   lot    the building (x, z, w, d, rot, gable, shop)
        //   y      the top of its walls
        //   mats   { tile, flat, metal, roof } from the caller's own palette
        //
        // A gable gets a real pitched roof with the ridge across the SHORT axis
        // (which is what a builder does: rafters span the narrow way), eaves
        // that overhang the walls, a capping along the ridge and a chimney. A
        // flat roof gets a parapet all the way round it rather than a lid
        // hovering over it, plus the clutter every real roof has.
        _buildRoof(B, lot, y, mats) {
            const w = lot.w, d = lot.d, rot = lot.rot || 0;
            const tile = mats.tile, flat = mats.flat;
            if (lot.gable) {
                // Ridge along the longer side, so the slopes run down the short
                // way. The wedge's ridge runs along Z, so a building that is
                // wider than it is deep is turned a quarter turn.
                const alongZ = d >= w;
                const span = Math.min(w, d);            // what the rafters cross
                const rise = Math.max(5, span * 0.46);
                const EAVE = 3.2;                        // overhang past the wall
                const sw = (alongZ ? w : d) + EAVE * 2;
                const sd = (alongZ ? d : w) + EAVE * 2;
                B.add('uWedge', tile, lot.x, y, lot.z, sw, rise, sd,
                      rot + (alongZ ? 0 : Math.PI / 2));
                // The capping along the ridge, and a chimney off one end of it.
                const rl = (alongZ ? sd : sw) * 0.98;
                B.add('uBox', mats.metal || flat, lot.x, y + rise - 0.9, lot.z,
                      alongZ ? 1.8 : rl, 1.4, alongZ ? rl : 1.8, rot);
                const cx = (alongZ ? 0 : 1) * (w * 0.22), cz = (alongZ ? 1 : 0) * (d * 0.22);
                B.add('uBox', mats.roof || flat,
                      lot.x + cx * Math.cos(rot) - cz * Math.sin(rot),
                      y + rise * 0.45,
                      lot.z + cx * Math.sin(rot) + cz * Math.cos(rot),
                      3.4, rise * 0.75 + 4, 3.4, rot);
                return;
            }
            // Flat: the deck, then a parapet wall round all four sides of it, so
            // it reads as a roof somebody could stand on rather than a lid.
            B.add('uBox', flat, lot.x, y, lot.z, w * 1.02, 1.4, d * 1.02, rot);
            const PT = 1.6, PH = 3.4;
            const cos = Math.cos(rot), sin = Math.sin(rot);
            const put = (lx, lz, sw, sd) => B.add('uBox', flat,
                lot.x + lx * cos - lz * sin, y + 1.4, lot.z + lx * sin + lz * cos,
                sw, PH, sd, rot);
            put(0, -d / 2, w * 1.02, PT);
            put(0,  d / 2, w * 1.02, PT);
            put(-w / 2, 0, PT, d * 1.02);
            put( w / 2, 0, PT, d * 1.02);
            // The clutter: a stair head and a tank.
            B.add('uBox', mats.roof || flat, lot.x + w * 0.2, y + 1.4, lot.z + d * 0.2,
                  w * 0.2, 5.2, d * 0.2, rot);
            B.add('uCyl', mats.metal || flat, lot.x - w * 0.22, y + 1.4, lot.z - d * 0.18,
                  4.5, 5, 4.5, 0);
        }

        // Builds a {map, emissiveMap} pair: a cols×rows grid of window panes on a
        // wall-coloured background, with a deterministic subset rendered "lit".
        static _makeFacade(cols, rows, bgHex, winHex, litHex) {
            const W = 64, H = 128;
            const mk = () => {
                const c = document.createElement('canvas');
                c.width = W; c.height = H;
                return c;
            };
            const base = mk(), emis = mk();
            const bc = base.getContext('2d'), ec = emis.getContext('2d');
            bc.fillStyle = bgHex; bc.fillRect(0, 0, W, H);
            ec.fillStyle = '#000000'; ec.fillRect(0, 0, W, H);

            const mx = W / cols, my = H / rows;
            const ww = mx * 0.55, wh = my * 0.6;
            for (let r = 0; r < rows; r++) {
                for (let col = 0; col < cols; col++) {
                    const seed = Math.sin(col * 12.9898 + r * 78.233) * 43758.5453;
                    const lit  = (seed - Math.floor(seed)) > 0.6;
                    const x = col * mx + (mx - ww) / 2;
                    const y = r * my + (my - wh) / 2;
                    bc.fillStyle = lit ? litHex : winHex;
                    bc.fillRect(x, y, ww, wh);
                    if (lit) { ec.fillStyle = litHex; ec.fillRect(x, y, ww, wh); }
                }
            }
            const map = new THREE.CanvasTexture(base);
            const emissiveMap = new THREE.CanvasTexture(emis);
            return { map, emissiveMap };
        }

        _seededRandom(x, y, i) {
            const h = Math.sin(x * 12.9898 + y * 78.233 + i * 13.54) * 43758.5453;
            return h - Math.floor(h);
        }

        // Instances a geometry at every transform in `instances`. `colorOrMat`
        // accepts either a colour hex (cached Lambert material) or a ready Material.
        _instance(grp, geo, colorOrMat, instances) {
            if (instances.length === 0) return;
            let mat;
            if (colorOrMat && colorOrMat.isMaterial) {
                mat = colorOrMat;
            } else {
                mat = this.matCache.get(colorOrMat);
                if (!mat) {
                    mat = new THREE.MeshLambertMaterial({ color: colorOrMat });
                    this.matCache.set(colorOrMat, mat);
                }
            }
            const dummy = new THREE.Object3D();
            const imesh = new THREE.InstancedMesh(geo, mat, instances.length);
            imesh.castShadow = false;        // decorations skip the shadow pass
            imesh.receiveShadow = true;
            instances.forEach((pos, i) => {
                dummy.position.set(pos.x, pos.y, pos.z);
                dummy.rotation.set(0, pos.rotY, 0);
                dummy.scale.setScalar(pos.scale);
                dummy.updateMatrix();
                imesh.setMatrixAt(i, dummy.matrix);
            });
            grp.add(imesh);
        }

        // Sparse palms along any land tile bordering water (coastline / beach).
        _decorateBeach(grp, wx, wy, tileSize, heightFn) {
            let nearWater = false;
            for (let dx = -1; dx <= 1 && !nearWater; dx++) {
                for (let dy = -1; dy <= 1 && !nearWater; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    if (getRenderType(sampleBiomeAt(wx + dx, wy + dy).name) === 'water') nearWater = true;
                }
            }
            if (!nearWater) return;

            const trunks = [], crowns = [];
            const palmCount = Math.floor(this._seededRandom(wx, wy, 91) * 3) + 1;   // 1..3, sparse
            for (let i = 0; i < palmCount; i++) {
                const lx = (this._seededRandom(wx, wy, i * 5 + 101) - 0.5) * (tileSize * 0.9);
                const lz = (this._seededRandom(wx, wy, i * 5 + 102) - 0.5) * (tileSize * 0.9);
                if (Math.abs(lx) < 30 && Math.abs(lz) < 30) continue;   // keep the road corridor clear

                const gx = wx + 0.5 + lx / tileSize;
                const gz = wy + 0.5 + lz / tileSize;
                const yPos = heightFn ? heightFn(gx, gz) : 0;
                // Only on the dry sandy shelf, not out in the water or up on cliffs.
                if (yPos < -0.5 || yPos > 12) continue;

                const scale = 0.8 + this._seededRandom(wx, wy, i * 5 + 103) * 0.6;
                const rotY  = this._seededRandom(wx, wy, i * 5 + 104) * Math.PI * 2;
                trunks.push({ x: lx, y: yPos, z: lz, rotY, scale });
                crowns.push({ x: lx, y: yPos, z: lz, rotY, scale });
            }
            this._instance(grp, this.geos.palmTrunk, '#8a6d3b', trunks);
            this._instance(grp, this.geos.palmCrown, '#3cb043', crowns);
        }

        _mat(colorHex) {
            let m = this.matCache.get(colorHex);
            if (!m) { m = new THREE.MeshLambertMaterial({ color: colorHex }); this.matCache.set(colorHex, m); }
            return m;
        }

        // --- the materials a town is made of, shared by every town on the map --
        _cached(key, make) {
            let m = this.matCache.get(key);
            if (!m) { m = make(); this.matCache.set(key, m); }
            return m;
        }
        _matAsphalt()  { return this._cached('__st_asphalt',  () => new THREE.MeshLambertMaterial({ color: 0x45454a, map: loadVoxelTex('asphalt.png', 6) })); }
        _matPavement() { return this._cached('__st_pavement', () => new THREE.MeshLambertMaterial({ color: 0x9c9a94, map: loadVoxelTex('pavement.png', 8) })); }
        _matRoof()     { return this._cached('__st_roof',     () => new THREE.MeshLambertMaterial({ color: 0x4a4a52, map: loadVoxelTex('roof_slate.png', 2) })); }
        _matRoofTile() { return this._cached('__st_rooftile', () => new THREE.MeshLambertMaterial({ color: 0x9c4f33, map: loadVoxelTex('roof_tile.png', 2) })); }
        // A shop wears a blue roof. It is the one thing about a building that
        // can be read from the other end of the street, which is the point: you
        // can see where the shops are before you walk up to them.
        _matRoofShop() { return this._cached('__st_roofshop', () => new THREE.MeshLambertMaterial({ color: 0x2f6fb2, map: loadVoxelTex('roof_slate.png', 2) })); }
        _matStone()    { return this._cached('__st_stone',    () => new THREE.MeshLambertMaterial({ color: 0xbdb7a6, map: loadVoxelTex('stone.png', 2) })); }
        _matLawn()     { return this._cached('__st_lawn',     () => new THREE.MeshLambertMaterial({ color: 0x5d8f4a })); }
        _matGlass()    { return this._cached('__st_glass',    () => new THREE.MeshLambertMaterial({ color: 0x9fc6db, transparent: true, opacity: 0.6 })); }
        _matWater()    { return this._cached('__st_water',    () => new THREE.MeshLambertMaterial({ color: 0x3b7fa8, transparent: true, opacity: 0.85 })); }
        _matDirt()     { return this._cached('__st_dirt',     () => new THREE.MeshLambertMaterial({ color: 0x8a7550, map: loadVoxelTex('dirt.png', 5) })); }
        _matSoil()     { return this._cached('__st_soil',     () => new THREE.MeshLambertMaterial({ color: 0x6b563c })); }
        _matHay()      { return this._mat('#c9a94f'); }
        _matCrop(i)    { return this._mat(['#7f9e3a', '#a8b23f', '#5f8c46'][(i || 0) % 3]); }
        _matFloor()    { return this._cached('__st_floor',    () => new THREE.MeshLambertMaterial({ color: 0x8a6a48, map: loadVoxelTex('floor.png', 3) })); }
        _matPlaster()  { return this._cached('__st_plaster',  () => new THREE.MeshLambertMaterial({ color: 0xd8cfbb })); }
        _matRuinPlaster() { return this._cached('__st_ruinplaster', () => new THREE.MeshLambertMaterial({ color: 0x7e7668, map: loadVoxelTex('plaster.png', 3) })); }
        _matRuinRoof() { return this._cached('__st_ruinroof', () => new THREE.MeshLambertMaterial({ color: 0x6b5a48, map: loadVoxelTex('roof_slate.png', 3) })); }
        _matDeadWood() { return this._mat('#5a4a3c'); }
        _matPaint()    { return this._mat('#e6e6dc'); }
        _matMetal()    { return this._mat('#7d828c'); }
        _matWood()     { return this._mat('#6b4a2f'); }
        _matLeaf()     { return this._mat('#3f7d3a'); }
        _matAwning()   { return this._mat('#a33b3b'); }
        _getLampHeadMat() {
            return this._cached('__st_lamphead', () => new THREE.MeshLambertMaterial({
                color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 1.0
            }));
        }

        // A facade whose window grid suits the height it is stretched over: a
        // tower gets eleven floors of small panes, a town house gets three big
        // ones, so no building wears windows the wrong size.
        _facadeMat(storeys) {
            const cls = storeys >= 6 ? 'tall' : storeys >= 3 ? 'mid' : 'low';
            return this._cached('__st_facade_' + cls, () => {
                const g = cls === 'tall' ? ProceduralDecorator._makeFacade(4, 11, '#7c8390', '#243240', '#ffe9a8')
                        : cls === 'mid'  ? ProceduralDecorator._makeFacade(3, 6,  '#8b8375', '#2b3742', '#ffe6a0')
                        :                  ProceduralDecorator._makeFacade(3, 3,  '#a3968a', '#33414f', '#ffe6a0');
                return new THREE.MeshLambertMaterial({
                    map: g.map, emissiveMap: g.emissiveMap,
                    emissive: 0xffffff, emissiveIntensity: 0.8
                });
            });
        }

        // A built harbour: a piled timber pier reaching out over the water, stacked
        // cargo, a gantry crane, a windowed warehouse, a lighthouse and moored boats.
        // The whole thing is assembled along +Z then rotated to face the open water.
        _decorateDocks(grp, wx, wy) {
            // Orient the pier toward the nearest water neighbour.
            let wdx = 0, wdy = 1, found = false;
            for (let dy = -1; dy <= 1 && !found; dy++) {
                for (let dx = -1; dx <= 1 && !found; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    if (getRenderType(sampleBiomeAt(wx + dx, wy + dy).name) === 'water') {
                        wdx = dx; wdy = dy; found = true;
                    }
                }
            }
            const len = Math.hypot(wdx, wdy) || 1;
            const dock = new THREE.Group();
            dock.rotation.y = Math.atan2(wdx / len, wdy / len);

            const add = (geoKey, colorHex, x, y, z, ry) => {
                const m = new THREE.Mesh(this.geos[geoKey], this._mat(colorHex));
                m.position.set(x, y, z);
                if (ry) m.rotation.y = ry;
                m.castShadow = false;
                m.receiveShadow = true;
                dock.add(m);
                return m;
            };

            const WOOD = '#6b4f33', POST = '#5a4228', STEEL = '#7d8794';
            const CRATE = '#9c7b4d', BARREL = '#3f6b4a', HULL = '#8c3b32';

            // Deck planking, top surface ~y=4, land end at z=-15.
            add('dockDeck', WOOD, 0, 3, 60);

            // Support pilings in pairs down the length of the pier.
            for (let z = 5; z <= 130; z += 30) {
                add('dockPiling', POST, -7, -11, z);
                add('dockPiling', POST,  7, -11, z);
            }

            // Mooring bollards along the seaward edges.
            [60, 95, 125].forEach(z => {
                add('dockBollard', '#2e2e2e', -9, 6, z);
                add('dockBollard', '#2e2e2e',  9, 6, z);
            });

            // Stacked cargo near the landward end.
            add('crate', CRATE, -4, 7, 12);
            add('crate', CRATE,  4, 7, 16, 0.4);
            add('crate', CRATE, -1, 13, 13);
            add('barrel', BARREL,  5, 6.75, 30);
            add('barrel', BARREL, -5, 6.75, 34);
            add('barrel', BARREL,  4, 6.75, 38);

            // Gantry crane reaching over the water.
            add('craneBase', STEEL, 6, 6, 5);
            add('craneMast', STEEL, 6, 20, 5);
            add('craneArm',  STEEL, 6, 35, 19);
            add('craneCable', '#222222', 6, 27, 32);

            // Windowed warehouse on the shore (reuses the lit-window facade).
            const shed = new THREE.Mesh(this.geos.dockShed, this.houseMat);
            shed.position.set(-16, 6.5, -6);
            shed.receiveShadow = true;
            dock.add(shed);

            // Lighthouse with a glowing lamp room.
            add('lhBase', '#f4f4f4', 18, 12, -12);
            add('lhRoom', '#202830', 18, 26.5, -12);
            const lamp = new THREE.Mesh(this.geos.lhRoom, this._emissiveMat('__lhlamp', '#ffd34d'));
            lamp.scale.set(0.7, 0.45, 0.7);
            lamp.position.set(18, 26.5, -12);
            dock.add(lamp);
            add('lhRoof', '#b22222', 18, 31, -12);

            // Moored boats riding on the water beside the far deck.
            const boat = (x, z, ry) => {
                add('boatHull',  HULL,    x, -1, z, ry);
                add('boatCabin', '#dfe3e6', x, 3.5, z - 2, ry);
            };
            boat(-14, 95, 0.08);
            boat( 14, 80, -0.05);

            grp.add(dock);
        }

        // A roadside fuel station for city / village tiles: a forecourt canopy on
        // four pillars, two fuel pumps, a little shop and a lit price sign. Tucked
        // into a tile corner so it never blocks the central road corridor.
        _decorateGasStation(grp, wx, wy, spot, y) {
            const st = new THREE.Group();
            const sx = spot ? spot.x : (this._seededRandom(wx, wy, 71) < 0.5 ? -1 : 1) * 78;
            const sz = spot ? spot.z : (this._seededRandom(wx, wy, 72) < 0.5 ? -1 : 1) * 78;
            st.position.set(sx, y || 0, sz);
            st.rotation.y = spot ? spot.rot : this._seededRandom(wx, wy, 73) * Math.PI * 2;

            const add = (geoKey, colorOrMat, x, y, z) => {
                const mat = (colorOrMat && colorOrMat.isMaterial) ? colorOrMat : this._mat(colorOrMat);
                const m = new THREE.Mesh(this.geos[geoKey], mat);
                m.position.set(x, y, z);
                m.castShadow = false; m.receiveShadow = true;
                st.add(m);
                return m;
            };

            // Forecourt canopy on four pillars.
            add('gasCanopy', '#e8e8ee', 0, 16, 0);
            for (const px of [-18, 18]) for (const pz of [-9, 9]) add('gasPillar', '#c0392b', px, 8, pz);
            // Two fuel pumps under the canopy.
            add('gasPump', '#b23b3b', -6, 4, 0);
            add('gasPump', '#2f6fb0',  6, 4, 0);
            // Shop building (reuses the lit-window facade) + a tall glowing sign.
            const shop = new THREE.Mesh(this.geos.dockShed, this.houseMat);
            shop.position.set(0, 6.5, -22); shop.receiveShadow = true; st.add(shop);
            add('gasPillar', '#8a8f99', 26, 11, 0);
            add('gasSign', this._emissiveMat('__gassign', '#ffcf3d'), 26, 20, 0);

            grp.add(st);
        }

        // A building as a SHELL: four walls, a doorway in the side that faces
        // its street and a lintel over it. Hollow, because anything here can be
        // walked into once somebody is close enough for its inside to be built
        // (see BuildingInteriors). A ruin loses whole runs of wall and has the
        // rest of them broken off at odd heights.
        _buildShell(B, lot, y, mat, h) {
            const t = WALL_T;
            const span = _doorSpan(lot);
            const ruin = lot.ruined ? (lot.ruin || 0.3) : 0;
            const rnd = (i) => this._seededRandom(lot.x, lot.z, i);
            for (let side = 0; side < 4; side++) {
                const horizontal = side < 2;
                const along = horizontal ? lot.w : lot.d;
                const off   = (horizontal ? lot.d : lot.w) / 2 - t / 2;
                const sgn   = (side % 2 === 0) ? -1 : 1;
                if (ruin && rnd(side * 17 + 3) < ruin * 0.45) continue;   // that wall is gone
                const segs = (side === lot.side)
                    ? [[-along / 2, span[0]], [span[1], along / 2]]
                    : [[-along / 2, along / 2]];
                for (let si = 0; si < segs.length; si++) {
                    const [a, b] = segs[si];
                    if (b - a < 0.5) continue;
                    const c = (a + b) / 2, len = b - a;
                    // A standing ruin is broken off part-way up.
                    const wh = ruin ? h * (0.45 + rnd(side * 31 + si * 7 + 11) * 0.55) : h;
                    if (horizontal) B.add('uBox', mat, lot.x + c, y, lot.z + sgn * off, len, wh, t, 0);
                    else            B.add('uBox', mat, lot.x + sgn * off, y, lot.z + c, t, wh, len, 0);
                }
                // The wall carries on over the doorway.
                if (side === lot.side && (!ruin || rnd(side * 41 + 5) > ruin)) {
                    const c = (span[0] + span[1]) / 2, len = span[1] - span[0];
                    const lh = Math.max(0.5, (ruin ? h * 0.6 : h) - DOOR_H);
                    if (horizontal) B.add('uBox', mat, lot.x + c, y + DOOR_H, lot.z + sgn * off, len, lh, t, 0);
                    else            B.add('uBox', mat, lot.x + sgn * off, y + DOOR_H, lot.z + c, t, lh, len, 0);
                }
            }
        }

        // An abandoned structure on an empty square: a farmhouse with its roof
        // in, a barn, a chapel, a watchtower, a factory with its chimney still
        // standing. Planned the way a town is (see planAbandoned), so its walls
        // are solid, its inside is walkable and its door is a door.
        _decorateAbandoned(grp, wx, wy, heightFn) {
            const plan = planForTile(wx, wy);
            if (!plan || !plan.abandoned) return false;
            const lot = plan.lots[0];
            const ts = this._ts;
            const baseY = planBaseY(plan, wx, wy, heightFn || (() => 0));
            const B = new SettlementBatch(this);
            const stone = this._matStone();
            const wood  = this._matWood();

            // A levelled patch of ground under it, deep enough to bridge the
            // fall of the land on the downhill side.
            B.add('uBox', this._matSoil(), lot.x, baseY - 7, lot.z, lot.w + 10, 7, lot.d + 10, 0);

            const shellMat = lot.subkind === 'barn' || lot.subkind === 'motel' ? wood : stone;
            this._buildShell(B, lot, baseY, shellMat, lot.h);

            // What is left of the roof: a stub of the gable, or a slab with a
            // hole through it.
            const r = this._seededRandom(wx, wy, 8100);
            if (lot.gable) {
                if (r > 0.35) {
                    B.add('uPyr', this._matRuinRoof(), lot.x, baseY + lot.h, lot.z,
                        lot.w * (0.5 + r * 0.6), Math.min(lot.w, lot.d) * 0.4, lot.d * (0.5 + r * 0.6), 0);
                }
            } else if (r > 0.45) {
                B.add('uBox', this._matRuinRoof(), lot.x - lot.w * 0.15, baseY + lot.h, lot.z,
                    lot.w * 0.6, 1.4, lot.d * 0.85, 0);
            }
            if (lot.spire) {
                B.add('uPyr', this._matRuinRoof(), lot.x, baseY + lot.h,
                    lot.z + lot.d * 0.34, lot.w * 0.34, SETTLE.storeyH * 3, lot.w * 0.34, 0);
            }

            for (const p of plan.props) {
                switch (p.kind) {
                    case 'rubble':
                        B.add('uSph', stone, p.x, baseY - p.size * 0.3, p.z,
                            p.size * 2, p.size, p.size * 1.7, p.rot);
                        break;
                    case 'deadtree':
                        B.add('uCyl', this._matDeadWood(), p.x, baseY, p.z, 2.4, 14, 2.4, 0);
                        B.add('uCyl', this._matDeadWood(), p.x + 3, baseY + 11, p.z, 7, 1.2, 1.2, 0);
                        break;
                    case 'fence':
                        B.add('uBox', this._matDeadWood(), p.x, baseY + 1.6, p.z,
                            p.rot ? 0.5 : p.len, 0.6, p.rot ? p.len : 0.5, 0);
                        break;
                    case 'chimney':
                        B.add('uBox', stone, p.x, baseY, p.z, 9, p.h, 9, 0);
                        break;
                }
            }
            B.flush(grp);
            return true;
        }

        // A whole town, built from the plan (see planSettlement): a street grid
        // with pavements and kerbs, blocks of buildings that face their street,
        // courtyards and parks behind them, and the furniture that makes a street
        // a street. Everything is batched: one InstancedMesh per geometry and
        // material, so a dense town costs a dozen draw calls rather than a
        // thousand.
        _decorateSettlement(grp, wx, wy, big, heightFn) {
            const ts = this._ts;
            const plan = planSettlement(wx, wy, big, ts);
            // A town stands on its own level ground: the square's own height,
            // read once at the middle, rather than the blended corner heights
            // (which dip toward any bordering water and would drown half a
            // coastal town's buildings under the sea).
            const baseY = heightFn ? heightFn(wx + 0.5, wy + 0.5) : 0;
            const S = SETTLE;
            const PAVE = plan.paveH;    // pavement top above the ground (0 in a village)
            const ROAD = S.roadH;       // carriageway top above the ground
            const roadMat = plan.roadMat === 'dirt' ? this._matDirt() : this._matAsphalt();

            const B = new SettlementBatch(this);

            // --- the roads, whichever way they run ---------------------------
            for (const r of plan.roads) {
                if (r.axis === 'h') B.add('uBox', roadMat, 0, baseY, r.c, ts, ROAD, r.w, 0);
                else                B.add('uBox', roadMat, r.c, baseY, 0, r.w, ROAD, ts, 0);
                if (!plan.markings) continue;
                // Broken centre line down the middle of a made-up carriageway.
                for (let t = -ts / 2 + 8; t < ts / 2; t += 26) {
                    if (r.axis === 'h') B.add('uBox', this._matPaint(), t, baseY + ROAD, r.c, 12, 0.06, 0.9, 0);
                    else                B.add('uBox', this._matPaint(), r.c, baseY + ROAD, t, 0.9, 0.06, 12, 0);
                }
            }

            // --- pavements: one raised slab per block, kerbs come for free ---
            const sw2 = S.streetW / 2;
            for (let bi = 0; bi < plan.nb; bi++) {
                for (let bj = 0; bj < plan.nb; bj++) {
                    const x0 = plan.lines[bi] + sw2, x1 = plan.lines[bi + 1] - sw2;
                    const z0 = plan.lines[bj] + sw2, z1 = plan.lines[bj + 1] - sw2;
                    B.add('uBox', this._matPavement(), (x0 + x1) / 2, baseY, (z0 + z1) / 2,
                        x1 - x0, PAVE, z1 - z0, 0);
                }
            }

            // --- buildings ---------------------------------------------------
            const FRONT = [[0, -1], [0, 1], [-1, 0], [1, 0]];   // north, south, west, east
            for (const lot of plan.lots) {
                const facadeMat = lot.kind === 'church' ? this._matStone()
                    : this._facadeMat(lot.storeys);
                const h = lot.kind === 'church' ? lot.h + S.storeyH * 2 : lot.h;
                this._buildShell(B, lot, baseY + PAVE, facadeMat, h);

                // Blue over a shop, whatever shape the roof is.
                this._buildRoof(B, lot, baseY + PAVE + h, {
                    tile:  lot.shop ? this._matRoofShop() : this._matRoofTile(),
                    flat:  lot.shop ? this._matRoofShop() : this._matRoof(),
                    roof:  this._matRoof(),
                    metal: this._matMetal(),
                });

                if (lot.kind === 'church') {
                    B.add('uPyr', this._matRoofTile(), lot.x, baseY + PAVE + h,
                        lot.z, lot.w * 0.5, S.storeyH * 2.4, lot.d * 0.5, 0);
                }

                if (lot.shop) {
                    // The awning and the sign hang over the pavement the shop
                    // front actually faces.
                    const f = FRONT[lot.side];
                    const outX = f[0] * (lot.w * 0.5 + 2.2);
                    const outZ = f[1] * (lot.d * 0.5 + 2.2);
                    const awW = f[0] ? 4.5 : lot.w * 0.7;
                    const awD = f[0] ? lot.d * 0.7 : 4.5;
                    B.add('uBox', this._matAwning(), lot.x + outX, baseY + PAVE + 8.2,
                        lot.z + outZ, awW, 0.5, awD, 0);
                    B.add('uBox', this._emissiveMat('__shopsign', '#ffd98a'),
                        lot.x + outX * 1.1, baseY + PAVE + 9.4, lot.z + outZ * 1.1,
                        f[0] ? 0.6 : lot.w * 0.4, 2.2, f[0] ? lot.d * 0.4 : 0.6, 0);
                }
            }

            // --- street furniture --------------------------------------------
            for (const p of plan.props) {
                switch (p.kind) {
                    case 'lamp':
                        B.add('uCyl', this._matMetal(), p.x, baseY + PAVE, p.z, 1.1, 26, 1.1, 0);
                        B.add('uBox', this._getLampHeadMat(), p.x, baseY + PAVE + 25, p.z, 3.2, 1.4, 2, p.rot);
                        break;
                    case 'tree':
                        B.add('uCyl', this._matWood(), p.x, baseY + PAVE, p.z, 2.2, 11, 2.2, 0);
                        B.add('uSph', this._matLeaf(), p.x, baseY + PAVE + 10, p.z, 13, 13, 13, 0);
                        break;
                    case 'bench':
                        B.add('uBox', this._matWood(), p.x, baseY + PAVE + 2.2, p.z, 9, 0.8, 2.6, p.rot);
                        B.add('uBox', this._matWood(), p.x, baseY + PAVE, p.z, 8, 2.2, 0.8, p.rot);
                        break;
                    case 'bin':
                        B.add('uCyl', this._matMetal(), p.x, baseY + PAVE, p.z, 2.4, 3.6, 2.4, 0);
                        break;
                    case 'zebra':
                        for (let k = -2; k <= 2; k++) {
                            const ox = p.rot ? 0 : k * 3.4, oz = p.rot ? k * 3.4 : 0;
                            B.add('uBox', this._matPaint(), p.x + ox, baseY + ROAD, p.z + oz,
                                p.rot ? 7 : 2, 0.06, p.rot ? 2 : 7, 0);
                        }
                        break;
                    case 'signal':
                        B.add('uCyl', this._matMetal(), p.x, baseY + PAVE, p.z, 1, 18, 1, 0);
                        B.add('uBox', this._emissiveMat('__signal', '#ff5a3c'), p.x,
                            baseY + PAVE + 17, p.z, 1.6, 4, 1.6, p.rot);
                        break;
                    case 'car': {
                        const tint = ['#b23b3b', '#2f6fb0', '#e8e8ee', '#2d2d33', '#4a7d4a', '#c9a227'][p.tint % 6];
                        B.add('uBox', this._mat(tint), p.x, baseY + ROAD + 1.4, p.z, 7, 3, 15, p.rot);
                        B.add('uBox', this._matGlass(), p.x, baseY + ROAD + 4.2, p.z, 6, 2.6, 7.5, p.rot);
                        break;
                    }
                    case 'lawn':
                        B.add('uBox', this._matLawn(), p.x, baseY, p.z, p.w, PAVE + 0.1, p.d, 0);
                        break;
                    case 'tarmac':
                        B.add('uBox', this._matAsphalt(), p.x, baseY, p.z, p.w, PAVE + 0.05, p.d, 0);
                        break;
                    case 'yard':
                        B.add('uBox', big ? this._matPavement() : this._matLawn(),
                            p.x, baseY, p.z, p.w, PAVE + 0.12, p.d, 0);
                        break;
                    case 'green':
                    case 'garden':
                        B.add('uBox', this._matLawn(), p.x, baseY, p.z, p.w, 0.35, p.d, 0);
                        break;
                    case 'fence':
                        B.add('uBox', this._matWood(), p.x, baseY + 1.4, p.z,
                            p.rot ? 0.5 : p.len, 0.6, p.rot ? p.len : 0.5, 0);
                        B.add('uBox', this._matWood(), p.x, baseY + 2.6, p.z,
                            p.rot ? 0.5 : p.len, 0.6, p.rot ? p.len : 0.5, 0);
                        break;
                    case 'shed':
                        B.add('uBox', this._matWood(), p.x, baseY, p.z, 11, 7, 9, p.rot);
                        B.add('uPyr', this._matRoofTile(), p.x, baseY + 7, p.z, 12, 4, 10, p.rot);
                        break;
                    case 'well':
                        B.add('uCyl', this._matStone(), p.x, baseY, p.z, 8, 4.5, 8, 0);
                        B.add('uCyl', this._matWood(), p.x - 3, baseY + 4.5, p.z, 0.8, 8, 0.8, 0);
                        B.add('uCyl', this._matWood(), p.x + 3, baseY + 4.5, p.z, 0.8, 8, 0.8, 0);
                        B.add('uPyr', this._matRoofTile(), p.x, baseY + 12, p.z, 11, 4, 11, 0);
                        break;
                    case 'haystack':
                        B.add('uCyl', this._matHay(), p.x, baseY, p.z, 11, 9, 11, 0);
                        B.add('uPyr', this._matHay(), p.x, baseY + 9, p.z, 11, 5, 11, 0);
                        break;
                    case 'field': {
                        B.add('uBox', this._matSoil(), p.x, baseY, p.z, p.w, 0.3, p.d, 0);
                        // Crop rows, drilled the way the field was ploughed.
                        const rows = 9;
                        const step = (p.rot ? p.w : p.d) / rows;
                        for (let k = 0; k < rows; k++) {
                            const o = -((p.rot ? p.w : p.d) / 2) + step * (k + 0.5);
                            B.add('uBox', this._matCrop(p.crop),
                                p.x + (p.rot ? o : 0), baseY + 0.3, p.z + (p.rot ? 0 : o),
                                p.rot ? 2.2 : p.w * 0.94, 3.2, p.rot ? p.d * 0.94 : 2.2, 0);
                        }
                        break;
                    }
                    case 'pond':
                        B.add('uCyl', this._matWater(), p.x, baseY - 0.4, p.z, p.w, 0.8, p.d, 0);
                        B.add('uBox', this._matSoil(), p.x, baseY - 0.6, p.z, p.w + 8, 0.6, p.d + 8, 0);
                        break;
                    case 'fountain':
                        B.add('uCyl', this._matStone(), p.x, baseY + PAVE, p.z, 16, 2.4, 16, 0);
                        B.add('uCyl', this._matWater(), p.x, baseY + PAVE + 2.4, p.z, 14, 0.4, 14, 0);
                        B.add('uCyl', this._matStone(), p.x, baseY + PAVE + 2.4, p.z, 2.4, 7, 2.4, 0);
                        break;
                }
            }

            // The filling station on its own forecourt (a town square is where
            // the camper refuels, see _atGasStation).
            this._decorateGasStation(grp, wx, wy, plan.station, baseY + PAVE);

            B.flush(grp);
        }

        _emissiveMat(key, colorHex) {
            let m = this.matCache.get(key);
            if (!m) {
                m = new THREE.MeshLambertMaterial({
                    color: colorHex, emissive: new THREE.Color(colorHex), emissiveIntensity: 1.0
                });
                this.matCache.set(key, m);
            }
            return m;
        }

        // --- 2D billboard sprites (trees / plants / rocks) ---------------------
        // Cached texture for one pool sprite, path resolved through the furniture
        // index (see furnitureSpritePath).
        _loadFurnitureTex(folder, name) {
            const key = folder + '/' + name;
            let t = this._spriteTex.get(key);
            if (t) return t;
            t = new THREE.TextureLoader().load(furnitureSpritePath(folder, name));
            if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
            else if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
            this._spriteTex.set(key, t);
            return t;
        }

        // A camera-facing billboard material. The stock lit shader is patched so the
        // per-instance position (from instanceMatrix) is placed in view space and the
        // quad corners are added there, so the sprite always faces the camera; its
        // normal is forced toward the camera so it still dims with the sun / night.
        _billboardMat(folder, name) {
            const ck = 'bb:' + folder + '/' + name;
            let m = this.matCache.get(ck);
            if (m) return m;
            m = new THREE.MeshLambertMaterial({
                map: this._loadFurnitureTex(folder, name),
                transparent: true, alphaTest: 0.42, side: THREE.DoubleSide, depthWrite: true
            });
            m.onBeforeCompile = (shader) => {
                // i18n-ignore-start  GLSL shader source
                shader.vertexShader = shader.vertexShader
                    .replace('#include <project_vertex>', [
                        '#ifdef USE_INSTANCING',
                        '  vec3 bbCenter = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);',
                        '  float bbScale = length(vec3(instanceMatrix[0].x, instanceMatrix[0].y, instanceMatrix[0].z));',
                        '#else',
                        '  vec3 bbCenter = vec3(0.0); float bbScale = 1.0;',
                        '#endif',
                        'vec4 mvPosition = modelViewMatrix * vec4(bbCenter, 1.0);',
                        'mvPosition.xy += position.xy * bbScale;',
                        'gl_Position = projectionMatrix * mvPosition;'
                    ].join('\n'))
                    .replace('#include <defaultnormal_vertex>',
                        '#include <defaultnormal_vertex>\n\ttransformedNormal = vec3(0.0, 0.0, 1.0);');
                // i18n-ignore-end
            };
            m.customProgramCacheKey = () => 'camperBillboard';
            this.matCache.set(ck, m);
            return m;
        }

        // Scatters `items` as billboards, batched into one InstancedMesh per texture
        // (each tile deterministically draws from a small pool, so a stand of trees
        // reads as one or two draw calls). `quad` is the aspect-correct sprite quad.
        // `kind` is what the thing IS, for everything downstream: how wide it
        // stands (PROP_RADIUS), whether a vehicle goes through it or over it,
        // and which entry of the salvage table it answers to. Trees, rocks and
        // ground cover name themselves; everything else is a prop.
        _scatterBillboards(grp, folder, names, quad, items, size, wx, wy, seedBase, kind) {
            if (!items.length || !names.length) return;
            // Draw the whole tile's scatter from at most two textures (chosen per
            // tile) so a stand of trees is one or two InstancedMeshes, not dozens.
            const pick = (k) => names[Math.floor(this._seededRandom(wx, wy, seedBase + k) * names.length) % names.length];
            const nameA = pick(0), nameB = pick(1);
            const buckets = new Map();
            for (let i = 0; i < items.length; i++) {
                const name = (this._seededRandom(wx, wy, i * 5 + seedBase) < 0.5) ? nameA : nameB;
                let arr = buckets.get(name);
                if (!arr) { arr = []; buckets.set(name, arr); }
                arr.push(items[i]);
            }
            const dummy = new THREE.Object3D();
            // What the tile has standing on it, so a walker can be stopped by it,
            // a vehicle can knock it down and the party can take it apart. Kept
            // on the tile's own group, so it is disposed of with the chunk.
            const solid = kind ? (PROP_RADIUS[kind] || 0) : 0;
            if (!grp.userData.props) grp.userData.props = [];
            const props = grp.userData.props;
            const felled = VoxelWorldState;
            for (const [name, list] of buckets) {
                const im = new THREE.InstancedMesh(quad, this._billboardMat(folder, name), list.length);
                im.castShadow = false;
                im.receiveShadow = false;
                im.frustumCulled = false;
                for (let i = 0; i < list.length; i++) {
                    const p = list[i];
                    // Something already cut down stays cut down: it is drawn at
                    // nothing rather than skipped, so the instance indices still
                    // line up with the list.
                    const key = p.key ? (wx + ',' + wy + ':' + p.key) : null;
                    const gone = !!(key && felled && felled.isFelled(key));
                    dummy.position.set(p.x, p.y, p.z);
                    dummy.quaternion.set(0, 0, 0, 1);
                    dummy.scale.setScalar(gone ? 0 : size * (p.scale || 1));
                    dummy.updateMatrix();
                    im.setMatrixAt(i, dummy.matrix);
                    if (solid > 0 && !gone) {
                        props.push({
                            x: p.x, z: p.z, y: p.y,
                            r: Math.max(PROP_MIN_R, size * (p.scale || 1) * solid),
                            kind, key, folder, name, mesh: im, index: i,
                        });
                    }
                }
                grp.add(im);
            }
        }

        // Scatters one hand-picked category. A square draws its whole scatter
        // from ONE of the picked folders, chosen by the square itself, so a list
        // of forty sprites still costs a stand of trees rather than forty
        // instanced meshes, and the next square over reads differently.
        // `size` of 0 means "whatever a piece of that folder measures", read off
        // the furniture catalogue; `kind` of null means "a plant if the folder
        // is greenery, a prop otherwise".
        _scatterPicked(grp, groups, quad, items, wx, wy, seedBase, kind, size) {
            if (!groups.length || !items.length) return;
            const pick = Math.floor(this._seededRandom(wx, wy, seedBase + 7) * groups.length);
            const g = groups[Math.min(pick, groups.length - 1)];
            if (!g.sprites.length) return;
            const cats = (BiomeFurniture.map() || {}).categories || {};
            const sz = size || (cats[g.folder] && cats[g.folder].size) || 11;
            const k  = kind || (PLANT_FOLDERS.test(g.folder) ? 'plant' : 'prop');
            this._scatterBillboards(grp, g.folder, g.sprites, quad, items, sz, wx, wy, seedBase, k);
        }

        // The props of a place: whatever the picker named for this biome, or
        // else the biome's own furniture folders. Naming props by hand replaces
        // the folder scatter outright, so a biome can be furnished with four
        // chosen things instead of whatever its folders happen to hold.
        _scatterFurniture(grp, wx, wy, biome, genItems, baseCount, skip, seedBase) {
            const picked = BiomeSprites.groups(biome.name, 'prop');
            if (!picked) return this._scatterBiomeFurniture(grp, wx, wy, biome, genItems, baseCount, skip);
            this._scatterPicked(grp, picked, this.spriteQuads.plant,
                genItems(Math.max(1, Math.round(baseCount * 0.5)), seedBase), wx, wy, seedBase, null, 0);
        }

        // Everything else that belongs out here: the signs and bins of a street,
        // the fences and barrels of a village, the graves of a boneyard, the
        // coral of a sea floor. Read off the biome's own list
        // (js/db/WorldGen/biomeFurniture.json) rather than written into this
        // file, so adding a folder of art is all it takes to see it in the
        // world.
        //
        // Only a FEW of a biome's folders are drawn on any one square, picked by
        // that square: a city has forty kinds of thing that could stand on it
        // and putting all forty on every block would be a scrapyard, while
        // picking three or four gives a street its own character and the next
        // street a different one. Each folder drawn is one instanced mesh.
        _scatterBiomeFurniture(grp, wx, wy, biome, genItems, baseCount, skip) {
            const list = BiomeFurniture.exterior(biome.name);
            if (!list.length) return;
            // Trees, plants and rocks are already scattered from their own
            // curated pools just above; drawing them twice would double a wood.
            const pool = list.filter(e => !skip.has(e.folder));
            if (!pool.length) return;

            const total = pool.reduce((sum, e) => sum + e.density, 0);
            if (total <= 0) return;
            const PICKS = 3;
            const chosen = new Map();
            for (let k = 0; k < PICKS; k++) {
                // Weighted by density, so what a place is mostly made of turns up
                // most often without ever being the only thing there.
                let r = this._seededRandom(wx, wy, 6100 + k) * total;
                for (const e of pool) {
                    r -= e.density;
                    if (r <= 0) { chosen.set(e.folder, e); break; }
                }
            }
            let seed = 6200;
            for (const e of chosen.values()) {
                const count = Math.max(1, Math.round(baseCount * e.density * 0.5));
                // Everything a biome is furnished with is a thing in the way
                // too: a barrel, a gravestone, a crate. Ground cover among them
                // stops nobody - PROP_RADIUS decides which is which.
                this._scatterBillboards(grp, e.folder, e.sprites, this.spriteQuads.plant,
                    genItems(count, seed), e.size, wx, wy, seed, PLANT_FOLDERS.test(e.folder) ? 'plant' : 'prop');
                seed += 40;
            }
        }

        // Which Trees pool (if any) suits a biome; null = no billboard trees.
        _treePoolFor(n) {
            if (/ice|snow|frost|tundra|glacier|arctic|permafrost/.test(n)) return TREE_POOLS.snow;
            if (/taiga|pine|spruce|conifer/.test(n))                       return TREE_POOLS.conifer;
            if (/tropical|jungle|mangrove|rainforest/.test(n))             return TREE_POOLS.jungle;
            if (/swamp|marsh|riverbank|bog|mire|landfill/.test(n))         return TREE_POOLS.dead;
            if (/graveyard|crypt|haunt|cursed|dead/.test(n))               return TREE_POOLS.dead;
            if (/sakura|cherry|fairy|blossom/.test(n))                     return TREE_POOLS.sakura;
            if (/savannah|steppe|highland|meadow|farm|fields|orchard/.test(n)) return TREE_POOLS.fruit;
            if (/forest|wood|park|grove/.test(n))                          return TREE_POOLS.broadleaf;
            return null;
        }

        // Which Plants pool (if any) to scatter as low ground cover.
        _plantPoolFor(n) {
            if (/farm|fields|meadow|crop|orchard|pasture/.test(n)) return PLANT_CROPS;
            if (/grass|forest|wood|park|grove|savannah|steppe|highland|swamp|marsh|jungle|tropical|fairy|plain|prairie|hills/.test(n))
                return PLANT_POOL;
            return null;
        }

        // Which Rocks pool (if any) to scatter; null = no rocks.
        _rockPoolFor(n) {
            if (/volcano|lava|magma|hell|ash|scorch|ember/.test(n)) return ROCK_ASH;
            if (/desert|badland|canyon|mesa|dune|saltflat|mountain|rock|rocky|highland|tundra|steppe|ruin|crystal|cave|quarry/.test(n))
                return ROCK_POOL;
            return null;
        }

        // Picks the 3D STRUCTURAL prop set for a biome (buildings and hard-surface
        // features only). Trees, plants and rocks are no longer 3D here - they are
        // scattered as 2D billboards in decorate(). Returns null when a biome has no
        // 3D structures (pure vegetation / rock biomes are handled by billboards).
        // Layers: { g: geometryKey, c: colourHex } (or mat: Material), optional
        // scale multiplier. `mix` alternates the two layers; `density` scales count.
        _archetypeFor(n) {
            // Built-up: dense towers (cities) or windowed houses with roofs.
            if (n.includes('city') || n.includes('metro') || n.includes('omegatower') || n.includes('spacecenter'))
                return { l1: { g: 'skyscraper', mat: this.skyscraperMat } };
            if (n.includes('burg') || n.includes('village') || n.includes('villa') || n.includes('houses') ||
                n.includes('town') || n.includes('factory') || n.includes('office') || n.includes('docks') ||
                n.includes('laboratory'))
                return { l1: { g: 'houseBase', mat: this.houseMat }, l2: { g: 'houseRoof', c: '#8b0000' } };

            // Volcanic / infernal: dark spires (rocks added as billboards).
            if (n.includes('volcano') || n.includes('lava') || n.includes('magma') || n.includes('hell'))
                return { l1: { g: 'spire', c: '#2a1818' }, density: 0.6 };

            if (n.includes('crystal'))
                return { l1: { g: 'crystal', c: '#00ced1' }, density: 0.7 };

            if (n.includes('mushroom') || n.includes('fungal') || n.includes('mycel'))
                return { l1: { g: 'mushStem', c: '#e8e0d0' }, l2: { g: 'mushCap', c: '#9370db' } };

            if (n.includes('bamboo'))
                return { l1: { g: 'bamboo', c: '#7d9a3f' } };

            // Tropical / wetland palms (shoreline palms are added separately).
            if (n.includes('tropical') || n.includes('jungle') || n.includes('mangrove'))
                return { l1: { g: 'palmTrunk', c: '#8a6d3b' }, l2: { g: 'palmCrown', c: '#3cb043' }, density: 0.6 };

            // Spooky: graveyards get tombstones; ruins/temples get broken columns.
            if (n.includes('graveyard') || n.includes('crypt') || n.includes('tomb') || n.includes('haunt'))
                return { l1: { g: 'tomb', c: '#9a9a9a' }, density: 0.7 };
            if (n.includes('ruin') || n.includes('temple') || n.includes('castle') || n.includes('ancient'))
                return { l1: { g: 'column', c: '#bdb76b' }, density: 0.7 };

            // Arid: cactus (rocks added as billboards).
            if (n.includes('desert') || n.includes('badland') || n.includes('canyon') ||
                n.includes('saltflat') || n.includes('dune') || n.includes('mesa'))
                return { l1: { g: 'cactus', c: '#2e8b57' }, density: 0.6 };

            return null;
        }

        decorate(grp, wx, wy, biome, tileSize, heightFn) {
            const n = biome.name.toLowerCase();

            // Coastlines get sparse palms regardless of the land biome archetype.
            this._decorateBeach(grp, wx, wy, tileSize, heightFn);

            // Harbours get a full hand-built dock scene instead of scattered models.
            if (n.includes('docks') || n.includes('harbor') || n.includes('harbour') ||
                n.includes('wharf') || n.includes('pier') || n.includes('marina')) {
                this._decorateDocks(grp, wx, wy);
                return;
            }

            // Cities / towns / villages: a proper dense street grid of buildings
            // plus a roadside fuel station, instead of a sparse random scatter.
            const isCity = n.includes('city') || n.includes('metro') ||
                           n.includes('omegatower') || n.includes('spacecenter');
            const isTown = n.includes('village') || n.includes('villa') ||
                           n.includes('burg') || n.includes('town') || n.includes('houses');
            if (isCity || isTown) {
                this._decorateSettlement(grp, wx, wy, isCity, heightFn);
                // A street is not bare either: the signs, bins, benches, crates
                // and parked bicycles of the place go down between the buildings.
                const townCount = 8 + Math.floor(this._seededRandom(wx, wy, 61) * 8);
                this._scatterFurniture(grp, wx, wy, biome,
                    this._townItemGen(wx, wy, tileSize, heightFn), townCount, SKIP_CURATED, 6500);
                return;   // the town fills the tile; skip the wilderness scatter
            }

            // A ruin out in the country, before the wilderness scatter goes
            // round it (a tree growing through a roofless barn is the point).
            this._decorateAbandoned(grp, wx, wy, heightFn);

            // Base scatter count from the biome's feature density.
            const baseDensity = biome.features ? biome.features.reduce((sum, f) => sum + (f.density || 0), 0) : 2;
            const baseCount = Math.floor(this._seededRandom(wx, wy, 0) * 10 * baseDensity) + 5;

            // Deterministic placement generator. Spreads `count` points across the
            // tile, keeping a central corridor clear so the camper has a lane, and
            // rejecting points that fall underwater / on steep beach slopes.
            const corridor = tileSize * 0.06;
            const genItems = (count, seed) => {
                const out = [];
                for (let i = 0; i < count; i++) {
                    const lx = (this._seededRandom(wx, wy, i * 4 + seed)     - 0.5) * (tileSize * 0.9);
                    const lz = (this._seededRandom(wx, wy, i * 4 + seed + 1) - 0.5) * (tileSize * 0.9);
                    if (Math.abs(lx) < corridor && Math.abs(lz) < corridor) continue;
                    const yPos = heightFn ? heightFn(wx + 0.5 + lx / tileSize, wy + 0.5 + lz / tileSize) : 0;
                    if (yPos < -0.5) continue;
                    const scale = 0.6 + this._seededRandom(wx, wy, i * 4 + seed + 2) * 0.75;
                    const rotY  = this._seededRandom(wx, wy, i * 4 + seed + 3) * Math.PI * 2;
                    // Its own name, stable for as long as the world is: the
                    // group it was scattered in and where in that group it came.
                    // A tree cut down is remembered by this and by nothing else.
                    out.push({ x: lx, y: yPos, z: lz, rotY, scale, key: seed + ':' + i });
                }
                return out;
            };

            // --- 3D structural props (buildings, cactus, ruins, etc.) ---
            const arch = this._archetypeFor(n);
            if (arch) {
                let count = baseCount;
                if (arch.density != null) count = Math.round(count * arch.density);
                const items = genItems(count, 1);
                const place = (layer) => {
                    if (!layer || !items.length) return;
                    const s = layer.scale || 1;
                    const list = s === 1 ? items : items.map(p => ({ ...p, scale: p.scale * s }));
                    this._instance(grp, this.geos[layer.g], layer.mat || layer.c, list);
                };
                place(arch.l1);
                place(arch.l2);
            }

            // --- 2D billboard trees (sized to match the 1x 3D props: ~40 tall) ---
            // A hand-picked list wins over the name tables, and a hand-picked
            // EMPTY list means this biome is meant to be bare of them.
            const treePicked = BiomeSprites.groups(biome.name, 'tree');
            const treePool   = treePicked ? null : this._treePoolFor(n);
            if (treePicked) {
                this._scatterPicked(grp, treePicked, this.spriteQuads.tree,
                    genItems(Math.round(baseCount * 1.2), 40), wx, wy, 313, 'tree', 30);
            } else if (treePool) {
                this._scatterBillboards(grp, 'Trees', treePool, this.spriteQuads.tree,  // i18n-ignore  scatter group id
                    genItems(Math.round(baseCount * 1.2), 40), 30, wx, wy, 313, 'tree');
            }
            const hasTrees = treePicked ? treePicked.length > 0 : !!treePool;

            // --- 2D billboard plants / ground cover ---
            const plantPicked = BiomeSprites.groups(biome.name, 'plant');
            const plantPool   = plantPicked ? null : this._plantPoolFor(n);
            if (plantPicked) {
                this._scatterPicked(grp, plantPicked, this.spriteQuads.plant,
                    genItems(Math.round(baseCount * 0.9), 200), wx, wy, 517, 'plant', 11);
            } else if (plantPool) {
                this._scatterBillboards(grp, 'Plants', plantPool, this.spriteQuads.plant,  // i18n-ignore  scatter group id
                    genItems(Math.round(baseCount * 0.9), 200), 11, wx, wy, 517, 'plant');
            }

            // --- 2D billboard rocks ---
            const rockPicked = BiomeSprites.groups(biome.name, 'rock');
            if (rockPicked) {
                this._scatterPicked(grp, rockPicked, this.spriteQuads.rock,
                    genItems(Math.round(baseCount * 0.7), 900), wx, wy, 733, 'rock', 13);
            } else {
                let rockPool = this._rockPoolFor(n);
                // Nothing else claimed this tile? Sprinkle sparse rocks so it isn't barren.
                const sparse = !rockPool && !arch && !hasTrees;
                if (sparse) rockPool = ROCK_POOL;
                if (rockPool) {
                    const rc = Math.round(baseCount * (sparse ? 0.4 : 0.7));
                    this._scatterBillboards(grp, 'Rocks', rockPool, this.spriteQuads.rock,  // i18n-ignore  scatter group id
                        genItems(rc, 900), 13, wx, wy, 733, 'rock');
                }
            }

            // --- and everything else this biome is furnished with ---
            this._scatterFurniture(grp, wx, wy, biome, genItems, baseCount, SKIP_CURATED, 6300);
        }

        // Where a prop may stand in a town: off the buildings' own footprints is
        // the planner's business, so this only keeps them out of the middle of
        // the square where the through road runs.
        _townItemGen(wx, wy, tileSize, heightFn) {
            return (count, seed) => {
                const out = [];
                for (let i = 0; i < count; i++) {
                    const lx = (this._seededRandom(wx, wy, i * 4 + seed)     - 0.5) * (tileSize * 0.86);
                    const lz = (this._seededRandom(wx, wy, i * 4 + seed + 1) - 0.5) * (tileSize * 0.86);
                    const yPos = heightFn ? heightFn(wx + 0.5 + lx / tileSize, wy + 0.5 + lz / tileSize) : 0;
                    if (yPos < -0.5) continue;
                    out.push({
                        x: lx, y: yPos, z: lz,
                        rotY: this._seededRandom(wx, wy, i * 4 + seed + 3) * Math.PI * 2,
                        scale: 0.8 + this._seededRandom(wx, wy, i * 4 + seed + 2) * 0.5,
                        key: seed + ':' + i
                    });
                }
                return out;
            };
        }

        dispose() {
            for (const key in this.geos) {
                this.geos[key].dispose();
            }
            if (this.spriteQuads) for (const k in this.spriteQuads) this.spriteQuads[k].dispose();
            if (this._spriteTex) { for (const t of this._spriteTex.values()) t.dispose(); this._spriteTex.clear(); }
            [this.skyscraperMat, this.houseMat].forEach(m => {
                if (!m) return;
                if (m.map) m.map.dispose();
                if (m.emissiveMap) m.emissiveMap.dispose();
                m.dispose();
            });
        }
    }

    // =========================================================================
    // The Omega Tower
    //
    // Six world squares by six of black stone and gold going up nearly five
    // kilometres. It is not a building the town planner could make - it is
    // bigger than any town - and it is not terrain, so it is neither chunked
    // nor streamed: it is built once, stood in the world, and drawn from
    // wherever the party happens to be (see the scene's _updateOmegaTower,
    // which is what makes it visible from the far side of the map).
    //
    // THE SHAPE. Not a shaft: a HEAP. The tower is a stack of DECKS, and every
    // deck is a whole art deco skyline in its own right - four to seven
    // separate skyscrapers of different footprints and different heights,
    // standing on a plate that is itself smaller and turned a few degrees off
    // the one below it. The towers of a deck are kept out of the footprint of
    // the deck above, so the tall ones push straight past its edge and stand
    // clear against the sky: from below the whole thing reads as a city that
    // kept being built on top of itself, not as a wedding cake.
    //
    // THE STYLE is 1930. Every shaft is fluted with gold piers running its
    // full height, capped with a stepped ziggurat crown of two setbacks, banded
    // in gold at every parapet, and friezed with a chevron of alternating gold
    // blocks. Some towers carry a sunburst crest. The crown of the whole thing
    // is a needle: stacked gold rings narrowing to a spike.
    //
    // THE GOLD BURNS AT NIGHT. All of it is one emissive material and the
    // scene turns its intensity up as the light goes (setNightGlow, driven by
    // the day factor), so at dusk the piers, the bands and the crest come up
    // like a lit skyline and the tower is at its most visible exactly when
    // there is least else to see by.
    //
    // It is seeded, so it is the same tower every time anybody comes back.
    // =========================================================================
    // Folders of a biome's furniture that are ground cover rather than things
    // in the way: you walk through grass and flowers, not round them.
    const PLANT_FOLDERS = /grass|flower|plant|weed|moss|lichen|fern|reed|clover|leaf|leaves|shrub|ivy|vine|crop|wheat|hay/i;

    const OMEGA_BLACK = 0x111014;
    const OMEGA_STONE = 0x1b1a21;   // the second stone, so the heap is not one mass
    const OMEGA_GOLD  = 0xd9a441;
    // What the gold is lit from within by at noon and at midnight. The scene
    // slides between the two every frame off its own day factor.
    const OMEGA_GLOW_DAY   = 0.10;
    const OMEGA_GLOW_NIGHT = 1.00;

    function omegaRnd(i) {
        // Its own stream, and a fixed one: this is a landmark, not scenery.
        const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        return h - Math.floor(h);
    }

    // How much of the tower's height is the gold needle on top of it.
    const SPIRE_FRAC = 0.11;

    // The plan, as plain numbers, worked out once and kept so the geometry and
    // anything that wants to measure the thing agree:
    //
    //   decks[]  { y, plateH, half, x, z, rot, towers[] }  the plate and its skyline
    //   towers[] { x, z, w, d, h, rot, crest }             one skyscraper on it
    //
    // x/z are offsets from the middle of the footprint, before the deck's own
    // rotation; y is the top of the plate the towers stand on.
    let _omegaPlan = null;
    function omegaTowerPlan(span, height) {
        if (_omegaPlan) return _omegaPlan;
        const base = span * WORLD_TILE_SIZE;      // 3000 units across at the foot
        const spire = height * SPIRE_FRAC;
        const body  = height - spire;             // everything below the needle

        // A deck roughly every hundred and fifty metres, so the heap stays a
        // heap however tall the thing is asked to be.
        const decks = Math.max(14, Math.min(30, Math.round(height / 640)));
        // How much of the footprint the last plate keeps. Spread over however
        // many decks there are rather than fixed per step, or a tall tower
        // tapers to a needle a third of the way up.
        const TOP_FRAC = 0.135;
        const shrink = Math.pow(TOP_FRAC, 1 / Math.max(1, decks - 1));

        const out = [];
        let half = base / 2, cx = 0, cz = 0, rot = 0, y = 0;
        for (let i = 0; i < decks; i++) {
            const t = i / (decks - 1);
            const nextHalf = half * shrink * (0.94 + omegaRnd(i * 13 + 3) * 0.12);
            // The plate. Thin at the bottom where the towers do the work, and
            // thicker up top where it is most of what is left of the tower.
            const plateH = body * (0.006 + 0.012 * t);
            // How far up the next plate sits. Less than the towers of this deck
            // are tall, which is what makes the tall ones break its edge.
            const rise = body * (0.028 + 0.052 * t) * (0.82 + omegaRnd(i * 7 + 2) * 0.4);

            // The skyline of this deck. Towers go in the band between the edge
            // of the next plate and the edge of this one, so nothing of theirs
            // is buried under the deck above except deliberately.
            const inner = Math.min(nextHalf * 1.04, half * 0.86);
            const count = 4 + Math.floor(omegaRnd(i * 41 + 19) * 4);   // 4..7
            const towers = [];
            for (let j = 0; j < count; j++) {
                const s = i * 97 + j * 11;
                // A point in the square annulus [inner, half]: pick the side,
                // then how far along it and how far out into the band.
                const side = Math.floor(omegaRnd(s + 1) * 4);
                const out1 = inner + (half - inner) * (0.28 + omegaRnd(s + 2) * 0.68);
                const along = (omegaRnd(s + 3) * 2 - 1) * out1;
                let tx, tz;
                if (side === 0)      { tx =  out1; tz = along; }
                else if (side === 1) { tx = -out1; tz = along; }
                else if (side === 2) { tx = along; tz =  out1; }
                else                 { tx = along; tz = -out1; }
                // Footprint: a slice of the band, never wider than the room it
                // has, so towers of one deck do not grow through one another.
                const room = Math.max(40, half - inner);
                const w = room * (0.42 + omegaRnd(s + 4) * 0.5);
                const d = w * (0.7 + omegaRnd(s + 5) * 0.6);
                // Height: most clear the plate above, some by a long way. The
                // outermost ones are the tallest, which keeps the silhouette
                // ragged rather than domed.
                const reach = 0.55 + (out1 / half) * 1.35 + omegaRnd(s + 6) * 1.25;
                towers.push({
                    x: tx, z: tz, w, d,
                    h: rise * reach,
                    rot: (omegaRnd(s + 7) - 0.5) * 0.5,
                    crest: omegaRnd(s + 8) < 0.28,
                });
            }
            // The deck's own tower: one shaft on the middle of the plate,
            // holding the stack together where the ring would leave a hole.
            towers.push({
                x: 0, z: 0,
                w: inner * 1.15, d: inner * (0.9 + omegaRnd(i * 53 + 7) * 0.4),
                h: rise * (1.02 + omegaRnd(i * 59 + 11) * 0.3),
                rot: (omegaRnd(i * 61 + 13) - 0.5) * 0.3,
                crest: false,
            });

            out.push({ y, plateH, half, x: cx, z: cz, rot, towers });

            y += rise;
            // The next plate is smaller, turned, and shouldered off to one side
            // - which is the whole difference between a heap and a pyramid.
            if (omegaRnd(i * 19 + 7) < 0.72) {
                cx += (omegaRnd(i * 23 + 11) - 0.5) * (half - nextHalf) * 1.1;
                cz += (omegaRnd(i * 29 + 13) - 0.5) * (half - nextHalf) * 1.1;
            }
            rot += (omegaRnd(i * 31 + 17) - 0.5) * 0.36;
            half = nextHalf;
        }

        // The rises above are proportions, not measurements, so the stack lands
        // wherever it lands. Scale it so the tip of the needle is at exactly
        // the height it was asked for: OMEGA_HEIGHT is how tall the tower IS,
        // and the scene, the plinth and anything else that measures it all read
        // that one number.
        const k = body / Math.max(1, y);
        for (const dk of out) {
            dk.y *= k; dk.plateH *= k;
            for (const tw of dk.towers) tw.h *= k;
        }
        y *= k;
        const last = out[out.length - 1];
        _omegaPlan = { decks: out, top: y, spire, tip: y + spire, base, crown: last };
        return _omegaPlan;
    }

    // The tower as a group standing on y = 0, ready to be put wherever the
    // scene wants it.
    //
    // EVERYTHING IS INSTANCED. A heap of a hundred and fifty skyscrapers, each
    // fluted, banded, friezed and crowned, is some thousands of pieces; drawn
    // as meshes that is thousands of draw calls for one landmark, every frame,
    // from anywhere on the map. So the whole thing is gathered into four lists
    // by (shape, material) and issued as four InstancedMeshes. Adding a piece
    // costs an entry in an array.
    //
    // Every material has its fog turned off: a landmark meant to be seen from
    // the far side of the world cannot be allowed to fade into the haze at four
    // thousand units like a hedge.
    function buildOmegaTower(span, height) {
        const plan = omegaTowerPlan(span, height);
        const group = new THREE.Group();
        const geos = [], mats = [];

        const mat = (hex, opts) => {
            const m = new THREE.MeshLambertMaterial(Object.assign({ color: hex }, opts || {}));
            m.fog = false;
            mats.push(m);
            return m;
        };
        const stoneA = mat(OMEGA_BLACK);
        const stoneB = mat(OMEGA_STONE);
        // The gold is lit from within as well as from the sky, so it still reads
        // at night and at distance, which is when this thing matters most. The
        // scene drives the intensity (see setNightGlow below).
        const gold = mat(OMEGA_GOLD, { emissive: 0xffb347, emissiveIntensity: OMEGA_GLOW_DAY });

        // Unit shapes, pivoted on their base, scaled per instance.
        const uBox  = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
        const uCone = new THREE.CylinderGeometry(0, 0.5, 1, 6).translate(0, 0.5, 0);
        geos.push(uBox, uCone);

        // One bucket per (shape, material). An entry is a full transform, so a
        // chevron block turned on its nose costs exactly what a shaft costs.
        const buckets = [
            { geo: uBox,  mat: stoneA, list: [] },
            { geo: uBox,  mat: stoneB, list: [] },
            { geo: uBox,  mat: gold,   list: [] },
            { geo: uCone, mat: gold,   list: [] },
        ];
        const BOX_A = buckets[0].list, BOX_B = buckets[1].list;
        const BOX_G = buckets[2].list, CONE_G = buckets[3].list;
        // x,y,z = where the base of the piece sits; w,h,d = how big; ry/rz = turn.
        const put = (list, x, y, z, w, h, d, ry, rz) => {
            list.push({ x, y, z, w, h, d, ry: ry || 0, rz: rz || 0 });
        };

        // ---------------------------------------------------------------------
        // One art deco skyscraper, in the deck's own frame of reference.
        // ---------------------------------------------------------------------
        function skyscraper(tw, deck, baseY, seed) {
            const c = Math.cos(deck.rot), s = Math.sin(deck.rot);
            const x = deck.x + tw.x * c - tw.z * s;
            const z = deck.z + tw.x * s + tw.z * c;
            const ry = deck.rot + tw.rot;
            const cy = Math.cos(ry), sy2 = Math.sin(ry);
            const shaftMat = (omegaRnd(seed) < 0.5) ? BOX_A : BOX_B;

            // THE SHAFT, and the two setbacks of its crown. Deco towers do not
            // stop, they step: each step keeps most of the height and loses a
            // fifth of the plan, and every one of them is banded in gold.
            let w = tw.w, d = tw.d, y = baseY, left = tw.h;
            const STEPS = 3;
            for (let k = 0; k < STEPS; k++) {
                // The shaft is most of it; the two crown steps share the rest.
                const h = (k === 0) ? left * 0.76 : (k === 1 ? left * 0.62 : left);
                put(shaftMat, x, y, z, w, h, d, ry);

                // Gold piers up the full face of this step, four to a side. The
                // flute is what makes a black box read as 1930 rather than as a
                // slab, so it goes on every step, not just the shaft.
                const pierW = Math.max(1.2, w * 0.045);
                const pierD = Math.max(1.2, d * 0.045);
                for (const f of [-0.34, -0.12, 0.12, 0.34]) {
                    const lx = w * f;
                    put(BOX_G, x + lx * cy, y, z + lx * sy2,
                        pierW, h * 0.985, d * 1.012, ry);
                }
                for (const f of [-0.3, 0.3]) {
                    const lz = d * f;
                    put(BOX_G, x - lz * sy2, y, z + lz * cy,
                        w * 1.012, h * 0.985, pierD, ry);
                }

                // The parapet band, standing proud of the step under it so it
                // catches the light along its whole edge.
                const bandH = Math.max(2.5, h * 0.045);
                put(BOX_G, x, y + h - bandH, z, w * 1.06, bandH, d * 1.06, ry);

                // ...and the chevron frieze under it: gold blocks alternating
                // long and short along the two long faces, which at any
                // distance reads as the zigzag it is standing in for.
                const teeth = 6;
                const toothW = w / (teeth * 1.9);
                const fh = bandH * 1.7;
                for (let n = 0; n < teeth; n++) {
                    const f = (n / (teeth - 1) - 0.5) * 0.86;
                    const tall = (n % 2 === 0) ? 1 : 0.5;
                    for (const sd of [-0.5, 0.5]) {
                        const lx = w * f, lz = d * sd;
                        put(BOX_G,
                            x + lx * cy - lz * sy2,
                            y + h - bandH - fh * tall,
                            z + lx * sy2 + lz * cy,
                            toothW, fh * tall, Math.max(1, d * 0.03), ry);
                    }
                }

                y += h;
                left -= h;
                w *= 0.78; d *= 0.78;
                if (left <= 0) break;
            }

            // A sunburst crest on the ones that carry one: a fan of thin gold
            // blades leaning off the crown, the deco signature.
            if (tw.crest) {
                const blades = 7;
                const bl = Math.min(tw.h * 0.18, w * 2.6);
                for (let n = 0; n < blades; n++) {
                    const a = (n / (blades - 1) - 0.5) * 1.5;
                    put(BOX_G, x, y, z, Math.max(0.8, w * 0.06), bl, Math.max(0.8, d * 0.06),
                        ry, a);
                }
                put(CONE_G, x, y, z, w * 0.5, bl * 0.55, d * 0.5, ry);
            } else if (omegaRnd(seed + 3) < 0.45) {
                // ...or a plain mast, so the skyline is not all one note.
                put(CONE_G, x, y, z, w * 0.34, tw.h * 0.1, d * 0.34, ry);
            }
        }

        // ---------------------------------------------------------------------
        // The heap
        // ---------------------------------------------------------------------
        for (let i = 0; i < plan.decks.length; i++) {
            const dk = plan.decks[i];
            const side = dk.half * 2;
            // The plate itself, and the gold rim round its edge: from below
            // that rim is the line that says where one deck ends and the next
            // city begins.
            put(BOX_A, dk.x, dk.y - dk.plateH, dk.z, side, dk.plateH, side, dk.rot);
            const rimH = Math.max(3, dk.plateH * 0.34);
            put(BOX_G, dk.x, dk.y - rimH, dk.z, side * 1.035, rimH, side * 1.035, dk.rot);
            // Corner piers: four stepped gold pylons standing on the corners of
            // the plate, which is how a deco setback is always finished.
            const pw = Math.max(4, dk.half * 0.075);
            const ph = dk.plateH * 3.2;
            const cd = Math.cos(dk.rot), sd2 = Math.sin(dk.rot);
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                const lx = sx * dk.half * 0.94, lz = sz * dk.half * 0.94;
                const px = dk.x + lx * cd - lz * sd2;
                const pz = dk.z + lx * sd2 + lz * cd;
                put(BOX_G, px, dk.y, pz, pw, ph, pw, dk.rot);
                put(CONE_G, px, dk.y + ph, pz, pw * 1.4, ph * 0.7, pw * 1.4, dk.rot);
            }
            for (let j = 0; j < dk.towers.length; j++) {
                skyscraper(dk.towers[j], dk, dk.y, i * 131 + j * 17 + 5);
            }
        }

        // ---------------------------------------------------------------------
        // The needle
        // ---------------------------------------------------------------------
        // Stacked gold rings narrowing to a spike, standing on the last plate:
        // the one piece of the tower nothing else on the world can be mistaken
        // for, and the reason it can be found from horizon distance.
        const crown = plan.crown;
        const spireH = plan.spire;
        const RINGS = 6;
        let sy = plan.top, sw = crown.half * 0.9;
        for (let r = 0; r < RINGS; r++) {
            const h = spireH * 0.07 * (1 - r / (RINGS + 2));
            put(BOX_G, crown.x, sy, crown.z, sw, h, sw, crown.rot + r * 0.18);
            sy += h;
            sw *= 0.72;
        }
        put(CONE_G, crown.x, sy, crown.z, sw * 1.6, Math.max(1, plan.tip - sy), sw * 1.6, crown.rot);

        // ---------------------------------------------------------------------
        // Issued
        // ---------------------------------------------------------------------
        const dummy = new THREE.Object3D();
        for (const b of buckets) {
            if (!b.list.length) continue;
            const im = new THREE.InstancedMesh(b.geo, b.mat, b.list.length);
            im.castShadow = false;
            im.receiveShadow = false;
            im.frustumCulled = false;
            for (let i = 0; i < b.list.length; i++) {
                const e = b.list[i];
                dummy.position.set(e.x, e.y, e.z);
                dummy.rotation.set(0, e.ry, e.rz);
                dummy.scale.set(e.w, e.h, e.d);
                dummy.updateMatrix();
                im.setMatrixAt(i, dummy.matrix);
            }
            im.instanceMatrix.needsUpdate = true;
            group.add(im);
        }

        return {
            group, plan,
            // How hard the gold burns, 0 at noon and 1 at the dead of night.
            // Called every frame by the scene off its own day factor.
            setNightGlow(k) {
                const t = Math.max(0, Math.min(1, k));
                gold.emissiveIntensity = OMEGA_GLOW_DAY + (OMEGA_GLOW_NIGHT - OMEGA_GLOW_DAY) * t;
            },
            dispose() {
                for (const g of geos) g.dispose();
                for (const m of mats) m.dispose();
                if (group.parent) group.parent.remove(group);
            }
        };
    }

    // =========================================================================
    // BiomeFurniture
    //
    // Which of the seven thousand furniture sprites belong in a place, and how
    // many of them. The answer is js/db/WorldGen/biomeFurniture.json, generated
    // from the folders that actually exist under img/furniture (see
    // tools/build-biome-furniture.js): per biome, the folders that suit its
    // outdoors and the folders that suit the inside of a building there, each
    // with a density and a real-world size.
    //
    // Everything here is worked out once and kept. The map is registered rather
    // than loaded (DataService), so a session that never decorates anything
    // never reads it at all.
    // =========================================================================
    const BiomeFurniture = {
        _map: undefined,
        _byFolder: null,
        _cache: new Map(),

        map() {
            if (this._map === undefined) {
                this._map = (window.WorldGen && window.WorldGen.biomeFurniture) || null;
            }
            return this._map;
        },

        // Every sprite in a folder. The game ships an index the other way round
        // (sprite -> folder, for the shop and the placement menu), so it is
        // turned over once here and kept.
        spritesIn(folder) {
            if (!this._byFolder) {
                this._byFolder = new Map();
                const index = (window.Items && window.Items.FurnitureImageFolders) || null;
                if (index) {
                    for (const id in index) {
                        const f = index[id];
                        let arr = this._byFolder.get(f);
                        if (!arr) { arr = []; this._byFolder.set(f, arr); }
                        arr.push(id + '.png');
                    }
                }
            }
            return this._byFolder.get(folder) || [];
        },

        // The outdoor list for a biome, as something ready to scatter: the
        // folder, how thick it should lie, how big a piece is and what pieces
        // there are. Empty where a biome names nothing, or where the map or the
        // sprite index is missing.
        exterior(biomeName) { return this._list(biomeName, 'exterior'); },
        interior(biomeName) { return this._list(biomeName, 'interior'); },

        _list(biomeName, which) {
            const key = which + ':' + biomeName;
            const hit = this._cache.get(key);
            if (hit) return hit;
            const map = this.map();
            const entry = map && map.biomes && map.biomes[biomeName];
            const out = [];
            if (entry && entry[which]) {
                for (const folder in entry[which]) {
                    const cat = map.categories[folder];
                    const sprites = this.spritesIn(folder);
                    if (!cat || !sprites.length) continue;
                    out.push({
                        folder, density: entry[which][folder],
                        size: cat.size || 11, rooms: cat.rooms || null, sprites
                    });
                }
            }
            this._cache.set(key, out);
            return out;
        },

        // Which room roles a folder suits, for the interior planner.
        roomsFor(folder) {
            const map = this.map();
            const cat = map && map.categories && map.categories[folder];
            return (cat && cat.rooms) || null;
        }
    };

    // =========================================================================
    // BiomeSprites
    //
    // Which billboards a biome scatters, where somebody has said so by hand.
    // The name-matching tables in ProceduralDecorator answer for every biome in
    // the world, which is what a world of a hundred and seventy biomes needs;
    // this is the exception written over them, picked sprite by sprite in the
    // Biome Sprites tool (tools -> Biome Sprites) and kept in
    // js/db/WorldGen/biomeSprites.json, one entry per biome gone over by hand.
    //
    // A category named here REPLACES the pool the name match would have chosen,
    // and an EMPTY list means the biome shows none of that kind at all, which is
    // the only way to say "no trees here" to a name the tree table likes. Each
    // sprite is named folder first ('Trees/apple_tree.png'), so a biome may
    // scatter anything under img/furniture as its trees, its rocks or its
    // ground cover.
    // =========================================================================
    const BiomeSprites = {
        _map: undefined,
        _cache: new Map(),

        map() {
            if (this._map === undefined) {
                this._map = (window.WorldGen && window.WorldGen.biomeSprites) || null;
            }
            return this._map;
        },

        // A biome's hand-picked list for one category, gathered by folder as
        // [{ folder, sprites }], or null where the biome says nothing about that
        // category and the built-in tables should answer for it.
        groups(biomeName, kind) {
            const key = kind + ':' + biomeName;
            if (this._cache.has(key)) return this._cache.get(key);
            const map = this.map();
            const entry = map && map.biomes && map.biomes[biomeName];
            const list = entry && entry[kind];
            let out = null;
            if (Array.isArray(list)) {
                const byFolder = new Map();
                for (const item of list) {
                    const cut = String(item).lastIndexOf('/');
                    if (cut <= 0) continue;
                    const folder = String(item).slice(0, cut);
                    let arr = byFolder.get(folder);
                    if (!arr) { arr = []; byFolder.set(folder, arr); }
                    arr.push(String(item).slice(cut + 1));
                }
                out = Array.from(byFolder, ([folder, sprites]) => ({ folder, sprites }));
            }
            this._cache.set(key, out);
            return out;
        }
    };

    // =========================================================================
    // ShopFurniture
    //
    // What a shop of a given kind looks like inside, and where a shop of that
    // kind is found. The answer is js/db/WorldGen/shopFurniture.json, generated
    // from RandomDailyShop's own sixty-one themed shops and the folders under
    // img/furniture (see tools/build-shop-furniture.js).
    //
    // The shop TYPE is the link between the two halves of a shop: it dresses the
    // room, and it is what the shopkeeper behind the counter opens when you ask
    // to see the stock.
    // =========================================================================
    const ShopFurniture = {
        _map: undefined,
        _byWhere: null,
        _cache: new Map(),

        map() {
            if (this._map === undefined) {
                this._map = (window.WorldGen && window.WorldGen.shopFurniture) || null;
            }
            return this._map;
        },

        // Every kind of shop that can stand in a settlement of this kind
        // ('village' or 'city'), in a fixed order so a square that picks the
        // third one always picks the same third one.
        typesFor(where) {
            if (!this._byWhere) {
                this._byWhere = new Map();
                const map = this.map();
                if (map && map.shops) {
                    for (const kind of ['village', 'city']) {
                        this._byWhere.set(kind, Object.keys(map.shops)
                            .filter(t => (map.shops[t].where || []).includes(kind)).sort());
                    }
                }
            }
            return this._byWhere.get(where) || [];
        },

        // The folders that dress a shop of this type, ready to scatter: the
        // folder, how thickly, how big a piece is and what pieces there are.
        furniture(shopType) {
            const hit = this._cache.get(shopType);
            if (hit) return hit;
            const map = this.map();
            const shop = map && map.shops && map.shops[shopType];
            const out = [];
            if (shop) {
                const cats = (BiomeFurniture.map() || {}).categories || {};
                for (const folder in shop.furniture) {
                    const sprites = BiomeFurniture.spritesIn(folder);
                    if (!sprites.length) continue;
                    out.push({
                        folder, density: shop.furniture[folder],
                        size: (cats[folder] && cats[folder].size) || 11, sprites
                    });
                }
            }
            this._cache.set(shopType, out);
            return out;
        },

        // Does this type exist at all? Used to fall back gracefully when the map
        // is not there.
        has(shopType) {
            const map = this.map();
            return !!(map && map.shops && map.shops[shopType]);
        }
    };

    // Handed to the rest of the suite.
    Object.assign(VW, {
        BiomeFurniture, BiomeSprites, ProceduralDecorator, ShopFurniture,
        buildOmegaTower, omegaTowerPlan
    });
})();
