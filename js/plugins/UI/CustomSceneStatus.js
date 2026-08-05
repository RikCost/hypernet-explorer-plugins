//=============================================================================
// CustomSceneStatus.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Custom Scene Status v2.0.0
 * @author OmniLex & Antigravity
 * @version 2.0.0
 * @description Gorgeous D&D Book Spread Status screen with campfire sepia aesthetic and biological limb tracking.
 * @param maxDescriptionLength
 * @text Max Description Length
 * @desc Maximum number of characters for character descriptions
 * @type number
 * @default 200
 * @min 50
 * @max 500
 *
 * @command setCharacterDescription
 * @text Set Character Description
 * @desc Set a description for a party member
 *
 * @arg partyMemberIndex
 * @text Party Member
 * @desc Which party member (1, 2, or 3)
 * @type select
 * @option Party Member 1
 * @value 1
 * @option Party Member 2
 * @value 2
 * @option Party Member 3
 * @value 3
 * @default 1
 *
 * @arg description
 * @text Description
 * @desc The character description text
 * @type multiline_string
 * @default
 *
 * @help CustomSceneStatus.js
 *
 * This plugin replaces the default Scene_Status with a custom version.
 *
 * --- Features ---
 * - Double-page parchment layout spreading across the screen (D&D Book Theme)
 * - Circular companion selection tabs at the top of the sheet
 * - Correctly cropped bust portraits drawn dynamically inside an ornate portrait frame
 * - Sepia status gauges for Vitals (HP), Energy (MP), Tension (TP) and Level Progression (EXP)
 * - Embossed medallions grid showing STR, CON, DEX, INT, WIS, PSI and active stat modifiers
 * - Alignment elemental badge and character traits with dynamic icon blitting
 * - Scrollable biological limb-health vitals tracking (Dwarf Fortress limb damage)
 * - Fast, flicker-free rendering with left-page caching
 */

(() => {
    'use strict';

    // ── Shared character-switcher hint helper (idempotent across plugins) ──────
    // Shows controller bumper hints (L / R) around a .companion-tabs-row when a
    // gamepad is connected, or a single TAB hint otherwise. Also installs a Tab
    // keyboard shortcut that cycles characters only while no controller is
    // connected (the bumpers / pageup-pagedown handle it when one is).
    if (!window.CharSwitcher) {
        window.CharSwitcher = {
            isControllerConnected() {
                const pads = navigator.getGamepads ? navigator.getGamepads() : [];
                for (let i = 0; i < pads.length; i++) {
                    if (pads[i] && pads[i].connected) return true;
                }
                return false;
            },
            injectStyles() {
                if (document.getElementById('char-switch-hint-styles')) return;
                const style = document.createElement('style');
                style.id = 'char-switch-hint-styles';
                style.textContent = `
                    .companion-switcher { display:flex; align-items:center; gap:6px; }
                    .char-switch-hint {
                        font-family:'Lora',serif; font-size:0.6rem; font-weight:bold;
                        line-height:1; letter-spacing:0.5px; color:var(--text-primary-hover);
                        border:1.5px solid var(--text-primary-hover); border-radius:3px;
                        padding:2px 5px; opacity:0.7; user-select:none; white-space:nowrap;
                        text-transform:uppercase; flex-shrink:0;
                    }
                `;
                document.head.appendChild(style);
            },
            parts(memberCount) {
                this.injectStyles();
                if (!memberCount || memberCount <= 1) return { left: '', right: '' };
                if (this.isControllerConnected()) {
                    return {
                        left: '<span class="char-switch-hint">L</span>',
                        right: '<span class="char-switch-hint">R</span>'
                    };
                }
                return { left: '', right: '<span class="char-switch-hint">TAB</span>' };
            },
            inner(tabsRowHTML, memberCount) {
                const p = this.parts(memberCount);
                return p.left + tabsRowHTML + p.right;
            },
            wrap(tabsRowHTML, memberCount) {
                return `<div class="companion-switcher">${this.inner(tabsRowHTML, memberCount)}</div>`;
            },
            installTabKey(scene, onCycle) {
                if (scene._charSwitchTabListener) return;
                scene._charSwitchTabListener = (e) => {
                    if (e.key !== 'Tab') return; // i18n-ignore: DOM key name
                    e.preventDefault();
                    if (this.isControllerConnected()) return;
                    onCycle(e.shiftKey ? -1 : 1);
                };
                window.addEventListener('keydown', scene._charSwitchTabListener);
            },
            removeTabKey(scene) {
                if (scene._charSwitchTabListener) {
                    window.removeEventListener('keydown', scene._charSwitchTabListener);
                    scene._charSwitchTabListener = null;
                }
            }
        };
    }

    const pluginName = 'CustomSceneStatus';
    const parameters = PluginManager.parameters(pluginName);
    const maxDescriptionLength = parseInt(parameters['maxDescriptionLength'] || 200);


    let _statsI18n = null;

    const _loadStatsI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/stats.json`;
        try {
            const response = await fetch(url);
            _statsI18n = await response.json();
        } catch (e) {
            console.error('CustomSceneStatus: Failed to load i18n data from ' + url, e);
        }
    };

    const _si18n = (key, fallback) => {
        if (_statsI18n && _statsI18n[key]) {
            return _statsI18n[key];
        }
        return fallback !== undefined ? fallback : key;
    };

    // Legacy trait data still ships { en: "...", it: "..." } objects instead of
    // an i18n key path; pick the active language and fall back to English.
    const _pickLocalized = (obj) => {
        if (!obj || typeof obj !== 'object') return "";
        const lang = ConfigManager.language || 'en';
        return obj[lang] || obj.en || "";
    };

    _loadStatsI18n();

    // Initialize character descriptions storage safely.
    // Stored on $gameSystem so descriptions persist into save files ($dataSystem is
    // not serialized into saves and lost the data across load).
    function initializeDescriptions() {
        if ($gameSystem && !$gameSystem._characterDescriptions) {
            $gameSystem._characterDescriptions = {};
        }
    }

    //=============================================================================
    // Bust Image Loading Helper
    //=============================================================================

    function getActorBustImagePath(actor) {
        if (!actor) return null;

        const actorId = actor.actorId && actor.actorId();
        const characterName = actor.characterName();
        const { SpritesAssociation } = window.Sprites || {};

        // Player 1 (Actor 1) special handling
        if (actorId === 1) {
            // Priority 1: Check Variable 109 (Player 1 bust name)
            const player1BustName = $gameActors.actor(1).vnBust();
            if (player1BustName && player1BustName !== "") {
                return "img/busts/" + player1BustName;
            }

            // Priority 2: If Switch 77 is ON, use Variable 106 for monster form
            if ($gameSwitches.value(77)) {
                const player1MonsterName = $gameActors.actor(1).vnBattler();
                if (player1MonsterName && player1MonsterName !== "") {
                    return "img/enemies/" + player1MonsterName;
                }
            }

            // Priority 3: Fall back to SpritesAssociation
            if (characterName && SpritesAssociation) {
                const spritesheetName = characterName.split('.')[0];
                const characterIndex = actor.characterIndex();

                if (SpritesAssociation[spritesheetName] &&
                    SpritesAssociation[spritesheetName][characterIndex]) {
                    const bustName = SpritesAssociation[spritesheetName][characterIndex];
                    return "img/busts/" + bustName;
                }
            }

            return "img/busts/7";
        }

        // Player 2 (Actor 2) special handling
        if (actorId === 2) {
            // Priority 1: Check Variable 117 (Player 2 bust name)
            const player2BustName = $gameActors.actor(2).vnBust();
            if (player2BustName && player2BustName !== "") {
                return "img/busts/" + player2BustName;
            }

            // Priority 2: If Switch 78 is ON, use Variable 107 for monster form
            if ($gameSwitches.value(78)) {
                const player2MonsterName = $gameActors.actor(2).vnBattler();
                if (player2MonsterName && player2MonsterName !== "") {
                    return "img/enemies/" + player2MonsterName;
                }
            }

            // Priority 3: Fall back to SpritesAssociation
            if (characterName && SpritesAssociation) {
                const spritesheetName = characterName.split('.')[0];
                const characterIndex = actor.characterIndex();

                if (SpritesAssociation[spritesheetName] &&
                    SpritesAssociation[spritesheetName][characterIndex]) {
                    const bustName = SpritesAssociation[spritesheetName][characterIndex];
                    return "img/busts/" + bustName;
                }
            }

            return "img/busts/7";
        }

        // Player 3 (Actor 3) special handling
        if (actorId === 3) {
            // Priority 1: Check Variable 118 (Player 3 bust name)
            const player3BustName = $gameActors.actor(3).vnBust();
            if (player3BustName && player3BustName !== "") {
                return "img/busts/" + player3BustName;
            }

            // Priority 2: If Switch 79 is ON, use Variable 108 for monster form
            if ($gameSwitches.value(79)) {
                const player3MonsterName = $gameActors.actor(3).vnBattler();
                if (player3MonsterName && player3MonsterName !== "") {
                    return "img/enemies/" + player3MonsterName;
                }
            }

            // Priority 3: Fall back to SpritesAssociation
            if (characterName && SpritesAssociation) {
                const spritesheetName = characterName.split('.')[0];
                const characterIndex = actor.characterIndex();

                if (SpritesAssociation[spritesheetName] &&
                    SpritesAssociation[spritesheetName][characterIndex]) {
                    const bustName = SpritesAssociation[spritesheetName][characterIndex];
                    return "img/busts/" + bustName;
                }
            }

            return "img/busts/7";
        }

        // Fallback to SpritesAssociation for any other actors
        if (characterName && SpritesAssociation) {
            const spritesheetName = characterName.split('.')[0];
            const characterIndex = actor.characterIndex();

            if (SpritesAssociation[spritesheetName] &&
                SpritesAssociation[spritesheetName][characterIndex]) {
                const bustName = SpritesAssociation[spritesheetName][characterIndex];
                return "img/busts/" + bustName;
            }
        }

        // Final fallback to default bust path structure
        return "img/busts/7";
    }

    function drawBustImage(bitmap, actor, x, y, width, height) {
        const bustPath = getActorBustImagePath(actor);

        // Always clear the area first
        bitmap.clearRect(x, y, width, height);

        if (!bustPath) return;

        // Determine if this is an enemy image (don't crop) or bust image (crop)
        const shouldCrop = !bustPath.includes('img/enemies/');

        // Load the main bust image
        const bustBitmap = ImageManager.loadBitmap('', bustPath);

        bustBitmap.addLoadListener(() => {
            // Check if the bitmap actually loaded successfully
            if (bustBitmap.width > 0 && bustBitmap.height > 0) {
                drawBustToCanvas(bitmap, bustBitmap, x, y, width, height, shouldCrop);
            }
        });
    }

    function drawBustToCanvas(bitmap, sourceBitmap, x, y, width, height, shouldCrop = true) {
        try {
            // Disable image smoothing for pixel-perfect rendering
            const context = bitmap.context;
            const oldSmoothing = context.imageSmoothingEnabled;
            context.imageSmoothingEnabled = false;

            // Get source image dimensions
            const sourceWidth = sourceBitmap.width > 0 ? sourceBitmap.width : 889;
            const sourceHeight = sourceBitmap.height > 0 ? sourceBitmap.height : 1200;

            let cropTop = 0;
            let cropLeft = 0;
            let croppedSourceWidth = sourceWidth;
            let croppedSourceHeight = sourceHeight;

            // For bust images, zoom in on the face area with tighter cropping
            if (shouldCrop) {
                // Crop from top to show face details (320px from top instead of 180px)
                cropTop = 320;
                // Crop from sides to zoom in (center 60% of width)
                cropLeft = Math.round(sourceWidth * 0.2);
                croppedSourceWidth = Math.round(sourceWidth * 0.6);
                croppedSourceHeight = sourceHeight - cropTop;
            }

            const aspectRatio = croppedSourceWidth / croppedSourceHeight;

            // Calculate draw dimensions to fit within the display area while maintaining aspect ratio
            let drawWidth = width;
            let drawHeight = Math.round(width / aspectRatio);

            // If height exceeds available space, scale down
            if (drawHeight > height) {
                drawHeight = height;
                drawWidth = Math.round(height * aspectRatio);
            }

            // Center the image within the specified area
            const drawX = Math.round(x + (width - drawWidth) / 2);
            const drawY = Math.round(y + (height - drawHeight) / 2);

            // Draw the image (cropped if it's a bust, full if it's an enemy)
            bitmap.blt(sourceBitmap, cropLeft, cropTop, croppedSourceWidth, croppedSourceHeight, drawX, drawY, drawWidth, drawHeight);

            // Restore original smoothing setting
            context.imageSmoothingEnabled = oldSmoothing;
        } catch (error) {
            // Silently handle errors
        }
    }

    //=============================================================================
    // Translation Helper
    //=============================================================================



    // Copy lives in js/i18n/<lang>/plugins/SceneStatus.json.
    function getText(key) {
        return T("SceneStatus." + key);
    }

    let i18nData = null;

    const loadI18nData = async () => {
        const lang = ConfigManager.language || "en";
        const url = `js/i18n/${lang}/traits.json`;
        try {
            const response = await fetch(url);
            i18nData = await response.json();
        } catch (e) {
            console.error("CustomSceneStatus: Failed to load i18n data from " + url, e);
        }
    };

    const resolveI18nPath = (path, obj) => {
        if (!path || !obj) return null;
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    };

    //=============================================================================
    // Seeded Random Number Generator
    //=============================================================================

    class SeededRandom {
        constructor(seed) {
            this.seed = seed;
        }

        next() {
            this.seed = (this.seed * 9301 + 49297) % 233280;
            return this.seed / 233280;
        }
    }

    function stringToSeed(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    //=============================================================================
    // Trait Generation
    //=============================================================================

    function getTraitById(traitId) {
        if (!window.Health || !window.Health.Traits) {
            return null;
        }
        return window.Health.Traits.find(trait => trait.id === traitId);
    }

    function generateRandomTraits(actorName, count = 5) {
        if (!window.Health || !window.Health.Traits) {
            return [];
        }

        const availableTraits = window.Health.Traits;
        if (availableTraits.length === 0) {
            return [];
        }

        const seed = stringToSeed(actorName);
        const rng = new SeededRandom(seed);
        const traits = [];
        const usedIds = new Set();
        const maxTraitId = Math.max(...availableTraits.map(t => t.id));

        let attempts = 0;
        const maxAttempts = count * 10;

        while (traits.length < count && attempts < maxAttempts) {
            attempts++;
            const traitId = Math.floor(rng.next() * maxTraitId) + 1;

            if (!usedIds.has(traitId)) {
                const traitData = getTraitById(traitId);
                if (traitData) {
                    usedIds.add(traitId);
                    traits.push({
                        id: traitData.id,
                        icon: traitData.icon,
                        name: traitData.name
                    });
                }
            }
        }

        return traits;
    }

    function ensureActorTraits(actor, partyIndex) {
        if (partyIndex === 0) {
            // First party member has no auto-generated traits
            if (!actor._selectedTraits) {
                actor._selectedTraits = [];
            }
        } else {
            // Other party members get seeded random traits
            if (!actor._selectedTraits || actor._selectedTraits.length === 0) {
                actor._selectedTraits = generateRandomTraits(actor.name(), 5);
            }
        }
    }

    //=============================================================================
    // Plugin Commands
    //=============================================================================

    PluginManager.registerCommand(pluginName, "setCharacterDescription", args => {
        const partyIndex = parseInt(args.partyMemberIndex) - 1;
        const description = args.description || "";
        const actor = $gameParty.allMembers()[partyIndex];

        if (actor) {
            if (!$gameSystem || !$gameSystem._characterDescriptions) {
                initializeDescriptions();
            }

            const truncatedDescription = description.length > maxDescriptionLength
                ? description.substring(0, maxDescriptionLength) + "..."
                : description;

            $gameSystem._characterDescriptions[actor.actorId()] = truncatedDescription;
            window.skipLocalization = true;
            $gameMessage.add(T("SceneStatus.descriptionSet", { name: actor.name() }));
            window.skipLocalization = false;
        } else {
            window.skipLocalization = true;
            $gameMessage.add(T("SceneStatus.invalidIndex"));
            window.skipLocalization = false;
        }
    });

    //=============================================================================
    // Eager i18n initialization
    //=============================================================================
    loadI18nData();

    //=============================================================================
    // Scene_Status Overrides & UI UI Spread Engine
    //=============================================================================

    const _Scene_Status_create = Scene_Status.prototype.create;
    Scene_Status.prototype.create = function () {
        _Scene_Status_create.call(this);

        // Hide standard canvas windows
        if (this._statusWindow) {
            this._statusWindow.visible = false;
            this._statusWindow.deactivate();
        }
        if (this._statesWindow) {
            this._statesWindow.visible = false;
            this._statesWindow.deactivate();
        }
        if (this._paramsWindow) {
            this._paramsWindow.visible = false;
            this._paramsWindow.deactivate();
        }

        // Set actor index to active menu actor
        this._actorIndex = $gameParty.allMembers().indexOf(this.actor());
        if (this._actorIndex < 0) this._actorIndex = 0;

        // UI UI states
        this._dndActiveSection = "stats"; // "stats", "bodyparts"
        this._dndSelectedIndex = 0;
        this._dndLastLeftPageKey = "";

        this.createUIStatusOverlay();
        window.CharSwitcher.installTabKey(this, (dir) => {
            if (dir > 0) this.nextActor();
            else this.previousActor();
        });
    };

    Scene_Status.prototype.start = function () {
        Scene_MenuBase.prototype.start.call(this);
        this.refreshActor();
    };

    Scene_Status.prototype.refreshActor = function () {
        const actor = this.actor();
        ensureActorTraits(actor, this._actorIndex);
        this.refreshUIStatus();
    };

    Scene_Status.prototype.onActorChange = function () {
        Scene_MenuBase.prototype.onActorChange.call(this);
        this.refreshActor();
    };

    Scene_Status.prototype.update = function () {
        Scene_MenuBase.prototype.update.call(this);
        this.updateUIStatusInput();
    };

    Scene_Status.prototype.nextActor = function () {
        this._actorIndex = (this._actorIndex + 1) % $gameParty.allMembers().length;
        this.refreshActor();
        SoundManager.playCursor();
    };

    Scene_Status.prototype.previousActor = function () {
        this._actorIndex = (this._actorIndex - 1 + $gameParty.allMembers().length) % $gameParty.allMembers().length;
        this.refreshActor();
        SoundManager.playCursor();
    };

    Scene_Status.prototype.actor = function () {
        return $gameParty.allMembers()[this._actorIndex];
    };

    const _Scene_Status_terminate = Scene_Status.prototype.terminate;
    Scene_Status.prototype.terminate = function () {
        _Scene_Status_terminate.call(this);
        this.cleanupStatus3D();
        window.CharSwitcher.removeTabKey(this);
        if (this._dndContainer) {
            const container = this._dndContainer;
            container.style.transition = "opacity 0.2s ease-out";
            container.style.opacity = "0";
            container.style.pointerEvents = "none";
            setTimeout(() => {
                if (container && container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }, 200);
            this._dndContainer = null;
        }
        // Cleanup styles to prevent bleed-through/shrinking of main menu spread
        const styleBlock = document.getElementById("status-styles");
        if (styleBlock) {
            styleBlock.remove();
        }
    };

    // --- Overlay & CSS Engine ---

    Scene_Status.prototype.createUIStatusOverlay = function () {
        // Inject Google Fonts


        // Inject custom stylesheet block
        // Create DOM wrapper
        this._dndContainer = document.createElement("div");
        this._dndContainer.id = "status-menu-container";
        this._dndContainer.style.opacity = "0";
        this._dndContainer.style.transition = "opacity 0.22s ease-out";
        document.body.appendChild(this._dndContainer);

        this.refreshUIStatus();

        setTimeout(() => {
            if (this._dndContainer) {
                this._dndContainer.style.opacity = "1";
            }
        }, 16);
    };

    Scene_Status.prototype.refreshUIStatus = function () {
        if (!this._dndContainer) return;

        const actor = this.actor();
        if (!actor) return;

        const backBtnText = T("SceneStatus.back");

        // Check if book spread framework is present; if not, build it once
        let spread = this._dndContainer.querySelector(".book-spread");
        if (!spread) {
            this._dndContainer.innerHTML = `
                <div class="book-spread">
                    <div class="left-page">
                        <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 6px; margin-bottom: 10px; min-height: 36px; margin-top: 4px;">
                            <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                                ${backBtnText}
                            </div>
                            <h2 class="title" id="status-actor-name" style="border: none; margin: 0; padding: 0; text-align: center;"></h2>
                        </div>
                        
                        <div class="status-bust-wrapper">
                            <canvas id="status-bust" width="440" height="500" style="width:440px; height:500px;"></canvas>
                        </div>
                        
                        <div class="status-gauges-box">
                            <div class="status-gauge-grid">
                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.hp')}</span>
                                    <span class="gauge-value" id="status-hp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner hp" id="status-hp-bar"></div>
                                </div>
                            </div>

                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.mp')}</span>
                                    <span class="gauge-value" id="status-mp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner mp" id="status-mp-bar"></div>
                                </div>
                            </div>

                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.ap')}</span>
                                    <span class="gauge-value" id="status-tp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner tp" id="status-tp-bar"></div>
                                </div>
                            </div>

                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.experience')}</span>
                                    <span class="gauge-value" id="status-exp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner exp" id="status-exp-bar"></div>
                                </div>
                            </div>
                            </div>

                            <div class="status-needs-rows" id="status-needs"></div>
                        </div>
                    </div>
                    <div class="right-page" style="position:relative;">
                        <div class="companion-switcher" id="status-companion-switcher" style="position:absolute; top:6px; right:0; z-index:5; justify-content:flex-end; min-height:26px;"></div>
                        <h3 class="right-title">${T('SceneStatus.ui.attributesAbilities')}</h3>
                        <div class="stats-medallions-grid" id="status-medallions"></div>
                        
                        <div class="alignment-traits-row">
                            <div id="status-alignment-container" style="display:contents;"></div>
                            <div class="status-traits-card">
                                <div class="card-label">${T('SceneStatus.ui.characterTraits')}</div>
                                <div class="traits-list-inline" id="status-traits"></div>
                            </div>
                        </div>

                        <div class="bodyparts-card" style="margin-bottom:8px;">
                            <div class="card-label" id="status-passive-label">${T('SceneStatus.ui.classAbility')}</div>
                            <div id="status-class-passive" style="padding:4px 2px; font-family:'Lora',serif;"></div>
                        </div>

                        <div class="bodyparts-card">
                            <div class="card-label">${T('SceneStatus.ui.biologicalVitals')}</div>
                            <div class="bodyparts-list" id="bodyparts-scroll-container"></div>
                        </div>
                        
                    </div>
                </div>
            `;
            spread = this._dndContainer.querySelector(".book-spread");
        }

        // 1. Companion navigation tabs HTML
        const allMembers = $gameParty.allMembers();
        let companionTabsHTML = "";
        allMembers.forEach((member, idx) => {
            const isSelected = member === actor ? "selected" : "";
            companionTabsHTML += `
                <div class="companion-tab ${isSelected}" onclick="SceneManager._scene.selectUIActor(${idx})">
                    ${member.name()}
                </div>
            `;
        });
        const tabsRow = spread.querySelector("#status-companion-switcher");
        if (tabsRow) {
            tabsRow.innerHTML = window.CharSwitcher.inner(
                `<div class="companion-tabs-row" style="border-bottom:none; margin-bottom:0; padding-bottom:0;">${companionTabsHTML}</div>`,
                allMembers.length
            );
        }

        // 2. Left Page content updates
        const actorNameEl = spread.querySelector("#status-actor-name");
        if (actorNameEl) actorNameEl.textContent = T("SceneStatus.actorLine", { name: actor.name(), klass: actor.currentClass().name, level: actor.level });

        // Calculate EXP
        const currentExp = actor.currentExp() || 0;
        let expRate = 0;
        let expForThisLevel = 0;
        let expGainedThisLevel = 0;
        if (actor.isMaxLevel()) {
            expRate = 1;
        } else {
            const currentLevelExp = actor.currentLevelExp();
            const nextLevelExp = actor.nextLevelExp();
            expForThisLevel = nextLevelExp - currentLevelExp;
            expGainedThisLevel = currentExp - currentLevelExp;
            expRate = expForThisLevel > 0 ? (expGainedThisLevel / expForThisLevel) : 0;
        }

        // Update Left Page Gauges
        const hpTextEl = spread.querySelector("#status-hp-text");
        if (hpTextEl) hpTextEl.textContent = `${actor.hp} / ${actor.mhp}`;
        const hpBarEl = spread.querySelector("#status-hp-bar");
        if (hpBarEl) hpBarEl.style.width = `${actor.hpRate() * 100}%`;

        const mpTextEl = spread.querySelector("#status-mp-text");
        if (mpTextEl) mpTextEl.textContent = `${actor.mp} / ${actor.mmp}`;
        const mpBarEl = spread.querySelector("#status-mp-bar");
        if (mpBarEl) mpBarEl.style.width = `${actor.mpRate() * 100}%`;

        const tpTextEl = spread.querySelector("#status-tp-text");
        if (tpTextEl) tpTextEl.textContent = `${actor.tp} / ${actor.maxTp()}`;
        const tpBarEl = spread.querySelector("#status-tp-bar");
        if (tpBarEl) tpBarEl.style.width = `${(actor.tp / actor.maxTp()) * 100}%`;

        const expTextEl = spread.querySelector("#status-exp-text");
        if (expTextEl) expTextEl.textContent = `${expGainedThisLevel} / ${expForThisLevel}`;
        const expBarEl = spread.querySelector("#status-exp-bar");
        if (expBarEl) expBarEl.style.width = `${expRate * 100}%`;

        // Character Needs gauges (hunger / sleep / hygiene / social / leisure)
        // Sourced from TimeDateSystem. Each is guarded so the status screen still
        // works when that plugin is absent.
        const needsEl = spread.querySelector("#status-needs");
        if (needsEl) {
            const needDefs = [
                { label: T("SceneStatus.need.hunger"), cls: "hunger", fn: "hungerPercent" },
                { label: T("SceneStatus.need.sleep"), cls: "sleep", fn: "sleepPercent" },
                { label: T("SceneStatus.need.hygiene"), cls: "hygiene", fn: "hygienePercent" },
                { label: T("SceneStatus.need.social"), cls: "social", fn: "socialPercent" },
                { label: T("SceneStatus.need.leisure"), cls: "leisure", fn: "leisurePercent" }
            ];

            // Uniform needs palette: gold when healthy, orange when low, red
            // when critical. Inline color overrides the per-class gradient so
            // every needs bar reads on the same scale.
            const needColor = (p) => p <= 20 ? '#d9433a' : (p <= 50 ? '#e2933a' : '#d4a64e');

            let needsHTML = "";
            needDefs.forEach(need => {
                if (typeof actor[need.fn] !== "function") return;
                const pct = Math.max(0, Math.min(100, Math.round(actor[need.fn]())));
                const c = needColor(pct);
                needsHTML += `
                    <div class="status-gauge-row">
                        <div class="status-gauge-meta">
                            <span class="gauge-label">${need.label}</span>
                            <span class="gauge-value" style="color:${c};">${pct}%</span>
                        </div>
                        <div class="status-gauge-bar-outer">
                            <div class="status-gauge-bar-inner ${need.cls}" style="width: ${pct}%; background:${c};"></div>
                        </div>
                    </div>
                `;
            });
            needsEl.innerHTML = needsHTML;
        }

        // 3. Right Page Content updates
        const params = [
            { name: _si18n("ATT", "STR"), val: actor.param(2), id: 2 },
            { name: _si18n("DEF", "CON"), val: actor.param(3), id: 3 },
            { name: _si18n("AGILITY", "DEX"), val: actor.param(6), id: 6 },
            { name: _si18n("M.ATT", "INT"), val: actor.param(4), id: 4 },
            { name: _si18n("M.DEF", "WIS"), val: actor.param(5), id: 5 },
            { name: _si18n("LUCK", "PSI"), val: actor.param(7), id: 7 }
        ];

        const getModText = (val) => {
            const m = Math.floor((val - 10) / 2);
            return m >= 0 ? "+" + m : String(m);
        };

        let paramsGridHTML = "";
        params.forEach(p => {
            const mod = getModText(p.val);
            const modifier = (actor._statModifiers && actor._statModifiers[p.id]) || 0;
            let displayValHTML = `<span class="stat-number">${p.val}</span>`;
            if (modifier !== 0) {
                const origVal = p.val - modifier;
                displayValHTML = `
                    <span class="stat-number debuffed" style="text-decoration: line-through; color: var(--text-blood-red); font-size: 0.85em; margin-right: 4px;">${origVal}</span>
                    <span class="stat-number">${p.val}</span>
                `;
            }

            paramsGridHTML += `
                <div class="stat-medallion">
                    <div class="stat-medallion-lbl">${p.name}</div>
                    <div class="stat-medallion-val">${displayValHTML}</div>
                </div>
            `;
        });
        const medallionsEl = spread.querySelector("#status-medallions");
        if (medallionsEl) medallionsEl.innerHTML = paramsGridHTML;

        // Alignment Element
        let elementHTML = "";
        const actorClass = actor.currentClass();
        if (actorClass && actorClass.note) {
            const elemMatch = actorClass.note.match(/<elem:\s*(\d+)>/);
            if (elemMatch) {
                const elementId = parseInt(elemMatch[1]);
                if (elementId > 0 && elementId < $dataSystem.elements.length) {
                    const elementName = $dataSystem.elements[elementId];
                    const elementIcons = [0, 96, 64, 65, 66, 67, 68, 69, 70, 71];
                    const elementIcon = elementIcons[elementId] || 0;
                    const x = (elementIcon % 16) * 32;
                    const y = Math.floor(elementIcon / 16) * 32;

                    elementHTML = `
                        <div class="status-element-box">
                            <span class="element-title">${T('SceneStatus.ui.alignment')}</span>
                            <span class="element-badge">
                                <span class="icon" style="background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.7); vertical-align: middle; margin-right: -4px;"></span>
                                <span style="vertical-align: middle;">${elementName}</span>
                            </span>
                        </div>
                    `;
                }
            }
        }
        const alignmentContainer = spread.querySelector("#status-alignment-container");
        if (alignmentContainer) alignmentContainer.innerHTML = elementHTML;

        // Traits
        let traitsHTML = "";
        if (actor._selectedTraits && actor._selectedTraits.length > 0) {
            actor._selectedTraits.forEach(trait => {
                let traitName = "";
                if (typeof trait.name === 'string' && trait.name.includes('.')) {
                    traitName = (i18nData ? resolveI18nPath(trait.name, i18nData) : null) || trait.name;
                } else if (trait.name && typeof trait.name === 'object') {
                    traitName = _pickLocalized(trait.name);
                } else {
                    traitName = trait.name || "";
                }

                // Resolve trait description
                let traitDesc = "";
                if (trait.description) {
                    if (typeof trait.description === 'object') {
                        traitDesc = _pickLocalized(trait.description);
                    } else {
                        traitDesc = String(trait.description);
                    }
                }

                const tx = (trait.icon % 16) * 32;
                const ty = Math.floor(trait.icon / 16) * 32;

                const tooltipContent = traitDesc
                    ? `<strong>${traitName}</strong>${traitDesc}`
                    : `<strong>${traitName}</strong>`;

                traitsHTML += `
                    <div class="status-trait-item">
                        <span class="icon" style="background: url('img/system/IconSet.png') -${tx}px -${ty}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.85); vertical-align: middle;"></span>
                        <div class="status-trait-tooltip">${tooltipContent}</div>
                    </div>
                `;
            });
        } else {
            traitsHTML = `<div style="font-family: 'Lora', serif; font-style: italic; color:var(--text-card-medium); font-size:0.8em; padding: 4px;">${T('SceneStatus.ui.noTraits')}</div>`;
        }
        const traitsEl = spread.querySelector("#status-traits");
        if (traitsEl) traitsEl.innerHTML = traitsHTML;

        // Class base skill (signature passive) sourced from BattleSystemPassiveSkills.
        const passiveLabelEl = spread.querySelector("#status-passive-label");
        if (passiveLabelEl) passiveLabelEl.textContent = T("SceneStatus.classAbility");
        const passiveEl = spread.querySelector("#status-class-passive");
        if (passiveEl) {
            const api = window.BattleSystemPassiveSkills;
            const passiveClassId = actorClass ? actorClass.id : 0;
            const passiveName = api && passiveClassId ? api.getPassiveName(passiveClassId) : "";
            const passiveEffect = api && passiveClassId ? api.getPassiveEffect(passiveClassId) : "";
            if (passiveName) {
                passiveEl.innerHTML = `
                    <div style="font-weight:bold; color:var(--text-primary-hover); font-size:0.92em; margin-bottom:2px;">${passiveName}</div>
                    <div style="color:var(--text-card-medium); font-size:0.8em; line-height:1.3;">${passiveEffect}</div>
                `;
            } else {
                passiveEl.innerHTML = `<div style="font-style:italic; color:var(--text-card-medium); font-size:0.8em;">${T('SceneStatus.ui.noClassAbility')}</div>`;
            }
        }

        // Biological Body Parts List
        if (!actor._bodyParts && window.initializeBodyParts) {
            window.initializeBodyParts(actor);
        }
        const bodyParts = [];
        if (actor._bodyParts) {
            for (const key in actor._bodyParts) {
                if (actor._bodyParts[key]) bodyParts.push(actor._bodyParts[key]);
            }
        }
        bodyParts.sort((a, b) => {
            const aD = (a.destroyed || a.currentHp <= 0) ? 0 : 1;
            const bD = (b.destroyed || b.currentHp <= 0) ? 0 : 1;
            return aD - bD;
        });

        let bodyPartsHTML = "";
        if (bodyParts.length === 0) {
            bodyPartsHTML = `<div style="font-family: 'Lora', serif; font-style: italic; text-align: center; color: var(--text-card-medium); padding: 12px; font-size:0.85em;">${T('SceneStatus.ui.noVitals')}</div>`;
        } else {
            bodyParts.forEach((part, idx) => {
                const isDestroyed = part.destroyed || part.currentHp <= 0;
                const hpRate = part.maxHp > 0 ? (part.currentHp / part.maxHp) : 0;
                const hpPercent = Math.round(hpRate * 100);
                const isSelected = (this._dndActiveSection === "bodyparts" && this._dndSelectedIndex === idx) ? "selected" : "";
                const strikeClass = isDestroyed ? "destroyed" : "";
                const hpText = isDestroyed ? "DESTROYED" : `${part.currentHp}/${part.maxHp}`;
                const barWidth = isDestroyed ? 0 : hpPercent;
                const partName = (typeof part.name === 'string' && part.name.includes('.') && window.getArchetypeText)
                    ? window.getArchetypeText(part.name)
                    : part.name;

                bodyPartsHTML += `
                    <div class="bodypart-row ${isSelected} ${strikeClass}" onclick="SceneManager._scene.selectUIBodyPart(${idx})">
                        <span class="bodypart-name">${partName}</span>
                        <div class="bodypart-hp-container">
                            <div class="bodypart-bar" style="width: ${barWidth}%"></div>
                            <span class="bodypart-hp-val">${hpText}</span>
                        </div>
                    </div>
                `;
            });
        }
        const bodyPartsEl = spread.querySelector("#bodyparts-scroll-container");
        if (bodyPartsEl) bodyPartsEl.innerHTML = bodyPartsHTML;

        // 4. Draw bust portrait canvas
        this.drawUIStatusBust(actor, "status-bust");

        // 5. Scroll selected body part into view if active
        if (this._dndActiveSection === "bodyparts") {
            const selectedPart = spread.querySelector(".bodypart-row.selected");
            if (selectedPart) {
                selectedPart.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    };

    Scene_Status.prototype.drawUIStatusBust = function (actor, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Creature actors render a live procedural 3D model (reusing the Bestiary
        // viewport) in place of the flat 2D enemy battler, when the 3D battler
        // system is active and the chosen battler maps to a model.
        const info3D = this.getStatus3DInfo(actor);
        if (info3D) {
            canvas.style.display = 'none';
            this.syncStatus3D(info3D);
            return;
        }
        // Not a 3D creature: tear down any prior viewer and show the 2D portrait.
        this.cleanupStatus3D();
        canvas.style.display = '';

        const bustPath = getActorBustImagePath(actor);
        if (!bustPath) return;

        const bitmap = ImageManager.loadBitmap('', bustPath);
        const drawBust = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = true;

            const shouldCrop = false;
            const sourceWidth = bitmap.width > 0 ? bitmap.width : 889;
            const sourceHeight = bitmap.height > 0 ? bitmap.height : 1200;

            let cropTop = 0;
            let cropLeft = 0;
            let croppedSourceWidth = sourceWidth;
            let croppedSourceHeight = sourceHeight;

            const aspectRatio = croppedSourceWidth / croppedSourceHeight;
            let drawWidth = canvas.width;
            let drawHeight = Math.round(canvas.width / aspectRatio);

            if (drawHeight > canvas.height) {
                drawHeight = canvas.height;
                drawWidth = Math.round(canvas.height * aspectRatio);
            }

            const drawX = Math.round((canvas.width - drawWidth) / 2);
            const drawY = Math.round((canvas.height - drawHeight) / 2);

            ctx.drawImage(bitmap.canvas, cropLeft, cropTop, croppedSourceWidth, croppedSourceHeight, drawX, drawY, drawWidth, drawHeight);
        };

        if (bitmap.isReady()) {
            drawBust();
        } else {
            bitmap.addLoadListener(drawBust);
        }
    };

    //=============================================================================
    // 3D portrait viewport for creature actors (ported from Bestiary.js).
    // Only used when the 3D battler system is active and the actor's chosen
    // battler image resolves to a procedural archetype.
    //=============================================================================

    Scene_Status.prototype.getStatus3DInfo = function (actor) {
        if (!actor) return null;
        if (!(typeof THREE !== 'undefined' && window.Battler3D && window.Battler3D.create && window.Battler3D.resolveKey)) return null;
        // Portrait style is an exclusive choice made at character creation and
        // stored on the actor: a humanoid is EITHER a drawn bust OR a 3D model,
        // a creature EITHER a 2D battler image OR a 3D model. Anything but
        // "model" renders flat art, even when a stale 3D config is still around.
        // An unset value (characters made before the choice existed) keeps the
        // old behaviour of preferring the 3D model when one resolves.
        const portraitMode = typeof actor.portraitMode === 'function' ? actor.portraitMode() : 0;
        if (portraitMode === 'bust' || portraitMode === 'sprite') return null;
        // A monster recruited through the talk system records the enemy it came
        // from, so its own bespoke model is built instead of the first enemy
        // that happens to share the same battler art. The record is ignored once
        // the slot's portrait no longer matches it (a later character rewrote
        // the slot and never cleared the id).
        const recruitedId = actor._recruitedEnemyId;
        const recruited = recruitedId ? $dataEnemies[recruitedId] : null;
        const battlerField = typeof actor.vnBattler === 'function' ? actor.vnBattler() : null;
        if (recruited && battlerField && recruited.battlerName === battlerField) {
            const recruitKey = window.Battler3D.resolveKey(recruited);
            if (recruitKey) {
                return { kind: 'enemy', archKey: recruitKey, enemyId: recruited.id, actorId: actor.actorId() };
            }
        }
        // Creature monster form: getActorBustImagePath returns an img/enemies/
        // path precisely in that case, and the flat 2D enemy battler is
        // replaced by its procedural 3D model.
        const bustPath = getActorBustImagePath(actor);
        const marker = 'img/enemies/';
        if (bustPath && bustPath.includes(marker)) {
            const battlerName = bustPath.substring(bustPath.indexOf(marker) + marker.length);
            if (!battlerName) return null;
            // Resolve the procedural model from the enemy whose battler image matches.
            for (const enemy of $dataEnemies) {
                if (!enemy || enemy.battlerName !== battlerName) continue;
                const key = window.Battler3D.resolveKey(enemy);
                if (key) return { kind: 'enemy', archKey: key, enemyId: enemy.id, actorId: actor.actorId() };
            }
            return null;
        }
        // Humanoid actors with a saved character-creation 3D model config
        // render their customized procedural model instead of the flat bust.
        if (window.CC3DModel && window.CC3DModel.isAvailable && window.CC3DModel.isAvailable()) {
            const cfg = window.CC3DModel.getConfig(actor.actorId());
            if (cfg) return { kind: 'custom', cfg: cfg, actorId: actor.actorId() };
        }
        return null;
    };

    // Stable identity for a 3D portrait: rebuilding is only needed when the
    // subject actually changes (different creature, edited custom config).
    function status3DKey(info) {
        return info.kind === 'custom'
            ? 'custom:' + info.actorId + ':' + JSON.stringify(info.cfg)
            : 'enemy:' + info.enemyId;
    }

    Scene_Status.prototype.syncStatus3D = function (info) {
        const canvas = document.getElementById('status-bust-3d');
        const key = status3DKey(info);
        // Already showing this subject on a live canvas: just refresh which
        // limbs are hidden (they may have broken/healed since), then bail.
        if (this._status3D && canvas && this._status3D.canvas === canvas && this._status3DKey === key) {
            const m = this._status3D.model;
            const parts = (this.actor() && this.actor()._bodyParts) || null;
            if (m && parts && m.hideBrokenParts) { try { m.hideBrokenParts(parts); } catch (e) {} }
            return;
        }
        this._status3DKey = key;
        this.initStatus3D(info);
    };

    Scene_Status.prototype.initStatus3D = function (info) {
        this.cleanupStatus3D();
        if (typeof THREE === 'undefined' || !window.Battler3D || !window.Battler3D.create) return;
        const bustCanvas = document.getElementById('status-bust');
        const wrapper = bustCanvas ? bustCanvas.parentNode : null;
        if (!wrapper) return;

        // Reuse or create the 3D canvas overlay, sized to match the bust area.
        let canvas = document.getElementById('status-bust-3d');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'status-bust-3d';
            canvas.style.cssText = 'width:440px; height:500px; display:block; cursor:grab;';
            wrapper.appendChild(canvas);
        }
        canvas.style.display = 'block';

        const width = 440, height = 500;
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(width, height, false);
        renderer.setPixelRatio(1);

        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const keyLight  = new THREE.DirectionalLight(0xfff2d0, 0.85); keyLight.position.set(3, 5, 4);   scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.35); fillLight.position.set(-3, -2, 2); scene.add(fillLight);

        const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 300);
        camera.position.set(0, 0, 8);

        const pivot = new THREE.Group();
        scene.add(pivot);

        const state = {
            renderer, canvas, scene, camera, pivot,
            model: null, rafId: 0, disposed: false, dragging: false, attackTimer: 0, frameAcc: 0,
            activeButton: -1, prev: { x: 0, y: 0 }, clock: new THREE.Clock(), listeners: {}
        };
        this._status3D = state;

        // Build the subject: a creature's archetype model (rebuilt with the
        // random look seed rolled at creation, when one was saved) or the
        // custom humanoid assembled in the character-creation 3D step.
        let loadPromise;
        if (info.kind === 'custom') {
            loadPromise = window.CC3DModel.buildModel(info.cfg, info.actorId);
        } else {
            const fakeBattler = { enemyId: () => info.enemyId, index: () => 0 };
            const storedSeed = (window.CC3DModel && window.CC3DModel.getCreatureSeed)
                ? window.CC3DModel.getCreatureSeed(info.actorId) : null;
            const make = () => window.Battler3D.create(info.archKey, 0, 0, fakeBattler);
            const built = (storedSeed && window.CC3DModel && window.CC3DModel.withGenSeed)
                ? window.CC3DModel.withGenSeed(storedSeed, make) : make();
            if (!built) {
                try { renderer.dispose(); } catch (e) {}
                try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) {}
                this._status3D = null;
                return;
            }
            loadPromise = Promise.resolve(built.load(null, 0, 0, 0)).then(() => built);
        }

        // Reflect this creature's broken limbs: hide the meshes of any destroyed
        // body part (root parts are protected by the model, so it never blanks
        // the whole figure).
        const brokenParts = (this.actor() && this.actor()._bodyParts) || null;

        loadPromise.then((battler) => {
            if (!battler || state.disposed || !battler.model) return;
            try { battler.update(1 / 60); } catch (e) {}
            try { if (brokenParts && battler.hideBrokenParts) battler.hideBrokenParts(brokenParts); } catch (e) {}
            const box    = new THREE.Box3().setFromObject(battler.model);
            const size   = new THREE.Vector3(); box.getSize(size);
            const center = new THREE.Vector3(); box.getCenter(center);
            const holder = new THREE.Group();
            holder.position.copy(center).multiplyScalar(-1);
            holder.add(battler.model);
            if (window.PSXShader) window.PSXShader.applyToObject(battler.model);
            pivot.add(holder);
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const fitDist = maxDim / (2 * Math.tan((40 * Math.PI / 180) / 2));
            camera.position.set(0, 0, fitDist * 1.2);
            camera.lookAt(0, 0, 0);
            state.model = battler;
            state.attackTimer = 1.2;
        }).catch(() => {});

        // ── Mouse / touch controls (mirror the Bestiary 3D preview) ─────────
        const L = state.listeners;
        L.onDown = (e) => {
            if (e.button === 0 || e.button === 1) {
                state.activeButton = e.button; state.dragging = true;
                state.prev = { x: e.clientX, y: e.clientY };
                if (e.button === 1) e.preventDefault();
                canvas.style.cursor = 'grabbing';
            }
        };
        L.onMove = (e) => {
            if (state.activeButton === -1) return;
            const dx = e.clientX - state.prev.x, dy = e.clientY - state.prev.y;
            if (state.activeButton === 0) {
                pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012;
            } else if (state.activeButton === 1) {
                const ps = 0.0035 * camera.position.z;
                camera.position.x -= dx * ps; camera.position.y += dy * ps;
            }
            state.prev = { x: e.clientX, y: e.clientY };
        };
        L.onUp = () => { state.activeButton = -1; state.dragging = false; canvas.style.cursor = 'grab'; };
        L.onWheel = (e) => {
            e.preventDefault();
            e.stopPropagation();
            camera.position.z = Math.max(1.5, Math.min(60, camera.position.z + e.deltaY * 0.012));
        };
        L.onAux = (e) => { if (e.button === 1) e.preventDefault(); };
        L.onCtx = (e) => e.preventDefault();
        L.onTStart = (e) => { if (e.touches.length === 1) { state.dragging = true; state.activeButton = 0; state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } };
        L.onTMove = (e) => {
            if (e.touches.length === 1) {
                const dx = e.touches[0].clientX - state.prev.x, dy = e.touches[0].clientY - state.prev.y;
                pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012;
                state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        };
        L.onTEnd = () => { state.dragging = false; state.activeButton = -1; };

        canvas.addEventListener('mousedown',   L.onDown);
        canvas.addEventListener('mousemove',   L.onMove);
        window.addEventListener('mouseup',     L.onUp);
        canvas.addEventListener('wheel',       L.onWheel, { passive: false });
        canvas.addEventListener('auxclick',    L.onAux);
        canvas.addEventListener('contextmenu', L.onCtx);
        canvas.addEventListener('touchstart',  L.onTStart);
        canvas.addEventListener('touchmove',   L.onTMove);
        window.addEventListener('touchend',    L.onTEnd);

        const FRAME = 1 / 30;
        const animate = () => {
            if (state.disposed) return;
            state.rafId = requestAnimationFrame(animate);
            state.frameAcc += Math.min(state.clock.getDelta(), 0.05);
            if (state.frameAcc < FRAME) return;
            const dt = state.frameAcc;
            state.frameAcc = 0;
            if (state.model) {
                state.attackTimer -= dt;
                if (state.attackTimer <= 0 && state.model.currentAnimation === 'idle') {
                    const anim = (state.model.hasAnimation('specialattack') && Math.random() < 0.4)
                        ? 'specialattack' : 'attack';
                    try { state.model.playAnimation(anim, false); } catch (e) {}
                    state.attackTimer = 2.4 + Math.random() * 1.6;
                }
                try { state.model.update(dt); } catch (e) {}
            }
            if (window.PSXShader) {
                window.PSXShader.render(renderer, scene, camera);
            } else {
                renderer.render(scene, camera);
            }
        };
        animate();
    };

    Scene_Status.prototype.cleanupStatus3D = function () {
        const s = this._status3D;
        this._status3DKey = null;
        if (!s) return;
        s.disposed = true;
        cancelAnimationFrame(s.rafId);
        const L = s.listeners || {}, c = s.canvas;
        if (c) {
            c.removeEventListener('mousedown',   L.onDown);
            c.removeEventListener('mousemove',   L.onMove);
            c.removeEventListener('wheel',       L.onWheel);
            c.removeEventListener('auxclick',    L.onAux);
            c.removeEventListener('contextmenu', L.onCtx);
            c.removeEventListener('touchstart',  L.onTStart);
            c.removeEventListener('touchmove',   L.onTMove);
            if (c.parentNode) c.parentNode.removeChild(c);
        }
        window.removeEventListener('mouseup',  L.onUp);
        window.removeEventListener('touchend', L.onTEnd);
        // dispose() leaves the WebGL context alive. The browser caps live
        // contexts and force-loses the OLDEST past the cap, which is the game's
        // own canvas: PIXI then silently stops rendering and the picture freezes
        // until the game is restarted. A fresh canvas is built on every open, so
        // releasing the context here costs nothing.
        try { s.renderer.dispose(); } catch (e) {}
        try { if (s.renderer.forceContextLoss) s.renderer.forceContextLoss(); } catch (e) {}
        this._status3D = null;
    };

    Scene_Status.prototype.selectUIActor = function (index) {
        if (index >= 0 && index < $gameParty.allMembers().length) {
            this._actorIndex = index;
            SoundManager.playCursor();
            this.refreshActor();
        }
    };

    Scene_Status.prototype.selectUIBodyPart = function (index) {
        this._dndActiveSection = "bodyparts";
        this._dndSelectedIndex = index;
        SoundManager.playCursor();
        this.refreshUIStatus();
    };

    Scene_Status.prototype.getUIReproductionName = function (type) {
        switch (type) {
            case -1: return T("MainMenu.reproduction.none");
            case 0: return T("MainMenu.reproduction.testicles");
            case 1: return T("MainMenu.reproduction.uterus");
            case 2: return T("MainMenu.reproduction.oviparous");
            case 3: return T("MainMenu.reproduction.plant");
            case 4: return T("MainMenu.reproduction.mitosis");
            default: return T("MainMenu.reproduction.unknown");
        }
    };

    Scene_Status.prototype.getUIGenderName = function (gender) {
        switch (gender) {
            case 0: return T("MainMenu.gender.male");
            case 1: return T("MainMenu.gender.female");
            case 2: return T("MainMenu.gender.nonBinary");
            case 3: return T("MainMenu.gender.cocoon");
            default: return T("MainMenu.gender.fluid");
        }
    };

    Scene_Status.prototype.updateUIStatusInput = function () {
        if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
            SoundManager.playCancel();
            this.popScene();
            return;
        }

        const allMembers = $gameParty.allMembers();

        if (Input.isTriggered('right') || Input.isTriggered('pagedown')) {
            this.nextActor();
            return;
        }

        if (Input.isTriggered('left') || Input.isTriggered('pageup')) {
            this.previousActor();
            return;
        }

        const actor = this.actor();
        if (actor && actor._bodyParts) {
            const bodyParts = [];
            for (const key in actor._bodyParts) {
                if (actor._bodyParts[key]) bodyParts.push(actor._bodyParts[key]);
            }

            if (bodyParts.length > 0) {
                if (Input.isRepeated('down')) {
                    this._dndActiveSection = "bodyparts";
                    this._dndSelectedIndex = (this._dndSelectedIndex + 1) % bodyParts.length;
                    SoundManager.playCursor();
                    this.refreshUIStatus();
                    return;
                }
                if (Input.isRepeated('up')) {
                    this._dndActiveSection = "bodyparts";
                    this._dndSelectedIndex = (this._dndSelectedIndex - 1 + bodyParts.length) % bodyParts.length;
                    SoundManager.playCursor();
                    this.refreshUIStatus();
                    return;
                }
            }
        }
    };

    //=============================================================================
    // Window Constructors & Stub Prototypes for MZ compatibility
    //=============================================================================

    function Window_CustomStatus() {
        this.initialize(...arguments);
    }
    Window_CustomStatus.prototype = Object.create(Window_StatusBase.prototype);
    Window_CustomStatus.prototype.constructor = Window_CustomStatus;
    Window_CustomStatus.prototype.initialize = function (rect) {
        Window_StatusBase.prototype.initialize.call(this, rect);
        this.visible = false;
        this.active = false;
    };
    Window_CustomStatus.prototype.setActor = function (actor) { };
    Window_CustomStatus.prototype.setActorIndex = function (index) { };

    function Window_StatusStates() {
        this.initialize(...arguments);
    }
    Window_StatusStates.prototype = Object.create(Window_Base.prototype);
    Window_StatusStates.prototype.constructor = Window_StatusStates;
    Window_StatusStates.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.visible = false;
        this.active = false;
    };
    Window_StatusStates.prototype.setActor = function (actor) { };

    function Window_StatusParams() {
        this.initialize(...arguments);
    }
    Window_StatusParams.prototype = Object.create(Window_Base.prototype);
    Window_StatusParams.prototype.constructor = Window_StatusParams;
    Window_StatusParams.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.visible = false;
        this.active = false;
    };
    Window_StatusParams.prototype.setActor = function (actor) { };

})();