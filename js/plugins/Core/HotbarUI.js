/*:
 * @target MZ
 * @plugindesc Shared quick-bar widget v1.0.0 — the Daggerfall-style row of numbered slots used by the battle skill bar and the item favourites bar.
 * @author Omni-Lex
 * @help HotbarUI.js
 *
 * Exposes window.HotbarUI, the DOM widget behind every quick bar in the game:
 *
 *   - BattleSystemEnhancedHUD.js  , the acting member's carried skills
 *   - ItemSystemHotbar.js         , the party's favourite items (map + backpack)
 *
 * The widget owns the slot markup, the icon blitting, the tooltip and the
 * canvas-synced placement; each caller owns what a slot means and what a
 * click does. Styling lives in css/theme.css under `.hotbar-slot`.
 *
 * Placement modes:
 *   fixed  (default) , bottom-centre of the game canvas, scaled with it.
 *   inline           , the root is handed to the caller to mount inside its
 *                      own DOM layout (used by the backpack overlay).
 *
 * Must load before any plugin that constructs a HotbarUI.
 */

(function () {
  'use strict';

  // The canvas rect only moves on a resize, so it is worth caching: every bar
  // re-reads it once per frame while visible.
  let _cachedScale = null;
  window.addEventListener('resize', () => { _cachedScale = null; });

  function canvasScale() {
    if (_cachedScale) return _cachedScale;
    const el = document.getElementById('gameCanvas');
    if (!el) return { sx: 1, sy: 1, ox: 0, oy: 0 };
    const r = el.getBoundingClientRect();
    _cachedScale = {
      sx: r.width / Graphics.width,
      sy: r.height / Graphics.height,
      ox: r.left,
      oy: r.top
    };
    return _cachedScale;
  }

  // One tooltip element is shared by every bar: only one can be hovered at a
  // time, and keeping a single node avoids leaking one per widget.
  const TOOLTIP_ID = 'html-hotbar-tooltip';

  function tooltipEl() {
    let el = document.getElementById(TOOLTIP_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOOLTIP_ID;
      el.className = 'hotbar-tooltip';
      document.body.appendChild(el);
    }
    return el;
  }

  function hideTooltip() {
    const el = document.getElementById(TOOLTIP_ID);
    if (el) el.style.display = 'none';
  }

  /**
   * A row of numbered slots.
   *
   * Entries passed to render() are either null (empty slot) or:
   *   { iconIndex, enabled, count, tooltip }
   *
   * Options:
   *   id            DOM id of the root element (required, unique per bar)
   *   slots         slot count (default 9)
   *   slotPx/gapPx/iconPx/marginBottom   geometry, in canvas pixels
   *   zIndex        stacking order of the root
   *   inline        true to let the caller mount the root itself
   *   emptyClickable  true when empty slots are meaningful targets too
   *   onSlotClick   (index, entry, event) on left click / tap
   *   onSlotContext (index, entry, event) on right click
   */
  class HotbarUI {
    constructor(options) {
      const o = options || {};
      this.id = o.id;
      this.slots = o.slots || 9;
      this.slotPx = o.slotPx || 52;
      this.gapPx = o.gapPx || 6;
      this.iconPx = o.iconPx || 32;
      this.marginBottom = o.marginBottom !== undefined ? o.marginBottom : 12;
      this.zIndex = o.zIndex || 352;
      this.inline = !!o.inline;
      // Bars that only fire filled slots (the battle and map ones) leave empty
      // slots looking inert; an assignment bar wants every slot to invite a click.
      this.emptyClickable = !!o.emptyClickable;
      this.onSlotClick = o.onSlotClick || null;
      this.onSlotContext = o.onSlotContext || null;
      this._root = null;
      this._entries = [];
    }

    /** Total width of the row, in canvas pixels. */
    width() {
      return this.slots * this.slotPx + (this.slots - 1) * this.gapPx;
    }

    root() {
      // An inline root is legitimately detached until the caller mounts it.
      if (this._root && (this.inline || this._root.isConnected)) return this._root;
      let root = document.getElementById(this.id);
      if (!root) {
        root = document.createElement('div');
        root.id = this.id;
        root.className = 'hotbar-row';
        root.style.cssText = this.inline
          ? 'position:relative;display:none;flex-direction:row;'
          : 'position:fixed;display:none;flex-direction:row;transform-origin:top left;';
        root.style.zIndex = String(this.zIndex);
        root.style.pointerEvents = 'auto';
        if (!this.inline) document.body.appendChild(root);

        // RPG Maker's TouchInput listens on `document` and only looks at page
        // coordinates, never at the event target, so a click on a slot would
        // otherwise *also* register as a click on the canvas underneath and
        // fire whatever the active window has highlighted. Stopping the raw
        // pointer events here, before they bubble past the bar, is what keeps
        // a slot press from double-firing.
        const swallow = (e) => e.stopPropagation();
        for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend']) {
          root.addEventListener(type, swallow);
        }
        root.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      }
      this._root = root;
      return root;
    }

    /** Inline mode: hand the root to a parent the caller lays out itself. */
    mount(parent) {
      if (!parent) return;
      const root = this.root();
      if (root.parentNode !== parent) parent.appendChild(root);
    }

    showTooltip(text, slotEl) {
      if (!text) return;
      const tip = tooltipEl();
      tip.textContent = text;
      tip.style.zIndex = String(this.zIndex + 1);
      const r = slotEl.getBoundingClientRect();
      tip.style.left = (r.left + r.width / 2) + 'px';
      tip.style.top = r.top + 'px';
      tip.style.display = 'block';
    }

    _key(entries, state) {
      const parts = [];
      for (let i = 0; i < this.slots; i++) {
        const e = entries[i];
        parts.push(e ? `${e.iconIndex}${e.enabled ? 'u' : 'd'}${e.count != null ? 'x' + e.count : ''}` : '-');
      }
      return parts.join(',') + '|' + (state.selected != null ? state.selected : -1) + '|' + (state.active ? 1 : 0);
    }

    _build(entries, state) {
      const root = this.root();
      root.innerHTML = '';
      for (let i = 0; i < this.slots; i++) {
        const entry = entries[i] || null;
        const slot = document.createElement('div');
        slot.className = 'hotbar-slot' +
          (!entry ? ' empty' : (entry.enabled ? '' : ' disabled')) +
          (state.active && i === state.selected ? ' selected' : '');
        slot.style.width = this.slotPx + 'px';
        slot.style.height = this.slotPx + 'px';

        const num = document.createElement('div');
        num.className = 'hotbar-num';
        num.textContent = String(i + 1);
        slot.appendChild(num);

        if (entry) {
          const icon = document.createElement('div');
          icon.className = 'hotbar-icon';
          icon.style.width = this.iconPx + 'px';
          icon.style.height = this.iconPx + 'px';
          const col = entry.iconIndex % 16;
          const row = Math.floor(entry.iconIndex / 16);
          icon.style.backgroundPosition = `${-col * this.iconPx}px ${-row * this.iconPx}px`;
          slot.appendChild(icon);

          if (entry.count != null) {
            const count = document.createElement('div');
            count.className = 'hotbar-count';
            count.textContent = String(entry.count);
            slot.appendChild(count);
          }
        }

        // Listeners read this._entries at event time rather than closing over
        // `entry`, so a rebuild between press and release can never act on a
        // stale slot.
        if (entry || (this.emptyClickable && this.onSlotClick)) slot.style.cursor = 'pointer';
        slot.addEventListener('mouseenter', () => {
          const cur = this._entries[i];
          if (cur && cur.tooltip) this.showTooltip(cur.tooltip, slot);
        });
        slot.addEventListener('mouseleave', hideTooltip);
        slot.addEventListener('pointerup', (e) => {
          if (e.button !== undefined && e.button !== 0) return;
          if (this.onSlotClick) this.onSlotClick(i, this._entries[i] || null, e);
        });
        slot.addEventListener('pointerdown', (e) => {
          if (e.button === 2 && this.onSlotContext) {
            this.onSlotContext(i, this._entries[i] || null, e);
          }
        });

        root.appendChild(slot);
      }
    }

    _position() {
      const root = this.root();
      const sc = canvasScale();
      const x = (Graphics.width - this.width()) / 2;
      // Letterboxed builds centre the box inside the canvas; the bar follows
      // the box's bottom edge, not the canvas's.
      const yOffset = Math.floor((Graphics.height - Graphics.boxHeight) / 2);
      const y = Graphics.height - this.slotPx - this.marginBottom - yOffset;
      root.style.left = (sc.ox + x * sc.sx) + 'px';
      root.style.top = (sc.oy + y * sc.sy) + 'px';
      root.style.transform = `scale(${sc.sx}, ${sc.sy})`;
    }

    /** Draw the bar. `state` is { selected, active }. */
    render(entries, state) {
      const st = state || {};
      const list = entries || [];
      const root = this.root();
      const key = this._key(list, st);
      this._entries = list;
      if (root.dataset.key !== key) {
        root.dataset.key = key;
        this._build(list, st);
      }
      root.style.display = 'flex';
      root.style.gap = this.gapPx + 'px';
      if (!this.inline) this._position();
    }

    hide() {
      const root = document.getElementById(this.id);
      if (root) root.style.display = 'none';
      hideTooltip();
    }

    /** Drop the element entirely; used when a scene tears its overlay down. */
    destroy() {
      const root = document.getElementById(this.id);
      if (root && root.parentNode) root.parentNode.removeChild(root);
      this._root = null;
      this._entries = [];
      hideTooltip();
    }
  }

  HotbarUI.canvasScale = canvasScale;
  HotbarUI.hideTooltip = hideTooltip;

  window.HotbarUI = HotbarUI;
})();
