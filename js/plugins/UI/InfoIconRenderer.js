/*:
 * @target MZ
 * @plugindesc Handles rendering for the Info icon sprite (16-frame animation).
 * @author Omni-Lex
 *
 * @help InfoIconRenderer.js
 *
 * This plugin specifically handles events that have a comment "Info" in 
 * their event commands. It will replace their graphic with 
 * img/characters/Objects/info.png and play the 16-frame animation.
 *
 * The sprite sheet is expected to be 864x54 (16 frames of 54x54).
 */

(() => {
    const PLUGIN_NAME = "InfoIconRenderer";
    const INFO_SPRITE_PATH = "Objects/info";
    const TOTAL_FRAMES = 16;
    const FRAME_WIDTH = 54;
    const FRAME_HEIGHT = 54;

    // --- Data Management ---

    // Safe-guard to prevent crashes on dynamic/erased events whose data is not in $dataMap.events
    const _Game_Event_event = Game_Event.prototype.event;
    Game_Event.prototype.event = function() {
        if ($dataMap && $dataMap.events) {
            const ev = _Game_Event_event.call(this);
            if (ev) return ev;
        }
        return { pages: [], name: "", note: "", meta: {} };
    };

    const _Game_Event_setupPage = Game_Event.prototype.setupPage;
    Game_Event.prototype.setupPage = function() {
        _Game_Event_setupPage.call(this);
        this._isInfoIcon = false;
        this.checkInfoComment();
    };

    Game_Event.prototype.checkInfoComment = function() {
        if (!this.page()) return;
        const list = this.list();
        if (list) {
            for (const command of list) {
                if (command.code === 108 || command.code === 408) {
                    const comment = command.parameters[0].trim();
                    if (/^info$/i.test(comment)) {
                        this._isInfoIcon = true;
                        this.setInfoGraphic();
                        break;
                    }
                }
            }
        }
    };

    Game_Event.prototype.setInfoGraphic = function() {
        this.setImage(INFO_SPRITE_PATH, 0);
        this.setStepAnime(true);
        this.setDirection(2); // Face down
        this._isInfoIcon = true;
    };

    Game_Event.prototype.isInfoIcon = function() {
        return !!this._isInfoIcon;
    };

    // --- Sprite Handling ---

    const _Sprite_Character_updateCharacterFrame = Sprite_Character.prototype.updateCharacterFrame;
    Sprite_Character.prototype.updateCharacterFrame = function() {
        if (this._character instanceof Game_Event && this._character.isInfoIcon()) {
            this.updateInfoFrame();
        } else {
            _Sprite_Character_updateCharacterFrame.call(this);
        }
    };

    Sprite_Character.prototype.updateInfoFrame = function() {
        const pw = FRAME_WIDTH;
        const ph = FRAME_HEIGHT;
        const sx = this.infoCharacterPatternX() * pw;
        const sy = 0;
        this.setFrame(sx, sy, pw, ph);
    };

    Sprite_Character.prototype.infoCharacterPatternX = function() {
        // We use a fixed speed for the info icon animation (e.g., 4 frames per animation frame)
        // This makes it independent of move speed and standard pattern resets
        if (!this._character._infoAnimationCount) this._character._infoAnimationCount = 0;
        const count = this._character._infoAnimationCount;
        const pattern = Math.floor(count / 4) % TOTAL_FRAMES;
        return pattern;
    };

    // Ensure animation count ticks even if not moving or stepping
    const _Game_Event_update = Game_Event.prototype.update;
    Game_Event.prototype.update = function() {
        _Game_Event_update.call(this);
        if (this.isInfoIcon()) {
            if (!this._infoAnimationCount) this._infoAnimationCount = 0;
            this._infoAnimationCount++;
        }
    };



})();
