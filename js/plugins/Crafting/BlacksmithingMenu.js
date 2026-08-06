/*:
 * @target MZ
 * @plugindesc Blacksmithing v1.0.0 - the forge: every weapon and armor recipe in the game, gated by the trade that makes it.
 * @author Esoteric Heavy Industries
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @param menuName
 * @text Menu Name
 * @desc Label for the main-menu command.
 * @default Blacksmithing
 *
 * @param showInMenu
 * @text Show in Main Menu
 * @desc Add the forge to the main menu.
 * @type boolean
 * @default true
 *
 * @command openBlacksmithing
 * @text Open Blacksmithing
 * @desc Opens the forge (an anvil, a workshop, a smithy event).
 *
 * @help BlacksmithingMenu.js
 * ============================================================================
 * The forge
 * ============================================================================
 *
 * The Thinker's workbench with the opposite philosophy. Where the Thinker
 * hides a recipe until it has been made once, the forge hides nothing: every
 * weapon and armor in the game is on the board from the first visit, and what
 * changes as the party trains is which of them their hands can actually make.
 *
 *   Smithable    - everything the selected member can make right now
 *   Too complex  - everything they cannot, with the tier it is waiting for
 *
 * WHAT AN ENTRY NEEDS
 * -------------------
 * Written onto the entry itself in data/Weapons.json / data/Armors.json, so
 * the item is the authority and no lookup table has to agree with it:
 *
 *   <Recipe: 865x13, 863x5, 866x5, 864x6>   what it is made of
 *   <Craft: Bladesmithing>                  the trade that makes it
 *   <CraftLevel: 5>                         the tier of that trade it needs
 *
 * One trade per entry, always: a thing is made by a smith or by a tailor, not
 * by a committee. `<CraftLevel:>` is derived from price (an entry under 5000
 * gold is tier 1, which anybody Untrained can make) and the three tags are
 * regenerated together by tools/forge/balance_forge_recipes.py.
 *
 * Around 31 trades are in play, so the board is not all hammers: a robe is
 * Tailoring, a wig is Wig Making, a costume is Cosplay, a ring is Jewelry
 * Making, a rifle is Gunsmithing, a circuit-woven coat is Electronics.
 *
 * WHOSE HANDS
 * -----------
 * The party switcher on the right page names who is at the anvil. Everything
 * is read off THEM: which tab an entry falls into, whether the Forge button
 * lights, and who earns the specialization points for the work. Switching
 * member re-sorts the whole board.
 */

(() => {
    'use strict';

    const pluginName = 'BlacksmithingMenu';
    const parameters = PluginManager.parameters(pluginName);
    const menuName = parameters['menuName'] || 'Blacksmithing';
    const showInMenu = parameters['showInMenu'] !== 'false';

    const bsText = () => T.obj('Blacksmith');
    const tr = (name) => (typeof window.translateText === 'function' ? window.translateText(name) : name);

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // What a finished piece teaches its maker, by the tier it demanded.
    const TIER_POINTS = [0, 1, 2, 4, 6, 9];

    // ------------------------------------------------------------------------
    // Reading the entries
    // ------------------------------------------------------------------------
    function isRealEntry(x) {
        return x && x.name && x.name.trim() && !x.name.includes('-->');
    }

    const _recipeCache = new Map();
    function parseRecipe(item) {
        if (!item || !item.note) return null;
        if (_recipeCache.has(item)) return _recipeCache.get(item);
        const match = item.note.match(/<Recipe:\s*(.+?)>/i);
        let recipe = null;
        if (match) {
            recipe = {};
            for (const part of match[1].split(',')) {
                const [id, qty] = part.trim().split('x');
                const mid = parseInt(id);
                if (mid) recipe[mid] = parseInt(qty) || 1;
            }
        }
        _recipeCache.set(item, recipe);
        return recipe;
    }

    // The trade, as the entry itself declares it.
    function craftSpecName(item) {
        const raw = item && item.meta && item.meta.Craft;
        return raw ? String(raw).trim() : '';
    }

    function craftSpec(item) {
        const name = craftSpecName(item);
        if (!name || !window.Specializations || !window.Specializations.ready) return null;
        return window.Specializations.byName.get(name) || null;
    }

    function craftTier(item) {
        const raw = item && item.meta && item.meta.CraftLevel;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 1 ? Math.min(5, Math.round(n)) : 1;
    }

    let _entriesCache = null;
    let _entriesSource = null;
    function forgeEntries() {
        if (_entriesCache && _entriesSource === $dataWeapons) return _entriesCache;
        const out = [];
        for (const x of $dataWeapons) if (isRealEntry(x) && parseRecipe(x) && craftSpecName(x)) out.push(x);
        for (const x of $dataArmors) if (isRealEntry(x) && parseRecipe(x) && craftSpecName(x)) out.push(x);
        _entriesCache = out;
        _entriesSource = $dataWeapons;
        return out;
    }

    function isSandbox() {
        return !!($gameSystem && $gameSystem._isSandboxMode);
    }

    function hasMaterials(recipe) {
        if (isSandbox()) return true;
        if (!recipe) return false;
        for (const [id, need] of Object.entries(recipe)) {
            const mat = $dataItems[parseInt(id)];
            if (!mat || $gameParty.numItems(mat) < need) return false;
        }
        return true;
    }

    function levelName(level) {
        const db = window.Specializations;
        return (db && db.levelName) ? db.levelName(level) : String(level);
    }

    function rarityOf(item) {
        if (window.ItemSystemUtils && window.ItemSystemUtils.getItemRarity) {
            return window.ItemSystemUtils.getItemRarity(item);
        }
        return { name: '', colorCode: '#bba16d' };  // i18n-ignore  fallback tint
    }

    // Money is always euros, the same split MoneyFormatter draws.
    function money(gold) {
        if (window.ParchmentToast && window.ParchmentToast.money) return window.ParchmentToast.money(gold);
        return String(Math.round(gold || 0));
    }

    function iconStyle(iconIndex, size) {
        const idx = Number(iconIndex) || 0;
        const s = size || 32;
        return `background:url('img/system/IconSet.png') -${(idx % 16) * s}px -${Math.floor(idx / 16) * s}px no-repeat;` +
            (s !== 32 ? `background-size:${s * 16}px auto;` : '') +
            `width:${s}px;height:${s}px;display:inline-block;`;
    }

    // ========================================================================
    // Scene_Blacksmithing
    // ========================================================================
    class Scene_Blacksmithing extends Scene_MenuBase {
        create() {
            super.create();
            if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }

            this._tab = 'ready';          // 'ready' | 'locked'
            this._activeArea = 'tabs';    // 'tabs' | 'trades' | 'items' | 'forge'
            this._tabIndex = 0;
            this._tradeIndex = 0;
            this._itemIndex = 0;
            this._selectedTrade = null;
            this._selectedItem = null;
            this._smithIndex = 0;
            this._show3D = typeof THREE !== 'undefined';
            this._overlayTimer = 0;
            this._overlayData = null;
            this._listDirty = true;

            this.createLayout();
            this.refreshForge();
            if (window.CharSwitcher) {
                window.CharSwitcher.installTabKey(this, (dir) => this.cycleSmith(dir));
            }
        }

        update() {
            this.updateForgeInput();
            super.update();
        }

        terminate() {
            this.dispose3D();
            const c = document.getElementById('blacksmith-container');
            if (c) c.remove();
            if (window.CharSwitcher) window.CharSwitcher.removeTabKey(this);
            if (window.SpecBadge) window.SpecBadge.hide();
            super.terminate();
        }

        // -------------------------------------------------- who is at the anvil
        smithMembers() {
            return ($gameParty && $gameParty.members) ? $gameParty.members() : [];
        }

        smith() {
            const members = this.smithMembers();
            if (!members.length) return null;
            return members[Math.max(0, Math.min(members.length - 1, this._smithIndex || 0))];
        }

        selectSmith(index) {
            const members = this.smithMembers();
            if (!members.length) return;
            const next = ((index % members.length) + members.length) % members.length;
            if (next === this._smithIndex) return;
            this._smithIndex = next;
            SoundManager.playCursor();
            // Another pair of hands re-sorts the whole board: a piece this
            // member cannot make has moved to the other tab, and a whole trade
            // can leave the open tab with it.
            this._listDirty = true;
            this._selectedItem = null;
            this._itemIndex = 0;
            if (this._selectedTrade && !this.trades().some(r => r.name === this._selectedTrade)) {
                this._selectedTrade = null;
                this._activeArea = 'trades';
            } else {
                this._selectedItem = this.itemsForTrade()[this._itemIndex] || null;
            }
            this.refreshForge();
        }

        cycleSmith(dir) { this.selectSmith((this._smithIndex || 0) + dir); }

        // The selected member's level in the trade an entry needs.
        levelIn(item) {
            const spec = craftSpec(item);
            if (!spec || !window.SpecializationXP) return 1;
            return window.SpecializationXP.levelOf(this.smith(), spec);
        }

        canMake(item) {
            return isSandbox() || this.levelIn(item) >= craftTier(item);
        }

        // -------------------------------------------------------------- listing
        entriesForTab() {
            const wantReady = this._tab === 'ready';
            return forgeEntries().filter(e => this.canMake(e) === wantReady);
        }

        trades() {
            if (!this._listDirty && this._tradesCache && this._tradesKey === this._tab) {
                return this._tradesCache;
            }
            const map = new Map();
            for (const entry of this.entriesForTab()) {
                const name = craftSpecName(entry);
                if (!map.has(name)) map.set(name, { name, total: 0, ready: 0 });
                const row = map.get(name);
                row.total++;
                if (hasMaterials(parseRecipe(entry))) row.ready++;
            }
            this._tradesCache = Array.from(map.values()).sort((a, b) => tr(a.name).localeCompare(tr(b.name)));
            this._tradesKey = this._tab;
            this._listDirty = false;
            return this._tradesCache;
        }

        itemsForTrade() {
            if (!this._selectedTrade) return [];
            return this.entriesForTab()
                .filter(e => craftSpecName(e) === this._selectedTrade)
                .sort((a, b) => (a.price || 0) - (b.price || 0));
        }

        // ----------------------------------------------------------------- DOM
        createLayout() {
            if (!document.getElementById('blacksmith-container')) {
                const el = document.createElement('div');
                el.id = 'blacksmith-container';
                document.body.appendChild(el);
            }
        }

        refreshForge() {
            const container = document.getElementById('blacksmith-container');
            if (!container) return;
            const t = bsText();

            let spread = container.querySelector('.book-spread');
            if (!spread) {
                container.innerHTML = `
                    <div class="book-spread">
                        <div id="forge-overlay-container"></div>
                        <div class="left-page">
                            <div class="forge-header">
                                <div class="back-button focusable" id="forge-back">${escapeHtml(T('Blacksmith.back'))}</div>
                                <h2 class="title">${escapeHtml(t.title)}</h2>
                            </div>
                            <div id="forge-tabs"></div>
                            <div class="list-viewport" id="forge-list"></div>
                        </div>
                        <div class="right-page">
                            <div id="forge-companion-row" class="companion-switcher companion-switcher--header"></div>
                            <div class="workbench" id="forge-detail"></div>
                        </div>
                    </div>`;
                spread = container.querySelector('.book-spread');
                spread.addEventListener('click', (e) => this.onSpreadClick(e));
                // The wheel turns whichever page the pointer is over: the recipe
                // list on the left, the dossier on the right. Sending every
                // wheel event to the list is what left the anvil page stuck.
                container.addEventListener('wheel', (e) => {
                    const under = e.target && e.target.closest
                        ? e.target.closest('.list-viewport, .workbench') : null;
                    const target = under || container.querySelector('.list-viewport');
                    if (target) target.scrollTop += e.deltaY;
                });
            }

            this.renderSwitcher();
            this.renderTabs();
            this.renderList();
            this.renderDetail();
            this.renderOverlay();

            if (window.SpecBadge) {
                const spec = this._selectedItem ? craftSpec(this._selectedItem) : null;
                if (spec) window.SpecBadge.show(spec, { actor: this.smith() });
                else window.SpecBadge.hide();
            }
        }

        renderSwitcher() {
            const row = document.getElementById('forge-companion-row');
            if (!row || !window.CharSwitcher) return;
            // The switcher heads the page in place of its old title, so it is
            // drawn even for a party of one: the single name says whose hands
            // the skill badge underneath is reporting.
            const members = this.smithMembers();
            let tabs = '';
            members.forEach((m, idx) => {
                const sel = idx === (this._smithIndex || 0) ? 'selected' : '';
                tabs += `<div class="companion-tab ${sel}" data-smith="${idx}">${escapeHtml(m.name())}</div>`;
            });
            row.innerHTML = window.CharSwitcher.inner(
                `<div class="companion-tabs-row">${tabs}</div>`, members.length);
        }

        renderTabs() {
            const el = document.getElementById('forge-tabs');
            if (!el) return;
            const t = bsText();
            const counts = { ready: 0, locked: 0 };
            for (const entry of forgeEntries()) {
                if (this.canMake(entry)) counts.ready++; else counts.locked++;
            }
            const tab = (key, label, idx) => {
                const active = this._tab === key ? 'active' : '';
                const focused = (this._activeArea === 'tabs' && this._tabIndex === idx) ? 'focused' : '';
                return `<div class="tab-btn ${active} ${focused}" data-tab="${key}">${escapeHtml(label)} (${counts[key]})</div>`;
            };
            el.innerHTML = `<div class="mode-tabs">${tab('ready', t.smithable, 0)}${tab('locked', t.tooComplex, 1)}</div>`;
        }

        renderList() {
            const el = document.getElementById('forge-list');
            if (!el) return;
            const t = bsText();
            let html = '';

            if (this._selectedTrade === null) {
                html += `<div class="left-header"><span class="category-name">${escapeHtml(t.trades)}</span></div>`;
                const trades = this.trades();
                if (!trades.length) {
                    html += `<div class="workbench-empty">${escapeHtml(t.noTrades)}</div>`;
                } else {
                    this._tradeIndex = Math.max(0, Math.min(trades.length - 1, this._tradeIndex));
                    trades.forEach((row, idx) => {
                        const focused = (this._activeArea === 'trades' && idx === this._tradeIndex) ? 'focused' : '';
                        html += `
                            <div class="category-row ${focused}" data-trade="${escapeHtml(row.name)}" data-idx="${idx}">
                                <div class="category-meta-left">
                                    <span class="category-name">${escapeHtml(tr(row.name))}</span>
                                </div>
                                <span class="category-count">${row.ready} / ${row.total}</span>
                            </div>`;
                    });
                }
            } else {
                html += `
                    <div class="left-header">
                        <span class="category-name">${escapeHtml(tr(this._selectedTrade))}</span>
                        <span class="back-btn" id="forge-back-trades">&#9664; ${escapeHtml(t.back)}</span>
                    </div>`;
                const items = this.itemsForTrade();
                if (!items.length) {
                    html += `<div class="workbench-empty">${escapeHtml(t.noRecipes)}</div>`;
                } else {
                    this._itemIndex = Math.max(0, Math.min(items.length - 1, this._itemIndex));
                    items.forEach((item, idx) => {
                        const focused = (this._activeArea === 'items' && idx === this._itemIndex) ? 'focused' : '';
                        const rarity = rarityOf(item);
                        const ready = hasMaterials(parseRecipe(item));
                        const tier = craftTier(item);
                        const mark = this._tab === 'locked'
                            ? `<span class="forge-tier-need">${escapeHtml(levelName(tier))}</span>`
                            : `<span class="forge-mat-state ${ready ? 'ok' : 'short'}">${ready ? '&#10004;' : '&#10006;'}</span>`;
                        html += `
                            <div class="category-row forge-row ${focused}" data-item="${item.id}" data-kind="${DataManager.isWeapon(item) ? 'w' : 'a'}" data-idx="${idx}">
                                <div class="category-meta-left">
                                    <span class="icon" style="${iconStyle(item.iconIndex, 24)}"></span>
                                    <span class="blueprint-name" style="color:${rarity.colorCode}">${escapeHtml(tr(item.name))}</span>
                                </div>
                                ${mark}
                            </div>`;
                    });
                }
            }
            el.innerHTML = html;
            const focused = el.querySelector('.focused');
            if (focused) focused.scrollIntoView({ block: 'nearest' });
        }

        // ------------------------------------------------------ the anvil page
        renderDetail() {
            const el = document.getElementById('forge-detail');
            if (!el) return;
            const t = bsText();
            const item = this._selectedItem;

            if (!item) {
                this.dispose3D();
                el.innerHTML = `<div class="workbench-empty">${escapeHtml(t.selectHint)}</div>`;
                return;
            }

            const rarity = rarityOf(item);
            const spec = craftSpec(item);
            const tier = craftTier(item);
            const level = this.levelIn(item);
            const makeable = this.canMake(item);
            const recipe = parseRecipe(item);
            const stocked = hasMaterials(recipe);

            // --- what it is
            let head = `
                <div class="workbench-item-header">
                    <span class="icon" style="${iconStyle(item.iconIndex, 32)}"></span>
                    <span class="workbench-item-name" style="color:${rarity.colorCode}">${escapeHtml(tr(item.name))}</span>
                </div>`;
            if (item.description && String(item.description).trim()) {
                head += `<p class="workbench-desc">${escapeHtml(tr(String(item.description))).replace(/\n/g, '<br>')}</p>`;
            }

            // --- the trade and the tier it asks for
            const skillHTML = `
                <div class="forge-skill ${makeable ? '' : 'locked'}">
                    <span>${escapeHtml(T('Blacksmith.needs', {
                        trade: spec ? tr(spec.name) : craftSpecName(item),
                        level: levelName(tier)
                    }))}</span>
                    <span class="forge-skill-have">${escapeHtml(T('Blacksmith.have', {
                        who: (this.smith() && this.smith().name()) || '',
                        level: levelName(level)
                    }))}</span>
                </div>`;

            // --- the same metadata the equip menu shows
            const statsHTML = this.metadataHTML(item);

            // --- the bill of materials
            let matHTML = `<h4 class="reagents-header">${escapeHtml(t.materials)}</h4><div class="reagents-list">`;
            for (const [id, need] of Object.entries(recipe || {})) {
                const mat = $dataItems[parseInt(id)];
                if (!mat) continue;
                const owned = $gameParty.numItems(mat);
                const ok = isSandbox() || owned >= need;
                matHTML += `
                    <div class="reagent-row" style="opacity:${ok ? 1 : 0.6};">
                        <div class="reagent-meta">
                            <span class="icon" style="${iconStyle(mat.iconIndex, 24)}"></span>
                            <span class="reagent-name">${escapeHtml(tr(mat.name))}</span>
                        </div>
                        <div class="reagent-count-box">
                            <span>${owned}/${need}</span>
                            <span class="reagent-status-indicator ${ok ? 'satisfied' : 'deficient'}">${ok ? '&#10004;' : '&#10006;'}</span>
                        </div>
                    </div>`;
            }
            matHTML += '</div>';

            // --- the button
            const enabled = makeable && stocked;
            const btnClass = `transmute-btn ${enabled ? 'enabled' : 'disabled'} ${this._activeArea === 'forge' ? 'focused' : ''}`;
            const btnLabel = !makeable ? t.tooComplexShort : (stocked ? t.forge : t.noMaterials);

            el.innerHTML = `
                <div class="workbench-active">
                    ${head}
                    ${this.previewHTML(item)}
                    ${skillHTML}
                    ${statsHTML}
                    ${matHTML}
                    <div class="${btnClass}" id="forge-action">${escapeHtml(btnLabel)}</div>
                </div>`;

            // The dossier is taller than the page, so the button a keyboard
            // player has just moved onto has to be brought into view.
            if (this._activeArea === 'forge') {
                const btn = document.getElementById('forge-action');
                if (btn) btn.scrollIntoView({ block: 'nearest' });
            }

            this.mount3D(item);
        }

        // Everything the custom equip menu puts on screen for a piece of gear,
        // read straight off the entry rather than off a wearer: its parameters,
        // its slot and type, what it is worth and what it weighs.
        metadataHTML(item) {
            const t = bsText();
            const et = T.obj('Equip');
            const rows = [];

            const PARAMS = [
                ['hp', 0], ['mp', 1], ['str', 2], ['con', 3],
                ['int', 4], ['wis', 5], ['dex', 6], ['psi', 7]
            ];
            let statsGrid = '';
            for (const [key, idx] of PARAMS) {
                const v = (item.params && item.params[idx]) || 0;
                if (!v) continue;
                const cls = v > 0 ? 'positive' : 'negative';
                statsGrid += `
                    <div class="stat-row">
                        <span class="stat-label">${escapeHtml(et[key] || key)}</span>
                        <span class="stat-diff ${cls}">${v > 0 ? '+' : ''}${v}</span>
                    </div>`;
            }

            const sys = $dataSystem || {};
            if (DataManager.isWeapon(item)) {
                const wt = (sys.weaponTypes || [])[item.wtypeId];
                if (wt) rows.push([t.weaponType, tr(wt)]);
            } else {
                const at = (sys.armorTypes || [])[item.atypeId];
                if (at) rows.push([t.armorType, tr(at)]);
            }
            const slot = (sys.equipTypes || [])[item.etypeId];
            if (slot) rows.push([t.slot, tr(slot)]);
            const rarity = rarityOf(item);
            if (rarity && rarity.name) rows.push([t.rarity, tr(rarity.name)]);
            rows.push([t.value, money(item.price || 0)]);
            if (window.ItemSystemUtils && window.ItemSystemUtils.getItemWeight) {
                rows.push([t.weight, window.ItemSystemUtils.formatWeight(
                    window.ItemSystemUtils.getItemWeight(item))]);
            }
            // Anything else the entry declares (Range, Movement, Level, ...) is
            // shown as written, so a note tag added later surfaces by itself.
            const SKIP = /^(Recipe|Craft|CraftLevel|Category|Lore|Weight|WeaponSprite)$/i;
            for (const key of Object.keys(item.meta || {})) {
                if (SKIP.test(key)) continue;
                const val = item.meta[key];
                rows.push([key, val === true ? T('Blacksmith.yes') : String(val)]);
            }

            let table = '';
            for (const [label, val] of rows) {
                table += `<div class="inspect-spec-row"><span class="inspect-spec-label">${escapeHtml(label)}:</span>` +
                    `<span class="inspect-spec-value">${escapeHtml(val)}</span></div>`;
            }

            let lore = '';
            if (window.ItemSystemUtils && window.ItemSystemUtils.loreFor) {
                const text = window.ItemSystemUtils.loreFor(item);
                if (text) lore = `<div class="equip-lore" style="font-style:italic;opacity:0.78;margin-top:6px;">${escapeHtml(text)}</div>`;
            }

            return (statsGrid ? `<div class="stats-grid">${statsGrid}</div>` : '') +
                `<div class="forge-meta">${table}</div>${lore}`;
        }

        // -------------------------------------------------- 2D / 3D preview
        // The same card and toggle the equip menu uses, for one entry instead
        // of a wearer's two hands.
        previewHTML(item) {
            const canThree = typeof THREE !== 'undefined' && DataManager.isWeapon(item);
            let html = '<div class="weapon-previews-container">';
            if (canThree) {
                const label = this._show3D ? T('Equip.preview3D') : T('Equip.preview2D');
                html += `<button id="forge-preview-toggle" class="weapon-preview-toggle"><span>&#x21c4;</span> ${escapeHtml(label)}</button>`;
            }
            if (canThree && this._show3D) {
                html += `<div class="weapon-preview-card weapon-preview-card--single"><canvas id="forge-preview-canvas" width="140" height="240"></canvas></div>`;
            } else {
                const sprite = item.meta && item.meta.WeaponSprite ? String(item.meta.WeaponSprite).trim() : null;
                const rarity = rarityOf(item);
                const inner = sprite
                    ? `<div class="weapon-preview-sprite-wrapper"><img class="weapon-preview-img" src="img/pictures/Weapons/${escapeHtml(sprite)}.png"></div>`
                    : `<div class="weapon-preview-icon-wrapper"><div class="weapon-preview-icon-circle" style="border:2.5px solid ${rarity.colorCode};"><div class="item-icon" style="${iconStyle(item.iconIndex, 32)}"></div></div></div>`;
                html += `<div class="weapon-preview-card weapon-preview-card--single">${inner}</div>`;
            }
            return html + '</div>';
        }

        mount3D(item) {
            this.dispose3D();
            if (typeof THREE === 'undefined' || !this._show3D || !DataManager.isWeapon(item)) return;
            const canvas = document.getElementById('forge-preview-canvas');
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const width = rect.width || 140;
            const height = rect.height || 240;
            const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
            renderer.setSize(width, height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            const scene = new THREE.Scene();
            scene.add(new THREE.AmbientLight(0xffffff, 0.95));
            const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(3, 5, 4); scene.add(key);
            const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-3, -5, -4); scene.add(fill);
            const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 50);
            camera.position.set(0, 0, 2.7);

            const state = { renderer, scene, camera, model: null, raf: null, spin: true };
            this._preview = state;

            const place = (m) => {
                const box = new THREE.Box3().setFromObject(m);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                m.position.sub(center);
                const fit = 1.85 / (Math.max(size.x, size.y, size.z) || 1);
                m.scale.set(fit, fit, fit);
                m.rotation.set(0.1, -0.4, 0.35);
                if (window.PSXShader) window.PSXShader.applyToObject(m);
                scene.add(m);
                state.model = m;
            };

            if (item.meta && item.meta.model3d && THREE.GLTFLoader) {
                new THREE.GLTFLoader().load(`models/${item.meta.model3d}`, g => place(g.scene), undefined,
                    err => console.error('[Blacksmithing] model load failed', err));
            } else if (window.WeaponSystemProcedural && WeaponSystemProcedural.createModel) {
                const model = WeaponSystemProcedural.createModel(item);
                if (model) place(model);
            }

            // Drag to turn it over, exactly like the equip preview.
            let dragging = false;
            let prev = { x: 0, y: 0 };
            const down = (e) => {
                dragging = true; state.spin = false;
                prev = { x: e.clientX || 0, y: e.clientY || 0 };
                e.preventDefault();
            };
            const move = (e) => {
                if (!dragging || !state.model) return;
                const dx = (e.clientX || 0) - prev.x;
                const dy = (e.clientY || 0) - prev.y;
                state.model.rotation.y += dx * 0.01;
                state.model.rotation.x += dy * 0.01;
                prev = { x: e.clientX || 0, y: e.clientY || 0 };
            };
            const up = () => { dragging = false; };
            canvas.addEventListener('mousedown', down);
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
            state.listeners = { canvas, down, move, up };

            const tick = () => {
                if (!state.renderer) return;
                if (state.model && state.spin) state.model.rotation.y += 0.012;
                state.renderer.render(state.scene, state.camera);
                state.raf = requestAnimationFrame(tick);
            };
            tick();
        }

        dispose3D() {
            const s = this._preview;
            if (!s) return;
            if (s.raf) cancelAnimationFrame(s.raf);
            if (s.listeners) {
                s.listeners.canvas.removeEventListener('mousedown', s.listeners.down);
                window.removeEventListener('mousemove', s.listeners.move);
                window.removeEventListener('mouseup', s.listeners.up);
            }
            if (s.renderer) s.renderer.dispose();
            this._preview = null;
        }

        // ------------------------------------------------------------ overlay
        renderOverlay() {
            const el = document.getElementById('forge-overlay-container');
            if (!el) return;
            if (this._overlayTimer > 0 && this._overlayData) {
                const item = this._overlayData.item;
                const rarity = rarityOf(item);
                el.innerHTML = `
                    <div class="success-overlay">
                        <div class="cauldron-animation" style="font-size:80px;"></div>
                        <h2 class="success-title">${escapeHtml(bsText().forged)}</h2>
                        <div class="success-item-row">
                            <span class="icon" style="${iconStyle(item.iconIndex, 32)}"></span>
                            <span style="font-weight:bold;color:${rarity.colorCode}">${escapeHtml(tr(item.name))}</span>
                        </div>
                    </div>`;
            } else {
                el.innerHTML = '';
            }
        }

        // ------------------------------------------------------------- action
        forgeSelected() {
            const item = this._selectedItem;
            if (!item) return;
            const recipe = parseRecipe(item);
            if (!this.canMake(item) || !hasMaterials(recipe)) {
                SoundManager.playBuzzer();
                return;
            }
            if (!isSandbox()) {
                for (const [id, qty] of Object.entries(recipe)) {
                    $gameParty.loseItem($dataItems[parseInt(id)], qty);
                }
            }
            $gameParty.gainItem(item, 1);

            const spec = craftSpec(item);
            if (spec && window.SpecializationXP) {
                window.SpecializationXP.award(spec, TIER_POINTS[craftTier(item)] || 1, { actor: this.smith() });
            }

            this._overlayData = { item };
            this._overlayTimer = 110;
            this._listDirty = true;
            SoundManager.playUseItem();
            this.refreshForge();
        }

        // -------------------------------------------------------------- input
        onSpreadClick(e) {
            const smith = e.target.closest('[data-smith]');
            if (smith) { this.selectSmith(parseInt(smith.dataset.smith)); return; }

            if (e.target.closest('#forge-back')) { SoundManager.playCancel(); this.popScene(); return; }

            if (e.target.closest('#forge-back-trades')) {
                this._selectedTrade = null;
                this._selectedItem = null;
                this._activeArea = 'trades';
                SoundManager.playCancel();
                this.refreshForge();
                return;
            }

            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) { this.setTab(tabBtn.dataset.tab); return; }

            const tradeRow = e.target.closest('[data-trade]');
            if (tradeRow) {
                this._selectedTrade = tradeRow.dataset.trade;
                this._tradeIndex = parseInt(tradeRow.dataset.idx) || 0;
                this._itemIndex = 0;
                this._activeArea = 'items';
                this._selectedItem = this.itemsForTrade()[0] || null;
                SoundManager.playOk();
                this.refreshForge();
                return;
            }

            const itemRow = e.target.closest('[data-item]');
            if (itemRow) {
                const idx = parseInt(itemRow.dataset.idx) || 0;
                this._itemIndex = idx;
                this._selectedItem = this.itemsForTrade()[idx] || null;
                this._activeArea = 'items';
                SoundManager.playCursor();
                this.refreshForge();
                return;
            }

            if (e.target.closest('#forge-preview-toggle')) {
                this._show3D = !this._show3D;
                SoundManager.playCursor();
                this.refreshForge();
                return;
            }

            if (e.target.closest('#forge-action')) { this.forgeSelected(); return; }
        }

        setTab(key) {
            if (this._tab === key) return;
            this._tab = key;
            this._tabIndex = key === 'ready' ? 0 : 1;
            this._selectedTrade = null;
            this._selectedItem = null;
            this._tradeIndex = 0;
            this._itemIndex = 0;
            this._activeArea = 'trades';
            this._listDirty = true;
            SoundManager.playOk();
            this.refreshForge();
        }

        updateForgeInput() {
            if (this._overlayTimer > 0) {
                if (Input.isTriggered('ok') || Input.isTriggered('cancel') || TouchInput.isTriggered()) {
                    this._overlayTimer = 0;
                    this._overlayData = null;
                    this.refreshForge();
                    return;
                }
                if (--this._overlayTimer === 0) {
                    this._overlayData = null;
                    this.refreshForge();
                }
                return;
            }

            // Shoulder buttons hand the anvil to another member.
            if (Input.isTriggered('pagedown')) { this.cycleSmith(1); return; }
            if (Input.isTriggered('pageup')) { this.cycleSmith(-1); return; }

            const cancel = Input.isTriggered('cancel') || TouchInput.isCancelled();

            if (this._activeArea === 'tabs') {
                if (Input.isTriggered('right') && this._tabIndex === 0) { this.setTab('locked'); this._activeArea = 'tabs'; this._tabIndex = 1; this.refreshForge(); }
                else if (Input.isTriggered('left') && this._tabIndex === 1) { this.setTab('ready'); this._activeArea = 'tabs'; this._tabIndex = 0; this.refreshForge(); }
                else if (Input.isTriggered('ok') || Input.isTriggered('down')) {
                    this._activeArea = 'trades';
                    SoundManager.playOk();
                    this.refreshForge();
                } else if (cancel) { SoundManager.playCancel(); this.popScene(); }
                return;
            }

            if (this._activeArea === 'trades') {
                const trades = this.trades();
                if (Input.isRepeated('down') && this._tradeIndex < trades.length - 1) {
                    this._tradeIndex++; SoundManager.playCursor(); this.refreshForge();
                } else if (Input.isRepeated('up')) {
                    if (this._tradeIndex > 0) { this._tradeIndex--; SoundManager.playCursor(); this.refreshForge(); }
                    else { this._activeArea = 'tabs'; SoundManager.playCursor(); this.refreshForge(); }
                } else if (Input.isTriggered('ok') && trades.length) {
                    this._selectedTrade = trades[this._tradeIndex].name;
                    this._itemIndex = 0;
                    this._selectedItem = this.itemsForTrade()[0] || null;
                    this._activeArea = 'items';
                    SoundManager.playOk();
                    this.refreshForge();
                } else if (cancel) { SoundManager.playCancel(); this.popScene(); }
                return;
            }

            if (this._activeArea === 'items') {
                const items = this.itemsForTrade();
                if (Input.isRepeated('down') && this._itemIndex < items.length - 1) {
                    this._itemIndex++;
                    this._selectedItem = items[this._itemIndex];
                    SoundManager.playCursor();
                    this.refreshForge();
                } else if (Input.isRepeated('up') && this._itemIndex > 0) {
                    this._itemIndex--;
                    this._selectedItem = items[this._itemIndex];
                    SoundManager.playCursor();
                    this.refreshForge();
                } else if (Input.isTriggered('ok')) {
                    this._activeArea = 'forge';
                    SoundManager.playOk();
                    this.refreshForge();
                } else if (cancel) {
                    this._selectedTrade = null;
                    this._selectedItem = null;
                    this._activeArea = 'trades';
                    SoundManager.playCancel();
                    this.refreshForge();
                }
                return;
            }

            if (this._activeArea === 'forge') {
                if (Input.isTriggered('ok')) this.forgeSelected();
                else if (cancel || Input.isTriggered('up')) {
                    this._activeArea = 'items';
                    SoundManager.playCancel();
                    this.refreshForge();
                }
            }
        }
    }

    window.Scene_Blacksmithing = Scene_Blacksmithing;

    // ========================================================================
    // Entry points
    // ========================================================================
    PluginManager.registerCommand(pluginName, 'openBlacksmithing', () => {
        SceneManager.push(Scene_Blacksmithing);
    });
    PluginManager.registerCommand('Crafting/BlacksmithingMenu', 'openBlacksmithing', () => {
        SceneManager.push(Scene_Blacksmithing);
    });

    if (showInMenu) {
        const _addMainCommands = Window_MenuCommand.prototype.addMainCommands;
        Window_MenuCommand.prototype.addMainCommands = function () {
            _addMainCommands.call(this);
            this.addCommand(T.has('Blacksmith.title') ? T('Blacksmith.title') : menuName, 'blacksmithing', true, 108);
        };

        const _createCommandWindow = Scene_Menu.prototype.createCommandWindow;
        Scene_Menu.prototype.createCommandWindow = function () {
            _createCommandWindow.call(this);
            this._commandWindow.setHandler('blacksmithing', () => SceneManager.push(Scene_Blacksmithing));
        };
    }
})();
