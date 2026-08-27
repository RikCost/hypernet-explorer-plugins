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
        HEADLIGHT_NIGHT, KMH_TO_UNITS, ROAD_HALF_LANE, ROAD_LANE_OFF, TRAFFIC_MAX,
        TRAFFIC_RING_MAX, TRAFFIC_RING_MIN, TRAFFIC_VEHICLES, UNITS_PER_M,
        VehicleBillboard, WORLD_TILE_SIZE,
        getRenderType, getRoadDirectionAt, sampleBiomeAt
    } = VW;

    // =========================================================================
    // TrafficManager, pooled traffic driving the road grid around the camper.
    //
    // Every vehicle out here is a DIRECTIONAL SPRITE, not a model: the same
    // walk sheet under img/characters/Vehicles that the 2D map drives
    // (Vehicle/RoadCarAI.js), stood up as a card that turns to the lens with
    // the row picked from where the eye stands relative to the way the vehicle
    // is pointing. Nine hand-built low-poly shells used to do this job; one
    // sheet each does it for a fraction of the geometry AND makes the traffic
    // met out here visibly the same traffic met on the flat map.
    //
    // The road they drive is the dual carriageway the 2D generator lays down
    // (ProceduralMapRoadGenerator): two carriageways with a median between
    // them, each carriageway two lanes wide with a broken line down its own
    // middle. A car takes the carriageway its direction of travel calls for and
    // then ONE of that carriageway's two lanes - never the paint itself. Cars
    // follow their tile's road direction, turn at junctions, keep a gap to the
    // car ahead, recycle when far, and light up at night.
    // =========================================================================
    class TrafficManager {
        // `silent` mutes the near-miss horn (title-screen background drive).
        constructor(scene, silent) {
            this._scene  = scene;
            this._cars   = [];
            this._t      = 0;
            this._silent = !!silent;
            this._hornCd = 0;   // near-miss honk cooldown (s)

            // Lamps are the one thing a flat card cannot draw for itself: a
            // sprite has its headlights painted on and they do not light up at
            // dusk. Two shared unlit materials and one shared quad, hung off a
            // little group that carries the vehicle's heading, do that much.
            this._headMat = new THREE.MeshBasicMaterial({
                color: 0xfff3c0, transparent: true, opacity: 0, depthWrite: false });
            this._tailMat = new THREE.MeshBasicMaterial({
                color: 0xff3322, transparent: true, opacity: 0.5, depthWrite: false });
            this._lampGeo = new THREE.PlaneGeometry(0.42 * UNITS_PER_M, 0.18 * UNITS_PER_M);

            this._types = TRAFFIC_VEHICLES.map(v => ({
                key: v.key, sheet: v.sheet, heavy: !!v.heavy,
                length:    v.lengthM * UNITS_PER_M,
                halfLen:   v.lengthM * UNITS_PER_M * 0.5,
                halfWidth: v.widthM  * UNITS_PER_M * 0.5,
                radius:   (v.lengthM + v.widthM) * UNITS_PER_M * 0.25
            }));

            // Pool slots are dealt the types round-robin from a shuffled list,
            // so a busy road carries a real mix rather than twelve of one car.
            const bag = this._types.slice();
            for (let i = bag.length - 1; i > 0; i--) {
                const j = (Math.random() * (i + 1)) | 0;
                const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
            }
            for (let i = 0; i < TRAFFIC_MAX; i++) this._cars.push(this._makeCar(bag[i % bag.length]));
        }

        // One pooled vehicle: its card, and the pair of lamps that sit at the
        // ends of it. The card is added to the scene directly rather than to a
        // group of its own - a billboard is placed in world space and turns
        // itself to the camera, so there is nothing for a parent to rotate.
        _makeCar(type) {
            const board = new VehicleBillboard(type.sheet, type.length);
            board.setVisible(false);
            this._scene.add(board.mesh);

            // The lamps DO carry the heading: they are points on the vehicle,
            // not a picture of it.
            const lamps = new THREE.Group();
            const y = 0.75 * UNITS_PER_M;
            for (const sx of [-1, 1]) {
                const head = new THREE.Mesh(this._lampGeo, this._headMat);
                head.position.set(sx * type.halfWidth * 0.62, y, type.halfLen);
                lamps.add(head);
                const tail = new THREE.Mesh(this._lampGeo, this._tailMat);
                tail.position.set(sx * type.halfWidth * 0.62, y, -type.halfLen);
                tail.rotation.y = Math.PI;
                lamps.add(tail);
            }
            lamps.visible = false;
            this._scene.add(lamps);

            return { board, lamps, x: 0, z: 0, ax: 0, az: 1, yaw: 0,
                     offX: 0, offZ: 0, speed: 0, active: false, type,
                     lane: ROAD_LANE_OFF, halfLen: type.halfLen,
                     halfWidth: type.halfWidth, radius: type.radius,
                     tileX: 0, tileZ: 0, turnDir: 0, turnCx: 0, turnCz: 0 };
        }

        // Put one out of frame, freeing its pool slot for the next spawn.
        _park(car) {
            car.active = false;
            car.board.setVisible(false);
            car.lamps.visible = false;
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

                const car = this._cars.find(c => !c.active);
                if (!car) return;

                // The carriageway on the right of the median (right vector of
                // travel = (az, -ax)), and then one of ITS two lanes: the paint
                // runs down the middle of the carriageway, so a vehicle sits
                // half a lane either side of it and never on it.
                car.lane = ROAD_LANE_OFF + (Math.random() < 0.5 ? -1 : 1) * ROAD_HALF_LANE;
                const cx = tx * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5 + az * car.lane;
                const cz = tz * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5 - ax * car.lane;

                car.x = cx; car.z = cz; car.ax = ax; car.az = az;
                car.tileX = tx; car.tileZ = tz;
                car.offX = 0; car.offZ = 0; car.turnDir = 0;
                // Heavier vehicles cruise slower than the light stuff.
                car.speed = (car.type.heavy ? 42 + Math.random() * 26
                                            : 55 + Math.random() * 50) * KMH_TO_UNITS;
                car.baseSpeed = car.speed;
                car.active = true;
                car.yaw = Math.atan2(ax, az);
                car.board.yaw = car.yaw;
                car.board.setPosition(cx, 0, cz);
                car.board.setVisible(true);
                car.lamps.position.set(cx, 0, cz);
                car.lamps.rotation.y = car.yaw;
                car.lamps.visible = true;
                return;
            }
        }

        update(camX, camZ, delta, dayFactor, camYaw) {
            const day = dayFactor == null ? 1 : dayFactor;
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
                        if (Math.abs(nax) > 0.5) car.z = car.turnCz - nax * car.lane;
                        else                     car.x = car.turnCx + naz * car.lane;
                        car.offX += px - car.x;
                        car.offZ += pz - car.z;
                    }
                }

                const dx = car.x - camX, dz = car.z - camZ;
                if (Math.abs(dx) > recycleDist || Math.abs(dz) > recycleDist) { this._park(car); continue; }
                const tx = Math.floor(car.x / ts);
                const tz = Math.floor(car.z / ts);
                if (tx < 0 || tz < 0 || tx >= 256 || tz >= 256) { this._park(car); continue; }
                const dir = getRoadDirectionAt(tx, tz);
                if (getRenderType(sampleBiomeAt(tx, tz).name) !== 'road' || !this._axisAllowed(dir, car.ax)) {
                    this._park(car); continue;
                }

                // Ease the leftover lane-change step out of the render position so
                // a junction snap reads as a quick slide, never as a teleport.
                if (car.offX || car.offZ) {
                    const k = Math.max(0, 1 - delta * 7);
                    car.offX *= k; car.offZ *= k;
                    if (Math.abs(car.offX) < 0.05) car.offX = 0;
                    if (Math.abs(car.offZ) < 0.05) car.offZ = 0;
                }
                const rx = car.x + car.offX, rz = car.z + car.offZ;

                // Swing the heading the card is READ at toward the logical one,
                // so a corner is a vehicle turning rather than an instant flip
                // of which side of it you are looking at.
                const targetYaw = Math.atan2(car.ax, car.az);
                let dYaw = targetYaw - car.yaw;
                while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
                while (dYaw < -Math.PI) dYaw += Math.PI * 2;
                const swing = Math.min(Math.abs(dYaw), 3.2 * delta);
                car.yaw += dYaw < 0 ? -swing : swing;

                car.board.yaw = car.yaw;
                car.board.setPosition(rx, 0, rz);
                car.board.setDaylight(day);
                car.board.update(camX, camZ, camYaw || 0);
                car.lamps.position.set(rx, 0, rz);
                car.lamps.rotation.y = car.yaw;
                car.lamps.visible = car.board.mesh.visible;
            }

            // Global head/tail light brightness by time of day.
            const night = 1 - Math.min(1, day / HEADLIGHT_NIGHT);
            this._headMat.opacity = night;
            this._tailMat.opacity = 0.4 + night * 0.6;
        }

        dispose() {
            for (const car of this._cars) {
                car.board.dispose();
                this._scene.remove(car.lamps);
            }
            this._lampGeo.dispose();
            this._headMat.dispose();
            this._tailMat.dispose();
            this._cars.length = 0;
        }
    }

    // Handed to the rest of the suite.
    Object.assign(VW, {
        TrafficManager
    });
})();
