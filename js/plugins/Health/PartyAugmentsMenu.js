/*:
 * @target MZ
 * @plugindesc The Augments register: every augment the party carries, and the whole catalogue of what can be fitted where.
 * @author Esoteric Heavy Industries
 *
 * @command OpenAugments
 * @text Open Augments
 * @desc Opens the party augments register.
 *
 * @help PartyAugmentsMenu.js
 *
 * The augment register used to be the last tab of the Biologics panel, where a
 * page about blood chemistry had to make room for hardware. It is its own menu
 * entry now, sitting directly after Biologics.
 *
 * Two lists, switched with Left/Right:
 *   Fitted    - every augment the party is actually wearing, whoever wears it,
 *               named with its patient and the socket it sits in.
 *   Catalogue - all of ProstheticTypes.json, so a player can read what an
 *               augment does before paying a clinic to graft it in.
 *
 * The right page is the dossier: what it costs, what it adds, the skill it
 * teaches (with that skill's own description), and every socket that takes it,
 * resolved through Health_Core's name matcher, so a creature's BODY or a
 * dragon's REAR_LEFT_LEG is listed alongside the humanoid sockets.
 *
 * Reads, never writes: fitting and removing is the prosthetic shop's business.
 *
 * Requires Health_Core (socket matching) and the Health DB (window.Health).
 */

(() => {
  "use strict";

  const getProstheticTypes = () => (window.Health && window.Health.ProstheticTypes) || null;
  const getCompatibility = () => (window.Health && window.Health.ProstheticCompatibility) || null;

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function augmentName(key, prosthetic) {
    if (!prosthetic) return key;
    return ConfigManager.language === "it" ? prosthetic.name_it : prosthetic.name_en;
  }

  // Money is euros everywhere in the game: the raw figure carries two implied
  // decimals, the same split MoneyFormatter draws.
  function priceLabel(gold) {
    const value = Math.round(Number(gold) || 0);
    const unit = ($dataSystem && $dataSystem.currencyUnit) || "";
    const str = String(Math.abs(value));
    let main = str.length <= 2 ? "0." + str.padStart(2, "0") : str.slice(0, -2) + "." + str.slice(-2);
    if (main.endsWith(".00")) main = main.slice(0, -3);
    return `${main}${unit ? " " + unit : ""}`;
  }

  function paramName(paramId) {
    return T.list('Prosthetics.paramNames')[paramId] || T('Prosthetics.statFallback');
  }

  function skillIds(value) {
    if (window.HealthCore && window.HealthCore.normalizeSkillIds) {
      return window.HealthCore.normalizeSkillIds(value);
    }
    return typeof value === "number" && value > 0 ? [value] : [];
  }

  // Which sockets accept this augment. The compatibility table is keyed by both
  // concrete part keys (LEFT_EYE) and general parts (WING), and the general ones
  // are what a creature's own anatomy resolves to, so both are listed.
  function socketsFor(key) {
    const table = getCompatibility();
    if (!table) return [];
    return Object.keys(table).filter((socket) => (table[socket] || []).includes(key));
  }

  // Every augment the party is wearing, one row per fitted socket.
  function fittedAugments() {
    const types = getProstheticTypes();
    const rows = [];
    if (!types || typeof $gameParty === "undefined" || !$gameParty) return rows;
    for (const actor of $gameParty.members()) {
      const installed = actor._prosthetics || {};
      for (const partKey in installed) {
        const key = installed[partKey];
        const prosthetic = types[key];
        if (!prosthetic) continue;
        const part = actor._bodyParts ? actor._bodyParts[partKey] : null;
        rows.push({
          key,
          prosthetic,
          actor,
          partKey,
          partName: (part && part.name) || partKey,
          damaged: !!(part && part.damaged)
        });
      }
    }
    return rows;
  }

  function catalogueAugments() {
    const types = getProstheticTypes();
    if (!types) return [];
    return Object.keys(types)
      .map((key) => ({ key, prosthetic: types[key] }))
      .sort((a, b) => augmentName(a.key, a.prosthetic).localeCompare(augmentName(b.key, b.prosthetic)));
  }

  // =========================================================================
  // Scene_PartyAugments
  // =========================================================================
  class Scene_PartyAugments extends Scene_MenuBase {
    create() {
      super.create();
      this._tab = 0;              // 0 fitted, 1 catalogue
      this._selectedIndex = 0;
      this._activeArea = "tabs";  // 'tabs' | 'list'
      this._rows = [];
      this.initAugmentDOM();
    }

    update() {
      super.update();
      this.updateAugmentInput();
    }

    terminate() {
      const container = document.getElementById("party-augments-container");
      if (container) container.remove();
      super.terminate();
    }

    initAugmentDOM() {
      this._dndContainer = document.createElement("div");
      this._dndContainer.id = "party-augments-container";
      const s = this._dndContainer.style;
      s.position = "absolute";
      s.top = "0";
      s.left = "0";
      s.width = "100%";
      s.height = "100%";
      s.zIndex = "1000";
      s.background = "radial-gradient(circle, var(--accent-bronze-translucent-78) 0%, var(--shadow-heavy) 100%)";
      s.display = "flex";
      s.justifyContent = "center";
      s.alignItems = "center";
      s.fontFamily = "'Lora', serif";
      s.boxSizing = "border-box";
      s.opacity = "0";
      s.transition = "opacity 0.22s ease-out";

      this._dndContainer.innerHTML = `
        <div class="book-spread">
          <div class="left-page" style="position:relative;">
            <div class="page-header-bar">
              <div class="back-button focusable">${T('Augments.ui.back')}</div>
              <h2 class="title">${T('Augments.ui.title')}</h2>
            </div>
            <div id="aug-tab-row" style="display:flex; flex-wrap:wrap; gap:5px; padding:6px 0 10px;"></div>
            <div id="aug-list-content" style="display:flex; flex-direction:column; height:100%; overflow-y:auto; color:var(--text-card-medium);"></div>
          </div>
          <div class="right-page" style="position:relative;">
            <div id="aug-detail-content" style="display:flex; flex-direction:column; flex:1 1 auto; min-height:0; overflow-y:auto; color:var(--text-card-medium);"></div>
          </div>
        </div>
      `;
      document.body.appendChild(this._dndContainer);

      this._dndContainer.querySelector(".back-button").addEventListener("click", (e) => {
        e.stopPropagation();
        SoundManager.playCancel();
        this.popScene();
      });

      const listBox = document.getElementById("aug-list-content");
      if (listBox) listBox.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

      this.refreshAugmentDOM();
      setTimeout(() => {
        if (this._dndContainer) this._dndContainer.style.opacity = "1";
      }, 16);
    }

    buildRows() {
      return this._tab === 0 ? fittedAugments() : catalogueAugments();
    }

    refreshAugmentDOM() {
      if (!this._dndContainer) return;
      this._rows = this.buildRows();
      if (this._selectedIndex >= this._rows.length) {
        this._selectedIndex = Math.max(0, this._rows.length - 1);
      }

      const fittedCount = fittedAugments().length;
      const tabs = [
        T('Augments.ui.tab.fitted', { count: fittedCount }),
        T('Augments.ui.tab.catalogue', { count: catalogueAugments().length })
      ];
      const tabRow = document.getElementById("aug-tab-row");
      if (tabRow) {
        tabRow.innerHTML = tabs.map((label, idx) => {
          const isSel = idx === this._tab;
          const isFocused = isSel && this._activeArea === "tabs";
          return `<div class="aug-tab focusable" data-tab-idx="${idx}" style="
              font-family:'Lora',serif; font-size:0.78rem; padding:4px 10px; border-radius:12px; cursor:pointer;
              background:${isSel ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--bg-card-translucent-5)'};
              border:1.5px solid ${isFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'};
              color:${isSel ? 'var(--text-secondary-active)' : 'var(--text-card-medium)'};
            ">${escapeHtml(label)}</div>`;
        }).join("");
        tabRow.querySelectorAll(".aug-tab").forEach((tab) => {
          tab.addEventListener("click", () => {
            const idx = parseInt(tab.getAttribute("data-tab-idx"), 10);
            if (idx !== this._tab) {
              this._tab = idx;
              this._selectedIndex = 0;
            }
            this._activeArea = "tabs";
            SoundManager.playCursor();
            this.refreshAugmentDOM();
          });
        });
      }

      const listBox = document.getElementById("aug-list-content");
      if (listBox) {
        const savedScroll = listBox.scrollTop;
        listBox.innerHTML = this.buildListHTML();
        listBox.scrollTop = savedScroll;
        listBox.querySelectorAll(".aug-row").forEach((row) => {
          row.addEventListener("click", () => {
            this._selectedIndex = parseInt(row.getAttribute("data-idx"), 10);
            this._activeArea = "list";
            SoundManager.playCursor();
            this.refreshAugmentDOM();
          });
        });
      }

      const detail = document.getElementById("aug-detail-content");
      if (detail) detail.innerHTML = this.buildDetailHTML(this._rows[this._selectedIndex]);
    }

    buildListHTML() {
      if (!this._rows.length) {
        const empty = this._tab === 0 ? T('Augments.ui.noneFitted') : T('Augments.ui.noCatalogue');
        return `<div style="opacity:0.6; font-style:italic; padding:14px 10px; font-family:'Lora',serif;">${empty}</div>`;
      }
      return this._rows.map((row, idx) => {
        const isSel = idx === this._selectedIndex;
        const isFocused = isSel && this._activeArea === "list";
        const name = augmentName(row.key, row.prosthetic);
        const sub = this._tab === 0
          ? T('Augments.ui.wornBy', { actor: row.actor.name(), part: row.partName })
          : T('Augments.ui.type.' + (row.prosthetic.type || "biological"));
        const flag = this._tab === 0 && row.damaged
          ? `<span style="font-size:0.68rem; color:var(--text-text-alt-17);">${T('Augments.ui.damagedHost')}</span>`
          : `<span style="font-size:0.72rem; opacity:0.7;">${escapeHtml(priceLabel(row.prosthetic.cost))}</span>`;
        return `
          <div class="aug-row focusable ${isFocused ? 'focused' : ''}" data-idx="${idx}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 10px; cursor:pointer; border-radius:5px; background:${isSel ? 'var(--bg-tertiary-focus-translucent-45)' : 'transparent'};">
            <span style="display:flex; flex-direction:column;">
              <span style="font-family:'Lora',serif; color:${isSel ? 'var(--text-secondary-active)' : 'var(--text-card-medium)'};">${escapeHtml(name)}</span>
              <span style="font-size:0.72rem; opacity:0.7;">${escapeHtml(sub)}</span>
            </span>
            ${flag}
          </div>`;
      }).join("");
    }

    buildDetailHTML(row) {
      if (!row) {
        return `<div style="opacity:0.6; font-style:italic; margin:20px;">${T('Augments.ui.noneSelected')}</div>`;
      }
      const p = row.prosthetic;
      const name = augmentName(row.key, p);
      const typeLabel = T('Augments.ui.type.' + (p.type || "biological"));

      let effectsHTML = "";
      const effects = Object.entries(p.effects || {});
      if (effects.length) {
        effectsHTML = effects.map(([paramId, value]) => `
          <div style="display:flex; justify-content:space-between; padding:2px 0;">
            <span>${escapeHtml(paramName(parseInt(paramId, 10)))}</span>
            <span style="color:var(--text-secondary-active); font-weight:bold;">${value >= 0 ? "+" : ""}${value}</span>
          </div>`).join("");
      } else {
        effectsHTML = `<div style="opacity:0.7;">${T('Augments.ui.noStatChange')}</div>`;
      }

      // A `needs` block is a multiplier on how fast that need drains, so it is
      // read out as plain English: stopped, slowed by a share, or reversed.
      for (const [needKey, rate] of Object.entries(p.needs || {})) {
        const label = (window.PartyNeeds && window.PartyNeeds.LABELS && window.PartyNeeds.LABELS[needKey]) || needKey;
        let line;
        if (rate < 0) {
          line = T('Augments.ui.need.restores', { need: label, pct: Math.round(Math.abs(rate) * 100) });
        } else if (rate === 0) {
          line = T('Augments.ui.need.halted', { need: label });
        } else if (rate < 1) {
          line = T('Augments.ui.need.slowed', { need: label, pct: Math.round((1 - rate) * 100) });
        } else if (rate > 1) {
          line = T('Augments.ui.need.hastened', { need: label, pct: Math.round((rate - 1) * 100) });
        } else {
          continue;
        }
        effectsHTML += `<div style="margin-top:4px; color:var(--text-secondary-active);">${escapeHtml(line)}</div>`;
      }

      // An endocrine implant's real effect is in the blood, not in the params,
      // so the biologic simulation supplies that line itself.
      const endocrine = window.EndocrineImplants && window.EndocrineImplants.describe
        ? window.EndocrineImplants.describe(row.key) : null;
      if (endocrine) {
        effectsHTML += `<div style="margin-top:4px; color:var(--text-secondary-active);">${escapeHtml(endocrine)}</div>`;
      }

      let skillHTML = "";
      for (const sid of skillIds(p.skill)) {
        const skill = $dataSkills && $dataSkills[sid];
        if (!skill || !skill.name) continue;
        const desc = (skill.description || "").split("\n").join(" ");
        skillHTML += `
          <div style="margin-top:6px;">
            <div style="font-weight:bold; color:var(--text-secondary-active);">${escapeHtml(skill.name)}</div>
            ${desc ? `<div style="opacity:0.85; font-size:0.82rem; line-height:1.4;">${escapeHtml(desc)}</div>` : ""}
            <div style="opacity:0.7; font-size:0.72rem; margin-top:2px;">${T('Augments.ui.alwaysCarried')}</div>
          </div>`;
      }

      const sockets = socketsFor(row.key);
      const socketsHTML = sockets.length
        ? `<div style="display:flex; flex-wrap:wrap; gap:4px;">` + sockets.map((s) =>
            `<span style="padding:1px 6px; border-radius:9px; font-size:0.72rem; color:var(--text-card-medium); border:1px solid var(--border-secondary-hover-translucent-15);">${escapeHtml(s)}</span>`
          ).join("") + `</div>`
        : `<div style="opacity:0.7;">${T('Augments.ui.noSocket')}</div>`;

      const fittedHTML = row.actor
        ? `<div style="margin-top:18px;">
             <div style="font-weight:bold; color:var(--text-secondary-active); border-bottom:1px dashed var(--border-secondary-hover-translucent-15); margin-bottom:4px;">${T('Augments.ui.fittedTo')}</div>
             <div style="display:flex; justify-content:space-between; padding:2px 0;">
               <span>${escapeHtml(row.actor.name())}</span><span>${escapeHtml(row.partName)}</span>
             </div>
             ${row.damaged ? `<div style="font-size:0.78rem; color:var(--text-text-alt-17); margin-top:4px;">${T('Augments.ui.damagedWarning')}</div>` : ""}
             <div style="font-size:0.75rem; opacity:0.7; margin-top:4px;">${T('Augments.ui.severWarning')}</div>
           </div>`
        : "";

      return `
        <div style="padding:24px; font-family:'Lora',serif;">
          <h2 style="color:var(--text-secondary-active); margin:0 0 4px;">${escapeHtml(name)}</h2>
          <div style="opacity:0.7;">${escapeHtml(typeLabel)} &middot; ${escapeHtml(priceLabel(p.cost))}</div>
          <div style="margin-top:18px;">
            <div style="font-weight:bold; color:var(--text-secondary-active); border-bottom:1px dashed var(--border-secondary-hover-translucent-15); margin-bottom:4px;">${T('Augments.ui.effects')}</div>
            ${effectsHTML}
          </div>
          ${skillHTML ? `<div style="margin-top:18px;">
            <div style="font-weight:bold; color:var(--text-secondary-active); border-bottom:1px dashed var(--border-secondary-hover-translucent-15); margin-bottom:4px;">${T('Augments.ui.grantedSkill')}</div>
            ${skillHTML}
          </div>` : ""}
          <div style="margin-top:18px;">
            <div style="font-weight:bold; color:var(--text-secondary-active); border-bottom:1px dashed var(--border-secondary-hover-translucent-15); margin-bottom:4px;">${T('Augments.ui.sockets')}</div>
            ${socketsHTML}
          </div>
          ${fittedHTML}
        </div>
      `;
    }

    updateAugmentInput() {
      const isCancel = Input.isTriggered("cancel") || Input.isTriggered("escape") || TouchInput.isCancelled();

      if (this._activeArea === "tabs") {
        if (Input.isTriggered("right") || Input.isRepeated("right")) {
          if (this._tab < 1) {
            this._tab++;
            this._selectedIndex = 0;
            SoundManager.playCursor();
            this.refreshAugmentDOM();
          }
        } else if (Input.isTriggered("left") || Input.isRepeated("left")) {
          if (this._tab > 0) {
            this._tab--;
            this._selectedIndex = 0;
            SoundManager.playCursor();
            this.refreshAugmentDOM();
          }
        } else if (Input.isTriggered("down") || Input.isRepeated("down")) {
          if (this._rows.length) {
            this._activeArea = "list";
            SoundManager.playCursor();
            this.refreshAugmentDOM();
          }
        } else if (isCancel) {
          SoundManager.playCancel();
          this.popScene();
        }
        return;
      }

      if (!this._rows.length) {
        if (isCancel) {
          this._activeArea = "tabs";
          SoundManager.playCancel();
          this.refreshAugmentDOM();
        }
        return;
      }

      if (Input.isTriggered("down") || Input.isRepeated("down")) {
        if (this._selectedIndex < this._rows.length - 1) {
          this._selectedIndex++;
          SoundManager.playCursor();
          this.refreshAugmentDOM();
          this.scrollSelectedIntoView();
        }
      } else if (Input.isTriggered("up") || Input.isRepeated("up")) {
        if (this._selectedIndex > 0) {
          this._selectedIndex--;
          SoundManager.playCursor();
          this.refreshAugmentDOM();
          this.scrollSelectedIntoView();
        } else {
          this._activeArea = "tabs";
          SoundManager.playCursor();
          this.refreshAugmentDOM();
        }
      } else if (isCancel) {
        this._activeArea = "tabs";
        SoundManager.playCancel();
        this.refreshAugmentDOM();
      }
    }

    scrollSelectedIntoView() {
      const focused = document.querySelector("#aug-list-content .aug-row.focused");
      if (focused) focused.scrollIntoView({ block: "nearest" });
    }
  }

  window.Scene_PartyAugments = Scene_PartyAugments;

  const openAugments = () => {
    SceneManager.push(Scene_PartyAugments);
  };
  PluginManager.registerCommand("Health/PartyAugmentsMenu", "OpenAugments", openAugments);
  PluginManager.registerCommand("PartyAugmentsMenu", "OpenAugments", openAugments);
})();
