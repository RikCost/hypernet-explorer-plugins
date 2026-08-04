//=============================================================================
// Party HUD
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Party HUD v1.0.0
 * @author Omni-Lex
 * @version 1.0.0
 * @description Top-left map HUD with HP/MP/TP bars and active states per party member
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
 * @desc Width of a member panel, in pixels.
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
 * Draws a compact party HUD in the top-left corner of the map scene:
 * one panel per party member with their name, HP, MP and TP bars and the
 * icons of every state and buff currently on them.
 *
 * The HUD is OFF by default and is switched on from Options -> Video
 * ("Party HUD"). The setting is stored in ConfigManager.partyHud.
 *
 * It fades out on its own while the map name window is showing and (by
 * parameter) while a message is on screen, so it never sits on top of them.
 *
 * Reworked from PlayerHealthHearts.js, which showed the leader's HP alone.
 */

(() => {
    'use strict';

    const pluginName = 'PartyHud';
    const parameters = PluginManager.parameters(pluginName);

    const HUD_X = Number(parameters['hudX'] || 12);
    const HUD_Y = Number(parameters['hudY'] || 12);
    const PANEL_W = Number(parameters['panelWidth'] || 224);
    const MAX_MEMBERS = Number(parameters['maxMembers'] || 4);
    const MAX_STATES = Number(parameters['maxStates'] || 6);
    const HIDE_ON_MESSAGE = parameters['hideDuringMessages'] !== 'false';

    // Layout metrics. Deliberately fixed rather than derived from the window
    // line height: the HUD must keep the same footprint whatever the font
    // scale option is set to, otherwise it walks down over the map.
    const WIN_PAD = 8;      // window padding around the whole HUD
    const BLOCK_PAD = 5;    // inner padding of a member panel
    const BLOCK_GAP = 6;    // vertical gap between member panels
    const NAME_H = 18;      // name / state icon row
    const BAR_H = 12;
    const BAR_GAP = 2;
    const ICON_SIZE = 18;
    const ICON_GAP = 2;
    const NAME_FONT = 15;
    const BAR_FONT = 12;

    const FADE_STEP = 24;   // contents opacity per frame while fading
    const FLASH_FRAMES = 24;

    //=========================================================================
    // ConfigManager
    //=========================================================================
    ConfigManager.partyHud = false;

    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _ConfigManager_makeData.call(this);
        config.partyHud = this.partyHud;
        return config;
    };

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _ConfigManager_applyData.call(this, config);
        this.partyHud = this.readFlag(config, 'partyHud', false);
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
    // Window_PartyHud
    //=========================================================================
    function Window_PartyHud() {
        this.initialize(...arguments);
    }

    Window_PartyHud.prototype = Object.create(Window_Base.prototype);
    Window_PartyHud.prototype.constructor = Window_PartyHud;

    Window_PartyHud.prototype.initialize = function () {
        Window_Base.prototype.initialize.call(this, new Rectangle(HUD_X, HUD_Y, 100, 100));
        this.opacity = 0;           // frameless: the panels draw their own backing
        this.contentsOpacity = 0;
        this.visible = false;
        this._memberCount = -1;
        this._showTp = this.displaysTp();
        this._renderSig = null;
        this._flashes = {};         // actorId -> { timer, healing }
        this._lastHp = {};          // actorId -> hp at the last check
        this._pulseFrame = 0;
        this.relayout();
    };

    Window_PartyHud.prototype.updatePadding = function () {
        this.padding = WIN_PAD;
    };

    Window_PartyHud.prototype.displaysTp = function () {
        return !!($dataSystem && $dataSystem.optDisplayTp);
    };

    Window_PartyHud.prototype.barCount = function () {
        return this._showTp ? 3 : 2;
    };

    Window_PartyHud.prototype.blockHeight = function () {
        const bars = this.barCount();
        return BLOCK_PAD * 2 + NAME_H + bars * (BAR_H + BAR_GAP) - BAR_GAP;
    };

    Window_PartyHud.prototype.members = function () {
        if (!$gameParty) return [];
        return $gameParty.members().slice(0, MAX_MEMBERS);
    };

    // Resize the window to the current party. Called whenever the member count
    // or the TP display setting changes, never per frame.
    Window_PartyHud.prototype.relayout = function () {
        const count = Math.max(1, this.members().length);
        this._memberCount = this.members().length;
        this._showTp = this.displaysTp();
        const height = count * this.blockHeight() + (count - 1) * BLOCK_GAP + WIN_PAD * 2;
        this.move(HUD_X, HUD_Y, PANEL_W + WIN_PAD * 2, height);
        this.createContents();
        this._renderSig = null;
    };

    //-------------------------------------------------------------------------
    // Rendering
    //-------------------------------------------------------------------------

    // Everything the drawn HUD depends on, so an unchanged party costs nothing
    // beyond this string compare each frame.
    Window_PartyHud.prototype.renderSignature = function () {
        let sig = '';
        for (const actor of this.members()) {
            sig += actor.actorId() + ':' + actor.name() + ':' +
                actor.hp + '/' + actor.mhp + ':' +
                actor.mp + '/' + actor.mmp + ':' +
                Math.floor(actor.tp) + ':' +
                actor.allIcons().join(',') + '|';
        }
        return sig;
    };

    Window_PartyHud.prototype.refresh = function () {
        this.contents.clear();
        const members = this.members();
        const blockH = this.blockHeight();
        for (let i = 0; i < members.length; i++) {
            this.drawMember(members[i], 0, i * (blockH + BLOCK_GAP), PANEL_W, blockH);
        }
        this.resetFontSettings();
    };

    Window_PartyHud.prototype.drawMember = function (actor, x, y, width, height) {
        const dead = actor.isDead();

        // Panel backing. Drawn by hand rather than as a window frame so several
        // members can share one window without a stack of nested frames.
        this.contents.fillRect(x, y, width, height, 'rgba(0, 0, 0, 0.45)');
        this.contents.strokeRect(x, y, width, height, 'rgba(255, 255, 255, 0.16)');

        const innerX = x + BLOCK_PAD;
        const innerW = width - BLOCK_PAD * 2;

        // Name row, with the state/buff icons right-aligned on the same line.
        const iconsW = this.drawStateIcons(actor, innerX + innerW, y + BLOCK_PAD + (NAME_H - ICON_SIZE) / 2);
        this.contents.fontSize = NAME_FONT;
        this.contents.fontBold = true;
        this.changeTextColor(dead ? ColorManager.deathColor() : ColorManager.normalColor());
        this.contents.drawText(actor.name(), innerX, y + BLOCK_PAD, Math.max(0, innerW - iconsW - 6), NAME_H, 'left');
        this.contents.fontBold = false;
        this.resetTextColor();

        // Bars
        let barY = y + BLOCK_PAD + NAME_H;
        this.drawStatBar(actor, 'hp', innerX, barY, innerW, TextManager.hpA, actor.hp, actor.mhp,
            ColorManager.hpGaugeColor1(), ColorManager.hpGaugeColor2());
        barY += BAR_H + BAR_GAP;
        this.drawStatBar(actor, 'mp', innerX, barY, innerW, TextManager.mpA, actor.mp, actor.mmp,
            ColorManager.mpGaugeColor1(), ColorManager.mpGaugeColor2());
        if (this._showTp) {
            barY += BAR_H + BAR_GAP;
            this.drawStatBar(actor, 'tp', innerX, barY, innerW, TextManager.tpA, Math.floor(actor.tp), actor.maxTp(),
                ColorManager.tpGaugeColor1(), ColorManager.tpGaugeColor2());
        }
    };

    // Returns the width the icons took, so the name can be clipped to fit.
    Window_PartyHud.prototype.drawStateIcons = function (actor, right, y) {
        if (MAX_STATES <= 0) return 0;
        const icons = actor.allIcons().slice(0, MAX_STATES);
        if (icons.length === 0) return 0;
        const bitmap = ImageManager.loadSystem('IconSet');
        if (!bitmap.isReady()) {
            // Drawn on the next refresh once the sheet is in memory.
            bitmap.addLoadListener(() => { this._renderSig = null; });
            return 0;
        }
        const pw = ImageManager.iconWidth;
        const ph = ImageManager.iconHeight;
        const total = icons.length * ICON_SIZE + (icons.length - 1) * ICON_GAP;
        let iconX = right - total;
        for (const icon of icons) {
            const sx = (icon % 16) * pw;
            const sy = Math.floor(icon / 16) * ph;
            this.contents.blt(bitmap, sx, sy, pw, ph, iconX, y, ICON_SIZE, ICON_SIZE);
            iconX += ICON_SIZE + ICON_GAP;
        }
        return total;
    };

    Window_PartyHud.prototype.drawStatBar = function (actor, kind, x, y, width, label, current, max, color1, color2) {
        const rate = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
        const fillW = Math.floor(width * rate);

        this.contents.fillRect(x, y, width, BAR_H, ColorManager.gaugeBackColor());
        if (fillW > 0) {
            this.contents.gradientFillRect(x, y, fillW, BAR_H, color1, color2);
        }

        if (kind === 'hp') {
            // Critical HP pulse: a light wash over the filled part, so a member
            // about to go down reads at a glance without another widget here.
            if (rate > 0 && rate <= 0.25 && !actor.isDead()) {
                const pulse = 0.10 + 0.12 * (1 + Math.sin(this._pulseFrame * 0.12)) / 2;
                this.contents.fillRect(x, y, fillW, BAR_H, 'rgba(255, 255, 255, ' + pulse.toFixed(3) + ')');
            }
            // Damage / healing flash.
            const flash = this._flashes[actor.actorId()];
            if (flash && flash.timer > 0) {
                const alpha = (flash.timer / FLASH_FRAMES) * 0.55;
                const wash = flash.healing
                    ? 'rgba(150, 255, 150, ' + alpha.toFixed(3) + ')'
                    : 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')';
                this.contents.fillRect(x, y, width, BAR_H, wash);
            }
        }

        this.contents.strokeRect(x, y, width, BAR_H, 'rgba(0, 0, 0, 0.55)');

        this.contents.fontSize = BAR_FONT;
        this.changeTextColor(ColorManager.systemColor());
        this.contents.drawText(label, x + 4, y, 40, BAR_H, 'left');
        this.resetTextColor();
        this.contents.drawText(current + '/' + max, x, y, width - 4, BAR_H, 'right');
    };

    //-------------------------------------------------------------------------
    // Update
    //-------------------------------------------------------------------------
    Window_PartyHud.prototype.isHudWanted = function () {
        if (!ConfigManager.partyHud) return false;
        if (!$gameParty || $gameParty.members().length === 0) return false;
        if (HIDE_ON_MESSAGE && $gameMessage && $gameMessage.isBusy()) return false;
        // The map name window lives in the same corner; yield to it.
        const scene = SceneManager._scene;
        if (scene && scene._mapNameWindow && scene._mapNameWindow.contentsOpacity > 0) return false;
        return true;
    };

    Window_PartyHud.prototype.update = function () {
        Window_Base.prototype.update.call(this);

        const wanted = this.isHudWanted();
        if (!wanted && this.contentsOpacity <= 0) {
            this.visible = false;
            return;
        }
        this.visible = true;

        if (this._memberCount !== this.members().length || this._showTp !== this.displaysTp()) {
            this.relayout();
        }

        this.updateFlashes();
        this._pulseFrame++;

        const sig = this.renderSignature();
        const needsRedraw = sig !== this._renderSig || this.hasActiveFlash() ||
            (this.hasCriticalMember() && this._pulseFrame % 3 === 0);
        if (needsRedraw) {
            this._renderSig = sig;
            this.refresh();
        }

        const target = wanted ? 255 : 0;
        if (this.contentsOpacity < target) {
            this.contentsOpacity = Math.min(target, this.contentsOpacity + FADE_STEP);
        } else if (this.contentsOpacity > target) {
            this.contentsOpacity = Math.max(target, this.contentsOpacity - FADE_STEP);
        }
    };

    Window_PartyHud.prototype.updateFlashes = function () {
        for (const actor of this.members()) {
            const id = actor.actorId();
            const prev = this._lastHp[id];
            if (prev !== undefined && prev !== actor.hp) {
                this._flashes[id] = { timer: FLASH_FRAMES, healing: actor.hp > prev };
            }
            this._lastHp[id] = actor.hp;
        }
        for (const id in this._flashes) {
            const flash = this._flashes[id];
            if (flash.timer > 0) flash.timer--;
            else delete this._flashes[id];
        }
    };

    Window_PartyHud.prototype.hasActiveFlash = function () {
        for (const id in this._flashes) {
            if (this._flashes[id].timer > 0) return true;
        }
        return false;
    };

    Window_PartyHud.prototype.hasCriticalMember = function () {
        return this.members().some(actor => {
            const rate = actor.mhp > 0 ? actor.hp / actor.mhp : 0;
            return rate > 0 && rate <= 0.25 && !actor.isDead();
        });
    };

    window.Window_PartyHud = Window_PartyHud;

    //=========================================================================
    // Scene_Map
    //=========================================================================
    // Created last so the HUD sits above the map name window and the rest of
    // the map windows in the window layer.
    const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function () {
        _Scene_Map_createAllWindows.call(this);
        this.createPartyHudWindow();
    };

    Scene_Map.prototype.createPartyHudWindow = function () {
        this._partyHudWindow = new Window_PartyHud();
        this.addWindow(this._partyHudWindow);
    };
})();
