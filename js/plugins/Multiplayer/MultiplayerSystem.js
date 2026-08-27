//=============================================================================
// MultiplayerSystem_Unified.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v6.0.0 - Combined Multiplayer System (Server + Steamworks) with premium Parchment Control Terminals.
 * @author Omni-Lex (Merged Architecture)
 * @help
 * This plugin unifies the 64-player Central Server architecture (with Party System)
 * and the 8-player Steamworks P2P architecture into a single plugin.
 *
 * --- SETUP ---
 * 1. Choose your "Network Mode" in the plugin parameters.
 * 2. Create events named "Player1" through "Player8" on your maps. That is a
 *    rendering cap: a 64-player server session still only draws the nearest 8
 *    other players on any single map (party members first). Steam lobbies are
 *    capped at 8 players, so 8 slots always cover them.
 * 3. For Steamworks mode, the js/libs/steamworks folder MUST be a full steamworks.js
 *    build that exposes the matchmaking, networking and callback modules. The plugin
 *    logs a warning and disables Steam multiplayer if those modules are missing.
 *    Steam must be running and steam_appid.txt (App ID 4193010) present for dev builds.
 * 4. For Server mode, ensure your custom WebSocket server is running.
 *
 * --- STEAM "JOIN GAME" ---
 * When a player creates or joins a Steam lobby, rich presence key "connect" is set to
 * "+connect_lobby <lobbyId>", so friends see "Join Game" in the Steam friends list and
 * chat. Accepting fires GameRichPresenceJoinRequested / GameLobbyJoinRequested (handled
 * here) if the game is running, or launches the game with "+connect_lobby <id>" which is
 * parsed on boot. The join is applied once the player is in-world on a map.
 *
 * @param networkMode
 * @text Network Mode
 * @desc Choose between 'WebSocket' (Server with Parties) or 'Steamworks' (P2P Lobby).
 * @type select
 * @option WebSocket
 * @option Steamworks
 * @default WebSocket
 *
 * @param serverUrl
 * @text Server URL (WebSocket Only)
 * @desc WebSocket URL of the central game server, e.g. ws://1.2.3.4:8080 or wss://mp.example.com. http(s):// is accepted and rewritten.
 * @default wss://hypernet-explorer-signaling-server.onrender.com
 *
 * @param maxPlayers
 * @text Maximum Players (Custom Server)
 * @desc Max players for the custom WebSocket server (up to 64). Steam P2P is always hard-capped at 8.
 * @type number
 * @min 2
 * @max 64
 * @default 64
 *
 * @param excludedSwitches
 * @text Excluded Switches
 * @desc Comma-separated list of Switch IDs to NOT synchronize.
 * @type string
 * @default
 *
 * @param excludedVariables
 * @text Excluded Variables
 * @desc Comma-separated list of Variable IDs to NOT synchronize.
 * @type string
 * @default
 *
 * @param showPlayerNames
 * @text Show Player Names
 * @desc Show player display names above their character sprites.
 * @type boolean
 * @default true
 *
 * @param nameplateConfig
 * @text Nameplate Config
 * @type struct<Nameplate>
 * @default {"fontFace":"GameFont","fontSize":"18","textColor":"#FFFFFF","outlineColor":"rgba(0, 0, 0, 0.7)","outlineWidth":"3","yOffset":"-50"}
 */

/*~struct~Nameplate:
 * @param fontFace
 * @text Font Face
 * @default GameFont
 * @param fontSize
 * @text Font Size
 * @type number
 * @min 1
 * @default 18
 * @param textColor
 * @text Text Color
 * @default #FFFFFF
 * @param outlineColor
 * @text Outline Color
 * @default rgba(0, 0, 0, 0.7)
 * @param outlineWidth
 * @text Outline Width
 * @type number
 * @min 0
 * @default 3
 * @param yOffset
 * @text Y Offset
 * @type number
 * @default -50
 * @min -100
 */

(() => {
    'use strict';

    // RMMZ keys both the parameter set and the plugin commands by the FILE name
    // (Utils.extractFileName over the plugins.js entry), so asking under the old
    // "_Unified" working title read an empty parameter set: showPlayerNames came
    // back undefined and nameplates were off however the entry was configured.
    // The file name is the one name that answers; the working title stays on as
    // a command alias.
    const PLUGIN_NAME = 'MultiplayerSystem';
    const LEGACY_PLUGIN_NAME = 'MultiplayerSystem_Unified';
    const params = PluginManager.parameters(PLUGIN_NAME);

    let NetworkMode = params.networkMode || 'WebSocket';
    window.NetworkMode = NetworkMode;
    // Networked play (Steam P2P lobbies and the central WebSocket server) is greyed out
    // for now: both entries stay visible in the menu but cannot be selected. Local
    // split-screen is unaffected. Flip this back to true to re-enable them.
    const NETWORK_PLAY_ENABLED = false;
    window.MultiplayerNetworkPlayEnabled = NETWORK_PLAY_ENABLED;
    // Steam P2P lobbies are hard-capped at 8 players here; the custom WebSocket server's
    // limit (up to 64) is enforced server-side by server.js.
    const STEAM_MAX_PLAYERS = 8;
    // How many remote players can be drawn on one map at once. Maps only carry
    // "Player1".."Player8" events, so this is a rendering cap, not a session cap:
    // a 64-player server session shows the nearest 8 others per map.
    const MAX_MAP_PLAYER_SLOTS = 8;
    // WebSocket() only accepts ws:// and wss://, so normalise whatever the player typed
    // (http(s):// pasted from a browser, or a bare "1.2.3.4:8080" host) into a real
    // socket URL. Bare hosts are assumed plaintext, which is what a fresh VPS serves.
    function toWebSocketUrl(url) {
        const raw = String(url || '').trim().replace(/\/+$/, '');
        if (!raw) return '';
        if (/^wss?:\/\//i.test(raw)) return raw;
        if (/^https:\/\//i.test(raw)) return 'wss://' + raw.slice(8);
        if (/^http:\/\//i.test(raw)) return 'ws://' + raw.slice(7);
        return 'ws://' + raw;
    }

    const ExcludedSwitches = (params.excludedSwitches || '').split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
    const ExcludedVariables = (params.excludedVariables || '').split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
    const ShowPlayerNames = params.showPlayerNames === 'true';
    // A malformed plugin parameter must not take the whole plugin down at load
    // time: fall back to the defaults and carry on.
    const NameplateConfig = (() => {
        try {
            return JSON.parse(params.nameplateConfig || '{}');
        } catch (e) {
            console.error('[Multiplayer] nameplateConfig is not valid JSON, using defaults:', e);
            return {};
        }
    })();

    // ============================================================================
    // STEAMWORKS INITIALIZATION
    // ============================================================================
    const STEAM_APP_ID = 4193010;
    let steamworks = null;
    let steamClient = null;

    // --- Version-tolerant helpers around the steamworks.js API ---
    // These smooth over shape differences between steamworks.js releases and
    // guard against the bundled binary lacking a module entirely.
    function swEnum(pathStr, fallback) {
        try {
            let o = steamworks;
            for (const part of pathStr.split('.')) {
                if (o == null) return fallback;
                o = o[part];
            }
            return o === undefined ? fallback : o;
        } catch (e) { return fallback; }
    }

    function steamIdToString(v) {
        if (v == null) return null;
        if (typeof v === 'object') {
            if (v.steamId64 !== undefined && v.steamId64 !== null) return v.steamId64.toString();
            if (typeof v.getSteamId64 === 'function') return v.getSteamId64().toString();
        }
        return v.toString();
    }

    function toBig(id) { return typeof id === 'bigint' ? id : BigInt(id); }

    function p2pSend(steamId, buffer) {
        if (!steamClient || !steamClient.networking || steamId == null) return;
        // Modern steamworks.js signature: sendP2PPacket(steamId64, sendType, data)
        steamClient.networking.sendP2PPacket(toBig(steamId), swEnum('SendType.Reliable', 2), buffer);
    }

    function p2pAccept(steamId) {
        if (!steamClient || !steamClient.networking || steamId == null) return;
        const net = steamClient.networking;
        if (typeof net.acceptP2PSession === 'function') net.acceptP2PSession(toBig(steamId));
        else if (typeof net.acceptP2PSessionWithUser === 'function') net.acceptP2PSessionWithUser(toBig(steamId));
    }

    function setSteamConnect(lobbyId) {
        const lp = steamClient && steamClient.localplayer;
        if (!lp || typeof lp.setRichPresence !== 'function') return;
        try {
            if (lobbyId) {
                // The special "connect" key makes friends see "Join Game" in the friends
                // list and Steam chat; its value is passed to the game on join/launch.
                lp.setRichPresence('connect', '+connect_lobby ' + lobbyId);
            } else {
                lp.setRichPresence('connect'); // omitting the value clears it (removes "Join Game")
            }
        } catch (e) { /* rich presence is best-effort */ }
    }

    function clearSteamConnect() { setSteamConnect(null); }

    function registerSteamCallback(name, handler) {
        try {
            const cb = steamClient && steamClient.callback;
            if (!cb || typeof cb.register !== 'function') return;
            const id = swEnum('SteamCallback.' + name, undefined);
            if (id === undefined) return;
            cb.register(id, handler);
        } catch (e) { /* callback unsupported on this build */ }
    }

    // steamworks.js remaps EChatMemberStateChange to a sequential enum, delivered as a
    // plain number: Entered=0, Left=1, Disconnected=2, Kicked=3, Banned=4.
    function steamMemberJoined(state) {
        const E = swEnum('ChatMemberStateChange', null);
        if (E && E.Entered !== undefined) return state === E.Entered;
        return Number(state) === 0;
    }
    function steamMemberGone(state) {
        const E = swEnum('ChatMemberStateChange', null);
        if (E && E.Left !== undefined) return state === E.Left || state === E.Disconnected || state === E.Kicked || state === E.Banned;
        return Number(state) >= 1; // Left / Disconnected / Kicked / Banned
    }

    function parseConnectLobby(connect) {
        if (!connect) return null;
        const m = String(connect).match(/\+connect_lobby\s+(\d+)/);
        return m ? m[1] : null;
    }

    function getLaunchArgv() {
        try { if (typeof nw !== 'undefined' && nw.App && nw.App.argv) return nw.App.argv; } catch (e) { }
        try { if (typeof process !== 'undefined' && process.argv) return process.argv; } catch (e) { }
        return [];
    }

    function initSteam() {
        if (steamClient) return true;
        try {
            steamworks = require('../libs/steamworks');
            steamClient = steamworks.init(STEAM_APP_ID);

            // The bundled/stripped binary only exposes achievements + cloud + stats.
            // Multiplayer needs the matchmaking, networking and callback modules; if
            // they are missing, fail loudly and point at the fix instead of half-working.
            if (!steamClient.matchmaking || !steamClient.networking || !steamClient.callback) {
                console.warn('[Multiplayer] The steamworks native module lacks matchmaking/networking/callback. ' +
                    'Replace js/libs/steamworks with a full steamworks.js build to enable Steam multiplayer.');  // i18n-ignore  console diagnostic
                steamClient = null;
                return false;
            }

            const lp = steamClient.localplayer;
            const name = (lp && typeof lp.getName === 'function') ? lp.getName()
                : (typeof steamClient.getName === 'function' ? steamClient.getName() : 'Unknown');  // i18n-ignore  Steam account fallback, not shown in game
            console.log('Steamworks initialized successfully for User:', name);

            const inst = NetworkManager_Steam.instance;
            inst.mySteamId = inst.resolveMySteamId();
            inst.setupSteamCallbacks();
            return true;
        } catch (e) {
            // Expected for players without Steam running; keep it quiet, not an error spew.
            console.log('Steamworks not available (is Steam running?):', e && e.message);
            return false;
        }
    }

    // Handles "Join Game" requests coming from Steam (friends list / chat / launch args).
    // Defers the actual join until the game world is ready and we are on a map scene.
    const SteamJoinRequest = {
        _pendingLobbyId: null,
        handle(lobbyId) {
            if (!lobbyId) return;
            if (!NETWORK_PLAY_ENABLED) return;                          // networked play disabled
            this._pendingLobbyId = lobbyId;
            this.tryConsume();
        },
        tryConsume() {
            if (!NETWORK_PLAY_ENABLED) return;
            if (!this._pendingLobbyId) return;
            if (!initSteam()) return;                                   // Steam / full binary required
            if (typeof $gameParty === 'undefined' || !$gameParty || !$gameParty.leader()) return; // world not ready
            if (!(SceneManager._scene instanceof Scene_Map)) return;    // wait until on a map
            const lobbyId = this._pendingLobbyId;
            this._pendingLobbyId = null;

            NetworkMode = 'Steamworks';
            window.NetworkMode = NetworkMode;
            NetworkManager = NetworkManager_Steam;
            window.NetworkManager = NetworkManager;

            const nm = NetworkManager_Steam.instance;
            if (nm.isMultiplayer()) nm.disconnect(true);
            NetworkManager_Steam.updateUI(T('Multiplayer.joiningFriendLobby'));
            nm.initiateJoinRoom(lobbyId, true);
        }
    };
    window.SteamJoinRequest = SteamJoinRequest;
    // NOTE: the best-effort boot init + launch-arg join are performed at the very end of
    // this IIFE, after NetworkManager_Steam is defined (class declarations are not hoisted).

    // ============================================================================
    // COMMON: OfflineStateManager
    // ============================================================================
    class OfflineStateManager {
        constructor() { this.savedState = null; }

        saveCurrentState() {
            this.savedState = {
                mapId: $gameMap.mapId(),
                x: $gamePlayer.x,
                y: $gamePlayer.y,
                direction: $gamePlayer.direction(),
                switches: this.captureAllSwitches(),
                variables: this.captureAllVariables(),
                dungeonFloors: $gameSystem._dungeonFloors ? JSON.parse(JSON.stringify($gameSystem._dungeonFloors)) : null,
                stairLocations: $gameSystem._stairLocations ? JSON.parse(JSON.stringify($gameSystem._stairLocations)) : null,
                timestamp: Date.now()
            };
            return this.savedState;
        }

        captureAllSwitches() {
            const switches = {};
            for (let i = 1; i < $dataSystem.switches.length; i++) switches[i] = $gameSwitches.value(i);
            return switches;
        }

        captureAllVariables() {
            const variables = {};
            for (let i = 1; i < $dataSystem.variables.length; i++) variables[i] = $gameVariables.value(i);
            return variables;
        }

        restoreState(restorePosition = true) {
            if (!this.savedState) return false;
            for (const id in this.savedState.switches) $gameSwitches.setValue(Number(id), this.savedState.switches[id], true);
            for (const id in this.savedState.variables) $gameVariables.setValue(Number(id), this.savedState.variables[id], true);

            if (this.savedState.dungeonFloors !== null) $gameSystem._dungeonFloors = JSON.parse(JSON.stringify(this.savedState.dungeonFloors));
            if (this.savedState.stairLocations !== null) $gameSystem._stairLocations = JSON.parse(JSON.stringify(this.savedState.stairLocations));

            if (restorePosition) {
                if ($gameMap.mapId() !== this.savedState.mapId) {
                    $gamePlayer.reserveTransfer(this.savedState.mapId, this.savedState.x, this.savedState.y, this.savedState.direction, 0);
                } else {
                    $gamePlayer.locate(this.savedState.x, this.savedState.y);
                    $gamePlayer.setDirection(this.savedState.direction);
                }
            }
            this.clearState();
            return true;
        }

        clearState() { this.savedState = null; }
    }


    // ============================================================================
    // MODE: WEBSOCKET (SERVER ARCHITECTURE WITH PARTY SYSTEM)
    // ============================================================================
    class NetworkManager_Server {
        constructor() {
            this.ws = null;
            this.myId = null;
            this.players = new Map();
            this.party = null;
            this.currentServerUrl = '';
            this.lastPlayerState = {};
            this.offlineStateManager = new OfflineStateManager();
            this._disconnectionHandled = false;
            this._intentionalDisconnect = false;
            this._sendQueue = [];
            this._reconnectAttempts = 0;
            this._reconnectTimer = null;
        }

        static get MAX_RECONNECT_ATTEMPTS() { return 5; }
        static get RECONNECT_BASE_DELAY() { return 1000; }
        static get RECONNECT_MAX_DELAY() { return 30000; }

        static get instance() {
            if (!this._instance) this._instance = new NetworkManager_Server();
            return this._instance;
        }

        pollPackets() { }

        static refreshPlayerListUI() {
            const scene = SceneManager._scene;
            if (scene instanceof Scene_Map && scene._playerListWindow) scene._playerListWindow.refresh();
        }

        isConnected() { return this.ws && this.ws.readyState === WebSocket.OPEN; }
        isMultiplayer() { return !!this.myId; }
        isInParty() { return !!(this.party && Array.isArray(this.party.members)); }
        isConnecting() { return this.ws && this.ws.readyState === WebSocket.CONNECTING; }

        connect(serverUrl) {
            return new Promise((resolve, reject) => {
                this.offlineStateManager.saveCurrentState();
                if (this.ws && this.ws.readyState !== WebSocket.CLOSED) this.ws.close();

                // Reset per-connection guards so disconnection handling runs once per socket.
                this._disconnectionHandled = false;
                this._intentionalDisconnect = false;

                const socketUrl = toWebSocketUrl(serverUrl);
                this.currentServerUrl = socketUrl;
                try {
                    this.ws = new WebSocket(socketUrl);
                } catch (e) {
                    // Malformed address: WebSocket throws synchronously.
                    this.ws = null;
                    NetworkManager_Server.updateUI(T('Multiplayer.invalidAddress', { url: socketUrl }), true);
                    reject(e);
                    return;
                }
                NetworkManager_Server.updateUI(T('Multiplayer.connectingTo', { url: socketUrl }), false);

                this.ws.onopen = () => {
                    this.send({ type: 'login', playerInfo: this.createPlayerInfo() });
                    this.flushSendQueue();
                    resolve();
                };
                this.ws.onmessage = (message) => {
                    let parsed;
                    try {
                        parsed = JSON.parse(message.data);
                    } catch (e) {
                        return; // Ignore non-JSON frames (ping/keepalive)
                    }
                    this.handleServerMessage(parsed);
                };
                this.ws.onerror = (error) => {
                    NetworkManager_Server.updateUI(T('Multiplayer.connectFailed'), true);
                    this.handleDisconnection(true);
                    reject(error);
                };
                this.ws.onclose = () => this.handleDisconnection(true);
            });
        }

        handleDisconnection(restoreLocalState) {
            // onerror and the subsequent onclose both call this; only act once per socket.
            if (this._disconnectionHandled) return;
            this._disconnectionHandled = true;
            const wasConnected = !!this.myId;
            if (restoreLocalState && this.myId) this.offlineStateManager.restoreState(true);
            this.cleanup();
            NetworkManager_Server.updateUI(T('Multiplayer.disconnected'), false);
            // Attempt a bounded auto-reconnect only for unexpected drops of an active
            // session (wasConnected), or while a reconnect cycle is already in progress.
            if (!this._intentionalDisconnect && this.currentServerUrl &&
                (wasConnected || this._reconnectAttempts > 0)) {
                this.scheduleReconnect();
            }
        }

        scheduleReconnect() {
            if (this._reconnectTimer) return;
            if (this._reconnectAttempts >= NetworkManager_Server.MAX_RECONNECT_ATTEMPTS) {
                NetworkManager_Server.updateUI(T('Multiplayer.reconnectGaveUp'), true);
                this._reconnectAttempts = 0;
                return;
            }
            const attempt = this._reconnectAttempts;
            const delay = Math.min(
                NetworkManager_Server.RECONNECT_BASE_DELAY * Math.pow(2, attempt),
                NetworkManager_Server.RECONNECT_MAX_DELAY
            );
            this._reconnectAttempts++;
            NetworkManager_Server.updateUI(T('Multiplayer.reconnectingIn', { seconds: Math.round(delay / 1000) }), false);
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                if (this._intentionalDisconnect) return;
                NetworkManager_Server.updateUI(T('Multiplayer.reconnectingAttempt', { attempt: this._reconnectAttempts }), false);
                this.connect(this.currentServerUrl).catch(() => { });
            }, delay);
        }

        cancelReconnect() {
            if (this._reconnectTimer) {
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = null;
            }
            this._reconnectAttempts = 0;
        }

        flushSendQueue() {
            if (!this._sendQueue || !this._sendQueue.length) return;
            const queued = this._sendQueue;
            this._sendQueue = [];
            for (const data of queued) {
                if (this.isConnected()) this.ws.send(JSON.stringify(data));
            }
        }

        cleanup() {
            if (this.ws) {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
                this.ws = null;
            }
            this.players.clear();
            MultiplayerManager.instance.clearRemotePlayers();
            NetworkManager_Server.refreshPlayerListUI();
            this.myId = null;
            this.party = null;
            this.lastPlayerState = {};
            this._sendQueue = [];
            $gameSwitches.setValue(66, false, true);
        }

        disconnect(restoreState = true) {
            NetworkManager_Server.updateUI("Disconnecting...", false);
            this._intentionalDisconnect = true;
            this.cancelReconnect();
            this.handleDisconnection(restoreState);
        }

        send(data) {
            if (this.isConnected()) {
                this.ws.send(JSON.stringify(data));
            } else if (this.isConnecting()) {
                // Socket is still opening; queue and flush on open instead of dropping.
                this._sendQueue.push(data);
            }
        }

        static updateUI(text, isError = false) {
            const scene = SceneManager._scene;
            if (scene && scene.updateStatus) scene.updateStatus(text, isError);
        }

        createPlayerInfo() {
            const leader = $gameParty.leader();
            const actor = $gameActors.actor(1);
            return {
                name: actor.name(),
                characterName: leader.characterName(),
                characterIndex: leader.characterIndex(),
                faceName: leader.faceName(),
                faceIndex: leader.faceIndex(),
                mapId: $gameMap.mapId(),
                x: $gamePlayer.x,
                y: $gamePlayer.y,
                direction: $gamePlayer.direction()
            };
        }

        handleServerMessage(data) {
            switch (data.type) {
                case 'login-success':
                    this._reconnectAttempts = 0;
                    this.myId = data.yourId;
                    this.players.set(this.myId, this.createPlayerInfo());
                    if (data.gameState) {
                        this.applyFullGameState(data.gameState.switches, data.gameState.variables);
                    }
                    if (Array.isArray(data.players)) {
                        for (const player of data.players) {
                            if (player.id !== this.myId) this.players.set(player.id, player.info);
                        }
                    }
                    this.offlineStateManager.clearState();
                    const scene = SceneManager._scene;
                    if (scene && scene.onConnectionSuccess) scene.onConnectionSuccess();
                    NetworkManager_Server.refreshPlayerListUI();
                    break;
                case 'player-joined':
                    this.players.set(data.playerId, data.playerInfo);
                    if (data.playerInfo) {
                        MultiplayerManager.instance.handlePlayerMapTransfer(data.playerId, data.playerInfo.mapId);
                    }
                    NetworkManager_Server.refreshPlayerListUI();
                    break;
                case 'player-left':
                    this.players.delete(data.playerId);
                    MultiplayerManager.instance.removeRemotePlayer(data.playerId);
                    NetworkManager_Server.refreshPlayerListUI();
                    break;
                case 'player-move':
                    if (data.from !== this.myId) this.updateRemotePlayer(data.from, data);
                    break;
                case 'player-meta':
                    if (data.from !== this.myId) this.updatePlayerInfo(data.from, data.info);
                    break;
                case 'map-transfer':
                    if (data.from !== this.myId) {
                        const playerInfo = this.players.get(data.from);
                        if (playerInfo) playerInfo.mapId = data.mapId;
                        MultiplayerManager.instance.handlePlayerMapTransfer(data.from, data.mapId);
                    }
                    break;
                case 'switch-change':
                    $gameSwitches.setValue(data.id, data.value, true);
                    break;
                case 'variable-change':
                    $gameVariables.setValue(data.id, data.value, true);
                    break;
                case 'player-state-change':
                    if (data.from !== this.myId) MultiplayerManager.instance.updateRemotePlayerState(data.from, data.state);
                    break;
                case 'party-invite-request':
                    PartyUIManager.instance.showInvitation(data.fromId, data.fromName);
                    break;
                case 'party-update':
                    this.party = data.party;
                    NetworkManager_Server.refreshPlayerListUI();
                    MultiplayerManager.instance.setupPlayerEvents();
                    if (SceneManager._scene && SceneManager._scene.refreshUIMultiplayer) SceneManager._scene.refreshUIMultiplayer();
                    break;
                case 'party-disband':
                    this.party = null;
                    NetworkManager_Server.refreshPlayerListUI();
                    MultiplayerManager.instance.setupPlayerEvents();
                    if (SceneManager._scene && SceneManager._scene.refreshUIMultiplayer) SceneManager._scene.refreshUIMultiplayer();
                    break;
                case 'force-teleport':
                    if (this.isInParty() && this.myId !== this.party.leaderId) {
                        $gamePlayer.reserveTransfer(data.mapId, data.x, data.y, data.direction, 2);
                    }
                    break;
                case 'server-full':
                    // Server refused the login: do not burn reconnect attempts on a full server.
                    this._intentionalDisconnect = true;
                    this.cancelReconnect();
                    NetworkManager_Server.updateUI(
                        T('Multiplayer.serverFull', { max: data.maxPlayers || '?' }), true);
                    break;
                case 'error':
                    NetworkManager_Server.updateUI(data.message || T('Multiplayer.serverError'), true);
                    break;
            }
        }

        applyFullGameState(switches, variables) {
            for (const id in switches) if (!ExcludedSwitches.includes(Number(id))) $gameSwitches.setValue(Number(id), switches[id], true);
            for (const id in variables) if (!ExcludedVariables.includes(Number(id))) $gameVariables.setValue(Number(id), variables[id], true);
        }

        updateRemotePlayer(playerId, data) { MultiplayerManager.instance.updateRemotePlayerPosition(playerId, data); }

        updatePlayerInfo(playerId, info) {
            this.players.set(playerId, info);
            MultiplayerManager.instance.updateRemotePlayerGraphic(playerId, info.characterName, info.characterIndex);
            NetworkManager_Server.refreshPlayerListUI();
        }

        onSwitchChange(switchId, value) {
            if (this.isMultiplayer() && !ExcludedSwitches.includes(switchId)) this.send({ type: 'switch-change', id: switchId, value: value });
        }

        onVariableChange(variableId, value) {
            if (this.isMultiplayer() && !ExcludedVariables.includes(variableId)) this.send({ type: 'variable-change', id: variableId, value: value });
        }

        sendPartyInvite(targetId) { this.send({ type: 'party-invite', targetId: targetId }); }
        sendPartyAccept(inviterId) { this.send({ type: 'party-accept', inviterId: inviterId }); }
        sendPartyLeave() { this.send({ type: 'party-leave' }); }

        updateLocalPlayerPosition() {
            if (!this.isMultiplayer() || !$gamePlayer) return;
            const player = $gamePlayer;
            const lastState = this.lastPlayerState;
            const hasChanged = lastState.x !== player.x || lastState.y !== player.y || lastState.direction !== player.direction() || lastState.pattern !== player.pattern();

            if (hasChanged) {
                const newState = { x: player.x, y: player.y, direction: player.direction(), pattern: player.pattern(), moveSpeed: player.realMoveSpeed() };
                this.send({ type: 'player-move', ...newState });
                this.lastPlayerState = newState;
            }
        }

        onMapTransfer() {
            if (this.isMultiplayer()) {
                this.send({ type: 'map-transfer', mapId: $gameMap.mapId() });
                const myInfo = this.players.get(this.myId);
                if (myInfo) myInfo.mapId = $gameMap.mapId();
            }
        }
    }


    // ============================================================================
    // MODE: STEAMWORKS (P2P LOBBY ARCHITECTURE)
    // ============================================================================
    class NetworkManager_Steam {
        constructor() {
            this.myId = null;
            this.mySteamId = this.resolveMySteamId();
            this.roomId = null;
            this.isLeader = false;
            this.players = new Map();
            this.steamToInternalId = new Map();
            this.internalToSteamId = new Map();
            this.pendingTeleport = false;
            this.lastPlayerState = {};
            this.followLeader = true;
            this.offlineStateManager = new OfflineStateManager();
            this.leaderQueue = [];
            this.excludedSelfSwitches = new Set();
            this.lobby = null;
            this._callbacksBound = false;

            if (steamClient) this.setupSteamCallbacks();
        }

        static get instance() {
            if (!this._instance) this._instance = new NetworkManager_Steam();
            return this._instance;
        }

        resolveMySteamId() {
            if (!steamClient) return null;
            try {
                const lp = steamClient.localplayer;
                if (lp && typeof lp.getSteamId === 'function') return steamIdToString(lp.getSteamId());
                if (typeof steamClient.getSteamId === 'function') return steamIdToString(steamClient.getSteamId());
            } catch (e) { /* not available */ }
            return null;
        }

        setupSteamCallbacks() {
            if (this._callbacksBound || !steamClient || !steamClient.callback) return;
            this._callbacksBound = true;

            // Auto-accept incoming P2P sessions from lobby peers.
            registerSteamCallback('P2PSessionRequest', (data) => {
                const remote = data && (data.remote !== undefined ? data.remote : data.steamIdRemote);
                if (remote != null) p2pAccept(steamIdToString(remote));
            });

            // Track lobby membership so the host can assign/drop player slots.
            // steamworks.js payload keys are snake_case: { user_changed, member_state_change }.
            registerSteamCallback('LobbyChatUpdate', (update) => {
                if (!update) return;
                const changed = update.user_changed !== undefined ? update.user_changed
                    : (update.userChanged !== undefined ? update.userChanged : update.user);
                const changedId = steamIdToString(changed);
                if (!changedId || changedId === this.mySteamId) return;
                const stateChange = update.member_state_change !== undefined ? update.member_state_change : update.memberStateChange;
                if (steamMemberJoined(stateChange)) this.handlePlayerJoinedLobby(changedId);
                else if (steamMemberGone(stateChange)) this.handlePlayerLeftLobby(changedId);
            });

            // "Join Game" from the Steam friends list / chat. Because our rich-presence
            // "connect" value is "+connect_lobby <id>", Steam routes the join through
            // GameLobbyJoinRequested (payload key: lobby_steam_id) rather than the
            // custom-string GameRichPresenceJoinRequested callback.
            registerSteamCallback('GameLobbyJoinRequested', (data) => {
                const lobbyId = steamIdToString(data && (data.lobby_steam_id || data.lobbySteamId || data.steamIdLobby || data.lobby));
                if (lobbyId) SteamJoinRequest.handle(lobbyId);
            });
            // Custom (non-lobby) connect strings, if a future build exposes this callback.
            registerSteamCallback('GameRichPresenceJoinRequested', (data) => {
                const lobbyId = parseConnectLobby(data && data.connect);
                if (lobbyId) SteamJoinRequest.handle(lobbyId);
            });
        }

        static refreshPlayerListUI() {
            const scene = SceneManager._scene;
            if (scene instanceof Scene_Map && scene._playerListWindow) scene._playerListWindow.refresh();
        }

        isConnected() { return !!this.roomId; }
        isMultiplayer() { return !!this.myId; }
        isInParty() { return false; }

        requestLeaderTeleport() {
            if (!this.isMultiplayer() || this.isLeader) return;
            const leaderId = this.getCurrentLeaderId();
            if (leaderId) this.sendTo(leaderId, { type: 'request-teleport' });
        }

        sendTeleportPosition(playerId) {
            if (!this.isLeader || !$gamePlayer) return;
            this.sendTo(playerId, { type: 'teleport-position', mapId: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, direction: $gamePlayer.direction() });
        }

        static updateUI(text, isError = false) {
            const scene = SceneManager._scene;
            if (scene && scene.updateStatus) scene.updateStatus(text, isError);
        }

        async initiateCreateRoom(followLeader = true) {
            if (!steamClient) return;
            try {
                this.offlineStateManager.saveCurrentState();
                this.isLeader = true;
                this.myId = 1;
                this.followLeader = followLeader;
                NetworkManager_Steam.updateUI(T('Multiplayer.creatingLobby'));
                this.lobby = await steamClient.matchmaking.createLobby(swEnum('LobbyType.FriendsOnly', 1), STEAM_MAX_PLAYERS);
                this.roomId = this.lobby.id.toString();
                if (typeof this.lobby.setJoinable === 'function') this.lobby.setJoinable(true);
                setSteamConnect(this.roomId); // enables "Join Game" in Steam chat / friends list

                this.players.set(this.myId, this.createPlayerInfo());
                this.steamToInternalId.set(this.mySteamId, this.myId);
                this.internalToSteamId.set(this.myId, this.mySteamId);
                this.leaderQueue = [this.myId];

                if (SceneManager._scene && SceneManager._scene.onRoomSetupSuccess) SceneManager._scene.onRoomSetupSuccess(true);
            } catch (e) {
                NetworkManager_Steam.updateUI(T('Multiplayer.createLobbyFailed'), true);
                this.offlineStateManager.clearState();
            }
        }

        async initiateJoinRoom(roomId, followLeader = true) {
            if (!steamClient) return;
            try {
                this.offlineStateManager.saveCurrentState();
                this.isLeader = false;
                this.followLeader = followLeader;
                NetworkManager_Steam.updateUI(T('Multiplayer.joiningLobby', { id: roomId }));
                this.lobby = await steamClient.matchmaking.joinLobby(toBig(roomId));
                this.roomId = this.lobby.id.toString();
                setSteamConnect(this.roomId); // let our own friends "Join Game" onward

                const owner = typeof this.lobby.getOwner === 'function'
                    ? this.lobby.getOwner()
                    : (steamClient.matchmaking.getLobbyOwner ? steamClient.matchmaking.getLobbyOwner(this.lobby.id) : null);
                const ownerId = steamIdToString(owner);
                if (!ownerId) throw new Error('Could not resolve lobby owner');
                p2pAccept(ownerId);
                this.sendToSteamId(ownerId, { type: 'join-request', steamId: this.mySteamId, playerInfo: this.createPlayerInfo() });
            } catch (e) {
                NetworkManager_Steam.updateUI(T('Multiplayer.joinLobbyFailed', { id: roomId }), true);
                this.offlineStateManager.clearState();
            }
        }

        handlePlayerJoinedLobby(steamId) {
            if (this.isLeader) {
                let assignedId = 2;
                while (this.internalToSteamId.has(assignedId) && assignedId <= STEAM_MAX_PLAYERS) assignedId++;
                if (assignedId <= STEAM_MAX_PLAYERS) {
                    this.steamToInternalId.set(steamId, assignedId);
                    this.internalToSteamId.set(assignedId, steamId);
                }
            }
        }

        handlePlayerLeftLobby(steamId) {
            const internalId = this.steamToInternalId.get(steamId);
            if (internalId) this.handlePlayerDisconnect(internalId);
        }

        pollPackets() {
            if (!steamClient || !steamClient.networking || !this.roomId) return;
            const net = steamClient.networking;
            while (true) {
                const avail = net.isP2PPacketAvailable();
                if (!avail) break;
                const size = (typeof avail === 'number' && avail > 0) ? avail : 4096;
                const packet = net.readP2PPacket(size);
                if (!packet || !packet.data) break;
                try {
                    const data = JSON.parse(packet.data.toString('utf8'));
                    const senderSteamId = steamIdToString(packet.steamId !== undefined ? packet.steamId : packet.remote);
                    if (!senderSteamId) continue;
                    if (data.type === 'join-request' && this.isLeader) {
                        this.handleJoinRequest(senderSteamId, data.playerInfo);
                    } else if (data.type === 'room-joined') {
                        this.handleRoomJoined(data);
                    } else {
                        const fromId = this.steamToInternalId.get(senderSteamId);
                        if (fromId) this.handleGameMessage(fromId, data);
                    }
                } catch (e) { }
            }
        }

        handleJoinRequest(steamId, playerInfo) {
            const internalId = this.steamToInternalId.get(steamId);
            if (!internalId) return;

            this.players.set(internalId, playerInfo);
            this.leaderQueue.push(internalId);

            const otherPlayers = [];
            for (const [id, info] of this.players.entries()) {
                if (id !== internalId) otherPlayers.push({ id, steamId: this.internalToSteamId.get(id), info });
            }

            this.sendToSteamId(steamId, { type: 'room-joined', yourId: internalId, leaderId: this.myId, otherPlayers: otherPlayers });
            this.broadcast({ type: 'player-joined', playerId: internalId, steamId: steamId, playerInfo: playerInfo }, internalId);
            this.sendFullGameState(internalId);
            this.sendLeaderPosition(internalId);
            NetworkManager_Steam.refreshPlayerListUI();
        }

        handleRoomJoined(data) {
            this.myId = data.yourId;
            this.steamToInternalId.set(this.mySteamId, this.myId);
            this.internalToSteamId.set(this.myId, this.mySteamId);
            this.players.set(this.myId, this.createPlayerInfo());

            this.leaderQueue = [data.leaderId];
            for (const p of data.otherPlayers) {
                this.players.set(p.id, p.info);
                this.steamToInternalId.set(p.steamId, p.id);
                this.internalToSteamId.set(p.id, p.steamId);
                if (p.id !== data.leaderId) this.leaderQueue.push(p.id);
                p2pAccept(p.steamId);
            }
            this.leaderQueue.push(this.myId);
            NetworkManager_Steam.refreshPlayerListUI();
            // Mark the session live even when the join was driven by a Steam "Join Game"
            // request rather than the multiplayer menu (no onRoomSetupSuccess scene then).
            $gameSwitches.setValue(66, true, true);
            if (SceneManager._scene && SceneManager._scene.onRoomSetupSuccess) SceneManager._scene.onRoomSetupSuccess(false);
        }

        getCurrentLeaderId() { return this.leaderQueue.length > 0 ? this.leaderQueue[0] : null; }

        handlePlayerDisconnect(playerId) {
            const steamId = this.internalToSteamId.get(playerId);
            this.steamToInternalId.delete(steamId);
            this.internalToSteamId.delete(playerId);
            this.players.delete(playerId);

            const leaderIndex = this.leaderQueue.indexOf(playerId);
            if (leaderIndex !== -1) this.leaderQueue.splice(leaderIndex, 1);

            MultiplayerManager.instance.removeRemotePlayer(playerId);
            NetworkManager_Steam.refreshPlayerListUI();

            if (playerId === this.getCurrentLeaderId() && this.leaderQueue.length > 0) this.handleLeaderHandoff();
            if (this.players.size === 1 && this.players.has(this.myId)) this.handleLastPlayer();
        }

        handleLeaderHandoff() {
            const newLeaderId = this.getCurrentLeaderId();
            if (newLeaderId === this.myId) {
                this.isLeader = true;
                this.broadcast({ type: 'leader-change', newLeaderId: this.myId });
                for (const playerId of this.players.keys()) if (playerId !== this.myId) this.sendFullGameState(playerId);
            }
        }

        handleLastPlayer() {
            this.offlineStateManager.restoreState(false);
            MultiplayerManager.instance.clearRemotePlayers();
        }

        cleanup() {
            if (this.lobby && steamClient) {
                try {
                    if (typeof this.lobby.leave === 'function') this.lobby.leave();
                    else if (steamClient.matchmaking && steamClient.matchmaking.leaveLobby) steamClient.matchmaking.leaveLobby(toBig(this.roomId));
                } catch (e) { /* already gone */ }
            }
            clearSteamConnect(); // removes "Join Game" from our friends' view
            this.players.clear();
            this.steamToInternalId.clear();
            this.internalToSteamId.clear();
            this.leaderQueue = [];
            MultiplayerManager.instance.clearRemotePlayers();
            NetworkManager_Steam.refreshPlayerListUI();
            this.myId = null;
            this.roomId = null;
            this.lobby = null;
            this.isLeader = false;
            this.pendingTeleport = false;
            this.lastPlayerState = {};
            this.offlineStateManager.clearState();
            $gameSwitches.setValue(66, false);
        }

        disconnect(restoreState = true) {
            if (restoreState && this.myId) this.offlineStateManager.restoreState(true);
            this.cleanup();
        }

        broadcast(data, excludeInternalId = null) {
            if (!this.isMultiplayer() || !steamClient) return;
            const buffer = Buffer.from(JSON.stringify(data), 'utf8');
            for (const [internalId, steamId] of this.internalToSteamId.entries()) {
                if (internalId !== this.myId && internalId !== excludeInternalId) p2pSend(steamId, buffer);
            }
        }

        sendTo(internalId, data) {
            if (!this.isMultiplayer() || !steamClient) return;
            const steamId = this.internalToSteamId.get(internalId);
            if (steamId) p2pSend(steamId, Buffer.from(JSON.stringify(data), 'utf8'));
        }

        sendToSteamId(steamId, data) {
            if (!steamClient) return;
            p2pSend(steamId, Buffer.from(JSON.stringify(data), 'utf8'));
        }

        handleGameMessage(fromId, data) {
            data.from = fromId;
            this.processGameMessage(data);
            if (this.isLeader && data.type !== 'join-request') this.broadcast(data, fromId);
        }

        handleTeleportPosition(data) {
            if (this.isLeader) return;
            if ($gameMap.mapId() !== data.mapId) {
                this.pendingTeleport = true;
                $gamePlayer.reserveTransfer(data.mapId, data.x, data.y, data.direction, 0);
                $gamePlayer.requestMapReload();
            } else {
                $gamePlayer.locate(data.x, data.y);
                $gamePlayer.setDirection(data.direction);
            }
        }

        processGameMessage(data) {
            switch (data.type) {
                case 'full-state': this.applyFullGameState(data.switches, data.variables); break;
                case 'leader-change': this.handleLeaderChange(data.newLeaderId); break;
                case 'dungeon-data':
                    $gameSystem._dungeonFloors = JSON.parse(JSON.stringify(data.dungeonFloors));
                    $gameSystem._stairLocations = JSON.parse(JSON.stringify(data.stairLocations));
                    $gameSystem._dungeonGenerated = data.dungeonGenerated;
                    $gameSystem._mapRegion13Cache = JSON.parse(JSON.stringify(data.mapRegion13Cache || {}));
                    break;
                case 'leader-position': this.handleLeaderPosition(data); break;
                case 'request-teleport': if (this.isLeader) this.sendTeleportPosition(data.from); break;
                case 'teleport-position': this.handleTeleportPosition(data); break;
                case 'switch-change': $gameSwitches.setValue(data.id, data.value, true); break;
                case 'variable-change': $gameVariables.setValue(data.id, data.value, true); break;
                case 'self-switch-change':
                    if ($gameMap.mapId() === data.mapId) {
                        $gameSelfSwitches.setValue([data.mapId, data.eventId, data.switchType], data.value, true);
                        const event = $gameMap.event(data.eventId);
                        if (event) event.refresh();
                    }
                    break;
                case 'player-move': this.updateRemotePlayer(data.from, data); break;
                case 'player-meta': this.updatePlayerInfo(data.from, data.info); break;
                case 'player-joined':
                    this.players.set(data.playerId, data.playerInfo);
                    this.steamToInternalId.set(data.steamId, data.playerId);
                    this.internalToSteamId.set(data.playerId, data.steamId);
                    this.leaderQueue.push(data.playerId);
                    NetworkManager_Steam.refreshPlayerListUI();
                    break;
                case 'full-self-switches':
                    for (const keyString in data.selfSwitches) {
                        const keyParts = keyString.split(',');
                        $gameSelfSwitches.setValue([parseInt(keyParts[0], 10), parseInt(keyParts[1], 10), keyParts[2]], data.selfSwitches[keyString], true);
                    }
                    break;
                case 'player-state-change': MultiplayerManager.instance.updateRemotePlayerState(data.from, data.state); break;
                case 'map-transfer':
                    const playerInfo = this.players.get(data.from);
                    if (playerInfo) playerInfo.mapId = data.mapId;
                    MultiplayerManager.instance.handlePlayerMapTransfer(data.from, data.mapId);
                    break;
            }
        }

        handleLeaderChange(newLeaderId) {
            const leaderIndex = this.leaderQueue.indexOf(newLeaderId);
            if (leaderIndex !== -1) {
                this.leaderQueue.splice(leaderIndex, 1);
                this.leaderQueue.unshift(newLeaderId);
            }
            if (newLeaderId === this.myId) this.isLeader = true;
        }

        sendLeaderPosition(playerId) {
            if (!this.isLeader || !$gamePlayer) return;
            this.sendTo(playerId, { type: 'leader-position', mapId: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y });
        }

        handleLeaderPosition(data) {
            if (this.isLeader || !this.followLeader) return;
            if ($gameMap.mapId() !== data.mapId) {
                this.pendingTeleport = true;
                $gamePlayer.reserveTransfer(data.mapId, data.x, data.y, 2, 0);
                $gamePlayer.requestMapReload();
            }
        }

        steamName() {
            const lp = steamClient && steamClient.localplayer;
            if (lp && typeof lp.getName === 'function') return lp.getName();
            if (steamClient && typeof steamClient.getName === 'function') return steamClient.getName();
            return null;
        }

        createPlayerInfo() {
            const leader = $gameParty.leader();
            const actor = $gameActors.actor(1);
            return {
                name: this.steamName() || actor.name(),
                className: actor.currentClass().name,
                characterName: leader.characterName(),
                characterIndex: leader.characterIndex(),
                faceName: leader.faceName(),
                faceIndex: leader.faceIndex(),
                mapId: $gameMap.mapId()
            };
        }

        updatePlayerInfo(playerId, info) {
            this.players.set(playerId, info);
            MultiplayerManager.instance.updateRemotePlayerGraphic(playerId, info.characterName, info.characterIndex);
            NetworkManager_Steam.refreshPlayerListUI();
        }

        onSwitchChange(switchId, value) {
            if (this.isMultiplayer() && !ExcludedSwitches.includes(switchId)) this.broadcast({ type: 'switch-change', id: switchId, value: value });
        }

        shouldSyncSelfSwitch(mapId, eventId, switchType) {
            const eventName = $dataMap && $dataMap.events && $dataMap.events[eventId] ? $dataMap.events[eventId].name : '';
            if (eventName.match(/^Player\d+$/)) return false;
            return !this.excludedSelfSwitches.has(`${mapId}_${eventId}`);
        }

        onVariableChange(variableId, value) {
            if (this.isMultiplayer() && !ExcludedVariables.includes(variableId)) this.broadcast({ type: 'variable-change', id: variableId, value: value });
        }

        onSelfSwitchChange(mapId, eventId, switchType, value) {
            if (this.isMultiplayer() && this.shouldSyncSelfSwitch(mapId, eventId, switchType)) {
                this.broadcast({ type: 'self-switch-change', mapId: mapId, eventId: eventId, switchType: switchType, value: value });
            }
        }

        sendFullGameState(targetPlayerId) {
            if (!this.isLeader) return;
            const switches = {};
            const variables = {};
            const selfSwitches = {};
            for (let i = 1; i < $dataSystem.switches.length; i++) if (!ExcludedSwitches.includes(i)) switches[i] = $gameSwitches.value(i);
            for (let i = 1; i < $dataSystem.variables.length; i++) if (!ExcludedVariables.includes(i)) variables[i] = $gameVariables.value(i);
            for (const key in $gameSelfSwitches._data) {
                const [mapId, eventId, switchType] = key.split(',').map((v, i) => i < 2 ? parseInt(v) : v);
                if (this.shouldSyncSelfSwitch(mapId, eventId, switchType)) selfSwitches[key] = $gameSelfSwitches._data[key];
            }
            this.sendTo(targetPlayerId, { type: 'full-state', switches, variables });
            this.sendTo(targetPlayerId, { type: 'full-self-switches', selfSwitches: selfSwitches });

            if ($gameSystem._dungeonFloors && $gameSystem._stairLocations && $gameSystem._dungeonGenerated) {
                this.sendTo(targetPlayerId, { type: 'dungeon-data', dungeonFloors: JSON.parse(JSON.stringify($gameSystem._dungeonFloors)), stairLocations: JSON.parse(JSON.stringify($gameSystem._stairLocations)), dungeonGenerated: $gameSystem._dungeonGenerated, mapRegion13Cache: JSON.parse(JSON.stringify($gameSystem._mapRegion13Cache || {})) });
            }

            for (const [id, player] of this.players.entries()) if (id !== targetPlayerId) this.sendTo(targetPlayerId, { type: 'player-meta', from: id, info: player });
        }

        applyFullGameState(switches, variables) {
            for (const id in switches) $gameSwitches.setValue(Number(id), switches[id], true);
            for (const id in variables) $gameVariables.setValue(Number(id), variables[id], true);
        }

        updateLocalPlayerPosition() {
            if (!this.isMultiplayer() || !$gamePlayer) return;
            const player = $gamePlayer;
            const lastState = this.lastPlayerState;
            const hasChanged = lastState.x !== player.x || lastState.y !== player.y || lastState.direction !== player.direction() || lastState.pattern !== player.pattern() || lastState.opacity !== player.opacity();

            if (hasChanged) {
                const newState = { x: player.x, y: player.y, direction: player.direction(), pattern: player.pattern(), moveSpeed: player.realMoveSpeed(), opacity: player.opacity(), blendMode: player.blendMode() };
                const message = { type: 'player-move', ...newState };
                const myMapId = $gameMap.mapId();
                for (const [playerId, playerInfo] of this.players.entries()) {
                    if (playerId === this.myId) continue;
                    if (playerInfo.mapId === myMapId) this.sendTo(playerId, message);
                }
                this.lastPlayerState = newState;
            }
        }

        updateRemotePlayer(playerId, data) { MultiplayerManager.instance.updateRemotePlayerPosition(playerId, data); }

        onMapTransfer() {
            if (this.isMultiplayer()) {
                this.broadcast({ type: 'map-transfer', mapId: $gameMap.mapId() });
                const myInfo = this.players.get(this.myId);
                if (myInfo) myInfo.mapId = $gameMap.mapId();
                if (this.isLeader) setTimeout(() => { for (const playerId of this.players.keys()) if (playerId !== this.myId) this.sendLeaderPosition(playerId); }, 100);
            }
        }
    }


    let NetworkManager = NetworkMode === 'Steamworks' ? NetworkManager_Steam : NetworkManager_Server;
    window.NetworkManager = NetworkManager;


    // ============================================================================
    // COMMON: MultiplayerManager
    // ============================================================================
    class MultiplayerManager {
        constructor() {
            this.playerEvents = new Map();
            this.eventPlayerMap = new Map();
            this.playerMovementQueue = new Map();
        }

        static get instance() {
            if (!this._instance) this._instance = new MultiplayerManager();
            return this._instance;
        }

        update() {
            NetworkManager.instance.pollPackets();
            if (NetworkManager.instance.isMultiplayer()) {
                NetworkManager.instance.updateLocalPlayerPosition();
                this.processMovementQueue();
            }
        }

        processMovementQueue() {
            for (const [playerId, movements] of this.playerMovementQueue.entries()) {
                if (movements.length === 0) continue;
                const event = this.getRemotePlayer(playerId);
                if (!event || event.isMoving()) continue;
                const nextMove = movements.shift();
                if (nextMove) this.executeMovement(event, nextMove);
            }
        }

        executeMovement(event, moveData) {
            event.setMoveSpeed(moveData.moveSpeed);
            event.setPattern(moveData.pattern || event.pattern());
            if (NetworkMode === 'Steamworks') {
                event.setOpacity(moveData.opacity === undefined ? 255 : moveData.opacity);
                event.setBlendMode(moveData.blendMode === undefined ? 0 : moveData.blendMode);
            }
            const dx = moveData.x - event.x;
            const dy = moveData.y - event.y;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) event.locate(moveData.x, moveData.y);
            else if (dx !== 0 || dy !== 0) {
                const sx = event.deltaXFrom(moveData.x);
                const sy = event.deltaYFrom(moveData.y);
                if (Math.abs(sx) > Math.abs(sy)) event.moveStraight(sx > 0 ? 4 : 6);
                else if (sy !== 0) event.moveStraight(sy > 0 ? 8 : 2);
            }
            event.setDirection(moveData.direction);
        }

        getRemotePlayer(id) { return this.playerEvents.has(id) ? $gameMap.event(this.playerEvents.get(id)) : null; }

        removeRemotePlayer(id) {
            const eventId = this.playerEvents.get(id);
            if (eventId) {
                const event = $gameMap.event(eventId);
                if (event) { event.setOpacity(0); event._characterName = ''; }
                this.playerEvents.delete(id);
                this.eventPlayerMap.delete(eventId);
                this.playerMovementQueue.delete(id);
            }
        }

        clearRemotePlayers() {
            for (const eventId of this.eventPlayerMap.keys()) {
                const event = $gameMap.event(eventId);
                if (event) { event.setOpacity(0); event._characterName = ''; }
            }
            this.playerEvents.clear();
            this.eventPlayerMap.clear();
            this.playerMovementQueue.clear();
        }

        onMapLoaded() {
            // Consume any pending Steam "Join Game" request now that we are in-world.
            if (typeof SteamJoinRequest !== 'undefined') SteamJoinRequest.tryConsume();
            if (NetworkManager.instance.isMultiplayer()) {
                NetworkManager.instance.onMapTransfer();
                this.setupPlayerEvents();
                if (NetworkMode === 'Steamworks' && NetworkManager.instance.pendingTeleport && !NetworkManager.instance.isLeader && NetworkManager.instance.followLeader) {
                    NetworkManager.instance.pendingTeleport = false;
                }
            }
        }

        setupPlayerEvents() {
            const MAX_MAP_SLOTS = NetworkMode === 'Steamworks' ? STEAM_MAX_PLAYERS : MAX_MAP_PLAYER_SLOTS;
            const playerEventNames = Array.from({ length: MAX_MAP_SLOTS }, (_, i) => `Player${i + 1}`);  // i18n-ignore  event names
            this.playerEvents.clear();
            this.eventPlayerMap.clear();
            this.playerMovementQueue.clear();

            if (!$dataMap.events) return;

            const nm = NetworkManager.instance;
            const myId = nm.myId;
            const currentMapId = $gameMap.mapId();
            const availableSlots = [];

            for (const event of $dataMap.events) {
                if (event && playerEventNames.includes(event.name)) {
                    availableSlots.push(event);
                    const mapEvent = $gameMap.event(event.id);
                    if (mapEvent) { mapEvent.setOpacity(0); mapEvent._characterName = ''; }
                }
            }

            availableSlots.sort((a, b) => parseInt(a.name.replace('Player', '')) - parseInt(b.name.replace('Player', '')));  // i18n-ignore  event names

            const partyMembers = nm.isInParty() ? nm.party.members : [];
            const partyPlayersOnMap = [];
            const otherPlayersOnMap = [];

            for (const [playerId, playerInfo] of nm.players.entries()) {
                if (playerId === myId || !playerInfo || playerInfo.mapId !== currentMapId) continue;
                const playerData = { id: playerId, info: playerInfo };
                if (partyMembers.includes(playerId)) partyPlayersOnMap.push(playerData);
                else otherPlayersOnMap.push(playerData);
            }

            const playersToDisplay = [...partyPlayersOnMap, ...otherPlayersOnMap].slice(0, MAX_MAP_SLOTS);

            for (let i = 0; i < playersToDisplay.length; i++) {
                const player = playersToDisplay[i];
                const eventData = availableSlots[i];
                if (player && eventData) {
                    this.playerEvents.set(player.id, eventData.id);
                    this.eventPlayerMap.set(eventData.id, player.id);
                    this.playerMovementQueue.set(player.id, []);
                    const event = $gameMap.event(eventData.id);
                    if (event) {
                        event._characterName = player.info.characterName;
                        event._characterIndex = player.info.characterIndex;
                        event.locate(player.info.x, player.info.y);
                        event.setDirection(player.info.direction);
                        event.setOpacity(255);
                        event.refresh();
                    }
                }
            }
        }

        updateRemotePlayerPosition(playerId, data) {
            const playerInfo = NetworkManager.instance.players.get(playerId);
            if (playerInfo) { playerInfo.x = data.x; playerInfo.y = data.y; playerInfo.direction = data.direction; }
            const event = this.getRemotePlayer(playerId);
            if (!event) return;
            if (!this.playerMovementQueue.has(playerId)) this.playerMovementQueue.set(playerId, []);

            const queue = this.playerMovementQueue.get(playerId);
            const dx = Math.abs(data.x - event.x);
            const dy = Math.abs(data.y - event.y);

            if (dx > 3 || dy > 3 || queue.length > 8) {
                queue.length = 0;
                event.locate(data.x, data.y);
                this.executeMovement(event, data);
            } else { queue.push(data); }
        }

        updateRemotePlayerGraphic(playerId, characterName, characterIndex) {
            const event = this.getRemotePlayer(playerId);
            if (event) { event._characterName = characterName; event._characterIndex = characterIndex; event.refresh(); }
        }

        handlePlayerMapTransfer(playerId, mapId) {
            const playerInfo = NetworkManager.instance.players.get(playerId);
            if (playerInfo) playerInfo.mapId = mapId;
            if (mapId === $gameMap.mapId()) this.setupPlayerEvents();
            else {
                const event = this.getRemotePlayer(playerId);
                if (event) { event.setOpacity(0); event._characterName = ''; this.playerMovementQueue.delete(playerId); }
            }
        }

        updateRemotePlayerState(playerId, state) {
            const event = this.getRemotePlayer(playerId);
            if (!event) return;
            event.setOpacity(state === 'battling' ? 0 : 255);
        }
    }


    // ============================================================================
    // UI OVERLAYS & SCENES
    // ============================================================================

    // ----------------------------------------------------------------------------
    // Scene_MultiplayerTypeSelection
    // ----------------------------------------------------------------------------
    class Scene_MultiplayerTypeSelection extends Scene_MenuBase {
        create() {
            super.create();
            this.createHelpWindow();
            this.createCommandWindow();

            if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
            if (this._commandWindow) { this._commandWindow.deactivate(); this._commandWindow.hide(); }

            this._selectedIndex = 0;
            this.initUITypeSelectionDOM();
            this.refreshUITypeSelection();
        }

        update() {
            this.updateUITypeSelectionInput();
            super.update();
        }

        terminate() {
            const container = document.getElementById("mp-type-container");
            if (container) container.remove();
            super.terminate();
        }

        initUITypeSelectionDOM() {
            if (!document.getElementById("mp-type-container")) {
                const container = document.createElement("div");
                container.id = "mp-type-container";
                // Graphics._disableContextMenu() only ran over the boot-time DOM, so
                // suppress it here or right-click-to-go-back opens the native menu.
                container.oncontextmenu = () => false;
                document.body.appendChild(container);
            }
        }

        _typePortals(isIt, localActive) {
            return [
                {
                    name:T('Multiplayer.localMultiplayer'),
                    hint:T('Multiplayer.splitScreenCoOp'),
                    desc:T('Multiplayer.startALocalSplitScreen'),
                    action: localActive ? (T('Multiplayer.disconnect')) : (T('Multiplayer.start')),
                    danger: localActive,
                },
                {
                    name:T('Multiplayer.steamMultiplayer'),
                    hint:   NETWORK_PLAY_ENABLED
                        ? T('Multiplayer.hintSteamLobby')
                        : T('Multiplayer.unavailable'),
                    desc:   NETWORK_PLAY_ENABLED
                        ? (T('Multiplayer.connectWithOtherPlayersVia'))
                        : (T('Multiplayer.steamP2pLobbiesAreNot')),
                    action: NETWORK_PLAY_ENABLED
                        ? (T('Multiplayer.openLobby'))
                        : (T('Multiplayer.unavailable')),
                    danger: false,
                    disabled: !NETWORK_PLAY_ENABLED,
                },
                {
                    name:T('Multiplayer.onlineMultiplayer'),
                    hint:   NETWORK_PLAY_ENABLED
                        ? T('Multiplayer.hintCentralServer')
                        : T('Multiplayer.unavailable'),
                    desc:   NETWORK_PLAY_ENABLED
                        ? (T('Multiplayer.connectToACentralWebsocket'))
                        : (T('Multiplayer.onlinePlayIsNotAvailable')),
                    action: NETWORK_PLAY_ENABLED
                        ? (T('Multiplayer.connect'))
                        : (T('Multiplayer.unavailable')),
                    danger: false,
                    disabled: !NETWORK_PLAY_ENABLED,
                }
            ];
        }

        refreshUITypeSelection() {
            const container = document.getElementById("mp-type-container");
            if (!container) return;

            const isIt = ConfigManager.language === 'it';
            const localActive = window.SplitScreenManager && window.SplitScreenManager.active;
            const portals = this._typePortals(isIt, localActive);
            const sel = portals[this._selectedIndex];

            const optionsHTML = portals.map((p, i) => `
                <div class="mp-option-row ${this._selectedIndex === i ? 'selected' : ''} ${p.disabled ? 'disabled' : ''}" data-idx="${i}">
                    <span class="mp-option-name">${p.name}</span>
                    <span class="mp-option-hint">${p.hint}</span>
                </div>
            `).join('');

            const localBadge = (this._selectedIndex === 0 && localActive)
                ? `<span class="mp-local-badge">${T('Multiplayer.sessionActive')}</span>`
                : '';

            container.innerHTML = `
                <div class="book-spread">
                    <div class="left-page" style="justify-content:flex-start;">
                        <div class="page-header-bar">
                            <button class="back-button" id="mp-type-back">${T('Multiplayer.back')}</button>
                            <h2 class="title">${T('Multiplayer.ui.title')}</h2>
                        </div>
                        <div class="mp-selected-detail">
                            <h3 class="mp-detail-name" id="mp-detail-name">${sel.name}</h3>
                            <p class="mp-detail-desc" id="mp-detail-desc">${sel.desc}</p>
                            <span id="mp-local-badge">${localBadge}</span>
                        </div>
                        <div class="inspect-actions" style="margin-top:auto;">
                            <div class="inspect-btn ${sel.danger ? 'inspect-btn--danger' : ''} ${sel.disabled ? 'inspect-btn--disabled' : ''}" id="mp-type-action">${sel.action}</div>
                        </div>
                    </div>
                    <div class="right-page" style="justify-content:flex-start;gap:12px;">
                        <div class="page-header-bar">
                            <h2 class="title">${T('Multiplayer.mode')}</h2>
                        </div>
                        ${optionsHTML}
                    </div>
                </div>
            `;

            document.getElementById('mp-type-back')?.addEventListener('click', () => {
                SoundManager.playCancel();
                this.popScene();
            });
            document.getElementById('mp-type-action')?.addEventListener('click', () => {
                this.executeSelectedPortal();
            });
            container.querySelectorAll('.mp-option-row').forEach(row => {
                row.addEventListener('click', () => {
                    const idx = parseInt(row.getAttribute('data-idx'));
                    if (idx === this._selectedIndex) { this.executeSelectedPortal(); return; }
                    this._selectedIndex = idx;
                    SoundManager.playCursor();
                    this._updateTypeSelectionHighlight();
                });
            });
        }

        _updateTypeSelectionHighlight() {
            const container = document.getElementById("mp-type-container");
            if (!container) return;

            const isIt = ConfigManager.language === 'it';
            const localActive = window.SplitScreenManager && window.SplitScreenManager.active;
            const portals = this._typePortals(isIt, localActive);
            const sel = portals[this._selectedIndex];

            container.querySelectorAll('.mp-option-row').forEach((row, i) => {
                row.classList.toggle('selected', i === this._selectedIndex);
            });

            const nameEl   = document.getElementById('mp-detail-name');
            const descEl   = document.getElementById('mp-detail-desc');
            const badgeEl  = document.getElementById('mp-local-badge');
            const actionEl = document.getElementById('mp-type-action');

            if (nameEl)   nameEl.textContent  = sel.name;
            if (descEl)   descEl.textContent  = sel.desc;
            if (badgeEl)  badgeEl.innerHTML   = (this._selectedIndex === 0 && localActive)
                ? `<span class="mp-local-badge">${T('Multiplayer.sessionActive')}</span>`
                : '';
            if (actionEl) {
                actionEl.textContent = sel.action;
                actionEl.classList.toggle('inspect-btn--danger', !!sel.danger);
                actionEl.classList.toggle('inspect-btn--disabled', !!sel.disabled);
            }
        }

        updateUITypeSelectionInput() {
            if (Input.isRepeated('down') || Input.isRepeated('right')) {
                this._selectedIndex = (this._selectedIndex + 1) % 3;
                SoundManager.playCursor();
                this._updateTypeSelectionHighlight();
            } else if (Input.isRepeated('up') || Input.isRepeated('left')) {
                this._selectedIndex = (this._selectedIndex - 1 + 3) % 3;
                SoundManager.playCursor();
                this._updateTypeSelectionHighlight();
            } else if (Input.isTriggered('ok')) {
                this.executeSelectedPortal();
            } else if (Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                // TouchInput.isCancelled() is the right mouse button.
                SoundManager.playCancel();
                this.popScene();
            }
        }

        executeSelectedPortal() {
            const isIt = ConfigManager.language === 'it';
            const portal = this._typePortals(isIt, window.SplitScreenManager && window.SplitScreenManager.active)[this._selectedIndex];
            if (portal && portal.disabled) {
                SoundManager.playBuzzer();
                return;
            }
            SoundManager.playOk();
            if (this._selectedIndex === 0) {
                const localActive = window.SplitScreenManager && window.SplitScreenManager.active;
                if (localActive) {
                    this.commandDisconnectLocal();
                } else {
                    this.commandLocal();
                }
            } else if (this._selectedIndex === 1) {
                this.commandSteam();
            } else if (this._selectedIndex === 2) {
                this.commandServer();
            }
        }

        createHelpWindow() {
            const rect = new Rectangle(0, this.mainAreaTop(), Graphics.boxWidth, this.calcWindowHeight(1, false));
            this._helpWindow = new Window_Help(rect);
            this.addWindow(this._helpWindow);
        }

        createCommandWindow() {
            const rect = new Rectangle(0, 0, 400, 300);
            this._commandWindow = new Window_MultiplayerTypeSelection(rect);
            this._commandWindow.setHandler("local", this.commandLocal.bind(this));
            this._commandWindow.setHandler("steam", this.commandSteam.bind(this));
            this._commandWindow.setHandler("server", this.commandServer.bind(this));
            this._commandWindow.setHandler("disconnectLocal", this.commandDisconnectLocal.bind(this));
            this._commandWindow.setHandler("cancel", this.popScene.bind(this));
            this.addWindow(this._commandWindow);
        }

        commandLocal() {
            if (typeof Scene_SplitScreenCharacterSelection !== 'undefined') {
                SceneManager.push(Scene_SplitScreenCharacterSelection);
            }
        }

        commandDisconnectLocal() {
            if (window.SplitScreenManager) {
                window.SplitScreenManager.stopSession();
                this.refreshUITypeSelection();
                this._helpWindow.setText(T('Multiplayer.splitScreenTerminated'));
            }
        }

        commandSteam() {
            if (!NETWORK_PLAY_ENABLED) {
                this._helpWindow.setText(T('Multiplayer.steamNotAvailable'));
                return;
            }
            if (initSteam()) {
                NetworkMode = 'Steamworks';
                window.NetworkMode = NetworkMode;
                NetworkManager = NetworkManager_Steam;
                window.NetworkManager = NetworkManager;
                SceneManager.push(Scene_Multiplayer);
            } else {
                this._helpWindow.setText(T('Multiplayer.steamInitFailed'));
            }
        }

        commandServer() {
            if (!NETWORK_PLAY_ENABLED) {
                this._helpWindow.setText(T('Multiplayer.onlineNotAvailable'));
                return;
            }
            NetworkMode = 'WebSocket';
            window.NetworkMode = NetworkMode;
            NetworkManager = NetworkManager_Server;
            window.NetworkManager = NetworkManager;
            SceneManager.push(Scene_Multiplayer);
        }
    }

    class Window_MultiplayerTypeSelection extends Window_Command {
        makeCommandList() {
            if (window.SplitScreenManager && window.SplitScreenManager.active) {
                this.addCommand(T('Multiplayer.disconnectSplitScreen'), "disconnectLocal");
            } else {
                this.addCommand(T('Multiplayer.localMultiplayer'), "local");
                this.addCommand(T('Multiplayer.steamMultiplayerCmd'), "steam", NETWORK_PLAY_ENABLED);
                this.addCommand(T('Multiplayer.customServer'), "server", NETWORK_PLAY_ENABLED);
            }
        }
    }

    window.Scene_MultiplayerTypeSelection = Scene_MultiplayerTypeSelection;


    // ----------------------------------------------------------------------------
    // Scene_Multiplayer
    // ----------------------------------------------------------------------------
    class Scene_Multiplayer extends Scene_MenuBase {
        constructor() {
            super();
            this._serverUrl = localStorage.getItem('gmn_mp_serverUrl') || params.serverUrl || 'wss://hypernet-explorer-signaling-server.onrender.com';
            this._roomCode = NetworkManager.instance.roomId || '';
            this._followLeader = localStorage.getItem('gmn_mp_followLeader') !== 'false';

            this._activeArea = 'menu';
            this._selectedIndex = 0;
            this._selectedPlayerIndex = 0;
            this._activeTab = 0;
            this._statusMessage = '';
        }

        create() {
            super.create();
            this.createHelpWindow();
            this.createInputWindow();
            this.createStatusWindow();
            if (NetworkMode === 'WebSocket') {
                this.createPlayerListWindow();
                this.createPartyWindow();
            }
            if (NetworkManager.instance.isMultiplayer() && NetworkMode === 'Steamworks') {
                this._statusMessage = T('Multiplayer.connectedToLobby', { id: NetworkManager.instance.roomId });
            }

            if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
            if (this._inputWindow) { this._inputWindow.deactivate(); this._inputWindow.hide(); }
            if (this._statusWindow) { this._statusWindow.hide(); }
            if (this._playerListWindow) { this._playerListWindow.deactivate(); this._playerListWindow.hide(); }
            if (this._partyWindow) { this._partyWindow.deactivate(); this._partyWindow.hide(); }

            this.initUIMultiplayerDOM();
            this.refreshUIMultiplayer();
        }

        update() {
            super.update();
            NetworkManager.instance.pollPackets();
            this.refreshUIMultiplayer();
            this.updateUIMultiplayerInput();
        }

        terminate() {
            const container = document.getElementById("mp-container");
            if (container) container.remove();
            super.terminate();
        }

        initUIMultiplayerDOM() {
            if (!document.getElementById("mp-container")) {
                const container = document.createElement("div");
                container.id = "mp-container";
                container.oncontextmenu = () => false;
                document.body.appendChild(container);
            }
        }

        refreshUIMultiplayer() {
            const container = document.getElementById("mp-container");
            if (!container) return;

            const nm = NetworkManager.instance;
            const connected = nm.isMultiplayer();
            const lang = ConfigManager.language || 'en';
            const isIt = lang === 'it';

            // Pulse status
            const statusClass = connected ? "online" : "offline";
            const statusLabel = connected ? (T('Multiplayer.online')) : (T('Multiplayer.offline'));

            // Left Console Rows
            let configRowsHTML = "";
            let actionBtnsHTML = "";

            if (NetworkMode === 'WebSocket') {
                const rowUrlFocused = this._activeArea === 'menu' && this._selectedIndex === 0;
                configRowsHTML += `
                    <div class="console-row ${rowUrlFocused ? 'focused' : ''}" id="row-url">
                        <span class="row-lbl">${T('Multiplayer.serverUrl')}</span>
                        <span class="row-val">${this._serverUrl}</span>
                    </div>
                `;

                const btnActionFocused = this._activeArea === 'menu' && this._selectedIndex === 1;
                if (connected) {
                    actionBtnsHTML += `
                        <div class="action-btn disconnect ${btnActionFocused ? 'focused' : ''}" id="btn-disconnect">
                            ${T('Multiplayer.severLinkDisconnect')}
                        </div>
                    `;
                } else {
                    actionBtnsHTML += `
                        <div class="action-btn ${btnActionFocused ? 'focused' : ''}" id="btn-connect">
                            ${T('Multiplayer.establishLinkConnect')}
                        </div>
                    `;
                }
            } else {
                // Steamworks Mode
                const rowCodeFocused = this._activeArea === 'menu' && this._selectedIndex === 0;
                configRowsHTML += `
                    <div class="console-row ${rowCodeFocused ? 'focused' : ''}" id="row-code">
                        <span class="row-lbl">${T('Multiplayer.lobbyId')}</span>
                        <span class="row-val">${this._roomCode || (T('Multiplayer.clickToEdit'))}</span>
                    </div>
                `;

                const rowFollowFocused = this._activeArea === 'menu' && this._selectedIndex === 1;
                configRowsHTML += `
                    <div class="console-row ${rowFollowFocused ? 'focused' : ''}" id="row-follow">
                        <span class="row-lbl">${T('Multiplayer.followLeader')}</span>
                        <span class="row-val" style="color:${this._followLeader ? 'var(--text-cost-ok)' : 'var(--text-cost-bad)'};">${this._followLeader ? 'ON' : 'OFF'}</span>
                    </div>
                `;

                if (connected) {
                    const isLeader = nm.isLeader;
                    let teleportBtnHTML = "";
                    if (!isLeader) {
                        const btnTeleportFocused = this._activeArea === 'menu' && this._selectedIndex === 2;
                        teleportBtnHTML = `
                            <div class="action-btn ${btnTeleportFocused ? 'focused' : ''}" id="btn-teleport">
                                ${T('Multiplayer.teleportToLeader')}
                            </div>
                        `;
                    }

                    const btnDisconnectIdx = isLeader ? 2 : 3;
                    const btnDisconnectFocused = this._activeArea === 'menu' && this._selectedIndex === btnDisconnectIdx;

                    actionBtnsHTML += `
                        ${teleportBtnHTML}
                        <div class="action-btn disconnect ${btnDisconnectFocused ? 'focused' : ''}" id="btn-disconnect">
                            ${T('Multiplayer.severLinkDisconnect')}
                        </div>
                    `;
                } else {
                    const btnCreateFocused = this._activeArea === 'menu' && this._selectedIndex === 2;
                    const btnJoinFocused = this._activeArea === 'menu' && this._selectedIndex === 3;

                    actionBtnsHTML += `
                        <div class="action-btn ${btnCreateFocused ? 'focused' : ''}" id="btn-create">
                            ${T('Multiplayer.forgeSteamLobby')}
                        </div>
                        <div class="action-btn ${btnJoinFocused ? 'focused' : ''}" id="btn-join">
                            ${T('Multiplayer.joinLobbyById')}
                        </div>
                    `;
                }
            }

            // Right Console Comms / Roster lists
            let rosterTabsHTML = "";
            let rosterListHTML = "";

            if (NetworkMode === 'WebSocket') {
                const tab1Active = this._activeTab === 0 ? "active" : "";
                const tab2Active = this._activeTab === 1 ? "active" : "";

                rosterTabsHTML = `
                    <div class="roster-tabs">
                        <div class="roster-tab ${tab1Active}" data-tab="0">${T('Multiplayer.activeNodes')}</div>
                        <div class="roster-tab ${tab2Active}" data-tab="1">${T('Multiplayer.partyPockets')}</div>
                    </div>
                `;

                if (this._activeTab === 0) {
                    // Node Catalog List
                    const myId = nm.myId;
                    const partyMembers = nm.isInParty() ? nm.party.members : [];
                    const activePlayers = Array.from(nm.players.entries()).filter(([id, _]) => id !== myId && !partyMembers.includes(id)).map(([id, info]) => ({ id, info }));

                    if (activePlayers.length === 0) {
                        rosterListHTML = `
                            <div class="item-grid-empty">
                                ${T('Multiplayer.noOtherNodesDetected')}
                            </div>
                        `;
                    } else {
                        activePlayers.forEach((player, index) => {
                            const isFocused = this._activeArea === 'roster' && this._selectedPlayerIndex === index;
                            rosterListHTML += `
                                <div class="node-card ${isFocused ? 'focused' : ''}" data-idx="${index}">
                                    ${this.drawNodeAvatarHTML(player.info.faceName, player.info.faceIndex)}
                                    <div class="node-info">
                                        <span class="node-name">${player.info.name}</span>
                                        <span class="node-subtitle">Map: ${player.info.mapId}</span>
                                    </div>
                                    <span class="node-badge">${T('Multiplayer.ui.invite')}</span>
                                </div>
                            `;
                        });
                    }
                } else {
                    // Party List
                    if (nm.isInParty()) {
                        nm.party.members.forEach((memberId, index) => {
                            const player = nm.players.get(memberId);
                            if (player) {
                                let label =T('Multiplayer.member');
                                if (memberId === nm.party.leaderId) label =T('Multiplayer.leader');
                                if (memberId === nm.myId) label += ` (${T('Multiplayer.you')})`;

                                rosterListHTML += `
                                    <div class="node-card" style="cursor:default;">
                                        ${this.drawNodeAvatarHTML(player.faceName, player.faceIndex)}
                                        <div class="node-info">
                                            <span class="node-name">${player.name}</span>
                                            <span class="node-subtitle">Map: ${player.mapId}</span>
                                        </div>
                                        <span class="node-badge">${label}</span>
                                    </div>
                                `;
                            }
                        });

                        const isLeaveFocused = this._activeArea === 'roster' && this._selectedPlayerIndex === nm.party.members.length;
                        rosterListHTML += `
                            <div class="action-btn disconnect ${isLeaveFocused ? 'focused' : ''}" id="btn-leave" style="margin-top:16px;">
                                ${T('Multiplayer.leaveParty')}
                            </div>
                        `;
                    } else {
                        rosterListHTML = `<div class="item-grid-empty">${T('Multiplayer.youAreNotCurrentlyTethered')}</div>`;
                    }
                }
            } else {
                // Steamworks Lobby Roster List
                rosterTabsHTML = `
                    <div class="roster-tabs">
                        <div class="roster-tab active" style="cursor:default;">${T('Multiplayer.lobbyRoster')}</div>
                    </div>
                `;

                const lobbyPlayers = [];
                for (const [id, info] of nm.players.entries()) {
                    lobbyPlayers.push({ id, info });
                }

                if (lobbyPlayers.length === 0) {
                    rosterListHTML = `<div class="item-grid-empty">${T('Multiplayer.noOtherNodesConnected')}</div>`;
                } else {
                    lobbyPlayers.forEach((player, index) => {
                        let roleLabel =T('Multiplayer.guest');
                        if (player.id === nm.getCurrentLeaderId()) roleLabel =T('Multiplayer.host');
                        if (player.id === nm.myId) roleLabel += ` (${T('Multiplayer.you')})`;

                        rosterListHTML += `
                            <div class="node-card" style="cursor:default;">
                                ${this.drawNodeAvatarHTML(player.info.faceName, player.info.faceIndex)}
                                <div class="node-info">
                                    <span class="node-name">${player.info.name}</span>
                                    <span class="node-subtitle">${player.info.className || T('Multiplayer.adventurer')} | ${T('Multiplayer.mapLabel')} ${player.info.mapId || T('Multiplayer.unknownMap')}</span>
                                </div>
                                <span class="node-badge">${roleLabel}</span>
                            </div>
                        `;
                    });
                }
            }

            container.innerHTML = `
                <div class="book-spread">
                    <div class="left-page" style="justify-content:flex-start;">
                        <div class="page-header-bar">
                            <button class="back-button" id="mp-back">${T('Multiplayer.back')}</button>
                            <h2 class="title">${T('Multiplayer.linkConsole')}</h2>
                        </div>

                        <div class="mp-status-bar">
                            <span class="status-pulse ${statusClass}"></span>
                            <span>${T('Multiplayer.linkStatus')}: ${statusLabel}</span>
                        </div>

                        <div class="console-section">
                            ${configRowsHTML}
                        </div>

                        <div class="action-deck">
                            ${actionBtnsHTML}
                        </div>

                        <div class="console-log">${this._statusMessage}</div>
                    </div>

                    <div class="right-page" style="justify-content:flex-start;gap:0;">
                        <div class="page-header-bar">
                            <h2 class="title">${T('Multiplayer.commsRoster')}</h2>
                        </div>
                        ${rosterTabsHTML}
                        <div class="roster-viewport">
                            ${rosterListHTML}
                        </div>
                    </div>
                </div>
            `;

            // Setup DOM click events
            document.getElementById('mp-back')?.addEventListener('click', () => {
                SoundManager.playCancel();
                this.popScene();
            });

            const urlRow = container.querySelector("#row-url");
            if (urlRow) {
                urlRow.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    this._selectedIndex = 0;
                    this.promptChangeUrl();
                });
            }

            const codeRow = container.querySelector("#row-code");
            if (codeRow) {
                codeRow.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    this._selectedIndex = 0;
                    this.promptChangeCode();
                });
            }

            const followRow = container.querySelector("#row-follow");
            if (followRow) {
                followRow.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    this._selectedIndex = 1;
                    this.toggleFollowLeader();
                });
            }

            const connectBtn = container.querySelector("#btn-connect");
            if (connectBtn) {
                connectBtn.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    this._selectedIndex = 1;
                    this.executeMenuAction();
                });
            }

            const disconnectBtn = container.querySelector("#btn-disconnect");
            if (disconnectBtn) {
                disconnectBtn.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    const idx = NetworkMode === 'WebSocket' ? 1 : (nm.isLeader ? 2 : 3);
                    this._selectedIndex = idx;
                    this.executeMenuAction();
                });
            }

            const createBtn = container.querySelector("#btn-create");
            if (createBtn) {
                createBtn.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    this._selectedIndex = 2;
                    this.executeMenuAction();
                });
            }

            const joinBtn = container.querySelector("#btn-join");
            if (joinBtn) {
                joinBtn.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    this._selectedIndex = 3;
                    this.executeMenuAction();
                });
            }

            const teleportBtn = container.querySelector("#btn-teleport");
            if (teleportBtn) {
                teleportBtn.addEventListener("click", () => {
                    this._activeArea = 'menu';
                    this._selectedIndex = 2;
                    this.executeMenuAction();
                });
            }

            // Click tabs (WebSocket only)
            const tabs = container.querySelectorAll(".roster-tab");
            tabs.forEach(tab => {
                tab.addEventListener("click", () => {
                    const tabId = parseInt(tab.getAttribute("data-tab"));
                    this._activeTab = tabId;
                    this._activeArea = 'roster';
                    this._selectedPlayerIndex = 0;
                    SoundManager.playOk();
                    this.refreshUIMultiplayer();
                });
            });

            // Click Node Card
            const nodeCards = container.querySelectorAll(".node-card");
            nodeCards.forEach(card => {
                card.addEventListener("click", () => {
                    const idx = parseInt(card.getAttribute("data-idx"));
                    this._activeArea = 'roster';
                    this._selectedPlayerIndex = idx;
                    SoundManager.playOk();
                    this.executeRosterAction();
                });
            });

            const leaveBtn = container.querySelector("#btn-leave");
            if (leaveBtn) {
                leaveBtn.addEventListener("click", () => {
                    this._activeArea = 'roster';
                    this._selectedPlayerIndex = nm.party.members.length;
                    this.executeRosterAction();
                });
            }
        }

        drawNodeAvatarHTML(faceName, faceIndex) {
            if (!faceName) return '<div class="node-avatar" style="background:var(--border-subtle);"></div>';
            const path = `img/busts/${faceName}.png`;
            return `
                <div class="node-avatar" style="
                    background-image: url('${path}');
                    background-size: 220%;
                    background-position: 50% 12%;
                    background-repeat: no-repeat;
                "></div>
            `;
        }

        // =============================================================================
        // Keyboard and Arrow Selection mappings
        // =============================================================================
        updateUIMultiplayerInput() {
            const nm = NetworkManager.instance;
            const connected = nm.isMultiplayer();

            // L1/R1 cycle the roster tabs from anywhere in the scene
            if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
                this._activeTab = (this._activeTab + (Input.isTriggered('pageup') ? -1 : 1) + 2) % 2;
                this._selectedPlayerIndex = 0;
                SoundManager.playCursor();
                this.refreshUIMultiplayer();
                return;
            }

            if (this._activeArea === 'menu') {
                let maxRows = 2; // Default WebSocket: [0: url, 1: action]
                if (NetworkMode === 'Steamworks') {
                    if (connected) {
                        maxRows = nm.isLeader ? 3 : 4; // Guest: [0: id, 1: follow, 2: teleport, 3: sever], Host: [0: id, 1: follow, 2: sever]
                    } else {
                        maxRows = 4; // Disconnected: [0: id, 1: follow, 2: forge, 3: join]
                    }
                }

                if (Input.isRepeated('down')) {
                    this._selectedIndex = (this._selectedIndex + 1) % maxRows;
                    SoundManager.playCursor();
                    this.refreshUIMultiplayer();
                } else if (Input.isRepeated('up')) {
                    this._selectedIndex = (this._selectedIndex - 1 + maxRows) % maxRows;
                    SoundManager.playCursor();
                    this.refreshUIMultiplayer();
                } else if (Input.isRepeated('right')) {
                    // Jump to roster side
                    this._activeArea = 'roster';
                    this._selectedPlayerIndex = 0;
                    SoundManager.playOk();
                    this.refreshUIMultiplayer();
                } else if (Input.isTriggered('ok')) {
                    SoundManager.playOk();
                    this.executeMenuRowSelect();
                } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    // TouchInput.isCancelled() is the right mouse button.
                    this.popScene();
                    SoundManager.playCancel();
                }
            } else if (this._activeArea === 'roster') {
                if (NetworkMode === 'WebSocket') {
                    const myId = nm.myId;
                    const partyMembers = nm.isInParty() ? nm.party.members : [];
                    const activePlayers = Array.from(nm.players.entries()).filter(([id, _]) => id !== myId && !partyMembers.includes(id)).map(([id, info]) => ({ id, info }));

                    let maxItems = this._activeTab === 0 ? activePlayers.length : (nm.isInParty() ? nm.party.members.length + 1 : 0);

                    if (Input.isRepeated('down')) {
                        if (maxItems > 0) {
                            this._selectedPlayerIndex = (this._selectedPlayerIndex + 1) % maxItems;
                            SoundManager.playCursor();
                            this.refreshUIMultiplayer();
                        }
                    } else if (Input.isRepeated('up')) {
                        if (maxItems > 0) {
                            this._selectedPlayerIndex = (this._selectedPlayerIndex - 1 + maxItems) % maxItems;
                            SoundManager.playCursor();
                            this.refreshUIMultiplayer();
                        }
                    } else if (Input.isRepeated('left')) {
                        if (this._selectedPlayerIndex === 0) {
                            this._activeArea = 'menu';
                            SoundManager.playCancel();
                        } else {
                            this._activeTab = (this._activeTab - 1 + 2) % 2;
                            this._selectedPlayerIndex = 0;
                            SoundManager.playCursor();
                        }
                        this.refreshUIMultiplayer();
                    } else if (Input.isRepeated('right')) {
                        this._activeTab = (this._activeTab + 1) % 2;
                        this._selectedPlayerIndex = 0;
                        SoundManager.playCursor();
                        this.refreshUIMultiplayer();
                    } else if (Input.isTriggered('ok')) {
                        this.executeRosterAction();
                    } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                        this._activeArea = 'menu';
                        SoundManager.playCancel();
                        this.refreshUIMultiplayer();
                    }
                } else {
                    // Steamworks Mode roster
                    if (Input.isRepeated('left') || Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                        this._activeArea = 'menu';
                        SoundManager.playCancel();
                        this.refreshUIMultiplayer();
                    }
                }
            }
        }

        executeMenuRowSelect() {
            if (this._selectedIndex === 0) {
                if (NetworkMode === 'WebSocket') this.promptChangeUrl();
                else this.promptChangeCode();
            } else if (this._selectedIndex === 1) {
                if (NetworkMode === 'WebSocket') this.executeMenuAction();
                else this.toggleFollowLeader();
            } else {
                this.executeMenuAction();
            }
        }

        promptChangeUrl() {
            if (NetworkManager.instance.isMultiplayer()) { SoundManager.playBuzzer(); return; }
            const url = prompt(T('Multiplayer.enterServerWebsocketUrl'), this._serverUrl);
            if (url !== null) {
                this._serverUrl = url;
                localStorage.setItem('gmn_mp_serverUrl', url);
                this.updateStatus(T('Multiplayer.serverUrlSet', { url: url }));
                this.refreshUIMultiplayer();
            }
        }

        promptChangeCode() {
            if (NetworkManager.instance.isMultiplayer()) { SoundManager.playBuzzer(); return; }
            const code = prompt(T('Multiplayer.enterSteamLobbyId'), this._roomCode);
            if (code !== null) {
                this._roomCode = code.toUpperCase();
                this.updateStatus(T('Multiplayer.lobbyIdSet', { id: this._roomCode }));
                this.refreshUIMultiplayer();
            }
        }

        toggleFollowLeader() {
            this._followLeader = !this._followLeader;
            localStorage.setItem('gmn_mp_followLeader', this._followLeader);
            if (NetworkManager.instance && NetworkMode === 'Steamworks') {
                NetworkManager.instance.followLeader = this._followLeader;
            }
            this.updateStatus(T('Multiplayer.followLeaderState', { state: this._followLeader ? T('Multiplayer.on') : T('Multiplayer.off') }));
            this.refreshUIMultiplayer();
        }

        executeMenuAction() {
            const nm = NetworkManager.instance;
            const connected = nm.isMultiplayer();

            if (NetworkMode === 'WebSocket') {
                if (connected) {
                    this.commandDisconnect();
                } else {
                    this.commandConnectServer();
                }
            } else {
                // Steamworks Mode
                if (connected) {
                    const isLeader = nm.isLeader;
                    if (!isLeader && this._selectedIndex === 2) {
                        this.commandTeleportToLeader();
                    } else {
                        this.commandDisconnect();
                    }
                } else {
                    if (this._selectedIndex === 2) {
                        this.commandCreateSteam();
                    } else if (this._selectedIndex === 3) {
                        this.commandJoinSteam();
                    }
                }
            }
        }

        executeRosterAction() {
            const nm = NetworkManager.instance;
            if (NetworkMode === 'WebSocket') {
                if (this._activeTab === 0) {
                    // Send Party Invite
                    const myId = nm.myId;
                    const partyMembers = nm.isInParty() ? nm.party.members : [];
                    const activePlayers = Array.from(nm.players.entries()).filter(([id, _]) => id !== myId && !partyMembers.includes(id)).map(([id, info]) => ({ id, info }));
                    const player = activePlayers[this._selectedPlayerIndex];
                    if (player) {
                        nm.sendPartyInvite(player.id);
                        this.updateStatus(T('Multiplayer.inviteSent', { name: player.info.name }));
                        SoundManager.playOk();
                    }
                } else {
                    // Leave Party button
                    if (nm.isInParty() && this._selectedPlayerIndex === nm.party.members.length) {
                        this.onLeaveParty();
                    }
                }
            }
        }

        // =============================================================================
        // Link engine integrations
        // =============================================================================
        commandConnectServer() {
            if (!this._serverUrl) { this.updateStatus(T('Multiplayer.serverUrlEmpty'), true); return; }
            NetworkManager.instance.connect(this._serverUrl).catch(() => { });
        }

        commandCreateSteam() {
            this.updateStatus(T('Multiplayer.creatingLobby'));
            NetworkManager.instance.initiateCreateRoom(this._followLeader);
        }

        async commandJoinSteam() {
            if (!this._roomCode) { this.updateStatus(T('Multiplayer.lobbyIdEmpty'), true); return; }
            this.updateStatus(T('Multiplayer.joiningLobby', { id: this._roomCode }));
            if (NetworkManager.instance.isMultiplayer()) {
                NetworkManager.instance.disconnect(true);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            NetworkManager.instance.initiateJoinRoom(this._roomCode, this._followLeader);
        }

        commandDisconnect() {
            const shouldRestoreState = NetworkMode === 'Steamworks' ? !NetworkManager.instance.isLeader : true;
            NetworkManager.instance.disconnect(shouldRestoreState);
            this._roomCode = '';
            this.updateStatus(T('Multiplayer.disconnectedReady'));
            this.refreshUIMultiplayer();
        }

        commandTeleportToLeader() {
            const nm = NetworkManager.instance;
            if (!nm.isMultiplayer() || nm.isLeader) { this.updateStatus(T('Multiplayer.cannotTeleport'), true); return; }
            if (!nm.getCurrentLeaderId()) { this.updateStatus(T('Multiplayer.noLeader'), true); return; }
            nm.requestLeaderTeleport();
            this.updateStatus(T('Multiplayer.teleporting'));
            SoundManager.playOk();
            setTimeout(() => SceneManager.goto(Scene_Map), 1000);
        }

        onLeaveParty() {
            NetworkManager.instance.sendPartyLeave();
            this.updateStatus(T('Multiplayer.leftParty'));
            SoundManager.playOk();
            this._activeTab = 0;
            this.refreshUIMultiplayer();
        }

        updateStatus(text, isError = false) {
            this._statusMessage = text;
            if (isError) SoundManager.playBuzzer();
        }

        onConnectionSuccess() {
            this.updateStatus(T('Multiplayer.syncing'));
            SoundManager.playOk();
            $gameSwitches.setValue(66, true, true);
            setTimeout(() => SceneManager.goto(Scene_Map), 1500);
        }

        onRoomSetupSuccess(isLeader) {
            if (isLeader) {
                this._roomCode = NetworkManager.instance.roomId;
                this.updateStatus(T('Multiplayer.lobbyCreated', { id: this._roomCode }));
            } else {
                this.updateStatus(T('Multiplayer.joiningGame'));
            }
            SoundManager.playOk();
            $gameSwitches.setValue(66, true, true);
            setTimeout(() => SceneManager.goto(Scene_Map), 2000);
        }

        createHelpWindow() {
            const rect = new Rectangle(0, this.mainAreaTop(), Graphics.boxWidth, this.calcWindowHeight(2, false));
            this._helpWindow = new Window_Help(rect);
            this.addWindow(this._helpWindow);
        }

        createInputWindow() {
            const rect = new Rectangle(0, 0, 400, 300);
            this._inputWindow = new Window_MultiplayerInput(rect);
            this.addWindow(this._inputWindow);
        }

        createStatusWindow() {
            const rect = new Rectangle(0, 0, 400, 300);
            this._statusWindow = new Window_MultiplayerStatus(rect);
            this.addWindow(this._statusWindow);
        }

        createPlayerListWindow() {
            const rect = new Rectangle(0, 0, 400, 300);
            this._playerListWindow = new Window_MultiplayerPlayerList(rect);
            this.addWindow(this._playerListWindow);
        }

        createPartyWindow() {
            const rect = new Rectangle(0, 0, 400, 300);
            this._partyWindow = new Window_MultiplayerParty(rect);
            this.addWindow(this._partyWindow);
        }
    }

    window.Scene_Multiplayer = Scene_Multiplayer;


    // ============================================================================
    // STUB COMPATIBILITY WINDOW CLASSES
    // ============================================================================
    class Window_MultiplayerInput extends Window_Selectable {
        serverUrl() { return ''; }
        roomCode() { return ''; }
        followLeader() { return true; }
        setServerUrl() { }
        setRoomCode() { }
        setFollowLeader() { }
        currentSymbol() { return ''; }
        refresh() { }
    }

    class Window_MultiplayerStatus extends Window_Base {
        refresh() { }
    }

    class Window_MultiplayerPlayerList extends Window_Selectable {
        selectedPlayer() { return null; }
        refresh() { }
    }

    class Window_MultiplayerParty extends Window_Selectable {
        refresh() { }
    }

    // Party Invitation Popups
    class PartyUIManager {
        constructor() { this._invitationQueue = []; this._currentWindow = null; }
        static get instance() { if (!this._instance) this._instance = new PartyUIManager(); return this._instance; }
        showInvitation(inviterId, inviterName) { this._invitationQueue.push({ inviterId, inviterName }); }
        update() {
            if (NetworkMode !== 'WebSocket') return;
            if (this._currentWindow && this._currentWindow.isClosed()) {
                const scene = SceneManager._scene;
                if (scene && scene._invitationWindow === this._currentWindow) { scene.removeWindow(this._currentWindow); scene._invitationWindow = null; }
                this._currentWindow = null;
            }
            if (!this._currentWindow && this._invitationQueue.length > 0) {
                const scene = SceneManager._scene;
                if (scene && scene.isReady() && !$gameMessage.isBusy() && scene.isMapScene && scene.isMapScene()) {
                    const invite = this._invitationQueue.shift();
                    this._currentWindow = new Window_PartyInvitation(new Rectangle(0, 0, 400, 120), invite);
                    this._currentWindow.x = (Graphics.boxWidth - this._currentWindow.width) / 2;
                    this._currentWindow.y = 20;
                    scene.addWindow(this._currentWindow);
                    scene._invitationWindow = this._currentWindow;
                }
            }
        }
    }
    window.PartyUIManager = PartyUIManager;

    class Window_PartyInvitation extends Window_Command {
        constructor(rect, inviteData) { super(rect); this._invite = inviteData; this.openness = 0; this.open(); this.activate(); }
        makeCommandList() { this.addCommand(T('Multiplayer.accept'), "accept", true); this.addCommand(T('Multiplayer.decline'), "decline", true); }
        windowWidth() { return 400; }
        drawItem(index) {
            if (index === 0) this.drawTextEx(T('Multiplayer.invitedYou', { name: this._invite.inviterName }), this.itemPadding(), 0);
            const rect = this.itemLineRect(index + 1);
            const enabled = this.isCommandEnabled(this.commandSymbol(index));
            this.changePaintOpacity(enabled);
            this.drawText(this.commandName(index), rect.x, rect.y, rect.width, 'center');
        }
        itemRect(index) { return super.itemRect(index + 1); }
        processOk() {
            if (this.currentSymbol() === 'accept') NetworkManager.instance.sendPartyAccept(this._invite.inviterId);
            SoundManager.playOk(); this.close();
        }
        processCancel() { this.close(); }
    }


    class Window_PlayerList extends Window_Base {
        constructor(rect) { super(rect); this.opacity = 0; this._bustSprites = []; this.refresh(); }
        refresh() {
            this.contents.clear();
            for (const sprite of this._bustSprites) if (sprite.parent) this.removeChild(sprite);
            this._bustSprites = [];
            const nm = NetworkManager.instance;
            if (!nm.isMultiplayer()) return;

            let playersToDisplay = [];
            if (NetworkMode === 'WebSocket' && nm.isInParty()) {
                for (const memberId of nm.party.members) {
                    const playerInfo = nm.players.get(memberId);
                    if (playerInfo) playersToDisplay.push(playerInfo);
                }
            } else {
                const currentMapId = $gameMap.mapId();
                for (const playerInfo of nm.players.values()) {
                    if (playerInfo.mapId === currentMapId || NetworkMode === 'Steamworks') playersToDisplay.push(playerInfo);
                }
            }

            const bustSize = 64;
            const itemHeight = Math.max(this.lineHeight() * 2, bustSize);
            this.height = this.fittingHeight(playersToDisplay.length);
            this.createContents();

            playersToDisplay.forEach((player, index) => {
                if (!player) return;
                const y = index * (itemHeight + 8);
                this.drawFace(player.faceName, player.faceIndex, 0, y, bustSize, bustSize);
                this.drawText(player.name, bustSize + 10, y, this.contentsWidth() - bustSize - 10);
            });
        }
        fittingHeight(numItems) { return numItems * (Math.max(this.lineHeight() * 2, 64) + 8) + this.padding * 2; }
        update() { super.update(); this.visible = NetworkManager.instance.isMultiplayer(); }
    }


    // ============================================================================
    // GAME HOOKS & INTEGRATIONS
    // ============================================================================
    // With networked play greyed out, events that ask for the connections terminal land on
    // the mode picker instead, where Steam/Online read as unavailable.
    for (const key of [PLUGIN_NAME, LEGACY_PLUGIN_NAME]) {
        PluginManager.registerCommand(key, 'openConnectionsMenu',
            () => SceneManager.push(NETWORK_PLAY_ENABLED ? Scene_Multiplayer : Scene_MultiplayerTypeSelection));
    }

    const _SceneManager_updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function () {
        _SceneManager_updateMain.apply(this, arguments);
        if (NetworkManager.instance.isMultiplayer()) PartyUIManager.instance.update();
    };

    const _Scene_Map_isMapScene = Scene_Map.prototype.isMapScene;
    Scene_Map.prototype.isMapScene = function () { return _Scene_Map_isMapScene.call(this) && !this._invitationWindow; };

    const _Game_Switches_setValue = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function (switchId, value, fromNetwork = false) {
        if (this.value(switchId) === value) return;
        _Game_Switches_setValue.call(this, switchId, value);
        if (!fromNetwork) NetworkManager.instance.onSwitchChange(switchId, value);
    };

    const _Game_Variables_setValue = Game_Variables.prototype.setValue;
    Game_Variables.prototype.setValue = function (variableId, value, fromNetwork = false) {
        if (this.value(variableId) === value) return;
        _Game_Variables_setValue.call(this, variableId, value);
        if (!fromNetwork) NetworkManager.instance.onVariableChange(variableId, value);
    };

    const _Game_SelfSwitches_setValue = Game_SelfSwitches.prototype.setValue;
    Game_SelfSwitches.prototype.setValue = function (key, value, fromNetwork = false) {
        const oldValue = this.value(key);
        _Game_SelfSwitches_setValue.call(this, key, value);
        if (!fromNetwork && oldValue !== value && NetworkMode === 'Steamworks') {
            const [mapId, eventId, switchType] = key;
            NetworkManager.instance.onSelfSwitchChange(mapId, eventId, switchType, value);
        }
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        MultiplayerManager.instance.update();
    };

    const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function () {
        _Scene_Map_onMapLoaded.call(this);
        MultiplayerManager.instance.onMapLoaded();
    };

    const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function () {
        _Scene_Map_createAllWindows.call(this);
        this.createPlayerListWindow();
    };

    Scene_Map.prototype.createPlayerListWindow = function () {
        this._playerListWindow = new Window_PlayerList(new Rectangle(10, 100, 280, 100));
        this.addWindow(this._playerListWindow);
    };

    const _Game_Player_startMapEvent = Game_Player.prototype.startMapEvent;
    Game_Player.prototype.startMapEvent = function (x, y, triggers, normal) {
        if (!$gameMap.isEventRunning()) {
            for (const event of $gameMap.eventsXy(x, y)) {
                if (event.event().name.match(/^Player\d+$/)) continue;
                if (event.isTriggerIn(triggers) && event.isNormalPriority() === normal) { event.start(); return; }
            }
        }
    };

    const _Game_Event_updateSelfMovement = Game_Event.prototype.updateSelfMovement;
    Game_Event.prototype.updateSelfMovement = function () {
        if (NetworkManager.instance.isMultiplayer()) {
            if (NetworkMode === 'WebSocket') return;
            if (NetworkMode === 'Steamworks' && !NetworkManager.instance.isLeader && this.event().name !== 'Enemy') return;  // i18n-ignore  event name
        }
        _Game_Event_updateSelfMovement.call(this);
    };

    const _Game_Player_refresh = Game_Player.prototype.refresh;
    Game_Player.prototype.refresh = function () {
        _Game_Player_refresh.call(this);
        if (NetworkManager.instance.isMultiplayer()) {
            const networkManager = NetworkManager.instance;
            const myId = networkManager.myId;
            const myInfo = networkManager.players.get(myId);
            if (myId) {
                const newInfo = networkManager.createPlayerInfo();
                if (NetworkMode === 'WebSocket' || (myInfo && JSON.stringify(myInfo) !== JSON.stringify(newInfo))) {
                    networkManager.players.set(myId, newInfo);
                    if (NetworkMode === 'WebSocket') networkManager.send({ type: 'player-meta', info: newInfo });
                    else networkManager.broadcast({ type: 'player-meta', info: newInfo });
                }
            }
        }
    };

    const _Game_Interpreter_command301 = Game_Interpreter.prototype.command301;
    Game_Interpreter.prototype.command301 = function (params) {
        if (NetworkManager.instance.isMultiplayer() && !BattleManager.isBattleTest()) {
            const packet = { type: 'player-state-change', state: 'battling', from: NetworkManager.instance.myId };
            if (NetworkMode === 'WebSocket') NetworkManager.instance.send(packet);
            else NetworkManager.instance.broadcast(packet);

            const originalCallback = this._branch[this._indent];
            this._branch[this._indent] = (result) => {
                const clearPacket = { type: 'player-state-change', state: 'idle', from: NetworkManager.instance.myId };
                if (NetworkMode === 'WebSocket') NetworkManager.instance.send(clearPacket);
                else NetworkManager.instance.broadcast(clearPacket);
                if (originalCallback) originalCallback(result);
            };
        }
        return _Game_Interpreter_command301.call(this, params);
    };

    const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
    Window_MenuCommand.prototype.addOriginalCommands = function () {
        _Window_MenuCommand_addOriginalCommands.call(this);
        this.addCommand(T('Multiplayer.menuCommand'), "multiplayer", true, 44);
    };

    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function () {
        _Scene_Menu_createCommandWindow.call(this);
        this._commandWindow.setHandler("multiplayer", () => SceneManager.push(Scene_MultiplayerTypeSelection));
    };

    if (ShowPlayerNames) {
        const _Sprite_Character_initMembers = Sprite_Character.prototype.initMembers;
        Sprite_Character.prototype.initMembers = function () {
            _Sprite_Character_initMembers.call(this);
            this._nameplateSprite = null;
        };

        const _Sprite_Character_update = Sprite_Character.prototype.update;
        Sprite_Character.prototype.update = function () {
            _Sprite_Character_update.call(this);
            if (!this._character || !NetworkManager.instance.isMultiplayer()) {
                if (this._nameplateSprite) { this.removeChild(this._nameplateSprite); this._nameplateSprite = null; }
                return;
            }
            const eventId = this._character.eventId && this._character.eventId();
            const playerId = eventId ? MultiplayerManager.instance.eventPlayerMap.get(eventId) : null;
            if (playerId) {
                const playerInfo = NetworkManager.instance.players.get(playerId);
                if (playerInfo && !this._nameplateSprite) this.createNameplate(playerInfo.name || T('Multiplayer.playerNumbered', { id: playerId }));
            } else if (this._nameplateSprite) {
                this.removeChild(this._nameplateSprite); this._nameplateSprite = null;
            }
        };

        Sprite_Character.prototype.createNameplate = function (name) {
            this._nameplateSprite = new Sprite();
            this._nameplateSprite.bitmap = new Bitmap(200, 50);
            this._nameplateSprite.anchor.x = 0.5;
            this._nameplateSprite.anchor.y = 1;
            this._nameplateSprite.y = Number(NameplateConfig.yOffset || -50);

            const bitmap = this._nameplateSprite.bitmap;
            bitmap.fontSize = Number(NameplateConfig.fontSize || 18);
            bitmap.fontFace = NameplateConfig.fontFace || 'GameFont';
            bitmap.textColor = NameplateConfig.textColor || '#FFFFFF';
            bitmap.outlineColor = NameplateConfig.outlineColor || 'rgba(0, 0, 0, 0.7)';
            bitmap.outlineWidth = Number(NameplateConfig.outlineWidth || 3);
            bitmap.drawText(name, 0, 0, 200, 50, 'center');
            this.addChild(this._nameplateSprite);
        };
    }

    // ============================================================================
    // STEAM BOOT INIT + "JOIN GAME" LAUNCH HANDOFF
    // Runs last so NetworkManager_Steam (a non-hoisted class) is already defined.
    // ============================================================================
    // Best-effort init so Steam "Join Game" works even in the default WebSocket mode.
    // Quiet no-op when Steam is not running or the native module lacks multiplayer.
    initSteam();

    // If the game was launched via a friend's "Join Game" (Steam appends
    // "+connect_lobby <id>" to the launch args), queue it; SteamJoinRequest consumes
    // the join once the player is in-world on a map.
    const _launchLobbyId = parseConnectLobby(getLaunchArgv().join(' '));
    if (_launchLobbyId) SteamJoinRequest.handle(_launchLobbyId);
})();