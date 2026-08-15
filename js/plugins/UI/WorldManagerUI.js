//=============================================================================
// WorldManagerUI.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc World creation/management screen for the title menu (the "Worlds" command). Requires Core/WorldManager.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * WorldManagerUI.js
 * ============================================================================
 * DOM-based scene for creating, selecting and deleting world folders
 * (see Core/WorldManager.js). Opened from the title screen "Worlds" command,
 * which hosts both creating and managing worlds on one parchment spread.
 *
 * Layout follows the D&D double-page parchment theme (css/theme.css):
 *   - Left page: world list + "Create World" pockets entry.
 *   - Right page: selected world's dossier with tabs:
 *       Dossier , creation date, world date, savegame count, seed.
 *       History , scrollable timeline of historical events.
 *       Balance , hyperpowers military/economy standings.
 *       Wiki    , opens Scene_History (full-screen archive) for this world.
 *
 * World history is always simulated canonically from 1900 to 2000, there
 * is no per-world history length selection. Creating a world only lets the
 * player pick the world's STARTING DATE and seed. The starting date is two
 * separate spinners, month and year, jointly clamped to the January 2001 -
 * January 2012 window; both are reachable with keyboard/controller (Up/Down
 * moves between form rows, Left/Right or OK tunes the focused spinner).
 * NPC backstories and the world clock are advanced to that date the first
 * time a new game is started in the world.
 * ============================================================================
 */

(() => {
    "use strict";

    function tr(en, it) {
        return ConfigManager.language === "it" ? it : en;
    }

    function escapeHtml(str) {
        return String(str ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[c]);
    }

    //=========================================================================
    // World starting date (January 2001 - January 2012)
    //=========================================================================
    // The month and the year are picked separately, but the pair is always
    // clamped to the window above, so December 2012 is not reachable: the
    // window closes on January 2012.

    const START_YEAR_MIN = 2001;
    const START_YEAR_MAX = 2013;
    const START_MONTH_MAX = 1; // last selectable month of START_YEAR_MAX
    // The first year that begins AFTER 21 December 2012, so a world started in
    // it opens with Earth already gone and the Omega Tower standing in its
    // orbit (see GalaxySim.Nibiru and WorldMapTransfer.earthLost).
    const EARTH_LOST_YEAR = 2013;

    // What level the party is created at. A world can be begun by people who
    // are already somebody, which is the only way the later years are playable:
    // 2013 opens on monsters no level 1 party can stand in front of.
    // The spinner walks a fixed ladder rather than adding a step, so it is
    // symmetric (every press has an exact opposite), it always lands on a round
    // number, and twenty presses cover the whole range: single levels while they
    // still mean something, then fives, then tens, then the ceiling.
    const START_LEVEL_STOPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30,
                               40, 50, 60, 70, 80, 90, 99];
    const START_LEVEL_DEFAULT = START_LEVEL_STOPS[0];
    // The rung a stored level sits on (or the nearest one below it).
    function levelStopIndex(level) {
        let at = 0;
        for (let i = 0; i < START_LEVEL_STOPS.length; i++) {
            if (START_LEVEL_STOPS[i] <= level) at = i;
        }
        return at;
    }

    // Who the world is populated with. The list is WorldManager's (it owns the
    // stored value and the clamp); this is only the order the spinner walks
    // them in, which is deliberately "normal" first so an untouched form makes
    // the world every existing world already is. The choice is permanent: the
    // world is populated, historied and priced from it, so there is no setter
    // and the manage page prints it as a fact rather than a control.
    const POPULATION_MODES =
        (window.WorldManager && window.WorldManager.POPULATION_MODES) ||
        ["normal", "goblin", "monster", "empty"];
    const POPULATION_DEFAULT = POPULATION_MODES[0];

    function populationLabel(mode) {
        return T(`WorldManagerUI.populationModes.${mode}`);
    }

    // The one-line warning under the spinner saying what the mode costs you.
    // "normal" has nothing to say, so it draws nothing.
    function populationNoteFor(mode) {
        const note = T(`WorldManagerUI.populationNotes.${mode}`);
        return note && note.trim() ? note : "";
    }

    // How much magic the world has. A SEPARATE axis from the timeline above:
    // both are asked, both are permanent, and every combination of the two is
    // legal, so a severed-magic zombie apocalypse is a world you can make.
    // WorldManager owns the list and the clamp; this is only the order the
    // spinner walks them in.
    const MAGICAL_LEVELS =
        (window.WorldManager && window.WorldManager.MAGICAL_LEVELS) ||
        ["normal", "severed", "unbound"];
    const MAGICAL_DEFAULT = MAGICAL_LEVELS[0];

    function magicalLabel(level) {
        return T(`WorldManagerUI.magicalLevels.${level}`);
    }

    function magicalNoteFor(level) {
        const note = T(`WorldManagerUI.magicalNotes.${level}`);
        return note && note.trim() ? note : "";
    }

    // Month names live in js/i18n/<lang>/plugins/WorldManagerUI.json.

    // Default world seed. Owned by Core/WorldManager so the creation form and
    // the world it auto-creates on an empty world folder never disagree.
    const DEFAULT_WORLD_SEED = (window.WorldManager && window.WorldManager.DEFAULT_SEED) || "esoteric";

    function monthName(month) {
        return T.list("WorldManagerUI.months")[month - 1] || "";
    }

    // What starting later costs you. The year is not a cosmetic choice: every
    // spawn mode's level band climbs with the calendar (see the "Squishing"
    // block in BattleSystemEnhancedEncounters, section 4b), so a world begun in
    // 2005 opens with monsters a fresh party cannot fight. Say so on the form
    // rather than let the player find out on the first tile.
    const ENEMY_YEAR_STEP     = 10;   // levels a year adds, to 2010
    const ENEMY_OPEN_YEAR     = 2010; // the whole table comes loose
    const ENEMY_OPEN_CEILING  = 110;
    const ENEMY_COLLAPSE_YEAR = 2012;
    const ENEMY_COLLAPSE_FLOOR = 80;

    // The line shown under the date, or "" for 2001 (nothing to warn about).
    function enemyLevelNoticeFor(year) {
        if (year >= ENEMY_COLLAPSE_YEAR) {
            return T("WorldManagerUI.enemyFloorCollapse", { level: ENEMY_COLLAPSE_FLOOR });
        }
        if (year >= ENEMY_OPEN_YEAR) {
            return T("WorldManagerUI.enemyFloorOpen", { level: ENEMY_OPEN_CEILING });
        }
        const floor = Math.max(0, year - START_YEAR_MIN) * ENEMY_YEAR_STEP;
        if (floor <= 0) return "";
        return T("WorldManagerUI.enemyFloor", { level: floor });
    }

    // The other thing a 2013 start costs, and it is not a difficulty setting:
    // the world begins after the impact, so there is no Earth to walk on. Said
    // plainly on the form, because nothing about "2013" says it on its own.
    function earthLostNoticeFor(year) {
        return year >= EARTH_LOST_YEAR ? T("WorldManagerUI.earthLost") : "";
    }

    // Months since January 2001, the single ordering the two spinners clamp on.
    function dateToIndex(year, month) {
        return (year - START_YEAR_MIN) * 12 + (month - 1);
    }

    const START_INDEX_MIN = 0;
    const START_INDEX_MAX = dateToIndex(START_YEAR_MAX, START_MONTH_MAX);

    function indexToDate(index) {
        const clamped = Math.min(Math.max(index, START_INDEX_MIN), START_INDEX_MAX);
        return { year: START_YEAR_MIN + Math.floor(clamped / 12), month: (clamped % 12) + 1 };
    }

    // Clamps a (year, month) pair into the selectable window.
    function clampStartDate(year, month) {
        const y = Math.min(Math.max(year, START_YEAR_MIN), START_YEAR_MAX);
        const m = Math.min(Math.max(month, 1), 12);
        return indexToDate(dateToIndex(y, m));
    }

    // World clock minutes for the 1st of the given month at 10:00, the epoch
    // TimeDateSystem decodes from (1 January 2001, 10:00 = minute 0). The day
    // count is computed in UTC on purpose: subtracting two local timestamps
    // loses/gains an hour across a DST boundary, which would land summer start
    // dates on 09:00 instead of 10:00.
    function minutesForStartDate(year, month) {
        const minutes = (Date.UTC(year, month - 1, 1) - Date.UTC(2001, 0, 1)) / 60000;
        return Math.max(0, Math.round(minutes));
    }

    //=========================================================================
    // Historical Archive card rendering (mirrors History/HistorySimulatorUI.js)
    //=========================================================================

    // Resolved lazily: the global may be populated after this plugin loads.
    function getCountries() { return window.HistorySimulator_COUNTRIES || {}; }

    // i18n-ignore-start: theme tokens
    function categoryVars(category) {
        const map = {
            'military':   { color: 'var(--text-secondary-active, #822d2d)',  bg: 'var(--shadow-soft-active-translucent-25, rgba(130,45,45,0.05))' },
            'political':  { color: 'var(--text-text-alt-5-hover, #b05c3c)',  bg: 'var(--border-primary-hover-translucent-15, rgba(176,92,60,0.05))' },
            'internal':   { color: 'var(--text-text-alt-5-hover, #b05c3c)',  bg: 'var(--border-primary-hover-translucent-15, rgba(176,92,60,0.05))' },
            'economic':   { color: 'var(--text-text-alt-3, #2b5e3c)',        bg: 'var(--bg-bg-alt-7-translucent-12, rgba(43,94,60,0.05))' },
            'social':     { color: 'var(--text-text-alt-16, #3d5e75)',       bg: 'var(--bg-bg-alt-6-translucent-12, rgba(61,94,117,0.05))' },
            'paranormal': { color: 'var(--bg-bg-alt-14, #5a3d75)',           bg: 'var(--bg-bg-alt-15-translucent-12, rgba(90,61,117,0.05))' },
            'royal':      { color: 'var(--text-text-alt-19, #8c4375)',       bg: 'var(--border-primary-hover-translucent-15, rgba(140,67,117,0.05))' },
            'artifact':   { color: '#a07820',                                bg: 'rgba(160,120,32,0.07)' }
        };
        return map[category] || { color: 'var(--border-muted-focus, #8b5a2b)', bg: 'var(--border-secondary-hover-translucent-15, rgba(139,90,43,0.05))' };
    }

    // i18n-ignore-end
    function isArtifactEvent(evt) {
        return evt.category === 'artifact' || /artifact/i.test(evt.description || '');
    }

    const ARTIFACT_BADGE = `<span class="wm-card-badge" style="color:#a07820; background:rgba(160,120,32,0.1); border:1px solid #a0782050">${T('WorldManager.ui.artifactBadge')}</span>`;

    function renderHistoryEvents(events) {
        if (!events || events.length === 0) {
            return `<div class="wm-empty">${T('WorldManagerUI.noTimelineRecordsFound')}</div>`;
        }
        return events.map(evt => {
            const cv = categoryVars(evt.category);
            const dateParts = String(evt.date || "").split('-');
            const formattedDate = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : evt.date;
            const artifactTag = isArtifactEvent(evt) ? ARTIFACT_BADGE : "";
            return `
                <div class="wm-event-card" style="border-left:5px solid ${cv.color}">
                    <div class="wm-card-header">
                        <span class="wm-card-date">${escapeHtml(formattedDate)}</span>
                        <span class="wm-card-badge" style="color:${cv.color}; background:${cv.bg}; border:1px solid ${cv.color}30">${escapeHtml(evt.category)}</span>
                        ${artifactTag}
                    </div>
                    <div class="wm-card-desc">${escapeHtml(evt.description)}</div>
                    ${evt.results ? `<div class="wm-card-results">${escapeHtml(evt.results)}</div>` : ""}
                </div>
            `;
        }).join("");
    }

    function renderHyperpowers(hyperpowers) {
        const powersList = Object.entries(hyperpowers || {})
            .sort((a, b) => (b[1].military + b[1].economy) - (a[1].military + a[1].economy));
        if (powersList.length === 0) return "";

        let html = `<div class="cc-dossier-card"><div class="cc-subheader">${T('WorldManagerUI.hyperpowersBalance')}</div>`;
        powersList.slice(0, 3).forEach(([name, data]) => {
            const milPct = Math.min(100, Math.max(5, (data.military / 300) * 100));
            const ecoPct = Math.min(100, Math.max(5, (data.economy / 250) * 100));
            const controlled = [];
            for (const [cName, cData] of Object.entries(getCountries())) {
                if (cData.controller === name) controlled.push(cName);
            }
            const territories = controlled.slice(0, 3).join(", ") + (controlled.length > 3 ? "..." : "");
            html += `
                <div style="border-bottom:1px dashed var(--scroll-thumb-hover-translucent-60, rgba(139,90,43,0.25)); padding-bottom:8px; margin-bottom:8px">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px">
                        <strong style="font-size:1.02rem; color:var(--text-primary-hover, #2b1c11)">${escapeHtml(name)}</strong>
                        <span style="font-size:0.854rem; color:var(--text-disabled, #5c4b3d); font-family:'Courier Prime', monospace">${escapeHtml(territories)}</span>
                    </div>
                    <div class="cc-dossier-row">
                        <span class="cc-dossier-label">${T('WorldManager.ui.military')}</span>
                        <div class="cc-progress-container"><div class="cc-progress-fill" style="width:${milPct}%; background:var(--text-secondary-active, #822d2d)"></div></div>
                        <span class="cc-dossier-value">${Math.floor(data.military)}</span>
                    </div>
                    <div class="cc-dossier-row">
                        <span class="cc-dossier-label">${T('WorldManager.ui.economy')}</span>
                        <div class="cc-progress-container"><div class="cc-progress-fill" style="width:${ecoPct}%; background:var(--text-text-alt-3, #2b5e3c)"></div></div>
                        <span class="cc-dossier-value">${Math.floor(data.economy)}</span>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        return html;
    }

    //=========================================================================
    // Input manager, keyboard + controller navigation
    //=========================================================================

    // "wiki" is intentionally last, pressing OK on it pushes Scene_History
    // rather than switching tab content, so it never becomes _rightTab.
    const RIGHT_TABS = ["info", "history", "balance", "diaries", "wiki"];

    const WorldManageInputManager = {
        _scene: null,
        _active: false,

        activate(scene) { this._scene = scene; this._active = true; },
        deactivate()    { this._active = false; this._scene = null; },

        _consumeWasd(scene) {
            const w = scene._wasdInput;
            if (!w) return null;
            let dir = null;
            if (w.up) dir = "up";
            else if (w.down) dir = "down";
            else if (w.left) dir = "left";
            else if (w.right) dir = "right";
            w.up = w.down = w.left = w.right = false;
            return dir;
        },

        update() {
            if (!this._active || !this._scene) return;
            const scene = this._scene;
            if (scene._busy || !scene._container) { this._consumeWasd(scene); return; }

            // While the confirmation window is open, swallow background navigation;
            // only let cancel/escape dismiss it.
            if (scene._confirmOverlay) {
                this._consumeWasd(scene);
                if (Input.isTriggered("cancel") || Input.isTriggered("escape") || TouchInput.isCancelled()) {
                    TouchInput.clear();
                    SoundManager.playCancel();
                    scene._closeConfirm();
                } else if (Input.isTriggered("ok")) {
                    scene._confirmConfirm();
                }
                return;
            }

            const ae = document.activeElement;
            const typing = !!(ae && scene._container.contains(ae) &&
                (ae.tagName === "INPUT" || ae.tagName === "SELECT"));

            if (Input.isTriggered("cancel") || Input.isTriggered("escape") || TouchInput.isCancelled()) {
                TouchInput.clear();
                this._consumeWasd(scene);
                SoundManager.playCancel();
                if (typing) {
                    ae.blur();
                    scene._applyFocusHighlight();
                } else if (scene._creatingWorld) {
                    // Only closable when there is a world to fall back to;
                    // otherwise Escape leaves the whole screen, as before.
                    if (scene._focusables("list").length > 0) scene.closeCreateModal();
                    else scene.popScene();
                } else if (scene._focusSection === "tabs" || scene._focusSection === "actions") {
                    scene._setFocus(scene._focusables("list").length > 0 ? "list" : "newworld", 0);
                } else {
                    scene.popScene();
                }
                return;
            }

            if (typing) { this._consumeWasd(scene); return; }

            const wasdDir = this._consumeWasd(scene);
            if (wasdDir) { this.handleMove(wasdDir); return; }

            if (!scene._creatingWorld && (Input.isTriggered("pageup") || Input.isTriggered("pagedown"))) {
                if (scene._selectedWorld) {
                    const dir  = Input.isTriggered("pageup") ? -1 : 1;
                    const next = (RIGHT_TABS.indexOf(scene._rightTab) + dir + RIGHT_TABS.length) % RIGHT_TABS.length;
                    scene._focusSection = "tabs";
                    scene._focusIndex   = next;
                    scene.onSelectTab(RIGHT_TABS[next]);
                }
                return;
            }

            if (Input.isRepeated("up"))         this.handleMove("up");
            else if (Input.isRepeated("down"))  this.handleMove("down");
            else if (Input.isRepeated("left"))  this.handleMove("left");
            else if (Input.isRepeated("right")) this.handleMove("right");
            else if (Input.isTriggered("ok"))   this.handleOk();
        },

        handleMove(dir) {
            const scene = this._scene;
            const sec   = scene._focusSection;
            const idx   = scene._focusIndex;
            const els   = scene._focusables(sec);
            const hasWorlds      = scene._focusables("list").length > 0;
            const rightAvailable = !!scene._selectedWorld;
            const canCloseModal  = scene._creatingWorld && hasWorlds;

            // The create form is a modal: while it is open, navigation is
            // trapped inside it (plus its own close button, when closable)
            // rather than reaching the list or the right page behind it.
            if (scene._creatingWorld) {
                if (sec === "create") {
                    const focusedId = els[idx] ? els[idx].id : "";
                    if (dir === "up") {
                        if (idx > 0)                        scene._setFocus("create", idx - 1);
                        else if (canCloseModal)             scene._setFocus("modalclose", 0);
                    } else if (dir === "down") {
                        if (idx < els.length - 1)           scene._setFocus("create", idx + 1);
                    } else if ((dir === "left" || dir === "right") && focusedId === "wm-start-month") {
                        // Left/Right tunes the focused spinner; Up/Down still moves
                        // between the form rows, so a controller reaches everything.
                        scene._changeStartMonth(dir === "left" ? -1 : 1);
                    } else if ((dir === "left" || dir === "right") && focusedId === "wm-start-year") {
                        scene._changeStartYear(dir === "left" ? -1 : 1);
                    } else if ((dir === "left" || dir === "right") && focusedId === "wm-start-level") {
                        scene._changeStartLevel(dir === "left" ? -1 : 1);
                    } else if ((dir === "left" || dir === "right") && focusedId === "wm-population") {
                        scene._changePopulationMode(dir === "left" ? -1 : 1);
                    } else if ((dir === "left" || dir === "right") && focusedId === "wm-magic") {
                        scene._changeMagicalLevel(dir === "left" ? -1 : 1);
                    } else if ((dir === "left" || dir === "right") && focusedId === "wm-beta-toggle") {
                        scene._toggleBetaSprites();
                    }
                } else if (sec === "modalclose") {
                    if (dir === "down")                     scene._setFocus("create", 0);
                }
                return;
            }

            if (sec === "list") {
                if (dir === "up"   && idx > 0)              scene._setFocus("list", idx - 1);
                else if (dir === "down") {
                    if (idx < els.length - 1)               scene._setFocus("list", idx + 1);
                    else                                    scene._setFocus("newworld", 0);
                }
                else if (dir === "right" && rightAvailable) scene._setFocus("tabs", RIGHT_TABS.indexOf(scene._rightTab));
            } else if (sec === "newworld") {
                if (dir === "up" && hasWorlds)              scene._setFocus("list", scene._focusables("list").length - 1);
                else if (dir === "down")                    scene._setFocus("back", 0);
                else if (dir === "right" && rightAvailable) scene._setFocus("tabs", RIGHT_TABS.indexOf(scene._rightTab));
            } else if (sec === "back") {
                if (dir === "up")                           scene._setFocus("newworld", 0);
                else if (dir === "right" && rightAvailable) scene._setFocus("tabs", RIGHT_TABS.indexOf(scene._rightTab));
            } else if (sec === "tabs") {
                if (dir === "left") {
                    if (idx > 0)                            scene._setFocus("tabs", idx - 1);
                    else                                    scene._setFocus(hasWorlds ? "list" : "newworld", 0);
                } else if (dir === "right" && idx < els.length - 1) {
                    scene._setFocus("tabs", idx + 1);
                } else if (dir === "down") {
                    // Any tab whose body ends in a button panel is walkable:
                    // the dossier's Set Active / Delete, and the diaries a
                    // world holds.
                    if (scene._focusables("actions").length > 0) {
                        scene._setFocus("actions", 0);
                    } else {
                        scene._scrollTabBody(60);
                    }
                } else if (dir === "up") {
                    scene._scrollTabBody(-60);
                }
            } else if (sec === "actions") {
                if (dir === "up") {
                    if (idx > 0)                            scene._setFocus("actions", idx - 1);
                    else                                    scene._setFocus("tabs", RIGHT_TABS.indexOf(scene._rightTab));
                } else if (dir === "down" && idx < els.length - 1) {
                    scene._setFocus("actions", idx + 1);
                } else if (dir === "left") {
                    scene._setFocus(hasWorlds ? "list" : "newworld", 0);
                }
            }
        },

        handleOk() {
            const scene = this._scene;
            const els   = scene._focusables(scene._focusSection);
            const el    = els[scene._focusIndex];
            if (!el) return;

            if (scene._focusSection === "tabs") {
                scene.onSelectTab(RIGHT_TABS[scene._focusIndex] || "info");
                return;
            }
            if (el.disabled) {
                SoundManager.playBuzzer();
                return;
            }
            if (el.tagName === "INPUT" || el.tagName === "SELECT") {
                el.focus();
                return;
            }
            // OK on a spinner advances it, matching Right.
            if (el.id === "wm-start-month") {
                scene._changeStartMonth(1);
                return;
            }
            if (el.id === "wm-start-year") {
                scene._changeStartYear(1);
                return;
            }
            if (el.id === "wm-start-level") {
                scene._changeStartLevel(1);
                return;
            }
            if (el.id === "wm-population") {
                scene._changePopulationMode(1);
                return;
            }
            if (el.id === "wm-magic") {
                scene._changeMagicalLevel(1);
                return;
            }
            el.click();
        },
    };

    //=========================================================================
    // Scene_WorldManage
    //=========================================================================

    class Scene_WorldManage extends Scene_MenuBase {
        static _mode = "manage"; // "manage" | "create"

        static prepare(mode) {
            this._mode = mode || "manage";
        }

        create() {
            super.create();
            const WM = window.WorldManager;
            const worlds = WM ? WM.listWorlds() : [];
            const active = WM && WM.activeWorldName;
            // Open on whichever world is already active, so the dossier the
            // player last cared about is what greets them.
            this._selectedWorld = (active && worlds.some(w => w.name === active)) ? active : null;
            this._rightTab = "info"; // "info" | "history" | "balance"  (never "wiki", that pushes a scene)
            // The create form is a modal: it opens by itself when there is no
            // world to fall back to (mirrors the old "create" mode), otherwise
            // it stays closed until the player asks for it.
            this._creatingWorld = Scene_WorldManage._mode === "create" || worlds.length === 0;
            this._focusSection = this._creatingWorld ? "create"
                : (worlds.length > 0 ? "list" : "newworld");
            this._focusIndex = 0;
            this._suggestedName = window.WorldManager.randomWorldName();
            this._seedValue = DEFAULT_WORLD_SEED;
            this._startYear = START_YEAR_MIN;
            this._startMonth = 1;
            this._startLevel = START_LEVEL_DEFAULT;
            this._populationMode = POPULATION_DEFAULT;
            this._magicalLevel = MAGICAL_DEFAULT;
            this._betaSprites = false;
            this._wasdInput = { up: false, down: false, left: false, right: false };
            this.createUIDOM();
            WorldManageInputManager.activate(this);
        }

        terminate() {
            WorldManageInputManager.deactivate();
            super.terminate();
            this.removeUIDOM();
        }

        update() {
            super.update();
            WorldManageInputManager.update();
        }

        _focusables(section) {
            const c = this._container;
            if (!c) return [];
            switch (section) {
                case "list":       return [...c.querySelectorAll(".wm-world-row")];
                case "newworld":   return [document.getElementById("wm-create-open-btn")].filter(Boolean);
                case "create":     return ["wm-name-input", "wm-start-month", "wm-start-year",
                                        "wm-start-level", "wm-population", "wm-magic", "wm-seed-input",
                                        "wm-seed-random-btn", "wm-beta-toggle", "wm-create-btn"]
                                    .map(id => document.getElementById(id)).filter(Boolean);
                case "modalclose": return [document.getElementById("wm-create-close-btn")].filter(Boolean);
                case "back":    return [document.getElementById("wm-back-btn")].filter(Boolean);
                case "tabs":    return [...c.querySelectorAll(".wm-tabs .category-tab")];
                case "actions": return [...c.querySelectorAll(".cc-page-right .cc-button-panel .cc-btn-treaty")];
                default:        return [];
            }
        }

        _setFocus(section, index) {
            this._focusSection = section;
            this._focusIndex = Math.max(0, index);
            SoundManager.playCursor();
            this._applyFocusHighlight();
        }

        _applyFocusHighlight() {
            if (!this._container) return;
            this._container.querySelectorAll(".kb-focus").forEach(el => el.classList.remove("kb-focus"));
            let els = this._focusables(this._focusSection);
            if (els.length === 0) {
                this._focusSection = this._creatingWorld ? "create"
                    : (this._focusables("list").length > 0 ? "list" : "newworld");
                this._focusIndex = 0;
                els = this._focusables(this._focusSection);
            }
            if (this._focusIndex >= els.length) this._focusIndex = Math.max(0, els.length - 1);
            const el = els[this._focusIndex];
            if (el) {
                el.classList.add("kb-focus");
                el.scrollIntoView({ block: "nearest" });
            }
        }

        // Months cycle inside the year (December -> January); the year spinner
        // is what moves between years. The pair is clamped afterwards, so a
        // month that would overshoot January 2012 simply does not move.
        _changeStartMonth(delta) {
            let month = this._startMonth + delta;
            if (month > 12) month = 1;
            else if (month < 1) month = 12;
            this._setStartDate(this._startYear, month);
        }

        _changeStartYear(delta) {
            this._setStartDate(this._startYear + delta, this._startMonth);
        }

        _setStartDate(year, month) {
            const next = clampStartDate(year, month);
            if (next.year === this._startYear && next.month === this._startMonth) return;
            this._startYear = next.year;
            this._startMonth = next.month;
            this._refreshStartDate();
            SoundManager.playCursor();
        }

        // Writes the current start date into the two spinners without rebuilding
        // the form (which would drop typing focus and the keyboard highlight).
        _refreshStartDate() {
            const monthEl = document.getElementById("wm-start-month");
            if (monthEl) {
                monthEl.dataset.month = this._startMonth;
                const label = monthEl.querySelector(".wm-date-label");
                if (label) label.textContent = monthName(this._startMonth);
            }
            const yearEl = document.getElementById("wm-start-year");
            if (yearEl) {
                yearEl.dataset.year = this._startYear;
                const label = yearEl.querySelector(".wm-date-label");
                if (label) label.textContent = String(this._startYear);
            }
            const floorEl = document.getElementById("wm-enemy-floor");
            if (floorEl) {
                const notice = enemyLevelNoticeFor(this._startYear);
                floorEl.textContent = notice;
                floorEl.style.display = notice ? "" : "none";
            }
            const lostEl = document.getElementById("wm-earth-lost");
            if (lostEl) {
                const notice = earthLostNoticeFor(this._startYear);
                lostEl.textContent = notice;
                lostEl.style.display = notice ? "" : "none";
            }
        }

        _changeStartLevel(delta) {
            const from = this._startLevel || START_LEVEL_DEFAULT;
            const at = levelStopIndex(from) + Math.sign(delta);
            const next = START_LEVEL_STOPS[
                Math.max(0, Math.min(START_LEVEL_STOPS.length - 1, at))];
            if (next === from) return;
            this._startLevel = next;
            const el = document.getElementById("wm-start-level");
            if (el) {
                el.dataset.level = next;
                const label = el.querySelector(".wm-date-label");
                if (label) label.textContent = String(next);
            }
            SoundManager.playCursor();
        }

        // Who lives in this world. The spinner wraps (there is no "end" of the
        // list to walk off), and it repaints its own label and note rather than
        // rebuilding the form, which would drop the name being typed.
        _changePopulationMode(delta) {
            const at = POPULATION_MODES.indexOf(this._populationMode);
            const from = at < 0 ? 0 : at;
            const count = POPULATION_MODES.length;
            const next = POPULATION_MODES[(from + delta % count + count) % count];
            if (next === this._populationMode) return;
            this._populationMode = next;
            const el = document.getElementById("wm-population");
            if (el) {
                el.dataset.mode = next;
                const label = el.querySelector(".wm-date-label");
                if (label) label.textContent = populationLabel(next);
            }
            const noteEl = document.getElementById("wm-population-note");
            if (noteEl) {
                const note = populationNoteFor(next);
                noteEl.textContent = note;
                noteEl.style.display = note ? "" : "none";
            }
            SoundManager.playCursor();
        }

        // How much magic there is. Wraps like the timeline spinner and repaints
        // its own label and note rather than rebuilding the form.
        _changeMagicalLevel(delta) {
            const at = MAGICAL_LEVELS.indexOf(this._magicalLevel);
            const from = at < 0 ? 0 : at;
            const count = MAGICAL_LEVELS.length;
            const next = MAGICAL_LEVELS[(from + delta % count + count) % count];
            if (next === this._magicalLevel) return;
            this._magicalLevel = next;
            const el = document.getElementById("wm-magic");
            if (el) {
                el.dataset.level = next;
                const label = el.querySelector(".wm-date-label");
                if (label) label.textContent = magicalLabel(next);
            }
            const noteEl = document.getElementById("wm-magic-note");
            if (noteEl) {
                const note = magicalNoteFor(next);
                noteEl.textContent = note;
                noteEl.style.display = note ? "" : "none";
            }
            SoundManager.playCursor();
        }

        _randomizeSeed() {
            // Build a short pronounceable random seed word so it stays readable
            // and editable, while still hashing to a distinct uint32 RNG root.
            const syllables = ["ka", "zo", "mi", "ru", "ne", "va", "th", "lo", "qu", "en",
                               "sha", "dri", "mor", "lux", "vex", "nim", "tor", "ael", "ix", "um"];
            let seed = "";
            const parts = 2 + Math.floor(Math.random() * 2); // 2 or 3 syllables
            for (let i = 0; i < parts; i++) {
                seed += syllables[Math.floor(Math.random() * syllables.length)];
            }
            this._seedValue = seed;
            const input = document.getElementById("wm-seed-input");
            if (input) input.value = seed;
            SoundManager.playCursor();
        }

        // Beta character sheets: the drawings that are not in the original
        // folder. A world that takes them is populated from the wider pool; a
        // world that does not never sees them outside the character grid. The
        // answer belongs to the world's people, so it is asked once here and is
        // not offered again on an existing world.
        _toggleBetaSprites() {
            this._betaSprites = !this._betaSprites;
            const el = document.getElementById("wm-beta-toggle");
            if (el) {
                el.dataset.on = this._betaSprites ? "1" : "0";
                el.setAttribute("aria-checked", this._betaSprites ? "true" : "false");
                const box = el.querySelector(".wm-check-box");
                if (box) box.textContent = this._betaSprites ? "☑" : "☐";
            }
            SoundManager.playCursor();
        }

        _scrollTabBody(amount) {
            const body = this._container && this._container.querySelector(".wm-tab-body");
            if (body) body.scrollBy({ top: amount, behavior: "smooth" });
        }

        createUIDOM() {
            let container = document.getElementById("world-manage-container");
            if (!container) {
                container = document.createElement("div");
                container.id = "world-manage-container";
                document.body.appendChild(container);
            }
            this._container = container;
            container.style.display = "flex";
            container.style.opacity = "1";
            container.style.pointerEvents = "auto";

            // The container element is persistent and reused across scene openings, so
            // bind the container-scoped listeners only once. These closures resolve the
            // active scene through SceneManager._scene dynamically, so a single binding
            // stays correct and avoids the per-open listener accumulation leak.
            if (!container.dataset.wmListenersBound) {
                container.addEventListener("keydown", e => {
                    const tag = e.target && e.target.tagName;
                    if (tag === "INPUT" || tag === "SELECT") {
                        e.stopPropagation();
                        if (e.key === "Enter" && tag === "INPUT") { // i18n-ignore: DOM key name
                            e.preventDefault();
                            SceneManager._scene.onCreateWorld && SceneManager._scene.onCreateWorld();
                        }
                        if (e.key === "Escape") { // i18n-ignore: DOM key name
                            e.preventDefault();
                            e.target.blur();
                        }
                    }
                });
                ["mousedown", "mouseup", "click", "touchstart", "touchend", "pointerdown",
                    "pointerup", "wheel"].forEach(evt => {
                    container.addEventListener(evt, e => e.stopPropagation(), { passive: true });
                });

                // Right-click anywhere on the overlay backs out one level: closes
                // the create modal if it is open and closable, otherwise returns
                // to the title screen.
                container.addEventListener("contextmenu", e => {
                    e.stopPropagation();
                    e.preventDefault();
                    const scene = SceneManager._scene;
                    if (scene && scene._creatingWorld) {
                        scene.closeCreateModal();
                        return;
                    }
                    SoundManager.playCancel();
                    if (scene && scene.popScene) {
                        scene.popScene();
                    }
                });

                container.dataset.wmListenersBound = "1";
            }

            this._wasdListener = (e) => {
                if (this._busy) return;
                const ae = document.activeElement;
                if (ae && this._container && this._container.contains(ae) &&
                    (ae.tagName === "INPUT" || ae.tagName === "SELECT")) return;
                let hit = true;
                switch (e.key.toLowerCase()) {
                    case "w": this._wasdInput.up = true; break;
                    case "s": this._wasdInput.down = true; break;
                    case "a": this._wasdInput.left = true; break;
                    case "d": this._wasdInput.right = true; break;
                    default: hit = false;
                }
                if (hit) e.preventDefault();
            };
            window.addEventListener("keydown", this._wasdListener);

            this.refreshUIDOM();
        }

        removeUIDOM() {
            this._closeConfirm();
            if (this._wasdListener) {
                window.removeEventListener("keydown", this._wasdListener);
                this._wasdListener = null;
            }
            if (this._container) {
                const container = this._container;
                container.style.transition = "opacity 0.2s ease-out";
                container.style.opacity = "0";
                container.style.pointerEvents = "none";
                setTimeout(() => {
                    container.innerHTML = "";
                    container.style.display = "none";
                }, 200);
                this._container = null;
            }
        }

        // Full rebuild only when force=true or first render.
        // Targeted partial updates otherwise, prevents form/focus flicker.
        refreshUIDOM(force = false) {
            if (!this._container) return;
            const WM = window.WorldManager;
            const worlds = WM.listWorlds();
            const active = WM.activeWorldName;

            if (force || !this._container.querySelector(".book-spread")) {
                this._buildLayout(worlds, active);
            } else {
                this._patchWorldList(worlds, active);
                this._patchRightPage(worlds, active);
            }

            this._applyFocusHighlight();
        }

        // ---- layout builders -----------------------------------------------

        _buildWorldRowsHTML(worlds, active) {
            if (worlds.length === 0) {
                return `<div class="wm-empty">${T('WorldManagerUI.noWorldsYetCreateOne')}</div>`;
            }
            return worlds.map(world => {
                const isActive   = world.name === active;
                const isSelected = world.name === this._selectedWorld;
                return `
                    <div class="wm-world-row ${isSelected ? "selected" : ""}"
                         data-world-name="${escapeHtml(world.name)}"
                         onclick="SceneManager._scene.onSelectWorld('${world.name.replace(/'/g, "\\'")}')">
                        <div class="wm-world-name">
                            ${escapeHtml(world.name)}
                            ${isActive ? `<span class="wm-active-badge">${T('WorldManagerUI.active')}</span>` : ""}
                        </div>
                    </div>
                `;
            }).join("");
        }

        _buildLayout(worlds, active) {
            const hasWorlds = worlds.length > 0;
            // The create form is a modal. It cannot be dismissed while there is
            // no world to fall back to, so it is forced open in that case even
            // if something earlier had closed it (e.g. deleting the last world).
            if (!hasWorlds) this._creatingWorld = true;
            const creating = !!this._creatingWorld;

            const prevInput = document.getElementById("wm-name-input");
            const nameValue = (prevInput && prevInput.value.trim())
                ? prevInput.value
                : (this._suggestedName || "");

            const prevSeed = document.getElementById("wm-seed-input");
            const seedValue = (prevSeed && prevSeed.value.trim())
                ? prevSeed.value
                : (this._seedValue || DEFAULT_WORLD_SEED);

            const start = clampStartDate(this._startYear || START_YEAR_MIN, this._startMonth || 1);
            this._startYear = start.year;
            this._startMonth = start.month;
            const startLevel = this._startLevel || START_LEVEL_DEFAULT;
            const populationMode = POPULATION_MODES.includes(this._populationMode)
                ? this._populationMode : POPULATION_DEFAULT;
            const magicalLevel = MAGICAL_LEVELS.includes(this._magicalLevel)
                ? this._magicalLevel : MAGICAL_DEFAULT;

            this._container.innerHTML = `
                <div class="book-spread">
                    <div class="cc-page cc-page-left">
                        <h2 class="cc-header-gothic">${T('WorldManagerUI.worlds')}</h2>
                        <div class="wm-list" id="wm-world-list">
                            ${this._buildWorldRowsHTML(worlds, active)}
                        </div>
                        <div class="wm-list-actions">
                            <button type="button" id="wm-create-open-btn" class="cc-btn-treaty"
                                    onclick="SceneManager._scene.openCreateModal()">
                                + ${T('WorldManagerUI.createWorld')}
                            </button>
                        </div>
                        <div class="cc-button-panel">
                            <button id="wm-back-btn" class="cc-btn-treaty" onclick="SoundManager.playCancel(); SceneManager._scene.popScene();">
                                ${T('WorldManagerUI.back')}
                            </button>
                        </div>
                    </div>
                    <div class="cc-page cc-page-right" id="wm-right-page">
                        ${this.renderRightPage(worlds, active)}
                    </div>
                </div>
                <div id="wm-create-overlay" class="wm-modal-overlay wm-create-overlay"
                     style="${creating ?"" : "display:none;"}"
                     onclick="if (event.target === this) SceneManager._scene.closeCreateModal();">
                    <div class="wm-modal wm-create-modal" role="dialog" aria-modal="true">
                        <div class="wm-create-modal-header">
                            <h3 class="cc-subheader">${T('WorldManagerUI.createWorld')}</h3>
                            ${hasWorlds ? `
                            <button type="button" id="wm-create-close-btn" class="wm-modal-x"
                                    onclick="SceneManager._scene.closeCreateModal()"
                                    aria-label="${T('WorldManagerUI.cancel')}">&times;</button>
                            ` : ""}
                        </div>
                        <div class="wm-create wm-create-modal-body">
                            <label>${T('WorldManagerUI.worldName')}</label>
                            <input id="wm-name-input" type="text" maxlength="40"
                                   value="${escapeHtml(nameValue)}"
                                   placeholder="${T('WorldManagerUI.newWorld')}" autocomplete="off">
                            <label>${T('WorldManagerUI.startingDate')}</label>
                            <div class="wm-date-row">
                                <div id="wm-start-month" class="wm-year-selector" data-month="${start.month}"
                                     role="spinbutton" tabindex="0" aria-label="${T('WorldManagerUI.month')}">
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeStartMonth(-1)" aria-label="${T('WorldManagerUI.previousMonth')}">&#9664;</button>
                                    <span class="wm-date-label">${monthName(start.month)}</span>
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeStartMonth(1)" aria-label="${T('WorldManagerUI.nextMonth')}">&#9654;</button>
                                </div>
                                <div id="wm-start-year" class="wm-year-selector" data-year="${start.year}"
                                     role="spinbutton" tabindex="0" aria-label="${T('WorldManagerUI.year')}">
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeStartYear(-1)" aria-label="${T('WorldManagerUI.previousYear')}">&#9664;</button>
                                    <span class="wm-date-label">${start.year}</span>
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeStartYear(1)" aria-label="${T('WorldManagerUI.nextYear')}">&#9654;</button>
                                </div>
                            </div>
                            <div id="wm-enemy-floor" class="wm-enemy-floor" role="status"
                                 style="${enemyLevelNoticeFor(start.year) ?"" : "display:none;"}"
                            >${escapeHtml(enemyLevelNoticeFor(start.year))}</div>
                            <div id="wm-earth-lost" class="wm-enemy-floor wm-earth-lost" role="status"
                                 style="${earthLostNoticeFor(start.year) ?"" : "display:none;"}"
                            >${escapeHtml(earthLostNoticeFor(start.year))}</div>
                            <label>${T('WorldManagerUI.startingLevel')}</label>
                            <div class="wm-date-row">
                                <div id="wm-start-level" class="wm-year-selector" data-level="${startLevel}"
                                     role="spinbutton" tabindex="0" aria-label="${T('WorldManagerUI.startingLevel')}">
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeStartLevel(-1)" aria-label="${T('WorldManagerUI.lowerLevel')}">&#9664;</button>
                                    <span class="wm-date-label">${startLevel}</span>
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeStartLevel(1)" aria-label="${T('WorldManagerUI.raiseLevel')}">&#9654;</button>
                                </div>
                            </div>
                            <label>${T('WorldManagerUI.populationMode')}</label>
                            <div class="wm-date-row">
                                <div id="wm-population" class="wm-year-selector" data-mode="${escapeHtml(populationMode)}"
                                     role="spinbutton" tabindex="0" aria-label="${T('WorldManagerUI.populationMode')}">
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changePopulationMode(-1)" aria-label="${T('WorldManagerUI.previousPopulation')}">&#9664;</button>
                                    <span class="wm-date-label">${escapeHtml(populationLabel(populationMode))}</span>
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changePopulationMode(1)" aria-label="${T('WorldManagerUI.nextPopulation')}">&#9654;</button>
                                </div>
                            </div>
                            <div id="wm-population-note" class="wm-enemy-floor" role="status"
                                 style="${populationNoteFor(populationMode) ?"" : "display:none;"}"
                            >${escapeHtml(populationNoteFor(populationMode))}</div>
                            <label>${T('WorldManagerUI.magicalLevel')}</label>
                            <div class="wm-date-row">
                                <div id="wm-magic" class="wm-year-selector" data-level="${escapeHtml(magicalLevel)}"
                                     role="spinbutton" tabindex="0" aria-label="${T('WorldManagerUI.magicalLevel')}">
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeMagicalLevel(-1)" aria-label="${T('WorldManagerUI.previousMagic')}">&#9664;</button>
                                    <span class="wm-date-label">${escapeHtml(magicalLabel(magicalLevel))}</span>
                                    <button type="button" class="wm-year-arrow" onclick="SceneManager._scene._changeMagicalLevel(1)" aria-label="${T('WorldManagerUI.nextMagic')}">&#9654;</button>
                                </div>
                            </div>
                            <div id="wm-magic-note" class="wm-enemy-floor" role="status"
                                 style="${magicalNoteFor(magicalLevel) ?"" : "display:none;"}"
                            >${escapeHtml(magicalNoteFor(magicalLevel))}</div>
                            <label>${T('WorldManagerUI.seed')}</label>
                            <div class="wm-seed-row" style="display:flex; gap:6px; align-items:center">
                                <input id="wm-seed-input" type="text" maxlength="40" style="flex:1"
                                       value="${escapeHtml(seedValue)}"
                                       placeholder="${escapeHtml(DEFAULT_WORLD_SEED)}" autocomplete="off">
                                <button id="wm-seed-random-btn" type="button" class="wm-year-arrow"
                                        onclick="SceneManager._scene._randomizeSeed()"
                                        title="${T('WorldManagerUI.randomizeSeed')}"
                                        aria-label="${T('WorldManagerUI.randomizeSeed')}">&#9851;</button>
                            </div>
                            <label>${T('WorldManagerUI.betaSprites')}</label>
                            <div id="wm-beta-toggle" class="wm-check-row" data-on="${this._betaSprites ? "1" : "0"}"
                                 role="checkbox" tabindex="0" aria-checked="${this._betaSprites ? "true" : "false"}"
                                 onclick="SceneManager._scene._toggleBetaSprites()">
                                <span class="wm-check-box">${this._betaSprites ? "☑" : "☐"}</span>
                                <span class="wm-check-label">${T('WorldManagerUI.betaSpritesEnable')}</span>
                            </div>
                            <button id="wm-create-btn" class="cc-btn-treaty confirm" onclick="SceneManager._scene.onCreateWorld()">
                                ${T('WorldManagerUI.createActivate')}
                            </button>
                            <div id="wm-status" class="wm-status"></div>
                        </div>
                    </div>
                </div>
            `;

            if (creating) {
                const input = document.getElementById("wm-name-input");
                if (input) setTimeout(() => { input.focus(); input.select(); }, 50);
            }
        }

        openCreateModal() {
            if (this._busy || this._creatingWorld) return;
            SoundManager.playOk();
            this._creatingWorld = true;
            this._suggestedName = this._suggestedName || (window.WorldManager && window.WorldManager.randomWorldName());
            this.refreshUIDOM(true);
            this._setFocus("create", 0);
        }

        closeCreateModal() {
            if (!this._creatingWorld) return;
            const worlds = window.WorldManager ? window.WorldManager.listWorlds() : [];
            if (worlds.length === 0) return; // nothing to fall back to
            SoundManager.playCancel();
            this._creatingWorld = false;
            this.setStatus("");
            this.refreshUIDOM(true);
            this._setFocus(this._focusables("list").length > 0 ? "list" : "newworld", 0);
        }

        // Patch only the world row list (preserves the create form).
        _patchWorldList(worlds, active) {
            const list = this._container.querySelector("#wm-world-list");
            if (list) list.innerHTML = this._buildWorldRowsHTML(worlds, active);
        }

        // Patch only the right page.
        _patchRightPage(worlds, active) {
            const page = this._container.querySelector("#wm-right-page");
            if (page) page.innerHTML = this.renderRightPage(worlds, active);
        }

        // ---- right page rendering ------------------------------------------

        renderRightPage(worlds, active) {
            const world = worlds.find(w => w.name === this._selectedWorld);
            if (!world) {
                return `
                    <h2 class="cc-header-gothic">${T('WorldManagerUI.dossier')}</h2>
                    <div class="cc-text-desc">${T('WorldManagerUI.selectAWorldToView')}</div>
                `;
            }

            const tabsHTML = `
                <div class="wm-tabs">
                    <div class="category-tab ${this._rightTab === "info"    ? "selected" : ""}"
                         onclick="SceneManager._scene.onSelectTab('info')">${T('WorldManagerUI.dossier2')}</div>
                    <div class="category-tab ${this._rightTab === "history" ? "selected" : ""}"
                         onclick="SceneManager._scene.onSelectTab('history')">${T('WorldManagerUI.history')}</div>
                    <div class="category-tab ${this._rightTab === "balance" ? "selected" : ""}"
                         onclick="SceneManager._scene.onSelectTab('balance')">${T('WorldManagerUI.balance')}</div>
                    <div class="category-tab ${this._rightTab === "diaries" ? "selected" : ""}"
                         onclick="SceneManager._scene.onSelectTab('diaries')">${T('Diary.worlds.tab')}</div>
                    <div class="category-tab wm-wiki-tab"
                         onclick="SceneManager._scene.onSelectTab('wiki')">${T('WorldManagerUI.wiki')} ↗</div>
                </div>
            `;

            let body = "";
            switch (this._rightTab) {
                case "history": body = this.renderHistoryTab(world); break;
                case "balance": body = this.renderBalanceTab(world); break;
                case "diaries": body = this.renderDiariesTab(world); break;
                default:        body = this.renderInfoTab(world, active); break;
            }

            return `
                <h2 class="cc-header-gothic">${escapeHtml(world.name)}</h2>
                ${tabsHTML}
                <div class="wm-tab-body">${body}</div>
            `;
        }

        renderInfoTab(world, active) {
            const isActive = world.name === active;
            const created = world.createdAt
                ? new Date(world.createdAt).toLocaleString(T('WorldManagerUI.enUs'))
                : "?";
            const dateTime = window.TimeDateSystem
                ? window.TimeDateSystem.getDateTimeFromMinutes(world.worldTimeMinutes || 0)
                : null;
            const worldDate = dateTime ? dateTime.fullDate : "?";
            const savesCount = window.WorldManager.countSaves(world.name);

            return `
                <div class="cc-dossier-card">
                    <div class="cc-dossier-row">
                        <span class="cc-dossier-label">${T('WorldManagerUI.created')}</span>
                        <span class="cc-dossier-value">${escapeHtml(created)}</span>
                    </div>
                    <div class="cc-dossier-row">
                        <span class="cc-dossier-label">${T('WorldManagerUI.worldDate')}</span>
                        <span class="cc-dossier-value">${escapeHtml(worldDate)}</span>
                    </div>
                    <div class="cc-dossier-row">
                        <span class="cc-dossier-label">${T('WorldManagerUI.savegames')}</span>
                        <span class="cc-dossier-value">${savesCount === null ? "?" : savesCount}</span>
                    </div>
                    <div class="cc-dossier-row">
                        <span class="cc-dossier-label">${T('WorldManagerUI.seed')}</span>
                        <span class="cc-dossier-value">${world.seed !== undefined ? world.seed : "?"}</span>
                    </div>
                    <div class="cc-dossier-row">
                        <span class="cc-dossier-label">${T('WorldManagerUI.betaSprites')}</span>
                        <span class="cc-dossier-value">${world.betaSprites === true
                            ? T('WorldManagerUI.betaSpritesOn')
                            : T('WorldManagerUI.betaSpritesOff')}</span>
                    </div>
                    <div class="cc-dossier-row" title="${T('WorldManagerUI.populationLocked')}">
                        <span class="cc-dossier-label">${T('WorldManagerUI.magicalLevel')}</span>
                        <span class="cc-dossier-value">${escapeHtml(magicalLabel(
                            MAGICAL_LEVELS.includes(world.magicalLevel)
                                ? world.magicalLevel : MAGICAL_DEFAULT))}</span>
                    </div>
                    <div class="cc-dossier-row" title="${T('WorldManagerUI.populationLocked')}">
                        <span class="cc-dossier-label">${T('WorldManagerUI.populationMode')}</span>
                        <span class="cc-dossier-value">${escapeHtml(populationLabel(
                            POPULATION_MODES.includes(world.populationMode)
                                ? world.populationMode : POPULATION_DEFAULT))}</span>
                    </div>
                </div>
                <div class="cc-button-panel">
                    <button class="cc-btn-treaty" ${isActive ? "disabled" : ""}
                        onclick="SceneManager._scene.onActivateWorld('${world.name.replace(/'/g, "\\'")}')">
                        ${T('WorldManagerUI.setActive')}
                    </button>
                    <button class="cc-btn-treaty confirm"
                        onclick="SceneManager._scene.onDeleteWorld('${world.name.replace(/'/g, "\\'")}')">
                        ${T('WorldManagerUI.delete')}
                    </button>
                </div>
            `;
        }

        renderHistoryTab(world) {
            const history = window.WorldManager.readWorldFile(world.name, "history") || {};
            const events  = history.events || [];
            return `
                <div class="cc-subheader">${T('WorldManagerUI.historicalArchive')}</div>
                <div class="wm-history-list">${renderHistoryEvents(events)}</div>
            `;
        }

        // Every diary a world holds, whichever savegame kept it. A permadeath
        // run whose savegame is long gone still has its diary here, which is
        // the point of keeping them in the world folder rather than in a save.
        renderDiariesTab(world) {
            const D = window.Diary;
            const diaries = (D && D.listForWorld) ? D.listForWorld(world.name) : [];
            if (!diaries.length) {
                return `<div class="wm-empty">${escapeHtml(T('Diary.worlds.none'))}</div>`;
            }
            const rows = diaries.map(book => {
                const names = (book.party || []).map(m => m.name).filter(Boolean).join(", ")
                    || T('Diary.worlds.unknownParty');
                const meta = T('Diary.worlds.meta', {
                    count: book.count,
                    place: book.lastPlace || T('WorldManagerUI.noData')
                });
                const call = `SceneManager._scene.onReadDiary('${world.name.replace(/'/g, "\\'")}','${String(book.id).replace(/'/g, "\\'")}')`;
                // A button rather than a card, so the pockets' own keyboard and
                // controller walk ("actions") reaches every diary for free.
                return `
                    <button type="button" class="cc-btn-treaty wm-diary-row" onclick="${call}">
                        <span class="wm-diary-names">${escapeHtml(names)}</span>
                        <span class="wm-diary-meta">${escapeHtml(meta)}</span>
                    </button>`;
            }).join("");
            return `<div class="cc-button-panel wm-diary-list">${rows}</div>`;
        }

        // Reading one needs the game objects the book scene expects, exactly as
        // the wiki tab needs them for the archive.
        onReadDiary(worldName, diaryId) {
            if (!window.Scene_Diary) return;
            if (!$gameSystem) DataManager.setupNewGame();
            SoundManager.playOk();
            window.Scene_Diary.prepare(worldName, diaryId);
            SceneManager.push(window.Scene_Diary);
        }

        renderBalanceTab(world) {
            const history = window.WorldManager.readWorldFile(world.name, "history") || {};
            return renderHyperpowers(history.hyperpowers)
                || `<div class="wm-empty">${T('WorldManagerUI.noData')}</div>`;
        }

        // ---- status helper -------------------------------------------------

        setStatus(text) {
            const status = document.getElementById("wm-status");
            if (status) status.textContent = text;
        }

        // ---- event handlers ------------------------------------------------

        onSelectWorld(name) {
            SoundManager.playCursor();
            this._selectedWorld = this._selectedWorld === name ? null : name;
            this._rightTab = "info";

            // Toggle selected class on rows without rebuilding the left page.
            this._container.querySelectorAll(".wm-world-row").forEach(row => {
                row.classList.toggle("selected", row.dataset.worldName === this._selectedWorld);
            });

            const WM = window.WorldManager;
            this._patchRightPage(WM.listWorlds(), WM.activeWorldName);
            this._applyFocusHighlight();
        }

        onSelectTab(tab) {
            // Wiki opens Scene_History loaded with this world's data.
            if (tab === "wiki") {
                if (!this._selectedWorld || !window.Scene_History) return;
                const history = window.WorldManager.readWorldFile(this._selectedWorld, "history") || {};
                if (!$gameSystem) DataManager.setupNewGame();
                $gameSystem._historicalEvents     = history.events     || [];
                $gameSystem._historicalHyperpowers = history.hyperpowers || {};
                SoundManager.playOk();
                SceneManager.push(Scene_History);
                return;
            }

            if (this._rightTab === tab) return;
            SoundManager.playCursor();
            this._rightTab = tab;

            const WM = window.WorldManager;
            this._patchRightPage(WM.listWorlds(), WM.activeWorldName);
            this._applyFocusHighlight();
        }

        onActivateWorld(name) {
            if (this._busy) return;
            const WM = window.WorldManager;
            SoundManager.playOk();
            WM.setActiveWorld(name);
            if (window.HistoryManager) {
                const generated = WM.getField("artifacts", "generated");
                if (generated) window.HistoryManager.injectArtifacts(generated);
            }
            Promise.resolve(DataManager.loadGlobalInfo()).then(() => this.refreshUIDOM(true));
            this.refreshUIDOM(true);
        }

        onDeleteWorld(name) {
            if (this._busy || this._confirmOverlay) return;
            const message = T('WorldManagerUI.confirmDelete', { name });
            this._showConfirm({
                title: T('WorldManagerUI.deleteWorld'),
                message,
                confirmLabel: T('WorldManagerUI.delete'),
                cancelLabel: T('WorldManagerUI.cancel'),
                onConfirm: () => {
                    SoundManager.playOk();
                    window.WorldManager.deleteWorld(name);
                    this._selectedWorld = null;
                    Promise.resolve(DataManager.loadGlobalInfo()).then(() => this.refreshUIDOM(true));
                    this.refreshUIDOM(true);
                }
            });
        }

        // In-DOM confirmation window (replaces the native confirm() dialog so it
        // matches the parchment / Omega Tower theme and never breaks the canvas).
        _showConfirm({ title, message, confirmLabel, cancelLabel, onConfirm }) {
            if (!this._container) return;
            this._closeConfirm();
            this._confirmCallback = onConfirm || null;

            const overlay = document.createElement("div");
            overlay.className = "wm-modal-overlay";
            overlay.innerHTML = `
                <div class="wm-modal" role="dialog" aria-modal="true">
                    <h3 class="cc-subheader wm-modal-title">${escapeHtml(title)}</h3>
                    <div class="wm-modal-message">${escapeHtml(message)}</div>
                    <div class="wm-modal-buttons">
                        <button type="button" class="cc-btn-treaty wm-modal-cancel">${escapeHtml(cancelLabel)}</button>
                        <button type="button" class="cc-btn-treaty confirm wm-modal-confirm">${escapeHtml(confirmLabel)}</button>
                    </div>
                </div>
            `;

            overlay.querySelector(".wm-modal-cancel").addEventListener("click", () => {
                SoundManager.playCancel();
                this._closeConfirm();
            });
            overlay.querySelector(".wm-modal-confirm").addEventListener("click", () => {
                this._confirmConfirm();
            });
            // Clicking the dimmed backdrop (outside the window) cancels.
            overlay.addEventListener("click", e => {
                if (e.target === overlay) {
                    SoundManager.playCancel();
                    this._closeConfirm();
                }
            });
            overlay.addEventListener("contextmenu", e => {
                e.preventDefault();
                e.stopPropagation();
                SoundManager.playCancel();
                this._closeConfirm();
            });

            this._container.appendChild(overlay);
            this._confirmOverlay = overlay;
            const confirmBtn = overlay.querySelector(".wm-modal-confirm");
            if (confirmBtn) setTimeout(() => confirmBtn.focus(), 30);
        }

        _confirmConfirm() {
            const cb = this._confirmCallback;
            this._closeConfirm();
            if (cb) cb();
        }

        _closeConfirm() {
            if (this._confirmOverlay) {
                this._confirmOverlay.remove();
                this._confirmOverlay = null;
            }
            this._confirmCallback = null;
        }

        onCreateWorld() {
            if (this._busy) return;
            const WM = window.WorldManager;
            if (!WM) {
                SoundManager.playBuzzer();
                this.setStatus(T('WorldManagerUI.worldManagerUnavailable'));
                return;
            }
            const input = document.getElementById("wm-name-input");
            const name = (input ? input.value : "").trim();

            if (!WM.isValidName(name)) {
                SoundManager.playBuzzer();
                this.setStatus(T('WorldManagerUI.invalidNameUseLettersNumbers'));
                return;
            }
            if (WM.worldExists(name)) {
                SoundManager.playBuzzer();
                this.setStatus(T('WorldManagerUI.aWorldWithThisName'));
                return;
            }

            const start = clampStartDate(this._startYear || START_YEAR_MIN, this._startMonth || 1);
            const startYear = start.year;
            const startMonth = start.month;
            const worldTimeMinutes = minutesForStartDate(startYear, startMonth);

            const seedInput = document.getElementById("wm-seed-input");
            const seed = (seedInput && seedInput.value.trim()) ? seedInput.value.trim() : DEFAULT_WORLD_SEED;
            this._seedValue = seed;

            this._busy = true;
            this.setStatus(T('WorldManagerUI.generatingWorldHistory'));

            setTimeout(async () => {
                try {
                    // betaSprites is written before initializeWorld() below, so
                    // the pool the world is populated from already knows about it.
                    WM.createWorld(name, {
                        worldTimeMinutes, seed, startYear, startMonth,
                        startLevel: this._startLevel || START_LEVEL_DEFAULT,
                        betaSprites: this._betaSprites === true,
                        // Written before initializeWorld() below, so the pool
                        // the world is populated from already knows who is in
                        // it (and an empty world is never populated at all).
                        populationMode: this._populationMode || POPULATION_DEFAULT,
                        magicalLevel: this._magicalLevel || MAGICAL_DEFAULT
                    });
                    WM.setActiveWorld(name);
                    if (typeof FactionDataManager !== "undefined" &&
                        FactionDataManager.instance && FactionDataManager.instance._readyPromise) {
                        await FactionDataManager.instance._readyPromise;
                    }
                    if (window.HistoryManager) {
                        window.HistoryManager.initializeWorldHistory({ years: null, seed });
                    }
                    // Everything else the world owns: its people and where they
                    // live and work, the shop rotas, the dungeon, the politics,
                    // the epidemics. Generated here so the world is whole the
                    // moment it exists rather than filling in as it is walked.
                    this.setStatus(T('WorldManagerUI.populatingWorld'));
                    // Let the status paint before the generators block the thread.
                    await new Promise(resolve => setTimeout(resolve, 30));
                    WM.initializeWorld();
                    await DataManager.loadGlobalInfo();
                    SoundManager.playSave();
                    this._busy = false;
                    this._selectedWorld = name;
                    this._rightTab = "info";
                    this._creatingWorld = false;
                    Scene_WorldManage._mode = "manage";
                    this._suggestedName = WM.randomWorldName();
                    this.refreshUIDOM(true);
                    this._setFocus("tabs", RIGHT_TABS.indexOf(this._rightTab));
                } catch (e) {
                    console.error("[WorldManagerUI] World creation failed", e);
                    SoundManager.playBuzzer();
                    this._busy = false;
                    this.setStatus(T('WorldManagerUI.worldCreationFailed') + e.message);
                }
            }, 50);
        }
    }

    window.Scene_WorldManage = Scene_WorldManage;

    //=========================================================================
    // Title screen: starting a game requires an active world
    //=========================================================================

    // The title screen already greys these out with no world (Titlescreen.js),
    // so this is the backstop for any other route into them: it sends the
    // player to the create form rather than starting a game with nowhere to
    // keep its history, its people or its savegame.
    function requireActiveWorld() {
        if (window.WorldManager && window.WorldManager.activeWorldName) return true;
        SoundManager.playBuzzer();
        Scene_WorldManage.prepare("create");
        SceneManager.push(Scene_WorldManage);
        return false;
    }

    const _Scene_Title_commandNewGame = Scene_Title.prototype.commandNewGame;
    Scene_Title.prototype.commandNewGame = function () {
        if (!requireActiveWorld()) return;
        _Scene_Title_commandNewGame.call(this);
    };

    const _Scene_Title_commandTutorial = Scene_Title.prototype.commandTutorial;
    Scene_Title.prototype.commandTutorial = function () {
        if (!requireActiveWorld()) return;
        _Scene_Title_commandTutorial.call(this);
    };

    const _Scene_Title_commandSandboxGame = Scene_Title.prototype.commandSandboxGame;
    Scene_Title.prototype.commandSandboxGame = function () {
        if (!requireActiveWorld()) return;
        _Scene_Title_commandSandboxGame.call(this);
    };

    const _Scene_Title_onTutorialContinue = Scene_Title.prototype.onTutorialContinue;
    Scene_Title.prototype.onTutorialContinue = function () {
        if (!requireActiveWorld()) {
            if (this._tutorialWindow) this._tutorialWindow.close();
            return;
        }
        _Scene_Title_onTutorialContinue.call(this);
    };

    //=========================================================================
    // CSS
    //=========================================================================

    const style = document.createElement("style");
    style.textContent = `
        #world-manage-container {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 120;
            background: rgba(0, 0, 0, 0.55);
        }
        #world-manage-container .wm-list {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
            min-height: 0;
        }
        #world-manage-container .wm-empty {
            opacity: 0.7;
            font-style: normal;
            padding: 16px;
            text-align: center;
        }
        /* No fill: the page is already dark, so a panel behind every row only
           flattens the contrast the border and the title are read by. */
        #world-manage-container .wm-world-row {
            background: none;
            border: 1px dashed var(--scroll-thumb-hover-translucent-60);
            border-radius: 4px;
            padding: 10px 14px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        #world-manage-container .wm-world-row:hover {
            border-color: var(--border-focus-hover);
        }
        #world-manage-container .wm-world-row.selected {
            border-color: var(--text-primary-hover);
            box-shadow: inset 0 0 8px var(--border-primary-hover-translucent-15);
        }
        #world-manage-container .wm-world-name {
            font-family: 'Lora', serif;
            font-size: 1.265rem;
            color: var(--text-primary-hover);
        }
        #world-manage-container .wm-active-badge {
            font-size: 0.854rem;
            border: 1px solid var(--text-primary-hover);
            padding: 1px 6px;
            margin-left: 10px;
            vertical-align: middle;
            color: var(--text-primary-hover);
        }
        #world-manage-container .wm-create {
            border-top: 1px dashed var(--border-primary-hover-translucent-15);
            padding-top: 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex-shrink: 0;
        }
        #world-manage-container .wm-create h3 { margin: 0 0 4px 0; }
        #world-manage-container .wm-create label {
            font-size: 0.96rem;
            opacity: 0.8;
            margin-top: 4px;
            color: var(--text-muted-hover);
        }
        #world-manage-container .wm-create input,
        #world-manage-container .wm-create select {
            background: none;
            border: 1px solid var(--border-primary-hover-translucent-15);
            border-radius: 3px;
            color: var(--text-muted-hover);
            font-family: 'Lora', serif;
            font-size: 1.15rem;
            padding: 6px 8px;
            outline: none;
        }
        #world-manage-container .wm-create input:focus,
        #world-manage-container .wm-create select:focus {
            border-color: var(--border-focus-hover);
        }
        #world-manage-container .wm-status {
            font-size: 0.96rem;
            min-height: 18px;
            color: var(--text-secondary-active, #822d2d);
        }
        #world-manage-container .wm-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 10px;
            flex-shrink: 0;
        }
        #world-manage-container .wm-wiki-tab {
            margin-left: auto;
            opacity: 0.75;
        }
        #world-manage-container .wm-wiki-tab:hover { opacity: 1; }
        #world-manage-container .wm-tab-body {
            flex: 1;
            overflow-y: auto;
            min-height: 0;
        }
        #world-manage-container .wm-history-list {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        #world-manage-container .wm-diary-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        #world-manage-container .wm-diary-row {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            text-align: left;
            width: 100%;
        }
        #world-manage-container .wm-diary-row .wm-diary-meta {
            font-size: 0.952rem;
            opacity: 0.7;
        }
        /* The category rule on the left is what tells one record from the next;
           a filled card behind it added nothing but a second dark rectangle. */
        #world-manage-container .wm-event-card {
            background: none;
            border-radius: 0;
            padding: 2px 0 2px 12px;
        }
        #world-manage-container .wm-card-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        #world-manage-container .wm-card-date {
            font-family: 'Courier Prime', monospace;
            font-size: 0.96rem;
            color: var(--text-disabled, #5c4b3d);
        }
        #world-manage-container .wm-card-badge {
            font-size: 0.854rem;
            padding: 1px 8px;
            text-transform: uppercase;
        }
        #world-manage-container .wm-card-desc {
            font-size: 1.14rem;
            line-height: 1.5;
            color: var(--text-primary-hover);
        }
        #world-manage-container .wm-card-results {
            margin-top: 6px;
            font-size: 0.96rem;
            font-style: normal;
            color: var(--text-disabled, #5c4b3d);
        }
        /* Keyboard / controller focus */
        #world-manage-container .wm-world-row.kb-focus {
            border-style: solid;
            border-color: var(--border-focus-hover);
            box-shadow: inset 0 0 8px var(--border-primary-hover-translucent-15);
        }
        #world-manage-container .category-tab.kb-focus {
            background: var(--border-primary-hover-translucent-15);
            outline: 1px dashed var(--border-focus-hover);
        }
        #world-manage-container .cc-btn-treaty.kb-focus {
            transform: translateY(-2px);
            background: var(--text-warning-hover);
            border-color: var(--text-primary-hover);
            box-shadow: 0 8px 16px var(--border-primary-hover-translucent-15);
        }
        #world-manage-container .cc-btn-treaty.confirm.kb-focus {
            background: var(--bg-input-hover);
            border-color: var(--text-highlight-active);
        }
        #world-manage-container .wm-create input.kb-focus,
        #world-manage-container .wm-create select.kb-focus,
        #world-manage-container .wm-check-row.kb-focus,
        #world-manage-container .wm-year-selector.kb-focus {
            border-color: var(--border-focus-hover);
            box-shadow: 0 0 6px var(--border-primary-hover-translucent-15);
        }
        /* Creation-only checkbox (beta sprites). */
        #world-manage-container .wm-check-row {
            display: flex;
            align-items: center;
            gap: 8px;
            background: none;
            border: 1px solid var(--border-primary-hover-translucent-15);
            border-radius: 3px;
            padding: 4px 8px;
            cursor: pointer;
            outline: none;
            user-select: none;
        }
        #world-manage-container .wm-check-row .wm-check-box {
            font-size: 1.322rem;
            line-height: 1;
            color: var(--text-primary-hover);
        }
        #world-manage-container .wm-check-row[data-on="1"] .wm-check-box,
        #world-manage-container .wm-check-row[data-on="1"] .wm-check-label {
            color: var(--text-highlight-active);
        }
        #world-manage-container .wm-check-row .wm-check-label {
            font-family: 'Lora', serif;
            font-size: 1.14rem;
            color: var(--text-primary-hover);
        }
        #world-manage-container .wm-check-row:hover {
            border-color: var(--border-focus-hover);
        }
        /* Arrow-based starting-date selectors (month + year, side by side). */
        #world-manage-container .wm-date-row {
            display: flex;
            gap: 8px;
            align-items: stretch;
        }
        #world-manage-container .wm-date-row .wm-year-selector {
            flex: 1;
            min-width: 0;
        }
        #world-manage-container .wm-date-row .wm-year-arrow {
            padding: 2px 8px;
        }
        /* What a later starting year does to the monsters (enemyLevelNoticeFor). */
        #world-manage-container .wm-enemy-floor {
            margin: 4px 0 2px;
            font-family: 'Lora', serif;
            font-size: 0.984rem;
            line-height: 1.3;
            color: var(--text-highlight-active);
        }
        /* The one notice that is not about difficulty: there is no Earth left. */
        #world-manage-container .wm-earth-lost {
            font-weight: bold;
            color: var(--text-secondary-active, #822d2d);
        }
        #world-manage-container .wm-year-selector {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: none;
            border: 1px solid var(--border-primary-hover-translucent-15);
            border-radius: 3px;
            padding: 4px 6px;
            outline: none;
            user-select: none;
        }
        #world-manage-container .wm-date-label {
            flex: 1;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: 'Lora', serif;
            font-size: 1.15rem;
            font-weight: bold;
            color: var(--text-primary-hover);
        }
        #world-manage-container .wm-year-arrow {
            background: none;
            border: none;
            color: var(--text-primary-hover);
            font-size: 1.265rem;
            line-height: 1;
            padding: 2px 14px;
            cursor: pointer;
            transition: color 0.15s ease, transform 0.1s ease;
        }
        #world-manage-container .wm-year-arrow:hover {
            color: var(--text-highlight-active);
            transform: scale(1.2);
        }
        /* In-DOM confirmation window. */
        #world-manage-container .wm-modal-overlay {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.65);
            z-index: 10;
        }
        #world-manage-container .wm-modal {
            width: min(440px, 80%);
            background: var(--bg-panel, #0a0a0a);
            border: 1px solid var(--border-focus-hover);
            border-radius: 6px;
            box-shadow: 0 10px 30px var(--shadow-black-translucent-75, rgba(0,0,0,0.75));
            padding: 20px 22px;
        }
        #world-manage-container .wm-modal-title {
            margin-top: 0;
            text-align: center;
        }
        #world-manage-container .wm-modal-message {
            font-family: 'Lora', serif;
            font-size: 1.14rem;
            line-height: 1.5;
            color: var(--text-primary-hover);
            margin: 8px 0 20px 0;
            text-align: center;
        }
        #world-manage-container .wm-modal-buttons {
            display: flex;
            gap: 12px;
            justify-content: center;
        }
        /* "+ New World" pocket under the list, reopens the create modal. */
        #world-manage-container .wm-list-actions {
            flex-shrink: 0;
            margin-bottom: 10px;
        }
        #world-manage-container .wm-list-actions .cc-btn-treaty {
            width: 100%;
        }
        /* Create-world modal: same overlay pattern as the confirm dialog, but
           wider and scrollable to hold the whole form. */
        #world-manage-container .wm-create-overlay {
            z-index: 15;
        }
        #world-manage-container .wm-create-modal {
            width: min(480px, 90%);
            max-height: 88%;
            display: flex;
            flex-direction: column;
            padding: 18px 22px;
        }
        #world-manage-container .wm-create-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
            border-bottom: 1px dashed var(--border-primary-hover-translucent-15);
            padding-bottom: 8px;
            margin-bottom: 4px;
        }
        #world-manage-container .wm-create-modal-header h3 { margin: 0; }
        #world-manage-container .wm-modal-x {
            background: none;
            border: none;
            color: var(--text-muted-hover);
            font-size: 1.61rem;
            line-height: 1;
            cursor: pointer;
            padding: 0 4px;
            transition: color 0.15s ease;
        }
        #world-manage-container .wm-modal-x:hover {
            color: var(--text-highlight-active);
        }
        #world-manage-container .wm-create-modal-body {
            border-top: none;
            padding-top: 4px;
            overflow-y: auto;
            min-height: 0;
        }
    `;
    document.head.appendChild(style);
})();
