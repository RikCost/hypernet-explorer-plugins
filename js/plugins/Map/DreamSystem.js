//=============================================================================
// DreamSystem.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Dream System v2.1.0 (3D surreal on-foot dream worlds, PSX shader)
 * @author Omni-Lex
 * @version 2.1.0
 * @description Drops the sleeper into a fullscreen 3D surreal dreamscape built from
 * a random dream map's terrain tags. On foot, free-flight, PSX retro look, and
 * randomized roaming 3D battlers. Inspired by Yume Nikki / Yume 2kki / LSD.
 *
 * @param dreamMaps
 * @text Dream Maps
 * @desc List of map IDs whose terrain tags shape the dream worlds (comma separated)
 * @type string
 * @default 105,106,109,108,107,103,578,579,589,581,582,583
 *
 * @param enemyCount
 * @text Dream Entities
 * @desc How many 3D battlers wander/haunt the dream (randomized appearance + scale)
 * @type number
 * @min 0
 * @max 60
 * @default 16
 *
 * @param flashColors
 * @text Flash Colors
 * @desc Hex colors used for the dream-shift flash (comma separated, no #)
 * @type string
 * @default FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF
 *
 * @param worldTiles
 * @text World Tiling
 * @desc Repeats the source grid NxN to enlarge the dream (3 = ~10x bigger). The world always loops seamlessly.
 * @type number
 * @min 1
 * @max 6
 * @default 3
 *
 * @command StartDream
 * @text Start Dream
 * @desc Begin the 3D dream sequence
 *
 * @command changeDream
 * @text Change Dream
 * @desc Flash and rebuild the dream from a different random map
 *
 * @help DreamSystem.js
 *
 * Plugin Commands:
 *   StartDream  - Begins the dream (builds a 3D surreal world from a random map).
 *   changeDream - Flashes and rebuilds the dream from another random map.
 *
 * In the dream:
 *   - WASD / arrows walk on foot, mouse (click to lock) or right-stick looks.
 *   - DOUBLE-TAP SPACE to take off and fly; double-tap SPACE again to land.
 *     A single SPACE tap hops/jumps while grounded.
 *   - Hold Shift to move faster.
 *   - Esc / Cancel opens the wake-up prompt, drawn as a DOM overlay ON the 3D dream
 *     (not RPG Maker choices). "Pinch cheeks" wakes; "Keep dreaming" resumes.
 *   - OK / Enter shifts you to a new dream (LSD flash + rebuild).
 *   - TOUCHING a dream entity triggers an LSD-emulator strobe and drops you into a
 *     different dream map.
 *
 * The world is enlarged ~WORLD_TILES^2 (default ~10x) and loops perfectly: terrain,
 * props, colour and entities are all periodic, so walking any direction wraps back
 * seamlessly with no visible edge.
 *
 * Each of the 8 terrain tags (0-7) of the source map becomes a distinct, strange
 * biome. The whole scene renders through the shared PSXShader for a PlayStation-1
 * wobble, dithering and low-res crunch. The world is populated with battlers from
 * 3DBattlerSystem.js, their generation randomized and their scale pushed large,
 * with a rare chance of gigantic, world-filling horrors.
 *
 * Requires THREE.js + PSXShader.js + 3DBattlerSystem.js (and its families) loaded.
 * ============================================================================
 */

(() => {
    'use strict';

    const pluginName = 'DreamSystem';
    const parameters = PluginManager.parameters(pluginName);

    const dreamMaps = (parameters['dreamMaps'] || '1')
        .split(',').map(id => parseInt(id.trim(), 10)).filter(n => n > 0);
    const ENEMY_COUNT = Math.max(0, parseInt(parameters['enemyCount'] || '16', 10));
    const flashColors = (parameters['flashColors'] || 'FF00FF')
        .split(',').map(c => c.trim());
    const WORLD_TILES = Math.max(1, parseInt(parameters['worldTiles'] || '3', 10));

    let dreamActive = false;
    window.dreamActive = false;

    const hasTHREE = (typeof THREE !== 'undefined');
    if (!hasTHREE) {
        console.error('[DreamSystem] THREE.js not loaded; 3D dreams are disabled.');
    }

    // =========================================================================
    // Self-contained seeded Perlin noise (surreal ground warp).
    // =========================================================================
    const _perm = new Uint8Array(512);
    function initPerlin(seed) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = ((seed || 1337) >>> 0);
        for (let i = 255; i > 0; i--) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const j = s % (i + 1);
            const t = p[i]; p[i] = p[j]; p[j] = t;
        }
        for (let i = 0; i < 512; i++) _perm[i] = p[i & 255];
    }
    initPerlin(1337);
    function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function _lerp(t, a, b) { return a + t * (b - a); }
    function _grad(h, x, y) {
        h &= 7;
        const u = h < 4 ? x : y;
        const v = h < 4 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    function perlin2(x, y) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        const u = _fade(x), v = _fade(y);
        const A = _perm[X] + Y, B = _perm[X + 1] + Y;
        return _lerp(v,
            _lerp(u, _grad(_perm[A], x, y), _grad(_perm[B], x - 1, y)),
            _lerp(u, _grad(_perm[A + 1], x, y - 1), _grad(_perm[B + 1], x - 1, y - 1)));
    }

    // =========================================================================
    // Surreal biome table, one entry per terrain tag (0-7).
    // baseY  : ground offset (water dips, walls plateau).
    // amp    : perlin warp amplitude of the ground.
    // prop   : decoration archetype placed across the biome's cells.
    // density: 0..1 chance a cell spawns the prop (1 = every cell, for walls).
    // floats : props hover above the ground and drift.
    // =========================================================================
    const CELL = 16;            // world units per source-map tile
    const WALL_H = 46;          // height of maze monoliths
    const MARGIN = 1400;        // terrain/prop overscan (>= fog view dist) so the loop seam is never visible
    // i18n-ignore-start  the name here is shadowed by the getter below and
    // kept only so the table reads; the caption comes from Dream.biome.<i>
    const BIOMES = [
        // 0 - generic / default ground
        { name: 'Pale Vestibule', g0: 0xe6e2d4, g1: 0xa89f86, sky: 0xcdc6ae,
          baseY: 0,  amp: 4,  prop: 'monolith', accent: 0x14141c, floats: false, density: 0.04 },
        // 1 - flesh / eyes
        { name: 'Eye Garden',     g0: 0x7c1414, g1: 0x350707, sky: 0x401212,
          baseY: 0,  amp: 7,  prop: 'eye',      accent: 0xf3eee0, floats: false, density: 0.05 },
        // 2 - neon lattice (floating glow cubes)
        { name: 'Neon Lattice',   g0: 0x121225, g1: 0x271a40, sky: 0x07060f,
          baseY: 0,  amp: 2,  prop: 'glowcube', accent: 0x32ffd2, floats: true,  density: 0.06 },
        // 3 - water (Mercury Sea), tag 3 = Water terrain
        { name: 'Mercury Sea',    g0: 0x5a6573, g1: 0x2b3340, sky: 0x6a7bb0,
          baseY: -11, amp: 1.5, prop: 'none',   accent: 0x9fc1e2, floats: false, density: 0, water: true },
        // 4 - wall / climb, tag 4 = Wall terrain -> static maze monoliths
        { name: 'Static Maze',    g0: 0x262626, g1: 0x0e0e0e, sky: 0x1d1d1d,
          baseY: 6,  amp: 1,  prop: 'wall',     accent: 0x000000, floats: false, density: 1, wall: true },
        // 5 - candy viscera
        { name: 'Candy Viscera',  g0: 0xe87aa2, g1: 0xab3f62, sky: 0xf2a6c6,
          baseY: 0,  amp: 6,  prop: 'organic',  accent: 0xff9ec6, floats: false, density: 0.06 },
        // 6 - inverted dunes (floating arches)
        { name: 'Inverted Dunes', g0: 0xc8a85a, g1: 0x88682e, sky: 0x9a6a2e,
          baseY: 0,  amp: 12, prop: 'arch',     accent: 0xffe0a0, floats: true,  density: 0.03 },
        // 7 - number static, tag 7 = No Furniture -> sparse drifting glyphs only
        { name: 'Number Static',  g0: 0x050507, g1: 0x101020, sky: 0x000006,
          baseY: 0,  amp: 2,  prop: 'glyph',    accent: 0x40ff66, floats: true,  density: 0.05 }
    ];
    // i18n-ignore-end
    // The dream-biome caption resolves on read; everything else in the table
    // is geometry and palette.
    BIOMES.forEach((b, i) => Object.defineProperty(b, 'name', {
        get: () => T('Dream.biome.' + i)
    }));

    function hash01(x, y, i) {
        const h = Math.sin(x * 12.9898 + y * 78.233 + i * 37.719) * 43758.5453;
        return h - Math.floor(h);
    }

    // =========================================================================
    // Dream map terrain loader. Reads a map JSON off disk (without transferring
    // the player there) and reduces it to a width x height grid of terrain tags.
    // =========================================================================
    function loadDreamGrid(mapId) {
        const file = 'data/Map%1.json'.replace('%1', String(mapId).padStart(3, '0'));
        return fetch(file)
            .then(r => r.json())
            .then(data => {
                const w = data.width, h = data.height;
                const ts = $dataTilesets ? $dataTilesets[data.tilesetId] : null;
                const flags = ts ? ts.flags : null;
                const grid = new Uint8Array(w * h);
                const tileId = (x, y, z) => data.data[(z * h + y) * w + x] || 0;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        let tag = 0;
                        // Use the topmost layer (3..0) that holds a tile + has a tag.
                        for (let z = 3; z >= 0; z--) {
                            const t = tileId(x, y, z);
                            if (!t) continue;
                            const tg = flags ? (flags[t] >> 12) : 0;
                            if (tg) { tag = tg; break; }
                            if (z === 0) tag = 0;
                        }
                        grid[y * w + x] = tag & 7;
                    }
                }
                return { id: mapId, width: w, height: h, grid };
            })
            .catch(err => {
                console.error('[DreamSystem] Failed to load dream map', mapId, err);
                // Fallback: a small noise grid so the dream still builds.
                const w = 40, h = 40, grid = new Uint8Array(w * h);
                for (let i = 0; i < grid.length; i++) {
                    grid[i] = Math.floor(Math.abs(perlin2(i % w * 0.2, Math.floor(i / w) * 0.2)) * 8) & 7;
                }
                return { id: mapId, width: w, height: h, grid };
            });
    }

    // =========================================================================
    // On-foot / flight first-person controller.
    // =========================================================================
    class DreamController {
        constructor(camera, scene) {
            this.camera = camera;
            this.scene = scene;
            this.yaw = new THREE.Group();
            this.pitch = new THREE.Group();
            this.yaw.add(this.pitch);
            this.pitch.add(camera);
            scene.add(this.yaw);
            camera.position.set(0, 0, 0);
            camera.rotation.set(0, 0, 0);

            this.move = { f: false, b: false, l: false, r: false, sprint: false, up: false, down: false };
            this.vy = 0;
            this.onGround = true;
            this.flying = false;
            this.isLocked = false;
            this.getGroundY = null;     // (x,z) => terrain height
            this.eye = 9;

            this._onMouseMove = this._onMouseMove.bind(this);
            this._onClick = this._onClick.bind(this);
            this._onKeyDown = this._onKeyDown.bind(this);
            this._onKeyUp = this._onKeyUp.bind(this);
            this._onPLChange = this._onPLChange.bind(this);
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('click', this._onClick);
            document.addEventListener('keydown', this._onKeyDown);
            document.addEventListener('keyup', this._onKeyUp);
            document.addEventListener('pointerlockchange', this._onPLChange);

            // Double-tap SPACE -> toggle flight; single tap -> jump.
            this._lastSpace = -1e9;
            this._jumpTimer = null;
        }

        setStart(x, y, z) { this.yaw.position.set(x, y, z); }

        _onMouseMove(e) {
            if (!this.isLocked) return;
            const mx = e.movementX || 0, my = e.movementY || 0;
            this.yaw.rotation.y -= mx * 0.0022;
            this.pitch.rotation.x -= my * 0.0022;
            this.pitch.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch.rotation.x));
        }
        _menuOpen() { return !!(window.DreamSystem && window.DreamSystem._scene && window.DreamSystem._scene._menuOpen); }
        _onClick() { if (dreamActive && !this.isLocked && !this._menuOpen()) document.body.requestPointerLock(); }
        _onPLChange() { this.isLocked = document.pointerLockElement === document.body; }

        _onKeyDown(e) {
            if (!dreamActive || this._menuOpen()) return;
            switch (e.code) {
                case 'KeyW': this.move.f = true; break;
                case 'KeyS': this.move.b = true; break;
                case 'KeyA': this.move.l = true; break;
                case 'KeyD': this.move.r = true; break;
                case 'ShiftLeft': case 'ShiftRight': this.move.sprint = true; break;
                case 'ControlLeft': case 'ControlRight': this.move.down = true; break;
                case 'Space':
                    e.preventDefault();
                    this._handleSpace();
                    break;
            }
        }
        _onKeyUp(e) {
            if (!dreamActive) return;
            switch (e.code) {
                case 'KeyW': this.move.f = false; break;
                case 'KeyS': this.move.b = false; break;
                case 'KeyA': this.move.l = false; break;
                case 'KeyD': this.move.r = false; break;
                case 'ShiftLeft': case 'ShiftRight': this.move.sprint = false; break;
                case 'ControlLeft': case 'ControlRight': this.move.down = false; break;
            }
        }

        _handleSpace() {
            const now = performance.now();
            if (now - this._lastSpace < 320) {
                // Second tap within the window: this is a double-tap -> fly toggle.
                if (this._jumpTimer) { clearTimeout(this._jumpTimer); this._jumpTimer = null; }
                this._lastSpace = -1e9;
                this.toggleFlight();
            } else {
                this._lastSpace = now;
                // Defer the jump so a quick second tap can cancel it for flight.
                if (this._jumpTimer) clearTimeout(this._jumpTimer);
                this._jumpTimer = setTimeout(() => {
                    this._jumpTimer = null;
                    if (!this.flying && this.onGround) { this.vy = 64; this.onGround = false; }
                }, 200);
            }
        }

        toggleFlight() {
            this.flying = !this.flying;
            this.vy = 0;
            if (typeof SoundManager !== 'undefined') {
                this.flying ? SoundManager.playOk() : SoundManager.playCancel();
            }
        }

        update(delta) {
            const fwd = (this.move.f || Input.isPressed('up')) ? 1 : 0;
            const back = (this.move.b || Input.isPressed('down')) ? 1 : 0;
            const lft = (this.move.l || Input.isPressed('left')) ? 1 : 0;
            const rgt = (this.move.r || Input.isPressed('right')) ? 1 : 0;
            const sprint = this.move.sprint || Input.isPressed('shift');

            const dz = fwd - back;        // forward axis
            const dx = rgt - lft;         // strafe axis

            if (this.flying) {
                const spd = 150 * (sprint ? 1.9 : 1);
                // Fly along the full look direction (pitch included) for W/S.
                const dir = new THREE.Vector3();
                this.camera.getWorldDirection(dir);
                const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
                this.yaw.position.addScaledVector(dir, dz * spd * delta);
                this.yaw.position.addScaledVector(right, dx * spd * delta);
                // Optional vertical nudge with jump/ctrl.
                if (this.move.down) this.yaw.position.y -= spd * delta;
                // Never sink below the ground.
                const gy = (this.getGroundY ? this.getGroundY(this.yaw.position.x, this.yaw.position.z) : 0) + this.eye;
                if (this.yaw.position.y < gy) this.yaw.position.y = gy;
            } else {
                const spd = 74 * (sprint ? 1.85 : 1);
                // Walk on the horizontal plane relative to yaw only.
                const sinY = Math.sin(this.yaw.rotation.y), cosY = Math.cos(this.yaw.rotation.y);
                const vx = (dx * cosY - dz * sinY);
                const vz = (-dz * cosY - dx * sinY);
                const len = Math.hypot(vx, vz) || 1;
                this.yaw.position.x += (vx / len) * spd * delta * (dx || dz ? 1 : 0);
                this.yaw.position.z += (vz / len) * spd * delta * (dx || dz ? 1 : 0);

                // Gravity + ground follow.
                const gy = (this.getGroundY ? this.getGroundY(this.yaw.position.x, this.yaw.position.z) : 0) + this.eye;
                this.vy -= 200 * delta;
                this.yaw.position.y += this.vy * delta;
                if (this.yaw.position.y <= gy) { this.yaw.position.y = gy; this.vy = 0; this.onGround = true; }
                else this.onGround = false;
            }
        }

        dispose() {
            document.removeEventListener('mousemove', this._onMouseMove);
            document.removeEventListener('click', this._onClick);
            document.removeEventListener('keydown', this._onKeyDown);
            document.removeEventListener('keyup', this._onKeyUp);
            document.removeEventListener('pointerlockchange', this._onPLChange);
            if (this._jumpTimer) clearTimeout(this._jumpTimer);
            if (document.pointerLockElement === document.body) document.exitPointerLock();
        }
    }

    // =========================================================================
    // DreamScene: builds the 3D surreal world from a terrain-tag grid.
    // =========================================================================
    class DreamScene {
        constructor(mapData) {
            this._map = mapData;
            this._w = mapData.width;
            this._h = mapData.height;
            this._grid = mapData.grid;
            this._enemies = [];
            this._props = [];
            this._animId = null;
            this._lastTime = null;
            this._time = 0;
            this._menuOpen = false;
            this._transitioning = false;
            this._flashDiv = null;
            this._flashTimer = null;
            this._skyA = new THREE.Color();
            this._skyB = new THREE.Color();

            // Enlarge the dream ~WORLD_TILES^2 by repeating the source grid, then
            // treat the whole thing as periodic so it loops perfectly (see heightAt/tagAt).
            if (WORLD_TILES > 1) {
                const nw = this._w * WORLD_TILES, nh = this._h * WORLD_TILES;
                const ng = new Uint8Array(nw * nh);
                for (let y = 0; y < nh; y++)
                    for (let x = 0; x < nw; x++)
                        ng[y * nw + x] = this._grid[(y % this._h) * this._w + (x % this._w)];
                this._grid = ng; this._w = nw; this._h = nh;
            }
            this._worldW = this._w * CELL;
            this._worldH = this._h * CELL;

            // Seed warp from the map id so a given map dreams consistently within a run.
            initPerlin((mapData.id * 2654435761) >>> 0);

            this._createOverlay();
            this._initThree();
            this._buildTerrain();
            this._buildProps();

            this._controller = new DreamController(this._camera, this._scene);
            this._controller.getGroundY = (x, z) => this.heightAt(x, z);
            // Spawn the sleeper somewhere walkable near the map centre.
            const sx = (this._w * 0.5) * CELL, sz = (this._h * 0.5) * CELL;
            this._controller.setStart(sx, this.heightAt(sx, sz) + this._controller.eye, sz);

            this._spawnEnemies();

            this._onResize = this._onResize.bind(this);
            window.addEventListener('resize', this._onResize);

            // Esc -> wake prompt, OK -> shift to a new dream.
            this._onKey = (e) => {
                if (!dreamActive || this._menuOpen) return;
                if (e.code === 'Escape') { e.preventDefault(); this._openWakePrompt(); }
                else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
                    e.preventDefault(); DreamSystem.changeMap();
                }
            };
            document.addEventListener('keydown', this._onKey);

            this._loop = this._loop.bind(this);
            this._animId = requestAnimationFrame(this._loop);
        }

        // ---- terrain access -------------------------------------------------
        // Cell tags wrap (modulo) so the grid is toroidal -> perfect seamless loop.
        tagAt(cx, cy) {
            cx = ((cx % this._w) + this._w) % this._w;
            cy = ((cy % this._h) + this._h) % this._h;
            return this._grid[cy * this._w + cx];
        }

        // Perlin sampled so it tiles exactly at the world period (bilinear seam blend),
        // guaranteeing the ground height is continuous across the wrap boundary.
        _tileNoise(wx, wz, freq) {
            const W = this._worldW, H = this._worldH;
            const x = ((wx % W) + W) % W, z = ((wz % H) + H) % H;
            const gx = x / W, gz = z / H;
            const nx = x * freq, nz = z * freq, nW = W * freq, nH = H * freq;
            const a = perlin2(nx, nz), b = perlin2(nx - nW, nz);
            const c = perlin2(nx, nz - nH), d = perlin2(nx - nW, nz - nH);
            return a * (1 - gx) * (1 - gz) + b * gx * (1 - gz)
                 + c * (1 - gx) * gz + d * gx * gz;
        }

        heightAt(wx, wz) {
            const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
            const b = BIOMES[this.tagAt(cx, cy)];
            const warp = this._tileNoise(wx, wz, 0.012) * b.amp;
            return b.baseY + warp;
        }

        // ---- DOM / renderer -------------------------------------------------
        _createOverlay() {
            const el = document.createElement('div');
            el.id = 'dream-overlay';
            el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;overflow:hidden;background:#000;';
            document.body.appendChild(el);
            this._overlay = el;

            const cap = document.createElement('div');
            cap.style.cssText = 'position:absolute;left:0;right:0;bottom:18px;text-align:center;color:#cfc;font:14px monospace;text-shadow:0 0 6px #000;opacity:0.55;pointer-events:none;';
            cap.textContent = BIOMES[this._dominantTag()].name + T('Dream.caption');
            el.appendChild(cap);
            this._caption = cap;

            // Full-screen strobe layer used for the LSD-style dream-shift flash.
            const fl = document.createElement('div');
            fl.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;display:none;pointer-events:none;mix-blend-mode:screen;';
            el.appendChild(fl);
            this._flashDiv = fl;
        }

        // ---- LSD-emulator strobe: rapid random-colour flash, then fade out ----
        _lsdFlash(done) {
            const f = this._flashDiv;
            if (!f) { if (done) done(); return; }
            if (typeof SoundManager !== 'undefined') SoundManager.playCursor();
            f.style.display = 'block';
            let n = 0; const total = 20;
            const step = () => {
                if (!this._flashDiv) { if (done) done(); return; }
                const c = flashColors[Math.floor(Math.random() * flashColors.length)] || 'FFFFFF';
                this._flashDiv.style.background = '#' + c;
                this._flashDiv.style.opacity = String(0.45 + Math.random() * 0.5);
                if (++n >= total) {
                    this._flashDiv.style.opacity = '0';
                    this._flashTimer = setTimeout(() => {
                        if (this._flashDiv) this._flashDiv.style.display = 'none';
                    }, 60);
                    if (done) done();
                    return;
                }
                this._flashTimer = setTimeout(step, 24);
            };
            step();
        }

        _dominantTag() {
            // The grid is fixed for the life of a dream scene, so the full scan
            // only needs to run once; cache it (invalidated if _grid is replaced).
            if (this._dominantTagCache !== undefined && this._dominantTagCacheGrid === this._grid) {
                return this._dominantTagCache;
            }
            const counts = new Array(8).fill(0);
            for (let i = 0; i < this._grid.length; i++) counts[this._grid[i]]++;
            let best = 0;
            for (let t = 1; t < 8; t++) if (counts[t] > counts[best]) best = t;
            this._dominantTagCache = best;
            this._dominantTagCacheGrid = this._grid;
            return best;
        }

        _initThree() {
            const w = window.innerWidth, h = window.innerHeight;
            this._scene = new THREE.Scene();
            const skyHex = BIOMES[this._dominantTag()].sky;
            this._scene.background = new THREE.Color(skyHex);
            this._scene.fog = new THREE.FogExp2(skyHex, 0.0022);

            this._camera = new THREE.PerspectiveCamera(72, w / h, 0.1, 4000);

            this._renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
            this._renderer.setPixelRatio(1);
            this._renderer.setSize(w, h);
            this._renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;display:block;';
            this._overlay.appendChild(this._renderer.domElement);

            this._hemi = new THREE.HemisphereLight(0xffffff, 0x202028, 0.85);
            this._scene.add(this._hemi);
            this._sun = new THREE.DirectionalLight(0xffffff, 0.9);
            this._sun.position.set(0.4, 1, 0.3);
            this._scene.add(this._sun);
            this._ambient = new THREE.AmbientLight(0x404050, 0.6);
            this._scene.add(this._ambient);
        }

        // ---- ground mesh ----------------------------------------------------
        // Built once, overscanned by MARGIN on every side. Height/tag/colour are all
        // sampled from periodic functions, so the patch tiles seamlessly and the
        // player (kept wrapped into [0,worldW) each frame) never sees an edge.
        _buildTerrain() {
            const worldW = this._worldW, worldH = this._worldH;
            const fullW = worldW + MARGIN * 2, fullH = worldH + MARGIN * 2;
            const segX = Math.max(1, Math.round(fullW / CELL));
            const segZ = Math.max(1, Math.round(fullH / CELL));
            const geo = new THREE.PlaneGeometry(fullW, fullH, segX, segZ);
            geo.rotateX(-Math.PI / 2);
            // Span [-MARGIN, worldW+MARGIN] on both axes.
            geo.translate(worldW * 0.5, 0, worldH * 0.5);

            const pos = geo.attributes.position;
            const colArr = new Float32Array(pos.count * 3);
            const c0 = new THREE.Color(), c1 = new THREE.Color(), col = new THREE.Color();

            for (let i = 0; i < pos.count; i++) {
                const wx = pos.getX(i), wz = pos.getZ(i);
                const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
                const b = BIOMES[this.tagAt(cx, cy)];

                pos.setY(i, b.baseY + this._tileNoise(wx, wz, 0.012) * b.amp);

                c0.setHex(b.g0); c1.setHex(b.g1);
                const mix = (this._tileNoise(wx, wz, 0.05) * 0.5 + 0.5);
                col.copy(c0).lerp(c1, mix);
                colArr[i * 3] = col.r; colArr[i * 3 + 1] = col.g; colArr[i * 3 + 2] = col.b;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
            geo.computeVertexNormals();

            const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
            this._ground = new THREE.Mesh(geo, mat);
            this._scene.add(this._ground);

            // A shimmering liquid sheet over any Mercury Sea dips. It follows the
            // sleeper (recentred each frame) so it exists everywhere in the loop.
            let hasWater = false;
            for (let i = 0; i < this._grid.length; i++) if (BIOMES[this._grid[i]].water) { hasWater = true; break; }
            if (hasWater) {
                const wgeo = new THREE.PlaneGeometry(fullW + 2000, fullH + 2000);
                wgeo.rotateX(-Math.PI / 2);
                const wmat = new THREE.MeshPhongMaterial({
                    color: 0x4a6a9a, transparent: true, opacity: 0.55,
                    shininess: 120, specular: 0xbfd4ff
                });
                this._water = new THREE.Mesh(wgeo, wmat);
                this._water.position.y = BIOMES[3].baseY + 5;
                this._scene.add(this._water);
            }
        }

        // ---- procedural surreal decorations ---------------------------------
        _propGeo(kind) {
            switch (kind) {
                case 'monolith': return new THREE.BoxGeometry(3, 26, 3).translate(0, 13, 0);
                case 'eye':      return new THREE.SphereGeometry(4, 10, 8).translate(0, 10, 0);
                case 'glowcube': return new THREE.BoxGeometry(6, 6, 6);
                case 'organic':  return new THREE.ConeGeometry(3.5, 18, 6).translate(0, 9, 0);
                case 'arch':     return new THREE.TorusGeometry(8, 1.6, 6, 12);
                case 'glyph':    return new THREE.TetrahedronGeometry(3);
                case 'wall':     return new THREE.BoxGeometry(CELL * 0.92, WALL_H, CELL * 0.92).translate(0, WALL_H * 0.5, 0);
                default:         return null;
            }
        }

        _buildProps() {
            // Bucket cell transforms per terrain tag, then one InstancedMesh each.
            // Iterate the overscanned window; tag/hash use the WRAPPED cell index so a
            // cell and its +worldW twin are identical -> props tile across the seam.
            const buckets = {};   // tag -> [{x,y,z,s,ry}]
            const minCx = Math.floor(-MARGIN / CELL), maxCx = Math.ceil((this._worldW + MARGIN) / CELL);
            const minCy = Math.floor(-MARGIN / CELL), maxCy = Math.ceil((this._worldH + MARGIN) / CELL);
            for (let cy = minCy; cy < maxCy; cy++) {
                for (let cx = minCx; cx < maxCx; cx++) {
                    const cxW = ((cx % this._w) + this._w) % this._w;
                    const cyW = ((cy % this._h) + this._h) % this._h;
                    const tag = this._grid[cyW * this._w + cxW];
                    const b = BIOMES[tag];
                    if (b.prop === 'none' || b.density <= 0) continue;
                    if (b.density < 1 && hash01(cxW, cyW, 3) > b.density) continue;

                    const jx = (hash01(cxW, cyW, 1) - 0.5) * CELL * 0.6;
                    const jz = (hash01(cxW, cyW, 2) - 0.5) * CELL * 0.6;
                    const wx = cx * CELL + CELL * 0.5 + jx;   // absolute world position
                    const wz = cy * CELL + CELL * 0.5 + jz;
                    let wy = this.heightAt(wx, wz);
                    if (b.floats) wy += 14 + hash01(cxW, cyW, 5) * 40;
                    const s = b.wall ? 1 : (0.5 + hash01(cxW, cyW, 4) * 2.2);
                    const ry = hash01(cxW, cyW, 6) * Math.PI * 2;
                    (buckets[tag] = buckets[tag] || []).push({ x: wx, y: wy, z: wz, s, ry, float: b.floats });
                }
            }

            const dummy = new THREE.Object3D();
            for (const tagStr in buckets) {
                const tag = +tagStr;
                const b = BIOMES[tag];
                const list = buckets[tag];
                const geo = this._propGeo(b.prop);
                if (!geo) continue;

                const emissive = (b.prop === 'glowcube' || b.prop === 'glyph');
                const mat = new THREE.MeshLambertMaterial({
                    color: b.accent,
                    emissive: emissive ? new THREE.Color(b.accent) : 0x000000,
                    emissiveIntensity: emissive ? 0.9 : 0
                });
                const mesh = new THREE.InstancedMesh(geo, mat, list.length);
                for (let i = 0; i < list.length; i++) {
                    const p = list[i];
                    dummy.position.set(p.x, p.y, p.z);
                    dummy.rotation.set(p.float ? p.ry : 0, p.ry, 0);
                    dummy.scale.setScalar(p.s);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(i, dummy.matrix);
                }
                mesh.instanceMatrix.needsUpdate = true;
                this._scene.add(mesh);
                this._props.push({ mesh, list, dummy, float: b.floats });

                // Eyeballs get a dark pupil shell so they read as eyes.
                if (b.prop === 'eye') {
                    const pgeo = new THREE.SphereGeometry(1.6, 8, 6).translate(0, 10, 3.2);
                    const pmesh = new THREE.InstancedMesh(pgeo, new THREE.MeshLambertMaterial({ color: 0x0a0a0a }), list.length);
                    for (let i = 0; i < list.length; i++) {
                        const p = list[i];
                        dummy.position.set(p.x, p.y, p.z);
                        dummy.rotation.set(0, p.ry, 0);
                        dummy.scale.setScalar(p.s);
                        dummy.updateMatrix();
                        pmesh.setMatrixAt(i, dummy.matrix);
                    }
                    pmesh.instanceMatrix.needsUpdate = true;
                    this._scene.add(pmesh);
                }
            }
            if (window.PSXShader) window.PSXShader.applyToObject(this._scene);
        }

        // ---- 3D battlers ----------------------------------------------------
        _spawnEnemies() {
            if (!window.Battler3D || typeof window.Battler3D.list !== 'function') return;
            const keys = window.Battler3D.list();
            if (!keys || keys.length === 0) return;

            for (let i = 0; i < ENEMY_COUNT; i++) {
                const key = keys[Math.floor(Math.random() * keys.length)];
                // Randomize generation to extremes: null battler -> fully random
                // body shape / texture / colour; random weapon type; wild scale.
                const weapon = Math.floor(Math.random() * 12) + 1;
                let model;
                try {
                    model = window.Battler3D.create(key, 1.0, 0, null, weapon);
                } catch (e) { model = null; }
                if (!model) continue;

                const cx = Math.floor(Math.random() * this._w);
                const cy = Math.floor(Math.random() * this._h);
                const wx = cx * CELL + CELL * 0.5;
                const wz = cy * CELL + CELL * 0.5;
                const gy = this.heightAt(wx, wz);

                // Gait derived from the model key's metadata (flyers/swimmers hover,
                // walkers/runners roam the ground). See Battler3D.resolveLocomotion.
                const gait = (window.Battler3D.gaitForKey ? window.Battler3D.gaitForKey(key) : 'walk') || 'walk';
                let behavior;
                if (gait === 'fly' || gait === 'swim') behavior = 'float';
                else behavior = Math.random() < 0.75 ? 'wander' : 'still';

                // Enemies loom large; a rare few are colossal, LSD-nightmare scale.
                let scale = 1.6 + Math.random() * Math.random() * 9;   // big, upward-skewed
                if (Math.random() < 0.05) scale *= 4 + Math.random() * 6;   // rare gigantic
                const ent = {
                    model, behavior, gait,
                    baseY: gy,
                    bob: Math.random() * Math.PI * 2,
                    bobSpd: 0.5 + Math.random() * 2.5,
                    yaw: Math.random() * Math.PI * 2,
                    turn: (Math.random() - 0.5) * 1.2,
                    speed: 8 + Math.random() * 26,
                    scale: scale,
                    floatH: 18 + Math.random() * 70 + scale * 3,
                    ready: false,
                    x: wx, z: wz
                };
                this._enemies.push(ent);

                // Async build, then attach into the scene.
                Promise.resolve(model.load(null, wx, gy, wz)).then(() => {
                    if (!dreamActive || !model.model) return;
                    const root = model.model;
                    // Mirror the battle scene's facing wrapper for non-bipedal models.
                    if (model.facingYaw && !model._facingApplied) {
                        model._facingApplied = true;
                        const inner = new THREE.Group();
                        inner.rotation.y = model.facingYaw;
                        const kids = root.children.slice();
                        for (const k of kids) inner.add(k);
                        root.add(inner);
                    }
                    root.scale.multiplyScalar(ent.scale);   // bypass the battle fit-clamp
                    root.position.set(wx, gy + (behavior === 'float' ? ent.floatH : 0), wz);
                    root.rotation.y = ent.yaw;
                    if (window.PSXShader) window.PSXShader.applyToObject(root);
                    root.userData.dreamBattler = true; // foreign: skip in dispose()
                    this._scene.add(root);
                    try {
                        if (ent.gait === 'idle') { model.playIdleAnimation(); }
                        else { model.setGaitSpeed(2 + Math.floor(Math.random() * 4)); model.playGait(ent.gait); }
                    } catch (e) { /* some families auto-idle */ }
                    ent.ready = true;
                }).catch(err => console.warn('[DreamSystem] enemy load failed:', err));
            }
        }

        _updateEnemies(delta) {
            const P = this._controller.yaw.position;
            const W = this._worldW, H = this._worldH;
            // Map a coordinate to the periodic image nearest the player, so entities
            // always haunt the sleeper no matter how far they roam through the loop.
            const wrap = (v, c, S) => { let d = v - c; d -= Math.round(d / S) * S; return c + d; };

            for (const ent of this._enemies) {
                const m = ent.model;
                if (m && typeof m.update === 'function') { try { m.update(delta); } catch (e) { /* ignore */ } }
                if (!ent.ready || !m || !m.model) continue;
                const root = m.model;

                ent.bob += ent.bobSpd * delta;
                if (ent.behavior === 'wander') {
                    ent.yaw += ent.turn * delta;
                    ent.x += Math.sin(ent.yaw) * ent.speed * delta;
                    ent.z += Math.cos(ent.yaw) * ent.speed * delta;
                    if (Math.random() < 0.01) ent.turn = (Math.random() - 0.5) * 1.6;
                    ent.x = wrap(ent.x, P.x, W); ent.z = wrap(ent.z, P.z, H);
                    const gy = this.heightAt(ent.x, ent.z);
                    root.position.set(ent.x, gy + Math.abs(Math.sin(ent.bob)) * 1.5, ent.z);
                    root.rotation.y = ent.yaw + Math.PI;
                } else if (ent.behavior === 'float') {
                    ent.x = wrap(ent.x, P.x, W); ent.z = wrap(ent.z, P.z, H);
                    ent.baseY = this.heightAt(ent.x, ent.z);
                    root.position.set(ent.x, ent.baseY + ent.floatH + Math.sin(ent.bob) * 6, ent.z);
                    root.rotation.y += delta * 0.4;
                } else {
                    // still: gentle breathing bob only.
                    ent.x = wrap(ent.x, P.x, W); ent.z = wrap(ent.z, P.z, H);
                    ent.baseY = this.heightAt(ent.x, ent.z);
                    root.position.set(ent.x, ent.baseY + Math.sin(ent.bob) * 0.8, ent.z);
                }
            }

            // Touching a dream entity: LSD flash + shift to another dream map. The
            // hitbox scales with the entity, so the gigantic ones loom and grab early.
            // A brief grace period stops a just-spawned entity from shifting instantly.
            if (!this._transitioning && !this._menuOpen && this._time > 1.2) {
                for (const ent of this._enemies) {
                    if (!ent.ready || !ent.model || !ent.model.model) continue;
                    const rp = ent.model.model.position;
                    const dx = rp.x - P.x, dz = rp.z - P.z;
                    const r = 7 + ent.scale * 3.2;
                    if (dx * dx + dz * dz < r * r) {
                        this._transitioning = true;
                        DreamSystem.collideShift();
                        break;
                    }
                }
            }
        }

        // ---- main loop ------------------------------------------------------
        _loop(now) {
            this._animId = requestAnimationFrame(this._loop);
            if (this._lastTime === null) { this._lastTime = now; return; }
            const delta = Math.min((now - this._lastTime) / 1000, 0.1);
            this._lastTime = now;
            this._time += delta;
            if (this._menuOpen) return;

            // Controller back / cancel button -> wake prompt (gamepads never emit a
            // DOM 'Escape' keydown, so poll the engine's input here).
            if (dreamActive && typeof Input !== 'undefined' && Input.isTriggered('cancel')) {
                this._openWakePrompt();
                return;
            }

            this._controller.update(delta);

            // Perfect toroidal loop: keep the sleeper inside one period. Because the
            // terrain, props and colour are all periodic, this wrap is invisible.
            const p = this._controller.yaw.position;
            p.x = ((p.x % this._worldW) + this._worldW) % this._worldW;
            p.z = ((p.z % this._worldH) + this._worldH) % this._worldH;

            this._updateEnemies(delta);

            // Slow LSD sky-hue drift.
            const t = this._time * 0.05;
            const base = BIOMES[this._dominantTag()].sky;
            this._skyA.setHex(base);
            this._skyA.offsetHSL(Math.sin(t) * 0.08, 0, Math.sin(t * 0.7) * 0.05);
            this._scene.background = this._skyA;
            if (this._scene.fog) this._scene.fog.color.copy(this._skyA);

            if (this._water) {
                this._water.position.x = p.x;
                this._water.position.z = p.z;
                this._water.position.y = BIOMES[3].baseY + 5 + Math.sin(this._time * 1.5) * 0.6;
            }

            if (window.PSXShader) window.PSXShader.render(this._renderer, this._scene, this._camera);
            else this._renderer.render(this._scene, this._camera);
        }

        _onResize() {
            if (!this._renderer) return;
            const w = window.innerWidth, h = window.innerHeight;
            this._camera.aspect = w / h;
            this._camera.updateProjectionMatrix();
            this._renderer.setSize(w, h);
        }

        // ---- wake prompt (rendered as a DOM overlay ON the 3D dream, not RM choices)
        _openWakePrompt() {
            if (this._menuOpen) return;
            this._menuOpen = true;
            // Flush engine input so the same ESC/cancel press that opened the prompt
            // does not immediately confirm a choice.
            if (typeof Input !== 'undefined') Input.clear();
            if (typeof TouchInput !== 'undefined') TouchInput.clear();
            if (document.pointerLockElement === document.body) document.exitPointerLock();
            if (typeof SoundManager !== 'undefined') SoundManager.playOk();
            this._buildWakeMenu();
        }

        _buildWakeMenu() {
            const items = [T('Dream.wakeUp'), T('Dream.keepDreaming')];
            this._wakeItems = items;
            this._wakeSel = 1;
            this._wakeLock = 6;   // brief input lockout so the opening press is ignored

            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);font-family:monospace;';
            const panel = document.createElement('div');
            panel.style.cssText = 'min-width:320px;padding:26px 34px;background:rgba(8,6,16,0.82);border:2px solid rgba(180,150,255,0.55);box-shadow:0 0 42px rgba(120,80,220,0.6);text-align:center;';
            const title = document.createElement('div');
            title.textContent = T('Dream.dreamThins');
            title.style.cssText = 'color:#e8ddff;font-size:18px;margin-bottom:20px;letter-spacing:2px;text-shadow:0 0 8px #a06cff;';
            panel.appendChild(title);

            const btns = [];
            items.forEach((label, i) => {
                const b = document.createElement('div');
                b.textContent = label;
                b.style.cssText = 'font-size:16px;padding:12px 16px;margin:6px 0;cursor:pointer;border:1px solid transparent;transition:all .12s;';
                b.addEventListener('mouseenter', () => { this._wakeSel = i; this._paintWake(); });
                b.addEventListener('click', () => { this._wakeSel = i; this._confirmWake(); });
                panel.appendChild(b);
                btns.push(b);
            });
            wrap.appendChild(panel);
            this._overlay.appendChild(wrap);
            this._wakeMenu = wrap;
            this._wakeBtns = btns;
            this._paintWake();

            // Poll the engine Input so keyboard, WASD and gamepad all drive the menu
            // uniformly (the main render loop is frozen while the menu is open).
            const poll = () => {
                if (!this._wakeMenu) return;
                if (this._wakeLock > 0) { this._wakeLock--; this._wakePoll = requestAnimationFrame(poll); return; }
                if (typeof Input !== 'undefined') {
                    const n = items.length;
                    if (Input.isTriggered('up')) {
                        this._wakeSel = (this._wakeSel + n - 1) % n; this._paintWake(); this._wakeLock = 8;
                        if (typeof SoundManager !== 'undefined') SoundManager.playCursor();
                    } else if (Input.isTriggered('down')) {
                        this._wakeSel = (this._wakeSel + 1) % n; this._paintWake(); this._wakeLock = 8;
                        if (typeof SoundManager !== 'undefined') SoundManager.playCursor();
                    } else if (Input.isTriggered('ok')) {
                        this._confirmWake(); return;
                    } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                        this._wakeSel = 1; this._confirmWake(); return;
                    }
                }
                this._wakePoll = requestAnimationFrame(poll);
            };
            this._wakePoll = requestAnimationFrame(poll);
        }

        _paintWake() {
            if (!this._wakeBtns) return;
            this._wakeBtns.forEach((b, i) => {
                if (i === this._wakeSel) {
                    b.style.color = '#fff';
                    b.style.borderColor = 'rgba(180,150,255,0.9)';
                    b.style.background = 'rgba(120,80,220,0.35)';
                    b.style.textShadow = '0 0 10px #b98cff';
                } else {
                    b.style.color = '#cfc6e6';
                    b.style.borderColor = 'transparent';
                    b.style.background = 'transparent';
                    b.style.textShadow = 'none';
                }
            });
        }

        _confirmWake() {
            const sel = this._wakeSel;
            this._closeWakeMenu();
            if (sel === 0) {
                if (typeof SoundManager !== 'undefined') SoundManager.playOk();
                DreamSystem.stop();
            } else {
                if (typeof SoundManager !== 'undefined') SoundManager.playCancel();
            }
        }

        _closeWakeMenu() {
            if (this._wakePoll) { cancelAnimationFrame(this._wakePoll); this._wakePoll = null; }
            if (this._wakeMenu && this._wakeMenu.parentNode) this._wakeMenu.parentNode.removeChild(this._wakeMenu);
            this._wakeMenu = null; this._wakeBtns = null;
            if (this._controller) {
                const mv = this._controller.move;
                mv.f = mv.b = mv.l = mv.r = mv.sprint = mv.up = mv.down = false;
            }
            this._menuOpen = false;
            if (typeof Input !== 'undefined') Input.clear();
        }

        dispose() {
            if (this._animId) cancelAnimationFrame(this._animId);
            if (this._wakePoll) cancelAnimationFrame(this._wakePoll);
            if (this._flashTimer) clearTimeout(this._flashTimer);
            window.removeEventListener('resize', this._onResize);
            document.removeEventListener('keydown', this._onKey);
            if (this._controller) this._controller.dispose();

            // Tear down THREE resources, but ONLY objects the dream scene owns.
            // Battler3D model roots are foreign: their geometry/materials reference
            // shared/cached singletons (e.g. _SKIN_TEX_CACHE) and are disposed by
            // Battler3D's own careful disposer. Blindly disposing them here corrupts
            // later battle/viewer renders, so skip any Battler subtree.
            const disposeObj = (o) => {
                if (o.userData && o.userData.dreamBattler) return; // foreign, do not dispose
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                    else o.material.dispose();
                }
                const kids = o.children ? o.children.slice() : [];
                for (const k of kids) disposeObj(k);
            };
            if (this._scene) {
                for (const child of this._scene.children.slice()) disposeObj(child);
            }
            if (this._renderer) {
                // dispose() leaves the WebGL context itself alive. The browser
                // caps live contexts and force-loses the OLDEST past the cap,
                // which is the game's own canvas: PIXI then silently stops
                // rendering and the picture freezes until the game is restarted.
                this._renderer.dispose();
                try {
                    if (this._renderer.forceContextLoss) this._renderer.forceContextLoss();
                } catch (e) { /* context already gone */ }
            }
            if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
            this._enemies.length = 0;
            this._props.length = 0;
        }
    }

    // =========================================================================
    // DreamSystem manager (static entry point).
    // =========================================================================
    const DreamSystem = {
        _scene: null,
        _psxBackup: null,

        isActive() { return !!this._scene; },

        start() {
            if (!hasTHREE) {            // graceful fallback: just flash + message
                this._fallbackFlash();
                return;
            }
            if (this._scene) this.stop();
            if (dreamMaps.length === 0) return;

            dreamActive = true;
            window.dreamActive = true;
            this._applyPsxDreamTuning();

            const mapId = dreamMaps[Math.floor(Math.random() * dreamMaps.length)];
            loadDreamGrid(mapId).then(data => {
                if (!dreamActive) return;      // woke before the map finished loading
                this._scene = new DreamScene(data);
            });
        },

        // LSD-style strobe + rebuild from another random map without leaving the dream.
        changeMap() {
            if (!this._scene || this._scene._transitioning) return;
            const old = this._scene;
            old._transitioning = true;        // block re-entry (e.g. repeat collisions)
            old._lsdFlash(() => {
                const mapId = dreamMaps[Math.floor(Math.random() * dreamMaps.length)];
                loadDreamGrid(mapId).then(data => {
                    if (!dreamActive) { old._transitioning = false; return; }
                    old.dispose();
                    this._scene = new DreamScene(data);
                }).catch(() => { old._transitioning = false; });
            });
        },

        // Player walked into a dream entity -> flash and fall into another dream.
        collideShift() { this.changeMap(); },

        stop() {
            if (this._scene) { this._scene.dispose(); this._scene = null; }
            const wasActive = dreamActive;
            dreamActive = false;
            window.dreamActive = false;
            this._restorePsxTuning();
            if (wasActive && typeof $gameMessage !== 'undefined') {
                setTimeout(() => {
                    window.skipLocalization = true;
                    $gameMessage.add(T('Dream.youWokeUp'));
                    window.skipLocalization = false;
                }, 250);
            }
        },

        // Crank the shared PSX shader for a heavier dream crunch, restoring on wake.
        _applyPsxDreamTuning() {
            if (!window.PSXShader || this._psxBackup) return;
            const p = window.PSXShader;
            this._psxBackup = { vertexSnap: p.vertexSnap, colorLevels: p.colorLevels, dither: p.dither, downscale: p.downscale };
            p.vertexSnap = 90;
            p.colorLevels = 12;
            p.dither = 0.85;
            p.downscale = 0.5;
        },
        _restorePsxTuning() {
            if (!window.PSXShader || !this._psxBackup) return;
            Object.assign(window.PSXShader, this._psxBackup);
            this._psxBackup = null;
        },

        _fallbackFlash() {
            const color = flashColors[Math.floor(Math.random() * flashColors.length)];
            if (typeof $gameScreen !== 'undefined') {
                $gameScreen.startFlash([
                    parseInt(color.substr(0, 2), 16),
                    parseInt(color.substr(2, 2), 16),
                    parseInt(color.substr(4, 2), 16), 160
                ], 60);
            }
            if (typeof $gameMessage !== 'undefined') {
                window.skipLocalization = true;
                $gameMessage.add(T('Dream.willNotForm'));
                window.skipLocalization = false;
            }
        }
    };
    window.DreamSystem = DreamSystem;

    // =========================================================================
    // Plugin commands.
    // =========================================================================
    PluginManager.registerCommand(pluginName, 'StartDream', () => DreamSystem.start());
    PluginManager.registerCommand(pluginName, 'changeDream', () => DreamSystem.changeMap());

    // =========================================================================
    // While dreaming, freeze the underlying map: no menu, no player movement.
    // =========================================================================
    const _Scene_Map_isMenuEnabled = Scene_Map.prototype.isMenuEnabled;
    Scene_Map.prototype.isMenuEnabled = function () {
        if (dreamActive) return false;
        return _Scene_Map_isMenuEnabled.call(this);
    };

    const _Game_Player_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function () {
        if (dreamActive) return false;
        return _Game_Player_canMove.call(this);
    };

    // While dreaming, an opaque full-screen DOM overlay (z-index 9999, solid
    // black) plus the dream's own THREE canvas cover the game canvas completely,
    // so rendering the PIXI scene underneath is wasted work. Skip it while
    // dreamActive is set; the flag is cleared on every wake path (and the overlay
    // is removed before it clears), so normal rendering resumes reliably on wake.
    if (SceneManager.renderScene) {
        const _SceneManager_renderScene = SceneManager.renderScene;
        SceneManager.renderScene = function () {
            if (window.dreamActive) return;
            _SceneManager_renderScene.call(this);
        };
    }

    // Safety: if the map scene tears down (e.g. a forced transfer), end the dream.
    const _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function () {
        if (dreamActive && DreamSystem.isActive()) DreamSystem.stop();
        _Scene_Map_terminate.call(this);
    };

})();
