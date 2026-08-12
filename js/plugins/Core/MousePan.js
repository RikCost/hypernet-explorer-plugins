/*:
 * @target MZ
 * @plugindesc Overrides mouse controls: wheel to zoom, click & drag to pan.
 * @author Gemini
 *

 *
 * @help
 * ============================================================================
 * Mouse Pan & Zoom Controls
 * ============================================================================
 * This plugin completely overrides the default mouse behavior on the map.
 * 
 * - Standard "Click to move" destination pathfinding is disabled.

 * - Click and Drag the mouse to Pan the camera around the map.
 * 
 * Note: If you move the player character using the keyboard or a gamepad 
 * after panning away, the camera will naturally snap back to center on 
 * the player.
 */

(() => {

    // Prevent default context menu to stop browser-like menus appearing on right click
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Handle mouse wheel zoom in ASCII mode
    document.addEventListener('wheel', (e) => {
        if (window.AsciiMode && window.AsciiMode.active && SceneManager._scene instanceof Scene_Map) {
            const delta = e.deltaY;
            const currentSize = window.AsciiMode.fontSize;
            let newSize = currentSize;

            if (delta < 0) {
                // Wheel up -> Zoom in (larger font)
                newSize += 2;
            } else {
                // Wheel down -> Zoom out (smaller font)
                newSize -= 2;
            }

            window.AsciiMode.fontSize = newSize;

            // Prevent default scrolling behavior
            e.preventDefault();
        } else if (isMap315CameraZoomable()) {
            const delta = e.deltaY;
            map315Zoom = clampMap315Zoom(map315Zoom + (delta < 0 ? MAP315_WHEEL_STEP : -MAP315_WHEEL_STEP));
            e.preventDefault();
        }
    }, { passive: false });

    // ------------------------------------------------------------------------
    // Map 315 Camera Zoom (mouse wheel + controller L2/R2)
    // ------------------------------------------------------------------------
    // The world map (315) is walked on foot like any other map, so unlike the
    // fullscreen "M" map sheet (WorldMap.js, its own independent zoomScale) this
    // zooms the live game camera via the engine's own Game_Screen zoom, centred
    // on the screen (the player stays centred by MousePan's own scroll-follow).
    const MAP315_ID = 315;
    const MAP315_ZOOM_MIN = 0.5;
    const MAP315_ZOOM_MAX = 2.5;
    const MAP315_WHEEL_STEP = 0.1;
    const MAP315_TRIGGER_RATE = 0.03; // zoom change per frame at full trigger pull
    const MAP315_TRIGGER_DEADZONE = 0.15;

    let map315Zoom = 1;
    let map315ZoomActive = false;

    function clampMap315Zoom(v) {
        return Math.max(MAP315_ZOOM_MIN, Math.min(MAP315_ZOOM_MAX, v));
    }

    function isMap315CameraZoomable() {
        if (!(SceneManager._scene instanceof Scene_Map)) return false;
        if (!$gameMap || $gameMap.mapId() !== MAP315_ID) return false;
        if (window.isWorldMapFullscreen && window.isWorldMapFullscreen()) return false;
        if (window.$gameSplitScreen && window.$gameSplitScreen.active) return false;
        if ($gameSystem && $gameSystem._mousePanDisabled) return false;
        return true;
    }

    // Per-frame driver: applies the wheel-set zoom, reads L2/R2 (right trigger
    // zooms in, left trigger zooms out) through the shared AnalogStickInput
    // helper (core Input.gamepadMapper does not cover buttons 6/7), and snaps
    // back to neutral the moment the player leaves map 315 or the world map is
    // opened, so the zoom never leaks onto another map's camera.
    Scene_Map.prototype.updateMap315Zoom = function () {
        if (!isMap315CameraZoomable()) {
            if (map315ZoomActive) {
                map315Zoom = 1;
                map315ZoomActive = false;
                $gameScreen.setZoom(Graphics.width / 2, Graphics.height / 2, 1);
            }
            return;
        }

        if (window.AnalogStickInput) {
            const rt = window.AnalogStickInput.rightTrigger ? window.AnalogStickInput.rightTrigger() : 0;
            const lt = window.AnalogStickInput.leftTrigger ? window.AnalogStickInput.leftTrigger() : 0;
            const pull = (rt > MAP315_TRIGGER_DEADZONE ? rt : 0) - (lt > MAP315_TRIGGER_DEADZONE ? lt : 0);
            if (pull) map315Zoom = clampMap315Zoom(map315Zoom + pull * MAP315_TRIGGER_RATE);
        }

        map315ZoomActive = true;
        $gameScreen.setZoom(Graphics.width / 2, Graphics.height / 2, map315Zoom);
    };

    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialDisplayX = 0;
    let initialDisplayY = 0;

    let clickStartX = 0;
    let clickStartY = 0;
    let isClicking = false;

    // ------------------------------------------------------------------------
    // Interior Divider Clamping (Region 30)
    // ------------------------------------------------------------------------
    // Region 30 tiles separate different interiors placed on the same map.
    // While inside such an interior, the drag-pan camera is confined to the
    // room's bounding box so the player can never drag the view into a
    // neighbouring interior.
    const INTERIOR_DIVIDER_REGION = 30;

    let _dividerMapId = -1;
    let _mapHasDividers = false;
    let _interiorBounds = null;
    let _interiorTileX = -1;
    let _interiorTileY = -1;

    function mapHasDividers() {
        if (_dividerMapId === $gameMap.mapId()) return _mapHasDividers;
        _dividerMapId = $gameMap.mapId();
        _mapHasDividers = false;
        const w = $gameMap.width();
        const h = $gameMap.height();
        for (let y = 0; y < h && !_mapHasDividers; y++) {
            for (let x = 0; x < w; x++) {
                if ($gameMap.regionId(x, y) === INTERIOR_DIVIDER_REGION) {
                    _mapHasDividers = true;
                    break;
                }
            }
        }
        // Invalidate any cached bounds from the previous map.
        _interiorBounds = null;
        _interiorTileX = -1;
        _interiorTileY = -1;
        return _mapHasDividers;
    }

    // Flood-fill from the player's tile, stopping at region-30 dividers (which
    // are included in the bounds so their walls remain visible). Returns null
    // when the player is on a divider or the area is not enclosed by dividers.
    function computeInteriorBounds(px, py) {
        const w = $gameMap.width();
        const h = $gameMap.height();
        if (px < 0 || py < 0 || px >= w || py >= h) return null;
        if ($gameMap.regionId(px, py) === INTERIOR_DIVIDER_REGION) return null;

        const visited = new Uint8Array(w * h);
        const start = py * w + px;
        const stack = [start];
        visited[start] = 1;

        let minX = px, maxX = px, minY = py, maxY = py;
        let hitDivider = false;

        while (stack.length) {
            const idx = stack.pop();
            const x = idx % w;
            const y = (idx / w) | 0;

            const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (let n = 0; n < neighbors.length; n++) {
                const nx = neighbors[n][0];
                const ny = neighbors[n][1];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nidx = ny * w + nx;
                if (visited[nidx]) continue;
                visited[nidx] = 1;

                if ($gameMap.regionId(nx, ny) === INTERIOR_DIVIDER_REGION) {
                    // Include the divider wall in the bounds but don't cross it.
                    hitDivider = true;
                    if (nx < minX) minX = nx;
                    if (nx > maxX) maxX = nx;
                    if (ny < minY) minY = ny;
                    if (ny > maxY) maxY = ny;
                    continue;
                }

                if (nx < minX) minX = nx;
                if (nx > maxX) maxX = nx;
                if (ny < minY) minY = ny;
                if (ny > maxY) maxY = ny;
                stack.push(nidx);
            }
        }

        // Not enclosed by dividers => open area, no clamping.
        if (!hitDivider) return null;
        return { minX, maxX, minY, maxY };
    }

    function getInteriorBounds() {
        if (!$gameMap || !$gamePlayer) return null;
        if (!mapHasDividers()) return null;
        const px = Math.round($gamePlayer.x);
        const py = Math.round($gamePlayer.y);
        if (px !== _interiorTileX || py !== _interiorTileY) {
            _interiorTileX = px;
            _interiorTileY = py;
            _interiorBounds = computeInteriorBounds(px, py);
        }
        return _interiorBounds;
    }

    // Confine a display coordinate so the visible window [disp, disp+screenTiles]
    // stays within the inclusive bounds [lo, hi]. Centers when the interior is
    // smaller than the screen.
    function clampDisplayAxis(disp, lo, hi, screenTiles) {
        const span = (hi + 1) - lo; // inclusive tile range -> tile count
        if (span <= screenTiles) {
            return lo + (span - screenTiles) / 2;
        }
        return Math.max(lo, Math.min(disp, (hi + 1) - screenTiles));
    }

    // ------------------------------------------------------------------------
    // Delayed Click-to-Move (to allow dragging without moving)
    // ------------------------------------------------------------------------
    Scene_Map.prototype.processMapTouch = function () {
        if (window.isWorldMapFullscreen && window.isWorldMapFullscreen()) return;

        if (TouchInput.isTriggered()) {
            clickStartX = TouchInput.x;
            clickStartY = TouchInput.y;
            isClicking = true;
        }

        if (TouchInput.isReleased() || !TouchInput.isPressed()) {
            if (isClicking && TouchInput.isReleased()) {
                const dx = TouchInput.x - clickStartX;
                const dy = TouchInput.y - clickStartY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 10) { // Threshold for click
                    const x = $gameMap.canvasToMapX(TouchInput.x);
                    const y = $gameMap.canvasToMapY(TouchInput.y);
                    $gameTemp.setDestination(x, y);
                }
            }
            isClicking = false;
        }
    };

    // ------------------------------------------------------------------------
    // Map Update Injection
    // ------------------------------------------------------------------------
    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _Scene_Map_start.call(this);
        isDragging = false;
        isClicking = false;
        if ($gameSystem._mousePan && !$gameSystem._mousePanDisabled) {
            const data = $gameSystem._mousePan;
            if (data.displayX !== undefined && data.displayX !== null) {
                $gameMap.setDisplayPos(data.displayX, data.displayY);
            }
        }
    };



    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if ($gameMap && $gamePlayer) {
            const isWorldMapFullscreen = window.isWorldMapFullscreen && window.isWorldMapFullscreen();
            if (!$gameSystem._mousePanDisabled && !isWorldMapFullscreen) {
                this.updateMousePan();
                this.updateMap315Zoom();

                // Save current state (only write when it actually changed)
                if (!$gameSystem._mousePan) $gameSystem._mousePan = {};
                const pan = $gameSystem._mousePan;
                const dispX = $gameMap.displayX();
                const dispY = $gameMap.displayY();
                if (pan.displayX !== dispX) pan.displayX = dispX;
                if (pan.displayY !== dispY) pan.displayY = dispY;
            }
        }
        // Event hover (merged here from a second Scene_Map.update alias)
        this.updateEventHover();
    };

    // ------------------------------------------------------------------------
    // Panning Logic
    // ------------------------------------------------------------------------
    Scene_Map.prototype.updateMousePan = function () {
        // Start Drag
        if (TouchInput.isTriggered()) {
            isDragging = true;
            dragStartX = TouchInput.x;
            dragStartY = TouchInput.y;
            initialDisplayX = $gameMap._displayX;
            initialDisplayY = $gameMap._displayY;
        }

        // End Drag
        if (TouchInput.isReleased() || !TouchInput.isPressed()) {
            isDragging = false;
        }

        // Process Dragging
        if (isDragging && TouchInput.isPressed()) {
            const dx = TouchInput.x - dragStartX;
            const dy = TouchInput.y - dragStartY;

            const isAscii = window.AsciiMode && window.AsciiMode.active;
            const tileW = isAscii ? window.AsciiMode.fontSize : $gameMap.tileWidth();
            const tileH = isAscii ? window.AsciiMode.fontSize : $gameMap.tileHeight();

            let newDispX = initialDisplayX - (dx / tileW);
            let newDispY = initialDisplayY - (dy / tileH);

            // Confine the camera to the current interior when region-30 dividers
            // are present, so dragging can't peek into neighbouring interiors.
            const bounds = getInteriorBounds();
            if (bounds) {
                const screenTilesX = isAscii ? (window.innerWidth / tileW) : (Graphics.width / tileW);
                const screenTilesY = isAscii ? (window.innerHeight / tileH) : (Graphics.height / tileH);
                newDispX = clampDisplayAxis(newDispX, bounds.minX, bounds.maxX, screenTilesX);
                newDispY = clampDisplayAxis(newDispY, bounds.minY, bounds.maxY, screenTilesY);
            }

            // setDisplayPos automatically handles map boundaries and looping
            $gameMap.setDisplayPos(newDispX, newDispY);
        }
    };



    // ------------------------------------------------------------------------
    // Prevent Camera Snap-back While Dragging
    // ------------------------------------------------------------------------
    const _Game_Player_updateScroll = Game_Player.prototype.updateScroll;
    Game_Player.prototype.updateScroll = function (lastScrolledX, lastScrolledY) {
        if (isDragging) {
            if (!TouchInput.isPressed()) {
                isDragging = false;
            } else {
                this._isPanningToCenter = false;
                return;
            }
        }


        // Pan back to player when moving
        if (this.isMoving()) {
            const targetX = this.x - this.centerX();
            const targetY = this.y - this.centerY();

            const dx = $gameMap.deltaX(targetX, $gameMap.displayX());
            const dy = $gameMap.deltaY(targetY, $gameMap.displayY());

            if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                const panSpeed = 0.15;
                // Never glide slower than the player actually moves this frame,
                // otherwise the camera lags behind and the character drifts off
                // centre while running/dashing. distancePerFrame() also reflects
                // the climb/swim speed multipliers, so it stays centred in those
                // modes too. When far from centre (e.g. after a drag-pan) the
                // proportional term still gives a smooth glide back.
                const minStep = this.distancePerFrame();
                const stepX = Math.sign(dx) * Math.min(Math.abs(dx), Math.max(Math.abs(dx) * panSpeed, minStep));
                const stepY = Math.sign(dy) * Math.min(Math.abs(dy), Math.max(Math.abs(dy) * panSpeed, minStep));
                $gameMap.setDisplayPos($gameMap.displayX() + stepX, $gameMap.displayY() + stepY);
                return;
            }
        }
        _Game_Player_updateScroll.call(this, lastScrolledX, lastScrolledY);
    };

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        if ($gameSystem) {
            delete $gameSystem._mousePan;
        }
    };

    const _Game_Player_performTransfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function () {
        if ($gameSystem._mousePan) {
            delete $gameSystem._mousePan.displayX;
            delete $gameSystem._mousePan.displayY;

        }
        _Game_Player_performTransfer.call(this);
    };

    // ------------------------------------------------------------------------
    // Hover Window for Event Names (updated for ALT reveal)
    // ------------------------------------------------------------------------

    let _classI18n = null;

    const loadClassI18n = async () => {
        const lang = ConfigManager.language || "en";
        const url = `js/i18n/${lang}/classes.json`;
        try {
            const response = await fetch(url);
            _classI18n = await response.json();
        } catch (e) {
            console.error('MousePan: Failed to load class i18n from ' + url, e);
        }
    };

    loadClassI18n();

    // i18n-ignore-start: fallback ids; the display copy comes from classes.json
    const classNames = {
        1: "Freelancer", 2: "Witch", 3: "Nun", 4: "Knight", 5: "Convoker",
        6: "CEO", 7: "Vampire", 8: "Cultist", 9: "Combat Medic", 10: "Elementalist",
        11: "Martial Artist", 12: "Enchanter", 13: "Berserker", 14: "Acrobat", 15: "Monk",
        16: "Brawler", 17: "Boxer", 18: "Pro Wrestler", 19: "Fire Mage", 20: "Ice Mage",
        21: "Rogue", 22: "Paladin", 23: "Warlock", 24: "Ranger", 25: "Cleric",
        26: "Samurai", 27: "Archmage", 28: "Scout", 29: "Oracle", 30: "Gladiator",
        31: "Necromancer", 32: "Commander", 33: "Guardian", 34: "Spellblade", 35: "Bard",
        36: "Illusionist", 37: "Battlemage", 38: "Mercenary", 39: "Sage", 40: "Barbarian",
        41: "Doctor", 42: "Scientist", 43: "Firefighter", 44: "Police Officer", 45: "Chef",
        46: "Journalist", 47: "Construction Worker", 48: "Academic", 49: "Psychologist", 50: "Archaeologist",
        51: "Nurse", 52: "Hunter-Gatherer", 53: "Physicist", 54: "Mechanic", 55: "Shopkeeper",
        56: "Farmer", 57: "Lumberjack", 58: "Meteorologist", 59: "Priest", 60: "Entertainer",
        61: "Demigod", 62: "Wretch", 63: "Beast", 64: "Mimic", 65: "Monster", 66: "Cyborg"
    };

    // Default horizontal offset. Can be overridden in event notes with <xOffset: number>
    const X_OFFSET = 0;

    // The world map draws its own place names (WorldMap.js / MapLabels), so the
    // event hover would only repeat them over the teleport markers.
    const WORLD_MAP_ID = 315;

    // Canvas element + scale are cached: getElementById/getBoundingClientRect
    // every frame is expensive. Invalidated on window resize and when the
    // internal Graphics size changes.
    let _msgCanvasEl = null;
    let _msgScaleCache = null;
    window.addEventListener('resize', () => { _msgScaleCache = null; });

    function _msgGetScale() {
        if (_msgScaleCache &&
            _msgScaleCache.gw === Graphics.width &&
            _msgScaleCache.gh === Graphics.height) {
            return _msgScaleCache;
        }
        if (!_msgCanvasEl || !_msgCanvasEl.isConnected) {
            _msgCanvasEl = document.getElementById('gameCanvas');
        }
        if (!_msgCanvasEl) return { sx: 1, sy: 1, ox: 0, oy: 0, gw: 0, gh: 0 };
        const r = _msgCanvasEl.getBoundingClientRect();
        _msgScaleCache = {
            sx: r.width / Graphics.width,
            sy: r.height / Graphics.height,
            ox: r.left,
            oy: r.top,
            gw: Graphics.width,
            gh: Graphics.height
        };
        return _msgScaleCache;
    }

    function shouldHideEvent(name) {
        if (!name) return true;
        const trimmed = name.trim();
        if (trimmed.startsWith("EV") || trimmed.startsWith("Transfer") || trimmed.startsWith("Door")) return true;
        
        const lower = trimmed.toLowerCase();
        const hideList = ["audio", "puzzlesetup", "debug", "audioemitter"];
        if (hideList.includes(lower)) return true;
        
        if (/^player[1-9]$/i.test(trimmed)) return true;
        
        return false;
    }

    // "Shop" events with no graphic/identity of their own are covered by an NPC
    // persona (see ShopShiftManager in NPCSimulationCore.js). When covered,
    // returns that persona's name + their actual class, otherwise null, which
    // includes a Shop event whose shopkeeper the author drew: that one is
    // hovered under their own name like any other NPC.
    function shopPersonaDisplay(ev) {
        if (!window.NPCSim?.isShopShiftCovered?.(ev) || !window.NPCSim?.getShopShiftData) return null;
        const persona = window.NPCSim.getShopShiftData(ev.event().name, $gameMap.mapId(), ev.eventId());
        if (!persona) return null;
        const profile = $gameSystem?._npcSociety?.[persona.name];
        const classId = profile?.assignedClassId ?? null;
        const className = (_classI18n && _classI18n[classId] ? _classI18n[classId].name : null) || classNames[classId] || "";
        return { name: persona.name, classId, className };
    }

    function formatEventName(name) {
        if (!name) return "";
        let displayName = name.trim();
        
        if (displayName === "RandomArmourChest") {
            displayName = "Armour Chest";
        } else if (displayName === "RandomWeaponChest") {
            displayName = "Weapon Chest";
        } else if (displayName === "RandomItemChest") {
            displayName = "Chest";
        } else if (displayName === "Dungeon door") {
            displayName = "Door";
        } else if (displayName.startsWith("Treasure")) {
            displayName = "Chest";
        }
        
        return displayName;
    }

    function Window_EventHover() {
        this.initialize(...arguments);
    }

    Window_EventHover.prototype = Object.create(Window_Base.prototype);
    Window_EventHover.prototype.constructor = Window_EventHover;

    Window_EventHover.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.opacity = 0;
        this.contentsOpacity = 0;
        this._text = "";
        this._textChanged = false;
        this._neededWidth = 100;

        const old = this._htmlHoverRoot;
        if (old && old.parentNode) old.parentNode.removeChild(old);

        const root = document.createElement('div');
        root.style.cssText =
            'position:fixed;display:none;z-index:495;pointer-events:none;' +
            'box-sizing:border-box;overflow:hidden;white-space:nowrap;' +
            'background:var(--text-danger-hover);' +
            'border:3px solid var(--border-subtle);border-radius:6px;' +
            'outline:1px solid var(--border-subtle-translucent-40);outline-offset:-7px;' +
            'background-image:radial-gradient(ellipse at center,' +
            'transparent 40%,var(--bg-brown-vignette-10) 100%);' +
            'color:var(--text-primary-hover);font-family:\'Lora\',serif;font-weight:bold;' +
            'box-shadow:0 4px 10px rgba(0,0,0,0.25);' +
            'display:none;justify-content:center;align-items:center;text-align:center;';
        
        this._htmlHoverRoot = root;
        document.body.appendChild(root);

        this.hide();
    };

    Window_EventHover.prototype.destroy = function (options) {
        if (this._htmlHoverRoot && this._htmlHoverRoot.parentNode) {
            this._htmlHoverRoot.parentNode.removeChild(this._htmlHoverRoot);
        }
        this._htmlHoverRoot = null;
        Window_Base.prototype.destroy.call(this, options);
    };

    Window_EventHover.prototype.show = function() {
        Window_Base.prototype.show.call(this);
        if (this._htmlHoverRoot) this._htmlHoverRoot.style.display = 'flex';
    };

    Window_EventHover.prototype.hide = function() {
        Window_Base.prototype.hide.call(this);
        if (this._htmlHoverRoot) this._htmlHoverRoot.style.display = 'none';
    };

    Window_EventHover.prototype._refreshBack = function () {};
    Window_EventHover.prototype._refreshFrame = function () {};

    // Cache of measured widths keyed by text (measuring builds/destroys a
    // Bitmap, which is expensive to do every frame while hovering).
    const _hoverWidthCache = new Map();
    function _measureHoverWidth(text) {
        let w = _hoverWidthCache.get(text);
        if (w !== undefined) return w;
        const tempBitmap = new Bitmap(1, 1);
        tempBitmap.fontSize = 18;
        tempBitmap.fontFace = 'Lora';
        const measuredWidth = Math.ceil(tempBitmap.measureTextWidth(text));
        tempBitmap.destroy();
        w = Math.max(32, measuredWidth + 32);
        if (_hoverWidthCache.size >= 200) _hoverWidthCache.clear();
        _hoverWidthCache.set(text, w);
        return w;
    }

    Window_EventHover.prototype.setText = function (text) {
        text = (text || "").trim();
        if (text === "") {
            this._text = "";
            this._neededWidth = 10;
            this.hide();
            return;
        }

        // Only measure when the text actually changed (measurement is the cost).
        if (this._text !== text) {
            this._text = text;
            this._neededWidth = _measureHoverWidth(text);
            this._textChanged = true;
            if (this._htmlHoverRoot) {
                this._htmlHoverRoot.textContent = text;
            }
        }
    };

    // Writes a style property only when its value changed, tracking last-applied
    // values on a per-element cache to avoid redundant DOM style writes.
    function _setStyleIfChanged(el, prop, value) {
        const cache = el._phhStyleCache || (el._phhStyleCache = {});
        if (cache[prop] === value) return;
        cache[prop] = value;
        el.style[prop] = value;
    }

    // Height is now 70 to avoid text cutoff
    Window_EventHover.prototype.updatePosition = function (x, y, width) {
        this.move(x, y, width, 70);

        if (this._htmlHoverRoot) {
            const sc = _msgGetScale();
            const el = this._htmlHoverRoot;

            // Scaled positioning matching target event bounds
            _setStyleIfChanged(el, 'left', (sc.ox + x * sc.sx) + 'px');
            _setStyleIfChanged(el, 'top', (sc.oy + y * sc.sy) + 'px');
            _setStyleIfChanged(el, 'width', (width * sc.sx) + 'px');
            _setStyleIfChanged(el, 'height', (70 * sc.sy) + 'px');

            // Scale padding and font size
            const padX = Math.round(16 * sc.sx);
            _setStyleIfChanged(el, 'padding', `0 ${padX}px`);

            const baseFontSize = 18;
            const scaledFont = Math.round(baseFontSize * sc.sy * 0.85);
            _setStyleIfChanged(el, 'fontSize', scaledFont + 'px');
        }
    };

    const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function () {
        _Scene_Map_createAllWindows.call(this);
        const rect = new Rectangle(10, 10, 300, 70);
        this._eventHoverWindow = new Window_EventHover(rect);
        this.addWindow(this._eventHoverWindow);
        // Pool for ALTâ€‘key reveal windows
        this._eventHoverWindows = [];
    };

    Scene_Map.prototype.updateEventHover = function () {
        if (!this._eventHoverWindow) return;

        const getTileScreenPosition = (mapX, mapY) => {
            const isAscii = window.AsciiMode && window.AsciiMode.active;
            if (isAscii) {
                const activeFontSize = window.AsciiMode.fontSize;
                const vpW = window.innerWidth;
                const vpH = window.innerHeight;
                const viewWidth = vpW / activeFontSize;
                const viewHeight = vpH / activeFontSize;

                const mapCenterX = Math.round($gameMap.displayX()) + (vpW / $gameMap.tileWidth()) / 2;
                const mapCenterY = Math.round($gameMap.displayY()) + (vpH / $gameMap.tileHeight()) / 2;

                const startX = mapCenterX - viewWidth / 2;
                const startY = mapCenterY - viewHeight / 2;

                const mapWidth = $gameMap.width();
                const mapHeight = $gameMap.height();

                let mapOffsetX = 0;
                let mapOffsetY = 0;
                if (mapWidth < viewWidth) {
                    mapOffsetX = Math.floor((viewWidth - mapWidth) / 2) * activeFontSize;
                }
                if (mapHeight < viewHeight) {
                    mapOffsetY = Math.floor((viewHeight - mapHeight) / 2) * activeFontSize;
                }

                const totalOffsetX = mapOffsetX;
                const totalOffsetY = mapOffsetY;

                const screenX = Math.round(totalOffsetX + (mapX - startX) * activeFontSize + activeFontSize / 2);
                const screenY = Math.round(totalOffsetY + (mapY - startY) * activeFontSize);
                return { x: screenX, y: screenY };
            } else {
                const tw = $gameMap.tileWidth();
                const th = $gameMap.tileHeight();
                const screenX = Math.round($gameMap.adjustX(mapX) * tw + tw / 2);
                const screenY = Math.round($gameMap.adjustY(mapY) * th);
                return { x: screenX, y: screenY };
            }
        };

        // Disable in split-screen, and on the world map entirely
        if (($gameMap && $gameMap.mapId() === WORLD_MAP_ID) ||
            (window.$gameSplitScreen && window.$gameSplitScreen.active)) {
            this._eventHoverWindow.hide();
            if (this._eventHoverWindows) {
                this._eventHoverWindows.forEach(win => win.hide());
            }
            return;
        }

        // ALT key reveals every event name on screen
        if (Input.isPressed('alt')) {
            const allEvents = $gameMap.events();
            let used = 0;
            for (const ev of allEvents) {
                // Filter same as singleâ€‘hover logic, but allow events with no graphic
                if (ev.isTransparent()) continue;
                const name = ev.event().name;
                if (shouldHideEvent(name)) continue;
                if ($gameMap.fogOfWarState && $gameMap.fogOfWarState(ev.x, ev.y) < 2) continue;

                // Ensure a window exists for this event
                let win = this._eventHoverWindows[used];
                if (!win) {
                    const dummyRect = new Rectangle(0, 0, 100, 70);
                    win = new Window_EventHover(dummyRect);
                    this.addWindow(win);
                    this._eventHoverWindows[used] = win;
                }

                // Build display text
                let displayName = formatEventName(name);
                if (name === "Enemy" && ev._fixedTroopId > 0) {
                    const troop = $dataTroops[ev._fixedTroopId];
                    if (troop && troop.members.length > 0) {
                        const enemy = $dataEnemies[troop.members[0].enemyId];
                        if (enemy) displayName = enemy.name.trim();
                    }
                } else {
                    const notes = ev.event().note;
                    const npcMatch = notes.match(/NPC-(\d+)/);
                    const shopPersona = npcMatch ? null : shopPersonaDisplay(ev);
                    if (npcMatch) {
                        const classId = parseInt(npcMatch[1]);
                        const className = (_classI18n && _classI18n[classId] ? _classI18n[classId].name : null) || classNames[classId] || "Unknown";
                        displayName = `${displayName}, ${className.trim()}`;
                    } else if (shopPersona) {
                        displayName = shopPersona.className ? `${shopPersona.name}, ${shopPersona.className.trim()}` : shopPersona.name;
                    }
                }
                win.setText(displayName);

                // Position window above the event sprite's map tile
                const winWidth = win._neededWidth;
                const winHeight = 70;
                const eventOffset = Number((ev.event().meta || {}).xOffset || X_OFFSET);
                
                const tilePos = getTileScreenPosition(ev._realX, ev._realY);
                let x = tilePos.x - winWidth / 2 + eventOffset;
                let y = tilePos.y - winHeight - 8;
                
                // Clamp to screen bounds
                x = Math.max(0, Math.min(x, Graphics.boxWidth - winWidth));
                y = Math.max(0, Math.min(y, Graphics.boxHeight - winHeight));
                win.updatePosition(x, y, winWidth);
                win.show();
                used++;
            }
            // Hide any surplus windows from previous frame
            for (let i = used; i < this._eventHoverWindows.length; i++) {
                this._eventHoverWindows[i].hide();
            }
            // Also hide the singleâ€‘hover window while ALT is active
            this._eventHoverWindow.hide();
            return;
        }

        // Normal singleâ€‘hover behavior (unchanged logic, but allow events without graphic)
        const mapX = $gameMap.canvasToMapX(TouchInput.x);
        const mapY = $gameMap.canvasToMapY(TouchInput.y);
        const events = $gameMap.eventsXy(mapX, mapY);

        const hoveredEvent = events.find(ev => {
            if (ev.isTransparent()) return false;
            // Allow events with no graphic (characterName empty and tileId 0)
            const name = ev.event().name;
            if (shouldHideEvent(name)) return false;
            if ($gameMap.fogOfWarState && $gameMap.fogOfWarState(mapX, mapY) < 2) return false;
            return true;
        });

        if (hoveredEvent) {
            const evName  = hoveredEvent.event().name;
            const evNotes = hoveredEvent.event().note || "";
            let name = formatEventName(evName);

            if (evName === "Enemy" && hoveredEvent._fixedTroopId > 0) {
                const troop = $dataTroops[hoveredEvent._fixedTroopId];
                if (troop && troop.members.length > 0) {
                    const enemy = $dataEnemies[troop.members[0].enemyId];
                    if (enemy) name = enemy.name.trim();
                }
            } else {
                const npcMatch = evNotes.match(/NPC-(\d+)/);
                if (npcMatch) {
                    const classId = parseInt(npcMatch[1]);
                    const className = (_classI18n && _classI18n[classId] ? _classI18n[classId].name : null) || classNames[classId] || "Unknown";
                    name = `${name}, ${className.trim()}`;
                } else {
                    const shopPersona = shopPersonaDisplay(hoveredEvent);
                    if (shopPersona) {
                        name = shopPersona.className ? `${shopPersona.name}, ${shopPersona.className.trim()}` : shopPersona.name;
                    }
                }
            }

            // Name (and class, when known) only, no simulation details.
            this._eventHoverWindow.setText(name);
            const winWidth  = this._eventHoverWindow._neededWidth;
            const winHeight = 70;
            const eventOffset = Number((hoveredEvent.event().meta || {}).xOffset || X_OFFSET);
            const tilePos = getTileScreenPosition(hoveredEvent._realX, hoveredEvent._realY);
            let x = tilePos.x - winWidth / 2 + eventOffset;
            let y = tilePos.y - winHeight - 8;
            x = Math.max(0, Math.min(x, Graphics.boxWidth  - winWidth));
            y = Math.max(0, Math.min(y, Graphics.boxHeight - winHeight));
            this._eventHoverWindow.updatePosition(x, y, winWidth);
            this._eventHoverWindow.show();
        } else {
            this._eventHoverWindow.hide();
        }
    };

    // Scene_NPCProfile removed â€” social web is now in NPCEmpathize.js


})();
