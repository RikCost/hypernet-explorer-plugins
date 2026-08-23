/*:
 * @target MZ MV
 * @plugindesc Parchment HTML dialogue, choice overlay, keyword system, and VN bust display.
 * @author Sang Hendrix / Antigravity / Omni-Lex
 *
 * @command showBust
 * @text Show Character Bust
 * @desc Manually display a character bust on screen.
 *
 * @command hideBusts
 * @text Hide All Busts
 * @desc Manually hide all bust images and names.
 *
 * @command batchDialogue
 * @text Batch Dialogue Mode
 * @desc Bust stays visible across multiple messages until conversation ends.
 *
 * @command showCustomBust
 * @text Show Custom Bust
 * @desc Display a specific bust image from the busts/ folder.
 *
 * @arg imageName
 * @type string
 * @text Image Name
 * @desc Name of the image in busts/ (without extension).
 *
 * @arg characterName
 * @type string
 * @text Character Name
 * @desc Name to display (optional).
 *
 * @command playerBatchDialogue
 * @text Show Player Bust
 * @desc Display a specific bust image from the busts/ folder.
 *
 * @arg imageName
 * @type string
 * @text Image Name
 * @desc Name of the image in busts/ (without extension).
 *
 * @command Rumors
 * @text Rumors
 * @desc Speaks one rumour in the calling NPC's personality. Elsewhere, a line from the generic bank.
 *
 * @help
 * DialogueSystem.js
 * -----------------------------------------------------------------------
 * Merged plugin combining:
 * 1. HTML Message Window: DOM textbox with parchment style
 * 2. HTML Choice List: DOM choice overlay
 * 3. Keyword System: [Keyword] extraction, coloring, gating
 * 4. VN Bust System: character bust sprites with slide animation
 * -----------------------------------------------------------------------
 * This plugin owns the *conversation*: the box the player reads, the choices
 * they answer with, and the face doing the talking. It does not own popups.
 *
 * Anything transient the player only glances at - a topic learned, a reward,
 * a need moving, a level gained - belongs to the shared notification service
 * (window.ParchmentToast, Core/ParchmentToast.js) and never to a message box
 * or a bespoke overlay declared here. Several notifications can be on screen
 * at once, so an event that does three things reports all three.
 * -----------------------------------------------------------------------
 */

var Imported = Imported || {};
Imported.DialogueSystem = true;

(function () {
    "use strict";

    const PLUGIN_NAME = "DialogueSystem";

    // -------------------------------------------------------------------------
    // Bust display constants
    // -------------------------------------------------------------------------
    const bustOpacity      = 255;
    const bustWidth_16_9   = 440;
    const bustHeight_16_9  = 615;
    const bustYOffset_16_9 = 185;
    const bustXOffset_16_9 = 245;
    const fadeInDuration   = 12;
    const fadeOutDuration  = 12;

    const SpritesAssociation = (window.Sprites && window.Sprites.SpritesAssociation) || {};

    // -------------------------------------------------------------------------
    // Bust size helpers
    // -------------------------------------------------------------------------
    function getBustWidth()  { return bustWidth_16_9;  }
    function getBustHeight() { return bustHeight_16_9; }

    function addBustToScene(bust, scene) {
        if (!scene || bust.parent) return;
        if (scene._windowLayer) {
            const idx = scene.children.indexOf(scene._windowLayer);
            if (idx >= 0) { scene.addChildAt(bust, idx); return; }
        }
        if (scene._messageWindow) {
            const idx = scene.children.indexOf(scene._messageWindow);
            if (idx >= 0) { scene.addChildAt(bust, idx); return; }
        }
        scene.addChild(bust);
    }

    // -------------------------------------------------------------------------
    // Auto Wrap Text
    // -------------------------------------------------------------------------
    function _wrapWords(text, maxLen) {
        let result = '';
        let lineLen = 0;
        const words = text.split(' ');
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (!word) continue;
            if (word.length > maxLen) {
                if (lineLen > 0) { result += '\n'; lineLen = 0; }
                for (let j = 0; j < word.length; j += maxLen) {
                    const chunk = word.substring(j, Math.min(j + maxLen, word.length));
                    result += chunk;
                    if (j + maxLen < word.length) { result += '-\n'; lineLen = 0; }
                    else { lineLen = chunk.length; }
                }
            } else {
                if (lineLen + word.length + (lineLen > 0 ? 1 : 0) > maxLen) { result += '\n'; lineLen = 0; }
                if (lineLen > 0) { result += ' '; lineLen++; }
                result += word;
                lineLen += word.length;
            }
        }
        return result;
    }

    // The parchment box is HTML (#html-msg-text, white-space: pre-wrap), so the
    // browser wraps at the real box width using the real font metrics.
    function _htmlMessageActive() {
        return typeof document !== 'undefined' && !!document.getElementById('html-msg-text');
    }

    function autoWrapText(text, maxLineLength = 60) {
        if (maxLineLength === 60) maxLineLength = 68;
        // Strip every manually-authored line break and reflow from scratch. Event
        // text frequently has hand-placed newlines (4-line Show Text boxes, breaks
        // dropped mid-sentence) that wrap badly in the parchment box, so we flatten
        // the whole thing to a single run of words first.
        const flat = String(text).replace(/\r?\n/g, ' ').replace(/  +/g, ' ').trim();
        if (!flat) return '';
        // Force a hard line break after every sentence that ends in '.', i.e. a
        // period followed by whitespace or end-of-text. Decimals and money like
        // "12.00" are left alone because no whitespace follows the dot.
        const sentences = flat.replace(/\.(\s+|$)/g, '.\n').split('\n')
            .map(s => s.trim()).filter(s => s.length > 0);
        // Fixed-width breaks on top of the browser's own wrapping are what caused
        // stray short lines mid-sentence ("...claims to be / from the / year
        // 2000."): our break landed in one place, the CSS wrap in another. Let the
        // box wrap itself and only keep the per-sentence breaks. The character
        // count is still used for the canvas window, which has no wrapping at all.
        if (_htmlMessageActive()) return sentences.join('\n');
        return sentences.map(s => _wrapWords(s, maxLineLength)).join('\n');
    }

    Window_Message.prototype.numVisibleRows    = function () { return 4; };
    Window_Message.prototype.standardFontSize  = function () { return 29; };
    Window_ChoiceList.prototype.standardFontSize = function () { return 29; };

    // -------------------------------------------------------------------------
    // BustManagerNameWindow, thin adapter; reuses #html-msg-name from the message overlay
    // Name is positioned each frame by Window_Message.update, no slide, no transition.
    // -------------------------------------------------------------------------
    class BustManagerNameWindow {
        constructor() {
            this._characterName = '';
            this._visible       = false;
        }

        setCharacterName(name) { this._characterName = name || ''; }

        showName() { if (this._characterName) this._visible = true; }

        hideName() {
            this._visible = false;
            const el = document.getElementById('html-msg-name');
            if (el) el.style.display = 'none';
        }

        update() { /* positioning handled entirely by Window_Message.update */ }

        get parent() { return document.body; }
    }

    // -------------------------------------------------------------------------
    // BustManager
    // -------------------------------------------------------------------------
    class BustManager {
        constructor() {
            this.characterBust       = null;
            this.nameWindow          = null;
            this.currentCharacterKey = null;
            this.batchDialogueMode   = false;
            this.nameIsVisible       = false;
            this.bustIsVisible       = false;
            this.activeEventId       = null;
            this.lastKnownEventId    = null;
            this.hideScheduled       = false;
            // While true, this manager is being driven line by line by an
            // external exchange (see startNPCExchange below) instead of by the
            // interpreter's own event: startMessage must not re-derive the bust
            // from $gameMap._interpreter, and terminateMessage must hand control
            // to the exchange queue instead of the usual auto-hide check.
            this.exchangeMode        = false;
        }

        initialize() {
            this.createBustSprites();
            this.nameWindow = new BustManagerNameWindow();
        }

        createBustSprites() {
            this.characterBust           = new Sprite();
            this.characterBust.opacity   = 0;
            this.characterBust.anchor.x  = 0;
            this.characterBust.anchor.y  = 1;
            this.setupBustPosition(this.characterBust);
            this.updateBustHiddenPosition();
            this.characterBust.x = this.characterBust._hiddenX;
        }

        updateBustHiddenPosition() {
            const width = getBustWidth();
            this.characterBust._hiddenX = Graphics.width + width;
            if (window.$gameSplitScreen && window.$gameSplitScreen.active) {
                this.characterBust._targetX = (Graphics.width - width) / 2;
            } else {
                this.characterBust._targetX = Graphics.width - width - bustXOffset_16_9;
            }
        }

        getBustY() { return Graphics.height - bustYOffset_16_9; }

        setupBustPosition(sprite) { sprite.y = this.getBustY(); }

        scaleBustToFit(sprite) {
            if (!sprite.bitmap || !sprite.bitmap.width || !sprite.bitmap.height) {
                sprite.bitmap.addLoadListener(() => this.scaleBustToFit(sprite));
                return;
            }
            const scale = Math.min(getBustWidth() / sprite.bitmap.width, getBustHeight() / sprite.bitmap.height);
            sprite.scale.x = scale;
            sprite.scale.y = scale;
        }

        _loadFallback() {
            try { return ImageManager.loadBitmap('img/busts/', '7'); } catch (e) { return null; }
        }

        _applyBitmap(bitmap, fallback, path) {
            if (bitmap.width > 0 && bitmap.height > 0) {
                this.characterBust.bitmap = bitmap;
            } else if (fallback) {
                this.characterBust.bitmap = fallback;
                console.warn("Bust image failed, using fallback:", path);
            } else {
                console.error("Bust image and fallback both unavailable:", path);
            }
            this.scaleBustToFit(this.characterBust);
        }

        getBustImageForCharacter(characterName, characterIndex) {
            if (!characterName) return null;
            if (characterName.startsWith("$") || characterName.startsWith("!") || characterName.startsWith("Objects")) {
                return "busts/7";
            }
            const spritesheetName = characterName.split('.')[0];

            try {
                const commentBust = window.BustPath.resolve(this.getBustNameFromEventComment());
                if (commentBust) return `busts/${commentBust}`;
            } catch (err) {
                console.warn("Error checking event comment for bust name:", err);
            }

            // A pre-made character's own portrait, before anything derived from
            // the walk sheet: a dossier can be played in an alternate look and
            // each look has its own bust, so only the dossier itself (or the
            // party member taken from it) knows which face belongs here.
            const presetBust = this.getPresetBustForSprite(spritesheetName, characterIndex);
            if (presetBust) return `busts/${presetBust}`;

            if (window.NPCSim?.getBustForNPC) {
                try {
                    const evId    = $gameMap?._interpreter?._eventId;
                    const npcName = evId ? $gameMap.event(evId)?.event()?.name : null;
                    if (npcName) {
                        const b = window.BustPath.resolve(window.NPCSim.getBustForNPC(npcName));
                        if (b) return `busts/${b}`;
                    }
                } catch (_) {}
            }

            if (SpritesAssociation[spritesheetName]?.[characterIndex]) {
                const b = window.BustPath.resolve(SpritesAssociation[spritesheetName][characterIndex]);
                if (b) return `busts/${b}`;
            }

            return `busts/7`;
        }

        // The bust of a pre-made character standing on this sprite sheet, or
        // null when the sheet belongs to nobody in particular. A party member
        // wearing the sheet answers first (their own bust follows them however
        // they have been dressed since), then the dossiers and their alternate
        // looks. Mirrors VisualNovelBustSystem's method of the same name, which
        // is where the two bust front ends have to agree.
        getPresetBustForSprite(spritesheetName, characterIndex) {
            if (!spritesheetName) return null;
            const idx = characterIndex || 0;
            try {
                const members = ($gameParty && $gameParty.allMembers) ? $gameParty.allMembers() : [];
                for (const actor of members) {
                    if (!actor || actor.characterName() !== spritesheetName) continue;
                    if ((actor.characterIndex() || 0) !== idx) continue;
                    const bust = window.BustPath.resolve(actor.vnBust ? actor.vnBust() : null);
                    if (bust) return bust;
                }
            } catch (err) { /* no party yet */ }

            const CP = window.CharacterPresets;
            if (!CP || !CP.getCharacterPresets) return null;
            try {
                for (const preset of CP.getCharacterPresets()) {
                    const looks = CP.getPresetSkins ? CP.getPresetSkins(preset) : [preset];
                    for (const look of looks) {
                        if (!look || look.sprite !== spritesheetName) continue;
                        if ((look.spriteIndex || 0) !== idx) continue;
                        if (look.busts) return look.busts;
                    }
                }
            } catch (err) { /* dossiers not loaded */ }
            return null;
        }

        getBustNameFromEventComment() {
            const interpreter = $gameMap._interpreter;
            if (!interpreter || !interpreter._eventId) return null;
            const gameEvent = $gameMap.event(interpreter._eventId);
            if (!gameEvent) return null;
            const eventData = gameEvent.event();
            if (!eventData?.pages) return null;
            const page = eventData.pages.find(p => gameEvent.meetsConditions(p));
            if (!page?.list) return null;
            for (const cmd of page.list) {
                if (cmd.code === 108 || cmd.code === 408) {
                    const comment = cmd.parameters[0];
                    if (comment && typeof comment === 'string') {
                        const trimmed = comment.trim();
                        if (trimmed && !trimmed.includes(' ')) return trimmed;
                    }
                }
            }
            return null;
        }

        getCharacterDisplayName(eventId) {
            if (eventId) {
                const gameEvent = $gameMap.event(eventId);
                if (gameEvent?.event()?.name) {
                    const name = gameEvent.event().name.trim();
                    if (window.NPCSocietyRegistry && window.NPCSocietyConfig) {
                        const profile = window.NPCSocietyRegistry.getProfile(name);
                        if (profile) {
                            const m         = gameEvent.event().note?.match(/NPC-(\d+)/);
                            const classId   = m ? Number(m[1]) : null;
                            const className = classId ? (window.NPCSocietyConfig.CLASS_NAMES[classId] || "") : "";
                            if (className) return `${name}, ${className}`;
                        }
                    }
                    return name;
                }
            }
            const charInfo = this.getCurrentEventCharacterInfo();
            if (charInfo?.characterName) {
                const displayName = this.convertCamelCaseToReadable(charInfo.characterName.split('.')[0]);
                const nameKey     = displayName.trim();
                if (window.NPCSocietyRegistry && window.NPCSocietyConfig) {
                    const profile = window.NPCSocietyRegistry.getProfile(nameKey);
                    if (profile) {
                        const ev        = $gameMap.events().find(e => e?.event()?.name?.trim() === nameKey);
                        const m         = ev?.event()?.note?.match(/NPC-(\d+)/);
                        const classId   = m ? Number(m[1]) : null;
                        const className = classId ? (window.NPCSocietyConfig.CLASS_NAMES[classId] || "") : "";
                        if (className) return `${nameKey}, ${className}`;
                    }
                }
                return displayName;
            }
            return "";
        }

        convertCamelCaseToReadable(text) {
            if (!text || typeof text !== 'string') return '';
            let r = text.replace(/_/g, ' ');
            r = r.replace(/([a-z])([A-Z])/g, '$1 $2');
            r = r.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
            return r.split(' ').map(w => w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }

        getCurrentEventCharacterInfo() {
            const interpreter = $gameMap._interpreter;
            if (!interpreter || !interpreter._eventId) return null;
            const gameEvent = $gameMap.event(interpreter._eventId);
            if (!gameEvent) return null;
            const page = gameEvent.event().pages.find(p => gameEvent.meetsConditions(p));
            if (!page?.image?.characterName) return null;
            return { characterName: page.image.characterName, characterIndex: page.image.characterIndex, eventId: interpreter._eventId };
        }

        shouldShowBustAndName() {
            const interpreter = $gameMap._interpreter;
            if (!interpreter || !interpreter._eventId) return false;
            const gameEvent = $gameMap.event(interpreter._eventId);
            if (!gameEvent) return false;
            const eventName = gameEvent.event().name;
            if (eventName && (eventName.startsWith("EV") || eventName.startsWith("Treasure") || eventName.startsWith("Random"))) return false;
            const page = gameEvent.event().pages.find(p => gameEvent.meetsConditions(p));
            if (!page?.image) return false;
            const cn = page.image.characterName;
            if (!cn || cn === "" || cn === "none") return false;
            if (cn.toLowerCase().includes("objects/") || cn.toLowerCase().startsWith("objects")) return false;
            return true;
        }

        checkImageExists(path) {
            if (Utils.isNwjs()) {
                try {
                    const fs       = require('fs');
                    const nodePath = require('path');
                    return fs.existsSync(nodePath.join(process.cwd(), 'img', path + '.png'));
                } catch (e) { return false; }
            }
            return true;
        }

        showCustomBust(imageName, characterName) {
            if (!imageName) return;
            const resolvedName = window.BustPath.resolve(imageName);
            let path = resolvedName ? `busts/${resolvedName}` : `busts/7`;
            if (!this.checkImageExists(path)) path = `busts/7`;
            const key          = `custom_${imageName}`;
            const fallback     = this._loadFallback();

            if (this.nameWindow) {
                let displayName = characterName || this.convertCamelCaseToReadable(imageName);
                const nameKey   = displayName.trim();
                if (window.NPCSocietyRegistry && window.NPCSocietyConfig) {
                    const profile = window.NPCSocietyRegistry.getProfile(nameKey);
                    if (profile) {
                        const ev        = $gameMap.events().find(e => e?.event()?.name?.trim() === nameKey);
                        const m         = ev?.event()?.note?.match(/NPC-(\d+)/);
                        const classId   = m ? Number(m[1]) : null;
                        const className = classId ? (window.NPCSocietyConfig.CLASS_NAMES[classId] || "") : "";
                        if (className) displayName = `${nameKey}, ${className}`;
                    }
                }
                this.nameWindow.setCharacterName(displayName);
                this.nameWindow.showName();
                this.nameIsVisible = true;
            }

            if (this.currentCharacterKey === key && this.characterBust.parent) return;

            try {
                const bitmap = ImageManager.loadBitmap('img/', path);
                bitmap.addLoadListener(() => this._applyBitmap(bitmap, fallback, path));
            } catch (err) {
                console.warn("Failed to load custom bust:", path, err);
                if (fallback) { this.characterBust.bitmap = fallback; this.scaleBustToFit(this.characterBust); }
            }

            this.currentCharacterKey = key;
            const scene = SceneManager._scene;
            if (!this.characterBust.parent && scene) addBustToScene(this.characterBust, scene);
            this.slideIn();
            this.bustIsVisible = true;
            this.activeEventId = 'custom';
            this.hideScheduled = false;
        }

        showBusts() {
            const charInfo   = this.getCurrentEventCharacterInfo();
            const shouldShow = this.shouldShowBustAndName();
            if (!shouldShow || !charInfo) { this.bustIsVisible = false; return; }

            const { characterName, characterIndex, eventId } = charInfo;
            const key      = `${characterName}_${characterIndex}`;
            const fallback = this._loadFallback();

            this.activeEventId    = eventId;
            this.lastKnownEventId = eventId;
            this.hideScheduled    = false;

            let targetX;
            if (window.$gameSplitScreen && window.$gameSplitScreen.active) {
                const activator = $gameMessage._eventActivator;
                const w         = getBustWidth();
                if      (activator === "p1") targetX = 0;
                else if (activator === "p2") targetX = Graphics.width - w;
                else                          targetX = (Graphics.width - w) / 2;
            } else {
                targetX = Graphics.width - getBustWidth() - bustXOffset_16_9;
            }

            const targetChanged = targetX !== this.characterBust._targetX;
            this.characterBust._targetX = targetX;

            if (this.currentCharacterKey === key && this.characterBust.parent) {
                if (targetChanged) this.slideIn();
                if (this.nameWindow && !this.nameIsVisible) { this.nameWindow.showName(); this.nameIsVisible = true; }
                this.bustIsVisible = true;
                return;
            }

            let path = this.getBustImageForCharacter(characterName, characterIndex);
            if (!path) return;
            if (!this.checkImageExists(path)) { console.warn(`Bust not found: ${path}, using fallback`); path = `busts/7`; }

            try {
                const bitmap = ImageManager.loadBitmap('img/', path);
                bitmap.addLoadListener(() => this._applyBitmap(bitmap, fallback, path));
            } catch (err) {
                console.warn("Failed to load bust:", path, err);
                if (fallback) { this.characterBust.bitmap = fallback; this.scaleBustToFit(this.characterBust); }
            }

            this.currentCharacterKey = key;
            const scene = SceneManager._scene;
            if (!this.characterBust.parent && scene) addBustToScene(this.characterBust, scene);

            if (this.nameWindow) {
                this.nameWindow.setCharacterName(this.getCharacterDisplayName(eventId));
                this.nameWindow.showName();
                this.nameIsVisible = true;
            }

            this.slideIn();
            this.bustIsVisible = true;
        }

        hideBusts() {
            if (this.characterBust.parent) this.slideOut();
            if (this.nameWindow) { this.nameWindow.hideName(); this.nameIsVisible = false; }
            this.currentCharacterKey = null;
            this.batchDialogueMode   = false;
            this.bustIsVisible       = false;
            this.activeEventId       = null;
            this.hideScheduled       = false;
        }

        enableBatchDialogue() { this.batchDialogueMode = true; this.showBusts(); }

        isStillInActiveEvent() {
            const interp = $gameMap._interpreter;
            return interp ? interp._eventId === this.activeEventId : false;
        }

        hasEventEnded() {
            const interp = $gameMap._interpreter;
            if (!interp) return true;
            if (!interp.isRunning()) return true;
            if (interp._eventId !== this.activeEventId && this.activeEventId !== null) return true;
            return false;
        }

        shouldAutoHide() {
            if (this.batchDialogueMode) return false;
            if (this.isStillInActiveEvent()) return false;
            return this.hasEventEnded();
        }

        isMessageWindowClosed() {
            const scene = SceneManager._scene;
            if (!scene || !scene._messageWindow) return true;
            return !scene._messageWindow.isOpen() && !scene._messageWindow.isOpening();
        }

        onResolutionChange() {
            this.updateBustHiddenPosition();
            this.characterBust.y = this.getBustY();
            if (this.characterBust.parent) {
                if (this.characterBust._slideDuration > 0) this.characterBust._slideTarget = this.characterBust._targetX;
                else if (this.bustIsVisible)               this.characterBust.x = this.characterBust._targetX;
            }
        }

        slideIn() {
            this.updateBustHiddenPosition();
            this.characterBust._slideTarget  = this.characterBust._targetX;
            this.characterBust._slideDuration = fadeInDuration;
            this.characterBust._slideType     = 'in';
        }

        slideOut() {
            this.characterBust._slideTarget  = this.characterBust._hiddenX;
            this.characterBust._slideDuration = fadeOutDuration;
            this.characterBust._slideType     = 'out';
        }

        update() {
            const s = this.characterBust;
            if (s._slideDuration > 0) {
                s.x += (s._slideTarget - s.x) / s._slideDuration;
                s._slideDuration -= 1;
                if      (s._slideType === 'in')  s.opacity = bustOpacity * (1 - s._slideDuration / fadeInDuration);
                else if (s._slideType === 'out') s.opacity = bustOpacity * (s._slideDuration / fadeOutDuration);
            } else if (s._slideType === 'out' && s.parent) {
                s.parent.removeChild(s);
                s.opacity = 0;
                this.bustIsVisible = false;
            }

            if (this.bustIsVisible && !this.batchDialogueMode) {
                const closed = this.isMessageWindowClosed();
                const ended  = this.hasEventEnded();
                if (closed && ended && !this.hideScheduled) { this.hideScheduled = true; this.hideBusts(); }
                if (!closed && this.isStillInActiveEvent())   this.hideScheduled = false;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Scene_Map hooks
    // -------------------------------------------------------------------------
    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _Scene_Map_start.call(this);
        this._bustManager = new BustManager();
        this._bustManager.initialize();
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if (this._bustManager) this._bustManager.update();
    };

    // -------------------------------------------------------------------------
    // Scene_Battle hooks
    // -------------------------------------------------------------------------
    // Busts are not a map-only thing: a boss that talks mid-fight gets the same
    // portrait and name tag the overworld gets, instead of a bare message box.
    // The manager is built per battle and driven by the same update; auto-hide
    // still works, since out of an event the map interpreter reads as ended and
    // the bust slides away as soon as the message closes.
    const _Scene_Battle_start = Scene_Battle.prototype.start;
    Scene_Battle.prototype.start = function () {
        _Scene_Battle_start.call(this);
        this._bustManager = new BustManager();
        this._bustManager.initialize();
    };

    const _Scene_Battle_update = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function () {
        _Scene_Battle_update.call(this);
        if (this._bustManager) this._bustManager.update();
    };

    const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
    Scene_Battle.prototype.terminate = function () {
        if (this._bustManager) {
            try { this._bustManager.hideBusts(); } catch (e) {}
            this._bustManager = null;
        }
        _Scene_Battle_terminate.call(this);
    };

    const _Graphics_resize = Graphics.resize;
    Graphics.resize = function (width, height) {
        _Graphics_resize.call(this, width, height);
        const scene = SceneManager._scene;
        if (scene && scene._bustManager) scene._bustManager.onResolutionChange();
    };

    // -------------------------------------------------------------------------
    // Message window width: always 800px, centered
    // -------------------------------------------------------------------------
    const MESSAGE_WINDOW_WIDTH = 800;
    function overrideMessageWindowRect(SceneClass) {
        const _orig = SceneClass.prototype.messageWindowRect;
        if (!_orig) return;
        SceneClass.prototype.messageWindowRect = function () {
            const rect = _orig.call(this);
            rect.width = MESSAGE_WINDOW_WIDTH;
            rect.x     = Math.floor((Graphics.boxWidth - MESSAGE_WINDOW_WIDTH) / 2);
            return rect;
        };
    }
    overrideMessageWindowRect(Scene_Map);
    overrideMessageWindowRect(Scene_Battle);

    // -------------------------------------------------------------------------
    // HTML Message Window
    // -------------------------------------------------------------------------
    function _msgGetScale() {
        const el = document.getElementById('gameCanvas');
        if (!el) return { sx: 1, sy: 1, ox: 0, oy: 0 };
        const r = el.getBoundingClientRect();
        return { sx: r.width / Graphics.width, sy: r.height / Graphics.height, ox: r.left, oy: r.top };
    }

    function _stripMsgEscapes(text) {
        return (text || '')
            .replace(/\x1b[A-Z]+\[\d*\]/gi, '')
            .replace(/\x1b[{}!><.$|^\\]/gi, '')
            .replace(/\x1b./gi, '');
    }

    // Strip the *full* current message text, memoized on the window so the three
    // regex passes run once per message rather than every frame it's open.
    function _stripFull(win) {
        const t = win._textState ? win._textState.text : '';
        const c = win._htmlMsgFullCache;
        if (c && c.text === t) return c.out;
        const out = _stripMsgEscapes(t);
        win._htmlMsgFullCache = { text: t, out };
        return out;
    }

    const _WM_initialize = Window_Message.prototype.initialize;
    Window_Message.prototype.initialize = function (rect) {
        _WM_initialize.call(this, rect);
        this.visible = false;

        ['html-msg-overlay', 'html-msg-name'].forEach(id => { const o = document.getElementById(id); if (o) o.remove(); });

        const root = document.createElement('div');
        root.id = 'html-msg-overlay';
        this._htmlMsgRoot = root;

        const nameEl = document.createElement('div');
        nameEl.id = 'html-msg-name';
        nameEl.style.transition = 'none'; // no sliding, position is recomputed each frame
        this._htmlMsgName = nameEl;

        const textEl = document.createElement('div');
        textEl.id = 'html-msg-text';
        this._htmlMsgText = textEl;
        root.appendChild(textEl);

        this._htmlMsgHideDelay = 0;

        document.body.appendChild(root);
        document.body.appendChild(nameEl);
    };

    Game_Message.prototype.allText = function () {
        return autoWrapText(this._texts.join(' '));
    };

    const _WM_startMessage = Window_Message.prototype.startMessage;
    Window_Message.prototype.startMessage = function () {
        _WM_startMessage.call(this);
        if (this._htmlMsgRoot) {
            this._htmlMsgRoot.style.display = 'block';
            this._htmlMsgHideDelay  = 0;
            this._htmlMsgPendingHide = false;
            // Don't clear text yet, keep previous text until typewriter starts,
            // so there's no blank flash between consecutive dialogue boxes.
        }
        const scene = SceneManager._scene;
        if (scene && scene._bustManager && !scene._bustManager.exchangeMode) scene._bustManager.showBusts();
    };

    const _WM_terminateMessage = Window_Message.prototype.terminateMessage;
    Window_Message.prototype.terminateMessage = function () {
        if (this._htmlMsgRoot && this._textState) {
            const full = _stripMsgEscapes(this._textState.text);
            this._htmlMsgText.textContent = full;
            this._htmlMsgLastText = full;
        }
        _WM_terminateMessage.call(this);
        if (this._htmlMsgRoot) this._htmlMsgPendingHide = true;
        const scene = SceneManager._scene;
        if (scene && scene._bustManager && scene._bustManager.exchangeMode) {
            advanceNPCExchange();
            return;
        }
        if (scene && scene._bustManager && scene._bustManager.shouldAutoHide()) {
            scene._bustManager.hideBusts();
        }
    };

    const _WM_updatePlacement = Window_Message.prototype.updatePlacement;
    Window_Message.prototype.updatePlacement = function () {
        _WM_updatePlacement.call(this);
        if (this._positionType === 2) this.y += 35;
    };

    const _WM_update = Window_Message.prototype.update;
    Window_Message.prototype.update = function () {
        let preFullText = null;
        if (this._htmlMsgRoot && this._htmlMsgRoot.style.display !== 'none' && this._textState) {
            preFullText = _stripFull(this);
        }

        _WM_update.call(this);
        this.visible = false;

        if (this._htmlMsgPendingHide) {
            this._htmlMsgPendingHide = false;
            this._htmlMsgHideDelay = 2;
        }
        if (this._htmlMsgHideDelay > 0) {
            this._htmlMsgHideDelay--;
            if (this._htmlMsgHideDelay === 0 && !this._textState && this._htmlMsgRoot) {
                this._htmlMsgRoot.style.display = 'none';
                if (this._htmlMsgText) this._htmlMsgText.textContent = '';
                this._htmlMsgLastText = null;
            }
        }

        if (!this._htmlMsgRoot || this._htmlMsgRoot.style.display === 'none') {
            if (this._htmlMsgName) this._htmlMsgName.style.display = 'none';
            return;
        }

        // Canvas rect (getBoundingClientRect forces layout) is recomputed only
        // when the game/window size actually changes, not every frame.
        const gw = Graphics.width, gh = Graphics.height;
        const winW = window.innerWidth, winH = window.innerHeight;
        let scCache = this._htmlMsgScaleCache;
        if (!scCache || scCache.winW !== winW || scCache.winH !== winH || scCache.gw !== gw || scCache.gh !== gh) {
            scCache = this._htmlMsgScaleCache = { winW, winH, gw, gh, sc: _msgGetScale() };
        }
        const sc       = scCache.sc;
        const pad      = this.padding || 12;
        const baseFontSize = (typeof this.standardFontSize === 'function') ? this.standardFontSize() : 29;
        const centeredLeft = sc.ox + (sc.sx * gw / 2) - (this.width * sc.sx) / 2;

        // All the box/name geometry depends only on the scale + this.y/width/
        // height/padding/fontSize; skip the ~12 style writes when none changed.
        const geomSig = sc.sx + ',' + sc.sy + ',' + sc.ox + ',' + sc.oy + ',' +
                        this.width + ',' + this.height + ',' + this.y + ',' + pad + ',' + baseFontSize;
        if (geomSig !== this._htmlMsgGeomSig) {
            this._htmlMsgGeomSig = geomSig;
            const s       = this._htmlMsgRoot.style;
            const scaledW = this.width  * sc.sx;
            const scaledH = this.height * sc.sy;

            s.left    = centeredLeft + 'px';
            s.top     = (sc.oy + this.y * sc.sy) + 'px';
            s.width   = scaledW + 'px';
            s.height  = scaledH + 'px';
            s.padding = Math.round(pad * sc.sy) + 'px ' + Math.round(pad * sc.sx) + 'px';

            this._htmlMsgText.style.fontSize = Math.round(baseFontSize * sc.sy * 0.85) + 'px';
            this._htmlMsgName.style.fontSize = Math.round(20 * sc.sy) + 'px';

            // Name anchored flush above the left edge of the textbox, no animation
            const nameH = Math.round(28 * sc.sy);
            this._htmlMsgName.style.top  = (sc.oy + this.y * sc.sy - nameH - Math.round(6 * sc.sy)) + 'px';
            this._htmlMsgName.style.left = (centeredLeft + Math.round(16 * sc.sx)) + 'px';
        }

        // Text reveal
        let clean = null;
        if (this._textState) {
            const isFast = this._showFast || this._lineShowFast;
            // Re-strip only when the visible slice actually changed (text ident +
            // reveal index; index -1 flags the fast/full path).
            const idx = isFast ? -1 : this._textState.index;
            const rc = this._htmlMsgStripCache;
            let stripped;
            if (rc && rc.text === this._textState.text && rc.index === idx) {
                stripped = rc.out;
            } else {
                stripped = _stripMsgEscapes(isFast ? this._textState.text : this._textState.text.substring(0, this._textState.index));
                this._htmlMsgStripCache = { text: this._textState.text, index: idx, out: stripped };
            }
            clean = stripped;
            // Hold previous text until typewriter writes its first character, avoids blank flash between messages
            if (!isFast && clean === '' && this._htmlMsgLastText) clean = null;
        } else if (preFullText !== null) {
            clean = preFullText;
        }
        if (clean !== null && clean !== this._htmlMsgLastText) {
            this._htmlMsgText.textContent = clean;
            this._htmlMsgLastText = clean;
        }

        // Name: read from BustManager adapter (no separate vn-name-overlay needed)
        const scene = SceneManager._scene;
        const nm    = scene && scene._bustManager && scene._bustManager.nameWindow;
        let name    = (nm && nm._visible) ? (nm._characterName || '') : '';
        if (!name && $gameMessage && typeof $gameMessage.speakerName === 'function') {
            name = $gameMessage.speakerName() || '';
        }

        if (name) {
            this._htmlMsgName.textContent   = name;
            this._htmlMsgName.style.display = 'block';
        } else {
            this._htmlMsgName.style.display = 'none';
        }
    };

    const _WM_destroy = Window_Message.prototype.destroy;
    Window_Message.prototype.destroy = function (options) {
        if (this._htmlMsgRoot && this._htmlMsgRoot.parentNode) this._htmlMsgRoot.parentNode.removeChild(this._htmlMsgRoot);
        if (this._htmlMsgName && this._htmlMsgName.parentNode) this._htmlMsgName.parentNode.removeChild(this._htmlMsgName);
        this._htmlMsgRoot = null;
        this._htmlMsgName = null;
        _WM_destroy.call(this, options);
    };

    // -------------------------------------------------------------------------
    // HTML Choice List
    // -------------------------------------------------------------------------
    const _WCL_initialize = Window_ChoiceList.prototype.initialize;
    Window_ChoiceList.prototype.initialize = function () {
        _WCL_initialize.call(this);
        this.visible = false;
        const old = document.getElementById('html-choice-overlay');
        if (old) old.remove();
        const root = document.createElement('div');
        root.id = 'html-choice-overlay';
        this._htmlChoiceRoot = root;
        document.body.appendChild(root);
    };

    const _WCL_start = Window_ChoiceList.prototype.start;
    Window_ChoiceList.prototype.start = function () {
        _WCL_start.call(this);
        this._htmlChoiceLastIndex = -1;
        if (this._htmlChoiceRoot) {
            this._htmlChoiceRoot.style.display = 'block';
            this._buildChoiceItems();
        }
    };

    Window_ChoiceList.prototype._buildChoiceItems = function () {
        const root = this._htmlChoiceRoot;
        if (!root) return;
        root.innerHTML = '';
        const list = this._list || [];
        const self = this;
        this._htmlChoiceOriginalIndices = [];
        this._htmlChoiceEls = [];

        list.forEach((cmd, i) => {
            if (cmd.hidden) return;
            const enabled = cmd.enabled !== false;
            this._htmlChoiceOriginalIndices.push(i);
            const item = document.createElement('div');
            item.dataset.idx = i;
            item.className   = enabled ? 'html-choice-item' : 'html-choice-item disabled';
            item.style.cursor = enabled ? 'pointer' : 'default';
            item.textContent  = cmd.name;
            if (enabled) {
                item.addEventListener('mouseover', () => { if (self.active && typeof self.select === 'function') self.select(i); });
                item.addEventListener('click',     () => {
                    if (self.active && typeof self.select    === 'function') self.select(i);
                    if (self.active && typeof self.processOk === 'function') self.processOk();
                });
            }
            root.appendChild(item);
            self._htmlChoiceEls.push(item);
        });

        const firstVisible = list.findIndex(cmd => !cmd.hidden);
        if (firstVisible >= 0 && typeof this.select === 'function') this.select(firstVisible);
    };

    // Position choice window above the message window (right-aligned)
    const _WCL_updatePlacement = Window_ChoiceList.prototype.updatePlacement;
    Window_ChoiceList.prototype.updatePlacement = function () {
        _WCL_updatePlacement.call(this);
        const scene  = SceneManager._scene;
        const msgWin = scene ? scene._messageWindow : null;
        if (msgWin) {
            let tx = msgWin.x + msgWin.width - this.width;
            let ty = msgWin.y - this.height - 10;
            if (ty < 10) ty = msgWin.y + msgWin.height + 10;
            this.x = Math.max(10, Math.min(tx, Graphics.boxWidth  - this.width  - 10));
            this.y = Math.max(10, Math.min(ty, Graphics.boxHeight - this.height - 10));
        }
    };

    const _WCL_update = Window_ChoiceList.prototype.update;
    Window_ChoiceList.prototype.update = function () {
        _WCL_update.call(this);
        this.visible = false;
        if (!this._htmlChoiceRoot || this._htmlChoiceRoot.style.display === 'none') return;
        if (!this._htmlChoiceEls || this._htmlChoiceEls.length === 0) return;

        if (this.active) {
            const list      = this._list || [];
            const fullCount = list.length;
            const cur       = this._index >= 0 ? this._index : 0;
            const findNext  = (start, dir) => {
                for (let n = 1; n <= fullCount; n++) {
                    const idx = (start + dir * n + fullCount) % fullCount;
                    if (!list[idx] || (!list[idx].hidden && list[idx].enabled !== false)) return idx;
                }
                return start;
            };
            if (Input.isRepeated('down')) {
                if (typeof this.select === 'function') this.select(findNext(cur, 1));
                if (typeof SoundManager !== 'undefined') SoundManager.playCursor();
            } else if (Input.isRepeated('up')) {
                if (typeof this.select === 'function') this.select(findNext(cur, -1));
                if (typeof SoundManager !== 'undefined') SoundManager.playCursor();
            }
            if      (Input.isTriggered('ok'))     { if (typeof this.processOk     === 'function') this.processOk(); }
            else if (Input.isTriggered('cancel')) { if (typeof this.processCancel === 'function') this.processCancel(); }
        }

        const sc       = _msgGetScale();
        const s        = this._htmlChoiceRoot.style;
        s.left  = (sc.ox + this.x * sc.sx) + 'px';
        s.top   = (sc.oy + this.y * sc.sy) + 'px';
        s.width = (this.width * sc.sx) + 'px';

        const scaledFont = Math.round(((typeof this.standardFontSize === 'function') ? this.standardFontSize() : 26) * sc.sy * 0.85);
        const idx        = this._index >= 0 ? this._index : 0;
        if (this._htmlChoiceOriginalIndices) {
            this._htmlChoiceEls.forEach((el, vi) => {
                el.style.fontSize    = scaledFont + 'px';
                const sel            = this._htmlChoiceOriginalIndices[vi] === idx;
                el.classList.toggle('selected', sel);
            });
        }
    };

    const _WCL_close = Window_ChoiceList.prototype.close;
    Window_ChoiceList.prototype.close = function () {
        _WCL_close.call(this);
        if (this._htmlChoiceRoot) this._htmlChoiceRoot.style.display = 'none';
    };

    const _WCL_destroy = Window_ChoiceList.prototype.destroy;
    Window_ChoiceList.prototype.destroy = function (options) {
        if (this._htmlChoiceRoot && this._htmlChoiceRoot.parentNode) this._htmlChoiceRoot.parentNode.removeChild(this._htmlChoiceRoot);
        this._htmlChoiceRoot = null;
        _WCL_destroy.call(this, options);
    };

    // -------------------------------------------------------------------------
    // Keyword System: ChoiceList
    // -------------------------------------------------------------------------
    if (Utils.RPGMAKER_NAME === "MZ") {
        const _WCL_makeCommandList = Window_ChoiceList.prototype.makeCommandList;
        Window_ChoiceList.prototype.makeCommandList = function () {
            _WCL_makeCommandList.call(this);
            for (let i = 0; i < this._list.length; i++) {
                const cmd = this._list[i];
                let text    = cmd.name;
                let enabled = true;
                const switchMatch = text.match(/^(\d+)\s+(.*)/);
                if (switchMatch) {
                    const switchId = parseInt(switchMatch[1], 10);
                    text = switchMatch[2];
                    if (!$gameSwitches.value(switchId)) enabled = false;
                }
                if (enabled) {
                    const keywords = text.match(/\[([^\]]+)\]/g);
                    if (keywords) {
                        let allKnown = true;
                        keywords.forEach(k => {
                            const kw = k.slice(1, -1);
                            if (!$gameParty.members().some(a => a._keywords && a._keywords.includes(kw))) allKnown = false;
                        });
                        if (!allKnown) { enabled = false; cmd.hidden = true; }
                        else           { text = text.replace(/\[([^\]]+)\]/g, '$1'); }
                    }
                }
                if (!enabled) { cmd.name = cmd.hidden ? '' : '???'; cmd.enabled = false; }
                else          { cmd.name = text; }
            }
        };
    }

    // -------------------------------------------------------------------------
    // Keyword System: learning [Keyword] topics
    // -------------------------------------------------------------------------
    // A line of dialogue can teach several topics at once, and each one is a
    // notification in its own right: they go to the shared popup service, which
    // stacks them, rather than to a message box that would interrupt the very
    // conversation that taught them.
    function announceKeywords(learned) {
        if (!learned.length || !window.ParchmentToast) return;
        const label = T('Dialogue.newTopic');
        window.ParchmentToast.group(learned.map(keyword => () => {
            window.ParchmentToast.show(`${label}: ${keyword}`, {
                severity: 'good',
                duration: 150,
                key: `keyword:${keyword}`
            });
        }));
    }

    // Teach every [Keyword] in `text` to the whole party, and hand back only
    // the ones nobody knew yet, so a topic is announced once and never again.
    function learnKeywords(text) {
        const learned = [];
        const keywordRegex = /\[([^\]]+)\]/g;
        let match;
        while ((match = keywordRegex.exec(text)) !== null) {
            const keyword = match[1];
            let isNew = false;
            $gameParty.members().forEach(actor => {
                if (!actor._keywords) actor._keywords = [];
                if (!actor._keywords.includes(keyword)) {
                    actor._keywords.push(keyword);
                    isNew = true;
                }
            });
            if (isNew && !learned.includes(keyword)) learned.push(keyword);
        }
        return learned;
    }

    // -------------------------------------------------------------------------
    // Keyword System: processMessageBuffer
    // -------------------------------------------------------------------------
    Game_Message.prototype.processMessageBuffer = function () {
        if (!this.messageBuffer || !this.messageBuffer.length) return;

        const scene = typeof SceneManager !== 'undefined' && SceneManager._scene;
        if (scene && scene._bustManager && typeof scene._bustManager.showBusts === 'function') {
            scene._bustManager.showBusts();
        }

        const fullMessage    = this.messageBuffer.join('\n');
        let processedText    = fullMessage;
        if (window.Imported && window.Imported['YEP_MessageCore'] && $gameSystem.wordWrap()) {
            processedText = '<WordWrap>' + processedText;
        }
        const translatedText = window.translateText ? window.translateText(processedText) : processedText;
        this.messageBuffer   = [];

        announceKeywords(learnKeywords(translatedText));

        const wrappedText   = autoWrapText(translatedText);
        const displayedText = wrappedText.replace(/\[([^\]]+)\]/g, '\\C[4]$1\\C[0]');
        displayedText.split('\n').forEach(line => this._texts.push(line));
    };

    if (typeof window.autoWrapText === 'undefined') {
        window.autoWrapText = autoWrapText;
    }

    // -------------------------------------------------------------------------
    // Rumors
    // -------------------------------------------------------------------------
    // What an NPC says when the player talks to them and the event has nothing
    // scripted to say. The line is written, not generated: it comes out of the
    // bank held under the personality NPCSociety dealt that person when they
    // were minted, so a Paranoid shopkeeper and a Sanguine one pass on the same
    // town in two different voices.
    //
    // An event with nobody behind it (a cat, a signpost, a body double in a
    // cutscene) has no society profile to read, and speaks from the generic
    // bank instead, which is also where a personality with no written lines
    // falls back to.

    function rumorPersonalityKey(eventId) {
        if (!eventId || typeof $gameMap === 'undefined') return null;
        const npcName = $gameMap.event(eventId)?.event()?.name;
        if (!npcName) return null;
        const profile = window.NPCSocietyRegistry?.getProfile?.(npcName);
        if (!profile || profile.personalityIndex == null) return null;
        const list = window._NPCSocietyDataLoader?.personalities
                  || window.Health?.PersonalityData?.list
                  || window.Health?.PersonalityData;
        if (!Array.isArray(list)) return null;
        // A personality's English `name` in PersonalityData.json is its id, and
        // the bank is keyed by that id in lower case.
        const name = list[profile.personalityIndex]?.name;
        return name ? String(name).toLowerCase() : null;
    }

    function pickRumor(personalityKey) {
        const key = personalityKey ? `Rumors.personality.${personalityKey}` : null;
        let pool = (key && T.has(key)) ? T.pool(key) : [];
        if (!pool.length) pool = T.pool('Rumors.generic');
        if (!pool.length) return '';
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // -------------------------------------------------------------------------
    // NPC Exchange: a two-line VN beat played out on the map
    // -------------------------------------------------------------------------
    // A short player-line/NPC-line exchange, shown one bust at a time through
    // the same right-side slot showCustomBust already uses, alternating between
    // the speaking party member and the NPC. Driven from terminateMessage
    // (see above) rather than the interpreter's own command list, so it works
    // from a single plugin command call instead of two authored "Show Text"
    // commands.
    let _npcExchangeQueue = [];

    function advanceNPCExchange() {
        const scene = SceneManager._scene;
        const bm    = scene && scene._bustManager;
        if (!bm) { _npcExchangeQueue = []; return; }
        if (!_npcExchangeQueue.length) {
            bm.exchangeMode      = false;
            bm.batchDialogueMode = false;
            bm.hideBusts();
            return;
        }
        const step = _npcExchangeQueue.shift();
        bm.showCustomBust(step.imageName, step.displayName);
        $gameMessage.setBackground(0);
        $gameMessage.setPositionType(2);
        window.skipLocalization = true;
        $gameMessage.add(step.text);
        window.skipLocalization = false;
    }

    function startNPCExchange(steps) {
        const scene = SceneManager._scene;
        const bm    = scene && scene._bustManager;
        if (!bm || !steps || !steps.length) return false;
        bm.exchangeMode      = true;
        bm.batchDialogueMode = true;
        _npcExchangeQueue    = steps.slice();
        advanceNPCExchange();
        return true;
    }

    // The bust image an NPC event shows normally (same resolution showBusts()
    // would use), read out manually since exchangeMode skips that call.
    function _npcExchangeBust(ev) {
        const scene = SceneManager._scene;
        const bm    = scene && scene._bustManager;
        const data  = ev?.event?.();
        const page  = data?.pages?.find(p => ev.meetsConditions(p));
        const path  = bm ? bm.getBustImageForCharacter(page?.image?.characterName, page?.image?.characterIndex ?? 0) : null;
        return path ? path.replace(/^busts\//, '') : '7';
    }

    // A short, personality-flavoured beat between the party leader and an NPC,
    // picking one random action out of the same catalogue the Empathize panel's
    // Socialize submenu offers (praise, small talk, comment on weather, insult,
    // threaten, ...) and running it through the same tone/delta/personality
    // math _socialInteract uses (window.NPCEmpathize._helpers), so it reads as
    // the same system whether or not the panel was ever opened. Returns two
    // exchange steps (player line, then NPC line) or null if the pieces needed
    // aren't available.
    function buildSocialExchange(ev, npcName, profile) {
        const EM = window.NPCEmpathize;
        const H  = EM && EM._helpers;
        if (!H || !H._socialLines || !H._rand) return null;

        const actor   = $gameParty.leader();
        const actorId = actor && actor.actorId();
        // A beast at the head of the party has no prose to trade, only the
        // feral bank the old rumour path already knows how to read from.
        if (H._isNonSentientActor && H._isNonSentientActor(actor)) return null;
        const db          = H._socialLines();
        const interactions = db.interactions || [];
        if (!interactions.length) return null;
        const def = interactions[Math.floor(Math.random() * interactions.length)];

        const fill       = s => String(s || '').replace(/\{name\}/g, npcName);
        const playerLine = fill(H._rand(def.player));
        if (!playerLine) return null;

        const mult   = tone => H._personalitySocialMult ? H._personalitySocialMult(profile, tone) : 1;
        const recent = H._countRecentInteractions ? H._countRecentInteractions(profile, 'social_' + def.id, 3) : 0;
        let delta, sincere;
        if (def.tone === 'positive') {
            delta = def.baseDelta - recent * Math.max(2, Math.ceil(def.baseDelta / 2.5));
            delta = Math.round(delta * mult('positive'));
            sincere = delta > 0;
            if (!sincere) delta = -Math.min(8, 2 + recent * 2);
        } else if (def.tone === 'neutral') {
            delta   = Math.max(0, (def.baseDelta || 1) - recent);
            delta   = Math.round(delta * mult('neutral'));
            sincere = delta > 0;
        } else { // negative
            delta   = def.baseDelta - Math.min(6, Math.max(0, recent - 1) * 2);
            delta   = Math.round(delta * mult('negative'));
            sincere = false;
        }
        // Dialogue mode option: markovian sources the NPC's half of the
        // exchange from their own Markov word bank instead of the templated
        // Socialize response pools below. The player's line, the busts and the
        // opinion math are unaffected either way. Falls through to the usual
        // banks if the NPC has no Markov database of their own.
        let npcLine;
        if (ConfigManager.dialogueMode === 'markovian') {
            npcLine = window.MarkovNPCDialogue?.generateLine?.(npcName) || '';
        }
        // Gossip's own payoff is a teaser ("Well, since you asked...") with
        // nothing to actually tell: when it lands, the real content comes out
        // of the Rumors bank (same personality-keyed pools the old Rumors
        // command read from), tacked on after the teaser.
        if (!npcLine && def.id === 'gossip' && sincere) {
            const teaser = fill(H._rand(def.responseGood));
            const rumor  = pickRumor(rumorPersonalityKey(ev.eventId()));
            npcLine = rumor ? (teaser ? `${teaser} ${rumor}` : rumor) : teaser;
        }
        if (!npcLine) {
            const pool = def.tone === 'negative' ? def.responseBad : (sincere ? def.responseGood : def.responseBad);
            npcLine = fill(H._rand(pool)) || fill(H._rand(def.responseGood)) || fill(H._rand(def.responseBad));
        }
        if (!npcLine) return null;

        if (profile && actorId != null && H._addNpcOpinion) {
            H._addNpcOpinion(profile, actorId, delta);
            (profile.eventLog ??= []).push({
                tag: 'social_' + def.id, desc: `${def.id} (${delta >= 0 ? '+' : ''}${delta})`, // i18n-ignore: event-log record id
                timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
            });
        }

        EM.recordNPCLine?.(npcName, playerLine, 'player');
        EM.recordNPCLine?.(npcName, npcLine, 'npc');

        const scene           = SceneManager._scene;
        const bm              = scene && scene._bustManager;
        const playerBustFull  = H._resolveBustForActor ? H._resolveBustForActor(actor) : 'img/busts/7.png';
        const playerImageName = String(playerBustFull).replace(/^img\/busts\//, '').replace(/\.png$/, '');
        const npcDisplayName  = bm ? bm.getCharacterDisplayName(ev.eventId()) : npcName;

        return [
            { imageName: playerImageName,        displayName: actor ? actor.name() : '', text: playerLine },
            { imageName: _npcExchangeBust(ev),    displayName: npcDisplayName,            text: npcLine },
        ];
    }

    // -------------------------------------------------------------------------
    // Plugin Commands
    // -------------------------------------------------------------------------
    PluginManager.registerCommand(PLUGIN_NAME, "showBust", () => {
        const scene = SceneManager._scene;
        if (scene && scene._bustManager) scene._bustManager.showBusts();
    });

    PluginManager.registerCommand(PLUGIN_NAME, "hideBusts", () => {
        const scene = SceneManager._scene;
        if (scene && scene._bustManager) scene._bustManager.hideBusts();
    });

    PluginManager.registerCommand(PLUGIN_NAME, "batchDialogue", () => {
        const scene = SceneManager._scene;
        if (scene && scene._bustManager) scene._bustManager.enableBatchDialogue();
    });

    PluginManager.registerCommand(PLUGIN_NAME, "playerBatchDialogue", () => {
        // Reserved for player-specific bust display
    });

    PluginManager.registerCommand(PLUGIN_NAME, "Rumors", function () {
        const evId = this._eventId;
        const ev   = evId ? $gameMap.event(evId) : null;
        if (ev) ev.turnTowardPlayer();

        const npcName = ev?.event()?.name || null;
        const EM      = window.NPCEmpathize;

        // For now, talking to any sentient NPC with a society profile plays out
        // a random Socialize action (the same catalogue the Empathize panel
        // offers: praise, small talk, comment on weather, insult, ...) instead
        // of the flat environmental rumour, using the same personality-driven
        // line banks and opinion math the panel's Socialize actions use, even
        // though the panel itself was never opened.
        const profile  = npcName ? window.NPCSocietyRegistry?.getProfile?.(npcName) : null;
        const sentient = !!(profile && profile.personalityIndex != null && !EM?.isNonSentientNPC?.(npcName));
        if (sentient && EM && ev) {
            const steps = buildSocialExchange(ev, npcName, profile);
            if (steps && startNPCExchange(steps)) {
                this.setWaitMode('message');
                return;
            }
        }

        // No society profile to draw a Socialize action from (a beast, a
        // signpost, an unregistered body double): the old flavour-line rumour.
        let line = pickRumor(rumorPersonalityKey(evId));
        if (!line) return;

        // A non-sentient creature has no words, only a noise as long as the line
        // it would have spoken, and whatever it says is kept on its profile so
        // the Empathize panel shows the same history the message box did.
        if (npcName && EM?.isNonSentientNPC?.(npcName)) line = EM.growlFor(line) || line;
        if (npcName) EM?.recordNPCLine?.(npcName, line);

        $gameMessage.setBackground(0);
        $gameMessage.setPositionType(2);
        // The bank is already in the player's language; the string-for-string
        // translation pass would only try to match it again.
        window.skipLocalization = true;
        $gameMessage.add(line);
        window.skipLocalization = false;
        this.setWaitMode('message');
    });

    PluginManager.registerCommand(PLUGIN_NAME, "showCustomBust", (args) => {
        const scene = SceneManager._scene;
        if (scene && scene._bustManager) scene._bustManager.showCustomBust(args.imageName, args.characterName);
    });

})();
