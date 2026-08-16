/*:
 * @target MZ
 * @plugindesc v1.0.0 Scenographic quest board: cork board of procedural post-it offers (ProceduralQuestSystem front-end). [Claude]
 * @author Hypernet
 *
 * @help QuestBoardUI.js
 *
 * The player-facing notice board for ProceduralQuestSystem.js: a wooden cork
 * board covered in pinned, rotated post-it notes, one per procedural offer.
 * Clicking (or OK) opens the full parchment with the generated lore text and
 * the complete contract terms (reward or ???, upfront cost, advance,
 * deadline, penalty, breach bounty, faction effects) BEFORE accepting.
 *
 * A second tab lists signed contracts: progress, countdowns, reward
 * collection for claimable quests and abandoning (which triggers the failure
 * clauses, and says so).
 *
 * Zero setup: an event only needs the openQuestBoard plugin command. The
 * board's daily offers are derived automatically from where it stands.
 *
 * Load AFTER ProceduralQuestSystem.js.
 *
 * @command openQuestBoard
 * @text Open Quest Board
 * @desc Opens the quest board for the current location.
 *
 * @arg boardKey
 * @text Board Key (optional)
 * @desc Override the auto-detected location key (e.g. a Destinations.json name).
 * @type string
 * @default
 */

(() => {
  "use strict";

  const PLUGIN = "QuestBoardUI";

  function PQ() { return window.ProceduralQuests; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  const NOTE_COLORS = ["#faf2d3", "#e6ebd7", "#ebd7d7", "#d7ebeb", "#e9e0f0", "#f0e0e9", "#ebdcd0", "#d2e0db"];
  const SEAL_COLORS = ["#8b263e", "#1f4e79", "#3e6b2f", "#6b4a1f", "#4a2f6b", "#2f6b62", "#7a3b17", "#41414d"];

  function hashStr(s) {
    let h = 0x811c9dc5;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // ==========================================================================
  // Scene
  // ==========================================================================
  class Scene_QuestBoard extends Scene_MenuBase {
    prepare(boardKey) { this._boardKey = boardKey || null; }

    create() {
      super.create();
      this._tab = "offers";        // offers | contracts
      this._focus = 0;
      this._detail = null;          // offer or quest being inspected
      this._detailIsOffer = false;
      this._confirmAbandon = null;  // qid pending abandon confirmation
      this._el = null;

      const api = PQ();
      // Every board on a map is the same board: the engine resolves whatever the
      // event asked for down to this map's single seeded key (an override only
      // survives when it names another real place).
      if (api) {
        this._boardKey = api.resolveBoardKey
          ? api.resolveBoardKey(this._boardKey)
          : (this._boardKey || api.currentBoardKey());
        this._offers = api.offersForBoard(this._boardKey);
        // Courier deliveries and supply readiness resolve on board open.
        api.onBoardOpened(this._boardKey);
      } else {
        this._offers = [];
      }
      this._buildDOM();
    }

    terminate() {
      if (this._el) { this._el.remove(); this._el = null; }
      super.terminate();
    }

    // ---- data ----
    _cards() {
      if (this._tab === "offers") return this._offers;
      const api = PQ();
      return api ? api.activeQuests() : [];
    }

    // ---- DOM ----
    _buildDOM() {
      const el = document.createElement("div");
      el.id = "qb-overlay";
      document.body.appendChild(el);
      this._el = el;
      this._refresh();

      el.addEventListener("click", ev => {
        const t = ev.target;
        if (t.closest("[data-close-detail]")) { this._closeDetail(); return; }
        if (t.id === "qb-detail-backdrop") { this._closeDetail(); return; }
        if (t.closest("[data-show-map]")) { this._showOnMap(); return; }
        const accept = t.closest("[data-accept]");
        if (accept) { this._acceptCurrent(); return; }
        const claim = t.closest("[data-claim]");
        if (claim) { this._claim(claim.dataset.claim); return; }
        const abandon = t.closest("[data-abandon]");
        if (abandon) { this._askAbandon(abandon.dataset.abandon); return; }
        const confirmAb = t.closest("[data-confirm-abandon]");
        if (confirmAb) { this._doAbandon(confirmAb.dataset.confirmAbandon); return; }
        const tab = t.closest("[data-tab]");
        if (tab) { this._switchTab(tab.dataset.tab); return; }
        const card = t.closest("[data-card]");
        if (card) {
          this._focus = Number(card.dataset.card) || 0;
          this._openDetail();
          return;
        }
      });
      // Right click backs out one step, exactly like the cancel button: the open
      // sheet, then a pending confirmation, then the board itself (and it never
      // raises a browser menu).
      el.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        this._back();
      });
      el.addEventListener("mouseover", ev => {
        const card = ev.target.closest("[data-card]");
        if (card && !this._detail) {
          const idx = Number(card.dataset.card) || 0;
          if (idx !== this._focus) { this._focus = idx; this._paintFocus(); }
        }
      });
    }

    _refresh() {
      if (!this._el) return;
      const api = PQ();
      const cards = this._cards();
      this._focus = Math.max(0, Math.min(this._focus, cards.length - 1));

      const offersLabel = T('QuestBoard.offers');
      const contractsLabel = T('QuestBoard.contracts');
      const hint = T('QuestBoard.arrowsMoveOkReadTabSwitchEscClose');

      let cardsHTML = "";
      if (!cards.length) {
        cardsHTML = `<div class="qb-empty">${this._tab === "offers"
          ? T('QuestBoard.nothingButRustyPinsAndOlderRegretsComeBackTo')
          : T('QuestBoard.noSignedContracts')}</div>`;
      } else if (this._tab === "offers") {
        cardsHTML = cards.map((o, i) => this._offerNoteHTML(o, i)).join("");
      } else {
        cardsHTML = cards.map((q, i) => this._contractNoteHTML(q, i)).join("");
      }

      // The board key is a map group or a destination key; the header reads the
      // place's name ("FrozenStation" -> "Frozen Station").
      const boardName = esc(
        (this._boardKey && window.WorkSystem?.destinationName)
          ? window.WorkSystem.destinationName(this._boardKey)
          : (this._boardKey || "?"));

      this._el.querySelectorAll("#qb-header, #qb-tabs, #qb-cards, #qb-detail-backdrop")
        .forEach(n => n.remove());
      this._el.insertAdjacentHTML("beforeend", `
        <div id="qb-header">
          <span id="qb-title">${T('QuestBoard.questBoard')}</span>
          <span id="qb-sub">${boardName}</span>
          <span id="qb-hint">${hint}</span>
        </div>
        <div id="qb-tabs">
          <span class="qb-tab ${this._tab === "offers" ? "active" : ""}" data-tab="offers">${offersLabel} (${this._offers.length})</span>
          <span class="qb-tab ${this._tab === "contracts" ? "active" : ""}" data-tab="contracts">${contractsLabel} (${api ? api.activeQuests().length : 0})</span>
        </div>
        <div id="qb-cards">${cardsHTML}</div>
        ${this._detailHTML()}`);
    }

    _offerNoteHTML(o, i) {
      const api = PQ();
      const rot = ((hashStr(o.qid) % 9) - 4) * 0.9;
      const bg = NOTE_COLORS[hashStr(o.qid + "c") % NOTE_COLORS.length];
      const pin = ["#b03030", "#2f5db0", "#2f8a45", "#a88a1f"][hashStr(o.qid + "p") % 4];
      const seal = SEAL_COLORS[(o.giverFaction != null ? o.giverFaction : hashStr(o.qid)) % SEAL_COLORS.length];
      const sealCh = esc(String(o.giverLabel || "?").replace(/^(a|an|the)\s+/i, "").charAt(0).toUpperCase());
      const stars = '<span class="qb-star"></span>'.repeat(Math.max(0, Math.min(5, o.diff)));
      const stepsNote = o.steps.length > 1
        ? `<div class="qb-note-steps">${o.steps.length} ${T('QuestBoard.objectives')} ${o.stepMode === "seq" ? T('QuestBoard.inOrder') : T('QuestBoard.anyOrder')}</div>` : "";
      return `<div class="qb-note ${i === this._focus && !this._detail ? "focused" : ""}"
        data-card="${i}" style="--rot:${rot}deg; --note-bg:${bg}; --pin:${pin}; --seal:${seal}">
        <div class="qb-pin"></div>
        ${o.deadlineHours ? `<div class="qb-urgent">${T('QuestBoard.urgent')} ${o.deadlineHours}h</div>` : ""}
        <div class="qb-note-title">${esc(o.title)}</div>
        <div class="qb-note-giver">${esc(o.giverLabel)}</div>
        <div class="qb-note-reward">${T('QuestBoard.reward')}${esc(api.rewardText(o, false))}</div>
        ${o.payGold > 0 ? `<div class="qb-note-deadline">${T('QuestBoard.costs')}${esc(api.euros(o.payGold))}</div>` : ""}
        ${stepsNote}
        <div class="qb-diff">${stars}</div>
        <div class="qb-seal">${sealCh}</div>
      </div>`;
    }

    _contractNoteHTML(q, i) {
      const api = PQ();
      const rot = ((hashStr(q.qid) % 7) - 3) * 0.7;
      const bg = NOTE_COLORS[hashStr(q.qid + "c") % NOTE_COLORS.length];
      const claimable = q.status === "claimable";
      const statusText = claimable
        ? T('QuestBoard.readyCollectYourReward')
        : (q.deadlineAt ? T('QuestBoard.timeLeft') + api.hoursLeftText(q.deadlineAt) : T('QuestBoard.inProgress'));
      const supplyBlocked = claimable && q.steps.some(s => s.kind === "supply_items"
        && $gameParty.numItems($dataItems[s.itemId]) < s.qty);
      const btns = [];
      if (claimable && !supplyBlocked) {
        btns.push(`<span class="qb-btn claim" data-claim="${esc(q.qid)}">${T('QuestBoard.collect')} ${esc(api.rewardText(q, false))}</span>`);
      } else if (supplyBlocked) {
        btns.push(`<span class="qb-status">${T('QuestBoard.bringTheGoodsToCollect')}</span>`);
      }
      if (this._confirmAbandon === q.qid) {
        btns.push(`<span class="qb-btn danger" data-confirm-abandon="${esc(q.qid)}">${T('QuestBoard.confirmAbandonPenaltiesApply')}</span>`);
      } else {
        btns.push(`<span class="qb-btn danger" data-abandon="${esc(q.qid)}">${T('QuestBoard.abandon')}</span>`);
      }
      return `<div class="qb-note qb-contract ${i === this._focus && !this._detail ? "focused" : ""}"
        data-card="${i}" style="--rot:${rot}deg; --note-bg:${bg}">
        <div class="qb-pin"></div>
        <div class="qb-note-title">${esc(q.title)}</div>
        <div class="qb-note-giver">${esc(q.giverLabel)}</div>
        <div class="qb-status ${claimable ? "claimable" : "active"}">${esc(statusText)}</div>
        <div class="qb-note-steps">${esc(api.objectiveText(q)).replace(/\n/g, "<br>")}</div>
        <div class="qb-btnrow">${btns.join("")}</div>
      </div>`;
    }

    _detailHTML() {
      if (!this._detail) return "";
      const api = PQ();
      const o = this._detail;
      const terms = api.termsLines(o).map(line => {
        const warn = /Penalty|Penale|prosecuted|perseguito|cost|Costo/i.test(line);
        return `<div class="qb-d-line ${warn ? "warn" : ""}">${esc(line)}</div>`;
      }).join("");
      const steps = esc(api.objectiveText(o));
      const acceptBtn = this._detailIsOffer
        ? `<span class="qb-btn claim" data-accept="1">${o.payGold > 0
          ? T('QuestBoard.signAndPay') + esc(api.euros(o.payGold))
          : T('QuestBoard.signTheContract')}</span>`
        : "";
      const loc = this._detailLocation();
      const mapBtn = loc
        ? `<span class="qb-btn map" data-show-map="1">${T('QuestBoard.showOnMapAt', { x: loc.wx, y: loc.wy })}</span>`
        : "";
      return `<div id="qb-detail-backdrop"><div id="qb-detail"><div class="qb-d-page">
        <h2>${esc(o.title)}</h2>
        <div class="qb-d-giver">${T('QuestBoard.postedBy')}${esc(o.giverLabel)}</div>
        <div class="qb-d-body">${esc(o.body)}</div>
        <div class="qb-d-sec">${T('QuestBoard.objectives2')}</div>
        <div class="qb-d-steps">${steps}</div>
        <div class="qb-d-sec">${T('QuestBoard.terms')}</div>
        ${terms}
        <div class="qb-d-btns">
          ${acceptBtn}
          ${mapBtn}
          <span class="qb-btn" data-close-detail="1">${T('QuestBoard.back')}</span>
        </div>
      </div></div></div>`;
    }

    // The world tile the open sheet points at, or null for contracts with nothing
    // to pin (supply runs, arena bouts, market positions).
    _detailLocation() {
      const api = PQ();
      if (!this._detail || !api || typeof api.questLocation !== "function") return null;
      return api.questLocation(this._detail);
    }

    // Leave the board and open the world map (the M map) centred on the site.
    _showOnMap() {
      const loc = this._detailLocation();
      if (!loc) return; // nothing to point at, and no button was drawn
      if (!window.WorldMapView) {
        SoundManager.playBuzzer();
        return;
      }
      window.WorldMapView.requestFocusAt(loc.wx, loc.wy);
      SoundManager.playOk();
      this._detail = null;
      // Straight to the map rather than popScene: the request can only be
      // carried out by Scene_Map, and the board may sit above a menu stack.
      SceneManager.goto(Scene_Map);
    }

    // Notes wrap freely across the full-screen board, so the column count is
    // whatever the layout ended up with: count the notes sharing the top row.
    _perRow() {
      if (!this._el) return 1;
      const notes = this._el.querySelectorAll("[data-card]");
      if (!notes.length) return 1;
      const top = notes[0].offsetTop;
      let n = 0;
      for (const note of notes) {
        if (note.offsetTop !== top) break;
        n++;
      }
      return Math.max(1, n);
    }

    _paintFocus() {
      if (!this._el) return;
      this._el.querySelectorAll("[data-card]").forEach(n => {
        n.classList.toggle("focused", Number(n.dataset.card) === this._focus && !this._detail);
      });
      const f = this._el.querySelector(".qb-note.focused");
      if (f) f.scrollIntoView({ block: "nearest" });
    }

    // ---- actions ----
    _switchTab(tab) {
      if (tab === this._tab) return;
      this._tab = tab;
      this._focus = 0;
      this._detail = null;
      this._confirmAbandon = null;
      SoundManager.playCursor();
      this._refresh();
    }

    _openDetail() {
      const cards = this._cards();
      const item = cards[this._focus];
      if (!item) return;
      this._detail = item;
      this._detailIsOffer = this._tab === "offers";
      SoundManager.playOk();
      this._refresh();
    }

    _closeDetail() {
      if (!this._detail) return;
      this._detail = null;
      SoundManager.playCancel();
      this._refresh();
    }

    // One step back, whatever is on screen: sheet, pending confirmation, board.
    _back() {
      if (this._detail) { this._closeDetail(); return; }
      if (this._confirmAbandon) {
        this._confirmAbandon = null;
        SoundManager.playCancel();
        this._refresh();
        return;
      }
      this._closeBoard();
    }

    _closeBoard() {
      if (this._closing) return;
      this._closing = true;
      SoundManager.playCancel();
      this.popScene();
    }

    _acceptCurrent() {
      const api = PQ();
      if (!api || !this._detail || !this._detailIsOffer) return;
      const res = api.acceptOffer(this._detail);
      if (!res.ok) {
        SoundManager.playBuzzer();
        if (window.ParchmentToast && res.reason) {
          window.ParchmentToast.show(res.reason, { severity: "warning" });
        }
        return;
      }
      SoundManager.playOk();
      this._detail = null;
      this._offers = api.offersForBoard(this._boardKey);
      this._refresh();
    }

    _claim(qid) {
      const api = PQ();
      if (!api) return;
      const res = api.claimQuest(qid);
      if (!res.ok) {
        SoundManager.playBuzzer();
        if (window.ParchmentToast && res.reason) {
          window.ParchmentToast.show(res.reason, { severity: "warning" });
        }
        return;
      }
      SoundManager.playShop();
      this._refresh();
    }

    _askAbandon(qid) {
      this._confirmAbandon = qid;
      SoundManager.playCursor();
      this._refresh();
    }

    _doAbandon(qid) {
      const api = PQ();
      if (api) api.abandonQuest(qid);
      this._confirmAbandon = null;
      SoundManager.playCancel();
      this._refresh();
    }

    // ---- input ----
    update() {
      super.update();
      if (!this._el) return;

      // The right mouse button is handled by the overlay's contextmenu listener,
      // not here: it fires over the letterboxing too, and taking it from
      // TouchInput as well would back out twice on one click.
      if (this._detail) {
        if (Input.isTriggered("cancel")) this._closeDetail();
        else if (Input.isTriggered("shift")) this._showOnMap();
        else if (Input.isTriggered("ok") && this._detailIsOffer) this._acceptCurrent();
        return;
      }

      if (Input.isTriggered("cancel")) {
        this._back();
        return;
      }
      if (Input.isTriggered("tab") || Input.isTriggered("pagedown") || Input.isTriggered("pageup")) {
        this._switchTab(this._tab === "offers" ? "contracts" : "offers");
        return;
      }
      if (Input.isTriggered("ok")) {
        if (this._tab === "contracts") {
          // OK on a claimable contract collects it directly.
          const q = this._cards()[this._focus];
          if (q && q.status === "claimable") { this._claim(q.qid); return; }
        }
        this._openDetail();
        return;
      }

      const count = this._cards().length;
      if (!count) return;
      let moved = false;
      const perRow = this._perRow();
      if (Input.isRepeated("right")) { this._focus = (this._focus + 1) % count; moved = true; }
      else if (Input.isRepeated("left")) { this._focus = (this._focus - 1 + count) % count; moved = true; }
      else if (Input.isRepeated("down")) { this._focus = Math.min(count - 1, this._focus + perRow); moved = true; }
      else if (Input.isRepeated("up")) { this._focus = Math.max(0, this._focus - perRow); moved = true; }
      if (moved) {
        SoundManager.playCursor();
        this._paintFocus();
      }
    }
  }

  window.Scene_QuestBoard = Scene_QuestBoard;

  // ==========================================================================
  // Plugin command
  // ==========================================================================
  PluginManager.registerCommand(PLUGIN, "openQuestBoard", args => {
    const boardKey = (args && args.boardKey) ? String(args.boardKey).trim() : "";
    SceneManager.push(Scene_QuestBoard);
    SceneManager.prepareNextScene(boardKey || null);
  });
})();
