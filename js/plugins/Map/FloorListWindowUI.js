/*:
 * @target MZ
 * @plugindesc v1.0.0 Parchment DOM overlay for the FloorListWindow floor selector.
 * @author OmniLex
 * @help
 * === FloorListWindow UI v1.0.0 ===
 *
 * UI layer for FloorListWindow.js. Renders the elevator floor list as a
 * parchment army-dialog choice popup following the unified D&D pockets
 * design language, with full keyboard / controller / mouse support.
 *
 * Must be placed AFTER Map/FloorListWindow in the plugin manager.
 * Requires css/theme.css (.army-dialog-overlay / .army-dialog /
 * .army-dialog-options--scroll / .army-dialog-btn--row / --disabled).
 */

(function () {
    "use strict";

    if (!window.FloorListData || !window.Scene_FloorList) {
        throw new Error("FloorListWindowUI.js requires FloorListWindow.js!");
    }

    const FloorListData  = window.FloorListData;
    const Scene_FloorList = window.Scene_FloorList;

    //=========================================================================
    // FloorListInputManager
    //=========================================================================

    const FloorListInputManager = {
        _scene: null,
        _active: false,
        _openedFrame: 0,
        _wasdInput: { up: false, down: false },
        _wasdHeld: { up: false, down: false },
        _wasdHoldFrames: { up: 0, down: 0 },

        activate(scene) {
            this._scene = scene;
            this._active = true;
            this._openedFrame = Graphics.frameCount;
            this._wasdInput.up = this._wasdInput.down = false;
            this._wasdHeld.up = this._wasdHeld.down = false;
            this._wasdHoldFrames.up = this._wasdHoldFrames.down = 0;
        },

        deactivate() {
            this._active = false;
            this._scene = null;
        },

        update() {
            if (!this._active || !this._scene) return;
            const scene = this._scene;
            if (!scene._floorListEl) return;
            // Swallow the key press that opened the scene
            if (Graphics.frameCount - this._openedFrame < 4) return;

            // WASD hold-repeat simulation (matches MZ key-repeat timing)
            for (const dir of ["up", "down"]) {
                if (this._wasdHeld[dir]) {
                    this._wasdHoldFrames[dir]++;
                    const held = this._wasdHoldFrames[dir];
                    if (held > Input.keyRepeatWait && (held - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
                        this._wasdInput[dir] = true;
                    }
                } else {
                    this._wasdHoldFrames[dir] = 0;
                }
            }

            const isUp = Input.isRepeated("up") || this._wasdInput.up;
            const isDown = Input.isRepeated("down") || this._wasdInput.down;
            this._wasdInput.up = this._wasdInput.down = false;

            if (isUp) {
                scene._moveFloorSelection(-1);
                return;
            }
            if (isDown) {
                scene._moveFloorSelection(1);
                return;
            }
            if (Input.isTriggered("ok")) {
                scene._confirmFloorSelection();
                return;
            }
            if (Input.isTriggered("escape") || Input.isTriggered("cancel") || TouchInput.isCancelled()) {
                SoundManager.playCancel();
                scene.popScene();
            }
        },
    };

    //=========================================================================
    // Scene_FloorList, DOM lifecycle
    //=========================================================================

    const _Scene_FloorList_create = Scene_FloorList.prototype.create;
    Scene_FloorList.prototype.create = function () {
        _Scene_FloorList_create.call(this);

        this._wasdListener = (event) => {
            if (event.repeat) return;
            const key = event.key.toLowerCase();
            if (key === "w") { FloorListInputManager._wasdInput.up = true; FloorListInputManager._wasdHeld.up = true; event.preventDefault(); }
            if (key === "s") { FloorListInputManager._wasdInput.down = true; FloorListInputManager._wasdHeld.down = true; event.preventDefault(); }
        };
        this._wasdUpListener = (event) => {
            const key = event.key.toLowerCase();
            if (key === "w") { FloorListInputManager._wasdHeld.up = false; FloorListInputManager._wasdHoldFrames.up = 0; }
            if (key === "s") { FloorListInputManager._wasdHeld.down = false; FloorListInputManager._wasdHoldFrames.down = 0; }
        };
        window.addEventListener("keydown", this._wasdListener);
        window.addEventListener("keyup", this._wasdUpListener);

        this._floorItems = FloorListData.buildItemList();
        this._selectedIndex = FloorListData.initialIndex
            ? FloorListData.initialIndex(this._floorItems)
            : this._firstEnabledIndex();

        const el = document.createElement("div");
        el.id = "floorlist-container";
        el.className = "army-dialog-overlay";
        el.style.opacity = "0";
        el.style.transition = "opacity 0.22s ease-out";
        document.body.appendChild(el);
        this._floorListEl = el;

        this._refreshFloorListDOM();
        FloorListInputManager.activate(this);
        setTimeout(() => {
            if (this._floorListEl) this._floorListEl.style.opacity = "1";
        }, 16);

        // Swap in proper map display names once loaded
        FloorListData.loadDisplayNames(this._floorItems, () => {
            if (this._floorListEl) this._refreshFloorListDOM();
        });
    };

    Scene_FloorList.prototype.update = function () {
        Scene_MenuBase.prototype.update.call(this);
        FloorListInputManager.update();
    };

    Scene_FloorList.prototype.terminate = function () {
        if (this._wasdListener) {
            window.removeEventListener("keydown", this._wasdListener);
            window.removeEventListener("keyup", this._wasdUpListener);
            this._wasdListener = null;
            this._wasdUpListener = null;
        }
        FloorListInputManager.deactivate();
        if (this._floorListEl) {
            const el = this._floorListEl;
            this._floorListEl = null;
            el.style.transition = "opacity 0.2s ease-out";
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 200);
        }
        Scene_MenuBase.prototype.terminate.call(this);
    };

    //=========================================================================
    // Scene_FloorList, rendering & selection
    //=========================================================================

    Scene_FloorList.prototype._firstEnabledIndex = function () {
        const idx = this._floorItems.findIndex(item => FloorListData.isEnabled(item));
        return idx >= 0 ? idx : 0;
    };

    Scene_FloorList.prototype._refreshFloorListDOM = function () {
        if (!this._floorListEl) return;
        const optionsHTML = this._floorItems
            .map((item, i) => {
                const enabled = FloorListData.isEnabled(item);
                const classes = [
                    "army-dialog-btn",
                    "army-dialog-btn--row",
                    enabled ? "" : "army-dialog-btn--disabled",
                    i === this._selectedIndex && enabled ? "selected" : "",
                ].filter(Boolean).join(" ");
                const label = window.translateText ? window.translateText(item.label) : item.label;
                return `<div class="${classes}" data-idx="${i}">${label}</div>`;
            })
            .join("");
        this._floorListEl.innerHTML = `
            <div class="army-dialog">
                <h3>${FloorListData.text("title")}</h3>
                <div class="army-dialog-options army-dialog-options--scroll">${optionsHTML}</div>
            </div>`;
        this._floorListEl.querySelectorAll(".army-dialog-btn").forEach((btn) => {
            const i = Number(btn.dataset.idx);
            btn.addEventListener("click", () => {
                if (!FloorListData.isEnabled(this._floorItems[i])) return;
                this._selectedIndex = i;
                this._confirmFloorSelection();
            });
            btn.addEventListener("mouseenter", () => {
                // Hover steers only while the mouse is what is moving. This list
                // scrolls its selection into view (_scrollSelectionIntoView), so
                // stepping it with a pad slides a different floor under a resting
                // pointer and used to snap the choice back to it
                // (PointerSteering, Core/AnalogStickInput.js).
                if (window.PointerSteering && !window.PointerSteering.isSteering()) return;
                if (this._selectedIndex !== i && FloorListData.isEnabled(this._floorItems[i])) {
                    this._selectedIndex = i;
                    this._updateFloorListHighlight();
                }
            });
        });
        this._scrollSelectionIntoView();
    };

    Scene_FloorList.prototype._updateFloorListHighlight = function () {
        if (!this._floorListEl) return;
        this._floorListEl.querySelectorAll(".army-dialog-btn").forEach((btn) => {
            btn.classList.toggle("selected", Number(btn.dataset.idx) === this._selectedIndex);
        });
        this._scrollSelectionIntoView();
    };

    Scene_FloorList.prototype._scrollSelectionIntoView = function () {
        if (!this._floorListEl) return;
        const sel = this._floorListEl.querySelector(".army-dialog-btn.selected");
        if (sel) sel.scrollIntoView({ block: "nearest" });
    };

    // Moves the cursor up/down, skipping disabled "???" entries, with wrap
    Scene_FloorList.prototype._moveFloorSelection = function (dir) {
        const total = this._floorItems.length;
        let idx = this._selectedIndex;
        for (let n = 0; n < total; n++) {
            idx = (idx + dir + total) % total;
            if (FloorListData.isEnabled(this._floorItems[idx])) {
                if (idx !== this._selectedIndex) {
                    this._selectedIndex = idx;
                    SoundManager.playCursor();
                    this._updateFloorListHighlight();
                }
                return;
            }
        }
    };

    Scene_FloorList.prototype._confirmFloorSelection = function () {
        const item = this._floorItems[this._selectedIndex];
        if (!item || !FloorListData.isEnabled(item)) {
            SoundManager.playBuzzer();
            return;
        }
        SoundManager.playOk();
        FloorListData.applySelection(item);
        this.popScene();
    };
})();
