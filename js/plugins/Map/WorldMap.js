/*:
 * @target MZ
 * @plugindesc World Map Plugin v2.3.0 (Zoom, Pan, Detail Tiles & Optimized City Labels)
 * @author Omni-Lex
 * @version 2.3.0
 * @description Minimap (Top-right) + Interactive Fullscreen Map with Labels + Optimized In-Game City Names.
 *
 * @param mapWidth
 * @text Map Width (Mini)
 * @desc Width of the minimap in pixels (Normal Mode)
 * @type number
 * @min 50
 * @max 500
 * @default 200
 *
 * @param mapHeight
 * @text Map Height (Mini)
 * @desc Height of the minimap in pixels (Normal Mode)
 * @type number
 * @min 50
 * @max 500
 * @default 150
 *
 * @param opacity
 * @text Map Opacity
 * @desc Opacity of the minimap (0-255)
 * @type number
 * @min 0
 * @max 255
 * @default 180
 *
 * @param playerColor
 * @text Player Color
 * @desc Color of the player dot (hex color)
 * @type string
 * @default #FF0000
 *
 * @param labelFontSize
 * @text Teleport Label Size
 * @desc Font size for teleport names on the fullscreen map
 * @type number
 * @default 14
 *
 * @param proceduralZoomLevel
 * @text Procedural Map Zoom Level
 * @desc Zoom level for procedural maps in minimap (smaller = more zoomed in). Default 32 shows full block, 16 shows 1/4th.
 * @type number
 * @min 4
 * @max 128
 * @default 16
 *
 * @command openWorldMap
 * @text Open World Map
 * @desc Manually opens the fullscreen interactive world map (pan/zoom).
 *
 * @command showWorldMap
 * @text Show Minimap
 * @desc Shows the minimap overlay (top-right).
 *
 * @command hideWorldMap
 * @text Hide World Map
 * @desc Hides the minimap / world map overlay.
 *
 * @command toggleMinimap
 * @text Toggle Minimap
 * @desc Toggles the minimap overlay on/off.
 *
 * @command showZoomableMap
 * @text Show Zoomable Map
 * @desc Shows the fullscreen zoomable world map.
 *
 * @help WorldMap.js
 *
 * === Controls ===
 * 'M' Key: Cycle Modes (Hidden -> Mini -> Fullscreen).
 *
 * === Fullscreen Mode Controls ===
 * Mouse Drag:  Pan the map.
 * Mouse Wheel: Zoom In / Out.
 * 'Q' Key:     Zoom Out.
 * 'E' Key:     Zoom In.
 *
 * === Setup ===
 * 1. Place 'worldmap.png' in 'img/pictures/'.
 * 2. Create 'img/worldmap/' folder.
 * 3. Place detail tiles in 'img/worldmap/' named:
 * row-1-column-1.png through row-8-column-8.png
 *
 * 4. Name events "Teleport - NameOfPlace" (e.g., "Teleport - Rome").
 *
 * === In-Game City Labels ===
 * City names from teleport events are automatically displayed on the map.
 * Format: "Teleport - CityName" (e.g., "Teleport - Rome" shows "Rome")
 * Labels appear above the event and scroll with the map.
 * Performance: Labels only render when near the visible screen (5 tile buffer).
 * Bitmaps are created lazily when labels first become visible.
 * (Note: Teleport labels on minimap only appear if you are ON the world map).
 */

(() => {
    'use strict';

    const pluginName = 'WorldMap';
    const parameters = PluginManager.parameters(pluginName);

    const mapWidth = Number(parameters['mapWidth']) || 200;
    const mapHeight = Number(parameters['mapHeight']) || 150;
    const paramOpacity = Number(parameters['opacity']) || 180;
    const playerColor = parameters['playerColor'] || '#FF0000';
    const labelFontSize = Number(parameters['labelFontSize']) || 14;
    const proceduralZoomLevel = Number(parameters['proceduralZoomLevel']) || 16;
    
    // Constants for vehicles
    const boatColor = '#0000FF';
    const shipColor = '#00FF00';
    const airshipColor = '#FFFF00';
    const questMarkerColor = '#FFD76A'; // matches the quest board's focus gold

    // Map States: 0 = Hidden, 1 = Normal (Mini), 2 = Fullscreen (Zoomed)
    let currentMapState = 0;

    // Interactive Zoom Variables
    let zoomScale = 1.0;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let tilesLoaded = 0; // Count of loaded tiles
    const totalTiles = 64; // 8x8 grid

    // Cache decoded minimap tile Bitmaps by URL. renderMiniMap runs on every
    // player step, so an uncached Bitmap.load re-decodes the same JPEG each step;
    // caching keeps a single decoded bitmap per tile alive.
    const _tileBitmapCache = {};
    function loadCachedTile(path) {
        let bmp = _tileBitmapCache[path];
        if (!bmp) {
            bmp = Bitmap.load(path);
            _tileBitmapCache[path] = bmp;
        }
        return bmp;
    }

    // Assign a bitmap to the minimap sprite, freeing the previous per-render
    // bitmap's GPU texture to stop per-step baseTexture churn. Cached/shared
    // bitmaps (the master world image, the fullscreen composite) are never freed.
    function setWorldMapSpriteBitmap(bmp) {
        if (!worldMapSprite) return;
        const old = worldMapSprite.bitmap;
        worldMapSprite.bitmap = bmp;
        if (old && old !== bmp && old !== worldMapBitmap && old !== fullscreenBitmap &&
            typeof old.destroy === 'function') {
            old.destroy();
        }
    }

    // Key Definitions
    Input.keyMapper[77] = 'world_map_toggle'; // M
    Input.keyMapper[81] = 'map_zoom_out';     // Q
    Input.keyMapper[69] = 'map_zoom_in';      // E

    let worldMapSprite = null;
    let worldMapBitmap = null; // The master source image loaded from disk
    let fullscreenBitmap = null; // Cached fullscreen grid bitmap
    let cityLabelsContainer = null; // Array of city name label sprites on the map

    // --- Live vehicle fast-travel tracking (shows the vehicle crossing the world
    //     map while the player sits inside the vehicle interior) ---
    // Transports that keep the player inside the vehicle interior for the whole
    // trip (no transfer to a dedicated travel map), so world vars 43/44 stay at
    // the origin and can be used as the start of the linear interpolation.
    const VEHICLE_TRANSPORTS = ['camper', 'carsharing'];
    let travelOrigin = null;        // {x, y} world coords captured when travel begins
    let autoOpenedForTravel = false; // true if the minimap was auto-shown for travel
    let travelRefreshCounter = 0;    // throttles the per-frame minimap redraw

    // Bologna map constants (must match BolognaMapSystem.js)
    const BOLOGNA_MAP_ID = 353;
    const BOLOGNA_ROW_MIN = 3, BOLOGNA_ROW_MAX = 16;
    const BOLOGNA_COL_MIN = 2, BOLOGNA_COL_MAX = 10;
    const BOLOGNA_CELL_PX = 256; // pixels per cell in the assembled fullscreen bitmap
    const BOLOGNA_MAP_TILES = 256; // each Bologna cell map is 256x256 tiles

    // GalaxySim alien-planet surface (map 636, Alien* biome): pixels per
    // landing-grid cell in the fullscreen bitmap. The minimap draws the same
    // grid scaled down to mapWidth/mapHeight instead.
    const ALIEN_GRID_CELL_PX = 96;

    // Expose fullscreen state for compatibility with MousePan.js
    window.isWorldMapFullscreen = function() {
        return currentMapState === 3;
    };

    // Sandbox / debug access: enabled when the party leader is named "Test" or
    // SandboxMode.js has flagged the save. Used to gate click-to-teleport on the
    // Bologna fullscreen overlay.
    function isSandboxEnabled() {
        const leader = $gameParty && $gameParty.leader();
        const isTest = !!(leader && leader.name() === "Test");  // i18n-ignore  debug account name
        return isTest || !!($gameSystem && $gameSystem._isSandboxMode === true);
    }

    // Click tracking for Bologna overlay teleport (distinguishes tap from drag).
    let bolognaPressing = false;
    let bolognaPressX = 0, bolognaPressY = 0, bolognaPressMoved = false;

    // Plugin Commands
    PluginManager.registerCommand(pluginName, "openWorldMap", args => {
        currentMapState = 3;
        focusTileHint = null; // an explicit open follows the party
        resetZoom();
        fullscreenBitmap = null;
        refreshWorldMapDisplay();
    });

    PluginManager.registerCommand(pluginName, "showWorldMap", args => {
        currentMapState = 1;
        refreshWorldMapDisplay();
    });

    PluginManager.registerCommand(pluginName, "hideWorldMap", args => {
        currentMapState = 0;
        refreshWorldMapDisplay();
    });

    PluginManager.registerCommand(pluginName, "toggleMinimap", args => {
        if (currentMapState > 0) {
            currentMapState = 0;
        } else {
            currentMapState = 1;
        }
        refreshWorldMapDisplay();
    });

    PluginManager.registerCommand(pluginName, "showZoomableMap", args => {
        currentMapState = 3;
        focusTileHint = null; // an explicit open follows the party
        resetZoom();
        fullscreenBitmap = null;
        refreshWorldMapDisplay();
    });

    // ------------------------------------------------------------------------
    // Initialization & Helpers
    // ------------------------------------------------------------------------

    function createWorldMapSprite() {
        if (worldMapSprite) return;
        
        worldMapSprite = new Sprite();
        worldMapSprite.anchor.x = 0; 
        worldMapSprite.anchor.y = 0;
        
        // Load the master image (for Fullscreen and Map 315 Mini)
        worldMapBitmap = ImageManager.loadPicture('worldmap');
        worldMapBitmap.addLoadListener(() => {
            // A focus request (a quest detail asking "show me where this is") may
            // have arrived before the picture finished loading, in which case
            // refreshWorldMapDisplay bailed out at the readiness check. Re-apply
            // the focus instead of centring on the raw image, or the pan would be
            // silently thrown away and the map would open on the wrong place.
            if (focusTileHint) {
                focusOverride = { x: focusTileHint.x, y: focusTileHint.y };
                resetZoom();
            } else {
                // Center the map initially for fullscreen mode
                panX = (Graphics.width - worldMapBitmap.width) / 2;
                panY = (Graphics.height - worldMapBitmap.height) / 2;
            }
            refreshWorldMapDisplay();
        });

        // Add world map sprite before window layer (so busts appear in front)
        const scene = SceneManager._scene;
        if (scene._windowLayer) {
            const windowLayerIndex = scene.children.indexOf(scene._windowLayer);
            if (windowLayerIndex >= 0) {
                scene.addChildAt(worldMapSprite, windowLayerIndex);
            } else {
                scene.addChild(worldMapSprite);
            }
        } else {
            scene.addChild(worldMapSprite);
        }
    }

    function resetZoom() {
        zoomScale = 0.5; // Default to less zoomed in
        centerOnCurrentCoordinates();
    }

    // ------------------------------------------------------------------------
    // Focus requests (quest details asking for "show me where this is")
    //
    // A one-shot world coordinate that centerOnCurrentCoordinates() honours in
    // place of the player's position. Requests are queued on $gameTemp because
    // they are issued from other scenes (the quest board, the quest log) and can
    // only be carried out once Scene_Map is running again.
    // ------------------------------------------------------------------------
    let focusOverride = null;
    // Kept separately from focusOverride, which centerOnCurrentCoordinates consumes
    // immediately: the tile loader needs to know which segment to fetch first, and
    // it runs after the centring pass.
    let focusTileHint = null;

    function focusWorldMapAt(wx, wy) {
        if (wx == null || wy == null) return false;
        focusOverride = { x: Number(wx), y: Number(wy) };
        focusTileHint = { x: Number(wx), y: Number(wy) };
        autoOpenedForTravel = false;
        currentMapState = 3;          // fullscreen, the map the M key cycles to
        fullscreenBitmap = null;      // reload tiles so markers redraw
        resetZoom();
        refreshWorldMapDisplay();
        return true;
    }

    // Callable from any scene: the map opens on the next Scene_Map frame.
    function requestWorldMapFocus(wx, wy) {
        if (wx == null || wy == null) return false;
        if (!$gameTemp) return false;
        $gameTemp._worldMapFocusRequest = { x: Number(wx), y: Number(wy) };
        return true;
    }

    window.WorldMapView = {
        focusAt: focusWorldMapAt,
        requestFocusAt: requestWorldMapFocus,
    };

    function centerOnCurrentCoordinates() {
        // Bologna fullscreen: center on player position within the assembled cell grid
        if ($gameMap && $gameMap.mapId() === BOLOGNA_MAP_ID) {
            const bState = $gameSystem._bologna;
            if (bState) {
                const px = (bState.col - BOLOGNA_COL_MIN) * BOLOGNA_CELL_PX + ($gamePlayer.x / 256) * BOLOGNA_CELL_PX;
                const py = (bState.row - BOLOGNA_ROW_MIN) * BOLOGNA_CELL_PX + ($gamePlayer.y / 256) * BOLOGNA_CELL_PX;
                panX = Graphics.width / 2 - (px * zoomScale);
                panY = Graphics.height / 2 - (py * zoomScale);
            }
            return;
        }

        // GalaxySim alien planet fullscreen: center on the current landing-grid
        // cell within the planet's own (much smaller) bitmap coordinate space.
        if (isAlienPlanetSurface()) {
            const grid = window.GalaxySim.getAlienGridInfo();
            if (grid) {
                const px = (grid.gx + 0.5) * ALIEN_GRID_CELL_PX;
                const py = (grid.gy + 0.5) * ALIEN_GRID_CELL_PX;
                panX = Graphics.width / 2 - (px * zoomScale);
                panY = Graphics.height / 2 - (py * zoomScale);
            }
            return;
        }

        let centerX, centerY;

        // A pending focus request wins once, then the map goes back to following
        // the player on the next manual open.
        if (focusOverride) {
            centerX = focusOverride.x;
            centerY = focusOverride.y;
            focusOverride = null;
        } else if ($gameMap && $gameMap.mapId() === 315) {
            // If on world map (315), use actual player position
            const playerX = $gamePlayer.x || 0;
            const playerY = $gamePlayer.y || 0;
            centerX = playerX;
            centerY = playerY;
        } else {
            // Otherwise use saved coordinates from variables 43 & 44
            centerX = $gameVariables.value(43) || 0;
            centerY = $gameVariables.value(44) || 0;
        }

        // Full screen grid is 12288x12288 (8x8 tiles of 1536x1536 pixels each)
        // World coords: 0-255 range maps to 0-12288 pixels (48 pixels per world unit)
        const mapPixelX = centerX * 48;
        const mapPixelY = centerY * 48;

        // Center on this position
        panX = Graphics.width / 2 - (mapPixelX * zoomScale);
        panY = Graphics.height / 2 - (mapPixelY * zoomScale);
    }

    // ------------------------------------------------------------------------
    // Drawing Primitives
    // ------------------------------------------------------------------------

    function drawSquare(ctx, x, y, color, size) {
        const half = size / 2;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x - half), Math.round(y - half), size, size);
    }
    
    function drawDot(ctx, x, y, color, radius) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Quest objectives are drawn as gold diamonds so they never read as a
    // teleport (green square) or a vehicle (dot).
    function drawDiamond(ctx, x, y, color, size) {
        const half = size / 2;
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y - half);
        ctx.lineTo(x + half, y);
        ctx.lineTo(x, y + half);
        ctx.lineTo(x - half, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // Active quest objectives reduced to world tiles, one entry per tile.
    // ProceduralQuestSystem owns the coordinates; the world map only paints them.
    const WORLD_TILES = 256;
    function getQuestMarkerTiles() {
        const api = window.ProceduralQuests;
        if (!api || typeof api.questMarkers !== 'function') return [];
        const byTile = new Map();
        try {
            for (const m of api.questMarkers()) {
                if (m.wx == null || m.wy == null) continue;
                const key = m.wx + ',' + m.wy;
                let entry = byTile.get(key);
                if (!entry) { entry = { x: m.wx, y: m.wy, labels: [], qids: [] }; byTile.set(key, entry); }
                const step = m.multi ? ` ${m.step}/${m.stepCount}` : '';
                const label = m.label + step;
                if (!entry.labels.includes(label)) entry.labels.push(label);
                if (m.qid && !entry.qids.includes(m.qid)) entry.qids.push(m.qid);
            }
        } catch (e) { }
        return Array.from(byTile.values());
    }

    // ------------------------------------------------------------------------
    // Quest marker interaction (fullscreen map)
    //
    // Hovering a marker shows the very post-it the quest log would show for it
    // (KanbanQuest.notePreview supplies both the markup and its stylesheet, so the
    // two can never drift); clicking one opens the log on that quest.
    // ------------------------------------------------------------------------
    let questTipEl = null;
    let questTipId = null;

    function removeQuestTip() {
        if (questTipEl) { questTipEl.remove(); questTipEl = null; }
        questTipId = null;
    }

    function showQuestTip(questId, screenX, screenY) {
        if (questTipId === questId && questTipEl) {
            positionQuestTip(screenX, screenY);
            return;
        }
        const preview = window.KanbanQuest && window.KanbanQuest.notePreview
            ? window.KanbanQuest.notePreview(questId) : null;
        if (!preview) { removeQuestTip(); return; }
        removeQuestTip();
        questTipEl = document.createElement('div');
        questTipEl.id = 'wm-quest-tip';
        questTipEl.style.cssText =
            'position:fixed; z-index:90; pointer-events:none; width:300px;';
        const style = document.createElement('style');
        style.textContent = preview.css;
        questTipEl.appendChild(style);
        questTipEl.insertAdjacentHTML('beforeend', preview.html);
        document.body.appendChild(questTipEl);
        questTipId = questId;
        positionQuestTip(screenX, screenY);
    }

    function positionQuestTip(screenX, screenY) {
        if (!questTipEl) return;
        const pad = 16;
        const w = 300, h = questTipEl.offsetHeight || 180;
        let x = screenX + pad;
        let y = screenY + pad;
        if (x + w > window.innerWidth) x = screenX - w - pad;
        if (y + h > window.innerHeight) y = Math.max(0, screenY - h - pad);
        questTipEl.style.left = x + 'px';
        questTipEl.style.top = y + 'px';
    }

    // The marker under the cursor, or null. Screen space to bitmap space is the
    // inverse of the pan/zoom applied to the sprite.
    function questMarkerAtPointer() {
        if (!worldMapSprite || !worldMapSprite.bitmap) return null;
        const bmp = worldMapSprite.bitmap;
        if (!bmp.width || !zoomScale) return null;
        const bx = (TouchInput.x - panX) / zoomScale;
        const by = (TouchInput.y - panY) / zoomScale;
        // Generous in bitmap pixels, because on a 12288px sheet a marker is tiny.
        const radius = Math.max(28, 22 / zoomScale);
        let best = null, bestD = Infinity;
        for (const qt of getQuestMarkerTiles()) {
            const qx = (qt.x / WORLD_TILES) * bmp.width;
            const qy = (qt.y / WORLD_TILES) * bmp.height;
            const d = Math.abs(qx - bx) + Math.abs(qy - by);
            if (d <= radius * 2 && d < bestD) { bestD = d; best = qt; }
        }
        return best;
    }

    function updateQuestMarkerInteraction() {
        if (currentMapState !== 3) { removeQuestTip(); return; }
        const hit = questMarkerAtPointer();
        if (!hit || !hit.qids || !hit.qids.length) { removeQuestTip(); return; }
        const qid = hit.qids[0];
        showQuestTip(qid, TouchInput.x, TouchInput.y);
        if (TouchInput.isTriggered()) {
            removeQuestTip();
            if (window.KanbanQuest && window.KanbanQuest.openAt && window.KanbanQuest.openAt(qid)) {
                SoundManager.playOk();
                TouchInput.clear();
            }
        }
    }

    // ------------------------------------------------------------------------
    // Off-screen quest markers (fullscreen world map)
    //
    // GTA-style: an objective panned out of view is not lost. It slides onto the
    // border of the screen as an arrow pointing at where it really is, and only
    // goes away once the map has been dragged far enough for the real gold
    // diamond to come into view. These live as screen-space sprites over the map
    // sprite, because the diamonds themselves are painted inside the world
    // bitmap, which is what the pan and the zoom move around.
    // ------------------------------------------------------------------------
    const EDGE_MARKER_MARGIN = 34;  // px between the screen border and the arrow
    const EDGE_MARKER_ARROW = 26;   // arrow sprite size
    let questEdgeContainer = null;
    let questEdgeKey = null;        // signature of the marker set the sprites show
    let questEdgeArrowBitmap = null;

    // A triangle pointing up (-Y); each marker rotates it toward its objective.
    function edgeArrowBitmap() {
        if (questEdgeArrowBitmap) return questEdgeArrowBitmap;
        const s = EDGE_MARKER_ARROW;
        const bmp = new Bitmap(s, s);
        const ctx = bmp.context;
        ctx.beginPath();
        ctx.moveTo(s / 2, 2);
        ctx.lineTo(s - 3, s - 4);
        ctx.lineTo(s / 2, s - 9);
        ctx.lineTo(3, s - 4);
        ctx.closePath();
        ctx.fillStyle = questMarkerColor;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        bmp.baseTexture.update();
        questEdgeArrowBitmap = bmp;
        return bmp;
    }

    // Quest names next to the arrow, in a bitmap only as wide as the text so it
    // can be clamped against the screen edge without leaving a gap.
    function edgeLabelSprite(labels) {
        const lineH = labelFontSize + 4;
        const probe = new Bitmap(8, 8);
        probe.fontFace = 'GameFont, sans-serif';
        probe.fontSize = labelFontSize;
        probe.fontBold = true;
        let w = 24;
        for (const text of labels) {
            w = Math.max(w, Math.ceil(probe.measureTextWidth(text)) + 12);
        }
        if (probe.destroy) probe.destroy();

        const bmp = new Bitmap(w, lineH * labels.length + 4);
        bmp.fontFace = 'GameFont, sans-serif';
        bmp.fontSize = labelFontSize;
        bmp.fontBold = true;
        bmp.outlineWidth = 4;
        bmp.outlineColor = 'black';
        bmp.textColor = questMarkerColor;
        for (let i = 0; i < labels.length; i++) {
            bmp.drawText(labels[i], 0, i * lineH, w, lineH, 'center');
        }
        const sprite = new Sprite(bmp);
        sprite.anchor.x = 0.5;
        return sprite;
    }

    function ensureQuestEdgeContainer() {
        if (!worldMapSprite || !worldMapSprite.parent) return null;
        const parent = worldMapSprite.parent;
        if (!questEdgeContainer) {
            questEdgeContainer = new Sprite();
            questEdgeContainer._groups = [];
        }
        // Sits directly above the map sprite, and follows it if the scene rebuilt.
        if (questEdgeContainer.parent !== parent) {
            if (questEdgeContainer.parent) {
                questEdgeContainer.parent.removeChild(questEdgeContainer);
            }
            parent.addChildAt(questEdgeContainer, parent.children.indexOf(worldMapSprite) + 1);
        }
        return questEdgeContainer;
    }

    function removeQuestEdgeMarkers() {
        if (questEdgeContainer && questEdgeContainer.parent) {
            questEdgeContainer.parent.removeChild(questEdgeContainer);
        }
        questEdgeContainer = null;
        questEdgeKey = null;
    }

    function hideQuestEdgeMarkers() {
        if (!questEdgeContainer) return;
        for (const group of questEdgeContainer._groups) group.visible = false;
    }

    // Rebuilt only when the marker set itself changes; panning just moves sprites.
    function questEdgeSignature(tiles) {
        return tiles.map(t => t.x + ',' + t.y + ':' + t.labels.join('|')).join(';');
    }

    function buildQuestEdgeMarkers(tiles) {
        const container = ensureQuestEdgeContainer();
        if (!container) return null;
        container.removeChildren();
        container._groups = [];
        for (const tile of tiles) {
            const group = new Sprite();
            const arrow = new Sprite(edgeArrowBitmap());
            arrow.anchor.x = 0.5;
            arrow.anchor.y = 0.5;
            const label = edgeLabelSprite(tile.labels);
            group.addChild(arrow);
            group.addChild(label);
            group._arrow = arrow;
            group._label = label;
            group._tile = tile;
            group.visible = false;
            container.addChild(group);
            container._groups.push(group);
        }
        return container;
    }

    function updateQuestEdgeMarkers() {
        // Only the world sheet paints quest diamonds; the Bologna and alien-planet
        // fullscreens are other coordinate spaces entirely.
        if (currentMapState !== 3 || !worldMapSprite || !worldMapSprite.bitmap ||
            !$gameMap || $gameMap.mapId() === BOLOGNA_MAP_ID || isAlienPlanetSurface()) {
            hideQuestEdgeMarkers();
            return;
        }
        const bmp = worldMapSprite.bitmap;
        if (!bmp.width || !bmp.height || !zoomScale) { hideQuestEdgeMarkers(); return; }

        const tiles = getQuestMarkerTiles();
        const key = questEdgeSignature(tiles);
        if (key !== questEdgeKey) {
            if (!buildQuestEdgeMarkers(tiles)) return;
            questEdgeKey = key;
        }
        const container = ensureQuestEdgeContainer();
        if (!container) return;

        const cx = Graphics.width / 2;
        const cy = Graphics.height / 2;
        const halfW = Math.max(1, cx - EDGE_MARKER_MARGIN);
        const halfH = Math.max(1, cy - EDGE_MARKER_MARGIN);

        for (const group of container._groups) {
            const tile = group._tile;
            const sx = panX + (tile.x / WORLD_TILES) * bmp.width * zoomScale;
            const sy = panY + (tile.y / WORLD_TILES) * bmp.height * zoomScale;

            // Inside the viewport (minus the band the arrows occupy): the real
            // diamond is doing the job, so the border marker steps aside.
            if (sx >= EDGE_MARKER_MARGIN && sx <= Graphics.width - EDGE_MARKER_MARGIN &&
                sy >= EDGE_MARKER_MARGIN && sy <= Graphics.height - EDGE_MARKER_MARGIN) {
                group.visible = false;
                continue;
            }

            const dx = sx - cx;
            const dy = sy - cy;
            if (!dx && !dy) { group.visible = false; continue; }

            // Push the direction out until it hits the border box.
            const ratio = Math.min(
                Math.abs(dx) > 0.001 ? halfW / Math.abs(dx) : Infinity,
                Math.abs(dy) > 0.001 ? halfH / Math.abs(dy) : Infinity);
            const ex = cx + dx * ratio;
            const ey = cy + dy * ratio;

            group.visible = true;
            group._arrow.x = ex;
            group._arrow.y = ey;
            group._arrow.rotation = Math.atan2(dy, dx) + Math.PI / 2;

            // The name goes on whichever side of the arrow has room, and never
            // hangs off the screen it was just clamped to.
            const label = group._label;
            const lw = label.bitmap.width / 2;
            label.x = Math.min(Graphics.width - lw - 4, Math.max(lw + 4, ex));
            label.y = ey < cy
                ? ey + EDGE_MARKER_ARROW / 2 + 2
                : ey - EDGE_MARKER_ARROW / 2 - 2 - label.bitmap.height;
        }
    }

    function drawLabel(ctx, x, y, text, color, sizePx) {
        const px = sizePx || labelFontSize;
        ctx.font = `bold ${px}px GameFont, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Text Outline (Stroke)
        ctx.strokeStyle = 'black';
        ctx.lineWidth = Math.max(3, px / 5);
        ctx.strokeText(text, x + px * 0.6, y); // Offset slightly to right of dot

        // Text Fill
        ctx.fillStyle = color || 'white';
        ctx.fillText(text, x + px * 0.6, y);
    }

    function drawCoordinates(ctx, bitmapWidth, bitmapHeight, coordX, coordY, playerX, playerY) {
        let text = `${coordX}, ${coordY}`;

        // Only append local coordinates if we have them and not on map 315
        if (playerX !== undefined && playerY !== undefined && $gameMap.mapId() !== 315) {
            text += ` | ${playerX}, ${playerY}`;
        }

        const fontSize = 12;
        const padding = 6;
        const x = bitmapWidth - padding;
        const y = bitmapHeight - padding;

        ctx.font = `${fontSize}px GameFont, sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';

        // Text Outline (Stroke)
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeText(text, x, y);

        // Text Fill
        ctx.fillStyle = 'white';
        ctx.fillText(text, x, y);
    }

    function drawDetailedBlockGrid(ctx, bitmapWidth, bitmapHeight, proceduralZoom, tileScale) {
        // Draw grid lines for the detailed block view minimap
        // proceduralZoom: how many units are shown (e.g., 16 units)
        // tileScale: pixels per unit in the zoomed view

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;

        const pixelsPerUnit = (bitmapWidth / proceduralZoom);

        // Draw vertical grid lines
        for (let i = 0; i <= proceduralZoom; i++) {
            const x = Math.round(i * pixelsPerUnit);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, bitmapHeight);
            ctx.stroke();
        }

        // Draw horizontal grid lines
        for (let i = 0; i <= proceduralZoom; i++) {
            const y = Math.round(i * pixelsPerUnit);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(bitmapWidth, y);
            ctx.stroke();
        }
    }

    // GalaxySim alien-planet surface: the planet's unwrapped equirectangular
    // texture (same source/drawing routine as the in-orbit landing picker,
    // see GalaxySim_Overlay.js's showLandingGrid) scaled to destW x destH,
    // divided into its landing grid, with the player's current cell marked.
    // Returns null when GalaxySim isn't available or no planet is landed.
    function buildAlienPlanetBitmap(destW, destH) {
        const GS = window.GalaxySim;
        if (!GS || !GS.Renderer3D || !GS.Renderer3D.drawPlanetGrid ||
            !GS.getAlienGridInfo || !GS.getAlienGridTextureCanvas) return null;
        const grid = GS.getAlienGridInfo();
        const textureCanvas = GS.getAlienGridTextureCanvas();
        if (!grid || !textureCanvas) return null;

        const bitmap = new Bitmap(destW, destH);
        GS.Renderer3D.drawPlanetGrid(bitmap.context, {
            textureCanvas,
            destW, destH,
            gridW: grid.w, gridH: grid.h,
            playerCell: { gx: grid.gx, gy: grid.gy },
        });
        drawCoordinates(bitmap.context, destW, destH, grid.gx, grid.gy, $gamePlayer.x, $gamePlayer.y);
        bitmap.baseTexture.update();
        return bitmap;
    }

    function isAlienPlanetSurface() {
        return $gameMap && $gameMap.mapId() === 636 &&
            !!(window.GalaxySim && window.GalaxySim.isAlienSurface && window.GalaxySim.isAlienSurface());
    }

    // ------------------------------------------------------------------------
    // Core Logic
    // ------------------------------------------------------------------------

    function toggleMapState() {
        // New Cycle: 1 (Zoomed Mini) -> 2 (Default Mini) -> 3 (Full Map) -> 1 ...
        if (currentMapState === 1) {
            currentMapState = 2; // Go to Default Minimap
        } else if (currentMapState === 2) {
            currentMapState = 3; // Go to Full Map
            resetZoom();
            fullscreenBitmap = null; // Clear cache to reload tiles
        } else if (currentMapState === 3) {
            currentMapState = 1; // Go back to Zoomed Minimap
            fullscreenBitmap = null;
            focusTileHint = null; // manual cycling follows the party again
        } else {
            currentMapState = 1; // Fallback
        }

        refreshWorldMapDisplay();
    }

    function refreshWorldMapDisplay() {
        if (!worldMapSprite) createWorldMapSprite();
        
        // We only hard-check worldMapBitmap for Fullscreen or Map 315.
        // If we are in Detail Mode (Map != 315), we load dynamic images.
        const isBologna = $gameMap && $gameMap.mapId() === BOLOGNA_MAP_ID;
        const isAlienPlanet = isAlienPlanetSurface();
        if (currentMapState === 3 && !isBologna && !isAlienPlanet && (!worldMapBitmap || !worldMapBitmap.isReady())) return;

        worldMapSprite.visible = true;

        if (currentMapState === 1 || currentMapState === 2) {
            // --- MINI MODE ---
            renderMiniMap();
            worldMapSprite.x = Graphics.width - mapWidth - 10;
            worldMapSprite.y = 10;
            worldMapSprite.scale.x = 1;
            worldMapSprite.scale.y = 1;
            worldMapSprite.opacity = paramOpacity;
        } else if (currentMapState === 3) {
            // --- FULLSCREEN ZOOM MODE ---
            renderFullscreenMap();
            worldMapSprite.x = panX;
            worldMapSprite.y = panY;
            worldMapSprite.scale.x = zoomScale;
            worldMapSprite.scale.y = zoomScale;
            worldMapSprite.opacity = 255;
        }
    }

    // ------------------------------------------------------------------------
    // Live Vehicle Fast-Travel Tracking
    // ------------------------------------------------------------------------

    function getTravelData() {
        return ($gameSystem && $gameSystem.getFastTravelData) ? $gameSystem.getFastTravelData() : null;
    }

    // True while a vehicle fast-travel timer is running AND we have captured the
    // world origin, i.e. the vehicle should be shown crossing the world map.
    function isVehicleTravelActive() {
        const data = getTravelData();
        return !!(data && data.timerActive && data.timerRemainingTime > 0 &&
            data.finalDestination && travelOrigin &&
            VEHICLE_TRANSPORTS.includes(data.timerTransport));
    }

    // Continuous 0..1 trip progress. Derived from the travel timer's own
    // remaining/duration (the same clock other systems display) rather than the
    // wall clock, so pausing for a menu/dialog does not desync the vehicle dot.
    function getTravelProgress(data) {
        if (!data || !data.timerDuration) return 0;
        let p;
        if (typeof data.timerRemainingTime === 'number') {
            p = (data.timerDuration - data.timerRemainingTime) / data.timerDuration;
        } else {
            p = 0;
        }
        return Math.max(0, Math.min(1, p));
    }

    // Linearly interpolated world position {x, y} of the travelling vehicle.
    function getTravelVehiclePosition() {
        const data = getTravelData();
        if (!data || !travelOrigin || !data.finalDestination) return null;
        const p = getTravelProgress(data);
        return {
            x: travelOrigin.x + (data.finalDestination.x - travelOrigin.x) * p,
            y: travelOrigin.y + (data.finalDestination.y - travelOrigin.y) * p,
            progress: p
        };
    }

    // Full world overview minimap with the vehicle moving along the origin ->
    // destination line. Shown while the player is inside the vehicle during travel.
    function renderTravelMiniMap() {
        if (!worldMapBitmap || !worldMapBitmap.isReady()) return;

        const data = getTravelData();
        const pos = getTravelVehiclePosition();
        if (!data || !pos) return;

        const targetW = mapWidth;
        const targetH = mapHeight;

        const bitmap = new Bitmap(targetW, targetH);
        bitmap.blt(worldMapBitmap, 0, 0, worldMapBitmap.width, worldMapBitmap.height, 0, 0, targetW, targetH);
        const ctx = bitmap.context;

        // World coords are 0-255; map them across the full minimap.
        const toPx = wx => (wx / 256) * targetW;
        const toPy = wy => (wy / 256) * targetH;

        const ox = toPx(travelOrigin.x), oy = toPy(travelOrigin.y);
        const dx = toPx(data.finalDestination.x), dy = toPy(data.finalDestination.y);
        const vx = toPx(pos.x), vy = toPy(pos.y);

        ctx.save();
        // Full planned route (origin -> destination), dashed faint.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(dx, dy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Distance already covered (origin -> current), solid bright.
        ctx.strokeStyle = '#FFD24A';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(vx, vy);
        ctx.stroke();
        ctx.restore();

        // Origin and destination markers.
        drawSquare(ctx, ox, oy, '#AAAAAA', 5);
        drawSquare(ctx, dx, dy, '#00FF00', 6);

        // Moving vehicle dot, coloured by transport.
        const vColor = data.timerTransport === 'camper' ? shipColor
            : data.timerTransport === 'carsharing' ? boatColor
            : playerColor;
        drawDot(ctx, vx, vy, vColor, 5);

        // Destination name + current interpolated world coordinates.
        if (data.timerDestination) {
            drawLabel(ctx, dx, dy, String(data.timerDestination));
        }
        drawCoordinates(ctx, targetW, targetH, Math.round(pos.x), Math.round(pos.y));

        setWorldMapSpriteBitmap(bitmap);
    }

    // Render Logic for Mini Map
    // Teleport events are static map data, so the list only changes on map load.
    // Cache it keyed by mapId to avoid regex-testing every event each redraw.
    let teleportEventsCache = null;
    let teleportEventsCacheMapId = -1;
    function getTeleportEvents() {
        const mapId = $gameMap.mapId();
        if (teleportEventsCacheMapId !== mapId || !teleportEventsCache) {
            teleportEventsCache = $gameMap.events().filter(ev => {
                if (!ev || !ev.event()) return false;
                return /^teleport/i.test(ev.event().name || "");
            });
            teleportEventsCacheMapId = mapId;
        }
        return teleportEventsCache;
    }

    function renderMiniMap() {
        const mapId = $gameMap.mapId();

        // While travelling inside a vehicle, replace the local detail view with a
        // full world overview that animates the vehicle moving to its destination.
        if (mapId !== 315 && isVehicleTravelActive()) {
            renderTravelMiniMap();
            return;
        }
        const targetW = mapWidth;
        const targetH = mapHeight;

        // 1. If on World Map (315), show a zoomed-in view around the player
        if (mapId === 315) {
            if (!worldMapBitmap || !worldMapBitmap.isReady()) return;
            // A refresh mid-transfer onto 315 can run before $dataMap is populated.
            if (!$dataMap) return;

            const bitmap = new Bitmap(targetW, targetH);

            if (currentMapState === 1) {
                // --- ZOOMED MINIMAP ---
                const mw = $dataMap.width;
                const mh = $dataMap.height;
                const zoomTiles = (proceduralZoomLevel || 16) * 4; // Show 4x more area on world map
                
                const playerX = $gamePlayer.x;
                const playerY = $gamePlayer.y;

                // Calculate source rect in world map pixels
                const pxPerTileX = worldMapBitmap.width / mw;
                const pxPerTileY = worldMapBitmap.height / mh;

                const halfZoom = zoomTiles / 2;
                const srcXInTiles = Math.max(0, Math.min(mw - zoomTiles, playerX - halfZoom));
                const srcYInTiles = Math.max(0, Math.min(mh - zoomTiles, playerY - halfZoom));

                bitmap.blt(worldMapBitmap,
                    srcXInTiles * pxPerTileX, srcYInTiles * pxPerTileY,
                    zoomTiles * pxPerTileX, zoomTiles * pxPerTileY,
                    0, 0, targetW, targetH);

                const context = bitmap.context;

                // Draw player relative to cropped view
                const gridCellWidth = targetW / zoomTiles;
                const gridCellHeight = targetH / zoomTiles;
                const ppx = Math.floor(((playerX - srcXInTiles) / zoomTiles) * targetW) + gridCellWidth / 2;
                const ppy = Math.floor(((playerY - srcYInTiles) / zoomTiles) * targetH) + gridCellHeight / 2;

                drawDot(context, ppx, ppy, playerColor, 5);

                // Draw teleport events relative to cropped view. The teleport
                // event list is precomputed per map (see getTeleportEvents) so we
                // don't regex-test every event on the map each redraw.
                const teleportEvents = getTeleportEvents();
                for (const ev of teleportEvents) {
                    if (!ev || ev._erased) continue;
                    if (ev.x >= srcXInTiles && ev.x < srcXInTiles + zoomTiles &&
                        ev.y >= srcYInTiles && ev.y < srcYInTiles + zoomTiles) {

                        const ex = Math.floor(((ev.x - srcXInTiles) / zoomTiles) * targetW) + gridCellWidth / 2;
                        const ey = Math.floor(((ev.y - srcYInTiles) / zoomTiles) * targetH) + gridCellHeight / 2;

                        drawSquare(context, ex, ey, '#00FF00', 6);
                    }
                }

                // Active quest objectives inside the same cropped window.
                for (const qt of getQuestMarkerTiles()) {
                    if (qt.x < srcXInTiles || qt.x >= srcXInTiles + zoomTiles ||
                        qt.y < srcYInTiles || qt.y >= srcYInTiles + zoomTiles) continue;
                    const qx = Math.floor(((qt.x - srcXInTiles) / zoomTiles) * targetW) + gridCellWidth / 2;
                    const qy = Math.floor(((qt.y - srcYInTiles) / zoomTiles) * targetH) + gridCellHeight / 2;
                    drawDiamond(context, qx, qy, questMarkerColor, 9);
                }

                // Draw coordinates
                drawCoordinates(context, targetW, targetH, playerX, playerY);
            } else {
                // --- DEFAULT MINIMAP (FULL VIEW) ---
                bitmap.blt(worldMapBitmap, 0, 0, worldMapBitmap.width, worldMapBitmap.height, 0, 0, targetW, targetH);
                // Draw Entities Global
                drawEntitiesOnBitmap(bitmap, targetW, targetH, false);
            }

            setWorldMapSpriteBitmap(bitmap);
            return;
        }

        // 2. Bologna map (353) - show the whole current Bologna cell.
        // The cell tile is only 256px for 256 tiles, so the old 16-tile crop blew
        // a tiny 16px patch up to fill the minimap and looked like illegible mush.
        // Drawing the entire cell keeps the streets readable. State 1 (zoomed)
        // shows a generous window around the player; state 2 shows the full cell.
        if (mapId === BOLOGNA_MAP_ID) {
            const bState = $gameSystem._bologna;
            if (!bState) return;
            const { row, col } = bState;
            const tileBitmap = loadCachedTile(`img/worldmap/bologna/row-${row}-column-${col}.jpg`);
            if (!tileBitmap.isReady()) { tileBitmap.addLoadListener(refreshWorldMapDisplay); return; }
            const bitmap = new Bitmap(targetW, targetH);
            const playerX = $gamePlayer.x;
            const playerY = $gamePlayer.y;

            // In zoomed mode show a 96-tile window; otherwise the entire 256 cell.
            const viewTiles = (currentMapState === 1) ? 96 : BOLOGNA_MAP_TILES;
            const halfZoom = viewTiles / 2;
            const srcX = Math.max(0, Math.min(BOLOGNA_MAP_TILES - viewTiles, playerX - halfZoom));
            const srcY = Math.max(0, Math.min(BOLOGNA_MAP_TILES - viewTiles, playerY - halfZoom));
            const tileScale = tileBitmap.width / BOLOGNA_MAP_TILES;

            bitmap.blt(tileBitmap,
                srcX * tileScale, srcY * tileScale,
                viewTiles * tileScale, viewTiles * tileScale,
                0, 0, targetW, targetH);

            const context = bitmap.context;
            const px = ((playerX - srcX) / viewTiles) * targetW;
            const py = ((playerY - srcY) / viewTiles) * targetH;
            drawDot(context, px, py, playerColor, 5);
            drawCoordinates(context, targetW, targetH, playerX, playerY);
            setWorldMapSpriteBitmap(bitmap);
            return;
        }

        // 2.5. GalaxySim alien planet surface (map 636, Alien* biome): show the
        // planet's own unwrapped landing grid instead of Earth's
        // row-N-column-M tiles, which don't exist for this coordinate space.
        if (isAlienPlanetSurface()) {
            const alienBitmap = buildAlienPlanetBitmap(targetW, targetH);
            if (alienBitmap) setWorldMapSpriteBitmap(alienBitmap);
            return;
        }

        // 3. If NOT on Map 315, show the Detailed Block (with procedural zoom)
        // Calculate which 8x8 block we are in
        const varX = $gameVariables.value(43) || 0;
        const varY = $gameVariables.value(44) || 0;

        // 256 units / 8 blocks = 32 units per block
        const col = Math.floor(varX / 32) + 1;
        const row = Math.floor(varY / 32) + 1;

        // Load the specific tile image: img/worldmap/row-X-column-Y
        const filename = `row-${row}-column-${col}`;  // i18n-ignore  asset path
        const tileBitmap = loadCachedTile(`img/worldmap/${filename}.jpg`);

        if (!tileBitmap.isReady()) {
            // If the tile isn't loaded yet, try again shortly
            tileBitmap.addLoadListener(refreshWorldMapDisplay);
            return;
        }

        const bitmap = new Bitmap(targetW, targetH);

        // Calculate local coordinates within the 32x32 block
        const localX = varX % 32;
        const localY = varY % 32;

        // Calculate the zoom-level view: center on player, show proceduralZoomLevel x proceduralZoomLevel area
        const halfZoom = proceduralZoomLevel / 2;
        const srcX = Math.max(0, Math.min(32 - proceduralZoomLevel, localX - halfZoom));
        const srcY = Math.max(0, Math.min(32 - proceduralZoomLevel, localY - halfZoom));

        // Draw the zoomed portion of the tile
        const tileScale = tileBitmap.width / 32; // pixels per unit
        bitmap.blt(tileBitmap,
            srcX * tileScale, srcY * tileScale,
            proceduralZoomLevel * tileScale, proceduralZoomLevel * tileScale,
            0, 0, targetW, targetH);

        // Draw Player Relative to zoomed view
        const context = bitmap.context;

        // Draw grid for detailed block view
        drawDetailedBlockGrid(context, targetW, targetH, proceduralZoomLevel, tileScale);

        // Scale player position to zoomed minimap
        // (localX - srcX) / proceduralZoomLevel gives position within the zoomed area
        const gridCellWidth = targetW / proceduralZoomLevel;
        const gridCellHeight = targetH / proceduralZoomLevel;
        const px = Math.floor(((localX - srcX) / proceduralZoomLevel) * targetW) + gridCellWidth / 2;
        const py = Math.floor(((localY - srcY) / proceduralZoomLevel) * targetH) + gridCellHeight / 2;

        drawDot(context, px, py, playerColor, 5);

        // Draw coordinates on bottom right, including local player position
        const playerLocalX = $gamePlayer.x;
        const playerLocalY = $gamePlayer.y;
        drawCoordinates(context, targetW, targetH, varX, varY, playerLocalX, playerLocalY);

        setWorldMapSpriteBitmap(bitmap);
    }

    // GalaxySim alien planet: unlike Earth's tile grid, the texture is a
    // single already-in-memory canvas, so it can be drawn synchronously with
    // no async load/cache machinery.
    function renderAlienPlanetFullscreen() {
        const grid = window.GalaxySim && window.GalaxySim.getAlienGridInfo && window.GalaxySim.getAlienGridInfo();
        if (!grid) return;
        const w = Math.max(1, grid.w) * ALIEN_GRID_CELL_PX;
        const h = Math.max(1, grid.h) * ALIEN_GRID_CELL_PX;
        const bitmap = buildAlienPlanetBitmap(w, h);
        if (bitmap) setWorldMapSpriteBitmap(bitmap);
    }

    // Render Logic for Fullscreen (8x8 grid of detailed tiles with async loading)
    function renderFullscreenMap() {
        if ($gameMap && $gameMap.mapId() === BOLOGNA_MAP_ID) {
            renderBolognaFullscreen();
            return;
        }
        if (isAlienPlanetSurface()) {
            renderAlienPlanetFullscreen();
            return;
        }
        const tilePixelSize = 1536; // Each tile is 1536x1536 pixels
        const gridSize = 8; // 8x8 grid
        const totalSize = tilePixelSize * gridSize; // 12288x12288 pixels

        // Reuse cached bitmap or create new one
        if (!fullscreenBitmap) {
            const target = fullscreenBitmap = new Bitmap(totalSize, totalSize);
            tilesLoaded = 0;
            loadFullscreenTiles(target, tilePixelSize, gridSize, totalSize);
        }

        setWorldMapSpriteBitmap(fullscreenBitmap);
    }

    // The world image is 64 JPEG segments of 1536x1536. Requesting all of them at
    // once stalls the frame and, worse, the old code only painted the grid and the
    // entity markers once the LAST segment arrived, so a single slow or missing
    // file left the map with no player dot and no quest markers at all.
    //
    // Instead: work outwards from the segment the party is standing in, a few at a
    // time, and repaint the overlay after every arrival. The area the player cares
    // about is legible almost immediately and the markers are always drawn.
    const FULLSCREEN_TILE_BATCH = 4;

    // Which 8x8 segment holds a world coordinate (each segment spans 32 tiles).
    function playerFullscreenCell(gridSize) {
        let wx, wy;
        if ($gameMap && $gameMap.mapId() === 315 && $gamePlayer) {
            wx = $gamePlayer.x; wy = $gamePlayer.y;
        } else {
            wx = $gameVariables ? ($gameVariables.value(43) || 0) : 0;
            wy = $gameVariables ? ($gameVariables.value(44) || 0) : 0;
        }
        const per = WORLD_TILES / gridSize;
        const clamp = v => Math.max(1, Math.min(gridSize, Math.floor(v / per) + 1));
        return { row: clamp(wy), col: clamp(wx) };
    }

    function loadFullscreenTiles(target, tilePixelSize, gridSize, totalSize) {
        // A focus request centres somewhere other than the player, so load around
        // whatever the map is about to show rather than around the party.
        const per = WORLD_TILES / gridSize;
        const clampCell = v => Math.max(1, Math.min(gridSize, Math.floor(v / per) + 1));
        const focus = focusTileHint
            ? { row: clampCell(focusTileHint.y), col: clampCell(focusTileHint.x) }
            : playerFullscreenCell(gridSize);
        const order = [];
        for (let row = 1; row <= gridSize; row++) {
            for (let col = 1; col <= gridSize; col++) {
                order.push({
                    row, col,
                    d: Math.max(Math.abs(row - focus.row), Math.abs(col - focus.col)),
                });
            }
        }
        // Nearest first; stable within a ring so the order is deterministic.
        order.sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col);

        let next = 0;
        const pump = () => {
            if (fullscreenBitmap !== target) return; // cache cleared, abandon
            while (next < order.length) {
                const spent = next;
                if (spent - tilesLoaded >= FULLSCREEN_TILE_BATCH) return; // let some land first
                const t = order[next++];
                const tileBitmap = Bitmap.load(`img/worldmap/row-${t.row}-column-${t.col}.jpg`);
                tileBitmap.addLoadListener(() => {
                    // The cache may have been cleared (map closed/reopened) while
                    // this tile was still loading; drop stale blits.
                    if (fullscreenBitmap !== target) return;
                    const destX = (t.col - 1) * tilePixelSize;
                    const destY = (t.row - 1) * tilePixelSize;
                    target.blt(tileBitmap, 0, 0, tileBitmap.width, tileBitmap.height,
                        destX, destY, tilePixelSize, tilePixelSize);
                    tilesLoaded++;
                    // Grid + player + teleports + quest markers, repainted over
                    // whatever has arrived so far. Throttled because each repaint
                    // forces a texture upload of a very large bitmap: paint at once
                    // for the segment the player is in, then occasionally, then a
                    // final pass so nothing is missing when loading finishes.
                    const last = tilesLoaded >= order.length;
                    if (tilesLoaded === 1 || last || tilesLoaded % 8 === 0) {
                        drawFullscreenGridLines(target, tilePixelSize, gridSize, totalSize);
                        refreshWorldMapDisplay();
                    }
                    pump();
                });
            }
        };
        pump();
    }

    function drawFullscreenGridLines(bitmap, tilePixelSize, gridSize, totalSize) {
        const ctx = bitmap.context;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;

        for (let i = 1; i < gridSize; i++) {
            const pos = i * tilePixelSize;
            // Vertical lines
            ctx.beginPath();
            ctx.moveTo(pos, 0);
            ctx.lineTo(pos, totalSize);
            ctx.stroke();

            // Horizontal lines
            ctx.beginPath();
            ctx.moveTo(0, pos);
            ctx.lineTo(totalSize, pos);
            ctx.stroke();
        }

        // Draw entities after grid
        drawEntitiesOnBitmap(bitmap, totalSize, totalSize, true);
    }

    function renderBolognaFullscreen() {
        const totalCols = BOLOGNA_COL_MAX - BOLOGNA_COL_MIN + 1; // 9
        const totalRows = BOLOGNA_ROW_MAX - BOLOGNA_ROW_MIN + 1; // 14
        const totalW = totalCols * BOLOGNA_CELL_PX;
        const totalH = totalRows * BOLOGNA_CELL_PX;
        if (!fullscreenBitmap) {
            const target = fullscreenBitmap = new Bitmap(totalW, totalH);
            let loaded = 0;
            const total = totalCols * totalRows;
            for (let r = BOLOGNA_ROW_MIN; r <= BOLOGNA_ROW_MAX; r++) {
                for (let c = BOLOGNA_COL_MIN; c <= BOLOGNA_COL_MAX; c++) {
                    (function(row, col) {
                        const tb = Bitmap.load(`img/worldmap/bologna/row-${row}-column-${col}.jpg`);
                        tb.addLoadListener(() => {
                            // Cache cleared while this tile was loading — drop stale blits.
                            if (fullscreenBitmap !== target) return;
                            const dx = (col - BOLOGNA_COL_MIN) * BOLOGNA_CELL_PX;
                            const dy = (row - BOLOGNA_ROW_MIN) * BOLOGNA_CELL_PX;
                            target.blt(tb, 0, 0, tb.width, tb.height, dx, dy, BOLOGNA_CELL_PX, BOLOGNA_CELL_PX);
                            loaded++;
                            if (loaded === total) {
                                const bState = $gameSystem._bologna;
                                if (bState) {
                                    const ctx2 = target.context;
                                    const cellPx = (bState.col - BOLOGNA_COL_MIN) * BOLOGNA_CELL_PX;
                                    const cellPy = (bState.row - BOLOGNA_ROW_MIN) * BOLOGNA_CELL_PX;
                                    const ppx = cellPx + ($gamePlayer.x / 256) * BOLOGNA_CELL_PX;
                                    const ppy = cellPy + ($gamePlayer.y / 256) * BOLOGNA_CELL_PX;
                                    drawDot(ctx2, ppx, ppy, playerColor, 8);
                                    target.baseTexture.update();
                                }
                                refreshWorldMapDisplay();
                            }
                        });
                    })(r, c);
                }
            }
        }
        setWorldMapSpriteBitmap(fullscreenBitmap);
    }

    function drawEntitiesOnBitmap(bitmap, targetW, targetH, showLabels) {
        // This function draws global entities.
        // If we are in MiniMap mode on a non-315 map, this function is NOT called.
        // This is only for Global Views (Map 315 OR Fullscreen).

        if (!$gameMap || !$gamePlayer) return;

        const context = bitmap.context;
        context.save();

        const mapId = $gameMap.mapId();

        // 1. Teleport Events (Only visible if actual events exist, i.e., on Map 315)
        // If we are on map 10 (Town), $gameMap.events are townspeople, so we generally won't find "teleport" names.
        const events = $gameMap.events();
        
        // We need the world map dimensions for reference
        const wTiles = $dataMap ? $dataMap.width : 256; 
        const hTiles = $dataMap ? $dataMap.height : 256;

        for (const ev of events) {
            if (!ev || ev._erased) continue;
            const name = ev.event().name || "";
            if (/^teleport/i.test(name)) {
                const ex = Math.floor((ev.x / wTiles) * targetW);
                const ey = Math.floor((ev.y / hTiles) * targetH);

                drawSquare(context, ex, ey, '#00FF00', showLabels ? 10 : 6);

                if (showLabels) {
                    let labelText = name.replace(/^teleport\s*/i, '').replace(/^-\s*/, '').trim();
                    if (labelText) {
                        drawLabel(context, ex, ey, labelText);
                    }
                }
            }
        }

        // 1b. Active quest objectives. Always in world-tile space (0-255), which
        // is what the world image and the vars 43/44 coordinates both use.
        const questTiles = getQuestMarkerTiles();
        // The fullscreen sheet is 12288px wide and is drawn zoomed out, so a
        // 14px label on it renders about 7px on screen. Scale the marker and its
        // name with the bitmap so the quest name is actually readable.
        const markerPx = Math.max(8, Math.round(targetW / 400));
        const namePx = Math.max(labelFontSize, Math.round(targetW / 380));
        for (const qt of questTiles) {
            const qx = Math.floor((qt.x / WORLD_TILES) * targetW);
            const qy = Math.floor((qt.y / WORLD_TILES) * targetH);
            drawDiamond(context, qx, qy, questMarkerColor, showLabels ? markerPx : 8);
            if (showLabels) {
                for (let i = 0; i < qt.labels.length; i++) {
                    drawLabel(context, qx, qy + i * (namePx + 4), qt.labels[i], questMarkerColor, namePx);
                }
            }
        }

        // 2. Vehicles (Global Global coords)
        // If vehicles are not on the current map, their x/y might be irrelevant or stored elsewhere.
        // Standard MV/MZ keeps vehicle coords on $gameMap.boat()._x regardless of map, 
        // but we check _mapId to ensure they are on the world map.
        const dotSize = showLabels ? 6 : 3;
        const worldMapId = 315; // Assuming 315 is the Overworld ID for vehicle checks

        if ($gameMap.boat()._mapId === worldMapId) {
            // We assume standard 256 coordinate logic for vehicle globals or use variables if custom
            // Standard:
            const bx = Math.floor(($gameMap.boat()._x / 256) * targetW);
            const by = Math.floor(($gameMap.boat()._y / 256) * targetH);
            drawDot(context, bx, by, boatColor, dotSize);
        }
        if ($gameMap.ship()._mapId === worldMapId) {
            const sx = Math.floor(($gameMap.ship()._x / 256) * targetW);
            const sy = Math.floor(($gameMap.ship()._y / 256) * targetH);
            drawDot(context, sx, sy, shipColor, dotSize);
        }
        if ($gameMap.airship()._mapId === worldMapId) {
            const ax = Math.floor(($gameMap.airship()._x / 256) * targetW);
            const ay = Math.floor(($gameMap.airship()._y / 256) * targetH);
            drawDot(context, ax, ay, airshipColor, dotSize);
        }

        // 3. Player Global Position
        let px, py;
        if (mapId === 315 && $dataMap) {
            // On actual map: use player XY
            const mw = $dataMap.width;
            const mh = $dataMap.height;
            px = Math.floor(($gamePlayer.x / mw) * targetW) + targetW / (mw * 2);
            py = Math.floor(($gamePlayer.y / mh) * targetH) + targetH / (mh * 2);
        } else {
            // Not on map 315: use variables 43 and 44 (0-255 range)
            const varX = $gameVariables.value(43) || 0;
            const varY = $gameVariables.value(44) || 0;
            px = Math.floor((varX / 255) * targetW) + targetW / 510;
            py = Math.floor((varY / 255) * targetH) + targetH / 510;
        }
        drawDot(context, px, py, playerColor, showLabels ? 8 : 4);

        context.restore();
        bitmap.baseTexture.update();
    }

    // ------------------------------------------------------------------------
    // City Labels on Map (In-Game)
    // ------------------------------------------------------------------------

    // City Label Sprite Class
    //
    // PERFORMANCE: these are passive sprites. They carry no per-frame update()
    // of their own. The whole container is driven once per frame by
    // refreshCityLabelSprites(), which computes the shared viewport math a
    // single time instead of every sprite recomputing displayX/tileWidth and
    // doing its own divisions. The bitmap is still built lazily on first reveal.
    class Sprite_CityLabel extends Sprite {
        initialize(tileX, tileY, text) {
            super.initialize();
            this._tileX = tileX;
            this._tileY = tileY;
            this._text = text;
            this._bitmapCreated = false;
            this.z = 7; // Above characters
            this.visible = false; // hidden until positioned by the shared pass
        }

        createBitmap() {
            if (this._bitmapCreated) return;
            this.bitmap = new Bitmap(200, 40);
            this.bitmap.fontSize = labelFontSize;
            this.bitmap.fontFace = 'GameFont, sans-serif';
            this.bitmap.fontBold = true;
            this.bitmap.outlineWidth = 4;
            this.bitmap.outlineColor = 'black';
            this.bitmap.textColor = 'white';
            this.bitmap.drawText(this._text, 0, 0, 200, 40, 'center');
            this.anchor.x = 0.5;
            this.anchor.y = 1;
            this._bitmapCreated = true;
        }
    }

    // Single shared per-frame pass over every city label. Viewport math is done
    // once here, then reused as a cheap bounds test per sprite. Replaces the old
    // pattern of N sprites each calling $gameMap.displayX()/tileWidth() and
    // dividing every frame.
    function refreshCityLabelSprites() {
        if (!cityLabelsContainer || cityLabelsContainer.length === 0) return;
        if (!$gameMap) return;

        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        const halfW = Graphics.width / tw / 2;
        const halfH = Graphics.height / th / 2;
        const centerX = $gameMap.displayX() + halfW;
        const centerY = $gameMap.displayY() + halfH;
        const bufferTiles = 5;
        const maxX = halfW + bufferTiles;
        const maxY = halfH + bufferTiles;

        for (let i = 0; i < cityLabelsContainer.length; i++) {
            const s = cityLabelsContainer[i];
            const isNear = Math.abs(s._tileX - centerX) <= maxX &&
                           Math.abs(s._tileY - centerY) <= maxY;
            if (!isNear) {
                if (s.visible) s.visible = false;
                continue;
            }
            if (!s._bitmapCreated) s.createBitmap();
            s.x = ($gameMap.adjustX(s._tileX) + 0.5) * tw;
            s.y = $gameMap.adjustY(s._tileY) * th;
            if (!s.visible) s.visible = true;
        }
    }

    function createCityLabelsContainer() {
        if (!SceneManager._scene._spriteset) return;

        // Remove old container if exists
        removeCityLabels();

        // Create labels array
        cityLabelsContainer = [];

        const events = $gameMap.events();
        for (const ev of events) {
            if (!ev || ev._erased) continue;
            const name = ev.event().name || "";

            // Match "Teleport - CityName" or "teleport CityName"
            const match = name.match(/^teleport\s*-?\s*(.+)/i);
            if (match) {
                const cityName = match[1].trim();
                if (cityName) {
                    const labelSprite = new Sprite_CityLabel(ev.x, ev.y, cityName);
                    SceneManager._scene._spriteset._tilemap.addChild(labelSprite);
                    cityLabelsContainer.push(labelSprite);
                }
            }
        }
    }

    // Kept for call-site compatibility. Previously this rebuilt the entire
    // container a second time right after createCityLabelsContainer() (a full
    // teardown + rebuild of every label sprite, twice per refresh). Now it just
    // positions the freshly built sprites once.
    function updateCityLabels() {
        refreshCityLabelSprites();
    }

    function removeCityLabels() {
        if (cityLabelsContainer) {
            for (const label of cityLabelsContainer) {
                if (label.parent) {
                    label.parent.removeChild(label);
                }
            }
            cityLabelsContainer = null;
        }
    }

    // ------------------------------------------------------------------------
    // Input & Update Loops
    // ------------------------------------------------------------------------

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        
        // A quest detail asked for the map on a specific world tile before
        // closing itself; carry it out now that the map scene is running.
        if ($gameTemp && $gameTemp._worldMapFocusRequest) {
            const req = $gameTemp._worldMapFocusRequest;
            $gameTemp._worldMapFocusRequest = null;
            focusWorldMapAt(req.x, req.y);
        }

        // Toggle Map
        if (Input.isTriggered('world_map_toggle')) {
            // A manual toggle means the player took control; don't auto-hide later.
            autoOpenedForTravel = false;
            toggleMapState();
        }

        // Interactive Controls (Only in Fullscreen Mode)
        if (currentMapState === 3 && worldMapSprite) {
            updateQuestMarkerInteraction();
            updateZoomControls();
            updatePanControls();
            // Sandbox: tap a cell on the Bologna overlay to teleport there.
            if ($gameMap.mapId() === BOLOGNA_MAP_ID && isSandboxEnabled()) {
                updateBolognaTeleportClick();
            }
        }

        // Border arrows for objectives the current pan has pushed off-screen.
        // Called outside the fullscreen branch so closing the map also clears them.
        updateQuestEdgeMarkers();

        updateVehicleTravelDisplay();

        // Drive every city label from a single shared pass (cheap bounds test
        // per sprite, viewport math computed once) instead of N per-sprite updates.
        refreshCityLabelSprites();
    };

    // Detects vehicle fast travel starting/ending and keeps the minimap animating
    // the vehicle's live position while the player rides inside the vehicle.
    function updateVehicleTravelDisplay() {
        const data = getTravelData();
        const timerActive = !!(data && data.timerActive && data.timerRemainingTime > 0);
        // Fast path: no travel timer running and nothing currently tracked. This
        // is the common case (no fast travel in progress), so skip the rest.
        if (!timerActive && !travelOrigin) return;

        const vehTravel = timerActive && !!data.finalDestination &&
            VEHICLE_TRANSPORTS.includes(data.timerTransport);

        if (vehTravel && !travelOrigin) {
            // Travel just started: snapshot the world origin (vars 43/44 still hold
            // it because vehicle travel keeps the player on the interior map).
            travelOrigin = { x: $gameVariables.value(43) || 0, y: $gameVariables.value(44) || 0 };
            if (currentMapState === 0) {
                autoOpenedForTravel = true;
                currentMapState = 2; // full world overview
            }
            refreshWorldMapDisplay();
        } else if (!vehTravel && travelOrigin) {
            // Travel ended (arrived/cancelled): drop the tracking and restore state.
            travelOrigin = null;
            if (autoOpenedForTravel) {
                autoOpenedForTravel = false;
                // Don't hide on maps that auto-show the minimap (315 / 636).
                const mapId = $gameMap.mapId();
                if (mapId !== 315 && mapId !== 636) {
                    currentMapState = 0;
                }
                refreshWorldMapDisplay();
            }
        }

        // Throttled live redraw so the dot glides toward the destination.
        if (vehTravel && travelOrigin && currentMapState > 0) {
            travelRefreshCounter++;
            if (travelRefreshCounter % 4 === 0) {
                refreshWorldMapDisplay();
            }
        }
    }

    function updateZoomControls() {
        const zoomSpeed = 0.08;
        let zoomChange = 0;

        // Keyboard Zoom
        if (Input.isPressed('map_zoom_in')) zoomChange += zoomSpeed;
        if (Input.isPressed('map_zoom_out')) zoomChange -= zoomSpeed;

        // Mouse Wheel Zoom
        if (TouchInput.wheelY !== 0) {
            // wheelY is usually +/- 100 or 120. Normalize it.
            zoomChange -= (TouchInput.wheelY / 1000);
        }

        // Right analog stick Y zooms (the controller has no zoom button otherwise)
        if (window.AnalogStickInput) {
            const ry = AnalogStickInput.rightY();
            if (ry !== 0) zoomChange -= ry * zoomSpeed; // push up = zoom in
        }

        if (zoomChange !== 0) {
            const oldScale = zoomScale;
            // Allow zoom from 0.25x to 8x for more detail viewing
            zoomScale = Math.max(0.25, Math.min(8.0, zoomScale + zoomChange));

            // Calculate zoom towards center of screen
            const ratio = zoomScale / oldScale;
            const centerX = Graphics.width / 2;
            const centerY = Graphics.height / 2;

            panX = centerX - (centerX - panX) * ratio;
            panY = centerY - (centerY - panY) * ratio;

            worldMapSprite.scale.x = zoomScale;
            worldMapSprite.scale.y = zoomScale;
            worldMapSprite.x = panX;
            worldMapSprite.y = panY;
        }
    }

    function updatePanControls() {
        if (TouchInput.isPressed()) {
            if (!isDragging) {
                isDragging = true;
                lastMouseX = TouchInput.x;
                lastMouseY = TouchInput.y;
            } else {
                const dx = TouchInput.x - lastMouseX;
                const dy = TouchInput.y - lastMouseY;
                
                panX += dx;
                panY += dy;
                
                lastMouseX = TouchInput.x;
                lastMouseY = TouchInput.y;
                
                worldMapSprite.x = panX;
                worldMapSprite.y = panY;
            }
        } else {
            isDragging = false;

            // Left analog stick pans the fullscreen map
            if (window.AnalogStickInput) {
                const ax = AnalogStickInput.leftX();
                const ay = AnalogStickInput.leftY();
                if (ax !== 0 || ay !== 0) {
                    const panSpeed = 12; // px/frame at full deflection
                    panX -= ax * panSpeed;
                    panY -= ay * panSpeed;
                    worldMapSprite.x = panX;
                    worldMapSprite.y = panY;
                }
            }
        }
    }

    // Sandbox click-to-teleport on the draggable Bologna fullscreen overlay.
    // A press that does not move (within a small threshold) is treated as a tap:
    // the clicked grid cell + in-cell position become the warp destination.
    function updateBolognaTeleportClick() {
        if (!window.BolognaMapSystem || !window.BolognaMapSystem.teleportToCell) return;

        if (TouchInput.isTriggered()) {
            bolognaPressing = true;
            bolognaPressMoved = false;
            bolognaPressX = TouchInput.x;
            bolognaPressY = TouchInput.y;
        } else if (bolognaPressing && TouchInput.isPressed()) {
            if (Math.abs(TouchInput.x - bolognaPressX) > 8 ||
                Math.abs(TouchInput.y - bolognaPressY) > 8) {
                bolognaPressMoved = true; // it's a drag-pan, not a tap
            }
        } else if (bolognaPressing && TouchInput.isReleased()) {
            bolognaPressing = false;
            if (bolognaPressMoved) return;

            // Convert screen -> assembled-bitmap pixels (undo pan + zoom).
            const bmpX = (TouchInput.x - panX) / zoomScale;
            const bmpY = (TouchInput.y - panY) / zoomScale;

            const col = BOLOGNA_COL_MIN + Math.floor(bmpX / BOLOGNA_CELL_PX);
            const row = BOLOGNA_ROW_MIN + Math.floor(bmpY / BOLOGNA_CELL_PX);
            if (row < BOLOGNA_ROW_MIN || row > BOLOGNA_ROW_MAX ||
                col < BOLOGNA_COL_MIN || col > BOLOGNA_COL_MAX) return;

            // In-cell tile position (cell drawn at BOLOGNA_CELL_PX for 256 tiles).
            const localPxX = bmpX - (col - BOLOGNA_COL_MIN) * BOLOGNA_CELL_PX;
            const localPxY = bmpY - (row - BOLOGNA_ROW_MIN) * BOLOGNA_CELL_PX;
            const tileX = (localPxX / BOLOGNA_CELL_PX) * BOLOGNA_MAP_TILES;
            const tileY = (localPxY / BOLOGNA_CELL_PX) * BOLOGNA_MAP_TILES;

            if (window.BolognaMapSystem.teleportToCell(row, col, tileX, tileY)) {
                // Close the overlay so the player drops back onto the map.
                currentMapState = 0;
                fullscreenBitmap = null;
                if (worldMapSprite) worldMapSprite.visible = false;
            }
        }
    }

    // Block player movement when fullscreen map is open
    const _Game_Player_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        // Block movement if fullscreen map is open (state 3)
        if (currentMapState === 3) {
            return false;
        }
        return _Game_Player_canMove.call(this);
    };

    // Update visuals on movement
    let lastRenderedTileX = -1;
    let lastRenderedTileY = -1;
    const _Game_Player_updateMove = Game_Player.prototype.updateMove;
    Game_Player.prototype.updateMove = function() {
        _Game_Player_updateMove.call(this);
        // Refresh if visible, but only when the player's tile actually changed.
        // updateMove fires every tween frame; the minimap is tile-based, so
        // redrawing (a full new Bitmap) mid-tween produces identical output.
        if (currentMapState > 0 && (this.x !== lastRenderedTileX || this.y !== lastRenderedTileY)) {
            lastRenderedTileX = this.x;
            lastRenderedTileY = this.y;
            refreshWorldMapDisplay();
        }
        // City labels scroll automatically with tilemap, no need to update on every move
    };

    // ------------------------------------------------------------------------
    // Scene Management Cleanup
    // ------------------------------------------------------------------------

    const _Scene_Base_terminate = Scene_Base.prototype.terminate;
    Scene_Base.prototype.terminate = function() {
        _Scene_Base_terminate.call(this);
        if (worldMapSprite) {
            if (worldMapSprite.parent) worldMapSprite.parent.removeChild(worldMapSprite);
            worldMapSprite = null;
        }
        removeQuestEdgeMarkers(); // sprites belong to the scene that is ending
        removeCityLabels();
        removeQuestTip(); // a DOM overlay must never outlive its scene
    };

    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _Scene_Map_start.call(this);

        const mapId = $gameMap.mapId();

        // Parse map note for <Coords X Y> tag and set variables 43 & 44.
        // Skip the world map (315) and the procedural map (636): on those, vars
        // 43/44 track the live world position. The proc map template carries a
        // static <Coords 79 125> tag, and applying it here would clobber the real
        // world coordinates after generation, sending the minimap to 79,125.
        if (mapId !== 315 && mapId !== 636 && $dataMap && $dataMap.note) {
            const coordsMatch = $dataMap.note.match(/<Coords\s*(\d+)\s+(\d+)>/i);
            if (coordsMatch) {
                const coordX = parseInt(coordsMatch[1]);
                const coordY = parseInt(coordsMatch[2]);
                $gameVariables.setValue(43, coordX);
                $gameVariables.setValue(44, coordY);
            }
        }

        // Auto-Open logic for specific maps
        if (mapId === 315 || mapId === 636) {
            currentMapState = 1;
        } else if (mapId === BOLOGNA_MAP_ID) {
            // Bologna cells transfer seamlessly at their edges (353 -> 353), which
            // re-runs Scene_Map.start on every crossing. Keep the minimap in
            // whatever state the player left it (currentMapState persists across
            // scenes) instead of force-closing it on each cell transfer.
        } else {
            currentMapState = 0;
        }

        if (currentMapState > 0) {
            createWorldMapSprite();
            refreshWorldMapDisplay();
        }

        // Initialize city labels on map
        const scene = this;
        const startMapId = mapId;
        setTimeout(() => {
            // Skip if the scene terminated or the map changed within the window,
            // so labels are not built against a terminating/wrong tilemap.
            if (SceneManager._scene !== scene) return;
            if (!$gameMap || $gameMap.mapId() !== startMapId) return;
            if (scene._spriteset && scene._spriteset._tilemap) {
                createCityLabelsContainer();
                updateCityLabels();
            }
        }, 100);
    };

    // Refresh city labels when events change.
    // Game_Map.refresh() can fire many times in quick succession (every switch /
    // self-switch / variable change that touches event pages). Rebuilding the
    // whole label container on each one is wasteful, so we debounce: a single
    // rebuild is scheduled and coalesces all refreshes within the window.
    let cityLabelRebuildPending = false;
    const _Game_Map_refresh = Game_Map.prototype.refresh;
    Game_Map.prototype.refresh = function() {
        _Game_Map_refresh.call(this);
        if (cityLabelRebuildPending) return;
        if (SceneManager._scene instanceof Scene_Map) {
            cityLabelRebuildPending = true;
            setTimeout(() => {
                cityLabelRebuildPending = false;
                if (SceneManager._scene._spriteset && SceneManager._scene._spriteset._tilemap) {
                    createCityLabelsContainer();
                    updateCityLabels();
                }
            }, 100);
        }
    };

    // ===== PERFORMANCE: cull per-frame updates of off-screen static events =====
    // Map 315 is a 256x256 world map with ~200 events, nearly all static
    // action-button teleports (no autonomous movement, no parallel process).
    // The engine already only renders the visible tile window, but it still
    // runs update() on every event each frame. We skip that work for events
    // well off-screen, keeping the full update for events near the camera plus
    // anything that must run regardless of position: parallel (4) / autorun (3)
    // triggers, events currently moving, and events locked in interaction.
    // Scoped to map 315 only so roaming NPCs on other maps are never frozen.
    const _Game_Event_update = Game_Event.prototype.update;
    Game_Event.prototype.update = function() {
        if ($gameMap && $gameMap.mapId() === 315 &&
            this._trigger !== 3 && this._trigger !== 4 &&
            !this._locked && !this.isMoving()) {
            const margin = 4;
            const ox = $gameMap.displayX();
            const oy = $gameMap.displayY();
            if (this._realX < ox - margin ||
                this._realX > ox + $gameMap.screenTileX() + margin ||
                this._realY < oy - margin ||
                this._realY > oy + $gameMap.screenTileY() + margin) {
                return;
            }
        }
        _Game_Event_update.call(this);
    };

})();