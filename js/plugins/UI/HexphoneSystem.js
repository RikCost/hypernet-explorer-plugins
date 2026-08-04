//=============================================================================
// HexphoneSystem.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v3.0.0] Anoki-Style Hexphone: Credits, Calls, Messages, Games
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help HexphoneSystem.js
 *
 * v3.0.0 - Full rework.
 * - Fixed game shutdown when closing the phone (buttons were created twice,
 *   so one click fired two handlers and END popped the scene stack twice,
 *   which triggered SceneManager.exit()).
 * - Parameters and plugin commands now resolve under the real file name
 *   (HexphoneSystem); legacy events using "AnokiHexphoneSystem" keep working.
 * - Full keyboard/controller support (arrows, ok, cancel, digit keys).
 * - Calling a contact now triggers its Common Event on the map.
 * - Incoming calls (receiveCall command) with answer/decline.
 * - Built-in working minigames: Snake and Tetris (LCD style).
 * - External minigames can register via window.registerHexphoneGame.
 * - Scene_AnokiPhone is exported globally for extension plugins.
 *
 * Controls (phone open):
 *   Mouse/touch ....... all on-screen buttons
 *   0-9 * # ........... keypad (dialing and quick menu shortcuts)
 *   Arrow Up/Down ..... navigate lists
 *   Enter / Z ......... MENU button (select / call / open)
 *   Escape / X ........ END button (back, close from home screen)
 *   Backspace ......... delete digit while dialing
 *
 * @param menuText
 * @text Menu Option Text
 * @desc Text shown in the pause menu for the phone
 * @type string
 * @default Hexphone
 *
 * @param initialCredits
 * @text Initial Credits
 * @desc Starting phone credits for the player (gold units, 100 = 1 euro)
 * @type number
 * @min 0
 * @default 100
 *
 * @param callCostPerSecond
 * @text Call Cost Per Second
 * @desc Credits consumed per second during outgoing calls
 * @type number
 * @min 0
 * @default 5
 *
 * @param messageCost
 * @text Message Cost
 * @desc Credits consumed per message sent
 * @type number
 * @min 0
 * @default 5
 *
 * @param ringtones
 * @text Available Ringtones
 * @desc List of available ringtones
 * @type struct<Ringtone>[]
 * @default ["{\"name\":\"Anoki Tune\",\"se\":\"Decision1\",\"volume\":\"90\",\"pitch\":\"100\"}","{\"name\":\"Classic\",\"se\":\"Bell1\",\"volume\":\"90\",\"pitch\":\"100\"}"]
 *
 * @param contacts
 * @text Available Contacts
 * @desc Define your available contacts here
 * @type struct<Contact>[]
 * @default []
 *
 * @param games
 * @text Phone Games
 * @desc Extra mini-games launched through a common event. Snake and Tetris are built in.
 * @type struct<PhoneGame>[]
 * @default []
 *
 * @command openPhone
 * @text Open Phone
 * @desc Opens the Anoki phone interface
 *
 * @command addCredits
 * @text Add Credits
 * @desc Add credits to the phone
 *
 * @arg amount
 * @text Amount
 * @desc Amount of credits to add
 * @type number
 * @min 0
 * @default 10
 *
 * @command removeCredits
 * @text Remove Credits
 * @desc Remove credits from the phone (clamped at 0)
 *
 * @arg amount
 * @text Amount
 * @desc Amount of credits to remove
 * @type number
 * @min 0
 * @default 10
 *
 * @command setCredits
 * @text Set Credits
 * @desc Set the phone credits to an exact value
 *
 * @arg amount
 * @text Amount
 * @desc New credit total
 * @type number
 * @min 0
 * @default 100
 *
 * @command registerContact
 * @text Register Contact
 * @desc Add a contact from the plugin parameter database
 *
 * @arg contactName
 * @text Contact Name
 * @desc Name of the contact to register
 * @type string
 * @default
 *
 * @command addContact
 * @text Add Custom Contact
 * @desc Add an arbitrary contact (not from the parameter database)
 *
 * @arg name
 * @text Name
 * @type string
 * @default
 *
 * @arg number
 * @text Phone Number
 * @desc Leave empty to auto-generate
 * @type string
 * @default
 *
 * @arg commonEventId
 * @text Common Event ID
 * @desc Common event run when this contact answers (0 = simulated call)
 * @type common_event
 * @default 0
 *
 * @command removeContact
 * @text Remove Contact
 * @desc Remove a contact from the phone
 *
 * @arg contactName
 * @text Contact Name
 * @desc Name of the contact to remove
 * @type string
 * @default
 *
 * @command receiveMessage
 * @text Receive Message
 * @desc Adds a new message to the phone inbox
 *
 * @arg sender
 * @text Sender
 * @desc Who the message is from
 * @type string
 * @default ???
 *
 * @arg content
 * @text Content
 * @desc The text content of the message
 * @type multiline_string
 * @default
 *
 * @command sendMessage
 * @text Send Message
 * @desc Sends a new message (costs credits)
 *
 * @arg recipient
 * @text Recipient
 * @desc Who the message is being sent to
 * @type string
 * @default ???
 *
 * @arg content
 * @text Content
 * @desc The text content of the message
 * @type multiline_string
 * @default
 *
 * @command clearMessages
 * @text Clear Messages
 * @desc Deletes every message in the inbox
 *
 * @command receiveCall
 * @text Receive Call
 * @desc Incoming call from a contact. Opens the phone in ringing mode when on the map.
 *
 * @arg contactName
 * @text Contact Name
 * @desc Contact database name. Its Common Event runs when the player answers.
 * @type string
 * @default
 *
 * @command addGame
 * @text Add Game
 * @desc Register a common-event based game on the phone
 *
 * @arg name
 * @text Game Name
 * @type string
 * @default
 *
 * @arg commonEventId
 * @text Common Event ID
 * @type common_event
 * @default 1
 */

/*~struct~Contact:
 * @param name
 * @text Contact Name
 * @desc Name of the contact
 * @type string
 * @default
 *
 * @param number
 * @text Phone Number
 * @desc Phone number (display only, auto-generated when empty)
 * @type string
 * @default
 *
 * @param commonEventId
 * @text Common Event ID
 * @desc Common event to run when this contact answers a call
 * @type common_event
 * @default 0
 */

/*~struct~Ringtone:
 * @param name
 * @text Ringtone Name
 * @desc Display name for the ringtone
 * @type string
 * @default
 *
 * @param se
 * @text Sound Effect
 * @desc Sound effect file for the ringtone
 * @type file
 * @dir audio/se/
 * @default Decision1
 *
 * @param volume
 * @text Volume
 * @desc Volume of the ringtone (0-100)
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param pitch
 * @text Pitch
 * @desc Pitch of the ringtone (50-150)
 * @type number
 * @min 50
 * @max 150
 * @default 100
 */

/*~struct~PhoneGame:
 * @param name
 * @text Game Name
 * @desc Name of the mini-game
 * @type string
 * @default
 *
 * @param commonEventId
 * @text Common Event ID
 * @desc Common event to launch the game
 * @type common_event
 * @default 1
 */

(() => {
    'use strict';

    // The file lives at js/plugins/UI/HexphoneSystem.js, so MZ keys parameters
    // and editor plugin commands to "HexphoneSystem". Existing events were
    // authored against the old "AnokiHexphoneSystem" name, so commands are
    // registered under every historical key.
    const pluginName = "HexphoneSystem";
    const commandKeys = ["HexphoneSystem", "UI/HexphoneSystem", "AnokiHexphoneSystem"];

    const parameters = (() => {
        for (const key of commandKeys) {
            const p = PluginManager.parameters(key);
            if (p && Object.keys(p).length > 0) return p;
        }
        return {};
    })();

    // Items whose possession unlocks the pause-menu command (any phone model)
    const requiredItemIds = [149, 153, 157, 160];

    //=============================================================================
    // Translations
    //=============================================================================

;

    // The phone's copy lives in js/i18n/<lang>/plugins/Hexphone.json. Call sites
    // still pass the original English label, which is slugged to the key here, so
    // adding a string means adding one JSON entry and nothing else.
    const _hexSlug = k => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        .split(/s+/).map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w).join('');

    function getText(key) {
        const resolved = 'Hexphone.' + _hexSlug(key); // i18n-ignore: key prefix
        return T.has(resolved) ? T(resolved) : key;
    }

    //=============================================================================
    // Helpers
    //=============================================================================

    function goldToEuros(goldAmount) {
        return (goldAmount / 100).toFixed(2);
    }

    function safeParseArray(json) {
        try {
            const arr = JSON.parse(json || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function safeParseStruct(json) {
        try {
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    // Deterministic display number for contacts defined without one
    function autoPhoneNumber(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        const digits = (Math.abs(hash) % 10000).toString().padStart(4, '0');
        return '555-' + digits;
    }

    // In-game clock driven by TimeDateSystem (Variable 114 = minutes since
    // 2001-01-01 10:00). Falls back to real time before the system starts.
    function currentGameDate() {
        const mins = $gameVariables ? $gameVariables.value(114) : 0;
        if (mins > 0) {
            const d = new Date(2001, 0, 1, 10, 0, 0);
            d.setMinutes(d.getMinutes() + mins);
            return d;
        }
        return new Date();
    }

    function formatClock(date) {
        return date.getHours().toString().padStart(2, '0') + ':' +
               date.getMinutes().toString().padStart(2, '0');
    }

    function formatStamp(date) {
        return date.getDate().toString().padStart(2, '0') + '/' +
               (date.getMonth() + 1).toString().padStart(2, '0') + ' ' +
               formatClock(date);
    }

    function notify(text) {
        if (window.ParchmentToast && typeof window.ParchmentToast.show === 'function') {
            window.ParchmentToast.show(text);
        } else if ($gameMessage && !$gameMessage.isBusy()) {
            $gameMessage.add(text);
        }
    }

    function playSeSafe(name, volume, pitch) {
        if (!name) return;
        AudioManager.playSe({ name: name, volume: volume || 90, pitch: pitch || 100, pan: 0 });
    }

    //=============================================================================
    // Parameter parsing
    //=============================================================================

    const menuText = T.param(parameters['menuText'], 'Hexphone.menuCommand');
    const initialCredits = Number(parameters['initialCredits']) || 100;
    const callCostPerSecond = Number(parameters['callCostPerSecond']) || 5;
    const messageCost = Number(parameters['messageCost']) || 5;

    const availableContacts = {};
    for (const contactJson of safeParseArray(parameters['contacts'])) {
        const contact = safeParseStruct(contactJson);
        if (!contact || !contact.name) continue;
        availableContacts[contact.name] = {
            name: contact.name,
            number: contact.number || autoPhoneNumber(contact.name),
            commonEventId: Number(contact.commonEventId) || 0
        };
    }

    const availableRingtones = [];
    for (const ringtoneJson of safeParseArray(parameters['ringtones'])) {
        const ringtone = safeParseStruct(ringtoneJson);
        if (!ringtone || !ringtone.se) continue;
        availableRingtones.push({
            name: ringtone.name || ringtone.se,
            se: ringtone.se,
            volume: Number(ringtone.volume) || 90,
            pitch: Number(ringtone.pitch) || 100
        });
    }
    if (availableRingtones.length === 0) {
        availableRingtones.push({ name: T('Hexphone.ringtoneDefault'), se: "Decision1", volume: 90, pitch: 100 });
    }

    //=============================================================================
    // Game registry (module level; persists nothing, rebuilt each boot)
    //=============================================================================

    const phoneGames = [];        // [{name, commonEventId}]
    const inlineGames = {};       // name -> {create: () => session}

    function addPhoneGame(name, commonEventId) {
        if (!name) return;
        if (!phoneGames.find(g => g.name === name)) {
            phoneGames.push({ name: name, commonEventId: Number(commonEventId) || 0 });
        }
    }

    for (const gameJson of safeParseArray(parameters['games'])) {
        const game = safeParseStruct(gameJson);
        if (game && game.name) addPhoneGame(game.name, game.commonEventId);
    }

    // Public API for extension plugins. gameData may contain a `create()`
    // factory returning a session object with update(scene)/draw(bitmap)
    // methods for inline games, or a commonEventId for event-based games.
    window.registerHexphoneGame = function(gameName, gameData) {
        if (!gameName) return;
        addPhoneGame(gameName, gameData && gameData.commonEventId);
        if (gameData && typeof gameData.create === 'function') {
            inlineGames[gameName] = gameData;
        }
    };

    //=============================================================================
    // Game_System - persistent phone data
    //=============================================================================

    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _Game_System_initialize.call(this);
        this.initializeAnokiPhone();
    };

    Game_System.prototype.initializeAnokiPhone = function() {
        this._phoneContacts = {};
        this._phoneCredits = initialCredits;
        this._phoneMessages = [];
        this._selectedRingtoneIndex = 0;
        this._callHistory = [];
    };

    // Legacy saves may predate some fields; call before touching phone data
    Game_System.prototype.ensureAnokiPhone = function() {
        if (this._phoneContacts === undefined) this._phoneContacts = {};
        if (this._phoneCredits === undefined) this._phoneCredits = initialCredits;
        if (!Array.isArray(this._phoneMessages)) this._phoneMessages = [];
        if (this._selectedRingtoneIndex === undefined) this._selectedRingtoneIndex = 0;
        if (!Array.isArray(this._callHistory)) this._callHistory = [];
    };

    Game_System.prototype.getPhoneCredits = function() {
        return this._phoneCredits || 0;
    };

    Game_System.prototype.addPhoneCredits = function(amount) {
        this.ensureAnokiPhone();
        this._phoneCredits = Math.max(0, (this._phoneCredits || 0) + amount);
    };

    Game_System.prototype.setPhoneCredits = function(amount) {
        this.ensureAnokiPhone();
        this._phoneCredits = Math.max(0, amount);
    };

    Game_System.prototype.consumeCredits = function(amount) {
        this.ensureAnokiPhone();
        if (this.getPhoneCredits() >= amount) {
            this._phoneCredits -= amount;
            return true;
        }
        return false;
    };

    Game_System.prototype.registerContact = function(contactName) {
        this.ensureAnokiPhone();
        if (availableContacts[contactName]) {
            this._phoneContacts[contactName] = Object.assign({}, availableContacts[contactName]);
            return true;
        }
        return false;
    };

    Game_System.prototype.addCustomContact = function(name, number, commonEventId) {
        this.ensureAnokiPhone();
        if (!name) return false;
        this._phoneContacts[name] = {
            name: name,
            number: number || autoPhoneNumber(name),
            commonEventId: Number(commonEventId) || 0
        };
        return true;
    };

    Game_System.prototype.removeContact = function(contactName) {
        this.ensureAnokiPhone();
        if (this._phoneContacts[contactName]) {
            delete this._phoneContacts[contactName];
            return true;
        }
        return false;
    };

    Game_System.prototype.getContacts = function() {
        return this._phoneContacts || {};
    };

    Game_System.prototype.findContactByNumber = function(number) {
        for (const contact of Object.values(this.getContacts())) {
            if (contact.number === number) return contact;
        }
        return null;
    };

    Game_System.prototype.addCallToHistory = function(number, name, duration, note) {
        this.ensureAnokiPhone();
        this._callHistory.unshift({
            number: number,
            name: name || T('Hexphone.unknownCaller'),
            duration: duration,
            note: note || '',
            timestamp: formatStamp(currentGameDate())
        });
        if (this._callHistory.length > 20) this._callHistory.pop();
    };

    Game_System.prototype.getCallHistory = function() {
        return this._callHistory || [];
    };

    Game_System.prototype.getMessages = function() {
        return this._phoneMessages || [];
    };

    Game_System.prototype.getMessage = function(index) {
        return this.getMessages()[index];
    };

    Game_System.prototype.addMessage = function(sender, content, type) {
        this.ensureAnokiPhone();
        this._phoneMessages.unshift({
            sender: sender,
            content: content,
            type: type, // 'received' or 'sent'
            timestamp: formatStamp(currentGameDate()),
            read: type === 'sent'
        });
        if (this._phoneMessages.length > 20) this._phoneMessages.pop();
    };

    Game_System.prototype.readMessage = function(index) {
        const message = this.getMessage(index);
        if (message) message.read = true;
    };

    Game_System.prototype.deleteMessage = function(index) {
        this.ensureAnokiPhone();
        if (this._phoneMessages[index]) this._phoneMessages.splice(index, 1);
    };

    Game_System.prototype.clearPhoneMessages = function() {
        this._phoneMessages = [];
    };

    Game_System.prototype.hasUnreadPhoneMessages = function() {
        return this.getMessages().some(msg => !msg.read);
    };

    Game_System.prototype.getAvailableRingtones = function() {
        return availableRingtones;
    };

    Game_System.prototype.getSelectedRingtoneIndex = function() {
        return this._selectedRingtoneIndex || 0;
    };

    Game_System.prototype.setSelectedRingtoneIndex = function(index) {
        this.ensureAnokiPhone();
        const ringtones = this.getAvailableRingtones();
        this._selectedRingtoneIndex = ((index % ringtones.length) + ringtones.length) % ringtones.length;
    };

    Game_System.prototype.getCurrentRingtone = function() {
        return this.getAvailableRingtones()[this.getSelectedRingtoneIndex()] || availableRingtones[0];
    };

    // Back-compat shims for plugins that registered games through $gameSystem
    Game_System.prototype.registerHexphoneGame = function(gameName, gameData) {
        window.registerHexphoneGame(gameName, gameData);
    };

    Game_System.prototype.getPhoneGames = function() {
        return phoneGames;
    };

    //=============================================================================
    // Pending incoming call (module state, consumed by the scene)
    //=============================================================================

    let pendingIncomingCall = null;

    //=============================================================================
    // Scene_AnokiPhone
    //=============================================================================

    function Scene_AnokiPhone() {
        this.initialize(...arguments);
    }

    Scene_AnokiPhone.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_AnokiPhone.prototype.constructor = Scene_AnokiPhone;

    Scene_AnokiPhone.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
        this._screenMode = 'home';
        this._dialedNumber = '';
        this._buttons = [];
        this._screenAnimation = 0;
        this._inCall = false;
        this._freeCall = false;
        this._callDuration = 0;
        this._callTimer = null;
        this._connectTimeout = null;
        this._cursorBlink = 0;
        this._closing = false;
        this._gameSession = null;
        this._currentGameName = '';
        this._incomingContact = null;

        this._selectedMenuIndex = 0;
        this._selectedContactIndex = 0;
        this._selectedMessageIndex = 0;
        this._selectedGameIndex = 0;
        this._selectedSettingIndex = 0;
        this._selectedHistoryIndex = 0;
        this._messageScroll = 0;
    };

    Scene_AnokiPhone.prototype.create = function() {
        // Scene_MenuBase.create invokes this.createBackground() and
        // this.createButtons(); both are overridden below so the phone owns
        // its layout and buttons are only ever created once (creating them
        // twice made every click fire two handlers, and a doubled popScene
        // emptied the scene stack and shut the game down via SceneManager.exit).
        Scene_MenuBase.prototype.create.call(this);
        if ($gameSystem) $gameSystem.ensureAnokiPhone();
        this.createPhoneBody();
        this.createScreen();
        this.createPhoneButtons();
        this.playPowerOnSound();
    };

    Scene_AnokiPhone.prototype.createBackground = function() {
        // Transparent background, the phone floats over black
    };

    Scene_AnokiPhone.prototype.createButtons = function() {
        // Intentionally empty: Scene_MenuBase.create calls this before the
        // phone body exists. Real buttons are built in createPhoneButtons().
    };

    Scene_AnokiPhone.prototype.needsCancelButton = function() {
        return false;
    };

    Scene_AnokiPhone.prototype.start = function() {
        Scene_MenuBase.prototype.start.call(this);
        this._keyDownHandler = this.onDocumentKeyDown.bind(this);
        document.addEventListener('keydown', this._keyDownHandler);
        if (pendingIncomingCall) {
            this._incomingContact = pendingIncomingCall;
            pendingIncomingCall = null;
            this._screenMode = 'incoming';
            this.playRingtone();
            this.refreshScreen();
        }
    };

    //-------------------------------------------------------------------------
    // Phone body and screen (visuals unchanged from v2)
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.createPhoneBody = function() {
        const phoneX = Graphics.width / 2 - 150;
        const phoneY = 50;

        this._phoneSprite = new Sprite();
        this._phoneSprite.bitmap = new Bitmap(300, 600);
        this._phoneSprite.x = phoneX;
        this._phoneSprite.y = phoneY;

        const bitmap = this._phoneSprite.bitmap;
        const context = bitmap.context;

        const gradient = context.createLinearGradient(0, 0, 0, 600);
        gradient.addColorStop(0, '#3a4a5a');
        gradient.addColorStop(1, '#1f2937');

        context.fillStyle = gradient;
        context.roundRect(0, 0, 300, 600, 20);
        context.fill();

        context.strokeStyle = '#0f172a';
        context.lineWidth = 3;
        context.roundRect(0, 0, 300, 600, 20);
        context.stroke();

        bitmap.fontSize = 12;
        bitmap.fontFace = 'Arial';
        bitmap.textColor = '#94a3b8';
        bitmap.drawText('ANOKI', 0, 10, 300, 24, 'center');

        this.addChild(this._phoneSprite);
    };

    Scene_AnokiPhone.prototype.createScreen = function() {
        const screenX = Graphics.width / 2 - 130;
        const screenY = 90;

        this._screenSprite = new Sprite();
        this._screenSprite.bitmap = new Bitmap(260, 180);
        this._screenSprite.x = screenX;
        this._screenSprite.y = screenY;

        const bitmap = this._screenSprite.bitmap;
        bitmap.fillRect(0, 0, 260, 180, '#9fa870');

        const context = bitmap.context;
        context.strokeStyle = '#2d3748';
        context.lineWidth = 2;
        context.strokeRect(0, 0, 260, 180);

        this.addChild(this._screenSprite);

        this._contentSprite = new Sprite();
        this._contentSprite.bitmap = new Bitmap(250, 170);
        this._contentSprite.x = screenX + 5;
        this._contentSprite.y = screenY + 5;
        this.addChild(this._contentSprite);

        this.refreshScreen();
    };

    Scene_AnokiPhone.prototype.createPhoneButtons = function() {
        const startX = Graphics.width / 2 - 130;
        const buttonWidth = 70;
        const buttonHeight = 45;
        const spacing = 15;
        const funcY = 280;

        const callButton = new Sprite_AnokiButton(
            startX, funcY, buttonWidth, buttonHeight - 5, 'CALL', '#16a34a');
        callButton.setClickHandler(() => this.onCallButton());
        this._buttons.push(callButton);
        this.addChild(callButton);

        const menuButton = new Sprite_AnokiButton(
            startX + buttonWidth + spacing, funcY, buttonWidth, buttonHeight - 5, 'MENU', '#3b82f6');
        menuButton.setClickHandler(() => this.onMenuButton());
        this._buttons.push(menuButton);
        this.addChild(menuButton);

        const endButton = new Sprite_AnokiButton(
            startX + (buttonWidth + spacing) * 2, funcY, buttonWidth, buttonHeight - 5, 'END', '#dc2626');
        endButton.setClickHandler(() => this.onEndButton());
        this._buttons.push(endButton);
        this.addChild(endButton);

        const startY = funcY + (buttonHeight - 5) + spacing;
        // i18n-ignore-start: phone keypad legend, universal
        const buttonLayout = [
            [{label: '1\n', value: '1'}, {label: '2\nABC', value: '2'}, {label: '3\nDEF', value: '3'}],
            [{label: '4\nGHI', value: '4'}, {label: '5\nJKL', value: '5'}, {label: '6\nMNO', value: '6'}],
            [{label: '7\nPQRS', value: '7'}, {label: '8\nTUV', value: '8'}, {label: '9\nWXYZ', value: '9'}],
            [{label: '*', value: '*'}, {label: '0\n+', value: '0'}, {label: '#', value: '#'}]
        ];
        // i18n-ignore-end

        for (let row = 0; row < buttonLayout.length; row++) {
            for (let col = 0; col < buttonLayout[row].length; col++) {
                const btn = buttonLayout[row][col];
                const x = startX + col * (buttonWidth + spacing);
                const y = startY + row * (buttonHeight + spacing);
                const button = new Sprite_AnokiButton(x, y, buttonWidth, buttonHeight, btn.label, '#4a5568');
                button.setClickHandler(() => this.onNumberButton(btn.value));
                this._buttons.push(button);
                this.addChild(button);
            }
        }
    };

    //-------------------------------------------------------------------------
    // Screen rendering
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.refreshScreen = function() {
        if (!this._contentSprite || !this._contentSprite.bitmap) return;
        const bitmap = this._contentSprite.bitmap;
        bitmap.clear();
        bitmap.fontSize = 14;
        bitmap.fontFace = 'Courier New, monospace';
        bitmap.textColor = '#1a1a1a';

        switch (this._screenMode) {
            case 'home':        this.drawHomeScreen(bitmap); break;
            case 'menu':        this.drawMenuScreen(bitmap); break;
            case 'dial':        this.drawDialScreen(bitmap); break;
            case 'contacts':    this.drawContactsScreen(bitmap); break;
            case 'calling':     this.drawCallingScreen(bitmap); break;
            case 'incoming':    this.drawIncomingScreen(bitmap); break;
            case 'addContact':  this.drawAddContactScreen(bitmap); break;
            case 'callHistory': this.drawCallHistoryScreen(bitmap); break;
            case 'messages':    this.drawMessagesScreen(bitmap); break;
            case 'messageView': this.drawMessageViewScreen(bitmap); break;
            case 'settings':    this.drawSettingsScreen(bitmap); break;
            case 'games':       this.drawGamesScreen(bitmap); break;
            case 'game':        this.drawGameScreen(bitmap); break;
        }
    };

    Scene_AnokiPhone.prototype.drawHomeScreen = function(bitmap) {
        const credits = $gameSystem.getPhoneCredits();
        const timeStr = formatClock(currentGameDate());

        bitmap.fontSize = 20;
        bitmap.drawText(timeStr, 0, 10, 250, 24, 'center');

        bitmap.fontSize = 12;
        bitmap.drawText('ANOKI', 0, 40, 250, 20, 'center');

        bitmap.fontSize = 14;
        bitmap.drawText(getText('Credits') + ': €' + goldToEuros(credits), 0, 70, 250, 20, 'center');

        if ($gameSystem.hasUnreadPhoneMessages()) {
            bitmap.fontSize = 12;
            bitmap.fontBold = true;
            bitmap.drawText(getText('New Messages'), 0, 95, 250, 20, 'center');
            bitmap.fontBold = false;
        }

        bitmap.fontSize = 11;
        bitmap.drawText(getText('Press MENU'), 0, 120, 250, 20, 'center');
        bitmap.fontSize = 10;
        bitmap.drawText(getText('Press END to exit'), 0, 145, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawMenuScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('MENU'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        bitmap.fontSize = 12;
        const menuItems = [
            '1. ' + getText('CONTACTS'),
            '2. ' + getText('MESSAGES'),
            '3. ' + getText('CALL HISTORY'),
            '4. ' + getText('DIAL NUMBER'),
            '5. ' + getText('SETTINGS'),
            '6. ' + getText('GAMES')
        ];

        let y = 30;
        for (let i = 0; i < menuItems.length; i++) {
            const prefix = (i === this._selectedMenuIndex) ? '> ' : '  ';
            bitmap.drawText(prefix + menuItems[i], 10, y, 230, 20, 'left');
            y += 20;
        }

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Press END to exit'), 0, 150, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawDialScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('DIAL NUMBER'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        bitmap.fontSize = 18;
        const displayNumber = this._dialedNumber || '';
        const cursor = (this._cursorBlink < 30) ? '_' : ' ';
        bitmap.drawText(displayNumber + cursor, 0, 40, 250, 24, 'center');

        bitmap.fontSize = 11;
        bitmap.drawText(getText('Enter number and'), 0, 100, 250, 20, 'center');
        bitmap.drawText(getText('press CALL button'), 0, 115, 250, 20, 'center');

        if (this._dialedNumber) {
            bitmap.fontSize = 10;
            bitmap.drawText(getText('Delete and Save'), 0, 145, 250, 20, 'center');
        }
    };

    Scene_AnokiPhone.prototype.drawContactsScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('CONTACTS'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        const contacts = Object.values($gameSystem.getContacts());

        if (contacts.length === 0) {
            bitmap.fontSize = 12;
            bitmap.drawText(getText('No contacts'), 0, 60, 250, 20, 'center');
        } else {
            bitmap.fontSize = 11;
            let y = 30;
            const maxDisplay = 4;
            const start = Math.max(0, Math.min(this._selectedContactIndex - 1, contacts.length - maxDisplay));
            const end = Math.min(contacts.length, start + maxDisplay);

            for (let i = start; i < end; i++) {
                const contact = contacts[i];
                const prefix = (i === this._selectedContactIndex) ? '> ' : '  ';
                bitmap.fontSize = 11;
                bitmap.drawText(prefix + contact.name, 5, y, 230, 20, 'left');
                bitmap.fontSize = 9;
                bitmap.drawText(contact.number, 15, y + 12, 220, 20, 'left');
                y += 28;
            }

            bitmap.fontSize = 10;
            bitmap.drawText(getText('Call and Delete'), 0, 150, 250, 20, 'center');
        }
    };

    Scene_AnokiPhone.prototype.drawCallingScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('CALLING'), 0, 20, 250, 20, 'center');
        bitmap.fontBold = false;

        bitmap.fontSize = 16;
        bitmap.drawText(this._currentCallName || T('Hexphone.unknownCaller'), 0, 50, 250, 20, 'center');

        bitmap.fontSize = 12;
        bitmap.drawText(this._dialedNumber || '', 0, 75, 250, 20, 'center');

        if (this._inCall) {
            const duration = Math.floor(this._callDuration);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const durationStr = minutes.toString().padStart(2, '0') + ':' +
                                seconds.toString().padStart(2, '0');

            bitmap.fontSize = 18;
            bitmap.drawText(durationStr, 0, 100, 250, 24, 'center');

            if (!this._freeCall) {
                const cost = Math.floor(this._callDuration * callCostPerSecond);
                bitmap.fontSize = 11;
                bitmap.drawText(getText('Cost') + ': €' + goldToEuros(cost), 0, 130, 250, 20, 'center');
            }
        } else {
            bitmap.fontSize = 11;
            bitmap.drawText(getText('Connecting'), 0, 105, 250, 20, 'center');
        }

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Press to hang up'), 0, 150, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawIncomingScreen = function(bitmap) {
        const contact = this._incomingContact;
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('INCOMING CALL'), 0, 20, 250, 20, 'center');
        bitmap.fontBold = false;

        bitmap.fontSize = 16;
        bitmap.drawText(contact ? contact.name : T('Hexphone.unknownCaller'), 0, 55, 250, 20, 'center');
        bitmap.fontSize = 12;
        bitmap.drawText(contact ? contact.number : '', 0, 80, 250, 20, 'center');

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Answer or Decline'), 0, 145, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawAddContactScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('ADD CONTACT'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        bitmap.fontSize = 12;
        bitmap.drawText(getText('Enter number'), 10, 35, 220, 20, 'left');

        bitmap.fontSize = 16;
        const cursor = (this._cursorBlink < 30) ? '_' : ' ';
        bitmap.drawText((this._dialedNumber || '') + cursor, 0, 55, 250, 24, 'center');

        bitmap.fontSize = 11;
        bitmap.drawText(getText('Then press MENU'), 0, 100, 250, 20, 'center');
        bitmap.drawText(getText('to save contact'), 0, 115, 250, 20, 'center');

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Delete and Cancel'), 0, 145, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawCallHistoryScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('CALL HISTORY'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        const history = $gameSystem.getCallHistory();

        if (history.length === 0) {
            bitmap.fontSize = 12;
            bitmap.drawText(getText('No call history'), 0, 70, 250, 20, 'center');
        } else {
            let y = 30;
            const maxDisplay = 4;
            const start = Math.max(0, Math.min(this._selectedHistoryIndex - 1, history.length - maxDisplay));
            const end = Math.min(history.length, start + maxDisplay);

            for (let i = start; i < end; i++) {
                const call = history[i];
                const prefix = (i === this._selectedHistoryIndex) ? '> ' : '  ';
                bitmap.fontSize = 10;
                bitmap.drawText(prefix + call.name, 5, y, 180, 20, 'left');
                bitmap.drawText(call.timestamp || '', 150, y, 95, 20, 'left');

                const duration = Math.floor(call.duration || 0);
                const durationStr = call.note ? call.note :
                    Math.floor(duration / 60) + ':' + (duration % 60).toString().padStart(2, '0');

                bitmap.fontSize = 9;
                bitmap.drawText(call.number + ' (' + durationStr + ')', 15, y + 10, 230, 20, 'left');
                y += 26;
            }

            bitmap.fontSize = 10;
            bitmap.drawText(getText('Redial hint'), 0, 150, 250, 20, 'center');
        }
    };

    Scene_AnokiPhone.prototype.drawMessagesScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('MESSAGES'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        const messages = $gameSystem.getMessages();

        if (messages.length === 0) {
            bitmap.fontSize = 12;
            bitmap.drawText(getText('No messages'), 0, 70, 250, 20, 'center');
        } else {
            let y = 30;
            const maxDisplay = 4;
            const start = Math.max(0, Math.min(this._selectedMessageIndex - 1, messages.length - maxDisplay));
            const end = Math.min(messages.length, start + maxDisplay);

            for (let i = start; i < end; i++) {
                const message = messages[i];
                const prefix = (i === this._selectedMessageIndex) ? '> ' : '  ';
                let sender = message.sender;
                if (message.type === 'sent') sender = 'To: ' + sender;
                if (!message.read) sender = '(N) ' + sender;
                bitmap.fontSize = 11;
                bitmap.drawText(prefix + sender, 5, y, 230, 20, 'left');

                bitmap.fontSize = 9;
                const snippet = message.content.substring(0, 30) + (message.content.length > 30 ? '...' : '');
                bitmap.drawText(snippet, 15, y + 12, 220, 20, 'left');
                y += 28;
            }
        }

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Read and Delete'), 0, 150, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawMessageViewScreen = function(bitmap) {
        const message = $gameSystem.getMessage(this._selectedMessageIndex);
        if (!message) {
            this._screenMode = 'messages';
            this.refreshScreen();
            return;
        }

        bitmap.fontSize = 12;
        bitmap.fontBold = true;
        const title = message.type === 'sent' ? 'To: ' : 'From: ';
        bitmap.drawText(title + message.sender, 0, 3, 250, 18, 'center');
        bitmap.fontBold = false;
        bitmap.fontSize = 9;
        bitmap.drawText(message.timestamp || '', 0, 19, 250, 12, 'center');

        bitmap.fontSize = 11;
        this.drawWrappedText(bitmap, message.content, 5, 34, 240, 14, this._messageScroll, 8);

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Press END to return'), 0, 152, 250, 18, 'center');
    };

    Scene_AnokiPhone.prototype.drawSettingsScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('SETTINGS'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        const ringtone = $gameSystem.getCurrentRingtone();
        bitmap.fontSize = 12;
        bitmap.drawText('> ' + getText('Ringtone') + ': <' + ringtone.name + '>', 5, 40, 240, 20, 'left');

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Change setting'), 0, 150, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawGamesScreen = function(bitmap) {
        bitmap.fontSize = 14;
        bitmap.fontBold = true;
        bitmap.drawText(getText('GAMES'), 0, 5, 250, 20, 'center');
        bitmap.fontBold = false;

        const games = $gameSystem.getPhoneGames();

        if (games.length === 0) {
            bitmap.fontSize = 12;
            bitmap.drawText(getText('No games'), 0, 70, 250, 20, 'center');
        } else {
            bitmap.fontSize = 11;
            let y = 30;
            const maxDisplay = 5;
            const start = Math.max(0, Math.min(this._selectedGameIndex - 2, games.length - maxDisplay));
            const end = Math.min(games.length, start + maxDisplay);

            for (let i = start; i < end; i++) {
                const prefix = (i === this._selectedGameIndex) ? '> ' : '  ';
                bitmap.drawText(prefix + games[i].name, 5, y, 230, 20, 'left');
                y += 22;
            }
        }

        bitmap.fontSize = 10;
        bitmap.drawText(getText('Play Game'), 0, 150, 250, 20, 'center');
    };

    Scene_AnokiPhone.prototype.drawGameScreen = function(bitmap) {
        if (this._gameSession && typeof this._gameSession.draw === 'function') {
            this._gameSession.draw(bitmap);
        }
    };

    Scene_AnokiPhone.prototype.drawWrappedText = function(bitmap, text, x, y, maxWidth, lineHeight, startLine, maxLines) {
        const lines = [];
        for (const rawLine of String(text).split('\n')) {
            const words = rawLine.split(' ');
            let line = '';
            for (const word of words) {
                const testLine = line ? line + ' ' + word : word;
                if (bitmap.measureTextWidth(testLine) > maxWidth && line) {
                    lines.push(line);
                    line = word;
                } else {
                    line = testLine;
                }
            }
            lines.push(line);
        }

        const first = startLine || 0;
        const count = maxLines || lines.length;
        let currentY = y;
        for (let i = first; i < Math.min(lines.length, first + count); i++) {
            bitmap.drawText(lines[i], x, currentY, maxWidth, lineHeight, 'left');
            currentY += lineHeight;
        }
        return lines.length;
    };

    //-------------------------------------------------------------------------
    // Button and key handling
    //-------------------------------------------------------------------------

    // Digits, * and # from the physical keyboard. Handled through a DOM
    // listener because the engine keyMapper does not map digit keys and
    // patching Input._currentState with raw codes never works.
    Scene_AnokiPhone.prototype.onDocumentKeyDown = function(event) {
        if (SceneManager._scene !== this || this._closing) return;
        const key = event.key;
        if (key >= '0' && key <= '9') {
            this.onNumberButton(key);
        } else if (key === '*' || key === 'Backspace' || key === 'Delete') { // i18n-ignore: DOM key names
            this.onNumberButton('*');
        } else if (key === '#') {
            this.onNumberButton('#');
        }
    };

    Scene_AnokiPhone.prototype.onNumberButton = function(value) {
        if (this._closing) return;
        this.playButtonSound();

        switch (this._screenMode) {
            case 'home':
                if (value >= '0' && value <= '9') {
                    this._screenMode = 'dial';
                    this._dialedNumber = value;
                    this.refreshScreen();
                }
                break;

            case 'dial':
            case 'addContact':
                if (value === '*') {
                    this._dialedNumber = this._dialedNumber.slice(0, -1);
                } else if (value !== '#') {
                    if (this._dialedNumber.length < 15) this._dialedNumber += value;
                }
                this.refreshScreen();
                break;

            case 'menu':
                if (value >= '1' && value <= '6') {
                    this._selectedMenuIndex = Number(value) - 1;
                    this.enterMenuItem(this._selectedMenuIndex);
                }
                this.refreshScreen();
                break;

            case 'contacts': {
                const contacts = Object.values($gameSystem.getContacts());
                if (contacts.length === 0) break;
                if (value === '2') {
                    this._selectedContactIndex = (this._selectedContactIndex + 1) % contacts.length;
                } else if (value === '8') {
                    this._selectedContactIndex = (this._selectedContactIndex - 1 + contacts.length) % contacts.length;
                } else if (value === '*') {
                    const contact = contacts[this._selectedContactIndex];
                    $gameSystem.removeContact(contact.name);
                    this._selectedContactIndex = Math.max(0, this._selectedContactIndex - 1);
                }
                this.refreshScreen();
                break;
            }

            case 'callHistory': {
                const history = $gameSystem.getCallHistory();
                if (history.length === 0) break;
                if (value === '2') {
                    this._selectedHistoryIndex = (this._selectedHistoryIndex + 1) % history.length;
                } else if (value === '8') {
                    this._selectedHistoryIndex = (this._selectedHistoryIndex - 1 + history.length) % history.length;
                }
                this.refreshScreen();
                break;
            }

            case 'calling':
                if (value === '#') this.endCall();
                break;

            case 'messages': {
                const messages = $gameSystem.getMessages();
                if (messages.length === 0) break;
                if (value === '2') {
                    this._selectedMessageIndex = (this._selectedMessageIndex + 1) % messages.length;
                } else if (value === '8') {
                    this._selectedMessageIndex = (this._selectedMessageIndex - 1 + messages.length) % messages.length;
                } else if (value === '*') {
                    $gameSystem.deleteMessage(this._selectedMessageIndex);
                    this._selectedMessageIndex = Math.max(0, this._selectedMessageIndex - 1);
                }
                this.refreshScreen();
                break;
            }

            case 'messageView':
                if (value === '2') this._messageScroll++;
                else if (value === '8') this._messageScroll = Math.max(0, this._messageScroll - 1);
                this.refreshScreen();
                break;

            case 'settings':
                if (value === '4' || value === '2') {
                    this.changeRingtone(-1);
                } else if (value === '6' || value === '8') {
                    this.changeRingtone(1);
                }
                this.refreshScreen();
                break;

            case 'games': {
                const games = $gameSystem.getPhoneGames();
                if (games.length === 0) break;
                if (value === '2') {
                    this._selectedGameIndex = (this._selectedGameIndex + 1) % games.length;
                } else if (value === '8') {
                    this._selectedGameIndex = (this._selectedGameIndex - 1 + games.length) % games.length;
                }
                this.refreshScreen();
                break;
            }

            case 'game':
                if (this._gameSession && typeof this._gameSession.onKey === 'function') {
                    this._gameSession.onKey(value);
                    // Force a redraw next frame: onKey may change game state that
                    // update() won't re-signal as dirty.
                    this._gameSessionDirty = true;
                }
                break;
        }
    };

    Scene_AnokiPhone.prototype.enterMenuItem = function(index) {
        switch (index) {
            case 0: this._screenMode = 'contacts'; this._selectedContactIndex = 0; break;
            case 1: this._screenMode = 'messages'; this._selectedMessageIndex = 0; break;
            case 2: this._screenMode = 'callHistory'; this._selectedHistoryIndex = 0; break;
            case 3: this._screenMode = 'dial'; this._dialedNumber = ''; break;
            case 4: this._screenMode = 'settings'; break;
            case 5: this._screenMode = 'games'; this._selectedGameIndex = 0; break;
        }
    };

    Scene_AnokiPhone.prototype.changeRingtone = function(delta) {
        $gameSystem.setSelectedRingtoneIndex($gameSystem.getSelectedRingtoneIndex() + delta);
        const ringtone = $gameSystem.getCurrentRingtone();
        AudioManager.stopSe();
        playSeSafe(ringtone.se, ringtone.volume, ringtone.pitch);
    };

    Scene_AnokiPhone.prototype.onCallButton = function() {
        if (this._closing) return;
        this.playButtonSound();

        if (this._screenMode === 'incoming') {
            this.answerIncomingCall();
        } else if (this._screenMode === 'dial' && this._dialedNumber) {
            const contact = $gameSystem.findContactByNumber(this._dialedNumber);
            if (contact) {
                this.initiateCall(contact.number, contact.name, contact.commonEventId);
            } else {
                this.initiateCall(this._dialedNumber, T('Hexphone.unknownCaller'), 0);
            }
        } else if (this._screenMode === 'contacts') {
            this.callSelectedContact();
        } else if (this._screenMode === 'callHistory') {
            this.redialSelectedHistory();
        } else if (this._screenMode === 'home') {
            this._screenMode = 'dial';
            this._dialedNumber = '';
            this.refreshScreen();
        } else if (this._screenMode === 'messages') {
            this.openMessage();
        } else if (this._screenMode === 'games') {
            this.launchGame();
        }
    };

    Scene_AnokiPhone.prototype.onMenuButton = function() {
        if (this._closing) return;
        this.playButtonSound();

        switch (this._screenMode) {
            case 'home':
                this._screenMode = 'menu';
                this.refreshScreen();
                break;
            case 'menu':
                this.enterMenuItem(this._selectedMenuIndex);
                this.refreshScreen();
                break;
            case 'dial':
                if (this._dialedNumber) {
                    this._screenMode = 'addContact';
                    this.refreshScreen();
                }
                break;
            case 'addContact':
                if (this._dialedNumber) {
                    const name = 'Contact_' + this._dialedNumber.substring(0, 4); // i18n-ignore: internal contact id
                    $gameSystem.addCustomContact(name, this._dialedNumber, 0);
                    this._dialedNumber = '';
                    this._screenMode = 'contacts';
                    this._selectedContactIndex = 0;
                    this.refreshScreen();
                }
                break;
            case 'contacts':
                this.callSelectedContact();
                break;
            case 'callHistory':
                this.redialSelectedHistory();
                break;
            case 'messages':
                this.openMessage();
                break;
            case 'games':
                this.launchGame();
                break;
            case 'incoming':
                this.answerIncomingCall();
                break;
            case 'game':
                if (this._gameSession && typeof this._gameSession.onKey === 'function') {
                    this._gameSession.onKey('menu');
                }
                break;
        }
    };

    Scene_AnokiPhone.prototype.onEndButton = function() {
        if (this._closing) return;
        this.playButtonSound();

        if (this._screenMode === 'calling') {
            this.endCall();
            return;
        }
        if (this._screenMode === 'incoming') {
            this.declineIncomingCall();
            return;
        }
        if (this._screenMode === 'game') {
            this.exitGame();
            return;
        }

        if (this._screenMode === 'menu') {
            this._screenMode = 'home';
            this.refreshScreen();
        } else if (['dial', 'contacts', 'addContact', 'callHistory',
                    'messages', 'settings', 'games'].includes(this._screenMode)) {
            this._screenMode = 'menu';
            this._dialedNumber = '';
            this.refreshScreen();
        } else if (this._screenMode === 'messageView') {
            this._screenMode = 'messages';
            this.refreshScreen();
        } else if (this._screenMode === 'home') {
            this.safeClose();
        }
    };

    Scene_AnokiPhone.prototype.callSelectedContact = function() {
        const contacts = Object.values($gameSystem.getContacts());
        if (contacts.length > 0) {
            const contact = contacts[this._selectedContactIndex];
            if (contact) this.initiateCall(contact.number, contact.name, contact.commonEventId);
        }
    };

    Scene_AnokiPhone.prototype.redialSelectedHistory = function() {
        const history = $gameSystem.getCallHistory();
        const entry = history[this._selectedHistoryIndex];
        if (!entry) return;
        const contact = $gameSystem.findContactByNumber(entry.number);
        this.initiateCall(entry.number, entry.name, contact ? contact.commonEventId : 0);
    };

    Scene_AnokiPhone.prototype.openMessage = function() {
        const messages = $gameSystem.getMessages();
        if (messages.length > 0) {
            $gameSystem.readMessage(this._selectedMessageIndex);
            this._messageScroll = 0;
            this._screenMode = 'messageView';
            this.refreshScreen();
        }
    };

    //-------------------------------------------------------------------------
    // Games
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.launchGame = function() {
        const games = $gameSystem.getPhoneGames();
        const game = games[this._selectedGameIndex];
        if (!game) return;

        const inlineDef = inlineGames[game.name];
        if (inlineDef) {
            this._gameSession = inlineDef.create();
            this._currentGameName = game.name;
            this._screenMode = 'game';
            // Extension point kept for legacy plugins that hook createGamePlay
            this.createGamePlay(game.name);
            this.refreshScreen();
        } else if (game.commonEventId > 0) {
            // Event-based games run on the map
            this.exitToMapWithEvent(game.commonEventId);
        } else {
            // Extension point: plugins may hook createGamePlay and take over
            this._currentGameName = game.name;
            this._screenMode = 'game';
            this.createGamePlay(game.name);
            this.refreshScreen();
        }
    };

    Scene_AnokiPhone.prototype.exitGame = function() {
        if (this._gameSession && typeof this._gameSession.destroy === 'function') {
            this._gameSession.destroy();
        }
        this._gameSession = null;
        this._currentGameName = '';
        this._screenMode = 'games';
        this.refreshScreen();
    };

    // Legacy extension hooks (external plugins may alias these)
    Scene_AnokiPhone.prototype.createGamePlay = function(gameName) {};
    Scene_AnokiPhone.prototype.updatePhoneScreen = function() {};
    Scene_AnokiPhone.prototype.handleInput = function() {};

    //-------------------------------------------------------------------------
    // Call logic
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.initiateCall = function(number, name, commonEventId) {
        const eventId = Number(commonEventId) || 0;
        if (eventId === 0 && $gameSystem.getPhoneCredits() < callCostPerSecond) {
            this.playErrorSound();
            return;
        }

        this._screenMode = 'calling';
        this._dialedNumber = number;
        this._currentCallName = name;
        this._currentCallEventId = eventId;
        this._inCall = false;
        this._freeCall = eventId > 0;
        this._callDuration = 0;

        this.playRingtone();

        this.clearConnectTimeout();
        this._connectTimeout = setTimeout(() => {
            this._connectTimeout = null;
            if (this._closing || this._screenMode !== 'calling') return;
            this.playConnectSound();
            if (this._currentCallEventId > 0) {
                // Contact answers: log the call and play its Common Event on
                // the map, mirroring how vanilla items run map events.
                $gameSystem.addCallToHistory(this._dialedNumber, this._currentCallName, 0);
                this.exitToMapWithEvent(this._currentCallEventId);
            } else {
                this._inCall = true;
                this.startCallTimer();
                this.refreshScreen();
            }
        }, 1500);

        this.refreshScreen();
    };

    Scene_AnokiPhone.prototype.startCallTimer = function() {
        this.clearCallTimer();
        this._callTimer = setInterval(() => {
            if (this._closing) {
                this.clearCallTimer();
                return;
            }
            if (this._inCall) {
                this._callDuration++;
                if (!this._freeCall && !$gameSystem.consumeCredits(callCostPerSecond)) {
                    this.endCall();
                    this.playErrorSound();
                    return;
                }
                this.refreshScreen();
            }
        }, 1000);
    };

    Scene_AnokiPhone.prototype.clearCallTimer = function() {
        if (this._callTimer) {
            clearInterval(this._callTimer);
            this._callTimer = null;
        }
    };

    Scene_AnokiPhone.prototype.clearConnectTimeout = function() {
        if (this._connectTimeout) {
            clearTimeout(this._connectTimeout);
            this._connectTimeout = null;
        }
    };

    Scene_AnokiPhone.prototype.endCall = function() {
        this.clearCallTimer();
        this.clearConnectTimeout();

        if (this._callDuration > 0) {
            $gameSystem.addCallToHistory(this._dialedNumber, this._currentCallName, this._callDuration);
        }

        this._inCall = false;
        this._freeCall = false;
        this._screenMode = 'home';
        this._dialedNumber = '';
        this._currentCallName = '';
        this._currentCallEventId = 0;
        this._callDuration = 0;

        this.playHangupSound();
        this.refreshScreen();
    };

    Scene_AnokiPhone.prototype.answerIncomingCall = function() {
        const contact = this._incomingContact;
        this._incomingContact = null;
        if (!contact) {
            this._screenMode = 'home';
            this.refreshScreen();
            return;
        }
        this.playConnectSound();
        if (contact.commonEventId > 0) {
            $gameSystem.addCallToHistory(contact.number, contact.name, 0);
            this.exitToMapWithEvent(contact.commonEventId);
        } else {
            this._screenMode = 'calling';
            this._dialedNumber = contact.number;
            this._currentCallName = contact.name;
            this._currentCallEventId = 0;
            this._inCall = true;
            this._freeCall = true; // incoming calls cost nothing
            this._callDuration = 0;
            this.startCallTimer();
            this.refreshScreen();
        }
    };

    Scene_AnokiPhone.prototype.declineIncomingCall = function() {
        const contact = this._incomingContact;
        this._incomingContact = null;
        if (contact) {
            $gameSystem.addCallToHistory(contact.number, contact.name, 0, getText('Declined'));
        }
        this.playHangupSound();
        this._screenMode = 'home';
        this.refreshScreen();
    };

    //-------------------------------------------------------------------------
    // Scene exit paths (all guarded against double execution)
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.safeClose = function() {
        if (this._closing) return;
        this._closing = true;
        this.popScene();
    };

    Scene_AnokiPhone.prototype.exitToMapWithEvent = function(commonEventId) {
        if (this._closing) return;
        this._closing = true;
        $gameTemp.reserveCommonEvent(commonEventId);
        SceneManager.goto(Scene_Map);
    };

    //-------------------------------------------------------------------------
    // Update
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        if (this._closing) return;

        this._screenAnimation++;
        this.updateEngineInput();
        this.updateGameSession();
        this.updatePhoneScreen();
        this.handleInput();
        this.updateCursorBlink();
        this.updateAmbient();
    };

    Scene_AnokiPhone.prototype.updateEngineInput = function() {
        // ok = MENU button, cancel = END button, arrows = list navigation.
        // Keyboard digits arrive via the DOM listener instead.
        if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
            this.onEndButton();
            return;
        }
        if (Input.isTriggered('ok')) {
            if (this._screenMode !== 'game') {
                this.onMenuButton();
                return;
            }
        }

        if (this._screenMode === 'game') return; // games read Input directly

        if (Input.isRepeated('down')) {
            this.navigateList(1);
        } else if (Input.isRepeated('up')) {
            this.navigateList(-1);
        } else if (Input.isTriggered('left')) {
            if (this._screenMode === 'settings') { this.changeRingtone(-1); this.refreshScreen(); }
        } else if (Input.isTriggered('right')) {
            if (this._screenMode === 'settings') { this.changeRingtone(1); this.refreshScreen(); }
        }
    };

    Scene_AnokiPhone.prototype.navigateList = function(delta) {
        switch (this._screenMode) {
            case 'menu':
                this._selectedMenuIndex = (this._selectedMenuIndex + delta + 6) % 6;
                this.playButtonSound();
                this.refreshScreen();
                break;
            case 'contacts':
                this.onNumberButton(delta > 0 ? '2' : '8');
                break;
            case 'messages':
                this.onNumberButton(delta > 0 ? '2' : '8');
                break;
            case 'games':
                this.onNumberButton(delta > 0 ? '2' : '8');
                break;
            case 'callHistory':
                this.onNumberButton(delta > 0 ? '2' : '8');
                break;
            case 'messageView':
                this.onNumberButton(delta > 0 ? '2' : '8');
                break;
        }
    };

    Scene_AnokiPhone.prototype.updateGameSession = function() {
        if (this._screenMode === 'game' && this._gameSession) {
            let dirty = true;
            if (typeof this._gameSession.update === 'function') {
                dirty = this._gameSession.update(this);
            }
            // Built-in games return an explicit boolean so we only re-render the
            // LCD when their state actually changed (most frames nothing moves).
            // Sessions that return undefined keep refreshing every frame, matching
            // their original behaviour. onKey-driven changes set _gameSessionDirty.
            if (dirty !== false || this._gameSessionDirty) {
                this.refreshScreen();
                this._gameSessionDirty = false;
            }
        }
    };

    Scene_AnokiPhone.prototype.updateCursorBlink = function() {
        if (this._screenMode === 'dial' || this._screenMode === 'addContact') {
            const oldBlink = this._cursorBlink;
            this._cursorBlink = (this._cursorBlink + 1) % 60;
            if (Math.floor(oldBlink / 30) !== Math.floor(this._cursorBlink / 30)) {
                this.refreshScreen();
            }
        } else {
            this._cursorBlink = 0;
        }
    };

    Scene_AnokiPhone.prototype.updateAmbient = function() {
        // Keep the home clock ticking and re-ring incoming calls
        if (this._screenMode === 'home' && this._screenAnimation % 60 === 0) {
            this.refreshScreen();
        }
        if (this._screenMode === 'incoming' && this._screenAnimation % 90 === 0) {
            this.playRingtone();
        }
        this._contentSprite.opacity = (this._screenAnimation % 120 === 0) ? 250 : 255;
    };

    //-------------------------------------------------------------------------
    // Sounds
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.playButtonSound = function() {
        playSeSafe('Cursor1', 60, 120);
    };

    Scene_AnokiPhone.prototype.playErrorSound = function() {
        playSeSafe('Buzzer1', 70, 100);
    };

    Scene_AnokiPhone.prototype.playRingtone = function() {
        const ringtone = $gameSystem.getCurrentRingtone();
        if (ringtone) playSeSafe(ringtone.se, ringtone.volume, ringtone.pitch);
    };

    Scene_AnokiPhone.prototype.playConnectSound = function() {
        playSeSafe('Decision2', 70, 120);
    };

    Scene_AnokiPhone.prototype.playHangupSound = function() {
        playSeSafe('Cancel2', 70, 90);
    };

    Scene_AnokiPhone.prototype.playPowerOnSound = function() {
        playSeSafe('Computer', 70, 150); // i18n-ignore: SE filename
    };

    //-------------------------------------------------------------------------
    // Teardown
    //-------------------------------------------------------------------------

    Scene_AnokiPhone.prototype.terminate = function() {
        Scene_MenuBase.prototype.terminate.call(this);
        this._closing = true;
        this.clearCallTimer();
        this.clearConnectTimeout();
        if (this._keyDownHandler) {
            document.removeEventListener('keydown', this._keyDownHandler);
            this._keyDownHandler = null;
        }
        this._gameSession = null;
        AudioManager.stopSe();
        playSeSafe('Cancel1', 70, 80);
    };

    // Export for extension plugins (HexphoneTetris-style hooks)
    window.Scene_AnokiPhone = Scene_AnokiPhone;
    window.Scene_Hexphone = Scene_AnokiPhone;

    //=============================================================================
    // Sprite_AnokiButton
    //=============================================================================

    function Sprite_AnokiButton() {
        this.initialize(...arguments);
    }

    Sprite_AnokiButton.prototype = Object.create(Sprite_Clickable.prototype);
    Sprite_AnokiButton.prototype.constructor = Sprite_AnokiButton;

    Sprite_AnokiButton.prototype.initialize = function(x, y, width, height, label, color) {
        Sprite_Clickable.prototype.initialize.call(this);
        this.move(x, y);
        this._buttonWidth = width;
        this._buttonHeight = height;
        this._label = label;
        this._color = color || '#4a5568';
        this.createButtonBitmap();
    };

    Sprite_AnokiButton.prototype.createButtonBitmap = function() {
        this.bitmap = new Bitmap(this._buttonWidth, this._buttonHeight);
        this.redraw();
    };

    Sprite_AnokiButton.prototype.redraw = function() {
        const bitmap = this.bitmap;
        const context = bitmap.context;

        bitmap.clear();

        const gradient = context.createLinearGradient(0, 0, 0, this._buttonHeight);
        gradient.addColorStop(0, this.lightenColor(this._color, 20));
        gradient.addColorStop(0.5, this._color);
        gradient.addColorStop(1, this.darkenColor(this._color, 20));

        context.fillStyle = gradient;
        context.roundRect(0, 0, this._buttonWidth, this._buttonHeight, 5);
        context.fill();

        context.strokeStyle = this.darkenColor(this._color, 40);
        context.lineWidth = 2;
        context.roundRect(0, 0, this._buttonWidth, this._buttonHeight, 5);
        context.stroke();

        bitmap.fontFace = 'Arial, sans-serif';
        bitmap.fontSize = 14;
        bitmap.textColor = '#ffffff';
        bitmap.outlineColor = 'rgba(0, 0, 0, 0.5)';
        bitmap.outlineWidth = 3;

        const lines = this._label.split('\n');
        if (lines.length === 1) {
            bitmap.drawText(this._label, 0, this._buttonHeight / 2 - 7, this._buttonWidth, 20, 'center');
        } else {
            bitmap.fontSize = 16;
            bitmap.drawText(lines[0], 0, 4, this._buttonWidth, 20, 'center');
            bitmap.fontSize = 9;
            bitmap.drawText(lines[1], 0, 22, this._buttonWidth, 20, 'center');
        }
    };

    Sprite_AnokiButton.prototype.lightenColor = function(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255))
            .toString(16).slice(1);
    };

    Sprite_AnokiButton.prototype.darkenColor = function(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return '#' + (0x1000000 + (R > 0 ? R : 0) * 0x10000 +
            (G > 0 ? G : 0) * 0x100 +
            (B > 0 ? B : 0))
            .toString(16).slice(1);
    };

    Sprite_AnokiButton.prototype.setClickHandler = function(handler) {
        this._clickHandler = handler;
    };

    Sprite_AnokiButton.prototype.onClick = function() {
        if (this._clickHandler) this._clickHandler();
    };

    Sprite_AnokiButton.prototype.update = function() {
        Sprite_Clickable.prototype.update.call(this);
        const scale = this.isPressed() ? 0.95 : 1.0;
        this.scale.x = scale;
        this.scale.y = scale;
    };

    //=============================================================================
    // Built-in minigames (LCD style, drawn on the 250x170 content bitmap)
    //=============================================================================

    const LCD_DARK = '#1a2a1a';
    const LCD_MID = '#4a5a40';

    //---------------------------------------------------------------------------
    // Snake
    //---------------------------------------------------------------------------

    class HexphoneSnakeGame {
        constructor() {
            this.reset();
            if (window.MinigameFun) window.MinigameFun.played('Video Gaming'); // i18n-ignore: leisure activity id
        }

        reset() {
            this.cols = 25;
            this.rows = 15;
            this.cell = 10;
            this.snake = [{x: 12, y: 7}, {x: 11, y: 7}, {x: 10, y: 7}];
            this.dir = {x: 1, y: 0};
            this.nextDir = {x: 1, y: 0};
            this.food = null;
            this.score = 0;
            this.gameOver = false;
            this.tick = 0;
            this.speed = 9; // frames per step
            this.placeFood();
        }

        placeFood() {
            let x, y, tries = 0;
            do {
                x = Math.floor(Math.random() * this.cols);
                y = Math.floor(Math.random() * this.rows);
                tries++;
            } while (this.snake.some(s => s.x === x && s.y === y) && tries < 200);
            this.food = {x, y};
        }

        setDirection(dx, dy) {
            if (dx === -this.dir.x && dy === -this.dir.y) return;
            this.nextDir = {x: dx, y: dy};
        }

        onKey(value) {
            if (value === '4') this.setDirection(-1, 0);
            else if (value === '6') this.setDirection(1, 0);
            else if (value === '2') this.setDirection(0, 1);
            else if (value === '8') this.setDirection(0, -1);
            else if (value === '5' || value === 'menu') {
                if (this.gameOver) this.reset();
            }
        }

        // Returns true when the visible state changed (needs an LCD redraw).
        // Direction input only alters nextDir, which isn't drawn until the snake
        // actually steps, so those frames report no change.
        update(scene) {
            if (Input.isTriggered('left')) this.setDirection(-1, 0);
            if (Input.isTriggered('right')) this.setDirection(1, 0);
            if (Input.isTriggered('up')) this.setDirection(0, -1);
            if (Input.isTriggered('down')) this.setDirection(0, 1);
            if (this.gameOver) {
                if (Input.isTriggered('ok')) { this.reset(); return true; }
                return false;
            }

            this.tick++;
            if (this.tick < this.speed) return false;
            this.tick = 0;

            this.dir = this.nextDir;
            const head = {x: this.snake[0].x + this.dir.x, y: this.snake[0].y + this.dir.y};

            if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows ||
                this.snake.some(s => s.x === head.x && s.y === head.y)) {
                this.gameOver = true;
                playSeSafe('Buzzer1', 60, 110);
                if (window.MinigameFun) window.MinigameFun.lost('Video Gaming'); // i18n-ignore: leisure activity id
                return true;
            }

            this.snake.unshift(head);
            if (this.food && head.x === this.food.x && head.y === this.food.y) {
                this.score += 10;
                this.speed = Math.max(4, 9 - Math.floor(this.score / 50));
                playSeSafe('Cursor1', 50, 150);
                this.placeFood();
            } else {
                this.snake.pop();
            }
            return true;
        }

        draw(bitmap) {
            const boardH = this.rows * this.cell;

            for (const seg of this.snake) {
                bitmap.fillRect(seg.x * this.cell + 1, seg.y * this.cell + 1, this.cell - 2, this.cell - 2, LCD_DARK);
            }
            if (this.food) {
                bitmap.fillRect(this.food.x * this.cell + 2, this.food.y * this.cell + 2, this.cell - 4, this.cell - 4, LCD_MID);
            }

            bitmap.fontSize = 11;
            bitmap.textColor = LCD_DARK;
            bitmap.drawText(getText('Score') + ': ' + this.score, 4, boardH, 150, 18, 'left');

            if (this.gameOver) {
                bitmap.fontSize = 16;
                bitmap.fontBold = true;
                bitmap.drawText(getText('GAME OVER'), 0, 55, 250, 20, 'center');
                bitmap.fontBold = false;
                bitmap.fontSize = 10;
                bitmap.drawText(getText('Restart hint'), 0, 80, 250, 16, 'center');
            }
        }
    }

    //---------------------------------------------------------------------------
    // Tetris
    //---------------------------------------------------------------------------

    const TETROMINOES = {
        I: [[0, 1, 2, 3], [1, 5, 9, 13]],
        O: [[1, 2, 5, 6]],
        T: [[1, 4, 5, 6], [1, 5, 6, 9], [4, 5, 6, 9], [1, 4, 5, 9]],
        S: [[1, 2, 4, 5], [1, 5, 6, 10]],
        Z: [[0, 1, 5, 6], [2, 5, 6, 9]],
        J: [[0, 4, 5, 6], [1, 2, 5, 9], [4, 5, 6, 10], [1, 5, 8, 9]],
        L: [[2, 4, 5, 6], [1, 5, 9, 10], [4, 5, 6, 8], [0, 1, 5, 9]]
    };

    class HexphoneTetrisGame {
        constructor() {
            this.reset();
            if (window.MinigameFun) window.MinigameFun.played('Video Gaming'); // i18n-ignore: leisure activity id
        }

        reset() {
            this.cols = 10;
            this.rows = 20;
            this.cell = 8;
            this.grid = Array.from({length: this.rows}, () => new Array(this.cols).fill(0));
            this.score = 0;
            this.lines = 0;
            this.level = 1;
            this.gameOver = false;
            this.dropTimer = 0;
            this.dropSpeed = 45;
            this.current = null;
            this.next = this.randomPiece();
            this.spawn();
        }

        randomPiece() {
            const types = Object.keys(TETROMINOES);
            const type = types[Math.floor(Math.random() * types.length)];
            return {type: type, x: 3, y: -1, rot: 0};
        }

        spawn() {
            this.current = this.next;
            this.next = this.randomPiece();
            if (!this.fits(this.current.x, this.current.y, this.current.rot)) {
                this.gameOver = true;
                playSeSafe('Buzzer1', 60, 100);
                if (window.MinigameFun) window.MinigameFun.lost('Video Gaming'); // i18n-ignore: leisure activity id
            }
        }

        cells(piece, x, y, rot) {
            const shapes = TETROMINOES[piece.type];
            const shape = shapes[rot % shapes.length];
            return shape.map(i => [x + (i % 4), y + Math.floor(i / 4)]);
        }

        fits(x, y, rot) {
            return this.cells(this.current, x, y, rot).every(([cx, cy]) => {
                if (cx < 0 || cx >= this.cols || cy >= this.rows) return false;
                return cy < 0 || this.grid[cy][cx] === 0;
            });
        }

        move(dx) {
            if (!this.gameOver && this.fits(this.current.x + dx, this.current.y, this.current.rot)) {
                this.current.x += dx;
            }
        }

        rotate() {
            if (this.gameOver) return;
            const rot = this.current.rot + 1;
            if (this.fits(this.current.x, this.current.y, rot)) {
                this.current.rot = rot;
            } else if (this.fits(this.current.x - 1, this.current.y, rot)) {
                this.current.x--; this.current.rot = rot;
            } else if (this.fits(this.current.x + 1, this.current.y, rot)) {
                this.current.x++; this.current.rot = rot;
            }
        }

        softDrop() {
            if (this.gameOver) return false;
            if (this.fits(this.current.x, this.current.y + 1, this.current.rot)) {
                this.current.y++;
                return true;
            }
            this.lock();
            return false;
        }

        hardDrop() {
            while (this.softDrop()) {}
        }

        lock() {
            for (const [cx, cy] of this.cells(this.current, this.current.x, this.current.y, this.current.rot)) {
                if (cy >= 0 && cy < this.rows && cx >= 0 && cx < this.cols) {
                    this.grid[cy][cx] = 1;
                }
            }
            this.clearLines();
            this.spawn();
        }

        clearLines() {
            let cleared = 0;
            for (let y = this.rows - 1; y >= 0; y--) {
                if (this.grid[y].every(c => c !== 0)) {
                    this.grid.splice(y, 1);
                    this.grid.unshift(new Array(this.cols).fill(0));
                    cleared++;
                    y++;
                }
            }
            if (cleared > 0) {
                const points = [0, 100, 300, 500, 800];
                this.lines += cleared;
                this.score += points[Math.min(cleared, 4)] * this.level;
                this.level = Math.floor(this.lines / 10) + 1;
                this.dropSpeed = Math.max(8, 45 - this.level * 4);
                playSeSafe('Decision2', 50, 130);
            }
        }

        onKey(value) {
            if (this.gameOver) {
                if (value === '5' || value === 'menu') this.reset();
                return;
            }
            if (value === '4') this.move(-1);
            else if (value === '6') this.move(1);
            else if (value === '2') this.rotate();
            else if (value === '8') this.softDrop();
            else if (value === '5' || value === 'menu') this.hardDrop();
        }

        // Returns true when the visible state changed (needs an LCD redraw):
        // any directional input, a rotate/drop, or a gravity step.
        update(scene) {
            if (this.gameOver) {
                if (Input.isTriggered('ok')) { this.reset(); return true; }
                return false;
            }

            let changed = false;
            if (Input.isRepeated('left')) { this.move(-1); changed = true; }
            if (Input.isRepeated('right')) { this.move(1); changed = true; }
            if (Input.isTriggered('up')) { this.rotate(); changed = true; }
            if (Input.isRepeated('down')) { this.softDrop(); changed = true; }
            if (Input.isTriggered('ok')) { this.hardDrop(); changed = true; }
            if (this.gameOver) return true;

            this.dropTimer++;
            if (this.dropTimer >= this.dropSpeed) {
                this.dropTimer = 0;
                this.softDrop();
                changed = true;
            }
            return changed;
        }

        draw(bitmap) {
            const ox = 8;
            const boardW = this.cols * this.cell;
            const boardH = this.rows * this.cell;

            // Board frame
            const ctx = bitmap.context;
            ctx.strokeStyle = LCD_DARK;
            ctx.lineWidth = 1;
            ctx.strokeRect(ox - 1.5, 3.5, boardW + 3, boardH + 3);

            // Placed blocks
            for (let y = 0; y < this.rows; y++) {
                for (let x = 0; x < this.cols; x++) {
                    if (this.grid[y][x]) {
                        bitmap.fillRect(ox + x * this.cell, 5 + y * this.cell, this.cell - 1, this.cell - 1, LCD_DARK);
                    }
                }
            }

            // Falling piece
            if (this.current && !this.gameOver) {
                for (const [cx, cy] of this.cells(this.current, this.current.x, this.current.y, this.current.rot)) {
                    if (cy >= 0) {
                        bitmap.fillRect(ox + cx * this.cell, 5 + cy * this.cell, this.cell - 1, this.cell - 1, LCD_DARK);
                    }
                }
            }

            // Sidebar
            const sx = ox + boardW + 14;
            bitmap.fontSize = 10;
            bitmap.textColor = LCD_DARK;
            bitmap.drawText(getText('Score'), sx, 8, 140, 14, 'left');
            bitmap.drawText(String(this.score), sx, 20, 140, 14, 'left');
            bitmap.drawText(getText('Lines') + ': ' + this.lines, sx, 40, 140, 14, 'left');
            bitmap.drawText(getText('Level') + ': ' + this.level, sx, 54, 140, 14, 'left');
            bitmap.drawText(getText('Next'), sx, 76, 140, 14, 'left');

            // Next piece preview
            const shapes = TETROMINOES[this.next.type];
            for (const i of shapes[0]) {
                const px = sx + (i % 4) * 7;
                const py = 92 + Math.floor(i / 4) * 7;
                bitmap.fillRect(px, py, 6, 6, LCD_MID);
            }

            if (this.gameOver) {
                bitmap.fontSize = 14;
                bitmap.fontBold = true;
                bitmap.drawText(getText('GAME OVER'), 0, 65, 250, 20, 'center');
                bitmap.fontBold = false;
                bitmap.fontSize = 9;
                bitmap.drawText(getText('Restart hint'), 0, 85, 250, 14, 'center');
            }
        }
    }

    // i18n-ignore-start: registry ids
    window.registerHexphoneGame('Snake', { create: () => new HexphoneSnakeGame() });
    window.registerHexphoneGame('Tetris', { create: () => new HexphoneTetrisGame() });
    // i18n-ignore-end

    //=============================================================================
    // Menu integration
    //=============================================================================

    const Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
    Window_MenuCommand.prototype.addOriginalCommands = function() {
        Window_MenuCommand_addOriginalCommands.call(this);
        const hasRequiredItem = requiredItemIds.some(itemId => {
            const item = $dataItems[itemId];
            return item && $gameParty.hasItem(item);
        });
        this.addCommand(menuText, 'anokiPhone', hasRequiredItem, 187);
    };

    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function() {
        _Scene_Menu_createCommandWindow.call(this);
        this._commandWindow.setHandler('anokiPhone', this.commandAnokiPhone.bind(this));
        // The parchment main menu Tools page triggers the symbol 'hexphone'
        this._commandWindow.setHandler('hexphone', this.commandAnokiPhone.bind(this));
    };

    Scene_Menu.prototype.commandAnokiPhone = function() {
        SceneManager.push(Scene_AnokiPhone);
    };

    //=============================================================================
    // Plugin commands (registered under every historical plugin name)
    //=============================================================================

    function registerCommandAll(commandName, fn) {
        for (const key of commandKeys) {
            PluginManager.registerCommand(key, commandName, fn);
        }
    }

    registerCommandAll("openPhone", () => {
        SceneManager.push(Scene_AnokiPhone);
    });

    // Alias documented in older project notes
    registerCommandAll("openHexphone", () => {
        SceneManager.push(Scene_AnokiPhone);
    });

    registerCommandAll("addCredits", args => {
        const amount = Number(args.amount) || 0;
        $gameSystem.addPhoneCredits(amount);
        notify(T('Hexphone.notify.creditsUp', { amount: goldToEuros(amount) }));
    });

    registerCommandAll("removeCredits", args => {
        const amount = Number(args.amount) || 0;
        $gameSystem.addPhoneCredits(-amount);
        notify(T('Hexphone.notify.creditsDown', { amount: goldToEuros(amount) }));
    });

    registerCommandAll("setCredits", args => {
        $gameSystem.setPhoneCredits(Number(args.amount) || 0);
    });

    registerCommandAll("registerContact", args => {
        const contactName = args.contactName;
        if ($gameSystem.registerContact(contactName)) {
            notify(contactName + T('Hexphone.notify.added'));
        } else {
            notify(T('Hexphone.notify.contactPrefix') + contactName + T('Hexphone.notify.notFound'));
        }
    });

    registerCommandAll("addContact", args => {
        if ($gameSystem.addCustomContact(args.name, args.number, args.commonEventId)) {
            notify(args.name + T('Hexphone.notify.added'));
        }
    });

    registerCommandAll("removeContact", args => {
        const contactName = args.contactName;
        if ($gameSystem.removeContact(contactName)) {
            notify(contactName + T('Hexphone.notify.removed'));
        }
    });

    registerCommandAll("receiveMessage", args => {
        $gameSystem.addMessage(args.sender, args.content, 'received');
        notify(T('Hexphone.notify.newMessage') + args.sender + '!');
        playSeSafe('Bell1', 90, 120);
    });

    registerCommandAll("sendMessage", args => {
        if ($gameSystem.consumeCredits(messageCost)) {
            $gameSystem.addMessage(args.recipient, args.content, 'sent');
            notify(T('Hexphone.notify.messageSent') + args.recipient);
        } else {
            notify(T('Hexphone.notify.noCredits'));
            playSeSafe('Buzzer1', 70, 100);
        }
    });

    registerCommandAll("clearMessages", () => {
        $gameSystem.clearPhoneMessages();
    });

    registerCommandAll("receiveCall", args => {
        const contactName = args.contactName;
        const contact = $gameSystem.getContacts()[contactName] || availableContacts[contactName];
        if (!contact) {
            console.warn('HexphoneSystem: receiveCall for unknown contact', contactName);
            return;
        }
        pendingIncomingCall = Object.assign({}, contact);
        if (SceneManager._scene instanceof Scene_AnokiPhone) {
            const scene = SceneManager._scene;
            scene._incomingContact = pendingIncomingCall;
            pendingIncomingCall = null;
            scene._screenMode = 'incoming';
            scene.playRingtone();
            scene.refreshScreen();
        } else {
            SceneManager.push(Scene_AnokiPhone);
        }
    });

    registerCommandAll("addGame", args => {
        addPhoneGame(args.name, args.commonEventId);
    });

    //=============================================================================
    // Canvas roundRect polyfill (older NW.js)
    //=============================================================================

    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function(x, y, width, height, radius) {
            if (width < 2 * radius) radius = width / 2;
            if (height < 2 * radius) radius = height / 2;
            this.beginPath();
            this.moveTo(x + radius, y);
            this.arcTo(x + width, y, x + width, y + height, radius);
            this.arcTo(x + width, y + height, x, y + height, radius);
            this.arcTo(x, y + height, x, y, radius);
            this.arcTo(x, y, x + width, y, radius);
            this.closePath();
        };
    }

})();
