/*:
 * @target MZ
 * @plugindesc World Map & Procedural Map Transfer v2.0.0
 * @author Omni-Lex
 * @help
 * ============================================================================
 * WorldMapReturn.js  (merged with ProceduralMapTransfer.js)
 * ============================================================================
 *
 * Handles all world-map / procedural-map navigation:
 *   - Tracks player position on map 315 (Variables 43/44)
 *   - Border detection and auto-transfer back to world map
 *   - "Visit map" travel decision window (world map -> proc map)
 *   - Procedural map edge transitions (seamless biome-to-biome travel)
 *   - Underground layer navigation (goDown / goUp / switchLayer)
 *   - Border arrow sprites for regular and procedural maps
 *   - Biome audio (BGM/BGS) updates on map load and edge transition
 *   - Party diving sprite management for Ocean biome
 *
 * Variables used:
 *   43 - World X coordinate on map 315
 *   44 - World Y coordinate on map 315
 *   45 - Destination map ID (during transfers)
 *
 * Map Notetags:
 *   <Interior>          Reset screen tint when entering from world map.
 *   <Worldmap N S E W>  Enable border return popup on specified edges.
 *                       Letters in any order and any case; the colon form
 *                       <Worldmap: N S E W>, full words (<Worldmap west,north>)
 *                       and a bare <Worldmap> (all four edges) all work too.
 *                       An edge painted with a fence (void, cliff or wall, so
 *                       the outermost tiles cannot be stood on) is crossed by
 *                       walking into it, up to EDGE_FENCE_DEPTH tiles thick.
 *   <Coords x y>        World coords this map connects to.
 *   <Borders mapId x y> Override border teleport destination (all borders).
 *
 * @command ReturnToWorldMap
 * @text Return to World Map
 * @desc Teleport back to saved position on map 315
 *
 * @command SaveWorldMapPosition
 * @text Save World Map Position
 * @desc Save current position on map 315
 *
 * @command SetWorldMapCoordinates
 * @text Set World Map Coordinates
 * @desc Manually set world coordinates without teleporting
 * @arg x
 * @text X
 * @type number
 * @min 0
 * @default 0
 * @arg y
 * @text Y
 * @type number
 * @min 0
 * @default 0
 *
 * @command startProcGen
 * @text Start Procedural Generation
 * @desc Enter proc map 636 from current position on map 315
 *
 * @command stopProcGen
 * @text Stop Procedural Generation
 * @desc Return from proc map 636 to map 315
 *
 * @command goDown
 * @text Go Down (Underground)
 * @desc Descend to the underground layer of the current biome
 *
 * @command goUp
 * @text Go Up (Surface)
 * @desc Ascend back to surface from underground
 *
 * @command enterDungeonDoor
 * @text Enter Dungeon Door
 * @desc Descend through a DoorDungeon tile into a coordinate-seeded dungeon (type from the biome lowerLayer)
 *
 * @command startForcedBiome
 * @text Start Forced Biome
 * @desc Generate a specific biome (Dungeon, Crypt, Sewer, ...) as a fresh procedural map and teleport into it
 *
 * @arg Biome
 * @text Biome
 * @type string
 * @default Dungeon
 * @desc Name of the biome to generate (must match a Biomes.json entry).
 *
 * @arg Salt
 * @text Seed Salt
 * @type number
 * @min -2147483648
 * @default 0
 * @desc Extra seed ingredient, so two entrances of the same kind on one world square open onto different structures.
 *
 * @command switchLayer
 * @text Switch Layer
 * @desc Toggle surface/underground keeping player coordinates
 */

(() => {
    'use strict';

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    const PLUGIN_NAME = 'WorldMapReturn';
    const PLUGIN_PMT  = 'WorldMapReturn';

    const worldMapId = 315;
    const procMapId  = 636;

    // Item 141 is the "Diving suit"; 142 is the UV sunglasses filed beside it,
    // which the Ocean descent used to ask for, so the suit never opened the way
    // down. Kept in step with MovementInteractionSystem.js.
    const DIVING_SUIT_ITEM_ID = 141;

    const VAR_WORLD_X  = 43;
    const VAR_WORLD_Y  = 44;
    const VAR_DEST_MAP = 45;

    // The <Coords x y> pair the editor's map template was saved with. 1269 of the
    // 1319 maps that carry the tag at all still hold this exact pair, which is a
    // copy of the Omega Tower's square rather than a statement about where the map
    // is: honouring it would file every junk shop, cellar and bedroom in the game
    // as standing on the Omega Tower, park every vehicle left in one there, and
    // send every "return to the world map" to the same square (the long-standing
    // "everything comes out at the Omega Tower" bug). It is therefore read as
    // "nobody set this" and the party's own last world square is used instead.
    // A map that really does belong to that square is reached from it, so its
    // last-known coordinate already says so.
    const TEMPLATE_COORDS = { x: 79, y: 125 };

    const BORDER_DETECTION_RANGE = 3;
    const PROC_MAP_WIDTH  = 64;
    const PROC_MAP_HEIGHT = 64;

    // ============================================================================
    // MYSTERY ENCOUNTERS ("???" world-map tiles)
    // ----------------------------------------------------------------------------
    // Each time the player enters the world map (315) we scatter "???" markers on
    // random passable tiles at a constant density. Stopping at one of those tiles
    // ("Visit ..." in the travel menu) spawns ONE encounter event (authored in the
    // procedural map, 636) next to the player. Tune density via
    // MYSTERY_TILE_DENSITY (markers per tile) and MYSTERY_MAX_TILES (hard cap).
    //
    // The encounter pool is every event tagged <RandomEncounter> plus the named
    // event below, which is the only one dealt for now: Eris is met on a "???"
    // square and nowhere else, so she is parked off the map on every other
    // procedural square instead of standing where she was authored.
    // ============================================================================
    const MYSTERY_TILE_DENSITY = 0.0006; // ~39 markers on a 256x256 world map
    const MYSTERY_MAX_TILES    = 50;     // upper bound on simultaneous markers
    const MYSTERY_FONT_SIZE    = 18;
    const MYSTERY_FEATURED_EVENT = 'Eris';  // i18n-ignore  event name in Map636
    let   mysteryTiles          = null;  // Set<"x,y"> for the current map-315 visit
    let   mysterySprites        = [];    // Sprite_MysteryMarker[] currently rendered
    let   mysteryMarkersCreated = false;

    // ============================================================================
    // PROC GEN IMPORTS
    // ============================================================================

    const Utils2 = window.ProcGenUtils;
    if (!Utils2) {
        console.error('WorldMapReturn: requires ProcGenUtils plugin');
        return;
    }

    const {
        Cache,
        getBiomeByName,
        getAdjacentBiomesOnWorldMap,
        getAdjacentBiomesFromCache,
        checkAdjacentMapBiomesFromCache,
        checkDiagonalMapBiomesFromCache,
        normalizeBiomeForEdge,
        getNonProceduralDestination,
        createSeededRandom,
        getWorldSeed,
        procMapSeed,
        getArrowForDirection,
        buildBiomeCoordinateCache,
        logWarn,
        WORLD_MAP_ID,
        PROC_MAP_ID,
    } = Utils2;

    const generateProceduralTerrain = window.generateProceduralTerrain;
    const shouldDisplayAsBeach      = window.shouldDisplayAsBeach;
    const shouldDisplayAsIsland     = window.shouldDisplayAsIsland;
    const placeChestEvents          = window.placeChestEvents;
    const placeSpikeTrapEvents      = window.placeSpikeTrapEvents;
    const placeDungeonDoorEvents    = window.placeDungeonDoorEvents;
    const placeKeyChestEvents       = window.placeKeyChestEvents;
    const placePolicemanEvents      = window.placePolicemanEvents;

    if (!generateProceduralTerrain) {
        console.error('WorldMapReturn: requires ProceduralMapBiomeGenerator plugin');
        return;
    }

    const { isRoadBiome, determineRoadIntersectionType } = window.ProcGenRoads || {};

    // ============================================================================
    // SPRITE_BORDERARROW
    // ============================================================================

    class Sprite_BorderArrow extends Sprite {
        constructor(mapX, mapY, arrowChar, color = '#ffff66') {
            super();
            this._mapX      = mapX;
            this._mapY      = mapY;
            this._color     = color;
            this._rotAngle  = this._angleFromChar(arrowChar);
            this.createBitmap();
            this.anchor.set(0.5, 0.5);
            this.updatePosition();
        }

        _angleFromChar(ch) {
            const map = {
                '↑': 0,
                '↗': Math.PI / 4,
                '→': Math.PI / 2,
                '↘': 3 * Math.PI / 4,
                '↓': Math.PI,
                '↙': -3 * Math.PI / 4,
                '←': -Math.PI / 2,
                '↖': -Math.PI / 4,
            };
            return map[ch] !== undefined ? map[ch] : 0;
        }

        createBitmap() {
            const aw = 32, ah = 22;
            const bitmap = new Bitmap(aw, ah);
            const ctx = bitmap.context;
            ctx.fillStyle   = this._color;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth   = 2.5;
            ctx.beginPath();
            ctx.moveTo(aw / 2, 1);
            ctx.lineTo(1, ah - 1);
            ctx.lineTo(aw - 1, ah - 1);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            bitmap._baseTexture.update();
            this.bitmap = bitmap;
        }

        updatePosition() {
            const tileSize = $gameMap.tileWidth();
            const screenX  = $gameMap.adjustX(this._mapX) * tileSize + tileSize / 2;
            const screenY  = $gameMap.adjustY(this._mapY) * tileSize + tileSize / 2;
            const bounce   = Math.sin(Graphics.frameCount * 0.12) * 7;
            const bx       = Math.sin(this._rotAngle) * bounce;
            const by       = -Math.cos(this._rotAngle) * bounce;
            this.x         = Math.round(screenX + bx);
            this.y         = Math.round(screenY + by);
            this.rotation  = this._rotAngle;
        }

        update() {
            super.update();
            this.updatePosition();
        }
    }

    window.Sprite_BorderArrow = Sprite_BorderArrow;

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    let _lastDivingSig = null;
    function updatePartyDivingSprites() {
        const procGenData = $gameSystem._procGenData;
        let shouldDive    = false;
        if (procGenData) {
            const isUnderground = procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0;
            const isOcean       = procGenData.currentBiome === 'Ocean' || procGenData.biomeLayerStack.includes('Ocean');  // i18n-ignore  biome ids
            shouldDive          = isUnderground && isOcean;
        }
        if (!shouldDive && $gamePlayer._isDiving) shouldDive = true;

        // Only re-evaluate the party sprites when something that affects them
        // changed: dive state, the player's tile, or whether the player is moving
        // (the diving sprite swaps between Moving/Still images on that boundary).
        const sig = (shouldDive ? 1 : 0) + '|' + $gamePlayer.x + ',' + $gamePlayer.y +
                    '|' + ($gamePlayer.isMoving() ? 1 : 0);
        if (sig === _lastDivingSig) return;
        _lastDivingSig = sig;

        updateCharacterSprite($gamePlayer, shouldDive);
        const followers = $gamePlayer.followers()._data || [];
        followers.forEach(follower => { if (follower) updateCharacterSprite(follower, shouldDive); });
    }

    function updateCharacterSprite(character, shouldDive) {
        const actor = character.actor ? character.actor() : $gameParty.leader();
        if (!actor) return;
        if (shouldDive) {
            const isMoving     = character.isMoving();
            const currentImage = character.characterName();
            if (character._originalStepAnime === undefined) {
                character._originalStepAnime = character.hasStepAnime();
            }
            if (isMoving && currentImage !== 'Skab/!$DivingSuiteMoving') {
                character.setImage('Skab/!$DivingSuiteMoving', 0);
                character.setStepAnime(false);
            } else if (!isMoving && currentImage !== 'Skab/!$DivingSuiteStill') {
                character.setImage('Skab/!$DivingSuiteStill', 0);
                character.setStepAnime(true);
            }
        } else {
            const defaultName  = actor.characterName();
            const defaultIndex = actor.characterIndex();
            if (character.characterName() !== defaultName || character.characterIndex() !== defaultIndex) {
                character.setImage(defaultName, defaultIndex);
            }
            if (character._originalStepAnime !== undefined) {
                character.setStepAnime(character._originalStepAnime);
                character._originalStepAnime = undefined;
            }
        }
    }

    // ============================================================================
    // BIOME MUSIC SELECTION
    // ----------------------------------------------------------------------------
    // Every biome carries a wide pool of candidate tracks (`bgm` for day,
    // `bgmNight` for night) but only ONE of them is ever heard while the party
    // stays put: the track is picked deterministically from the world seed, the
    // biome name, the day/night half and above all the NATION the player is
    // currently standing in (Variable 86, set by WeatherSystem.setCurrentCountry).
    //
    // So a forest keeps one identity for as long as the party walks around one
    // country, and the whole musical palette rotates the moment they cross a
    // border: the same forest biome sounds different on the French side. No
    // per-visit shuffling, no restart when stepping between two maps of the same
    // biome, and no state to persist -- the same inputs always give the same pick.
    //
    // Alien biomes deliberately draw their pools from different categories
    // (Atmospheric by day, Dark by night; see js/db/WorldGen/AlienBiomes.json)
    // while using this very same picking rule.
    // ============================================================================

    const VAR_NATION_ID = 86;

    function currentNationId() {
        return ($gameVariables ? $gameVariables.value(VAR_NATION_ID) : 0) | 0;
    }

    // FNV-1a over the biome name plus the day/night half, then avalanche in the
    // nation id and the world seed. Nation and seed are mixed multiplicatively so
    // two neighbouring nation ids give unrelated picks rather than adjacent ones.
    function biomeMusicSeed(biomeName, isNight) {
        const key = String(biomeName || '').toLowerCase() + (isNight ? '|night' : '|day');
        let h = 0x811c9dc5;
        for (let i = 0; i < key.length; i++) {
            h ^= key.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        h = Math.imul(h ^ ((currentNationId() + 1) * 0x9e3779b1), 0x85ebca77) >>> 0;
        h = Math.imul(h ^ (getWorldSeed ? getWorldSeed() : 19002001), 0x27d4eb2f) >>> 0;
        h ^= h >>> 15;
        return h >>> 0;
    }

    function pickBiomeTrack(biomeName, tracks, isNight) {
        if (!tracks || tracks.length === 0) return null;
        if (tracks.length === 1) return tracks[0];
        const rng = createSeededRandom
            ? createSeededRandom(biomeMusicSeed(biomeName, isNight))
            : () => Math.random();
        return tracks[Math.min(tracks.length - 1, Math.floor(rng() * tracks.length))];
    }

    // An empty world (WorldManager.populationMode) is not supposed to sound
    // like the world it was, so every biome carries a second, much narrower
    // pool of dark and atmospheric tracks in `emptyWorldBGM`
    // (tools/worldgen/gen_empty_world_bgm.js). It is ONE pool, deliberately:
    // nothing about an empty world changes when the sun comes up, so day and
    // night are the same. A zombie apocalypse is just as depopulated, so it
    // shares the same override rather than getting a pool of its own.
    function isEmptyWorld() {
        const WM = window.WorldManager;
        if (!WM) return false;
        if (typeof WM.isEmptyWorld === 'function' && WM.isEmptyWorld()) return true;
        return !!(typeof WM.isZombieWorld === 'function' && WM.isZombieWorld());
    }

    function emptyWorldPool(biome) {
        return ((biome && biome.emptyWorldBGM) || []).filter(n => n && n.trim());
    }

    // The night pool is optional: a biome with no `bgmNight` keeps its day pool
    // after dark rather than falling silent.
    function biomeTrackPool(biome, isNight) {
        const clean = arr => (arr || []).filter(n => n && n.trim());
        const empty = emptyWorldPool(biome);
        // In an empty world the biome's own two pools are not consulted at all.
        // A biome the generator has not reached yet still falls through to
        // them, so a missing key is quieter data rather than silence.
        if (isEmptyWorld() && empty.length) return empty;
        const day   = clean(biome.bgm);
        const night = clean(biome.bgmNight);
        return (isNight && night.length > 0) ? night : day;
    }

    function isNightTimeNow() {
        const dateStr   = ($gameVariables && $gameVariables.value(113)) || '01 JAN 2001 12:00';
        const parts     = String(dateStr).split(' ').filter(Boolean);
        const timeParts = parts[3] ? parts[3].split(':') : ['12', '00'];
        const hour      = parseInt(timeParts[0]) || 12;
        return hour >= 20 || hour < 6;
    }

    // Both inputs to the pick can change without a map load: the nation id when
    // the party crosses a border (or fast-travels, or gets released from prison)
    // and the day/night half at 20:00 / 06:00. Watch them and refresh the biome
    // audio when either flips, so the region's theme really does change with the
    // country. Throttled -- nothing here needs frame accuracy.
    let _lastMusicSig = null;
    function watchNationMusicChange() {
        if (Graphics.frameCount % 30 !== 0) return;
        if (!$gameMap || $gameMap.mapId() === WORLD_MAP_ID) return;
        // An empty world's music does not answer to the clock (one pool for
        // both halves of the day), so only a border crossing is worth a
        // re-pick there; watching the daylight would restart the ambience at
        // 20:00 and 06:00 for a track that is not going to change.
        const half = isEmptyWorld() ? 0 : (isNightTimeNow() ? 1 : 0);
        const sig = currentNationId() + '|' + half;
        if (_lastMusicSig === null) { _lastMusicSig = sig; return; }
        if (sig === _lastMusicSig) return;
        _lastMusicSig = sig;
        console.log(`[updateBiomeAudio] Nation/daylight changed (${sig}), re-picking biome audio`);
        updateBiomeAudio();
    }

    function updateBiomeAudio() {
        const procGenData  = $gameSystem._procGenData;
        // _procGenData keeps the surrounding town's biome alive while the player
        // is inside a house or any other hand-made map, so it may only speak for
        // the audio while the procedural map is the current (or incoming) one.
        // Anywhere else the map's own <Biome:> note decides.
        const isProcGenMap = !!(procGenData && procGenData.currentBiome) &&
            ($gameMap.mapId() === PROC_MAP_ID || $gamePlayer.isTransferring());
        let biomeName      = null;

        if (isProcGenMap) {
            biomeName = procGenData.currentBiome;
            if (procGenData.displayAsIsland)      biomeName = 'Island';
            else if (procGenData.displayAsBeach)  biomeName = 'Beach';
        } else {
            if ($dataMap && $dataMap.note) {
                const biomeMatch = $dataMap.note.match(/<Biome:\s*(.+?)>/i);
                if (biomeMatch) biomeName = biomeMatch[1].trim();
            }
            if (!biomeName && $dataMap && $dataMap.meta && $dataMap.meta.Biome) {
                biomeName = $dataMap.meta.Biome;
            }
        }

        // No biome, or one that is not in the database: kill the ambience but
        // leave the BGM alone. Silence is never an improvement over whatever was
        // already playing, so an absent track list always means "carry on".
        if (!biomeName) { AudioManager.stopBgs(); return; }

        let biome = getBiomeByName(biomeName);
        // 'Island' is a display substitution, not a database biome, so fall back
        // to the tile's real biome rather than dropping into silence.
        if (!biome && isProcGenMap && procGenData.currentBiome !== biomeName) {
            biomeName = procGenData.currentBiome;
            biome     = getBiomeByName(biomeName);
        }
        if (!biome) { AudioManager.stopBgs(); return; }

        const isNightTime = isNightTimeNow();
        // Must be built exactly as watchNationMusicChange builds it, or the
        // two disagree and the watcher re-picks on every throttled tick.
        _lastMusicSig     = currentNationId() + '|' +
                            (isEmptyWorld() ? 0 : (isNightTime ? 1 : 0));

        // A hand-made map normally keeps whatever music it was authored with.
        // An empty world overrules that: having got this far the map HAS a
        // biome (no biome returns above), and the biome's empty-world pool is
        // what an emptied world sounds like, whoever authored the map. The
        // map's own track survives as the fallback for a map that declares no
        // biome at all, which never reaches this line.
        const emptyOverride = isEmptyWorld() && emptyWorldPool(biome).length > 0;

        if (!isProcGenMap && $dataMap && $dataMap.autoplayBgm && !emptyOverride) {
            // Keep map's own BGM; only handle BGS below
        } else {
            // The empty-world pool is one list for both halves of the day, so
            // the pick is seeded as day whatever the clock says: otherwise the
            // track would change at 20:00 for no reason the player can see.
            const seedNight = emptyOverride ? false : isNightTime;
            const tracks = biomeTrackPool(biome, isNightTime);
            const target = pickBiomeTrack(biomeName, tracks, seedNight);
            const playing = AudioManager._currentBgm && AudioManager._currentBgm.name;
            if (!target) {
                // A biome with no track list (house interiors, generic homes, ...)
                // deliberately inherits the BGM of the map it was entered from
                // instead of cutting to silence.
                console.log(`[updateBiomeAudio] No BGM list for biome: ${biomeName}, keeping current BGM`);
            } else if (playing === target) {
                // The pick is stable for this (biome, nation, half of day), so
                // walking between two maps of the same biome never restarts it.
                console.log(`[updateBiomeAudio] Keeping BGM: ${playing} for biome: ${biomeName}`);
            } else {
                AudioManager.playBgm({ name: target, volume: 90, pitch: 100, pan: 0 });
                console.log(`[updateBiomeAudio] Playing BGM: ${target} for biome: ${biomeName} ` +
                            `(nation ${currentNationId()}, ${tracks.length} candidates)`);  // i18n-ignore  console diagnostic
            }
        }

        // Ambience is biome-driven on every map that declares a biome, not just
        // procedural ones, so tagged interiors get their room tone too. Maps
        // carrying their own autoplay BGS keep it.
        if (!isProcGenMap && $dataMap && $dataMap.autoplayBgs) return;
        playBiomeBgs(biome, biomeName, isNightTime, procGenData, isProcGenMap);
    }

    // Pick and start the biome's ambience. An empty (or all-blank) list means
    // "this biome has no ambience", which stops whatever BGS was playing.
    function playBiomeBgs(biome, biomeName, isNightTime, procGenData, isProcGenMap) {
        const clean     = arr => (arr || []).filter(n => n && n.trim());
        const nightList = clean(biome.bgsNight);
        const dayList   = clean(biome.bgs);
        const bgsList   = (isNightTime && nightList.length > 0) ? nightList : dayList;

        if (bgsList.length === 0) { AudioManager.stopBgs(); return; }

        // Seed the pick so a given place always sounds the same: world origin on
        // procedural maps, map id everywhere else.
        const seed = isProcGenMap && procGenData
            ? (procGenData.seed || 0) + (procGenData.originX || 0) * 7 + (procGenData.originY || 0) * 13
            : $gameMap.mapId() * 31;
        const rng     = createSeededRandom ? createSeededRandom(seed + 1) : () => Math.random();
        const bgsName = bgsList[Math.floor(rng() * bgsList.length)];
        // Outdoors this bed is weather, so it goes out through WeatherAudio and
        // picks up the Weather Volume slider; indoors it is room tone and plays
        // at its authored level on the plain BGS volume.
        const bgs = { name: bgsName, volume: 80, pitch: 100, pan: 0 };
        if (window.WeatherAudio && window.WeatherAudio.playAmbience) {
            window.WeatherAudio.playAmbience(bgs);
        } else {
            AudioManager.playBgs(bgs);
        }
        console.log(`[updateBiomeAudio] Playing BGS: ${bgsName} for biome: ${biomeName}`);
    }

    // The world map is an overview, not a place: no room tone of its own, and
    // nothing the party was standing in down on a real map should follow them up
    // to it. Kill the vanilla BGS plus every MUSH channel EXCEPT the weather one
    // (channel 4, WeatherSystem's rain/night ambience), which is tied to the sky
    // rather than to the map and must keep playing across the transfer.
    const WEATHER_BGS_CHANNEL = 4;

    function stopAllBgsExceptWeather() {
        AudioManager.stopBgs();
        const buffers = AudioManager._bgsBuffers;
        if (!buffers || !AudioManager.stopMushBgs) return;
        // Collect first: stopMushBgs splices the buffer list as it goes.
        const channels = buffers
            .map(b => b && b.channel)
            .filter(ch => ch !== undefined && ch !== null && ch != WEATHER_BGS_CHANNEL);
        for (const ch of channels) AudioManager.stopMushBgs(ch);
    }

    function updateEventVisibility() {
        const procGenData = $gameSystem._procGenData;
        if (!procGenData) return;
        // A wall-clock fade timer can fire mid-transfer, before $dataMap for the
        // destination map is populated; bail rather than deref null events.
        if (!$dataMap || !$dataMap.events) return;
        const isUnderground = procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0;
        const currentBiome  = procGenData.currentBiome || '';
        const isWaterBiome  = currentBiome === 'Ocean' || currentBiome === 'Seabed';  // i18n-ignore  biome ids
        const chestNames    = ['RandomItemChest', 'RandomArmorChest', 'RandomWeaponChest'];

        for (const event of $gameMap._events) {
            if (!event || !$dataMap.events[event._eventId]) continue;
            const eventName = $dataMap.events[event._eventId].name;
            if (eventName === 'GoDown') {
                const shouldHide = isUnderground || isWaterBiome;
                event.setOpacity(shouldHide ? 0 : 255);
                if (isWaterBiome && (event.x !== 0 || event.y !== 0)) event.setPosition(0, 0);
            } else if (eventName === 'GoUp') {
                const shouldShow = isUnderground && !isWaterBiome;
                event.setOpacity(shouldShow ? 255 : 0);
                if (isWaterBiome && (event.x !== 0 || event.y !== 0)) event.setPosition(0, 0);
            } else if (chestNames.includes(eventName)) {
                const shouldShow = isUnderground && currentBiome !== 'Seabed';  // i18n-ignore  biome id
                event.setOpacity(shouldShow ? 255 : 0);
                if (currentBiome === 'Seabed' && (event.x !== 0 || event.y !== 0)) event.setPosition(0, 0);  // i18n-ignore  biome id
            }
        }

        updateRandomEncounterVisibility();
    }

    function refreshEnemiesForBiome() {
        if ($gameMap.mapId() !== PROC_MAP_ID) return;
        const procGenData = $gameSystem._procGenData;
        if (!procGenData || !procGenData.currentBiome) return;
        console.log(`[refreshEnemiesForBiome] Refreshing enemies for biome: ${procGenData.currentBiome}`);
        const enemyEvents = $gameMap.events().filter(ev => {
            const eventData = ev.event();
            return eventData && eventData.name === 'Enemy';  // i18n-ignore  event name
        });
        for (const ev of enemyEvents) {
            ev._fixedTroopId    = 0;
            ev._isAquaticEnemy  = undefined;
            ev.setOpacity(0);
            ev.setThrough(true);
        }
        if (SceneManager._scene && SceneManager._scene.spawnEnemiesFromEncounters) {
            SceneManager._scene.spawnEnemiesFromEncounters();
        }
    }

    function getWorldMapCoordinates() {
        if (window.WorkSystem && window.WorkSystem.Destinations) {
            return window.WorkSystem.Destinations;
        }
        return {};
    }

    // Biomes that are open water from edge to edge: the party crosses them
    // swimming, diving or aboard a vehicle, never on foot. Any land they contain
    // comes from a prefab (an island, a wreck, a rig) and is incidental.
    function isOpenWaterBiome(biomeName) {
        return /^(ocean|seabed)$/i.test(String(biomeName || ''));
    }

    // A beach square is a shoreline: sand on one side, sea on the other. There is
    // always dry land to arrive on, so the party is never dropped into the surf
    // there - they would start swimming the instant they set foot on the square.
    // Everywhere else water is a legitimate landing tile and the swim-on-arrival
    // rearm in MovementInteractionSystem takes over.
    function isBeachSquare() {
        const procGenData = $gameSystem._procGenData;
        if (!procGenData) return false;
        return /^beach$/i.test(String(procGenData.currentBiome || '')) ||
               !!procGenData.displayAsBeach;
    }

    // Water on the procedural map: region 99, or terrain tag 3 (how the biome
    // generator paints every water tile on map 636).
    function isWaterTileAt(x, y) {
        return $gameMap.regionId(x, y) === 99 || $gameMap.terrainTag(x, y) === 3;
    }

    // Can the player stand on (x, y)? Valid tile, not a wall (terrain tag 4),
    // and passable from at least one direction (so we never strand the player
    // on water/obstacle tiles when entering a procedurally generated map).
    //
    // In an open-water biome the rule inverts: water IS the surface the party
    // occupies. Game_Map.isPassable answers for a walking character (no
    // swim/vehicle state on the checking character), so every ocean tile reads
    // as blocked - which used to drag the party off the border they sailed in
    // from and onto whatever prefab island the destination map happened to hold.
    function isStandableTile(x, y) {
        if (!$gameMap.isValid(x, y)) return false;
        if ($gameMap.terrainTag(x, y) === 4) return false;
        if (isBeachSquare() && isWaterTileAt(x, y)) return false;
        const procGenData = $gameSystem._procGenData;
        if (procGenData && isOpenWaterBiome(procGenData.currentBiome) &&
            isWaterTileAt(x, y) && $gameMap.regionId(x, y) !== 10) return true;
        if (!$gameMap.isPassable(x, y, 2) && !$gameMap.isPassable(x, y, 4) &&
            !$gameMap.isPassable(x, y, 6) && !$gameMap.isPassable(x, y, 8)) return false;
        return true;
    }

    // Which map border (if any) the tile sits on, as an axis + fixed coordinate.
    // Edge crossings land one tile inside the map (getEdgeCoordinateForDirection
    // clamps to 1 .. size-2), so the outermost two rings both count as "border".
    function borderLineOf(x, y) {
        if (x <= 1 || x >= PROC_MAP_WIDTH  - 2) return { axis: 'x', fixed: x };
        if (y <= 1 || y >= PROC_MAP_HEIGHT - 2) return { axis: 'y', fixed: y };
        return null;
    }

    // After any transfer onto the procedural map (edge transition, goUp/goDown,
    // switchLayer, world->proc), the player can be dropped on a hardcoded tile
    // that the freshly generated terrain made non-passable. If so, relocate to
    // the nearest standable tile. No-op when already valid.
    //
    // A party that walked in over a map edge lands ON the border, and must stay
    // there: the search slides along the border line first and only spirals into
    // the map's interior when that whole edge is unusable.
    function ensurePlayerOnStandableTile() {
        if ($gameMap.mapId() !== PROC_MAP_ID) return;
        const x = $gamePlayer.x, y = $gamePlayer.y;
        if (isStandableTile(x, y)) return;

        const relocate = (nx, ny, how) => {
            console.log(`[WorldMapReturn] Landing tile (${x},${y}) not passable, relocating to (${nx},${ny}) (${how})`);
            $gamePlayer.locate(nx, ny);
        };

        // Pass 1: stay on the border the party entered through.
        const border = borderLineOf(x, y);
        if (border) {
            const along     = border.axis === 'x' ? y : x;
            const alongMax  = (border.axis === 'x' ? PROC_MAP_HEIGHT : PROC_MAP_WIDTH) - 1;
            for (let d = 1; d <= alongMax; d++) {
                for (const step of [along - d, along + d]) {
                    // Keep off the outermost ring so the party is not parked on a
                    // tile that reads as another edge crossing.
                    if (step < 1 || step > alongMax - 1) continue;
                    const nx = border.axis === 'x' ? border.fixed : step;
                    const ny = border.axis === 'x' ? step : border.fixed;
                    if (!isStandableTile(nx, ny)) continue;
                    relocate(nx, ny, 'along border');  // i18n-ignore  relocate reason, logged
                    return;
                }
            }
        }

        // Pass 2: nearest standable tile anywhere on the map.
        const maxRadius = Math.max(PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
        for (let r = 1; r <= maxRadius; r++) {
            let best = null, bestDist = Infinity;
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const nx = x + dx, ny = y + dy;
                    if (!isStandableTile(nx, ny)) continue;
                    const dist = dx * dx + dy * dy;
                    if (dist < bestDist) { bestDist = dist; best = { x: nx, y: ny }; }
                }
            }
            if (best) { relocate(best.x, best.y, 'nearest'); return; }
        }
    }

    // ============================================================================
    // MYSTERY ENCOUNTER LOGIC
    // ============================================================================

    // Can the player stand on world-map tile (x, y)? Same idea as isStandableTile
    // but not gated to the procedural map.
    function isWorldTileStandable(x, y) {
        if (!$gameMap.isValid(x, y)) return false;
        if ($gameMap.terrainTag(x, y) === 4) return false; // wall
        if (!$gameMap.isPassable(x, y, 2) && !$gameMap.isPassable(x, y, 4) &&
            !$gameMap.isPassable(x, y, 6) && !$gameMap.isPassable(x, y, 8)) return false;
        return true;
    }

    // Pick the "???" tiles for this world-map visit via rejection sampling, never
    // landing on an existing event (teleports etc.).
    function buildMysteryTiles() {
        mysteryTiles = new Set();
        const w = $gameMap.width(), h = $gameMap.height();
        const target = Math.min(MYSTERY_MAX_TILES,
            Math.max(1, Math.round(MYSTERY_TILE_DENSITY * w * h)));
        const occupied = new Set();
        for (const ev of $gameMap.events()) { if (ev) occupied.add(ev.x + ',' + ev.y); }
        let attempts = 0;
        const maxAttempts = target * 200;
        while (mysteryTiles.size < target && attempts < maxAttempts) {
            attempts++;
            const x = Math.floor(Math.random() * w);
            const y = Math.floor(Math.random() * h);
            const key = x + ',' + y;
            if (mysteryTiles.has(key) || occupied.has(key)) continue;
            if (!isWorldTileStandable(x, y)) continue;
            mysteryTiles.add(key);
        }
    }

    class Sprite_MysteryMarker extends Sprite {
        initialize(tileX, tileY) {
            super.initialize();
            this._tileX = tileX;
            this._tileY = tileY;
            this._bitmapCreated = false;
            this.z = 7; // above characters
            this.visible = false; // shown once positioned by the per-frame pass
        }
        createBitmap() {
            if (this._bitmapCreated) return;
            this.bitmap = new Bitmap(64, 40);
            this.bitmap.fontSize = MYSTERY_FONT_SIZE;
            this.bitmap.fontFace = 'GameFont, sans-serif';
            this.bitmap.fontBold = true;
            this.bitmap.outlineWidth = 4;
            this.bitmap.outlineColor = 'black';
            this.bitmap.textColor = '#ffe066';
            this.bitmap.drawText('???', 0, 0, 64, 40, 'center');
            this.anchor.x = 0.5;
            this.anchor.y = 1;
            this._bitmapCreated = true;
        }
    }

    function removeMysteryMarkers() {
        for (const s of mysterySprites) {
            // s may already be destroyed by a prior scene teardown (transform null).
            if (s.transform && s.parent) s.parent.removeChild(s);
            if (s.transform && s.bitmap) s.bitmap.destroy();
        }
        mysterySprites = [];
        mysteryMarkersCreated = false;
    }

    function createMysteryMarkers() {
        removeMysteryMarkers();
        if (!mysteryTiles) return;
        const scene = SceneManager._scene;
        if (!scene || !scene._spriteset || !scene._spriteset._tilemap) return;
        mysterySprites = [];
        for (const key of mysteryTiles) {
            const parts = key.split(',');
            const sprite = new Sprite_MysteryMarker(Number(parts[0]), Number(parts[1]));
            scene._spriteset._tilemap.addChild(sprite);
            mysterySprites.push(sprite);
        }
        mysteryMarkersCreated = true;
    }

    // Mirror of WorldMap.js's shared city-label pass: shared viewport math once,
    // a cheap per-sprite bounds test, lazy bitmap creation.
    function refreshMysteryMarkers() {
        if (!mysterySprites.length || !$gameMap) return;
        const tw = $gameMap.tileWidth(), th = $gameMap.tileHeight();
        const halfW = Graphics.width / tw / 2;
        const halfH = Graphics.height / th / 2;
        const centerX = $gameMap.displayX() + halfW;
        const centerY = $gameMap.displayY() + halfH;
        const maxX = halfW + 5, maxY = halfH + 5;
        for (const s of mysterySprites) {
            const isNear = Math.abs(s._tileX - centerX) <= maxX &&
                           Math.abs(s._tileY - centerY) <= maxY;
            if (!isNear) { if (s.visible) s.visible = false; continue; }
            if (!s._bitmapCreated) s.createBitmap();
            s.x = ($gameMap.adjustX(s._tileX) + 0.5) * tw;
            s.y = ($gameMap.adjustY(s._tileY) + 1) * th;
            if (!s.visible) s.visible = true;
        }
    }

    // ============================================================================
    // QUEST MARKERS (active objective name plates)
    // ----------------------------------------------------------------------------
    // Same passive-sprite pattern as the "???" markers above: one sprite per world
    // tile that an accepted quest objective can be completed on, showing the quest
    // name (and "step n/m" for multi-step contracts). Coordinates come from
    // ProceduralQuestSystem's questMarkers(), which pins coordinate sites at their
    // own tile and destination objectives at the destination's world tile.
    // ============================================================================
    const QUEST_MARKER_FONT = 15;
    let questMarkerSprites = [];
    let questMarkerKey     = null;   // signature of the marker set on screen

    // Every quest the player is actively chasing, as pinned by KanbanQuest
    // (the single feed for colour/icon identity - see its activeMarkers()),
    // falling back to ProceduralQuests directly if the board plugin is absent.
    function activeQuestMarkerList() {
        const kb = window.KanbanQuest;
        if (kb && typeof kb.activeMarkers === 'function') {
            try { return kb.activeMarkers(); } catch (e) { }
        }
        const api = window.ProceduralQuests;
        if (!api || typeof api.questMarkers !== 'function') return [];
        try { return api.questMarkers(); } catch (e) { return []; }
    }

    function iconSetBitmap() {
        return ImageManager.loadSystem('IconSet');
    }

    // Crops one 32px IconSet cell into `bmp` at (dx,dy), scaled to `size`.
    // Silently does nothing if the sheet or the icon index isn't available.
    function bltIcon(bmp, icon, dx, dy, size) {
        if (icon == null) return;
        const sheet = iconSetBitmap();
        if (!sheet.isReady()) return;
        const cols = 16, cell = 32;
        const col = icon % cols, row = Math.floor(icon / cols);
        bmp.blt(sheet, col * cell, row * cell, cell, cell, dx, dy, size, size);
    }

    // One plate per tile: several objectives can share a coordinate, each
    // keeping its own colour/icon so two contracts pinned at the same spot are
    // still told apart.
    function collectQuestMarkers() {
        const byTile = new Map();
        for (const m of activeQuestMarkerList()) {
            if (m.wx == null || m.wy == null) continue;
            const key = m.wx + ',' + m.wy;
            let entry = byTile.get(key);
            if (!entry) {
                entry = { x: m.wx, y: m.wy, lines: [], colors: [], icons: [] };
                byTile.set(key, entry);
            }
            const step = m.multi ? ` ${m.step}/${m.stepCount}` : '';
            const line = m.label + step;
            if (!entry.lines.includes(line)) {
                entry.lines.push(line);
                entry.colors.push(m.color || '#ffd76a');
                entry.icons.push(m.icon != null ? m.icon : null);
            }
        }
        return Array.from(byTile.values());
    }

    class Sprite_QuestMarker extends Sprite {
        initialize(tileX, tileY, lines, colors, icons) {
            super.initialize();
            this._tileX = tileX;
            this._tileY = tileY;
            this._lines = lines;
            this._colors = colors || [];
            this._icons = icons || [];
            this._bitmapCreated = false;
            this.z = 8; // above the "???" plates
            this.visible = false;
        }
        createBitmap() {
            if (this._bitmapCreated) return;
            const iconSize = QUEST_MARKER_FONT + 3;
            const lineH = Math.max(QUEST_MARKER_FONT + 6, iconSize + 4);
            const textIndent = iconSize + 6;
            const w = 320;
            const pointer = 12; // room for the marker pip(s) under the text
            const h = lineH * this._lines.length + pointer + 4;
            this.bitmap = new Bitmap(w, h);
            this.bitmap.fontSize = QUEST_MARKER_FONT;
            this.bitmap.fontFace = 'GameFont, sans-serif';
            this.bitmap.fontBold = true;
            this.bitmap.outlineWidth = 4;
            this.bitmap.outlineColor = 'black';
            const iconsReady = iconSetBitmap().isReady();
            if (!iconsReady) {
                // Icons weren't loaded yet: draw text-only now, rebuild once they are.
                iconSetBitmap().addLoadListener(() => { this._bitmapCreated = false; });
            }
            for (let i = 0; i < this._lines.length; i++) {
                this.bitmap.textColor = this._colors[i] || '#ffd76a';
                this.bitmap.drawText(this._lines[i], textIndent, i * lineH, w - textIndent, lineH, 'center');
                if (iconsReady) {
                    bltIcon(this.bitmap, this._icons[i], 4, i * lineH + (lineH - iconSize) / 2, iconSize);
                }
            }
            // One coloured diamond pip per quest sharing this tile, pointing down
            // at it, fanned out so they never merge into a single blob.
            const ctx = this.bitmap.context;
            const cy = h - pointer / 2 - 2;
            const r = 5;
            const step = (r + 3) * 1.6;
            const n = this._colors.length || 1;
            const startX = w / 2 - ((n - 1) * step) / 2;
            for (let i = 0; i < n; i++) {
                const px = startX + i * step;
                ctx.save();
                ctx.fillStyle = this._colors[i] || '#ffd76a';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(px, cy - r);
                ctx.lineTo(px + r, cy);
                ctx.lineTo(px, cy + r);
                ctx.lineTo(px - r, cy);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
            this.bitmap._baseTexture.update();
            this.anchor.x = 0.5;
            this.anchor.y = 1;
            this._bitmapCreated = true;
        }
    }

    function removeQuestMarkers() {
        for (const s of questMarkerSprites) {
            if (s.transform && s.parent) s.parent.removeChild(s);
            if (s.transform && s.bitmap) s.bitmap.destroy();
        }
        questMarkerSprites = [];
        questMarkerKey = null;
    }

    function createQuestMarkers(markers) {
        removeQuestMarkers();
        const scene = SceneManager._scene;
        if (!scene || !scene._spriteset || !scene._spriteset._tilemap) return;
        for (const m of markers) {
            const sprite = new Sprite_QuestMarker(m.x, m.y, m.lines, m.colors, m.icons);
            scene._spriteset._tilemap.addChild(sprite);
            questMarkerSprites.push(sprite);
        }
    }

    function refreshQuestMarkers() {
        if (!questMarkerSprites.length || !$gameMap) return;
        const tw = $gameMap.tileWidth(), th = $gameMap.tileHeight();
        const halfW = Graphics.width / tw / 2;
        const halfH = Graphics.height / th / 2;
        const centerX = $gameMap.displayX() + halfW;
        const centerY = $gameMap.displayY() + halfH;
        const maxX = halfW + 6, maxY = halfH + 6;
        for (const s of questMarkerSprites) {
            const isNear = Math.abs(s._tileX - centerX) <= maxX &&
                           Math.abs(s._tileY - centerY) <= maxY;
            if (!isNear) { if (s.visible) s.visible = false; continue; }
            if (!s._bitmapCreated) s.createBitmap();
            s.x = ($gameMap.adjustX(s._tileX) + 0.5) * tw;
            s.y = $gameMap.adjustY(s._tileY) * th;
            if (!s.visible) s.visible = true;
        }
    }

    // Rebuilds when the accepted-objective set changes (or the tilemap is
    // recreated by a scene change), so accepting or finishing a quest updates the
    // board without a reload.
    function updateQuestMarkers() {
        if (!$gameMap) return;
        if ($gameMap.mapId() !== worldMapId) {
            if (questMarkerSprites.length) removeQuestMarkers();
            return;
        }
        const markers = collectQuestMarkers();
        const key = markers.map(m => m.x + ',' + m.y + ':' + m.lines.join('|')).join(';');
        const tilemap = SceneManager._scene && SceneManager._scene._spriteset
            ? SceneManager._scene._spriteset._tilemap : null;
        const stale = questMarkerSprites.length &&
            (questMarkerSprites[0].transform === null || questMarkerSprites[0].parent !== tilemap);
        if (key !== questMarkerKey || stale) {
            createQuestMarkers(markers);
            questMarkerKey = key;
        }
        refreshQuestMarkers();
    }

    // ============================================================================
    // QUEST COMPASS (screen-edge direction arrows, every map)
    // ----------------------------------------------------------------------------
    // The plates above are pinned to a real tile and only mean anything within
    // sight of it. While an objective is off-screen on map 315, an arrow at the
    // border points toward it (the same GTA trick WorldMap.js's fullscreen "M"
    // sheet already uses) and steps aside once the plate can do the job exactly.
    // On any OTHER map - procedural or authored - there is no tile-precise
    // position for an objective pinned on a different world square, so the
    // arrow there carries direction only: the delta between this map's own
    // world square (currentWorldCoords()) and the objective's. Standing on the
    // very square it's pinned to collapses that delta to (0,0); rather than
    // invent a direction, the marker docks at a fixed "it's here somewhere"
    // post instead of pointing.
    // ============================================================================
    const COMPASS_MARGIN = 40;   // px kept clear of the real screen edge
    const COMPASS_ARROW = 24;    // arrow sprite size
    const COMPASS_ICON = 20;     // IconSet crop size on the label plate
    let compassContainer = null;
    let compassKey = null;
    const compassArrowBitmaps = new Map(); // colour -> cached triangle bitmap

    function compassArrowBitmap(color) {
        const key = color || '#ffd76a';
        const cached = compassArrowBitmaps.get(key);
        if (cached) return cached;
        const s = COMPASS_ARROW;
        const bmp = new Bitmap(s, s);
        const ctx = bmp.context;
        ctx.beginPath();
        ctx.moveTo(s / 2, 1);
        ctx.lineTo(s - 2, s - 3);
        ctx.lineTo(s / 2, s - 8);
        ctx.lineTo(2, s - 3);
        ctx.closePath();
        ctx.fillStyle = key;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        bmp.baseTexture.update();
        compassArrowBitmaps.set(key, bmp);
        return bmp;
    }

    // Quest icon + name, tinted to the quest's own colour, sized to its text.
    function compassLabelSprite(marker) {
        const text = marker.label || marker.title || '?';
        const probe = new Bitmap(8, 8);
        probe.fontFace = 'GameFont, sans-serif';
        probe.fontSize = QUEST_MARKER_FONT;
        probe.fontBold = true;
        const textW = Math.ceil(probe.measureTextWidth(text));
        if (probe.destroy) probe.destroy();
        const iconsReady = iconSetBitmap().isReady();
        const pad = 5;
        const iconW = (iconsReady && marker.icon != null) ? COMPASS_ICON + pad : 0;
        const w = Math.max(24, iconW + textW + pad * 2);
        const h = Math.max(COMPASS_ICON, QUEST_MARKER_FONT + 6);
        const bmp = new Bitmap(w, h);
        if (iconW) {
            bltIcon(bmp, marker.icon, 0, (h - COMPASS_ICON) / 2, COMPASS_ICON);
        } else if (!iconsReady) {
            iconSetBitmap().addLoadListener(() => { compassKey = null; }); // rebuild once loaded
        }
        bmp.fontFace = 'GameFont, sans-serif';
        bmp.fontSize = QUEST_MARKER_FONT;
        bmp.fontBold = true;
        bmp.outlineWidth = 4;
        bmp.outlineColor = 'black';
        bmp.textColor = marker.color || '#ffd76a';
        bmp.drawText(text, iconW, 0, textW + 4, h, 'left');
        const sprite = new Sprite(bmp);
        sprite.anchor.x = 0.5;
        return sprite;
    }

    function ensureCompassContainer() {
        const scene = SceneManager._scene;
        if (!scene || !(scene instanceof Scene_Map)) return null;
        if (compassContainer && (compassContainer.transform === null || compassContainer.parent !== scene)) {
            compassContainer = null;
            compassKey = null;
        }
        if (!compassContainer) {
            compassContainer = new Sprite();
            compassContainer._groups = [];
            // Added after every window Scene_Map.createAllWindows already built
            // (this runs from the update loop, later), so it draws above them -
            // a small HUD overlay, like the party HUD or the minimap.
            scene.addChild(compassContainer);
        }
        return compassContainer;
    }

    function removeCompassMarkers() {
        if (compassContainer) {
            for (const group of compassContainer._groups || []) {
                if (group._label && group._label.bitmap) group._label.bitmap.destroy();
            }
            if (compassContainer.transform && compassContainer.parent) {
                compassContainer.parent.removeChild(compassContainer);
            }
        }
        compassContainer = null;
        compassKey = null;
    }

    function hideCompassMarkers() {
        if (!compassContainer) return;
        for (const group of compassContainer._groups) group.visible = false;
    }

    function compassSignature(markers) {
        return markers.map(m => m.qid + ':' + m.wx + ',' + m.wy + ':' + (m.label || m.title)).join(';');
    }

    function buildCompassMarkers(markers) {
        const container = ensureCompassContainer();
        if (!container) return null;
        // The arrow bitmap is shared/cached by colour and must survive; only the
        // per-marker label bitmap (freshly drawn text+icon) is this build's own.
        for (const group of container._groups) {
            if (group._label && group._label.bitmap) group._label.bitmap.destroy();
        }
        container.removeChildren();
        container._groups = [];
        for (const m of markers) {
            const group = new Sprite();
            const arrow = new Sprite(compassArrowBitmap(m.color));
            arrow.anchor.x = 0.5;
            arrow.anchor.y = 0.5;
            const label = compassLabelSprite(m);
            group.addChild(arrow);
            group.addChild(label);
            group._arrow = arrow;
            group._label = label;
            group._marker = m;
            group.visible = false;
            container.addChild(group);
            container._groups.push(group);
        }
        return container;
    }

    // Screen position of a tile on the map currently loaded, after the camera
    // zoom MousePan.js applies on map 315 (pivoted on the screen centre there).
    function localTileScreenPos(tx, ty) {
        const tw = $gameMap.tileWidth(), th = $gameMap.tileHeight();
        const baseX = ($gameMap.adjustX(tx) + 0.5) * tw;
        const baseY = ($gameMap.adjustY(ty) + 0.5) * th;
        const zoom = $gameScreen ? $gameScreen.zoomScale() : 1;
        if (!zoom || zoom === 1) return { x: baseX, y: baseY };
        const zx = $gameScreen.zoomX(), zy = $gameScreen.zoomY();
        return { x: zx + (baseX - zx) * zoom, y: zy + (baseY - zy) * zoom };
    }

    function updateQuestCompass() {
        if (!$gameMap) return;
        // Never over a message/choice window: those run inside Scene_Map itself
        // rather than a pushed scene, so the compass would otherwise draw over them.
        if ($gameMessage && $gameMessage.isBusy()) { hideCompassMarkers(); return; }
        const markers = activeQuestMarkerList();
        if (!markers.length) { removeCompassMarkers(); return; }

        const key = compassSignature(markers);
        if (key !== compassKey) {
            if (!buildCompassMarkers(markers)) return;
            compassKey = key;
        }
        const container = ensureCompassContainer();
        if (!container) return;

        const cx = Graphics.width / 2;
        const cy = Graphics.height / 2;
        const halfW = Math.max(1, cx - COMPASS_MARGIN);
        const halfH = Math.max(1, cy - COMPASS_MARGIN);
        const onWorldMap = $gameMap.mapId() === worldMapId;
        // Off map 315 there's no tile-precise target: resolve where THIS map
        // sits in world-tile space once a frame, not once per marker.
        const here = onWorldMap ? null : currentWorldCoords();

        for (const group of container._groups) {
            const m = group._marker;
            let dx, dy, arrived = false;

            if (onWorldMap) {
                const pos = localTileScreenPos(m.wx, m.wy);
                // Inside the viewport (minus the band the arrow occupies): the
                // real plate above is doing the job, so the compass steps aside.
                if (pos.x >= COMPASS_MARGIN && pos.x <= Graphics.width - COMPASS_MARGIN &&
                    pos.y >= COMPASS_MARGIN && pos.y <= Graphics.height - COMPASS_MARGIN) {
                    group.visible = false;
                    continue;
                }
                dx = pos.x - cx;
                dy = pos.y - cy;
            } else {
                dx = m.wx - here.x;
                dy = m.wy - here.y;
                arrived = (dx === 0 && dy === 0);
            }

            const label = group._label;
            const lw = label.bitmap.width / 2;

            if (arrived) {
                group.visible = true;
                group._arrow.visible = false;
                label.x = Math.min(Graphics.width - lw - 4, Math.max(lw + 4, cx));
                label.y = COMPASS_MARGIN;
                continue;
            }
            if (!dx && !dy) { group.visible = false; continue; }

            group.visible = true;
            group._arrow.visible = true;

            const ratio = Math.min(
                Math.abs(dx) > 0.001 ? halfW / Math.abs(dx) : Infinity,
                Math.abs(dy) > 0.001 ? halfH / Math.abs(dy) : Infinity);
            const ex = cx + dx * ratio;
            const ey = cy + dy * ratio;

            group._arrow.x = ex;
            group._arrow.y = ey;
            group._arrow.rotation = Math.atan2(dy, dx) + Math.PI / 2;

            label.x = Math.min(Graphics.width - lw - 4, Math.max(lw + 4, ex));
            label.y = ey < cy
                ? ey + COMPASS_ARROW / 2 + 2
                : ey - COMPASS_ARROW / 2 - 2 - label.bitmap.height;
        }
    }

    // Per-frame driver (called from Scene_Map.update). Rebuilds tiles on each fresh
    // entry to the world map and tears everything down when leaving it.
    function updateMysteryMarkers() {
        if (!$gameMap) return;
        if ($gameMap.mapId() !== worldMapId) {
            if (mysteryTiles || mysterySprites.length) { removeMysteryMarkers(); mysteryTiles = null; }
            return;
        }
        if (!mysteryTiles) buildMysteryTiles();
        // Sprites are parented to the active spriteset's tilemap. On a scene
        // change (leaving and re-entering the world map) that tilemap is rebuilt
        // and the old sprites are destroyed, so rebuild if ours are stale.
        const tilemap = SceneManager._scene && SceneManager._scene._spriteset
            ? SceneManager._scene._spriteset._tilemap : null;
        if (!mysteryMarkersCreated || (mysterySprites.length &&
            (mysterySprites[0].transform === null || mysterySprites[0].parent !== tilemap))) {
            createMysteryMarkers();
        }
        refreshMysteryMarkers();
    }

    // Spiral out from the player to the nearest standable, unoccupied proc-map tile
    // (leaving a one-tile gap) to drop the encounter onto.
    function findEncounterTileNearPlayer() {
        const px = $gamePlayer.x, py = $gamePlayer.y;
        const maxRadius = Math.max(PROC_MAP_WIDTH, PROC_MAP_HEIGHT);
        for (let r = 2; r <= maxRadius; r++) {
            let best = null, bestDist = Infinity;
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const nx = px + dx, ny = py + dy;
                    if (!isStandableTile(nx, ny)) continue;
                    if ($gameMap.eventsXy(nx, ny).some(e => e.isNormalPriority())) continue;
                    const dist = dx * dx + dy * dy;
                    if (dist < bestDist) { bestDist = dist; best = { x: nx, y: ny }; }
                }
            }
            if (best) return best;
        }
        return null;
    }

    // Hide every encounter event on the proc map, then (only when the player
    // stopped on a "???" tile) reveal exactly one next to the player.
    function updateRandomEncounterVisibility() {
        if ($gameMap.mapId() !== procMapId) return;

        const encounters = [];
        let featured = null;
        for (const event of $gameMap._events) {
            if (!event) continue;
            const data = $dataMap.events[event._eventId];
            if (!data) continue;
            if (data.name === MYSTERY_FEATURED_EVENT) {
                featured = event;
                encounters.push(event);
            } else if (/RandomEncounter/i.test(data.note || '')) {
                encounters.push(event);
            }
        }
        if (encounters.length === 0) { $gameTemp._mysteryEncounterPending = false; return; }

        for (const ev of encounters) {
            ev.setOpacity(0);
            ev.setThrough(true);
            // A parked encounter must not wander off its corner while invisible:
            // an authored random move type would leave a ghost the player can
            // still trigger by walking into it.
            ev._moveType = 0;
            if (ev.x !== 0 || ev.y !== 0) ev.setPosition(0, 0);
        }

        if (!$gameTemp._mysteryEncounterPending) return;
        $gameTemp._mysteryEncounterPending = false;

        const chosen = featured ||
            encounters[Math.floor(Math.random() * encounters.length)];
        const spot = findEncounterTileNearPlayer();
        if (!spot) return;
        chosen.setPosition(spot.x, spot.y);
        chosen.setOpacity(255);
        chosen.setThrough(false);
        const page = chosen.page();
        chosen._moveType = page ? page.moveType : 0;
    }

    // ============================================================================
    // GAME_SYSTEM EXTENSIONS
    // ============================================================================

    Game_System.prototype.getReturnCoordinates = function(_exitDirection) {
        if (!this._procGenData) return { x: 0, y: 0 };
        return { x: this._procGenData.originX, y: this._procGenData.originY };
    };

    Game_System.prototype.getAdjacentWorldCoordinates = function(exitDirection) {
        let newX = $gameVariables.value(VAR_WORLD_X);
        let newY = $gameVariables.value(VAR_WORLD_Y);
        switch (exitDirection) {
            case 2: newY += 1; break;
            case 4: newX -= 1; break;
            case 6: newX += 1; break;
            case 8: newY -= 1; break;
        }
        return { x: newX, y: newY };
    };

    Game_System.prototype.getEdgeCoordinateForDirection = function(exitDirection, playerX, playerY) {
        let x = playerX !== undefined ? playerX : Math.floor(PROC_MAP_WIDTH  / 2);
        let y = playerY !== undefined ? playerY : Math.floor(PROC_MAP_HEIGHT / 2);
        switch (exitDirection) {
            case 2: y = 1;                  break;
            case 4: x = PROC_MAP_WIDTH - 2; break;
            case 6: x = 1;                  break;
            case 8: y = PROC_MAP_HEIGHT - 2; break;
            default:
                x = Math.floor(PROC_MAP_WIDTH  / 2);
                y = Math.floor(PROC_MAP_HEIGHT / 2);
        }
        x = Math.max(1, Math.min(x, PROC_MAP_WIDTH  - 2));
        y = Math.max(1, Math.min(y, PROC_MAP_HEIGHT - 2));
        return { x, y };
    };

    // ============================================================================
    // WHAT THE MAP NAME BANNER SAYS
    // ============================================================================
    // An ordinary square is announced by its biome. A generated STRUCTURE is
    // announced by its own name instead: nothing underground used to have one,
    // so the banner over every stairway in the world read "Loot Cellar". The
    // name is composed by ProcGenDungeon from the structure's word banks and is
    // derived, not stored - (world seed, world square, entrance tile) always
    // gives the same one - so a place read a hundred hours later is still
    // called what it was. It is cached on the dungeon session so the two places
    // that set the banner cannot disagree.
    function procMapDisplayName() {
        const pg = $gameSystem._procGenData;
        if (!pg) return '';
        const D = window.ProcGenDungeon;
        const S = (D && typeof D.structure === 'function') ? D.structure(pg.currentBiome) : null;
        if (S && window.StructureNames) {
            const sess = pg._dungeonSession;
            if (sess && sess.name) return sess.name;
            const name = window.StructureNames.nameFor(pg.currentBiome, (sess && sess.salt) || 0);
            if (sess) sess.name = name;
            return name;
        }
        let displayName = pg.currentBiome;
        if (pg.displayAsIsland)     displayName = 'Island';
        else if (pg.displayAsBeach) displayName = 'Beach';
        return window.BiomeNames.display(displayName);
    }

    Game_System.prototype.clearProcGenData = function() {
        if (!this._procGenData) return;
        this._procGenData.generatedMapData     = null;
        this._procGenData.currentBiome         = null;
        this._procGenData.currentRoadDirection = null;
        this._procGenData.lastLoadedProcMapX   = null;
        this._procGenData.lastLoadedProcMapY   = null;
        // The square a descent was started from goes with it: the party is
        // leaving the procedural map entirely, so there is nothing to surface to.
        this._procGenData._surfaceSnapshot     = null;
        Cache.clear();
        $gameVariables.setValue(110, 0);
        $gameVariables.setValue(111, 0);
    };

    // ============================================================================
    // PROCEDURAL SQUARE SNAPSHOT / RESTORE
    // ----------------------------------------------------------------------------
    // Every excursion that leaves the procedural map for a submap -- a structure
    // biome entered off a terrain feature (Grate, StairsDown, StairsUp, Cave,
    // Hatch), a house interior, a floor of a tower block -- has to put the party
    // back on the very square they walked out of: same world coordinates, same
    // biome, same tiles.
    //
    // A square is deterministic from (world seed, world coordinates, layer depth),
    // but only while the description it was built from survives the trip, and an
    // excursion that generates a map of its own (startForcedBiome) overwrites that
    // description in place. So it is snapshotted on the way out and restored on
    // the way back.
    //
    // What must never happen is re-resolving the biome from the world-map tile
    // column while standing somewhere else: Game_System.getBiomeFromWorldCoordinates
    // reads $gameMap, which off map 315 is whichever 64x64 submap the party is in,
    // and answers with a biome that has nothing to do with the square they left.
    // ============================================================================

    // opts.terrain carries the generated tile array along too. Needed whenever the
    // excursion replaces it (a forced-biome structure does); left out otherwise so
    // that a house visit does not carry a second copy of the map in the save.
    function snapshotProcSurface(opts) {
        const pg = $gameSystem && $gameSystem._procGenData;
        if (!pg || !pg.currentBiome) return null;
        const snap = {
            originX:                pg.originX,
            originY:                pg.originY,
            currentBiome:           pg.currentBiome,
            currentRoadDirection:   pg.currentRoadDirection,
            currentUnderBiome:      pg.currentUnderBiome,
            currentBridgeDirection: pg.currentBridgeDirection,
            currentBiomeTileset:    pg.currentBiomeTileset,
            seed:                   pg.seed,
            biomeLayerStack:        (pg.biomeLayerStack || []).slice(),
            displayAsBeach:         !!pg.displayAsBeach,
            displayAsIsland:        !!pg.displayAsIsland,
            biomeDayTemperature:    pg.biomeDayTemperature,
            biomeNightTemperature:  pg.biomeNightTemperature,
            goDownEventX:           pg.goDownEventX,
            goDownEventY:           pg.goDownEventY,
        };
        if (opts && opts.terrain) {
            snap.generatedMapData = pg.generatedMapData;
            // The prefab pass's "this square already has its prefabs" mark
            // belongs to that array, so it travels with it. Without it, a square
            // handed back after a save/reload would be prefabbed a second time,
            // on top of the prefabs its tiles already carry.
            snap.prefabbedSig = pg._prefabbedSig;
        }
        return snap;
    }

    // Rebuild a square's tiles from the world seed + coordinates + layer depth.
    // Adjacency is read from the coordinate cache, which answers from any map,
    // never from the live world-map tile column, which does not.
    function regenerateProcSurface(pg, biomeName, roadDirection, originX, originY) {
        const biome = getBiomeByName(biomeName);
        if (!biome || !generateProceduralTerrain) return false;

        let adjacentBiomes = null, cacheInfo = null;
        const cache = pg.biomeCoordinateCache;
        if (cache && Object.keys(cache).length > 0) {
            const adj = getAdjacentBiomesFromCache(originX, originY, cache);
            adjacentBiomes = {
                north: normalizeBiomeForEdge(adj.north),
                south: normalizeBiomeForEdge(adj.south),
                east:  normalizeBiomeForEdge(adj.east),
                west:  normalizeBiomeForEdge(adj.west),
            };
            cacheInfo = checkAdjacentMapBiomesFromCache(originX, originY, cache);
        }

        const depth = (pg.biomeLayerStack || []).length;
        const seed  = procMapSeed(originX, originY, depth);
        const data  = generateProceduralTerrain(
            biome, seed, roadDirection || null, adjacentBiomes, cacheInfo,
            { x: originX, y: originY }, cache
        );
        if (data) pg.generatedMapData = data;
        return !!data;
    }

    // Put a snapshot back onto $gameSystem._procGenData. Returns false when there
    // is nothing usable to restore, so the caller can fall back to its old path.
    function restoreProcSurface(snap) {
        const pg = $gameSystem && $gameSystem._procGenData;
        if (!pg || !snap || !snap.currentBiome) return false;

        const originX = snap.originX != null ? snap.originX : $gameVariables.value(VAR_WORLD_X);
        const originY = snap.originY != null ? snap.originY : $gameVariables.value(VAR_WORLD_Y);

        // World coordinates first: the terrain, the biome cache, the border
        // crossings and every later transfer are keyed on them, and a submap must
        // never leave the party standing on a different square of the world.
        $gameVariables.setValue(VAR_WORLD_X, originX);
        $gameVariables.setValue(VAR_WORLD_Y, originY);
        pg.originX = originX;
        pg.originY = originY;

        pg.currentBiome           = snap.currentBiome;
        pg.currentRoadDirection   = snap.currentRoadDirection || null;
        pg.currentUnderBiome      = snap.currentUnderBiome || null;
        pg.currentBridgeDirection = snap.currentBridgeDirection || null;
        pg.currentBiomeTileset    = snap.currentBiomeTileset;
        pg.biomeLayerStack        = (snap.biomeLayerStack || []).slice();
        pg.displayAsBeach         = !!snap.displayAsBeach;
        pg.displayAsIsland        = !!snap.displayAsIsland;
        if (snap.seed                  != null) pg.seed                  = snap.seed;
        if (snap.biomeDayTemperature   != null) pg.biomeDayTemperature   = snap.biomeDayTemperature;
        if (snap.biomeNightTemperature != null) pg.biomeNightTemperature = snap.biomeNightTemperature;
        if (snap.goDownEventX          != null) pg.goDownEventX          = snap.goDownEventX;
        if (snap.goDownEventY          != null) pg.goDownEventY          = snap.goDownEventY;
        // _dungeonSession is deliberately left alone: it says where the party IS,
        // not what the square looked like, and its owner clears it.

        // The tiles: the snapshot's own array when it carried one, otherwise a
        // deterministic rebuild from the square's canonical seed.
        if (snap.generatedMapData) {
            pg.generatedMapData = snap.generatedMapData;
            pg._prefabbedSig    = snap.prefabbedSig;
        } else if (!pg.generatedMapData) {
            regenerateProcSurface(pg, snap.currentBiome, pg.currentRoadDirection, originX, originY);
        }

        // Force loadMapData / performTransfer to rebuild map 636 from file and
        // re-inject this terrain: $dataMap still holds the submap, events and all.
        pg.lastLoadedProcMapX = null;
        pg.lastLoadedProcMapY = null;
        $gameVariables.setValue(110, 1);
        $gameVariables.setValue(111, 1);
        return !!pg.generatedMapData;
    }

    // Descending into a layer of the same square -- a cave through goDown or
    // switchLayer, a dungeon through a DoorDungeon tile -- overwrites the
    // surface's tile array in place, and surfacing used to rebuild it from the
    // seed alone. That rebuild was NOT the same map, twice over:
    //
    //   - the adjacency the square was first generated with is unreachable from
    //     inside the submap (goUp only ever looked for it on the world map, which
    //     is never the map being stood on when surfacing), and the road direction
    //     was dropped outright, so the tiles themselves came back different;
    //   - and no prefab was put back on them at all. Prefabs are stamped by
    //     ProceduralMapPrefabs' DataManager.loadMapData hook, which the proc-map
    //     loader only reaches when the world coordinates have changed since the
    //     last load -- and surfacing lands on the same square it descended from.
    //     So the mountain a dungeon door was cut into was simply gone, door and
    //     all, the moment the party climbed back out of it.
    //
    // The square is kept instead, exactly as it was, tiles and prefabs included,
    // and handed straight back.
    function stashSurfaceSnapshot(pg) {
        if (!pg) return;
        pg._surfaceSnapshot = snapshotProcSurface({ terrain: true });
    }

    // Put back the square a descent started from. Only a snapshot of the biome
    // AND the world square actually being surfaced to is accepted, so a stale one
    // -- a descent the party never climbed out of because they died and respawned
    // somewhere else, say -- is dropped rather than pasted over the square they
    // are really standing on.
    function popSurfaceSnapshot(pg, biomeName) {
        const snap = pg && pg._surfaceSnapshot;
        if (!snap) return false;
        pg._surfaceSnapshot = null;
        if (snap.currentBiome !== biomeName) return false;
        if (snap.originX !== pg.originX || snap.originY !== pg.originY) return false;
        return restoreProcSurface(snap);
    }

    // Fallback for a surfacing with no snapshot to put back (a save made before
    // descents kept one). Rebuild the square from its canonical seed, reading
    // adjacency from the coordinate cache when the world map is not the map being
    // stood on -- surfacing out of a submap, it never is -- and keeping the road
    // direction, which the old rebuild dropped and with it the square's road.
    // Clearing lastLoadedProcMap* is what lets the prefab pass see the rebuilt
    // array: without it the proc-map loader short-circuits on the unchanged world
    // coordinates and the square surfaces bare.
    function rebuildSurfaceFromSeed(pg, biomeName, biome) {
        const seed  = procMapSeed(pg.originX, pg.originY, (pg.biomeLayerStack || []).length);
        const cache = pg.biomeCoordinateCache;
        const hasCache = cache && Object.keys(cache).length > 0;

        let adjacentBiomes = null, diagonalBiomes = null, cacheInfo = null;
        if ($gameMap.mapId() === WORLD_MAP_ID) {
            adjacentBiomes = getAdjacentBiomesOnWorldMap(pg.originX, pg.originY);
        } else if (hasCache) {
            adjacentBiomes = getAdjacentBiomesFromCache(pg.originX, pg.originY, cache);
        }
        if (adjacentBiomes) {
            adjacentBiomes = {
                north: normalizeBiomeForEdge(adjacentBiomes.north),
                south: normalizeBiomeForEdge(adjacentBiomes.south),
                east:  normalizeBiomeForEdge(adjacentBiomes.east),
                west:  normalizeBiomeForEdge(adjacentBiomes.west),
            };
        }
        if (hasCache) {
            cacheInfo      = checkAdjacentMapBiomesFromCache(pg.originX, pg.originY, cache);
            diagonalBiomes = checkDiagonalMapBiomesFromCache(pg.originX, pg.originY, cache);
        }

        pg.displayAsBeach  = shouldDisplayAsBeach(biomeName, adjacentBiomes, diagonalBiomes);
        pg.displayAsIsland = shouldDisplayAsIsland ? shouldDisplayAsIsland(biomeName, adjacentBiomes) : false;
        pg.generatedMapData = generateProceduralTerrain(
            biome, seed, pg.currentRoadDirection || null, adjacentBiomes, cacheInfo,
            { x: pg.originX, y: pg.originY }, cache
        );
        pg.lastLoadedProcMapX = null;
        pg.lastLoadedProcMapY = null;
    }

    // ============================================================================
    // DATAMANAGER OVERRIDE
    // ============================================================================

    const _DataManager_loadMapData = DataManager.loadMapData;
    DataManager.loadMapData = function(mapId) {
        if (mapId === PROC_MAP_ID &&
            $gameSystem &&
            $gameSystem._procGenData &&
            $gameSystem._procGenData.generatedMapData) {
            const currentWorldX = $gameVariables.value(VAR_WORLD_X);
            const currentWorldY = $gameVariables.value(VAR_WORLD_Y);
            // The unchanged-coordinates short-circuit keeps the map already in
            // $dataMap. When there is none -- a save loaded on the procedural map
            // boots with $dataMap null, and the coordinates it recorded are of
            // course its own -- there is nothing to keep, and skipping the load
            // leaves the scene waiting on a map that never arrives.
            //
            // Coordinates alone are not enough to say "nothing changed": goDown,
            // enterDungeonDoor, switchLayer (descending) and startForcedBiome all
            // generate a new structure's tiles on the SAME world square, so the
            // coordinates the short-circuit compares never move even though the
            // biome under the party did. Without also checking that $dataMap
            // still holds the array the game actually wants to show, a descent
            // left the previous floor's tiles on screen while every other system
            // had already moved on to the new one.
            if (!$dataMap || !$dataMap.data ||
                $dataMap.data !== $gameSystem._procGenData.generatedMapData ||
                $gameSystem._procGenData.lastLoadedProcMapX !== currentWorldX ||
                $gameSystem._procGenData.lastLoadedProcMapY !== currentWorldY) {
                _DataManager_loadMapData.call(this, mapId);
                if ($dataMap) {
                    $dataMap.data      = $gameSystem._procGenData.generatedMapData;
                    $dataMap.width     = PROC_MAP_WIDTH;
                    $dataMap.height    = PROC_MAP_HEIGHT;
                    $dataMap.tilesetId = $gameSystem._procGenData.currentBiomeTileset;
                    // The map name window reads the biome's declared name, not
                    // its id ("ForestTropical" -> "Tropical Forest"), and a
                    // generated structure is named outright.
                    $dataMap.displayName = procMapDisplayName();
                }
                $gameSystem._procGenData.lastLoadedProcMapX = currentWorldX;
                $gameSystem._procGenData.lastLoadedProcMapY = currentWorldY;
            }
            return;
        }
        _DataManager_loadMapData.call(this, mapId);
    };

    // The edge-transition callback is a runtime closure that does not survive
    // serialization. If a save was made mid-transition, only the
    // _edgeTransitionScheduled flag persists (callback gone), and moveStraight
    // early-returns forever, permanently stranding the player at a proc-map edge.
    // Clear the stale transition state on load so movement is restored.
    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        _DataManager_extractSaveContents.call(this, contents);
        if ($gameSystem && $gameSystem._procGenData) {
            $gameSystem._procGenData._edgeTransitionScheduled   = false;
            $gameSystem._procGenData._edgeTransitionDispatching = false;
            $gameSystem._procGenData._edgeTransitionCallback    = null;
        }
    };

    // ============================================================================
    // GAME_MAP EXTENSIONS
    // ============================================================================

    const _Game_Map_setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function(mapId) {
        _Game_Map_setup.call(this, mapId);
        this.setupBorderTags();
        // Reset screen tint when entering interior from world map
        const previousMapId = $gameVariables.value(VAR_DEST_MAP);
        if (previousMapId === worldMapId || $gamePlayer._transferring) {
            const lastMapId = $gamePlayer._transferring
                ? ($gamePlayer._oldMapId || previousMapId)
                : previousMapId;
            if (lastMapId === worldMapId && mapId !== worldMapId) {
                if ($dataMap && $dataMap.note && $dataMap.note.match(/<Interior>/i)) {
                    $gameScreen.startTint([0, 0, 0, 0], 0);
                }
            }
        }
    };

    const _Game_Map_tileset = Game_Map.prototype.tileset;
    Game_Map.prototype.tileset = function() {
        if ($gameMap.mapId() === PROC_MAP_ID && $gameSystem._procGenData) {
            const biomeObj = getBiomeByName($gameSystem._procGenData.currentBiome);
            if (biomeObj && biomeObj.tilesetId) {
                const tilesetData = $dataTilesets[biomeObj.tilesetId];
                if (tilesetData) return tilesetData;
            }
        }
        return _Game_Map_tileset.call(this);
    };

    // ============================================================================
    // BORDER NOTETAG PARSING
    // ----------------------------------------------------------------------------
    // A map that declares the wrong spelling of <Worldmap> gets no chevrons and no
    // way back to the world map, and nothing says so: the tag simply fails to
    // match and the edges go inert. So every spelling an author is likely to write
    // is accepted instead, since the tag carries at most four bits of meaning:
    //
    //   <Worldmap>              <WORLDMAP>              every edge
    //   <Worldmap W N S E>      <Worldmap NSEW>         letters, in any order
    //   <Worldmap: W>           <Worldmap = w>          colon / equals form
    //   <Worldmap N, S / E>     <Worldmap west, north>  any separator, full words
    //
    // Only WHICH of the four directions appear matters; their order never does.
    // A tag whose body names no direction at all opens every edge (the tag is
    // there, so the map is meant to lead back out) and says so in the console.
    // ============================================================================

    const ALL_BORDER_DIRECTIONS = ['north', 'south', 'east', 'west'];

    const BORDER_DIRECTION_WORDS = {
        N: 'north', S: 'south', E: 'east', W: 'west',
        NORTH: 'north', SOUTH: 'south', EAST: 'east', WEST: 'west',
        UP: 'north', DOWN: 'south', LEFT: 'west', RIGHT: 'east',
        TOP: 'north', BOTTOM: 'south',
    };

    function parseWorldmapDirections(note) {
        const match = note.match(/<\s*worldmap\b\s*[:=]?\s*([^>]*?)\s*>/i);
        if (!match) return null;
        const body = (match[1] || '').trim();
        if (!body) return ALL_BORDER_DIRECTIONS.slice();

        const found = [];
        const add   = dir => { if (dir && !found.includes(dir)) found.push(dir); };
        for (const token of body.toUpperCase().split(/[^A-Z]+/)) {
            if (!token) continue;
            if (BORDER_DIRECTION_WORDS[token]) { add(BORDER_DIRECTION_WORDS[token]); continue; }
            // Not a whole word: a run of direction letters (NSEW, wn, ...).
            // Anything else is left alone rather than mined for stray letters.
            if (/^[NSEW]+$/.test(token)) {
                for (const ch of token) add(BORDER_DIRECTION_WORDS[ch]);
            }
        }
        if (found.length > 0) return found;
        console.warn(`[WorldMapReturn] <Worldmap ${body}> names no direction on map ` +
                     `${$gameMap.mapId()}; opening all four edges`);  // i18n-ignore  console diagnostic
        return ALL_BORDER_DIRECTIONS.slice();
    }

    Game_Map.prototype.setupBorderTags = function() {
        this._borderDestination  = null;
        this._coordsDest         = null;
        this._worldmapDirections = null;
        if ($gameMap.mapId() === procMapId) return;
        if (!$dataMap || !$dataMap.note) return;
        const note = $dataMap.note;
        this._worldmapDirections = parseWorldmapDirections(note);
        // The destination tags take the same colon/equals tolerance, and accept any
        // separator between their numbers.
        const bordersMatch = note.match(/<\s*borders\b\s*[:=]?\s*(\d+)\D+(\d+)\D+(\d+)\s*>/i);
        if (bordersMatch) {
            this._borderDestination = {
                mapId: parseInt(bordersMatch[1]),
                x:     parseInt(bordersMatch[2]),
                y:     parseInt(bordersMatch[3])
            };
            return;
        }
        const coordsMatch = note.match(/<\s*coords\b\s*[:=]?\s*(\d+)\D+(\d+)\s*>/i);
        if (coordsMatch) {
            this._coordsDest = {
                x: parseInt(coordsMatch[1]),
                y: parseInt(coordsMatch[2])
            };
        }
    };

    Game_Map.prototype.isBorderTile = function(x, y) {
        return x === 0 || y === 0 || x === this.width() - 1 || y === this.height() - 1;
    };

    Game_Map.prototype.isBorderTileEnabled = function(x, y) {
        if (!this.isBorderTile(x, y)) return false;
        return this._borderDestination || this._coordsDest;
    };

    Game_Map.prototype.isBorderDirectionAllowed = function(directions) {
        if (this._worldmapDirections === null) return false;
        return directions.some(dir => this._worldmapDirections.includes(dir));
    };

    Game_Map.prototype.getBorderDirection = function(x, y) {
        const directions = [];
        if (x === 0)                 directions.push('west');
        if (x === this.width()  - 1) directions.push('east');
        if (y === 0)                 directions.push('north');
        if (y === this.height() - 1) directions.push('south');
        return directions;
    };

    Game_Map.prototype.isBorderTilePassable = function(x, y) {
        return this.isPassable(x, y, 2) || this.isPassable(x, y, 4) ||
               this.isPassable(x, y, 6) || this.isPassable(x, y, 8);
    };

    // ------------------------------------------------------------------------
    // FENCED EDGES
    // ------------------------------------------------------------------------
    // Most hand-made maps do not leave their outermost ring walkable: it is a
    // void, a cliff or a wall painted along the edge (terrain tag 7 and 4 both
    // read as impassable through MovementInteractionSystem). The party can never
    // STAND on such a tile, so a rule that waits for them to step onto it never
    // fires and the map's <Worldmap> tag looks dead, chevrons and all.
    //
    // Walking INTO that fence is the same intent, so a blocked step counts as a
    // crossing when nothing but fence lies between the tile bumped into and the
    // map edge. The depth is capped so only a fence really painted along the
    // border qualifies: a building whose wall happens to run out to the edge
    // deeper inside the map must stay a wall.
    // ------------------------------------------------------------------------

    const EDGE_FENCE_DEPTH = 3;

    const BORDER_STEP     = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
    const BORDER_DIR_NAME = { 2: 'south', 4: 'west', 6: 'east', 8: 'north' };

    // Distance from (x, y) to the map edge it is heading for when moving in
    // direction d. 0 on the outermost ring.
    Game_Map.prototype.borderEdgeDistance = function(x, y, d) {
        switch (d) {
            case 2: return this.height() - 1 - y;
            case 4: return x;
            case 6: return this.width() - 1 - x;
            case 8: return y;
        }
        return Infinity;
    };

    // How many impassable tiles a border tile is buried under, counting inward
    // from the edge: 0 when the tile is walkable, n when the nearest walkable
    // tile inward is n away, -1 when the party can never get close enough to
    // push against it.
    Game_Map.prototype.borderFenceDepth = function(x, y) {
        if (this.isBorderTilePassable(x, y)) return 0;
        for (let step = 1; step <= EDGE_FENCE_DEPTH; step++) {
            const ix = x === 0 ? step : (x === this.width()  - 1 ? this.width()  - 1 - step : x);
            const iy = y === 0 ? step : (y === this.height() - 1 ? this.height() - 1 - step : y);
            if (!this.isValid(ix, iy)) break;
            if (this.isBorderTilePassable(ix, iy)) return step;
        }
        return -1;
    };

    // Does a step in direction d from (x, y) leave the map through an enabled
    // border? True when the next tile is already off the map, and when the next
    // tile starts a run of impassable tiles that reaches the edge.
    Game_Map.prototype.isBorderCrossing = function(x, y, d) {
        const step = BORDER_STEP[d];
        if (!step) return false;
        if (!this._borderDestination && !this._coordsDest) return false;
        if (!this.isBorderDirectionAllowed([BORDER_DIR_NAME[d]])) return false;

        let nx = x + step[0], ny = y + step[1];
        if (!this.isValid(nx, ny)) return true;
        if (this.borderEdgeDistance(nx, ny, d) >= EDGE_FENCE_DEPTH) return false;
        while (this.isValid(nx, ny)) {
            // Walkable ground still ahead: this is scenery inside the map, not
            // the fence along its edge.
            if (this.isBorderTilePassable(nx, ny)) return false;
            nx += step[0];
            ny += step[1];
        }
        return true;
    };

    Game_Map.prototype.getNearbyBorderTiles = function(playerX, playerY) {
        const nearbyBorders = [];
        // A fenced border tile is signposted from where the party can actually
        // stand, which is its fence depth further in than a walkable one.
        const scan = BORDER_DETECTION_RANGE + EDGE_FENCE_DEPTH;
        for (let dx = -scan; dx <= scan; dx++) {
            for (let dy = -scan; dy <= scan; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = playerX + dx;
                const y = playerY + dy;
                if (x < 0 || y < 0 || x >= this.width() || y >= this.height()) continue;
                if (!this.isBorderTile(x, y) || !this.isBorderTileEnabled(x, y)) continue;
                const depth = this.borderFenceDepth(x, y);
                if (depth < 0) continue;
                if (Math.max(Math.abs(dx), Math.abs(dy)) > BORDER_DETECTION_RANGE + depth) continue;
                const directions = this.getBorderDirection(x, y);
                if (this.isBorderDirectionAllowed(directions)) {
                    nearbyBorders.push({ x, y, arrow: getArrowForDirection(directions), directions });
                }
            }
        }
        return nearbyBorders;
    };

    Game_Map.prototype.getProcGenBorderTiles = function(playerX, playerY) {
        const nearbyBorders = [];
        const width  = this.width();
        const height = this.height();
        for (let dx = -BORDER_DETECTION_RANGE; dx <= BORDER_DETECTION_RANGE; dx++) {
            for (let dy = -BORDER_DETECTION_RANGE; dy <= BORDER_DETECTION_RANGE; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = playerX + dx;
                const y = playerY + dy;
                if (x < 0 || y < 0 || x >= width || y >= height) continue;
                if (!(x === 0 || y === 0 || x === width - 1 || y === height - 1)) continue;

                let passable = false;
                if (x === 0          && $gameMap.isValid(1, y))          passable = passable || $gameMap.isPassable(1, y, 4);
                if (x === width - 1  && $gameMap.isValid(width - 2, y))  passable = passable || $gameMap.isPassable(width - 2, y, 6);
                if (y === 0          && $gameMap.isValid(x, 1))          passable = passable || $gameMap.isPassable(x, 1, 8);
                if (y === height - 1 && $gameMap.isValid(x, height - 2)) passable = passable || $gameMap.isPassable(x, height - 2, 2);
                if (!passable) continue;

                if (this.terrainTag(x, y) === 4 || this.terrainTag(x, y) === 7) continue;
                if (!this.isPassable(x, y, 2) && !this.isPassable(x, y, 4) &&
                    !this.isPassable(x, y, 6) && !this.isPassable(x, y, 8)) continue;

                const directions = [];
                if (x === 0)          directions.push('west');
                if (x === width - 1)  directions.push('east');
                if (y === 0)          directions.push('north');
                if (y === height - 1) directions.push('south');
                if (directions.length === 0) continue;

                let ax = x, ay = y;
                if (x === 0)          ax = 1;
                else if (x === width - 1)  ax = width  - 2;
                if (y === 0)          ay = 1;
                else if (y === height - 1) ay = height - 2;

                const hasTransfer = this.eventsXy(ax, ay).some(ev => {
                    const evData = $dataMap.events[ev._eventId];
                    return evData && evData.name && (evData.name.includes('Transfer') || evData.name.includes('VehicleExit'));
                });
                if (hasTransfer) continue;
                if (this.terrainTag(ax, ay) === 4 || this.terrainTag(ax, ay) === 7) continue;
                if (!this.isPassable(ax, ay, 2) && !this.isPassable(ax, ay, 4) &&
                    !this.isPassable(ax, ay, 6) && !this.isPassable(ax, ay, 8)) continue;

                nearbyBorders.push({ x: ax, y: ay, directions, arrow: getArrowForDirection(directions) });
            }
        }
        return nearbyBorders;
    };

    // ============================================================================
    // BORDER ARROW SPRITE MANAGEMENT
    // ============================================================================

    let borderArrowSprites  = []; // world/regular-map arrows (yellow)
    let procGenBorderArrows = []; // proc map edge arrows (green)
    let teleportEventArrows = []; // transfer event arrows (yellow)

    Game_Player.prototype.clearBorderArrows = function() {
        // Each chevron owns the Bitmap its constructor drew, and the set is
        // rebuilt on every step: dropping the sprite without freeing the bitmap
        // leaked one canvas (and one GPU texture) per tile walked along an edge.
        clearArrowList(borderArrowSprites);
    };

    Game_Player.prototype.displayBorderArrows = function(borderTiles) {
        this.clearBorderArrows();
        if (!SceneManager._scene || !SceneManager._scene._spriteset) return;
        const spriteset = SceneManager._scene._spriteset;
        borderTiles.forEach(border => {
            const sprite = new Sprite_BorderArrow(border.x, border.y, border.arrow);
            spriteset._baseSprite.addChild(sprite);
            borderArrowSprites.push(sprite);
        });
    };

    Game_Player.prototype.updateBorderArrows = function() {
        if (!$gameMap._borderDestination && !$gameMap._coordsDest) {
            this.clearBorderArrows();
            return;
        }
        this.displayBorderArrows($gameMap.getNearbyBorderTiles(this.x, this.y));
    };

    Game_Player.prototype.clearProcGenBorderArrows = function() {
        for (const s of procGenBorderArrows) {
            if (!s) continue;
            if (s.parent) s.parent.removeChild(s);
            if (s.bitmap && s.bitmap.destroy) s.bitmap.destroy();
        }
        procGenBorderArrows = [];
    };

    Game_Player.prototype.displayProcGenBorderArrows = function(borderTiles) {
        this.clearProcGenBorderArrows();
        for (const border of borderTiles) {
            const sprite = new Sprite_BorderArrow(border.x, border.y, border.arrow, '#66ff66');
            SceneManager._scene._spriteset.addChild(sprite);
            procGenBorderArrows.push(sprite);
        }
    };

    Game_Player.prototype.updateProcGenBorderArrows = function() {
        if ($gameMap.mapId() !== procMapId) { this.clearProcGenBorderArrows(); return; }
        this.displayProcGenBorderArrows($gameMap.getProcGenBorderTiles(this.x, this.y));
    };

    Game_Player.prototype.clearTeleportEventArrows = function() {
        for (const s of teleportEventArrows) {
            if (!s) continue;
            if (s.parent) s.parent.removeChild(s);
            // Each arrow owns a Bitmap created in its constructor; free it so the
            // per-frame rebuild does not leak canvas/GPU textures.
            if (s.bitmap && s.bitmap.destroy) s.bitmap.destroy();
        }
        teleportEventArrows = [];
    };

    // Build transfer-event arrows around an arbitrary tile (px,py) into the given
    // container, pushing the created sprites onto outArr. Shared by Player 1 and the
    // split-screen Player 2 set so both players get the same visual cue.
    function buildTeleportEventArrows(px, py, container, outArr) {
        if (!container) return;
        for (const event of $gameMap.events()) {
            if (!event || !$dataMap.events[event._eventId]) continue;
            const name = $dataMap.events[event._eventId].name || '';
            if (!name.includes('Transfer') && !name.includes('VehicleExit')) continue;
            const ex = event.x, ey = event.y;
            const ddx = Math.abs(px - ex), ddy = Math.abs(py - ey);
            if (ddx > 2 || ddy > 2 || (ddx === 0 && ddy === 0)) continue;

            const mapWidth = $gameMap.width(), mapHeight = $gameMap.height();
            const onWestEdge  = ex === 0, onEastEdge  = ex === mapWidth  - 1;
            const onNorthEdge = ey === 0, onSouthEdge = ey === mapHeight - 1;
            const isOnEdge    = onWestEdge || onEastEdge || onNorthEdge || onSouthEdge;

            let ax, ay, char, onEventItself = false;
            if (isOnEdge) {
                onEventItself = true;
                ax = ex; ay = ey;
                if (onWestEdge)       char = '←';
                else if (onEastEdge)  char = '→';
                else if (onNorthEdge) char = '↑';
                else                  char = '↓';
            } else {
                const rdx = px - ex, rdy = py - ey;
                if (Math.abs(rdx) >= Math.abs(rdy)) {
                    ax = ex + (rdx > 0 ? 1 : -1); ay = ey;
                    char = rdx > 0 ? '←' : '→';
                } else {
                    ax = ex; ay = ey + (rdy > 0 ? 1 : -1);
                    char = rdy > 0 ? '↑' : '↓';
                }
                if (!$gameMap.isValid(ax, ay)) continue;
                const passDir = Math.abs(rdx) >= Math.abs(rdy) ? (rdx > 0 ? 6 : 4) : (rdy > 0 ? 2 : 8);
                if (!$gameMap.isPassable(ex, ey, passDir)) continue;
            }

            if (!onEventItself) {
                const hasTransfer = $gameMap.eventsXy(ax, ay).some(ev => {
                    const evData = $dataMap.events[ev._eventId];
                    return evData && evData.name && (evData.name.includes('Transfer') || evData.name.includes('VehicleExit'));
                });
                if (hasTransfer) continue;
                if ($gameMap.terrainTag(ax, ay) === 4 || $gameMap.terrainTag(ax, ay) === 7) continue;
                if (!$gameMap.isPassable(ax, ay, 2) && !$gameMap.isPassable(ax, ay, 4) &&
                    !$gameMap.isPassable(ax, ay, 6) && !$gameMap.isPassable(ax, ay, 8)) continue;
            }

            const sprite = new Sprite_BorderArrow(ax, ay, char);
            container.addChild(sprite);
            outArr.push(sprite);
        }
    }

    Game_Player.prototype.updateTeleportEventArrows = function() {
        this.clearTeleportEventArrows();
        if ($gameMap.mapId() === worldMapId) return;
        if (!(SceneManager._scene instanceof Scene_Map)) return;
        const ftData = $gameSystem ? $gameSystem.getFastTravelData() : null;
        if (ftData && ftData.timerActive && ftData.timerRemainingTime > 0) return;
        buildTeleportEventArrows(this.x, this.y, SceneManager._scene._spriteset, teleportEventArrows);
    };

    // ========================================================================
    // PLAYER 2 (split-screen) transfer arrows
    //
    // Mirrors the Player 1 arrow set but anchored to the split-screen P2 event's
    // tile and rendered into P2's own Spriteset_Map (_p2Spriteset), which renders
    // the map from P2's camera. Sprite_BorderArrow positions itself from the
    // global $gameMap._displayX/Y at update-time; the P2 spriteset hijacks that
    // display while it updates, so an arrow parented to it lands in P2's viewport.
    // ========================================================================
    let borderArrowSpritesP2  = [];
    let procGenBorderArrowsP2 = [];
    let teleportEventArrowsP2 = [];

    function p2ArrowEvent() {
        const ss = window.$gameSplitScreen;
        return (ss && ss.active && ss.p2Event) ? ss.p2Event : null;
    }
    function p2ArrowSpriteset() {
        return SceneManager._scene ? SceneManager._scene._p2Spriteset : null;
    }
    function clearArrowList(arr) {
        for (const s of arr) {
            if (!s) continue;
            if (s.parent) s.parent.removeChild(s);
            if (s.bitmap && s.bitmap.destroy) s.bitmap.destroy();
        }
        arr.length = 0;
    }

    Game_Player.prototype.clearP2Arrows = function() {
        clearArrowList(borderArrowSpritesP2);
        clearArrowList(procGenBorderArrowsP2);
        clearArrowList(teleportEventArrowsP2);
    };

    Game_Player.prototype.updateP2Arrows = function() {
        const ev  = p2ArrowEvent();
        const ss2 = p2ArrowSpriteset();
        if (!ev || !ss2) { this.clearP2Arrows(); return; }

        // World/regular-map border arrows (yellow).
        clearArrowList(borderArrowSpritesP2);
        if (($gameMap._borderDestination || $gameMap._coordsDest) && ss2._baseSprite) {
            for (const border of $gameMap.getNearbyBorderTiles(ev.x, ev.y)) {
                const sprite = new Sprite_BorderArrow(border.x, border.y, border.arrow);
                ss2._baseSprite.addChild(sprite);
                borderArrowSpritesP2.push(sprite);
            }
        }

        // Proc-map edge arrows (green).
        clearArrowList(procGenBorderArrowsP2);
        if ($gameMap.mapId() === procMapId) {
            for (const border of $gameMap.getProcGenBorderTiles(ev.x, ev.y)) {
                const sprite = new Sprite_BorderArrow(border.x, border.y, border.arrow, '#66ff66');
                ss2.addChild(sprite);
                procGenBorderArrowsP2.push(sprite);
            }
        }

        // Transfer-event arrows (yellow).
        clearArrowList(teleportEventArrowsP2);
        if ($gameMap.mapId() !== worldMapId) {
            const ftData = $gameSystem ? $gameSystem.getFastTravelData() : null;
            if (!(ftData && ftData.timerActive && ftData.timerRemainingTime > 0)) {
                buildTeleportEventArrows(ev.x, ev.y, ss2, teleportEventArrowsP2);
            }
        }
    };

    // ============================================================================
    // GAME_PLAYER EXTENSIONS
    // ============================================================================

    const _orig_Player_initialize = Game_Player.prototype.initialize;
    Game_Player.prototype.initialize = function() {
        _orig_Player_initialize.call(this);
        this._lastArrowUpdateX = -1;
        this._lastArrowUpdateY = -1;
    };

    // Sync vars 43/44 on every step on the world map
    const _orig_Player_increaseSteps = Game_Player.prototype.increaseSteps;
    Game_Player.prototype.increaseSteps = function() {
        _orig_Player_increaseSteps.call(this);
        if ($gameMap.mapId() === worldMapId) {
            $gameVariables.setValue(VAR_WORLD_X, this.x);
            $gameVariables.setValue(VAR_WORLD_Y, this.y);
        }
    };

    // Combined update: border teleport + arrow updates + proc arrows + teleport arrows + diving
    const _orig_Player_update = Game_Player.prototype.update;
    Game_Player.prototype.update = function(sceneActive) {
        const wasMoving = this.isMoving();
        _orig_Player_update.call(this, sceneActive);

        // Arrow sprites animate themselves each frame via their own update(); the
        // expensive full rebuilds (events rescan + Bitmap/canvas draw) only need
        // to run when the player's tile changes. Also rebuild when the fast-travel
        // timer's active state flips, since it gates whether arrows show at all.
        const tileChanged = this._lastArrowUpdateX !== this.x || this._lastArrowUpdateY !== this.y;
        const ftData = $gameSystem ? $gameSystem.getFastTravelData() : null;
        const ftActive = !!(ftData && ftData.timerActive && ftData.timerRemainingTime > 0);
        const ftChanged = this._lastArrowFtActive !== ftActive;
        const mapChanged = this._lastArrowMapId !== $gameMap.mapId();
        const needP1Rebuild = wasMoving || tileChanged || ftChanged || mapChanged;

        if (sceneActive && !$gameMessage.isBusy()) {
            if (tileChanged || mapChanged) this.checkBorderTeleport();
            if (needP1Rebuild) {
                this.updateBorderArrows();
            }
        }

        if (SceneManager._scene instanceof Scene_Map) {
            if (needP1Rebuild) {
                if ($gameMap.mapId() === procMapId) this.updateProcGenBorderArrows();
                else this.clearProcGenBorderArrows();
                this.updateTeleportEventArrows();
            }
            updatePartyDivingSprites();
            // Split-screen: mirror the transfer arrows around the Player 2 event so
            // the second player gets the same edge/transfer cue in their viewport.
            // Rebuild only when the P2 event's tile (or timer/map state) changed.
            const p2 = (window.$gameSplitScreen && window.$gameSplitScreen.active && window.$gameSplitScreen.p2Event)
                ? window.$gameSplitScreen.p2Event : null;
            const p2Changed = !p2 || this._lastP2ArrowX !== p2.x || this._lastP2ArrowY !== p2.y;
            if (p2Changed || ftChanged || mapChanged) {
                this.updateP2Arrows();
                if (p2) { this._lastP2ArrowX = p2.x; this._lastP2ArrowY = p2.y; }
            }
        }

        this._lastArrowUpdateX = this.x;
        this._lastArrowUpdateY = this.y;
        this._lastArrowFtActive = ftActive;
        this._lastArrowMapId = $gameMap.mapId();
    };


    // Combined performTransfer: save world pos + clear proc data + inject proc terrain
    const _orig_Player_performTransfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        const currentMapId     = $gameMap.mapId();
        const destinationMapId = this._newMapId;

        $gameVariables.setValue(VAR_DEST_MAP, destinationMapId);

        // Leaving world map: save position.
        // Skip when the vehicle has already been relocated to a different map
        // (camper fast travel: completeTravelCamper moves the ship before this fires,
        // so $gamePlayer.x/y is the stale departure tile, not the actual destination).
        if (currentMapId === worldMapId && destinationMapId !== worldMapId) {
            const vehicle          = $gamePlayer.vehicle();
            const vehicleStillHere = !vehicle || vehicle._mapId === $gameMap.mapId();
            if (vehicleStillHere) {
                $gameVariables.setValue(VAR_WORLD_X, $gamePlayer.x);
                $gameVariables.setValue(VAR_WORLD_Y, $gamePlayer.y);
            }
        }

        // Leaving the procedural map back to the WORLD MAP: clear entry border
        // and proc gen data. We deliberately do NOT clear for excursions to other
        // maps (battle maps, houses, dungeons): those are round-trips, and wiping
        // the generated map made the player return to a blank base 636. The map
        // is deterministic from the world seed + coords, so it is restored/
        // regenerated on re-entry regardless.
        if (currentMapId === procMapId && destinationMapId === worldMapId) {
            $gameSystem._procEntryBorder = null;
            if ($gameSystem._procGenData) $gameSystem.clearProcGenData();
        }

        // Entering procedural map: ensure generated terrain exists, then inject it
        // into $dataMap. If the data was lost (e.g. an earlier excursion cleared
        // it), regenerate deterministically from the world seed + coords so the
        // player returns to the same map instead of a blank base 636.
        if (this._transferring &&
            destinationMapId === procMapId &&
            $gameSystem._procGenData) {
            if (!$gameSystem._procGenData.generatedMapData && $gameSystem.generateProceduralMap) {
                $gameSystem.generateProceduralMap();
            }
        }
        if (this._transferring &&
            destinationMapId === procMapId &&
            $gameSystem._procGenData &&
            $gameSystem._procGenData.generatedMapData) {
            if (!$dataMap || !$dataMap.data) DataManager.loadMapData(procMapId);
            if ($dataMap) {
                $dataMap.data      = $gameSystem._procGenData.generatedMapData;
                $dataMap.width     = PROC_MAP_WIDTH;
                $dataMap.height    = PROC_MAP_HEIGHT;
                $dataMap.tilesetId = $gameSystem._procGenData.currentBiomeTileset;
                $dataMap.displayName = procMapDisplayName();
            }
        }

        // Biome-to-biome moves reserve a transfer from map 636 back to map 636
        // (edge crossing, goDown/goUp, switchLayer). RMMZ's performTransfer only
        // calls Game_Map.setup() when the destination map id differs, so a
        // same-map proc transfer would otherwise keep the previous biome's
        // events and never reset _npcControllersInitialized - leaving NPCs
        // placed for the old (e.g. City) biome standing in the new one even when
        // it has hasNPC: false. Forcing a reload rebuilds the events from the
        // freshly-injected terrain and lets every per-biome system re-run,
        // including the hasNPC-gated NPC placement in setupProceduralMapNPCs.
        // (World->636 and house->636 entries already differ in map id, so this
        // condition leaves them untouched and never double-runs setup.)
        if (this._transferring &&
            currentMapId === procMapId &&
            destinationMapId === procMapId) {
            this.requestMapReload();
        }

        _orig_Player_performTransfer.call(this);

        // The party has arrived: re-derive their world square straight away rather
        // than waiting for the end of Scene_Map.onMapLoaded. Every other map-load
        // hook (the vehicle store's reconcile, for one) runs between the two, and
        // asks where the party is.
        syncPlayerWorldCoords($gameMap.mapId());
    };

    // OK button on world map: open travel decision window (or interact with teleport/vehicle)
    //
    // openTravelDecision() below calls Input.clear() right after opening the
    // "Visit / Make a camp / Cancel" choice window, to stop the very button
    // press that opened it from also being read as its first input. Input.clear()
    // wipes Input._previousState along with the current one, so if that button
    // is still physically held on the next frame (routine on a gamepad, whose
    // trigger reads a continuous "pressed" flag rather than a discrete keydown),
    // Input.isTriggered('ok') reports a brand-new press even though the player
    // never released it. Without the isBusy() guard here, that phantom press
    // re-enters this handler while the choice window is still only *pending*
    // (isBusy() is already true, so the isHardcodedBiomeHere() branch below
    // politely declines) and falls through to the plain "Teleport - <place>"
    // event on the same tile, starting it directly and skipping the choice
    // the player never got to answer. Gating the whole handler on !isBusy()
    // makes a phantom re-trigger while a message/choice is already up a no-op,
    // same as any other button press would be.
    const _orig_Player_triggerButtonAction = Game_Player.prototype.triggerButtonAction;
    Game_Player.prototype.triggerButtonAction = function() {
        if ($gameMap.mapId() === worldMapId && Input.isTriggered('ok') && !$gameMessage.isBusy()) {
            const currentEvents   = $gameMap.eventsXy(this.x, this.y);
            // Named hardcoded locations (London, Milano, ...) always offer the
            // "Visit <name>" travel menu, taking precedence over a Teleport event
            // sharing the same tile.
            if (isHardcodedBiomeHere()) {
                const scene = SceneManager._scene;
                if (scene && scene.openTravelDecision && !$gameMessage.isBusy()) {
                    scene.openTravelDecision();
                    return true;
                }
            }
            const currentTeleport = currentEvents.find(e => e && e.event() && e.event().name && e.event().name.startsWith('Teleport'));
            if (currentTeleport) { currentTeleport.start(); return true; }

            const x2           = $gameMap.roundXWithDirection(this.x, this.direction());
            const y2           = $gameMap.roundYWithDirection(this.y, this.direction());
            const facingEvents = $gameMap.eventsXy(x2, y2);

            const facingTeleport = facingEvents.find(e => e && e.event() && e.event().name && e.event().name.startsWith('Teleport'));
            if (facingTeleport) { facingTeleport.start(); return true; }

            const hasActionEvent = facingEvents.some(e => e.isTriggerIn([0]) && e.isNormalPriority());

            const facingVehicle = ['ship', 'boat', 'airship'].reduce((found, type) => {
                if (found) return found;
                const v = $gameMap.vehicle(type);
                return (v && v._mapId === $gameMap.mapId() && v.x === x2 && v.y === y2) ? v : null;
            }, null);

            if (facingVehicle) {
                $gamePlayer.showVehicleActionMenu(facingVehicle, false);
                Input.clear();
                return true;
            }

            if (!hasActionEvent) {
                // While riding a vehicle, OK opens the vehicle options menu
                // (Visit map, Stop driving, etc.) instead of the travel choices.
                if ($gamePlayer.isInVehicle() && $gamePlayer.showVehicleActionMenu) {
                    const ridingVehicle = $gamePlayer.vehicle();
                    if (ridingVehicle) {
                        $gamePlayer.showVehicleActionMenu(ridingVehicle, true);
                        Input.clear();
                        return true;
                    }
                }

                const scene = SceneManager._scene;
                // Named hardcoded locations (London, Milano, ...) sit on City/Burg
                // tiles, so isSettlementBiomeHere() is true for them; they must still
                // get the "Visit <name>" travel menu, hence the hardcoded override.
                if (scene && scene.openTravelDecision && !$gameMessage.isBusy() &&
                    (!isSettlementBiomeHere() || isHardcodedBiomeHere())) {
                    scene.openTravelDecision();
                    return true;
                }
            }
        }
        return _orig_Player_triggerButtonAction.call(this);
    };

    // Mouse on the world map: a click walks the party to the tile and, once it
    // arrives, opens the same "Visit / Make a camp" menu the OK button gives.
    // Click-to-move always ends on the player's own tile, which is the D1 case;
    // the original handler runs first so Teleport events on the tile still win.
    const _orig_Player_triggerTouchActionD1 = Game_Player.prototype.triggerTouchActionD1;
    Game_Player.prototype.triggerTouchActionD1 = function(x1, y1) {
        if (_orig_Player_triggerTouchActionD1.call(this, x1, y1)) return true;
        if ($gameMap.mapId() !== worldMapId) return false;
        // Vehicles keep their own action menu on the OK button; clicking a route
        // while sailing or driving must stay pure movement.
        if (this.isInVehicle()) return false;
        const scene = SceneManager._scene;
        if (!scene || !scene.openTravelDecision || !canOpenTravelDecisionHere()) return false;
        scene.openTravelDecision();
        return true;
    };

    // Is there a Transfer / VehicleExit named event on tile (x, y)? Such events own
    // their own destination, so the world-map border return must yield to them
    // (otherwise a Transfer event placed on a border tile double-transfers: first to
    // the world map via the border return, then to the event's real destination).
    Game_Player.prototype.hasTransferEventAt = function(x, y) {
        return $gameMap.eventsXy(x, y).some(ev => {
            const evData = $dataMap.events[ev._eventId];
            return evData && evData.name &&
                (evData.name.includes('Transfer') || evData.name.includes('VehicleExit'));
        });
    };

    // Leave the map through its declared border. <Coords x y> lands on the world
    // map, <Borders mapId x y> anywhere it names.
    Game_Player.prototype.performBorderReturn = function() {
        let dest = null;
        if ($gameMap._coordsDest) {
            dest = { mapId: worldMapId, x: $gameMap._coordsDest.x, y: $gameMap._coordsDest.y };
        } else if ($gameMap._borderDestination) {
            dest = $gameMap._borderDestination;
        }
        if (!dest) return false;
        $gameVariables.setValue(VAR_DEST_MAP, dest.mapId);
        // The world position has to move with the party: the travel menu and the
        // procedural generator both read it, and without this they keep working
        // from wherever the party last stood on map 315.
        if (dest.mapId === worldMapId) {
            $gameVariables.setValue(VAR_WORLD_X, dest.x);
            $gameVariables.setValue(VAR_WORLD_Y, dest.y);
        }
        this.reserveTransfer(dest.mapId, dest.x, dest.y, 0, 0);
        return true;
    };

    // Auto-transfer when player steps on a border tile that has a Coords/Borders destination
    Game_Player.prototype.checkBorderTeleport = function() {
        if (this._justWrapped) { this._justWrapped = false; return; }

        const x = this.x, y = this.y;
        if ($gameMap.isBorderTile(x, y) && $gameMap.isBorderTilePassable(x, y)) {
            // The flag remembers the tile, not just "a border was handled": walking
            // along the edge from a tile that yielded to a Transfer event must still
            // be able to cross on the next one.
            const tileKey = x + ',' + y;
            // A Transfer event on this border tile takes precedence: let it run and
            // skip the border return so we don't bounce through the world map first.
            if (this.hasTransferEventAt(x, y)) { this._borderChoiceShown = tileKey; return; }

            const directions         = $gameMap.getBorderDirection(x, y);
            const hasBorderDest      = $gameMap._borderDestination || $gameMap._coordsDest;
            const isDirectionAllowed = $gameMap.isBorderDirectionAllowed(directions);

            if (hasBorderDest && this._borderChoiceShown !== tileKey && isDirectionAllowed) {
                this._borderChoiceShown = tileKey;
                this.performBorderReturn();
                return;
            }
        } else {
            this._borderChoiceShown = null;
        }
    };

    // The party pushing against a fenced map edge on a <Worldmap> map: the step is
    // blocked, but the intent is to leave, so cross instead of bumping.
    Game_Player.prototype.tryBorderReturn = function(d) {
        if (this.isTransferring() || this.isMoving()) return false;
        if ($gameMap.mapId() === worldMapId || $gameMap.mapId() === procMapId) return false;
        if (this.canPass(this.x, this.y, d)) return false;
        if (this.hasTransferEventAt(this.x, this.y)) return false;
        if (!$gameMap.isBorderCrossing(this.x, this.y, d)) return false;
        this.setDirection(d);
        return this.performBorderReturn();
    };

    Game_Player.prototype.getExitDirection = function(directions) {
        if (directions.includes('south')) return 2;
        if (directions.includes('west'))  return 4;
        if (directions.includes('east'))  return 6;
        if (directions.includes('north')) return 8;
        return 0;
    };

    // Proc map edge: regenerate adjacent biome and transfer seamlessly
    const _orig_Player_moveStraight = Game_Player.prototype.moveStraight;
    Game_Player.prototype.moveStraight = function(d) {
        if ($gameMap.mapId() !== procMapId) {
            // Hand-made maps declare their exits with <Worldmap>: walking off a
            // walkable edge is handled by checkBorderTeleport, pushing against a
            // fenced one here.
            if (this.tryBorderReturn(d)) return;
            _orig_Player_moveStraight.call(this, d);
            return;
        }

        const x         = this.x, y = this.y;
        const mapWidth  = $gameMap.width(), mapHeight = $gameMap.height();
        let wouldLeave  = false, exitDirection = 0;

        switch (d) {
            case 2: if (y + 1 >= mapHeight) { wouldLeave = true; exitDirection = 2; } break;
            case 4: if (x - 1 < 0)          { wouldLeave = true; exitDirection = 4; } break;
            case 6: if (x + 1 >= mapWidth)  { wouldLeave = true; exitDirection = 6; } break;
            case 8: if (y - 1 < 0)          { wouldLeave = true; exitDirection = 8; } break;
        }

        if (!wouldLeave) { _orig_Player_moveStraight.call(this, d); return; }

        // Already mid-transition (or a transfer is pending): swallow further edge
        // input so we do not restart the fade or overwrite the callback every
        // frame. Without this, holding a direction at high vehicle speed (e.g. the
        // Car) re-arms the transition after the destination map has already faded
        // in, leaving the screen stuck black (issue #164).
        if (this.isTransferring() ||
            ($gameSystem._procGenData && $gameSystem._procGenData._edgeTransitionScheduled)) {
            return;
        }

        // Door / Sandbox dungeon: the border is the way OUT. Return to the map the
        // player came from instead of travelling to an adjacent biome.
        if ($gameSystem._procGenData && $gameSystem._procGenData._dungeonSession) {
            exitDungeonSession(d);
            return;
        }

        console.log(`[WorldMapReturn-Edge] Border touched, starting fade out`);
        scheduleProcEdgeTransition(exitDirection, x, y, d);
    };

    // Leave a door/sandbox-generated dungeon when the player steps onto the border.
    //   - sandbox: transfer back to the map Sandbox Mode was invoked from.
    //   - door:    pop up to the surface (goUp) at the tile just south of the door.
    function exitDungeonSession(d) {
        const pg = $gameSystem._procGenData;
        const sess = pg && pg._dungeonSession;
        if (!sess) return;

        // A floor of the lower tower (DungeonFloorSystem) is generated with the
        // same south entrance every structure is, but nothing was ever entered
        // through it: the party arrived by a staircase or by the lift, and those
        // are the only ways out again. The doorway is walled up, so the border
        // is not a way out and the session stays standing.
        if (sess.type === 'tower') return;

        pg._dungeonSession = null;
        $gamePlayer.clearProcGenBorderArrows();
        if (window.SplitScreenManager && window.SplitScreenManager.active) window.SplitScreenManager.forceP2Teleport = true;

        if (sess.type === 'bunker') {
            // Climbing out of the character-creation bunker: rebuild the world
            // square the hatch belongs to (the biome the world map holds there,
            // with the hatch stamped back on) and step out one tile south of it.
            // Set both by the Bunker origin and by descending the hatch itself
            // (ProceduralTerrainInteractions), so every trip out lands the same.
            const rec = $gameSystem._bunkerOrigin;
            const built = rec && $gameSystem.generateBunkerSurfaceMap && $gameSystem.generateBunkerSurfaceMap();
            if (built && rec.entranceX !== null && rec.entranceY !== null) {
                $gameVariables.setValue(110, 1);
                $gameVariables.setValue(111, 1);
                $gamePlayer.reserveTransfer(procMapId, rec.entranceX, rec.entranceY + 1, 2, 0);
            } else {
                logWarn('Bunker exit: surface map unavailable, falling back to the world map.');
                $gameSystem.clearProcGenData();
                $gamePlayer.reserveTransfer(worldMapId, rec ? rec.worldX : $gamePlayer.x, rec ? rec.worldY : $gamePlayer.y, 2, 0);
            }
        } else if (sess.type === 'sandbox') {
            // Structure entered off the procedural map: put that square back
            // exactly as it was, world coordinates and tiles included, and step
            // out onto the very entrance tile the party went in by.
            //
            // Wiping the procgen data here (what this used to do) left the return
            // transfer with no terrain, and performTransfer's fallback then
            // re-resolved the biome off $gameMap -- which at that moment is the
            // structure's own 64x64 map, not the world map -- so the party
            // surfaced onto a square built from tiles read out of the dungeon.
            if (sess.mapId === procMapId && restoreProcSurface(sess.surface)) {
                $gamePlayer.reserveTransfer(procMapId, sess.x, sess.y, sess.dir || d, 0);
            } else {
                // Sandbox Mode invoked from an authored map: a plain trip back.
                $gameSystem.clearProcGenData();
                $gamePlayer.reserveTransfer(sess.mapId, sess.x, sess.y, sess.dir || d, 0);
            }
        } else {
            // Door dungeon: goUp regenerates the surface and returns to goDownEventX/Y.
            PluginManager.callCommand($gameMap._interpreter || {}, PLUGIN_PMT, 'goUp', {});
        }
    }

    // Fade out and schedule the seamless biome-to-biome edge transition for the
    // current procedural map. Shared by Player 1 (moveStraight, above) and Player 2
    // (split-screen, via window.WorldMapReturnP2.handleP2Move) so that EITHER player
    // walking off the proc-map edge moves the whole party to the adjacent biome.
    function scheduleProcEdgeTransition(exitDirection, playerX, playerY, d) {
        // Pull Player 2 to Player 1 once the new biome map loads so the split-screen
        // companion does not get stranded on the old edge.
        if (window.SplitScreenManager && window.SplitScreenManager.active) {
            window.SplitScreenManager.forceP2Teleport = true;
        }
        $gameScreen.startFadeOut(10);

        const system         = $gameSystem;
        const storedExitDir  = exitDirection;
        const storedPlayerX  = playerX;
        const storedPlayerY  = playerY;

        system._procGenData._edgeTransitionScheduled = true;
        system._procGenData._edgeTransitionCallback  = () => {
            if (!system._procGenData._edgeTransitionScheduled) return;
            system._procGenData._edgeTransitionScheduled = false;

            console.log(`[WorldMapReturn-Edge] Fade complete, computing next biome`);

            const currentWorldX = $gameVariables.value(VAR_WORLD_X);
            const currentWorldY = $gameVariables.value(VAR_WORLD_Y);
            console.log(`[WorldMapReturn-Edge] World coords: (${currentWorldX},${currentWorldY}), exit dir: ${storedExitDir}`);

            // Check non-procedural destination at current world coords
            const nonProcCheck = getNonProceduralDestination(currentWorldX, currentWorldY, storedExitDir);
            if (nonProcCheck.exists && nonProcCheck.destination) {
                const dest = nonProcCheck.destination;
                console.log(`[WorldMapReturn-Edge] Non-proc dest at current coords: map ${dest.mapId} (${dest.x},${dest.y})`);
                $gamePlayer.clearProcGenBorderArrows();
                system.clearProcGenData();
                $gamePlayer.reserveTransfer(dest.mapId, dest.x, dest.y, d, 0);
                return;
            }

            const adjacentCoords = system.getAdjacentWorldCoordinates(storedExitDir);
            console.log(`[WorldMapReturn-Edge] Adjacent world coords: (${adjacentCoords.x},${adjacentCoords.y})`);

            // Check non-procedural destination at adjacent world coords
            const nonProcCheckAdj = getNonProceduralDestination(adjacentCoords.x, adjacentCoords.y, storedExitDir);
            if (nonProcCheckAdj.exists && nonProcCheckAdj.destination) {
                const dest = nonProcCheckAdj.destination;
                console.log(`[WorldMapReturn-Edge] Non-proc dest at adjacent coords: map ${dest.mapId} (${dest.x},${dest.y})`);
                $gamePlayer.clearProcGenBorderArrows();
                system.clearProcGenData();
                $gamePlayer.reserveTransfer(dest.mapId, dest.x, dest.y, d, 0);
                return;
            }

            _resolveAdjacentBiomeAndTransfer(system, storedExitDir, storedPlayerX, storedPlayerY, d, adjacentCoords);
        };
    }

    // ============================================================================
    // PLAYER 2 (SPLIT-SCREEN) TRANSFER HANDLER
    // ============================================================================
    // The split-screen plugin (SplitScreenMultiplayer.js) drives Player 2 as a map
    // event independent of $gamePlayer, so the engine's transfer paths (which are
    // keyed on $gamePlayer's position) never fire for P2. This exposes the same
    // destination resolution P1 uses, keyed on P2's tile, and performs the transfer
    // on $gamePlayer (the whole party) so Player 1 follows along. P2 then snaps to
    // P1 via SplitScreenManager.forceP2Teleport when the destination map loads.
    window.WorldMapReturnP2 = {
        // Returns true if a transfer / edge transition was initiated (the caller
        // should then skip P2's normal step this frame).
        handleP2Move(ev, dir) {
            if (!ev || !dir || $gameMap.isEventRunning() || $gameMessage.isBusy()) return false;
            const mapId = $gameMap.mapId();

            // --- Procedural map: seamless biome-to-biome edge transition ---
            if (mapId === procMapId) {
                const mapWidth = $gameMap.width(), mapHeight = $gameMap.height();
                let wouldLeave = false, exitDirection = 0;
                switch (dir) {
                    case 2: if (ev.y + 1 >= mapHeight) { wouldLeave = true; exitDirection = 2; } break;
                    case 4: if (ev.x - 1 < 0)          { wouldLeave = true; exitDirection = 4; } break;
                    case 6: if (ev.x + 1 >= mapWidth)  { wouldLeave = true; exitDirection = 6; } break;
                    case 8: if (ev.y - 1 < 0)          { wouldLeave = true; exitDirection = 8; } break;
                }
                if (!wouldLeave) return false;
                // Already mid-transition: swallow further input so we don't reschedule.
                if ($gameSystem._procGenData && $gameSystem._procGenData._edgeTransitionScheduled) return true;
                console.log(`[WorldMapReturn-Edge] P2 touched proc edge, starting fade out`);
                scheduleProcEdgeTransition(exitDirection, ev.x, ev.y, dir);
                return true;
            }

            // The world map uses Teleport events / the travel-decision window, not
            // border/Transfer transfers, so leave P2's world-map movement untouched.
            if (mapId === worldMapId) return false;

            const nx = $gameMap.roundXWithDirection(ev.x, dir);
            const ny = $gameMap.roundYWithDirection(ev.y, dir);

            // --- Transfer / VehicleExit named events (step-onto or facing) ---
            const isTransferEvent = e => {
                if (!e || e === ev) return false;
                const data = e.event && e.event();
                return data && data.name &&
                    (data.name.includes('Transfer') || data.name.includes('VehicleExit'));
            };
            const tEv = $gameMap.eventsXy(nx, ny).find(isTransferEvent) ||
                        $gameMap.eventsXy(ev.x, ev.y).find(isTransferEvent);
            if (tEv) {
                if (window.SplitScreenManager && window.SplitScreenManager.active) {
                    window.SplitScreenManager.forceP2Teleport = true;
                }
                $gameMessage._eventActivator = "p2";
                tEv.start();
                return true;
            }

            // --- Regular border tile (<Coords> / <Borders> destination) ---
            // (A Transfer event on the border tile was already handled above via tEv.)
            if ($gameMap.isBorderTile(nx, ny) && $gameMap.isBorderTilePassable(nx, ny)) {
                const directions    = $gameMap.getBorderDirection(nx, ny);
                const hasBorderDest = $gameMap._borderDestination || $gameMap._coordsDest;
                if (hasBorderDest && $gameMap.isBorderDirectionAllowed(directions)) {
                    let borderDest = null;
                    if ($gameMap._coordsDest) {
                        borderDest = { mapId: worldMapId, x: $gameMap._coordsDest.x, y: $gameMap._coordsDest.y };
                    } else if ($gameMap._borderDestination) {
                        borderDest = $gameMap._borderDestination;
                    }
                    if (borderDest) {
                        if (window.SplitScreenManager && window.SplitScreenManager.active) {
                            window.SplitScreenManager.forceP2Teleport = true;
                        }
                        $gameVariables.setValue(VAR_DEST_MAP, borderDest.mapId);
                        $gamePlayer.reserveTransfer(borderDest.mapId, borderDest.x, borderDest.y, 0, 0);
                        return true;
                    }
                }
            }

            return false;
        }
    };

    // Resolve adjacent biome, generate terrain, and transfer to it
    function _resolveAdjacentBiomeAndTransfer(system, storedExitDir, storedPlayerX, storedPlayerY, _d, adjacentCoords) {
        let roadDirection = null;
        let biomeName     = 'Fields';

        // An alien planet surface is a single biome edge-to-edge: the whole world
        // is the biome tied to that planet, so every border crossing keeps it
        // instead of resolving to the world-map default (which was giving Fields).
        const alienBiome = (system._procGenData &&
            /^Alien/.test(String(system._procGenData.currentBiome || "")))
            ? system._procGenData.currentBiome : null;
        // The planet's bounded landing grid (see GalaxySim_Core.js
        // enterPlanetSurface): wraps both axes toroidally ("pacman") instead
        // of walking an unbounded plane of the same biome forever.
        const alienGrid = alienBiome ? system._procGenData.alienGrid : null;

        const hardcodedOverride = (!alienBiome && window.getHardcodedBiomeOverride)
            ? window.getHardcodedBiomeOverride(adjacentCoords.x, adjacentCoords.y)
            : null;

        // A river crossing outranks everything else, exactly as it does when the
        // square is entered from the world map (generateProceduralMap). Without
        // this the coordinate cache reported the tile's underlying biome and
        // walking onto a bridge square built a different map than travelling to
        // it did.
        const bridgeDirection = (!alienBiome && system.getBridgeDirectionAt)
            ? system.getBridgeDirectionAt(adjacentCoords.x, adjacentCoords.y)
            : null;

        if (alienBiome) {
            biomeName = alienBiome;
            if (alienGrid) {
                adjacentCoords.x = ((adjacentCoords.x % alienGrid.w) + alienGrid.w) % alienGrid.w;
                adjacentCoords.y = ((adjacentCoords.y % alienGrid.h) + alienGrid.h) % alienGrid.h;
                alienGrid.gx = adjacentCoords.x;
                alienGrid.gy = adjacentCoords.y;
            }
            console.log(`[WorldMapReturn-Edge] Alien planet surface: keeping biome "${biomeName}" at grid (${adjacentCoords.x},${adjacentCoords.y})`);
        } else if (bridgeDirection) {
            biomeName     = 'Bridge';  // i18n-ignore  biome id
            roadDirection = bridgeDirection;
            console.log(`[WorldMapReturn-Edge] Bridge (${bridgeDirection}) at (${adjacentCoords.x},${adjacentCoords.y})`);
        } else if (hardcodedOverride) {
            biomeName     = hardcodedOverride.biome;
            roadDirection = hardcodedOverride.roadDirection || null;
            console.log(`[WorldMapReturn-Edge] Hardcoded override: biome="${biomeName}", roadDir="${roadDirection}"`);
        } else {
            let worldTileBiome = null;
            if (system._procGenData.biomeCoordinateCache &&
                Object.keys(system._procGenData.biomeCoordinateCache).length > 0) {
                for (const [bname, coordinates] of Object.entries(system._procGenData.biomeCoordinateCache)) {
                    if (coordinates.some(coord => coord.x === adjacentCoords.x && coord.y === adjacentCoords.y)) {
                        worldTileBiome = bname;
                        console.log(`[WorldMapReturn-Edge] Found in cache: "${bname}"`);
                        break;
                    }
                }
                if (!worldTileBiome) {
                    console.log(`[WorldMapReturn-Edge] WARNING: (${adjacentCoords.x},${adjacentCoords.y}) not in cache`);
                }
            } else {
                console.log(`[WorldMapReturn-Edge] ERROR: Cache is empty`);
            }
            if (!worldTileBiome) worldTileBiome = 'Fields';

            if (worldTileBiome.startsWith('Road ')) {
                roadDirection = worldTileBiome.substring(5).toLowerCase();
                biomeName     = 'Road';
                console.log(`[WorldMapReturn-Edge] Road detected: dir="${roadDirection}"`);
            } else {
                biomeName = worldTileBiome;
            }
        }

        if (!biomeName) biomeName = 'Fields';
        console.log(`[WorldMapReturn-Edge] Resolved biome: "${biomeName}"`);

        let biome = getBiomeByName(biomeName);
        if (!biome) {
            console.error(`[WorldMapReturn-Edge] Biome "${biomeName}" not found, returning to world map`);
            const returnCoords = system.getReturnCoordinates(storedExitDir);
            $gamePlayer.clearProcGenBorderArrows();
            system.clearProcGenData();
            $gamePlayer.reserveTransfer(worldMapId, returnCoords.x, returnCoords.y, storedExitDir, 0);
            return;
        }

        // If underground, use adjacent biome's lower layer
        if (system._procGenData.biomeLayerStack && system._procGenData.biomeLayerStack.length > 0) {
            if (biome.lowerLayer) {
                biomeName = biome.lowerLayer;
                biome     = getBiomeByName(biomeName);
                if (!biome) {
                    const returnCoords = system.getReturnCoordinates(storedExitDir);
                    $gamePlayer.clearProcGenBorderArrows();
                    system.clearProcGenData();
                    $gamePlayer.reserveTransfer(worldMapId, returnCoords.x, returnCoords.y, storedExitDir, 0);
                    return;
                }
            }
        }

        system._procGenData.currentBiome          = biomeName;
        // Must be re-stamped every crossing, bridge or not: generateProceduralTerrain
        // reads it off procGenData, so a stale marker turned the square after a
        // river crossing into a second bridge.
        system._procGenData.currentBridgeDirection = bridgeDirection;
        $gameVariables.setValue(VAR_WORLD_X, adjacentCoords.x);
        $gameVariables.setValue(VAR_WORLD_Y, adjacentCoords.y);
        system._procGenData.originX               = adjacentCoords.x;
        system._procGenData.originY               = adjacentCoords.y;
        system._procGenData.currentBiomeTileset   = biome.tilesetId;
        system._procGenData.biomeDayTemperature    = biome.dayTemperature   || 20;
        system._procGenData.biomeNightTemperature  = biome.nightTemperature || 10;

        // Same formula as entering this square from the world map: walking in
        // over the border and travelling there directly must build one and the
        // same map (see ProcGenUtils.procMapSeed).
        const layerDepth = (system._procGenData.biomeLayerStack || []).length;
        const seed = procMapSeed(adjacentCoords.x, adjacentCoords.y, layerDepth);

        // On an alien planet the grid coordinate is planet-local (small,
        // toroidal), so it must never be used to query Earth's world-map
        // tiles/cache -- those numbers can coincidentally land inside Earth's
        // real 0-255 coordinate range now that landing no longer uses a huge
        // offset. Every neighbor is simply the same planet-wide biome.
        let adjacentBiomesForNewTile;
        if (alienBiome) {
            const alienNeighbor = normalizeBiomeForEdge(alienBiome);
            adjacentBiomesForNewTile = {
                north: alienNeighbor, south: alienNeighbor, east: alienNeighbor, west: alienNeighbor,
            };
        } else {
            adjacentBiomesForNewTile = getAdjacentBiomesOnWorldMap(adjacentCoords.x, adjacentCoords.y);
            if (system._procGenData.biomeCoordinateCache &&
                Object.keys(system._procGenData.biomeCoordinateCache).length > 0) {
                const cacheBiomes = getAdjacentBiomesFromCache(adjacentCoords.x, adjacentCoords.y, system._procGenData.biomeCoordinateCache);
                adjacentBiomesForNewTile.north = cacheBiomes.north || adjacentBiomesForNewTile.north;
                adjacentBiomesForNewTile.south = cacheBiomes.south || adjacentBiomesForNewTile.south;
                adjacentBiomesForNewTile.east  = cacheBiomes.east  || adjacentBiomesForNewTile.east;
                adjacentBiomesForNewTile.west  = cacheBiomes.west  || adjacentBiomesForNewTile.west;
            }
            adjacentBiomesForNewTile = {
                north: normalizeBiomeForEdge(adjacentBiomesForNewTile.north),
                south: normalizeBiomeForEdge(adjacentBiomesForNewTile.south),
                east:  normalizeBiomeForEdge(adjacentBiomesForNewTile.east),
                west:  normalizeBiomeForEdge(adjacentBiomesForNewTile.west),
            };
        }

        if (isRoadBiome && isRoadBiome(biomeName)) {
            roadDirection = determineRoadIntersectionType
                ? determineRoadIntersectionType(adjacentBiomesForNewTile, isRoadBiome)
                : null;
            console.log(`[WorldMapReturn-Edge] Auto-detected road dir: ${roadDirection}`);
        }
        if (isRoadBiome && isRoadBiome(biomeName) && !roadDirection) roadDirection = 'horizontal';
        system._procGenData.currentRoadDirection = roadDirection;

        let cacheInfoForCheck = null, diagonalBiomesForCheck = null;
        if (!alienBiome && system._procGenData.biomeCoordinateCache &&
            Object.keys(system._procGenData.biomeCoordinateCache).length > 0) {
            cacheInfoForCheck      = checkAdjacentMapBiomesFromCache(adjacentCoords.x, adjacentCoords.y, system._procGenData.biomeCoordinateCache);
            diagonalBiomesForCheck = checkDiagonalMapBiomesFromCache(adjacentCoords.x, adjacentCoords.y, system._procGenData.biomeCoordinateCache);
        }

        // A homogeneous planet has no biome transitions, so beach/island tile
        // substitution (which only makes sense at a coastline) never applies.
        system._procGenData.displayAsBeach  = alienBiome ? false : shouldDisplayAsBeach(biomeName, adjacentBiomesForNewTile, diagonalBiomesForCheck);
        system._procGenData.displayAsIsland = alienBiome ? false : (shouldDisplayAsIsland ? shouldDisplayAsIsland(biomeName, adjacentBiomesForNewTile) : false);

        const worldCoords = { x: adjacentCoords.x, y: adjacentCoords.y };
        system._procGenData.generatedMapData = generateProceduralTerrain(
            biome, seed, roadDirection, adjacentBiomesForNewTile,
            cacheInfoForCheck, worldCoords, system._procGenData.biomeCoordinateCache
        );
        console.log(`[WorldMapReturn-Edge] Terrain generation complete`);

        updateBiomeAudio();

        const edgePos = system.getEdgeCoordinateForDirection(storedExitDir, storedPlayerX, storedPlayerY);
        console.log(`[WorldMapReturn-Edge] Transferring to (${edgePos.x},${edgePos.y})`);
        $gamePlayer.reserveTransfer(procMapId, edgePos.x, edgePos.y, storedExitDir, 0);
    }

    // Trigger edge transition callback once the screen is fully black
    const _Game_Screen_update = Game_Screen.prototype.update;
    Game_Screen.prototype.update = function() {
        _Game_Screen_update.call(this);
        if ($gameSystem._procGenData &&
            $gameSystem._procGenData._edgeTransitionScheduled &&
            $gameSystem._procGenData._edgeTransitionCallback &&
            !$gameSystem._procGenData._edgeTransitionDispatching &&
            this._brightness === 0) {
            // Mark as dispatching so the per-frame update does not queue a second
            // timeout while this one is pending. Wrap in try/catch so a generator
            // exception can never leave the screen faded out with no fade-in.
            $gameSystem._procGenData._edgeTransitionDispatching = true;
            const cb = $gameSystem._procGenData._edgeTransitionCallback;
            setTimeout(() => {
                try {
                    cb();
                } catch (e) {
                    console.error(`[Game_Screen.update] Edge transition failed, fading back in`, e);
                    $gameScreen.startFadeIn(10);
                } finally {
                    if ($gameSystem._procGenData) {
                        $gameSystem._procGenData._edgeTransitionScheduled  = false;
                        $gameSystem._procGenData._edgeTransitionDispatching = false;
                    }
                }
            }, 13);
        }
    };

    // ============================================================================
    // PLUGIN COMMANDS (WorldMapReturn)
    // ============================================================================

    PluginManager.registerCommand(PLUGIN_NAME, 'ReturnToWorldMap', () => {
        const saved = playerWorldCoords();
        if (saved.x === 0 && saved.y === 0) return;
        $gameVariables.setValue(VAR_DEST_MAP, worldMapId);
        $gamePlayer.reserveTransfer(worldMapId, saved.x, saved.y, 0, 0);
    });

    PluginManager.registerCommand(PLUGIN_NAME, 'SaveWorldMapPosition', function() {
        if ($gameMap.mapId() !== worldMapId) return;
        let posX = $gamePlayer.x, posY = $gamePlayer.y;
        if (this._eventId !== undefined) {
            const event = $gameMap.event(this._eventId);
            if (event) { posX = event.x; posY = event.y; }
        }
        $gameVariables.setValue(VAR_WORLD_X, posX);
        $gameVariables.setValue(VAR_WORLD_Y, posY);
    });

    PluginManager.registerCommand(PLUGIN_NAME, 'SetWorldMapCoordinates', args => {
        const x = parseInt(args.x), y = parseInt(args.y);
        if (isNaN(x) || isNaN(y) || x < 0 || y < 0) return;
        $gameVariables.setValue(VAR_WORLD_X, x);
        $gameVariables.setValue(VAR_WORLD_Y, y);
    });

    // ============================================================================
    // PLUGIN COMMANDS (goDown / goUp / startProcGen / stopProcGen / switchLayer)
    // ============================================================================

    PluginManager.registerCommand(PLUGIN_PMT, 'startProcGen', () => {
        if (!$gameSystem.generateProceduralMap()) return;
        const playerDirection = $gamePlayer.direction();
        let startX = Math.floor(PROC_MAP_WIDTH  / 2);
        let startY = Math.floor(PROC_MAP_HEIGHT / 2);
        switch (playerDirection) {
            case 2: startY = 1;                  break;
            case 4: startX = PROC_MAP_WIDTH  - 2; break;
            case 6: startX = 1;                  break;
            case 8: startY = PROC_MAP_HEIGHT - 2; break;
        }
        $gameVariables.setValue(110, 1);
        $gameVariables.setValue(111, 1);
        $gamePlayer.reserveTransfer(procMapId, startX, startY, playerDirection, 0);
    });

    PluginManager.registerCommand(PLUGIN_PMT, 'stopProcGen', () => {
        const system       = $gameSystem;
        const returnCoords = system.getReturnCoordinates($gamePlayer.direction());
        system.clearProcGenData();
        $gamePlayer.reserveTransfer(worldMapId, returnCoords.x, returnCoords.y, 2, 0);
    });

    PluginManager.registerCommand(PLUGIN_PMT, 'goDown', () => {
        const system      = $gameSystem;
        const procGenData = system._procGenData;
        if (!procGenData) { logWarn('GoDown: no procedural map active.'); return; }

        if (procGenData && procGenData.currentBiome === 'Ocean') {  // i18n-ignore  biome id
            const item = $dataItems[DIVING_SUIT_ITEM_ID];
            if (!$gameParty.hasItem(item)) { $gameMessage.add(T('WorldMapReturn.needDivingSuit')); return; }
        }
        if (procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0) {
            logWarn('GoDown: Already underground.'); return;
        }
        if (!procGenData.currentBiome) procGenData.currentBiome = 'Cave';

        const currentBiome = getBiomeByName(procGenData.currentBiome);
        if (!currentBiome || !currentBiome.lowerLayer) {
            logWarn(`GoDown: Biome "${procGenData.currentBiome}" has no lower layer`); return;
        }

        // Keep the surface square before the cave overwrites it, so climbing back
        // out puts back the very tiles and prefabs the party left behind.
        stashSurfaceSnapshot(procGenData);

        procGenData.biomeLayerStack.push(procGenData.currentBiome);
        let lowerBiomeName = currentBiome.lowerLayer;
        if (procGenData.displayAsBeach) lowerBiomeName = 'CaveFlooded';

        const lowerBiome = getBiomeByName(lowerBiomeName);
        if (!lowerBiome) {
            logWarn(`GoDown: Lower biome "${lowerBiomeName}" not found`);
            procGenData.biomeLayerStack.pop(); return;
        }

        procGenData.currentBiome           = lowerBiomeName;
        procGenData.currentBiomeTileset    = lowerBiome.tilesetId;
        procGenData.biomeDayTemperature    = lowerBiome.dayTemperature   || 20;
        procGenData.biomeNightTemperature  = lowerBiome.nightTemperature || 10;

        const seed = procMapSeed(procGenData.originX, procGenData.originY, procGenData.biomeLayerStack.length);
        const adjacentBiomes = { north: lowerBiomeName, south: lowerBiomeName, east: lowerBiomeName, west: lowerBiomeName };
        procGenData.displayAsBeach = false;

        const worldCoords = { x: procGenData.originX, y: procGenData.originY };
        procGenData.generatedMapData = generateProceduralTerrain(lowerBiome, seed, null, adjacentBiomes, null, worldCoords, procGenData.biomeCoordinateCache);

        $gameScreen.clearWeather();
        $gameScreen.startFadeOut(10);
        if (window.SplitScreenManager && window.SplitScreenManager.active) window.SplitScreenManager.forceP2Teleport = true;
        $gamePlayer.reserveTransfer(procMapId, Math.floor(PROC_MAP_WIDTH / 2), Math.floor(PROC_MAP_HEIGHT / 2), $gamePlayer.direction(), 0);

        setTimeout(() => updateEventVisibility(), 100);
        setTimeout(() => refreshEnemiesForBiome(), 100);
        setTimeout(() => updateBiomeAudio(), 100);
        setTimeout(() => { $gameScreen.startFadeIn(10); }, 150);
    });

    // ── DoorDungeon feature descent ─────────────────────────────────────────
    // Resolve the dungeon-type biome a DoorDungeon leads to from the surface
    // biome's lowerLayer:
    //   - a Cave-family lower layer (Cave, CaveIce, CaveFlooded, ...) or none
    //     -> "Dungeon" (a DoorDungeon always opens onto a built dungeon, never a
    //        natural cave)
    //   - "Crypt"  -> Crypt,  "Sewer" -> Sewer,  and so on for any other
    //     dungeon-flavoured lower layer, which is generated as-is.
    function resolveDungeonBiomeName(surfaceBiome) {
        let target = (surfaceBiome && surfaceBiome.lowerLayer) || 'Dungeon';
        if (/cave/i.test(target)) target = 'Dungeon';
        return target;
    }

    // Enter a procedural, coordinate-seeded dungeon through a DoorDungeon tile on
    // the procedural map. Behaves like goDown (pushes a layer so "Go to the
    // surface" returns), but forces the resolved dungeon-type biome instead of
    // the biome's natural cave lower layer, and returns the player to the door.
    PluginManager.registerCommand(PLUGIN_PMT, 'enterDungeonDoor', () => {
        const system      = $gameSystem;
        const procGenData = system._procGenData;
        if (!procGenData) { logWarn('DoorDungeon: no procedural map active.'); return; }

        if (procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0) {
            logWarn('DoorDungeon: Already underground.'); return;
        }
        if (!procGenData.currentBiome) procGenData.currentBiome = 'Fields';

        const surfaceBiome  = getBiomeByName(procGenData.currentBiome);
        const lowerBiomeName = resolveDungeonBiomeName(surfaceBiome);
        const lowerBiome     = getBiomeByName(lowerBiomeName);
        if (!lowerBiome) {
            logWarn(`DoorDungeon: Dungeon biome "${lowerBiomeName}" not found`); return;
        }

        // Keep the surface square before the dungeon overwrites it. A dungeon door
        // is very often a tile of a prefab (the mountain, the ruin, the mausoleum
        // it was cut into), and re-rolling the surface on the way out is what used
        // to take the whole prefab -- door included -- away with it.
        stashSurfaceSnapshot(procGenData);

        // Return the player to the door on "Go to the surface".
        procGenData.goDownEventX = $gamePlayer.x;
        procGenData.goDownEventY = $gamePlayer.y;

        procGenData.biomeLayerStack.push(procGenData.currentBiome);
        procGenData.currentBiome          = lowerBiomeName;
        procGenData.currentBiomeTileset   = lowerBiome.tilesetId;
        procGenData.biomeDayTemperature   = lowerBiome.dayTemperature   || 20;
        procGenData.biomeNightTemperature = lowerBiome.nightTemperature || 10;

        // Seed from the world coordinates AND the door tile, so different doors on
        // the same map open onto different, but deterministic, dungeons.
        const seed = procMapSeed(
            procGenData.originX, procGenData.originY,
            procGenData.biomeLayerStack.length,
            (procGenData.goDownEventX * 131) + (procGenData.goDownEventY * 977)
        );
        const adjacentBiomes = { north: lowerBiomeName, south: lowerBiomeName, east: lowerBiomeName, west: lowerBiomeName };
        procGenData.displayAsBeach = false;

        const worldCoords = { x: procGenData.originX, y: procGenData.originY };
        procGenData.generatedMapData = generateProceduralTerrain(lowerBiome, seed, null, adjacentBiomes, null, worldCoords, procGenData.biomeCoordinateCache);

        // Mark this as a door-entered dungeon so stepping on the map border pops
        // back to the surface at the tile just south of the DoorDungeon (goUp,
        // which returns to goDownEventX/Y set above), instead of biome-edge travel.
        // The door tile salts the terrain records as well as the seed, so two
        // doors on one square keep their own dismantled features apart.
        procGenData._dungeonSession = {
            type: 'door',
            salt: ((procGenData.goDownEventX * 131) + (procGenData.goDownEventY * 977)) | 0,
        };

        // Spawn the player next to the entrance carved at the border.
        const gen = procGenData.generatedMapData;
        const sx = (gen && gen.spawnX != null) ? gen.spawnX : Math.floor(PROC_MAP_WIDTH / 2);
        const sy = (gen && gen.spawnY != null) ? gen.spawnY : Math.floor(PROC_MAP_HEIGHT / 2);
        const sdir = (gen && gen.spawnDir) ? gen.spawnDir : $gamePlayer.direction();

        $gameScreen.clearWeather();
        $gameScreen.startFadeOut(10);
        if (window.SplitScreenManager && window.SplitScreenManager.active) window.SplitScreenManager.forceP2Teleport = true;
        $gamePlayer.reserveTransfer(procMapId, sx, sy, sdir, 0);

        setTimeout(() => updateEventVisibility(), 100);
        setTimeout(() => refreshEnemiesForBiome(), 100);
        setTimeout(() => updateBiomeAudio(), 100);
        setTimeout(() => { $gameScreen.startFadeIn(10); }, 150);
    });

    // Generate an arbitrary biome as a fresh top-level procedural map and teleport
    // into it immediately (used by Sandbox Mode to jump straight into a Dungeon,
    // Crypt, Sewer, ... regardless of the player's world position).
    PluginManager.registerCommand(PLUGIN_PMT, 'startForcedBiome', args => {
        const biomeName = (args && args.Biome) ? String(args.Biome).trim() : 'Dungeon';
        const biome     = getBiomeByName(biomeName);
        if (!biome) { logWarn(`startForcedBiome: biome "${biomeName}" not found`); return; }

        // Remember where the player was so a dungeon generated from Sandbox Mode can
        // return them there when they step on the dungeon border.
        const returnFrom = { mapId: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, dir: $gamePlayer.direction() };

        // Entered off the procedural map (a Grate, a flight of stairs, a cave
        // mouth, a patron's hatch): snapshot the square itself, tiles included,
        // BEFORE anything below overwrites the live description with the
        // structure's. The border of the generated map hands it straight back.
        const surface = $gameMap.mapId() === procMapId
            ? snapshotProcSurface({ terrain: true })
            : null;

        // The caller's salt tells two entrances of the same kind on the same world
        // square apart (two grates open onto two different sewers). It also keys
        // the structure's terrain records, so nothing dismantled in one leaks into
        // the other.
        const entranceSalt = (args && args.Salt != null) ? (Number(args.Salt) | 0) : 0;

        const system = $gameSystem;
        if (!system._procGenData) {
            system._procGenData = {
                originX: 0, originY: 0, currentBiome: null, currentRoadDirection: null,
                currentBiomeTileset: null, generatedMapData: null, biomeToTileset: {},
                mapPreloaded: false, seed: 12345, biomeCoordinateCache: {},
                lastLoadedProcMapX: null, lastLoadedProcMapY: null, displayAsBeach: false,
                biomeLayerStack: [],
            };
        }
        const pg = system._procGenData;

        // Establish a valid world origin + seed. On the world map,
        // generateProceduralMap syncs vars 43/44, seed and the biome cache;
        // elsewhere fall back to the stored / variable coordinates.
        if ($gameMap && $gameMap.mapId() === worldMapId && system.generateProceduralMap) {
            system.generateProceduralMap();
        }
        if (!pg.originX && !pg.originY) {
            pg.originX = $gameVariables.value(VAR_WORLD_X) || $gamePlayer.x || 0;
            pg.originY = $gameVariables.value(VAR_WORLD_Y) || $gamePlayer.y || 0;
        }
        if (!pg.seed) pg.seed = 12345;

        // Force the chosen biome as a fresh, non-underground procedural map.
        pg.biomeLayerStack      = [];
        pg.currentBiome         = biomeName;
        pg.currentRoadDirection = null;
        pg.currentBiomeTileset  = biome.tilesetId;
        pg.biomeDayTemperature  = biome.dayTemperature   || 20;
        pg.biomeNightTemperature = biome.nightTemperature || 10;
        pg.displayAsBeach       = false;
        pg.displayAsIsland      = false;

        // Salted with the forced biome's name so a sandbox Dungeon and a sandbox
        // Crypt at the same world square are not the same layout, then with the
        // caller's entrance salt so two doorways of the same kind are not either.
        let biomeSalt = 0;
        for (let i = 0; i < biomeName.length; i++) biomeSalt = (Math.imul(biomeSalt, 31) + biomeName.charCodeAt(i)) | 0;
        if (entranceSalt) biomeSalt = (Math.imul(biomeSalt, 31) + entranceSalt) | 0;
        const seed = procMapSeed(pg.originX, pg.originY, 0, biomeSalt);
        const adjacentBiomes = { north: biomeName, south: biomeName, east: biomeName, west: biomeName };
        const worldCoords = { x: pg.originX, y: pg.originY };
        // DungeonFloorSystem's lower tower has no way off a floor but its own
        // staircase events: read once and cleared here so the flag never
        // survives into an unrelated forced biome.
        if (pg._sealEntrance) {
            worldCoords.sealEntrance = true;
            pg._sealEntrance = false;
        }
        pg.generatedMapData = generateProceduralTerrain(biome, seed, null, adjacentBiomes, null, worldCoords, pg.biomeCoordinateCache);

        // For a dungeon-family biome (incl. the LootCellar/TempleInside/CaveDen/
        // PatronVault structure biomes entered through terrain features), spawn at
        // the border entrance and make the map border return the player to where
        // the structure was entered from.
        const gen = pg.generatedMapData;
        // Is this one of the enclosed structures? The catalogue in
        // ProceduralMapStructureGenerator is the only list, so a structure
        // added there needs no edit here; the regex this replaced was one of
        // six such lists scattered over the codebase and they had drifted.
        const D = window.ProcGenDungeon;
        const isDungeonType = (D && typeof D.isStructure === 'function')
            ? D.isStructure(biomeName)
            : /dungeon|crypt|sewer|lootcellar|templeinside|caveden|patronvault/i.test(biomeName);
        const sx = (isDungeonType && gen && gen.spawnX != null) ? gen.spawnX : Math.floor(PROC_MAP_WIDTH / 2);
        const sy = (isDungeonType && gen && gen.spawnY != null) ? gen.spawnY : Math.floor(PROC_MAP_HEIGHT / 2);
        const sdir = (isDungeonType && gen && gen.spawnDir) ? gen.spawnDir : $gamePlayer.direction();
        pg._dungeonSession = isDungeonType
            ? { type: 'sandbox', salt: entranceSalt, surface, ...returnFrom }
            : null;

        $gameVariables.setValue(110, 1);
        $gameVariables.setValue(111, 1);
        $gameScreen.clearWeather();
        $gameScreen.startFadeOut(10);
        if (window.SplitScreenManager && window.SplitScreenManager.active) window.SplitScreenManager.forceP2Teleport = true;
        $gamePlayer.reserveTransfer(procMapId, sx, sy, sdir, 0);

        setTimeout(() => updateEventVisibility(), 100);
        setTimeout(() => refreshEnemiesForBiome(), 100);
        setTimeout(() => updateBiomeAudio(), 100);
        setTimeout(() => { $gameScreen.startFadeIn(10); }, 150);
    });

    PluginManager.registerCommand(PLUGIN_PMT, 'goUp', () => {
        const system      = $gameSystem;
        const procGenData = system._procGenData;
        if (!procGenData) { logWarn('GoUp: no procedural map active.'); return; }

        if (!procGenData.biomeLayerStack || procGenData.biomeLayerStack.length === 0) {
            logWarn('GoUp: Not underground.'); return;
        }

        const previousBiomeName = procGenData.biomeLayerStack.pop();
        const previousBiome     = getBiomeByName(previousBiomeName);
        if (!previousBiome) { logWarn(`GoUp: Previous biome "${previousBiomeName}" not found`); return; }

        // The door the party came down by, read BEFORE the square is put back:
        // restoring a snapshot restores its stored entrance coordinates too, and
        // those predate this descent.
        const goDownX = procGenData.goDownEventX || 64, goDownY = procGenData.goDownEventY || 64;

        // Surfacing ends any door-dungeon session so the surface border resumes
        // normal biome-edge travel.
        if (procGenData.biomeLayerStack.length === 0) procGenData._dungeonSession = null;

        procGenData.currentBiome          = previousBiomeName;
        procGenData.currentBiomeTileset   = previousBiome.tilesetId;
        procGenData.biomeDayTemperature   = previousBiome.dayTemperature   || 20;
        procGenData.biomeNightTemperature = previousBiome.nightTemperature || 10;

        // The square the descent was started from, exactly as it was left. Only
        // when there is none (a save from before descents kept one) is it rebuilt
        // from its canonical seed, which reproduces the layout but not any prefab
        // that was standing on it.
        if (!popSurfaceSnapshot(procGenData, previousBiomeName)) {
            rebuildSurfaceFromSeed(procGenData, previousBiomeName, previousBiome);
        }

        $gameScreen.clearWeather();
        $gameScreen.startFadeOut(10);
        if (window.SplitScreenManager && window.SplitScreenManager.active) window.SplitScreenManager.forceP2Teleport = true;
        $gamePlayer.reserveTransfer(procMapId, goDownX, goDownY, $gamePlayer.direction(), 0);

        setTimeout(() => updateEventVisibility(), 100);
        setTimeout(() => refreshEnemiesForBiome(), 100);
        setTimeout(() => updateBiomeAudio(), 100);
        setTimeout(() => { $gameScreen.startFadeIn(10); }, 150);
    });

    PluginManager.registerCommand(PLUGIN_PMT, 'switchLayer', () => {
        const system      = $gameSystem;
        const procGenData = system._procGenData;
        if (!procGenData) return;

        const isUnderground = procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0;
        const playerX       = $gamePlayer.x, playerY = $gamePlayer.y, playerDir = $gamePlayer.direction();

        if (isUnderground) {
            const previousBiomeName = procGenData.biomeLayerStack.pop();
            const previousBiome     = getBiomeByName(previousBiomeName);
            if (!previousBiome) { logWarn(`switchLayer: Previous biome "${previousBiomeName}" not found`); return; }

            procGenData.currentBiome          = previousBiomeName;
            procGenData.currentBiomeTileset   = previousBiome.tilesetId;
            procGenData.biomeDayTemperature   = previousBiome.dayTemperature   || 20;
            procGenData.biomeNightTemperature = previousBiome.nightTemperature || 10;

            // Same rule as goUp: the square that was descended from is handed
            // back whole, and only rebuilt from the seed when none was kept.
            if (!popSurfaceSnapshot(procGenData, previousBiomeName)) {
                rebuildSurfaceFromSeed(procGenData, previousBiomeName, previousBiome);
            }

            $gameScreen.clearWeather(); $gameScreen.startFadeOut(10);
            if (window.SplitScreenManager && window.SplitScreenManager.active) window.SplitScreenManager.forceP2Teleport = true;
            $gamePlayer.reserveTransfer(procMapId, playerX, playerY, playerDir, 0);
            setTimeout(() => updateEventVisibility(), 100);
            setTimeout(() => refreshEnemiesForBiome(), 100);
            setTimeout(() => updateBiomeAudio(), 100);
            setTimeout(() => { $gameScreen.startFadeIn(10); }, 150);

        } else {
            if (!procGenData.currentBiome) procGenData.currentBiome = 'Cave';
            const currentBiome = getBiomeByName(procGenData.currentBiome);
            if (!currentBiome || !currentBiome.lowerLayer) {
                logWarn(`switchLayer: Biome "${procGenData.currentBiome}" has no lower layer`); return;
            }
            if (procGenData.currentBiome === 'Ocean') {  // i18n-ignore  biome id
                const item = $dataItems[DIVING_SUIT_ITEM_ID];
                if (!$gameParty.hasItem(item)) { $gameMessage.add(T('WorldMapReturn.needDivingSuit')); return; }
            }

            // Keep the surface square before the lower layer overwrites it.
            stashSurfaceSnapshot(procGenData);

            procGenData.biomeLayerStack.push(procGenData.currentBiome);
            let lowerBiomeName = currentBiome.lowerLayer;
            if (procGenData.displayAsBeach) lowerBiomeName = 'CaveFlooded';

            const lowerBiome = getBiomeByName(lowerBiomeName);
            if (!lowerBiome) {
                logWarn(`switchLayer: Lower biome "${lowerBiomeName}" not found`);
                procGenData.biomeLayerStack.pop(); return;
            }

            procGenData.currentBiome          = lowerBiomeName;
            procGenData.currentBiomeTileset   = lowerBiome.tilesetId;
            procGenData.biomeDayTemperature   = lowerBiome.dayTemperature   || 20;
            procGenData.biomeNightTemperature = lowerBiome.nightTemperature || 10;

            const seed = procMapSeed(procGenData.originX, procGenData.originY, procGenData.biomeLayerStack.length);
            const adjacentBiomes = $gameMap.mapId() === PROC_MAP_ID
                ? { north: lowerBiomeName, south: lowerBiomeName, east: lowerBiomeName, west: lowerBiomeName }
                : null;
            procGenData.displayAsBeach = false;

            const worldCoords = { x: procGenData.originX, y: procGenData.originY };
            procGenData.generatedMapData = generateProceduralTerrain(lowerBiome, seed, null, adjacentBiomes, null, worldCoords, procGenData.biomeCoordinateCache);

            $gameScreen.clearWeather(); $gameScreen.startFadeOut(10);
            if (window.SplitScreenManager && window.SplitScreenManager.active) window.SplitScreenManager.forceP2Teleport = true;
            $gamePlayer.reserveTransfer(procMapId, playerX, playerY, playerDir, 0);
            setTimeout(() => updateEventVisibility(), 100);
            setTimeout(() => refreshEnemiesForBiome(), 100);
            setTimeout(() => updateBiomeAudio(), 100);
            setTimeout(() => { $gameScreen.startFadeIn(10); }, 150);
        }
    });

    // ============================================================================
    // SHARED TRAVEL LOGIC
    // ============================================================================

    function performStopTravel() {
        // When CamperDrivingSystem is active, vars 43/44 are kept current by the
        // waypoint system. $gamePlayer.x/y is stuck at the ship's parked tile,
        // so do NOT overwrite the correct coords with the stale tile position.
        const camperDriving = window.CamperDrivingSystem && window.CamperDrivingSystem.isActive();

        if ($gameMap.mapId() === worldMapId && !camperDriving) {
            $gameVariables.setValue(VAR_WORLD_X, $gamePlayer.x);
            $gameVariables.setValue(VAR_WORLD_Y, $gamePlayer.y);
        }

        const currentX = $gameVariables.value(VAR_WORLD_X);
        const currentY = $gameVariables.value(VAR_WORLD_Y);
        const NON_PROCEDURAL_COORDS = getWorldMapCoordinates();

        console.log('[WMR] Checking position:', currentX, currentY);

        // Bologna is authored as a dedicated OSM tile grid (BolognaMapSystem),
        // not a procedural biome. Stopping on a Bologna world-map tile hands off
        // to that system's centre cell (r7 c6) instead of generating proc terrain.
        const hardcodedName = window.WorldGen && window.WorldGen.HardcodedBiomeNames
            ? window.WorldGen.HardcodedBiomeNames[`${currentX},${currentY}`]
            : null;
        if (hardcodedName === 'Bologna' && window.BolognaMapSystem) {  // i18n-ignore  HardcodedBiomeNames entry
            if (camperDriving) window.CamperDrivingSystem.stop();
            window.BolognaMapSystem.teleportToCell(7, 6);
            return;
        }

        // `coords` (a door per side of the town's footprint) takes priority;
        // any other square inside the town's `reservedTiles` falls back to
        // its single fixed `entrance`, whatever direction it was crossed from.
        const currentMapCoord = parseInt(currentX) + ',' + parseInt(currentY);
        for (const key in NON_PROCEDURAL_COORDS) {
            const location = NON_PROCEDURAL_COORDS[key];
            const coords = Array.isArray(location.coords) ? location.coords : null;
            const onCoords = coords && coords.some(c => c.mapCoord === currentMapCoord);
            const onReserved = Array.isArray(location.reservedTiles) &&
                location.reservedTiles.includes(currentMapCoord);
            if (!onCoords && !onReserved) continue;

            const direction = $gamePlayer.direction();
            let destination = null;
            if (onCoords) {
                const directionName = { 2: 'south', 4: 'west', 6: 'east', 8: 'north' }[direction];
                destination = directionName && coords.find(c => c.direction === directionName);
            } else if (location.entrance && location.entrance.id) {
                destination = location.entrance;
            }

            if (destination) {
                console.log('[WMR] Transferring to map', destination.id, 'at', destination.x, destination.y);
                if (camperDriving) window.CamperDrivingSystem.stop();
                $gamePlayer.reserveTransfer(destination.id, destination.x, destination.y, 0, 0);
            } else {
                console.log('[WMR] No destination for direction', direction);
            }
            return;
        }

        console.log('[WMR] No non-proc match, generating procedural map');

        if ($gameSystem.generateProceduralMap) {
            if ($gameSystem.generateProceduralMap()) {
                // Stopping on a "???" tile arms a single random encounter, consumed
                // when the procedural map finishes loading (updateEventVisibility).
                $gameTemp._mysteryEncounterPending =
                    !!(mysteryTiles && mysteryTiles.has(currentX + ',' + currentY));
                if (camperDriving) window.CamperDrivingSystem.stop();
                const playerDirection = $gamePlayer.direction();
                let startX = Math.floor(PROC_MAP_WIDTH  / 2);
                let startY = Math.floor(PROC_MAP_HEIGHT / 2);
                switch (playerDirection) {
                    case 2: startY = 1;                   break;
                    case 4: startX = PROC_MAP_WIDTH  - 2; break;
                    case 6: startX = 1;                   break;
                    case 8: startY = PROC_MAP_HEIGHT - 2; break;
                }
                $gameVariables.setValue(110, 1);
                $gameVariables.setValue(111, 1);
                $gamePlayer.reserveTransfer(procMapId, startX, startY, playerDirection, 0);
            }
        }
    }

    // ============================================================================
    // WINDOW: WORLD MAP CHOICE (parchment submenu from menu)
    // ============================================================================

    function Window_WorldMapChoice() { this.initialize(...arguments); }
    Window_WorldMapChoice.prototype              = Object.create(Window_Command.prototype);
    Window_WorldMapChoice.prototype.constructor  = Window_WorldMapChoice;

    Window_WorldMapChoice.prototype.initialize = function(rect) {
        Window_Command.prototype.initialize.call(this, rect);
        this.hide();
        this.deactivate();
        this.createUIParchment();
    };

    Window_WorldMapChoice.prototype.update = function() {
        Window_Command.prototype.update.call(this);
        if (!this._dndParchmentSprite) {
            this.createUIParchment();
        } else if (this._dndParchmentSprite.bitmap &&
                   (this._dndParchmentSprite.bitmap.width  !== this.width ||
                    this._dndParchmentSprite.bitmap.height !== this.height)) {
            this.refreshUIParchment();
        }
    };

    Window_WorldMapChoice.prototype.move = function(_x, _y, width, height) {
        const sizeChanged = this.width !== width || this.height !== height;
        Window_Command.prototype.move.apply(this, arguments);
        if (sizeChanged && this._dndParchmentSprite) this.refreshUIParchment();
    };

    Window_WorldMapChoice.prototype._refreshBack  = function() {};
    Window_WorldMapChoice.prototype._refreshFrame = function() {};

    Window_WorldMapChoice.prototype.createUIParchment = function() {
        if (this._dndParchmentSprite) this.removeChild(this._dndParchmentSprite);
        this._dndParchmentSprite = new Sprite();
        this.addChildAt(this._dndParchmentSprite, 0);
        this.refreshUIParchment();
    };

    Window_WorldMapChoice.prototype.refreshUIParchment = function() {
        const w = this.width, h = this.height;
        if (w <= 0 || h <= 0) return;
        const bitmap = new Bitmap(w, h);
        const ctx    = bitmap.context;

        ctx.fillStyle = '#ecdcb9';
        const radius  = 6;
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(w - radius, 0);
        ctx.quadraticCurveTo(w, 0, w, radius);
        ctx.lineTo(w, h - radius);
        ctx.quadraticCurveTo(w, h, w - radius, h);
        ctx.lineTo(radius, h);
        ctx.quadraticCurveTo(0, h, 0, h - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(139, 90, 43, 0.04)';
        ctx.fillRect(0, 0, w, h);

        const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) / 4, w / 2, h / 2, Math.max(w, h) / 2);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, 'rgba(78, 38, 12, 0.12)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#4a2711';
        ctx.lineWidth   = 3;
        ctx.strokeRect(3, 3, w - 6, h - 6);
        ctx.lineWidth   = 1;
        ctx.strokeStyle = 'rgba(74, 39, 17, 0.5)';
        ctx.strokeRect(7, 7, w - 14, h - 14);

        this._dndParchmentSprite.bitmap = bitmap;
    };

    Window_WorldMapChoice.prototype.resetFontSettings = function() {
        Window_Command.prototype.resetFontSettings.call(this);
        this.contents.fontFace = 'Lora';
    };

    Window_WorldMapChoice.prototype.resetTextColor = function() {
        this.changeTextColor('#1a1a1a');
    };

    Window_WorldMapChoice.prototype.makeCommandList = function() {
        // The same row does two jobs: on Earth it goes back to the world map, on
        // another planet it opens the landing-site picker (see commandWorldMap).
        this.addCommand(
            isAlienSurfaceNow() ? T('WorldMapReturn.chooseLandingSite')
                                : T('WorldMapReturn.returnToWorldMap'),
            'return');
        if ($gameMap.mapId() === procMapId) {
            const procGenData   = $gameSystem._procGenData;
            const isUnderground = procGenData && procGenData.biomeLayerStack && procGenData.biomeLayerStack.length > 0;
            const currentBiome  = procGenData && procGenData.currentBiome && window.ProcGenUtils
                ? window.ProcGenUtils.getBiomeByName(procGenData.currentBiome) : null;
            const hasUnderground = currentBiome && currentBiome.lowerLayer;
            if (isUnderground)       this.addCommand(T('WorldMapReturn.goToSurface'), 'goUp');
            else if (hasUnderground) this.addCommand(T('WorldMapReturn.goUnderground'), 'goDown');
        }
        this.addCommand(T('WorldMapReturn.toggleWorldMap'), 'toggleMinimap');
        this.addCommand(T('WorldMapReturn.openWorldMap'), 'open');
        this.addCommand(T('WorldMapReturn.cancel'), 'cancel');
    };

    Window_WorldMapChoice.prototype.itemTextAlign = function() { return 'center'; };

    // ============================================================================
    // SCENE MAP EXTENSIONS
    // ============================================================================

    // Map the previous onMapLoaded ran for, so a transfer can be told apart from
    // a plain scene rebuild (closing the menu re-creates Scene_Map on the same map).
    let _lastLoadedMapId = 0;

    const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function() {
        _Scene_Map_onMapLoaded.call(this);

        // The party's world square, re-derived from the map they are now on. The
        // engine's own transfer has already run inside the call above, so the
        // player stands on their arrival tile by this point. Every route in goes
        // through here: a border crossing, an event transfer, fast travel, a
        // vehicle put down, a house or a cellar left behind.
        syncPlayerWorldCoords($gameMap.mapId());

        // Clear stale border arrows
        if ($gamePlayer) $gamePlayer.clearBorderArrows();
        if ($gamePlayer) $gamePlayer.clearProcGenBorderArrows();
        if ($gamePlayer) $gamePlayer.clearP2Arrows();

        // Apply proc map tileset if we just transferred to map 636
        if ($gameMap.mapId() === procMapId && $gameSystem.applyProceduralMapTileset) {
            $gameSystem.applyProceduralMapTileset();
        }

        // Build biome cache on world map load
        if ($gameMap.mapId() === WORLD_MAP_ID && $gameSystem._procGenData) {
            if (!$gameSystem._procGenData.biomeCoordinateCache ||
                Object.keys($gameSystem._procGenData.biomeCoordinateCache).length === 0) {
                console.log(`[Scene_Map.onMapLoaded] World map loaded, building biome cache...`);
                buildBiomeCoordinateCache($gameSystem, $gameMap, WORLD_MAP_ID);
                console.log(`[Scene_Map.onMapLoaded] Biome cache built`);
            }
        }

        // Refresh proc map on load
        if ($gameMap.mapId() === PROC_MAP_ID &&
            $gameSystem._procGenData &&
            $gameSystem._procGenData.generatedMapData) {
            // Never strand the player on a non-passable tile after a transfer.
            ensurePlayerOnStandableTile();
            if (this._tilemap) {
                const procGenData   = $gameSystem._procGenData;
                const biomeObj      = getBiomeByName(procGenData.currentBiome);
                const tilesetId     = biomeObj ? biomeObj.tilesetId : 1;
                const tilesetData   = $dataTilesets[tilesetId];
                const tilesetName   = tilesetData ? tilesetData.name : $gameMap.tileset().name;
                this._tilemap.setTileBitmap(0, ImageManager.loadTileset(tilesetName));
                this._tilemap.refresh();
            }
            if (this._spriteset) this._spriteset.update();

            if (placeChestEvents) placeChestEvents();
            if (placeSpikeTrapEvents) placeSpikeTrapEvents();
            if (placeDungeonDoorEvents) placeDungeonDoorEvents();
            if (placeKeyChestEvents) placeKeyChestEvents();
            if (placePolicemanEvents) placePolicemanEvents();
            updateEventVisibility();
            console.log(`[Scene_Map.onMapLoaded] Procedural map loaded, refreshing enemies`);
            refreshEnemiesForBiome();
            // Entering a square from the world map (or from a house / dungeon /
            // vehicle) is a fresh arrival, so re-resolve the biome track here as
            // well as on border crossings. The pick is deterministic, so this is
            // a no-op whenever the correct track is already playing.
            updateBiomeAudio();

            setTimeout(() => {
                $gameScreen.startFadeIn(10);
                console.log(`[Scene_Map.onMapLoaded] Fading in for new biome`);
            }, 100);
        }

        // Surfacing back onto the world map: the overview has no music of its own
        // (map 315 keeps BGM autoplay off) and its ambience is a silent placeholder,
        // so the biome track and room tone the party was hearing down in the
        // procedural map must not bleed into it. Clear both.
        if ($gameMap.mapId() === WORLD_MAP_ID) {
            if (_lastLoadedMapId === PROC_MAP_ID) AudioManager.stopBgm();
            // Ambience is silenced on arrival from ANY map (house, dungeon, city,
            // vehicle interior, ...), never just the procedural one, so nothing but
            // the weather is heard over the overview.
            stopAllBgsExceptWeather();
            console.log('[Scene_Map.onMapLoaded] Back on the world map, cleared BGS (weather kept)');
        }
        _lastLoadedMapId = $gameMap.mapId();

        // Update audio for non-proc maps with biome notes
        if ($gameMap.mapId() !== PROC_MAP_ID && $gameMap.mapId() !== WORLD_MAP_ID) {
            if ($dataMap && ($dataMap.note || ($dataMap.meta && $dataMap.meta.Biome))) {
                const noteMatch = $dataMap.note ? $dataMap.note.match(/<Biome:\s*(.+?)>/i) : null;
                const metaBiome = $dataMap.meta ? $dataMap.meta.Biome : null;
                if (noteMatch || metaBiome) {
                    setTimeout(() => {
                        updateBiomeAudio();
                        console.log(`[Scene_Map.onMapLoaded] Updated audio for map ${$gameMap.mapId()}`);
                    }, 50);
                }
            }
        }
    };

    // Resolve the player's current world-map location name, mirroring the
    // MapInfoHUD logic in TimeDateSystem: hardcoded names take priority, then
    // the cached biome, then the current proc-gen biome.
    // True when the player is standing over a City / Burg / Village biome tile on
    // the world map. Those settlements have their own entry interaction, so the
    // "Visit ... / Make a camp" travel-decision menu must not open over them.
    // True when the player stands on a named hardcoded location (London, Milano,
    // Vatican Citadel, ...). These cannot be "visited" from the travel menu; the
    // Visit option is shown as "No Visit" instead of being actionable (#104).
    function isHardcodedBiomeHere() {
        if (!$gamePlayer) return false;
        if (window.WorldGen && window.WorldGen.HardcodedBiomeNames) {
            return !!window.WorldGen.HardcodedBiomeNames[`${$gamePlayer.x},${$gamePlayer.y}`];
        }
        return false;
    }

    function isSettlementBiomeHere() {
        if (!$gamePlayer) return false;
        let biome = '';
        if ($gameSystem && $gameSystem.getBiomeFromCache) {
            biome = $gameSystem.getBiomeFromCache($gamePlayer.x, $gamePlayer.y) || '';
        }
        if (!biome && $gameSystem && $gameSystem.getBiomeFromWorldCoordinates) {
            biome = $gameSystem.getBiomeFromWorldCoordinates($gamePlayer.x, $gamePlayer.y) || '';
        }
        biome = biome.toLowerCase();
        return biome.startsWith('city') || biome.startsWith('burg') || biome.startsWith('village');
    }

    function getCurrentLocationName() {
        if ($gamePlayer && window.WorldGen && window.WorldGen.HardcodedBiomeNames) {
            const loc = window.WorldGen.HardcodedBiomeNames[`${$gamePlayer.x},${$gamePlayer.y}`];
            if (loc) return loc;
        }
        let name = 'map';
        if ($gameSystem && $gameSystem.getBiomeFromCache && $gamePlayer) {
            const b = $gameSystem.getBiomeFromCache($gamePlayer.x, $gamePlayer.y);
            if (b && b !== 'Unknown') name = b;  // i18n-ignore  biome id
        }
        if (name === 'map' && $gameSystem && $gameSystem._procGenData && $gameSystem._procGenData.currentBiome) {
            name = $gameSystem._procGenData.currentBiome;
        }
        if (name.startsWith('Road ')) name = 'Road';
        return name;
    }

    // ------------------------------------------------------------------------
    // Place names for records and lists (Assets menu, deliveries, ...)
    //
    // Map 636 is ONE map reused for every square of the world, so its MapInfos
    // name ("ProceduralRoom") says nothing about where a thing actually is. A
    // record that points at it must be named after the world coordinate it was
    // made on: the hand-authored name of that square if it has one, otherwise
    // its biome, with the coordinate appended so two fields are told apart.
    // Anything else is named by its map, minus the editor's numeric prefix
    // ("700 - Hardware store" -> "Hardware store").
    // ------------------------------------------------------------------------

    function localizeName(text) {
        if (!text) return text;
        return (typeof window.Hendrix_Localization === 'function')
            ? window.Hendrix_Localization(text) : text;
    }

    // The name of the world square at (wx, wy), or '' when nothing is known.
    function worldSquareName(wx, wy) {
        const named = window.WorldGen && window.WorldGen.HardcodedBiomeNames;
        const hardcoded = named ? named[`${wx},${wy}`] : null;
        if (hardcoded) return hardcoded;
        // A square whose biome is overridden generates as the override, not as the
        // world map's own tile, so the name has to follow it: the biome cache is
        // built from the tiles and knows nothing about it.
        const override = window.getHardcodedBiomeOverride
            ? window.getHardcodedBiomeOverride(wx, wy) : null;
        if (override && override.biome) {
            return window.BiomeNames.display(String(override.biome).replace(/^(Road|River)\s+.*$/, '$1'));  // i18n-ignore  biome ids
        }
        let biome = '';
        if ($gameSystem && $gameSystem.getBiomeFromCache) {
            // Reads the world map's tiles when the square is not cached, which
            // needs a loaded map: a caller between maps just gets no biome.
            try { biome = $gameSystem.getBiomeFromCache(wx, wy) || ''; } catch (e) { biome = ''; }
        }
        if ((!biome || biome === 'Unknown') && $gameSystem && $gameSystem._procGenData) {
            biome = $gameSystem._procGenData.currentBiome || '';
        }
        if (biome === 'Unknown') biome = '';
        if (!biome) return '';
        // Roads and rivers carry a direction suffix ("Road cross", "River
        // vertical") that is layout, not a place.
        biome = biome.replace(/^(Road|River)\s+.*$/, '$1');  // i18n-ignore  biome ids
        return window.BiomeNames.display(biome);
    }

    // mapId is the map a record was made on; coords are the world coordinates it
    // was made at, needed only for the procedural map and falling back to where
    // the party is now.
    function placeName(mapId, coords) {
        const id = Number(mapId);
        if (id === procMapId) {
            const vars = (typeof $gameVariables !== 'undefined' && $gameVariables) ? $gameVariables : null;
            const wx = (coords && coords.x != null) ? Number(coords.x) : (vars ? vars.value(VAR_WORLD_X) | 0 : 0);
            const wy = (coords && coords.y != null) ? Number(coords.y) : (vars ? vars.value(VAR_WORLD_Y) | 0 : 0);
            const name = localizeName(worldSquareName(wx, wy)) || T('WorldMapReturn.wilderness');
            return `${name} (${wx},${wy})`;  // i18n-ignore  coordinate pair
        }
        const info = (typeof $dataMapInfos !== 'undefined' && $dataMapInfos) ? $dataMapInfos[id] : null;
        const raw = (info && info.name) ? String(info.name).replace(/^\d+\s*-\s*/, '') : '';
        return raw ? localizeName(raw) : T('WorldMapReturn.mapNumbered', { id: id });
    }

    // ========================================================================
    // WORLD MAP TRANSFER: the one answer to "where, in world terms, is this?"
    // ------------------------------------------------------------------------
    // Everything that has to remember a spot -- the party's own world square, a
    // parked vehicle, an asset, a delivery -- used to work it out for itself out
    // of Variables 43/44, a map's <Coords> tag and $gameSystem._procGenData, and
    // each of them arrived at a different answer. They all go through this now.
    //
    // A LOCATION is the full address of a tile:
    //   { mapId, x, y, worldX, worldY, layer, interior, alien, planet }
    //   mapId/x/y      the tile on whatever map it is, exactly as stored
    //   worldX/worldY  the map-315 square that map stands on. This is where a
    //                  thing is drawn and reached on the world map, whatever map
    //                  it is really on
    //   layer          depth in the procedural layer stack: one world square
    //                  generates a different map per cave floor / ocean depth, so
    //                  a bike left underground belongs to the underground
    //   interior       the procedural interior it is inside ("" in the open air).
    //                  A dungeon, cellar or sewer is generated onto the same map
    //                  id, world square and layer as the field it was entered
    //                  from, so only this tells the two apart
    //   alien/planet   a GalaxySim landing reuses map 636 AND the world
    //                  coordinates as its own planet grid, so worldX/worldY there
    //                  is a grid cell on `planet` and means nothing on Earth
    // ========================================================================

    // <Coords x y> of any map, loaded and parsed once. Only the parsed pair is
    // kept, so the (large) map file is free to be collected again.
    const mapCoordsCache = new Map();

    function coordsFromNote(note) {
        const m = String(note || '').match(/<\s*coords\b\s*[:=]?\s*(\d+)\D+(\d+)\s*>/i);
        return m ? { x: parseInt(m[1], 10), y: parseInt(m[2], 10) } : null;
    }

    function readMapCoordsTag(mapId) {
        const id = Number(mapId) || 0;
        if (!id) return null;
        // The loaded map already has its note in memory; only a map that is NOT
        // loaded is worth a file read (fast travel parks a vehicle on its
        // destination before the transfer happens).
        if (id === $gameMap.mapId()) {
            if ($gameMap._coordsDest) return { x: $gameMap._coordsDest.x, y: $gameMap._coordsDest.y };
            return ($dataMap && $dataMap.note) ? coordsFromNote($dataMap.note) : null;
        }
        if (typeof $dataMapInfos === 'undefined' || !$dataMapInfos || !$dataMapInfos[id]) return null;
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'data/Map%1.json'.format(id.padZero(3)), false);
            xhr.overrideMimeType('application/json');
            xhr.send();
            if (xhr.status >= 400) return null;
            return coordsFromNote((JSON.parse(xhr.responseText) || {}).note);
        } catch (e) {
            return null;
        }
    }

    // The world square a map DECLARES it stands on, or null when it declares
    // nothing usable (no tag, or the editor template's default pair).
    function mapCoordsTag(mapId) {
        const id = Number(mapId) || 0;
        if (!id || id === worldMapId || id === procMapId) return null;
        if (!mapCoordsCache.has(id)) {
            const raw = readMapCoordsTag(id);
            const usable = raw && !(raw.x === TEMPLATE_COORDS.x && raw.y === TEMPLATE_COORDS.y);
            mapCoordsCache.set(id, usable ? raw : null);
        }
        return mapCoordsCache.get(id);
    }

    // The party's last known world square. Written by every path that moves them
    // (see syncPlayerWorldCoords) and read by everything that puts them back.
    function playerWorldCoords() {
        return {
            x: $gameVariables.value(VAR_WORLD_X) | 0,
            y: $gameVariables.value(VAR_WORLD_Y) | 0
        };
    }

    // Only write when the value really moved: Game_Variables.onChange refreshes
    // every event page on the map, which is far too dear to pay per frame.
    function setPlayerWorldCoords(x, y) {
        const nx = Number(x), ny = Number(y);
        if (!isFinite(nx) || !isFinite(ny)) return false;
        if (nx < 0 || ny < 0) return false;
        if ($gameVariables.value(VAR_WORLD_X) !== nx) $gameVariables.setValue(VAR_WORLD_X, nx);
        if ($gameVariables.value(VAR_WORLD_Y) !== ny) $gameVariables.setValue(VAR_WORLD_Y, ny);
        return true;
    }

    function isAlienSurfaceNow() {
        return !!(window.GalaxySim && window.GalaxySim.isAlienSurface &&
                  window.GalaxySim.isAlienSurface());
    }

    // Standing on another planet there is no world map to go back to: map 315 is
    // Earth, and the saved square is the planet's own landing-grid cell, so the
    // return would drop the party onto whatever Earth tile happens to share those
    // two small numbers. Every route that offers the return asks this first, and
    // a true answer means the landing-site picker took the press instead
    // (GalaxySim_Core's Scene_AlienLandingGrid). False means Earth as usual.
    function divertedToLandingPicker() {
        if (!isAlienSurfaceNow()) return false;
        return !!(window.GalaxySim.openLandingGridPicker &&
                  window.GalaxySim.openLandingGridPicker());
    }

    // The planet whose landing grid map 636 currently stands for, or '' on Earth.
    function currentPlanetName() {
        if (!isAlienSurfaceNow()) return '';
        const landed = window.GalaxySim.getSurfacePlanet && window.GalaxySim.getSurfacePlanet();
        return (landed && landed.name) || '';
    }

    function currentLayerDepth() {
        const pg = $gameSystem && $gameSystem._procGenData;
        return (pg && pg.biomeLayerStack && pg.biomeLayerStack.length) || 0;
    }

    function currentInteriorName() {
        const api = window.ProceduralInteriors;
        return (api && typeof api.currentBiome === 'function' && api.currentBiome()) || '';
    }

    // World-map square the CURRENTLY LOADED map stands on.
    //   map 315   the party's own tile IS the square
    //   proc map  the square the biome was generated from (an alien landing grid
    //             answers with its grid cell, which is what it is addressed by)
    //   anything  its own <Coords> tag, else the last square the party stood on
    function currentWorldCoords() {
        const mapId = $gameMap.mapId();
        if (mapId === worldMapId) return { x: $gamePlayer.x, y: $gamePlayer.y };
        if (mapId === procMapId) {
            const pg = $gameSystem._procGenData;
            if (pg && typeof pg.originX === 'number' && typeof pg.originY === 'number') {
                return { x: pg.originX, y: pg.originY };
            }
            return playerWorldCoords();
        }
        return mapCoordsTag(mapId) || playerWorldCoords();
    }

    // The same answer for a map that is not the one loaded (fast travel parks a
    // vehicle on its destination before the transfer happens).
    function worldCoordsForMap(mapId, x, y) {
        const id = Number(mapId) || 0;
        if (id === worldMapId) return { x: Number(x) || 0, y: Number(y) || 0 };
        if (id === $gameMap.mapId()) return currentWorldCoords();
        return mapCoordsTag(id) || playerWorldCoords();
    }

    // The full address of a tile on the map that is loaded right now. Pass no
    // tile for the party's own.
    function locate(x, y) {
        const mapId = $gameMap.mapId();
        const wc = currentWorldCoords();
        const onProc = mapId === procMapId;
        const alien = onProc && isAlienSurfaceNow();
        return {
            mapId,
            x: (x === undefined) ? $gamePlayer.x : (Number(x) || 0),
            y: (y === undefined) ? $gamePlayer.y : (Number(y) || 0),
            worldX: wc.x,
            worldY: wc.y,
            layer: onProc ? currentLayerDepth() : 0,
            interior: onProc ? currentInteriorName() : '',
            alien,
            planet: alien ? currentPlanetName() : ''
        };
    }

    // The address a spot on a map that is NOT loaded resolves to. Everything the
    // loaded map alone can answer (which cave floor, which dungeon, which planet)
    // is unknowable from here and reads as the open surface of Earth.
    function locateOnMap(mapId, x, y) {
        const id = Number(mapId) || 0;
        if (id === $gameMap.mapId()) return locate(x, y);
        const wc = worldCoordsForMap(id, x, y);
        return {
            mapId: id, x: Number(x) || 0, y: Number(y) || 0,
            worldX: wc.x, worldY: wc.y,
            layer: 0, interior: '', alien: false, planet: ''
        };
    }

    // Do two addresses name the same place? Used to decide whether a thing parked
    // somewhere belongs on the map the party is looking at.
    function sameRealm(a, b) {
        if (!a || !b) return false;
        if (!!a.alien !== !!b.alien) return false;
        // An unnamed planet is a record written before planets were told apart:
        // it is taken to be whichever one is being asked about, so a vehicle left
        // on a surface by an older save is still found rather than stranded.
        if (a.alien && a.planet && b.planet && a.planet !== b.planet) return false;
        if ((a.layer || 0) !== (b.layer || 0)) return false;
        return (a.interior || '') === (b.interior || '');
    }

    // What a location is CALLED. A named world square wins (the hardcoded names
    // and biome overrides), then the map's own display name, then the biome, and
    // an alien landing is named after its planet.
    function locationName(loc) {
        if (!loc) return T('WorldMapReturn.wilderness');
        if (loc.alien) {
            return loc.planet ? localizeName(loc.planet) : T('WorldMapReturn.wilderness');
        }
        if (loc.mapId === procMapId || loc.mapId === worldMapId || !loc.mapId) {
            const square = localizeName(worldSquareName(loc.worldX, loc.worldY));
            const inside = loc.interior
                ? (window.BiomeNames ? window.BiomeNames.display(loc.interior) : loc.interior)
                : '';
            if (square && inside) return `${inside}, ${square}`;  // i18n-ignore  name pair
            return inside || square || T('WorldMapReturn.wilderness');
        }
        return placeName(loc.mapId, { x: loc.worldX, y: loc.worldY });
    }

    // One line naming a location and the exact tile it is on, for any list that
    // has to say where a thing was left.
    function describeLocation(loc) {
        if (!loc || !loc.mapId) return T('WorldMapReturn.wilderness');
        const name = locationName(loc);
        const depth = (loc.layer > 0 && !loc.alien)
            ? ' ' + T('WorldMapReturn.underground', { depth: loc.layer })
            : '';
        // On the world map the tile IS the square, so it is printed once.
        if (loc.mapId === worldMapId) return `${name} (${loc.x},${loc.y})`;  // i18n-ignore  coordinate pair
        if (loc.mapId === procMapId) {
            return `${name} (${loc.worldX},${loc.worldY})${depth} ${T('WorldMapReturn.atTile', { x: loc.x, y: loc.y })}`;
        }
        return `${name} ${T('WorldMapReturn.atTile', { x: loc.x, y: loc.y })}`;
    }

    // Keep the party's world square in step with the map they are standing on.
    // Called from Scene_Map.onMapLoaded, once the engine's own transfer has put
    // them on their arrival tile, so every route in -- a border crossing, an
    // event transfer, fast travel, stepping out of a vehicle, leaving a house or
    // a cellar -- lands on the same rule:
    //   map 315   the tile they arrived on
    //   proc map  the square the biome was generated from (never an alien grid
    //             cell: those are not Earth squares and would send a later
    //             "return to the world map" into the sea)
    //   anything  its <Coords> tag when it declares one, otherwise nothing at
    //             all, so the square they came in from stands
    function syncPlayerWorldCoords(mapId) {
        const id = Number(mapId) || 0;
        if (id === worldMapId) return setPlayerWorldCoords($gamePlayer.x, $gamePlayer.y);
        if (id === procMapId) {
            if (isAlienSurfaceNow()) return false;
            const pg = $gameSystem && $gameSystem._procGenData;
            if (pg && typeof pg.originX === 'number' && typeof pg.originY === 'number') {
                return setPlayerWorldCoords(pg.originX, pg.originY);
            }
            return false;
        }
        const tag = mapCoordsTag(id);
        return tag ? setPlayerWorldCoords(tag.x, tag.y) : false;
    }

    // Shared gate for the travel-decision menu. Named hardcoded locations
    // usually sit on City/Burg tiles, so isSettlementBiomeHere() is true for
    // them. They still get a "Visit <name>" travel choice, so only suppress the
    // menu over plain settlement tiles that are NOT a named hardcoded location.
    function canOpenTravelDecisionHere() {
        if ($gameMessage.isBusy()) return false;
        if ($gameMap.mapId() !== worldMapId) return false;
        return !isSettlementBiomeHere() || isHardcodedBiomeHere();
    }

    Scene_Map.prototype.openTravelDecision = function() {
        if (!canOpenTravelDecisionHere()) return;
        const visitLabel = T('WorldMapReturn.visit', { place: getCurrentLocationName() });
        const choices = [visitLabel, T('WorldMapReturn.makeCamp'), T('WorldMapReturn.cancel')];
        const cancelIndex = choices.length - 1;
        $gameMessage.setChoices(choices, 0, cancelIndex);
        $gameMessage.setChoiceCallback((choice) => {
            if (choice === 0) { performStopTravel(); }
            else if (choice === 1) { $gameTemp._pendingWorldMapCommand = 'makeCamp'; }
        });
        Input.clear();
        // The click destination is still the tile the player is standing on, and
        // it survives the choice window: leaving it set would reopen the menu
        // the moment the player cancels out of it.
        $gameTemp.clearDestination();
    };

    const _Scene_Map_update_wmr = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update_wmr.call(this);
        updateMysteryMarkers();
        updateQuestMarkers();
        updateQuestCompass();
        watchNationMusicChange();
        if ($gameTemp._icebushBlockedMessage && !this.isBusy()) {
            $gameTemp._icebushBlockedMessage = false;
            $gameMessage.add(T('WorldMapReturn.icebushBlocked'));
        }
        if ($gameTemp._pendingWorldMapCommand && !this.isBusy()) {
            const cmd = $gameTemp._pendingWorldMapCommand;
            $gameTemp._pendingWorldMapCommand = null;
            if (cmd === 'open') {
                PluginManager.callCommand($gameMap._interpreter, 'WorldMap', 'showZoomableMap', {});
            } else if (cmd === 'toggleMinimap') {
                PluginManager.callCommand($gameMap._interpreter, 'WorldMap', 'toggleMinimap', {});
            } else if (cmd === 'goDown') {
                PluginManager.callCommand($gameMap._interpreter, PLUGIN_PMT, 'goDown', {});
            } else if (cmd === 'goUp') {
                PluginManager.callCommand($gameMap._interpreter, PLUGIN_PMT, 'goUp', {});
            } else if (cmd === 'makeCamp') {
                PluginManager.callCommand($gameMap._interpreter, 'TimeDateSystem', 'SleepMenu', {});
            }
        }
    };

    // ============================================================================
    // WINDOW_MENUCOMMAND EXTENSION
    // ============================================================================

    const _Window_MenuCommand_makeCommandList = Window_MenuCommand.prototype.makeCommandList;
    Window_MenuCommand.prototype.makeCommandList = function() {
        _Window_MenuCommand_makeCommandList.call(this);
        // Skip injection when CustomMainMenuLayout is active (it handles layout itself)
        if (typeof Window_MenuCommand.prototype.callHotkeyCommand === 'function') return;

        if ($gameMap.mapId() === worldMapId) {
            this.addCommand(T('WorldMapReturn.stop'), 'stop', true, 282);
            const command = this._list.pop();
            this._list.splice(1, 0, command);
        }

        if ($gameMap.mapId() !== worldMapId) {
            this.addCommand(T('WorldMapReturn.worldMapMenu'), 'worldMapMenu', true, 190);
            const worldCmd = this._list.pop();
            this._list.splice(1, 0, worldCmd);
        }
    };

    // ============================================================================
    // SCENE_MENU EXTENSIONS
    // ============================================================================

    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function() {
        _Scene_Menu_createCommandWindow.call(this);
        this._commandWindow.setHandler('worldMapMenu', this.commandWorldMapMenu.bind(this));
        this._commandWindow.setHandler('stop',         this.commandStop.bind(this));
    };

    const _Scene_Menu_create = Scene_Menu.prototype.create;
    Scene_Menu.prototype.create = function() {
        _Scene_Menu_create.call(this);
        this.createWorldMapChoiceWindow();
    };

    Scene_Menu.prototype.createWorldMapChoiceWindow = function() {
        const rect = this.worldMapChoiceWindowRect();
        this._worldMapChoiceWindow = new Window_WorldMapChoice(rect);
        this._worldMapChoiceWindow.setHandler('open',          this.commandOpenWorldMap.bind(this));
        this._worldMapChoiceWindow.setHandler('toggleMinimap', this.commandToggleMinimap.bind(this));
        this._worldMapChoiceWindow.setHandler('return',        this.commandWorldMap.bind(this));
        this._worldMapChoiceWindow.setHandler('goDown',        this.commandGoDown.bind(this));
        this._worldMapChoiceWindow.setHandler('goUp',          this.commandGoUp.bind(this));
        this._worldMapChoiceWindow.setHandler('cancel',        this.onWorldMapChoiceCancel.bind(this));
        this.addWindow(this._worldMapChoiceWindow);
    };

    Scene_Menu.prototype.worldMapChoiceWindowRect = function() {
        const ww = 400, wh = this.calcWindowHeight(6, true);
        return new Rectangle((Graphics.boxWidth - ww) / 2, (Graphics.boxHeight - wh) / 2, ww, wh);
    };

    Scene_Menu.prototype.commandWorldMapMenu = function() {
        if (this._dndContainer && typeof this.showWorldMapPage === 'function') {
            this.showWorldMapPage(); return;
        }
        if (this._dndContainer) {
            this._dndContainer.style.opacity      = '0';
            this._dndContainer.style.pointerEvents = 'none';
        }
        if (typeof UIMenuInputManager !== 'undefined' && UIMenuInputManager.deactivate) {
            UIMenuInputManager.deactivate();
        }
        this._worldMapChoiceWindow.show();
        this._worldMapChoiceWindow.activate();
    };

    Scene_Menu.prototype.onWorldMapChoiceCancel = function() {
        this._worldMapChoiceWindow.hide();
        this._worldMapChoiceWindow.deactivate();
        if (this._dndContainer) {
            this._dndContainer.style.opacity      = '1';
            this._dndContainer.style.pointerEvents = 'auto';
        }
        if (typeof UIMenuInputManager !== 'undefined' && UIMenuInputManager.activate) {
            UIMenuInputManager.activate(2);
        }
        this._commandWindow.activate();
    };

    Scene_Menu.prototype.commandWorldMap = function() {
        // Block return from Icebush (map 1414) during tutorial
        if ($gameMap.mapId() === 1414 && $gameSwitches.value(100)) {
            this.playBuzzerSound(); return;
        }
        // Planetside this entry is the landing-site picker, not a way home.
        if (divertedToLandingPicker()) return;
        const saved = playerWorldCoords();
        if (saved.x !== 0 || saved.y !== 0) {
            $gamePlayer.reserveTransfer(worldMapId, saved.x, saved.y, 0, 0);
        }
        SceneManager.pop();
    };

    Scene_Menu.prototype.commandOpenWorldMap = function() {
        $gameTemp._pendingWorldMapCommand = 'open';
        SceneManager.pop();
    };

    Scene_Menu.prototype.commandToggleMinimap = function() {
        $gameTemp._pendingWorldMapCommand = 'toggleMinimap';
        SceneManager.pop();
    };

    Scene_Menu.prototype.commandGoDown = function() {
        $gameTemp._pendingWorldMapCommand = 'goDown';
        SceneManager.pop();
    };

    Scene_Menu.prototype.commandGoUp = function() {
        $gameTemp._pendingWorldMapCommand = 'goUp';
        SceneManager.pop();
    };

    Scene_Menu.prototype.commandStop = function() {
        performStopTravel();
        SceneManager.pop();
    };

    // ============================================================================
    // FURNITURE SYSTEM INTEGRATION
    // ----------------------------------------------------------------------------
    // The procedural map (procMapId, 636) is a single reused map that streams a
    // different biome tile for every world coordinate. FurnitureSystem stores
    // placed pieces keyed by "map", so without help every proc-map build would
    // share one bucket and leak across coordinates. This provider hands
    // FurnitureSystem a composite key — biome + world coordinate + underground
    // depth — so structures and furniture built on the procedural map are
    // remembered and restored only at the exact biome/world-coordinate where they
    // were placed. Each piece already stores its own x/y (proc-map coordinates),
    // so the full (biome, worldX, worldY, procX, procY) address is preserved.
    // Non-proc maps return null → FurnitureSystem falls back to the numeric id.
    // (WorldMapReturn loads before FurnitureSystem, so we seed the namespace here;
    // FurnitureSystem keeps this object and only adds to it.)
    // ============================================================================
    window.FurnitureSystem = window.FurnitureSystem || {};
    window.FurnitureSystem.mapKeyProvider = function(mapId) {
        if (mapId !== procMapId) return null;
        const pg = $gameSystem && $gameSystem._procGenData;
        if (!pg || !pg.currentBiome) return null; // not generated yet
        const wx = $gameVariables.value(VAR_WORLD_X);
        const wy = $gameVariables.value(VAR_WORLD_Y);
        const depth = (pg.biomeLayerStack && pg.biomeLayerStack.length) || 0;
        // A structure generated off an entrance tile shares its biome, coordinate
        // and depth with every other structure of that kind on the square, so the
        // entrance salt joins the address: two cellars under one field are two
        // places, and what is carried out of one is still standing in the other.
        const sess = pg._dungeonSession;
        const salt = (sess && sess.salt) ? `:${sess.salt}` : '';
        return `proc:${pg.currentBiome}:${wx},${wy}:${depth}${salt}`;
    };

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    window.WorldMapReturn = {
        performVisitMap: performStopTravel,
        returnToWorldMap() {
            if (divertedToLandingPicker()) return;
            const saved = playerWorldCoords();
            if (saved.x !== 0 || saved.y !== 0) {
                $gamePlayer.reserveTransfer(worldMapId, saved.x, saved.y, 0, 0);
            }
        },
        worldMapId,
        procMapId,
        // The name to file a place under (Assets menu, delivery targets, ...).
        // Always use this instead of $dataMapInfos[id].name: the procedural map
        // is reused for the whole world and would otherwise read as
        // "ProceduralRoom" everywhere. Pass the world coordinates the record
        // was made at, or omit them for the party's current square.
        placeName,
        currentPlaceName() { return placeName($gameMap ? $gameMap.mapId() : 0); },
        // Re-apply the current map's biome ambience/music. Exposed so plugins
        // that move the player without a normal map load (the procedural house
        // system's floor changes, for one) can refresh the audio themselves.
        updateBiomeAudio,
        // Biome track selection, exposed for debugging and for anything that
        // wants to know what a biome sounds like without playing it.
        pickBiomeTrack,
        biomeTrackPool,
        currentNationId,
        // The procedural square the party is standing on, saved and put back.
        // Anything that takes them off map 636 into a submap and later returns
        // them must use these, so every route back rebuilds the SAME square:
        // ProceduralHouseSystem for interiors and tower floors, this plugin's own
        // forced-biome structures for cellars, sewers, temples, dens and vaults.
        snapshotProcSurface,
        restoreProcSurface
    };

    // ========================================================================
    // EARTH IS GONE
    // ------------------------------------------------------------------------
    // On 21 December 2012 Nibiru struck the Earth (GalaxySim.Nibiru), switch 199
    // went up, and the world map stopped existing. Map 315 is still in the data
    // and half the game still asks for it: every "return to the world map", the
    // border of every procedural square, every parked vehicle, every fast-travel
    // arrival, every origin the wizard hands out. Rather than teach all of them
    // that the planet is gone, the answer is given once, here, at the one door
    // they all go through: a transfer to 315 arrives at the Omega Tower instead,
    // which is the only ground left.
    //
    // The tower is a real authored map (635, "Stairs Hall", <MapGroup:
    // OmegaTower>), so this is a redirect and not a special case: everything
    // downstream carries on with an ordinary map id.
    // ========================================================================
    const SW_EARTH_LOST = 199;
    const TOWER_LANDING = { mapId: 635, x: 13, y: 38, dir: 8 };

    function earthLost() {
        return !!(typeof $gameSwitches !== 'undefined' && $gameSwitches &&
                  $gameSwitches.value(SW_EARTH_LOST));
    }
    // A fresh copy every time: callers write their own direction/fade onto it.
    function towerLanding() { return Object.assign({}, TOWER_LANDING); }
    // Is this transfer one the tower has to answer for?
    function redirectsToTower(mapId) {
        return Number(mapId) === worldMapId && earthLost();
    }

    // The one door. Every transfer in the engine is reserved here - the editor's
    // Transfer Player command, every plugin, every menu - so this is the only
    // place the redirect has to live.
    const _WMR_Game_Player_reserveTransfer = Game_Player.prototype.reserveTransfer;
    Game_Player.prototype.reserveTransfer = function (mapId, x, y, d, fadeType) {
        if (redirectsToTower(mapId)) {
            const t = TOWER_LANDING;
            return _WMR_Game_Player_reserveTransfer.call(this, t.mapId, t.x, t.y, t.dir, fadeType);
        }
        return _WMR_Game_Player_reserveTransfer.call(this, mapId, x, y, d, fadeType);
    };

    // A vehicle parked on a planet that is not there any more is parked at the
    // tower, so it is still reachable and still boardable.
    const _WMR_Game_Vehicle_setLocation = Game_Vehicle.prototype.setLocation;
    Game_Vehicle.prototype.setLocation = function (mapId, x, y) {
        if (redirectsToTower(mapId)) {
            const t = TOWER_LANDING;
            return _WMR_Game_Vehicle_setLocation.call(this, t.mapId, t.x, t.y);
        }
        return _WMR_Game_Vehicle_setLocation.call(this, mapId, x, y);
    };

    // The backstop. Anything that puts the party on 315 without reserving a
    // transfer (a savegame written there before the impact, a plugin setting the
    // position outright) is caught the moment the map is up and moved on. The
    // reserve above cannot loop through this: it names 635, never 315.
    const _WMR_Scene_Map_onMapLoaded_earthLost = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function () {
        _WMR_Scene_Map_onMapLoaded_earthLost.call(this);
        if ($gameMap && $gameMap.mapId() === worldMapId && earthLost() &&
            !$gamePlayer.isTransferring()) {
            const t = TOWER_LANDING;
            $gamePlayer.reserveTransfer(t.mapId, t.x, t.y, t.dir, 0);
        }
    };

    // ============================================================================
    // WINDOW.WORLDMAPTRANSFER
    // ----------------------------------------------------------------------------
    // The unified coordinate service. Nothing outside this file should read
    // Variables 43/44, parse a <Coords> tag or reach into _procGenData to work out
    // where something is: ask here instead, so one rule answers for the world map,
    // the reused procedural map, its underground layers, its interiors, the
    // authored maps and an alien planet's landing grid alike.
    // ============================================================================
    window.WorldMapTransfer = {
        worldMapId,
        procMapId,
        // The editor template's <Coords> pair, read as "unset" everywhere.
        TEMPLATE_COORDS,

        // --- the party ---
        playerWorld: playerWorldCoords,
        setPlayerWorld: setPlayerWorldCoords,
        // Re-derive the party's world square from a map. Called on every map load;
        // exposed so a plugin that moves them without one can do the same.
        syncPlayerWorld: syncPlayerWorldCoords,

        // --- addressing ---
        // The full address of a tile on the map loaded now (the party's own tile
        // when none is given), and of a tile on any other map.
        locate,
        locateOnMap,
        // Do two addresses sit in the same realm (same planet, cave floor and
        // interior)? A world square alone does not decide it: a dungeon, the cave
        // under it and the field above all share one map id and one square.
        sameRealm,
        // The world-map square a map stands on, with and without a loaded map.
        currentWorldCoords,
        worldCoordsForMap,
        // A map's declared <Coords>, or null when it declares nothing usable.
        mapCoordsTag,
        currentLayer: currentLayerDepth,
        currentInterior: currentInteriorName,
        isAlienSurface: isAlienSurfaceNow,
        currentPlanet: currentPlanetName,

        // --- naming ---
        // What a location is called, and one line naming it with its exact tile.
        locationName,
        describeLocation,
        placeName,

        // --- after the impact ---
        // Has Earth been struck out (switch 199)? Anything that would send the
        // party, a vehicle or a menu to map 315 must ask this rather than test
        // the switch itself, and `towerLanding()` is the one address that
        // replaces it: { mapId, x, y, dir }.
        earthLost,
        towerLanding
    };

})();
