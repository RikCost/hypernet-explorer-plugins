/*:
 * @target MZ
 * @plugindesc Rent System v1.1.0
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help RentSystem.js
 *
 * @command rent
 * @text Rent Location
 * @desc Rent a location for 24 hours
 * @arg price
 * @text Price
 * @desc Price in gold to rent the location
 * @type number
 * @default 1000
 *
 * @command showRoomList
 * @text Show Room List
 * @desc Display all rentable rooms (events named "Room") on the current map with prices and remaining time. Player can remotely rent rooms.
 *
 * This plugin allows players to rent locations for 24 hours using real time.
 *
 * Setting Up Rooms:
 * - Create events named exactly "Room" (case-insensitive)
 * - Optionally set price in event note: <price:2000> (default: 1000 gold)
 * - When rented, self switch A will be turned ON for that event
 * When the rent command is called, it will show a confirmation window.
 * If accepted, self switch A will be turned ON for 24 hours.
 * * Price conversion: 1000 gold = 10€
 * * The switch will only change on map transfers, not when loading saves
 * to prevent players from getting stuck in rented areas.
 * * Directional Access:
 * Add one of these letters in event notes to enable free access from that direction:
 * - N: Access from North (player approaches from below)
 * - S: Access from South (player approaches from above)  
 * - W: Access from West (player approaches from right)
 * - E: Access from East (player approaches from left)
 * * Plugin Commands:
 * - Rent: Shows rent confirmation and processes payment
 * - Show Room List: Displays all available rooms on the current map with prices, names, and remaining rental time.
 *   Player can remotely rent or view details for each room.
 */

(() => {
    'use strict';

    // Plugin name for data storage
    const PLUGIN_NAME = 'RentSystem';

    // Gate verbose rental logs so they don't spam the console every tick.
    const DEBUG = false;
    const debugLog = (...args) => { if (DEBUG) console.log(...args); };

    //=============================================================================
    // i18n
    //=============================================================================
    let _rentI18n = null;

    const _loadRentI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/rent.json`;
        try {
            const response = await fetch(url);
            _rentI18n = await response.json();
        } catch (e) {
            console.error('RentSystem: Failed to load i18n data from ' + url, e);
        }
    };

    // Resolve a key under rent.* (e.g. 'rented', 'cancel')
    function _ri18n(key) {
        if (_rentI18n && _rentI18n.rent && typeof _rentI18n.rent[key] === 'string') {
            return _rentI18n.rent[key];
        }
        console.warn(`RentSystem: Missing i18n key: ${key}`);
        return key;
    }

    // Load on boot
    _loadRentI18n();

    // Initialize rental system
    function initializeRentals() {
        if (!$dataSystem.rentals) {
            $dataSystem.rentals = {};
        }
    }

    // Function to get player's approach direction to an event
    function getApproachDirection(eventX, eventY) {
        const playerX = $gamePlayer.x;
        const playerY = $gamePlayer.y;

        const dx = eventX - playerX;
        const dy = eventY - playerY;

        // Determine which direction has the larger difference
        if (Math.abs(dx) > Math.abs(dy)) {
            return dx > 0 ? 'W' : 'E'; // Player is West or East of event
        } else {
            return dy > 0 ? 'N' : 'S'; // Player is North or South of event
        }
    }

    // Function to check if event allows free access from current direction
    function checkDirectionalAccess(eventId) {
        const event = $dataMap.events[eventId];
        if (!event || !event.note) return false;

        const eventX = event.x;
        const eventY = event.y;
        const playerX = $gamePlayer.x;
        const playerY = $gamePlayer.y;

        // Check if player is on the same tile as the event or adjacent
        const dx = eventX - playerX;
        const dy = eventY - playerY;
        const distance = Math.abs(dx) + Math.abs(dy);

        if (distance > 1) {
            debugLog(`Event ${eventId}: Player too far from event (distance: ${distance})`);
            return false;
        }

        const approachDirection = getApproachDirection(eventX, eventY);

        // Check if the event note contains the approach direction letter
        const hasDirectionalAccess = event.note.toUpperCase().includes(approachDirection);

        debugLog(`Event ${eventId}: Player at (${playerX},${playerY}), Event at (${eventX},${eventY})`);
        debugLog(`Approach direction: ${approachDirection}, Note: "${event.note}", Access granted: ${hasDirectionalAccess}`);

        return hasDirectionalAccess;
    }

    //=============================================================================
    // Room List Overlay, HTML parchment panel overlaid on Scene_Map
    //=============================================================================

    Scene_Map.prototype.showRoomListOverlay = function () {
        if (this._roomListEl) return;
        const rooms = getRoomsOnCurrentMap();
        if (!rooms.length) return;

        this._roomListRooms = rooms;
        this._roomListIdx   = 0;

        const el = document.createElement('div');
        el.id        = 'rent-room-list';
        el.className = 'html-parchment-overlay';
        document.body.appendChild(el);
        this._roomListEl = el;

        // Delegation listeners persist across innerHTML rebuilds
        el.addEventListener('mouseover', ev => {
            const row = ev.target.closest('.rent-room-entry');
            if (!row) return;
            const idx = parseInt(row.dataset.idx, 10);
            if (!isNaN(idx) && idx !== this._roomListIdx) {
                this._roomListIdx = idx;
                this._updateRoomListHighlight();
                this.panMapToRoomEvent(idx);
            }
        });
        el.addEventListener('click', ev => {
            const row = ev.target.closest('.rent-room-entry');
            if (!row) return;
            this._roomListIdx = parseInt(row.dataset.idx, 10);
            this.onRoomListOverlayOk();
        });

        this._buildRoomListHTML();
        this._createRoomArrow();
        this.panMapToRoomEvent(0);
    };

    Scene_Map.prototype._buildRoomListHTML = function () {
        if (!this._roomListEl) return;
        const rooms = this._roomListRooms || [];
        const rows = rooms.map((room, i) => {
            const sel = i === this._roomListIdx ? ' selected' : '';
            let statusHTML;
            if (room.isRented) {
                const t = getTimeRemaining(room.expirationTime);
                statusHTML = `<span class="rent-status rent-rented">${_ri18n('rented')} · ${t}</span>`;
            } else {
                statusHTML = `<span class="rent-status rent-available">€${(room.price / 100).toFixed(2)}</span>`;
            }
            return `<div class="item-slot rent-room-entry${sel}" data-idx="${i}">
                <span class="rent-room-label">Room ${i + 1}</span>
                ${statusHTML}
            </div>`;
        }).join('');
        this._roomListEl.innerHTML = `
            <div class="inspect-section-title rent-list-title">${T('Rent.ui.rooms')}</div>
            ${rows}
            <p class="rent-hint">${T('Rent.ui.hint')}</p>`;
        // Cache the status spans so the per-second tick can update just the
        // countdown text instead of rebuilding the whole list innerHTML.
        this._roomStatusEls = Array.prototype.map.call(
            this._roomListEl.querySelectorAll('.rent-room-entry'),
            row => row.querySelector('.rent-status')
        );
    };

    // Lightweight per-second refresh: update only the countdown text of rented
    // rooms, keeping element refs from the last full build.
    Scene_Map.prototype._refreshRoomListCountdowns = function () {
        const rooms = this._roomListRooms || [];
        const els = this._roomStatusEls || [];
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            const el = els[i];
            if (!room || !el || !room.isRented) continue;
            const t = getTimeRemaining(room.expirationTime);
            el.textContent = `${_ri18n('rented')} · ${t}`;
        }
    };

    Scene_Map.prototype._updateRoomListHighlight = function () {
        if (!this._roomListEl) return;
        this._roomListEl.querySelectorAll('.rent-room-entry').forEach((el, i) => {
            el.classList.toggle('selected', i === this._roomListIdx);
        });
    };

    Scene_Map.prototype._createRoomArrow = function () {
        if (this._roomArrowSprite) return;
        const aw = 32, ah = 22;
        const bitmap = new Bitmap(aw, ah);
        const ctx = bitmap.context;
        ctx.fillStyle   = '#ffff66';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.moveTo(aw / 2, ah - 1);
        ctx.lineTo(1, 1);
        ctx.lineTo(aw - 1, 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        bitmap._baseTexture.update();
        const sprite = new Sprite(bitmap);
        sprite.anchor.set(0.5, 1.0);
        this._roomArrowSprite = sprite;
        this._roomArrowTick   = 0;
        const idx = this.children.indexOf(this._windowLayer);
        this.addChildAt(sprite, idx >= 0 ? idx : this.children.length);
    };

    Scene_Map.prototype.panMapToRoomEvent = function (index) {
        const rooms = this._roomListRooms || getRoomsOnCurrentMap();
        const room  = rooms[index];
        if (!room) return;
        const event = $dataMap.events[room.eventId];
        if (!event) return;
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        $gameMap.setDisplayPos(event.x - (Graphics.boxWidth  / tw - 1) / 2,
                               event.y - (Graphics.boxHeight / th - 1) / 2);
        if (this._spriteset && this._spriteset.revealCircularArea) {
            this._spriteset.revealCircularArea(event.x, event.y, 6);
        }
    };

    Scene_Map.prototype.onRoomListOverlayOk = function () {
        const rooms = this._roomListRooms || [];
        const room  = rooms[this._roomListIdx];
        if (!room) return;
        if (room.isRented) {
            window.skipLocalization = true;
            $gameSystem._rentHideBust = true;
            $gameMessage.add(_ri18n('already_rented'));
            window.skipLocalization = false;
            return;
        }
        if ($gameParty.gold() >= room.price) {
            $gameParty.loseGold(room.price);
            processRental(`${room.mapId}_${room.eventId}`, room.mapId, room.eventId);
            SoundManager.playShop();
            window.skipLocalization = true;
            $gameSystem._rentHideBust = true;
            $gameMessage.add(_ri18n('rented_for_24h'));
            window.skipLocalization = false;
            this.closeRoomListOverlay();
        } else {
            window.skipLocalization = true;
            $gameSystem._rentHideBust = true;
            $gameMessage.add(_ri18n('not_enough_gold'));
            window.skipLocalization = false;
        }
    };

    Scene_Map.prototype.closeRoomListOverlay = function () {
        if (this._roomListEl) {
            this._roomListEl.remove();
            this._roomListEl = null;
        }
        if (this._roomArrowSprite) {
            this._roomArrowSprite.parent.removeChild(this._roomArrowSprite);
            this._roomArrowSprite.destroy();
            this._roomArrowSprite = null;
        }
        $gameSystem._roomListClosed = true;
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        $gameMap.setDisplayPos($gamePlayer.x - (Graphics.boxWidth  / tw - 1) / 2,
                               $gamePlayer.y - (Graphics.boxHeight / th - 1) / 2);
        const scene = SceneManager._scene;
        if (scene && scene._bustManager) scene._bustManager.hideBusts();
    };

    // Interpreter wait mode so the event pauses while the overlay is open
    //=============================================================================

    const _Game_Interpreter_updateWaitMode_rent = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function () {
        if (this._waitMode === 'roomList') {
            if ($gameSystem._roomListClosed) {
                $gameSystem._roomListClosed = false;
                this._waitMode = '';
                return false;
            }
            return true;
        }
        return _Game_Interpreter_updateWaitMode_rent.call(this);
    };

    // Register plugin command
    PluginManager.registerCommand(PLUGIN_NAME, "rent", args => {

        const price = parseInt(args.price) || 1000;

        // Get current event ID more reliably
        const interpreter = $gameMap._interpreter;
        const eventId = interpreter._eventId || interpreter.eventId();
        const mapId = $gameMap.mapId();

        if (!eventId) {
            window.skipLocalization = true;
            $gameSystem._rentHideBust = true;
            $gameMessage.add(_ri18n('error_event_id'));
            window.skipLocalization = false;

            return;
        }

        // Reveal fog of war around this room
        const _rentEvent = $dataMap.events[eventId];
        if (_rentEvent) {
            const scene = SceneManager._scene;
            if (scene && scene._spriteset && scene._spriteset.revealCircularArea) {
                scene._spriteset.revealCircularArea(_rentEvent.x, _rentEvent.y, 6);
            }
        }

        // Check for directional access first
        if (checkDirectionalAccess(eventId)) {
            // Free access granted based on direction
            const eventName = $dataMap.events[eventId]?.name || 'Location';  // i18n-ignore  event-name read, matched not shown
            processDirectionalAccess(mapId, eventId);
            window.skipLocalization = true;
            $gameSystem._rentHideBust = true;
            $gameMessage.add(`${_ri18n('free_access_granted')} ${eventName}!`);
            window.skipLocalization = false;

            return;
        }

        const eventKey = mapId + '_' + eventId;
        const eventName = $dataMap.events[eventId]?.name || 'Location';  // i18n-ignore  event-name read, matched not shown

        // Convert gold to euros (1000 gold = 10€)
        const priceInEuros = (price / 100).toFixed(2);

        showRentConfirmation(eventName, price, priceInEuros, eventKey, mapId, eventId);
    });

    // Register plugin command for showing room list
    PluginManager.registerCommand(PLUGIN_NAME, "showRoomList", args => {
        const rooms = getRoomsOnCurrentMap();
        if (rooms.length === 0) {
            $gameMessage.add(T('Rent.noRooms'));
            return;
        }

        $gameSystem._roomListClosed = false;
        const scene = SceneManager._scene;
        if (scene && scene.showRoomListOverlay) {
            scene.showRoomListOverlay();
        }
        const interpreter = $gameMap._interpreter;
        if (interpreter) {
            interpreter.setWaitMode('roomList');
        }
    });

    // Function to process directional access (free access)
    function processDirectionalAccess(mapId, eventId) {
        // Turn on self switch A for the current event
        const key = [mapId, eventId, 'A'];
        $gameSelfSwitches.setValue(key, true);

        // Force refresh of the current event
        $gameMap.requestRefresh();

        debugLog(`Directional access granted: Event ${eventId} on Map ${mapId}, Switch key:`, key);
        debugLog('Self switch set to:', $gameSelfSwitches.value(key));
    }

    // Function to process already rented access (restore access without resetting timer)
    function processAlreadyRentedAccess(mapId, eventId) {
        // Turn on self switch A for the current event
        const key = [mapId, eventId, 'A'];
        $gameSelfSwitches.setValue(key, true);

        // Force refresh of the current event
        $gameMap.requestRefresh();

        debugLog(`Already rented access restored: Event ${eventId} on Map ${mapId}, Switch key:`, key);
        debugLog('Self switch set to:', $gameSelfSwitches.value(key));
    }

    // Function to show rent confirmation window
    function showRentConfirmation(eventName, price, priceInEuros, eventKey, mapId, eventId, hasDirectionalAccess, isAlreadyRented) {
        const message = `${_ri18n('rent_question')} ${eventName}?`;
        let option1Text;

        if (hasDirectionalAccess) {
            option1Text = _ri18n('free_access');
        } else if (isAlreadyRented) {
            option1Text = _ri18n('already_rented');
        } else {
            option1Text = `€${priceInEuros} ${_ri18n('for_24h_rent')}`;
        }
        window.skipLocalization = true;
        $gameSystem._rentHideBust = true;
        $gameMessage.add(message);
        window.skipLocalization = false;

        $gameMessage.setChoices([option1Text, _ri18n('cancel')], 0, 1);
        $gameMessage.setChoiceCallback(n => {
            if (n === 0) { // First option selected
                window.skipLocalization = true;

                if (hasDirectionalAccess) {
                    // Free access granted based on direction
                    processDirectionalAccess(mapId, eventId);
                } else if (isAlreadyRented) {
                    // Restore access without resetting timer
                    processAlreadyRentedAccess(mapId, eventId);
                } else {
                    // Normal rental process
                    if ($gameParty.gold() >= price) {
                        $gameParty.loseGold(price);
                        processRental(eventKey, mapId, eventId);
                        SoundManager.playShop();

                    } else {
                        window.skipLocalization = true;
                        $gameSystem._rentHideBust = true;
                        $gameMessage.add(_ri18n('not_enough_gold'));
                        window.skipLocalization = false;

                    }
                }

            }
            // If n === 1 (Cancel), do nothing - choice window will close automatically
        });

    }

    // Function to process the rental
    function processRental(eventKey, mapId, eventId) {
        initializeRentals(); // Ensure rentals object exists

        const currentTime = Date.now();
        const expirationTime = currentTime + (24 * 60 * 60 * 1000); // 24 hours in milliseconds
        // Expiry must use the SAME clock as the displayed countdown: game time
        // (var 114) over 1440 game-minutes. Real time (Date.now) and game time
        // run at different rates, so the two disagreed before.
        const currentGameMinutes = $gameVariables.value(114) || 0;
        const expirationGameMinutes = currentGameMinutes + (24 * 60);

        // Store rental information
        $dataSystem.rentals[eventKey] = {
            mapId: mapId,
            eventId: eventId,
            startTime: currentTime,
            expirationTime: expirationTime,
            expirationGameMinutes: expirationGameMinutes,
            active: true
        };

        // Store game time when rental started (for TimeDateSystem compatibility)
        storeRentalStartTime(expirationTime);

        // Turn on self switch A for the current event
        const key = [mapId, eventId, 'A'];
        $gameSelfSwitches.setValue(key, true);

        // Force refresh of the current event
        $gameMap.requestRefresh();

        debugLog(`Rental processed: Event ${eventId} on Map ${mapId}, Switch key:`, key);
        debugLog('Self switch set to:', $gameSelfSwitches.value(key));
    }

    // Function to check and update rental status
    function updateRentalStatus() {
        initializeRentals(); // Ensure rentals object exists

        const currentTime = Date.now();
        const currentGameMinutes = $gameVariables.value(114) || 0;
        let anyExpired = false;

        for (const eventKey in $dataSystem.rentals) {
            const rental = $dataSystem.rentals[eventKey];

            // Use game time when available (matches the displayed countdown);
            // fall back to real time for legacy saves without the game-minute stamp.
            const expired = (rental.expirationGameMinutes != null)
                ? currentGameMinutes >= rental.expirationGameMinutes
                : currentTime >= rental.expirationTime;

            if (rental.active && expired) {
                // Rental has expired
                rental.active = false;

                // Turn off self switch A
                const key = [rental.mapId, rental.eventId, 'A'];
                $gameSelfSwitches.setValue(key, false);
                anyExpired = true;

                debugLog(`Rental expired: Event ${rental.eventId} on Map ${rental.mapId}`);
            }
        }

        // Force refresh current map only when a rental actually expired.
        if (anyExpired) $gameMap.requestRefresh();
    }

    // Initialize rentals when creating new game objects
    const _DataManager_createGameObjects = DataManager.createGameObjects;
    DataManager.createGameObjects = function () {
        _DataManager_createGameObjects.call(this);
        initializeRentals();
    };

    // Initialize rentals when loading database
    const _DataManager_onLoad = DataManager.onLoad;
    DataManager.onLoad = function (object) {
        _DataManager_onLoad.call(this, object);
        if (object === $dataSystem) {
            initializeRentals();
        }
    };

    // Override DataManager.makeSaveContents to save rental data
    const _DataManager_makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function () {
        const contents = _DataManager_makeSaveContents.call(this);
        initializeRentals();
        contents.rentals = $dataSystem.rentals;
        contents.rentalStartTimes = $dataSystem.rentalStartTimes || {};
        return contents;
    };

    // Override DataManager.extractSaveContents to load rental data
    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        $dataSystem.rentals = contents.rentals || {};
        $dataSystem.rentalStartTimes = contents.rentalStartTimes || {};
        // Don't update rental status here to prevent players getting stuck
    };

    // Clean up expired rentals periodically; keyboard nav + timer refresh for room list HTML
    const _Scene_Map_update_rent = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update_rent.call(this);

        if (Graphics.frameCount % 3600 === 0) cleanupExpiredRentals();

        if (this._roomListEl) {
            // Refresh only the countdown text every second (rooms were scanned
            // once when the overlay opened; no full innerHTML rebuild here).
            if (Graphics.frameCount % 60 === 0) {
                this._refreshRoomListCountdowns();
            }
            // Keyboard / gamepad navigation
            const len = (this._roomListRooms || []).length;
            if (Input.isRepeated('down') || Input.isRepeated('s')) {
                if (this._roomListIdx < len - 1) {
                    this._roomListIdx++;
                    this._updateRoomListHighlight();
                    this.panMapToRoomEvent(this._roomListIdx);
                    SoundManager.playCursor();
                }
            }
            if (Input.isRepeated('up') || Input.isRepeated('w')) {
                if (this._roomListIdx > 0) {
                    this._roomListIdx--;
                    this._updateRoomListHighlight();
                    this.panMapToRoomEvent(this._roomListIdx);
                    SoundManager.playCursor();
                }
            }
            if (Input.isTriggered('ok'))     { SoundManager.playOk();     this.onRoomListOverlayOk();   }
            if (Input.isTriggered('cancel')) { SoundManager.playCancel(); this.closeRoomListOverlay(); }
        }

        // Bouncing arrow above selected room event
        if (this._roomArrowSprite && this._roomListEl) {
            this._roomArrowTick = (this._roomArrowTick || 0) + 1;
            const rooms = this._roomListRooms || [];
            const room  = rooms[this._roomListIdx];
            if (room) {
                const event = $dataMap.events[room.eventId];
                if (event) {
                    const tw = $gameMap.tileWidth();
                    const th = $gameMap.tileHeight();
                    this._roomArrowSprite.x = Math.round(($gameMap.adjustX(event.x) + 0.5) * tw);
                    this._roomArrowSprite.y = Math.round($gameMap.adjustY(event.y) * th
                        - th * 0.1 + Math.sin(this._roomArrowTick * 0.12) * 7);
                }
            }
        }
    };

    // Function to clean up expired rental data
    function cleanupExpiredRentals() {
        initializeRentals();
        const currentTime = Date.now();

        for (const eventKey in $dataSystem.rentals) {
            const rental = $dataSystem.rentals[eventKey];

            // Remove rental data that's been expired for more than 24 hours
            if (!rental.active && currentTime >= (rental.expirationTime + 24 * 60 * 60 * 1000)) {
                delete $dataSystem.rentals[eventKey];
            }
        }
    }

    // Function to get time remaining for a rental in human-readable format
    // Uses TimeDateSystem's game time variable (114) for consistency
    function getTimeRemaining(expirationTime) {
        const gameTimeVariableId = 114; // Variable 114 = game time in TimeDateSystem
        const currentGameMinutes = $gameVariables.value(gameTimeVariableId) || 0;
        const startGameMinutes = getGameStartMinutesForRental(expirationTime);

        // Calculate remaining rental minutes (24 hours = 1440 minutes)
        const rentalDurationMinutes = 24 * 60;
        const elapsedMinutes = currentGameMinutes - startGameMinutes;
        const remainingMinutes = rentalDurationMinutes - elapsedMinutes;

        if (remainingMinutes <= 0) {
            return _ri18n('expired');
        }

        const remainingHours = Math.floor(remainingMinutes / 60);
        const mins = remainingMinutes % 60;

        if (remainingHours > 0) {
            return `${remainingHours}h ${mins}m`;
        }
        return `${mins}m`;
    }

    // Store rental start times in real-time to calculate game time elapsed
    function getGameStartMinutesForRental(expirationTime) {
        if (!$dataSystem.rentalStartTimes) {
            $dataSystem.rentalStartTimes = {};
        }

        const key = `rental_${expirationTime}`;
        return $dataSystem.rentalStartTimes[key] || 0;
    }

    // Store game time when rental starts
    function storeRentalStartTime(expirationTime) {
        if (!$dataSystem.rentalStartTimes) {
            $dataSystem.rentalStartTimes = {};
        }

        const gameTimeVariableId = 114;
        const currentGameMinutes = $gameVariables.value(gameTimeVariableId) || 0;
        const key = `rental_${expirationTime}`;
        $dataSystem.rentalStartTimes[key] = currentGameMinutes;
    }

    // Function to get all rooms (events named "Room") on current map
    function getRoomsOnCurrentMap() {
        const mapId = $gameMap.mapId();
        const rooms = [];

        if (!$dataMap || !$dataMap.events) {
            return rooms;
        }

        for (let eventId = 1; eventId < $dataMap.events.length; eventId++) {
            const event = $dataMap.events[eventId];
            if (!event) continue;

            const eventName = event.name || '';

            // Only include events named "Room"
            if (eventName.toLowerCase() === 'room') {
                // Try to extract price from event note or use default
                let price = 1000; // Default price
                if (event.note) {
                    const priceMatch = event.note.match(/<price[:\s]*(\d+)>/i);
                    if (priceMatch) {
                        price = parseInt(priceMatch[1]);
                    }
                }

                const eventKey = mapId + '_' + eventId;
                const rental = $dataSystem.rentals[eventKey];
                const isRented = rental && rental.active;

                rooms.push({
                    eventId: eventId,
                    mapId: mapId,
                    name: eventName,
                    price: price,
                    isRented: isRented,
                    expirationTime: isRented ? rental.expirationTime : null
                });
            }
        }

        debugLog(`Found ${rooms.length} Room events on map ${mapId}`);
        return rooms;
    }

    // (kept for potential external calls)
    function showRoomListWindow() {
        const rooms = getRoomsOnCurrentMap();
        if (rooms.length === 0) {
            $gameMessage.add(T('Rent.noRooms'));
            return;
        }
        $gameSystem._roomListClosed = false;
        const scene = SceneManager._scene;
        if (scene && scene.showRoomListOverlay) {
            scene.showRoomListOverlay();
        }
        const interpreter = $gameMap._interpreter;
        if (interpreter) {
            interpreter.setWaitMode('roomList');
        }
    }

    // Debug commands
    window.checkRentals = function () {
        initializeRentals();
        console.log('Current rentals:', $dataSystem.rentals);
        console.log('All self switches:', $gameSelfSwitches._data);
        updateRentalStatus();
    };

    window.testSwitch = function (mapId, eventId) {
        const key = [mapId, eventId, 'A'];
        console.log(`Switch [${mapId}, ${eventId}, A]:`, $gameSelfSwitches.value(key));
        $gameSelfSwitches.setValue(key, true);
        $gameMap.requestRefresh();
        console.log('Switch set to true and map refreshed');
    };

    // Debug function to test directional access
    window.testDirectionalAccess = function (eventId) {
        console.log('Testing directional access for event:', eventId);
        const hasAccess = checkDirectionalAccess(eventId);
        console.log('Has directional access:', hasAccess);
    };

    // Hide bust after any message flagged by the rent system
    const _RentSystem_terminateMessage = Window_Message.prototype.terminateMessage;
    Window_Message.prototype.terminateMessage = function () {
        _RentSystem_terminateMessage.call(this);
        if ($gameSystem._rentHideBust) {
            $gameSystem._rentHideBust = false;
            const scene = SceneManager._scene;
            if (scene && scene._bustManager) scene._bustManager.hideBusts();
        }
    };

})();
