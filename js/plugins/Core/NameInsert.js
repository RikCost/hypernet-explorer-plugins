/*:
 * @plugindesc Custom Elegant Name Input Screen with Virtual Touch Keyboard and Manual Typing Support
 * @author Omni-Lex
 *
 * @target MZ
 *
 * @help NameInsert.js
 *
 * This plugin replaces the default, basic RPG Maker MZ name input screen
 * with a high-fidelity, alchemical dark-neon themed HTML overlay screen.
 *
 * Features:
 * - Touch-friendly Virtual Keyboard.
 * - Dynamic symbol/letter switching (UPPERCASE, lowercase, SYMBOLS).
 * - Full manual typing support via physical keyboard.
 * - Glassmorphic, neon cyber-alchemical aesthetic.
 */

(() => {
    const pluginName = "NameInsert";

    // A name may be up to 16 characters. Name Input Processing events still ask for the
    // engine default of 8, so the length is set here rather than in event data.
    const NAME_MAX_LENGTH = 16;

    // Keyboard layouts mapping
    const KEYBOARD_LAYOUTS = {
        uppercase: [
            ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
            ["A", "S", "D", "F", "G", "H", "J", "K", "L", "_"],
            ["Z", "X", "C", "V", "B", "N", "M", "-", "'", "."],
            ["SPACE", "BACKSPACE"]
        ],
        lowercase: [
            ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
            ["a", "s", "d", "f", "g", "h", "j", "k", "l", "_"],
            ["z", "x", "c", "v", "b", "n", "m", "-", "'", "."],
            ["SPACE", "BACKSPACE"]
        ],
        symbols: [
            ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
            ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
            ["+", "=", "[", "]", "{", "}", ";", ":", ",", "/"],
            ["SPACE", "BACKSPACE"]
        ]
    };

    // Override Scene_Name completely to implement our elegant view
    Scene_Name.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_Name.prototype.prepare = function(actorId, maxLength) {
        this._actorId = actorId;
        this._maxLength = NAME_MAX_LENGTH;
    };

    Scene_Name.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this._actor = $gameActors.actor(this._actorId);
        
        // Create dummy standard windows to maintain compatibility with other plugins
        this.createEditWindow();
        this.createInputWindow();
        this._editWindow.hide();
        this._editWindow.deactivate();
        this._inputWindow.hide();
        this._inputWindow.deactivate();

        // Create our custom elegant HTML Name Input screen
        this.createHtmlNameInput();
    };

    Scene_Name.prototype.start = function() {
        Scene_MenuBase.prototype.start.call(this);
        // Override default input window refresh
    };

    Scene_Name.prototype.terminate = function() {
        this.removeHtmlNameInput();
        Scene_MenuBase.prototype.terminate.call(this);
    };

    Scene_Name.prototype.createHtmlNameInput = function() {
        // 1. Create outer wrapper overlay
        this._htmlContainer = document.createElement("div");
        this._htmlContainer.id = "soul-registration-overlay";
        this._htmlContainer.style.position = "absolute";
        this._htmlContainer.style.top = "0";
        this._htmlContainer.style.left = "0";
        this._htmlContainer.style.width = "100%";
        this._htmlContainer.style.height = "100%";
        this._htmlContainer.style.zIndex = "10000";
        this._htmlContainer.style.display = "flex";
        this._htmlContainer.style.alignItems = "center";
        this._htmlContainer.style.justifyContent = "center";
        this._htmlContainer.style.background = "rgba(6, 8, 12, 0.88)";
        this._htmlContainer.style.backdropFilter = "blur(12px)";
        this._htmlContainer.style.webkitBackdropFilter = "blur(12px)";

        // Stop all event propagation so key/touch events do not interact with RPG Maker under the overlay
        const stopPropagation = e => e.stopPropagation();
        this._htmlContainer.addEventListener('mousedown', stopPropagation);
        this._htmlContainer.addEventListener('mouseup', stopPropagation);
        this._htmlContainer.addEventListener('mousemove', stopPropagation);
        this._htmlContainer.addEventListener('click', stopPropagation);
        this._htmlContainer.addEventListener('touchstart', stopPropagation);
        this._htmlContainer.addEventListener('touchend', stopPropagation);
        this._htmlContainer.addEventListener('touchmove', stopPropagation);
        this._htmlContainer.addEventListener('keydown', stopPropagation);
        this._htmlContainer.addEventListener('keyup', stopPropagation);
        this._htmlContainer.addEventListener('keypress', stopPropagation);

        // Gather necessary data from RPG Maker Actor
        const actor = this._actor;
        const actorIdStr = String(actor.actorId()).padStart(2, '0');
        const faceName = actor.faceName();
        const faceIndex = actor.faceIndex();
        const origName = actor.name();
        const maxLen = this._maxLength;
        const className = actor.currentClass() ? actor.currentClass().name : "Novice";

        // Escape actor-supplied strings before injecting into innerHTML.
        const escapeHtml = str => String(str ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[c]);

        // 4. Construct inner HTML tree
        this._htmlContainer.innerHTML = `
          <div class="soul-reg-container">
            <div class="soul-reg-left">
              <div class="actor-face-wrapper">
                <div class="actor-face-image" id="actor-face-img" style="background-image: url('img/busts/${escapeHtml(faceName)}.png'); background-size: 220%; background-position: 50% 12%; background-repeat: no-repeat;"></div>
              </div>
              <div class="actor-info-box">
                <div class="actor-name-lbl" id="actor-orig-name">${escapeHtml(origName)}</div>
                <div class="actor-class-lbl" id="actor-class">${escapeHtml(className)}</div>
                <div class="actor-meta-list">
                  <div class="actor-meta-item"><span>${T('NameInsert.ui.soulIndex')}</span> <span>ACTOR_${actorIdStr}</span></div>
                  <div class="actor-meta-item"><span>${T('NameInsert.ui.cognition')}</span> <span>100%</span></div>
                  <div class="actor-meta-item"><span>${T('NameInsert.ui.matrix')}</span> <span class="neon-text-green">${T('NameInsert.ui.stable')}</span></div>
                </div>
              </div>
            </div>
            <div class="soul-reg-right">
              <div class="input-header">
                <span class="input-header-title">${T('NameInsert.ui.synchronizeIdentity')}</span>
                <span class="char-count" id="char-counter">0 / ${maxLen}</span>
              </div>
              <div class="input-wrapper">
                <div class="input-bracket-left">[</div>
                <input type="text" id="soul-name-input" class="soul-name-input" maxlength="${maxLen}" autocomplete="off" spellcheck="false" placeholder="${T('NameInsert.placeholder')}">
                <div class="input-bracket-right">]</div>
              </div>
              
              <div class="keyboard-tabs">
                <button class="kbd-tab active" id="tab-uppercase" data-layout="uppercase">${T('NameInsert.ui.uppercase')}</button>
                <button class="kbd-tab" id="tab-lowercase" data-layout="lowercase">${T('NameInsert.ui.lowercase')}</button>
                <button class="kbd-tab" id="tab-symbols" data-layout="symbols">${T('NameInsert.ui.symbols')}</button>
              </div>
              
              <div class="keyboard-grid" id="kbd-grid">
                <!-- Keys generated dynamically by JS -->
              </div>
              
              <div class="action-buttons">
                <button class="action-btn btn-cancel" id="btn-cancel">${T('NameInsert.ui.abort')}</button>
                <button class="action-btn btn-default" id="btn-default">${T('NameInsert.ui.default')}</button>
                <button class="action-btn btn-confirm" id="btn-confirm">${T('NameInsert.ui.confirm')}</button>
              </div>
            </div>
          </div>
        `;

        document.body.appendChild(this._htmlContainer);

        // Bind interactive event handlers
        this.setupHtmlEventHandlers();
        
        // Initialize name input field with original actor name and focus it
        const nameInput = document.getElementById("soul-name-input");
        nameInput.value = origName;
        nameInput.focus();
        this.updateCharCounter();
        
        // Generate the initial virtual keyboard keys grid (UPPERCASE)
        this._currentLayout = "uppercase";
        this.generateKeyboardGrid();
    };

    Scene_Name.prototype.setupHtmlEventHandlers = function() {
        const nameInput = document.getElementById("soul-name-input");
        
        // Real keyboard input event
        nameInput.addEventListener("input", () => {
            if (nameInput.value.length > this._maxLength) {
                nameInput.value = nameInput.value.slice(0, this._maxLength);
            }
            this.updateCharCounter();
        });

        // Enter confirms, Escape cancels (key events never bubble past the
        // container, so these must be handled on the input itself)
        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                SoundManager.playOk();
                this.onInputOk();
            } else if (e.key === "Escape") {
                e.preventDefault();
                SoundManager.playCancel();
                this.onInputCancel();
            }
        });

        // Retain input focus automatically to allow continuous keyboard typing
        nameInput.addEventListener("blur", () => {
            setTimeout(() => {
                if (document.getElementById("soul-name-input")) {
                    nameInput.focus();
                }
            }, 100);
        });

        // Tabs to switch keyboard layout categories
        const tabs = ["tab-uppercase", "tab-lowercase", "tab-symbols"];
        tabs.forEach(tabId => {
            const tabEl = document.getElementById(tabId);
            if (tabEl) {
                tabEl.addEventListener("click", (e) => {
                    SoundManager.playCursor();
                    tabs.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.classList.remove("active");
                    });
                    tabEl.classList.add("active");
                    this._currentLayout = tabEl.dataset.layout;
                    this.generateKeyboardGrid();
                });
            }
        });

        // Control Buttons
        const btnCancel = document.getElementById("btn-cancel");
        if (btnCancel) {
            btnCancel.addEventListener("click", () => {
                SoundManager.playCancel();
                this.onInputCancel();
            });
        }

        const btnDefault = document.getElementById("btn-default");
        if (btnDefault) {
            btnDefault.addEventListener("click", () => {
                SoundManager.playCursor();
                nameInput.value = this._actor.name();
                nameInput.focus();
                this.updateCharCounter();
            });
        }

        const btnConfirm = document.getElementById("btn-confirm");
        if (btnConfirm) {
            btnConfirm.addEventListener("click", () => {
                SoundManager.playOk();
                this.onInputOk();
            });
        }
    };

    Scene_Name.prototype.updateCharCounter = function() {
        const nameInput = document.getElementById("soul-name-input");
        const charCounter = document.getElementById("char-counter");
        if (nameInput && charCounter) {
            charCounter.textContent = `${nameInput.value.length} / ${this._maxLength}`;
        }
    };

    Scene_Name.prototype.generateKeyboardGrid = function() {
        const gridEl = document.getElementById("kbd-grid");
        if (!gridEl) return;
        
        gridEl.innerHTML = "";
        const nameInput = document.getElementById("soul-name-input");
        const layout = KEYBOARD_LAYOUTS[this._currentLayout];
        
        layout.forEach(row => {
            row.forEach(key => {
                const btn = document.createElement("button");
                btn.className = "kbd-key";
                btn.textContent = key;
                
                if (key === "SPACE") {
                    btn.classList.add("key-wide");
                    btn.addEventListener("click", () => {
                        if (nameInput.value.length < this._maxLength) {
                            SoundManager.playCursor();
                            nameInput.value += " ";
                            nameInput.focus();
                            this.updateCharCounter();
                        }
                    });
                } else if (key === "BACKSPACE") {
                    btn.classList.add("key-wide", "key-backspace");
                    btn.innerHTML = `<span style="font-size: 0.8rem; letter-spacing: 1.5px; text-transform: uppercase;">${T('NameInsert.ui.backspace')}</span>`;
                    btn.addEventListener("click", () => {
                        SoundManager.playCancel();
                        nameInput.value = nameInput.value.slice(0, -1);
                        nameInput.focus();
                        this.updateCharCounter();
                    });
                } else {
                    btn.addEventListener("click", () => {
                        if (nameInput.value.length < this._maxLength) {
                            SoundManager.playCursor();
                            nameInput.value += key;
                            nameInput.focus();
                            this.updateCharCounter();
                        }
                    });
                }
                
                gridEl.appendChild(btn);
            });
        });
    };

    Scene_Name.prototype.removeHtmlNameInput = function() {
        if (this._htmlContainer && this._htmlContainer.parentNode) {
            this._htmlContainer.parentNode.removeChild(this._htmlContainer);
            this._htmlContainer = null;
        }
    };

    Scene_Name.prototype.onInputOk = function() {
        const nameInput = document.getElementById("soul-name-input");
        const newName = nameInput ? nameInput.value.trim() : "";
        if (newName.length > 0) {
            this._actor.setName(newName);
        }
        this.removeHtmlNameInput();
        this.popScene();
    };

    Scene_Name.prototype.onInputCancel = function() {
        this.removeHtmlNameInput();
        this.popScene();
    };

    // Controller support: A confirms the typed/default name, B cancels.
    // Keyboard Enter/Esc are handled on the input element and stopped at the
    // container, so the Input API only ever sees the gamepad here.
    const _Scene_Name_update = Scene_Name.prototype.update;
    Scene_Name.prototype.update = function() {
        _Scene_Name_update.call(this);
        if (!this._htmlContainer) return;
        if (this._padOpenFrame === undefined) this._padOpenFrame = Graphics.frameCount;
        if (Graphics.frameCount - this._padOpenFrame < 10) return; // swallow opening press
        if (Input.isTriggered("ok")) {
            SoundManager.playOk();
            this.onInputOk();
        } else if (Input.isTriggered("cancel")) {
            SoundManager.playCancel();
            this.onInputCancel();
        }
    };
})();