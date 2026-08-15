/*:
 * @target MZ
 * @plugindesc Arena Battle Handler UI v2.0 - DOM book-spread screens for the arena (party -> mode -> gauntlet/biome).
 * @author OmniLex
 * @help ArenaBattleHandlerUI.js
 *
 * DOM overlay layer for ArenaBattleHandler.js. Must be listed AFTER
 * ArenaBattleHandler.js in the Plugin Manager.
 *
 * Screens (all share one no-redraw book-spread base):
 *   Scene_ArenaPartySelect  - pick a party (random roster or a save slot)
 *   Scene_ArenaModeSelect    - pick Gauntlet or Biome Trial (asked AFTER party)
 *   Scene_GauntletSelect     - pick a level bracket
 *   Scene_BiomeTrialSelect   - pick a biome
 *   Scene_ArenaStage         - passive interstitial that hosts a title arena
 *
 * Input: mouse (click a row to select, click again / press a button to confirm),
 * arrow keys, WASD, and gamepad (d-pad + A/B) are all supported. Selection only
 * repaints row highlights and the right page, never the whole spread.
 *
 * Theme: every colour is a CSS variable, so the screens read correctly on both
 * the Archive Foundation (parchment) and Omega Tower (black) skins.
 */

(function () {
    'use strict';

    if (!window.ArenaBattleHandler) {
        throw new Error('ArenaBattleHandlerUI.js requires ArenaBattleHandler.js to be loaded first!');
    }
    const ABH = window.ArenaBattleHandler;
    const tr = (s) => (window.translateText ? window.translateText(s) : s);

    // Escape save-slot / biome strings before injecting into innerHTML so
    // names containing < > & " ' can't corrupt the markup.
    const esc = (s) => {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    //=========================================================================
    // One-time themed stylesheet (all colours are CSS variables)
    //=========================================================================
    function injectArenaStyles() {
        if (document.getElementById('arena-ui-styles')) return;
        const style = document.createElement('style');
        style.id = 'arena-ui-styles';
        style.textContent = `
        #arena-ui-container {
            position: fixed; top: 0; right: 0; bottom: 0; left: 0;
            display: flex; justify-content: center;
            align-items: center; z-index: 1000; box-sizing: border-box; padding: 24px;
            background: var(--gradient-33); user-select: none; -webkit-user-select: none;
        }
        #arena-ui-container .arena-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 12px; gap: 12px;
        }
        #arena-ui-container .arena-back {
            font-family: 'Lora', serif; font-size: 0.915rem; background: var(--text-primary-hover);
            color: var(--bg-panel); border-radius: 4px; padding: 4px 10px; cursor: pointer;
            font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;
            border: 1px solid var(--border-subtle);
        }
        #arena-ui-container .arena-back:hover { filter: brightness(1.12); }
        #arena-ui-container .arena-subtitle {
            font-family: 'Lora', serif; font-size: 0.952rem; color: var(--text-info);
            margin: -6px 0 10px 0; letter-spacing: 0.4px;
        }
        #arena-ui-container .arena-scroll {
            flex: 1; min-height: 0; overflow-y: auto; padding-right: 8px; display: flex;
            flex-direction: column; gap: 8px; box-sizing: border-box;
        }
        #arena-ui-container .arena-row {
            display: flex; align-items: center; gap: 12px; padding: 10px 14px;
            background: var(--bg-primary-hover-translucent-35);
            border: 1px solid var(--border-subtle-translucent-25); border-radius: 6px;
            cursor: pointer; font-family: 'Lora', serif;
            transition: border-color 0.15s ease, background 0.15s ease;
        }
        #arena-ui-container .arena-row:hover { border-color: var(--text-primary-hover); }
        #arena-ui-container .arena-row.selected {
            border-color: var(--text-primary-hover);
            background: var(--bg-tertiary-focus-translucent-45);
        }
        #arena-ui-container .arena-row-text { flex: 1; min-width: 0; }
        #arena-ui-container .arena-row-label {
            font-weight: bold; color: var(--text-text-alt-2); font-size: 1.176rem;
        }
        #arena-ui-container .arena-row.selected .arena-row-label { color: var(--text-primary-hover); }
        #arena-ui-container .arena-row-sub {
            font-size: 0.952rem; color: var(--text-info); white-space: nowrap;
            overflow: hidden; text-overflow: ellipsis;
        }
        #arena-ui-container .arena-badge {
            font-family: 'Lora', serif; font-size: 0.915rem; font-weight: bold;
            color: var(--text-info); white-space: nowrap;
        }
        #arena-ui-container .arena-icon {
            width: 44px; height: 44px; min-width: 44px; display: flex; align-items: center;
            justify-content: center; font-size: 1.76rem; color: var(--text-primary-hover);
        }
        #arena-ui-container .arena-thumb {
            width: 44px; height: 44px; min-width: 44px; image-rendering: pixelated;
        }
        #arena-ui-container .arena-right {
            display: flex; flex-direction: column; gap: 12px; height: 100%; box-sizing: border-box;
        }
        #arena-ui-container .arena-right.center {
            justify-content: center; align-items: center; text-align: center; padding: 24px; gap: 14px;
        }
        #arena-ui-container .arena-big-glyph { font-size: 4.4rem; color: var(--text-primary-hover); line-height: 1; }
        #arena-ui-container .arena-detail-head { border-bottom: 2px solid var(--border-subtle); padding-bottom: 6px; }
        #arena-ui-container .arena-detail-title {
            font-family: 'Lora', serif; font-size: 1.76rem; color: var(--text-primary-hover);
            margin: 0; line-height: 1.2;
        }
        #arena-ui-container .arena-detail-sub {
            font-size: 0.96rem; color: var(--text-info); font-family: 'Lora', serif;
            text-transform: uppercase; letter-spacing: 0.5px;
        }
        #arena-ui-container .arena-info-card {
            background: var(--bg-primary-hover-translucent-35);
            border: 1px solid var(--border-subtle-translucent-25); border-radius: 6px;
            padding: 12px; text-align: left; font-size: 1.02rem; line-height: 1.5;
            color: var(--text-text-alt-2); box-sizing: border-box; width: 100%;
        }
        #arena-ui-container .arena-info-card strong { color: var(--text-primary-hover); }
        #arena-ui-container .arena-info-card ul { margin: 0; padding-left: 18px; }
        #arena-ui-container .arena-member {
            display: flex; align-items: center; gap: 12px; padding: 8px 10px;
            background: var(--bg-primary-hover-translucent-35);
            border: 1px solid var(--border-subtle-translucent-25); border-radius: 6px;
        }
        #arena-ui-container .arena-member-name {
            font-family: 'Lora', serif; font-weight: bold; color: var(--text-primary-hover); font-size: 1.15rem;
        }
        #arena-ui-container .arena-member-meta { font-size: 0.96rem; color: var(--text-text-alt-2); }
        #arena-ui-container .arena-action-btn {
            display: flex; justify-content: center; align-items: center; padding: 12px 24px;
            background: var(--text-primary-hover); color: var(--bg-panel);
            border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer;
            font-weight: bold; text-transform: uppercase; font-family: 'Lora', serif;
            font-size: 1.322rem; box-shadow: 0 3px 6px var(--shadow-black-translucent-25);
            transition: filter 0.15s ease, box-shadow 0.15s ease; box-sizing: border-box;
        }
        #arena-ui-container .arena-action-btn:hover {
            filter: brightness(1.12); box-shadow: 0 0 10px var(--shadow-gold-amber-50);
        }
        #arena-ui-container .arena-preview {
            width: 100%; aspect-ratio: 16 / 9; object-fit: cover;
            border: 3px double var(--text-primary-hover); border-radius: 6px;
            box-shadow: 0 4px 12px var(--shadow-black-translucent-25); box-sizing: border-box;
        }
        #arena-ui-container .arena-preview-missing {
            width: 100%; aspect-ratio: 16 / 9; border: 3px double var(--text-primary-hover);
            border-radius: 6px; background: var(--bg-panel); display: flex; align-items: center;
            justify-content: center; color: var(--text-info); font-family: 'Lora', serif; box-sizing: border-box;
        }
        #arena-ui-container .arena-empty {
            opacity: 0.7; font-style: normal; margin-top: 24px; font-family: 'Lora', serif;
            color: var(--text-text-alt-2); text-align: center;
        }`;
        document.head.appendChild(style);
    }

    //=========================================================================
    // Scene_ArenaBook - shared list/detail base (no full redraws)
    //=========================================================================
    function Scene_ArenaBook() { this.initialize(...arguments); }
    Scene_ArenaBook.prototype = Object.create(Scene_Base.prototype);
    Scene_ArenaBook.prototype.constructor = Scene_ArenaBook;

    Scene_ArenaBook.prototype.initialize = function () {
        Scene_Base.prototype.initialize.call(this);
        this._selectedIndex = 0;
        this._busy = false;
        this._entries = [];
    };

    Scene_ArenaBook.prototype.create = function () {
        Scene_Base.prototype.create.call(this);
        this.createBackground();
        injectArenaStyles();
        this._entries = this.buildEntries() || [];
        this.createDOM();
        this.setupWASD();
    };

    Scene_ArenaBook.prototype.createBackground = function () {
        this._backgroundSprite = new Sprite();
        this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
        this.addChild(this._backgroundSprite);
    };

    Scene_ArenaBook.prototype.terminate = function () {
        this.teardownWASD();
        if (this._dndContainer) {
            const container = this._dndContainer;
            container.style.transition = 'opacity 0.2s ease-out';
            container.style.opacity = '0';
            container.style.pointerEvents = 'none';
            setTimeout(() => {
                if (container && container.parentNode) container.parentNode.removeChild(container);
            }, 200);
            this._dndContainer = null;
        }
        Scene_Base.prototype.terminate.call(this);
    };

    // ---- WASD (arrows + gamepad are handled by MZ Input natively) ----
    Scene_ArenaBook.prototype.setupWASD = function () {
        this._wasd = { up: false, down: false };
        this._wasdHeld = { up: false, down: false };
        this._wasdFrames = { up: 0, down: 0 };
        this._onKeyDown = (e) => {
            if (e.repeat) return;
            const k = e.key.toLowerCase();
            if (k === 'w') { this._wasd.up = true; this._wasdHeld.up = true; e.preventDefault(); }
            if (k === 's') { this._wasd.down = true; this._wasdHeld.down = true; e.preventDefault(); }
        };
        this._onKeyUp = (e) => {
            const k = e.key.toLowerCase();
            if (k === 'w') { this._wasdHeld.up = false; this._wasdFrames.up = 0; }
            if (k === 's') { this._wasdHeld.down = false; this._wasdFrames.down = 0; }
        };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    };

    Scene_ArenaBook.prototype.teardownWASD = function () {
        if (this._onKeyDown) {
            window.removeEventListener('keydown', this._onKeyDown);
            window.removeEventListener('keyup', this._onKeyUp);
            this._onKeyDown = this._onKeyUp = null;
        }
    };

    Scene_ArenaBook.prototype._pollWASD = function () {
        for (const d of ['up', 'down']) {
            if (this._wasdHeld[d]) {
                this._wasdFrames[d]++;
                const t = this._wasdFrames[d];
                if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
                    this._wasd[d] = true;
                }
            } else {
                this._wasdFrames[d] = 0;
            }
        }
    };

    // ---- DOM shell (built once) ----
    Scene_ArenaBook.prototype.createDOM = function () {
        this._dndContainer = document.createElement('div');
        this._dndContainer.id = 'arena-ui-container';
        this._dndContainer.style.opacity = '0';
        this._dndContainer.style.transition = 'opacity 0.22s ease-out';
        document.body.appendChild(this._dndContainer);
        this.buildStaticDOM();
        this.updateSelection();
        this._dndContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const box = this._dndContainer && this._dndContainer.querySelector('#arena-scroll');
            if (box) box.scrollTop += e.deltaY;
        }, { passive: false });
        setTimeout(() => { if (this._dndContainer) this._dndContainer.style.opacity = '1'; }, 16);
    };

    Scene_ArenaBook.prototype.buildStaticDOM = function () {
        if (!this._dndContainer) return;
        let rowsHTML = '';
        if (this._entries.length === 0) {
            rowsHTML = `<div class="arena-empty">${this.emptyText()}</div>`;
        } else {
            this._entries.forEach((entry, idx) => {
                rowsHTML += `<div class="arena-row" id="arena-row-${idx}" onclick="SceneManager._scene.selectEntry(${idx})">${this.renderRow(entry, idx)}</div>`;
            });
        }
        const sub = this.subtitle();
        this._dndContainer.innerHTML = `
            <div class="book-spread">
                <div class="left-page">
                    <div class="arena-header">
                        <h2 class="cc-header-gothic" style="font-size:1.925rem; margin:0">${this.headerTitle()}</h2>
                        <div class="arena-back" onclick="SceneManager._scene.goBack()">${this.backLabel()}</div>
                    </div>
                    ${sub ? `<div class="arena-subtitle">${sub}</div>` : ''}
                    <div id="arena-scroll" class="arena-scroll">${rowsHTML}</div>
                </div>
                <div class="right-page" id="arena-right-page"></div>
            </div>`;
        this.afterBuild();
    };

    // In-place update: only recolour rows + rebuild the right page.
    Scene_ArenaBook.prototype.updateSelection = function () {
        if (!this._dndContainer) return;
        this._entries.forEach((entry, idx) => {
            const el = this._dndContainer.querySelector(`#arena-row-${idx}`);
            if (el) el.classList.toggle('selected', idx === this._selectedIndex);
        });
        const rp = this._dndContainer.querySelector('#arena-right-page');
        if (rp) {
            const entry = this._entries[this._selectedIndex];
            rp.innerHTML = entry ? this.renderRightPage(entry) : '';
            this.afterSelect(entry);
        }
    };

    Scene_ArenaBook.prototype.scrollToActive = function () {
        if (!this._dndContainer) return;
        const box = this._dndContainer.querySelector('#arena-scroll');
        const active = this._dndContainer.querySelector('#arena-scroll .arena-row.selected');
        if (box && active) {
            const b = box.getBoundingClientRect();
            const a = active.getBoundingClientRect();
            if (a.bottom > b.bottom) box.scrollTop += (a.bottom - b.bottom) + 10;
            else if (a.top < b.top) box.scrollTop -= (b.top - a.top) + 10;
        }
    };

    // ---- selection / confirm / cancel ----
    Scene_ArenaBook.prototype.selectEntry = function (index) {
        if (this._busy) return;
        if (index === this._selectedIndex) { this.confirmSelection(); return; }
        this._selectedIndex = index;
        SoundManager.playCursor();
        this.updateSelection();
        this.scrollToActive();
    };

    Scene_ArenaBook.prototype._moveCursor = function (delta) {
        const max = this._entries.length;
        if (max === 0) return;
        this._selectedIndex = (this._selectedIndex + delta + max) % max;
        SoundManager.playCursor();
        this.updateSelection();
        this.scrollToActive();
    };

    Scene_ArenaBook.prototype.confirmSelection = function () {
        if (this._busy) return;
        const entry = this._entries[this._selectedIndex];
        if (!entry) return;
        this.onConfirm(entry);
    };

    Scene_ArenaBook.prototype.goBack = function () {
        if (this._busy) return;
        SoundManager.playCancel();
        this.onCancel();
    };

    Scene_ArenaBook.prototype.update = function () {
        Scene_Base.prototype.update.call(this);
        if (this._busy) return;
        this._pollWASD();

        const down = Input.isRepeated('down') || this._wasd.down;
        const up = Input.isRepeated('up') || this._wasd.up;
        this._wasd.up = this._wasd.down = false;

        if (this._entries.length === 0) {
            if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) this.goBack();
            return;
        }
        if (down) this._moveCursor(1);
        else if (up) this._moveCursor(-1);
        else if (Input.isTriggered('ok')) this.confirmSelection();
        else if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) this.goBack();
    };

    // ---- default hooks (subclasses override) ----
    Scene_ArenaBook.prototype.buildEntries = function () { return []; };
    Scene_ArenaBook.prototype.renderRow = function () { return ''; };
    Scene_ArenaBook.prototype.renderRightPage = function () { return ''; };
    Scene_ArenaBook.prototype.onConfirm = function () { };
    Scene_ArenaBook.prototype.onCancel = function () { this.popScene(); };
    Scene_ArenaBook.prototype.afterBuild = function () { };
    Scene_ArenaBook.prototype.afterSelect = function () { };
    Scene_ArenaBook.prototype.headerTitle = function () { return ''; };
    Scene_ArenaBook.prototype.subtitle = function () { return ''; };
    Scene_ArenaBook.prototype.backLabel = function () { return T('Arena.back'); };
    Scene_ArenaBook.prototype.emptyText = function () { return T('Arena.nothingAvailable'); };

    // Shared helper: draw an actor's down-facing sprite frame into a canvas.
    Scene_ArenaBook.prototype.drawSprite = function (canvasId, characterName, characterIndex) {
        const canvas = this._dndContainer
            ? this._dndContainer.querySelector('#' + canvasId)
            : document.getElementById(canvasId);
        if (!canvas || !characterName) return;
        const bitmap = ImageManager.loadCharacter(characterName);
        const draw = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx || !bitmap.width || !bitmap.height) return;
            ctx.imageSmoothingEnabled = false;
            const isBig = ImageManager.isBigCharacter(characterName);
            const pw = bitmap.width / (isBig ? 3 : 12);
            const ph = bitmap.height / (isBig ? 4 : 8);
            if (pw <= 0 || ph <= 0) return;
            const sx = isBig ? pw : ((characterIndex % 4) * 3 + 1) * pw;
            const sy = isBig ? 0 : (Math.floor(characterIndex / 4) * 4) * ph;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const fit = Math.min(canvas.width / pw, canvas.height / ph);
            const dw = pw * fit;
            const dh = ph * fit;
            ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        };
        if (bitmap.isReady()) draw(); else bitmap.addLoadListener(draw);
    };

    //=========================================================================
    // Scene_ArenaPartySelect - pick a party (random roster or a save slot)
    //=========================================================================
    function Scene_ArenaPartySelect() { this.initialize(...arguments); }
    Scene_ArenaPartySelect.prototype = Object.create(Scene_ArenaBook.prototype);
    Scene_ArenaPartySelect.prototype.constructor = Scene_ArenaPartySelect;

    Scene_ArenaPartySelect.prototype.headerTitle = function () { return T('Arena.chooseAParty'); };
    Scene_ArenaPartySelect.prototype.backLabel = function () { return T('Arena.dismiss'); };
    Scene_ArenaPartySelect.prototype.subtitle = function () {
        const worldName = (window.WorldManager && window.WorldManager.activeWorldName) || '';
        return worldName ? (T('Arena.world')) + worldName : '';
    };

    Scene_ArenaPartySelect.prototype.buildEntries = function () {
        const entries = [{ type: 'random' }];
        if (!DataManager.isGlobalInfoLoaded || !DataManager.isGlobalInfoLoaded()) {
            try { DataManager.loadGlobalInfo(); } catch (e) { /* best effort */ }
        }
        const maxFiles = DataManager.maxSavefiles ? DataManager.maxSavefiles() : 20;
        for (let i = 1; i <= maxFiles; i++) {
            const info = DataManager.savefileInfo(i);
            if (!info) continue;
            let members = null;
            if (info.partyInfo && info.partyInfo.length) {
                members = info.partyInfo.map(p => ({
                    name: p.name || '', level: p.level || 0, className: p.className || '',
                    characterName: p.characterName || '', characterIndex: p.characterIndex || 0
                }));
            } else if (info.characters && info.characters.length) {
                members = info.characters.map(c => ({
                    name: '', level: 0, className: '', characterName: c[0], characterIndex: c[1]
                }));
            }
            if (!members || members.length === 0) continue;
            entries.push({ type: 'save', slotId: i, members, playtime: info.playtime || '' });
        }
        return entries;
    };

    Scene_ArenaPartySelect.prototype.renderRow = function (entry, idx) {
        if (entry.type === 'random') {
            return `<div class="arena-icon">&#9861;</div>
                <div class="arena-row-text">
                    <div class="arena-row-label">${T('Arena.randomParty')}</div>
                    <div class="arena-row-sub">${T('Arena.3GeneratedCombatants')}</div>
                </div>`;
        }
        const names = entry.members.map(m => esc(m.name)).filter(Boolean).join(', ');
        const sub = names || (entry.members.length + (T('Arena.members')));
        return `<canvas id="arena-thumb-${idx}" width="44" height="44" class="arena-thumb"></canvas>
            <div class="arena-row-text">
                <div class="arena-row-label">${(T('Arena.slot')) + entry.slotId}</div>
                <div class="arena-row-sub">${sub}</div>
            </div>`;
    };

    Scene_ArenaPartySelect.prototype.afterBuild = function () {
        this._entries.forEach((entry, idx) => {
            if (entry.type === 'save' && entry.members[0]) {
                this.drawSprite(`arena-thumb-${idx}`, entry.members[0].characterName, entry.members[0].characterIndex);
            }
        });
    };

    Scene_ArenaPartySelect.prototype.renderRightPage = function (entry) {
        const continueLabel = T('Arena.continue');
        if (entry.type === 'random') {
            return `<div class="arena-right center">
                <div class="arena-big-glyph">&#9861;</div>
                <h3 class="arena-detail-title">${T('Arena.randomParty2')}</h3>
                <div class="arena-info-card">${T('Arena.threeRandomCombatantsWithGear')}</div>
                <div class="arena-action-btn" style="width:85%" onclick="SceneManager._scene.confirmSelection()">${continueLabel}</div>
            </div>`;
        }
        let memberCards = '';
        entry.members.forEach((m, mi) => {
            const cls = esc(m.className || '');
            const lvl = m.level ? 'Lv. ' + esc(m.level) : '';
            memberCards += `<div class="arena-member">
                <canvas id="arena-detail-${this._selectedIndex}-${mi}" width="48" height="48" class="arena-thumb" style="width:48px; height:48px; min-width:48px"></canvas>
                <div class="arena-row-text">
                    <div class="arena-member-name">${esc(m.name) || (T('Arena.unknown'))}</div>
                    <div class="arena-member-meta">${[cls, lvl].filter(Boolean).join(' &middot; ')}</div>
                </div>
            </div>`;
        });
        return `<div class="arena-right">
            <div class="arena-detail-head">
                <h3 class="arena-detail-title">${(T('Arena.saveSlot')) + entry.slotId}</h3>
                <div class="arena-detail-sub">${entry.playtime || ''}</div>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px; overflow-y:auto; flex:1">${memberCards}</div>
            <div class="arena-action-btn" style="margin-top:auto" onclick="SceneManager._scene.confirmSelection()">${continueLabel}</div>
        </div>`;
    };

    Scene_ArenaPartySelect.prototype.afterSelect = function (entry) {
        if (entry && entry.type === 'save') {
            entry.members.forEach((m, mi) => {
                this.drawSprite(`arena-detail-${this._selectedIndex}-${mi}`, m.characterName, m.characterIndex); // i18n-ignore: DOM element id for the member sprite slot
            });
        }
    };

    Scene_ArenaPartySelect.prototype.onConfirm = function (entry) {
        this._busy = true;
        SoundManager.playOk();
        if (entry.type === 'random') {
            DataManager.setupNewGame();
            ABH.beginTitleFlow('random');
            this._busy = false;
            SceneManager.push(Scene_ArenaModeSelect);
        } else {
            DataManager.loadGame(entry.slotId).then(() => {
                ABH.beginTitleFlow('save');
                this._busy = false;
                SceneManager.push(Scene_ArenaModeSelect);
            }).catch(e => {
                console.error('Scene_ArenaPartySelect: failed to load slot', entry.slotId, e);
                SoundManager.playBuzzer();
                this._busy = false;
            });
        }
    };

    Scene_ArenaPartySelect.prototype.onCancel = function () {
        // Leaving the party picker abandons the whole title arena session.
        ABH.cancelTitleFlow();
        this.popScene();
    };

    //=========================================================================
    // Scene_ArenaModeSelect - choose Gauntlet or Biome Trial (after party)
    //=========================================================================
    function Scene_ArenaModeSelect() { this.initialize(...arguments); }
    Scene_ArenaModeSelect.prototype = Object.create(Scene_ArenaBook.prototype);
    Scene_ArenaModeSelect.prototype.constructor = Scene_ArenaModeSelect;

    Scene_ArenaModeSelect.prototype.headerTitle = function () { return T('Arena.chooseAMode'); };
    Scene_ArenaModeSelect.prototype.backLabel = function () { return T('Arena.back'); };

    Scene_ArenaModeSelect.prototype.buildEntries = function () {
        return [{ type: 'gauntlet' }, { type: 'biome' }];
    };

    Scene_ArenaModeSelect.prototype.renderRow = function (entry) {
        if (entry.type === 'gauntlet') {
            return `<div class="arena-icon">&#9876;</div>
                <div class="arena-row-text">
                    <div class="arena-row-label">${T('Arena.gauntlet')}</div>
                    <div class="arena-row-sub">${T('Arena.consecutiveLevelBrackets')}</div>
                </div>`;
        }
        return `<div class="arena-icon">&#127794;</div>
            <div class="arena-row-text">
                <div class="arena-row-label">${T('Arena.biomeTrial')}</div>
                <div class="arena-row-sub">${T('Arena.climbABiomeRoster')}</div>
            </div>`;
    };

    Scene_ArenaModeSelect.prototype.renderRightPage = function (entry) {
        const go = T('Arena.select');
        if (entry.type === 'gauntlet') {
            return `<div class="arena-right center">
                <div class="arena-big-glyph">&#9876;</div>
                <h3 class="arena-detail-title">${T('Arena.gauntlet2')}</h3>
                <div class="arena-info-card"><ul>
                    <li>${T('Arena.pickALevelBracket')}</li>
                    <li>${T('Arena.yourPartyIsRescaledTo')}</li>
                    <li>${T('Arena.win7ConsecutiveBoutsTo')}</li>
                    <li>${T('Arena.defeatEndsTheGauntlet')}</li>
                </ul></div>
                <div class="arena-action-btn" style="width:85%" onclick="SceneManager._scene.confirmSelection()">${go}</div>
            </div>`;
        }
        return `<div class="arena-right center">
            <div class="arena-big-glyph">&#127794;</div>
            <h3 class="arena-detail-title">${T('Arena.biomeTrial2')}</h3>
            <div class="arena-info-card"><ul>
                <li>${T('Arena.pickABiomeToClimb')}</li>
                <li>${T('Arena.fightTheBiomeRosterIn')}</li>
                <li>${T('Arena.eachWinGrantsALevel')}</li>
            </ul></div>
            <div class="arena-action-btn" style="width:85%" onclick="SceneManager._scene.confirmSelection()">${go}</div>
        </div>`;
    };

    Scene_ArenaModeSelect.prototype.onConfirm = function (entry) {
        SoundManager.playOk();
        if (entry.type === 'gauntlet') SceneManager.push(Scene_GauntletSelect);
        else SceneManager.push(Scene_BiomeTrialSelect);
    };

    //=========================================================================
    // Scene_GauntletSelect - pick a level bracket
    //=========================================================================
    function Scene_GauntletSelect() { this.initialize(...arguments); }
    Scene_GauntletSelect.prototype = Object.create(Scene_ArenaBook.prototype);
    Scene_GauntletSelect.prototype.constructor = Scene_GauntletSelect;

    Scene_GauntletSelect.prototype.headerTitle = function () { return T('Arena.gauntletBracket'); };
    Scene_GauntletSelect.prototype.backLabel = function () { return T('Arena.back'); };

    Scene_GauntletSelect.prototype.buildEntries = function () {
        return ABH.BRACKETS.map((bracket, index) => ({
            bracket, index,
            label: ABH.getBracketLabel(bracket),
            count: ABH.countTroopsInBracket(bracket)
        }));
    };

    Scene_GauntletSelect.prototype.renderRow = function (entry) {
        return `<div class="arena-row-label" style="flex:1">${entry.label}</div>
            <span class="arena-badge">${entry.count} ${T('Arena.vessels')}</span>`;
    };

    Scene_GauntletSelect.prototype.renderRightPage = function (entry) {
        return `<div class="arena-right center">
            <div class="arena-big-glyph">&#9876;</div>
            <h3 class="arena-detail-title">${entry.label}</h3>
            <div class="arena-detail-sub">${entry.count} ${T('Arena.eligibleCombatantVessels')}</div>
            <div class="arena-info-card">
                <strong style="display:block; text-align:center; margin-bottom:5px; font-size:1.15rem">
                    ${T('Arena.theDecreeOfTheTrial')}
                </strong>
                <ul>
                    <li>${T('Arena.yourPartyIsRescaledTo2')}</li>
                    <li>${T('Arena.vanquish7ConsecutiveVesselsTo')}</li>
                    <li>${T('Arena.noRetreatPermittedDefeatEnds')}</li>
                </ul>
            </div>
            <div class="arena-action-btn" style="width:85%" onclick="SceneManager._scene.confirmSelection()">${T('Arena.initiateGauntlet')}</div>
        </div>`;
    };

    Scene_GauntletSelect.prototype.onConfirm = function (entry) {
        SoundManager.playOk();
        const bracketIndex = entry.index + 1;
        if (ABH.isTitleFlow()) {
            // Title arena: hands to Scene_ArenaStage which kicks the first bout.
            ABH.launchGauntlet(bracketIndex);
        } else {
            // In-game / 2P: leave the picker first, then start the battle.
            this.popScene();
            ABH.launchGauntlet(bracketIndex);
        }
    };

    //=========================================================================
    // Scene_BiomeTrialSelect - pick a biome
    //=========================================================================
    function Scene_BiomeTrialSelect() { this.initialize(...arguments); }
    Scene_BiomeTrialSelect.prototype = Object.create(Scene_ArenaBook.prototype);
    Scene_BiomeTrialSelect.prototype.constructor = Scene_BiomeTrialSelect;

    Scene_BiomeTrialSelect.prototype.headerTitle = function () { return T('Arena.biomeTrials'); };
    Scene_BiomeTrialSelect.prototype.backLabel = function () { return T('Arena.back'); };
    Scene_BiomeTrialSelect.prototype.emptyText = function () { return T('Arena.noBiomesAvailable'); };

    Scene_BiomeTrialSelect.prototype.buildEntries = function () {
        return ABH.getPlayableBiomes();
    };

    Scene_BiomeTrialSelect.prototype.renderRow = function (entry) {
        return `<div class="arena-row-label" style="flex:1">${esc(window.BiomeNames.display(entry.biome))}</div>
            <span class="arena-badge">Lv ${entry.minLevel}-${entry.maxLevel} &middot; ${entry.count} ${T('Arena.vessels')}</span>`;
    };

    Scene_BiomeTrialSelect.prototype.renderRightPage = function (entry) {
        const preview = (window.getBiomeBattlebackPreview && window.getBiomeBattlebackPreview(entry.biome)) || null;
        const previewHTML = preview
            ? `<img src="${preview}" class="arena-preview" />`
            : `<div class="arena-preview-missing">${T('Arena.noPreview')}</div>`;
        return `<div class="arena-right">
            <div class="arena-detail-head">
                <h3 class="arena-detail-title">${esc(window.BiomeNames.display(entry.biome))}</h3>
                <div class="arena-detail-sub">${entry.count} ${T('Arena.combatantVessels')} &middot; ${T('Arena.levels')} ${entry.minLevel}-${entry.maxLevel}</div>
            </div>
            ${previewHTML}
            <div class="arena-info-card"><ul>
                <li>${T('Arena.yourChosenPartyIsRescaled')}</li>
                <li>${T('Arena.eachVictoryGrantsALevel')}</li>
                <li>${T('Arena.ifTheLevelGapIs')}</li>
            </ul></div>
            <div class="arena-action-btn" style="margin-top:auto" onclick="SceneManager._scene.confirmSelection()">${T('Arena.beginTheTrial')}</div>
        </div>`;
    };

    Scene_BiomeTrialSelect.prototype.onConfirm = function (entry) {
        this._busy = true;
        SoundManager.playOk();
        if (ABH.isTitleFlow()) {
            // Party already chosen; launchBiomeTrial routes by party source.
            if (!ABH.launchBiomeTrial(entry.biome)) this._busy = false;
        } else {
            // Direct (non-title) entry: fresh level-1 roster climb.
            DataManager.setupNewGame();
            ABH.beginTitleFlow('random');
            if (!ABH.launchBiomeTrial(entry.biome)) this._busy = false;
        }
    };

    //=========================================================================
    // Scene_ArenaStage - passive interstitial hosting a title arena
    //=========================================================================
    // Kicks only the FIRST bout (when a starter is queued); every later return
    // here between bouts is a brief lull while the victory handler queues the next
    // fight. It reads no input, so it can never double-start a fight. The backdrop
    // reads the live theme (--bg-panel/--text-primary-hover), so it goes black on
    // Omega Tower and parchment on Archive Foundation like every other Arena screen.
    function Scene_ArenaStage() { this.initialize(...arguments); }
    Scene_ArenaStage.prototype = Object.create(Scene_Base.prototype);
    Scene_ArenaStage.prototype.constructor = Scene_ArenaStage;

    const themeVar = (name, fallback) => {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return v || fallback;
        } catch (e) { return fallback; }
    };

    Scene_ArenaStage.prototype.create = function () {
        Scene_Base.prototype.create.call(this);
        const bgColor = themeVar('--bg-panel', '#120a08');
        const textColor = themeVar('--text-primary-hover', '#d4a64e');

        this._backgroundSprite = new Sprite();
        this._backgroundSprite.bitmap = new Bitmap(Graphics.width, Graphics.height);
        this._backgroundSprite.bitmap.fillAll(bgColor);
        this.addChild(this._backgroundSprite);

        const sprite = new Sprite();
        sprite.bitmap = new Bitmap(Graphics.width, 120);
        sprite.bitmap.fontFace = 'Lora';
        sprite.bitmap.fontSize = 44;
        sprite.bitmap.textColor = textColor;
        sprite.bitmap.drawText(
            T('Arena.theArenaAwaitsTheNext'),
            0, 0, Graphics.width, 120, 'center'
        );
        sprite.y = Math.floor((Graphics.height - 120) / 2);
        this.addChild(sprite);
    };

    Scene_ArenaStage.prototype.start = function () {
        Scene_Base.prototype.start.call(this);
        this.startFadeIn(this.fadeSpeed(), false);
        this._watchdogFrames = 0;
        const starter = ABH.consumeArenaStageStarter();
        if (starter) starter();
    };

    // Safety net: the normal handoff between bouts is a short setTimeout queued
    // by processGauntletVictory/processBiomeTrialVictory (ArenaBattleHandler.js),
    // guarded on the scene still being "active" at the moment it fires. A message
    // popup (e.g. the bracket-advance congratulations) can hold Scene_Battle busy
    // long enough to desync that guard, which drops the queued bout for good and
    // strands the player on this screen forever. If nothing has moved this scene
    // along after a couple of seconds, resume the run directly.
    Scene_ArenaStage.prototype.update = function () {
        Scene_Base.prototype.update.call(this);
        if (SceneManager._scene !== this || SceneManager.isSceneChanging()) return;
        this._watchdogFrames = (this._watchdogFrames || 0) + 1;
        if (this._watchdogFrames === 150 && ABH.resumeStrandedSession) {
            ABH.resumeStrandedSession();
        }
    };

    //=========================================================================
    // Exports (preserve the global scene names other plugins rely on)
    //=========================================================================
    window.Scene_ArenaPartySelect = Scene_ArenaPartySelect;
    window.Scene_ArenaModeSelect = Scene_ArenaModeSelect;
    window.Scene_GauntletSelect = Scene_GauntletSelect;
    window.Scene_BiomeTrialSelect = Scene_BiomeTrialSelect;
    window.Scene_ArenaStage = Scene_ArenaStage;
})();
