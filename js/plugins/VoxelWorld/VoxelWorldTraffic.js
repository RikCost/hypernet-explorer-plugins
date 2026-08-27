//=============================================================================
// VoxelWorldTraffic.js
// VoxelWorld: true scale NPC road traffic
//
// Part of the VoxelWorld suite. The ground of that world is a field of small
// destructible voxels; this module is one slice of the machinery laid over it.
// Load order is fixed in plugins.js and every module reads the shared state it
// needs off window.VoxelWorld.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc VoxelWorld - true scale NPC road traffic
 * @author Omni-Lex
 *
 * @help
 * true scale NPC road traffic.
 *
 * One module of the VoxelWorld suite (VoxelWorldCore.js loads first). It
 * declares no plugin commands of its own; those live in VoxelWorldSystem.js.
 */

(() => {
    'use strict';

    const VW = window.VoxelWorld;
    if (!VW) { console.error('[VoxelWorld] core not loaded before VoxelWorldTraffic.js'); return; }

    const {
        HEADLIGHT_NIGHT, KMH_TO_UNITS, ROAD_LANE_OFF, TRAFFIC_COLORS, TRAFFIC_MAX,
        TRAFFIC_RING_MAX, TRAFFIC_RING_MIN, UNITS_PER_M, WORLD_TILE_SIZE,
        getRenderType, getRoadDirectionAt, loadTex, loadVoxelTex, sampleBiomeAt
    } = VW;

    // =========================================================================
    // TrafficManager, pooled low-poly cars that drive the road grid around the
    // camper. Cars follow their tile's road direction, keep to the right lane,
    // recycle when far, and glow head/tail lights at night. Bounded pool keeps
    // the draw-call cost flat regardless of how much road is on the map.
    // =========================================================================
    class TrafficManager {
        // `silent` mutes the near-miss horn (title-screen background drive).
        constructor(scene, silent) {
            this._scene  = scene;
            this._cars   = [];
            this._t      = 0;
            this._silent = !!silent;
            this._hornCd = 0;   // near-miss honk cooldown (s)

            // Shared materials (disposed once, in dispose()). Paint colours are
            // assigned per pool slot from TRAFFIC_COLORS at construction; every
            // other surface (glazing, black trim, rubber, rims) is shared by all.
            const bodyTex   = loadVoxelTex('metal.png', 1);   // subtle paint/metal detail
            this._bodyMats  = TRAFFIC_COLORS.map(c => new THREE.MeshLambertMaterial({ color: c, map: bodyTex }));
            this._fixedMats = new Map();   // per-type fixed liveries (taxi, bus, ...)
            // See-through glazing, matching the camper's own window treatment:
            // tinted, low opacity, no depth write so the cabin reads through it.
            this._glassMat  = new THREE.MeshLambertMaterial({
                color: 0x9fc6db, transparent: true, opacity: 0.32,
                depthWrite: false, side: THREE.DoubleSide
            });
            this._trimMat   = new THREE.MeshLambertMaterial({ color: 0x23252a });  // bumpers, pillars, skirts
            this._tyreMat   = new THREE.MeshLambertMaterial({ color: 0x121215 });
            this._rimMat    = new THREE.MeshLambertMaterial({ color: 0xb9bcc2 });
            this._headMat   = new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0 });
            this._tailMat   = new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.5 });

            // Nine low-poly silhouettes (hatch / sedan / coupe / SUV / pickup /
            // taxi / van / box truck / bus) with per-type geometry shared across
            // the pool, so the road carries a real mix of vehicles instead of
            // twelve identical boxes. Pool slots are dealt the types round-robin
            // from a shuffled list, so every type shows up on a busy road.
            this._types = this._buildTypes();
            const bag = this._types.slice();
            for (let i = bag.length - 1; i > 0; i--) {
                const j = (Math.random() * (i + 1)) | 0;
                const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
            }
            for (let i = 0; i < TRAFFIC_MAX; i++) this._cars.push(this._makeCar(bag[i % bag.length]));
        }

        // ---------------------------------------------------------------------
        // Vehicle silhouettes, authored in METRES with the origin on the road
        // surface at the centre of the vehicle and +Z pointing forward. Every
        // dimension is a real-world one, so UNITS_PER_M alone decides how the
        // traffic sits next to the camper.
        //
        //   parts  : [kind, [w,h,d], [x,y,z]] boxes stacked into the silhouette.
        //            'body'  takes the car's paint colour
        //            'glass' is see-through glazing (windscreen / side windows)
        //            'trim'  is black plastic: bumpers, pillars, skirts, racks
        //   wheel  : { r, w } tyre radius and width; track = half the wheel track
        //   axles  : wheel centre Z positions; steer:true axles turn into corners
        //   lights : lamp cluster half-offset x, height y and front/rear z
        // ---------------------------------------------------------------------
        _buildTypes() {
            const M = UNITS_PER_M;
            const profiles = [
                // Small hatchback: stubby nose, big glasshouse, tiny wheels.
                // 3.90 x 1.72 x 1.51 m, sill at 0.41 m so the tyres read clearly.
                { key: 'hatch', color: null,
                  parts: [
                      ['body',  [1.72, 0.58, 3.90], [0, 0.70,  0.00]],
                      ['trim',  [1.50, 0.26, 3.72], [0, 0.40,  0.00]],
                      ['glass', [1.62, 0.42, 1.90], [0, 1.20, -0.10]],
                      ['body',  [1.58, 0.10, 1.72], [0, 1.46, -0.22]]
                  ],
                  wheel: { r: 0.31, w: 0.21 }, track: 0.80,
                  axles: [{ z:  1.28, steer: true }, { z: -1.28 }],
                  lights: { x: 0.62, y: 0.72, w: 0.40, h: 0.16, zF: 1.96, zR: -1.96 } },

                // Three-box saloon: long bonnet, notchback roof over a boot deck.
                { key: 'sedan', color: null,
                  parts: [
                      ['body',  [1.80, 0.60, 4.70], [0, 0.72,  0.00]],
                      ['trim',  [1.58, 0.26, 4.50], [0, 0.41,  0.00]],
                      ['glass', [1.70, 0.42, 2.15], [0, 1.23, -0.05]],
                      ['body',  [1.66, 0.10, 1.85], [0, 1.49, -0.18]]
                  ],
                  wheel: { r: 0.32, w: 0.22 }, track: 0.82,
                  axles: [{ z:  1.55, steer: true }, { z: -1.50 }],
                  lights: { x: 0.66, y: 0.74, w: 0.44, h: 0.16, zF: 2.36, zR: -2.36 } },

                // Coupe: slammed, wide track, ducktail spoiler.
                { key: 'coupe', color: null,
                  parts: [
                      ['body',  [1.86, 0.52, 4.35], [0, 0.66,  0.00]],
                      ['trim',  [1.62, 0.22, 4.20], [0, 0.38,  0.00]],
                      ['glass', [1.74, 0.34, 1.80], [0, 1.09, -0.15]],
                      ['body',  [1.66, 0.09, 1.35], [0, 1.31, -0.40]],
                      ['body',  [1.52, 0.08, 0.32], [0, 1.00, -2.02]]
                  ],
                  wheel: { r: 0.33, w: 0.27 }, track: 0.84,
                  axles: [{ z:  1.45, steer: true }, { z: -1.40 }],
                  lights: { x: 0.68, y: 0.62, w: 0.46, h: 0.14, zF: 2.18, zR: -2.18 } },

                // SUV: tall body, upright glass, roof rails, chunky tyres.
                { key: 'suv', color: null,
                  parts: [
                      ['body',  [1.92, 0.78, 4.75], [0, 0.87,  0.00]],
                      ['trim',  [1.70, 0.30, 4.60], [0, 0.46,  0.00]],
                      ['glass', [1.84, 0.50, 2.55], [0, 1.51, -0.10]],
                      ['body',  [1.82, 0.13, 2.60], [0, 1.83, -0.15]],
                      ['trim',  [0.10, 0.09, 2.20], [ 0.74, 1.94, -0.15]],
                      ['trim',  [0.10, 0.09, 2.20], [-0.74, 1.94, -0.15]]
                  ],
                  wheel: { r: 0.37, w: 0.26 }, track: 0.86,
                  axles: [{ z:  1.50, steer: true }, { z: -1.45 }],
                  lights: { x: 0.70, y: 0.95, w: 0.44, h: 0.18, zF: 2.38, zR: -2.38 } },

                // Pickup: single cab up front, open load bed behind.
                { key: 'pickup', color: null,
                  parts: [
                      ['body',  [1.95, 0.62, 5.40], [0, 0.81,  0.00]],
                      ['trim',  [1.72, 0.28, 5.20], [0, 0.48,  0.00]],
                      ['glass', [1.84, 0.48, 1.35], [0, 1.36,  0.60]],
                      ['body',  [1.82, 0.12, 1.42], [0, 1.66,  0.58]],
                      ['body',  [0.13, 0.44, 2.35], [ 0.91, 1.34, -1.55]],
                      ['body',  [0.13, 0.44, 2.35], [-0.91, 1.34, -1.55]],
                      ['body',  [1.95, 0.44, 0.13], [0, 1.34, -2.70]]
                  ],
                  wheel: { r: 0.38, w: 0.27 }, track: 0.88,
                  axles: [{ z:  1.70, steer: true }, { z: -1.60 }],
                  lights: { x: 0.72, y: 0.84, w: 0.40, h: 0.20, zF: 2.70, zR: -2.70 } },

                // Taxi: saloon shell in a fixed livery with a roof sign.
                { key: 'taxi', color: 0xe8b820,
                  parts: [
                      ['body',  [1.80, 0.60, 4.70], [0, 0.72,  0.00]],
                      ['trim',  [1.58, 0.26, 4.50], [0, 0.41,  0.00]],
                      ['glass', [1.70, 0.42, 2.15], [0, 1.23, -0.05]],
                      ['body',  [1.66, 0.10, 1.85], [0, 1.49, -0.18]],
                      ['trim',  [0.58, 0.18, 0.24], [0, 1.63,  0.20]]
                  ],
                  wheel: { r: 0.32, w: 0.22 }, track: 0.82,
                  axles: [{ z:  1.55, steer: true }, { z: -1.50 }],
                  lights: { x: 0.66, y: 0.74, w: 0.44, h: 0.16, zF: 2.36, zR: -2.36 } },

                // Panel van: glazed cab up front, blank cargo box behind, one roof.
                { key: 'van', color: null,
                  parts: [
                      ['body',  [2.00, 1.05, 5.30], [0, 1.03,  0.00]],
                      ['trim',  [1.78, 0.30, 5.10], [0, 0.48,  0.00]],
                      ['glass', [1.92, 0.85, 1.20], [0, 1.98,  2.05]],
                      ['body',  [1.96, 0.85, 4.10], [0, 1.98, -0.60]],
                      ['body',  [1.98, 0.10, 5.26], [0, 2.45,  0.00]]
                  ],
                  wheel: { r: 0.36, w: 0.24 }, track: 0.90,
                  axles: [{ z:  1.75, steer: true }, { z: -1.60 }],
                  lights: { x: 0.74, y: 0.80, w: 0.40, h: 0.20, zF: 2.66, zR: -2.66 } },

                // Box truck: short glazed cab, tall cargo box, twin rear axle.
                { key: 'truck', color: null,
                  parts: [
                      ['body',  [2.35, 1.20, 2.20], [0, 1.25,  2.55]],
                      ['glass', [2.22, 0.62, 0.95], [0, 2.16,  2.90]],
                      ['body',  [2.28, 0.14, 2.10], [0, 2.54,  2.60]],
                      ['body',  [2.45, 2.20, 5.30], [0, 2.40, -1.25]],
                      ['trim',  [2.10, 0.30, 6.60], [0, 1.15, -0.60]],
                      ['trim',  [2.40, 0.30, 0.22], [0, 0.75,  3.66]]
                  ],
                  wheel: { r: 0.50, w: 0.32 }, track: 1.10,
                  axles: [{ z:  2.55, steer: true }, { z: -1.45 }, { z: -2.35 }],
                  lights: { x: 0.92, y: 0.90, w: 0.42, h: 0.22, zF: 3.68, zR: -3.92 } },

                // City bus: full-length window band under a flat roof, 3 axles.
                { key: 'bus', color: 0x2f6fb0,
                  parts: [
                      ['body',  [2.55, 1.05, 11.40], [0, 1.15,  0.00]],
                      ['trim',  [2.30, 0.30, 11.20], [0, 0.60,  0.00]],
                      ['glass', [2.52, 0.90, 10.60], [0, 2.12,  0.10]],
                      ['body',  [2.56, 0.30, 11.40], [0, 2.72,  0.00]],
                      ['trim',  [0.10, 0.90,  0.14], [ 1.27, 2.12,  2.20]],
                      ['trim',  [0.10, 0.90,  0.14], [-1.27, 2.12,  2.20]],
                      ['trim',  [0.10, 0.90,  0.14], [ 1.27, 2.12, -2.20]],
                      ['trim',  [0.10, 0.90,  0.14], [-1.27, 2.12, -2.20]]
                  ],
                  wheel: { r: 0.50, w: 0.30 }, track: 1.16,
                  axles: [{ z:  4.30, steer: true }, { z: -3.10 }, { z: -4.20 }],
                  lights: { x: 0.98, y: 0.92, w: 0.44, h: 0.22, zF: 5.72, zR: -5.72 } }
            ];

            return profiles.map(p => {
                const geos  = [];
                const parts = p.parts.map(([kind, d, pos]) => {
                    const geo = new THREE.BoxGeometry(d[0] * M, d[1] * M, d[2] * M);
                    geos.push(geo);
                    return { kind, geo, pos: [pos[0] * M, pos[1] * M, pos[2] * M] };
                });

                // One shared wheel: faceted tyre, proud hub cap and a spoke bar
                // across the face. The hub and bar are what make the rotation
                // actually visible - a smooth dark cylinder spins invisibly.
                const r  = p.wheel.r * M;
                const ww = p.wheel.w * M;
                const wheelGeo = {
                    tyre:  new THREE.CylinderGeometry(r, r, ww, 10).rotateZ(Math.PI / 2),
                    hub:   new THREE.CylinderGeometry(r * 0.52, r * 0.52, ww * 1.14, 8).rotateZ(Math.PI / 2),
                    spoke: new THREE.BoxGeometry(ww * 1.18, r * 1.62, r * 0.22)
                };
                for (const k in wheelGeo) geos.push(wheelGeo[k]);

                const lightGeo = new THREE.BoxGeometry(p.lights.w * M, p.lights.h * M, 0.12 * M);
                geos.push(lightGeo);

                // Real footprint (offsets included) for the car-following gap and
                // the camper collision bubble: a bus must reserve far more room
                // than a hatchback.
                let halfLen = 0, halfWidth = 0;
                for (const [, d, pos] of p.parts) {
                    halfLen   = Math.max(halfLen,   (Math.abs(pos[2]) + d[2] * 0.5) * M);
                    halfWidth = Math.max(halfWidth, (Math.abs(pos[0]) + d[0] * 0.5) * M);
                }

                return {
                    key: p.key, color: p.color, parts, geos, wheelGeo, lightGeo,
                    lights: { x: p.lights.x * M, y: p.lights.y * M,
                              zF: p.lights.zF * M, zR: p.lights.zR * M },
                    axles: p.axles, track: p.track * M, wheelR: r,
                    halfLen, halfWidth, radius: (halfLen + halfWidth) * 0.5
                };
            });
        }

        // Cached material for a type that ships in a fixed livery (taxi, bus).
        _fixedMat(color) {
            let m = this._fixedMats.get(color);
            if (!m) {
                m = new THREE.MeshLambertMaterial({ color, map: loadVoxelTex('metal.png', 1) });
                this._fixedMats.set(color, m);
            }
            return m;
        }

        _matFor(kind, bodyMat) {
            if (kind === 'glass') return this._glassMat;
            if (kind === 'trim')  return this._trimMat;
            return bodyMat;
        }

        _makeCar(type) {
            const g = new THREE.Group();
            const bodyMat = type.color
                ? this._fixedMat(type.color)
                : this._bodyMats[(Math.random() * this._bodyMats.length) | 0];

            for (const part of type.parts) {
                const mesh = new THREE.Mesh(part.geo, this._matFor(part.kind, bodyMat));
                mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
                if (part.kind === 'glass') mesh.renderOrder = 2;   // drawn after the shell
                else mesh.receiveShadow = true;                    // traffic skips the shadow pass
                g.add(mesh);
            }

            // Lamp clusters at the outer corners rather than one bar across the nose.
            const L = type.lights;
            for (const sx of [-1, 1]) {
                const head = new THREE.Mesh(type.lightGeo, this._headMat);
                head.position.set(sx * L.x, L.y, L.zF); g.add(head);
                const tail = new THREE.Mesh(type.lightGeo, this._tailMat);
                tail.position.set(sx * L.x, L.y, L.zR); g.add(tail);
            }

            // Each wheel is a steering pivot holding a spinning group, so the
            // front axle can turn into a corner while every wheel rolls.
            const wheels = [], steerPivots = [];
            for (const axle of type.axles) {
                for (const sx of [-1, 1]) {
                    const pivot = new THREE.Group();
                    pivot.position.set(sx * type.track, type.wheelR, axle.z * UNITS_PER_M);
                    const spin = new THREE.Group();
                    spin.add(new THREE.Mesh(type.wheelGeo.tyre,  this._tyreMat));
                    spin.add(new THREE.Mesh(type.wheelGeo.hub,   this._rimMat));
                    spin.add(new THREE.Mesh(type.wheelGeo.spoke, this._rimMat));
                    pivot.add(spin);
                    g.add(pivot);
                    wheels.push(spin);
                    if (axle.steer) steerPivots.push(pivot);
                }
            }

            g.visible = false;
            this._scene.add(g);
            return { group: g, wheels, steerPivots, x: 0, z: 0, ax: 0, az: 1, yaw: 0,
                     offX: 0, offZ: 0, speed: 0, active: false, type,
                     halfLen: type.halfLen, halfWidth: type.halfWidth, radius: type.radius,
                     wheelR: type.wheelR, tileX: 0, tileZ: 0,
                     turnDir: 0, turnCx: 0, turnCz: 0 };
        }

        _axisAllowed(dir, ax) {
            const horiz = Math.abs(ax) > 0.5; // travelling along X
            if (dir === 'horizontal') return horiz;
            if (dir === 'vertical')   return !horiz;
            return true; // crossings, tees, corners, unknown: let it through
        }

        _trySpawn(camX, camZ) {
            const cTileX = Math.floor(camX / WORLD_TILE_SIZE);
            const cTileZ = Math.floor(camZ / WORLD_TILE_SIZE);
            for (let attempt = 0; attempt < 6; attempt++) {
                const ang  = Math.random() * Math.PI * 2;
                const ring = TRAFFIC_RING_MIN + Math.random() * (TRAFFIC_RING_MAX - TRAFFIC_RING_MIN);
                const tx = cTileX + Math.round(Math.cos(ang) * ring);
                const tz = cTileZ + Math.round(Math.sin(ang) * ring);
                if (tx < 0 || tz < 0 || tx >= 256 || tz >= 256) continue;
                if (getRenderType(sampleBiomeAt(tx, tz).name) !== 'road') continue;

                const dir   = getRoadDirectionAt(tx, tz);
                const horiz = dir === 'horizontal' ? true
                            : dir === 'vertical'   ? false
                            : Math.random() < 0.5;
                const sign  = Math.random() < 0.5 ? 1 : -1;
                const ax    = horiz ? sign : 0;
                const az    = horiz ? 0 : sign;

                // Right-hand lane offset: right vector of travel = (az, -ax).
                const lane = ROAD_LANE_OFF;
                const cx = tx * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5 + az * lane;
                const cz = tz * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5 - ax * lane;

                const car = this._cars.find(c => !c.active);
                if (!car) return;
                car.x = cx; car.z = cz; car.ax = ax; car.az = az;
                car.tileX = tx; car.tileZ = tz;
                car.offX = 0; car.offZ = 0; car.turnDir = 0;
                // Heavier vehicles cruise slower than the light stuff.
                const heavy = car.type.key === 'bus' || car.type.key === 'truck';
                car.speed = (heavy ? 42 + Math.random() * 26 : 55 + Math.random() * 50) * KMH_TO_UNITS;
                car.baseSpeed = car.speed;
                car.active = true;
                car.group.visible = true;
                car.group.position.set(cx, 0, cz);
                car.yaw = Math.atan2(ax, az);
                car.group.rotation.y = car.yaw;
                for (const p of car.steerPivots) p.rotation.y = 0;
                return;
            }
        }

        update(camX, camZ, delta, nightFactor) {
            this._t += delta;
            if (this._hornCd > 0) this._hornCd -= delta;
            const ts = WORLD_TILE_SIZE;
            const recycleDist = TRAFFIC_RING_MAX * ts * 1.3;

            let active = 0;
            for (const car of this._cars) if (car.active) active++;
            if (active < TRAFFIC_MAX && Math.random() < 0.6) this._trySpawn(camX, camZ);

            for (const car of this._cars) {
                if (!car.active) continue;

                // Two speed governors, lowest wins: brake for the camper blocking
                // the lane, and keep a safe gap to the car ahead (so traffic never
                // drives through itself). Otherwise ease back up to cruise.
                let target = car.baseSpeed || car.speed;

                const relX = camX - car.x, relZ = camZ - car.z;
                const ahead = relX * car.ax + relZ * car.az;
                const side  = Math.abs(relX * car.az - relZ * car.ax);
                if (ahead > 0 && ahead < 110 && side < 26) {
                    target = Math.min(target, 8);
                    // Quick honk when the camper cuts in close ahead (throttled,
                    // silent if the SE file is absent).
                    if (ahead < 60 && this._hornCd <= 0 && !this._silent) {
                        this._hornCd = 2.5;
                        try { AudioManager.playSe({ name: 'Blow2', volume: 40, pitch: 80, pan: 0 }); } catch (e) {}
                    }
                }

                // Car-following: nearest active car ahead in the same lane.
                let leadGap = Infinity, leadSpeed = 0;
                for (const other of this._cars) {
                    if (other === car || !other.active) continue;
                    if (other.ax * car.ax + other.az * car.az < 0.5) continue;   // same heading only
                    const rx = other.x - car.x, rz = other.z - car.z;
                    const fwd = rx * car.ax + rz * car.az;
                    const lat = Math.abs(rx * car.az - rz * car.ax);
                    if (fwd > 0 && lat < 16 && fwd < leadGap) { leadGap = fwd; leadSpeed = other.speed; }
                }
                const minGap = car.halfLen + 20;
                if (leadGap < minGap)            target = Math.min(target, leadSpeed * 0.85);
                else if (leadGap < minGap * 2.5) target = Math.min(target, leadSpeed + 8);

                // Ease toward the governed target (brake harder than accelerate).
                const rate = target < car.speed ? 150 : 32;
                car.speed += Math.max(-rate * delta, Math.min(rate * delta, target - car.speed));
                if (car.speed < 0) car.speed = 0;

                car.x += car.ax * car.speed * delta;
                car.z += car.az * car.speed * delta;

                // Turn at junctions: entering a crossing / tee tile, sometimes
                // commit to a 90 degree turn onto the perpendicular road. The
                // turn is only executed once the car actually reaches the middle
                // of the junction, so it swings round the centre instead of
                // teleporting half a tile the instant it crosses the tile edge.
                const ntx = Math.floor(car.x / ts), ntz = Math.floor(car.z / ts);
                if (ntx !== car.tileX || ntz !== car.tileZ) {
                    car.tileX = ntx; car.tileZ = ntz;
                    car.turnDir = 0;
                    if (ntx >= 0 && ntz >= 0 && ntx < 256 && ntz < 256 &&
                        getRenderType(sampleBiomeAt(ntx, ntz).name) === 'road') {
                        const jdir = getRoadDirectionAt(ntx, ntz);
                        if (jdir !== 'horizontal' && jdir !== 'vertical' && Math.random() < 0.4) {
                            car.turnDir = Math.random() < 0.5 ? 1 : -1;
                            car.turnCx  = ntx * ts + ts * 0.5;
                            car.turnCz  = ntz * ts + ts * 0.5;
                        }
                    }
                }
                if (car.turnDir) {
                    // Distance still to run before the junction centre, measured
                    // along the current heading.
                    const toCentre = (car.turnCx - car.x) * car.ax + (car.turnCz - car.z) * car.az;
                    if (toCentre <= 0) {
                        const s = car.turnDir;
                        const nax = car.az * s, naz = -car.ax * s;
                        car.ax = nax; car.az = naz;
                        car.turnDir = 0;
                        // Only the coordinate perpendicular to the NEW heading is
                        // snapped, onto that road's right-hand lane; the one along
                        // it is already at the junction centre. The leftover step
                        // is carried as a render offset and eased out below.
                        const px = car.x, pz = car.z;
                        if (Math.abs(nax) > 0.5) car.z = car.turnCz - nax * ROAD_LANE_OFF;
                        else                     car.x = car.turnCx + naz * ROAD_LANE_OFF;
                        car.offX += px - car.x;
                        car.offZ += pz - car.z;
                    }
                }

                const dx = car.x - camX, dz = car.z - camZ;
                if (Math.abs(dx) > recycleDist || Math.abs(dz) > recycleDist) {
                    car.active = false; car.group.visible = false; continue;
                }
                const tx = Math.floor(car.x / ts);
                const tz = Math.floor(car.z / ts);
                if (tx < 0 || tz < 0 || tx >= 256 || tz >= 256) {
                    car.active = false; car.group.visible = false; continue;
                }
                const dir = getRoadDirectionAt(tx, tz);
                if (getRenderType(sampleBiomeAt(tx, tz).name) !== 'road' || !this._axisAllowed(dir, car.ax)) {
                    car.active = false; car.group.visible = false; continue;
                }

                // Ease the leftover lane-change step out of the render position so
                // a junction snap reads as a quick slide, never as a teleport.
                if (car.offX || car.offZ) {
                    const k = Math.max(0, 1 - delta * 7);
                    car.offX *= k; car.offZ *= k;
                    if (Math.abs(car.offX) < 0.05) car.offX = 0;
                    if (Math.abs(car.offZ) < 0.05) car.offZ = 0;
                }
                car.group.position.set(car.x + car.offX, 0, car.z + car.offZ);

                // Swing the visual heading toward the logical one and steer the
                // front wheels by however much yaw is still owed, so a corner is
                // a turn of the wheel rather than an instant 90 degree flip.
                const targetYaw = Math.atan2(car.ax, car.az);
                let dYaw = targetYaw - car.yaw;
                while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
                while (dYaw < -Math.PI) dYaw += Math.PI * 2;
                const swing = Math.min(Math.abs(dYaw), 3.2 * delta);
                car.yaw += dYaw < 0 ? -swing : swing;
                car.group.rotation.y = car.yaw;
                const steer = Math.max(-0.55, Math.min(0.55, dYaw * 1.2));
                for (const p of car.steerPivots) p.rotation.y = steer;

                // Roll the wheels at the true rate for their radius.
                const spin = (car.speed * delta) / Math.max(0.001, car.wheelR);
                for (const w of car.wheels) w.rotation.x += spin;
            }

            // Global head/tail light brightness by time of day.
            const night = 1 - Math.min(1, nightFactor / HEADLIGHT_NIGHT);
            this._headMat.opacity = night;
            this._tailMat.opacity = 0.4 + night * 0.6;
        }

        dispose() {
            for (const car of this._cars) this._scene.remove(car.group);
            for (const t of this._types) {
                for (const geo of t.geos) { if (geo) geo.dispose(); }
            }
            this._glassMat.dispose();
            this._trimMat.dispose();
            this._tyreMat.dispose();
            this._rimMat.dispose();
            this._headMat.dispose();
            this._tailMat.dispose();
            for (const m of this._bodyMats) m.dispose();
            for (const m of this._fixedMats.values()) m.dispose();
            this._fixedMats.clear();
            this._cars.length = 0;
        }
    }

    // Handed to the rest of the suite.
    Object.assign(VW, {
        TrafficManager
    });
})();
