/*:
 * @target MZ
 * @plugindesc Alchemistry Menu UI v2.0, DOM overlay (asymmetric book-spread) for AlchemistryMenu
 * @author Omni-Lex
 * @help AlchemistryMenuUI.js
 *
 * DOM layer for Scene_Alchemistry. Must be listed AFTER AlchemistryMenu.js
 * in the Plugin Manager.
 *
 * Implements:
 *  - Parchment book-spread overlay (58/42 asymmetric pages)
 *  - Left page  : project pockets (2-column grid)
 *  - Right page : selected project inspect (reagents + procedure + actions)
 *  - Modal flows: action picker, reagent picker
 *  - Full keyboard + controller support (WASD, arrows, L1/R1, gamepad B = cancel)
 */

(function () {
    'use strict';

    if (!window.Scene_Alchemistry) {
        throw new Error('AlchemistryMenuUI.js requires AlchemistryMenu.js to be loaded first!');
    }

    const ACTIONS = window.AlchemistryActions;
    // Named so it does not shadow the global i18n resolver.
    const alch = () => window.AlchemistryI18n();
    const tn = (str) => (window.translateText ? window.translateText(str) : str);

    // =========================================================================
    // create, DOM extension
    // =========================================================================

    const _Scene_Alchemistry_create = Scene_Alchemistry.prototype.create;
    Scene_Alchemistry.prototype.create = function () {
        _Scene_Alchemistry_create.call(this);

        // WASD state
        this._wasdInput      = { up: false, down: false, left: false, right: false };
        this._wasdHeld       = { up: false, down: false, left: false, right: false };
        this._wasdHoldFrames = { up: 0,     down: 0,     left: 0,     right: 0     };

        this._wasdListener = (event) => {
            if (event.repeat) return;
            const key = event.key.toLowerCase();
            if (key === 'w') { this._wasdInput.up    = true; this._wasdHeld.up    = true; event.preventDefault(); }
            if (key === 's') { this._wasdInput.down  = true; this._wasdHeld.down  = true; event.preventDefault(); }
            if (key === 'a') { this._wasdInput.left  = true; this._wasdHeld.left  = true; event.preventDefault(); }
            if (key === 'd') { this._wasdInput.right = true; this._wasdHeld.right = true; event.preventDefault(); }
        };
        this._wasdUpListener = (event) => {
            const key = event.key.toLowerCase();
            if (key === 'w') { this._wasdHeld.up    = false; this._wasdHoldFrames.up    = 0; }
            if (key === 's') { this._wasdHeld.down  = false; this._wasdHoldFrames.down  = 0; }
            if (key === 'a') { this._wasdHeld.left  = false; this._wasdHoldFrames.left  = 0; }
            if (key === 'd') { this._wasdHeld.right = false; this._wasdHoldFrames.right = 0; }
        };
        window.addEventListener('keydown', this._wasdListener);
        window.addEventListener('keyup',   this._wasdUpListener);

        // DOM state
        this._selectedProjectIndex = $gameSystem._currentAlchemistryProjectIndex || 0;
        this._activeSection        = 'projects'; // 'projects' | 'actions'
        this._selectedActionIndex  = 0;
        this._actionsList          = [];         // populated on render
        this._statusMessage        = '';

        // Modal state ('action' | 'item' | null)
        this._modalMode            = null;
        this._modalSelectedIndex   = 0;
        this._modalItems           = [];
        this._pendingAction        = null;

        // Refresh hook used by async recipe loading in the data file.
        this.onRecipesLoaded = () => {
            this._selectedProjectIndex = 0;
            $gameSystem._currentAlchemistryProjectIndex = 0;
            this.refreshAlchemistryDOM();
        };

        this.createAlchemistryOverlay();
    };

    Scene_Alchemistry.prototype.update = function () {
        Scene_MenuBase.prototype.update.call(this);
        UIAlchemistryInputManager.update();
    };

    Scene_Alchemistry.prototype.terminate = function () {
        if (this._wasdListener) {
            window.removeEventListener('keydown', this._wasdListener);
            window.removeEventListener('keyup',   this._wasdUpListener);
            this._wasdListener   = null;
            this._wasdUpListener = null;
        }

        UIAlchemistryInputManager.deactivate();

        if (this._alcContainer) {
            const container = this._alcContainer;
            container.style.transition    = 'opacity 0.2s ease-out';
            container.style.opacity       = '0';
            container.style.pointerEvents = 'none';
            setTimeout(() => {
                if (container && container.parentNode) container.parentNode.removeChild(container);
            }, 200);
            this._alcContainer = null;
        }

        Scene_MenuBase.prototype.terminate.call(this);
    };

    // =========================================================================
    // Overlay creation
    // =========================================================================

    Scene_Alchemistry.prototype.createAlchemistryOverlay = function () {
        this._alcContainer = document.createElement('div');
        this._alcContainer.id = 'menu-container';
        this._alcContainer.style.opacity    = '0';
        this._alcContainer.style.transition = 'opacity 0.22s ease-out';
        document.body.appendChild(this._alcContainer);

        // Right-click → cancel / back
        this._rightClickStartedHere = false;
        this._alcContainer.addEventListener('mousedown', (event) => {
            if (event.button === 2) { this._rightClickStartedHere = true; event.stopPropagation(); }
        });
        this._alcContainer.addEventListener('mouseup', (event) => {
            if (event.button === 2) event.stopPropagation();
        });
        this._alcContainer.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!this._rightClickStartedHere) return;
            this._rightClickStartedHere = false;
            const scene = SceneManager._scene;
            if (scene && scene.isActive()) UIAlchemistryInputManager.handleCancel();
        });
        this._alcContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const grid = this._alcContainer.querySelector('#alchemistry-grid');
            if (grid) grid.scrollTop += e.deltaY;
        }, { passive: false });

        this.refreshAlchemistryDOM();
        UIAlchemistryInputManager.activate(this);

        setTimeout(() => {
            if (this._alcContainer) this._alcContainer.style.opacity = '1';
        }, 16);
    };

    // =========================================================================
    // Rendering helpers
    // =========================================================================

    Scene_Alchemistry.prototype.projects = function () {
        return $gameSystem._alchemistryProjects || [];
    };

    Scene_Alchemistry.prototype.currentProject = function () {
        return this.projects()[this._selectedProjectIndex] || null;
    };

    Scene_Alchemistry.prototype.isProcessing = function (index) {
        return $gameSystem._alchemistryActiveProjectIndex === index && $gameSystem._alchemistryTimer > 0;
    };

    Scene_Alchemistry.prototype.drawAlcIcon = function (iconIndex, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const bitmap = ImageManager.loadSystem('IconSet');
        const draw = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false;
            const pw = 32, ph = 32;
            const sx = (iconIndex % 16) * pw;
            const sy = Math.floor(iconIndex / 16) * ph;
            ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, 0, 0, canvas.width, canvas.height);
        };
        if (bitmap.isReady()) draw();
        else bitmap.addLoadListener(draw);
    };

    // Build the right-page inspect markup for the selected project.
    Scene_Alchemistry.prototype.buildInspectHTML = function () {
        const t = alch();
        const project = this.currentProject();

        if (!project) {
            return `
              <div class="item-inspect item-inspect--empty" style="justify-content:center;text-align:center;">
                <div class="inspect-placeholder-icon"></div>
                <h3 class="title">${t.title}</h3>
                <p class="inspect-placeholder-text">${t.empty}</p>
              </div>`;
        }

        const targetItem = project.target_item_id ? $dataItems[project.target_item_id] : null;
        const formula    = this.getItemFormula(targetItem);
        const projName   = tn(project.name);

        // ---- Inspect header (icon frame + name + formula subtitle) ----
        const headerHTML = `
          <div class="inspect-header">
            <div class="inspect-frame">
              ${targetItem ? `<canvas id="alc-inspect-canvas" width="32" height="32" class="inspect-canvas"></canvas>` : `<div class="inspect-placeholder-icon" style="font-size:2em;"></div>`}
            </div>
            <div class="inspect-title-box">
              <h3 class="inspect-name">${projName}</h3>
              ${formula ? `<div class="inspect-rarity" style="color:var(--border-focus-hover);">${formula}</div>` : ''}
            </div>
          </div>`;

        // ---- Lore area: reagents + procedure ----
        let loreHTML = '';

        const reagents = project.required_ingredients || [];
        if (reagents.length > 0) {
            loreHTML += `<div class="inspect-section-title">${t.requiredReagents}</div>`;
            reagents.forEach(ing => {
                const item = $dataItems[ing.item_id];
                if (!item) return;
                loreHTML += `
                  <div class="inspect-spec-row">
                    <span class="inspect-spec-label">${tn(item.name)}</span>
                    <span class="inspect-spec-value">x${ing.quantity}</span>
                  </div>`;
            });
        }

        loreHTML += `<div class="inspect-section-title">${t.steps}</div>`;
        if (!project.steps.length) {
            loreHTML += `<div class="inspect-bullet-item" style="font-style:italic;">${t.noSteps}</div>`;
        } else {
            project.steps.forEach((step, i) => {
                const actText = `${i + 1}. ${step.action} ${t.stepAt} ${step.temperature || 25}° ${t.stepFor} ${step.duration}s`;
                loreHTML += `<div class="inspect-bullet-item">${actText}</div>`;
                (step.ingredients || []).forEach(ing => {
                    const item = $dataItems[ing.item_id];
                    if (!item) return;
                    const f = this.getItemFormula(item);
                    loreHTML += `
                      <div class="inspect-spec-row" style="padding-left:18px;">
                        <span class="inspect-spec-label">${tn(item.name)}${f ? ` <span style="color:var(--border-focus-hover);">(${f})</span>` : ''}</span>
                        <span class="inspect-spec-value">x${ing.quantity}</span>
                      </div>`;
                });
            });
        }

        // ---- Actions (or processing notice) ----
        let actionsHTML = '';
        this._actionsList = [];

        if (this.isProcessing(this._selectedProjectIndex)) {
            const seconds = Math.ceil($gameSystem._alchemistryTimer / 60);
            actionsHTML = `<div class="inspect-btn inspect-btn--disabled">${t.processing}… ${seconds}s ${t.remaining}</div>`;
        } else {
            const mk = (key, label, extraClass) => {
                const isFocused = (this._activeSection === 'actions' && this._selectedActionIndex === this._actionsList.length) ? 'selected' : '';
                this._actionsList.push(key);
                return `<div class="inspect-btn ${extraClass || ''} ${isFocused}" onclick="SceneManager._scene.onActionButton('${key}')">${label}</div>`;
            };
            actionsHTML += mk('addStep',  t.addStep);
            if (project.steps.length > 0) {
                actionsHTML += mk('execute',    t.execute);
                actionsHTML += mk('clearSteps', t.clearSteps, 'inspect-btn--danger');
            }
        }

        const statusHTML = this._statusMessage
            ? `<div class="inspect-placeholder-text" style="margin:6px 0 0;color:var(--text-primary-hover);">${this._statusMessage}</div>`
            : '';

        return `
          <div class="item-inspect">
            ${headerHTML}
            <div class="inspect-lore">${loreHTML}</div>
            <div class="inspect-actions">${actionsHTML}${statusHTML}</div>
          </div>`;
    };

    // Build modal overlay markup (action picker / reagent picker).
    Scene_Alchemistry.prototype.buildModalHTML = function () {
        if (!this._modalMode) return '';
        const t = alch();
        let title, optionsHTML = '';

        if (this._modalMode === 'action') {
            title = t.selectAction;
            ACTIONS.forEach((act, idx) => {
                const isFocused = this._modalSelectedIndex === idx ? 'selected' : '';
                optionsHTML += `<div class="target-option ${isFocused}" onclick="SceneManager._scene.onModalPick(${idx})">${t.actions[act.key]}</div>`;
            });
        } else { // 'item'
            title = t.selectReagent;
            this._modalItems.forEach((item, idx) => {
                const isFocused = this._modalSelectedIndex === idx ? 'selected' : '';
                const count = ($gameSystem && $gameSystem._isSandboxMode) ? 99 : $gameParty.numItems(item);
                optionsHTML += `<div class="target-option ${isFocused}" onclick="SceneManager._scene.onModalPick(${idx})">${tn(item.name)} <span style="opacity:0.7;">x${count}</span></div>`;
            });
            if (!this._modalItems.length) {
                optionsHTML += `<div class="target-option" style="opacity:0.6;">—</div>`;
            }
        }

        return `
          <div class="army-dialog-overlay" id="alc-modal">
            <div class="target-overlay" style="min-width:320px;max-height:70%;overflow-y:auto;">
              <h3 class="target-title">${title}</h3>
              <div class="inspect-actions">
                ${optionsHTML}
                <div class="target-option" style="margin-top:10px;opacity:0.85;" onclick="SceneManager._scene.closeModal()">${t.cancel}</div>
              </div>
            </div>
          </div>`;
    };

    // =========================================================================
    // Rendering: a full rebuild (init / recipe load) plus targeted region
    // updates so that clicking a button never re-renders the whole spread.
    // =========================================================================

    // Clamp the selected index to the current project list and mirror it to
    // $gameSystem. Shared by the full rebuild and the targeted updates.
    Scene_Alchemistry.prototype._syncSelectedIndex = function () {
        const projects = this.projects();
        if (this._selectedProjectIndex >= projects.length) {
            this._selectedProjectIndex = Math.max(0, projects.length - 1);
        }
        $gameSystem._currentAlchemistryProjectIndex = this._selectedProjectIndex;
    };

    // Left-page markup (header + project grid).
    Scene_Alchemistry.prototype.buildLeftPageHTML = function () {
        const t = alch();
        const projects = this.projects();

        let gridHTML = '';
        if (!projects.length) {
            gridHTML = `<div class="item-grid-empty">—</div>`;
        } else {
            projects.forEach((project, idx) => {
                const isFocused = (this._activeSection === 'projects' && this._selectedProjectIndex === idx) ? 'selected' : '';
                const item      = project.target_item_id ? $dataItems[project.target_item_id] : null;
                const canvasId  = `alc-proj-canvas-${idx}`;
                gridHTML += `
                  <div class="item-slot ${isFocused}" onclick="SceneManager._scene.selectProject(${idx})">
                    <div class="item-slot-icon">
                      ${item ? `<canvas id="${canvasId}" width="32" height="32" style="width:32px;height:32px;"></canvas>` : ''}
                    </div>
                    <div class="item-slot-info">
                      <div class="item-slot-name">${tn(project.name)}</div>
                      <div class="item-slot-meta"><span>${project.steps.length} ${t.steps.toLowerCase()}</span></div>
                    </div>
                  </div>`;
            });
        }

        return `
          <div class="left-page">
            <div class="page-header-bar">
              <div class="back-button" onclick="SceneManager._scene.onAlchemistryCancel()">${t.back}</div>
              <h2 class="title">${t.title}</h2>
            </div>
            <div class="backpack-grid" id="alchemistry-grid">${gridHTML}</div>
          </div>`;
    };

    // Redraw the target-item icon for every project slot.
    Scene_Alchemistry.prototype.drawProjectIcons = function () {
        this.projects().forEach((project, idx) => {
            if (project.target_item_id) {
                const item = $dataItems[project.target_item_id];
                if (item) this.drawAlcIcon(item.iconIndex, `alc-proj-canvas-${idx}`);
            }
        });
    };

    // Redraw the inspect-panel icon for the current project.
    Scene_Alchemistry.prototype.drawInspectIcon = function () {
        const cur = this.currentProject();
        if (cur && cur.target_item_id && $dataItems[cur.target_item_id]) {
            this.drawAlcIcon($dataItems[cur.target_item_id].iconIndex, 'alc-inspect-canvas');
        }
    };

    Scene_Alchemistry.prototype.scrollFocusedProjectIntoView = function () {
        if (this._activeSection !== 'projects' || !this._alcContainer) return;
        const focused = this._alcContainer.querySelector('.item-slot.selected');
        if (focused) focused.scrollIntoView({ block: 'nearest' });
    };

    // Full rebuild, used only for initial mount and recipe (re)loading.
    Scene_Alchemistry.prototype.refreshAlchemistryDOM = function () {
        if (!this._alcContainer) return;
        this._syncSelectedIndex();

        this._alcContainer.innerHTML =
            `<div class="book-spread">${this.buildLeftPageHTML()}` +
            `<div class="right-page" id="alc-right-page">${this.buildInspectHTML()}</div></div>` +
            `<div id="alc-modal-layer">${this.buildModalHTML()}</div>`;

        this.drawProjectIcons();
        this.drawInspectIcon();
        this.scrollFocusedProjectIntoView();
    };

    // ---- Targeted region updates ------------------------------------------

    // Toggle the `selected` class on project slots without rebuilding them.
    Scene_Alchemistry.prototype.updateProjectSelection = function () {
        if (!this._alcContainer) return;
        this._syncSelectedIndex();
        const slots = this._alcContainer.querySelectorAll('#alchemistry-grid .item-slot');
        slots.forEach((el, idx) => {
            el.classList.toggle('selected', this._activeSection === 'projects' && this._selectedProjectIndex === idx);
        });
        this.scrollFocusedProjectIntoView();
    };

    // Refresh a single project slot's step count (after add/clear steps).
    Scene_Alchemistry.prototype.updateProjectMeta = function (idx) {
        if (!this._alcContainer) return;
        const slots = this._alcContainer.querySelectorAll('#alchemistry-grid .item-slot');
        const el = slots[idx];
        const project = this.projects()[idx];
        if (!el || !project) return;
        const meta = el.querySelector('.item-slot-meta');
        if (meta) meta.innerHTML = `<span>${project.steps.length} ${alch().steps.toLowerCase()}</span>`;
    };

    // Rebuild only the right (inspect) page.
    Scene_Alchemistry.prototype.updateRightPage = function () {
        if (!this._alcContainer) return;
        const rp = this._alcContainer.querySelector('#alc-right-page');
        if (!rp) { this.refreshAlchemistryDOM(); return; }
        rp.innerHTML = this.buildInspectHTML();
        this.drawInspectIcon();
    };

    // Toggle the `selected` class on action buttons (same-section move).
    Scene_Alchemistry.prototype.updateActionHighlight = function () {
        if (!this._alcContainer) return;
        const btns = this._alcContainer.querySelectorAll('#alc-right-page .inspect-actions .inspect-btn');
        btns.forEach((el, idx) => {
            el.classList.toggle('selected', this._activeSection === 'actions' && this._selectedActionIndex === idx);
        });
    };

    // Rebuild only the modal layer (open / close / reagent list changes).
    Scene_Alchemistry.prototype.updateModalLayer = function () {
        if (!this._alcContainer) return;
        const layer = this._alcContainer.querySelector('#alc-modal-layer');
        if (!layer) { this.refreshAlchemistryDOM(); return; }
        layer.innerHTML = this.buildModalHTML();
    };

    // Toggle the `selected` class on modal options (modal navigation).
    Scene_Alchemistry.prototype.updateModalHighlight = function () {
        if (!this._alcContainer) return;
        const opts = this._alcContainer.querySelectorAll('#alc-modal .inspect-actions > .target-option');
        opts.forEach((el, idx) => {
            el.classList.toggle('selected', idx === this._modalSelectedIndex);
        });
    };

    // =========================================================================
    // Interaction handlers
    // =========================================================================

    Scene_Alchemistry.prototype.selectProject = function (idx) {
        if (this._selectedProjectIndex === idx && this._activeSection === 'projects') {
            // Re-click on focused project → jump to actions panel
            SoundManager.playOk();
            this._activeSection       = 'actions';
            this._selectedActionIndex = 0;
        } else {
            SoundManager.playCursor();
            this._activeSection        = 'projects';
            this._selectedProjectIndex = idx;
        }
        this._statusMessage = '';
        this.updateProjectSelection();
        this.updateRightPage();
    };

    Scene_Alchemistry.prototype.onActionButton = function (key) {
        if (this.isProcessing(this._selectedProjectIndex)) { SoundManager.playBuzzer(); return; }
        if (key === 'addStep') {
            SoundManager.playOk();
            this.openActionModal();
        } else if (key === 'execute') {
            this.startExecution();
        } else if (key === 'clearSteps') {
            SoundManager.playCancel();
            const project = this.currentProject();
            if (project) project.steps = [];
            this._statusMessage = '';
            this.updateProjectMeta(this._selectedProjectIndex);
            this.updateRightPage();
        }
    };

    // ---- Modal: action picker ----
    Scene_Alchemistry.prototype.openActionModal = function () {
        this._modalMode          = 'action';
        this._modalSelectedIndex = 0;
        this.updateModalLayer();
    };

    // ---- Modal: reagent picker ----
    Scene_Alchemistry.prototype.openItemModal = function () {
        const isSandbox = $gameSystem && $gameSystem._isSandboxMode;
        const list = $dataItems.filter(item =>
            item && item.note && /<category:\s*Alchemistry\s*>/i.test(item.note) &&
            (isSandbox || $gameParty.numItems(item) > 0)
        );
        this._modalMode          = 'item';
        this._modalItems         = list;
        this._modalSelectedIndex = 0;
        this.updateModalLayer();
    };

    Scene_Alchemistry.prototype.onModalPick = function (idx) {
        if (this._modalMode === 'action') {
            const act = ACTIONS[idx];
            if (!act) return;
            SoundManager.playOk();
            this._pendingAction = act.key;
            if (act.needsItem) {
                this.openItemModal();
            } else {
                this.addStepToCurrentProject(act.key, null);
                this.closeModal();
            }
        } else if (this._modalMode === 'item') {
            const item = this._modalItems[idx];
            if (!item) return;
            const isSandbox = $gameSystem && $gameSystem._isSandboxMode;
            if (isSandbox || $gameParty.numItems(item) > 0) {
                SoundManager.playOk();
                if (!isSandbox) $gameParty.loseItem(item, 1);
                this.addStepToCurrentProject(this._pendingAction, item.id);
                this.closeModal();
            } else {
                SoundManager.playBuzzer();
                this._statusMessage = alch().notEnough;
                this.updateRightPage();
            }
        }
    };

    Scene_Alchemistry.prototype.closeModal = function () {
        this._modalMode     = null;
        this._pendingAction = null;
        this._modalItems    = [];
        this._activeSection = 'actions';
        this.updateModalLayer();
        this.updateProjectSelection();
        this.updateProjectMeta(this._selectedProjectIndex);
        this.updateRightPage();
    };

    Scene_Alchemistry.prototype.startExecution = function () {
        const project = this.currentProject();
        if (!project || !project.steps.length) { SoundManager.playBuzzer(); return; }
        SoundManager.playOk();
        const t = alch();
        this._statusMessage = `${t.processing}…`;
        this.updateRightPage();

        this.executeProject(project).then(({ totalDuration }) => {
            this._statusMessage = `${t.processing}… ${totalDuration}s ${t.remaining}`;
            this.updateRightPage();
            setTimeout(() => { this.popScene(); }, 900);
        }).catch(err => {
            console.error('Failed to execute project', err);
            SoundManager.playBuzzer();
        });
    };

    Scene_Alchemistry.prototype.onAlchemistryCancel = function () {
        SoundManager.playCancel();
        this.popScene();
    };

    // =========================================================================
    // Input manager
    // =========================================================================

    const UIAlchemistryInputManager = {
        _scene:  null,
        _active: false,

        activate(scene) { this._scene = scene; this._active = true; },
        deactivate()    { this._active = false; this._scene = null; },

        update() {
            if (!this._active || !this._scene) return;
            const scene = this._scene;

            // WASD hold-repeat simulation
            for (const dir of ['up', 'down', 'left', 'right']) {
                if (scene._wasdHeld && scene._wasdHeld[dir]) {
                    scene._wasdHoldFrames[dir]++;
                    const tt = scene._wasdHoldFrames[dir];
                    if (tt > Input.keyRepeatWait && (tt - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
                        scene._wasdInput[dir] = true;
                    }
                } else if (scene._wasdHoldFrames) {
                    scene._wasdHoldFrames[dir] = 0;
                }
            }

            const isDown  = Input.isRepeated('down')  || (scene._wasdInput && scene._wasdInput.down);
            const isUp    = Input.isRepeated('up')    || (scene._wasdInput && scene._wasdInput.up);
            const isLeft  = Input.isRepeated('left')  || (scene._wasdInput && scene._wasdInput.left);
            const isRight = Input.isRepeated('right') || (scene._wasdInput && scene._wasdInput.right);

            if (scene._wasdInput) {
                scene._wasdInput.up = scene._wasdInput.down = scene._wasdInput.left = scene._wasdInput.right = false;
            }

            // Modal takes full input priority
            if (scene._modalMode) {
                const count = scene._modalMode === 'action' ? ACTIONS.length : scene._modalItems.length;
                if (isDown && scene._modalSelectedIndex < count - 1) {
                    SoundManager.playCursor(); scene._modalSelectedIndex++; scene.updateModalHighlight();
                } else if (isUp && scene._modalSelectedIndex > 0) {
                    SoundManager.playCursor(); scene._modalSelectedIndex--; scene.updateModalHighlight();
                } else if (Input.isTriggered('ok')) {
                    if (count > 0) scene.onModalPick(scene._modalSelectedIndex);
                } else if (Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    SoundManager.playCancel(); scene.closeModal();
                }
                return;
            }

            // L1 / R1, cycle projects from anywhere
            if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
                const total = scene.projects().length;
                if (total > 0) {
                    const dir  = Input.isTriggered('pageup') ? -1 : 1;
                    SoundManager.playCursor();
                    scene._selectedProjectIndex = (scene._selectedProjectIndex + dir + total) % total;
                    scene._activeSection = 'projects';
                    scene._statusMessage = '';
                    scene.updateProjectSelection();
                    scene.updateRightPage();
                }
                return;
            }

            if      (isDown)  this.handleMove('down');
            else if (isUp)    this.handleMove('up');
            else if (isLeft)  this.handleMove('left');
            else if (isRight) this.handleMove('right');
            else if (Input.isTriggered('ok')) this.handleOk();
            else if (Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled()) this.handleCancel();
        },

        handleMove(dir) {
            const scene = this._scene;

            const selectProjectAt = (newIdx) => {
                SoundManager.playCursor();
                scene._selectedProjectIndex = newIdx;
                scene._statusMessage = '';
                scene.updateProjectSelection();
                scene.updateRightPage();
            };

            if (scene._activeSection === 'projects') {
                const COLS  = 2;
                const total = scene.projects().length;
                const idx   = scene._selectedProjectIndex;
                if (dir === 'up') {
                    if (idx - COLS >= 0) selectProjectAt(idx - COLS);
                } else if (dir === 'down') {
                    if (idx + COLS < total) selectProjectAt(idx + COLS);
                } else if (dir === 'left') {
                    if (idx % COLS !== 0) selectProjectAt(idx - 1);
                } else if (dir === 'right') {
                    if (idx % COLS !== COLS - 1 && idx + 1 < total) {
                        selectProjectAt(idx + 1);
                    } else if (scene._actionsList.length > 0) {
                        // Cross into the actions panel: left highlight clears,
                        // the inspect page re-renders with the action focus.
                        SoundManager.playCursor();
                        scene._activeSection = 'actions';
                        scene._selectedActionIndex = 0;
                        scene.updateProjectSelection();
                        scene.updateRightPage();
                    }
                }
            } else if (scene._activeSection === 'actions') {
                const count = scene._actionsList.length;
                if (dir === 'up' && scene._selectedActionIndex > 0) {
                    SoundManager.playCursor(); scene._selectedActionIndex--; scene.updateActionHighlight();
                } else if (dir === 'down' && scene._selectedActionIndex < count - 1) {
                    SoundManager.playCursor(); scene._selectedActionIndex++; scene.updateActionHighlight();
                } else if (dir === 'left') {
                    // Back to the project grid: restore left highlight, clear
                    // the action focus in the inspect page.
                    SoundManager.playCursor();
                    scene._activeSection = 'projects';
                    scene.updateProjectSelection();
                    scene.updateRightPage();
                }
            }
        },

        handleOk() {
            const scene = this._scene;
            if (scene._activeSection === 'projects') {
                if (scene._actionsList.length > 0) {
                    SoundManager.playOk();
                    scene._activeSection = 'actions';
                    scene._selectedActionIndex = 0;
                    scene.updateProjectSelection();
                    scene.updateRightPage();
                }
            } else if (scene._activeSection === 'actions') {
                const key = scene._actionsList[scene._selectedActionIndex];
                if (key) scene.onActionButton(key);
            }
        },

        handleCancel() {
            const scene = this._scene;
            if (scene._modalMode) {
                SoundManager.playCancel(); scene.closeModal();
            } else if (scene._activeSection === 'actions') {
                SoundManager.playCancel();
                scene._activeSection = 'projects';
                scene.updateProjectSelection();
                scene.updateRightPage();
            } else {
                SoundManager.playCancel(); scene.popScene();
            }
        }
    };

})();
