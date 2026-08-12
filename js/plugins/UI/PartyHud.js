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
 * @default 12
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
 * @text Max State Icons
 * @desc How many state/buff icons are shown per member.
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
 * member, the bordered card carrying their name, HP and MP bars and the icons
 * of every state and buff on them, and the urgent-need chips standing to the
 * right of that card, outside the box.
 *
 * A chip appears whenever something needs seeing to: low health, hunger,
 * sleep, hygiene, social or fun below the warning line (and a second, louder
 * colour below the critical one), plus a craving an addicted member is about
 * to go into withdrawal over. The needs come from window.PartyNeeds, the
 * cravings from window.AddictionSystem, so the HUD reads the same meters the
 * menu and the status screen do.
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
    const HUD_Y = Number(parameters['hudY'] || 12);
    const PANEL_W = Number(parameters['panelWidth'] || 224);
    const MAX_MEMBERS = Number(parameters['maxMembers'] || 4);
    const MAX_STATES = Number(parameters['maxStates'] || 6);
    const HIDE_ON_MESSAGE = parameters['hideDuringMessages'] !== 'false';

    const ICON_PX = 20;             // on-screen size of a state icon
    const ICON_COLS = 16;           // IconSet columns
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
    // PartyHudOverlay
    //=========================================================================
    // The cards are built once per party and then written into in place, so a
    // walking party costs a handful of textContent/style writes per refresh and
    // the CSS transitions on the bars are never interrupted by a rebuild.
    function PartyHudOverlay() {
        this._el = null;
        this._cards = new Map();    // actorId -> { root, name, states, hp, mp, alerts, ... }
        this._layoutKey = '';
        this._needs = new Map();    // actorId -> needs object
        this._needTimer = NEED_REFRESH_FRAMES;
        this._lastHp = new Map();
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
        // A member is a row: the bordered card, and the urgent-need chips
        // standing to the right of it, outside the box.
        const row = document.createElement('div');
        row.className = 'phud-row';

        const root = document.createElement('div');
        root.className = 'phud-card';

        const head = document.createElement('div');
        head.className = 'phud-head';
        const name = document.createElement('span');
        name.className = 'phud-name';
        const states = document.createElement('span');
        states.className = 'phud-states';
        head.appendChild(name);
        head.appendChild(states);

        const hp = this._makeBar('hp');
        const mp = this._makeBar('mp');
        const alerts = document.createElement('div');
        alerts.className = 'phud-alerts';

        root.appendChild(head);
        root.appendChild(hp.bar);
        root.appendChild(mp.bar);

        row.appendChild(root);
        row.appendChild(alerts);

        return { row, root, name, states, hp, mp, alerts, statesKey: null, alertsKey: null, deadKey: null };
    };

    // Rebuild the card list when the party itself changes (a member joins,
    // leaves, or the whole roster is swapped out).
    PartyHudOverlay.prototype._syncCards = function (members) {
        const key = members.map(m => m.actorId()).join(',');
        if (key === this._layoutKey) return;
        this._layoutKey = key;
        this._el.innerHTML = '';
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
        const icons = actor.allIcons().slice(0, MAX_STATES);
        const key = icons.join(',');
        if (key === card.statesKey) return;
        card.statesKey = key;
        card.states.innerHTML = '';
        // The sheet is scaled so one 32px IconSet cell lands on ICON_PX pixels.
        const sheetW = ICON_COLS * ICON_PX;
        for (const icon of icons) {
            const span = document.createElement('span');
            span.className = 'phud-state-icon';
            span.style.backgroundImage = "url('img/system/IconSet.png')";
            span.style.backgroundSize = sheetW + 'px auto';
            span.style.backgroundPosition =
                -((icon % ICON_COLS) * ICON_PX) + 'px ' + -(Math.floor(icon / ICON_COLS) * ICON_PX) + 'px';
            card.states.appendChild(span);
        }
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
    PartyHudOverlay.prototype._writeFlash = function (card, actor) {
        const id = actor.actorId();
        const prev = this._lastHp.get(id);
        this._lastHp.set(id, actor.hp);
        if (prev === undefined || prev === actor.hp) return;
        const healing = actor.hp > prev;
        const flash = card.hp.flash;
        flash.classList.remove('phud-flash-hit', 'phud-flash-heal');
        void flash.offsetWidth; // restart the CSS animation
        flash.classList.add(healing ? 'phud-flash-heal' : 'phud-flash-hit');
        if (card.flashTimer) clearTimeout(card.flashTimer);
        card.flashTimer = setTimeout(() => {
            flash.classList.remove('phud-flash-hit', 'phud-flash-heal');
        }, FLASH_MS);
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
        this._syncCards(members);
        for (const actor of members) {
            const card = this._cards.get(actor.actorId());
            if (!card) continue;
            const needs = this._needsFor(actor);
            const dead = actor.isDead();
            if (card.deadKey !== dead) {
                card.deadKey = dead;
                card.root.classList.toggle('phud-down', dead);
            }
            if (card.nameKey !== actor.name()) {
                card.nameKey = actor.name();
                card.name.textContent = actor.name();
            }
            this._writeFlash(card, actor);
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
