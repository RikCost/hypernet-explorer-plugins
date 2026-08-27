/*:
 * @target MZ
 * @plugindesc Every panel the creation spread reads back: the sidebar, the personal dossier, the scenario sheet and the starting loadout
 * @author Omni-Lex
 * @orderAfter CharacterCreation
 *
 * @help
 * Lifted out of CharacterCreation.js. Nothing here asks a question or takes
 * a choice: this is everything the spread draws to show what the party has
 * become so far.
 *
 *   - the compact sidebar that stands beside every page,
 *   - the personal dossier: one member's whole sheet, read back,
 *   - the scenario dossier: the party as it will be handed to the world,
 *   - the loadout rows and the starting inventory an origin adds up to,
 *   - the hover plates a stat or an item raises.
 *
 * Every method here was a method of Scene_CharacterCreation and still is:
 * the class body below is copied onto its prototype at load.
 */

(() => {
  "use strict";

  const Scene_CharacterCreation = window.Scene_CharacterCreation;
  if (!Scene_CharacterCreation) return;

  const {
    ccT,
    ccTp,
    ccStatLabels,
    resolveTraitName,
    resolveTraitDesc,
    selectedTraitObjects,
    archetypeDisplayName,
    actorArchetypeKey,
    actorSecondaryArchetypeKey,
    CharacterCreationData,
    STEP,
  } = window.CCKit;

  // What a party is worth on the day it starts: the purse its class, traits
  // and wealth add up to, and the goods its origin hands over.
  const {
    CC_BASE_START_GOLD,
    classStartingMoney,
    traitStartingMoney,
    wealthStartingMoney,
    scenarioGoldBonus,
    giveStartingMoney,
    loadoutEntryData,
    resolveOriginLoadout,
  } = window.CCOrigins || {};
  const { getClassStartingItems } = window.StartingEquipment || {};
  const { applyTraitsToActor } = window.CharacterCreationUtils || {};

  // Written as a class body so the methods move onto the wizard exactly as
  // they were declared while they still lived inside it, accessors and all.
  class CCDossierPages {
    _ccTooltipEl() {
      let tooltip = document.getElementById("cc-item-tooltip");
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "cc-item-tooltip";
        tooltip.className = "cc-item-tooltip";
        document.body.appendChild(tooltip);
      }
      return tooltip;
    }

    _ccPositionTooltip(event, tooltip) {
      tooltip.style.display = "block";
      const mouseX = (event && event.clientX) || 100;
      const mouseY = (event && event.clientY) || 100;
      tooltip.style.left = `${Math.min(window.innerWidth - 330, mouseX + 16)}px`;
      tooltip.style.top = `${Math.min(window.innerHeight - 180, mouseY + 16)}px`;
    }

    // A stat box's own card: what the stat actually governs, read off the
    // i18n bank (CharCreate.statInfo.<key>) so it translates with the rest of
    // the sheet instead of carrying its own hardcoded prose.
    onStatHover(event, statKey) {
      const tooltip = this._ccTooltipEl();
      const SL = ccStatLabels();
      const label = SL[statKey] || statKey;
      const desc = ccT('CharCreate.statInfo.' + statKey, '');
      tooltip.innerHTML = `
        <div class="cc-item-tooltip-header">
          <span class="cc-item-tooltip-title">${label}</span>
        </div>
        ${desc ? `<div class="cc-item-tooltip-desc">${desc}</div>` : ""}
      `;
      this._ccPositionTooltip(event, tooltip);
    }

    // ── Item Hover Tooltip Handlers ──
    onItemHover(event, type, id, qty) {
      // A trait is not a $data* record, so it is resolved off the trait bank
      // (window.Health.Traits) the same way the trait board's own detail
      // panel resolves the one it has highlighted.
      if (type === "trait") {
        const bank = (window.Health && window.Health.Traits) || [];
        const trait = bank.find((t) => String(t.id) === String(id));
        if (!trait) return;
        const tooltip = this._ccTooltipEl();
        const name = (trait.name && resolveTraitName(trait.name, trait.id)) || trait.id;
        const desc = (trait.description && resolveTraitDesc(trait.description, trait.id)) || "";
        let traitStatsHtml = "";
        if (trait.positive) {
          traitStatsHtml += Object.entries(trait.positive)
            .map(([k, v]) => `<span class="ts-badge pos">+${v} ${k.toUpperCase()}</span>`).join(" ");
        }
        if (trait.negative) {
          traitStatsHtml += Object.entries(trait.negative)
            .map(([k, v]) => `<span class="ts-badge neg">${v} ${k.toUpperCase()}</span>`).join(" ");
        }
        tooltip.innerHTML = `
          <div class="cc-item-tooltip-header">
            ${this._ccIconHtml(trait.icon || 87, 20)}
            <span class="cc-item-tooltip-title">${name}</span>
            <span class="cc-item-tooltip-type">${ccT('CharCreate.traitTypeLabel', 'TRAIT')}</span>
          </div>
          ${desc ? `<div class="cc-item-tooltip-desc">${desc}</div>` : ""}
          ${traitStatsHtml ? `<div class="cc-item-tooltip-stats">${traitStatsHtml}</div>` : ""}
        `;
        this._ccPositionTooltip(event, tooltip);
        return;
      }

      let item = null;
      if (type === "weapon") item = $dataWeapons[id];
      else if (type === "armor") item = $dataArmors[id];
      else if (type === "skill") item = $dataSkills[id];
      else item = $dataItems[id];
      if (!item) return;

      const tooltip = this._ccTooltipEl();

      const name = window.CCDbName(item);
      // The description is translated the same way the name is: the record's
      // own line is English, and the DOM never reaches the engine's draw hooks.
      const desc = window.CCDbDesc(item) || ccT('CharCreate.standardIssueGear', "Standard issue item or gear.");
      const iconHtml = this._ccIconHtml(item.iconIndex, 20);
      const typeLabel = type ? type.toUpperCase() : "ITEM";
      // A skill has no shop price, so the card that describes one says what it
      // costs to cast instead of pretending it is for sale.
      const isSkill = type === "skill";
      const price = !isSkill && item.price ? this._formatGoldToEuros(item.price) : "";

      let statsHtml = "";
      if (isSkill) {
        if (item.mpCost > 0) {
          statsHtml += `<span class="ts-badge neg">${T('SkillMaster.mpLabel')} ${item.mpCost}</span> `;
        }
        if (item.tpCost > 0) {
          statsHtml += `<span class="ts-badge neg">${T('SkillMaster.apLabel')} ${item.tpCost}</span> `;
        }
        // What the skill is trained as, so a spell on the growth plan can be
        // read as the specialization it belongs to.
        const spec = window.SkillSpecs && window.SkillSpecs.forSkill
          ? window.SkillSpecs.forSkill(item) : null;
        const specName = spec && (window.Specializations && window.Specializations.displayName
          ? window.Specializations.displayName(spec) : spec.name);
        if (specName) statsHtml += `<span class="ts-badge pos">${specName}</span> `;
      } else if (item.params) {
        // The engine's own param names (ATK, MDF, LUK) are not what this game
        // calls its attributes: the card reads STR, WIS and PSI like the sheet
        // beside it, out of the same bank, translated with it.
        const SL = ccStatLabels();
        const paramLabels = [SL.HP, SL.MP, SL.STR, SL.CON, SL.INT, SL.WIS, SL.DEX, SL.PSI];
        item.params.forEach((v, idx) => {
          if (v !== 0) {
            statsHtml += `<span class="ts-badge ${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : ''}${v} ${paramLabels[idx]}</span> `;
          }
        });
      }

      tooltip.innerHTML = `
        <div class="cc-item-tooltip-header">
          ${iconHtml}
          <span class="cc-item-tooltip-title">${name}</span>
          <span class="cc-item-tooltip-type">${typeLabel}</span>
        </div>
        <div class="cc-item-tooltip-desc">${desc}</div>
        ${statsHtml ? `<div class="cc-item-tooltip-stats">${statsHtml}</div>` : ""}
        ${price ? `<div class="cc-item-tooltip-price">${ccT('CharCreate.estimatedValue', 'Estimated Value')}: ${price}</div>` : ""}
      `;

      this._ccPositionTooltip(event, tooltip);
    }

    onItemLeave() {
      const tooltip = document.getElementById("cc-item-tooltip");
      if (tooltip) tooltip.style.display = "none";
    }

    // ── Top Folder Tabs (Party Tabs Left, Step Tabs Right) ──

    _formatGoldToEuros(gold) {
      const euros = (Number(gold) || 0) / 100;
      const isIt = (typeof ConfigManager !== 'undefined' && ConfigManager.language === 'it');
      return euros.toLocaleString(isIt ? 'it-IT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€';
    }

    // True when this member is a monster, whichever way it was made one: the
    // flag the creature builder writes, a monstrous class, or the per-slot
    // creature switch the character-type step sets.

    _ccLoadoutRowHtml(iconIndex, name, value, opts) {
      const o = opts || {};
      const hover = o.hover || "";
      return `
        <div class="cc-compact-loadout-item"
             style="display:flex; justify-content:space-between; align-items:center; padding:3px 2px; background:transparent !important; border:none !important; box-shadow:none !important;${hover ? ' cursor:pointer;' : ''}" ${hover}>
          <span class="cc-dossier-label" style="display:flex; align-items:center; gap:8px; font-size:1.02rem; color:${o.nameColor || '#fff'}; font-weight:bold; font-family:'Lora',serif; min-width:0;">
            <span class="cc-loadout-icon" style="flex-shrink:0;">${this._ccIconHtml(iconIndex, 18)}</span>
            <span class="cc-loadout-name">${name}</span>
          </span>
          ${value ? `<span class="cc-dossier-value" style="font-size:1.02rem; font-weight:bold; color:${o.valueColor || '#fff'}; font-family:'Lora',serif; margin-left:8px; flex-shrink:0;">${value}</span>` : ''}
        </div>
      `;
    }

    // The hover attributes any loadout row wears to raise the inspect card.
    // Items had one and skills did not, so the sidebar could tell you what a
    // sling does but not what a spell does.
    _ccHoverAttrs(type, id, qty) {
      return `onmouseenter="SceneManager._scene.onItemHover(event, '${type}', ${id}, ${qty == null ? 1 : qty})" onmouseleave="SceneManager._scene.onItemLeave()"`;
    }

    // The gear the Bio tab's job selector hands out (actor._grantedJobItemIds,
    // kept in sync by onBioOptionChange) so it shows up next to the class kit
    // everywhere the starting loadout is listed: the sidebar and the scenario
    // resume sheet.
    _ccPushJobItems(actor, list) {
      if (!actor || !Array.isArray(actor._grantedJobItemIds)) return;
      const counts = {};
      actor._grantedJobItemIds.forEach((id) => {
        counts[id] = (counts[id] || 0) + 1;
      });
      Object.keys(counts).forEach((idStr) => {
        const item = $dataItems[Number(idStr)];
        if (item) list.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: counts[idStr], type: "item", id: item.id });
      });
    }

    // A loadout block: the sidebar's gold rule with its tally, then the rows.
    // `open` lets the rows run their full length instead of scrolling inside
    // the sidebar's short well, which is what a dossier page wants. `extraClass`
    // switches the rows from the default single column to another layout, e.g.
    // the class dossier's weapon proficiencies, which read better as a grid.
    _ccLoadoutSectionHtml(title, count, rowsHtml, emptyText, open, extraClass) {
      return `
        <div style="margin-top:2px;">
          <div style="font-size:1.05rem; font-weight:bold; color:#ffd700; border-bottom:1px solid rgba(218,165,32,0.3); padding-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
            <span class="cc-loadout-section-title">${title}</span>
            ${count === null || count === undefined ? '' : `<span class="cc-loadout-section-count" style="font-size:0.85rem; color:#ffd700; opacity:0.85;">${count}</span>`}
          </div>
          <div class="cc-compact-loadout-grid ${open ? 'cc-loadout-open' : ''} ${extraClass || ''}">
            ${rowsHtml || `<span class="cc-loadout-empty" style="font-size:0.88rem; color:rgba(255,255,255,0.45); font-style:italic; padding:6px; text-align:center;">${emptyText || ''}</span>`}
          </div>
        </div>
      `;
    }

    _renderCompactSidebarHtml() {
      // The preset board reads its own dossier down the sidebar too: browsing
      // wanted posters used to leave this panel showing the (still blank) seat
      // being filled, unrelated to whichever dossier was highlighted, so taking
      // one was a guess until it was actually applied. See
      // _renderPresetPreviewSidebarHtml.
      if (this._presetWindow) return this._renderPresetPreviewSidebarHtml();

      const actor = Scene_CharacterCreation.getCurrentActor();
      // Guarded before the actor is read, not after: with no current member the
      // three reads below threw and took the whole overlay refresh with them,
      // leaving a blank screen instead of an empty sidebar.
      if (!actor) return `<div class="cc-compact-sidebar"></div>`;

      // The companion board reads its own dossier down the sidebar, the way a
      // character does: the picked beast, its numbers and its nature, with the
      // whole board left over for the roster.
      if (Scene_CharacterCreation._isPetMode) return this._petSidebarHtml();

      const currentMemberIndex = Scene_CharacterCreation._currentPartyMemberIndex || 0;
      const isCreature = !actor._isPresetActor && !this._presetWindow && !!(actor._isCreatureActor || $gameSwitches.value(77 + currentMemberIndex));
      const isPreset = !!this._presetWindow;
      const isPetActive = false;

      const isLocked = this._isActorLockedPreset(actor);

      const classData = $dataClasses[actor._classId];
      const className = classData ? window.CCDbName(classData) : "Class";
      // The identity card reads as an occupation, not a body: "{job} {class}",
      // e.g. "Jobless Witch". The job is the same one the Bio tab tracks
      // (actor._jobId, 0 = jobless), so both places always agree.
      const identityJobs = (window.WorkSystem && window.WorkSystem.Jobs) || [];
      const identityJobId = actor._jobId != null ? actor._jobId : 0;
      const identityJob = identityJobId > 0 ? (identityJobs.find((j) => j.id === identityJobId) || null) : null;
      const jobName = identityJob
        ? (window.WorkSystem && window.WorkSystem.jobName ? window.WorkSystem.jobName(identityJob) : (identityJob.name || `Job #${identityJob.id}`))
        : ccT('CharCreate.bio.joblessShort', 'Jobless');

      const startingGold = CC_BASE_START_GOLD + (typeof classStartingMoney === 'function' ? classStartingMoney(actor._classId) : 0) + (typeof traitStartingMoney === 'function' ? traitStartingMoney(actor) : 0) + (typeof wealthStartingMoney === 'function' ? wealthStartingMoney(actor) : 0);
      const startingMoneyFormatted = this._formatGoldToEuros(startingGold);

      let avatarStyle = "";
      if (actor.characterName()) {
        avatarStyle = this.getSpriteStyle(actor.characterName(), actor.characterIndex());
      }

      // 1. Identity Card (Sprite on Left of Name opens Sprite Gallery + Randomize Button + Class/Gender)
      const identityHeaderHtml = `
        <div class="cc-compact-identity-card">
          <div style="display:flex; gap:10px; align-items:center;">
            ${!isPetActive ? `
              <div class="cc-compact-avatar-wrap" title="${isLocked ? ccT('CharCreate.spriteLockedHint', 'Preset sprite (locked)') : ccT('CharCreate.spriteClickHint', 'Sprite: click to open the grid selector')}" onclick="${isLocked ? 'SoundManager.playBuzzer()' : 'SceneManager._scene.onOpenSpriteGallery()'}">
                <div class="cc-compact-avatar" style="${avatarStyle}"></div>
              </div>
            ` : ''}
            <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width:0;">
              <div style="display:flex; gap:4px; align-items:center;">
                <input type="text" class="cc-bio-select cc-name-input" style="font-family:'Lora',serif; font-weight:bold; font-size:1.15rem; color:#ffd700; background:rgba(0,0,0,0.4); border:1px solid rgba(218,165,32,0.35); border-radius:4px; padding:3px 8px; height:32px; width:100%; box-sizing:border-box; ${isLocked ? 'opacity:0.85; cursor:not-allowed;' : ''}" value="${actor.name() || ccT('CharCreate.defaultName', 'Hero')}" oninput="SceneManager._scene.onNameChange(this.value)" placeholder="${ccT('CharCreate.defaultName', 'Hero')}" ${isLocked ? 'readonly disabled' : ''} />
                ${!isLocked ? `
                  <button class="cc-profile-open-btn cc-profile-open-btn--icon" onclick="SceneManager._scene.onRandomizeNameClick()" title="${ccT('CharCreate.randomize', 'Randomize Name')}">
                    ${this._ccIconHtml(83, 16)}
                  </button>
                ` : ''}
              </div>
              <div style="display:flex; align-items:center; font-size:0.95rem; color:#ded1c1; padding:0 2px;">
                <span style="font-weight:700; color:#ffd700;">${jobName} ${className}</span>
              </div>
            </div>
          </div>
        </div>
      `;

      // 2. Full-Width Portrait Showcase Card (2D Bust for Humanoid, 3D Archetype Selector + Studio for Creature)
      let profileBoxHtml = "";
      if (!isPetActive) {
        if (isCreature) {
          // The archetypes a creature can actually BE, named the way the rest of
          // the game names them. This used to list Battler3D's ~600 raw
          // lowercase structure keys ("bigcat", "chromaticmanticore"), none of
          // which the health side could resolve back to a body.
          const currentArch = actorArchetypeKey(actor) || "Goblin";
          const secondArch = actorSecondaryArchetypeKey(actor) || "";

          // A creature is its model, so the card names the model it already has
          // (settled from its archetype the moment it was made) and opens the
          // sculptor. No 2D bust is ever borrowed for a monster.
          const modelLabel = secondArch
            ? `${archetypeDisplayName(currentArch)} / ${archetypeDisplayName(secondArch)}`
            : archetypeDisplayName(currentArch);

          // The primary/secondary archetype pickers live on the Bio tab now,
          // alongside the rest of who the creature is. The sidebar keeps only
          // the model preview and the shortcut into the sculptor.
          profileBoxHtml = `
            <div class="cc-compact-portrait-card" style="display:flex; flex-direction:column; gap:6px;">
              <div class="cc-compact-bust-full empty cc3d-live-portrait" style="position:relative; overflow:hidden;" onclick="SceneManager._scene.onOpenCreature3DStudio()">
                <div class="cc3d-live-portrait-fallback" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:6px;">
                  ${this._ccIconHtml(224, 28)}
                  <span style="font-size:0.9rem; color:#ffd700; font-weight:600;">${ccT('CharCreate.custom3dModel', '3D Model')}: ${modelLabel}</span>
                </div>
              </div>
              <div style="padding:0 2px;">
                <button class="cc-compact-edit-btn" style="width:100%; height:32px; justify-content:center;" onclick="SceneManager._scene.onOpenCreature3DStudio()">
                  ${this._ccIconHtml(224, 16)} <span>${ccT('CharCreate.custom3dModel', '3D Studio (Custom)')}</span>
                </button>
              </div>
            </div>
          `;
        } else {
          const bustName = this._getActorBust(actor);
          const bustUrl = this._getBustUrl(bustName);

          // The portrait is its own button now: the bust is clicked and the
          // gallery opens on it. The Appearance button underneath said the
          // same thing twice and ate a row of the sidebar.
          const bustTitle = isLocked
            ? ccT('CharCreate.bustLockedHint', 'Preset portrait (locked)')
            : ccT('CharCreate.bustClickHint', 'Portrait: click to choose a bust');
          const bustClick = isLocked ? 'SoundManager.playBuzzer()' : 'SceneManager._scene.onOpenBustGallery()';

          profileBoxHtml = `
            <div class="cc-compact-portrait-card">
              ${bustUrl ? `
                <div class="cc-compact-bust-full ${isLocked ? 'locked' : ''}" title="${bustTitle}" onclick="${bustClick}" style="background-image: url('${bustUrl}');"></div>
              ` : `
                <div class="cc-compact-bust-full empty ${isLocked ? 'locked' : ''}" title="${bustTitle}" onclick="${bustClick}">
                  <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:6px;">
                    ${this._ccIconHtml(224, 28)}
                    <span style="font-size:0.9rem; color:rgba(218,165,32,0.7); font-weight:600;">${ccT('CharCreate.noBustSelected', 'No portrait chosen')}</span>
                  </div>
                </div>
              `}
              ${isLocked ? `
                <div class="cc-compact-portrait-controls">
                  <div style="font-size:0.85rem; color:#ffd700; text-align:center; padding:4px 0; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px;">
                    ${this._ccIconHtml(195, 14)} <span>${ccT('CharCreate.presetLocked', 'Preset')}</span>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }
      }

      // 3. Core 8-Stat Grid (Status Screen Styled with Red HP and Modifiers)
      // Traits push their positive/negative deltas into actor._paramPlus the
      // moment they are toggled (see onTraitToggle -> _ccApplyTraitIds), so
      // folding it in here is what makes a stat change show up on the sidebar
      // as soon as the trait is picked, not only once the sheet is left and
      // reopened.
      const _baseStatNoEquip = (paramId, fallback) => {
        if (!classData) return fallback;
        const base = classData.params[paramId][1];
        const plus = (actor && actor._paramPlus) ? (actor._paramPlus[paramId] || 0) : 0;
        const rate = (actor && typeof actor.paramRate === "function") ? actor.paramRate(paramId) : 1;
        return Math.round((base + plus) * rate) || fallback;
      };
      const SL = ccStatLabels();
      const stats = [
        { key: "HP",  label: SL.HP,  val: _baseStatNoEquip(0, 450), color: "#ef5350" },
        { key: "MP",  label: SL.MP,  val: _baseStatNoEquip(1, 100), color: "#64b5f6" },
        { key: "STR", label: SL.STR, val: _baseStatNoEquip(2, 12),  color: "#e57373" },
        { key: "CON", label: SL.CON, val: _baseStatNoEquip(3, 10),  color: "#ffb74d" },
        { key: "DEX", label: SL.DEX, val: _baseStatNoEquip(6, 10),  color: "#ffd54f" },
        { key: "INT", label: SL.INT, val: _baseStatNoEquip(4, 10),  color: "#ba68c8" },
        { key: "WIS", label: SL.WIS, val: _baseStatNoEquip(5, 10),  color: "#4db6ac" },
        { key: "PSI", label: SL.PSI, val: _baseStatNoEquip(7, 10),  color: "#f06292" }
      ];
      // HP and MP used to be two bar gauges above the stat grid; now they lead
      // it as plain boxes like every other stat, freeing the two bar rows'
      // worth of height for the portrait above to grow into.
      const statsHtml = `
        <div class="cc-vitals-block">
          <div class="cc-stat-grid">
            ${stats.map((st, idx) => {
              const statHover = `onmouseenter="SceneManager._scene.onStatHover(event, '${st.key}')" onmouseleave="SceneManager._scene.onItemLeave()"`;
              const isVital = idx < 2; // HP, MP
              if (isVital) {
                return `
                  <div class="cc-stat-box" ${statHover}>
                    <span class="cc-stat-label" style="color:${st.color};">${st.label}</span>
                    <span class="cc-stat-val">${st.val}</span>
                  </div>
                `;
              }
              const mod = Math.floor((st.val - 10) / 2);
              const modStr = mod >= 0 ? "+" + mod : String(mod);
              return `
                <div class="cc-stat-box" ${statHover}>
                  <span class="cc-stat-label">${st.label}</span>
                  <span class="cc-stat-val">${st.val} <span class="cc-stat-mod">(${modStr})</span></span>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;

      // 5. Level-1 Starting Skills — loadout row layout (matches Starting Items)
      const lv1SkillsList = [];
      if (classData && classData.learnings) {
        classData.learnings
          .filter(l => l.level === 1)
          .forEach(l => {
            const sk = $dataSkills[l.skillId];
            if (sk) lv1SkillsList.push({ name: window.CCDbName(sk), iconIndex: sk.iconIndex || 79, id: sk.id });
          });
      }
      const skillsLoadoutHtml = lv1SkillsList.map((sk) => this._ccLoadoutRowHtml(sk.iconIndex, sk.name, "",
        { hover: this._ccHoverAttrs("skill", sk.id) })).join("");

      const skillsSectionHtml = this._ccLoadoutSectionHtml(
        T('CharCreate.startingSkills'),
        ccTp('CharCreate.skillCount', { n: lv1SkillsList.length }, lv1SkillsList.length + ' skills'),
        skillsLoadoutHtml,
        T('CharCreate.noStartingSkills'),
        false,
        'cc-loadout-grid-cols'
      );

      // 6. Starting Items & Money in Inventory
      const itemsList = [];
      actor.weapons().forEach((w) => {
        if (w) itemsList.push({ name: window.CCDbName(w), iconIndex: w.iconIndex || 116, qty: 1, type: "weapon", id: w.id });
      });
      actor.armors().forEach((a) => {
        if (a) itemsList.push({ name: window.CCDbName(a), iconIndex: a.iconIndex || 144, qty: 1, type: "armor", id: a.id });
      });
      if (typeof getClassStartingItems === "function") {
        const classItems = getClassStartingItems(actor._classId) || [];
        classItems.forEach((entry) => {
          const item = $dataItems[entry.id];
          if (item) itemsList.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: entry.qty || 1, type: "item", id: item.id });
        });
      }
      this._ccPushJobItems(actor, itemsList);

      const moneyRowHtml = this._ccLoadoutRowHtml(
        208,
        ccT('CharCreate.startingFunds', 'Starting Funds'),
        startingMoneyFormatted,
        { nameColor: '#ffd700', valueColor: '#a5d6a7' }
      );

      const loadoutItemsHtml = itemsList.map((it) => this._ccLoadoutRowHtml(
        it.iconIndex, it.name, `x${it.qty}`,
        { hover: `onmouseenter="SceneManager._scene.onItemHover(event, '${it.type}', ${it.id}, ${it.qty})" onmouseleave="SceneManager._scene.onItemLeave()"` }
      )).join("");

      const startingItemsSectionHtml = this._ccLoadoutSectionHtml(
        T('CharCreate.startingItems'),
        ccTp('CharCreate.entryCount', { n: itemsList.length + 1 }, (itemsList.length + 1) + ' entries'),
        moneyRowHtml + loadoutItemsHtml,
        T('CharCreate.noGear'),
        false,
        'cc-loadout-grid-cols'
      );

      // 7. The traits the member carries, priced the way the trait board prices
      // them, plus whatever illness they walk in with. It reads down the
      // sidebar beside the skills and the kit, so what a character IS is on the
      // same page as what they were given, on every step and not just on the
      // trait board.
      const traitRowsHtml = selectedTraitObjects(actor).map((tr) => {
        const cost = Number.isFinite(Number(tr.cost)) ? Number(tr.cost) : 1;
        const price = cost < 0
          ? `+${-cost}`
          : String(cost);
        return this._ccLoadoutRowHtml(
          tr.icon || 87,
          (tr.name && resolveTraitName(tr.name, tr.id)) || tr.id,
          price,
          { valueColor: cost < 0 ? '#a5d6a7' : '#ffd700', hover: this._ccHoverAttrs("trait", tr.id) }
        );
      }).join("");

      const illnessRowsHtml = ((actor._ccDiseases) || []).map((id) => {
        const card = this._ccDiseaseCards().find((c) => c.diseaseId === id);
        if (!card) return "";
        return this._ccLoadoutRowHtml(card.icon || 180, card.name, "", { nameColor: '#f87171' });
      }).filter(Boolean).join("");

      const traitTotal = selectedTraitObjects(actor).length + ((actor._ccDiseases || []).length);
      const traitsSectionHtml = this._ccLoadoutSectionHtml(
        T('CharCreate.traits'),
        ccTp('CharCreate.traitCount', { n: traitTotal }, traitTotal + ' traits'),
        traitRowsHtml + illnessRowsHtml,
        T('CharCreate.noDefiningTraits'),
        false,
        'cc-loadout-grid-cols'
      );

      // Rolling a character, or a whole party, is the wizard's business. The
      // tutorial is played as one of four dossiers and nothing else, so the two
      // buttons that would throw that dossier away are not drawn there.
      const randomizeBtnsHtml = Scene_CharacterCreation._tutorialMode ? '' : `
            <button class="cc-compact-btn" onclick="SceneManager._scene.onQuickRandomizeMember()">${ccT('CharCreate.randomizeMember', 'Randomize Member')}</button>
            <button class="cc-compact-btn" onclick="SceneManager._scene.createTotalRandomPartyAll()">${ccT('CharCreate.randomizeParty', 'Randomize Party')}</button>`;

      return `
        <div class="cc-compact-sidebar">
          <div class="cc-compact-sidebar-body">
            ${identityHeaderHtml}
            ${profileBoxHtml}
            ${statsHtml}
            ${traitsSectionHtml}
            ${skillsSectionHtml}
            ${startingItemsSectionHtml}
          </div>
          <div class="cc-compact-actions" style="display:flex; flex-direction:column; gap:6px;">
            ${randomizeBtnsHtml}
            <button class="cc-compact-btn primary" onclick="SceneManager._scene.onProceedToScenario()">${this._partyConfirmLabel()}</button>
          </div>
        </div>
      `;
    }

    // The preset board's own sidebar: the same sections a real member's carries
    // (identity, stats, traits, starting skills, starting kit), read straight
    // off the highlighted dossier's own record rather than off the actor,
    // which is not touched until "Apply" is actually pressed. Stats are the
    // class's own table at the dossier's level, with no trait deltas folded
    // in -- those only exist once applyTraitsToActor has run on a real actor,
    // which this preview deliberately never touches.

    _renderPersonalDossierHtml() {
      const actor = Scene_CharacterCreation.getCurrentActor();
      if (!actor) return `<div class="cc-page cc-page-right"></div>`;

      const classData = $dataClasses[actor._classId];
      const className = classData ? window.CCDbName(classData) : "Class";
      const genderName = actor.genderName ? actor.genderName() : ($gameVariables.value(38 + (Scene_CharacterCreation._currentPartyMemberIndex || 0)) === 0 ? "Male ♂" : "Female ♀");
      const startingGold = CC_BASE_START_GOLD + (typeof classStartingMoney === 'function' ? classStartingMoney(actor._classId) : 0) + (typeof traitStartingMoney === 'function' ? traitStartingMoney(actor) : 0) + (typeof wealthStartingMoney === 'function' ? wealthStartingMoney(actor) : 0);
      const startingMoneyFormatted = this._formatGoldToEuros(startingGold);
      const bustName = this._getActorBust(actor);
      const bustUrl = this._getBustUrl(bustName);

      // 8 Core Stats (HP, MP, STR, CON, INT, WIS, DEX, PSI)
      // Use class lv1 base × trait param rates only — equipment flat bonuses excluded.
      const _dossierStatNoEquip = (paramId, fallback) => {
        if (!classData) return fallback;
        const base = classData.params[paramId][1];
        const rate = (actor && typeof actor.paramRate === "function") ? actor.paramRate(paramId) : 1;
        return Math.round(base * rate) || fallback;
      };
      const SL = ccStatLabels();
      const stats = [
        { key: "HP",  label: SL.HP,  val: _dossierStatNoEquip(0, 450), color: "#81c784" },
        { key: "MP",  label: SL.MP,  val: _dossierStatNoEquip(1, 100), color: "#64b5f6" },
        { key: "STR", label: SL.STR, val: _dossierStatNoEquip(2, 12),  color: "#e57373" },
        { key: "CON", label: SL.CON, val: _dossierStatNoEquip(3, 10),  color: "#ffb74d" },
        { key: "DEX", label: SL.DEX, val: _dossierStatNoEquip(6, 10),  color: "#ffd54f" },
        { key: "INT", label: SL.INT, val: _dossierStatNoEquip(4, 10),  color: "#ba68c8" },
        { key: "WIS", label: SL.WIS, val: _dossierStatNoEquip(5, 10),  color: "#4db6ac" },
        { key: "PSI", label: SL.PSI, val: _dossierStatNoEquip(7, 10),  color: "#f06292" }
      ];

      const statBoxes = stats.map(st => `
        <div class="cc-stat-box" onmouseenter="SceneManager._scene.onStatHover(event, '${st.key}')" onmouseleave="SceneManager._scene.onItemLeave()">
          <span class="cc-stat-label">${st.label}</span>
          <span class="cc-stat-val">${st.val}</span>
        </div>
      `).join("");

      // Personal Inventory Items
      const itemsList = [];
      actor.weapons().forEach(w => {
        if (w) itemsList.push({ name: window.CCDbName(w), iconIndex: w.iconIndex || 116, qty: 1, type: "weapon", id: w.id });
      });
      actor.armors().forEach(a => {
        if (a) itemsList.push({ name: window.CCDbName(a), iconIndex: a.iconIndex || 144, qty: 1, type: "armor", id: a.id });
      });
      if (typeof getClassStartingItems === "function") {
        const classItems = getClassStartingItems(actor._classId) || [];
        classItems.forEach(entry => {
          const item = $dataItems[entry.id];
          if (item) itemsList.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: entry.qty || 1, type: "item", id: item.id });
        });
      }
      {
        selectedTraitObjects(actor).forEach(tr => {
          if (tr && tr.items) {
            tr.items.forEach(entry => {
              const itemId = (typeof entry === "object") ? entry.id : entry;
              const qty = (typeof entry === "object") ? (entry.qty || 1) : 1;
              const item = $dataItems[itemId];
              if (item) itemsList.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: qty, type: "item", id: item.id });
            });
          }
        });
      }

      const itemsRows = itemsList.map(it => `
        <div class="cc-compact-loadout-item"
             onmouseenter="SceneManager._scene.onItemHover(event, '${it.type}', ${it.id}, ${it.qty})"
             onmouseleave="SceneManager._scene.onItemLeave()">
          <span class="cc-loadout-icon">${this._ccIconHtml(it.iconIndex, 14)}</span>
          <span class="cc-loadout-name">${it.name}</span>
          <span class="cc-loadout-qty">x${it.qty}</span>
        </div>
      `).join("") || `<span style="font-size:0.75rem; color:rgba(255,255,255,0.4); font-style:italic;">${ccT('CharCreate.noPersonalEquipment', 'No personal equipment')}</span>`;

      // Traits badges
      const traitsBadges = selectedTraitObjects(actor).map(tr => {
        const name = (tr.name && resolveTraitName(tr.name, tr.id)) || tr.id;
        return `<span class="cc-element-badge" style="margin:2px; font-size:0.8rem;" ${this._ccHoverAttrs("trait", tr.id)}>${name}</span>`;
      }).join(" ");

      return `
        <div class="cc-page cc-page-right" style="display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:8px;">
            <div class="cc-money-badge" style="font-size:0.95rem;">
              ${this._ccIconHtml(208, 16)} <span>${startingMoneyFormatted}</span>
            </div>
          </div>

          <div class="cc-dossier-photo-frame" style="display:flex; align-items:center; justify-content:center; gap:16px; min-height:150px; padding:8px; background:rgba(0,0,0,0.5); border:1px solid rgba(218,165,32,0.3); border-radius:8px; margin-bottom:10px;">
            ${bustUrl ? `
              <div class="cc-dossier-large-bust" style="background-image: url('${bustUrl}');"></div>
            ` : ''}
            <div class="cc-wanted-sprite" style="${this.getSpriteStyle(actor.characterName(), actor.characterIndex())}; transform: scale(2); margin: 6px 0;"></div>
          </div>

          <div class="cc-dossier-card" style="padding:10px; margin-bottom:10px;">
            <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${ccT('CharCreate.name', 'Name')}:</span><span class="cc-dossier-value">${actor.name()}</span></div>
            <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${ccT('ClassSelect.vocation', 'Vocation')}:</span><span class="cc-dossier-value">${className}</span></div>
            <div class="cc-dossier-row" style="font-size:1.15rem; padding:4px 0;"><span class="cc-dossier-label">${ccT('CharCreate.gender', 'Gender')}:</span><span class="cc-dossier-value">${genderName}</span></div>
          </div>

          <div style="margin-bottom:8px;">
            <span class="cc-dossier-label" style="font-size:0.85rem; display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${ccT('CharCreate.coreAttributes', 'Core Attributes')}</span>
            <div class="cc-stat-grid">${statBoxes}</div>
          </div>

          <div class="cc-dossier-card" style="padding:8px; margin-bottom:8px; flex:1; min-height:0; display:flex; flex-direction:column;">
            <span class="cc-dossier-label" style="font-size:0.85rem; display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${ccT('CharCreate.personalInventory', 'Personal Inventory & Gear')}</span>
            <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">
              ${itemsRows}
            </div>
          </div>

          ${traitsBadges ? `
            <div style="margin-top:2px;">
              <span class="cc-dossier-label" style="font-size:0.8rem; display:block; margin-bottom:3px; text-transform:uppercase;">${ccT('CharCreate.traits', 'Traits')}</span>
              <div style="display:flex; flex-wrap:wrap; gap:3px;">${traitsBadges}</div>
            </div>
          ` : ''}
        </div>
      `;
    }

    // ── Dedicated Scenario / Mission Dossier Page ──
    // ── The scenario board ───────────────────────────────────────────────────
    // The last question of creation: where this party wakes up. The scenarios
    // are the question, so they hold the left page; the right page is the
    // answer sheet, the party as it will actually be played, one full dossier
    // per member, headed by the kit this scenario alone hands out.

    // What the scenario adds to the party purse on top of what the characters
    // themselves bring, from the same table giveStartingMoney pays out of.
    _scenarioGoldBonus(originSymbol) {
      return scenarioGoldBonus(originSymbol);
    }

    _scenarioItemRowHtml(entry) {
      return this._ccLoadoutRowHtml(entry.iconIndex, entry.name, `x${entry.qty}`, {
        hover: `onmouseenter="SceneManager._scene.onItemHover(event, '${entry.type}', ${entry.id}, ${entry.qty})" onmouseleave="SceneManager._scene.onItemLeave()"`
      });
    }

    // One member's whole sheet: who they are, what they can take, what they
    // know and what they are carrying when the game starts.
    _scenarioMemberSheetHtml(actor) {
      const classData = $dataClasses[actor._classId];
      const className = classData ? window.CCDbName(classData) : T('CharCreate.class');
      const bustUrl = this._getBustUrl(this._getActorBust(actor));
      const money = CC_BASE_START_GOLD
        + (typeof classStartingMoney === 'function' ? classStartingMoney(actor._classId) : 0)
        + (typeof traitStartingMoney === 'function' ? traitStartingMoney(actor) : 0)
        + (typeof wealthStartingMoney === 'function' ? wealthStartingMoney(actor) : 0);

      const stat = (label, value, key) => `
        <div class="cc-scenario-stat" onmouseenter="SceneManager._scene.onStatHover(event, '${key}')" onmouseleave="SceneManager._scene.onItemLeave()"><span>${label}</span><b>${value}</b></div>
      `;

      const traitBadges = selectedTraitObjects(actor).map((tr) => {
        const name = (tr.name && resolveTraitName(tr.name, tr.id)) || tr.id;
        return `<span class="cc-element-badge" ${this._ccHoverAttrs("trait", tr.id)}>${name}</span>`;
      }).filter(Boolean).join("");

      const illnessBadges = ((actor._ccDiseases) || []).map((id) => {
        const card = this._ccDiseaseCards().find((c) => c.diseaseId === id);
        return card ? `<span class="cc-element-badge bad">${card.name}</span>` : "";
      }).filter(Boolean).join("");

      const actorSkills = actor.skills().filter(Boolean);
      const skillRows = actorSkills.map((sk) =>
        this._ccLoadoutRowHtml(sk.iconIndex || 79, window.CCDbName(sk), "",
          { hover: this._ccHoverAttrs("skill", sk.id) })
      ).join("");

      const carried = [];
      actor.weapons().forEach((w) => {
        if (w) carried.push({ name: window.CCDbName(w), iconIndex: w.iconIndex || 116, qty: 1, type: "weapon", id: w.id });
      });
      actor.armors().forEach((a) => {
        if (a) carried.push({ name: window.CCDbName(a), iconIndex: a.iconIndex || 144, qty: 1, type: "armor", id: a.id });
      });
      if (typeof getClassStartingItems === "function") {
        (getClassStartingItems(actor._classId) || []).forEach((e) => {
          const item = $dataItems[e.id];
          if (item) carried.push({ name: window.CCDbName(item), iconIndex: item.iconIndex || 176, qty: e.qty || 1, type: "item", id: item.id });
        });
      }
      this._ccPushJobItems(actor, carried);

      const section = (title, body) => body
        ? `<div class="cc-scenario-section"><h4>${title}</h4>${body}</div>` : "";

      return `
        <div class="cc-scenario-sheet">
          <div class="cc-scenario-sheet-head">
            ${bustUrl ? `<div class="cc-scenario-sheet-bust" style="background-image:url('${bustUrl}');"></div>` : ''}
            <div class="cc-scenario-sheet-sprite" style="${this.getSpriteStyle(actor.characterName(), actor.characterIndex())}"></div>
            <div class="cc-scenario-sheet-id">
              <span class="cc-scenario-sheet-name">${actor.name()}</span>
              <span class="cc-scenario-sheet-class">${className}</span>
              <span class="cc-scenario-sheet-money">${this._formatGoldToEuros(money)}</span>
            </div>
          </div>

          <div class="cc-scenario-stat-grid">
            ${stat(T('CharCreate.abbrev.hp'), actor.mhp, 'HP')}
            ${stat(T('CharCreate.abbrev.mp'), actor.mmp, 'MP')}
            ${stat(T('CharCreate.abbrev.str'), actor.param(2), 'STR')}
            ${stat(T('CharCreate.abbrev.con'), actor.param(3), 'CON')}
            ${stat(T('CharCreate.abbrev.int'), actor.param(4), 'INT')}
            ${stat(T('CharCreate.abbrev.wis'), actor.param(5), 'WIS')}
            ${stat(T('CharCreate.abbrev.dex'), actor.param(6), 'DEX')}
            ${stat(T('CharCreate.abbrev.psi'), actor.param(7), 'PSI')}
          </div>

          ${section(T('CharCreate.traits'), traitBadges ? `<div class="cc-badge-wrap cc-badge-grid-3">${traitBadges}</div>` : "")}
          ${section(ccT('Traits.tabDiseases', 'Diseases'), illnessBadges ? `<div class="cc-badge-wrap cc-badge-grid-3">${illnessBadges}</div>` : "")}
          ${this._ccLoadoutSectionHtml(
            T('CharCreate.startingSkills'),
            ccTp('CharCreate.skillCount', { n: actorSkills.length }, actorSkills.length + ' skills'),
            skillRows,
            T('CharCreate.noStartingSkills'),
            true,
            'cc-loadout-grid-cols-3'
          )}
          ${this._ccLoadoutSectionHtml(
            T('CharCreate.startingItems'),
            ccTp('CharCreate.entryCount', { n: carried.length }, carried.length + ' entries'),
            carried.map((e) => this._scenarioItemRowHtml(e)).join(""),
            T('CharCreate.noGear'),
            true,
            'cc-loadout-grid-cols-3'
          )}
        </div>
      `;
    }

    _renderScenarioDossierHtml() {
      const stepData = CharacterCreationData[STEP.ORIGIN] || { choices: [] };
      const activeIndex = this._gridWindow ? this._gridWindow.index() : 0;
      const originChoice = (stepData.choices && stepData.choices[activeIndex]) || {};
      const originSymbol = originChoice.symbol || $gameSystem._ccOriginSymbol || "origin_train";

      // The flat purse is paid once to the whole party, not once per member
      // (giveStartingMoney does the same), so it sits outside the loop below.
      const partyMembers = $gameParty ? $gameParty.members() : [];
      let totalGold = CC_BASE_START_GOLD + this._scenarioGoldBonus(originSymbol);
      partyMembers.forEach((a) => {
        const NC = window.NPCCreature;
        if (NC && NC.isNonSentientActor(a)) return;
        totalGold += (typeof classStartingMoney === 'function' ? classStartingMoney(a._classId) : 0)
          + (typeof traitStartingMoney === 'function' ? traitStartingMoney(a) : 0)
          + (typeof wealthStartingMoney === 'function' ? wealthStartingMoney(a) : 0);
      });

      // The kit this scenario alone hands out, on top of what the characters
      // already carry: the one thing the choice on the left actually changes
      // about the loadout, so it is shown apart rather than folded into the
      // party's consolidated inventory where it used to be invisible.
      const exclusive = (resolveOriginLoadout(originSymbol) || []).map((e) => {
        const data = loadoutEntryData(e);
        if (!data) return null;
        const type = e.kind === "weapon" || e.kind === "armor" ? e.kind : "item";
        return { name: window.CCDbName(data), iconIndex: data.iconIndex || 176, qty: e.qty || 1, type, id: data.id };
      }).filter(Boolean);
      const goldBonus = this._scenarioGoldBonus(originSymbol);

      // The party's shared bag, apart from the scenario's own exclusive kit:
      // what the party is already carrying going into the choice above.
      const partyInventory = $gameParty.allItems().filter((it) => it && it.name).map((it) => {
        const type = DataManager.isWeapon(it) ? "weapon" : DataManager.isArmor(it) ? "armor" : "item";
        return { name: window.CCDbName(it), iconIndex: it.iconIndex || 176, qty: $gameParty.numItems(it), type, id: it.id };
      });

      // A scenario card is its name: the line under it is the brief on the
      // right page, and printing it twice only made the list harder to scan.
      const scenarioCards = (stepData.choices || []).map((choice, index) => `
        <div class="cc-card-option cc-scenario-card ${index === activeIndex ? 'selected' : ''}"
             onclick="SceneManager._scene.onOptionCardClick(${index})">
          <div class="cc-option-title">${choice.name}</div>
        </div>
      `).join("");

      return `
        <div class="cc-scenario-dossier">
          <div class="cc-page cc-scenario-list">
            <div class="cc-scenario-list-head">
              <h2 class="cc-subheader">${ccT('CharCreate.scenarioPickPrompt', 'Pick the scenario this party starts in')}</h2>
              <span class="ts-count">${(stepData.choices || []).length}</span>
            </div>
            <div class="cc-select-grid cc-scenario-grid">
              ${scenarioCards}
            </div>
            <div class="cc-scenario-list-actions">
              <button class="cc-compact-btn cc-scenario-back" onclick="SceneManager._scene.onReturnToPartyDossier()">
                ${this._ccIconHtml(82, 16)} <span>${ccT('CharCreate.returnToParty', 'Return to Party Configuration')}</span>
              </button>
            </div>
          </div>

          <div class="cc-page cc-scenario-brief">
            <div class="cc-scenario-brief-head">
              <h2 class="cc-header-gothic">${originChoice.name || ""}</h2>
              <div class="cc-money-badge">${this._ccIconHtml(208, 16)} <span>${this._formatGoldToEuros(totalGold)}</span></div>
            </div>
            <p class="cc-class-quote">${this.cleanText(originChoice.description || "")}</p>

            <div class="cc-scenario-brief-body">
              <div class="cc-dossier-card cc-class-section">
                <h3 class="cc-subheader">
                  <span>${ccT('CharCreate.scenarioExclusiveItems', 'Exclusive kit')}</span>
                  ${goldBonus ? `<span class="cc-scenario-bonus">+${this._formatGoldToEuros(goldBonus)}</span>` : ''}
                </h3>
                ${exclusive.length
                  ? `<div class="cc-compact-loadout-grid cc-loadout-open cc-loadout-grid-cols">${exclusive.map((e) => this._scenarioItemRowHtml(e)).join("")}</div>`
                  : `<span class="cc-class-none">${ccT('CharCreate.scenarioNoExclusiveItems', 'No exclusive kit for this scenario')}</span>`}
              </div>

              <div class="cc-dossier-card cc-class-section">
                <h3 class="cc-subheader">
                  <span>${ccT('CharCreate.scenarioPartyInventory', 'Party inventory')}</span>
                  ${partyInventory.length ? `<span class="ts-count">${partyInventory.length}</span>` : ''}
                </h3>
                ${partyInventory.length
                  ? `<div class="cc-compact-loadout-grid cc-loadout-open cc-loadout-grid-cols-3">${partyInventory.map((e) => this._scenarioItemRowHtml(e)).join("")}</div>`
                  : `<span class="cc-class-none">${ccT('CharCreate.scenarioNoPartyInventory', 'The party is not carrying anything yet')}</span>`}
              </div>
            </div>

            <div class="cc-scenario-brief-actions">
              <button class="cc-compact-btn primary cc-scenario-embark" onclick="SceneManager._scene.onFinishPartyCreation()">${ccT('CharCreate.embark', "Embark & Begin Journey")}</button>
            </div>
          </div>

          <div class="cc-page cc-scenario-roster-col">
            <h3 class="cc-subheader cc-scenario-roster-head">
              <span>${ccT('CharCreate.scenarioRoster', 'Party dossiers')}</span>
              <span class="ts-count">${partyMembers.length}</span>
            </h3>
            <div class="cc-scenario-sheets">
              ${partyMembers.map((a) => this._scenarioMemberSheetHtml(a)).join("")}
            </div>
          </div>
        </div>
      `;
    }

    // What the sidebar's own primary button says. The tutorial never reaches
    // the scenario board (its dossier says where the party wakes up), so the
    // button there names what pressing it actually does: the party is settled
    // first, and only the vehicle page after it begins the adventure.
    _partyConfirmLabel() {
      if (Scene_CharacterCreation._tutorialMode) {
        return this._step === STEP.VEHICLE
          ? ccT('CharCreate.beginAdventure', 'Begin Adventure')
          : ccT('CharCreate.confirmParty', 'Confirm Party');
      }
      return this._hasPresetInParty(false)
        ? ccT('CharCreate.startGame', 'Start Game')
        : ccT('CharCreate.confirmPartyScenario', 'Confirm Party & Scenario');
    }

    onProceedToScenario() {
      // The tutorial asks for no scenario, but it does ask for a vehicle, so
      // that page is what confirming the party leads to. On the page itself the
      // button takes the highlighted vehicle, which is what ends creation.
      if (Scene_CharacterCreation._tutorialMode) {
        if (this._step === STEP.VEHICLE) {
          this.onGridOk();
        } else {
          this.goToTutorialVehicleStep();
        }
        return;
      }
      // If any party member is a preset character, skip scenario selection and finalize immediately!
      if (this._hasPresetInParty(false)) {
        this.onFinishPartyCreation();
        return;
      }
      Scene_CharacterCreation._isScenarioMode = true;
      this._step = STEP.ORIGIN;
      SoundManager.playOk();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }

    onReturnToPartyDossier() {
      Scene_CharacterCreation._isScenarioMode = false;
      this._step = STEP.CLASS;
      SoundManager.playCancel();
      this._lastStep = -1;
      this._lastIndex = -1;
      this.refreshUIOverlayDOM();
    }


    _startingInventoryEntries() {
      const entries = [];
      for (const item of $gameParty.allItems()) {
        if (!item || !item.name) continue;
        entries.push({ item, qty: $gameParty.numItems(item), name: window.CCDbName(item), note: "" });
      }
      for (const member of $gameParty.members()) {
        for (const gear of member.equips()) {
          if (!gear || !gear.name) continue;
          entries.push({ item: gear, qty: 1, name: window.CCDbName(gear), note: member.name() });
        }
      }
      return entries;
    }

    // The inventory card that closes the party panel, under the last slot.
    _startingInventoryHtml(entries) {
      const title = T('CharCreate.startingInventory');
      if (!entries.length) {
        return `
          <div class="cc-party-card">
            <div class="cc-party-card-header">
              <div class="cc-party-card-name">${title}</div>
            </div>
            <div class="cc-party-card-body">
              <div class="cc-party-card-vacant-text">${T('CharCreate.nothingYet')}</div>
            </div>
          </div>
        `;
      }

      const chips = entries.map((e) => {
        const worn = e.note
          ? `<span class="cc-inv-worn">${T('CharCreate.wornBy')} ${e.note}</span>`
          : "";
        const count = e.qty > 1 ? `<span class="cc-inv-qty">x${e.qty}</span>` : "";
        return `
          <div class="cc-inv-chip">
            <span style="${this._ccIconStyle(e.item.iconIndex, 22)}"></span>
            <span class="cc-inv-name">${e.name}</span>
            ${count}
            ${worn}
          </div>
        `;
      }).join("");

      return `
        <div class="cc-party-card">
          <div class="cc-party-card-header">
            <div class="cc-party-card-name">${title}</div>
            <div class="cc-party-card-class">${entries.length} ${T('CharCreate.entries')}</div>
          </div>
          <div class="cc-party-card-body">
            <div class="cc-inv-list">${chips}</div>
          </div>
        </div>
      `;
    }

    // Generate the NPC-system lore (society profile + historical backstory) for
    // a finalized actor so it can be shown behind the party card and browsed
    // later in the Party section of the NPC wiki (openForActor). Called only
    // when a member's signature changes (see _wizardPartyPanelHtml), never on a
    // plain cursor move.
  }

  for (const key of Object.getOwnPropertyNames(CCDossierPages.prototype)) {
    if (key === "constructor") continue;
    Object.defineProperty(
      Scene_CharacterCreation.prototype, key,
      Object.getOwnPropertyDescriptor(CCDossierPages.prototype, key)
    );
  }
})();
