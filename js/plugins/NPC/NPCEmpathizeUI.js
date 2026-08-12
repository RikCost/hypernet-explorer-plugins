/*:
 * @target MZ
 * @plugindesc NPCEmpathizeUI v3.0.0, DOM overlay for Scene_NPCEmpathize
 * @author Omni-Lex
 * @help NPCEmpathizeUI.js
 *
 * DOM layer for the NPC Interaction Panel.
 * Must be listed AFTER NPCEmpathize.js in the Plugin Manager.
 *
 * Load Order:
 *   NPCEmpathize → NPCEmpathizeUI
 */

(function () {
  'use strict';

  if (!window.NPCEmpathize?.Scene_NPCEmpathize) {
    throw new Error('NPCEmpathizeUI.js requires NPCEmpathize.js to be loaded first!');
  }

  const { Scene_NPCEmpathize, Wiki } = window.NPCEmpathize;
  const {
    _getNPCName, _getProfile, _extractClassId,
    _resolveBustForActor, _resolveBustPath, _presetFromEvent,
    _computePartyPredisposition, _medianScore, _generatePartyThoughts,
    _extractContacts, _countRecentInteractions, _lastInteractionDay,
    _joinChance, _joinLevelOk, _travellingPartyCount, _hasSelfSwitchAPage,
    _diseaseVialItems, _diseaseVialId, _infectChance,
    _socialLines, _rand, _addNpcOpinion, _personalitySocialMult,
    _hygienePenalty, _hygieneReadout,
    _emPlaythrough, _isEmActor, _isBubbaNpc, _emContext, _emStanceKey, _emStanceData,
    _bubbaPlaythrough, _isBubbaActor, _bubbaContext, _bubbaDb,
    _isNonSentientActor, FERAL_ACTIONS,
  } = window.NPCEmpathize._helpers;
  const _getT = window.NPCEmpathize._getT;

  // ============================================================================
  // Local UI helpers
  // ============================================================================

  function _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Every box in the panel that is allowed to scroll, in the order they should
  // be preferred when nothing is under the cursor.
  const _SCROLL_BOXES =
    '.npc-chat-bubbles, .npc-chat-actions-row, .npc-right-panel, .npc-vitals-footer, .npc-left-col';

  function _isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll';
  }

  // Nearest ancestor of `node` (stopping at, and excluding, `stopAt`) that can
  // actually be scrolled vertically right now. Used to route wheel ticks by hand,
  // see the overlay's wheel listener.
  function _scrollableUnder(node, stopAt) {
    for (let el = node; el && el !== stopAt; el = el.parentElement) {
      if (_isScrollable(el)) return el;
    }
    return null;
  }

  // Fallback for the wheel guard: the panel's own scroll boxes, hit-tested
  // against the cursor. Used when the wheel event's target is not inside the
  // overlay at all (some other DOM layer sitting on top). Innermost wins, which
  // here just means the shortest matching box.
  function _scrollableAtPoint(root, x, y) {
    if (!(x >= 0) || !(y >= 0)) return null;
    let best = null;
    for (const el of root.querySelectorAll(_SCROLL_BOXES)) {
      if (!_isScrollable(el)) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (!best || r.height < best.getBoundingClientRect().height) best = el;
    }
    return best;
  }

  function _iconSpan(iconIndex, size) {
    size = size || 22;
    const scale = (size / 32).toFixed(4);
    const col   = iconIndex % 16;
    const row   = Math.floor(iconIndex / 16);
    return (
      `<span style="display:inline-block;width:${size}px;height:${size}px;overflow:hidden;flex-shrink:0;vertical-align:middle;">` +
      `<span style="display:block;width:32px;height:32px;transform:scale(${scale});transform-origin:top left;` +
      `background:url('img/system/IconSet.png') -${col * 32}px -${row * 32}px no-repeat;image-rendering:pixelated;"></span></span>`
    );
  }

  function _vitalRow(label, value, lowThreshold) {
    const v     = Math.round(value ?? 100);
    const color = v < lowThreshold ? '#d9534f' : '#5a9a2a';
    return `
      <div class="npc-vital-row">
        <span class="npc-vital-lbl">${label}</span>
        <div class="npc-vital-track"><div class="npc-vital-fill" style="width:${v}%;background:${color};"></div></div>
        <span class="npc-vital-pct">${v}%</span>
      </div>`;
  }

  // A craving is a need read backwards, so its row fills as things get worse
  // and its warning band is the high end. Same numbers the status screen and
  // the parchment menu show, so one addict reads the same in all three.
  function _cravingRow(label, value) {
    const v     = Math.max(0, Math.min(100, Math.round(value ?? 0)));
    const color = v >= 80 ? '#d9534f' : v >= 50 ? '#b8860b' : '#7B6A55';
    return `
      <div class="npc-vital-row">
        <span class="npc-vital-lbl">${label}</span>
        <div class="npc-vital-track"><div class="npc-vital-fill" style="width:${v}%;background:${color};"></div></div>
        <span class="npc-vital-pct">${v}%</span>
      </div>`;
  }

  const NEED_ICONS = {
    sleep: 11, hunger: 259, hygiene: 67, work: 4, shopwork: 4, money: 314,
    crime: 174, safety: 128, comfort: 226, social: 246, leisure: 80,
  };

  function _needLabels(T) {
    return {
      sleep: T.resting, hunger: T.hungry, hygiene: T.freshening, work: T.working, shopwork: T.working,
      money: T.earning, crime: T.scheming, safety: T.wary, comfort: T.relaxing,
      social: T.socializing, leisure: T.leisure, traveling: T.traveling,
    };
  }

  // Interacting with an NPC while they're riding a PublicTransport-group map
  // (bus/tram/train) overrides their routine's current hour to "Traveling",
  // regardless of whatever the day's generated plan had scheduled, since
  // they're plainly not doing that right now, see Scene_NPCEmpathize.create.
  function _markTravelingIfOnTransport(eventId) {
    const RM = window.NPCSim?.RoutineManager;
    if (!RM || eventId == null) return;
    const seatedGroups = window.NPCSystem?.SEATED_GLOBAL_GROUPS;
    if (!seatedGroups?.length) return;
    const groupName = window.NPCSystem?.findMapGroupByMap?.($gameMap?.mapId());
    if (!groupName || !seatedGroups.includes(groupName)) return;

    const npcName = _getNPCName(eventId);
    const profile = npcName && _getProfile(npcName);
    if (!profile) return;

    RM.ensureRoutine(profile);
    const nowMin  = $gameVariables?.value(114) ?? 0;
    const hourNow = Math.floor((nowMin % 1440) / 60);
    profile.routine[hourNow] = 'traveling';
  }

  // "work"/"shopwork" routine slots get an enriched label with the job name
  // and/or workplace map name when that information is available.
  function _activityLabel(activity, profile, T, needLabels) {
    if (activity === 'work') {
      const job = window.NPCSim?.JobManager?.getJob?.(profile);
      if (job) {
        const mapName = window.NPCSim.JobManager.getJobWorkMapName?.(profile) || '';
        return T.workAs(job.name, mapName);
      }
    }
    if (activity === 'shopwork') {
      const assign = $gameSystem?._npcShopAssignments?.[profile?._eventName];
      // <ShopName: Ticketman> on the shop event overrides the generic title.
      if (assign) return T.workAsShopkeeper(assign.shopName || T.shopkeeperTitle, assign.mapName);
    }
    return needLabels[activity] || activity;
  }

  function _traitDisplayName(trait) {
    if (!trait) return '?';
    const seg = (trait.name || '').split('.')[1] || (trait.name || '?');
    return seg.split(/[_\-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Deterministic per-seed RNG (mulberry32-ish), so an NPC's "random" flavor
  // specializations stay stable across repeat renders/re-opens instead of
  // rerolling every time the Info tab redraws.
  function _seededRandom(seedStr) {
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
    return function () {
      h |= 0; h = (h + 0x6D2B79F5) | 0;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Specializations (js/db/Skills/Specialization.json via SpecializationMenu.js)
  // an NPC shows as trained: whatever its class/traits grant a head start in,
  // plus 3-6 random ones (deterministic per NPC, cached on the profile so they
  // don't reroll every redraw) so every NPC feels individually specialized.
  // Only specializations above Untrained are ever returned - the "random"
  // picks are simply pre-rolled as already trained (level 2-4).
  function _getNpcSpecializations(profile, classId, dl, npcName) {
    if (!window.Specializations || !window.Specializations.ready) return [];
    if (profile && profile._specCache) return profile._specCache;

    const levelById = new Map();
    const className = (classId != null && $dataClasses?.[classId]) ? $dataClasses[classId].name : null;
    const traitSlugs = [];
    (profile?.traitIds || []).forEach((id) => {
      const trait = dl?.traits?.find((t) => t.id === id);
      const slug = trait?.name ? trait.name.split('.')[1] : null;
      if (slug) traitSlugs.push(slug);
    });

    window.Specializations.list.forEach((spec) => {
      let lvl = 0;
      if (className && spec.classStart?.[className]) lvl = Math.max(lvl, spec.classStart[className]);
      traitSlugs.forEach((slug) => {
        if (spec.traitStart?.[slug]) lvl = Math.max(lvl, spec.traitStart[slug]);
      });
      if (lvl > 1) levelById.set(spec.id, lvl);
    });

    const rng = _seededRandom(`${npcName || 'npc'}:specializations`);
    const extraCount = 3 + Math.floor(rng() * 4); // 3..6
    const pool = window.Specializations.list.filter((s) => !levelById.has(s.id));
    for (let i = 0; i < extraCount && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length);
      const spec = pool.splice(idx, 1)[0];
      levelById.set(spec.id, 2 + Math.floor(rng() * 3)); // 2..4, Beginner-Advanced
    }

    // Levels another system has pinned onto this person, which always win over
    // the rolled ones (ErisTrial.js writes Law onto the world's five advocates,
    // so a defence lawyer reads as one here too).
    const overrides = profile && profile._specOverrides;
    if (overrides) {
      for (const [id, lvl] of Object.entries(overrides)) {
        const n = Number(lvl);
        if (n > 1) levelById.set(Number(id), Math.max(levelById.get(Number(id)) || 0, n));
      }
    }

    const rows = [];
    levelById.forEach((lvl, id) => {
      const spec = window.Specializations.byId.get(id);
      if (spec) rows.push({ name: window.Specializations.displayName(spec), levelName: window.Specializations.levelName(lvl) });
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));

    if (profile) profile._specCache = rows;
    return rows;
  }

  // A party member is not an NPC to be guessed at: the specializations they show
  // are the ones the player trained (SpecializationMenu's own reading of class
  // floor + trait floor + trained level), never the 3-6 flavour picks a stranger
  // of that name was dealt.
  function _getActorSpecializations(actor) {
    if (!actor || !window.Specializations?.ready || !actor.specializationLevel) return [];
    const rows = [];
    window.Specializations.list.forEach(spec => {
      const lvl = actor.specializationLevel(spec.id);
      if (lvl > 1) rows.push({ name: window.Specializations.displayName(spec), levelName: window.Specializations.levelName(lvl) });
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }

  function _factionDisplayName(faction) {
    if (!faction) return '?';
    const localized = window._NPCSocietyDataLoader?.getFactionName?.(faction);
    if (localized) return localized;
    const seg = (faction.name || '').split('.')[1] || (faction.name || '?');
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  }

  // Readable home-town name for the "Citizen of" row. Map-pool NPCs already use
  // a human name for their home group; procedural NPCs are keyed "Proc:x,y", so
  // surface the descriptive name stored on the settlement group instead of the
  // raw coordinate key.
  function _homeTownLabel(groupName) {
    if (!groupName) return '';
    const grp = $gameSystem?._npcMapGroups?.[groupName];
    if (grp?.displayName) return grp.displayName;
    if (/^Proc:/i.test(groupName)) return grp?.country ? T('Empathize.frontierOf', { country: grp.country }) : T('Empathize.frontierSettlement');
    // Map-group keys are written without spaces ("FrozenStation"); the town of
    // that name in Destinations.json knows how it is meant to read.
    return window.WorkSystem?.destinationName ? window.WorkSystem.destinationName(groupName) : groupName;
  }

  // ============================================================================
  // Preset dossier helpers ("Preset: <name>" event comment)
  // ============================================================================

  // Age against the in-game calendar (TimeDateSystem), same maths the character
  // creation dossier uses, so both screens agree on how old a preset is now.
  function _presetAge(birthDate) {
    if (!birthDate) return null;
    const [year, month, day] = String(birthDate).split('-').map(Number);
    if (!year) return null;
    const tds = window.TimeDateSystem;
    if (!tds?.getGameTimeMinutes || !tds?.getDateTimeFromMinutes) return null;
    const now = tds.getDateTimeFromMinutes(tds.getGameTimeMinutes());
    let age = now.year - year;
    const curMonth = Number(now.monthNum);
    if (curMonth < (month || 1) || (curMonth === (month || 1) && now.day < (day || 1))) age -= 1;
    return age >= 0 ? age : null;
  }

  // Presets store "YYYY-MM-DD"; the dossier prints DD/MM/YYYY.
  function _presetBirthDate(birthDate) {
    if (!birthDate) return '';
    const parts = String(birthDate).split('-');
    if (parts.length !== 3) return String(birthDate);
    return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
  }

  function _presetGenderLabel(gender, T) {
    const labels = [
      T.genderMale,
      T.genderFemale,
      T.genderNonBinary,
      T.genderCocoon,
    ];
    return labels[gender] ?? '';
  }

  function _presetLore(preset, lang) {
    if (!preset) return '';
    // Resolved through the presets plugin: an endless dossier (Em) has no
    // written lore field, hers is composed per playthrough.
    // Already resolved to the active language by the presets plugin.
    return window.CharacterPresets?.getPresetLore?.(preset) ?? '';
  }

  // Same story for the hometown: Em's is rolled per incarnation.
  function _presetHometown(preset) {
    if (!preset) return '';
    return window.CharacterPresets?.getPresetHometown?.(preset) ?? (preset.hometown || '');
  }

  function _presetClassName(preset) {
    return (preset && $dataClasses?.[preset.classId]) ? $dataClasses[preset.classId].name : '';
  }

  // The character sheet this person is actually wearing, which is the only
  // thing that says whether they are from here at all. The society roll owns it
  // where it made one; otherwise it is whatever the map event is drawn with, and
  // for somebody read remotely (from the wiki or a chat link) their pool
  // template, exactly the order _resolveBustPath reads them in.
  function _npcSpriteKey(profile, npcName, evId) {
    if (profile?.spriteKey) return profile.spriteKey;
    const ev = evId != null ? $gameMap?.event(evId) : null;
    const fromEvent = ev?.event()?.characterName ?? ev?.event()?.pages?.[0]?.image?.characterName;
    if (fromEvent) return fromEvent;
    if (npcName && window.NPCSystem?.findTemplateSprite) {
      const tpl = window.NPCSystem.findTemplateSprite(npcName);
      if (tpl?.characterName) return tpl.characterName;
    }
    return null;
  }

  // Who this person is when they are not from this world: caste, home system,
  // and the power that claims them. Null for everybody else.
  function _alienIdentity(profile, npcName, evId) {
    if (!window.AlienOrigins) return null;
    return window.AlienOrigins.identify(_npcSpriteKey(profile, npcName, evId), npcName);
  }

  // ============================================================================
  // Wiki helpers, hyperlinks, linkified text, meters
  // ============================================================================

  function _wikiLink(type, id, label) {
    const safeId = encodeURIComponent(String(id));
    return `<span class="npc-wiki-link" onmousedown="event.stopPropagation();window.NPCEmpathize.openEntity('${type}','${safeId}')">${_escapeHtml(label ?? id)}</span>`;
  }

  // In an empty world nobody outlived 1 January 2000. Every roster the wiki
  // prints marks its dead with a dagger and, where it has one, the date; these
  // two answer both for a world where being alive is not on offer, so a
  // listing agrees with the dossier the same name opens (see
  // NPCEmpathize._emptyWorldDeath).
  const EMPTY_WORLD_DEATH_DATE = '2000-01-01';
  function _emptyWorld() {
    const WM = window.WorldManager;
    return !!(WM && typeof WM.isEmptyWorld === 'function' && WM.isEmptyWorld());
  }
  // Whether this name should read as dead, and the date to print beside it.
  function _wikiIsDead(isDead) { return isDead || _emptyWorld(); }
  function _wikiDeathDate(stored) {
    if (stored) return stored;
    return _emptyWorld() ? EMPTY_WORLD_DEATH_DATE : null;
  }

  // Escapes raw text and turns every known entity name (nations, hyperpowers,
  // leaders, artifacts, factions) into a clickable wiki link.
  function _linkify(rawText) {
    const esc = _escapeHtml(rawText);
    const re = Wiki.linkPattern();
    if (!re) return esc;
    return esc.replace(re, (match) => {
      const ent = Wiki.resolveEscaped(match);
      if (!ent) return match;
      const safeId = encodeURIComponent(String(ent.id));
      return `<span class="npc-wiki-link" onmousedown="event.stopPropagation();window.NPCEmpathize.openEntity('${ent.type}','${safeId}')">${match}</span>`;
    });
  }

  function _meterRow(label, value, color) {
    const v = Math.round(Math.max(0, Math.min(100, value ?? 0)));
    return `
      <div class="npc-vital-row">
        <span class="npc-vital-lbl">${_escapeHtml(label)}</span>
        <div class="npc-vital-track"><div class="npc-vital-fill" style="width:${v}%;background:${color};"></div></div>
        <span class="npc-vital-pct">${v}</span>
      </div>`;
  }

  // A -100..+100 political axis (econ/auth/trad/mil/myst), centered at 50%
  // fill so the bar itself shows which side of neutral a creed leans to; the
  // printed number stays signed, unlike _statBarRow's raw 0..max reading.
  function _axisBarRow(label, value, color) {
    const v = Math.round(Math.max(-100, Math.min(100, value ?? 0)));
    const pct = (v + 100) / 2;
    return `
      <div class="npc-vital-row">
        <span class="npc-vital-lbl">${_escapeHtml(label)}</span>
        <div class="npc-vital-track"><div class="npc-vital-fill" style="width:${pct}%;background:${color};"></div></div>
        <span class="npc-vital-pct" style="width:44px;">${v > 0 ? '+' : ''}${v}</span>
      </div>`;
  }

  function _statBarRow(label, value, max, color) {
    const pct = Math.round(Math.max(0, Math.min(100, (value / max) * 100)));
    return `
      <div class="npc-vital-row">
        <span class="npc-vital-lbl">${_escapeHtml(label)}</span>
        <div class="npc-vital-track"><div class="npc-vital-fill" style="width:${pct}%;background:${color || '#8b5a2b'};"></div></div>
        <span class="npc-vital-pct" style="width:44px;">${value}</span>
      </div>`;
  }

  function _kvRow(iconIdx, label, valueHTML) {
    return `<div class="npc-ident-row">${_iconSpan(iconIdx, 17)}<span style="opacity:0.65;">${_escapeHtml(label)}:</span>&nbsp;<span>${valueHTML}</span></div>`;
  }

  function _eventRows(events, ICONS) {
    return (events || []).slice().reverse().map(e => `
      <div class="npc-life-row">
        <span class="npc-life-time">${_escapeHtml(e.date ?? '?')}</span>
        ${_iconSpan(e.iconIndex ?? (ICONS?.[e.category] ?? 0), 14)}
        <span>${_linkify(_goldTextToEuros(e.description ?? e.desc ?? ''))}</span>
      </div>`).join('');
  }

  // Shared with the rest of the NPC suite (NPCShared.formatMoney): 100g = 1.00€.
  function _euros(gold) {
    if (window.NPCShared?.formatMoney) return window.NPCShared.formatMoney(gold);
    const eur = Math.floor(Number(gold) || 0) / 100;
    if (eur >= 1_000_000_000) return `${(eur / 1_000_000_000).toFixed(2)}B€`;
    if (eur >= 1_000_000)     return `${(eur / 1_000_000).toFixed(2)}M€`;
    if (eur >= 1_000)         return `${(eur / 1_000).toFixed(1)}K€`;
    return `${eur.toFixed(2)}€`;
  }

  // Life-record / chronicle descriptions embed raw gold amounts as "<n>g"
  // (e.g. "moved to a villas (42881g saved)"). Rewrite every such amount into
  // the euro display used everywhere else in this panel (the usual gold/100
  // formula via _euros).
  function _goldTextToEuros(text) {
    return String(text ?? '').replace(/(\d[\d,]*)\s*g\b/g, (m, num) =>
      _euros(Number(String(num).replace(/,/g, ''))));
  }

  // The kicker under a wiki profile's title. Read through emblemOf() so the
  // word follows the language; the glyph is art and never moves.
  const ENTITY_EMBLEM = {
    nation:   { glyph: '⚑', kickerKey: 'wikiKindNation' },
    power:    { glyph: '♛', kickerKey: 'wikiKindPower' },
    leader:   { glyph: '☻', kickerKey: 'wikiKindLeader' },
    artifact: { glyph: '✦', kickerKey: 'wikiKindArtifact' },
    faction:  { glyph: '⚜', kickerKey: 'wikiKindFaction' },
    party:    { glyph: '⚖', kickerKey: 'wikiKindParty' },
    ideology: { glyph: '✪', kickerKey: 'wikiKindIdeology' },
  };

  function _emblemOf(type) {
    const e = ENTITY_EMBLEM[type];
    if (!e) return { glyph: '?', kicker: '' };
    return { glyph: e.glyph, kicker: T('Empathize.' + e.kickerKey) };
  }

  // The localized display name of an Ideology.json creed, by id, or '' if the
  // party carries none (which never happens for a curated real party, but a
  // hand-authored one might).
  function _ideologyLabel(ideologyId) {
    if (!ideologyId) return '';
    const ideo = window.NPCShared?.ideologyById?.(ideologyId);
    if (!ideo) return '';
    return window.T ? window.T(ideo.name) : ideologyId;
  }

  // The eight $dataItems.params labels, in param order, taken from the same
  // stats.json bank _statLabels() reads further down so an artifact's stat line
  // names the six attributes the way the rest of the game does.
  const _paramLabels = () => {
    const L = _statLabels();
    return ['HP', 'MP', L.atk, L.def, L.mat, L.mdf, L.agi, L.luk];
  };
  // Weapon and armor type names, indexed by wtypeId / atypeId. The database
  // carries the localized names, so read those and keep the table as the
  // fallback for a project that has not filled them in.
  // i18n-ignore-start: mirrors $dataSystem.weaponTypes / armorTypes, which
  // Hendrix_Localization translates through js/i18n/<lang>/types.json
  const WTYPE_NAMES = ['—', 'Light', 'Sword', 'Heavy', 'Axe', 'Whip', 'Staff', 'Bow', 'Projectile', 'Gun', 'Claw', 'Glove', 'Spear'];
  const ATYPE_NAMES = ['—', 'General', 'Magic', 'Light', 'Heavy', 'Small Shield', 'Large Shield'];
  // i18n-ignore-end
  const _wtypeName = (id) => ($dataSystem?.weaponTypes || [])[id] || WTYPE_NAMES[id] || '?';
  const _atypeName = (id) => ($dataSystem?.armorTypes || [])[id] || ATYPE_NAMES[id] || '?';

  // ============================================================================
  // Wrap create, add DOM overlay after base scene setup
  // ============================================================================

  const _Scene_NPCEmpathize_create = Scene_NPCEmpathize.prototype.create;
  Scene_NPCEmpathize.prototype.create = function () {
    _Scene_NPCEmpathize_create.call(this);
    _markTravelingIfOnTransport(this._eventId);
    this._buildOverlay();
    this._render();
    setTimeout(() => { if (this._overlay) this._overlay.style.opacity = '1'; }, 16);
  };

  // ============================================================================
  // Overlay lifecycle
  // ============================================================================

  Scene_NPCEmpathize.prototype._buildOverlay = function () {
    if (window._npcEmpathizeTimeout) {
      clearTimeout(window._npcEmpathizeTimeout);
      window._npcEmpathizeTimeout = null;
      // ~25 plugins share the #menu-container id (e.g. CustomMainMenuLayout
      // keeps its own copy parked in the DOM at opacity 0), only ever
      // remove OUR stale overlay, never another plugin's container.
      const stale = document.querySelector('#menu-container.npc-empathize-overlay');
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    }
    const div = document.createElement('div');
    div.id = 'menu-container';
    div.classList.add('npc-empathize-overlay');
    div.style.opacity    = '0';
    div.style.transition = 'opacity 0.22s ease-out';
    this._overlay = div;
    div.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (e.button === 2) {
        e.preventDefault();
        if (this._overlay && !this._inputFocused) this._leave();
      }
    });
    div.addEventListener('focusin', e => {
      if (e.target.id === 'npc-dlg-ask-input') this._activeArea = 'input';
    });
    div.addEventListener('mouseup',     e => e.stopPropagation());
    div.addEventListener('click',       e => e.stopPropagation());
    div.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    div.addEventListener('touchstart',  e => e.stopPropagation(), { passive: true });
    // RPG Maker's TouchInput._onWheel listens on `document` and preventDefault()s
    // every wheel event, which kills native scrolling inside this overlay, and a
    // dozen always-on plugins hang their own wheel handlers off `document` too.
    // Claim the event in the CAPTURE phase, before any of them can see it, and
    // drive the scroll ourselves.
    //
    // Which box a tick moves, in order: the one under the event target, the one
    // under the cursor (the target can belong to some other full-screen DOM
    // layer sitting on top), and finally the tab's own pane, so a tick anywhere
    // over the panel scrolls the thing the player is obviously reading rather
    // than being swallowed because the cursor sat on a gap between bubbles.
    //
    // Bound on window AND on the overlay itself: if anything upstream ever stops
    // the event before the window listener runs, the element-level one still
    // fires. `_npcWheelDone` keeps the two from double-scrolling one tick.
    this._wheelGuard = (e) => {
      const root = this._overlay;
      if (!root || e._npcWheelDone) return;
      e._npcWheelDone = true;
      e.stopPropagation();
      const box = (root.contains(e.target) ? _scrollableUnder(e.target, root) : null)
        ?? _scrollableAtPoint(root, e.clientX, e.clientY)
        ?? this._activeScrollPane();
      if (!box) return;
      e.preventDefault();
      // deltaMode: 0 = pixels, 1 = lines, 2 = pages
      const step = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? box.clientHeight : 1;
      box.scrollTop += e.deltaY * step;
      // Reading the backlog by hand ends any pin still holding the log down.
      if (box.id === 'npc-dlg-chat') this._chatPinUntil = 0;
    };
    window.addEventListener('wheel', this._wheelGuard, { capture: true, passive: false });
    div.addEventListener('wheel', this._wheelGuard, { capture: true, passive: false });

    const inner  = document.createElement('div');
    inner.className = 'npc-empathize-inner';

    // Mouse-only close button. Deliberately NOT part of _tabOrder()/_activeArea
    // or given a tabindex, so it can't be reached by keyboard/gamepad nav —
    // Cancel/Escape (and right-click on the backdrop) remain the controller way out.
    const closeBtn = document.createElement('div');
    closeBtn.className   = 'npc-close-btn';
    closeBtn.innerHTML    = '&times;';
    closeBtn.title        = T('Empathize.closeBtn');
    closeBtn.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      this._leave(true);
    });
    inner.appendChild(closeBtn);

    const tabBar = document.createElement('div');
    tabBar.className = 'npc-tab-bar';
    this._tabBarEl = tabBar;
    inner.appendChild(tabBar);

    const body  = document.createElement('div');
    body.className = 'npc-panel-body';
    const left  = document.createElement('div');
    left.className = 'npc-left-col';
    const right = document.createElement('div');
    right.className = 'npc-right-panel';
    this._leftEl  = left;
    this._rightEl = right;
    body.appendChild(left);
    body.appendChild(right);
    inner.appendChild(body);
    div.appendChild(inner);
    document.body.appendChild(div);
  };

  Scene_NPCEmpathize.prototype._removeOverlay = function () {
    if (this._wheelGuard) {
      window.removeEventListener('wheel', this._wheelGuard, { capture: true });
      this._wheelGuard = null;
    }
    if (!this._overlay) return;
    const el      = this._overlay;
    this._overlay  = null;
    this._tabBarEl = null;
    this._leftEl   = null;
    this._rightEl  = null;
    el.style.transition    = 'opacity 0.2s ease-out';
    el.style.opacity       = '0';
    el.style.pointerEvents = 'none';
    if (window._npcEmpathizeTimeout) clearTimeout(window._npcEmpathizeTimeout);
    window._npcEmpathizeTimeout = setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      window._npcEmpathizeTimeout = null;
    }, 200);
  };

  // ============================================================================
  // Scrolling (mouse wheel, L2/R2, arrows in a tab with nothing to select)
  // ============================================================================

  // The pane the current tab is "about": the chat log on the chat tab, the
  // right page everywhere else, falling back to whatever in the panel can
  // actually scroll (the left column's vitals footer, a long actions row).
  // True while the actions row is showing a picker rather than the standing
  // menu of verbs, i.e. while it is a list the player scrolls and chooses from.
  Scene_NPCEmpathize.prototype._inListSubMode = function () {
    return !!(this._directionsMode || this._giftMode || this._stealMode ||
              this._bribeMode || this._socialMode || this._romanceMode ||
              this._cardMode || this._infectMode);
  };

  Scene_NPCEmpathize.prototype._activeScrollPane = function () {
    if (!this._overlay) return null;
    // The text-entry modal covers the panel, nothing behind it may move.
    if (this._chatModalOpen) {
      const ta = this._chatModalEl?.querySelector('#npc-dlg-ask-input');
      return _isScrollable(ta) ? ta : null;
    }
    if (this._activeTab === 'chat' && !this._entity) {
      const actions = this._overlay.querySelector('.npc-chat-actions-row');
      // While a picker is open (directions, gift, steal, bribe, socialize,
      // romance) the list IS what the player is reading, so it takes the wheel
      // ahead of the chat log behind it.
      if (this._inListSubMode() && _isScrollable(actions)) return actions;
      const chat = this._overlay.querySelector('#npc-dlg-chat');
      if (_isScrollable(chat)) return chat;
      if (_isScrollable(actions)) return actions;
    }
    if (_isScrollable(this._rightEl)) return this._rightEl;
    for (const el of this._overlay.querySelectorAll(_SCROLL_BOXES))
      if (_isScrollable(el)) return el;
    return null;
  };

  // One scroll step, in pixels (negative = up). Returns true when it moved.
  Scene_NPCEmpathize.prototype._scrollActivePane = function (px) {
    const pane = this._activeScrollPane();
    if (!pane) return false;
    const before = pane.scrollTop;
    pane.scrollTop = before + px;
    // Reading the backlog by hand ends any pin still holding the log down.
    if (pane.id === 'npc-dlg-chat') this._chatPinUntil = 0;
    return pane.scrollTop !== before;
  };

  // ============================================================================
  // _render, top-level DOM update
  // ============================================================================

  Scene_NPCEmpathize.prototype._render = function () {
    if (!this._overlay) return;
    // Talking to somebody uses a different skill depending on what is being
    // asked of them, so the badge follows the mode the panel is in rather than
    // sitting there naming all of them. Trade leaves for the shop, which raises
    // its own badge for Haggling and Appraising.
    if (window.SpecBadge) {
      // i18n-ignore-start  Specialization.json ids
      const spec = this._socialMode ? 'Public Speaking'
        : (this._pickpocketConfirm || this._stealMode) ? 'Pickpocketing' : null;
      // i18n-ignore-end
      // The panel already names who is doing the talking (its own character
      // switcher), so the chip reports that member's tier.
      if (spec) window.SpecBadge.show(spec, { actor: this._focusActor() });
      else window.SpecBadge.hide();
    }
    try {
      this._renderInner();
    } catch (e) {
      console.error('[NPCEmpathizeUI] _render error:', e);
      const T = _getT();
      this._overlay.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;">' +
        '<div style="padding:40px;font-family:\'Lora\',serif;color:#2b1d0e;text-align:center;">' +
        `<div style="font-size:1.51rem;font-weight:bold;margin-bottom:8px;">${T.npcUnavailable}</div>` +
        `<div style="font-size:1.13rem;opacity:0.7;">${T.pressCancel}</div></div></div>`;
    }
    // Every innerHTML rebuild wipes the npc-content-focused class off the Wiki
    // grid tiles, so re-apply the keyboard/controller focus ring after each
    // render. The NPC-mode path also does this inside its own rAF, but the
    // entity-page path (_renderEntityInner) did not — cover both here.
    requestAnimationFrame(() => this._updateSelectionHighlight?.());
  };

  Scene_NPCEmpathize.prototype._renderInner = function () {
    if (this._entity) return this._renderEntityInner();
    const actorMode  = this._actorId != null;
    const remoteMode = this._eventId == null && this._actorId == null && !!this._npcName;
    const actorObj  = actorMode ? $gameActors.actor(this._actorId) : null;
    const evId      = this._eventId;
    const ev        = (actorMode || remoteMode) ? null : $gameMap?.event(evId);
    const T         = _getT();
    const lang      = ConfigManager.language === 'it' ? 'it' : 'en';
    const dl        = window._NPCSocietyDataLoader;

    const npcName = remoteMode ? this._npcName : (actorMode ? (actorObj?.name() ?? '') : _getNPCName(evId));
    const classId = remoteMode ? null : (actorMode ? (actorObj?.currentClass()?.id ?? null) : _extractClassId(ev));

    if (npcName && window.NPCSocietyRegistry)
      window.NPCSocietyRegistry.ensureProfile(npcName, classId);

    const shiftInfo = (!actorMode && !remoteMode && window.NPCSim?.isShopShiftCovered?.(ev))
      ? window.NPCSim.getShopShiftData(ev?.event()?.name ?? '', $gameMap?.mapId(), evId)
      : null;
    const displayName = shiftInfo ? shiftInfo.name : npcName;
    if (shiftInfo && window.NPCSocietyRegistry)
      window.NPCSocietyRegistry.ensureProfile(shiftInfo.name, null);
    const profile = shiftInfo ? (_getProfile(shiftInfo.name) ?? {}) : (_getProfile(npcName) ?? {});

    // Casual disease transmission (party <-> this NPC) is rolled once per panel
    // open, before anything renders, so the Health tab shows the fresh state.
    // Venereal diseases never spread this way; they only pass through NPC
    // romantic relations (resolved inside onEmpathizeOpen).
    if (!actorMode && !remoteMode && npcName && window.DiseaseSystem && !this._diseaseRolled) {
      this._diseaseRolled = true;
      try { window.DiseaseSystem.onEmpathizeOpen(npcName, profile); } catch (e) { console.warn('[NPCEmpathize] disease roll failed', e); }
    }

    const bustPath = actorMode
      ? _resolveBustForActor(actorObj)
      : remoteMode
        ? _resolveBustPath(npcName, null)
        : (shiftInfo && shiftInfo.bust && shiftInfo.bust !== '7'
            ? `img/busts/${shiftInfo.bust}.png`
            : _resolveBustPath(npcName, ev));

    // Character dossier this event is tied to via a "Preset: <name>" comment
    // (CharacterCreationPresets.js). Skipped while a shop shift is covered,
    // because then the person standing there is somebody else entirely.
    const preset = (!actorMode && !remoteMode && !shiftInfo) ? _presetFromEvent(ev) : null;

    const pers     = dl?.personalities?.[profile?.personalityIndex];
    const persName = pers ? (lang === 'it' ? pers.name_it || pers.name : pers.name) : '';
    // A dossier's own vocation outranks the class the society sim guessed for
    // this NPC, so the panel never contradicts the character sheet.
    const className = actorMode
      ? (actorObj?.currentClass()?.name ?? '')
      : (_presetClassName(preset) || dl?.getClassName?.(profile?.assignedClassId ?? classId) || '');
    const subParts = [className, persName].filter(Boolean);

    if (this._chatHistory.length === 0) {
      // Recent NPC↔NPC conversations (NPCConversation world-folder log)
      const convoEntries = (window.NPCConversation?.ConversationLog?.getFor?.(npcName) ?? [])
        .slice(-3)
        .map(c => ({ role: 'convo', with: c.with, kind: c.kind, lines: c.lines, min: c.min }));
      // profile.thoughts is newest-first (unshift), the chat log reads
      // oldest-at-top, so flip it back into chronological order.
      const base = profile?.thoughts?.length ? profile.thoughts.slice(0, 8).reverse() : [];
      const src  = base.length
        ? base
        : (actorMode && actorObj ? _generatePartyThoughts(actorObj, profile) : []);
      const thoughtEntries = src.map(t => ({ role: 'npc', text: String(t) }));
      // Lines this NPC actually spoke in a message box (MarkovTextGenerator's
      // "Generate NPC Dialogue" command), recorded via NPCEmpathize.recordNPCLine.
      const spokenEntries = (profile?.spokenLog ?? [])
        .slice(-8)
        .map(s => ({ role: s.role === 'player' ? 'player' : 'npc', text: String(s.text ?? '') }))
        .filter(s => s.text);
      if (convoEntries.length || thoughtEntries.length || spokenEntries.length)
        this._chatHistory = [...convoEntries, ...thoughtEntries, ...spokenEntries];
    }

    // Em (Switch 48): seed how this NPC feels about her the first time they
    // meet, then let them react out loud. After the backlog so the reaction is
    // the newest line, before `opinion` below so the panel shows the seeded
    // standing rather than a neutral one.
    this._prepareEmMeeting?.();
    // Bubba (Switch 49): the same, for the man nobody in ninety-two dimensions
    // has a bad word about. Only one of the two can be in play at a time, since
    // they are different party members doing the talking.
    this._prepareBubbaMeeting?.();
    // A non-sentient member (a creature class, 63+) is not greeted, it is
    // noticed: cooed over, backed away from or shooed off by what this NPC
    // makes of the animal in front of them.
    this._prepareFeralMeeting?.();

    const predispositions = _computePartyPredisposition(profile);
    // Reputation is now per party member; use the focused (interacting) actor's
    // standing rather than a party-wide median.
    const opinion         = this._focusOpinion(profile);

    // Advertised odds, computed by the same helper _join() rolls against, for
    // the same member: the one the switcher has doing the talking.
    const joinChance = _joinChance(opinion, this._focusActor());

    const nowMin            = $gameVariables?.value(114) ?? 0;
    const wasRecentlyAttacked = (profile?.eventLog ?? []).some(
      e => e.tag === 'crime' && e.desc === 'attacked by player' && (e.gameMin ?? 0) >= nowMin - 3 * 1440 // i18n-ignore: event-log record id
    );
    const TREAT_CLASSES = [3, 9, 41, 51];

    // Join gate: party size (3-member cap), plus hiding it once this NPC has
    // just joined via this panel (_justJoined). No Switch 67 or name-matching —
    // those caused false negatives that wrongly hid Join.
    // A fallen companion is left behind when a recruit signs on, so the cap
    // counts the travellers still standing (see _travellingPartyCount).
    const partyFull = _travellingPartyCount() >= 3 || this._justJoined === true;

    // Recruiting flips the event's self-switch A so the NPC leaves the map. An
    // event with no page gated on self-switch A has nothing to fall through to,
    // so it would keep standing there as a twin of the party member — don't
    // offer Join at all for those.
    const canVanishOnJoin = _hasSelfSwitchAPage(evId);

    // Nobody far above the party's weight class agrees to be led by them, so
    // Join is not on the table at all for a recruit out of that reach.
    const joinLevelOk = _joinLevelOk(preset?.level ?? profile?.level);

    // Em talking to Bubba: the one person in ninety-two dimensions who is
    // simply pleased to see her. Nothing hostile and nothing romantic is on the
    // table with him, and he never joins the party (see _join).
    const emCtx     = this._emCtx?.() ?? null;
    const bubbaOnly = !!emCtx?.bubba;
    const BUBBA_HIDDEN = new Set(
      ['romance', 'attack', 'pickpocket', 'cough', 'spit', 'bite', 'bribe', 'join', 'infect']
    );

    // Opening a vial on somebody: what the pack is carrying decides whether the
    // action is live at all, and the label advertises the same odds of not being
    // seen that _infectWith() rolls, for the member the switcher has focused.
    const vialCount    = _diseaseVialItems().length;
    const infectChance = _infectChance(this._focusActor());
    // A party member is dosed openly (no roll, no charge), so their own panel's
    // button states the act rather than the odds.
    const infectAction = actorMode
      ? { id: 'infect', label: T.infectLabel, disabled: !vialCount }
      : { id: 'infect', label: `${T.infectLabel} (~${infectChance}%)`, disabled: !vialCount };

    this._chatActions = remoteMode
      ? []
      : actorMode
      ? [
          { id: 'freeChat', label: T.freeChatLabel },
          { id: 'gift',  label: T.gift },
          infectAction,
        ]
      : [
          // Opening the text field is an interaction like any other, never a
          // bare keypress: the panel is navigated with the same keys one types
          // with, so a stray direction must not drop the player into a textbox.
          { id: 'freeChat',   label: T.freeChatLabel },
          { id: 'socialize',  label: T.socializeLabel },
          { id: 'romance',    label: T.courtLabel },
          { id: 'directions', label: T.directionsLabel },
          { id: 'gift',       label: T.gift },
          { id: 'bribe',      label: T.bribe },
          { id: 'attack',     label: T.attack },
          { id: 'pickpocket', label: T.pickpocket },
          { id: 'trade',      label: T.trade, disabled: wasRecentlyAttacked },
          // Cards: a game is once a day with any one person, and so is a swap.
          // The deck gate is read here so the entry greys out rather than
          // opening a table the party has nothing to bring to.
          ...(window.CardGame ? [
            {
              id: 'cardDuel', label: T.cardDuelLabel,
              disabled: window.CardGame.hasDuelledToday(npcName) || !window.CardGame.canDuel()
            },
            {
              id: 'cardTrade', label: T.cardTradeLabel,
              disabled: window.CardGame.hasTradedToday(npcName) || !window.CardGame.ownedKeys().length
            }
          ] : []),
          { id: 'cough',      label: T.coughLabel },
          { id: 'spit',       label: T.spitLabel  },
          { id: 'bite',       label: T.biteLabel  },
          infectAction,
          ...(TREAT_CLASSES.includes(classId) ? [{ id: 'treat', label: T.treatWounds }] : []),
          ...(window.ProceduralHouseSystem?.canOfferPurchase?.()
            ? [{ id: 'buyHouse', label: `${T.buyHouse} (${_euros(window.ProceduralHouseSystem.getCurrentFloorPrice(opinion))})` }]
            : []),
          ...(partyFull || !canVanishOnJoin || !joinLevelOk
            ? []
            : [{ id: 'join', label: `${T.joinParty} (~${joinChance}%)` }]),
        ];
    if (bubbaOnly) this._chatActions = this._chatActions.filter(a => !BUBBA_HIDDEN.has(a.id));

    // A non-sentient member (a creature class, 63+) has no conversation to
    // offer, so the spoken half of the panel goes: socialising, courting,
    // asking the way, haggling, bribery and property are all off the list.
    // What is left is what a beast can do , noise, contact and teeth , plus
    // the offer to follow the party, which is made whatever the party's size
    // or the creature's standing: it is an animal deciding to come along.
    if (!actorMode && !remoteMode && _isNonSentientActor?.(this._focusActor?.())) {
      const FERAL_KEEP = new Set(['freeChat', 'gift', 'attack', 'cough', 'spit', 'bite']);
      const kept = this._chatActions.filter(a => FERAL_KEEP.has(a.id));
      const noises = (FERAL_ACTIONS || []).map(a => ({
        id: a.id, label: T['feralLabel' + a.id.charAt(0).toUpperCase() + a.id.slice(1)],
      }));
      // Join stays on the board even when the party is full or the recruit is
      // out of reach , _join() refuses those itself , so it reads as greyed
      // out rather than missing. It goes only once they have actually joined.
      const joinBlocked = _travellingPartyCount() >= 3 || !canVanishOnJoin || !joinLevelOk;
      this._chatActions = [
        ...kept.filter(a => a.id === 'freeChat'),
        ...noises,
        ...kept.filter(a => a.id !== 'freeChat'),
        ...(this._justJoined === true
          ? []
          : [{ id: 'join', label: `${T.joinParty} (~${joinChance}%)`, disabled: joinBlocked }]),
      ];
    }

    // Somebody else's party member, standing here because that playthrough was
    // saved on this spot (NPCSystem.js, VisitingParties). Nothing done to them
    // may reach into the savegame they belong to, so everything transactional
    // or violent leaves the board: no recruiting them away from their own
    // party, no fighting, no trading, no cards, no gifts, no money, no
    // pickpocketing, no bargaining, no infecting them. What is left is what
    // costs their journey nothing, talking, and the standing that earns is
    // remembered in the world folder like everybody else's.
    if (!actorMode && window.PartyPresence?.isVisitorName?.(npcName)) {
      const VISITOR_KEEP = new Set(['freeChat', 'socialize', 'directions']);
      this._chatActions = this._chatActions.filter(a => VISITOR_KEEP.has(a.id));
    }

    // Bubba doing the talking (Switch 49): he does not rob, hit, or infect
    // anybody, and he is spoken for. Court survives only for a bubbaromantic,
    // where the single thing on offer is being turned down (_romanceOptions).
    if (!actorMode && !remoteMode && _isBubbaActor?.(this._focusActor?.())) {
      const BUBBA_REFUSES = new Set(['attack', 'pickpocket', 'cough', 'spit', 'bite', 'infect']);
      const courtable = _isBubbaromanticNpc(npcName, profile);
      this._chatActions = this._chatActions.filter(
        a => !BUBBA_REFUSES.has(a.id) && (a.id !== 'romance' || courtable)
      );
      if (courtable) {
        const rom = _bubbaDb?.()?.romantic;
        const label = rom?.label;
        const entry = this._chatActions.find(a => a.id === 'romance');
        if (entry && label) entry.label = label;
      }
    }

    // A harassment complaint from this person against the member doing the
    // talking: no more courting them until they think well of them again
    // (see _recordUnwantedCourting). Others in the party are unaffected.
    if (!actorMode && !remoteMode &&
        _courtRefused(profile, this._focusActor?.()?.actorId(), opinion)) {
      this._chatActions = this._chatActions.filter(a => a.id !== 'romance');
      this._romanceMode = false;
    }
    this._menuItems = this._chatActions;
    if (this._menuIndex >= this._menuItems.length) this._menuIndex = 0;

    // NPC age, drawn from the life-history record; ensure one exists so the
    // left-panel header can show it. Party actors have no life record.
    let npcAge = null;
    if (!actorMode && npcName && window.NPCLifeSim) {
      npcAge = window.NPCLifeSim.ageOf?.(npcName);
      if (npcAge == null && window.NPCLifeSim.ensureLifeRecord) {
        try { window.NPCLifeSim.ensureLifeRecord(npcName, profile?._homeGroupName); } catch (e) {}
        npcAge = window.NPCLifeSim.ageOf?.(npcName);
      }
    }
    if (preset) {
      const presetAge = _presetAge(preset.birthDate);
      if (presetAge != null) npcAge = presetAge;
    }
    const leftIdent = {
      name: displayName,
      level: preset?.level ?? profile?.level,
      className,
      age: npcAge,
    };
    const leftHTML = this._buildLeftPanelHTML(bustPath, profile, predispositions, T, leftIdent);

    const showingChatUI = this._activeTab === 'chat';

    let rightHTML;
    if (this._activeTab === 'chat') {
      rightHTML = this._buildChatHTML(displayName, T, profile, opinion, npcName, remoteMode);
    } else if (this._activeTab === 'info') {
      rightHTML = this._buildInfoHTML(displayName, subParts, profile, T, dl, opinion, lang, classId, npcName, preset);
    } else if (this._activeTab === 'background') {
      rightHTML = this._buildBackgroundTabHTML(T, profile, npcName);
    } else if (this._activeTab === 'routine') {
      rightHTML = this._buildRoutineTabHTML(T, profile);
    } else if (this._activeTab === 'biologics') {
      rightHTML = this._buildBiologicsTabHTML(T, profile, npcName);
    } else if (this._activeTab === 'health') {
      rightHTML = this._buildHealthTabHTML(T, profile, npcName);
    } else if (this._activeTab === 'romance') {
      rightHTML = this._buildRomanceTabHTML(T, profile, npcName);
    } else if (this._activeTab === 'web') {
      rightHTML = this._buildWebHTML(T, profile, npcName, bustPath);
    } else if (this._activeTab === 'lifeHistory') {
      rightHTML = this._buildLifeHistoryHTML(T, profile, npcName);
    } else if (this._activeTab === 'wiki') {
      rightHTML = this._buildWikiTabHTML(T);
    } else {
      rightHTML = this._buildMoreHTML(T);
    }

    if (!this._leftEl || !this._rightEl) return;

    if (this._tabBarEl) {
      this._tabBarEl.innerHTML = this._buildTabsHTML(T);
      this._tabBarEl.classList.toggle('npc-tab-bar--focused', this._activeArea === 'tabs');
    }
    this._leftEl.innerHTML = leftHTML;

    if (showingChatUI) {
      this._rightEl.style.padding       = '0';
      this._rightEl.style.overflow      = 'hidden';
      this._rightEl.style.display       = 'flex';
      this._rightEl.style.flexDirection = 'column';
    } else {
      this._rightEl.style.padding       = '';
      this._rightEl.style.overflow      = '';
      this._rightEl.style.display       = '';
      this._rightEl.style.flexDirection = '';
    }
    this._rightEl.innerHTML = rightHTML;

    requestAnimationFrame(() => {
      // The log always ends on its newest message. Nothing tries to preserve
      // where the player had scrolled to: every render is triggered by
      // something that just happened in the conversation, so the bottom is
      // always the interesting end, and a half-restored position was what made
      // a fresh reply visibly scroll into view and then jump back up.
      if (showingChatUI) this._scrollChatToBottom();
      if (this._activeTab === 'routine')
        this._rightEl?.querySelector('#npc-routine-now')?.scrollIntoView({ block: 'center' });
      this._updateSelectionHighlight?.();
    });

    // Restore focus + caret after a re-render rebuilt the field, so an
    // in-progress draft survives (matches the search-input pattern used by
    // SandboxMode and other DOM menus).
    if (showingChatUI && this._activeArea === 'input' && !remoteMode) {
      const self = this;
      setTimeout(() => {
        const inp = self._overlay?.querySelector('#npc-dlg-ask-input');
        if (inp && self._activeArea === 'input' && document.activeElement !== inp) {
          inp.focus();
          const end = inp.value.length;
          try { inp.setSelectionRange(end, end); } catch (e) {}
        }
      }, 60);
    }
  };

  // ============================================================================
  // Tab bar
  // ============================================================================

  Scene_NPCEmpathize.prototype._buildTabsHTML = function (T) {
    const tabs = [
      { id: 'chat',        label: T.chat },
      { id: 'info',        label: T.info },
      { id: 'background',  label: T.history },
      { id: 'routine',     label: T.routine },
      { id: 'biologics',   label: T.biologicsTab },
      { id: 'health',      label: T.healthTab },
      { id: 'romance',     label: T.romanceTab },
      { id: 'web',         label: T.socialWeb },
      { id: 'lifeHistory', label: T.lifeHistory },
      { id: 'wiki',        label: T.wikiTab },
      { id: 'more',        label: T.more },
    ];
    // _tabOrder() is what the keyboard cycles through and it already drops the
    // tabs the member doing the talking has no use for (Romance, for a
    // non-sentient one), so the bar is drawn from it rather than beside it.
    const order = this._tabOrder?.() ?? null;
    const shown = Array.isArray(order) ? tabs.filter(t => order.includes(t.id)) : tabs;
    return this._buildBackBtnHTML(T) + shown.map(tab => `
      <div class="npc-tab${this._activeTab === tab.id ? ' active' : ''}"
           onmousedown="event.stopPropagation();SceneManager._scene._setTab('${tab.id}')">${_escapeHtml(tab.label)}</div>
    `).join('');
  };

  // "← Back" returns to the previous profile in the wiki navigation stack;
  // shown whenever this panel was reached through a hyperlink.
  Scene_NPCEmpathize.prototype._buildBackBtnHTML = function (T) {
    if (!Scene_NPCEmpathize._returnStack.length) return '';
    return `
      <div class="npc-tab npc-wiki-back"
           onmousedown="event.stopPropagation();SceneManager._scene._leave()">← ${_escapeHtml(T.back)}</div>`;
  };

  // ============================================================================
  // Left panel
  // ============================================================================

  // The attribute names the game shows everywhere else (js/i18n/<lang>/stats.json,
  // the same bank the status screen reads), not the engine's own ATK/DEF/MAT/MDF:
  // the panel was printing a different set of labels over the same six numbers
  // the character sheet already names STR/CON/DEX/INT/WIS/PSI. That bank sits at
  // the i18n root, which window.T does not cover, so it is read the same way this
  // file already reads enemyArchetypes.json: once, lazily, on the render thread.
  let _statsI18nCache = null;
  let _statsI18nLang  = null;
  function _statLabels() {
    const lang = ConfigManager.language || 'en';
    if (_statsI18nCache === null || _statsI18nLang !== lang) {
      _statsI18nCache = {};
      _statsI18nLang  = lang;
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `js/i18n/${lang}/stats.json`, false);
        xhr.send();
        if (xhr.status === 200 || xhr.status === 0) _statsI18nCache = JSON.parse(xhr.responseText);
      } catch (_) { /* fall back to the English names below */ }
    }
    const s = _statsI18nCache;
    return {
      atk: s['ATT']     || 'STR',
      def: s['DEF']     || 'CON',
      agi: s['AGILITY'] || 'DEX',
      mat: s['M.ATT']   || 'INT',
      mdf: s['M.DEF']   || 'WIS',
      luk: s['LUCK']    || 'PSI',
    };
  }

  // The character sheet numbers, paired off into two columns so the whole set
  // fits the narrow left page under the portrait. The level is not repeated
  // here, it is already in the name block right above. Lives on the left rather
  // than in the Info tab so it is readable whatever tab is open. Ordered the way
  // the status screen orders them, so one character reads the same in both.
  function _buildStatsGridHTML(profile, T) {
    if (!profile || profile.level === undefined) return '';
    const L = _statLabels();
    const rows = [
      [L.atk, profile.atk], [L.def, profile.def],
      [L.agi, profile.agi], [L.mat, profile.mat],
      [L.mdf, profile.mdf], [L.luk, profile.luk],
      [T.arcaneLbl,       profile.arcane],
      [T.substanceLbl,    profile.substance],
      [T.stealthLbl,      profile.stealth],
      [T.intimidationLbl, profile.intimidation],
    ].filter(([, v]) => v !== undefined && v !== null && v !== 0);
    if (!rows.length) return '';

    let html = `<div class="npc-sec-hdr" style="margin-top:6px;">${_escapeHtml(T.stats)}</div>`;
    html += '<div class="npc-stat-grid">';
    html += rows.map(([label, value]) =>
      `<div class="npc-stat-cell"><span class="npc-stat-lbl">${_escapeHtml(label)}</span>` +
      `<span class="npc-stat-val">${_escapeHtml(String(value))}</span></div>`).join('');
    html += '</div>';

    const expMgr = window.NPCSim?.ExpManager;
    if (expMgr && profile.exp !== undefined && profile.assignedClassId) {
      const cid   = profile.assignedClassId;
      const floor = expMgr.expForLevel(cid, profile.level);
      const ceil  = expMgr.expForLevel(cid, (profile.level ?? 1) + 1);
      const pct   = ceil > floor
        ? Math.min(100, Math.max(0, Math.round((profile.exp - floor) / (ceil - floor) * 100)))
        : 100;
      html +=
        `<div class="npc-exp-section">` +
          `<div class="npc-exp-label">EXP ${pct}%</div>` +
          `<div class="npc-exp-track"><div class="npc-exp-fill" style="width:${pct}%;"></div></div>` +
        `</div>`;
    }
    return html;
  }

  Scene_NPCEmpathize.prototype._buildLeftPanelHTML = function (bustPath, profile, predispositions, T, ident) {
    let hpmpHTML = '';
    if (profile?.mhp !== undefined || profile?.mmp !== undefined) {
      const mhp    = profile.mhp ?? 0;
      const mmp    = profile.mmp ?? 0;
      const hpPct  = Math.min(100, Math.round((mhp / 2000) * 100));
      const mpPct  = Math.min(100, Math.round((mmp / 500)  * 100));
      hpmpHTML =
        `<div class="npc-vital-row">` +
          `<span class="npc-vital-lbl">${T('Equip.hp')}</span>` +
          `<div class="npc-vital-track"><div class="npc-vital-fill" style="width:${hpPct}%;background:#d9534f;"></div></div>` +
          `<span class="npc-vital-pct" style="width:44px;">${mhp}</span>` +
        `</div>` +
        `<div class="npc-vital-row">` +
          `<span class="npc-vital-lbl">${T('Equip.mp')}</span>` +
          `<div class="npc-vital-track"><div class="npc-vital-fill" style="width:${mpPct}%;background:#4070d0;"></div></div>` +
          `<span class="npc-vital-pct" style="width:44px;">${mmp}</span>` +
        `</div>`;
    }

    // Which party member is currently interacting (character switcher).
    const isNpcMode = this._actorId == null && this._eventId != null;
    const members   = $gameParty?.members() ?? [];
    const focusIdx  = this._focusIndex ? this._focusIndex() : 0;

    // Character switcher: pick the interacting party member. Each has their own
    // reputation with this NPC (trait compatibility included), and interactions
    // only move the selected member's standing.
    let switcherHTML = '';
    if (isNpcMode && members.length > 1) {
      const hint = (window.CharSwitcher?.parts?.(members.length)) || { left: '', right: '' };
      const chips = members.map((m, idx) => {
        const on = idx === focusIdx;
        return `<div onmousedown="event.stopPropagation();SceneManager._scene._selectFocusActor(${idx})" ` +
          `style="cursor:pointer;padding:3px 9px;border-radius:5px;font-size:1.02rem;white-space:nowrap;` +
          `border:1.5px solid ${on ? '#2b1d0e' : 'rgba(43,29,14,0.3)'};` +
          `background:${on ? 'rgba(43,29,14,0.14)' : 'transparent'};font-weight:${on ? 'bold' : 'normal'};">` +
          `${_escapeHtml(m.name())}</div>`;
      }).join('');
      switcherHTML =
        `<div class="npc-focus-switcher" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:5px;margin:2px 0 6px;">` +
        `<span style="opacity:0.6;font-size:0.95rem;width:100%;text-align:center;">${_escapeHtml(T.interactingAs)}</span>` +
        `${hint.left}${chips}${hint.right}</div>`;
    }

    let predHTML = '';
    if (predispositions?.length) {
      predHTML = `<div class="npc-sec-hdr" style="margin-top:6px;">${T.predisposition}</div>`;
      predispositions.forEach(({ actor, score }, idx) => {
        const pct   = Math.round((score + 100) / 2);
        const color = score < -30 ? '#c02020' : score > 30 ? '#2a6e4a' : '#b8860b';
        const sign  = score >= 0 ? '+' : '';
        const on    = idx === focusIdx && isNpcMode;
        predHTML += `
          <div class="npc-pred-row${on ? ' npc-pred-focus' : ''}" onmousedown="event.stopPropagation();SceneManager._scene._selectFocusActor(${idx})"
               style="cursor:pointer;${on ? 'background:rgba(43,29,14,0.10);border-radius:4px;' : ''}">
            <span class="npc-pred-name">${on ? '▸ ' : ''}${_escapeHtml(actor.name())}</span>
            <div class="npc-pred-track"><div class="npc-pred-fill" style="width:${pct}%;background:${color};"></div></div>
            <span class="npc-pred-val" style="color:${color};">${sign}${score}</span>
          </div>`;
      });
    }
    const statsHTML = _buildStatsGridHTML(profile, T);

    const topInfoHTML = (hpmpHTML || statsHTML || predHTML)
      ? `${hpmpHTML}${statsHTML}${predHTML}<hr class="npc-r-sep">`
      : '';

    let vitalsHTML = '';
    if (profile?.hunger !== undefined) {
      // While Em is in the party the needs answer to her vocabulary instead of
      // the clinical one (CharacterCreationPresets.emLabel); everyone else sees
      // the ordinary labels, which are the fallbacks passed in here.
      const need = (key, label) => window.CharacterPresets?.emLabel?.(key, label) ?? label;
      vitalsHTML =
        _vitalRow(need('needHunger',  T.hungerLabel),  profile.hunger,  30) +
        _vitalRow(need('needSleep',   T.sleepLabel),   profile.sleep,   20) +
        _vitalRow(need('needHygiene', T.hygieneLabel), profile.hygiene, 30) +
        _vitalRow(need('needSocial',  T.socialLabel),  profile.social,  25) +
        _vitalRow(need('needLeisure', T.leisureLabel), profile.leisure, 25);
    }

    // An addiction meter belongs to the person, not the profile, so it is only
    // drawn when this panel is looking at a real party member. It fills as the
    // craving grows, which is why its warning band is the high end.
    const cravingActor = this._actorId != null ? $gameActors.actor(this._actorId) : null;
    if (cravingActor && window.AddictionSystem) {
      window.AddictionSystem.cravingsFor(cravingActor).forEach(craving => {
        vitalsHTML += _cravingRow(craving.label, craving.value);
      });
    }

    let needHTML = '';
    if (profile?.currentNeed) {
      const needLabels = _needLabels(T);
      needHTML = `<div class="npc-need-badge">${_iconSpan(NEED_ICONS[profile.currentNeed] || 0, 14)}<span>${_escapeHtml(needLabels[profile.currentNeed] || profile.currentNeed)}</span></div>`;
    }

    let hostileHTML = '';
    const nowMin = $gameVariables?.value(114) ?? 0;
    const recentAttack = (profile?.eventLog ?? []).some(
      e => e.tag === 'crime' && e.desc === 'attacked by player' && (e.gameMin ?? 0) >= nowMin - 3 * 1440 // i18n-ignore: event-log record id
    );
    if (recentAttack) {
      hostileHTML = `<div class="npc-need-badge" style="background:rgba(180,30,30,0.12);color:#b01010;border-color:#b01010;">` +
        `${_iconSpan(12, 14)}<span>${_escapeHtml(T('Empathize.hostileBadge'))}</span></div>`;
    }

    let lastMetHTML = '';
    const lastDay = _lastInteractionDay(profile);
    if (lastDay !== null) {
      const todayDay = Math.floor(nowMin / 1440);
      const diff     = todayDay - lastDay;
      const metLabel = diff <= 0
        ? T('Empathize.metToday')
        : diff === 1 ? T('Empathize.metYesterday') : T.n('Empathize.metDaysAgo', diff, { n: diff });
      lastMetHTML = `<div style="font-size:1.08rem;opacity:0.72;margin-top:4px;padding:0 4px;">${_escapeHtml(metLabel)}</div>`;
    } else if (profile) {
      lastMetHTML = `<div style="font-size:1.08rem;opacity:0.62;margin-top:4px;padding:0 4px;">${_escapeHtml(T('Empathize.firstMeeting'))}</div>`;
    }

    let identHTML = '';
    if (ident && (ident.name || ident.className || ident.level != null || ident.age != null)) {
      const metaBits = [];
      if (ident.level != null) metaBits.push(`${T.levelAbbr}${ident.level}`);
      if (ident.className)     metaBits.push(ident.className);
      if (ident.age != null)   metaBits.push(`${ident.age} ${T.yearsAbbr}`);
      identHTML =
        `<div class="npc-left-ident">` +
          (ident.name ? `<div class="npc-left-name">${_escapeHtml(ident.name)}</div>` : '') +
          (metaBits.length ? `<div class="npc-left-meta">${_escapeHtml(metaBits.join(' · '))}</div>` : '') +
        `</div>`;
    }

    return `
      <div class="npc-portrait-wrap">
        <img src="${bustPath}" alt="" onerror="this.src='img/busts/7.png'">
      </div>
      ${identHTML}
      ${switcherHTML}
      <div class="npc-vitals-footer">
        ${topInfoHTML}
        ${vitalsHTML}${needHTML}${hostileHTML}${lastMetHTML}
      </div>`;
  };

  // ============================================================================
  // Chat panel
  // ============================================================================

  // Give the chat log a definite pixel height.
  //
  // Its height would otherwise come out of a five-level flex chain (overlay →
  // inner → panel body → right panel → chat panel). If any link of that chain
  // ends up with an indefinite height, `flex: 1 + min-height: 0` stops
  // constraining the log: it grows to fit its messages, gets clipped by the
  // right panel's overflow:hidden, and — because scrollHeight then equals
  // clientHeight — becomes completely unscrollable. That single failure mode
  // explains all three symptoms at once (messages cut off, wheel does nothing,
  // dragging the bar does nothing, scrollTop won't move).
  //
  // Measure from `right` (the chat panel's own parent, `.npc-right-panel`)
  // rather than reconstructing its height from `.npc-empathize-inner` minus the
  // tab bar — that reconstruction silently drifted whenever a border/padding
  // changed anywhere in between, which is what let the log get sized taller
  // than the space actually visible through `right`'s `overflow: hidden`, i.e.
  // exactly the "nothing to scroll, new lines clipped off the bottom" bug.
  // `right.clientHeight` is the real, already-resolved box for that space.
  Scene_NPCEmpathize.prototype._sizeChatLog = function () {
    const chat  = this._overlay?.querySelector('#npc-dlg-chat');
    const panel = chat?.parentElement;
    const right = panel?.parentElement;
    if (!chat || !panel || !right) return;
    const avail = right.clientHeight;
    if (!(avail > 0)) return;
    // The inline lists (directions / gift / steal / bribe) can run to dozens of
    // rows. The stylesheet's percentage ceiling only resolves when every link of
    // the flex chain above has a definite height, and where it does not the row
    // grows without bound, swallows the chat log and pushes the input box off
    // the bottom of the panel. Resolve the ceiling here in pixels against the
    // height the panel actually has, BEFORE the siblings are measured below.
    const actions = panel.querySelector('.npc-chat-actions-row');
    if (actions) {
      actions.style.maxHeight = `${Math.max(96, Math.round(avail * 0.45))}px`;
      actions.style.overflowY = 'auto';
    }
    // offsetHeight excludes margins, and the join/feedback message carries one,
    // so counting them is what keeps the log from being sized a few pixels
    // taller than the space it shows through, i.e. the newest bubble sitting
    // just below the bottom edge with nothing left to scroll.
    let used = 0;
    for (const el of panel.children) {
      if (el === chat) continue;
      const cs = getComputedStyle(el);
      used += el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    const h = Math.max(80, Math.round(avail - used));
    chat.style.flex      = '0 0 auto';
    // border-box, the log carries 10px of vertical padding that would otherwise
    // push the input row out past the bottom of the panel.
    chat.style.boxSizing = 'border-box';
    chat.style.height    = `${h}px`;
    chat.style.minHeight = '0';
    chat.style.overflowY = 'auto';
    if ($gameSwitches?.value(23)) {
      console.log('[NPCEmpathize] chat log sized', {
        rightClient: right.clientHeight,
        avail, siblings: used, height: h,
        scrollHeight: chat.scrollHeight, clientHeight: chat.clientHeight,
      });
    }
  };

  // Pin the chat history to the newest message. Scoped to THIS overlay (not a
  // global getElementById, which can find a stale overlay still fading out).
  //
  // The pin is held for a short window rather than fired once: a bubble reaches
  // its final height only after the rebuilt log has laid out, and again after a
  // web font or an inline icon has loaded, and each of those reflows would
  // otherwise leave the newest message hanging below the bottom edge. Re-pinning
  // every frame of that window is also what makes a stale callback from an
  // earlier render harmless, it simply gets overwritten on the next frame.
  Scene_NPCEmpathize.prototype._scrollChatToBottom = function () {
    this._chatPinUntil = (window.performance?.now?.() ?? Date.now()) + 400;
    const pin = () => {
      const chat = this._overlay?.querySelector('#npc-dlg-chat');
      if (!chat) return false;
      this._sizeChatLog();
      chat.scrollTop = chat.scrollHeight;
      return true;
    };
    const step = () => {
      if (!pin()) return;
      const now = window.performance?.now?.() ?? Date.now();
      if (now < this._chatPinUntil) requestAnimationFrame(step);
    };
    step();
  };

  Scene_NPCEmpathize.prototype._buildChatHTML = function (displayName, T, profile, opinion, npcName, remoteMode) {
    const bubblesHTML = this._chatHistory.map(entry => {
      if (entry.role === 'convo') return this._buildConvoBubble(entry);
      return entry.role === 'player'
        ? `<div class="npc-bubble npc-bubble-player">${_escapeHtml(entry.text)}</div>`
        : `<div class="npc-bubble npc-bubble-npc"><span class="npc-bubble-name">${_escapeHtml(displayName)}</span>${_escapeHtml(entry.text)}</div>`;
    }).join('');
    const typingHTML = this._isTyping
      ? `<div class="npc-bubble npc-bubble-npc npc-typing">…</div>` : '';

    // Feedback about what just happened (a warning before a Yes/No, a gift
    // landing, a join). It sits at the FOOT of the log, directly above the
    // buttons it is talking about, where the eye already is.
    const joinMsgHTML = this._joinMessage
      ? `<div class="npc-join-msg ${this._joinMessage.type}" style="margin:8px 16px 0;">${_escapeHtml(this._joinMessage.text)}</div>`
      : '';

    let actionsHTML;
    if (remoteMode) {
      actionsHTML = '';
    } else if (this._attackConfirm) {
      actionsHTML =
        `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._confirmAttack()">${_escapeHtml(T.confirmYes)}</div>` +
        `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.confirmNo)}</div>`;
    } else if (this._transmitConfirm) {
      actionsHTML =
        `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._confirmTransmit()">${_escapeHtml(T.confirmYes)}</div>` +
        `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.confirmNo)}</div>`;
    } else if (this._pickpocketConfirm) {
      actionsHTML =
        `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._confirmPickpocket()">${_escapeHtml(T.confirmYes)}</div>` +
        `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.confirmNo)}</div>`;
    } else if (this._socialMode) {
      actionsHTML = this._buildInlineSocialActions(T);
    } else if (this._romanceMode) {
      actionsHTML = this._buildInlineRomanceActions(T);
    } else if (this._directionsMode) {
      actionsHTML = this._buildInlineDirectionActions(T);
    } else if (this._stealMode) {
      actionsHTML = this._buildInlineStealActions(T);
    } else if (this._giftMode) {
      actionsHTML = this._buildInlineGiftActions(T);
    } else if (this._infectMode) {
      actionsHTML = this._buildInlineInfectActions(T);
    } else if (this._bribeMode) {
      actionsHTML = this._buildInlineBribeActions(T, opinion, npcName);
    } else if (this._cardMode) {
      actionsHTML = this._buildInlineCardActions(T);
    } else {
      actionsHTML = (this._chatActions || []).map((item, i) => {
        const focused  = i === this._menuIndex ? ' npc-action-focused' : '';
        const disabled = item.disabled ? ' npc-action-disabled' : '';
        return `<div class="npc-chat-action-btn${focused}${disabled}" onmousedown="event.stopPropagation();SceneManager._scene._runAction('${item.id}')">${_escapeHtml(item.label)}</div>`;
      }).join('');
    }

    return `
      <div class="npc-chat-panel">
        <div class="npc-chat-header">
          <span>${_escapeHtml(displayName)}</span>
        </div>
        <div class="npc-chat-bubbles" id="npc-dlg-chat">${bubblesHTML}${typingHTML}</div>
        ${joinMsgHTML}
        ${actionsHTML ? `<div class="npc-chat-actions-row">${actionsHTML}</div>` : ''}
        ${remoteMode
          ? `<div class="npc-chat-elsewhere">${_escapeHtml(T('Empathize.npcElsewhere', { name: displayName }))}</div>`
          : `<div class="npc-chat-input-row">
          <button class="npc-chat-open-modal" onmousedown="event.stopPropagation();SceneManager._scene._openChatModal?.()">
            <span class="npc-chat-open-modal-icon">${_iconSpan(4, 15)}</span>
            <span class="npc-chat-open-modal-label">${_escapeHtml(T.typePlaceholder)}</span>
          </button>
        </div>`}
      </div>`;
  };

  // Overheard NPC↔NPC conversation entry (NPCConversation world-folder log).
  // Clicking the partner's name opens their own panel, like the social web.
  Scene_NPCEmpathize.prototype._buildConvoBubble = function (entry) {
    const min  = entry.min ?? 0;
    const day  = Math.floor(min / 1440);
    const hour = Math.floor((min % 1440) / 60);
    const mm   = Math.floor(min % 60);
    const when = `D${day} ${String(hour).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const kindLabel = entry.kind === 'debate' ? T('Empathize.debatedWith') : T('Empathize.chattedWith');
    const linesHTML = (entry.lines ?? []).map(l =>
      `<div class="npc-convo-line"><span class="npc-convo-speaker">${_escapeHtml(l.speaker)}:</span> ${_escapeHtml(l.text)}</div>`
    ).join('');
    const partnerArg = String(entry.with ?? '').replace(/[\\'"<>]/g, '');
    return `
      <div class="npc-bubble npc-bubble-convo">
        <span class="npc-bubble-name">${kindLabel}
          <span class="npc-convo-partner" onmousedown="event.stopPropagation();window.NPCEmpathize.openByName('${partnerArg}')">${_escapeHtml(entry.with)}</span>
         , ${when}</span>
        ${linesHTML}
      </div>`;
  };

  // ============================================================================
  // Inline action builders (used inside the chat panel actions row)
  // ============================================================================

  Scene_NPCEmpathize.prototype._buildInlineGiftActions = function (T) {
    const items = this._giftItems;
    let html = '';
    if (!items.length) {
      html = `<span style="opacity:0.6;font-style:italic;padding:4px 8px;font-size:1.08rem;">${_escapeHtml(T.noItemsToGive)}</span>`;
    } else {
      html = items.map((item, i) => {
        const qty     = $gameParty.numItems(item);
        const opDelta = Math.round(Math.max(5, Math.min(25, (item.price || 0) / 50)));
        return `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._giveItem(${i})">` +
          `${_iconSpan(item.iconIndex || 0, 15)}<span>${_escapeHtml(item.name)}</span>` +
          `<span style="opacity:0.55;margin-left:4px;font-size:1.00rem;">×${qty}</span>` +
          `<span style="color:#2a6e4a;margin-left:6px;">+${opDelta}♥</span></div>`;
      }).join('');
    }
    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  // Which vial to open. One row per sealed vial in the pack, naming the illness
  // it carries rather than the item, since that is what the choice is about; the
  // odds of not being seen are printed on every row (they are the same for all
  // of them) so the number is under the cursor at the moment of the decision.
  // Party members are dosed openly, so their own panel prints no odds.
  Scene_NPCEmpathize.prototype._buildInlineInfectActions = function (T) {
    const items  = this._infectItems || [];
    const covert = this._actorId == null;
    const chance = _infectChance(this._focusActor());
    let html = '';
    if (!items.length) {
      html = `<span style="opacity:0.6;font-style:italic;padding:4px 8px;font-size:1.08rem;">${_escapeHtml(T.noVialsToOpen)}</span>`;
    } else {
      const DS = window.DiseaseSystem;
      html = items.map((item, i) => {
        const id   = _diseaseVialId(item);
        const name = (DS && DS.displayName ? DS.displayName(id) : '') || item.name;
        const qty  = $gameParty.numItems(item);
        return `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._infectWith(${i})">` +
          `${_iconSpan(item.iconIndex || 0, 15)}<span>${_escapeHtml(name)}</span>` +
          `<span style="opacity:0.55;margin-left:4px;font-size:1.00rem;">×${qty}</span>` +
          (covert ? `<span style="color:#8a2a2a;margin-left:6px;">~${chance}%</span>` : '') +
          `</div>`;
      }).join('');
    }
    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  // Cards submenu. Two shapes on one flag: what to put on the table before a
  // duel, or which of their cards to swap for one of yours.
  Scene_NPCEmpathize.prototype._buildInlineCardActions = function (T) {
    const CGx = window.CardGame;
    let html = '';

    if (!CGx) {
      html = '';
    } else if (this._cardMode === 'stake') {
      const stakes = this._cardStakeOptions();
      html = `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._startCardDuel({type:'none'})">` +
        `<span>${_escapeHtml(T.cardStakeFree)}</span></div>`;
      html += stakes.money.map(amount =>
        `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._startCardDuel({type:'money',amount:${amount}})">` +
        `<span>${_escapeHtml(T.cardStakeMoney)}</span>, <span style="opacity:0.75;">${_euros(amount)}</span></div>`
      ).join('');
      if (stakes.item) {
        const mine   = $dataItems[stakes.item.playerItem.id];
        const theirs = stakes.item.npcItem.kind === 1 ? $dataWeapons[stakes.item.npcItem.id]
          : stakes.item.npcItem.kind === 2 ? $dataArmors[stakes.item.npcItem.id]
            : $dataItems[stakes.item.npcItem.id];
        if (mine && theirs) {
          const arg = JSON.stringify({ type: 'item', playerItem: stakes.item.playerItem, npcItem: stakes.item.npcItem })
            .replace(/"/g, '&quot;');
          html += `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._startCardDuel(${arg})">` +
            `${_iconSpan(mine.iconIndex || 0, 15)}<span>${_escapeHtml(mine.name)}</span>` +
            `<span style="opacity:0.6;margin:0 4px;">&rarr;</span>` +
            `${_iconSpan(theirs.iconIndex || 0, 15)}<span>${_escapeHtml(theirs.name)}</span></div>`;
        }
      }
    } else if (this._cardMode === 'trade') {
      const offers = this._cardTradeOffers();
      if (!offers.length) {
        html = `<span style="opacity:0.6;font-style:italic;padding:4px 8px;font-size:1.08rem;">${_escapeHtml(T.cardNothingToSwap)}</span>`;
      } else {
        html = offers.map((offer, i) => {
          const theirs = CGx.nameOf(offer.theirs);
          const mine   = CGx.nameOf(offer.mine);
          return `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._doCardTrade(${i})">` +
            `<span>${_escapeHtml(mine)}</span>` +
            `<span style="opacity:0.6;margin:0 4px;">&rarr;</span>` +
            `<span style="color:#2a6e4a;">${_escapeHtml(theirs)}</span>` +
            `<span style="opacity:0.5;margin-left:6px;font-size:0.95em;">${CGx.statTotal(offer.mine)}/${CGx.statTotal(offer.theirs)}</span></div>`;
        }).join('');
      }
    }

    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  Scene_NPCEmpathize.prototype._buildInlineBribeActions = function (T, opinion, npcName) {
    const BASE_TIERS = [
      { label: T.bribeSmall,  gold: 200,  op: 10, chance: 70 },
      { label: T.bribeMedium, gold: 500,  op: 22, chance: 80 },
      { label: T.bribeLarge,  gold: 1000, op: 40, chance: 90 },
    ];
    const bribeProfile = _getProfile(_getNPCName(this._eventId));
    const recentBribes = _countRecentInteractions(bribeProfile, 'bribe', 5);
    const costMult     = recentBribes >= 2 ? 1.5 : 1;
    const TIERS = BASE_TIERS.map(t => ({ ...t, gold: Math.round(t.gold * costMult) }));
    const gold    = $gameParty?.gold() ?? 0;
    const hostile = opinion <= -60;
    // Police officers (classId 44) never take a bribe; show that up front
    // instead of tier buttons that would just fail with a bounty on click.
    const LAW_CLASSES = [44];
    const evClassId   = bribeProfile?.assignedClassId ?? _extractClassId($gameMap?.event(this._eventId));
    const isLawNPC    = LAW_CLASSES.includes(evClassId);

    let html = '';
    if (isLawNPC) {
      html = `<span style="color:#b01010;padding:4px 8px;font-style:italic;font-size:1.08rem;">${_escapeHtml(T.bribeRefusedLaw ? T.bribeRefusedLaw(npcName) : `${npcName} refuses on principle.`)}</span>`;
    } else if (hostile) {
      html = `<span style="color:#b01010;padding:4px 8px;font-style:italic;font-size:1.08rem;">${_escapeHtml(T.bribeRefused(npcName))}</span>`;
    } else {
      html = TIERS.map((tier, i) => {
        const canAfford = gold >= tier.gold;
        const disabled  = !canAfford ? ' npc-action-disabled' : '';
        const extra     = costMult > 1 ? ` <span style="color:#c07020;font-size:0.95em;">(×${costMult})</span>` : '';
        return `<div class="npc-chat-action-btn${disabled}" onmousedown="event.stopPropagation();SceneManager._scene._attemptBribe(${i})">` +
          `<span>${_escapeHtml(tier.label)}</span>` +
          `, <span style="opacity:0.75;">${_euros(tier.gold)}</span>${extra}` +
          `<span style="color:#2a6e4a;margin-left:6px;">+${tier.op}♥</span>` +
          `<span style="opacity:0.5;margin-left:4px;font-size:0.97em;">${tier.chance}%</span></div>`;
      }).join('');
    }
    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  // Socialize submenu: praise / joke / story / poem / insult / ... grouped by
  // tone. Each lands on the focused party member's own reputation.
  Scene_NPCEmpathize.prototype._buildInlineSocialActions = function (T) {
    let cat = this._socialCatalog ? this._socialCatalog() : [];
    // Em cannot be cruel to Bubba: the hostile half of the catalog is not
    // offered at all when she is the one talking to him.
    if (this._emCtx?.()?.bubba) cat = cat.filter(c => c.tone !== 'negative');
    // Neither can Bubba be cruel to anybody: the man has never insulted a
    // stranger in his life and is not starting in this menu.
    if (this._bubbaCtx?.()) cat = cat.filter(c => c.tone !== 'negative');
    const toneColor = { positive: '#2a6e4a', neutral: '#8a6a30', negative: '#b01010', performance: '#6a3fbf' };
    let html = cat.map(c =>
      `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._socialInteract('${c.id}')">` +
      `<span style="color:${toneColor[c.tone] || '#333'};">${_escapeHtml(c.label)}</span></div>`
    ).join('');
    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  Scene_NPCEmpathize.prototype._buildInlineStealActions = function (T) {
    const items   = this._stealItems;
    const agility = $gameParty.leader()?.agi ?? 10;
    let html = '';
    if (!items.length) {
      html = `<span style="opacity:0.6;font-style:italic;padding:4px 8px;font-size:1.08rem;">${_escapeHtml(T.noItems)}</span>`;
    } else {
      html = items.map((item, i) => {
        const key    = `${item.type}_${item.id}`;
        const result = this._stealAttempted[key];
        const done   = !!result;
        const chance = window.StealCalculator
          ? window.StealCalculator.calculateStealChance(item.data, agility)
          : 50;
        const cc = chance >= 70 ? '#2a6e4a' : chance >= 40 ? '#b8860b' : '#c02020';
        const badge = result === 'success'
          ? ` <span style="color:#2a6e4a;font-weight:bold;">${_escapeHtml(T.successLabel)}</span>`
          : result === 'fail'
          ? ` <span style="color:#c02020;font-weight:bold;">${_escapeHtml(T.failedLabel)}</span>`
          : ` <span style="color:${cc};">${chance}%</span>`;
        return `<div class="npc-chat-action-btn${done ? ' npc-action-disabled' : ''}" onmousedown="event.stopPropagation();SceneManager._scene._attemptSteal(${i})">` +
          `${_iconSpan(item.data.iconIndex || 0, 15)}<span>${_escapeHtml(item.data.name)}</span>${badge}</div>`;
      }).join('');
    }
    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  // ============================================================================
  // Info panel
  // ============================================================================

  // Curated dossier block for an event tagged "Preset: <name>". Everything here
  // is hand-authored data from CharacterCreationPresets.js, so it is shown as
  // its own section rather than mixed into the sim-derived rows below it.
  Scene_NPCEmpathize.prototype._buildPresetHTML = function (preset, T, lang) {
    if (!preset) return '';
    const rows = [];
    const className = _presetClassName(preset);
    if (className) rows.push(_kvRow(126, T.vocationLbl, _escapeHtml(className)));
    if (preset.birthDate) {
      const age  = _presetAge(preset.birthDate);
      const born = _presetBirthDate(preset.birthDate);
      rows.push(_kvRow(220, T.bornLbl,
        _escapeHtml(age != null ? `${born} (${age} ${T.yearsAbbr})` : born)));
    }
    const hometown = _presetHometown(preset);
    if (hometown) {
      rows.push(_kvRow(190, T.hometownLbl, _escapeHtml(hometown)));
    }
    if (preset.nationId) {
      // Link the nation only when the archive actually has a page for it, so a
      // dossier naming a country the history sim doesn't track (or a place that
      // is no longer a nation) stays plain text instead of a dead link.
      let known = false;
      try { known = !!Wiki.get?.('nation', preset.nationId); } catch (e) {}
      rows.push(_kvRow(97, T.nationOfBirthLbl,
        known ? _wikiLink('nation', preset.nationId) : _escapeHtml(preset.nationId)));
    }
    const genderLabel = _presetGenderLabel(preset.gender, T);
    if (genderLabel) rows.push(_kvRow(84, T.genderLbl, _escapeHtml(genderLabel)));
    if (preset.money) rows.push(_kvRow(314, T.wealthLbl, _escapeHtml(_euros(preset.money))));

    let traitsHTML = '';
    const traitBank = _presetTraitBank();
    if (preset.traits?.length && traitBank.length) {
      const tags = preset.traits.map(id => {
        const trait = traitBank.find(t => t.id === id);
        return trait
          ? `<span class="npc-tag">${_iconSpan(trait.icon || 0, 15)}${_escapeHtml(_traitDisplayName(trait))}</span>`
          : '';
      }).filter(Boolean).join('');
      if (tags) traitsHTML = `<div class="npc-sec-hdr" style="margin-top:6px;">${_escapeHtml(T.traits)}</div><div class="npc-tag-wrap">${tags}</div>`;
    }

    let specsHTML = '';
    if (preset.specializations?.length && window.Specializations?.ready) {
      const tags = preset.specializations.map(entry => {
        const spec = window.Specializations.byId.get(entry.id);
        if (!spec) return '';
        return `<span class="npc-tag">${_escapeHtml(window.Specializations.displayName(spec))} <span style="opacity:0.6;">(${_escapeHtml(window.Specializations.levelName(entry.level))})</span></span>`;
      }).filter(Boolean).join('');
      if (tags) specsHTML = `<div class="npc-sec-hdr" style="margin-top:6px;">${_escapeHtml(T.specializations)}</div><div class="npc-tag-wrap">${tags}</div>`;
    }

    let skillsHTML = '';
    if (preset.skills?.length && $dataSkills) {
      const tags = preset.skills.map(id => {
        const sk = $dataSkills[id];
        return sk ? `<span class="npc-tag">${_iconSpan(sk.iconIndex || 0, 15)}${_escapeHtml(sk.name)}</span>` : '';
      }).filter(Boolean).join('');
      if (tags) skillsHTML = `<div class="npc-sec-hdr" style="margin-top:6px;">${_escapeHtml(T.skills)}</div><div class="npc-tag-wrap">${tags}</div>`;
    }

    const lore = _presetLore(preset, lang);
    const loreHTML = lore
      ? `<div class="npc-sec-hdr" style="margin-top:6px;">${_escapeHtml(T.history)}</div>` +
        `<div class="npc-thought" style="font-style:normal;">${_linkify(lore)}</div>`
      : '';

    if (!rows.length && !traitsHTML && !specsHTML && !skillsHTML && !loreHTML) return '';
    return `<hr class="npc-r-sep">` +
      `<div class="npc-sec-hdr">${_escapeHtml(T.dossierSection)}</div>` +
      rows.join('') + loreHTML + traitsHTML + specsHTML + skillsHTML;
  };

  // Health.Traits is the live trait bank; the society data loader keeps its own
  // copy, used when Health_Core has not populated it yet.
  function _presetTraitBank() {
    const bank = window.Health?.Traits;
    if (bank?.length) return bank;
    return window._NPCSocietyDataLoader?.traits || [];
  }

  Scene_NPCEmpathize.prototype._buildInfoHTML = function (displayName, subParts, profile, T, dl, opinion, lang, classId, npcName, preset) {
    // Looking at a real party member: everything the player owns on that
    // character (specializations, what they are carrying) is read off the actor
    // rather than off the society roll for somebody of the same name.
    const actorObj = this._actorId != null ? $gameActors.actor(this._actorId) : null;
    const wealthLabels = [T.destitute, T.poor, T.workingClass, T.middleClass, T.wealthy];
    const wealthLabel  = wealthLabels[profile?.wealthTierBase ?? 2] ?? '';
    const morality     = profile?.moralityScore ?? 0;
    const moralMap     = [
      { threshold: -60,      label: T.evil,     color: '#c02020' },
      { threshold: -20,      label: T.dishonest, color: '#c02020' },
      { threshold:  20,      label: T.neutral,   color: '#8a6a30' },
      { threshold:  60,      label: T.honest,    color: '#2a6e4a' },
      { threshold: Infinity, label: T.virtuous,  color: '#2a6e4a' },
    ];
    const moralEntry = moralMap.find(e => morality < e.threshold);
    const moralColor = moralEntry.color;

    const badgeHTML = `
      <div class="npc-badge-row">
        ${wealthLabel ? `<span class="npc-badge">${_escapeHtml(wealthLabel)}</span>` : ''}
        <span class="npc-badge" style="color:${moralColor}">Mor. ${morality} (${_escapeHtml(moralEntry.label)})</span>
      </div>`;

    const pers         = dl?.personalities?.[profile?.personalityIndex];
    const persName     = pers ? (lang === 'it' ? pers.name_it || pers.name : pers.name) : '';
    const persIcon     = pers?.iconIndex || 4;
    const faction      = (profile?.factionIndex >= 0 && dl?.factions) ? dl.factions[profile.factionIndex] : null;
    const ideology     = window.NPCShared?.ideologyFor(profile) ?? null;
    const ideologyName = ideology
      ? ((window.DataService?.t?.(ideology.name)) ||
         (ideology.name || '').split('.').pop().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))
      : null;

    let identHTML = '';
    if (profile) {
      if (persName)     identHTML += `<div class="npc-ident-row">${_iconSpan(persIcon, 17)}<span>${_escapeHtml(persName)}</span></div>`;
      if (wealthLabel)  identHTML += `<div class="npc-ident-row">${_iconSpan(314, 17)}<span>${_escapeHtml(wealthLabel)}</span></div>`;
      if (ideologyName) identHTML += `<div class="npc-ident-row">${_iconSpan(186, 17)}<span>${_escapeHtml(ideologyName)}</span></div>`;
      if (faction)      identHTML += `<div class="npc-ident-row">${_iconSpan(faction.iconIndex || 187, 17)}${_wikiLink('faction', _factionDisplayName(faction))}</div>`;
      identHTML += `<div class="npc-ident-row">${_iconSpan(175, 17)}<span style="color:${moralColor}">${_escapeHtml(moralEntry.label)}</span><span style="opacity:0.45;">&nbsp;— ${morality}</span></div>`;
      // Em (Switch 48): where this person stands on the witch who fed the
      // spear. Shown only while she is the one doing the talking.
      const emCtx = this._emCtx?.();
      if (emCtx) {
        const stanceLabel = lang === 'it'
          ? emCtx.data.label
          : emCtx.data.label;
        if (stanceLabel) {
          const stanceColor = emCtx.key === 'zealot' ? '#c02020'
            : emCtx.key === 'annoyed' ? '#8a6a30'
            : '#2a6e4a';
          identHTML += `<div class="npc-ident-row">${_iconSpan(79, 17)}` +
            `<span style="opacity:0.65;">${_escapeHtml(T.towardEmLbl)}:</span>&nbsp;` +
            `<span style="color:${stanceColor}">${_escapeHtml(stanceLabel)}</span></div>`;
        }
      }
      // Bubba (Switch 49): the same row, except everybody stands in the same
      // place on him.
      const bubbaCtx = this._bubbaCtx?.();
      if (bubbaCtx) {
        const label = lang === 'it'
          ? bubbaCtx.data.label
          : bubbaCtx.data.label;
        if (label) {
          identHTML += `<div class="npc-ident-row">${_iconSpan(79, 17)}` +
            `<span style="opacity:0.65;">${_escapeHtml(T.towardBubbaLbl)}:</span>&nbsp;` +
            `<span style="color:#2a6e4a">${_escapeHtml(label)}</span></div>`;
        }
      }
    }

    // ── Political identity (NPCPolitics), every link opens a wiki profile ──
    let politicsHTML = '';
    const identity = npcName ? window.NPCPolitics?.getIdentity?.(npcName) : null;

    // "Citizen of": the home map-pool (settlement/group the NPC belongs to) is
    // shown first, then the political nation/power when a political identity
    // exists. The row renders even for NPCs with no political identity.
    const citizenParts = [];
    // Somebody who is not from here has no hometown and no nation: what they
    // have is a system they came from and a power out there that claims them,
    // so that is what the row says instead. Nothing on Earth applies to them.
    const alien = _alienIdentity(profile, npcName, this._eventId);
    if (alien) {
      citizenParts.push(`<span>${_escapeHtml(alien.originName)}</span>`);
      citizenParts.push(_wikiLink('power', alien.power, alien.powerName));
    } else {
      const homeTown = _homeTownLabel(profile?._homeGroupName);
      if (homeTown) citizenParts.push(`<span>${_escapeHtml(homeTown)}</span>`);
      // Nation of the home map: the simulated political identity when it exists,
      // otherwise resolve straight from the home group so procedural citizens (and
      // any NPC not yet processed by the politics sim) still show their nation.
      const homeNation = identity?.country
        || window.NPCPolitics?.nationOfGroup?.(profile?._homeGroupName)
        || null;
      if (homeNation) citizenParts.push(_wikiLink('nation', homeNation));
      if (identity?.power && identity.power !== 'Neutral') citizenParts.push(_wikiLink('power', identity.power));
    }

    if (identity || citizenParts.length) {
      politicsHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.politicsSection}</div>`;
      if (citizenParts.length) {
        const label = alien ? T.originLbl : T.citizenOf;
        politicsHTML += `<div class="npc-ident-row">${_iconSpan(97, 17)}<span style="opacity:0.65;">${_escapeHtml(label)}:</span>&nbsp;${citizenParts.join('&nbsp;·&nbsp;')}</div>`;
      }
      if (alien) {
        politicsHTML += `<div class="npc-ident-row">${_iconSpan(158, 17)}<span style="opacity:0.65;">${_escapeHtml(T.casteLbl)}:</span>&nbsp;<span>${_escapeHtml(alien.casteName)}</span></div>`;
        if (alien.casteDesc) {
          politicsHTML += `<div class="npc-ident-row" style="opacity:0.55;font-style:italic;">${_escapeHtml(alien.casteDesc)}</div>`;
        }
      }
    }
    if (identity) {
      const power = window.NPCPolitics?.getPower?.(identity.power);
      const party = power && identity.partyId ? window.NPCPolitics?.getPartyOf?.(identity.power, identity.partyId) : null;
      const grudgeParty = power && identity.grudgePartyId ? window.NPCPolitics?.getPartyOf?.(identity.power, identity.grudgePartyId) : null;
      const eng = identity.engagement ?? 0;
      const engLabel = eng < 25 ? (T.engApathetic)
        : eng < 50 ? (T.engVoter)
        : eng < 75 ? (T.engActivist)
        : (T.engOrganizer);

      if (party) politicsHTML += `<div class="npc-ident-row">${_iconSpan(187, 17)}<span style="opacity:0.65;">${_escapeHtml(T.partyLbl)}:</span>&nbsp;${_wikiLink('party', party.id, party.name)}</div>`;
      politicsHTML += `<div class="npc-ident-row">${_iconSpan(83, 17)}<span style="opacity:0.65;">${_escapeHtml(T.engagementLbl)}:</span>&nbsp;<span>${_escapeHtml(engLabel)} (${eng})</span></div>`;
      if (identity.localOffice) {
        const officeLabel = window.NPCPolitics?.LOCAL_OFFICE_LABELS?.[identity.localOffice] || identity.localOffice;
        politicsHTML += `<div class="npc-ident-row">${_iconSpan(215, 17)}<span style="opacity:0.65;">${_escapeHtml(T.localOfficeLbl)}:</span>&nbsp;<span>${_escapeHtml(`${officeLabel}${identity.group ? `, ${identity.group}` : ''}`)}</span></div>`;
      }
      if (identity.votedLast && power) {
        const voted = window.NPCPolitics?.getPartyOf?.(identity.power, identity.votedLast.partyId);
        const when = window.NPCPolitics?.dateOf?.(identity.votedLast.minute);
        if (voted) politicsHTML += `<div class="npc-ident-row">${_iconSpan(220, 17)}<span style="opacity:0.65;">${_escapeHtml(T.lastVoteLbl)}:</span>&nbsp;<span>${_escapeHtml(voted.name)}${when ? ` <span style="opacity:0.5;">(${_escapeHtml(when)})</span>` : ''}</span></div>`;
      }
      if (grudgeParty) {
        politicsHTML += `<div class="npc-ident-row">${_iconSpan(1, 17)}<span style="opacity:0.65;">${_escapeHtml(T.grudgeLbl)}:</span>&nbsp;<span style="color:#c02020;">${_escapeHtml(grudgeParty.name)}</span></div>`;
      }
    }

    let traitsHTML = '';
    if (profile?.traitIds?.length) {
      traitsHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.traits}</div><div class="npc-tag-wrap">`;
      for (const id of profile.traitIds) {
        const trait = dl?.traits?.find(t => t.id === id);
        if (trait) traitsHTML += `<span class="npc-tag">${_iconSpan(trait.icon || 0, 15)}${_escapeHtml(_traitDisplayName(trait))}</span>`;
      }
      traitsHTML += '</div>';
    }

    let specsHTML = '';
    const npcSpecs = actorObj
      ? _getActorSpecializations(actorObj)
      : _getNpcSpecializations(profile, classId ?? profile?.assignedClassId, dl, npcName);
    if (npcSpecs.length) {
      specsHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.specializations}</div><div class="npc-tag-wrap">`;
      for (const s of npcSpecs) specsHTML += `<span class="npc-tag">${_escapeHtml(s.name)} <span style="opacity:0.6;">(${_escapeHtml(s.levelName)})</span></span>`;
      specsHTML += '</div>';
    }

    let equipHTML = '';
    if (actorObj || (profile && window.NPCSocietyGetEquip)) {
      const equipItems = [];
      if (actorObj) {
        // What the player actually equipped, gaps and all.
        for (const e of actorObj.equips()) if (e) equipItems.push(e);
      } else {
        const equip = window.NPCSocietyGetEquip(displayName, classId ?? profile.assignedClassId, profile.wealthTierBase);
        if (equip.weaponId) { const w = $dataWeapons?.[equip.weaponId]; if (w) equipItems.push(w); }
        for (const id of (equip.armorIds || [])) { const a = $dataArmors?.[id]; if (a) equipItems.push(a); }
      }
      if (equipItems.length) {
        equipHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.equipment}</div><div class="npc-tag-wrap">`;
        for (const e of equipItems) equipHTML += `<span class="npc-tag">${_iconSpan(e.iconIndex || 0, 15)}${_escapeHtml(e.name)}</span>`;
        equipHTML += '</div>';
      }
    }

    let skillsHTML = '';
    // Skills granted by the NPC's traits (Traits.json `skills` arrays), keyed
    // by skill id -> granting trait so the tag can say where it came from.
    const traitSkillSource = new Map();
    for (const tid of (profile?.traitIds || [])) {
      const trait = dl?.traits?.find(t => t.id === tid);
      for (const sid of (trait?.skills || [])) {
        if (!traitSkillSource.has(sid)) traitSkillSource.set(sid, trait);
      }
    }
    if ((profile?.skillIds?.length || traitSkillSource.size) && $dataSkills) {
      const allIds = [...(profile?.skillIds || [])];
      if (profile?.levelSkillBrackets) {
        Object.keys(profile.levelSkillBrackets).map(Number).sort((a, b) => a - b)
          .forEach(b => allIds.push(...profile.levelSkillBrackets[b]));
      }
      for (const sid of traitSkillSource.keys()) {
        if (!allIds.includes(sid)) allIds.push(sid);
      }
      const seen = new Set();
      let tags = '';
      for (const id of allIds) {
        const sk = $dataSkills[id];
        if (!sk || seen.has(id)) continue;
        seen.add(id);
        const srcTrait = traitSkillSource.get(id);
        if (srcTrait) {
          const traitName = _traitDisplayName(srcTrait);
          // Skills that come from a trait rather than the class are marked with
          // the trait's own colour, the tags carry no frame to outline any more.
          tags += `<span class="npc-tag" style="color:#8a6d3b;" title="${_escapeHtml(`${T.traits}: ${traitName}`)}">${_iconSpan(sk.iconIndex || 0, 15)}${_escapeHtml(sk.name)}</span>`;
        } else {
          tags += `<span class="npc-tag">${_iconSpan(sk.iconIndex || 0, 15)}${_escapeHtml(sk.name)}</span>`;
        }
      }
      if (tags) {
        skillsHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.skills}</div><div class="npc-tag-wrap">${tags}</div>`;
      }
    }

    let simHTML = '';
    const hasSimData = profile && (
      profile.currentNeed !== undefined || profile.currentJobId ||
      profile.money !== undefined || profile.hunger !== undefined
    );
    if (hasSimData) {
      simHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.status}</div>`;
      if (profile.currentNeed) {
        const needLabels = _needLabels(T);
        simHTML += `<div class="npc-ident-row">${_iconSpan(NEED_ICONS[profile.currentNeed] || 0, 17)}<span>${_escapeHtml(needLabels[profile.currentNeed] || profile.currentNeed)}</span></div>`;
      }
      if (profile.currentJobId && window.WorkSystem?.getJob) {
        const job = window.WorkSystem.getJob(profile.currentJobId);
        if (job) simHTML += `<div class="npc-ident-row">${_iconSpan(126, 17)}<span>${_escapeHtml(job.name)}</span></div>`;
      }
      if (profile.money !== undefined) {
        simHTML += `<div class="npc-ident-row" style="margin-top:3px;">${_iconSpan(314, 17)}<span>${_euros(profile.money)} ${T.onHand}</span></div>`;
      }
      if (opinion >= 20) {
        const lbl = opinion >= 60 ? T.knowsYouWell : T.remembersYou;
        simHTML += `<div class="npc-opinion-note">✶ ${_escapeHtml(lbl)}</div>`;
      }
      if (profile.thoughts?.[0]) {
        simHTML += `<div class="npc-thought">&ldquo;${_escapeHtml(profile.thoughts[0])}&rdquo;</div>`;
      }
    }

    // Stats and the EXP bar live in the left column (see _buildStatsGridHTML),
    // where they stay visible whichever tab is open, so the Info page does not
    // repeat them.

    return `
      <div class="npc-profile-name">${_escapeHtml(displayName || '—')}</div>
      ${subParts.length ? `<div class="npc-profile-sub">${_escapeHtml(subParts.join(' · '))}</div>` : ''}
      ${badgeHTML}
      ${this._buildPresetHTML(preset, T, lang)}
      <hr class="npc-r-sep">
      ${identHTML}
      ${politicsHTML}
      ${traitsHTML}
      ${specsHTML}
      ${equipHTML}
      ${skillsHTML}
      ${simHTML}`;
  };

  // ============================================================================
  // Social web panel
  // ============================================================================

  // The graph is plain markup, not a canvas. Every earlier version painted it
  // imperatively in a frame callback after the render, and so had to survive the
  // panel being rebuilt underneath it, bust images landing late, and a stale
  // overlay owning the element — the failure mode being a tab that flashed the
  // web once and then sat there as an empty grey rectangle. An inline SVG is
  // part of the same innerHTML as the rest of the tab, so it is simply correct
  // on every render: nothing to schedule, nothing to clear, nothing to redraw
  // when an image finishes loading. The viewBox is sized to the finished
  // layout, so the whole web is always on screen and nothing needs panning.

  const _WEB_RING_CAP  = 8;   // nodes on the innermost ring
  const _WEB_RING_STEP = 4;   // each ring outward holds this many more
  const _WEB_R0        = 120; // radius of the innermost ring
  const _WEB_DR        = 98;  // gap between rings
  const _WEB_NODE_R    = 26;
  const _WEB_CENTER_R  = 34;
  const _WEB_MAX_NODES = 40;  // beyond this the graph is unreadable, the roster carries the rest

  // Everyone this person is connected to: the "met X" entries in their life log
  // merged with their standing relationships, so an acquaintance nobody has been
  // seen meeting yet still gets a (faint, dashed) thread of their own.
  function _webContacts(profile) {
    const byName = new Map();
    for (const c of _extractContacts(profile, Infinity)) {
      if (c.name) byName.set(c.name, { name: c.name, meetings: c.count, opinion: 0, known: false });
    }
    // Synthetic and debug profiles can carry null or primitive relationship
    // entries, so every field here is read defensively.
    const rels = profile?.relationships ?? {};
    for (const [name, rel] of Object.entries(rels)) {
      if (!name) continue;
      const e = byName.get(name) ||
        { name: String(name), meetings: 0, opinion: 0, known: false };
      e.meetings = Math.max(e.meetings, Number(rel?.meetCount) || 0);
      e.opinion  = Number(rel?.opinion) || 0;
      e.known    = true;
      byName.set(name, e);
    }
    return [...byName.values()].sort((a, b) =>
      (b.meetings - a.meetings) || String(a.name).localeCompare(String(b.name)));
  }

  // Warm, cold or indifferent. A thread nobody has walked yet stays bark-coloured.
  function _webEdgeColor(entry) {
    if (!entry.meetings)      return 'var(--bg-npc-bark)';
    if (entry.opinion >= 20)  return 'var(--bg-npc-forest)';
    if (entry.opinion <= -20) return 'var(--border-npc-red)';
    return 'var(--text-text-alt-4)';
  }

  // Concentric rings, closest relationships innermost. Returns node centres in
  // graph space (the focus node sits at the origin) plus the outermost radius,
  // which is what the viewBox is built from.
  function _webLayout(count) {
    const pts = [];
    let ring = 0, placed = 0, outer = 0;
    while (placed < count) {
      const cap    = _WEB_RING_CAP + ring * _WEB_RING_STEP;
      const len    = Math.min(cap, count - placed);
      const radius = _WEB_R0 + ring * _WEB_DR;
      for (let i = 0; i < len; i++) {
        // The half-turn offset per ring keeps outer nodes out of the shadow of
        // the inner ones, so no thread is drawn straight through a face.
        const angle = (i / len) * Math.PI * 2 - Math.PI / 2 + ring * 0.42;
        pts.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
      outer = radius;
      placed += len;
      ring++;
    }
    return { pts, outer };
  }

  Scene_NPCEmpathize.prototype._buildWebHTML = function (T, profile, npcName, bustPath) {
    const all = _webContacts(profile);
    // Rows and nodes share one list, so a click handler can address either by
    // the same index; the graph simply stops at the first _WEB_MAX_NODES.
    this._webList = all;
    const drawn = all.slice(0, _WEB_MAX_NODES);

    const { pts, outer } = _webLayout(drawn.length);
    const pad  = _WEB_NODE_R + 34; // room for the name printed under a node
    const half = Math.max(_WEB_CENTER_R + 46, outer + pad);
    const viewBox = `${-half} ${-half} ${half * 2} ${half * 2}`;

    const num = n => (Math.round(n * 10) / 10).toString();

    // i18n-ignore-start: inline SVG markup for the connections web
    const edges = drawn.map((e, i) => {
      const p = pts[i];
      const w = Math.max(1.6, Math.min(5.5, 1.4 + e.meetings / 8));
      const dash = e.meetings <= 1 ? ' stroke-dasharray="7 5"' : '';
      return `<line x1="0" y1="0" x2="${num(p.x)}" y2="${num(p.y)}" ` +
             `stroke="${_webEdgeColor(e)}" stroke-width="${num(w)}" stroke-linecap="round" ` +
             `opacity="${e.meetings ? '0.9' : '0.45'}"${dash}/>`;
    }).join('');

    // i18n-ignore-end

    // How many times they have actually met, printed on the thread itself.
    const tallies = drawn.map((e, i) => {
      if (!e.meetings) return '';
      const p = pts[i];
      const mx = num(p.x / 2), my = num(p.y / 2);
      return `<g class="npc-web-tally">` +
             `<circle cx="${mx}" cy="${my}" r="12"/>` +
             `<text x="${mx}" y="${my}">${'×' + e.meetings}</text></g>`;
    }).join('');

    // One node. `index < 0` marks the focus node, which is not clickable.
    // The initial is painted under the portrait rather than instead of it, so a
    // bust that is missing or still loading degrades to a lettered disc with no
    // callback, no cache and no second draw.
    // i18n-ignore-start: inline SVG markup for one node of the web
    const node = (x, y, r, label, path, index) => {
      const clip    = `npcWebClip${index < 0 ? 'C' : index}`;
      const initial = _escapeHtml((String(label)[0] || '?').toUpperCase());
      const short   = String(label).length > 14 ? String(label).slice(0, 13) + '…' : String(label);
      const attrs   = index < 0
        ? 'class="npc-web-node npc-web-node--center"'
        : `class="npc-web-node" onmousedown="event.stopPropagation();SceneManager._scene._openWebNode(${index})"`;
      const img = path
        ? `<image href="${_escapeHtml(path)}" xlink:href="${_escapeHtml(path)}" ` +
          `x="${num(x - r)}" y="${num(y - r)}" width="${num(r * 2)}" height="${num(r * 2)}" ` +
          `preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`
        : '';
      return `<g ${attrs}>` +
        `<clipPath id="${clip}"><circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}"/></clipPath>` +
        `<circle class="npc-web-disc" cx="${num(x)}" cy="${num(y)}" r="${num(r)}"/>` +
        `<text class="npc-web-initial" x="${num(x)}" y="${num(y)}" font-size="${Math.round(r)}">${initial}</text>` +
        img +
        `<circle class="npc-web-rim" cx="${num(x)}" cy="${num(y)}" r="${num(r)}"/>` +
        `<text class="npc-web-label" x="${num(x)}" y="${num(y + r + 16)}">${_escapeHtml(short)}</text>` +
        `</g>`;
    };

    // i18n-ignore-end

    const nodes = drawn.map((e, i) =>
      node(pts[i].x, pts[i].y, _WEB_NODE_R, e.name, _resolveBustPath(e.name, null), i)).join('');
    const centre = node(0, 0, _WEB_CENTER_R, npcName || '?', bustPath || null, -1);

    // i18n-ignore-start: SVG frame for the web
    const graph =
      `<div class="npc-web-stage">
         <svg class="npc-web-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"
              xmlns="http://www.w3.org/2000/svg">
           ${edges}${tallies}${nodes}${centre}
         </svg>
       </div>
       <div class="npc-web-legend">
         <span class="npc-legend-item"><span class="npc-legend-line npc-legend-line--single"></span>${T.singleMeeting}</span>
         <span class="npc-legend-item"><span class="npc-legend-line npc-legend-line--multi"></span>${T.frequentMeetings}</span>
       </div>`;

    if (!all.length) {
      return `
        <div class="npc-sec-hdr" style="margin-bottom:8px;">${T.socialWebTitle}</div>
        ${graph}
        <p style="opacity:.6;font-style:italic;margin-top:8px;">${T.noContacts}</p>
        <p style="font-size:1.08rem;opacity:.44;">${T.contactsHint}</p>`;
    }

    // The roster repeats the graph as plain rows: it names everyone in full,
    // carries whoever did not fit on the rings, and stays readable when the web
    // gets crowded.
    // i18n-ignore-end

    const meetLabel = n => n
      ? String(T.webMeetings).replace('{n}', String(n))
      : (T.webNeverMet);
    // i18n-ignore-start: row markup and its inline handler
    const rows = all.map((e, i) => {
      const off = i >= drawn.length ? ' npc-web-row--offgraph' : '';
      return `<div class="npc-web-row${off}" ` +
        `onmousedown="event.stopPropagation();SceneManager._scene._openWebNode(${i})">` +
        `<span class="npc-web-dot" style="background:${_webEdgeColor(e)};"></span>` +
        `<span class="npc-web-row-name">${_escapeHtml(e.name)}</span>` +
        `<span class="npc-web-row-meta">${_escapeHtml(meetLabel(e.meetings))}</span>` +
        `</div>`;
      // i18n-ignore-end
    }).join('');

    return `
      <div class="npc-sec-hdr" style="margin-bottom:8px;">${T.socialWebTitle}</div>
      ${graph}
      <div class="npc-routine-sub-hdr">${_escapeHtml(T.webRosterTitle)}</div>
      <div class="npc-web-roster">${rows}</div>`;
  };

  // A node or a roster row was clicked: open that person's own panel, on their
  // own Social Web, so the player keeps walking the same graph outward.
  Scene_NPCEmpathize.prototype._openWebNode = function (index) {
    const entry = (this._webList || [])[index];
    if (!entry || !entry.name) return;
    SoundManager.playOk();
    window.NPCEmpathize?.openByName?.(entry.name, 'web');
  };

  // ============================================================================
  // Background tab
  // ============================================================================

  Scene_NPCEmpathize.prototype._buildBackgroundTabHTML = function (T, profile, npcName) {
    if (profile && !profile.backstory) window.NPCHistSim?.generateBackstoryNow?.(npcName);
    const backstory  = profile?.backstory;
    const headerHTML = `<div class="npc-sec-hdr">${T.historyTitle}</div><hr class="npc-r-sep">`;

    let backstoryHTML;
    if (!backstory) {
      backstoryHTML = `<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noBackstory)}</p>`;
    } else {
      const ICONS  = window.HistorySimulator_ICONS ?? {};
      const evRows = (backstory.formativeEvents ?? []).map(e => {
        const iconId = ICONS[e.category] ?? 245;
        return `<div class="npc-backstory-event">${_iconSpan(iconId, 14)}<span>${_escapeHtml(e.date)}</span>, ${_escapeHtml(e.description)}</div>`;
      }).join('');

      backstoryHTML = `
        <div class="npc-backstory-text">${_escapeHtml(window.NPCHistSim?.narrativeOf?.(backstory) ?? backstory.narrative ?? '')}</div>
        <div class="npc-backstory-events">${evRows}</div>
        <div class="npc-backstory-meta">${_escapeHtml(T('NPCSociety.bio.bornMeta', { year: backstory.birthYear,
          place: window.WorkSystem?.destinationName ? window.WorkSystem.destinationName(backstory.birthplace) : backstory.birthplace }))}</div>`;
    }

    let lifeSummaryHTML = '';
    if (npcName && window.NPCLifeSim) {
      window.NPCLifeSim.ensureLifeRecord?.(npcName, profile?._homeGroupName);
      const bio = window.NPCLifeSim.buildBiography?.(npcName);
      if (bio) {
        const lines = bio.split('\n').filter(Boolean)
          .map(line => `<div class="npc-backstory-event">${_escapeHtml(line)}</div>`).join('');
        lifeSummaryHTML = `
          <hr class="npc-r-sep">
          <div class="npc-sec-hdr">${T.lifeSummary}</div>
          <div class="npc-backstory-events">${lines}</div>`;
      }
    }

    return `${headerHTML}${backstoryHTML}${lifeSummaryHTML}`;
  };

  // ============================================================================
  // Routine tab
  // ============================================================================

  Scene_NPCEmpathize.prototype._buildRoutineTabHTML = function (T, profile) {
    const headerHTML = `<div class="npc-sec-hdr">${T.routineTitle}</div><hr class="npc-r-sep">`;

    const RM = window.NPCSim?.RoutineManager;
    if (!profile || !RM) {
      return `${headerHTML}<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRoutineData)}</p>`;
    }

    const needLabels = _needLabels(T);
    const fmtHour    = h => `${String(h).padStart(2, '0')}:00`;
    const row = (hour, activity, cls) => `
      <div class="npc-routine-row ${cls}"${cls === 'now' ? ' id="npc-routine-now"' : ''}>
        <span class="npc-routine-hour">${fmtHour(hour)}</span>
        ${_iconSpan(NEED_ICONS[activity] ?? 0, 14)}
        <span>${_escapeHtml(_activityLabel(activity, profile, T, needLabels))}</span>
      </div>`;

    const past   = RM.getLast24Hours(profile) ?? [];
    const future = RM.getRestOfDay(profile)   ?? [];

    const pastRows   = past.map(e => row(e.hour, e.activity, e.isPast ? 'past' : 'now')).join('');
    const futureRows = future.length
      ? future.map(e => row(e.hour, e.activity, '')).join('')
      : `<p style="opacity:0.6;font-style:italic;">${_escapeHtml(T.routineNothingPlanned)}</p>`;

    return `
      ${headerHTML}
      <div class="npc-routine-sub-hdr">${T.routinePast24h}</div>
      ${pastRows}
      <div class="npc-routine-sub-hdr">${T.routineRestOfDay}</div>
      ${futureRows}`;
  };

  // ============================================================================
  // Biologics tab
  // ============================================================================
  // Simplified anatomy readout: the NPC's limbs/organs come straight from
  // their archetype's part table (window.Health.EnemyArchetypes, the same
  // data Health_Core builds player body parts from), with per-part condition
  // and congenital missing limbs rolled deterministically from the world
  // seed. Display-only, no Health_BiologicSimulation machinery involved.

  let _archetypeI18nCache = null;
  function _archetypePartName(part, key) {
    const raw = part?.name;
    if (raw && typeof raw === 'string' && raw.includes('.')) {
      if (_archetypeI18nCache === null) {
        _archetypeI18nCache = {};
        try {
          const xhr = new XMLHttpRequest();
          const lang = ConfigManager.language === 'it' ? 'it' : 'en';
          xhr.open('GET', `js/i18n/${lang}/enemyArchetypes.json`, false);
          xhr.send();
          if (xhr.status === 200 || xhr.status === 0) _archetypeI18nCache = JSON.parse(xhr.responseText);
        } catch (_) {}
      }
      const resolved = raw.split('.').reduce((acc, p) => acc && acc[p], _archetypeI18nCache);
      if (resolved && typeof resolved === 'string') return resolved;
    }
    if (raw && typeof raw === 'string' && !raw.includes('.')) return raw;
    return key.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // ============================================================================
  // Health tab, current illnesses + pre-simulated medical history + conditions
  // ============================================================================

  const _SEV_COLOR = {
    trivial: '#5a9a2a', mild: '#7a9a2a', moderate: '#b8860b',
    severe: '#d9534f', lethal: '#a02020', esoteric: '#7a3fbf', chronic: '#b8860b',
  };

  Scene_NPCEmpathize.prototype._buildHealthTabHTML = function (T, profile, npcName) {
    const headerHTML = `<div class="npc-sec-hdr">${T.healthTitle}</div><hr class="npc-r-sep">`;
    const DS = window.DiseaseSystem;
    // Party members show their own live disease state; NPCs show a
    // world-seeded, pre-simulated medical history persisted on the profile.
    const actorObj = this._actorId != null ? $gameActors.actor(this._actorId) : null;
    if (!DS || (!actorObj && (!profile || !npcName))) {
      return `${headerHTML}<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noHealth)}</p>`;
    }
    if (!actorObj) { try { DS.ensureNpcMedicalHistory(npcName, profile); } catch (e) {} }
    else { try { DS.ensureStoryConditions?.(); } catch (e) {} }

    const isChronic = d => d && (d.durationDays < 0 || d.durationDays >= 9999);

    const diseaseRow = entry => {
      const d = DS.getDisease(entry.id);
      if (!d) return '';
      const tags = [];
      if (entry.venereal || d.venereal)
        tags.push(`<span class="npc-badge" style="color:#b0448b;">${_escapeHtml(T.venerealTag)}</span>`);
      if (entry.epidemic)
        tags.push(`<span class="npc-badge" style="color:#d9534f;">${_escapeHtml(T.epidemicTag)}</span>`);
      if (d.infective)
        tags.push(`<span class="npc-badge">${_escapeHtml(T.contagiousTag)} ${Math.round(d.transmission * 100)}%</span>`);
      const symptoms = (d.symptoms || []).slice(0, 4).join(', ');
      return `
        <div class="npc-ident-row" style="align-items:flex-start;">
          <span style="width:10px;height:10px;border-radius:50%;background:${_SEV_COLOR[d.severity] || '#8a6a30'};margin-top:6px;flex-shrink:0;"></span>
          <div style="flex:1;">
            <div><b>${_escapeHtml(d.name)}</b> <span style="opacity:0.5;font-size:0.9em;">${_escapeHtml(d.category)}</span></div>
            ${tags.length ? `<div class="npc-badge-row" style="margin:2px 0;">${tags.join('')}</div>` : ''}
            ${d.desc ? `<div class="npc-thought" style="margin-top:1px;">${_escapeHtml(d.desc)}</div>` : ''}
            ${symptoms ? `<div style="opacity:0.6;font-size:0.9em;">${_escapeHtml(T.symptomsLbl)}: ${_escapeHtml(symptoms)}</div>` : ''}
          </div>
        </div>`;
    };

    const condRow = entry => {
      const c = DS.getCondition(entry.id != null ? entry.id : entry);
      if (!c) return '';
      const icon = c.category === 'injury' ? 176 : c.category === 'surgical' ? 168 : 186;
      return `
        <div class="npc-ident-row" style="align-items:flex-start;">
          ${_iconSpan(icon, 17)}
          <div style="flex:1;">
            <div><b>${_escapeHtml(c.name)}</b> <span style="opacity:0.5;font-size:0.9em;">${_escapeHtml(c.category)}</span></div>
            ${c.desc ? `<div class="npc-thought" style="margin-top:1px;">${_escapeHtml(c.desc)}</div>` : ''}
          </div>
        </div>`;
    };

    const pastBadge = id => {
      const d = DS.getDisease(id);
      return d ? `<span class="npc-badge" style="margin:2px 4px 2px 0;">${_escapeHtml(d.name)}</span>` : '';
    };

    // Every outbreak this person has been through: what they caught, and the
    // ones that swept their town while they were living in it. Historical
    // entries come from the century HistorySimulator generated, live ones from
    // the epidemics running right now.
    const epidemicRow = entry => {
      const disease = DS.getDisease(entry.diseaseId);
      const caught = entry.role === 'caught';
      const hysteria = entry.kind === 'hysteria';
      const roleLbl = caught
        ? (hysteria ? (T.epidemicSwept) : (T.epidemicCaught))
        : (T.epidemicLived);
      const tags = [`<span class="npc-badge" style="color:${caught ? '#d9534f' : '#7a7a7a'};">${_escapeHtml(roleLbl)}</span>`];
      if (hysteria) tags.push(`<span class="npc-badge" style="color:#7a3fbf;">${_escapeHtml(T.hysteriaTag)}</span>`);
      if (entry.historical) tags.push(`<span class="npc-badge">${_escapeHtml(T.historicalTag)}</span>`);
      return `
        <div class="npc-ident-row" style="align-items:flex-start;">
          ${_iconSpan(hysteria ? 79 : 176, 17)}
          <div style="flex:1;">
            <div><b>${_escapeHtml(entry.name || (disease ? disease.name : entry.diseaseId))}</b></div>
            <div class="npc-badge-row" style="margin:2px 0;">${tags.join('')}</div>
            <div style="opacity:0.6;font-size:0.9em;">${_escapeHtml(entry.place || '')}${entry.date ? `, ${_escapeHtml(String(entry.date))}` : ''}</div>
          </div>
        </div>`;
    };

    const cur   = actorObj ? DS.actorEntries(actorObj)    : DS.npcDiseases(profile);
    const conds = actorObj ? DS.actorConditions(actorObj) : DS.npcConditions(profile);
    const past  = actorObj ? DS.actorPast(actorObj)       : DS.npcPast(profile);
    const epis  = actorObj ? (DS.actorEpidemicHistory ? DS.actorEpidemicHistory(actorObj) : [])
                           : (DS.npcEpidemicHistory ? DS.npcEpidemicHistory(profile) : []);
    const acute   = cur.filter(e => { const d = DS.getDisease(e.id); return d && !isChronic(d); });
    const chronic = cur.filter(e => { const d = DS.getDisease(e.id); return d && isChronic(d); });

    // What is burning in their home town right now, whether or not they have it.
    let localHTML = '';
    const ES = window.EpidemicSystem;
    if (ES && !actorObj && profile) {
      const place = ES.placeForGroup(profile._homeGroupName);
      const live = place ? ES.activeAt(place.key) : [];
      if (live.length) {
        const rows = live.map(e => {
          const pct = (ES.prevalenceAt(place.key, e) * 100).toFixed(1);
          return `<div class="npc-ident-row"><div style="flex:1;"><b>${_escapeHtml(e.name)}</b>
            <div style="opacity:0.6;font-size:0.9em;">${_escapeHtml(ES.placeName ? ES.placeName(place.key) : place.key)} &mdash; ${pct}% ${_escapeHtml(T.epidemicIll)}</div></div></div>`;
        }).join('');
        localHTML = `<div class="npc-sec-hdr" style="margin-top:10px;">${_escapeHtml(T.epidemicLocal)}</div>${rows}`;
      }
    }

    const section = (title, body, empty) =>
      `<div class="npc-sec-hdr" style="margin-top:10px;">${_escapeHtml(title)}</div>` +
      (body || `<p style="opacity:0.5;font-style:italic;">${_escapeHtml(empty)}</p>`);

    return `
      ${headerHTML}
      ${section(T.currentIllness, acute.map(diseaseRow).join(''), T.noneCurrent)}
      ${chronic.length ? section(T.chronicConditions, chronic.map(diseaseRow).join('')) : ''}
      ${localHTML}
      ${section(T.epidemicsTitle, epis.map(epidemicRow).join(''), T.noEpidemics)}
      ${section(T.lastingConditions, conds.map(condRow).join(''), T.noneConditions)}
      ${section(T.pastIllness, past.length ? `<div class="npc-badge-row">${past.map(pastBadge).join('')}</div>` : '', T.noPast)}`;
  };

  // A party member's anatomy is not rolled: Health_Core keeps every limb and
  // organ on the actor (actor._bodyParts, a severed part being one deleted from
  // it), so the page reads the wounds the player's character actually carries
  // instead of a stranger's seeded anatomy.
  Scene_NPCEmpathize.prototype._buildActorBiologicsHTML = function (T, actor) {
    const headerHTML = `<div class="npc-sec-hdr">${T.biologicsTitle}</div><hr class="npc-r-sep">`;
    const HC   = window.HealthCore;
    const keys = HC?.getActorArchetypeKeys ? HC.getActorArchetypeKeys(actor) : ['Humanoid']; // i18n-ignore: EnemyArchetypes.json id
    const label = keys
      .map(k => (HC?.getArchetypeDisplayName ? HC.getArchetypeDisplayName(k) : k))
      .join(' / ');

    const held = actor._bodyParts || {};
    // Every part the archetype says they should have, so an amputation shows as
    // a missing limb rather than simply vanishing off the list.
    const expected = {};
    for (const key of keys) {
      const table = window.Health?.EnemyArchetypes?.[key]?.parts;
      if (table) for (const [k, part] of Object.entries(table)) if (!expected[k]) expected[k] = part;
    }
    const rows = [];
    for (const [key, part] of Object.entries(Object.keys(expected).length ? expected : held)) {
      const live = held[key];
      if (!live) { rows.push({ key, part, missing: true, cond: 0 }); continue; }
      const max  = live.maxHp || 1;
      rows.push({
        key,
        part: { name: live.name ?? part?.name, vital: live.vital ?? part?.vital },
        missing: false,
        cond: Math.max(0, Math.min(100, Math.round((live.currentHp / max) * 100))),
      });
    }
    if (!rows.length) {
      return `${headerHTML}<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noBiologics)}</p>`;
    }

    let condSum = 0, condCount = 0;
    for (const row of rows) { if (!row.missing) { condSum += row.cond; condCount++; } }
    const overall = condCount ? Math.round(condSum / condCount) : 0;

    const condColor = v => v >= 85 ? '#5a9a2a' : v >= 65 ? '#b8860b' : '#d9534f';
    // The traveller's own bars, not a scale against a notional 2000 HP: nothing
    // here is guessed, so nothing here is drawn against a guessed maximum.
    const vitalsHTML = `
      <div class="npc-bio-vitals">
        ${_meterRow('HP', Math.round((actor.hp / Math.max(1, actor.mhp)) * 100), '#d9534f')}
        ${_meterRow('MP', Math.round((actor.mp / Math.max(1, actor.mmp)) * 100), '#4070d0')}
        ${_meterRow(T.biologicsCondition, overall, condColor(overall))}
      </div>`;

    return `
      ${headerHTML}
      <div class="npc-bio-archetype">${_escapeHtml(T.biologicsArchetype)}: <b>${_escapeHtml(label)}</b></div>
      ${this._bloodTypeSectionHTML(T, window.BloodTypeService?.forActor(actor), actor)}
      ${vitalsHTML}
      <div class="npc-routine-sub-hdr">${_escapeHtml(T.biologicsParts)}</div>
      <div class="npc-bio-grid">${_bioPartRowsHTML(rows, T, condColor)}</div>`;
  };

  // Blood type line (real name + rarity), a universal donor/recipient badge
  // where it applies, a note for the ultra-rare antigen-negative lineages,
  // and, whenever the panel is being read on behalf of someone other than
  // the person being displayed, a real ABO/Rh transfusion-compatibility
  // verdict against the party member currently doing the talking
  // (this._focusActor()). window.BloodTypeService (Health_BiologicSimulation)
  // is the only place that data and that calculation live.
  Scene_NPCEmpathize.prototype._bloodTypeSectionHTML = function (T, bloodEntry, subject) {
    const BTS = window.BloodTypeService;
    if (!BTS || !bloodEntry) return '';

    const badges = [];
    if (BTS.isUniversalDonor(bloodEntry.id)) badges.push(`<span class="npc-badge">${_escapeHtml(T.bloodUniversalDonor)}</span>`);
    if (BTS.isUniversalRecipient(bloodEntry.id)) badges.push(`<span class="npc-badge">${_escapeHtml(T.bloodUniversalRecipient)}</span>`);
    const badgeHTML = badges.length ? `<div class="npc-badge-row" style="margin:2px 0;">${badges.join('')}</div>` : '';
    const rareNoteHTML = bloodEntry.rareAntigen
      ? `<div class="npc-thought" style="margin-top:1px;">${_escapeHtml(T.bloodRareAntigenNote)}</div>` : '';

    let compatHTML = '';
    const focusActor = this._focusActor ? this._focusActor() : null;
    if (focusActor && focusActor !== subject) {
      const focusEntry = BTS.forActor(focusActor);
      if (focusEntry) {
        const canGive = BTS.canDonate(bloodEntry.id, focusEntry.id);
        const canReceive = BTS.canDonate(focusEntry.id, bloodEntry.id);
        const label = canGive && canReceive ? T.bloodCompatBoth
          : canGive ? T.bloodCompatDonorOnly
          : canReceive ? T.bloodCompatRecipientOnly
          : T.bloodCompatNone;
        compatHTML = `<div class="npc-bio-archetype">${_escapeHtml(T.bloodCompatTitle)}: <b>${_escapeHtml(label)}</b></div>`;
      }
    }

    return `
      <div class="npc-bio-archetype">${_escapeHtml(T.bloodType)}: <b>${_escapeHtml(bloodEntry.type)} (${_escapeHtml(bloodEntry.rarity)})</b></div>
      ${badgeHTML}${rareNoteHTML}${compatHTML}`;
  };

  function _bioPartRowsHTML(rows, T, condColor) {
    return rows.map(({ key, part, missing, cond }) => {
      const label    = _escapeHtml(_archetypePartName(part, key));
      const vitalTag = part.vital ? `<span class="npc-bio-vital-tag">${_escapeHtml(T.biologicsVitalTag)}</span>` : '';
      if (missing) {
        return `
          <div class="npc-bio-part npc-bio-missing">
            <span class="npc-bio-part-name">${label}</span>
            <span class="npc-bio-missing-lbl">${_escapeHtml(T.biologicsMissing)}</span>
          </div>`;
      }
      return `
        <div class="npc-bio-part">
          <span class="npc-bio-part-name">${label}${vitalTag}</span>
          <div class="npc-vital-track" style="flex:1;"><div class="npc-vital-fill" style="width:${cond}%;background:${condColor(cond)};"></div></div>
          <span class="npc-vital-pct">${cond}%</span>
        </div>`;
    }).join('');
  }

  Scene_NPCEmpathize.prototype._buildBiologicsTabHTML = function (T, profile, npcName) {
    const actorObj = this._actorId != null ? $gameActors.actor(this._actorId) : null;
    if (actorObj) return this._buildActorBiologicsHTML(T, actorObj);

    const headerHTML = `<div class="npc-sec-hdr">${T.biologicsTitle}</div><hr class="npc-r-sep">`;
    const archetype  = profile?.archetype || 'Humanoid'; // i18n-ignore: EnemyArchetypes.json id
    const parts      = window.Health?.EnemyArchetypes?.[archetype]?.parts;
    if (!profile || !parts || !Object.keys(parts).length) {
      return `${headerHTML}<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noBiologics)}</p>`;
    }

    // World-seeded per-NPC anatomy roll, stable across sessions: the same
    // NPC in the same world is always missing the same (non-vital) limbs.
    const Shared = window.NPCShared;
    const rng    = Shared ? new Shared.Rng(Shared.nameHash(npcName + '_bio') ^ Shared.worldSeed()) : null;
    const rnd    = () => (rng ? rng.next() : 0.5);

    const rows = [];
    for (const [key, part] of Object.entries(parts)) {
      let missing = !part.vital && !!part.canCutoff && rnd() < 0.06;
      let cond = Math.round(60 + rnd() * 40);
      if (part.vital) cond = Math.max(70, cond);
      rows.push({ key, part, missing, cond });
    }
    // Sandbox override (set by SandboxMode NPC manipulation): severed or
    // regenerated body parts. Applied on top of the deterministic roll.
    const bioOv = profile._bioOverride;
    if (bioOv) {
      for (const row of rows) {
        const o = bioOv[row.key];
        if (!o) continue;
        if (o.missing != null) row.missing = o.missing;
        if (o.cond    != null) row.cond    = o.cond;
      }
    }
    let condSum = 0, condCount = 0;
    for (const row of rows) { if (!row.missing) { condSum += row.cond; condCount++; } }
    const blood   = Math.round(80 + rnd() * 20);
    const overall = condCount ? Math.round(condSum / condCount) : 100;

    const condColor = v => v >= 85 ? '#5a9a2a' : v >= 65 ? '#b8860b' : '#d9534f';
    const vitalsHTML = `
      <div class="npc-bio-vitals">
        ${_meterRow('HP',  Math.min(100, Math.round(((profile.mhp ?? 0) / 2000) * 100)), '#d9534f')}
        ${_meterRow('MP',  Math.min(100, Math.round(((profile.mmp ?? 0) / 500)  * 100)), '#4070d0')}
        ${_meterRow(T.biologicsBlood, blood, '#a02020')}
        ${_meterRow(T.biologicsCondition, overall, condColor(overall))}
      </div>`;

    return `
      ${headerHTML}
      <div class="npc-bio-archetype">${_escapeHtml(T.biologicsArchetype)}: <b>${_escapeHtml(archetype)}</b></div>
      ${this._bloodTypeSectionHTML(T, window.BloodTypeService?.forNpc(npcName), npcName)}
      ${vitalsHTML}
      <div class="npc-routine-sub-hdr">${_escapeHtml(T.biologicsParts)}</div>
      <div class="npc-bio-grid">${_bioPartRowsHTML(rows, T, condColor)}</div>`;
  };

  // ============================================================================
  // Romance tab
  // ============================================================================
  // Display-only. Each NPC's romantic + sexual orientation, Kinsey placement,
  // genitals (mirroring the prosthetic reproduction DB) and preferred
  // relationship style are rolled deterministically from the world seed, so the
  // same NPC in the same world always reads the same. Current sentimental
  // status and partner links come live from NPCLifeSim.

  let _orientationDb  = null;
  let _relationshipDb = null;

  function _loadJsonSync(url) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send();
      if (xhr.status === 200 || xhr.status === 0) return JSON.parse(xhr.responseText);
    } catch (e) {
      console.warn('[NPCEmpathizeUI] failed to load', url, e);
    }
    return null;
  }

  function _orientationData() {
    if (_orientationDb === null) _orientationDb = _loadJsonSync('js/db/NPC/Orientations.json') || {};
    return _orientationDb;
  }
  function _relationshipData() {
    if (_relationshipDb === null) _relationshipDb = _loadJsonSync('js/db/NPC/Relationships.json') || {};
    return _relationshipDb;
  }

  // Weighted random pick, weight read from o[key]; falls back to a flat pick.
  function _weightedPick(list, rng, key) {
    if (!list || !list.length) return null;
    const total = list.reduce((s, o) => s + (Number(o[key]) || 0), 0);
    if (total <= 0) return rng.pick(list);
    let r = rng.next() * total;
    for (const o of list) { r -= (Number(o[key]) || 0); if (r < 0) return o; }
    return list[list.length - 1];
  }

  // Genital label set mirrors Health_ProstheticShop.getReproductionName (the
  // prosthetic reproduction DB): None / Testicles / Uterus / Oviparous /
  // Plant Spores / Mitosis.
  // Codes are the ones Health_ProstheticShop uses; the words come from
  // Empathize.genital.<code>, with -1 written "none" so it is a valid key.
  const _genitalName = (code) => {
    const key = 'Empathize.genital.' + (String(code) === '-1' ? 'none' : String(code));
    return T.has(key) ? T(key) : 'N/A';
  };

  function _npcGenitalCode(npcName, profile) {
    const Shared = window.NPCShared;
    const rng    = Shared ? new Shared.Rng(Shared.nameHash(npcName + '_genitals') ^ Shared.worldSeed()) : null;
    const rnd    = () => (rng ? rng.next() : 0.5);
    const gender = profile?.gender ?? 0;
    if (gender === 3) return rng ? rng.pick([4, 3, 2]) : 4;  // Cocoon: mitosis / spores / oviparous
    if (gender === 2) return rng ? rng.pick([0, 1, -1]) : 0; // Non-binary: varied
    if (gender === 1) return rnd() < 0.08 ? -1 : 1;          // Female-coded: uterus, occasionally none
    return rnd() < 0.08 ? -1 : 0;                            // Male-coded: testicles, occasionally none
  }

  // A bubbaromantic NPC (Orientations.json: 8% of the population, romantically
  // attached to Bubba Wilson and to nobody else) is the one person Bubba is
  // offered the Court option with, and the only move on it is turning them down.
  function _isBubbaromanticNpc(npcName, profile) {
    if (!npcName) return false;
    try {
      return _npcRomance(npcName, profile).romantic?.key === 'bubbaromantic';
    } catch (e) {
      return false;
    }
  }

  // Chance that a rolled orientation's romantic/sexual counterpart is forced to
  // match it (e.g. a homosexual NPC is likely to also be homoromantic), rather
  // than being rolled fully independently.
  const _ORIENT_MATCH_CHANCE = 0.6;

  function _npcRomance(npcName, profile) {
    const Shared  = window.NPCShared;
    const db      = _orientationData();
    const sexRng  = Shared ? new Shared.Rng(Shared.nameHash(npcName + '_sexorient') ^ Shared.worldSeed()) : null;
    const romRng  = Shared ? new Shared.Rng(Shared.nameHash(npcName + '_romorient') ^ Shared.worldSeed()) : null;
    const matchRng = Shared ? new Shared.Rng(Shared.nameHash(npcName + '_orientmatch') ^ Shared.worldSeed()) : null;
    let sexual   = sexRng ? _weightedPick(db.sexual   || [], sexRng, 'pct') : (db.sexual   || [])[0];
    let romantic = romRng ? _weightedPick(db.romantic || [], romRng, 'pct') : (db.romantic || [])[0];
    // Correlate the two rolls: aromantic/asexual NPCs are excluded (they don't
    // attach to anyone, so there's nothing to match), otherwise there's a
    // _ORIENT_MATCH_CHANCE chance the rarer (lower pct) of the two picks wins
    // and the other is overwritten with its thematic counterpart, when one
    // exists (e.g. homosexual <-> homoromantic, digisexual <-> botromantic).
    const canMatch = sexual && romantic && sexual.key !== 'asexual' && romantic.key !== 'aromantic';
    if (canMatch && matchRng && matchRng.next() < _ORIENT_MATCH_CHANCE) {
      if ((Number(sexual.pct) || 0) <= (Number(romantic.pct) || 0)) {
        const corres = (db.romantic || []).find(o => o.key === sexual.correspondsTo);
        if (corres) romantic = corres;
      } else {
        const corres = (db.sexual || []).find(o => o.key === romantic.correspondsTo);
        if (corres) sexual = corres;
      }
    }
    // Sandbox override (set by SandboxMode NPC manipulation): a forced sexual /
    // romantic orientation by key. The Kinsey scale reads from the sexual entry,
    // so swapping it recalculates the Kinsey placement automatically.
    const ov = profile && profile._orientOverride;
    if (ov) {
      if (ov.sexualKey)   { const s = (db.sexual   || []).find(o => o.key === ov.sexualKey);   if (s) sexual   = s; }
      if (ov.romanticKey) { const r = (db.romantic || []).find(o => o.key === ov.romanticKey); if (r) romantic = r; }
    }
    return { sexual, romantic, genitalCode: _npcGenitalCode(npcName, profile) };
  }

  function _npcRelationshipStyle(npcName, partnered) {
    const Shared   = window.NPCShared;
    const styles   = _relationshipData().styles || [];
    const eligible = styles.filter(s => s.mode === 'any' || (partnered ? s.mode === 'partnered' : s.mode === 'solo'));
    if (!eligible.length) return null;
    const rng = Shared ? new Shared.Rng(Shared.nameHash(npcName + '_relstyle') ^ Shared.worldSeed()) : null;
    return rng ? _weightedPick(eligible, rng, 'weight') : eligible[0];
  }

  function _npcLink(name) {
    const arg = String(name ?? '').replace(/[\\'"<>]/g, '');
    return `<span class="npc-wiki-link" onmousedown="event.stopPropagation();window.NPCEmpathize.openByName('${arg}')">${_escapeHtml(name)}</span>`;
  }

  Scene_NPCEmpathize.prototype._buildRomanceTabHTML = function (T, profile, npcName) {
    const lang = ConfigManager.language === 'it' ? 'it' : 'en';
    const nm   = v => (lang === 'it' ? (v?.name_it || v?.name) : v?.name);
    const ds   = v => (lang === 'it' ? (v?.desc_it || v?.desc) : v?.desc);
    const headerHTML = `<div class="npc-sec-hdr">${T.romanceTitle}</div><hr class="npc-r-sep">`;

    if (!npcName) {
      return `${headerHTML}<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRomance)}</p>`;
    }

    const db = _orientationData();
    const { sexual, romantic, genitalCode } = _npcRomance(npcName, profile);

    const esotericTag = o => o?.esoteric
      ? ` <span class="npc-badge" style="font-size:0.8em;">${_escapeHtml(T.esotericTag)}</span>` : '';
    const pctLine = o => o
      ? `<span style="opacity:0.5;margin-left:6px;font-size:0.95em;">${o.pct}% ${_escapeHtml(T.ofPopulation)}</span>` : '';

    // ── Orientation ──
    let orientHTML = `<div class="npc-sec-hdr" style="margin-top:4px;">${T.orientationLbl}</div>`;
    if (romantic) {
      orientHTML += `<div class="npc-ident-row">${_iconSpan(84, 17)}<span style="opacity:0.65;">${_escapeHtml(T.romanticLbl)}:</span>&nbsp;<span><b>${_escapeHtml(nm(romantic))}</b></span>${pctLine(romantic)}${esotericTag(romantic)}</div>`;
      if (ds(romantic)) orientHTML += `<div class="npc-thought" style="margin-top:2px;">${_escapeHtml(ds(romantic))}</div>`;
    }
    if (sexual) {
      orientHTML += `<div class="npc-ident-row" style="margin-top:6px;">${_iconSpan(84, 17)}<span style="opacity:0.65;">${_escapeHtml(T.sexualLbl)}:</span>&nbsp;<span><b>${_escapeHtml(nm(sexual))}</b></span>${pctLine(sexual)}${esotericTag(sexual)}</div>`;
      if (ds(sexual)) orientHTML += `<div class="npc-thought" style="margin-top:2px;">${_escapeHtml(ds(sexual))}</div>`;
    }

    // ── Kinsey scale (only for orientations that map onto it) ──
    let kinseyHTML = '';
    const kv = (sexual && sexual.kinsey !== null && sexual.kinsey !== undefined) ? sexual.kinsey : null;
    if (kv !== null) {
      const scale = db.kinseyScale || {};
      const desc  = scale[String(kv)] || '';
      kinseyHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.kinseyLbl}</div>` +
        `<div class="npc-ident-row">${_iconSpan(87, 17)}<span><b>${_escapeHtml('Kinsey ' + kv)}</b></span><span style="opacity:0.55;">&nbsp;, ${_escapeHtml(desc)}</span></div>`;
      if (kv !== 'X') {
        let dots = '';
        for (let i = 0; i <= 6; i++) {
          const on = i === kv;
          dots += `<span title="${i}" style="display:inline-block;width:14px;height:14px;margin-right:3px;border-radius:50%;border:1px solid #7a5a2a;background:${on ? '#8b1e3f' : 'rgba(120,90,42,0.15)'};"></span>`;
        }
        kinseyHTML += `<div style="margin:4px 0 0 2px;display:flex;align-items:center;">${dots}</div>`;
      }
    }

    // ── Anatomy: genitals (from the prosthetic reproduction DB) ──
    const genName = _genitalName(genitalCode);
    const anatomyHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.anatomyLbl}</div>` +
      `<div class="npc-ident-row">${_iconSpan(120, 17)}<span style="opacity:0.65;">${_escapeHtml(T.genitalsLbl)}:</span>&nbsp;<span><b>${_escapeHtml(genName)}</b></span></div>`;

    // ── Sentimental status (live, from NPCLifeSim) ──
    let statusHTML = `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.sentimentalLbl}</div>`;
    let partnered = false, record = null;
    if (window.NPCLifeSim) {
      window.NPCLifeSim.ensureLifeRecord?.(npcName, profile?._homeGroupName);
      record = window.NPCLifeSim.getRecord?.(npcName) ?? null;
    }
    if (record) {
      const partner    = record.partner;
      partnered        = !!partner;
      const partnerHTML = partner ? (partner.external ? `<b>${_escapeHtml(partner.name)}</b>` : _npcLink(partner.name)) : '';
      const status = record.maritalStatus || 'single';
      let line;
      if      (status === 'married'  && partner) line = `${_escapeHtml(T.marriedTo)} ${partnerHTML}`;
      else if (status === 'dating'   && partner) line = `${_escapeHtml(T.datingLbl)} ${partnerHTML}`;
      else if (status === 'married')             line = _escapeHtml(T.stMarried);
      else if (status === 'widowed')             line = _escapeHtml(T.stWidowed);
      else if (status === 'divorced')            line = _escapeHtml(T.stDivorced);
      else                                       line = _escapeHtml(T.stSingle);
      statusHTML += `<div class="npc-ident-row">${_iconSpan(84, 17)}<span>${line}</span></div>`;
      if (record.timesMarried > 1) {
        statusHTML += `<div style="font-size:1.0rem;opacity:0.6;margin:2px 0 0 24px;">${_escapeHtml((T.timesMarried).replace('{n}', record.timesMarried))}</div>`;
      }
      const exes = (record.exPartners || []).filter(Boolean);
      if (exes.length) {
        const exList = exes.slice(-4).map(e => {
          const nmHtml = e.external ? _escapeHtml(e.name) : _npcLink(e.name);
          const out    = e.outcome ? ` <span style="opacity:0.5;">(${_escapeHtml(e.outcome)})</span>` : '';
          return `${nmHtml}${out}`;
        }).join(', ');
        statusHTML += `<div class="npc-ident-row" style="margin-top:4px;"><span style="opacity:0.65;">${_escapeHtml(T.exPartnersLbl)}:</span>&nbsp;<span>${exList}</span></div>`;
      }
    } else {
      statusHTML += `<div class="npc-ident-row">${_iconSpan(84, 17)}<span>${_escapeHtml(T.stSingle)}</span></div>`;
    }

    // ── Relationship style (deterministic, conditioned on being partnered) ──
    let styleHTML = '';
    const style = _npcRelationshipStyle(npcName, partnered);
    if (style) {
      styleHTML = `<div class="npc-ident-row" style="margin-top:6px;">${_iconSpan(83, 17)}<span style="opacity:0.65;">${_escapeHtml(T.relStyleLbl)}:</span>&nbsp;<span><b>${_escapeHtml(nm(style))}</b></span></div>`;
      if (ds(style)) styleHTML += `<div class="npc-thought" style="margin-top:2px;">${_escapeHtml(ds(style))}</div>`;
    }

    return `${headerHTML}${orientHTML}${kinseyHTML}${anatomyHTML}${statusHTML}${styleHTML}`;
  };

  // ============================================================================
  // Romance actions (Court submenu in the chat tab)
  // ============================================================================
  // High-risk, high-reward counterparts to the Socialize moves: each one shows
  // its own success chance and swings the focused party member's reputation far
  // harder than a compliment ever could. Courting never starts an actual
  // relationship with the player, it only moves reputation.
  //
  // A move is impossible (0%, an outright rejection) when the NPC is in an
  // exclusive partnership, is aromantic, is asexual and the move is physical,
  // or when their orientation rules the focused party member out. Non-binary
  // and Cocoon people, on EITHER side of the exchange, satisfy every gendered
  // orientation. Lines and per-move numbers live in SocialLines.json.

  const _ROM_SAME_GENDER = new Set(['homosexual', 'homoromantic']);
  const _ROM_DIFF_GENDER = new Set(['heterosexual', 'heteroromantic']);
  const _ROM_SYNTHETIC   = new Set(['digisexual', 'botromantic']);
  const _ROM_BOTANIC     = new Set(['dendrosexual', 'dendroromantic']);
  // Partnered relationship styles that admit nobody else.
  const _ROM_EXCLUSIVE_STYLES = new Set([
    'monogamous', 'civil-union', 'arranged-marriage', 'long-distance', 'companionate',
  ]);
  // How open a relationship style leaves an NPC to being courted at all.
  const _ROM_STYLE_MOD = {
    'polyamorous': 10, 'portland-polycule': 12, 'open-relationship': 8, 'throuple': 8,
    'friends-with-benefits': 10, 'situationship': 8, 'serial-monogamy': 5,
    'queerplatonic': -8, 'single-content': -14,
  };
  // Gender codes (ActorCharacterFields / NPC profiles): 0 Male, 1 Female,
  // 2 Non-binary, 3 Cocoon. The last two are compatible with everyone.
  const _ROM_GENDER_FLUID = g => g === 2 || g === 3;
  // Reproduction type per player slot (ClassSelector); 3 = plant spores.
  const _ROM_REPRO_VAR = { 1: 87, 2: 115, 3: 116 };

  // ==========================================================================
  // Unwanted courting
  // ==========================================================================
  // Being turned down is part of courting, refusing to hear it is not. Every
  // move made on somebody whose opinion of the suitor is already negative is
  // counted, and once the count runs out the nEuroPolice hear about it: a
  // harassment charge with the bounty that carries, and no Court option with
  // that person for that party member until they think well of them again.
  // Winning them back round is the only thing that lifts it.
  const _HARASS_STRIKES  = 3;   // unwanted moves tolerated before a complaint
  const _HARASS_CRIME    = 'harassment'; // i18n-ignore: PresetCrimes.json key
  const _HARASS_FALLBACK = 250; // bounty when PresetCrimes.json holds no entry

  function _harassRecord(profile, actorId) {
    if (!profile || actorId == null) return null;
    const book = (profile._courtHarassment ??= {});
    return (book[actorId] ??= { strikes: 0, filed: false, charges: 0 });
  }

  // Is Court off the table for this member right now? Reading it is also what
  // clears it, the moment the NPC's opinion of them turns positive again.
  function _courtRefused(profile, actorId, opinion) {
    const rec = profile?._courtHarassment?.[actorId];
    if (!rec?.filed) return false;
    if ((Number(opinion) || 0) > 0) { rec.filed = false; rec.strikes = 0; return false; }
    return true;
  }

  // Counts one unwanted move and files the complaint when the count runs out.
  // Returns the line to show the player when one was filed, null otherwise.
  function _recordUnwantedCourting(profile, actorId, npcName, actorName) {
    const rec = _harassRecord(profile, actorId);
    if (!rec || rec.filed) return null;
    rec.strikes = (rec.strikes || 0) + 1;
    if (rec.strikes < _HARASS_STRIKES) return null;

    rec.strikes = 0;
    rec.filed   = true;
    rec.charges = (rec.charges || 0) + 1;

    const CS     = window.CrimeSystem;
    const preset = CS?.getPresetCrime?.(_HARASS_CRIME);
    // A second complaint from the same person is taken more seriously.
    const asked  = Math.round((preset?.bounty || _HARASS_FALLBACK) * Math.min(4, rec.charges));
    const label  = CS?.presetCrimeName?.(_HARASS_CRIME) || preset?.name || _HARASS_CRIME;
    // What the charge actually costs is CrimeSystem's to decide (Streetwise
    // discount, sandbox self-pardon, Eris immunity), so read it rather than
    // quote the asking figure. Its own toast is a Scene_Map one and will not
    // show over this panel, which is why the line below says it here.
    const before = CS?.getTotalBounty?.() ?? 0;
    CS?.addCrime?.(label, asked, _HARASS_CRIME);
    const fine = (CS?.getTotalBounty?.() ?? 0) - before;

    (profile.eventLog ??= []).push({
      tag: 'romance_harassment', desc: `complaint filed (${fine})`, // i18n-ignore: event-log record id
      timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
    });
    if ((profile.factionIndex ?? -1) >= 0 && window.$gameFactions?.changeReputation)
      window.$gameFactions.changeReputation(profile.factionIndex, -5);

    return fine > 0
      ? T('Empathize.courtHarassmentFiled', { name: npcName, actor: actorName, fine: _euros(fine) })
      : T('Empathize.courtHarassmentFiledFree', { name: npcName, actor: actorName });
  }

  function _romanceDb()      { return _socialLines().romance || {}; }
  function _romanceActions() { return _romanceDb().actions || []; }
  function _romanceRejection(reason) { return (_romanceDb().rejection || {})[reason] || null; }

  function _actorIsSynthetic(actor) {
    const cls = actor?.currentClass?.()?.name || '';
    if (/cyborg|android|robot|machine|automaton/i.test(cls)) return true;
    return (actor?._selectedTraits || []).some(t => /cyber|robot|synthetic|machine/i.test(t?.name || ''));
  }
  function _actorIsBotanic(actor) {
    const v = _ROM_REPRO_VAR[actor?.actorId?.()];
    if (v && $gameVariables?.value(v) === 3) return true;
    return /plant|flora|dryad|treant|fungus/i.test(actor?.currentClass?.()?.name || '');
  }
  function _actorIsDwarf(actor) {
    if (/dwarf|dwarven/i.test(actor?.currentClass?.()?.name || '')) return true;
    return (actor?._selectedTraits || []).some(t => /dwarf|dwarven/i.test(t?.name || ''));
  }

  // Is this NPC currently in a partnership, and under which style?
  function _romanceStanding(npcName, profile) {
    let partnered = false;
    if (window.NPCLifeSim) {
      window.NPCLifeSim.ensureLifeRecord?.(npcName, profile?._homeGroupName);
      partnered = !!window.NPCLifeSim.getRecord?.(npcName)?.partner;
    }
    return { partnered, style: _npcRelationshipStyle(npcName, partnered) };
  }

  // Why (if at all) a romance move cannot land right now. Returns null when the
  // move is allowed, otherwise the key of a `rejection` pool in SocialLines.json.
  function _romanceBlockReason(profile, npcName, actor, def) {
    if (!actor || !npcName) return 'orientation';

    // Em (Switch 48). Bubba is spoken for by a goddess who bends probability at
    // her rivals, and the people who blame her for the death of the Father, or
    // simply want her gone, are not going to be courted by her either.
    if (_isEmActor?.(actor)) {
      const stanceKey = _emStanceKey?.(profile, npcName, $gameMap?.event(SceneManager._scene?._eventId));
      if (stanceKey === 'bubba')   return 'bubbaHimself';
      if (stanceKey === 'zealot')  return 'emZealot';
      if (stanceKey === 'annoyed') return 'emAnnoyed';
    }

    const { sexual, romantic } = _npcRomance(npcName, profile);
    const { partnered, style } = _romanceStanding(npcName, profile);

    // 1. Spoken for, exclusively.
    if (partnered && _ROM_EXCLUSIVE_STYLES.has(style?.key)) return 'taken';
    if (style?.key === 'aromantic-solo') return 'aromantic';

    // 2. No romantic pull at all, and no physical one for asexual NPCs.
    if (romantic?.key === 'aromantic') return 'aromantic';
    if (def.physical && sexual?.key === 'asexual') return 'asexual';

    // 3. The orientation governing this move: physical moves answer to the
    //    sexual orientation, everything else to the romantic one, each falling
    //    back to the other when the governing one opts out entirely.
    const gov = def.physical
      ? (sexual   && sexual.key   !== 'asexual'   ? sexual   : romantic)
      : (romantic && romantic.key !== 'aromantic' ? romantic : sexual);
    if (!gov) return null;

    // 4. Orientations that want something the party simply is not.
    if (gov.key === 'bubbaromantic' && !/bubba/i.test(actor.name() || '')) return 'bubba';
    if (_ROM_SYNTHETIC.has(gov.key) && !_actorIsSynthetic(actor))          return 'synthetic';
    if (_ROM_BOTANIC.has(gov.key)   && !_actorIsBotanic(actor))            return 'botanic';
    if (gov.key === 'nanosexual'    && !_actorIsDwarf(actor))              return 'dwarf';

    // 5. Gender, unless either side is Non-binary or Cocoon.
    const ag = actor.gender ? actor.gender() : 0;
    const ng = profile?.gender ?? 0;
    if (_ROM_GENDER_FLUID(ag) || _ROM_GENDER_FLUID(ng)) return null;
    if (_ROM_SAME_GENDER.has(gov.key) && ag !== ng) return 'orientation';
    if (_ROM_DIFF_GENDER.has(gov.key) && ag === ng) return 'orientation';
    return null;
  }

  // Courting the same person over and over wears thin fast; repeating one
  // particular move wears thinnest of all.
  function _romanceFatigue(profile, id) {
    const nowMin = $gameVariables?.value(114) ?? 0;
    const cutoff = nowMin - 2 * 1440;
    let same = 0, any = 0;
    for (const e of profile?.eventLog || []) {
      if (typeof e?.tag !== 'string' || !e.tag.startsWith('romance_')) continue;
      if ((e.gameMin ?? 0) < cutoff) continue;
      any++;
      if (e.tag === 'romance_' + id) same++;
    }
    return any + same * 2;
  }

  function _romanceCharm(actor) {
    if (!actor) return 0;
    const luk = actor.luk ?? 0;
    return Math.max(-10, Math.min(14, Math.round((luk - 20) / 5) + Math.floor((actor.level ?? 1) / 8)));
  }

  // Odds the move lands. Disposition dominates (trait compatibility and the
  // hygiene of both parties already ride inside the effective opinion), the
  // boldness tier is the main brake.
  const _ROM_TIER_PENALTY = 11;
  // Courting happens at arm's length or closer, so the hygiene reading that
  // already dulled the disposition is felt a second time here, at full weight
  // in percentage points. Traits still rule it: a Feral or Lycanthrope suitor
  // never notices, a Germaphobe cannot get past it. See _hygienePenalty
  // (NPCEmpathize.js) for the whole table.
  const _ROM_HYGIENE_WEIGHT = 1;
  function _romanceChance(profile, npcName, actor, def, opinion) {
    const { sexual, romantic } = _npcRomance(npcName, profile);
    const { style }            = _romanceStanding(npcName, profile);

    let c = 46
      + (Number(opinion) || 0) * 0.42
      + _romanceCharm(actor)
      + Math.round((_personalitySocialMult(profile, 'positive') - 1) * 25)
      + (_ROM_STYLE_MOD[style?.key] || 0)
      + _hygienePenalty(profile, actor, _ROM_HYGIENE_WEIGHT)
      - (Number(def.tier) || 1) * _ROM_TIER_PENALTY
      - _romanceFatigue(profile, def.id) * 5;

    // Demi NPCs need the bond before anything else can grow on it.
    if ((sexual?.key === 'demisexual' || romantic?.key === 'demiromantic') && opinion < 45) c -= 25;
    // A sapioromantic is courted with wit rather than looks.
    if (romantic?.key === 'sapioromantic') c += Math.max(-8, Math.min(12, Math.round(((actor?.mat ?? 0) - 20) / 4)));
    // Nobody warms to a stranger they already dislike.
    if (opinion <= -60) c -= 15;

    return Math.round(Math.max(3, Math.min(95, c)));
  }

  // The Court submenu's rows, one per move, each carrying its own odds and the
  // reason it cannot land when it cannot.
  const BUBBA_DECLINE_ID = 'bubbaDecline';

  Scene_NPCEmpathize.prototype._romanceOptions = function () {
    const lang    = ConfigManager.language === 'it' ? 'it' : 'en';
    const npcName = _getNPCName(this._eventId) || this._npcName;
    const profile = _getProfile(npcName);
    const actor   = this._focusActor();
    const opinion = this._focusOpinion(profile);

    // Bubba (Switch 49) has exactly one move, and it is not a move: the person
    // in front of him has loved him from a distance for years, and he says no.
    if (_isBubbaActor?.(actor) && _isBubbaromanticNpc(npcName, profile)) {
      const rom = _bubbaDb?.()?.romantic || {};
      return [{
        id:     BUBBA_DECLINE_ID,
        label:  rom.label || T('Empathize.declineAdvances'),
        reason: null,
        reasonLabel: '',
        chance: 100,
        gain:   0,
        loss:   Number(rom.delta) || -70,
      }];
    }

    return _romanceActions().map(def => {
      const reason = _romanceBlockReason(profile, npcName, actor, def);
      const pool   = reason ? _romanceRejection(reason) : null;
      return {
        id:     def.id,
        label:  def.label || def.id,
        reason,
        reasonLabel: pool ? (pool.reasonLabel || '') : '',
        chance: reason ? 0 : _romanceChance(profile, npcName, actor, def, opinion),
        gain:   Number(def.successDelta) || 0,
        loss:   Number(def.failDelta)    || 0,
      };
    });
  };

  // Says out loud what the odds below have already been docked for, so a run of
  // suddenly hopeless numbers reads as a bath the party skipped rather than as
  // the NPC turning cold. Only the side that is actually noticed is mentioned,
  // and a suitor whose traits ignore the smell is told nothing.
  const _ROM_HYGIENE_HINT_AT = -4; // opinion points, below which it is worth saying
  Scene_NPCEmpathize.prototype._buildRomanceHygieneHint = function () {
    const npcName = _getNPCName(this._eventId) || this._npcName;
    const profile = _getProfile(npcName);
    const actor   = this._focusActor();
    if (!profile || !actor) return '';
    const { theirs, mine } = _hygieneReadout(profile, actor);
    const lines = [];
    if (theirs <= _ROM_HYGIENE_HINT_AT) lines.push(T('Empathize.hygieneCourtSelf', { name: npcName }));
    if (mine   <= _ROM_HYGIENE_HINT_AT) lines.push(T('Empathize.hygieneCourtNpc',  { name: npcName }));
    if (!lines.length) return '';
    return `<div style="opacity:0.7;font-style:italic;font-size:0.95em;margin:2px 0 4px;">` +
      lines.map(l => _escapeHtml(l)).join('<br>') + `</div>`;
  };

  Scene_NPCEmpathize.prototype._buildInlineRomanceActions = function (T) {
    let html = this._buildRomanceHygieneHint();
    html += this._romanceOptions().map(o => {
      const open = `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._romanceInteract('${o.id}')">`;
      // Bubba's single row: no odds to weigh, only the damage it will do.
      if (o.id === BUBBA_DECLINE_ID) {
        return `${open}<span style="color:#8a2f5a;">${_escapeHtml(o.label)}</span>` +
          `<span style="color:#b01010;margin-left:6px;">${o.loss}♥</span></div>`;
      }
      if (o.reason) {
        return `${open}<span style="color:#8a2f5a;opacity:0.7;">${_escapeHtml(o.label)}</span>` +
          `<span style="color:#b01010;margin-left:6px;">0%</span>` +
          (o.reasonLabel ? `<span style="opacity:0.55;margin-left:4px;font-size:0.95em;">${_escapeHtml(o.reasonLabel)}</span>` : '') +
          `</div>`;
      }
      const cc = o.chance >= 60 ? '#2a6e4a' : o.chance >= 30 ? '#b8860b' : '#c02020';
      return `${open}<span style="color:#8a2f5a;">${_escapeHtml(o.label)}</span>` +
        `<span style="color:#2a6e4a;margin-left:6px;">+${o.gain}♥</span>` +
        `<span style="color:#b01010;margin-left:3px;">${o.loss}♥</span>` +
        `<span style="color:${cc};margin-left:6px;font-weight:bold;">${o.chance}%</span></div>`;
    }).join('');
    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  // Bubba turning down somebody who has loved him since the coaches started
  // running: their confession, his modest refusal, and what it costs him with
  // them for good. There is no roll, it always lands and it always hurts.
  Scene_NPCEmpathize.prototype._bubbaDecline = function () {
    const rom     = _bubbaDb?.()?.romantic || {};
    const npcName = _getNPCName(this._eventId) || this._npcName;
    const profile = _getProfile(npcName);
    const actor   = this._focusActor();
    const actorId = actor && actor.actorId();
    const fill    = s => String(s || '').replace(/\{name\}/g, npcName);
    const delta   = Number(rom.delta) || -70;

    if (profile && actorId != null) {
      _addNpcOpinion(profile, actorId, delta);
      (profile.eventLog ??= []).push({
        tag: 'romance_' + BUBBA_DECLINE_ID, desc: `turned down (${delta})`, // i18n-ignore: event-log record id
        timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
      });
      if ((profile.factionIndex ?? -1) >= 0 && window.$gameFactions?.changeReputation)
        window.$gameFactions.changeReputation(profile.factionIndex, Math.round(delta / 8));
    }

    SoundManager.playBuzzer();
    this._romanceMode = false;
    this._activeTab   = 'chat';
    this._chatHistory.push({ role: 'npc',    text: fill(_rand(rom.confession)) });
    this._chatHistory.push({ role: 'player', text: fill(_rand(rom.decline)) });
    this._isTyping    = true;
    this._joinMessage = { type: 'reject', text: `${delta} ♥ (${actor ? actor.name() : ''})` };
    this._render();
    this._scrollChatToBottom();
    setTimeout(() => {
      this._isTyping = false;
      this._chatHistory.push({ role: 'npc', text: fill(_rand(rom.response)) });
      if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
      this._render();
      this._scrollChatToBottom();
    }, 350);
  };

  Scene_NPCEmpathize.prototype._romanceInteract = function (id) {
    if (id === BUBBA_DECLINE_ID) return this._bubbaDecline();
    const def = _romanceActions().find(a => a.id === id);
    if (!def) return;
    const npcName = _getNPCName(this._eventId) || this._npcName;
    const profile = _getProfile(npcName);
    const actor   = this._focusActor();
    const actorId = actor && actor.actorId();
    const fill    = s => String(s || '').replace(/\{name\}/g, npcName);

    // A complaint already on file takes Court off the menu, so this is only
    // reachable through a stale panel: refuse it rather than act on it.
    const priorOpinion = this._focusOpinion(profile);
    if (_courtRefused(profile, actorId, priorOpinion)) { SoundManager.playBuzzer(); return; }

    const reason = _romanceBlockReason(profile, npcName, actor, def);
    const playerLine = fill(_rand(def.player));
    let npcLine, delta, landed = false;

    if (reason) {
      const pool = _romanceRejection(reason) || {};
      npcLine = fill(_rand(pool.lines));
      delta   = Number(pool.delta) || 0;
    } else {
      const chance = _romanceChance(profile, npcName, actor, def, priorOpinion);
      landed  = Math.random() * 100 < chance;
      npcLine = fill(_rand(landed ? def.responseGood : def.responseBad));
      delta   = landed
        ? Math.max(1,  Math.round(def.successDelta * _personalitySocialMult(profile, 'positive')))
        : Math.min(-1, Math.round(def.failDelta    * _personalitySocialMult(profile, 'negative')));
    }

    // Reputation lands on the focused member only, exactly like a social move.
    // Nothing is written to the NPCLifeSim partnership record: courting does
    // not (yet) start a relationship with the player, however well it goes.
    if (profile && actorId != null) {
      _addNpcOpinion(profile, actorId, delta);
      (profile.eventLog ??= []).push({
        tag: 'romance_' + id, desc: `${id} (${delta >= 0 ? '+' : ''}${delta})`,
        timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
      });
      if ((profile.factionIndex ?? -1) >= 0 && delta !== 0 && window.$gameFactions?.changeReputation)
        window.$gameFactions.changeReputation(profile.factionIndex, Math.round(delta / 8));
    }

    // Pressing a suit on somebody who already dislikes the suitor is pestering
    // rather than flirting, and the third time it is a matter for the law.
    const charge = priorOpinion < 0
      ? _recordUnwantedCourting(profile, actorId, npcName, actor ? actor.name() : '')
      : null;

    if (landed) SoundManager.playOk(); else SoundManager.playBuzzer();

    // A suit pressed, and how it landed, in the party's own diary (Diary.js).
    if (window.Diary && actor) {
      window.Diary.onRomance(actor.name(), npcName, id, landed);
    }

    this._romanceMode = false;
    this._activeTab   = 'chat';
    this._chatHistory.push({ role: 'player', text: playerLine });
    this._isTyping    = true;
    const deltaText   = `${delta >= 0 ? '+' : ''}${delta} ♥ (${actor ? actor.name() : ''})`;
    this._joinMessage = charge
      ? { type: 'reject', text: `${charge} ${deltaText}` }
      : { type: delta >= 0 ? 'accept' : 'reject', text: deltaText };
    this._render();
    this._scrollChatToBottom();
    setTimeout(() => {
      this._isTyping = false;
      this._chatHistory.push({ role: 'npc', text: npcLine });
      if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
      this._render();
      this._scrollChatToBottom();
    }, 350);
  };

  // ============================================================================
  // Ask Directions (chat submenu)
  // ============================================================================
  // The NPC points the player at anything worth walking to on the current map:
  // the door / teleport events, and everyone else standing on it. One tile
  // reads as one metre, and the bearing is taken from the PLAYER rather than
  // from the speaker, since it is the player who has to walk it.

  const _DIR_LABEL_KEYS = ['dirN', 'dirNE', 'dirE', 'dirSE', 'dirS', 'dirSW', 'dirW', 'dirNW'];
  const _DIR_FALLBACK   = ['north', 'north-east', 'east', 'south-east',
                           'south', 'south-west', 'west', 'north-west'];
  // Event names that count as a way out of the map.
  const _DIR_DOOR_RE = /^(doors?|teleport|transfer)\b/i;
  // Notes that mark an event as a person (NPCSystem's ai/local tags, or the
  // <NPC-classId> tag the society system stamps on citizens).
  const _DIR_PERSON_RE = /\bai\b|\blocal\b|NPC-\d+/i;
  const _DIR_MAX_PER_GROUP = 10;
  const _DIR_HERE_RADIUS   = 2; // closer than this and a bearing is meaningless

  // Exit event names are written for the map editor, not for the player:
  // "Door (1416 - Tutorial Inn)", "Transfer (566 Training center)",
  // "Teleport - Roma". Only the place on the far side is worth saying out loud,
  // so the map id, the plumbing word and the punctuation between them all go.
  function _destinationName(rawName) {
    // A place that is a travel destination is said the way its Destinations.json
    // entry names it; anything else is said as the event wrote it.
    const spoken = (s) => window.WorkSystem?.destinationName
      ? window.WorkSystem.destinationName(s) : s;
    const name = String(rawName || '').trim();
    const paren = name.match(/\(([^)]*)\)/);
    if (paren) {
      const inner = paren[1].replace(/^\s*\d+\s*[-–—:.]?\s*/, '').trim();
      if (inner) return spoken(inner);
    }
    // "Teleport - Roma", "Door: Cellar", "Transfer 2 - Docks"
    const dashed = name.match(/^[A-Za-z]+\s*\d*\s*[-–—:]\s*(.+)$/);
    if (dashed && dashed[1].trim()) return spoken(dashed[1].trim());
    return spoken(name);
  }

  // Four doors onto the same Grove are one place as far as the player is
  // concerned, so entries are folded by the name they resolve to (case and
  // spacing ignored) rather than being numbered apart.
  function _dirGroupKey(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // 0 = north, then clockwise in 45 degree sectors. Map y grows southward.
  function _compassLabel(T, dx, dy) {
    const deg = Math.atan2(-dy, dx) * 180 / Math.PI; // 0 = east, 90 = north
    const i   = Math.round(((450 - deg) % 360) / 45) % 8;
    return T[_DIR_LABEL_KEYS[i]] || _DIR_FALLBACK[i];
  }

  // Everything on the map the speaker could sensibly point at, split into the
  // two groups the submenu shows and sorted nearest-first.
  Scene_NPCEmpathize.prototype._collectDirectionTargets = function () {
    const px = $gamePlayer?.x ?? 0;
    const py = $gamePlayer?.y ?? 0;
    const speaker = this._eventId;
    const doors = [], people = [];
    for (const ev of ($gameMap?.events?.() || [])) {
      if (!ev || ev._erased || ev.eventId() === speaker) continue;
      const data = ev.event?.();
      const name = (data?.name || '').trim();
      if (!name || /^Player\d+$/.test(name)) continue;
      const dx = ev.x - px, dy = ev.y - py;
      const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
      // A door is listed (and asked about) by where it leads, never by the
      // editor name; people already carry the name the player knows them by.
      // A Note on the event itself ("Dirty Inn") overrides the parsed name,
      // matching MapLevelDisplay's door-name override on the arrival banner.
      if (_DIR_DOOR_RE.test(name)) {
        const noteOverride = (data?.note || '').trim();
        doors.push({ name: noteOverride || _destinationName(name), dx, dy, dist });
      }
      else if (_DIR_PERSON_RE.test(data?.note || '') || _getProfile(name)) people.push({ name, dx, dy, dist });
    }
    // Nearest first, then folded by name: every way into the same place is one
    // row, standing for the nearest of them, carrying how many there are.
    const trim = list => {
      list.sort((a, b) => a.dist - b.dist);
      const byKey = {};
      const groups = [];
      for (const e of list) {
        const key = _dirGroupKey(e.name);
        if (byKey[key]) { byKey[key].count++; continue; }
        e.count = 1;
        e.label = e.name;
        byKey[key] = e;
        groups.push(e);
      }
      return groups.slice(0, _DIR_MAX_PER_GROUP);
    };
    return { doors: trim(doors), people: trim(people) };
  };

  Scene_NPCEmpathize.prototype._buildInlineDirectionActions = function (T) {
    const { doors, people } = this._collectDirectionTargets();
    // Flattened once here and kept on the scene, so the click handler answers
    // about exactly the row that was drawn.
    this._directionList = [...doors, ...people];

    const hdr = text =>
      `<div style="flex-basis:100%;opacity:0.6;font-size:0.95rem;margin:2px 0 -2px;">${_escapeHtml(text)}</div>`;
    const row = (entry, i) =>
      `<div class="npc-chat-action-btn" onmousedown="event.stopPropagation();SceneManager._scene._answerDirections(${i})">` +
      `<span>${_escapeHtml(entry.label)}</span>` +
      (entry.count > 1
        ? `<span style="opacity:0.55;margin-left:6px;">${_escapeHtml(T('Empathize.directionsCount', { count: String(entry.count) }))}</span>`
        : '') +
      `<span style="opacity:0.55;margin-left:6px;">${entry.dist} m</span></div>`;

    let html = '';
    if (!this._directionList.length) {
      html = `<span style="opacity:0.6;font-style:italic;padding:4px 8px;font-size:1.08rem;">${_escapeHtml(T.directionsNone)}</span>`;
    } else {
      if (doors.length) {
        html += hdr(T.directionsDoors);
        html += doors.map((e, i) => row(e, i)).join('');
      }
      if (people.length) {
        html += hdr(T.directionsPeople);
        html += people.map((e, i) => row(e, doors.length + i)).join('');
      }
    }
    html += `<div class="npc-chat-action-btn" style="opacity:0.65;" onmousedown="event.stopPropagation();SceneManager._scene._cancelSubMode()">${_escapeHtml(T.cancel)}</div>`;
    return html;
  };

  Scene_NPCEmpathize.prototype._answerDirections = function (index) {
    const entry = (this._directionList || [])[index];
    if (!entry) return;
    const T = _getT();

    const ask = T('Empathize.directionsIntro', { target: entry.label });
    // A folded row stands for several of the same place, so the answer says
    // which one it is pointing at.
    const key = entry.dist <= _DIR_HERE_RADIUS ? 'directionsHere'
      : (entry.count > 1 ? 'directionsAnswerNearest' : 'directionsAnswer');
    const answer = T('Empathize.' + key, {
      target: entry.label,
      count: String(entry.count || 1),
      dist: String(entry.dist),
      dir: _compassLabel(T, entry.dx, entry.dy),
    });

    this._directionsMode = false;
    this._activeTab      = 'chat';
    this._joinMessage    = null;
    this._chatHistory.push({ role: 'player', text: ask });
    this._isTyping       = true;
    this._render();
    this._scrollChatToBottom();
    setTimeout(() => {
      this._isTyping = false;
      this._chatHistory.push({ role: 'npc', text: answer });
      if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
      this._render();
      this._scrollChatToBottom();
    }, 350);
  };

  // ============================================================================
  // Life history tab
  // ============================================================================

  // Em's history is the one the world already wrote for her (docs/Lore.odt), and
  // the only party member's past the life simulator can never produce: the
  // Solomonic Ritual took it. Printed above whatever has since been recorded,
  // with the procedural paragraph for the branch THIS Em arrived from last.
  function _buildEmBackstoryHTML(T, actorObj) {
    const CP = window.CharacterPresets;
    if (!actorObj || !CP?.getEmBackstory || !CP.isEmPlaythrough?.()) return '';
    if (actorObj.name() !== 'Em') return '';
    const story = CP.getEmBackstory(ConfigManager.language);
    if (!story || !story.paragraphs?.length) return '';
    const body = story.paragraphs
      .map(p => `<p style="margin:0 0 8px 0;">${_linkify(p)}</p>`)
      .join('');
    const branch = story.branch
      ? `<div class="npc-routine-sub-hdr">${_escapeHtml(T.emBranchHdr)}</div>
         <div class="npc-backstory-text">${_linkify(story.branch)}</div>`
      : '';
    return `<div class="npc-backstory-text">${body}</div>${branch}`;
  }

  Scene_NPCEmpathize.prototype._buildLifeHistoryHTML = function (T, profile, npcName) {
    const headerHTML = `
      <div class="npc-sec-hdr" style="margin-bottom:6px;">${T.lifeHistoryTitle}</div>
      <hr class="npc-r-sep">`;

    const actorObj = this._actorId != null ? $gameActors.actor(this._actorId) : null;
    const emHTML = _buildEmBackstoryHTML(T, actorObj);

    const log = profile?.eventLog ?? [];
    if (!log.length) {
      return emHTML
        ? `${headerHTML}${emHTML}`
        : `${headerHTML}<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noLifeHistory)}</p>`;
    }

    const narrative = window.NPCSim?.StoryLogger?.generateNarrative?.(npcName)
      ?? T('Empathize.noRecordedHistory', { name: npcName });

    const fmtTimestamp = gameMin => {
      const day  = Math.floor(gameMin / 1440);
      const hour = Math.floor((gameMin % 1440) / 60);
      return `D${day} ${String(hour).padStart(2, '0')}:00`;
    };

    const rows = log.map(e => `
      <div class="npc-life-row">
        <span class="npc-life-time">${fmtTimestamp(e.gameMin ?? e.minute ?? 0)}</span>
        <span>${_escapeHtml(_goldTextToEuros(window.NPCSim?.StoryLogger?.textOf?.(e) ?? e.desc ?? ''))}</span>
      </div>`).join('');

    return `
      ${headerHTML}
      ${emHTML}
      <div class="npc-backstory-text">${_escapeHtml(_goldTextToEuros(narrative))}</div>
      ${_buildQuestHistoryHTML(T, npcName)}
      <div class="npc-routine-sub-hdr">${T.lifeHistoryTimeline}</div>
      ${rows}`;
  };

  // Contracts this person has posted and the party has taken, honoured or not.
  // ProceduralQuestSystem records them per NPC name; a person the party has never
  // worked for contributes nothing to the page.
  function _buildQuestHistoryHTML(T, npcName) {
    const api = window.ProceduralQuests;
    if (!api || typeof api.npcQuestHistory !== 'function' || !npcName) return '';
    let log = [];
    try { log = api.npcQuestHistory(npcName) || []; } catch (e) { return ''; }
    if (!log.length) return '';

    const isIt = ConfigManager.language === 'it';
    const fmt = gameMin => {
      const day = Math.floor((gameMin || 0) / 1440);
      const hour = Math.floor(((gameMin || 0) % 1440) / 60);
      return `D${day} ${String(hour).padStart(2, '0')}:00`;
    };
    const done = log.filter(e => e.outcome === 'done').length;
    const failed = log.length - done;

    const rows = log.slice().reverse().map(e => {
      const ok = e.outcome === 'done';
      const badge = ok ? (isIt ? 'ONORATO' : 'HONOURED') : (isIt ? 'FALLITO' : 'FAILED');
      const color = ok ? 'var(--border-success, #3e6b2f)' : 'var(--accent-red-3, #8b263e)';
      return `
        <div class="npc-life-row">
          <span class="npc-life-time">${fmt(e.minute)}</span>
          <span><strong style="color:${color};">${badge}</strong> ${_escapeHtml(String(e.title || ''))}</span>
        </div>`;
    }).join('');

    const summary = T('Empathize.contractsSummary', { done: done, failed: failed });

    return `
      <div class="npc-routine-sub-hdr">${_escapeHtml(T('Empathize.contractsWithYou'))}</div>
      <div class="npc-thought" style="font-style:normal;">${_escapeHtml(summary)}</div>
      ${rows}`;
  }

  // ============================================================================
  // WIKI, entity profile rendering (nations, hyperpowers, leaders, artifacts,
  // factions). The chat tab does not exist here; tabs are entity-specific and
  // every recognized name in the content is a hyperlink to its own profile.
  // ============================================================================

  const ENTITY_TAB_SETS = {
    nation:   T => [
      { id: 'overview',   label: T.overview },
      { id: 'govHistory', label: T.governmentHistory },
      { id: 'elections',  label: T.electionRecords },
      { id: 'events',     label: T.eventsTab },
    ],
    power:    T => [
      { id: 'overview',  label: T.overview },
      { id: 'leaders',   label: T.leadersTab },
      { id: 'elections', label: T.electionRecords },
      { id: 'events',    label: T.eventsTab },
    ],
    leader:   T => [
      { id: 'overview', label: T.overview },
      { id: 'events',   label: T.eventsTab },
    ],
    artifact: T => [
      { id: 'overview', label: T.overview },
      { id: 'holders',  label: T.holdersTab },
    ],
    faction:  T => [
      { id: 'overview', label: T.overview },
      { id: 'members',  label: T.membersTab },
      { id: 'events',   label: T.eventsTab },
    ],
  };

  Scene_NPCEmpathize.prototype._renderEntityInner = function () {
    const T    = _getT();
    const ent  = this._entity;
    const view = Wiki.get(ent.type, ent.id);

    const tabs = view ? (ENTITY_TAB_SETS[view.type]?.(T) ?? [{ id: 'overview', label: T.overview }])
                      : [{ id: 'overview', label: T.overview }];
    tabs.push({ id: 'wiki', label: T.wikiTab });
    this._entityTabs = tabs.map(t => t.id);
    if (!this._entityTabs.includes(this._activeTab)) this._activeTab = this._entityTabs[0];

    if (this._tabBarEl) {
      const backHTML = Scene_NPCEmpathize._returnStack.length
        ? `<div class="npc-tab npc-wiki-back" onmousedown="event.stopPropagation();SceneManager._scene._leave()">← ${_escapeHtml(T.back)}</div>`
        : `<div class="npc-tab npc-wiki-back" onmousedown="event.stopPropagation();SceneManager._scene._leave(true)">✕ ${_escapeHtml(T.close)}</div>`;
      this._tabBarEl.innerHTML = backHTML + tabs.map(tab => `
        <div class="npc-tab${this._activeTab === tab.id ? ' active' : ''}"
             onmousedown="event.stopPropagation();SceneManager._scene._setTab('${tab.id}')">${_escapeHtml(tab.label)}</div>`).join('');
      this._tabBarEl.classList.toggle('npc-tab-bar--focused', this._activeArea === 'tabs');
    }

    if (!this._leftEl || !this._rightEl) return;
    this._rightEl.style.padding = '';
    this._rightEl.style.overflow = '';
    this._rightEl.style.display = '';
    this._rightEl.style.flexDirection = '';

    if (!view) {
      this._leftEl.innerHTML = `
        <div class="npc-entity-emblem">?</div>
        <div class="npc-entity-title">${_escapeHtml(String(ent.id))}</div>`;
      this._rightEl.innerHTML = this._activeTab === 'wiki'
        ? this._buildWikiTabHTML(T)
        : `<p style="opacity:0.6;font-style:italic;margin-top:14px;">${_escapeHtml(T.noRecords)}</p>`;
      return;
    }

    this._leftEl.innerHTML = this._buildEntityLeftHTML(view, T);

    let rightHTML;
    const tab = this._activeTab;
    if (tab === 'wiki') {
      rightHTML = this._buildWikiTabHTML(T);
    } else if (view.type === 'nation') {
      rightHTML = tab === 'govHistory' ? this._buildNationGovHistoryHTML(view, T)
        : tab === 'elections' ? this._buildElectionsHTML(view.power, T)
        : tab === 'events'    ? this._buildEntityEventsHTML(view, T)
        : this._buildNationOverviewHTML(view, T);
    } else if (view.type === 'power') {
      rightHTML = tab === 'leaders' ? this._buildPowerLeadersHTML(view, T)
        : tab === 'elections' ? this._buildElectionsHTML(view.live, T)
        : tab === 'events'    ? this._buildEntityEventsHTML(view, T)
        : this._buildPowerOverviewHTML(view, T);
    } else if (view.type === 'leader') {
      rightHTML = tab === 'events' ? this._buildEntityEventsHTML(view, T)
        : this._buildLeaderOverviewHTML(view, T);
    } else if (view.type === 'artifact') {
      rightHTML = tab === 'holders' ? this._buildArtifactHoldersHTML(view, T)
        : this._buildArtifactOverviewHTML(view, T);
    } else if (view.type === 'faction') {
      rightHTML = tab === 'members' ? this._buildFactionMembersHTML(view, T)
        : tab === 'events' ? this._buildEntityEventsHTML(view, T)
        : this._buildFactionOverviewHTML(view, T);
    } else if (view.type === 'party') {
      rightHTML = this._buildPartyOverviewHTML(view, T);
    } else if (view.type === 'ideology') {
      rightHTML = this._buildIdeologyOverviewHTML(view, T);
    } else {
      rightHTML = this._buildEntityEventsHTML(view, T);
    }
    this._rightEl.innerHTML = rightHTML;
  };

  // ── Left column: emblem + entity-specific side panel (replaces needs bars) ──

  Scene_NPCEmpathize.prototype._buildEntityLeftHTML = function (view, T) {
    const emblem = _emblemOf(view.type);
    const kickerMap = {
      nation: T.wikiNation, power: T.wikiHyperpower, leader: T.wikiLeader,
      artifact: T.wikiArtifact, faction: T.wikiFaction,
      party: T.wikiPoliticalParty, ideology: T.wikiIdeology,
    };
    const kicker = kickerMap[view.type] || emblem.kicker;
    const initials = String(view.name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('');

    let sideHTML = '';
    if (view.type === 'power') {
      const s = view.live?.state;
      if (s) {
        sideHTML =
          _meterRow(T.legitimacy, s.legitimacy, '#2a6e4a') +
          _meterRow(T.stability,  s.stability,  '#4070d0') +
          _meterRow(T.unrest,        s.unrest,     '#c02020') +
          _meterRow(T.economyLbl,   s.economyMood, '#b8860b') +
          `<div class="npc-ident-row" style="margin-top:5px;">${_iconSpan(314, 17)}<span>${T.treasury}: ${_euros(view.live.state.treasury)}</span></div>`;
      } else if (view.hist) {
        sideHTML =
          _statBarRow(T.militaryLbl,       Math.round(view.hist.military ?? 0),    400, '#c02020') +
          _statBarRow(T.economyLbl,         Math.round(view.hist.economy ?? 0),     400, '#b8860b') +
          _statBarRow(T.informationLbl, Math.round(view.hist.information ?? 0), 400, '#4070d0') +
          _statBarRow(T.arcaneLbl,           Math.round(view.hist.arcane ?? 0),      400, '#6a3aa0');
      }
      // Show current holy leader for dual-track powers (e.g. Holy Vatican Empire)
      if (view.currentHoly) {
        sideHTML += `<hr class="npc-r-sep">` +
          `<div class="npc-ident-row">${_iconSpan(245, 17)}<span style="opacity:0.65;">${_escapeHtml(T.holyLeader)}:</span>&nbsp;${_wikiLink('leader', view.currentHoly.name)}</div>`;
      }
    } else if (view.type === 'nation') {
      const ctrlHTML = view.controller !== 'Neutral'
        ? _wikiLink('power', view.controller)
        : `<span>${_escapeHtml(T.independent)}</span>`;
      sideHTML = `<div class="npc-ident-row">${_iconSpan(97, 17)}<span style="opacity:0.65;">${_escapeHtml(T.controlledBy)}:</span>&nbsp;${ctrlHTML}</div>`;
      if (view.government) sideHTML += _kvRow(186, T.government, _escapeHtml(view.government));
      const s = view.power?.state;
      if (s) {
        sideHTML += `<hr class="npc-r-sep">` +
          _meterRow(T.legitimacy, s.legitimacy, '#2a6e4a') +
          _meterRow(T.stability,  s.stability,  '#4070d0') +
          _meterRow(T.unrest,        s.unrest,     '#c02020') +
          _meterRow(T.economyLbl,   s.economyMood, '#b8860b');
      }
    } else if (view.type === 'leader') {
      if (view.kind === 'politician' && view.pol) {
        const p = view.pol;
        sideHTML =
          _statBarRow(T.charisma,   Math.round(p.charisma),  100, '#b8860b') +
          _statBarRow(T.integrity, Math.round(p.integrity), 100, '#2a6e4a') +
          _statBarRow(T.cunning,     Math.round(p.cunning),   100, '#6a3aa0') +
          _statBarRow(T.ambition,   Math.round(p.ambition),  100, '#c02020') +
          _meterRow(T.approval,     p.approval, '#4070d0');
      } else if (view.leader) {
        sideHTML = _kvRow(186, T.ideologyLbl, _escapeHtml(view.leader.ideology || '?')) +
          _kvRow(220, T.reignLbl, _escapeHtml(`${view.leader.years?.[0] ?? '?'} – ${view.leader.years?.[1] ?? '?'}`));
      }
    } else if (view.type === 'artifact') {
      const data = view.data;
      if (data) {
        if (Array.isArray(data.params)) {
          const PL = _paramLabels();
          data.params.forEach((v, i) => {
            if (v) sideHTML += _statBarRow(PL[i], v, 255, '#6a3aa0');
          });
        }
        sideHTML += `<hr class="npc-r-sep">` +
          `<div class="npc-ident-row">${_iconSpan(314, 17)}<span>${T.valueLbl}: <strong>${_euros(data.price)}</strong></span></div>`;
        if (data.weight) sideHTML += _kvRow(208, T.weightLbl, `${data.weight}`);
      }
      if (view.rec) {
        sideHTML += _kvRow(220, T.discovered, _escapeHtml(view.rec.date || '?'));
        const holder = view.rec.holders?.[view.rec.holders.length - 1];
        if (holder) sideHTML += `<div class="npc-ident-row">${_iconSpan(210, 17)}<span style="opacity:0.65;">${_escapeHtml(T.currentHolder)}:</span>&nbsp;${_linkify(holder.holder)}</div>`;
      }
    } else if (view.type === 'faction') {
      const h = view.hist;
      if (h) {
        sideHTML =
          _statBarRow(T.arcaneLbl,           Math.round(h.arcane ?? 0),      200, '#6a3aa0') +
          _statBarRow(T.techLbl,               Math.round(h.tech ?? 0),        200, '#b8860b') +
          _statBarRow(T.informationLbl, Math.round(h.information ?? 0), 200, '#4070d0');
      } else if (view.dlFaction) {
        sideHTML =
          _statBarRow(T.arcaneLbl,           Math.round(view.dlFaction.arcane ?? 0),      200, '#6a3aa0') +
          _statBarRow(T.techLbl,               Math.round(view.dlFaction.velocity ?? 0),   200, '#b8860b') +
          _statBarRow(T.informationLbl, Math.round(view.dlFaction.information ?? 0), 200, '#4070d0');
      }
      // Show parent hyperpower if present
      if (view.parentPower) {
        sideHTML += `<hr class="npc-r-sep">` +
          `<div class="npc-ident-row">${_iconSpan(97, 17)}<span style="opacity:0.65;">${_escapeHtml(T.wikiHyperpower)}:</span>&nbsp;${_wikiLink('power', view.parentPower)}</div>`;
      }
    } else if (view.type === 'party') {
      const p = view.party;
      sideHTML = `<div class="npc-ident-row">${_iconSpan(97, 17)}<span style="opacity:0.65;">${_escapeHtml(T.wikiHyperpower)}:</span>&nbsp;${_wikiLink('power', view.power.name)}</div>`;
      if (view.ideology) sideHTML += `<div class="npc-ident-row">${_iconSpan(187, 17)}<span style="opacity:0.65;">${_escapeHtml(T.ideologyLbl)}:</span>&nbsp;${_wikiLink('ideology', view.ideology.id, _ideologyLabel(view.ideology.id))}</div>`;
      if (view.leader) sideHTML += `<div class="npc-ident-row">${_iconSpan(215, 17)}<span style="opacity:0.65;">${_escapeHtml(T.leaderOfPartyLbl)}:</span>&nbsp;${_wikiLink('leader', view.leader.name)}</div>`;
      sideHTML += `<hr class="npc-r-sep">`;
      if (p.foundedYear != null) sideHTML += _kvRow(220, T.foundedLbl, `${p.foundedYear}`);
      if (p.lastShare != null) sideHTML += _kvRow(216, T.lastShareLbl, `${p.lastShare}%${p.seats ? ` · ${p.seats} ${T.seats?.toLowerCase?.() || 'seats'}` : ''}`);
      sideHTML += _kvRow(314, T.fundsLbl, _euros(p.funds));
    } else if (view.type === 'ideology') {
      const ax = view.ideo?.axes || {};
      sideHTML =
        _axisBarRow(T.axisEcon, ax.econ, '#b8860b') +
        _axisBarRow(T.axisAuth, ax.auth, '#c02020') +
        _axisBarRow(T.axisTrad, ax.trad, '#6a3aa0') +
        _axisBarRow(T.axisMil,  ax.mil,  '#4070d0') +
        _axisBarRow(T.axisMyst, ax.myst, '#2a6e4a');
    }

    let deadHTML = '';
    if (view.type === 'leader' && view.death) {
      const when = view.death.date ? `, ${_escapeHtml(view.death.date)}` : '';
      deadHTML = `<div class="npc-dead-badge">✝ ${_escapeHtml(T.deceased)}${when}</div>`;
    }

    return `
      <div class="npc-entity-emblem npc-emblem-${view.type}" title="${_escapeHtml(view.name)}">${initials ? _escapeHtml(initials) : emblem.glyph}</div>
      <div class="npc-entity-kicker">${_escapeHtml(kicker)}</div>
      <div class="npc-entity-title">${_escapeHtml(view.name)}</div>
      ${deadHTML}
      <div class="npc-vitals-footer">${sideHTML}</div>`;
  };

  // ── Nation ──────────────────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildNationOverviewHTML = function (view, T) {
    const power = view.power;
    let html = `<div class="npc-profile-name">${_escapeHtml(view.name)}</div>`;
    const sub = [view.government, view.controller !== 'Neutral' ? view.controller : (T.independent)].filter(Boolean);
    html += `<div class="npc-profile-sub">${_escapeHtml(sub.join(' · '))}</div><hr class="npc-r-sep">`;

    html += `<div class="npc-sec-hdr">${T.government}</div>`;
    if (view.government) html += _kvRow(186, T.government, _escapeHtml(view.government));
    html += `<div class="npc-ident-row">${_iconSpan(97, 17)}<span style="opacity:0.65;">${_escapeHtml(T.controlledBy)}:</span>&nbsp;${
      view.controller !== 'Neutral' ? _wikiLink('power', view.controller) : _escapeHtml(T.independent)
    }</div>`;
    if (view.faction && view.faction !== 'Neutral') {
      html += `<div class="npc-ident-row">${_iconSpan(187, 17)}<span style="opacity:0.65;">${_escapeHtml(T.wikiFaction)}:</span>&nbsp;${_linkify(view.faction)}</div>`;
    }
    if (power) {
      const head = power.politicians?.[power.headId];
      html += _kvRow(216, T.seats, `${power.seats}, ${_escapeHtml(power.legislature)}`);
      if (head) html += `<div class="npc-ident-row">${_iconSpan(215, 17)}<span style="opacity:0.65;">${_escapeHtml(power.headTitle)}:</span>&nbsp;${_wikiLink('leader', head.name)}</div>`;
      const dateOf = window.NPCPolitics?.dateOf;
      if (power.nextElectionMinute != null && dateOf) {
        html += _kvRow(220, T.nextElection, _escapeHtml(dateOf(power.nextElectionMinute)));
      }
      const pol = power.policies;
      if (pol) {
        html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.policiesLbl}</div>
          <div class="npc-stats-row">${_escapeHtml(`${T.taxRate} ${pol.taxRate}% · ${T.censorship} ${pol.censorship} · ${T.conscription} ${pol.conscription} · ${T.welfare} ${pol.welfare}`)}${pol.curfew ? ` · <span style="color:#c02020;font-weight:bold;">${_escapeHtml(T.curfewActive)}</span>` : ''}</div>`;
      }
    }

    // Latest government change, for flavor
    const last = view.history[view.history.length - 1];
    if (last && view.history.length > 1) {
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.governmentHistory}</div>
        <div class="npc-life-row"><span class="npc-life-time">${_escapeHtml(last.date)}</span><span>${_linkify(`${last.government} (${last.reason})`)}</span></div>`;
    }

    if (view.settlements.length) {
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.settlementsLbl}</div>`;
      for (const s of view.settlements) {
        const mayor = s.offices?.mayor;
        html += `<div class="npc-ident-row">${_iconSpan(190, 17)}<span>${_escapeHtml(s.group)}</span>${
          mayor ? `<span style="opacity:0.55;">&nbsp;— ${_escapeHtml(T.mayorLbl)}:&nbsp;</span>${_wikiLink('npc', mayor)}` : ''
        }</div>`;
      }
    }

    if (view.seasons) {
      const su = view.seasons.summer, wi = view.seasons.winter;
      if (su && wi) {
        html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.climateLbl}</div>
          <div class="npc-stats-row">${su.dayTemp}°C / ${su.nightTemp}°C &nbsp;·&nbsp; ${wi.dayTemp}°C / ${wi.nightTemp}°C</div>`;
      }
    }
    return html;
  };

  Scene_NPCEmpathize.prototype._buildNationGovHistoryHTML = function (view, T) {
    let html = `<div class="npc-sec-hdr">${T.governmentHistory}</div><hr class="npc-r-sep">`;
    if (!view.history.length) {
      return html + `<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRecords)}</p>`;
    }
    // newest first
    html += view.history.slice().reverse().map(rec => `
      <div class="npc-life-row">
        <span class="npc-life-time">${_escapeHtml(rec.date)}</span>
        <span><strong>${_escapeHtml(rec.government)}</strong>
          ${rec.controller !== 'Neutral' ? `— ${_wikiLink('power', rec.controller)}` : `— ${_escapeHtml(T.independent)}`}
          <span style="opacity:0.6;">(${_linkify(rec.reason || '')})</span></span>
      </div>`).join('');
    return html;
  };

  // ── Elections (shared by nation + hyperpower) ───────────────────────────────

  Scene_NPCEmpathize.prototype._buildElectionsHTML = function (power, T) {
    let html = `<div class="npc-sec-hdr">${T.electionRecords}</div><hr class="npc-r-sep">`;
    if (!power || !power.elections?.length) {
      return html + `<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRecords)}</p>`;
    }
    const dateOf = window.NPCPolitics?.dateOf;
    if (power.nextElectionMinute != null && dateOf) {
      html += _kvRow(220, T.nextElection, _escapeHtml(dateOf(power.nextElectionMinute)));
      html += `<hr class="npc-r-sep">`;
    }
    for (const e of power.elections.slice(0, 10)) {
      html += `<div class="npc-routine-sub-hdr">${_escapeHtml(e.date)}${e.label === 'snap' ? ` (${T.snapLbl})` : ''}${e.turnout != null ? `, ${T.turnoutLbl} ${e.turnout}%` : ''}</div>`;
      for (const r of (e.results || []).slice(0, 5)) {
        const isWinner = r.partyId === e.winnerPartyId || r.name === e.winner;
        html += `
          <div class="npc-vital-row">
            <span class="npc-vital-lbl" style="width:170px;${isWinner ? 'font-weight:bold;' : ''}">${_escapeHtml(r.name)}</span>
            <div class="npc-vital-track"><div class="npc-vital-fill" style="width:${Math.min(100, r.share)}%;background:${isWinner ? '#2a6e4a' : '#8c6d58'};"></div></div>
            <span class="npc-vital-pct" style="width:74px;">${r.share}%${r.seats != null ? ` · ${r.seats}` : ''}</span>
          </div>`;
      }
      if (e.head && e.head !== '—') {
        html += `<div class="npc-ident-row" style="margin-top:2px;">${_iconSpan(215, 15)}<span style="opacity:0.65;">${_escapeHtml(power.headTitle)}:</span>&nbsp;${_wikiLink('leader', e.head)}</div>`;
      }
      for (const n of (e.notes || [])) {
        html += `<div class="npc-stats-row" style="opacity:0.7;font-style:italic;">* ${_linkify(n)}</div>`;
      }
    }
    return html;
  };

  // ── Hyperpower ──────────────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildPowerOverviewHTML = function (view, T) {
    const live = view.live;
    let html = `<div class="npc-profile-name">${_escapeHtml(view.name)}</div>`;
    const sub = [live?.govType, live?.legislature].filter(Boolean);
    html += `<div class="npc-profile-sub">${_escapeHtml(sub.join(' · '))}</div><hr class="npc-r-sep">`;

    if (live) {
      const head = live.politicians?.[live.headId];
      const ruling = live.parties?.find(p => p.id === live.rulingPartyId);
      html += `<div class="npc-sec-hdr">${T.government}</div>`;
      html += _kvRow(186, T.government, _escapeHtml(live.govType));
      if (head) html += `<div class="npc-ident-row">${_iconSpan(215, 17)}<span style="opacity:0.65;">${_escapeHtml(live.headTitle)}:</span>&nbsp;${_wikiLink('leader', head.name)}<span style="opacity:0.5;">&nbsp;(${T.approval} ${Math.round(head.approval)}%)</span></div>`;
      else html += _kvRow(215, live.headTitle, _escapeHtml(T.vacant));
      if (ruling) html += _kvRow(187, T.rulingParty, _wikiLink('party', ruling.id, ruling.name) + (live.coalition?.length > 1 ? ` <span style="opacity:0.55;">(+${live.coalition.length - 1})</span>` : ''));
      else if (head) html += _kvRow(187, T.rulingParty, _escapeHtml(T.independent));
      html += _kvRow(216, T.seats, `${live.seats}, ${_escapeHtml(live.legislature)}`);
      const dateOf = window.NPCPolitics?.dateOf;
      if (live.nextElectionMinute != null && dateOf) html += _kvRow(220, T.nextElection, _escapeHtml(dateOf(live.nextElectionMinute)));

      if (live.parties?.length) {
        html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.partiesLbl}</div>`;
        for (const p of live.parties) {
          const leader = live.politicians?.[p.leaderId];
          html += `<div class="npc-ident-row">${_iconSpan(187, 17)}<span>${_wikiLink('party', p.id, p.name)}</span><span style="opacity:0.55;">&nbsp;— ${p.lastShare}%${p.seats ? ` · ${p.seats} ${T.seats?.toLowerCase?.() || 'seats'}` : ''}</span>${
            leader ? `<span style="opacity:0.55;">&nbsp;·&nbsp;</span>${_wikiLink('leader', leader.name)}` : ''
          }</div>`;
        }
      }

      const pol = live.policies;
      if (pol) {
        html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.policiesLbl}</div>
          <div class="npc-stats-row">${_escapeHtml(`${T.taxRate} ${pol.taxRate}% · ${T.censorship} ${pol.censorship} · ${T.conscription} ${pol.conscription} · ${T.welfare} ${pol.welfare} · ${T.festivalsLbl} ${pol.festivals}`)}${pol.curfew ? ` · <span style="color:#c02020;font-weight:bold;">${_escapeHtml(T.curfewActive)}</span>` : ''}</div>`;
      }
    }

    if (view.hist) {
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.stats}</div>
        <div class="npc-stats-row">${_escapeHtml(`${T.populationLbl} ${Math.round(view.hist.population ?? 0).toLocaleString()} · ${T.militaryLbl} ${Math.round(view.hist.military ?? 0)} · ${T.economyLbl} ${Math.round(view.hist.economy ?? 0)} · ${T.informationLbl} ${Math.round(view.hist.information ?? 0)} · ${T.arcaneLbl} ${Math.round(view.hist.arcane ?? 0)}`)}</div>`;
    }

    html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.memberNations} (${view.nations.length})</div><div class="npc-tag-wrap">`;
    html += view.nations.map(n => `<span class="npc-tag">${_wikiLink('nation', n)}</span>`).join('')
      || `<span style="opacity:0.6;font-style:italic;">${_escapeHtml(T.noRecords)}</span>`;
    html += `</div>`;

    if (live?.rumors?.length) {
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.rumorsLbl}</div>`;
      for (const r of live.rumors.slice(0, 5)) {
        html += `<div class="npc-thought">&ldquo;${_linkify(`${r.subjectName}, ${r.kind}`)}&rdquo; <span style="opacity:0.5;font-style:normal;">(${_escapeHtml(r.date)})</span></div>`;
      }
    }
    return html;
  };

  Scene_NPCEmpathize.prototype._buildPowerLeadersHTML = function (view, T) {
    const live = view.live;
    let html = `<div class="npc-sec-hdr">${T.pastLeaders}</div><hr class="npc-r-sep">`;

    // Reign pockets from the live simulation
    const headHistory = live?.headHistory || [];
    if (headHistory.length) {
      const liveHeadTitle = window.NPCPolitics?.powerLabel?.(live, 'headTitle') || live.headTitle;
      html += `<div class="npc-routine-sub-hdr">${T.pastLeaders}, ${_escapeHtml(liveHeadTitle)}</div>`;
      html += headHistory.map(h => `
        <div class="npc-life-row">
          <span class="npc-life-time">${_escapeHtml(h.date)}${h.endDate ? ` → ${_escapeHtml(h.endDate)}` : ''}</span>
          <span>${_wikiLink('leader', h.name)} <span style="opacity:0.6;">(${_escapeHtml(window.NPCPolitics?.accessionLabel?.(h.how) || h.how || '?')})</span>${h.endDate ? '' : ` <span style="color:#2a6e4a;">— ${_escapeHtml(T.currentLeader)}</span>`}</span>
        </div>`).join('');
    }

    // Historical leader roster from history.json
    const histLeaders = view.hist?.leaders || [];
    if (histLeaders.length) {
      const hm = window.HistoryManager;
      const deaths = hm?.getLeaderDeaths?.() || {};
      const deadList = hm?.getDeadLeaders?.() || [];
      html += `<div class="npc-routine-sub-hdr">${T.leadersTab}</div>`;
      html += histLeaders.map(l => {
        const isDead = _wikiIsDead(deadList.includes(l.name) || !!deaths[l.name]);
        const deathDate = _wikiDeathDate(deaths[l.name]?.date);
        return `
        <div class="npc-life-row">
          <span class="npc-life-time">${_escapeHtml(`${l.years?.[0] ?? '?'}–${l.years?.[1] ?? '?'}`)}</span>
          <span>${_wikiLink('leader', l.name)}${isDead ? ` <span style="color:#8b1010;">✝${deathDate ? ' ' + _escapeHtml(deathDate) : ''}</span>` : ''}
            <span style="opacity:0.6;">— ${_escapeHtml(l.ideology || '?')}</span></span>
        </div>`;
      }).join('');
    }

    // Living political class
    if (live?.politicians) {
      const pols = Object.values(live.politicians)
        .sort((a, b) => (b.alive - a.alive) || (b.approval - a.approval))
        .slice(0, 40);
      if (pols.length) {
        html += `<div class="npc-routine-sub-hdr">${T.politicalClass}</div><div class="npc-tag-wrap">`;
        html += pols.map(p => {
          const dead = _wikiIsDead(!p.alive);
          return `<span class="npc-tag"${dead ? ' style="opacity:0.55;"' : ''}>${_wikiLink('leader', p.name)}${dead ? ' ✝' : ''}</span>`;
        }).join('');
        html += `</div>`;
      }
    }

    if (html.indexOf('npc-life-row') < 0 && html.indexOf('npc-tag') < 0) {
      html += `<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRecords)}</p>`;
    }
    return html;
  };

  // ── Leader ──────────────────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildLeaderOverviewHTML = function (view, T) {
    let html = `<div class="npc-profile-name">${_escapeHtml(view.name)}</div>`;

    if (view.kind === 'politician' && view.pol && view.power) {
      const p = view.pol;
      const power = view.power;
      const party = power.parties?.find(x => x.id === p.partyId);
      const polOffice = window.NPCPolitics?.politicianOffice?.(power, p) || p.office || null;
      const sub = [polOffice, power.name].filter(Boolean);
      html += `<div class="npc-profile-sub">${_escapeHtml(sub.join(' · '))}</div>`;
      if (view.death) {
        html += `<div class="npc-dead-badge" style="margin:4px 0 8px;">✝ ${_escapeHtml(T.deceased)}${view.death.date ? `, ${_escapeHtml(view.death.date)}` : ''}${view.death.cause ? ` (${_escapeHtml(view.death.cause)})` : ''}</div>`;
      }
      html += `<hr class="npc-r-sep">`;
      html += `<div class="npc-ident-row">${_iconSpan(97, 17)}<span style="opacity:0.65;">${_escapeHtml(T.wikiHyperpower)}:</span>&nbsp;${_wikiLink('power', power.name)}</div>`;
      if (party) html += _kvRow(187, T.partyLbl, _wikiLink('party', party.id, party.name));
      else if (p.office) html += _kvRow(187, T.partyLbl, _escapeHtml(T.independent));
      if (p.office) html += _kvRow(215, T.status, _escapeHtml(polOffice));
      const age = window.NPCPolitics?.politicianAgeOf?.(p);
      if (age != null && !view.death) html += _kvRow(84, T.ageLbl, `${age}`);
      if (p.scandals) html += _kvRow(1, T('Empathize.scandalsLbl'), `${p.scandals}`);

      // Ideology leanings
      const tags = [];
      const ix = p.ideology || {};
      if (ix.econ <= -40) tags.push('collectivist'); else if (ix.econ >= 40) tags.push('free-marketeer');
      if (ix.auth <= -40) tags.push('libertarian'); else if (ix.auth >= 40) tags.push('authoritarian');
      if (ix.trad <= -40) tags.push('progressive'); else if (ix.trad >= 40) tags.push('traditionalist');
      if (ix.mil <= -40) tags.push('pacifist'); else if (ix.mil >= 40) tags.push('militarist');
      if (ix.myst <= -40) tags.push('rationalist'); else if (ix.myst >= 40) tags.push('mystic');
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.ideologyLbl}</div><div class="npc-tag-wrap">`;
      html += (tags.length ? tags : ['moderate']).map(t => `<span class="npc-tag">${_escapeHtml(t)}</span>`).join('');
      html += `</div>`;

      // Full stat block, world leaders are the only profiles with stats
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.stats}</div>`;
      html += _statBarRow(T.charisma,     Math.round(p.charisma),  100, '#b8860b');
      html += _statBarRow(T.integrity,   Math.round(p.integrity), 100, '#2a6e4a');
      html += _statBarRow(T.cunning,       Math.round(p.cunning),   100, '#6a3aa0');
      html += _statBarRow(T.ambition,     Math.round(p.ambition),  100, '#c02020');
      html += _statBarRow(T.strengthLbl,  Math.round(p.strength),  100, '#8c6d58');
      html += _statBarRow(T.intellectLbl,Math.round(p.intellect), 100, '#4070d0');
      html += _statBarRow(T.divinityLbl,  Math.round(p.divinity),  100, '#d4af37');
    } else if (view.kind === 'historical' && view.leader) {
      const l = view.leader;
      html += `<div class="npc-profile-sub">${_escapeHtml(view.of)}</div>`;
      if (view.death) {
        html += `<div class="npc-dead-badge" style="margin:4px 0 8px;">✝ ${_escapeHtml(T.deceased)}${view.death.date ? `, ${_escapeHtml(view.death.date)}` : ''}${view.death.cause ? ` (${_escapeHtml(view.death.cause)})` : ''}</div>`;
      }
      html += `<hr class="npc-r-sep">`;
      html += `<div class="npc-ident-row">${_iconSpan(97, 17)}<span style="opacity:0.65;">${_escapeHtml(view.ofType === 'power' ? (T.wikiHyperpower) : (T.wikiFaction))}:</span>&nbsp;${_wikiLink(view.ofType, view.of)}</div>`;
      html += _kvRow(186, T.ideologyLbl, _escapeHtml(l.ideology || '?'));
      html += _kvRow(220, T.reignLbl, _escapeHtml(`${l.years?.[0] ?? '?'} – ${l.years?.[1] ?? '?'}`));
    }
    return html;
  };

  // ── Artifact ────────────────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildArtifactOverviewHTML = function (view, T) {
    const data = view.data;
    const kindLabel = view.kind === 'weapon' ? (T.artifactKindWeapon)
      : view.kind === 'armor' ? (T.artifactKindArmor)
      : (T.artifactKindItem);
    let html = `<div class="npc-profile-name">${_iconSpan(data?.iconIndex ?? 245, 26)} ${_escapeHtml(view.name)}</div>`;
    html += `<div class="npc-profile-sub">${_escapeHtml(kindLabel)}${view.kind === 'weapon' && data?.wtypeId ? ` · ${_escapeHtml(_wtypeName(data.wtypeId))}` : ''}${view.kind === 'armor' && data?.atypeId ? ` · ${_escapeHtml(_atypeName(data.atypeId))}` : ''}</div>`;
    html += `<hr class="npc-r-sep">`;
    if (data?.description) html += `<div class="npc-backstory-text">${_escapeHtml(data.description)}</div>`;

    html += `<div class="npc-sec-hdr" style="margin-top:8px;">${T.stats}</div>`;
    if (Array.isArray(data?.params)) {
      const PL = _paramLabels();
      const parts = data.params.map((v, i) => v ? `${PL[i]} +${v}` : null).filter(Boolean);
      html += `<div class="npc-stats-row">${parts.length ? _escapeHtml(parts.join(' · ')) : '—'}</div>`;
    }
    html += `<div class="npc-ident-row" style="margin-top:5px;">${_iconSpan(314, 17)}<span>${T.valueLbl}: <strong>${_euros(data?.price)}</strong></span></div>`;
    if (data?.weight) html += _kvRow(208, T.weightLbl, `${data.weight}`);

    if (view.rec) {
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.discovered}</div>`;
      html += `<div class="npc-life-row"><span class="npc-life-time">${_escapeHtml(view.rec.date || '?')}</span><span>${_linkify(`${view.rec.origin} ${view.rec.action} the ${view.rec.name}.`)}</span></div>`;
      const holder = view.rec.holders?.[view.rec.holders.length - 1];
      if (holder) {
        html += `<div class="npc-ident-row" style="margin-top:5px;">${_iconSpan(210, 17)}<span style="opacity:0.65;">${_escapeHtml(T.currentHolder)}:</span>&nbsp;${_linkify(holder.holder)}<span style="opacity:0.5;">&nbsp;(${_escapeHtml(holder.since || '?')})</span></div>`;
      }
    } else {
      html += `<hr class="npc-r-sep"><p style="opacity:0.6;font-style:italic;">${_escapeHtml(T.noRecords)}</p>`;
    }
    return html;
  };

  Scene_NPCEmpathize.prototype._buildArtifactHoldersHTML = function (view, T) {
    let html = `<div class="npc-sec-hdr">${T.pastHolders}</div><hr class="npc-r-sep">`;
    const holders = view.rec?.holders || [];
    if (!holders.length) {
      return html + `<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRecords)}</p>`;
    }
    html += holders.slice().reverse().map((h, i) => `
      <div class="npc-life-row">
        <span class="npc-life-time">${_escapeHtml(h.since || '?')}</span>
        <span>${_linkify(h.holder)}${h.power && h.power !== h.holder ? ` <span style="opacity:0.55;">(${_linkify(h.power)})</span>` : ''}
          <span style="opacity:0.6;">— ${_escapeHtml(h.how || '?')}</span>${i === 0 ? ` <span style="color:#2a6e4a;">— ${_escapeHtml(T.currentHolder)}</span>` : ''}</span>
      </div>`).join('');
    return html;
  };

  // ── Faction ─────────────────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildFactionOverviewHTML = function (view, T) {
    let html = `<div class="npc-profile-name">${_escapeHtml(view.name)}</div>`;
    html += `<div class="npc-profile-sub">${_escapeHtml(T.wikiFaction)}</div><hr class="npc-r-sep">`;
    const h = view.hist || view.dlFaction;
    if (h) {
      html += `<div class="npc-sec-hdr">${T.stats}</div>
        <div class="npc-stats-row">${_escapeHtml(`${T.arcaneLbl} ${Math.round(h.arcane ?? 0)} · ${T.techLbl} ${Math.round((view.hist ? h.tech : h.velocity) ?? 0)} · ${T.informationLbl} ${Math.round(h.information ?? 0)}`)}</div>`;
      const leaders = view.hist?.leaders || [];
      if (leaders.length) {
        const hm = window.HistoryManager;
        const deaths = hm?.getLeaderDeaths?.() || {};
        const deadList = hm?.getDeadLeaders?.() || [];
        html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.pastLeaders}</div>`;
        html += leaders.map(l => {
          const isDead = _wikiIsDead(deadList.includes(l.name) || !!deaths[l.name]);
          return `<div class="npc-life-row">
            <span class="npc-life-time">${_escapeHtml(`${l.years?.[0] ?? '?'}–${l.years?.[1] ?? '?'}`)}</span>
            <span>${_wikiLink('leader', l.name)}${isDead ? ' <span style="color:#8b1010;">✝</span>' : ''} <span style="opacity:0.6;">— ${_escapeHtml(l.ideology || '?')}</span></span>
          </div>`;
        }).join('');
      }
    }
    if (view.dlFaction && window.$gameFactions?.getReputation && view.dlIndex >= 0) {
      const rep = window.$gameFactions.getReputation(view.dlIndex) ?? 0;
      html += `<hr class="npc-r-sep">` + _meterRow(T('Empathize.reputationLbl'), Math.round((rep + 100) / 2), rep >= 0 ? '#2a6e4a' : '#c02020');
    }
    return html;
  };

  Scene_NPCEmpathize.prototype._buildFactionMembersHTML = function (view, T) {
    let html = `<div class="npc-sec-hdr">${T.factionMembersLbl}</div><hr class="npc-r-sep">`;
    if (!view.members.length) {
      return html + `<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRecords)}</p>`;
    }
    html += `<div class="npc-tag-wrap">` +
      view.members.map(n => `<span class="npc-tag">${_iconSpan(82, 15)}${_wikiLink('npc', n)}</span>`).join('') +
      `</div>`;
    return html;
  };

  // ── Political party ─────────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildPartyOverviewHTML = function (view, T) {
    const p = view.party;
    const power = view.power;
    let html = `<div class="npc-profile-name">${_escapeHtml(view.name)}</div>`;
    const sub = [power.name, _ideologyLabel(view.ideology?.id)].filter(Boolean);
    html += `<div class="npc-profile-sub">${_escapeHtml(sub.join(' · '))}</div>`;
    if (power.rulingPartyId === p.id) {
      html += `<div class="npc-dead-badge" style="background:#2a6e4a;">${_escapeHtml(T.rulingParty)}</div>`;
    }
    html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.overview}</div>`;
    if (p.country) html += _kvRow(97, T.originLbl, _escapeHtml(p.country));
    if (view.leader) html += `<div class="npc-ident-row">${_iconSpan(215, 17)}<span style="opacity:0.65;">${_escapeHtml(T.leaderOfPartyLbl)}:</span>&nbsp;${_wikiLink('leader', view.leader.name)}</div>`;
    if (p.foundedYear != null) html += _kvRow(220, T.foundedLbl, `${p.foundedYear}`);
    html += _kvRow(216, T.lastShareLbl, `${p.lastShare ?? 0}%${p.seats ? ` · ${p.seats} ${T.seats?.toLowerCase?.() || 'seats'}` : ''}`);
    html += _kvRow(314, T.fundsLbl, _euros(p.funds));

    if (view.ideology) {
      html += `<hr class="npc-r-sep"><div class="npc-sec-hdr">${T.platformLbl}</div>`;
      const ax = p.platform || {};
      html += _axisBarRow(T.axisEcon, ax.econ, '#b8860b')
        + _axisBarRow(T.axisAuth, ax.auth, '#c02020')
        + _axisBarRow(T.axisTrad, ax.trad, '#6a3aa0')
        + _axisBarRow(T.axisMil,  ax.mil,  '#4070d0')
        + _axisBarRow(T.axisMyst, ax.myst, '#2a6e4a');
    }
    return html;
  };

  // ── Ideology ─────────────────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildIdeologyOverviewHTML = function (view, T) {
    let html = `<div class="npc-profile-name">${_escapeHtml(view.name)}</div><hr class="npc-r-sep">`;
    html += `<div class="npc-sec-hdr">${T.heldByLbl} (${view.parties.length})</div>`;
    if (!view.parties.length) {
      html += `<p style="opacity:0.6;font-style:italic;margin-top:8px;">${_escapeHtml(T.noParties)}</p>`;
    } else {
      // Grouped by hyperpower, so "multiple parties, one ideology" reads as
      // the pattern it is rather than a flat unsorted list.
      const byPower = new Map();
      for (const { party, powerName } of view.parties) {
        if (!byPower.has(powerName)) byPower.set(powerName, []);
        byPower.get(powerName).push(party);
      }
      for (const [powerName, parties] of byPower) {
        html += `<div class="npc-ident-row" style="margin-top:8px;">${_iconSpan(97, 17)}${_wikiLink('power', powerName)}</div><div class="npc-tag-wrap">`;
        html += parties.map(p => `<span class="npc-tag">${_wikiLink('party', p.id, p.name)}</span>`).join('');
        html += `</div>`;
      }
    }
    return html;
  };

  // ── Shared chronicle tab ────────────────────────────────────────────────────

  Scene_NPCEmpathize.prototype._buildEntityEventsHTML = function (view, T) {
    const ICONS = window.HistorySimulator_ICONS ?? {};
    let html = `<div class="npc-sec-hdr">${T.worldEventsLbl}</div><hr class="npc-r-sep">`;
    const fromHistory = view.events || [];
    const fromPolitics = view.type === 'power' ? (view.live?.events || []) : [];
    if (!fromHistory.length && !fromPolitics.length) {
      return html + `<p style="opacity:0.6;font-style:italic;margin-top:12px;">${_escapeHtml(T.noRecords)}</p>`;
    }
    if (fromPolitics.length) {
      html += `<div class="npc-routine-sub-hdr">${_escapeHtml(T.eventsTab)}</div>`;
      html += fromPolitics.slice(0, 20).map(e => `
        <div class="npc-life-row">
          <span class="npc-life-time">${_escapeHtml(e.date ?? '?')}</span>
          <span>${_linkify(e.desc ?? '')}</span>
        </div>`).join('');
    }
    if (fromHistory.length) {
      html += `<div class="npc-routine-sub-hdr">${_escapeHtml(T.lifeHistoryTimeline)}</div>`;
      html += _eventRows(fromHistory, ICONS);
    }
    return html;
  };

  // ============================================================================
  // WIKI INDEX TAB, category grid → entry grid (the encyclopedia's "browse
  // all" view). People entries open the NPC's own Empathize panel, remotely
  // if they aren't on the current map; everything else opens its wiki profile.
  // ============================================================================

  const WIKI_CATEGORIES = [
    { id: 'party',            glyph: '', labelKey: 'wikiParty' },
    { id: 'people',           glyph: '☺', labelKey: 'wikiPeople' },
    { id: 'leaders',          glyph: '☻', labelKey: 'wikiLeaders' },
    { id: 'powers',           glyph: '♛', labelKey: 'wikiHyperpowers' },
    { id: 'nations',          glyph: '⚑', labelKey: 'wikiNations' },
    { id: 'artifacts',        glyph: '✦', labelKey: 'wikiArtifacts' },
    { id: 'factions',         glyph: '⚜', labelKey: 'wikiFactions' },
    { id: 'politicalParties', glyph: '⚖', labelKey: 'wikiPoliticalParties' },
    { id: 'ideologies',       glyph: '✪', labelKey: 'wikiIdeologies' },
  ];

  // Past party members (NPCSystemParty's removeActor snapshots), excluding
  // anyone who has since rejoined the active roster.
  function _pastPartyMembers() {
    const currentNames = new Set(($gameParty?.members() ?? []).map(a => a.name()));
    return ($gameSystem?._npcPastPartyMembers ?? []).filter(p => p?.name && !currentNames.has(p.name));
  }

  function _wikiEntryTile(type, id, labelHTML, subHTML) {
    const safeId = encodeURIComponent(String(id));
    return `
      <div class="npc-wiki-entry" onmousedown="event.stopPropagation();window.NPCEmpathize.openEntity('${type}','${safeId}')">
        <span class="npc-wiki-entry-name">${labelHTML}</span>
        ${subHTML ? `<span class="npc-wiki-entry-sub">${subHTML}</span>` : ''}
      </div>`;
  }

  Scene_NPCEmpathize.prototype._buildWikiTabHTML = function (T) {
    const pets = window.PetSystem ? window.PetSystem.getPets() : [];
    const counts = {
      party:     ($gameParty?.members()?.length ?? 0) + _pastPartyMembers().length + pets.length,
      people:    Wiki.listPeople().length,
      leaders:   Wiki.listLeaders().length,
      powers:    Wiki.listPowerNames().length,
      nations:   Wiki.listNations().length,
      artifacts: Wiki.listArtifacts().length,
      factions:  Wiki.listFactionNames().length,
      politicalParties: Wiki.listPartyNames().length,
      ideologies:       Wiki.listIdeologyNames().length,
    };

    // ── Category grid ─────────────────────────────────────────────────────────
    if (!this._wikiCategory) {
      const cards = WIKI_CATEGORIES.map(cat => `
        <div class="npc-wiki-card" onmousedown="event.stopPropagation();SceneManager._scene._setWikiCategory('${cat.id}')">
          <span class="npc-wiki-card-glyph">${cat.glyph}</span>
          <span class="npc-wiki-card-label">${_escapeHtml(T[cat.labelKey] || cat.fallback)}</span>
          <span class="npc-wiki-card-count">${counts[cat.id]}</span>
        </div>`).join('');
      return `
        <div class="npc-sec-hdr">${_escapeHtml(T.wikiTab)}, ${_escapeHtml(T.wikiCategories)}</div>
        <hr class="npc-r-sep">
        <div class="npc-wiki-grid npc-wiki-grid--cards">${cards}</div>`;
    }

    // ── Entry grid for the selected category ─────────────────────────────────
    const cat = WIKI_CATEGORIES.find(c => c.id === this._wikiCategory) || WIKI_CATEGORIES[0];
    const headerHTML = `
      <div class="npc-panel-top-hdr">
        <div class="npc-sec-hdr npc-wiki-cat-selected" style="margin-bottom:0;">${cat.glyph} ${_escapeHtml(T[cat.labelKey] || cat.fallback)} (${counts[cat.id]})</div>
        <span class="npc-back-btn" onmousedown="event.stopPropagation();SceneManager._scene._setWikiCategory(null)">← ${_escapeHtml(T.wikiCategories)}</span>
      </div>
      <hr class="npc-r-sep">`;

    let tiles = '';
    switch (cat.id) {
      case 'party': {
        // Current members open in actor mode, full profile *and* the chat
        // tab, always available while they travel with you. Past members
        // open remotely by name (their NPC profile lives on in the society).
        // Where this party was last written into the world folder, which is
        // where any other savegame of the world would find them standing
        // (NPCSystem.js, VisitingParties). Named as a place, not as a tile.
        const VP = window.PartyPresence;
        const ownLastSeen = VP?.lastSeenName?.(VP.currentSlot?.() ?? 0) ?? null;
        const seenLine = where => (where
          ? ` · ${_escapeHtml(T.partyLastSeen)} ${_escapeHtml(where)}`
          : '');
        const current = ($gameParty?.members() ?? []);
        const curTiles = current.map(a => `
          <div class="npc-wiki-entry" onmousedown="event.stopPropagation();window.NPCEmpathize.openForActor(${a.actorId()})">
            <span class="npc-wiki-entry-name">${_escapeHtml(a.name())}</span>
            <span class="npc-wiki-entry-sub">${_escapeHtml(T.partyCurrentMember)} · ${_escapeHtml(a.currentClass()?.name || '')} Lv.${a.level}${seenLine(ownLastSeen)}</span>
          </div>`).join('');
        // The other playthroughs of this world, and where each was left. They
        // are people this party can actually meet, so they are listed here with
        // the same "last seen" line rather than being invisible until walked
        // into; the tile opens their profile by name like any other.
        const visitorTiles = (VP?.otherParties?.() ?? []).map(party => {
          const where = VP.lastSeenName(party.slot);
          return (party.members || []).map(m => `
          <div class="npc-wiki-entry" onmousedown="event.stopPropagation();window.NPCEmpathize.openByName(decodeURIComponent('${encodeURIComponent(String(m.name))}'))">
            <span class="npc-wiki-entry-name">${_escapeHtml(m.name)}</span>
            <span class="npc-wiki-entry-sub">${_escapeHtml(T.partyOtherMember)}${party.leaderName ? ` (${_escapeHtml(party.leaderName)})` : ''}${seenLine(where)}</span>
          </div>`).join('');
        }).join('');
        // Former members carry how they left (NPCSystemParty's roster history):
        // retired to a dossier, dismissed, or dead, with the date it happened.
        const pastTiles = _pastPartyMembers().map(p => {
          const statusLabel = p.reason === 'died'
            ? (T.partyDeadMember)
            : p.reason === 'retired'
              ? (T.partyRetiredMember)
              : (T.partyFormerMember);
          const when = p.deathDate || p.leftDate || '';
          return `
          <div class="npc-wiki-entry" onmousedown="event.stopPropagation();window.NPCEmpathize.openByName(decodeURIComponent('${encodeURIComponent(String(p.name))}'))">
            <span class="npc-wiki-entry-name">${_escapeHtml(p.name)}${p.reason === 'died' ? ' <span style="color:#8b1010;">✝</span>' : ''}</span>
            <span class="npc-wiki-entry-sub">${_escapeHtml(statusLabel)}${when ? ` ${_escapeHtml(when)}` : ''} · ${_escapeHtml(p.className || '')} Lv.${p.level || 1}</span>
          </div>`;
        }).join('');
        // Pets/followers: trailing map companions that never battle. Informational
        // tiles only, with the active follower flagged.
        const petList   = window.PetSystem ? window.PetSystem.getPets() : [];
        const activePet = window.PetSystem ? window.PetSystem.getActivePet() : null;
        const petTiles  = petList.map(pet => {
          const typeLabel = pet.isFollower
            ? (T.petFollower)
            : (T.petPet);
          const activeSuffix = (activePet && pet.id === activePet.id)
            ? ` · ${_escapeHtml(T.petFollowing)}`
            : '';
          return `
          <div class="npc-wiki-entry">
            <span class="npc-wiki-entry-name">${_escapeHtml(pet.name)}</span>
            <span class="npc-wiki-entry-sub">${_escapeHtml(typeLabel)}${activeSuffix} · Lv.${pet.level || 1}</span>
          </div>`;
        }).join('');
        tiles = curTiles + pastTiles + petTiles + visitorTiles;
        break;
      }
      case 'people':
        tiles = Wiki.listPeople().map(p =>
          _wikiEntryTile('npc', p.name, _escapeHtml(p.name), p.group ? _escapeHtml(p.group) : '')
        ).join('');
        break;
      case 'leaders':
        tiles = Wiki.listLeaders().map(l =>
          _wikiEntryTile('leader', l.name,
            `${_escapeHtml(l.name)}${l.dead ? ' <span style="color:#8b1010;">✝</span>' : ''}`,
            l.of ? _escapeHtml(l.of) : '')
        ).join('');
        break;
      case 'powers':
        tiles = Wiki.listPowerNames().map(n => {
          const live = window.NPCPolitics?.getPower?.(n);
          return _wikiEntryTile('power', n, `♛ ${_escapeHtml(n)}`, live ? _escapeHtml(live.govType) : '');
        }).join('');
        break;
      case 'nations':
        tiles = Wiki.listNations().map(n =>
          _wikiEntryTile('nation', n.name, `⚑ ${_escapeHtml(n.name)}`,
            n.controller && n.controller !== 'Neutral' ? _escapeHtml(n.controller) : _escapeHtml(T.independent))
        ).join('');
        break;
      case 'artifacts':
        tiles = Wiki.listArtifacts().map(a => {
          const kindLabel = a.kind === 'weapon' ? (T.artifactKindWeapon)
            : a.kind === 'armor' ? (T.artifactKindArmor)
            : (T.artifactKindItem);
          return _wikiEntryTile('artifact', a.key,
            `${_iconSpan(a.iconIndex ?? 245, 15)} ${_escapeHtml(a.name)}`, _escapeHtml(kindLabel));
        }).join('');
        break;
      case 'factions':
        tiles = Wiki.listFactionNames().map(n =>
          _wikiEntryTile('faction', n, `⚜ ${_escapeHtml(n)}`, '')
        ).join('');
        break;
      case 'politicalParties':
        tiles = Wiki.listPartyNames().map(p => {
          const ideoLabel = _ideologyLabel(p.ideologyId);
          const sub = [p.powerName, ideoLabel].filter(Boolean).join(' · ');
          return _wikiEntryTile('party', p.id, `⚖ ${_escapeHtml(p.name)}`, _escapeHtml(sub));
        }).join('');
        break;
      case 'ideologies':
        tiles = Wiki.listIdeologyNames().map(e => {
          const label = window.T ? window.T(e.name) : e.id;
          const sub = e.partyCount
            ? T.n('Empathize.ideologyPartyCount', e.partyCount, { n: e.partyCount })
            : T.noParties;
          return _wikiEntryTile('ideology', e.id, `✪ ${_escapeHtml(label)}`, _escapeHtml(sub));
        }).join('');
        break;
    }
    if (!tiles) {
      tiles = `<p style="opacity:0.6;font-style:italic;">${_escapeHtml(T.noRecords)}</p>`;
    }

    return `${headerHTML}<div class="npc-wiki-grid">${tiles}</div>`;
  };

  // ============================================================================
  // More tab
  // ============================================================================

  Scene_NPCEmpathize.prototype._buildMoreHTML = function (T) {
    const items = [
      { id: 'leave', label: T.leave },
    ];
    const rowsHTML = items.map(it => `
      <div class="npc-action-row" onmousedown="event.stopPropagation();SceneManager._scene._moreAction('${it.id}')">
        <span class="npc-action-label">${_escapeHtml(it.label)}</span>
        <span class="npc-action-arrow">←</span>
      </div>`).join('');

    return `<div class="npc-sec-hdr" style="margin-bottom:6px;">${T.more}</div>${rowsHTML}`;
  };

  console.log('[NPCEmpathizeUI] v3.0.0 loaded.');
})();
