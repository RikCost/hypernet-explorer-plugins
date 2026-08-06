//=============================================================================
// HelpMenu.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Adds a gorgeous D&D parchment Help/Codex system with dynamic tabs.
 * @author Omni-Lex
 * @url https://yourwebsite.com
 *
 * @help HelpMenu.js
 *
 * This plugin adds a premium HTML5 Help/Codex option to the main menu.
 * Displays General Help, Lore, States, Elements, and Map Hints.
 *
 * Navigation:
 * - Select Help from the main menu.
 * - Use Arrow keys or Mouse to switch categories and scroll through topics.
 * - Press OK to focus on entry descriptions and scroll them.
 * - Press Cancel to return or exit.
 *
 * Terms of Use:
 * Free for commercial and non-commercial use.
 */

(() => {
    "use strict";

    //=============================================================================
    // i18n
    //=============================================================================
    let _helpI18n = null;

    const _loadHelpI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/HelpTopics.json`;
        try {
            const response = await fetch(url);
            _helpI18n = await response.json();
        } catch (e) {
            console.error('HelpMenu: Failed to load i18n data from ' + url, e);
        }
    };

    // Resolve a key (e.g. 'HelpTopics.Squishing.title')
    function _hi18n(path) {
        if (!_helpI18n) return path;
        const parts = path.split('.');
        let val = _helpI18n;
        for (const p of parts) {
            if (val) val = val[p];
        }
        if (typeof val === 'string') {
            return val;
        }
        return path;
    }

    _loadHelpI18n();

    const getLocalizedTitle = (topic) => {
        if (!topic) return "";
        const key = topic.title || "";
        if (key && key.includes('.')) {
            const val = _hi18n(key);
            if (val !== key) return val;
        }
        return key;
    };

    const getLocalizedDescription = (topic) => {
        if (!topic) return "";
        const key = topic.description || "";
        if (key && key.includes('.')) {
            const val = _hi18n(key);
            if (val !== key) return val;
        }
        return key;
    };

    // Read topics dynamically from Messages
    const getHelpTopics = () => {
        if (window.Messages && window.Messages.HelpTopics) {
            if (Array.isArray(window.Messages.HelpTopics)) {
                return window.Messages.HelpTopics;
            } else {
                return Object.values(window.Messages.HelpTopics);
            }
        }
        return [];
    };

    // Parse and display control tags based on input method
    const ControlTagParser = {
        getCurrentInputMethod: function () {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (let i = 0; i < gamepads.length; i++) {
                const gamepad = gamepads[i];
                if (gamepad) {
                    for (let j = 0; j < gamepad.buttons.length; j++) {
                        if (gamepad.buttons[j].pressed) return 'gamepad';
                    }
                    for (let j = 0; j < gamepad.axes.length; j++) {
                        if (Math.abs(gamepad.axes[j]) > 0.5) return 'gamepad';
                    }
                }
            }
            return 'keyboard';
        },

        parseControlText: function (text) {
            const inputMethod = this.getCurrentInputMethod();
            const pattern = /<keyboard:\s*(.+?)>\s*<controller:\s*(.+?)>/g;
            return text.replace(pattern, (match, keyboardText, controllerText) => {
                return (inputMethod === 'gamepad') ? controllerText.trim() : keyboardText.trim();
            });
        }
    };

    function sortTopics(topics) {
        if (!topics) return [];
        return topics.filter(t => t && t.title).sort((a, b) => {
            const titleA = getLocalizedTitle(a).toLowerCase();
            const titleB = getLocalizedTitle(b).toLowerCase();
            return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
        });
    }

    function parseDescriptionToHtml(text) {
        if (!text) return "";
        let parsed = ControlTagParser.parseControlText(text);
        parsed = parsed.replace(/\n/g, "<br>");

        const colorMap = {
            0: "#2b1207",  // Default dark mahogany
            1: "#007acc",  // Blue
            2: "#c0392b",  // Red
            3: "#27ae60",  // Green
            4: "#2980b9",  // Light Blue
            5: "#8e44ad",  // Purple
            6: "#d35400",  // Orange/Yellow
            17: "#8b1e10", // Accent Red/Gold
            18: "#b78727"  // Gold
        };

        let html = "";
        let lastIndex = 0;
        const regex = /\\[cC]\[(\d+)\]/g;
        let match;
        let openSpan = false;

        while ((match = regex.exec(parsed)) !== null) {
            html += parsed.substring(lastIndex, match.index);
            if (openSpan) {
                html += "</span>";
                openSpan = false;
            }
            const colorId = parseInt(match[1]);
            const hexColor = colorMap[colorId] || "#2b1207";
            html += `<span style="color: ${hexColor}; font-weight: ${colorId === 0 ? 'normal' : 'bold'};">`;
            openSpan = true;
            lastIndex = regex.lastIndex;
        }

        html += parsed.substring(lastIndex);
        if (openSpan) html += "</span>";
        return html;
    }

    // =============================================================================
    // Add Help Command to Main Menu
    // =============================================================================
    const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
    Window_MenuCommand.prototype.addOriginalCommands = function () {
        _Window_MenuCommand_addOriginalCommands.call(this);
        this.addCommand(T('HelpMenu.command'), "help", true, 281);
    };

    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function () {
        _Scene_Menu_createCommandWindow.call(this);
        this._commandWindow.setHandler("help", this.commandHelp.bind(this));
    };

    Scene_Menu.prototype.commandHelp = function () {
        SceneManager.push(Scene_Help);
    };

    // =============================================================================
    // Scene_Help - Premium D&D HTML Overlay
    // =============================================================================
    function Scene_Help() {
        this.initialize(...arguments);
    }

    Scene_Help.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_Help.prototype.constructor = Scene_Help;

    Scene_Help.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_Help.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);

        // Deactivate standard windows
        if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
        if (this._itemListWindow) { this._itemListWindow.deactivate(); this._itemListWindow.hide(); }
        if (this._confirmWindow) { this._confirmWindow.deactivate(); this._confirmWindow.hide(); }

        this._activeArea = "tabs"; // "tabs", "list", "content"
        this._tabIndex = 0;
        this._listIndex = 0;
        this._selectedTopic = null;

        this.initUIHelp();
        this.refreshUIHelp();
    };

    Scene_Help.prototype.update = function () {
        this.updateUIHelpInput();
        Scene_MenuBase.prototype.update.call(this);
    };

    Scene_Help.prototype.terminate = function () {
        const container = document.getElementById("help-container");
        if (container) container.remove();
        const style = document.getElementById("help-style");
        if (style) style.remove();
        Scene_MenuBase.prototype.terminate.call(this);
    };

    Scene_Help.prototype.getFilteredTopics = function (category) {
        const all = getHelpTopics();
        let filtered = [];
        if (category === "general") {
            filtered = all.filter(t => t && t.title && (!t.type || (t.type !== 'lore' && t.type !== 'state' && t.type !== 'element')));
        } else if (category === "lore") {
            filtered = all.filter(t => t && t.title && t.type === 'lore');
        } else if (category === "state") {
            filtered = all.filter(t => t && t.title && t.type === 'state');
        } else if (category === "element") {
            filtered = all.filter(t => t && t.title && t.type === 'element');
        }
        return sortTopics(filtered);
    };

    Scene_Help.prototype.initUIHelp = function () {
        if (!document.getElementById("help-container")) {
            const container = document.createElement("div");
            container.id = "help-container";
            document.body.appendChild(container);
        }
    };

    Scene_Help.prototype.refreshUIHelp = function () {
        const container = document.getElementById("help-container");
        if (!container) return;

        const lang = ConfigManager.language || 'en';
        const useTranslation = lang === 'it';

        const categories = ["general", "lore", "state", "element", "hints"];
        const activeCategory = categories[this._tabIndex];
        const topics = this.getFilteredTopics(activeCategory);

        // Clamping indexes safely
        if (topics.length > 0) {
            this._listIndex = Math.max(0, Math.min(topics.length - 1, this._listIndex));
            this._selectedTopic = topics[this._listIndex];
        } else {
            this._selectedTopic = null;
        }

        // Translation strings
        const tCodex =T('HelpMenu.archiveEntry');
        const tGeneral =T('HelpMenu.general');
        const tLore =T('HelpMenu.lore');
        const tStates =T('HelpMenu.states');
        const tElements =T('HelpMenu.elements');
        const tHints =T('HelpMenu.hints');
        const tSelectTopic =T('HelpMenu.selectATopicToStart');
        const backBtnText =T('HelpMenu.back');

        // Ensure the book spread exists
        let spread = container.querySelector(".book-spread");
        if (!spread) {
            container.innerHTML = `
                <div class="book-spread">
                    <div class="left-page"></div>
                    <div class="right-page"></div>
                </div>
            `;
            spread = container.querySelector(".book-spread");

            // Wheel scroll targets whichever scrollable pane is under the cursor
            container.addEventListener("wheel", (e) => {
                const target = e.target.closest("#help-content-scroll, .topic-list-container");
                if (target) {
                    e.preventDefault();
                    target.scrollTop += e.deltaY;
                }
            }, { passive: false });
        }

        const leftPage = spread.querySelector(".left-page");
        const rightPage = spread.querySelector(".right-page");

        // 1. LEFT PAGE: Detailed Content
        let rightHTML = "";
        if (activeCategory === "hints") {
            // Hints Toggle Screen
            const isTutorialActive = $gameSwitches.value(75);
            const isSwitchFocused = this._activeArea === "content";
            const toggleClass = isTutorialActive ? "toggle-switch active" : "toggle-switch";
            const finalToggleClass = isSwitchFocused ? `${toggleClass} focused` : toggleClass;
            const statusLabel = isTutorialActive ? (T('HelpMenu.on')) : (T('HelpMenu.off'));

            rightHTML = `
                <div class="hints-container">
                    <div class="hints-label">
                        ${T('HelpMenu.worldMapHints')}
                    </div>
                    <div class="hints-desc">
                        ${T('HelpMenu.enableOrDisableRealTime')}
                    </div>
                    <div class="${finalToggleClass}" id="tutorial-toggle">
                        <div class="toggle-knob"></div>
                        <div class="toggle-text">${statusLabel}</div>
                    </div>
                </div>
            `;
        } else if (!this._selectedTopic) {
            rightHTML = `<div class="placeholder-message">${tSelectTopic}</div>`;
        } else {
            const topic = this._selectedTopic;
            const displayTitle = getLocalizedTitle(topic);
            const bodyHtml = parseDescriptionToHtml(getLocalizedDescription(topic));
            const imageHtml = topic.image ? `<img class="help-image" src="img/pictures/${topic.image}.png" onerror="this.style.display='none';">` : "";

            const isFocused = this._activeArea === "content";
            const focusClass = isFocused ? "help-content focused" : "help-content";

            rightHTML = `
                <div class="${focusClass}" id="help-content-scroll">
                    <h3 class="help-title">${displayTitle}</h3>
                    <hr class="help-divider">
                    <div class="help-body">${bodyHtml}</div>
                    ${imageHtml}
                </div>
            `;
        }

        leftPage.innerHTML = `
            <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
              <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                ${backBtnText}
              </div>
              <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${tCodex}</h2>
            </div>
            ${rightHTML}
        `;

        // 2. RIGHT PAGE: Sidebar List & Tabs (Updates only when category changes, completely preventing flickering)
        const needsRightPageRedraw = !rightPage.innerHTML || this._lastCategory !== activeCategory;
        this._lastCategory = activeCategory;

        if (needsRightPageRedraw) {
            let tabsHTML = "";
            categories.forEach((cat, idx) => {
                const label = cat === "general" ? tGeneral : cat === "lore" ? tLore : cat === "state" ? tStates : cat === "element" ? tElements : tHints;
                tabsHTML += `<div class="tab" data-idx="${idx}">${label}</div>`;
            });

            let listHTML = "";
            if (activeCategory === "hints") {
                listHTML = `
                    <div class="placeholder-message">
                        ${T('HelpMenu.configureWorldMapHintsAnd')}
                    </div>
                `;
            } else if (topics.length === 0) {
                listHTML = `
                    <div class="placeholder-message">
                        ${T('HelpMenu.noCodexEntriesFoundIn')}
                    </div>
                `;
            } else {
                listHTML = `<div class="topic-list-container">`;
                topics.forEach((topic, idx) => {
                    const titleText = getLocalizedTitle(topic);
                    listHTML += `
                        <div class="topic-item" data-idx="${idx}">
                            <span class="topic-title-text">${titleText}</span>
                        </div>
                    `;
                });
                listHTML += `</div>`;
            }

            rightPage.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;"></div>
                <div class="tabs-bar">
                    ${tabsHTML}
                </div>
                ${listHTML}
            `;

            // Bind click events on recreated tabs
            const tabElements = rightPage.querySelectorAll(".tab");
            tabElements.forEach(elem => {
                elem.addEventListener("click", () => {
                    const idx = parseInt(elem.getAttribute("data-idx"));
                    this._activeArea = "tabs";
                    this._tabIndex = idx;
                    this._listIndex = 0;
                    SoundManager.playOk();
                    this.refreshUIHelp();
                });
            });

            // Bind click events on recreated topics
            if (activeCategory !== "hints") {
                const itemElements = rightPage.querySelectorAll(".topic-item");
                itemElements.forEach(elem => {
                    elem.addEventListener("click", () => {
                        const idx = parseInt(elem.getAttribute("data-idx"));
                        this._activeArea = "list";
                        this._listIndex = idx;
                        this._selectedTopic = topics[idx];
                        SoundManager.playOk();
                        this.refreshUIHelp();
                    });
                });
            }
        }

        // 3. Fast state synchronization (toggles classes, completely eliminating flickering)
        const tabElements = rightPage.querySelectorAll(".tab");
        tabElements.forEach((elem, idx) => {
            const isActive = idx === this._tabIndex;
            const isFocused = this._activeArea === "tabs" && idx === this._tabIndex;

            if (isActive) elem.classList.add("active");
            else elem.classList.remove("active");

            if (isFocused) elem.classList.add("focused");
            else elem.classList.remove("focused");
        });

        if (activeCategory !== "hints") {
            const itemElements = rightPage.querySelectorAll(".topic-item");
            itemElements.forEach((elem, idx) => {
                const isActive = this._selectedTopic === topics[idx];
                const isFocused = this._activeArea === "list" && idx === this._listIndex;

                if (isActive) elem.classList.add("active");
                else elem.classList.remove("active");

                if (isFocused) elem.classList.add("focused");
                else elem.classList.remove("focused");
            });
        }

        const tutorialBtn = leftPage.querySelector("#tutorial-toggle");
        if (tutorialBtn) {
            tutorialBtn.addEventListener("click", () => {
                this.toggleTutorialSwitch();
            });
        }
    };

    Scene_Help.prototype.toggleTutorialSwitch = function () {
        $gameSwitches.setValue(75, !$gameSwitches.value(75));
        SoundManager.playOk();
        this.refreshUIHelp();
    };

    Scene_Help.prototype.updateUIHelpInput = function () {
        const categories = ["general", "lore", "state", "element", "hints"];
        const activeCategory = categories[this._tabIndex];
        const topics = this.getFilteredTopics(activeCategory);

        // L1/R1 cycle category tabs from anywhere in the scene
        if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
            const dir = Input.isTriggered('pageup') ? -1 : 1;
            this._tabIndex = (this._tabIndex + dir + categories.length) % categories.length;
            this._listIndex = 0;
            this._activeArea = "tabs";
            SoundManager.playCursor();
            this.refreshUIHelp();
            return;
        }

        if (this._activeArea === "tabs") {
            if (Input.isRepeated('right')) {
                this._tabIndex = (this._tabIndex + 1) % categories.length;
                this._listIndex = 0;
                SoundManager.playCursor();
                this.refreshUIHelp();
            } else if (Input.isRepeated('left')) {
                this._tabIndex = (this._tabIndex - 1 + categories.length) % categories.length;
                this._listIndex = 0;
                SoundManager.playCursor();
                this.refreshUIHelp();
            } else if (Input.isRepeated('down')) {
                if (activeCategory === "hints") {
                    this._activeArea = "content";
                    SoundManager.playCursor();
                    this.refreshUIHelp();
                } else if (topics.length > 0) {
                    this._activeArea = "list";
                    this._listIndex = 0;
                    SoundManager.playCursor();
                    this.refreshUIHelp();
                }
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                this.popScene();
                SoundManager.playCancel();
            }
        } else if (this._activeArea === "list") {
            if (Input.isRepeated('down')) {
                this._listIndex = (this._listIndex + 1) % topics.length;
                SoundManager.playCursor();
                this.refreshUIHelp();

                const container = document.getElementById("help-container");
                if (container) {
                    const row = container.querySelector(".topic-item.focused");
                    if (row) row.scrollIntoView({ block: "nearest" });
                }
            } else if (Input.isRepeated('up')) {
                if (this._listIndex === 0) {
                    this._activeArea = "tabs";
                    SoundManager.playCursor();
                    this.refreshUIHelp();
                } else {
                    this._listIndex = (this._listIndex - 1) % topics.length;
                    SoundManager.playCursor();
                    this.refreshUIHelp();

                    const container = document.getElementById("help-container");
                    if (container) {
                        const row = container.querySelector(".topic-item.focused");
                        if (row) row.scrollIntoView({ block: "nearest" });
                    }
                }
            } else if (Input.isTriggered('left') || Input.isTriggered('ok')) {
                if (this._selectedTopic) {
                    this._activeArea = "content";
                    SoundManager.playOk();
                    this.refreshUIHelp();
                } else {
                    SoundManager.playBuzzer();
                }
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                this._activeArea = "tabs";
                SoundManager.playCancel();
                this.refreshUIHelp();
            }
        } else if (this._activeArea === "content") {
            if (activeCategory === "hints") {
                if (Input.isTriggered('ok')) {
                    this.toggleTutorialSwitch();
                } else if (Input.isRepeated('up')) {
                    this._activeArea = "tabs";
                    SoundManager.playCursor();
                    this.refreshUIHelp();
                } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    this._activeArea = "tabs";
                    SoundManager.playCancel();
                    this.refreshUIHelp();
                }
            } else {
                // Scroll page content smoothly using arrows
                const contentDiv = document.getElementById("help-content-scroll");
                if (contentDiv) {
                    if (Input.isPressed('down')) {
                        contentDiv.scrollTop += 8;
                    } else if (Input.isPressed('up')) {
                        contentDiv.scrollTop -= 8;
                    }
                }

                if (Input.isTriggered('cancel') || TouchInput.isCancelled() || Input.isTriggered('right')) {
                    this._activeArea = "list";
                    SoundManager.playCancel();
                    this.refreshUIHelp();
                }
            }
        }
    };
})();