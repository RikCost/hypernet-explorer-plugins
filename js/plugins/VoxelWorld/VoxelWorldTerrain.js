//=============================================================================
// VoxelWorldTerrain.js
// VoxelWorld: streaming the voxel field into the scene
//
// This is what used to be a ring of height-mesh chunks and is now a ring of
// voxel chunks. One chunk is one world map tile, a hundred columns square. Near
// the camera a tile is meshed as sixteen full-detail patches, so breaking a
// block rebuilds a twenty-five column patch and nothing else; further out the
// same field is meshed with bigger blocks, which keeps the horizon blocky
// instead of swapping in a different kind of ground.
//
// Everything the old renderer offered its callers is still here and still means
// the same thing: getTerrainHeight in tile coordinates, a chunk radius, a build
// budget, a decorator for the 2D billboard vegetation and props, and the sea
// left to WaterPlane. What is new is that the ground can be taken apart.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc VoxelWorld - streams the voxel field into the scene as chunks
 * @author Omni-Lex
 *
 * @help
 * Streams the voxel field into the 3D scene, meshes it, lays the roads and the
 * streetlights, and hands each tile to the billboard decorator.
 *
 * One module of the VoxelWorld suite (VoxelWorldCore.js loads first). It
 * declares no plugin commands of its own; those live in VoxelWorldSystem.js.
 */

(() => {
    'use strict';

    const VW = window.VoxelWorld;
    if (!VW) { console.error('[VoxelWorld] core not loaded before VoxelWorldTerrain.js'); return; }

    const {
        MAT, PLACEABLE, ProceduralDecorator, ROAD_SINK, ROAD_TOTAL_W, SEA_LEVEL,
        VOX, VoxelField, VoxelMesher, WORLD_TILE_SIZE, getRenderType, profileFor,
        getRoadDirectionAt, loadTex, loadVoxelTex, sampleBiomeAt, voxelMaterial, VoxelWorldState,
        voxelGrassMaterial, voxelWaterMaterial, disposeVoxelMaterial,
        voxelBlockMaterial
    } = VW;

    const WORLD_TILES_ACROSS = 256;

    // =========================================================================
    // Underground
    // =========================================================================
    // A cave is the most expensive place in the world to stand. Above ground a
    // tile is a skin over a heightfield and the greedy mesher collapses a field
    // into a handful of triangles; underground every passage is drawn cube by
    // cube, and the whole ring of tiles is being paid for while none of it can
    // be seen through five voxels of rock.
    //
    // So the ring is drawn in. Down there the world is streamed at a much
    // smaller radius, and only the tiles close enough for their passages to
    // actually be meshed are drawn at all - anything further out is kept in
    // memory but switched off, which is both why the frame rate holds and why
    // clipping a camera into a wall no longer shows somebody else's cave
    // hanging in the dark on the far side of it.
    const CAVE_RADIUS   = 3;   // tiles streamed while underground (surface: 5)
    const CAVE_DRAW_R   = 1;   // ...and how many of them are actually drawn

    // =========================================================================
    // VoxelTerrain
    // =========================================================================
    class VoxelTerrain {
        constructor(scene) {
            this._scene   = scene;
            this._chunks  = new Map();          // "wx,wy" -> chunk record
            this._radius  = 5;
            this._buildBudget = 6;
            this._ts      = WORLD_TILE_SIZE;
            this._matCache = new Map();
            this._poleMat = null;
            this._lampMat = null;
            this._lodMode = false;
            this._decorator = new ProceduralDecorator(this._matCache);

            // The world itself.
            this.field = new VoxelField();
            this.field.onEdit = (wx, wy, lx, lz) => this._markDirty(wx, wy, lx, lz);
            this._dirty = new Set();            // "wx,wy,si,sj" patches to re-mesh
            this._pendingBuilds = false;
            // The sea is one endless sheet, so it has to be taken away whenever
            // there is no sea about: otherwise it shows at the bottom of every
            // hole anybody digs in a field.
            this.seaNear = true;
            // Whether the caves are drawn at all. A passage keeps five voxels
            // of rock over its head (VoxelWorldField's cave field), so there is
            // nothing of one to see from up in the daylight and nothing worth
            // meshing: the whole system is built only once somebody is actually
            // down in it, and taken away again when they climb back out.
            this._caves = false;
        }

        // Underground, or back out in the open. Flipping it rebuilds the world
        // around the camera, which is the price of not carrying the caves about
        // above ground - and it is paid once, on the way in and on the way out.
        setCavesVisible(on) {
            on = !!on;
            if (this._caves === on) return;
            this._caves = on;
            // The ring shrinks on the way down and opens back up on the way
            // out. The surface radius is whatever it was set to, so a quality
            // setting made above ground survives a trip through the caves.
            if (on) {
                this._surfaceRadius = this._radius;
                this._radius = Math.min(this._radius, CAVE_RADIUS);
            } else if (this._surfaceRadius != null) {
                this._radius = this._surfaceRadius;
                this._surfaceRadius = null;
            }
            this._clearChunks();
        }
        cavesVisible() { return this._caves; }

        // ---------------------------------------------------------------------
        // The height every other system asks for, in tile coordinates, exactly
        // as the flat renderer answered it. It is the voxel surface, smoothed
        // over the four columns around the point so a camper does not chatter
        // down a metre-and-a-quarter staircase, and it drops the instant a
        // trench is dug under it.
        // ---------------------------------------------------------------------
        getTerrainHeight(gx, gz) {
            return this.field.heightAt(gx * this._ts, gz * this._ts);
        }

        // The unsmoothed top of the cube under a world-unit point: what feet
        // stand on and what the dig cursor snaps to.
        getBlockTop(x, z) { return this.field.blockTopAt(x, z); }

        // ---------------------------------------------------------------------
        // Underground
        // ---------------------------------------------------------------------
        // What is under a person's feet AT A GIVEN HEIGHT, rather than the top of
        // the world above them. On the surface the two are the same answer; in a
        // cave they are not, and asking the surface where the floor is would
        // stand a walker on the roof of the passage they are inside.
        supportY(x, z, y) { return this.field.supportY(x, z, y); }

        // ---------------------------------------------------------------------
        // The things standing on the ground
        // ---------------------------------------------------------------------
        // Every scattered sprite of a built tile, in WORLD coordinates: what a
        // walker is stopped by, what a vehicle knocks down, and what the party
        // can take apart. The decorator writes them onto the tile's own group,
        // so they are thrown away with the chunk and never outlive it.
        propsAt(wx, wy) {
            const ch = this._chunks.get(wx + ',' + wy);
            if (!ch || !ch.grp.userData.props) return null;
            return ch;
        }

        // Whatever is standing nearest to a point, within `maxD`, that `want`
        // says yes to. Only the nine tiles round it are looked at: nothing
        // further away could be within reach of anybody.
        nearestProp(x, z, maxD, want) {
            const ts = this._ts;
            const tx = Math.floor(x / ts), tz = Math.floor(z / ts);
            let best = null, bestD = maxD * maxD;
            for (let j = -1; j <= 1; j++) {
                for (let i = -1; i <= 1; i++) {
                    const ch = this.propsAt(tx + i, tz + j);
                    if (!ch) continue;
                    for (const p of ch.grp.userData.props) {
                        if (want && !want(p)) continue;
                        const dx = ch.px + p.x - x, dz = ch.pz + p.z - z;
                        const d2 = dx * dx + dz * dz;
                        if (d2 >= bestD) continue;
                        bestD = d2;
                        best = { rec: p, chunk: ch, x: ch.px + p.x, y: p.y, z: ch.pz + p.z };
                    }
                }
            }
            return best;
        }

        // Take one down. The instance is scaled to nothing rather than removed,
        // so every other instance of that mesh keeps its index, and the world
        // is told so it stays down: a wood driven through does not grow back
        // the moment the chunk is streamed out and in again.
        fellProp(hit) {
            if (!hit || !hit.rec || !hit.chunk) return false;
            const rec = hit.rec;
            if (rec.mesh && rec.mesh.setMatrixAt) {
                const m = this._fellM || (this._fellM = new THREE.Matrix4());
                m.makeScale(0, 0, 0);
                m.setPosition(rec.x, rec.y, rec.z);
                rec.mesh.setMatrixAt(rec.index, m);
                rec.mesh.instanceMatrix.needsUpdate = true;
            }
            const list = hit.chunk.grp.userData.props;
            const at = list.indexOf(rec);
            if (at >= 0) list.splice(at, 1);
            if (rec.key && VoxelWorldState) VoxelWorldState.fell(rec.key);
            return true;
        }

        // The underside of the rock over their head, or null under open sky.
        roofY(x, z, y) { return this.field.roofY(x, z, y); }

        // Is a point inside the rock rather than out in the open? What makes a
        // cave a cave: the light, the fog, the sky and the sea all answer to it.
        isUnderground(x, z, y) {
            return y < this.field.blockTopAt(x, z) - VOX.SIZE * 0.5;
        }

        // ---------------------------------------------------------------------
        // Water
        // ---------------------------------------------------------------------
        // The surface of whatever water stands over a world-unit point, or null
        // where the ground there is dry. The one answer everything that swims
        // reads: the party (VoxelWorldActors), and the creatures that live in it
        // (VoxelWorldEntities).
        //
        // Two kinds of water, kept apart exactly as they are drawn. Standing
        // water - a river at altitude, a mountain lake, the pools in a swamp -
        // is carried by the column itself. The open sea is one endless sheet at
        // SEA_LEVEL, and only where there is sea about: inland the sheet is
        // taken down (WaterPlane.setVisible), so a shaft dug in a field stays
        // dry to the bottom and nothing swims in it.
        waterSurfaceAt(x, z) {
            const field = this.field;
            if (!field) return null;
            let y = null;
            const col = field.sampleColumn(x, z);
            if (col && isFinite(col.water)) y = col.water;
            if (this.seaNear && field.blockTopAt(x, z) < SEA_LEVEL) {
                y = (y == null) ? SEA_LEVEL : Math.max(y, SEA_LEVEL);
            }
            return y;
        }

        // Which water this is: 'inland' for the standing water a column carries
        // (a river channel, a mountain lake, a swamp pool), 'sea' for the open
        // sheet, null where the ground is dry. What lives in it is drawn from
        // one roster or the other (VoxelWorldEntities).
        waterKindAt(x, z) {
            const field = this.field;
            if (!field) return null;
            const col = field.sampleColumn(x, z);
            if (col && isFinite(col.water)) return 'inland';
            if (this.seaNear && field.blockTopAt(x, z) < SEA_LEVEL) return 'sea';
            return null;
        }

        // How deep that water stands over the ground, in world units. 0 where
        // there is none.
        waterDepthAt(x, z) {
            const top = this.waterSurfaceAt(x, z);
            if (top == null) return 0;
            return Math.max(0, top - this.field.blockTopAt(x, z));
        }

        // ---------------------------------------------------------------------
        // Level of detail
        // ---------------------------------------------------------------------
        // Free cam surveys the world from a long way up with a huge radius; the
        // near LOD table would try to mesh six hundred tiles at full detail.
        setLodMode(lod) {
            if (this._lodMode === lod) return;
            this._lodMode = lod;
            this._clearChunks();
        }

        // Any water square in the block around the camera. Cheap: the biome
        // lookups it makes are memoised, and it only runs when the camera
        // crosses into a new square.
        _seaWithin(cwx, cwy, r) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (profileFor(sampleBiomeAt(cwx + dx, cwy + dy).name).water) return true;
                }
            }
            return false;
        }

        // Roughly what a chunk costs to mesh, in patches: the column count scales
        // with the square of the block size.
        _chunkCost(step) {
            const n = VOX.PER_TILE / step;
            return Math.max(0.15, (n * n) / (VOX.SUB_N * VOX.SUB_N));
        }

        _stepFor(dist) {
            if (this._lodMode) return Math.max(10, VOX.lodStep(dist));
            return VOX.lodStep(dist);
        }

        // ---------------------------------------------------------------------
        // Streaming
        // ---------------------------------------------------------------------
        update(camperX, camperZ, buildAll = false) {
            const cwx = Math.floor(camperX / this._ts);
            const cwy = Math.floor(camperZ / this._ts);

            // Re-mesh anything a dig touched first: a hole the player is still
            // looking at matters more than a tile on the horizon.
            this._drainDirty(buildAll ? 64 : 2);

            if (!buildAll && cwx === this._lastCwx && cwy === this._lastCwy &&
                this._radius === this._lastRadius && !this._pendingBuilds) {
                return;
            }
            this._lastCwx = cwx;
            this._lastCwy = cwy;
            this._lastRadius = this._radius;
            this.seaNear = this._seaWithin(cwx, cwy, 3);

            const needed = [];
            for (let dx = -this._radius; dx <= this._radius; dx++) {
                for (let dy = -this._radius; dy <= this._radius; dy++) {
                    const wx = cwx + dx, wy = cwy + dy;
                    if (wx < 0 || wx >= WORLD_TILES_ACROSS || wy < 0 || wy >= WORLD_TILES_ACROSS) continue;
                    const key  = wx + ',' + wy;
                    const step = this._stepFor(Math.max(Math.abs(dx), Math.abs(dy)));
                    const have = this._chunks.get(key);
                    if (have && have.step === step) continue;
                    needed.push({ wx, wy, key, step, dist: dx * dx + dy * dy, rebuild: !!have });
                }
            }
            needed.sort((a, b) => a.dist - b.dist);

            // The budget is in patches, not tiles: a full-detail tile is sixteen
            // twenty-five column patches and a far one is a fraction of one, so
            // spending them at the same rate would hitch every time the camper
            // crossed into a new square. One build always goes through, or a
            // fast enough drive would outrun its own ground.
            const credits = buildAll ? Infinity
                : Math.max(1, (this._lodMode ? 12 : this._buildBudget)) * 4;
            let spent = 0, built = 0;
            for (const job of needed) {
                if (built > 0 && spent >= credits) break;
                spent += this._chunkCost(job.step);
                built++;
                if (job.rebuild) this._disposeChunk(job.key);
                this._chunks.set(job.key, this._buildChunk(job.wx, job.wy, job.step));
            }
            this._pendingBuilds = needed.length > built;

            for (const [key, ch] of this._chunks) {
                if (Math.abs(ch.wx - cwx) > this._radius + 2 ||
                    Math.abs(ch.wy - cwy) > this._radius + 2) {
                    this._disposeChunk(key);
                }
            }
            this._applyCaveDrawRing(cwx, cwy);
        }

        // Underground, only the tiles whose passages are actually meshed are
        // drawn. The rest are kept (they are what the party climbs back out
        // onto) but switched off: there is nothing of them to see through the
        // rock, and drawing them is what put another cave in the dark behind a
        // wall the camera had clipped into. Above ground everything is drawn.
        _applyCaveDrawRing(cwx, cwy) {
            const caves = this._caves;
            if (!caves && !this._ringApplied) return;
            this._ringApplied = caves;
            for (const ch of this._chunks.values()) {
                const on = !caves ||
                    (Math.abs(ch.wx - cwx) <= CAVE_DRAW_R && Math.abs(ch.wy - cwy) <= CAVE_DRAW_R);
                if (ch.grp.visible !== on) ch.grp.visible = on;
            }
        }

        // ---------------------------------------------------------------------
        // Chunk building
        // ---------------------------------------------------------------------
        _buildChunk(wx, wy, step) {
            const ts    = this._ts;
            const biome = sampleBiomeAt(wx, wy);
            const type  = getRenderType(biome.name);
            const grp   = new THREE.Group();
            const px = wx * ts + ts * 0.5, pz = wy * ts + ts * 0.5;
            grp.position.set(px, 0, pz);

            const ch = { grp, wx, wy, step, px, pz, subs: new Map() };

            if (step === 1) {
                // Sixteen patches, so a dig re-meshes one of them.
                for (let sj = 0; sj < VOX.SUB; sj++) {
                    for (let si = 0; si < VOX.SUB; si++) this._buildSub(ch, si, sj);
                }
            } else {
                const n = Math.max(1, Math.round(VOX.PER_TILE / step));
                // Far chunks are drawn in blocks several voxels across; a
                // passage is finer than that, so the caves are never in them.
                this._addMesh(ch, 'all', VoxelMesher.build(this.field, wx, wy, 0, 0, n, step, px, pz, false));
            }

            // The road is cut into the cubes themselves, so nothing is laid on
            // top of it any more. Only the lamps that line it are still props.
            if (type === 'road') this._buildStreetlights(grp, wx, wy);

            // 2D billboard vegetation, rocks, props and settlements, unchanged:
            // they stand on the voxel surface the same way they stood on the
            // height mesh.
            // ...and none of it underground: every tree, rock and building of a
            // tile is scattered on its SURFACE, which is the one part of the
            // world nobody in a cave can see. Decorating the ring down there was
            // most of what a cave cost and none of what it showed.
            if (type !== 'road' && type !== 'water' && !this._lodMode && !this._caves) {
                this._decorator.decorate(grp, wx, wy, biome, ts, (gx, gz) => this.getTerrainHeight(gx, gz));
            }

            this._scene.add(grp);
            return ch;
        }

        _buildSub(ch, si, sj) {
            const n = VOX.SUB_N;
            const geo = VoxelMesher.build(this.field, ch.wx, ch.wy,
                si * n, sj * n, n, 1, ch.px, ch.pz, this._caves);
            this._addMesh(ch, si + ':' + sj, geo);
        }

        // A patch is the ground, the turf on top of it, one mesh for each kind
        // of block it shows (brick, marble, a seam of ore - each with its own
        // picture), and the sheet of standing water where a river or a lake
        // runs above sea level.
        _addMesh(ch, key, res) {
            const old = ch.subs.get(key);
            if (old) {
                for (const m of old) {
                    ch.grp.remove(m);
                    if (m.geometry) m.geometry.dispose();
                }
                ch.subs.delete(key);
            }
            if (!res) return;
            const made = [];
            if (res.solid) {
                const mesh = new THREE.Mesh(res.solid, voxelMaterial());
                mesh.receiveShadow = true;
                ch.grp.add(mesh);
                made.push(mesh);
            }
            if (res.grass) {
                const mesh = new THREE.Mesh(res.grass, voxelGrassMaterial());
                mesh.receiveShadow = true;
                ch.grp.add(mesh);
                made.push(mesh);
            }
            // One mesh per KIND of block the patch actually shows, each drawn
            // with that block's own picture. Ordinary ground carries none at
            // all; a cave wall carries the country rock, whatever lens is in it
            // and the seams, and nothing else.
            if (res.blocks) {
                for (const b of res.blocks) {
                    const mesh = new THREE.Mesh(b.geo, voxelBlockMaterial(b.mat));
                    mesh.receiveShadow = true;
                    ch.grp.add(mesh);
                    made.push(mesh);
                }
            }
            if (res.water) {
                const mesh = new THREE.Mesh(res.water, voxelWaterMaterial());
                mesh.renderOrder = 2;
                ch.grp.add(mesh);
                made.push(mesh);
            }
            if (made.length) ch.subs.set(key, made);
        }

        _disposeChunk(key) {
            const ch = this._chunks.get(key);
            if (!ch) return;
            this._scene.remove(ch.grp);
            ch.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            ch.subs.clear();
            this._chunks.delete(key);
        }

        _clearChunks() {
            for (const key of [...this._chunks.keys()]) this._disposeChunk(key);
            this._pendingBuilds = true;
            this._lastCwx = this._lastCwy = undefined;
        }

        // ---------------------------------------------------------------------
        // Digging: which patch a change landed in
        // ---------------------------------------------------------------------
        _markDirty(wx, wy, lx, lz) {
            const n  = VOX.SUB_N;
            const si = Math.floor(lx / n), sj = Math.floor(lz / n);
            // A cube on a patch border shows a face into the patch next door.
            const di = (lx % n === 0) ? -1 : (lx % n === n - 1) ? 1 : 0;
            const dj = (lz % n === 0) ? -1 : (lz % n === n - 1) ? 1 : 0;
            for (const ii of di ? [si, si + di] : [si]) {
                for (const jj of dj ? [sj, sj + dj] : [sj]) {
                    if (ii < 0 || ii >= VOX.SUB || jj < 0 || jj >= VOX.SUB) {
                        // Spilled into the neighbouring tile: rebuild it whole,
                        // it is rare enough not to be worth a finer path.
                        const nwx = wx + (ii < 0 ? -1 : ii >= VOX.SUB ? 1 : 0);
                        const nwy = wy + (jj < 0 ? -1 : jj >= VOX.SUB ? 1 : 0);
                        this._dirty.add(nwx + ',' + nwy + ',*,*');
                        continue;
                    }
                    this._dirty.add(wx + ',' + wy + ',' + ii + ',' + jj);
                }
            }
        }

        _drainDirty(budget) {
            if (!this._dirty.size) return;
            let n = budget;
            for (const key of this._dirty) {
                if (n-- <= 0) break;
                this._dirty.delete(key);
                const [sx, sy, si, sj] = key.split(',');
                const ch = this._chunks.get(sx + ',' + sy);
                if (!ch) continue;
                if (ch.step !== 1 || si === '*') {
                    // Coarse or wholesale: rebuild the tile at its current step.
                    const step = ch.step;
                    this._disposeChunk(sx + ',' + sy);
                    this._chunks.set(sx + ',' + sy, this._buildChunk(Number(sx), Number(sy), step));
                } else {
                    this._buildSub(ch, Number(si), Number(sj));
                }
            }
        }

        // Force everything already built to be meshed again: used when the world
        // seed changes under the scene, or when a saved dig log is loaded.
        rebuildAll() {
            this.field.clearCache();
            this._clearChunks();
        }

        // ---------------------------------------------------------------------
        // Editing, wrapped so callers do not have to know the grid
        // ---------------------------------------------------------------------
        // Break the first cube along a ray. Returns the raycast hit, with the
        // material that came out on `broke`, or null.
        digRay(ox, oy, oz, dx, dy, dz, reach) {
            const hit = this.field.raycast(ox, oy, oz, dx, dy, dz, reach || VOX.REACH);
            if (!hit) return null;
            hit.broke = this.field.breakAt(hit.vx, hit.vy, hit.vz);
            return hit.broke ? hit : null;
        }

        // Put a cube against the face a ray lands on.
        placeRay(ox, oy, oz, dx, dy, dz, mat, reach) {
            const hit = this.field.raycast(ox, oy, oz, dx, dy, dz, reach || VOX.REACH);
            if (!hit) return null;
            const p = hit.place;
            return this.field.placeAt(p.vx, p.vy, p.vz, mat || MAT.DIRT) ? hit : null;
        }

        // A ball of ground taken out at once: a bumper at speed, a blast, a
        // heavy landing.
        carve(x, y, z, radius) { return this.field.carveSphere(x, y, z, radius, null); }

        // ---------------------------------------------------------------------
        // Streetlights (the last thing on a road tile that is still a prop)
        // ---------------------------------------------------------------------
        _getPoleMat() {
            if (!this._poleMat) {
                this._poleMat = new THREE.MeshLambertMaterial({
                    color: 0x6a6a70, map: loadVoxelTex('pole.png', 1)
                });
            }
            return this._poleMat;
        }

        _getLampMat() {
            if (!this._lampMat) {
                this._lampMat = new THREE.MeshLambertMaterial({
                    color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 1.0
                });
            }
            return this._lampMat;
        }

        _buildStreetlights(grp, wx, wy) {
            const ts    = this._ts;
            const dir   = getRoadDirectionAt(wx, wy);
            const sh    = ROAD_TOTAL_W / 2 + 12;
            const along = [-ts * 0.26, ts * 0.26];
            const HALF  = Math.PI / 2;

            const places = [];
            if (dir === 'horizontal') {
                for (const a of along) {
                    places.push({ x: a, z: -sh, rot: -HALF });
                    places.push({ x: a, z:  sh, rot:  HALF });
                }
            } else if (dir === 'vertical') {
                for (const a of along) {
                    places.push({ x: -sh, z: a, rot: 0 });
                    places.push({ x:  sh, z: a, rot: Math.PI });
                }
            } else {
                places.push({ x: -sh, z: 0,   rot: 0 });
                places.push({ x:  sh, z: 0,   rot: Math.PI });
                places.push({ x: 0,   z: -sh, rot: -HALF });
                places.push({ x: 0,   z:  sh, rot: HALF });
            }
            if (!places.length) return;

            const poleMat = this._getPoleMat();
            const lampMat = this._getLampMat();
            const poleGeo = new THREE.CylinderGeometry(0.7, 1.0, 30, 6).translate(0, 15, 0);
            const armGeo  = new THREE.BoxGeometry(12, 0.8, 0.8).translate(6, 29.6, 0);
            const lampGeo = new THREE.BoxGeometry(4, 1.6, 2.4).translate(12, 28.8, 0);

            const poles = new THREE.InstancedMesh(poleGeo, poleMat, places.length);
            const arms  = new THREE.InstancedMesh(armGeo,  poleMat, places.length);
            const lamps = new THREE.InstancedMesh(lampGeo, lampMat, places.length);

            const m = new THREE.Matrix4();
            const q = new THREE.Quaternion();
            const up = new THREE.Vector3(0, 1, 0);
            const pos = new THREE.Vector3();
            const one = new THREE.Vector3(1, 1, 1);
            places.forEach((p, i) => {
                q.setFromAxisAngle(up, p.rot);
                // Planted on the verge, sunk a touch so no pole ever hovers over
                // the lip of a cube.
                const py = this.getTerrainHeight(wx + 0.5 + p.x / ts, wy + 0.5 + p.z / ts) - ROAD_SINK - 1;
                pos.set(p.x, py, p.z);
                m.compose(pos, q, one);
                poles.setMatrixAt(i, m);
                arms.setMatrixAt(i, m);
                lamps.setMatrixAt(i, m);
            });
            grp.add(poles);
            grp.add(arms);
            grp.add(lamps);
        }

        dispose() {
            this._clearChunks();
            for (const mat of this._matCache.values()) mat.dispose();
            this._matCache.clear();
            if (this._poleMat) this._poleMat.dispose();
            if (this._lampMat) this._lampMat.dispose();
            this._poleMat = this._lampMat = null;
            disposeVoxelMaterial();
            // The block palette goes with the world, not with a scene: one
            // material per block is shared by every square in it, and rebuilding
            // them for the next drive would throw away the whole point of them.
            if (VW.Blocks) VW.Blocks.dispose();
            this._decorator.dispose();
            this.field.onEdit = null;
            this._dirty.clear();
        }
    }

    // The blocks a player may put back, exported so the tool and the HUD agree.
    VoxelTerrain.PLACEABLE = PLACEABLE;

    // Handed to the rest of the suite.
    Object.assign(VW, { VoxelTerrain });
})();
