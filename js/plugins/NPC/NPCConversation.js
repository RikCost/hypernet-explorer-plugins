/*:
 * @target MZ
 * @plugindesc NPCConversation v2.3.0, NPC↔NPC dialogues, ambient chatter, thoughts & thought bubbles
 * @author Omni-Lex
 * @help NPCConversation.js
 *
 * ============================================================================
 * NPCConversation v2.3.0
 * ============================================================================
 * Ports the two-person dialogue + situational thought databases of the old
 * ThoughtsMenu plugin (the since-removed ThoughtsOLD.js) into the autonomous
 * NPC society, and owns both the words AND their on-map display:
 *
 * 1. FACE-TO-FACE CONVERSATIONS
 *    Two on-map NPCs that wander close to each other can stop, face each
 *    other, and play a short scripted exchange line-by-line through the
 *    floating thought bubbles (Section 7 listens to "npc:thought").
 *    The script tone (positive / negative / neutral / debate) is driven by
 *    their mutual relationship opinion and their personalities
 *    (js/db/Health/PersonalityData.json, per-personality tone biases and
 *    debate affinities, no shared archetypes).
 *    Finishing a conversation adjusts both relationships exactly like the
 *    old ThoughtsMenu social events did, and records a "met X" social entry.
 *
 * 2. AMBIENT CHATTER
 *    NPCs sharing a room (within a few tiles) while busy with other
 *    activities (working, interacting, lounging...) occasionally trade a
 *    quick two-line exchange without interrupting what they're doing.
 *
 * 3. THOUGHT PROVIDER (single home for all NPC dialogue text)
 *    NPCSimulationCore's ThoughtGenerator delegates here: need-based thought
 *    templates (moved out of NPCSimulationCore), the weather / time-of-day
 *    situational thoughts (four unique lines for each of the 25 personalities
 *    in every situation), capability-reaction lines, familiar-with-player musings, and
 *    personalityCoreThoughts, each personality's own inner-voice pool
 *    (hardcoded from PersonalityData.json) that can fire at random.
 *
 * 4. CONVERSATION LOG (world folder)
 *    The last 20 dialogues of every NPC are cached in a single JSON file in
 *    the active world folder: save/worlds/<World>/conversations.json
 *    (via the WorldManager $gameSystem._npcConversations accessor).
 *    NPCEmpathizeUI shows them in the Chat tab.
 *
 * 5. THOUGHT BUBBLES (formerly the separate NPCThoughtBubble.js plugin)
 *    Whenever "npc:thought" fires, a small parchment speech-bubble fades in
 *    above that NPC's sprite, lingers briefly, then fades back out. Visually
 *    it reuses the floating-HTML-overlay technique of MousePan's
 *    Window_EventHover tooltip (a positioned <div> kept in sync with the
 *    map's tile-to-screen projection every frame). DOM-guarded so the plugin
 *    still loads headless under the Node test harness.
 *
 * 6. PERSONALITY VOICES (v2.2.0)
 *    Two layers keep all 25 personalities verbally distinct everywhere:
 *    a) pools written per personality (weather/time situational thoughts,
 *       personality core thoughts), four unique lines per personality per
 *       situation, picked at random;
 *    b) every line drawn from a SHARED pool (conversation scripts, debates,
 *       ambient chatter, need/world/politics/capability thoughts) passes
 *       through the speaker's PERSONALITY_VOICE, openers/closers unique to
 *       that personality, so two NPCs delivering the same base line speak
 *       personality-flavored variations of it.
 *
 * FILE LAYOUT, the file is split in two clearly-banner'd parts:
 *   PART I , DIALOGUE DATA: every editable word (see its table of contents)
 *   PART II, ENGINE: logic only; you should rarely need to touch it
 *
 * Load Order:
 *   NPCSystem → NPCSimulationCore → NPCConversation
 *   (needs window.NPCSim and $gameSystem.getActiveNPCControllers at runtime;
 *    NPCSimulationCore reads window.NPCConversation.ThoughtProvider lazily,
 *    so the circular load order is safe)
 */

(() => {
  'use strict';

  // ============================================================================
  // ============================================================================
  //  PART I, DIALOGUE DATA (every word an NPC can say lives in this part)
  // ============================================================================

  // Every word an NPC can say now lives in js/i18n/<lang>/conversations/*.json,
  // and the banks below are lazy views onto those files: nothing here is frozen
  // at load time, so a language switch is picked up on the next line spoken.
  // Only the keys and the non-verbal tuning tables remain in this file.
  let _bankLang = null;
  const _bankCache = new Map();
  function bank(key) {
    const lang = T.language();
    if (lang !== _bankLang) { _bankLang = lang; _bankCache.clear(); }
    if (!_bankCache.has(key)) _bankCache.set(key, T.obj(key));
    return _bankCache.get(key);
  }
  //   I.1  Personality dispositions   (tone bias, debate affinity)
  //   I.2  Personality voices         (openers/closers that flavor shared lines)
  //   I.3  Conversation scripts       (positive/negative/neutral/debate/ambient)
  //   I.4  Solo thought pools         (needs, familiar-with-player, capability)
  //   I.5  Personality core thoughts  (each personality's inner voice)
  //   I.6  Situational thoughts       (weather/time-of-day × 25 personalities)
  //   I.7  Politics dialogue          (stances, elections, rumors, gripes)
  //   I.8  World-web small talk       (crime, economy, festivals, headlines)
  //
  //  PART II, ENGINE (logic only; no dialogue text below the PART II banner)
  //   II.1 Personality lookup & voice application
  //   II.2 Conversation log            II.5 Thought provider
  //   II.3 Conversation manager        II.6 Thought bubbles
  //   II.4 Politics & world providers  II.7 Scene hooks & globals
  // ============================================================================
  // ============================================================================

  // ---------------------------------------------------------------------------
  // I.1 PERSONALITY DISPOSITIONS
  // ---------------------------------------------------------------------------
  // No shared archetypes: every personality is its own dialogue identity.
  // These tables tune conversation behaviour per personality.

  // Personalities that pull conversations toward a tone regardless of opinion
  const PERSONALITY_TONE_BIAS = {
    Aggressive: 'negative', Grumpy: 'negative', Cynical: 'negative', Paranoid: 'negative',
    Empathetic: 'positive', Nurturing: 'positive', Sanguine: 'positive', Loyal: 'positive',
  };

  // How much each personality enjoys (or dodges) a political/philosophical
  // debate, added to the base debate chance for each participant.
  const PERSONALITY_DEBATE_AFFINITY = {
    Scholarly: 0.15,  Cynical: 0.12,   Authoritative: 0.10, Calm: 0.08,
    Fatalistic: 0.08, Stoic: 0.06,     Paranoid: 0.06,      Melancholic: 0.05,
    Disciplined: 0.04, Artistic: 0.03,
    Sanguine: -0.03,  Hedonistic: -0.04, Timid: -0.06,      Apathetic: -0.06,
  };

  // ---------------------------------------------------------------------------
  // I.2 PERSONALITY VOICES
  // ---------------------------------------------------------------------------
  // Every line drawn from a SHARED pool (conversation scripts, need/world/
  // politics/capability thoughts...) is passed through the speaker's voice:
  // applyVoice (PART II.1) sometimes prepends one of these openers or appends
  // one of these closers, so two NPCs delivering the same base line produce
  // personality-flavored variations of it. Pools that are already written per
  // personality (core thoughts, weather/time) are never re-flavored.
  // NOTE: keep every opener/closer unique across the whole table, the test
  // harness enforces it so no two personalities can ever sound identical.

  const PERSONALITY_VOICES = () => bank('ConvVoices');

  // ---------------------------------------------------------------------------
  // I.3 CONVERSATION SCRIPTS (ported from ThoughtsOLD.js, English only)
  // ---------------------------------------------------------------------------
  // Each script is an array of [speakerIndex, text]; {a} / {b} resolve to the
  // two participants' names. Speaker 0 is the NPC who initiated the exchange.
  // Every line is delivered through its speaker's PERSONALITY_VOICE (II.1), so
  // the same positive/negative/neutral/debate/ambient script reads differently
  // depending on which two personalities are having the conversation.

  const POSITIVE_SCRIPTS = () => bank('ConvScripts.positive');

  const NEGATIVE_SCRIPTS = () => bank('ConvScripts.negative');

  const NEUTRAL_SCRIPTS = () => bank('ConvScripts.neutral');

  // Political / philosophical / ethical debates (old generateDebateMessages).
  // agreement: relationship effect direction when the debate ends.
  // The political debates are part of the same pool the conversation manager
  // draws from, which the old code did with a push() at load time.
  const DEBATE_SCRIPTS = () => bank('ConvScripts.debate').concat(bank('ConvPolitics.debate'));

  // Quick two-line exchanges traded while NPCs keep doing their activities.
  const AMBIENT_SCRIPTS = () => bank('ConvScripts.ambient');

  // ---------------------------------------------------------------------------
  // I.4 SOLO THOUGHT POOLS (moved out of NPCSimulationCore)
  // ---------------------------------------------------------------------------
  // Need-based thought templates keyed by profile.currentNeed. Formerly
  // THOUGHT_TEMPLATES in NPCSimulationCore.js, every piece of NPC dialogue
  // now lives in this plugin; the core's ThoughtGenerator delegates to
  // ThoughtProvider (II.5). All three pools below are shared text, so each
  // pick is flavored by the thinker's PERSONALITY_VOICE.

  const NEED_THOUGHTS = () => bank('ConvThoughts.need');

  // Crime narration with an {item} placeholder, fired by NPCSimulationCore's
  // CrimeManager when an NPC eyes, pockets, or gets caught taking something.
  const CRIME_INTENT_THOUGHTS = () => bank('ConvThoughts.crimeIntent');
  const CRIME_SUCCESS_THOUGHTS = () => bank('ConvThoughts.crimeSuccess');
  const CRIME_CAUGHT_THOUGHTS = () => bank('ConvThoughts.crimeCaught');

  // Shopping reactions. {item} is the product's name. "buy" lines fire the
  // moment an NPC purchases something; "browse" lines fire when a (law-abiding)
  // customer studies a displayed item without buying. Both are split into
  // cheap/pricey variants so the reaction tracks the price tag, and tinted by
  // personality via applyVoice + the disposition lines below.
  const ITEM_BUY_THOUGHTS = () => bank('ConvThoughts.itemBuy');
  const ITEM_BROWSE_THOUGHTS = () => bank('ConvThoughts.itemBrowse');
  // Personality-flavored disposition lines occasionally appended to a shopping
  // thought, so the same {item} reads differently for a greedy vs. frugal NPC.
  const ITEM_DISPOSITION_THOUGHTS = () => bank('ConvThoughts.itemDisposition');

  // What an addicted NPC says while a craving is on them, keyed by substance:
  // "craving" while they are merely wanting it, "withdrawal" once the want has
  // turned into something they cannot talk around. AddictionSystem
  // (TimeDateSystem.js) answers how badly they want it; the words are here.
  const CRAVING_THOUGHTS = () => bank('ConvThoughts.craving');
  const CRAVING_WITHDRAWAL_THOUGHTS = () => bank('ConvThoughts.withdrawal');

  // Extra thoughts for NPCs who know the player well (playerOpinion >= 20).
  // Formerly FAMILIAR_THOUGHT_POOL in NPCSimulationCore.js.
  const FAMILIAR_THOUGHTS = () => bank('ConvThoughts.familiar');

  // Situational reactions fired off the npc:capability_end bus event.
  // Formerly CAPABILITY_THOUGHTS() in NPCSimulationCore.js.
  const CAPABILITY_THOUGHTS = () => bank('ConvThoughts.capability');

  // ---------------------------------------------------------------------------
  // I.5 PERSONALITY CORE THOUGHTS
  // ---------------------------------------------------------------------------
  // Each personality's own inner voice, hardcoded (English) from
  // js/db/Health/PersonalityData.json "thoughts.en". Fired at random by
  // ThoughtProvider.pickThought regardless of the NPC's current need.
  // Already per-personality, so never re-flavored by applyVoice.

  const PERSONALITY_CORE_THOUGHTS = () => bank('ConvCore');

  // ---------------------------------------------------------------------------
  // I.6 SITUATIONAL THOUGHTS (weather / time-of-day, per personality)
  // ---------------------------------------------------------------------------
  // Every situation carries FOUR distinct lines for each of the 25
  // personalities (one is picked at random per thought), so no two
  // personalities ever share a situational voice and the same NPC doesn't
  // repeat itself. 'default' covers NPCs with no resolvable personality.
  // Already per-personality, so never re-flavored by applyVoice.

  const WEATHER_THOUGHTS = () => bank('ConvWeather');

  const TIME_THOUGHTS = () => bank('ConvTime');

  // ---------------------------------------------------------------------------
  // I.7 POLITICS DIALOGUE (facts from NPCPolitics, words from here)
  // ---------------------------------------------------------------------------
  // NPCPolitics simulates governments, parties and elections and exposes
  // getConversationContext(name); every line an NPC can say about any of it
  // lives here, per the rule that NPCConversation.js owns all dialogue text.
  // Shared text → flavored by the speaker's PERSONALITY_VOICE on pick.
  // Placeholders: {party} {head} {title} {power} {days} {election} {gripe}
  //               {rumorSubject} {rumorKind} {winner} {office} {group}

  const POLITICAL_THOUGHTS = () => bank('ConvPolitics.stance');

  const ELECTION_THOUGHTS = () => bank('ConvPolitics.election');

  const POLITICAL_RUMOR_THOUGHTS = () => bank('ConvPolitics.rumor');

  const POLICY_GRUMBLES = () => bank('ConvPolitics.grumble');

  const OFFICE_HOLDER_THOUGHTS = () => bank('ConvPolitics.officeHolder');

  // Static political set-pieces mixed into the regular debate pool.
  const POLITICAL_DEBATE_SCRIPTS = () => bank('ConvPolitics.debate');


  // ---------------------------------------------------------------------------
  // I.8 WORLD-WEB SMALL TALK (facts from NPCWorldWeb, words from here)
  // ---------------------------------------------------------------------------
  // What the street says about the settlement's civic pulse (NPCWorldWeb):
  // crime waves, booms, busts, festivals, epidemics, headlines, the market,
  // and a player whose bounty precedes them.
  // Shared text → flavored by the speaker's PERSONALITY_VOICE on pick.

  const WORLD_THOUGHTS = () => bank('ConvWorld.topic');

  // ============================================================================
  // ============================================================================
  //  PART II, ENGINE (logic only; every editable word lives in PART I above)
  // ============================================================================
  // ============================================================================

  // ---------------------------------------------------------------------------
  // II.1 PERSONALITY LOOKUP & VOICE APPLICATION
  // ---------------------------------------------------------------------------

  // Odds that a shared line actually gets an opener/closer; tuned lower for
  // two-person dialogue so scripts don't drown in interjections.
  const VOICE_CHANCE_THOUGHT  = 0.55;
  const VOICE_CHANCE_DIALOGUE = 0.40;

  function _personalityOf(profile) {
    const list = window._NPCSocietyDataLoader?.personalities
              || window.Health?.PersonalityData || null;
    if (!list || profile?.personalityIndex == null) return null;
    return list[profile.personalityIndex] ?? null;
  }

  function _personalityNameOf(profile) {
    return _personalityOf(profile)?.name ?? null;
  }

  // Flavor a shared line with the speaker's voice (I.2): sometimes prepend an
  // opener or append a closer. Pure-emote lines (*does something*) and NPCs
  // without a resolvable personality pass through untouched.
  function applyVoice(text, persName, chance = VOICE_CHANCE_THOUGHT) {
    const voice = persName ? PERSONALITY_VOICES()[persName] : null;
    if (!voice || !text || String(text).startsWith('*')) return text;
    if (Math.random() >= chance) return text;
    return Math.random() < 0.5
      ? `${_pickFrom(voice.openers)} ${text}`
      : `${text} ${_pickFrom(voice.closers)}`;
  }

  // ---------------------------------------------------------------------------
  // II.2 CONVERSATION LOG (persisted to <world>/conversations.json)
  // ---------------------------------------------------------------------------
  // $gameSystem._npcConversations is a WorldManager prototype accessor backed
  // by the "conversations" world data file, so entries written here land in
  // save/worlds/<World>/conversations.json on the next save (see WorldManager
  // SYSTEM_FIELD_MAP / flush). Shape: { [npcName]: [{ min, with, kind, lines }] }

  const ConversationLog = {
    MAX_PER_NPC: 20,

    _store() {
      if (typeof $gameSystem === 'undefined' || !$gameSystem) return null;
      if (!$gameSystem._npcConversations) $gameSystem._npcConversations = {};
      return $gameSystem._npcConversations;
    },

    record(aName, bName, kind, lines) {
      const store = this._store();
      if (!store || !lines?.length) return;
      const min = $gameVariables?.value(114) ?? 0;
      const push = (self, other) => {
        const arr = (store[self] = store[self] || []);
        arr.push({ min, with: other, kind, lines });
        if (arr.length > this.MAX_PER_NPC) arr.splice(0, arr.length - this.MAX_PER_NPC);
      };
      push(aName, bName);
      push(bName, aName);
    },

    getFor(name) {
      return this._store()?.[name] ?? [];
    },
  };

  // ---------------------------------------------------------------------------
  // II.3 CONVERSATION MANAGER
  // ---------------------------------------------------------------------------

  const LINE_MS              = 3300;   // real-time ms between dialogue lines
  const SCAN_MS              = 4000;   // real-time ms between pair scans
  const MAX_ACTIVE           = 2;      // concurrent face-to-face conversations
  const START_DIST           = 2;      // tiles: close enough to stop and chat
  const AMBIENT_DIST         = 6;      // tiles: "same room" chatter range
  const PLAYER_RANGE         = 30;     // only converse near the player (visible flavour)
  const PAIR_COOLDOWN_MIN    = 45;     // game minutes between same-pair chats
  const AMBIENT_COOLDOWN_MIN = 20;
  const START_CHANCE         = 0.18;   // per eligible pair per scan
  const AMBIENT_CHANCE       = 0.07;

  // States in which an NPC can be pulled into a full stop-and-chat
  const FACE_STATES    = ['idle', 'wandering', 'socializing', 'inZone'];
  // States in which an NPC can trade ambient lines while staying busy
  const AMBIENT_STATES = ['idle', 'wandering', 'socializing', 'inZone',
                          'working', 'interacting', 'goingToZone', 'goingToWork'];

  function _getProfile(name) {
    return window.NPCSocietyRegistry?.getProfile?.(name)
        ?? $gameSystem?._npcSociety?.[name] ?? null;
  }

  function _modifyRelationship(profile, otherName, delta) {
    if (!profile || !otherName) return;
    profile.relationships = profile.relationships || {};
    const rel = profile.relationships[otherName] ?? { meetCount: 0, opinion: 0 };
    rel.opinion = Math.max(-60, Math.min(60, (rel.opinion ?? 0) + delta));
    profile.relationships[otherName] = rel;
  }

  function _bumpMeetCount(profile, otherName) {
    if (!profile || !otherName) return;
    profile.relationships = profile.relationships || {};
    const rel = profile.relationships[otherName] ?? { meetCount: 0, opinion: 0 };
    rel.meetCount = Math.min((rel.meetCount ?? 0) + 1, 999);
    profile.relationships[otherName] = rel;
  }

  function _rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function _pickFrom(arr)  { return arr[Math.floor(Math.random() * arr.length)]; }

  // Tone selection mirrors the old ThoughtsMenu social events: relationship
  // opinion sets the base odds, personalities nudge them.
  function _pickTone(profA, profB, aName, bName) {
    const rel = profA?.relationships?.[bName]?.opinion ?? 0;
    const w = rel > 20  ? { positive: 60, neutral: 30, negative: 10 }
            : rel < -20 ? { positive: 10, neutral: 30, negative: 60 }
            :             { positive: 35, neutral: 45, negative: 20 };
    for (const p of [profA, profB]) {
      const pers = _personalityOf(p);
      const bias = pers ? PERSONALITY_TONE_BIAS[pers.name] : null;
      if (bias === 'positive') { w.positive += 15; w.negative = Math.max(0, w.negative - 10); }
      if (bias === 'negative') { w.negative += 15; w.positive = Math.max(0, w.positive - 10); }
    }
    let r = Math.random() * (w.positive + w.neutral + w.negative);
    if ((r -= w.positive) <= 0) return 'positive';
    if ((r -= w.neutral)  <= 0) return 'neutral';
    return 'negative';
  }

  function _buildScript(profA, profB, aName, bName) {
    // Each personality brings its own appetite for a good debate
    let debateChance = 0.12;
    for (const p of [profA, profB]) {
      const name = _personalityNameOf(p);
      debateChance += (name && PERSONALITY_DEBATE_AFFINITY[name]) || 0;
    }
    if (Math.random() < debateChance) {
      const debate = _pickFrom(DEBATE_SCRIPTS());
      return { kind: 'debate', lines: debate.lines, agreement: debate.agreement };
    }
    const tone = _pickTone(profA, profB, aName, bName);
    const pool = tone === 'positive' ? POSITIVE_SCRIPTS()
               : tone === 'negative' ? NEGATIVE_SCRIPTS() : NEUTRAL_SCRIPTS();
    return { kind: tone, lines: _pickFrom(pool), agreement: tone === 'positive' };
  }

  function _resolveLine(text, aName, bName) {
    return String(text).replace(/{a}/g, aName).replace(/{b}/g, bName);
  }

  const ConversationManager = {
    _active: [],            // running conversations (face-to-face + ambient)
    _pairCooldowns: {},     // pairKey -> game minute of last exchange
    _nextScanAt: 0,
    _dispatcherPatched: false,

    _pairKey(a, b) {
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    },

    _onCooldown(a, b, cooldownMin) {
      const last = this._pairCooldowns[this._pairKey(a, b)];
      if (last == null) return false;
      const now = $gameVariables?.value(114) ?? 0;
      return now - last < cooldownMin;
    },

    _setCooldown(a, b) {
      this._pairCooldowns[this._pairKey(a, b)] = $gameVariables?.value(114) ?? 0;
      // Keep the map from growing without bound
      const keys = Object.keys(this._pairCooldowns);
      if (keys.length > 200) {
        for (const k of keys.slice(0, 100)) delete this._pairCooldowns[k];
      }
    },

    _isBusyConversing(name) {
      return this._active.some(c => c.aName === name || c.bName === name);
    },

    _eligibleControllers(states) {
      const ctrls = $gameSystem?.getActiveNPCControllers?.() || [];
      return ctrls.filter(c =>
        c.event && !c.event._erased && !c.event.isTransparent() &&
        c.eventName && states.includes(c.state) &&
        !this._isBusyConversing(c.eventName) &&
        $gamePlayer &&
        Math.abs(c.event.x - $gamePlayer.x) + Math.abs(c.event.y - $gamePlayer.y) <= PLAYER_RANGE
      );
    },

    // BehaviorDispatcher would otherwise yank a conversing NPC into a new
    // activity the moment its simulated need changes mid-chat.
    _patchDispatcher() {
      if (this._dispatcherPatched) return;
      const BD = window.NPCSim?.BehaviorDispatcher;
      if (!BD) return;
      const _dispatch = BD.dispatch;
      BD.dispatch = function (controller, profile) {
        if (controller?.state === 'conversing') return;
        return _dispatch.call(this, controller, profile);
      };
      this._dispatcherPatched = true;
    },

    update() {
      if (!$gameMap || !$gameSystem) return;
      const now = performance.now();

      this._patchDispatcher();

      // Backwards so _step's self-removal (which rebuilds _active) can't skip entries
      for (let i = this._active.length - 1; i >= 0; i--) {
        const convo = this._active[i];
        if (convo) this._step(convo, now);
      }

      if (now >= this._nextScanAt) {
        this._nextScanAt = now + SCAN_MS;
        this._scanFaceToFace();
        this._scanAmbient();
      }
    },

    // ---- face-to-face -------------------------------------------------------

    _scanFaceToFace() {
      if (this._active.filter(c => c.kind !== 'ambient').length >= MAX_ACTIVE) return;
      const ctrls = this._eligibleControllers(FACE_STATES);

      for (let i = 0; i < ctrls.length; i++) {
        for (let j = i + 1; j < ctrls.length; j++) {
          const a = ctrls[i], b = ctrls[j];
          const dist = Math.abs(a.event.x - b.event.x) + Math.abs(a.event.y - b.event.y);
          if (dist > START_DIST || dist === 0) continue;
          if (this._onCooldown(a.eventName, b.eventName, PAIR_COOLDOWN_MIN)) continue;

          const profA = _getProfile(a.eventName);
          const profB = _getProfile(b.eventName);
          // Low social meters make NPCs more eager to stop for a chat
          let chance = START_CHANCE;
          if ((profA?.social ?? 100) < 40 || (profB?.social ?? 100) < 40) chance += 0.25;
          if (Math.random() >= chance) continue;

          this._start(a, b, profA, profB);
          if (this._active.filter(c => c.kind !== 'ambient').length >= MAX_ACTIVE) return;
        }
      }
    },

    _start(ctrlA, ctrlB, profA, profB) {
      const aName  = ctrlA.eventName, bName = ctrlB.eventName;
      const script = _buildScript(profA, profB, aName, bName);

      for (const ctrl of [ctrlA, ctrlB]) {
        ctrl.state = 'conversing';
        ctrl.path  = [];
        ctrl._lastDispatchedNeed = null;
      }
      ctrlA.turnToward?.(ctrlB.event);
      ctrlB.turnToward?.(ctrlA.event);

      this._active.push({
        kind: script.kind, agreement: script.agreement,
        a: ctrlA, b: ctrlB, aName, bName,
        lines: script.lines, idx: 0,
        nextLineAt: performance.now() + 600,
        mapId: $gameMap.mapId(),
        spoken: [],
        faceToFace: true,
      });
    },

    // ---- ambient chatter ----------------------------------------------------

    _scanAmbient() {
      if (Math.random() >= AMBIENT_CHANCE) return;
      const ctrls = this._eligibleControllers(AMBIENT_STATES);
      const pairs = [];
      for (let i = 0; i < ctrls.length; i++) {
        for (let j = i + 1; j < ctrls.length; j++) {
          const a = ctrls[i], b = ctrls[j];
          const dist = Math.abs(a.event.x - b.event.x) + Math.abs(a.event.y - b.event.y);
          if (dist > AMBIENT_DIST) continue;
          if (this._onCooldown(a.eventName, b.eventName, AMBIENT_COOLDOWN_MIN)) continue;
          pairs.push([a, b]);
        }
      }
      if (!pairs.length) return;
      const [a, b] = _pickFrom(pairs);

      this._active.push({
        kind: 'ambient', agreement: true,
        a, b, aName: a.eventName, bName: b.eventName,
        lines: _pickFrom(AMBIENT_SCRIPTS()), idx: 0,
        nextLineAt: performance.now() + 400,
        mapId: $gameMap.mapId(),
        spoken: [],
        faceToFace: false,
      });
    },

    // ---- playback -----------------------------------------------------------

    _step(convo, now) {
      const { a, b } = convo;
      const valid =
        $gameMap?.mapId() === convo.mapId &&
        a.event && !a.event._erased && b.event && !b.event._erased &&
        (!convo.faceToFace || (a.state === 'conversing' && b.state === 'conversing'));
      if (!valid) { this._end(convo, true); return; }

      if (now < convo.nextLineAt) return;

      const [who, rawText] = convo.lines[convo.idx];
      const speakerCtrl = who === 0 ? a : b;
      // Same script, different mouths: each line is flavored by its speaker's
      // personality voice, so the two participants never sound interchangeable.
      const speakerPers = _personalityNameOf(_getProfile(speakerCtrl.eventName));
      const text = applyVoice(
        _resolveLine(rawText, convo.aName, convo.bName),
        speakerPers, VOICE_CHANCE_DIALOGUE);

      if (convo.faceToFace) {
        a.turnToward?.(b.event);
        b.turnToward?.(a.event);
      }
      window.NPCSim?.emit?.('npc:thought', { name: speakerCtrl.eventName, thought: text });
      convo.spoken.push({ speaker: speakerCtrl.eventName, text });

      convo.idx++;
      convo.nextLineAt = now + LINE_MS;
      if (convo.idx >= convo.lines.length) this._end(convo, false);
    },

    _end(convo, aborted) {
      this._active = this._active.filter(c => c !== convo);
      const { aName, bName } = convo;
      this._setCooldown(aName, bName);

      // Release the participants back to their routines
      for (const ctrl of [convo.a, convo.b]) {
        if (ctrl && ctrl.state === 'conversing') {
          ctrl._lastDispatchedNeed = null;
          try { ctrl.decideNextGoal?.(); } catch (_) { ctrl.state = 'idle'; }
        }
      }

      // An exchange that barely started leaves no trace
      if (convo.spoken.length < 2) return;

      ConversationLog.record(aName, bName, convo.kind, convo.spoken);

      const profA = _getProfile(aName);
      const profB = _getProfile(bName);
      _bumpMeetCount(profA, bName);
      _bumpMeetCount(profB, aName);

      // Social meters refill a bit, that's what the chat was for
      for (const p of [profA, profB]) {
        if (p && p.social !== undefined) p.social = Math.min(100, p.social + (convo.faceToFace ? 20 : 8));
      }

      if (convo.faceToFace && !aborted) {
        // Same relationship swings as the old ThoughtsMenu social events
        const delta = convo.kind === 'positive' ? _rand(3, 8)
                    : convo.kind === 'negative' ? -_rand(2, 7)
                    : convo.kind === 'debate'   ? (convo.agreement ? _rand(3, 8) : -_rand(2, 7))
                    : 1;
        _modifyRelationship(profA, bName, delta);
        _modifyRelationship(profB, aName, delta);
        // "met X" keeps the social-web/contacts UI fed (see _extractContacts)
        window.NPCSim?.StoryLogger?.record?.(aName, 'social', 'NPCSim.log.met', { name: bName });
        window.NPCSim?.StoryLogger?.record?.(bName, 'social', 'NPCSim.log.met', { name: aName });
      }
    },

    hideAll() {
      for (const convo of [...this._active]) this._end(convo, true);
    },
  };

  // ---------------------------------------------------------------------------
  // II.4 POLITICS & WORLD PROVIDERS
  // ---------------------------------------------------------------------------
  // Fill the I.7 / I.8 templates with live facts from NPCPolitics and
  // NPCWorldWeb, then hand the line back voiced. Both return null whenever
  // the source plugin (or this NPC's identity) isn't available, so everything
  // degrades gracefully.

  const WorldProvider = {
    fill(template, ctx) {
      // Fallbacks are words a player reads, so they live with the rest of them.
      const fb = bank('ConvWorld.fallback');
      return String(template)
        .replace(/{group}/g, ctx.group ?? fb.group)
        .replace(/{festival}/g, ctx.festival ?? fb.festival)
        .replace(/{epidemic}/g, ctx.epidemic ?? fb.epidemic)
        .replace(/{headline}/g, ctx.headline ?? fb.headline);
    },

    _pickRaw(ctx) {
      // Most pressing topic first: plague > crime > festival > economy >
      // wanted player > headline > market chatter.
      const r = Math.random();
      if (ctx.epidemic && r < 0.35) return this.fill(_pickFrom(WORLD_THOUGHTS().epidemic), ctx);
      if (ctx.crimeWave && r < 0.5) return this.fill(_pickFrom(WORLD_THOUGHTS().crimeWave), ctx);
      if (ctx.festival && r < 0.6) return this.fill(_pickFrom(WORLD_THOUGHTS().festival), ctx);
      if (ctx.boom && r < 0.7) return this.fill(_pickFrom(WORLD_THOUGHTS().boom), ctx);
      if (ctx.bust && r < 0.7) return this.fill(_pickFrom(WORLD_THOUGHTS().bust), ctx);
      if (ctx.playerNotorious && r < 0.8) return this.fill(_pickFrom(WORLD_THOUGHTS().outlaw), ctx);
      if (ctx.headline && r < 0.92) return this.fill(_pickFrom(WORLD_THOUGHTS().headline), ctx);
      if (ctx.marketMood) return this.fill(_pickFrom(WORLD_THOUGHTS().market[ctx.marketMood]), ctx);
      return null;
    },

    pickWorldThought(profile) {
      const name = profile?._eventName;
      if (!window.NPCWorldWeb?.getConversationContext) return null;
      let ctx;
      try { ctx = window.NPCWorldWeb.getConversationContext(name); } catch (_) { return null; }
      if (!ctx) return null;
      const line = this._pickRaw(ctx);
      return line ? applyVoice(line, _personalityNameOf(profile)) : null;
    },
  };

  const PoliticsProvider = {
    fill(template, ctx) {
      const fb = bank('ConvPolitics.fallback');
      return String(template)
        .replace(/{party}/g, ctx.partyName ?? fb.party)
        .replace(/{head}/g, ctx.headName ?? fb.head)
        .replace(/{title}/g, ctx.headTitle ?? fb.title)
        .replace(/{power}/g, ctx.powerName ?? fb.power)
        .replace(/{days}/g, ctx.daysToElection ?? "?")
        .replace(/{election}/g, (ctx.electionLabel ?? fb.election).toLowerCase())
        .replace(/{gripe}/g, ctx.gripe ?? fb.gripe)
        .replace(/{rumorSubject}/g, ctx.rumorSubject ?? fb.rumorSubject)
        .replace(/{rumorKind}/g, ctx.rumorKind ?? fb.rumorKind)
        .replace(/{winner}/g, ctx.lastWinnerName ?? fb.winner)
        .replace(/{office}/g, ctx.localOffice ?? fb.office)
        .replace(/{group}/g, ctx.group ?? fb.group);
    },

    _pickRaw(ctx) {
      // Most salient topic first: holding office > hot rumor > policy pain
      // > imminent election > fresh result > general stance.
      const r = Math.random();
      if (ctx.localOffice && r < 0.25) return this.fill(_pickFrom(OFFICE_HOLDER_THOUGHTS()), ctx);
      if (ctx.rumorSubject && r < 0.40) return this.fill(_pickFrom(POLITICAL_RUMOR_THOUGHTS()), ctx);
      if (ctx.gripe && r < 0.55) return this.fill(_pickFrom(POLICY_GRUMBLES()), ctx);
      if (ctx.daysToElection != null && ctx.daysToElection <= 30 && r < 0.75) {
        return this.fill(_pickFrom(ELECTION_THOUGHTS().upcoming), ctx);
      }
      if (ctx.lastWinnerName && ctx.engagement >= 25 && r < 0.85) {
        return this.fill(_pickFrom(ctx.lastElectionWon ? ELECTION_THOUGHTS().won : ELECTION_THOUGHTS().lost), ctx);
      }
      const pool = POLITICAL_THOUGHTS()[ctx.stance] || POLITICAL_THOUGHTS().apathetic;
      return this.fill(_pickFrom(pool), ctx);
    },

    pickPoliticalThought(profile) {
      const name = profile?._eventName;
      if (!name || !window.NPCPolitics?.getConversationContext) return null;
      let ctx;
      try { ctx = window.NPCPolitics.getConversationContext(name); } catch (_) { return null; }
      if (!ctx) return null;
      const line = this._pickRaw(ctx);
      return line ? applyVoice(line, _personalityNameOf(profile)) : null;
    },
  };

  // ---------------------------------------------------------------------------
  // II.5 THOUGHT PROVIDER
  // ---------------------------------------------------------------------------
  // The single entry point NPCSimulationCore's ThoughtGenerator delegates to.
  // Mixes every solo-dialogue source by personality and situation:
  //   - familiar-with-player musings  (shared pool, voiced per personality)
  //   - situational weather/time      (situation × personality, own line each)
  //   - personalityCoreThoughts       (personality inner voice, fires at random)
  //   - need-based templates          (shared pool, voiced per personality)

  const SituationalThoughts = {
    pick(profile) {
      const persName = _personalityNameOf(profile);
      if (Math.random() < 0.5) {
        let type = 'clear';
        const w = ($gameScreen && ($gameScreen.weatherType?.() ?? $gameScreen._weatherType)) || 'none';
        if (w === 'rain' || w === 'storm' || w === 'snow') type = w;
        const pool = WEATHER_THOUGHTS()[type];
        return _pickFrom((persName && pool[persName]) || pool.default);
      }
      const hour = $gameVariables?.value(23) ?? 12;
      const tod  = hour >= 5 && hour < 12 ? 'morning'
                 : hour >= 12 && hour < 17 ? 'afternoon'
                 : hour >= 17 && hour < 21 ? 'evening' : 'night';
      const pool = TIME_THOUGHTS()[tod];
      return _pickFrom((persName && pool[persName]) || pool.default);
    },
  };

  // A craving speaks up before anything else does: an NPC who wants a cigarette
  // is not thinking about the weather. It only opens its mouth once the want is
  // real (CRAVING_SPEAKS_AT) and gets louder from there, so an addict in the
  // street is quiet most of the day and unmistakable near the end of a cycle.
  const CRAVING_SPEAKS_AT = 70;
  const CRAVING_WITHDRAWAL_AT = 95;

  const CravingProvider = {
    pick(profile) {
      const system = window.AddictionSystem;
      if (!system || !system.profileWorst) return null;
      let worst = null;
      try { worst = system.profileWorst(profile); } catch (_) { return null; }
      if (!worst || worst.value < CRAVING_SPEAKS_AT) return null;

      // How close they are to the end of their cycle is how likely they are to
      // say something about it, up to half the time when it is unbearable.
      const bite = (worst.value - CRAVING_SPEAKS_AT) / (100 - CRAVING_SPEAKS_AT);
      if (Math.random() > bite * 0.5) return null;

      const table = worst.value >= CRAVING_WITHDRAWAL_AT
        ? CRAVING_WITHDRAWAL_THOUGHTS() : CRAVING_THOUGHTS();
      const pool = table && table[worst.key];
      if (!pool || !pool.length) return null;
      return applyVoice(_pickFrom(pool), _personalityNameOf(profile));
    },
  };

  const ThoughtProvider = {
    get personalityCoreThoughts() { return PERSONALITY_CORE_THOUGHTS(); },

    pickThought(profile) {
      if (!profile) return null;
      // A body that wants something talks over everything else it might say.
      const craving = CravingProvider.pick(profile);
      if (craving) return craving;
      // Political life occasionally crowds out everything else, officeholders,
      // hot rumors and looming elections speak up via PoliticsProvider.
      if (Math.random() < 0.12) {
        const t = PoliticsProvider.pickPoliticalThought(profile);
        if (t) return t;
      }
      // So does the state of the world, crime waves, booms, plagues and
      // headlines from the world web speak up via WorldProvider.
      if (Math.random() < 0.12) {
        const t = WorldProvider.pickWorldThought(profile);
        if (t) return t;
      }
      const r = Math.random();
      if ((profile.playerOpinion ?? 0) >= 20 && r < 0.12) {
        return applyVoice(_pickFrom(FAMILIAR_THOUGHTS()), _personalityNameOf(profile));
      }
      if (r < 0.28) {
        const t = SituationalThoughts.pick(profile);
        if (t) return t;
      }
      if (r < 0.46) {
        const t = this.pickPersonalityCoreThought(profile);
        if (t) return t;
      }
      return this.pickNeedThought(profile);
    },

    pickNeedThought(profile) {
      const pool = NEED_THOUGHTS()[profile?.currentNeed ?? null] || NEED_THOUGHTS()[null];
      return applyVoice(_pickFrom(pool), _personalityNameOf(profile));
    },

    pickPersonalityCoreThought(profile) {
      const name = _personalityOf(profile)?.name;
      const pool = name ? PERSONALITY_CORE_THOUGHTS()[name] : null;
      return pool?.length ? _pickFrom(pool) : null;
    },

    // Crime narration with the coveted/stolen item's name baked in.
    // kind: 'intent' (wants to steal it) | 'success' (stole it) | 'caught'.
    crimeThought(profile, kind, itemName) {
      const pool = kind === 'intent'  ? CRIME_INTENT_THOUGHTS()
                 : kind === 'success' ? CRIME_SUCCESS_THOUGHTS()
                 : CRIME_CAUGHT_THOUGHTS();
      const line = _pickFrom(pool).replace('{item}', itemName || 'that');
      return applyVoice(line, _personalityNameOf(profile));
    },

    // Opinion about a specific shop item, baked with its name. kind: 'buy'
    // (just purchased it) | 'browse' (a law-abiding customer eyeing it on
    // display). The reaction tracks the price tag (cheap vs. pricey) and is
    // tinted by the NPC's personality, both via applyVoice and an occasional
    // appended disposition line keyed off their traits/morality.
    itemThought(profile, itemData, kind = 'browse') {
      if (!itemData) return null;
      const name  = itemData.name || 'that';
      const price = Number(itemData.price) || 0;
      const tier  = price >= 400 ? 'pricey' : 'cheap';
      const table = kind === 'buy' ? ITEM_BUY_THOUGHTS() : ITEM_BROWSE_THOUGHTS();
      let line = _pickFrom(table[tier]).replace('{item}', name);

      // Occasionally append a disposition aside that reflects who they are.
      const disp = this._shoppingDisposition(profile);
      if (disp && ITEM_DISPOSITION_THOUGHTS()[disp] && Math.random() < 0.5) {
        line += ' ' + _pickFrom(ITEM_DISPOSITION_THOUGHTS()[disp]);
      }
      return applyVoice(line, _personalityNameOf(profile));
    },

    // Maps an NPC's traits/wealth/morality onto one of the disposition pools.
    _shoppingDisposition(profile) {
      if (!profile) return null;
      const traitNames = (profile.traitIds || []).map(id => {
        const d = window._NPCSocietyDataLoader?.traits?.find(t => t.id === id);
        return (d?.name || '').toLowerCase();
      });
      const has = (kw) => traitNames.some(n => n.includes(kw));
      if (has('greed') || (profile.moralityScore ?? 0) < -30) return 'greedy';
      if (has('generous') || has('kind'))                     return 'generous';
      if (has('vain') || has('proud') || (profile.wealthTierBase ?? 0) >= 3) return 'vain';
      if (has('frugal') || has('thrift') || (profile.wealthTierBase ?? 0) <= 1) return 'frugal';
      return null;
    },

    // Reaction line after finishing a capability interaction (cooking, bank...).
    // Personality core thoughts occasionally bleed through here too, so even
    // these reactions vary by who's having them.
    pickCapabilityThought(profile, capabilityId) {
      const pool = CAPABILITY_THOUGHTS()[capabilityId];
      if (!pool) return null;
      if (Math.random() < 0.15) {
        const t = this.pickPersonalityCoreThought(profile);
        if (t) return t;
      }
      return applyVoice(_pickFrom(pool), _personalityNameOf(profile));
    },
  };

  // ---------------------------------------------------------------------------
  // II.6 THOUGHT BUBBLES (formerly NPCThoughtBubble.js)
  // ---------------------------------------------------------------------------
  // Whenever "npc:thought" fires (NPCSimulationCore's ThoughtGenerator, or a
  // conversation line above), a small parchment speech-bubble fades in above
  // that NPC's sprite, lingers briefly, then fades back out. The whole layer
  // is DOM-only; under the Node test harness ThoughtBubbleManager stays null.

  const BUBBLE_DISPLAY_MS  = 4000; // ms the bubble stays fully visible
  const BUBBLE_FADE_MS     = 800;  // ms of the fade-out transition
  const BUBBLE_MAX_ONSCREEN = 9;   // pooled bubble elements (one per chatty NPC)

  const ThoughtBubbleManager = (typeof document === 'undefined') ? null : (() => {

    // Screen-space helpers (mirrors MousePan's Window_EventHover projection).
    // getBoundingClientRect forces layout, so the result is memoized per frame
    // and shared by every bubble.
    let _scaleCache = null;
    let _scaleFrame = -1;
    function _msgGetScale() {
      if (_scaleCache && _scaleFrame === Graphics.frameCount) return _scaleCache;
      const el = document.getElementById('gameCanvas');
      if (!el) return { sx: 1, sy: 1, ox: 0, oy: 0 };
      const r = el.getBoundingClientRect();
      _scaleFrame = Graphics.frameCount;
      _scaleCache = { sx: r.width / Graphics.width, sy: r.height / Graphics.height, ox: r.left, oy: r.top };
      return _scaleCache;
    }

    function _tileScreenPos(ev) {
      // Reuse the character's own screen-projection (screenX is already the
      // sprite's horizontal center; screenY is its anchor near the feet) so the
      // bubble tracks exactly what's drawn, including any shift/jump/zoom
      // a movement or camera plugin applies, instead of drifting from a
      // separately reimplemented tile-to-pixel formula.
      return {
        x: ev.screenX(),
        y: ev.screenY() - $gameMap.tileHeight(),
      };
    }

    // One pooled HTML element with its own show/fade/release lifecycle
    class ThoughtBubble {
      constructor() {
        this.el = document.createElement('div');
        this.el.className = 'npc-thought-bubble';
        document.body.appendChild(this.el);
        this.npcName     = null;
        this._hideTimer  = null;
        this._killTimer  = null;
        this._ev         = null; // resolved Game_Event, cached per map
        this._evMapId    = 0;
        this._height     = 0;    // offsetHeight, re-read only when text changes
        this._lastLeft   = null;
        this._lastTop    = null;
      }

      show(npcName, text) {
        this._clearTimers();
        this.npcName = npcName;
        this.el.textContent = text;
        this.el.classList.remove('fading');
        this.el.style.display = 'block';
        // Force a reflow so the transition restarts cleanly when a bubble is reused mid-fade
        void this.el.offsetWidth;
        this.el.classList.add('visible');
        // Height only changes with the text, so measure once here instead of per frame
        this._height = this.el.offsetHeight || 32;
        this._lastLeft = null;
        this._lastTop  = null;

        this._hideTimer = setTimeout(() => this.fade(), BUBBLE_DISPLAY_MS);
      }

      fade() {
        if (!this.npcName) return;
        this.el.classList.remove('visible');
        this.el.classList.add('fading');
        this._killTimer = setTimeout(() => this.release(), BUBBLE_FADE_MS);
      }

      release() {
        this._clearTimers();
        this.npcName = null;
        this._ev = null;
        this.el.style.display = 'none';
        this.el.classList.remove('visible', 'fading');
      }

      _clearTimers() {
        if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
        if (this._killTimer) { clearTimeout(this._killTimer); this._killTimer = null; }
      }

      destroy() {
        this._clearTimers();
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
      }

      updatePosition(ev) {
        if (!ev || !$gameMap) return;
        const sc  = _msgGetScale();
        const pos = _tileScreenPos(ev);
        const h   = this._height || 32;
        const y   = pos.y - h - 16; // float just above the sprite's head
        // left points to the NPC's horizontal center; CSS translateX(-50%) centers the bubble on it
        const left = Math.round(sc.ox + pos.x * sc.sx);
        const top  = Math.round(sc.oy + y * sc.sy);
        if (left !== this._lastLeft) { this.el.style.left = left + 'px'; this._lastLeft = left; }
        if (top  !== this._lastTop)  { this.el.style.top  = top  + 'px'; this._lastTop  = top;  }
      }
    }

    // Routes "npc:thought" events to a small pool of bubbles and keeps them
    // tracking their NPC's sprite every frame
    return {
      _bubbles: [],
      _byName: new Map(),

      _acquire(npcName) {
        let bubble = this._bubbles.find(b => !b.npcName);
        if (!bubble && this._bubbles.length < BUBBLE_MAX_ONSCREEN) {
          bubble = new ThoughtBubble();
          this._bubbles.push(bubble);
        }
        if (!bubble) {
          // Every slot busy, recycle the longest-running one
          bubble = this._bubbles[0];
          if (bubble.npcName) this._byName.delete(bubble.npcName);
        }
        this._byName.set(npcName, bubble);
        return bubble;
      },

      queue(npcName, text) {
        if (!npcName || !text || !$gameMap) return;
        // Only worth showing if the NPC is actually on the current map
        const ev = $gameMap.events().find(e => (e.event()?.name || '') === npcName);
        if (!ev || ev.isTransparent()) return;
        if ($gamePlayer) {
          const dx = ev.x - $gamePlayer.x, dy = ev.y - $gamePlayer.y;
          if (Math.sqrt(dx * dx + dy * dy) > 64) return;
        }

        const bubble = this._byName.get(npcName) || this._acquire(npcName);
        bubble._ev = ev;
        bubble._evMapId = $gameMap.mapId();
        bubble.show(npcName, text);
        bubble.updatePosition(ev);
      },

      update() {
        if (!$gameMap) return;
        const mapId = $gameMap.mapId();
        for (const bubble of this._bubbles) {
          if (!bubble.npcName) continue;
          let ev = bubble._ev;
          // Cached Game_Event is only valid on the map it was resolved on
          if (!ev || bubble._evMapId !== mapId) {
            ev = $gameMap.events().find(e => (e.event()?.name || '') === bubble.npcName) || null;
            bubble._ev = ev;
            bubble._evMapId = mapId;
          }
          if (!ev || ev.isTransparent()) {
            this._byName.delete(bubble.npcName);
            bubble.fade();
            continue;
          }
          bubble.updatePosition(ev);
        }
      },

      hideAll() {
        for (const bubble of this._bubbles) bubble.release();
        this._byName.clear();
      },
    };
  })();

  // NPCSimulationCore's ThoughtGenerator emits "npc:thought" (via its shared
  // _push helper) every time it records a scheduled or capability-reaction
  // thought onto profile.thoughts, that's our cue to pop a bubble.
  if (ThoughtBubbleManager) {
    const _tryRegister = () => {
      if (!window.NPCSim?.on) return false;
      window.NPCSim.on('npc:thought', ({ name, thought }) => {
        ThoughtBubbleManager.queue(name, thought);
      });
      return true;
    };
    if (!_tryRegister()) {
      let attempts = 0;
      const retry = setInterval(() => {
        if (_tryRegister()) { clearInterval(retry); return; }
        if (++attempts >= 60) {
          clearInterval(retry);
          console.warn('[NPCConversation] NPCSim never became available; thought-bubble events disabled.');
        }
      }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // II.7 SCENE HOOKS & GLOBALS
  // ---------------------------------------------------------------------------

  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);
    ConversationManager.update();
    if (ThoughtBubbleManager) ThoughtBubbleManager.update();
  };

  const _Scene_Map_terminate = Scene_Map.prototype.terminate;
  Scene_Map.prototype.terminate = function () {
    ConversationManager.hideAll();
    if (ThoughtBubbleManager) ThoughtBubbleManager.hideAll();
    _Scene_Map_terminate.call(this);
  };

  window.NPCConversation = {
    ConversationManager,
    ConversationLog,
    SituationalThoughts,
    ThoughtProvider,
    CravingProvider,
    PoliticsProvider,
    WorldProvider,
    ThoughtBubbleManager, // null when running headless (Node test harness)
    // Full dialogue database, exposed for debugging / future tools
    // Read live, so the debug view follows a language switch too.
    get DialogueDB() {
      return {
        POSITIVE_SCRIPTS: POSITIVE_SCRIPTS(), NEGATIVE_SCRIPTS: NEGATIVE_SCRIPTS(),
        NEUTRAL_SCRIPTS: NEUTRAL_SCRIPTS(), DEBATE_SCRIPTS: DEBATE_SCRIPTS(),
        AMBIENT_SCRIPTS: AMBIENT_SCRIPTS(), NEED_THOUGHTS: NEED_THOUGHTS(),
        FAMILIAR_THOUGHTS: FAMILIAR_THOUGHTS(), CAPABILITY_THOUGHTS: CAPABILITY_THOUGHTS(),
        CRAVING_THOUGHTS: CRAVING_THOUGHTS(), CRAVING_WITHDRAWAL_THOUGHTS: CRAVING_WITHDRAWAL_THOUGHTS(),
        PERSONALITY_CORE_THOUGHTS: PERSONALITY_CORE_THOUGHTS(), WEATHER_THOUGHTS: WEATHER_THOUGHTS(),
        TIME_THOUGHTS: TIME_THOUGHTS(), POLITICAL_THOUGHTS: POLITICAL_THOUGHTS(),
        ELECTION_THOUGHTS: ELECTION_THOUGHTS(), POLITICAL_RUMOR_THOUGHTS: POLITICAL_RUMOR_THOUGHTS(),
        POLICY_GRUMBLES: POLICY_GRUMBLES(), OFFICE_HOLDER_THOUGHTS: OFFICE_HOLDER_THOUGHTS(),
        POLITICAL_DEBATE_SCRIPTS: POLITICAL_DEBATE_SCRIPTS(), WORLD_THOUGHTS: WORLD_THOUGHTS(),
        PERSONALITY_VOICES: PERSONALITY_VOICES(),
        PERSONALITY_TONE_BIAS, PERSONALITY_DEBATE_AFFINITY,
      };
    },
    get personalityCoreThoughts() { return PERSONALITY_CORE_THOUGHTS(); },
    applyVoice,
    _personalityNameOf,
  };

  console.log('[NPCConversation] v2.3.0 loaded, NPC↔NPC dialogues & thought bubbles active.');
})();
