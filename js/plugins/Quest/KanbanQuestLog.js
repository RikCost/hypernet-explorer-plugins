/*:
 * @target MZ
 * @plugindesc Kanban Quest Log v1.1.0
 * @author Omni-Lex
 * @help
 * ============================================================================
 * Kanban Quest Log Plugin for RPG Maker MZ
 * ============================================================================
 * 
 * This plugin creates a Kanban board-style quest log with draggable sticky
 * notes in three columns: To Do, In Progress, and Done.
 * 
 * Features:
 * - Draggable sticky notes with mouse (long press 0.6s to drag)
 * - Click to open quest details immediately
 * - Different colors for different quests
 * - Quest details with update history
 * - Menu integration
 * - Notifications for new quests and updates
 * - Plugin commands for quest management
 * 
 * Plugin Commands:
 * - Add Quest: Creates a new quest in the To Do column
 * - Update Quest: Adds an update to an existing quest
 * - Complete Quest: Moves a quest to the Done column
 * - Open Quest Log: Opens the Kanban quest board
 * 
 * @param menuCommand
 * @text Menu Command Name
 * @desc Name of the quest log command in the menu
 * @default Quest Log
 * 
 * @param showInMenu
 * @text Show in Menu
 * @desc Show the Quest Log command in the pause menu
 * @type boolean
 * @default true
 * 
 * @param notificationDuration
 * @text Notification Duration
 * @desc How long notifications stay on screen (in frames)
 * @type number
 * @default 180
 * 
 * @command addQuest
 * @text Add Quest
 * @desc Adds a new quest to the To Do column
 * 
 * @arg questId
 * @text Quest ID
 * @desc Unique identifier for the quest
 * @type string
 * 
 * @arg questTitle
 * @text Quest Title
 * @desc Title of the quest
 * @type string
 * 
 * @arg questDescription
 * @text Initial Description
 * @desc Initial description or objective
 * @type multiline_string
 * 
 * @command updateQuest
 * @text Update Quest
 * @desc Adds an update to an existing quest
 * 
 * @arg questId
 * @text Quest ID
 * @desc ID of the quest to update
 * @type string
 * 
 * @arg updateText
 * @text Update Text
 * @desc New update information
 * @type multiline_string
 * 
 * @command completeQuest
 * @text Complete Quest
 * @desc Moves a quest to the Done column
 * 
 * @arg questId
 * @text Quest ID
 * @desc ID of the quest to complete
 * @type string
 * 
 * @command openQuestLog
 * @text Open Quest Log
 * @desc Opens the Kanban quest board
 * 
 * @command clearAllQuests
 * @text Clear All Quests
 * @desc Removes all quests from the Kanban board
 */

(() => {
    'use strict';

    const pluginName = 'KanbanQuestLog';
    const parameters = PluginManager.parameters(pluginName);
    const menuCommand = parameters['menuCommand'] || 'Quest Log';
    const notificationDuration = Number(300);

    // Long press duration in milliseconds
    const LONG_PRESS_DURATION = 100;

    // Color palette for sticky notes
    const NOTE_COLORS = [
        '#faf2d3', // Cream Parchment
        '#e6ebd7', // Muted Herb Sage
        '#ebd7d7', // Muted Blush Vellum
        '#d7ebeb', // Aged Slate Mist
        '#e9e0f0', // Soft Lavender Vellum
        '#f0e0e9', // Muted Heather Paper
        '#ebdcd0', // Muted Tea Stain
        '#d2e0db'  // Soft Mint Moss
    ];


    // Seal colours and hashing shared with QuestBoardUI so a note pinned to the
    // cork board and the same note on the log look like the same piece of paper.
    const SEAL_COLORS = ['#8b263e', '#1f4e79', '#3e6b2f', '#6b4a1f', '#4a2f6b', '#2f6b62', '#7a3b17', '#41414d'];
    const PIN_COLORS = ['#b03030', '#2f5db0', '#2f8a45', '#a88a1f'];

    function hashStr(s) {
        let h = 0x811c9dc5;
        s = String(s);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }

    // Marker identity: every quest that can be pinned on a map (the compass
    // arrows in WorldMapReturn.js, the diamonds in WorldMap.js, this board's own
    // card) is coloured and iconed from its id alone, so the same quest always
    // reads the same everywhere and two different quests never collide. Neither
    // is stored on the quest record: deriving it from a hash means an old save,
    // one loaded before this existed, still gets a stable answer.
    //
    // A separate, saturated palette from NOTE_COLORS (the pastel post-it paper):
    // a pale cream or sage note colour would all but vanish painted on a map.
    const MARKER_COLORS = [
        '#e0483e', '#3e7fe0', '#3ea85a', '#e0a13e', '#8a4ee0', '#3ec2c2',
        '#d43e93', '#c2c23e', '#3ecfa0', '#e0673e', '#5a5ae0', '#a0873e'
    ];

    // IconSet.png indices, 65-215 in steps of 5: the item/equipment bank of the
    // sheet (the first 64 icons are HUD stat glyphs and party emblems, no use as
    // a quest token), spread wide enough that neighbouring quests rarely land on
    // near-identical icons.
    const QUEST_ICONS = [
        65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135,
        140, 145, 150, 155, 160, 165, 170, 175, 180, 185, 190, 195, 200, 205, 210, 215
    ];

    function markerColorFor(id) {
        return MARKER_COLORS[hashStr(String(id) + ':mk') % MARKER_COLORS.length];
    }

    function markerIconFor(id) {
        return QUEST_ICONS[hashStr(String(id) + ':ic') % QUEST_ICONS.length];
    }

    // Inline background-position/-size for a single IconSet cell drawn at
    // `size`px (native icons are 32px, so this also handles the downscale).
    function iconBadgeStyle(icon, size) {
        const cols = 16;
        const col = icon % cols;
        const row = Math.floor(icon / cols);
        return `width:${size}px;height:${size}px;background-position:-${col * size}px -${row * size}px;background-size:${cols * size}px auto;`;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    // The face of a post-it, shared by the board and by anything else that wants
    // to show the same note (the world map hover preview asks for this, so the two
    // can never drift apart).
    function buildNoteHTML(q, useIt, opts) {
        const o = opts || {};
        const meta = q.meta || {};
        const done = o.colId === 'done' || (q.column === 'done' && !o.colId);
        const failed = o.colId === 'failed' || (q.column === 'failed' && !o.colId);
        const latest = q.updates && q.updates.length ? q.updates[0].text : '';
        const rot = o.flat ? 0 : ((hashStr(q.id) % 9) - 4) * 0.9;
        const pin = PIN_COLORS[hashStr(q.id + 'p') % PIN_COLORS.length];
        const seal = SEAL_COLORS[hashStr(q.id + 's') % SEAL_COLORS.length];
        const sealSrc = String(meta.giver || q.title || '?').replace(/^(a|an|the)\s+/i, '');
        const sealCh = esc(sealSrc.charAt(0).toUpperCase() || '?');
        const stamp = done ? (T('Kanban.resolved'))
            : failed ? (T('Kanban.failed')) : '';
        const stars = meta.diff > 0
            ? '<span class="kb-star"></span>'.repeat(Math.min(5, meta.diff)) : '';
        const urgent = (!done && !failed && meta.deadlineHours > 0)
            ? `<div class="kb-urgent">${T('Kanban.urgent')} ${meta.deadlineHours}h</div>` : '';
        const markerColor = markerColorFor(q.id);
        const markerIconCss = iconBadgeStyle(markerIconFor(q.id), 30);

        return `<div class="kb-card${o.focused ? ' focused' : ''}${done || failed ? ' kb-done' : ''}"
                     ${o.attrs || ''}
                     style="--rot:${rot}deg; --note-bg:${q.color || '#faf2d3'}; --pin:${pin}; --seal:${seal}; --marker:${markerColor}">
          <div class="kb-pin"></div>
          <div class="kb-quest-icon" style="${markerIconCss}" title="${T('Kanban.mapMarker') || ''}"></div>
          ${urgent}
          <span class="kb-card-title">${esc(q.title)}</span>
          ${meta.giver ? `<span class="kb-card-giver">${esc(meta.giver)}</span>` : ''}
          ${meta.reward ? `<span class="kb-card-reward">${T('Kanban.reward')}${esc(meta.reward)}</span>` : ''}
          ${latest ? `<span class="kb-card-meta">${esc(latest)}</span>` : ''}
          ${o.progressHTML || ''}
          ${stars ? `<div class="kb-diff">${stars}</div>` : ''}
          ${stamp ? `<span class="kb-resolved-stamp${failed ? ' failed' : ''}">${stamp}</span>` : ''}
          <div class="kb-seal">${sealCh}</div>
        </div>`;
    }

    // The whole board is styled here rather than in css/theme.css: it has to
    // match QuestBoardUI.js's cork board exactly, and the theme presets used to
    // fight it (one of them forced position:relative on the overlay, which broke
    // its fullscreen positioning outright).
    const STYLE = `
#kb-board-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh;
  z-index: 80; display: flex; flex-direction: column; box-sizing: border-box;
  font-family: "Lora", "IM Fell English", serif; user-select: none; overflow: hidden;
  background:
    radial-gradient(circle at 18% 28%, rgba(0,0,0,0.16) 2px, transparent 3px),
    radial-gradient(circle at 67% 71%, rgba(0,0,0,0.13) 2px, transparent 3px),
    radial-gradient(circle at 42% 55%, rgba(255,255,255,0.04) 1px, transparent 2px),
    linear-gradient(135deg, #a8814f 0%, #96703f 34%, #a37c48 62%, #8d6335 100%);
  background-size: 90px 70px, 70px 90px, 50px 50px, auto;
  border: 18px solid #4a2c14; box-shadow: inset 0 0 120px rgba(0,0,0,0.5); }
#kb-board-overlay.kb-app-mode { position: relative; width: 100%; height: 100%; border-width: 8px; }
#kb-board-overlay::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none; border: 5px solid #2b1008; box-shadow: inset 0 0 0 2px #6b4423; }
#kb-board-overlay::after { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 45%, rgba(20,10,4,0.42) 100%); }
#kb-board-header { position: relative; z-index: 1; flex: 0 0 auto;
  display: flex; align-items: center; gap: 18px; padding: 18px 34px 14px;
  min-height: 2.6rem; /* the title is out of flow: keep the room it used to take */
  color: #f5ebd0; text-shadow: 1px 1px 3px #2b1008;
  border-bottom: 2px solid rgba(43,16,8,0.35); }
/* Centred on the board itself, not on whatever is left over between the back
   button and the hint, so the two flanking items never push it off centre. */
.kb-board-title { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  pointer-events: none; white-space: nowrap;
  font-size: 2.1rem; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; }
/* Shared .back-button look, but kept in the header's flex flow: the global rule
   pins it position:absolute;left:0, which here would resolve against the whole
   board overlay and land on top of the To Do column. */
#kb-board-header .back-button { position: relative; left: auto; flex: 0 0 auto;
  align-self: center; text-shadow: none; }
.kb-board-hint { margin-left: auto; font-size: 0.9rem; opacity: 0.72; text-align: right; }
#kb-columns { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0;
  display: flex; gap: 0; padding: 22px 26px 30px;
  border-top: 2px solid rgba(43,16,8,0.35); }
.kb-col-divider { flex: 0 0 2px; margin: 12px 10px;
  background: rgba(43,16,8,0.4); box-shadow: 1px 0 0 rgba(255,255,255,0.06); }
.kb-column { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; padding: 0 10px; }
.kb-col-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 8px 22px 9px; margin: 0 0 16px;
  color: #f5ebd0; background: #7a4d24; border: 2px solid #2b1008;
  border-radius: 10px 10px 0 0; box-shadow: 0 -2px 6px rgba(0,0,0,0.35), 0 3px 8px rgba(0,0,0,0.4); }
.kb-col-title { font-size: 1.1rem; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;
  text-shadow: 1px 1px 2px #2b1008; }
.kb-col-count { font-size: 0.95rem; font-weight: bold; color: #f5ebd0;
  background: rgba(43,16,8,0.45); border: 1px solid #2b1008; border-radius: 3px;
  padding: 1px 10px; min-width: 30px; text-align: center; }
.kb-cards-wrap { flex: 1 1 auto; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; align-items: center; gap: 26px;
  padding: 12px 8px 24px; }
.kb-cards-wrap::-webkit-scrollbar { width: 12px; }
.kb-cards-wrap::-webkit-scrollbar-track { background: rgba(43,16,8,0.28); }
.kb-cards-wrap::-webkit-scrollbar-thumb { background: #5d3a1c; border: 2px solid #2b1008; border-radius: 6px; }
.kb-empty-col { color: #f5ebd0; font-size: 1.05rem; font-style: italic; opacity: 0.8;
  text-align: center; padding: 26px 12px; text-shadow: 1px 1px 3px #2b1008; }
.kb-card { position: relative; width: 100%; max-width: 300px; min-height: 132px; flex: 0 0 auto;
  padding: 32px 18px 18px; box-sizing: border-box; cursor: pointer; color: #2b251d;
  background: var(--note-bg, #faf2d3);
  box-shadow: 4px 6px 12px rgba(0,0,0,0.5);
  transform: rotate(var(--rot, 0deg));
  transition: transform 0.12s ease, box-shadow 0.12s ease; }
.kb-card.focused, .kb-card:hover { transform: rotate(0deg) scale(1.04); z-index: 5;
  box-shadow: 7px 10px 20px rgba(0,0,0,0.6); outline: 3px solid #ffd76a; }
.kb-card.kb-done { filter: sepia(0.35) brightness(0.92); }
.kb-pin { position: absolute; top: 8px; left: 50%; width: 18px; height: 18px; margin-left: -9px;
  border-radius: 50%; background: radial-gradient(circle at 35% 30%, #f0f0f0, var(--pin, #b03030) 55%, #501010);
  box-shadow: 0 3px 4px rgba(0,0,0,0.5); }
/* The map-marker identity: the same icon+colour this quest is pinned with on
   every compass/map indicator (WorldMapReturn.js, WorldMap.js). */
.kb-quest-icon { position: absolute; top: 8px; left: 10px;
  background-image: url('img/system/IconSet.png'); image-rendering: pixelated;
  border-radius: 5px; background-color: rgba(43,16,8,0.55);
  outline: 2px solid var(--marker, #7a4d24); box-shadow: 0 2px 4px rgba(0,0,0,0.4); }
.kb-card-title { display: block; font-size: 1.02rem; font-weight: bold; line-height: 1.2; margin-bottom: 8px; }
.kb-card-giver { display: block; font-size: 0.85rem; font-style: italic; opacity: 0.8; margin-bottom: 8px; }
.kb-card-reward { display: block; font-size: 0.92rem; font-weight: bold; color: #5d3a00; }
.kb-card-meta { display: block; font-size: 0.82rem; color: #444; margin-top: 6px; line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3;
  line-clamp: 3; -webkit-box-orient: vertical; }
.kb-diff { display: flex; gap: 2px; margin-top: 6px; }
/* Difficulty as IconSet star (icon 87), same plate the quest board uses. */
.kb-star { width: 18px; height: 18px; flex: 0 0 18px;
  background-image: url('img/system/IconSet.png'); background-size: 288px auto;
  background-position: -126px -90px; image-rendering: pixelated; }
.kb-progress { margin-top: 8px; }
.kb-progress-track { height: 7px; background: rgba(43,16,8,0.22); border: 1px solid rgba(43,16,8,0.45);
  border-radius: 4px; overflow: hidden; }
.kb-progress-fill { height: 100%; background: linear-gradient(90deg, #7a4d24, #b8860b); }
.kb-progress-label { display: block; margin-top: 3px; font-size: 0.78rem; font-weight: bold; color: #5d3a00; }
.kb-checklist { font-size: 1.15rem; line-height: 1.6; margin: 8px 0; }
.kb-check-row { padding: 2px 0; }
.kb-check-row.done { color: #3e6b2f; }
.kb-check-row.current { font-weight: bold; }
.kb-check-mark { display: inline-block; width: 1.5em; color: #58180d; }
.kb-check-count { font-weight: bold; color: #5d3a00; }
.kb-check-order { margin-top: 6px; font-style: italic; font-size: 1rem; opacity: 0.75; }
.kb-urgent { position: absolute; top: 34px; right: -10px; padding: 2px 13px; font-size: 0.76rem;
  font-weight: bold; letter-spacing: 1px; color: #fff; background: #a2242f;
  transform: rotate(8deg); box-shadow: 1px 2px 4px rgba(0,0,0,0.4); }
.kb-seal { position: absolute; right: 12px; bottom: 12px; width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #f5ebd0; font-size: 1rem; font-weight: bold;
  background: var(--seal, #8b263e); box-shadow: 0 2px 4px rgba(0,0,0,0.5);
  border: 2px solid rgba(245,235,208,0.6); }
.kb-resolved-stamp { position: absolute; left: 14px; bottom: 14px; padding: 2px 10px;
  font-size: 0.8rem; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;
  color: #8b263e; border: 2px solid #8b263e; border-radius: 3px; opacity: 0.7;
  transform: rotate(-6deg); }
.kb-resolved-stamp.failed { color: #41414d; border-color: #41414d; }

/* Detail parchment: full screen, text held in a centred reading column, the
   same sheet the quest board opens for a contract. */
#kb-detail-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh;
  z-index: 20; background: rgba(20,10,4,0.68); display: flex; align-items: stretch; justify-content: stretch; }
#kb-board-overlay.kb-app-mode #kb-detail-backdrop { position: absolute; width: 100%; height: 100%; }
#kb-detail-panel { flex: 1 1 auto; width: 100%; height: 100%; overflow-y: auto; position: relative;
  box-sizing: border-box; display: block;
  background: linear-gradient(160deg, #faf2d3 0%, #f0e4c0 60%, #e6d4aa 100%);
  border: 14px solid #58180d;
  box-shadow: inset 0 0 0 3px #a8814f, inset 0 0 120px rgba(139,90,40,0.3);
  color: #2b251d; }
#kb-detail-panel::-webkit-scrollbar { width: 14px; }
#kb-detail-panel::-webkit-scrollbar-track { background: rgba(88,24,13,0.12); }
#kb-detail-panel::-webkit-scrollbar-thumb { background: #a8814f; border-radius: 7px; }
.kb-detail-page { max-width: 1180px; margin: 0 auto; padding: 46px 60px 60px; }
.kb-detail-header { margin: 0 0 8px; font-size: 2.3rem; font-weight: bold; line-height: 1.15;
  color: #58180d; border-bottom: 3px double #805d3f; padding-bottom: 12px;
  font-family: "Lora", "IM Fell English", serif; background: none; }
.kb-detail-giver { font-style: italic; font-size: 1.15rem; margin: 12px 0 26px; opacity: 0.85; }
.kb-detail-body { font-size: 1.3rem; line-height: 1.65; margin-bottom: 24px; text-align: justify; }
.kb-detail-body::first-letter { font-size: 2.6rem; font-weight: bold; color: #58180d;
  float: left; line-height: 0.9; padding: 4px 8px 0 0; }
.kb-detail-sec { font-size: 1.05rem; font-weight: bold; text-transform: uppercase; letter-spacing: 3px;
  color: #805d3f; border-bottom: 1px solid #805d3f; margin: 30px 0 12px; }
.kb-detail-steps { font-size: 1.2rem; white-space: pre-line; margin: 8px 0; line-height: 1.6; }
.kb-detail-line { font-size: 1.15rem; margin: 5px 0; }
.kb-detail-line.warn { color: #8b263e; font-weight: bold; }
.kb-upd-row { border-bottom: 1px dotted rgba(88,24,13,0.35); padding: 10px 0 12px; }
.kb-upd-row:last-child { border-bottom: none; }
.kb-upd-date { display: block; font-size: 0.9rem; font-weight: bold; color: #805d3f; margin-bottom: 4px; }
.kb-upd-text { font-size: 1.15rem; line-height: 1.55; margin: 0; white-space: pre-wrap; }
.kb-detail-btns { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 40px; }
.kb-detail-close { display: inline-block; padding: 14px 40px;
  font-size: 1.2rem; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 2px;
  background: #5d3a1c; color: #f5ebd0; border: 1px solid #2b1008; border-radius: 3px;
  font-family: "Lora", "IM Fell English", serif; }
.kb-detail-close:hover { background: #7a4d24; }
.kb-detail-close.kb-detail-map { background: #1f4e79; }
.kb-detail-close.kb-detail-map:hover { background: #2b6aa3; }
`;

    // Helper function to get date string with year 2001
    function getFixedDateString() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        return `${month}/${day}/2001, ${hours}:${minutes}:${seconds}`;
    }

    // Notification Manager
    class NotificationManager {
        static initialize() {
            this._notifications = [];
            this._sprite = null;
        }

        static addNotification(text, type = 'info') {
            // Unified top-left notification system: route through ParchmentToast
            // whenever it is available (the legacy sprite stack is the fallback).
            if (window.ParchmentToast) {
                window.ParchmentToast.show(text, {
                    severity: type === 'update' ? 'warning' : 'info',
                    duration: 180
                });
                return;
            }
            this._notifications.push({
                text: text,
                type: type,
                duration: notificationDuration,
                opacity: 0,
                targetOpacity: 255,
                y: 0
            });
        }

        static update() {
            if (!this._sprite) return;

            let yOffset = 10;
            for (let i = this._notifications.length - 1; i >= 0; i--) {
                const notif = this._notifications[i];

                // Update opacity
                if (notif.opacity < notif.targetOpacity) {
                    notif.opacity = Math.min(notif.opacity + 15, notif.targetOpacity);
                }

                // Update duration and fade out
                notif.duration--;
                if (notif.duration < 30) {
                    notif.targetOpacity = 0;
                    notif.opacity = Math.max(notif.opacity - 10, 0);
                }

                // Remove if fully faded
                if (notif.duration <= 0 && notif.opacity <= 0) {
                    this._notifications.splice(i, 1);
                    continue;
                }

                // Update position
                notif.y = yOffset;
                yOffset += 50;
            }

            this.drawNotifications();
        }

        static drawNotifications() {
            if (!this._sprite || !this._sprite.bitmap) return;

            const bitmap = this._sprite.bitmap;
            if (this._notifications.length === 0) {
                // Nothing to show: clear once, then skip redundant full-screen clears
                if (this._blank) return;
                bitmap.clear();
                this._blank = true;
                return;
            }
            this._blank = false;
            bitmap.clear();

            for (const notif of this._notifications) {
                bitmap.paintOpacity = notif.opacity;
                bitmap.fontSize = 20;
                bitmap.fontBold = true;

                // Measure text
                const textWidth = bitmap.measureTextWidth(notif.text) + 40;
                const textHeight = 36;

                // Draw notification box with black background
                const x = 10;
                const y = notif.y;

                // Black background
                bitmap.fillRect(x, y, textWidth, textHeight, 'rgba(0, 0, 0, 0.85)');

                // Colored border based on type
                const borderColor = notif.type === 'quest' ? '#4CAF50' : '#2196F3';
                bitmap.strokeRect(x, y, textWidth, textHeight, borderColor, 2);

                // Draw text
                bitmap.textColor = '#ffffff';
                bitmap.drawText(notif.text, x + 20, y + 6, textWidth - 40, textHeight, 'left');
            }

            bitmap.paintOpacity = 255;
        }

        static createSprite(parent) {
            this._sprite = new Sprite();
            this._blank = true;
            this._sprite.bitmap = new Bitmap(Graphics.width, Graphics.height);
            this._sprite.z = 1000;
            parent.addChild(this._sprite);
        }

        static destroySprite() {
            if (this._sprite) {
                if (this._sprite.parent) {
                    this._sprite.parent.removeChild(this._sprite);
                }
                this._sprite.destroy();
                this._sprite = null;
            }
        }
    }

    // Data Manager
    class QuestManager {
        static initialize() {
            this._quests = {};
            this._questOrder = {
                todo: [],
                inProgress: [],
                done: [],
                failed: []
            };
            this._colorIndex = 0;
        }

        // `meta` is optional contract detail (giver, reward, terms, deadline,
        // difficulty, lore body) supplied by ProceduralQuestSystem. Hand-authored
        // quests pass nothing and simply render without those lines.
        static addQuest(id, title, description, meta) {
            if (this._quests[id]) return false;

            this._quests[id] = {
                id: id,
                title: title,
                column: 'todo',
                color: NOTE_COLORS[this._colorIndex % NOTE_COLORS.length],
                meta: meta || null,
                updates: [{
                    text: description,
                    date: getFixedDateString()
                }]
            };

            this._colorIndex++;
            this._questOrder.todo.push(id);

            // Add notification
            NotificationManager.addNotification(T('Kanban.notify.newQuest', { title: title }), 'quest');

            return true;
        }

        static updateQuest(id, updateText) {
            let quest = this._quests[id];

            // If quest doesn't exist, create it with ??? title
            if (!quest) {
                this._quests[id] = {
                    id: id,
                    title: '???',
                    column: 'todo',
                    color: NOTE_COLORS[this._colorIndex % NOTE_COLORS.length],
                    updates: []
                };
                this._colorIndex++;
                this._questOrder.todo.push(id);
                quest = this._quests[id];

                // Add notification for new mysterious quest
                NotificationManager.addNotification(T('Kanban.notify.newQuestUnknown'), 'quest');
            }

            quest.updates.unshift({
                text: updateText,
                date: getFixedDateString()
            });

            // Automatically move from todo to inProgress when updated
            if (quest.column === 'todo') {
                this.moveQuest(id, 'inProgress');
            }

            // Add notification
            NotificationManager.addNotification(T('Kanban.notify.questUpdated', { title: quest.title }), 'update');

            return true;
        }

        static completeQuest(id) {
            if (!this._quests[id]) return false;

            this.moveQuest(id, 'done');
            this._quests[id].updates.unshift({
                text: T('Kanban.questCompleted'),
                date: getFixedDateString()
            });

            // Add notification
            NotificationManager.addNotification(T('Kanban.notify.questComplete', { title: this._quests[id].title }), 'quest');

            return true;
        }

        static failQuest(id, reasonText) {
            const quest = this._quests[id];
            if (!quest) return false;
            quest.updates.unshift({
                text: reasonText || T('Kanban.questFailed'),
                date: getFixedDateString()
            });
            this.moveQuest(id, 'failed');
            NotificationManager.addNotification(T('Kanban.notify.questFailed', { title: quest.title }), 'update');
            return true;
        }

        // Live objective state for a note: { done, total, mode, status, steps:
        // [{ text, done, current, detail }] }. Written by ProceduralQuestSystem
        // every time an objective moves, so the board can show partial progress
        // rather than only the newest log line.
        static setProgress(id, progress) {
            const quest = this._quests[id];
            if (!quest) return false;
            quest.progress = progress || null;
            return true;
        }

        // Merge contract detail into an existing note (used when a quest was
        // created by an update before its board metadata was known).
        static setMeta(id, meta) {
            const quest = this._quests[id];
            if (!quest) return false;
            quest.meta = Object.assign({}, quest.meta || {}, meta || {});
            return true;
        }

        static moveQuest(id, targetColumn) {
            const quest = this._quests[id];
            if (!quest) return false;

            // Remove from current column
            const currentCol = this._questOrder[quest.column];
            const index = currentCol.indexOf(id);
            if (index > -1) currentCol.splice(index, 1);

            // Add to target column
            this._questOrder[targetColumn].push(id);
            quest.column = targetColumn;
            return true;
        }

        static getQuest(id) {
            return this._quests[id];
        }

        static getQuestsInColumn(column) {
            return this._questOrder[column].map(id => this._quests[id]);
        }

        // Is this quest one the player is actively working on? The In Progress
        // column is the player's own tracker (cards start in To Do and are moved
        // by hand or by the first progress update), so other systems, the world
        // map markers above all, use it to decide what to advertise.
        static isInProgress(id) {
            const quest = this._quests[id];
            return !!quest && quest.column === 'inProgress';
        }

        static save() {
            const saveData = {
                quests: this._quests,
                questOrder: this._questOrder,
                colorIndex: this._colorIndex
            };
            return saveData;
        }

        static load(saveData) {
            if (saveData) {
                this._quests = saveData.quests || {};
                this._questOrder = saveData.questOrder || { todo: [], inProgress: [], done: [], failed: [] };
                // Migration: saves from before the Failed column existed.
                if (!this._questOrder.failed) this._questOrder.failed = [];
                this._colorIndex = saveData.colorIndex || 0;
            }
        }
    }



    if (window.HypernetOS) {
        window.HypernetOS.registerApp({
            id: 'app-kanban-quest',
            name: T('Kanban.appName'),
            icon: 186,
            launchFn: function() {
                if (window.HypernetKanbanApp) {
                    window.HypernetKanbanApp.launch();
                } else {
                    SceneManager.push(Scene_KanbanQuest);
                }
            },
            desktopShortcut: true
        });
    }

    // --- HypernetKanbanApp ---
    window.HypernetKanbanApp = {
        appInstance: null,
        win: null,
        launch: function(params) {
            if (!window.HypernetWindowManager) return;
            
            if (!this.win || !document.getElementById('app-kanban-quest')) {
                this.win = window.HypernetWindowManager.createWindow({
                    id: 'app-kanban-quest',
                    title: T('Kanban.appName'),
                    icon: 186,
                    width: 950,
                    height: 600,
                    contentHTML: '<div id="kanban-quest-content" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: #ece9d8;"></div>'
                });

                this.appInstance = new Scene_KanbanQuest();
                this.appInstance._isAppMode = true;
                this.appInstance.create();
                
                this.win.addEventListener('hypernet-closed', () => {
                    if (this.appInstance) {
                        this.appInstance.terminate();
                        this.appInstance = null;
                    }
                    this.win = null;
                });
            } else {
                window.HypernetWindowManager.bringToFront(this.win);
            }
        },
        update: function() {
            if (this.appInstance && this.win) {
                if (this.win.classList.contains('active')) {
                    this.appInstance.update();
                }
            }
        }
    };

    // Monkeypatch Scene_HypernetOS to update Task Master
    const _Scene_HypernetOS_update = window.Scene_HypernetOS ? window.Scene_HypernetOS.prototype.update : null;
    if (_Scene_HypernetOS_update) {
        window.Scene_HypernetOS.prototype.update = function() {
            _Scene_HypernetOS_update.call(this);
            if (window.HypernetKanbanApp) window.HypernetKanbanApp.update();
        };
    }

    // Scene for Kanban Quest Log, D&D parchment board (HTML overlay)
    class Scene_KanbanQuest extends Scene_MenuBase {
        // Opened from a world-map marker: land on that quest's sheet directly.
        prepare(questId) {
            this._focusQuestId = questId || null;
        }

        create() {
            super.create();
            this._selectedQuest = null;
            this._focusCol      = 0;
            this._focusRow      = 0;
            this._el            = null;
            if (this._focusQuestId) {
                const COLS = ['todo', 'inProgress', 'done', 'failed'];
                for (let ci = 0; ci < COLS.length; ci++) {
                    const list = QuestManager.getQuestsInColumn(COLS[ci]);
                    const ri = list.findIndex(q => q && q.id === this._focusQuestId);
                    if (ri >= 0) {
                        this._focusCol = ci;
                        this._focusRow = ri;
                        this._selectedQuest = list[ri];
                        break;
                    }
                }
            }
            this._buildDOM();
        }

        popScene() {
            if (this._isAppMode) {
                if (window.HypernetKanbanApp && window.HypernetKanbanApp.win) {
                    window.HypernetWindowManager.closeWindow(window.HypernetKanbanApp.win);
                }
                return;
            }
            super.popScene();
        }

        terminate() {
            if (this._el) { this._el.remove(); this._el = null; }
            if (!this._isAppMode) super.terminate();
        }

        _buildDOM() {
            const parent = this._isAppMode
                ? document.getElementById('kanban-quest-content')
                : document.body;
            if (!parent) return;

            const el = document.createElement('div');
            el.id = 'kb-board-overlay';
            if (this._isAppMode) el.classList.add('kb-app-mode');
            const style = document.createElement('style');
            style.textContent = STYLE;
            el.appendChild(style);
            parent.appendChild(el);
            this._el = el;
            this._refresh();

            // Right click acts as cancel (handled in update() through
            // TouchInput.isCancelled, like every other menu); all this has to do
            // is make sure the browser menu never comes up.
            el.addEventListener('contextmenu', ev => ev.preventDefault());
            el.addEventListener('mouseover', ev => {
                const card = ev.target.closest('.kb-card');
                if (!card || this._selectedQuest) return;
                const col = parseInt(card.dataset.col);
                const row = parseInt(card.dataset.row);
                if (!isNaN(col) && !isNaN(row)) {
                    this._focusCol = col;
                    this._focusRow = row;
                    this._updateHighlight();
                }
            });
            el.addEventListener('click', ev => {
                if (ev.target.closest('.kb-board-back')) {
                    // Mirrors the Esc key: an open sheet closes first, then the log.
                    if (this._selectedQuest) this._closeDetail();
                    else { SoundManager.playCancel(); this.popScene(); }
                    return;
                }
                if (ev.target.closest('.kb-detail-map')) { this._showOnMap(); return; }
                if (ev.target.closest('.kb-detail-close')) { this._closeDetail(); return; }
                // Click on the dimmed backdrop (but not the panel itself) closes the detail
                if (ev.target.id === 'kb-detail-backdrop') { this._closeDetail(); return; }
                const card = ev.target.closest('.kb-card');
                if (card) this._openDetail(QuestManager.getQuest(card.dataset.id));
            });
        }

        // One post-it, pinned. Colour, tilt, pin and wax seal are all derived
        // from the quest id so a note always looks like itself, exactly the way
        // QuestBoardUI derives them for the offers on the cork board.
        _cardHTML(q, ci, ri, colId, useIt) {
            const focused = !this._selectedQuest && this._focusCol === ci && this._focusRow === ri;
            return buildNoteHTML(q, useIt, {
                colId,
                focused,
                attrs: `data-id="${esc(q.id)}" data-col="${ci}" data-row="${ri}"`, // i18n-ignore: DOM data attributes
                progressHTML: this._progressBarHTML(q, useIt),
            });
        }

        // Partial progress on the note itself: objectives cleared out of total,
        // plus the live counter of whichever objective is being worked on
        // ("2/5 statues"). Absent for quests that carry no objective data.
        _progressBarHTML(q, useIt) {
            const p = q.progress;
            if (!p || !p.total) return '';
            const done = Math.max(0, Math.min(p.total, p.done || 0));
            const pct = Math.round((done / p.total) * 100);
            const current = Array.isArray(p.steps) ? p.steps.find(s => s.current) : null;
            const counter = (current && current.detail) ? ' · ' + esc(current.detail) : '';
            const label = p.status === 'claimable'
                ? (T('Kanban.readyToCollect'))
                : `${done}/${p.total} ${T('Kanban.objectives')}${counter}`;
            return `<div class="kb-progress">
              <div class="kb-progress-track"><div class="kb-progress-fill" style="width:${pct}%"></div></div>
              <span class="kb-progress-label">${label}</span>
            </div>`;
        }

        // The objective checklist, with a mark per objective and its live counter.
        _checklistHTML(q, useIt) {
            const p = q.progress;
            if (!p || !Array.isArray(p.steps) || !p.steps.length) return '';
            const rows = p.steps.map(s => {
                const mark = s.done ? '&#10004;' : (s.current ? '&#10148;' : '&#8226;');
                const cls = s.done ? ' done' : (s.current ? ' current' : '');
                const detail = s.detail ? ` <span class="kb-check-count">${esc(s.detail)}</span>` : '';
                return `<div class="kb-check-row${cls}"><span class="kb-check-mark">${mark}</span>${esc(s.text)}${detail}</div>`;
            }).join('');
            const order = p.total > 1
                ? `<div class="kb-check-order">${p.mode === 'par'
                    ? (T('Kanban.anyOrder'))
                    : (T('Kanban.inOrder'))}</div>`
                : '';
            return `<div class="kb-detail-sec">${T('Kanban.progress')}</div>
              <div class="kb-checklist">${rows}${order}</div>`;
        }

        // The full contract sheet: the same parchment the quest board opens, with
        // the update log appended underneath.
        _detailHTML(useIt) {
            const q = this._selectedQuest;
            if (!q) return '';
            const meta = q.meta || {};
            const terms = Array.isArray(meta.terms) ? meta.terms : [];
            const updates = q.updates.map(u => `
              <div class="kb-upd-row">
                <span class="kb-upd-date">${esc(u.date)}</span>
                <p class="kb-upd-text">${esc(u.text)}</p>
              </div>`).join('');
            const termsHTML = terms.map(line => {
                const warn = /Penalty|Penale|prosecuted|perseguito|cost|Costo/i.test(line);
                return `<div class="kb-detail-line${warn ? ' warn' : ''}">${esc(line)}</div>`;
            }).join('');

            return `<div id="kb-detail-backdrop"><div id="kb-detail-panel"><div class="kb-detail-page">
              <div class="kb-detail-header">${esc(q.title)}</div>
              ${meta.giver ? `<div class="kb-detail-giver">${T('Kanban.postedBy')}${esc(meta.giver)}</div>` : ''}
              ${meta.body ? `<div class="kb-detail-body">${esc(meta.body)}</div>` : ''}
              ${this._checklistHTML(q, useIt)}
              ${(!q.progress && meta.objectives) ? `
                <div class="kb-detail-sec">${T('Kanban.objectives2')}</div>
                <div class="kb-detail-steps">${esc(meta.objectives)}</div>` : ''}
              ${termsHTML ? `
                <div class="kb-detail-sec">${T('Kanban.terms')}</div>
                ${termsHTML}` : ''}
              <div class="kb-detail-sec">${T('Kanban.log')}</div>
              <div class="kb-detail-log">${updates}</div>
              <div class="kb-detail-btns">
                ${this._mapButtonHTML(useIt)}
                <button class="kb-detail-close">${T('Kanban.close')}</button>
              </div>
            </div></div></div>`;
        }

        // The world tile the open quest points at. A still-active procedural
        // contract is asked for its live next objective; anything else falls back
        // to the location snapshotted when the note was pinned.
        _detailLocation() {
            const q = this._selectedQuest;
            if (!q) return null;
            const api = window.ProceduralQuests;
            if (api && typeof api.questLocation === 'function' && typeof api.state === 'function') {
                try {
                    const live = api.state().active[q.id];
                    if (live) {
                        const loc = api.questLocation(live);
                        if (loc) return loc;
                    }
                } catch (e) { }
            }
            const snap = q.meta && q.meta.location;
            return (snap && snap.wx != null) ? snap : null;
        }

        _mapButtonHTML(useIt) {
            const loc = this._detailLocation();
            if (!loc) return '';
            return `<button class="kb-detail-close kb-detail-map">${T('Kanban.showOnMapAt', { x: loc.wx, y: loc.wy })}</button>`;
        }

        // Leave the log and open the world map (the M map) centred on the site.
        _showOnMap() {
            const loc = this._detailLocation();
            if (!loc) return;
            if (!window.WorldMapView) { SoundManager.playBuzzer(); return; }
            window.WorldMapView.requestFocusAt(loc.wx, loc.wy);
            SoundManager.playOk();
            this._selectedQuest = null;
            if (this._isAppMode) {
                // Inside HypernetOS: just close the window, the map opens when the
                // player leaves the OS.
                this.popScene();
                return;
            }
            // Straight to the map rather than popScene: only Scene_Map can carry
            // the request out, and the log is usually opened from the pause menu.
            SceneManager.goto(Scene_Map);
        }

        _refresh() {
            if (!this._el) return;
            const useIt = ConfigManager.language === 'it';
            const COLS  = ['todo', 'inProgress', 'done', 'failed'];
            const TITLES = [
                T('Kanban.toDo'),
                T('Kanban.inProgress'),
                T('Kanban.done'),
                T('Kanban.failed'),
            ];

            const colsHTML = COLS.map((colId, ci) => {
                const quests = QuestManager.getQuestsInColumn(colId);
                const cards  = quests.map((q, ri) => this._cardHTML(q, ci, ri, colId, useIt)).join('');
                const body = cards || `<div class="kb-empty-col">${T('Kanban.noQuests')}</div>`;
                return `<div class="kb-column">
                  <div class="kb-col-header">
                    <span class="kb-col-title">${TITLES[ci]}</span>
                    <span class="kb-col-count">${quests.length}</span>
                  </div>
                  <div class="kb-cards-wrap">${body}</div>
                </div>`;
            });

            // Replace only the rendered layers: the injected <style> child has to
            // survive every refresh.
            this._el.querySelectorAll('#kb-board-header, #kb-columns, #kb-detail-backdrop')
                .forEach(n => n.remove());
            this._el.insertAdjacentHTML('beforeend', `
              <div id="kb-board-header">
                <div class="back-button kb-board-back">${T('Kanban.back')}</div>
                <span class="kb-board-title">${T('Kanban.questLog')}</span>
              </div>
              <div id="kb-columns">
                ${colsHTML.join('<div class="kb-col-divider"></div>')}
              </div>
              ${this._detailHTML(useIt)}`);
        }

        _openDetail(quest) {
            if (!quest) return;
            this._selectedQuest = quest;
            SoundManager.playOk();
            this._refresh();
        }

        _closeDetail() {
            this._selectedQuest = null;
            SoundManager.playCancel();
            this._refresh();
        }

        _updateHighlight() {
            if (!this._el) return;
            this._el.querySelectorAll('.kb-card').forEach(el => {
                const isFocused = parseInt(el.dataset.col) === this._focusCol
                    && parseInt(el.dataset.row) === this._focusRow
                    && !this._selectedQuest;
                el.classList.toggle('focused', isFocused);
            });
            const sel = this._el.querySelector('.kb-card.focused');
            if (sel) sel.scrollIntoView({ block: 'nearest' });
        }

        update() {
            super.update();
            if (!this._el) return;

            // Esc, the controller's B button and a right click all read as cancel.
            const cancelled = Input.isTriggered('cancel') || TouchInput.isCancelled();

            if (this._selectedQuest) {
                if (cancelled) this._closeDetail();
                else if (Input.isTriggered('shift')) this._showOnMap();
                return;
            }

            const COLS = ['todo', 'inProgress', 'done', 'failed'];
            let moved = false;

            if (Input.isRepeated('down') || Input.isRepeated('s')) {
                const len = QuestManager.getQuestsInColumn(COLS[this._focusCol]).length;
                if (this._focusRow < len - 1) { this._focusRow++; moved = true; }
            } else if (Input.isRepeated('up') || Input.isRepeated('w')) {
                if (this._focusRow > 0) { this._focusRow--; moved = true; }
            } else if (Input.isRepeated('left') || Input.isRepeated('a')) {
                if (Input.isPressed('shift')) {
                    this._moveCard(-1, COLS);
                } else if (this._focusCol > 0) {
                    this._focusCol--;
                    moved = true;
                }
            } else if (Input.isRepeated('right') || Input.isRepeated('d')) {
                if (Input.isPressed('shift')) {
                    this._moveCard(1, COLS);
                } else if (this._focusCol < COLS.length - 1) {
                    this._focusCol++;
                    moved = true;
                }
            } else if (Input.isTriggered('ok')) {
                const q = QuestManager.getQuestsInColumn(COLS[this._focusCol])[this._focusRow];
                if (q) this._openDetail(q);
            } else if (cancelled) {
                SoundManager.playCancel();
                this.popScene();
            }

            if (moved) {
                const len = QuestManager.getQuestsInColumn(COLS[this._focusCol]).length;
                this._focusRow = Math.max(0, Math.min(this._focusRow, len - 1));
                SoundManager.playCursor();
                this._updateHighlight();
            }
        }

        _moveCard(dir, COLS) {
            const colId     = COLS[this._focusCol];
            const quests    = QuestManager.getQuestsInColumn(colId);
            const quest     = quests[this._focusRow];
            const targetIdx = this._focusCol + dir;
            // Cards can only be shuffled between To Do and In Progress by hand.
            if (!quest || colId === 'done' || colId === 'failed' || targetIdx < 0 || targetIdx > 1) return;
            const targetCol = COLS[targetIdx];
            QuestManager.moveQuest(quest.id, targetCol);
            this._focusCol = targetIdx;
            this._focusRow = QuestManager.getQuestsInColumn(targetCol).length - 1;
            SoundManager.playOk();
            this._refresh();
        }
    }

    // Export Scene for external use
    window.Scene_KanbanQuest = Scene_KanbanQuest;

    // Programmatic quest API for other plugins (ProceduralQuestSystem etc.):
    // window.KanbanQuest.addQuest(id, title, desc) / updateQuest(id, text) /
    // completeQuest(id) / moveQuest(id, column) / getQuest(id).
    window.KanbanQuest = QuestManager;

    // The exact post-it the board would show for this quest, plus the stylesheet
    // it needs, so other scenes (the world map hover preview) render the same note
    // rather than an imitation of it.
    QuestManager.notePreview = function (questId) {
        const quest = this.getQuest(questId);
        if (!quest) return null;
        const useIt = ConfigManager.language === 'it';
        const scene = new Scene_KanbanQuest();
        let progressHTML = '';
        try { progressHTML = scene._progressBarHTML(quest, useIt); } catch (e) { }
        return {
            css: STYLE,
            html: buildNoteHTML(quest, useIt, { flat: true, progressHTML }),
        };
    };

    // Open the log with one quest already showing its full sheet.
    QuestManager.openAt = function (questId) {
        if (!this.getQuest(questId)) return false;
        SceneManager.push(Scene_KanbanQuest);
        SceneManager.prepareNextScene(questId);
        return true;
    };

    // The stable colour/icon a quest is pinned with everywhere it is pointed
    // to on a map: the board card, the world-map diamonds (WorldMap.js) and the
    // in-world compass arrows (WorldMapReturn.js). Same id, same answer, always.
    QuestManager.colorFor = markerColorFor;
    QuestManager.iconFor = markerIconFor;

    // Every quest the player is actively chasing, reduced to a world-map tile
    // (map 315 / vars 43-44 space) plus the colour/icon that identify it. This
    // is the single feed every map/compass marker draws from:
    //  - ProceduralQuestSystem's own questMarkers() supplies its (possibly
    //    multi-step) procedural contracts, already limited to the In Progress
    //    column by its own isTrackedOnBoard() gate;
    //  - any OTHER quest sitting In Progress on this board that carries its own
    //    meta.location (a hand-authored quest can set one via setMeta) is
    //    picked up too, so the compass isn't procedural-quest-only.
    QuestManager.activeMarkers = function () {
        const out = [];
        const seen = new Set();
        const api = window.ProceduralQuests;
        if (api && typeof api.questMarkers === 'function') {
            try {
                for (const m of api.questMarkers()) {
                    if (m.wx == null || m.wy == null) continue;
                    out.push({
                        qid: m.qid, wx: m.wx, wy: m.wy,
                        title: m.title, label: m.label, objective: m.objective,
                        step: m.step, stepCount: m.stepCount, multi: m.multi,
                        color: this.colorFor(m.qid), icon: this.iconFor(m.qid),
                    });
                    seen.add(m.qid);
                }
            } catch (e) { }
        }
        for (const id of this._questOrder.inProgress) {
            if (seen.has(id)) continue;
            const q = this._quests[id];
            const loc = q && q.meta && q.meta.location;
            if (!loc || loc.wx == null || loc.wy == null) continue;
            out.push({
                qid: id, wx: loc.wx, wy: loc.wy,
                title: q.title, label: loc.label || q.title, objective: loc.label || q.title,
                step: 1, stepCount: 1, multi: false,
                color: this.colorFor(id), icon: this.iconFor(id),
            });
        }
        return out;
    };

    // Menu Integration
    const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
    Window_MenuCommand.prototype.addOriginalCommands = function () {
        _Window_MenuCommand_addOriginalCommands.call(this);
        this.addCommand(menuCommand, 'questLog', true, 186);
    };

    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function () {
        _Scene_Menu_createCommandWindow.call(this);
        this._commandWindow.setHandler('questLog', this.commandQuestLog.bind(this));
    };

    Scene_Menu.prototype.commandQuestLog = function () {
        SceneManager.push(Scene_KanbanQuest);
    };


    // Initialize WASD input mapping
    const _Input_initialize = Input.initialize;
    Input.initialize = function () {
        _Input_initialize.call(this);
        // Add WASD mappings
        this.keyMapper[87] = 'w'; // W
        this.keyMapper[65] = 'a'; // A
        this.keyMapper[83] = 's'; // S
        this.keyMapper[68] = 'd'; // D
    };

    const _Input_shouldPreventDefault = Input._shouldPreventDefault;
    Input._shouldPreventDefault = function (keyCode) {
        // Prevent default for WASD keys
        if (keyCode === 87 || keyCode === 65 || keyCode === 83 || keyCode === 68) {
            return true;
        }
        return _Input_shouldPreventDefault.call(this, keyCode);
    };

    // Plugin Commands
    PluginManager.registerCommand(pluginName, 'addQuest', args => {
        QuestManager.addQuest(args.questId, args.questTitle, args.questDescription);
    });

    PluginManager.registerCommand(pluginName, 'updateQuest', args => {
        QuestManager.updateQuest(args.questId, args.updateText);
    });

    PluginManager.registerCommand(pluginName, 'completeQuest', args => {
        QuestManager.completeQuest(args.questId);
    });

    PluginManager.registerCommand(pluginName, 'openQuestLog', args => {
        if (window.HypernetOS && SceneManager._scene instanceof Scene_HypernetOS) {
            if (window.HypernetKanbanApp) {
                window.HypernetKanbanApp.launch();
            } else {
                SceneManager.push(Scene_KanbanQuest);
            }
        } else {
            SceneManager.push(Scene_KanbanQuest);
        }
    });

    // Notification System Integration
    const _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function () {
        _Scene_Map_createDisplayObjects.call(this);
        NotificationManager.createSprite(this);
    };

    const _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function () {
        NotificationManager.destroySprite();
        _Scene_Map_terminate.call(this);
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        NotificationManager.update();
    };

    // Save/Load Integration
    const _DataManager_createGameObjects = DataManager.createGameObjects;
    DataManager.createGameObjects = function () {
        _DataManager_createGameObjects.call(this);
        QuestManager.initialize();
        NotificationManager.initialize();
    };

    const _DataManager_makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function () {
        const contents = _DataManager_makeSaveContents.call(this);
        contents.kanbanQuests = QuestManager.save();
        return contents;
    };

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        QuestManager.load(contents.kanbanQuests);
    };

    // Initialize on new game
    const _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        _DataManager_setupNewGame.call(this);
        QuestManager.initialize();
        NotificationManager.initialize();
    };

    // Add this with the other Plugin Commands (around line 1074)
    PluginManager.registerCommand(pluginName, 'clearAllQuests', args => {
        QuestManager.initialize();
    });

})();