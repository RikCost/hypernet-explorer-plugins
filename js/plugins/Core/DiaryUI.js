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
            this._container = document.createElement("div");
            this._container.id = "diary-container";
            // The one thing css/theme.css cannot state for itself: the paper
            // grain is a noise PNG baked at runtime (see grainTexture below),
            // so the sheet reads it back off this custom property.
            const grain = grainTexture();
            if (grain) this._container.style.setProperty("--diary-grain", `url("${grain}")`);
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

})();
