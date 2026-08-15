//=============================================================================
// DiaryUI.js
//=============================================================================
/*:
 * @plugindesc v1.0.0 The party diary as a real diary: a ruled, hand-written book you page through. (UI)
 * @author Omni-Lex
 * @target MZ
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ==========================================================================
 * The Diary, as a book
 * ==========================================================================
 *
 * Requires Core/Diary.js, which must load first.
 *
 * The book is a two-page spread of ruled diary paper. Each page is one day of
 * the world's calendar, headed with the date the way somebody would write it
 * at the top of a page, and the day's lines are written under it in ink, each
 * with the hour it happened at, the icon of the kind of thing it was and, in
 * the margin, where it happened. A day is never split across the crease: the
 * left page carries a day, the right page the next one.
 *
 *   window.Scene_Diary                the book
 *   Scene_Diary.prepare(world, id)    open somebody else's diary instead of
 *                                     the party's own (the world manager
 *                                     passes a world name and a diary id)
 *
 * Reading is by day, not by line: left and right turn the page, up and down
 * move a day at a time, and the ribbon down the right edge is the filter, one
 * bookmark per category. Everything is rendered through Diary.describe, so a
 * diary written in one language reads in whichever one it is opened in.
 */

(() => {
    'use strict';

    const T = window.T || ((k) => k);

    function tr(key, params) { return T('Diary.' + key, params); }

    function escapeHtml(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // A day of the world calendar, as a number, so lines group by the page they
    // belong on. The clock starts at 10:00 on 1 Jan 2001, so the day boundary
    // is offset by those ten hours rather than falling on a round 1440.
    const DAY = 1440;
    const EPOCH_OFFSET = 10 * 60;
    function dayIndex(minutes) {
        return Math.floor((Number(minutes) + EPOCH_OFFSET) / DAY);
    }

    function dateHeading(minutes) {
        const D = window.Diary;
        const dt = D && D.stampAt ? D.stampAt(minutes) : null;
        if (!dt) return "";
        return tr('date.heading', {
            day: dt.day,
            month: T('Diary.month.' + String(dt.month).toLowerCase()),
            year: dt.year
        });
    }

    function clockOf(minutes) {
        const D = window.Diary;
        return (D && D.clockAt) ? D.clockAt(minutes) : "";
    }

    //=========================================================================
    // Scene_Diary
    //=========================================================================

    class Scene_Diary extends Scene_MenuBase {

        // Opening somebody else's book: the world it belongs to and its id.
        static prepare(world, diaryId) {
            this._world = world || null;
            this._diaryId = diaryId || null;
        }

        create() {
            super.create();
            this._filter = 'all';
            this._spread = 0;         // which pair of days is open
            this._loadDiary();
            this._buildDOM();
        }

        // ---- the book's contents -------------------------------------------

        _loadDiary() {
            const D = window.Diary;
            const world = Scene_Diary._world;
            const id = Scene_Diary._diaryId;
            Scene_Diary._world = Scene_Diary._diaryId = null;   // consumed

            this._foreign = !!(world && id);
            if (this._foreign) {
                this._book = (D && D.readDiary) ? D.readDiary(world, id) : null;
            } else {
                this._book = (D && D.currentDiary) ? D.currentDiary() : null;
            }
            if (!this._book) this._book = { party: [], entries: [] };
            this._entries = Array.isArray(this._book.entries) ? this._book.entries : [];
            this._rebuildDays();
        }

        // The lines that pass the filter, cut into days. A day with nothing on
        // it is not a page: the book skips straight to the next day the party
        // wrote anything on, the way a real diary does.
        _rebuildDays() {
            const D = window.Diary;
            const kept = this._entries.filter(e => {
                if (this._filter === 'all') return true;
                return D && D.categoryOf(e) === this._filter;
            });

            const byDay = new Map();
            for (const entry of kept) {
                const key = dayIndex(entry.t);
                if (!byDay.has(key)) byDay.set(key, []);
                byDay.get(key).push(entry);
            }
            this._days = [...byDay.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([key, lines]) => ({
                    key,
                    minutes: lines[0].t,
                    lines: lines.slice().sort((a, b) => a.t - b.t)
                }));
            this._spread = Math.max(0, Math.min(this._spread, this._maxSpread()));
        }

        _maxSpread() {
            return Math.max(0, Math.ceil(this._days.length / 2) - 1);
        }

        // ---- DOM ------------------------------------------------------------

        _buildDOM() {
            injectStyle();
            this._container = document.createElement("div");
            this._container.id = "diary-container";
            // The book's shell is built ONCE. `.diary-book` carries the
            // one-shot entrance animation, and its children (the diary-glyph
            // icons) carry a live CSS filter; rebuilding this wrapper on
            // every page turn used to restart that animation on every turn,
            // which is what re-triggered the filter-repaint strobe the CSS
            // comment above already warns about. `_render()` now only ever
            // replaces the contents of the page/ribbon/foot slots below, so
            // the book itself is never torn down after it first opens.
            this._container.innerHTML = `
                <div class="diary-book">
                    <div class="diary-cover-edge"></div>
                    <div class="diary-ribbon"></div>
                    <div class="diary-page diary-page-left"></div>
                    <div class="diary-binding"><span class="diary-stitch"></span></div>
                    <div class="diary-page diary-page-right"></div>
                    <div class="diary-foot"></div>
                </div>
            `;
            document.body.appendChild(this._container);
            this._ribbonEl = this._container.querySelector(".diary-ribbon");
            this._pageLeftEl = this._container.querySelector(".diary-page-left");
            this._pageRightEl = this._container.querySelector(".diary-page-right");
            this._footEl = this._container.querySelector(".diary-foot");
            this._render();
        }

        _render() {
            if (!this._container) return;
            this._ribbonEl.innerHTML = this._renderRibbonMarks();
            this._pageLeftEl.innerHTML = this._renderPage(this._spread * 2);
            this._pageRightEl.innerHTML = this._renderPage(this._spread * 2 + 1);
            this._footEl.innerHTML = this._renderFootContent();
        }

        _renderRibbonMarks() {
            const D = window.Diary;
            const cats = ['all'].concat(D ? D.categories() : []);
            return cats.map((cat) => {
                const active = this._filter === cat;
                return `<div class="diary-mark ${active ? 'active' : ''}"
                             data-cat="${escapeHtml(cat)}"
                             title="${escapeHtml(tr('cat.' + cat))}"
                             onclick="SceneManager._scene.setDiaryFilter('${escapeHtml(cat)}')">
                            <span>${escapeHtml(tr('cat.' + cat))}</span>
                        </div>`;
            }).join("");
        }

        // One page: one day, headed by its date, ruled, written in ink.
        _renderPage(index) {
            const day = this._days[index];
            if (!day) {
                // The empty right-hand page of the last spread is not an error,
                // it is simply the rest of the book waiting to be written on.
                const message = this._days.length === 0 ? tr('empty') : tr('blankPage');
                return `<div class="diary-rules"></div>
                        <div class="diary-blank">${escapeHtml(message)}</div>`;
            }

            const heading = dateHeading(day.minutes);
            const lines = day.lines.map(entry => this._renderLine(entry)).join("");

            return `
                <div class="diary-rules"></div>
                <div class="diary-inner">
                    <div class="diary-date">
                        <span class="diary-date-text">${escapeHtml(heading)}</span>
                        <span class="diary-date-rule"></span>
                    </div>
                    <div class="diary-lines">${lines}</div>
                </div>
            `;
        }

        _renderLine(entry) {
            const D = window.Diary;
            const text = D ? D.describe(entry) : "";
            const icon = D ? D.iconOf(entry) : 225;
            const x = (icon % 16) * 32;
            const y = Math.floor(icon / 16) * 32;
            // Ink is never perfectly level on a ruled page: the tilt and the
            // shade are a function of the line itself, so one line always looks
            // the same and no two neighbours look alike.
            const wobble = ((Math.abs(entry.t) % 7) - 3) * 0.12;
            const shade = ["a", "b", "c"][Math.abs(entry.t) % 3];
            const where = entry.w ? `<span class="diary-margin">${escapeHtml(entry.w)}</span>` : "";
            return `
                <div class="diary-line ink-${shade}"
                     style="transform: rotate(${wobble.toFixed(2)}deg)">
                    <span class="diary-hour">${escapeHtml(clockOf(entry.t))}</span>
                    <span class="diary-glyph" style="background-position: -${x}px -${y}px"></span>
                    <span class="diary-text">${escapeHtml(text)}</span>
                    ${where}
                </div>
            `;
        }

        _renderFootContent() {
            const names = (this._book.party || []).map(m => m.name).filter(Boolean).join(", ");
            const owner = names
                ? (this._foreign ? tr('foot.theirs', { names }) : tr('foot.ours', { names }))
                : tr('foot.unknown');
            const page = tr('foot.page', {
                shown: Math.min(this._days.length, this._spread * 2 + 2),
                total: this._days.length
            });
            return `
                <span class="diary-foot-owner">${escapeHtml(owner)}</span>
                <span class="diary-foot-page">${escapeHtml(page)}</span>
            `;
        }

        // ---- interaction -----------------------------------------------------

        setDiaryFilter(cat) {
            if (this._filter === cat) return;
            SoundManager.playCursor();
            this._filter = cat;
            this._spread = 0;
            this._rebuildDays();
            this._render();
        }

        _turnPage(direction) {
            const next = this._spread + direction;
            if (next < 0 || next > this._maxSpread()) { SoundManager.playBuzzer(); return; }
            SoundManager.playCursor();
            this._spread = next;
            this._render();
        }

        _moveRibbon(direction) {
            const cats = ['all'].concat(window.Diary ? window.Diary.categories() : []);
            const at = cats.indexOf(this._filter);
            const next = Math.max(0, Math.min(cats.length - 1, (at < 0 ? 0 : at) + direction));
            if (cats[next] === this._filter) return;
            this.setDiaryFilter(cats[next]);
        }

        update() {
            super.update();
            if (Input.isTriggered("cancel") || TouchInput.isCancelled()) {
                TouchInput.clear();
                SoundManager.playCancel();
                this.popScene();
                return;
            }
            if (Input.isRepeated("right")) this._turnPage(1);
            else if (Input.isRepeated("left")) this._turnPage(-1);
            else if (Input.isRepeated("down")) this._moveRibbon(1);
            else if (Input.isRepeated("up")) this._moveRibbon(-1);
            else if (Input.isTriggered("pagedown")) this._turnPage(1);
            else if (Input.isTriggered("pageup")) this._turnPage(-1);
        }

        terminate() {
            if (this._container) {
                this._container.remove();
                this._container = null;
            }
            this._ribbonEl = this._pageLeftEl = this._pageRightEl = this._footEl = null;
            super.terminate();
        }
    }

    window.Scene_Diary = Scene_Diary;

    //=========================================================================
    // The paper
    // -------------------------------------------------------------------------
    // Everything here is drawn rather than loaded: the ruling is a repeating
    // gradient, the paper's grain an inline SVG turbulence, the ink a text
    // shadow. Colours are theme tokens, so the book follows whichever theme is
    // installed instead of pinning its own.
    //=========================================================================

    // The paper grain used to be a live inline SVG <feTurbulence> filter. Some
    // Chromium builds re-rasterize a filter-backed background-image on every
    // repaint of an animated ancestor (the book's own entrance animation, or a
    // page turn re-rendering the spread), which reads as the whole book
    // strobing rather than opening. A grain baked once to a plain PNG paints
    // like any other static texture and never re-renders.
    let _grainDataUrl = null;
    function grainTexture() {
        if (_grainDataUrl) return _grainDataUrl;
        try {
            const size = 128;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            const img = ctx.createImageData(size, size);
            for (let i = 0; i < img.data.length; i += 4) {
                const v = Math.floor(Math.random() * 255);
                img.data[i] = v;
                img.data[i + 1] = v;
                img.data[i + 2] = v;
                img.data[i + 3] = Math.floor(Math.random() * 22);
            }
            ctx.putImageData(img, 0, 0);
            _grainDataUrl = canvas.toDataURL("image/png");
        } catch (e) {
            _grainDataUrl = "";
        }
        return _grainDataUrl;
    }

    let _styled = false;
    function injectStyle() {
        if (_styled || document.getElementById("diary-style")) { _styled = true; return; }
        _styled = true;
        const grain = grainTexture();
        const style = document.createElement("style");
        style.id = "diary-style";
        style.textContent = `
        #diary-container {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            width: 100vw; height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            font-family: 'Lora', serif;
            /* Opaque, not merely dark: a translucent scrim here lets whatever
               is still animating on the map (weather, water, lights) show
               through and read as the whole book flickering. */
            background-color: #120c07;
            background-image: radial-gradient(ellipse at 50% 40%,
                        var(--bg-primary-hover, #241a10) 0%,
                        var(--shadow-heavy-opaque, #0a0705) 100%);
        }

        /* The book itself: two leaves stitched at the spine, the cover just
           showing round the outside edge. */
        #diary-container .diary-book {
            position: relative;
            width: min(1560px, 96%);
            height: min(960px, 94%);
            display: flex;
            box-sizing: border-box;
            border-radius: 5px 8px 8px 5px;
            padding: 14px;
            background:
                linear-gradient(105deg,
                    var(--accent-brown-dark, #3a2a1a) 0%,
                    var(--accent-brown, #52381f) 45%,
                    var(--accent-brown-dark, #33220f) 100%);
            box-shadow:
                0 34px 80px var(--shadow-heavy, rgba(0,0,0,0.8)),
                inset 0 0 0 2px var(--border-gold-amber, rgba(196,154,74,0.35));
            animation: diaryOpen 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes diaryOpen {
            0%   { opacity: 0; transform: perspective(1800px) rotateX(9deg) scale(0.965); }
            100% { opacity: 1; transform: perspective(1800px) rotateX(0deg) scale(1); }
        }

        /* The fore-edge of the block of pages underneath the open leaf. */
        #diary-container .diary-cover-edge {
            position: absolute;
            top: 18px; bottom: 18px; left: 6px; right: 6px;
            border-radius: 3px;
            pointer-events: none;
            box-shadow:
                0 0 0 1px var(--border-gold-amber, rgba(196,154,74,0.28)),
                6px 0 0 -2px var(--paper-edge, rgba(226,212,182,0.5)),
                -6px 0 0 -2px var(--paper-edge, rgba(226,212,182,0.5));
        }

        /* A leaf. Paper, then grain, then the ruling drawn on top of both. */
        #diary-container .diary-page {
            position: relative;
            flex: 1;
            min-width: 0;
            padding: 42px 44px 54px 52px;
            box-sizing: border-box;
            overflow: hidden;
            color: var(--ink, #2b2318);
            background-color: var(--paper, #efe4c8);
            background-image:
                url("${grain}"),
                radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 60%);
        }
        #diary-container .diary-page-left {
            border-radius: 3px 0 0 3px;
            box-shadow: inset -26px 0 34px -26px rgba(60,40,18,0.75);
        }
        #diary-container .diary-page-right {
            border-radius: 0 3px 3px 0;
            box-shadow: inset 26px 0 34px -26px rgba(60,40,18,0.75);
        }

        /* Feint ruling, and the red margin rule down the gutter side. */
        #diary-container .diary-rules {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            pointer-events: none;
            background-image: repeating-linear-gradient(
                to bottom,
                rgba(0,0,0,0) 0px,
                rgba(0,0,0,0) 33px,
                var(--rule, rgba(96,116,140,0.30)) 33px,
                var(--rule, rgba(96,116,140,0.30)) 34px);
            background-position: 0 46px;
        }
        #diary-container .diary-page-left .diary-rules::after,
        #diary-container .diary-page-right .diary-rules::after {
            content: '';
            position: absolute;
            top: 0; bottom: 0;
            width: 1px;
            background: var(--rule-margin, rgba(164,74,60,0.42));
        }
        #diary-container .diary-page-left .diary-rules::after  { left: 40px; }
        #diary-container .diary-page-right .diary-rules::after { left: 40px; }

        /* The stitched spine. */
        #diary-container .diary-binding {
            position: relative;
            width: 34px;
            flex: 0 0 34px;
            background: linear-gradient(to right,
                rgba(40,26,12,0.55) 0%,
                rgba(24,15,6,0.85) 45%,
                rgba(24,15,6,0.85) 55%,
                rgba(40,26,12,0.55) 100%);
        }
        #diary-container .diary-stitch {
            position: absolute;
            top: 40px; bottom: 40px; left: 50%;
            width: 0;
            border-left: 2px dashed var(--border-gold-amber, rgba(206,168,92,0.55));
            transform: translateX(-50%);
        }

        #diary-container .diary-inner {
            position: relative;
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        /* The date somebody wrote at the top of the page. */
        #diary-container .diary-date {
            display: flex;
            align-items: baseline;
            gap: 12px;
            margin: 0 0 10px 0;
            flex-shrink: 0;
        }
        #diary-container .diary-date-text {
            font-size: 1.725rem;
            font-style: normal;
            font-weight: 700;
            letter-spacing: 0.4px;
            color: var(--ink-strong, #43301c);
            transform: rotate(-0.6deg);
            text-shadow: 0 1px 0 rgba(255,255,255,0.35);
        }
        #diary-container .diary-date-rule {
            flex: 1;
            height: 1px;
            background: var(--rule-margin, rgba(164,74,60,0.5));
        }

        #diary-container .diary-lines {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding-right: 6px;
        }
        #diary-container .diary-lines::-webkit-scrollbar { width: 6px; }
        #diary-container .diary-lines::-webkit-scrollbar-track { background: transparent; }
        #diary-container .diary-lines::-webkit-scrollbar-thumb {
            background: var(--rule, rgba(96,116,140,0.4));
            border-radius: 3px;
        }

        /* One written line. */
        #diary-container .diary-line {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            min-height: 34px;
            padding: 4px 6px 2px 6px;
            border-radius: 3px;
            font-size: 1.173rem;
            line-height: 1.55;
            transform-origin: left center;
        }
        #diary-container .diary-hour {
            flex: 0 0 auto;
            min-width: 44px;
            font-size: 1.032rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            opacity: 0.72;
            padding-top: 3px;
        }
        #diary-container .diary-glyph {
            flex: 0 0 auto;
            width: 32px; height: 32px;
            background-image: url('img/system/IconSet.png');
            background-repeat: no-repeat;
            transform: scale(0.7);
            transform-origin: center top;
            margin-top: -2px;
            filter: sepia(0.35) saturate(0.85);
        }
        #diary-container .diary-text {
            flex: 1 1 auto;
            min-width: 0;
            font-style: normal;
            word-break: break-word;
        }
        /* Three shades of the same ink, so a page does not read as printed. */
        #diary-container .ink-a .diary-text { color: var(--ink, #2c2418); }
        #diary-container .ink-b .diary-text { color: var(--ink-alt, #33291a); opacity: 0.94; }
        #diary-container .ink-c .diary-text { color: var(--ink-deep, #241d13); opacity: 0.98; }

        #diary-container .diary-margin {
            flex: 0 0 auto;
            max-width: 30%;
            font-size: 0.927rem;
            font-style: normal;
            text-align: right;
            opacity: 0.55;
            padding-top: 5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        #diary-container .diary-blank {
            position: relative;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-style: normal;
            font-size: 1.208rem;
            opacity: 0.42;
            text-align: center;
            padding: 0 40px;
        }

        /* The ribbon bookmarks down the fore-edge. */
        #diary-container .diary-ribbon {
            position: absolute;
            top: 40px;
            right: -14px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            z-index: 4;
        }
        #diary-container .diary-mark {
            position: relative;
            padding: 4px 12px 4px 10px;
            font-size: 0.878rem;
            letter-spacing: 0.4px;
            text-transform: uppercase;
            color: var(--paper, #efe4c8);
            background: var(--accent-brown, #57391d);
            border-radius: 0 3px 3px 0;
            box-shadow: 2px 2px 4px rgba(0,0,0,0.45);
            cursor: pointer;
            opacity: 0.62;
            transform: translateX(-8px);
            transition: transform 0.14s ease, opacity 0.14s ease;
            white-space: nowrap;
        }
        #diary-container .diary-mark:hover { opacity: 0.9; transform: translateX(-2px); }
        #diary-container .diary-mark.active {
            opacity: 1;
            transform: translateX(2px);
            background: var(--border-gold-amber, #b8893f);
            color: var(--ink-deep, #241d13);
        }

        #diary-container .diary-foot {
            position: absolute;
            left: 60px; right: 60px; bottom: 22px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            font-size: 0.96rem;
            font-style: normal;
            color: var(--paper, #efe4c8);
            opacity: 0.72;
            pointer-events: none;
        }
        `;
        document.head.appendChild(style);
    }

    //=========================================================================
    // Colours the book needs that a theme may not declare, so it reads the same
    // under every preset. A theme that DOES declare them wins, since these are
    // only defaults on :root.
    //=========================================================================

    const fallbacks = document.createElement("style");
    fallbacks.id = "diary-tokens";
    fallbacks.textContent = `:root {
        --paper: #efe4c8;
        --paper-edge: rgba(226,212,182,0.55);
        --ink: #2c2418;
        --ink-alt: #33291a;
        --ink-deep: #241d13;
        --ink-strong: #43301c;
        --rule: rgba(96,116,140,0.30);
        --rule-margin: rgba(164,74,60,0.42);
        --highlight-paper: rgba(196,154,74,0.18);
        --accent-brown: #57391d;
        --accent-brown-dark: #33220f;
    }`;
    if (!document.getElementById("diary-tokens")) document.head.appendChild(fallbacks);
})();
