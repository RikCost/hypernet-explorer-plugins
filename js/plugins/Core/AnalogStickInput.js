/*:
 * @target MZ
 * @plugindesc Shared left/right analog-stick input helper for DOM plugin UIs. v1.0
 * @author Hypernet
 *
 * @param deadzone
 * @text Deadzone
 * @desc Radial deadzone for the left stick (0-1). Below this, the stick reads as 0.
 * @type number
 * @decimals 2
 * @default 0.30
 *
 * @help
 * ============================================================================
 * AnalogStickInput
 * ============================================================================
 * RMMZ core already folds the LEFT analog stick into up/down/left/right (see
 * Input._updateGamepadState in rmmz_core.js), so any menu that navigates with
 * Input.isRepeated('up') already supports the stick for discrete navigation.
 *
 * This helper adds the three things core does NOT provide:
 *   1. A tunable, deadzoned RAW axis API for analog pointer / camera panning /
 *      zoom in spatial UIs (star map, OS desktop, world/travel map, editors).
 *   2. A discrete key-repeat direction API for the rare DOM scenes that cannot
 *      route through RMMZ Input.
 *   3. Hysteresis on core's own stick-to-d-pad fold, so a stick resting near
 *      the threshold latches once instead of flapping across it and walking a
 *      grid menu diagonally. See snapAxes() in the body.
 *
 * Use exactly one discrete source per scene to avoid double-firing: an
 * Input-based menu keeps using Input.isRepeated (stick already included); only
 * a scene that bypasses Input should use AnalogStickInput.isRepeated().
 *
 * API (window.AnalogStickInput):
 *   leftX()/leftY()    deadzone-scaled [-1,1]  (Y positive = down)
 *   rightX()/rightY()  right stick
 *   leftTrigger()/rightTrigger()  L2/R2 analog triggers, [0,1] (standard
 *                      gamepad mapping buttons[6]/[7].value; 0 when absent)
 *   isActive()         left stick outside deadzone this frame
 *   isRepeated(dir)    key-repeat pulses for 'up'|'down'|'left'|'right'
 *   isTriggered(dir)   first-frame only
 *   hasPad()           a gamepad is connected right now (drives whether a UI
 *                      shows keyboard or controller button hints)
 *   isButtonPressed(i) / isButtonTriggered(i)  raw standard-mapping button by
 *                      index, edge-detected. Use for buttons whose Input action
 *                      is bound to a colliding keyboard key (e.g. Y = 'menu' =
 *                      Escape), where Input.isTriggered would fire on both.
 *                      Indices are on AnalogStickInput.BUTTON (A/B/X/Y/LB/RB/
 *                      LT/RT/BACK/START/L3/R3).
 *   deadzone           tunable number (default 0.30)
 *
 * Polled once per frame by aliasing Input.update; no core files are modified.
 * ============================================================================
 */

(() => {
    'use strict';

    const params = PluginManager.parameters('Core/AnalogStickInput');
    const DEFAULT_DEADZONE = Number(params['deadzone'] || 0.30);

    // Magnitude past which a single axis counts as a "press" for discrete nav,
    // and the lower magnitude it has to fall back to before it counts as
    // released. The gap is a Schmitt trigger: see snapAxes() below for why a
    // single threshold is not enough on a real stick.
    const STEP_THRESHOLD = 0.5;
    const STEP_RELEASE = 0.35;

    // Latched per-axis direction for the left stick, shared by the RMMZ core
    // hook and this helper's own discrete API so both read the same press.
    const _latch = { x: 0, y: 0 };

    // A gamepad stick held toward a corner does not sit still: it wobbles a few
    // hundredths either side of wherever the thumb is resting. RMMZ core folds
    // the stick into the d-pad with a bare `axis > 0.5` test, so an axis parked
    // near the threshold crosses it over and over, and every crossing is a fresh
    // key press. Input.update tracks a single _latestButton, so those crossings
    // alternate it between (say) 'down' and 'right', which is what walks a
    // two-column grid diagonally instead of down it: one step down, one step
    // right, one step down. It is worst on a Steam Deck, whose sticks rest
    // slightly off-centre and whose menus are the two-column archetype pickers.
    //
    // Hysteresis fixes it without costing anything else: an axis has to reach
    // 0.5 to latch and fall under 0.35 to let go, so a held direction latches
    // once and stays latched. Diagonal MOVEMENT is untouched, because both axes
    // may be latched at the same time; it is only the flapping that stops.
    function snapAxes(axes) {
        const out = Array.prototype.slice.call(axes || []);
        const raw = ['x', 'y'];
        for (let i = 0; i < 2; i++) {
            const v = out[i] || 0;
            const key = raw[i];
            if (Math.abs(v) >= STEP_THRESHOLD) {
                _latch[key] = v < 0 ? -1 : 1;
            } else if (Math.abs(v) < STEP_RELEASE) {
                _latch[key] = 0;
            }
            // Report the latched direction at full deflection so whatever
            // threshold the consumer uses agrees with the latch.
            out[i] = _latch[key];
        }
        return out;
    }

    // RMMZ core reads the raw axes straight off the gamepad; hand it the latched
    // ones instead. _gamepadStates is keyed by index, so a plain shim carrying
    // the same index and buttons is all core needs.
    const _Input_updateGamepadState = Input._updateGamepadState;
    Input._updateGamepadState = function (gamepad) {
        _Input_updateGamepadState.call(this, {
            index: gamepad.index,
            buttons: gamepad.buttons,
            axes: snapAxes(gamepad.axes)
        });
    };

    const AnalogStickInput = {
        deadzone: DEFAULT_DEADZONE,

        _lx: 0, _ly: 0, _rx: 0, _ry: 0,
        _lt: 0, _rt: 0,
        _padOn: false,
        // Raw button state this frame and last, for edge detection.
        _btn: [], _btnPrev: [],
        // Per-direction hold-frame counters for key-repeat emulation.
        _hold: { up: 0, down: 0, left: 0, right: 0 },
        // Pulse flags computed this frame.
        _pulse: { up: false, down: false, left: false, right: false },

        leftX() { return this._lx; },
        leftY() { return this._ly; },
        rightX() { return this._rx; },
        rightY() { return this._ry; },
        leftTrigger() { return this._lt; },
        rightTrigger() { return this._rt; },

        // Standard gamepad mapping (Xbox layout labels).
        // i18n-ignore-start: physical controller button ids
        BUTTON: {
            A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
            BACK: 8, START: 9, L3: 10, R3: 11
        },
        // i18n-ignore-end

        hasPad() { return this._padOn; },
        isButtonPressed(i) { return !!this._btn[i]; },
        isButtonTriggered(i) { return !!this._btn[i] && !this._btnPrev[i]; },

        isActive() { return this._lx !== 0 || this._ly !== 0; },

        isRepeated(dir) { return !!this._pulse[dir]; },
        isTriggered(dir) { return !!this._pulse[dir] && this._hold[dir] === 1; },

        // Radial deadzone with edge rescaling: deadzone edge -> 0, full -> 1.
        _applyDeadzone(x, y) {
            const mag = Math.sqrt(x * x + y * y);
            if (mag < this.deadzone) return [0, 0];
            const scaled = (mag - this.deadzone) / (1 - this.deadzone);
            const k = scaled / mag;
            return [x * k, y * k];
        },

        _readPads() {
            if (!navigator.getGamepads) return null;
            const pads = navigator.getGamepads();
            if (!pads) return null;
            for (const pad of pads) {
                if (pad && pad.connected && pad.axes && pad.axes.length >= 2) return pad;
            }
            return null;
        },

        update() {
            const pad = this._readPads();
            this._padOn = !!pad;
            this._btnPrev = this._btn;
            this._btn = pad
                ? Array.prototype.map.call(pad.buttons || [], (b) => !!(b && b.pressed))
                : [];
            if (pad) {
                const [lx, ly] = this._applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0);
                this._lx = lx;
                this._ly = ly;
                if (pad.axes.length >= 4) {
                    const [rx, ry] = this._applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0);
                    this._rx = rx;
                    this._ry = ry;
                } else {
                    this._rx = this._ry = 0;
                }
                // Standard gamepad mapping: buttons[6] = L2, buttons[7] = R2,
                // both analog triggers exposing 0-1 via .value.
                const btns = pad.buttons || [];
                this._lt = (btns[6] && btns[6].value) || 0;
                this._rt = (btns[7] && btns[7].value) || 0;
            } else {
                this._lx = this._ly = this._rx = this._ry = 0;
                this._lt = this._rt = 0;
            }

            // Discrete key-repeat emulation. Read off the same latch the RMMZ
            // core hook uses (see snapAxes) rather than the analog values, so a
            // DOM scene stepping through a list and a Window_Selectable doing
            // the same both see one steady press instead of a stick flapping
            // across the threshold.
            const dirState = {
                up: _latch.y < 0,
                down: _latch.y > 0,
                left: _latch.x < 0,
                right: _latch.x > 0
            };
            const wait = Input.keyRepeatWait;
            const interval = Input.keyRepeatInterval;
            for (const dir of ['up', 'down', 'left', 'right']) {
                if (dirState[dir]) {
                    this._hold[dir]++;
                    const t = this._hold[dir];
                    this._pulse[dir] = (t === 1) ||
                        (t >= wait && (t - wait) % interval === 0);
                } else {
                    this._hold[dir] = 0;
                    this._pulse[dir] = false;
                }
            }
        }
    };

    window.AnalogStickInput = AnalogStickInput;

    // Poll once per frame, in lockstep with the rest of input.
    const _Input_update = Input.update;
    Input.update = function () {
        _Input_update.call(this);
        AnalogStickInput.update();
    };
})();
