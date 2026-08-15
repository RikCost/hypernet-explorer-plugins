//=============================================================================
// CamperDrivingSystem.js
// Fullscreen 3D road driving scene for camper fast travel with FPC.
// Load AFTER: VehicleSystem.js, VehicleSystemRepair.js, FastTravelSystem.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc 3D Camper Road Driving System v5.3.0 (True-scale traffic: 9 vehicle models, glazed windows, rolling+steering wheels, crash sparks+damage, turbo/shift audio, ability+condition HUD, half-scale world)
 * @author Omni-Lex
 *
 * @help
 * Requires the Vehicle/CamperModel submodule (loaded just before this plugin),
 * which builds the camper procedurally with interior, openable doors, two
 * seats, an interactable wheel, and bolt-on upgrade modules.
 *
 * Activates automatically when camper fast travel starts.
 * The 3D terrain mirrors Map 315's 256x256 biome grid:
 * - Mountain biomes    → Perlin noise height field
 * - Ocean/water biomes → Flat blue plane
 * - Road biomes        → Dual-lane asphalt matching road direction
 * - All other biomes   → Flat ground using the biome's hex color
 *
 * New v3.3.0 Features:
 * - Seamless Biome Blending (Vertex color interpolation).
 * - Dynamic Coastlines & Islands (Sloped sandy beaches near water).
 * - Procedural Low-Poly decorations (Cities, Forests, Cacti).
 * - Smoothed vehicle rotation and soft shadows.
 *
 * Player spawns at their current world coordinates (Variables 43/44).
 *
 * Views (TAB, gamepad Y, or the on-screen button toggle FP driving <-> Car only):
 *   FP driving    - camera at the driver's seat behind the animated steering
 *                   wheel and gauge dash; W throttles, Shift turbos, S brakes /
 *                   reverses, A/D steer, Space handbrake, mouse look.
 *   Car           - chase camera; same driving controls. Mid-drag / mouse wheel /
 *                   right stick / gamepad L2 (out) & R2 (in) zoom and look.
 *   First person  - free-roam cabin view, reached by interacting with a door
 *                   while driving or climbing back in on foot; WASD walks.
 *
 * Driving model (v5): automatic 5-speed gearbox with an RPM engine note,
 * lateral slip (handbrake drifts), surface grip (asphalt / dirt shoulders /
 * grass / sand / snow / rock), slope gravity, terrain-aligned chassis, traffic
 * that brakes and can be crashed into, wheel dust / tyre smoke / exhaust,
 * stars + moon + low-poly clouds, and biome-matched enemies idling by the road.
 *
 * Traffic (v5.3): nine vehicle models - hatchback, saloon, coupe, SUV, pickup,
 * taxi, panel van, box truck and city bus - authored at true real-world size
 * against the camper (UNITS_PER_M = 4 world units per metre), with see-through
 * glazing, hub-capped wheels that visibly roll and steer into corners, corner
 * lamp clusters, and junction turns swung around the crossing instead of
 * snapped. Collision bubbles scale per model, so a bus shoves harder than a hatch.
 *
 * Back / Cancel (Esc or controller B) opens the vehicle options menu in every
 * view (stop liminal drive, stop driving, step outside, continue).
 *
 * Title-screen autopilot (CamperDrivingSystem.startTitleDrive): the same world
 * drive, run as the title's "Camper Drive" background. It drops the camper on a
 * random stretch of the world's road network and drives it there by itself,
 * following the tiles' road tags and taking a random way on at every crossroad
 * and T-junction. No HUD, no controls (drag / right stick still looks around the
 * cab), no engine audio, and nothing is written back to the save.
 *
 * Movement modes:
 *   F  - take off / land (flight rotors)
 *   C  - dive / surface while over water (submarine); driving onto water floats it.
 *   Auto travel (camper fast travel) flies straight to the destination.
 *
 * @command StartDriving
 * @text Start Road System
 * @desc Manually launch the 3D camper driving scene.
 *
 * @arg duration
 * @type number
 * @min 1
 * @default 60
 * @text Duration (seconds)
 * @desc How long the driving scene lasts.
 *
 * @arg destinationName
 * @type string
 * @default Destination
 * @text Destination Name
 * @desc Name shown on the HUD.
 *
 * @arg totalKm
 * @type number
 * @min 1
 * @default 100
 * @text Total Distance (km)
 * @desc Total trip distance displayed on the HUD.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') {
        console.error('[CamperDriving] THREE.js not loaded.');
        return;
    }
    if (typeof THREE.GLTFLoader === 'undefined') {
        console.warn('[CamperDriving] THREE.GLTFLoader not found. Model loading will fail unless loaded globally.');
    }

    // =========================================================================
    // Texture loader (cached, tiled, sRGB-correct under ACES tone mapping).
    // Mirrors WeaponSystemProcedural.getTexture but uses smooth filtering +
    // mipmaps. A failed/absent load just leaves the material's base colour.
    // =========================================================================
    const _texCache = new Map();
    // Anisotropy the GPU actually supports, learned once the renderer exists.
    // Without it the asphalt and ground detail alias hard at grazing angles,
    // which reads as a shimmering, flickering road ahead of the camper.
    let _maxAniso = 1;
    function setTextureAnisotropy(n) {
        _maxAniso = Math.max(1, n | 0);
        for (const t of _texCache.values()) {
            if (!t) continue;
            t.anisotropy = _maxAniso;
            // Only re-upload textures that already have an image; pending loads
            // get needsUpdate from TextureLoader itself and warn otherwise.
            if (t.image) t.needsUpdate = true;
        }
    }
    function loadTex(name, repeat) {
        if (typeof THREE.TextureLoader === 'undefined') return null;
        let t = _texCache.get(name);
        if (t) return t;
        t = new THREE.TextureLoader().load('img/textures/' + name);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = _maxAniso;
        if (repeat) t.repeat.set(repeat, repeat);
        if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
        _texCache.set(name, t);
        return t;
    }

    // =========================================================================
    // Perlin Noise (self-contained, seeded)
    // =========================================================================
    const _perm = new Uint8Array(512);

    function initPerlinWithSeed(seed) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = ((seed || 19002001) >>> 0);
        for (let i = 255; i > 0; i--) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const j = s % (i + 1);
            const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
        }
        for (let i = 0; i < 512; i++) _perm[i] = p[i & 255];
    }
    initPerlinWithSeed(19002001); // default; overridden at scene start

    function _pFade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function _pLerp(t, a, b) { return a + t * (b - a); }
    function _pGrad(h, x, y, z) {
        h &= 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    function _perlin(x, y, z) {
        z = z || 0;
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        const u = _pFade(x), v = _pFade(y), w = _pFade(z);
        const A  = _perm[X] + Y,   AA = _perm[A] + Z,   AB = _perm[A + 1] + Z;
        const B  = _perm[X + 1] + Y, BA = _perm[B] + Z, BB = _perm[B + 1] + Z;
        return _pLerp(w,
            _pLerp(v,
                _pLerp(u, _pGrad(_perm[AA],   x,     y,     z),   _pGrad(_perm[BA],   x - 1, y,     z)),
                _pLerp(u, _pGrad(_perm[AB],   x,     y - 1, z),   _pGrad(_perm[BB],   x - 1, y - 1, z))),
            _pLerp(v,
                _pLerp(u, _pGrad(_perm[AA+1], x,     y,     z-1), _pGrad(_perm[BA+1], x - 1, y,     z-1)),
                _pLerp(u, _pGrad(_perm[AB+1], x,     y - 1, z-1), _pGrad(_perm[BB+1], x - 1, y - 1, z-1))));
    }
    function _fbm(x, y, octaves, lacunarity, gain) {
        octaves   = octaves   || 5;
        lacunarity = lacunarity || 2.0;
        gain      = gain      || 0.5;
        let val = 0, amp = 0.5, freq = 1, max = 0;
        for (let i = 0; i < octaves; i++) {
            val += _perlin(x * freq, y * freq) * amp;
            max += amp;
            freq *= lacunarity;
            amp  *= gain;
        }
        return val / max;
    }

    // =========================================================================
    // Constants
    // =========================================================================
    // World render scale. The 2D world map is still a 256x256 grid, but each tile
    // is drawn WORLD_SCALE times larger than the old 250-unit tile so the driving
    // world feels vast. Vehicles (the camper and traffic) stay at their real size
    // - they are the 1x reference - while the scenery (terrain, cities, biome
    // decorations, enemies) is drawn up to this scale. Driving speed, fuel burn,
    // fog and the sky dome all scale off WORLD_SCALE so the drive still feels the
    // same behind the wheel; only the sense of scale changes.
    const WORLD_SCALE      = 2;
    const WORLD_TILE_SIZE  = 250 * WORLD_SCALE;
    const WORLD_MAP_ID     = 315;   // the 2D world map; player tile = Vars 43/44
    const CAMPER_MAX_FUEL  = 100;
    // Legacy RPG Maker variable id for camper fuel, kept ONLY as a fallback for
    // the rare case where the core VehicleSystem (which owns window.VehicleFuel)
    // is not loaded. Fuel is otherwise managed in the per-vehicle window.VehicleFuel
    // store keyed 'camper' - never in a shared RPG Maker variable. Sharing var 65
    // is what let other events drain the tank in a couple of metres.
    const FUEL_VAR         = 65;
    // Fuel burn in the drive scene is purely distance-based (litres per world unit
    // actually travelled), never time-based. The world is huge (a tile is
    // WORLD_TILE_SIZE = 250 units), so the rate is still small - but now that fuel
    // lives in its own per-vehicle store (no more shared-variable draining), it is
    // set high enough that driving actually consumes the tank: at 0.0006 L/unit a
    // full 100 L tank covers ~167k units (~670 tiles) of driving. Standing still
    // costs nothing.
    // Burn is per world unit travelled; since the world (and the units the camper
    // covers per second) are now WORLD_SCALE times bigger, the per-unit rate is
    // divided by WORLD_SCALE so a tank still covers the same NUMBER OF TILES as
    // before (~670 tiles on a full 100 L tank). Standing still costs nothing.
    const FUEL_PER_UNIT    = 0.0006 / WORLD_SCALE;
    // Same burn rate expressed per km (50 world units = 1 km), kept for any callers
    // that reason about fuel per km; the drive scene itself burns per world unit.
    // WORLD_TILE_SIZE scales up while FUEL_PER_UNIT scales down, so this is unchanged.
    const FUEL_PER_KM      = FUEL_PER_UNIT * (WORLD_TILE_SIZE / 5);
    // Liminal (fast-travel) drive covers its apparent map distance in a
    // handful of real seconds, so burning fuel by distance moved (the rule
    // for ordinary driving, above) would drain the tank for a trip that isn't
    // really being driven. It burns instead at a flat rate per REAL second,
    // independent of the warp speed, and deliberately tiny - orders of
    // magnitude below what covering the same apparent distance would cost at
    // the wheel, so a long warp trip still only sips the tank.
    const LIMINAL_FUEL_PER_SEC    = 0.00003;
    const LIMINAL_BOOST_FUEL_MULT = 6;   // still costs more to boost through it, just not steeply
    const ZOOM_MAX         = 32000 * WORLD_SCALE;

    // -------------------------------------------------------------------------
    // Raw gamepad access for the shoulder triggers and Y button. RPG Maker's
    // gamepadMapper only exposes the analog sticks/face buttons through Input
    // and ignores the triggers, so these are polled directly: L2/R2 zoom the
    // chase/free camera, Y toggles first/third person (mirrors TAB).
    // -------------------------------------------------------------------------
    const GamepadRaw = {
        L2: 6, R2: 7, Y: 3,
        _heldY: false,
        pads() { return navigator.getGamepads ? (navigator.getGamepads() || []) : []; },
        connected() {
            for (const p of this.pads()) if (p && p.connected) return true;
            return false;
        },
        // Analog value 0..1 (digital buttons report 0 or 1).
        value(index) {
            let v = 0;
            for (const p of this.pads()) {
                if (!p || !p.connected || !p.buttons) continue;
                const b = p.buttons[index];
                if (!b) continue;
                const bv = typeof b.value === 'number' ? b.value : (b.pressed ? 1 : 0);
                if (bv > v) v = bv;
            }
            return v;
        },
        pressed(index) { return this.value(index) > 0.25; },
        // Edge-triggered: true only on the frame Y goes down.
        triggeredY() {
            const now = this.pressed(this.Y);
            const was = this._heldY;
            this._heldY = now;
            return now && !was;
        }
    };
    const WATER_LEVEL_Y    = -70 * WORLD_SCALE;   // seabed depth dug for water tiles (room to dive)
    // Road dimensions (world units, FIXED - not tile-scaled). Sized to the 1x
    // vehicles (the camper is ~42 wide), so the road stays a believable ribbon
    // across the vast tiles instead of a runway as wide as a city block.
    const ROAD_LANE_W      = 60;                       // one carriageway lane
    const ROAD_GAP         = 30;                        // centre gap between directions
    const ROAD_TOTAL_W     = ROAD_LANE_W * 2 + ROAD_GAP; // full road width (~150)
    const ROAD_LANE_OFF    = ROAD_GAP * 0.5 + ROAD_LANE_W * 0.5; // lane-marking / traffic lane offset
    // The asphalt is laid on the same blended height the camper drives at, so a
    // road tile's own ground is dropped by this much: a flat slab used to be cut
    // through by its terrain wherever the tile blended toward a mountain or a
    // shore, and the two surfaces flickered against each other. The drop reads
    // as an ordinary shoulder (~40 cm at this scale) on the verge.
    const ROAD_SINK        = 2;
    // Lane paint sits proud of the asphalt: each dash is a flat quad, so on a
    // sloped tile its far end has to clear the surface it is painted on.
    const ROAD_MARK_LIFT   = 1;

    // Fog densities (1/units). Divided by WORLD_SCALE so the haze reaches the same
    // number of tiles as before on the enlarged world.
    const FOG_DAY          = 0.0005   / WORLD_SCALE;   // normal driving haze
    const FOG_FREE         = 0.000005 / WORLD_SCALE;   // free-cam wide survey view
    const FOG_UNDERWATER   = 0.011    / WORLD_SCALE;   // murky underwater
    const CRITICAL_PARTS   = ['Engine', 'Transmission', 'Brakes', 'Steering'];
    const SECONDARY_PARTS  = ['Battery', 'Tires', 'Suspension'];  // i18n-ignore  VehicleSystemRepair record keys

    // Effective camper tank size, honoring the Expanded Tank upgrade (VehicleUpgrades).
    // Falls back to the base CAMPER_MAX_FUEL when the upgrade plugin is unavailable.
    function camperMaxFuel() {
        if (window.VehicleFuel) return window.VehicleFuel.max('camper');
        return (window.VehicleUpgrades && window.VehicleUpgrades.effectiveMaxFuel)
            ? window.VehicleUpgrades.effectiveMaxFuel('camper', CAMPER_MAX_FUEL)
            : CAMPER_MAX_FUEL;
    }

    // Camper fuel accessors. Primary storage is the per-vehicle window.VehicleFuel
    // store (key 'camper'); the RPG Maker variable is only a legacy fallback.
    function camperFuelGet() {
        if (window.VehicleFuel) return window.VehicleFuel.get('camper');
        return (typeof $gameVariables !== 'undefined')
            ? $gameVariables.value(FUEL_VAR) : camperMaxFuel();
    }
    function camperFuelSet(litres) {
        if (window.VehicleFuel) { window.VehicleFuel.set('camper', litres); return; }
        if (typeof $gameVariables !== 'undefined') {
            $gameVariables.setValue(FUEL_VAR, Math.max(0, Math.min(camperMaxFuel(), litres)));
        }
    }
    function camperFuelConsume(litres) {
        if (window.VehicleFuel) { window.VehicleFuel.consume('camper', litres); return; }
        camperFuelSet(camperFuelGet() - litres);
    }

    // First-person walk box, sized to the compact camper interior
    // (about 8 wide x 22 long inside the walls). Lets you roam the cabin / seats.
    const CAMPER_BOUNDS = {
        minX: -3.5, maxX: 3.5,
        minZ: -11, maxZ: 11
    };

    // Driver's seat (camper-local space, forward = +Z). The first-person driving
    // view pins the eye here, looking out through the windshield while the WASD
    // keys steer the camper instead of walking the cabin. The driver faces +Z,
    // so +X is to the driver's LEFT: a left-hand-drive seat sits at +X. The
    // cockpit hardware in CamperModel (_buildCockpit) is mirrored to line up with
    // this eye. Eye kept low, just above the wheel/gauge cluster (dash top ~5.75,
    // wheel rim top ~6.1), so the cockpit reads in view instead of the camera
    // floating above the dashboard.
    const DRIVER_SEAT = { x: 1.2, y: 6.4, z: 8.0 };

    // On-foot exploration (player detached from the parked camper). Speeds are in
    // world units/sec. There is no tether: the player can walk as far from the
    // parked camper as they like and simply walks back to climb in again.
    const FOOT_WALK         = 46;     // brisk walk speed
    const FOOT_SPRINT_MULT  = 1.85;   // hold sprint to move this much faster
    const FOOT_GRAVITY      = 230;    // downward accel (snappier arc than the old floaty jump)
    const FOOT_JUMP_VEL     = 62;     // initial jump velocity
    const FOOT_EYE          = 7;      // eye height above the ground while standing
    const FOOT_CABIN_WALK   = 14;     // walk speed inside the cabin (world units/sec, applied directly)
    // Solid parked camper for the on-foot walker: a capsule around the chassis
    // (half-length along its heading + body radius) that the player cannot
    // walk through. Sized to the ~9 x 24 CamperModel footprint.
    const FOOT_VAN_HALF_LEN = 10;
    const FOOT_VAN_RADIUS   = 8;
    // How close (world units) the player has to stand to the rear door's hinge,
    // inside or outside, before it swings open on its own.
    const DOOR_AUTO_OPEN_RANGE = 70;

    // Speed bookkeeping. The physics runs in km/h space (fwd speed, GEARS,
    // engine/brake accels are all km/h), and KMH_TO_UNITS converts that to world
    // units/sec at the position-integration step. It is kept at the BASE value of 1
    // (unscaled): the camper drives at its real speed relative to the 1x scenery
    // (vehicles, trees, buildings), and the vast 25x tiles simply take longer to
    // cross. (Auto fast-travel still flies across the world within its duration -
    // see the auto block, which reports a sane km/h so it never trips the liminal
    // overdrive.)
    const CRUISE_KMH        = 80;     // efficiency sweet spot for the fuel model
    const MAX_KMH           = 1666;   // absolute cap (turbo overdrive)
    const KMH_TO_UNITS      = 1;      // world units/sec per km/h (base, unscaled)
    // Liminal drive (auto fast-travel): cruise speed and the ramp-up time to
    // reach it, so the camper eases into warp speed instead of snapping to it.
    // Ease-out ramp (see the rampT*(2-rampT) curve below) reaches full cruise
    // exactly at LIMINAL_ACCEL_SEC, so this clears 10,000 km/h at 20s.
    const LIMINAL_TOP_KMH   = 12000;
    const LIMINAL_ACCEL_SEC = 20;
    // Terrain streaming normally keeps up with driving (radius 5, 6 chunk
    // builds/frame - see WorldTerrainRenderer), but liminal drive crosses
    // roughly 45+ tiles/sec at LIMINAL_TOP_KMH, far outrunning that budget and
    // leaving gaps where the always-present WaterPlane shows through and new
    // chunks never finish building. Both are widened only while the autopilot
    // is actually driving (see _isFastTravelActive() gating below).
    const LIMINAL_TERRAIN_RADIUS = 22;
    const LIMINAL_BUILD_BUDGET   = 110;

    // Driving physics: forward force through a 5-speed automatic gearbox,
    // quadratic air drag, surface-dependent rolling resistance and lateral
    // grip, gravity along the terrain grade, and a speed-sensitive steering
    // lock feeding a bicycle model. Velocity persists in world space, so the
    // camper can slide (lateral slip) instead of moving on rails.
    const WHEELBASE         = 18;     // world units between axles
    const MAX_STEER_LOCK    = 0.52;   // rad of steering lock at standstill
    const STEER_FALLOFF     = 0.011;  // lock shrinks with speed: lock/(1+v*k)
    // The camper pulls far harder than a real van and keeps pulling: the engine
    // force is high, the gearbox is spaced wide and air drag is light, so it
    // reaches its natural top (see NATURAL_TOP) in a handful of seconds rather
    // than a slow minute-long climb.
    const ENGINE_ACCEL      = 89.6;   // peak engine force (units/s^2) in top gear
    const GEARS             = [40, 82, 138, 208, 292];      // shift-up speeds (km/h)
    const GEAR_FORCE        = [1.9, 1.5, 1.25, 1.0, 0.85];  // per-gear torque mult
    const SHIFT_TIME        = 0.16;   // torque-cut pause on a gear change
    const BRAKE_DECEL       = 240;    // units/s^2 on the brakes
    const HANDBRAKE_DECEL   = 130;    // units/s^2 handbrake drag (rear lock)
    const HANDBRAKE_GRIP    = 0.25;   // lateral grip multiplier w/ handbrake on
    const REVERSE_MAX_KMH   = 28;
    const REVERSE_ACCEL     = 14;
    const DRAG_K            = 0.00056;// air drag: decel = k * v^2
    const SLOPE_ACCEL       = 30;     // gravity component along the grade
    const OVERDRIVE_KMHPS   = 180;    // turbo: km/h gained per second held (Shift)
    const OVERDRIVE_DECAY   = 90;     // decel above the natural top w/o turbo
    // Holding Shift (turbo) also multiplies the in-gear engine force, so the
    // camper launches / accelerates far harder while boosting, not just past the
    // natural top speed.
    const BOOST_ACCEL_MULT  = 5.0;
    // Liminal boost (holding Shift): the moment it is released, any speed carried
    // above the natural top collapses very fast, so the boost feels like a burst
    // rather than a coast. It also drinks fuel and bends the light around the
    // camper (below).
    const BOOST_RELEASE_DECAY = 900;  // km/h per second bled off when Shift released
    const BOOST_FUEL_MULT     = 16;   // fuel burn multiplier while boosting
    // Ramp physics: at speed, a steep uphill crest launches the camper off the
    // ground into a ballistic arc (it is NOT glued to the terrain anymore).
    const LAUNCH_KMH        = 150;    // min speed to ramp off an incline
    const LAUNCH_GRADE      = 0.24;   // min uphill grade (nose-up) to launch
    const AIR_GRAVITY       = 130;    // downward accel (world units/s^2) while airborne
    // Speed distortion: above this speed light starts to bend AROUND the camper.
    // It is a screen-space lens (see SpeedWarpFx), a bubble the size of the
    // vehicle rather than the whole world folding over; the scenery itself is
    // never moved.
    const WARP_START_KMH    = 180;
    const LAT_SCRUB         = 0.35;   // forward speed lost to lateral tyre scrub
    const NATURAL_TOP       = Math.sqrt(ENGINE_ACCEL / DRAG_K); // ~400 km/h on asphalt

    // Per-surface handling. grip = lateral slip decay per second; roll =
    // rolling resistance (units/s^2); dragMul scales drag off the asphalt;
    // bump feeds the suspension shake; dust spawns wheel dust particles.
    const SURFACES = {
        asphalt: { grip: 6.5, roll: 0.9, dragMul: 1.0,  bump: 0.0, dust: 0 },
        dirt:    { grip: 3.4, roll: 2.6, dragMul: 1.35, bump: 0.9, dust: 1 },
        grass:   { grip: 3.0, roll: 3.0, dragMul: 1.6,  bump: 0.7, dust: 1 },
        sand:    { grip: 2.4, roll: 4.2, dragMul: 2.0,  bump: 0.6, dust: 1 },
        snow:    { grip: 1.6, roll: 2.2, dragMul: 1.3,  bump: 0.4, dust: 0 },
        rock:    { grip: 3.6, roll: 2.2, dragMul: 1.5,  bump: 1.3, dust: 1 }
    };

    // Arcade body dynamics (purely cosmetic, driven by accel/steer/speed).
    const BODY_ROLL_MAX     = 0.10;   // radians of lean in a hard turn
    const BODY_PITCH_MAX    = 0.06;   // radians of nose dive / squat
    const BODY_BOUNCE_MAX   = 0.6;    // world units of suspension travel (gentle)
    const HEADLIGHT_NIGHT   = 0.45;   // dayFactor below which headlights switch on
    const HEADLIGHT_INTENSITY = 1.1;  // spotlight intensity when fully on (was 2.2, blew out the fp view)
    const HEADLIGHT_BEAM_OPACITY = 0.3; // glow-sprite opacity when fully on (was 0.5)

    // Procedural traffic: pooled low-poly cars driving the road grid.
    const TRAFFIC_MAX       = 12;
    const TRAFFIC_RING_MIN  = 3;      // tiles: nearest spawn ring around the camper
    const TRAFFIC_RING_MAX  = 9;      // tiles: farthest spawn / recycle ring
    const TRAFFIC_COLORS    = [0xb23b3b, 0x2f6fb0, 0xe0c24a, 0xdedede, 0x2f2f33, 0x3a8f5a, 0xc98a3a,
                               0x1d1f24, 0x8f9aa6, 0x6d3f8c, 0x1f7f86, 0xf0f2f5];
    // World units per metre, derived from the camper - the scene's 1x reference
    // vehicle. CamperModel scales Camper.glb to 26 units long over a 9-unit wheel
    // track, i.e. a 6.4 m x 2.2 m van, which puts one metre at ~4 world units.
    // Every traffic silhouette below is authored in METRES and multiplied by this,
    // so a hatchback really is smaller than the camper and a bus really is bigger.
    const UNITS_PER_M       = 4;

    // =========================================================================
    // Smooth time-of-day sky (keyframe interpolation, mirrors WeatherSystem.js).
    // Continuous across the whole 24h cycle (incl. the midnight wrap) so the 3D
    // sky never jumps the way the old piecewise dawn/day/dusk/night branches did.
    // =========================================================================
    const SKY_KEYFRAMES = [
        { h: 0.0,   c: [0.04, 0.05, 0.13] }, // deep night
        { h: 5.0,   c: [0.04, 0.05, 0.13] },
        { h: 6.0,   c: [0.20, 0.20, 0.38] }, // pre-dawn blue
        { h: 6.75,  c: [0.95, 0.55, 0.32] }, // dawn golden hour
        { h: 7.75,  c: [0.62, 0.78, 0.96] }, // early morning
        { h: 12.0,  c: [0.53, 0.81, 0.98] }, // midday
        { h: 17.0,  c: [0.53, 0.81, 0.98] },
        { h: 18.5,  c: [0.85, 0.68, 0.55] }, // pre-sunset warm
        { h: 19.25, c: [1.00, 0.52, 0.30] }, // sunset golden hour
        { h: 20.0,  c: [0.50, 0.32, 0.45] }, // dusk purple
        { h: 21.0,  c: [0.15, 0.16, 0.32] }, // blue hour
        { h: 22.0,  c: [0.04, 0.05, 0.13] }, // night
        { h: 24.0,  c: [0.04, 0.05, 0.13] }
    ];

    function sampleSkyColor(hour, out) {
        const kf = SKY_KEYFRAMES;
        let a = kf[0], b = kf[kf.length - 1];
        for (let i = 0; i < kf.length - 1; i++) {
            if (hour >= kf[i].h && hour <= kf[i + 1].h) { a = kf[i]; b = kf[i + 1]; break; }
        }
        const span = (b.h - a.h) || 1;
        const t = Math.max(0, Math.min(1, (hour - a.h) / span));
        out.setRGB(
            a.c[0] + (b.c[0] - a.c[0]) * t,
            a.c[1] + (b.c[1] - a.c[1]) * t,
            a.c[2] + (b.c[2] - a.c[2]) * t
        );
        return out;
    }

    // Smooth 0 (night) .. 1 (midday) factor for sun/ambient intensities.
    function dayFactorForHour(hour) {
        if (hour <= 5 || hour >= 21) return 0;
        if (hour < 7.75) return (hour - 5) / 2.75;   // dawn ramp up
        if (hour <= 17) return 1;                     // full day
        return Math.max(0, 1 - (hour - 17) / 4);      // dusk ramp down to 0 by 21
    }

    // =========================================================================
    // Biome / Terrain Helpers (module-level)
    // =========================================================================
    let _Biomes = (window.WorldGen && window.WorldGen.Biomes) ? window.WorldGen.Biomes : [];
    let _BiomesMap = null;
    let _BiomesMapIndex = null;

    // Biome lookups are by far the hottest thing during chunk building (called
    // ~4x per vertex). Memoize per tile + per name, and index biomes by name so
    // we never linear-scan or rescan map tiles. Caches are cleared at scene start
    // and whenever the async biome data finishes loading.
    const _biomeTileCache  = new Map();   // "wx,wy" -> biome object
    const _renderTypeCache = new Map();   // biome name -> 'mountain'|'water'|'road'|'flat'
    const _roadDirCache    = new Map();   // "wx,wy" -> road direction string
    let   _biomeByName = null, _biomeByNameLen = -1;
    function _clearBiomeCaches() {
        _biomeTileCache.clear();
        _renderTypeCache.clear();
        _roadDirCache.clear();
        _biomeByName = null; _biomeByNameLen = -1;
    }
    function _findBiome(name) {
        if (_biomeByName === null || _biomeByNameLen !== _Biomes.length) {
            _biomeByName = new Map();
            for (const b of _Biomes) _biomeByName.set(b.name, b);
            _biomeByNameLen = _Biomes.length;
        }
        return _biomeByName.get(name) || null;
    }

    if (_Biomes.length === 0) {
        fetch('js/db/WorldGen/Biomes.json')
            .then(r => r.json())
            .then(data => { _Biomes = data; _clearBiomeCaches(); })
            .catch(e => console.warn('[CamperDriving] Could not load Biomes.json:', e));
    }

    fetch('js/db/WorldGen/BiomesMap.json')
        .then(r => r.json())
        .then(data => {
            _BiomesMap = data;
            if (data.biomeCoordinateCache) {
                _BiomesMapIndex = {};
                for (const [name, coords] of Object.entries(data.biomeCoordinateCache)) {
                    for (const c of coords) {
                        _BiomesMapIndex[`${c.x},${c.y}`] = name;
                    }
                }
            }
            _clearBiomeCaches();
        })
        .catch(e => console.warn('[CamperDriving] Could not load BiomesMap.json (tile scan will be used):', e));

    function _sampleBiomeUncached(wx, wy) {
        if (typeof $gameMap !== 'undefined' && $gameMap.mapId() === 315) {
            let tileId = 0;
            for (let z = 3; z >= 0; z--) {
                const t = $gameMap.tileId(wx, wy, z);
                if (t) { tileId = t; break; }
            }
            if (tileId && window.ProcGenUtils) {
                const name = window.ProcGenUtils.getBiomeForWorldTile(tileId);
                return _findBiome(name) || { name, color: '#90ee90' };
            }
        }
        const cache = (typeof $gameSystem !== 'undefined' && $gameSystem._procGenData)
            ? $gameSystem._procGenData.biomeCoordinateCache : null;
        if (cache) {
            for (const [name, coords] of Object.entries(cache)) {
                if (coords.some(c => c.x === wx && c.y === wy)) {
                    return _findBiome(name) || { name, color: '#90ee90' };
                }
            }
        }
        if (_BiomesMapIndex) {
            const name = _BiomesMapIndex[`${wx},${wy}`];
            if (name) return _findBiome(name) || { name, color: '#90ee90' };
        }
        return { name: 'Fields', color: '#90ee90' };
    }

    function sampleBiomeAt(wx, wy) {
        const key = wx + ',' + wy;
        let b = _biomeTileCache.get(key);
        if (b === undefined) {
            b = _sampleBiomeUncached(wx, wy);
            _biomeTileCache.set(key, b);
        }
        return b;
    }

    function getRenderType(biomeName) {
        let t = _renderTypeCache.get(biomeName);
        if (t !== undefined) return t;
        const n = biomeName.toLowerCase();
        t = n.includes('mountain') ? 'mountain'
          : (n.includes('ocean') || n.includes('sea') || n === 'caveflooded' || n.includes('lake') || n.includes('river')) ? 'water'
          : (n.startsWith('road') || n === 'highway') ? 'road'
          : 'flat';
        _renderTypeCache.set(biomeName, t);
        return t;
    }

    function parseRoadDirection(biomeName) {
        const simple = biomeName.match(/^Road\s+(.+)/i);
        if (simple) return simple[1].toLowerCase().trim();
        const tagged = biomeName.match(/<Road:\s*\d+\s+([\w-]+)>/i);
        if (tagged) return tagged[1].toLowerCase();
        return 'horizontal';
    }

    function getRoadDirectionAt(wx, wy) {
        const key = wx + ',' + wy;
        let cached = _roadDirCache.get(key);
        if (cached !== undefined) return cached;

        let dir = null;
        const procGenData = (typeof $gameSystem !== 'undefined' && $gameSystem._procGenData)
            ? $gameSystem._procGenData : null;
        if (procGenData && procGenData.precomputedRoadDirections) {
            dir = procGenData.precomputedRoadDirections[key] || null;
        }
        if (!dir && _BiomesMap && _BiomesMap.roadDirections) {
            dir = _BiomesMap.roadDirections[key] || null;
        }
        if (!dir) dir = parseRoadDirection(sampleBiomeAt(wx, wy).name);

        _roadDirCache.set(key, dir);
        return dir;
    }

    // =========================================================================
    // Road graph. The world map's road tiles are tagged with the direction names
    // written by ProceduralMapRoadGenerator, which state exactly which tile edges
    // a piece of asphalt joins. That turns the tagged tiles into a navigable
    // graph: which way a road leaves a tile, and therefore where a driver may
    // turn at a crossing.
    // =========================================================================
    const ROAD_LINKS = {
        horizontal:           ['e', 'w'],
        vertical:             ['n', 's'],
        cross:                ['n', 's', 'e', 'w'],
        // T-junctions: the stem points the named way, the opposite leg is missing.
        't-up':               ['n', 'e', 'w'],
        't-north':            ['n', 'e', 'w'],
        't-down':             ['s', 'e', 'w'],
        't-south':            ['s', 'e', 'w'],
        't-left':             ['w', 'n', 's'],
        't-west':             ['w', 'n', 's'],
        't-right':            ['e', 'n', 's'],
        't-east':             ['e', 'n', 's'],
        // Corners join the two named perpendicular edges.
        'corner-up-left':     ['n', 'w'],
        'corner-left-up':     ['n', 'w'],
        'corner-north-west':  ['n', 'w'],
        'corner-up-right':    ['n', 'e'],
        'corner-right-up':    ['n', 'e'],
        'corner-north-east':  ['n', 'e'],
        'corner-down-left':   ['s', 'w'],
        'corner-left-down':   ['s', 'w'],
        'corner-south-west':  ['s', 'w'],
        'corner-down-right':  ['s', 'e'],
        'corner-right-down':  ['s', 'e'],
        'corner-south-east':  ['s', 'e']
    };
    // North is -y on the world map, which is -z in the 3D scene.
    const ROAD_STEP     = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    const ROAD_OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
    const WORLD_TILES   = 256;   // world map (315) is 256x256 tiles

    // The tagged road tiles of the whole world, as a "x,y" -> direction map.
    // Prefers the live procedural data, falling back to the shipped BiomesMap.
    function roadTileTable() {
        const procGenData = (typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._procGenData)
            ? $gameSystem._procGenData : null;
        if (procGenData && procGenData.precomputedRoadDirections) return procGenData.precomputedRoadDirections;
        if (_BiomesMap && _BiomesMap.roadDirections) return _BiomesMap.roadDirections;
        return null;
    }

    // True once the world's road tags are loaded, i.e. once a route can be planned.
    function roadDataReady() {
        const t = roadTileTable();
        return !!(t && Object.keys(t).length);
    }

    // A tile is drivable road when it carries a road tag (this also covers the
    // bridge tiles, which are roads laid over water) or renders as asphalt.
    function isRoadTile(wx, wy) {
        if (wx < 0 || wy < 0 || wx >= WORLD_TILES || wy >= WORLD_TILES) return false;
        const table = roadTileTable();
        if (table && table[wx + ',' + wy]) return true;
        return getRenderType(sampleBiomeAt(wx, wy).name) === 'road';
    }

    // Which edges ('n','s','e','w') the road on this tile connects to.
    function roadLinksAt(wx, wy) {
        if (!isRoadTile(wx, wy)) return [];
        const dir = String(getRoadDirectionAt(wx, wy) || '').toLowerCase();
        return ROAD_LINKS[dir] || ['n', 's', 'e', 'w'];
    }

    // The ways out of a tile that actually continue onto another road tile.
    // `from` is the edge the driver came in by and is excluded unless it is the
    // only way left (a dead end, where turning around is the only option).
    function roadExitsFrom(wx, wy, from) {
        const links = roadLinksAt(wx, wy);
        const out = [];
        for (const side of links) {
            if (side === from) continue;
            const step = ROAD_STEP[side];
            const nx = wx + step[0], ny = wy + step[1];
            if (!isRoadTile(nx, ny)) continue;
            // The neighbour must join this tile back, or the two roads only touch.
            if (roadLinksAt(nx, ny).indexOf(ROAD_OPPOSITE[side]) < 0) continue;
            out.push(side);
        }
        return out;
    }

    // A random tagged road tile with somewhere to drive to, used to drop the
    // camper onto the world's road network (title-screen autopilot / recovery).
    function pickRandomRoadTile() {
        const table = roadTileTable();
        if (!table) return null;
        const keys = Object.keys(table);
        if (!keys.length) return null;
        for (let i = 0; i < 200; i++) {
            const parts = keys[Math.floor(Math.random() * keys.length)].split(',');
            const x = Number(parts[0]), y = Number(parts[1]);
            if (!isFinite(x) || !isFinite(y)) continue;
            if (roadExitsFrom(x, y, null).length >= 2) return { x, y };
        }
        const parts = keys[Math.floor(Math.random() * keys.length)].split(',');
        return { x: Number(parts[0]), y: Number(parts[1]) };
    }

    // Closest named place on the world map (WorldGen.HardcodedBiomeNames), or the
    // tile's biome, spaced out for reading ("SpiritWoods" -> "Spirit Woods").
    function placeNameAt(wx, wy, radius) {
        const names = (window.WorldGen && window.WorldGen.HardcodedBiomeNames) || null;
        const r = radius == null ? 5 : radius;
        if (names) {
            for (let ring = 0; ring <= r; ring++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    for (let dy = -ring; dy <= ring; dy++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                        const n = names[(wx + dx) + ',' + (wy + dy)];
                        if (n) return n;
                    }
                }
            }
        }
        // No named landmark nearby: name the countryside the road runs through,
        // i.e. the most common biome around the tile (the road itself excluded,
        // or every stretch would just read "road").
        const tally = new Map();
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                const n = sampleBiomeAt(wx + dx, wy + dy).name;
                if (/^road/i.test(n) || /^bridge/i.test(n)) continue;
                tally.set(n, (tally.get(n) || 0) + 1);
            }
        }
        let best = null, bestN = 0;
        for (const [n, c] of tally) { if (c > bestN) { best = n; bestN = c; } }
        const biome = (best || sampleBiomeAt(wx, wy).name);
        if (/^Road\s+/i.test(biome)) return T('CamperDrive.openRoad');
        return window.BiomeNames.display(biome);
    }

    // A road number for the stretch of asphalt under the camper. Roads carry no
    // names in the world data, so one is derived from the tile block, which keeps
    // it stable for a good stretch of driving and changes as the region does.
    function roadLabelAt(wx, wy) {
        const dir    = String(getRoadDirectionAt(wx, wy) || '').toLowerCase();
        const prefix = dir === 'vertical' ? 'N' : dir === 'horizontal' ? 'E' : 'A';
        const block  = Math.floor(wx / 8) * 31 + Math.floor(wy / 8) * 17;
        return prefix + (1 + (Math.abs(block) % 399));
    }

    // Tall, peaky mountains. The power curve flattens the foothills and sharpens
    // the summits; amplitude ~440 units towers far above the camper and houses.
    const MOUNTAIN_MAX_H = 440 * WORLD_SCALE;
    const SNOW_LINE      = 250 * WORLD_SCALE;
    const _SNOW_COLOR    = (typeof THREE !== 'undefined') ? new THREE.Color(0xfdfdff) : null;
    const _ROCK_COLOR    = (typeof THREE !== 'undefined') ? new THREE.Color(0x6b6b73) : null;

    function noiseHeight(globalX, globalZ, tileWX, tileWY) {
        const seedOff = ((tileWX * 127 + tileWY * 311) & 0x7fff) * 0.001;
        const scale   = 0.016;
        const raw     = _fbm(globalX * scale + seedOff, globalZ * scale + seedOff, 5, 2.0, 0.5);
        const n       = raw * 0.5 + 0.5;                 // 0..1
        return Math.pow(n, 1.5) * MOUNTAIN_MAX_H + 18 * WORLD_SCALE;
    }

    // =========================================================================
    // 2D sprite pools for billboarded vegetation / rocks. These are RPG Maker
    // furniture tiles under img/furniture/{Trees,Plants,Rocks}; the decorator
    // scatters them as camera-facing billboards instead of low-poly 3D props.
    // =========================================================================
    const TREE_POOLS = {
        broadleaf: ['tileset_trees_1_000.png', 'tileset_trees_1_004.png', 'tileset_trees_2_002.png',
                    'tileset_trees_3_000.png', 'tileset_trees_4_000.png', 'ext-b-forest_043.png',
                    'ext-b-forest_061.png', 'forest_c_126.png', 'forest_c_131.png'],
        conifer:   ['tileset_trees_5_000.png', 'tileset_trees_5_001.png', 'tileset_trees_5_002.png',
                    'ext-b-forest_051.png', 'b_snow_000.png'],
        snow:      ['b_snow_000.png', 'b_snow_012.png', 'tileset_trees_5_003.png'],
        jungle:    ['tf_jungle_b_000.png', 'tf_jungle_b_040_0_split.png', 'tf_jungle_b_041_0_split.png'],
        sakura:    ['sakurae_000.png', 'sakurae_002.png', 'sakurae_009.png', 'sakurae_016.png'],
        fruit:     ['tileset_fruit_trees_1_000.png', 'tileset_fruit_trees_1_001.png',
                    'tileset_fruit_trees_2_002.png', 'tileset_fruit_trees_3_002.png'],
        dead:      ['graveyardhalloween_026.png', 'graveyardhalloween_030.png', 'dungeon_b_110.png'],
        generic:   ['tileset_trees_1_000.png', 'tileset_trees_3_000.png', 'tileset_trees_4_002.png']
    };
    const ROCK_POOL = ['b_openrpg_002.png', 'b_openrpg_005.png', 'b_openrpg_011.png',
                       'tileset_106_mv_000.png', 'tileset_106_mv_004.png', 'tileset_81_mv_003.png',
                       'camping_038.png', 'dungeon_decorationsc_027.png'];
    const ROCK_ASH  = ['tf_b_ashlands_3_022.png', 'tf_b_ashlands_3_030.png', 'tf_b_ashlands_3_033.png'];
    const PLANT_POOL = ['grassmazearchs_003.png', 'grassmazearchs_006.png', 'playground_050.png',
                        'playground_052.png', 'a2_namek_009.png', 'camping_018.png'];
    const PLANT_CROPS = ['tileset_crops_001.png', 'tileset_crops_009.png', 'tileset_crops_020.png',
                         'tileset_crops_046.png'];

    // =========================================================================
    // ProceduralDecorator
    // High-performance instanced chunk decorations (Cities, Forests, Deserts)
    // =========================================================================
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
                gasSign:     new THREE.BoxGeometry(9, 6, 1)
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
            const mkQuad = (w, h) => new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
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
        _decorateGasStation(grp, wx, wy) {
            const st = new THREE.Group();
            const sx = (this._seededRandom(wx, wy, 71) < 0.5 ? -1 : 1) * 78;
            const sz = (this._seededRandom(wx, wy, 72) < 0.5 ? -1 : 1) * 78;
            st.position.set(sx, 0, sz);
            st.rotation.y = this._seededRandom(wx, wy, 73) * Math.PI * 2;

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

        // A dense settlement laid out on an actual street grid: the tile is divided
        // into a lattice of lots (separated by clear "streets"), and a building is
        // dropped in most lots - towers for cities, gabled houses for villages -
        // with a central cross-avenue left clear for the through road. Buildings are
        // 1x-scaled up to fill their lot, so a city reads as a packed skyline rather
        // than a handful of specks on a huge tile.
        _decorateCityGrid(grp, wx, wy, big, heightFn) {
            const ts   = this._ts;
            const L    = big ? 18 : 12;              // lots per axis
            const pitch = ts / L;
            const avenue = pitch * 0.7;              // clear cross-road half-width at tile centre
            // Building footprint ~half the lot so the gaps read as streets.
            const geoW = big ? 20 : 14;              // skyscraper / house base footprint
            const baseScale = (pitch * 0.5) / geoW;

            const towers = [];   // skyscraper OR houseBase transforms
            const roofs  = [];   // village roofs (houses only)
            for (let i = 0; i < L; i++) {
                for (let j = 0; j < L; j++) {
                    const cx = -ts / 2 + (i + 0.5) * pitch;
                    const cz = -ts / 2 + (j + 0.5) * pitch;
                    // Leave a clear cross-avenue through the middle for the road.
                    if (Math.abs(cx) < avenue || Math.abs(cz) < avenue) continue;
                    // ~15% of lots are empty (plazas / parks) for variety.
                    if (this._seededRandom(wx, wy, i * 53 + j * 7 + 11) < 0.15) continue;
                    const yPos = heightFn ? heightFn(wx + 0.5 + cx / ts, wy + 0.5 + cz / ts) : 0;
                    // heightFn blends toward WATER_LEVEL_Y (a deep negative) from
                    // ANY bordering water tile, even a sliver of blend weight, so a
                    // strict "< -0.5" throws out roughly half the grid whenever the
                    // settlement has water on one side (common - rivers/coasts run
                    // right up to a lot of towns). Only reject lots whose blended
                    // height is substantially into the water, i.e. genuinely at the
                    // shoreline, not just a few percent blended toward it.
                    if (yPos < WATER_LEVEL_Y * 0.3) continue;
                    const jitter = (this._seededRandom(wx, wy, i * 31 + j * 17 + 3) - 0.5) * pitch * 0.15;
                    const scale = baseScale * ((big ? 0.55 : 0.7) + this._seededRandom(wx, wy, i * 13 + j * 29 + 5) * (big ? 0.9 : 0.5));
                    const rotY = big ? 0 : (this._seededRandom(wx, wy, i * 19 + j * 23 + 9) - 0.5) * 0.4;
                    const rec = { x: cx + jitter, y: yPos, z: cz + jitter, rotY, scale };
                    towers.push(rec);
                    if (!big) roofs.push(rec);
                }
            }
            if (big) {
                this._instance(grp, this.geos.skyscraper, this.skyscraperMat, towers);
            } else {
                this._instance(grp, this.geos.houseBase, this.houseMat, towers);
                this._instance(grp, this.geos.houseRoof, '#8b0000', roofs);
            }
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
        // Cached texture from img/furniture/<folder>/<name>.
        _loadFurnitureTex(folder, name) {
            const key = folder + '/' + name;
            let t = this._spriteTex.get(key);
            if (t) return t;
            t = new THREE.TextureLoader().load('img/furniture/' + folder + '/' + name);
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
        _scatterBillboards(grp, folder, names, quad, items, size, wx, wy, seedBase) {
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
            for (const [name, list] of buckets) {
                const im = new THREE.InstancedMesh(quad, this._billboardMat(folder, name), list.length);
                im.castShadow = false;
                im.receiveShadow = false;
                im.frustumCulled = false;
                for (let i = 0; i < list.length; i++) {
                    const p = list[i];
                    dummy.position.set(p.x, p.y, p.z);
                    dummy.quaternion.set(0, 0, 0, 1);
                    dummy.scale.setScalar(size * (p.scale || 1));
                    dummy.updateMatrix();
                    im.setMatrixAt(i, dummy.matrix);
                }
                grp.add(im);
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
                this._decorateGasStation(grp, wx, wy);
                this._decorateCityGrid(grp, wx, wy, isCity, heightFn);
                return;   // the grid fills the tile; skip the wilderness scatter
            }

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
                    out.push({ x: lx, y: yPos, z: lz, rotY, scale });
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
            const treePool = this._treePoolFor(n);
            if (treePool) {
                this._scatterBillboards(grp, 'Trees', treePool, this.spriteQuads.tree,  // i18n-ignore  scatter group id
                    genItems(Math.round(baseCount * 1.2), 40), 30, wx, wy, 313);
            }

            // --- 2D billboard plants / ground cover ---
            const plantPool = this._plantPoolFor(n);
            if (plantPool) {
                this._scatterBillboards(grp, 'Plants', plantPool, this.spriteQuads.plant,  // i18n-ignore  scatter group id
                    genItems(Math.round(baseCount * 0.9), 200), 11, wx, wy, 517);
            }

            // --- 2D billboard rocks ---
            let rockPool = this._rockPoolFor(n);
            // Nothing else claimed this tile? Sprinkle sparse rocks so it isn't barren.
            if (!rockPool && !arch && !treePool) rockPool = ROCK_POOL;
            if (rockPool) {
                const rc = (!this._rockPoolFor(n)) ? Math.round(baseCount * 0.4) : Math.round(baseCount * 0.7);
                this._scatterBillboards(grp, 'Rocks', rockPool, this.spriteQuads.rock,  // i18n-ignore  scatter group id
                    genItems(rc, 900), 13, wx, wy, 733);
            }
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
    // WorldTerrainRenderer
    // =========================================================================
    class WorldTerrainRenderer {
        constructor(scene) {
            this._scene    = scene;
            this._chunks   = new Map();
            this._radius   = 5;
            this._buildBudget = 6;
            this._ts       = WORLD_TILE_SIZE;
            this._matCache = new Map();
            this._vertexMat = null;
            this._mountainMat = null;
            this._asphaltMat = null;
            this._waterMat  = null;
            this._poleMat   = null;
            this._lampMat   = null;
            this._lodMode  = false;
            this._decorator = new ProceduralDecorator(this._matCache);
        }

        setLodMode(lod) {
            if (this._lodMode === lod) return;
            this._lodMode = lod;
            for (const [, grp] of this._chunks) {
                this._scene.remove(grp);
                grp.traverse(o => {
                    if (o.geometry) o.geometry.dispose();
                });
            }
            this._chunks.clear();
        }

        _getMat(hexColor) {
            if (!this._matCache.has(hexColor)) {
                const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(hexColor) });
                mat.polygonOffset      = true;
                mat.polygonOffsetFactor = -1;
                mat.polygonOffsetUnits  = -4;
                this._matCache.set(hexColor, mat);
            }
            return this._matCache.get(hexColor);
        }

        _getMarkMat() {
            if (!this._markMat) {
                this._markMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
                this._markMat.polygonOffset       = true;
                this._markMat.polygonOffsetFactor  = -2;
                this._markMat.polygonOffsetUnits   = -8;
                this._markMat.depthWrite           = false;
            }
            return this._markMat;
        }

        // Land terrain: tiled stone detail multiplied by the biome vertex colour
        // (integer repeat keeps tiles continuous across the per-chunk 0..1 UVs).
        _getVertexMat() {
            if (!this._vertexMat) {
                this._vertexMat = new THREE.MeshLambertMaterial({
                    vertexColors: true,
                    map: loadTex('tan_stone.jpg', 4)
                });
            }
            return this._vertexMat;
        }

        // Mountains: rock detail under the rock/snow vertex tint from the builder.
        _getMountainMat() {
            if (!this._mountainMat) {
                this._mountainMat = new THREE.MeshLambertMaterial({
                    vertexColors: true,
                    map: loadTex('brown_stone.jpg', 5)
                });
            }
            return this._mountainMat;
        }

        // Road asphalt: tiled concrete.
        _getAsphaltMat() {
            if (!this._asphaltMat) {
                this._asphaltMat = new THREE.MeshLambertMaterial({ color: 0x6f6f73, map: loadTex('grey_concrete.jpg', 3) });
                this._asphaltMat.polygonOffset      = true;
                this._asphaltMat.polygonOffsetFactor = -1;
                this._asphaltMat.polygonOffsetUnits  = -4;
            }
            return this._asphaltMat;
        }

        update(camperX, camperZ, buildAll = false) {
            const cwx = Math.floor(camperX / this._ts);
            const cwy = Math.floor(camperZ / this._ts);

            // Skip the whole neighborhood rescan when nothing that affects it
            // changed since last frame (same chunk coords and same radius) AND
            // the previous frame had no chunks left to build. buildAll forces a
            // rescan. (Keeps the per-frame spread-build going until it drains.)
            if (!buildAll && cwx === this._lastCwx && cwy === this._lastCwy &&
                this._radius === this._lastRadius && !this._pendingBuilds) {
                return;
            }
            this._lastCwx = cwx;
            this._lastCwy = cwy;
            this._lastRadius = this._radius;

            const needed = [];
            for (let dx = -this._radius; dx <= this._radius; dx++) {
                for (let dy = -this._radius; dy <= this._radius; dy++) {
                    const wx = cwx + dx;
                    const wy = cwy + dy;
                    const key = `${wx},${wy}`;
                    if (!this._chunks.has(key) && wx >= 0 && wx < 256 && wy >= 0 && wy < 256) {
                        needed.push({ wx, wy, key, dist: dx * dx + dy * dy });
                    }
                }
            }
            needed.sort((a, b) => a.dist - b.dist);

            // Spread chunk builds across frames to avoid hitches. The initial
            // fill (buildAll) does everything at once; after that only a handful
            // per frame, which easily keeps up with movement (well under one tile
            // per frame even at 999 km/h).
            const maxBuilds = buildAll ? needed.length
                : this._lodMode ? 24
                : this._buildBudget;

            const limit = Math.min(maxBuilds, needed.length);
            for (let i = 0; i < limit; i++) {
                const { wx, wy, key } = needed[i];
                this._chunks.set(key, this._buildChunk(wx, wy));
            }
            // If builds remain queued, keep rescanning next frame to drain them.
            this._pendingBuilds = needed.length > limit;

            // Evict distant chunks regardless of radius, otherwise free-cam
            // (large radius) chunks accumulate unbounded.
            for (const [key, grp] of this._chunks) {
                const cx = grp.userData._cx;
                const cy = grp.userData._cy;
                if (Math.abs(cx - cwx) > this._radius + 2 || Math.abs(cy - cwy) > this._radius + 2) {
                    this._scene.remove(grp);
                    grp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
                    this._chunks.delete(key);
                }
            }
        }

        getTerrainHeight(gx, gz) {
            const x0 = Math.floor(gx - 0.5);
            const x1 = x0 + 1;
            const z0 = Math.floor(gz - 0.5);
            const z1 = z0 + 1;

            const tx = gx - 0.5 - x0;
            const tz = gz - 0.5 - z0;

            const w00 = (1 - tx) * (1 - tz);
            const w10 = tx * (1 - tz);
            const w01 = (1 - tx) * tz;
            const w11 = tx * tz;

            const getH = (xx, zz) => {
                const type = getRenderType(sampleBiomeAt(xx, zz).name);
                if (type === 'mountain') return noiseHeight(gx, gz, xx, zz);
                if (type === 'water') return WATER_LEVEL_Y;
                return 0;
            };

            return getH(x0, z0) * w00 + 
                   getH(x1, z0) * w10 + 
                   getH(x0, z1) * w01 + 
                   getH(x1, z1) * w11;
        }

        _buildChunk(wx, wy) {
            const biome = sampleBiomeAt(wx, wy);
            const grp   = new THREE.Group();
            // Cache chunk coords so eviction doesn't re-parse the string key.
            grp.userData._cx = wx;
            grp.userData._cy = wy;
            grp.position.set(wx * this._ts + this._ts * 0.5, 0, wy * this._ts + this._ts * 0.5);

            if (this._lodMode) {
                const n = biome.name.toLowerCase();
                let color = biome.color || '#90ee90';
                if (n.includes('ocean') || n.includes('sea') || n === 'caveflooded' || n.includes('lake')) color = '#1a6ba0';
                else if (n.startsWith('road') || n === 'highway') color = '#2e2e2e';
                
                const geo = new THREE.PlaneGeometry(this._ts, this._ts);
                geo.rotateX(-Math.PI / 2);
                const mesh = new THREE.Mesh(geo, this._getMat(color));
                grp.add(mesh);
            } else {
                const type = getRenderType(biome.name);
                
                // 1. Build Base Blended Terrain (Handles Flat, Mountain, Coastlines & Beaches)
                this._buildBaseTerrain(grp, wx, wy, biome);

                // 2. Add Road Overlays
                if (type === 'road') {
                    this._buildRoad(grp, biome, wx, wy);
                    this._buildStreetlights(grp, wx, wy);
                }
                
                // 3. Add Low-Poly Decorators (Trees, Buildings)
                if (type !== 'road' && type !== 'water') {
                    this._decorator.decorate(grp, wx, wy, biome, this._ts, (gx, gz) => this.getTerrainHeight(gx, gz));
                }
            }

            this._scene.add(grp);
            return grp;
        }

        _buildBaseTerrain(grp, wx, wy, baseBiome) {
            const type = getRenderType(baseBiome.name);
            const isMountain = type === 'mountain';
            // A road tile's ground is dropped so the asphalt laid on top of it
            // always has clearance, whatever the tile blends toward.
            const sink = type === 'road' ? ROAD_SINK : 0;
            const segs = isMountain ? 16 : 8;
            
            const geo = new THREE.PlaneGeometry(this._ts, this._ts, segs, segs);
            geo.rotateX(-Math.PI / 2);

            const pos = geo.attributes.position;
            const colArr = new Float32Array(pos.count * 3);   // written directly, no growing array
            const colorObj = new THREE.Color();

            // Scratch colours + a single height helper reused for every vertex, so
            // the loop allocates nothing (was ~6 THREE.Color + a closure per vertex).
            const C0 = new THREE.Color(), C1 = new THREE.Color(), C2 = new THREE.Color(), C3 = new THREE.Color();
            const SAND = new THREE.Color('#e0d6a8');
            const heightOf = (t, xx, zz, gx, gz) =>
                t === 'mountain' ? noiseHeight(gx, gz, xx, zz) : t === 'water' ? WATER_LEVEL_Y : 0;

            for (let i = 0; i < pos.count; i++) {
                const lx = pos.getX(i);
                const lz = pos.getZ(i);
                const gx = wx + 0.5 + lx / this._ts;
                const gz = wy + 0.5 + lz / this._ts;

                const x0 = Math.floor(gx - 0.5);
                const x1 = x0 + 1;
                const z0 = Math.floor(gz - 0.5);
                const z1 = z0 + 1;

                const tx = gx - 0.5 - x0;
                const tz = gz - 0.5 - z0;

                const w00 = (1 - tx) * (1 - tz);
                const w10 = tx * (1 - tz);
                const w01 = (1 - tx) * tz;
                const w11 = tx * tz;

                const b00 = sampleBiomeAt(x0, z0);
                const b10 = sampleBiomeAt(x1, z0);
                const b01 = sampleBiomeAt(x0, z1);
                const b11 = sampleBiomeAt(x1, z1);

                const t00 = getRenderType(b00.name);
                const t10 = getRenderType(b10.name);
                const t01 = getRenderType(b01.name);
                const t11 = getRenderType(b11.name);

                const h = heightOf(t00, x0, z0, gx, gz) * w00 +
                          heightOf(t10, x1, z0, gx, gz) * w10 +
                          heightOf(t01, x0, z1, gx, gz) * w01 +
                          heightOf(t11, x1, z1, gx, gz) * w11;
                pos.setY(i, h - sink);

                // --- Colour blend + coastline (reusing scratch colours) ---
                C0.set(b00.color || '#90ee90');
                C1.set(b10.color || '#90ee90');
                C2.set(b01.color || '#90ee90');
                C3.set(b11.color || '#90ee90');

                let waterWeight = 0;
                if (t00 === 'water') waterWeight += w00;
                if (t10 === 'water') waterWeight += w10;
                if (t01 === 'water') waterWeight += w01;
                if (t11 === 'water') waterWeight += w11;

                if (t00 === 'water') C0.copy(SAND);
                if (t10 === 'water') C1.copy(SAND);
                if (t01 === 'water') C2.copy(SAND);
                if (t11 === 'water') C3.copy(SAND);

                if (waterWeight > 0) {
                    const spread = Math.pow(waterWeight, 0.6);
                    if (t00 !== 'water') C0.lerp(SAND, spread);
                    if (t10 !== 'water') C1.lerp(SAND, spread);
                    if (t01 !== 'water') C2.lerp(SAND, spread);
                    if (t11 !== 'water') C3.lerp(SAND, spread);
                }

                colorObj.setRGB(
                    C0.r * w00 + C1.r * w10 + C2.r * w01 + C3.r * w11,
                    C0.g * w00 + C1.g * w10 + C2.g * w01 + C3.g * w11,
                    C0.b * w00 + C1.b * w10 + C2.b * w01 + C3.b * w11
                );

                if (h > 120 && _ROCK_COLOR) colorObj.lerp(_ROCK_COLOR, Math.min(1, (h - 120) / 170) * 0.7);
                if (h > SNOW_LINE && _SNOW_COLOR) colorObj.lerp(_SNOW_COLOR, Math.min(1, (h - SNOW_LINE) / 150));

                colArr[i * 3]     = colorObj.r;
                colArr[i * 3 + 1] = colorObj.g;
                colArr[i * 3 + 2] = colorObj.b;
            }

            geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
            geo.computeVertexNormals();

            const mesh = new THREE.Mesh(geo, isMountain ? this._getMountainMat() : this._getVertexMat());
            mesh.receiveShadow = true;   // mountains no longer cast (shadow-pass cost)
            grp.add(mesh);
        }

        _buildRoad(grp, biome, wx, wy) {
            const ts  = this._ts;
            const dir = getRoadDirectionAt(wx, wy);

            const asphaltMat = this._getAsphaltMat();
            const markMat    = this._getMarkMat();
            // Fixed road width (sized to the 1x vehicles), not scaled to the tile.
            const laneOff    = ROAD_LANE_OFF;
            const totalW     = ROAD_TOTAL_W;
            const legLen     = (ts - totalW) / 2;
            const legCenter  = totalW / 2 + legLen / 2;

            // Blended ground height at a tile-local offset - the very same value
            // the camper rides at - so the asphalt and the vehicle on it always
            // agree, and the (sunk) ground below can never cut through.
            const hAt = (lx, lz) => this.getTerrainHeight(wx + 0.5 + lx / ts, wy + 0.5 + lz / ts);

            // --- Solid asphalt slab helper ---
            // Subdivided on roughly the terrain's own grid and draped over it: a
            // single flat quad sat level while the ground under it ramped toward
            // mountain / shore neighbours, so the two kept swapping in front of
            // each other down the length of the tile.
            const addSlab = (w, d, ox, oz) => {
                const step  = ts / 8;
                const geo = new THREE.PlaneGeometry(
                    w, d,
                    Math.max(1, Math.round(w / step)),
                    Math.max(1, Math.round(d / step))
                );
                geo.rotateX(-Math.PI / 2);
                const pos = geo.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                    pos.setY(i, hAt(ox + pos.getX(i), oz + pos.getZ(i)));
                }
                geo.computeVertexNormals();
                const m = new THREE.Mesh(geo, asphaltMat);
                m.position.set(ox, 0, oz);
                m.receiveShadow = true;
                grp.add(m);
            };

            // --- Dashed lane markings (two parallel lines at ±laneOff) ---
            // One InstancedMesh per segment instead of a mesh per dash: a long
            // road tile drops from ~18 draw calls to 1.
            const addSegmentDashes = (isEW, cx, cz, length) => {
                const dashLen  = 18;
                const dashGap  = 10;
                const dashW    = 1.2;
                const cycle    = dashLen + dashGap;
                const count    = Math.floor(length / cycle);
                if (count <= 0) return;
                const startOff = -length / 2 + dashLen / 2;

                const dGeo = new THREE.PlaneGeometry(
                    isEW ? dashLen : dashW,
                    isEW ? dashW   : dashLen
                ).rotateX(-Math.PI / 2);
                const inst = new THREE.InstancedMesh(dGeo, markMat, count * 2);
                inst.receiveShadow = true;

                const m = new THREE.Matrix4();
                let idx = 0;
                for (let i = 0; i < count; i++) {
                    const offset = startOff + i * cycle;
                    for (const off of [-laneOff, laneOff]) {
                        const px = isEW ? cx + offset : cx + off;
                        const pz = isEW ? cz + off    : cz + offset;
                        // Painted on the asphalt, which now follows the ground.
                        m.makeTranslation(px, hAt(px, pz) + ROAD_MARK_LIFT, pz);
                        inst.setMatrixAt(idx++, m);
                    }
                }
                grp.add(inst);
            };

            // --- Curved corner builder ---
            // Instead of two straight legs meeting at a hard 90°, a corner tile is
            // a smooth quarter-circle ribbon whose centreline passes through the two
            // open edge midpoints (radius = half a tile). The arc leaves each edge
            // tangent to the neighbouring straight road, so bends flow as curves
            // rather than snapping to right angles. Angles are in the local tile XZ
            // frame (N=-z, S=+z, E=+x, W=-x); (ccx,ccz) is the arc centre.
            const addArc = (a0, a1, ccx, ccz) => {
                const SEG   = 22;
                const R     = ts * 0.5;
                const inner = R - totalW / 2;
                const outer = R + totalW / 2;
                const verts = [], uvs = [], idx = [];
                for (let i = 0; i <= SEG; i++) {
                    const ang = a0 + (a1 - a0) * (i / SEG);
                    const ca = Math.cos(ang), sa = Math.sin(ang);
                    const ix = ccx + inner * ca, iz = ccz + inner * sa;
                    const ox = ccx + outer * ca, oz = ccz + outer * sa;
                    verts.push(ix, hAt(ix, iz), iz);
                    verts.push(ox, hAt(ox, oz), oz);
                    const u = (i / SEG) * 3;
                    uvs.push(u, 0, u, 1);
                }
                for (let i = 0; i < SEG; i++) {
                    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
                    // Wound so the ribbon's front face points UP (+y). The straight
                    // slabs get this for free from PlaneGeometry.rotateX(-PI/2); this
                    // manual arc must match, or FrontSide culling hides it from above
                    // and only the dashed lane lines draw (the "curves not drawing" bug).
                    idx.push(a, c, b, b, c, d);
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
                geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
                geo.setIndex(idx);
                geo.computeVertexNormals();
                const m = new THREE.Mesh(geo, asphaltMat);
                m.receiveShadow = true;
                grp.add(m);

                // Curved dashed lane lines following the two lane radii.
                const dashLen = 18, dashGap = 10, dashW = 1.2, cycle = dashLen + dashGap;
                const dGeo = new THREE.PlaneGeometry(dashLen, dashW).rotateX(-Math.PI / 2);
                const mat = new THREE.Matrix4(), q = new THREE.Quaternion();
                const up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
                for (const laneR of [R - laneOff, R + laneOff]) {
                    const count = Math.floor(Math.abs(a1 - a0) * laneR / cycle);
                    if (count <= 0) continue;
                    const inst = new THREE.InstancedMesh(dGeo, markMat, count);
                    inst.receiveShadow = true;
                    for (let i = 0; i < count; i++) {
                        const ang = a0 + (a1 - a0) * ((i + 0.5) / count);
                        const dx = ccx + laneR * Math.cos(ang), dz = ccz + laneR * Math.sin(ang);
                        pos.set(dx, hAt(dx, dz) + ROAD_MARK_LIFT, dz);
                        // Align each dash with the curve tangent.
                        q.setFromAxisAngle(up, Math.atan2(-Math.cos(ang), -Math.sin(ang)));
                        mat.compose(pos, q, one);
                        inst.setMatrixAt(i, mat);
                    }
                    grp.add(inst);
                }
            };

            // --- Road component builders: single solid slab per component ---
            const addNS = () => {
                addSlab(totalW, ts, 0, 0);
                addSegmentDashes(false, 0, 0, ts);
            };

            const addEW = () => {
                addSlab(ts, totalW, 0, 0);
                addSegmentDashes(true, 0, 0, ts);
            };

            const addCenter = () => {
                addSlab(totalW, totalW, 0, 0);
            };

            const addLegN = () => {
                addSlab(totalW, legLen, 0, -legCenter);
                addSegmentDashes(false, 0, -legCenter, legLen);
            };

            const addLegS = () => {
                addSlab(totalW, legLen, 0, legCenter);
                addSegmentDashes(false, 0, legCenter, legLen);
            };

            const addLegE = () => {
                addSlab(legLen, totalW, legCenter, 0);
                addSegmentDashes(true, legCenter, 0, legLen);
            };

            const addLegW = () => {
                addSlab(legLen, totalW, -legCenter, 0);
                addSegmentDashes(true, -legCenter, 0, legLen);
            };

            if (dir === 'vertical') {
                addNS();
            } else if (dir === 'horizontal') {
                addEW();
            } else if (dir === 'cross') {
                addCenter(); addLegN(); addLegS(); addLegE(); addLegW();
            } else if (dir === 't-up' || dir === 't-north') {
                addCenter(); addLegW(); addLegE(); addLegN();
            } else if (dir === 't-down' || dir === 't-south') {
                addCenter(); addLegW(); addLegE(); addLegS();
            } else if (dir === 't-left' || dir === 't-west') {
                addCenter(); addLegN(); addLegS(); addLegW();
            } else if (dir === 't-right' || dir === 't-east') {
                addCenter(); addLegN(); addLegS(); addLegE();
            } else if (dir === 'corner-up-left' || dir === 'corner-north-west') {
                addArc(0, Math.PI / 2, -ts / 2, -ts / 2);          // N ↔ W
            } else if (dir === 'corner-up-right' || dir === 'corner-north-east') {
                addArc(Math.PI / 2, Math.PI, ts / 2, -ts / 2);     // N ↔ E
            } else if (dir === 'corner-down-left' || dir === 'corner-south-west') {
                addArc(-Math.PI / 2, 0, -ts / 2, ts / 2);          // S ↔ W
            } else if (dir === 'corner-down-right' || dir === 'corner-south-east') {
                addArc(Math.PI, 1.5 * Math.PI, ts / 2, ts / 2);    // S ↔ E
            } else {
                if (dir.includes('t-') || dir.includes('corner-') || dir.includes('cross')) {
                     addCenter(); addLegN(); addLegS(); addLegE(); addLegW();
                } else {
                     addEW();
                }
            }
        }

        _getPoleMat() {
            if (!this._poleMat) {
                this._poleMat = new THREE.MeshLambertMaterial({ color: 0x6a6a70, map: loadTex('brown_grey_slate.jpg', 1) });
            }
            return this._poleMat;
        }

        _getLampMat() {
            if (!this._lampMat) {
                // Emissive lamp head so the streetlights read as "lit" day or night
                // without the cost of a real light per pole.
                this._lampMat = new THREE.MeshLambertMaterial({
                    color: 0xfff2c0,
                    emissive: 0xffd27a,
                    emissiveIntensity: 1.0
                });
            }
            return this._lampMat;
        }

        // Lines streetlights along a road tile's shoulders, oriented to the road
        // direction so the lamp arms overhang the asphalt. Built as three
        // InstancedMeshes per chunk (pole / arm / emissive head) instead of a
        // Group-of-meshes per pole, collapsing a dozen draw calls down to three.
        // Geometry is per-chunk (disposed on chunk removal); materials shared.
        _buildStreetlights(grp, wx, wy) {
            const ts   = this._ts;
            const dir  = getRoadDirectionAt(wx, wy);
            const sh   = ROAD_TOTAL_W / 2 + 12;   // shoulder offset: just off the asphalt edge
            const along = [-ts * 0.26, ts * 0.26];
            const HALF = Math.PI / 2;

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
                // Intersections / curves: one inward-facing light per side.
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
            // Streetlights no longer cast shadows (kept off the shadow pass).

            const m = new THREE.Matrix4();
            const q = new THREE.Quaternion();
            const up = new THREE.Vector3(0, 1, 0);
            const pos = new THREE.Vector3();
            const one = new THREE.Vector3(1, 1, 1);
            places.forEach((p, i) => {
                q.setFromAxisAngle(up, p.rot);
                // Planted on the (sunk) verge next to the asphalt, sunk a touch
                // further so no pole ever hovers over a sloped shoulder.
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

        // NOTE: the terrain is never displaced any more. Speed used to swirl every
        // loaded chunk's vertices around the camper, which folded the WHOLE visible
        // world (and cost a full vertex rewrite of every chunk, every frame). The
        // effect is now a screen-space lens confined to the camper, see SpeedWarpFx.

        dispose() {
            for (const [, grp] of this._chunks) {
                this._scene.remove(grp);
                grp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            }
            this._chunks.clear();
            for (const mat of this._matCache.values()) mat.dispose();
            this._matCache.clear();
            if (this._vertexMat)   this._vertexMat.dispose();
            if (this._mountainMat) this._mountainMat.dispose();
            if (this._asphaltMat)  this._asphaltMat.dispose();
            if (this._waterMat)  this._waterMat.dispose();
            if (this._markMat)   this._markMat.dispose();
            if (this._poleMat)   this._poleMat.dispose();
            if (this._lampMat)   this._lampMat.dispose();
            this._decorator.dispose();
        }
    }

    // =========================================================================
    // FirstPersonController (Inside Camper)
    // =========================================================================
    class FirstPersonController {
        constructor(camera, bounds) {
            this.camera = camera;
            this.bounds = bounds;
            this.camera.position.set(0, 0, 0);
            this.camera.rotation.set(0, 0, 0);
            this.yaw   = new THREE.Group();
            this.pitch = new THREE.Group();
            this.yaw.position.set(0, 6, 0);    // standing eye height inside the cabin
            // Camera looks down its own -Z; rotate the rig so first person faces
            // the camper's forward (+Z) through the windshield by default.
            this.yaw.rotation.y = Math.PI;
            this.yaw.add(this.pitch);
            this.pitch.add(this.camera);

            this.move     = { forward: false, backward: false, left: false, right: false, sprint: false };
            this.velocity = new THREE.Vector3();
            this.direction = new THREE.Vector3();
            this.isLocked = false;
            this.deactivated = false;
            // Seated at the wheel (first-person driving): mouse-look only, the
            // movement keys drive the camper rather than walking the cabin.
            this.drivingSeat = false;

            // Local co-op support. allowPointerLock lets the scene hand the mouse
            // to a single controller (Player 2) while the driver (Player 1) steers
            // with the keyboard / gamepad. inputSource, when set, overrides the
            // default WASD + arrow reads so a second rig can be fed Player 2 input.
            this.allowPointerLock = true;
            this.inputSource = null;   // () => {forward,back,left,right,sprint}

            // On-foot world mode: detached from the camper, free to roam with no
            // distance limit, with terrain following, sprint and jump.
            this.worldMode = false;
            this.anchor    = { x: 0, z: 0 };   // parked camper position (solid-body centre)
            this.getGroundY = null;            // (worldX, worldZ) => terrain Y
            this.vy        = 0;                // vertical velocity (jump / gravity)
            this.onGround  = true;
            this._jumpQueued = false;

            this._onMouseMove        = this._onMouseMove.bind(this);
            this._onClick            = this._onClick.bind(this);
            this._onKeyDown          = this._onKeyDown.bind(this);
            this._onKeyUp            = this._onKeyUp.bind(this);
            this._onPointerLockChange = this._onPointerLockChange.bind(this);
            this._initEvents();
        }

        _initEvents() {
            document.addEventListener('mousemove',        this._onMouseMove);
            document.addEventListener('click',            this._onClick);
            document.addEventListener('keydown',          this._onKeyDown);
            document.addEventListener('keyup',            this._onKeyUp);
            document.addEventListener('pointerlockchange', this._onPointerLockChange);
        }

        _onMouseMove(e) {
            if (!this.isLocked) return;
            const mx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
            const my = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
            this.yaw.rotation.y   -= mx * 0.002;
            this.pitch.rotation.x -= my * 0.002;
            this.pitch.rotation.x  = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch.rotation.x));
        }

        _onClick() {
            if (!this.allowPointerLock) return;
            if (CamperDrivingSystem.isActive() && !this.isLocked) {
                document.body.requestPointerLock();
            }
        }

        _onPointerLockChange() {
            this.isLocked = document.pointerLockElement === document.body;
        }

        _onKeyDown(e) {
            if (!CamperDrivingSystem.isActive()) return;
            switch (e.code) {
                case 'KeyW': this.move.forward   = true; break;
                case 'KeyA': this.move.left      = true; break;
                case 'KeyS': this.move.backward  = true; break;
                case 'KeyD': this.move.right     = true; break;
                case 'ShiftLeft': case 'ShiftRight': this.move.sprint = true; break;
                case 'Space': if (this.worldMode) { this._jumpQueued = true; e.preventDefault(); } break;
            }
        }

        _onKeyUp(e) {
            if (!CamperDrivingSystem.isActive()) return;
            switch (e.code) {
                case 'KeyW': this.move.forward   = false; break;
                case 'KeyA': this.move.left      = false; break;
                case 'KeyS': this.move.backward  = false; break;
                case 'KeyD': this.move.right     = false; break;
                case 'ShiftLeft': case 'ShiftRight': this.move.sprint = false; break;
            }
        }

        // Enter / leave on-foot world mode. anchor is the parked camper position
        // (with its heading angle, for the solid-body capsule); groundFn maps
        // world (x,z) to terrain height. Caller handles reparenting the rig
        // between the camper group and the scene.
        setWorldMode(on, anchor, groundFn) {
            this.worldMode = !!on;
            this.vy = 0;
            this.onGround = true;
            if (on) {
                if (anchor) this.anchor = { x: anchor.x, z: anchor.z };
                this.anchorAngle = (anchor && anchor.angle) || 0;
                this.getGroundY = groundFn || null;
            }
        }

        requestJump() { if (this.worldMode) this._jumpQueued = true; }

        // Toggle the seated driving pose. While seated the rig stays put (the eye
        // is parked at the driver's seat) and mouse / right-stick look still work.
        setDriving(on) { this.drivingSeat = !!on; }

        update(delta) {
            if (this.deactivated) return;
            if (this.drivingSeat) return;   // seated at the wheel: look only
            // Merge raw WASD (key events above) with arrow keys / d-pad via the
            // Input API, so movement works on keyboard and controller alike.
            const fwd   = this.move.forward  || Input.isPressed('up');
            const back  = this.move.backward || Input.isPressed('down');
            const left  = this.move.left     || Input.isPressed('left');
            const right = this.move.right    || Input.isPressed('right');
            const sprint = this.move.sprint || Input.isPressed('shift');

            this.direction.z = Number(fwd)   - Number(back);
            this.direction.x = Number(right) - Number(left);
            if (this.direction.lengthSq() > 0) this.direction.normalize();

            if (this.worldMode) {
                this._updateOnFoot(delta, sprint);
            } else {
                this._updateInCabin(delta);
            }
        }

        _updateInCabin(delta) {
            // Eased direct-velocity walk around the cabin, clamped to the interior
            // box. (The old scheme accelerated by speed*delta and then integrated
            // by delta again, which crawled at a fraction of the intended speed
            // and was frame-rate dependent.)
            const k = Math.min(1, delta * 10);
            this.velocity.x += (this.direction.x * FOOT_CABIN_WALK - this.velocity.x) * k;
            this.velocity.z += (this.direction.z * FOOT_CABIN_WALK - this.velocity.z) * k;
            this.yaw.translateX(this.velocity.x * delta);
            this.yaw.translateZ(-this.velocity.z * delta);
            this.yaw.position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.yaw.position.x));
            this.yaw.position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.yaw.position.z));
            this.yaw.position.y = 6;
        }

        _updateOnFoot(delta, sprint) {
            // Eased walk (optionally sprinting) in the look direction: velocity
            // ramps in and out instead of starting / stopping instantly.
            const spd = FOOT_WALK * (sprint ? FOOT_SPRINT_MULT : 1);
            const k = Math.min(1, delta * 8);
            this.velocity.x += (this.direction.x * spd - this.velocity.x) * k;
            this.velocity.z += (this.direction.z * spd - this.velocity.z) * k;
            this.yaw.translateX(this.velocity.x * delta);
            this.yaw.translateZ(-this.velocity.z * delta);

            // Solid camper: push the walker out of a capsule around the parked
            // chassis so it can be circled but never walked through.
            const fx = Math.sin(this.anchorAngle || 0), fz = Math.cos(this.anchorAngle || 0);
            const px = this.yaw.position.x - this.anchor.x;
            const pz = this.yaw.position.z - this.anchor.z;
            const along = Math.max(-FOOT_VAN_HALF_LEN, Math.min(FOOT_VAN_HALF_LEN, px * fx + pz * fz));
            const ccx = this.anchor.x + fx * along;
            const ccz = this.anchor.z + fz * along;
            const ox = this.yaw.position.x - ccx;
            const oz = this.yaw.position.z - ccz;
            const od = Math.hypot(ox, oz);
            if (od < FOOT_VAN_RADIUS) {
                const f = FOOT_VAN_RADIUS / (od || 1);
                this.yaw.position.x = ccx + ox * f;
                this.yaw.position.z = ccz + oz * f;
            }

            // Gravity + jump, with the ground sampled from the terrain.
            const groundY = (this.getGroundY ? this.getGroundY(this.yaw.position.x, this.yaw.position.z) : 0) + FOOT_EYE;
            if (this._jumpQueued) {
                this._jumpQueued = false;
                if (this.onGround) { this.vy = FOOT_JUMP_VEL; this.onGround = false; }
            }
            this.vy -= FOOT_GRAVITY * delta;
            this.yaw.position.y += this.vy * delta;
            if (this.yaw.position.y <= groundY) {
                this.yaw.position.y = groundY;
                this.vy = 0;
                this.onGround = true;
            } else {
                this.onGround = false;
            }
        }

        getRig() { return this.yaw; }

        dispose() {
            document.removeEventListener('mousemove',        this._onMouseMove);
            document.removeEventListener('click',            this._onClick);
            document.removeEventListener('keydown',          this._onKeyDown);
            document.removeEventListener('keyup',            this._onKeyUp);
            document.removeEventListener('pointerlockchange', this._onPointerLockChange);
            if (document.pointerLockElement === document.body) {
                document.exitPointerLock();
            }
        }
    }

    // =========================================================================
    // VanModel
    // =========================================================================
    // Minimal box camper used only if the CamperModel submodule failed to load,
    // so the scene never hard-crashes. Mirrors the CamperModel public API.
    class FallbackCamper {
        constructor(scene) {
            this._scene = scene;
            this.group = new THREE.Group();
            this._body = new THREE.Group();
            this.group.add(this._body);
            scene.add(this.group);
            this.seats = [{ name: 'Driver', pos: new THREE.Vector3(-10, 30, 28) }];  // i18n-ignore  seat id, matched below
            const shell = new THREE.Mesh(new THREE.BoxGeometry(42, 34, 92), new THREE.MeshLambertMaterial({ color: 0xe2e2e2 }));
            shell.position.y = 30; shell.castShadow = shell.receiveShadow = true;
            this._body.add(shell);
            this._wheels = [];
            const tg = new THREE.CylinderGeometry(8, 8, 6, 12).rotateZ(Math.PI / 2);
            const tm = new THREE.MeshLambertMaterial({ color: 0x18181c });
            for (const [x, z] of [[21, 30], [-21, 30], [21, -30], [-21, -30]]) {
                const w = new THREE.Mesh(tg, tm); w.position.set(x, 8, z); w.castShadow = true;
                this.group.add(w); this._wheels.push(w);
            }
        }
        applyMotion(speedUnits, steer, delta) {
            const spin = (speedUnits * delta) / 8;
            for (const w of this._wheels) w.rotation.x += spin;
        }
        setEnv() {}
        update() {}
        toggleDoor() {}
        setDoorOpen() {}
        isDoorOpen() { return false; }
        getInteractables() { return []; }
        getDoorWorldPosition() { return null; }
        dispose() { this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this._scene.remove(this.group); }
    }

    // Adapter: the camper is now built by the CamperModel submodule (fully
    // procedural, modular, with interior / doors / seats / upgrade modules).
    // This thin wrapper keeps the scene's call sites stable and degrades to
    // FallbackCamper if the submodule is absent.
    class VanModel {
        constructor(scene) {
            const Factory = (window.HypernetCamper && window.HypernetCamper.CamperModel) || null;
            if (Factory) {
                this._impl = new Factory(scene);
            } else {
                console.warn('[CamperDriving] CamperModel submodule not found; using fallback camper.');
                this._impl = new FallbackCamper(scene);
            }
            this.group = this._impl.group;
        }
        applyMotion(s, st, dt, roll, pitch, bounce) { this._impl.applyMotion(s, st, dt, roll, pitch, bounce); }
        updateDash(kmh, rpm01, fuel01, brakeOn) {
            if (this._impl.updateDash) this._impl.updateDash(kmh, rpm01, fuel01, brakeOn);
        }
        setEnv(env)        { if (this._impl.setEnv) this._impl.setEnv(env); }
        getEnv()           { return this._impl.getEnv ? this._impl.getEnv() : 'road'; }
        update(dt)         { if (this._impl.update) this._impl.update(dt); }
        toggleDoor(which)  { if (this._impl.toggleDoor) this._impl.toggleDoor(which); }
        setDoorOpen(open)  { if (this._impl.setDoorOpen) this._impl.setDoorOpen(open); }
        isDoorOpen()       { return this._impl.isDoorOpen ? this._impl.isDoorOpen() : false; }
        getInteractables() { return this._impl.getInteractables ? this._impl.getInteractables() : []; }
        getDoorWorldPosition(target) {
            return this._impl.getDoorWorldPosition ? this._impl.getDoorWorldPosition(target) : null;
        }
        get seats()        { return this._impl.seats || []; }
        dispose()          { this._impl.dispose(); }
    }

    // =========================================================================
    // CamperHUD
    // =========================================================================
    class CamperHUD {
        // `silent` builds no HUD at all (title-screen background drive): every
        // panel is skipped and the per-frame updates become no-ops.
        constructor(overlay, destinationName, totalKm, silent) {
            this._destination = destinationName;
            this._totalKm     = totalKm;
            this._autoDrive   = true;
            this._silent      = !!silent;
            this._el          = null;
            if (this._silent) return;
            // Minimap view modes cycled with [M], mirroring WorldMap.js on map 315:
            // 'full' = whole world overview, 'zoom' = close window around the
            // vehicle, 'hidden' = panel off. Defaults to 'zoom' (the close view,
            // where the oriented player arrow is legible) rather than the overview.
            this._mapModes    = ['full', 'zoom', 'hidden'];
            this._mapMode     = 'zoom';
            this._build(overlay);
        }

        // Advance to the next minimap view mode ([M] key). Returns the new mode so
        // the caller can surface a label / sound if desired.
        cycleMapMode() {
            const i = this._mapModes.indexOf(this._mapMode);
            this._mapMode = this._mapModes[(i + 1) % this._mapModes.length];
            return this._mapMode;
        }

        _build(overlay) {
            const hud = document.createElement('div');
            hud.id = 'camper-drive-hud';
            hud.style.cssText = `
                position:absolute; top:0; left:0; width:100%; height:100%;
                pointer-events:none; font-family:'Lora',serif; z-index:1;
                box-sizing:border-box;
            `;

            const panel = (html, style) => {
                const d = document.createElement('div');
                d.style.cssText = `
                    position:absolute; background:rgba(10,6,3,0.72);
                    border:2px solid rgba(139,90,43,0.55); border-radius:6px;
                    padding:10px 14px; color:#ecdcb9; font-size:14px;
                    line-height:1.5; ${style}
                `;
                d.innerHTML = html;
                return d;
            };

            this._fuelPanel = panel(`
                <div style="font-size:11px;font-weight:bold;color:#a1680d;letter-spacing:1px;margin-bottom:4px;">${T('CamperDrive.hud.fuel')}</div>
                <div id="cds-fuel-bar-wrap" style="width:160px;height:10px;background:rgba(255,255,255,0.1);border-radius:5px;overflow:hidden;margin-bottom:4px;">
                  <div id="cds-fuel-bar" style="height:100%;width:80%;background:#4caf50;border-radius:5px;transition:width 0.5s,background 0.5s;"></div>
                </div>
                <div id="cds-fuel-text" style="font-size:12px;color:#ecdcb9;">-- L / 100 L</div>
            `, 'top:16px;left:16px;min-width:200px;');

            // Top-right minimap mirroring the 2D world map (map 315). The camper
            // dot tracks the live 3D world position so 2D and 3D stay in sync.
            const MINI_W = 220, MINI_H = 160;
            this._miniW = MINI_W;
            this._miniH = MINI_H;
            this._miniPanel = panel(`
                <div style="font-size:11px;font-weight:bold;color:#a1680d;letter-spacing:1px;margin-bottom:4px;">${T('CamperDrive.hud.map')}</div>
                <canvas id="cds-minimap" width="${MINI_W}" height="${MINI_H}" style="display:block;width:${MINI_W}px;height:${MINI_H}px;border:1px solid rgba(139,90,43,0.45);border-radius:3px;"></canvas>
                <div id="cds-map-coords" style="font-size:12px;color:#ecdcb9;text-align:right;margin-top:4px;">0, 0</div>
            `, 'top:16px;right:16px;');

            this._mapImgReady = false;
            this._mapImg = new Image();
            this._mapImg.onload = () => { this._mapImgReady = true; };
            this._mapImg.src = 'img/pictures/worldmap.png';

            this._journeyPanel = panel(`
                <div id="cds-dest-name" style="font-size:18px;font-weight:bold;color:#ffe8b0;text-align:center;margin-bottom:4px;">${this._destination || T('CamperDrive.hud.destination')}</div>
                <div style="display:flex;justify-content:space-around;gap:20px;">
                    <div style="text-align:center;">
                        <div style="font-size:10px;color:#a1680d;letter-spacing:1px;">${T('CamperDrive.hud.time')}</div>
                        <div id="cds-time-text" style="font-size:16px;color:#ecdcb9;">--:--</div>
                    </div>
                    <div style="text-align:center;">
                        <div style="font-size:10px;color:#a1680d;letter-spacing:1px;">${T('CamperDrive.hud.distance')}</div>
                        <div id="cds-dist-text" style="font-size:16px;color:#ecdcb9;">-- km</div>
                    </div>
                </div>
            `, 'bottom:20px;left:50%;transform:translateX(-50%);min-width:260px;text-align:center;');

            this._modePanel = document.createElement('div');
            this._modePanel.style.cssText = `
                position:absolute; bottom:20px; left:16px;
                background:rgba(10,6,3,0.72); border:2px solid rgba(139,90,43,0.55);
                border-radius:6px; padding:10px 14px; color:#ecdcb9;
                font-family:'Lora',serif; font-size:13px; pointer-events:auto;
                cursor:pointer;
            `;
            // A short, stacked list of only the commands a player needs at a
            // glance (not every key the scene answers to): each row is a key
            // badge plus a short label, one per line, easier to scan than the
            // old run-on paragraph.
            const CMD_ROWS = [
                ['WASD', T('CamperDrive.hud.cmdDrive')],
                ['SHIFT', T('CamperDrive.hud.cmdTurbo')],
                ['E', T('CamperDrive.hud.cmdDoor')],
                ['TAB', T('CamperDrive.hud.cmdView')],
                ['ESC', T('CamperDrive.hud.cmdExit')]
            ];
            const cmdRowHTML = ([key, label]) => `
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="min-width:36px;text-align:center;background:rgba(139,90,43,0.35);
                        border:1px solid rgba(161,104,13,0.8);border-radius:4px;padding:2px 6px;
                        font-size:11px;font-weight:bold;color:#ffe8b0;letter-spacing:0.5px;">${key}</span>
                    <span style="font-size:12px;color:#ecdcb9;">${label}</span>
                </div>`;
            this._modePanel.innerHTML = `
                <div id="cds-mode-btn">${T('CamperDrive.hud.view')} <span id="cds-mode-label" style="color:#4caf50;">${T('CamperDrive.viewMode.fpdrive')}</span> [TAB]</div>
                <div style="margin-top:4px;">${T('CamperDrive.hud.mode')} <span id="cds-env-label" style="color:#7fd0ff;">${T('CamperDrive.envMode.road')}</span></div>
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;">
                    ${CMD_ROWS.map(cmdRowHTML).join('')}
                </div>
                <div id="cds-controller-hint" style="margin-top:8px;font-size:11px;color:#7fd0ff;line-height:1.45;display:none;">
                    ${T('CamperDrive.hud.controllerHint')}
                </div>`;
            this._modePanel.onclick = () => {
                if (window.CamperDrivingSystem && CamperDrivingSystem._scene) {
                    CamperDrivingSystem._scene._cycleViewMode();
                }
            };

            this._speedPanel = panel(`
                <div id="cds-speed-text" style="font-size:22px;font-weight:bold;color:#ecdcb9;text-align:center;">0 km/h</div>
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:2px;">
                    <span id="cds-gear-text" style="font-size:13px;font-weight:bold;color:#a1680d;min-width:14px;">N</span>
                    <span style="display:inline-block;width:70px;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                        <span id="cds-rpm-bar" style="display:block;height:100%;width:10%;background:#e8c840;"></span>
                    </span>
                </div>`,
                'top:16px;left:50%;transform:translateX(-50%);min-width:130px;text-align:center;'
            );

            // Status strip under the speedo: ability chips (Fly / Float / Dive,
            // dim when locked, lit when unlocked, highlighted when active) plus the
            // vehicle condition and a live trip odometer.
            this._statusPanel = panel(`
                <div style="display:flex;gap:9px;justify-content:center;align-items:center;font-size:11px;font-weight:bold;letter-spacing:0.5px;">
                    <span id="cds-ab-fly">${T('CamperDrive.hud.fly')}</span>
                    <span id="cds-ab-float">${T('CamperDrive.hud.float')}</span>
                    <span id="cds-ab-dive">${T('CamperDrive.hud.dive')}</span>
                </div>
                <div id="cds-status-meta" style="display:flex;gap:14px;justify-content:center;margin-top:5px;font-size:11px;color:#a1680d;">
                    <span id="cds-cond-wrap">${T('CamperDrive.hud.cond')} <span id="cds-cond" style="color:#4caf50;">--</span></span>
                    <span>${T('CamperDrive.hud.trip')} <span id="cds-trip" style="color:#ecdcb9;">0.0 km</span></span>
                </div>
            `, 'top:88px;left:50%;transform:translateX(-50%);min-width:150px;text-align:center;');

            // Respawn prompt: shown centred when the camper is stuck (in water
            // without float/dive/fly, flipped, or wedged). Hidden by default.
            this._respawnHint = document.createElement('div');
            this._respawnHint.style.cssText = `
                position:absolute; top:38%; left:50%; transform:translate(-50%,-50%);
                background:rgba(60,10,6,0.82); border:2px solid rgba(230,90,60,0.8);
                border-radius:8px; padding:14px 22px; color:#ffd9c8;
                font-family:'Lora',serif; text-align:center; display:none; z-index:3;
            `;
            this._respawnHint.innerHTML = `
                <div id="cds-respawn-reason" style="font-size:16px;color:#ffb3a0;margin-bottom:6px;">${T('CamperDrive.hud.camperStuck')}</div>
                <div style="font-size:20px;font-weight:bold;color:#ffe8b0;">${T('CamperDrive.hud.pressRToRespawn', { key: '<span style="color:#ff7a55;">R</span>' })}</div>`;

            hud.appendChild(this._fuelPanel);
            hud.appendChild(this._miniPanel);
            hud.appendChild(this._journeyPanel);
            hud.appendChild(this._modePanel);
            hud.appendChild(this._speedPanel);
            hud.appendChild(this._statusPanel);
            hud.appendChild(this._respawnHint);
            overlay.appendChild(hud);
            this._el = hud;

            // Cache HUD element refs once so the per-frame update() avoids
            // ~10 getElementById lookups every rAF frame.
            this._els = {
                fuelBar:  document.getElementById('cds-fuel-bar'),
                fuelTxt:  document.getElementById('cds-fuel-text'),
                timeEl:   document.getElementById('cds-time-text'),
                distEl:   document.getElementById('cds-dist-text'),
                speedEl:  document.getElementById('cds-speed-text'),
                gearEl:   document.getElementById('cds-gear-text'),
                rpmEl:    document.getElementById('cds-rpm-bar'),
                abFly:    document.getElementById('cds-ab-fly'),
                abFloat:  document.getElementById('cds-ab-float'),
                abDive:   document.getElementById('cds-ab-dive'),
                controllerHint: document.getElementById('cds-controller-hint'),
                condWrap: document.getElementById('cds-cond-wrap'),
                condEl:   document.getElementById('cds-cond'),
                tripEl:   document.getElementById('cds-trip'),
            };
            // Last-written values for dirty-checking (avoid redundant DOM writes).
            this._last = {};
        }

        // Toggle the "Press R to respawn" prompt. `reason` labels why the camper
        // is stuck (in water / flipped / wedged).
        setRespawnHint(show, reason) {
            if (!this._respawnHint) return;
            this._respawnHint.style.display = show ? 'block' : 'none';
            if (show && reason) {
                const r = document.getElementById('cds-respawn-reason');
                if (r) r.textContent = reason;
            }
        }

        updateModeLabel(mode) {
            const el = document.getElementById('cds-mode-label');
            if (!el) return;
            const key = 'CamperDrive.viewMode.' + mode;
            el.textContent = T.has(key) ? T(key) : mode.toUpperCase();
        }

        updateEnvLabel(env) {
            const el = document.getElementById('cds-env-label');
            if (!el) return;
            const colors = { road: '#7fd0ff', air: '#b388ff', water: '#4dd0e1', underwater: '#26a69a' };
            const key = 'CamperDrive.envMode.' + env;
            el.textContent = T.has(key) ? T(key) : env.toUpperCase();
            el.style.color = colors[env] || '#7fd0ff';
        }

        // Only show the L2/R2 zoom + Y switch-view hint while a gamepad is
        // actually connected; dirty-checked so this is a no-op most frames.
        updateControllerHint(connected) {
            const el = (this._els || {}).controllerHint;
            if (!el) return;
            if (this._last.controllerHint === connected) return;
            this._last.controllerHint = connected;
            el.style.display = connected ? 'block' : 'none';
        }

        // Ability chips. `abilities` = { fly:{unlocked,active}, float:{...}, dive:{...} }.
        // Locked = dim grey, unlocked = amber, active = bright green.
        updateAbilities(abilities) {
            const els  = this._els || {};
            const last = this._last || (this._last = {});
            const paint = (el, key, ab) => {
                if (!el || !ab) return;
                const state = !ab.unlocked ? 'locked' : ab.active ? 'active' : 'ready';
                if (last[key] === state) return;
                last[key] = state;
                if (state === 'locked') { el.style.color = '#6b5a44'; el.style.opacity = '0.4'; }
                else if (state === 'active') { el.style.color = '#5fe08a'; el.style.opacity = '1'; }
                else { el.style.color = '#e8c840'; el.style.opacity = '1'; }
            };
            paint(els.abFly,   'abFly',   abilities.fly);
            paint(els.abFloat, 'abFloat', abilities.float);
            paint(els.abDive,  'abDive',  abilities.dive);
        }

        // Vehicle condition % (null hides the chip when the repair plugin is
        // absent) and the live trip odometer in km.
        updateStatus(condPct, tripKm) {
            const els  = this._els || {};
            const last = this._last || (this._last = {});
            if (els.condWrap) {
                const show = condPct != null;
                const disp = show ? '' : 'none';
                if (disp !== last.condDisp) { els.condWrap.style.display = disp; last.condDisp = disp; }
                if (show && els.condEl) {
                    const pct = Math.max(0, Math.min(100, Math.round(condPct)));
                    if (pct !== last.condPct) {
                        last.condPct = pct;
                        els.condEl.textContent = pct + '%';
                        els.condEl.style.color = pct > 60 ? '#4caf50' : pct > 30 ? '#e8c840' : '#c0392b';
                    }
                }
            }
            if (els.tripEl && tripKm != null) {
                const t = tripKm.toFixed(1) + ' km';
                if (t !== last.tripTxt) { els.tripEl.textContent = t; last.tripTxt = t; }
            }
        }

        update(vanX, vanZ, speedKmh, gearLabel, rpm01, heading) {
            if (this._silent) return;
            this._heading = heading || 0;
            const els  = this._els || {};
            const last = this._last || (this._last = {});
            const maxFuel = camperMaxFuel();
            const fuel    = camperFuelGet();
            const fuelPct = Math.max(0, Math.min(100, (fuel / maxFuel) * 100));
            if (els.fuelBar) {
                const w = fuelPct + '%';
                if (w !== last.fuelW) { els.fuelBar.style.width = w; last.fuelW = w; }
                const bg = fuelPct > 50 ? '#4caf50' : fuelPct > 20 ? '#e8c840' : '#c0392b';
                if (bg !== last.fuelBg) { els.fuelBar.style.background = bg; last.fuelBg = bg; }
            }
            if (els.fuelTxt) {
                const t = fuel <= 0 ? 'OUT OF FUEL' : `${fuel.toFixed(1)} L / ${maxFuel} L`;
                if (t !== last.fuelTxt) { els.fuelTxt.textContent = t; last.fuelTxt = t; }
            }

            const data      = (typeof $gameSystem !== 'undefined') ? $gameSystem.getFastTravelData() : null;
            const remaining = data ? data.timerRemainingTime : 0;
            const duration  = data ? data.timerDuration : 1;
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            if (els.timeEl) {
                const t = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
                if (t !== last.timeTxt) { els.timeEl.textContent = t; last.timeTxt = t; }
            }
            const progress = duration > 0 ? (duration - remaining) / duration : 0;
            const remKm    = Math.max(0, Math.round(this._totalKm * (1 - progress)));
            if (els.distEl) {
                const t = `${remKm} km`;
                if (t !== last.distTxt) { els.distEl.textContent = t; last.distTxt = t; }
            }

            const kmh       = Math.round(typeof speedKmh === 'number' ? speedKmh : 0);
            if (els.speedEl) {
                const t = `${kmh} km/h`;
                if (t !== last.speedTxt) { els.speedEl.textContent = t; last.speedTxt = t; }
            }
            if (els.gearEl && gearLabel != null) {
                if (gearLabel !== last.gearTxt) { els.gearEl.textContent = gearLabel; last.gearTxt = gearLabel; }
            }
            if (els.rpmEl && rpm01 != null) {
                const w = Math.round(Math.max(4, Math.min(100, rpm01 * 100))) + '%';
                if (w !== last.rpmW) { els.rpmEl.style.width = w; last.rpmW = w; }
                const bg = rpm01 > 0.85 ? '#c0392b' : '#e8c840';
                if (bg !== last.rpmBg) { els.rpmEl.style.background = bg; last.rpmBg = bg; }
            }

            // The minimap canvas does not need a full 60fps redraw; every 3rd
            // frame is smooth enough and saves a clear + drawImage each frame.
            this._miniTick = (this._miniTick || 0) + 1;
            if (this._miniTick % 3 === 0) this._drawMiniMap(vanX, vanZ);
        }

        // Renders the world map (map 315) with the camper at its live world tile,
        // keeping the 2D minimap and the 3D scene synchronized.
        _drawMiniMap(vanX, vanZ) {
            // 'hidden' mode: collapse the whole map panel until cycled back on.
            if (this._mapMode === 'hidden') {
                if (this._miniPanel) this._miniPanel.style.display = 'none';
                return;
            }
            if (this._miniPanel) this._miniPanel.style.display = '';

            const cv = document.getElementById('cds-minimap');
            if (!cv) return;
            const ctx = cv.getContext('2d');
            const w = this._miniW, h = this._miniH;

            // 3D world position -> world tile coordinates (0..255).
            const wx = vanX / WORLD_TILE_SIZE;
            const wy = vanZ / WORLD_TILE_SIZE;

            // 'zoom' crops a window around the vehicle; 'full' shows the whole map.
            // srcX/srcY/srcSpan are in world tiles (0..256); toPx/toPy convert a
            // world tile coord into a canvas pixel for the markers below.
            const zoomTiles = 64;
            let srcX = 0, srcY = 0, srcSpan = 256;
            if (this._mapMode === 'zoom') {
                srcSpan = zoomTiles;
                srcX = Math.max(0, Math.min(256 - zoomTiles, wx - zoomTiles / 2));
                srcY = Math.max(0, Math.min(256 - zoomTiles, wy - zoomTiles / 2));
            }
            const toPx = tx => ((tx - srcX) / srcSpan) * w;
            const toPy = ty => ((ty - srcY) / srcSpan) * h;

            ctx.clearRect(0, 0, w, h);
            if (this._mapImgReady) {
                const img = this._mapImg;
                const sx = (srcX / 256) * img.width;
                const sy = (srcY / 256) * img.height;
                const sw = (srcSpan / 256) * img.width;
                const sh = (srcSpan / 256) * img.height;
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
            } else {
                ctx.fillStyle = '#14304a';
                ctx.fillRect(0, 0, w, h);
            }

            // Destination marker while travelling.
            const data = (typeof $gameSystem !== 'undefined' && $gameSystem.getFastTravelData)
                ? $gameSystem.getFastTravelData() : null;
            const dest = data && data.finalDestination ? data.finalDestination : null;
            if (dest) {
                const dx = toPx(dest.x);
                const dy = toPy(dest.y);
                ctx.fillStyle = '#00e676';
                ctx.fillRect(dx - 3, dy - 3, 6, 6);
            }

            // Camper marker. In 'zoom' mode it is an oriented arrowhead pointing in
            // the camper's heading (forward = (sin, cos) of the drive angle, which
            // maps directly onto the canvas since +x->right, +z->down). In 'full'
            // mode the whole-world scale is too small for orientation to read, so a
            // plain dot is kept.
            const px = Math.max(0, Math.min(w, toPx(wx)));
            const py = Math.max(0, Math.min(h, toPy(wy)));
            if (this._mapMode === 'zoom') {
                const ang = this._heading || 0;
                const fx = Math.sin(ang), fy = Math.cos(ang);   // forward (canvas)
                const rx = -fy,          ry = fx;               // right (perp)
                const tip = 9, back = 6, half = 5;              // arrowhead geometry
                ctx.beginPath();
                ctx.moveTo(px + fx * tip,            py + fy * tip);            // nose
                ctx.lineTo(px - fx * back + rx * half, py - fy * back + ry * half); // right wing
                ctx.lineTo(px - fx * back - rx * half, py - fy * back - ry * half); // left wing
                ctx.closePath();
                ctx.fillStyle = '#ff3b3b';
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(px, py, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#ff3b3b';
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
            }

            const coordEl = document.getElementById('cds-map-coords');
            if (coordEl) coordEl.textContent = `${Math.floor(wx)}, ${Math.floor(wy)}`;
        }

        dispose() {
            if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
        }
    }

    // =========================================================================
    // WeatherParticles, rain and snow particle systems for the 3D scene
    // =========================================================================
    class WeatherParticles {
        constructor(scene) {
            this._scene  = scene;
            this._system = null;
            this._type   = null;
        }

        setWeather(type) { // 'rain' | 'snow' | null
            if (this._type === type) return;
            this._type = type;
            if (this._system) {
                this._system.geometry.dispose();
                this._system.material.dispose();
                this._scene.remove(this._system);
                this._system = null;
            }
            if (!type) return;

            const COUNT = type === 'rain' ? 4000 : 2000;
            const geo   = new THREE.BufferGeometry();
            const pos   = new Float32Array(COUNT * 3);
            for (let i = 0; i < COUNT; i++) {
                pos[i * 3]     = (Math.random() - 0.5) * 1200;
                pos[i * 3 + 1] = Math.random() * 300;
                pos[i * 3 + 2] = (Math.random() - 0.5) * 1200;
            }
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

            const mat = new THREE.PointsMaterial({
                color:       type === 'rain' ? 0xaaaacc : 0xffffff,
                size:        type === 'rain' ? 1.5 : 3.5,
                transparent: true,
                opacity:     type === 'rain' ? 0.55 : 0.75,
                depthWrite:  false
            });
            this._system = new THREE.Points(geo, mat);
            this._scene.add(this._system);
        }

        update(vanX, vanZ, delta) {
            if (!this._system) return;
            const pos   = this._system.geometry.attributes.position;
            const speed = this._type === 'rain' ? 200 : 35;
            const drift = this._type === 'snow' ? 12 : 0;
            const t     = Date.now() * 0.001;
            for (let i = 0; i < pos.count; i++) {
                let py = pos.getY(i) - speed * delta;
                let px = pos.getX(i);
                if (drift > 0) px += Math.sin(t + i * 0.37) * drift * delta;
                if (py < -5) {
                    px = (Math.random() - 0.5) * 1200;
                    py = 300;
                    pos.setZ(i, (Math.random() - 0.5) * 1200);
                }
                pos.setX(i, px);
                pos.setY(i, py);
            }
            pos.needsUpdate = true;
            // Particle system travels with the van
            this._system.position.set(vanX, 0, vanZ);
        }

        dispose() {
            if (this._system) {
                this._system.geometry.dispose();
                this._system.material.dispose();
                this._scene.remove(this._system);
                this._system = null;
            }
        }
    }

    // =========================================================================
    // Upgrade gating. The game can set $gameSystem._camperUpgrades = {fly,float,
    // dive} to lock/unlock modes; absent that, every upgrade is available so the
    // procedural camper is a full toy out of the box.
    // =========================================================================
    // Ability gating is driven by the material-funded upgrade workshop
    // (VehicleSystemRepair.js -> window.VehicleUpgrades). 'fly' needs the Flight
    // module; 'float'/'dive' need the Amphibious module. Both are OFF by default
    // and must be installed at the repair/upgrade workshop. Sandbox/Test unlock
    // everything. If the upgrade plugin is missing, fall back to all-unlocked.
    function camperCan(kind) {
        if (window.VehicleUpgrades && typeof window.VehicleUpgrades.camperCan === 'function') {
            return window.VehicleUpgrades.camperCan(kind);
        }
        return true;
    }


    // Sandbox mode or a party member literally named "Test" unlocks everything.
    function isSandboxOrTest() {
        if (typeof $gameSystem !== 'undefined' && $gameSystem._isSandboxMode) return true;
        const named = (ac) => ac && ac.name && ac.name() && ac.name().toLowerCase() === 'test';
        if (typeof $gameActors !== 'undefined' && named($gameActors.actor(1))) return true;
        if (typeof $gameParty !== 'undefined' && $gameParty.allMembers) {
            return $gameParty.allMembers().some(named);
        }
        return false;
    }

    // =========================================================================
    // UnderwaterFx, a rising bubble field shown only while submerged.
    // =========================================================================
    class UnderwaterFx {
        constructor(scene) {
            this._scene  = scene;
            this._sys    = null;
            this._active = false;
        }

        setActive(on) {
            if (on === this._active) return;
            this._active = on;
            if (on && !this._sys) {
                const COUNT = 600;
                const geo = new THREE.BufferGeometry();
                const pos = new Float32Array(COUNT * 3);
                for (let i = 0; i < COUNT; i++) {
                    pos[i * 3]     = (Math.random() - 0.5) * 800;
                    pos[i * 3 + 1] = Math.random() * 300 - 150;
                    pos[i * 3 + 2] = (Math.random() - 0.5) * 800;
                }
                geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                const mat = new THREE.PointsMaterial({
                    color: 0xbfe8ff, size: 2.4, transparent: true, opacity: 0.5, depthWrite: false
                });
                this._sys = new THREE.Points(geo, mat);
                this._scene.add(this._sys);
            }
            if (this._sys) this._sys.visible = on;
        }

        update(camX, camY, camZ, delta) {
            if (!this._active || !this._sys) return;
            const pos = this._sys.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                let y = pos.getY(i) + 28 * delta;
                if (y > 150) {
                    y = -150;
                    pos.setX(i, (Math.random() - 0.5) * 800);
                    pos.setZ(i, (Math.random() - 0.5) * 800);
                }
                pos.setY(i, y);
            }
            pos.needsUpdate = true;
            this._sys.position.set(camX, camY || 0, camZ);
        }

        dispose() {
            if (this._sys) {
                this._sys.geometry.dispose();
                this._sys.material.dispose();
                this._scene.remove(this._sys);
                this._sys = null;
            }
        }
    }

    // =========================================================================
    // SkyFx, cheap atmosphere dressing: a star dome and moon at night plus a
    // ring of drifting low-poly clouds. Everything follows the camper and is
    // fog-exempt so it reads at any draw distance.
    // =========================================================================
    class SkyFx {
        constructor(scene) {
            this._scene = scene;
            this._group = new THREE.Group();
            scene.add(this._group);

            // --- Stars: fixed dome of screen-space points ---
            const N = 900;
            const pos = new Float32Array(N * 3);
            for (let i = 0; i < N; i++) {
                const az = Math.random() * Math.PI * 2;
                const el = Math.asin(Math.random());
                // Star dome scales with the world so it sits far beyond the (25x
                // taller) mountains rather than intersecting them.
                const r  = 2500 * WORLD_SCALE;
                pos[i * 3]     = Math.cos(az) * Math.cos(el) * r;
                pos[i * 3 + 1] = Math.sin(el) * r * 0.9 + 60 * WORLD_SCALE;
                pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * r;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this._starMat = new THREE.PointsMaterial({
                color: 0xdfe8ff, size: 1.8, sizeAttenuation: false,
                transparent: true, opacity: 0, depthWrite: false
            });
            this._starMat.fog = false;
            this._stars = new THREE.Points(geo, this._starMat);
            this._stars.frustumCulled = false;
            this._group.add(this._stars);

            // --- Moon sprite (mirrors the sun's arc, up at night) ---
            const cv = document.createElement('canvas');
            cv.width = cv.height = 64;
            const cx = cv.getContext('2d');
            const g = cx.createRadialGradient(32, 32, 4, 32, 32, 30);
            g.addColorStop(0, '#f4f6ff');
            g.addColorStop(0.75, '#c9d2e8');
            g.addColorStop(1, 'rgba(120,130,160,0)');
            cx.fillStyle = g;
            cx.fillRect(0, 0, 64, 64);
            this._moonTex = new THREE.CanvasTexture(cv);
            this._moonMat = new THREE.SpriteMaterial({
                map: this._moonTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0
            });
            this._moonMat.fog = false;
            this._moon = new THREE.Sprite(this._moonMat);
            this._moon.scale.set(230 * WORLD_SCALE, 230 * WORLD_SCALE, 1);
            this._group.add(this._moon);

            // --- Low-poly clouds: one InstancedMesh of flattened icosahedra ---
            this._cloudGeo = new THREE.IcosahedronGeometry(46 * WORLD_SCALE, 0);
            this._cloudMat = new THREE.MeshLambertMaterial({
                color: 0xffffff, transparent: true, opacity: 0.85
            });
            this._cloudMat.fog = false;
            const COUNT = 26;
            this._clouds = new THREE.InstancedMesh(this._cloudGeo, this._cloudMat, COUNT);
            const dummy = new THREE.Object3D();
            let s = 12345;
            const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
            for (let i = 0; i < COUNT; i++) {
                const ang = rnd() * Math.PI * 2;
                const rad = (500 + rnd() * 1900) * WORLD_SCALE;
                dummy.position.set(Math.cos(ang) * rad, (470 + rnd() * 300) * WORLD_SCALE, Math.sin(ang) * rad);
                dummy.rotation.y = rnd() * Math.PI;
                dummy.scale.set(1.2 + rnd() * 2.4, 0.32 + rnd() * 0.2, 1.2 + rnd() * 2.4);
                dummy.updateMatrix();
                this._clouds.setMatrixAt(i, dummy.matrix);
            }
            this._clouds.frustumCulled = false;
            this._group.add(this._clouds);
            this._tmpC = new THREE.Color();
        }

        update(camX, camZ, hour, dayFactor, delta, underwater) {
            this._group.position.set(camX, 0, camZ);
            this._group.visible = !underwater;
            if (underwater) return;

            this._starMat.opacity = Math.max(0, 0.95 - dayFactor * 1.6);

            // Clouds slowly orbit the camera (reads as wind drift) and dim at dusk.
            this._clouds.rotation.y += delta * 0.0045;
            this._tmpC.setRGB(
                0.25 + dayFactor * 0.75,
                0.27 + dayFactor * 0.73,
                0.34 + dayFactor * 0.66
            );
            this._cloudMat.color.lerp(this._tmpC, Math.min(1, delta * 2));
            this._cloudMat.opacity = 0.55 + dayFactor * 0.3;

            // Moon: opposite arc to the sun, visible only after dark.
            const nightT = (hour >= 18) ? (hour - 18) / 12 : (hour + 6) / 12;
            const az = Math.PI * (1 - Math.max(0, Math.min(1, nightT)));
            this._moon.position.set(
                Math.cos(az) * 1900 * WORLD_SCALE,
                (150 + Math.sin(Math.max(0, Math.min(1, nightT)) * Math.PI) * 1100) * WORLD_SCALE,
                Math.sin(az) * 900 * WORLD_SCALE
            );
            this._moonMat.opacity = Math.max(0, 0.9 - dayFactor * 1.8);
        }

        dispose() {
            this._scene.remove(this._group);
            this._stars.geometry.dispose();
            this._starMat.dispose();
            this._moonTex.dispose();
            this._moonMat.dispose();
            this._cloudGeo.dispose();
            this._cloudMat.dispose();
        }
    }

    // =========================================================================
    // WheelFx, a small pooled particle system for wheel dust (offroad), tyre
    // smoke (drifting) and exhaust chuffs. CPU-integrated ring buffer; dead
    // particles are parked far underground so no per-frame allocation happens.
    // =========================================================================
    class WheelFx {
        constructor(scene) {
            this._scene = scene;
            const N = this._max = 220;
            this._pos  = new Float32Array(N * 3);
            this._col  = new Float32Array(N * 3);
            this._vel  = new Float32Array(N * 3);
            this._life = new Float32Array(N);
            for (let i = 0; i < N; i++) this._pos[i * 3 + 1] = -99999;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
            geo.setAttribute('color',    new THREE.BufferAttribute(this._col, 3));
            this._mat = new THREE.PointsMaterial({
                size: 4.0, vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false
            });
            this._pts = new THREE.Points(geo, this._mat);
            this._pts.frustumCulled = false;
            scene.add(this._pts);
            this._cursor = 0;
            this._dirty = false;
        }

        spawn(x, y, z, vx, vy, vz, r, g, b, life) {
            const i = this._cursor;
            this._cursor = (i + 1) % this._max;
            this._pos[i * 3] = x; this._pos[i * 3 + 1] = y; this._pos[i * 3 + 2] = z;
            this._vel[i * 3] = vx; this._vel[i * 3 + 1] = vy; this._vel[i * 3 + 2] = vz;
            this._col[i * 3] = r; this._col[i * 3 + 1] = g; this._col[i * 3 + 2] = b;
            this._life[i] = life;
            this._dirty = true;
        }

        update(delta) {
            let any = false;
            for (let i = 0; i < this._max; i++) {
                if (this._life[i] <= 0) continue;
                any = true;
                this._life[i] -= delta;
                if (this._life[i] <= 0) { this._pos[i * 3 + 1] = -99999; continue; }
                this._pos[i * 3]     += this._vel[i * 3]     * delta;
                this._pos[i * 3 + 1] += this._vel[i * 3 + 1] * delta;
                this._pos[i * 3 + 2] += this._vel[i * 3 + 2] * delta;
                this._vel[i * 3]     *= 0.92;
                this._vel[i * 3 + 2] *= 0.92;
                this._vel[i * 3 + 1] += 2.5 * delta;   // smoke/dust drifts upward as it thins
            }
            if (any || this._dirty) {
                this._pts.geometry.attributes.position.needsUpdate = true;
                this._pts.geometry.attributes.color.needsUpdate = true;
                this._dirty = any;
            }
        }

        dispose() {
            this._scene.remove(this._pts);
            this._pts.geometry.dispose();
            this._mat.dispose();
        }
    }

    // =========================================================================
    // EngineAudio, real sampled engine note via WebAudio. Two CC0 engine loops
    // (audio/se/CarEngineLoop.ogg + CarEngineRev.ogg, "racing car engine sound
    // loops" by domasx2, public domain) are looped and their playbackRate tracks
    // the gearbox RPM so the pitch rises through each gear; a high-rev layer
    // fades in near redline. Plus a looped-noise wind layer that rises with road
    // speed and a resonant tyre-screech layer driven by lateral slip.
    // Fully guarded so a missing/blocked AudioContext or absent files never throw.
    // =========================================================================
    class EngineAudio {
        constructor() {
            this._ok = false;
            this._ready = false;         // engine samples decoded + started
            this._liminalRate = 1;       // playback-rate multiplier for liminal drift
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                const ctx = new AC();
                this._ctx    = ctx;

                // Sampled engine loops feed a shared lowpass tone shaper; the base
                // loop carries the body of the note, the rev layer the top-end growl.
                this._filter = ctx.createBiquadFilter();
                this._filter.type = 'lowpass';
                this._filter.frequency.value = 700;
                this._engGain = ctx.createGain();
                this._engGain.gain.value = 0.0;
                this._revGain = ctx.createGain();
                this._revGain.gain.value = 0.0;
                this._engGain.connect(this._filter);
                this._revGain.connect(this._filter);
                this._filter.connect(ctx.destination);

                // One shared looped white-noise buffer feeds both the wind rush
                // (broad bandpass) and the tyre screech (narrow resonant band).
                const len = ctx.sampleRate * 2;
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const ch  = buf.getChannelData(0);
                for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
                this._noise = ctx.createBufferSource();
                this._noise.buffer = buf;
                this._noise.loop = true;
                this._windFilter = ctx.createBiquadFilter();
                this._windFilter.type = 'bandpass';
                this._windFilter.frequency.value = 650;
                this._windFilter.Q.value = 0.6;
                this._windGain = ctx.createGain();
                this._windGain.gain.value = 0;
                this._skidFilter = ctx.createBiquadFilter();
                this._skidFilter.type = 'bandpass';
                this._skidFilter.frequency.value = 2300;
                this._skidFilter.Q.value = 7;
                this._skidGain = ctx.createGain();
                this._skidGain.gain.value = 0;
                this._noise.connect(this._windFilter);
                this._windFilter.connect(this._windGain);
                this._windGain.connect(ctx.destination);
                this._noise.connect(this._skidFilter);
                this._skidFilter.connect(this._skidGain);
                this._skidGain.connect(ctx.destination);

                // Turbo whoosh: a bandpass off the shared noise that sweeps up and
                // swells while the accelerator boost is held.
                this._boostFilter = ctx.createBiquadFilter();
                this._boostFilter.type = 'bandpass';
                this._boostFilter.frequency.value = 320;
                this._boostFilter.Q.value = 1.4;
                this._boostGain = ctx.createGain();
                this._boostGain.gain.value = 0;
                this._noise.connect(this._boostFilter);
                this._boostFilter.connect(this._boostGain);
                this._boostGain.connect(ctx.destination);

                // Gear-shift blip: a short filtered-noise "chk" pulsed on each
                // gear change by playShift().
                this._shiftFilter = ctx.createBiquadFilter();
                this._shiftFilter.type = 'bandpass';
                this._shiftFilter.frequency.value = 900;
                this._shiftFilter.Q.value = 3;
                this._shiftGain = ctx.createGain();
                this._shiftGain.gain.value = 0;
                this._noise.connect(this._shiftFilter);
                this._shiftFilter.connect(this._shiftGain);
                this._shiftGain.connect(ctx.destination);

                this._noise.start();
                this._ok = true;
                this._loadSamples();
            } catch (e) { this._ok = false; }
        }

        // Decode the CC0 engine OGGs and start them as seamless loops. Async, so
        // setState stays silent (engine layers muted) until _ready flips true.
        _loadSamples() {
            const ctx = this._ctx;
            const load = (url) => fetch(url)
                .then(r => r.arrayBuffer())
                .then(b => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)));
            Promise.all([
                load('audio/se/CarEngineLoop.ogg'),
                load('audio/se/CarEngineRev.ogg')
            ]).then(([eng, rev]) => {
                if (!this._ok) return;
                this._engSrc = ctx.createBufferSource();
                this._engSrc.buffer = eng; this._engSrc.loop = true;
                this._engSrc.connect(this._engGain);
                this._engSrc.start();
                this._revSrc = ctx.createBufferSource();
                this._revSrc.buffer = rev; this._revSrc.loop = true;
                this._revSrc.connect(this._revGain);
                this._revSrc.start();
                this._ready = true;
            }).catch(() => { this._ready = false; });
        }

        setState(rpm01, load01, speedKmh, slip01, driving) {
            if (!this._ok) return;
            const ctx = this._ctx;
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const now  = ctx.currentTime;
            const cfg = (typeof ConfigManager !== 'undefined' && ConfigManager.seVolume != null)
                ? ConfigManager.seVolume / 100 : 1;

            if (this._ready) {
                const r = Math.max(0, Math.min(1.05, rpm01 || 0));
                // Idle ~0.85x, redline ~2.55x. The rev layer runs a third faster.
                const rate = (0.85 + r * 1.7) * this._liminalRate;
                this._engSrc.playbackRate.setTargetAtTime(rate,        now, 0.05);
                this._revSrc.playbackRate.setTargetAtTime(rate * 1.33, now, 0.05);
                this._filter.frequency.setTargetAtTime(500 + r * 2200 + (load01 || 0) * 400, now, 0.08);
                const engVol = (driving ? 0.16 + r * 0.20 + (load01 || 0) * 0.05 : 0.11) * cfg;
                this._engGain.gain.setTargetAtTime(engVol, now, 0.08);
                const revVol = (driving ? Math.max(0, r - 0.35) * 0.28 + (load01 || 0) * 0.06 : 0) * cfg;
                this._revGain.gain.setTargetAtTime(revVol, now, 0.10);
            }

            const wind = Math.min(0.11, Math.max(0, (speedKmh || 0) - 25) * 0.00042) * cfg;
            this._windGain.gain.setTargetAtTime(wind, now, 0.15);
            this._windFilter.frequency.setTargetAtTime(500 + (speedKmh || 0) * 2.2, now, 0.2);
            const skid = Math.max(0, (slip01 || 0) - 0.25) * 0.10 * cfg;
            this._skidGain.gain.setTargetAtTime(skid, now, 0.05);
        }

        // Turbo layer on/off (accelerator boost held): swell + sweep up on, fall
        // away on release.
        setBoost(on) {
            if (!this._ok) return;
            const now = this._ctx.currentTime;
            const cfg = (typeof ConfigManager !== 'undefined' && ConfigManager.seVolume != null)
                ? ConfigManager.seVolume / 100 : 1;
            this._boostGain.gain.setTargetAtTime(on ? 0.12 * cfg : 0, now, on ? 0.12 : 0.25);
            this._boostFilter.frequency.setTargetAtTime(on ? 1400 : 320, now, on ? 0.5 : 0.3);
        }

        // One-shot mechanical "chk" on a gear change.
        playShift() {
            if (!this._ok) return;
            const now = this._ctx.currentTime;
            const cfg = (typeof ConfigManager !== 'undefined' && ConfigManager.seVolume != null)
                ? ConfigManager.seVolume / 100 : 1;
            try {
                const g = this._shiftGain.gain;
                g.cancelScheduledValues(now);
                g.setValueAtTime(0.0001, now);
                g.linearRampToValueAtTime(0.09 * cfg, now + 0.012);
                g.exponentialRampToValueAtTime(0.0008, now + 0.13);
                g.setValueAtTime(0, now + 0.14);
                const f = this._shiftFilter.frequency;
                f.cancelScheduledValues(now);
                f.setValueAtTime(1300, now);
                f.exponentialRampToValueAtTime(650, now + 0.13);
            } catch (e) { /* ignore */ }
        }

        // A slowed, sinking engine as the liminal overdrive takes hold.
        setLiminal(i) {
            if (!this._ok) return;
            this._liminalRate = 1 - Math.min(0.6, i * 0.5);
            if (i > 0) {
                const now = this._ctx.currentTime;
                this._filter.frequency.setTargetAtTime(420 * (1 - i * 0.55) + 80, now, 0.2);
            }
        }

        dispose() {
            if (!this._ok) return;
            try {
                const t = this._ctx.currentTime;
                this._engGain.gain.setTargetAtTime(0, t, 0.05);
                this._revGain.gain.setTargetAtTime(0, t, 0.05);
                this._windGain.gain.setTargetAtTime(0, t, 0.05);
                this._skidGain.gain.setTargetAtTime(0, t, 0.05);
                this._boostGain.gain.setTargetAtTime(0, t, 0.05);
                this._shiftGain.gain.setTargetAtTime(0, t, 0.05);
                if (this._engSrc) this._engSrc.stop(t + 0.2);
                if (this._revSrc) this._revSrc.stop(t + 0.2);
                this._noise.stop(t + 0.2);
                setTimeout(() => { this._ctx.close().catch(() => {}); }, 300);
            } catch (e) { /* ignore */ }
            this._ok = false;
        }
    }

    // =========================================================================
    // WaterPlane, a single large animated sea plane that follows the camera.
    // Sits just below ground (y = -2.5) so it only shows through the basins the
    // terrain digs for water tiles. Phong + sun specular gives a moving glint;
    // far cheaper than one plane per chunk and it never seams.
    // =========================================================================
    class WaterPlane {
        constructor(scene) {
            this._scene = scene;
            // Scales with the world so the sea reaches the horizon on the enlarged map.
            const geo = new THREE.PlaneGeometry(5000 * WORLD_SCALE, 5000 * WORLD_SCALE, 1, 1);
            geo.rotateX(-Math.PI / 2);
            this._mat = new THREE.MeshPhongMaterial({
                color:       0x2f86b8,
                specular:    0x9fd0ee,
                shininess:   90,
                transparent: true,
                opacity:     0.86,
                depthWrite:  false,
                side:        THREE.DoubleSide,  // visible as a ceiling when submerged
                map:         loadTex('teal_marble.jpg', 24)
            });
            this._mesh = new THREE.Mesh(geo, this._mat);
            this._mesh.position.y = -2.5;
            this._mesh.renderOrder = -1;
            scene.add(this._mesh);
        }

        update(camX, camZ, t) {
            this._mesh.position.x = camX;
            this._mesh.position.z = camZ;
            // Gentle swell: bob the plane and shimmer the glint.
            this._mesh.position.y = -2.5 + Math.sin(t * 1.1) * 0.25;
            this._mat.opacity = 0.82 + Math.sin(t * 1.7) * 0.05;
        }

        dispose() {
            if (this._mesh) {
                this._scene.remove(this._mesh);
                this._mesh.geometry.dispose();
            }
            if (this._mat) this._mat.dispose();
        }
    }

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
            const bodyTex   = loadTex('grey_marble.jpg', 1);   // subtle paint/metal detail
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
                m = new THREE.MeshLambertMaterial({ color, map: loadTex('grey_marble.jpg', 1) });
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

    // =========================================================================
    // BiomeEnemyManager, decorative wildlife: the actual bespoke 3D battler
    // models (Battler3D families) spawned on the terrain around the camper,
    // picked from each enemy's <Biome:> note tag to match the tile they stand
    // on. They stand still and play their idle animation; pooled and recycled
    // by distance like the traffic.
    // =========================================================================
    const ENEMY_3D_MAX       = 24;     // concurrently loaded battler models
    const ENEMY_3D_DESPAWN   = 1250;   // world units before an enemy recycles
    const ENEMY_3D_SPAWN_INT = 0.5;    // seconds between spawn attempts
    const ENEMY_3D_CONTACT_R = 16;     // world units: how close counts as "touching"

    class BiomeEnemyManager {
        constructor(scene, terrain) {
            this._scene   = scene;
            this._terrain = terrain;
            this._ents    = [];
            this._timer   = 0;
            this._byBiome = null;   // lazy index: biome tag (lowercase) -> enemy ids
            this._ok = !!(window.Battler3D && typeof window.Battler3D.create === 'function' &&
                typeof $dataEnemies !== 'undefined' && $dataEnemies);
        }

        // Index every enemy's <Biome: a, b, c> tags once per scene.
        _index() {
            if (this._byBiome) return this._byBiome;
            const map = new Map();
            for (const e of $dataEnemies) {
                if (!e || !e.note) continue;
                const m = e.note.match(/<Biome:\s*(.+?)>/i);
                if (!m) continue;
                for (const raw of m[1].split(',')) {
                    const b = raw.trim().toLowerCase();
                    if (!b) continue;
                    if (!map.has(b)) map.set(b, []);
                    map.get(b).push(e.id);
                }
            }
            this._byBiome = map;
            return map;
        }

        // Enemy ids for a tile biome: exact tag match first, then the longest
        // partial match (so "MountainIce" still finds "Mountain" dwellers).
        _candidatesFor(biomeName) {
            const idx = this._index();
            const n = biomeName.toLowerCase();
            const exact = idx.get(n);
            if (exact && exact.length) return exact;
            let best = null, bestLen = 0;
            for (const [tag, ids] of idx) {
                if (tag.length >= 4 && tag.length > bestLen &&
                    (n.includes(tag) || tag.includes(n))) {
                    best = ids; bestLen = tag.length;
                }
            }
            return best;
        }

        update(delta, vanX, vanZ) {
            if (!this._ok) return;
            // Gait animations tick, roaming updates, distance recycling.
            for (let i = this._ents.length - 1; i >= 0; i--) {
                const ent = this._ents[i];
                if (ent.model && typeof ent.model.update === 'function') {
                    try { ent.model.update(delta); } catch (e) { /* ignore */ }
                }
                if (ent.root && ent.moveSpeed > 0) this._roam(ent, delta);
                const dx = ent.x - vanX, dz = ent.z - vanZ;
                if (dx * dx + dz * dz > ENEMY_3D_DESPAWN * ENEMY_3D_DESPAWN) this._remove(i);
            }
            this._timer += delta;
            if (this._timer < ENEMY_3D_SPAWN_INT) return;
            this._timer = 0;
            if (this._ents.length < ENEMY_3D_MAX) this._trySpawn(vanX, vanZ);
        }

        // Walk / run / fly / swim roaming: drift along a slowly-wandering heading,
        // follow the terrain height (flyers hover above it), bouncing off water
        // (unless swimming) and the world edge. The gait pose itself (bob / bank /
        // fishtail) is layered on by the battler model's own locomotion overlay.
        _roam(ent, delta) {
            const ts = WORLD_TILE_SIZE;
            ent.turnT -= delta;
            if (ent.turnT <= 0) { ent.turnT = 1.5 + Math.random() * 2.5; ent.heading += (Math.random() - 0.5) * 1.2; }
            const nx = ent.x + Math.cos(ent.heading) * ent.moveSpeed * delta;
            const nz = ent.z + Math.sin(ent.heading) * ent.moveSpeed * delta;
            const wx = Math.floor(nx / ts), wy = Math.floor(nz / ts);
            let blocked = wx < 0 || wy < 0 || wx >= 256 || wy >= 256;
            if (!blocked && ent.gait !== 'swim' && getRenderType(sampleBiomeAt(wx, wy).name) === 'water') blocked = true;
            if (blocked) { ent.heading += Math.PI * (0.5 + Math.random() * 0.5); ent.turnT = 1.0; return; }
            const gy = this._terrain.getTerrainHeight(nx / ts, nz / ts);
            if (gy < -0.5 && ent.gait !== 'swim') { ent.heading += Math.PI; ent.turnT = 1.0; return; }
            ent.x = nx; ent.z = nz;
            ent.root.position.set(ent.x, gy + (ent.flyH || 0), ent.z);
            ent.root.rotation.y = Math.atan2(Math.cos(ent.heading), Math.sin(ent.heading));
        }

        _trySpawn(vanX, vanZ) {
            const ts = WORLD_TILE_SIZE;
            for (let attempt = 0; attempt < 6; attempt++) {
                const ang  = Math.random() * Math.PI * 2;
                const dist = 260 + Math.random() * 700;
                const x = vanX + Math.cos(ang) * dist;
                const z = vanZ + Math.sin(ang) * dist;
                const wx = Math.floor(x / ts), wy = Math.floor(z / ts);
                if (wx < 0 || wy < 0 || wx >= 256 || wy >= 256) continue;
                const biome = sampleBiomeAt(wx, wy);
                const type  = getRenderType(biome.name);
                if (type === 'water' || type === 'road') continue;
                const ids = this._candidatesFor(biome.name);
                if (!ids || !ids.length) continue;
                const data = $dataEnemies[ids[(Math.random() * ids.length) | 0]];
                if (!data) continue;
                const key = window.Battler3D.resolveKey(data);
                if (!key) continue;
                let model = null;
                try { model = window.Battler3D.create(key, 0, 0, null); } catch (e) { model = null; }
                if (!model) continue;
                const gy = this._terrain.getTerrainHeight(x / ts, z / ts);
                if (gy < -0.5) continue;   // not on the submerged coastal shelf

                // Movement / gait from the enemy's Enemies.json metadata.
                const loco = window.Battler3D.resolveLocomotion(data);
                const moving = loco.gait !== 'idle' && loco.movement !== 'fixed';
                const moveSpeed = moving ? window.Battler3D.gaitMoveSpeed(loco.speed, loco.gait) : 0;
                const flyH = loco.gait === 'fly' ? (45 + Math.random() * 55) : 0;
                const yaw = Math.random() * Math.PI * 2;
                const ent = {
                    model, x, z, alive: true, root: null, enemyId: data.id,
                    gait: loco.gait, moveSpeed, flyH,
                    heading: yaw, turnT: 1 + Math.random() * 2
                };
                this._ents.push(ent);
                // Battler models fit-clamp to ~5 units for battle; scaled up to
                // read at driving-world scale (a person is roughly 9 units).
                const scale = 1.6 + Math.random() * 1.6;
                Promise.resolve(model.load(null, x, gy, z)).then(() => {
                    if (!ent.alive || !model.model) return;
                    const root = model.model;
                    // Mirror the battle scene's facing wrapper for non-bipeds.
                    if (model.facingYaw && !model._facingApplied) {
                        model._facingApplied = true;
                        const inner = new THREE.Group();
                        inner.rotation.y = model.facingYaw;
                        for (const k of root.children.slice()) inner.add(k);
                        root.add(inner);
                    }
                    root.scale.multiplyScalar(scale);
                    root.position.set(x, gy + flyH, z);
                    root.rotation.y = yaw;
                    if (window.PSXShader && window.PSXShader.applyToObject) {
                        window.PSXShader.applyToObject(root);
                    }
                    this._scene.add(root);
                    try {
                        if (loco.gait === 'idle') { model.playIdleAnimation(); }
                        else { model.setGaitSpeed(loco.speed); model.playGait(loco.gait); }
                    } catch (e) { /* some families auto-idle */ }
                    ent.root = root;
                }).catch(() => { ent.alive = false; });
                return;
            }
        }

        _remove(i) {
            const ent = this._ents[i];
            ent.alive = false;
            if (ent.root) {
                this._scene.remove(ent.root);
                ent.root.traverse(o => {
                    if (o.geometry) o.geometry.dispose();
                    if (o.material) {
                        const mats = Array.isArray(o.material) ? o.material : [o.material];
                        for (const m of mats) m.dispose();   // textures stay cached
                    }
                });
            } else if (ent.model && typeof ent.model.dispose === 'function') {
                try { ent.model.dispose(); } catch (e) { /* ignore */ }
            }
            this._ents.splice(i, 1);
        }

        dispose() {
            for (let i = this._ents.length - 1; i >= 0; i--) this._remove(i);
        }
    }

    // enemy id -> a troop holding that one creature, same reading BolognaMapSystem
    // uses for its own walked-into street/canal fauna ("troop N holds enemy N"
    // for most of the table but not all of it, so it is read rather than assumed).
    let _bioTroopByEnemy = null;

    function bioBuildTroopIndex() {
        const index = {};
        for (let i = 1; i < $dataTroops.length; i++) {
            const troop = $dataTroops[i];
            if (!troop || !troop.members || troop.members.length !== 1) continue;
            if (troop._bseReinforced || troop._bsePetrodemon) continue;
            const id = troop.members[0].enemyId;
            if (index[id] === undefined || i === id) index[id] = i;
        }
        _bioTroopByEnemy = index;
    }

    function bioTroopHoldsEnemy(troopId, enemyId) {
        const troop = troopId ? $dataTroops[troopId] : null;
        return !!(troop && troop.members && troop.members[0] &&
            troop.members[0].enemyId === enemyId);
    }

    function troopForBioEnemy(enemyId) {
        if (!_bioTroopByEnemy) bioBuildTroopIndex();
        let troopId = _bioTroopByEnemy[enemyId] || 0;
        // A scratch slot (a reinforced troop, a petrodemon) is written over an
        // existing one at runtime, so a cached answer is checked against the
        // live table and the index rebuilt rather than trusted for the session.
        if (!bioTroopHoldsEnemy(troopId, enemyId)) {
            bioBuildTroopIndex();
            troopId = _bioTroopByEnemy[enemyId] || 0;
            if (!bioTroopHoldsEnemy(troopId, enemyId)) return 0;
        }
        return troopId;
    }

    // =========================================================================
    // SpeedWarpFx, the speed lens.
    //
    // At speed the world does NOT fold: nothing in the scene is moved, scaled or
    // displaced. The finished frame is rendered into an offscreen target and then
    // blitted back through a fragment shader that bends the LIGHT in a bubble
    // around the camper, the same read as the gravitational lens the black holes
    // wear in GalaxySim: a swirl plus a radial pull, strongest in a ring hugging
    // the vehicle and gone a short way out, with the RGB channels pulled by
    // slightly different amounts so the rim fringes.
    //
    // Because it is screen space it costs one full-screen pass whatever is on
    // screen, it cannot tear chunk seams open, and physics never sees it.
    // =========================================================================
    class SpeedWarpFx {
        constructor() {
            this._target = null;
            this._mat = null;
            this._scene = null;
            this._cam = null;
            this._ndc = new THREE.Vector3();
        }

        _build() {
            if (this._mat) return;
            this._mat = new THREE.ShaderMaterial({
                depthTest: false,
                depthWrite: false,
                transparent: false,
                blending: THREE.NoBlending,
                uniforms: {
                    tDiffuse: { value: null },
                    uCenter:  { value: new THREE.Vector2(0.5, 0.5) },
                    uAspect:  { value: 1 },
                    uAmount:  { value: 0 },
                    uTime:    { value: 0 },
                    uInner:   { value: 0.10 },
                    uOuter:   { value: 0.42 }
                },
                vertexShader: [
                    'varying vec2 vUv;',
                    'void main() {',
                    '  vUv = uv;',
                    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'uniform sampler2D tDiffuse;',
                    'uniform vec2  uCenter;',
                    'uniform float uAspect;',
                    'uniform float uAmount;',
                    'uniform float uTime;',
                    'uniform float uInner;',
                    'uniform float uOuter;',
                    'varying vec2 vUv;',
                    // Sample the frame with the lens applied at strength s. Called
                    // three times, once per channel, so the rim splits into colour.
                    'vec2 bend(vec2 uv, float s) {',
                    '  vec2 d = (uv - uCenter) * vec2(uAspect, 1.0);',
                    '  float r = length(d);',
                    // Ring falloff: nothing at the very centre (the camper itself
                    // stays crisp), peak just off its flanks, nothing past uOuter.
                    '  float k = smoothstep(uInner * 0.25, uInner, r) *',
                    '            (1.0 - smoothstep(uInner, uOuter, r));',
                    '  if (k <= 0.0) return uv;',
                    '  k *= s;',
                    // Swirl about the camper.
                    '  float a = 0.85 * k;',
                    '  float ca = cos(a), sa = sin(a);',
                    '  vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);',
                    // Radial pull, breathing outward so the bubble never sits still.
                    '  float pull = 1.0 - k * (0.30 + 0.16 * sin(r * 26.0 - uTime * 7.0));',
                    '  rd *= pull;',
                    '  return uCenter + rd / vec2(uAspect, 1.0);',
                    '}',
                    'void main() {',
                    '  float s = uAmount;',
                    '  vec2 ur = clamp(bend(vUv, s * 1.06), 0.0, 1.0);',
                    '  vec2 ug = clamp(bend(vUv, s),        0.0, 1.0);',
                    '  vec2 ub = clamp(bend(vUv, s * 0.94), 0.0, 1.0);',
                    '  gl_FragColor = vec4(',
                    '    texture2D(tDiffuse, ur).r,',
                    '    texture2D(tDiffuse, ug).g,',
                    '    texture2D(tDiffuse, ub).b,',
                    '    1.0);',
                    '}'
                ].join('\n')
            });
            this._scene = new THREE.Scene();
            this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat));
            this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
            this._cam.position.z = 1;
        }

        // Draw one frame through the lens. drawInto(target) must render the scene
        // into the target it is handed (that is where the PSX downscale pass, if
        // any, is chained in). center is the camper's world position; camera is
        // the live scene camera, used to project it to a screen point.
        // Returns false when the effect declined to run, so the caller falls back
        // to drawing straight to the canvas.
        render(renderer, drawInto, { amount, time, center, camera, centered }) {
            if (!renderer || !(amount > 0)) return false;
            let cu = 0.5, cv = 0.5;
            if (!centered) {
                // Behind the camera (or far off screen): nothing to bend around.
                this._ndc.copy(center).project(camera);
                if (this._ndc.z > 1) return false;
                cu = this._ndc.x * 0.5 + 0.5;
                cv = this._ndc.y * 0.5 + 0.5;
                if (cu < -0.5 || cu > 1.5 || cv < -0.5 || cv > 1.5) return false;
            }

            this._build();
            const w = Math.max(1, renderer.domElement.width);
            const h = Math.max(1, renderer.domElement.height);
            let rt = this._target;
            if (!rt || rt.width !== w || rt.height !== h) {
                if (rt) rt.dispose();
                rt = new THREE.WebGLRenderTarget(w, h, {
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    depthBuffer: true,
                    stencilBuffer: false
                });
                // The offscreen frame must hold exactly what the canvas would have
                // held. three picks the colour conversion from the TARGET's texture,
                // so an ordinary (linear) target would store un-converted colour and
                // the raw lens shader - which has no encoding pass of its own - would
                // then paint a washed-out picture. Declaring the target sRGB moves
                // the conversion one pass earlier and the lens simply passes bytes
                // through, so the image is identical to a direct render.
                if (THREE.SRGBColorSpace !== undefined && 'colorSpace' in rt.texture) {
                    rt.texture.colorSpace = THREE.SRGBColorSpace;
                } else if (THREE.sRGBEncoding !== undefined) {
                    rt.texture.encoding = THREE.sRGBEncoding;
                }
                this._target = rt;
            }

            drawInto(rt);

            const u = this._mat.uniforms;
            u.tDiffuse.value = rt.texture;
            u.uCenter.value.set(cu, cv);
            u.uAspect.value = w / h;
            u.uAmount.value = amount;
            u.uTime.value = time;
            // The bubble grows with speed but stays a bubble: at full strength it
            // reaches roughly a third of the screen, never the whole view.
            u.uInner.value = 0.08 + 0.05 * amount;
            u.uOuter.value = 0.26 + 0.20 * amount;

            renderer.setRenderTarget(null);
            renderer.render(this._scene, this._cam);
            return true;
        }

        dispose() {
            if (this._target) { this._target.dispose(); this._target = null; }
            if (this._scene) {
                this._scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
                this._scene = null;
            }
            if (this._mat) { this._mat.dispose(); this._mat = null; }
        }
    }

    // =========================================================================
    // LiminalFx, the cosmic-horror overdrive. Inert at cruising speed; as the
    // camper accelerates past ~130 km/h reality starts to peel: the road heaves,
    // the camper writhes, the palette bleeds violet then blood-red, the camera
    // warps and rolls, and eldritch shapes crowd in. At 999 km/h it is hellish
    // and breaking apart. Everything snaps back to normal below the threshold.
    // =========================================================================
    const LIMINAL_START_KMH = 130;

    class LiminalFx {
        constructor(scene, overlay) {
            this._scene = scene;
            this._lastFovWarp = 0;
            this._tmpCol = new THREE.Color();

            // DOM tint + vignette over the canvas (beneath the HUD).
            const d = document.createElement('div');
            d.id = 'camper-liminal-overlay';
            d.style.cssText = [
                'position:absolute', 'top:0', 'right:0', 'bottom:0', 'left:0',
                'pointer-events:none', 'z-index:2',
                'opacity:0', 'mix-blend-mode:hard-light'
            ].join(';');
            overlay.appendChild(d);
            this._dom = d;

            // Eldritch entities that fade in and orbit the camper near the limit.
            this._entGroup = new THREE.Group();
            scene.add(this._entGroup);
            this._entGeo = new THREE.IcosahedronGeometry(22, 0);
            this._entMat = new THREE.MeshStandardMaterial({
                color: 0x120008, emissive: 0x6a0010, emissiveIntensity: 0.9,
                map: loadTex('crimson_psychedelic.jpg', 1),
                flatShading: true, roughness: 1, metalness: 0
            });
            this._ents = [];
            for (let i = 0; i < 14; i++) {
                const m = new THREE.Mesh(this._entGeo, this._entMat);
                m.visible = false;
                this._entGroup.add(m);
                this._ents.push({
                    mesh: m,
                    ang:   Math.random() * Math.PI * 2,
                    rad:   180 + Math.random() * 340,
                    hgt:   30 + Math.random() * 190,
                    spin:  0.5 + Math.random() * 1.6,
                    orbit: (0.2 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1)
                });
            }
        }

        update(o) {
            const { camera, van, renderer, intensity: i, time, delta, baseExposure, scene, viewMode } = o;

            // --- DOM tint / vignette: violet at mid, blood red at the limit ---
            this._dom.style.opacity = i <= 0 ? '0' : String(Math.min(0.92, 0.22 + i * i * 0.88));
            if (i > 0) {
                const red  = Math.floor(20 + i * 95);
                const purp = Math.max(0, 0.4 - i * 0.4);
                // i18n-ignore-start  css gradients
                this._dom.style.background =
                    `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${Math.max(6, 35 - i * 26)}%, rgba(${red},0,${Math.floor(10 + i * 6)},${0.5 + i * 0.45}) 100%),` +
                    `radial-gradient(circle at 50% 50%, rgba(150,0,190,0) 0%, rgba(150,0,190,${purp}) 100%)`;
                // i18n-ignore-end
            }

            // --- exposure flicker ---
            if (renderer && baseExposure != null) {
                const flick = i > 0 ? (Math.sin(time * 40) * 0.12 + (i > 0.85 ? (Math.random() - 0.5) * 0.5 : 0)) * i : 0;
                renderer.toneMappingExposure = baseExposure * (1 + flick);
            }

            // --- palette bleed ---
            if (i > 0 && scene) {
                const target = this._tmpCol.setRGB(0.06 + i * 0.6, 0.0, 0.10 * (1 - i));
                const k = Math.min(1, i * 0.9) * Math.min(1, delta * 6);
                scene.background.lerp(target, k);
                scene.fog.color.lerp(target, k);
                scene.fog.density = Math.max(scene.fog.density, (0.0016 + i * 0.004) / WORLD_SCALE);
            }

            // --- camera FOV warp (undo-then-reapply so it never accumulates) ---
            if (camera) {
                camera.fov -= this._lastFovWarp;
                const warp = i > 0 ? (Math.sin(time * 3) * 10 * i + i * 16) : 0;
                camera.fov = Math.max(20, Math.min(140, camera.fov + warp));
                this._lastFovWarp = warp;
                camera.updateProjectionMatrix();

                // Roll. Applied RELATIVE to the orientation the active mode set
                // fresh this frame (via lookAt / the FP rig), and only while the
                // effect is live. Writing camera.rotation.z absolutely used to
                // clobber lookAt's quaternion: at certain headings the euler sync
                // lands near gimbal lock (z near pi), so forcing z=0 rolled the
                // view 180 degrees - the "upside down at the start" bug.
                if (i > 0) {
                    const roll = Math.sin(time * 2.3) * 0.06 * i +
                        (i > 0.85 ? (Math.random() - 0.5) * 0.18 * i : 0);
                    camera.rotateZ(roll);
                }

                // Positional shake only where the camera position is recomputed
                // each frame (car / free); the rig-attached FP views (fp, fpdrive,
                // foot) keep a fixed local camera position, so shaking it there
                // would accumulate permanent drift.
                if (i > 0 && (viewMode === 'car' || viewMode === 'free')) {
                    const shake = i * (i > 0.85 ? 24 : 7);
                    camera.position.x += (Math.random() - 0.5) * shake;
                    camera.position.y += (Math.random() - 0.5) * shake;
                }
            }

            // --- the camper itself writhes ---
            if (van && van.group) {
                const s  = 1 + (Math.sin(time * 18) * 0.05 + Math.sin(time * 7) * 0.04) * i;
                const sy = 1 + (Math.sin(time * 13) * 0.07) * i;
                van.group.scale.set(s, sy, s);
            }

            // --- eldritch entities crowd in past the midpoint ---
            const count = i < 0.45 ? 0 : Math.round((i - 0.45) / 0.55 * this._ents.length);
            const cx = van ? van.group.position.x : 0;
            const cy = van ? van.group.position.y : 0;
            const cz = van ? van.group.position.z : 0;
            for (let e = 0; e < this._ents.length; e++) {
                const ent = this._ents[e];
                const on = e < count;
                ent.mesh.visible = on;
                if (!on) continue;
                ent.ang += ent.orbit * delta;
                ent.mesh.position.set(
                    cx + Math.cos(ent.ang) * ent.rad,
                    cy + ent.hgt + Math.sin(time * ent.spin + e) * 22,
                    cz + Math.sin(ent.ang) * ent.rad
                );
                ent.mesh.rotation.x += ent.spin * delta;
                ent.mesh.rotation.y += ent.spin * 0.7 * delta;
                ent.mesh.scale.setScalar(1 + i * 1.6);
            }
            this._entMat.emissiveIntensity = 0.5 + i * 1.6;
        }

        dispose() {
            if (this._dom && this._dom.parentNode) this._dom.parentNode.removeChild(this._dom);
            if (this._entGroup) this._scene.remove(this._entGroup);
            if (this._entGeo) this._entGeo.dispose();
            if (this._entMat) this._entMat.dispose();
        }
    }

    // =========================================================================
    // RoadAutopilot
    //
    // Drives the camper along the world's tagged road network on its own: it
    // plans a few tiles ahead through the road graph, picking a random way out
    // whenever a crossroad or T-junction offers one (never doubling back unless
    // the road dead-ends), and feeds the ordinary vehicle physics a steering /
    // throttle / brake input as if a driver were at the wheel. Waypoints sit in
    // the right-hand lane, so the camper keeps to its own side of the road.
    // =========================================================================
    const AUTO_CRUISE_KMH   = 78;    // open road
    const AUTO_BEND_KMH     = 50;    // gentle bend ahead
    const AUTO_TURN_KMH     = 33;    // 90 degree turn ahead
    const AUTO_LOOKAHEAD    = 6;     // waypoints kept planned ahead
    const AUTO_REACH_DIST   = 45;    // world units: waypoint counts as reached
    const AUTO_LOST_TIME    = 5;     // seconds off the asphalt before recovering
    const AUTO_STALL_TIME   = 7;     // seconds barely moving before recovering

    class RoadAutopilot {
        constructor(scene, tileX, tileY) {
            this._scene    = scene;
            this.controls  = { throttle: 0, brake: false, steer: 0 };
            this._wps      = [];      // planned waypoints (world x/z + travel dir)
            this._exitTile = null;    // tile the planned route runs into next
            this._lastAngle = null;   // previous heading, for the steering damper
            this._lostTime = 0;
            this._stallTime = 0;
            this._plan(tileX, tileY);
        }

        // ---- planning -------------------------------------------------------

        // Restart the route on the given tile, heading down whichever road leaves
        // it, and aim the camper along that first leg.
        _plan(tileX, tileY) {
            this._wps.length = 0;
            this._exitTile = null;
            const exits = roadExitsFrom(tileX, tileY, null);
            const side  = exits.length ? exits[Math.floor(Math.random() * exits.length)] : 'e';
            this._pushLeg(tileX, tileY, null, side);
            while (this._wps.length < AUTO_LOOKAHEAD) {
                if (!this._extend()) break;
            }
            // Face the camper down the first leg so it pulls away cleanly.
            const step = ROAD_STEP[side];
            this._scene._driveAngle = Math.atan2(step[0], step[1]);
        }

        // Queue the drive across one tile: in through `from` (null on the first
        // tile) and out through `side`. Straight through, that is the tile centre
        // and the edge crossed, both in the right-hand lane. Around a bend, it is
        // the same quarter-circle the corner tile's asphalt is built on, so the
        // camper follows the curve instead of cutting across the verge.
        _pushLeg(tileX, tileY, from, side) {
            const ts   = WORLD_TILE_SIZE;
            const lane = ROAD_LANE_OFF;
            const step = ROAD_STEP[side];
            const ax = step[0], az = step[1];
            const cx = tileX * ts + ts * 0.5, cz = tileY * ts + ts * 0.5;
            this._exitTile = { x: tileX + ax, y: tileY + az, from: ROAD_OPPOSITE[side] };

            const turning = from && side !== from && ROAD_OPPOSITE[from] !== side;
            if (!turning) {
                // Right of the direction of travel, matching the traffic's lane rule.
                const rx = az, rz = -ax;
                this._wps.push({ x: cx + rx * lane, z: cz + rz * lane, ax, az });
                this._wps.push({ x: cx + rx * lane + ax * ts * 0.5,
                                 z: cz + rz * lane + az * ts * 0.5, ax, az });
                return;
            }

            // Pivot: the tile corner shared by the entry and the exit edge.
            const inStep = ROAD_STEP[from];
            const px = cx + (inStep[0] + ax) * ts * 0.5;
            const pz = cz + (inStep[1] + az) * ts * 0.5;
            // Inside or outside lane, depending on which side of the road the
            // incoming lane sits relative to the pivot.
            const iax = -inStep[0], iaz = -inStep[1];          // incoming heading
            const onPivotSide = (iaz * (px - cx) + (-iax) * (pz - cz)) > 0;
            const laneR = ts * 0.5 + (onPivotSide ? -lane : lane);
            const a0 = Math.atan2(cz + inStep[1] * ts * 0.5 - pz, cx + inStep[0] * ts * 0.5 - px);
            let sweep = Math.atan2(cz + az * ts * 0.5 - pz, cx + ax * ts * 0.5 - px) - a0;
            while (sweep >  Math.PI) sweep -= Math.PI * 2;
            while (sweep < -Math.PI) sweep += Math.PI * 2;

            const STEPS = 4;
            let prevX = px + laneR * Math.cos(a0), prevZ = pz + laneR * Math.sin(a0);
            for (let i = 1; i <= STEPS; i++) {
                const a = a0 + sweep * (i / STEPS);
                const x = px + laneR * Math.cos(a), z = pz + laneR * Math.sin(a);
                const dx = x - prevX, dz = z - prevZ;
                const len = Math.hypot(dx, dz) || 1;
                this._wps.push({ x, z, ax: dx / len, az: dz / len });
                prevX = x; prevZ = z;
            }
        }

        // Plan one more tile past the end of the route, choosing at random when
        // the junction offers more than one way on.
        _extend() {
            const next = this._exitTile;
            if (!next || !isRoadTile(next.x, next.y)) return false;
            let exits = roadExitsFrom(next.x, next.y, next.from);
            // Dead end: the only way on is back the way we came.
            if (!exits.length) exits = [next.from];
            const side = exits[Math.floor(Math.random() * exits.length)];
            this._pushLeg(next.x, next.y, next.from, side);
            return true;
        }

        // ---- driving --------------------------------------------------------

        update(delta) {
            const s = this._scene;
            while (this._wps.length < AUTO_LOOKAHEAD) {
                if (!this._extend()) break;
            }
            // Drop waypoints that have been reached or driven past.
            while (this._wps.length > 1) {
                const wp = this._wps[0];
                const dx = wp.x - s._vanX, dz = wp.z - s._vanZ;
                const passed = (s._vanX - wp.x) * wp.ax + (s._vanZ - wp.z) * wp.az > 0;
                if (!passed && (dx * dx + dz * dz) > AUTO_REACH_DIST * AUTO_REACH_DIST) break;
                this._wps.shift();
            }
            // The route ran out (the road left the map, or the tags stop): rather
            // than circling the last waypoint, start again somewhere else.
            if (this._wps.length === 1) {
                const last = this._wps[0];
                const done = (s._vanX - last.x) * last.ax + (s._vanZ - last.z) * last.az > 0;
                if (done && !this._extend()) { this._recover(); return; }
            }
            const wp = this._wps[0];
            if (!wp) { this._recover(); return; }

            // Steer toward the waypoint: heading error straight onto the wheel.
            const dx = wp.x - s._vanX, dz = wp.z - s._vanZ;
            let err = Math.atan2(dx, dz) - s._driveAngle;
            while (err >  Math.PI) err -= Math.PI * 2;
            while (err < -Math.PI) err += Math.PI * 2;
            // Damped by how fast the camper is already turning, so the autopilot
            // settles onto the lane instead of weaving across it.
            let yawRate = 0;
            if (this._lastAngle != null && delta > 0) {
                let d = s._driveAngle - this._lastAngle;
                while (d >  Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;
                yawRate = d / delta;
            }
            this._lastAngle = s._driveAngle;
            const steer = Math.max(-1, Math.min(1, err * 2.6 - yawRate * 0.45));

            // Slow down for whatever the road does next: sum the heading changes
            // waiting over the next few waypoints (a bend's worth of arc adds up
            // to about a radian) and pick a speed to take them at.
            let bend = Math.abs(err) * 0.5;
            const scan = Math.min(4, this._wps.length);
            for (let i = 0; i + 1 < scan; i++) {
                bend += Math.abs(this._angleBetween(this._wps[i], this._wps[i + 1]));
            }
            const targetKmh = bend > 1.4 ? AUTO_TURN_KMH
                            : bend > 0.5 ? AUTO_BEND_KMH
                            : AUTO_CRUISE_KMH;
            const v = s._speedKmh || 0;
            this.controls.steer    = steer;
            this.controls.throttle = v < targetKmh ? Math.min(1, 0.3 + (targetKmh - v) / 14) : 0;
            this.controls.brake    = v > targetKmh * 1.3;

            this._watchdog(delta, v);
        }

        // Heading change from the leg into `a` to the leg into `b`, in radians.
        _angleBetween(a, b) {
            let d = Math.atan2(b.ax, b.az) - Math.atan2(a.ax, a.az);
            while (d >  Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            return d;
        }

        // Off the asphalt or wedged against something for too long: pick a fresh
        // stretch of road elsewhere in the world rather than grinding in place.
        _watchdog(delta, kmh) {
            const s  = this._scene;
            const tx = Math.floor(s._vanX / WORLD_TILE_SIZE);
            const ty = Math.floor(s._vanZ / WORLD_TILE_SIZE);
            this._lostTime  = isRoadTile(tx, ty) ? 0 : this._lostTime + delta;
            this._stallTime = kmh > 4 ? 0 : this._stallTime + delta;
            if (this._lostTime > AUTO_LOST_TIME || this._stallTime > AUTO_STALL_TIME) this._recover();
        }

        // Drop the camper back onto a random road tile, stopped and level.
        _recover() {
            const s    = this._scene;
            const tile = pickRandomRoadTile();
            if (!tile) return;
            this._lostTime = 0;
            this._stallTime = 0;
            this._lastAngle = null;
            s._vanX = tile.x * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;
            s._vanZ = tile.y * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;
            s._velX = 0; s._velZ = 0;
            s._fwdSpeed = 0; s._latSpeed = 0;
            s._speedKmh = 0; s._speedUnitsSigned = 0; s._steerSmooth = 0;
            s._groundPitch = 0; s._groundRoll = 0;
            this._plan(tile.x, tile.y);
            s._van.group.rotation.x = 0;
            s._van.group.rotation.z = 0;
            s._van.group.rotation.y = s._driveAngle;
            // Spread the new neighbourhood's build over the next frames: the
            // ground height comes from the biome data, not from the meshes, so
            // the camper is on solid ground before the chunks catch up.
            s._terrain.update(s._vanX, s._vanZ);
            s._vanY = s._resolveEnv();
            s._van.group.position.set(s._vanX, s._vanY, s._vanZ);
        }
    }

    // =========================================================================
    // CamperDrivingScene
    // =========================================================================
    // =========================================================================
    // The weapon in the driver's hands.
    //
    // Whatever the party leader has equipped, drawn by the layer a battle draws
    // a first-person weapon with: Sprite_3DWeapon over the shared
    // WeaponThreeScene overlay (Weapon3DOverlay.js), built, posed and swung by
    // WeaponSystemProcedural. It is their real equipment, so it changes when
    // they change it, and both hands show when they are dual wielding or
    // holding claws, exactly as in a fight.
    //
    // It is only in frame while the driver is WALKING ('foot'). In the cabin,
    // at the wheel and in every camera mode it is put away: hands are on the
    // wheel, and a weapon hanging in front of a driving view reads as a bug.
    // =========================================================================
    const CamperWeapon = {
        _right: null,
        _left: null,
        _held: false,
        _visible: false,

        available() {
            return !!(window.THREE && window.Sprite_3DWeapon && window.WeaponThreeScene &&
                      window.WeaponSystemProcedural);
        },

        /** Raise the overlay for the whole drive. */
        begin() {
            if (this._held || !this.available()) return;
            // One reference for the drive: swapping a weapon must never take the
            // count to zero, since each of those destroys and rebuilds a WebGL
            // context and the browser force-loses the oldest one it has.
            window.WeaponThreeScene.ref();
            this._held = true;
            this._onMouseDown = this._onMouseDown || ((e) => {
                if (!CamperDrivingSystem.isActive() || e.button !== 0) return;
                if (document.pointerLockElement !== document.body) return;   // the first click only grabs the mouse
                CamperWeapon.swing();
            });
            document.addEventListener('mousedown', this._onMouseDown);
            const canvas = window.WeaponThreeScene.canvas;
            if (canvas) {
                canvas.style.zIndex = '10000';   // over the drive overlay's 9999
                // Put away until the driver is out of the van. The canvas keeps
                // whatever was last drawn into it, so starting hidden is also
                // what stops a battle's last frame hanging over the road.
                canvas.style.display = 'none';
            }
        },

        /** Only on foot: the one mode where the driver is walking about. */
        showsIn(viewMode) { return viewMode === 'foot'; },

        /**
         * Puts the leader's own weapons in frame, rebuilding only what changed.
         * An empty right hand is not empty: it holds the fist of the character's
         * archetype, the same as in battle.
         */
        refresh() {
            if (!this._held) return;
            let right = null, left = null;
            const actor = (typeof $gameParty !== 'undefined' && $gameParty) ? $gameParty.leader() : null;
            if (actor) {
                const weapons = actor.weapons();
                right = weapons[0] || null;
                const claws = right && right.wtypeId === 10;
                if (weapons.length >= 2 || claws) left = weapons[1] || null;
                if (!right) right = WeaponSystemProcedural.unarmedWeaponFor(actor);
            }
            this._right = this._set('_right', right, false);
            this._left = this._set('_left', left, true);
        },

        _set(slot, weapon, isLeft) {
            const held = this[slot];
            if (!weapon) {
                if (held) held.terminate();
                return null;
            }
            if (held && held._weapon === weapon) return held;
            if (held) held.terminate();
            WeaponSystemProcedural.patchSprite3DWeapon();
            return new Sprite_3DWeapon(weapon, weaponScreenX(isLeft), weaponScreenY());
        },

        /** One blow at a time, out of whichever hand is holding something. */
        swing() {
            if (!this._visible) return;
            const s = this._right || this._left;
            if (!s || !s._weapon) return;
            if (s._animData || s._clipPlaying) return;
            s.playAnimation(null);
            if (this._left && this._left !== s && !this._left._animData) {
                this._left.playAnimation(null);
            }
            if (window.WeaponSounds) window.WeaponSounds.play(s._weapon);
        },

        /** Called once a frame by the drive's own loop. */
        update(viewMode, menuOpen) {
            if (!this._held) return;
            const show = !menuOpen && this.showsIn(viewMode);
            if (show !== this._visible) {
                this._visible = show;
                const canvas = window.WeaponThreeScene.canvas;
                if (canvas) canvas.style.display = show ? 'block' : 'none';
                if (show) this.refresh();
            }
            if (!show) return;
            // Cheap enough to re-read every frame, and it is the only way a
            // weapon changed in the menu turns up in the driver's hand.
            this.refresh();
            if (typeof Input !== 'undefined' && Input.isTriggered('pagedown')) this.swing();
            for (const s of [this._right, this._left]) {
                if (!s) continue;
                s._aimPoint = null;
                s.update();
            }
            window.WeaponThreeScene.render();
        },

        end() {
            if (!this._held) return;
            if (this._onMouseDown) document.removeEventListener('mousedown', this._onMouseDown);
            const canvas = window.WeaponThreeScene.canvas;
            if (canvas) { canvas.style.display = 'block'; canvas.style.zIndex = '10'; }
            for (const slot of ['_right', '_left']) {
                if (this[slot]) this[slot].terminate();
                this[slot] = null;
            }
            this._held = false;
            this._visible = false;
            // Last, so the count only reaches zero once the sprites have let go.
            window.WeaponThreeScene.deref();
        }
    };

    // Where a held weapon sits on screen, in game pixels. The same numbers the
    // battle overlay uses (Weapon3DOverlay), read off the plugin's own
    // parameters so the two never drift apart.
    function weaponScreenX(isLeft) {
        const p = PluginManager.parameters('WeaponSystem') || {};
        const wide = ($gameSystem && $gameSystem.getCurrentResolution &&
            $gameSystem.getCurrentResolution() === '16:9');
        const sx = wide ? 1.568 : 1;
        if (isLeft) return Math.round(200 * sx);
        return Math.round(Number(p.weaponSpriteX || 650) * sx) - 120;
    }
    function weaponScreenY() {
        const p = PluginManager.parameters('WeaponSystem') || {};
        const wide = ($gameSystem && $gameSystem.getCurrentResolution &&
            $gameSystem.getCurrentResolution() === '16:9');
        return Math.round(Number(p.weaponSpriteY || 450) * (wide ? 1.154 : 1));
    }

    class CamperDrivingScene {
        constructor(duration, destinationName, totalKm, fuelCost, opts) {
            const options = opts || {};
            // Title mode: the drive runs as a silent background behind the title
            // screen. No HUD, no keyboard / mouse control, no engine audio and no
            // writes back to the save; an autopilot follows the roads instead.
            this._titleMode  = !!options.titleMode;
            // Free-play drive opened from the Minigames menu: no fast travel, no
            // party position to resume from, so it starts out on the open road.
            this._standalone = !!options.standalone;
            this._duration   = duration;
            // Fuel is burned per distance travelled in _updateFuel (not from a
            // pre-planned per-trip cost), so fuelCost is kept only for reference.
            this._fuelCost   = fuelCost || 0;
            this._totalKm    = totalKm;
            this._steerAngle = 0;
            this._animId     = null;
            this._lastTime   = null;
            this._menuOpen   = false;
            this._suspended  = false;      // true while the main menu is open over the scene
            this._speedKmh   = 0;          // parked on entry; throttle or auto-travel moves it
            this._steerSmooth = 0;         // eased steering input for smoother turning
            this._tmpSky     = new THREE.Color();

            this._speed = Math.max(8, (totalKm * WORLD_TILE_SIZE / 5) / Math.max(1, duration));

            // Seed the 3D start from the camper's true world position so the 3D and
            // 2D (map 315) coordinates always agree. Priority: live player tile when
            // already on map 315, else the stored camper world tile (vars 63/64),
            // else the player-world vars (43/44). Avoids starting at a stale (0,0).
            let startWX, startWY;
            if (this._titleMode || this._standalone) {
                // Start somewhere on the world's road network, not at the party's
                // (nonexistent) position: neither the title drive nor the free-play
                // drive has a game to resume, so drop the camper on a random road
                // tile with somewhere to drive to.
                const seed = pickRandomRoadTile();
                startWX = seed ? seed.x : Math.floor(WORLD_TILES / 2);
                startWY = seed ? seed.y : Math.floor(WORLD_TILES / 2);
            } else if (typeof $gameMap !== 'undefined' && $gameMap.mapId() === WORLD_MAP_ID &&
                typeof $gamePlayer !== 'undefined') {
                startWX = $gamePlayer.x;
                startWY = $gamePlayer.y;
            } else if (window.VehiclePosition &&
                       window.VehiclePosition.mapId('camper') === WORLD_MAP_ID) {
                startWX = window.VehiclePosition.x('camper');
                startWY = window.VehiclePosition.y('camper');
            } else {
                startWX = (typeof $gameVariables !== 'undefined') ? $gameVariables.value(43) : 0;
                startWY = (typeof $gameVariables !== 'undefined') ? $gameVariables.value(44) : 0;
            }
            this._vanX      = startWX * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;
            this._vanZ      = startWY * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;

            this._driveAngle = this._computeDriveAngle(startWX, startWY);

            // Seed Perlin noise from world seed for consistent mountain shapes
            const worldSeed = (typeof $gameSystem !== 'undefined' && $gameSystem._historySeed)
                ? $gameSystem._historySeed : 19002001;
            initPerlinWithSeed(worldSeed);
            _clearBiomeCaches();   // fresh biome memo for this world / scene

            // Auto-travel destination tile (camper fast travel). The drive flies
            // straight to it; no road pathfinding is needed.
            // A free-play drive is never a journey: it stays parked where it was
            // dropped until the player drives it.
            const _ftDest = (!this._standalone && typeof $gameSystem !== 'undefined' && $gameSystem._fastTravelData)
                ? $gameSystem._fastTravelData.finalDestination : null;
            this._destWX = _ftDest ? _ftDest.x : startWX;
            this._destWY = _ftDest ? _ftDest.y : startWY;

            this._createOverlay();
            this._initThree();

            this._terrain = new WorldTerrainRenderer(this._scene);
            // A drive entered from the game builds its whole neighbourhood up
            // front (it is behind a transition anyway); the title background
            // spreads that build over the first frames instead, so opening the
            // title screen never stutters. Either way the camper's own chunk is
            // ready first, and the rest fills in behind the fade.
            this._terrain.update(this._vanX, this._vanZ, !this._titleMode);

            this._van = new VanModel(this._scene);
            this._van.group.position.set(this._vanX, 0, this._vanZ);
            // Yaw first, then terrain pitch/roll: keeps the slope alignment sane
            // at any heading (default XYZ order would twist the chassis).
            this._van.group.rotation.order = 'YXZ';
            this._van.group.rotation.y = this._driveAngle;

            // --- Vehicle physics state (bicycle model with lateral slip) ---
            this._velX = 0; this._velZ = 0;          // persistent world velocity
            this._fwdSpeed = 0; this._latSpeed = 0;  // heading-frame decomposition
            this._throttle01 = 0;                    // eased throttle input
            this._gear = 1; this._rpm = 0.12; this._shiftTimer = 0;
            this._gearLabel = 'N';
            this._slip01 = 0; this._grade = 0;
            this._surface = SURFACES.asphalt;
            this._handbrake = false; this._brakeOn = false;
            this._reverseDelay = 0;
            this._crashTimer = 0; this._crashCooldown = 0;
            this._ftRampT = 0;   // liminal-drive ramp-up elapsed (seconds, resets whenever fast travel isn't active)
            this._groundPitch = 0; this._groundRoll = 0;

            this._hud = new CamperHUD(this._overlay, destinationName, totalKm, this._titleMode);
            this._fpc = new FirstPersonController(this._camera, CAMPER_BOUNDS);
            // The title background never grabs the mouse: the player is clicking
            // the title menu, not driving.
            if (this._titleMode) this._fpc.allowPointerLock = false;
            this._van.group.add(this._fpc.getRig());
            this._setupVehicleLights();

            // Environment + physics state.
            this._env            = 'road';     // road | air | water | underwater
            this._flying         = false;      // player-toggled flight (needs 'fly' upgrade)
            this._dived          = false;      // player-toggled dive  (needs 'dive' upgrade)
            this._vanY           = 0;          // smoothed vertical position of the rig
            this._prevSpeedKmh   = 0;          // for accel-driven nose dive / squat
            this._odo            = 0;          // distance integrator for road rumble
            this._bodyRoll = 0; this._bodyPitch = 0; this._bodyBounce = 0;
            this._speedUnitsSigned = 0;

            // Ramp / airborne state: when the camper launches off a crest at speed
            // it flies a ballistic arc (vy = vertical velocity) until it lands.
            this._airborne  = false;
            this._vy        = 0;
            this._landJolt  = 0;       // suspension compression on touchdown, decays
            // Liminal boost (Shift) + speed-driven space warp.
            this._boostActive = false;
            this._warpAmount  = 0;     // smoothed space-distortion strength 0..1

            // Last solid-ground position, used to bounce the camper back onto land
            // if it drives into water without the Amphibious (float) upgrade.
            this._lastLandX = this._vanX;
            this._lastLandZ = this._vanZ;
            this._lastLandAngle = this._driveAngle;
            this._waterRescue = false;     // true while the fade-out rescue runs
            this._stuck = false;           // in water w/o traversal, flipped, or wedged
            this._stuckReason = '';        // label shown in the respawn prompt
            this._wedgeTimer = 0;          // accumulates while throttling but not moving

            // Sandbox / "Test" save starts with every modular upgrade unlocked,
            // so testing the drive scene is never blocked by locked features.
            if (!this._titleMode && isSandboxOrTest() && typeof $gameSystem !== 'undefined') {
                $gameSystem._camperUpgrades = Object.assign(
                    $gameSystem._camperUpgrades || {}, { fly: true, float: true, dive: true }
                );
            }

            // Always begin a drive with a full tank. The camper's fuel level could
            // be 0 (fresh save), a stale low value left by an up-front fast-travel
            // deduction, or a non-finite value from an earlier glitch - any of
            // which stranded the camper "out of fuel" within a few metres. Burn is
            // distance-based and minuscule, so a full tank on entry means driving is
            // never gated by fuel; refuel mechanics still apply to fast-travel cost.
            // (Skipped in title mode: the background drive never touches the save.)
            if (!this._titleMode) {
                const tank = camperFuelGet();
                const max  = camperMaxFuel();
                if (!(tank > 0) || tank < max) {
                    camperFuelSet(max);
                }
            }

            this._zoomDist       = 0;
            this._freeCamActive  = false;
            this._freePivot      = new THREE.Vector3(this._vanX, 0, this._vanZ);
            this._freeMoveKeys   = new Set();

            // --- New Orbit Camera State ---
            this._freeCamDrag    = false;
            this._freeCamYaw     = 0;
            this._freeCamPitch   = 0.8; // Approx 45 degrees looking down

            this._onWheel            = this._onWheel.bind(this);
            this._onFreeCamKeyDown   = (e) => { if (CamperDrivingSystem.isActive()) this._freeMoveKeys.add(e.code); };
            this._onFreeCamKeyUp     = (e) => { this._freeMoveKeys.delete(e.code); };
            
            // --- New Mouse Handlers ---
            this._onFreeCamMouseDown = this._onFreeCamMouseDown.bind(this);
            this._onFreeCamMouseUp   = this._onFreeCamMouseUp.bind(this);
            this._onFreeCamMouseMove = this._onFreeCamMouseMove.bind(this);

            // Every control listener below is skipped in title mode: the title
            // screen owns the keyboard and the mouse there.
            if (!this._titleMode) {
                document.addEventListener('wheel',     this._onWheel, { passive: true });
                document.addEventListener('keydown',   this._onFreeCamKeyDown);
                document.addEventListener('keyup',     this._onFreeCamKeyUp);
                document.addEventListener('mousedown', this._onFreeCamMouseDown);
                document.addEventListener('mouseup',   this._onFreeCamMouseUp);
                document.addEventListener('mousemove', this._onFreeCamMouseMove);
            }

            // Atmospherics + living world. The title background skips the engine
            // audio (the title theme is playing) and the roaming battlers (they
            // load 3D models the title has no use for).
            this._weatherFx    = new WeatherParticles(this._scene);
            this._water        = new WaterPlane(this._scene);
            this._traffic      = new TrafficManager(this._scene, this._titleMode);
            this._underwaterFx = new UnderwaterFx(this._scene);
            this._skyFx        = new SkyFx(this._scene);
            this._wheelFx      = new WheelFx(this._scene);
            this._bioEnemies   = this._titleMode ? null : new BiomeEnemyManager(this._scene, this._terrain);
            this._engine       = this._titleMode ? null : new EngineAudio();
            this._liminal      = new LiminalFx(this._scene, this._overlay);
            this._liminalI     = 0;   // smoothed cosmic-horror intensity 0..1
            this._speedFx      = new SpeedWarpFx();
            this._warpCentre   = new THREE.Vector3();

            this._viewMode = 'fp'; // 'fpdrive' | 'fp' | 'car' | 'free' | 'foot'

            if (!this._titleMode) {
                // ESC / back leaves the drive immediately, dropping the player back
                // onto map 315 at the tile reached. The full options menu (stop driving,
                // step outside, etc.) lives on the OK / confirm button instead.
                this._onEscKey = (e) => {
                    if (e.code === 'Escape' && CamperDrivingSystem.isActive()) {
                        this._requestExit();
                    }
                };
                document.addEventListener('keydown', this._onEscKey);

                this._onTabKey = (e) => {
                    if (e.code === 'Tab' && CamperDrivingSystem.isActive()) {
                        e.preventDefault();
                        if (this._menuOpen || this._suspended || this._stationRefuelWatch) return;
                        this._cycleViewMode();
                    }
                };
                document.addEventListener('keydown', this._onTabKey);

                // M cycles the minimap view modes (full overview -> zoomed -> hidden),
                // mirroring WorldMap.js's M-key cycle on the world map (315).
                this._onMapKey = (e) => {
                    if (this._menuOpen || this._suspended || this._stationRefuelWatch) return;
                    if (e.code === 'KeyM' && CamperDrivingSystem.isActive() && this._hud) {
                        const mode = this._hud.cycleMapMode();
                        this._hud._drawMiniMap(this._vanX, this._vanZ);
                        if (typeof SoundManager !== 'undefined') SoundManager.playCursor();
                        void mode;
                    }
                };
                document.addEventListener('keydown', this._onMapKey);

                // F = toggle flight, C = toggle dive, E = interact (sit / doors /
                // grab the wheel) when on foot in first person.
                this._onActionKey = (e) => {
                    if (!CamperDrivingSystem.isActive()) return;
                    if (this._menuOpen || this._suspended || this._stationRefuelWatch) return;
                    if (e.code === 'KeyF')      this._toggleFlight();
                    else if (e.code === 'KeyC') this._toggleDive();
                    else if (e.code === 'KeyE') this._interact();
                    else if (e.code === 'KeyR') this._respawnCamper();
                };
                document.addEventListener('keydown', this._onActionKey);
            }

            // What the leader has in their hands, drawn over the drive.
            if (!this._titleMode) CamperWeapon.begin();

            if (this._titleMode) {
                // A different hour every time the title is opened: mostly
                // daylight, sometimes dawn / dusk / a night drive.
                const hour = Math.random() < 0.75 ? 7 + Math.random() * 13 : Math.random() * 24;
                this._titleMinuteOffset = Math.round(hour * 60 - 600 + 24 * 60);
                // Title background: the eye sits at the wheel and an autopilot
                // takes the camper down the world's roads on its own.
                this._setMode('fpdrive');
                this._autopilot = new RoadAutopilot(this, startWX, startWY);
                this._van.group.rotation.y = this._driveAngle;
                this._bindTitleLook();
            } else {
                // Always open in the third-person chase camera ('car'): it sits behind
                // and slightly above the camper, looking forward along the direction of
                // travel (up = +Y, never inverted). First-person driving (eye at the
                // wheel) is reachable from there via TAB (or gamepad Y), which toggles
                // car <-> fpdrive only.
                this._setMode('car');
            }

            this._loop = this._loop.bind(this);
            this._animId = requestAnimationFrame(this._loop);
        }

        _onWheel(e) {
            if (!CamperDrivingSystem.isActive()) return;
            const dir  = e.deltaY > 0 ? 1 : -1;
            const step = Math.max(150, this._zoomDist * 0.15 + 150);
            this._zoomDist = Math.max(0, Math.min(ZOOM_MAX, this._zoomDist + dir * step));
        }
        
        _onFreeCamMouseDown(e) {
            if ((this._freeCamActive || this._viewMode === 'car') && e.button === 1) {
                this._freeCamDrag = true;
            }
        }

        _onFreeCamMouseUp(e) {
            if (e.button === 1) {
                this._freeCamDrag = false;
            }
        }

        _onFreeCamMouseMove(e) {
            if (this._freeCamDrag && (this._freeCamActive || this._viewMode === 'car')) {
                const mx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
                const my = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
                this._freeCamYaw -= mx * 0.005;
                this._freeCamPitch += my * 0.005;
                this._freeCamPitch = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this._freeCamPitch));
            }
        }
        
        _isFastTravelActive() {
            if (this._titleMode) return false;   // the title drive is never a journey
            if (typeof $gameSystem === 'undefined' || !$gameSystem.getFastTravelData) return false;
            const d = $gameSystem.getFastTravelData();
            return !!(d && d.timerActive && d.timerTransport === 'camper' && d.timerRemainingTime > 0);
        }

        // Accelerate ("turbo") button. The 'shift' symbol maps to keyboard Shift
        // and gamepad X by default, so this works on controller too.
        _isAcceleratePressed() {
            return typeof Input !== 'undefined' && Input.isPressed('shift');
        }

        _setMode(mode) {
            const prev = this._viewMode;
            if (prev === mode) return;
            this._viewMode = mode;
            this._freeCamActive = (mode === 'free');

            // Teardown previous mode. 'fp' (cabin), 'fpdrive' (driver seat) and
            // 'foot' (outside) share the first-person rig, so all three detach the
            // camera the same way.
            if (prev === 'fp' || prev === 'fpdrive' || prev === 'foot') {
                this._fpc.pitch.remove(this._camera);
                this._scene.add(this._camera);
                this._fpc.deactivated = true;
                if (document.pointerLockElement === document.body) document.exitPointerLock();
            }
            // Leaving the driver seat: re-enable cabin walking.
            if (prev === 'fpdrive') this._fpc.setDriving(false);
            // Leaving on-foot: re-stow the rig back inside the camper (every mode
            // change away from 'foot' puts the player back in the cabin) and shut
            // the door; proximity (see _updateDoorAutoOpen) keeps it that way once
            // the player has stepped back from it.
            if (prev === 'foot') {
                this._fpc.setWorldMode(false);
                this._attachRigToVan();
                if (this._van.setDoorOpen) this._van.setDoorOpen(false);
            }

            // Setup new mode. The single camper (this._van) is always visible;
            // in first person the camera simply sits inside it.
            if (mode === 'fp') {
                this._attachRigToVan();
                this._scene.remove(this._camera);
                this._camera.position.set(0, 0, 0);
                this._camera.rotation.set(0, 0, 0);
                this._fpc.pitch.add(this._camera);
                this._fpc.deactivated = false;
                this._camera.far = 3000 * WORLD_SCALE;
                this._camera.fov = this._baseFov;
                this._camera.updateProjectionMatrix();
                this._scene.fog.density = FOG_DAY;
                this._terrain._radius = 5;
                this._terrain.setLodMode(false);
            } else if (mode === 'fpdrive') {
                // First-person driving: eye pinned at the driver's seat, looking
                // forward through the windshield. The rig rides inside the van
                // (local space) and the WASD keys drive instead of walking.
                this._attachRigToVan();
                const rig = this._fpc.getRig();
                rig.position.set(DRIVER_SEAT.x, DRIVER_SEAT.y, DRIVER_SEAT.z);
                this._fpc.yaw.rotation.y   = Math.PI; // face the camper's forward (+Z)
                this._fpc.pitch.rotation.x = 0;
                this._fpc.setDriving(true);
                this._scene.remove(this._camera);
                this._camera.position.set(0, 0, 0);
                this._camera.rotation.set(0, 0, 0);
                this._fpc.pitch.add(this._camera);
                this._fpc.deactivated = false;
                this._camera.far = 3000 * WORLD_SCALE;
                this._camera.fov = this._baseFov;
                this._camera.updateProjectionMatrix();
                this._scene.fog.density = FOG_DAY;
                this._terrain._radius = 5;
                this._terrain.setLodMode(false);
            } else if (mode === 'foot') {
                this._enterOnFoot();
                this._scene.remove(this._camera);
                this._camera.position.set(0, 0, 0);
                this._camera.rotation.set(0, 0, 0);
                this._fpc.pitch.add(this._camera);
                this._fpc.deactivated = false;
                this._camera.far = 3000 * WORLD_SCALE;
                this._camera.fov = this._baseFov;
                this._camera.updateProjectionMatrix();
                this._scene.fog.density = FOG_DAY;
                this._terrain._radius = 5;
                this._terrain.setLodMode(false);
            } else if (mode === 'car') {
                this._freeCamYaw   = 0;
                this._freeCamPitch = 0.34;
                // Keep the camera world-up so lookAt never rolls the view (the
                // chase cam could otherwise spawn upside down).
                this._camera.up.set(0, 1, 0);
                const _yaw  = this._van.group.rotation.y + Math.PI;
                const _dist = 42;
                this._camera.position.set(
                    this._vanX + _dist * Math.cos(0.34) * Math.sin(_yaw),
                    this._vanY + _dist * Math.sin(0.34),
                    this._vanZ + _dist * Math.cos(0.34) * Math.cos(_yaw)
                );
                this._camera.lookAt(this._vanX, this._vanY + 4, this._vanZ);
                this._camera.far = 3000 * WORLD_SCALE;
                this._camera.updateProjectionMatrix();
                this._scene.fog.density = FOG_DAY;
                this._terrain._radius = 5;
                this._terrain.setLodMode(false);
            } else if (mode === 'free') {
                this._freePivot.set(this._vanX, 0, this._vanZ);
                this._freeCamYaw   = 0;
                this._freeCamPitch = 0.8;
                this._camera.fov = this._baseFov;
                this._camera.position.set(this._vanX, 400, this._vanZ + 400);
                this._camera.lookAt(this._vanX, 0, this._vanZ);
                this._scene.fog.density = FOG_FREE;
            }

            this._hud.updateModeLabel(mode);
        }

        // Re-parent the first-person rig back inside the camper (local space).
        _attachRigToVan() {
            const rig = this._fpc.getRig();
            if (rig.parent !== this._van.group) {
                if (rig.parent) rig.parent.remove(rig);
                this._van.group.add(rig);
            }
            rig.position.set(0, 6, 0);
        }

        // Step out of the camper onto the world: park the rig, detach it into world
        // space beside the door, tether it to the parked camper, and open the door.
        _enterOnFoot() {
            // Park: kill all camper motion and any pending fast travel.
            this._speedKmh = 0;
            this._speedUnitsSigned = 0;
            this._steerSmooth = 0;
            this._velX = 0; this._velZ = 0;
            this._fwdSpeed = 0; this._latSpeed = 0;
            const d = (typeof $gameSystem !== 'undefined' && $gameSystem.getFastTravelData)
                ? $gameSystem.getFastTravelData() : null;
            if (d) d.timerActive = false;

            // Spawn just off the camper's side, on the ground.
            const ry  = this._van.group.rotation.y;
            const off = 30;
            const sx  = this._vanX + Math.cos(ry) * off;
            const sz  = this._vanZ - Math.sin(ry) * off;
            const groundFn = (x, z) =>
                this._terrain.getTerrainHeight(x / WORLD_TILE_SIZE, z / WORLD_TILE_SIZE);
            const sy = groundFn(sx, sz) + FOOT_EYE;

            const rig = this._fpc.getRig();
            if (rig.parent !== this._scene) {
                if (rig.parent) rig.parent.remove(rig);
                this._scene.add(rig);
            }
            rig.position.set(sx, sy, sz);
            this._fpc.setWorldMode(true,
                { x: this._vanX, z: this._vanZ, angle: this._van.group.rotation.y }, groundFn);

            // Open the door for the dismount; proximity (_updateDoorAutoOpen) takes
            // over on the very next frame and keeps it open while standing near it.
            if (this._van.setDoorOpen) this._van.setDoorOpen(true);
        }

        // Swing the rear door open whenever the player (on foot outside, or
        // walking the cabin toward it) is close enough, and shut otherwise. Runs
        // every frame in first-person cabin/foot modes, so there is no explicit
        // "open" or "close" command left for the player to press.
        _updateDoorAutoOpen() {
            if (this._viewMode !== 'fp' && this._viewMode !== 'foot') return;
            if (!this._van.getDoorWorldPosition) return;
            const doorPos = this._van.getDoorWorldPosition(this._tmpDoorPos || (this._tmpDoorPos = new THREE.Vector3()));
            if (!doorPos) return;
            const rig = this._fpc.getRig();
            const p = this._tmpRigPos || (this._tmpRigPos = new THREE.Vector3());
            rig.getWorldPosition(p);
            const dx = p.x - doorPos.x, dy = p.y - doorPos.y, dz = p.z - doorPos.z;
            const near = (dx * dx + dy * dy + dz * dz) <= DOOR_AUTO_OPEN_RANGE * DOOR_AUTO_OPEN_RANGE;
            this._van.setDoorOpen(near);
        }

        _cycleViewMode() {
            // Tab toggles between first-person driving (eye at the wheel) and the
            // third-person chase camera only. The free-roam cabin walk and the
            // detached free camera are reached other ways (E / interact, door),
            // not by cycling. Changing mode while on foot always climbs back
            // into the cabin.
            if (this._viewMode === 'foot') { this._setMode('fp'); return; }
            const order = ['fpdrive', 'car'];
            const cur = order.indexOf(this._viewMode);
            const idx = cur < 0 ? 0 : (cur + 1) % order.length;
            this._setMode(order[idx]);
        }

        // Toggle player-controlled flight. Needs the 'fly' upgrade; switches
        // straight to the chase camera so you can see the lift rotors deploy.
        _toggleFlight() {
            if (this._viewMode === 'foot') { if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer(); return; }
            if (!camperCan('fly')) { if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer(); return; }
            this._flying = !this._flying;
            if (this._flying) { this._dived = false; if (this._viewMode === 'fp') this._setMode('car'); }
            if (typeof SoundManager !== 'undefined') SoundManager.playOk();
        }

        // Toggle diving. Only meaningful while over a water basin; needs 'dive'.
        _toggleDive() {
            if (this._viewMode === 'foot') { if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer(); return; }
            if (!camperCan('dive')) { if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer(); return; }
            if (!this._overWater()) { if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer(); return; }
            this._dived = !this._dived;
            if (this._dived) { this._flying = false; if (this._viewMode === 'fp') this._setMode('car'); }
            if (typeof SoundManager !== 'undefined') SoundManager.playOk();
        }

        // First-person interaction (E / gamepad). On foot, walk up to the camper
        // and interact to climb back in. In the cabin, interacting with a door
        // steps you outside; the wheel/driver seat grabs the wheel; other seats sit.
        // At the wheel (third-person 'car' or seated 'fpdrive'), E gets you away
        // from driving without going through the options menu: third-person
        // steps straight out onto the ground, first-person just lets go of the
        // wheel and leaves you standing in the cabin so you can walk to the door.
        _interact() {
            // On foot: climb back into the camper when close enough.
            if (this._viewMode === 'foot') {
                const rig = this._fpc.getRig();
                const dx = rig.position.x - this._vanX;
                const dz = rig.position.z - this._vanZ;
                if ((dx * dx + dz * dz) <= 60 * 60) {
                    if (typeof SoundManager !== 'undefined') SoundManager.playOk();
                    this._setMode('fp');
                } else if (typeof SoundManager !== 'undefined') {
                    SoundManager.playBuzzer();
                }
                return;
            }

            // Third-person chase camera: step straight out of the camper.
            if (this._viewMode === 'car') {
                if (typeof SoundManager !== 'undefined') SoundManager.playOk();
                this._setMode('foot');
                return;
            }

            // Seated first-person driving: let go of the wheel and stand up in
            // the cabin (still parked at the driver's seat), rather than
            // stepping outside directly.
            if (this._viewMode === 'fpdrive') {
                if (typeof SoundManager !== 'undefined') SoundManager.playOk();
                this._setMode('fp');
                return;
            }

            if (this._viewMode !== 'fp' || !this._van.getInteractables) return;
            const rig = this._fpc.getRig();
            const here = rig.position;
            let best = null, bestD = 30 * 30; // within ~30 units
            for (const it of this._van.getInteractables()) {
                const dx = it.pos.x - here.x, dz = it.pos.z - here.z;
                const d = dx * dx + dz * dz;
                if (d < bestD) { best = it; bestD = d; }
            }
            if (!best) return;
            if (typeof SoundManager !== 'undefined') SoundManager.playOk();
            if (best.kind === 'door') {
                this._setMode('foot');        // step out through the door
            } else if (best.kind === 'wheel' || (best.kind === 'seat' && best.name === 'Driver')) {  // i18n-ignore  seat id
                this._setMode('car');         // take the wheel
            } else if (best.kind === 'seat') {
                rig.position.set(best.pos.x, best.pos.y, best.pos.z); // sit
            }
        }

        _updateCarCamera(delta) {
            // Orbit around van using same spherical state as free cam (mid-click drag to rotate)
            // Scroll wheel / right stick adjust _zoomDist for a wide zoom range while driving.
            const dist = Math.max(22, 42 + this._zoomDist * 0.05);
            const cy   = this._vanY + Math.max(5, dist * Math.sin(this._freeCamPitch));
            const gr   = dist * Math.cos(this._freeCamPitch);
            const yaw  = this._van.group.rotation.y + Math.PI + this._freeCamYaw;
            const tx   = this._vanX + gr * Math.sin(yaw);
            const tz   = this._vanZ + gr * Math.cos(yaw);

            this._camera.position.x += (tx - this._camera.position.x) * 6 * delta;
            this._camera.position.y += (cy - this._camera.position.y) * 6 * delta;
            this._camera.position.z += (tz - this._camera.position.z) * 6 * delta;

            // Sense of speed: widen FOV and shake the camera as you go faster.
            const targetFov = this._baseFov + Math.min(28, this._speedKmh * 0.012);
            this._camera.fov += (targetFov - this._camera.fov) * Math.min(1, delta * 4);
            let shake = Math.max(0, this._speedKmh - 480) * 0.0007;
            if (this._crashTimer > 0) shake += this._crashTimer * 0.5;   // collision rattle
            if (shake > 0) {
                this._camera.position.x += (Math.random() - 0.5) * shake * 10;
                this._camera.position.y += (Math.random() - 0.5) * shake * 10;
            }
            this._camera.updateProjectionMatrix();
            this._camera.up.set(0, 1, 0);
            this._camera.lookAt(this._vanX, this._vanY + 4, this._vanZ);

            this._terrain.update(this._vanX, this._vanZ);
        }

        // Legacy thin wrappers kept for any external callers
        _enterFreeCam() { this._setMode('free'); }
        _exitFreeCam()  { this._setMode('fp');   }

        _updateFreeCam(delta) {
            const fast      = this._freeMoveKeys.has('ShiftLeft') || this._freeMoveKeys.has('ShiftRight');
            const baseSpeed = 300 + this._zoomDist * 0.35;
            const speed     = fast ? baseSpeed * 5 : baseSpeed;

            // 1. Calculate raw input direction (WASD, arrows, or controller)
            let moveX = 0;
            let moveZ = 0;
            if (this._freeMoveKeys.has('KeyW') || Input.isPressed('up'))    moveZ -= 1;
            if (this._freeMoveKeys.has('KeyS') || Input.isPressed('down'))  moveZ += 1;
            if (this._freeMoveKeys.has('KeyA') || Input.isPressed('left'))  moveX -= 1;
            if (this._freeMoveKeys.has('KeyD') || Input.isPressed('right')) moveX += 1;

            // 2. Rotate movement vector by current camera yaw
            if (moveX !== 0 || moveZ !== 0) {
                const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
                moveX /= len;
                moveZ /= len;

                const cos = Math.cos(this._freeCamYaw);
                const sin = Math.sin(this._freeCamYaw);

                const worldX = moveX * cos + moveZ * sin;
                const worldZ = -moveX * sin + moveZ * cos;

                this._freePivot.x += worldX * speed * delta;
                this._freePivot.z += worldZ * speed * delta;
            }

            // 3. Position camera using spherical coordinates around the pivot
            const radius = Math.max(100, this._zoomDist);
            const cy = radius * Math.sin(this._freeCamPitch);
            const groundDist = radius * Math.cos(this._freeCamPitch);
            const cx = groundDist * Math.sin(this._freeCamYaw);
            const cz = groundDist * Math.cos(this._freeCamYaw);

            this._camera.position.set(
                this._freePivot.x + cx,
                cy,
                this._freePivot.z + cz
            );
            this._camera.lookAt(this._freePivot.x, 0, this._freePivot.z);

            const newFar = Math.max(3000 * WORLD_SCALE, this._zoomDist * 3);
            if (Math.abs(this._camera.far - newFar) > 100) {
                this._camera.far = newFar;
                this._camera.updateProjectionMatrix();
            }
            this._scene.fog.density = FOG_FREE;

            const visRadius = Math.ceil(this._zoomDist * 0.82 * 0.637 / WORLD_TILE_SIZE) + 3;
            this._terrain._radius = Math.min(60, visRadius);
            this._terrain.setLodMode(this._terrain._radius > 10);
            // Fill the overview over several frames (budgeted) instead of building
            // the whole visible radius every frame, which froze the free cam.
            this._terrain.update(this._freePivot.x, this._freePivot.z, false);
        }

        // True when the camper's current tile is a water basin.
        _overWater() {
            const tx = Math.floor(this._vanX / WORLD_TILE_SIZE);
            const ty = Math.floor(this._vanZ / WORLD_TILE_SIZE);
            return getRenderType(sampleBiomeAt(tx, ty).name) === 'water';
        }

        // True when the camper is (near-)stopped on a city / village tile, which
        // carry a fuel station (see ProceduralDecorator._decorateGasStation). The
        // drive options menu offers a refuel here.
        _atGasStation() {
            if (this._speedKmh > 6 || this._env !== 'road') return false;
            const tx = Math.floor(this._vanX / WORLD_TILE_SIZE);
            const ty = Math.floor(this._vanZ / WORLD_TILE_SIZE);
            const n  = sampleBiomeAt(tx, ty).name.toLowerCase();
            return /city|metro|village|villa|burg|town|houses/.test(n);
        }

        // Average condition (0-100) of the camper's parts from the repair plugin's
        // per-part health store, or null when that plugin is absent (HUD hides the
        // readout). Critical parts weigh double so engine/brake damage reads worse.
        _camperCondition() {
            const store = (typeof $gameSystem !== 'undefined') ? $gameSystem._vehicleHealth : null;
            const parts = store && store.camper;
            if (!parts) return null;
            let sum = 0, n = 0;
            for (const k in parts) {
                const w = CRITICAL_PARTS.indexOf(k) >= 0 ? 2 : 1;
                sum += parts[k] * w; n += w;
            }
            return n ? sum / n : null;
        }

        // ---- Title-screen free look ----------------------------------------
        // Dragging (or the right stick) looks around the cab while the autopilot
        // drives. The view eases back to the road once the player lets go. The
        // seated first-person rig is otherwise untouched, so writing its yaw /
        // pitch here is safe.
        _bindTitleLook() {
            const L = this._titleLook = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0, lastInput: 0 };
            // The title menu and its buttons must not count as the road view, or
            // every click on a command would swing the camera.
            const onUI = (t) => !!(t && t.closest &&
                t.closest('.ts-menu-overlay, #title-bg-switch, #title-autodrive-info'));
            this._onTitleLookDown = (e) => {
                if (e.button !== undefined && e.button !== 0 && e.button !== 2) return;
                if (onUI(e.target)) return;
                L.dragging = true; L.lastX = e.clientX; L.lastY = e.clientY;
            };
            this._onTitleLookMove = (e) => {
                if (!L.dragging) return;
                const dx = e.clientX - L.lastX, dy = e.clientY - L.lastY;
                L.lastX = e.clientX; L.lastY = e.clientY;
                this._panTitleLook(-dx * 0.004, dy * 0.003);
            };
            this._onTitleLookUp = () => { L.dragging = false; };
            document.addEventListener('pointerdown',   this._onTitleLookDown);
            document.addEventListener('pointermove',   this._onTitleLookMove);
            document.addEventListener('pointerup',     this._onTitleLookUp);
            document.addEventListener('pointercancel', this._onTitleLookUp);
        }

        _panTitleLook(dyaw, dpitch) {
            const L = this._titleLook;
            if (!L || (!dyaw && !dpitch)) return;
            L.yaw   = Math.max(-1.6, Math.min(1.6, L.yaw + dyaw));
            L.pitch = Math.max(-0.6, Math.min(0.8, L.pitch + dpitch));
            L.lastInput = performance.now();
        }

        _updateTitleLook(delta) {
            const L = this._titleLook;
            if (!L) return;
            const A = window.AnalogStickInput;
            if (A && A.rightX && A.rightY) {
                const rx = A.rightX(), ry = A.rightY();
                if (rx || ry) this._panTitleLook(-rx * 0.045, ry * 0.03);
            }
            if (!L.dragging && performance.now() - L.lastInput > 4000) {
                const k = Math.min(1, delta * 1.2);
                L.yaw -= L.yaw * k;
                L.pitch -= L.pitch * k;
            }
            this._fpc.yaw.rotation.y   = Math.PI + L.yaw;
            this._fpc.pitch.rotation.x = L.pitch;
        }

        // Where the camper is and how fast it is going, for the title screen's
        // little autopilot readout. The place / road lookup is cached per tile.
        getTitleInfo() {
            const tx = Math.floor(this._vanX / WORLD_TILE_SIZE);
            const ty = Math.floor(this._vanZ / WORLD_TILE_SIZE);
            const key = tx + ',' + ty;
            let cache = this._titleInfoCache;
            if (!cache || cache.key !== key) {
                cache = this._titleInfoCache = {
                    key,
                    place: placeNameAt(tx, ty),
                    road:  roadLabelAt(tx, ty)
                };
            }
            // _driveAngle is atan2(dx, dz) and +z runs south on the world map,
            // so angle 0 points south and grows toward the east.
            const COMPASS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
            const idx = ((Math.round(this._driveAngle / (Math.PI / 4)) % 8) + 8) % 8;
            return {
                place:   cache.place,
                road:    cache.road,
                heading: COMPASS[idx],
                kmh:     Math.round(this._speedKmh || 0),
                tileX:   tx,
                tileY:   ty
            };
        }

        // Decide the active environment from auto-travel / upgrades / terrain /
        // player toggles, and return the target ride height (world Y). The camper
        // follows the terrain on the ground (so it climbs the tall mountains) and
        // clears them when flying.
        _resolveEnv() {
            const terrainH = this._terrain.getTerrainHeight(this._vanX / WORLD_TILE_SIZE, this._vanZ / WORLD_TILE_SIZE);
            const flyY = Math.max(170 * WORLD_SCALE, terrainH + 120 * WORLD_SCALE);

            // Auto travel (fast travel from the map window) always flies.
            if (this._isFastTravelActive()) {
                this._env = 'air';
                this._van.setEnv('air');
                return flyY;
            }

            const overWater = this._overWater();
            let env, targetY;
            if (this._flying && camperCan('fly')) {
                env = 'air';        targetY = flyY;
            } else if (overWater) {
                // Water crossing is always allowed WHILE in the drive mode, even
                // without the Amphibious upgrade - the penalty comes when the mode
                // ends over water (see _endDriveToWorldMap: the camper splashes down
                // if the player lacks the float upgrade). Diving still needs 'dive'.
                // The camper is 1x and floats on the 1x sea surface (the water plane
                // sits at y≈-0.6), so these ride heights stay at their real scale
                // even though the seabed basin is dug WORLD_SCALE times deeper.
                if (this._dived && camperCan('dive')) { env = 'underwater'; targetY = -50; }
                else                                  { env = 'water';      targetY = -4; }
            } else {
                env = 'road';       targetY = terrainH;   // ride the ground / climb hills
                this._dived = false;
            }
            this._env = env;
            this._van.setEnv(env);
            return targetY;
        }

        // Black fade overlay used by the no-float water rescue.
        _ensureFadeEl() {
            if (this._fadeEl) return this._fadeEl;
            const el = document.createElement('div');
            el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;' +
                'background:#000;opacity:0;pointer-events:none;z-index:10002;' +
                'transition:opacity 0.4s ease;';
            this._overlay.appendChild(el);
            this._fadeEl = el;
            return el;
        }

        _fade(to, cb) {
            const el = this._ensureFadeEl();
            // Force a reflow so the transition runs even on the first call.
            void el.offsetWidth;
            el.style.opacity = String(to);
            if (this._fadeTimer) clearTimeout(this._fadeTimer);
            this._fadeTimer = setTimeout(() => { this._fadeTimer = null; if (cb) cb(); }, 430);
        }

        // Spiral-search outward from (tx,ty) for the closest in-bounds tile that
        // is NOT a water biome (ocean / sea / lake / river / flooded). Returns
        // {x,y} or null if none within range.
        _nearestLandTile(tx, ty) {
            const inBounds = (x, y) => x >= 0 && y >= 0 && x < 256 && y < 256;
            const isLand   = (x, y) => inBounds(x, y) &&
                getRenderType(sampleBiomeAt(x, y).name) !== 'water';
            if (isLand(tx, ty)) return { x: tx, y: ty };
            for (let r = 1; r <= 40; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;  // ring only
                        const x = tx + dx, y = ty + dy;
                        if (isLand(x, y)) return { x, y };
                    }
                }
            }
            return null;
        }

        // R key: recover a stuck camper. Fades out, drops it upright (level chassis)
        // on the nearest non-ocean biome tile, zeroes its motion, and fades back in.
        _respawnCamper() {
            if (!CamperDrivingSystem.isActive() || this._waterRescue) return;
            const curTX = Math.floor(this._vanX / WORLD_TILE_SIZE);
            const curTY = Math.floor(this._vanZ / WORLD_TILE_SIZE);
            const land  = this._nearestLandTile(curTX, curTY);
            if (!land) { if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer(); return; }
            if (typeof SoundManager !== 'undefined') SoundManager.playOk();

            this._waterRescue = true;   // reuse the freeze-during-fade guard
            this._fade(1, () => {
                this._vanX = land.x * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;
                this._vanZ = land.y * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;
                this._velX = 0; this._velZ = 0;
                this._fwdSpeed = 0; this._latSpeed = 0;
                this._speedKmh = 0; this._speedUnitsSigned = 0; this._steerSmooth = 0;
                this._flying = false; this._dived = false;
                this._suspVel = 0;
                // Upright: clear the terrain tilt so the chassis sits level.
                this._groundPitch = 0; this._groundRoll = 0;
                this._van.group.rotation.x = 0; this._van.group.rotation.z = 0;
                this._van.group.rotation.y = this._driveAngle;
                this._terrain.update(this._vanX, this._vanZ, true);
                this._vanY = this._resolveEnv();
                this._van.group.position.set(this._vanX, this._vanY, this._vanZ);
                this._lastLandX = this._vanX;
                this._lastLandZ = this._vanZ;
                this._lastLandAngle = this._driveAngle;
                this._stuck = false; this._stuckReason = ''; this._wedgeTimer = 0;
                if (this._hud) this._hud.setRespawnHint(false);
                this._fade(0, () => { this._waterRescue = false; });
            });
        }

        _computeDriveAngle(wx, wy) {
            const biome = sampleBiomeAt(wx, wy);
            const type  = getRenderType(biome.name);
            if (type !== 'road') return 0;

            const dir = getRoadDirectionAt(wx, wy);
            if (dir === 'horizontal' || dir.includes('east') || dir.includes('west')) return Math.PI / 2;
            return 0;
        }

        _createOverlay() {
            const el = document.createElement('div');
            el.id = 'camper-drive-overlay';
            // Title mode sits low in the stack (under the title logo at z 45 and
            // the menu at z 100), ignores the mouse and fades itself in.
            el.style.cssText = this._titleMode ? `
                position:fixed; top:0; left:0; width:100%; height:100%;
                z-index:40; overflow:hidden; background:#000; pointer-events:none;
                opacity:0; transition:opacity 0.8s ease-out;
            ` : `
                position:fixed; top:0; left:0; width:100%; height:100%;
                z-index:9999; overflow:hidden; background:#000;
            `;
            document.body.appendChild(el);
            this._overlay = el;
        }

        _initThree() {
            const w = window.innerWidth;
            const h = window.innerHeight;

            this._scene = new THREE.Scene();
            this._scene.background = new THREE.Color(0x87ceeb);
            // Much lighter haze so the world reads clearly into the distance. Fog
            // density is in 1/units, so it is divided by WORLD_SCALE to keep the
            // same view distance (in tiles) on the enlarged world.
            this._scene.fog = new THREE.FogExp2(0x87ceeb, FOG_DAY);

            // Near/far scale with the world so the (25x larger) terrain isn't
            // clipped; near stays small enough for the cabin interior.
            this._camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 4000 * WORLD_SCALE);
            this._baseFov = 65;

            this._renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
            this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
            this._renderer.setSize(w, h);
            const caps = this._renderer.capabilities;
            if (caps && caps.getMaxAnisotropy) setTextureAnisotropy(Math.min(8, caps.getMaxAnisotropy()));

            // Shadows + filmic tone mapping for a richer, less washed-out image.
            this._renderer.shadowMap.enabled = true;
            this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this._baseExposure = 0.92;
            if (THREE.ACESFilmicToneMapping !== undefined) {
                this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
                this._renderer.toneMappingExposure = this._baseExposure;
            }
            if ('outputColorSpace' in this._renderer && THREE.SRGBColorSpace !== undefined) {
                this._renderer.outputColorSpace = THREE.SRGBColorSpace;
            } else if ('outputEncoding' in this._renderer && THREE.sRGBEncoding !== undefined) {
                this._renderer.outputEncoding = THREE.sRGBEncoding;
            }
            this._renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;display:block;';
            this._overlay.appendChild(this._renderer.domElement);

            // Sky / ground hemisphere fill + a small flat ambient floor, both
            // dialled by time of day in _updateLightingAndSky.
            this._hemiLight = new THREE.HemisphereLight(0x9ec8ff, 0x4a3b2a, 0.7);
            this._scene.add(this._hemiLight);
            this._ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
            this._scene.add(this._ambientLight);

            this._sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
            this._sun.castShadow = true;
            this._sun.shadow.camera.left = -400;
            this._sun.shadow.camera.right = 400;
            this._sun.shadow.camera.top = 400;
            this._sun.shadow.camera.bottom = -400;
            this._sun.shadow.camera.near = 1;
            this._sun.shadow.camera.far = 1400;
            this._sun.shadow.mapSize.width = 1024;
            this._sun.shadow.mapSize.height = 1024;
            this._sun.shadow.bias = -0.0004;
            if ('normalBias' in this._sun.shadow) this._sun.shadow.normalBias = 0.6;
            this._scene.add(this._sun);
            this._scene.add(this._sun.target);

            // Soft additive sun disc that arcs with the time of day.
            const sunMat = new THREE.SpriteMaterial({
                map: this._makeGlowTexture('#fff3c0'),
                transparent: true, depthWrite: false, depthTest: false,
                blending: THREE.AdditiveBlending
            });
            this._sunSprite = new THREE.Sprite(sunMat);
            this._sunSprite.scale.set(420 * WORLD_SCALE, 420 * WORLD_SCALE, 1);
            this._scene.add(this._sunSprite);
        }

        // Radial-gradient glow texture for additive sprites (sun, beams).
        _makeGlowTexture(hex) {
            const s = 128;
            const cv = document.createElement('canvas');
            cv.width = cv.height = s;
            const ctx = cv.getContext('2d');
            const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
            g.addColorStop(0.0, hex);
            g.addColorStop(0.25, hex);
            g.addColorStop(1.0, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, s, s);
            const tex = new THREE.CanvasTexture(cv);
            return tex;
        }

        // Two forward spotlights + soft beam cones, parented to the camper and
        // switched on at dusk. Called once the van exists.
        _setupVehicleLights() {
            this._headlights = [];
            this._beams = [];
            // Kept for disposal: this texture and the beam SpriteMaterials are
            // created here and parented to _van.group, so CamperModel.dispose()
            // (which only frees its own tracked mats/geos) won't release them.
            const beamTex = this._makeGlowTexture('#fff6d8');
            this._beamTex = beamTex;
            for (const sx of [-14, 14]) {
                const sp = new THREE.SpotLight(0xfff2d0, 0.0, 360, 0.55, 0.45, 1.2);
                sp.position.set(sx, 14, 50);
                sp.castShadow = false;
                sp.target.position.set(sx, 4, 260);
                this._van.group.add(sp);
                this._van.group.add(sp.target);
                this._headlights.push(sp);

                const beamMat = new THREE.SpriteMaterial({
                    map: beamTex, transparent: true, depthWrite: false,
                    blending: THREE.AdditiveBlending, opacity: 0
                });
                const beam = new THREE.Sprite(beamMat);
                beam.scale.set(60, 60, 1);
                beam.position.set(sx, 12, 90);
                this._van.group.add(beam);
                this._beams.push(beam);
            }
        }

        _loop(now) {
            this._animId = requestAnimationFrame(this._loop);
            if (this._lastTime === null) { this._lastTime = now; return; }
            const delta = Math.min((now - this._lastTime) / 1000, 0.1);
            this._lastTime = now;

            // The weapon in the driver's hands: in frame while they are walking,
            // put away at the wheel and whenever the drive itself is out of
            // frame. Ticked before every early return below, since its canvas is
            // a sibling of the drive overlay and would otherwise stay painted
            // over a menu. R1 or a click swings or fires it; OK is spoken for out
            // here (it jumps, handbrakes and opens the vehicle menu).
            CamperWeapon.update(this._viewMode,
                this._menuOpen || this._suspended || this._stationRefuelWatch);

            // A station refuel window (VehicleSystemRefuel) is up over the frozen
            // scene: keep it hidden until the window closes, then restore the drive.
            if (this._stationRefuelWatch) {
                const sc = SceneManager._scene;
                if (!(sc instanceof Scene_Map) || !sc._refuelEl) {
                    this._stationRefuelWatch = false;
                    this._menuOpen = false;
                    if (this._overlay) this._overlay.style.display = '';
                } else {
                    return;
                }
            }

            // Paused while the RPG Maker choice menu is shown (overlay hidden).
            if (this._menuOpen) return;

            // Suspended while the main menu is open. Restore the overlay once the
            // player returns to the map scene; otherwise keep the scene frozen.
            if (this._suspended) {
                if (SceneManager._scene instanceof Scene_Map) {
                    this._suspended = false;
                    if (this._overlay) this._overlay.style.display = '';
                } else {
                    return;
                }
            }

            this._handleInput();
            this._updateMovement(delta);
            this._updateLightingAndSky(delta);

            // Widen terrain streaming while liminal drive is actually crossing
            // the world at warp speed, so chunk building (and the city grid it
            // carries) stays ahead of the camper instead of leaving gaps behind
            // it. Free cam manages _terrain._radius itself (see _updateFreeCam),
            // so leave it alone there.
            // Driving under power now crosses ground several times faster than it
            // used to, so the same widening is applied (in a smaller dose) once the
            // camper is past its natural top and the ordinary radius 5 / 6 builds
            // stop keeping up.
            if (this._viewMode !== 'free') {
                const ftBoost   = this._isFastTravelActive();
                const fastDrive = !ftBoost && this._speedKmh > NATURAL_TOP;
                const wantRadius = ftBoost ? LIMINAL_TERRAIN_RADIUS : (fastDrive ? 8 : 5);
                if (this._terrain._radius !== wantRadius) this._terrain._radius = wantRadius;
                this._terrain._buildBudget = ftBoost ? LIMINAL_BUILD_BUDGET : (fastDrive ? 18 : 6);
            }

            if (this._viewMode === 'free') {
                this._updateFreeCam(delta);
            } else if (this._viewMode === 'car') {
                this._updateCarCamera(delta);
            } else {
                this._fpc.update(delta);
                if (this._titleMode) this._updateTitleLook(delta);
                // On foot the player is free to walk any distance from the parked
                // camper (no tether), so terrain streaming has to follow the
                // player rather than staying centred on the stationary van, or
                // a long walk would run off the edge of the built ground.
                if (this._viewMode === 'foot') {
                    const p = this._fpc.getRig().position;
                    this._terrain.update(p.x, p.z);
                } else {
                    this._terrain.update(this._vanX, this._vanZ);
                }
            }

            // Drive the procedural camper: wheels spin/steer, body roll/pitch/
            // bounce, plus door / rotor / propeller animation. The cosmetic body
            // dynamics are suppressed while the camera rides inside (fp / fpdrive):
            // the rig is parented to the outer group, so a bouncing body would
            // read as the whole view bobbing against the cockpit.
            const fpInside = this._viewMode === 'fp' || this._viewMode === 'fpdrive';
            this._van.applyMotion(this._speedUnitsSigned, this._steerSmooth, delta,
                fpInside ? 0 : this._bodyRoll,
                fpInside ? 0 : this._bodyPitch,
                fpInside ? 0 : this._bodyBounce);
            this._updateDoorAutoOpen();
            this._van.update(delta);

            this._updateFuel(delta);
            // Real time behind the wheel, not map steps: the driving scene
            // trains the same specializations the overworld does.
            if (!this._titleMode && window.SpecializationXP && Math.abs(this._speedKmh) > 5) {
                window.SpecializationXP.tick('RV Driving', 1, 40, { key: 'camperdrive' });
                window.SpecializationXP.tick('Car Driving', 1, 40, { key: 'camperdrive' });
            }
            this._hud.update(this._vanX, this._vanZ, this._speedKmh, this._gearLabel, this._rpm, this._driveAngle);
            this._hud.updateEnvLabel(this._env);
            this._hud.updateControllerHint(!this._titleMode && GamepadRaw.connected());
            this._hud.setRespawnHint(this._stuck && !this._waterRescue, this._stuckReason);

            // Ability chips (Fly / Float / Dive) and condition + trip odometer.
            const afloat = this._env === 'water' || this._env === 'underwater';
            this._hud.updateAbilities({
                fly:   { unlocked: camperCan('fly'),   active: this._flying },
                float: { unlocked: camperCan('float'), active: afloat },
                dive:  { unlocked: camperCan('dive'),  active: this._env === 'underwater' }
            });
            // Trip odometer: _odo integrates |km/h| * seconds, so /3600 gives km.
            this._hud.updateStatus(this._camperCondition(), (this._odo || 0) / 3600);

            // In-cabin dash: speedo / tacho / fuel needles + brake lights.
            if (this._van.updateDash) {
                const maxFuel = camperMaxFuel();
                const fuelV = camperFuelGet();
                this._van.updateDash(this._speedKmh, this._rpm || 0,
                    Math.max(0, Math.min(1, fuelV / maxFuel)), !!this._brakeOn);
            }
            if (this._crashTimer > 0) this._crashTimer -= delta;
            this._wheelFx.update(delta);

            // Living world: weather, sea, traffic, bubbles, engine note.
            const _wt = (window.$gameWeather) ? window.$gameWeather.currentWeatherType : null;
            const _fx = (_wt === 'rain' || _wt === 'storm') ? 'rain' : _wt === 'snow' ? 'snow' : null;
            this._weatherFx.setWeather(_fx);
            this._weatherFx.update(this._vanX, this._vanZ, delta);

            const tsec = now * 0.001;
            this._water.update(this._vanX, this._vanZ, tsec);
            this._traffic.update(this._vanX, this._vanZ, delta, this._dayFactor == null ? 1 : this._dayFactor);
            if (this._bioEnemies) this._bioEnemies.update(delta, this._vanX, this._vanZ);
            this._underwaterFx.setActive(this._env === 'underwater');
            this._underwaterFx.update(this._vanX, this._vanY, this._vanZ, delta);
            if (this._engine) {
                const engineOn = this._isFastTravelActive() || this._viewMode === 'car' ||
                    this._viewMode === 'fpdrive' || this._env !== 'road';
                this._engine.setState(this._rpm || 0.12, this._throttle01 || 0,
                    this._speedKmh, this._slip01 || 0, engineOn);
                this._engine.setBoost(!!this._boostActive && engineOn);
            }

            // Liminal / cosmic-horror overdrive DISABLED: the glitch effects (space
            // warp, FOV/roll/shake, palette bleed, eldritch entities, engine-note
            // drift) are all turned off, so the liminal drive now looks and sounds
            // like a normal drive. Intensity is pinned at 0; update() is still called
            // with 0 so any lingering warp / fog / overlay is cleanly reset.
            this._liminalI = 0;
            if (this._engine) this._engine.setLiminal(0);
            this._liminal.update({
                camera: this._camera, van: this._van, terrain: this._terrain,
                renderer: this._renderer, scene: this._scene, viewMode: this._viewMode,
                intensity: 0, time: tsec, delta, baseExposure: this._baseExposure
            });

            // Speed lens tied to speed: above WARP_START_KMH light starts to bend
            // in a bubble around the camper, harder the faster it goes and harder
            // still under the liminal boost. Nothing in the scene is displaced -
            // it is a screen-space pass over the finished frame (SpeedWarpFx), so
            // the scenery, the chunk seams and the physics are all untouched.
            let warpTarget = Math.max(0, this._speedKmh - WARP_START_KMH) /
                Math.max(1, MAX_KMH - WARP_START_KMH);
            // Eased rather than linear: the turbo's ceiling is several times the
            // natural top, so a straight ramp would leave ordinary fast driving
            // showing nothing at all.
            warpTarget = Math.pow(Math.min(1, warpTarget), 0.6) * 0.75;
            if (this._boostActive) warpTarget = Math.min(1, warpTarget + 0.25);
            // Never bend during the liminal (auto fast-travel) drive: its cruise
            // speed sits far above WARP_START_KMH, which would leave the lens on
            // for the whole trip.
            if (this._isFastTravelActive()) warpTarget = 0;
            this._warpAmount += (warpTarget - this._warpAmount) * Math.min(1, delta * 3);
            if (this._warpAmount < 0.002) this._warpAmount = 0;

            this._renderFrame(tsec);

            // Title background: reveal the drive once the first frame is on
            // screen, so the title never flashes a half-built world.
            if (this._titleMode && this._overlay && this._overlay.style.opacity !== '1') {
                this._overlay.style.opacity = '1';
            }
        }

        // Draw the scene, through the speed lens when one is running. The PSX
        // downscale pass, where it is enabled, is chained INSIDE the lens: it
        // renders into whatever target it is handed, so the retro blit lands in
        // the lens's offscreen frame and the lens then bends that onto the canvas.
        _renderFrame(tsec) {
            const drawInto = (target) => {
                this._renderer.setRenderTarget(target || null);
                if (window.PSXShader) {
                    window.PSXShader.render(this._renderer, this._scene, this._camera);
                } else {
                    this._renderer.render(this._scene, this._camera);
                }
                this._renderer.setRenderTarget(null);
            };

            if (this._speedFx && this._warpAmount > 0) {
                // In the first-person views the camper IS the camera, so the lens
                // sits at the centre of the screen; otherwise it is bent around
                // wherever the vehicle happens to be drawn.
                const fp = this._viewMode === 'fp' || this._viewMode === 'fpdrive' ||
                    this._viewMode === 'foot';
                this._warpCentre.set(this._vanX, this._vanY + 6, this._vanZ);
                const done = this._speedFx.render(this._renderer, drawInto, {
                    amount: this._warpAmount, time: tsec, center: this._warpCentre,
                    camera: this._camera, centered: fp
                });
                if (done) return;
            }
            drawInto(null);
        }

        _updateLightingAndSky(delta) {
            // Time-of-day from TimeDateSystem Variable 114 (total game minutes).
            // Base epoch is 10:00 AM (600 min offset), see TimeDateSystem.
            const totalMins    = (typeof $gameVariables !== 'undefined') ? $gameVariables.value(114) : 0;
            // The title drive rolls its own hour (never writing the clock back)
            // so each visit to the title screen catches a different light.
            const minuteOfDay  = (totalMins + 600 + (this._titleMinuteOffset || 0)) % (24 * 60);
            const hour         = minuteOfDay / 60; // 0..24 float
            const df           = dayFactorForHour(hour);
            this._dayFactor    = df;
            const underwater   = this._env === 'underwater';

            // Sun arcs across the sky (rises ~6h east, sets ~18h west). The sprite
            // and the shadow-casting light share the same position.
            const dayT = Math.max(0, Math.min(1, (hour - 6) / 12));
            const az   = Math.PI * (1 - dayT);
            const sx   = this._vanX + Math.cos(az) * 520;
            const sz   = this._vanZ + Math.sin(az) * 260;
            const sy   = 120 + Math.sin(dayT * Math.PI) * 520;
            // The shadow-casting directional light stays camper-local so its (fixed)
            // shadow frustum still covers the vehicle and nearby scenery; only its
            // direction matters for lighting.
            this._sun.position.set(sx, sy, sz);
            this._sun.target.position.set(this._vanX, this._vanY, this._vanZ);
            this._sun.target.updateMatrixWorld();
            if (this._sunSprite) {
                // The sun disc, by contrast, is pushed out to WORLD_SCALE distance so
                // it reads as a far sun over the enlarged world rather than a lamp a
                // few metres off the bumper.
                this._sunSprite.position.set(
                    this._vanX + Math.cos(az) * 520 * WORLD_SCALE,
                    (120 + Math.sin(dayT * Math.PI) * 520) * WORLD_SCALE,
                    this._vanZ + Math.sin(az) * 260 * WORLD_SCALE
                );
                this._sunSprite.material.opacity = (0.2 + df * 0.8) * (underwater ? 0 : 1);
            }

            // Light intensities. Kept moderate so daylight does not blow out the
            // scene (dimmed and bluer underwater).
            this._sun.intensity          = underwater ? 0.25 : 0.18 + df * 0.92;
            this._ambientLight.intensity = underwater ? 0.18 : 0.08 + df * 0.20;
            if (this._hemiLight) this._hemiLight.intensity = underwater ? 0.20 : 0.15 + df * 0.30;

            // Headlights / beams ramp on at dusk, at night, and underwater.
            const wantHead = (df < HEADLIGHT_NIGHT) || underwater;
            const hi = wantHead ? HEADLIGHT_INTENSITY : 0.0;
            const bo = wantHead ? HEADLIGHT_BEAM_OPACITY : 0.0;
            const ek = Math.min(1, delta * 3);
            if (this._headlights) for (const sp of this._headlights) sp.intensity += (hi - sp.intensity) * ek;
            if (this._beams) for (const b of this._beams) b.material.opacity += (bo - b.material.opacity) * ek;

            // Sky / fog colour. Underwater forces a deep teal regardless of camera.
            const targetSky = underwater ? this._tmpSky.setRGB(0.03, 0.20, 0.24) : sampleSkyColor(hour, this._tmpSky);
            const k = Math.min(1, delta * 1.5);
            if (!this._freeCamActive || underwater) {
                this._scene.background.lerp(targetSky, k);
                this._scene.fog.color.lerp(targetSky, k);
            }
            if (underwater) this._scene.fog.density = FOG_UNDERWATER;
            else if (this._viewMode !== 'free') this._scene.fog.density = FOG_DAY;

            // Stars / moon / drifting clouds follow the camper.
            if (this._skyFx) this._skyFx.update(this._vanX, this._vanZ, hour, df, delta, underwater);
        }

        _handleInput() {
            if (this._titleMode) return;   // the title screen owns the controls
            if (typeof Input === 'undefined') return;


            // OK / Space is context-sensitive: on foot it jumps; while rolling in
            // a driving view it is the HANDBRAKE (hold to lock the rears and
            // drift); once nearly stopped it opens the vehicle options menu.
            const drivingMode = this._viewMode === 'car' || this._viewMode === 'fpdrive';
            const rolling = this._speedKmh > 6;
            this._handbrake = drivingMode && rolling &&
                (this._freeMoveKeys.has('Space') || Input.isPressed('ok'));

            if (Input.isTriggered('ok')) {
                if (this._viewMode === 'foot') {
                    this._fpc.requestJump();
                } else if (!(drivingMode && rolling)) {
                    this._openDriveMenu();
                }
            }

            // Cancel / controller back leaves the drive immediately (same as ESC),
            // dropping the player back onto the world map at the reached tile.
            if (Input.isTriggered('cancel') && CamperDrivingSystem.isActive()) {
                this._requestExit();
            }

            // Controller right stick zooms the camera while driving / in free cam.
            if (window.AnalogStickInput && (this._viewMode === 'car' || this._viewMode === 'free')) {
                const ry = AnalogStickInput.rightY ? AnalogStickInput.rightY() : 0;
                if (ry) {
                    const step = Math.max(150, this._zoomDist * 0.15 + 150);
                    this._zoomDist = Math.max(0, Math.min(ZOOM_MAX, this._zoomDist + ry * step * 0.5));
                }
            }

            // L2/R2 mirror the scroll wheel: R2 zooms in, L2 zooms out.
            if (this._viewMode === 'car' || this._viewMode === 'free') {
                const zoomIn  = GamepadRaw.value(GamepadRaw.R2);
                const zoomOut = GamepadRaw.value(GamepadRaw.L2);
                if (zoomIn > 0.08 || zoomOut > 0.08) {
                    const step = Math.max(150, this._zoomDist * 0.15 + 150);
                    this._zoomDist = Math.max(0, Math.min(ZOOM_MAX,
                        this._zoomDist + (zoomOut - zoomIn) * step * 0.5));
                }
            }

            // Y toggles first/third person, mirroring TAB.
            if (GamepadRaw.triggeredY() &&
                !(this._menuOpen || this._suspended || this._stationRefuelWatch)) {
                this._cycleViewMode();
            }

            // In first person / on foot, the right stick looks around (mouse parity).
            if (window.AnalogStickInput &&
                (this._viewMode === 'fp' || this._viewMode === 'foot' || this._viewMode === 'fpdrive')) {
                const rx = AnalogStickInput.rightX ? AnalogStickInput.rightX() : 0;
                const ry = AnalogStickInput.rightY ? AnalogStickInput.rightY() : 0;
                if (rx) this._fpc.yaw.rotation.y   -= rx * 0.05;
                if (ry) {
                    this._fpc.pitch.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
                        this._fpc.pitch.rotation.x - ry * 0.05));
                }
            }
        }

        // Opens the normal game main menu (CustomMainMenuLayout) over the scene.
        // The 3D overlay is hidden so the menu DOM/canvas is visible, and restored
        // by _loop when the player returns to the map scene.
        _openMainMenu() {
            if (this._menuOpen || this._suspended) return;
            if (typeof Scene_Menu === 'undefined') return;
            if (!(SceneManager._scene instanceof Scene_Map)) return;
            this._suspended = true;
            if (this._overlay) this._overlay.style.display = 'none';
            if (document.pointerLockElement === document.body) document.exitPointerLock();
            SceneManager.push(Scene_Menu);
        }

        // ESC / back: leave the drive scene right away (back onto map 315). Guarded
        // so it never fires while the choice menu or main menu is already up.
        _requestExit() {
            if (this._menuOpen || this._suspended) return;
            if (typeof $gameMessage !== 'undefined' && $gameMessage.isBusy()) return;
            this._endDriveToWorldMap();
        }

        // Free-play teardown (Minigames menu): stop the overlay / rAF loop and
        // notify the opener so it can pop back to its own scene. No world-map
        // transfer, no fast-travel bookkeeping.
        _exitStandalone() {
            const cb = this._onStandaloneExit;
            this._onStandaloneExit = null;
            CamperDrivingSystem.stop();
            if (cb) cb();
        }

        // RPG Maker choice menu shown over the (temporarily hidden) 3D overlay,
        // offering the liminal-drive stop options. Opened with OK / confirm.
        _openDriveMenu() {
            // Free-play launch (Minigames menu) runs over a menu scene with no
            // message window to host the choice list, so OK is inert there and
            // Esc / Cancel quits straight back to the Minigames list.
            if (this._standalone) return;
            if (this._menuOpen) return;
            if (typeof $gameMessage === 'undefined' || $gameMessage.isBusy()) return;
            this._menuOpen = true;

            // The 3D overlay sits above the game canvas, so the RPG Maker choice
            // window would be hidden behind it. Hide the overlay while choosing.
            if (this._overlay) this._overlay.style.display = 'none';
            if (document.pointerLockElement === document.body) document.exitPointerLock();

            const restore = () => { if (this._overlay) this._overlay.style.display = ''; };
            const choices  = [];
            const handlers = [];

            // Stop liminal drive: cancel any fast travel and drop the player onto
            // the world map (315) at the tile the camper actually reached.
            choices.push(T('CamperDrive.stopLiminal'));
            handlers.push(() => this._endDriveToWorldMap());

            // Stop driving: halt motion without closing the scene, drop to the cabin.
            choices.push(T('CamperDrive.stopDriving'));
            handlers.push(() => {
                const d = (typeof $gameSystem !== 'undefined' && $gameSystem.getFastTravelData)
                    ? $gameSystem.getFastTravelData() : null;
                if (d) d.timerActive = false;
                restore();
                this._setMode('fp');
            });

            // Step outside / climb back in (on-foot exploration).
            if (this._viewMode === 'foot') {
                choices.push(T('CamperDrive.climbBackIn'));
                handlers.push(() => { restore(); this._setMode('fp'); });
            } else {
                choices.push(T('CamperDrive.stepOutside'));
                handlers.push(() => { restore(); this._setMode('foot'); });
            }

            // At a city / village fuel station, "Continue" opens the refuel UI
            // (VehicleSystemRefuel) instead of just resuming; Esc out of it drops
            // straight back into the drive.
            const atStation = this._atGasStation();
            choices.push(atStation ? T('CamperDrive.refuelAtStation') : T('CamperDrive.continue'));
            handlers.push(() => {
                if (atStation) this._openStationRefuel();
                else restore();
            });

            const cancelIdx = choices.length - 1;
            $gameMessage.setChoices(choices, cancelIdx, cancelIdx);
            $gameMessage.setChoiceCallback((idx) => {
                this._menuOpen = false;
                const h = handlers[idx];
                if (h) h(); else restore();
            });
        }

        // Opens the standard refuel UI (VehicleSystemRefuel) over the paused drive
        // scene. Kept "menu open" so the 3D loop stays frozen and the overlay
        // hidden; _loop restores the overlay once the refuel window is dismissed.
        _openStationRefuel() {
            const sc = SceneManager._scene;
            if (!(sc instanceof Scene_Map) || typeof sc.showRefuelWindow !== 'function') {
                // Refuel plugin unavailable: just resume driving.
                this._menuOpen = false;
                if (this._overlay) this._overlay.style.display = '';
                return;
            }
            this._menuOpen = true;             // freeze the drive loop, keep overlay hidden
            this._stationRefuelWatch = true;   // _loop restores once the window closes
            sc.showRefuelWindow();
        }

        // Handles ending the drive while over water. The camper can float over
        // water WHILE driving, but that ability ends with the mode; if the player
        // never earned the Amphibious (float) upgrade, ending over water "splashes
        // the camper down": it takes crash damage, a splash plays, and it washes
        // ashore on the nearest land tile (so the player is never dumped mid-ocean).
        // Returns the final landing tile {x, y} (unchanged when not splashing down).
        _splashDownIfWater(tileX, tileY) {
            const overWater = getRenderType(sampleBiomeAt(tileX, tileY).name) === 'water';
            if (!overWater || camperCan('float')) return { x: tileX, y: tileY };

            if (typeof AudioManager !== 'undefined') {
                AudioManager.playSe({ name: 'Water2', pan: 0, pitch: 90, volume: 90 });
            }
            // Crash damage from the emergency water landing.
            if (window.VehicleUpgrades && typeof window.VehicleUpgrades.applyDamage === 'function') {
                window.VehicleUpgrades.applyDamage('camper', 30);
            }
            if (window.ParchmentToast) {
                window.ParchmentToast.show(T('CamperDrive.splashdown'),
                    { severity: 'warning', duration: 180 });
            }

            // Wash ashore on the nearest land tile so nothing is stranded on water.
            const land = this._nearestLandTile(tileX, tileY);
            return land ? { x: land.x, y: land.y } : { x: tileX, y: tileY };
        }

        // End the drive and place the player on the world map (315) at the world
        // tile the camper actually reached. Variables 43/44 mirror the player's
        // world position on map 315, so we write the live tile and transfer there.
        _endDriveToWorldMap() {
            // Free-play launch (Minigames menu): there is no world map to hand
            // control back to, so just dispose the drive and run the exit callback.
            if (this._standalone) { this._exitStandalone(); return; }
            // The reached world tile, clamped to the 256x256 world grid so a stray
            // position can never resolve to an off-map (or negative) coordinate.
            let tileX = Math.max(0, Math.min(255, Math.floor(this._vanX / WORLD_TILE_SIZE)));
            let tileY = Math.max(0, Math.min(255, Math.floor(this._vanZ / WORLD_TILE_SIZE)));

            // The drive mode lets the camper cross water freely; that ability ends
            // with the mode. If it ends over water without the Amphibious (float)
            // upgrade, the camper splashes down and washes ashore (see helper).
            const landing = this._splashDownIfWater(tileX, tileY);
            tileX = landing.x;
            tileY = landing.y;

            if (typeof $gameVariables !== 'undefined') {
                // Player world tile (vars 43/44) AND the camper's own world tile
                // (position store) both point at the reached tile, so the 2D map
                // and the 3D drive always agree and nothing snaps it back to 0,0.
                $gameVariables.setValue(43, tileX);
                $gameVariables.setValue(44, tileY);
                if (window.VehiclePosition) {
                    window.VehiclePosition.set('camper', WORLD_MAP_ID, tileX, tileY);
                }
            }

            // Cancel the fast-travel timer / movement lock before leaving.
            if (typeof $gameSystem !== 'undefined') {
                if ($gameSystem.clearFastTravelData) $gameSystem.clearFastTravelData();
                else if ($gameSystem.stopTravelTimer) $gameSystem.stopTravelTimer();
            }

            // Park the world-map camper (the "ship" vehicle) on the reached tile.
            let camper = null;
            if (typeof $gameMap !== 'undefined' && $gameMap.vehicle) {
                camper = $gameMap.vehicle('ship');
                if (camper && camper.setLocation) camper.setLocation(WORLD_MAP_ID, tileX, tileY);
            }

            const onFoot = this._viewMode === 'foot';
            if (typeof $gamePlayer !== 'undefined') {
                if (onFoot) {
                    // Ended outside: dismount and stand one tile south of the parked
                    // camper, facing it, rather than spawning aboard the vehicle.
                    if ($gamePlayer.isInVehicle && $gamePlayer.isInVehicle()) {
                        $gamePlayer._vehicleType = '';
                        $gamePlayer._vehicleGettingOn = false;
                        $gamePlayer._vehicleGettingOff = false;
                    }
                    if (camper) camper._driving = false;
                    const py = Math.min(255, tileY + 1);
                    if (typeof $gameVariables !== 'undefined') $gameVariables.setValue(44, py);
                    $gamePlayer.reserveTransfer(WORLD_MAP_ID, tileX, py, 8, 0);
                } else {
                    // Ended while driving: return to map 315 still aboard the camper
                    // at the exact tile reached, so the player resumes driving it on
                    // the world map instead of being dropped at (0,0).
                    $gamePlayer._vehicleType = 'ship';
                    $gamePlayer._vehicleGettingOn = false;
                    $gamePlayer._vehicleGettingOff = false;
                    if (camper) camper._driving = true;
                    // We short-circuit the engine's boarding flow (updateVehicleGetOn),
                    // which is what normally hides the on-foot sprite once aboard. Do it
                    // here so only the camper graphic shows and the hidden player sprite
                    // rides along with the vehicle instead of standing beside it.
                    $gamePlayer.setTransparent(true);
                    $gamePlayer.reserveTransfer(WORLD_MAP_ID, tileX, tileY, 2, 0);
                }
            }

            CamperDrivingSystem.stop();
        }

        // Surface under a world position: asphalt only on the actual road slab
        // (the shoulders of a road tile are dirt), otherwise picked per biome.
        _surfaceAt(x, z) {
            const ts = WORLD_TILE_SIZE;
            const tx = Math.floor(x / ts);
            const tz = Math.floor(z / ts);
            const biome = sampleBiomeAt(tx, tz);
            const type  = getRenderType(biome.name);
            if (type === 'road') {
                const lx = x - (tx * ts + ts * 0.5);
                const lz = z - (tz * ts + ts * 0.5);
                const half = ROAD_TOTAL_W / 2;   // matches the built road slab width
                const dir = getRoadDirectionAt(tx, tz);
                let on;
                if (dir === 'vertical')        on = Math.abs(lx) <= half;
                else if (dir === 'horizontal') on = Math.abs(lz) <= half;
                else                           on = Math.abs(lx) <= half || Math.abs(lz) <= half;
                return on ? SURFACES.asphalt : SURFACES.dirt;
            }
            if (type === 'mountain') return SURFACES.rock;
            const n = biome.name.toLowerCase();
            if (n.includes('desert') || n.includes('beach') || n.includes('dune') || n.includes('salt'))
                return SURFACES.sand;
            if (n.includes('snow') || n.includes('ice') || n.includes('glacier') ||
                n.includes('frost') || n.includes('tundra') || n.includes('arctic'))
                return SURFACES.snow;
            return SURFACES.grass;
        }

        // Automatic 5-speed box: gear follows road speed with hysteresis, the
        // RPM needle saws up through each gear and dips during the shift's
        // torque cut. Past the top gear (turbo overdrive) it pins near redline.
        _updateGearbox(delta, fwd, throttleOn) {
            if (this._shiftTimer > 0) this._shiftTimer -= delta;
            const v = Math.abs(fwd);
            if (fwd < -0.5) {
                this._gear = 1;
                this._gearLabel = 'R';
                const t = 0.15 + 0.8 * Math.min(1, v / REVERSE_MAX_KMH);
                this._rpm += (t - this._rpm) * Math.min(1, delta * 7);
                return;
            }
            let g = this._gear || 1;
            if (g < GEARS.length && v > GEARS[g - 1])      { g++; this._shiftTimer = SHIFT_TIME; if (this._engine) this._engine.playShift(); }
            else if (g > 1 && v < GEARS[g - 2] * 0.8)      { g--; this._shiftTimer = SHIFT_TIME * 0.5; if (this._engine) this._engine.playShift(); }
            this._gear = g;
            const lo = g > 1 ? GEARS[g - 2] * 0.8 : 0;
            const hi = GEARS[g - 1];
            let target = 0.14 + 0.82 * Math.max(0, Math.min(1, (v - lo) / Math.max(1, hi - lo)));
            if (v >= GEARS[GEARS.length - 1]) {
                target = 0.9 + Math.sin((this._fxTime || 0) * 11) * 0.05;   // overdrive scream
            }
            if (this._shiftTimer > 0) target *= 0.55;
            if (!throttleOn && v < 2) target = 0.12 + this._throttle01 * 0.1;   // idle
            this._rpm += (target - this._rpm) * Math.min(1, delta * 7);
            this._gearLabel = (v < 1 && !throttleOn) ? 'N' : String(g);
        }

        // Core driving physics. Velocity persists in world space; each frame it
        // is decomposed into the heading frame, forces act on the forward part,
        // grip bleeds the lateral part (slip = drift), and steering yaws the
        // heading through a speed-sensitive bicycle model.
        _stepVehiclePhysics(delta, canDrive, readInput) {
            let sin = Math.sin(this._driveAngle);
            let cos = Math.cos(this._driveAngle);
            let fwd = this._velX * sin + this._velZ * cos;
            let lat = this._velX * cos - this._velZ * sin;

            // An autopilot, when one is driving, stands in for the pedals and the
            // wheel; its throttle is continuous rather than a key press.
            const auto = this._autopilot ? this._autopilot.controls : null;
            const throttleTarget = auto ? auto.throttle
                : ((readInput && canDrive &&
                    (this._freeMoveKeys.has('KeyW') || Input.isPressed('up'))) ? 1 : 0);
            const throttleKey = canDrive && throttleTarget > 0.02;
            const brakeKey = auto ? !!auto.brake
                : (readInput && (this._freeMoveKeys.has('KeyS') || Input.isPressed('down')));
            const boost = !auto && readInput && canDrive && this._isAcceleratePressed();
            this._boostActive = boost;
            const airborne = this._airborne;   // set by _updateRideHeight last frame
            const turnInput = auto ? auto.steer
                : !readInput ? 0
                : (this._freeMoveKeys.has('KeyA') || Input.isPressed('left'))  ? -1
                : (this._freeMoveKeys.has('KeyD') || Input.isPressed('right')) ?  1 : 0;
            const handbrake = !auto && readInput && this._handbrake;

            this._throttle01 += (throttleTarget - this._throttle01) * Math.min(1, delta * 5);
            this._steerSmooth += (turnInput - this._steerSmooth) * Math.min(1, delta * 8);

            // Handling parameters for the surface / environment underfoot.
            const surf = this._env === 'road' ? this._surfaceAt(this._vanX, this._vanZ)
                : this._env === 'water'       ? { grip: 1.6, roll: 2.0, dragMul: 2.2, bump: 0, dust: 0 }
                : this._env === 'underwater'  ? { grip: 2.5, roll: 3.0, dragMul: 4.0, bump: 0, dust: 0 }
                :                               { grip: 0.9, roll: 0.0, dragMul: 0.7, bump: 0, dust: 0 };
            this._surface = surf;

            // Gravity along the grade (uphill drains speed, downhill feeds it,
            // and a parked camper will roll away on a steep enough slope).
            let grade = 0;
            if (this._env === 'road') {
                const ts = WORLD_TILE_SIZE, d = 9;
                const hF = this._terrain.getTerrainHeight((this._vanX + sin * d) / ts, (this._vanZ + cos * d) / ts);
                const hB = this._terrain.getTerrainHeight((this._vanX - sin * d) / ts, (this._vanZ - cos * d) / ts);
                grade = Math.max(-0.6, Math.min(0.6, (hF - hB) / (d * 2)));
            }
            this._grade = grade;

            this._updateGearbox(delta, fwd, throttleKey);
            const accelMult = (window.VehicleUpgrades ? window.VehicleUpgrades.getAccelMult('camper') : 1);
            const speedMult = (window.VehicleUpgrades ? window.VehicleUpgrades.getSpeedMult('camper') : 1);
            const maxKmh = MAX_KMH * speedMult;

            // Integrate the dynamics in fixed substeps (each <= 1/60 s) so drag,
            // slip decay and the steering yaw stay stable and frame-rate
            // independent even across a long frame. Inputs, the surface, the
            // grade and the gearbox are all sampled once per frame above.
            const nSteps = Math.max(1, Math.min(6, Math.ceil(delta / (1 / 60))));
            const dt = delta / nSteps;
            // Loose surfaces cannot put the whole engine force down (wheelspin):
            // usable traction scales with the surface's lateral grip, so dirt /
            // sand / snow launch noticeably softer than asphalt.
            const traction = 0.55 + 0.45 * Math.min(1, surf.grip / SURFACES.asphalt.grip);

            for (let step = 0; step < nSteps; step++) {
                // Brakes, and reverse when held past the stop.
                if (brakeKey) {
                    if (fwd > 0.5) {
                        fwd = Math.max(0, fwd - BRAKE_DECEL * dt);
                        this._reverseDelay = 0;
                    } else {
                        this._reverseDelay += dt;
                        if (this._reverseDelay > 0.25 && canDrive) {
                            fwd = Math.max(-REVERSE_MAX_KMH, fwd - REVERSE_ACCEL * dt);
                        }
                    }
                } else {
                    this._reverseDelay = 0;
                }

                // Engine force through the box (torque tapers near redline and cuts
                // during a shift). Throttling out of reverse brakes first.
                if (throttleKey && fwd >= -0.5) {
                    const gearMul = GEAR_FORCE[this._gear - 1] || 1;
                    const torque  = this._shiftTimer > 0 ? 0.25
                        : Math.max(0.62, 1 - Math.max(0, this._rpm - 0.75));
                    // Shift/turbo greatly increases acceleration, not just top speed.
                    const boostMul = boost ? BOOST_ACCEL_MULT : 1;
                    fwd += ENGINE_ACCEL * gearMul * accelMult * boostMul * torque *
                        traction * this._throttle01 * dt;
                } else if (throttleKey && fwd < -0.5) {
                    fwd = Math.min(0, fwd + BRAKE_DECEL * dt);
                }

                // Turbo overdrive: shove past the natural top toward 999.
                if (boost && throttleKey && fwd > 1) {
                    fwd = Math.min(maxKmh, fwd + OVERDRIVE_KMHPS * accelMult * dt);
                }

                // Air drag + rolling resistance (no rolling resistance in mid-air).
                // Above the natural top the speed is only held under boost: while Shift
                // is down the overdrive bleeds off gently; the instant it is released
                // the excess collapses very fast, so the liminal boost reads as a burst.
                let decel = DRAG_K * surf.dragMul * fwd * fwd + (airborne ? 0 : surf.roll);
                if (Math.abs(fwd) > NATURAL_TOP) {
                    decel = boost ? Math.min(decel, OVERDRIVE_DECAY)
                                  : Math.max(decel, BOOST_RELEASE_DECAY);
                }
                fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), decel * dt);

                // Handbrake: rear lock drags the nose down and slashes lateral grip.
                let grip = surf.grip;
                if (handbrake) {
                    fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), HANDBRAKE_DECEL * dt);
                    grip *= HANDBRAKE_GRIP;
                }

                // Slope, then static friction so gentle grades hold a parked camper.
                // In mid-air there is no ground contact, so the grade does not act.
                if (!airborne) fwd -= SLOPE_ACCEL * grade * dt;
                if (!airborne && !throttleKey && !brakeKey && Math.abs(fwd) < 2.5 && Math.abs(grade) < 0.22) fwd = 0;
                // Parking brake while away from the wheel (cabin / free cam / on foot).
                if (!readInput && Math.abs(fwd) < 4) fwd = 0;

                // Steering: lock shrinks with speed; yaw follows the wheelbase.
                // Negative fwd flips the yaw, so reversing steers realistically.
                if (Math.abs(fwd) > 0.4) {
                    const lock = MAX_STEER_LOCK / (1 + Math.abs(fwd) * STEER_FALLOFF);
                    let yawRate = (fwd / WHEELBASE) * Math.tan(this._steerSmooth * lock);
                    yawRate = Math.max(-2.2, Math.min(2.2, yawRate));
                    this._driveAngle += yawRate * dt;
                }

                // Lateral slip decays with grip; the scrub also bleeds forward speed.
                const slip = Math.abs(lat);
                lat -= lat * Math.min(1, grip * dt);
                fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), slip * LAT_SCRUB * dt);
                this._slip01 = Math.min(1, slip / 26);

                // Recompose in the rotated heading frame and integrate the position.
                sin = Math.sin(this._driveAngle);
                cos = Math.cos(this._driveAngle);
                this._velX = fwd * sin + lat * cos;
                this._velZ = fwd * cos - lat * sin;
                // Velocity is in km/h; KMH_TO_UNITS scales it to world units/sec.
                this._vanX += this._velX * KMH_TO_UNITS * dt;
                this._vanZ += this._velZ * KMH_TO_UNITS * dt;
            }

            this._fwdSpeed = fwd;
            this._latSpeed = lat;
            this._speedKmh = Math.abs(fwd);
            this._brakeOn  = (brakeKey && fwd > -0.5) || handbrake;
        }

        // Tilt the chassis to the terrain underneath (nose up a climb, lean on
        // a camber). Applied to the group in YXZ order under the heading yaw.
        _alignToTerrain(delta, grounded) {
            let tp = 0, tr = 0;
            if (grounded) {
                const ts = WORLD_TILE_SIZE;
                const sin = Math.sin(this._driveAngle), cos = Math.cos(this._driveAngle);
                const H = (x, z) => this._terrain.getTerrainHeight(x / ts, z / ts);
                const dF = 9, dR = 5;
                const hF = H(this._vanX + sin * dF, this._vanZ + cos * dF);
                const hB = H(this._vanX - sin * dF, this._vanZ - cos * dF);
                const hR = H(this._vanX + cos * dR, this._vanZ - sin * dR);
                const hL = H(this._vanX - cos * dR, this._vanZ + sin * dR);
                tp = Math.max(-0.5, Math.min(0.5, -Math.atan2(hF - hB, dF * 2)));
                tr = Math.max(-0.5, Math.min(0.5,  Math.atan2(hR - hL, dR * 2)));
            }
            const k = Math.min(1, delta * 5);
            this._groundPitch += (tp - this._groundPitch) * k;
            this._groundRoll  += (tr - this._groundRoll)  * k;
            this._van.group.rotation.x = this._groundPitch;
            this._van.group.rotation.z = this._groundRoll;
        }

        // Bump into pooled traffic: push the camper out of the overlap, reflect
        // its velocity off the car with some restitution, and rattle the camera.
        _checkTrafficCollision(delta) {
            if (this._crashCooldown > 0) { this._crashCooldown -= delta; return; }
            if (!this._traffic) return;
            for (const car of this._traffic._cars) {
                if (!car.active) continue;
                // Contact radius = the camper's own half-length plus the car's
                // mean half-extent, so a hatchback and a bus push back differently
                // instead of every vehicle sharing one oversized bubble.
                const R  = FOOT_VAN_HALF_LEN + (car.radius || 8);
                const dx = car.x - this._vanX;
                const dz = car.z - this._vanZ;
                const d2 = dx * dx + dz * dz;
                if (d2 > R * R) continue;
                const d  = Math.sqrt(d2) || 1;
                const nx = dx / d, nz = dz / d;
                this._vanX = car.x - nx * R;
                this._vanZ = car.z - nz * R;
                const vn = this._velX * nx + this._velZ * nz;
                if (vn > 0) {
                    this._velX -= vn * 1.55 * nx;
                    this._velZ -= vn * 1.55 * nz;
                }
                car.speed = Math.max(12, car.speed * 0.4);
                const sin = Math.sin(this._driveAngle), cos = Math.cos(this._driveAngle);
                this._fwdSpeed = this._velX * sin + this._velZ * cos;
                this._latSpeed = this._velX * cos - this._velZ * sin;
                this._speedKmh = Math.abs(this._fwdSpeed);
                this._crashTimer = 0.6;
                this._crashCooldown = 0.5;
                // The title background bumps silently: the title theme is playing.
                if (!this._titleMode) {
                    try {
                        AudioManager.playSe({ name: 'Blow1', volume: 90, pitch: 70, pan: 0 });
                    } catch (e) {
                        if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer();
                    }
                }

                // Impact severity = closing speed (vn was the pre-bounce approach).
                const impact = vn > 0 ? vn : Math.max(this._speedKmh, 12);
                // Spark burst at the contact point, thrown up and outward.
                if (this._wheelFx) {
                    const cxp = this._vanX + nx * R * 0.5;
                    const czp = this._vanZ + nz * R * 0.5;
                    const bursts = Math.min(18, 6 + Math.floor(impact * 0.2));
                    for (let s = 0; s < bursts; s++) {
                        const a  = Math.random() * Math.PI * 2;
                        const sp = 20 + Math.random() * impact * 0.6;
                        this._wheelFx.spawn(
                            cxp + (Math.random() - 0.5) * 4, this._vanY + 6 + Math.random() * 4, czp + (Math.random() - 0.5) * 4,
                            Math.cos(a) * sp, 20 + Math.random() * 40, Math.sin(a) * sp,
                            1.0, 0.6 + Math.random() * 0.3, 0.15, 0.25 + Math.random() * 0.3
                        );
                    }
                }
                // Real mechanical damage on a solid hit (feature-detected, and
                // rate-limited by _crashCooldown so one bump = one damage roll).
                if (!this._titleMode && impact > 20 && window.VehicleUpgrades &&
                    typeof window.VehicleUpgrades.applyDamage === 'function') {
                    window.VehicleUpgrades.applyDamage('camper', Math.min(16, impact * 0.22));
                }
                break;
            }
        }

        // Touch a roaming BiomeEnemyManager animal: pull it out of the wildlife
        // pool and drop straight into a fight. For now this ALWAYS runs the
        // ordinary Scene_Battle presentation, ignoring the map-battle option:
        // the drive is not a real overworld map for MapBattleMode's tactical
        // layer to run on top of. Never checked in title mode / free-play (no
        // real party) or mid auto-travel (see the ftActive gate at the call site).
        _checkBioEnemyCollision() {
            if (!this._bioEnemies || this._menuOpen || this._suspended) return;
            const ents = this._bioEnemies._ents;
            const R = FOOT_VAN_HALF_LEN + ENEMY_3D_CONTACT_R;
            for (let i = ents.length - 1; i >= 0; i--) {
                const ent = ents[i];
                if (!ent.alive || !ent.root) continue;
                const dx = ent.x - this._vanX, dz = ent.z - this._vanZ;
                if (dx * dx + dz * dz > R * R) continue;
                const enemyId = ent.enemyId;
                this._bioEnemies._remove(i);
                this._startBioEnemyBattle(enemyId);
                return;
            }
        }

        // Pause the drive (same suspend/resume the main menu uses) and push a
        // normal battle against the touched creature's own troop.
        _startBioEnemyBattle(enemyId) {
            const troopId = troopForBioEnemy(enemyId);
            if (!troopId) return;
            this._suspended = true;
            if (this._overlay) this._overlay.style.display = 'none';
            if (document.pointerLockElement === document.body) document.exitPointerLock();
            BattleManager.setup(troopId, true, false);
            SceneManager.push(Scene_Battle);
        }

        // Wheel dust offroad, tyre smoke while drifting, exhaust chuffs under
        // hard throttle. Rate-limited to ~11 spawns per second (lighter than
        // before so the camper leaves a thin trail instead of a smoke screen).
        _emitWheelFx(delta) {
            if (!this._wheelFx) return;
            this._fxEmitAcc = (this._fxEmitAcc || 0) + delta;
            if (this._fxEmitAcc < 0.09) return;
            this._fxEmitAcc = 0;
            const sin = Math.sin(this._driveAngle), cos = Math.cos(this._driveAngle);
            const rearX = this._vanX - sin * 10;
            const rearZ = this._vanZ - cos * 10;
            const spd  = this._speedKmh;
            const surf = this._surface;
            const drifting = this._slip01 > 0.3;
            // Wheel dust only on loose surfaces above a decent clip, or when drifting.
            if (this._env === 'road' && spd > 25 && surf && (surf.dust || drifting)) {
                const c = surf.dust ? [0.62, 0.54, 0.4] : [0.75, 0.75, 0.78];
                for (const s of [-1, 1]) {
                    this._wheelFx.spawn(
                        rearX + cos * 5 * s, this._vanY + 1.2, rearZ - sin * 5 * s,
                        -sin * spd * 0.10 + (Math.random() - 0.5) * 5,
                        3 + Math.random() * 4,
                        -cos * spd * 0.10 + (Math.random() - 0.5) * 5,
                        c[0], c[1], c[2], 0.5 + Math.random() * 0.4
                    );
                }
            }
            // Exhaust chuffs only on hard acceleration, and only every other tick.
            this._exhaustTick = ((this._exhaustTick || 0) + 1) % 2;
            if (this._exhaustTick === 0 &&
                this._env === 'road' && this._throttle01 > 0.7 && this._rpm > 0.7) {
                this._wheelFx.spawn(
                    rearX - cos * 4, this._vanY + 2.5, rearZ + sin * 4,
                    (Math.random() - 0.5) * 2.5, 4 + Math.random() * 3, (Math.random() - 0.5) * 2.5,
                    0.35, 0.35, 0.37, 0.6
                );
            }
        }

        _updateMovement(delta) {
            // Frozen while a water-rescue fade is in progress: hold the camper in
            // place until it has been teleported back onto land.
            if (this._waterRescue) {
                this._van.group.position.set(this._vanX, this._vanY, this._vanZ);
                return;
            }

            // Water crossing is always allowed while driving (the camper floats over
            // water even without the Amphibious upgrade); the consequence for having
            // no float upgrade is deferred to when the drive mode ends over water
            // (_endDriveToWorldMap splashes the camper down). So there is no longer a
            // "stranded in water" freeze here.

            // Clear the stuck flag (wedge / flip checks
            // below may re-raise it after the physics step).
            this._stuck = false;
            this._stuckReason = '';

            // Out of fuel (shared per-vehicle store with VehicleSystem, key
            // 'camper'): the camper can no longer move under power. Cancel any auto
            // travel and let it coast to a halt; throttle / boost are blocked until
            // refuelled.
            // The title background runs on its own tank: it neither reads nor
            // burns the save's fuel, so it can never strand itself.
            const fuelEmpty = !this._titleMode && camperFuelGet() <= 0;
            if (fuelEmpty) {
                const d = (typeof $gameSystem !== 'undefined' && $gameSystem.getFastTravelData)
                    ? $gameSystem.getFastTravelData() : null;
                if (d) d.timerActive = false;
            }

            const ftActive = !fuelEmpty && this._isFastTravelActive();
            const grounded = this._env === 'road';

            // Autopilot (title background): plans the route and works the wheel /
            // pedals, which _stepVehiclePhysics then reads instead of the keys.
            if (this._autopilot) this._autopilot.update(delta);

            // Resolve environment (road / air / water / underwater) and ease the
            // rig toward the matching ride height (snappier while grounded so the
            // camper hugs crests and dips instead of floating over them).
            const targetY = this._resolveEnv();
            this._fxTime = (this._fxTime || 0) + delta;

            if (ftActive) {
                // Auto travel hugs the ground (no ramp launches / no boost).
                this._airborne = false; this._vy = 0; this._boostActive = false;
                this._vanY += (targetY - this._vanY) * Math.min(1, delta * 4);
                // Liminal cruise: whichever is faster of the duration-guaranteed speed
                // (so a very long trip still arrives in time) and the flat warp-speed
                // cap, eased in over LIMINAL_ACCEL_SEC instead of snapping to it.
                // _speed / autoSpeed are in world units/sec, WORLD_SCALE times larger so
                // the fly-across-the-world fast travel still finishes within its
                // duration; the HUD / liminal / hand-back velocity are expressed in the
                // ORIGINAL km/h range (÷ WORLD_SCALE) so fast travel neither shows an
                // absurd speed nor trips the >130 km/h liminal overdrive, and manual
                // driving resumes at a normal speed.
                const cruiseKmh = Math.max(LIMINAL_TOP_KMH, this._speed / WORLD_SCALE);
                this._ftRampT = Math.min(LIMINAL_ACCEL_SEC, (this._ftRampT || 0) + delta);
                const rampT     = this._ftRampT / LIMINAL_ACCEL_SEC;
                const autoKmh   = cruiseKmh * (rampT * (2 - rampT));   // ease-out
                const autoSpeed = autoKmh * WORLD_SCALE;
                // Auto travel: fly in a straight line to the destination tile.
                const targetX = this._destWX * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;
                const targetZ = this._destWY * WORLD_TILE_SIZE + WORLD_TILE_SIZE * 0.5;
                const dx = targetX - this._vanX;
                const dz = targetZ - this._vanZ;
                if ((dx * dx + dz * dz) > 16) {
                    this._driveAngle = Math.atan2(dx, dz);
                    this._vanX += Math.sin(this._driveAngle) * autoSpeed * delta;
                    this._vanZ += Math.cos(this._driveAngle) * autoSpeed * delta;
                }
                this._steerSmooth *= 0.9;
                this._speedKmh = autoKmh;   // HUD readout
                this._velX = Math.sin(this._driveAngle) * autoKmh;
                this._velZ = Math.cos(this._driveAngle) * autoKmh;
                this._fwdSpeed = autoKmh;
                this._latSpeed = 0;
                this._throttle01 = 0;
                this._gearLabel = 'D';
                this._rpm += (0.55 - this._rpm) * Math.min(1, delta * 3);
            } else {
                // Full physics everywhere else; input only in the driving views,
                // so a parked camper still rolls, slides and settles naturally.
                const driving = (this._viewMode === 'car' || this._viewMode === 'fpdrive');
                this._stepVehiclePhysics(delta, driving && !fuelEmpty, driving);
                this._updateRideHeight(delta, targetY, grounded);
            }

            this._van.group.position.set(this._vanX, this._vanY, this._vanZ);

            // The body tracks the physics heading directly; with slip, the
            // velocity vector is allowed to point somewhere else (drift).
            let hd = this._driveAngle - this._van.group.rotation.y;
            while (hd < -Math.PI) hd += Math.PI * 2;
            while (hd >  Math.PI) hd -= Math.PI * 2;
            this._van.group.rotation.y += hd * Math.min(1, delta * 14);

            // Chassis follows the terrain slope (nose up the climb, camber lean),
            // but levels out to flat flight while airborne off a ramp.
            this._alignToTerrain(delta, grounded && !ftActive && !this._airborne);

            // Settle the steering lean back to centre when not actively driving.
            if ((this._viewMode !== 'car' && this._viewMode !== 'fpdrive') || ftActive) {
                this._steerSmooth *= Math.max(0, 1 - delta * 6);
            }

            // Wedged: throttling hard but not moving (jammed against terrain).
            const drivingNow = (this._viewMode === 'car' || this._viewMode === 'fpdrive');
            if (drivingNow && !ftActive && !fuelEmpty && this._throttle01 > 0.6 && this._speedKmh < 2) {
                this._wedgeTimer += delta;
            } else {
                this._wedgeTimer = 0;
            }
            if (!this._stuck && this._wedgeTimer > 1.6) {
                this._stuck = true;
                this._stuckReason = T('CamperDrive.wedged');
            }
            // Flipped onto its roof (rare in the arcade model, but a safety net).
            if (!this._stuck) {
                const up = this._vanUp || (this._vanUp = new THREE.Vector3());
                up.set(0, 1, 0).applyEuler(this._van.group.rotation);
                if (up.y < 0.25) { this._stuck = true; this._stuckReason = T('CamperDrive.flipped'); }
            }

            // ---- cosmetic body dynamics fed to the camper rig ----
            const ups   = this._fwdSpeed;
            const accel = (this._speedKmh - this._prevSpeedKmh) / Math.max(delta, 0.001);
            this._prevSpeedKmh = this._speedKmh;
            const speedFactor = Math.min(1, this._speedKmh / 160);
            this._odo += Math.abs(ups) * delta;
            this._speedUnitsSigned = ups;

            // Nose dives under braking, squats under acceleration.
            this._bodyPitch = Math.max(-BODY_PITCH_MAX, Math.min(BODY_PITCH_MAX, -accel * 0.0009));
            // Leans into the turn plus with any lateral slide.
            this._bodyRoll  = -this._steerSmooth * speedFactor * BODY_ROLL_MAX
                - Math.max(-1, Math.min(1, this._latSpeed / 30)) * 0.05;
            // Suspension rumble on the ground (rougher offroad via the surface's
            // bump factor and the seeded Perlin field); gentle swell afloat. The
            // rumble is muted while airborne (no wheels on the road).
            if (this._env === 'road' && !this._airborne) {
                const bump = this._surface ? this._surface.bump : 0;
                this._bodyBounce = Math.sin(this._odo * 0.05) * BODY_BOUNCE_MAX * speedFactor
                    + _perlin(this._odo * 0.09, 3.7) * bump * 1.1 * Math.min(1, this._speedKmh / 50);
            } else if (this._env === 'water') {
                this._bodyBounce = Math.sin(this._fxTime * 1.6) * 1.2;
            } else {
                this._bodyBounce = 0;
            }
            // Landing thud: a decaying suspension compression added on touchdown.
            if (this._landJolt > 0.001) {
                this._bodyBounce -= this._landJolt * 3.0;
                this._landJolt *= Math.max(0, 1 - delta * 5);
            }

            // Fender benders with the pooled traffic (never during auto travel).
            if (!ftActive && (this._env === 'road' || this._env === 'water')) {
                this._checkTrafficCollision(delta);
            }

            // Roaming wildlife: touching one drops straight into a battle (never
            // during the title's silent autopilot, free-play, or auto-travel).
            if (!ftActive && !this._titleMode && !this._standalone) {
                this._checkBioEnemyCollision();
            }

            // Wheel dust / tyre smoke / exhaust.
            this._emitWheelFx(delta);

            // Keep the 2D world coordinates (vars 43/44) in sync with the 3D
            // camper so the minimap and the world map agree. Only write when the
            // tile actually changes to avoid per-frame variable churn. The title
            // and free-play drives roam a world nobody is playing, so they never
            // move the party's world position.
            if (!this._titleMode && !this._standalone && typeof $gameVariables !== 'undefined') {
                const tileX = Math.floor(this._vanX / WORLD_TILE_SIZE);
                const tileY = Math.floor(this._vanZ / WORLD_TILE_SIZE);
                if (tileX !== this._lastSyncTileX || tileY !== this._lastSyncTileY) {
                    this._lastSyncTileX = tileX;
                    this._lastSyncTileY = tileY;
                    $gameVariables.setValue(43, tileX);
                    $gameVariables.setValue(44, tileY);
                }
            }

            // Remember the latest solid-ground spot so a no-float water entry can
            // bounce the camper back here. 'road' env only ever means dry land
            // (over-water-without-float returns early above; floating sets 'water').
            if (this._env === 'road') {
                this._lastLandX = this._vanX;
                this._lastLandZ = this._vanZ;
                this._lastLandAngle = this._driveAngle;
            }
        }

        // Ride height with ramp physics. Normally the rig eases onto the terrain,
        // but at speed a steep uphill crest launches it off the ground into a
        // ballistic arc: vertical velocity is thrown from the ramp angle & speed,
        // gravity pulls it back, and it lands (with a thud) when it meets the
        // ground again. The liminal boost throws it dramatically farther / higher.
        _updateRideHeight(delta, targetY, grounded) {
            if (grounded && !this._airborne &&
                this._speedKmh > LAUNCH_KMH && this._grade > LAUNCH_GRADE) {
                this._airborne = true;
                const over   = (this._speedKmh - LAUNCH_KMH) / 160;     // 0..~10
                const boostK = this._boostActive ? 2.4 : 1;            // boost = big air
                this._vy = Math.min(220, (34 + over * 80) * this._grade * 2.2 * boostK);
            }

            if (this._airborne) {
                // Lighter gravity under boost so a boosted launch sails for
                // kilometres before it comes back down.
                const g = this._boostActive ? AIR_GRAVITY * 0.6 : AIR_GRAVITY;
                this._vy -= g * delta;
                this._vanY += this._vy * delta;
                if (this._vanY <= targetY && this._vy <= 0) {
                    this._vanY = targetY;
                    this._airborne = false;
                    // Carry part of the impact into the suspension spring below,
                    // so a hard landing visibly compresses and rebounds.
                    this._suspVel = this._vy * 0.35;
                    this._vy = 0;
                    this._landJolt = Math.min(1, this._speedKmh / 130);
                }
            } else {
                // Damped suspension spring toward the ride height: the body loads
                // into dips and rebounds off crests with a little overshoot,
                // instead of gliding on an exponential ease. Substepped so the
                // explicit integration stays stable on long frames.
                const K = grounded ? 55 : 20;   // spring stiffness
                const D = grounded ? 11 : 9;    // damping
                const n = Math.max(1, Math.min(4, Math.ceil(delta / 0.033)));
                const dt = delta / n;
                let v = this._suspVel || 0;
                for (let i = 0; i < n; i++) {
                    v += ((targetY - this._vanY) * K - v * D) * dt;
                    this._vanY += v * dt;
                }
                this._suspVel = v;
            }
        }

        _updateFuel(delta) {
            if (this._titleMode) return;   // background drive: never burns the save's fuel

            // Track position regardless of branch below, so a mode switch never
            // reads a stale last-position as a huge one-frame "moved" distance.
            const hadLast = this._fuelLastX !== undefined;
            const lastX = this._fuelLastX, lastZ = this._fuelLastZ;
            this._fuelLastX = this._vanX;
            this._fuelLastZ = this._vanZ;

            const ftActive = this._isFastTravelActive();
            if (ftActive) {
                // Liminal (fast-travel) drive: burn a flat, tiny rate per REAL
                // second, never by the (fictional) warp distance covered - see
                // the constants' own comment for why.
                const boostMul = this._boostActive ? LIMINAL_BOOST_FUEL_MULT : 1;
                camperFuelConsume(LIMINAL_FUEL_PER_SEC * boostMul * delta);
                return;
            }

            if (!hadLast) return;
            // Fuel burn is ALWAYS proportional to the ACTUAL distance the camper
            // moved this frame, measured from its real world position (not from a
            // speed value, which a physics glitch or NaN could inflate) and never
            // from elapsed time. This is inherently frame-rate independent: standing
            // still costs nothing, a metre always costs the same, and a teleport /
            // bad frame cannot spike the burn (see the per-frame cap below).
            const dxp = this._vanX - lastX;
            const dzp = this._vanZ - lastZ;
            const moved = Math.sqrt(dxp * dxp + dzp * dzp);
            if (!isFinite(moved) || moved <= 0) return;

            // Gentle efficiency penalty when pushing well past cruise (up to ~1.8x
            // at 999 km/h). The per-unit rate is minuscule to suit the large world
            // scale, so a full tank comfortably covers very long journeys.
            const spd       = isFinite(this._speedKmh) ? this._speedKmh : 0;
            const surcharge = 1 + Math.max(0, spd - CRUISE_KMH) * 0.0009;
            // Boosting (turbo) drinks fuel far faster: propelling the camper for
            // kilometres in a burst has a steep cost at the pump.
            const boostMul  = this._boostActive ? BOOST_FUEL_MULT : 1;
            // Hard ceiling per frame: a legitimate cruise burn is ~0.01 L. Boosting
            // burns far more, so the cap is lifted while boosting yet still guards
            // against a single teleport / bad frame draining the whole tank.
            const cap  = this._boostActive ? 0.6 : 0.05;
            const burn = Math.min(moved * FUEL_PER_UNIT * surcharge * boostMul, cap);

            if (!(burn > 0)) return;
            // Burn from the camper's own tank in the per-vehicle store (never a
            // shared RPG Maker variable), clamped to empty by VehicleFuel.
            camperFuelConsume(burn);
        }

        dispose() {
            if (this._animId) cancelAnimationFrame(this._animId);
            if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
            CamperWeapon.end();
            document.removeEventListener('wheel',     this._onWheel);
            document.removeEventListener('keydown',   this._onFreeCamKeyDown);
            document.removeEventListener('keyup',     this._onFreeCamKeyUp);
            document.removeEventListener('mousedown', this._onFreeCamMouseDown);
            document.removeEventListener('mouseup',   this._onFreeCamMouseUp);
            document.removeEventListener('mousemove', this._onFreeCamMouseMove);
            if (this._onTitleLookDown) {
                document.removeEventListener('pointerdown',   this._onTitleLookDown);
                document.removeEventListener('pointermove',   this._onTitleLookMove);
                document.removeEventListener('pointerup',     this._onTitleLookUp);
                document.removeEventListener('pointercancel', this._onTitleLookUp);
                this._onTitleLookDown = this._onTitleLookMove = this._onTitleLookUp = null;
            }
            if (this._onEscKey) document.removeEventListener('keydown', this._onEscKey);
            if (this._onTabKey) document.removeEventListener('keydown', this._onTabKey);
            if (this._onMapKey) document.removeEventListener('keydown', this._onMapKey);
            if (this._onActionKey) document.removeEventListener('keydown', this._onActionKey);
            if (this._freeCamActive) this._scene.remove(this._camera);
            if (this._weatherFx)    this._weatherFx.dispose();
            if (this._water)        this._water.dispose();
            if (this._traffic)      this._traffic.dispose();
            if (this._underwaterFx) this._underwaterFx.dispose();
            if (this._skyFx)        this._skyFx.dispose();
            if (this._wheelFx)      this._wheelFx.dispose();
            if (this._bioEnemies)   this._bioEnemies.dispose();
            if (this._engine)       this._engine.dispose();
            if (this._liminal)      this._liminal.dispose();
            if (this._speedFx)      this._speedFx.dispose();

            // Free the externally-created headlight beam materials + shared
            // texture (parented to _van.group, not tracked by CamperModel).
            if (this._beams) {
                for (const b of this._beams) { if (b.material) b.material.dispose(); }
                this._beams = null;
            }
            if (this._beamTex) { this._beamTex.dispose(); this._beamTex = null; }

            this._fpc.dispose();
            this._terrain.dispose();
            this._van.dispose();
            this._hud.dispose();
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
            if (this._overlay && this._overlay.parentNode) {
                this._overlay.parentNode.removeChild(this._overlay);
            }
        }
    }

    // =========================================================================
    // CamperDrivingSystem, static entry point
    // =========================================================================
    const CamperDrivingSystem = {
        _scene: null,
        start(duration, destinationName, totalKm) {
            if (this._scene) this.stop();
            const data     = (typeof $gameSystem !== 'undefined') ? $gameSystem.getFastTravelData() : null;
            const fuelCost = data ? (data.totalDistanceKm * FUEL_PER_KM) : 0;
            this._scene = new CamperDrivingScene(
                duration,
                typeof destinationName === 'string' ? destinationName
                    : (destinationName?.name || T('CamperDrive.destination')),
                totalKm || (data ? data.totalDistanceKm : 100),
                fuelCost
            );
        },
        // Launch a free-play drive that is NOT tied to fast travel or the world
        // map (used by the Minigames menu). onExit() runs when the player quits
        // with Esc / Cancel, so the caller can return to its own scene.
        startStandalone(onExit) {
            if (this._scene) this.stop();
            // Long "duration" so the auto-travel timer never ends the drive; the
            // destination equals the start tile, so the camper simply sits parked
            // on its random stretch of road until the player drives it.
            this._scene = new CamperDrivingScene(999999, T('CamperDrive.freeDrive'), 100, 0, { standalone: true });
            this._scene._onStandaloneExit = (typeof onExit === 'function') ? onExit : null;
        },
        // Silent background drive for the title screen: the real world map, with
        // an autopilot following the tagged roads and turning at random wherever
        // a junction offers a choice. No HUD, no controls, no save writes. Returns
        // the scene (so the caller can read its readout) or null when the world's
        // road data has not been loaded yet.
        startTitleDrive() {
            if (!roadDataReady()) return null;
            if (this._scene) this.stop();
            this._scene = new CamperDrivingScene(999999, T('CamperDrive.autopilot'), 100, 0, { titleMode: true });
            return this._scene;
        },
        // True once the world's road tags are available to plan a route from.
        isWorldRoadDataReady() { return roadDataReady(); },
        stop() {
            if (!this._scene) return;
            this._scene.dispose();
            this._scene = null;
        },
        isActive() { return !!this._scene; },
        isTitleDrive() { return !!(this._scene && this._scene._titleMode); },
        // Gate the modular upgrades from game logic, e.g.
        //   CamperDrivingSystem.setUpgrades({ fly:true, float:true, dive:false })
        // Absent any call, every upgrade is available.
        setUpgrades(up) {
            if (typeof $gameSystem === 'undefined' || !up) return;
            $gameSystem._camperUpgrades = Object.assign($gameSystem._camperUpgrades || {}, up);
        }
    };

    window.CamperDrivingSystem = CamperDrivingSystem;

    PluginManager.registerCommand('CamperDrivingSystem', 'StartDriving', args => {
        CamperDrivingSystem.start(
            Number(args.duration) || 60,
            T.param(args.destinationName, 'CamperDrive.destination'),
            Number(args.totalKm) || 100
        );
    });

    const _startTravelTimer = Game_System.prototype.startTravelTimer;
    Game_System.prototype.startTravelTimer = function(duration, transport, destination, totalKm) {
        _startTravelTimer.call(this, duration, transport, destination, totalKm);
        if (transport === 'camper') CamperDrivingSystem.start(duration, destination, totalKm);
    };

    const _completeTravelTimer = Game_System.prototype.completeTravelTimer;
    Game_System.prototype.completeTravelTimer = function() {
        _completeTravelTimer.call(this);
        CamperDrivingSystem.stop();
    };

    const _stopTravelTimer = Game_System.prototype.stopTravelTimer;
    Game_System.prototype.stopTravelTimer = function() {
        _stopTravelTimer.call(this);
        CamperDrivingSystem.stop();
    };

    const _Scene_Map_isMenuEnabled_CDS = Scene_Map.prototype.isMenuEnabled;
    Scene_Map.prototype.isMenuEnabled = function() {
        if (CamperDrivingSystem.isActive()) return false;
        return _Scene_Map_isMenuEnabled_CDS.call(this);
    };
})();