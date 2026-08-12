/*:
 * @target MZ
 * @plugindesc The card game's data layer: the catalogue, the 0-13 stat scale, the collection, decks, boosters and the clash resolver.
 * @author Esoteric Heavy Industries
 *
 * @help CardGameCore.js
 *
 * No scene and no plugin command of its own. This is `window.CardGame`, the one
 * place that answers what a card IS; Cards/CardGameDuel.js plays them and
 * Cards/CardGameCollection.js lists them.
 *
 * A CARD KEY is "e<enemyId>", "w<weaponId>" or "a<armorId>". Copies of one key
 * stack in the collection: what makes two copies look and read differently is
 * an INSTANCE SEED rolled when the card is played, never stored.
 *
 * STATS. Five values, STR / WIS / DEX / PSI / CON, every one of them 0-13 for
 * monsters and for equipment alike. A record is ranked against its own roster
 * (enemies against enemies, gear against gear) and the percentile IS the
 * printed value, so the spread is even instead of bunched at the bottom of a
 * raw parameter range that runs to 1,330,448 max HP.
 *
 *   STR = atk    WIS = mdf    DEX = agi    PSI = mat
 *   CON = the higher of the mhp and def percentiles, so a sack of hit points
 *         and a wall of armour both read as tough.
 *
 * Equipment is bolted onto a monster already on the board and its values are
 * added to that monster's, the total clamped back to 13. A negative parameter
 * (cursed gear) clamps to 0 rather than printing a minus.
 *
 * THE CLASH is resolved by resolveClash(), a pure function: every monster picks
 * the weakest enemy monster orthogonally beside it, every pairing is scored
 * against ONE frozen snapshot of the board, and every death is applied
 * together. One round, no cascade.
 *
 * Storage lives on $gameSystem (the binary save), so a collection belongs to
 * the party rather than to any member and is NOT shared with the world folder.
 */

(() => {
  "use strict";

  //===========================================================================
  // Constants
  //===========================================================================

  const STAT_MAX = 13;
  const STATS = ["str", "wis", "dex", "psi", "con"];
  const BOARD_SIZE = 3;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const DECK_MIN = 9;
  const DECK_MAX = 20;
  const HAND_START = 4;
  const HAND_MAX = 7;
  const PACK_SIZE = 6;
  // Nobody draws by hand: every turn opens by dealing this many cards to
  // whoever is about to play, stopping early on an empty deck or a full hand.
  const DRAW_COUNT = 2;

  // Rarity bands, weakest first. The index is what every UI colours from.
  const RARITY = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3 };
  const RARITY_KEYS = ["common", "rare", "epic", "legendary"];

  // Pack odds per slot, by rarity. The last slot of a pack rolls on the second
  // table, so every pack is guaranteed something above common.
  const PACK_ODDS = [0.66, 0.24, 0.084, 0.016];
  const PACK_ODDS_LAST = [0, 0.62, 0.30, 0.08];

  //===========================================================================
  // Seeded RNG (mulberry32) and hashing
  //===========================================================================

  function hashString(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function worldSeed() {
    try {
      if (window.NPCShared && typeof NPCShared.worldSeed === "function") return NPCShared.worldSeed() >>> 0;
      if (window.HistoryManager && typeof HistoryManager.getSeed === "function") return HistoryManager.getSeed() >>> 0;
    } catch (e) { /* boot order */ }
    return 19002001;
  }

  // A fresh appearance/wording seed for one played instance. Deliberately NOT
  // derived from the world seed: two copies of a card must differ.
  function rollSeed() {
    return (1 + Math.floor(Math.random() * 0x7ffffffe)) >>> 0;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  //===========================================================================
  // Enemy name localisation
  //===========================================================================
  // Enemy names live in js/i18n/<lang>/enemies.json, outside the namespaces the
  // T() resolver reads (plugins / conversations / lore), so they are fetched the
  // same way Quest/Bestiary.js fetches them.

  let _enemiesI18n = null;

  (async function loadEnemyNames() {
    const lang = (typeof ConfigManager !== "undefined" && ConfigManager.language) || "en";
    try {
      const response = await fetch(`js/i18n/${lang}/enemies.json`);
      _enemiesI18n = await response.json();
    } catch (e) {
      _enemiesI18n = {};
    }
  })();

  function localEnemyName(id, fallback) {
    const entry = _enemiesI18n && _enemiesI18n[id];
    if (entry && entry.name) return entry.name;
    return fallback;
  }

  //===========================================================================
  // Card keys
  //===========================================================================

  function parseKey(key) {
    const s = String(key || "");
    const type = s.charAt(0);
    const id = parseInt(s.slice(1), 10);
    if (!id || (type !== "e" && type !== "w" && type !== "a")) return null;
    return { type, id };
  }

  const monsterKey = (id) => "e" + id;
  const weaponKey = (id) => "w" + id;
  const armorKey = (id) => "a" + id;

  function dataOf(key) {
    const p = parseKey(key);
    if (!p) return null;
    if (p.type === "e") return (typeof $dataEnemies !== "undefined" && $dataEnemies[p.id]) || null;
    if (p.type === "w") return (typeof $dataWeapons !== "undefined" && $dataWeapons[p.id]) || null;
    return (typeof $dataArmors !== "undefined" && $dataArmors[p.id]) || null;
  }

  const isMonster = (key) => String(key).charAt(0) === "e";
  const isWeapon = (key) => String(key).charAt(0) === "w";
  const isArmor = (key) => String(key).charAt(0) === "a";
  const isEquip = (key) => isWeapon(key) || isArmor(key);
  const isEffect = (key) => String(key).charAt(0) === "x";

  //-------------------------------------------------------------------------
  // Effect cards
  //-------------------------------------------------------------------------
  // Not creatures and not gear: five tricks that are played ON a tile and do
  // something different depending on whether anything is standing there. Every
  // party is dealt one of each at the start, and they are never in a booster.
  //
  //   needsTarget  a second tile is picked after the first (Displace only)
  //   onMonster    what it does to whoever is standing there, either side
  //   onEmpty      what it leaves behind on bare ground
  const EFFECTS = {
    x1: { id: "halve", icon: 18 },   // Blight   : halves / cursed ground
    x2: { id: "double", icon: 26 },  // Gild     : doubles / blessed ground
    x3: { id: "cull", icon: 1 },     // Cull     : kills outright / a trap
    x4: { id: "swap", icon: 83, needsTarget: true }, // Displace : trades two tiles
    x5: { id: "ward", icon: 81 }     // Ward     : wins ties / bars the tile
  };
  const EFFECT_KEYS = Object.keys(EFFECTS);

  const effectOf = (key) => EFFECTS[String(key)] || null;
  const effectId = (key) => (EFFECTS[String(key)] || {}).id || null;

  function nameOf(key) {
    if (isEffect(key)) {
      const effect = effectOf(key);
      return effect ? T("CardGame.effect." + effect.id + ".name") : String(key);
    }
    const data = dataOf(key);
    if (!data) return String(key);
    if (isMonster(key)) return localEnemyName(data.id, data.name);
    return data.name;
  }

  //===========================================================================
  // The catalogue
  //===========================================================================
  // Built once, the first time anything asks. Every filter here is the reason a
  // record is playable at all, so a card can never be a database spacer, a
  // blank padding slot or a monster with nothing to draw on its tile.

  let _catalogue = null;

  // Database spacers: "<-- 1-10 -->" rows the editor is divided by, plus the
  // <LevelBracket> note they carry (Quest/Bestiary.js filters on the same two).
  function isDivider(record) {
    if (!record) return true;
    if (typeof record.name !== "string" || !record.name.trim()) return true;
    if (record.name.startsWith("<--")) return true;
    if (/<LevelBracket>/i.test(record.note || "")) return true;
    return false;
  }

  // The walking sprite the board tile draws, from the <Char:> tag every
  // bestiary entry is illustrated with.
  function charSheetOf(enemy) {
    const m = String(enemy && enemy.note || "").match(/<Char:\s*([^>]+)>/i);
    return m ? m[1].trim() : null;
  }

  function buildCatalogue() {
    const monsters = [];
    const weapons = [];
    const armors = [];

    if (typeof $dataEnemies !== "undefined") {
      for (const enemy of $dataEnemies) {
        if (isDivider(enemy) || !enemy.id) continue;
        // A monster with no walking sprite has nothing to stand on a tile as,
        // so it is not dealt as a card. That is also exactly the set with a
        // bespoke 3D model.
        if (!charSheetOf(enemy)) continue;
        monsters.push(monsterKey(enemy.id));
      }
    }
    if (typeof $dataWeapons !== "undefined") {
      for (const weapon of $dataWeapons) {
        if (isDivider(weapon) || !weapon.id) continue;
        if (!(weapon.params || []).some((v) => v > 0)) continue; // nothing to print
        weapons.push(weaponKey(weapon.id));
      }
    }
    if (typeof $dataArmors !== "undefined") {
      for (const armor of $dataArmors) {
        if (isDivider(armor) || !armor.id) continue;
        if (!(armor.params || []).some((v) => v > 0)) continue;
        armors.push(armorKey(armor.id));
      }
    }

    _catalogue = { monsters, weapons, armors, all: monsters.concat(weapons, armors) };
    return _catalogue;
  }

  function catalogue() {
    if (!_catalogue || !_catalogue.all.length) buildCatalogue();
    return _catalogue;
  }

  //===========================================================================
  // The 0-13 scale
  //===========================================================================
  // A raw parameter is ranked against every other record on its own roster and
  // the percentile becomes the printed value. Two ladders: creatures, and gear
  // (weapons and armours share one, so a sword and a breastplate are priced
  // against the same scale). Gear ranks against POSITIVE values only, because
  // most gear leaves most parameters at zero and ranking against those would
  // hand every sword a free helping of magic defence.

  const PARAM = { MHP: 0, MMP: 1, ATK: 2, DEF: 3, MAT: 4, MDF: 5, AGI: 6, LUK: 7 };
  const RANKED_PARAMS = [PARAM.MHP, PARAM.ATK, PARAM.DEF, PARAM.MAT, PARAM.MDF, PARAM.AGI];

  let _ladders = null;

  function buildLadder(records, positiveOnly) {
    const ladder = {};
    for (const paramId of RANKED_PARAMS) {
      const values = [];
      for (const record of records) {
        const v = (record.params || [])[paramId] || 0;
        if (positiveOnly && v <= 0) continue;
        values.push(v);
      }
      values.sort((a, b) => a - b);
      ladder[paramId] = values;
    }
    return ladder;
  }

  function buildLadders() {
    const cat = catalogue();
    const enemies = cat.monsters.map(dataOf).filter(Boolean);
    const gear = cat.weapons.concat(cat.armors).map(dataOf).filter(Boolean);
    _ladders = {
      creature: buildLadder(enemies, false),
      gear: buildLadder(gear, true)
    };
    return _ladders;
  }

  function ladders() {
    if (!_ladders) buildLadders();
    return _ladders;
  }

  // Fraction of the roster this value stands above, counting a tie as half a
  // step so a wall of identical zeroes does not all rank at the top.
  function percentile(sorted, value) {
    const n = sorted.length;
    if (!n) return 0;
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
    const below = lo;
    hi = n; let lo2 = below;
    while (lo2 < hi) { const mid = (lo2 + hi) >> 1; if (sorted[mid] <= value) lo2 = mid + 1; else hi = mid; }
    const equal = lo2 - below;
    return (below + equal * 0.5) / n;
  }

  // A percentile printed on the card. Anything the record actually has is worth
  // at least one point, so a real parameter never reads as nothing.
  function scaleValue(pct, raw) {
    const v = clamp(Math.round(STAT_MAX * pct), 0, STAT_MAX);
    if (v === 0 && raw > 0) return 1;
    return v;
  }

  const ZERO_STATS = { str: 0, wis: 0, dex: 0, psi: 0, con: 0 };

  const _statsCache = Object.create(null);

  function statsFor(key) {
    if (key in _statsCache) return _statsCache[key];
    // An effect card has no body and no numbers: it prints its rule instead.
    if (isEffect(key)) return (_statsCache[key] = Object.assign({}, ZERO_STATS));
    const data = dataOf(key);
    if (!data) return (_statsCache[key] = Object.assign({}, ZERO_STATS));

    const ladder = isMonster(key) ? ladders().creature : ladders().gear;
    const params = data.params || [];
    // Gear ranks on positives only, so a negative (cursed) parameter is simply
    // nothing rather than a minus sign on a scale that starts at zero.
    const raw = (paramId) => Math.max(0, params[paramId] || 0);
    const pct = (paramId) => (raw(paramId) > 0 ? percentile(ladder[paramId], raw(paramId)) : 0);

    const stats = {
      str: scaleValue(pct(PARAM.ATK), raw(PARAM.ATK)),
      wis: scaleValue(pct(PARAM.MDF), raw(PARAM.MDF)),
      dex: scaleValue(pct(PARAM.AGI), raw(PARAM.AGI)),
      psi: scaleValue(pct(PARAM.MAT), raw(PARAM.MAT)),
      // Constitution is whichever of bulk or armour speaks louder.
      con: scaleValue(
        Math.max(pct(PARAM.MHP), pct(PARAM.DEF)),
        Math.max(raw(PARAM.MHP), raw(PARAM.DEF))
      )
    };
    return (_statsCache[key] = stats);
  }

  function statTotal(statsOrKey) {
    const s = typeof statsOrKey === "string" ? statsFor(statsOrKey) : statsOrKey;
    return STATS.reduce((sum, id) => sum + (s[id] || 0), 0);
  }

  // A monster plus whatever has been bolted onto it, every stat clamped back to
  // the top of the scale so gear tunes a creature instead of replacing it.
  function combinedStats(cardKey, equipKeys) {
    const out = Object.assign({}, statsFor(cardKey));
    for (const key of equipKeys || []) {
      if (!key) continue;
      const bonus = statsFor(key);
      for (const id of STATS) out[id] = clamp(out[id] + bonus[id], 0, STAT_MAX);
    }
    return out;
  }

  //===========================================================================
  // Rarity
  //===========================================================================

  const _rarityCache = Object.create(null);

  function rarityOf(key) {
    if (key in _rarityCache) return _rarityCache[key];
    if (isEffect(key)) return (_rarityCache[key] = RARITY.EPIC);
    const data = dataOf(key);
    if (!data) return (_rarityCache[key] = RARITY.COMMON);

    let rarity;
    if (isMonster(key)) {
      // A boss is a boss whatever its parameters say.
      if (/<Boss>/i.test(data.note || "")) rarity = RARITY.LEGENDARY;
      else {
        const total = statTotal(key);
        rarity = total >= 52 ? RARITY.EPIC : total >= 38 ? RARITY.RARE : RARITY.COMMON;
      }
    } else {
      const price = data.price || 0;
      const craft = parseInt((String(data.note || "").match(/<CraftLevel:\s*(\d+)>/i) || [])[1], 10) || 0;
      rarity = (price >= 50000 || craft >= 5) ? RARITY.LEGENDARY
        : (price >= 12000 || craft >= 4) ? RARITY.EPIC
          : (price >= 2500 || craft >= 3) ? RARITY.RARE
            : RARITY.COMMON;
    }
    return (_rarityCache[key] = rarity);
  }

  const rarityKey = (rarity) => RARITY_KEYS[clamp(rarity, 0, 3)];
  const rarityName = (rarity) => T("CardGame.rarity." + rarityKey(rarity));

  let _byRarity = null;
  function keysByRarity(rarity) {
    if (!_byRarity) {
      _byRarity = [[], [], [], []];
      for (const key of catalogue().all) _byRarity[rarityOf(key)].push(key);
    }
    return _byRarity[clamp(rarity, 0, 3)];
  }

  //===========================================================================
  // Card text
  //===========================================================================
  // Deliberately re-rolled per instance rather than read off the world seed:
  // "each card description uses a randomised seed". Both services already take
  // a salt for exactly this, so no template is rewritten anywhere.

  function cardText(key, seed) {
    // An effect card's text is its rule, and the rule never varies.
    if (isEffect(key)) {
      const effect = effectOf(key);
      return effect ? T("CardGame.effect." + effect.id + ".desc") : "";
    }
    const data = dataOf(key);
    if (!data) return "";
    const salt = seed >>> 0;
    try {
      if (isMonster(key)) {
        if (!window.EnemyDescription) return "";
        const template = window.EnemyDescription.rawDescription(data.id);
        if (!template) return "";
        return window.EnemyDescription.resolve(template, "card:" + data.id + ":" + salt);
      }
      if (window.ItemSystemUtils && window.ItemSystemUtils.loreFor) {
        return window.ItemSystemUtils.loreFor(data, salt) || data.description || "";
      }
    } catch (e) { /* flavour text never breaks a card */ }
    return data.description || "";
  }

  //===========================================================================
  // Storage: the collection and the decks
  //===========================================================================
  // On $gameSystem, so it rides the binary save: one collection for the whole
  // party, never attached to a member and never written to the world folder.

  function sys() {
    return typeof $gameSystem !== "undefined" ? $gameSystem : null;
  }

  function collection() {
    const s = sys();
    if (!s) return {};
    if (!s._cardCollection) s._cardCollection = {};
    return s._cardCollection;
  }

  function countOf(key) {
    return collection()[key] || 0;
  }

  function addCard(key, amount) {
    if (!dataOf(key)) return 0;
    const store = collection();
    const n = Math.max(1, Math.round(amount || 1));
    store[key] = (store[key] || 0) + n;
    autoAddToDeck(key, n);
    return store[key];
  }

  // A deck that is not yet full takes whatever the party has just won, so a
  // player who never opens the builder still walks away from a booster with a
  // bigger deck than they sat down with. A full deck is left exactly as its
  // owner built it.
  function autoAddToDeck(key, amount) {
    const list = decks();
    if (!list.length) return;
    const deck = list[activeDeckIndex()];
    if (!deck || !Array.isArray(deck.cards)) return;
    let room = DECK_MAX - deck.cards.length;
    for (let i = 0; i < amount && room > 0; i++, room--) deck.cards.push(key);
  }

  function removeCard(key, amount) {
    const store = collection();
    if (!store[key]) return 0;
    store[key] = Math.max(0, store[key] - Math.max(1, Math.round(amount || 1)));
    if (!store[key]) delete store[key];
    return store[key] || 0;
  }

  function ownedKeys() {
    return Object.keys(collection()).filter((key) => collection()[key] > 0);
  }

  function totalOwned() {
    return ownedKeys().reduce((sum, key) => sum + countOf(key), 0);
  }

  // How much of the printable catalogue the party has seen, as a percentage.
  function completion() {
    const total = catalogue().all.length;
    if (!total) return 0;
    return (ownedKeys().length / total) * 100;
  }

  function decks() {
    const s = sys();
    if (!s) return [];
    if (!Array.isArray(s._cardDecks)) s._cardDecks = [];
    return s._cardDecks;
  }

  function activeDeckIndex() {
    const s = sys();
    if (!s) return 0;
    const list = decks();
    if (typeof s._cardActiveDeck !== "number") s._cardActiveDeck = 0;
    return clamp(s._cardActiveDeck, 0, Math.max(0, list.length - 1));
  }

  function setActiveDeck(index) {
    const s = sys();
    if (s) s._cardActiveDeck = clamp(index, 0, Math.max(0, decks().length - 1));
  }

  function activeDeck() {
    return decks()[activeDeckIndex()] || null;
  }

  // A deck is legal when it is the right size and every copy in it is a copy
  // the party actually owns.
  function deckLegality(cards) {
    const list = Array.isArray(cards) ? cards : [];
    if (list.length < DECK_MIN) return { ok: false, reason: "tooFew" };
    if (list.length > DECK_MAX) return { ok: false, reason: "tooMany" };
    const used = {};
    for (const key of list) {
      used[key] = (used[key] || 0) + 1;
      if (used[key] > countOf(key)) return { ok: false, reason: "notOwned", key };
    }
    return { ok: true };
  }

  function saveDeck(index, deck) {
    const list = decks();
    if (index == null || index < 0 || index >= list.length) list.push(deck);
    else list[index] = deck;
  }

  function deleteDeck(index) {
    const list = decks();
    if (index >= 0 && index < list.length) list.splice(index, 1);
    setActiveDeck(activeDeckIndex());
  }

  // The deck a duel is actually played with: the active one when it is legal,
  // otherwise the best hand the collection can make on its own, so a player who
  // never opened the deck builder is still dealt something playable.
  function playableDeck() {
    const deck = activeDeck();
    if (deck && deckLegality(deck.cards).ok) return deck.cards.slice();
    return autoDeck();
  }

  // Every party owns one of each effect card from the moment it exists: they
  // are the game's own vocabulary rather than something to be pulled out of a
  // pack, so they are handed over once and never rolled for.
  function ensureStarterEffects() {
    const s = sys();
    if (!s || s._cardStarterEffects) return false;
    s._cardStarterEffects = true;
    const store = collection();
    for (const key of EFFECT_KEYS) store[key] = (store[key] || 0) + 1;
    return true;
  }

  // Whether the party can sit down at a table at all. A deck is 9 cards at the
  // least, so a collection that cannot make one is the reason a duel is refused
  // rather than started and lost.
  function canDuel() {
    return playableDeck().length >= DECK_MIN;
  }

  // Every copy the party owns, one entry per copy, as the pool a deck is drawn
  // from.
  function ownedPool() {
    const pool = [];
    for (const key of ownedKeys()) {
      for (let i = 0; i < countOf(key); i++) pool.push(key);
    }
    return pool;
  }

  // A deck dealt at random out of the collection, filled to the brim: the
  // "shuffle" button, for a player who would rather be handed one.
  function shuffledDeck() {
    const pool = ownedPool();
    const rng = makeRng(rollSeed());
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // The five tricks are never the cards a random deal leaves behind: they
    // are what makes a hand interesting, so they go in first.
    pool.sort((a, b) => (isEffect(b) ? 1 : 0) - (isEffect(a) ? 1 : 0));
    return pool.slice(0, Math.min(DECK_MAX, pool.length));
  }

  // Strongest legal deck the collection can field, dearest cards first.
  function autoDeck() {
    const pool = ownedPool();
    // The tricks first, then creatures (they are what wins a match), then gear,
    // which only helps once something is standing on the board.
    const band = (key) => (isEffect(key) ? 2 : isMonster(key) ? 1 : 0);
    pool.sort((a, b) => (band(b) - band(a)) || (statTotal(b) - statTotal(a)));
    return pool.slice(0, Math.min(DECK_MAX, pool.length));
  }

  //===========================================================================
  // Boosters
  //===========================================================================

  function rollRarity(rng, table) {
    let roll = rng();
    for (let i = table.length - 1; i >= 0; i--) {
      if (table[i] <= 0) continue;
      roll -= table[i];
      if (roll < 0) return i;
    }
    return RARITY.COMMON;
  }

  // Six cards, monsters and gear from one pool. `luck` (0-1) leans the odds up
  // a band, which is what a duel streak buys.
  function rollBooster(size, opts) {
    const options = opts || {};
    const count = Math.max(1, Math.round(size || PACK_SIZE));
    const rng = makeRng(options.seed != null ? options.seed : rollSeed());
    const luck = clamp(Number(options.luck) || 0, 0, 1);
    const out = [];
    for (let i = 0; i < count; i++) {
      const base = (i === count - 1) ? PACK_ODDS_LAST : PACK_ODDS;
      let rarity = rollRarity(rng, base);
      if (luck > 0 && rng() < luck) rarity = Math.min(RARITY.LEGENDARY, rarity + 1);
      let pool = keysByRarity(rarity);
      // A band with nothing in it (a very small database) steps back down.
      while (!pool.length && rarity > 0) pool = keysByRarity(--rarity);
      if (!pool.length) break;
      out.push(pool[Math.floor(rng() * pool.length) % pool.length]);
    }
    return out;
  }

  // Bank a rolled pack. Returns the rows the opening animation reads, each one
  // flagged with whether it is the first copy the party has ever held.
  function openBooster(keys) {
    return (keys || []).map((key) => {
      const isNew = countOf(key) === 0;
      addCard(key, 1);
      return { key, isNew, rarity: rarityOf(key) };
    });
  }

  //===========================================================================
  // Opponents
  //===========================================================================

  // An NPC's deck is DERIVED, never stored: the same person always brings the
  // same cards because the roll is seeded on their name and the world, so
  // "a predetermined set of cards" costs nothing to persist.
  function npcDeck(npcName, profile) {
    const rng = makeRng((hashString("cards:" + String(npcName)) ^ worldSeed()) >>> 0);
    const level = clamp((profile && profile.level) || 10, 1, 99);
    const wealth = clamp((profile && profile.wealthTierBase) || 1, 0, 4);
    // A richer, higher-standing person fields a dearer deck.
    const power = clamp(level / 60 + wealth / 8, 0.15, 1);
    const size = 12 + Math.floor(rng() * 5);
    return buildRolledDeck(rng, size, power);
  }

  // A deck rolled straight out of the catalogue rather than the collection, for
  // a practice duel or the random-battle plugin command.
  function randomDeck(size, power) {
    const rng = makeRng(rollSeed());
    return buildRolledDeck(rng, clamp(size || 16, DECK_MIN, DECK_MAX), clamp(power == null ? 0.5 : power, 0, 1));
  }

  // Roughly a quarter gear, the rest monsters, with `power` deciding how far up
  // the rarity ladder the roll is allowed to reach.
  function buildRolledDeck(rng, size, power) {
    const cat = catalogue();
    const ceiling = power >= 0.85 ? RARITY.LEGENDARY : power >= 0.6 ? RARITY.EPIC : power >= 0.3 ? RARITY.RARE : RARITY.COMMON;
    const pick = (pool) => {
      if (!pool.length) return null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const key = pool[Math.floor(rng() * pool.length) % pool.length];
        if (rarityOf(key) <= ceiling) return key;
      }
      return pool[Math.floor(rng() * pool.length) % pool.length];
    };
    const gear = cat.weapons.concat(cat.armors);
    const out = [];
    // Everybody brings a trick or two: an opponent who could never answer a
    // Cull would be no opponent at all.
    const tricks = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < tricks && i < size; i++) {
      out.push(EFFECT_KEYS[Math.floor(rng() * EFFECT_KEYS.length) % EFFECT_KEYS.length]);
    }
    while (out.length < size) {
      const key = rng() < 0.25 ? pick(gear) : pick(cat.monsters);
      if (!key) break;
      out.push(key);
    }
    return out;
  }

  //===========================================================================
  // The clash
  //===========================================================================
  // Pure and testable. `board` is BOARD_CELLS entries, each null or
  // { key, owner, weapon, armor }. Nothing here reads global state except the
  // stat tables, so a harness can drive it with hand-built boards.

  const neighboursOf = (index) => {
    const x = index % BOARD_SIZE, y = (index / BOARD_SIZE) | 0;
    const out = [];
    if (y > 0) out.push(index - BOARD_SIZE);
    if (y < BOARD_SIZE - 1) out.push(index + BOARD_SIZE);
    if (x > 0) out.push(index - 1);
    if (x < BOARD_SIZE - 1) out.push(index + 1);
    return out;
  };

  // A tile's numbers as they stand: the creature, whatever is bolted onto it,
  // and whatever an effect card did to it (`mult`, 0.5 for Blight, 2 for Gild).
  function cellStats(cell) {
    if (!cell) return Object.assign({}, ZERO_STATS);
    if (cell.stats) return cell.stats;
    const base = combinedStats(cell.key, [cell.weapon, cell.armor]);
    const mult = cell.mult == null ? 1 : cell.mult;
    if (mult === 1) return base;
    const out = {};
    for (const id of STATS) out[id] = clamp(Math.floor(base[id] * mult), 0, STAT_MAX);
    return out;
  }

  // One pairing, scored stat by stat. Most stats won takes it; an equal count
  // of won stats destroys both. A drawn stat counts for neither side, unless
  // one of them is Warded, in which case the tie is theirs.
  function scorePair(statsA, statsB, wardA, wardB) {
    const rows = [];
    let winsA = 0, winsB = 0;
    for (const id of STATS) {
      const a = statsA[id] || 0, b = statsB[id] || 0;
      let winner = a > b ? "a" : b > a ? "b" : null;
      if (winner === null && wardA !== wardB) winner = wardA ? "a" : "b";
      if (winner === "a") winsA++; else if (winner === "b") winsB++;
      rows.push({ stat: id, a, b, winner });
    }
    const outcome = winsA > winsB ? "a" : winsB > winsA ? "b" : "both";
    return { rows, winsA, winsB, outcome };
  }

  function resolveClash(board, seed) {
    const rng = makeRng(seed != null ? seed : rollSeed());
    const snapshot = board.map((cell) => (cell ? cellStats(cell) : null));
    const totals = snapshot.map((s) => (s ? statTotal(s) : 0));

    // Every monster names its target against the frozen board: the weakest
    // enemy beside it, ties broken by a seeded roll so a replay is identical.
    const pairSet = new Map();
    for (let i = 0; i < board.length; i++) {
      const cell = board[i];
      if (!cell) continue;
      let best = [];
      let bestTotal = Infinity;
      for (const n of neighboursOf(i)) {
        const other = board[n];
        if (!other || other.owner === cell.owner) continue;
        if (totals[n] < bestTotal) { bestTotal = totals[n]; best = [n]; }
        else if (totals[n] === bestTotal) best.push(n);
      }
      if (!best.length) continue;
      const target = best.length === 1 ? best[0] : best[Math.floor(rng() * best.length) % best.length];
      // A mutual stare is one fight, not two.
      const pairId = i < target ? i + ":" + target : target + ":" + i;
      if (!pairSet.has(pairId)) pairSet.set(pairId, [Math.min(i, target), Math.max(i, target)]);
    }

    const pairs = [];
    const deaths = new Set();
    for (const [a, b] of pairSet.values()) {
      const score = scorePair(snapshot[a], snapshot[b], !!board[a].warded, !!board[b].warded);
      const dead = score.outcome === "a" ? [b] : score.outcome === "b" ? [a] : [a, b];
      dead.forEach((idx) => deaths.add(idx));
      pairs.push({ a, b, rows: score.rows, winsA: score.winsA, winsB: score.winsB, outcome: score.outcome, dead });
    }

    // Every death lands together: one round, no cascade.
    const survivors = [0, 0];
    const survivingStats = [0, 0];
    for (let i = 0; i < board.length; i++) {
      const cell = board[i];
      if (!cell || deaths.has(i)) continue;
      survivors[cell.owner]++;
      survivingStats[cell.owner] += totals[i];
    }

    let winner = null;
    if (survivors[0] > survivors[1]) winner = 0;
    else if (survivors[1] > survivors[0]) winner = 1;
    else if (survivingStats[0] > survivingStats[1]) winner = 0;
    else if (survivingStats[1] > survivingStats[0]) winner = 1;

    return { pairs, deaths: Array.from(deaths), survivors, survivingStats, winner };
  }

  //===========================================================================
  // Daily duel gate and the streak
  //===========================================================================

  // The world clock in days. Variable 114 is the game time in minutes.
  function dayIndex() {
    const minutes = (typeof $gameVariables !== "undefined" && $gameVariables.value(114)) || 0;
    return Math.floor(minutes / 1440);
  }

  function duelLog() {
    const s = sys();
    if (!s) return {};
    if (!s._cardDuelLog) s._cardDuelLog = {};
    return s._cardDuelLog;
  }

  function hasDuelledToday(npcName) {
    if (!npcName) return false;
    return duelLog()[npcName] === dayIndex();
  }

  function markDuelled(npcName) {
    if (!npcName) return;
    duelLog()[npcName] = dayIndex();
  }

  function tradeLog() {
    const s = sys();
    if (!s) return {};
    if (!s._cardTradeLog) s._cardTradeLog = {};
    return s._cardTradeLog;
  }

  function hasTradedToday(npcName) {
    if (!npcName) return false;
    return tradeLog()[npcName] === dayIndex();
  }

  function markTraded(npcName) {
    if (!npcName) return;
    tradeLog()[npcName] = dayIndex();
  }

  // What an NPC will swap: the distinct cards in the deck they bring to a
  // table, since a person trades out of what they own.
  function npcCards(npcName, profile) {
    const seen = [];
    for (const key of npcDeck(npcName, profile)) {
      if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }

  // What the party would have to give up for `wanted`: the spare copy closest
  // to it in power, so a swap is a swap rather than a gift in either direction.
  // `reserved` names cards the party may not part with (its last copies).
  function tradeCounterOffer(wanted, spares) {
    if (!spares || !spares.length) return null;
    const target = statTotal(wanted);
    let best = null, bestGap = Infinity;
    for (const key of spares) {
      if (key === wanted) continue;
      const gap = Math.abs(statTotal(key) - target) + Math.abs(rarityOf(key) - rarityOf(wanted)) * 4;
      if (gap < bestGap) { bestGap = gap; best = key; }
    }
    return best;
  }

  function streak() {
    const s = sys();
    return (s && s._cardStreak) || 0;
  }

  function bumpStreak(won) {
    const s = sys();
    if (!s) return 0;
    s._cardStreak = won ? streak() + 1 : 0;
    return s._cardStreak;
  }

  // What a win is worth as pack luck: a long streak reaches higher up the
  // rarity ladder, which is the reason to keep playing.
  function streakLuck() {
    return clamp(streak() * 0.08, 0, 0.5);
  }

  //===========================================================================
  // Art
  //===========================================================================

  // The 3D archetype this monster is grown from, or null when the procedural
  // system has nothing registered for it.
  function archetypeOf(key) {
    if (!isMonster(key) || !window.Battler3D || !window.Battler3D.resolveKey) return null;
    const data = dataOf(key);
    if (!data) return null;
    try { return window.Battler3D.resolveKey(data); } catch (e) { return null; }
  }

  function charSheetFor(key) {
    if (!isMonster(key)) return null;
    return charSheetOf(dataOf(key));
  }

  // Whether card faces should be drawn as 3D snapshots at all. Switch 70 is the
  // game's own "3D battlers" master toggle.
  function use3DFaces() {
    if (typeof THREE === "undefined" || !window.Battler3D || !window.Battler3D.create) return false;
    return typeof $gameSwitches !== "undefined" && $gameSwitches.value(70);
  }

  // Whether the BOARD puts live models on its tiles: the experimental option,
  // off by default, on top of everything a face needs.
  function use3DBoard() {
    if (!use3DFaces()) return false;
    return typeof ConfigManager !== "undefined" && ConfigManager.cardBoard3D === true;
  }

  //---------------------------------------------------------------------------
  // Snapshot service.
  //---------------------------------------------------------------------------
  // ONE offscreen renderer for the whole plugin, working through a queue. Never
  // one context per card: the browser caps live WebGL contexts and force-loses
  // the OLDEST past the cap, which is the game's own canvas, and the picture
  // then freezes until the game is restarted.

  const FACE_CACHE_MAX = 64;
  const _faceCache = new Map();
  const _facePending = new Map();
  let _renderer = null;
  let _rendererCanvas = null;
  let _queue = Promise.resolve();

  function ensureRenderer(px) {
    if (_renderer) {
      _renderer.setSize(px, px, false);
      return _renderer;
    }
    _rendererCanvas = document.createElement("canvas");
    _rendererCanvas.width = px;
    _rendererCanvas.height = px;
    _renderer = new THREE.WebGLRenderer({
      canvas: _rendererCanvas, alpha: true, antialias: true, preserveDrawingBuffer: true
    });
    _renderer.setSize(px, px, false);
    _renderer.setPixelRatio(1);
    return _renderer;
  }

  function releaseRenderer() {
    if (!_renderer) return;
    try { _renderer.dispose(); } catch (e) { /* already gone */ }
    try { if (_renderer.forceContextLoss) _renderer.forceContextLoss(); } catch (e) { /* already gone */ }
    _renderer = null;
    _rendererCanvas = null;
  }

  function cacheFace(cacheKey, url) {
    _faceCache.set(cacheKey, url);
    if (_faceCache.size > FACE_CACHE_MAX) {
      _faceCache.delete(_faceCache.keys().next().value);
    }
    return url;
  }

  // Build one model under `seed`, frame it and hand back a data URL. The
  // generation seed is what makes two copies of one monster look different, and
  // it is restored the moment the model is built, exactly as the Bestiary's
  // portrait does it.
  function renderFace(key, seed, px) {
    return new Promise((resolve) => {
      const archKey = archetypeOf(key);
      if (!archKey) return resolve(null);
      const data = dataOf(key);
      let renderer;
      try { renderer = ensureRenderer(px); } catch (e) { return resolve(null); }

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.15));
      const keyLight = new THREE.DirectionalLight(0xfff2d0, 1.4); keyLight.position.set(3, 5, 4); scene.add(keyLight);
      const fill = new THREE.DirectionalLight(0xbcd4ff, 0.7); fill.position.set(-3, -2, 2); scene.add(fill);
      const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 300);

      const fakeBattler = { enemyId: () => data.id, index: () => 0 };
      const previous = window.Battler3D.getGenSeed ? window.Battler3D.getGenSeed() : null;
      let battler = null;
      try {
        if (window.Battler3D.setGenSeed) window.Battler3D.setGenSeed(String(seed >>> 0));
        battler = window.Battler3D.create(archKey, 0, 0, fakeBattler);
      } catch (e) {
        battler = null;
      } finally {
        if (window.Battler3D.setGenSeed && previous != null) window.Battler3D.setGenSeed(previous);
      }
      if (!battler) return resolve(null);

      const finish = (url) => {
        try { if (battler.dispose) battler.dispose(); } catch (e) { /* nothing held */ }
        resolve(url);
      };

      Promise.resolve(battler.load(null, 0, 0, 0)).then(() => {
        if (!battler.model) return finish(null);
        try { battler.update(1 / 60); } catch (e) { /* first frame only */ }
        const holder = new THREE.Group();
        const box = new THREE.Box3().setFromObject(battler.model);
        const size = new THREE.Vector3(); box.getSize(size);
        const centre = new THREE.Vector3(); box.getCenter(centre);
        // The family idle animations rewrite model.position every frame, so the
        // centring offset rides a parent holder instead of the model itself.
        holder.position.copy(centre).multiplyScalar(-1);
        holder.add(battler.model);
        scene.add(holder);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const dist = maxDim / (2 * Math.tan((38 * Math.PI / 180) / 2));
        camera.position.set(dist * 0.28, dist * 0.16, dist * 1.12);
        camera.lookAt(0, 0, 0);
        try {
          renderer.render(scene, camera);
          finish(_rendererCanvas.toDataURL("image/png"));
        } catch (e) {
          finish(null);
        }
      }).catch(() => finish(null));
    });
  }

  // The card face for one instance. Resolves to a data URL, or to null when
  // there is nothing to snapshot and the caller should fall back to the 2D
  // battler image.
  function face(key, seed, px) {
    const size = px || 192;
    const cacheKey = key + ":" + (seed >>> 0) + ":" + size;
    if (_faceCache.has(cacheKey)) return Promise.resolve(_faceCache.get(cacheKey));
    if (_facePending.has(cacheKey)) return _facePending.get(cacheKey);
    if (!use3DFaces() || !isMonster(key)) return Promise.resolve(null);

    // Serialised: one model is built, framed and read back at a time, so a hand
    // of six cards never has six models resident at once.
    const job = _queue.then(() => renderFace(key, seed >>> 0, size))
      .then((url) => {
        _facePending.delete(cacheKey);
        return url ? cacheFace(cacheKey, url) : null;
      })
      .catch(() => { _facePending.delete(cacheKey); return null; });
    _queue = job.catch(() => { });
    _facePending.set(cacheKey, job);
    return job;
  }

  //---------------------------------------------------------------------------
  // Live faces: the creature moving INSIDE the card.
  //---------------------------------------------------------------------------
  // A snapshot is a photograph; this is the animal. Each live face owns a
  // scene and a model but NOT a context: every one of them is drawn through
  // ONE shared renderer and blitted onto its own 2D canvas, so a hand of seven
  // cards costs a single WebGL context however many creatures are in it.

  const LIVE_PX = 224;
  let _liveRenderer = null;
  let _liveCanvas = null;

  function ensureLiveRenderer() {
    if (_liveRenderer) return _liveRenderer;
    if (typeof THREE === "undefined") return null;
    try {
      _liveCanvas = document.createElement("canvas");
      _liveCanvas.width = LIVE_PX;
      _liveCanvas.height = LIVE_PX;
      _liveRenderer = new THREE.WebGLRenderer({
        canvas: _liveCanvas, alpha: true, antialias: true, preserveDrawingBuffer: true
      });
      _liveRenderer.setSize(LIVE_PX, LIVE_PX, false);
      _liveRenderer.setPixelRatio(1);
    } catch (e) {
      _liveRenderer = null;
      _liveCanvas = null;
    }
    return _liveRenderer;
  }

  function releaseLiveRenderer() {
    if (!_liveRenderer) return;
    try { _liveRenderer.dispose(); } catch (e) { /* already gone */ }
    try { if (_liveRenderer.forceContextLoss) _liveRenderer.forceContextLoss(); } catch (e) { /* already gone */ }
    _liveRenderer = null;
    _liveCanvas = null;
  }

  class LiveFace {
    constructor(key, seed) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = LIVE_PX;
      this.canvas.height = LIVE_PX;
      this.ctx = this.canvas.getContext("2d");
      this.ready = false;
      this.dead = false;
      this.battler = null;

      const archKey = archetypeOf(key);
      const data = dataOf(key);
      if (!archKey || !data || typeof THREE === "undefined") { this.dead = true; return; }

      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
      const keyLight = new THREE.DirectionalLight(0xfff2d0, 1.4); keyLight.position.set(3, 5, 4);
      this.scene.add(keyLight);
      const fill = new THREE.DirectionalLight(0xbcd4ff, 0.7); fill.position.set(-3, -2, 2);
      this.scene.add(fill);
      this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 300);

      // The turntable rotates about the world origin, and the model is hung off
      // an inner group translated by its own centre so the origin IS the
      // creature's middle; rotating the centring group instead would swing the
      // model around a point somewhere off in space.
      this.spinner = new THREE.Group();
      this.scene.add(this.spinner);

      const fake = { enemyId: () => data.id, index: () => 0 };
      const previous = window.Battler3D && window.Battler3D.getGenSeed ? window.Battler3D.getGenSeed() : null;
      let battler = null;
      try {
        if (window.Battler3D.setGenSeed) window.Battler3D.setGenSeed(String(seed >>> 0));
        battler = window.Battler3D.create(archKey, 0, 0, fake);
      } catch (e) {
        battler = null;
      } finally {
        if (window.Battler3D.setGenSeed && previous != null) window.Battler3D.setGenSeed(previous);
      }
      if (!battler) { this.dead = true; return; }
      this.battler = battler;

      Promise.resolve(battler.load(null, 0, 0, 0)).then(() => {
        if (this.dead || !battler.model) return;
        try { battler.update(1 / 60); } catch (e) { /* first frame only */ }
        const holder = new THREE.Group();
        const box = new THREE.Box3().setFromObject(battler.model);
        const size = new THREE.Vector3(); box.getSize(size);
        const centre = new THREE.Vector3(); box.getCenter(centre);
        holder.position.copy(centre).multiplyScalar(-1);
        holder.add(battler.model);
        this.spinner.add(holder);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        // Far enough back that the widest bearing of the turn still fits.
        const dist = maxDim / (2 * Math.tan((38 * Math.PI / 180) / 2));
        this.camera.position.set(0, dist * 0.14, dist * 1.2);
        this.camera.lookAt(0, 0, 0);
        this.ready = true;
      }).catch(() => { this.dead = true; });
    }

    update(dt) {
      if (!this.ready || this.dead) return false;
      try { this.battler.update(dt); } catch (e) { /* a stuck model never stops the hand */ }
      this.spinner.rotation.y += dt * 0.55;
      const renderer = ensureLiveRenderer();
      if (!renderer) return false;
      try {
        renderer.render(this.scene, this.camera);
        this.ctx.clearRect(0, 0, LIVE_PX, LIVE_PX);
        this.ctx.drawImage(_liveCanvas, 0, 0);
      } catch (e) {
        return false;
      }
      return true;
    }

    dispose() {
      this.dead = true;
      this.ready = false;
      try { if (this.battler && this.battler.dispose) this.battler.dispose(); } catch (e) { /* nothing held */ }
      this.battler = null;
      this.scene = null;
      this.spinner = null;
    }
  }

  // A live face for one played instance, or null when the monster has no
  // registered archetype and the caller should fall back to its sprite.
  function liveFace(key, seed) {
    if (!use3DFaces() || !isMonster(key)) return null;
    const face = new LiveFace(key, seed >>> 0);
    return face.dead ? null : face;
  }

  // The stand-in while a model is still building, and the whole picture for a
  // monster that has no model at all: its own walking sprite. The flat battler
  // illustration this used to return retired with the 2D battler mode.
  function spriteArt(key, px) {
    if (!isMonster(key) || !charSheetFor(key)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px || 96;
    drawTileSprite(canvas, key, 1);
    return canvas;
  }

  // Draw a monster's walking sprite onto a canvas, the way the bestiary list
  // does: `$`-prefixed sheets are 3x4, the rest 12x8, and the first row faces
  // the player.
  function drawTileSprite(canvas, key, frame) {
    const sheet = charSheetFor(key);
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return;
    if (!sheet) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const bitmap = ImageManager.loadCharacter("Monsters/" + sheet);
    bitmap.addLoadListener(() => {
      if (!canvas.isConnected) return;
      const single = sheet.startsWith("$");
      const pw = single ? bitmap.width / 3 : bitmap.width / 12;
      const ph = single ? bitmap.height / 4 : bitmap.height / 8;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap.canvas, (frame % 3) * pw, 0, pw, ph, 0, 0, canvas.width, canvas.height);
    });
  }

  // The IconSet glyph an equipment card is illustrated with, as inline CSS.
  function iconStyle(key, size) {
    const effect = effectOf(key);
    const data = dataOf(key);
    const index = effect ? effect.icon : ((data && data.iconIndex) || 0);
    const px = size || 64;
    const col = index % 16, row = Math.floor(index / 16);
    return `background-image:url('img/system/IconSet.png');background-size:${px * 16}px auto;`
      + `background-position:-${col * px}px -${row * px}px;width:${px}px;height:${px}px;`
      + `image-rendering:pixelated;display:inline-block;flex-shrink:0;`;
  }

  //===========================================================================
  // Public module
  //===========================================================================

  window.CardGame = {
    // constants
    STAT_MAX, STATS, BOARD_SIZE, BOARD_CELLS, DECK_MIN, DECK_MAX, HAND_START, HAND_MAX, PACK_SIZE,
    DRAW_COUNT,
    RARITY, RARITY_KEYS,

    // helpers
    hashString, makeRng, rollSeed, clamp, worldSeed,

    // catalogue
    catalogue, parseKey, dataOf, nameOf, isMonster, isWeapon, isArmor, isEquip,
    monsterKey, weaponKey, armorKey,

    // effect cards
    EFFECTS, EFFECT_KEYS, isEffect, effectOf, effectId, ensureStarterEffects,

    // stats
    statsFor, statTotal, combinedStats, cellStats,
    statLabel: (id) => T("CardGame.stat." + id),

    // rarity
    rarityOf, rarityKey, rarityName, keysByRarity,

    // text
    cardText,

    // collection
    collection, countOf, addCard, removeCard, ownedKeys, totalOwned, completion,

    // decks
    decks, activeDeck, activeDeckIndex, setActiveDeck, saveDeck, deleteDeck,
    deckLegality, playableDeck, autoDeck, shuffledDeck, ownedPool, canDuel,

    // boosters
    rollBooster, openBooster,

    // opponents
    npcDeck, randomDeck, npcCards, tradeCounterOffer,

    // clash
    neighboursOf, scorePair, resolveClash,

    // daily gate and streak
    dayIndex, hasDuelledToday, markDuelled, hasTradedToday, markTraded,
    streak, bumpStreak, streakLuck,

    // art
    Art: {
      archetypeOf, charSheetFor, use3DFaces, use3DBoard,
      face, liveFace, spriteArt, drawTileSprite, iconStyle,
      releaseRenderer, releaseLiveRenderer
    }
  };

  // A brand new party starts holding the five tricks, and so does a savegame
  // made before they existed, the first time anything asks for the collection.
  const _DataManager_setupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function () {
    _DataManager_setupNewGame.call(this);
    ensureStarterEffects();
  };

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);
    ensureStarterEffects();
  };
})();
