//=============================================================================
// VoxelWorldHUD.js
// VoxelWorld: the driving / walking HUD and the weather particle systems
//
// Part of the VoxelWorld suite. The ground of that world is a field of small
// destructible voxels; this module is one slice of the machinery laid over it.
// Load order is fixed in plugins.js and every module reads the shared state it
// needs off window.VoxelWorld.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc VoxelWorld - the driving / walking HUD and the weather particle systems
 * @author Omni-Lex
 *
 * @help
 * the driving / walking HUD and the weather particle systems.
 *
 * One module of the VoxelWorld suite (VoxelWorldCore.js loads first). It
 * declares no plugin commands of its own; those live in VoxelWorldSystem.js.
 */

(() => {
    'use strict';

    const VW = window.VoxelWorld;
    if (!VW) { console.error('[VoxelWorld] core not loaded before VoxelWorldHUD.js'); return; }

    const {
        WORLD_TILE_SIZE, camperFuelGet, camperMaxFuel
    } = VW;

    // =========================================================================
    // CamperHUD
    // =========================================================================
    // The icon the quick bar's first cell wears: the weapon in the leader's
    // hands, drawn off the game's own icon sheet (js/db Icons.json - 96 is the
    // plain sword).
    const BAR_WEAPON_ICON = 96;

    class CamperHUD {
        // `silent` builds no HUD at all (title-screen background drive): every
        // panel is skipped and the per-frame updates become no-ops. `walk` is the
        // free-walk HUD: no camper is in the scene, so the fuel gauge, the speedo,
        // the ability chips and the journey readout are all left out and only the
        // map and the walking controls remain.
        constructor(overlay, destinationName, totalKm, silent, walk) {
            this._destination = destinationName;
            this._totalKm     = totalKm;
            this._autoDrive   = true;
            this._silent      = !!silent;
            this._walk        = !!walk;
            this._el          = null;
            if (this._silent) return;
            // Minimap view modes cycled with [M], the same four WorldMap.js
            // cycles through on map 315 so the key means one thing everywhere:
            //   'zoom'   a close window on the squares around the party, ruled
            //            with the world grid so a square can be counted off it
            //   'total'  the whole 256 by 256 world in the same little panel
            //   'full'   the world across the whole screen, dragged and zoomed
            //   'hidden' the panel off
            // It opens on 'zoom', the view that actually tells a walker where
            // the next hill is.
            this._mapModes    = ['zoom', 'total', 'full', 'hidden'];
            this._mapMode     = 'zoom';
            // The big map's own pan and zoom, kept between openings.
            this._fullPan     = { x: 0, y: 0 };
            this._fullZoom    = 1;
            this._fullDrag    = null;
            this._build(overlay);
        }

        // Advance to the next minimap view mode ([M] key). Returns the new mode so
        // the caller can surface a label / sound if desired.
        cycleMapMode() {
            const i = this._mapModes.indexOf(this._mapMode);
            this._mapMode = this._mapModes[(i + 1) % this._mapModes.length];
            // Coming back to the big map always re-centres it on the party:
            // a map dragged off to Siberia last time is not a map.
            if (this._mapMode === 'full') { this._fullPan.x = 0; this._fullPan.y = 0; }
            this._syncFullMap();
            return this._mapMode;
        }

        // Which view the map is in, for the scene: the big map wants the mouse,
        // and while it has it nobody is walking.
        mapMode() { return this._mapMode; }
        isFullMapOpen() { return this._mapMode === 'full'; }
        // Put the big map away without cycling past the rest of the modes
        // (Escape, or anything else that closes what is over the world).
        closeFullMap() {
            if (this._mapMode !== 'full') return false;
            this._mapMode = 'zoom';
            this._syncFullMap();
            return true;
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
                    padding:10px 14px; color:#ecdcb9; font-size:17px;
                    line-height:1.5; ${style}
                `;
                d.innerHTML = html;
                return d;
            };

            this._fuelPanel = this._walk ? null : panel(`
                <div style="font-size:14px; font-weight:bold; color:#a1680d; letter-spacing:1px; margin-bottom:4px">${T('CamperDrive.hud.fuel')}</div>
                <div id="cds-fuel-bar-wrap" style="width:160px; height:10px; background:rgba(255,255,255,0.1); border-radius:5px; overflow:hidden; margin-bottom:4px">
                  <div id="cds-fuel-bar" style="height:100%; width:80%; background:#4caf50; border-radius:5px; transition:width 0.5s,background 0.5s"></div>
                </div>
                <div id="cds-fuel-text" style="font-size:15px; color:#ecdcb9">-- L / 100 L</div>
            `, 'top:16px;left:16px;min-width:200px;');

            // Top-right minimap mirroring the 2D world map (map 315). The camper
            // dot tracks the live 3D world position so 2D and 3D stay in sync.
            const MINI_W = 220, MINI_H = 160;
            this._miniW = MINI_W;
            this._miniH = MINI_H;
            this._miniPanel = panel(`
                <div style="font-size:14px; font-weight:bold; color:#a1680d; letter-spacing:1px; margin-bottom:4px">${T('CamperDrive.hud.map')}</div>
                <canvas id="cds-minimap" width="${MINI_W}" height="${MINI_H}" style="display:block; width:${MINI_W}px; height:${MINI_H}px; border:1px solid rgba(139,90,43,0.45); border-radius:3px"></canvas>
                <div id="cds-map-coords" style="font-size:15px; color:#ecdcb9; text-align:right; margin-top:4px">0, 0</div>
            `, 'top:16px;right:16px;');

            this._mapImgReady = false;
            this._mapImg = new Image();
            this._mapImg.onload = () => { this._mapImgReady = true; };
            this._mapImg.src = 'img/pictures/worldmap.png';
            // Which world this map is of. Null is Earth; a landed descriptor
            // replaces the whole thing with that planet's own chart.
            this._planet = null;
            this._planetTex = null;

            this._journeyPanel = this._walk ? null : panel(`
                <div id="cds-dest-name" style="font-size:21px; font-weight:bold; color:#ffe8b0; text-align:center; margin-bottom:4px">${this._destination || T('CamperDrive.hud.destination')}</div>
                <div style="display:flex; justify-content:space-around; gap:20px">
                    <div style="text-align:center">
                        <div style="font-size:13px; color:#a1680d; letter-spacing:1px">${T('CamperDrive.hud.time')}</div>
                        <div id="cds-time-text" style="font-size:19px; color:#ecdcb9">--:--</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:13px; color:#a1680d; letter-spacing:1px">${T('CamperDrive.hud.distance')}</div>
                        <div id="cds-dist-text" style="font-size:19px; color:#ecdcb9">-- km</div>
                    </div>
                </div>
            `, 'bottom:20px;left:50%;transform:translateX(-50%);min-width:260px;text-align:center;');

            this._modePanel = document.createElement('div');
            this._modePanel.style.cssText = `
                position:absolute; bottom:20px; left:16px;
                background:rgba(10,6,3,0.72); border:2px solid rgba(139,90,43,0.55);
                border-radius:6px; padding:10px 14px; color:#ecdcb9;
                font-family:'Lora',serif; font-size:16px; pointer-events:auto;
            `;
            // A short, stacked list of only the commands a player needs at a
            // glance (not every key the scene answers to): each row is a key
            // badge plus a short label, one per line, easier to scan than the
            // old run-on paragraph.
            const CMD_ROWS = this._walk ? [
                ['WASD', T('CamperDrive.hud.cmdWalk')],
                ['SHIFT', T('CamperDrive.hud.cmdRun')],
                ['SPACE', T('CamperDrive.hud.cmdJump')],
                ['SPACE&times;2', T('CamperDrive.hud.cmdFly')],
                ['CTRL', T('CamperDrive.hud.cmdCrouch')],
                ['SPACE / CTRL', T('CamperDrive.hud.cmdSwim')],
                ['E', T('CamperDrive.hud.cmdTalk')],
                ['LMB', T('VoxelWorld.hud.cmdDig')],
                ['G', T('VoxelWorld.hud.cmdPlace')],
                ['Q', T('VoxelWorld.hud.cmdBlock')],
                ['ESC', T('CamperDrive.hud.cmdMenu')],
                ['T', T('CamperDrive.hud.cmdExitWalk')]
            ] : [
                ['WASD', T('CamperDrive.hud.cmdDrive')],
                ['SHIFT', T('CamperDrive.hud.cmdTurbo')],
                ['E', T('CamperDrive.hud.cmdDoor')],
                ['TAB', T('CamperDrive.hud.cmdView')],
                ['ESC', T('CamperDrive.hud.cmdVehicle')]
            ];
            const cmdRowHTML = ([key, label]) => `
                <div style="display:flex; align-items:center; gap:8px">
                    <span style="min-width:36px; text-align:center; background:rgba(139,90,43,0.35); border:1px solid rgba(161,104,13,0.8); padding:2px 6px; font-size:14px; font-weight:bold; color:#ffe8b0; letter-spacing:0.5px">${key}</span>
                    <span style="font-size:15px; color:#ecdcb9">${label}</span>
                </div>`;
            const headerHTML = this._walk
                ? `<div style="font-size:16px; font-weight:bold; color:#ffe8b0">${T('CamperDrive.viewMode.foot')}</div>
                   <div style="margin-top:4px">${T('CamperDrive.hud.mode')} <span id="cds-env-label" style="color:#7fd0ff">${T('CamperDrive.envMode.land')}</span></div>`
                : `<div id="cds-mode-btn">${T('CamperDrive.hud.view')} <span id="cds-mode-label" style="color:#4caf50">${T('CamperDrive.viewMode.fpdrive')}</span> [TAB]</div>
                   <div style="margin-top:4px">${T('CamperDrive.hud.mode')} <span id="cds-env-label" style="color:#7fd0ff">${T('CamperDrive.envMode.road')}</span></div>`;
            this._modePanel.innerHTML = `
                ${headerHTML}
                <div id="cds-cmd-list" style="margin-top:8px; display:none; flex-direction:column; gap:5px">
                    ${CMD_ROWS.map(cmdRowHTML).join('')}
                </div>
                <div id="cds-cmd-hint" style="margin-top:6px; font-size:14px; color:#a1680d">
                    ${T('CamperDrive.hud.cmdHelp')}
                </div>
                <div id="cds-controller-hint" style="margin-top:8px; font-size:14px; color:#7fd0ff; line-height:1.45; display:none">
                    ${T(this._walk ? 'CamperDrive.hud.controllerHintWalk' : 'CamperDrive.hud.controllerHint')}
                </div>`;
            // Nothing to switch to on a free walk, so the panel is a plain legend
            // there rather than the view-mode button.
            if (!this._walk) {
                this._modePanel.style.cursor = 'pointer';
                this._modePanel.onclick = () => {
                    if (window.VoxelWorldSystem && VoxelWorldSystem._scene) {
                        VoxelWorldSystem._scene._cycleViewMode();
                    }
                };
            }

            this._speedPanel = this._walk ? null : panel(`
                <div id="cds-speed-text" style="font-size:24px; font-weight:bold; color:#ecdcb9; text-align:center">0 km/h</div>
                <div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-top:2px">
                    <span id="cds-gear-text" style="font-size:16px; font-weight:bold; color:#a1680d; min-width:14px">N</span>
                    <span style="display:inline-block; width:70px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden">
                        <span id="cds-rpm-bar" style="display:block; height:100%; width:10%; background:#e8c840"></span>
                    </span>
                </div>`,
                'top:16px;left:50%;transform:translateX(-50%);min-width:130px;text-align:center;'
            );

            // Status strip under the speedo: ability chips (Fly / Float / Dive,
            // dim when locked, lit when unlocked, highlighted when active) plus the
            // vehicle condition and a live trip odometer.
            this._statusPanel = this._walk ? null : panel(`
                <div style="display:flex; gap:9px; justify-content:center; align-items:center; font-size:14px; font-weight:bold; letter-spacing:0.5px">
                    <span id="cds-ab-fly">${T('CamperDrive.hud.fly')}</span>
                    <span id="cds-ab-float">${T('CamperDrive.hud.float')}</span>
                    <span id="cds-ab-dive">${T('CamperDrive.hud.dive')}</span>
                </div>
                <div id="cds-status-meta" style="display:flex; gap:14px; justify-content:center; margin-top:5px; font-size:14px; color:#a1680d">
                    <span id="cds-cond-wrap">${T('CamperDrive.hud.cond')} <span id="cds-cond" style="color:#4caf50">--</span></span>
                    <span>${T('CamperDrive.hud.trip')} <span id="cds-trip" style="color:#ecdcb9">0.0 km</span></span>
                </div>
            `, 'top:88px;left:50%;transform:translateX(-50%);min-width:150px;text-align:center;');

            // The walker's own abilities, where the camper's speedo and its
            // Fly / Float / Dive chips would be: the water is always open to a
            // swimmer, and the air is open to whoever leads a party that knows
            // the Fly skill.
            this._walkStatusPanel = this._walk ? panel(`
                <div style="display:flex; gap:9px; justify-content:center; align-items:center; font-size:14px; font-weight:bold; letter-spacing:0.5px">
                    <span id="cds-ab-swim">${T('CamperDrive.hud.swim')}</span>
                    <span id="cds-ab-dive">${T('CamperDrive.hud.dive')}</span>
                    <span id="cds-ab-fly">${T('CamperDrive.hud.fly')}</span>
                </div>
            `, 'top:16px;left:50%;transform:translateX(-50%);min-width:150px;text-align:center;') : null;

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
                <div id="cds-respawn-reason" style="font-size:19px; color:#ffb3a0; margin-bottom:6px">${T('CamperDrive.hud.camperStuck')}</div>
                <div style="font-size:23px; font-weight:bold; color:#ffe8b0">${T('CamperDrive.hud.pressRToRespawn', { key: '<span style="color:#ff7a55">R</span>' })}</div>`;

            // The eye's own mark, and what pressing the action key would do
            // right now: both belong to walking, and setPrompt hides them again
            // the moment the party is back behind the wheel.
            this._crosshair = document.createElement('div');
            this._crosshair.style.cssText = `
                position:absolute; top:50%; left:50%; width:5px; height:5px;
                margin:-2.5px 0 0 -2.5px; border-radius:50%;
                background:rgba(255,240,210,0.75);
                box-shadow:0 0 3px rgba(0,0,0,0.9); display:none;
            `;
            // What the pick is pointed at and what it would put back, with the
            // bar that fills while a cube is coming apart. Only ever shown on
            // foot, and only while something is actually in reach.
            this._digPanel = document.createElement('div');
            this._digPanel.style.cssText = `
                position:absolute; bottom:20px; right:16px;
                background:rgba(10,6,3,0.72); border:2px solid rgba(139,90,43,0.55);
                border-radius:6px; padding:8px 12px; color:#ecdcb9;
                font-family:'Lora',serif; font-size:15px; min-width:150px;
                display:none;
            `;
            this._digPanel.innerHTML = `
                <div id="vw-dig-target" style="color:#ffe8b0; font-weight:bold"></div>
                <div style="height:4px; margin:5px 0 6px 0; background:rgba(0,0,0,0.5);
                            border:1px solid rgba(139,90,43,0.6); border-radius:2px">
                    <div id="vw-dig-bar" style="height:100%; width:0%; background:#d8a24a"></div>
                </div>
                <div id="vw-dig-held" style="font-size:14px; color:#a1680d"></div>`;

            this._promptEl = document.createElement('div');
            this._promptEl.style.cssText = `
                position:absolute; top:56%; left:50%; transform:translateX(-50%);
                background:rgba(10,6,3,0.72); border:1px solid rgba(139,90,43,0.6);
                border-radius:5px; padding:5px 12px; color:#ffe8b0;
                font-family:'Lora',serif; font-size:17px; white-space:nowrap;
                display:none;
            `;
            for (const el of [this._fuelPanel, this._miniPanel, this._journeyPanel,
                this._modePanel, this._speedPanel, this._statusPanel,
                this._walkStatusPanel, this._digPanel, this._crosshair,
                this._promptEl, this._respawnHint]) {
                if (el) hud.appendChild(el);
            }
            // The quick bar. Along the bottom of the screen, out of the way of
            // the crosshair: the weapon in the leader's hands in the first cell
            // and every kind of block they have dug up in the rest of them. The
            // wheel (or L1/R1) runs along it, and the cell in hand is the lit
            // one. Empty until the first swing lands, and gone with the walk.
            this._barPanel = document.createElement('div');
            this._barPanel.id = 'vw-blockbar';
            this._barPanel.style.cssText = `
                position:absolute; left:0px; right:0px; bottom:18px;
                display:none; justify-content:center; gap:6px;
                pointer-events:none; z-index:4;
            `;
            hud.appendChild(this._barPanel);
            this._barCells = null;
            this._barKey = '';

            // The big map. It lives over everything, takes the mouse while it
            // is up, and is empty until [M] cycles onto it.
            this._fullPanel = document.createElement('div');
            this._fullPanel.style.cssText = `
                position:absolute; left:0px; top:0px; width:100%; height:100%;
                display:none; pointer-events:auto; z-index:6;
                background:rgba(6,4,2,0.86);
            `;
            this._fullPanel.innerHTML = `
                <canvas id="cds-worldmap-full" style="position:absolute; left:0px; top:0px;
                    width:100%; height:100%; cursor:grab"></canvas>
                <div id="cds-worldmap-full-coords" style="position:absolute; right:22px; bottom:18px;
                    color:#ecdcb9; font-size:19px; background:rgba(10,6,3,0.72);
                    border:2px solid rgba(139,90,43,0.55); border-radius:6px; padding:6px 12px">0, 0</div>
            `;
            hud.appendChild(this._fullPanel);
            this._bindFullMap();

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
                abSwim:   document.getElementById('cds-ab-swim'),
                cmdList:  document.getElementById('cds-cmd-list'),
                cmdHint:  document.getElementById('cds-cmd-hint'),
                controllerHint: document.getElementById('cds-controller-hint'),
                condWrap: document.getElementById('cds-cond-wrap'),
                condEl:   document.getElementById('cds-cond'),
                tripEl:   document.getElementById('cds-trip'),
            };
            // The legend is folded away until H asks for it.
            this._cmdList = this._els.cmdList;
            this._cmdHint = this._els.cmdHint;
            this.setCommandsVisible(false);
            // Last-written values for dirty-checking (avoid redundant DOM writes).
            this._last = {};
        }

        // What the action key would do where the party is standing, or nothing.
        setPrompt(text, onFoot) {
            if (this._silent) return;
            // The centre of a split screen is the seam: nothing is aimed there.
            const cross = onFoot && !this._split;
            if (this._crosshair && this._lastCross !== cross) {
                this._lastCross = cross;
                this._crosshair.style.display = cross ? 'block' : 'none';
            }
            if (!this._promptEl) return;
            const t = cross ? (text || '') : '';
            if (t === this._lastPrompt) return;
            this._lastPrompt = t;
            this._promptEl.textContent = t;
            this._promptEl.style.display = t ? 'block' : 'none';
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
            const colors = { road: '#7fd0ff', land: '#7fd0ff', air: '#b388ff',
                             water: '#4dd0e1', underwater: '#26a69a', cave: '#c9a15a' };
            // A walker is never "on the road": dry ground under their own two
            // feet is simply land.
            if (this._walk && env === 'road') env = 'land';
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
            paint(els.abSwim,  'abSwim',  abilities.swim);
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

        // Which world the map is of. Off Earth it is the planet's own unwrapped
        // chart - the very picture the landing site was picked off, painted by
        // GalaxySim's own texture painter - so the coastline on the map and the
        // coastline underfoot are the same coastline. `desc` is a landed
        // descriptor (see GalaxySim.makeLandedDescriptor); null is Earth.
        setPlanet(desc) {
            this._planet = desc || null;
            this._planetTex = null;
            if (!desc) return;
            const R3D = window.GalaxySim && window.GalaxySim.Renderer3D;
            if (!R3D) return;
            const seed = (desc.terrain && desc.terrain.seed) || 0;
            try {
                // Procedural worlds are painted; the real planets of our own
                // system wear a photograph instead, and answer null to the
                // painter, so ask for the photograph in that case.
                const map = R3D.getPlanetTextureCanvas
                    ? R3D.getPlanetTextureCanvas(desc, seed) : null;
                const real = (!map && R3D._realPlanetTexture)
                    ? R3D._realPlanetTexture(desc) : null;
                // The painter hands back a bare canvas; a photograph comes
                // wrapped in a texture with the image on it.
                const src = map || (real && real.image) || null;
                if (src && src.width) this._planetTex = src;
            } catch (e) { /* no chart is better than no game */ }
        }

        // The planet's own chart, with the party's square on it. Longitude wraps
        // and latitude folds at the poles, exactly as the ground does, so a walk
        // east off the right edge comes back on the left.
        _drawPlanetMap(ctx, w, h, wx, wy) {
            const t = this._planet.terrain || {};
            const gw = Math.max(1, (t.grid && t.grid.w) || 12);
            const gh = Math.max(1, (t.grid && t.grid.h) || 6);
            const u = ((wx / gw) % 1 + 1) % 1;
            let v = ((wy / gh) % 2 + 2) % 2;
            if (v > 1) v = 2 - v;

            ctx.clearRect(0, 0, w, h);
            const img = this._planetTex;
            if (!img) {
                ctx.fillStyle = '#1a1410';
                ctx.fillRect(0, 0, w, h);
            } else if (this._mapMode === 'zoom') {
                // A window a third of the way round the world, centred on the
                // party. It can straddle the seam, in which case it is drawn in
                // two slices: the world has no edge to stop at.
                const span = 1 / 3;
                const left = u - span / 2;
                const sw = img.width * span;
                const sh = img.height * span * (gh / gw) * (w / h);
                const sy = Math.max(0, Math.min(img.height - sh, (v - 0.5 * sh / img.height) * img.height));
                const sx = ((left % 1) + 1) % 1 * img.width;
                const over = Math.max(0, sx + sw - img.width);
                ctx.drawImage(img, sx, sy, sw - over, sh, 0, 0, w * (1 - over / sw), h);
                if (over > 0) ctx.drawImage(img, 0, sy, over, sh, w * (1 - over / sw), 0, w * (over / sw), h);
                this._planetMarker(ctx, w / 2, h / 2);
                return { wx, wy };
            } else {
                ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
            }

            // The landing grid, faint, so a square on the ground can be counted
            // off the chart the way it was off the picker.
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 1;
            for (let i = 1; i < gw; i++) {
                const x = Math.round(i / gw * w) + 0.5;
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            }
            for (let i = 1; i < gh; i++) {
                const y = Math.round(i / gh * h) + 0.5;
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
            ctx.restore();
            this._planetMarker(ctx, u * w, v * h);
            return { wx, wy };
        }

        // Where the party is AND which way they are looking, on any of the maps.
        // The heading is the scene's own yaw, and forward is (sin, cos) of it,
        // which drops straight onto a canvas: +x is east and right, +z is south
        // and down. Turn on the spot and the arrow turns with you.
        _headingMarker(ctx, px, py, scale) {
            const k = scale || 1;
            const ang = this._heading || 0;
            const fx = Math.sin(ang), fy = Math.cos(ang);
            const rx = -fy, ry = fx;
            const tip = 9 * k, back = 6 * k, half = 5 * k;
            ctx.beginPath();
            ctx.moveTo(px + fx * tip, py + fy * tip);
            ctx.lineTo(px - fx * back + rx * half, py - fy * back + ry * half);
            ctx.lineTo(px - fx * back - rx * half, py - fy * back - ry * half);
            ctx.closePath();
            ctx.fillStyle = '#ff3b3b';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
        }
        _planetMarker(ctx, px, py) { this._headingMarker(ctx, px, py, 1); }

        // Renders the world map (map 315) with the camper at its live world tile,
        // keeping the 2D minimap and the 3D scene synchronized.
        _drawMiniMap(vanX, vanZ) {
            // 'hidden' mode: collapse the whole map panel until cycled back on.
            // 'full' takes the whole screen instead, so the corner panel goes
            // away for it too and the big one is drawn in its place.
            this._lastVanX = vanX; this._lastVanZ = vanZ;
            if (this._mapMode === 'hidden' || this._mapMode === 'full') {
                if (this._miniPanel) this._miniPanel.style.display = 'none';
                if (this._mapMode === 'full') { this._syncFullMap(); this._drawFullMap(vanX, vanZ); }
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

            // Off Earth, none of what follows applies: there is no world map, no
            // fast-travel destination and no 256-square grid. There is the
            // planet's own chart.
            if (this._planet) {
                this._drawPlanetMap(ctx, w, h, wx, wy);
                const el = document.getElementById('cds-map-coords');
                if (el) el.textContent = `${Math.floor(wx)}, ${Math.floor(wy)}`;
                return;
            }

            // 'zoom' crops a window around the vehicle; 'total' shows the whole
            // map in the same panel. srcX/srcY/srcSpan are in world tiles
            // (0..256); toPx/toPy convert a world tile coord into a canvas pixel
            // for the markers below.
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

            // The world grid, ruled over the close view: out here a world square
            // is half a kilometre of ground and the only way to tell which one
            // you are standing in is to see its edges. The square the party is
            // actually on is picked out from the rest of them.
            if (this._mapMode === 'zoom') this._drawWorldGrid(ctx, w, h, srcX, srcY, srcSpan, wx, wy);

            // The party, and which way they are facing, at whatever scale the
            // panel is showing. The arrow turns as they turn.
            const px = Math.max(0, Math.min(w, toPx(wx)));
            const py = Math.max(0, Math.min(h, toPy(wy)));
            this._headingMarker(ctx, px, py, this._mapMode === 'zoom' ? 1 : 0.7);

            const coordEl = document.getElementById('cds-map-coords');
            if (coordEl) coordEl.textContent = `${Math.floor(wx)}, ${Math.floor(wy)}`;
        }

        // The world's own square grid, drawn over whatever the map is showing.
        // Every line is a world-map square boundary; the one the party stands in
        // is filled faintly so the "you are in this section" reading is instant.
        _drawWorldGrid(ctx, w, h, srcX, srcY, srcSpan, wx, wy) {
            const step = w / srcSpan;               // canvas pixels per world square
            if (step < 3) return;                   // too fine to read: leave it clean
            const stepY = h / srcSpan;
            ctx.save();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(236,220,185,0.20)';
            ctx.beginPath();
            for (let t = Math.ceil(srcX); t < srcX + srcSpan; t++) {
                const x = (t - srcX) * step;
                ctx.moveTo(x, 0); ctx.lineTo(x, h);
            }
            for (let t = Math.ceil(srcY); t < srcY + srcSpan; t++) {
                const y = (t - srcY) * stepY;
                ctx.moveTo(0, y); ctx.lineTo(w, y);
            }
            ctx.stroke();
            // The square underfoot.
            const cx = (Math.floor(wx) - srcX) * step;
            const cy = (Math.floor(wy) - srcY) * stepY;
            ctx.fillStyle = 'rgba(255,232,176,0.18)';
            ctx.fillRect(cx, cy, step, stepY);
            ctx.strokeStyle = 'rgba(255,232,176,0.75)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(cx, cy, step, stepY);
            ctx.restore();
        }

        // ---------------------------------------------------------------------
        // The big map
        // ---------------------------------------------------------------------
        // The whole world across the whole screen, dragged with the mouse and
        // zoomed with the wheel, the way the world map's own fullscreen view is.
        // It takes the pointer while it is up, which is why the scene stops the
        // party moving and hands the mouse back for it (isFullMapOpen).
        _bindFullMap() {
            const cv = this._fullPanel && this._fullPanel.querySelector('#cds-worldmap-full');
            if (!cv) return;
            this._fullCanvas = cv;
            this._onFullDown = (e) => {
                if (this._mapMode !== 'full') return;
                this._fullDrag = { x: e.clientX, y: e.clientY };
                cv.style.cursor = 'grabbing';
                e.preventDefault(); e.stopPropagation();
            };
            this._onFullMove = (e) => {
                if (!this._fullDrag) return;
                this._fullPan.x += e.clientX - this._fullDrag.x;
                this._fullPan.y += e.clientY - this._fullDrag.y;
                this._fullDrag.x = e.clientX;
                this._fullDrag.y = e.clientY;
                this._repaintFullMap();
                e.preventDefault(); e.stopPropagation();
            };
            this._onFullUp = () => {
                if (!this._fullDrag) return;
                this._fullDrag = null;
                cv.style.cursor = 'grab';
            };
            this._onFullWheel = (e) => {
                if (this._mapMode !== 'full') return;
                // Zoom about the middle of the screen, so what is being looked
                // at stays roughly where it was.
                const k = e.deltaY < 0 ? 1.18 : 1 / 1.18;
                const before = this._fullZoom;
                this._fullZoom = Math.max(0.6, Math.min(12, this._fullZoom * k));
                const g = this._fullZoom / before;
                this._fullPan.x *= g;
                this._fullPan.y *= g;
                this._repaintFullMap();
                e.preventDefault(); e.stopPropagation();
            };
            cv.addEventListener('mousedown', this._onFullDown);
            document.addEventListener('mousemove', this._onFullMove);
            document.addEventListener('mouseup', this._onFullUp);
            cv.addEventListener('wheel', this._onFullWheel, { passive: false });
        }

        // Show or hide the big map to match the current mode, and size its canvas
        // to the screen it is being drawn on.
        _syncFullMap() {
            if (!this._fullPanel) return;
            const on = (this._mapMode === 'full');
            this._fullPanel.style.display = on ? 'block' : 'none';
            if (!on) { this._fullDrag = null; return; }
            const cv = this._fullCanvas;
            if (cv) {
                const w = cv.clientWidth || 960, h = cv.clientHeight || 640;
                if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
            }
        }

        // Redraw the big map where it was last told the party is. The world is
        // held still while it is up, so nothing else is going to redraw it.
        _repaintFullMap() {
            this._syncFullMap();
            this._drawFullMap(this._lastVanX || 0, this._lastVanZ || 0);
        }

        // Everything the big map put on the document, taken back off it.
        _unbindFullMap() {
            if (this._onFullMove) document.removeEventListener('mousemove', this._onFullMove);
            if (this._onFullUp)   document.removeEventListener('mouseup', this._onFullUp);
            if (this._fullCanvas) {
                if (this._onFullDown)  this._fullCanvas.removeEventListener('mousedown', this._onFullDown);
                if (this._onFullWheel) this._fullCanvas.removeEventListener('wheel', this._onFullWheel);
            }
            this._onFullMove = this._onFullUp = this._onFullDown = this._onFullWheel = null;
        }

        _drawFullMap(vanX, vanZ) {
            const cv = this._fullCanvas;
            if (!cv) return;
            const w = cv.width, h = cv.height;
            if (!w || !h) return;
            const ctx = cv.getContext('2d');
            const wx = vanX / WORLD_TILE_SIZE;
            const wy = vanZ / WORLD_TILE_SIZE;

            ctx.clearRect(0, 0, w, h);
            // The world is square; fit it into the screen and then scale it by
            // however far the wheel has been turned.
            const fit = Math.min(w, h) * 0.92 * this._fullZoom;
            const ox = w / 2 - fit / 2 + this._fullPan.x;
            const oy = h / 2 - fit / 2 + this._fullPan.y;
            const img = (this._planet ? this._planetTex : (this._mapImgReady ? this._mapImg : null));
            if (img) {
                ctx.imageSmoothingEnabled = this._fullZoom < 3;
                ctx.drawImage(img, 0, 0, img.width, img.height, ox, oy, fit, fit);
            } else {
                ctx.fillStyle = '#14304a';
                ctx.fillRect(ox, oy, fit, fit);
            }
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(139,90,43,0.8)';
            ctx.strokeRect(ox, oy, fit, fit);

            // The grid, once the squares are big enough to be worth ruling.
            const step = fit / 256;
            if (step >= 6) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(ox, oy, fit, fit);
                ctx.clip();
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(236,220,185,0.16)';
                ctx.beginPath();
                for (let t = 0; t <= 256; t++) {
                    ctx.moveTo(ox + t * step, oy); ctx.lineTo(ox + t * step, oy + fit);
                    ctx.moveTo(ox, oy + t * step); ctx.lineTo(ox + fit, oy + t * step);
                }
                ctx.stroke();
                ctx.fillStyle = 'rgba(255,232,176,0.22)';
                ctx.fillRect(ox + Math.floor(wx) * step, oy + Math.floor(wy) * step, step, step);
                ctx.restore();
            }

            // Where the party is standing, facing the way they are facing.
            this._headingMarker(ctx, ox + wx * step, oy + wy * step,
                Math.max(1, Math.min(2.4, this._fullZoom)));

            const el = document.getElementById('cds-worldmap-full-coords');
            if (el) el.textContent = `${Math.floor(wx)}, ${Math.floor(wy)}`;
        }

        // ---------------------------------------------------------------------
        // The quick bar
        // ---------------------------------------------------------------------
        // Handed the whole bar every frame (the tool's own readout: the weapon,
        // then a cell per block slot). Rebuilt only when something about it has
        // actually changed - which cell is lit, what is in one, how many - so a
        // bar that is not being used costs one string comparison a frame.
        setBlockBar(rows) {
            if (!this._barPanel) return;
            if (!rows || !rows.length) {
                if (this._barPanel.style.display !== 'none') this._barPanel.style.display = 'none';
                this._barKey = '';
                return;
            }
            const key = rows.map(r => (r.weapon ? 'W' : (r.mat || 0)) + ':' + (r.count || 0) +
                                      (r.on ? '*' : '')).join('|');
            if (key === this._barKey) return;
            this._barKey = key;
            this._barPanel.style.display = 'flex';
            this._barPanel.innerHTML = rows.map(r => {
                const lit = r.on
                    ? 'border-color:#ffe8b0; box-shadow:0 0 10px rgba(255,232,176,0.55);'
                    : 'border-color:rgba(139,90,43,0.55);';
                if (r.weapon) {
                    // The sword off the game's own icon sheet rather than a
                    // glyph: everything else in this menu is drawn from it.
                    const ic = BAR_WEAPON_ICON;
                    return `<div style="width:46px;height:46px;border:2px solid;border-radius:5px;
                        background:rgba(10,6,3,0.72);${lit}
                        display:flex;align-items:center;justify-content:center">
                        <span style="width:32px;height:32px;display:block;
                            background:url('img/system/IconSet.png') -${(ic % 16) * 32}px -${Math.floor(ic / 16) * 32}px no-repeat"></span>
                    </div>`;
                }
                if (!r.mat) {
                    return `<div style="width:46px;height:46px;border:2px dashed;border-radius:5px;
                        background:rgba(10,6,3,0.45);${lit}"></div>`;
                }
                return `<div title="${r.name}" style="width:46px;height:46px;border:2px solid;
                    border-radius:5px;background:rgba(10,6,3,0.72);${lit}
                    position:relative;display:flex;align-items:center;justify-content:center">
                    <div style="width:26px;height:26px;border-radius:3px;background:${r.colour || '#7a6a4a'};
                        box-shadow:inset 0 -6px 8px rgba(0,0,0,0.45)"></div>
                    <div style="position:absolute;right:3px;bottom:1px;color:#ecdcb9;
                        font-family:'Lora',serif;font-size:13px;
                        text-shadow:0 0 3px #000">${r.count}</div>
                </div>`;
            }).join('');
        }

        // Fed by the scene's digging update: the cube under the crosshair, the
        // block in hand, and how far through breaking it the pick has got.
        setDigReadout(targetName, heldName, progress) {
            if (!this._digPanel) return;
            const show = !!targetName;
            if (show !== (this._digPanel.style.display === 'block')) {
                this._digPanel.style.display = show ? 'block' : 'none';
            }
            if (!show) return;
            this._digEls = this._digEls || {
                target: document.getElementById('vw-dig-target'),
                bar:    document.getElementById('vw-dig-bar'),
                held:   document.getElementById('vw-dig-held')
            };
            const e = this._digEls;
            if (e.target && e.target.textContent !== targetName) e.target.textContent = targetName;
            if (e.bar) e.bar.style.width = Math.round(Math.min(1, progress || 0) * 100) + '%';
            if (e.held) {
                const txt = heldName ? T('VoxelWorld.tool.holding', { name: heldName }) : '';
                if (e.held.textContent !== txt) e.held.textContent = txt;
            }
        }

        // Two players, two views, one screen. The readout is Player 1's - the
        // fuel, the journey, the map of where the party is - so it is pulled
        // into their own half rather than straddling the seam. The crosshair
        // and the action prompt are centred on the screen, and the centre of a
        // split screen is the seam, so both are taken off while it is cut.
        setSplit(on) {
            const split = !!on;
            if (split === this._split) return;
            this._split = split;
            if (!this._el) return;
            const SS = window.$gameSplitScreen;
            const horizontal = !!(SS && SS.splitOrientation &&
                                  SS.splitOrientation() === 'horizontal');
            // Player 1 has the left half, or the top one.
            this._el.style.width  = (split && !horizontal) ? '50%' : '';
            this._el.style.height = (split && horizontal)  ? '50%' : '';
            if (this._promptEl) this._promptEl.style.display = split ? 'none' : '';
            // setPrompt owns the crosshair frame by frame, so it is told rather
            // than overruled - it would put it straight back otherwise.
            this._lastCross = null;
        }

        // The control legend, folded away until somebody asks for it with H.
        // The heading above it stays: which view this is, and which element the
        // party is in, are readouts rather than instructions.
        toggleCommands() {
            this.setCommandsVisible(!this._cmdsShown);
            return this._cmdsShown;
        }

        setCommandsVisible(on) {
            this._cmdsShown = !!on;
            if (this._cmdList) this._cmdList.style.display = on ? 'flex' : 'none';
            if (this._cmdHint) this._cmdHint.style.display = on ? '' : 'none';
        }

        // Take the whole readout off the screen without tearing it down: a
        // fight fought over this world draws its own HUD, and two sets of
        // panels over one picture is one set too many.
        setHidden(on) {
            if (this._el) this._el.style.display = on ? 'none' : '';
        }

        dispose() {
            this._unbindFullMap();
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

    // Handed to the rest of the suite.
    Object.assign(VW, {
        CamperHUD, WeatherParticles, camperCan, isSandboxOrTest
    });
})();
