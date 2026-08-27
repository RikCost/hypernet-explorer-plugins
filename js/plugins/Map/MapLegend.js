/*:
 * @target MZ
 * @plugindesc v1.1.0 The parchment legend pinned to the corner of the map: the control rows, per-map notices, per-area notices and the variable tooltip. Exposes window.MapLegend.
 * @author Hypernet
 *
 * @help MapLegend.js
 *
 * The one sheet of paper the map screen pins in its top right corner. It used
 * to live inside CharacterCreation.js as a black Window_Base panel listing the
 * tutorial's controls; it is its own plugin now, it is drawn as parchment, and
 * it carries three more things besides the controls.
 *
 * The sheet is parchment in every theme. Omega Tower and Archive Foundation
 * both leave it as paper and ink, so the palette below is written out here
 * instead of read off the theme tokens: a note pinned to the map is a note,
 * whichever skin the menus are wearing.
 *
 * ---------------------------------------------------------------------------
 * What the sheet shows
 * ---------------------------------------------------------------------------
 * 1. A notice, in the voice of the place: one title and one paragraph. Every
 *    notice must have a title, because the title is what is left of it once
 *    the sheet is folded. A notice that sends the party to a menu names it in
 *    square brackets - "use the [Thinker] option in pause menu" - and the
 *    sheet draws that name bold, without the brackets. Every translation of a
 *    notice must keep the brackets around the same name.
 * 2. The control rows, while the tutorial legend is still being learnt. Each
 *    row lights the first time the player exercises that control, on any
 *    device, and the block retires itself once every row has lit. They are
 *    only ever pinned up on the tutorial's own map (1414), and only while the
 *    party stands outside every zone: a notice takes the whole sheet, and the
 *    rows come back the moment the party walks out of the zone again. The
 *    world map (315) carries three rows of its own on the same terms.
 *
 * ---------------------------------------------------------------------------
 * Folding it away
 * ---------------------------------------------------------------------------
 * During the tutorial (switch 100) H folds the sheet down to its title alone,
 * still pinned to the top right corner, and unfolds it again. That is the one
 * time H is not the help menu: the fold is offered while the tutorial is
 * teaching, and the sheet carries a small [H] chip saying so. Outside the
 * tutorial the sheet is always open and H is the help menu as usual. Whether
 * it is folded is remembered on $gameSystem.
 *
 * ---------------------------------------------------------------------------
 * Where a notice comes from
 * ---------------------------------------------------------------------------
 * Three sources, resolved in this order:
 *
 *   1. The tooltip variable, if it was JUST changed. Variable 7 (see
 *      NOTICE_VARIABLE_ID) names a tooltip out of TOOLTIPS. An event that
 *      writes it is saying something now, so for the next few seconds it
 *      speaks over anything the ground has to say.
 *   2. The area the party is standing in, out of AREAS: a rectangle of map
 *      squares with a notice of its own. Areas beat the standing value of the
 *      tooltip variable, so a village square keeps naming itself long after
 *      the variable that pointed the party there was set.
 *   3. The tooltip variable, at rest. Non-zero, outside every area.
 *
 * A map has no notice of its own: outside every zone, with the variable at 0,
 * the sheet says nothing and shows the control rows alone. Nothing registered
 * for any of the three and no controls left to learn means the sheet is not
 * drawn at all.
 *
 * ---------------------------------------------------------------------------
 * Registering more
 * ---------------------------------------------------------------------------
 * Every notice is an i18n base key; the sheet reads "<key>.title" for the
 * heading and "<key>.text" for the paragraph, out of js/i18n/<lang>/plugins/
 * MapLegend.json. Add to the tables below, or from another plugin:
 *
 * The tables themselves are authored data, not code: they live in
 * js/db/MapNotices/Notices.json and are drawn on the map picture by the Map
 * Tooltips tool (tools/modules/map-tooltips.js). A plugin can still add to
 * them at runtime:
 *
 *   MapLegend.registerArea(1414, { x1: 4, y1: 4, x2: 12, y2: 20,
 *                                  key: 'MapLegend.areas.someField' });
 *   MapLegend.registerTooltip(9, 'MapLegend.tips.someHint');
 *
 * Area rectangles are inclusive on both corners and are tested in the order
 * they were registered, so the first match wins.
 *
 * @command refresh
 * @text Refresh legend
 * @desc Re-reads the notice for the square the party is standing on and redraws the sheet.
 *
 * @command setTooltip
 * @text Set tooltip
 * @desc Writes the tooltip variable, the same as setting variable 7 by hand. 0 hands the sheet back to the area notices.
 *
 * @arg value
 * @text Tooltip number
 * @type number
 * @min 0
 * @default 0
 * @desc Which registered tooltip to show. 0 clears it.
 */
(() => {
  "use strict";

  const PLUGIN_NAME = "MapLegend";

  //===========================================================================
  // What is registered
  //===========================================================================

  // The variable an event writes to speak over the ground. 0 means "say
  // nothing of your own, let the map and the areas talk".
  const NOTICE_VARIABLE_ID = 7;

  // How long a freshly written tooltip variable outranks the area underfoot.
  // Long enough to be read where it was set, short enough that walking on
  // hands the ground its voice back.
  const TOOLTIP_PRIORITY_FRAMES = 420;   // 7 seconds at 60fps

  // Which map says what, and where, is authored data rather than code: it lives
  // in js/db/MapNotices/Notices.json and is edited by the Map Tooltips tool
  // (tools/modules/map-tooltips.js). DataService registers that folder onto
  // window.MapNotices, read on first use, so nothing is parsed until the party
  // is actually standing somewhere.
  const DB_NAMESPACE = "MapNotices";
  const DB_FILE = "Notices";

  // mapId -> rectangles of map squares, each with a notice of its own.
  // Corners are inclusive; the first rectangle that contains the party wins.
  const AREAS = {};
  // Value of NOTICE_VARIABLE_ID -> i18n base key.
  const TOOLTIPS = {};

  let registryLoaded = false;

  // Reads the data file into the two tables above. Anything another plugin
  // registered by hand before the file was read survives, since the file is
  // only ever written into gaps it does not already fill... the other way
  // round would let a stale data file undo a runtime registration.
  function ensureRegistry() {
    if (registryLoaded) return;
    const db = window[DB_NAMESPACE] && window[DB_NAMESPACE][DB_FILE];
    if (!db) return;   // DataService has not registered it; try again next call
    registryLoaded = true;
    const maps = db.maps || {};
    for (const mapId of Object.keys(maps)) {
      const entry = maps[mapId] || {};
      if (Array.isArray(entry.areas) && entry.areas.length && AREAS[mapId] === undefined) {
        AREAS[mapId] = entry.areas.map((a) => ({
          key: a.key, x1: Number(a.x1), y1: Number(a.y1), x2: Number(a.x2), y2: Number(a.y2),
        }));
      }
    }
    const tips = db.tooltips || {};
    for (const value of Object.keys(tips)) {
      if (TOOLTIPS[value] === undefined) TOOLTIPS[value] = tips[value];
    }
  }

  //===========================================================================
  // The control rows
  //===========================================================================
  // Shown once, right after the tutorial's own preset pick ends character
  // creation. Each row lights the first time the player actually exercises
  // that control (any device counts, since RPG Maker MZ's Input already merges
  // keyboard and gamepad presses onto the same symbol); once every row has
  // lit, the block closes itself and is never shown again for this save.

  // The rows are the tutorial ground's own teaching, so they are only ever
  // pinned up on the map the tutorial hands the party (1414). Anywhere else
  // the sheet is its notices alone, whether or not the block has been learnt.
  const TUTORIAL_LEGEND_MAP_ID = 1414;

  const TUTORIAL_CONTROLS = [
    { id: "up", labelKey: "MapLegend.controls.up", key: "↑" },
    { id: "down", labelKey: "MapLegend.controls.down", key: "↓" },
    { id: "left", labelKey: "MapLegend.controls.left", key: "←" },
    { id: "right", labelKey: "MapLegend.controls.right", key: "→" },
    { id: "ok", labelKey: "MapLegend.controls.action", key: "Z / Enter", mouseKey: "MapLegend.controls.leftClick", pad: "A" },
    { id: "shift", labelKey: "MapLegend.controls.run", keyKey: "MapLegend.controls.holdShift", pad: "X" },
    { id: "menu", labelKey: "MapLegend.controls.menu", key: "Esc", pad: "Y" },
    { id: "mapSheet", labelKey: "MapLegend.controls.openMap", key: "M" },
    { id: "hotbar", labelKey: "MapLegend.controls.hotbarCycle", key: "Tab", pad: "L1 / R1" },
  ];

  // The world map (315) answers to three controls the tutorial ground never
  // teaches: T / Select stops the journey and walks the party into whatever
  // stands on the square they are on (WorldMapReturn's wmrToggle), R opens the
  // wait sheet (CustomMainMenuLayout's sleep_menu), and the triggers pull the
  // camera in and out (MousePan's zoom, which is confined to that one sheet).
  // They keep their own "already used once" record, so the legend can finish on
  // the world map long after the walking rows were learnt indoors, and once all
  // three have been used they are gone for good.
  const WORLD_MAP_LEGEND_MAP_ID = 315;

  const WORLD_MAP_CONTROLS = [
    { id: "visitPlace", labelKey: "MapLegend.controls.stopTravel", key: "T", pad: "Select" },
    { id: "wait", labelKey: "MapLegend.controls.wait", key: "R" },
    { id: "worldZoom", labelKey: "MapLegend.controls.zoom", key: "+ / -", pad: "L2 / R2" },
  ];

  //===========================================================================
  // Small shared helpers
  //===========================================================================

  function T(key, params) {
    return window.T ? window.T(key, params) : String(key);
  }

  function has(key) {
    return !!(window.T && window.T.has && window.T.has(key));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // A notice names the menus it is sending the party to in square brackets:
  // "use the [Thinker] option in pause menu". The brackets are markup rather
  // than punctuation, so what stands between them is drawn bold and they are
  // dropped. Nothing else in a notice is marked up, and an unclosed bracket is
  // left exactly as it was written.
  const NOTICE_EMPHASIS = /\[([^\[\]]+)\]/g;

  function noticeHtml(s) {
    return escapeHtml(s).replace(NOTICE_EMPHASIS,
      (_, inner) => `<span class="mlg-strong">${inner}</span>`);
  }

  // Which rows of a merged lit-record belong to one list, so each list keeps
  // its own record and neither can close the other.
  function litSubset(lit, entries) {
    const out = {};
    for (const entry of entries) if (lit[entry.id]) out[entry.id] = true;
    return out;
  }

  //===========================================================================
  // Notice resolution
  //===========================================================================

  // A registered notice resolved into the two strings the sheet draws. The
  // title is what the sheet keeps when it is folded, so a notice without one
  // is treated as nothing registered at all rather than folding into a blank
  // strip; the paragraph under it is optional.
  function readNotice(baseKey) {
    if (!baseKey) return null;
    const titleKey = baseKey + ".title";
    const textKey = baseKey + ".text";
    if (!has(titleKey)) return null;
    return {
      key: baseKey,
      title: T(titleKey),
      text: has(textKey) ? T(textKey) : "",
    };
  }

  function areaNoticeKey(mapId, x, y) {
    ensureRegistry();
    const list = AREAS[mapId];
    if (!list) return null;
    for (const area of list) {
      const x1 = Math.min(area.x1, area.x2);
      const x2 = Math.max(area.x1, area.x2);
      const y1 = Math.min(area.y1, area.y2);
      const y2 = Math.max(area.y1, area.y2);
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return area.key;
    }
    return null;
  }

  function tooltipNoticeKey(value) {
    ensureRegistry();
    return TOOLTIPS[value] || null;
  }

  // The tooltip variable is watched rather than hooked: whoever writes it -
  // an event command, a plugin, the debug console - is saying something now,
  // and for TOOLTIP_PRIORITY_FRAMES that outranks the ground the party is
  // standing on. Loading a save re-reads the value without arming the window,
  // so an old tooltip does not shout the moment the map comes back.
  const tooltipWatch = { last: null, priorityLeft: 0 };

  function currentTooltipValue() {
    return $gameVariables ? Number($gameVariables.value(NOTICE_VARIABLE_ID)) || 0 : 0;
  }

  function resetTooltipWatch() {
    tooltipWatch.last = currentTooltipValue();
    tooltipWatch.priorityLeft = 0;
  }

  function updateTooltipWatch() {
    const value = currentTooltipValue();
    if (tooltipWatch.last === null) {
      tooltipWatch.last = value;
      return;
    }
    if (value !== tooltipWatch.last) {
      tooltipWatch.last = value;
      tooltipWatch.priorityLeft = value !== 0 ? TOOLTIP_PRIORITY_FRAMES : 0;
    } else if (tooltipWatch.priorityLeft > 0) {
      tooltipWatch.priorityLeft--;
    }
  }

  // The three sources, in the order the help block describes. A map with no
  // zone underfoot and no tooltip set says nothing: the sheet is then the
  // control rows alone, or nothing at all once they have been learnt.
  function resolveNotice() {
    if (!$gameMap || !$gamePlayer) return null;
    const mapId = $gameMap.mapId();
    const value = currentTooltipValue();
    const tooltip = value !== 0 ? readNotice(tooltipNoticeKey(value)) : null;

    if (tooltip && tooltipWatch.priorityLeft > 0) return tooltip;

    const area = readNotice(areaNoticeKey(mapId, $gamePlayer.x, $gamePlayer.y));
    if (area) return area;
    return tooltip;
  }

  //===========================================================================
  // The lit record
  //===========================================================================

  // Arms the control rows for the map the tutorial just finished on. Idempotent
  // against a save that has already finished them, so re-running the tutorial
  // plugin command never brings them back.
  function beginTutorialLegend() {
    if (!$gameSystem || $gameSystem._tutorialControlsLegendSeen) return;
    $gameSystem._tutorialControlsLegendActive = true;
    $gameSystem._tutorialControlsLit = {};
  }

  function coreRowsVisible() {
    if (!$gameSystem || !$gameMap) return false;
    if (!$gameSystem._tutorialControlsLegendActive) return false;
    if ($gameSystem._tutorialControlsLegendSeen) return false;
    return $gameMap.mapId() === TUTORIAL_LEGEND_MAP_ID;
  }

  // The world map rows stand on their own: standing on map 315 is enough to
  // show them, whether or not the party ever went through the tutorial, and
  // they are gone for good once both have been used once.
  function worldRowsVisible() {
    if (!$gameSystem || !$gameMap) return false;
    if ($gameSystem._worldMapControlsSeen) return false;
    return $gameMap.mapId() === WORLD_MAP_LEGEND_MAP_ID;
  }

  function litRecord() {
    return Object.assign(
      {},
      ($gameSystem && $gameSystem._tutorialControlsLit) || {},
      ($gameSystem && $gameSystem._worldMapControlsLit) || {}
    );
  }

  function markLit(id) {
    if (!$gameSystem) return false;
    const lit = litRecord();
    if (lit[id]) return false;
    lit[id] = true;
    $gameSystem._tutorialControlsLit = litSubset(lit, TUTORIAL_CONTROLS);
    $gameSystem._worldMapControlsLit = litSubset(lit, WORLD_MAP_CONTROLS);
    SoundManager.playCursor();
    return true;
  }

  function listComplete(entries) {
    const lit = litRecord();
    return entries.every((entry) => lit[entry.id]);
  }

  function visibleRows() {
    const rows = [];
    if (coreRowsVisible()) rows.push(...TUTORIAL_CONTROLS);
    if (worldRowsVisible()) rows.push(...WORLD_MAP_CONTROLS);
    return rows;
  }

  function rowKeys(entry) {
    const key = entry.key || (entry.keyKey ? T(entry.keyKey) : "");
    const mouse = entry.mouseKey ? T(entry.mouseKey) : "";
    const pad = entry.pad || "";
    return [key, mouse, pad].filter(Boolean).join(" / ");
  }

  //===========================================================================
  // Folding the sheet away
  //===========================================================================
  // Switch 100 is the tutorial, the same switch character creation, the death
  // handler and the world map return all read. It is the only time the sheet
  // offers the fold, and the only time H is taken off the help menu for it.

  const TUTORIAL_SWITCH_ID = 100;
  const FOLD_INPUT = "letter_h";     // CustomMainMenuLayout maps H (72) onto it
  const FOLD_KEY_LABEL = "H";        // i18n-ignore  physical key label

  function tutorialMode() {
    return !!($gameSwitches && $gameSwitches.value(TUTORIAL_SWITCH_ID));
  }

  // Folded is remembered on $gameSystem, so a save reopens the way it was left.
  // Outside the tutorial the sheet is always open: nothing there can fold it,
  // and a save that ended the tutorial folded would otherwise be stuck that way.
  function isFolded() {
    return !!($gameSystem && $gameSystem._mapLegendFolded && tutorialMode());
  }

  function toggleFold() {
    if (!$gameSystem) return;
    $gameSystem._mapLegendFolded = !$gameSystem._mapLegendFolded;
    SoundManager.playCursor();
  }

  // H is the help menu everywhere else, so the fold is spliced in ahead of the
  // hotkey table CustomMainMenuLayout owns rather than bound over it: in the
  // tutorial the press is taken here and the table never sees it, and the
  // moment the tutorial ends the table gets its key back. That plugin loads
  // after this one, so the splice waits until the map is starting.
  let foldHotkeyTried = false;
  let foldHotkeySpliced = false;

  function patchFoldHotkey() {
    if (foldHotkeyTried) return;
    foldHotkeyTried = true;
    if (typeof Scene_Map.prototype.updateMenuHotkeys !== "function") return;
    const base = Scene_Map.prototype.updateMenuHotkeys;
    Scene_Map.prototype.updateMenuHotkeys = function () {
      if (tutorialMode() && Input.isTriggered(FOLD_INPUT)) {
        toggleFold();
        return;
      }
      base.call(this);
    };
    foldHotkeySpliced = true;
  }

  // With CustomMainMenuLayout absent there is no table to splice into and no
  // help menu to protect, so the key is read straight off the map instead.
  function readFoldKey() {
    if (foldHotkeySpliced) return;
    if (tutorialMode() && Input.isTriggered(FOLD_INPUT)) toggleFold();
  }

  //===========================================================================
  // The parchment sheet
  //===========================================================================
  // Paper and ink, written out rather than read off the theme tokens: the
  // sheet is the same in Omega Tower as it is in Archive Foundation.

  const PAPER = "#ecdcb9";
  const PAPER_EDGE = "#dcc79c";
  const INK = "#3b2412";
  const INK_HEADING = "#58180D";
  const INK_FAINT = "#6b5233";
  const GOLD = "#6b4c08";
  const BORDER = "#4a2711";

  const SHEET_ID = "map-legend";
  const STYLE_ID = "map-legend-style";
  const SHEET_WIDTH = 336;   // game pixels
  const SHEET_MARGIN = 16;   // game pixels, from the top right corner

  const CSS = `
#${SHEET_ID} {
    position: fixed;
    z-index: 480;
    pointer-events: none;
    box-sizing: border-box;
    width: ${SHEET_WIDTH}px;
    transform-origin: 100% 0;
    padding: 12px 14px;
    border: 3px solid ${BORDER};
    border-radius: 6px;
    outline: 1px solid rgba(74, 39, 17, 0.40);
    outline-offset: -7px;
    background-color: ${PAPER};
    background-image:
        radial-gradient(ellipse at center, rgba(255, 255, 255, 0.28) 0%, transparent 55%),
        radial-gradient(ellipse at center, transparent 40%, rgba(78, 38, 12, 0.14) 100%),
        linear-gradient(160deg, ${PAPER} 0%, ${PAPER_EDGE} 100%);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
    font-family: 'Lora', serif;
    color: ${INK};
    opacity: 0;
    transition: opacity 220ms ease;
}
#${SHEET_ID}.mlg-shown { opacity: 1; }
#${SHEET_ID}.mlg-folded { width: auto; max-width: ${SHEET_WIDTH}px; padding: 8px 12px; }
#${SHEET_ID}.mlg-folded .mlg-title { white-space: nowrap; }
#${SHEET_ID} .mlg-title {
    font-size: 17px;
    font-weight: bold;
    line-height: 1.2;
    color: ${INK_HEADING};
    letter-spacing: 0.02em;
}
#${SHEET_ID} .mlg-text {
    font-size: 14px;
    font-weight: normal;
    line-height: 1.42;
    margin-top: 4px;
    color: ${INK};
}
#${SHEET_ID} .mlg-text .mlg-strong,
#${SHEET_ID} .mlg-title .mlg-strong {
    font-weight: bold;
    color: ${INK_HEADING};
}
#${SHEET_ID} .mlg-rule {
    height: 0;
    margin: 10px 0 8px 0;
    border-top: 1px solid rgba(74, 39, 17, 0.45);
    border-bottom: 1px solid rgba(255, 255, 255, 0.35);
}
#${SHEET_ID} .mlg-heading {
    font-size: 12px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.10em;
    color: ${INK_FAINT};
    margin-bottom: 5px;
}
#${SHEET_ID} .mlg-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    line-height: 1.5;
    color: ${INK};
}
#${SHEET_ID} .mlg-row .mlg-label { font-weight: normal; }
#${SHEET_ID} .mlg-row .mlg-keys {
    font-weight: bold;
    white-space: nowrap;
    color: ${INK_HEADING};
}
#${SHEET_ID} .mlg-row.mlg-lit .mlg-label,
#${SHEET_ID} .mlg-row.mlg-lit .mlg-keys {
    color: ${GOLD};
    opacity: 0.72;
}
#${SHEET_ID} .mlg-row.mlg-lit .mlg-label::before {
    content: '\\2713\\00a0';
    color: ${GOLD};
}
#${SHEET_ID} .mlg-fold {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 8px;
    font-size: 11.5px;
    font-weight: normal;
    color: ${INK_FAINT};
}
#${SHEET_ID}.mlg-folded .mlg-fold { margin-top: 4px; }
#${SHEET_ID} .mlg-chip {
    display: inline-block;
    min-width: 15px;
    padding: 0 4px;
    text-align: center;
    font-weight: bold;
    font-size: 11px;
    line-height: 15px;
    color: ${INK_HEADING};
    border: 1px solid rgba(74, 39, 17, 0.55);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.30);
}
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function canvasMetrics() {
    const canvas = document.getElementById("gameCanvas");
    if (!canvas || typeof Graphics === "undefined" || !Graphics.width) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { ox: r.left, oy: r.top, right: r.right,
             sx: r.width / Graphics.width, sy: r.height / Graphics.height };
  }

  class LegendSheet {
    constructor() {
      this._el = null;
      this._signature = "";
    }

    element() {
      if (this._el && document.body.contains(this._el)) return this._el;
      // The page survives Title <-> Map transitions, so a sheet left behind by
      // a previous run is purged rather than layered under a new one.
      document.querySelectorAll("#" + SHEET_ID).forEach((e) => e.remove());
      ensureStyle();
      const el = document.createElement("div");
      el.id = SHEET_ID;
      document.body.appendChild(el);
      this._el = el;
      this._signature = "";
      return el;
    }

    hide() {
      if (!this._el) return;
      this._el.classList.remove("mlg-shown");
      this._el.style.display = "none";
    }

    destroy() {
      if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
      this._el = null;
      this._signature = "";
    }

    // The sheet is rebuilt only when what it says changes, so a walking party
    // costs one string compare a frame.
    draw(notice, rows, state) {
      const el = this.element();
      const lit = litRecord();
      const folded = !!state.folded;
      const signature = JSON.stringify([
        notice ? [notice.key, notice.title, notice.text] : null,
        rows.map((entry) => [entry.id, !!lit[entry.id]]),
        folded, !!state.foldable,
      ]);
      if (signature !== this._signature) {
        this._signature = signature;
        el.innerHTML = this._html(notice, rows, lit, state);
        el.classList.toggle("mlg-folded", folded);
      }
      el.style.display = "";
      this.position();
      // Fading in on the frame after the sheet is attached, so the first
      // notice of a map arrives rather than snapping into place.
      if (!el.classList.contains("mlg-shown")) {
        requestAnimationFrame(() => {
          if (this._el === el) el.classList.add("mlg-shown");
        });
      }
    }

    // Folded, the sheet is its title and nothing else: the paragraph and the
    // control rows are both put away, and only the [H] chip says they are
    // still there.
    _html(notice, rows, lit, state) {
      const parts = [];
      if (notice) parts.push(`<div class="mlg-title">${noticeHtml(notice.title)}</div>`);
      if (!state.folded) {
        if (notice && notice.text) parts.push(`<div class="mlg-text">${noticeHtml(notice.text)}</div>`);
        if (rows.length) {
          if (parts.length) parts.push('<div class="mlg-rule"></div>');
          parts.push(`<div class="mlg-heading">${escapeHtml(T("MapLegend.controlsHeading"))}</div>`);
          for (const entry of rows) {
            const cls = lit[entry.id] ? "mlg-row mlg-lit" : "mlg-row";
            parts.push(
              `<div class="${cls}">` +
              `<span class="mlg-label">${escapeHtml(T(entry.labelKey))}</span>` +
              `<span class="mlg-keys">${escapeHtml(rowKeys(entry))}</span>` +
              `</div>`
            );
          }
        }
      }
      if (state.foldable) {
        const hint = T(state.folded ? "MapLegend.unfoldHint" : "MapLegend.foldHint");
        parts.push('<div class="mlg-fold">' +
          `<span class="mlg-chip">${escapeHtml(FOLD_KEY_LABEL)}</span>` +
          `<span>${escapeHtml(hint)}</span></div>`);
      }
      return parts.join("");
    }

    // Pinned by its right edge rather than its left, so a folded sheet no
    // wider than its own title still sits in the corner instead of floating
    // in from it.
    position() {
      const el = this._el;
      const m = canvasMetrics();
      if (!el || !m) return;
      el.style.left = "auto";
      el.style.right = (window.innerWidth - m.right + SHEET_MARGIN * m.sx) + "px";
      el.style.top = (m.oy + SHEET_MARGIN * m.sy) + "px";
      el.style.transform = `scale(${m.sx}, ${m.sy})`;
    }
  }

  const sheet = new LegendSheet();

  //===========================================================================
  // Driving it from the map scene
  //===========================================================================

  // The camera zoom is not a button press: the wheel, the +/- keys and the
  // triggers all end up moving Game_Screen's scale, so the legend watches the
  // scale itself and counts any change made on the world map as the control
  // having been used.
  let lastLegendZoom = null;

  function zoomControlUsed() {
    const zoom = $gameScreen ? $gameScreen.zoomScale() : 1;
    const moved = lastLegendZoom !== null && Math.abs(zoom - lastLegendZoom) > 0.0005;
    lastLegendZoom = zoom;
    if (moved) return true;
    return !!(Input.isRepeated("mapZoomIn") || Input.isRepeated("mapZoomOut") ||
      Input.isRepeated("zoomIn") || Input.isRepeated("zoomOut"));
  }

  function readControlUse() {
    if (coreRowsVisible()) {
      if (Input.isTriggered("up")) markLit("up");
      if (Input.isTriggered("down")) markLit("down");
      if (Input.isTriggered("left")) markLit("left");
      if (Input.isTriggered("right")) markLit("right");
      if (Input.isTriggered("ok") || TouchInput.isTriggered()) markLit("ok");
      // Esc reaches the pause menu through Scene_Map.callMenu, which pushes the
      // menu scene on the very frame it is pressed: by the time the sheet is
      // updated the scene is already changing and the press is gone. So the row
      // is lit from the call itself (see below) rather than from the key, and
      // these two only cover a pad or a rebind that opened nothing.
      if (Input.isTriggered("escape") || Input.isTriggered("menu") ||
        TouchInput.isCancelled()) markLit("menu");
      if (Input.isPressed("shift")) markLit("shift");
      // The map sheet (WorldMap.js, M) and the item bar's L1/R1 step
      // (ItemSystemHotbar.js, pageup/pagedown) are read under their own
      // symbols, so a rebind still lights the row.
      if (Input.isTriggered("world_map_toggle")) markLit("mapSheet");
      if (Input.isTriggered("pageup") || Input.isTriggered("pagedown") || Input.isTriggered("tab")) markLit("hotbar");
    }

    if (worldRowsVisible()) {
      if (Input.isTriggered("wmrToggle")) markLit("visitPlace");
      // R is CustomMainMenuLayout's sleep_menu hotkey; the wait sheet it opens
      // is a popup rather than a scene, so the press is still readable here.
      if (Input.isTriggered("letter_r") ||
        (typeof $gameTemp !== "undefined" && $gameTemp && $gameTemp._sleepMenuOpen)) {
        markLit("wait");
      }
      if (zoomControlUsed()) markLit("worldZoom");
    } else {
      lastLegendZoom = null;
    }

    if (coreRowsVisible() && listComplete(TUTORIAL_CONTROLS) && $gameSystem) {
      $gameSystem._tutorialControlsLegendSeen = true;
      $gameSystem._tutorialControlsLegendActive = false;
    }
    if (worldRowsVisible() && listComplete(WORLD_MAP_CONTROLS) && $gameSystem) {
      $gameSystem._worldMapControlsSeen = true;
    }
  }

  // The sheet belongs to the walking map and nothing else: a menu, a battle or
  // the 3D world takes it off the screen rather than leaving it floating over
  // something it was never drawn against.
  function sheetAllowed() {
    if (!(SceneManager._scene instanceof Scene_Map)) return false;
    if (SceneManager.isSceneChanging && SceneManager.isSceneChanging()) return false;
    if (!$gameMap || !$gamePlayer || !$gameSystem) return false;
    if (window.VoxelWorldSystem && window.VoxelWorldSystem.isActive && window.VoxelWorldSystem.isActive()) return false;
    return true;
  }

  function updateLegend() {
    if (!sheetAllowed()) {
      sheet.hide();
      return;
    }
    updateTooltipWatch();
    readControlUse();
    readFoldKey();
    const notice = resolveNotice();
    const folded = isFolded();
    // The rows are what the sheet says when it has nothing else to say: a zone
    // notice takes the paper for as long as the party stands in it, and the
    // rows come back the moment they step outside it again.
    // Folded there is nothing to show but the title, so a fold with no notice
    // under it takes the sheet off the screen rather than leaving an empty
    // strip with a chip on it.
    const rows = (folded || notice) ? [] : visibleRows();
    if (!notice && !rows.length) {
      sheet.hide();
      return;
    }
    sheet.draw(notice, rows, { folded, foldable: tutorialMode() });
  }

  // The fold is spliced into the hotkey table as the map starts, which is
  // after every plugin has loaded and before the first frame is updated.
  const _Scene_Map_start = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function () {
    patchFoldHotkey();
    _Scene_Map_start.call(this);
  };

  // The Menu row is lit by the menu actually opening rather than by the key
  // that opened it: Esc, the pad's Y, a right click and CustomMainMenuLayout's
  // own hotkey table all end up here, and none of them are still readable on
  // the frame the sheet is next updated.
  const _Scene_Map_callMenu = Scene_Map.prototype.callMenu;
  Scene_Map.prototype.callMenu = function () {
    if (coreRowsVisible()) markLit("menu");
    _Scene_Map_callMenu.call(this);
  };

  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);
    updateLegend();
  };

  const _Scene_Map_terminate = Scene_Map.prototype.terminate;
  Scene_Map.prototype.terminate = function () {
    sheet.hide();
    _Scene_Map_terminate.call(this);
  };

  // A load, a new game or a map change re-reads the tooltip variable without
  // arming its priority window, so the sheet opens on whatever the ground says.
  const _Game_Map_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    _Game_Map_setup.call(this, mapId);
    resetTooltipWatch();
  };

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    resetTooltipWatch();
  };

  //===========================================================================
  // Plugin commands and the public face
  //===========================================================================

  PluginManager.registerCommand(PLUGIN_NAME, "refresh", () => {
    sheet.destroy();
    updateLegend();
  });

  PluginManager.registerCommand(PLUGIN_NAME, "setTooltip", (args) => {
    const value = Number(args.value) || 0;
    if ($gameVariables) $gameVariables.setValue(NOTICE_VARIABLE_ID, value);
  });

  window.MapLegend = {
    NOTICE_VARIABLE_ID,
    TOOLTIP_PRIORITY_FRAMES,
    WORLD_MAP_LEGEND_MAP_ID,
    TUTORIAL_LEGEND_MAP_ID,
    TUTORIAL_CONTROLS,
    WORLD_MAP_CONTROLS,
    AREAS,
    TOOLTIPS,

    beginTutorialLegend,
    registerArea(mapId, rect) {
      if (!AREAS[mapId]) AREAS[mapId] = [];
      AREAS[mapId].push(rect);
    },
    registerTooltip(value, key) { TOOLTIPS[value] = key; },

    // The resolution the sheet draws, exposed so a test or another plugin can
    // ask what would be shown without a screen to draw it on.
    readNotice,
    noticeHtml,
    ensureRegistry,
    areaNoticeKey,
    tooltipNoticeKey,
    resolveNotice,
    tooltipWatch,
    resetTooltipWatch,
    updateTooltipWatch,

    TUTORIAL_SWITCH_ID,
    tutorialMode,
    isFolded,
    toggleFold,

    refresh() { sheet.destroy(); updateLegend(); },
    hide() { sheet.hide(); },
  };
})();
