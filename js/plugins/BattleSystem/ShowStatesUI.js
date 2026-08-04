/*:
 * @target MZ
 * @plugindesc Show States UI, HTML book-spread for ShowStates.js
 * @author Omni-Lex
 * @help Requires ShowStates.js loaded before this file.
 */

(() => {
  "use strict";

  const SS = () => window.ShowStates;

  const ICON_SIZE = 32;
  const ICON_COLS = 16;

  function drawIcon(canvas, iconIdx) {
    if (!iconIdx) return;
    const bm = ImageManager.loadSystem('IconSet');
    const render = () => {
      if (!bm || !bm.isReady()) return;
      const sx  = (iconIdx % ICON_COLS) * ICON_SIZE;
      const sy  = Math.floor(iconIdx / ICON_COLS) * ICON_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bm.canvas, sx, sy, ICON_SIZE, ICON_SIZE, 0, 0, canvas.width, canvas.height);
    };
    if (bm.isReady()) render();
    else bm.addLoadListener(render);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\\C\[\d+\]/gi, '')
      .replace(/\\I\[\d+\]/gi, '')
      .replace(/\\N\[\d+\]/gi, '')
      .trim();
  }

  // ============================================================
  //  Scene_StateList, book-spread state inspector
  // ============================================================

  class Scene_StateList extends Scene_MenuBase {
    create() {
      super.create();
      this._states = SS().getStates();
      this._idx    = 0;
      this._el     = null;
      this._refreshDOM();
    }

    // ── Full DOM rebuild ──────────────────────────────────────

    _refreshDOM() {
      if (this._el) { this._el.remove(); this._el = null; }
      const el = document.createElement('div');
      el.id        = 'state-list-container';
      el.className = 'book-spread';
      el.innerHTML = `
        <div class="left-page">${this._buildLeft()}</div>
        <div class="right-page">${this._buildRight()}</div>`;
      document.body.appendChild(el);
      this._el = el;
      this._attachEvents();
      this._renderIcons();
    }

    // ── Left page: state list ─────────────────────────────────

    _buildLeft() {
      const rows = this._states.map((s, i) => {
        const sel = i === this._idx ? ' selected' : '';
        return `<div class="item-slot sl-state-row${sel}" data-idx="${i}">
          <canvas class="sl-icon" data-icon="${s.iconIndex}" width="20" height="20"></canvas>
          <span class="sl-state-name">${escHtml(s.name)}</span>
        </div>`;
      }).join('');
      return `
        <div class="inspect-section-title">${T('Battle.states.statusEffects')}</div>
        <div class="sl-state-list">${rows}</div>
        <p class="sl-hint">${T('Battle.states.navHint')}</p>`;
    }

    // ── Right page: selected state detail ─────────────────────

    _buildRight() {
      const s = this._states[this._idx];
      if (!s) return '';
      const L    = SS().L;
      const note = s.note ? escHtml(s.note) : '';
      const desc = note ? `<p class="inspect-lore sl-note">${note}</p>` : '';

      const conds = [];
      if (s.removeAtBattleEnd)   conds.push(L.atBattleEnd);
      if (s.removeByRestriction) conds.push(L.byRestriction);
      if (s.removeByDamage)      conds.push(L.byDamage);
      if (s.removeByWalking)     conds.push(T('Battle.states.byWalkingSteps', { label: L.byWalking, steps: s.removeSteps }));

      const condsHTML = conds.length
        ? `<div class="inspect-section-title sl-removal-title">${L.removalHeader}</div>
           ${conds.map(c => `<div class="sl-cond-row">— ${escHtml(c)}</div>`).join('')}`
        : '';

      return `
        <div class="inspect-header sl-detail-header">
          <canvas class="sl-icon-lg" data-icon="${s.iconIndex}" width="40" height="40"></canvas>
          <span class="inspect-name">${escHtml(s.name)}</span>
        </div>
        ${desc}
        ${condsHTML}`;
    }

    // ── Icon rendering ────────────────────────────────────────

    _renderIcons() {
      if (!this._el) return;
      this._el.querySelectorAll('canvas[data-icon]').forEach(cv => {
        drawIcon(cv, parseInt(cv.dataset.icon));
      });
    }

    // ── Mouse / hover events ──────────────────────────────────

    _attachEvents() {
      if (!this._el) return;
      this._el.addEventListener('mouseover', ev => {
        const row = ev.target.closest('.sl-state-row');
        if (!row) return;
        const i = parseInt(row.dataset.idx);
        if (!isNaN(i) && i !== this._idx) {
          this._idx = i;
          this._updateHighlight();
          this._updateRight();
        }
      });
      this._el.addEventListener('click', ev => {
        const row = ev.target.closest('.sl-state-row');
        if (!row) return;
        const i = parseInt(row.dataset.idx);
        if (!isNaN(i)) { this._idx = i; this._updateHighlight(); this._updateRight(); }
      });
    }

    // ── Highlight + right-page update ─────────────────────────

    _updateHighlight() {
      if (!this._el) return;
      this._el.querySelectorAll('.sl-state-row').forEach((el, i) => {
        el.classList.toggle('selected', i === this._idx);
      });
      const sel = this._el.querySelector('.sl-state-row.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    _updateRight() {
      const rp = this._el && this._el.querySelector('.right-page');
      if (!rp) return;
      rp.innerHTML = this._buildRight();
      rp.querySelectorAll('canvas[data-icon]').forEach(cv => {
        drawIcon(cv, parseInt(cv.dataset.icon));
      });
    }

    // ── Input loop ────────────────────────────────────────────

    update() {
      super.update();
      const len = this._states.length;
      if (Input.isRepeated('down') || Input.isRepeated('s')) {
        if (this._idx < len - 1) {
          this._idx++;
          SoundManager.playCursor();
          this._updateHighlight();
          this._updateRight();
        }
      } else if (Input.isRepeated('up') || Input.isRepeated('w')) {
        if (this._idx > 0) {
          this._idx--;
          SoundManager.playCursor();
          this._updateHighlight();
          this._updateRight();
        }
      } else if (Input.isTriggered('cancel')) {
        SoundManager.playCancel();
        this.popScene();
      }
    }

    // ── Teardown ──────────────────────────────────────────────

    terminate() {
      if (this._el) { this._el.remove(); this._el = null; }
      super.terminate();
    }
  }

  window.Scene_StateList = Scene_StateList;

})();
