//=============================================================================
// ErisDateSystem.js - Enhanced Dating System with Branching Paths
// Version: 2.1.0
// Author: Assistant
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Eris Dating System v2.1.0 - Branching dialogue paths on the parchment book spread
 * @author Assistant
 * @version 2.1.0
 * @description A dating system featuring Eris with dynamic branching dialogue paths
 *
 * @param opinionVariable
 * @text Opinion Variable ID
 * @desc Variable ID that stores Eris's opinion (0-1000)
 * @type variable
 * @default 78
 *
 * @param genderVariable
 * @text Gender Variable ID
 * @desc Variable ID for player gender (1=male, 2=female, 3=nonbinary, 4=cocoon)
 * @type variable
 * @default 38
 *
 * @help ErisDateSystem.js
 *
 * Features:
 * - Runs on the same parchment book spread as ErisTrial.js: the conversation
 *   is logged one line at a time on the left page (confirm to advance) while
 *   the right page keeps Eris's portrait, mood, location and the opinion meter
 * - The date happens in a real biome, not a hand-picked landmark: every biome
 *   in js/db/WorldGen/Biomes.json owns its own intro, opening question, romantic
 *   beat, chaotic beat, shared activity and local incidents, so a date on a salt
 *   flat reads nothing like a date in a sewer. The directional variants of a
 *   road or a river are one biome ("Road cross" is a road), and every alien
 *   surface falls back to AlienPlanet
 * - Dynamic branching dialogue paths based on choices
 * - Opinion system (0-1000)
 * - Choice tracking that influences conversations
 * - Multiple dialogue branches based on mood and opinion
 * - Narrator descriptions
 * - Gender-aware dialogue
 * - Multiple endings based on opinion level
 * - Personality tracking (Romantic, Chaotic, Thoughtful, Bold)
 * - Procedural evening: the location (when unset), the weather, how Eris turned
 *   up, what she brought and the incidents between phases are all rolled per
 *   date, and every spoken line resolves "{a|b|c}" alternations as it is said,
 *   so no two dates read the same
 * - The first date that ends well (one of the good endings, or a bond of 0.45
 *   with Em) earns a parting gift: a Blade seed, handed over once per save and
 *   remembered in $gameSystem._erisGiftGiven
 * - Em (switch 48, or an actor named Em in the party) gets a different date
 *   entirely: Eris drops the act and confesses the things docs/Lore.odt says she
 *   has never told anyone. Each secret is spent for good
 *   ($gameSystem._erisEmSecrets) so the next date goes further, and how far it
 *   got is written to $gameSystem._erisEmBond (0..1), which ErisTrial.js reads
 *   when it decides whether to convict her
 *
 * Plugin Commands:
 * - Start Date: Begin a date at specified location
 *
 * @command startDate
 * @text Start Date
 * @desc Begin a date with Eris, in whichever biome the party is standing in
 *
 * @arg mood
 * @text Eris's Initial Mood
 * @desc Her starting mood for the date
 * @type select
 * @option Playful
 * @value playful
 * @option Romantic
 * @value romantic
 * @option Chaotic
 * @value chaotic
 * @option Nervous
 * @value nervous
 * @option Confident
 * @value confident
 * @default playful
 */

(() => {
  "use strict";

  const pluginName = "ErisDateSystem";
  const parameters = PluginManager.parameters(pluginName);
  const opinionVariableId = parseInt(parameters["opinionVariable"] || 78);
  const genderVariableId = parseInt(parameters["genderVariable"] || 38);

  // Eris's date mood, shown as a real IconSet glyph instead of an emoji
  // (indices per js/db/Sprites/Icons.json), same as the trial's mood badge.
  const MOOD_ICONS = {
    playful: 89,    // Pink Star
    romantic: 84,   // Heart
    chaotic: 10,    // Confusion
    nervous: 86,    // Half Heart
    confident: 87   // Gold Star
  };
  const MOOD_ICON_DEFAULT = 7; // Charmed
  const OPINION_ICON = 84;     // Heart

  // The one thing she owns that a mortal cannot buy off her. She parts with it
  // at the end of the first evening that actually went well, once per save, and
  // never brings it up again.
  const GIFT_ITEM_ID = 165; // Blade seed
  const GIFT_FLAG = "_erisGiftGiven";

  const MOOD_LABELS = () => dateBank('ErisDate.moodLabels');

  const TRAIT_LABELS = () => dateBank('ErisDate.traitLabels');

  // Inline IconSet sprite for the date's DOM pages.
  function erisIconHTML(iconIndex, size = 20) {
    const x = (iconIndex % 16) * size;
    const y = Math.floor(iconIndex / 16) * size;
    return `<span class="eris-icon" style="display:inline-block;vertical-align:middle;width:${size}px;height:${size}px;` +
      `background-image:url('img/system/IconSet.png');background-size:${size * 16}px auto;` +
      `background-position:-${x}px -${y}px;image-rendering:pixelated;"></span>`;
  }

  function moodIconHTML(mood, size = 20) {
    return erisIconHTML(MOOD_ICONS[mood] || MOOD_ICON_DEFAULT, size);
  }

  //=============================================================================
  // Procedural date flavour
  //=============================================================================
  //
  // No two dates should read the same. Same three layers as the trial:
  //   1. vary()  - inline "{a|b|c}" alternation resolved as each line is spoken
  //   2. banks   - the weather, what she is wearing, what she brought and what
  //                goes wrong are rolled when the date opens
  //   3. beats   - small incidents dropped between the scripted phases
  // Deliberately not world-seeded: the point is that the same player never gets
  // the same date twice.

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const lang = () => (T('ErisDate.line.en'));
  // The date's words live in js/i18n/<lang>/conversations/ErisDate.json.
  // Lazy views onto it, re-resolved when the language changes.
  let _dateBankLang = null;
  const _dateBankCache = new Map();
  function dateBank(key) {
    const lang_ = T.language();
    if (lang_ !== _dateBankLang) { _dateBankLang = lang_; _dateBankCache.clear(); }
    if (!_dateBankCache.has(key)) _dateBankCache.set(key, T.obj(key));
    return _dateBankCache.get(key);
  }
  // The banks come out of dateBank() already in the active language, as arrays.
  // The {en, it} form is the pre-i18n shape and is still tolerated here.
  const bank = (b) => {
    const value = (typeof b === "function") ? b() : b;
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return value[lang()] || value.en || [];
    return [];
  };
  const pickFrom = (b) => pick(bank(b));

  // Resolves "{a|b|c}" groups innermost-first, so groups can nest.
  function vary(text) {
    if (typeof text !== "string" || text.indexOf("{") < 0) return text;
    let out = text;
    let guard = 0;
    while (guard++ < 64) {
      const next = out.replace(/\{([^{}]*)\}/, (m, body) => pick(body.split("|")));
      if (next === out) break;
      out = next;
    }
    return out;
  }

  //=============================================================================
  // Where the date happens: a biome, not a landmark
  //=============================================================================
  //
  // The date used to run in one of six authored places. It now runs in whichever
  // biome the party is standing in, and every biome in Biomes.json carries its
  // own set of lines in ErisDate.biomes.<Key>:
  //
  //   label      the name on the badge on the right page
  //   intro      the narration the evening opens on
  //   opening    optional: Eris's very first lines here, overriding the mood bank
  //   question   what she asks about the place, in the first interaction
  //   choices    optional: replaces the four generic answers to that question
  //   romantic   [narration, ...her lines] for the romantic path's local beat
  //   chaotic    the narration of what she does to this place when she plays up
  //   activity   [her suggestion, the narration of doing it] on the standard path
  //   incidents  local interruptions, mixed into the generic incident bank
  //
  // Everything but label/intro/question is optional; a biome that omits a field
  // borrows the fallback biome's. That is what keeps the alien surfaces and any
  // biome added later playable without new prose.

  const BIOME_FALLBACK = 'Fields';

  // "Road cross", "Road t-left" and "River vertical" are a road and a river. The
  // 40-odd Alien<Type> surfaces (AlienBiomes.json) all read as one alien world.
  function biomeKey(name) {
    if (!name) return null;
    let n = String(name).trim();
    n = n.replace(/\s+(vertical|horizontal|cross|t-(?:up|down|left|right)|corner-(?:up|down)-(?:left|right))$/i, '');
    if (/^Alien./i.test(n)) n = 'AlienPlanet';
    return n;
  }

  const BIOME_BANK = () => dateBank('ErisDate.biomes') || {};

  function biomeEntry(key) {
    const bank = BIOME_BANK();
    return bank[key] || bank[BIOME_FALLBACK] || {};
  }

  // A field of the entry, falling back to the fallback biome's so a half-written
  // (or brand new) biome can never leave a phase with nothing to say.
  function biomeField(key, field) {
    const bank = BIOME_BANK();
    const entry = bank[key];
    const value = entry && entry[field];
    if (Array.isArray(value) ? value.length : value) return value;
    const base = bank[BIOME_FALLBACK] || {};
    return base[field];
  }

  // Every biome the date knows how to run in.
  function knownBiomes() {
    const keys = Object.keys(BIOME_BANK());
    return keys.length ? keys : [BIOME_FALLBACK];
  }

  // The biome under the party's feet: the procedural generator's current biome
  // first, then a static map's <Biome: X> note. Null off both, which the caller
  // turns into a roll.
  function currentBiome() {
    const proc = window.$gameSystem && $gameSystem._procGenData;
    const fromProc = proc && (proc.currentBiome || proc.currentBiomeName);
    if (fromProc) return biomeKey(fromProc);
    const meta = window.$dataMap && $dataMap.meta && $dataMap.meta.Biome;
    if (meta && typeof meta === 'string') return biomeKey(meta);
    return null;
  }

  // Where the date happens is not a decision any more: it is wherever the party
  // already is. An explicit key is only honoured for a caller that constructs an
  // ErisDate directly (window.ErisDate); the plugin command passes nothing, and
  // the old "location" argument on it is gone, along with the six landmarks it
  // used to offer. Off any recognisable biome the evening falls back to Fields.
  function resolveDateBiome(request) {
    const bank = BIOME_BANK();
    const asked = String(request == null ? '' : request).trim();
    if (asked && asked.toLowerCase() === 'random') return pick(knownBiomes());
    if (asked && asked.toLowerCase() !== 'current') {
      const direct = biomeKey(asked);
      if (bank[direct]) return direct;
      const ci = Object.keys(bank).find(k => k.toLowerCase() === String(direct).toLowerCase());
      if (ci) return ci;
    }
    const here = currentBiome();
    if (here && bank[here]) return here;
    return bank[BIOME_FALLBACK] ? BIOME_FALLBACK : pick(knownBiomes());
  }

  // Conditions on the day. Discord does not do good weather reliably.
  const DATE_WEATHER = () => dateBank('ErisDate.dateWeather');

  // How she turned up.
  const DATE_ERIS_LOOK = () => dateBank('ErisDate.dateErisLook');

  // Something she brought, or produced from nowhere.
  const DATE_GIFTS = () => dateBank('ErisDate.dateGifts');

  // Small incidents. Dropped in between the scripted phases.
  const DATE_INCIDENTS = () => dateBank('ErisDate.dateIncidents');

  // Things she brings up unprompted, in her own voice.
  const DATE_SMALL_TALK = () => dateBank('ErisDate.dateSmallTalk');

  //=============================================================================
  // Em
  //=============================================================================
  //
  // With Em across the table the date stops being a game. The lore (docs/Lore.odt)
  // is that Eris bends probability to ruin Em's life out of jealousy over Bubba,
  // that Bubba feels nothing for Em and still loves Eris, and that Eris cannot
  // have him because her own future self killed Maat in 2012 and dragged her back
  // onto the path to the throne. Given a good enough evening she says some of it
  // out loud. What she admits is remembered ($gameSystem._erisEmSecrets) so the
  // next date goes further, and how far it got becomes $gameSystem._erisEmBond,
  // which ErisTrial reads when it decides whether to convict her.

  const ErisEmState = {
    inPlay() {
      if (window.$gameSwitches && $gameSwitches.value(48)) return true;
      return !!(window.$gameParty && $gameParty.members &&
        $gameParty.members().some(m => m && m.name() === "Em"));
    },
    bond() {
      if (!window.$gameSystem) return 0;
      return Math.max(0, Math.min(1, Number($gameSystem._erisEmBond) || 0));
    },
    setBond(value) {
      if (!window.$gameSystem) return;
      $gameSystem._erisEmBond = Math.max(0, Math.min(1, Number(value) || 0));
    },
    told() {
      if (!window.$gameSystem) return [];
      if (!$gameSystem._erisEmSecrets) $gameSystem._erisEmSecrets = [];
      return $gameSystem._erisEmSecrets;
    },
    tell(key) {
      const told = this.told();
      if (key && told.indexOf(key) < 0) told.push(key);
    }
  };

  // Everything she has never said to the witch, in the order she is least able
  // to keep it in. Each one is spent for good once told.
  const EM_SECRETS_META = [{"key":"cList"},{"key":"route666"},{"key":"paradox"},{"key":"bubba"},{"key":"jealousy"},{"key":"throne"},{"key":"futureSelf"}];
  const EM_SECRETS = () => EM_SECRETS_META.map((m) => Object.assign({}, m, { lines: dateBank('ErisDate.emSecrets')[m.key] }));

  // How she opens when it is Em sitting across from her, before her guard drops.
  const EM_DATE_OPENINGS = () => dateBank('ErisDate.emDateOpenings');

  // What Em can say back when a secret lands. Order matters: index 0 is the
  // warm reply, index 1 the honest one, index 2 the one that costs her.
  const EM_SECRET_REPLIES = () => dateBank('ErisDate.emSecretReplies');

  // While the book spread is open the player must not walk away from the date
  // or open the pause menu over it (the DOM message box used to block both).
  let dateActive = false;

  const _Game_Player_canMove_ErisDate = Game_Player.prototype.canMove;
  Game_Player.prototype.canMove = function () {
    if (dateActive) return false;
    return _Game_Player_canMove_ErisDate.call(this);
  };

  const _Scene_Map_isMenuEnabled_ErisDate = Scene_Map.prototype.isMenuEnabled;
  Scene_Map.prototype.isMenuEnabled = function () {
    if (dateActive) return false;
    return _Scene_Map_isMenuEnabled_ErisDate.call(this);
  };

  //=============================================================================
  // ErisDate Class
  //=============================================================================
  class ErisDate {
    constructor(location, mood) {
      // A biome key from here on ("Beach", "Sewer", "SaltFlats"), never a
      // landmark. Anything the caller hands over is resolved against the bank.
      this.location = BIOME_BANK()[location] ? location : resolveDateBiome(location);
      this.mood = mood || 'playful';
      this.opinion = $gameVariables.value(opinionVariableId) || 500;

      // Is it the witch across the table? Everything below reads differently.
      this.isEm = ErisEmState.inPlay();
      this.secretsToldNow = 0;
      // Set by whichever ending the evening earns; only the good ones set it,
      // and only a set one buys the parting gift.
      this._wentWell = false;

      // The evening itself, rolled fresh: weather, how she turned up, what she
      // brought. None of it repeats between dates.
      this.scene = {
        weather: pickFrom(DATE_WEATHER()),
        look: pickFrom(DATE_ERIS_LOOK()),
        gift: pickFrom(DATE_GIFTS())
      };
      this.playerGender = $gameVariables.value(genderVariableId) || 1;
      this._container = null;
      this._dialogueLog = [];
      this._datePhase = 0;
      this._choicesMade = [];
      
      // Track player personality through choices
      this.playerTraits = {
        romantic: 0,
        chaotic: 0,
        thoughtful: 0,
        bold: 0
      };
      
      // Track conversation flags for branching
      this.conversationFlags = {
        impressedHer: false,
        madeHerLaugh: false,
        sharedSecret: false,
        causedChaos: false,
        showedVulnerability: false,
        challengedHer: false
      };
      
      // Gender-specific terms
      this.genderTerms = this.getGenderTerms();
    }

    // Pronouns and terms of address per gender id (1 male, 2 female,
    // 3 non-binary, 4 cocoon). They are interpolated into the spoken lines of
    // both languages, so they live in the namespace with everything else Eris
    // says; the table used to be English only, which had her calling an Italian
    // player "handsome". Non-binary is the fallback.
    getGenderTerms() {
      const terms = T.obj('ErisDate.genderTerms') || {};
      
      return terms[this.playerGender] || terms[3];
    }

    async startDate() {
      this._createDateUI();

      try {
        await this.showNarration(this.getLocationIntro());
        // The evening's own details, rolled for this date only.
        await this.showNarration(`${this.scene.weather}\n${this.scene.look}`);

        // With Em the whole script is different: she is not playing.
        if (this.isEm) {
          await this.emDate();
          return;
        }

        await this.showOpening();
        await this.showNarration(this.scene.gift);

        // Main date phases with branching
        await this.firstInteraction();
        await this.maybeIncident(0.5);

        // Branch based on first interaction
        if (this.conversationFlags.impressedHer || this.playerTraits.romantic > 0) {
          await this.romanticPath();
        } else if (this.conversationFlags.madeHerLaugh || this.playerTraits.chaotic > 0) {
          await this.chaoticPath();
        } else if (this.playerTraits.thoughtful > 0) {
          await this.intellectualPath();
        } else {
          await this.standardPath();
        }

        await this.maybeIncident(0.55);
        await this.finalMoment();
        await this.dateEnding();
      } finally {
        // Never strand the player behind a half-open book spread.
        this.cleanup();
      }
    }

    // A field of this date's biome, with the fallback biome behind it.
    _biome(field) {
      return biomeField(this.location, field);
    }

    // Drops a small incident or an unprompted remark between the scripted
    // phases. Most of the time it says nothing, so the pacing varies as well.
    // Two incidents in three are local to the biome when it has any of its own.
    async maybeIncident(chance = 0.5) {
      if (Math.random() > chance) return;
      if (Math.random() < 0.6) {
        const local = this._biome('incidents');
        const useLocal = Array.isArray(local) && local.length && Math.random() < 0.66;
        await this.showNarration(useLocal ? pick(local) : pickFrom(DATE_INCIDENTS()));
      } else {
        await this.showErisDialogue(pickFrom(DATE_SMALL_TALK()));
      }
    }

    //=========================================================================
    // The Em date
    //=========================================================================
    //
    // Eris spends every trial bending cosmic law to ruin this woman's life. Sat
    // across a table from her with no gavel in reach, she does the other thing:
    // she talks. Each secret is spent for good ($gameSystem._erisEmSecrets), so
    // a second date starts where the first one stopped, and how far it got is
    // written to $gameSystem._erisEmBond, which ErisTrial reads in court.
    async emDate() {
      const t = this._t();

      const opening = pickFrom(EM_DATE_OPENINGS());
      for (const line of opening) {
        await this.showErisDialogue(line);
      }
      await this.showNarration(this.scene.gift);

      // Three rounds. Each one is either a secret (if the evening has earned
      // one) or ordinary talk, with an incident dropped in between.
      for (let round = 0; round < 3; round++) {
        const secret = this.nextEmSecret();
        // She opens up further as the evening goes well; a bad reply shuts the
        // next one down.
        const earned = secret && this.opinion >= 250 + round * 150;
        if (earned) {
          await this.tellEmSecret(secret);
        } else {
          await this.showErisDialogue(pickFrom(DATE_SMALL_TALK()));
          const replies = T.pool('ErisDate.bank.emDate.replies');
          const choice = await this.presentChoice(replies, [40, 40, 20]);
          if (choice === 1) this.playerTraits.thoughtful++;
          if (choice === 0) this.playerTraits.romantic++;
          if (choice === 2) this.playerTraits.bold++;
        }
        await this.maybeIncident(0.6);
      }

      await this.emFinale();
      await this.emEnding();
      await this.maybeGiveGift();
    }

    // The next thing she has never told Em, or null once they are all spent.
    nextEmSecret() {
      const told = ErisEmState.told();
      return EM_SECRETS().find(s => told.indexOf(s.key) < 0) || null;
    }

    async tellEmSecret(secret) {
      const t = this._t();

      for (const line of secret.lines) {
        await this.showErisDialogue(line);
      }

      // Spent for good: the next date picks up from the one after this.
      ErisEmState.tell(secret.key);
      this.secretsToldNow++;
      this.conversationFlags.sharedSecret = true;
      this.conversationFlags.showedVulnerability = true;

      // Warm / honest / cutting, in that order.
      const replies = pickFrom(EM_SECRET_REPLIES());
      const choice = await this.presentChoice(replies, [70, 50, -80]);
      if (choice === 0) {
        this.playerTraits.romantic++;
        this.conversationFlags.impressedHer = true;
        await this.showErisDialogue(T('ErisDate.line.donTDonTBe'));
      } else if (choice === 1) {
        this.playerTraits.thoughtful++;
        await this.showErisDialogue(T('ErisDate.line.fineAllRightIfYou'));
      } else {
        this.playerTraits.bold++;
        this.conversationFlags.challengedHer = true;
        await this.showErisDialogue(T('ErisDate.line.noYouReRightIt'));
      }
    }

    // Where the evening lands: Bubba, the future self, and what she wants Em to
    // do with any of it.
    async emFinale() {
      const t = this._t();
      await this.showNarration(T('ErisDate.line.forALongMomentNeither'));

      if (this.opinion >= 700) {
        const lines = T.pool('ErisDate.bank.emFinale.lines');
        for (const line of lines) await this.showErisDialogue(line);
        await this.presentChoice(T.pool('ErisDate.bank.emFinale.lines'),
          [60, 40, 60]);
      } else if (this.opinion >= 400) {
        const lines = T.pool('ErisDate.bank.emFinale.lines2');
        for (const line of lines) await this.showErisDialogue(line);
      } else {
        const lines = T.pool('ErisDate.bank.emFinale.lines3');
        for (const line of lines) await this.showErisDialogue(line);
      }
    }

    // Writes the bond ErisTrial reads. Opinion carries most of it; the secrets
    // she has actually said out loud carry the rest, and those never reset.
    async emEnding() {
      const t = this._t();
      const toldTotal = ErisEmState.told().length;
      const bond = Math.max(0, Math.min(1,
        (this.opinion / 1000) * 0.6 + (toldTotal / EM_SECRETS().length) * 0.4
      ));
      ErisEmState.setBond(bond);
      $gameVariables.setValue(opinionVariableId, this.opinion);

      // Anything that actually loosened her counts as an evening that went
      // well, the same way the ordinary date's good endings do.
      this._wentWell = bond >= 0.45;

      if (bond >= 0.75) {
        await this.showNarration(T('ErisDate.line.theGoddessOfDiscordHas'));
      } else if (bond >= 0.45) {
        await this.showNarration(T('ErisDate.line.somethingHasLoosenedTheNext'));
      } else {
        await this.showNarration(T('ErisDate.line.nothingHasChangedTheOdds'));
      }
    }

    getLocationIntro() {
      return this._biome('intro');
    }

    async showOpening() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisAppearsWithAnEnigmatic')
      );
      
      const openings = this.getOpeningDialogue();
      for (const line of openings) {
        await this.showErisDialogue(line);
      }
    }

    getOpeningDialogue() {
      // A biome may own her very first words here, the way the station does.
      const local = this._biome('opening');
      if (Array.isArray(local) && local.length) return local;
      if (this.opinion >= 900) {
        return T.pool('ErisDate.bank.getOpeningDialogue.lines2');
      } else if (this.opinion < 100) {
        return T.pool('ErisDate.bank.getOpeningDialogue.lines3');
      }
      
      // Normal openings based on mood
      const openings = {
        playful: T.pool('ErisDate.bank.getOpeningDialogue.playful')
          .map(line => line.replace('{address}', this.genderTerms.address)),
        
        romantic: T.pool('ErisDate.bank.getOpeningDialogue.romantic')
          .map(line => line.replace('{formal}', this.genderTerms.formal)),
        
        chaotic: T.pool('ErisDate.bank.getOpeningDialogue.chaotic')
      };
      
      return openings[this.mood] || openings.playful;
    }
    getFirstQuestion() {
      return this._biome('question');
    }

    getFirstChoices() {
      // A biome whose question is too specific for the four generic answers
      // supplies its own set.
      const local = this._biome('choices');
      if (Array.isArray(local) && local.length) return local;
      return T.pool('ErisDate.bank.getFirstChoices.lines2');
    }
    async firstInteraction() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(T('ErisDate.line.erisWatchesYou'));
      
      const questions = this.getFirstQuestion();
      for (const line of questions) {
        await this.showErisDialogue(line);
      }
      
      const choices = this.getFirstChoices();
      const choiceIndex = await this.presentChoice(choices);
      
      // Handle first choice with branching consequences
      await this.handleFirstChoice(choiceIndex);
    }
    // Presents the choices on the left page and resolves with the picked index
    // so callers can branch on what the player actually said.
    async presentChoice(choices, opinionChanges = null) {
      const index = await this._showChoicesDOM(choices);

      if (opinionChanges && opinionChanges[index] !== undefined) {
        this.changeOpinion(opinionChanges[index]);
      } else {
        // Default opinion changes based on choice position
        const defaultChanges = [20, 10, 5, -5];
        this.changeOpinion(defaultChanges[index] || 0);
      }

      this._choicesMade.push(index);
      return index;
    }
    async handleFirstChoice(choiceIndex) {
      const useTranslation = ConfigManager.language === "it";
      
      switch(choiceIndex) {
        case 0: // "It's incredible!"
          this.playerTraits.romantic += 1;
          this.conversationFlags.impressedHer = true;
          this.changeOpinion(30);
          
          await this.showErisDialogue(
            T('ErisDate.line.ohNotManyTrulyAppreciate')
          );
          
          await this.showNarration(
            T('ErisDate.line.erisSEyesLightUp')
          );
          break;
          
        case 1: // "A bit chaotic for my taste"
          this.playerTraits.thoughtful += 1;
          this.changeOpinion(-5);
          
          await this.showErisDialogue(
            T('ErisDate.line.hmmYouPreferOrderHow')
          );
          
          await this.showNarration(
            T('ErisDate.line.erisSeemsToAcceptThe')
          );
          break;
          
        case 2: // "I preferred when you were the goddess of discord"
          this.playerTraits.bold += 1;
          this.conversationFlags.challengedHer = true;
          this.changeOpinion(15);
          
          await this.showErisDialogue(
            T('ErisDate.line.ohBoldILikeMortals')
          );
          
          await this.showNarration(
            T('ErisDate.line.aMischievousSmileSpreadsAcross')
          );
          break;
          
        case 3: // "I like anything you like"
          this.playerTraits.romantic += 2;
          this.changeOpinion(10);
          
          await this.showErisDialogue(
            T('ErisDate.line.flattererButItSSweet')
          );
          
          await this.showNarration(
            T('ErisDate.line.erisBlushesSlightlyClearlyFlattered')
          );
          break;
      }
    }

    async romanticPath() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.theAtmosphereSoftensErisSeems')
      );
      
      // Romantic branch event
      await this.romanticEvent();
      
      // Deep conversation
      await this.romanticConversation();
      
      // Special romantic moment
      if (this.opinion >= 600) {
        await this.specialRomanticMoment();
      }
    }

    async romanticEvent() {
      const useTranslation = ConfigManager.language === "it";
      
      // The biome's own romantic beat: index 0 narrates, the rest is Eris.
      const beat = this._biome('romantic') || [];
      for (let i = 0; i < beat.length; i++) {
        if (i === 0) await this.showNarration(beat[i]);
        else await this.showErisDialogue(beat[i]);
      }

      const choices = T.pool('ErisDate.bank.romanticEvent.choices');
      
      const choiceIndex = await this.presentChoice(choices, [-300, 35, -10, -25]);      
      // Additional branching based on romantic choice
      if (choiceIndex === 0) {
        this.conversationFlags.showedVulnerability = true;
        await this.showErisDialogue(
          T('ErisDate.line.nobodyNobodyHasEverTold')
        );
      }
    }

    async romanticConversation() {
      const useTranslation = ConfigManager.language === "it";
      
      if (this.conversationFlags.showedVulnerability) {
        await this.showErisDialogue(
          T('ErisDate.line.youKnowBeingAGoddess')
        );
        
        await this.showErisDialogue(
          T('ErisDate.line.butYouYouSeeMe')
        );
      } else {
        await this.showErisDialogue(
          T('ErisDate.line.itSBeenALong')
        );
      }
      
      const choices = T.pool('ErisDate.bank.romanticConversation.choices');
      
      await this.presentChoice(choices, [-30, 35, 25, -40]);
    }

    async specialRomanticMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisMovesCloserHerScent')
      );
      
      await this.showErisDialogue(
        T('ErisDate.line.canICanITry')
      );
      
      const choices = T.pool('ErisDate.bank.specialRomanticMoment.choices');
      
      const choiceIndex = await this.presentChoice(choices, [-30, -25, -20, 15]);
      
      if (choiceIndex < 2) {
        this.conversationFlags.sharedSecret = true;
        await this.showNarration(
          T('ErisDate.line.erisClosesHerEyesAnd')
        );
      }
    }

    async chaoticPath() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.theEnergyAroundYouBecomes')
      );
      
      await this.chaoticEvent();
      await this.chaoticChallenge();
      
      if (this.playerTraits.chaotic >= 2) {
        await this.ultimateChaos();
      }
    }

    async chaoticEvent() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showErisDialogue(
        T('ErisDate.line.youKnowWhatSWrong')
      );
      
      await this.showErisDialogue(
        T('ErisDate.line.letMeShowYouHow')
      );
      
      // What she does to this particular place when she stops behaving.
      await this.showNarration(this._biome('chaotic'));

      const choices = T.pool('ErisDate.bank.chaoticEvent.choices');
      
      const choiceIndex = await this.presentChoice(choices, [40, 20, -20, 35]);      
      if (choiceIndex === 0 || choiceIndex === 3) {
        this.playerTraits.chaotic += 2;
        this.conversationFlags.causedChaos = true;
      }
    }

    async chaoticChallenge() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showErisDialogue(
        T('ErisDate.line.hereSAChallengeFor')
      );
      
      await this.showNarration(
        T('ErisDate.line.erisCreatesThreePortalsBefore')
      );
      
      const choices = T.pool('ErisDate.bank.chaoticChallenge.choices');
      
      const choiceIndex = await this.presentChoice(choices, [-20, -20, 20, 50]);
      
      if (choiceIndex === 3) {
        this.playerTraits.bold += 2;
        this.playerTraits.chaotic += 3;
        this.conversationFlags.madeHerLaugh = true;
        
        await this.showErisDialogue(
          T('ErisDate.line.ahahahahaYouReInsaneI')
        );
      }
    }

    async ultimateChaos() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisSExcitementReachesIts')
      );
      
      await this.showErisDialogue(
        T('ErisDate.line.wantToSeeRealChaos')
      );
      
      await this.showNarration(
        T('ErisDate.line.everythingAroundYouExplodesInto')
      );
      
      this.conversationFlags.causedChaos = true;
    }

    async intellectualPath() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisTiltsHerHeadIntrigued')
      );
      
      await this.philosophicalDebate();
      await this.intellectualChallenge();
      
      if (this.playerTraits.thoughtful >= 3) {
        await this.deepPhilosophicalMoment();
      }
    }

    async philosophicalDebate() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showErisDialogue(
        T('ErisDate.line.interestingNotManyMortalsTake')
      );
      
      await this.showErisDialogue(
        T('ErisDate.line.tellMeWhatDoYou')
      );
      
      const choices = T.pool('ErisDate.bank.philosophicalDebate.choices');
      
      const choiceIndex = await this.presentChoice(choices, [-30, 40, 25, -40]);
      
      this.playerTraits.thoughtful += 2;
      
      if (choiceIndex === 1 || choiceIndex === 3) {
        this.conversationFlags.impressedHer = true;
        await this.showErisDialogue(
          T('ErisDate.line.ohIDidnTExpect')
        );
      }
    }

    async intellectualChallenge() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showErisDialogue(
        T('ErisDate.line.hereSARiddleFor')
      );
      
      const choices = T.pool('ErisDate.bank.intellectualChallenge.choices');
      
      const choiceIndex = await this.presentChoice(choices, [-10, -100, 35, -20]);
      
      if (choiceIndex >= 2) {
        await this.showErisDialogue(
          T('ErisDate.line.brilliantILikeHowYour')
        );
        this.playerTraits.thoughtful += 2;
      }
    }

    async deepPhilosophicalMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisSitsBesideYouUnusually')
      );
      
      await this.showErisDialogue(
        T('ErisDate.line.youKnowInAllMy')
      );
      
      await this.showErisDialogue(
        T('ErisDate.line.youMakeMeQuestionThings')
      );
      
      this.conversationFlags.impressedHer = true;
    }

    async standardPath() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.theDateProceedsMoreTraditionally')
      );
      
      await this.standardActivity();
      await this.gettingToKnowYou();
      await this.unexpectedMoment();
    }

    async standardActivity() {
      const useTranslation = ConfigManager.language === "it";
      
      // What there is to do here: she suggests it (index 0), then you do it.
      const activity = this._biome('activity') || [];
      for (let i = 0; i < activity.length; i++) {
        if (i === 0) await this.showErisDialogue(activity[i]);
        else await this.showNarration(activity[i]);
      }

      const choices = T.pool('ErisDate.bank.standardActivity.choices');
      
      await this.presentChoice(choices, [-20, 25, 10, 30]);
    }

    async gettingToKnowYou() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showErisDialogue(
        T('ErisDate.line.whatAboutYouWhatDoes')
      );
      
      const choices = T.pool('ErisDate.bank.gettingToKnowYou.choices');
      
      const choiceIndex = await this.presentChoice(choices, [25, -200, 20, -25]);      
      if (choiceIndex === 0) {
        this.playerTraits.bold += 1;
        await this.showErisDialogue(
          T('ErisDate.line.anAdventureSeekerThenWe')
        );
      } else if (choiceIndex === 3) {
        this.playerTraits.romantic += 1;
        await this.showErisDialogue(
          T('ErisDate.line.blushesFlattererButDoGo')
        );
      }
    }

    async unexpectedMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.suddenlySomethingUnexpectedHappens')
      );
      
      const events = [
        async () => {
          await this.showNarration(
            T('ErisDate.line.aGroupOfSmallChaotic')
          );
          
          await this.showErisDialogue(
            T('ErisDate.line.ohNoMyGremlinsExcuse')
          );
        },
        
        async () => {
          await this.showNarration(
            T('ErisDate.line.anotherDeityPassesByAnd')
          );
          
          await this.showErisDialogue(
            T('ErisDate.line.thatWasUmLetS')
          );
        },
        
        async () => {
          await this.showNarration(
            T('ErisDate.line.youAccidentallyTripButEris')
          );
          
          await this.showErisDialogue(
            T('ErisDate.line.carefulCanTLoseMy')
          );
          
          this.conversationFlags.sharedSecret = true;
        }
      ];
      
      const event = events[Math.floor(Math.random() * events.length)];
      await event();
      
      const choices = T.pool('ErisDate.bank.unexpectedMoment.choices');
      
      await this.presentChoice(choices, [15, -10, 20, -30]);
    }

    async finalMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.timeSeemsToSlowDown')
      );
      
      // Check conversation flags and traits for special endings
      if (this.conversationFlags.sharedSecret && this.playerTraits.romantic >= 3) {
        await this.perfectRomanticFinale();
      } else if (this.conversationFlags.causedChaos && this.playerTraits.chaotic >= 4) {
        await this.chaoticLoveFinale();
      } else if (this.conversationFlags.impressedHer && this.playerTraits.thoughtful >= 3) {
        await this.intellectualConnectionFinale();
      } else if (this.opinion >= 900) {
        await this.loveConfession();
      } else if (this.opinion >= 700) {
        await this.romanticMoment();
      } else if (this.opinion >= 400) {
        await this.friendlyMoment();
      } else if (this.opinion >= 100) {
        await this.awkwardMoment();
      } else {
        await this.hostileMoment();
      }
    }

    async perfectRomanticFinale() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisLooksAtYouWith')
      );
      
      const finale = T.pool('ErisDate.bank.finale')
        .map(line => line.replace('{address}', this.genderTerms.address));
      
      for (const line of finale) {
        await this.showErisDialogue(line);
      }
      
      const choices = T.pool('ErisDate.bank.perfectRomanticFinale.choices');
      
      await this.presentChoice(choices, [60, 55, -65, 70]);
      this.opinion = Math.min(1000, this.opinion + 100);
    }

    async chaoticLoveFinale() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.theEnergyAroundYouExplodes')
      );
      
      const finale = T.pool('ErisDate.bank.chaoticLoveFinale.finale');
      
      for (const line of finale) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.sheLiftsYouAndSpins')
      );
      
      const choices = T.pool('ErisDate.bank.chaoticLoveFinale.choices');
      
      await this.presentChoice(choices, [70, 65, 60, 75]);
      this.opinion = Math.min(1000, this.opinion + 100);
    }

    async intellectualConnectionFinale() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisStudiesYouWithAn')
      );
      
      const finale = T.pool('ErisDate.bank.intellectualConnectionFinale.finale');
      
      for (const line of finale) {
        await this.showErisDialogue(line);
      }
      
      const choices = T.pool('ErisDate.bank.intellectualConnectionFinale.choices');
      
      await this.presentChoice(choices, [-65, 70, 60, -75]);
      this.opinion = Math.min(1000, this.opinion + 100);
    }
    // Continuation of ErisDateSystem.js after intellectualConnectionFinale

    async loveConfession() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisMovesCloserHerEyes')
      );
      
      const confession = T.pool('ErisDate.bank.confession')
        .map(line => line.replace('{address}', this.genderTerms.address));
      
      for (const line of confession) {
        await this.showErisDialogue(line);
      }
      
      const choices = T.pool('ErisDate.bank.loveConfession.choices');
      
      await this.presentChoice(choices, [-50, -40, 30, -100]);    }

    async romanticMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.thereSSomethingInThe')
      );
      
      const romantic = T.pool('ErisDate.bank.romanticMoment.romantic');
      
      for (const line of romantic) {
        await this.showErisDialogue(line);
      }
      
      const choices = T.pool('ErisDate.bank.romanticMoment.choices');
      
      await this.presentChoice(choices, [30, 25, -35, -20]);
    }

    async friendlyMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.theAtmosphereIsComfortableLike')
      );
      
      const friendly = T.pool('ErisDate.bank.friendlyMoment.friendly');
      
      for (const line of friendly) {
        await this.showErisDialogue(line);
      }
      
      const choices = T.pool('ErisDate.bank.friendlyMoment.choices');
      
      await this.presentChoice(choices, [15, 20, 10, 25]);
    }

    async awkwardMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.anAwkwardSilenceFallsBetween')
      );
      
      const awkward = T.pool('ErisDate.bank.awkwardMoment.awkward');
      
      for (const line of awkward) {
        await this.showErisDialogue(line);
      }
      
      const choices = T.pool('ErisDate.bank.awkwardMoment.choices');
      
      await this.presentChoice(choices, [-10, 5, 15, -25]);    }

    async hostileMoment() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.theTensionIsPalpableEris')
      );
      
      const hostile = T.pool('ErisDate.bank.hostileMoment.hostile');
      
      for (const line of hostile) {
        await this.showErisDialogue(line);
      }
      
      const choices = T.pool('ErisDate.bank.hostileMoment.choices');
      
      await this.presentChoice(choices, [5, -5, -10, -20]);
    }

    async dateEnding() {
      const useTranslation = ConfigManager.language === "it";

      // Update final opinion
      $gameVariables.setValue(opinionVariableId, this.opinion);

      // ...and the bond the courtroom reads, the same channel Em and Bubba have
      // (ErisTrial.js, window.ErisPlayerBond). Opinion carries most of it; the
      // number of evenings actually seen through carries the rest, and unlike
      // opinion that count never falls. A goddess who has had dinner with the
      // defendant is measurably worse at pretending she has not: it softens her
      // mood in court, drops the odds of a conviction, shortens what she hands
      // down and, high enough, throws the case out before the charges are read.
      this.recordPlayerBond();

      await this.showNarration(
        T('ErisDate.line.theDateComesToAn')
      );
      
      // Check for special endings based on traits and flags
      if (this.playerTraits.romantic >= 5 && this.playerTraits.chaotic >= 3) {
        await this.wildRomanceEnding();
      } else if (this.playerTraits.thoughtful >= 4 && this.conversationFlags.impressedHer) {
        await this.intellectualEnding();
      } else if (this.playerTraits.bold >= 4 && this.conversationFlags.causedChaos) {
        await this.chaosChampionEnding();
      } else if (this.opinion >= 900) {
        await this.perfectEnding();
      } else if (this.opinion >= 700) {
        await this.goodEnding();
      } else if (this.opinion >= 400) {
        await this.neutralEnding();
      } else if (this.opinion >= 100) {
        await this.badEnding();
      } else {
        await this.terribleEnding();
      }

      await this.maybeGiveGift();
      await this.showCourtroomNote();
    }

    // The first evening that ends well, she hands over a Blade seed: the one
    // irreversible thing a goddess of discord has any patience for. Once per
    // save, whoever she spent it on, so the flag lives beside the opinion.
    async maybeGiveGift() {
      if (!this._wentWell) return;
      if (!window.$gameSystem || $gameSystem[GIFT_FLAG]) return;
      const item = window.$dataItems && $dataItems[GIFT_ITEM_ID];
      if (!item) return;

      $gameSystem[GIFT_FLAG] = true;
      $gameParty.gainItem(item, 1);

      await this.showNarration(T('ErisDate.line.giftOffered'));
      for (const line of T.pool('ErisDate.bank.firstGift.lines')) {
        await this.showErisDialogue(line);
      }
      await this.showNarration(T('ErisDate.line.giftReceived', { item: item.name }));
    }

    // What the evening is actually worth the next time she is holding a gavel,
    // stated plainly, the way Em's ending states hers.
    async showCourtroomNote() {
      if (this.isEm) return;
      const t = this._t();
      const bond = window.ErisPlayerBond ? window.ErisPlayerBond.bond()
        : Math.max(0, Math.min(1, Number($gameSystem._erisPlayerBond) || 0));

      if (bond >= 0.75) {
        await this.showNarration(T('ErisDate.line.theGoddessOfJusticeHas'));
      } else if (bond >= 0.45) {
        await this.showNarration(T('ErisDate.line.theBenchWillLeanYour'));
      } else if (bond > 0) {
        await this.showNarration(T('ErisDate.line.sheWillRememberThisEvening'));
      }
    }

    async wildRomanceEnding() {
      const useTranslation = ConfigManager.language === "it";
      this._wentWell = true;

      await this.showNarration(
        T('ErisDate.line.erisEmbracesYouAsReality')
      );
      
      const ending = T.pool('ErisDate.bank.wildRomanceEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.specialEndingWildRomanceLove')
      );
    }

    async intellectualEnding() {
      const useTranslation = ConfigManager.language === "it";
      this._wentWell = true;

      await this.showNarration(
        T('ErisDate.line.erisTakesYourHandHer')
      );
      
      const ending = T.pool('ErisDate.bank.intellectualEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.specialEndingMentalConnectionTwo')
      );
    }

    async chaosChampionEnding() {
      const useTranslation = ConfigManager.language === "it";
      this._wentWell = true;

      await this.showNarration(
        T('ErisDate.line.erisLaughsAsTheWorld')
      );
      
      const ending = T.pool('ErisDate.bank.chaosChampionEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.specialEndingChaosChampionPartners')
      );
    }

    async perfectEnding() {
      const useTranslation = ConfigManager.language === "it";
      this._wentWell = true;

      await this.showNarration(
        T('ErisDate.line.erisTakesYourHandHer2')
      );
      
      const ending = T.pool('ErisDate.bank.perfectEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.perfectEndingTheChaosOf')
      );
    }

    async goodEnding() {
      const useTranslation = ConfigManager.language === "it";
      this._wentWell = true;

      await this.showNarration(
        T('ErisDate.line.erisSmilesWarmlyARare')
      );
      
      const ending = T.pool('ErisDate.bank.goodEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.goodEndingAPromisingConnection')
      );
    }

    async neutralEnding() {
      const useTranslation = ConfigManager.language === "it";
      
      const ending = T.pool('ErisDate.bank.neutralEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.neutralEndingAnUncertainNew')
      );
    }

    async badEnding() {
      const useTranslation = ConfigManager.language === "it";
      
      const ending = T.pool('ErisDate.bank.badEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.badEndingDisharmoniousChaos')
      );
    }

    async terribleEnding() {
      const useTranslation = ConfigManager.language === "it";
      
      await this.showNarration(
        T('ErisDate.line.erisTurnsAwayWithObvious')
      );
      
      const ending = T.pool('ErisDate.bank.terribleEnding.ending');
      
      for (const line of ending) {
        await this.showErisDialogue(line);
      }
      
      await this.showNarration(
        T('ErisDate.line.terribleEndingTheChaosOf')
      );
    }

    changeOpinion(amount) {
      this.opinion = Math.max(0, Math.min(1000, this.opinion + amount));
      this._updateSheet();
    }

    // Writes $gameSystem._erisPlayerBond (0..1) and the running count of dates.
    // Em has her own, sharper channel (_erisEmBond, written by emEnding), so
    // this is skipped for her rather than stacked on top of it.
    recordPlayerBond() {
      if (this.isEm) return 0;
      const dates = (window.ErisPlayerBond && window.ErisPlayerBond.noteDate)
        ? window.ErisPlayerBond.noteDate()
        : ($gameSystem._erisDatesCompleted = ($gameSystem._erisDatesCompleted || 0) + 1);
      // Four good evenings is as far as familiarity alone gets anybody.
      const bond = Math.max(0, Math.min(1,
        (this.opinion / 1000) * 0.7 + Math.min(dates, 4) / 4 * 0.3
      ));
      if (window.ErisPlayerBond) window.ErisPlayerBond.setBond(bond);
      else $gameSystem._erisPlayerBond = bond;
      return bond;
    }

    _t() {
      return ConfigManager.language === "it";
    }

    //=========================================================================
    // Book spread UI (same parchment pages as ErisTrial.js)
    //=========================================================================
    _createDateUI() {
      dateActive = true;
      this._dialogueLog = [];
      this._container = document.createElement('div');
      this._container.id = 'menu-container';
      document.body.appendChild(this._container);
      this._renderBook();
    }

    _renderBook() {
      const t = this._t();
      const logHTML = this._dialogueLog.map(e => {
        const speaker = this._speakerLabel(e.who);
        const body = String(e.text).replace(/\r?\n/g, '<br>');
        const head = speaker ? `<span class="eris-speaker">${speaker}</span>` : '';
        return `<div class="eris-dialogue-entry ${this._entryClass(e.who)}">${head}${body}</div>`;
      }).join('');

      this._container.innerHTML = `
        <div class="book-spread">
          <div class="left-page" style="justify-content:flex-start;">
            <h2 class="title">${T('ErisDate.line.theDate')}</h2>
            <div class="eris-dialogue-log" id="eris-log">${logHTML}</div>
            <div class="eris-choices-panel" id="eris-choices"></div>
          </div>
          <div class="right-page" style="justify-content:flex-start;">
            <h2 class="title">Eris</h2>
            <div class="eris-date-portrait-frame">
              <img class="eris-date-portrait" src="img/pictures/Eris.png" alt="Eris">
            </div>
            <div class="eris-date-badges">
              <span class="eris-mood-badge">${moodIconHTML(this.mood)} ${this._moodLabel()}</span>
              <span class="eris-mood-badge">${this._locationLabel()}</span>
            </div>
            <div class="eris-chaos-meter">
              <div class="meter-label">${erisIconHTML(OPINION_ICON, 16)} ${T('ErisDate.line.opinion')}</div>
              <div class="eris-chaos-track">
                <div class="eris-chaos-fill eris-opinion-fill" id="eris-opinion-fill" style="width:${this.opinion / 10}%"></div>
              </div>
            </div>
            <div class="eris-bounty-total">
              <span>${T('ErisDate.line.rapport')}</span>
              <span id="eris-opinion-value">${this.opinion} / 1000</span>
            </div>
            <h3 class="h3">${T('ErisDate.line.impressions')}</h3>
            <div class="eris-crimes-list" id="eris-traits">${this._traitsHTML()}</div>
          </div>
        </div>`;

      const log = document.getElementById('eris-log');
      if (log) log.scrollTop = log.scrollHeight;
    }

    _traitsHTML() {
      // The bank is already in the active language; it is not keyed by one.
      const labels = TRAIT_LABELS() || {};
      return Object.keys(this.playerTraits).map(key =>
        `<div class="eris-trait-row"><span class="crime-name">${labels[key]}</span>` +
        `<span class="crime-bounty">${this.playerTraits[key]}</span></div>`
      ).join('');
    }

    _updateSheet() {
      if (!this._container) return;
      const fill = document.getElementById('eris-opinion-fill');
      const val = document.getElementById('eris-opinion-value');
      const traits = document.getElementById('eris-traits');
      if (fill) fill.style.width = `${this.opinion / 10}%`;
      if (val) val.textContent = `${this.opinion} / 1000`;
      if (traits) traits.innerHTML = this._traitsHTML();
    }

    _removeDateUI() {
      if (this._container) {
        this._container.style.transition = 'opacity 0.2s ease-out';
        this._container.style.opacity = '0';
        const c = this._container;
        setTimeout(() => { if (c && c.parentNode) c.parentNode.removeChild(c); }, 250);
        this._container = null;
      }
    }

    // who: 'eris', 'player' (the player's picked line) or 'narrator'
    _entryClass(who) {
      if (who === 'player') return 'player';
      if (who === 'narrator') return 'narrator';
      return 'eris';
    }

    _speakerLabel(who) {
      const t = this._t();
      if (who === 'player') return T('ErisDate.line.you');
      if (who === 'narrator') return '';
      return 'Eris';
    }

    // Every line goes through vary() first, so the "{a|b|c}" groups written into
    // the banks are rolled as they are spoken.
    _addDialogue(rawText, who = 'eris') {
      const text = vary(String(rawText));
      const clean = String(text).replace(/\\C\[\d+\]/g, '');
      this._dialogueLog.push({ who, text: clean });
      const log = document.getElementById('eris-log');
      if (log) {
        const entry = document.createElement('div');
        entry.className = `eris-dialogue-entry ${this._entryClass(who)}`;
        // Render explicit newlines as line breaks (innerHTML collapses raw \n to spaces).
        const html = clean.replace(/\r?\n/g, '<br>');
        const speaker = this._speakerLabel(who);
        entry.innerHTML = `${speaker ? `<span class="eris-speaker">${speaker}</span>` : ''}${html}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
      }
    }

    // Shows one message at a time and blocks until the player deliberately
    // presses on. The advance only arms once every advance input has been
    // released and a short minimum read time has passed, so a single keypress
    // can never skip several lines at once.
    _waitForAdvance(minReadMs = 260) {
      const t = this._t();
      const log = document.getElementById('eris-log');
      let hint = null;
      if (log) {
        hint = document.createElement('div');
        hint.className = 'eris-continue-hint';
        hint.textContent = T('ErisDate.line.pressEnterToContinue');
        log.appendChild(hint);
        log.scrollTop = log.scrollHeight;
      }

      return new Promise(resolve => {
        const readyAt = performance.now() + minReadMs;
        const advanceKeys = ['Enter', 'NumpadEnter', 'Space'];
        let armed = false;
        let active = true;

        const done = () => {
          active = false;
          document.removeEventListener('keydown', kh);
          if (log) log.removeEventListener('click', ch);
          if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
          // Drop the press so the next wait/choice does not inherit it.
          Input.clear();
          resolve();
        };
        const kh = (e) => {
          if (!armed || e.repeat) return;
          if (advanceKeys.includes(e.code)) { e.preventDefault(); SoundManager.playOk(); done(); }
        };
        const ch = () => { if (armed) { SoundManager.playOk(); done(); } };
        document.addEventListener('keydown', kh);
        if (log) log.addEventListener('click', ch);

        const poll = () => {
          if (!active) return;
          if (!armed) {
            const held = Input.isPressed('ok') || Input.isPressed('down') || Input.isPressed('right');
            if (!held && performance.now() >= readyAt) {
              armed = true;
              if (hint) hint.classList.add('ready');
            }
          } else if (Input.isTriggered('ok')) {
            SoundManager.playOk();
            done();
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    }

    _showChoicesDOM(rawChoices) {
      // Choices carry alternations too, so the player's own lines vary as well.
      const choices = rawChoices.map(vary);
      return new Promise(resolve => {
        const panel = document.getElementById('eris-choices');
        if (!panel) { resolve(0); return; }
        panel.innerHTML = '';
        let sel = 0;
        let active = true;
        let armed = false;
        const readyAt = performance.now() + 200;
        const btns = choices.map((text, i) => {
          const btn = document.createElement('div');
          btn.className = 'eris-choice-btn' + (i === 0 ? ' selected' : '');
          btn.textContent = text;
          btn.addEventListener('click', () => { if (armed) finish(i); });
          panel.appendChild(btn);
          return btn;
        });
        const upd = () => btns.forEach((b, i) => b.classList.toggle('selected', i === sel));
        const kh = (e) => {
          if (e.repeat && (e.code === 'Enter' || e.code === 'Space')) return;
          if (e.code === 'ArrowDown' || e.code === 'ArrowRight') { sel = (sel + 1) % btns.length; upd(); SoundManager.playCursor(); }
          else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') { sel = (sel - 1 + btns.length) % btns.length; upd(); SoundManager.playCursor(); }
          else if (e.code === 'Enter' || e.code === 'Space') { if (armed) finish(sel); }
        };
        const finish = (idx) => {
          active = false;
          document.removeEventListener('keydown', kh);
          this._addDialogue(choices[idx], 'player');
          panel.innerHTML = '';
          SoundManager.playOk();
          Input.clear();
          resolve(idx);
        };
        document.addEventListener('keydown', kh);

        const poll = () => {
          if (!active) return;
          if (!armed) {
            if (!Input.isPressed('ok') && performance.now() >= readyAt) armed = true;
            requestAnimationFrame(poll);
            return;
          }
          if (Input.isTriggered('down') || Input.isRepeated('down') || Input.isTriggered('right') || Input.isRepeated('right')) {
            sel = (sel + 1) % btns.length;
            upd();
            SoundManager.playCursor();
          } else if (Input.isTriggered('up') || Input.isRepeated('up') || Input.isTriggered('left') || Input.isRepeated('left')) {
            sel = (sel - 1 + btns.length) % btns.length;
            upd();
            SoundManager.playCursor();
          } else if (Input.isTriggered('ok')) {
            finish(sel);
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    }

    _moodLabel() {
      const labels = MOOD_LABELS() || {};
      return labels[this.mood] || this._capitalize(this.mood);
    }

    _locationLabel() {
      return this._biome('label') || this.location;
    }

    _capitalize(s) {
      return s ? s[0].toUpperCase() + s.slice(1) : '';
    }

    async showNarration(text) {
      this._addDialogue(text, 'narrator');
      await this._waitForAdvance();
    }

    async showErisDialogue(text) {
      this._addDialogue(text, 'eris');
      await this._waitForAdvance();
    }

    cleanup() {
      dateActive = false;
      // Persist the opinion even if the date was cut short by an error.
      $gameVariables.setValue(opinionVariableId, this.opinion);
      this._removeDateUI();
    }
  }

  //=============================================================================
  // Plugin Command Registration
  //=============================================================================
  PluginManager.registerCommand(pluginName, "startDate", args => {
    // The book spread owns the screen; never stack two dates on top of it.
    if (dateActive) return;

    // No location argument any more: the date happens where the party is. Any
    // "location" an old event still passes is ignored on purpose.
    const location = resolveDateBiome(null);

    // Randomize mood on date start
    const moods = ['playful', 'romantic', 'chaotic', 'nervous', 'confident'];
    const randomMood = moods[Math.floor(Math.random() * moods.length)];

    const date = new ErisDate(location, randomMood);
    date.startDate().catch(e => {
      console.error('[ErisDateSystem] date failed', e);
      date.cleanup();
    });
  });

  window.ErisDate = ErisDate;
})();