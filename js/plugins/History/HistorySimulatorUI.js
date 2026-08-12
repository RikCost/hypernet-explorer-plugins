/*:
 * @target MZ
 * @plugindesc UI for HistorySimulator: Scene_History DOM overlay with keyboard/controller navigation.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * HistorySimulatorUI.js
 * ============================================================================
 * DOM scene and window stubs for the Historical Archive viewer.
 * Must be listed AFTER HistorySimulator.js in the plugin manager.
 * Reads window.HistoryManager exposed by HistorySimulator.js.
 * ============================================================================
 */

(function () {
    'use strict';

    const COUNTRIES = window.HistorySimulator_COUNTRIES || {};

    // Wire WASD → RMMZ directional inputs (global; maps to standard directions so harmless everywhere)
    Input.keyMapper[87] = 'up';    // W
    Input.keyMapper[83] = 'down';  // S
    Input.keyMapper[65] = 'left';  // A
    Input.keyMapper[68] = 'right'; // D

    //=============================================================================
    // Scene_History
    //=============================================================================

    class Scene_History extends Scene_MenuBase {
        create() {
            super.create();
            this.createWindowLayer();
            this.createTitleWindow();
            this.createSummaryWindow();
            this.createHistoryWindow();
            this.createDetailsWindow();

            this._lastIndex = -1;
            this._archiveMode = "timeline";   // i18n-ignore: shelf id
            this._diseaseIndex = 0;

            this._historyWindow.activate();
            this._historyWindow.select(0);

            this.initUIHistoryDOM();
        }

        updateUIInput() {
            if (Input.isTriggered('ok')) {
                SoundManager.playOk();
                this.popScene();
                return;
            }
            if (Input.isTriggered('cancel')) {
                SoundManager.playCancel();
                if (window.Scene_CharacterCreation) {
                    // Resume creation just before character-type selection
                    // (interruptedStep + 1 lands on the next interactive step).
                    Scene_CharacterCreation._interruptedStep =
                        (window.CCSteps && window.CCSteps.WORLD_HISTORY) != null
                            ? window.CCSteps.WORLD_HISTORY
                            : 2;
                }
                this.popScene();
                return;
            }

            if (this._archiveMode === "diseases") {
                const rows = this.archiveDiseases();
                if (!rows.length) return;
                const step = (Input.isTriggered('down') || Input.isRepeated('down')) ? 1
                    : ((Input.isTriggered('up') || Input.isRepeated('up')) ? -1 : 0);
                if (!step) return;
                const next = Math.max(0, Math.min((this._diseaseIndex || 0) + step, rows.length - 1));
                if (next === this._diseaseIndex) return;
                this._diseaseIndex = next;
                SoundManager.playCursor();
                const box = this._uiContainer || document.getElementById("history-container");
                if (box) this.renderDiseaseLibrary(box);
                return;
            }

            const allEvents = window.HistoryManager
                ? window.HistoryManager.getEvents()
                : ($gameSystem._historicalEvents || []);
            if (allEvents.length === 0) return;

            const currentIndex = this._historyWindow.index();
            if (Input.isTriggered('down') || Input.isRepeated('down')) {
                const next = Math.min(currentIndex + 1, allEvents.length - 1);
                if (next !== currentIndex) {
                    SoundManager.playCursor();
                    this._historyWindow.select(next);
                    this.syncUIHistoryState();
                }
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                const prev = Math.max(currentIndex - 1, 0);
                if (prev !== currentIndex) {
                    SoundManager.playCursor();
                    this._historyWindow.select(prev);
                    this.syncUIHistoryState();
                }
            }
        }

        update() {
            super.update();
            this.updateUIInput();
            this.syncUIHistoryState();
        }

        terminate() {
            super.terminate();
            const container = document.getElementById("history-container");
            if (container) {
                container.style.transition = "opacity 0.2s ease-out";
                container.style.opacity = "0";
                container.style.pointerEvents = "none";
                setTimeout(() => { container.remove(); }, 200);
            }
        }

        createTitleWindow() {
            const rect = this.titleWindowRect();
            this._titleWindow = new Window_Base(rect);
            this._titleWindow.visible = false;
            this._titleWindow.opacity = 0;
            this.addWindow(this._titleWindow);
        }

        titleWindowRect() {
            return new Rectangle(0, 0, Graphics.boxWidth, 80);
        }

        createSummaryWindow() {
            const rect = this.summaryWindowRect();
            this._summaryWindow = new Window_HistorySummary(rect);
            this._summaryWindow.setHandler('ok', this.onSummaryOk.bind(this));
            this._summaryWindow.setHandler('cancel', this.popScene.bind(this));
            this._summaryWindow.visible = false;
            this._summaryWindow.opacity = 0;
            this.addWindow(this._summaryWindow);
        }

        summaryWindowRect() {
            return new Rectangle(0, 80, Graphics.boxWidth, Graphics.boxHeight - 80);
        }

        createHistoryWindow() {
            const rect = this.historyWindowRect();
            this._historyWindow = new Window_HistoryLog(rect);
            this._historyWindow.setHandler('ok', this.onHistoryOk.bind(this));
            this._historyWindow.setHandler('cancel', this.popScene.bind(this));
            this._historyWindow.visible = false;
            this._historyWindow.opacity = 0;
            this.addWindow(this._historyWindow);
        }

        historyWindowRect() {
            const ww = Math.floor(Graphics.boxWidth * 0.65);
            return new Rectangle(0, 80, ww, Graphics.boxHeight - 80);
        }

        createDetailsWindow() {
            const rect = this.detailsWindowRect();
            this._detailsWindow = new Window_HistoryDetails(rect);
            this._detailsWindow.visible = false;
            this._detailsWindow.opacity = 0;
            this.addWindow(this._detailsWindow);
            this._historyWindow.setDetailsWindow(this._detailsWindow);
        }

        detailsWindowRect() {
            const listW = Math.floor(Graphics.boxWidth * 0.65);
            return new Rectangle(listW, 80, Graphics.boxWidth - listW, Graphics.boxHeight - 80);
        }

        onSummaryOk() { this.popScene(); }
        onHistoryOk() { /* retained for RMMZ event loop handler safety */ }

        initUIHistoryDOM() {
            if (!document.getElementById("history-container")) {
                const container = document.createElement("div");
                container.id = "history-container";
                document.body.appendChild(container);
            }
        }

        // The archive keeps two shelves. The timeline is the century that was
        // simulated; the library is every illness the world knows, dossier and
        // remedies included, which is the one place a player can look a disease
        // up before ever meeting it. Switching shelf rebuilds the spread, since
        // the two are laid out differently.
        setArchiveMode(mode) {
            if (this._archiveMode === mode) return;
            this._archiveMode = mode;
            this._diseaseIndex = 0;
            this._lastIndex = -1;
            this._uiSpread = null;
            const container = this._uiContainer || document.getElementById("history-container");
            if (container) container.innerHTML = "";
            SoundManager.playCursor();
            this.syncUIHistoryState();
        }

        archiveDiseases() {
            const api = window.DiseaseSystem;
            if (!api || !api.all) return [];
            if (!this._diseaseList || !this._diseaseList.length) {
                this._diseaseList = api.all().slice().sort((a, b) => a.name.localeCompare(b.name));
            }
            return this._diseaseList;
        }

        renderDiseaseLibrary(container) {
            const api = window.DiseaseSystem;
            const rows = this.archiveDiseases();
            const at = Math.max(0, Math.min(this._diseaseIndex || 0, rows.length - 1));
            const selected = rows[at];
            const listHTML = rows.length ? rows.map((d, idx) => `
                <div class="event-card ${idx === at ? "focused" : ""}" data-disease-idx="${idx}"
                     style="border-left:5px solid var(--border-muted-focus, #8b5a2b);">
                    <div class="card-header">
                        <span class="card-date">${d.name}</span>
                        <span class="card-badge">${T('Diseases.category.' + d.category)}</span>
                    </div>
                    <div class="card-desc">${d.desc}</div>
                </div>
            `).join("") : `<div style="text-align:center; font-style:italic; margin-top:50px;">${T('Diseases.ui.noLibrary')}</div>`;

            const dossierHTML = selected && api && api.diseaseDossierHTML ? `
                <div class="cc-dossier-card">
                    <h3 class="cc-subheader">${selected.name}</h3>
                    ${api.diseaseDossierHTML(selected.id)}
                </div>` : "";

            container.innerHTML = `
                <div class="cc-pockets-spread" style="max-width:1400px; max-height:900px;">
                    <div class="cc-page cc-page-left" style="gap:4px;">
                        <h2 class="cc-header-gothic" style="font-size:1.6rem; margin-bottom:10px;">${T('Diseases.ui.library')}</h2>
                        <div id="history-timeline-list">${listHTML}</div>
                    </div>
                    <div class="cc-page cc-page-right">
                        <div class="dossier-wrapper">${dossierHTML}</div>
                        <div class="cc-button-panel">
                            <button class="cc-btn-treaty" id="history-mode-btn">${T('Diseases.ui.showTimeline')}</button>
                            <button class="cc-btn-treaty confirm" id="history-continue-btn">${T('History.ui.continue')}</button>
                        </div>
                    </div>
                </div>
            `;
            this._uiSpread = container.querySelector(".cc-pockets-spread");
            container.querySelectorAll("[data-disease-idx]").forEach(card => {
                card.addEventListener("click", () => {
                    this._diseaseIndex = parseInt(card.getAttribute("data-disease-idx"), 10);
                    SoundManager.playCursor();
                    this.renderDiseaseLibrary(container);
                });
            });
            const modeBtn = container.querySelector("#history-mode-btn");
            if (modeBtn) modeBtn.addEventListener("click", () => this.setArchiveMode("timeline"));
            const contBtn = container.querySelector("#history-continue-btn");
            if (contBtn) contBtn.addEventListener("click", () => { SoundManager.playOk(); this.popScene(); });
        }

        syncUIHistoryState() {
            // Cache the container + spread element refs so the steady-state path
            // (index unchanged) does zero DOM queries. Re-resolve if either has
            // been detached (scene teardown / rebuild).
            let container = this._uiContainer;
            if (!container || !container.isConnected) {
                container = this._uiContainer = document.getElementById("history-container");
                this._uiSpread = null;
            }
            if (!container) return;

            if (this._archiveMode === "diseases") {
                if (!this._uiSpread || !this._uiSpread.isConnected) this.renderDiseaseLibrary(container);
                return;
            }

            const currentIndex = this._historyWindow.index();
            let existingSpread = this._uiSpread;
            if (!existingSpread || !existingSpread.isConnected) {
                existingSpread = this._uiSpread = container.querySelector(".cc-pockets-spread");
            }
            if (this._lastIndex === currentIndex && existingSpread) return;

            this._lastIndex = currentIndex;

            const isIt = ConfigManager.language === "it";
            const allEvents = window.HistoryManager
                ? window.HistoryManager.getEvents()
                : ($gameSystem._historicalEvents || []);

            const titleText = isIt ? "ARCHIVIO STORICO" : "HISTORICAL ARCHIVE";

            function getCategoryVars(category) {
                const map = {
                    'military':   { color: 'var(--text-secondary-active, #822d2d)',      bg: 'var(--shadow-soft-active-translucent-25, rgba(130,45,45,0.05))' },
                    'political':  { color: 'var(--text-text-alt-5-hover, #b05c3c)',      bg: 'var(--border-primary-hover-translucent-15, rgba(176,92,60,0.05))' },
                    'internal':   { color: 'var(--text-text-alt-5-hover, #b05c3c)',      bg: 'var(--border-primary-hover-translucent-15, rgba(176,92,60,0.05))' },
                    'economic':   { color: 'var(--text-text-alt-3, #2b5e3c)',            bg: 'var(--bg-bg-alt-7-translucent-12, rgba(43,94,60,0.05))' },
                    'social':     { color: 'var(--text-text-alt-16, #3d5e75)',           bg: 'var(--bg-bg-alt-6-translucent-12, rgba(61,94,117,0.05))' },
                    'paranormal': { color: 'var(--bg-bg-alt-14, #5a3d75)',               bg: 'var(--bg-bg-alt-15-translucent-12, rgba(90,61,117,0.05))' },
                    'royal':      { color: 'var(--text-text-alt-19, #8c4375)',           bg: 'var(--border-primary-hover-translucent-15, rgba(140,67,117,0.05))' },
                    'occult':     { color: 'var(--bg-bg-alt-14, #5a3d75)',               bg: 'var(--bg-bg-alt-15-translucent-12, rgba(90,61,117,0.05))' },
                    'scientific': { color: 'var(--text-text-alt-16, #3d5e75)',           bg: 'var(--bg-bg-alt-6-translucent-12, rgba(61,94,117,0.05))' },
                    'disaster':   { color: 'var(--text-secondary-active, #822d2d)',      bg: 'var(--shadow-soft-active-translucent-25, rgba(130,45,45,0.05))' },
                    'criminal':   { color: 'var(--text-text-alt-5-hover, #b05c3c)',      bg: 'var(--border-primary-hover-translucent-15, rgba(176,92,60,0.05))' },
                    'artifact':   { color: '#a07820',                                    bg: 'rgba(160,120,32,0.07)' },
                    'diplomatic': { color: 'var(--text-text-alt-16, #3d5e75)',           bg: 'var(--bg-bg-alt-6-translucent-12, rgba(61,94,117,0.05))' }
                };
                return map[category] || { color: 'var(--border-muted-focus, #8b5a2b)', bg: 'var(--border-secondary-hover-translucent-15, rgba(139,90,43,0.05))' };
            }

            function isArtifactEvent(evt) {
                return evt.category === 'artifact' || /artifact/i.test(evt.description || '');
            }

            const artifactBadgeHTML = `<span class="card-badge" style="color:#a07820; background:rgba(160,120,32,0.1); border:1px solid #a0782050;">${T('History.ui.artifactBadge')}</span>`;

            let dossierHTML = "";
            const selectedEvent = allEvents[currentIndex];
            if (selectedEvent) {
                const dateParts = selectedEvent.date.split('-');
                const formattedDate = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : selectedEvent.date;
                const cv = getCategoryVars(selectedEvent.category);
                const artifactTag = isArtifactEvent(selectedEvent) ? artifactBadgeHTML : "";

                let consequenceBadges = "";
                if (selectedEvent.results) {
                    selectedEvent.results.split(",").forEach(r => {
                        const trimmed = r.trim();
                        if (trimmed) {
                            const isPos = trimmed.includes("+");
                            const badgeColor = isPos ? 'var(--text-text-alt-3, #2b5e3c)' : 'var(--text-secondary-active, #822d2d)';
                            const badgeBg = isPos ? 'rgba(43,94,60,0.08)' : 'rgba(130,45,45,0.08)';
                            consequenceBadges += `<span class="card-badge" style="color:${badgeColor}; background:${badgeBg}; border:1px solid ${badgeColor}; margin-right:4px;">${trimmed}</span>`;
                        }
                    });
                } else {
                    consequenceBadges = `<span style="font-size:0.8rem; color:var(--text-disabled, #5c4b3d); font-style:italic;">${isIt ? "Nessuna variazione geopolitica rilevata." : "No geopolitical delta registered."}</span>`;
                }

                dossierHTML = `
                    <div class="cc-dossier-card">
                        <div style="display:flex; flex-direction:column; gap:10px; font-size:0.85rem; margin-bottom:12px;">
                            <div class="cc-dossier-row">
                                <span class="cc-dossier-label">${isIt ? "Data:" : "Date:"}</span>
                                <span class="cc-dossier-value" style="font-family:'Courier Prime', monospace;">${formattedDate}</span>
                            </div>
                            <div class="cc-dossier-row">
                                <span class="cc-dossier-label">${isIt ? "Tipo:" : "Type:"}</span>
                                <span class="cc-dossier-value" style="color:${cv.color}; text-transform:uppercase;">${selectedEvent.category}</span>
                                ${artifactTag}
                            </div>
                        </div>
                        <div style="background:var(--bg-primary-hover-translucent-35, rgba(255,255,255,0.4)); border:1px dashed var(--scroll-thumb-hover-translucent-60, rgba(139,90,43,0.3)); padding:12px 14px; border-radius:4px; font-family:'Courier Prime', monospace; font-size:0.8rem; color:var(--text-muted-hover, #2b1c11); line-height:1.45; margin-bottom:12px;">
                            ${selectedEvent.description}
                        </div>
                        <div>
                            <div style="font-size:0.75rem; text-transform:uppercase; color:var(--text-disabled, #5c4b3d); font-weight:bold; margin-bottom:6px;">${isIt ? "CONSEGUENZE:" : "CONSEQUENCES:"}</div>
                            <div class="conseq-row">
                                ${consequenceBadges}
                            </div>
                        </div>
                    </div>
                `;
            }

            if (!existingSpread) {
                // Timeline + standings are only consumed when the spread is first
                // built, so their (up-to-5000-card / full-standings) HTML is built
                // here instead of on every selection change.
                let timelineHTML = "";
                if (allEvents.length === 0) {
                    timelineHTML = `<div style="text-align:center; color:var(--text-disabled, #5c4b3d); font-style:italic; margin-top:50px; font-size:0.95rem;">${isIt ? "Nessun record registrato..." : "No timeline records found."}</div>`;
                } else {
                    allEvents.forEach((evt, idx) => {
                        const focused = idx === currentIndex ? "focused" : "";
                        const cv = getCategoryVars(evt.category);
                        const dateParts = evt.date.split('-');
                        const formattedDate = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : evt.date;
                        const artifactTag = isArtifactEvent(evt) ? artifactBadgeHTML : "";

                        timelineHTML += `
                            <div class="event-card ${focused}" data-global-idx="${idx}" style="border-left:5px solid ${cv.color};">
                                <div class="card-header">
                                    <span class="card-date">${formattedDate}</span>
                                    <span class="card-badge" style="color:${cv.color}; background:${cv.bg}; border:1px solid ${cv.color}30;">${evt.category}</span>
                                    ${artifactTag}
                                </div>
                                <div class="card-desc">${evt.description}</div>
                                ${evt.results ? `
                                    <div class="card-results">
                                        <span></span>
                                        <span>${evt.results}</span>
                                    </div>
                                ` : ""}
                            </div>
                        `;
                    });
                }

                const powersList = Object.entries(window.HistoryManager
                    ? window.HistoryManager.getHyperpowers()
                    : ($gameSystem._historicalHyperpowers || {}))
                    .sort((a, b) => (b[1].military + b[1].economy) - (a[1].military + a[1].economy));

                let standingsHTML = `
                    <div class="cc-dossier-card">
                        <h3 class="cc-subheader">${isIt ? "EQUILIBRIO DELLE HYPERPOTENZE" : "HYPERPOWERS BALANCE"}</h3>
                        <div style="display:flex; flex-direction:column; gap:10px;">
                `;

                powersList.slice(0, 3).forEach(([name, data]) => {
                    const milPct = Math.min(100, Math.max(5, (data.military / 300) * 100));
                    const ecoPct = Math.min(100, Math.max(5, (data.economy / 250) * 100));

                    const controlled = [];
                    for (const [cName, cData] of Object.entries(COUNTRIES)) {
                        if (cData.controller === name) controlled.push(cName);
                    }
                    const territories = controlled.slice(0, 3).join(", ") + (controlled.length > 3 ? "..." : "");

                    standingsHTML += `
                        <div style="border-bottom:1px dashed var(--scroll-thumb-hover-translucent-60, rgba(139,90,43,0.25)); padding-bottom:8px;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                <strong style="font-size:0.85rem; color:var(--text-primary-hover, #2b1c11);">${name}</strong>
                                <span style="font-size:0.7rem; color:var(--text-disabled, #5c4b3d); font-family:'Courier Prime', monospace;">${territories}</span>
                            </div>
                            <div class="cc-dossier-row">
                                <span class="cc-dossier-label">${T('History.ui.military')}</span>
                                <div class="cc-progress-container">
                                    <div class="cc-progress-fill" style="width:${milPct}%; background:var(--text-secondary-active, #822d2d);"></div>
                                </div>
                                <span class="cc-dossier-value" style="color:var(--text-secondary-active, #822d2d);">${Math.floor(data.military)}</span>
                            </div>
                            <div class="cc-dossier-row">
                                <span class="cc-dossier-label">${T('History.ui.economy')}</span>
                                <div class="cc-progress-container">
                                    <div class="cc-progress-fill" style="width:${ecoPct}%; background:var(--text-text-alt-3, #2b5e3c);"></div>
                                </div>
                                <span class="cc-dossier-value" style="color:var(--text-text-alt-3, #2b5e3c);">${Math.floor(data.economy)}</span>
                            </div>
                        </div>
                    `;
                });

                standingsHTML += `</div></div>`;

                const backLabel = T('History.ui.back');
                const continueLabel = T('History.ui.continue');
                container.innerHTML = `
                    <div class="cc-pockets-spread" style="max-width:1400px; max-height:900px;">
                        <div class="cc-page cc-page-left" style="gap:4px;">
                            <h2 class="cc-header-gothic" style="font-size:1.6rem; margin-bottom:10px;">${titleText}</h2>
                            <div id="history-timeline-list">
                                ${timelineHTML}
                            </div>
                        </div>
                        <div class="cc-page cc-page-right">
                            <div class="dossier-wrapper">
                                ${dossierHTML}
                            </div>
                            ${standingsHTML}
                            <div class="cc-button-panel">
                                <button class="cc-btn-treaty" id="history-back-btn">${backLabel}</button>
                                <button class="cc-btn-treaty" id="history-mode-btn">${T('Diseases.ui.showLibrary')}</button>
                                <button class="cc-btn-treaty confirm" id="history-continue-btn">${continueLabel}</button>
                            </div>
                        </div>
                    </div>
                `;

                // Cache the freshly-built spread + focused card so the update
                // branch can toggle just two nodes instead of re-querying.
                this._uiSpread = container.querySelector(".cc-pockets-spread");
                this._focusedCard = container.querySelector(`.event-card[data-global-idx="${currentIndex}"]`) || null;

                container.querySelectorAll(".event-card").forEach(c => {
                    c.addEventListener("click", () => {
                        const idx = parseInt(c.getAttribute("data-global-idx"));
                        if (this._historyWindow.index() !== idx) {
                            SoundManager.playCursor();
                            this._historyWindow.select(idx);
                            this.syncUIHistoryState();
                        }
                    });
                });

                const modeBtn = container.querySelector("#history-mode-btn");
                if (modeBtn) modeBtn.addEventListener("click", () => this.setArchiveMode("diseases"));

                const backBtn = container.querySelector("#history-back-btn");
                if (backBtn) {
                    backBtn.addEventListener("click", () => {
                        SoundManager.playCancel();
                        if (window.Scene_CharacterCreation) {
                            // Resume creation just before character-type selection
                            // (interruptedStep + 1 lands on the next interactive step).
                            Scene_CharacterCreation._interruptedStep =
                                (window.CCSteps && window.CCSteps.WORLD_HISTORY) != null
                                    ? window.CCSteps.WORLD_HISTORY
                                    : 2;
                        }
                        this.popScene();
                    });
                }

                const continueBtn = container.querySelector("#history-continue-btn");
                if (continueBtn) {
                    continueBtn.addEventListener("click", () => {
                        SoundManager.playOk();
                        this.popScene();
                    });
                }

                const timelineList = container.querySelector("#history-timeline-list");
                if (timelineList) {
                    container.addEventListener("wheel", (e) => {
                        e.preventDefault();
                        timelineList.scrollTop += e.deltaY;
                    }, { passive: false });
                }

            } else {
                // Only the previously- and newly-focused cards change class,
                // so touch those two nodes instead of every card.
                const prev = this._focusedCard;
                const next = container.querySelector(`.event-card[data-global-idx="${currentIndex}"]`);
                if (prev && prev !== next) prev.classList.remove("focused");
                if (next) next.classList.add("focused");
                this._focusedCard = next;

                const dossierWrapper = container.querySelector(".dossier-wrapper");
                if (dossierWrapper) {
                    dossierWrapper.innerHTML = dossierHTML;
                }
            }

            // Keep a single pending scroll: replace any still-queued one so rapid
            // selection changes don't stack dozens of scrollIntoView callbacks.
            if (this._scrollTimeout) clearTimeout(this._scrollTimeout);
            this._scrollTimeout = setTimeout(() => {
                this._scrollTimeout = null;
                const activeCard = this._focusedCard ||
                    (container.isConnected && container.querySelector(`.event-card[data-global-idx="${currentIndex}"]`));
                if (activeCard) {
                    activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 50);
        }
    }

    window.Scene_History = Scene_History;

    //=============================================================================
    // Window stubs, invisible; exist only for RMMZ handler wiring
    //=============================================================================

    class Window_HistorySummary extends Window_Selectable {
        constructor(rect) { super(rect); this.hide(); this.deactivate(); }
    }
    class Window_HistoryLog extends Window_Selectable {
        constructor(rect) { super(rect); this.hide(); this.deactivate(); }
        setDetailsWindow(win) { }
    }
    class Window_HistoryDetails extends Window_Base {
        constructor(rect) { super(rect); this.hide(); this.deactivate(); }
        setEvent(evt) { }
    }

    window.Window_HistorySummary = Window_HistorySummary;
    window.Window_HistoryLog     = Window_HistoryLog;
    window.Window_HistoryDetails = Window_HistoryDetails;

})();
