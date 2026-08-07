/*:
 * @target MZ
 * @plugindesc NPCEmpathize v3.0.0, NPC Interaction Logic
 * @author Omni-Lex
 * @help NPCEmpathize.js
 *
 * Core logic for the NPC Interaction Panel.
 * Must be listed BEFORE NPCEmpathizeUI.js in the Plugin Manager.
 *
 * Load Order:
 *   MarkovTextGenerator → NPCSystem → NPCSociety → NPCSimulationCore
 *   → NPCSystemParty → NPCEmpathize → NPCEmpathizeUI → MousePan → VisualNovelBustSystem
 *
 * Data files:
 *   data/personalityData.json , personality → markov db array map
 *   js/i18n/<lang>/plugins/Empathize.json, panel copy (via the shared resolver)
 *
 * @command Open
 * @desc Open the NPC dialogue panel for the active event (or a named event).
 *
 * @arg eventName
 * @text NPC Event Name
 * @type string
 * @default
 * @desc Leave blank to auto-detect the triggering NPC event, or supply an exact name.
 */

(() => {
  'use strict';

  const pluginName = 'NPCEmpathize';

  // ============================================================================
  // SECTION 1, PERSONALITY → MARKOV DB MAP  (built from js/db/Health/PersonalityData.json)
  // ============================================================================

  let PERSONALITY_DB_MAP = {};
  (() => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'js/db/Health/PersonalityData.json', false);
      xhr.send();
      if (xhr.status === 200 || xhr.status === 0) {
        const data = JSON.parse(xhr.responseText);
        // PersonalityData.json may be a bare array (legacy) or { list:[...] } (current).
        const arr = Array.isArray(data) ? data : (data.list || []);
        for (const p of arr) {
          if (p.name && p.markovDbs) PERSONALITY_DB_MAP[p.name] = p.markovDbs;
        }
      }
    } catch (e) {
      console.warn('[NPCEmpathize] Could not load PersonalityData.json:', e);
    }
  })();

  // ============================================================================
  // SECTION 2, I18N LOADER
  // ============================================================================

  const _TEMPLATE_FUNC_PARAMS = {
    refuseTrade:    ['name'],
    refuseHelp:     ['name'],
    healFree:       ['name'],
    healCost:       ['name', 'g'],
    notEnoughGold:  ['g'],
    joinRefused:    ['name'],
    gaveItem:       ['name', 'item'],
    giftRefused:    ['name', 'item'],
    briberyCaught:  ['name'],
    bribeRefused:   ['name'],
    bribeRefusedLaw:['name'],
    attackWarning:  ['name'],
    attackCommitted:['name'],
    transmitWarnHas:   ['action', 'name', 'list'],
    transmitWarnNone:  ['action', 'name'],
    transmitWarnHasNoAssault:  ['action', 'name', 'list'],
    transmitWarnNoneNoAssault: ['action', 'name'],
    transmitHit:       ['name', 'list'],
    transmitMiss:      ['name'],
    transmitNoneResult:['name'],
    transmitMissNoBounty:      ['name'],
    transmitNoneResultNoBounty:['name'],
    workAs:          ['job', 'map'],
    workAsShopkeeper:['job', 'map'],
  };

  // The panel's copy lives in js/i18n/<lang>/plugins/Empathize.json and is read
  // through the shared resolver, so there is no second loader and no boot race.
  // `_getT()` still returns an object, so every `T.key` and `T.template(a, b)`
  // call site is unchanged: a plain key resolves to its string, a key listed in
  // _TEMPLATE_FUNC_PARAMS to a function of those parameters. The object is also
  // callable, so `T('Empathize.x')` works inside the functions that shadow the
  // global resolver with it.
  const _T_PASSTHROUGH = ['has', 'list', 'pool', 'obj', 'n', 'param', 'language'];

  const _tAccessor = new Proxy(function (key, params) { return window.T(key, params); }, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (_T_PASSTHROUGH.indexOf(key) >= 0) return window.T[key].bind(window.T);
      const full = 'Empathize.' + key;
      const params = _TEMPLATE_FUNC_PARAMS[key];
      if (params) {
        return (...args) => {
          const p = {};
          params.forEach((name, i) => { p[name] = args[i] ?? ''; });
          return window.T(full, p);
        };
      }
      if (!window.T.has(full)) return undefined;
      // A bank key resolves to its pool, a grouped key to its subtree, so the
      // call sites that expect an array or an object keep getting one.
      const value = window.T.obj(full);
      if (Array.isArray(value)) return window.T.pool(full);
      if (value && typeof value === 'object') return value;
      return window.T(full);
    },
  });

  function _getT() { return _tAccessor; }

  // ============================================================================
  // SECTION 3, HELPERS
  // ============================================================================

  function _extractMarkovDb(event) {
    const m = (event?.event()?.note || '').match(/<markov:\s*([^>]+)>/i);
    return m ? m[1].trim() : null;
  }

  function _resolveMarkovDbFromSprite(ev) {
    const npcData = window.WorldGen?.NPCs;
    if (!npcData || !ev) return null;
    const charName = ev.event()?.characterName ?? ev.event()?.pages?.[0]?.image?.characterName;
    if (!charName) return null;
    if (npcData[charName]?.markovDB) return npcData[charName].markovDB;
    const base = charName.split('/').pop();
    for (const key of Object.keys(npcData)) {
      if (key.split('/').pop() === base) return npcData[key].markovDB ?? null;
    }
    return null;
  }

  function _resolveMarkovDb(eventId, profile) {
    if (profile?.markovDb) return profile.markovDb;
    const ev = $gameMap?.event(eventId);
    if (ev) {
      const tag = _extractMarkovDb(ev);
      if (tag) return tag;
      const spriteDb = _resolveMarkovDbFromSprite(ev);
      if (spriteDb) return spriteDb;
    }
    if (profile?.personalityIndex != null && window._NPCSocietyDataLoader?.personalities) {
      const pers = window._NPCSocietyDataLoader.personalities[profile.personalityIndex];
      if (pers?.name && PERSONALITY_DB_MAP[pers.name]) {
        const dbs = PERSONALITY_DB_MAP[pers.name];
        return Array.isArray(dbs) ? dbs[Math.floor(Math.random() * dbs.length)] : dbs;
      }
    }
    return 'npc';
  }

  // The name of whoever is standing at this event. A <Shop> counter is worked
  // in shifts, so the event is named after the fixture ("Shop") and the person
  // behind it changes three times a day: everything the panel says or files on
  // a society profile has to use the covering persona's name, not the sign.
  function _getNPCName(eventId) {
    const ev = $gameMap?.event(eventId);
    if (!ev) return '';
    return window.NPCSim?.npcNameForEvent?.(ev) ?? (ev.event()?.name?.trim() || '');
  }

  function _getProfile(npcName) {
    return window.NPCSocietyRegistry?.getProfile(npcName) ?? null;
  }

  // Finds the event a name refers to: the authored event name first (that is
  // what event commands are written against), then the person currently
  // covering a shop counter, so "Only" finds the till she is standing at.
  function _findEventByName(name) {
    const target = String(name ?? '').trim().toLowerCase();
    if (!target) return null;
    const events = $gameMap?.events() ?? [];
    return events.find(e => e?.event()?.name?.trim().toLowerCase() === target)
        ?? events.find(e => _getNPCName(e?.eventId()).toLowerCase() === target)
        ?? null;
  }

  // ── Social-interaction line bank (praise / joke / story / insult / ...) ──
  let _socialLinesDb = null;
  function _socialLines() {
    if (_socialLinesDb) return _socialLinesDb;
    if (window.NPC && window.NPC.SocialLines) { _socialLinesDb = window.NPC.SocialLines; return _socialLinesDb; }
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'js/db/NPC/SocialLines.json', false);
      xhr.send();
      if (xhr.status === 200 || xhr.status === 0) { _socialLinesDb = JSON.parse(xhr.responseText); return _socialLinesDb; }
    } catch (e) { console.warn('[NPCEmpathize] failed to load SocialLines.json', e); }
    _socialLinesDb = { interactions: [], performances: {}, jokes: {} };
    return _socialLinesDb;
  }
  function _socialById() {
    const db = _socialLines();
    if (!db._byId) { db._byId = {}; (db.interactions || []).forEach(i => (db._byId[i.id] = i)); }
    return db._byId;
  }
  const _rand = arr => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : '');

  // Debug/sandbox recruiting aid: force the party-join chance to 95% when the
  // player character (actor 1) is named "Test" or sandbox mode is active.
  function _forceHighJoinChance() {
    return ($gameActors?.actor(1)?.name?.() === 'Test') || !!$gameSystem?._isSandboxMode; // i18n-ignore: playtest character name
  }

  // How many lines an NPC said outside the panel (message-box dialogue) are kept
  // on their profile for replay in the chat tab.
  const SPOKEN_LOG_MAX = 12;

  // Party-join odds, the single source of truth for both the "(~N%)" label the
  // UI prints on the Join action and the roll _join() actually makes.
  // Disposition is the only input: neutral (opinion 0) is a coin flip, the curve
  // slides down toward JOIN_MIN as the NPC dislikes the focused party member and
  // up toward JOIN_MAX as they warm to them. Nothing else — level, class, etc. —
  // moves the odds in either direction; the UI's only other gates on Join
  // (party full, no self-switch-A page to fall through to) are mechanical
  // necessities, not difficulty factors.
  const JOIN_BASE = 50;   // chance at opinion 0
  const JOIN_MIN  = 5;
  const JOIN_MAX  = 95;
  function _joinChance(opinion, actor) {
    if (_forceHighJoinChance()) return JOIN_MAX;
    // opinion runs -100..+100, so 0.45/point lands exactly on JOIN_MIN/JOIN_MAX
    // at the extremes. Somebody who can make a case for themselves (Public
    // Speaking, specialization 218) gets a hearing the same goodwill would not
    // buy on its own, inside the same clamp. It is the member doing the talking
    // who has to make that case, which is whoever the switcher has focused.
    const persuasion = window.SpecializationXP
      ? (window.SpecializationXP.levelOf(actor, 'Public Speaking') - 1) * 4 : 0;
    const raw = JOIN_BASE + (Number(opinion) || 0) * 0.45 + persuasion;
    return Math.round(Math.max(JOIN_MIN, Math.min(JOIN_MAX, raw)));
  }

  // A recruit still has to be in the party's weight class: nobody more than
  // JOIN_LEVEL_MARGIN levels above the strongest member is willing to be led by
  // them, so Join is not offered at all for someone that far out of reach.
  const JOIN_LEVEL_MARGIN = 3;

  function _partyMaxLevel() {
    return ($gameParty?.members?.() ?? [])
      .reduce((max, member) => Math.max(max, member?.level ?? 1), 1);
  }

  // The 3-member cap counts whoever is still standing: a companion who fell and
  // was never brought back is left behind when somebody new signs on (see
  // NPCSystemParty.joinParty), so a corpse does not hold a slot against a
  // recruit and Join stops reporting a full party that no longer is one.
  function _travellingPartyCount() {
    const members = $gameParty?.members?.() ?? [];
    return members.filter((member, i) => i === 0 || !member?.isDead?.()).length;
  }

  function _joinLevelOk(npcLevel) {
    const level = Number(npcLevel);
    if (!Number.isFinite(level)) return true; // unknown level, never a blocker
    return level <= _partyMaxLevel() + JOIN_LEVEL_MARGIN;
  }

  function _extractClassId(ev) {
    const m = (ev?.event()?.note || '').match(/NPC-(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // True when the event has a page gated on self-switch A. Recruiting flips that
  // self-switch so the NPC stops standing on the map, which only works if there
  // is a page to fall through to — otherwise the recruit stays visible and the
  // player can walk up to a copy of a party member. This inspects the event's
  // static page CONDITIONS, not the runtime self-switch value: an earlier
  // version tested the value itself and wrongly hid Join all over the place.
  function _hasSelfSwitchAPage(eventId) {
    const pages = $gameMap?.event(eventId)?.event()?.pages;
    if (!Array.isArray(pages)) return false;
    return pages.some(p => p?.conditions?.selfSwitchValid && p.conditions.selfSwitchCh === 'A');
  }

  function _hasJoinPartyCommand(eventId) {
    const ev = $gameMap?.event(eventId);
    if (!ev) return false;
    const page = ev.page();
    if (!page?.list) return false;
    return page.list.some(cmd => cmd.code === 357 && cmd.parameters?.[1] === 'JoinParty');
  }

  function _resolveBustForActor(actor) {
    if (!actor) return 'img/busts/7.png';
    // The bust the rest of the game shows for this actor (set by character
    // creation, the sprite selector, or a preset dossier) wins over anything
    // derived from the walking sprite. ActorCharacterFields stores 0 when unset.
    const own = actor.vnBust ? actor.vnBust() : null;
    if (own && own !== '7' && own !== 0) return `img/busts/${own}.png`;
    const charName  = actor.characterName();
    const charIndex = actor.characterIndex();
    if (charName && window.Sprites?.SpritesAssociation) {
      const sa   = window.Sprites.SpritesAssociation;
      const bust = sa[charName.split('.')[0]]?.[charIndex];
      if (bust && bust !== '7') return `img/busts/${bust}.png`;
    }
    return 'img/busts/7.png';
  }

  // ── Event comment conventions shared with the dialogue box ──
  // DialogueSystem.js lets an event name its own bust with a comment holding a
  // single token (no spaces), e.g. a comment "Em" -> img/busts/Em.png. The panel
  // reads the very same comments so the portrait here matches the one the
  // message box shows, and additionally understands "Preset: <name>", which ties
  // the event to a character dossier from CharacterCreationPresets.js.

  // Comment text of the event's active page (codes 108/408), trimmed.
  function _eventCommentLines(event) {
    const data = event?.event?.();
    if (!data?.pages?.length) return [];
    let page = null;
    if (typeof event.meetsConditions === 'function')
      page = data.pages.find(p => event.meetsConditions(p)) || null;
    if (!page && typeof event.page === 'function') page = event.page() || null;
    if (!page) page = data.pages[0];
    if (!page?.list) return [];
    return page.list
      .filter(cmd => cmd.code === 108 || cmd.code === 408)
      .map(cmd => String(cmd.parameters?.[0] ?? '').trim())
      .filter(Boolean);
  }

  // Under NW.js the file can actually be checked, which keeps unrelated
  // single-word comments (flags left by other systems) from turning into a
  // broken portrait. In a browser build every path is assumed present and the
  // <img> onerror fallback catches misses.
  // Memoized: the panel re-renders on every keypress, and the same handful of
  // comment tokens would otherwise be stat()ed again each time.
  const _bustExistsCache = {};
  function _bustFileExists(name) {
    if (typeof Utils === 'undefined' || !Utils.isNwjs?.()) return true;
    if (name in _bustExistsCache) return _bustExistsCache[name];
    let exists = true;
    try {
      const fs   = require('fs');
      const path = require('path');
      exists = fs.existsSync(path.join(process.cwd(), 'img', 'busts', `${name}.png`));
    } catch (e) {
      exists = true;
    }
    _bustExistsCache[name] = exists;
    return exists;
  }

  function _bustNameFromEvent(event) {
    for (const line of _eventCommentLines(event)) {
      if (!line.includes(' ') && _bustFileExists(line)) return line;
    }
    return null;
  }

  // Dossier named by a "Preset: <name>" comment, matched by preset name.
  function _presetFromEvent(event) {
    const presets = window.CharacterPresets?.getCharacterPresets?.() ?? [];
    if (!presets.length) return null;
    for (const line of _eventCommentLines(event)) {
      const m = line.match(/^Preset\s*:\s*(.+)$/i);
      if (!m) continue;
      const wanted = m[1].trim().toLowerCase();
      const hit = presets.find(p => String(p.name ?? '').trim().toLowerCase() === wanted);
      if (hit) return hit;
    }
    return null;
  }

  function _resolveBustPath(npcName, event) {
    // A bust named in the event's comments wins, exactly as in the message box.
    const commentBust = _bustNameFromEvent(event);
    if (commentBust && commentBust !== '7') return `img/busts/${commentBust}.png`;
    const presetBust = _presetFromEvent(event)?.busts;
    if (presetBust && presetBust !== '7') return `img/busts/${presetBust}.png`;
    if (window.NPCSim?.getBustForNPC) {
      const b = window.NPCSim.getBustForNPC(npcName);
      if (b && b !== '7') return `img/busts/${b}.png`;
    }
    let charName  = event?.event()?.characterName  ?? event?.event()?.pages?.[0]?.image?.characterName;
    let charIndex = event?.event()?.characterIndex ?? event?.event()?.pages?.[0]?.image?.characterIndex ?? 0;
    // Remote NPC (no on-map event, opened from the wiki, web graph, or a
    // chat hyperlink): fall back to their template sprite from the pools.
    if (!charName && npcName && window.NPCSystem?.findTemplateSprite) {
      const tpl = window.NPCSystem.findTemplateSprite(npcName);
      if (tpl) { charName = tpl.characterName; charIndex = tpl.characterIndex; }
    }
    if (charName && window.Sprites?.SpritesAssociation) {
      const sa   = window.Sprites.SpritesAssociation;
      const bust = sa[charName.split('.')[0]]?.[charIndex];
      if (bust && bust !== '7') return `img/busts/${bust}.png`;
    }
    return 'img/busts/7.png';
  }

  // Everything a battle needs to wear this NPC's face: the bust the panel was
  // showing and the walking sprite they were standing there in. Both are read
  // here, while the event is still on the current map, because the fight starts
  // one scene later (SECTION 5c draws whichever the battler option calls for).
  function _buildBattleFace(npcName, event) {
    const bustPath  = _resolveBustPath(npcName, event) || 'img/busts/7.png';
    let charName    = (event?.characterName?.() || '');
    let charIndex   = (event?.characterIndex?.() ?? 0);
    // Remote NPC (no event on this map): fall back to their pool template, the
    // same way the portrait does.
    if (!charName && npcName && window.NPCSystem?.findTemplateSprite) {
      const tpl = window.NPCSystem.findTemplateSprite(npcName);
      if (tpl) { charName = tpl.characterName; charIndex = tpl.characterIndex ?? 0; }
    }
    return {
      name: npcName || '',
      // Stored as a bare file name: the battle loads it through ImageManager,
      // not as an <img> src.
      bust: bustPath.replace(/^img\/busts\//, '').replace(/\.png$/i, ''),
      charName,
      charIndex,
    };
  }

  function _extractContacts(profile, limit = 9) {
    if (!profile) return [];
    const counts = {};
    (profile.eventLog || [])
      .filter(e => e.tag === 'social')
      .forEach(e => {
        const n = (e.desc || '').replace(/^met /, '').trim();
        if (n) counts[n] = (counts[n] || 0) + 1;
      });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return (limit === Infinity ? entries : entries.slice(0, limit))
      .map(([name, count]) => ({ name, count }));
  }

  function _countRecentInteractions(profile, type, withinDays) {
    if (!profile?.eventLog?.length) return 0;
    const nowMin = $gameVariables?.value(114) ?? 0;
    const cutoff = nowMin - withinDays * 1440;
    return profile.eventLog.filter(e => e.tag === type && (e.gameMin ?? 0) >= cutoff).length;
  }

  function _lastInteractionDay(profile) {
    if (!profile?.eventLog?.length) return null;
    let latest = -Infinity;
    for (const e of profile.eventLog) {
      if ((e.gameMin ?? 0) > latest) latest = e.gameMin ?? 0;
    }
    if (latest < 0) return null;
    return Math.floor(latest / 1440);
  }

  // ============================================================================
  // SECTION 3b, PER-ACTOR PREDISPOSITION
  // ============================================================================

  // Trait + ideology compatibility bonus an NPC feels toward ONE actor. This is
  // the innate, unchanging part of a reputation (who you are), on top of the
  // earned per-actor base opinion (what you've done).
  function _traitCompatBonus(profile, actor) {
    const npcTraitIds         = new Set(profile?.traitIds ?? []);
    const allTraits           = window.Health?.Traits ?? [];
    const ideologies          = window._NPCSocietyDataLoader?.ideologies ?? [];
    const npcIdeology         = profile?.ideologyIndex != null ? ideologies[profile.ideologyIndex] : null;
    const npcIdeologyTraitIds = new Set(npcIdeology?.traits ?? []);
    const actorTraitIds       = (actor?._selectedTraits ?? []).map(t => t.id);

    let bonus = 0;
    for (const id of actorTraitIds) {
      if (npcTraitIds.has(id)) bonus += 15;
      if (npcIdeologyTraitIds.has(id)) bonus += 10;
      const def = allTraits.find(t => t.id === id);
      if (def?.incompatible) {
        for (const incompId of def.incompatible) {
          if (npcTraitIds.has(incompId)) bonus -= 20;
        }
      }
    }
    for (const npcId of npcTraitIds) {
      const def = allTraits.find(t => t.id === npcId);
      if (def?.incompatible) {
        for (const incompId of def.incompatible) {
          if (actorTraitIds.includes(incompId) && !npcIdeologyTraitIds.has(incompId)) {
            bonus -= 20;
          }
        }
      }
    }
    return bonus;
  }

  // ── Hygiene: who has washed, and who minds ──────────────────────────────
  // Standing close enough to talk means smelling the other person, so the state
  // of BOTH bodies moves the disposition: the party member doing the talking
  // (their hygiene need, TimeDateSystem) and the NPC (profile.hygiene, drained
  // by NPCSimulationCore and refilled at a sink or a WC). Recoiling from
  // somebody costs a conversation as much as being recoiled from does.
  //
  // It is felt hardest when courting: _romanceChance (NPCEmpathizeUI.js) reads
  // the same number a second time, at its own weight, on top of the disposition
  // this already dulled.
  //
  // Above HYGIENE_CLEAN nobody notices anything. Below it, every point costs.
  const HYGIENE_CLEAN       = 60;   // hygiene % at or above which nobody minds
  const HYGIENE_WEIGHT      = 0.42; // opinion points per point below the line
  const HYGIENE_MAX_PENALTY = 45;   // floor, however filthy both parties are

  // How much a trait makes the person CARRYING it mind the state of whoever is
  // standing in front of them (Traits.json ids). It is read on both sides: an
  // NPC's traits decide how much the party member offends them, the party
  // member's traits decide how much the NPC does. Multiplier on the penalty,
  // 0 means the smell never registers at all, above 1 means it registers twice
  // over. Several traits multiply together, and a single 0 wins outright.
  const HYGIENE_TRAIT_MULT = {
    // ── Does not register it ───────────────────────────────────────────────
    189: 0,    // Feral, raised in the wilderness: this is what people smell like
    195: 0,    // Lycanthrope, half of them lives downwind of the other half
    // ── Tolerates it ───────────────────────────────────────────────────────
    50:  0.25, // Ascetic, mortifying the flesh is rather the point
    124: 0.3,  // Street Urchin, grew up where nobody had a bath either
    184: 0.3,  // Cave Dweller
    97:  0.3,  // Survivalist, has been worse for longer
    130: 0.35, // Slave-Born
    137: 0.35, // Farmer, has spent the morning in the muck
    86:  0.4,  // Slothful, minds it but not enough to do anything about it
    27:  0.4,  // Hoarder, lives in worse and defends it
    136: 0.45, // Veteran, has slept in trenches with the same people for months
    // ── Minds it far more than most ────────────────────────────────────────
    91:  1.3,  // Proud, expects better company than this
    131: 1.4,  // Wealthy, has never had to be near it
    144: 1.5,  // Beautiful, keeps the company they believe they are owed
    30:  1.6,  // Perfectionist
    123: 1.7,  // Noble, raised to treat it as a moral failing
    56:  1.9,  // Hypochondriac, every unwashed body is a diagnosis
    78:  2.0,  // OCD
    23:  2.6,  // Germaphobe, the one trait this is really about
  };

  function _actorTraitIds(actor) {
    return (actor?._selectedTraits ?? []).map(t => t?.id).filter(id => id != null);
  }

  function _hygieneToleranceMult(traitIds) {
    let mult = 1;
    for (const id of traitIds || []) {
      const m = HYGIENE_TRAIT_MULT[id];
      if (m === undefined) continue;
      if (m === 0) return 0;
      mult *= m;
    }
    return Math.min(3, mult);
  }

  // One side's reaction to the other's state. Always <= 0.
  function _hygieneSidePenalty(hygienePct, perceiverTraitIds) {
    const raw   = Number(hygienePct ?? 100);
    if (!isFinite(raw)) return 0; // a meter nobody has written yet is not a smell
    const short = HYGIENE_CLEAN - Math.max(0, Math.min(100, raw));
    if (short <= 0) return 0;
    const mult = _hygieneToleranceMult(perceiverTraitIds);
    if (!mult) return 0;
    return -(short * HYGIENE_WEIGHT * mult);
  }

  // The two halves of the reading, in opinion points (each <= 0): `theirs` is
  // what the NPC makes of the party member, `mine` what the party member makes
  // of the NPC. Split out so the UI can say which of the two needs a bath.
  function _hygieneReadout(profile, actor) {
    if (!profile || !actor) return { theirs: 0, mine: 0 };
    const actorHyg = actor.hygienePercent ? actor.hygienePercent() : 100;
    return {
      theirs: _hygieneSidePenalty(actorHyg,        profile.traitIds ?? []),
      mine:   _hygieneSidePenalty(profile.hygiene, _actorTraitIds(actor)),
    };
  }

  // Both directions at once, in opinion points (always <= 0). `weight` lets a
  // caller ask for a harsher reading of the same two bodies.
  function _hygienePenalty(profile, actor, weight = 1) {
    const { theirs, mine } = _hygieneReadout(profile, actor);
    const total = theirs + mine;
    if (!total) return 0;
    return Math.round(Math.max(-HYGIENE_MAX_PENALTY, total * weight));
  }

  // ── Personality-driven social reactions ─────────────────────────────────
  // Same Praise/Insult/Joke/etc. lands with a different weight depending on
  // the NPC's PersonalityData.json archetype, on top of the tone-based math
  // in _socialInteract. Multiplier on the delta the interaction would
  // otherwise produce for that tone bucket (positive/neutral/negative).
  const PERSONALITY_SOCIAL_MODS = {
    Nervous:       { positive: 1.1, neutral: 1.0, negative: 1.3 },
    Calm:          { positive: 0.9, neutral: 1.0, negative: 0.7 },
    Aggressive:    { positive: 0.7, neutral: 0.9, negative: 1.4 },
    Melancholic:   { positive: 1.2, neutral: 0.9, negative: 1.1 },
    Sanguine:      { positive: 1.3, neutral: 1.1, negative: 0.9 },
    Cautious:      { positive: 0.8, neutral: 1.0, negative: 1.1 },
    Impulsive:     { positive: 1.1, neutral: 0.9, negative: 1.3 },
    Stoic:         { positive: 0.6, neutral: 0.8, negative: 0.6 },
    Paranoid:      { positive: 0.6, neutral: 0.9, negative: 1.3 },
    Empathetic:    { positive: 1.3, neutral: 1.1, negative: 1.1 },
    Authoritative: { positive: 0.8, neutral: 1.0, negative: 1.2 },
    Scholarly:     { positive: 0.9, neutral: 1.2, negative: 0.9 },
    Artistic:      { positive: 1.2, neutral: 1.1, negative: 1.0 },
    Adventurous:   { positive: 1.0, neutral: 1.2, negative: 0.9 },
    Nurturing:     { positive: 1.3, neutral: 1.1, negative: 0.8 },
    Mischievous:   { positive: 0.9, neutral: 1.2, negative: 0.7 },
    Cynical:       { positive: 0.5, neutral: 0.9, negative: 1.1 },
    Disciplined:   { positive: 0.8, neutral: 1.0, negative: 0.9 },
    Fatalistic:    { positive: 0.7, neutral: 0.8, negative: 0.8 },
    Grumpy:        { positive: 0.6, neutral: 0.8, negative: 1.3 },
    Loyal:         { positive: 1.2, neutral: 1.0, negative: 1.2 },
    Brave:         { positive: 0.9, neutral: 1.0, negative: 0.7 },
    Timid:         { positive: 1.2, neutral: 1.0, negative: 1.4 },
    Hedonistic:    { positive: 1.2, neutral: 1.2, negative: 0.8 },
    Apathetic:     { positive: 0.5, neutral: 0.6, negative: 0.6 },
  };
  function _personalityName(profile) {
    return window._NPCSocietyDataLoader?.personalities?.[profile?.personalityIndex]?.name || null;
  }
  function _personalitySocialMult(profile, tone) {
    const mods = PERSONALITY_SOCIAL_MODS[_personalityName(profile)];
    return mods ? (mods[tone] ?? 1) : 1;
  }

  // ── Em: how the world treats the witch who fed the spear ────────────────
  // Em's memories were forged into the Lance of Memory, the weapon that killed
  // the Father aspect of YHWH, and every sacred spell in the world died with
  // him (docs/Lore.odt). She is famous for it, so almost nobody meets her as a
  // person: the devout blame her, most people just want her to be famous
  // somewhere else, and the ones who are warm are usually warm about the story
  // rather than the woman. All of it is gated on Switch 48 (set by her dossier)
  // AND on Em being the party member actually doing the talking, so an ordinary
  // playthrough never sees any of it. Lines and numbers live in the "em" block
  // of js/db/NPC/SocialLines.json.
  const EM_SWITCH   = 48;
  const EM_NAME     = 'Em';       // i18n-ignore: actor name, matched at runtime
  const BUBBA_NAME  = 'Bubba';    // i18n-ignore: actor name, matched at runtime
  const TRAIT_DEVOUT = 116;
  // Factions that answer to a god, or are one: the Gods themselves, the
  // libertarian gods, and the Vatican's three arms (WorldGen/Factions.json).
  const EM_ZEALOT_FACTIONS = new Set([18, 24, 27, 28, 29]);

  // Default reaction per PersonalityData.json archetype. Zealotry is layered on
  // top of this by belief, not by temperament.
  const EM_STANCE_BY_PERSONALITY = {
    Nervous: 'gawker',      Calm: 'gawker',        Aggressive: 'annoyed',
    Melancholic: 'gawker',  Sanguine: 'fan',       Cautious: 'gawker',
    Impulsive: 'fan',       Stoic: 'annoyed',      Paranoid: 'annoyed',
    Empathetic: 'genuine',  Authoritative: 'annoyed', Scholarly: 'gawker',
    Artistic: 'fan',        Adventurous: 'clout',  Nurturing: 'genuine',
    Mischievous: 'fan',     Cynical: 'annoyed',    Disciplined: 'annoyed',
    Fatalistic: 'gawker',   Grumpy: 'annoyed',     Loyal: 'clout',
    Brave: 'clout',         Timid: 'gawker',       Hedonistic: 'fan',
    Apathetic: 'annoyed',
  };

  function _emHash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Is this playthrough Em's? Switch 48 is set by her dossier when creation
  // ends, so it also survives her being handed the party lead later.
  function _emPlaythrough() {
    return !!window.$gameSwitches?.value(EM_SWITCH);
  }
  function _isEmActor(actor) {
    return !!actor && actor.name() === EM_NAME && _emPlaythrough();
  }
  function _emPartyActor() {
    return ($gameParty?.members() ?? []).find(m => m && m.name() === EM_NAME) || null;
  }
  // Bubba is the exception to all of it: the man she shares the camper with.
  // Matched by event name or by a "Preset: Bubba" comment on the event.
  function _isBubbaNpc(npcName, event) {
    if (String(npcName || '').trim().toLowerCase() === BUBBA_NAME.toLowerCase()) return true;
    const preset = event ? _presetFromEvent(event) : null;
    return String(preset?.name || '').trim().toLowerCase() === BUBBA_NAME.toLowerCase();
  }

  function _emDb() { return _socialLines().em || {}; }

  // Which reaction this NPC has to Em. Stable per NPC (hashed from the name),
  // and stamped onto the profile the first time it is resolved so the rest of
  // the panel, and later visits, agree with what was said the first time.
  function _emStanceKey(profile, npcName, event) {
    if (_isBubbaNpc(npcName, event)) return 'bubba';
    if (profile?._emStance) return profile._emStance;

    const roll = _emHash(npcName || '');
    let key;
    const traitIds = profile?.traitIds ?? [];
    const devout   = traitIds.includes(TRAIT_DEVOUT);
    const dl       = window._NPCSocietyDataLoader;
    const ideology = profile?.ideologyIndex != null ? dl?.ideologies?.[profile.ideologyIndex] : null;
    const theocrat = /theocra/i.test(String(ideology?.id ?? ideology?.name ?? ''));
    const persName = _personalityName(profile);
    if (devout || theocrat || EM_ZEALOT_FACTIONS.has(profile?.factionIndex)) {
      key = 'zealot';
    } else {
      key = EM_STANCE_BY_PERSONALITY[persName] || 'gawker';
      // Word travels: one stranger in five has already decided she is what
      // killed their god, whatever their temperament says.
      if ((roll % 5) === 0) key = 'zealot';
      // Being met as a person is the rare case, even from the warm ones.
      else if (key === 'genuine' && (roll % 3) !== 0) key = 'clout';
    }
    // Only remember a stance that was decided on real data: the society data
    // loader finishes asynchronously, and a personality-less fallback must not
    // freeze this NPC as a gawker for the rest of the world's life.
    if (profile && (persName || key === 'zealot')) profile._emStance = key;
    return key;
  }

  function _emStanceData(key) {
    const db = _emDb();
    return (key === 'bubba' ? db.bubba : db.stances?.[key]) || null;
  }

  // The reaction in play right now, or null when this is not an Em interaction.
  // `actor` is the party member doing the talking, not merely a member.
  function _emContext(profile, npcName, event, actor) {
    if (!_isEmActor(actor)) return null;
    const key  = _emStanceKey(profile, npcName, event);
    const data = _emStanceData(key);
    return data ? { key, data, bubba: key === 'bubba' } : null;
  }

  // First impression: the standing Em starts from with an NPC she has never
  // spoken to. Written once into her own per-actor entry, so everything after
  // it is earned normally and nothing re-seeds on a later visit.
  function _emSeedFirstImpression(profile, npcName, event) {
    if (!profile || !_emPlaythrough()) return;
    const em = _emPartyActor();
    if (!em) return;
    const actorId = em.actorId();
    if (profile.opinions && profile.opinions[actorId] != null) return;
    const key  = _emStanceKey(profile, npcName, event);
    const data = _emStanceData(key);
    if (!data) return;
    // Bubba's 90 is who he is to her, not a modifier on how the world feels.
    const base = key === 'bubba'
      ? data.opinion
      : (profile.playerOpinion ?? 0) + (data.opinion ?? 0);
    _setNpcBaseOpinion(profile, actorId, base);
  }

  // Tone scaling for a stance block (Em's stances, Bubba's admiration).
  function _stanceToneMult(ctx, tone) {
    const mult = ctx?.data?.toneMult;
    return mult && mult[tone] != null ? mult[tone] : 1;
  }

  // ── Bubba: how the world treats the man who built the Liminal Engine ─────
  // The mirror image of Em's layer. She is famous for what was taken out of
  // her; he is famous for what he gave everybody back, so where her stance is
  // rolled per NPC, his is the same everywhere: admiration. While Bubba is the
  // party member doing the talking, every NPC starts from a higher opinion of
  // him, greets him as the Liminal Engine man, takes anything he says warmly,
  // and hears him answer modestly. Nothing hostile is on the table and nothing
  // romantic either, except with the bubbaromantic, who get one thing: turned
  // down. Gated on Switch 49 (his dossier's) or an actor named Bubba, so an
  // ordinary playthrough never sees any of it. Lines live in the "bubba" block
  // of js/db/NPC/SocialLines.json.
  const BUBBA_SWITCH = 49;

  function _bubbaPlaythrough() {
    if (window.$gameSwitches?.value(BUBBA_SWITCH)) return true;
    return ($gameParty?.members() ?? []).some(m => m && m.name() === BUBBA_NAME);
  }
  function _isBubbaActor(actor) {
    return !!actor && actor.name() === BUBBA_NAME && _bubbaPlaythrough();
  }
  function _bubbaDb() { return _socialLines().bubba || {}; }

  // The admiration in play right now, or null when this is not Bubba talking.
  // `actor` is the party member doing the talking, not merely a member.
  function _bubbaContext(actor) {
    if (!_isBubbaActor(actor)) return null;
    const data = _bubbaDb();
    return data && data.greeting ? { data } : null;
  }

  // The standing an NPC starts from with Bubba: their opinion of the party plus
  // the goodwill of never having queued for a coach that did not come. Written
  // once into his own per-actor entry, so everything after it is earned.
  function _bubbaSeedFirstImpression(profile, actor) {
    if (!profile || !_isBubbaActor(actor)) return;
    const actorId = actor.actorId();
    if (profile.opinions && profile.opinions[actorId] != null) return;
    const bonus = Number(_bubbaDb().opinionBonus);
    if (!bonus) return;
    _setNpcBaseOpinion(profile, actorId, (profile.playerOpinion ?? 0) + bonus);
  }

  // ── Per-actor NPC reputation ────────────────────────────────────────────
  // Each party member earns their OWN standing with a given NPC, stored in
  // profile.opinions[actorId]. profile.playerOpinion stays as the party-wide
  // baseline the rest of the NPC sim consumes (conversation, decay, politics)
  // and seeds each per-actor value the first time it is touched.
  function _npcBaseOpinion(profile, actorId) {
    if (!profile) return 0;
    const map = profile.opinions;
    if (map && map[actorId] != null) return map[actorId];
    return profile.playerOpinion ?? 0;
  }
  function _setNpcBaseOpinion(profile, actorId, value) {
    if (!profile || actorId == null) return 0;
    const v = Math.max(-100, Math.min(100, Math.round(value)));
    (profile.opinions ??= {})[actorId] = v;
    return v;
  }

  // ── Company: the social meter follows the opinion ────────────────────────
  // Every Empathize action that moves an NPC's opinion is also time spent in
  // company, and the whole party is standing there for it: a move that lands
  // well feeds everyone's social need, one that lands badly costs them. The
  // member doing the talking is the one who actually had the exchange, so they
  // take slightly more of it either way. Reported through the same
  // ParchmentToast.need popup the minigames use for Fun.
  const SOCIAL_PER_OPINION  = 2.2;  // social points per point of opinion moved
  const SOCIAL_LOSS_FACTOR  = 0.32; // a move that lands badly costs what it always did
  const SOCIAL_MAX_STEP     = 30;   // no single exchange is worth more than this
  const SOCIAL_TALKER_BONUS = 1.4;
  // Being with people is worth something on its own, whatever it did to their
  // opinion, so every exchange also pays a flat base: a trade, a bandage or a
  // question that moves no needle still counts as company. The base thins out
  // over the day with the SAME person and stops after SOCIAL_COMPANY_LIMIT
  // exchanges, so one obliging neighbour cannot be farmed for a full meter.
  const SOCIAL_COMPANY_BASE  = 6;
  const SOCIAL_COMPANY_LIMIT = 6;
  // The actions whose whole effect is elsewhere (a shop, a heal, a signpost),
  // so nothing else would ever pay them their company.
  const COMPANY_ACTIONS = new Set(['trade', 'treat', 'directions', 'buyHouse']);

  // What one more exchange with this NPC is worth as company today, spending it
  // off their daily allowance as it is read.
  function _companyBase(profile) {
    const day  = Math.floor(($gameVariables?.value(114) ?? 0) / 1440);
    const host = profile || $gameSystem; // wiki / party pages share one record
    if (!host) return SOCIAL_COMPANY_BASE;
    if (host._socialCompany?.day !== day) host._socialCompany = { day, count: 0 };
    const used = host._socialCompany.count++;
    if (used >= SOCIAL_COMPANY_LIMIT) return 0;
    return Math.max(1, Math.round(SOCIAL_COMPANY_BASE * (1 - used / SOCIAL_COMPANY_LIMIT)));
  }

  function _socialStep(value) {
    const v = Math.max(-SOCIAL_MAX_STEP, Math.min(SOCIAL_MAX_STEP, value));
    return v > 0 ? Math.max(1, Math.round(v)) : Math.min(-1, Math.round(v));
  }

  function _paySocial(actorId, step) {
    if (!step || !window.PartyNeeds?.addSocialToAll) return;
    const focus = ($gameParty?.members() ?? []).find(m => m && m.actorId() === actorId) || null;
    window.PartyNeeds.addSocialToAll(step, { focus, focusBonus: SOCIAL_TALKER_BONUS });
    try {
      window.ParchmentToast?.need('social', step);
    } catch (e) { /* a popup never breaks a conversation */ }
  }

  // Company on its own, for the actions that never touch an opinion: haggling,
  // wounds patched up, asking the way, a line typed into the chat box.
  function _gainSocialFromCompany(actorId, profile) {
    _paySocial(actorId, _companyBase(profile));
  }

  function _gainSocialFromOpinion(actorId, delta, profile) {
    if (!window.PartyNeeds?.addSocialToAll) return;
    const moved = delta > 0 ? delta * SOCIAL_PER_OPINION
      : delta < 0 ? delta * SOCIAL_PER_OPINION * SOCIAL_LOSS_FACTOR
      : 0;
    // An exchange that went badly is not company, it is a scene: no base for it.
    const base = delta >= 0 ? _companyBase(profile) : 0;
    const step = base + (moved ? _socialStep(moved) : 0);
    _paySocial(actorId, Math.max(-SOCIAL_MAX_STEP, Math.min(SOCIAL_MAX_STEP, Math.round(step))));
  }

  function _addNpcOpinion(profile, actorId, delta) {
    _gainSocialFromOpinion(actorId, delta, profile);
    return _setNpcBaseOpinion(profile, actorId, _npcBaseOpinion(profile, actorId) + delta);
  }
  // What the NPC actually thinks of one actor: earned base + trait
  // compatibility + how the two of them smell to each other right now. The
  // hygiene term is the only part of this that changes with a bath.
  function _npcEffectiveOpinion(profile, actor) {
    if (!actor) return 0;
    return Math.max(-100, Math.min(100,
      _npcBaseOpinion(profile, actor.actorId())
      + _traitCompatBonus(profile, actor)
      + _hygienePenalty(profile, actor)));
  }

  function _computePartyPredisposition(profile) {
    return ($gameParty?.members() ?? []).map(actor => ({
      actor,
      score: _npcEffectiveOpinion(profile, actor),
    }));
  }

  // Retained for API compatibility; interaction logic now targets the focused
  // actor's own reputation instead of a party-wide median.
  function _medianScore(preds) {
    if (!preds.length) return 0;
    const sorted = preds.map(p => p.score).sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }

  function _generatePartyThoughts(actor, _profile) {
    const thoughts = [];
    const hp     = Math.round((actor.hpRate?.() ?? 1) * 100);
    const hunger = actor.hungerPercent?.() ?? 100;
    const sleep  = actor.sleepPercent?.()  ?? 100;
    if (hp     < 30) thoughts.push(T('Empathize.partyThought.hurt'));
    if (hunger < 25) thoughts.push(T('Empathize.partyThought.hungry'));
    if (sleep  < 25) thoughts.push(T('Empathize.partyThought.tired'));
    if (!thoughts.length) thoughts.push(T('Empathize.partyThought.idle'));
    return thoughts;
  }

  // ============================================================================
  // SECTION 4, INPUT PASSTHROUGH PATCH
  // ============================================================================

  const _Input_shouldPreventDefault_base = Input._shouldPreventDefault;
  Input._shouldPreventDefault = function (keyCode) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return false;
    return _Input_shouldPreventDefault_base.call(this, keyCode);
  };

  // ============================================================================
  // SECTION 5, SCENE RESUME HOOK
  // ============================================================================

  const _Scene_Map_update_dlg = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update_dlg.call(this);
    if ($gameTemp._NPCEmpathizeReturnEvId != null) {
      const _safeEvId = $gameTemp._NPCEmpathizeReturnEvId;
      // Deferred tidy-up of the event the panel was launched from. The launch
      // event's paused interpreter and its starting flag were already cleared
      // synchronously in _releaseEventLock, so this pass exists ONLY to release a
      // lock that nothing else will ever release (a panel closed by an unusual
      // path).
      //
      // It must never clear _starting. This runs at the END of Scene_Map.update,
      // i.e. AFTER player input has been processed, so any _starting flag standing
      // here belongs to a BRAND NEW interaction the player just began, never to
      // the closed panel. Plenty of code queues a start without consuming it in
      // the same frame (a world-map Teleport, an event-touch trigger, a start
      // queued behind another starting event, the sit-mode re-check), and the
      // engine picks all of those up in Game_Map.updateInterpreter on the next
      // frame. Wiping the flag here is what made an NPC, or the next NPC walked
      // up to, silently refuse to talk right after the panel closed. The engine
      // can never be wedged by a stray _starting either: setupStartingMapEvent
      // consumes one every single frame, so leaving it alone is always safe.
      //
      // The lock is only released on a quiet frame (no interpreter running,
      // nothing starting), so the lock let go of is never one belonging to a
      // conversation that is live right now.
      const _interp = $gameMap?._interpreter;
      const _quiet  = !!$gameMap && !_interp?.isRunning() && !$gameMap.isAnyEventStarting();
      if (_quiet) {
        const _ev = $gameMap.event(_safeEvId);
        if (_ev && _ev._locked) _ev.unlock();
        $gameTemp._NPCEmpathizeReturnEvId     = null;
        $gameTemp._NPCEmpathizeReturnFrames   = 0;
      } else {
        // Someone is talking. Give them room, but give up before the id goes
        // stale: NPCSystem recycles event slots, so an id held too long stops
        // meaning the NPC the panel was opened on.
        $gameTemp._NPCEmpathizeReturnFrames = ($gameTemp._NPCEmpathizeReturnFrames ?? 0) + 1;
        if ($gameTemp._NPCEmpathizeReturnFrames > 120) {
          $gameTemp._NPCEmpathizeReturnEvId   = null;
          $gameTemp._NPCEmpathizeReturnFrames = 0;
        }
      }
    }
    if ($gameTemp._NPCEmpathizeTalkId != null) {
      const evId = $gameTemp._NPCEmpathizeTalkId;
      $gameTemp._NPCEmpathizeTalkId = null;
      $gameTemp._NPCEmpathizeBypass = true;
      try { $gameMap.event(evId)?.start(); }
      catch (e) { console.error('[NPCEmpathize] resume Talk failed', evId, e); }
    }
    if ($gameTemp._NPCEmpathizeOpenTrade) {
      const { goods, sellFactor } = $gameTemp._NPCEmpathizeOpenTrade;
      $gameTemp._NPCEmpathizeOpenTrade = null;
      $gameTemp._npcTradeSellFactor    = sellFactor;
      SceneManager.push(Scene_Shop);
      SceneManager.prepareNextScene(goods, false);
    }
    if ($gameTemp._NPCEmpathizeStartBattle != null) {
      const troopId = $gameTemp._NPCEmpathizeStartBattle;
      const victim  = $gameTemp._NPCEmpathizeAttackTarget;
      const face    = $gameTemp._NPCEmpathizeAttackFace;
      $gameTemp._NPCEmpathizeStartBattle  = null;
      $gameTemp._NPCEmpathizeAttackTarget = null;
      $gameTemp._NPCEmpathizeAttackFace   = null;
      BattleManager.setup(troopId, true, false);
      // Armed after setup on purpose: the setup hook in SECTION 5b clears both
      // markers, so a battle begun any other way can never inherit this victim
      // or wear their face.
      $gameTemp._NPCEmpathizeBattleTarget = victim ?? null;
      $gameTemp._NPCEmpathizeBattleFace   = face ?? null;
      SceneManager.push(Scene_Battle);
    }
  };

  // ============================================================================
  // SECTION 5b, OUTCOME OF AN ATTACKED NPC
  // ============================================================================
  // Killing the NPC the player set on from the panel flips that event's self
  // switch A, the same page swap a recruited NPC gets, so the map author decides
  // what is left standing there (a corpse page, an empty one, nothing). Only a
  // kill counts: fleeing the fight, or being beaten by them, leaves the NPC and
  // their page exactly as they were.

  const _BattleManager_setup_npcAttack = BattleManager.setup;
  BattleManager.setup = function (troopId, canEscape, canLose) {
    if ($gameTemp) {
      $gameTemp._NPCEmpathizeBattleTarget = null;
      $gameTemp._NPCEmpathizeBattleFace   = null;
    }
    _BattleManager_setup_npcAttack.call(this, troopId, canEscape, canLose);
  };

  const _BattleManager_processVictory_npcAttack = BattleManager.processVictory;
  BattleManager.processVictory = function () {
    const victim = $gameTemp?._NPCEmpathizeBattleTarget;
    if (victim) {
      $gameTemp._NPCEmpathizeBattleTarget = null;
      // A win is not always a kill: an enemy that runs off leaves the troop
      // with nobody alive in it and still ends the fight in victory. Bodies
      // only, so an NPC who got away is still there to be found.
      const troop  = $gameTroop?.members() ?? [];
      const killed = troop.length > 0 && troop.every(e => e.hp <= 0);
      if (killed && $gameSelfSwitches) {
        $gameSelfSwitches.setValue([victim.mapId, victim.eventId, 'A'], true);
        if ($gameMap?.mapId() === victim.mapId) $gameMap.event(victim.eventId)?.refresh();
      }
    }
    _BattleManager_processVictory_npcAttack.call(this);
  };

  // ============================================================================
  // SECTION 5c, THE NPC'S OWN FACE IN THE FIGHT
  // ============================================================================
  // A fight picked from the panel is against somebody the player was just
  // looking at, not against the generic battler the troop happens to hold, so
  // the enemy's own graphic is stood down and the NPC is drawn in its place,
  // standing ON the bottom edge of the screen with nothing under them:
  //   3D battlers (and plain 2D)  ->  the bust the panel was showing.
  //   Sprite battlers             ->  their walking sprite off the map.
  // The portrait is a sibling of the battler sprites inside the battle field,
  // the same place damage popups and battle animations live, and those are
  // positioned from the (hidden) enemy sprite, so they still land on the NPC.

  const FACE_MAX_W    = 0.55; // a bust may take this much of the screen width
  const FACE_MAX_H    = 0.95; // ...and this much of its height
  const FACE_SPRITE_H = 0.60; // a walking sprite is blown up to this much of it
  const FACE_FADE     = 12;   // opacity step of the fade in / death fade
  const FACE_PATTERNS = [0, 1, 2, 1];
  const FACE_PAT_WAIT = 15;   // frames per walking-sprite pattern

  // Sprites mode (enemyBattlers === 2), with the legacy flag honoured for
  // configs written before the option became a three-way.
  function _isSpriteBattlerMode() {
    if (typeof ConfigManager === 'undefined') return false;
    return ConfigManager.enemyBattlers === 2 || !!ConfigManager.charBasedSprites;
  }

  // Clickable, because the enemy sprite it stands in for is hidden and mouse
  // targeting goes through the sprite the pointer is over.
  class Sprite_NPCBattleFace extends Sprite_Clickable {
    constructor(face, battler, enemySprite) {
      super();
      this._face        = face;
      this._battler     = battler;
      this._enemySprite = enemySprite || null;
      this._charMode    = _isSpriteBattlerMode() && !!face.charName;
      this._laidOut     = false;
      this._pattern     = 0;
      this._patternWait = 0;
      this._selectCount = 0;
      this._fellBack    = false;
      this.anchor.x = 0.5;
      this.anchor.y = 1;   // the image hangs off its own bottom edge
      this.opacity  = 0;
      this.bitmap   = this._charMode
        ? ImageManager.loadCharacter(this._face.charName)
        : ImageManager.loadBitmap('img/busts/', this._face.bust);
    }

    // Size once the bitmap is in: a bust is fitted to the screen, a walking
    // sprite is blown up by a whole number so its pixels stay square.
    _layout() {
      const bmp = this.bitmap;
      if (!bmp || !bmp.isReady() || !bmp.width || !bmp.height) return false;
      if (this._charMode) {
        const big = ImageManager.isBigCharacter(this._face.charName);
        this._pw  = bmp.width  / (big ? 3 : 12);
        this._ph  = bmp.height / (big ? 4 : 8);
        this._blockX = big ? 0 : (this._face.charIndex % 4) * 3;
        this._blockY = big ? 0 : Math.floor(this._face.charIndex / 4) * 4;
        const k = Math.max(2, Math.floor((Graphics.height * FACE_SPRITE_H) / this._ph));
        this.scale.x = this.scale.y = k;
        this._drawW  = this._pw * k;
        this._setPatternFrame();
      } else {
        const k = Math.min((Graphics.width  * FACE_MAX_W) / bmp.width,
                           (Graphics.height * FACE_MAX_H) / bmp.height);
        this.scale.x = this.scale.y = k;
        this._drawW  = bmp.width * k;
        this.setFrame(0, 0, bmp.width, bmp.height);
      }
      return true;
    }

    // Facing down, the way the player was looking at them a moment ago.
    _setPatternFrame() {
      this.setFrame((this._blockX + FACE_PATTERNS[this._pattern]) * this._pw,
                    this._blockY * this._ph, this._pw, this._ph);
    }

    _updatePattern() {
      if (++this._patternWait < FACE_PAT_WAIT) return;
      this._patternWait = 0;
      this._pattern = (this._pattern + 1) % FACE_PATTERNS.length;
      this._setPatternFrame();
    }

    // Bottom edge flush with the bottom of the screen, held over the enemy
    // sprite's column so popups and animations keep meeting the portrait, and
    // clamped so no part of it runs off the side.
    _place() {
      const field = this.parent;
      const fx    = field ? field.x : 0;
      const fy    = field ? field.y : 0;
      const half  = (this._drawW || 0) / 2;
      const x     = this._enemySprite ? this._enemySprite.x : (Graphics.width / 2 - fx);
      const min   = half - fx;
      const max   = Graphics.width - half - fx;
      this.x = max > min ? Math.min(Math.max(x, min), max) : x;
      this.y = Graphics.height - fy;
    }

    _updateOpacity() {
      const gone = !this._battler || this._battler.isDead() || !this._battler.isAppeared();
      this.opacity = gone
        ? Math.max(0,   this.opacity - FACE_FADE)
        : Math.min(255, this.opacity + FACE_FADE);
    }

    // The drawn frame, in the sprite's own unscaled coordinates. The inherited
    // test reads this.width, which PIXI reports already multiplied by the scale
    // the portrait is blown up by, and would answer for a rectangle several
    // times too big.
    hitTest(x, y) {
      const w = this._charMode ? (this._pw || 0) : (this.bitmap?.width  || 0);
      const h = this._charMode ? (this._ph || 0) : (this.bitmap?.height || 0);
      return x >= -w / 2 && x < w / 2 && y >= -h && y < 0;
    }

    onMouseEnter() { $gameTemp.setTouchState(this._battler, 'select'); }
    onPress()      { $gameTemp.setTouchState(this._battler, 'select'); }

    // The blink the enemy sprite would have shown while it is the chosen target.
    _updateSelection() {
      if (this._battler?.isSelected?.()) {
        this._selectCount++;
        this.setBlendColor(this._selectCount % 30 < 15 ? [255, 255, 255, 64] : [0, 0, 0, 0]);
      } else if (this._selectCount > 0) {
        this._selectCount = 0;
        this.setBlendColor([0, 0, 0, 0]);
      }
    }

    update() {
      super.update();
      // A dossier can name a bust that was never drawn; fall back to the
      // house portrait rather than leaving an empty rectangle standing there.
      if (!this._fellBack && !this._charMode && this.bitmap?.isError?.()) {
        this._fellBack = true;
        this.bitmap = ImageManager.loadBitmap('img/busts/', '7');
        return;
      }
      if (!this._laidOut) {
        if (!this._layout()) return;
        this._laidOut = true;
      } else if (this._charMode) {
        this._updatePattern();
      }
      this._place();
      this._updateOpacity();
      this._updateSelection();
    }
  }

  const _Spriteset_Battle_createEnemies_face = Spriteset_Battle.prototype.createEnemies;
  Spriteset_Battle.prototype.createEnemies = function () {
    _Spriteset_Battle_createEnemies_face.call(this);
    this._npcFaceSprite  = null;
    this._npcFaceBattler = null;
    const face = $gameTemp?._NPCEmpathizeBattleFace;
    if (!face) return;
    // The panel fights one person, the first member of the troop it set up.
    const battler = $gameTroop.members()[0];
    if (!battler) return;
    const src = (this._enemySprites || []).find(s => s && (s._battler || s._enemy) === battler);
    const sprite = new Sprite_NPCBattleFace(face, battler, src);
    this._battleField.addChild(sprite);
    this._npcFaceSprite  = sprite;
    this._npcFaceBattler = battler;
  };

  const _Spriteset_Battle_update_face = Spriteset_Battle.prototype.update;
  Spriteset_Battle.prototype.update = function () {
    _Spriteset_Battle_update_face.call(this);
    if (!this._npcFaceSprite) return;
    // Kept down rather than hidden once: the battler graphic reloads itself
    // whenever the enemy's image changes, and 3D mode can hand a sprite back.
    const src = this._npcFaceSprite._enemySprite;
    if (src && !src._hidden) src.hide();
    // 3D mode builds its model a tenth of a second into the battle. The NPC
    // wears their own face instead, so the model comes straight back off the
    // field the frame it appears.
    const sc3d = this._battle3DScene;
    if (sc3d && !sc3d._disposed && sc3d.getModel) {
      const idx = $gameTroop.members().indexOf(this._npcFaceBattler);
      if (idx >= 0 && sc3d.getModel(`enemy_${idx}`)) sc3d.removeModel(`enemy_${idx}`);
    }
  };

  // ============================================================================
  // SECTION 6, INPUT MANAGER
  // ============================================================================

  // How far one arrow / d-pad press scrolls a tab that has nothing to select,
  // and how fast a fully pulled trigger scrolls, in pixels per frame.
  const SCROLL_KEY_STEP  = 64;
  const TRIGGER_SPEED    = 26;
  const TRIGGER_DEADZONE = 0.15;

  const NPCEmpathizeInputManager = {
    _scene: null, _active: false,

    activate(scene)  { this._scene = scene; this._active = true; },
    deactivate()     { this._active = false; this._scene = null; },

    // L2/R2 scroll the open tab's pane, the controller's mouse wheel. MZ's
    // gamepadMapper does not cover the analog triggers (buttons 6/7), so they
    // are read raw through the shared AnalogStickInput helper.
    _updateTriggerScroll(scene) {
      const pads = window.AnalogStickInput;
      if (!pads || typeof pads.leftTrigger !== 'function') return;
      const pull   = v => (v > TRIGGER_DEADZONE ? (v - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE) : 0);
      const amount = (pull(pads.rightTrigger()) - pull(pads.leftTrigger())) * TRIGGER_SPEED;
      if (amount) scene._scrollActivePane?.(amount);
    },

    update() {
      if (!this._active || !this._scene) return;
      const scene = this._scene;
      // Scope to the live overlay so a stale/duplicate #menu-container copy can
      // never hand us the wrong input element.
      const inp   = scene._overlay?.querySelector('#npc-dlg-ask-input')
        || document.getElementById('npc-dlg-ask-input');

      // Chat input has DOM focus, pass ALL keys to the browser, no game
      // navigation at all. This MUST run before the cancel/escape handler:
      // MZ's keyMapper maps letter keys (X to escape, plus W/A/S/D to
      // directions) regardless of which DOM element is focused, so without
      // this early return, typing a word containing one of those letters
      // would fire Input.isTriggered('escape') and blur the field mid-word (#129).
      // Detect focus via the ACTIVE element's id (robust to duplicate ids).
      // While the chat modal is open the game loop stays fully out of the way,
      // no navigation, cancel, or tab cycling can steal focus from the field.
      if (scene._chatModalOpen) return;

      const ae = document.activeElement;
      scene._inputFocused = !!(ae && ae.id === 'npc-dlg-ask-input');
      if (scene._inputFocused) return;

      const cancelled = Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled();

      // While navigating a content grid, Cancel backs out one level (entry list
      // -> categories -> tab bar) instead of closing the whole panel.
      if (cancelled && scene._activeArea === 'content') {
        scene._contentBack();
        return;
      }

      // Cancel / escape, handled once the text field no longer has focus
      if (cancelled) {
        scene._leave();
        return;
      }

      // L2/R2 scroll whatever the open tab is showing, every frame they are held
      this._updateTriggerScroll(scene);

      // L1/R1 tab cycling, fires from anywhere in the scene. On a controller
      // this is the ONLY way to change tab: the d-pad and the stick stay inside
      // the tab that is open.
      if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
        const tabs = scene._tabOrder();
        const dir  = Input.isTriggered('pageup') ? -1 : 1;
        const cur  = tabs.indexOf(scene._activeTab);
        const next = (cur + dir + tabs.length) % tabs.length;
        scene._setTab(tabs[next]); // plays cursor SE, resets area/index, re-renders
        return;
      }

      // WASD hold-repeat simulation (matches MZ arrow-key timing)
      for (const dir of ['up', 'down', 'left', 'right']) {
        if (scene._wasdHeld[dir]) {
          scene._wasdHoldFrames[dir]++;
          const t = scene._wasdHoldFrames[dir];
          if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0)
            scene._wasdInput[dir] = true;
        } else {
          scene._wasdHoldFrames[dir] = 0;
        }
      }

      const isDown  = Input.isTriggered('down')  || Input.isRepeated('down')  || scene._wasdInput.down;
      const isUp    = Input.isTriggered('up')    || Input.isRepeated('up')    || scene._wasdInput.up;
      const isLeft  = Input.isTriggered('left')  || scene._wasdInput.left;
      const isRight = Input.isTriggered('right') || scene._wasdInput.right;
      scene._wasdInput.up = scene._wasdInput.down = scene._wasdInput.left = scene._wasdInput.right = false;

      const isChatTab = scene._activeTab === 'chat';
      const area      = scene._activeArea;

      // Directions never leave the open tab (L1/R1 does that). Inside a tab they
      // move between whatever it offers: the chat actions, the Wiki grid, or,
      // on a plain reading page with nothing to select, the page itself.
      if (area === 'tabs') {
        // On the tab bar itself Left/Right walk the tabs, so A and D (and the
        // d-pad) change tab without the shoulder buttons; Down/OK drops into
        // whatever the open tab holds.
        if (isLeft || isRight) {
          const tabs = scene._tabOrder();
          const cur  = tabs.indexOf(scene._activeTab);
          const next = (cur + (isRight ? 1 : -1) + tabs.length) % tabs.length;
          scene._setTab(tabs[next]); // plays cursor SE, resets area/index, re-renders
        } else if ((isDown || Input.isTriggered('ok')) && isChatTab) {
          SoundManager.playCursor();
          scene._activeArea = 'actions';
          scene._menuIndex  = 0;
          scene._updateSelectionHighlight();
        } else if ((isDown || Input.isTriggered('ok')) && scene._contentNavEnabled()) {
          // Drop into the in-panel grid (Wiki cards / entries).
          scene._enterContentArea();
        } else if (isUp || isDown) {
          scene._scrollActivePane?.(isUp ? -SCROLL_KEY_STEP : SCROLL_KEY_STEP);
        }

      } else if (area === 'content') {
        if (isUp) {
          // From the top row, fall back up to the tab bar.
          if (!scene._moveContent('up')) {
            SoundManager.playCursor();
            scene._activeArea = 'tabs';
            scene._updateSelectionHighlight();
          }
        } else if (isDown)  { scene._moveContent('down');
        } else if (isLeft)  { scene._moveContent('left');
        } else if (isRight) { scene._moveContent('right');
        } else if (Input.isTriggered('ok')) {
          scene._activateContent();
        }

      } else if (area === 'actions') {
        const btns  = scene._overlay?.querySelectorAll('.npc-chat-action-btn');
        const total = btns?.length ?? 0;
        const idx   = scene._menuIndex;

        if (isLeft && idx > 0) {
          scene._menuIndex = idx - 1;
          SoundManager.playCursor();
          scene._updateSelectionHighlight();
        } else if (isRight && idx < total - 1) {
          scene._menuIndex = idx + 1;
          SoundManager.playCursor();
          scene._updateSelectionHighlight();
        } else if (isUp) {
          SoundManager.playCursor();
          scene._activeArea = 'tabs';
          scene._menuIndex  = 0;
          scene._updateSelectionHighlight();
        } else if (isDown) {
          // The text field is reached through the "Free Chat" action, never by a
          // direction, so Down just reads further down the log.
          scene._scrollActivePane?.(SCROLL_KEY_STEP);
        } else if (Input.isTriggered('ok')) {
          const btn = btns?.[idx];
          if (btn && !btn.classList.contains('npc-action-disabled')) {
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          }
        }
      }
    },
  };

  // ============================================================================
  // SECTION 7, SCENE_NPCEmpathize
  // ============================================================================

  class Scene_NPCEmpathize extends Scene_MenuBase {
    constructor() {
      super();
      this._eventId        = Scene_NPCEmpathize._eventId;
      // The originating map event, frozen at open time. _eventId gets reassigned
      // by wiki hyperlink navigation (often to null for entity pages), so keep a
      // separate handle for releasing the paused map interpreter on close (#13).
      this._launchEventId  = Scene_NPCEmpathize._eventId;
      this._actorId        = Scene_NPCEmpathize._actorId;
      this._npcName        = Scene_NPCEmpathize._npcName;
      Scene_NPCEmpathize._npcName = null;
      // Wiki entity mode: {type:'nation'|'power'|'leader'|'artifact'|'faction', id}
      //, the panel becomes an encyclopedia page; chat is hidden entirely.
      this._entity         = Scene_NPCEmpathize._entity;
      Scene_NPCEmpathize._entity = null;
      this._entityTabs     = null;
      // selected category inside the Wiki index tab (openWiki can preselect)
      this._wikiCategory   = Scene_NPCEmpathize._initialWikiCategory ?? null;
      Scene_NPCEmpathize._initialWikiCategory = null;
      this._overlay        = null;
      this._menuIndex      = 0;
      this._menuItems      = [];
      this._chatActions    = [];
      this._justJoined     = false; // true after this NPC joins via the panel; hides Join
      this._activeTab      = Scene_NPCEmpathize._initialTab
        ?? (this._entity ? 'overview' : 'chat');
      Scene_NPCEmpathize._initialTab = null;
      this._activeArea     = 'tabs'; // 'tabs' | 'actions' | 'input' | 'content'
      this._contentIndex   = 0; // focused tile when navigating in-panel content (wiki)
      this._moreSubView    = null;
      this._chatHistory    = [];
      this._askDraft       = ''; // in-progress chat input text, survives re-renders
      this._inputFocused   = false;
      this._isTyping       = false;
      // Timestamp until which the chat log is held pinned to its newest message.
      this._chatPinUntil   = 0;
      this._chatModalOpen  = false; // chat text-entry modal visibility
      this._chatModalEl    = null;
      this._joinMessage    = null;
      this._stealMode          = false;
      this._stealItems         = [];
      this._stealAttempted     = {};
      this._giftMode           = false;
      this._giftItems          = [];
      this._bribeMode          = false;
      this._attackConfirm      = false;
      this._pickpocketConfirm  = false;
      this._transmitConfirm    = null;
      this._socialMode         = false;
      this._romanceMode        = false;
      this._directionsMode     = false;
      this._directionList      = [];
      this._focusActorIndex    = 0; // which party member is interacting
      this._lastSubject        = '';
      this._wasdInput      = { up: false, down: false, left: false, right: false };
      this._wasdHeld       = { up: false, down: false, left: false, right: false };
      this._wasdHoldFrames = { up: 0,     down: 0,     left: 0,     right: 0     };
      this._wasdListener   = null;
      this._wasdUpListener = null;
      this._disabledCanvases = [];
      this._tabBarEl       = null;
      this._leftEl         = null;
      this._rightEl        = null;
    }

    createBackground() {
      this._backgroundSprite = new Sprite(SceneManager.backgroundBitmap());
      this.addChild(this._backgroundSprite);
      this.setBackgroundOpacity(255);
    }

    create() {
      super.create();
      // Politicians, nations and artifacts can change between visits, rebuild
      // the wiki's hyperlink index whenever a panel opens.
      window.NPCEmpathize?.Wiki?.invalidate();
      const dummy = new Window_Base(new Rectangle(0, 0, 1, 1));
      dummy.visible = false;
      this.addWindow(dummy);

      this._savedShouldPreventDefault = Input._shouldPreventDefault;
      const _savedRef = this._savedShouldPreventDefault;
      Input._shouldPreventDefault = function (keyCode) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return false;
        return _savedRef.call(this, keyCode);
      };

      this._wasdListener = (ev) => {
        if (ev.repeat) return;
        const inp = document.getElementById('npc-dlg-ask-input');
        if (inp && document.activeElement === inp) return;
        const k = ev.key.toLowerCase();
        if (k === 'w') { this._wasdInput.up    = true; this._wasdHeld.up    = true; ev.preventDefault(); }
        if (k === 's') { this._wasdInput.down  = true; this._wasdHeld.down  = true; ev.preventDefault(); }
        if (k === 'a') { this._wasdInput.left  = true; this._wasdHeld.left  = true; ev.preventDefault(); }
        if (k === 'd') { this._wasdInput.right = true; this._wasdHeld.right = true; ev.preventDefault(); }
      };
      this._wasdUpListener = (ev) => {
        const k = ev.key.toLowerCase();
        if (k === 'w') { this._wasdHeld.up    = false; this._wasdHoldFrames.up    = 0; }
        if (k === 's') { this._wasdHeld.down  = false; this._wasdHoldFrames.down  = 0; }
        if (k === 'a') { this._wasdHeld.left  = false; this._wasdHoldFrames.left  = 0; }
        if (k === 'd') { this._wasdHeld.right = false; this._wasdHoldFrames.right = 0; }
      };
      window.addEventListener('keydown', this._wasdListener);
      window.addEventListener('keyup',   this._wasdUpListener);

      // ── Chat-input key guard ──────────────────────────────────────────────
      // Many always-on map plugins (FastTravel, TimeDate HUD, WorldMap, etc.)
      // attach their own global keydown handlers, several of which call
      // preventDefault on letters/space, so keystrokes never reach a focused
      // text field. This capture-phase listener runs BEFORE all of them: while
      // the chat box has focus it stops the event from reaching any other
      // handler (so none can preventDefault it) WITHOUT calling preventDefault
      // itself, leaving the browser's default character insertion intact. We
      // swallow the event before the input's own onkeydown can fire, so Enter /
      // Escape are reproduced here.
      this._chatKeyGuard = (ev) => {
        // Gate on the ACTUALLY focused element, not getElementById (which can
        // resolve a stale/duplicate overlay's input and make this a no-op).
        // Any focused text field means "the player is typing", so shield it.
        const ae = document.activeElement;
        if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA')) return;
        ev.stopImmediatePropagation();
        if (ev.type === 'keydown' && ae.id === 'npc-dlg-ask-input') {
          // Enter sends (Shift+Enter inserts a newline in the modal textarea);
          // Escape closes the modal, or blurs the legacy inline field.
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            if (this._chatModalOpen) this._submitChatModal();
            else this._submitAsk();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            if (this._chatModalOpen) this._closeChatModal();
            else ae.blur();
          }
        }
      };
      window.addEventListener('keydown',  this._chatKeyGuard, true);
      window.addEventListener('keyup',    this._chatKeyGuard, true);
      window.addEventListener('keypress', this._chatKeyGuard, true);

      document.querySelectorAll('canvas').forEach(c => {
        this._disabledCanvases.push({ el: c, orig: c.style.pointerEvents });
        c.style.pointerEvents = 'none';
      });

      NPCEmpathizeInputManager.activate(this);
      // Tab / bumper cycling of the focused (interacting) party member, using
      // the shared character-switcher helper (same as inventory/equip/biologics).
      window.CharSwitcher?.installTabKey?.(this, dir => this._cycleFocusActor(dir));
      // _buildOverlay and _render are called by NPCEmpathizeUI.js
    }

    // ── Em (Switch 48) ─────────────────────────────────────────────────────────
    // The reaction of the NPC this panel is open on to Em, or null when this is
    // not Em talking (see _emContext). Everything Em-specific hangs off this.
    _emCtx() {
      if (this._entity || this._actorId) return null; // wiki page / party member
      const npcName = _getNPCName(this._eventId) || this._npcName;
      if (!npcName) return null;
      return _emContext(
        _getProfile(npcName), npcName, $gameMap?.event(this._eventId), this._focusActor()
      );
    }

    // Seeds the NPC's standing with Em the first time they meet, then has them
    // open their mouth about it. Called from _renderInner (NPCEmpathizeUI.js)
    // once the chat backlog is in place and before the panel reads the opinion,
    // so the first impression is what it displays. Both halves are idempotent.
    _prepareEmMeeting() {
      if (this._entity || this._actorId) return;
      const npcName = _getNPCName(this._eventId) || this._npcName;
      if (!npcName || !_emPlaythrough()) return;
      _emSeedFirstImpression(_getProfile(npcName), npcName, $gameMap?.event(this._eventId));
      this._sayEmGreeting();
    }

    // The NPC's reaction to Em, appended as the newest line rather than pushed
    // at open time (a lone entry would suppress the chat backlog entirely). One
    // shot per focused member: handing the conversation over says it again.
    _sayEmGreeting() {
      if (this._emGreeted) return;
      const ctx = this._emCtx();
      if (!ctx) return;
      const line = _rand(ctx.data.greeting);
      if (!line) return;
      this._emGreeted = true;
      const npcName = _getNPCName(this._eventId) || this._npcName;
      this._chatHistory.push({ role: 'npc', text: String(line).replace(/\{name\}/g, npcName) });
      if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
    }

    // ── Bubba (Switch 49) ──────────────────────────────────────────────────────
    // The admiration this NPC meets Bubba with, or null when this is not Bubba
    // talking. Everything Bubba-specific hangs off this, exactly like _emCtx.
    _bubbaCtx() {
      if (this._entity || this._actorId) return null; // wiki page / party member
      const npcName = _getNPCName(this._eventId) || this._npcName;
      if (!npcName) return null;
      return _bubbaContext(this._focusActor());
    }

    // Seeds the NPC's standing with Bubba the first time they meet, then has
    // them say so. Called from _renderInner alongside _prepareEmMeeting; both
    // halves are idempotent, and only one of the two can ever be in play (they
    // are different party members doing the talking).
    _prepareBubbaMeeting() {
      if (this._entity || this._actorId) return;
      const npcName = _getNPCName(this._eventId) || this._npcName;
      if (!npcName) return;
      const actor = this._focusActor();
      if (!_isBubbaActor(actor)) return;
      _bubbaSeedFirstImpression(_getProfile(npcName), actor);
      this._sayBubbaGreeting();
    }

    _sayBubbaGreeting() {
      if (this._bubbaGreeted) return;
      const ctx = this._bubbaCtx();
      if (!ctx) return;
      const line = _rand(ctx.data.greeting);
      if (!line) return;
      this._bubbaGreeted = true;
      const npcName = _getNPCName(this._eventId) || this._npcName;
      this._chatHistory.push({ role: 'npc', text: String(line).replace(/\{name\}/g, npcName) });
      if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
    }

    update() {
      Scene_MenuBase.prototype.update.call(this);
      NPCEmpathizeInputManager.update();
    }

    terminate() {
      // Releasing the map first, before anything that could throw. If the panel
      // ever leaves without this running, the launch event's interpreter stays
      // "running" forever, $gameMap.isEventRunning() never goes false again, and
      // NO event on the map can be triggered from then on.
      this._releaseEventLock();
      try { this._closeChatModal?.(); } catch (e) { console.error('[NPCEmpathize] closeChatModal', e); }
      // A panel session owns the wiki back-stack. Leaving through Join, Attack,
      // Trade or a purchase used to leave entries on it, and the NEXT panel then
      // read Cancel as "go back" to a subject from a conversation that ended long
      // ago instead of closing.
      if (!SceneManager.isNextScene(Scene_NPCEmpathize)) Scene_NPCEmpathize._returnStack.length = 0;
      if (this._savedShouldPreventDefault) {
        Input._shouldPreventDefault = this._savedShouldPreventDefault;
        this._savedShouldPreventDefault = null;
      }
      (this._disabledCanvases || []).forEach(({ el, orig }) => { el.style.pointerEvents = orig; });
      this._disabledCanvases = [];
      if (this._wasdListener) {
        window.removeEventListener('keydown', this._wasdListener);
        window.removeEventListener('keyup',   this._wasdUpListener);
        this._wasdListener = this._wasdUpListener = null;
      }
      if (this._chatKeyGuard) {
        window.removeEventListener('keydown',  this._chatKeyGuard, true);
        window.removeEventListener('keyup',    this._chatKeyGuard, true);
        window.removeEventListener('keypress', this._chatKeyGuard, true);
        this._chatKeyGuard = null;
      }
      window.CharSwitcher?.removeTabKey?.(this);
      NPCEmpathizeInputManager.deactivate();
      this._removeOverlay();
      Scene_MenuBase.prototype.terminate.call(this);
    }

    // Stubs replaced by NPCEmpathizeUI.js
    _removeOverlay() {}
    _render() { console.error('[NPCEmpathize] _render not found, is NPCEmpathizeUI.js loaded?'); }

    // ── Tab ────────────────────────────────────────────────────────────────────

    // The live tab order, entity (wiki) pages define their own tab set and
    // never include the chat tab.
    _tabOrder() {
      if (this._entity) return this._entityTabs || ['overview'];
      return ['chat', 'info', 'background', 'routine', 'biologics', 'health', 'romance', 'web', 'lifeHistory', 'wiki', 'more'];
    }

    _setTab(tab) {
      if (this._activeTab === tab) return;
      SoundManager.playCursor();
      this._activeTab         = tab;
      this._activeArea        = 'tabs';
      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._attackConfirm     = false;
      this._pickpocketConfirm = false;
      this._transmitConfirm   = null;
      this._socialMode        = false;
      this._romanceMode       = false;
      this._directionsMode    = false;
      this._moreSubView       = null;
      this._wikiCategory      = null;
      this._menuIndex         = 0;
      this._contentIndex      = 0;
      this._webList           = null; // the social web rebuilds from the new profile
      this._render();
    }

    _setWikiCategory(category) {
      SoundManager.playCursor();
      this._wikiCategory = category || null;
      this._contentIndex = 0;
      this._render(); // innerHTML is rebuilt synchronously, so tiles exist below
      // When drilling into a category with the keyboard/controller, move the
      // focus past the "back" chip onto the first real entry.
      if (this._activeArea === 'content' && category) {
        const first = this._contentItems().findIndex(el => !el.classList.contains('npc-back-btn'));
        if (first > 0) { this._contentIndex = first; this._updateSelectionHighlight(); }
      }
    }

    _moreAction(id) {
      if (id === 'leave') { this._leave(); return; }
      SoundManager.playCursor();
      this._moreSubView = id;
      this._render();
    }

    _moreBack() {
      SoundManager.playCursor();
      this._moreSubView = null;
      this._render();
    }

    // ── Selection highlight ────────────────────────────────────────────────────

    _updateSelectionHighlight() {
      if (!this._overlay) return;
      const inActions = this._activeArea === 'actions';
      this._overlay.querySelectorAll('.npc-chat-action-btn').forEach((el, i) => {
        el.classList.toggle('npc-action-focused', inActions && i === this._menuIndex);
      });
      const inContent = this._activeArea === 'content';
      const items = this._contentItems();
      items.forEach((el, i) => {
        const on = inContent && i === this._contentIndex;
        el.classList.toggle('npc-content-focused', on);
        if (on) el.scrollIntoView({ block: 'nearest' });
      });
      if (this._tabBarEl)
        this._tabBarEl.classList.toggle('npc-tab-bar--focused', this._activeArea === 'tabs');
    }

    // ── In-panel content navigation (Wiki tab grids) ───────────────────────────

    // True when the active tab exposes a keyboard/controller-navigable grid.
    _contentNavEnabled() {
      return this._activeTab === 'wiki';
    }

    // The navigable tiles in the right panel, in DOM order. Covers the Wiki
    // category cards, the per-category entry tiles, and the "back" chip.
    _contentItems() {
      if (!this._contentNavEnabled() || !this._rightEl) return [];
      return Array.from(this._rightEl.querySelectorAll('.npc-wiki-card, .npc-wiki-entry, .npc-back-btn'));
    }

    _enterContentArea() {
      if (!this._contentItems().length) return false;
      this._activeArea  = 'content';
      this._contentIndex = 0;
      SoundManager.playCursor();
      this._updateSelectionHighlight();
      return true;
    }

    // Geometric grid move: pick the nearest tile in the pressed direction by
    // comparing element centres, so it works with the responsive auto-fill
    // grid (variable column count) without hard-coding a stride.
    _moveContent(dir) {
      const items = this._contentItems();
      if (!items.length) return false;
      const curEl = items[this._contentIndex] || items[0];
      const cur   = curEl.getBoundingClientRect();
      const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
      let best = -1, bestScore = Infinity;
      items.forEach((el, i) => {
        if (i === this._contentIndex) return;
        const r  = el.getBoundingClientRect();
        const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
        const dx = ex - cx, dy = ey - cy;
        let primary, cross;
        if (dir === 'left')       { if (dx >= -1) return; primary = -dx; cross = Math.abs(dy); }
        else if (dir === 'right') { if (dx <=  1) return; primary =  dx; cross = Math.abs(dy); }
        else if (dir === 'up')    { if (dy >= -1) return; primary = -dy; cross = Math.abs(dx); }
        else                      { if (dy <=  1) return; primary =  dy; cross = Math.abs(dx); }
        const score = primary + cross * 2; // cross-axis penalty keeps moves in-line
        if (score < bestScore) { bestScore = score; best = i; }
      });
      if (best === -1) return false;
      this._contentIndex = best;
      SoundManager.playCursor();
      this._updateSelectionHighlight();
      return true;
    }

    _activateContent() {
      const el = this._contentItems()[this._contentIndex];
      if (!el) return;
      SoundManager.playOk();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }

    // Back out one level of the Wiki: entry list -> category grid -> tab bar.
    _contentBack() {
      if (this._wikiCategory) {
        this._setWikiCategory(null); // re-renders the category grid, stays in 'content'
        return;
      }
      SoundManager.playCancel();
      this._activeArea = 'tabs';
      this._updateSelectionHighlight();
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    _runAction(id) {
      const item = (this._chatActions || []).find(a => a.id === id);
      if (!item) return;
      // Anything done face to face is another exposure. Cough/Spit/Bite are
      // deliberate and roll at full strength in _confirmTransmit; every other
      // action here (a gift, a trade, a joke, patching up their wounds) rolls
      // the same two-way exchange at a much lower chance.
      if (!['cough', 'spit', 'bite'].includes(id)) this._incidentalContact();
      switch (id) {
        case 'freeChat':   this._openChatModal(); break;
        case 'gift':       this._gift();        break;
        case 'bribe':      this._bribe();       break;
        case 'attack':     this._attack();      break;
        case 'pickpocket': this._pickpocket();  break;
        case 'trade':      this._trade();       break;
        case 'treat':      this._treatWounds(); break;
        case 'join':       this._join();        break;
        case 'buyHouse':   this._buyHouse();    break;
        case 'cough':      this._beginTransmit('airborne'); break;
        case 'spit':       this._beginTransmit('saliva');   break;
        case 'bite':       this._beginTransmit('bite');     break;
        case 'socialize':  this._socialize();   break;
        case 'romance':    this._romance();     break;
        case 'directions': this._askDirections(); break;
      }
      // These four never move an opinion, but haggling, being patched up, being
      // pointed at a door and buying a house off somebody are all time spent in
      // company, so they pay the social meter the same flat base an exchange does.
      if (COMPANY_ACTIONS.has(id)) this._gainCompany();
    }

    // Pay the focused member (and the party around them) for the company of the
    // NPC this panel is open on.
    _gainCompany() {
      _gainSocialFromCompany(this._focusActor()?.actorId(),
        _getProfile(_getNPCName(this._eventId)));
    }

    // Incidental (unintended) two-way transmission for a single interaction.
    // Only meaningful for a real map NPC, never for the wiki/actor pages.
    _incidentalContact() {
      const DS = window.DiseaseSystem;
      if (!DS || !DS.rollIncidentalTransmission || this._entity || this._actorId != null) return;
      const npcName = _getNPCName(this._eventId);
      const profile = npcName ? _getProfile(npcName) : null;
      if (!profile) return;
      try { DS.rollIncidentalTransmission(npcName, profile); }
      catch (e) { console.warn('[NPCEmpathize] incidental transmission failed', e); }
    }

    // ── Deliberate disease transmission (Cough / Spit / Bite) ────────────────
    // Always available. Uses the party LEADER's carried diseases whose vector
    // matches the chosen action. The confirm dialog lists which diseases would
    // spread and at what chance. Committing is an assault: big reputation hit
    // plus an assault bounty via the crime system, regardless of whether any
    // disease actually transmits.
    _beginTransmit(vector) {
      const T       = _getT();
      const npcName = _getNPCName(this._eventId);
      const DS      = window.DiseaseSystem;
      const diseases = (DS && DS.leaderVectorDiseases(vector)) || [];

      const actionLbl = vector === 'airborne' ? (T.coughLabel)
        : vector === 'saliva' ? (T.spitLabel)
        : (T.biteLabel);

      this._transmitConfirm = {
        vector,
        diseases: diseases.map(d => ({ id: d.id, name: d.name, transmission: d.transmission })),
      };

      // Cough isn't treated as an assault (no bounty on confirm, see
      // _confirmTransmit), so its warning skips the "this counts as assault"
      // wording that Spit/Bite still show.
      const isCough = vector === 'airborne';
      let warn;
      if (diseases.length) {
        const list = diseases.map(d => `${d.name} (${Math.round(d.transmission * 100)}%)`).join(', ');
        warn = isCough
          ? T.transmitWarnHasNoAssault(actionLbl, npcName, list)
          : T.transmitWarnHas(actionLbl, npcName, list);
      } else {
        warn = isCough
          ? T.transmitWarnNoneNoAssault(actionLbl, npcName)
          : T.transmitWarnNone(actionLbl, npcName);
      }

      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._attackConfirm     = false;
      this._pickpocketConfirm = false;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._joinMessage       = { type: 'reject', text: warn };
      this._render();
    }

    _confirmTransmit() {
      const tc = this._transmitConfirm;
      if (!tc) return;
      const T       = _getT();
      const evId    = this._eventId;
      const npcName = _getNPCName(evId);
      const profile = _getProfile(npcName);
      const DS      = window.DiseaseSystem;

      const dz = (tc.diseases || []).map(x => DS && DS.getDisease(x.id)).filter(Boolean);
      let hitIds = [];
      if (profile && DS && dz.length) hitIds = DS.deliberateTransmit(profile, dz);

      // Reputation + faction hit and crime record (assault).
      if (profile) {
        _addNpcOpinion(profile, this._focusActor()?.actorId(), -60);
        (profile.eventLog ??= []).push({
          tag: 'crime', desc: `${tc.vector} assault by player`, // i18n-ignore: event-log record id
          timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
        });
        const dl      = window._NPCSocietyDataLoader;
        const faction = (profile.factionIndex >= 0 && dl?.factions) ? dl.factions[profile.factionIndex] : null;
        if (faction != null && window.$gameFactions?.changeReputation)
          window.$gameFactions.changeReputation(profile.factionIndex, -15);
      }
      // A cough is rude, not a crime, unlike Spit/Bite: no bounty for it.
      const isCough = tc.vector === 'airborne';
      const bounty  = 300 + ((profile?.level ?? 1) * 40);
      if (!isCough) window.CrimeSystem?.addCrime?.('Assault', bounty); // i18n-ignore: CrimeSystem category id

      let msg;
      if (!dz.length) {
        msg = isCough
          ? T.transmitNoneResultNoBounty(npcName)
          : T.transmitNoneResult(npcName);
      } else if (hitIds.length) {
        const names = hitIds.map(id => (DS ? DS.displayName(id) : id)).join(', ');
        msg = T.transmitHit(npcName, names);
      } else {
        msg = isCough
          ? T.transmitMissNoBounty(npcName)
          : T.transmitMiss(npcName);
      }

      SoundManager.playBuzzer();
      this._transmitConfirm = null;
      this._joinMessage = { type: hitIds.length ? 'accept' : 'reject', text: msg };
      this._render();
    }

    // ── Focused (interacting) party member ──────────────────────────────────
    // A character switcher in the left panel picks which party member is
    // interacting; every reputation change lands on THAT member's own standing
    // with the NPC (profile.opinions[actorId]), never a party-wide median.
    _focusIndex() {
      const n = $gameParty?.members()?.length ?? 1;
      let i = this._focusActorIndex ?? 0;
      if (i < 0 || i >= n) i = 0;
      return i;
    }
    _focusActor() {
      return $gameParty?.members()?.[this._focusIndex()] ?? $gameParty?.leader() ?? null;
    }
    _focusOpinion(profile) {
      return _npcEffectiveOpinion(profile, this._focusActor());
    }
    _selectFocusActor(index) {
      const n = $gameParty?.members()?.length ?? 1;
      if (index < 0 || index >= n || index === this._focusIndex()) return;
      this._focusActorIndex = index;
      // Handing the conversation to (or away from) Em or Bubba is itself an
      // event the NPC reacts to: clear the one-shots so the next render greets
      // whoever is now doing the talking.
      this._emGreeted = false;
      this._bubbaGreeted = false;
      SoundManager.playCursor();
      this._render();
    }
    _cycleFocusActor(dir) {
      const n = $gameParty?.members()?.length ?? 1;
      if (n <= 1) return;
      this._selectFocusActor((((this._focusIndex() + dir) % n) + n) % n);
    }

    // ── Social interactions (praise / joke / story / insult / ...) ───────────
    _socialize() {
      this._socialMode        = true;
      this._romanceMode       = false;
      this._directionsMode    = false;
      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._attackConfirm     = false;
      this._pickpocketConfirm = false;
      this._transmitConfirm   = null;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._render();
    }

    // ── Romance submenu (flirt / serenade / confess / kiss / ...) ────────────
    // The moves themselves, their odds and the compatibility gates live in
    // NPCEmpathizeUI.js, next to the orientation data the Romance tab reads.
    _romance() {
      this._romanceMode       = true;
      this._socialMode        = false;
      this._directionsMode    = false;
      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._attackConfirm     = false;
      this._pickpocketConfirm = false;
      this._transmitConfirm   = null;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._render();
    }

    // ── Ask directions ──────────────────────────────────────────────────────
    // Lists the doors, teleports and people on this map; picking one has the
    // NPC point the player at it. Built in NPCEmpathizeUI.js.
    _askDirections() {
      this._directionsMode    = true;
      this._romanceMode       = false;
      this._socialMode        = false;
      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._attackConfirm     = false;
      this._pickpocketConfirm = false;
      this._transmitConfirm   = null;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._render();
    }

    // The button catalog for the Socialize submenu, labels localized.
    _socialCatalog() {
      const lang = ConfigManager.language === 'it' ? 'it' : 'en';
      const db   = _socialLines();
      const nm   = o => (lang === 'it' ? (o.label_it || o.label) : o.label) || o.id;
      const out  = [];
      (db.interactions || []).forEach(i => out.push({ id: i.id, label: nm(i), tone: i.tone }));
      ['story', 'poem'].forEach(id => { const p = db.performances?.[id]; if (p) out.push({ id, label: nm(p), tone: 'performance' }); });
      out.push({ id: 'joke', label: T('Empathize.tellAJoke'), tone: 'performance' });
      return out;
    }

    // Build a procedural joke from the grammar in SocialLines.json.
    _genJoke() {
      const j = _socialLines().jokes || {};
      const tmpl = _rand(j.templates || [T('Empathize.jokeFallback')]);
      return String(tmpl).replace(/\{(\w+)\}/g, (m, k) => _rand(j[k]) || k);
    }

    _socialInteract(id) {
      const npcName = _getNPCName(this._eventId);
      const profile = _getProfile(npcName);
      const actor   = this._focusActor();
      const actorId = actor && actor.actorId();
      const recent  = _countRecentInteractions(profile, 'social_' + id, 3);
      const db      = _socialLines();
      const fill    = s => String(s || '').replace(/\{name\}/g, npcName).replace(/\{subject\}/g, this._lastSubject || '');

      let playerLine = '', npcLine = '', delta = 0;
      // Tone bucket of this interaction, for the Em stance pools below. Jokes
      // and performances have no fixed tone, they take the sign of the result.
      let emTone = '';

      if (id === 'joke') {
        playerLine = this._genJoke();
        const land = Math.random() < Math.max(0.15, 0.7 - recent * 0.18);
        if (land) {
          delta   = Math.round(Math.max(1, 5 - recent) * _personalitySocialMult(profile, 'positive'));
          npcLine = fill(_rand(Math.random() < 0.5 ? db.jokes?.landGood : db.jokes?.landGroan));
        } else {
          delta   = Math.round((recent >= 2 ? -(2 + recent) : -1) * _personalitySocialMult(profile, 'negative'));
          npcLine = fill(_rand(db.jokes?.flop));
        }
      } else if (id === 'story' || id === 'poem') {
        const perf    = db.performances?.[id] || { base: 5, player: [], good: [], bad: [] };
        const subject = (window.RandomBookGenerator?.generateTitle)
          ? window.RandomBookGenerator.generateTitle()
          : T('Empathize.oldLegend');
        this._lastSubject = subject;
        // Reaction depends on the NPC's personality and trait affinity with the
        // performer, plus a whim, minus repetition fatigue.
        const lean  = (((profile?.personalityIndex ?? 0) % 7) - 3) * 2;         // -6..+6
        const compat = Math.round(_traitCompatBonus(profile, actor) / 10);       // trait affinity
        const whim  = Math.floor(Math.random() * 11) - 5;                        // -5..+5
        const raw   = (perf.base || 5) + lean + compat + whim - recent * 2;
        if (raw > 0) { delta = Math.max(1, Math.round(raw / 2 * _personalitySocialMult(profile, 'positive')));  npcLine = fill(_rand(perf.good)); }
        else         { delta = Math.min(-1, Math.round(raw / 2 * _personalitySocialMult(profile, 'negative'))); npcLine = fill(_rand(perf.bad)); }
        playerLine = fill(_rand(perf.player));
      } else {
        const def = _socialById()[id];
        if (!def) return;
        playerLine = fill(_rand(def.player));
        let sincere = true;
        if (def.tone === 'positive') {
          delta = def.baseDelta - recent * Math.max(2, Math.ceil(def.baseDelta / 2.5));
          delta = Math.round(delta * _personalitySocialMult(profile, 'positive'));
          if (delta <= 0) { sincere = false; delta = -Math.min(8, 2 + recent * 2); }
        } else if (def.tone === 'neutral') {
          delta = Math.max(0, (def.baseDelta || 1) - recent);
          delta = Math.round(delta * _personalitySocialMult(profile, 'neutral'));
          sincere = delta > 0;
        } else { // negative
          delta = def.baseDelta - Math.min(6, Math.max(0, recent - 1) * 2);
          delta = Math.round(delta * _personalitySocialMult(profile, 'negative'));
          sincere = false;
        }
        const pool = def.tone === 'negative' ? def.responseBad : (sincere ? def.responseGood : def.responseBad);
        npcLine = fill(_rand(pool));
        emTone = def.tone;
      }

      // Em (Switch 48): the NPC answers her, not a stranger. Their stance owns
      // the reply and scales what the interaction is worth, so praise from the
      // god-killer lands very differently on a zealot and on an invasive fan.
      const emCtx = this._emCtx();
      if (emCtx) {
        if (!emTone) emTone = delta >= 0 ? 'positive' : 'negative';
        const emLine = _rand(emCtx.data[emTone]);
        if (emLine) npcLine = fill(emLine);
        delta = Math.round(delta * _stanceToneMult(emCtx, emTone));
      }

      // Bubba (Switch 49): he does not perform, he deflects. Whatever the move
      // was, he says something modest about a shed and a wrench, and the NPC
      // answers the man who gave them their roads back rather than a stranger.
      const bubbaCtx = this._bubbaCtx();
      if (bubbaCtx) {
        let tone = emTone || (delta >= 0 ? 'positive' : 'negative');
        const modest = _rand(bubbaCtx.data.player);
        if (modest) playerLine = fill(modest);
        const line = _rand(bubbaCtx.data[tone]);
        if (line) npcLine = fill(line);
        delta = Math.round(delta * _stanceToneMult(bubbaCtx, tone));
      }

      // Apply reputation to the focused member only.
      if (profile && actorId != null) {
        _addNpcOpinion(profile, actorId, delta);
        (profile.eventLog ??= []).push({
          tag: 'social_' + id, desc: `${id} (${delta >= 0 ? '+' : ''}${delta})`,
          timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
        });
        const dl      = window._NPCSocietyDataLoader;
        const faction = (profile.factionIndex >= 0 && dl?.factions) ? dl.factions[profile.factionIndex] : null;
        if (faction != null && delta !== 0 && window.$gameFactions?.changeReputation)
          window.$gameFactions.changeReputation(profile.factionIndex, Math.round(delta / 6));
      }

      // Present it as a chat exchange (player line, then the NPC's reaction).
      // Picking an option closes the Socialize submenu back to the normal
      // action row, same as Cancel would.
      this._socialMode  = false;
      this._activeTab   = 'chat';
      this._chatHistory.push({ role: 'player', text: playerLine });
      this._isTyping = true;
      this._joinMessage = {
        type: delta >= 0 ? 'accept' : 'reject',
        text: `${delta >= 0 ? '+' : ''}${delta} ♥ (${actor ? actor.name() : ''})`,
      };
      this._render();
      this._scrollChatToBottom();
      setTimeout(() => {
        this._isTyping = false;
        this._chatHistory.push({ role: 'npc', text: npcLine });
        if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
        this._render();
        this._scrollChatToBottom();
      }, 350);
    }

    // Buy the procedural-house floor the player is currently standing in from
    // the resident NPC. Price scales down with disposition; on purchase the
    // seller moves out (event erased) and the build menu unlocks for this floor.
    _buyHouse() {
      const phs = window.ProceduralHouseSystem;
      const T   = _getT();
      if (!phs?.canOfferPurchase?.()) { SoundManager.playBuzzer(); return; }

      const evId    = this._eventId;
      const npcName = _getNPCName(evId);
      const profile = _getProfile(npcName);
      const opinion = this._focusOpinion(profile);
      const price   = phs.getCurrentFloorPrice(opinion);

      if ($gameParty.gold() < price) {
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.notEnoughGold((price / 100).toFixed(2)) };
        this._render();
        return;
      }

      $gameParty.loseGold(price);
      phs.buyCurrentFloor();
      // The seller moves out, leaving the floor to the player.
      if (evId != null && $gameMap?.event(evId)) $gameMap.event(evId).erase();

      SoundManager.playOk();
      this._removeOverlay();
      this._releaseEventLock();
      SceneManager.pop();
    }

    _gift() {
      this._giftMode          = true;
      this._giftItems         = ($gameParty?.items() ?? []).filter(i => i.itypeId === 1);
      this._stealMode         = false;
      this._bribeMode         = false;
      this._attackConfirm     = false;
      this._pickpocketConfirm = false;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._render();
    }

    _giveItem(index) {
      const item = this._giftItems[index];
      if (!item) return;

      const evId    = this._eventId;
      const npcName = _getNPCName(evId);
      const profile = _getProfile(npcName);
      const T       = _getT();

      // Read before the present moves the needle, so the reaction is to the
      // giver they knew walking in.
      const priorOpinion = this._focusOpinion(profile);

      // Somebody who thinks badly of the giver does not take presents from
      // them. The item never leaves the bag, and the attempt is remembered as
      // one more thing they had to push away. Party members (actor mode, no
      // society profile) always accept: the reading there is only hygiene.
      if (profile && this._actorId == null && priorOpinion < 0) {
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.giftRefused(npcName, item.name) };
        const refusal = _rand(T.giftRefusalLines || []);
        if (refusal) {
          this._chatHistory.push({
            role: 'npc',
            text: String(refusal).replace(/\{item\}/g, item.name).replace(/\{name\}/g, npcName),
          });
          if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
        }
        if (profile) {
          (profile.eventLog ??= []).push({
            tag: 'gift', desc: `refused ${item.name}`, // i18n-ignore: event-log record id
            timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
          });
        }
        this._giftMode = false;
        this._render();
        this._scrollChatToBottom();
        return;
      }

      $gameParty.loseItem(item, 1);

      const recentGifts = _countRecentInteractions(profile, 'gift', 5);
      const giftMult    = recentGifts >= 3 ? 0.5 : 1;
      const delta = Math.round(Math.max(5, Math.min(25, (item.price || 0) / 50)) * giftMult);
      if (profile) {
        _addNpcOpinion(profile, this._focusActor()?.actorId(), delta);
        (profile.eventLog ??= []).push({ tag: 'gift', desc: `received ${item.name}`, timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0 });

        const dl      = window._NPCSocietyDataLoader;
        const faction = (profile.factionIndex >= 0 && dl?.factions) ? dl.factions[profile.factionIndex] : null;
        if (faction != null && window.$gameFactions?.changeReputation)
          window.$gameFactions.changeReputation(profile.factionIndex, Math.ceil(delta / 5));
      }

      SoundManager.playOk();
      this._joinMessage = { type: 'accept', text: T.gaveItem(npcName, item.name) };

      // They say something about what they have just been handed: warmly for
      // something worth having, flatly for a trinket, wearily at the fourth
      // present in a row. Anyone who would have taken it coldly refused it
      // above, so there is no cold bank left to reach here.
      const bank = recentGifts >= 3 ? 'giftReactionRepeat'
        : delta >= 18               ? 'giftReactionWarm'
        :                             'giftReactionPlain';
      const line = _rand(T[bank] || []);
      if (line) {
        this._chatHistory.push({
          role: 'npc',
          text: String(line).replace(/\{item\}/g, item.name).replace(/\{name\}/g, npcName),
        });
        if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
      }

      this._giftMode    = false;
      this._render();
      this._scrollChatToBottom();
    }

    _bribe() {
      this._bribeMode         = true;
      this._giftMode          = false;
      this._stealMode         = false;
      this._attackConfirm     = false;
      this._pickpocketConfirm = false;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._render();
    }

    // Classes that enforce the law rather than skirt it. IDs match the
    // ClassSelector roster (44 = Police Officer); they refuse a bribe outright
    // and report the attempt instead of rolling the usual accept/fail chance.
    static get LAW_CLASSES() { return [44]; }

    _attemptBribe(tierIndex) {
      const BASE_TIERS = [
        { gold: 200,  op: 10, chance: 70 },
        { gold: 500,  op: 22, chance: 80 },
        { gold: 1000, op: 40, chance: 90 },
      ];
      const evId    = this._eventId;
      const npcName = _getNPCName(evId);
      const profile = _getProfile(npcName);
      const T       = _getT();
      const opinion = this._focusOpinion(profile);

      const recentBribes = _countRecentInteractions(profile, 'bribe', 5);
      const costMult     = recentBribes >= 2 ? 1.5 : 1;
      const base         = BASE_TIERS[tierIndex];
      if (!base) return;
      const tier = { ...base, gold: Math.round(base.gold * costMult) };

      if ($gameParty.gold() < tier.gold) {
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.notEnoughGold((tier.gold / 100).toFixed(2)) };
        this._render();
        return;
      }

      const evClassId = profile?.assignedClassId ?? _extractClassId($gameMap?.event(evId));
      if (Scene_NPCEmpathize.LAW_CLASSES.includes(evClassId)) {
        SoundManager.playBuzzer();
        if (profile) {
          _addNpcOpinion(profile, this._focusActor()?.actorId(), -30);
          (profile.eventLog ??= []).push({
            tag: 'bribe', desc: 'bribe attempt reported (law enforcement)', // i18n-ignore: event-log record id
            timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0,
          });
        }
        window.CrimeSystem?.addCrime?.('Bribery', tier.gold); // i18n-ignore: CrimeSystem category id
        this._joinMessage = {
          type: 'reject',
          text: T.bribeRefusedLaw(npcName),
        };
        this._bribeMode = false;
        this._render();
        return;
      }

      if (opinion <= -60) {
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.bribeRefused(npcName) };
        this._bribeMode   = false;
        this._render();
        return;
      }

      $gameParty.loseGold(tier.gold);
      const success = Math.random() * 100 < tier.chance;
      if (profile) (profile.eventLog ??= []).push({ tag: 'bribe', desc: success ? 'bribe accepted' : 'bribe failed', timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0 }); // i18n-ignore: event-log record ids

      if (success) {
        if (profile) _addNpcOpinion(profile, this._focusActor()?.actorId(), tier.op);
        SoundManager.playOk();
        this._joinMessage = { type: 'accept', text: T('Empathize.bribeAccepted', { name: npcName, op: tier.op }) };
      } else {
        window.CrimeSystem?.addCrime?.('Bribery', tier.gold); // i18n-ignore: CrimeSystem category id
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.briberyCaught(npcName) };
      }

      this._bribeMode = false;
      this._render();
    }

    _attack() {
      const npcName = _getNPCName(this._eventId);
      const T       = _getT();
      this._attackConfirm     = true;
      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._pickpocketConfirm = false;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._joinMessage       = { type: 'reject', text: T.attackWarning(npcName) };
      this._render();
    }

    _confirmAttack() {
      const evId    = this._eventId;
      const npcName = _getNPCName(evId);
      const profile = _getProfile(npcName);

      if (profile) {
        const actorId = this._focusActor()?.actorId();
        // Hitting somebody is the opposite of company: it costs the party the
        // same social need a friendly exchange would have paid them.
        _gainSocialFromOpinion(actorId, -100 - _npcBaseOpinion(profile, actorId), profile);
        _setNpcBaseOpinion(profile, actorId, -100);
        (profile.eventLog ??= []).push({ tag: 'crime', desc: 'attacked by player', timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0 }); // i18n-ignore: event-log record id
        const dl      = window._NPCSocietyDataLoader;
        const faction = (profile.factionIndex >= 0 && dl?.factions) ? dl.factions[profile.factionIndex] : null;
        if (faction != null && window.$gameFactions?.changeReputation)
          window.$gameFactions.changeReputation(profile.factionIndex, -20);
      }

      const bounty = 500 + ((profile?.level ?? 1) * 50);
      window.CrimeSystem?.addCrime?.('Assault', bounty); // i18n-ignore: CrimeSystem category id

      $gameVariables.setValue(6, evId);
      this._attackConfirm = false;
      this._removeOverlay();
      this._releaseEventLock();
      SceneManager.pop();
      // Who is being fought, so a kill can be written back onto their event
      // (SECTION 5b). Taken here, while the map they stand on is still the
      // current one; the panel may have been opened on a different event than
      // the one it ends up acting for (wiki navigation), so `evId` rules.
      if (evId != null && $gameMap)
        $gameTemp._NPCEmpathizeAttackTarget = { mapId: $gameMap.mapId(), eventId: evId };
      // The face the fight is fought against, taken here for the same reason.
      $gameTemp._NPCEmpathizeAttackFace = _buildBattleFace(npcName, $gameMap?.event(evId));
      $gameTemp._NPCEmpathizeStartBattle = 2;
    }

    _pickpocket() {
      const T = _getT();
      this._pickpocketConfirm = true;
      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._attackConfirm     = false;
      this._activeTab         = 'chat';
      this._menuIndex         = 0;
      this._joinMessage       = { type: 'reject', text: T.confirmPickpocket };
      this._render();
    }

    _confirmPickpocket() {
      const ev = $gameMap?.event(this._eventId);
      let items = [];
      if (window.ShopScanner) {
        const all = window.ShopScanner.scanMapForShops?.() || [];
        items = all.filter(i => i.sourceEventId === this._eventId);
        if (!items.length && ev)
          items = window.ShopScanner.generateNPCItems?.(ev) || [];
      }
      this._stealItems        = items;
      this._pickpocketConfirm = false;
      this._stealMode         = true;
      this._stealAttempted    = {};
      this._menuIndex         = 0;
      this._render();
    }

    _cancelSubMode() {
      this._giftMode          = false;
      this._bribeMode         = false;
      this._stealMode         = false;
      this._pickpocketConfirm = false;
      this._attackConfirm     = false;
      this._transmitConfirm   = null;
      this._socialMode        = false;
      this._romanceMode       = false;
      this._directionsMode    = false;
      this._stealAttempted    = {};
      this._joinMessage       = null;
      this._menuIndex         = 0;
      this._render();
    }

    _attemptSteal(index) {
      const item = this._stealItems[index];
      if (!item) return;
      const key = `${item.type}_${item.id}`;
      if (this._stealAttempted[key]) return;

      const agility = $gameParty.leader()?.agi ?? 10;
      const chance  = window.StealCalculator?.calculateStealChance(item.data, agility) ?? 50;
      const success = window.StealCalculator?.performSteal(chance) ?? false;

      $gameVariables.setValue(79, item.data.price ?? 0);

      const npcName = _getNPCName(this._eventId);
      const profile = _getProfile(npcName);
      if (profile) {
        _addNpcOpinion(profile, this._focusActor()?.actorId(), -25);
        (profile.eventLog ??= []).push({ tag: 'crime', desc: 'pickpocketed by player', timestamp: Date.now(), gameMin: $gameVariables?.value(114) ?? 0 }); // i18n-ignore: event-log record id
      }

      if (success) {
        $gameParty.gainItem(item.data, 1);
        this._stealAttempted[key] = 'success';
        SoundManager.playOk();
      } else {
        $gameTemp.reserveCommonEvent(125);
        this._stealAttempted[key] = 'fail';
        SoundManager.playBuzzer();
      }
      this._render();
    }

    _trade() {
      const evId    = this._eventId;
      const npcName = _getNPCName(evId);
      const profile = _getProfile(npcName);
      const opinion = this._focusOpinion(profile);
      const T       = _getT();

      if (opinion <= -20) {
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.refuseTrade(npcName) };
        this._render();
        return;
      }

      // Goodwill sets the starting price; Barter (specialization 30) is what the
      // party can actually talk it down to on top of that. The clamps are wider
      // than the opinion-only ones they replace so a trained trader has room to
      // work, but they still exist: nobody sells at half price out of fondness.
      const trader = this._focusActor();
      const barterBuy = window.SpecializationXP
        ? window.SpecializationXP.discountFor(trader, 'Barter', 0.05, 0.8) : 1;
      const barterSell = window.SpecializationXP
        ? window.SpecializationXP.multiplierFor(trader, 'Barter', 0.08) : 1;
      const buyFactor  = Math.max(0.65, (1 - Math.max(0, opinion) / 500) * barterBuy);
      const sellFactor = Math.min(1.5, (1 + Math.max(0, opinion) / 500) * barterSell);
      const ev         = $gameMap?.event(evId);
      const cid        = _extractClassId(ev);
      const goods      = [];

      if (profile && window.NPCSocietyGetEquip) {
        const equip = window.NPCSocietyGetEquip(npcName, cid ?? profile.assignedClassId, profile.wealthTierBase ?? 2);
        if (equip.weaponId && $dataWeapons?.[equip.weaponId])
          goods.push([1, equip.weaponId, 1, Math.max(1, Math.floor($dataWeapons[equip.weaponId].price * buyFactor))]);
        for (const aId of (equip.armorIds || []))
          if ($dataArmors?.[aId])
            goods.push([2, aId, 1, Math.max(1, Math.floor($dataArmors[aId].price * buyFactor))]);
      }
      for (const iId of (profile?.itemIds || []))
        if ($dataItems?.[iId])
          goods.push([0, iId, 1, Math.max(1, Math.floor($dataItems[iId].price * buyFactor))]);

      SoundManager.playOk();
      // Opening the haggle is the practice; the shop itself then trains
      // Haggling and Appraising on whatever actually changes hands.
      if (window.SpecializationXP) {
        window.SpecializationXP.awardCapped('Barter', 1, { actor: trader });
      }
      this._removeOverlay();
      this._releaseEventLock();
      SceneManager.pop();
      $gameTemp._NPCEmpathizeOpenTrade = { goods, sellFactor };
    }

    _treatWounds() {
      const npcName = _getNPCName(this._eventId);
      const profile = _getProfile(npcName);
      const opinion = this._focusOpinion(profile);
      const T       = _getT();

      if (opinion <= -20) {
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.refuseHelp(npcName) };
        this._render();
        return;
      }

      const members  = $gameParty.members();
      const lvls     = members.map(a => a.level).filter(Number.isFinite).sort((a, b) => a - b);
      const medianLv = lvls.length ? lvls[Math.floor((lvls.length - 1) / 2)] : 1;

      if (opinion >= 20) {
        members.forEach(a => a.recoverAll());
        SoundManager.playOk();
        this._joinMessage = { type: 'accept', text: T.healFree(npcName) };
        this._render();
        return;
      }

      const cost = members.length * medianLv * 100;
      if ($gameParty.gold() < cost) {
        SoundManager.playBuzzer();
        this._joinMessage = { type: 'reject', text: T.notEnoughGold((cost / 100).toFixed(2)) };
        this._render();
        return;
      }

      $gameParty.loseGold(cost);
      members.forEach(a => a.recoverAll());
      SoundManager.playOk();
      this._joinMessage = { type: 'accept', text: T.healCost(npcName, (cost / 100).toFixed(2)) };
      this._render();
    }

    _join() {
      const evId    = this._eventId;
      const npcName = _getNPCName(evId);
      const profile = _getProfile(npcName);
      const T       = _getT();

      // Join gates, mirroring the UI gate in _renderInner: the 3-member party cap,
      // the level margin, and the event needing a self-switch A page to disappear
      // behind once it is recruited. No Switch 67 or name-matching.
      if (_travellingPartyCount() >= 3 || !_hasSelfSwitchAPage(evId)
          || !_joinLevelOk(_presetFromEvent($gameMap?.event(evId))?.level ?? profile?.level)) {
        SoundManager.playBuzzer();
        return;
      }

      // Bubba never rides along with Em: somebody has to keep the camper alive,
      // and a jealous goddess makes travelling together a bad idea for the towns
      // they would sleep in. He turns her down in his own words, no roll, no
      // reputation hit (the UI hides Join for him, this is the safety net).
      const emCtx = this._emCtx();
      if (emCtx?.bubba) {
        SoundManager.playBuzzer();
        const line = _rand(emCtx.data.refuseJoin);
        if (line) {
          this._chatHistory.push({ role: 'npc', text: String(line).replace(/\{name\}/g, npcName) });
          if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
          this._render();
          this._scrollChatToBottom();
        }
        return;
      }

      const opinion = this._focusOpinion(profile);
      // Same formula the Join label advertises (50% at neutral, lower when the
      // NPC dislikes you, higher when they like you, level ignored). Debug/sandbox
      // play forces it near-certain so companions can be assembled for testing.
      const chance  = _joinChance(opinion, this._focusActor());

      if (Math.random() * 100 >= chance) {
        SoundManager.playBuzzer();
        // Being turned down stings a little, the NPC remembers being pressed.
        if (profile) {
          _addNpcOpinion(profile, this._focusActor()?.actorId(), -2);
          profile.eventLog = profile.eventLog || [];
          profile.eventLog.unshift({ tag: 'social', desc: 'declined to join the party', // i18n-ignore: event-log record id
            gameMin: $gameVariables?.value(114) ?? 0, timestamp: Date.now() });
          if (profile.eventLog.length > 30) profile.eventLog.pop();
        }
        const phrases = T.joinRefusalPhrases;
        const refusal = phrases[Math.floor(Math.random() * phrases.length)];
        this._chatHistory.push({ role: 'npc', text: refusal });
        if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
        this._render();
        this._scrollChatToBottom();
        return;
      }

      SoundManager.playOk();
      const db = _resolveMarkovDb(evId, profile);
      if (profile) profile.markovDb = db;

      // Joining a party is a bonding moment, the newcomer and every current
      // member (leader included) warm to each other. Captured before the
      // party roster changes below.
      const priorMembers = ($gameParty?.members() ?? []).slice();
      if (profile) profile.playerOpinion = Math.min(100, (profile.playerOpinion ?? 0) + 40);
      _gainSocialFromOpinion(this._focusActor()?.actorId(), 40, profile);
      for (const member of priorMembers) {
        if (member.actorId() === 1) continue; // leader bond lives in playerOpinion
        window.NPCSim?.bumpMutualOpinion?.(npcName, member.name(), 40);
      }

      // Execute the join silently (suppress the RPG Maker message box, we
      // show feedback inside this panel instead of closing it).
      // Call the exported global directly so the full joinParty flow
      // (transformActor, addActor, self-switch A) runs reliably.
      let joined = false;
      if (window._NPCSystemPartyJoin) {
        window._npcEmpathizeSilentJoin = true;
        $gameTemp.lastPluginCommandEventId = evId;
        joined = window._NPCSystemPartyJoin(db, evId) === true;
        $gameTemp.lastPluginCommandEventId = null;
        window._npcEmpathizeSilentJoin = false;
      } else {
        console.error('[NPCEmpathize] window._NPCSystemPartyJoin not found, is NPCSystemParty.js loaded?');
      }

      // joinParty reports whether the NPC actually joined (actor added +
      // self-switch A set). Only claim success if it really happened — otherwise
      // the panel would show "joined!" while the party stayed unchanged.
      if (!joined) {
        SoundManager.playBuzzer();
        // Every failure used to be reported as "party is full", including the
        // ones that were nothing of the kind (no event to recruit, a refusal).
        const reason   = $gameTemp?._npcJoinFailReason;
        const failText = reason === 'partyFull' ? T.partyFull
          : reason === 'refused' ? T('Empathize.joinRefused')
          : T('Empathize.joinFailed');
        this._chatHistory.push({ role: 'npc', text: failText });
        if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
        this._joinMessage = { type: 'reject', text: failText };
        this._render();
        this._scrollChatToBottom();
        return;
      }

      // Recruited: hide the Join action for the rest of this panel session so it
      // can't be pressed again for an NPC that already joined.
      this._justJoined = true;

      // Flip the interacted event onto its self-switch A page so the recruit
      // stops standing on the map. joinParty already does this for the event it
      // resolved internally; repeat it here (idempotent) for the event this
      // panel was actually opened from, which can differ after wiki navigation
      // or when a shop-shift stand-in supplied the profile, and refresh so the
      // page swap lands immediately instead of on the next map update.
      const swEvId = evId ?? this._launchEventId;
      if (swEvId != null && $gameMap) {
        $gameSelfSwitches.setValue([$gameMap.mapId(), swEvId, 'A'], true);
        $gameMap.event(swEvId)?.refresh();
      }

      // Show success in the chat, the player closes the panel when ready.
      const joinText = T('Empathize.joinedParty', { name: npcName });
      // The newcomer may have taken the place of a companion who fell and was
      // never brought back; say whose place it was rather than letting them
      // vanish from the roster without a word.
      const displaced = $gameTemp?._npcJoinDisplacedName;
      if (displaced) {
        this._chatHistory.push({ role: 'npc', text: T('Empathize.joinReplacedFallen', { name: displaced }) });
        $gameTemp._npcJoinDisplacedName = null;
      }
      this._chatHistory.push({ role: 'npc', text: joinText });
      if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
      this._joinMessage = { type: 'accept', text: joinText };
      this._activeTab = 'chat';
      this._render();
      this._scrollChatToBottom();
    }

    // Focus/blur callbacks from the chat input, the single source of truth for
    // _inputFocused / _activeArea so the game loop never fights the text field.
    _onAskFocus(focused) {
      this._inputFocused = !!focused;
      if (focused) this._activeArea = 'input';
    }

    // Send a chat line. `phraseArg` is supplied by the chat modal; when omitted
    // the text is read from the (legacy) inline input if one is present.
    _submitAsk(phraseArg) {
      let phrase = phraseArg;
      if (phrase == null) {
        const inp = this._overlay?.querySelector('#npc-dlg-ask-input')
          || document.getElementById('npc-dlg-ask-input');
        phrase = inp ? inp.value : '';
        if (inp) inp.value = '';
      }
      phrase = String(phrase || '').trim();
      if (!phrase) return;
      this._askDraft = '';
      // Small talk moves no opinion, but it is still somebody to talk to.
      this._gainCompany();

      this._chatHistory.push({ role: 'player', text: phrase });
      this._isTyping = true;
      this._render();
      this._scrollChatToBottom();

      setTimeout(() => {
        let response = '';
        if (window.generateMarkovString) {
          // Draw from ALL text databases combined, seeded with the player's own
          // words so the reply riffs on what was just said.
          try { response = window.generateMarkovString('all', { chainOrder: 2, minLength: 8, maxLength: 30, startText: phrase }); }
          catch (e) {}
          if (!response || /^ERROR:/i.test(response)) {
            try { response = window.generateMarkovString('all', { chainOrder: 2, minLength: 8, maxLength: 30 }); }
            catch (e) {}
          }
        }
        if (!response || /^ERROR:/i.test(response)) response = '...';
        if (response.length > 280) response = response.slice(0, 277) + '…';
        this._isTyping = false;
        this._chatHistory.push({ role: 'npc', text: response });
        if (this._chatHistory.length > 16) this._chatHistory = this._chatHistory.slice(-16);
        this._render();
        this._scrollChatToBottom();
      }, 350);
    }

    // ── Chat modal ─────────────────────────────────────────────────────────────
    // A standalone overlay (a sibling of the re-rendered panels) that hosts the
    // text field. Living OUTSIDE the panels means _render() never tears it down,
    // so focus and caret survive; the capture-phase _chatKeyGuard shields every
    // keystroke from all other plugins' global handlers, so typing is reliable.
    _openChatModal() {
      if (!this._overlay || this._chatModalOpen) return;
      const T     = _getT();
      const ev    = $gameMap?.event(this._eventId);
      const shift = window.NPCSim?.isShopShiftCovered?.(ev)
        ? window.NPCSim.getShopShiftData(ev?.event()?.name ?? '', $gameMap?.mapId(), this._eventId)
        : null;
      const name  = shift
        ? shift.name
        : (_getNPCName(this._eventId)
          || (this._actorId != null ? ($gameActors.actor(this._actorId)?.name() ?? '') : '')
          || this._npcName || '');
      const esc   = s => String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

      const modal = document.createElement('div');
      modal.className = 'npc-chat-modal-backdrop';
      modal.innerHTML = `
        <div class="npc-chat-modal" onmousedown="event.stopPropagation();">
          <div class="npc-chat-modal-title">${esc((T.chatWith) + ' ' + name)}</div>
          <textarea id="npc-dlg-ask-input" class="npc-chat-modal-input" rows="3"
            maxlength="200" autocomplete="off" spellcheck="false"
            placeholder="${esc(T.typePlaceholder)}"></textarea>
          <div class="npc-chat-modal-btns">
            <button class="npc-chat-modal-cancel" onmousedown="event.stopPropagation();SceneManager._scene._closeChatModal?.()">${esc(T.cancel)}</button>
            <button class="npc-chat-modal-send" onmousedown="event.stopPropagation();SceneManager._scene._submitChatModal?.()">${esc(T.send)}</button>
          </div>
        </div>`;
      // Clicks on the dimmed backdrop (outside the panel) close the modal.
      modal.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.target === modal) this._closeChatModal();
      });

      this._overlay.appendChild(modal);
      this._chatModalEl   = modal;
      this._chatModalOpen = true;
      this._inputFocused  = true;
      this._activeArea    = 'input';

      const ta = modal.querySelector('#npc-dlg-ask-input');
      if (ta) {
        ta.value = this._askDraft || '';
        // keep the draft current without needing the key events (which the guard
        // swallows) via the separate 'input' event
        ta.addEventListener('input', () => { this._askDraft = ta.value; });
        requestAnimationFrame(() => {
          ta.focus();
          const end = ta.value.length;
          try { ta.setSelectionRange(end, end); } catch (e) {}
        });
      }
    }

    _closeChatModal() {
      const modal = this._chatModalEl;
      this._chatModalEl   = null;
      this._chatModalOpen = false;
      this._inputFocused  = false;
      if (this._activeArea === 'input') this._activeArea = 'actions';
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    }

    _submitChatModal() {
      const ta = this._chatModalEl?.querySelector('#npc-dlg-ask-input');
      const phrase = ta ? ta.value : '';
      this._askDraft = '';
      this._closeChatModal();
      this._submitAsk(phrase);
    }

    // ── Event lock ─────────────────────────────────────────────────────────────

    _releaseEventLock() {
      const evId = this._launchEventId ?? this._eventId;
      if (evId == null) return;
      // Abandon the page that opened the panel, but ONLY if the paused map
      // interpreter really is that page. The fallback `?? this._eventId` can name
      // an event the panel merely navigated to (a wiki hyperlink onto an NPC who
      // happens to be standing on this map), and killing whatever interpreter is
      // running for that would silently cut off an unrelated event. eventId() 0 is
      // the common-event form of the same launch (the esoteric mind-meld skills).
      const interp   = $gameMap?._interpreter;
      const interpId = interp?.eventId?.() ?? null;
      if (interp && interp.isRunning() && (interpId === evId || interpId === 0)) {
        interp.terminate();
        if (interp._childInterpreter) interp._childInterpreter = null;
      }
      // Safe to clear here: the map has not updated since the panel opened, so
      // this flag can only be the launch event's own. (The deferred pass in
      // SECTION 5 deliberately does NOT do this, see the comment there.)
      const ev = $gameMap?.event(evId);
      if (ev) {
        ev._starting = false;
        if (ev._locked) ev.unlock();
      }
      $gameTemp._NPCEmpathizeReturnEvId   = evId;
      $gameTemp._NPCEmpathizeReturnFrames = 0;
    }

    // `force` shuts the panel outright instead of walking the wiki return
    // stack back one step. The mouse-only close button passes it: an X is
    // read as "shut this", never as "go back one page".
    _leave(force) {
      SoundManager.playCancel();
      // A non-empty return stack means we're backing out of a wiki hyperlink
      // jump, swap the panel's subject in place rather than tearing down
      // and recreating the whole overlay (which flickered).
      if (force) {
        Scene_NPCEmpathize._returnStack.length = 0;
      } else if (Scene_NPCEmpathize._returnStack.length) {
        const ctx = Scene_NPCEmpathize._returnStack.pop();
        _navigateInPlace(ctx);
        return;
      }
      this._removeOverlay();
      (this._disabledCanvases || []).forEach(({ el, orig }) => { el.style.pointerEvents = orig; });
      this._disabledCanvases = [];
      if (this._wasdListener) {
        window.removeEventListener('keydown', this._wasdListener);
        window.removeEventListener('keyup',   this._wasdUpListener);
        this._wasdListener = this._wasdUpListener = null;
      }
      if (this._chatKeyGuard) {
        window.removeEventListener('keydown',  this._chatKeyGuard, true);
        window.removeEventListener('keyup',    this._chatKeyGuard, true);
        window.removeEventListener('keypress', this._chatKeyGuard, true);
        this._chatKeyGuard = null;
      }
      this._releaseEventLock();
      SceneManager.pop();
    }
  }

  Scene_NPCEmpathize._eventId = null;
  Scene_NPCEmpathize._actorId = null;
  Scene_NPCEmpathize._npcName = null;
  Scene_NPCEmpathize._entity  = null;
  Scene_NPCEmpathize._returnStack = [];

  // Switch 67 (MultiplayerON) reserves party slots and gates the Join button.
  // It is set live by the multiplayer plugin, but a session that ended abruptly
  // can leave it stuck ON, which then wrongly hides Join in single-player. Force
  // it OFF on every load — a real multiplayer session re-sets it live, never via
  // a loaded save. Both SaveSystem load paths call $gameSystem.onAfterLoad().
  const _Game_System_onAfterLoad = Game_System.prototype.onAfterLoad;
  Game_System.prototype.onAfterLoad = function () {
    _Game_System_onAfterLoad.call(this);
    if ($gameSwitches) $gameSwitches.setValue(67, false);
  };

  // Pushes the current panel's full context onto the return stack so the
  // back button can restore it after a wiki hyperlink jump.
  function _pushReturnContext() {
    const curScene = SceneManager._scene;
    if (curScene instanceof Scene_NPCEmpathize) {
      Scene_NPCEmpathize._returnStack.push({
        eventId: curScene._eventId, actorId: curScene._actorId,
        npcName: curScene._npcName, entity: curScene._entity,
        // The tab is part of the context, so backing out of a hop taken from
        // the Social Web lands back on the web rather than on the chat.
        tab: curScene._activeTab,
      });
    }
  }

  // Switches the currently-open panel to a new subject (npc/actor/wiki entity)
  // by mutating the live scene and re-rendering, instead of pushing a brand
  // new Scene_NPCEmpathize. Pushing recreated the whole DOM overlay (fade out
  // + fade back in), which produced a visible flicker on every wiki hop.
  function _navigateInPlace(ctx) {
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_NPCEmpathize) || !scene._overlay) {
      Scene_NPCEmpathize._eventId = ctx.eventId ?? null;
      Scene_NPCEmpathize._actorId = ctx.actorId ?? null;
      Scene_NPCEmpathize._npcName = ctx.npcName ?? null;
      Scene_NPCEmpathize._entity  = ctx.entity  ?? null;
      Scene_NPCEmpathize._initialTab = ctx.tab ?? null;
      SceneManager.push(Scene_NPCEmpathize);
      return;
    }
    scene._eventId  = ctx.eventId ?? null;
    scene._actorId  = ctx.actorId ?? null;
    scene._npcName  = ctx.npcName ?? null;
    scene._entity   = ctx.entity  ?? null;
    scene._entityTabs    = null;
    scene._menuIndex     = 0;
    scene._menuItems     = [];
    scene._chatActions   = [];
    // A caller can name the tab to land on (the Social Web opens the next
    // person straight on their own web); otherwise the panel opens as usual.
    scene._activeTab     = ctx.tab ?? (scene._entity ? 'overview' : 'chat');
    scene._activeArea    = 'tabs';
    scene._contentIndex  = 0;
    scene._moreSubView   = null;
    scene._chatHistory   = [];
    scene._askDraft      = '';
    scene._inputFocused  = false;
    scene._isTyping      = false;
    scene._closeChatModal?.();
    scene._joinMessage   = null;
    scene._stealMode         = false;
    scene._stealItems        = [];
    scene._stealAttempted    = {};
    scene._giftMode          = false;
    scene._giftItems         = [];
    scene._bribeMode         = false;
    scene._attackConfirm     = false;
    scene._pickpocketConfirm = false;
    scene._webList       = null;
    scene._render();
  }

  // ============================================================================
  // SECTION 8, PLUGIN COMMAND
  // ============================================================================

  PluginManager.registerCommand(pluginName, 'Open', args => {
    if ($gameTemp._NPCEmpathizeBypass) {
      $gameTemp._NPCEmpathizeBypass = false;
      return;
    }
    const evName = String(args.eventName || '').trim().toLowerCase();
    let evId = null;
    if (evName) {
      const ev = $gameMap?.events().find(e => e?.event()?.name?.trim().toLowerCase() === evName);
      if (!ev) { console.warn(`[NPCEmpathize] Open: no event named "${evName}" on current map.`); return; }
      evId = ev.eventId();
    } else {
      evId = $gameMap?._interpreter?._eventId ?? null;
      if (!evId) { console.warn('[NPCEmpathize] Open: no eventName given and no active event interpreter found.'); return; }
    }
    window.NPCEmpathize.open(evId);
  });

  // ============================================================================
  // SECTION 8b, WIKI DATA LAYER
  // ============================================================================
  // Aggregates everything the world knows about an entity from the active
  // world folder (history.json via HistoryManager, artifacts.json via
  // WorldManager, npcs.json politics via NPCPolitics) plus the static
  // WorldGen databases, into a single view object the UI can render.

  const Wiki = {
    _index: null,     // exact name        → { type, id }
    _escIndex: null,  // HTML-escaped name → { type, id }
    _linkRegex: null,

    invalidate() {
      this._index = null;
      this._escIndex = null;
      this._linkRegex = null;
    },

    _hm() { return window.HistoryManager; },

    _generatedArtifacts() {
      if (window.WorldManager) {
        const g = window.WorldManager.getField('artifacts', 'generated');
        if (g) return g;
      }
      return (typeof $gameSystem !== 'undefined' && $gameSystem?._generatedArtifacts) || null;
    },

    // ── entity views ──────────────────────────────────────────────────────────

    listNationNames() {
      const fromHist = Object.keys(this._hm()?.getNationsState?.() || {});
      if (fromHist.length) return fromHist;
      return (window.WorldGen?.Countries || []).map(c => c.country);
    },

    getNation(name) {
      const hm = this._hm();
      const stateInfo  = hm?.getNationState?.(name) || null;
      const staticInfo = (window.WorldGen?.Countries || []).find(c => c.country === name) || null;
      if (!stateInfo && !staticInfo) return null;
      const history    = hm?.getNationHistory?.(name) || [];
      const current    = history.length ? history[history.length - 1] : null;
      const controller = stateInfo?.controller ?? staticInfo?.controller ?? 'Neutral';
      const faction    = stateInfo?.faction ?? staticInfo?.faction ?? 'Neutral';
      const power      = controller !== 'Neutral' ? (window.NPCPolitics?.getPower?.(controller) ?? null) : null;
      const settlements = Object.values(window.NPCPolitics?.listSettlements?.() || {})
        .filter(s => s.country === name);
      return {
        type: 'nation', name, controller, faction,
        government: current?.government ?? null,
        history, power, settlements,
        seasons: staticInfo?.seasons ?? null,
        regionId: staticInfo?.id ?? null,
        events: hm?.getEventsAbout?.(name, 14) ?? [],
      };
    },

    getPower(name) {
      const live = window.NPCPolitics?.getPower?.(name) ?? null;
      const hm   = this._hm();
      const hist = (hm?.getHyperpowers?.() || {})[name] || null;
      if (!live && !hist) return null;
      const nationsState = hm?.getNationsState?.() || {};
      let nations = Object.keys(nationsState).filter(n => nationsState[n]?.controller === name);
      if (!nations.length && live) nations = live.memberCountries || [];
      // Expose holy_leaders for dual-track powers (e.g. Holy Vatican Empire)
      const holyLeaders = hist?.holy_leaders || undefined;
      const currentHoly = hm?._currentHolyLeaders || hm?._histField?.('holyLeaders', {});
      return {
        type: 'power', name, live, hist, nations,
        holy_leaders: holyLeaders,
        currentHoly: currentHoly?.[name] || null,
        events: hm?.getEventsAbout?.(name, 14) ?? [],
      };
    },

    getLeader(name) {
      const hm = this._hm();
      const found = window.NPCPolitics?.findPolitician?.(name);
      if (found) {
        return {
          type: 'leader', kind: 'politician', name: found.pol.name,
          pol: found.pol, power: found.power,
          death: found.pol.alive ? null : {
            date: found.pol.deathDate ?? null,
            cause: window.NPCPolitics?.textOf?.(found.pol.deathCause) || null,
          },
          events: hm?.getEventsAbout?.(found.pol.name, 12) ?? [],
        };
      }
      const deaths   = hm?.getLeaderDeaths?.() || {};
      const deadList = hm?.getDeadLeaders?.() || [];
      const sources = [
        ['power',   hm?.getHyperpowers?.() || {}],
        ['faction', hm?.getHistoricalFactions?.() || {}],
      ];
      for (const [ofType, group] of sources) {
        for (const [groupName, data] of Object.entries(group)) {
          const leader = (data?.leaders || []).find(l => l && l.name === name);
          if (leader) {
            const isDead = deadList.includes(name) || !!deaths[name];
            return {
              type: 'leader', kind: 'historical', name,
              leader, of: groupName, ofType,
              death: isDead ? (deaths[name] || { date: null, cause: null }) : null,
              events: hm?.getEventsAbout?.(name, 12) ?? [],
            };
          }
        }
      }
      return null;
    },

    // `key` is "kind:id" (e.g. "weapon:1503") or an artifact name.
    getArtifact(key) {
      const hm = this._hm();
      const records = hm?.getArtifactRecords?.() || {};
      const generated = this._generatedArtifacts();
      let kind = null, id = null, rec = null;
      const m = String(key).match(/^(item|weapon|armor):(\d+)$/);
      if (m) {
        kind = m[1]; id = Number(m[2]);
        rec = records[key] || null;
      } else {
        for (const r of Object.values(records)) {
          if (r?.name === key) {
            rec = r; kind = r.kind; id = r.id;
            break;
          }
        }
        if (kind === null && generated) {
          for (const [kk, list] of [['item', generated.items], ['weapon', generated.weapons], ['armor', generated.armors]]) {
            const hit = (list || []).find(a => a?.name === key);
            if (hit) { kind = kk; id = hit.id; break; }
          }
        }
      }
      if (kind === null) return null;
      let data = null;
      if (generated) {
        const list = kind === 'item' ? generated.items : kind === 'weapon' ? generated.weapons : generated.armors;
        data = (list || []).find(a => a?.id === id) || null;
      }
      if (!data) {
        const db = kind === 'item' ? (typeof $dataItems !== 'undefined' && $dataItems)
                 : kind === 'weapon' ? (typeof $dataWeapons !== 'undefined' && $dataWeapons)
                 : (typeof $dataArmors !== 'undefined' && $dataArmors);
        data = (db && db[id]) || null;
      }
      if (!data && !rec) return null;
      const artifactName = data?.name ?? rec?.name ?? key;
      return {
        type: 'artifact', key: `${kind}:${id}`, kind, id,
        name: artifactName, data, rec,
        events: hm?.getEventsAbout?.(artifactName, 10) ?? [],
      };
    },

    getFaction(name) {
      const hm = this._hm();
      const hist = (hm?.getHistoricalFactions?.() || {})[name] || null;
      const dl = window._NPCSocietyDataLoader;
      let dlIndex = -1, dlFaction = null;
      (dl?.factions || []).forEach((f, i) => {
        if (dlFaction) return;
        const display = dl.getFactionName?.(f)
          || ((f?.name || '').split('.')[1] || f?.name || '');
        if (display === name || f?.name === name) { dlIndex = i; dlFaction = f; }
      });
      if (!hist && !dlFaction) return null;
      const members = [];
      if (dlIndex >= 0 && typeof $gameSystem !== 'undefined') {
        for (const [npcName, prof] of Object.entries($gameSystem?._npcSociety || {})) {
          if (prof?.factionIndex === dlIndex) {
            members.push(npcName);
            if (members.length >= 24) break;
          }
        }
      }
      // Resolve parent hyperpower from dlFaction's parentFaction ID
      let parentPower = null;
      const parentFactionId = dlFaction?.parentFaction;
      if (parentFactionId !== undefined && parentFactionId !== null) {
        const hpMap = this._hm()?.getHyperpowers?.() || {};
        for (const [hpName, hpData] of Object.entries(hpMap)) {
          if (hpData.id === parentFactionId) {
            parentPower = hpName;
            break;
          }
        }
      }
      return {
        type: 'faction', name, hist, dlFaction, dlIndex, members, parentPower,
        events: hm?.getEventsAbout?.(name, 14) ?? [],
      };
    },

    get(type, id) {
      // Old faction names may now be hyperpowers - redirect if not found as faction
      if (type === 'faction') {
        const f = this.getFaction(id);
        if (f) return f;
        const p = this.getPower(id);
        if (p) return { ...p, type: 'faction' };
        return null;
      }
      switch (type) {
        case 'nation':   return this.getNation(id);
        case 'power':    return this.getPower(id);
        case 'leader':   return this.getLeader(id);
        case 'artifact': return this.getArtifact(id);
      }
      return null;
    },

    // ── index listings (Wiki tab grids) ──────────────────────────────────────

    // Every known NPC: society profiles (anyone ever met/simulated) plus the
    // template pools of every map group, so the whole population is browsable
    // and remotely inspectable even before being encountered.
    listPeople() {
      const people = new Map(); // name → { name, group }
      const society = (typeof $gameSystem !== 'undefined' && $gameSystem?._npcSociety) || {};
      for (const [name, prof] of Object.entries(society)) {
        people.set(name, { name, group: prof?._homeGroupName ?? null });
      }
      const sys = window.NPCSystem;
      if (sys?.getGroupNames && sys?.getNPCNamesByGroup) {
        for (const groupName of sys.getGroupNames()) {
          for (const name of sys.getNPCNamesByGroup(groupName)) {
            if (!people.has(name)) people.set(name, { name, group: groupName });
          }
        }
      }
      return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    listLeaders() {
      const hm = this._hm();
      const deaths = hm?.getLeaderDeaths?.() || {};
      const deadList = new Set(hm?.getDeadLeaders?.() || []);
      const out = new Map(); // name → { name, of, dead }
      const addFrom = (group) => {
        for (const [groupName, data] of Object.entries(group || {})) {
          for (const l of (data?.leaders || [])) {
            if (l?.name && !out.has(l.name)) {
              out.set(l.name, { name: l.name, of: groupName, dead: deadList.has(l.name) || !!deaths[l.name] });
            }
          }
        }
      };
      addFrom(hm?.getHyperpowers?.());
      addFrom(hm?.getHistoricalFactions?.());
      const powers = (typeof $gameSystem !== 'undefined' && $gameSystem?._npcPolitics?.powers) || {};
      for (const p of Object.values(powers)) {
        for (const pol of Object.values(p?.politicians || {})) {
          if (pol?.name && !out.has(pol.name)) {
            out.set(pol.name, { name: pol.name, of: p.name, dead: !pol.alive });
          }
        }
      }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    listPowerNames() {
      const set = new Set(Object.keys(this._hm()?.getHyperpowers?.() || {}));
      for (const n of (window.NPCPolitics?.listPowers?.() || [])) set.add(n);
      return [...set].sort((a, b) => a.localeCompare(b));
    },

    listNations() {
      const states = this._hm()?.getNationsState?.() || {};
      return this.listNationNames()
        .map(name => ({ name, controller: states[name]?.controller ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    listFactionNames() {
      const set = new Set(Object.keys(this._hm()?.getHistoricalFactions?.() || {}));
      const dl = window._NPCSocietyDataLoader;
      for (const f of (dl?.factions || [])) {
        const display = dl.getFactionName?.(f) || ((f?.name || '').split('.')[1] || f?.name);
        if (display) set.add(display);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    },

    listArtifacts() {
      const out = [];
      const seen = new Set();
      const generated = this._generatedArtifacts();
      if (generated) {
        for (const [kind, list] of [['item', generated.items], ['weapon', generated.weapons], ['armor', generated.armors]]) {
          for (const a of (list || [])) {
            if (a) { out.push({ key: `${kind}:${a.id}`, name: a.name, kind, iconIndex: a.iconIndex }); seen.add(`${kind}:${a.id}`); }
          }
        }
      }
      for (const [key, r] of Object.entries(this._hm()?.getArtifactRecords?.() || {})) {
        if (!seen.has(key)) out.push({ key, name: r.name, kind: r.kind, iconIndex: 245 });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },

    // ── name index & hyperlink pattern ───────────────────────────────────────

    _escapeForIndex(str) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    buildIndex() {
      if (this._index) return this._index;
      const idx = new Map();
      const esc = new Map();
      const add = (name, type, id) => {
        if (!name || String(name).length < 3) return;
        name = String(name);
        if (idx.has(name)) return;
        const entry = { type, id };
        idx.set(name, entry);
        esc.set(this._escapeForIndex(name), entry);
      };
      const hm = this._hm();
      for (const n of Object.keys(hm?.getHyperpowers?.() || {})) add(n, 'power', n);
      for (const n of (window.NPCPolitics?.listPowers?.() || [])) add(n, 'power', n);
      for (const n of Object.keys(hm?.getHistoricalFactions?.() || {})) add(n, 'faction', n);
      for (const n of this.listNationNames()) add(n, 'nation', n);
      for (const data of Object.values(hm?.getHyperpowers?.() || {}))
        for (const l of (data?.leaders || [])) add(l?.name, 'leader', l?.name);
      for (const data of Object.values(hm?.getHistoricalFactions?.() || {}))
        for (const l of (data?.leaders || [])) add(l?.name, 'leader', l?.name);
      const powers = (typeof $gameSystem !== 'undefined' && $gameSystem?._npcPolitics?.powers) || {};
      for (const p of Object.values(powers))
        for (const pol of Object.values(p?.politicians || {})) add(pol?.name, 'leader', pol?.name);
      for (const [key, r] of Object.entries(hm?.getArtifactRecords?.() || {})) add(r?.name, 'artifact', key);
      const generated = this._generatedArtifacts();
      if (generated) {
        for (const [kind, list] of [['item', generated.items], ['weapon', generated.weapons], ['armor', generated.armors]])
          for (const a of (list || [])) add(a?.name, 'artifact', `${kind}:${a.id}`);
      }
      this._index = idx;
      this._escIndex = esc;
      return idx;
    },

    resolve(name) { return this.buildIndex().get(String(name)) || null; },
    resolveEscaped(escapedName) {
      this.buildIndex();
      return this._escIndex.get(String(escapedName)) || null;
    },

    // Regex matching every known entity name inside *escaped* HTML text,
    // longest names first so "Holy Vatican Empire" beats "Vatican".
    linkPattern() {
      if (this._linkRegex !== null) return this._linkRegex || null;
      this.buildIndex();
      const names = [...this._escIndex.keys()]
        .sort((a, b) => b.length - a.length)
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      this._linkRegex = names.length
        ? new RegExp(`(?<![\\w&])(${names.join('|')})(?![\\w;])`, 'g')
        : false;
      return this._linkRegex || null;
    },
  };

  // ============================================================================
  // SECTION 9, GLOBALS
  // ============================================================================

  window.NPCEmpathize = {
    open(evNameOrId) {
      if ($gameTemp._NPCEmpathizeBypass) {
        $gameTemp._NPCEmpathizeBypass = false;
        return;
      }
      if (typeof evNameOrId === 'number') {
        Scene_NPCEmpathize._eventId = evNameOrId;
        Scene_NPCEmpathize._actorId = null;
        Scene_NPCEmpathize._entity  = null;
        SceneManager.push(Scene_NPCEmpathize);
      } else {
        const ev = _findEventByName(evNameOrId);
        if (ev) {
          Scene_NPCEmpathize._eventId = ev.eventId();
          Scene_NPCEmpathize._actorId = null;
          Scene_NPCEmpathize._entity  = null;
          SceneManager.push(Scene_NPCEmpathize);
        } else {
          console.warn(`[NPCEmpathize] open: no event named "${evNameOrId}" on current map.`);
        }
      }
    },
    // `tab` opens the new panel on a given tab instead of the chat.
    openByName(npcName, tab = null) {
      if ($gameTemp._NPCEmpathizeBypass) {
        $gameTemp._NPCEmpathizeBypass = false;
        return;
      }
      const ev = _findEventByName(npcName);

      _pushReturnContext();
      const ctx = ev
        ? { eventId: ev.eventId(), actorId: null, npcName: null, entity: null, tab }
        : { eventId: null, actorId: null, npcName, entity: null, tab };
      _navigateInPlace(ctx);
    },
    // Open a wiki entity page (nation, hyperpower, leader, artifact, faction)
    // in the same panel. `id` may be URI-encoded (hyperlink onclick handlers).
    openEntity(type, id) {
      try { id = decodeURIComponent(id); } catch (_) { /* raw id */ }
      if (type === 'npc') return this.openByName(id);
      _pushReturnContext();
      _navigateInPlace({ eventId: null, actorId: null, npcName: null, entity: { type, id } });
    },
    openForActor(actorId) {
      if ($gameTemp._NPCEmpathizeBypass) {
        $gameTemp._NPCEmpathizeBypass = false;
        return;
      }
      Scene_NPCEmpathize._eventId = null;
      Scene_NPCEmpathize._actorId = actorId;
      Scene_NPCEmpathize._entity  = null;
      SceneManager.push(Scene_NPCEmpathize);
    },
    // Open the panel straight on the Wiki index tab (optionally on a specific
    // category, e.g. 'party'), used by the main menu's Dynamics command.
    // Anchored to the party leader's actor profile so the left panel is valid.
    openWiki(category = null) {
      Scene_NPCEmpathize._eventId = null;
      Scene_NPCEmpathize._actorId = $gameParty?.leader()?.actorId() ?? 1;
      Scene_NPCEmpathize._entity  = null;
      Scene_NPCEmpathize._initialTab = 'wiki';
      Scene_NPCEmpathize._initialWikiCategory = category;
      SceneManager.push(Scene_NPCEmpathize);
    },
    Scene_NPCEmpathize,
    Wiki,
    // Log a line an NPC said outside this panel (e.g. MarkovTextGenerator's
    // "Generate NPC Dialogue" plugin command drawing a message box) so it shows
    // up in that NPC's chat history the next time the panel is opened. Stored on
    // the society profile, so it survives saves and is world-shared like the
    // rest of the profile. Mirrored into a panel that is already open on this
    // NPC so the line appears live rather than only on the next visit.
    recordNPCLine(npcName, text, role = 'npc') {
      const name = String(npcName ?? '').trim();
      const line = String(text ?? '').trim();
      if (!name || !line) return;
      const profile = _getProfile(name);
      if (profile) {
        if (!Array.isArray(profile.spokenLog)) profile.spokenLog = [];
        profile.spokenLog.push({ role, text: line, gameMin: $gameVariables?.value(114) ?? 0 });
        if (profile.spokenLog.length > SPOKEN_LOG_MAX)
          profile.spokenLog = profile.spokenLog.slice(-SPOKEN_LOG_MAX);
      }
      const scene = SceneManager._scene;
      if (scene instanceof Scene_NPCEmpathize && scene._overlay) {
        const open = scene._eventId != null ? _getNPCName(scene._eventId) : scene._npcName;
        if (open === name) {
          scene._chatHistory.push({ role, text: line });
          if (scene._chatHistory.length > 16) scene._chatHistory = scene._chatHistory.slice(-16);
          scene._render();
          scene._scrollChatToBottom();
        }
      }
    },
    _helpers: {
      _getNPCName, _getProfile, _extractClassId, _hasJoinPartyCommand, _hasSelfSwitchAPage,
      _resolveBustForActor, _resolveBustPath, _resolveMarkovDb,
      _eventCommentLines, _bustNameFromEvent, _presetFromEvent,
      _computePartyPredisposition, _medianScore, _generatePartyThoughts,
      _extractContacts, _countRecentInteractions, _lastInteractionDay,
      _forceHighJoinChance, _joinChance, _joinLevelOk, _partyMaxLevel,
      _travellingPartyCount, SPOKEN_LOG_MAX,
      // Social/romance maths, shared with the UI layer's romance submenu.
      _socialLines, _rand, _addNpcOpinion, _npcEffectiveOpinion,
      _traitCompatBonus, _personalitySocialMult, _hygienePenalty, _hygieneReadout,
      // Em (Switch 48): stance resolution, shared with the UI layer so it can
      // hide what she is not allowed to do and label what she is walking into.
      _emPlaythrough, _isEmActor, _isBubbaNpc, _emContext, _emStanceKey, _emStanceData,
      // Bubba (Switch 49): the same for the man who built the Liminal Engine,
      // so the UI can hide what he refuses to do and label what he walks into.
      _bubbaPlaythrough, _isBubbaActor, _bubbaContext, _bubbaDb,
    },
    _getT,
  };

  console.log('[NPCEmpathize] v3.0.0 loaded.');
})();
