//=============================================================================
// VoxelWorldHouse.js
// VoxelWorld: one procedural building, built properly
//
// Part of the VoxelWorld suite. The ground of that world is a field of small
// destructible voxels; this module is one slice of the machinery laid over it.
// Load order is fixed in plugins.js and every module reads the shared state it
// needs off window.VoxelWorld.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc VoxelWorld - one procedural building: shell, roof, facade, lining
 * @author Omni-Lex
 *
 * @help
 * One procedural building: its shell, its roof, its facade and the lining of
 * its inside.
 *
 * Everything in the 3D world that is a BUILDING is put up from here: a town
 * house on a street, a village shop, the farmhouse and the barn of a steading
 * out in open country, and the ruin standing in a field. It used to be spread
 * across three modules that each had their own idea of where a wall goes, and
 * it showed:
 *
 *   - the four walls of every building overlapped one another at the corners,
 *     and the lining inside them sat exactly on the face of the shell outside
 *     them, so every corner and every room of every house in the world
 *     flickered (two surfaces at one depth, the renderer picking per frame)
 *   - the ridge capping of a roof was cut to the wrong length whenever a house
 *     was wider than it was deep, leaving a stub floating over a long roof
 *   - the parapet of a flat roof was four boxes that overlapped at the corners
 *     and hung half off the deck
 *   - a facade was one 3x3 grid of windows stretched over whatever wall it
 *     landed on, so a long wall wore windows five metres across and the strip
 *     beside a door wore three squeezed into a metre
 *   - and a steading (the farm or the cottage on an empty square) was planned,
 *     furnished, given collision and an inside to walk around, but its OUTSIDE
 *     was never built at all: a house that was solid, furnished and invisible
 *
 * So a building is one job in one place now. The rules it keeps:
 *
 *   MITRED CORNERS. The two walls that run across a building are cut full
 *   width; the two that run down it stop short of them by a wall's thickness.
 *   Boxes butt instead of overlapping, and butted faces point away from each
 *   other, which is what a corner has to do to stop flickering.
 *
 *   THE LINING STRADDLES THE SHELL. The plaster inside is put up centred on
 *   the shell's own inner face rather than flat against it: half of it is
 *   buried in the wall, and no two surfaces ever share a plane.
 *
 *   FACADES ARE MEASURED IN BAYS. A wall's texture repeats by the SIZE of the
 *   wall - one window bay wide and one storey tall, wherever it is - so every
 *   window in the world is the same window. That needs real UVs, which is why
 *   a building is welded into one mesh per material (see HouseMesher) rather
 *   than instanced off a unit cube.
 *
 * One module of the VoxelWorld suite (VoxelWorldCore.js loads first). It
 * declares no plugin commands of its own; those live in VoxelWorldSystem.js.
 */

(() => {
    'use strict';

    const VW = window.VoxelWorld;
    if (!VW) { console.error('[VoxelWorld] core not loaded before VoxelWorldHouse.js'); return; }

    const {
        BUILD_SCHEMES, DOOR_H, SETTLE, SettlementBatch, WALL_T, _doorSpan,
        blockMaterial, blockSpan, planBaseY, planForTile, settleRnd
    } = VW;

    // =========================================================================
    // How a building is put together
    // =========================================================================
    // Four world units to the metre, the same as everything else a settlement
    // is measured in (see SETTLE).
    const HOUSE = {
        eave:      3.2,    // how far a roof overhangs the wall it sits on
        deckT:     1.4,    // thickness of a flat roof's deck
        ridgeT:    1.8,    // the capping along a pitched roof's ridge
        parapetT:  1.6,    // the wall round a flat roof
        parapetH:  3.4,
        pitch:     0.46,   // rise as a fraction of the span the rafters cross
        chimneyW:  3.4,
        // One window bay across a facade (6 m) and one storey up it. The facade
        // texture is four bays by four storeys, so the repeat is the wall's own
        // size divided by these.
        bayW:      24,
        bayH:      SETTLE.storeyH,
        bays:      4       // bays across one tile of the facade texture
    };

    // World units of a plain (non-facade) texture per repeat: stone courses,
    // roof tiles, planking. Chosen so a wall of masonry reads as masonry rather
    // than as one enormous smeared block.
    const TEX_SPAN = { stone: 64, roof: 48, wood: 40, plain: 48 };

    // =========================================================================
    // HouseMesher
    // =========================================================================
    // A building welded together: boxes, pitched prisms and pyramids written
    // into one buffer per material and handed over as a single mesh each.
    //
    // Why not the settlement's own instanced batch? Because an instanced unit
    // cube carries the unit cube's UVs, which is what stretched one grid of
    // windows over every wall whatever its size. Writing the vertices means
    // writing the UVs, and a wall's texture can then be repeated by the metre.
    // It costs nothing: a town of forty buildings is a few thousand vertices
    // and the same handful of draws it always was.
    // =========================================================================
    class HouseMesher {
        constructor() {
            this._buckets = new Map();   // material -> buffers
        }

        _bucket(mat) {
            let b = this._buckets.get(mat);
            if (!b) { b = { pos: [], nrm: [], uv: [], idx: [] }; this._buckets.set(mat, b); }
            return b;
        }

        // The texture span a face is drawn at. `uv` is null for a face that
        // wears its texture once from edge to edge (a sign, a beam), or
        // { su, sv, u, v }: how many world units one repeat covers across and
        // up, and where along the building this face starts, so the courses of
        // two walls that meet line up and a lintel carries on the row of
        // windows beside it.
        static span(uv, along, up) {
            if (!uv) return [0, 0, 1, 1];
            const su = uv.su || 1, sv = uv.sv || uv.su || 1;
            const u0 = (uv.u || 0) / su, v0 = (uv.v || 0) / sv;
            return [u0, v0, u0 + along / su, v0 + up / sv];
        }

        // One quad, given in the order it is wound as seen from OUTSIDE (so the
        // cross product of its first two edges points along the face's normal).
        // `sp` is [u0, v0, u1, v1] across the quad's own two axes.
        _quad(b, verts, n, sp) {
            const base = b.pos.length / 3;
            const uvs = [sp[0], sp[1], sp[2], sp[1], sp[2], sp[3], sp[0], sp[3]];
            for (let i = 0; i < 4; i++) {
                b.pos.push(verts[i][0], verts[i][1], verts[i][2]);
                b.nrm.push(n[0], n[1], n[2]);
                b.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
            }
            b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }

        // The same, for the triangle a gable end or a pyramid face is: the two
        // base corners take the span's bottom edge and the apex takes the top.
        _tri(b, verts, n, sp) {
            const base = b.pos.length / 3;
            const uvs = [sp[0], sp[1], sp[2], sp[1], (sp[0] + sp[2]) / 2, sp[3]];
            for (let i = 0; i < 3; i++) {
                b.pos.push(verts[i][0], verts[i][1], verts[i][2]);
                b.nrm.push(n[0], n[1], n[2]);
                b.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
            }
            b.idx.push(base, base + 1, base + 2);
        }

        // An axis-aligned box, pivoted on the middle of its base and turned
        // about Y. The one shape a building is mostly made of.
        box(mat, x, y, z, w, h, d, rot, uv) {
            const b = this._bucket(mat);
            const hx = w / 2, hz = d / 2, y1 = y + h;
            const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
            const P = (lx, ly, lz) => [x + lx * c - lz * s, ly, z + lx * s + lz * c];
            const N = (nx, nz) => [nx * c - nz * s, 0, nx * s + nz * c];
            const side = HouseMesher.span(uv, d, h);
            const face = HouseMesher.span(uv, w, h);
            const cap  = HouseMesher.span(uv, w, d);
            this._quad(b, [P(hx, y, hz), P(hx, y, -hz), P(hx, y1, -hz), P(hx, y1, hz)],
                N(1, 0), side);
            this._quad(b, [P(-hx, y, -hz), P(-hx, y, hz), P(-hx, y1, hz), P(-hx, y1, -hz)],
                N(-1, 0), side);
            this._quad(b, [P(-hx, y, hz), P(hx, y, hz), P(hx, y1, hz), P(-hx, y1, hz)],
                N(0, 1), face);
            this._quad(b, [P(hx, y, -hz), P(-hx, y, -hz), P(-hx, y1, -hz), P(hx, y1, -hz)],
                N(0, -1), face);
            this._quad(b, [P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz)],
                [0, 1, 0], cap);
            this._quad(b, [P(-hx, y, -hz), P(hx, y, -hz), P(hx, y, hz), P(-hx, y, hz)],
                [0, -1, 0], cap);
        }

        // A pitched roof: base w across by d along, rising to a ridge that runs
        // the length of d at height h. Turned about Y like everything else, so
        // a house whose long side runs east-west gets the same prism a quarter
        // turn round.
        prism(mat, x, y, z, w, h, d, rot, uv) {
            const b = this._bucket(mat);
            const hx = w / 2, hz = d / 2, y1 = y + h;
            const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
            const P = (lx, ly, lz) => [x + lx * c - lz * s, ly, z + lx * s + lz * c];
            const N = (nx, ny, nz) => {
                const l = Math.hypot(nx, ny, nz) || 1;
                const ux = nx / l, uy = ny / l, uz = nz / l;
                return [ux * c - uz * s, uy, ux * s + uz * c];
            };
            const slope = Math.hypot(hx, h);
            const face = HouseMesher.span(uv, d, slope);
            this._quad(b, [P(hx, y, hz), P(hx, y, -hz), P(0, y1, -hz), P(0, y1, hz)],
                N(h, hx, 0), face);
            this._quad(b, [P(-hx, y, -hz), P(-hx, y, hz), P(0, y1, hz), P(0, y1, -hz)],
                N(-h, hx, 0), face);
            const end = HouseMesher.span(uv, w, h);
            this._tri(b, [P(-hx, y, hz), P(hx, y, hz), P(0, y1, hz)], N(0, 0, 1), end);
            this._tri(b, [P(hx, y, -hz), P(-hx, y, -hz), P(0, y1, -hz)], N(0, 0, -1), end);
            // And the soffit under it, so a roof seen from the hillside below is
            // not a hollow shell of outward-facing triangles.
            this._quad(b, [P(-hx, y, -hz), P(hx, y, -hz), P(hx, y, hz), P(-hx, y, hz)],
                [0, -1, 0], HouseMesher.span(uv, w, d));
        }

        // A four-sided pyramid on a w by d base: a spire, or what is left of a
        // ruin's roof.
        pyr(mat, x, y, z, w, h, d, rot, uv) {
            const b = this._bucket(mat);
            const hx = w / 2, hz = d / 2, y1 = y + h;
            const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
            const P = (lx, ly, lz) => [x + lx * c - lz * s, ly, z + lx * s + lz * c];
            const N = (nx, ny, nz) => {
                const l = Math.hypot(nx, ny, nz) || 1;
                const ux = nx / l, uy = ny / l, uz = nz / l;
                return [ux * c - uz * s, uy, ux * s + uz * c];
            };
            const apex = P(0, y1, 0);
            const sx = HouseMesher.span(uv, d, Math.hypot(hx, h));
            const sz = HouseMesher.span(uv, w, Math.hypot(hz, h));
            this._tri(b, [P(hx, y, hz), P(hx, y, -hz), apex], N(h, hx, 0), sx);
            this._tri(b, [P(-hx, y, -hz), P(-hx, y, hz), apex], N(-h, hx, 0), sx);
            this._tri(b, [P(-hx, y, hz), P(hx, y, hz), apex], N(0, hz, h), sz);
            this._tri(b, [P(hx, y, -hz), P(-hx, y, -hz), apex], N(0, hz, -h), sz);
            this._quad(b, [P(-hx, y, -hz), P(hx, y, -hz), P(hx, y, hz), P(-hx, y, hz)],
                [0, -1, 0], HouseMesher.span(uv, w, d));
        }

        get empty() { return this._buckets.size === 0; }

        // One mesh per material, added to the group the square is built into.
        // The geometry belongs to that group alone and is disposed with it (the
        // terrain's chunk teardown walks the group and frees every geometry it
        // finds), unlike the shared unit cubes an instanced batch draws.
        flush(group) {
            for (const [mat, b] of this._buckets) {
                if (!b.idx.length) continue;
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
                geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.nrm), 3));
                geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
                const verts = b.pos.length / 3;
                geo.setIndex(new THREE.BufferAttribute(
                    verts > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx), 1));
                const mesh = new THREE.Mesh(geo, mat);
                mesh.castShadow = false;
                mesh.receiveShadow = true;
                group.add(mesh);
            }
            this._buckets.clear();
        }
    }

    // =========================================================================
    // Facades and the rest of the skin
    // =========================================================================
    // A building is made of BLOCKS now (VoxelWorld.Blocks, declared in the
    // core, painted once by tools/build_voxel_blocks.js and shipped as PNGs).
    // Which blocks is the PLAN's business, not this file's: every lot carries a
    // scheme - the skin of its walls, the trim, the roof, the course it stands
    // on and what it is glazed with - chosen when the settlement was laid out
    // (see BUILD_SCHEMES in VoxelWorldSettlements).
    //
    // What used to be here was a 2D canvas painted pixel by pixel the first
    // time anybody drove into a town: six wall tones, a base sheet and an
    // emissive sheet each, twelve canvases and twelve texture uploads in the
    // frame the square streamed in - and every one of them rebuilt from
    // scratch the next time the world came up. They are files now. The world
    // loads them once, shares one material per block across every square in
    // it, and a town costs the loader nothing it has not already got.
    const DEFAULT_SCHEME = (BUILD_SCHEMES && BUILD_SCHEMES.brick) || {
        facade: 'facade_brick', wall: 'brick', trim: 'stone',
        roof: 'roof_tile', flat: 'roof_slate', plinth: 'stone', glass: 'glass'
    };

    // The scheme a lot is built to. Older plans (and anything built by hand)
    // carry none, so the kind of building it is decides.
    function schemeOf(lot) {
        if (lot.blocks) return lot.blocks;
        const S = BUILD_SCHEMES || {};
        const sub = lot.subkind || '';
        if (sub === 'barn' || sub === 'shed') return S.barn || DEFAULT_SCHEME;
        if (sub === 'granary') return S.granary || DEFAULT_SCHEME;
        if (lot.kind === 'church') return S.church || DEFAULT_SCHEME;
        if (lot.ruined) return S.ruin || DEFAULT_SCHEME;
        return DEFAULT_SCHEME;
    }

    // One block as a material. Everything a building is drawn with goes through
    // here, so a town of forty houses shares one brick, one slate and one pane
    // of glass between the lot of them.
    function blockMat(dec, key, tint) {
        const m = blockMaterial(key, tint);
        return m || dec._matStone();
    }

    // The wall skin a lot wears. A building somebody lives or trades in gets
    // the bay-measured facade, with its windows lit after dark; a barn, a ruin
    // and anything with no windows in it gets the plain wall block.
    function facadeFor(dec, lot) {
        const sc = schemeOf(lot);
        const key = (lot.ruined || !sc.facade) ? sc.wall : sc.facade;
        return blockMat(dec, key);
    }

    // How the skin of a wall is measured out. Every block declares how far one
    // repeat of its picture reaches (VoxelWorld.Blocks); a facade declares it
    // in bays and storeys, everything else in world units, and the mesher
    // writes the UVs off that - which is what keeps one window one window wide
    // whether it is on a cottage or on the side of a tower.
    function skinOf(dec, mat) {
        if (mat && mat.__vwBlock) return blockSpan(mat.__vwBlock);
        // Nothing this file made: fall back to a plain span.
        return { su: TEX_SPAN.plain, sv: TEX_SPAN.plain };
    }

    // =========================================================================
    // The shell
    // =========================================================================
    // Four walls, a doorway in the side that faces the street and the wall
    // carrying on over it. Hollow, because anything here can be walked into
    // once somebody is close enough for its inside to be built.
    //
    // The corners are MITRED: the two walls that run across the building are
    // cut to its full width, the two that run down it stop a wall's thickness
    // short at each end. Nothing overlaps, and the faces that meet point away
    // from one another, so a corner is a corner instead of a flickering seam.
    //
    // Runs come back in the building's own local frame, which is what lets the
    // interior planner ask for the same wall in the same place (see linerRuns).
    function wallRuns(lot, h, t) {
        const thick = t || WALL_T;
        const span = _doorSpan(lot);
        const ruin = lot.ruined ? (lot.ruin || 0.3) : 0;
        const rnd = (i) => settleRnd(lot.x, lot.z, i);
        const out = [];
        for (let side = 0; side < 4; side++) {
            const horizontal = side < 2;
            const along = horizontal ? lot.w : lot.d - thick * 2;
            const off   = (horizontal ? lot.d : lot.w) / 2 - thick / 2;
            const sgn   = (side % 2 === 0) ? -1 : 1;
            if (ruin && rnd(side * 17 + 3) < ruin * 0.45) continue;   // that wall is gone
            const segs = (side === lot.side)
                ? [[-along / 2, span[0]], [span[1], along / 2]]
                : [[-along / 2, along / 2]];
            for (let si = 0; si < segs.length; si++) {
                const a = segs[si][0], b = segs[si][1];
                if (b - a < 0.5) continue;
                const c = (a + b) / 2, len = b - a;
                // A standing ruin is broken off part-way up.
                const wh = ruin ? h * (0.45 + rnd(side * 31 + si * 7 + 11) * 0.55) : h;
                out.push(horizontal
                    ? { x: c, z: sgn * off, w: len, d: thick, y: 0, h: wh, at: a, side }
                    : { x: sgn * off, z: c, w: thick, d: len, y: 0, h: wh, at: a, side });
            }
            // The wall carries on over the doorway.
            if (side === lot.side && (!ruin || rnd(side * 41 + 5) > ruin)) {
                const c = (span[0] + span[1]) / 2, len = span[1] - span[0];
                const lh = Math.max(0.5, (ruin ? h * 0.6 : h) - DOOR_H);
                out.push(horizontal
                    ? { x: c, z: sgn * off, w: len, d: thick, y: DOOR_H, h: lh, at: span[0], side, over: true }
                    : { x: sgn * off, z: c, w: thick, d: len, y: DOOR_H, h: lh, at: span[0], side, over: true });
            }
        }
        return out;
    }

    function buildShell(M, dec, lot, y, mat, h) {
        const skin = skinOf(dec, mat);
        for (const r of wallRuns(lot, h, WALL_T)) {
            // Where this run starts along its own wall, and how far up the
            // building it is, so two runs either side of a door carry the same
            // row of windows and a lintel does not restart the count. Taken off
            // the building's world position as well, so two houses standing
            // side by side do not both start their courses at the same seam.
            const uv = {
                su: skin.su, sv: skin.sv,
                u: r.at + (r.side < 2 ? lot.x : lot.z),
                v: r.y
            };
            M.box(mat, lot.x + r.x, y + r.y, lot.z + r.z, r.w, r.h, r.d, 0, uv);
        }
    }

    // The lining of the rooms inside, as the interior planner wants it: runs in
    // the building's own local frame, centred ON the shell's inner face rather
    // than flat against it. Half of each run is buried in the wall outside it,
    // which is what stops the plaster and the brickwork sharing a plane and
    // fighting over which of them the renderer draws. It also lands the inner
    // door reveal exactly where the shell's own doorway is.
    function linerRuns(lot, iw, id, lineH) {
        const t = WALL_T;
        const span = _doorSpan(lot);
        const out = [];
        for (let side = 0; side < 4; side++) {
            const horizontal = side < 2;
            const along = horizontal ? iw : id;
            const off   = (horizontal ? id : iw) / 2;      // straddling the shell
            const sgn   = (side % 2 === 0) ? -1 : 1;
            const segs = (side === lot.side)
                ? [[-along / 2, span[0]], [span[1], along / 2]]
                : [[-along / 2, along / 2]];
            for (const seg of segs) {
                const a = seg[0], b = seg[1];
                if (b - a < 0.5) continue;
                const c = (a + b) / 2, len = b - a;
                out.push(horizontal
                    ? { x: c, z: sgn * off, w: len, d: t, y: 0, h: lineH, liner: true }
                    : { x: sgn * off, z: c, w: t, d: len, y: 0, h: lineH, liner: true });
            }
            // Over the doorway: the lining carries on above the lintel.
            if (side === lot.side) {
                const c = (span[0] + span[1]) / 2, len = span[1] - span[0];
                out.push(horizontal
                    ? { x: c, z: sgn * off, w: len, d: t, y: DOOR_H, h: lineH - DOOR_H, liner: true, over: true }
                    : { x: sgn * off, z: c, w: t, d: len, y: DOOR_H, h: lineH - DOOR_H, liner: true, over: true });
            }
        }
        return out;
    }

    // =========================================================================
    // The roof
    // =========================================================================
    // A gable gets a real pitched roof with the ridge along the LONGER side
    // (rafters span the narrow way, which is what a builder does), eaves that
    // overhang, a capping the full length of the ridge and a chimney off it.
    // A flat roof gets a deck with a parapet standing ON it, mitred at the
    // corners like every other wall here, plus the clutter a real roof carries.
    function buildRoof(M, dec, lot, y, mats) {
        const w = lot.w, d = lot.d, rot = lot.rot || 0;
        const tile = mats.tile, flat = mats.flat;
        // Every roof block is measured by its own repeat: slate courses are
        // finer than pantiles and thatch is coarser than either.
        const roofUV = skinOf(dec, tile);
        const flatUV = skinOf(dec, flat);
        if (lot.gable) {
            const alongZ = d >= w;                      // which way the ridge runs
            const span = Math.min(w, d);                // what the rafters cross
            const rise = Math.max(5, span * HOUSE.pitch);
            const E = HOUSE.eave;
            const rr = rot + (alongZ ? 0 : Math.PI / 2);
            const across = span + E * 2;                // the prism's own X
            const length = Math.max(w, d) + E * 2;      // and its own Z: the ridge
            M.prism(tile, lot.x, y, lot.z, across, rise, length, rr, roofUV);
            // The capping runs the whole ridge, whichever axis that is. (It used
            // to be cut to the SHORT side whenever a house was wider than it was
            // deep, which left a stub of capping floating over a long roof.)
            M.box(mats.metal || flat, lot.x, y + rise - 0.9, lot.z,
                HOUSE.ridgeT, 1.4, length * 0.98, rr, null);
            // The chimney, stood on the ridge a fifth of the way along it.
            const lz = length * 0.22;
            M.box(mats.roof || flat,
                lot.x - Math.sin(rr) * lz, y + rise * 0.45, lot.z + Math.cos(rr) * lz,
                HOUSE.chimneyW, rise * 0.75 + 4, HOUSE.chimneyW, rr, skinOf(dec, mats.roof || flat));
            return;
        }
        // Flat: the deck, then a parapet standing on it rather than hanging off
        // its edge, and cut so the four runs butt at the corners.
        const E = HOUSE.eave * 0.6;
        const W = w + E * 2, D = d + E * 2;
        const PT = HOUSE.parapetT, PH = HOUSE.parapetH;
        M.box(flat, lot.x, y, lot.z, W, HOUSE.deckT, D, rot, flatUV);
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const put = (lx, lz, sw, sd) => M.box(flat,
            lot.x + lx * cos - lz * sin, y + HOUSE.deckT, lot.z + lx * sin + lz * cos,
            sw, PH, sd, rot, flatUV);
        put(0, -(D - PT) / 2, W, PT);
        put(0,  (D - PT) / 2, W, PT);
        put(-(W - PT) / 2, 0, PT, D - PT * 2);
        put( (W - PT) / 2, 0, PT, D - PT * 2);
        // The stair head and the tank.
        M.box(mats.roof || flat, lot.x + w * 0.2, y + HOUSE.deckT, lot.z + d * 0.2,
            w * 0.2, 5.2, d * 0.2, rot, flatUV);
        M.box(mats.metal || flat, lot.x - w * 0.22, y + HOUSE.deckT, lot.z - d * 0.18,
            4.5, 5, 4.5, rot, null);
    }

    // The course a building stands on. A wall that meets the pavement dead
    // flush reads as printed onto the ground; a plinth of the scheme's own
    // masonry, one step proud of the wall above it, is what a real one has.
    const PLINTH_H = 3.0;
    const PLINTH_OUT = 0.9;
    function buildPlinth(M, dec, lot, y) {
        const sc = schemeOf(lot);
        if (!sc.plinth) return;
        const mat = blockMat(dec, sc.plinth);
        M.box(mat, lot.x, y - PLINTH_H * 0.4, lot.z,
            lot.w + PLINTH_OUT * 2, PLINTH_H, lot.d + PLINTH_OUT * 2, lot.rot || 0,
            skinOf(dec, mat));
    }

    // The window a shop puts its goods behind: a band of real glass across the
    // front of the ground floor, in its own frame, standing a little proud of
    // the wall. It is the one place in a town a pane is glass rather than a
    // picture of one painted into the facade.
    const SIDE_FRONT = [[0, -1], [0, 1], [-1, 0], [1, 0]];   // north, south, west, east
    function buildShopFront(M, dec, lot, y) {
        const sc = schemeOf(lot);
        const f = SIDE_FRONT[lot.side] || SIDE_FRONT[0];
        const outX = f[0] * (lot.w * 0.5 + 2.2);
        const outZ = f[1] * (lot.d * 0.5 + 2.2);
        const awW = f[0] ? 4.5 : lot.w * 0.7;
        const awD = f[0] ? lot.d * 0.7 : 4.5;

        // The glazing itself, either side of the door.
        const span = _doorSpan(lot);
        const glass = blockMat(dec, sc.glass || 'glass');
        const guv = skinOf(dec, glass);
        const along = (lot.side < 2) ? lot.w : lot.d;
        const gy = y + 2.6, gh = DOOR_H - 3.4;
        const half = f[0] ? lot.w * 0.5 + 0.6 : lot.d * 0.5 + 0.6;
        for (const [a, b] of [[-along * 0.44, span[0] - 1], [span[1] + 1, along * 0.44]]) {
            if (b - a < 3) continue;
            const c = (a + b) / 2, len = b - a;
            if (f[0]) M.box(glass, lot.x + f[0] * half, gy, lot.z + c, 0.8, gh, len, 0, guv);
            else      M.box(glass, lot.x + c, gy, lot.z + f[1] * half, len, gh, 0.8, 0, guv);
        }
        // The awning over it and the lit sign above that.
        M.box(blockMat(dec, 'awning'), lot.x + outX, y + 8.2, lot.z + outZ,
            awW, 0.5, awD, 0, null);
        M.box(dec._emissiveMat('__shopsign', '#ffd98a'),
            lot.x + outX * 1.1, y + 9.4, lot.z + outZ * 1.1,
            f[0] ? 0.6 : lot.w * 0.4, 2.2, f[0] ? lot.d * 0.4 : 0.6, 0, null);
    }

    // =========================================================================
    // One building, whole
    // =========================================================================
    // The single entry point: hand it a lot off any plan - a town block, a
    // village street, a farmyard, an empty field - and it puts that building up.
    //
    //   opts.mat         override the facade (a church is masonry, a ruin's
    //                    shell is whatever is left of it)
    //   opts.height      wall height, if it is not the lot's own
    //   opts.ruinedRoof  what is left of a roof rather than a whole one
    function buildOne(M, dec, lot, y, opts) {
        const o = opts || {};
        const S = SETTLE;
        const church = lot.kind === 'church';
        const h = o.height || (church ? lot.h + S.storeyH * 2 : lot.h);
        const sc = schemeOf(lot);
        const mat = o.mat || facadeFor(dec, lot);
        const ruinMat = blockMat(dec, sc.flat || 'roof_slate');
        const roofUV = skinOf(dec, ruinMat);
        if (!lot.ruined) buildPlinth(M, dec, lot, y);
        buildShell(M, dec, lot, y, mat, h);

        if (o.ruinedRoof) {
            // What is left of it: a stub of the gable, or a slab with a hole
            // through it. Never a whole roof - the point of a ruin is the sky
            // coming in through it.
            const r = settleRnd(lot.x, lot.z, 8100);
            if (lot.gable) {
                if (r > 0.35) {
                    M.pyr(ruinMat, lot.x, y + h, lot.z,
                        lot.w * (0.5 + r * 0.6), Math.min(lot.w, lot.d) * 0.4,
                        lot.d * (0.5 + r * 0.6), 0, roofUV);
                }
            } else if (r > 0.45) {
                M.box(ruinMat, lot.x - lot.w * 0.15, y + h, lot.z,
                    lot.w * 0.6, 1.4, lot.d * 0.85, 0, roofUV);
            }
        } else {
            // A shop wears its own blue slate; everything else is roofed in
            // whatever its scheme says (see BUILD_SCHEMES).
            const tile = blockMat(dec, lot.shop ? 'roof_shop' : sc.roof);
            const flat = blockMat(dec, lot.shop ? 'roof_shop' : sc.flat);
            buildRoof(M, dec, lot, y + h, {
                tile, flat,
                roof:  blockMat(dec, sc.trim || 'stone'),
                metal: blockMat(dec, 'metal')
            });
        }

        if (church) {
            const spire = blockMat(dec, sc.roof || 'roof_slate');
            M.pyr(spire, lot.x, y + h, lot.z,
                lot.w * 0.5, S.storeyH * 2.4, lot.d * 0.5, 0, skinOf(dec, spire));
        }
        if (lot.spire) {
            M.pyr(ruinMat, lot.x, y + h, lot.z + lot.d * 0.34,
                lot.w * 0.34, S.storeyH * 3, lot.w * 0.34, 0, roofUV);
        }
        if (lot.shop) buildShopFront(M, dec, lot, y);
    }

    // =========================================================================
    // A steading: the lone house out in open country
    // =========================================================================
    // A farm or a cottage on an empty square. It was planned, furnished, given
    // collision and an inside to walk around in, and then nobody ever built the
    // OUTSIDE of it: the walls existed only as the boxes you could not walk
    // through, and its rooms stood in the open air. This is the missing half.
    function buildSteading(dec, grp, wx, wy, heightFn) {
        const plan = planForTile(wx, wy);
        if (!plan || !plan.steading || !plan.lots.length) return false;
        const baseY = planBaseY(plan, wx, wy, heightFn || (() => 0));
        const B = new SettlementBatch(dec);
        const M = new HouseMesher();

        for (const lot of plan.lots) {
            // A patch of trodden ground under each building, deep enough to
            // bridge the fall of the land on the downhill side.
            B.add('uBox', dec._matSoil(), lot.x, baseY - 7, lot.z,
                lot.w + 9, 7, lot.d + 9, 0);
            buildOne(M, dec, lot, baseY, null);
        }
        // The yard round them: the haystacks, the well, the fields, the fence.
        for (const p of plan.props) dec._buildProp(B, p, baseY, 0, false);

        B.flush(grp);
        M.flush(grp);
        return true;
    }

    // Handed to the rest of the suite. VW.House is the front door; the loose
    // names are kept alongside it because everything else in the suite reads
    // what it needs straight off the namespace.
    const House = {
        HOUSE, TEX_SPAN, PLINTH_H, Mesher: HouseMesher,
        build: buildOne, buildPlinth, buildRoof, buildShell, buildShopFront,
        buildSteading, blockMat, facadeFor, linerRuns, schemeOf, skinOf, wallRuns
    };
    Object.assign(VW, {
        House, HOUSE, HouseMesher, TEX_SPAN,
        buildOne, buildPlinth, buildRoof, buildShell, buildShopFront, buildSteading,
        facadeFor, linerRuns, schemeOf, skinOf, wallRuns
    });
})();
