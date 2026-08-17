//=============================================================================
// Party HUD
// Version: 2.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Party HUD v2.0.0
 * @author Omni-Lex
 * @version 2.0.0
 * @description Top-left HTML map HUD: HP/MP, active states and urgent needs per party member
 *
 * @param hudX
 * @text HUD X
 * @desc Distance from the left edge of the screen, in pixels.
 * @type number
 * @min 0
 * @max 400
 * @default 12
 *
 * @param hudY
 * @text HUD Y
 * @desc Distance from the top edge of the screen, in pixels.
 * @type number
 * @min 0
 * @max 400
 * @default 40
 *
 * @param panelWidth
 * @text Panel Width
 * @desc Width of a member card, in pixels.
 * @type number
 * @min 120
 * @max 480
 * @default 224
 *
 * @param maxMembers
 * @text Max Members
 * @desc How many party members the HUD shows at most.
 * @type number
 * @min 1
 * @max 8
 * @default 4
 *
 * @param maxStates
 * @text Max State Labels
 * @desc How many state/buff labels are shown per member.
 * @type number
 * @min 0
 * @max 12
 * @default 6
 *
 * @param hideDuringMessages
 * @text Hide During Messages
 * @desc Fade the HUD out while a message or choice is on screen.
 * @type boolean
 * @default true
 *
 * @help PartyHud.js
 *
 * Draws the party HUD in the top-left corner of the map as HTML (#party-hud,
 * styled in css/game.css) rather than as a canvas window: one row per party
 * member, the bordered card carrying their name and their HP and MP bars, and
 * a column of chips standing to the right of that card, outside the box.
 *
 * The chips read as one list: first the urgent needs, then every state and
 * buff on the member, all spelled out as words rather than drawn as icons, so
 * nothing on the HUD has to be recognised from a 20px picture.
 *
 * A chip appears whenever something needs seeing to: low health, hunger,
 * sleep, hygiene, social or fun below the warning line (and a second, louder
 * colour below the critical one), plus a craving an addicted member is about
 * to go into withdrawal over. The needs come from window.PartyNeeds, the
 * cravings from window.AddictionSystem, so the HUD reads the same meters the
 * menu and the status screen do.
 *
 * While the party is aboard a vehicle — at the wheel, or on foot inside its
 * cabin — that vehicle stands above the crew as a row of its own, carrying its
 * name, its condition as an HP bar (every maintenance part added up) and its
 * fuel where a member's magic would be, in purple. The row comes down again
 * the moment they get out. See MergedVehicleSystem.getHudVehicleStatus().
 *
 * The HUD is ON by default and is switched off from Options -> Video
 * ("Party HUD") or on the first step of character creation. The setting is
 * stored in ConfigManager.partyHud.
 *
 * It fades out on its own while the map name window is showing and (by
 * parameter) while a message is on screen, so it never sits on top of them.
 *
 * There is no AP/TP bar: the card carries HP and MP only.
 */

(() => {
  // A severed-magic world has no magic in it, so there is nothing to spend a
  // magic meter on: the MP row is not drawn at all. See window.MagicNature.
  function hideMpBar() {
    const MN = window.MagicNature;
    return !!(MN && typeof MN.level === "function" && MN.level() === "severed");
  }

    'use strict';

    const pluginName = 'PartyHud';
    const parameters = PluginManager.parameters(pluginName);

    const HUD_X = Number(parameters['hudX'] || 12);
    // The FPS / frame-time counter sits in the same top-left corner, so the
    // first card starts below it rather than underneath it.
    const HUD_Y = Number(parameters['hudY'] || 40);
    const PANEL_W = Number(parameters['panelWidth'] || 224);
    const MAX_MEMBERS = Number(parameters['maxMembers'] || 4);
    const MAX_STATES = Number(parameters['maxStates'] || 6);
    const HIDE_ON_MESSAGE = parameters['hideDuringMessages'] !== 'false';

    const MAX_ALERTS = 3;           // urgent-need chips per member
    const NEED_REFRESH_FRAMES = 30; // needs move slowly; don't read them per frame
    const FLASH_MS = 420;           // damage / healing wash on the HP bar

    // Where a meter stops being comfortable and where it becomes an emergency.
    // Health, food and rest are what a walk can end on, so they speak up early;
    // hygiene, company and fun only once they are genuinely neglected, or the
    // cards would carry three chips at all times and say nothing.
    const WARN_PCT = 30;
    const CRIT_PCT = 15;
    const NEED_WARN = { hunger: 30, sleep: 30, hygiene: 20, social: 20, leisure: 20 };
    const NEED_CRIT = { hunger: 15, sleep: 15, hygiene: 8, social: 8, leisure: 8 };
    // A craving is worth a chip once it is close to the withdrawal state, which
    // AddictionSystem hands out at 100 and only clears again under 80.
    const CRAVING_WARN = 80;
    const CRAVING_CRIT = 95;

    //=========================================================================
    // ConfigManager
    //=========================================================================
    // On by default: the party's health is the one thing a map screen should
    // never make the player open a menu for.
    ConfigManager.partyHud = true;

    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _ConfigManager_makeData.call(this);
        config.partyHud = this.partyHud;
        config.partyHudDefaulted = true;
        return config;
    };

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _ConfigManager_applyData.call(this, config);
        // The HUD used to ship off, so every config written before this carries
        // partyHud:false, which is a default rather than a choice. It is turned
        // on once, and the marker below records that it has been.
        if (!config.partyHudDefaulted) {
            this.partyHud = true;
            return;
        }
        this.partyHud = this.readFlag(config, 'partyHud', true);
    };

    if (window.GameOptions && typeof window.GameOptions.registerOption === 'function') {
        // The label is registered as a function so it re-resolves whenever the
        // options list is rebuilt, which is how it follows a language change.
        window.GameOptions.registerOption('partyHud', () => T('PartyHud.optionName'),
            () => ConfigManager.partyHud,
            (value) => {
                ConfigManager.partyHud = value;
                ConfigManager.save();
            },
            'video', 'boolean');
    }

    //=========================================================================
    // Urgent needs
    //=========================================================================
    // Every meter the HUD is prepared to complain about. Each key names its own
    // wording under PartyHud.alert, in two registers: `<key>` for the warning
    // and `<key>Critical` for the emergency, so a member reads "Hungry 26%"
    // first and "Starving 9%" later.
    const NEED_KEYS = ['hunger', 'sleep', 'hygiene', 'social', 'leisure'];

    const alertText = (key, critical, pct) => {
        const label = T('PartyHud.alert.' + key + (critical ? 'Critical' : ''));
        return label + ' ' + Math.max(0, Math.round(pct)) + '%';
    };

    // The chips one member has earned, worst first, capped at MAX_ALERTS.
    // Returns [{ key, text, critical }].
    const urgentAlertsFor = (actor, needs) => {
        const out = [];
        if (!actor) return out;

        if (actor.isDead()) {
            out.push({ key: 'dead', text: T('PartyHud.alert.dead'), critical: true, sort: -1 });
        } else {
            const hpPct = actor.mhp > 0 ? (actor.hp / actor.mhp) * 100 : 100;
            if (hpPct <= WARN_PCT) {
                out.push({ key: 'hp', text: alertText('hp', hpPct <= CRIT_PCT, hpPct), critical: hpPct <= CRIT_PCT, sort: hpPct });
            }
        }

        for (const key of NEED_KEYS) {
            const pct = needs ? needs[key] : null;
            if (pct === null || pct === undefined) continue;
            if (pct > NEED_WARN[key]) continue;
            const critical = pct <= NEED_CRIT[key];
            out.push({ key, text: alertText(key, critical, pct), critical, sort: pct });
        }

        // Being ill is a standing condition, so it keeps a chip for as long as
        // it lasts. A lifelong one is left off: it belongs on the character
        // sheet, not on a chip that would never come down again. An illness
        // still inside its window period shows as an unnamed one, which is
        // exactly what the party knows about it.
        for (const illness of window.DiseaseSystem?.shortLines?.(actor) || []) {
            if (illness.permanent) continue;
            out.push({
                key: 'disease:' + illness.id, // i18n-ignore: chip identity
                text: illness.needsMedicine
                    ? T('PartyHud.alert.illUntreated', { disease: illness.name })
                    : T('PartyHud.alert.ill', { disease: illness.name }),
                critical: illness.critical,
                sort: illness.critical ? -0.5 : 12
            });
        }

        // A craving climbs instead of draining, so it is read the other way up.
        const worst = window.AddictionSystem?.worst?.(actor);
        if (worst && worst.value >= CRAVING_WARN) {
            const label = window.AddictionSystem.label(worst.key);
            out.push({
                key: 'craving',
                text: T('PartyHud.alert.craving', { substance: label }),
                critical: worst.value >= CRAVING_CRIT,
                sort: 100 - worst.value
            });
        }

        out.sort((a, b) => a.sort - b.sort);
        return out.slice(0, MAX_ALERTS);
    };

    //=========================================================================
    // The vehicle the party is aboard
    //=========================================================================
    // Reads whatever the party is riding in or standing inside, or null on
    // foot. The vehicle plugin owns the question of what counts (see
    // MergedVehicleSystem.getHudVehicleStatus); the HUD only draws the answer.
    const vehicleStatus = () => {
        const status = window.MergedVehicleSystem?.getHudVehicleStatus?.();
        return status || null;
    };

    // A card key of its own, so the vehicle's HP never shares the flash /
    // last-value bookkeeping with an actor id.
    const vehicleCardKey = (status) => 'vehicle:' + status.key;

    //=========================================================================
    // States and buffs
    //=========================================================================
    // States are named on the card in words, not drawn as icons. A state with
    // no icon is database plumbing the party is not meant to read, and the
    // death state already has its own "Down" chip, so both are left out.
    // Buffs have no name of their own, so they are written as the parameter
    // they move with an arrow for the direction: "ATK ▲", "DEF ▼▼".
    const dbName = (name) =>
        (typeof window.translateText === 'function' ? window.translateText(name) : name) || '';

    const stateLabelsFor = (actor) => {
        const out = [];
        if (!actor) return out;
        for (const state of actor.states()) {
            if (!state || state.id === actor.deathStateId()) continue;
            if (!state.iconIndex || !state.name) continue;
            out.push({ key: 'state:' + state.id, text: dbName(state.name) });
        }
        for (let paramId = 0; paramId < 8; paramId++) {
            const level = actor.buff(paramId);
            if (!level) continue;
            const arrow = (level > 0 ? '▲' : '▼').repeat(Math.min(2, Math.abs(level)));
            out.push({
                key: 'buff:' + paramId + ':' + level,
                text: TextManager.param(paramId) + ' ' + arrow,
                debuff: level < 0
            });
        }
        return out.slice(0, MAX_STATES);
    };

    //=========================================================================
    // PartyHudOverlay
    //=========================================================================
    // The cards are built once per party and then written into in place, so a
    // walking party costs a handful of textContent/style writes per refresh and
    // the CSS transitions on the bars are never interrupted by a rebuild.
    function PartyHudOverlay() {
        this._el = null;
        this._cards = new Map();    // actorId -> { root, name, states, hp, mp, alerts, ... }
        this._vehicleCard = null;   // the row above them, while the party is aboard one
        this._vehicleCardKey = '';  // which vehicle that row is drawing
        this._layoutKey = '';
        this._needs = new Map();    // actorId -> needs object
        this._needTimer = NEED_REFRESH_FRAMES;
        this._lastHp = new Map();   // actorId | 'vehicle:<key>' -> last HP seen
        this._visible = false;
        this._create();
    }

    PartyHudOverlay.prototype._create = function () {
        const el = document.createElement('div');
        el.id = 'party-hud';
        el.style.left = HUD_X + 'px';
        el.style.top = HUD_Y + 'px';
        // The card keeps the configured width; the chips sit beside it, outside
        // the box, so the overlay itself is as wide as it needs to be.
        el.style.setProperty('--phud-card-w', PANEL_W + 'px');
        document.body.appendChild(el);
        this._el = el;
    };

    PartyHudOverlay.prototype.destroy = function () {
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
        this._el = null;
        this._cards.clear();
        this._vehicleCard = null;
        this._vehicleCardKey = '';
    };

    PartyHudOverlay.prototype.members = function () {
        if (!$gameParty) return [];
        return $gameParty.members().slice(0, MAX_MEMBERS);
    };

    //-------------------------------------------------------------------------
    // Card construction
    //-------------------------------------------------------------------------
    PartyHudOverlay.prototype._makeBar = function (kind) {
        const bar = document.createElement('div');
        bar.className = 'phud-bar phud-' + kind;
        const fill = document.createElement('div');
        fill.className = 'phud-fill';
        const flash = document.createElement('div');
        flash.className = 'phud-flash';
        const label = document.createElement('span');
        label.className = 'phud-bar-lbl';
        const value = document.createElement('span');
        value.className = 'phud-bar-val';
        bar.appendChild(fill);
        bar.appendChild(flash);
        bar.appendChild(label);
        bar.appendChild(value);
        return { bar, fill, flash, label, value };
    };

    PartyHudOverlay.prototype._makeCard = function () {
        // A member is a row: the bordered card, and the chip column standing to
        // the right of it, outside the box — urgent needs first, then the
        // states and buffs the member is carrying.
        const row = document.createElement('div');
        row.className = 'phud-row';

        const root = document.createElement('div');
        root.className = 'phud-card';

        const head = document.createElement('div');
        head.className = 'phud-head';
        const name = document.createElement('span');
        name.className = 'phud-name';
        head.appendChild(name);

        const hp = this._makeBar('hp');
        const mp = this._makeBar('mp');

        const chips = document.createElement('div');
        chips.className = 'phud-chips';
        const alerts = document.createElement('div');
        alerts.className = 'phud-alerts';
        const states = document.createElement('div');
        states.className = 'phud-states';
        chips.appendChild(alerts);
        chips.appendChild(states);

        root.appendChild(head);
        root.appendChild(hp.bar);
        root.appendChild(mp.bar);

        row.appendChild(root);
        row.appendChild(chips);

        return { row, root, name, states, hp, mp, alerts, statesKey: null, alertsKey: null, deadKey: null };
    };

    // The vehicle's card is a member card with the crew's furniture taken off
    // it: no chips (a car has no needs and no buffs), and the magic bar turned
    // into a fuel gauge, which is what the purple `phud-fuel` colours.
    PartyHudOverlay.prototype._makeVehicleCard = function () {
        const card = this._makeCard();
        card.root.classList.add('phud-vehicle');
        card.mp.bar.classList.add('phud-fuel');
        card.alerts.classList.add('phud-alerts-empty');
        card.states.classList.add('phud-alerts-empty');
        return card;
    };

    // Rebuild the card list when the party itself changes (a member joins,
    // leaves, or the whole roster is swapped out), or when the party gets in or
    // out of a vehicle: that row is built and dropped with the same rebuild.
    PartyHudOverlay.prototype._syncCards = function (members, vehicle) {
        const key = (vehicle ? vehicleCardKey(vehicle) + '|' : '') +
            members.map(m => m.actorId()).join(',');
        if (key === this._layoutKey) return;
        this._layoutKey = key;
        this._el.innerHTML = '';

        // The vehicle carries the party, so it stands above them. Getting out
        // (or changing vehicle) forgets the card entirely, so climbing back in
        // starts its bars and its damage flash from a clean sheet.
        const vehicleKey = vehicle ? vehicleCardKey(vehicle) : '';
        if (this._vehicleCardKey && this._vehicleCardKey !== vehicleKey) {
            this._lastHp.delete(this._vehicleCardKey);
            this._vehicleCard = null;
        }
        this._vehicleCardKey = vehicleKey;
        if (vehicle) {
            if (!this._vehicleCard) this._vehicleCard = this._makeVehicleCard();
            this._el.appendChild(this._vehicleCard.row);
        }

        const kept = new Map();
        for (const actor of members) {
            const id = actor.actorId();
            const card = this._cards.get(id) || this._makeCard();
            kept.set(id, card);
            this._el.appendChild(card.row);
        }
        this._cards = kept;
    };

    //-------------------------------------------------------------------------
    // Writing a card
    //-------------------------------------------------------------------------
    PartyHudOverlay.prototype._writeBar = function (slot, label, current, max, kind) {
        // refresh() runs every frame, so nothing is written unless it changed.
        const key = label + current + '/' + max;
        if (key === slot.key) return;
        slot.key = key;
        const rate = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
        slot.fill.style.width = (rate * 100).toFixed(1) + '%';
        slot.label.textContent = label;
        slot.value.textContent = current + '/' + max;
        if (kind === 'hp') {
            const critical = rate > 0 && rate <= CRIT_PCT / 100;
            slot.bar.classList.toggle('phud-bar-critical', critical);
            const low = !critical && rate > 0 && rate <= WARN_PCT / 100;
            slot.bar.classList.toggle('phud-bar-low', low);
        }
    };

    PartyHudOverlay.prototype._writeStates = function (card, actor) {
        if (MAX_STATES <= 0) return;
        const labels = stateLabelsFor(actor);
        const key = labels.map(s => s.key + s.text).join('|');
        if (key === card.statesKey) return;
        card.statesKey = key;
        card.states.innerHTML = '';
        for (const label of labels) {
            const chip = document.createElement('span');
            chip.className = 'phud-alert phud-state' + (label.debuff ? ' phud-state-down' : '');
            chip.textContent = label.text;
            card.states.appendChild(chip);
        }
        card.states.classList.toggle('phud-alerts-empty', labels.length === 0);
    };

    PartyHudOverlay.prototype._writeAlerts = function (card, actor, needs) {
        const alerts = urgentAlertsFor(actor, needs);
        const key = alerts.map(a => a.key + a.text + (a.critical ? '!' : '')).join('|');
        if (key === card.alertsKey) return;
        card.alertsKey = key;
        card.alerts.innerHTML = '';
        for (const alert of alerts) {
            const chip = document.createElement('span');
            chip.className = 'phud-alert' + (alert.critical ? ' phud-alert-critical' : '');
            chip.textContent = alert.text;
            card.alerts.appendChild(chip);
        }
        card.alerts.classList.toggle('phud-alerts-empty', alerts.length === 0);
    };

    // A change in HP washes the bar: white for a hit, green for a heal. Applied
    // as a class with a timer rather than a redraw, so it rides the animation.
    // Keyed by actor id, or by vehicle key for the vehicle's own bar, so a
    // scraped wing flashes exactly the way a wounded member does.
    PartyHudOverlay.prototype._writeFlash = function (card, id, hp) {
        const prev = this._lastHp.get(id);
        this._lastHp.set(id, hp);
        if (prev === undefined || prev === hp) return;
        const healing = hp > prev;
        const flash = card.hp.flash;
        flash.classList.remove('phud-flash-hit', 'phud-flash-heal');
        void flash.offsetWidth; // restart the CSS animation
        flash.classList.add(healing ? 'phud-flash-heal' : 'phud-flash-hit');
        if (card.flashTimer) clearTimeout(card.flashTimer);
        card.flashTimer = setTimeout(() => {
            flash.classList.remove('phud-flash-hit', 'phud-flash-heal');
        }, FLASH_MS);
    };

    // The vehicle row: its name, its condition summed over every maintenance
    // part as the HP bar, and its tank in place of the magic bar. A vehicle
    // that keeps no health record (the Broom) draws no HP line, and one that
    // burns no fuel (the Bike, the Boat, the Broom) draws no fuel line.
    PartyHudOverlay.prototype._writeVehicle = function (card, status) {
        if (card.nameKey !== status.name) {
            card.nameKey = status.name;
            card.name.textContent = status.name;
        }

        const hasHealth = status.mhp > 0;
        card.hp.bar.style.display = hasHealth ? '' : 'none';
        if (hasHealth) {
            const hp = Math.round(status.hp);
            const mhp = Math.round(status.mhp);
            // Damage arrives from anywhere (a ram, a crash, a splash-down); the
            // bar simply follows the maintenance record, and washes red when it
            // drops the way a member's does.
            this._writeFlash(card, vehicleCardKey(status), hp);
            this._writeBar(card.hp, TextManager.hpA, hp, mhp, 'hp');
            // A vehicle with every critical part gone is not driveable, which
            // reads the same way a downed member does.
            const broken = window.VehicleSystemRepair?.checkCriticalParts?.(status.key);
            if (card.deadKey !== broken) {
                card.deadKey = broken;
                card.root.classList.toggle('phud-down', !!broken);
            }
        }

        card.mp.bar.style.display = status.usesFuel ? '' : 'none';
        if (status.usesFuel) {
            this._writeBar(card.mp, T('PartyHud.fuel'),
                Math.round(status.fuel), Math.round(status.maxFuel), 'fuel');
        }
    };

    PartyHudOverlay.prototype._needsFor = function (actor) {
        const id = actor.actorId();
        if (this._needTimer >= NEED_REFRESH_FRAMES || !this._needs.has(id)) {
            const read = window.PartyNeeds?.getMemberNeeds?.(actor) || {};
            this._needs.set(id, read);
            return read;
        }
        return this._needs.get(id);
    };

    PartyHudOverlay.prototype.refresh = function () {
        if (!this._el) return;
        const members = this.members();
        const vehicle = vehicleStatus();
        this._syncCards(members, vehicle);
        if (vehicle && this._vehicleCard) this._writeVehicle(this._vehicleCard, vehicle);
        for (const actor of members) {
            const card = this._cards.get(actor.actorId());
            if (!card) continue;
            const needs = this._needsFor(actor);
            const dead = actor.isDead();
            if (card.deadKey !== dead) {
                card.deadKey = dead;
                card.root.classList.toggle('phud-down', dead);
            }
            // Whoever is holding the wheel is named as holding it: on a long
            // drive the rota changes hands by itself (VehicleCrew.js), so the
            // card is the only place the party can see who is driving and who
            // is asleep in the back.
            const label = window.VehicleCrew?.isDriver?.(actor)
                ? actor.name() + ' ' + T('VehicleCrew.drivingTag')
                : actor.name();
            if (card.nameKey !== label) {
                card.nameKey = label;
                card.name.textContent = label;
            }
            this._writeFlash(card, actor.actorId(), actor.hp);
            this._writeBar(card.hp, TextManager.hpA, actor.hp, actor.mhp, 'hp');
            // A severed world has nothing to spend magic on, so the bar itself
            // is taken out of the card (`_makeBar` returns the element as
            // `.bar`) rather than drawn empty.
            if (hideMpBar()) {
                if (card.mp && card.mp.bar) card.mp.bar.style.display = 'none';
            } else {
                if (card.mp && card.mp.bar) card.mp.bar.style.display = '';
                this._writeBar(card.mp, TextManager.mpA, actor.mp, actor.mmp, 'mp');
            }
            this._writeStates(card, actor);
            this._writeAlerts(card, actor, needs);
        }
        if (this._needTimer >= NEED_REFRESH_FRAMES) this._needTimer = 0;
    };

    //-------------------------------------------------------------------------
    // Update
    //-------------------------------------------------------------------------
    PartyHudOverlay.prototype.isWanted = function () {
        if (!ConfigManager.partyHud) return false;
        if (!$gameParty || $gameParty.members().length === 0) return false;
        if (HIDE_ON_MESSAGE && $gameMessage && $gameMessage.isBusy()) return false;
        // ASCII mode draws its own readout in the same corner.
        if (ConfigManager.asciiModeEnabled) return false;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return false;
        // The map name window lives in the same corner; yield to it.
        if (scene._mapNameWindow && scene._mapNameWindow.contentsOpacity > 0) return false;
        return true;
    };

    PartyHudOverlay.prototype.update = function () {
        if (!this._el) return;
        const wanted = this.isWanted();
        if (wanted !== this._visible) {
            this._visible = wanted;
            this._el.classList.toggle('phud-visible', wanted);
        }
        if (!wanted) return;
        this._needTimer++;
        this.refresh();
    };

    window.PartyHudOverlay = PartyHudOverlay;

    //=========================================================================
    // Scene_Map
    //=========================================================================
    const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function () {
        _Scene_Map_createAllWindows.call(this);
        this._partyHud = new PartyHudOverlay();
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if (this._partyHud) this._partyHud.update();
    };

    const _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function () {
        if (this._partyHud) {
            this._partyHud.destroy();
            this._partyHud = null;
        }
        _Scene_Map_terminate.call(this);
    };
})();
